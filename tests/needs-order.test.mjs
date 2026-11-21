/* needs-order.test.mjs — ★lib/needs-order.mjs が手で決めた答えを出すか★（CI）
 * 表は tests/needs-order.cases.mjs（倉庫の mj_needs_order と同じかは needs-order.live.mjs＝手元）。
 * 使い方: node tests/needs-order.test.mjs
 */
import { needsOrder } from '../lib/needs-order.mjs';
import { CASES } from './needs-order.cases.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
ok('表が30件以上', CASES.length >= 30, `${CASES.length} 件`);
for (const k of CASES) {
  const got = needsOrder(JSON.parse(k.r), JSON.parse(k.c));
  ok(`${k.r} ${k.c} → ${JSON.stringify(k.want)}`, JSON.stringify(got) === JSON.stringify(k.want), `出た ${JSON.stringify(got)}`);
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
