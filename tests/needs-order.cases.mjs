/* needs-order.cases.mjs — ★needsOrder と mj_needs_order に通す入力の表と、手で決めた答え★
 * needs-order.test.mjs（CI＝lib に当てる）と needs-order.live.mjs（手元＝倉庫と lib に同じ字を通す）が同じ表を使う。
 * r＝rules の JSON の字・c＝cells の JSON の字・want＝答え（理由の並び）。
 */
const R4 = '{"players":4}', R3 = '{"players":3}';
const H4 = '{"players":4,"hakoshita":true}', H3 = '{"players":3,"hakoshita":true}', N4 = '{"players":4,"hakoshita":false}';
export const CASES = [
  // 同点なし
  { r: R4, c: '[40000,30000,20000,10000]', want: [] },
  { r: R4, c: '[25000,25100,24900,25000]', want: ['tie'] },
  { r: R3, c: '[50000,35000,20000]', want: [] },
  // 上2人・下2人・3人・4人の同点
  { r: R4, c: '[35400,35400,15100,14100]', want: ['tie'] },
  { r: R4, c: '[40000,30000,15000,15000]', want: ['tie'] },
  { r: R4, c: '[30000,30000,30000,10000]', want: ['tie'] },
  { r: R4, c: '[25000,25000,25000,25000]', want: ['tie'] },
  { r: R3, c: '[35000,35000,35000]', want: ['tie'] },
  { r: R3, c: '[52500,52500,0]', want: ['tie'] },
  // 箱下なし（既定・鍵なし・false）＝0未満を0で比べる
  { r: R4, c: '[70000,33500,-3000,-500]', want: ['tie'] },
  { r: N4, c: '[70000,33500,-3000,-500]', want: ['tie'] },
  { r: R4, c: '[60000,40100,0,-100]', want: ['tie'] },
  { r: R3, c: '[80000,25100,-100]', want: [] },
  // 箱下あり＝素点のまま
  { r: H4, c: '[70000,33500,-3000,-500]', want: [] },
  { r: H4, c: '[60000,40100,0,-100]', want: [] },
  { r: H4, c: '[70000,32000,-1000,-1000]', want: ['tie'] },
  { r: H3, c: '[80000,25100,-100]', want: [] },
  // 鍵の形が違う hakoshita（真偽の true だけを箱下ありと見る）
  { r: '{"players":4,"hakoshita":"true"}', c: '[70000,33500,-3000,-500]', want: ['tie'] },
  { r: '{"players":4,"hakoshita":1}', c: '[70000,33500,-3000,-500]', want: ['tie'] },
  { r: '{"players":4,"hakoshita":null}', c: '[70000,33500,-3000,-500]', want: ['tie'] },
  // 数の字の形（4.0・35000.0・1e4 は整数）
  { r: '{"players":4.0}', c: '[40000,30000,20000,10000]', want: [] },
  { r: R4, c: '[35000.0,35000,20000,10000]', want: ['tie'] },
  { r: R3, c: '[1e4,1e4,85000]', want: ['tie'] },
  // 形になっていない＝incomplete（止める側）
  { r: R4, c: '[40000,30000,30000]', want: ['incomplete'] },
  { r: R3, c: '[40000,30000,20000,15000]', want: ['incomplete'] },
  { r: R4, c: '[40000,30000,null,10000]', want: ['incomplete'] },
  { r: R4, c: '[40000,30000,"20000",10000]', want: ['incomplete'] },
  { r: R4, c: '[40000,30000,20000.5,9999.5]', want: ['incomplete'] },
  { r: R4, c: '[]', want: ['incomplete'] },
  { r: R4, c: 'null', want: ['incomplete'] },
  { r: R4, c: '{"0":1}', want: ['incomplete'] },
  { r: '{}', c: '[1,2,3,4]', want: ['incomplete'] },
  { r: '{"players":"4"}', c: '[1,2,3,4]', want: ['incomplete'] },
  { r: '{"players":5}', c: '[1,2,3,4,5]', want: ['incomplete'] },
  { r: '[]', c: '[1,2,3,4]', want: ['incomplete'] },
  // 同点と形の崩れが混ざる＝形が先（naoshi 任意）
  { r: R4, c: '[1,1,"x",4]', want: ['incomplete'] },
  { r: R4, c: '[5,5,null,1]', want: ['incomplete'] },
  { r: 'null', c: '[1,2,3,4]', want: ['incomplete'] },
  // 飛び賞・チョンボの鍵は答えを変えない（v15.9）
  { r: '{"players":4,"tobi_from":"all","tobi_pt":10}', c: '[60000,45000,0,-5000]', want: ['tie'] },
  { r: '{"players":4,"tobi_from":"all","tobi_pt":10,"hakoshita":true}', c: '[60000,45000,0,-5000]', want: [] },
  { r: '{"players":4,"chombo":"pt","chombo_pt":20}', c: '[40000,30000,20000,10000]', want: [] },
];
