/*
 * A14g（tataki/a14g_sadame_v1.md §3）覚えたルールの取り込み（js/rules-memory.mjs）＝期待値。
 */
import { fromMemory, pickStart, HIDDEN } from '../js/rules-memory.mjs';
import { defaultRules } from '../lib/rules.mjs';
import { swapPlayers, PLAYERS_KEYS } from '../js/gamen-rules.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const M4 = { ...defaultRules(4), start_pts: 30000, return_pts: 30000, uma: [20, 10, -10, -20], rate: 50, tobi_pt: 20, chip_pt10: 25 };
const M3 = { ...defaultRules(3), start_pts: 40000, return_pts: 45000, uma: [15, 0, -15], rate: 200 };

console.log('■ fromMemory');
ok('null → null（覚え無し）', fromMemory(null, 4) === null);
ok('undefined → null', fromMemory(undefined, 3) === null);
ok('配列 → bad', fromMemory([], 4) === 'bad');
ok('字 → bad', fromMemory('x', 4) === 'bad');
ok('人数違い（3人の覚えを4人で）→ bad', fromMemory(M3, 4) === 'bad');
ok('持ち点が字 → bad', fromMemory({ ...M4, start_pts: '30000' }, 4) === 'bad');
ok('知らない鍵 → bad', fromMemory({ ...M4, zzz: 1 }, 4) === 'bad');
ok('ウマの合計が0でない → bad', fromMemory({ ...M4, uma: [20, 10, -10, -10] }, 4) === 'bad');
const g = fromMemory(M4, 4);
ok('持ち点 30000・返し 30000・ウマ 20/10/−10/−20・レート 50・飛び賞 20・チップ 2.5 はそのまま', g && g.start_pts === 30000 && g.return_pts === 30000 && J(g.uma) === J([20, 10, -10, -20]) && g.rate === 50 && g.tobi_pt === 20 && g.chip_pt10 === 25, J(g));
const old = fromMemory({ ...M4, round: 'gosha', tie: 'split', tobi_from: 'all', kyotaku_end: 'kieru' }, 4);
ok('古い覚え gosha/split/all/kieru → none/kamicha/busted/top', old && old.round === 'none' && old.tie === 'kamicha' && old.tobi_from === 'busted' && old.kyotaku_end === 'top', J(old && HIDDEN.map((k) => old[k])));
ok('レート null（なし）は null のまま', fromMemory({ ...M4, rate: null }, 4).rate === null);
ok('箱下 なし・0点ちょうど 飛びでない は残す', (() => { const r = fromMemory({ ...M4, hakoshita: false, tobi_zero: false }, 4); return r.hakoshita === false && r.tobi_zero === false; })());
ok('元の obj を書き換えない', (() => { const o = { ...M4, round: 'gosha' }; fromMemory(o, 4); return o.round === 'gosha'; })());

console.log('■ pickStart');
let s = pickStart({ ok: false, err: 'net' });
ok('読めない → unread・4人・覚え無し', s.unread === true && s.players === 4 && s.memory[3] === null && s.memory[4] === null);
s = pickStart({ ok: true });
ok('rules が無い返し → unread', s.unread === true);
s = pickStart(null);
ok('null の返し → unread', s.unread === true);
s = pickStart({ ok: true, rules: { 3: null, 4: null }, last: null });
ok('覚え無し → 帯なし・4人', s.unread === false && s.bad.length === 0 && s.players === 4);
s = pickStart({ ok: true, rules: { 3: M3, 4: M4 }, last: 3 });
ok('last 3 → 3人で開く・両方使える', s.players === 3 && s.memory[3].start_pts === 40000 && s.memory[4].start_pts === 30000);
s = pickStart({ ok: true, rules: { 3: M3, 4: M4 }, last: 4 });
ok('last 4 → 4人', s.players === 4);
s = pickStart({ ok: true, rules: { 3: M3, 4: null } });
ok('last 無し（古い倉庫）で3人だけ覚え → 3人', s.players === 3);
s = pickStart({ ok: true, rules: { 3: M3, 4: { bad: 1 } }, last: 4 });
ok('4人が崩れ・last 4 → 4人で開き bad=[4]・3人は使える', s.players === 4 && J(s.bad) === '[4]' && s.memory[4] === null && s.memory[3].start_pts === 40000);
s = pickStart({ ok: true, rules: { 3: M3, 4: M4 }, last: 7 });
ok('last が変な値 → 4人', s.players === 4);

console.log('■ A20 §1-7 途中で人数を押す（swapPlayers）');
{
  // 今の卓：4人・レート 50・チップ 2.5・ウマ 30/10・持ち点 30000／返し 30000・赤 3
  const cur = { ...defaultRules(4), rate: 50, chip_pt10: 25, uma: [30, 10, -10, -30], start_pts: 30000, return_pts: 30000 };
  const keep = JSON.stringify(cur);
  ok('人数で既定が違う鍵は aka・kita・return_pts・start_pts・uma の5つ', J([...PLAYERS_KEYS].sort()) === J(['aka', 'kita', 'return_pts', 'start_pts', 'uma']), J(PLAYERS_KEYS));
  const a = swapPlayers(cur, 3, { ...M3, aka: 1, kita: 'none' });
  ok('覚え在り→3人：持ち点 40000・返し 45000・ウマ 15/0/−15・赤 1・北 none は覚えから', a.players === 3 && a.start_pts === 40000 && a.return_pts === 45000 && J(a.uma) === J([15, 0, -15]) && a.aka === 1 && a.kita === 'none', J(a));
  ok('覚え在り→3人：レート 50・チップ 2.5 は今の卓のまま（覚えのレート 200 を持ち込まない）', a.rate === 50 && a.chip_pt10 === 25);
  const b = swapPlayers(cur, 3, null);
  ok('覚え無し→3人：35000／40000・15/0/−15・赤 2・北 nuki（既定）・レート 50 のまま', b.start_pts === 35000 && b.return_pts === 40000 && J(b.uma) === J([15, 0, -15]) && b.aka === 2 && b.kita === 'nuki' && b.rate === 50, J(b));
  const c = swapPlayers(cur, 3, 'bad');
  ok('覚えが読めない→3人：既定（覚え無しと同じ値）', J(c) === J(b));
  ok('今の卓の rules は変えない', JSON.stringify(cur) === keep);
  const d = swapPlayers(b, 4, null);
  ok('3→4（覚え無し）：25000／30000・20/10/−10/−20・赤 3・北 none・レート 50', d.players === 4 && d.start_pts === 25000 && d.return_pts === 30000 && J(d.uma) === J([20, 10, -10, -20]) && d.aka === 3 && d.kita === 'none' && d.rate === 50, J(d));
}

console.log(`KEKKA rules-memory ${p}/${p + f}`);
if (f) process.exit(1);
