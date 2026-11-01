// محرك تحقق مستقل — لا يستورد أي شيء من js/.
// الطريقة: دفتر أحداث مؤرخة. كل دخل يُوجَّه بتاريخ وصوله إلى «نافذة» الشهر الذي يقع فيه، ويُدفع
// منه للالتزامات حدثًا بحدث (حسب الترتيب الزمني) بدل جمع دخل الشهر دفعة واحدة كما يفعل محرك التطبيق.
// الأرصدة تُحسب كدفتر: افتتاحي + تصحيحات − مدفوعات. يُستخدم للمقارنة حتى آخر فلس.

const p2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const ym = (k) => { const [y, m] = k.split('-').map(Number); return [y, m]; };
const kIdx = (k) => { const [y, m] = ym(k); return y * 12 + m - 1; };
const kOf = (i) => `${Math.floor(i / 12)}-${p2((i % 12) + 1)}`;
const kAdd = (k, n) => kOf(kIdx(k) + n);
const dim = (k) => { const [y, m] = ym(k); return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; };
const dIn = (k, d) => `${k}-${p2(Math.max(1, Math.min(d, dim(k))))}`;
const dPrev = (date) => { const k = date.slice(0, 7); const d = Number(date.slice(8)); return d > 1 ? `${k}-${p2(d - 1)}` : dIn(kAdd(k, -1), 31); };
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

export function verify(state, { today, assumeHistory = false, until = null } = {}) {
  const S = state.settings;
  const start = S.planStart;
  const F = today.slice(0, 7) < start ? start : today.slice(0, 7);
  const cashCfg = S.cash || {};
  const fPrev = dPrev(`${F}-01`);
  const anchor = cashCfg.date && cashCfg.date > fPrev ? cashCfg.date : fPrev;
  const anchorAmt = cashCfg.amount || 0;
  const after = (d) => !d || d > anchor;
  const win = (date) => (Number(date.slice(8)) >= S.salaryDay ? date.slice(0, 7) : kAdd(date.slice(0, 7), -1));

  const conf = state.payments.filter((p) => p.confirmed !== false);
  const sum = (arr) => arr.reduce((a, x) => a + x.amount, 0);
  const paidOf = (m, id, kind) => sum(conf.filter((p) => p.month === m && p.itemId === id && p.kind === kind));
  const paidAfterOf = (m, id, kind) => sum(conf.filter((p) => p.month === m && p.itemId === id && p.kind === kind && after(p.date)));
  const pendOf = (m, id) => sum(state.payments.filter((p) => p.confirmed === false && p.month === m && p.itemId === id && p.kind === 'regular'));

  // ── أحداث نقدية مؤرخة لكل شهر توقعي
  const events = new Map(); // month -> [{date, amount}]
  const ev = (m, date, amount) => { if (!events.has(m)) events.set(m, []); events.get(m).push({ date: date || `${m}-01`, amount }); };
  const income = (raw, defAmt, defDate) => {
    const r = raw || {};
    const amount = r.amount ?? defAmt;
    const date = r.date || defDate;
    return r.received ? { recv: true, amount: r.receivedAmount ?? amount, date: r.receivedDate || date } : { recv: false, amount, date };
  };
  const route = (alloc, inc) => {
    if (!inc.amount) return;
    let t = win(inc.date) > alloc ? win(inc.date) : alloc;
    if (inc.recv) { if (!after(inc.date)) return; if (t < F) t = F; } else if (alloc < F) return;
    ev(t, inc.date, inc.amount);
  };
  for (let i = kIdx(start); i < kIdx(start) + 640; i++) {
    const m = kOf(i);
    const md = state.months[m] || {};
    route(m, income(md.salary, S.salaryDefault, dIn(m, S.salaryDay)));
    route(md.rent?.allocMonth || m, income(md.rent, S.rentDefault, dIn(kAdd(m, 1), S.rentArrivalDay)));
  }
  const toCashMonth = (fiscal, date) => { if (!after(date)) return null; return fiscal >= F ? fiscal : F; };
  for (const p of conf) if (p.month < F) { const t = toCashMonth(p.month, p.date); if (t) ev(t, p.date, -p.amount); }
  for (const p of state.visa.payments) if (p.cashMonth) { const t = toCashMonth(p.cashMonth, p.date); if (t) ev(t, p.date, -p.amount); }
  for (const e of state.extras) if (e.status === 'received') { const t = toCashMonth(e.month, e.date); if (t) ev(t, e.date, e.amount); }
  for (const r of state.reserves || []) if (r.heldDate) { const t = toCashMonth(r.month, r.heldDate); if (t) ev(t, r.heldDate, -r.amount); }
  for (const e of state.extras) if (e.status === 'adopted' && e.month >= F) ev(e.month, `${e.month}-01`, e.amount);
  const recurringFor = (m) => (state.recurring || []).filter((r) => r.start <= m && (!r.end || m <= r.end)).reduce((a, r) => a + r.amount, 0);

  // ── الدفتر
  const debts = state.items.filter((i) => i.type === 'debt').sort((a, b) => a.order - b.order);
  const exps = state.items.filter((i) => i.type === 'expense').sort((a, b) => a.order - b.order);
  const reserves = state.reserves || [];
  const adjOf = (id) => state.adjustments.filter((a) => a.itemId === id).reduce((a, x) => a + x.delta, 0);
  const unverified = (d) => d.group === 'person' && d.verified === false;
  const prio = S.payoffPriority || [];
  const rank = (d) => (prio.indexOf(d.id) < 0 ? 1e6 + d.order : prio.indexOf(d.id));
  const expAmt = (e, m) => {
    if (e.once && e.once !== m) return 0;
    if (e.endMonth && m > e.endMonth) return 0;
    let a = 0;
    for (const x of [...(e.schedule || [])].sort((u, v) => (u.from < v.from ? -1 : 1))) if (x.from <= m) a = x.amount;
    return a;
  };
  const bal = {}; const aC = {}; const aP = {}; const pot = {};
  for (const r of reserves) pot[r.id] = 0;
  let cash = 0; let end = null; const out = [];

  for (let i = kIdx(start); i < kIdx(start) + 600; i++) {
    const m = kOf(i);
    const md = state.months[m] || {};
    const plan = md.plan || {};
    const past = m < F; const closed = !!md.closed; const auto = m >= S.autoFrom;
    if (m === F) cash = anchorAmt;
    const L = [];
    for (const d of debts) {
      if (m < d.start) continue;
      if (bal[d.id] === undefined) { bal[d.id] = d.opening + adjOf(d.id); aC[d.id] = 0; aP[d.id] = 0; }
      const b0 = bal[d.id];
      const pr = paidOf(m, d.id, 'regular'); const pa = paidOf(m, d.id, 'arrears');
      if (b0 <= 0 && pr === 0 && pa === 0) continue;
      const later = sum(conf.filter((p) => p.itemId === d.id && p.month > m));
      const room = Math.max(0, b0 - later);
      const c0 = Math.max(0, Math.min(aC[d.id], room)); const q0 = Math.max(0, Math.min(aP[d.id], room - c0));
      const cap = Math.max(0, room - Math.max(c0 + q0, pa));
      const mcap = Math.min(d.mandatory || 0, cap);
      const uv = unverified(d);
      let raw; let eng = false;
      if (has(plan, d.id)) raw = plan[d.id]; else if (auto && !uv) { raw = mcap; eng = true; } else raw = d.mandatory || 0;
      const planned = Math.min(raw, cap);
      const real = pr > 0 || closed;
      L.push({ id: d.id, debt: d, carry: true, b0, room, c0, q0, cap, mcap, eng, uv, planned, def: eng ? mcap : planned, pr, pa,
        prCash: paidAfterOf(m, d.id, 'regular'), paCash: paidAfterOf(m, d.id, 'arrears'),
        real, arrReal: closed || pa > 0, unknown: past && !real && planned > 0, proj: 0, projA: 0, unmet: 0, extra: 0, cover: 0 });
    }
    for (const e of exps) {
      if (aC[e.id] === undefined) { aC[e.id] = 0; aP[e.id] = 0; }
      const planned = has(plan, e.id) ? plan[e.id] : expAmt(e, m);
      const pr = paidOf(m, e.id, 'regular'); const pa = paidOf(m, e.id, 'arrears');
      const c0 = e.carry ? aC[e.id] : 0; const q0 = e.carry ? aP[e.id] : 0;
      if (planned === 0 && pr === 0 && pa === 0 && c0 + q0 === 0 && pendOf(m, e.id) === 0) continue;
      L.push({ id: e.id, exp: e, carry: !!e.carry, c0, q0, planned, def: planned, pr, pa,
        prCash: paidAfterOf(m, e.id, 'regular'), paCash: paidAfterOf(m, e.id, 'arrears'),
        real: (e.carry && pr > 0) || closed, arrReal: closed || pa > 0, unknown: past && pr === 0 && !closed && planned > 0, proj: 0, projA: 0, unmet: 0, cover: 0 });
    }
    const R = reserves.filter((r) => r.month === m).map((r) => ({ r, held: !!r.heldDate, hold: 0, unmet: 0 }));
    const targets = reserves.filter((r) => r.targetMonth === m);
    const fromPot = (id, need) => {
      let g = 0;
      for (const r of targets) if (r.targetItem === id) { const x = Math.min(pot[r.id], need - g); if (x > 0) { pot[r.id] -= x; g += x; } }
      return g;
    };
    let gap = 0;
    if (!past) {
      // ١) الحقائق: الدفعات المؤكدة بعد الارتكاز (بعد تغطية الاحتياطي)
      for (const l of L) { l.cover = fromPot(l.id, l.pr); cash -= Math.max(0, l.prCash - l.cover) + l.paCash; }
      // ٢) فواتير الشهر بالترتيب، تُموَّل حدثًا بحدث
      const bills = [];
      for (const l of L) if (l.exp && !l.real) bills.push({ l, need: Math.max(0, l.planned - l.pr), pot: true, k: 'reg' });
      for (const l of L) if (l.debt && !l.real) bills.push({ l, need: Math.min(l.planned, l.mcap), pot: true, k: 'reg' });
      for (const l of L) if (l.debt && !l.real) bills.push({ l, need: l.planned - Math.min(l.planned, l.mcap), pot: true, k: 'reg' });
      for (const x of R) if (!x.held) bills.push({ x, need: x.r.amount, k: 'hold' });
      // العجز: للديون لا يتجاوز ما يبقى في الرصيد بعد دفعات الشهر المؤكدة والمتوقعة (يُحسب لحظة الدفع)
      for (const l of [...L.filter((y) => y.exp), ...L.filter((y) => y.debt)]) if (!l.arrReal && l.c0 + l.q0 > 0) bills.push({ l, need: l.c0 + l.q0, k: 'arr', lazy: !!l.debt });
      if (auto && !closed) {
        for (const l of L.filter((y) => y.debt && y.eng && !y.real && y.debt.extra === 'allow' && !y.uv).sort((a, b) => rank(a.debt) - rank(b.debt))) {
          bills.push({ l, need: Math.max(0, l.cap - l.planned), k: 'extra' });
        }
      }
      for (const x of R) if (x.held) pot[x.r.id] += x.r.amount;
      for (const bl of bills) if (bl.pot) { const c = fromPot(bl.l.id, bl.need); bl.l.cover += c; bl.got = c; } else bl.got = 0;
      const regPlannedFor = (l) => bills.filter((b) => b.l === l && b.k === 'reg').reduce((a, b) => a + b.need, 0);
      for (const bl of bills) if (bl.lazy) bl.need = Math.min(bl.need, Math.max(0, bl.l.room - bl.l.pr - regPlannedFor(bl.l)));
      const pay = () => {
        for (const bl of bills) {
          if (cash <= 0) break;
          const x = Math.min(bl.need - bl.got, cash);
          if (x > 0) { bl.got += x; cash -= x; }
        }
      };
      // الحقائق السالبة المؤكدة (سداد فيزا، حجز احتياطي، دفعات لأشهر سابقة) تسبق الفواتير المتوقعة
      const all = events.get(m) || [];
      for (const e of all) if (e.amount < 0) cash += e.amount;
      pay(); // النقد المتاح عند بداية النافذة (الرصيد/المرحّل بعد الحقائق)
      const evs = all.filter((e) => e.amount > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const rec = recurringFor(m) + (until && Array.isArray(until.virtual) ? until.virtual.filter((v) => v.month === m).reduce((a, v) => a + v.amount, 0) : 0);
      if (rec) evs.unshift({ date: `${m}-01`, amount: rec });
      for (const e of evs) { cash += e.amount; pay(); }
      for (const bl of bills) {
        if (bl.k === 'reg') { bl.l.proj += bl.got; bl.l.unmet += bl.need - bl.got; } else if (bl.k === 'arr') bl.l.projA = bl.got;
        else if (bl.k === 'extra') { bl.l.extra = bl.got; bl.l.proj += bl.got; } else { bl.x.hold = bl.got; bl.x.unmet = bl.need - bl.got; pot[bl.x.r.id] += bl.got; gap += bl.x.unmet; }
      }
      for (const r of targets) if (pot[r.id] > 0) { cash += pot[r.id]; pot[r.id] = 0; }
    } else {
      for (const x of R) if (x.held || (assumeHistory && !x.held)) pot[x.r.id] += x.r.amount;
      for (const l of L) l.cover = fromPot(l.id, l.pr);
    }
    const lines = {};
    for (const l of L) {
      let ru;
      if (l.real) ru = l.pr;
      else if (!past) ru = l.pr + l.proj;
      else ru = l.pr + (assumeHistory && l.unknown ? Math.max(0, l.planned - l.pr) : 0);
      if (l.exp && !l.carry) ru = l.pr + (past ? 0 : l.proj);
      const au = l.arrReal || past ? l.pa : l.projA;
      const sc = l.carry && l.real ? Math.max(0, l.def - l.pr) : 0;
      const sp = l.carry && !past && !l.real ? l.unmet : 0;
      if (!past) gap += l.unmet;
      const fc = Math.min(au, l.c0);
      let nc = l.c0 - fc + sc; let np = Math.max(0, l.q0 - (au - fc)) + sp;
      if (l.debt) {
        bal[l.id] = l.b0 - ru - au;
        nc = Math.min(nc, Math.max(0, bal[l.id])); np = Math.min(np, Math.max(0, bal[l.id] - nc));
      } else if (!l.carry) { nc = 0; np = 0; }
      aC[l.id] = nc; aP[l.id] = np;
      lines[l.id] = { regUsed: ru, arrUsed: au, balEnd: l.debt ? bal[l.id] : null, arrC: nc, arrP: np, unmet: l.unmet, extra: l.extra || 0, cover: l.cover };
    }
    out.push({ key: m, past, cashEnd: past ? null : cash, gap, lines, balances: Object.fromEntries(debts.map((d) => [d.id, bal[d.id] ?? d.opening])) });
    if (end === null && debts.every((d) => m >= d.start) && debts.every((d) => unverified(d) || (bal[d.id] ?? d.opening) <= 0)) end = m;
    if (end !== null && (!until || !until.month || m >= until.month)) break;
  }
  // دفتر الأرصدة المؤكدة (مستقل عن المحاكاة)
  const actual = Object.fromEntries(debts.map((d) => {
    const paid = sum(conf.filter((p) => p.itemId === d.id));
    return [d.id, Math.max(0, d.opening + adjOf(d.id) - paid)];
  }));
  return { endMonth: end, months: out, actual, F };
}

/** يقارن نتيجة محرك التطبيق بالمحرك المستقل ويرجع قائمة الفروق (فارغة = تطابق تام) */
export function compare(engineSim, ver) {
  const diffs = [];
  if (engineSim.endMonth !== ver.endMonth) diffs.push(`endMonth: engine=${engineSim.endMonth} verifier=${ver.endMonth}`);
  for (const vm of ver.months) {
    const em = engineSim.byKey[vm.key];
    if (!em) { diffs.push(`${vm.key}: missing in engine`); continue; }
    if ((em.cashEnd ?? null) !== (vm.cashEnd ?? null)) diffs.push(`${vm.key} cashEnd: ${em.cashEnd} vs ${vm.cashEnd}`);
    if (em.fundingGap !== vm.gap) diffs.push(`${vm.key} gap: ${em.fundingGap} vs ${vm.gap}`);
    for (const [id, b] of Object.entries(vm.balances)) if ((em.debtBalancesEnd[id]) !== b) diffs.push(`${vm.key} bal ${id}: ${em.debtBalancesEnd[id]} vs ${b}`);
    for (const [id, vl] of Object.entries(vm.lines)) {
      const el = em.lines.find((l) => l.id === id);
      if (!el) { diffs.push(`${vm.key} line ${id} missing in engine`); continue; }
      for (const [ek, vk] of [['regUsed', 'regUsed'], ['arrUsed', 'arrUsed'], ['unmet', 'unmet'], ['potCover', 'cover']]) {
        if (el[ek] !== vl[vk]) diffs.push(`${vm.key} ${id}.${ek}: ${el[ek]} vs ${vl[vk]}`);
      }
      if (el.arrEnd !== vl.arrC + vl.arrP) diffs.push(`${vm.key} ${id}.arrEnd: ${el.arrEnd} vs ${vl.arrC + vl.arrP}`);
    }
    if (em.lines.length !== Object.keys(vm.lines).length) diffs.push(`${vm.key} line count: ${em.lines.length} vs ${Object.keys(vm.lines).length}`);
  }
  return diffs;
}
