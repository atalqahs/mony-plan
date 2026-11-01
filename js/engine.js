// محرك الخطة المالية — دوال نقية حتمية. كل المبالغ بالفلس (أعداد صحيحة).
// الأرصدة والعجز والجدولة تُشتق دائمًا من: الأرصدة الافتتاحية + التصحيحات + الدفعات المؤكدة.

import { parseKD } from './money.js';

export const SCHEMA = 2;
export const DEFAULT_PRIORITY = ['violations', 'furniture', 'p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama'];
const MAX_MONTHS = 600;

/* ───────────── التواريخ (Asia/Kuwait) ───────────── */

export function kuwaitToday(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const g = (t) => parts.find((p) => p.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch {
    // الكويت UTC+3 بلا توقيت صيفي
    return new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
  }
}

const pad = (n) => String(n).padStart(2, '0');
export const monthIndex = (key) => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};
export const monthKey = (idx) => `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
export const addMonths = (key, n) => monthKey(monthIndex(key) + n);
export const monthOfDate = (date) => date.slice(0, 7);
export const daysInMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const dateIn = (key, day) => `${key}-${pad(Math.min(Math.max(1, day), daysInMonth(key)))}`;

export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const AR_MONTHS_SHORT = ['ينا', 'فبر', 'مار', 'أبر', 'مايو', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${AR_MONTHS[m - 1]} ${y}`;
};
export const dateLabel = (date) => {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
};

/**
 * تاريخ إقفال الشهر المالي: من هذا التاريخ يُعتبر غير المدفوع من خطة الشهر عجزًا.
 * الافتراضي: أول يوم من الشهر الذي يلي الشهر التالي — لأن دفعات الشهر قد تُنفذ في الشهر
 * التالي (مثل بدل الإيجار الذي يصل بداية الشهر التالي). يمكن تعديله لكل شهر يدويًا.
 * لا علاقة له بيوم الراتب: تاريخ كل دفعة مستقل عن الشهر المالي المنسوبة إليه.
 */
export function monthCloseDate(state, key) {
  const md = state.months[key] || {};
  return md.closeDate || dateIn(addMonths(key, 2), 1);
}
export function isMonthClosed(state, key, today) {
  return today >= monthCloseDate(state, key);
}
/** الدفعات المؤكدة فقط تدخل في الأرصدة والعجز والإجماليات */
export const confirmedPayments = (state) => state.payments.filter((p) => p.confirmed !== false);

/* ───────────── البيانات الأولية ───────────── */

let _idc = 0;
export function uid(prefix = 'x') {
  _idc += 1;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${_idc}`;
}

export function createSeedState(nowIso = new Date().toISOString()) {
  const KD = (n) => parseKD(String(n)); // تحويل نصي دقيق إلى فلس
  const items = [
    { id: 'furniture', type: 'debt', group: 'loan', name: 'قرض الأثاث', icon: '🛋️', opening: KD(5510), mandatory: KD(460), extra: 'allow', start: '2026-09', order: 1 },
    { id: 'violations', type: 'debt', group: 'loan', name: 'قرض المخالفات', icon: '🚦', opening: KD(3672), mandatory: KD(164), extra: 'allow', start: '2026-09', order: 2 },
    { id: 'small', type: 'debt', group: 'loan', name: 'القرض الصغير', icon: '💳', opening: KD(940), openingInferred: true, mandatory: KD(170), extra: 'closeOnly', start: '2026-09', order: 3,
      note: 'رصيد مستنتج من مجموع الأقساط المجدولة (5×170 + 90 = 940) — ليس رصيدًا بنكيًا مؤكدًا. عدّله إذا عرفت الرصيد الحقيقي.' },
    { id: 'shuoon', type: 'debt', group: 'loan', name: 'الشؤون', icon: '🏛️', opening: KD(559), mandatory: KD(137.5), extra: 'allow', start: '2026-10', order: 4,
      note: 'مجموع الدفعات المجدولة: 4×137.500 + 9 = 559. تبدأ في أكتوبر 2026.' },
    { id: 'p_suhail', type: 'debt', group: 'person', name: 'سهيل', icon: '👤', opening: KD(550), mandatory: 0, extra: 'allow', start: '2026-09', order: 10 },
    { id: 'p_shafiq', type: 'debt', group: 'person', name: 'شفيق', icon: '👤', opening: KD(24), mandatory: 0, extra: 'allow', start: '2026-09', order: 11 },
    { id: 'p_electric', type: 'debt', group: 'person', name: 'الكهربائي', icon: '👤', opening: KD(20), mandatory: 0, extra: 'allow', start: '2026-09', order: 12 },
    { id: 'p_abuosama', type: 'debt', group: 'person', name: 'أبو أسامة', icon: '👤', opening: KD(450), mandatory: 0, extra: 'allow', start: '2026-09', order: 13 },
    { id: 'maid', type: 'expense', name: 'الخادمة', icon: '🧹', carry: true, schedule: [{ from: '2026-09', amount: KD(140) }], order: 20 },
    { id: 'bills', type: 'expense', name: 'الفواتير', icon: '💡', carry: true, schedule: [{ from: '2026-09', amount: KD(100) }, { from: '2026-11', amount: KD(80) }], order: 21 },
    { id: 'personal', type: 'expense', name: 'المصروف الشخصي', icon: '👛', carry: false, schedule: [{ from: '2026-09', amount: KD(190) }], order: 22 },
    { id: 'uni', type: 'expense', name: 'تسجيل الجامعة', icon: '🎓', carry: true, once: '2027-02', schedule: [{ from: '2027-02', amount: KD(450) }], order: 23 },
  ];
  for (const it of items) { it.createdAt = nowIso; if (it.type === 'debt') it.closedConfirmed = false; }

  // الخطة الأصلية (سبتمبر 2026 – فبراير 2027)
  const plan = {
    '2026-09': { furniture: 460, violations: 537.8, small: 170 },
    '2026-10': { furniture: 460, violations: 164, small: 170, shuoon: 137.5 },
    '2026-11': { furniture: 460, violations: 702.15, small: 170, shuoon: 137.5 },
    '2026-12': { furniture: 460, violations: 702.15, small: 170, shuoon: 137.5 },
    '2027-01': { furniture: 460, violations: 252.15, small: 170, shuoon: 137.5 },
    '2027-02': { furniture: 460, violations: 760.65, small: 90, shuoon: 9 },
  };
  const months = {};
  for (const [m, vals] of Object.entries(plan)) {
    months[m] = { plan: {} };
    for (const [id, v] of Object.entries(vals)) months[m].plan[id] = KD(v);
  }
  months['2026-11'].notes = 'المخالفات 702.150 = 552.150 من الراتب + 150 من بدل إيجار نوفمبر (يصل بداية ديسمبر).';
  months['2026-12'].notes = 'المخالفات 702.150 = 552.150 من الراتب + 150 من بدل إيجار ديسمبر (يصل بداية يناير).';
  months['2027-01'].notes = 'المخالفات 252.150. يُحتجز 300 من الراتب + 150 من بدل إيجار يناير (يصل في فبراير) لرسوم الجامعة.';
  months['2026-10'].notes = 'لشهر أكتوبر تسويات خاصة سابقة — عدّل البنود والدخل والتواريخ يدويًا حسب الواقع.';

  const state = {
    schema: SCHEMA,
    createdAt: nowIso,
    settings: {
      planStart: '2026-09',
      autoFrom: '2027-03',
      salaryDefault: KD(1729.65),
      salaryDay: 22,
      rentDefault: KD(150),
      rentArrivalDay: 1,
      visaLimit: KD(1000),
      visaStatementDay: 15,
      payoffPriority: [...DEFAULT_PRIORITY],
    },
    items,
    months,
    extras: [],
    payments: [],
    adjustments: [],
    visa: { purchases: [], payments: [], statements: [] },
    log: [{ ts: nowIso, text: 'إنشاء الخطة الأصلية — جميع البنود غير مؤكدة.' }],
  };
  state.baseline = { endMonth: simulate(state, { baseline: true }).endMonth };
  return state;
}

/* ───────────── أدوات البنود ───────────── */

export const debtsOf = (state) => state.items.filter((i) => i.type === 'debt');
export const expensesOf = (state) => state.items.filter((i) => i.type === 'expense');
export const itemById = (state, id) => state.items.find((i) => i.id === id);

export function expenseAmountFor(item, key) {
  if (item.once && item.once !== key) return 0;
  if (item.endMonth && key > item.endMonth) return 0;
  let amt = 0;
  for (const s of [...(item.schedule || [])].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (s.from <= key) amt = s.amount;
  }
  return amt;
}

export function salaryFor(state, key) {
  const md = state.months[key] || {};
  const s = state.settings;
  const sal = md.salary || {};
  return {
    amount: sal.amount ?? s.salaryDefault,
    date: sal.date || dateIn(key, s.salaryDay),
    received: !!sal.received,
    receivedDate: sal.receivedDate || null,
  };
}

/** بدل الإيجار مستحق للشهر key ويصل عادة بداية الشهر التالي — يُحتسب مرة واحدة فقط ضمن شهر استحقاقه */
export function rentFor(state, key) {
  const md = state.months[key] || {};
  const s = state.settings;
  const r = md.rent || {};
  return {
    amount: r.amount ?? s.rentDefault,
    date: r.date || dateIn(addMonths(key, 1), s.rentArrivalDay),
    received: !!r.received,
    receivedDate: r.receivedDate || null,
  };
}

/* ───────────── المحاكاة ───────────── */

function sumBy(list, keyFn) {
  const out = new Map();
  for (const x of list) {
    const k = keyFn(x);
    out.set(k, (out.get(k) || 0) + x.amount);
  }
  return out;
}

/**
 * يحاكي الخطة شهرًا بشهر.
 * opts.today        تاريخ اليوم (YYYY-MM-DD)
 * opts.until        أقل شهر يجب الوصول إليه في النتائج
 * opts.virtualExtras دخل افتراضي (للسيناريو) — لا يُحفظ
 * opts.baseline     تجاهل الدفعات الفعلية واعتبار كل شيء مستقبليًا (للموعد الأصلي)
 */
export function simulate(state, opts = {}) {
  const s = state.settings;
  const baseline = !!opts.baseline;
  const today = baseline ? '0000-00-00' : (opts.today || kuwaitToday());
  const untilIdx = opts.until ? monthIndex(opts.until) : -Infinity;
  const startIdx = monthIndex(s.planStart);
  const autoFromIdx = monthIndex(s.autoFrom);

  const payments = baseline ? [] : confirmedPayments(state);
  const pendingMap = sumBy(baseline ? [] : state.payments.filter((p) => p.confirmed === false), (p) => `${p.month}|${p.itemId}|${p.kind}`);
  const priority = s.payoffPriority || DEFAULT_PRIORITY;
  const prioRank = (item) => { const i = priority.indexOf(item.id); return i < 0 ? 1e6 + item.order : i; };
  const payMap = sumBy(payments, (p) => `${p.month}|${p.itemId}|${p.kind}`);
  const hasPay = new Set(payments.map((p) => `${p.month}|${p.itemId}|${p.kind}`));
  const adjMap = sumBy(baseline ? [] : state.adjustments, (a) => a.itemId);
  const extras = [
    ...(baseline ? [] : state.extras.filter((e) => e.status === 'received' || e.status === 'adopted')),
    ...(opts.virtualExtras || []),
  ];
  const extraMap = sumBy(extras, (e) => e.month);
  const visaOutMap = sumBy(baseline ? [] : state.visa.payments.filter((p) => p.cashMonth), (p) => p.cashMonth);

  const debts = debtsOf(state).sort((a, b) => a.order - b.order);
  const expenses = expensesOf(state).sort((a, b) => a.order - b.order);
  const bal = {};
  const arr = {};
  for (const d of debts) { bal[d.id] = null; arr[d.id] = 0; }
  for (const e of expenses) arr[e.id] = 0;

  let cash = 0;
  let endIdx = null;
  const months = [];

  for (let k = 0; k < MAX_MONTHS; k++) {
    const idx = startIdx + k;
    const key = monthKey(idx);
    const md = state.months[key] || {};
    const planVals = md.plan || {};
    const closed = !baseline && isMonthClosed(state, key, today);
    const isAuto = idx >= autoFromIdx;

    const sal = salaryFor(state, key);
    const rent = rentFor(state, key);
    const recurringAmt = baseline ? 0 : (state.recurring || [])
      .filter((r) => r.start <= key && (!r.end || key <= r.end)).reduce((a, r) => a + r.amount, 0);
    const extraAmt = (extraMap.get(key) || 0) + recurringAmt;
    const income = sal.amount + rent.amount + extraAmt;
    const receivedIncome = (sal.received ? sal.amount : 0) + (rent.received ? rent.amount : 0)
      + (baseline ? 0 : state.extras.filter((e) => e.month === key && e.status === 'received').reduce((a, e) => a + e.amount, 0));
    const visaOut = visaOutMap.get(key) || 0;
    const cashStart = cash;

    const lines = [];
    // الديون
    for (const d of debts) {
      if (key < d.start) continue;
      if (bal[d.id] === null) bal[d.id] = d.opening + (adjMap.get(d.id) || 0);
      const balStart = bal[d.id];
      const paidReg = payMap.get(`${key}|${d.id}|regular`) || 0;
      const paidArr = payMap.get(`${key}|${d.id}|arrears`) || 0;
      if (balStart <= 0 && paidReg === 0 && paidArr === 0) continue; // القرض مغلق: لا مطالبات
      const arrStart = Math.max(0, Math.min(arr[d.id], balStart));
      const dueCap = Math.max(0, balStart - arrStart);
      const stored = Object.prototype.hasOwnProperty.call(planVals, d.id) ? planVals[d.id] : null;
      const mandatoryCap = Math.min(d.mandatory || 0, dueCap);
      let plannedRaw; let engineManaged = false;
      if (stored !== null) plannedRaw = stored;
      else if (isAuto) { plannedRaw = mandatoryCap; engineManaged = true; }
      else plannedRaw = d.mandatory || 0;
      const planned = Math.min(plannedRaw, dueCap);
      lines.push({
        id: d.id, type: 'debt', group: d.group, name: d.name, icon: d.icon, item: d,
        mandatory: d.mandatory || 0, mandatoryCap, stored, engineManaged,
        balStart, arrStart, dueCap, planned, plannedForDeficit: engineManaged ? mandatoryCap : planned,
        paidReg, paidArr,
        regRealized: closed || hasPay.has(`${key}|${d.id}|regular`),
        arrRealized: closed || hasPay.has(`${key}|${d.id}|arrears`),
        projReg: 0, projArr: 0, extraSuggested: 0, unmet: 0,
        pendingReg: pendingMap.get(`${key}|${d.id}|regular`) || 0,
        carry: true,
      });
    }
    // المصاريف والالتزامات الشهرية
    for (const e of expenses) {
      const stored = Object.prototype.hasOwnProperty.call(planVals, e.id) ? planVals[e.id] : null;
      const base = expenseAmountFor(e, key);
      const plannedRaw = stored !== null ? stored : base;
      const paidReg = payMap.get(`${key}|${e.id}|regular`) || 0;
      const paidArr = payMap.get(`${key}|${e.id}|arrears`) || 0;
      const arrStart = e.carry ? arr[e.id] : 0;
      if (plannedRaw === 0 && paidReg === 0 && paidArr === 0 && arrStart === 0) continue;
      lines.push({
        id: e.id, type: 'expense', name: e.name, icon: e.icon, item: e,
        mandatory: 0, mandatoryCap: 0, stored, engineManaged: false,
        balStart: null, arrStart, dueCap: plannedRaw, planned: plannedRaw, plannedForDeficit: plannedRaw,
        paidReg, paidArr,
        regRealized: closed || hasPay.has(`${key}|${e.id}|regular`),
        arrRealized: closed || hasPay.has(`${key}|${e.id}|arrears`),
        projReg: 0, projArr: 0, extraSuggested: 0, unmet: 0,
        pendingReg: pendingMap.get(`${key}|${e.id}|regular`) || 0,
        carry: !!e.carry,
      });
    }

    // السيولة: الدفعات الفعلية أولًا، ثم المتوقعة حسب الأولوية
    const actualOut = lines.reduce((a, l) => a + l.paidReg + l.paidArr, 0);
    let avail = cash + income - visaOut - actualOut;
    const take = (need) => {
      if (need <= 0) return 0;
      const got = Math.max(0, Math.min(need, avail));
      avail -= got;
      return got;
    };
    // أ) المصاريف الأساسية
    for (const l of lines) if (l.type === 'expense' && !l.regRealized) {
      l.projReg = take(l.planned); l.unmet += l.planned - l.projReg;
    }
    // ب) الأقساط الإلزامية
    for (const l of lines) if (l.type === 'debt' && !l.regRealized) {
      const need = Math.min(l.planned, l.mandatoryCap);
      l.projReg = take(need); l.unmet += need - l.projReg;
    }
    // ج) باقي الدفعة المخططة
    for (const l of lines) if (l.type === 'debt' && !l.regRealized) {
      const need = l.planned - Math.min(l.planned, l.mandatoryCap);
      const got = take(need); l.projReg += got; l.unmet += need - got;
    }
    // د) سداد العجز المرحّل
    for (const l of [...lines.filter((x) => x.type === 'expense'), ...lines.filter((x) => x.type === 'debt')]) {
      if (l.arrRealized || l.arrStart <= 0) continue;
      l.projArr = take(l.arrStart);
    }
    // هـ) توزيع السيولة الإضافية (أشهر الجدولة التلقائية فقط) حسب أولويات السداد:
    //    الافتراضي: المخالفات ← الأثاث ← ديون الأشخاص. القروض التي لا تسمح بالسداد الإضافي
    //    (مثل القرض الصغير: إغلاق كامل فقط بقرار المستخدم) لا تُوزَّع عليها أي مبالغ تلقائيًا.
    if (isAuto && !closed) {
      const cands = lines.filter((l) => l.type === 'debt' && l.engineManaged && !l.regRealized && l.item.extra === 'allow');
      cands.sort((a, b) => prioRank(a.item) - prioRank(b.item));
      for (const l of cands) {
        if (avail <= 0) break;
        const remaining = l.balStart - l.arrStart - l.projReg; // دون العجز (يُسدد في د)
        if (remaining <= 0) continue;
        const got = take(remaining); l.extraSuggested = got; l.projReg += got;
      }
    }

    // تحديث الأرصدة والعجز
    let fundingGap = 0;
    for (const l of lines) {
      const regUsed = l.regRealized ? l.paidReg : l.projReg;
      const arrUsed = l.arrRealized ? l.paidArr : l.projArr;
      if (l.engineManaged && !l.regRealized) l.planned = Math.max(l.planned, l.projReg + l.unmet);
      if (l.engineManaged && l.regRealized && l.paidReg > l.planned) l.planned = l.paidReg;
      l.regUsed = regUsed; l.arrUsed = arrUsed;
      const shortfall = l.regRealized ? Math.max(0, l.plannedForDeficit - l.paidReg) : l.unmet;
      l.shortfall = shortfall;
      if (!l.regRealized) fundingGap += l.unmet;
      l.arrRemaining = Math.max(0, l.arrStart - l.paidArr);
      if (l.type === 'debt') {
        bal[l.id] = l.balStart - regUsed - arrUsed;
        l.balEnd = bal[l.id];
        arr[l.id] = Math.max(0, Math.min(l.arrStart - arrUsed + shortfall, Math.max(0, bal[l.id])));
      } else {
        arr[l.id] = l.carry ? Math.max(0, l.arrStart - arrUsed + shortfall) : 0;
      }
      l.arrEnd = arr[l.id];
      // حالة علامة الصح
      if (l.planned <= 0 && l.paidReg === 0 && l.pendingReg === 0) l.status = 'na';
      else if (l.paidReg >= l.planned && l.paidReg > 0) l.status = 'done';
      else if (l.paidReg > 0) l.status = 'partial';
      else if (l.pendingReg > 0) l.status = 'recorded';
      else l.status = 'none';
      l.belowMandatory = l.type === 'debt' && l.regRealized && l.mandatoryCap > 0 && l.paidReg < l.mandatoryCap;
    }

    const projectedOut = lines.reduce((a, l) => a + (l.regRealized ? 0 : l.projReg) + (l.arrRealized ? 0 : l.projArr), 0);
    cash = cash + income - visaOut - actualOut - projectedOut;

    const plannedTotal = lines.reduce((a, l) => a + l.planned, 0);
    const arrearsTotal = lines.reduce((a, l) => a + l.arrStart, 0);
    const paidTotal = actualOut;
    const debtPaidThisMonth = lines.filter((l) => l.type === 'debt').reduce((a, l) => a + l.regUsed + l.arrUsed, 0);

    months.push({
      key, idx, closed, isAuto,
      income: { salary: sal, rent, extras: extraAmt, planned: income, received: receivedIncome },
      cashStart, visaOut, lines,
      plannedTotal, arrearsTotal, paidTotal, projectedOut, actualOut, debtPaidThisMonth,
      cashEnd: cash, fundingGap,
      debtBalancesEnd: Object.fromEntries(debts.map((d) => [d.id, bal[d.id] === null ? d.opening : bal[d.id]])),
    });

    const allStarted = debts.every((d) => key >= d.start);
    const allZero = allStarted && debts.every((d) => (bal[d.id] ?? d.opening) <= 0);
    if (allZero && endIdx === null) endIdx = idx;
    if (endIdx !== null && idx >= untilIdx) break;
  }

  return {
    months,
    endMonth: endIdx === null ? null : monthKey(endIdx),
    byKey: Object.fromEntries(months.map((m) => [m.key, m])),
  };
}

/* ───────────── لوحة المعلومات (من الفعلي فقط) ───────────── */

export function debtStatus(state, debt) {
  const adj = state.adjustments.filter((a) => a.itemId === debt.id).reduce((a, x) => a + x.delta, 0);
  const paid = confirmedPayments(state).filter((p) => p.itemId === debt.id).reduce((a, x) => a + x.amount, 0);
  const pending = state.payments.filter((p) => p.itemId === debt.id && p.confirmed === false).reduce((a, x) => a + x.amount, 0);
  const original = debt.opening + adj;
  return { opening: debt.opening, original, paid, pending, adj, remaining: Math.max(0, original - paid), overpaid: Math.max(0, paid - original) };
}

export function dashboard(state, sim) {
  let original = 0; let paid = 0; let remaining = 0; let initial = 0; let inferred = 0;
  for (const d of debtsOf(state)) {
    const st = debtStatus(state, d);
    original += st.original; paid += st.paid; remaining += st.remaining; initial += d.opening;
    if (d.openingInferred) inferred += d.opening;
  }
  // نسبة الإنجاز = انخفاض الرصيد الفعلي ÷ الإجمالي (شاملًا التصحيحات)
  const reduced = Math.max(0, original - remaining);
  const end = sim.endMonth;
  const base = state.baseline?.endMonth || null;
  const delta = end && base ? monthIndex(end) - monthIndex(base) : null; // سالب = متقدم
  return { initial, original, paid, remaining, reduced, inferred, endMonth: end, baselineEnd: base, deltaMonths: delta };
}

/* ───────────── الفيزا ───────────── */

/** نهاية دورة الكشف التي يقع فيها التاريخ: حتى يوم 15 (شاملًا) → كشف نفس الشهر، بعده → الشهر التالي */
export function visaCycleEnd(date, statementDay = 15) {
  const m = monthOfDate(date);
  const d = Number(date.slice(8, 10));
  return d <= statementDay ? dateIn(m, statementDay) : dateIn(addMonths(m, 1), statementDay);
}

export function visaSummary(state, today = kuwaitToday()) {
  const v = state.visa;
  const sd = state.settings.visaStatementDay;
  const limit = state.settings.visaLimit;
  const totalPurch = v.purchases.reduce((a, p) => a + p.amount, 0);
  const totalPaid = v.payments.reduce((a, p) => a + p.amount, 0);
  const used = Math.max(0, totalPurch - totalPaid);
  const available = limit - used;

  const cycles = new Map();
  for (const p of v.purchases) {
    const ce = visaCycleEnd(p.date, sd);
    cycles.set(ce, (cycles.get(ce) || 0) + p.amount);
  }
  const confirmed = new Map(v.statements.map((s) => [s.cycleEnd, s]));
  const pending = [...cycles.entries()]
    .filter(([ce]) => ce <= today && !confirmed.has(ce))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([cycleEnd, amount]) => ({ cycleEnd, amount }));
  const drift = v.statements
    .map((s) => ({ ...s, computed: cycles.get(s.cycleEnd) || 0 }))
    .filter((s) => s.computed !== s.amount);

  const statements = [...v.statements].sort((a, b) => (a.cycleEnd < b.cycleEnd ? 1 : -1));
  const last = statements[0] || null;
  const billed = v.statements.reduce((a, s) => a + s.amount, 0);
  const dueUnpaid = Math.max(0, billed - totalPaid);
  const currentCycle = visaCycleEnd(today, sd);
  const currentCyclePurch = cycles.get(currentCycle) || 0;
  const lastEnd = last ? last.cycleEnd : '0000-00-00';
  const unbilled = [...cycles.entries()].filter(([ce]) => ce > lastEnd).reduce((a, [, x]) => a + x, 0);
  return {
    limit, used, available, totalPurch, totalPaid, billed, dueUnpaid,
    last, statements, pending, drift, currentCycle, currentCyclePurch, unbilled,
  };
}

/* ───────────── السيناريو ───────────── */

export function scenarioExtras(sc) {
  const out = [];
  if (!sc || !(sc.amount > 0)) return out;
  if (sc.type === 'once') {
    out.push({ id: 'sc', month: sc.month, amount: sc.amount, status: 'adopted', name: 'سيناريو' });
  } else {
    const a = monthIndex(sc.start);
    const b = sc.end ? monthIndex(sc.end) : a + MAX_MONTHS;
    for (let i = a; i <= b && i < a + MAX_MONTHS; i++) {
      out.push({ id: `sc${i}`, month: monthKey(i), amount: sc.amount, status: 'adopted', name: 'سيناريو' });
    }
  }
  return out;
}

export function runScenario(state, sc, today = kuwaitToday()) {
  const cur = simulate(state, { today });
  const alt = simulate(state, { today, virtualExtras: scenarioExtras(sc) });
  const last = [cur.endMonth, alt.endMonth].filter(Boolean).sort().pop() || cur.months[cur.months.length - 1].key;
  const curL = simulate(state, { today, until: last });
  const altL = simulate(state, { today, until: last, virtualExtras: scenarioExtras(sc) });
  const rows = [];
  const firstOpen = curL.months.find((m) => !m.closed);
  const from = firstOpen ? firstOpen.key : monthOfDate(today);
  for (const m of curL.months) {
    if (m.key < from) continue;
    if (m.key > last) break;
    const a = altL.byKey[m.key];
    rows.push({ key: m.key, current: m.debtPaidThisMonth, scenario: a ? a.debtPaidThisMonth : 0 });
  }
  const diff = cur.endMonth && alt.endMonth ? monthIndex(alt.endMonth) - monthIndex(cur.endMonth) : null;
  return { currentEnd: cur.endMonth, scenarioEnd: alt.endMonth, diffMonths: diff, rows };
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/* ───────────── ترحيل البيانات المحفوظة (بلا حذف) ───────────── */

/**
 * يرفع البيانات المحفوظة إلى أحدث نموذج دون حذف أي شيء.
 * يرجع { state, changed }. لا يمس الدفعات أو الأرصدة أو الكشوف.
 */
export function migrate(input) {
  const state = input;
  let changed = false;
  const from = state.schema || 1;
  state.settings = state.settings || {};
  state.recurring = state.recurring || [];
  state.extras = state.extras || [];
  state.payments = state.payments || [];
  state.adjustments = state.adjustments || [];
  state.visa = state.visa || { purchases: [], payments: [], statements: [] };
  state.log = state.log || [];
  if (from < 2) {
    // v2: أولويات السداد، حالة تأكيد الدفعات، إقفال الشهر مستقل عن يوم الراتب
    if (!Array.isArray(state.settings.payoffPriority)) {
      const ids = new Set(state.items.map((i) => i.id));
      const extraIds = state.items.filter((i) => i.type === 'debt' && i.extra === 'allow' && !DEFAULT_PRIORITY.includes(i.id))
        .sort((a, b) => a.order - b.order).map((i) => i.id);
      state.settings.payoffPriority = [...DEFAULT_PRIORITY.filter((id) => ids.has(id)), ...extraIds];
    }
    // الدفعات في النسخة الأولى كانت كلها تأكيدات سداد
    for (const p of state.payments) if (p.confirmed === undefined) p.confirmed = true;
    const small = state.items.find((i) => i.id === 'small');
    if (small && small.openingInferred) small.note = 'رصيد مستنتج من مجموع الأقساط المجدولة (5×170 + 90 = 940) — ليس رصيدًا بنكيًا مؤكدًا. عدّله إذا عرفت الرصيد الحقيقي.';
    const oldBaseline = state.baseline?.endMonth || null;
    state.baseline = { endMonth: simulate(state, { baseline: true }).endMonth, previous: oldBaseline };
    state.schema = 2;
    state.log.push({ ts: new Date().toISOString(), text: 'تحديث نموذج البيانات إلى الإصدار 2 (أولويات السداد وتأكيد الدفعات) — دون حذف أي بيانات.' });
    changed = true;
  }
  return { state, changed };
}

/* ───────────── موثوقية التوقع ───────────── */

/** تنبيهات تبيّن ما يعتمد عليه موعد الإغلاق المتوقع */
export function planReliability(state, sim, today = kuwaitToday()) {
  const unconfirmedPast = [];
  const gaps = [];
  for (const m of sim.months) {
    if (m.closed) {
      for (const l of m.lines) if (l.planned > 0 && l.paidReg === 0 && l.carry) unconfirmedPast.push({ key: m.key, id: l.id });
    } else if (m.fundingGap > 0) gaps.push({ key: m.key, amount: m.fundingGap });
  }
  const futureIncomeUnconfirmed = sim.months.filter((m) => !m.closed && !m.income.salary.received).length;
  const inferred = debtsOf(state).filter((d) => d.openingInferred);
  const pendingExtras = state.extras.filter((e) => e.status === 'pending');
  return { unconfirmedPast, gaps, futureIncomeUnconfirmed, inferred, pendingExtras, reliable: !!sim.endMonth && gaps.length === 0 };
}
