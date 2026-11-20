/* seisan.mjs — ★精算（卓ごとの pt を足して、点にして、誰が誰に払うか）★（設計図 v18.3 §5 やり取りの段・§2 精算）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。入るのは★そろった★半荘と卓だけ（呼ぶ側が選ぶ）。
 *
 * seisan(tables) →
 *   { ok: true,
 *     pt10: { 人: 全部の卓の pt10 の合計（レートの有無を問わない・戦績の「チップ・祝儀込み」） },
 *     ten:  { 人: レートのある卓だけの点 }（pt10 × rate ÷ 10・rate は10の倍数＝整数）,
 *     pt10NoRate: { 人: レートの無い卓の pt10 }（★点に混ぜない★＝画面は pt で別に出す）,
 *     pay: [{ from, to, ten }]（レートのある卓の点だけ・★人数−1 回まで★・払う人の大きい順）}
 *   { ok: false, err, at } … err＝
 *     'table'      … 卓の形が違う（rate は null か 10 の倍数の正の整数・hanchans は並び）
 *     'hanchan'    … 半荘の形が違う（members と pt10 が同じ長さ・人は字・pt10/tobi10 は整数）
 *     'hanchan_sum'… 半荘の pt10 の合計が 0 でない
 *     'tobi_sum'   … 飛び賞の合計が 0 でない
 *     'chip_sum' / 'shugi_sum' … 卓のチップ・祝儀の枚の合計が 0 でない（★トップで吸わずに止めて直させる★）
 *     'chip_off' / 'shugi_off' … 1枚の pt（chip_pt10・shugi_pt10）が null なのに枚が打たれている
 *   at＝何番目の卓（と半荘）か。
 *
 * table＝{ rate: null|整数, chip_pt10: null|整数, shugi_pt10: null|整数,
 *          hanchans: [{ members: [人…], pt10: [...], tobi10?: [...] }],
 *          chips?: { 人: 枚（±整数） }, shugis?: { 人: 枚 } }
 */
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const add = (m, k, v) => { m[k] = (m[k] || 0) + v; };
const sum = (a) => a.reduce((t, v) => t + v, 0);

function counts(m, per, at, name) {
  if (m === undefined || m === null) return { ok: true, list: [] };
  if (!isObj(m)) return { ok: false, err: 'table', at };
  const list = Object.entries(m);
  if (!list.every(([, v]) => isInt(v))) return { ok: false, err: 'table', at };
  const used = list.filter(([, v]) => v !== 0);
  if (used.length && per === null) return { ok: false, err: name + '_off', at };
  if (sum(list.map(([, v]) => v)) !== 0) return { ok: false, err: name + '_sum', at };
  return { ok: true, list: used };
}

export function seisan(tables) {
  if (!Array.isArray(tables)) return { ok: false, err: 'table', at: null };
  const pt10 = {}, ten = {}, pt10NoRate = {};
  for (let ti = 0; ti < tables.length; ti++) {
    const t = tables[ti];
    if (!isObj(t) || !Array.isArray(t.hanchans)) return { ok: false, err: 'table', at: [ti] };
    const rate = t.rate === undefined ? null : t.rate;
    if (rate !== null && !(isInt(rate) && rate > 0 && rate % 10 === 0)) return { ok: false, err: 'table', at: [ti] };
    const cp = t.chip_pt10 === undefined ? null : t.chip_pt10;
    const sp = t.shugi_pt10 === undefined ? null : t.shugi_pt10;
    if ((cp !== null && !isInt(cp)) || (sp !== null && !isInt(sp))) return { ok: false, err: 'table', at: [ti] };
    const mine = {};
    for (let hi = 0; hi < t.hanchans.length; hi++) {
      const h = t.hanchans[hi];
      const at = [ti, hi];
      if (!isObj(h) || !Array.isArray(h.members) || !Array.isArray(h.pt10)) return { ok: false, err: 'hanchan', at };
      const n = h.members.length;
      const tobi = h.tobi10 === undefined ? new Array(n).fill(0) : h.tobi10;
      if (!Array.isArray(tobi) || h.pt10.length !== n || tobi.length !== n || new Set(h.members).size !== n) return { ok: false, err: 'hanchan', at };
      if (!h.members.every((m) => typeof m === 'string' && m) || !h.pt10.every(isInt) || !tobi.every(isInt)) return { ok: false, err: 'hanchan', at };
      if (sum(h.pt10) !== 0) return { ok: false, err: 'hanchan_sum', at };
      if (sum(tobi) !== 0) return { ok: false, err: 'tobi_sum', at };
      h.members.forEach((m, i) => add(mine, m, h.pt10[i] + tobi[i]));
    }
    const c = counts(t.chips, cp, [ti], 'chip');
    if (!c.ok) return c;
    const s = counts(t.shugis, sp, [ti], 'shugi');
    if (!s.ok) return s;
    for (const [m, v] of c.list) add(mine, m, v * cp);
    for (const [m, v] of s.list) add(mine, m, v * sp);
    for (const [m, v] of Object.entries(mine)) {
      add(pt10, m, v);
      if (rate === null) add(pt10NoRate, m, v);
      else add(ten, m, v * (rate / 10));
    }
  }
  if (sum(Object.values(pt10)) !== 0 || sum(Object.values(ten)) !== 0 || sum(Object.values(pt10NoRate)) !== 0) {
    throw new Error('精算の合計が 0 でない（計算の穴）');
  }
  return { ok: true, pt10, ten, pt10NoRate, pay: payList(ten) };
}

/* 点の貸し借りから「誰が誰に」を作る。払う人の大きい順×受け取る人の大きい順に当てる＝1回ごとに少なくとも1人が0になる
 * ＝★人数−1 回まで★。同じ額は人の字の順（決まった順＝同じ入力なら同じ答え）。 */
export function payList(ten) {
  const by = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const give = Object.entries(ten).filter(([, v]) => v < 0).map(([m, v]) => [m, -v]).sort(by);
  const take = Object.entries(ten).filter(([, v]) => v > 0).sort(by);
  const pay = [];
  let i = 0, j = 0;
  while (i < give.length && j < take.length) {
    const v = Math.min(give[i][1], take[j][1]);
    pay.push({ from: give[i][0], to: take[j][0], ten: v });
    give[i][1] -= v; take[j][1] -= v;
    if (give[i][1] === 0) i++;
    if (take[j][1] === 0) j++;
  }
  return pay;
}
