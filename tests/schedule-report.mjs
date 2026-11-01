// يولّد docs/AUDIT-SCHEDULE.md: جدول السداد الكامل من محرك التطبيق مع مطابقته بالمحرك المستقل.
// node tests/schedule-report.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import * as E from '../js/engine.js';
import * as A from '../js/actions.js';
import { fmtKD, parseKD } from '../js/money.js';
import { verify, compare } from './verifier.mjs';

const T = '2026-11-05';
const KD = (s) => parseKD(String(s));
const f = (x) => (x === null || x === undefined ? '—' : fmtKD(x));
const ok = (e) => { if (e) throw new Error(e); };
const at = (d) => (d > T ? d : T);

function mode1(verifyAbu) {
  const st = E.createSeedState('2026-11-01T00:00:00.000Z');
  // سبتمبر/أكتوبر مدفوعة بالكامل ومغلقة؛ تُسجل الدفعات التاريخية دون اختراع تاريخ تنفيذ (dateUnknown)
  const hist = (id, m, fils) => ok(A.addPayment(st, { itemId: id, month: m, amount: fils, dateUnknown: true }, { today: T }));
  for (const [m, vals] of Object.entries({ '2026-09': { furniture: 460, violations: 537.8, small: 170 }, '2026-10': { furniture: 460, violations: 164, small: 170, shuoon: 137.5 } })) {
    for (const [id, v] of Object.entries(vals)) hist(id, m, KD(v));
    for (const id of ['maid', 'bills', 'personal']) hist(id, m, E.expenseAmountFor(E.itemById(st, id), m));
  }
  hist('p_suhail', '2026-09', KD(550));
  hist('p_shafiq', '2026-09', KD(24));
  hist('p_electric', '2026-09', KD(20));
  for (const m of ['2026-09', '2026-10']) ok(A.closeMonth(st, m, true, T));
  if (verifyAbu === false) ok(A.setVerified(st, 'p_abuosama', false));
  return st;
}

function table(st, title, opts = {}) {
  const sim = E.simulate(st, { today: T, ...opts });
  const ver = verify(st, { today: T, ...opts });
  const diffs = compare(sim, ver);
  const debts = E.debtsOf(st).filter((d) => sim.months.some((m) => m.lines.some((l) => l.id === d.id)));
  const short = { furniture: 'أثاث', violations: 'مخالفات', small: 'صغير', shuoon: 'شؤون', p_suhail: 'سهيل', p_shafiq: 'شفيق', p_electric: 'كهربائي', p_abuosama: 'أبو أسامة' };
  const excl = sim.excludedPersons.map((x) => `${x.name} ${f(x.remaining)}`).join('، ');
  let md = `## ${title}\n\n- إغلاق الديون الداخلة في الجدولة: **${sim.endMonth ? E.monthLabel(sim.endMonth) : 'غير قابل للتحديد'}** (المحرك المستقل: ${ver.endMonth ? E.monthLabel(ver.endMonth) : '—'})\n- إغلاق جميع الديون المعروفة: **${sim.allDebtsEndMonth ? E.monthLabel(sim.allDebtsEndMonth) : `غير محدد — ديون مستثناة: ${excl}`}**\n- الفروق بين المحركين: **${diffs.length}**\n\n`;
  md += '| الشهر | النوع | الدخل المتوقع للنافذة | المستلم المؤكد | المصاريف الأساسية | التزامات غير الديون (جامعة/احتياطي) | الأقساط الإلزامية | الدفعات الإضافية | العجز المرحّل | النقد بداية → نهاية | عجز مالي |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const m of sim.months) {
    const ess = m.lines.filter((l) => l.type === 'expense' && ['maid', 'bills', 'personal'].includes(l.id)).reduce((a, l) => a + l.regUsed, 0);
    // ما يُموَّل من الاحتياطي لا يُعد خروجًا ثانيًا من النقد
    const other = m.lines.filter((l) => l.type === 'expense' && !['maid', 'bills', 'personal'].includes(l.id)).reduce((a, l) => a + l.regUsed - l.potCover, 0)
      + m.reserves.reduce((a, r) => a + (r.held ? r.planned : r.projHold), 0);
    const fromRes = m.lines.reduce((a, l) => a + l.potCover, 0);
    const mand = m.lines.filter((l) => l.type === 'debt').reduce((a, l) => a + Math.min(l.regUsed, l.mandatoryCap), 0);
    const extra = m.lines.filter((l) => l.type === 'debt').reduce((a, l) => a + Math.max(0, l.regUsed - l.mandatoryCap), 0);
    const arr = m.lines.reduce((a, l) => a + l.arrStart, 0);
    md += `| ${E.monthLabel(m.key)} | ${m.past ? 'ماضٍ' : 'توقع'} | ${m.past ? '—' : f(m.income.cash)} | ${f(m.income.received)} | ${f(ess)} | ${f(other)}${fromRes ? ` (+${f(fromRes)} من الاحتياطي)` : ''} | ${f(mand)} | ${f(extra)} | ${f(arr)} | ${m.past ? '—' : `${f(m.cashStart)} → ${f(m.cashEnd)}`} | ${f(m.fundingGap)} |\n`;
  }
  md += `\n**أرصدة الديون (افتتاحي → ختامي) لكل شهر**\n\n| الشهر | ${debts.map((d) => short[d.id] || d.name).join(' | ')} | الإجمالي |\n|---|${debts.map(() => '---').join('|')}|---|\n`;
  const open = Object.fromEntries(debts.map((d) => [d.id, E.debtStatus(st, d).original]));
  for (const m of sim.months) {
    const cells = debts.map((d) => {
      const l = m.lines.find((x) => x.id === d.id);
      const s = l ? l.balStart : (m.debtBalancesEnd[d.id] ?? open[d.id]);
      const e = m.debtBalancesEnd[d.id];
      return s === e ? f(e) : `${f(s)} → ${f(e)}`;
    });
    const total = debts.reduce((a, d) => a + Math.max(0, m.debtBalancesEnd[d.id]), 0);
    md += `| ${E.monthLabel(m.key)} | ${cells.join(' | ')} | ${f(total)} |\n`;
  }
  if (sim.timing.length) md += `\n**توقيت الدخل:** ${sim.timing.map((t) => `${t.kind === 'rent' ? 'بدل إيجار' : 'راتب'} ${E.monthLabel(t.ofMonth)} يصل ${t.date} فيُستعمل في نافذة ${E.monthLabel(t.cashMonth)}`).join('؛ ')}\n`;
  if (diffs.length) md += `\n**فروق:**\n${diffs.map((x) => `- ${x}`).join('\n')}\n`;
  return { md, sim, ver, diffs };
}

const parts = [];
const r1 = table(mode1(true), 'السيناريو الأساسي — سبتمبر/أكتوبر مدفوعة ومغلقة (تواريخ التنفيذ غير معروفة)، الأشخاص الثلاثة مسجلون، أبو أسامة دين قائم 450');
const r1b = table(mode1(false), 'مقارنة — لو كان أبو أسامة بانتظار التحقق (خارج الجدولة)');
const r2 = table(E.createSeedState('2026-11-01T00:00:00.000Z'), 'الوضع 2 — بيانات تاريخية غير مكتملة (لا شيء مسجل)');
const st3 = mode1(true); ok(A.closeMonth(st3, '2026-11', true, '2026-12-05'));
const r3 = (() => { const sim = E.simulate(st3, { today: '2026-12-05' }); const ver = verify(st3, { today: '2026-12-05' }); return { sim, ver, diffs: compare(sim, ver) }; })();
parts.push(r1.md, r1b.md, r2.md);
parts.push(`## الوضع 3 — تعثر نوفمبر كاملًا ثم استئناف السداد\n\nموعد الإغلاق: **${E.monthLabel(r3.sim.endMonth)}** — المستقل: **${E.monthLabel(r3.ver.endMonth)}** — الفروق: **${r3.diffs.length}**\n`);
const header = `# جدول السداد الكامل ومطابقة المحركين\n\nمولَّد آليًا من \`tests/schedule-report.mjs\` بتاريخ افتراضي ${T}. كل المبالغ بالدينار (ثلاث منازل). الرصيد النقدي المُدخل = صفر. الدخل في الأشهر التوقعية متوقع وغير مستلم.\n\n`;
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/AUDIT-SCHEDULE.md', import.meta.url), header + parts.join('\n\n'));
console.log('base', r1.sim.endMonth, r1.sim.allDebtsEndMonth, r1.ver.endMonth, r1.diffs.length);
console.log('abu-unverified', r1b.sim.endMonth, r1b.sim.allDebtsEndMonth, r1b.ver.endMonth, r1b.diffs.length);
console.log('mode2', r2.sim.endMonth, r2.ver.endMonth, r2.diffs.length);
console.log('mode3', r3.sim.endMonth, r3.ver.endMonth, r3.diffs.length);
