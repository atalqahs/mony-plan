import * as E from './engine.js';
import * as A from './actions.js';
import { parseKD, fmtKD, inputKD, percentTenths } from './money.js';
import { loadState, saveState, requestPersistence } from './store.js';

/* ───────────── أدوات ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kd = (f, opts) => `<span class="num">${fmtKD(f, opts)}</span>`;
const pct = (t) => `${Math.floor(t / 10)}.${t % 10}%`;
const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
};

function checkSvg(status, frac = 0, active = false) {
  const ring = active ? 'var(--ring-active)' : 'var(--ring)';
  if (status === 'na') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="2.6" fill="#48484c"/></svg>';
  if (status === 'done') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#fff"/><path d="m10.5 16.4 3.6 3.6 7.4-7.6" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (status === 'partial') {
    const c = 2 * Math.PI * 14;
    const f = Math.max(0.06, Math.min(0.94, frac));
    return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="${ring}" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 16 16)"/></svg>`;
  }
  if (status === 'unknown') return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="none" stroke="${ring}" stroke-width="2" stroke-dasharray="1.6 3.4" stroke-linecap="round"/></svg>`;
  if (status === 'missed') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="none" stroke="#a8433b" stroke-width="2"/><path d="M11 16h10" stroke="#ff6b5e" stroke-width="2.4" stroke-linecap="round"/></svg>';
  if (status === 'recorded') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3.2 3.2"/></svg>';
  return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="none" stroke="${ring}" stroke-width="2"/></svg>`;
}

/* ───────────── الحالة ───────────── */
let state = null;
let today = E.kuwaitToday();
const view = { tab: 'home', q: '', month: null, sc: { type: 'monthly', amount: '', start: null, end: '', month: null } };
let sim = null;
let daily = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function toast(msg, err = false) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast${err ? ' err' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 3600 : 1900);
}

/** تسجيل دفعة مع تنبيه عند وجود دفعة مطابقة تمامًا (منع التكرار غير المقصود) */
function addPay(data, msg) {
  return guarded(data, (d, draft) => A.addPayment(draft, d, { today }), (dup) => `توجد دفعة مطابقة تمامًا (${fmtKD(data.amount)} د.ك، ${E.dateLabel(data.date || null)}). هل هذه عملية مستقلة فعلًا؟ اختر «إلغاء» إن كانت تكرارًا.`, msg);
}
/** حفظ مع منع التكرار: مطابقة تامة تُرفض ما لم يؤكد المستخدم أنها عملية مستقلة؛ نفس opId لا يُحفظ مرتين */
function guarded(data, run, dupMsg, msg) {
  let err = A.transact(state, (draft) => run(data, draft));
  if (err === A.DUPLICATE) {
    if (!confirm(dupMsg())) { toast('لم تُسجل — عملية مكررة', true); return false; }
    err = A.transact(state, (draft) => run({ ...data, allowDuplicate: true }, draft));
  }
  if (err) { toast(err, true); return false; }
  saveState(state);
  render();
  if (msg) toast(msg);
  return true;
}
/** تنفيذ عملية + حفظ + إعادة رسم */
function commit(fn, okMsg) {
  // ذرّية: تُنفذ على نسخة، ولا يتغير شيء إن فشلت العملية أو رمت خطأ
  const err = A.transact(state, fn);
  if (err) { toast(err, true); return false; }
  saveState(state);
  render();
  if (okMsg) toast(okMsg);
  return true;
}

// الشهر المالي المعروض مستقل عن تاريخ الدفعة: تاريخ الدفعة الافتراضي هو اليوم، ويمكن تغييره
const curBudgetMonth = () => today.slice(0, 7);
const defaultDateFor = () => today;
function monthOptions(selected, { allowEmpty = false, emptyLabel = 'بدون' } = {}) {
  const start = E.monthIndex(state.settings.planStart);
  const endKey = [sim?.endMonth || state.settings.planStart, today.slice(0, 7), selected || state.settings.planStart].sort().pop();
  const end = E.monthIndex(endKey) + 24;
  let out = allowEmpty ? `<option value="">${emptyLabel}</option>` : '';
  for (let i = start; i <= end; i++) {
    const k = E.monthKey(i);
    out += `<option value="${k}" ${k === selected ? 'selected' : ''}>${E.monthLabel(k)}</option>`;
  }
  return out;
}

/* ───────────── الرسم الرئيسي ───────────── */
const TABS = [
  ['home', 'الرئيسية', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>'],
  ['debts', 'الديون', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>'],
  ['plan', 'الخطة', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>'],
  ['log', 'السجل', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>'],
];
const TITLES = { home: 'خطتي المالية', debts: 'الديون', plan: 'الخطة', log: 'السجل' };

function render() {
  today = E.kuwaitToday();
  const gw = gridWindow();
  sim = E.simulate(state, { today, until: [view.month, gw[5]].sort().pop() });
  daily = E.dailyLedger(state, sim, today);
  const t = view.tab;
  $('#app').innerHTML = `
    <header class="top">
      <h1>${TITLES[t]}</h1>
      <div class="acts">
        ${t === 'debts' ? `<button class="icon-btn" data-act="debt-new" aria-label="دين جديد">${ICON.plus}</button>` : ''}
        <button class="icon-btn" data-act="more" aria-label="المزيد والإعدادات">${ICON.gear}</button>
      </div>
    </header>
    ${t === 'home' ? homeView() : t === 'debts' ? debtsView() : t === 'plan' ? planView() : logView()}`;
  $('#tabbar').innerHTML = TABS.map(([k, label, ic]) => `<button class="tab ${k === t ? 'on' : ''}" data-act="tab" data-t="${k}" aria-label="${label}" ${k === t ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></button>`).join('');
}

function gridWindow() {
  const start = E.monthIndex(state.settings.planStart);
  let a = E.monthIndex(view.month) - 2;
  if (a < start) a = start;
  return Array.from({ length: 6 }, (_, i) => E.monthKey(a + i));
}
const monthsWord = (n) => (n === 1 ? 'شهر' : n === 2 ? 'شهرين' : n <= 10 ? `${n} أشهر` : `${n} شهرًا`);
const groupRank = (it) => (it.type === 'debt' ? (it.group === 'person' ? 2 : 0) : 1);
const SHORT = { personal: 'المصروف', uni: 'الجامعة' };
const shortName = (it) => it.short || SHORT[it.id] || it.name.replace(/^قرض\s+/, '');

/** المستحق المتبقي لشهر: الأقساط والالتزامات (دون المصروف الشخصي) + العجز المؤكد + الاحتياطي غير المحجوز */
function duesOf(m) {
  const out = [];
  for (const l of m.lines) {
    if (l.type === 'expense' && !l.carry) continue;
    if (l.unverified) continue;
    const rem = Math.max(0, l.planned - l.paidReg - l.potCover + Math.min(l.potCover, l.paidReg));
    if (rem > 0) out.push({ kind: 'reg', l, amount: rem });
    const arr = Math.max(0, l.arrStartC - l.paidArr);
    if (arr > 0) out.push({ kind: 'arr', l, amount: arr });
  }
  for (const r of m.reserves) if (!r.held) out.push({ kind: 'res', r, amount: r.planned });
  return out;
}

/* ── الرئيسية ── */
function homeView() {
  const d = E.dashboard(state, sim, null);
  const rel = E.planReliability(state, sim, today);
  const cash = E.actualCash(state, today);
  const F = sim.F;
  const m = sim.byKey[F];
  const dues = duesOf(m);
  const dueTotal = dues.reduce((a, x) => a + x.amount, 0);
  const end = d.allEnd || d.endMonth;
  const alert = homeAlert(rel);
  const rows = dues.slice(0, 7).map(dueRow).join('');
  return `
  <section class="hero" aria-label="لوحة الديون">
    <div class="metric big-m">
      <div class="m-l">ديوني المتبقية</div>
      <div class="m-v"><span class="num">${fmtKD(d.remaining)}</span><span class="unit">د.ك</span></div>
      <div class="bar"><i style="width:${d.progressTenths / 10}%"></i></div>
      <div class="m-s">سددت ${kd(d.paid)} من ${kd(d.original)}</div>
    </div>
    <div class="metrics">
      <button class="metric" data-act="cash">
        <div class="m-l">سيولتي المتاحة</div>
        ${cash ? `<div class="m-v sm"><span class="num">${fmtKD(cash.amount)}</span></div><div class="m-s"><span class="chip ok">فعلي</span></div>` : '<div class="m-v sm dim">غير مُدخلة</div><div class="m-s link">أدخل رصيدك</div>'}
      </button>
      <button class="metric" data-act="tab" data-t="plan">
        <div class="m-l">مستحق ${E.AR_MONTHS[Number(F.slice(5)) - 1]}</div>
        <div class="m-v sm"><span class="num">${fmtKD(dueTotal)}</span></div><div class="m-s"><span class="chip">متبقٍ</span></div>
      </button>
      <button class="metric wide" data-act="tab" data-t="debts">
        <div class="m-l">التخلص من الديون</div>
        <div class="m-v sm">${end ? E.monthLabel(end) : 'غير قابل للتحديد'}</div>
        <div class="m-s"><span class="chip">تقديري</span>${!d.allEnd && d.endMonth ? ' <span class="dim">عدا ديون بانتظار التحقق</span>' : ''}</div>
      </button>
    </div>
  </section>
  ${alert}
  <section class="card" aria-label="المستحقات">
    <div class="card-head"><h2 class="card-title">المستحق هذا الشهر</h2>${dues.length > 7 ? '<button class="pill" data-act="tab" data-t="plan">الكل</button>' : ''}</div>
    <div class="list">${rows || '<div class="empty">لا مستحقات متبقية هذا الشهر ✓</div>'}</div>
  </section>`;
}

function dueRow(x) {
  if (x.kind === 'res') {
    return `<div class="li"><div class="ic">${x.r.icon}</div><div class="main"><div class="name">${esc(x.r.name)}</div><div class="sub">يُحجز لـ${esc(E.itemById(state, x.r.reserve.targetItem)?.name || '')}</div></div>
      <div class="amt"><div class="a num">${fmtKD(x.amount)}</div></div><button class="pill" data-act="reserve-toggle" data-id="${x.r.id}">حجز</button></div>`;
  }
  const l = x.l;
  const due = state.months[sim.F]?.dueDates?.[l.id] || E.dueDayDate(state, l.id, sim.F);
  const sub = x.kind === 'arr' ? 'عجز من شهر سابق' : due ? `يستحق ${E.dateLabel(due)}` : (l.paidReg > 0 ? `دُفع ${fmtKD(l.paidReg)}` : '');
  return `<div class="li"><div class="ic">${l.icon || '•'}</div>
    <div class="main row-tap" data-act="item" data-id="${l.id}"><div class="name">${esc(l.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="amt"><div class="a num">${fmtKD(x.amount)}</div></div>
    <button class="pill white" data-act="${x.kind === 'arr' ? 'arrears-pay' : 'pay'}" data-id="${l.id}" data-m="${sim.F}" data-amt="${x.amount}">سداد</button></div>`;
}

/** تنبيه واحد فقط، بالأولوية، مع إجراء */
function homeAlert(rel) {
  const vs = E.visaSummary(state, today);
  const firstUnknown = rel.unknownPast[0];
  const pick = vs.pending.length ? ['كشف الفيزا جاهز للتثبيت', 'مراجعة', `data-act="visa-confirm" data-c="${vs.pending[0].cycleEnd}"`]
    : firstUnknown ? ['سجّل دفعات الأشهر السابقة لتصبح الأرقام دقيقة', 'ابدأ', `data-act="goto-month" data-m="${firstUnknown.key}"`]
      : !rel.cashEntered || rel.cashStale ? ['أدخل رصيدك النقدي الحالي', 'إدخال', 'data-act="cash"']
        : rel.excludedPersons.length ? [`أكّد حالة دين ${esc(rel.excludedPersons[0].name)}`, 'فتح', `data-act="item" data-id="${rel.excludedPersons[0].id}"`]
          : rel.overdueIncome.length ? [`أكّد استلام ${rel.overdueIncome[0].kind === 'rent' ? 'بدل إيجار' : 'راتب'} ${E.AR_MONTHS[Number(rel.overdueIncome[0].ofMonth.slice(5)) - 1]}`, 'تأكيد', `data-act="income-toggle" data-kind="${rel.overdueIncome[0].kind}" data-m="${rel.overdueIncome[0].ofMonth}"`]
            : rel.gaps.length ? [`الدخل المتوقع لا يغطي التزامات ${E.monthLabel(rel.gaps[0].key)}`, 'عرض', `data-act="goto-month" data-m="${rel.gaps[0].key}"`]
              : daily && daily.shortfalls.length ? [`التزام يستحق قبل وصول المال (${E.dateLabel(daily.shortfalls[0].date)})`, 'عرض', `data-act="goto-month" data-m="${daily.shortfalls[0].month || sim.F}"`]
                : null;
  if (!pick) return '';
  return `<div class="banner"><div class="t">${pick[0]}</div><button class="pill white" ${pick[2]}>${pick[1]}</button></div>`;
}

/* ── الديون ── */
function debtStatusChip(d, st) {
  if (st.remaining === 0) return `<span class="chip ok">${d.closedConfirmed ? 'مغلق' : 'مسدد'}</span>`;
  if (d.verified === false) return '<span class="chip warn">بانتظار التحقق</span>';
  if (st.paid > 0) return '<span class="chip">مسدد جزئيًا</span>';
  return ''; // «قائم» هو الوضع الطبيعي — لا شارة
}
function debtsView() {
  const debts = E.debtsOf(state).sort((a, b) => groupRank(a) - groupRank(b) || a.order - b.order);
  const total = debts.reduce((a, d) => a + E.debtStatus(state, d).remaining, 0);
  const row = (d) => {
    const st = E.debtStatus(state, d);
    const action = st.remaining > 0 ? `<button class="pill white" data-act="pay" data-id="${d.id}">سداد</button>`
      : !d.closedConfirmed ? `<button class="pill" data-act="close-confirm" data-id="${d.id}">تأكيد الإغلاق</button>` : '';
    return `<div class="li debt-row">
      <div class="ic">${d.icon || '•'}</div>
      <div class="main row-tap" data-act="item" data-id="${d.id}"><div class="name">${esc(d.name)} ${debtStatusChip(d, st)}</div><div class="sub">من ${kd(st.original)}${d.openingInferred ? ' · رصيد تقديري' : ''}</div></div>
      <div class="amt row-tap" data-act="item" data-id="${d.id}"><div class="a num ${st.remaining === 0 ? 'dim' : ''}">${fmtKD(st.remaining)}</div></div>
      ${action}</div>`;
  };
  const vs = E.visaSummary(state, today);
  return `
  <div class="total-line"><span class="muted">إجمالي المتبقي</span><span class="num">${fmtKD(total)} <small>د.ك</small></span></div>
  <section class="card" aria-label="القروض"><div class="list">${debts.filter((d) => d.group !== 'person').map(row).join('')}</div></section>
  <section class="card" aria-label="ديون الأشخاص"><div class="card-head"><h2 class="card-title">ديون الأشخاص</h2></div><div class="list">${debts.filter((d) => d.group === 'person').map(row).join('') || '<div class="empty">لا توجد</div>'}</div></section>
  <section class="card row-tap" aria-label="الفيزا" data-act="visa">
    <div class="li" style="border:0;padding:0">
      <div class="ic">💳</div>
      <div class="main"><div class="name">الفيزا ${vs.pending.length ? '<span class="chip warn">كشف للتثبيت</span>' : ''}</div><div class="sub">المتاح ${kd(vs.available)} من ${kd(vs.limit)}</div></div>
      <div class="amt"><div class="a num">${fmtKD(vs.used)}</div><div class="b">مستخدم</div></div>
    </div>
  </section>`;
}

/* ── الخطة ── */
function planView() {
  const m = sim.byKey[view.month];
  const dues = duesOf(m);
  const rem = dues.reduce((a, x) => a + x.amount, 0);
  return `
  <div class="subhead">
    <h2>${E.monthLabel(view.month)} ${m.past ? '<span class="chip">سابق</span>' : view.month === sim.F ? '<span class="chip ok">الحالي</span>' : ''}</h2>
    <div class="nav">
      <button class="icon-btn sm" data-act="prev" aria-label="الشهر السابق" ${view.month <= state.settings.planStart ? 'disabled' : ''}>${ICON.right}</button>
      <button class="icon-btn sm" data-act="next" aria-label="الشهر التالي">${ICON.left}</button>
    </div>
  </div>
  ${gridCard()}
  <div class="sumrow">
    <div><div class="l">الدخل ${m.past ? '' : 'المتوقع'}</div><div class="v num">${fmtKD(m.income.planned)}</div></div>
    <div><div class="l">الالتزامات</div><div class="v num">${fmtKD(m.plannedTotal + m.arrearsTotal)}</div></div>
    <div><div class="l">المسدد</div><div class="v num green">${fmtKD(m.actualOut)}</div></div>
    <div><div class="l">المتبقي</div><div class="v num">${fmtKD(rem)}</div></div>
  </div>
  ${m.fundingGap > 0 ? `<div class="banner"><div class="t">الدخل المتوقع ينقص ${kd(m.fundingGap)} د.ك عن التزامات هذا الشهر</div></div>` : ''}
  ${m.past && m.unknownCount ? `<div class="banner"><div class="t">${m.unknownCount} بنود غير مسجلة — اضغط الدائرة لتسجيل ما دفعته</div></div>` : ''}
  ${obligationsCard(m)}
  ${arrearsCard(m)}
  ${incomeCard(m)}
  <div class="quick" style="justify-content:center"><button class="pill" data-act="month-close">${m.closed ? 'إعادة فتح الشهر' : 'إقفال الشهر'}</button></div>`;
}

function gridCard() {
  const cols = gridWindow();
  const nowM = sim.F;
  const ids = new Map();
  for (const k of cols) {
    const mm = sim.byKey[k];
    if (!mm) continue;
    for (const l of mm.lines) if (l.status !== 'na') ids.set(l.id, l.item);
  }
  const items = [...ids.values()].sort((a, b) => groupRank(a) - groupRank(b) || a.order - b.order);
  const head = cols.map((k) => {
    const mi = Number(k.slice(5));
    return `<button class="g-col ${k === view.month ? 'sel' : ''} ${k === nowM ? 'now' : ''}" data-act="month" data-m="${k}" aria-label="${E.monthLabel(k)}">${E.AR_MONTHS_SHORT[mi - 1]}<b class="num">${mi}</b></button>`;
  }).join('');
  const rows = items.map((it) => {
    const cells = cols.map((k) => {
      const l = sim.byKey[k]?.lines.find((x) => x.id === it.id);
      if (!l) return '<span></span>';
      const frac = l.planned > 0 ? l.paidReg / l.planned : 0;
      return `<button class="chk" data-act="cell" data-m="${k}" data-id="${it.id}" aria-label="${esc(it.name)} ${E.monthLabel(k)}">${checkSvg(l.status, frac, k === view.month)}</button>`;
    }).join('');
    return `<div class="g-row g-item"><div class="g-name row-tap" data-act="item" data-id="${it.id}"><span class="ic">${it.icon || '•'}</span><span class="t">${esc(shortName(it))}</span></div>${cells}</div>`;
  }).join('');
  return `<section class="card grid" aria-label="جدول الأشهر"><div class="g-row g-head"><span></span>${head}</div>${rows || '<div class="empty">لا توجد التزامات في هذه الفترة.</div>'}</section>`;
}

function obligationsCard(m) {
  const lines = m.lines.filter((l) => l.planned > 0 || l.paidReg > 0).sort((a, b) => groupRank(a.item) - groupRank(b.item) || a.item.order - b.item.order);
  const rows = lines.map((l) => {
    const sub = l.status === 'unknown' ? '<span class="amber">غير مسجل</span>'
      : l.status === 'missed' ? '<span class="red">غير مسدد</span>'
        : l.status === 'recorded' ? '<span class="amber">بانتظار التأكيد</span>'
          : l.belowMandatory ? '<span class="amber">أقل من القسط الإلزامي</span>'
            : l.potCover > 0 ? 'من الاحتياطي'
              : l.paidReg > 0 ? `دُفع ${fmtKD(l.paidReg)}` : '';
    const frac = l.planned > 0 ? l.paidReg / l.planned : 0;
    return `<div class="li">
      <div class="ic">${l.icon || '•'}</div>
      <div class="main row-tap" data-act="cell-detail" data-m="${view.month}" data-id="${l.id}"><div class="name">${esc(l.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <div class="amt row-tap" data-act="cell-detail" data-m="${view.month}" data-id="${l.id}"><div class="a num">${fmtKD(l.planned)}</div></div>
      <button class="chk" data-act="cell" data-m="${view.month}" data-id="${l.id}" aria-label="تأكيد ${esc(l.name)}">${checkSvg(l.status, frac, true)}</button>
    </div>`;
  }).join('');
  const resRows = m.reserves.map((r) => `<div class="li">
      <div class="ic">${r.icon}</div>
      <div class="main row-tap" data-act="reserve" data-id="${r.id}"><div class="name">${esc(r.name)}</div><div class="sub">${r.held ? 'محجوز' : 'يُحجز من الراتب والإيجار'}</div></div>
      <div class="amt"><div class="a num">${fmtKD(r.planned)}</div></div>
      <button class="chk" data-act="reserve-toggle" data-id="${r.id}" aria-label="تأكيد حجز ${esc(r.name)}">${checkSvg(r.status, 0, true)}</button>
    </div>`).join('');
  return `<section class="card" aria-label="الالتزامات"><div class="card-head"><h2 class="card-title">الالتزامات</h2></div><div class="list">${rows || '<div class="empty">لا توجد التزامات.</div>'}${resRows}</div></section>`;
}

/* ── العجز: مربع مستقل تحت الالتزامات (اسم البند + المتبقي + إدخال السداد) ── */
function arrearsCard(m) {
  const lines = m.lines.filter((l) => l.arrStartC - l.paidArr > 0);
  if (!lines.length) return '';
  const rows = lines.map((l) => `<div class="li arr-row">
      <div class="main"><div class="name">${l.icon || ''} ${esc(l.name)}</div></div>
      <div class="amt"><div class="a num">${fmtKD(l.arrStartC - l.paidArr)}</div></div>
      <input class="input money arr-in" inputmode="decimal" placeholder="0.000" aria-label="مبلغ السداد من عجز ${esc(l.name)}" data-arr-in="${l.id}">
      <button class="pill white" data-act="arrears-inline" data-m="${view.month}" data-id="${l.id}" data-op="${E.uid('op')}">سداد</button>
    </div>`).join('');
  const total = lines.reduce((a, l) => a + l.arrStartC - l.paidArr, 0);
  return `<section class="card" aria-label="العجز"><div class="card-head"><h2 class="card-title">العجز</h2><span class="num" style="font-weight:700">${fmtKD(total)}</span></div><div class="list">${rows}</div></section>`;
}

function incomeCard(m) {
  const sal = m.income.salary;
  const extras = state.extras.filter((e) => e.month === view.month);
  const inc = (kind, ic, name, x, month = view.month) => `<div class="li">
      <div class="ic">${ic}</div>
      <div class="main row-tap" data-act="income" data-kind="${kind}" data-m="${month}"><div class="name">${name}</div><div class="sub">${x.received ? `وصل ${E.dateLabel(x.receivedDate)}` : `متوقع ${E.dateLabel(x.date)}`}</div></div>
      <div class="amt"><div class="a num ${x.received ? '' : 'dim'}">${fmtKD(x.received ? x.receivedAmount : x.amount)}</div></div>
      <button class="chk" data-act="income-toggle" data-kind="${kind}" data-m="${month}" aria-label="تأكيد استلام ${name}">${checkSvg(x.received ? 'done' : 'none', 0, true)}</button>
    </div>`;
  const rentRows = m.income.rents.map((r) => inc('rent', '🏠', `بدل إيجار ${E.AR_MONTHS[Number(r.ofMonth.slice(5)) - 1]}`, r, r.ofMonth)).join('');
  const ex = extras.map((e) => `<div class="li row-tap" data-act="extra" data-id="${e.id}"><div class="ic">✨</div><div class="main"><div class="name">${esc(e.name)}</div><div class="sub">${A.statusLabel(e.status)}</div></div><div class="amt"><div class="a num ${e.status === 'pending' ? 'dim' : ''}">${fmtKD(e.amount)}</div></div></div>`).join('');
  return `<section class="card" aria-label="الدخل">
    <div class="card-head"><h2 class="card-title">الدخل</h2><button class="icon-btn sm" data-act="extra-new" aria-label="دخل إضافي">${ICON.plus}</button></div>
    <div class="list">${inc('salary', '💼', 'الراتب', sal)}${rentRows}${ex}</div>
  </section>`;
}

/* ── السجل ── */
function logRows() {
  const rows = [];
  for (const p of state.payments) {
    const it = E.itemById(state, p.itemId);
    rows.push({ d: p.date || '', key: `${it?.name || ''} ${fmtKD(p.amount)} ${p.date || ''} ${p.note || ''}`, html: `<div class="li row-tap" data-act="edit-pay" data-id="${p.id}"><div class="ic">${it?.icon || '•'}</div><div class="main"><div class="name">${esc(it?.name || '—')}${p.confirmed === false ? ' <span class="chip warn">غير مؤكدة</span>' : ''}</div><div class="sub">${E.dateLabel(p.date)} · خطة ${E.AR_MONTHS[Number(p.month.slice(5)) - 1]} ${p.month.slice(0, 4)}${p.kind === 'arrears' ? ' · من العجز' : ''}</div></div><div class="amt"><div class="a num">${fmtKD(p.amount)}</div></div></div>` });
  }
  for (const p of state.visa.purchases) rows.push({ d: p.date, key: `فيزا شراء ${fmtKD(p.amount)} ${p.date} ${p.note || ''}`, html: `<div class="li row-tap" data-act="visa-buy-edit" data-id="${p.id}"><div class="ic">🛍️</div><div class="main"><div class="name">فيزا — ${esc(p.note || 'شراء')}</div><div class="sub">${E.dateLabel(p.date)}</div></div><div class="amt"><div class="a num">${fmtKD(p.amount)}</div></div></div>` });
  for (const p of state.visa.payments) rows.push({ d: p.date, key: `فيزا سداد ${fmtKD(p.amount)} ${p.date}`, html: `<div class="li row-tap" data-act="visa-pay-del" data-id="${p.id}"><div class="ic">↩️</div><div class="main"><div class="name">فيزا — سداد</div><div class="sub">${E.dateLabel(p.date)}</div></div><div class="amt"><div class="a num green">${fmtKD(p.amount)}</div></div></div>` });
  for (const a of state.adjustments) { const it = E.itemById(state, a.itemId); rows.push({ d: a.date, key: `تصحيح ${it?.name || ''} ${a.reason}`, html: `<div class="li"><div class="ic">✏️</div><div class="main"><div class="name">تصحيح ${esc(it?.name || '')}</div><div class="sub">${E.dateLabel(a.date)} · ${esc(a.reason)}</div></div><div class="amt"><div class="a num">${fmtKD(a.delta, { sign: true })}</div></div></div>` }); }
  return rows.sort((a, b) => (a.d === b.d ? 0 : !a.d ? 1 : !b.d ? -1 : a.d < b.d ? 1 : -1));
}
function logListHtml(q) {
  const qs = (q || '').trim();
  const rows = logRows().filter((r) => !qs || r.key.includes(qs));
  return rows.map((r) => r.html).join('') || `<div class="empty">${qs ? 'لا نتائج' : 'لا توجد عمليات بعد'}</div>`;
}
function logView() {
  return `<div class="field" style="margin-top:4px"><input class="input" type="search" placeholder="بحث بالاسم أو المبلغ أو التاريخ" data-search value="${esc(view.q || '')}"></div>
  <section class="card"><div class="list" id="log-list">${logListHtml(view.q)}</div></section>`;
}

/* ── ماذا لو؟ (أداة ثانوية) ── */
function scValue() {
  const sc = view.sc;
  const amount = parseKD(sc.amount);
  return { type: sc.type, amount: Number.isNaN(amount) ? 0 : amount, month: sc.month, start: sc.start, end: sc.end || null };
}
function updateWhatIf() {
  const box = $('#wi-result');
  if (!box) return;
  const sc = scValue();
  if (!(sc.amount > 0)) { box.innerHTML = '<div class="note">أدخل مبلغًا لترى أثره. التجربة لا تغيّر خطتك.</div>'; return; }
  const r = E.runScenario(state, sc, today);
  let diff = '—'; let cls = '';
  if (r.diffMonths !== null) {
    const n = Math.abs(r.diffMonths);
    diff = r.diffMonths < 0 ? `أبكر بـ${monthsWord(n)}` : r.diffMonths > 0 ? `أبطأ بـ${monthsWord(n)}` : 'بدون تغيير';
    cls = r.diffMonths < 0 ? 'green' : r.diffMonths > 0 ? 'red' : '';
  }
  box.innerHTML = `
    <div class="sumrow" style="grid-template-columns:repeat(3,1fr)">
      <div><div class="l">الآن</div><div class="v">${r.currentEnd ? E.monthLabel(r.currentEnd) : '—'}</div></div>
      <div><div class="l">بعد التجربة</div><div class="v">${r.scenarioEnd ? E.monthLabel(r.scenarioEnd) : '—'}</div></div>
      <div><div class="l">الفرق</div><div class="v ${cls}">${diff}</div></div>
    </div>
    ${r.loans.map((l) => `<div class="kv"><span class="k">${esc(l.name)}</span><span class="v"><span class="dim">${l.current ? E.monthLabel(l.current) : '—'}</span> ← ${l.scenario ? E.monthLabel(l.scenario) : '—'}</span></div>`).join('')}
    <button class="btn" data-a="sc-adopt">اعتماد في الخطة</button>`;
}

/* ───────────── الأوراق السفلية ───────────── */
let sheetEl = null;
function openSheet(html, bind) {
  closeSheet();
  const w = document.createElement('div');
  w.className = 'sheet-wrap';
  w.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(w);
  document.body.style.overflow = 'hidden';
  sheetEl = w;
  w.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  const sh = w.querySelector('.sheet');
  sh.addEventListener('click', (e) => {
    const sw = e.target.closest('.switch');
    if (sw) { sw.classList.toggle('on'); sw.setAttribute('aria-checked', sw.classList.contains('on')); sw.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  if (bind) bind(sh);
}
function closeSheet() {
  if (sheetEl) { sheetEl.remove(); sheetEl = null; document.body.style.overflow = ''; }
}
const v = (sh, name) => sh.querySelector(`[name="${name}"]`)?.value ?? '';
const on = (sh, sel, fn) => sh.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => fn(e, el)));
const money = (s) => { const x = parseKD(s); return Number.isNaN(x) ? NaN : x; };
const sw = (sh, name) => sh.querySelector(`.switch[data-name="${name}"]`)?.classList.contains('on');
const field = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
const moneyInput = (name, val, ph = '0.000') => `<input class="input money" name="${name}" inputmode="decimal" placeholder="${ph}" value="${val === '' || val === null || val === undefined ? '' : inputKD(val)}">`;
const dateInput = (name, val) => `<input class="input" type="date" name="${name}" value="${val || ''}">`;
const head = (title, sub) => `<div class="sh-head"><div><h3>${title}</h3>${sub ? `<div class="sh-sub">${sub}</div>` : ''}</div><button class="icon-btn sm" data-close aria-label="إغلاق"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;

function lineOf(month, id) {
  const s = E.simulate(state, { today, until: month });
  return s.byKey[month]?.lines.find((l) => l.id === id) || null;
}

/** ورقة بند في شهر: تأكيد الدفع، الدفعات، المخطط، الاستحقاق */
function cellSheet(month, id, focusPay = true) {
  const opId = E.uid('op'); // يمنع حفظ النافذة نفسها مرتين
  const it = E.itemById(state, id);
  const l = lineOf(month, id);
  if (!it) return;
  const md = state.months[month] || {};
  const pays = state.payments.filter((p) => p.itemId === id && p.month === month).sort((a, b) => (a.date < b.date ? -1 : 1));
  const remainingPlan = l ? Math.max(0, l.planned - l.paidReg) : 0;
  const st = it.type === 'debt' ? E.debtStatus(state, it) : null;
  const html = `
    ${head(`${it.icon || ''} ${esc(it.name)}`, E.monthLabel(month))}
    <div class="divider" style="margin:14px 0 6px"></div>
    <div class="kv"><span class="k">المخطط لهذا الشهر</span><span class="v num">${fmtKD(l?.planned ?? 0)}</span></div>
    <div class="kv"><span class="k">المدفوع المؤكد</span><span class="v num">${fmtKD(l?.paidReg ?? 0)}</span></div>
    ${l && l.arrStart ? `<div class="kv"><span class="k">العجز المرحّل (منفصل)</span><span class="v num">${fmtKD(l.arrRemaining)}</span></div>` : ''}
    ${st ? `<div class="kv"><span class="k">الرصيد الحقيقي المتبقي</span><span class="v num">${fmtKD(st.remaining)}</span></div>` : ''}
    ${l?.belowMandatory ? `<div class="alert amber">المدفوع أقل من القسط الإلزامي (${kd(l.mandatoryCap)} د.ك).</div>` : ''}

    <div class="section-t">تأكيد دفعة</div>
    <div class="row2">
      ${field('المبلغ (د.ك)', moneyInput('amount', remainingPlan || ''))}
      ${field('تاريخ الدفع', dateInput('date', defaultDateFor(month)))}
    </div>
    ${field('ملاحظة', '<input class="input" name="note" placeholder="اختياري، مثل: من بدل الإيجار">')}
    ${month < sim.F ? '<div class="toggle"><span>لا أعرف تاريخ السداد (دفعة قديمة)</span><button class="switch on" data-name="nodate" role="switch" aria-checked="true"></button></div>' : ''}
    <div class="impact" data-impact></div>
    <div class="toggle"><span>تم السداد فعلًا (دفعة مؤكدة)</span><button class="switch on" data-name="confirmed" role="switch" aria-checked="true"></button></div>
    <div class="note">تُنسب الدفعة إلى خطة ${E.monthLabel(month)} مهما كان تاريخ تنفيذها. الدفعة غير المؤكدة تُحفظ ولا تُخصم من الرصيد حتى تأكيدها.</div>
    ${remainingPlan > 0 ? `<div class="note">دفع مبلغ أقل من ${kd(remainingPlan)} د.ك يُسجّل كدفعة جزئية${l?.carry ? '، والفرق يُرحّل كعجز للشهر التالي' : ''}.</div>` : ''}
    <button class="btn" data-a="pay">تأكيد الدفع</button>

    ${pays.length ? `<div class="section-t">الدفعات المسجلة</div><div class="list">${pays.map((p) => `
      <div class="li"><div class="main"><div class="name num" style="text-align:start">${fmtKD(p.amount)} د.ك</div><div class="sub">${p.confirmed === false ? '<span class="amber">بانتظار التأكيد</span> — ' : ''}${p.kind === 'arrears' ? 'من العجز — ' : ''}${E.dateLabel(p.date)}${p.note ? ` — ${esc(p.note)}` : ''}</div></div>
      ${p.confirmed === false ? `<button class="pill white" data-a="confirm-pay" data-id="${p.id}">تأكيد</button>` : ''}<button class="pill" data-a="edit-pay" data-id="${p.id}">تعديل</button><button class="pill danger" data-a="del-pay" data-id="${p.id}">حذف</button></div>`).join('')}</div>` : ''}
    ${l && (l.paidReg > 0 || l.pendingReg > 0) ? '<button class="btn danger" data-a="uncheck">إزالة علامة الصح</button>' : ''}

    <div class="section-t">تعديل الخطة لهذا الشهر فقط</div>
    <div class="row2">
      ${field('المبلغ المخطط', moneyInput('planned', l ? (l.stored ?? l.planned) : 0))}
      ${field('تاريخ الاستحقاق', dateInput('due', md.dueDates?.[id]))}
    </div>
    <button class="btn secondary" data-a="save-plan">حفظ التعديل</button>
    ${md.plan && Object.prototype.hasOwnProperty.call(md.plan, id) ? '<button class="btn secondary" data-a="reset-plan">إرجاع للقيمة التلقائية</button>' : ''}
  `;
  openSheet(html, (sh) => {
    on(sh, '[data-a="pay"]', () => {
      const amount = money(v(sh, 'amount'));
      const confirmed = sw(sh, 'confirmed');
      const dateUnknown = !!sw(sh, 'nodate');
      if (addPay({ itemId: id, month, amount, date: dateUnknown ? null : v(sh, 'date'), dateUnknown, note: v(sh, 'note'), confirmed, opId }, confirmed ? 'تم تأكيد الدفع' : 'سُجلت الدفعة بانتظار التأكيد')) closeSheet();
    });
    on(sh, '[data-a="del-pay"]', (e, el) => {
      if (!confirm('حذف هذه الدفعة؟ سيُعاد حساب الخطة.')) return;
      if (commit((s) => A.deletePayment(s, el.dataset.id), 'تم الحذف')) cellSheet(month, id);
    });
    on(sh, '[data-a="edit-pay"]', (e, el) => editPaymentSheet(el.dataset.id, () => cellSheet(month, id)));
    on(sh, '[data-a="confirm-pay"]', (e, el) => { if (commit((s) => A.confirmPayment(s, el.dataset.id), 'تم تأكيد السداد')) cellSheet(month, id, false); });
    on(sh, '[data-a="uncheck"]', () => {
      if (!confirm('إزالة علامة الصح ستحذف الدفعات الأساسية المسجلة لهذا البند في هذا الشهر. متابعة؟')) return;
      if (commit((s) => A.clearRegular(s, id, month), 'أزيلت علامة الصح')) closeSheet();
    });
    on(sh, '[data-a="save-plan"]', () => {
      const planned = money(v(sh, 'planned'));
      const due = v(sh, 'due');
      const ok = commit((s) => {
        const cur = lineOf(month, id);
        const curVal = cur ? (cur.stored ?? cur.planned) : 0;
        if (Number.isNaN(planned)) return 'المبلغ غير صالح';
        if (planned !== curVal) { const e1 = A.setPlan(s, month, id, planned); if (e1) return e1; }
        if ((due || '') !== ((s.months[month]?.dueDates || {})[id] || '')) {
          const e2 = A.setDueDate(s, month, id, due || null);
          if (!e2 && due) { const w = A.dueDateCheck(s, month, due).warning; if (w) setTimeout(() => toast(w), 50); }
          return e2;
        }
        return null;
      }, 'تم الحفظ');
      if (ok) closeSheet();
    });
    on(sh, '[data-a="reset-plan"]', () => { if (commit((s) => A.setPlan(s, month, id, null), 'تمت الإعادة')) closeSheet(); });
    const upd = () => {
      const unknown = !!sw(sh, 'nodate');
      const dt = sh.querySelector('[name="date"]'); if (dt) dt.disabled = unknown;
      const imp = A.paymentImpact(state, unknown ? null : v(sh, 'date'), today);
      const box = sh.querySelector('[data-impact]');
      if (box) box.innerHTML = imp.historical ? '<b>سداد سابق:</b> لا يُخصم من سيولتك الحالية.' : '<b>سداد حالي:</b> سيُخصم من سيولتك.';
    };
    sh.addEventListener('input', upd); sh.addEventListener('change', upd); upd();
    if (focusPay) setTimeout(() => sh.querySelector('[name="amount"]')?.focus({ preventScroll: true }), 50);
  });
}

function monthCloseSheet(month) {
  const md = state.months[month] || {};
  const m = sim.byKey[month];
  const unpaid = m ? m.lines.filter((l) => l.carry && l.planned > l.paidReg) : [];
  openSheet(`${head(`${md.closed ? 'إعادة فتح' : 'إقفال'} ${E.monthLabel(month)}`, md.closed ? `مقفل منذ ${E.dateLabel(md.closedAt)}` : 'الإقفال يدوي فقط')}
    ${md.closed
    ? '<div class="note">إعادة الفتح تُرجع البنود غير المسجلة إلى حالة «غير مسجل» وتلغي العجز الناتج عن الإقفال. الدفعات المسجلة لا تتأثر.</div><button class="btn" data-a="open">إعادة فتح الشهر</button>'
    : `<div class="note">عند الإقفال يصبح كل مبلغ غير مسدد من خطة الشهر <b>عجزًا مؤكدًا</b> يُرحّل للشهر التالي. سجّل دفعات الشهر أولًا.</div>
       ${unpaid.length ? `<div class="section-t">سيصبح عجزًا مؤكدًا</div>${unpaid.map((l) => `<div class="kv"><span class="k">${esc(l.name)}</span><span class="v num">${fmtKD(l.planned - l.paidReg)}</span></div>`).join('')}` : '<div class="note">لا توجد مبالغ غير مسددة.</div>'}
       <button class="btn" data-a="close">إقفال الشهر</button>`}`, (sh) => {
    on(sh, '[data-a="close"]', () => { if (commit((s) => A.closeMonth(s, month, true, today), 'تم إقفال الشهر')) closeSheet(); });
    on(sh, '[data-a="open"]', () => { if (commit((s) => A.closeMonth(s, month, false), 'أُعيد فتح الشهر')) closeSheet(); });
  });
}

function cashSheet() {
  const c = state.settings.cash || {};
  openSheet(`${head('الرصيد النقدي المتاح', 'السيولة الوحيدة المعتمدة من الماضي')}
    <div class="note">أدخل المبلغ النقدي المتاح فعليًا في حسابك بتاريخ معيّن، دون المبالغ المحجوزة (مثل احتياطي الجامعة). كل دخل أو دفعة مؤكدة بعد هذا التاريخ تُضاف أو تُخصم تلقائيًا، وما قبله يُعتبر مُضمَّنًا فيه. لا يُستنتج أي فائض من الأشهر الماضية.</div>
    <div class="row2">${field('المبلغ (د.ك)', moneyInput('amount', c.date ? c.amount : ''))}${field('بتاريخ', dateInput('date', c.date || today))}</div>
    ${field('ملاحظة', `<input class="input" name="note" value="${esc(c.note || '')}" placeholder="مثال: رصيد الحساب بعد التسوية">`)}
    <button class="btn" data-a="save">حفظ الرصيد</button>`, (sh) => {
    on(sh, '[data-a="save"]', () => {
      const amount = money(v(sh, 'amount'));
      if (commit((s) => A.setCash(s, { amount, date: v(sh, 'date'), note: v(sh, 'note') }, today), 'تم حفظ الرصيد')) closeSheet();
    });
  });
}

function editPaymentSheet(pid, back) {
  const p = state.payments.find((x) => x.id === pid);
  if (!p) return;
  const it = E.itemById(state, p.itemId);
  openSheet(`${head('تعديل دفعة', `${esc(it?.name)} — ${p.kind === 'arrears' ? 'من العجز' : 'دفعة الشهر'}`)}
    <div class="row2">${field('المبلغ', moneyInput('amount', p.amount))}${field('التاريخ', dateInput('date', p.date))}</div>
    ${p.month < sim.F || p.date === null ? `<div class="toggle"><span>تاريخ التنفيذ غير معروف (دفعة تاريخية)</span><button class="switch ${p.date === null ? 'on' : ''}" data-name="nodate" role="switch" aria-checked="${p.date === null}"></button></div>` : ''}
    ${field('منسوبة لخطة شهر', `<select class="input" name="month">${monthOptions(p.month)}</select>`)}
    ${field('ملاحظة', `<input class="input" name="note" value="${esc(p.note)}">`)}
    <button class="btn" data-a="save">حفظ</button>
    <button class="btn danger" data-a="del">حذف الدفعة</button>`, (sh) => {
    on(sh, '[data-a="del"]', () => { if (confirm('حذف هذه الدفعة؟ سيُعاد الحساب.') && commit((s) => A.deletePayment(s, pid), 'تم الحذف')) (back ? back() : closeSheet()); });
    on(sh, '[data-a="save"]', () => {
      const amount = money(v(sh, 'amount'));
      const unknown = !!sw(sh, 'nodate');
      const patch = { amount, month: v(sh, 'month'), note: v(sh, 'note'), ...(unknown ? { dateUnknown: true } : { date: v(sh, 'date'), dateUnknown: false }) };
      if (commit((s) => A.updatePayment(s, pid, patch, { today }), 'تم التعديل')) (back ? back() : closeSheet());
    });
  });
}

function arrearsSheet(month, id) {
  const opId = E.uid('op'); // يمنع حفظ النافذة نفسها مرتين
  const l = lineOf(month, id);
  const it = E.itemById(state, id);
  if (!l || !it) return;
  openSheet(`${head(`سداد من العجز — ${esc(it.name)}`, E.monthLabel(month))}
    <div class="kv"><span class="k">العجز المتبقي</span><span class="v num">${fmtKD(l.arrRemaining)}</span></div>
    <div class="row2">${field('المبلغ المسدد من العجز', moneyInput('amount', l.arrRemaining))}${field('التاريخ', dateInput('date', defaultDateFor(month)))}</div>
    <div class="note">ما يتبقى من العجز ينتقل تلقائيًا للشهر التالي، والمبلغ المسدد يُخصم من رصيد الدين الحقيقي مرة واحدة.</div>
    <button class="btn" data-a="pay">تسجيل السداد</button>`, (sh) => {
    on(sh, '[data-a="pay"]', () => {
      const amount = money(v(sh, 'amount'));
      if (addPay({ itemId: id, month, kind: 'arrears', amount, date: v(sh, 'date'), opId }, 'تم السداد من العجز')) closeSheet();
    });
    setTimeout(() => sh.querySelector('[name="amount"]')?.select(), 50);
  });
}

function incomeSheet(kind, month = view.month, startReceived = false) {
  const x = kind === 'salary' ? E.salaryFor(state, month) : E.rentFor(state, month);
  const title = kind === 'salary' ? `راتب ${E.monthLabel(month)}` : `بدل إيجار ${E.monthLabel(month)}`;
  const recv = x.received || startReceived;
  const defDate = x.receivedDate || (x.date <= today ? x.date : today);
  openSheet(`${head(title, 'المخطط والمستلم منفصلان')}
    <div class="section-t">المخطط</div>
    <div class="row2">${field('القيمة المخططة لهذا الشهر', moneyInput('amount', x.amount))}${field('تاريخ الاستحقاق المتوقع', dateInput('date', x.date))}</div>
    ${kind === 'rent' ? field('مخصص لخطة شهر', `<select class="input" name="alloc">${monthOptions(x.allocMonth)}</select>`) : ''}
    <div class="section-t">الفعلي</div>
    <div class="toggle"><span>تم الاستلام فعليًا</span><button class="switch ${recv ? 'on' : ''}" data-name="received" role="switch" aria-checked="${recv}"></button></div>
    <div class="row2">${field('المبلغ المستلم', moneyInput('ramount', x.receivedAmount ?? x.amount))}${field('تاريخ الاستلام', dateInput('rdate', defDate))}</div>
    ${kind === 'rent' ? '<div class="note">بدل الإيجار يُخصص لشهر مالي واحد فقط. تاريخ وصوله لا ينقله إلى ميزانية شهر آخر، فلا يُحتسب مرتين.</div>' : ''}
    <button class="btn" data-a="save">حفظ</button>
    <div class="note">التعديل يخص هذا الشهر فقط. القيم الافتراضية في الإعدادات.</div>`, (sh) => {
    on(sh, '[data-a="save"]', () => {
      const amount = money(v(sh, 'amount'));
      const ramount = money(v(sh, 'ramount'));
      const received = sw(sh, 'received');
      if (Number.isNaN(amount) || (received && Number.isNaN(ramount))) { toast('المبلغ غير صالح', true); return; }
      const patch = {};
      if (amount !== x.amount) patch.amount = amount;
      if (v(sh, 'date') !== x.date) patch.date = v(sh, 'date');
      if (received) {
        if (!x.received || ramount !== x.receivedAmount || v(sh, 'rdate') !== x.receivedDate) Object.assign(patch, { received: true, receivedAmount: ramount, receivedDate: v(sh, 'rdate') });
      } else if (x.received) patch.received = false;
      if (kind === 'rent' && v(sh, 'alloc') !== x.allocMonth) patch.allocMonth = v(sh, 'alloc');
      if (!Object.keys(patch).length) { closeSheet(); return; }
      if (commit((s) => A.setIncome(s, month, kind, patch), 'تم الحفظ')) closeSheet();
    });
  });
}

function extraSheet(id) {
  const e = id ? state.extras.find((x) => x.id === id) : null;
  let status = e ? e.status : 'received';
  openSheet(`${head(e ? 'دخل إضافي' : 'إضافة دخل إضافي', 'المبالغ غير المؤكدة لا تدخل الخطة')}
    ${field('الوصف', `<input class="input" name="name" value="${esc(e?.name || '')}" placeholder="مكافأة، بيع…">`)}
    <div class="row2">${field('المبلغ', moneyInput('amount', e?.amount ?? ''))}${field('الشهر', `<select class="input" name="month">${monthOptions(e?.month || view.month)}</select>`)}</div>
    ${field('تاريخ الاستلام', dateInput('date', e?.date || today))}
    <div class="field"><label>الحالة</label><div class="seg">
      <button data-st="pending" class="${status === 'pending' ? 'on' : ''}">غير مؤكد</button>
      <button data-st="received" class="${status === 'received' ? 'on' : ''}">مستلم</button>
      ${status === 'adopted' ? '<button data-st="adopted" class="on">معتمد</button>' : ''}
    </div></div>
    <button class="btn" data-a="save">حفظ</button>
    ${e ? '<button class="btn danger" data-a="del">حذف</button>' : ''}`, (sh) => {
    on(sh, '[data-st]', (ev, el) => { status = el.dataset.st; sh.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('on', b === el)); });
    on(sh, '[data-a="save"]', () => {
      const data = { name: v(sh, 'name') || 'دخل إضافي', amount: money(v(sh, 'amount')), month: v(sh, 'month'), status, date: v(sh, 'date') };
      if (commit((s) => (e ? A.updateExtra(s, e.id, data) : A.addExtra(s, data)), 'تم الحفظ')) closeSheet();
    });
    on(sh, '[data-a="del"]', () => { if (confirm('حذف هذا الدخل؟') && commit((s) => A.deleteExtra(s, e.id), 'تم الحذف')) closeSheet(); });
  });
}

const EXTRA_LABEL = { allow: 'يسمح بالسداد الإضافي', closeOnly: 'السداد المبكر بإغلاق الرصيد كاملًا فقط', none: 'لا سداد إضافي' };
function debtSheet(id) {
  const d = E.itemById(state, id);
  if (!d) return;
  const st = E.debtStatus(state, d);
  const pays = state.payments.filter((p) => p.itemId === id).sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const adjs = state.adjustments.filter((a) => a.itemId === id);
  const hist = [
    ...pays.map((p) => ({ d: p.date, html: `<div class="li"><div class="main"><div class="name"><span class="num">${fmtKD(p.amount)}</span> د.ك</div><div class="sub">${p.kind === 'arrears' ? 'سداد من العجز' : 'دفعة'} — ${E.monthLabel(p.month)} — ${E.dateLabel(p.date)}${p.note ? ` — ${esc(p.note)}` : ''}</div></div><button class="pill" data-a="edit-pay" data-id="${p.id}">تعديل</button></div>` })),
    ...adjs.map((a) => ({ d: a.date, html: `<div class="li"><div class="main"><div class="name">تصحيح رصيد <span class="num">${fmtKD(a.delta, { sign: true })}</span></div><div class="sub">${E.dateLabel(a.date)} — ${esc(a.reason)} (<span class="num">${fmtKD(a.before)}</span> ← <span class="num">${fmtKD(a.after)}</span>)</div></div></div>` })),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).map((x) => x.html).join('');
  openSheet(`${head(`${d.icon || ''} ${esc(d.name)}`, d.group === 'person' ? 'دين شخصي' : 'قرض')}
    <div class="sumrow" style="grid-template-columns:repeat(3,1fr)">
      <div><div class="l">المتبقي</div><div class="v num">${fmtKD(st.remaining)}</div></div>
      <div><div class="l">المسدد</div><div class="v num green">${fmtKD(st.paid)}</div></div>
      <div><div class="l">الأصلي</div><div class="v num">${fmtKD(st.original)}</div></div>
    </div>
    <div style="margin-top:10px">${debtStatusChip(d, st)}${d.openingInferred ? ' <span class="chip warn">رصيد تقديري</span>' : ''}${st.pending ? ` <span class="chip warn">غير مؤكد ${fmtKD(st.pending)}</span>` : ''}</div>
    ${st.remaining === 0 && !d.closedConfirmed ? '<button class="btn" data-a="close">تأكيد الإغلاق</button>' : ''}
    ${st.remaining === 0 && d.closedConfirmed ? '<button class="btn secondary" data-a="reopen">إلغاء تأكيد الإغلاق</button>' : ''}
    ${d.group === 'person' && st.remaining > 0 ? `<div class="toggle"><span>مستحق فعلًا (يدخل الجدولة وموعد الإغلاق)</span><button class="switch ${d.verified === false ? '' : 'on'}" data-name="verified" role="switch" aria-checked="${d.verified !== false}"></button></div>` : ''}

    ${st.remaining > 0 ? '<button class="btn" data-a="pay">سداد</button>' : ''}
    ${hist ? `<div class="section-t">العمليات</div><div class="list">${hist}</div>` : ''}

    <details class="more"><summary>تعديل بيانات الدين</summary>
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
    ${field('الاسم', `<input class="input" name="name" value="${esc(d.name)}">`)}
    <div class="row2">${field('الرمز', `<input class="input" name="icon" value="${esc(d.icon || '')}">`)}${field('يبدأ من', `<select class="input" name="start">${monthOptions(d.start)}</select>`)}</div>
    <div class="row2">${field('الرصيد المرجعي', moneyInput('opening', d.opening))}${field('القسط الإلزامي الشهري', moneyInput('mandatory', d.mandatory))}</div>
    ${field('السداد الإضافي', `<select class="input" name="extra">${Object.entries(EXTRA_LABEL).map(([k, t]) => `<option value="${k}" ${d.extra === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
    ${field('يوم الاستحقاق الشهري (اختياري — للتحقق اليومي من توفر المال)', `<input class="input" name="dueday" inputmode="numeric" placeholder="غير محدد" value="${d.dueDay || ''}">`)}
    <button class="btn secondary" data-a="save">حفظ البيانات</button>

    <div class="section-t">تصحيح الرصيد الحقيقي</div>
    <div class="row2">${field('الرصيد الصحيح الآن', moneyInput('newbal', ''))}${field('التاريخ', dateInput('adate', today))}</div>
    ${field('سبب التصحيح', '<input class="input" name="reason" placeholder="مثال: كشف البنك">')}
    <button class="btn secondary" data-a="adjust">تسجيل التصحيح</button>
    <button class="btn danger" data-a="del">حذف الدين</button>
    </details>`, (sh) => {
    sh.querySelector('.switch[data-name="verified"]')?.addEventListener('change', (e) => { commit((s) => A.setVerified(s, id, e.target.classList.contains('on'))); debtSheet(id); });
    on(sh, '[data-a="pay"]', () => paySheet(id));
    on(sh, '[data-a="close"]', () => { if (commit((s) => A.confirmClose(s, id, true), 'تم تأكيد الإغلاق')) closeSheet(); });
    on(sh, '[data-a="reopen"]', () => { if (commit((s) => A.confirmClose(s, id, false))) debtSheet(id); });
    on(sh, '[data-a="edit-pay"]', (e, el) => editPaymentSheet(el.dataset.id, () => debtSheet(id)));
    on(sh, '[data-a="save"]', () => {
      const patch = { name: v(sh, 'name'), icon: v(sh, 'icon'), start: v(sh, 'start'), extra: v(sh, 'extra'), dueDay: v(sh, 'dueday') ? Number(v(sh, 'dueday')) : null };
      const op = money(v(sh, 'opening')); const md = money(v(sh, 'mandatory') || '0');
      if (op !== d.opening) patch.opening = op;
      if (md !== d.mandatory) patch.mandatory = md;
      if (commit((s) => A.updateItem(s, id, patch), 'تم الحفظ')) closeSheet();
    });
    on(sh, '[data-a="adjust"]', () => {
      const nb = money(v(sh, 'newbal'));
      if (commit((s) => A.addAdjustment(s, id, nb, v(sh, 'reason'), v(sh, 'adate')), 'تم تسجيل التصحيح')) debtSheet(id);
    });
    on(sh, '[data-a="del"]', () => {
      if (!confirm(`حذف «${d.name}» وكل دفعاته نهائيًا؟`)) return;
      if (commit((s) => A.deleteItem(s, id), 'تم الحذف')) closeSheet();
    });
  });
}

function expenseSheet(id) {
  const e = E.itemById(state, id);
  if (!e) return;
  const sched = [...(e.schedule || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  openSheet(`${head(`${e.icon || ''} ${esc(e.name)}`, 'مصروف شهري — خارج إجمالي الديون')}
    <div class="section-t">المبالغ</div>
    ${sched.map((s) => `<div class="kv"><span class="k">${e.once ? `في ${E.monthLabel(e.once)}` : `من ${E.monthLabel(s.from)}`}</span><span class="v num">${fmtKD(s.amount)}</span></div>`).join('')}
    ${e.once ? '' : `<div class="row2">${field('مبلغ جديد', moneyInput('amount', ''))}${field('ابتداءً من', `<select class="input" name="from">${monthOptions(view.month)}</select>`)}</div>
    <button class="btn secondary" data-a="sched">تطبيق من هذا الشهر فصاعدًا</button>
    <div class="note">لتعديل شهر واحد فقط، اضغط على البند داخل الشهر.</div>`}
    <div class="section-t">البيانات</div>
    ${field('الاسم', `<input class="input" name="name" value="${esc(e.name)}">`)}
    <div class="row2">${field('الرمز', `<input class="input" name="icon" value="${esc(e.icon || '')}">`)}${e.once ? field('الشهر', `<select class="input" name="once">${monthOptions(e.once)}</select>`) : field('ينتهي في', `<select class="input" name="end">${monthOptions(e.endMonth, { allowEmpty: true, emptyLabel: 'مستمر' })}</select>`)}</div>
    <div class="toggle"><span>يُرحّل غير المدفوع كعجز</span><button class="switch ${e.carry ? 'on' : ''}" data-name="carry" role="switch" aria-checked="${!!e.carry}"></button></div>
    ${field('يوم الاستحقاق الشهري (اختياري)', `<input class="input" name="dueday" inputmode="numeric" placeholder="غير محدد" value="${e.dueDay || ''}">`)}
    <button class="btn secondary" data-a="save">حفظ البيانات</button>
    <button class="btn danger" data-a="del">حذف المصروف</button>`, (sh) => {
    on(sh, '[data-a="sched"]', () => {
      const amount = money(v(sh, 'amount'));
      if (commit((s) => A.setExpenseFrom(s, id, v(sh, 'from'), amount), 'تم التطبيق')) closeSheet();
    });
    on(sh, '[data-a="save"]', () => {
      const patch = { name: v(sh, 'name'), icon: v(sh, 'icon'), carry: sw(sh, 'carry'), dueDay: v(sh, 'dueday') ? Number(v(sh, 'dueday')) : null };
      if (e.once) {
        const once = v(sh, 'once');
        patch.once = once;
        patch.schedule = [{ from: once, amount: sched[0]?.amount || 0 }];
      } else patch.endMonth = v(sh, 'end') || undefined;
      if (commit((s) => A.updateItem(s, id, patch), 'تم الحفظ')) closeSheet();
    });
    on(sh, '[data-a="del"]', () => { if (confirm(`حذف «${e.name}» نهائيًا؟`) && commit((s) => A.deleteItem(s, id), 'تم الحذف')) closeSheet(); });
  });
}

function newDebtSheet(group = 'loan') {
  openSheet(`${head(group === 'person' ? 'دين شخص جديد' : 'قرض أو دين جديد', 'يدخل ضمن إجمالي الديون')}
    <div class="seg" style="margin-top:12px"><button data-g="loan" class="${group === 'loan' ? 'on' : ''}">قرض</button><button data-g="person" class="${group === 'person' ? 'on' : ''}">دين شخص</button></div>
    ${field('الاسم', '<input class="input" name="name">')}
    <div class="row2">${field('الرصيد الأصلي', moneyInput('opening', ''))}${field('القسط الإلزامي', moneyInput('mandatory', ''))}</div>
    <div class="row2">${field('يبدأ من', `<select class="input" name="start">${monthOptions(curBudgetMonth())}</select>`)}${field('الرمز', `<input class="input" name="icon" value="${group === 'person' ? '👤' : '🏦'}">`)}</div>
    ${field('السداد الإضافي', `<select class="input" name="extra">${Object.entries(EXTRA_LABEL).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>`)}
    <button class="btn" data-a="save">إضافة</button>`, (sh) => {
    on(sh, '[data-g]', (e, el) => { group = el.dataset.g; sh.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', b === el)); });
    on(sh, '[data-a="save"]', () => {
      const data = { type: 'debt', group, name: v(sh, 'name'), opening: money(v(sh, 'opening')), mandatory: v(sh, 'mandatory') ? money(v(sh, 'mandatory')) : 0, start: v(sh, 'start'), icon: v(sh, 'icon'), extra: v(sh, 'extra') };
      if (Number.isNaN(data.mandatory)) { toast('القسط غير صالح', true); return; }
      if (commit((s) => A.addItem(s, data), 'تمت الإضافة')) closeSheet();
    });
  });
}

function newExpenseSheet() {
  let once = false;
  openSheet(`${head('مصروف شهري جديد', 'لا يدخل ضمن إجمالي الديون')}
    <div class="seg" style="margin-top:12px"><button data-o="0" class="on">شهري</button><button data-o="1">لمرة واحدة</button></div>
    ${field('الاسم', '<input class="input" name="name">')}
    <div class="row2">${field('المبلغ', moneyInput('amount', ''))}${field('<span data-lbl>يبدأ من</span>', `<select class="input" name="start">${monthOptions(view.month)}</select>`)}</div>
    ${field('الرمز', '<input class="input" name="icon" value="🧾">')}
    <div class="toggle"><span>يُرحّل غير المدفوع كعجز</span><button class="switch on" data-name="carry" role="switch" aria-checked="true"></button></div>
    <button class="btn" data-a="save">إضافة</button>`, (sh) => {
    on(sh, '[data-o]', (e, el) => { once = el.dataset.o === '1'; sh.querySelectorAll('[data-o]').forEach((b) => b.classList.toggle('on', b === el)); sh.querySelector('[data-lbl]').textContent = once ? 'الشهر' : 'يبدأ من'; });
    on(sh, '[data-a="save"]', () => {
      const start = v(sh, 'start');
      const data = { type: 'expense', name: v(sh, 'name'), amount: money(v(sh, 'amount')), start, once: once ? start : undefined, icon: v(sh, 'icon'), carry: sw(sh, 'carry') };
      if (commit((s) => A.addItem(s, data), 'تمت الإضافة')) closeSheet();
    });
  });
}

/**
 * السداد السريع: المبلغ + التاريخ + تأكيد. شهر الخطة يُستنتج من التاريخ، ويُسأل المستخدم فقط عند الالتباس.
 * قبل الحفظ يظهر أثر العملية: سداد سابق (لا يمس السيولة) أو حالي (يُخصم منها).
 */
function paySheet(id, presetMonth = null, suggested = null) {
  const opId = E.uid('op');
  const it = E.itemById(state, id);
  if (!it) return;
  const st = it.type === 'debt' ? E.debtStatus(state, it) : null;
  const sugg = suggested ?? (presetMonth ? Math.max(0, (lineOf(presetMonth, id)?.planned || 0) - (lineOf(presetMonth, id)?.paidReg || 0)) : st ? st.remaining : '');
  let chosen = null;
  openSheet(`${head(`${it.icon || ''} ${esc(it.name)}`, st ? `المتبقي ${fmtKD(st.remaining)} د.ك` : '')}
    <div class="row2">${field('المبلغ', moneyInput('amount', sugg || ''))}${field('تاريخ السداد', dateInput('date', today))}</div>
    <div data-amb></div>
    <div class="impact" data-impact></div>
    <button class="btn" data-a="pay">تأكيد</button>
    <details class="more"><summary>خيارات</summary>
      <div class="toggle"><span>لا أعرف تاريخ السداد (دفعة قديمة)</span><button class="switch" data-name="nodate" role="switch" aria-checked="false"></button></div>
      <div data-month-pick class="hidden">${field('ينتمي لخطة شهر', `<select class="input" name="pmonth">${monthOptions(presetMonth || E.addMonths(sim.F, -1))}</select>`)}</div>
      <div class="toggle"><span>سُجلت ولم تُخصم بعد (غير مؤكدة)</span><button class="switch" data-name="pending" role="switch" aria-checked="false"></button></div>
      ${field('ملاحظة', '<input class="input" name="note" placeholder="اختياري">')}
    </details>`, (sh) => {
    const resolve = () => {
      const unknown = !!sw(sh, 'nodate');
      sh.querySelector('[data-month-pick]').classList.toggle('hidden', !unknown);
      sh.querySelector('[name="date"]').disabled = unknown;
      const date = unknown ? null : v(sh, 'date');
      const amount = money(v(sh, 'amount'));
      let month = null; let amb = '';
      if (unknown) month = v(sh, 'pmonth');
      else if (presetMonth) month = presetMonth;
      else {
        const inf = A.inferPlanMonth(state, id, date, today);
        if (inf.sure) month = inf.month;
        else if (inf.candidates.length) {
          month = chosen && inf.candidates.includes(chosen) ? chosen : null;
          amb = `<div class="field"><label>هذا التاريخ بين خطتين — لأي شهر هذه الدفعة؟</label><div class="seg">${inf.candidates.map((c) => `<button data-pick="${c}" class="${c === month ? 'on' : ''}">${E.monthLabel(c)}</button>`).join('')}</div></div>`;
        }
      }
      sh.querySelector('[data-amb]').innerHTML = amb;
      sh.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { chosen = b.dataset.pick; resolve(); }));
      const imp = A.paymentImpact(state, date, today);
      const closes = st && amount === st.remaining && !Number.isNaN(amount);
      let msg = '';
      if (!date && !unknown) msg = '';
      else if (imp.historical) msg = `<b>سداد سابق:</b> ${closes ? 'سيُغلق الدين' : 'سيُخفّض الدين'} دون خصم من سيولتك الحالية.`;
      else msg = `<b>سداد حالي:</b> سيُخصم المبلغ من سيولتك${closes ? '، وسيُغلق الدين' : ''}.`;
      if (month && !presetMonth && !unknown) msg += ` <span class="dim">(خطة ${E.monthLabel(month)})</span>`;
      sh.querySelector('[data-impact]').innerHTML = msg;
      return { date, unknown, month, amount };
    };
    sh.addEventListener('input', resolve);
    sh.addEventListener('change', resolve);
    resolve();
    on(sh, '[data-a="pay"]', () => {
      const r = resolve();
      if (!r.month) { toast('اختر الشهر الذي تنتمي له الدفعة', true); return; }
      const confirmed = !sw(sh, 'pending');
      if (addPay({ itemId: id, month: r.month, amount: r.amount, date: r.date, dateUnknown: r.unknown, note: v(sh, 'note'), confirmed, opId }, confirmed ? 'تم تسجيل السداد' : 'سُجلت الدفعة')) closeSheet();
    });
    setTimeout(() => sh.querySelector('[name="amount"]')?.focus({ preventScroll: true }), 60);
  });
}

function moreSheet() {
  const item = (act, ic, label) => `<button class="mi" data-m="${act}"><span class="ic">${ic}</span>${label}<span class="chev">‹</span></button>`;
  openSheet(`${head('المزيد')}
    <div class="menu" style="margin-top:6px">
      ${item('cash', '💰', 'الرصيد النقدي')}
      ${item('whatif', '🧪', 'ماذا لو؟')}
      ${item('forecast', '📈', 'تفاصيل التوقع')}
      ${item('daily', '📅', 'التحقق اليومي من توفر المال')}
      ${item('add', '➕', 'إضافة دين أو مصروف أو دخل')}
      ${item('settings', '⚙️', 'الإعدادات والاحتياطيات والأولويات')}
      ${item('audit', '🧾', 'سجل التغييرات')}
    </div>`, (sh) => {
    const map = { cash: cashSheet, whatif: whatIfSheet, forecast: forecastSheet, daily: dailySheet, add: addMenu, settings: settingsSheet, audit: logSheet };
    on(sh, '[data-m]', (e, el) => map[el.dataset.m]());
  });
}

function whatIfSheet() {
  const sc = view.sc;
  if (!sc.start) sc.start = sim.F;
  if (!sc.month) sc.month = sim.F;
  openSheet(`${head('ماذا لو؟', 'تجربة لا تغيّر خطتك')}
    <div class="seg" style="margin-top:10px">
      <button data-sct="once" class="${sc.type === 'once' ? 'on' : ''}">مبلغ لمرة واحدة</button>
      <button data-sct="monthly" class="${sc.type === 'monthly' ? 'on' : ''}">زيادة شهرية</button>
    </div>
    ${field('المبلغ', `<input class="input money" inputmode="decimal" placeholder="500.000" value="${esc(sc.amount)}" data-sc="amount">`)}
    ${sc.type === 'once' ? field('الشهر', `<select class="input" data-sc="month">${monthOptions(sc.month)}</select>`)
    : `<div class="row2">${field('من', `<select class="input" data-sc="start">${monthOptions(sc.start)}</select>`)}${field('حتى', `<select class="input" data-sc="end">${monthOptions(sc.end, { allowEmpty: true, emptyLabel: 'مستمرة' })}</select>`)}</div>`}
    <div id="wi-result"></div>`, (sh) => {
    on(sh, '[data-sct]', (e, el) => { view.sc.type = el.dataset.sct; whatIfSheet(); });
    sh.addEventListener('click', (e) => {
      if (!e.target.closest('[data-a="sc-adopt"]')) return;
      const v2 = scValue();
      const desc = v2.type === 'once' ? `${fmtKD(v2.amount)} د.ك في ${E.monthLabel(v2.month)}` : `${fmtKD(v2.amount)} د.ك شهريًا من ${E.monthLabel(v2.start)}${v2.end ? ` حتى ${E.monthLabel(v2.end)}` : ''}`;
      if (!confirm(`اعتماد في خطتك الفعلية؟\n${desc}`)) return;
      if (commit((s) => A.adoptScenario(s, v2), 'تم الاعتماد')) { view.sc.amount = ''; closeSheet(); }
    });
    updateWhatIf();
  });
}

function forecastSheet() {
  const rel = E.planReliability(state, sim, today);
  const d = E.dashboard(state, sim, E.simulate(state, { today, baseline: true }));
  const lines = [];
  if (rel.historyIncomplete) lines.push(`${rel.unknownPast.length} بندًا في الأشهر السابقة غير مسجل — لا يُعتبر مدفوعًا ولا عجزًا.`);
  if (!rel.cashEntered) lines.push('الرصيد النقدي غير مُدخل — لا تُستخدم فوائض من أشهر سابقة.');
  if (rel.excludedPersons.length) lines.push(`خارج الجدولة بانتظار التحقق: ${rel.excludedPersons.map((x) => `${esc(x.name)} ${fmtKD(x.remaining)}`).join('، ')}.`);
  if (rel.gaps.length) lines.push(`نقص سيولة متوقع في: ${rel.gaps.map((g) => E.monthLabel(g.key)).join('، ')}.`);
  if (rel.overdueIncome.length) lines.push(`دخل متوقع تجاوز موعده: ${rel.overdueIncome.map((x) => `${x.kind === 'rent' ? 'إيجار' : 'راتب'} ${E.monthLabel(x.ofMonth)}`).join('، ')}.`);
  if (rel.timing.length) lines.push(`دخل يصل بعد نافذة شهره: ${rel.timing.map((t) => `${t.kind === 'rent' ? 'إيجار' : 'راتب'} ${E.monthLabel(t.ofMonth)}`).join('، ')}.`);
  if (d.inferred) lines.push(`يشمل ${fmtKD(d.inferred)} د.ك رصيدًا تقديريًا (${rel.inferred.map((x) => esc(x.name)).join('، ')}).`);
  openSheet(`${head('تفاصيل التوقع')}
    <div class="kv"><span class="k">إغلاق الديون المجدولة</span><span class="v">${d.endMonth ? E.monthLabel(d.endMonth) : '—'}</span></div>
    <div class="kv"><span class="k">إغلاق كل الديون المعروفة</span><span class="v">${d.allEnd ? E.monthLabel(d.allEnd) : 'غير محدد'}</span></div>
    <div class="kv"><span class="k">الخطة كما كُتبت</span><span class="v">${d.baselineEnd ? E.monthLabel(d.baselineEnd) : '—'}</span></div>
    <div class="section-t">ما يعتمد عليه التوقع</div>
    ${lines.length ? `<ul class="plain">${lines.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<div class="note">البيانات مكتملة.</div>'}
    <div class="note">التوقع يفترض وصول الراتب وبدل الإيجار في الأشهر القادمة.</div>`);
}

function dailySheet() {
  const dl = daily;
  openSheet(`${head('التحقق اليومي', 'هل يتوفر المال في تاريخ كل استحقاق؟')}
    ${dl.shortfalls.length ? dl.shortfalls.map((x) => `<div class="kv"><span class="k">${E.dateLabel(x.date)} — ${esc(x.label)}</span><span class="v num red">−${fmtKD(x.short)}</span></div>`).join('') : '<div class="note">لا يوجد التزام يستحق قبل توفر المال.</div>'}
    ${dl.undated.length ? `<div class="section-t">بلا تاريخ استحقاق (${dl.undated.length})</div><div class="note">أضف يوم الاستحقاق من صفحة البند ليشمله التحقق.</div>` : ''}`);
}

function visaSheet() {
  const vs = E.visaSummary(state, today);
  openSheet(`${head('الفيزا', `الحد ${fmtKD(vs.limit)} د.ك`)}
    <div class="sumrow" style="grid-template-columns:repeat(3,1fr)">
      <div><div class="l">المستخدم</div><div class="v num">${fmtKD(vs.used)}</div></div>
      <div><div class="l">المستحق</div><div class="v num ${vs.dueUnpaid ? 'amber' : ''}">${fmtKD(vs.dueUnpaid)}</div></div>
      <div><div class="l">المتاح</div><div class="v num">${fmtKD(vs.available)}</div></div>
    </div>
    <div class="kv"><span class="k">آخر كشف مثبت</span><span class="v">${vs.last ? `${fmtKD(vs.last.amount)} (${E.dateLabel(vs.last.cycleEnd)})` : '—'}</span></div>
    <div class="kv"><span class="k">مشتريات الدورة التالية</span><span class="v num">${fmtKD(vs.unbilled)}</span></div>
    ${vs.pending.map((p) => `<div class="banner"><div class="t">كشف ${E.dateLabel(p.cycleEnd)}: ${fmtKD(p.amount)}</div><button class="pill white" data-v="confirm" data-c="${p.cycleEnd}">تثبيت</button></div>`).join('')}
    <div class="row2"><button class="btn secondary" data-v="buy">شراء</button><button class="btn" data-v="pay">سداد</button></div>
    <button class="btn secondary" data-v="hist">العمليات والكشوف</button>`, (sh) => {
    on(sh, '[data-v="buy"]', () => visaBuySheet(null));
    on(sh, '[data-v="pay"]', visaPaySheet);
    on(sh, '[data-v="hist"]', visaHistorySheet);
    on(sh, '[data-v="confirm"]', (e, el) => visaConfirmSheet(el.dataset.c));
  });
}

function addMenu() {
  openSheet(`${head('إضافة')}
    <div class="menu" style="margin-top:8px">
      <button class="mi" data-a="pay"><span class="ic">✅</span>تسجيل دفعة<span class="chev">‹</span></button>
      <button class="mi" data-a="debt"><span class="ic">🏦</span>قرض أو دين جديد<span class="chev">‹</span></button>
      <button class="mi" data-a="person"><span class="ic">👤</span>دين شخص<span class="chev">‹</span></button>
      <button class="mi" data-a="expense"><span class="ic">🧾</span>مصروف شهري جديد<span class="chev">‹</span></button>
      <button class="mi" data-a="extra"><span class="ic">✨</span>دخل إضافي<span class="chev">‹</span></button>
      <button class="mi" data-a="vbuy"><span class="ic">💳</span>شراء بالفيزا<span class="chev">‹</span></button>
      <button class="mi" data-a="vpay"><span class="ic">↩️</span>سداد الفيزا<span class="chev">‹</span></button>
    </div>`, (sh) => {
    on(sh, '[data-a="pay"]', () => { closeSheet(); view.tab = 'debts'; render(); });
    on(sh, '[data-a="debt"]', () => newDebtSheet('loan'));
    on(sh, '[data-a="person"]', () => newDebtSheet('person'));
    on(sh, '[data-a="expense"]', newExpenseSheet);
    on(sh, '[data-a="extra"]', () => extraSheet(null));
    on(sh, '[data-a="vbuy"]', () => visaBuySheet(null));
    on(sh, '[data-a="vpay"]', visaPaySheet);
  });
}

function settingsSheet() {
  const s = state.settings;
  const debts = E.debtsOf(state).sort((a, b) => groupRank(a) - groupRank(b) || a.order - b.order);
  const exps = E.expensesOf(state).sort((a, b) => a.order - b.order);
  const recs = state.recurring || [];
  const allowIds = new Set(debts.filter((d) => d.extra === 'allow').map((d) => d.id));
  const prio = [...(s.payoffPriority || []).filter((id) => allowIds.has(id)), ...[...allowIds].filter((id) => !(s.payoffPriority || []).includes(id))];
  const noAuto = debts.filter((d) => d.extra !== 'allow');
  const itemRow = (it) => `<button class="mi" data-item="${it.id}"><span class="ic">${it.icon || '•'}</span>${esc(it.name)}<span class="chev">‹</span></button>`;
  openSheet(`${head('الإعدادات')}
    <div class="section-t">الدخل الافتراضي</div>
    <div class="row2">${field('الراتب الأساسي', moneyInput('salary', s.salaryDefault))}${field('يوم نزول الراتب', `<input class="input" name="sday" inputmode="numeric" value="${s.salaryDay}">`)}</div>
    <div class="row2">${field('بدل الإيجار', moneyInput('rent', s.rentDefault))}${field('يوم وصوله (الشهر التالي)', `<input class="input" name="rday" inputmode="numeric" value="${s.rentArrivalDay}">`)}</div>
    <div class="section-t">الفيزا</div>
    <div class="row2">${field('الحد الائتماني', moneyInput('vlimit', s.visaLimit))}${field('يوم تثبيت الكشف', `<input class="input" name="vday" inputmode="numeric" value="${s.visaStatementDay}">`)}</div>
    <button class="btn secondary" data-a="save">حفظ الإعدادات</button>
    <div class="note">تغيير القيم الافتراضية يؤثر على الأشهر التي لم تُعدَّل يدويًا فقط.</div>

    <div class="section-t">الرصيد النقدي المتاح</div>
    <div class="kv"><span class="k">${s.cash?.date ? `بتاريخ ${E.dateLabel(s.cash.date)}` : 'غير مُدخل (يُفترض صفرًا)'}</span><span class="v num">${fmtKD(s.cash?.amount || 0)}</span></div>
    <button class="btn secondary" data-a="cash">تعديل الرصيد النقدي</button>

    <div class="section-t">الاحتياطيات (تخصيص نقدي)</div>
    ${(state.reserves || []).map((r) => `<div class="li"><div class="ic">${r.icon || '🔒'}</div><div class="main"><div class="name">${esc(r.name)}</div><div class="sub">حجز ${E.monthLabel(r.month)}، استخدام ${E.monthLabel(r.targetMonth)} لـ ${esc(E.itemById(state, r.targetItem)?.name || '—')}${r.heldDate ? `، محجوز ${E.dateLabel(r.heldDate)}` : ''}</div></div><div class="amt"><div class="a num">${fmtKD(r.amount)}</div></div><button class="pill" data-res="${r.id}">تعديل</button></div>`).join('') || '<div class="empty">لا توجد احتياطيات.</div>'}

    <div class="section-t">أولويات السداد الإضافي (من مارس 2027)</div>
    <div class="note" style="margin-top:0">بعد الأقساط الإلزامية والعجز، يُوجَّه الفائض بهذا الترتيب. الأشهر من سبتمبر إلى فبراير تبقى حسب خطتك الأصلية.</div>
    <div class="list">${prio.map((id, i) => { const it = E.itemById(state, id); return `<div class="li"><div class="ic num" style="font-size:15px;font-weight:700">${i + 1}</div><div class="main"><div class="name">${it.icon || ''} ${esc(it.name)}</div></div><button class="icon-btn sm" data-up="${i}" aria-label="رفع" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg></button><button class="icon-btn sm" data-down="${i}" aria-label="خفض" ${i === prio.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button></div>`; }).join('')}</div>
    ${noAuto.length ? `<div class="note">لا يوزَّع عليها فائض تلقائيًا: ${noAuto.map((d) => esc(d.name)).join('، ')} (السداد المبكر بقرارك فقط).</div>` : ''}
    <div class="quick"><button class="pill" data-a="prio-reset">الترتيب الافتراضي</button></div>

    <div class="section-t">القروض والديون</div>
    <div class="menu">${debts.map(itemRow).join('')}</div>
    <div class="section-t">المصاريف الشهرية</div>
    <div class="menu">${exps.map(itemRow).join('')}</div>
    <div class="quick"><button class="pill" data-a="new-debt">${ICON.plus} دين</button><button class="pill" data-a="new-exp">${ICON.plus} مصروف</button></div>
    ${recs.length ? `<div class="section-t">زيادات شهرية معتمدة</div><div class="list">${recs.map((r) => `<div class="li"><div class="main"><div class="name"><span class="num">${fmtKD(r.amount)}</span> د.ك شهريًا</div><div class="sub">من ${E.monthLabel(r.start)}${r.end ? ` حتى ${E.monthLabel(r.end)}` : ''}</div></div><button class="pill danger" data-rec="${r.id}">حذف</button></div>`).join('')}</div>` : ''}
    <div class="section-t">السجل</div>
    <button class="btn secondary" data-a="log">سجل كل العمليات</button>
    <div class="note">البيانات محفوظة على هذا الجهاز فقط (IndexedDB) وتبقى بعد التحديثات.</div>`, (sh) => {
    on(sh, '[data-a="save"]', () => {
      const patch = { salaryDefault: money(v(sh, 'salary')), rentDefault: money(v(sh, 'rent')), visaLimit: money(v(sh, 'vlimit')), salaryDay: Number(v(sh, 'sday')), rentArrivalDay: Number(v(sh, 'rday')), visaStatementDay: Number(v(sh, 'vday')) };
      const ok = commit((st) => {
        for (const k of ['salaryDefault', 'rentDefault', 'visaLimit']) if (!Number.isSafeInteger(patch[k]) || patch[k] < 0) return 'مبلغ غير صالح';
        for (const k of ['salaryDay', 'rentArrivalDay', 'visaStatementDay']) if (!Number.isInteger(patch[k]) || patch[k] < 1 || patch[k] > 28) return 'اليوم يجب أن يكون بين 1 و 28';
        const changed = Object.keys(patch).filter((k) => patch[k] !== st.settings[k]);
        Object.assign(st.settings, patch);
        st.log.push({ ts: new Date().toISOString(), text: `تعديل الإعدادات (${changed.join('، ') || 'بدون تغيير'})` });
        return null;
      }, 'تم الحفظ');
      if (ok) closeSheet();
    });
    on(sh, '[data-item]', (e, el) => openItem(el.dataset.item));
    const move = (i, j) => { const next = [...prio]; [next[i], next[j]] = [next[j], next[i]]; if (commit((st) => A.setPayoffPriority(st, next), 'تم تعديل الأولويات')) settingsSheet(); };
    on(sh, '[data-up]', (e, el) => { const i = Number(el.dataset.up); move(i, i - 1); });
    on(sh, '[data-down]', (e, el) => { const i = Number(el.dataset.down); move(i, i + 1); });
    on(sh, '[data-a="prio-reset"]', () => { if (commit((st) => A.resetPayoffPriority(st), 'تمت الإعادة')) settingsSheet(); });
    on(sh, '[data-a="new-debt"]', () => newDebtSheet('loan'));
    on(sh, '[data-a="new-exp"]', newExpenseSheet);
    on(sh, '[data-rec]', (e, el) => { if (confirm('حذف هذه الزيادة الشهرية من الخطة؟') && commit((st) => A.deleteRecurring(st, el.dataset.rec), 'تم الحذف')) settingsSheet(); });
    on(sh, '[data-a="log"]', logSheet);
    on(sh, '[data-a="cash"]', cashSheet);
    on(sh, '[data-res]', (e, el) => reserveSheet(el.dataset.res));
  });
}

function reserveSheet(id) {
  const r = (state.reserves || []).find((x) => x.id === id);
  if (!r) return;
  openSheet(`${head(esc(r.name), 'المبلغ يُحجز مرة واحدة ويُستخدم لدفع البند المستهدف — لا يُحتسب مصروفًا مرتين')}
    ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    <div class="section-t">مصادر التمويل وتوقيتها</div>
    ${E.reserveFunding(state, r).sources.map((x) => `<div class="kv"><span class="k">${x.kind === 'rent' ? 'بدل إيجار' : 'راتب'} ${E.monthLabel(x.ofMonth)} — ${x.received ? 'وصل' : 'يصل'} ${E.dateLabel(x.date)}</span><span class="v num">${fmtKD(x.amount)}</span></div>`).join('')}
    <div class="kv"><span class="k">يكتمل التمويل ويصبح متاحًا كاملًا</span><span class="v">${E.dateLabel(E.reserveFunding(state, r).completeDate)}</span></div>
    <div class="kv"><span class="k">الحجز</span><span class="v">${r.heldDate ? `مؤكد ${E.dateLabel(r.heldDate)}` : 'متوقع عند وصول كل مصدر'}</span></div>
    <div class="kv"><span class="k">الاستخدام</span><span class="v">${esc(E.itemById(state, r.targetItem)?.name || '—')} — ${E.monthLabel(r.targetMonth)}${E.reserveFunding(state, r).dueDate ? `، يستحق ${E.dateLabel(E.reserveFunding(state, r).dueDate)}` : '، تاريخ الاستحقاق غير محدد'}</span></div>
    ${E.reserveFunding(state, r).dueBeforeFunded ? '<div class="alert">تاريخ استحقاق الجامعة قبل اكتمال التمويل.</div>' : ''}
    <div class="note">الاحتياطي يُستخدم فقط للبند المستهدف ولا يُستعمل لسداد الديون. يخرج من النقد مرة واحدة عند الحجز.</div>
    ${field('المبلغ', moneyInput('amount', r.amount))}
    <div class="row2">${field('شهر الحجز', `<select class="input" name="month">${monthOptions(r.month)}</select>`)}${field('شهر الاستخدام', `<select class="input" name="target">${monthOptions(r.targetMonth)}</select>`)}</div>
    <div class="toggle"><span>تم الحجز فعليًا</span><button class="switch ${r.heldDate ? 'on' : ''}" data-name="held" role="switch" aria-checked="${!!r.heldDate}"></button></div>
    ${field('تاريخ الحجز', dateInput('hdate', r.heldDate || today))}
    <button class="btn" data-a="save">حفظ</button>`, (sh) => {
    on(sh, '[data-a="save"]', () => {
      const amount = money(v(sh, 'amount'));
      const ok = commit((s) => {
        const e1 = A.updateReserve(s, id, { amount, month: v(sh, 'month'), targetMonth: v(sh, 'target') });
        if (e1) return e1;
        const held = sw(sh, 'held');
        if (held !== !!r.heldDate || (held && v(sh, 'hdate') !== r.heldDate)) return A.holdReserve(s, id, held ? v(sh, 'hdate') : null);
        return null;
      }, 'تم الحفظ');
      if (ok) closeSheet();
    });
  });
}

function logSheet() {
  const items = [...state.log].reverse();
  const fmtTs = (ts) => {
    try { return new Intl.DateTimeFormat('ar-KW-u-nu-latn', { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts)); } catch { return ts; }
  };
  openSheet(`${head('سجل العمليات', `${items.length} عملية`)}
    <div class="loglist" style="margin-top:10px">${items.map((l) => `<div class="lg">${esc(l.text)}<div class="d">${fmtTs(l.ts)}</div></div>`).join('')}</div>`);
}

function openItem(id) {
  const it = E.itemById(state, id);
  if (!it) return;
  if (it.type === 'debt') debtSheet(id); else expenseSheet(id);
}

/* ── الفيزا ── */
function visaBuySheet(id) {
  const opId = E.uid('op'); // يمنع حفظ النافذة نفسها مرتين
  const p = id ? state.visa.purchases.find((x) => x.id === id) : null;
  const sd = state.settings.visaStatementDay;
  openSheet(`${head(p ? 'تعديل شراء' : 'شراء بالفيزا')}
    <div class="row2">${field('المبلغ', moneyInput('amount', p?.amount ?? ''))}${field('تاريخ الشراء', dateInput('date', p?.date || today))}</div>
    ${field('الوصف', `<input class="input" name="note" value="${esc(p?.note || '')}" placeholder="اختياري">`)}
    <div class="note" data-cycle></div>
    <button class="btn" data-a="save">حفظ</button>
    ${p ? '<button class="btn danger" data-a="del">حذف</button>' : ''}`, (sh) => {
    const upd = () => { const d = v(sh, 'date'); sh.querySelector('[data-cycle]').textContent = d ? `يُسجّل على كشف ${E.dateLabel(E.visaCycleEnd(d, sd))}` : ''; };
    sh.querySelector('[name="date"]').addEventListener('change', upd); upd();
    on(sh, '[data-a="save"]', () => {
      const data = { amount: money(v(sh, 'amount')), date: v(sh, 'date'), note: v(sh, 'note') };
      const done = p ? commit((s) => A.updateVisaPurchase(s, p.id, data), 'تم الحفظ')
        : guarded({ ...data, opId }, (d, draft) => A.addVisaPurchase(draft, d, today), () => `توجد عملية شراء مطابقة (${fmtKD(data.amount)} د.ك، ${E.dateLabel(data.date)}). هل هي عملية مستقلة فعلًا؟`, 'تم الحفظ');
      if (done) closeSheet();
    });
    on(sh, '[data-a="del"]', () => { if (confirm('حذف عملية الشراء؟') && commit((s) => A.deleteVisaPurchase(s, p.id), 'تم الحذف')) closeSheet(); });
  });
}

function visaPaySheet() {
  const opId = E.uid('op'); // يمنع حفظ النافذة نفسها مرتين
  const vs = E.visaSummary(state, today);
  openSheet(`${head('سداد الفيزا', `المستخدم غير المسدد ${fmtKD(vs.used)} د.ك`)}
    <div class="row2">${field('المبلغ', moneyInput('amount', vs.dueUnpaid || ''))}${field('التاريخ', dateInput('date', today))}</div>
    <div class="quick">${vs.dueUnpaid ? `<button class="pill" data-fill="${vs.dueUnpaid}">المستحق (<span class="num">${fmtKD(vs.dueUnpaid)}</span>)</button>` : ''}<button class="pill" data-fill="${vs.used}">كامل المستخدم (<span class="num">${fmtKD(vs.used)}</span>)</button></div>
    ${field('يُخصم من سيولة شهر', `<select class="input" name="cm">${monthOptions(curBudgetMonth(), { allowEmpty: true, emptyLabel: 'لا يُخصم من الخطة' })}</select>`)}
    <div class="note">السداد يعيد المتاح بقدر المبلغ ولا يحذف العمليات أو الكشوف السابقة.</div>
    <button class="btn" data-a="pay">تسجيل السداد</button>`, (sh) => {
    on(sh, '[data-fill]', (e, el) => { sh.querySelector('[name="amount"]').value = inputKD(Number(el.dataset.fill)); });
    on(sh, '[data-a="pay"]', () => {
      const amount = money(v(sh, 'amount'));
      const data = { amount, date: v(sh, 'date'), cashMonth: v(sh, 'cm') || null, opId };
      if (guarded(data, (d, draft) => A.addVisaPayment(draft, d, today), () => `يوجد سداد فيزا مطابق (${fmtKD(amount)} د.ك، ${E.dateLabel(data.date)}). هل هو سداد مستقل فعلًا؟`, 'تم تسجيل السداد')) closeSheet();
    });
  });
}

function visaConfirmSheet(cycleEnd) {
  const sd = state.settings.visaStatementDay;
  const ops = state.visa.purchases.filter((p) => E.visaCycleEnd(p.date, sd) === cycleEnd).sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = ops.reduce((a, p) => a + p.amount, 0);
  const existing = state.visa.statements.find((s) => s.cycleEnd === cycleEnd);
  openSheet(`${head(`كشف ${E.dateLabel(cycleEnd)}`, `عمليات من ${E.dateLabel(E.dateIn(E.addMonths(cycleEnd.slice(0, 7), -1), sd + 1))} حتى ${E.dateLabel(cycleEnd)}`)}
    <div class="list" style="margin-top:8px">${ops.map((p) => `<div class="li"><div class="main"><div class="name">${esc(p.note || 'شراء')}</div><div class="sub">${E.dateLabel(p.date)}</div></div><div class="amt"><div class="a num">${fmtKD(p.amount)}</div></div></div>`).join('') || '<div class="empty">لا توجد عمليات.</div>'}</div>
    <div class="kv total"><span class="k">مبلغ الكشف</span><span class="v num">${fmtKD(total)}</span></div>
    ${existing ? `<div class="note">مثبت سابقًا بمبلغ ${kd(existing.amount)} د.ك. إعادة التثبيت تحفظ القيمة السابقة في السجل.</div>` : ''}
    <button class="btn" data-a="confirm">${existing ? 'إعادة التثبيت' : 'تثبيت الكشف'}</button>`, (sh) => {
    on(sh, '[data-a="confirm"]', () => { if (commit((s) => A.confirmStatement(s, cycleEnd, today), 'تم تثبيت الكشف')) closeSheet(); });
  });
}

function visaHistorySheet() {
  const v2 = state.visa;
  const sd = state.settings.visaStatementDay;
  const ops = [
    ...v2.purchases.map((p) => ({ d: p.date, html: `<div class="li row-tap" data-buy="${p.id}"><div class="ic">🛍️</div><div class="main"><div class="name">${esc(p.note || 'شراء')}</div><div class="sub">${E.dateLabel(p.date)} — كشف ${E.dateLabel(E.visaCycleEnd(p.date, sd))}</div></div><div class="amt"><div class="a num">${fmtKD(p.amount)}</div></div></div>` })),
    ...v2.payments.map((p) => ({ d: p.date, html: `<div class="li"><div class="ic">↩️</div><div class="main"><div class="name">سداد</div><div class="sub">${E.dateLabel(p.date)}${p.cashMonth ? ` — من سيولة ${E.monthLabel(p.cashMonth)}` : ''}</div></div><div class="amt"><div class="a num green">${fmtKD(p.amount)}</div></div><button class="pill danger" data-delpay="${p.id}">حذف</button></div>` })),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).map((x) => x.html).join('');
  const sts = [...v2.statements].sort((a, b) => (a.cycleEnd < b.cycleEnd ? 1 : -1)).map((s) => `<div class="li"><div class="ic">📄</div><div class="main"><div class="name">كشف ${E.dateLabel(s.cycleEnd)}</div><div class="sub">ثُبّت ${E.dateLabel(s.confirmedAt.slice(0, 10))}${s.history?.length ? ` — أُعيد تثبيته ${s.history.length} مرة` : ''}</div></div><div class="amt"><div class="a num">${fmtKD(s.amount)}</div></div></div>`).join('');
  openSheet(`${head('عمليات الفيزا')}
    <div class="section-t">الكشوف المثبتة</div><div class="list">${sts || '<div class="empty">لا توجد كشوف بعد.</div>'}</div>
    <div class="section-t">العمليات</div><div class="list">${ops || '<div class="empty">لا توجد عمليات. سجّل أول شراء من زر «شراء».</div>'}</div>`, (sh) => {
    on(sh, '[data-buy]', (e, el) => visaBuySheet(el.dataset.buy));
    on(sh, '[data-delpay]', (e, el) => { if (confirm('حذف عملية السداد؟') && commit((s) => A.deleteVisaPayment(s, el.dataset.delpay), 'تم الحذف')) visaHistorySheet(); });
  });
}

/* ───────────── الأحداث ───────────── */
function setMonth(m) {
  view.month = m < state.settings.planStart ? state.settings.planStart : m;
  lsSet('mfp-view-month', view.month);
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('.sheet-wrap')) return;
  const d = el.dataset;
  switch (d.act) {
    case 'tab': view.tab = d.t; lsSet('mfp-tab', d.t); render(); window.scrollTo(0, 0); break;
    case 'more': moreSheet(); break;
    case 'settings': settingsSheet(); break;
    case 'add': addMenu(); break;
    case 'log': logSheet(); break;
    case 'pay': paySheet(d.id, d.m && d.m === sim.F ? null : (d.m || null), d.amt ? Number(d.amt) : null); break;
    case 'goto-month': view.tab = 'plan'; setMonth(d.m); window.scrollTo(0, 0); break;
    case 'visa': visaSheet(); break;
    case 'visa-buy-edit': visaBuySheet(d.id); break;
    case 'visa-pay-del': if (confirm('حذف عملية سداد الفيزا؟')) commit((s) => A.deleteVisaPayment(s, d.id), 'تم الحذف'); break;
    case 'edit-pay': editPaymentSheet(d.id); break;
    case 'prev': setMonth(E.addMonths(view.month, -1)); break;
    case 'next': setMonth(E.addMonths(view.month, 1)); break;
    case 'month': setMonth(d.m); break;
    case 'cell': {
      if (d.m !== view.month) { view.month = d.m; lsSet('mfp-view-month', d.m); render(); }
      cellSheet(d.m, d.id, true); break;
    }
    case 'cell-detail': cellSheet(d.m, d.id, false); break;
    case 'item': openItem(d.id); break;
    case 'arrears-pay': arrearsSheet(d.m, d.id); break;
    case 'arrears-inline': {
      const inp = document.querySelector(`[data-arr-in="${d.id}"]`);
      const amount = money(inp?.value || '');
      addPay({ itemId: d.id, month: d.m, kind: 'arrears', amount, date: today, opId: el.dataset.op }, 'تم السداد من العجز');
      break;
    }
    case 'month-close': monthCloseSheet(view.month); break;
    case 'income': incomeSheet(d.kind, d.m || view.month); break;
    case 'income-toggle': {
      const mm = d.m || view.month;
      const x = d.kind === 'salary' ? E.salaryFor(state, mm) : E.rentFor(state, mm);
      if (x.received) {
        if (confirm('إلغاء تأكيد الاستلام؟')) commit((s) => A.setIncome(s, mm, d.kind, { received: false }), 'أُلغي التأكيد');
      } else incomeSheet(d.kind, mm, true);
      break;
    }
    case 'cash': cashSheet(); break;
    case 'reserve': reserveSheet(d.id); break;
    case 'reserve-toggle': {
      const r = (state.reserves || []).find((x) => x.id === d.id);
      if (!r) break;
      if (r.heldDate) { if (confirm('إلغاء تأكيد حجز الاحتياطي؟')) commit((s) => A.holdReserve(s, r.id, null), 'أُلغي الحجز'); }
      else if (confirm(`تأكيد حجز ${fmtKD(r.amount)} د.ك (${r.name}) بتاريخ اليوم؟`)) commit((s) => A.holdReserve(s, r.id, today), 'تم تأكيد الحجز');
      break;
    }
    case 'verify': {
      const it = E.itemById(state, d.id);
      if (confirm(`هل «${it.name}» مستحق فعلًا؟ سيدخل الجدولة التلقائية وموعد الإغلاق.`)) commit((s) => A.setVerified(s, d.id, true), 'أُدرج في الجدولة');
      break;
    }
    case 'extra': extraSheet(d.id); break;
    case 'extra-new': extraSheet(null); break;
    case 'debt-pay': debtSheet(d.id); break;
    case 'debt-new': newDebtSheet(d.group || 'loan'); break;
    case 'close-confirm': if (confirm('تأكيد إغلاق هذا الدين؟')) commit((s) => A.confirmClose(s, d.id, true), 'تم تأكيد الإغلاق'); break;
    case 'visa-buy': visaBuySheet(null); break;
    case 'visa-pay': visaPaySheet(); break;
    case 'visa-confirm': visaConfirmSheet(d.c); break;
    case 'visa-history': visaHistorySheet(); break;
    default: break;
  }
});

let wiTimer = null;
document.addEventListener('input', (e) => {
  const q = e.target.closest('[data-search]');
  if (q) { view.q = q.value; const box = $('#log-list'); if (box) box.innerHTML = logListHtml(view.q); return; }
  const el = e.target.closest('[data-sc]');
  if (!el) return;
  view.sc[el.dataset.sc] = el.value;
  clearTimeout(wiTimer);
  wiTimer = setTimeout(updateWhatIf, 180);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('select[data-sc]');
  if (!el) return;
  view.sc[el.dataset.sc] = el.value;
  updateWhatIf();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && E.kuwaitToday() !== today) render();
});

/* ───────────── التشغيل ───────────── */
async function boot() {
  const loaded = await loadState();
  let s = loaded.state;
  if (!s && loaded.unreadable) {
    $('#app').innerHTML = '<header class="top"><h1>خطتي المالية</h1></header><div class="alert">تعذرت قراءة البيانات المحفوظة على هذا الجهاز. لم يُنشأ أي شيء فوقها، وحُفظت نسخة من النص التالف. أعد فتح التطبيق.</div>';
    return;
  }
  if (!s || !s.schema) {
    s = E.createSeedState();
    await saveState(s);
  }
  // ترحيل آمن للبيانات المحفوظة — على نسخة؛ إن فشل لا يُحفظ شيء ولا تُستبدل البيانات
  let mig;
  try { mig = E.migrate(s); } catch (e) {
    $('#app').innerHTML = `<header class="top"><h1>خطتي المالية</h1></header><div class="alert">تعذر تحديث صيغة البيانات المحفوظة (${esc(e.message)}). لم يُغيَّر أو يُحذف شيء. أبلغ عن المشكلة قبل أي إدخال جديد.</div>`;
    return;
  }
  s = mig.state;
  if (mig.changed) await saveState(s);
  state = s;
  const savedTab = lsGet('mfp-tab');
  view.tab = ['home', 'debts', 'plan', 'log'].includes(savedTab) ? savedTab : 'home';
  const saved = lsGet('mfp-view-month');
  view.month = saved && /^\d{4}-\d{2}$/.test(saved) ? saved : today.slice(0, 7);
  if (view.month < state.settings.planStart) view.month = state.settings.planStart;
  render();
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // عند تثبيت نسخة جديدة: أعد التحميل مرة واحدة لتطبيقها (البيانات في IndexedDB لا تتأثر)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'activated' && navigator.serviceWorker.controller && !sessionStorage.getItem('mfp-updated')) {
            try { sessionStorage.setItem('mfp-updated', '1'); } catch { /* ignore */ }
            location.reload();
          }
        });
      });
    }).catch(() => {});
  }
}
boot();

// للاختبارات
window.__mfp = { get state() { return state; }, E, A, fmtKD, get today() { return today; } };
