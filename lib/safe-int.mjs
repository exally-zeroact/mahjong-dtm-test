/* A18（a18_sadame v5 §2）お金の守り＝整数の掛け・足しは、途中の答えが全部 Number.isSafeInteger の間だけ正確。
 * mulS・addS＝どちらかが null か、答えが safe でなければ null（null は持ち回す＝0 として足さない）。
 * addK＝入れ物への足し（鍵が無い時だけ v・在れば addS）。sumS＝addS の reduce。 */
export const M = 2000000000; // 機械の限界＝倉庫 mj_w_int・lib wInt と同じ ±20億（点数の上限はこれだけ）
const safe = (x) => Number.isSafeInteger(x);
export function mulS(a, b) {
  if (a === null || b === null || !safe(a) || !safe(b)) return null;
  const x = a * b;
  return safe(x) ? x : null;
}
export function addS(a, b) {
  if (a === null || b === null || !safe(a) || !safe(b)) return null;
  const x = a + b;
  return safe(x) ? x : null;
}
export function addK(m, k, v) { m[k] = m[k] === undefined ? v : addS(m[k], v); }
export const sumS = (a) => a.reduce((t, v) => addS(t, v), 0);
