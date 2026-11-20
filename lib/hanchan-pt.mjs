/* hanchan-pt.mjs — ★半荘の pt（素点→返し→ウマ→オカ→丸め）と飛び賞★（設計図 v18.3 §5・lib/rules.mjs の鍵の意味）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。pt は全部 0.1pt 単位の整数（pt10）で返す（小数の誤差を持ち込まない）。
 *
 * hanchanPt(rules, cells, { order, lost, yaki }) →
 *   { ok: true, pt10: [人ごと], rank: [人ごと・0 が1位・split の同点は同じ順位] }
 *   { ok: false, err } … err＝
 *     'rules'   … rules が lib/rules.mjs の rulesOk を通らない
 *     'cells'   … cells が長さ players の整数の並びでない・100点単位でない
 *     'lost'    … 消えた供託が 0 以上の100点単位の整数でない
 *     'sum'     … ★素点の見張り★＝素点の合計 ≠ 持ち点×人数−消えた供託（打ち間違い・供託の抜け＝止めて直させる）
 *                  箱下なし（hakoshita false）でも、見張りは打ったままの数（0 で止める前）で比べる＝「足し戻して比べる」
 *     'order'   … 起家からの順（ton_order）が要る半荘（lib/needs-order.mjs が 'tie' か 'yaki'＝倉庫 ?| ['tie','yaki']）なのに order が無い・形が違う
 *     'yaki'    … yaki（やきとりの席）が昇順・重なり無し・0〜players−1 の整数の並びでない（needsOrder が 'incomplete'）
 *   order＝起家からの席の並び（[2,0,1,3] なら席2が起家）。同点の上家・割り切れない 0.1pt の配り先に使う。
 *   lost＝終局で消えた供託の点（kyotaku_end 'kieru' の時の 1000×本数・既定 0）。
 *   yaki＝その半荘のやきとりの席（hanchans.yakitori・既定 []）。★やきとりのお金はここで足さない（③-2）★＝順が要るかの判じだけに使う。
 *
 * ★段の決め（§5）★
 *   1. 箱下なし（hakoshita が true でない）は 0 未満を 0 にして順位と pt に使う。
 *   2. 順位：素点の高い順。同点は tie＝kamicha なら order の早い人が上・split なら同じ組。
 *   3. 人ごとの丸める前の値＝(素点−返し)/1000 ＋ 組のウマ（＋1位を含む組はオカ (返し−持ち点)×人数/1000）÷組の人数。
 *   4. 丸めは★トップの組以外★に1人ずつ同じ式（同じ素点なら同じ pt）。どれも★絶対値に当てて符号を戻す★：
 *        gosha 五捨六入＝端数が 0.5 を超えたら上げ（0.1pt 刻みなら 0.6 以上・同点を分けた 1/3 の端数もこの式）
 *        shisha 四捨五入＝0.5 以上で上げ／kirisute＝切り捨て／none＝0.1pt に四捨五入（同点を分けた 1/3・1/4 の時だけ効く）
 *   5. トップの組（1位の人・split で同点なら全員）＝他の人の合計の逆。組の中は等しく割り、割り切れない 0.1pt は
 *      order の早い人から1つずつ＝★合計は作りから必ず 0★（外れたら計算の穴＝ok:false にせず throw で止める）。
 *
 * tobiPt(rules, cells, { to }) → 飛び賞（やり取りの段・丸めない・分けない）
 *   { ok: true, pt10: [人ごと], busted: [飛んだ席] } ／ { ok: false, err: 'rules'|'cells'|'to', seats? }
 *   { ok: false, err: 'pending', seats: [受け取りが決まっていない飛んだ席] } … その半荘は「そろった」にしない
 *   飛び＝tobi true の時、素点 < 0（tobi_zero なら 0 ちょうども）。tobi_pt は pt（×10 で pt10）。
 *   to[飛んだ席]＝受け取る席（busted の時に要る）か 'all'（他の全員に tobi_pt ずつ）。tobi_from 'all' なら to は要らない。
 */
import { rulesOk } from './rules.mjs';
import { needsOrder } from './needs-order.mjs';

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function okRules(rules) {
  const r = rulesOk(rules);
  return r.ok ? r.rules : null;
}

function okCells(cells, n) {
  return Array.isArray(cells) && cells.length === n && cells.every((v) => isInt(v) && v % 100 === 0);
}

function okOrder(order, n) {
  if (!Array.isArray(order) || order.length !== n) return false;
  const s = new Set(order);
  return s.size === n && order.every((v) => isInt(v) && v >= 0 && v < n);
}

/* num/den（pt10 単位の有理数・den>0）を丸めて pt10 の整数にする。絶対値に当てて符号を戻す。 */
export function roundPt10(num, den, mode) {
  const sign = num < 0 ? -1 : 1;
  const a = Math.abs(num);
  if (mode === 'none') {
    const f = Math.floor(a / den), rem = a - f * den;
    return sign * (f + (rem * 2 >= den ? 1 : 0));
  }
  const D = den * 10; // 1pt ＝ 10 pt10
  const f = Math.floor(a / D), rem = a - f * D;
  let up = 0;
  if (mode === 'gosha') up = rem * 2 > D ? 1 : 0;
  else if (mode === 'shisha') up = rem * 2 >= D ? 1 : 0;
  else if (mode === 'kirisute') up = 0;
  else throw new Error('round の値が違う: ' + mode);
  return sign * (f + up) * 10;
}

export function hanchanPt(rules, cells, opts = {}) {
  const R = okRules(rules);
  if (!R) return { ok: false, err: 'rules' };
  const n = R.players;
  if (!okCells(cells, n)) return { ok: false, err: 'cells' };
  const lost = opts.lost === undefined ? 0 : opts.lost;
  if (!isInt(lost) || lost < 0 || lost % 100 !== 0) return { ok: false, err: 'lost' };
  const sum = cells.reduce((t, v) => t + v, 0);
  if (sum !== R.start_pts * n - lost) return { ok: false, err: 'sum', want: R.start_pts * n - lost, got: sum };

  const need = needsOrder(R, cells, opts.yaki);
  if (need.includes('incomplete')) return { ok: false, err: 'yaki' }; // rules と cells は上で見た＝残るのは yaki の形だけ
  let order = opts.order;
  if (need.includes('tie') || need.includes('yaki')) {
    if (!okOrder(order, n)) return { ok: false, err: 'order' };
  } else if (order !== undefined && order !== null) {
    if (!okOrder(order, n)) return { ok: false, err: 'order' };
  } else {
    order = [...Array(n).keys()];
  }
  const pos = new Array(n);
  order.forEach((seat, i) => { pos[seat] = i; });

  const x = cells.map((v) => (R.hakoshita === true ? v : Math.max(v, 0)));
  const seats = [...Array(n).keys()].sort((a, b) => x[b] - x[a] || pos[a] - pos[b]);
  const groups = [];
  for (let i = 0; i < n;) {
    let j = i + 1;
    if (R.tie === 'split') while (j < n && x[seats[j]] === x[seats[i]]) j++;
    groups.push({ from: i, seats: seats.slice(i, j) });
    i = j;
  }
  const oka10 = (R.return_pts - R.start_pts) * n / 100;
  const uma = R.uma;
  const rank = new Array(n), pt10 = new Array(n);
  let others = 0;
  groups.forEach((g, gi) => {
    const k = g.seats.length;
    let bonus10 = 0;
    for (let r = g.from; r < g.from + k; r++) bonus10 += uma[r] * 10 + (r === 0 ? oka10 : 0);
    for (const s of g.seats) {
      rank[s] = g.from;
      if (gi === 0) continue;
      const num = ((x[s] - R.return_pts) / 100) * k + bonus10; // pt10 × k
      pt10[s] = roundPt10(num, k, R.round);
      others += pt10[s];
    }
  });
  const top = groups[0].seats.slice().sort((a, b) => pos[a] - pos[b]);
  const total = -others, k = top.length, base = Math.floor(total / k);
  let rem = total - base * k;
  for (const s of top) { pt10[s] = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  if (pt10.reduce((t, v) => t + v, 0) !== 0) throw new Error('半荘の pt の合計が 0 でない（計算の穴）');
  return { ok: true, pt10, rank };
}

export function tobiPt(rules, cells, opts = {}) {
  const R = okRules(rules);
  if (!R) return { ok: false, err: 'rules' };
  const n = R.players;
  if (!okCells(cells, n)) return { ok: false, err: 'cells' };
  const pt10 = new Array(n).fill(0);
  if (R.tobi !== true) return { ok: true, pt10, busted: [] };
  const busted = [];
  cells.forEach((v, s) => { if (v < 0 || (R.tobi_zero === true && v === 0)) busted.push(s); });
  const p = R.tobi_pt * 10;
  const to = opts.to || {};
  const pending = [], badTo = [];
  for (const b of busted) {
    const t = R.tobi_from === 'all' ? 'all' : to[b];
    if (t === undefined || t === null) { pending.push(b); continue; }
    if (t === 'all') {
      for (let s = 0; s < n; s++) if (s !== b) { pt10[s] += p; pt10[b] -= p; }
    } else if (isInt(t) && t >= 0 && t < n && t !== b) {
      pt10[t] += p; pt10[b] -= p;
    } else badTo.push(b);
  }
  if (badTo.length) return { ok: false, err: 'to', seats: badTo };
  if (pending.length) return { ok: false, err: 'pending', seats: pending };
  if (pt10.reduce((t, v) => t + v, 0) !== 0) throw new Error('飛び賞の合計が 0 でない（計算の穴）');
  return { ok: true, pt10, busted };
}
