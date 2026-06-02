const scriptProperties = PropertiesService.getScriptProperties();
const GEMINI_API_KEY = scriptProperties.getProperty('GEMINI_KEY');
const TELEGRAM_BOT_TOKEN = scriptProperties.getProperty('TG_TOKEN');
const TELEGRAM_CHAT_ID = scriptProperties.getProperty('TG_CHAT_ID');

function checkAndProcessEmails() {
  const labelName = "gemini-processed";
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }

  const threads = GmailApp.search("in:inbox -label:" + labelName);
  
  if (threads.length === 0) {
    Logger.log("Yeni veya işlenmemiş mail bulunamadı.");
    return;
  }

  const systemPrompt = `You are Furkan's premium personal AI executive. Furkan is a Computer Engineering student, an Android Developer (Kotlin, Compose), and the founder of 'Crux AI Summarize'.
Your job is to digest emails so perfectly that he won't even need to open them.

Classify the email into:
1. "CRITICAL": Breaking tech updates, API switches (especially Gemini/Firebase/Google Play console alerts), security breaches, billing issues, or direct interview invites/technical tests from companies.
2. "IMPORTANT": Direct human-to-human project/job inquiries, automated application status updates from companies he actually applied to. (If unsure, default to IMPORTANT).
3. "IGNORE": Generic newsletters, job alerts ("Positions matching your profile"), marketing, social media notifications.

You MUST respond ONLY with a valid JSON object matching this structure exactly (Use Turkish for text fields):
{
  "status": "CRITICAL" or "IMPORTANT" or "IGNORE",
  "category": "API_UPDATE / INTERNSHIP / SECURITY / DIRECT_MAIL / OTHER",
  "summary": "A punchy, standalone summary of the email in Turkish (max 15 words).",
  "key_points": [
    "Crucial point 1 from the email in Turkish",
    "Crucial point 2 from the email in Turkish"
  ],
  "action_required": "Clear next step for Furkan in Turkish. What does he need to do?"
}`;

  const batchSize = Math.min(threads.length, 10);

  for (let i = 0; i < batchSize; i++) {
    const messages = threads[i].getMessages();
    const lastMessage = messages[messages.length - 1];
    
    const from = lastMessage.getFrom();
    const to = lastMessage.getTo(); 
    const subject = lastMessage.getSubject();
    const body = lastMessage.getPlainBody().substring(0, 6000); 

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + GEMINI_API_KEY;
    
    const payload = {
      "contents": [{
        "parts": [
          {"text": systemPrompt},
          {"text": `ANALİZ EDİLECEK MAİL:\nKimden: ${from}\nKime: ${to}\nKonu: ${subject}\nİçerik:\n${body}`}
        ]
      }],
      "generationConfig": {
        "responseMimeType": "application/json"
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
      const jsonResponse = JSON.parse(response.getContentText());
      
      if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) {
        throw new Error("Gemini geçerli bir yanıt üretemedi.");
      }
      
      const aiResultText = jsonResponse.candidates[0].content.parts[0].text;
      const aiResult = JSON.parse(aiResultText);

      if (aiResult.status === "CRITICAL" || aiResult.status === "IMPORTANT") {
        sendTelegramNotification(from, to, subject, aiResult);
      }

      threads[i].addLabel(label);

    } catch (e) {
      Logger.log("HATA OLUŞTU (Sonraki turda tekrar denenecek): " + e.toString());
    }
  }
}

function sendTelegramNotification(from, to, subject, aiResult) {
  const badge = aiResult.status === "CRITICAL" ? "🔴 [CRITICAL]" : "🟡 [IMPORTANT]";
  
  let pointsText = "";
  if (aiResult.key_points && aiResult.key_points.length > 0) {
    pointsText = aiResult.key_points.map((p, index) => index === 0 ? `• ${p}` : `• ${p}`).join("\n");
  } else {
    pointsText = "• Detay ayıklanamadı.";
  }

  const messageText = `${badge} YENİ MAİL>\n` +
                      ` ━━━━━━━━━━━━━━━━━━━━\n` +
                      `📩 Alıcı: ${to}\n` +
                      `👤 Gönderen: ${from}\n` +
                      `📝 Konu: ${subject}\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📌 ÖZET: > ${aiResult.summary}\n` +
                      `🔑 ÖNEMLİ NOKTALAR: > \n${pointsText}\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚡ GEREKEN AKSİYON: > ${aiResult.action_required}`;

  const telegramUrl = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  
  const payload = {
    "chat_id": TELEGRAM_CHAT_ID,
    "text": messageText
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  UrlFetchApp.fetch(telegramUrl, options);
}
