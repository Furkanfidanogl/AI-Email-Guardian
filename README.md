# AI-Email-Guardian

Gmail → Gemini → Telegram. A lightweight Google Apps Script assistant that flags important messages while preserving the facts that matter.

## What changed (November 2026)

- **Evidence-grounded summaries.** Every AI-generated bullet references one to three specific excerpts from the original email; unsupported numbers are replaced by concise, verbatim source excerpts.
- **Exact amounts and dates.** No AI-generated thousands separators, mathematical guesses or currency conversions. The regression case **₺179,99/ay vs 17.999 TL** is covered by an automated test.
- **No noisy verification notices.** A suspect bullet falls back to the actual evidence, not an alarming "numbers cannot be verified" Telegram message.
- **Natural 1–3 bullet summaries.** More relevant detail on informative messages; no filler just to reach three points.
- **Independent priority and action detection.** "Yapılacak" appears only for supported actionable requests.
- **Clean Telegram UI.** Priority, category, sender, useful summary, conditional action and Gmail deep-link button.
- **Finance is finance.** Market newsletters are classified under PİYASA rather than TEKNOLOJİ when appropriate.
- **Reply-aware deduplication.** Incoming new replies are eligible for processing even after a thread was labeled. Existing historical gemini-processed labels are migrated without replay.
- **Non-destructive processing.** No automatic deletion, archiving, or marking emails as read. Credentials stay in Script Properties.

## Install / update

1. Create a Google Apps Script project, or open your existing one.
2. Replace the entire script file with **Code.js** from this repository.
3. Under **Project Settings → Script Properties**, configure:
   - GEMINI_KEY — Gemini API key
   - TG_TOKEN — Telegram bot token
   - TG_CHAT_ID — target Telegram chat ID
4. Run **testNumericSafety** to verify numeric regression checks without network access.
5. Run **testTelegram** to send one sample message.
6. Keep one time-driven trigger calling **checkAndProcessEmails**. Do not create duplicate triggers.

The repo does **not** deploy to your personal Apps Script project automatically. Copying Code.js into the script editor and saving it is required for production to change.

## How it works

1. GmailApp reads recent inbox threads, including any new replies.
2. Email content is cleaned; long tracking URLs are removed *before* selecting text.
3. Exact source excerpts receive evidence IDs (E0, E1, ...).
4. Gemini Interactions API returns structured summary bullets with evidence IDs.
5. Source checks validate numeric sequences and currency claims against the selected excerpts.
6. A problematic bullet is replaced by a short source excerpt. The whole notification is not discarded.
7. Telegram receives a short HTML-formatted notification with an optional action.
8. The last successful message ID is stored in Script Properties to prevent routine duplicates.

## Run tests locally

Requires Node.js 18+ (no npm install needed):

    node --check Code.js
    node --test tests/guardian.test.cjs

## Reliability boundaries

This is **not guaranteed 100% accurate**. Matching numbers to quoted excerpts reduces numeric hallucinations, but it cannot prove that all paraphrases are semantically faithful or that a payment was actually settled. Always use the original email or official account statement for consequential financial/security decisions.

Telegram delivery and storing the processed ID are separate operations: a crash between them can deliver a duplicate. Gmail search covers recent inbox threads and the configured scan limit, not all possible mail.

## Stack

- Google Apps Script (V8) and GmailApp
- Gemini Interactions API, JSON structured outputs
- Telegram Bot API
- PropertiesService + LockService
- Node.js built-in test runner (local regression tests)

## Türkçe

Bu proje, Gmail'deki e-postaları Gemini ile özetleyip Telegram'a ileten kişisel bir asistandır. Özellikle **yanlış para tutarı**, **uydurulmuş tarih**, **gereksiz "doğrulanamadı" bildirimi** ve **bir kez işlenmiş konuşmadaki yeni mesajın kaçırılması** sorunlarına odaklanır.

Önem seviyesi ile aksiyon ihtiyacı birbirinden bağımsızdır. İşlem gerekmeyen bir e-postada boş bir "Aksiyon" alanı gösterilmez.

**Güvenlik:** API anahtarlarını hiçbir zaman Code.js veya GitHub içine koyma. Yalnızca Google Apps Script Script Properties altında sakla.
