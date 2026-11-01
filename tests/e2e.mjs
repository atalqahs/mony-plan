// اختبار واجهة حقيقي: يحتاج خادمًا محليًا على PORT (افتراضي 8765) و Playwright.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const URL = `http://localhost:${process.env.PORT || 8765}/`;

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Kuwait' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('dialog', (d) => d.accept());
await p.goto(URL);
await p.waitForSelector('.grid');
const step = (n) => console.log('✓', n);

// يبدأ كل شيء فارغًا
assert.equal(await p.evaluate(() => window.__mfp.state.payments.length), 0);
step('كل علامات الصح فارغة عند البداية');

// اختيار نوفمبر 2026 ثم دفع 160 من المخالفات بعد جعل المخطط 500
await p.click('[data-act="month"][data-m="2026-11"]');
await p.click('.li [data-act="cell-detail"][data-id="violations"] >> nth=0');
await p.fill('.sheet [name="planned"]', '500');
await p.click('.sheet [data-a="save-plan"]');
await p.click('.li .chk[data-id="violations"]');
await p.fill('.sheet [name="amount"]', '160');
await p.click('.sheet [data-a="pay"]');
await p.click('[data-act="next"]');
const arrText = await p.textContent('[aria-label="العجز"]');
assert.ok(arrText.includes('340.000'), arrText);
step('دفع 160 بدل 500 يظهر عجز 340 في ديسمبر');

// سداد 200 من العجز
await p.fill('[aria-label="العجز"] [data-arr-in="violations"]', '200');
await p.click('[aria-label="العجز"] [data-act="arrears-inline"][data-id="violations"]');
await p.click('[data-act="next"]');
assert.ok((await p.textContent('[aria-label="العجز"]')).includes('140.000'));
step('سداد 200 من العجز يرحّل 140 إلى يناير');

// فيزا: شراء ثم إعادة تحميل الصفحة
await p.click('[data-act="visa-buy"]');
await p.fill('.sheet [name="amount"]', '400');
await p.fill('.sheet [name="date"]', '2026-10-15');
await p.click('.sheet [data-a="save"]');
assert.ok((await p.textContent('.banner')).includes('بانتظار التثبيت'));
step('كشف فائت يطلب المراجعة والتثبيت');

await p.waitForTimeout(300);
await p.reload();
await p.waitForSelector('.grid');
const st = await p.evaluate(() => window.__mfp.state);
assert.equal(st.payments.length, 2);
assert.ok((await p.textContent('[aria-label="لوحة الديون"]')).includes('11,725.000'));
assert.equal(st.visa.purchases.length, 1);
assert.equal(st.months['2026-11'].plan.violations, 500000);
step('[11] البيانات محفوظة بعد إعادة فتح التطبيق');

// سداد 50 في يناير ← 90 إلى فبراير، والقسط الأساسي منفصل
await p.fill('[aria-label="العجز"] [data-arr-in="violations"]', '50');
await p.click('[aria-label="العجز"] [data-act="arrears-inline"][data-id="violations"]');
await p.click('[data-act="next"]');
assert.ok((await p.textContent('[aria-label="العجز"]')).includes('90.000'));
const febViol = await p.textContent('.li:has([data-act="cell-detail"][data-id="violations"]) .amt .a');
assert.equal(febViol.trim(), '760.650');
step('سداد 50 في يناير يرحّل 90 إلى فبراير والقسط الأساسي (760.650) منفصل');

// تحديث التطبيق: بيانات محفوظة بصيغة الإصدار 2 تُرحّل دون فقدان أو تكرار
const v2 = await p.evaluate(() => {
  const s = JSON.parse(JSON.stringify(window.__mfp.state));
  s.schema = 2; delete s.settings.cash; delete s.reserves;
  for (const d of s.items) delete d.verified;
  s.months['2026-09'].closeDate = '2026-11-01';
  s.savedAt = '2999-01-01T00:00:00.000Z';
  localStorage.setItem('mfp-state-v1', JSON.stringify(s));
  return { payments: s.payments.map((x) => [x.id, x.amount, x.month, x.kind]), purchases: s.visa.purchases.length, plan: s.months['2026-11'].plan.violations };
});
await p.reload(); await p.waitForSelector('.grid');
const mig = await p.evaluate(() => { const s = window.__mfp.state; return { schema: s.schema, reserves: s.reserves.length, cash: s.settings.cash.amount, closed: s.months['2026-09'].closed, payments: s.payments.map((x) => [x.id, x.amount, x.month, x.kind]), purchases: s.visa.purchases.length, plan: s.months['2026-11'].plan.violations }; });
assert.equal(mig.schema, 3); assert.equal(mig.reserves, 1); assert.equal(mig.cash, 0); assert.equal(mig.closed, true);
assert.deepEqual(mig.payments, v2.payments); assert.equal(mig.purchases, v2.purchases); assert.equal(mig.plan, v2.plan);
step('[21] بيانات الإصدار السابق تُرحّل بعد التحديث دون فقدان أو تكرار');

// ماذا لو؟ لا يغيّر الخطة
const before = JSON.stringify(await p.evaluate(() => window.__mfp.state.payments));
await p.fill('#sc-amount', '500');
await p.waitForSelector('#wi-result .stats');
assert.equal(JSON.stringify(await p.evaluate(() => window.__mfp.state.payments)), before);
assert.equal(await p.evaluate(() => (window.__mfp.state.recurring || []).length), 0);
step('محاكي السيناريو لا يغيّر الخطة دون اعتماد');

// العمل دون إنترنت بعد أول تحميل
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.waitForSelector('.grid');
await ctx.setOffline(true);
await p.reload();
await p.waitForSelector('.grid');
await ctx.setOffline(false);
step('[22] يفتح دون إنترنت بعد أول تحميل');

// الأرقام المعروضة = نتائج المحرك (لكل الأشهر الظاهرة)
const mismatch = await p.evaluate(async () => {
  const { E, fmtKD, today } = window.__mfp;
  const st = window.__mfp.state;
  const out = [];
  const sim = E.simulate(st, { today, until: '2027-03' });
  const dash = E.dashboard(st, sim);
  const txt = document.querySelector('[aria-label="لوحة الديون"] .big .val').textContent.trim();
  if (txt !== fmtKD(dash.remaining)) out.push(`dashboard ${txt} != ${fmtKD(dash.remaining)}`);
  for (const m of ['2026-09', '2026-11', '2026-12', '2027-01', '2027-02']) {
    localStorage.setItem('mfp-view-month', m);
    document.querySelector(`[data-act="month"][data-m="${m}"]`)?.click();
    if (!document.querySelector(`[data-act="month"][data-m="${m}"].sel`)) continue;
    for (const l of sim.byKey[m].lines.filter((x) => x.planned > 0 || x.paidReg > 0)) {
      const row = document.querySelector(`.li [data-act="cell-detail"][data-id="${l.id}"].amt`);
      if (!row) { out.push(`${m} ${l.id} row missing`); continue; }
      const a = row.querySelector('.a').textContent.trim();
      if (a !== fmtKD(l.planned)) out.push(`${m} ${l.id} planned ${a} != ${fmtKD(l.planned)}`);
      if (!row.querySelector('.b').textContent.includes(fmtKD(l.paidReg))) out.push(`${m} ${l.id} paid`);
    }
    const arr = document.querySelector('[aria-label="العجز"]');
    for (const l of sim.byKey[m].lines.filter((x) => x.arrStartC - x.paidArr > 0)) {
      if (!arr || !arr.textContent.includes(fmtKD(l.arrStartC - l.paidArr))) out.push(`${m} arrears ${l.id}`);
    }
    const liq = document.querySelector('[aria-label="السيولة"] .kv.total .v');
    if (liq && sim.byKey[m].cashEnd !== null && liq.textContent.trim() !== fmtKD(sim.byKey[m].cashEnd)) out.push(`${m} cashEnd ${liq.textContent} != ${fmtKD(sim.byKey[m].cashEnd)}`);
  }
  return out;
});
assert.deepEqual(mismatch, []);
step('الأرقام المعروضة مطابقة للمحرك حتى آخر فلس (لوحة، التزامات، عجز، سيولة)');

// تكرار الدفعة يطلب تأكيدًا
const dialogs = [];
p.on('dialog', (d) => dialogs.push(d.message()));
await p.evaluate(() => localStorage.setItem('mfp-view-month', '2026-11')); await p.reload(); await p.waitForSelector('.grid');
for (let i = 0; i < 2; i++) {
  await p.click('.li .chk[data-id="maid"]');
  await p.fill('.sheet [name="amount"]', '10');
  await p.fill('.sheet [name="date"]', await p.evaluate(() => window.__mfp.today));
  await p.click('.sheet [data-a="pay"]');
}
assert.ok(dialogs.some((m) => m.includes('مطابقة')), 'لا تنبيه تكرار');
step('إدخال دفعتين متطابقتين يظهر تنبيه التكرار');

// انقطاع أثناء الحفظ: إعادة تحميل فورية بعد العملية
const nBefore = await p.evaluate(() => window.__mfp.state.payments.length);
await p.click('.li .chk[data-id="bills"]');
await p.fill('.sheet [name="amount"]', '5');
await p.fill('.sheet [name="date"]', await p.evaluate(() => window.__mfp.today));
await Promise.all([p.click('.sheet [data-a="pay"]'), p.waitForTimeout(0)]);
await p.reload(); await p.waitForSelector('.grid');
assert.equal(await p.evaluate(() => window.__mfp.state.payments.length), nBefore + 1);
step('إعادة تحميل فورية بعد الحفظ لا تفقد العملية');

// بيانات تالفة: لا يُنشأ شيء فوقها
const keep = await p.evaluate(() => window.__mfp.state.payments.length);
await p.evaluate(() => localStorage.setItem('mfp-state-v1', '{"items":[tr'));
await p.reload(); await p.waitForSelector('.grid');
assert.equal(await p.evaluate(() => window.__mfp.state.payments.length), keep, 'استُخدمت نسخة IndexedDB السليمة');
assert.ok(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mfp-state-v1-unreadable-'))), 'نسخة من البيانات التالفة محفوظة');
step('نسخة localStorage تالفة: يُحمّل من IndexedDB وتُحفظ نسخة من التالف');

// [23] سلامة العرض على iPhone: لا تمرير أفقي، وكل الأوراق تفتح دون أخطاء
for (const w of [320, 375, 390, 414, 430]) {
  await p.setViewportSize({ width: w, height: 844 });
  for (const m of ['2026-09', '2026-11', '2027-02']) {
    await p.click(`[data-act="month"][data-m="${m}"]`).catch(async () => { await p.evaluate((mm) => localStorage.setItem('mfp-view-month', mm), m); await p.reload(); await p.waitForSelector('.grid'); });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `تمرير أفقي ${over}px عند ${w}px (${m})`);
  }
}
await p.setViewportSize({ width: 390, height: 844 });
for (const sel of ['[data-act="settings"]', '[data-act="add"]', '[data-act="month-close"]', '[data-act="cash"]', '[data-act="income"][data-kind="salary"]', '[data-act="income"][data-kind="rent"]', '.li [data-act="item"][data-id="p_abuosama"]', '.g-name[data-act="item"][data-id="furniture"]', '.li .chk[data-id="violations"]', '[data-act="extra-new"]', '[data-act="quick-pay"]', '[data-act="visa-buy"]', '[data-act="visa-pay"]', '[data-act="visa-history"]', '[data-act="log"]']) {
  await p.evaluate(() => localStorage.setItem('mfp-view-month', '2026-11'));
  const el = await p.$(sel);
  if (!el) { await p.reload(); await p.waitForSelector('.grid'); }
  await p.click(sel);
  await p.waitForSelector('.sheet');
  const over = await p.evaluate(() => { const sh = document.querySelector('.sheet'); return sh.scrollWidth - sh.clientWidth; });
  assert.ok(over <= 0, `ورقة ${sel} أعرض من الشاشة`);
  await p.click('.sheet [data-close]');
}
step('[23] العرض على عروض iPhone (320/375/390/414/430) بلا تمرير أفقي، وكل الأوراق تعمل');

assert.deepEqual(errors, []);
await b.close();
console.log('e2e ok');
