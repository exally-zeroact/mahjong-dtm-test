/* needs-order.cases.mjs — ★needsOrder と mj_needs_order に通す入力の表と、手で決めた答え★
 * needs-order.test.mjs（CI＝lib に当てる）と needs-order.live.mjs（手元＝倉庫と lib に同じ字を通す）が同じ表を使う。
 * r＝rules の JSON の字・c＝cells の JSON の字・y＝やきとりの席の JSON の字（無い＝渡さない＝[] と同じ・2c-3c）・want＝答え（理由の並び）。
 */
const R4 = '{"players":4}', R3 = '{"players":3}';
const YS4 = '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":10}';
const C4 = '[40000,30000,20000,10000]', C3 = '[50000,35000,20000]';
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
  // やきとり（2c-3c・write3_sekkei.md v1.1 S1）＝split で (yakitori_pt×10) % |N| ≠ 0 の時だけ yaki（N＝やきとりでない人）
  { r: YS4, c: C4, y: '[0]', want: ['yaki'] },
  { r: YS4, c: C4, y: '[0,2]', want: [] },
  { r: YS4, c: C4, y: '[0,1,2]', want: [] },
  { r: YS4, c: C4, y: '[0,1,2,3]', want: [] },
  { r: YS4, c: C4, y: '[]', want: [] },
  { r: YS4, c: C4, y: 'null', want: [] },
  { r: YS4, c: C4, want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":5}', c: C4, y: '[3]', want: ['yaki'] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":6}', c: C4, y: '[3]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":0}', c: C4, y: '[3]', want: [] },
  { r: '{"players":3,"yakitori":true,"yakitori_to":"split","yakitori_pt":5}', c: C3, y: '[1]', want: [] },
  { r: '{"players":3,"yakitori":true,"yakitori_to":"split","yakitori_pt":5}', c: C3, y: '[0,2]', want: [] },
  // split でない・使わない・pt の形が違う＝yaki は立たない
  { r: '{"players":4,"yakitori":true,"yakitori_to":"each","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":false,"yakitori_to":"split","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":"true","yakitori_to":"split","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori_to":"split","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":"10"}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split","yakitori_pt":10.5}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"split"}', c: C4, y: '[0]', want: [] },
  // top は足さない（1位の同点は tie が既に順を求める・others／all のどちらでも＝注意3）
  { r: '{"players":4,"yakitori":true,"yakitori_to":"top","yakitori_top_tie":"others","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"top","yakitori_top_tie":"others","yakitori_pt":10}', c: '[35000,35000,20000,10000]', y: '[3]', want: ['tie'] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"top","yakitori_top_tie":"all","yakitori_pt":10}', c: C4, y: '[0]', want: [] },
  { r: '{"players":4,"yakitori":true,"yakitori_to":"top","yakitori_top_tie":"all","yakitori_pt":10}', c: '[30000,30000,30000,10000]', y: '[0]', want: ['tie'] },
  // tie と yaki は両方（決まった順＝tie → yaki）
  { r: YS4, c: '[35000,35000,20000,10000]', y: '[0]', want: ['tie', 'yaki'] },
  { r: '{"players":4,"hakoshita":true,"yakitori":true,"yakitori_to":"split","yakitori_pt":10}', c: '[70000,33500,-3000,-500]', y: '[2]', want: ['yaki'] },
  // やきとりの席の形が違う＝incomplete（止める側）
  { r: YS4, c: C4, y: '[4]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[-1]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[1,1]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[2,1]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '["1"]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[1.5]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[null]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '{"0":1}', want: ['incomplete'] },
  { r: YS4, c: C4, y: '"0"', want: ['incomplete'] },
  { r: R3, c: C3, y: '[3]', want: ['incomplete'] },
  { r: R4, c: C4, y: '[0,1,2,3,0]', want: ['incomplete'] },
  // 使わない部屋でも席の形は見る（形が先）・数の字の形 1.0 は整数
  { r: R4, c: C4, y: '[2,1]', want: ['incomplete'] },
  { r: YS4, c: C4, y: '[1.0]', want: ['yaki'] },
  { r: R4, c: '[40000,30000,30000]', y: '[0]', want: ['incomplete'] },
];
