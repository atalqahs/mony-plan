import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as A from '../js/actions.js';
import { parseKD, fmtKD } from '../js/money.js';

const KD = (s) => parseKD(String(s));
const TODAY = '2026-11-05'; // أكتوبر ونوفمبر مفتوحان، سبتمبر مغلق
const fresh = () => E.createSeedState('2026-11-01T00:00:00.000Z');
const line = (st, month, id, today = TODAY) =>
  E.simulate(st, { today, until: month }).byKey[month].lines.find((l) => l.id === id);
const ok = (err) => assert.equal(err, null, err);

test('المال: تحويل دقيق بدون أرقام عائمة', () => {
  assert.equal(parseKD('1,729.650'), 1729650);
  assert.equal(parseKD('702.15'), 702150);
  assert.equal(parseKD('٧٠٢٫١٥'), 702150);
  assert.equal(parseKD('0.1') + parseKD('0.2'), parseKD('0.3'));
  assert.ok(Number.isNaN(parseKD('1.2345')));
  assert.ok(Number.isNaN(parseKD('abc')));
  assert.equal(fmtKD(1729650), '1,729.650');
  assert.equal(fmtKD(-340000), '−340.000');
});

test('البيانات الأولية: لا توجد أي دفعة مؤكدة والموعد الأصلي محسوب', () => {
  const st = fresh();
  assert.equal(st.payments.length, 0);
  assert.equal(st.baseline.endMonth, '2027-05');
  for (const d of E.debtsOf(st)) assert.equal(d.closedConfirmed, false);
});

test('1–3: دفع 160 بدل 500 ← عجز 340، سداد 200 ← 140، سداد 50 ← 90', () => {
  const st = fresh();
  ok(A.setPlan(st, '2026-11', 'violations', KD(500)));
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-11', amount: KD(160), date: '2026-11-25' }, { today: TODAY }));
  const nov = line(st, '2026-11', 'violations');
  assert.equal(nov.status, 'partial');
  assert.equal(line(st, '2026-12', 'violations').arrStart, KD(340));

  ok(A.addPayment(st, { itemId: 'violations', month: '2026-12', kind: 'arrears', amount: KD(200), date: '2026-12-23' }, { today: TODAY }));
  assert.equal(line(st, '2026-12', 'violations').arrRemaining, KD(140));
  assert.equal(line(st, '2027-01', 'violations').arrStart, KD(140));

  ok(A.addPayment(st, { itemId: 'violations', month: '2027-01', kind: 'arrears', amount: KD(50), date: '2027-01-23' }, { today: TODAY }));
  assert.equal(line(st, '2027-02', 'violations').arrStart, KD(90));

  // كل دفعة تُخصم من الرصيد الحقيقي مرة واحدة فقط
  assert.equal(E.debtStatus(st, E.itemById(st, 'violations')).remaining, KD(3672) - KD(160) - KD(200) - KD(50));
  // لا يمكن سداد أكثر من العجز المتبقي
  assert.notEqual(A.addPayment(st, { itemId: 'violations', month: '2027-02', kind: 'arrears', amount: KD(91), date: '2027-02-23' }, { today: TODAY }), null);
});

test('4: عجز جديد لنفس القرض يُدمج دون ازدواج', () => {
  const st = fresh();
  A.setPlan(st, '2026-11', 'violations', KD(500));
  A.addPayment(st, { itemId: 'violations', month: '2026-11', amount: KD(160), date: '2026-11-25' }, { today: TODAY });
  A.addPayment(st, { itemId: 'violations', month: '2026-12', kind: 'arrears', amount: KD(200), date: '2026-12-23' }, { today: TODAY });
  A.addPayment(st, { itemId: 'violations', month: '2027-01', kind: 'arrears', amount: KD(50), date: '2027-01-23' }, { today: TODAY });
  // يناير: المخطط 252.150 والمدفوع 100 ← عجز جديد 152.150
  ok(A.addPayment(st, { itemId: 'violations', month: '2027-01', amount: KD(100), date: '2027-01-24' }, { today: TODAY }));
  assert.equal(line(st, '2027-02', 'violations').arrStart, KD(90) + KD('152.150'));
  // العجز ليس دينًا جديدًا: الرصيد = الأصلي − المدفوع فقط
  const feb = line(st, '2027-02', 'violations');
  assert.equal(feb.balStart, KD(3672) - KD(537.8) - KD(164) - KD(160) - KD(200) - KD(50) - KD(100) - KD(702.15));
});

test('5: إغلاق قرض مبكرًا يلغي أقساطه المستقبلية', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(940), date: '2026-11-25' }, { today: TODAY }));
  assert.equal(E.debtStatus(st, E.itemById(st, 'small')).remaining, 0);
  const sim = E.simulate(st, { today: TODAY, until: '2027-06' });
  for (const k of ['2026-12', '2027-01', '2027-02', '2027-03']) {
    assert.equal(sim.byKey[k].lines.find((l) => l.id === 'small'), undefined, k);
  }
  // دفعة أكبر من الرصيد مرفوضة
  assert.notEqual(A.addPayment(st, { itemId: 'small', month: '2026-12', amount: KD(1), date: '2026-12-25' }, { today: TODAY }), null);
  ok(A.confirmClose(st, 'small'));
});

test('6: تعديل دفعة قديمة يعيد حساب كل الأشهر التالية', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-09', amount: KD(537.8), date: '2026-09-25' }, { today: TODAY }));
  assert.equal(line(st, '2026-10', 'violations').arrStart, 0);
  const balBefore = line(st, '2027-02', 'violations').balStart;
  const pid = st.payments[0].id;
  ok(A.updatePayment(st, pid, { amount: KD(300) }, { today: TODAY }));
  assert.equal(st.payments[0].id, pid);
  assert.equal(line(st, '2026-10', 'violations').arrStart, KD(237.8));
  // أكتوبر مفتوح: المحرك يتوقع سداد العجز من السيولة، فيبقى رصيد فبراير كما هو
  assert.equal(line(st, '2027-02', 'violations').balStart, balBefore);
  // لو أُغلق أكتوبر دون سداد، يبقى العجز ويُرحّل
  assert.equal(line(st, '2026-11', 'violations', '2026-11-25').arrStart, KD(237.8) + KD(164));
});

test('7: سيناريو 500 شهريًا لا يغير الخطة الفعلية ويقرّب الموعد', () => {
  const st = fresh();
  const before = JSON.stringify(st);
  const r = E.runScenario(st, { type: 'monthly', amount: KD(500), start: '2026-11' }, TODAY);
  assert.equal(JSON.stringify(st), before);
  assert.ok(r.scenarioEnd < r.currentEnd, `${r.scenarioEnd} < ${r.currentEnd}`);
  assert.ok(r.diffMonths < 0);
  // الاعتماد فقط عند الطلب
  ok(A.adoptScenario(st, { type: 'monthly', amount: KD(500), start: '2026-11' }));
  assert.equal(E.simulate(st, { today: TODAY }).endMonth, r.scenarioEnd);
});

test('8: شراء فيزا يوم 15 ثم 16 يقع في دورتين مختلفتين', () => {
  const st = fresh();
  ok(A.addVisaPurchase(st, { date: '2026-11-15', amount: KD(400) }));
  ok(A.addVisaPurchase(st, { date: '2026-11-16', amount: KD(50) }));
  assert.equal(E.visaCycleEnd('2026-11-15'), '2026-11-15');
  assert.equal(E.visaCycleEnd('2026-11-16'), '2026-12-15');
  const vs = E.visaSummary(st, '2026-11-20');
  assert.deepEqual(vs.pending, [{ cycleEnd: '2026-11-15', amount: KD(400) }]);
  ok(A.confirmStatement(st, '2026-11-15', '2026-11-20'));
  // مشتريات جديدة لا تغيّر الكشف المثبت
  ok(A.addVisaPurchase(st, { date: '2026-11-20', amount: KD(30) }));
  const vs2 = E.visaSummary(st, '2026-11-20');
  assert.equal(vs2.last.amount, KD(400));
  assert.equal(vs2.currentCyclePurch, KD(80));
  assert.equal(vs2.used, KD(480));
  assert.equal(vs2.available, KD(520));
  // لا يمكن تثبيت كشف قبل موعده
  assert.notEqual(A.confirmStatement(st, '2026-12-15', '2026-11-20'), null);
});

test('8ب: إذا كان التطبيق مغلقًا يوم 15 تبقى الدورة بانتظار التثبيت', () => {
  const st = fresh();
  A.addVisaPurchase(st, { date: '2026-11-10', amount: KD(100) });
  A.addVisaPurchase(st, { date: '2026-12-01', amount: KD(70) });
  const vs = E.visaSummary(st, '2027-01-03');
  assert.deepEqual(vs.pending.map((p) => p.cycleEnd), ['2026-11-15', '2026-12-15']);
});

test('9: سداد الفيزا كاملًا يعيد المتاح للحد مع الحفاظ على السجل', () => {
  const st = fresh();
  A.addVisaPurchase(st, { date: '2026-11-15', amount: KD(400) });
  A.confirmStatement(st, '2026-11-15', '2026-11-16');
  ok(A.addVisaPayment(st, { date: '2026-11-25', amount: KD(150) }, '2026-11-25'));
  let vs = E.visaSummary(st, '2026-11-25');
  assert.equal(vs.dueUnpaid, KD(250));
  assert.equal(vs.available, KD(750));
  ok(A.addVisaPayment(st, { date: '2026-11-26', amount: KD(250) }, '2026-11-26'));
  vs = E.visaSummary(st, '2026-11-26');
  assert.equal(vs.available, KD(1000));
  assert.equal(vs.used, 0);
  assert.equal(vs.dueUnpaid, 0);
  assert.equal(st.visa.statements.length, 1);
  assert.equal(st.visa.purchases.length, 1);
  assert.equal(st.visa.payments.length, 2);
  // لا يمكن سداد أكثر من المستخدم
  assert.notEqual(A.addVisaPayment(st, { date: '2026-11-27', amount: KD(1) }, '2026-11-27'), null);
  // الفيزا لا تدخل في إجمالي الديون
  assert.equal(E.dashboard(st, E.simulate(st, { today: TODAY })).original, KD(11725));
});

test('10: بدل الإيجار يُحتسب مرة واحدة فقط في شهر استحقاقه', () => {
  const st = fresh();
  // تغيير موعد وصول إيجار نوفمبر إلى ديسمبر لا ينقله لميزانية ديسمبر
  ok(A.setIncome(st, '2026-11', 'rent', { date: '2026-12-02', received: true, receivedDate: '2026-12-02' }));
  const sim = E.simulate(st, { today: TODAY, until: '2027-02' });
  const sal = KD('1729.650'); const rent = KD(150);
  assert.equal(sim.byKey['2026-11'].income.planned, sal + rent);
  assert.equal(sim.byKey['2026-12'].income.planned, sal + rent);
  assert.equal(sim.byKey['2026-11'].income.received, rent);
  assert.equal(sim.byKey['2026-12'].income.received, 0);
  // مجموع الدخل لكل الأشهر = عدد الأشهر × (راتب + إيجار) بلا تكرار
  const months = sim.months.filter((m) => m.key <= '2027-02');
  assert.equal(months.reduce((a, m) => a + m.income.planned, 0), months.length * (sal + rent));
  // الإيجار المستحق لنوفمبر يظهر بتاريخ وصول في الشهر التالي
  assert.equal(E.rentFor(fresh(), '2026-11').date, '2026-12-01');
});

test('10ب: الدخل غير المؤكد لا يدخل الخطة حتى يُستلم', () => {
  const st = fresh();
  const end0 = E.simulate(st, { today: TODAY }).endMonth;
  ok(A.addExtra(st, { month: '2026-11', name: 'مكافأة', amount: KD(3000), status: 'pending' }));
  assert.equal(E.simulate(st, { today: TODAY }).endMonth, end0);
  ok(A.updateExtra(st, st.extras[0].id, { status: 'received' }));
  assert.ok(E.simulate(st, { today: TODAY }).endMonth <= end0);
  assert.equal(E.simulate(st, { today: TODAY, until: '2026-11' }).byKey['2026-11'].income.received, KD(3000));
});

test('12: إجمالي الديون يستثني الخادمة والفواتير والمصروف والجامعة', () => {
  const st = fresh();
  const d = E.dashboard(st, E.simulate(st, { today: TODAY }));
  assert.equal(d.original, KD(5510) + KD(3672) + KD(940) + KD(559) + KD(550) + KD(24) + KD(20) + KD(450));
  assert.equal(d.original, KD(11725));
  assert.equal(d.paid, 0);
  assert.equal(d.remaining, d.original);
  // نسبة الإنجاز من المبالغ المسددة
  A.addPayment(st, { itemId: 'p_electric', month: '2026-11', amount: KD(20), date: '2026-11-25' }, { today: TODAY });
  A.addPayment(st, { itemId: 'maid', month: '2026-11', amount: KD(140), date: '2026-11-25' }, { today: TODAY });
  const d2 = E.dashboard(st, E.simulate(st, { today: TODAY }));
  assert.equal(d2.paid, KD(20));
});

test('13: الشؤون تظهر ابتداءً من أكتوبر فقط', () => {
  const st = fresh();
  const sim = E.simulate(st, { today: TODAY, until: '2027-03' });
  assert.equal(sim.byKey['2026-09'].lines.find((l) => l.id === 'shuoon'), undefined);
  assert.equal(sim.byKey['2026-10'].lines.find((l) => l.id === 'shuoon').planned, KD(137.5));
  assert.equal(sim.byKey['2027-02'].lines.find((l) => l.id === 'shuoon').planned, KD(9));
  assert.equal(sim.byKey['2027-03'].lines.find((l) => l.id === 'shuoon'), undefined);
});

test('14: التعثر يمدد الخطة لأشهر إضافية ويظهر العجز المالي', () => {
  const st = fresh();
  const end0 = E.simulate(st, { today: TODAY }).endMonth;
  for (const m of ['2027-03', '2027-04', '2027-05']) ok(A.setIncome(st, m, 'salary', { amount: KD(300) }));
  const sim = E.simulate(st, { today: TODAY });
  assert.ok(sim.endMonth > end0, `${sim.endMonth} > ${end0}`);
  assert.ok(sim.byKey['2027-03'].fundingGap > 0 || sim.byKey['2027-04'].fundingGap > 0);
  const d = E.dashboard(st, sim);
  assert.ok(d.deltaMonths > 0);
});

test('14ب: شهر مغلق دون دفع يرحّل المخطط كاملًا كعجز وينبّه للقسط الإلزامي', () => {
  const st = fresh();
  const sep = line(st, '2026-09', 'furniture');
  assert.equal(sep.belowMandatory, true);
  assert.equal(line(st, '2026-10', 'furniture').arrStart, KD(460));
  // المصروف الشخصي غير قابل للترحيل
  assert.equal(line(st, '2026-10', 'personal').arrStart, 0);
  assert.equal(line(st, '2026-10', 'maid').arrStart, KD(140));
});

test('الدفعات الإضافية لا تلغي القسط الإجباري التالي', () => {
  const st = fresh();
  A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(1000), date: '2026-11-25' }, { today: TODAY });
  assert.equal(line(st, '2026-12', 'furniture').planned, KD(460));
});

test('السداد الإضافي يقرّب موعد الإغلاق', () => {
  const st = fresh();
  for (const m of ['2026-09', '2026-10']) {
    for (const l of E.simulate(st, { today: TODAY, until: m }).byKey[m].lines) {
      if (l.planned > 0) A.addPayment(st, { itemId: l.id, month: m, amount: l.planned, date: `${m}-25` }, { today: TODAY });
    }
  }
  const end0 = E.simulate(st, { today: TODAY }).endMonth;
  A.addExtra(st, { month: '2026-11', name: 'مكافأة', amount: KD(4000), status: 'received' });
  A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(4000), date: '2026-11-25' }, { today: TODAY });
  const end1 = E.simulate(st, { today: TODAY }).endMonth;
  assert.ok(end1 < end0, `${end1} < ${end0}`);
});

test('تصحيح الرصيد يُسجَّل مع السبب', () => {
  const st = fresh();
  assert.notEqual(A.addAdjustment(st, 'small', KD(900), ''), null);
  ok(A.addAdjustment(st, 'small', KD(900), 'كشف البنك'));
  assert.equal(E.debtStatus(st, E.itemById(st, 'small')).remaining, KD(900));
  assert.equal(st.adjustments[0].reason, 'كشف البنك');
});

test('إزالة علامة الصح تحذف الدفعة الأساسية وتعيد الحساب', () => {
  const st = fresh();
  A.addPayment(st, { itemId: 'furniture', month: '2026-09', amount: KD(460), date: '2026-09-25' }, { today: TODAY });
  assert.equal(line(st, '2026-09', 'furniture').status, 'done');
  ok(A.clearRegular(st, 'furniture', '2026-09'));
  assert.equal(line(st, '2026-09', 'furniture').status, 'none');
  assert.equal(line(st, '2026-10', 'furniture').arrStart, KD(460));
});

test('الحتمية: نفس العمليات بنفس النتيجة بغض النظر عن ترتيب الإدخال', () => {
  const a = fresh(); const b = fresh();
  const ops = [
    { itemId: 'violations', month: '2026-11', amount: KD(160), date: '2026-11-25' },
    { itemId: 'furniture', month: '2026-09', amount: KD(460), date: '2026-09-25' },
  ];
  ops.forEach((o) => A.addPayment(a, o, { today: TODAY }));
  [...ops].reverse().forEach((o) => A.addPayment(b, o, { today: TODAY }));
  const sa = E.simulate(a, { today: TODAY }); const sb = E.simulate(b, { today: TODAY });
  assert.equal(sa.endMonth, sb.endMonth);
  assert.deepEqual(sa.months.map((m) => m.cashEnd), sb.months.map((m) => m.cashEnd));
});
