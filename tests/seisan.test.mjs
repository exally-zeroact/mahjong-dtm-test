/* seisan.test.mjs — ★lib/seisan.mjs が手で決めた答え（正解表）を出すか＋乱数の卓で合計0と払う回数★（CI）
 * 使い方: node tests/seisan.test.mjs
 */
import { seisan, payList } from '../lib/seisan.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const sum = (a) => a.reduce((t, v) => t + v, 0);

console.log('■ 1卓・レートあり（1pt＝100点）');
{
  // A=50.0+30.5=80.5・B=10.0+30.5=40.5・C=−20−25=−45・D=−40−36=−76
  const t = { rate: 100, chip_pt10: null, shugi_pt10: null, hanchans: [
    { members: ['A', 'B', 'C', 'D'], pt10: [500, 100, -200, -400] },
    { members: ['A', 'B', 'C', 'D'], pt10: [305, 305, -250, -360] },
  ] };
  const g = seisan([t]);
  ok('pt10 の合計', g.ok && J(sortKeys(g.pt10)) === J({ A: 805, B: 405, C: -450, D: -760 }), J(g));
  ok('点＝pt10×rate÷10', g.ok && J(sortKeys(g.ten)) === J({ A: 8050, B: 4050, C: -4500, D: -7600 }), J(g));
  // 払う人の大きい順（D 7600・C 4500）×受け取る人の大きい順（A 8050・B 4050）
  ok('誰が誰に（3回まで）', g.ok && J(g.pay) === J([{ from: 'D', to: 'A', ten: 7600 }, { from: 'C', to: 'A', ten: 450 }, { from: 'C', to: 'B', ten: 4050 }]), J(g.pay));
  ok('レートの無い卓は無い', g.ok && J(g.pt10NoRate) === '{}');
}

console.log('■ チップ・祝儀・飛び賞');
{
  // A=50+10(飛び 1枚×10pt)+2枚×5pt=70・B=10+1×5=15−祝儀1×3=12・C=−20−3×5=−35+祝儀1×3=−32・D=−40−10(飛び −1枚)=−50
  // B2：飛び賞は卓の tobis（チップと同じ ±・合計0）。半荘は飛び賞を持たない
  const t = { rate: 50, chip_pt10: 50, shugi_pt10: 30, tobi_pt10: 100, hanchans: [
    { members: ['A', 'B', 'C', 'D'], pt10: [500, 100, -200, -400] },
  ], chips: { A: 2, B: 1, C: -3, D: 0 }, shugis: { B: -1, C: 1 }, tobis: { A: 1, D: -1 } };
  const g = seisan([t]);
  ok('チップ・祝儀・飛び賞を pt10 に足す', g.ok && J(sortKeys(g.pt10)) === J({ A: 700, B: 120, C: -320, D: -500 }), J(g));
  ok('点（1pt＝50点）', g.ok && J(sortKeys(g.ten)) === J({ A: 3500, B: 600, C: -1600, D: -2500 }), J(g));
}

console.log('■ レートの無い卓は点に混ぜない');
{
  const g = seisan([
    { rate: 100, hanchans: [{ members: ['A', 'B', 'C', 'D'], pt10: [500, 100, -200, -400] }] },
    { rate: null, hanchans: [{ members: ['A', 'E', 'F', 'G'], pt10: [-400, 500, 100, -200] }] },
  ]);
  ok('pt10 は両方の卓', g.ok && J(sortKeys(g.pt10)) === J({ A: 100, B: 100, C: -200, D: -400, E: 500, F: 100, G: -200 }), J(g));
  ok('点はレートのある卓だけ', g.ok && J(sortKeys(g.ten)) === J({ A: 5000, B: 1000, C: -2000, D: -4000 }), J(g));
  ok('レートの無い卓は pt で別に', g.ok && J(sortKeys(g.pt10NoRate)) === J({ A: -400, E: 500, F: 100, G: -200 }), J(g));
}

console.log('■ 止める形');
const err = (name, tables, want) => { const g = seisan(tables); ok(`${name} → ${want}`, !g.ok && g.err === want, J(g)); };
const H = (pt10, tobi10) => ({ members: ['A', 'B', 'C', 'D'], pt10, ...(tobi10 ? { tobi10 } : {}) });
err('半荘の pt の合計が0でない', [{ rate: 100, hanchans: [H([500, 100, -200, -300])] }], 'hanchan_sum');
err('B2：半荘に tobi10 の鍵が在る（もう持たない）', [{ rate: 100, hanchans: [H([500, 100, -200, -400], [100, 0, 0, -100])] }], 'hanchan');
err('B2：飛び賞の枚の合計が0でない（卓）', [{ rate: 100, tobi_pt10: 100, hanchans: [H([500, 100, -200, -400])], tobis: { A: 1, D: -2 } }], 'tobi_tsum');
err('B2：飛び賞を使わない卓に枚', [{ rate: 100, tobi_pt10: null, hanchans: [H([500, 100, -200, -400])], tobis: { A: 1, D: -1 } }], 'tobi_off');
err('B2：tobi_pt10 が小数', [{ rate: 100, tobi_pt10: 10.5, hanchans: [H([500, 100, -200, -400])] }], 'table');
err('B2：tobis の枚が小数', [{ rate: 100, tobi_pt10: 100, hanchans: [H([500, 100, -200, -400])], tobis: { A: 0.5, D: -0.5 } }], 'table');
ok('B2：前の半荘の tobi_sum はもう出ない（どの壊れた卓でも）', ['tobi_sum'].every((e) => ![
  [{ rate: 100, hanchans: [H([500, 100, -200, -400], [100, 0, 0, 0])] }],
  [{ rate: 100, tobi_pt10: 100, hanchans: [H([500, 100, -200, -400])], tobis: { A: 1 } }],
].some((ts) => seisan(ts).err === e)));
err('チップの合計が0でない（トップで吸わない）', [{ rate: 100, chip_pt10: 50, hanchans: [H([500, 100, -200, -400])], chips: { A: 2, B: -1 } }], 'chip_sum');
err('祝儀の合計が0でない', [{ rate: 100, shugi_pt10: 30, hanchans: [H([500, 100, -200, -400])], shugis: { A: 1 } }], 'shugi_sum');
err('チップを使わない卓に枚', [{ rate: 100, chip_pt10: null, hanchans: [H([500, 100, -200, -400])], chips: { A: 1, B: -1 } }], 'chip_off');
err('レートが10の倍数でない', [{ rate: 105, hanchans: [H([500, 100, -200, -400])] }], 'table');
err('同じ人が2席', [{ rate: 100, hanchans: [{ members: ['A', 'A', 'C', 'D'], pt10: [500, 100, -200, -400] }] }], 'hanchan');
err('pt10 が小数', [{ rate: 100, hanchans: [H([50.5, 100, -200, 49.5])] }], 'hanchan');
err('並びでない', 'x', 'table');
ok('卓が0', J(seisan([])) === J({ ok: true, pt10: {}, ten: {}, pt10NoRate: {}, pay: [], out: {}, outPt10NoRate: {} }));

console.log('■ ③-2 やきとり・合計0の自由な項目・外へ払う種（場代）');
{
  // A=+50.0・B=+10.0・C=−20.0・D=−40.0 の半荘1つ。やきとり 1枚 2pt（20）：A+1 D−1／コイン 1枚 0.5pt（5）：B+4 C−4／場代 1枚 1pt（10）：A1 B2
  const base = { rate: 100, hanchans: [H([500, 100, -200, -400])] };
  const g = seisan([{ ...base, yaki_pt10: 20, yakis: { A: 1, D: -1 }, customs: [{ pt10: 5, counts: { B: 4, C: -4 } }], outs: [{ pt10: 10, counts: { A: 1, B: 2 } }] }]);
  ok('pt10＝半荘＋やきとり＋コイン（場代は入れない）', g.ok && J(sortKeys(g.pt10)) === J({ A: 520, B: 120, C: -220, D: -420 }), J(g));
  ok('ten＝pt10×100÷10（場代は入れない）', g.ok && J(sortKeys(g.ten)) === J({ A: 5200, B: 1200, C: -2200, D: -4200 }));
  ok('out＝場代の点（A 1枚×1pt×100＝100・B 200）・outPt10NoRate は空', g.ok && J(sortKeys(g.out)) === J({ A: 100, B: 200 }) && J(g.outPt10NoRate) === '{}');
  ok('払いは ten だけから（場代は混ぜない）', g.ok && sum(g.pay.map((x) => x.ten)) === 6400);
  const n = seisan([{ ...base, rate: null, outs: [{ pt10: 10, counts: { A: 3 } }] }]);
  ok('レートの無い卓の場代＝outPt10NoRate に pt10（30）・out は空', n.ok && J(n.outPt10NoRate) === J({ A: 30 }) && J(n.out) === '{}' && J(n.ten) === '{}');
  ok('場代の 0 枚の行は出さない', J(seisan([{ ...base, outs: [{ pt10: 10, counts: { A: 0 } }] }]).out) === '{}');
}
err('やきとりの合計が0でない', [{ rate: 100, yaki_pt10: 20, hanchans: [H([500, 100, -200, -400])], yakis: { A: 1 } }], 'yaki_sum');
err('やきとりを使わない卓に枚', [{ rate: 100, yaki_pt10: null, hanchans: [H([500, 100, -200, -400])], yakis: { A: 1, B: -1 } }], 'yaki_off');
err('合計0の自由な項目の合計が0でない', [{ rate: 100, hanchans: [H([500, 100, -200, -400])], customs: [{ pt10: 5, counts: { A: 2, B: -1 } }] }], 'cust_sum');
err('場代の枚が負', [{ rate: 100, hanchans: [H([500, 100, -200, -400])], outs: [{ pt10: 10, counts: { A: -1 } }] }], 'out_neg');
err('場代の pt10 が整数でない', [{ rate: 100, hanchans: [H([500, 100, -200, -400])], outs: [{ pt10: null, counts: { A: 1 } }] }], 'out_off');
err('outs が並びでない', [{ rate: 100, hanchans: [H([500, 100, -200, -400])], outs: {} }], 'table');

console.log('■ 乱数の卓（決まった種）＝合計0・払いの合計が貸し借りと同じ・払う回数は人数−1 まで');
let seed = 20261120;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const R = { players: 4, tie: 'split' };
let bad = 0, runs = 0;
for (let k = 0; k < 2000; k++) {
  const people = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].slice(0, 4 + rnd(5));
  const tables = [];
  for (let t = 0; t < 1 + rnd(3); t++) {
    const hs = [];
    for (let h = 0; h < 1 + rnd(4); h++) {
      const mem = people.slice().sort(() => 0).filter((_, i) => (i + h + t) % people.length < 4).slice(0, 4);
      if (mem.length < 4) continue;
      const c = [rnd(500), rnd(500), rnd(500)].map((v) => v * 100);
      const last = 100000 - sum(c);
      const g = hanchanPt(R, [...c, last], { order: [0, 1, 2, 3] });
      if (!g.ok) { bad++; continue; }
      hs.push({ members: mem, pt10: g.pt10 });
    }
    tables.push({ rate: rnd(2) ? 10 * (1 + rnd(100)) : null, hanchans: hs });
  }
  const g = seisan(tables);
  runs++;
  if (!g.ok) { bad++; continue; }
  const n = Object.keys(g.ten).length;
  const paid = {};
  for (const x of g.pay) { paid[x.from] = (paid[x.from] || 0) - x.ten; paid[x.to] = (paid[x.to] || 0) + x.ten; if (x.ten <= 0) bad++; }
  for (const [m, v] of Object.entries(g.ten)) if ((paid[m] || 0) !== v) bad++;
  if (g.pay.length > Math.max(0, n - 1)) bad++;
}
ok(`2000 回の乱数の卓で外れ 0（${runs} 回）`, bad === 0, String(bad));
ok('payList：全員0なら払い無し', J(payList({ A: 0, B: 0 })) === '[]');
ok('payList：同じ額は人の字の順', J(payList({ B: -100, A: -100, C: 200 })) === J([{ from: 'A', to: 'C', ten: 100 }, { from: 'B', to: 'C', ten: 100 }]));

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
