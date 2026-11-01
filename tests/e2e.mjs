// اختبار واجهة حقيقي (Chromium بمحاكاة iPhone — ليس Safari): يحتاج خادمًا محليًا على PORT (افتراضي 8765).
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
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let dialogMode = 'accept';
const dialogs = [];
p.on('dialog', (d) => { dialogs.push(d.message()); return dialogMode === 'dismiss' ? d.dismiss() : d.accept(); });
const step = (n) => console.log('✓', n);
const S = () => p.evaluate(() => window.__mfp.state);
const tab = async (t) => { await p.click(`[data-act="tab"][data-t="${t}"]`); };
const go = async (t, m) => { await p.evaluate(([tt, mm]) => { localStorage.setItem('mfp-tab', tt); if (mm) localStorage.setItem('mfp-view-month', mm); }, [t, m]); await p.reload(); await p.waitForSelector('#tabbar .tab'); };
const closeSheet = () => p.click('.sheet [data-close]');

await p.goto(URL);
await p.waitForSelector('.hero');

/* ── البداية ── */
assert.equal((await S()).payments.length, 0);
assert.ok((await p.textContent('.hero')).includes('11,725.000'));
assert.ok((await p.textContent('.hero')).includes('غير مُدخلة'), 'السيولة غير المُدخلة لا تُعرض صفرًا');
assert.equal(await p.locator('.banner').count(), 1, 'تنبيه واحد فقط في الرئيسية');
step('الرئيسية: 4 أرقام فقط، السيولة «غير مُدخلة» بدل صفر، وتنبيه واحد');

/* ── سداد سهيل التاريخي من الواجهة ── */
await tab('debts');
await p.click('.li [data-act="pay"][data-id="p_suhail"]');
await p.fill('.sheet [name="date"]', '2026-08-15');
await p.dispatchEvent('.sheet [name="date"]', 'change');
const impact = await p.textContent('.sheet [data-impact]');
assert.ok(impact.includes('سداد سابق') && impact.includes('سيُغلق الدين') && impact.includes('سبتمبر'), impact);
await p.click('.sheet [data-a="pay"]');
let st = await S();
const suhail = st.payments.find((x) => x.itemId === 'p_suhail');
assert.deepEqual([suhail.amount, suhail.date, suhail.month], [550000, '2026-08-15', '2026-09']);
await p.reload(); await p.waitForSelector('#tabbar .tab');
const after = await p.evaluate(() => { const { E, state, today } = window.__mfp; const s = E.simulate(state, { today }); return { rem: E.debtStatus(state, E.itemById(state, 'p_suhail')).remaining, novPaid: s.byKey[s.F].actualOut, novCash: s.byKey[s.F].cashStart, end: s.endMonth }; });
assert.deepEqual([after.rem, after.novPaid, after.novCash], [0, 0, 0]);
step('سهيل 550 بتاريخ أغسطس: «سداد سابق»، خطة سبتمبر، الدين صفر بعد إعادة التحميل، ولا أثر على سيولة الشهر الحالي');

// سداد حالي يظهر أثره «حالي»
await tab('debts');
await p.click('.li [data-act="pay"][data-id="p_abuosama"]');
assert.ok((await p.textContent('.sheet [data-impact]')).includes('سداد حالي'));
await closeSheet();
step('السداد بتاريخ اليوم يُعرض «سداد حالي: سيُخصم من سيولتك»');

/* ── العجز 340 ← 140 ← 90 (الخطة) ── */
await go('plan', '2026-11');
await p.click('.li [data-act="cell-detail"][data-id="violations"] >> nth=0');
await p.fill('.sheet [name="planned"]', '500');
await p.click('.sheet [data-a="save-plan"]');
await p.click('.li .chk[data-id="violations"]');
await p.fill('.sheet [name="amount"]', '160');
await p.click('.sheet [data-a="pay"]');
await p.click('[data-act="next"]');
assert.ok((await p.textContent('[aria-label="العجز"]')).includes('340.000'));
await p.fill('[aria-label="العجز"] [data-arr-in="violations"]', '200');
await p.click('[aria-label="العجز"] [data-act="arrears-inline"][data-id="violations"]');
await p.click('[data-act="next"]');
assert.ok((await p.textContent('[aria-label="العجز"]')).includes('140.000'));
await p.fill('[aria-label="العجز"] [data-arr-in="violations"]', '50');
await p.click('[aria-label="العجز"] [data-act="arrears-inline"][data-id="violations"]');
await p.click('[data-act="next"]');
assert.ok((await p.textContent('[aria-label="العجز"]')).includes('90.000'));
assert.equal((await p.textContent('.li:has([data-act="cell-detail"][data-id="violations"]) .amt .a')).trim(), '760.650');
step('العجز 340 ← 140 ← 90 في مربع مستقل، والقسط الأساسي لفبراير 760.650 منفصل');

/* ── الفيزا من قسم الديون ── */
await go('debts');
await p.click('[data-act="visa"]');
await p.click('.sheet [data-v="buy"]');
await p.fill('.sheet [name="amount"]', '400');
await p.fill('.sheet [name="date"]', '2026-10-15');
await p.click('.sheet [data-a="save"]');
assert.ok((await p.textContent('[aria-label="الفيزا"]')).includes('400.000'), 'المستخدم 400 وليس الحد');
await tab('home');
assert.ok((await p.textContent('.banner')).includes('كشف الفيزا'));
step('الفيزا: المستخدم 400 (لا الحد 1,000)، والكشف الفائت يظهر كتنبيه واحد');

/* ── الحفظ وإعادة الفتح ── */
await p.waitForTimeout(200);
await p.reload(); await p.waitForSelector('.hero');
st = await S();
assert.equal(st.payments.length, 4);
assert.equal(st.visa.purchases.length, 1);
assert.equal(st.months['2026-11'].plan.violations, 500000);
step('البيانات محفوظة بعد إعادة فتح التطبيق');

/* ── ترحيل بيانات قديمة (سهيل منسوب لنوفمبر) ── */
const v4 = await p.evaluate(() => {
  const s = JSON.parse(JSON.stringify(window.__mfp.state));
  s.schema = 4; s.payments.find((x) => x.itemId === 'p_suhail').month = '2026-11';
  s.savedAt = '2999-01-01T00:00:00.000Z';
  localStorage.setItem('mfp-state-v1', JSON.stringify(s));
  return s.payments.map((x) => [x.id, x.amount, x.date]);
});
await p.reload(); await p.waitForSelector('.hero');
st = await S();
assert.equal(st.schema, 5);
assert.deepEqual(st.payments.map((x) => [x.id, x.amount, x.date]), v4);
assert.equal(st.payments.find((x) => x.itemId === 'p_suhail').month, '2026-09');
step('ترحيل البيانات القديمة: لا فقد ولا تكرار، وسداد سهيل المؤرخ أغسطس يُنسب لسبتمبر');

/* ── ماذا لو؟ (المزيد) ── */
const beforeWi = JSON.stringify((await S()).payments);
await p.click('[data-act="more"]');
await p.click('.sheet [data-m="whatif"]');
await p.fill('.sheet [data-sc="amount"]', '500');
await p.waitForSelector('#wi-result .sumrow');
assert.equal(JSON.stringify((await S()).payments), beforeWi);
assert.equal(((await S()).recurring || []).length, 0);
await closeSheet();
step('«ماذا لو؟» في المزيد ولا يغيّر الخطة');

/* ── دون اتصال ── */
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.waitForSelector('.hero');
await ctx.setOffline(true);
await p.reload(); await p.waitForSelector('.hero');
await ctx.setOffline(false);
step('يفتح دون إنترنت بعد أول تحميل');

/* ── الأرقام المعروضة = المحرك ── */
await go('home');
const homeMismatch = await p.evaluate(() => {
  const { E, fmtKD, today, state } = window.__mfp;
  const s = E.simulate(state, { today });
  const d = E.dashboard(state, s);
  const out = [];
  const big = document.querySelector('.hero .big-m .m-v .num').textContent.trim();
  if (big !== fmtKD(d.remaining)) out.push(`remaining ${big}`);
  return out;
});
assert.deepEqual(homeMismatch, []);
await go('plan', '2026-12');
const planMismatch = await p.evaluate(() => {
  const { E, fmtKD, today, state } = window.__mfp;
  const s = E.simulate(state, { today, until: '2027-03' });
  const m = s.byKey['2026-12'];
  const out = [];
  for (const l of m.lines.filter((x) => x.planned > 0 || x.paidReg > 0)) {
    const a = document.querySelector(`.li [data-act="cell-detail"][data-id="${l.id}"].amt .a`)?.textContent.trim();
    if (a !== fmtKD(l.planned)) out.push(`${l.id} ${a} != ${fmtKD(l.planned)}`);
  }
  for (const l of m.lines.filter((x) => x.arrStartC - x.paidArr > 0)) if (!document.querySelector('[aria-label="العجز"]').textContent.includes(fmtKD(l.arrStartC - l.paidArr))) out.push(`arr ${l.id}`);
  return out;
});
assert.deepEqual(planMismatch, []);
step('الأرقام المعروضة مطابقة للمحرك (الرئيسية، الخطة، العجز)');

/* ── منع التكرار والضغط المزدوج ── */
await go('debts');
const n0 = (await S()).payments.length;
for (let i = 0; i < 2; i++) {
  await p.click('.li [data-act="pay"][data-id="p_abuosama"]');
  await p.fill('.sheet [name="amount"]', '10');
  await p.click('.sheet [data-a="pay"]');
}
assert.ok(dialogs.some((m) => m.includes('مطابقة')));
assert.equal((await S()).payments.length, n0 + 2, 'الثانية حُفظت بعد التأكيد الصريح');
dialogMode = 'dismiss';
await p.click('.li [data-act="pay"][data-id="p_abuosama"]');
await p.fill('.sheet [name="amount"]', '10');
await p.click('.sheet [data-a="pay"]');
dialogMode = 'accept';
assert.equal((await S()).payments.length, n0 + 2, 'المرفوض لم يُحفظ');
await closeSheet();
await p.click('.li [data-act="pay"][data-id="p_abuosama"]');
await p.fill('.sheet [name="amount"]', '7');
await p.evaluate(() => { const bt = document.querySelector('.sheet [data-a="pay"]'); bt.click(); bt.click(); bt.click(); });
assert.equal((await S()).payments.length, n0 + 3, 'ضغط ثلاثي = عملية واحدة');
await p.reload(); await p.waitForSelector('#tabbar .tab');
assert.equal((await S()).payments.length, n0 + 3);
step('منع التكرار (تأكيد صريح أو رفض) والضغط المتكرر يحفظ مرة واحدة، حتى بعد إعادة الفتح');

/* ── السجل: بحث + تعديل خاطئ متكرر لا يغيّر شيئًا + حذف ── */
await go('log');
await p.fill('[data-search]', 'سهيل');
assert.equal(await p.locator('#log-list .li').count(), 1);
await p.fill('[data-search]', '');
const target = (await S()).payments.find((x) => x.itemId === 'violations' && x.month === '2026-11' && x.kind === 'regular');
const snap = async () => JSON.stringify({ p: (await S()).payments, l: (await S()).log.length });
const s0 = await snap();
for (const [amt, date] of [['-5', null], ['99999', null], ['0', null], ['160', ''], ['160', '2026-12-31']]) {
  await p.click(`#log-list [data-act="edit-pay"][data-id="${target.id}"]`);
  await p.fill('.sheet [name="amount"]', amt);
  if (date !== null) await p.fill('.sheet [name="date"]', date);
  await p.click('.sheet [data-a="save"]');
  await p.waitForSelector('.toast.err');
  assert.equal(await snap(), s0, `إدخال خاطئ ${amt}/${date}`);
  await closeSheet();
}
await p.click(`#log-list [data-act="edit-pay"][data-id="${target.id}"]`);
await p.fill('.sheet [name="amount"]', '150');
await p.click('.sheet [data-a="save"]');
await p.reload(); await p.waitForSelector('#tabbar .tab');
assert.equal((await S()).payments.find((x) => x.id === target.id).amount, 150000);
const lastAbu = (await S()).payments.filter((x) => x.itemId === 'p_abuosama').pop();
await p.click(`#log-list [data-act="edit-pay"][data-id="${lastAbu.id}"]`);
await p.click('.sheet [data-a="del"]');
assert.ok(!(await S()).payments.some((x) => x.id === lastAbu.id));
step('السجل: بحث، 5 تعديلات خاطئة لا تغيّر شيئًا، تعديل صحيح يبقى بعد إعادة الفتح، وحذف');

/* ── انقطاع وبيانات تالفة ── */
const n1 = (await S()).payments.length;
await go('debts');
await p.click('.li [data-act="pay"][data-id="p_abuosama"]');
await p.fill('.sheet [name="amount"]', '3');
await p.click('.sheet [data-a="pay"]');
await p.reload(); await p.waitForSelector('#tabbar .tab');
assert.equal((await S()).payments.length, n1 + 1);
await p.evaluate(() => localStorage.setItem('mfp-state-v1', '{"items":[tr'));
await p.reload(); await p.waitForSelector('#tabbar .tab');
assert.equal((await S()).payments.length, n1 + 1);
assert.ok(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mfp-state-v1-unreadable-'))));
step('إعادة تحميل فورية بعد الحفظ لا تفقد العملية؛ نسخة تالفة لا تُنشئ بيانات فوقها');

/* ── عرض iPhone ── */
const checkLayout = async (label) => p.evaluate((lbl) => {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) out.push(`${lbl}: تمرير أفقي ${de.scrollWidth - de.clientWidth}px`);
  for (const el of document.querySelectorAll('.card, .hero, .metric, .li, .sumrow, .banner')) {
    if (el.scrollWidth > el.clientWidth + 1) out.push(`${lbl}: محتوى يتجاوز ${el.className} (${el.textContent.trim().slice(0, 30)})`);
  }
  // آخر عنصر قابل للضغط لا يختفي خلف شريط الأقسام
  window.scrollTo(0, de.scrollHeight);
  const bar = document.querySelector('#tabbar').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#app button, #app input')].filter((x) => x.offsetParent);
  const last = btns[btns.length - 1];
  if (last && last.getBoundingClientRect().bottom > bar.top + 1) out.push(`${lbl}: آخر زر مغطى بشريط الأقسام`);
  return out;
}, label);
const issues = [];
for (const w of [320, 375, 390, 414, 430]) {
  await p.setViewportSize({ width: w, height: w === 320 ? 568 : 844 });
  for (const [t, m] of [['home'], ['debts'], ['plan', '2026-09'], ['plan', '2027-01'], ['log']]) {
    await go(t, m);
    issues.push(...await checkLayout(`${w}px ${t}${m ? ` ${m}` : ''}`));
  }
  await go('debts');
  for (const sel of ['[data-act="more"]', '.li [data-act="pay"][data-id="furniture"]', '.li [data-act="item"][data-id="p_abuosama"]', '[data-act="visa"]']) {
    await p.click(sel);
    await p.waitForSelector('.sheet');
    const over = await p.evaluate(() => { const sh = document.querySelector('.sheet'); const r = sh.getBoundingClientRect(); return { x: sh.scrollWidth - sh.clientWidth, fits: r.top >= 0 }; });
    if (over.x > 0) issues.push(`${w}px ورقة ${sel} أعرض من الشاشة`);
    if (!over.fits) issues.push(`${w}px ورقة ${sel} أطول من الشاشة`);
    await closeSheet();
  }
}
assert.deepEqual(issues, []);
step('iPhone 320/375/390/414/430: لا تمرير أفقي، لا محتوى يتجاوز البطاقات، الأزرار لا تختفي خلف الشريط، والأوراق تتسع');

assert.deepEqual(errors, []);
await b.close();
console.log('e2e ok');
