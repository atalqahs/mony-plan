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
  // لو أُقفل أكتوبر (تلقائيًا في 1 ديسمبر) دون سداد، يبقى العجز ويُرحّل
  assert.equal(line(st, '2026-11', 'violations', '2026-12-01').arrStart, KD(237.8) + KD(164));
  // تسجيل دفعات أكتوبر يعيد الحساب فورًا
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-10', amount: KD(164), date: '2026-10-25' }, { today: TODAY }));
  assert.equal(line(st, '2026-11', 'violations', '2026-12-01').arrStart, KD(237.8));
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

/* ───────────── اختبارات المراجعة الثانية ───────────── */

const autoLine = (st, m, id, today = TODAY) => E.simulate(st, { today, until: m }).byKey[m].lines.find((l) => l.id === id);
const payAllPlanned = (st, months) => {
  for (const m of months) {
    for (const l of E.simulate(st, { today: TODAY, until: m }).byKey[m].lines) {
      if (l.planned > 0) ok(A.addPayment(st, { itemId: l.id, month: m, amount: l.planned, date: `${m}-25` }, { today: TODAY }));
    }
  }
};

test('أولوية 1: المخالفات أولًا ثم الأثاث ثم الأشخاص', () => {
  const st = fresh();
  assert.deepEqual(st.settings.payoffPriority, ['violations', 'furniture', 'p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama']);
  const sim = E.simulate(st, { baseline: true });
  const mar = sim.byKey['2027-03'];
  const g = (id) => mar.lines.find((l) => l.id === id);
  assert.equal(g('violations').balEnd, 0, 'المخالفات تُغلق أولًا');
  assert.ok(g('furniture').extraSuggested > 0, 'الفائض بعد المخالفات للأثاث');
  assert.ok(g('furniture').balEnd > 0);
  for (const id of ['p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama']) assert.equal(g(id).regUsed, 0, `${id} لا يُسدد قبل إغلاق الأثاث`);
  // بعد إغلاق الأثاث يبدأ الأشخاص بالترتيب
  const apr = sim.byKey['2027-04'];
  assert.equal(apr.lines.find((l) => l.id === 'furniture').balEnd, 0);
  assert.equal(apr.lines.find((l) => l.id === 'p_suhail').balEnd, 0);
});

test('أولوية 2: لا يوزَّع الفائض على أصغر دين تلقائيًا', () => {
  const st = fresh();
  const mar = E.simulate(st, { baseline: true }).byKey['2027-03'];
  const elec = mar.lines.find((l) => l.id === 'p_electric');
  const furn = mar.lines.find((l) => l.id === 'furniture');
  assert.equal(elec.regUsed, 0, 'الكهربائي (أصغر دين 20) لا يأخذ شيئًا والأثاث قائم');
  assert.ok(furn.balEnd > 0);
});

test('أولوية 3: القرض الصغير لا يُسدد مبكرًا تلقائيًا ولا جزئيًا', () => {
  const st = fresh();
  ok(A.updateItem(st, 'small', { opening: KD(2000) })); // رصيد افتراضي للاختبار فقط
  const sim = E.simulate(st, { baseline: true, until: '2027-06' });
  for (const k of ['2027-03', '2027-04', '2027-05']) {
    const l = sim.byKey[k].lines.find((x) => x.id === 'small');
    assert.equal(l.extraSuggested, 0, k);
    assert.equal(l.planned, KD(170), k);
  }
  // سداد إضافي جزئي مرفوض، والإغلاق الكامل مسموح بقرار المستخدم
  assert.match(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(500), date: '2026-11-25' }, { today: TODAY }) || '', /لا يُسمح بسداد إضافي جزئي/);
  ok(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(170), date: '2026-11-25' }, { today: TODAY }));
  ok(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(1830), date: '2026-11-26' }, { today: TODAY }));
  assert.equal(E.debtStatus(st, E.itemById(st, 'small')).remaining, 0);
});

test('أولوية 4: يمكن تعديل الأولويات من الإعدادات', () => {
  const st = fresh();
  ok(A.setPayoffPriority(st, ['p_electric', 'violations', 'furniture', 'p_suhail', 'p_shafiq', 'p_abuosama']));
  const mar = E.simulate(st, { baseline: true }).byKey['2027-03'];
  assert.equal(mar.lines.find((l) => l.id === 'p_electric').balEnd, 0);
  ok(A.resetPayoffPriority(st));
  assert.equal(st.settings.payoffPriority[0], 'violations');
});

test('أولوية 5: الخطة الأصلية سبتمبر–فبراير لا تتغير بوجود فائض', () => {
  const st = fresh();
  ok(A.addExtra(st, { month: '2026-11', name: 'مبلغ مستلم', amount: KD(3000), status: 'received' }));
  const sim = E.simulate(st, { today: TODAY, until: '2027-02' });
  const exp = { '2026-11': 702.15, '2026-12': 702.15, '2027-01': 252.15, '2027-02': 760.65 };
  for (const [m, v] of Object.entries(exp)) assert.equal(sim.byKey[m].lines.find((l) => l.id === 'violations').planned, KD(v), m);
});

test('بدل الإيجار: دفعة في الشهر التالي تُنسب لخطة الشهر الأصلي', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-11', amount: KD('552.150'), date: '2026-11-23' }, { today: TODAY }));
  ok(A.addPayment(st, { itemId: 'violations', month: '2026-11', amount: KD(150), date: '2026-12-02', note: 'من بدل إيجار نوفمبر' }, { today: TODAY }));
  const today = '2026-12-03';
  const sim = E.simulate(st, { today, until: '2027-01' });
  const nov = sim.byKey['2026-11'].lines.find((l) => l.id === 'violations');
  const dec = sim.byKey['2026-12'].lines.find((l) => l.id === 'violations');
  assert.equal(nov.paidReg, KD('702.150'));
  assert.equal(nov.status, 'done');
  assert.equal(dec.paidReg, 0, 'لا تُحسب على ديسمبر رغم أن تاريخها في ديسمبر');
  assert.equal(dec.arrStart, 0);
  assert.equal(sim.byKey['2026-12'].actualOut, 0);
  // بدل إيجار نوفمبر ضمن ميزانية نوفمبر فقط
  assert.equal(sim.byKey['2026-11'].income.planned, KD('1729.650') + KD(150));
  assert.equal(sim.byKey['2026-12'].income.planned, KD('1729.650') + KD(150));
});

test('إقفال الشهر مستقل عن يوم الراتب ويمكن تعديله', () => {
  const st = fresh();
  assert.equal(E.monthCloseDate(st, '2026-11'), '2027-01-01');
  assert.equal(E.isMonthClosed(st, '2026-11', '2026-12-22'), false, 'لا يُقفل يوم 22');
  ok(A.setMonthClose(st, '2026-11', '2026-12-10'));
  assert.equal(E.isMonthClosed(st, '2026-11', '2026-12-10'), true);
  ok(A.setMonthClose(st, '2026-11', null));
  assert.equal(E.monthCloseDate(st, '2026-11'), '2027-01-01');
});

test('منع مضاعفة العجز: أشهر غير مؤكدة لا تضيف إلى رصيد الدين', () => {
  const st = fresh();
  const today = '2027-01-05'; // سبتمبر وأكتوبر ونوفمبر مقفلة دون أي دفعة
  const sim = E.simulate(st, { today, until: '2027-02' });
  const f = (m) => sim.byKey[m].lines.find((l) => l.id === 'furniture');
  assert.equal(f('2026-10').arrStart, KD(460));
  assert.equal(f('2026-11').arrStart, KD(920));
  assert.equal(f('2026-12').arrStart, KD(1380));
  for (const m of ['2026-10', '2026-11', '2026-12']) {
    assert.equal(f(m).balStart, KD(5510), `${m}: الرصيد لم يتغير`);
    assert.ok(f(m).arrStart + f(m).planned <= f(m).balStart);
  }
  assert.equal(E.dashboard(st, sim).remaining, KD(11725));
  // سداد جزء من العجز يُخصم مرة واحدة
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-12', kind: 'arrears', amount: KD(500), date: '2027-01-04' }, { today }));
  const sim2 = E.simulate(st, { today, until: '2027-02' });
  assert.equal(sim2.byKey['2026-12'].lines.find((l) => l.id === 'furniture').arrRemaining, KD(880));
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5010));
});

test('الدفعة المسجلة غير المؤكدة لا تُخصم حتى تأكيدها', () => {
  const st = fresh();
  ok(A.addPayment(st, { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-25', confirmed: false }, { today: TODAY }));
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5510));
  assert.equal(line(st, '2026-11', 'furniture').status, 'recorded');
  assert.equal(E.dashboard(st, E.simulate(st, { today: TODAY })).paid, 0);
  ok(A.confirmPayment(st, st.payments[0].id));
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5050));
  assert.equal(line(st, '2026-11', 'furniture').status, 'done');
});

test('الإجمالي الابتدائي 11,725 ونسبة الإنجاز من انخفاض الرصيد', () => {
  const st = fresh();
  let d = E.dashboard(st, E.simulate(st, { today: TODAY }));
  assert.equal(d.initial, KD(11725));
  assert.equal(d.inferred, KD(940));
  A.addPayment(st, { itemId: 'violations', month: '2026-11', amount: KD(160), date: '2026-11-25' }, { today: TODAY });
  A.addPayment(st, { itemId: 'p_suhail', month: '2026-11', amount: KD(100), date: '2026-11-25' }, { today: TODAY });
  d = E.dashboard(st, E.simulate(st, { today: TODAY }));
  assert.equal(d.reduced, KD(260));
  assert.equal(d.remaining, KD(11725) - KD(260));
});

test('الدخل الافتراضي ليس دخلًا فعليًا: مكافأة 800 وزيادة 350/500', () => {
  const st = fresh();
  const base = E.simulate(st, { today: TODAY });
  ok(A.addExtra(st, { month: '2026-12', name: 'مكافأة الأعمال الممتازة', amount: KD(800), status: 'pending' }));
  const after = E.simulate(st, { today: TODAY });
  assert.equal(after.endMonth, base.endMonth);
  assert.deepEqual(after.months.map((m) => m.cashEnd), base.months.map((m) => m.cashEnd));
  assert.equal(after.byKey['2026-12'].income.received, 0);
  const before = JSON.stringify(st);
  for (const amt of [350, 500]) E.runScenario(st, { type: 'monthly', amount: KD(amt), start: '2026-12' }, TODAY);
  assert.equal(JSON.stringify(st), before, 'السيناريو لا يغيّر البيانات');
  assert.equal(E.simulate(st, { today: TODAY }).endMonth, base.endMonth);
  const rel = E.planReliability(st, after, TODAY);
  assert.equal(rel.pendingExtras.length, 1);
  assert.ok(rel.futureIncomeUnconfirmed > 0);
});

test('الفيزا: 400 مثبتة على نوفمبر و120 بعد يوم 15 على ديسمبر', () => {
  const st = fresh();
  ok(A.addVisaPurchase(st, { date: '2026-11-10', amount: KD(400) }));
  ok(A.confirmStatement(st, '2026-11-15', '2026-11-15'));
  ok(A.addVisaPurchase(st, { date: '2026-11-16', amount: KD(70) }));
  ok(A.addVisaPurchase(st, { date: '2026-12-15', amount: KD(50) }));
  const vs = E.visaSummary(st, '2026-12-01');
  assert.equal(vs.last.cycleEnd, '2026-11-15');
  assert.equal(vs.last.amount, KD(400));
  assert.equal(vs.unbilled, KD(120));
  assert.equal(vs.used, KD(520));
  assert.equal(vs.available, KD(480));
  assert.equal(vs.dueUnpaid, KD(400));
  ok(A.confirmStatement(st, '2026-12-15', '2026-12-15'));
  const vs2 = E.visaSummary(st, '2026-12-15');
  assert.equal(st.visa.statements.find((s) => s.cycleEnd === '2026-11-15').amount, KD(400));
  assert.equal(vs2.last.amount, KD(120));
});

test('الفيزا: السداد يُخصم من سيولة شهر واحد فقط', () => {
  const st = fresh();
  A.addVisaPurchase(st, { date: '2026-11-10', amount: KD(400) });
  const before = E.simulate(st, { today: TODAY, until: '2027-01' });
  ok(A.addVisaPayment(st, { date: '2026-12-02', amount: KD(400) }, '2026-12-02'));
  assert.equal(st.visa.payments[0].cashMonth, '2026-12');
  const after = E.simulate(st, { today: TODAY, until: '2027-01' });
  const out = after.months.reduce((a, m) => a + m.visaOut, 0);
  assert.equal(out, KD(400));
  assert.equal(after.byKey['2026-12'].cashEnd, before.byKey['2026-12'].cashEnd - KD(400));
  // بدون خصم من الخطة
  const st2 = fresh();
  A.addVisaPurchase(st2, { date: '2026-11-10', amount: KD(400) });
  ok(A.addVisaPayment(st2, { date: '2026-12-02', amount: KD(400), cashMonth: null }, '2026-12-02'));
  assert.equal(E.simulate(st2, { today: TODAY }).months.reduce((a, m) => a + m.visaOut, 0), 0);
});

test('الترحيل من النسخة الأولى لا يفقد أي بيانات', () => {
  // بيانات بصيغة الإصدار 1 كما حُفظت سابقًا
  const v1 = fresh();
  v1.schema = 1;
  delete v1.settings.payoffPriority;
  A.addPayment(v1, { itemId: 'furniture', month: '2026-09', amount: KD(460), date: '2026-09-25' }, { today: TODAY });
  A.addPayment(v1, { itemId: 'violations', month: '2026-11', amount: KD(160), date: '2026-11-25' }, { today: TODAY });
  A.addVisaPurchase(v1, { date: '2026-11-10', amount: KD(400) });
  A.addExtra(v1, { month: '2026-12', name: 'x', amount: KD(10), status: 'pending' });
  for (const p of v1.payments) delete p.confirmed;
  const raw = JSON.parse(JSON.stringify(v1));
  const { state: v2, changed } = E.migrate(JSON.parse(JSON.stringify(raw)));
  assert.equal(changed, true);
  assert.equal(v2.schema, 2);
  assert.equal(v2.payments.length, 2);
  assert.ok(v2.payments.every((p) => p.confirmed === true));
  assert.deepEqual(v2.payments.map((p) => [p.id, p.amount, p.month, p.date]), raw.payments.map((p) => [p.id, p.amount, p.month, p.date]));
  assert.deepEqual(v2.visa, raw.visa);
  assert.deepEqual(v2.extras, raw.extras);
  assert.deepEqual(v2.months, raw.months);
  assert.deepEqual(v2.items.map((i) => [i.id, i.opening]), raw.items.map((i) => [i.id, i.opening]));
  assert.equal(v2.settings.payoffPriority[0], 'violations');
  assert.equal(E.debtStatus(v2, E.itemById(v2, 'furniture')).remaining, KD(5050));
  // الترحيل مرة ثانية لا يغيّر شيئًا
  assert.equal(E.migrate(v2).changed, false);
});
