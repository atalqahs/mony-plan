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

// [23] سلامة العرض على iPhone: لا تمرير أفقي، وكل الأوراق تفتح دون أخطاء
for (const w of [375, 390, 430]) {
  await p.setViewportSize({ width: w, height: 844 });
  for (const m of ['2026-09', '2026-11', '2027-02']) {
    await p.click(`[data-act="month"][data-m="${m}"]`).catch(async () => { await p.evaluate((mm) => localStorage.setItem('mfp-view-month', mm), m); await p.reload(); await p.waitForSelector('.grid'); });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `تمرير أفقي ${over}px عند ${w}px (${m})`);
  }
}
await p.setViewportSize({ width: 390, height: 844 });
for (const sel of ['[data-act="settings"]', '[data-act="add"]', '[data-act="month-close"]', '[data-act="cash"]', '[data-act="income"][data-kind="salary"]', '.li [data-act="item"][data-id="p_abuosama"]', '[data-act="visa-buy"]', '[data-act="visa-pay"]', '[data-act="visa-history"]', '[data-act="log"]']) {
  await p.evaluate(() => localStorage.setItem('mfp-view-month', '2026-11'));
  const el = await p.$(sel);
  if (!el) { await p.reload(); await p.waitForSelector('.grid'); }
  await p.click(sel);
  await p.waitForSelector('.sheet');
  const over = await p.evaluate(() => { const sh = document.querySelector('.sheet'); return sh.scrollWidth - sh.clientWidth; });
  assert.ok(over <= 0, `ورقة ${sel} أعرض من الشاشة`);
  await p.click('.sheet [data-close]');
}
step('[23] العرض على عرض iPhone (375/390/430) بلا تمرير أفقي، وكل الأوراق تعمل');

assert.deepEqual(errors, []);
await b.close();
console.log('e2e ok');
