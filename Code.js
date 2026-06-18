const CONFIG = Object.freeze({
  GEMINI_MODEL: "gemini-3.1-flash-lite",
  PROCESSED_LABEL: "gemini-processed",
  ERROR_LABEL: "gemini-error",
  MAX_THREADS_PER_RUN: 10,
  SEARCH_LOOKBACK_DAYS: 14,
  BODY_MAX_CHARS: 4000,
  CLEAN_BODY_PREVIEW_LIMIT: 5000,
  SLEEP_BETWEEN_THREADS_MS: 250,
  LOCK_WAIT_MS: 10000,
  GEMINI_MAX_RETRIES: 3,
  TELEGRAM_MAX_RETRIES: 3
});

// SCRIPT PROPERTIES HELPERS
// ====================================================
function getSecrets() {
  const props = PropertiesService.getScriptProperties();

  return {
    geminiApiKey: props.getProperty("GEMINI_KEY"),
    telegramBotToken: props.getProperty("TG_TOKEN"),
    telegramChatId: props.getProperty("TG_CHAT_ID")
  };
}


function validateSetup() {
  const { geminiApiKey, telegramBotToken, telegramChatId } = getSecrets();
  const missingKeys = [];

  if (!geminiApiKey) missingKeys.push("GEMINI_KEY");
  if (!telegramBotToken) missingKeys.push("TG_TOKEN");
  if (!telegramChatId) missingKeys.push("TG_CHAT_ID");

  if (missingKeys.length > 0) {
    throw new Error(
      `CRITICAL_ERROR: Script Properties alanında şu anahtarlar eksik: ${missingKeys.join(", ")}. Lütfen önce bunları tanımlayın.`
    );
  }

  return { geminiApiKey, telegramBotToken, telegramChatId };
}

// MAIN LOOP
// ====================================================
function checkAndProcessEmails() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    Logger.log("Başka bir instance zaten çalışıyor. Bu tur atlandı.");
    return;
  }

  try {
    const secrets = validateSetup();

    const processedLabel = getOrCreateLabel(CONFIG.PROCESSED_LABEL);
    const errorLabel = getOrCreateLabel(CONFIG.ERROR_LABEL);

    const query =
      `in:inbox newer_than:${CONFIG.SEARCH_LOOKBACK_DAYS}d ` +
      `-label:${CONFIG.PROCESSED_LABEL} -label:${CONFIG.ERROR_LABEL}`;

    const threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS_PER_RUN);

    if (!threads || threads.length === 0) {
      Logger.log("Yeni veya işlenmemiş mail bulunamadı.");
      return;
    }

    for (let i = 0; i < threads.length; i++) {
      const currentThread = threads[i];

      try {
        if (threadHasLabel(currentThread, CONFIG.PROCESSED_LABEL)) {
          continue;
        }

        const messages = currentThread.getMessages();
        if (!messages || messages.length === 0) {
          throw new Error("Thread içinde mesaj bulunamadı.");
        }

        const lastMessage = messages[messages.length - 1];

        const from = lastMessage.getFrom() || "Bilinmeyen Gönderen";
        const to = lastMessage.getTo() || "Bilinmeyen Alıcı";
        const subject = lastMessage.getSubject() || "(Konu Yok)";

        let rawBody = (lastMessage.getPlainBody() || "").trim();
        if (!rawBody) {
          rawBody = "[Bu mail düz metin içeriği barındırmıyor, sadece HTML veya görsel içerikten oluşuyor olabilir.]";
        }

        const cleanBody = sanitizeEmailBody(rawBody, CONFIG.CLEAN_BODY_PREVIEW_LIMIT, CONFIG.BODY_MAX_CHARS);

        const aiResult = analyzeWithGemini(
          cleanBody,
          from,
          to,
          subject,
          secrets.geminiApiKey
        );

        validateAiResult(aiResult);

        if (aiResult.status === "CRITICAL" || aiResult.status === "IMPORTANT") {
          sendTelegramNotification(
            from,
            subject,
            aiResult,
            secrets.telegramBotToken,
            secrets.telegramChatId
          );
        }

        currentThread.addLabel(processedLabel);
        if (threadHasLabel(currentThread, CONFIG.ERROR_LABEL)) {
          currentThread.removeLabel(errorLabel);
        }

        Utilities.sleep(CONFIG.SLEEP_BETWEEN_THREADS_MS);
      } catch (threadError) {
        const subjectSafe = currentThread.getMessages().length
          ? currentThread.getMessages()[currentThread.getMessages().length - 1].getSubject()
          : "(Konu Yok)";

        Logger.log(`HATA OLUŞTU - Konu: ${subjectSafe} | Hata: ${threadError.message}`);

        if (isRateLimitError(threadError)) {
          Logger.log("Rate limit / geçici servis hatası tespit edildi. Kalan mailler bir sonraki çalışmaya bırakılıyor.");
          break;
        }

        try {
          currentThread.addLabel(errorLabel);
        } catch (labelError) {
          Logger.log(`Hata etiketi eklenemedi: ${labelError.message}`);
        }

        Utilities.sleep(CONFIG.SLEEP_BETWEEN_THREADS_MS);
      }
    }
  } catch (setupOrFatalError) {
    Logger.log(`FATAL: ${setupOrFatalError.message}`);
    throw setupOrFatalError;
  } finally {
    lock.releaseLock();
  }
}

// GMAIL HELPERS
// ====================================================
function getOrCreateLabel(labelName) {
  return GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
}

function threadHasLabel(thread, labelName) {
  const labels = thread.getLabels() || [];
  return labels.some(label => label.getName() === labelName);
}

// EMAIL BODY SANITIZER
// ====================================================
function sanitizeEmailBody(body, previewLimit, maxChars) {
  let text = String(body || "").trim();

  text = text.substring(0, previewLimit);
  text = text.replace(/(https?:\/\/[^\s]+)/g, "[URL]");
  text = text.replace(/\s+/g, " ").trim();
  text = text.substring(0, maxChars);

  return text || "[Boş içerik]";
}

// GEMINI
// ====================================================
function analyzeWithGemini(cleanBody, from, to, subject, geminiApiKey) {
  const systemPrompt = `
You are Furkan's highly reliable email classification assistant.

Your job:
- Detect important emails about internship/job applications, interview invitations, technical assessments, rejections, acceptances, security alerts, API/service issues, and other actionable messages.
- Ignore newsletters, marketing, promotions, and weak noise.
- Return accurate, concise, professional Turkish.

CRITICAL RULES:
- Ignore footers, unsubscribe blocks, legal disclaimers, and profile summaries from automated platforms.
- Focus on the real core message.
- Do not hallucinate names, dates, or outcomes.
- key_points MUST contain exactly 3 items.
- Point 1 must state sender/company, context, and final status/result.
- If the email contains interview invitation, internship invitation, technical assessment, coding challenge, rejection result, acceptance result, security alert, password reset, billing issue, or API breakdown, status MUST NOT be IGNORE.

Return ONLY valid JSON matching the schema.
`.trim();

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(CONFIG.GEMINI_MODEL) +
    ":generateContent?key=" +
    encodeURIComponent(geminiApiKey);

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [{
      parts: [{
        text:
          "ANALİZ EDİLECEK MAİL:\n" +
          `Kimden: ${from}\n` +
          `Kime: ${to}\n` +
          `Konu: ${subject}\n` +
          `İçerik: ${cleanBody}`
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 700,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          status: {
            type: "STRING",
            enum: ["CRITICAL", "IMPORTANT", "IGNORE"]
          },
          category: {
            type: "STRING",
            enum: ["API_UPDATE", "INTERNSHIP", "SECURITY", "DIRECT_MAIL", "OTHER"]
          },
          key_points: {
            type: "ARRAY",
            minItems: 3,
            maxItems: 3,
            items: { type: "STRING" }
          },
          action_required: {
            type: "STRING"
          }
        },
        required: ["status", "category", "key_points", "action_required"]
      }
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = fetchWithRetry(url, options, CONFIG.GEMINI_MAX_RETRIES);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`HTTP_ERR_${responseCode}: ${responseText}`);
  }

  const jsonResponse = JSON.parse(responseText);

  const aiText = extractGeminiText(jsonResponse);
  const cleanedJsonText = stripCodeFences(aiText);
  const parsed = parseJsonSafely(cleanedJsonText);

  return parsed;
}

function fetchWithRetry(url, options, maxRetries) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();

      if (code === 200) {
        return response;
      }

      const body = response.getContentText();
      const retryableCodes = [429, 500, 502, 503, 504];

      if (retryableCodes.includes(code)) {
        lastError = new Error(`HTTP_ERR_${code}: ${body}`);
        if (attempt < maxRetries) {
          Utilities.sleep(getBackoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      throw new Error(`HTTP_ERR_${code}: ${body}`);
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries && isRetryableException(err)) {
        Utilities.sleep(getBackoffMs(attempt));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error("Fetch başarısız.");
}

function getBackoffMs(attempt) {
  return Math.min(8000, Math.pow(2, attempt) * 1000);
}

function isRetryableException(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("rate limit") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

function isRateLimitError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

function extractGeminiText(jsonResponse) {
  const candidates = jsonResponse && jsonResponse.candidates;
  if (!candidates || !candidates.length) {
    throw new Error("Gemini geçerli bir candidate döndürmedi.");
  }

  const parts = candidates[0] &&
    candidates[0].content &&
    candidates[0].content.parts;

  if (!parts || !parts.length) {
    throw new Error("Gemini content.parts boş.");
  }

  const text = parts
    .map(part => (part && part.text ? part.text : ""))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini metin üretmedi.");
  }

  return text;
}

function stripCodeFences(text) {
  let output = String(text || "").trim();

  output = output
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    output = output.substring(firstBrace, lastBrace + 1).trim();
  }

  return output;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      "Gemini JSON parse hatası: " +
      String(err.message || err) +
      " | Preview: " +
      text.substring(0, 500)
    );
  }
}

function validateAiResult(data) {
  if (!data || typeof data !== "object") {
    throw new Error("AI response geçersiz.");
  }

  const validStatuses = ["CRITICAL", "IMPORTANT", "IGNORE"];
  const validCategories = ["API_UPDATE", "INTERNSHIP", "SECURITY", "DIRECT_MAIL", "OTHER"];

  if (!validStatuses.includes(data.status)) {
    throw new Error(`Geçersiz status: ${data.status}`);
  }

  if (!validCategories.includes(data.category)) {
    throw new Error(`Geçersiz category: ${data.category}`);
  }

  if (!Array.isArray(data.key_points)) {
    throw new Error("key_points array değil.");
  }

  if (data.key_points.length !== 3) {
    throw new Error(`key_points tam 3 eleman içermeli. Gelen: ${data.key_points.length}`);
  }

  for (let i = 0; i < data.key_points.length; i++) {
    if (typeof data.key_points[i] !== "string" || !data.key_points[i].trim()) {
      throw new Error(`key_points[${i}] geçersiz.`);
    }
  }

  if (typeof data.action_required !== "string" || !data.action_required.trim()) {
    throw new Error("action_required boş veya geçersiz.");
  }

  return true;
}

// TELEGRAM
// ====================================================
function sendTelegramNotification(from, subject, aiResult, telegramBotToken, telegramChatId) {
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  const emoji = aiResult.status === "CRITICAL" ? "🚨" : "⚠️";

  const messageText =
    `${emoji} *${escapeMarkdownV2(aiResult.status)} MAIL DETECTED*\n\n` +
    `👤 *Kimden:* ${escapeMarkdownV2(from)}\n` +
    `📌 *Konu:* ${escapeMarkdownV2(subject)}\n` +
    `📂 *Kategori:* ${escapeMarkdownV2(aiResult.category)}\n\n` +
    `*Önemli Çıktılar:*\n` +
    `1\\. ${escapeMarkdownV2(aiResult.key_points[0])}\n` +
    `2\\. ${escapeMarkdownV2(aiResult.key_points[1])}\n` +
    `3\\. ${escapeMarkdownV2(aiResult.key_points[2])}\n\n` +
    `🎯 *Aksiyon:* ${escapeMarkdownV2(aiResult.action_required)}`;

  const payload = {
    chat_id: telegramChatId,
    text: messageText,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = fetchWithRetry(url, options, CONFIG.TELEGRAM_MAX_RETRIES);
  const code = response.getResponseCode();

  if (code !== 200) {
    Logger.log(`Telegram gönderim hatası: ${response.getContentText()}`);
  }
}

/**
 * Telegram MarkdownV2 için özel karakterleri escape eder.
 */
function escapeMarkdownV2(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// OPTIONAL TEST
// ====================================================
function testTelegram() {
  const secrets = validateSetup();
  sendTelegramNotification(
    "Test Gönderen <test@example.com>",
    "Test Konusu",
    {
      status: "IMPORTANT",
      category: "DIRECT_MAIL",
      key_points: [
        "Bu bir test bildirimi.",
        "Telegram entegrasyonu çalışıyor.",
        "JSON ve MarkdownV2 akışı doğru."
      ],
      action_required: "Bu sadece test olduğu için işlem yapmana gerek yok."
    },
    secrets.telegramBotToken,
    secrets.telegramChatId
  );
}
