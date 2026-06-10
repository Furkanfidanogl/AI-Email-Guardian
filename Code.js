const scriptProperties = PropertiesService.getScriptProperties();
const GEMINI_API_KEY = scriptProperties.getProperty('GEMINI_KEY');
const TELEGRAM_BOT_TOKEN = scriptProperties.getProperty('TG_TOKEN');
const TELEGRAM_CHAT_ID = scriptProperties.getProperty('TG_CHAT_ID');
// ====================================================

function checkAndProcessEmails() {
  const labelName = "gemini-processed";
  const errorLabelName = "gemini-error";
  
  let label = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
  let errorLabel = GmailApp.getUserLabelByName(errorLabelName) || GmailApp.createLabel(errorLabelName);

  // KUSURSUZ ARAMA: Gelen kutusunda olan, işlenmemiş ve hata almamış mailler.
  const threads = GmailApp.search(`in:inbox -label:${labelName} -label:${errorLabelName}`);
  
  if (threads.length === 0) {
    Logger.log("Yeni veya işlenmemiş mail bulunamadı.");
    return;
  }

  const systemPrompt = `You are Furkan's absolute elite, zero-error personal AI executive assistant. Furkan is a Computer Engineering student, an Android Developer (Kotlin, Compose), and the founder of 'Crux AI Summarize'.
Your absolute primary directive is to digest emails with 100% precision. Missing an interview invitation, a rejection/acceptance result of a job/internship application, a security alert, or an API breakdown means absolute failure. Do NOT hallucinate, do NOT omit critical data, dates, or names.

CRITICAL RULES FOR APPLICATION & RESULT EMAILS:
- Automated platform emails (LinkedIn, Indeed, Kariyer.net, etc.) contain heavy footer noise. RUTHLESSLY IGNORE all footer links, subscription disclaimers, or user profile summaries at the bottom.
- FOCUS 100% on the core message body: Is it a job application confirmation? Is it a rejection ("başvurunuzla devam etmeyeceğiz", "olumsuz", "teşekkür ederiz")? Is it a technical test invite? State the exact final result clearly in the key points.

CRITICAL RULES FOR ACCURACY & COMPRESSION:
- You MUST provide EXACTLY 3 key points in the 'key_points' array. No more, no less.
- Point 1 MUST explicitly state the Sender/Company name, the context (e.g., Job Title), and the definitive status or result.
- All text field values must be written in clear, professional Turkish.`;

  // Saatte maksimum 10 thread limit (Kota ve stabilite dostu)
  const batchSize = Math.min(threads.length, 10);

  for (let i = 0; i < batchSize; i++) {
    const currentThread = threads[i];
    const messages = currentThread.getMessages();
    const lastMessage = messages[messages.length - 1];
    
    // Çift dikiş güvenlik kilidi
    if (currentThread.getLabels().some(l => l.getName() === labelName)) {
      continue;
    }

    const from = lastMessage.getFrom();
    const to = lastMessage.getTo(); 
    const subject = lastMessage.getSubject();
    
    // DAHİYANE METİN TEMİZLİĞİ: Uzun URL'leri ve çöp boşlukları uçurarak bağlamı korur, Gemini'yi odaklar.
    let rawBody = lastMessage.getPlainBody() || "";
    let cleanBody = rawBody
      .replace(/(https?:\/\/[^\s]+)/g, "[URL]") // Bütün linkleri [URL] kelimesine çevirir
      .replace(/\s+/g, " ")                    // Tüm ardışık boşluk ve satır başlarını tek boşluğa indirger
      .substring(0, 4000);                     // İlk 4000 karakteri alır (Gövdeye odaklanmak için yeterli)

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
    
    // NATIVE JSON SCHEMA DEFINITION (Gemini 2.5 Standartlarına Tam Uyumlu)
    const payload = {
      "systemInstruction": {
        "parts": [{ "text": systemPrompt }]
      },
      "contents": [{
        "parts": [
          { "text": `ANALİZ EDİLECEK MAİL:\nKimden: ${from}\nKime: ${to}\nKonu: ${subject}\nİçerik:\n${cleanBody}` }
        ]
      }],
      "generationConfig": {
        "responseMimeType": "application/json",
        "responseSchema": {
          "type": "OBJECT",
          "properties": {
            "status": { "type": "STRING", "enum": ["CRITICAL", "IMPORTANT", "IGNORE"] },
            "category": { "type": "STRING", "enum": ["API_UPDATE", "INTERNSHIP", "SECURITY", "DIRECT_MAIL", "OTHER"] },
            "key_points": {
              "type": "ARRAY",
              "items": { "type": "STRING" },
              "description": "Must contain EXACTLY 3 high-impact items in Turkish."
            },
            "action_required": { "type": "STRING", "description": "Next step for Furkan in Turkish." }
          },
          "required": ["status", "category", "key_points", "action_required"]
        }
      }
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      
      if (responseCode !== 200) {
        throw new Error(`API Hatası! Kod: ${responseCode} - Yanıt: ${response.getContentText()}`);
      }

      const jsonResponse = JSON.parse(response.getContentText());
      if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) {
        throw new Error("Gemini geçerli bir yanıt üretemedi.");
      }
      
      const aiResultText = jsonResponse.candidates[0].content.parts[0].text;
      const aiResult = JSON.parse(aiResultText);

      // Sadece CRITICAL veya IMPORTANT ise Telegram'a gönder
      if (aiResult.status === "CRITICAL" || aiResult.status === "IMPORTANT") {
        sendTelegramNotification(from, to, subject, aiResult);
      }

      // BAŞARI: Etiketleri güncelle
      currentThread.addLabel(label);
      currentThread.removeLabel(errorLabel);
      
      // DOĞRU YÖNTEM: Değişiklikleri Gmail/Apps Script kuyruğuna anında işletmek için SpreadsheetApp.flush() kullanılır.
      SpreadsheetApp.flush();

    } catch (e) {
      Logger.log("HATA BÖLGESİ (Zehirli Hap Devrede): " + e.toString());
      currentThread.addLabel(errorLabel);
      SpreadsheetApp.flush(); // Hata etiketini de anında işle ki sonsuz döngüye girmesin
    }
  }
}

function sendTelegramNotification(from, to, subject, aiResult) {
  const badge = aiResult.status === "CRITICAL" ? "🔴 <b>CRITICAL</b>" : "🟡 <b>IMPORTANT</b>";
  
  let pointsText = "";
  if (aiResult.key_points && aiResult.key_points.length > 0) {
    pointsText = aiResult.key_points.map((p) => `• ${p}`).join("\n");
  } else {
    pointsText = "• Detay ayıklanamadı.";
  }

  // Telegram HTML Parse Modu Güvenlik Temizliği
  const cleanFrom = from.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cleanTo = to.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cleanSubject = subject.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const messageText = `${badge} <b>YENİ MAİL</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📩 <b>Alıcı:</b> ${cleanTo}\n` +
                      `👤 <b>Gönderen:</b> ${cleanFrom}\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📝 <b>Konu:</b> ${cleanSubject}\n\n` +
                      `🔑 <b>ÖNEMLİ NOKTALAR:</b>\n${pointsText}\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚡ <b>GEREKEN AKSİYON:</b> ${aiResult.action_required}`;

  const telegramUrl = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  
  const payload = {
    "chat_id": TELEGRAM_CHAT_ID,
    "text": messageText,
    "parse_mode": "HTML"
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  UrlFetchApp.fetch(telegramUrl, options);
}
