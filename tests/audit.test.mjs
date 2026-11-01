// تدقيق الإصدار النهائي: مقارنة محرك التطبيق بالمحرك المستقل + الحالات الخطرة + اختبارات خصائص عشوائية.
// node --test tests/audit.test.mjs
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
const at = (d, today = T) => (d > today ? d : today);
const pay = (st, itemId, month, amount, date, extra = {}) => ok(A.addPayment(st, { itemId, month, amount: KD(amount), date, ...extra }, { today: extra.today || at(date) }));

/** مقارنة كاملة + ثوابت لا يجوز كسرها */
function audit(st, today = T, label = '') {
  for (const assumeHistory of [false, true]) {
    const e = E.simulate(st, { today, assumeHistory });
    const v = verify(st, { today, assumeHistory });
    const d = compare(e, v);
    assert.deepEqual(d, [], `${label} [assumeHistory=${assumeHistory}] فروق بين المحركين:\n${d.slice(0, 10).join('\n')}`);
  }
  const sim = E.simulate(st, { today });
  const v = verify(st, { today });
  const debts = E.debtsOf(st);
  for (const dbt of debts) {
    const s = E.debtStatus(st, dbt);
    assert.ok(s.remaining >= 0, `${label} رصيد سالب ${dbt.id}`);
    assert.equal(s.remaining, v.actual[dbt.id], `${label} الرصيد الفعلي ${dbt.id}`);
    assert.equal(s.overpaid, 0, `${label} دفع زائد ${dbt.id}`);
  }
  for (const m of sim.months) for (const [id, b] of Object.entries(m.debtBalancesEnd)) assert.ok(b >= 0, `${label} ${m.key} رصيد متوقع سالب ${id}`);
  // كل فلس يُخصم مرة واحدة: الافتتاحي + التصحيحات − الختامي = مجموع ما خُصم شهريًا
  for (const dbt of debts) {
    const used = sim.months.reduce((a, m) => { const l = m.lines.find((x) => x.id === dbt.id); return a + (l ? l.regUsed + l.arrUsed : 0); }, 0);
    const last = sim.months[sim.months.length - 1].debtBalancesEnd[dbt.id];
    const st0 = E.debtStatus(st, dbt);
    assert.equal(st0.original - last, used, `${label} حفظ المبالغ ${dbt.id}`);
  }
  // الدفعات المؤكدة تظهر في شهرها المالي مرة واحدة
  const conf = E.confirmedPayments(st);
  for (const m of sim.months) for (const l of m.lines) {
    const p = conf.filter((x) => x.month === m.key && x.itemId === l.id);
    assert.equal(l.paidReg + l.paidArr, p.reduce((a, x) => a + x.amount, 0), `${label} ${m.key} ${l.id} دفعات مكررة/مفقودة`);
  }
  // لوحة المعلومات
  const d = E.dashboard(st, sim);
  assert.equal(d.remaining, debts.reduce((a, x) => a + E.debtStatus(st, x).remaining, 0));
  assert.ok(d.progressTenths >= 0 && d.progressTenths <= 1000);
  assert.ok(d.paid <= d.original);
  // الدخل المستلم = المؤكد فقط
  for (const m of sim.months) {
    const sal = E.salaryFor(st, m.key);
    const rents = E.rentsAllocatedTo(st, m.key);
    const recvExtras = st.extras.filter((x) => x.month === m.key && x.status === 'received').reduce((a, x) => a + x.amount, 0);
    const expect = (sal.received ? sal.receivedAmount : 0) + rents.reduce((a, r) => a + (r.received ? r.receivedAmount : 0), 0) + recvExtras;
    assert.equal(m.income.received, expect, `${label} ${m.key} دخل مستلم`);
  }
  // الاحتياطي لا يُستخدم أكثر من مرة
  const covered = sim.months.reduce((a, m) => a + m.lines.reduce((b, l) => b + l.potCover, 0), 0);
  assert.ok(covered <= (st.reserves || []).reduce((a, r) => a + r.amount, 0), `${label} احتياطي مستخدم مرتين`);
  // دين شخص غير متحقق لا يُجدول
  for (const m of sim.months) for (const l of m.lines) if (l.unverified && l.stored === null) assert.equal(l.regUsed - l.paidReg, 0, `${label} جدولة تلقائية لدين شخص غير متحقق`);
  // البيانات التاريخية غير المكتملة لا تعطي موعدًا «مؤكدًا»
  const rel = E.planReliability(st, sim, today);
  if (rel.historyIncomplete || !rel.cashEntered) assert.equal(rel.reliable, false);
  // الفيزا
  const vs = E.visaSummary(st, today);
  assert.ok(vs.used <= vs.limit && vs.available >= 0 && vs.used >= 0, `${label} فيزا`);
  return sim;
}

/* ═════════ الأوضاع الثلاثة للسيناريو الأساسي ═════════ */
function mode1() {
  const st = fresh();
  for (const [m, vals] of Object.entries({ '2026-09': { furniture: 460, violations: 537.8, small: 170 }, '2026-10': { furniture: 460, violations: 164, small: 170, shuoon: 137.5 } })) {
    for (const [id, v] of Object.entries(vals)) pay(st, id, m, v, `${m}-25`);
    for (const id of ['maid', 'bills', 'personal']) pay(st, id, m, E.expenseAmountFor(E.itemById(st, id), m) / 1000, `${m}-25`);
  }
  pay(st, 'p_suhail', '2026-09', 550, '2026-09-10');
  pay(st, 'p_shafiq', '2026-09', 24, '2026-09-10');
  pay(st, 'p_electric', '2026-09', 20, '2026-09-10');
  return st;
}

test('الأرقام المرجعية: 11,725 افتتاحي و9,031.700 بعد أكتوبر', () => {
  const st = mode1();
  const r = (id) => E.debtStatus(st, E.itemById(st, id)).remaining;
  assert.equal(E.dashboard(st, E.simulate(st, { today: T })).initial, KD(11725));
  assert.deepEqual([r('furniture'), r('violations'), r('small'), r('shuoon'), r('p_abuosama')], [KD(4590), KD('2970.200'), KD(600), KD('421.500'), KD(450)]);
  for (const id of ['p_suhail', 'p_shafiq', 'p_electric']) assert.equal(r(id), 0);
  assert.equal(E.dashboard(st, E.simulate(st, { today: T })).remaining, KD('9031.700'));
  audit(st, T, 'mode1');
});

test('الوضع 1: كل دفعات سبتمبر/أكتوبر مؤكدة — الإغلاق مايو 2027 ومطابق للمحرك المستقل', () => {
  const st = mode1();
  const sim = audit(st, T, 'mode1');
  assert.equal(sim.endMonth, '2027-05');
  assert.equal(E.planReliability(st, sim, T).historyIncomplete, false);
  // أبو أسامة بانتظار التحقق: خارج الجدولة. عند تأكيد استحقاقه يبقى الإغلاق مايو
  ok(A.setVerified(st, 'p_abuosama', true));
  assert.equal(audit(st, T, 'mode1+abu').endMonth, '2027-05');
});

test('الوضع 2: بيانات تاريخية غير مكتملة — تقديري ومطابق، ولا يُعرض كمؤكد', () => {
  const st = fresh();
  const sim = audit(st, T, 'mode2');
  assert.equal(sim.endMonth, '2027-06');
  const rel = E.planReliability(st, sim, T);
  assert.equal(rel.historyIncomplete, true);
  assert.equal(rel.reliable, false);
  assert.equal(E.simulate(st, { today: T, assumeHistory: true }).endMonth, '2027-05');
});

test('الوضع 3: تعثر شهر كامل ثم استئناف — العجز يُرحّل والخطة تمتد، ومطابق', () => {
  const st = mode1();
  ok(A.setVerified(st, 'p_abuosama', true));
  // نوفمبر: لم يُدفع شيء والشهر أُقفل
  ok(A.closeMonth(st, '2026-11', true, '2026-12-05'));
  const today = '2026-12-05';
  const sim = audit(st, today, 'mode3');
  const dec = sim.byKey['2026-12'];
  const arr = (id) => dec.lines.find((l) => l.id === id).arrStartC;
  assert.equal(arr('furniture'), KD(460));
  assert.equal(arr('violations'), KD('702.150'));
  assert.equal(arr('small'), KD(170));
  assert.equal(arr('shuoon'), KD('137.500'));
  assert.equal(arr('maid') + arr('bills'), KD(220));
  assert.ok(sim.endMonth >= '2027-05');
});

/* ═════════ الحالات الخطرة ═════════ */
test('حالات خطرة: كل عملية تُتبع بتحقق كامل من الأرصدة ومطابقة المحركين', () => {
  const st = mode1();
  ok(A.setVerified(st, 'p_abuosama', true));
  const r = (id) => E.debtStatus(st, E.itemById(st, id)).remaining;
  audit(st, T, 'start');

  // عدم تسجيل دفعة تاريخية: يبقى الرصيد ولا عجز مؤكد
  const st2 = fresh();
  assert.equal(E.simulate(st2, { today: T }).byKey['2026-10'].lines.find((l) => l.id === 'furniture').status, 'unknown');
  audit(st2, T, 'unrecorded');

  // دفعة جزئية
  pay(st, 'violations', '2026-11', 300, '2026-11-25');
  assert.equal(r('violations'), KD('2670.200'));
  assert.equal(E.simulate(st, { today: T, until: '2026-12' }).byKey['2026-12'].lines.find((l) => l.id === 'violations').arrStartC, KD('402.150'));
  audit(st, T, 'partial');

  // تأكيد دفعة ثم تعديلها
  pay(st, 'furniture', '2026-11', 460, '2026-11-25');
  const pid = st.payments[st.payments.length - 1].id;
  ok(A.updatePayment(st, pid, { amount: KD(400) }, { today: '2026-11-25' }));
  assert.equal(r('furniture'), KD(4190));
  audit(st, T, 'edit');

  // حذف دفعة مؤكدة
  ok(A.deletePayment(st, pid));
  assert.equal(r('furniture'), KD(4590));
  audit(st, T, 'delete');

  // إغلاق شهر وإعادة فتحه
  ok(A.closeMonth(st, '2026-11', true));
  assert.equal(E.simulate(st, { today: T, until: '2026-12' }).byKey['2026-12'].lines.find((l) => l.id === 'furniture').arrStartC, KD(460));
  audit(st, T, 'close');
  ok(A.closeMonth(st, '2026-11', false));
  assert.equal(E.simulate(st, { today: T, until: '2026-12' }).byKey['2026-12'].lines.find((l) => l.id === 'furniture').arrStartC, 0);
  audit(st, T, 'reopen');

  // تغيير تاريخ وصول الراتب (يبقى في نافذته)
  ok(A.setIncome(st, '2026-12', 'salary', { date: '2026-12-28' }));
  audit(st, T, 'salary-date');
  // تأخر بدل الإيجار بعد راتب الشهر التالي: لا يُستعمل قبل وصوله
  const timely = E.simulate(st, { today: T }).byKey['2026-11'];
  ok(A.setIncome(st, '2026-11', 'rent', { date: '2026-12-24' }));
  let sim = audit(st, T, 'late-rent');
  const late = sim.byKey['2026-11'];
  assert.equal(late.income.cash, KD('1729.650'));
  assert.equal(sim.byKey['2026-12'].income.cash, KD('1729.650') + KD(300));
  // نوفمبر يخسر 150 بالضبط من سيولته (نقصًا في النقد المتبقي أو عجزًا ماليًا)
  assert.equal((timely.cashEnd - late.cashEnd) + (late.fundingGap - timely.fundingGap), KD(150));
  assert.ok(sim.timing.some((x) => x.kind === 'rent' && x.ofMonth === '2026-11' && x.cashMonth === '2026-12'));
  ok(A.setIncome(st, '2026-11', 'rent', { date: null }));

  // نقص الراتب / عدم وصوله
  ok(A.setIncome(st, '2027-01', 'salary', { amount: KD(1000) }));
  audit(st, T, 'low-salary');
  ok(A.setIncome(st, '2027-02', 'salary', { amount: 0 }));
  sim = audit(st, T, 'no-salary');
  assert.ok(sim.byKey['2027-02'].fundingGap > 0);
  ok(A.setIncome(st, '2027-01', 'salary', { amount: KD('1729.650') }));
  ok(A.setIncome(st, '2027-02', 'salary', { amount: KD('1729.650') }));

  // ارتفاع المصروف الشخصي وزيادة الفواتير
  ok(A.setPlan(st, '2026-12', 'personal', KD(400)));
  ok(A.setExpenseFrom(st, 'bills', '2027-01', KD(120)));
  audit(st, T, 'expenses');

  // تغيير رصيد قرض
  ok(A.addAdjustment(st, 'small', KD(500), 'كشف البنك', '2026-11-05'));
  assert.equal(r('small'), KD(500));
  audit(st, T, 'adjust');

  // إغلاق قرض مبكرًا
  ok(A.setCash(st, { amount: KD(500), date: '2026-11-05' }, T));
  pay(st, 'small', '2026-11', 170, '2026-11-05');
  pay(st, 'small', '2026-11', 330, '2026-11-05');
  assert.equal(r('small'), 0);
  sim = audit(st, T, 'early-close');
  assert.ok(sim.months.filter((m) => m.key > '2026-11').every((m) => !m.lines.some((l) => l.id === 'small')));

  // سداد زائد بالخطأ: مرفوض
  assert.notEqual(A.addPayment(st, { itemId: 'small', month: '2026-12', amount: 1, date: '2026-11-05' }, { today: T }), null);
  assert.notEqual(A.addPayment(st, { itemId: 'p_abuosama', month: '2026-11', amount: KD(451), date: '2026-11-05' }, { today: T }), null);
  audit(st, T, 'overpay');

  // عدم وجود سيولة كافية + عجز في أكثر من قرض + تراكم عدة أشهر
  const st3 = mode1();
  for (const m of ['2026-11', '2026-12', '2027-01']) ok(A.closeMonth(st3, m, true, '2027-02-03'));
  sim = audit(st3, '2027-02-03', 'multi-arrears');
  const feb = sim.byKey['2027-02'];
  assert.equal(feb.lines.find((l) => l.id === 'furniture').arrStartC, KD(1380));
  assert.equal(feb.lines.find((l) => l.id === 'violations').arrStartC, KD('702.150') * 2 + KD('252.150'));
  assert.ok(feb.fundingGap > 0 || feb.lines.some((l) => l.projArr < l.arrStart));
  assert.ok(sim.endMonth > '2027-05');

  // دفعتان متطابقتان: يُكتشف التكرار، وإن أُكد يُحسب مرتين ضمن سقف الرصيد
  const st4 = fresh();
  const dup = { itemId: 'furniture', month: '2026-11', amount: KD(460), date: '2026-11-05' };
  ok(A.addPayment(st4, dup, { today: T }));
  assert.ok(A.findDuplicatePayment(st4, dup));
  ok(A.addPayment(st4, dup, { today: T }));
  assert.equal(E.debtStatus(st4, E.itemById(st4, 'furniture')).remaining, KD(5510) - KD(920));
  audit(st4, T, 'dup-pay');

  // سداد فيزا مرتين / بلوغ الحد / تجاوز الحد
  const st5 = fresh();
  ok(A.addVisaPurchase(st5, { date: '2026-11-01', amount: KD(1000) }, T));
  assert.notEqual(A.addVisaPurchase(st5, { date: '2026-11-02', amount: 1 }, T), null, 'تجاوز الحد مرفوض');
  ok(A.addVisaPayment(st5, { date: '2026-11-03', amount: KD(600) }, T));
  assert.ok(A.findDuplicateVisaPayment(st5, { date: '2026-11-03', amount: KD(600) }));
  assert.notEqual(A.addVisaPayment(st5, { date: '2026-11-03', amount: KD(600) }, T), null, 'السداد الثاني يتجاوز المستخدم');
  ok(A.addVisaPayment(st5, { date: '2026-11-03', amount: KD(400) }, T));
  assert.equal(E.visaSummary(st5, T).available, KD(1000));
  audit(st5, T, 'visa');

  // تعديل عملية قديمة بعد مرور أشهر
  const st6 = mode1();
  const old = st6.payments.find((p) => p.itemId === 'violations' && p.month === '2026-09');
  ok(A.updatePayment(st6, old.id, { amount: KD(400) }, { today: '2027-03-10' }));
  sim = audit(st6, '2027-03-10', 'old-edit');
  assert.equal(E.debtStatus(st6, E.itemById(st6, 'violations')).remaining, KD('3108.000'));

  // اختلاف تاريخ العملية عن شهرها المالي
  const st7 = fresh();
  pay(st7, 'violations', '2026-11', 150, '2026-12-02', { today: '2026-12-02' });
  sim = audit(st7, '2026-12-03', 'date-vs-month');
  assert.equal(sim.byKey['2026-11'].lines.find((l) => l.id === 'violations').paidReg, KD(150));
  assert.equal(sim.byKey['2026-12'].lines.find((l) => l.id === 'violations').paidReg, 0);

  // عمليات مؤكدة بتاريخ مستقبلي مرفوضة
  assert.notEqual(A.addPayment(fresh(), { itemId: 'furniture', month: '2026-11', amount: 1, date: '2026-11-30' }, { today: T }), null);
  assert.notEqual(A.holdReserve(fresh(), 'res_uni', '2027-01-23', T), null);
  assert.notEqual(A.setIncome(fresh(), '2026-11', 'salary', { received: true, receivedDate: '2026-11-22' }, T), null);
  ok(A.addPayment(fresh(), { itemId: 'furniture', month: '2026-11', amount: 1, date: '2026-11-30', confirmed: false }, { today: T }));
});

test('ترحيل البيانات القديمة: v1 وv2 بلا فقدان، والترحيل لا يغيّر الحساب', () => {
  const st = mode1();
  const v2 = JSON.parse(JSON.stringify(st));
  v2.schema = 2; delete v2.settings.cash; delete v2.reserves;
  for (const d of v2.items) delete d.verified;
  const { state: back } = E.migrate(JSON.parse(JSON.stringify(v2)));
  assert.deepEqual(back.payments, st.payments);
  assert.deepEqual(back.visa, st.visa);
  assert.deepEqual(back.months, st.months);
  assert.equal(E.simulate(back, { today: T }).endMonth, E.simulate(st, { today: T }).endMonth);
  audit(back, T, 'migrated');
  const again = E.migrate(JSON.parse(JSON.stringify(back)));
  assert.equal(again.changed, false);
  assert.deepEqual(again.state, JSON.parse(JSON.stringify(back)));
});

/* ═════════ اختبارات خصائص عشوائية ═════════ */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MONTHS = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'];
const TODAYS = ['2026-11-05', '2026-12-20', '2027-01-25', '2027-03-02', '2027-04-28'];

test('خصائص: آلاف العمليات العشوائية — الثوابت سليمة والمحركان متطابقان حتى آخر فلس', () => {
  let checks = 0; let accepted = 0; let rejected = 0;
  const SEQS = 260; const OPS = 14;
  for (let seq = 0; seq < SEQS; seq++) {
    const R = rng(1000 + seq);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const amt = (max) => Math.max(1, Math.floor(R() * max));
    const today = pick(TODAYS);
    const st = seq % 3 === 0 ? mode1() : fresh();
    const date = (m) => { const d = `${m}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}`; return d > today ? today : d; };
    for (let op = 0; op < OPS; op++) {
      const items = st.items.map((i) => i.id);
      const k = Math.floor(R() * 16);
      let err = null;
      const m = pick(MONTHS);
      switch (k) {
        case 0: case 1: case 2: { // دفعة أساسية جزئية/كاملة/زائدة
          const id = pick(items);
          err = A.addPayment(st, { itemId: id, month: m, amount: amt(R() < 0.15 ? 6000000 : 900000), date: date(m), confirmed: R() > 0.1, note: 'r' }, { today });
          break;
        }
        case 3: { // سداد من العجز
          const s = E.simulate(st, { today, until: m });
          const l = s.byKey[m]?.lines.find((x) => x.arrRemaining > 0);
          if (l) err = A.addPayment(st, { itemId: l.id, month: m, kind: 'arrears', amount: amt(l.arrRemaining + 50000), date: date(m) }, { today });
          break;
        }
        case 4: if (st.payments.length) err = A.updatePayment(st, pick(st.payments).id, { amount: amt(800000) }, { today }); break;
        case 5: if (st.payments.length) err = A.deletePayment(st, pick(st.payments).id); break;
        case 6: { const d = pick(E.debtsOf(st)); err = A.addAdjustment(st, d.id, amt(6000000), 'r', today); break; }
        case 7: err = A.closeMonth(st, pick(MONTHS), R() > 0.4, today); break;
        case 8: err = A.setIncome(st, m, pick(['salary', 'rent']), { amount: amt(2000000) }, today); break;
        case 9: { const kind = pick(['salary', 'rent']); const dd = date(m); err = A.setIncome(st, m, kind, R() > 0.5 ? { received: true, receivedAmount: amt(2000000), receivedDate: dd } : { date: `${E.addMonths(m, R() > 0.5 ? 1 : 0)}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}` }, today); break; }
        case 10: err = A.setCash(st, { amount: amt(3000000), date: today }, today); break;
        case 11: err = A.addVisaPurchase(st, { date: date(pick(MONTHS)), amount: amt(700000) }, today); break;
        case 12: err = A.addVisaPayment(st, { date: today, amount: amt(700000), cashMonth: R() > 0.3 ? today.slice(0, 7) : null }, today); break;
        case 13: err = A.holdReserve(st, 'res_uni', R() > 0.3 ? today : null, today); break;
        case 14: err = A.setVerified(st, pick(['p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama']), R() > 0.5); break;
        default: err = A.setPlan(st, m, pick(items), R() > 0.2 ? amt(1500000) : null); break;
      }
      if (err) rejected++; else accepted++;
      audit(st, today, `seq${seq} op${op} k${k}`);
      checks++;
    }
    // الحفظ والترحيل لا يغيّران شيئًا
    const round = E.migrate(JSON.parse(JSON.stringify(st)));
    assert.equal(round.changed, false);
    assert.deepEqual(E.simulate(round.state, { today }).months.map((x) => x.cashEnd), E.simulate(st, { today }).months.map((x) => x.cashEnd));
  }
  assert.ok(checks >= 3500, `checks=${checks}`);
  console.log(`property checks: ${checks} (accepted ops ${accepted}, rejected by validation ${rejected})`);
});

test('تنبيهات التوقيت: دخل متأخر عن موعده أو يصل بعد نافذته يمنع اعتبار الموعد موثوقًا', () => {
  const st = mode1();
  ok(A.setCash(st, { amount: 0, date: '2026-11-23' }, '2026-11-23'));
  let rel = E.planReliability(st, E.simulate(st, { today: '2026-11-23' }), '2026-11-23');
  assert.ok(rel.overdueIncome.some((x) => x.kind === 'salary' && x.ofMonth === '2026-11'), 'راتب نوفمبر تجاوز موعده دون تأكيد');
  assert.equal(rel.reliable, false);
  ok(A.setIncome(st, '2026-11', 'salary', { received: true, receivedDate: '2026-11-22' }, '2026-11-23'));
  ok(A.setIncome(st, '2026-11', 'rent', { date: '2026-12-25' }, '2026-11-23'));
  rel = E.planReliability(st, E.simulate(st, { today: '2026-11-23' }), '2026-11-23');
  assert.ok(rel.timing.some((t) => t.kind === 'rent' && t.cashMonth === '2026-12'));
  audit(st, '2026-11-23', 'timing');
});
