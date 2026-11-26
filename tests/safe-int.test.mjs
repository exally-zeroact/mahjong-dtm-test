/* safe-int.test.mjs — A18（a18_sadame v5 §2・§5）お金の守り：safe の外は null・null は持ち回す・精算は big・窓は bigNg（CI）
 * 使い方: node tests/safe-int.test.mjs
 */
import { M, mulS, addS, addK, sumS } from '../lib/safe-int.mjs';
import { seisan } from '../lib/seisan.mjs';
import { emptyState, applyOps, tableView, chainView, sessionSeisan, sessionBreakdown } from '../lib/room-state.mjs';
import { defaultRules } from '../lib/rules.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const MAX = Number.MAX_SAFE_INTEGER;

console.log('■ mulS・addS の境');
ok('M は ±20億', M === 2000000000);
ok('addS 2^53−1 は数', addS(MAX - 1, 1) === MAX);
ok('addS 2^53−1＋1 は null', addS(MAX, 1) === null);
ok('addS −(2^53−1)−1 は null', addS(-MAX, -1) === null);
ok('mulS 2^53−1 × 1 は数', mulS(MAX, 1) === MAX);
ok('mulS 3,002,399,751,580,331 × 3 は null（9,007,199,254,740,993）', mulS(3002399751580331, 3) === null);
ok('mulS 1.5e7 × 2e8＝3e15', mulS(15000000, 200000000) === 3e15);
ok('null は持ち回す（addS・mulS）', addS(null, 1) === null && addS(1, null) === null && mulS(null, 2) === null && mulS(2, null) === null);
ok('safe でない入力は null', addS(2 ** 53, 0) === null && mulS(2 ** 53, 1) === null);
{ const m = {}; addK(m, 'a', 5); addK(m, 'a', 7); addK(m, 'b', null); addK(m, 'b', 3);
  ok('addK：鍵が無い時だけ v・null は 0 に戻らない', m.a === 12 && m.b === null, J(m)); }
ok('sumS：途中で 2^53 を越えたら null', sumS([MAX, 1, -5]) === null && sumS([1, 2, 3]) === 6);

console.log('■ seisan：safe の内は今の答え・越えたら big（合計0の throw より前）');
{
  const g = seisan([{ rate: 2000000000, hanchans: [{ members: ['A', 'B'], pt10: [5000000, -5000000] }] }]);
  ok('rate 20億・pt10 500万＝ten 1e15（手で：5,000,000×200,000,000）', g.ok && g.ten.A === 1e15 && g.ten.B === -1e15 && J(g.pay) === J([{ from: 'B', to: 'A', ten: 1e15 }]), J(g));
  const hs10 = Array.from({ length: 10 }, () => ({ members: ['A', 'B'], pt10: [5000000, -5000000] }));
  const g2 = seisan([{ rate: 2000000000, hanchans: hs10 }]);
  ok('1卓の pt10 5,000万×2億＝1e16（2^53 越え）＝err big・pay 無し', !g2.ok && g2.err === 'big' && g2.pay === undefined, J(g2));
  const t9 = { rate: 2000000000, hanchans: Array.from({ length: 9 }, () => ({ members: ['A', 'B'], pt10: [5000000, -5000000] })) };
  const g3 = seisan([t9]);
  ok('1卓 9e15 は safe＝ok（手で：45,000,000×200,000,000）', g3.ok && g3.ten.A === 9e15, J(g3));
  const g4 = seisan([t9, t9]);
  ok('2卓とも safe・合わせると 1.8e16＝err big', !g4.ok && g4.err === 'big', J(g4));
  const g5 = seisan([{ rate: 2000000000, chip_pt10: 2000000000, chips: { A: 999, B: -999 }, hanchans: [] }]);
  ok('チップ 999枚×20億pt10×2億＝big', !g5.ok && g5.err === 'big', J(g5));
  const g6 = seisan([{ rate: 100, hanchans: [{ members: ['A', 'B', 'C', 'D'], pt10: [500, 100, -200, -400] }] }]);
  ok('普通の値は今の答え（ten 5000/1000/−2000/−4000）', g6.ok && J(g6.ten) === J({ A: 5000, B: 1000, C: -2000, D: -4000 }), J(g6));
}

console.log('■ 窓の印 bigNg（tableView・chainView・sessionBreakdown・sessionSeisan）');
{
  const R = { ...defaultRules(4), start_pts: 500000000, return_pts: 500000000, hakoshita: false, round: 'none' };
  const mk = (nA, nB) => {
    const st0 = emptyState(); st0.rules = R;
    const ops = [
      ...['m1', 'm2', 'm3', 'm4'].map((m, i) => ({ op: 'member_add', member_id: m, name: '山田鈴木佐藤高橋'.slice(i * 2, i * 2 + 2) })),
      { op: 'session_add', session_id: 's1', date: '2026-11-26', rate: 2000000000 },
      { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
      { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' },
    ];
    for (let i = 0; i < nA; i++) ops.push({ op: 'hanchan_start', hanchan_id: 'a' + i, table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [1999999400, 300, 200, 100] });
    for (let i = 0; i < nB; i++) ops.push({ op: 'hanchan_start', hanchan_id: 'b' + i, table_id: 't2', seats: ['m1', 'm2', 'm3', 'm4'], cells: [1999999400, 300, 200, 100] });
    const r = applyOps(st0, ops);
    if (!r.ok) throw new Error(J(r.res));
    return r.state;
  };
  // 1回のトップ pt10＝(1,999,999,400−5億)/100 − Σ他（他＝(300−5億)/100+100 ほか）＝15,000,194 前後 → ×2億＝約 3e15（safe）
  const s1 = mk(1, 0), v1 = tableView(s1, 't1');
  ok('1回は safe＝bigNg false・窓の数に null 0個', v1.bigNg === false && v1.windows.every((w) => Object.values(w).every((x) => x !== null)), J(v1.windows[0]));
  ok('1回のトップの額＝pt10×2億（手の式と同じ）', v1.windows.find((w) => w.member_id === 'm1').big === v1.windows.find((w) => w.member_id === 'm1').pt10 * 200000000);
  const s4 = mk(4, 0), v4 = tableView(s4, 't1');
  ok('4回（トップ pt10 約6e7×2億＝1.2e16）＝bigNg true', v4.bigNg === true, J(v4.windows[0]));
  ok('chainView も bigNg true', chainView(s4, 't1').bigNg === true);
  ok('sessionSeisan は err big', sessionSeisan(s4, 's1').err === 'big', J(sessionSeisan(s4, 's1')));
  ok('sessionBreakdown も bigNg true', sessionBreakdown(s4, 's1').bigNg === true);
  const s22 = mk(2, 2), va = tableView(s22, 't1'), vb = tableView(s22, 't2'), bd = sessionBreakdown(s22, 's1');
  ok('2卓とも2回（各 約6e15 safe）＝卓ごとは bigNg false', va.bigNg === false && vb.bigNg === false);
  ok('開催で合わせると 1.2e16＝sessionSeisan は big・sessionBreakdown は bigNg（keiBig が null）', sessionSeisan(s22, 's1').err === 'big' && bd.bigNg === true && bd.by.m1.keiBig['2000000000'] === null, J(bd.by.m1));
  const s11 = mk(1, 1), bd11 = sessionBreakdown(s11, 's1');
  ok('safe の内は keiBig＝kei×rate/10・bigNg false', bd11.bigNg === false && bd11.by.m1.keiBig['2000000000'] === bd11.by.m1.kei['2000000000'] * 200000000, J(bd11.by.m1));
}

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
