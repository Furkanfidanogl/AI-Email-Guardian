# 🛡️ AI-Email-Guardian: Serverless Email Automation with Gemini 3.1 Flash-Lite

An autonomous, serverless email filtering and dispatching system built with **Google Apps Script**, **Gemini 3.1 Flash-Lite API**, and **Telegram Bot API**. It scans incoming emails every 30 minutes, leverages LLM reasoning to filter out noise, and dispatches clean plain-text alerts for critical updates and career notifications directly to Telegram.

---

## 🚀 Features
- **100% Serverless:** Runs entirely on Google's cloud infrastructure via Google Apps Script. Zero maintenance, zero costs.
- **Intelligent Filtering:** Powered by `gemini-3.1-flash-lite` to classify emails into `CRITICAL`, `IMPORTANT`, or `IGNORE`.
- **Fail-Safe Mechanism:** Emails are only labeled `gemini-processed` after a successful Telegram dispatch. No data loss during API downtimes.
- **Production-Grade Security:** Sensitive keys are securely encrypted using Google's native `PropertiesService`.
- **Robust Plain-Text Output:** Bypasses Telegram parsing vulnerabilities, ensuring 100% stable message delivery.

---

## 🔧 Environment Variables (Script Properties)
Go to **Project Settings ⚙️** -> **Script Properties** in Google Apps Script and add:
- `GEMINI_KEY`: Your Google AI Studio API Key.
- `TG_TOKEN`: Your Telegram Bot Token via `@BotFather`.
- `TG_CHAT_ID`: Your unique Telegram numerical Chat ID via `@userinfobot`.

---

## 📋 Telegram Notification Layout

🔴 [CRITICAL] YENİ MAİL>
 ━━━━━━━━━━━━━━━━━━━━
📩 Alıcı: your-email@gmail.com
👤 Gönderen: Google Play Console <no-reply@google.com>
📝 Konu: Update to Target API Level Requirements
━━━━━━━━━━━━━━━━━━━━
📌 ÖZET: > Google Play, uygulamaların hedef API seviyesini Android 15'e çekmesini zorunlu kılıyor.
🔑 ÖNEMLİ NOKTALAR: > 
• Son güncelleme tarihi 31 Ağustos 2026 olarak belirlenmiş.
• Güncellenmeyen uygulamalar yeni kullanıcılara kapatılacak.
━━━━━━━━━━━━━━━━━━━━
⚡ GEREKEN AKSİYON: > Check and update targetSdkVersion in build.gradle.

---

## ⏱️ Automation Trigger
Configure a **Time-driven trigger** in Google Apps Script to run the `checkAndProcessEmails` function **every 30 minutes**.

---

# 🇹🇷 TÜRKÇE DÖKÜMANTASYON (TURKISH)

**AI-Email-Guardian**, Google Apps Script, Gemini 3.1 Flash-Lite API ve Telegram Bot API kullanılarak geliştirilmiş, sunucusuz (serverless) bir akıllı e-posta filtreleme ve bildirim sistemidir. Her 30 dakikada bir gelen kutusunu tarayarak reklam çöplerini ayıklar; yalnızca kritik teknik güncellemeleri ve kariyer/staj odaklı mailleri doğrudan Telegram'a net bir formatta raporlar.

---

## 🚀 Öne Çıkan Özellikler
- **%100 Sunucusuz (Serverless):** Tamamen Google bulut altyapısı üzerinde çalışır. Sunucu maliyeti ve bakım gerektirmez.
- **Yapay Zeka Süzgeci:** Mailleri `CRITICAL`, `IMPORTANT` veya `IGNORE` olarak sınıflandırmak için yüksek verimli `gemini-3.1-flash-lite` modelini kullanır.
- **Asla Mail Kaçırmaz (Fail-Safe):** Mailleri ancak Telegram bildirimi başarıyla gönderildikten sonra etiketler. Kesintilerde veri kaybı yaşanmaz.
- **Üst Düzey Güvenlik:** API anahtarları kod içine yazılmaz; Google Apps Script'in şifreli `PropertiesService` katmanında saklanır.

---

## 🔧 Kurulum ve Betik Özellikleri (Script Properties)
Google Apps Script ekranında sol menüdeki **Proje Ayarları ⚙️** sekmesine tıklayın. **Betik Özellikleri (Script Properties)** kısmına şu 3 değişkeni ekleyin:
- `GEMINI_KEY`: Google AI Studio'dan aldığınız API Anahtarı.
- `TG_TOKEN`: `@BotFather` aracılığıyla oluşturduğunuz Telegram Bot Tokenı.
- `TG_CHAT_ID`: Telegram'da `@userinfobot` üzerinden aldığınız sayısal kullanıcı ID'niz.

---

## ⏱️ Tetikleyici (Trigger) Ayarı
Apps Script sol menüsündeki **Saat simgesine (Tetikleyiciler)** tıklayın. Sağ alttan **Tetikleyici Ekle** diyerek şu ayarları uygulayın:
- *Çalıştırılacak işlev:* `checkAndProcessEmails`
- *Etkinlik kaynağı:* `Zamana bağlı` (Time-driven)
- *Tetikleyici türü:* `Dakika zamanlayıcı`
- *Dakika aralığı:* `30 dakikada bir`

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
