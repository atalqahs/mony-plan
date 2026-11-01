// عمليات تعديل الحالة مع التحقق. كل دالة ترجع null عند النجاح أو رسالة خطأ.
import {
  simulate, uid, itemById, debtStatus, visaSummary, kuwaitToday, monthLabel, dateLabel,
  visaCycleEnd, monthOfDate, DEFAULT_PRIORITY, forecastStartOf, addMonths, addDays, dateIn, daysInMonth,
} from './engine.js';
import { fmtKD } from './money.js';

const nowIso = () => new Date().toISOString();
function log(state, text) { state.log.push({ ts: nowIso(), text }); }
const okAmount = (a) => Number.isSafeInteger(a) && a > 0;
/** تاريخ حقيقي في التقويم (يرفض 2026-02-30 و2026-13-01)، وليس شكلًا نصيًا فقط */
export const okDate = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};
const okMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const FUTURE = 'تاريخ عملية مؤكدة لا يمكن أن يكون في المستقبل — سجّلها غير مؤكدة أو صحّح التاريخ';

/* ── المعاملات الذرّية ── */

/**
 * ينفّذ fn على نسخة عميقة من الحالة. إن رجعت fn برسالة خطأ أو رمت استثناءً لا يتغير شيء في state.
 * إن نجحت تُستبدل محتويات state بالنسخة المعدلة دفعة واحدة. يرجع null أو رسالة الخطأ.
 */
export function transact(state, fn) {
  const draft = JSON.parse(JSON.stringify(state));
  let err;
  try { err = fn(draft); } catch (e) { err = `خطأ غير متوقع — لم يُحفظ شيء (${e && e.message ? e.message : e})`; }
  if (err) return err;
  for (const k of Object.keys(state)) if (!(k in draft)) delete state[k];
  Object.assign(state, draft);
  return null;
}

/* ── الدفعات ── */

/**
 * تسجيل دفعة. month = الشهر المالي المنسوبة إليه الدفعة، date = تاريخ التنفيذ الفعلي (مستقلان).
 * confirmed=false: دفعة مسجلة لم يتأكد سدادها بعد — لا تدخل في الأرصدة أو العجز حتى تأكيدها.
 */
export const DUPLICATE = 'DUPLICATE';
export const ALREADY_SAVED = 'تم حفظ هذه العملية مسبقًا — لم تُسجل مرة ثانية';
/**
 * date=null مسموح فقط لدفعة تاريخية مؤكدة (شهرها قبل الشهر الحالي) مع dateUnknown=true:
 * تُسجل دون اختراع تاريخ تنفيذ، ولا أثر نقدي لها (مُضمَّنة في الماضي).
 * opId: معرّف العملية من نافذة الإدخال — يمنع الحفظ المزدوج بالضغط المتكرر.
 * allowDuplicate: لا تُقبل دفعة مطابقة تمامًا لدفعة موجودة إلا إذا أكد المستخدم أنها عملية مستقلة.
 */
export function addPayment(state, { itemId, month, kind = 'regular', amount, date, note = '', confirmed = true, dateUnknown = false, opId = null, allowDuplicate = false }, opts = {}) {
  const item = itemById(state, itemId);
  if (!item) return 'البند غير موجود';
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  const today = opts.today || kuwaitToday();
  if (dateUnknown) {
    if (!confirmed) return 'الدفعة غير المؤكدة تحتاج تاريخًا';
    if (month >= forecastStartOf(state, today)) return 'التاريخ غير المعروف مسموح للدفعات التاريخية فقط';
    date = null;
  } else if (!okDate(date)) return 'التاريخ غير صالح';
  if (kind !== 'regular' && kind !== 'arrears') return 'نوع الدفعة غير صالح';
  if (confirmed && date && date > today) return FUTURE;
  if (opId && state.payments.some((p) => p.opId === opId)) return ALREADY_SAVED;
  if (!allowDuplicate && state.payments.some((p) => p.itemId === itemId && p.month === month && p.kind === kind && p.amount === amount && (p.date || null) === (date || null))) return DUPLICATE;
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
  if (opId) p.opId = opId;
  if (date === null) p.dateUnknown = true;
  if (allowDuplicate) p.duplicateConfirmed = true;
  state.payments.push(p);
  log(state, `${kind === 'arrears' ? 'سداد من العجز' : 'دفعة'}${confirmed ? '' : ' (مسجلة — بانتظار التأكيد)'} — ${item.name} — خطة ${monthLabel(month)}: ${fmtKD(amount)} د.ك ${date ? `بتاريخ ${dateLabel(date)}` : '(تاريخ التنفيذ غير معروف)'}`);
  return null;
}

export function updatePayment(state, id, patch, opts = {}) {
  const idx = state.payments.findIndex((x) => x.id === id);
  if (idx < 0) return 'الدفعة غير موجودة';
  const before = state.payments[idx];
  // «تاريخ غير معروف» لا يُفترض من حقل فارغ: يجب طلبه صراحة (patch.dateUnknown === true)
  const wantsUnknown = patch.dateUnknown === true || (patch.date === undefined && patch.dateUnknown === undefined && before.date === null);
  if (!wantsUnknown && patch.date !== undefined && !okDate(patch.date)) return 'التاريخ غير صالح';
  const next = { ...before, ...patch, opId: null, allowDuplicate: true, dateUnknown: wantsUnknown, date: wantsUnknown ? null : (patch.date ?? before.date) };
  // تحقق كامل على نسخة تجريبية دون المساس بالحالة الأصلية
  const trial = { ...state, payments: state.payments.filter((_, k) => k !== idx), log: [] };
  const err = addPayment(trial, next, opts);
  if (err) return err;
  const added = trial.payments[trial.payments.length - 1];
  const updated = { ...added, id: before.id, createdAt: before.createdAt, editedAt: nowIso() };
  if (before.opId) updated.opId = before.opId; else delete updated.opId;
  if (before.duplicateConfirmed) updated.duplicateConfirmed = true; else delete updated.duplicateConfirmed;
  if (before.confirmedAt) updated.confirmedAt = before.confirmedAt;
  state.payments[idx] = updated; // نفس الموضع، تعديل واحد فقط بعد نجاح كل التحقق
  log(state, `تعديل دفعة — ${itemById(state, before.itemId)?.name}: ${fmtKD(before.amount)} ← ${fmtKD(updated.amount)} د.ك (${monthLabel(updated.month)}، ${dateLabel(updated.date)})`);
  return null;
}

export function confirmPayment(state, id, date, today = kuwaitToday()) {
  const p = state.payments.find((x) => x.id === id);
  if (!p) return 'الدفعة غير موجودة';
  if (p.confirmed !== false) return 'الدفعة مؤكدة مسبقًا';
  if (date !== undefined && date !== null && !okDate(date)) return 'التاريخ غير صالح';
  if ((date || p.date) > today) return FUTURE;
  const item = itemById(state, p.itemId);
  if (item?.type === 'debt' && p.amount > debtStatus(state, item).remaining) return `تأكيدها يتجاوز الرصيد المتبقي (${fmtKD(debtStatus(state, item).remaining)} د.ك) — عدّل المبلغ أولًا`;
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
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) return 'المبلغ غير صالح';
  if (amount === null && !state.months[month]?.plan?.hasOwnProperty(itemId)) return null;
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

/**
 * قاعدة تاريخ الاستحقاق لبند في خطة الشهر m (الالتزام يبقى في خطة m مهما كان التاريخ، فلا يُحتسب مرتين):
 * - مسموح: من أول يوم في m حتى آخر يوم في m+1 (يغطي نافذة m التي تمتد لما قبل راتب m+1، مثل دفع
 *   جزء من نوفمبر في 2 ديسمبر من بدل الإيجار).
 * - خارج نافذة m (قبل يوم راتب m، أو بعد اليوم السابق لراتب m+1): مسموح مع تنبيه.
 * - خارج النطاق: مرفوض — انقل المبلغ لخطة الشهر الصحيح بدل ذلك.
 */
export function dueDateCheck(state, month, date) {
  if (!okMonth(month)) return { ok: false, error: 'الشهر غير صالح' };
  if (!okDate(date)) return { ok: false, error: 'التاريخ غير صالح' };
  const sd = state.settings.salaryDay;
  const from = `${month}-01`;
  const nextM = addMonths(month, 1);
  const to = dateIn(nextM, daysInMonth(nextM));
  if (date < from || date > to) return { ok: false, error: `تاريخ الاستحقاق يجب أن يكون بين ${dateLabel(from)} و${dateLabel(to)} لبند في خطة ${monthLabel(month)}. لتغيير الشهر انقل المبلغ لخطة الشهر الصحيح.` };
  const winStart = dateIn(month, sd);
  const winEnd = addDays(dateIn(nextM, sd), -1);
  if (date < winStart) return { ok: true, warning: `الاستحقاق قبل نافذة ${monthLabel(month)} (تبدأ بالراتب ${dateLabel(winStart)}): يُدفع من رصيد سابق، وليس من دخل هذا الشهر.` };
  if (date > winEnd) return { ok: true, warning: `الاستحقاق بعد نهاية نافذة ${monthLabel(month)} (${dateLabel(winEnd)}): يتزامن مع دخل الشهر التالي.` };
  return { ok: true, warning: null };
}
export function setDueDate(state, month, itemId, date) {
  if (!itemById(state, itemId)) return 'البند غير موجود';
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (date) {
    const c = dueDateCheck(state, month, date);
    if (!c.ok) return c.error;
  }
  if (!date && !state.months[month]?.dueDates?.[itemId]) return null;
  const md = monthData(state, month);
  md.dueDates = md.dueDates || {};
  if (!date) delete md.dueDates[itemId]; else md.dueDates[itemId] = date;
  log(state, `تاريخ استحقاق — ${itemById(state, itemId)?.name} — خطة ${monthLabel(month)}: ${date ? dateLabel(date) : 'بدون'}`);
  return null;
}

/** الدخل: kind = salary | rent. patch: {amount, date, received, receivedDate} */
export function setIncome(state, month, kind, patch, today = kuwaitToday()) {
  if (patch.received === true && patch.receivedDate && patch.receivedDate > today) return FUTURE;
  if (kind !== 'salary' && kind !== 'rent') return 'نوع الدخل غير صالح';
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (patch.received === true && patch.receivedDate === undefined) return 'أدخل تاريخ الاستلام';
  if (patch.amount !== undefined && (!Number.isSafeInteger(patch.amount) || patch.amount < 0)) return 'المبلغ غير صالح';
  if (patch.date !== undefined && patch.date !== null && !okDate(patch.date)) return 'التاريخ غير صالح';
  if (patch.receivedAmount !== undefined && patch.receivedAmount !== null && (!Number.isSafeInteger(patch.receivedAmount) || patch.receivedAmount < 0)) return 'المبلغ المستلم غير صالح';
  if (patch.receivedDate !== undefined && patch.receivedDate !== null && !okDate(patch.receivedDate)) return 'تاريخ الاستلام غير صالح';
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

export function addExtra(state, { month, name, amount, status = 'received', date }, today = kuwaitToday()) {
  if (date !== undefined && date !== null && date !== '' && !okDate(date)) return 'التاريخ غير صالح';
  if (status === 'received' && date && date > today) return FUTURE;
  if (!okMonth(month)) return 'الشهر غير صالح';
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  if (!['pending', 'adopted', 'received'].includes(status)) return 'الحالة غير صالحة';
  const e = { id: uid('ext'), month, name: name || 'دخل إضافي', amount, status, date: date || null, createdAt: nowIso() };
  state.extras.push(e);
  log(state, `دخل إضافي — ${e.name} — ${monthLabel(month)}: ${fmtKD(amount)} د.ك (${statusLabel(status)})`);
  return null;
}
export const statusLabel = (s) => ({ pending: 'غير مؤكد', adopted: 'معتمد بالخطة', received: 'مستلم' }[s]);
export function updateExtra(state, id, patch, today = kuwaitToday()) {
  const e = state.extras.find((x) => x.id === id);
  if (!e) return 'غير موجود';
  const nx = { ...e, ...patch };
  if (!okMonth(nx.month)) return 'الشهر غير صالح';
  if (!['pending', 'adopted', 'received'].includes(nx.status)) return 'الحالة غير صالحة';
  if (nx.date && !okDate(nx.date)) return 'التاريخ غير صالح';
  if (nx.status === 'received' && nx.date && nx.date > today) return FUTURE;
  if (!okAmount(nx.amount)) return 'أدخل مبلغًا أكبر من صفر';
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
  if (data.type !== 'debt' && data.type !== 'expense') return 'نوع البند غير صالح';
  if (data.start && !okMonth(data.start)) return 'شهر البدء غير صالح';
  if (data.once && !okMonth(data.once)) return 'الشهر غير صالح';
  if (data.endMonth && !okMonth(data.endMonth)) return 'شهر الانتهاء غير صالح';
  if (data.extra && !['allow', 'closeOnly', 'none'].includes(data.extra)) return 'نوع السداد الإضافي غير صالح';
  if (data.mandatory !== undefined && data.mandatory !== 0 && (!Number.isSafeInteger(data.mandatory) || data.mandatory < 0)) return 'القسط غير صالح';
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
  if (patch.dueDay !== undefined && patch.dueDay !== null && (!Number.isInteger(patch.dueDay) || patch.dueDay < 1 || patch.dueDay > 31)) return 'يوم الاستحقاق بين 1 و31';
  if (patch.extra !== undefined && !['allow', 'closeOnly', 'none'].includes(patch.extra)) return 'نوع السداد الإضافي غير صالح';
  if (patch.start !== undefined && !okMonth(patch.start)) return 'شهر البدء غير صالح';
  if (patch.once !== undefined && patch.once !== null && !okMonth(patch.once)) return 'الشهر غير صالح';
  if (patch.endMonth !== undefined && patch.endMonth !== null && patch.endMonth !== '' && !okMonth(patch.endMonth)) return 'شهر الانتهاء غير صالح';
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
  if (!okMonth(from)) return 'الشهر غير صالح';
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

export function addVisaPurchase(state, { date, amount, note = '', opId = null, allowDuplicate = false }, today = kuwaitToday()) {
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (opId && state.visa.purchases.some((p) => p.opId === opId)) return ALREADY_SAVED;
  if (!allowDuplicate && state.visa.purchases.some((p) => p.amount === amount && p.date === date && (p.note || '') === (note || ''))) return DUPLICATE;
  if (date > today) return FUTURE;
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  const vs = visaSummary(state);
  if (amount > vs.available) return `المبلغ يتجاوز الحد المتاح (${fmtKD(Math.max(0, vs.available))} د.ك)`;
  const p = { id: uid('vp'), date, amount, note, createdAt: nowIso(), ...(opId ? { opId } : {}) };
  state.visa.purchases.push(p);
  log(state, `فيزا — شراء ${fmtKD(amount)} د.ك بتاريخ ${dateLabel(date)} (كشف ${dateLabel(visaCycleEnd(date, state.settings.visaStatementDay))})${note ? ` — ${note}` : ''}`);
  return null;
}
export function updateVisaPurchase(state, id, patch, today = kuwaitToday()) {
  const p = state.visa.purchases.find((x) => x.id === id);
  if (!p) return 'غير موجود';
  if (patch.date && patch.date > today) return FUTURE;
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
export function addVisaPayment(state, { date, amount, note = '', cashMonth, opId = null, allowDuplicate = false }, today = kuwaitToday()) {
  if (!okDate(date)) return 'التاريخ غير صالح';
  if (opId && state.visa.payments.some((p) => p.opId === opId)) return ALREADY_SAVED;
  if (!allowDuplicate && state.visa.payments.some((p) => p.amount === amount && p.date === date)) return DUPLICATE;
  if (date > today) return FUTURE;
  if (!okAmount(amount)) return 'أدخل مبلغًا أكبر من صفر';
  const vs = visaSummary(state, today);
  if (amount > vs.used) return `المبلغ أكبر من المستخدم غير المسدد (${fmtKD(vs.used)} د.ك)`;
  // يُخصم من سيولة شهر واحد فقط (أو لا يُخصم) — لا خصم مزدوج
  const cm = cashMonth === undefined ? monthOfDate(date) : cashMonth;
  state.visa.payments.push({ id: uid('vy'), date, amount, note, cashMonth: cm || null, createdAt: nowIso(), ...(opId ? { opId } : {}) });
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
  if (!okDate(cycleEnd)) return 'التاريخ غير صالح';
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
  if (closed && !okDate(date)) return 'التاريخ غير صالح';
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
export function holdReserve(state, id, date, today = kuwaitToday()) {
  const r = (state.reserves || []).find((x) => x.id === id);
  if (!r) return 'الاحتياطي غير موجود';
  if (date !== null && !okDate(date)) return 'التاريخ غير صالح';
  if (date && date > today) return FUTURE;
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

/** كشف التكرار: دفعة مطابقة (البند، الشهر، النوع، المبلغ، التاريخ) — للتنبيه قبل الحفظ */
export function findDuplicatePayment(state, { itemId, month, kind = 'regular', amount, date }) {
  return state.payments.find((p) => p.itemId === itemId && p.month === month && p.kind === kind && p.amount === amount && p.date === date) || null;
}
export function findDuplicateVisaPayment(state, { amount, date }) {
  return state.visa.payments.find((p) => p.amount === amount && p.date === date) || null;
}
