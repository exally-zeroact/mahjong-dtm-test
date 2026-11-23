/* needs-order.mjs — ★起家からの順（hanchans.ton_order）が要る半荘か★（設計図 v15.9 §3・案 needs_order_sekkei.md）
 * =============================================================================
 * 倉庫の mahjong_private.mj_needs_order と同じ答え（tests/needs-order.live.mjs が同じ入力の表を両方に通す）。
 * ★倉庫の答えが正★＝ここは画面の先回り。
 *
 * needsOrder(rules, cells) → 理由の並び（決まった順）
 *   []              ＝順は要らない
 *   ['tie']         ＝同じ素点の人が2人以上（上家取り＝A13 で同点はいつも［上家］の印の順）。
 *                     ★箱下なし（hakoshita が true でない＝鍵が無くても箱下なし）は 0 未満を 0 にしてから比べる★
 *   ['incomplete']  ＝入力が形になっていない（rules が object でない・players が 3/4 でない・cells が長さ players の
 *                     整数の並びでない）＝★止める側＝順がそろったとは見ない★
 * 飛び賞は分けない（受け取り1人か「全員から」＝他の全員に tobi_pt ずつ）・チョンボの pt の罰は半荘の計算に入れない
 * ＝今のデータで上家が要るのは tie だけ。順が要る形を足す日はここと倉庫に理由を足す（決まった順の後ろへ）。
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

/* orderCovered(rules, cells, tonOrder, orderCells) → 今の同点の組を、保存された ton_order が覆っているか（A13 a13g_sadame v3.2 §6）
 * 倉庫の mahjong_private.mj_order_covered と同じ答え（tests/needs-order.live.mjs が同じ表を両方に通す）。
 *   tonOrder が null／undefined          → false（今まで通り＝印が無い）
 *   orderCells が null／undefined        → true（この直しの前に書いた行＝古い画面は本当の席順を書いた）
 *   orderCells の形が壊れている          → false（★覆っているとは見ない★）
 *   それ以外＝今の cells の同点の組（x が同じ2人以上）ごとに、orderCells での x がその組で1つにそろっていれば覆っている。
 *   x＝箱下あり（hakoshita === true）はそのまま・なしは 0 未満を 0（needsOrder と同じ）。
 * 保存した人が見ていない新しい同点（2台が別の点を直して出来た組）は覆わない＝'tie' が要る（警告が出る・合計に入れない）。 */
export function orderCovered(rules, cells, tonOrder, orderCells) {
  if (tonOrder === null || tonOrder === undefined) return false;
  if (orderCells === null || orderCells === undefined) return true;
  if (!isObj(rules) || !Array.isArray(cells)) return false;
  const n = cells.length;
  if (!Array.isArray(orderCells) || orderCells.length !== n || !orderCells.every((v) => typeof v === 'number' && Number.isInteger(v))) return false;
  const hako = rules.hakoshita === true;
  const X = (v) => (hako ? v : Math.max(v, 0));
  const groups = new Map();
  cells.forEach((v, i) => { const k = X(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const x0 = X(orderCells[g[0]]);
    if (!g.every((i) => X(orderCells[i]) === x0)) return false;
  }
  return true;
}
