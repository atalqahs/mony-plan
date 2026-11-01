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
const view = { month: null, sc: { type: 'monthly', amount: '', start: null, end: '', month: null } };
let sim = null;

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

/** تنفيذ عملية + حفظ + إعادة رسم */
function commit(fn, okMsg) {
  const err = fn(state);
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
function render() {
  today = E.kuwaitToday();
  const winStart = gridWindow()[0];
  const winEnd = gridWindow()[5];
  sim = E.simulate(state, { today, until: [view.month, winEnd].sort().pop() });
  const baseSim = E.simulate(state, { today, baseline: true });
  const dash = E.dashboard(state, sim, baseSim);
  const rel = E.planReliability(state, sim, today);
  rel.histEnd = rel.historyIncomplete ? E.simulate(state, { today, assumeHistory: true }).endMonth : null;
  const vs = E.visaSummary(state, today);
  const m = sim.byKey[view.month];
  void winStart;

  $('#app').innerHTML = `
    <header class="top">
      <h1>خطتي المالية</h1>
      <div class="acts">
        <button class="icon-btn" data-act="settings" aria-label="الإعدادات">${ICON.gear}</button>
        <button class="icon-btn" data-act="add" aria-label="إضافة">${ICON.plus}</button>
      </div>
    </header>
    ${visaBanner(vs)}
    ${dashboardCard(dash, rel)}
    <div class="subhead">
      <h2>${E.monthLabel(view.month)}</h2>
      <div class="nav">
        <button class="icon-btn sm" data-act="prev" aria-label="الشهر السابق" ${view.month <= state.settings.planStart ? 'disabled' : ''}>${ICON.right}</button>
        <button class="icon-btn sm" data-act="next" aria-label="الشهر التالي">${ICON.left}</button>
      </div>
    </div>
    ${gridCard()}
    ${obligationsCard(m)}
    ${arrearsCard(m)}
    ${incomeCard(m)}
    ${liquidityCard(m)}
    ${personsCard()}
    ${visaCard(vs)}
    ${whatIfCard()}
    <div class="quick" style="justify-content:center;margin-top:6px">
      <button class="pill" data-act="log">سجل العمليات</button>
      <button class="pill" data-act="settings">الإعدادات</button>
    </div>
  `;
  updateWhatIf();
}

function gridWindow() {
  const start = E.monthIndex(state.settings.planStart);
  let a = E.monthIndex(view.month) - 2;
  if (a < start) a = start;
  return Array.from({ length: 6 }, (_, i) => E.monthKey(a + i));
}

/* ── لوحة المعلومات ── */
const monthsWord = (n) => (n === 1 ? 'شهر' : n === 2 ? 'شهرين' : n <= 10 ? `${n} أشهر` : `${n} شهرًا`);
function dashboardCard(d, rel) {
  const t = d.progressTenths;
  const thisMonth = E.confirmedPayments(state).filter((p) => p.date && p.date.slice(0, 7) === today.slice(0, 7) && E.itemById(state, p.itemId)?.type === 'debt').reduce((a, p) => a + p.amount, 0);
  let deltaTxt = '—'; let deltaCls = 'muted';
  if (d.deltaMonths !== null) {
    const n = Math.abs(d.deltaMonths);
    if (d.deltaMonths < 0) { deltaTxt = `متقدم ${monthsWord(n)}`; deltaCls = 'green'; }
    else if (d.deltaMonths > 0) { deltaTxt = `متأخر ${monthsWord(n)}`; deltaCls = 'red'; }
    else deltaTxt = 'حسب الخطة';
  }
  const estimate = !rel.reliable;
  if (rel.historyIncomplete && d.deltaMonths !== null) { deltaTxt = 'غير مؤكد'; deltaCls = 'amber'; }
  const left = d.endMonth ? E.monthIndex(d.endMonth) - E.monthIndex(today.slice(0, 7)) : null;
  const warn = [];
  if (rel.historyIncomplete) warn.push(`السجل التاريخي غير مكتمل: ${rel.unknownPast.length} بندًا في الأشهر الماضية غير مسجل (لا نعرف هل دُفع). الأرصدة لا تُخفَّض ولا يُحتسب عجز حتى تسجلها أو تقفل الشهر.${rel.histEnd ? ` لو كانت مدفوعة حسب الخطة يصبح الإغلاق التقديري ${E.monthLabel(rel.histEnd)}.` : ''}`);
  if (!rel.cashEntered) warn.push('لم يُدخل الرصيد النقدي المتاح — يُفترض صفرًا ولا تُستخدم أي فوائض من أشهر سابقة.');
  else if (rel.cashStale) warn.push(`الرصيد النقدي مُدخل بتاريخ ${E.dateLabel(state.settings.cash.date)} — حدّثه لنتيجة أدق.`);
  if (rel.excludedPersons.length) warn.push(`ديون أشخاص بانتظار التحقق خارج الجدولة وموعد الإغلاق: ${rel.excludedPersons.map((x) => `${esc(x.name)} ${fmtKD(x.remaining)}`).join('، ')}.`);
  if (rel.gaps.length) warn.push(`السيولة المتوقعة لا تكفي الالتزامات في ${rel.gaps.slice(0, 3).map((g) => E.monthLabel(g.key)).join('، ')}${rel.gaps.length > 3 ? ` و${rel.gaps.length - 3} أشهر أخرى` : ''} — الخطة تمتد تبعًا لذلك.`);
  return `
  <section class="card" aria-label="لوحة الديون">
    <div class="card-head">
      <h2 class="card-title">الديون المتبقية فعليًا</h2>
      <button class="pill" data-act="quick-pay">${ICON.plus} تسجيل دفعة</button>
    </div>
    <div class="big">
      <div><span class="val num">${fmtKD(d.remaining)}</span><span class="unit">د.ك</span></div>
      <div class="side ${thisMonth > 0 ? 'green' : 'muted'}">↓ ${kd(thisMonth)} هذا الشهر</div>
    </div>
    <div class="bar" role="progressbar" aria-valuenow="${Math.floor(t / 10)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${t / 10}%"></i></div>
    <div class="bar-legend"><span>الأصلية <b class="num">${fmtKD(d.original)}</b></span><b class="num">${pct(t)}</b><span>المسدد المؤكد <b class="num">${fmtKD(d.paid)}</b></span></div>
    ${d.original !== d.initial ? `<div class="note">عند بداية الخطة ${kd(d.initial)} د.ك، وبعد تصحيحات الأرصدة والديون المضافة ${kd(d.original)} د.ك.</div>` : ''}
    <div class="divider"></div>
    <div class="stats">
      <div><div class="l">الإغلاق ${estimate ? 'التقديري' : 'المتوقع'}</div><div class="v ${d.endMonth ? '' : 'red'}">${d.endMonth ? E.monthLabel(d.endMonth) : 'غير قابل للتحديد'}</div>${left !== null && left >= 0 ? `<div class="s">بعد ${monthsWord(left)}</div>` : ''}</div>
      <div><div class="l">الخطة كما كُتبت</div><div class="v">${d.baselineEnd ? E.monthLabel(d.baselineEnd) : '—'}</div></div>
      <div><div class="l">الفرق</div><div class="v ${deltaCls}">${deltaTxt}</div></div>
    </div>
    ${!d.endMonth ? '<div class="alert">لا يمكن إنهاء الخطة وفق الافتراضات الحالية: السيولة المتوقعة لا تكفي. لن يُعرض موعد وهمي.</div>' : ''}
    ${warn.map((w) => `<div class="alert amber">${w}</div>`).join('')}
    <div class="note">الموعد محسوب من الأرصدة المرجعية والدفعات المؤكدة والرصيد النقدي المُدخل فقط، مع افتراض وصول الراتب وبدل الإيجار في الأشهر القادمة (توقع غير مستلم). لا يدخل فيه دخل غير مؤكد ولا سيناريوهات.${d.inferred ? ` يشمل الإجمالي ${kd(d.inferred)} د.ك رصيدًا مستنتجًا غير مؤكد (${rel.inferred.map((x) => esc(x.name)).join('، ')}).` : ''}</div>
  </section>`;
}

function visaBanner(vs) {
  if (!vs.pending.length) return '';
  const p = vs.pending[0];
  return `<div class="banner"><div><div class="t">كشف الفيزا ${E.dateLabel(p.cycleEnd)} بانتظار التثبيت</div><div class="s">المبلغ حسب العمليات: ${kd(p.amount)} د.ك${vs.pending.length > 1 ? ` — و${vs.pending.length - 1} كشف آخر` : ''}</div></div><button class="pill white" data-act="visa-confirm" data-c="${p.cycleEnd}">مراجعة</button></div>`;
}

/* ── شبكة الأشهر ── */
const groupRank = (it) => (it.type === 'debt' ? (it.group === 'person' ? 2 : 0) : 1);
function gridCard() {
  const cols = gridWindow();
  const nowM = curBudgetMonth();
  const ids = new Map();
  for (const k of cols) {
    const mm = sim.byKey[k];
    if (!mm) continue;
    for (const l of mm.lines) if (l.status !== 'na' || l.arrStart > 0) ids.set(l.id, l.item);
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
    const st = streak(it.id);
    return `<div class="g-row g-item"><div class="g-name row-tap" data-act="item" data-id="${it.id}"><span class="ic">${it.icon || '•'}</span><span class="t">${esc(shortName(it))}</span>${st ? `<span class="streak">🔥<span class="num">${st}</span></span>` : ''}</div>${cells}</div>`;
  }).join('');
  return `<section class="card grid" aria-label="جدول الأشهر"><div class="g-row g-head"><span></span>${head}</div>${rows || '<div class="empty">لا توجد التزامات في هذه الفترة.</div>'}</section>`;
}
const SHORT = { personal: 'المصروف', uni: 'الجامعة' };
const shortName = (it) => it.short || SHORT[it.id] || it.name.replace(/^قرض\s+/, '');
function streak(id) {
  let n = 0;
  for (let i = sim.months.findIndex((m) => m.key === view.month); i >= 0; i--) {
    const l = sim.months[i].lines.find((x) => x.id === id);
    if (!l || l.status === 'na') continue;
    if (l.status === 'done') n++; else break;
  }
  return n;
}

/* ── الالتزامات ── */
function obligationsCard(m) {
  const md = state.months[view.month] || {};
  const lines = m.lines.filter((l) => l.planned > 0 || l.paidReg > 0).sort((a, b) => groupRank(a.item) - groupRank(b.item) || a.item.order - b.item.order);
  const rows = lines.map((l) => {
    const due = md.dueDates?.[l.id];
    const subs = [];
    if (l.type === 'debt' && l.mandatory > 0) subs.push(`القسط الإلزامي ${kd(l.mandatory)}`);
    if (due) subs.push(`الاستحقاق ${E.dateLabel(due)}`);
    const tag = l.engineManaged ? '<span class="tag">جدولة تلقائية</span>' : l.stored !== null && l.type === 'expense' ? '<span class="tag">معدّل</span>' : '';
    if (l.item.openingInferred) subs.push('<span class="amber">رصيد مستنتج غير مؤكد</span>');
    if (l.pendingReg > 0) subs.push(`مسجلة بانتظار التأكيد ${kd(l.pendingReg)}`);
    if (l.status === 'unknown') subs.push('<span class="amber">غير مسجل</span>');
    if (l.status === 'missed') subs.push('<span class="red">غير مسدد — الشهر مقفل</span>');
    if (l.potCover > 0) subs.push(`من الاحتياطي ${kd(l.potCover)}`);
    if (l.unverified) subs.push('بانتظار التحقق');
    const frac = l.planned > 0 ? l.paidReg / l.planned : 0;
    return `<div class="li">
      <div class="ic">${l.icon || '•'}</div>
      <div class="main row-tap" data-act="cell-detail" data-m="${view.month}" data-id="${l.id}">
        <div class="name">${esc(l.name)}${tag}</div>
        ${subs.length ? `<div class="sub">${subs.join('، ')}</div>` : ''}
        ${l.belowMandatory ? `<div class="warn">المدفوع أقل من القسط الإلزامي المطلوب (${kd(l.mandatoryCap)} د.ك). لا يُفترض أن البنك وافق على التأخير أو أن رسومه صفر.</div>` : ''}
        ${l.unmet > 0 ? `<div class="warn">السيولة المتوقعة لا تغطي ${kd(l.unmet)} د.ك من هذا البند</div>` : ''}
      </div>
      <div class="amt row-tap" data-act="cell-detail" data-m="${view.month}" data-id="${l.id}"><div class="a num">${fmtKD(l.planned)}</div><div class="b">مدفوع ${kd(l.paidReg)}</div></div>
      <button class="chk" data-act="cell" data-m="${view.month}" data-id="${l.id}" aria-label="تأكيد ${esc(l.name)}">${checkSvg(l.status, frac, true)}</button>
    </div>`;
  }).join('');
  const resRows = m.reserves.map((r) => `<div class="li">
      <div class="ic">${r.icon}</div>
      <div class="main"><div class="name">${esc(r.name)}</div><div class="sub">تخصيص نقدي لاستخدامه في ${E.monthLabel(r.reserve.targetMonth)}${r.held ? `، حُجز ${E.dateLabel(r.reserve.heldDate)}` : r.status === 'unknown' ? '، <span class="amber">غير مسجل</span>' : ''}</div></div>
      <div class="amt"><div class="a num">${fmtKD(r.planned)}</div><div class="b">${r.held ? 'محجوز' : 'غير محجوز'}</div></div>
      <button class="chk" data-act="reserve-toggle" data-id="${r.id}" aria-label="تأكيد حجز ${esc(r.name)}">${checkSvg(r.status, 0, true)}</button>
    </div>`).join('');
  const unknownNote = m.past && m.unknownCount ? `<div class="alert amber">السجل غير مكتمل: ${m.unknownCount} بنود غير مسجلة بقيمة ${kd(m.unknownAmount)} د.ك. لا تُعتبر مدفوعة ولا عجزًا حتى تسجل الدفع أو تقفل الشهر.</div>` : '';
  return `<section class="card">
    <div class="card-head"><h2 class="card-title">الالتزامات الشهرية</h2><button class="pill" style="font-size:13px" data-act="month-close">${m.closed ? 'مقفل — إعادة فتح' : 'إقفال الشهر'}</button></div>
    <div class="list">${rows || '<div class="empty">لا توجد التزامات هذا الشهر.</div>'}${resRows}</div>
    ${unknownNote}
    ${md.notes ? `<div class="note">${esc(md.notes)}</div>` : ''}
  </section>`;
}

/* ── العجز ── */
function arrearsCard(m) {
  // مربع العجز منفصل عن القسط الأساسي: اسم البند + العجز المتبقي + إدخال مبلغ السداد فقط
  const lines = m.lines.filter((l) => l.arrRemaining > 0);
  if (!lines.length) return '';
  const confirmedRows = lines.filter((l) => l.arrStartC > 0).map((l) => `<div class="li arr-row">
      <div class="main"><div class="name">${l.icon || ''} ${esc(l.name)}</div></div>
      <div class="amt"><div class="a num">${fmtKD(Math.max(0, l.arrStartC - l.paidArr))}</div><div class="b">العجز المتبقي</div></div>
      <input class="input money arr-in" inputmode="decimal" placeholder="0.000" aria-label="مبلغ السداد من عجز ${esc(l.name)}" data-arr-in="${l.id}">
      <button class="pill white" data-act="arrears-inline" data-m="${view.month}" data-id="${l.id}">سداد</button>
    </div>`).join('');
  const projected = lines.filter((l) => l.arrStartP > 0);
  const projRows = projected.map((l) => `<div class="kv"><span class="k">${l.icon || ''} ${esc(l.name)}</span><span class="v num amber">${fmtKD(l.arrStartP)}</span></div>`).join('');
  const total = lines.reduce((a, l) => a + Math.max(0, l.arrStartC - l.paidArr), 0);
  return `<section class="card" aria-label="العجز">
    <div class="card-head"><h2 class="card-title">العجز</h2><span class="num" style="font-weight:700">${fmtKD(total)} د.ك</span></div>
    <div class="list">${confirmedRows}</div>
    ${projected.length ? `<div class="section-t">عجز متوقع (نقص سيولة متوقع — ليس عجزًا مؤكدًا)</div>${projRows}` : ''}
  </section>`;
}

/* ── الدخل ── */
function incomeCard(m) {
  const sal = m.income.salary;
  const extras = state.extras.filter((e) => e.month === view.month);
  const recs = (state.recurring || []).filter((r) => r.start <= view.month && (!r.end || view.month <= r.end));
  const own = E.rentFor(state, view.month);
  const inc = (kind, ic, name, x, sub, month = view.month) => `<div class="li">
      <div class="ic">${ic}</div>
      <div class="main row-tap" data-act="income" data-kind="${kind}" data-m="${month}"><div class="name">${name}</div><div class="sub">${sub}</div></div>
      <div class="amt row-tap" data-act="income" data-kind="${kind}" data-m="${month}"><div class="a num">${fmtKD(x.received ? x.receivedAmount : x.amount)}</div><div class="b">${x.received ? `<span class="green">مستلم</span>${x.receivedAmount !== x.amount ? ` (المخطط ${fmtKD(x.amount)})` : ''}` : 'متوقع — غير مستلم'}</div></div>
      <button class="chk" data-act="income-toggle" data-kind="${kind}" data-m="${month}" aria-label="تأكيد استلام ${name}">${checkSvg(x.received ? 'done' : 'none', 0, true)}</button>
    </div>`;
  const rentRows = m.income.rents.map((r) => inc('rent', '🏠', `بدل إيجار ${E.monthLabel(r.ofMonth)}`, r,
    `${r.received ? `وصل ${E.dateLabel(r.receivedDate)}` : `يصل ${E.dateLabel(r.date)}`}${r.ofMonth !== view.month ? '، مخصص لهذا الشهر' : ''}`, r.ofMonth)).join('');
  const movedOut = own.allocMonth !== view.month ? `<div class="note">بدل إيجار ${E.monthLabel(view.month)} مخصص لخطة ${E.monthLabel(own.allocMonth)}. <button class="pill" data-act="income" data-kind="rent" data-m="${view.month}">تعديل</button></div>` : '';
  const ex = extras.map((e) => `<div class="li row-tap" data-act="extra" data-id="${e.id}">
      <div class="ic">✨</div>
      <div class="main"><div class="name">${esc(e.name)}</div><div class="sub">${A.statusLabel(e.status)}${e.status === 'pending' ? ' — لا يدخل الخطة' : ''}</div></div>
      <div class="amt"><div class="a num ${e.status === 'pending' ? 'dim' : ''}">${fmtKD(e.amount)}</div></div>
    </div>`).join('');
  const rc = recs.map((r) => `<div class="li"><div class="ic">🔁</div><div class="main"><div class="name">زيادة شهرية معتمدة</div><div class="sub">من ${E.monthLabel(r.start)}${r.end ? ` حتى ${E.monthLabel(r.end)}` : ''}</div></div><div class="amt"><div class="a num">${fmtKD(r.amount)}</div></div></div>`).join('');
  return `<section class="card" aria-label="الدخل">
    <div class="card-head"><h2 class="card-title">الدخل</h2><button class="pill" data-act="extra-new">${ICON.plus} دخل إضافي</button></div>
    <div class="list">
      ${inc('salary', '💼', 'الراتب', sal, sal.received ? `استُلم ${E.dateLabel(sal.receivedDate)}` : `موعده ${E.dateLabel(sal.date)}`)}
      ${rentRows}${ex}${rc}
    </div>
    ${movedOut}
  </section>`;
}

/* ── السيولة وحالة التنفيذ ── */
function liquidityCard(m) {
  const due = m.plannedTotal + m.arrearsTotal;
  const paid = m.actualOut;
  const t = percentTenths(paid, due);
  const lines = m.lines.filter((l) => l.status !== 'na');
  const done = lines.filter((l) => l.status === 'done').length;
  const part = lines.filter((l) => l.status === 'partial').length;
  const unk = lines.filter((l) => l.status === 'unknown').length;
  let status;
  if (!lines.length) status = 'لا توجد التزامات';
  else if (done === lines.length) status = '<span class="green">منفذة بالكامل</span>';
  else if (m.past && unk) status = `<span class="amber">غير مكتملة التسجيل</span> — ${done} مكتملة، ${part} جزئية، ${unk} غير مسجلة`;
  else if (done || part) status = `جارٍ التنفيذ — ${done} من ${lines.length} مكتملة${part ? `، ${part} جزئية` : ''}`;
  else status = m.closed ? '<span class="red">مقفل دون سداد</span>' : 'لم تبدأ';
  const cash = state.settings.cash || {};
  const head = `<div class="big"><div><span class="val num">${fmtKD(paid)}</span><span class="of"> / <span class="num">${fmtKD(due)}</span> د.ك</span></div><div class="side num">${pct(t)}</div></div>
    <div class="bar orange"><i style="width:${t / 10}%"></i></div>
    <div class="bar-legend"><span>المدفوع المؤكد من المطلوب (المخطط + العجز)</span></div>
    <div class="divider"></div>`;
  if (m.past) {
    return `<section class="card" aria-label="السيولة">
      <div class="card-head"><h2 class="card-title">السيولة وحالة الخطة</h2></div>
      ${head}
      <div class="kv"><span class="k">الدخل المخطط</span><span class="v num">${fmtKD(m.income.planned)}</span></div>
      <div class="kv"><span class="k">المستلم المؤكد</span><span class="v num">${fmtKD(m.income.received)}</span></div>
      <div class="kv"><span class="k">الالتزامات المخططة</span><span class="v num">${fmtKD(m.plannedTotal)}</span></div>
      <div class="kv"><span class="k">المدفوع المؤكد</span><span class="v num">${fmtKD(paid)}</span></div>
      <div class="kv"><span class="k">حالة تنفيذ الخطة</span><span class="v">${status}</span></div>
      <div class="note">شهر ماضٍ: لا يُرحَّل منه أي فائض أو سيولة. السيولة الحالية تعتمد على الرصيد النقدي الذي تُدخله.</div>
    </section>`;
  }
  const isF = m.key === sim.F;
  return `<section class="card" aria-label="السيولة">
    <div class="card-head"><h2 class="card-title">السيولة وحالة الخطة</h2>${isF ? '<button class="pill" data-act="cash">الرصيد النقدي</button>' : ''}</div>
    ${head}
    <div class="kv"><span class="k">${isF ? `الرصيد النقدي المُدخل${cash.date ? ` (${E.dateLabel(cash.date)})` : ' (غير مُدخل)'}` : 'مرحّل من الشهر السابق (توقع)'}</span><span class="v num ${m.cashStart < 0 ? 'red' : ''}">${fmtKD(m.cashStart)}</span></div>
    <div class="kv"><span class="k">الدخل المتوقع لهذا الشهر</span><span class="v num">${fmtKD(m.income.cash)}</span></div>
    <div class="kv"><span class="k">منه مستلم مؤكد</span><span class="v num">${fmtKD(m.income.received)}</span></div>
    ${m.cashAdjust ? `<div class="kv"><span class="k">تدفقات مؤكدة أخرى (فيزا، دخل إضافي، دفعات لأشهر سابقة)</span><span class="v num">${fmtKD(m.cashAdjust, { sign: true })}</span></div>` : ''}
    <div class="kv"><span class="k">الالتزامات المخططة</span><span class="v num">${fmtKD(m.plannedTotal)}</span></div>
    ${m.arrearsTotal ? `<div class="kv"><span class="k">العجز المرحّل</span><span class="v num">${fmtKD(m.arrearsTotal)}</span></div>` : ''}
    <div class="kv"><span class="k">المدفوع المؤكد</span><span class="v num">${fmtKD(paid)}</span></div>
    <div class="kv total"><span class="k">السيولة المتبقية المتوقعة</span><span class="v num ${m.cashEnd < 0 ? 'red' : ''}">${fmtKD(m.cashEnd)}</span></div>
    <div class="kv"><span class="k">حالة تنفيذ الخطة</span><span class="v">${status}</span></div>
    ${m.fundingGap > 0 ? `<div class="alert">عجز مالي متوقع: السيولة لا تكفي لتغطية ${kd(m.fundingGap)} د.ك من التزامات هذا الشهر، ويُرحّل كعجز متوقع.</div>` : ''}
    <div class="note">كل ما ليس «مستلمًا مؤكدًا» هنا توقع. المصاريف الأساسية محجوزة كاملة حتى تُقفل الشهر.</div>
  </section>`;
}

/* ── ديون الأشخاص ── */
function lastPay(id) {
  const ps = E.confirmedPayments(state).filter((p) => p.itemId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return ps.length ? `<div class="sub">آخر دفعة ${kd(ps[0].amount)} في ${E.dateLabel(ps[0].date)}${ps.length > 1 ? ` (${ps.length} دفعات)` : ''}</div>` : '';
}
function personsCard() {
  const people = E.debtsOf(state).filter((d) => d.group === 'person').sort((a, b) => a.order - b.order);
  const rows = people.map((d) => {
    const st = E.debtStatus(state, d);
    let right;
    if (st.remaining === 0 && d.closedConfirmed) right = '<span class="green" style="font-weight:700">مغلق ✓</span>';
    else if (st.remaining === 0) right = `<button class="pill white" data-act="close-confirm" data-id="${d.id}">تأكيد الإغلاق</button>`;
    else right = `<button class="pill" data-act="debt-pay" data-id="${d.id}">سداد</button>`;
    return `<div class="li">
      <div class="ic">${d.icon || '👤'}</div>
      <div class="main row-tap" data-act="item" data-id="${d.id}"><div class="name">${esc(d.name)}</div><div class="sub">الأصلي ${kd(st.original)}، المسدد المؤكد ${kd(st.paid)}${st.pending ? `، بانتظار التأكيد ${kd(st.pending)}` : ''}</div>${lastPay(d.id)}${st.remaining > 0 && d.verified === false ? `<div class="warn">غير مسجل — بانتظار التحقق، خارج الجدولة. <button class="pill" style="font-size:12px;padding:3px 9px" data-act="verify" data-id="${d.id}">مستحق فعلًا؟</button></div>` : ''}</div>
      <div class="amt row-tap" data-act="item" data-id="${d.id}"><div class="a num">${fmtKD(st.remaining)}</div><div class="b">متبقٍ</div></div>
      ${right}
    </div>`;
  }).join('');
  const total = people.reduce((a, d) => a + E.debtStatus(state, d).remaining, 0);
  return `<section class="card" aria-label="ديون الأشخاص">
    <div class="card-head"><h2 class="card-title">ديون الأشخاص</h2><div class="end"><span class="num" style="font-weight:700">${fmtKD(total)}</span><button class="icon-btn sm" data-act="debt-new" data-group="person" aria-label="إضافة دين شخص">${ICON.plus}</button></div></div>
    <div class="list">${rows || '<div class="empty">لا توجد ديون أشخاص. أضف دينًا من زر +.</div>'}</div>
    <div class="note">لا شيء يُعتبر مسددًا تلقائيًا. سجّل الدفعات السابقة بتواريخها من «سداد»، وأكّد الإغلاق يدويًا.</div>
  </section>`;
}

/* ── الفيزا ── */
function visaCard(vs) {
  return `<section class="card" aria-label="الفيزا">
    <div class="card-head"><h2 class="card-title">الفيزا</h2><div class="end"><button class="pill" data-act="visa-buy">${ICON.plus} شراء</button><button class="pill" data-act="visa-pay">سداد</button></div></div>
    <div class="big"><div><span class="val num">${fmtKD(vs.available)}</span><span class="of"> / <span class="num">${fmtKD(vs.limit)}</span> متاح</span></div></div>
    <div class="bar"><i style="width:${percentTenths(Math.max(0, vs.available), vs.limit) / 10}%"></i></div>
    <div class="vgrid">
      <div><div class="l">المستخدم حاليًا</div><div class="v num">${fmtKD(vs.used)}</div></div>
      <div><div class="l">المستحق غير المسدد</div><div class="v num ${vs.dueUnpaid ? 'amber' : ''}">${fmtKD(vs.dueUnpaid)}</div></div>
      <div><div class="l">الكشف المثبت</div><div class="v num">${vs.last ? fmtKD(vs.last.amount) : '—'}</div><div class="s">${vs.last ? `كشف ${E.dateLabel(vs.last.cycleEnd)}، ثُبّت ${E.dateLabel(vs.last.confirmedAt.slice(0, 10))}` : 'لا يوجد كشف مثبت'}</div></div>
      <div><div class="l">مشتريات الدورة التالية</div><div class="v num">${fmtKD(vs.unbilled)}</div><div class="s">الدورة الحالية تنتهي ${E.dateLabel(vs.currentCycle)}</div></div>
      <div><div class="l">المبلغ المسدد</div><div class="v num">${fmtKD(vs.totalPaid)}</div></div>
      <div><div class="l">الحد الائتماني</div><div class="v num">${fmtKD(vs.limit)}</div></div>
    </div>
    ${vs.pending.map((p) => `<div class="banner" style="margin:14px 0 0"><div><div class="t">تثبيت كشف ${E.dateLabel(p.cycleEnd)}</div><div class="s">عمليات الدورة: ${kd(p.amount)} د.ك</div></div><button class="pill white" data-act="visa-confirm" data-c="${p.cycleEnd}">تثبيت</button></div>`).join('')}
    ${vs.drift.map((s) => `<div class="alert amber">عمليات كشف ${E.dateLabel(s.cycleEnd)} تغيّرت بعد تثبيته (المثبت ${kd(s.amount)}، الحالي ${kd(s.computed)}). <button class="pill" style="margin-top:6px" data-act="visa-confirm" data-c="${s.cycleEnd}">إعادة التثبيت</button></div>`).join('')}
    <div class="quick"><button class="pill" data-act="visa-history">العمليات والكشوف</button></div>
    <div class="note">الفيزا خارج إجمالي الديون. الدين هو المستخدم غير المسدد فقط، وليس الحد الائتماني.</div>
  </section>`;
}

/* ── ماذا لو؟ ── */
function whatIfCard() {
  const sc = view.sc;
  if (!sc.start) sc.start = E.addMonths(curBudgetMonth(), 0);
  if (!sc.month) sc.month = curBudgetMonth();
  return `<section class="card" aria-label="ماذا لو">
    <div class="card-head"><h2 class="card-title">ماذا لو؟</h2></div>
    <div class="seg" style="margin-top:10px">
      <button data-act="sc-type" data-v="once" class="${sc.type === 'once' ? 'on' : ''}">مبلغ لمرة واحدة</button>
      <button data-act="sc-type" data-v="monthly" class="${sc.type === 'monthly' ? 'on' : ''}">زيادة شهرية</button>
    </div>
    <div class="field"><label for="sc-amount">المبلغ (د.ك)</label><input id="sc-amount" class="input money" inputmode="decimal" placeholder="500.000" value="${esc(sc.amount)}" data-sc="amount"></div>
    ${sc.type === 'once'
    ? `<div class="field"><label>شهر وصول المبلغ</label><select class="input" data-sc="month">${monthOptions(sc.month)}</select></div>`
    : `<div class="row2"><div class="field"><label>شهر البدء</label><select class="input" data-sc="start">${monthOptions(sc.start)}</select></div>
         <div class="field"><label>شهر الانتهاء</label><select class="input" data-sc="end">${monthOptions(sc.end, { allowEmpty: true, emptyLabel: 'مستمرة' })}</select></div></div>`}
    <div id="wi-result"></div>
  </section>`;
}
function scValue() {
  const sc = view.sc;
  const amount = parseKD(sc.amount);
  return { type: sc.type, amount: Number.isNaN(amount) ? 0 : amount, month: sc.month, start: sc.start, end: sc.end || null };
}
function updateWhatIf() {
  const box = $('#wi-result');
  if (!box) return;
  const sc = scValue();
  if (!(sc.amount > 0)) { box.innerHTML = '<div class="note">أدخل مبلغًا لترى أثره على موعد الإغلاق. السيناريو لا يغيّر خطتك الفعلية.</div>'; return; }
  const r = E.runScenario(state, sc, today);
  let diff = '—'; let cls = '';
  if (r.diffMonths !== null) {
    const n = Math.abs(r.diffMonths);
    diff = r.diffMonths < 0 ? `أبكر بـ ${n} ${n === 1 ? 'شهر' : 'أشهر'}` : r.diffMonths > 0 ? `أبطأ بـ ${n} ${n === 1 ? 'شهر' : 'أشهر'}` : 'بدون تغيير في الشهر';
    cls = r.diffMonths < 0 ? 'green' : r.diffMonths > 0 ? 'red' : '';
  }
  const rows = r.rows.filter((x) => x.current || x.scenario).map((x) => `<div class="kv"><span class="k">${E.monthLabel(x.key)}</span><span class="v"><span class="num dim">${fmtKD(x.current)}</span> ← <span class="num">${fmtKD(x.scenario)}</span>${x.scenario !== x.current ? ` <span class="num ${x.scenario > x.current ? 'green' : 'amber'}" style="font-size:13px">(${fmtKD(x.scenario - x.current, { sign: true })})</span>` : ''}</span></div>`).join('');
  box.innerHTML = `
    <div class="divider"></div>
    <div class="stats">
      <div><div class="l">الإغلاق الحالي</div><div class="v">${r.currentEnd ? E.monthLabel(r.currentEnd) : 'غير محدد'}</div></div>
      <div><div class="l">بعد السيناريو</div><div class="v">${r.scenarioEnd ? E.monthLabel(r.scenarioEnd) : 'غير محدد'}</div></div>
      <div><div class="l">الفرق</div><div class="v ${cls}">${diff}</div></div>
    </div>
    ${r.estimate ? '<div class="alert amber">المقارنة تقديرية: السجل التاريخي غير مكتمل.</div>' : ''}
    ${r.loans.length ? `<div class="section-t">أثر السيناريو على القروض (شهر الإغلاق)</div>${r.loans.map((l) => `<div class="kv"><span class="k">${esc(l.name)}</span><span class="v"><span class="dim">${l.current ? E.monthLabel(l.current) : '—'}</span> ← <span class="${l.scenario && l.current && l.scenario < l.current ? 'green' : ''}">${l.scenario ? E.monthLabel(l.scenario) : '—'}</span></span></div>`).join('')}` : ''}
    <div class="section-t">سداد الديون المتوقع شهريًا (الحالي ← السيناريو)</div>
    ${rows}
    <div class="note">السيناريو افتراضي ولا يغيّر خطتك. المكافآت والزيادات غير المؤكدة لا تدخل الخطة إلا بالاعتماد.</div>
    <button class="btn" data-act="sc-adopt">اعتماد السيناريو في الخطة</button>`;
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
      if (commit((s) => A.addPayment(s, { itemId: id, month, amount, date: v(sh, 'date'), note: v(sh, 'note'), confirmed }, { today }), confirmed ? 'تم تأكيد الدفع' : 'سُجلت الدفعة بانتظار التأكيد')) closeSheet();
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
        if ((due || '') !== ((s.months[month]?.dueDates || {})[id] || '')) return A.setDueDate(s, month, id, due);
        return null;
      }, 'تم الحفظ');
      if (ok) closeSheet();
    });
    on(sh, '[data-a="reset-plan"]', () => { if (commit((s) => A.setPlan(s, month, id, null), 'تمت الإعادة')) closeSheet(); });
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
    ${field('منسوبة لخطة شهر', `<select class="input" name="month">${monthOptions(p.month)}</select>`)}
    ${field('ملاحظة', `<input class="input" name="note" value="${esc(p.note)}">`)}
    <button class="btn" data-a="save">حفظ</button>`, (sh) => {
    on(sh, '[data-a="save"]', () => {
      const amount = money(v(sh, 'amount'));
      if (commit((s) => A.updatePayment(s, pid, { amount, date: v(sh, 'date'), month: v(sh, 'month'), note: v(sh, 'note') }, { today }), 'تم التعديل')) (back ? back() : closeSheet());
    });
  });
}

function arrearsSheet(month, id) {
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
      if (commit((s) => A.addPayment(s, { itemId: id, month, kind: 'arrears', amount, date: v(sh, 'date') }, { today }), 'تم السداد من العجز')) closeSheet();
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
  const pays = state.payments.filter((p) => p.itemId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const adjs = state.adjustments.filter((a) => a.itemId === id);
  const hist = [
    ...pays.map((p) => ({ d: p.date, html: `<div class="li"><div class="main"><div class="name"><span class="num">${fmtKD(p.amount)}</span> د.ك</div><div class="sub">${p.kind === 'arrears' ? 'سداد من العجز' : 'دفعة'} — ${E.monthLabel(p.month)} — ${E.dateLabel(p.date)}${p.note ? ` — ${esc(p.note)}` : ''}</div></div><button class="pill" data-a="edit-pay" data-id="${p.id}">تعديل</button></div>` })),
    ...adjs.map((a) => ({ d: a.date, html: `<div class="li"><div class="main"><div class="name">تصحيح رصيد <span class="num">${fmtKD(a.delta, { sign: true })}</span></div><div class="sub">${E.dateLabel(a.date)} — ${esc(a.reason)} (<span class="num">${fmtKD(a.before)}</span> ← <span class="num">${fmtKD(a.after)}</span>)</div></div></div>` })),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).map((x) => x.html).join('');
  openSheet(`${head(`${d.icon || ''} ${esc(d.name)}`, d.group === 'person' ? 'دين شخصي' : 'قرض')}
    <div class="vgrid">
      <div><div class="l">الرصيد الأصلي</div><div class="v num">${fmtKD(st.original)}</div>${st.adj ? `<div class="s">شامل تصحيحات <span class="num">${fmtKD(st.adj, { sign: true })}</span></div>` : ''}</div>
      <div><div class="l">المسدد</div><div class="v num">${fmtKD(st.paid)}</div></div>
      <div><div class="l">المتبقي</div><div class="v num">${fmtKD(st.remaining)}</div></div>
      <div><div class="l">الحالة</div><div class="v">${st.remaining === 0 ? (d.closedConfirmed ? '<span class="green">مغلق</span>' : 'مسدد — بانتظار التأكيد') : 'قائم'}</div></div>
    </div>
    ${d.openingInferred ? '<div class="alert amber">الرصيد المرجعي مستنتج وليس رصيدًا بنكيًا مؤكدًا. عدّله من «البيانات» أو سجّل تصحيحًا.</div>' : ''}
    ${st.pending ? `<div class="note">دفعات مسجلة بانتظار التأكيد: ${kd(st.pending)} د.ك (غير مخصومة من الرصيد).</div>` : ''}
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
    ${st.remaining === 0 && !d.closedConfirmed ? '<button class="btn" data-a="close">تأكيد الإغلاق</button>' : ''}
    ${st.remaining === 0 && d.closedConfirmed ? '<button class="btn secondary" data-a="reopen">إلغاء تأكيد الإغلاق</button>' : ''}
    ${d.group === 'person' && st.remaining > 0 ? `<div class="toggle"><span>مستحق فعلًا (يدخل الجدولة وموعد الإغلاق)</span><button class="switch ${d.verified === false ? '' : 'on'}" data-name="verified" role="switch" aria-checked="${d.verified !== false}"></button></div>` : ''}

    ${st.remaining > 0 ? `<div class="section-t">سداد</div>
    <div class="row2">${field('المبلغ', moneyInput('pamount', ''))}${field('التاريخ', dateInput('pdate', today))}</div>
    ${field('منسوب لخطة شهر', `<select class="input" name="pmonth">${monthOptions(view.month)}</select>`)}
    <div class="quick"><button class="pill" data-a="fill-full">المبلغ كاملًا (<span class="num">${fmtKD(st.remaining)}</span>)</button></div>
    <button class="btn" data-a="pay">تسجيل السداد</button>` : ''}

    <div class="section-t">البيانات</div>
    ${field('الاسم', `<input class="input" name="name" value="${esc(d.name)}">`)}
    <div class="row2">${field('الرمز', `<input class="input" name="icon" value="${esc(d.icon || '')}">`)}${field('يبدأ من', `<select class="input" name="start">${monthOptions(d.start)}</select>`)}</div>
    <div class="row2">${field('الرصيد المرجعي', moneyInput('opening', d.opening))}${field('القسط الإلزامي الشهري', moneyInput('mandatory', d.mandatory))}</div>
    ${field('السداد الإضافي', `<select class="input" name="extra">${Object.entries(EXTRA_LABEL).map(([k, t]) => `<option value="${k}" ${d.extra === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
    <button class="btn secondary" data-a="save">حفظ البيانات</button>

    <div class="section-t">تصحيح الرصيد الحقيقي</div>
    <div class="row2">${field('الرصيد الصحيح الآن', moneyInput('newbal', ''))}${field('التاريخ', dateInput('adate', today))}</div>
    ${field('سبب التصحيح', '<input class="input" name="reason" placeholder="مثال: كشف البنك">')}
    <button class="btn secondary" data-a="adjust">تسجيل التصحيح</button>

    ${hist ? `<div class="section-t">تاريخ العمليات</div><div class="list">${hist}</div>` : ''}
    <button class="btn danger" data-a="del">حذف الدين</button>`, (sh) => {
    sh.querySelector('.switch[data-name="verified"]')?.addEventListener('change', (e) => { commit((s) => A.setVerified(s, id, e.target.classList.contains('on'))); debtSheet(id); });
    on(sh, '[data-a="fill-full"]', () => { sh.querySelector('[name="pamount"]').value = inputKD(st.remaining); });
    on(sh, '[data-a="pay"]', () => {
      const amount = money(v(sh, 'pamount'));
      if (commit((s) => A.addPayment(s, { itemId: id, month: v(sh, 'pmonth'), amount, date: v(sh, 'pdate') }, { today }), 'تم تسجيل السداد')) debtSheet(id);
    });
    on(sh, '[data-a="close"]', () => { if (commit((s) => A.confirmClose(s, id, true), 'تم تأكيد الإغلاق')) closeSheet(); });
    on(sh, '[data-a="reopen"]', () => { if (commit((s) => A.confirmClose(s, id, false))) debtSheet(id); });
    on(sh, '[data-a="edit-pay"]', (e, el) => editPaymentSheet(el.dataset.id, () => debtSheet(id)));
    on(sh, '[data-a="save"]', () => {
      const patch = { name: v(sh, 'name'), icon: v(sh, 'icon'), start: v(sh, 'start'), extra: v(sh, 'extra') };
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
    <button class="btn secondary" data-a="save">حفظ البيانات</button>
    <button class="btn danger" data-a="del">حذف المصروف</button>`, (sh) => {
    on(sh, '[data-a="sched"]', () => {
      const amount = money(v(sh, 'amount'));
      if (commit((s) => A.setExpenseFrom(s, id, v(sh, 'from'), amount), 'تم التطبيق')) closeSheet();
    });
    on(sh, '[data-a="save"]', () => {
      const patch = { name: v(sh, 'name'), icon: v(sh, 'icon'), carry: sw(sh, 'carry') };
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

function quickPaySheet() {
  const month = view.month;
  const lines = sim.byKey[month].lines.filter((l) => l.type === 'debt' || l.planned > 0);
  openSheet(`${head('تسجيل دفعة', E.monthLabel(month))}
    ${field('البند', `<select class="input" name="item">${lines.map((l) => `<option value="${l.id}">${esc(l.name)} — المتبقي من المخطط ${fmtKD(Math.max(0, l.planned - l.paidReg))}</option>`).join('')}</select>`)}
    <div class="row2">${field('المبلغ', moneyInput('amount', ''))}${field('التاريخ', dateInput('date', defaultDateFor(month)))}</div>
    <button class="btn" data-a="pay">تأكيد الدفع</button>`, (sh) => {
    const fill = () => { const l = lines.find((x) => x.id === v(sh, 'item')); if (l) sh.querySelector('[name="amount"]').value = inputKD(Math.max(0, l.planned - l.paidReg)) ; };
    sh.querySelector('[name="item"]').addEventListener('change', fill); fill();
    on(sh, '[data-a="pay"]', () => {
      const amount = money(v(sh, 'amount'));
      if (commit((s) => A.addPayment(s, { itemId: v(sh, 'item'), month, amount, date: v(sh, 'date') }, { today }), 'تم تأكيد الدفع')) closeSheet();
    });
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
    on(sh, '[data-a="pay"]', quickPaySheet);
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
      if (commit((s) => (p ? A.updateVisaPurchase(s, p.id, data) : A.addVisaPurchase(s, data)), 'تم الحفظ')) closeSheet();
    });
    on(sh, '[data-a="del"]', () => { if (confirm('حذف عملية الشراء؟') && commit((s) => A.deleteVisaPurchase(s, p.id), 'تم الحذف')) closeSheet(); });
  });
}

function visaPaySheet() {
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
      if (commit((s) => A.addVisaPayment(s, { amount, date: v(sh, 'date'), cashMonth: v(sh, 'cm') || null }, today), 'تم تسجيل السداد')) closeSheet();
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
    case 'settings': settingsSheet(); break;
    case 'add': addMenu(); break;
    case 'log': logSheet(); break;
    case 'prev': setMonth(E.addMonths(view.month, -1)); break;
    case 'next': setMonth(E.addMonths(view.month, 1)); break;
    case 'month': setMonth(d.m); break;
    case 'quick-pay': quickPaySheet(); break;
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
      commit((s) => A.addPayment(s, { itemId: d.id, month: d.m, kind: 'arrears', amount, date: today }, { today }), 'تم السداد من العجز');
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
    case 'sc-type': view.sc.type = d.v; render(); break;
    case 'sc-adopt': {
      const sc = scValue();
      const desc = sc.type === 'once' ? `مبلغ ${fmtKD(sc.amount)} د.ك في ${E.monthLabel(sc.month)}` : `زيادة ${fmtKD(sc.amount)} د.ك شهريًا من ${E.monthLabel(sc.start)}${sc.end ? ` حتى ${E.monthLabel(sc.end)}` : ''}`;
      if (!confirm(`اعتماد السيناريو في خطتك الفعلية؟\n${desc}\nسيُحتسب كدخل معتمد في الخطة.`)) break;
      if (commit((s) => A.adoptScenario(s, sc), 'تم اعتماد السيناريو')) { view.sc.amount = ''; render(); }
      break;
    }
    default: break;
  }
});

let wiTimer = null;
document.addEventListener('input', (e) => {
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
  let s = await loadState();
  if (!s || !s.schema) {
    s = E.createSeedState();
    await saveState(s);
  }
  // ترحيل آمن للبيانات المحفوظة — لا يحذف شيئًا
  const mig = E.migrate(s);
  s = mig.state;
  if (mig.changed) await saveState(s);
  state = s;
  const saved = lsGet('mfp-view-month');
  view.month = saved && /^\d{4}-\d{2}$/.test(saved) ? saved : today.slice(0, 7);
  if (view.month < state.settings.planStart) view.month = state.settings.planStart;
  render();
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();

// للاختبارات
window.__mfp = { get state() { return state; }, E, A };
