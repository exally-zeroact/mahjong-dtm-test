/* hanchan-pt.test.mjs — ★lib/hanchan-pt.mjs が手で決めた答え（正解表）を出すか＋全部の形の総当たり★（CI）
 * 正解表は手で計算した値（下の注に式）。総当たりは別の作りの式（memory の台本 mahjong_tie3 と同じ・float と eps）と
 * 4人 split 五捨六入で素点の全部の形（100点単位・合計100000・0以上・高い順＝7,049,112 通り）を突き合わせる。
 * 使い方: node tests/hanchan-pt.test.mjs
 */
import { hanchanPt, tobiPt, roundPt10 } from '../lib/hanchan-pt.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const R4 = (o = {}) => ({ players: 4, ...o });
const R3 = (o = {}) => ({ players: 3, ...o });
const pt = (r, c, o) => hanchanPt(r, c, o);
const eqPt = (name, r, c, o, want) => { const g = pt(r, c, o); ok(`${name} ${J(c)} → ${J(want)}`, g.ok && J(g.pt10) === J(want), J(g)); };
const eqErr = (name, r, c, o, err) => { const g = pt(r, c, o); ok(`${name} → ${err}`, !g.ok && g.err === err, J(g)); };

console.log('■ 丸め（pt10 の有理数・絶対値）');
ok('gosha 12.5→12', roundPt10(125, 1, 'gosha') === 120);
ok('gosha 12.6→13', roundPt10(126, 1, 'gosha') === 130);
ok('gosha −12.5→−12', roundPt10(-125, 1, 'gosha') === -120);
ok('gosha −12.6→−13', roundPt10(-126, 1, 'gosha') === -130);
ok('shisha 12.5→13・−12.5→−13・12.4→12', roundPt10(125, 1, 'shisha') === 130 && roundPt10(-125, 1, 'shisha') === -130 && roundPt10(124, 1, 'shisha') === 120);
ok('kirisute 12.9→12・−12.9→−12', roundPt10(129, 1, 'kirisute') === 120 && roundPt10(-129, 1, 'kirisute') === -120);
ok('none −26.666…→−26.7', roundPt10(-800, 3, 'none') === -267);
ok('gosha −12.5666…（1/3 の端数 0.566…）→−13', roundPt10(-377, 3, 'gosha') === -130);
let threw = false; try { roundPt10(1, 1, 'x'); } catch { threw = true; }
ok('知らない round は throw', threw);

console.log('■ 4人・既定（25000持ち 30000返し・ウマ10-20・オカ20・五捨六入・同点は上家）');
// 2位 0+10・3位 −10−10・4位 −20−20・トップ＝逆の 50
eqPt('素直な形', R4(), [40000, 30000, 20000, 10000], {}, [500, 100, -200, -400]);
// 2位 2.5+10=12.5→12・3位 −12.4−10=−22.4→−22・4位 −15.5−20=−35.5→−35・トップ 45
eqPt('五捨六入（.5 は捨てる・負も）', R4(), [35400, 32500, 17600, 14500], {}, [450, 120, -220, -350]);
eqPt('四捨五入', R4({ round: 'shisha' }), [35400, 32500, 17600, 14500], {}, [450, 130, -220, -360]);
eqPt('切り捨て', R4({ round: 'kirisute' }), [35400, 32500, 17600, 14500], {}, [450, 120, -220, -350]);
eqPt('丸めない（0.1pt）', R4({ round: 'none' }), [35400, 32500, 17600, 14500], {}, [454, 125, -224, -355]);
// 2位 2.6+10=12.6→13・3位 −22.5→−22・4位 −35.5→−35・トップ 44
eqPt('五捨六入（.6 は上げる）', R4(), [35400, 32600, 17500, 14500], {}, [440, 130, -220, -350]);
eqPt('席の順が違っても同じ人に同じ pt', R4(), [10000, 40000, 20000, 30000], {}, [-400, 500, -200, 100]);

console.log('■ 同点（§5 の正解表）');
eqPt('上2人同点・分け（叩きの例）', R4({ tie: 'split' }), [35400, 35400, 15100, 14100], { order: [0, 1, 2, 3] }, [305, 305, -250, -360]);
eqPt('上2人同点・分け・起家が違っても割り切れるので同じ', R4({ tie: 'split' }), [35400, 35400, 15100, 14100], { order: [1, 0, 2, 3] }, [305, 305, -250, -360]);
// 上家取り：上家が1位 → 2位 5.4+10=15.4→15・トップ＝逆 46
eqPt('上2人同点・上家取り（席0が上家）', R4(), [35400, 35400, 15100, 14100], { order: [0, 1, 2, 3] }, [460, 150, -250, -360]);
eqPt('上2人同点・上家取り（席1が上家）', R4(), [35400, 35400, 15100, 14100], { order: [1, 0, 2, 3] }, [150, 460, -250, -360]);
eqPt('上3人同点・分け（余り 0.1 は上家から）', R4({ tie: 'split' }), [30000, 30000, 30000, 10000], { order: [0, 1, 2, 3] }, [134, 133, 133, -400]);
eqPt('上3人同点・分け・起家が席2', R4({ tie: 'split' }), [30000, 30000, 30000, 10000], { order: [2, 3, 0, 1] }, [133, 133, 134, -400]);
eqPt('4人同点・分け', R4({ tie: 'split' }), [25000, 25000, 25000, 25000], { order: [0, 1, 2, 3] }, [0, 0, 0, 0]);
// 4人同点・上家取り：order の順に 1〜4位 → 2位 −5+10=5・3位 −15・4位 −25・トップ 35
eqPt('4人同点・上家取り', R4(), [25000, 25000, 25000, 25000], { order: [3, 2, 1, 0] }, [-250, -150, 50, 350]);
// 下3人同点・分け：ウマ (10−10−20)/3＝−6.666…・各 −20−6.666…＝−26.666…→五捨六入 −27・トップ 81
eqPt('下3人同点・分け', R4({ tie: 'split' }), [70000, 10000, 10000, 10000], { order: [0, 1, 2, 3] }, [810, -270, -270, -270]);
eqPt('下3人同点・分け・丸めない', R4({ tie: 'split', round: 'none' }), [70000, 10000, 10000, 10000], { order: [0, 1, 2, 3] }, [801, -267, -267, -267]);
eqPt('下3人同点・分け・切り捨て', R4({ tie: 'split', round: 'kirisute' }), [70000, 10000, 10000, 10000], { order: [0, 1, 2, 3] }, [780, -260, -260, -260]);
// 下3人同点 24100：−5.9−6.666…＝−12.566…＝端数 0.566… は 0.5 を超える＝五捨六入でも上げて −13（決め：端数が 0.5 を超えたら上げる）
eqPt('1/3 の端数 0.566… は五捨六入で上げる', R4({ tie: 'split' }), [27700, 24100, 24100, 24100], { order: [0, 1, 2, 3] }, [390, -130, -130, -130]);
eqPt('下2人同点・分け（−15 ずつ）', R4({ tie: 'split' }), [45000, 35000, 10000, 10000], { order: [0, 1, 2, 3] }, [550, 150, -350, -350]);
eqErr('同点なのに起家からの順が無い', R4({ tie: 'split' }), [35400, 35400, 15100, 14100], {}, 'order');
eqErr('同点なのに順の形が違う', R4(), [35400, 35400, 15100, 14100], { order: [0, 0, 1, 2] }, 'order');

console.log('■ 箱下・素点の見張り');
// 箱下なし：−5000 は 0 で止める → 4位 −30−20＝−50・2位 10・3位 −15・トップ 55
eqPt('箱下なし（0 で止める）', R4(), [50000, 30000, 25000, -5000], {}, [550, 100, -150, -500]);
eqPt('箱下あり', R4({ hakoshita: true }), [50000, 30000, 25000, -5000], {}, [600, 100, -150, -550]);
eqPt('箱下なしで 0 に止めた2人は同点＝順が要る', R4(), [60000, 45000, -2000, -3000], { order: [0, 1, 2, 3] }, [650, 250, -400, -500]);
eqErr('箱下なしで 0 に止めた2人＝順が無ければ止める', R4(), [60000, 45000, -2000, -3000], {}, 'order');
eqErr('合計が合わない（打ち間違い）', R4(), [40000, 30000, 20000, 9000], {}, 'sum');
eqPt('消えた供託 1000 を入れれば合う', R4(), [40000, 30000, 20000, 9000], { lost: 1000 }, [510, 100, -200, -410]);
eqErr('100点単位でない', R4(), [40050, 30000, 20000, 9950], {}, 'cells');
eqErr('人数と長さが違う', R4(), [40000, 30000, 30000], {}, 'cells');
eqErr('ルールが通らない', { players: 5 }, [20000, 20000, 20000, 20000, 20000], {}, 'rules');
eqErr('消えた供託が負', R4(), [40000, 30000, 20000, 10000], { lost: -1000 }, 'lost');

console.log('■ 3人（35000持ち 40000返し・ウマ15-0-15・オカ15）');
// 2位 −5+0・3位 −20−15・トップ 40
eqPt('3人の素直な形', R3(), [50000, 35000, 20000], {}, [400, -50, -350]);
eqPt('3人・上2人同点・分け', R3({ tie: 'split' }), [45000, 45000, 15000], { order: [0, 1, 2] }, [200, 200, -400]);
// 3人全員同点・分け：others なし → 0
eqPt('3人全員同点・分け', R3({ tie: 'split' }), [35000, 35000, 35000], { order: [0, 1, 2] }, [0, 0, 0]);

console.log('■ 飛び賞');
const tb = (r, c, o) => tobiPt(r, c, o);
ok('飛んだ人の受け取りが決まるまで pending', J(tb(R4(), [50000, 30000, 25000, -5000], {})) === J({ ok: false, err: 'pending', seats: [3] }));
ok('受け取り1人', J(tb(R4(), [50000, 30000, 25000, -5000], { to: { 3: 0 } })) === J({ ok: true, pt10: [100, 0, 0, -100], busted: [3] }));
ok('「全員から」', J(tb(R4(), [50000, 30000, 25000, -5000], { to: { 3: 'all' } })) === J({ ok: true, pt10: [100, 100, 100, -300], busted: [3] }));
ok('tobi_from all は受け取りを選ばない', J(tb(R4({ tobi_from: 'all' }), [50000, 30000, 25000, -5000], {})) === J({ ok: true, pt10: [100, 100, 100, -300], busted: [3] }));
ok('0 ちょうどで飛び（tobi_zero）', J(tb(R4(), [50000, 30000, 20000, 0], { to: { 3: 1 } })) === J({ ok: true, pt10: [0, 100, 0, -100], busted: [3] }));
ok('0 ちょうどは飛ばない（tobi_zero false）', J(tb(R4({ tobi_zero: false }), [50000, 30000, 20000, 0], {})) === J({ ok: true, pt10: [0, 0, 0, 0], busted: [] }));
ok('2人同時に飛び（別々の受け取り）', J(tb(R4({ hakoshita: true }), [70000, 40000, -4000, -6000], { to: { 2: 0, 3: 1 } })) === J({ ok: true, pt10: [100, 100, -100, -100], busted: [2, 3] }));
ok('2人同時に飛び・片方だけ決まった', J(tb(R4({ hakoshita: true }), [70000, 40000, -4000, -6000], { to: { 2: 0 } })) === J({ ok: false, err: 'pending', seats: [3] }));
ok('自分を受け取りにできない', tb(R4(), [50000, 30000, 25000, -5000], { to: { 3: 3 } }).err === 'to');
ok('飛びなし（tobi false）', J(tb(R4({ tobi: false }), [50000, 30000, 25000, -5000], {})) === J({ ok: true, pt10: [0, 0, 0, 0], busted: [] }));
ok('飛び賞 0pt', J(tb(R4({ tobi_pt: 0 }), [50000, 30000, 25000, -5000], { to: { 3: 0 } })) === J({ ok: true, pt10: [0, 0, 0, 0], busted: [3] }));

console.log('■ 総当たり（4人・分け・五捨六入・素点の全部の形）＝別の作りの式と同じか・合計0・同点の差 0.1 以下');
const UMA = [20, 10, -10, -20], OKA = 20, KAESHI = 30000;
const r56 = (x) => { const a = Math.abs(x), fl = Math.floor(a), d = a - fl; return Math.sign(x) * (d > 0.5 + 1e-9 ? fl + 1 : fl); };
function other(raw) { // 台本 mahjong_tie3 と同じ（float・席0から上家・raw は高い順）
  const idx = [0, 1, 2, 3].sort((a, b) => raw[b] - raw[a] || a - b);
  const groups = []; for (let i = 0; i < 4;) { let j = i; while (j < 4 && raw[idx[j]] === raw[idx[i]]) j++; groups.push(idx.slice(i, j).map((s, k) => [s, i + k])); i = j; }
  const exact = {};
  for (const g of groups) { const um = g.reduce((t, [, r]) => t + UMA[r] + (r === 0 ? OKA : 0), 0) / g.length; for (const [s] of g) exact[s] = (raw[s] - KAESHI) / 1000 + um; }
  const top = groups[0].map(([s]) => s), out = {}; let others = 0;
  for (const s of [0, 1, 2, 3]) if (!top.includes(s)) { out[s] = Math.round(r56(exact[s]) * 10); others += out[s]; }
  const tot = -others, k = top.length, base = Math.floor(tot / k); let rem = tot - base * k;
  for (const s of top.slice().sort((a, b) => a - b)) { out[s] = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  return [0, 1, 2, 3].map((s) => out[s]);
}
const RS = R4({ tie: 'split' }), ORD = { order: [0, 1, 2, 3] };
let n = 0, diff = 0, sumBad = 0, tieBad = 0, firstDiff = null;
const t0 = Date.now();
for (let a = 0; a <= 1000; a++) for (let b = 0; b <= a; b++) for (let c = 0; c <= b; c++) {
  const d = 1000 - a - b - c; if (d < 0 || d > c) continue;
  const raw = [a * 100, b * 100, c * 100, d * 100];
  const g = hanchanPt(RS, raw, ORD); n++;
  if (!g.ok) { diff++; if (!firstDiff) firstDiff = [raw, g]; continue; }
  const w = other(raw);
  if (g.pt10[0] !== w[0] || g.pt10[1] !== w[1] || g.pt10[2] !== w[2] || g.pt10[3] !== w[3]) { diff++; if (!firstDiff) firstDiff = [raw, g.pt10, w]; }
  if (g.pt10[0] + g.pt10[1] + g.pt10[2] + g.pt10[3] !== 0) sumBad++;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (raw[i] === raw[j] && Math.abs(g.pt10[i] - g.pt10[j]) > 1) tieBad++;
}
console.log(`    （${n} 通り・${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
ok('形の数＝7,049,112', n === 7049112, String(n));
ok('別の作りの式と全部同じ', diff === 0, `${diff} 件違う・最初 ${J(firstDiff)}`);
ok('合計0 外れ 0', sumBad === 0, String(sumBad));
ok('同じ点の人どうしの差が 0.1pt を超えた形 0', tieBad === 0, String(tieBad));

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
