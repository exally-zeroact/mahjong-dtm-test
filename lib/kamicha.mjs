/* kamicha.mjs — 点の行の［上家］の印 → 起家からの並び（hanchans.ton_order）（A13・a13g_sadame §2）
 *
 * 司さん 11-23「入力画面に常に上家ボタン作っといたら点数の横に同点でも上家の人が分かるやろが」「押して色変わるだけで分かるやろ」
 * lib/hanchan-pt.mjs は同じ点（x＝箱下ありなら素点・なしなら max(素点,0)）の人どうしの前後だけに並びを使う
 * （x の高い順・同じ x は並びの早い人が上）＝同じ点の組の中の前後が同じなら、他の人の位置は答えを変えない。
 *
 * marks＝押した席の番号（押した順）。画面には番号を出さない（色だけ）。
 *   groups(R, cells)              → 同じ x の席の組（2人以上だけ・組は最初の席の順・組の中は席の順）
 *   fromMarks(R, cells, marks)    → { need:false } | { need:true, ok:false, seats:[印の無い席] } | { need:true, ok:true, order:[席…n人] }
 *        組ごとに印が（組の人数−1）以上なら ok。並び＝印の席（押した順）→印の無い席（席の順）
 *        ＝組の中は印の人が押した順で上・印の無い人（いても1人）が一番下。2人の同点で1人押せば、その人が上家。
 *   marksFromOrder(R, cells, ord) → 前の並び（席の番号）から印を作る（直す画面）。同じ点の組ごとに並びの順で★一番下の1人を除いた人★
 *        （新しく入れる時と同じ形＝2人の同点なら上家の1人だけ色が付く・taiketsu 止め1）
 *   sameTie(R, cells, a, b)       → 同じ点の組の中の前後が a と b で同じか（直す時に要らない hanchan_order を送らない）
 */
const xOf = (R, v) => (R && R.hakoshita === true ? v : Math.max(v, 0));
const isIntArr = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isInteger(v));

export function groups(R, cells) {
  const n = Array.isArray(cells) ? cells.length : 0;
  if (!isIntArr(cells, n) || n === 0) return [];
  const by = new Map();
  cells.forEach((v, i) => { const k = xOf(R, v); if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  return [...by.values()].filter((g) => g.length >= 2).sort((a, b) => a[0] - b[0]);
}

export function fromMarks(R, cells, marks) {
  const gs = groups(R, cells);
  if (!gs.length) return { need: false };
  const n = cells.length;
  const m = [];
  for (const s of Array.isArray(marks) ? marks : []) if (Number.isInteger(s) && s >= 0 && s < n && !m.includes(s)) m.push(s);
  for (const g of gs) {
    const free = g.filter((s) => !m.includes(s));
    if (free.length > 1) return { need: true, ok: false, seats: free };
  }
  const order = m.concat([...Array(n).keys()].filter((s) => !m.includes(s)));
  return { need: true, ok: true, order };
}

export function marksFromOrder(R, cells, ord) {
  const n = Array.isArray(cells) ? cells.length : 0;
  if (!Array.isArray(ord) || ord.length !== n || new Set(ord).size !== n || !ord.every((s) => Number.isInteger(s) && s >= 0 && s < n)) return [];
  const pos = []; ord.forEach((s, i) => { pos[s] = i; });
  const out = [];
  for (const g of groups(R, cells)) out.push(...g.slice().sort((a, b) => pos[a] - pos[b]).slice(0, -1));
  return out;
}

export function sameTie(R, cells, a, b) {
  const n = Array.isArray(cells) ? cells.length : 0;
  const ok = (o) => Array.isArray(o) && o.length === n && new Set(o).size === n && o.every((s) => Number.isInteger(s) && s >= 0 && s < n);
  if (!ok(a) || !ok(b)) return false;
  const pa = [], pb = []; a.forEach((s, i) => { pa[s] = i; }); b.forEach((s, i) => { pb[s] = i; });
  for (const g of groups(R, cells)) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if ((pa[g[i]] < pa[g[j]]) !== (pb[g[i]] < pb[g[j]])) return false;
    }
  }
  return true;
}

// v2（a13g_sadame v2 §1）：押し方と字
const groupOf = (gs, i) => gs.find((g) => g.includes(i)) || null;

//   tapMark(R, cells, marks, i) → 新しい marks。印があれば外す。無ければ：今の点で2人の同点の組なら相手の印を外してから足す（ラジオ）・それ以外は足す
export function tapMark(R, cells, marks, i) {
  const m = (Array.isArray(marks) ? marks : []).slice();
  const j = m.indexOf(i);
  if (j >= 0) { m.splice(j, 1); return m; }
  const g = groupOf(groups(R, cells), i);
  const out = g && g.length === 2 ? m.filter((s) => !g.includes(s)) : m;
  out.push(i);
  return out;
}

//   labels(R, cells, marks) → 席ごとに { on, text }。3人以上の同点の組で印の人＝「上家k」（組の中の押した順）。
//   2人の同点で2人とも印（同点になる前に押した時だけ）＝番号を出して順が見えるようにする。他は「上家」
export function labels(R, cells, marks) {
  const n = Array.isArray(cells) ? cells.length : 0;
  const m = Array.isArray(marks) ? marks : [];
  const gs = groups(R, cells);
  return [...Array(n).keys()].map((i) => {
    if (!m.includes(i)) return { on: false, text: '上家' };
    const g = groupOf(gs, i);
    if (!g) return { on: true, text: '上家' };
    const inG = m.filter((s) => g.includes(s));
    const num = g.length >= 3 || inG.length >= 2;
    return { on: true, text: num ? '上家' + (inG.indexOf(i) + 1) : '上家' };
  });
}
