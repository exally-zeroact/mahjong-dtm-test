/* needs-order.mjs — ★起家からの順（hanchans.ton_order）が要る半荘か★（設計図 v15.9 §3・案 needs_order_sekkei.md）
 * =============================================================================
 * 倉庫の mahjong_private.mj_needs_order と同じ答え（tests/needs-order.live.mjs が同じ入力の表を両方に通す）。
 * ★倉庫の答えが正★＝ここは画面の先回り。
 *
 * needsOrder(rules, cells, yaki) → 理由の並び（決まった順＝tie → yaki）
 *   yaki＝その半荘のやきとりの席の並び（hanchans.yakitori・昇順・重なり無し・0〜players−1）。undefined／null＝[]（今までの答えと同じ）
 *   []              ＝順は要らない
 *   ['tie']         ＝同じ素点の人が2人以上（上家取り・同点を分けた時の 0.1pt の余り）。
 *                     ★箱下なし（hakoshita が true でない＝鍵が無くても箱下なし）は 0 未満を 0 にしてから比べる★
 *   ['yaki']        ＝やきとりを分ける端数に上家が要る（2c-3c・write3_sekkei.md v1.1 S1・司さん「端数は上家から」）＝
 *                     rules.yakitori が true・yakitori_to が 'split'・やきとりの人 Y が1人以上・そうでない人 N が1人以上・
 *                     (yakitori_pt×10) % |N| ≠ 0。'top' は足さない（1位の同点は tie が既に順を求める）。tie と両方なら ['tie','yaki']
 *   ['incomplete']  ＝入力が形になっていない（rules が object でない・players が 3/4 でない・cells が長さ players の
 *                     整数の並びでない・yaki が並びの形でない）＝★止める側＝順がそろったとは見ない★
 * 飛び賞は分けない（受け取り1人か「全員から」＝他の全員に tobi_pt ずつ）・チョンボの pt の罰は半荘の計算に入れない
 * ＝上家が要るのは tie とやきとりの split の端数（yaki・2c-3c）。分ける形を足す日はここと倉庫に理由を足す（決まった順の後ろへ）。
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function needsOrder(rules, cells, yaki) {
  if (!isObj(rules)) return ['incomplete'];
  const n = rules.players;
  if (n !== 3 && n !== 4) return ['incomplete'];
  if (!Array.isArray(cells) || cells.length !== n) return ['incomplete'];
  if (!cells.every((v) => typeof v === 'number' && Number.isInteger(v))) return ['incomplete'];
  const Y = yaki === undefined || yaki === null ? [] : yaki;
  if (!Array.isArray(Y) || !Y.every((v, i) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n && (i === 0 || v > Y[i - 1]))) return ['incomplete'];
  const hako = rules.hakoshita === true;
  const seen = new Set();
  let tie = false;
  for (const v of cells) {
    const x = hako ? v : Math.max(v, 0);
    if (seen.has(x)) { tie = true; break; }
    seen.add(x);
  }
  const N = n - Y.length;
  const pt = rules.yakitori_pt;
  const yk = rules.yakitori === true && rules.yakitori_to === 'split' && Y.length >= 1 && N >= 1
    && typeof pt === 'number' && Number.isInteger(pt) && (pt * 10) % N !== 0;
  return [...(tie ? ['tie'] : []), ...(yk ? ['yaki'] : [])];
}
