/* seisan.mjs — ★精算（卓ごとの pt を足して、点にして、誰が誰に払うか）★（設計図 v18.3 §5 やり取りの段・§2 精算）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。入るのは★そろった★半荘と卓だけ（呼ぶ側が選ぶ）。
 *
 * seisan(tables) →
 *   { ok: true,
 *     pt10: { 人: 全部の卓の pt10 の合計（レートの有無を問わない・戦績の「チップ・祝儀込み」） },
 *     ten:  { 人: レートのある卓だけの点 }（pt10 × rate ÷ 10・rate は10の倍数＝整数）,
 *     pt10NoRate: { 人: レートの無い卓の pt10 }（★点に混ぜない★＝画面は pt で別に出す）,
 *     pay: [{ from, to, ten }]（レートのある卓の点だけ・★人数−1 回まで★・払う人の大きい順）,
 *     out:  { 人: 外へ払う点 }（③-2・場代など＝合計0でない種・レートのある卓だけ・枚×pt10×rate÷10）,
 *     outPt10NoRate: { 人: レートの無い卓の外へ払う pt10 }（★out・pt10・ten・pay には混ぜない★＝「誰が誰に」とは別の「払う額」） }
 *   { ok: false, err, at } … err＝
 *     'table'      … 卓の形が違う（rate は null か 10 の倍数の正の整数・hanchans は並び）
 *     'hanchan'    … 半荘の形が違う（members と pt10 が同じ長さ・人は字・pt10 は整数・★tobi10 の鍵が在れば弾く★＝B2 で半荘は飛び賞を持たない）
 *     'hanchan_sum'… 半荘の pt10 の合計が 0 でない
 *     'chip_sum' / 'shugi_sum' … 卓のチップ・祝儀の枚の合計が 0 でない（★トップで吸わずに止めて直させる★）
 *     'chip_off' / 'shugi_off' … 1枚の pt（chip_pt10・shugi_pt10）が null なのに枚が打たれている
 *     'yaki_sum' / 'yaki_off' … やきとり（③-2・チップと同じ形）の枚の合計が 0 でない／yaki_pt10 が null なのに枚が打たれている
 *     'tobi_tsum' / 'tobi_off' … 飛び賞（B2・チップと同じ形・tobi_chip_v3.md）の枚の合計が 0 でない／tobi_pt10 が null なのに枚が打たれている
 *                     （★'tobi_tsum'＝卓の合計★。前の半荘の 'tobi_sum' と名を混ぜない）
 *     'cust_sum' / 'cust_off' … 合計0の自由な項目（customs）の枚の合計が 0 でない／pt10 が整数でないのに枚が打たれている（at＝[卓, 何番目]）
 *     'out_neg'    … 外へ払う種（outs）の枚が 0 未満（倉庫が 0 以上に守る＝読めない値は黙って出さない）・'out_off' … pt10 が整数でない
 *   at＝何番目の卓（と半荘）か。
 *
 * table＝{ rate: null|整数, chip_pt10: null|整数, shugi_pt10: null|整数,
 *          hanchans: [{ members: [人…], pt10: [...] }],
 *          chips?: { 人: 枚（±整数） }, shugis?: { 人: 枚 },
 *          yaki_pt10?: null|整数, yakis?: { 人: 枚 }（③-2・やきとり＝chip と同じ）,
 *          tobi_pt10?: null|整数, tobis?: { 人: 枚 }（B2・飛び賞＝chip と同じ）,
 *          customs?: [{ pt10, counts: { 人: 枚 } }]（合計0の自由な項目＝chip と同じに pt10 へ足す）,
 *          outs?: [{ pt10, counts: { 人: 枚（0 以上） } }]（外へ払う種＝out／outPt10NoRate だけに置く） }
 */
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const add = (m, k, v) => { m[k] = (m[k] || 0) + v; };
const sum = (a) => a.reduce((t, v) => t + v, 0);

function counts(m, per, at, name, sumErr = name + '_sum') {
  if (m === undefined || m === null) return { ok: true, list: [] };
  if (!isObj(m)) return { ok: false, err: 'table', at };
  const list = Object.entries(m);
  if (!list.every(([, v]) => isInt(v))) return { ok: false, err: 'table', at };
  const used = list.filter(([, v]) => v !== 0);
  if (used.length && per === null) return { ok: false, err: name + '_off', at };
  if (sum(list.map(([, v]) => v)) !== 0) return { ok: false, err: sumErr, at };
  return { ok: true, list: used };
}

export function seisan(tables) {
  if (!Array.isArray(tables)) return { ok: false, err: 'table', at: null };
  const pt10 = {}, ten = {}, pt10NoRate = {}, out = {}, outPt10NoRate = {};
  for (let ti = 0; ti < tables.length; ti++) {
    const t = tables[ti];
    if (!isObj(t) || !Array.isArray(t.hanchans)) return { ok: false, err: 'table', at: [ti] };
    const rate = t.rate === undefined ? null : t.rate;
    if (rate !== null && !(isInt(rate) && rate > 0 && rate % 10 === 0)) return { ok: false, err: 'table', at: [ti] };
    const cp = t.chip_pt10 === undefined ? null : t.chip_pt10;
    const sp = t.shugi_pt10 === undefined ? null : t.shugi_pt10;
    const yp = t.yaki_pt10 === undefined ? null : t.yaki_pt10;
    const tp = t.tobi_pt10 === undefined ? null : t.tobi_pt10;
    if ([cp, sp, yp, tp].some((p) => p !== null && !isInt(p))) return { ok: false, err: 'table', at: [ti] };
    const customs = t.customs === undefined ? [] : t.customs, outs = t.outs === undefined ? [] : t.outs;
    if (!Array.isArray(customs) || !Array.isArray(outs) || !customs.concat(outs).every(isObj)) return { ok: false, err: 'table', at: [ti] };
    const mine = {};
    for (let hi = 0; hi < t.hanchans.length; hi++) {
      const h = t.hanchans[hi];
      const at = [ti, hi];
      if (!isObj(h) || !Array.isArray(h.members) || !Array.isArray(h.pt10)) return { ok: false, err: 'hanchan', at };
      const n = h.members.length;
      if (Object.prototype.hasOwnProperty.call(h, 'tobi10') || h.pt10.length !== n || new Set(h.members).size !== n) return { ok: false, err: 'hanchan', at };
      if (!h.members.every((m) => typeof m === 'string' && m) || !h.pt10.every(isInt)) return { ok: false, err: 'hanchan', at };
      if (sum(h.pt10) !== 0) return { ok: false, err: 'hanchan_sum', at };
      h.members.forEach((m, i) => add(mine, m, h.pt10[i]));
    }
    const c = counts(t.chips, cp, [ti], 'chip');
    if (!c.ok) return c;
    const s = counts(t.shugis, sp, [ti], 'shugi');
    if (!s.ok) return s;
    for (const [m, v] of c.list) add(mine, m, v * cp);
    for (const [m, v] of s.list) add(mine, m, v * sp);
    const y = counts(t.yakis, yp, [ti], 'yaki');
    if (!y.ok) return y;
    for (const [m, v] of y.list) add(mine, m, v * yp);
    const tb = counts(t.tobis, tp, [ti], 'tobi', 'tobi_tsum');
    if (!tb.ok) return tb;
    for (const [m, v] of tb.list) add(mine, m, v * tp);
    for (let ci = 0; ci < customs.length; ci++) {
      const cu = customs[ci];
      const k = counts(cu.counts, isInt(cu.pt10) ? cu.pt10 : null, [ti, ci], 'cust');
      if (!k.ok) return k;
      for (const [m, v] of k.list) add(mine, m, v * cu.pt10);
    }
    for (let oi = 0; oi < outs.length; oi++) {
      const o = outs[oi];
      const k = o.counts === undefined || o.counts === null ? {} : o.counts;
      if (!isObj(k) || !Object.values(k).every(isInt)) return { ok: false, err: 'table', at: [ti, oi] };
      const used = Object.entries(k).filter(([, v]) => v !== 0);
      if (used.some(([, v]) => v < 0)) return { ok: false, err: 'out_neg', at: [ti, oi] };
      if (used.length && !isInt(o.pt10)) return { ok: false, err: 'out_off', at: [ti, oi] };
      for (const [m, v] of used) {
        if (rate === null) add(outPt10NoRate, m, v * o.pt10);
        else add(out, m, v * o.pt10 * (rate / 10));
      }
    }
    for (const [m, v] of Object.entries(mine)) {
      add(pt10, m, v);
      if (rate === null) add(pt10NoRate, m, v);
      else add(ten, m, v * (rate / 10));
    }
  }
  if (sum(Object.values(pt10)) !== 0 || sum(Object.values(ten)) !== 0 || sum(Object.values(pt10NoRate)) !== 0) {
    throw new Error('精算の合計が 0 でない（計算の穴）');
  }
  return { ok: true, pt10, ten, pt10NoRate, pay: payList(ten), out, outPt10NoRate };
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
