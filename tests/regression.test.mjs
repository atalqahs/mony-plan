// اختبارات انحدار للأخطاء المثبتة في جولة «FINAL BUG FIX».
// node --test tests/regression.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as A from '../js/actions.js';
import { parseKD } from '../js/money.js';
import { verify, compare } from './verifier.mjs';

const KD = (s) => parseKD(String(s));
const T = '2026-11-05';
const fresh = () => E.createSeedState('2026-11-01T00:00:00.000Z');
const ok = (e) => assert.equal(e, null, e);
const snap = (st) => JSON.stringify(st);
const unchanged = (st, before, label) => assert.equal(snap(st), before, `${label}: تغيّرت الحالة رغم رفض العملية`);
const same = (st, today = T) => { for (const ah of [false, true]) assert.deepEqual(compare(E.simulate(st, { today, assumeHistory: ah }), verify(st, { today, assumeHistory: ah })), []); };

/* ═════════ 1) updatePayment ذرّية ═════════ */
test('updatePayment: أي رفض لا يغيّر الحالة إطلاقًا (العدد، الأرصدة، السجل، المعرّفات، الترتيب)', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05', opId: 'op-a' }, { today: T }));
  ok(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(170), date: '2026-11-04', opId: 'op-b' }, { today: T }));
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-09', amount: KD(537.8), dateUnknown: true }, { today: T }));
  const [p1, p2, p3] = st.payments.map((p) => p.id);
  const before = snap(st);
  const remainingBefore = E.debtsOf(st).map((d) => E.debtStatus(st, d).remaining);
  const bad = [
    [p1, { date: '2026-02-30' }, 'تاريخ غير حقيقي'],
    [p1, { date: '2026-13-01' }, 'شهر غير صالح'],
    [p1, { date: 'abc' }, 'نص'],
    [p1, { date: '' }, 'تاريخ فارغ لا يتحول لـ«غير معروف» ضمنيًا'],
    [p1, { date: null }, 'null'],
    [p1, { amount: -1 }, 'مبلغ سالب'],
    [p1, { amount: 0 }, 'صفر'],
    [p1, { amount: 1.5 }, 'كسر غير صحيح'],
    [p1, { amount: KD(5511) }, 'يتجاوز الرصيد'],
    [p1, { date: '2026-11-30' }, 'مؤكد بتاريخ مستقبلي'],
    [p1, { dateUnknown: true }, 'تاريخ غير معروف لشهر حالي'],
    [p1, { month: '2026-1' }, 'شهر مالي غير صالح'],
    [p1, { itemId: 'nope' }, 'بند غير موجود'],
    [p2, { amount: KD(500) }, 'سداد إضافي جزئي للقرض الصغير'],
    [p3, { amount: KD(3673) }, 'دفعة تاريخية تتجاوز الرصيد'],
    ['missing-id', { amount: 1 }, 'دفعة غير موجودة'],
  ];
  for (let round = 0; round < 3; round++) { // الإدخال الخاطئ المتكرر
    for (const [id, patch, label] of bad) {
      const err = A.updatePayment(st, id, patch, { today: T });
      assert.notEqual(err, null, `${label}: كان يجب الرفض`);
      unchanged(st, before, label);
    }
  }
  assert.deepEqual(E.debtsOf(st).map((d) => E.debtStatus(st, d).remaining), remainingBefore);
  assert.deepEqual(st.payments.map((p) => [p.id, p.opId]), [[p1, 'op-a'], [p2, 'op-b'], [p3, undefined]]);
});

test('updatePayment: التعديل الناجح يبقى في الموضع نفسه ويحفظ المعرّفات ويضيف سطر سجل واحدًا', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05', opId: 'op-a' }, { today: T }));
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-09', amount: KD(537.8), dateUnknown: true }, { today: T }));
  const logLen = st.log.length;
  const { id, createdAt } = st.payments[0];
  ok(A.updatePayment(st, id, { amount: KD(400), date: '2026-11-04' }, { today: T }));
  assert.equal(st.payments.length, 2);
  assert.equal(st.payments[0].id, id);
  assert.equal(st.payments[0].createdAt, createdAt);
  assert.equal(st.payments[0].opId, 'op-a');
  assert.equal(st.payments[0].amount, KD(400));
  assert.equal(st.log.length, logLen + 1);
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5110));
  // الدفعة التاريخية تبقى «تاريخ غير معروف» عند تعديل المبلغ فقط
  ok(A.updatePayment(st, st.payments[1].id, { amount: KD(500) }, { today: T }));
  assert.equal(st.payments[1].date, null);
  // ويمكن إعطاؤها تاريخًا صراحة
  ok(A.updatePayment(st, st.payments[1].id, { date: '2026-09-28' }, { today: T }));
  assert.equal(st.payments[1].date, '2026-09-28');
  assert.equal(st.payments[1].dateUnknown, undefined);
  // الحفظ وإعادة التحميل (تسلسل JSON) لا يغيّر شيئًا
  const reloaded = E.migrate(JSON.parse(JSON.stringify(st))).state;
  assert.deepEqual(reloaded.payments, st.payments);
  same(st);
});

/* ═════════ 2) الذرّية العامة: transact وكل العمليات ═════════ */
test('transact: الاستثناء أو الخطأ في منتصف العملية لا يترك تعديلًا جزئيًا', () => {
  const st = fresh();
  const before = snap(st);
  const err = A.transact(st, (d) => {
    A.addPayment(d, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05' }, { today: T });
    d.months['2026-11'].plan.furniture = 1;
    throw new Error('انقطاع');
  });
  assert.match(err, /خطأ غير متوقع/);
  unchanged(st, before, 'استثناء');
  const err2 = A.transact(st, (d) => { A.closeMonth(d, '2026-09', true, T); return 'فشل لاحق'; });
  assert.equal(err2, 'فشل لاحق');
  unchanged(st, before, 'خطأ لاحق');
  ok(A.transact(st, (d) => A.closeMonth(d, '2026-09', true, T)));
  assert.equal(st.months['2026-09'].closed, true);
});

test('كل عملية مرفوضة تترك الحالة كما هي بالضبط', () => {
  const st = fresh();
  ok(A.addVisaPurchase(st, { date: '2026-11-01', amount: KD(900) }, T));
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05', confirmed: false }, { today: T }));
  ok(A.addAdjustment(st, 'furniture', KD(200), 'اختبار', T)); // الدفعة المعلقة (460) أصبحت تتجاوز الرصيد
  const pend = st.payments[0].id;
  const before = snap(st);
  const attempts = [
    () => A.setPlan(st, '2030-01', 'furniture', -5),
    () => A.setPlan(st, '2026-1', 'furniture', 5),
    () => A.setPlan(st, '2026-11', 'nope', 5),
    () => A.setDueDate(st, '2026-11', 'furniture', '2026-02-30'),
    () => A.setDueDate(st, '2026-11', 'furniture', '2026-10-31'),
    () => A.setDueDate(st, '2026-11', 'furniture', '2027-01-01'),
    () => A.setDueDate(st, '2026-11', 'nope', '2026-11-25'),
    () => A.setIncome(st, '2026-11', 'salary', { amount: -1 }),
    () => A.setIncome(st, '2026-11', 'salary', { received: true }),
    () => A.setIncome(st, '2026-11', 'salary', { received: true, receivedDate: '2026-02-30' }),
    () => A.setIncome(st, '2026-11', 'salary', { allocMonth: '2026-12' }),
    () => A.setIncome(st, '2026-13', 'rent', { amount: 1 }),
    () => A.addExtra(st, { month: '2026-11', amount: 0 }),
    () => A.addExtra(st, { month: '2026-11', amount: 5, date: '2026-02-30' }),
    () => A.updateExtra(st, 'nope', { amount: 1 }),
    () => A.addItem(st, { type: 'debt', name: 'x', opening: 0 }),
    () => A.addItem(st, { type: 'debt', name: 'x', opening: 5, start: '2026-1' }),
    () => A.addItem(st, { type: 'weird', name: 'x', amount: 1 }),
    () => A.updateItem(st, 'furniture', { extra: 'whatever' }),
    () => A.updateItem(st, 'furniture', { start: 'x' }),
    () => A.updateItem(st, 'furniture', { opening: KD(1) }),
    () => A.setExpenseFrom(st, 'bills', 'x', 1),
    () => A.addAdjustment(st, 'furniture', -1, 'x'),
    () => A.addAdjustment(st, 'furniture', KD(5), ''),
    () => A.confirmClose(st, 'furniture'),
    () => A.confirmPayment(st, pend, undefined, T),
    () => A.confirmPayment(st, pend, '2026-02-30', T),
    () => A.addVisaPurchase(st, { date: '2026-11-02', amount: KD(101) }, T),
    () => A.addVisaPurchase(st, { date: '2026-11-01', amount: KD(900) }, T),
    () => A.updateVisaPurchase(st, st.visa.purchases[0].id, { amount: KD(1001) }, T),
    () => A.addVisaPayment(st, { date: '2026-11-03', amount: KD(901) }, T),
    () => A.confirmStatement(st, '2026-02-30', T),
    () => A.confirmStatement(st, '2026-12-15', T),
    () => A.closeMonth(st, '2026-1', true, T),
    () => A.closeMonth(st, '2026-11', true, '2026-02-30'),
    () => A.setCash(st, { amount: -1, date: T }, T),
    () => A.setCash(st, { amount: 1, date: '2026-12-01' }, T),
    () => A.holdReserve(st, 'res_uni', '2027-01-23', T),
    () => A.holdReserve(st, 'nope', T, T),
    () => A.updateReserve(st, 'res_uni', { targetMonth: '2026-12' }),
    () => A.setVerified(st, 'nope', true),
    () => A.setPayoffPriority(st, ['furniture', 'furniture']),
    () => A.adoptScenario(st, { type: 'monthly', amount: KD(5), start: '2027-02', end: '2027-01' }),
    () => A.deletePayment(st, 'nope'),
    () => A.deleteItem(st, 'nope'),
    () => A.clearRegular(st, 'violations', '2026-11'),
  ];
  for (const [i, f] of attempts.entries()) {
    const err = f();
    assert.notEqual(err, null, `محاولة #${i} كان يجب رفضها`);
    unchanged(st, before, `محاولة #${i}`);
  }
});

/* ═════════ 3) تواريخ الاستحقاق ═════════ */
test('setDueDate: تاريخ حقيقي، نطاق واضح، تنبيه خارج النافذة، ولا احتساب مرتين', () => {
  const st = fresh();
  assert.equal(A.dueDateCheck(st, '2026-11', '2026-02-30').ok, false);
  assert.equal(A.dueDateCheck(st, '2026-11', '2026-10-31').ok, false, 'قبل شهر الخطة');
  assert.equal(A.dueDateCheck(st, '2026-11', '2027-01-01').ok, false, 'بعد الشهر التالي');
  assert.deepEqual(A.dueDateCheck(st, '2026-11', '2026-11-25'), { ok: true, warning: null });
  assert.deepEqual(A.dueDateCheck(st, '2026-11', '2026-12-02'), { ok: true, warning: null }, 'بدل الإيجار الواصل بداية ديسمبر داخل نافذة نوفمبر');
  assert.match(A.dueDateCheck(st, '2026-11', '2026-11-10').warning, /قبل نافذة/);
  assert.match(A.dueDateCheck(st, '2026-11', '2026-12-25').warning, /بعد نهاية نافذة/);
  // نقل الاستحقاق إلى ديسمبر لا يكرر الالتزام
  const base = E.simulate(st, { today: T, until: '2027-02' });
  ok(A.setDueDate(st, '2026-11', 'violations', '2026-12-05'));
  const after = E.simulate(st, { today: T, until: '2027-02' });
  assert.deepEqual(after.months.map((m) => [m.key, m.plannedTotal, m.cashEnd, m.debtBalancesEnd.violations]), base.months.map((m) => [m.key, m.plannedTotal, m.cashEnd, m.debtBalancesEnd.violations]));
  const d = E.dailyLedger(st, after, T);
  assert.equal(d.events.filter((e) => e.type === 'due' && e.id === 'violations').length, 1);
  assert.equal(d.events.find((e) => e.type === 'due' && e.id === 'violations').month, '2026-11');
  assert.ok(!d.undated.some((u) => u.id === 'violations' && u.month === '2026-11'));
  // إزالة التاريخ
  ok(A.setDueDate(st, '2026-11', 'violations', null));
  assert.equal(st.months['2026-11'].dueDates.violations, undefined);
});

/* ═════════ 4) الاحتياطي في الدفتر اليومي ═════════ */
const balAround = (d, pred) => {
  const i = d.events.findIndex(pred);
  return { before: i > 0 ? d.events[i - 1].balAfter : 0, after: d.events[i].balAfter, e: d.events[i] };
};

test('يومي: دفع الجامعة فعليًا من احتياطي محجوز لا يُخصم من النقد مرة ثانية', () => {
  const st = fresh();
  ok(A.holdReserve(st, 'res_uni', '2027-01-23', '2027-02-05'));
  ok(A.addPayment(st, { itemId: 'uni', month: '2027-02', amount: KD(450), date: '2027-02-03' }, { today: '2027-02-05' }));
  const sim = E.simulate(st, { today: T });
  const d = E.dailyLedger(st, sim, T);
  const hold = balAround(d, (e) => e.type === 'fund' && e.r === 'res_uni');
  assert.equal(hold.before - hold.after, KD(450), 'الحجز يخرج من النقد مرة');
  const pay = balAround(d, (e) => e.type === 'fact' && e.label.includes('الجامعة'));
  assert.equal(pay.before - pay.after, 0, 'الدفع من الاحتياطي لا يخرج من النقد مرة ثانية');
  assert.deepEqual(d.potLog.res_uni.map((x) => [x.date, x.in || 0, x.out || 0, x.balance]), [['2027-01-23', KD(450), 0, KD(450)], ['2027-02-03', 0, KD(450), 0]]);
  // المحرك الشهري يتفق
  assert.equal(sim.byKey['2027-02'].lines.find((l) => l.id === 'uni').potCover, KD(450));
  same(st);
});

test('يومي: استخدامان لنفس الاحتياطي — يُخصم كل استخدام من رصيده، ولا يُستخدم المبلغ مرتين', () => {
  const st = fresh();
  ok(A.setPlan(st, '2027-02', 'uni', KD(600))); // الرسوم 600 والاحتياطي 450
  ok(A.addPayment(st, { itemId: 'uni', month: '2027-02', amount: KD(300), date: '2027-02-03' }, { today: '2027-02-05' }));
  ok(A.addPayment(st, { itemId: 'uni', month: '2027-02', amount: KD(200), date: '2027-02-04' }, { today: '2027-02-05' }));
  const sim = E.simulate(st, { today: T });
  assert.equal(sim.byKey['2027-02'].lines.find((l) => l.id === 'uni').potCover, KD(450), 'المحرك: الاحتياطي يغطي 450 من 500 مدفوعة');
  const d = E.dailyLedger(st, sim, T);
  assert.deepEqual(d.potLog.res_uni.map((x) => [x.date, x.in || 0, x.out || 0, x.balance]), [
    ['2027-01-22', KD(300), 0, KD(300)], ['2027-02-01', KD(150), 0, KD(450)],
    ['2027-02-03', 0, KD(300), KD(150)], ['2027-02-04', 0, KD(150), 0],
  ]);
  const second = balAround(d, (e) => e.type === 'fact' && e.date === '2027-02-04');
  assert.equal(second.before - second.after, KD(50), 'الاستخدام الثاني: 150 من الاحتياطي و50 فقط من النقد');
  assert.equal(d.potLog.res_uni.reduce((a, x) => a + (x.out || 0), 0), KD(450), 'لا يُصرف من الاحتياطي أكثر مما دخله');
  same(st);
});

test('يومي: تمويل غير كافٍ يوم الاستحقاق — نقص بقيمة الجزء غير الواصل', () => {
  const st = fresh();
  ok(A.setIncome(st, '2027-01', 'rent', { date: '2027-02-15' }));
  ok(A.setDueDate(st, '2027-02', 'uni', '2027-02-10'));
  const d = E.dailyLedger(st, E.simulate(st, { today: T }), T);
  const s = d.shortfalls.find((x) => x.id === 'uni' && x.reserve);
  assert.equal(s.short, KD(150));
  assert.equal(s.date, '2027-02-10');
});

test('يومي وشهري: احتياطيان في الوقت نفسه — لا يستخدم أحدهما لبند الآخر', () => {
  const st = fresh();
  // احتياطي ثانٍ محجوز فعليًا في 2 نوفمبر (100) لخادمة مارس — متاح قبل استحقاق الجامعة
  st.reserves.push({ id: 'res_maid', name: 'احتياطي الخادمة', month: '2026-11', amount: KD(100), targetItem: 'maid', targetMonth: '2027-03', heldDate: '2026-11-02',
    sources: [{ kind: 'salary', ofMonth: '2026-10', amount: KD(100) }] });
  ok(A.setCash(st, { amount: KD(100), date: '2026-11-01' }, T));
  ok(A.setIncome(st, '2027-01', 'rent', { date: '2027-02-15' }));
  ok(A.setDueDate(st, '2027-02', 'uni', '2027-02-10'));
  ok(A.setDueDate(st, '2027-03', 'maid', '2027-03-25'));
  const sim = E.simulate(st, { today: T });
  same(st);
  assert.equal(sim.byKey['2027-02'].lines.find((l) => l.id === 'uni').potCover, KD(450));
  assert.equal(sim.byKey['2027-03'].lines.find((l) => l.id === 'maid').potCover, KD(100));
  const d = E.dailyLedger(st, sim, T);
  const uni = d.shortfalls.find((x) => x.id === 'uni' && x.reserve);
  assert.equal(uni.short, KD(150), 'رغم وجود 100 في احتياطي الخادمة يوم 10 فبراير');
  assert.equal(d.potLog.res_maid.find((x) => x.out)?.date, '2027-03-25');
  assert.equal(d.potLog.res_maid.reduce((a, x) => a + (x.out || 0), 0), KD(100));
});

/* ═════════ 5) الترحيل والتخزين ═════════ */
test('migrate: لا يعدّل المُدخل، ويرفض البنية غير الصالحة دون أثر', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05' }, { today: T }));
  const old = JSON.parse(JSON.stringify(st));
  old.schema = 2; delete old.reserves; delete old.settings.cash;
  const frozen = JSON.stringify(old);
  const { state: m } = E.migrate(old);
  assert.equal(JSON.stringify(old), frozen, 'المُدخل لم يتغير');
  assert.equal(m.schema, E.SCHEMA);
  assert.deepEqual(m.payments, st.payments);
  assert.throws(() => E.migrate({}), /غير صالحة/);
  assert.throws(() => E.migrate({ items: [], payments: 'x' }), /غير صالحة/);
});

/* ═════════ 6) الخطة المرجعية ═════════ */
test('الخطة المرجعية تبقى صحيحة بعد الإصلاحات (أكتوبر 9,031.700 ← مايو 0.000، شاملًا أبو أسامة)', () => {
  const st = fresh();
  const hist = (id, m, fils) => ok(A.addPayment(st, { itemId: id, month: m, amount: fils, dateUnknown: true }, { today: T }));
  for (const [m, vals] of Object.entries({ '2026-09': { furniture: 460, violations: 537.8, small: 170 }, '2026-10': { furniture: 460, violations: 164, small: 170, shuoon: 137.5 } })) {
    for (const [id, v] of Object.entries(vals)) hist(id, m, KD(v));
    for (const id of ['maid', 'bills', 'personal']) hist(id, m, E.expenseAmountFor(E.itemById(st, id), m));
  }
  hist('p_suhail', '2026-09', KD(550)); hist('p_shafiq', '2026-09', KD(24)); hist('p_electric', '2026-09', KD(20));
  for (const m of ['2026-09', '2026-10']) ok(A.closeMonth(st, m, true, T));
  const sim = E.simulate(st, { today: T });
  same(st);
  const ref = { '2026-10': '9031.700', '2026-11': '7562.050', '2026-12': '6092.400', '2027-01': '5072.750', '2027-02': '3753.100', '2027-03': '2133.450', '2027-04': '663.800', '2027-05': '0.000' };
  for (const [m, v] of Object.entries(ref)) assert.equal(Object.values(sim.byKey[m].debtBalancesEnd).reduce((a, b) => a + Math.max(0, b), 0), KD(v), m);
  assert.equal(sim.byKey['2027-05'].debtBalancesEnd.p_abuosama, 0);
  assert.equal(sim.allDebtsEndMonth, '2027-05');
});

/* ═════════ سداد تاريخي (سهيل / شفيق / الكهربائي) ═════════ */
const NOW = '2026-11-01';
test('سهيل 550 بتاريخ أغسطس 2026: يُنسب لبداية الخطة، الدين صفر، والسيولة والموعد لا يتغيران — وبعد إعادة التحميل', () => {
  const st = fresh();
  ok(A.setCash(st, { amount: KD(1000), date: NOW }, NOW));
  const cash0 = E.actualCash(st, NOW).amount;
  const base = E.simulate(st, { today: NOW });
  const inf = A.inferPlanMonth(st, 'p_suhail', '2026-08-15', NOW);
  assert.deepEqual([inf.month, inf.sure, inf.before], ['2026-09', true, true], 'لا يُستخدم الشهر الحالي ولا نوفمبر');
  assert.equal(A.paymentImpact(st, '2026-08-15', NOW).historical, true, 'سداد سابق');
  ok(A.addPayment(st, { itemId: 'p_suhail', month: inf.month, amount: KD(550), date: '2026-08-15' }, { today: NOW }));
  const reloaded = E.migrate(JSON.parse(JSON.stringify(st))).state; // حفظ وإعادة فتح
  for (const s of [st, reloaded]) {
    assert.equal(E.debtStatus(s, E.itemById(s, 'p_suhail')).remaining, 0);
    assert.equal(s.payments[0].date, '2026-08-15', 'التاريخ الحقيقي محفوظ');
    assert.equal(E.actualCash(s, NOW).amount, cash0, 'السيولة الفعلية لم تتغير');
    const sm = E.simulate(s, { today: NOW });
    assert.deepEqual(sm.months.filter((m) => m.forecast).map((m) => [m.key, m.cashEnd, m.fundingGap]), base.months.filter((m) => m.forecast).map((m) => [m.key, m.cashEnd, m.fundingGap]));
    assert.equal(sm.endMonth, base.endMonth, 'لا يؤخر الإغلاق');
    assert.equal(sm.byKey['2026-11'].actualOut, 0, 'لا يظهر كمدفوع من نوفمبر');
    assert.equal(sm.byKey['2026-09'].lines.find((l) => l.id === 'p_suhail').paidReg, KD(550));
    const d = E.dailyLedger(s, sm, NOW);
    assert.ok(!d.events.some((e) => e.type === 'fact' && e.label.includes('سهيل') && e.date > sm.anchorDate));
  }
  same(st, NOW);
});

test('شفيق 24 والكهربائي 20 سدادًا تاريخيًا: نفس المنطق، والإجمالي ينخفض 594 مع سهيل', () => {
  const st = fresh();
  const total0 = E.dashboard(st, E.simulate(st, { today: NOW })).remaining;
  for (const [id, a, d] of [['p_suhail', 550, '2026-08-15'], ['p_shafiq', 24, '2026-08-20'], ['p_electric', 20, '2026-07-02']]) {
    const inf = A.inferPlanMonth(st, id, d, NOW);
    assert.equal(inf.month, '2026-09');
    ok(A.addPayment(st, { itemId: id, month: inf.month, amount: KD(a), date: d }, { today: NOW }));
  }
  const sm = E.simulate(st, { today: NOW });
  assert.equal(total0 - E.dashboard(st, sm).remaining, KD(594));
  assert.equal(sm.byKey['2026-11'].cashStart, 0);
  same(st, NOW);
});

test('بيانات محفوظة سابقًا: سداد سهيل بتاريخ أغسطس نُسب لنوفمبر ← الترحيل ينسبه لسبتمبر دون فقد', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'p_suhail', month: '2026-11', amount: KD(550), date: '2026-08-15' }, { today: NOW }));
  const old = JSON.parse(JSON.stringify(st)); old.schema = 4;
  const { state: m } = E.migrate(old);
  assert.equal(m.payments.length, 1);
  assert.deepEqual([m.payments[0].id, m.payments[0].amount, m.payments[0].date, m.payments[0].month], [st.payments[0].id, KD(550), '2026-08-15', '2026-09']);
  assert.equal(E.simulate(m, { today: NOW }).byKey['2026-11'].actualOut, 0);
  assert.ok(m.log[m.log.length - 1].text.includes('سهيل'));
});

test('دفعة حالية بعد تاريخ الرصيد تُخصم من السيولة، ودفعة قبل تاريخ الرصيد داخل الفترة لا تُخصم مرة ثانية', () => {
  const st = fresh();
  ok(A.setCash(st, { amount: KD(1000), date: '2026-11-03' }, '2026-11-05'));
  assert.equal(A.paymentImpact(st, '2026-11-04', '2026-11-05').historical, false);
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-04' }, { today: '2026-11-05' }));
  assert.equal(E.actualCash(st, '2026-11-05').amount, KD(540), 'سداد حالي خُصم مرة واحدة');
  assert.equal(A.paymentImpact(st, '2026-11-02', '2026-11-05').historical, true, 'داخل الفترة لكن قبل تاريخ الرصيد: مُضمَّن فيه');
  ok(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(170), date: '2026-11-02' }, { today: '2026-11-05' }));
  assert.equal(E.actualCash(st, '2026-11-05').amount, KD(540));
  assert.equal(E.actualCash(fresh(), NOW), null, 'بلا رصيد مُدخل: لا يُعرض صفر كحقيقة');
  same(st, '2026-11-05');
});

test('استنتاج شهر الخطة: يسأل عند الالتباس فقط', () => {
  const st = fresh();
  assert.deepEqual(A.inferPlanMonth(st, 'furniture', '2026-11-25', NOW).month, '2026-11');
  const amb = A.inferPlanMonth(st, 'furniture', '2026-12-05', NOW);
  assert.equal(amb.sure, false, 'أثاث نوفمبر وديسمبر كلاهما غير مسدد');
  assert.deepEqual(amb.candidates, ['2026-11', '2026-12']);
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-25' }, { today: '2026-11-25' }));
  const now = A.inferPlanMonth(st, 'furniture', '2026-12-05', '2026-12-05');
  assert.deepEqual([now.month, now.sure], ['2026-12', true], 'بعد سداد نوفمبر لا التباس');
  assert.equal(A.inferPlanMonth(st, 'p_abuosama', '2026-12-05', NOW).month, '2026-12', 'لا مبلغ مخطط في أي منهما');
  assert.equal(A.inferPlanMonth(st, 'furniture', '2026-02-30', NOW).month, null);
});
