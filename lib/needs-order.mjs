/* needs-order.mjs — ★起家からの順（hanchans.ton_order）が要る半荘か★（設計図 v15.9 §3・案 needs_order_sekkei.md）
 * =============================================================================
 * 倉庫の mahjong_private.mj_needs_order と同じ答え（tests/needs-order.live.mjs が同じ入力の表を両方に通す）。
 * ★倉庫の答えが正★＝ここは画面の先回り。
 *
 * needsOrder(rules, cells) → 理由の並び（決まった順）
 *   []              ＝順は要らない
 *   ['tie']         ＝同じ素点の人が2人以上（上家取り・同点を分けた時の 0.1pt の余り）。
 *                     ★箱下なし（hakoshita が true でない＝鍵が無くても箱下なし）は 0 未満を 0 にしてから比べる★
 *   ['incomplete']  ＝入力が形になっていない（rules が object でない・players が 3/4 でない・cells が長さ players の
 *                     整数の並びでない）＝★止める側＝順がそろったとは見ない★
 * 飛び賞は分けない（受け取り1人か「全員から」＝他の全員に tobi_pt ずつ）・チョンボの pt の罰は半荘の計算に入れない
 * ＝今のデータで上家が要るのは tie だけ。分ける形を足す日はここと倉庫に理由を足す（決まった順の後ろへ）。
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function needsOrder(rules, cells) {
  if (!isObj(rules)) return ['incomplete'];
  const n = rules.players;
  if (n !== 3 && n !== 4) return ['incomplete'];
  if (!Array.isArray(cells) || cells.length !== n) return ['incomplete'];
  if (!cells.every((v) => typeof v === 'number' && Number.isInteger(v))) return ['incomplete'];
  const hako = rules.hakoshita === true;
  const seen = new Set();
  for (const v of cells) {
    const x = hako ? v : Math.max(v, 0);
    if (seen.has(x)) return ['tie'];
    seen.add(x);
  }
  return [];
}
