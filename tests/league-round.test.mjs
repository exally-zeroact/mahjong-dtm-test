/*
 * A23（memory/mahjong_tataki_2026-11-20/l_sadame.md v1.3 §1 A23・§3）リーグの［次の対局］と次の半荘の人（lib/league-round.mjs）＝期待値。
 * 使い方: node tests/league-round.test.mjs  /  node tests/league-round.test.mjs --self-test（lib をわざと壊して赤になるか）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyState, applyOps } from '../lib/room-state.mjs';
import { defaultRules } from '../lib/rules.mjs';

const J = JSON.stringify;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib', 'league-round.mjs');

const R = { ...defaultRules(4), start_pts: 25000, return_pts: 25000, uma: [0, 0, 0, 0], rate: 100, tobi: false };
const MS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'];
const NAMES = ['山田', '鈴木', '佐藤', '高橋', '伊藤', '渡辺', '中村', '小林', '加藤'];
const C = [40000, 30000, 20000, 10000];
function apply(st, ops) { const r = applyOps(st, ops); if (!r.ok) throw new Error('当たらない：' + J(r.res) + ' ' + J(ops[r.res.i] || null)); return r.state; }
const hs = (id, t, seats, cells = C) => ({ op: 'hanchan_start', hanchan_id: id, table_id: t, seats, cells });
const seat = (t, seats) => ({ op: 'table_seats', table_id: t, seats });
const off = (m) => ({ op: 'member_active', member_id: m, active: false });

/* その日 s1・卓 t1 t2（4人）＋ 別の日 s2・鎖 t3→t4（A20 の区切り） */
function base() {
  let st = emptyState(); st.rules = R;
  st = apply(st, [
    ...MS.map((id, i) => ({ op: 'member_add', member_id: id, name: NAMES[i] })),
    { op: 'session_add', session_id: 's1', date: '2026-11-27', rate: 100 },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' },
    { op: 'session_add', session_id: 's2', date: '2026-11-28', rate: 100 },
    { op: 'table_add', table_id: 't3', session_id: 's2', label: '卓1' },
    { op: 'table_add', table_id: 't4', session_id: 's2', label: '卓1' },
  ]);
  return st;
}
// 関数の段＝写しを直に触る（鎖 t3→t4 は半荘を置いてから繋ぐ＝倉庫の区切りと同じ順）
const mk = (...steps) => steps.reduce((st, x) => (typeof x === 'function' ? (x(st), st) : apply(st, x)), base());
const link = (st) => { st.tables.find((t) => t.table_id === 't3').next_table_id = 't4'; };
const A4 = ['m1', 'm2', 'm3', 'm4'], B4 = ['m5', 'm6', 'm7', 'm8'];

async function run(L, quiet) {
  let p = 0, f = 0;
  const ok = (name, cond, got) => { if (cond) { p++; if (!quiet) console.log('  ✓ ' + name); } else { f++; if (!quiet) console.log('  ✗ ' + name + (got === undefined ? '' : '  got=' + J(got))); } };
  const eq = (name, got, want) => ok(name, J(got) === J(want), got);
  const lg = { league: true };

  if (!quiet) console.log('[nextSeats / baseSeats]');
  { // t.seats が正しい＝それ（前の半荘と違っても）
    const st = mk([hs('h1', 't1', A4)], [seat('t1', ['m1', 'm2', 'm3', 'm9'])]);
    eq('t.seats が正しい → t.seats', L.nextSeats(st, 't1', 4, lg), ['m1', 'm2', 'm3', 'm9']);
    eq('baseSeats from table', L.baseSeats(st, 't1', 4), { seats: ['m1', 'm2', 'm3', 'm9'], from: 'table' });
  }
  { // t.seats に外した人 → null（前の半荘 [m1..m4] は全員 active でも戻らない・v1.2 止め1）
    const st = mk([hs('h1', 't1', A4)], [seat('t1', ['m1', 'm2', 'm3', 'm9'])], [off('m9')]);
    eq('t.seats に inactive → null（前の半荘へ戻らない）', L.nextSeats(st, 't1', 4, lg), null);
    eq('baseSeats も null', L.baseSeats(st, 't1', 4), { seats: null, from: null });
  }
  { // 人数違い（3人の n で見る）・重なり（写しに直に置く）→ null
    const st = mk([hs('h1', 't1', A4)], [seat('t1', A4)]);
    eq('t.seats の人数違い → null', L.nextSeats(st, 't1', 3, lg), null);
    st.tables.find((t) => t.table_id === 't1').seats = ['m1', 'm1', 'm2', 'm3'];
    eq('t.seats の重なり → null', L.nextSeats(st, 't1', 4, lg), null);
  }
  { // t.seats が空 → 前の半荘（全員 active）
    const st = mk([hs('h1', 't1', A4, [25000, 25000, 25000, 25000]), hs('h1b', 't1', ['m1', 'm2', 'm3', 'm5'])]);
    eq('t.seats 空 → 最後の半荘の人', L.nextSeats(st, 't1', 4, lg), ['m1', 'm2', 'm3', 'm5']);
    eq('baseSeats from hanchan', L.baseSeats(st, 't1', 4).from, 'hanchan');
  }
  { // 取り消した半荘は見ない
    const st = mk([hs('h1', 't1', A4), hs('h1b', 't1', ['m1', 'm2', 'm3', 'm5'])]);
    st.hanchans.find((h) => h.hanchan_id === 'h1b').voided = true;
    eq('取り消した最後の半荘は飛ばす', L.nextSeats(st, 't1', 4, lg), A4);
  }
  { // t.seats 空・前の半荘に外した人 → null
    const st = mk([hs('h1', 't1', A4)], [off('m4')]);
    eq('前の半荘に inactive → null', L.nextSeats(st, 't1', 4, lg), null);
  }
  { // 半荘も t.seats も無い → null
    const st = mk();
    eq('何も無い卓 → null', L.nextSeats(st, 't1', 4, lg), null);
    eq('無い卓 → null', L.nextSeats(st, 'tx', 4, lg), null);
  }
  { // 次の対局で卓1 の X(m4) を卓2 へ移し卓1 に Z(m9)→Z を外す＝卓1 は null（前の半荘 [..m4] に戻らない）
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)], [seat('t1', ['m1', 'm2', 'm3', 'm9']), seat('t2', ['m4', 'm6', 'm7', 'm8'])], [off('m9')]);
    eq('X を卓2 へ・Z を外す → 卓1 null', L.nextSeats(st, 't1', 4, lg), null);
    eq('卓2 はそのまま', L.nextSeats(st, 't2', 4, lg), ['m4', 'm6', 'm7', 'm8']);
  }
  { // t.seats 空の卓の前の半荘が他の卓の次の席と重なる → null（両方とも）
    const st = mk([hs('h2', 't2', ['m4', 'm5', 'm6', 'm7'])], [seat('t1', A4)]);
    eq('卓2（前の半荘）が卓1 の t.seats と重なる → null', L.nextSeats(st, 't2', 4, lg), null);
    eq('卓1 も卓2 の土台と重なる → null', L.nextSeats(st, 't1', 4, lg), null);
    eq('baseSeats は重なりを見ない', L.baseSeats(st, 't2', 4).seats, ['m4', 'm5', 'm6', 'm7']);
  }
  { // 他の卓が null（土台なし）なら重なりは見ない・重ならない2卓は両方そのまま
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)]);
    eq('重ならない2卓 → 卓1', L.nextSeats(st, 't1', 4, lg), A4);
    eq('重ならない2卓 → 卓2', L.nextSeats(st, 't2', 4, lg), B4);
  }
  { // league:false＝前の半荘のまま（t.seats も他の卓も見ない・外した人も見ない）
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', ['m4', 'm5', 'm6', 'm7'])], [seat('t1', ['m1', 'm2', 'm3', 'm9'])], [off('m4')]);
    eq('league:false → 前の半荘', L.nextSeats(st, 't1', 4, { league: false }), A4);
    eq('opts 無し → 前の半荘', L.nextSeats(st, 't1', 4), A4);
    eq('league:false で半荘無し → null', L.nextSeats(mk(), 't1', 4, { league: false }), null);
  }
  { // 鎖（t3→t4）＝最後の卓の t.seats・鎖の半荘を見る
    const st = mk([hs('h3', 't3', A4)], link, [seat('t4', ['m1', 'm2', 'm3', 'm5'])]);
    eq('鎖の最後の卓の t.seats', L.nextSeats(st, 't3', 4, lg), ['m1', 'm2', 'm3', 'm5']);
    const st2 = mk([hs('h3', 't3', A4)], link);
    eq('鎖の最後の卓が空 → 鎖の前の半荘', L.nextSeats(st2, 't4', 4, lg), A4);
  }

  if (!quiet) console.log('[roundCheck]');
  { // 2卓に同じ人を選ぶ → dup
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)]);
    eq('選んだ2卓に同じ人 → dup', L.roundCheck(st, 's1', { t1: A4, t2: ['m4', 'm6', 'm7', 'm8'] }), { ok: false, err: 'dup', member_id: 'm4', tables: ['t1', 't2'] });
  }
  { // 選び直さない卓の今の席と選んだ卓の重なり → dup
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)]);
    eq('卓2 だけ選び直し・卓1 の今の席と重なる → dup', L.roundCheck(st, 's1', { t2: ['m4', 'm6', 'm7', 'm8'] }), { ok: false, err: 'dup', member_id: 'm4', tables: ['t1', 't2'] });
    eq('卓1 から X を外して3人のまま・卓2 に X → dup', L.roundCheck(st, 's1', { t1: ['m1', 'm2', 'm3'], t2: ['m4', 'm6', 'm7', 'm8'] }), { ok: false, err: 'dup', member_id: 'm4', tables: ['t1', 't2'] });
  }
  { // 入れ替え＝ok・替わった卓だけ ops・同じ人のままの卓は ops に出ない
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)], [seat('t1', A4)]);
    eq('卓1 は今のまま・卓2 は t.seats 空 → 卓2 だけ op', L.roundCheck(st, 's1', { t1: A4, t2: B4 }), { ok: true, ops: [{ op: 'table_seats', table_id: 't2', seats: B4 }], notFull: [], open: [] });
    eq('2卓で m4 と m5 を入れ替え → ops 2つ', L.roundCheck(st, 's1', { t1: ['m1', 'm2', 'm3', 'm5'], t2: ['m4', 'm6', 'm7', 'm8'] }),
      { ok: true, ops: [{ op: 'table_seats', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm5'] }, { op: 'table_seats', table_id: 't2', seats: ['m4', 'm6', 'm7', 'm8'] }], notFull: [], open: [] });
    eq('並びだけ替えても op', L.roundCheck(st, 's1', { t1: ['m2', 'm1', 'm3', 'm4'] }).ops, [{ op: 'table_seats', table_id: 't1', seats: ['m2', 'm1', 'm3', 'm4'] }]);
  }
  { // n 人に足りない卓は notFull・今のまま
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)]);
    eq('卓1 2人だけ → notFull・卓2 だけ op', L.roundCheck(st, 's1', { t1: ['m1', 'm2'], t2: ['m5', 'm6', 'm7', 'm9'] }),
      { ok: true, ops: [{ op: 'table_seats', table_id: 't2', seats: ['m5', 'm6', 'm7', 'm9'] }], notFull: ['t1'], open: [] });
    eq('空の pick は notFull に出さない', L.roundCheck(st, 's1', { t1: [] }), { ok: true, ops: [], notFull: [], open: [] });
  }
  { // 打ち途中の回の数（取り消した回は数えない）
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4, [30000, null, null, 20000])]);
    eq('卓2 に打ち途中1回', L.roundCheck(st, 's1', {}).open, [{ table_id: 't2', count: 1 }]);
    st.hanchans.find((h) => h.hanchan_id === 'h2').voided = true;
    eq('取り消した回は数えない', L.roundCheck(st, 's1', {}).open, []);
  }
  { // 鎖＝op は鎖の最後の卓へ・picks の鍵は頭
    const st = mk([hs('h3', 't3', A4)], link);
    eq('鎖の頭で選ぶ → 最後の卓 t4 へ op', L.roundCheck(st, 's2', { t3: ['m1', 'm2', 'm3', 'm5'] }).ops, [{ op: 'table_seats', table_id: 't4', seats: ['m1', 'm2', 'm3', 'm5'] }]);
    eq('頭でない卓の鍵 → err table', L.roundCheck(st, 's2', { t4: A4 }), { ok: false, err: 'table', table_id: 't4' });
    eq('別の日の卓の鍵 → err table', L.roundCheck(st, 's2', { t1: A4 }), { ok: false, err: 'table', table_id: 't1' });
  }
  { // 選んだ人の確かめ
    const st = mk([hs('h1', 't1', A4)], [off('m9')]);
    eq('同じ人を1卓に2回 → err pick', L.roundCheck(st, 's1', { t1: ['m1', 'm1', 'm2', 'm3'] }), { ok: false, err: 'pick', table_id: 't1' });
    eq('外した人 → err pick', L.roundCheck(st, 's1', { t1: ['m1', 'm2', 'm3', 'm9'] }), { ok: false, err: 'pick', table_id: 't1', member_id: 'm9' });
    eq('名簿に無い人 → err pick', L.roundCheck(st, 's1', { t1: ['m1', 'm2', 'm3', 'zz'] }), { ok: false, err: 'pick', table_id: 't1', member_id: 'zz' });
  }
  { // 選び直さない卓の土台が null（外した人入り）なら重なりは見ない
    const st = mk([hs('h1', 't1', A4), hs('h2', 't2', B4)], [off('m4')]);
    eq('卓1 の土台 null・卓2 に m1 → ok', L.roundCheck(st, 's1', { t2: ['m1', 'm6', 'm7', 'm8'] }).ok, true);
  }
  return { p, f };
}

const self = process.argv.includes('--self-test');
const L0 = await import(pathToFileURL(LIB).href);
if (!self) {
  const { p, f } = await run(L0, false);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  const src = fs.readFileSync(LIB, 'utf8');
  const W = [
    ['t.seats が正しくない時に前の半荘へ戻る', "? { seats: t.seats.slice(), from: 'table' } : { seats: null, from: null };",
      "? { seats: t.seats.slice(), from: 'table' } : ((hs) => { const l = hs[hs.length - 1]; return l && okSeats(st, l.seats, n) ? { seats: l.seats.slice(), from: 'hanchan' } : { seats: null, from: null }; })(chainHanchans(st, tableId));"],
    ['他の卓との重なりを見ない', 'if (o && o.some((m) => b.includes(m))) return null;', 'if (false) return null;'],
    ['league:false でも t.seats を使う', 'if (!opts || opts.league !== true) {', 'if (false) {'],
    ['前の半荘の inactive を通す', 'return !!x && x.active !== false;', 'return !!x;'],
    ['重なりを選んだ卓だけで見る', 'if (b) final.push([h, b]);', 'if (false) final.push([h, b]);'],
    ['替わらない卓にも op を出す', 'if (cur.length !== pk.length || cur.some((m, i) => m !== pk[i])) ops.push', 'ops.push'],
    ['op を鎖の頭へ送る', "table_id: last.table_id, seats: pk.slice()", "table_id: h, seats: pk.slice()"],
    ['足りない卓を notFull に出さない', 'if (pk.length > 0) notFull.push(h);', 'if (false) notFull.push(h);'],
    ['取り消した半荘も見る', '.filter((h) => ch.has(h.table_id) && !h.voided)', '.filter((h) => ch.has(h.table_id))'],
    ['選んだ人の active を見ない', 'if (!x || x.active === false) return', 'if (!x) return'],
    ['頭でない鍵を通す', "if (!heads.includes(k)) return { ok: false, err: 'table', table_id: k };", "if (false) return { ok: false, err: 'table', table_id: k };"],
  ];
  let p = 0, f = 0;
  console.log('[league-round --self-test] lib をわざと壊して赤になるか');
  if ((await run(L0, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of W) {
    if (!src.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が lib に無い'); continue; }
    const tmp = path.join(path.dirname(LIB), '.league-round.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, src.replace(from, to));
    try {
      const M = await import(pathToFileURL(tmp).href);
      if ((await run(M, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } finally { fs.unlinkSync(tmp); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
