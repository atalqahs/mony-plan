// اختبارات المحرك المحاسبي — node --test tests/engine.test.mjs
// الترقيم [n] يطابق قائمة الاختبارات الإلزامية في طلب التدقيق.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as A from '../js/actions.js';
import { parseKD, fmtKD } from '../js/money.js';

const KD = (s) => parseKD(String(s));
const TODAY = '2026-11-05'; // سبتمبر وأكتوبر تاريخيان، نوفمبر أول شهر توقعي
const fresh = () => E.createSeedState('2026-11-01T00:00:00.000Z');
const sim = (st, o = {}) => E.simulate(st, { today: TODAY, ...o });
const line = (st, month, id, o = {}) => sim(st, { until: month, ...o }).byKey[month].lines.find((l) => l.id === id);
const ok = (err) => assert.equal(err, null, err);
// وقت التسجيل = تاريخ الدفعة إن كان بعد TODAY (العملية المؤكدة لا تكون في المستقبل)
const at = (date) => (date > TODAY ? date : TODAY);
const pay = (st, itemId, month, amount, date, extra = {}) => ok(A.addPayment(st, { itemId, month, amount: KD(amount), date, ...extra }, { today: extra.today || at(date) }));
const remaining = (st) => E.dashboard(st, sim(st)).remaining;
const PLAN = {
  '2026-09': { furniture: 460, violations: 537.8, small: 170 },
  '2026-10': { furniture: 460, violations: 164, small: 170, shuoon: 137.5 },
};
const recordPersons = (st) => {
  pay(st, 'p_suhail', '2026-09', 550, '2026-09-10');
  pay(st, 'p_shafiq', '2026-09', 24, '2026-09-10');
  pay(st, 'p_electric', '2026-09', 20, '2026-09-10');
};

/* ───────── المال ───────── */
test('المال: تحويل دقيق بالفلس بلا أرقام عائمة', () => {
  assert.equal(parseKD('1,729.650'), 1729650);
  assert.equal(parseKD('702.15'), 702150);
  assert.equal(parseKD('٧٠٢٫١٥'), 702150);
  assert.equal(parseKD('0.1') + parseKD('0.2'), parseKD('0.3'));
  assert.ok(Number.isNaN(parseKD('1.2345')));
  assert.ok(Number.isNaN(parseKD('abc')));
  assert.equal(fmtKD(9201700), '9,201.700');
  const st = fresh();
  for (const it of st.items) {
    if (it.opening !== undefined) assert.ok(Number.isSafeInteger(it.opening));
    if (it.mandatory !== undefined) assert.ok(Number.isSafeInteger(it.mandatory));
  }
  for (const md of Object.values(st.months)) for (const v of Object.values(md.plan || {})) assert.ok(Number.isSafeInteger(v));
});

/* ───────── [1] الإجمالي الافتتاحي ───────── */
test('[1] الإجمالي الافتتاحي 11,725 بالأرصدة المعتمدة', () => {
  const st = fresh();
  const op = Object.fromEntries(E.debtsOf(st).map((d) => [d.id, d.opening]));
  assert.deepEqual(op, {
    furniture: KD(5510), violations: KD(3672), small: KD(940), shuoon: KD(559),
    p_suhail: KD(550), p_shafiq: KD(24), p_electric: KD(20), p_abuosama: KD(450),
  });
  const d = E.dashboard(st, sim(st));
  assert.equal(d.initial, KD(11725));
  assert.equal(d.remaining, KD(11725));
  assert.equal(d.paid, 0);
  assert.equal(d.progressTenths, 0);
  assert.equal(d.inferred, KD(940), 'القرض الصغير مستنتج');
  assert.equal(E.itemById(st, 'small').openingInferred, true);
  assert.equal(st.payments.length, 0, 'لا دفعات تلقائية');
});

/* ───────── [2] المتبقي المرجعي بعد أكتوبر ───────── */
test('[2] المتبقي المرجعي بعد أكتوبر 9,201.700 — مع إظهار التعارض في القرض الصغير', () => {
  // (أ) كما في جدول المراجعة: القرض الصغير 770 = دفعة سبتمبر فقط
  const st = fresh();
  for (const [m, vals] of Object.entries(PLAN)) {
    for (const [id, v] of Object.entries(vals)) {
      if (m === '2026-10' && id === 'small') continue;
      pay(st, id, m, v, `${m}-25`);
    }
  }
  recordPersons(st);
  const r = (id) => E.debtStatus(st, E.itemById(st, id)).remaining;
  assert.equal(r('furniture'), KD(4590));
  assert.equal(r('violations'), KD('2970.200'));
  assert.equal(r('small'), KD(770));
  assert.equal(r('shuoon'), KD('421.500'));
  assert.equal(r('p_abuosama'), KD(450));
  assert.equal(remaining(st), KD('9201.700'));
  // (ب) إذا سُجلت دفعة أكتوبر للقرض الصغير (170) كما في الخطة: 600 والإجمالي 9,031.700
  pay(st, 'small', '2026-10', 170, '2026-10-25');
  assert.equal(r('small'), KD(600));
  assert.equal(remaining(st), KD('9031.700'));
});

/* ───────── [3] ديون الأشخاص ───────── */
test('[3] تسجيل سداد سهيل وشفيق والكهربائي يخفض الإجمالي 594 بالضبط', () => {
  const st = fresh();
  const before = remaining(st);
  recordPersons(st);
  assert.equal(before - remaining(st), KD(594));
  // الأشخاص لا يُعتبرون مسددين تلقائيًا، ولا يُغلقون إلا بتأكيد يدوي
  for (const id of ['p_suhail', 'p_shafiq', 'p_electric']) assert.equal(E.itemById(st, id).closedConfirmed, false);
  ok(A.confirmClose(st, 'p_suhail'));
  assert.notEqual(A.confirmClose(st, 'p_abuosama'), null, 'لا إغلاق مع رصيد متبقٍ');
  // ديون الأشخاص غير المتحقق منها لا تُجدول تلقائيًا؛ أبو أسامة دين قائم مؤكد (حسب المستخدم)
  const s2 = sim(fresh(), { until: '2027-08' });
  for (const m of s2.months) for (const l of m.lines) if (l.unverified) assert.equal(l.regUsed, 0, `${m.key} ${l.name}`);
  assert.deepEqual(s2.excludedPersons.map((x) => x.id), ['p_suhail', 'p_shafiq', 'p_electric']);
  assert.equal(E.itemById(fresh(), 'p_abuosama').verified, true);
});

/* ───────── [4] فائض سبتمبر/أكتوبر الوهمي ───────── */
test('[4] لا يُرحّل فائض سبتمبر وأكتوبر الافتراضي (800) إلى المستقبل', () => {
  const st = fresh();
  const s = sim(st);
  assert.equal(s.byKey['2026-09'].cashEnd, null);
  assert.equal(s.byKey['2026-10'].cashEnd, null);
  assert.equal(s.byKey['2026-11'].cashStart, 0, 'بداية نوفمبر = الرصيد النقدي المُدخل (صفر)');
  // حتى بعد تسجيل كل دفعات سبتمبر وأكتوبر وتأكيد الرواتب: لا سيولة تاريخية
  for (const [m, vals] of Object.entries(PLAN)) for (const [id, v] of Object.entries(vals)) pay(st, id, m, v, `${m}-25`);
  ok(A.setIncome(st, '2026-09', 'salary', { received: true, receivedDate: '2026-09-22' }, at('2026-09-22')));
  ok(A.setIncome(st, '2026-10', 'salary', { received: true, receivedDate: '2026-10-22' }, at('2026-10-22')));
  assert.equal(sim(st).byKey['2026-11'].cashStart, 0);
  // السيولة تأتي فقط من رصيد يُدخله المستخدم
  ok(A.setCash(st, { amount: KD(300), date: '2026-11-01' }, TODAY));
  assert.equal(sim(st).byKey['2026-11'].cashStart, KD(300));
});

/* ───────── [5] المصروف الشخصي غير المؤكد ───────── */
test('[5] المصروف الشخصي غير المؤكد ليس سيولة: يُحجز كاملًا في التوقع', () => {
  const st = fresh();
  const nov = sim(st).byKey['2026-11'];
  const personal = nov.lines.find((l) => l.id === 'personal');
  assert.equal(personal.projReg, KD(190));
  assert.equal(nov.cashEnd, 0, 'دخل نوفمبر يغطي الخطة بالضبط دون فائض وهمي');
  // تسجيل صرف جزئي لا يحرر الباقي كسيولة ما دام الشهر مفتوحًا
  pay(st, 'personal', '2026-11', 50, '2026-11-06');
  const nov2 = sim(st).byKey['2026-11'];
  assert.equal(nov2.lines.find((l) => l.id === 'personal').projReg, KD(140));
  assert.equal(nov2.cashEnd, 0);
  // في الشهر التاريخي لا يولّد المصروف غير المسجل أي سيولة
  assert.equal(sim(st).byKey['2026-11'].cashStart, 0);
});

/* ───────── [6] الدفعة التاريخية المجهولة ───────── */
test('[6] البند غير المسجل في شهر ماضٍ «غير مسجل» وليس عجزًا مؤكدًا', () => {
  const st = fresh();
  const sep = line(st, '2026-09', 'furniture');
  assert.equal(sep.status, 'unknown');
  assert.equal(sep.belowMandatory, false);
  assert.equal(line(st, '2026-10', 'furniture').arrStart, 0);
  assert.equal(line(st, '2026-11', 'furniture').arrStart, 0);
  assert.equal(line(st, '2026-11', 'maid').arrStart, 0);
  const rel = E.planReliability(st, sim(st), TODAY);
  assert.equal(rel.historyIncomplete, true);
  assert.ok(rel.unknownPast.length >= 10);
  assert.equal(rel.reliable, false);
  // الإقفال اليدوي فقط يحوّل غير المسدد إلى عجز مؤكد، وإعادة الفتح تلغيه
  ok(A.closeMonth(st, '2026-09', true));
  assert.equal(line(st, '2026-09', 'furniture').status, 'missed');
  assert.equal(line(st, '2026-10', 'furniture').arrStartC, KD(460));
  ok(A.closeMonth(st, '2026-09', false));
  assert.equal(line(st, '2026-10', 'furniture').arrStart, 0);
});

/* ───────── [7] العجز 340 ← 140 ← 90 ───────── */
test('[7] ترحيل العجز 340 ثم 140 ثم 90، والقسط الأساسي منفصل', () => {
  const st = fresh();
  ok(A.setPlan(st, '2026-11', 'violations', KD(500)));
  pay(st, 'violations', '2026-11', 160, '2026-11-25');
  assert.equal(line(st, '2026-11', 'violations').status, 'partial');
  const dec = line(st, '2026-12', 'violations');
  assert.equal(dec.arrStartC, KD(340));
  assert.equal(dec.planned, KD('702.150'), 'قسط ديسمبر الأساسي لم يتغير');
  pay(st, 'violations', '2026-12', 200, '2026-12-23', { kind: 'arrears' });
  assert.equal(line(st, '2026-12', 'violations').arrRemaining, KD(140));
  assert.equal(line(st, '2027-01', 'violations').arrStartC, KD(140));
  pay(st, 'violations', '2027-01', 50, '2027-01-23', { kind: 'arrears' });
  assert.equal(line(st, '2027-02', 'violations').arrStartC, KD(90));
  assert.equal(line(st, '2027-02', 'violations').planned, KD('760.650'));
  // عجز جديد لنفس القرض يُجمع مع القديم
  pay(st, 'violations', '2027-01', 100, '2027-01-24');
  assert.equal(line(st, '2027-02', 'violations').arrStartC, KD(90) + KD('152.150'));
  // لا يمكن سداد أكثر من العجز
  assert.notEqual(A.addPayment(st, { itemId: 'violations', month: '2027-02', kind: 'arrears', amount: KD(243), date: '2027-02-23' }, { today: at('2027-02-23') }), null);
});

/* ───────── [8] لا خصم مزدوج للعجز ───────── */
test('[8] العجز لا يُخصم مرتين ولا يُضاف إلى أصل الدين', () => {
  const st = fresh();
  ok(A.setPlan(st, '2026-11', 'violations', KD(500)));
  pay(st, 'violations', '2026-11', 160, '2026-11-25');
  pay(st, 'violations', '2026-12', 200, '2026-12-23', { kind: 'arrears' });
  assert.equal(E.debtStatus(st, E.itemById(st, 'violations')).remaining, KD(3672) - KD(360));
  assert.equal(remaining(st), KD(11725) - KD(360));
  const dec = line(st, '2026-12', 'violations');
  assert.equal(dec.balStart, KD(3672) - KD(160), 'العجز جزء من الرصيد وليس فوقه');
  assert.ok(dec.arrStart + dec.planned <= dec.balStart);
  assert.equal(st.payments.length, 2, 'عملية واحدة لكل سداد');
  // أشهر مقفلة متتالية دون دفع: العجز يتراكم ولا يتجاوز الرصيد
  const st2 = fresh();
  for (const m of ['2026-09', '2026-10']) ok(A.closeMonth(st2, m, true));
  const nov = line(st2, '2026-11', 'furniture');
  assert.equal(nov.arrStartC, KD(920));
  assert.equal(nov.balStart, KD(5510));
});

/* ───────── [9][10] الإغلاق وإلغاء القسط ───────── */
test('[9] إغلاق الأثاث كاملًا يلغي قسطه فورًا', () => {
  const st = fresh();
  pay(st, 'furniture', '2026-11', 5510, '2026-11-25');
  const s = sim(st, { until: '2027-04' });
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, 0);
  for (const k of ['2026-12', '2027-01', '2027-02', '2027-03']) assert.equal(s.byKey[k].lines.find((l) => l.id === 'furniture'), undefined, k);
  assert.notEqual(A.addPayment(st, { itemId: 'furniture', month: '2026-12', amount: 1, date: '2026-12-25' }, { today: at('2026-12-25') }), null, 'لا دفع زائد');
});
test('[10] إغلاق المخالفات كاملًا يلغي قسطها فورًا، والقسط لا يتجاوز الرصيد', () => {
  const st = fresh();
  ok(A.addAdjustment(st, 'violations', KD(100), 'اختبار: رصيد أقل من القسط'));
  assert.equal(line(st, '2026-11', 'violations').planned, KD(100), 'المطلوب لا يتجاوز الرصيد الحقيقي');
  pay(st, 'violations', '2026-11', 100, '2026-11-25');
  const s = sim(st, { until: '2027-03' });
  for (const k of ['2026-12', '2027-01', '2027-02']) assert.equal(s.byKey[k].lines.find((l) => l.id === 'violations'), undefined, k);
});

/* ───────── [11] الأقساط المحررة ليست دخلًا ───────── */
test('[11] تحرير قسط بإغلاق قرض لا يُحسب دخلًا جديدًا', () => {
  const base = fresh();
  const st = fresh();
  ok(A.setCash(st, { amount: KD(5510), date: '2026-11-01' }, TODAY));
  pay(st, 'furniture', '2026-11', 5510, '2026-11-02');
  const a = sim(base, { until: '2027-06' }); const b = sim(st, { until: '2027-06' });
  for (const k of ['2026-11', '2026-12', '2027-03']) {
    assert.equal(b.byKey[k].income.planned, a.byKey[k].income.planned, `${k}: الدخل نفسه`);
    assert.equal(b.byKey[k].income.cash, a.byKey[k].income.cash);
  }
  // الـ 460 المحررة تصبح سيولة متاحة لإعادة التوجيه، دون أن تظهر كدخل
  assert.equal(b.byKey['2026-12'].cashEnd - a.byKey['2026-12'].cashEnd, KD(460) * 2);
});

/* ───────── [12] بدل الإيجار مرة واحدة ───────── */
test('[12] بدل الإيجار يُحتسب مرة واحدة فقط، وتغيير تاريخ وصوله لا ينقله', () => {
  const st = fresh();
  ok(A.setIncome(st, '2026-11', 'rent', { received: true, receivedDate: '2026-12-02' }, at('2026-12-02')));
  const s = sim(st, { until: '2027-03' });
  const sal = KD('1729.650'); const rent = KD(150);
  const fc = s.months.filter((m) => m.forecast && m.key <= '2027-03');
  for (const m of fc) assert.equal(m.income.planned, sal + rent, m.key);
  assert.equal(fc.reduce((a, m) => a + m.income.cash, 0), fc.length * (sal + rent));
  assert.equal(s.byKey['2026-11'].income.received, rent);
  assert.equal(s.byKey['2026-12'].income.received, 0);
  // إعادة التخصيص لشهر آخر تنقله ولا تكرره
  ok(A.setIncome(st, '2026-12', 'rent', { allocMonth: '2027-01' }));
  const s2 = sim(st, { until: '2027-02' });
  assert.equal(s2.byKey['2026-12'].income.planned, sal);
  assert.equal(s2.byKey['2027-01'].income.planned, sal + 2 * rent);
  const total = (x) => x.months.filter((m) => m.forecast && m.key <= '2027-02').reduce((a, m) => a + m.income.planned, 0);
  assert.equal(total(s2), total(sim(fresh(), { until: '2027-02' })));
});

/* ───────── [13] احتياطي الجامعة مرة واحدة ───────── */
test('[13] احتياطي الجامعة يُحجز في يناير ويُصرف في فبراير دون تكرار', () => {
  const st = fresh();
  const s = sim(st, { until: '2027-02' });
  const jan = s.byKey['2027-01']; const feb = s.byKey['2027-02'];
  assert.equal(jan.reserves[0].projHold, KD(450));
  assert.equal(jan.cashEnd, 0, 'يناير: 1,879.650 = الالتزامات + الاحتياطي 450');
  const uni = feb.lines.find((l) => l.id === 'uni');
  assert.equal(uni.potCover, KD(450), 'الجامعة مموَّلة من الاحتياطي');
  assert.equal(feb.cashEnd, KD(150), 'فبراير لا يدفع الجامعة من سيولته مرة ثانية');
  // دفع الجامعة فعليًا يُغطى من الاحتياطي ولا يخرج من السيولة مرتين
  ok(A.holdReserve(st, 'res_uni', '2027-01-23', at('2027-01-23')));
  pay(st, 'uni', '2027-02', 450, '2027-02-05');
  const s2 = sim(st, { until: '2027-02' });
  assert.equal(s2.byKey['2027-01'].cashEnd, 0);
  assert.equal(s2.byKey['2027-02'].cashEnd, KD(150));
  assert.equal(E.dashboard(st, s2).initial, KD(11725), 'الجامعة خارج إجمالي الديون');
});

/* ───────── [14] تاريخ الدفعة مستقل عن الشهر المالي ───────── */
test('[14] دفعة نوفمبر المنفذة في 2 ديسمبر تُنسب لخطة نوفمبر', () => {
  const st = fresh();
  pay(st, 'violations', '2026-11', '552.150', '2026-11-23');
  pay(st, 'violations', '2026-11', 150, '2026-12-02', { note: 'من بدل إيجار نوفمبر' });
  const s = sim(st, { until: '2027-01', today: '2026-12-03' });
  const nov = s.byKey['2026-11'].lines.find((l) => l.id === 'violations');
  const dec = s.byKey['2026-12'].lines.find((l) => l.id === 'violations');
  assert.equal(nov.paidReg, KD('702.150'));
  assert.equal(nov.status, 'done');
  assert.equal(dec.paidReg, 0);
  assert.equal(dec.arrStart, 0);
  assert.ok(st.payments.every((p) => p.month === '2026-11'));
});

/* ───────── [15][16] الفيزا ───────── */
test('[15] الفيزا: شراء يوم 15 على كشف نوفمبر ويوم 16 على كشف ديسمبر', () => {
  const st = fresh();
  ok(A.addVisaPurchase(st, { date: '2026-11-15', amount: KD(400) }, '2026-11-15'));
  ok(A.addVisaPurchase(st, { date: '2026-11-16', amount: KD(120) }, '2026-11-16'));
  assert.equal(E.visaCycleEnd('2026-11-15'), '2026-11-15');
  assert.equal(E.visaCycleEnd('2026-11-16'), '2026-12-15');
  ok(A.confirmStatement(st, '2026-11-15', '2026-11-15'));
  const vs = E.visaSummary(st, '2026-11-20');
  assert.equal(vs.last.amount, KD(400));
  assert.equal(vs.unbilled, KD(120));
  assert.equal(vs.used, KD(520));
  assert.equal(vs.available, KD(480));
  ok(A.confirmStatement(st, '2026-12-15', '2026-12-15'));
  assert.equal(st.visa.statements.find((s) => s.cycleEnd === '2026-11-15').amount, KD(400), 'كشف نوفمبر لم يتغير');
  // لا تجاوز للحد الائتماني
  assert.notEqual(A.addVisaPurchase(st, { date: '2026-12-20', amount: KD(481) }, '2026-12-20'), null);
  ok(A.addVisaPurchase(st, { date: '2026-12-20', amount: KD(480) }, '2026-12-20'));
  assert.equal(E.visaSummary(st, '2026-12-20').available, 0);
});
test('[16] الفيزا: سداد جزئي ثم كامل، يُوزَّع على الأقدم، يحفظ السجل، ويُخصم من السيولة مرة واحدة', () => {
  const st = fresh();
  A.addVisaPurchase(st, { date: '2026-11-10', amount: KD(400) }, '2026-11-10');
  A.confirmStatement(st, '2026-11-15', '2026-11-15');
  A.addVisaPurchase(st, { date: '2026-11-20', amount: KD(120) }, '2026-11-20');
  A.confirmStatement(st, '2026-12-15', '2026-12-15');
  const before = sim(st, { until: '2027-01' });
  ok(A.addVisaPayment(st, { date: '2026-12-02', amount: KD(450) }, '2026-12-02'));
  let vs = E.visaSummary(st, '2026-12-16');
  const nov = vs.statements.find((s) => s.cycleEnd === '2026-11-15');
  const dec = vs.statements.find((s) => s.cycleEnd === '2026-12-15');
  assert.equal(nov.remaining, 0, 'السداد يغطي الكشف الأقدم أولًا');
  assert.equal(dec.remaining, KD(70));
  assert.equal(vs.dueUnpaid, KD(70));
  assert.equal(vs.available, KD(930));
  const after = sim(st, { until: '2027-01' });
  const adj = (x) => x.months.filter((m) => m.key <= '2027-01').reduce((a, m) => a + (m.cashAdjust || 0), 0);
  assert.equal(adj(after) - adj(before), -KD(450), 'يُخصم مرة واحدة');
  assert.equal(after.byKey['2026-12'].cashAdjust, -KD(450), 'من سيولة شهر واحد فقط');
  assert.equal(after.byKey['2026-12'].fundingGap - before.byKey['2026-12'].fundingGap, KD(450), 'دون رصيد نقدي إضافي يظهر كعجز مالي');
  ok(A.addVisaPayment(st, { date: '2026-12-20', amount: KD(70) }, '2026-12-20'));
  vs = E.visaSummary(st, '2026-12-20');
  assert.equal(vs.used, 0);
  assert.equal(vs.available, KD(1000));
  assert.equal(st.visa.statements.length, 2);
  assert.equal(st.visa.purchases.length, 2);
  assert.notEqual(A.addVisaPayment(st, { date: '2026-12-21', amount: 1 }, '2026-12-21'), null, 'لا سداد زائد');
  assert.equal(E.dashboard(st, sim(st)).initial, KD(11725), 'الفيزا خارج إجمالي الديون');
});

/* ───────── [17] تعديل دفعة تاريخية ───────── */
test('[17] تعديل أو حذف دفعة تاريخية يعيد حساب الرصيد والجدول بالكامل', () => {
  const st = fresh();
  pay(st, 'violations', '2026-09', '537.800', '2026-09-25');
  assert.equal(line(st, '2026-10', 'violations').arrStart, 0);
  const endBefore = sim(st).endMonth;
  const pid = st.payments[0].id;
  ok(A.updatePayment(st, pid, { amount: KD(300) }, { today: TODAY }));
  assert.equal(st.payments[0].id, pid);
  assert.equal(line(st, '2026-10', 'violations').arrStartC, KD('237.800'), 'دفعة جزئية مسجلة = عجز مؤكد');
  assert.equal(E.debtStatus(st, E.itemById(st, 'violations')).remaining, KD(3372));
  ok(A.deletePayment(st, pid));
  assert.equal(line(st, '2026-10', 'violations').arrStart, 0, 'بعد الحذف يعود البند غير مسجل');
  assert.equal(E.debtStatus(st, E.itemById(st, 'violations')).remaining, KD(3672));
  assert.ok(sim(st).endMonth >= endBefore);
});

/* ───────── [18] السيناريو ───────── */
test('[18] زيادة 500 افتراضيًا لا تعدّل البيانات وتعرض أثرها على القروض', () => {
  const st = fresh();
  const before = JSON.stringify(st);
  const r = E.runScenario(st, { type: 'monthly', amount: KD(500), start: '2026-11' }, TODAY);
  assert.equal(JSON.stringify(st), before);
  assert.ok(r.scenarioEnd < r.currentEnd, `${r.scenarioEnd} < ${r.currentEnd}`);
  assert.ok(r.diffMonths < 0);
  assert.ok(r.loans.some((l) => l.id === 'furniture' && l.scenario < l.current));
  assert.equal(r.estimate, true, 'السجل التاريخي غير مكتمل → المقارنة تقديرية');
  ok(A.adoptScenario(st, { type: 'monthly', amount: KD(500), start: '2026-11' }));
  assert.equal(sim(st).endMonth, r.scenarioEnd);
});

/* ───────── [19][20] التمديد والتقليص ───────── */
test('[19] التعثر يمدد الخطة ويظهر العجز المالي، ولا يعرض موعدًا وهميًا', () => {
  const st = fresh();
  const end0 = sim(st).endMonth;
  for (const m of ['2027-03', '2027-04', '2027-05']) ok(A.setIncome(st, m, 'salary', { amount: KD(300) }));
  const s = sim(st);
  assert.ok(s.endMonth > end0, `${s.endMonth} > ${end0}`);
  assert.ok(s.byKey['2027-03'].fundingGap > 0);
  assert.ok(E.planReliability(st, s, TODAY).gaps.length > 0);
  // دخل لا يغطي المصاريف أبدًا → لا موعد إغلاق
  const st2 = fresh();
  ok(A.updateItem(st2, 'personal', {}));
  ok(A.setExpenseFrom(st2, 'personal', '2026-11', KD(5000)));
  assert.equal(sim(st2).endMonth, null);
});
test('[20] السداد الإضافي المؤكد يقلّص الخطة', () => {
  const st = fresh();
  const end0 = sim(st).endMonth;
  ok(A.addExtra(st, { month: '2026-11', name: 'مبلغ مستلم', amount: KD(3000), status: 'received', date: '2026-11-03' }, at('2026-11-03')));
  pay(st, 'furniture', '2026-11', 3000, '2026-11-04');
  const end1 = sim(st).endMonth;
  assert.ok(end1 < end0, `${end1} < ${end0}`);
  // الخطة الأصلية سبتمبر–فبراير لا تُعاد كتابتها
  const s = sim(st, { until: '2027-02' });
  assert.equal(s.byKey['2027-02'].lines.find((l) => l.id === 'violations').planned, KD('760.650'));
});

/* ───────── [21] الترحيل ───────── */
test('[21] ترحيل بيانات الإصدارين 1 و2 دون فقدان أو تكرار', () => {
  const v1 = fresh();
  v1.schema = 1;
  delete v1.settings.payoffPriority; delete v1.settings.cash; delete v1.reserves;
  for (const d of v1.items) delete d.verified;
  E.itemById(v1, 'shuoon').extra = 'allow';
  pay(v1, 'furniture', '2026-09', 460, '2026-09-25');
  pay(v1, 'violations', '2026-11', 160, '2026-11-25');
  A.addVisaPurchase(v1, { date: '2026-11-10', amount: KD(400) }, '2026-11-10');
  for (const p of v1.payments) delete p.confirmed;
  v1.months['2026-10'].closeDate = '2026-12-01';
  const raw = JSON.parse(JSON.stringify(v1));
  const { state: v3, changed } = E.migrate(JSON.parse(JSON.stringify(raw)));
  assert.equal(changed, true);
  assert.equal(v3.schema, E.SCHEMA);
  assert.equal(v3.payments.length, raw.payments.length, 'لا تكرار');
  assert.deepEqual(v3.payments.map((p) => [p.id, p.amount, p.month, p.date, p.kind]), raw.payments.map((p) => [p.id, p.amount, p.month, p.date, p.kind]));
  assert.ok(v3.payments.every((p) => p.confirmed === true));
  assert.deepEqual(v3.visa, raw.visa);
  assert.deepEqual(v3.items.map((i) => [i.id, i.opening]), raw.items.map((i) => [i.id, i.opening]));
  assert.equal(v3.months['2026-10'].closed, true, 'الإقفال اليدوي السابق محفوظ');
  assert.deepEqual(v3.settings.cash, { amount: 0, date: null, note: '' });
  assert.equal(v3.reserves.length, 1);
  assert.equal(E.itemById(v3, 'p_suhail').verified, false);
  assert.equal(E.itemById(v3, 'p_abuosama').verified, true, 'أبو أسامة دين قائم مؤكد');
  assert.equal(v3.reserves[0].sources.length, 2);
  assert.equal(E.itemById(v3, 'shuoon').extra, 'none');
  assert.equal(E.debtStatus(v3, E.itemById(v3, 'furniture')).remaining, KD(5050));
  const again = E.migrate(v3);
  assert.equal(again.changed, false);
  assert.equal(again.state.reserves.length, 1);
});

/* ───────── [24] منع الرصيد السالب والدفع الزائد ───────── */
test('[24] منع الرصيد السالب والدفع الزائد غير المبرر', () => {
  const st = fresh();
  assert.match(A.addPayment(st, { itemId: 'p_shafiq', month: '2026-11', amount: KD(25), date: '2026-11-05' }, { today: at('2026-11-05') }) || '', /يتجاوز الرصيد/);
  pay(st, 'p_shafiq', '2026-11', 20, '2026-11-05', { confirmed: false });
  assert.match(A.addPayment(st, { itemId: 'p_shafiq', month: '2026-11', amount: KD(5), date: '2026-11-05' }, { today: at('2026-11-05') }) || '', /يتجاوز الرصيد/, 'الدفعة المعلقة تُحتسب في المنع');
  assert.match(A.addPayment(st, { itemId: 'small', month: '2026-11', amount: KD(500), date: '2026-11-05' }, { today: at('2026-11-05') }) || '', /لا يُسمح بسداد إضافي جزئي/);
  assert.match(A.addPayment(st, { itemId: 'maid', month: '2026-11', amount: KD(200), date: '2026-11-05' }, { today: at('2026-11-05') }) || '', /اكتب سبب الزيادة/);
  pay(st, 'maid', '2026-11', 200, '2026-11-05', { note: 'إضافي متفق عليه' });
  assert.notEqual(A.addAdjustment(st, 'furniture', -1, 'x'), null);
  assert.notEqual(A.setCash(st, { amount: -1, date: '2026-11-01' }, TODAY), null);
  assert.notEqual(A.setCash(st, { amount: 0, date: '2026-12-01' }, TODAY), null, 'لا تاريخ مستقبلي');
  for (const d of E.debtsOf(st)) assert.ok(E.debtStatus(st, d).remaining >= 0);
  // النسبة لا تتجاوز 100% حتى بعد تصحيح الرصيد بعد السداد
  pay(st, 'p_electric', '2026-11', 20, '2026-11-05');
  ok(A.addAdjustment(st, 'p_electric', KD(5), 'رصيد إضافي'));
  const d = E.dashboard(st, sim(st));
  assert.ok(d.progressTenths <= 1000);
  assert.equal(d.original, KD(11730));
});

/* ───────── [25] الدخل المتوقع ليس مستلمًا ───────── */
test('[25] الدخل المتوقع والافتراضي ليس دخلًا مستلمًا (مكافأة 800، زيادة 350/500)', () => {
  const st = fresh();
  const s0 = sim(st);
  assert.ok(s0.months.every((m) => m.income.received === 0), 'لا شيء مستلم قبل التأكيد');
  ok(A.addExtra(st, { month: '2026-12', name: 'مكافأة الأعمال الممتازة', amount: KD(800), status: 'pending' }));
  const s1 = sim(st);
  assert.equal(s1.endMonth, s0.endMonth);
  assert.deepEqual(s1.months.map((m) => m.cashEnd), s0.months.map((m) => m.cashEnd));
  const before = JSON.stringify(st);
  for (const amt of [350, 500]) E.runScenario(st, { type: 'monthly', amount: KD(amt), start: '2026-12' }, TODAY);
  assert.equal(JSON.stringify(st), before);
  // المستلم فعليًا قد يختلف عن المخطط
  ok(A.setIncome(st, '2026-11', 'salary', { received: true, receivedAmount: KD(1700), receivedDate: '2026-11-22' }, at('2026-11-22')));
  const s2 = sim(st);
  assert.equal(s2.byKey['2026-11'].income.received, KD(1700));
  assert.equal(s2.byKey['2026-11'].income.planned, KD('1729.650') + KD(150), 'المخطط محفوظ للمقارنة');
  assert.equal(s2.byKey['2026-11'].income.cash, KD(1700) + KD(150));
});

/* ───────── أولويات السداد ───────── */
test('الأولويات: المخالفات ثم الأثاث، بلا Snowball، والقرض الصغير والشؤون حسب جدوليهما', () => {
  const st = fresh();
  for (const id of ['p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama']) ok(A.setVerified(st, id, true));
  const s = E.simulate(st, { today: TODAY, baseline: true, until: '2027-08' });
  const g = (m, id) => s.byKey[m].lines.find((l) => l.id === id);
  assert.equal(g('2027-03', 'violations').balEnd, 0, 'المخالفات تُغلق أولًا');
  assert.ok(g('2027-03', 'furniture').extraSuggested > 0);
  assert.equal(g('2027-03', 'p_electric').regUsed, 0, 'أصغر دين (20) لا يأخذ شيئًا والأثاث قائم');
  const firstPersonMonth = s.months.find((m) => m.lines.some((l) => l.group === 'person' && l.regUsed > 0));
  const furnClose = s.months.find((m) => m.debtBalancesEnd.furniture <= 0);
  assert.ok(firstPersonMonth.key >= furnClose.key);
  for (const m of s.months) for (const l of m.lines) if (l.id === 'small' || l.id === 'shuoon') assert.equal(l.extraSuggested, 0);
  ok(A.setPayoffPriority(st, ['p_electric', 'violations', 'furniture', 'p_suhail', 'p_shafiq', 'p_abuosama']));
  assert.equal(E.simulate(st, { today: TODAY, baseline: true }).byKey['2027-03'].lines.find((l) => l.id === 'p_electric').balEnd, 0);
});

test('الدفعة المسجلة غير المؤكدة لا تُخصم حتى تأكيدها', () => {
  const st = fresh();
  pay(st, 'furniture', '2026-11', 460, '2026-11-25', { confirmed: false });
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5510));
  assert.equal(line(st, '2026-11', 'furniture').status, 'recorded');
  ok(A.confirmPayment(st, st.payments[0].id, undefined, '2026-11-25'));
  assert.equal(line(st, '2026-11', 'furniture').status, 'done');
  assert.equal(E.debtStatus(st, E.itemById(st, 'furniture')).remaining, KD(5050));
});

test('الرصيد النقدي: التدفقات المؤكدة قبل تاريخ الرصيد لا تُحتسب مرتين', () => {
  const st = fresh();
  ok(A.setIncome(st, '2026-11', 'salary', { received: true, receivedDate: '2026-11-22' }, at('2026-11-22')));
  pay(st, 'furniture', '2026-11', 460, '2026-11-23');
  // الرصيد بعد الراتب والدفعة
  ok(A.setCash(st, { amount: KD('1269.650'), date: '2026-11-24' }, '2026-11-24'));
  const s = E.simulate(st, { today: '2026-11-24', until: '2026-12' });
  const nov = s.byKey['2026-11'];
  assert.equal(nov.income.cash, KD(150), 'الراتب مُضمَّن في الرصيد، يبقى بدل الإيجار المتوقع فقط');
  assert.equal(nov.cashEnd, 0, 'لا ازدواج: الرصيد + الإيجار = باقي الالتزامات');
});

test('الشؤون تبدأ أكتوبر فقط، والجامعة ضمن التزامات فبراير خارج الديون', () => {
  const st = fresh();
  const s = sim(st, { until: '2027-03' });
  assert.equal(s.byKey['2026-09'].lines.find((l) => l.id === 'shuoon'), undefined);
  assert.equal(s.byKey['2026-10'].lines.find((l) => l.id === 'shuoon').planned, KD('137.500'));
  assert.equal(s.byKey['2027-02'].lines.find((l) => l.id === 'shuoon').planned, KD(9));
  assert.equal(s.byKey['2027-02'].lines.find((l) => l.id === 'uni').planned, KD(450));
  assert.equal(s.byKey['2027-01'].lines.find((l) => l.id === 'uni'), undefined);
});

test('الحتمية: نفس العمليات بنفس النتيجة بغض النظر عن ترتيب الإدخال', () => {
  const a = fresh(); const b = fresh();
  const ops = [['violations', '2026-11', 160, '2026-11-25'], ['furniture', '2026-09', 460, '2026-09-25'], ['p_suhail', '2026-09', 550, '2026-09-10']];
  ops.forEach((o) => pay(a, ...o));
  [...ops].reverse().forEach((o) => pay(b, ...o));
  const sa = sim(a); const sb = sim(b);
  assert.equal(sa.endMonth, sb.endMonth);
  assert.deepEqual(sa.months.map((m) => m.cashEnd), sb.months.map((m) => m.cashEnd));
});
