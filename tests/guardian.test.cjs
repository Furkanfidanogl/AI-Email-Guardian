const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "Code.js"), "utf8");
const ctx = vm.createContext({
  console, Logger: { log() {} },
  PropertiesService: {}, GmailApp: {}, UrlFetchApp: {}, Utilities: {}
});
vm.runInContext(script, ctx);

function run(expr) { return vm.runInContext(expr, ctx); }

test("payment ₺179,99/ay remains exact", () => {
  const source = run('buildEvidence("Google One","Google AI Pro (5 TB)\\nToplam Abonelik Ücreti:\\n₺179,99/ay\\nKDV ₺30,00\\nMastercard-4031")');
  ctx.source = source;
  const price = source.rows.find(row => row.text === "₺179,99/ay");
  const ai = {
    title_tr: "Google One",
    status: "IMPORTANT", category: "PAYMENT",
    points: [{text:"Toplam abonelik ücreti ₺179,99/ay.",evidence_ids:[price.id]}],
    has_action: false, action_text:"", action_evidence_ids:[]
  };
  ctx.ai = ai;
  const output = run('finalizeAnalysis(ai, source, {subject:"Google One",from:"Google Play"})');
  assert.match(output.points[0], /₺179,99\/ay/);
  assert.equal(output.action, "");
});

test("invented 17.999 TL is never displayed", () => {
  ctx.source = run('buildEvidence("Google One","₺179,99/ay\\nMastercard-4031")');
  const price = ctx.source.rows.find(row => row.text === "₺179,99/ay");
  ctx.ai = {
    title_tr:"Google One",status:"IMPORTANT",category:"PAYMENT",
    points:[{text:"17.999 TL tahsil edildi.",evidence_ids:[price.id]}],
    has_action:false,action_text:"",action_evidence_ids:[]
  };
  const output = run('finalizeAnalysis(ai,source,{subject:"Google One",from:"Google Play"})');
  assert.doesNotMatch(output.points.join(" "), /17\.999/);
  assert.match(output.points[0], /179,99/);
});

test("source snippet saves useful text when AI invents a year", () => {
  ctx.source = run('buildEvidence("Midas analizi: ASELS","ASELS için boğa ve ayı senaryoları değerlendirildi.")');
  ctx.ai = {
    title_tr:"Midas analizi: ASELS",status:"NORMAL",category:"MARKET",
    points:[{text:"2026 hedef fiyatı açıklandı.",evidence_ids:["E1"]}],
    has_action:false,action_text:"",action_evidence_ids:[]
  };
  const output = run('finalizeAnalysis(ai,source,{subject:"Midas analizi: ASELS",from:"Midas"})');
  assert.doesNotMatch(output.points.join(" "), /2026/);
  assert.match(output.points[0], /boğa ve ayı/);
});

test("action appears independently of priority", () => {
  ctx.source = run('buildEvidence("Etkinlik","Kaydınızı 5 Kasım 2026 tarihine kadar tamamlayın.")');
  ctx.ai = {
    title_tr:"Etkinlik",status:"NORMAL",category:"OTHER",
    points:[{text:"Kayıt son tarihi 5 Kasım 2026.",evidence_ids:["E1"]}],
    has_action:true,
    action_text:"Kaydınızı 5 Kasım 2026 tarihine kadar tamamlayın.",
    action_evidence_ids:["E1"]
  };
  const output = run('finalizeAnalysis(ai,source,{subject:"Etkinlik",from:"Organizasyon"})');
  assert.match(output.action, /5 Kasım 2026/);
  assert.equal(output.status, "NORMAL");
});

test("no forced actions when not required", () => {
  ctx.source = run('buildEvidence("Günlük bülten","Piyasa gelişmeleri değerlendirildi.")');
  ctx.ai = {
    title_tr:"Günlük bülten",status:"NORMAL",category:"TECH",
    points:[{text:"Piyasa gelişmeleri değerlendirildi.",evidence_ids:["E1"]}],
    has_action:false,action_text:"",action_evidence_ids:[]
  };
  const output = run('finalizeAnalysis(ai,source,{subject:"Günlük bülten",from:"Ziraat Yatırım"})');
  assert.equal(output.action, "");
  assert.equal(output.category, "MARKET");
});

test("tracking links removed before trimming", () => {
  ctx.raw = "Bilgi " + "https://example.com/" + "x".repeat(5000) + " Toplam: ₺179,99/ay";
  const clean = run('cleanMailText(raw)');
  assert.match(clean, /₺179,99\/ay/);
  assert.doesNotMatch(clean, /xxxxx/);
});

test("card last four digits cannot become a TL charge", () => {
  assert.equal(run('supportedMoneyClaims("4031 TL alındı","Mastercard-4031")'), false);
});

test("numeric safety Apps Script entrypoint", () => {
  assert.doesNotThrow(() => run("testNumericSafety()"));
});


test("currency + amount must match, including Turkish lirası", () => {
  assert.equal(run('supportedMoneyClaims("₺179,99", "€179,99")'), false);
  assert.equal(run('supportedMoneyClaims("179,99 Türk Lirası", "€179,99 ve ₺50,00")'), false);
  assert.equal(run('supportedMoneyClaims("179,99 TL", "₺179,99")'), true);
});

test("charge must never be rendered as refund", () => {
  ctx.source = run('buildEvidence("Ödeme","₺179,99 ödeme alındı.")');
  const id = ctx.source.rows.find(row => row.text.includes("179,99")).id;
  ctx.ai = {
    title_tr: "Ödeme", status: "IMPORTANT", category: "PAYMENT",
    points: [{ text: "₺179,99 iade edildi.", evidence_ids: [id] }],
    has_action: false, action_text: "", action_evidence_ids: []
  };
  const result = run('finalizeAnalysis(ai,source,{subject:"Ödeme",from:"Google Play"})');
  assert.doesNotMatch(result.points[0], /iade edildi/);
  assert.match(result.points[0], /ödeme alındı/);
});

test("rejected application cannot become accepted", () => {
  ctx.source = run('buildEvidence("Staj sonucu","Staj başvurunuz olumsuz sonuçlanmıştır.")');
  const id = ctx.source.rows.find(row => row.text.includes("olumsuz")).id;
  ctx.ai = {
    title_tr:"Staj sonucu", status:"CRITICAL", category:"CAREER",
    points:[{text:"Staj başvurunuz kabul edildi.",evidence_ids:[id]}],
    has_action:false, action_text:"", action_evidence_ids:[]
  };
  const result=run('finalizeAnalysis(ai,source,{subject:"Staj sonucu",from:"İK"})');
  assert.doesNotMatch(result.points[0], /kabul edildi/);
  assert.match(result.points[0], /olumsuz/);
});
