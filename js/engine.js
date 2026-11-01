// محرك الخطة المالية — دوال نقية حتمية. كل المبالغ بالفلس (أعداد صحيحة).
//
// المبادئ المحاسبية:
// 1) الرصيد الحقيقي للدين = الرصيد المرجعي + التصحيحات − الدفعات المؤكدة. لا شيء غير مؤكد يُخصم.
// 2) الأشهر الماضية لا تولّد سيولة: السيولة الوحيدة المعتمدة هي «الرصيد النقدي المتاح» الذي يُدخله
//    المستخدم، مضافًا إليه التدفقات المؤكدة بعد تاريخه، ثم التوقعات للشهر الحالي وما بعده.
// 3) البند غير المسجل في شهر ماضٍ «غير مسجل» (مجهول): لا يُعتبر مدفوعًا ولا عجزًا مؤكدًا.
//    العجز المؤكد ينشأ فقط من دفعة جزئية مسجلة أو من إقفال الشهر يدويًا مع مبلغ غير مسدد.
// 4) العجز ليس دينًا إضافيًا: هو جزء من الرصيد الحقيقي، ويُسقف به.
import { parseKD } from './money.js';

export const SCHEMA = 3;
export const DEFAULT_PRIORITY = ['violations', 'furniture', 'p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama'];
const SEEDED_PERSONS = ['p_suhail', 'p_shafiq', 'p_electric', 'p_abuosama'];
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
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

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

/** إقفال الشهر يدوي فقط — لا إقفال تلقائي يحوّل المجهول إلى عجز */
export const isMonthClosed = (state, key) => !!state.months[key]?.closed;
/** الدفعات المؤكدة فقط تدخل في الأرصدة والعجز والإجماليات */
export const confirmedPayments = (state) => state.payments.filter((p) => p.confirmed !== false);
/** الشهر الحالي = أول شهر توقّعي. ما قبله تاريخي لا يولّد سيولة. */
export const forecastStartOf = (state, today) => {
  const m = monthOfDate(today);
  return m < state.settings.planStart ? state.settings.planStart : m;
};

/* ───────────── البيانات الأولية ───────────── */

let _idc = 0;
export function uid(prefix = 'x') {
  _idc += 1;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${_idc}`;
}

const KD = (n) => parseKD(String(n)); // تحويل نصي دقيق إلى فلس

export function seedReserves() {
  return [{
    id: 'res_uni', name: 'احتياطي الجامعة', icon: '🎓', month: '2027-01', amount: KD(450),
    targetItem: 'uni', targetMonth: '2027-02', heldDate: null,
    note: '300 من راتب يناير + 150 من بدل إيجار يناير (يصل في فبراير) — يُحجز مرة واحدة ويُستخدم لدفع رسوم الجامعة.',
  }];
}

export function createSeedState(nowIso = new Date().toISOString()) {
  const items = [
    { id: 'furniture', type: 'debt', group: 'loan', name: 'قرض الأثاث', icon: '🛋️', opening: KD(5510), mandatory: KD(460), extra: 'allow', start: '2026-09', order: 1 },
    { id: 'violations', type: 'debt', group: 'loan', name: 'قرض المخالفات', icon: '🚦', opening: KD(3672), mandatory: KD(164), extra: 'allow', start: '2026-09', order: 2 },
    { id: 'small', type: 'debt', group: 'loan', name: 'القرض الصغير', icon: '💳', opening: KD(940), openingInferred: true, mandatory: KD(170), extra: 'closeOnly', start: '2026-09', order: 3,
      note: 'رصيد مستنتج من مجموع الأقساط المجدولة (5×170 + 90 = 940) — ليس رصيدًا بنكيًا مؤكدًا. عدّله إذا عرفت الرصيد الحقيقي.' },
    { id: 'shuoon', type: 'debt', group: 'loan', name: 'الشؤون', icon: '🏛️', opening: KD(559), mandatory: KD(137.5), extra: 'none', start: '2026-10', order: 4,
      note: 'مجموع الدفعات المجدولة: 4×137.500 + 9 = 559. تبدأ في أكتوبر 2026. لا سداد مبكر إضافي دون تأكيد.' },
    { id: 'p_suhail', type: 'debt', group: 'person', name: 'سهيل', icon: '👤', opening: KD(550), mandatory: 0, extra: 'allow', start: '2026-09', order: 10, verified: false },
    { id: 'p_shafiq', type: 'debt', group: 'person', name: 'شفيق', icon: '👤', opening: KD(24), mandatory: 0, extra: 'allow', start: '2026-09', order: 11, verified: false },
    { id: 'p_electric', type: 'debt', group: 'person', name: 'الكهربائي', icon: '👤', opening: KD(20), mandatory: 0, extra: 'allow', start: '2026-09', order: 12, verified: false },
    { id: 'p_abuosama', type: 'debt', group: 'person', name: 'أبو أسامة', icon: '👤', opening: KD(450), mandatory: 0, extra: 'allow', start: '2026-09', order: 13, verified: false },
    { id: 'maid', type: 'expense', name: 'الخادمة', icon: '🧹', carry: true, schedule: [{ from: '2026-09', amount: KD(140) }], order: 20 },
    { id: 'bills', type: 'expense', name: 'الفواتير', icon: '💡', carry: true, schedule: [{ from: '2026-09', amount: KD(100) }, { from: '2026-11', amount: KD(80) }], order: 21 },
    { id: 'personal', type: 'expense', name: 'المصروف الشخصي', icon: '👛', carry: false, schedule: [{ from: '2026-09', amount: KD(190) }], order: 22 },
    { id: 'uni', type: 'expense', name: 'تسجيل الجامعة', icon: '🎓', carry: true, once: '2027-02', schedule: [{ from: '2027-02', amount: KD(450) }], order: 23 },
  ];
  for (const it of items) { it.createdAt = nowIso; if (it.type === 'debt') it.closedConfirmed = false; }

  // الخطة الأصلية (سبتمبر 2026 – فبراير 2027) — أرقام خطة وليست إثباتًا للسداد
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
  months['2027-01'].notes = 'المخالفات 252.150. احتياطي الجامعة 450 = 300 من الراتب + 150 من بدل إيجار يناير (يصل في فبراير).';
  months['2026-10'].notes = 'لشهر أكتوبر تسويات خاصة سابقة — عدّل البنود والدخل والتواريخ يدويًا حسب الواقع.';

  return {
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
      cash: { amount: 0, date: null, note: '' },
    },
    items,
    months,
    reserves: seedReserves(),
    extras: [],
    recurring: [],
    payments: [],
    adjustments: [],
    visa: { purchases: [], payments: [], statements: [] },
    log: [{ ts: nowIso, text: 'إنشاء الخطة الأصلية — جميع البنود غير مسجلة.' }],
  };
}

/* ───────────── أدوات البنود والدخل ───────────── */

export const debtsOf = (state) => state.items.filter((i) => i.type === 'debt');
export const expensesOf = (state) => state.items.filter((i) => i.type === 'expense');
export const itemById = (state, id) => state.items.find((i) => i.id === id);
/** دين شخص لم يتحقق المستخدم من استحقاقه: لا يدخل الجدولة التلقائية ولا شرط الإغلاق */
export const isUnverifiedPerson = (d) => d.type === 'debt' && d.group === 'person' && d.verified === false;

export function expenseAmountFor(item, key) {
  if (item.once && item.once !== key) return 0;
  if (item.endMonth && key > item.endMonth) return 0;
  let amt = 0;
  for (const s of [...(item.schedule || [])].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (s.from <= key) amt = s.amount;
  }
  return amt;
}

function incomeRecord(raw, plannedDefault, expectedDate) {
  const r = raw || {};
  const amount = r.amount ?? plannedDefault;
  const received = !!r.received;
  return {
    amount, // المخطط
    date: r.date || expectedDate, // تاريخ الاستحقاق/الوصول المتوقع
    received,
    receivedAmount: received ? (r.receivedAmount ?? amount) : null,
    receivedDate: received ? (r.receivedDate || r.date || expectedDate) : null,
  };
}

export function salaryFor(state, key) {
  const s = state.settings;
  return { ...incomeRecord(state.months[key]?.salary, s.salaryDefault, dateIn(key, s.salaryDay)), allocMonth: key };
}

/** بدل إيجار الشهر key: يُخصص لشهر key افتراضيًا (allocMonth) ويصل عادة بداية الشهر التالي */
export function rentFor(state, key) {
  const s = state.settings;
  const raw = state.months[key]?.rent;
  return { ...incomeRecord(raw, s.rentDefault, dateIn(addMonths(key, 1), s.rentArrivalDay)), allocMonth: raw?.allocMonth || key, ofMonth: key };
}

/** كل بدلات الإيجار المخصصة لشهر مالي (بدل الإيجار الواحد يُخصص لشهر واحد فقط) */
export function rentsAllocatedTo(state, key) {
  const out = [];
  const own = rentFor(state, key);
  if (own.allocMonth === key) out.push(own);
  for (const [m, md] of Object.entries(state.months)) {
    if (m !== key && md.rent?.allocMonth === key) out.push(rentFor(state, m));
  }
  return out;
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
 * opts.today          تاريخ اليوم (YYYY-MM-DD)
 * opts.until          أقل شهر يجب الوصول إليه
 * opts.virtualExtras  دخل افتراضي للسيناريو (لا يُحفظ)
 * opts.baseline       الخطة كما كُتبت: بلا بيانات فعلية، والأشهر الماضية مفترضة حسب الخطة دون أي فائض نقدي منها
 * opts.assumeHistory  تقدير: اعتبر البنود غير المسجلة في الأشهر الماضية مدفوعة حسب الخطة (للمقارنة فقط)
 */
export function simulate(state, opts = {}) {
  const s = state.settings;
  const baseline = !!opts.baseline;
  const assumeHist = !!opts.assumeHistory || baseline;
  const today = opts.today || kuwaitToday();
  const untilIdx = opts.until ? monthIndex(opts.until) : -Infinity;
  const startIdx = monthIndex(s.planStart);
  const autoFromIdx = monthIndex(s.autoFrom);
  const F = forecastStartOf(state, today);
  const Fidx = monthIndex(F);

  // نقطة الارتكاز النقدية: كل تدفق مؤكد بتاريخ ≤ anchorDate مُضمَّن في الرصيد الذي أدخله المستخدم
  const cashCfg = s.cash || { amount: 0, date: null };
  const fStartPrev = addDays(dateIn(F, 1), -1);
  const anchorDate = baseline ? '0000-00-00' : (cashCfg.date && cashCfg.date > fStartPrev ? cashCfg.date : fStartPrev);
  const anchorAmount = baseline ? 0 : (cashCfg.amount || 0);
  const afterAnchor = (date) => !date || date > anchorDate;
  /** شهر الأثر النقدي لتدفق مؤكد: الشهر المالي إن كان توقعيًا، وإلا الشهر الحالي إن حدث بعد الارتكاز */
  const cashMonthOf = (fiscal, date) => {
    if (baseline) return fiscal;
    if (!afterAnchor(date)) return null;
    return fiscal >= F ? fiscal : F;
  };

  const confirmed = baseline ? [] : confirmedPayments(state);
  const payMap = sumBy(confirmed, (p) => `${p.month}|${p.itemId}|${p.kind}`);
  const payCashMap = sumBy(confirmed.filter((p) => afterAnchor(p.date)), (p) => `${p.month}|${p.itemId}|${p.kind}`);
  const pendingMap = sumBy(baseline ? [] : state.payments.filter((p) => p.confirmed === false), (p) => `${p.month}|${p.itemId}|${p.kind}`);
  // التصحيحات تُخزن كفرق (delta)
  const adjMap = sumBy(baseline ? [] : state.adjustments.map((a) => ({ itemId: a.itemId, amount: a.delta })), (a) => a.itemId);
  const priority = s.payoffPriority || DEFAULT_PRIORITY;
  const prioRank = (item) => { const i = priority.indexOf(item.id); return i < 0 ? 1e6 + item.order : i; };

  // تعديلات نقدية مسبقة لكل شهر (من تدفقات مؤكدة لأشهر ماضية حدثت بعد الارتكاز، والفيزا)
  const cashAdj = new Map();
  const addCash = (m, amt) => { if (m) cashAdj.set(m, (cashAdj.get(m) || 0) + amt); };
  if (!baseline) {
    for (const p of confirmed) if (p.month < F) addCash(cashMonthOf(p.month, p.date), -p.amount);
    for (const p of state.visa.payments) if (p.cashMonth) addCash(cashMonthOf(p.cashMonth, p.date), -p.amount);
    for (const e of state.extras) if (e.status === 'received') addCash(cashMonthOf(e.month, e.date), e.amount);
    for (const r of state.reserves || []) if (r.heldDate) addCash(cashMonthOf(r.month, r.heldDate), -r.amount);
  }
  const visaOutMap = sumBy(baseline ? [] : state.visa.payments.filter((p) => p.cashMonth), (p) => p.cashMonth);
  const virtualMap = sumBy(opts.virtualExtras || [], (e) => e.month);
  const adoptedMap = sumBy(baseline ? [] : state.extras.filter((e) => e.status === 'adopted'), (e) => e.month);

  const debts = debtsOf(state).sort((a, b) => a.order - b.order);
  const expenses = expensesOf(state).sort((a, b) => a.order - b.order);
  const reserves = state.reserves || [];
  const bal = {}; const arrC = {}; const arrP = {}; const pot = {};
  for (const d of debts) { bal[d.id] = null; arrC[d.id] = 0; arrP[d.id] = 0; }
  for (const e of expenses) { arrC[e.id] = 0; arrP[e.id] = 0; }
  for (const r of reserves) pot[r.id] = 0;

  let cash = 0;
  let endIdx = null;
  const months = [];

  for (let k = 0; k < MAX_MONTHS; k++) {
    const idx = startIdx + k;
    const key = monthKey(idx);
    const md = state.months[key] || {};
    const planVals = md.plan || {};
    const past = idx < Fidx;
    const forecast = !past;
    const closed = !baseline && !!md.closed;
    const isAuto = idx >= autoFromIdx;

    // ── الدخل (عرض): المخطط والمستلم، بدل الإيجار حسب شهر تخصيصه
    const sal = salaryFor(state, key);
    const rents = rentsAllocatedTo(state, key);
    const rentOwn = rentFor(state, key);
    const recurringAmt = baseline ? 0 : (state.recurring || [])
      .filter((r) => r.start <= key && (!r.end || key <= r.end)).reduce((a, r) => a + r.amount, 0);
    const receivedExtras = baseline ? 0 : state.extras.filter((e) => e.month === key && e.status === 'received').reduce((a, e) => a + e.amount, 0);
    const adopted = adoptedMap.get(key) || 0;
    const virtualAmt = virtualMap.get(key) || 0;
    const incomePlanned = sal.amount + rents.reduce((a, r) => a + r.amount, 0) + receivedExtras + adopted + recurringAmt + virtualAmt;
    const incomeReceived = baseline ? 0 : ((sal.received ? sal.receivedAmount : 0)
      + rents.reduce((a, r) => a + (r.received ? r.receivedAmount : 0), 0) + receivedExtras);

    // ── السيولة: الأشهر الماضية لا تولّد سيولة
    if (idx === Fidx) cash = anchorAmount;
    const cashBefore = forecast ? cash : null;
    let incomeCash = 0;
    if (forecast) {
      const incomeItems = [sal, ...rents];
      for (const it of incomeItems) {
        if (baseline || !it.received) incomeCash += it.amount; // متوقع (غير مستلم)
        else if (afterAnchor(it.receivedDate)) incomeCash += it.receivedAmount; // مستلم بعد الارتكاز
      }
      incomeCash += adopted + recurringAmt + virtualAmt;
      // الدخل المستلم لأشهر ماضية بعد الارتكاز يدخل الشهر الحالي
      if (!baseline && idx === Fidx) {
        for (let j = startIdx; j < Fidx; j++) {
          const pk = monthKey(j);
          for (const it of [salaryFor(state, pk), ...rentsAllocatedTo(state, pk)]) {
            if (it.received && afterAnchor(it.receivedDate)) incomeCash += it.receivedAmount;
          }
        }
      }
      cash += incomeCash + (cashAdj.get(key) || 0);
    }

    const lines = [];
    const mkLine = (o) => ({
      projReg: 0, projArr: 0, extraSuggested: 0, unmet: 0, potCover: 0, regCash: 0, arrCash: 0, ...o,
    });
    // الديون
    for (const d of debts) {
      if (key < d.start) continue;
      if (bal[d.id] === null) bal[d.id] = d.opening + (adjMap.get(d.id) || 0);
      const balStart = bal[d.id];
      const kR = `${key}|${d.id}|regular`; const kA = `${key}|${d.id}|arrears`;
      const paidReg = payMap.get(kR) || 0; const paidArr = payMap.get(kA) || 0;
      const pendingReg = pendingMap.get(kR) || 0;
      if (balStart <= 0 && paidReg === 0 && paidArr === 0) continue; // مغلق: لا مطالبات
      const arrCs = Math.max(0, Math.min(arrC[d.id], balStart));
      const arrPs = Math.max(0, Math.min(arrP[d.id], balStart - arrCs));
      const arrStart = arrCs + arrPs;
      const dueCap = Math.max(0, balStart - arrStart);
      const unverified = isUnverifiedPerson(d);
      const stored = Object.prototype.hasOwnProperty.call(planVals, d.id) ? planVals[d.id] : null;
      const mandatoryCap = Math.min(d.mandatory || 0, dueCap);
      let plannedRaw; let engineManaged = false;
      if (stored !== null) plannedRaw = stored;
      else if (isAuto && !unverified) { plannedRaw = mandatoryCap; engineManaged = true; } else plannedRaw = d.mandatory || 0;
      const planned = Math.min(plannedRaw, dueCap); // لا يتجاوز المطلوب رصيد القرض
      const hasReg = paidReg > 0;
      const realized = hasReg || closed;
      lines.push(mkLine({
        id: d.id, type: 'debt', group: d.group, name: d.name, icon: d.icon, item: d, unverified,
        mandatory: d.mandatory || 0, mandatoryCap, stored, engineManaged,
        balStart, arrStart, arrStartC: arrCs, arrStartP: arrPs, dueCap, planned,
        plannedForDeficit: engineManaged ? mandatoryCap : planned,
        paidReg, paidArr, pendingReg,
        regCash: payCashMap.get(kR) || 0, arrCash: payCashMap.get(kA) || 0,
        regRealized: realized, arrRealized: closed || paidArr > 0,
        unknown: past && !realized && planned > 0,
        carry: true,
      }));
    }
    // المصاريف والالتزامات الشهرية
    for (const e of expenses) {
      const stored = Object.prototype.hasOwnProperty.call(planVals, e.id) ? planVals[e.id] : null;
      const plannedRaw = stored !== null ? stored : expenseAmountFor(e, key);
      const kR = `${key}|${e.id}|regular`; const kA = `${key}|${e.id}|arrears`;
      const paidReg = payMap.get(kR) || 0; const paidArr = payMap.get(kA) || 0;
      const pendingReg = pendingMap.get(kR) || 0;
      const arrCs = e.carry ? arrC[e.id] : 0; const arrPs = e.carry ? arrP[e.id] : 0;
      if (plannedRaw === 0 && paidReg === 0 && paidArr === 0 && arrCs + arrPs === 0 && pendingReg === 0) continue;
      const realized = (e.carry ? paidReg > 0 : false) || closed;
      lines.push(mkLine({
        id: e.id, type: 'expense', name: e.name, icon: e.icon, item: e, unverified: false,
        mandatory: 0, mandatoryCap: 0, stored, engineManaged: false,
        balStart: null, arrStart: arrCs + arrPs, arrStartC: arrCs, arrStartP: arrPs, dueCap: plannedRaw,
        planned: plannedRaw, plannedForDeficit: plannedRaw,
        paidReg, paidArr, pendingReg,
        regCash: payCashMap.get(kR) || 0, arrCash: payCashMap.get(kA) || 0,
        regRealized: realized, arrRealized: closed || paidArr > 0,
        unknown: past && !(paidReg > 0) && !closed && plannedRaw > 0,
        carry: !!e.carry,
      }));
    }
    // الاحتياطيات (تخصيص نقدي، وليس مصروفًا ثانيًا)
    const resLines = [];
    for (const r of reserves) {
      if (r.month !== key) continue;
      const held = !baseline && !!r.heldDate;
      resLines.push({ id: r.id, type: 'reserve', name: r.name, icon: r.icon || '🔒', reserve: r, planned: r.amount, held,
        unknown: past && !held, status: held ? 'done' : (past ? 'unknown' : 'none'), projHold: 0, unmet: 0 });
    }
    // تغطية من الاحتياطي للبنود المستهدفة في هذا الشهر
    const coverFor = new Map();
    for (const r of reserves) if (r.targetMonth === key) coverFor.set(r.targetItem, [...(coverFor.get(r.targetItem) || []), r]);
    const takePot = (itemId, need) => {
      let got = 0;
      for (const r of coverFor.get(itemId) || []) {
        const x = Math.min(pot[r.id], need - got);
        if (x > 0) { pot[r.id] -= x; got += x; }
      }
      return got;
    };

    let fundingGap = 0;
    let actualOut = 0;
    if (forecast) {
      // ── الشهر الحالي وما بعده: السيولة المؤكدة + المتوقعة
      // الدفعات المؤكدة (ما بعد الارتكاز) تخرج من السيولة، مع تغطية الاحتياطي أولًا
      for (const l of lines) {
        const cover = takePot(l.id, l.paidReg);
        l.potCover = cover;
        const regOut = Math.max(0, l.regCash - cover);
        cash -= regOut + l.arrCash;
      }
      actualOut = lines.reduce((a, l) => a + l.paidReg + l.paidArr, 0);
      const take = (need) => {
        if (need <= 0) return 0;
        const got = Math.max(0, Math.min(need, cash));
        cash -= got;
        return got;
      };
      const projNeed = (l, need) => { // يغطي من الاحتياطي ثم من السيولة
        const c = takePot(l.id, need); l.potCover += c;
        const got = take(need - c);
        return { got: got + c, unmet: need - c - got };
      };
      // أ) المصاريف الأساسية — تُحجز كاملة حتى لو لم يُؤكد صرفها (والمصروف غير القابل للترحيل يُحجز حتى إقفال الشهر)
      for (const l of lines) if (l.type === 'expense') {
        const need = l.regRealized ? 0 : Math.max(0, l.planned - l.paidReg);
        const r = projNeed(l, need); l.projReg = r.got; l.unmet += r.unmet;
      }
      // ب) الأقساط الإلزامية
      for (const l of lines) if (l.type === 'debt' && !l.regRealized) {
        const need = Math.min(l.planned, l.mandatoryCap);
        const r = projNeed(l, need); l.projReg = r.got; l.unmet += r.unmet;
      }
      // ج) باقي الدفعة المخططة
      for (const l of lines) if (l.type === 'debt' && !l.regRealized) {
        const need = l.planned - Math.min(l.planned, l.mandatoryCap);
        const r = projNeed(l, need); l.projReg += r.got; l.unmet += r.unmet;
      }
      // ج2) حجز الاحتياطيات المخططة
      for (const rl of resLines) {
        if (rl.held) { pot[rl.id] += rl.planned; continue; }
        const got = take(rl.planned); rl.projHold = got; rl.unmet = rl.planned - got; pot[rl.id] += got;
        fundingGap += rl.unmet;
      }
      // د) العجز المرحّل (المؤكد أولًا ثم المتوقع)
      for (const l of [...lines.filter((x) => x.type === 'expense'), ...lines.filter((x) => x.type === 'debt')]) {
        if (l.arrRealized || l.arrStart <= 0) continue;
        l.projArr = take(l.arrStart);
      }
      // هـ) الفائض حسب أولويات السداد (أشهر الجدولة التلقائية فقط)
      if (isAuto && !closed) {
        const cands = lines.filter((l) => l.type === 'debt' && l.engineManaged && !l.regRealized && l.item.extra === 'allow' && !l.unverified);
        cands.sort((a, b) => prioRank(a.item) - prioRank(b.item));
        for (const l of cands) {
          if (cash <= 0) break;
          const remaining = l.dueCap - l.projReg;
          if (remaining <= 0) continue;
          const got = take(remaining); l.extraSuggested = got; l.projReg += got;
        }
      }
      // الاحتياطي المتبقي بعد شهر الاستخدام يعود للسيولة (لم يُصرف)
      for (const r of reserves) if (r.targetMonth === key && pot[r.id] > 0) { cash += pot[r.id]; pot[r.id] = 0; }
      // سداد الفيزا محسوب ضمن cashAdj بتاريخه ولشهر واحد فقط
    } else {
      // ── شهر تاريخي: لا سيولة. الاحتياطي المؤكد فقط ينتقل للمستقبل.
      for (const rl of resLines) {
        if (rl.held || (assumeHist && rl.unknown)) pot[rl.id] += rl.planned;
      }
      for (const l of lines) l.potCover = takePot(l.id, l.paidReg);
      actualOut = lines.reduce((a, l) => a + l.paidReg + l.paidArr, 0);
    }

    // ── تحديث الأرصدة والعجز
    for (const l of lines) {
      let regUsed;
      if (l.regRealized) regUsed = l.paidReg;
      else if (forecast) regUsed = l.paidReg + l.projReg;
      else regUsed = l.paidReg + (assumeHist && l.unknown ? Math.max(0, l.planned - l.paidReg) : 0);
      if (l.type === 'expense' && !l.carry) regUsed = l.paidReg + (forecast ? l.projReg : 0);
      const arrUsed = (l.arrRealized || past) ? l.paidArr : l.projArr;
      if (l.engineManaged && !l.regRealized && forecast) l.planned = Math.max(l.planned, l.projReg + l.unmet);
      if (l.engineManaged && l.regRealized && l.paidReg > l.planned) l.planned = l.paidReg;
      l.regUsed = regUsed; l.arrUsed = arrUsed;
      // العجز المؤكد: دفعة جزئية مسجلة، أو إقفال يدوي مع مبلغ غير مسدد
      const sfC = l.carry && l.regRealized ? Math.max(0, l.plannedForDeficit - l.paidReg) : 0;
      // العجز المتوقع: نقص سيولة في شهر توقعي
      const sfP = l.carry && forecast && !l.regRealized ? l.unmet : 0;
      l.shortfall = sfC + sfP; l.shortfallConfirmed = sfC; l.shortfallProjected = sfP;
      if (forecast) fundingGap += l.unmet;
      l.arrRemaining = Math.max(0, l.arrStart - l.paidArr);
      const fromC = Math.min(arrUsed, l.arrStartC);
      let nC = l.arrStartC - fromC + sfC;
      let nP = Math.max(0, l.arrStartP - (arrUsed - fromC)) + sfP;
      if (l.type === 'debt') {
        bal[l.id] = l.balStart - regUsed - arrUsed;
        l.balEnd = bal[l.id];
        nC = Math.min(nC, Math.max(0, bal[l.id]));
        nP = Math.min(nP, Math.max(0, bal[l.id] - nC));
      } else if (!l.carry) { nC = 0; nP = 0; }
      arrC[l.id] = nC; arrP[l.id] = nP; l.arrEnd = nC + nP;
      // الحالة: غير مسجل / جزئي / كامل
      if (l.planned <= 0 && l.paidReg === 0 && l.pendingReg === 0) l.status = 'na';
      else if (l.paidReg >= l.planned && l.paidReg > 0) l.status = 'done';
      else if (l.paidReg > 0) l.status = 'partial';
      else if (l.pendingReg > 0) l.status = 'recorded';
      else if (closed) l.status = 'missed';
      else if (past) l.status = 'unknown';
      else l.status = 'none';
      l.belowMandatory = l.type === 'debt' && l.regRealized && l.mandatoryCap > 0 && l.paidReg < l.mandatoryCap;
    }

    const projectedOut = forecast ? lines.reduce((a, l) => a + (l.regRealized && l.carry ? 0 : l.projReg) + l.projArr, 0)
      + resLines.reduce((a, r) => a + r.projHold, 0) : 0;
    const plannedTotal = lines.reduce((a, l) => a + l.planned, 0) + resLines.reduce((a, r) => a + r.planned, 0);
    const arrearsTotal = lines.reduce((a, l) => a + l.arrStart, 0);
    const unknownLines = [...lines.filter((l) => l.unknown), ...resLines.filter((r) => r.unknown)];

    months.push({
      key, idx, past, forecast, closed, isAuto,
      income: { salary: sal, rent: rentOwn, rents, extras: receivedExtras + adopted + recurringAmt + virtualAmt, planned: incomePlanned, received: incomeReceived, cash: incomeCash },
      cashStart: cashBefore,
      cashAdjust: forecast ? (cashAdj.get(key) || 0) : 0,
      visaOut: visaOutMap.get(key) || 0,
      lines, reserves: resLines,
      plannedTotal, arrearsTotal, paidTotal: actualOut, actualOut, projectedOut,
      debtPaidThisMonth: lines.filter((l) => l.type === 'debt').reduce((a, l) => a + l.regUsed + l.arrUsed, 0),
      cashEnd: forecast ? cash : null,
      fundingGap,
      unknownCount: unknownLines.length,
      unknownAmount: unknownLines.reduce((a, l) => a + Math.max(0, l.planned - (l.paidReg || 0)), 0),
      debtBalancesEnd: Object.fromEntries(debts.map((d) => [d.id, bal[d.id] === null ? d.opening : bal[d.id]])),
    });

    const allStarted = debts.every((d) => key >= d.start);
    const allZero = allStarted && debts.every((d) => isUnverifiedPerson(d) || (bal[d.id] ?? d.opening) <= 0);
    if (allZero && endIdx === null) endIdx = idx;
    if (endIdx !== null && idx >= untilIdx) break;
  }

  const excludedPersons = debts.filter(isUnverifiedPerson).map((d) => ({ id: d.id, name: d.name, remaining: debtStatus(state, d).remaining }))
    .filter((x) => x.remaining > 0);
  return {
    months, F, anchorDate, anchorAmount,
    endMonth: endIdx === null ? null : monthKey(endIdx),
    byKey: Object.fromEntries(months.map((m) => [m.key, m])),
    excludedPersons,
  };
}

/* ───────────── الأرصدة الفعلية ولوحة المعلومات ───────────── */

export function debtStatus(state, debt) {
  const adj = state.adjustments.filter((a) => a.itemId === debt.id).reduce((a, x) => a + x.delta, 0);
  const paid = confirmedPayments(state).filter((p) => p.itemId === debt.id).reduce((a, x) => a + x.amount, 0);
  const pending = state.payments.filter((p) => p.itemId === debt.id && p.confirmed === false).reduce((a, x) => a + x.amount, 0);
  const original = debt.opening + adj;
  return { opening: debt.opening, original, paid, pending, adj, remaining: Math.max(0, original - paid), overpaid: Math.max(0, paid - original) };
}

/**
 * initial   = إجمالي الأرصدة المرجعية عند بداية الخطة
 * original  = الإجمالي بعد تصحيحات الأرصدة (أساس النسبة)
 * paid      = المسدد المؤكد من أصل الديون (مسقوف برصيد كل دين)
 * remaining = المتبقي الفعلي (لا تُضاف إليه أقساط مستقبلية ولا عجز)
 */
export function dashboard(state, sim, baseSim = null) {
  let original = 0; let paid = 0; let remaining = 0; let initial = 0; let inferred = 0;
  for (const d of debtsOf(state)) {
    const st = debtStatus(state, d);
    original += st.original; paid += Math.min(st.paid, st.original); remaining += st.remaining; initial += d.opening;
    if (d.openingInferred) inferred += d.opening;
  }
  const progressTenths = original > 0 ? Math.min(1000, Math.floor((paid * 1000) / original)) : 0;
  const base = baseSim ? baseSim.endMonth : null;
  const end = sim.endMonth;
  const delta = end && base ? monthIndex(end) - monthIndex(base) : null;
  return { initial, original, paid, reduced: paid, remaining, inferred, progressTenths, endMonth: end, baselineEnd: base, deltaMonths: delta };
}

/* ───────────── الفيزا ───────────── */

/** نهاية دورة الكشف: حتى يوم 15 (شاملًا) → كشف نفس الشهر، من 16 → الشهر التالي */
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
  const confirmedMap = new Map(v.statements.map((s) => [s.cycleEnd, s]));
  const pending = [...cycles.entries()]
    .filter(([ce]) => ce <= today && !confirmedMap.has(ce))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([cycleEnd, amount]) => ({ cycleEnd, amount }));
  const drift = v.statements
    .map((s) => ({ ...s, computed: cycles.get(s.cycleEnd) || 0 }))
    .filter((s) => s.computed !== s.amount);

  // توزيع السداد على الكشوف الأقدم أولًا، ثم على المشتريات غير المفوترة
  const stAsc = [...v.statements].sort((a, b) => (a.cycleEnd < b.cycleEnd ? -1 : 1));
  let left = totalPaid;
  const statementsDetail = stAsc.map((s) => {
    const p = Math.min(left, s.amount); left -= p;
    return { ...s, paid: p, remaining: s.amount - p };
  });
  const paidToUnbilled = left;
  const statements = [...statementsDetail].reverse();
  const last = statements[0] || null;
  const billed = v.statements.reduce((a, s) => a + s.amount, 0);
  const dueUnpaid = Math.max(0, billed - totalPaid);
  const currentCycle = visaCycleEnd(today, sd);
  const currentCyclePurch = cycles.get(currentCycle) || 0;
  const lastEnd = last ? last.cycleEnd : '0000-00-00';
  const unbilled = [...cycles.entries()].filter(([ce]) => ce > lastEnd).reduce((a, [, x]) => a + x, 0);
  return {
    limit, used, available, totalPurch, totalPaid, billed, dueUnpaid, paidToUnbilled,
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

function debtCloseMonths(state, sim) {
  const out = {};
  for (const d of debtsOf(state)) {
    const m = sim.months.find((x) => (x.debtBalancesEnd[d.id] ?? 1) <= 0 && x.key >= d.start);
    out[d.id] = m ? m.key : null;
  }
  return out;
}

/** السيناريو لا يغيّر الحالة إطلاقًا — يحاكي فقط */
export function runScenario(state, sc, today = kuwaitToday()) {
  const ex = scenarioExtras(sc);
  const cur = simulate(state, { today });
  const alt = simulate(state, { today, virtualExtras: ex });
  const last = [cur.endMonth, alt.endMonth].filter(Boolean).sort().pop() || cur.months[cur.months.length - 1].key;
  const curL = simulate(state, { today, until: last });
  const altL = simulate(state, { today, until: last, virtualExtras: ex });
  const rows = [];
  for (const m of curL.months) {
    if (m.past) continue;
    if (m.key > last) break;
    const a = altL.byKey[m.key];
    rows.push({ key: m.key, current: m.debtPaidThisMonth, scenario: a ? a.debtPaidThisMonth : 0 });
  }
  const cc = debtCloseMonths(state, curL); const ac = debtCloseMonths(state, altL);
  const loans = debtsOf(state).filter((d) => !isUnverifiedPerson(d) && (cc[d.id] || ac[d.id]))
    .map((d) => ({ id: d.id, name: d.name, current: cc[d.id], scenario: ac[d.id] }));
  const diff = cur.endMonth && alt.endMonth ? monthIndex(alt.endMonth) - monthIndex(cur.endMonth) : null;
  const estimate = curL.months.some((m) => m.past && m.unknownCount > 0);
  return { currentEnd: cur.endMonth, scenarioEnd: alt.endMonth, diffMonths: diff, rows, loans, estimate };
}

/* ───────────── ترحيل البيانات المحفوظة (بلا حذف) ───────────── */

/** يرفع البيانات المحفوظة إلى أحدث نموذج دون حذف أي دفعة أو رصيد أو كشف. يرجع { state, changed }. */
export function migrate(input) {
  const state = input;
  let changed = false;
  const from = state.schema || 1;
  const now = new Date().toISOString();
  state.settings = state.settings || {};
  state.recurring = state.recurring || [];
  state.extras = state.extras || [];
  state.payments = state.payments || [];
  state.adjustments = state.adjustments || [];
  state.months = state.months || {};
  state.visa = state.visa || { purchases: [], payments: [], statements: [] };
  state.log = state.log || [];
  if (from < 2) {
    if (!Array.isArray(state.settings.payoffPriority)) {
      const ids = new Set(state.items.map((i) => i.id));
      const extraIds = state.items.filter((i) => i.type === 'debt' && i.extra === 'allow' && !DEFAULT_PRIORITY.includes(i.id) && i.id !== 'shuoon')
        .sort((a, b) => a.order - b.order).map((i) => i.id);
      state.settings.payoffPriority = [...DEFAULT_PRIORITY.filter((id) => ids.has(id)), ...extraIds];
    }
    for (const p of state.payments) if (p.confirmed === undefined) p.confirmed = true;
    state.schema = 2;
    state.log.push({ ts: now, text: 'تحديث نموذج البيانات إلى الإصدار 2 — دون حذف أي بيانات.' });
    changed = true;
  }
  if ((state.schema || 2) < 3) {
    const notes = [];
    if (!state.settings.cash) state.settings.cash = { amount: 0, date: null, note: '' };
    // الإقفال التلقائي أُلغي: الأشهر التي حُدد لها تاريخ إقفال يدويًا تبقى مقفلة
    for (const md of Object.values(state.months)) {
      if (md.closeDate) { md.closed = true; md.closedAt = md.closeDate; delete md.closeDate; notes.push('الأشهر المقفلة يدويًا بقيت مقفلة'); }
    }
    // ديون الأشخاص الأصلية: بانتظار التحقق ما لم تُعلَّم
    for (const d of state.items) {
      if (d.type === 'debt' && d.group === 'person' && d.verified === undefined) d.verified = !SEEDED_PERSONS.includes(d.id);
    }
    // الشؤون: لا سداد مبكر إضافي دون تأكيد (حسب المواصفات)
    const sh = state.items.find((i) => i.id === 'shuoon');
    if (sh && sh.extra === 'allow') {
      sh.extra = 'none';
      state.settings.payoffPriority = (state.settings.payoffPriority || []).filter((x) => x !== 'shuoon');
      notes.push('الشؤون: لا سداد إضافي تلقائي');
    }
    // احتياطي الجامعة: تخصيص نقدي في يناير يُستخدم في فبراير (لا يُحتسب مرتين)
    if (!Array.isArray(state.reserves)) {
      state.reserves = state.items.some((i) => i.id === 'uni') ? seedReserves() : [];
      notes.push('إضافة احتياطي الجامعة (يناير)');
    }
    state.schema = 3;
    state.log.push({ ts: now, text: `تحديث نموذج البيانات إلى الإصدار 3 دون حذف أي بيانات${notes.length ? ` (${[...new Set(notes)].join('، ')})` : ''}.` });
    changed = true;
  }
  return { state, changed };
}

/* ───────────── موثوقية التوقع ───────────── */

export function planReliability(state, sim, today = kuwaitToday()) {
  const unknownPast = [];
  const gaps = [];
  for (const m of sim.months) {
    if (m.past) {
      for (const l of m.lines) if (l.unknown) unknownPast.push({ key: m.key, id: l.id, name: l.name, amount: l.planned - l.paidReg });
      for (const r of m.reserves) if (r.unknown) unknownPast.push({ key: m.key, id: r.id, name: r.name, amount: r.planned });
    } else if (m.fundingGap > 0) gaps.push({ key: m.key, amount: m.fundingGap });
  }
  const cash = state.settings.cash || {};
  const cashEntered = !!cash.date;
  const cashStale = cashEntered && monthOfDate(cash.date) < sim.F;
  const futureIncomeUnconfirmed = sim.months.filter((m) => m.forecast && !m.income.salary.received).length;
  const inferred = debtsOf(state).filter((d) => d.openingInferred);
  const pendingExtras = state.extras.filter((e) => e.status === 'pending');
  const historyIncomplete = unknownPast.length > 0;
  return {
    unknownPast, gaps, futureIncomeUnconfirmed, inferred, pendingExtras, historyIncomplete,
    cashEntered, cashStale, excludedPersons: sim.excludedPersons,
    reliable: !!sim.endMonth && gaps.length === 0 && !historyIncomplete && cashEntered && !cashStale,
  };
}
