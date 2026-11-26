/* hanchan-pt.mjs — ★半荘の pt（素点→返し→ウマ→オカ→丸め）と飛び賞★（設計図 v18.3 §5・lib/rules.mjs の鍵の意味）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。pt は全部 0.1pt 単位の整数（pt10）で返す（小数の誤差を持ち込まない）。
 *
 * hanchanPt(rules, cells, { order, lost }) →
 *   { ok: true, pt10: [人ごと], rank: [人ごと・0 が1位・同点も順位は別々（上家が上）] }
 *   { ok: false, err } … err＝
 *     'rules'   … rules が lib/rules.mjs の rulesOk を通らない
 *     'cells'   … cells が長さ players の整数の並びでない・100点単位でない
 *     'lost'    … 消えた供託が 0 以上の100点単位の整数でない
 *     'sum'     … ★素点の見張り★＝素点の合計 ≠ 持ち点×人数−消えた供託（打ち間違い・供託の抜け＝止めて直させる）
 *                  箱下なし（hakoshita false）でも、見張りは打ったままの数（0 で止める前）で比べる＝「足し戻して比べる」
 *     'order'   … 起家からの順（ton_order）が要る半荘（lib/needs-order.mjs が 'tie'）なのに order が無い・形が違う
 *   order＝起家からの席の並び（[2,0,1,3] なら席2が起家）。同点の上家に使う（画面の［上家］の印の順＝11-23 司さん）。
 *   lost＝終局で消えた供託の点（kyotaku_end 'kieru' の時の 1000×本数・既定 0）。
 *
 * ★段の決め（§5）★
 *   1. 箱下なし（hakoshita が true でない）は 0 未満を 0 にして順位と pt に使う。
 *   2. 順位：素点の高い順。同点は★いつも★ order の早い人が上（A13・11-23 司さん「ルールの上家取りを消す」＝分けるは無い）。
 *      鍵 tie は読まない（古い写しの "kamicha" を通すために rules の鍵としては残る・倉庫に split の写しは 0＝11-23 測った）。
 *   3. 人ごとの丸める前の値＝(素点−返し)/1000 ＋ その順位のウマ（オカ (返し−持ち点)×人数/1000 はトップだけ＝5 の逆で入る）。
 *   4. 丸めは★トップ以外★に1人ずつ同じ式。どれも★絶対値に当てて符号を戻す★：
 *        gosha 五捨六入＝端数が 0.5 を超えたら上げ（0.1pt 刻みなら 0.6 以上）
 *        shisha 四捨五入＝0.5 以上で上げ／kirisute＝切り捨て／none＝丸めない（0.1pt のまま）
 *   5. トップ（1位の1人）＝他の人の合計の逆＝★合計は作りから必ず 0★（外れたら計算の穴＝ok:false にせず throw で止める）。
 *
 * tobiPt(rules, cells, { to }) → 飛び賞（やり取りの段・丸めない・分けない）＝E1（A19・e_sadame v2 §E1 4-6）
 *   { ok: true, pt10: [人ごと], busted: [飛んだ席] } ／ { ok: false, err: 'rules'|'cells'|'to' }
 *   飛び＝tobi true の時、素点 < 0（tobi_zero なら 0 ちょうども）。tobi_pt は pt（×10 で pt10）。
 *   tobi_from 'all'＝飛んだ人が他の全員に tobi_pt ずつ（to は読まない）。
 *   他（'busted'）＝to が {r:[押した席・昇順・重なり無し]} の時、飛んだ人 b は押した席 r（r≠b）の1人ずつに tobi_pt ずつ払う
 *     （押した飛んだ人は他の押した人へ払い、他の飛んだ人から受け取る・合計0）。
 *   押していない（to が無い・{}・古い鍵の形 {'3':0}）＝0（★待たない・pending は無い★）。r の形が違う＝err 'to'。
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

  const need = needsOrder(R, cells);
  let order = opts.order;
  if (need.includes('tie')) {
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
  const oka10 = (R.return_pts - R.start_pts) * n / 100;
  const rank = new Array(n), pt10 = new Array(n);
  let others = 0;
  seats.forEach((s, r) => {
    rank[s] = r;
    if (r === 0) return;
    pt10[s] = roundPt10((x[s] - R.return_pts) / 100 + R.uma[r] * 10, 1, R.round);
    others += pt10[s];
  });
  pt10[seats[0]] = -others;
  if (pt10.reduce((t, v) => t + v, 0) !== 0) throw new Error('半荘の pt の合計が 0 でない（計算の穴）');
  return { ok: true, pt10, rank };
}

/* E1：押した席の形＝配列・各が 0〜n−1 の整数・昇順で重なり無し（空も可＝押していない） */
export const tobiROk = (r, n) => Array.isArray(r) && r.every((v, i) => isInt(v) && v >= 0 && v < n && (i === 0 || v > r[i - 1]));

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
  if (R.tobi_from === 'all') {
    for (const b of busted) for (let s = 0; s < n; s++) if (s !== b) { pt10[s] += p; pt10[b] -= p; }
  } else {
    const to = opts.to;
    const r = to !== null && typeof to === 'object' && !Array.isArray(to) && Object.prototype.hasOwnProperty.call(to, 'r') ? to.r : undefined;
    if (r !== undefined) {
      if (!tobiROk(r, n)) return { ok: false, err: 'to' };
      for (const b of busted) for (const s of r) if (s !== b) { pt10[s] += p; pt10[b] -= p; }
    }
  }
  if (pt10.reduce((t, v) => t + v, 0) !== 0) throw new Error('飛び賞の合計が 0 でない（計算の穴）');
  return { ok: true, pt10, busted };
}
