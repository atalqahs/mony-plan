// المبالغ تُخزَّن دائمًا كأعداد صحيحة بالفلس (1 د.ك = 1000 فلس) — لا أرقام عائمة في الحسابات.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeDigits(str) {
  let out = '';
  for (const ch of String(str)) {
    const a = AR_DIGITS.indexOf(ch);
    const f = FA_DIGITS.indexOf(ch);
    if (a >= 0) out += String(a);
    else if (f >= 0) out += String(f);
    else if (ch === '٫') out += '.';
    else if (ch === '٬' || ch === ',' || ch === ' ' || ch === ' ') continue;
    else out += ch;
  }
  return out.trim();
}

/** يحوّل نصًا مثل "1,729.650" أو "١٢٠٫٥" إلى فلس (عدد صحيح). يرجع NaN عند الخطأ. */
export function parseKD(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return NaN;
    input = String(input);
  }
  const s = normalizeDigits(input ?? '');
  if (s === '') return NaN;
  const m = /^(-)?(\d*)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return NaN;
  const whole = m[2] === '' ? 0 : parseInt(m[2], 10);
  const frac = parseInt(((m[3] || '') + '000').slice(0, 3), 10);
  const v = whole * 1000 + frac;
  if (!Number.isSafeInteger(v)) return NaN;
  return m[1] ? -v : v;
}

/** يعرض الفلس كدينار بثلاث منازل: 1729650 → "1,729.650" */
export function fmtKD(fils, opts = {}) {
  if (fils === null || fils === undefined || Number.isNaN(fils)) return '—';
  const neg = fils < 0;
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0');
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let sign = neg ? '−' : '';
  if (opts.sign && !neg && fils > 0) sign = '+';
  return `${sign}${w}.${frac}`;
}

/** قيمة لحقل الإدخال (بدون فواصل) */
export function inputKD(fils) {
  if (fils === null || fils === undefined) return '';
  const neg = fils < 0;
  const abs = Math.abs(fils);
  return `${neg ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** نسبة مئوية بدقة منزلة واحدة دون أرقام عائمة في المال: يرجع عشر النسبة كعدد صحيح */
export function percentTenths(part, whole) {
  if (!whole || whole <= 0) return 0;
  const p = Math.floor((Math.max(0, part) * 1000) / whole);
  return Math.min(1000, p);
}
