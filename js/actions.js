// عمليات تعديل الحالة مع التحقق. كل دالة ترجع null عند النجاح أو رسالة خطأ.
import {
  simulate, uid, itemById, debtStatus, visaSummary, kuwaitToday, monthLabel, dateLabel,
  visaCycleEnd, monthOfDate, DEFAULT_PRIORITY,
} from './engine.js';
import { fmtKD } from './money.js';

const nowIso = () => new Date().toISOString();
function log(state, text) { state.log.push({ ts: nowIso(), text }); }
const okAmount = (a) => Number.isSafeInteger(a) && a > 0;
const okDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const okMonth = (m) => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m);

/* ── الدفعات ── */

/**
 * تسجيل دفعة. month = الشهر المالي المنسوبة إليه الدفعة، date = تاريخ التنفيذ الفعلي (مستقلان).
 * confirmed=false: دفعة مسجلة لم يتأكد سدادها بعد — لا تدخل في الأرصدة أو العجز حتى تأكيدها.
 */
export function addPayment(state, { itemId, month, kind = 'regular', amount, date, note = '', confirmed = true }, opts = {}) {
  const item = itemById(state, itemId);
  if (!item) return 'البند غير موجود';
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (kind !== 'regular' && kind !== 'arrears') return 'نوع الدفعة غير صالح';
  if (item.type === 'debt') {
    const st = debtStatus(state, item);
    const free = st.remaining - st.pending; // نحتسب الدفعات المسجلة غير المؤكدة لمنع تجاوز الرصيد
    if (amount > free) return `المبلغ يتجاوز الرصيد المتبقي (${fmtKD(Math.max(0, free))} د.ك)`;
    if (item.extra === 'closeOnly' && kind === 'regular') {
      const sim = simulate(state, { today: opts.today, until: month });
      const l = sim.byKey[month]?.lines.find((x) => x.id === itemId);
      const planLeft = l ? Math.max(0, l.planned - l.paidReg - l.pendingReg) : 0;
      if (amount > planLeft && amount !== free) {
        return `${item.name}: لا يُسمح بسداد إضافي جزئي. ادفع القسط المخطط (${fmtKD(planLeft)}) أو أغلق الرصيد كاملًا (${fmtKD(free)}).`;
      }
    }
  }
  if (item.type === 'expense' && kind === 'regular') {
    const sim = simulate(state, { today: opts.today, until: month });
    const l = sim.byKey[month]?.lines.find((x) => x.id === itemId);
    const planLeft = l ? Math.max(0, l.planned - l.paidReg - l.pendingReg) : 0;
    if (amount > planLeft && !note.trim()) return `المبلغ أكبر من المتبقي من المخطط (${fmtKD(planLeft)} د.ك). اكتب سبب الزيادة في الملاحظة.`;
  }
  if (kind === 'arrears') {
    const sim = simulate(state, { today: opts.today, until: month });
    const line = sim.byKey[month]?.lines.find((l) => l.id === itemId);
    const pendArr = state.payments.filter((x) => x.confirmed === false && x.kind === 'arrears' && x.itemId === itemId && x.month === month).reduce((a, x) => a + x.amount, 0);
    const rem = Math.max(0, (line ? line.arrRemaining : 0) - pendArr);
    if (amount > rem) return `المبلغ أكبر من العجز المتبقي (${fmtKD(rem)} د.ك)`;
  }
  const p = { id: uid('pay'), itemId, month, kind, amount, date, note, confirmed: !!confirmed, createdAt: nowIso() };
  state.payments.push(p);
  log(state, `${kind === 'arrears' ? 'سداد من العجز' : 'دفعة'}${confirmed ? '' : ' (مسجلة — بانتظار التأكيد)'} — ${item.name} — خطة ${monthLabel(month)}: ${fmtKD(amount)} د.ك بتاريخ ${dateLabel(date)}`);
  return null;
}

export function updatePayment(state, id, patch, opts = {}) {
  const p = state.payments.find((x) => x.id === id);
  if (!p) return 'الدفعة غير موجودة';
  const before = { ...p };
  const idx = state.payments.indexOf(p);
  state.payments.splice(idx, 1);
  const next = { ...before, ...patch };
  const err = addPayment(state, next, opts);
  if (err) { state.payments.splice(idx, 0, before); return err; }
  // أعِد المعرّف الأصلي ووقت الإنشاء للحفاظ على التاريخ
  const added = state.payments[state.payments.length - 1];
  added.id = before.id; added.createdAt = before.createdAt; added.editedAt = nowIso();
  state.log.pop();
  const item = itemById(state, p.itemId);
  log(state, `تعديل دفعة — ${item?.name}: ${fmtKD(before.amount)} ← ${fmtKD(added.amount)} د.ك (${monthLabel(added.month)})`);
  return null;
}

export function confirmPayment(state, id, date) {
  const p = state.payments.find((x) => x.id === id);
  if (!p) return 'الدفعة غير موجودة';
  if (p.confirmed !== false) return 'الدفعة مؤكدة مسبقًا';
  p.confirmed = true;
  if (date) p.date = date;
  p.confirmedAt = nowIso();
  log(state, `تأكيد سداد — ${itemById(state, p.itemId)?.name}: ${fmtKD(p.amount)} د.ك (خطة ${monthLabel(p.month)})`);
  return null;
}

export function deletePayment(state, id) {
  const i = state.payments.findIndex((x) => x.id === id);
  if (i < 0) return 'الدفعة غير موجودة';
  const [p] = state.payments.splice(i, 1);
  log(state, `حذف دفعة — ${itemById(state, p.itemId)?.name}: ${fmtKD(p.amount)} د.ك (${monthLabel(p.month)})`);
  return null;
}

/** إزالة علامة الصح: حذف دفعات الشهر الأساسية لهذا البند */
export function clearRegular(state, itemId, month) {
  const removed = state.payments.filter((p) => p.itemId === itemId && p.month === month && p.kind === 'regular');
  if (!removed.length) return 'لا توجد دفعات مؤكدة';
  state.payments = state.payments.filter((p) => !removed.includes(p));
  log(state, `إزالة التأكيد — ${itemById(state, itemId)?.name} — ${monthLabel(month)} (${fmtKD(removed.reduce((a, p) => a + p.amount, 0))} د.ك)`);
  return null;
}

/* ── الخطة ── */

function monthData(state, month) {
  if (!state.months[month]) state.months[month] = { plan: {} };
  if (!state.months[month].plan) state.months[month].plan = {};
  return state.months[month];
}

export function setPlan(state, month, itemId, amount) {
  const item = itemById(state, itemId);
  if (!item) return 'البند غير موجود';
  const md = monthData(state, month);
  if (amount === null) {
    delete md.plan[itemId];
    log(state, `إرجاع المخطط للقيمة التلقائية — ${item.name} — ${monthLabel(month)}`);
    return null;
  }
  if (!Number.isSafeInteger(amount) || amount < 0) return 'المبلغ غير صالح';
  const old = md.plan[itemId];
  md.plan[itemId] = amount;
  log(state, `تعديل المخطط — ${item.name} — ${monthLabel(month)}: ${old === undefined ? 'تلقائي' : fmtKD(old)} ← ${fmtKD(amount)} د.ك`);
  return null;
}

export function setDueDate(state, month, itemId, date) {
  const md = monthData(state, month);
  md.dueDates = md.dueDates || {};
  if (!date) delete md.dueDates[itemId];
  else if (!okDate(date)) return 'التاريخ غير صالح';
  else md.dueDates[itemId] = date;
  log(state, `تاريخ استحقاق — ${itemById(state, itemId)?.name} — ${monthLabel(month)}: ${date ? dateLabel(date) : 'بدون'}`);
  return null;
}

/** الدخل: kind = salary | rent. patch: {amount, date, received, receivedDate} */
export function setIncome(state, month, kind, patch) {
  if (kind !== 'salary' && kind !== 'rent') return 'نوع الدخل غير صالح';
  if (patch.amount !== undefined && (!Number.isSafeInteger(patch.amount) || patch.amount < 0)) return 'المبلغ غير صالح';
  if (patch.date !== undefined && patch.date !== null && !okDate(patch.date)) return 'التاريخ غير صالح';
  if (patch.receivedAmount !== undefined && patch.receivedAmount !== null && (!Number.isSafeInteger(patch.receivedAmount) || patch.receivedAmount < 0)) return 'المبلغ المستلم غير صالح';
  if (patch.receivedDate && !okDate(patch.receivedDate)) return 'تاريخ الاستلام غير صالح';
  if (patch.allocMonth !== undefined) {
    if (kind !== 'rent') return 'التخصيص متاح لبدل الإيجار فقط';
    if (patch.allocMonth !== null && !okMonth(patch.allocMonth)) return 'شهر التخصيص غير صالح';
  }
  const md = monthData(state, month);
  md[kind] = { ...(md[kind] || {}), ...patch };
  if (patch.received === false) { md[kind].receivedDate = null; md[kind].receivedAmount = null; }
  if (patch.allocMonth === null || patch.allocMonth === month) delete md[kind].allocMonth;
  const label = kind === 'salary' ? 'الراتب' : 'بدل الإيجار';
  const parts = [];
  if (patch.amount !== undefined) parts.push(`المبلغ ${fmtKD(patch.amount)}`);
  if (patch.date) parts.push(`الموعد ${dateLabel(patch.date)}`);
  if (patch.received === true) parts.push(`تأكيد الاستلام ${patch.receivedAmount !== undefined && patch.receivedAmount !== null ? `${fmtKD(patch.receivedAmount)} ` : ''}${dateLabel(patch.receivedDate)}`);
  if (patch.allocMonth) parts.push(`مخصص لخطة ${monthLabel(patch.allocMonth)}`);
  if (patch.received === false) parts.push('إلغاء تأكيد الاستلام');
  log(state, `${label} — ${monthLabel(month)}: ${parts.join('، ')}`);
  return null;
}

/* ── الدخل الإضافي ── */

export function addExtra(state, { month, name, amount, status = 'received', date }) {
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  if (!['pending', 'adopted', 'received'].includes(status)) return 'الحالة غير صالحة';
  const e = { id: uid('ext'), month, name: name || 'دخل إضافي', amount, status, date: date || null, createdAt: nowIso() };
  state.extras.push(e);
  log(state, `دخل إضافي — ${e.name} — ${monthLabel(month)}: ${fmtKD(amount)} د.ك (${statusLabel(status)})`);
  return null;
}
export const statusLabel = (s) => ({ pending: 'غير مؤكد', adopted: 'معتمد بالخطة', received: 'مستلم' }[s]);
export function updateExtra(state, id, patch) {
  const e = state.extras.find((x) => x.id === id);
  if (!e) return 'غير موجود';
  if (patch.amount !== undefined && !okAmount(patch.amount)) return 'أدخل مبلغًا أكبر من صفر';
  Object.assign(e, patch);
  log(state, `تعديل دخل إضافي — ${e.name}: ${fmtKD(e.amount)} د.ك (${statusLabel(e.status)})`);
  return null;
}
export function deleteExtra(state, id) {
  const i = state.extras.findIndex((x) => x.id === id);
  if (i < 0) return 'غير موجود';
  const [e] = state.extras.splice(i, 1);
  log(state, `حذف دخل إضافي — ${e.name}: ${fmtKD(e.amount)} د.ك`);
  return null;
}

/* ── البنود ── */

export function addItem(state, data) {
  const name = (data.name || '').trim();
  if (!name) return 'أدخل الاسم';
  const order = Math.max(0, ...state.items.map((i) => i.order)) + 1;
  if (data.type === 'debt') {
    if (!okAmount(data.opening)) return 'أدخل الرصيد الأصلي';
    const it = {
      id: uid('d'), type: 'debt', group: data.group || 'loan', name, icon: data.icon || (data.group === 'person' ? '👤' : '🏦'),
      opening: data.opening, mandatory: data.mandatory || 0, extra: data.extra || 'allow',
      start: data.start || state.settings.planStart, order, closedConfirmed: false, createdAt: nowIso(),
      ...(data.group === 'person' ? { verified: data.verified !== false } : {}),
    };
    state.items.push(it);
    if (it.extra === 'allow') state.settings.payoffPriority = [...(state.settings.payoffPriority || []), it.id];
    log(state, `إضافة دين — ${name}: ${fmtKD(it.opening)} د.ك`);
    return null;
  }
  if (!Number.isSafeInteger(data.amount) || data.amount < 0) return 'أدخل المبلغ الشهري';
  const it = {
    id: uid('e'), type: 'expense', name, icon: data.icon || '🧾', carry: !!data.carry,
    schedule: [{ from: data.start || state.settings.planStart, amount: data.amount }],
    once: data.once || undefined, endMonth: data.endMonth || undefined, order, createdAt: nowIso(),
  };
  state.items.push(it);
  log(state, `إضافة مصروف — ${name}: ${fmtKD(data.amount)} د.ك`);
  return null;
}

export function updateItem(state, id, patch) {
  const it = itemById(state, id);
  if (!it) return 'البند غير موجود';
  if (patch.name !== undefined && !patch.name.trim()) return 'أدخل الاسم';
  if (patch.opening !== undefined && !okAmount(patch.opening)) return 'الرصيد غير صالح';
  if (patch.mandatory !== undefined && (!Number.isSafeInteger(patch.mandatory) || patch.mandatory < 0)) return 'القسط غير صالح';
  if (patch.opening !== undefined && it.type === 'debt') {
    const paid = state.payments.filter((p) => p.itemId === id).reduce((a, p) => a + p.amount, 0);
    const adj = state.adjustments.filter((a) => a.itemId === id).reduce((a, x) => a + x.delta, 0);
    if (patch.opening + adj < paid) return 'الرصيد الأصلي أقل من المسدد فعليًا';
  }
  const changes = Object.keys(patch).join('، ');
  Object.assign(it, patch);
  if (it.type === 'debt' && it.extra === 'allow') {
    const pr = state.settings.payoffPriority || (state.settings.payoffPriority = []);
    if (!pr.includes(it.id)) pr.push(it.id);
  }
  if (patch.opening !== undefined) it.openingInferred = false;
  log(state, `تعديل بند — ${it.name} (${changes})`);
  return null;
}

/** تعديل مبلغ مصروف من شهر معيّن فصاعدًا */
export function setExpenseFrom(state, id, from, amount) {
  const it = itemById(state, id);
  if (!it || it.type !== 'expense') return 'البند غير موجود';
  if (!Number.isSafeInteger(amount) || amount < 0) return 'المبلغ غير صالح';
  it.schedule = (it.schedule || []).filter((s) => s.from !== from);
  it.schedule.push({ from, amount });
  log(state, `تعديل ${it.name} ابتداءً من ${monthLabel(from)}: ${fmtKD(amount)} د.ك`);
  return null;
}

export function deleteItem(state, id) {
  const it = itemById(state, id);
  if (!it) return 'البند غير موجود';
  state.items = state.items.filter((i) => i.id !== id);
  if (state.settings.payoffPriority) state.settings.payoffPriority = state.settings.payoffPriority.filter((x) => x !== id);
  const n = state.payments.filter((p) => p.itemId === id).length;
  state.payments = state.payments.filter((p) => p.itemId !== id);
  state.adjustments = state.adjustments.filter((a) => a.itemId !== id);
  for (const md of Object.values(state.months)) { if (md.plan) delete md.plan[id]; if (md.dueDates) delete md.dueDates[id]; }
  log(state, `حذف ${it.type === 'debt' ? 'دين' : 'مصروف'} — ${it.name} (مع ${n} دفعة)`);
  return null;
}

/** تصحيح الرصيد الحقيقي: يُسجَّل الفرق مع السبب */
export function addAdjustment(state, itemId, newBalance, reason, date = kuwaitToday()) {
  const it = itemById(state, itemId);
  if (!it || it.type !== 'debt') return 'الدين غير موجود';
  if (!Number.isSafeInteger(newBalance) || newBalance < 0) return 'الرصيد غير صالح';
  if (!reason || !reason.trim()) return 'اكتب سبب التصحيح';
  const st = debtStatus(state, it);
  const delta = newBalance - st.remaining;
  if (delta === 0) return 'الرصيد مطابق — لا يوجد تصحيح';
  state.adjustments.push({ id: uid('adj'), itemId, delta, reason: reason.trim(), date, before: st.remaining, after: newBalance, createdAt: nowIso() });
  log(state, `تصحيح رصيد — ${it.name}: ${fmtKD(st.remaining)} ← ${fmtKD(newBalance)} د.ك. السبب: ${reason.trim()}`);
  return null;
}

export function confirmClose(state, itemId, value = true) {
  const it = itemById(state, itemId);
  if (!it) return 'غير موجود';
  if (value && debtStatus(state, it).remaining > 0) return 'لا يمكن الإغلاق — يوجد رصيد متبقٍ';
  it.closedConfirmed = value;
  log(state, `${value ? 'تأكيد إغلاق' : 'إلغاء إغلاق'} — ${it.name}`);
  return null;
}

/* ── الفيزا ── */

export function addVisaPurchase(state, { date, amount, note = '' }) {
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  const vs = visaSummary(state);
  if (amount > vs.available) return `المبلغ يتجاوز الحد المتاح (${fmtKD(Math.max(0, vs.available))} د.ك)`;
  const p = { id: uid('vp'), date, amount, note, createdAt: nowIso() };
  state.visa.purchases.push(p);
  log(state, `فيزا — شراء ${fmtKD(amount)} د.ك بتاريخ ${dateLabel(date)} (كشف ${dateLabel(visaCycleEnd(date, state.settings.visaStatementDay))})${note ? ` — ${note}` : ''}`);
  return null;
}
export function updateVisaPurchase(state, id, patch) {
  const p = state.visa.purchases.find((x) => x.id === id);
  if (!p) return 'غير موجود';
  if (patch.date !== undefined && !okDate(patch.date)) return 'التاريخ غير صالح';
  if (patch.amount !== undefined && !okAmount(patch.amount)) return 'أدخل مبلغًا أكبر من صفر';
  if (patch.amount !== undefined) {
    const vs = visaSummary(state);
    if (patch.amount - p.amount > vs.available) return `التعديل يتجاوز الحد المتاح (${fmtKD(Math.max(0, vs.available))} د.ك)`;
  }
  const before = `${fmtKD(p.amount)} / ${p.date}`;
  Object.assign(p, patch, { editedAt: nowIso() });
  log(state, `فيزا — تعديل شراء: ${before} ← ${fmtKD(p.amount)} / ${p.date}`);
  return null;
}
export function deleteVisaPurchase(state, id) {
  const i = state.visa.purchases.findIndex((x) => x.id === id);
  if (i < 0) return 'غير موجود';
  const [p] = state.visa.purchases.splice(i, 1);
  log(state, `فيزا — حذف شراء ${fmtKD(p.amount)} د.ك (${dateLabel(p.date)})`);
  return null;
}
export function addVisaPayment(state, { date, amount, note = '', cashMonth }, today) {
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  const vs = visaSummary(state, today);
  if (amount > vs.used) return `المبلغ أكبر من المستخدم غير المسدد (${fmtKD(vs.used)} د.ك)`;
  // يُخصم من سيولة شهر واحد فقط (أو لا يُخصم) — لا خصم مزدوج
  const cm = cashMonth === undefined ? monthOfDate(date) : cashMonth;
  state.visa.payments.push({ id: uid('vy'), date, amount, note, cashMonth: cm || null, createdAt: nowIso() });
  log(state, `فيزا — سداد ${fmtKD(amount)} د.ك بتاريخ ${dateLabel(date)}${cm ? ` (من سيولة ${monthLabel(cm)})` : ''}`);
  return null;
}
export function deleteVisaPayment(state, id) {
  const i = state.visa.payments.findIndex((x) => x.id === id);
  if (i < 0) return 'غير موجود';
  const [p] = state.visa.payments.splice(i, 1);
  log(state, `فيزا — حذف سداد ${fmtKD(p.amount)} د.ك (${dateLabel(p.date)})`);
  return null;
}
/** تثبيت كشف دورة معيّنة (أو إعادة تثبيته بعد تعديل عملياتها) */
export function confirmStatement(state, cycleEnd, today = kuwaitToday()) {
  if (cycleEnd > today) return 'لم يحن موعد تثبيت هذا الكشف بعد';
  const sd = state.settings.visaStatementDay;
  const amount = state.visa.purchases.filter((p) => visaCycleEnd(p.date, sd) === cycleEnd).reduce((a, p) => a + p.amount, 0);
  const existing = state.visa.statements.find((s) => s.cycleEnd === cycleEnd);
  if (existing) {
    const old = existing.amount;
    existing.history = [...(existing.history || []), { amount: old, confirmedAt: existing.confirmedAt }];
    existing.amount = amount; existing.confirmedAt = nowIso();
    log(state, `فيزا — إعادة تثبيت كشف ${dateLabel(cycleEnd)}: ${fmtKD(old)} ← ${fmtKD(amount)} د.ك`);
  } else {
    state.visa.statements.push({ id: uid('vs'), cycleEnd, amount, confirmedAt: nowIso() });
    log(state, `فيزا — تثبيت كشف ${dateLabel(cycleEnd)}: ${fmtKD(amount)} د.ك`);
  }
  return null;
}

/* ── السيناريو ── */

export function adoptScenario(state, sc) {
  if (!okAmount(sc.amount)) return 'أدخل مبلغًا';
  if (sc.type === 'once') {
    return addExtra(state, { month: sc.month, name: 'مبلغ إضافي (سيناريو معتمد)', amount: sc.amount, status: 'adopted' });
  }
  if (!okMonth(sc.start)) return 'اختر شهر البدء';
  const end = sc.end || null;
  if (end && end < sc.start) return 'شهر الانتهاء قبل البدء';
  const s = state.recurring || (state.recurring = []);
  s.push({ id: uid('rec'), amount: sc.amount, start: sc.start, end, createdAt: nowIso() });
  log(state, `اعتماد زيادة شهرية ${fmtKD(sc.amount)} د.ك من ${monthLabel(sc.start)}${end ? ` حتى ${monthLabel(end)}` : ''}`);
  return null;
}

export function deleteRecurring(state, id) {
  const list = state.recurring || [];
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return 'غير موجود';
  const [r] = list.splice(i, 1);
  log(state, `حذف زيادة شهرية ${fmtKD(r.amount)} د.ك من ${monthLabel(r.start)}`);
  return null;
}

/* ── أولويات السداد وإقفال الأشهر ── */

export function setPayoffPriority(state, ids) {
  const debts = new Set(state.items.filter((i) => i.type === 'debt').map((i) => i.id));
  if (!Array.isArray(ids) || ids.some((id) => !debts.has(id)) || new Set(ids).size !== ids.length) return 'ترتيب غير صالح';
  state.settings.payoffPriority = [...ids];
  log(state, `تعديل أولويات السداد: ${ids.map((id) => itemById(state, id)?.name).join(' ← ')}`);
  return null;
}
export function resetPayoffPriority(state) {
  const ids = new Set(state.items.map((i) => i.id));
  const rest = (state.settings.payoffPriority || []).filter((id) => ids.has(id) && !DEFAULT_PRIORITY.includes(id));
  return setPayoffPriority(state, [...DEFAULT_PRIORITY.filter((id) => ids.has(id)), ...rest]);
}

/** إقفال الشهر يدويًا أو إعادة فتحه. عند الإقفال يصبح غير المسدد من خطة الشهر عجزًا مؤكدًا. */
export function closeMonth(state, month, closed = true, date = kuwaitToday()) {
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (!state.months[month]) state.months[month] = { plan: {} };
  const md = state.months[month];
  if (closed) { md.closed = true; md.closedAt = date; } else { md.closed = false; delete md.closedAt; }
  log(state, `${closed ? 'إقفال' : 'إعادة فتح'} ${monthLabel(month)}`);
  return null;
}

/** الرصيد النقدي المتاح فعليًا (دون المبالغ المحجوزة) بتاريخ محدد. افتراضيًا صفر. */
export function setCash(state, { amount, date, note = '' }, today = kuwaitToday()) {
  if (!Number.isSafeInteger(amount) || amount < 0) return 'أدخل رصيدًا صالحًا (صفر أو أكثر)';
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (date > today) return 'تاريخ الرصيد لا يمكن أن يكون في المستقبل';
  const old = state.settings.cash || {};
  state.settings.cash = { amount, date, note };
  log(state, `الرصيد النقدي المتاح: ${old.date ? `${fmtKD(old.amount)} (${dateLabel(old.date)})` : 'غير مُدخل'} ← ${fmtKD(amount)} د.ك بتاريخ ${dateLabel(date)}${note ? ` — ${note}` : ''}`);
  return null;
}

/** تأكيد حجز احتياطي (date) أو إلغاؤه (null) */
export function holdReserve(state, id, date) {
  const r = (state.reserves || []).find((x) => x.id === id);
  if (!r) return 'الاحتياطي غير موجود';
  if (date !== null && !okDate(date)) return 'التاريخ غير صالح';
  r.heldDate = date;
  log(state, `${r.name}: ${date ? `تأكيد حجز ${fmtKD(r.amount)} د.ك بتاريخ ${dateLabel(date)}` : 'إلغاء تأكيد الحجز'}`);
  return null;
}
export function updateReserve(state, id, patch) {
  const r = (state.reserves || []).find((x) => x.id === id);
  if (!r) return 'الاحتياطي غير موجود';
  if (patch.amount !== undefined && (!Number.isSafeInteger(patch.amount) || patch.amount < 0)) return 'المبلغ غير صالح';
  if (patch.month !== undefined && !okMonth(patch.month)) return 'الشهر غير صالح';
  if (patch.targetMonth !== undefined && !okMonth(patch.targetMonth)) return 'الشهر غير صالح';
  const next = { ...r, ...patch };
  if (next.targetMonth < next.month) return 'شهر الاستخدام قبل شهر الحجز';
  Object.assign(r, patch);
  log(state, `تعديل ${r.name}: ${fmtKD(r.amount)} د.ك، حجز ${monthLabel(r.month)}، استخدام ${monthLabel(r.targetMonth)}`);
  return null;
}

/** دين شخص: تأكيد أنه مستحق فعلًا (يدخل الجدولة) أو إبقاؤه بانتظار التحقق */
export function setVerified(state, id, value) {
  const d = itemById(state, id);
  if (!d || d.type !== 'debt') return 'الدين غير موجود';
  d.verified = !!value;
  log(state, `${d.name}: ${value ? 'مستحق فعلًا — يدخل الجدولة' : 'بانتظار التحقق — خارج الجدولة'}`);
  return null;
}
