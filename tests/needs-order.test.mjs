/* needs-order.test.mjs — ★lib/needs-order.mjs が手で決めた答えを出すか★（CI）
 * 表は tests/needs-order.cases.mjs（倉庫の mj_needs_order と同じかは needs-order.live.mjs＝手元）。
 * 使い方: node tests/needs-order.test.mjs
 */
import { needsOrder, orderCovered } from '../lib/needs-order.mjs';
import { CASES, COVER_CASES } from './needs-order.cases.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
ok('表が30件以上', CASES.length >= 30, `${CASES.length} 件`);
for (const k of CASES) {
  const got = needsOrder(JSON.parse(k.r), JSON.parse(k.c));
  ok(`${k.r} ${k.c} → ${JSON.stringify(k.want)}`, JSON.stringify(got) === JSON.stringify(k.want), `出た ${JSON.stringify(got)}`);
}
// A13 §6：覆いの表（倉庫の mj_order_covered と同じかは needs-order.live.mjs）
ok('覆いの表が15件以上', COVER_CASES.length >= 15, `${COVER_CASES.length} 件`);
for (const k of COVER_CASES) {
  const got = orderCovered(JSON.parse(k.r), JSON.parse(k.c), JSON.parse(k.t), JSON.parse(k.oc));
  ok(`覆い ${k.r} ${k.c} ton ${k.t} oc ${k.oc} → ${k.want}`, got === k.want, `出た ${got}`);
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
