/* room-state.test.mjs — ★lib/room-state.mjs（端末の写しに op を当てる・対局の1ページの数）が手で決めた答えを出すか★（CI）
 * op の形・範囲・版は倉庫の取り決め（write_sekkei.md §3・§4・§6 v5.2）＝範囲の端は tests/fixtures/write-cases.json（倉庫の write.live.mjs も読む）。
 * 例は設計図 §2 の絵（1pt＝100・チップ1枚2.0pt・祝儀1枚1.0pt）に寄せた数。
 * 使い方: node tests/room-state.test.mjs
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyState, applyOp, applyOps, tableView, hanchanView, tobiShapeOk, sessionSeisan, checkEntry, pickSession, sessionSig,
  migrateState, tobiSetOp, roomGate, tableRate, tenChanged, sessionBreakdown, canon, NEWER_TEXT, gateText, OP_NAMES, OPS_MAX, CELL_MAX, LOST_MAX, EXTRA_MAX,
  kindOf, yakiUsed, tobiUsed, readArgs, sessionOfRef, tableChain, followT, chainView, PERSON_OPS, LEAGUE_OPS, WHO, WHO_LEAGUE, ROLE_AT_GATE, RE, needOf, reauthOk, REAUTH_SEC, KEYS_OF,
} from '../lib/room-state.mjs';
import { readOps } from './mj-ops.test.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';
import { defaultRules, rulesOk } from '../lib/rules.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));
const SEATS = ['m1', 'm2', 'm3', 'm4'];

// 箱下は「なし」で固定（この試験の答えは − を 0 で止めた形で書いてある・S2 で既定が「あり」に替わっても狙いは替えない）
// 端数は「五捨六入」で固定（この試験の答えは五捨六入で書いてある・A9 で新しいルールの既定が「丸めない」に替わっても、古い卓の守りとして残す）
const rules = { ...defaultRules(4), rate: 100, chip_pt10: 20, shugi_pt10: 10, hakoshita: false, round: 'gosha' };
/* 部屋のルールは op で送らない＝写しの st.rules に置く（画面が開いた時に room.rules を置くのと同じ） */
const withRules = (R) => { const st = emptyState(); st.rules = R; return st; };
const base = (R = rules) => {
  const r = applyOps(withRules(R), [
    { op: 'member_add', member_id: 'm1', name: '山田' },
    { op: 'member_add', member_id: 'm2', name: '鈴木' },
    { op: 'member_add', member_id: 'm3', name: '佐藤' },
    { op: 'member_add', member_id: 'm4', name: '高橋' },
    { op: 'session_add', session_id: 's1', date: '2026-11-20', rate: 100 },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  ]);
  if (!r.ok) throw new Error('base が当たらない：' + J(r.res));
  return r.state;
};
const hs = (id, cells, extra = {}) => ({ op: 'hanchan_start', hanchan_id: id, table_id: 't1', seats: SEATS, cells, ...extra });
const H = (st, id) => st.hanchans.find((h) => h.hanchan_id === id);

console.log('■ 決まりの数（倉庫 schema と同じ）');
ok('素点は ±2,000,000,000（A18 機械の限界）', CELL_MAX === 2e9);
ok('消えた供託は 2,000,000,000 まで（A18）', LOST_MAX === 2e9);
ok('チップ・祝儀は ±999', EXTRA_MAX === 999);
ok('1つの組は30個まで', OPS_MAX === 30);
ok('op は33個（B1 で table_seats を足した・2c-2a2 の直す op 6個・2c-2b の人の op 5個・2c-2c の部屋の op 4個・2c-2d1 のリーグの op 3個・段C の room_share・room_close を足した・2c-3c’ で yakitori_set を外した・C4 で table_rules を足した）', OP_NAMES.length === 34 && J([...OP_NAMES].sort()) === J(['account_remove', 'cell_set', 'extra_add', 'extra_set', 'hanchan_order', 'hanchan_seats', 'hanchan_start', 'hanchan_unvoid', 'hanchan_void', 'kyotaku_set', 'league_create', 'league_owner_set', 'league_save', 'member_active', 'member_add', 'member_link', 'member_relink', 'member_rename', 'member_unlink', 'role_set', 'room_close', 'room_delete', 'room_leave', 'room_secret', 'room_share', 'room_undelete', 'session_add', 'session_edit', 'settle_snap', 'table_add', 'table_edit', 'table_rules', 'table_seats', 'tobi_set']), J(OP_NAMES));

console.log('■ 範囲の端の表（tests/fixtures/write-cases.json＝倉庫の試験と同じ表）');
{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const W = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', 'write-cases.json'), 'utf8'));
  ok('表の版は1・case が在る', W.v === 1 && Array.isArray(W.cases) && W.cases.length >= 60, String(W.cases && W.cases.length));
  const ids = new Set();
  for (const c of W.cases) {
    if (ids.has(c.id)) ok('case の名が重ならない：' + c.id, false);
    ids.add(c.id);
    const R = rulesOk(W.rules[c.rules]);
    if (!R.ok) { ok(c.id + '（ルールが読めない）', false, J(R)); continue; }
    const b = applyOps(withRules(R.rules), W.base_ops);
    if (!b.ok) { ok(c.id + '（base が当たらない）', false, J(b.res)); continue; }
    const ops = c.ops_repeat ? Array.from({ length: c.ops_repeat.n }, () => clone(c.ops_repeat.op)) : c.ops;
    const before = J(b.state);
    const r = applyOps(b.state, clone(ops), { now: '2026-11-20T12:00:00Z' });
    const got = r.ok ? 'ok' : r.res.err;
    ok(c.id, got === c.want, 'want ' + c.want + ' got ' + got + ' ' + J(r.res || {}));
    if (!r.ok) ok(c.id + '＝弾いた組は写しを変えない', J(b.state) === before && r.state === b.state);
  }
  // 表は err だけ比べる＝at と i が倉庫と同じかはここで見る（正本＝schema.sql の extra_set／extra_add の頭と組の終わりの正味の門）
  const base = (k) => applyOps(withRules(rulesOk(W.rules[k]).rules), W.base_ops).state;
  const run = (k, ops) => applyOps(base(k), ops, { now: '2026-11-20T12:00:00Z' });
  const g1 = run('top', [{ op: 'extra_add', table_id: 't1', member_id: 'zz', kind: 'chip', add: 1 }]);
  ok('extra_add の頭：使わない種と部屋に居ない人が両方なら at kind（倉庫と同じ順）', !g1.ok && g1.res.err === 'bad' && g1.res.at === 'kind', J(g1.res));
  const g2 = run('top', [{ op: 'extra_set', table_id: 't1', member_id: 'zz', kind: 'shugi', value: 1, base_version: 0 }]);
  ok('extra_set の頭：使わない種と部屋に居ない人が両方なら at kind（倉庫と同じ順）', !g2.ok && g2.res.err === 'bad' && g2.res.at === 'kind', J(g2.res));
  const n1 = run('tane', [{ op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'shugi', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'chip', add: 1 }]);
  ok('正味の門：2つの行が両方弾かれる時は row_key の字順（kind→member_id）で先の行＝chip の i 1', !n1.ok && n1.res.at === 'member_id' && n1.res.i === 1 && n1.idx === 1, J(n1.res));
  const n2 = run('tane', [{ op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'shugi', add: 1 }]);
  ok('正味の門：順を逆にしても chip の行＝i 0', !n2.ok && n2.res.i === 0 && n2.idx === 0, J(n2.res));
  const n3 = run('tane', [{ op: 'member_add', member_id: 'm0', name: '中村' }, { op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm0', kind: 'chip', add: 1 }]);
  ok('正味の門：同じ kind なら member_id の字順で先＝m0 の i 2', !n3.ok && n3.res.i === 2, J(n3.res));

  // ── 2c-3b 自由な項目 c:<id>（写し）：at は倉庫の write.live ⑫ と同じ字で見る（表は ok／err だけ）
  const at = (k, ops) => { const r = run(k, ops); return r.ok ? 'ok' : r.res.err + '@' + r.res.at; };
  ok('2c-3b：無い id（c:zz）は bad at kind', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:zz', add: 1 }]) === 'bad@kind');
  ok('2c-3b：無い id と部屋に居ない人が両方なら at kind', at('cust', [{ op: 'extra_set', table_id: 't1', member_id: 'zz', kind: 'c:zz', value: 1, base_version: 0 }]) === 'bad@kind');
  ok('2c-3b：外へ払う種へ −1（行なし）は bad at add', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: -1 }]) === 'bad@add');
  ok('2c-3b：外へ払う種 +2 → −3 は bad at add', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: -3 }]) === 'bad@add');
  ok('2c-3b：外へ払う種 +2 → −2（0 まで）は ok', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: -2 }]) === 'ok');
  ok('2c-3b：外へ払う種へ −1000 は負の bad より range が先', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: -1000 }]) === 'range@add');
  ok('2c-3b：外へ払う種の extra_set −1 は bad at value', at('cust', [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'c:ba', value: -1, base_version: 0 }]) === 'bad@value');
  ok('2c-3b：外へ払う種の行に古い版で extra_set −1 は conflict より bad at value が先', at('cust', [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: 2 }, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'c:ba', value: -1, base_version: 0 }]) === 'bad@value');
  ok('2c-3b：合計0の種（c:ko）は負も ok', at('cust', [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'c:ko', value: -5, base_version: 0 }]) === 'ok');
  ok('2c-3b：外へ払う種の extra_set −1000 は range が先', at('cust', [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'c:ba', value: -1000, base_version: 0 }]) === 'range@value');
  // kindOf＝mj_w_kind（schema.sql:1564）の端：rules が無い・null の項目・配列でない tane_custom でも落ちずに null
  const TC = [{ id: 'ko', name: 'コイン', pt10: 5, sum0: true }, { id: 'ba', name: '場代', pt10: 10, sum0: false }];
  const kc = [
    [kindOf({ chip_pt10: 20 }, 'chip'), 'sum0'], [kindOf({ chip_pt10: null }, 'chip'), null], [kindOf({}, 'shugi'), 'sum0'], [kindOf(null, 'chip'), 'sum0'], [kindOf(undefined, 'shugi'), 'sum0'],
    [kindOf({ tane_custom: TC }, 'c:ko'), 'sum0'], [kindOf({ tane_custom: TC }, 'c:ba'), 'out'], [kindOf({ tane_custom: TC }, 'c:zz'), null],
    [kindOf(null, 'c:ko'), null], [kindOf(undefined, 'c:ko'), null], [kindOf({ tane_custom: 'x' }, 'c:ko'), null], [kindOf({ tane_custom: [null, TC[0]] }, 'c:ko'), 'sum0'], [kindOf({}, 'c:ko'), null],
    [kindOf({ tane_custom: TC }, 'c:'), null], [kindOf({ tane_custom: TC }, 'c:KO'), null], [kindOf({ tane_custom: TC }, 'c:123456789'), null], [kindOf({ tane_custom: TC }, 'ko'), null], [kindOf({ tane_custom: TC }, 1), null], [kindOf({ tane_custom: TC }, null), null],
  ];
  ok('2c-3b：kindOf の端 ' + kc.length + ' 通り（mj_w_kind と同じ答え）', kc.every(([g, w]) => g === w), J(kc.map(([g, w], i) => (g === w ? null : i + ':' + g)).filter(Boolean)));

  // tableView：c: の行で落ちない・missing の順と形（1つの種に1件・ng を先）・dim・tane_custom に無い id は数えない
  const tv = (ops) => { let st2 = base('cust'); if (ops.length) { const s2 = applyOps(st2, ops, { now: '2026-11-20T12:00:00Z' }); if (!s2.ok) return null; st2 = s2.state; } st2.extras.push(...(ops.extraRaw || [])); return tableView(st2, 't1'); };
  const v0 = tv([]);
  ok('2c-3b：c: の行が無い卓は今まで通り（missing は半荘だけ・dim なし・cust は2種）', v0 && v0.extrasOk && !v0.custWait && v0.cust.length === 2 && v0.windows.every((w) => !w.dim) && !v0.missing.some((m) => m.what));
  const v1 = tv([{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ko', add: 3 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'c:ba', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: 1 }]);
  ok('2c-3b：c:ko 合計3（ng）と c:ba（外へ払う・行あり）→ missing は chip → c:ko(diff 3) → c:ba(not_yet)・extrasOk false・dim',
    v1 && !v1.extrasOk && v1.custWait && J(v1.missing.filter((m) => m.what)) === J([{ what: 'chip', diff: 1 }, { what: 'c:ko', name: 'コイン', diff: 3 }, { what: 'c:ba', name: '場代', why: 'not_yet' }]) && v1.windows.every((w) => w.dim), J(v1 && v1.missing));
  const v1b = tv([{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ko', add: 3 }]);
  ok('2c-3b：c:ko だけ合わない（chip・shugi は合う）→ extrasOk false（倉庫の extra_state ng）・missing は c:ko の1件', v1b && !v1b.extrasOk && J(v1b.missing.filter((m) => m.what)) === J([{ what: 'c:ko', name: 'コイン', diff: 3 }]), J(v1b && v1b.missing));
  const v2 = tv([{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ko', add: 3 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'c:ko', add: -3 }]);
  ok('③-2：合計0の種が合っていれば数える（missing 無し・extrasOk・dim なし・m1 custPt10 +15・m2 −15）', v2 && v2.extrasOk && !v2.custWait && !v2.missing.some((m) => m.what) && v2.windows.every((w) => !w.dim) && v2.windows.find((w) => w.member_id === 'm1').custPt10 === 15 && v2.windows.find((w) => w.member_id === 'm2').custPt10 === -15, J(v2 && v2.missing));
  const v3 = tv(Object.assign([], { extraRaw: [{ table_id: 't1', member_id: 'm5', kind: 'c:qq', value: 4, version: 1 }] }));
  ok('2c-3b：tane_custom に無い c:qq の行は数えない（missing 無し・人にも入れない・dim なし）', v3 && v3.extrasOk && !v3.missing.some((m) => m.what) && !v3.people.some((p) => p.member_id === 'm5') && v3.windows.every((w) => !w.dim), J(v3 && v3.missing));
  const v4 = tv(Object.assign([], { extraRaw: [{ table_id: 't1', member_id: 'm5', kind: 'c:ba', value: 1, version: 1 }] }));
  ok('2c-3b：数える c: の 0 でない行の人（席にいない m5）は人に入る', v4 && v4.people.some((p) => p.member_id === 'm5') && v4.missing.some((m) => m.what === 'c:ba'));
  const sx = applyOps(base('cust'), [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'c:ba', add: 2 }]).state;
  const ss = sessionSeisan(sx, 's1');
  ok('2c-3b：開催の精算の missing に c: の項目が上がる（＝画面は partial で額を出さない）', ss.ok && ss.missing.some((m) => m.what === 'c:ba' && m.why === 'not_yet' && m.table === 1), J(ss.missing));
}

console.log('■ 名簿');
{
  const st = base();
  const r = applyOp(st, { op: 'member_add', member_id: 'm9', name: 'やまだ' });
  ok('ひらがなとカタカナ違いは別の字（山田 と やまだ は別）', r.ok);
  const r2 = applyOp(st, { op: 'member_add', member_id: 'm10', name: 'ヤマダ' });
  ok('やまだ と ヤマダ は同じ人＝dup（先の member_id と名を返す）', !r2.ok && r2.err === 'dup' && r2.member_id === 'm9' && r2.name === 'やまだ', J(r2));
  const r3 = applyOp(st, { op: 'member_add', member_id: 'm11', name: ' 山 田 ' });
  ok('空白を消すと同じ＝dup', !r3.ok && r3.err === 'dup' && r3.member_id === 'm1', J(r3));
  ok('同じ member_id の送り直しは成功（2人にしない）', applyOp(st, { op: 'member_add', member_id: 'm1', name: '山田' }).ok && st.members.length === 5, String(st.members.length));
  const r4 = applyOp(st, { op: 'member_add', member_id: 'm12', name: '  伊藤  ' });
  ok('名は trim して残す', r4.ok && st.members.find((m) => m.member_id === 'm12').name === '伊藤');
  const st2 = base();
  st2.members.find((m) => m.member_id === 'm1').active = false;
  ok('active でない人と同じ名前は通る', applyOp(st2, { op: 'member_add', member_id: 'm13', name: '山田' }).ok);
}

console.log('■ 半荘を入れる・組ごと当てる・版は1始まり');
{
  const st0 = base();
  const bad = applyOps(st0, [
    { op: 'member_add', member_id: 'm5', name: '渡辺' },
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm9'], cells: [42300, 31000, 18200, 8500] },
  ]);
  ok('組の中の1つが弾かれたら組ごと当てない（人も足さない）', !bad.ok && bad.idx === 1 && bad.state.members.length === 4 && bad.res.i === 1, J(bad.res));
  const r = applyOps(st0, [
    hs('h1', [42300, 31000, 18200, 8500]),
    hs('h2', [20100, 11600, 38900, 29400]),
    hs('h3', [33200, 45700, 5300, 15800]),
  ]);
  ok('3回入る', r.ok && r.state.hanchans.length === 3);
  const h1 = H(r.state, 'h1');
  ok('作った時の版は全部1（cell_ver・order_version・version・tobi_version）', J(h1.cell_ver) === J([1, 1, 1, 1]) && h1.order_version === 1 && h1.version === 1 && h1.tobi_version === 1, J(h1));
  ok('tobi_to は {}（null にしない）・ton_order は無ければ null', J(h1.tobi_to) === '{}' && h1.ton_order === null);
  ok('卓は st.rules を写す・label を持つ', r.state.tables[0].label === '卓1' && r.state.tables[0].rules.chip_pt10 === 20);
  const v = tableView(r.state, 't1');
  ok('1回目の pt（絵の数を五捨六入で丸めた物）', J(SEATS.map((m) => v.rows[0].by[m].pt10)) === J([520, 110, -220, -410]), J(v.rows[0].by));
  ok('順位', J(SEATS.map((m) => v.rows[0].by[m].rank)) === J([0, 1, 2, 3]));
  ok('計の合計は0', Object.values(v.total10).reduce((a, b) => a + b, 0) === 0, J(v.total10));
  ok('次は4回目', v.nextNo === 4);
  ok('入っていない物 0', v.missing.length === 0, J(v.missing));
  const noRules = applyOps(applyOps(emptyState(), [{ op: 'session_add', session_id: 's', date: '2026-11-20', rate: null }]).state, [{ op: 'table_add', table_id: 't', session_id: 's', label: '卓1' }]);
  ok('部屋のルールが写しに無ければ table_add は bad', !noRules.ok && noRules.res.err === 'bad', J(noRules.res));
  const vs = base(); vs.sessions[0].voided = true;
  ok('取り消した開催に table_add は bad', applyOp(vs, { op: 'table_add', table_id: 't9', session_id: 's1', label: '卓2' }).err === 'bad');
  const vt = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state; vt.tables[0].voided = true;
  ok('取り消した卓に hanchan_start は bad', applyOp(vt, hs('h2', [40000, 30000, 20000, 10000])).err === 'bad');
}

console.log('■ 合わない半荘は計に入れず、訳を出す・消えた供託');
{
  const st = applyOps(base({ ...rules, kyotaku_end: 'kieru' }), [
    hs('h1', [40000, 30000, 20000, 10000]),
    hs('h2', [40000, 30000, 20000, 9000]),
  ]).state;
  const v = tableView(st, 't1');
  ok('2回目は sum・差 −1000', !v.rows[1].ok && v.rows[1].why === 'sum' && v.rows[1].diff === -1000, J(v.rows[1]));
  ok('計は1回目だけ', J(v.total10) === J({ m1: 500, m2: 100, m3: -200, m4: -400 }), J(v.total10));
  ok('入っていない物に2回目', J(v.missing) === J([{ no: 2, why: 'sum', diff: -1000 }]), J(v.missing));
  const r = applyOp(st, { op: 'kyotaku_set', hanchan_id: 'h2', value: 1000, base_version: 1 });
  const v2 = tableView(st, 't1');
  ok('消えた供託 1000 を入れると合う・version 2', r.ok && v2.rows[1].ok && H(st, 'h2').version === 2, J(v2.rows[1]));
  ok('同じ値は古い版でも ok（書かない・版は上がらない）', applyOp(st, { op: 'kyotaku_set', hanchan_id: 'h2', value: 1000, base_version: 1 }).ok && H(st, 'h2').version === 2);
  const c = applyOp(st, { op: 'kyotaku_set', hanchan_id: 'h2', value: 2000, base_version: 1 });
  ok('古い版で違う値は conflict（今の値と版）', c.err === 'conflict' && J(c.cur) === J({ value: 1000, version: 2 }), J(c));
  ok('lost_ver は持たない', !('lost_ver' in H(st, 'h2')));
}

console.log('■ 版（cell_set）と conflict');
{
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  ok('版1で直せる', applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 1 }).ok && H(st, 'h1').cell_ver[0] === 2);
  const c = applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 39000, base_version: 1 });
  ok('古い版で直すと conflict（今の値と版を返す）', !c.ok && c.err === 'conflict' && J(c.cur) === J({ value: 41000, version: 2 }), J(c));
  ok('同じ値なら古い版でも成功', applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 1 }).ok);
  ok('ほかの席の版は動かない', J(H(st, 'h1').cell_ver) === J([2, 1, 1, 1]));
}

console.log('■ 取り消し（void・unvoid）は version を上げる');
{
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  ok('void で version 2', applyOp(st, { op: 'hanchan_void', hanchan_id: 'h1' }).ok && H(st, 'h1').version === 2 && H(st, 'h1').voided);
  ok('もう一度 void は同じ値＝版は上がらない', applyOp(st, { op: 'hanchan_void', hanchan_id: 'h1' }).ok && H(st, 'h1').version === 2);
  ok('unvoid で version 3', applyOp(st, { op: 'hanchan_unvoid', hanchan_id: 'h1' }).ok && H(st, 'h1').version === 3 && !H(st, 'h1').voided);
  const v = tableView(applyOps(st, [{ op: 'hanchan_void', hanchan_id: 'h1' }]).state, 't1');
  ok('取り消した半荘は計に入れず、入っていない物にも数えない', J(v.total10) === '{}' && v.missing.length === 0 && v.rows[0].voided, J(v));
}

console.log('■ 同点の順（ton_order＝member_id の配列）と飛び賞の受け取り（tobi_set まるごと）');
{
  const st = applyOps(base(), [
    hs('h1', [35400, 35400, 15100, 14100]),
    hs('h2', [50000, 30000, 25000, -5000]),
  ]).state;
  let v = tableView(st, 't1');
  ok('同点で順が無いと order', v.rows[0].why === 'order', J(v.rows[0]));
  ok('B2：飛んでも受け取りを待たない（ok・why null）', v.rows[1].ok && v.rows[1].why === null, J(v.rows[1]));
  ok('順を入れる（版1）', applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m2', 'm1', 'm3', 'm4'], base_version: 1 }).ok && H(st, 'h1').order_version === 2);
  ok('受け取りを入れる（版1・まるごと）', applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: { 3: 0 }, base_version: 1 }).ok && J(H(st, 'h2').tobi_to) === J({ 3: 0 }) && H(st, 'h2').tobi_version === 2);
  v = tableView(st, 't1');
  ok('順を入れると上家（鈴木）が1位', v.rows[0].ok && v.rows[0].by.m2.pt10 === 460 && v.rows[0].by.m1.pt10 === 150, J(v.rows[0].by));
  ok('B2：受け取りを入れても飛び賞は半荘の pt に入らない（山田 55・高橋 −50）', v.rows[1].ok && v.rows[1].by.m1.pt10 === 550 && v.rows[1].by.m4.pt10 === -500, J(v.rows[1].by));
  ok('順の同じ値は古い版でも ok', applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m2', 'm1', 'm3', 'm4'], base_version: 1 }).ok);
  const oc = applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m1', 'm2', 'm3', 'm4'], base_version: 1 });
  ok('順の古い版で違う値は conflict', oc.err === 'conflict' && oc.cur.version === 2 && J(oc.cur.value) === J(['m2', 'm1', 'm3', 'm4']), J(oc));
  ok('tobi_set はまるごと置き換え（空にすると鍵が消える・B2＝半荘は待たない）', applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: {}, base_version: 2 }).ok && J(H(st, 'h2').tobi_to) === '{}' && tableView(st, 't1').rows[1].ok);
  ok('tobi_set の同じ値（鍵の順違い）は古い版でも ok', (() => { applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: { 3: 0, 2: 1 }, base_version: 3 }); return applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: { 2: 1, 3: 0 }, base_version: 1 }).ok; })());
  ok('hanchan_start の ton_order と tobi_to をそのまま持つ', (() => { const r = applyOp(st, hs('h3', [50000, 30000, 25000, -5000], { ton_order: ['m4', 'm3', 'm2', 'm1'], tobi_to: { 3: 'all' } })); const h = H(st, 'h3'); return r.ok && J(h.ton_order) === J(['m4', 'm3', 'm2', 'm1']) && J(h.tobi_to) === J({ 3: 'all' }); })());
  ok('checkEntry：同点は順が要る', checkEntry(rules, [35400, 35400, 15100, 14100]).needOrder === true);
  ok('checkEntry：飛んだ席', J(checkEntry(rules, [50000, 30000, 25000, -5000]).busted) === J([3]));
  ok('checkEntry：合計が合わない', J(checkEntry(rules, [40000, 30000, 20000, 9000])) === J({ ok: false, why: 'sum', diff: -1000 }));
}

console.log('■ §4 の鍵消し（組の初めに飛んでいなかった席が終わりに飛んでいて・鍵が在り・組に tobi_set も hanchan_start も無い時だけ）');
{
  // h1：席3 は 10000（飛んでいない）だが前の受け取りの鍵 '3':0 が残っている
  const mk = (R = rules) => applyOps(base(R), [hs('h1', [40000, 30000, 20000, 10000], { tobi_to: { 3: 0 } })]).state;
  const busted = [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: -5000, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 55000, base_version: 1 }];
  const r1 = applyOps(mk(), busted);
  ok('4つ全部そろうと鍵を消して tobi_version+1', r1.ok && J(H(r1.state, 'h1').tobi_to) === '{}' && H(r1.state, 'h1').tobi_version === 2, J(H(r1.state, 'h1')));
  ok('B2：消した後も半荘は待たない（鍵消しはお金に効かない）', tableView(r1.state, 't1').rows[0].ok && tableView(r1.state, 't1').rows[0].why === null);
  const r2 = applyOps(mk(), [...busted, { op: 'tobi_set', hanchan_id: 'h1', tobi_to: { 3: 0 }, base_version: 1 }]);
  ok('組に同じ半荘の tobi_set が在れば消さない', r2.ok && J(H(r2.state, 'h1').tobi_to) === J({ 3: 0 }) && H(r2.state, 'h1').tobi_version === 1, J(H(r2.state, 'h1')));
  const r3 = applyOps(base(), [hs('h1', [55000, 30000, 20000, -5000], { tobi_to: { 3: 0 } }), { op: 'cell_set', hanchan_id: 'h1', seat: 1, value: 30000, base_version: 1 }]);
  ok('組に同じ半荘の hanchan_start が在れば消さない', r3.ok && J(H(r3.state, 'h1').tobi_to) === J({ 3: 0 }));
  const st4 = applyOps(base(), [hs('h1', [55000, 30000, 20000, -5000], { tobi_to: { 3: 0 } })]).state;
  const r4 = applyOps(st4, [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: -6000, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 56000, base_version: 1 }]);
  ok('組の初めから飛んでいた席は消さない', r4.ok && J(H(r4.state, 'h1').tobi_to) === J({ 3: 0 }) && H(r4.state, 'h1').tobi_version === 1);
  const st5 = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  const r5 = applyOps(st5, busted);
  ok('鍵が無ければ何もしない（版も上げない）', r5.ok && J(H(r5.state, 'h1').tobi_to) === '{}' && H(r5.state, 'h1').tobi_version === 1);
  const r6 = applyOps(st4, [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: 5000, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 45000, base_version: 1 }]);
  ok('飛ばなくなった席の鍵は消さない（使わないだけ）', r6.ok && J(H(r6.state, 'h1').tobi_to) === J({ 3: 0 }));
  const zeroOps = [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: 0, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 50000, base_version: 1 }];
  const r7 = applyOps(mk({ ...rules, tobi_zero: true }), zeroOps);
  ok('tobi_zero なら 0 も飛び＝消す', r7.ok && J(H(r7.state, 'h1').tobi_to) === '{}');
  const r8 = applyOps(mk({ ...rules, tobi_zero: false }), zeroOps);
  ok('tobi_zero でなければ 0 は飛びでない＝消さない', r8.ok && J(H(r8.state, 'h1').tobi_to) === J({ 3: 0 }));
  ok('ルールの tobi が false なら消さない', J(H(applyOps(mk({ ...rules, tobi: false }), busted).state, 'h1').tobi_to) === J({ 3: 0 }));
  ok('弾いた組では消さない', (() => { const s = mk(); const r = applyOps(s, [...busted, { op: 'cell_set', hanchan_id: 'h1', seat: 1, value: 1, base_version: 1 }]); return !r.ok && J(H(s, 'h1').tobi_to) === J({ 3: 0 }); })());
}

console.log('■ 直す画面の tobi_set（tobiSetOp・v5 止め1）');
{
  const mk = () => applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000], { tobi_to: { 3: 0 } })]).state;
  const busted = [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: -5000, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 55000, base_version: 1 }];
  const st = mk();
  const t = tobiSetOp(st, busted, 'h1', { 3: 0 });
  ok('また飛んで同じ人を選んだ＝鍵消しの後と比べるので tobi_set を足す', t && t.op === 'tobi_set' && J(t.tobi_to) === J({ 3: 0 }) && t.base_version === 1, J(t));
  const r = applyOps(st, [...busted, t]);
  ok('足した組を当てると鍵は消えずに残る（倉庫でも同じ）', r.ok && J(H(r.state, 'h1').tobi_to) === J({ 3: 0 }), J(H(r.state, 'h1')));
  ok('写しの tobi_to とだけ比べると送らず、組だけでは鍵が消える＝試験が穴を捉える', J(H(applyOps(st, busted).state, 'h1').tobi_to) === '{}' && J(H(st, 'h1').tobi_to) === J({ 3: 0 }));
  const s2 = applyOps(base(), [hs('h1', [55000, 30000, 20000, -5000], { tobi_to: { 3: 0 } })]).state;
  ok('飛んだままで同じ人＝送らない（null）', tobiSetOp(s2, [{ op: 'cell_set', hanchan_id: 'h1', seat: 1, value: 30000, base_version: 1 }], 'h1', { 3: 0 }) === null);
  ok('組が空でも比べる（人だけ替えた）', J(tobiSetOp(s2, [], 'h1', { 3: 1 })) === J({ op: 'tobi_set', hanchan_id: 'h1', tobi_to: { 3: 1 }, base_version: 1 }));
  ok('飛んでいない席の古い鍵は片付ける（違う＝送る）', J(tobiSetOp(mk(), [], 'h1', {})) === J({ op: 'tobi_set', hanchan_id: 'h1', tobi_to: {}, base_version: 1 }));
  ok('無い半荘は null', tobiSetOp(st, [], 'nai', {}) === null);
  ok('写しを触らない', J(H(st, 'h1').tobi_to) === J({ 3: 0 }) && H(st, 'h1').cells[3] === 10000);
}

console.log('■ 人ごとの窓（絵の形）・チップ・祝儀（extra_add・±999）');
{
  const st = applyOps(base(), [
    hs('h1', [40000, 30000, 20000, 10000]),
    { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 3 },
    { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -1 },
  ]).state;
  let v = tableView(st, 't1');
  ok('チップが合わない間は薄く（dim）・窓の数にチップを入れない', v.windows.every((w) => w.dim) && v.windows[0].big === 5000, J(v.windows[0]));
  ok('合わない訳は missing に1つ（chip +2）', J(v.missing) === J([{ what: 'chip', diff: 2 }]), J(v.missing));
  ok('extras の版は作った時1・足すと+1', st.extras.find((x) => x.member_id === 'm1').version === 1 && applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }).ok && st.extras.find((x) => x.member_id === 'm1').version === 2);
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 });
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'chip', add: -2 });
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'shugi', add: 2 });
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm3', kind: 'shugi', add: -2 });
  v = tableView(st, 't1');
  const w = Object.fromEntries(v.windows.map((x) => [x.member_id, x]));
  ok('山田の窓＝+5,800（チップ +600・祝儀 +200）', !w.m1.dim && w.m1.big === 5800 && w.m1.chipBig === 600 && w.m1.shugiBig === 200, J(w.m1));
  ok('窓の合計は0', v.windows.reduce((a, x) => a + x.big, 0) === 0);
  const s = sessionSeisan(st, 's1');
  ok('精算の点は窓と同じ', s.ok && s.ten.m1 === 5800, J(s));
  ok('誰が誰に（3回まで）', s.ok && s.pay.length <= 3 && s.pay.reduce((a, x) => a + x.ten, 0) === 5800 + w.m2.big, J(s.pay));
  const sv = applyOps(st, [{ op: 'hanchan_void', hanchan_id: 'h1' }]).state;
  ok('席が取り消しだけでも、卓に行が在る人は足せる（v1510:116）', applyOp(sv, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }).ok);
  const old = clone(st); old.extras.find((x) => x.member_id === 'm1' && x.kind === 'chip').value = 1500;
  ok('±999 の外の行は 0 に近づく向きなら通す（古い写し）', applyOp(old, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }).ok && old.extras.find((x) => x.member_id === 'm1' && x.kind === 'chip').value === 1499);
  ok('±999 の外の行で遠ざかる向きは range', applyOp(old, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }).err === 'range');
}

console.log('■ レートなしの卓・チップを使わない卓');
{
  const r2 = { ...defaultRules(4) }; // rate null・chip/shugi null
  const st = applyOps(withRules(r2), [
    { op: 'member_add', member_id: 'a', name: 'A' }, { op: 'member_add', member_id: 'b', name: 'B' },
    { op: 'member_add', member_id: 'c', name: 'C' }, { op: 'member_add', member_id: 'd', name: 'D' },
    { op: 'session_add', session_id: 's', date: '2026-11-20', rate: null },
    { op: 'table_add', table_id: 't', session_id: 's', label: '卓1' },
    { op: 'hanchan_start', hanchan_id: 'h', table_id: 't', seats: ['a', 'b', 'c', 'd'], cells: [40000, 30000, 20000, 10000] },
  ]).state;
  const v = tableView(st, 't');
  ok('レートなしは大きく pt（unit pt）', v.windows[0].unit === 'pt' && v.windows[0].big === 500, J(v.windows[0]));
  ok('チップ・祝儀を使わない卓は used false', v.used.chip === false && v.used.shugi === false);
  const s = sessionSeisan(st, 's');
  ok('レートなしの卓は点に混ぜない', s.ok && J(s.ten) === '{}' && s.pt10NoRate.a === 500 && J(s.noRateTables) === J([1]), J(s));
}

console.log('■ 締め（settle_snap＝content・used・missing・at は opts.now）');
{
  const b = base();
  const content = { ten: { m1: 500 }, pt10: {}, pt10NoRate: {}, pay: [], sig: 'x' };
  const used = { session: { session_id: 's1', date: '2026-11-20', rate: 100 }, tables: [], hanchans: [] };
  const snap = (rev, c = content) => ({ op: 'settle_snap', session_id: 's1', rev, content: c, used, missing: [] });
  const r1 = applyOps(b, [snap(1)], { now: '2026-11-20T01:33:00Z' });
  ok('1回目の締めは rev 1 で残る・at は opts.now', r1.ok && r1.state.settles.length === 1 && r1.state.settles[0].content.ten.m1 === 500 && r1.state.settles[0].at === '2026-11-20T01:33:00Z', J(r1.state && r1.state.settles));
  ok('写しは content・used・missing を持つ（snap は持たない）', (() => { const x = r1.state.settles[0]; return J(x.used) === J(used) && J(x.missing) === '[]' && !('snap' in x); })());
  ok('残した中身は送った物の写し（後で触っても変わらない）', (() => { const c = clone(content); const r = applyOps(b, [snap(1, c)]); c.ten.m1 = 1; return r.state.settles[0].content.ten.m1 === 500; })());
  const r2 = applyOps(r1.state, [snap(1)], { now: '2026-11-20T01:34:00Z' });
  ok('同じ rev で同じ中身の送り直しは足さない（at も変えない）', r2.ok && r2.state.settles.length === 1 && r2.state.settles[0].at === '2026-11-20T01:33:00Z', J(r2));
  const r2b = applyOps(r1.state, [snap(1, { ...content, ten: { m1: 600 } })]);
  ok('同じ rev で違う中身は conflict', !r2b.ok && r2b.res.err === 'conflict', J(r2b.res));
  ok('次の rev 2 は通る', applyOps(r1.state, [snap(2)]).ok);
  const r3 = applyOps(r1.state, [snap(3)]);
  ok('飛んだ rev は conflict', !r3.ok && r3.res.err === 'conflict', J(r3));
  const r4 = applyOps(b, [{ ...snap(1), session_id: 'nai' }]);
  ok('無い開催日は bad', !r4.ok && r4.res.err === 'bad', J(r4));
  const old = clone(b); delete old.settles;
  const r5 = applyOps(old, [snap(1)]);
  ok('settles の無い古い写しにも当たる', r5.ok && r5.state.settles.length === 1, J(r5));
  const r6 = applyOps(b, [snap(1, { big: 'x'.repeat(33000) })]);
  ok('3つ合わせて 32KB 超えは range', !r6.ok && r6.res.err === 'range', J(r6.res));
  const r7 = applyOps(b, [snap(1, { big: 'あ'.repeat(11000) })]);
  ok('32KB は UTF-8 のバイトで数える（あ 11,000字＝33,000 バイト）', !r7.ok && r7.res.err === 'range', J(r7.res));
  ok('あ 10,000字（30,000 バイト）は通る', applyOps(b, [snap(1, { big: 'あ'.repeat(10000) })]).ok);
}

console.log('■ 続ける開催（pickSession＝［対局終了］を押した時だけ区切る・時間や日付で決めない・司さん 11-20 19時）');
{
  const end = (st, sid, rev = 1) => applyOps(st, [{ op: 'settle_snap', session_id: sid, rev, content: { ten: sessionSeisan(st, sid).ten, pay: [], sig: sessionSig(st, sid) }, used: {}, missing: [] }], { now: '2026-11-21T04:00:00+09:00' }).state;
  ok('開催が無ければ null（新しく作る）', pickSession(emptyState()) === null);
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  ok('終えていなければ続ける（何日・何時間空いても・日を跨いでも）', pickSession(st) === 's1');
  ok('pickSession は時刻を受け取らない（引数1つ）', pickSession.length === 1);
  const ended = end(st, 's1');
  ok('［対局終了］の後に開けば新しい開催（null）', pickSession(ended) === null);
  const two = applyOps(ended, [{ op: 'session_add', session_id: 's2', date: '2026-11-21', rate: 100 }, { op: 'table_add', table_id: 't2', session_id: 's2', label: '卓1' }, { ...hs('h9', [40000, 30000, 20000, 10000]), table_id: 't2' }]).state;
  ok('新しい開催を作った後はそれを続ける', pickSession(two) === 's2');
  ok('終えた開催の半荘は消えない', two.hanchans.some((h) => h.hanchan_id === 'h1') && sessionSeisan(two, 's1').ok && J(sessionSeisan(two, 's1').ten) === J(sessionSeisan(st, 's1').ten));
  const more = applyOps(ended, [hs('h2', [10000, 20000, 30000, 40000])]).state;
  ok('終えた後に（開いたままの画面で）足しても、次に開けば新しい開催', pickSession(more) === null);
  ok('終え直し（rev 2）も終えたまま', pickSession(end(more, 's1', 2)) === null);
  const vo = clone(two); vo.sessions[1].voided = true;
  ok('取り消した開催は飛ばす（前の開催は終えているので新しく）', pickSession(vo) === null);
  const vo2 = clone(st); vo2.sessions.push({ ...vo2.sessions[0], session_id: 'sx', voided: true });
  ok('取り消した開催は飛ばす（前の開催が終えていなければ続ける）', pickSession(vo2) === 's1');
  const nosettles = clone(st); delete nosettles.settles;
  ok('settles の無い古い写しでも続ける', pickSession(nosettles) === 's1');
  ok('別の開催の締めでは区切らない', pickSession(end(two, 's1', 2)) === 's2');
  const sig0 = sessionSig(ended, 's1');
  ok('印：半荘を足すと変わる', sessionSig(more, 's1') !== sig0);
  const chip = applyOps(ended, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }]).state;
  ok('印：チップだけでも変わる', sessionSig(chip, 's1') !== sig0);
  const back = applyOps(chip, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }]).state;
  ok('印：打ち消して同じ数に戻しても変わる（版が進んだ）', sessionSig(back, 's1') !== sig0);
  ok('印：取り消すと変わる', sessionSig(applyOps(ended, [{ op: 'hanchan_void', hanchan_id: 'h1' }]).state, 's1') !== sig0);
}

console.log('■ 直す op 6個（2c-2a2＝倉庫 schema.sql の mj_write と同じ答え）');
{
  const mk = () => applyOps(base(), [{ op: 'member_add', member_id: 'm5', name: '渡辺' }, hs('h1', [40000, 30000, 20000, 10000], { ton_order: ['m4', 'm3', 'm2', 'm1'] })]).state;
  const M = (st, id) => st.members.find((m) => m.member_id === id);
  const T = (st) => st.tables.find((t) => t.table_id === 't1');
  const S = (st) => st.sessions.find((s) => s.session_id === 's1');
  const one = (st, op) => applyOps(st, [op]);
  const err = (r) => (r.ok ? 'ok' : r.res.err + '@' + r.res.at);
  // member_rename
  const st = mk();
  let r = one(st, { op: 'member_rename', member_id: 'm1', name: '　山本 ' });
  const keyOf = (nm) => M(applyOps(withRules(rules), [{ op: 'member_add', member_id: 'x', name: nm }]).state, 'x').name_key;
  ok('member_rename：前後の空白を削って名と name_key を替える', r.ok && M(r.state, 'm1').name === '山本' && M(r.state, 'm1').name_key === keyOf('山本'), J(r.res));
  const d = one(st, { op: 'member_rename', member_id: 'm1', name: '鈴木' });
  ok('member_rename：他の active と同じ名＝dup（at name・相手の id と名）', d.res.err === 'dup' && d.res.at === 'name' && d.res.member_id === 'm2' && d.res.name === '鈴木', J(d.res));
  ok('member_rename：同じ名は書かずに ok・自分の name_key は dup にしない', one(st, { op: 'member_rename', member_id: 'm1', name: '山田' }).ok && one(st, { op: 'member_rename', member_id: 'm1', name: ' 山田' }).ok);
  ok('member_rename：21字・空白だけ・字でない・無い人は bad', err(one(st, { op: 'member_rename', member_id: 'm1', name: 'あ'.repeat(21) })) === 'bad@name' && err(one(st, { op: 'member_rename', member_id: 'm1', name: ' 　' })) === 'bad@name' && err(one(st, { op: 'member_rename', member_id: 'm1', name: 1 })) === 'bad@name' && err(one(st, { op: 'member_rename', member_id: 'm9', name: 'x' })) === 'bad@member_id');
  // member_active
  r = one(st, { op: 'member_active', member_id: 'm2', active: false });
  ok('member_active：使わない印にできる', r.ok && M(r.state, 'm2').active === false);
  const off = applyOps(r.state, [{ op: 'member_add', member_id: 'm6', name: '鈴木' }]);
  const on = off.ok ? one(off.state, { op: 'member_active', member_id: 'm2', active: true }) : null;
  ok('使わない人と同じ名の人は作れる・戻すと dup（at active・相手の id）', off.ok && on && err(on) === 'dup@active' && on.res.member_id === 'm6', J(on && on.res));
  ok('member_active：同じ値は ok・boolean でないと bad', one(st, { op: 'member_active', member_id: 'm1', active: true }).ok && err(one(st, { op: 'member_active', member_id: 'm1', active: 'false' })) === 'bad@active' && err(one(st, { op: 'member_active', member_id: 'm1', active: null })) === 'bad@active');
  // session_edit
  r = one(st, { op: 'session_edit', session_id: 's1', rate: 50, place: '駅前' });
  ok('session_edit：レートと場所を直す＝卓（開催日のまま）のレートも替わる', r.ok && S(r.state).rate === 50 && S(r.state).place === '駅前' && tableRate(T(r.state), S(r.state)) === 50, J(S(r.state)));
  const r2 = one(r.state, { op: 'session_edit', session_id: 's1', rate: null, place: null });
  ok('session_edit：rate・place は null で消す', r2.ok && S(r2.state).rate === null && !('place' in S(r2.state)), J(S(r2.state)));
  ok('session_edit：rate 15 は range・"100" と 1.5 は bad・無い日と null の date は bad・place 41字は bad', err(one(st, { op: 'session_edit', session_id: 's1', rate: 15 })) === 'range@rate' && err(one(st, { op: 'session_edit', session_id: 's1', rate: '100' })) === 'bad@rate' && err(one(st, { op: 'session_edit', session_id: 's1', rate: 1.5 })) === 'bad@rate' && err(one(st, { op: 'session_edit', session_id: 's1', date: '2026-02-30' })) === 'bad@date' && err(one(st, { op: 'session_edit', session_id: 's1', date: null })) === 'bad@date' && err(one(st, { op: 'session_edit', session_id: 's1', place: 'あ'.repeat(41) })) === 'bad@place');
  ok('session_edit：league_id・rule_set_id は知らない鍵＝bad（K-1）', err(one(st, { op: 'session_edit', session_id: 's1', league_id: 'L1' })) === 'bad@league_id' && err(one(st, { op: 'session_edit', session_id: 's1', rule_set_id: 'x' })) === 'bad@rule_set_id');
  const sv = one(st, { op: 'session_edit', session_id: 's1', voided: true });
  const unv = sv.ok ? one(sv.state, { op: 'session_edit', session_id: 's1', voided: false }) : null;
  ok('session_edit：取り消した開催は精算を出さない・その卓へチップは bad（at table_id）・戻せる', sv.ok && sessionSeisan(sv.state, 's1').err === 'voided' && err(one(sv.state, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 })) === 'bad@table_id' && unv && unv.ok && sessionSeisan(unv.state, 's1').ok);
  ok('session_edit：voided が boolean でないと bad・無い開催は bad', err(one(st, { op: 'session_edit', session_id: 's1', voided: 1 })) === 'bad@voided' && err(one(st, { op: 'session_edit', session_id: 's9', rate: 100 })) === 'bad@session_id');
  // table_edit
  r = one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'num', rate: 30, label: ' 奥の卓 ' });
  ok('table_edit：数のレート・label は削って入れる', r.ok && T(r.state).rate_mode === 'num' && T(r.state).rate === 30 && T(r.state).label === '奥の卓' && tableRate(T(r.state), S(r.state)) === 30 && roomGate(r.state).mode === 'ok', J(T(r.state)));
  const back = one(r.state, { op: 'table_edit', table_id: 't1', rate_mode: 'session' });
  ok('table_edit：session に戻すと写しが rate を消す（門も ok）', back.ok && !('rate' in T(back.state)) && tableRate(T(back.state), S(back.state)) === 100 && roomGate(back.state).mode === 'ok', J(T(back.state)));
  ok('table_edit：num で rate が今も無い・rate null は bad／num でないのに rate を送ると bad／範囲外は range', err(one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'num' })) === 'bad@rate' && err(one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'num', rate: null })) === 'bad@rate' && err(one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'none', rate: 100 })) === 'bad@rate' && err(one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'num', rate: 5 })) === 'range@rate');
  const r40 = one(r.state, { op: 'table_edit', table_id: 't1', rate: 40 });
  ok('table_edit：num の卓は rate だけ送って直せる・none に rate null は通る', r40.ok && T(r40.state).rate === 40 && one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'none', rate: null }).ok);
  ok('table_edit：rate_mode が知らない字・label 21字・players は bad', err(one(st, { op: 'table_edit', table_id: 't1', rate_mode: 'x' })) === 'bad@rate_mode' && err(one(st, { op: 'table_edit', table_id: 't1', label: 'あ'.repeat(21) })) === 'bad@label' && err(one(st, { op: 'table_edit', table_id: 't1', players: 3 })) === 'bad@players');
  const tv = one(st, { op: 'table_edit', table_id: 't1', voided: true });
  ok('table_edit：取り消した卓へ extra_set は bad（at table_id）', tv.ok && T(tv.state).voided === true && err(one(tv.state, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1, base_version: 0 })) === 'bad@table_id');
  // hanchan_seats
  r = one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m2', 'm1', 'm3', 'm4'] });
  ok('hanchan_seats：並べ替えだけなら ton_order と order_version は残す（倉庫の D2）', r.ok && J(H(r.state, 'h1').seats) === J(['m2', 'm1', 'm3', 'm4']) && J(H(r.state, 'h1').ton_order) === J(['m4', 'm3', 'm2', 'm1']) && H(r.state, 'h1').order_version === 1, J(H(r.state, 'h1')));
  r = one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m5', 'm2', 'm3', 'm4'] });
  ok('hanchan_seats：顔ぶれが変われば ton_order は null・order_version+1・素点の席と version はそのまま', r.ok && H(r.state, 'h1').ton_order === null && H(r.state, 'h1').order_version === 2 && J(H(r.state, 'h1').cells) === J([40000, 30000, 20000, 10000]) && H(r.state, 'h1').version === 1, J(H(r.state, 'h1')));
  const same = one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: SEATS });
  ok('hanchan_seats：同じ席は書かずに ok', same.ok && H(same.state, 'h1').order_version === 1);
  const in5 = applyOps(st, [{ op: 'member_active', member_id: 'm5', active: false }, { op: 'member_active', member_id: 'm1', active: false }]).state;
  ok('hanchan_seats：新しく入れる使わない人は bad・今の席の使わない人は残せる（v1510:195）', err(one(in5, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m5', 'm2', 'm3', 'm4'] })) === 'bad@seats' && one(in5, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m2', 'm1', 'm3', 'm4'] }).ok);
  ok('hanchan_seats：重なり・人数違い・部屋に無い人・字でない は bad', ['m1,m1,m3,m4', 'm1,m2,m3', 'm1,m2,m3,m9'].every((x) => err(one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: x.split(',') })) === 'bad@seats') && err(one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m1', 'm2', 'm3', 4] })) === 'bad@seats' && err(one(st, { op: 'hanchan_seats', hanchan_id: 'h1', seats: 'm1' })) === 'bad@seats');
  ok('hanchan_seats：取り消した半荘・無い半荘は bad（at hanchan_id）', err(applyOps(st, [{ op: 'hanchan_void', hanchan_id: 'h1' }, { op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m5', 'm2', 'm3', 'm4'] }])) === 'bad@hanchan_id' && err(one(st, { op: 'hanchan_seats', hanchan_id: 'h9', seats: SEATS })) === 'bad@hanchan_id');
  // extra_set（決め F）
  const X = (s2, m, k = 'chip') => s2.extras.find((x) => x.member_id === m && x.kind === k);
  const c3 = one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 3, base_version: 0 });
  ok('extra_set：行が無い時は base_version 0 で作る（版1）', c3.ok && X(c3.state, 'm1').value === 3 && X(c3.state, 'm1').version === 1);
  const cf = one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 3, base_version: 1 });
  ok('extra_set：行が無いのに base_version 1 は conflict cur{0,0}', !cf.ok && cf.res.err === 'conflict' && J(cf.res.cur) === J({ value: 0, version: 0 }), J(cf.res));
  const cf0 = one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 0, base_version: 1 });
  const z0 = one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 0, base_version: 0 });
  ok('extra_set：行が無い・value 0・base_version 1 も conflict（value 0 の ok より先）／base_version 0 なら行を作らず ok', cf0.res.err === 'conflict' && z0.ok && z0.state.extras.length === 0);
  const c2 = one(c3.state, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 5, base_version: 0 });
  const c5 = one(c3.state, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 5, base_version: 1 });
  ok('extra_set：行が在るのに base_version 0 は conflict（今の値と版）・合う版なら替えて版+1・同じ値は版を見ずに ok', c2.res.err === 'conflict' && J(c2.res.cur) === J({ value: 3, version: 1 }) && c5.ok && X(c5.state, 'm1').value === 5 && X(c5.state, 'm1').version === 2 && one(c3.state, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 3, base_version: 7 }).ok, J(c2.res));
  const k0 = one(c3.state, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 0, base_version: 1 });
  ok('extra_set：value 1000 は range・1.5 と base_version "0" は bad・0 を入れても行は残す（G）', err(one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1000, base_version: 0 })) === 'range@value' && err(one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1.5, base_version: 0 })) === 'bad@value' && err(one(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1, base_version: '0' })) === 'bad@base_version' && k0.ok && X(k0.state, 'm1').value === 0);
  const top = applyOps(base({ ...defaultRules(4), rate: 100 }), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  ok('使わない種（chip_pt10 null）への extra_set・extra_add は bad（at kind）＝倉庫の C1', err(one(top, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1, base_version: 0 })) === 'bad@kind' && err(one(top, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'shugi', add: 1 })) === 'bad@kind');
  ok('extra_set：部屋に無い人は op の時点で bad（組の門より先・applyOp だけでも）', err({ ok: false, res: applyOp(clone(st), { op: 'extra_set', table_id: 't1', member_id: 'm9', kind: 'chip', value: 1, base_version: 0 }) }) === 'bad@member_id' && err({ ok: false, res: applyOp(clone(st), { op: 'extra_add', table_id: 't1', member_id: 'm9', kind: 'chip', add: 1 }) }) === 'bad@member_id');
  const kana = applyOps(st, [{ op: 'member_add', member_id: 'm7', name: 'やまだ' }]).state;
  ok('member_rename：name_key が同じで字だけ違う直し（やまだ→ヤマダ）は自分なので通る', one(kana, { op: 'member_rename', member_id: 'm7', name: 'ヤマダ' }).ok && M(one(kana, { op: 'member_rename', member_id: 'm7', name: 'ヤマダ' }).state, 'm7').name === 'ヤマダ');
  ok('extra_set・extra_add：部屋に無い人は bad（at member_id）', err(one(st, { op: 'extra_set', table_id: 't1', member_id: 'm9', kind: 'chip', value: 1, base_version: 0 })) === 'bad@member_id' && err(one(st, { op: 'extra_add', table_id: 't1', member_id: 'm9', kind: 'chip', add: 1 })) === 'bad@member_id');
  // 正味の門（組の終わり）
  const st3 = c3.state; // m1 の chip +3
  const mv = [{ op: 'hanchan_seats', hanchan_id: 'h1', seats: ['m5', 'm2', 'm3', 'm4'] }, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 0, base_version: 1 }, { op: 'extra_set', table_id: 't1', member_id: 'm5', kind: 'chip', value: 3, base_version: 0 }];
  const mvr = applyOps(st3, mv);
  ok('正味の門：「A′ のチップ +3 を A に移す」組は通る（席の替えと A′→0・A→+3）', mvr.ok && X(mvr.state, 'm1').value === 0 && X(mvr.state, 'm5').value === 3, J(mvr.res));
  ok('正味の門：組の中の順に左右されない（A への +3 を席の替えより先に置いても通る）', applyOps(st3, [mv[2], mv[1], mv[0]]).ok);
  const gone = applyOps(st3, [mv[0]]).state; // m1 は席にいない・行 +3
  ok('正味の門：席にいない人の行は 0 へ近づく向きだけ（+3→+1 は ok・+3→+4 と +3→−1 は bad）', applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -2 }]).ok && err(applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }])) === 'bad@member_id' && err(applyOps(gone, [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: -1, base_version: 1 }])) === 'bad@member_id');
  ok('正味の門：席にいない人に行が無ければ足しは bad・弾いた組は写しを変えない', err(applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'shugi', add: 1 }])) === 'bad@member_id' && applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }]).state === gone);
  ok('正味の門：組の中で行って戻る（+1 −1）は通る・弾いた時の idx は最後にその行を触った op', applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }]).ok && applyOps(gone, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 2 }, { op: 'hanchan_void', hanchan_id: 'h1' }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }]).idx === 2);
  ok('正味の門：席の人を外す組で、外した人の行を遠ざけると bad', err(applyOps(st3, [mv[0], { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }])) === 'bad@member_id');
}

console.log('■ 弾く形（知らない鍵・19個以外・constructor・__proto__・組の数）');
{
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'league_create', 'mj_write', '']) {
    ok('op の名「' + name + '」は bad', applyOp(st, { op: name }).err === 'bad');
    let got;
    try { got = applyOp(st, { op: name, hanchan_id: 'h1' }).err; } catch (e) { got = 'throw ' + e.message; }
    ok('op の名「' + name + '」に鍵を足しても bad（投げない）', got === 'bad', got);
  }
  ok('op が無い・物でない は bad', applyOp(st, {}).err === 'bad' && applyOp(st, null).err === 'bad' && applyOp(st, [1]).err === 'bad');
  const proto = JSON.parse('{"op":"cell_set","hanchan_id":"h1","seat":0,"value":41000,"base_version":1,"__proto__":{"x":1}}');
  ok('JSON の __proto__ の鍵は知らない鍵＝bad', applyOp(clone(st), proto).err === 'bad', J(applyOp(clone(st), proto)));
  ok('constructor の鍵も知らない鍵＝bad', applyOp(st, { op: 'hanchan_void', hanchan_id: 'h1', constructor: 1 }).err === 'bad');
  ok('空の組は bad', applyOps(st, []).res.err === 'bad');
  ok('組が配列でない は bad', applyOps(st, { op: 'hanchan_void' }).res.err === 'bad');
  const r = applyOps(st, Array.from({ length: 31 }, () => ({ op: 'hanchan_void', hanchan_id: 'h1' })));
  ok('31個は too_many・何も当てない', !r.ok && r.res.err === 'too_many' && !H(st, 'h1').voided);
}

console.log('■ 古い形の写しを直す（migrateState＝形だけ・値は変えない・needs_upload）');
{
  const oldSt = {
    members: SEATS.map((m, i) => ({ member_id: m, name: ['山田', '鈴木', '佐藤', '高橋'][i], name_key: ['山田', '鈴木', '佐藤', '高橋'][i], active: true })),
    sessions: [{ session_id: 's1', date: '2026-11-19', rate: 100 }],
    tables: [{ table_id: 't1', session_id: 's1', rules }, { table_id: 't2', session_id: 's1', rules }],
    hanchans: [
      { hanchan_id: 'h1', table_id: 't1', no: 1, seats: SEATS.slice(), cells: [35400, 35400, 15100, 14100], cell_ver: [0, 2, 0, 0], order: [1, 0, 2, 3], order_ver: 1, lost: 0, lost_ver: 0, tobi_to: {}, tobi_ver: {}, voided: false },
      { hanchan_id: 'h2', table_id: 't1', no: 2, seats: SEATS.slice(), cells: [50000, 30000, 25000, -5000], cell_ver: [0, 0, 0, 0], order: null, order_ver: 0, lost: 0, lost_ver: 0, tobi_to: { 3: 0, 2: null }, tobi_ver: { 3: 1 }, voided: false },
      { hanchan_id: 'h3', table_id: 't1', no: 3, seats: SEATS.slice(), cells: [999000, 0, 0, -899000], cell_ver: [0, 0, 0, 0], order: null, order_ver: 0, lost: 0, lost_ver: 0, tobi_to: {}, tobi_ver: {}, voided: true },
    ],
    extras: [{ table_id: 't1', member_id: 'm1', kind: 'chip', value: 1500, version: 3 }, { table_id: 't1', member_id: 'm2', kind: 'chip', value: -1500, version: 0 }],
    settles: [{ session_id: 's1', rev: 1, at: '2026-11-19T23:00:00Z', snap: { ten: { m1: 100 }, pay: [], missing: 0 } }],
  };
  const keep = clone(oldSt);
  // 直す前の数（古い形を手で今の読み方に寄せた物）＝直した後と同じでなければならない
  const viewBefore = (() => { const s = clone(oldSt); s.hanchans = s.hanchans.map((h) => ({ ...h, ton_order: h.order ? h.order.map((i) => h.seats[i]) : null, tobi_to: Object.fromEntries(Object.entries(h.tobi_to).filter(([, v]) => v !== null)) })); return tableView(s, 't1'); })();
  const m = migrateState(oldSt);
  ok('古い形は直す（migrated）・st.v=2', m.migrated && m.st.v === 2);
  ok('元の写しは触らない', J(oldSt) === J(keep));
  const [h1, h2, h3] = m.st.hanchans;
  ok('order（席の番号）→ ton_order（member_id）', J(h1.ton_order) === J(['m2', 'm1', 'm3', 'm4']) && !('order' in h1) && h2.ton_order === null);
  ok('版は全部1から（取り消した半荘の version は2）', J(h1.cell_ver) === J([1, 1, 1, 1]) && h1.order_version === 1 && h1.version === 1 && h1.tobi_version === 1 && h3.version === 2, J(h3));
  ok('lost_ver・order_ver・tobi_ver は消す', !('lost_ver' in h1) && !('order_ver' in h1) && !('tobi_ver' in h1));
  ok('tobi_to の null の鍵は外す（null は持たない）・他は残す', J(h2.tobi_to) === J({ 3: 0 }));
  ok('範囲の外の素点も値は変えない（常に保存）', J(h3.cells) === J([999000, 0, 0, -899000]));
  ok('±999 の外の extras も値は変えない・版は1', m.st.extras[0].value === 1500 && m.st.extras[0].version === 1 && m.st.extras[1].value === -1500);
  ok('卓に label が無ければ 卓1・卓2', m.st.tables[0].label === '卓1' && m.st.tables[1].label === '卓2');
  ok('settles の snap → content・used は null・missing は配列', (() => { const x = m.st.settles[0]; return x.content.ten.m1 === 100 && x.used === null && J(x.missing) === '[]' && x.at === '2026-11-19T23:00:00Z' && !('snap' in x); })(), J(m.st.settles[0]));
  ok('人か開催が在れば needs_upload', m.st.needs_upload === true);
  const vAfter = tableView(m.st, 't1');
  ok('直す前と後で卓の数が同じ（値は変えない）', J(vAfter.total10) === J(viewBefore.total10) && J(vAfter.windows) === J(viewBefore.windows) && J(vAfter.missing) === J(viewBefore.missing), J([vAfter.total10, viewBefore.total10]));
  const again = migrateState(m.st);
  ok('直した写しはもう直さない（v=2 は中身を変えずに返す・埋めは clone）', !again.migrated && J(again.st) === J(m.st) && again.gate.mode === 'ok');
  ok('新しい部屋（emptyState）は v=2・needs_upload なし', (() => { const e = migrateState(emptyState()); return !e.migrated && e.st.v === 2 && !e.st.needs_upload; })());
  ok('空の古い写しは直すが needs_upload なし', (() => { const e = migrateState({ members: [], sessions: [] }); return e.migrated && e.st.needs_upload === false && Array.isArray(e.st.hanchans); })());
  ok('物でない写しは空の新しい形', (() => { const e = migrateState(null); return !e.migrated && e.st.v === 2 && e.st.members.length === 0; })());
  m.st.rules = rules;
  const r = applyOps(m.st, [{ op: 'cell_set', hanchan_id: 'h1', seat: 1, value: 35500, base_version: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -1 }, { op: 'settle_snap', session_id: 's1', rev: 2, content: {}, used: {}, missing: [] }]);
  ok('直した写しに新しい形の op が当たる（版1・0に近づく extra・rev 2）', r.ok, J(r.res));
}

console.log('■ ③-0 境目の門（roomGate＝部屋ごとに1回・newer／rules_bad は部屋を丸ごと読むだけ・yakitori_custom_v1.md v7〜v7.3）');
{
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  if (!st.hanchans[0]) throw new Error('門の写しに半荘が無い');
  ok('今の部屋は ok', roomGate(st).mode === 'ok' && migrateState(st).gate.mode === 'ok');
  ok('新しい部屋（emptyState）も st.rules を持たない古い写しも ok', migrateState(emptyState()).gate.mode === 'ok' && migrateState({ members: [], sessions: [], tables: [{ table_id: 't1', session_id: 's1', rules }] }).gate.mode === 'ok');
  for (const v of [4, '3', 3.5, -1, null]) {
    const x = { ...clone(st), v }; const keep = J(x);
    const m = migrateState(x);
    ok('st.v ' + J(v) + ' → newer・形を直さない・写しは1字も変わらない', m.gate.mode === 'newer' && !m.migrated && m.st === x && J(x) === keep, J(m.gate));
  }
  const tw = (fn) => { const x = clone(st); fn(x); return migrateState(x).gate; };
  ok('卓の rules が null → rules_bad', tw((x) => { x.tables[0].rules = null; }).mode === 'rules_bad');
  ok('卓の rules が配列 → rules_bad', tw((x) => { x.tables[0].rules = []; }).mode === 'rules_bad');
  ok('卓の rules に知らない鍵 → newer（v:2 の写し＝早い返しの道も門を通る）', (() => { const g = tw((x) => { x.tables[0].rules.zzz = 1; }); return g.mode === 'newer' && g.why === 'zzz'; })());
  ok('2c-3a から yakitori_to・yakitori_top_tie・tane_custom は知っている鍵（44鍵）→ ok・壊れた値は rules_bad', tw((x) => { Object.assign(x.tables[0].rules, { yakitori_to: 'top', yakitori_top_tie: 'all', tane_custom: [{ id: 'a', name: '一発', pt10: 5, sum0: true }] }); }).mode === 'ok' && (() => { const g = tw((x) => { x.tables[0].rules.tane_custom = [{ id: 'A', name: '一発', pt10: 5, sum0: true }]; }); return g.mode === 'rules_bad' && g.why === 'tane_custom'; })());
  ok('44鍵の範囲の外 → rules_bad（鍵名を返す）', (() => { const g = tw((x) => { x.tables[0].rules.aka = 99; }); return g.mode === 'rules_bad' && g.why === 'aka'; })());
  ok('extras の知らない kind（zz・c:・c:ABC・c:123456789・数）→ newer', ['zz', 'c:', 'c:ABC', 'c:123456789', 1].every((k) => tw((x) => { x.extras.push({ table_id: x.tables[0].table_id, member_id: 'm1', kind: k, value: 1, version: 1 }); }).mode === 'newer'));
  ok('2c-3b：extras の c:<id> の形（卓の tane_custom に無い id も）→ ok（数えないだけ）', tw((x) => { x.extras.push({ table_id: x.tables[0].table_id, member_id: 'm1', kind: 'c:x', value: 1, version: 1 }); }).mode === 'ok');
  ok('半荘の知らない欄（zzz）→ newer', tw((x) => { x.hanchans[0].zzz = []; }).mode === 'newer');
  ok('半荘に created_at（A20 §6 late・mj_read が返す）が在っても ok', tw((x) => { x.hanchans[0].created_at = '2026-11-27T00:00:00Z'; }).mode === 'ok');
  ok('2c-3c：半荘の yakitori・yakitori_version は知っている欄 → ok', tw((x) => { x.hanchans[0].yakitori = [1]; x.hanchans[0].yakitori_version = 2; }).mode === 'ok');
  ok('2c-3c：やきとりの欄の片方だけ・形が悪い・版が悪い → rules_bad（yakitori）', [
    (x) => { x.hanchans[0].yakitori = []; },
    (x) => { x.hanchans[0].yakitori_version = 1; },
    (x) => { x.hanchans[0].yakitori = [1, 1]; x.hanchans[0].yakitori_version = 1; },
    (x) => { x.hanchans[0].yakitori = [4]; x.hanchans[0].yakitori_version = 1; },
    (x) => { x.hanchans[0].yakitori = [2, 1]; x.hanchans[0].yakitori_version = 1; },
    (x) => { x.hanchans[0].yakitori = '[]'; x.hanchans[0].yakitori_version = 1; },
    (x) => { x.hanchans[0].yakitori = []; x.hanchans[0].yakitori_version = 0; },
    (x) => { x.hanchans[0].yakitori = []; x.hanchans[0].yakitori_version = 1.5; },
  ].every((fn) => { const g = tw(fn); return g.mode === 'rules_bad' && g.why === 'yakitori'; }));
  ok('2c-3c：cells が壊れた半荘にやきとりの欄が在っても門は落ちない', (() => { try { const g = tw((x) => { x.hanchans[0].cells = null; x.hanchans[0].yakitori = [0]; x.hanchans[0].yakitori_version = 1; }); return g.mode === 'ok'; } catch (e) { return false; } })());
  ok('部屋の rules（roomRules）に知らない鍵 → newer・roomRules を渡さなければ部屋の判じは飛ばす', migrateState(clone(st), { ...rules, zzz: 1 }).gate.mode === 'newer' && migrateState(clone(st)).gate.mode === 'ok');
  ok('帯の字', gateText({ mode: 'newer' }) === NEWER_TEXT && gateText({ mode: 'rules_bad', why: 'aka' }) === 'この部屋のルールが読めません（aka）');
  const part = clone(st); part.tables[0].rules = { players: 4, rate: 100 }; const keepP = J(part);
  const mp = migrateState(part);
  ok('足りない卓の rules は44鍵に埋める・元の写しは触らない・埋めは migrated を立てない', mp.gate.mode === 'ok' && Object.keys(mp.st.tables[0].rules).length === 44 && J(part) === keepP && !mp.migrated);
  const bad = clone(st); bad.tables[0].rules.zzz = 1; const keepB = J(bad);
  let all = true;
  for (const name of OP_NAMES) { const r = applyOps(bad, [{ op: name }]); if (r.ok || r.res.err !== 'newer' || r.state !== bad || r.idx !== 0) all = false; }
  ok('newer の部屋へ ' + OP_NAMES.length + ' の op 全部 → 何も当たらない（{ok:false, idx:0, res:{err:newer}, state}）', all && J(bad) === keepB && OP_NAMES.length === 34);
  ok('opts.roomRules に知らない鍵 → newer で組ごと止まる', applyOps(st, [{ op: 'member_add', member_id: 'm9', name: '新' }], { roomRules: { ...rules, zzz: 1 } }).res.err === 'newer');
  ok('opts に roomRules が無ければ部屋の判じは飛ばす（st.rules の知らない鍵は今の table_add の bad）', (() => { const x = clone(st); x.rules = { ...rules, zzz: 1 }; const r = applyOps(x, [{ op: 'table_add', table_id: 'tz', session_id: 's1', label: '卓9' }]); return !r.ok && r.res.err === 'bad'; })());
  ok('tobiSetOp は opts を applyOps へ渡す（roomRules が newer なら試し当てが当たらない）', (() => { const h = st.hanchans[0]; const ops = [{ op: 'cell_set', hanchan_id: h.hanchan_id, seat: 0, value: h.cells[0] + 100, base_version: h.cell_ver[0] }]; const a = tobiSetOp(st, ops, h.hanchan_id, h.tobi_to); const b = tobiSetOp(st, ops, h.hanchan_id, h.tobi_to, { roomRules: { ...rules, zzz: 1 } }); return a === null && b === null; })());
}

console.log('■ S2 卓のレート・取り消した卓・終えた後の比べ・精算の内訳（s2_seisan_rate_v1.md v1.1）');
{
  const C = [40000, 30000, 20000, 10000];
  const more = ['m5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'].map((m) => ({ op: 'member_add', member_id: m, name: '人' + m }));
  const hsT = (id, tid, seats, cells) => ({ op: 'hanchan_start', hanchan_id: id, table_id: tid, seats, cells });
  const S2 = ['m5', 'm6', 'm7', 'm8'], S3 = ['m9', 'm10', 'm11', 'm12'];
  const mk = (extra = []) => { const r = applyOps(base(), [...more,
    { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' }, { op: 'table_add', table_id: 't3', session_id: 's1', label: '卓3' },
    hsT('h1', 't1', SEATS, C), hsT('h2', 't2', S2, C), hsT('h3', 't3', S3, C), ...extra]); if (!r.ok) throw new Error('S2 の写し：' + J(r.res)); return r.state; };
  const st = mk();
  const T = (x, id) => x.tables.find((y) => y.table_id === id);
  T(st, 't2').rate_mode = 'num'; T(st, 't2').rate = 50; T(st, 't3').rate_mode = 'none'; T(st, 't3').rate = null;
  ok('写しの半荘3つはそろっている', ['t1', 't2', 't3'].every((id) => tableView(st, id).rows[0].ok));
  ok('門：鍵の在る正しい値（num 50・none null）は ok', roomGate(st).mode === 'ok');
  ok('①num の卓は卓の rate・③session は開催の rate・②none は null', tableView(st, 't2').rate === 50 && tableView(st, 't1').rate === 100 && tableView(st, 't3').rate === null);
  ok('⑤rate_mode の鍵が無い卓＝session（今の写し）', tableRate({ table_id: 'x' }, { rate: 30 }) === 30 && tableRate({ table_id: 'x' }, null) === null);
  ok('開催が取り消しでも session の卓は開催の rate（倉庫と同じ）', tableRate({}, { rate: 70, voided: true }) === 70);
  const s = sessionSeisan(st, 's1'), bd = sessionBreakdown(st, 's1');
  ok('②none の卓は noRateTables に番号3・その人は点に無く pt10NoRate に在る', J(s.noRateTables) === J([3]) && s.ten.m9 === undefined && s.pt10NoRate.m9 !== undefined && !bd.by.m9);
  ok('④前：卓ごとの点＝t2 の人は pt10×50/10', s.ten.m5 === s.pt10.m5 * 5 && s.ten.m1 === s.pt10.m1 * 10);
  ok('止め4：全員 Σ kei[r]×r/10 ＝ 精算の点', Object.keys(s.ten).every((m) => Object.entries(bd.by[m].kei).reduce((a, [r, v]) => a + v * Number(r) / 10, 0) === s.ten[m]), J(bd.by));
  ok('止め4：rates は数えた卓のレート（小さい順）・回数は3卓とも', J(bd.rates) === J([50, 100]) && bd.count === 3 && bd.tables === 3);
  // ④取り消した卓は精算・未入力・レートなしに入らず、番号はずれない（卓1＝取り消した卓・卓2＝未入力の卓）
  const sv = mk([hsT('h2b', 't2', S2, [40000, 30000, 20000, 9000])]);
  T(sv, 't1').voided = true; T(sv, 't3').rate_mode = 'none'; T(sv, 't3').voided = true;
  const s4 = sessionSeisan(sv, 's1'), b4 = sessionBreakdown(sv, 's1');
  ok('④取り消した卓の人は点に無い・内訳にも無い', s4.ok && s4.ten.m1 === undefined && s4.pt10.m1 === undefined && !b4.by.m1, J(s4.ten));
  ok('④未入力は卓2 のまま（番号がずれない）', s4.missing.length === 1 && s4.missing[0].table === 2, J(s4.missing));
  ok('④取り消した none の卓は noRateTables に入らない・数える卓は1つ', J(s4.noRateTables) === J([]) && b4.tables === 1 && b4.count === 2);
  // 開催の取り消し・無い開催
  const so = clone(st); so.sessions[0].voided = true;
  ok('止め1：取り消した開催は ok:false err voided（お金の数を出さない）', (() => { const x = sessionSeisan(so, 's1'); return !x.ok && x.err === 'voided' && x.ten === undefined && x.missing.length === 0; })());
  ok('無い開催は err session', sessionSeisan(st, 'sz').err === 'session');
  // 止め2：終えた後に、卓2 にだけ居た人の半荘を取り消す
  const sc = mk(); T(sc, 't3').rate_mode = 'none';
  const lastTen = sessionSeisan(sc, 's1').ten;
  const sc2 = applyOps(sc, [{ op: 'hanchan_void', hanchan_id: 'h2' }]).state;
  const now = sessionSeisan(sc2, 's1');
  const ch = tenChanged(lastTen, now.ten);
  ok('止め2：tenChanged に卓2 にだけ居た m5 が入る（今の並びだけで比べると入らない）', ch.includes('m5') && !sessionBreakdown(sc2, 's1').order.includes('m5'), J(ch));
  ok('止め2：変わらない人は入らない・並びは終えた時の順', !ch.includes('m1') && J(ch) === J(S2), J(ch));
  ok('tenChanged：今にだけ在る人も入る・0 と無いは同じ', J(tenChanged({ a: 0 }, { b: 5 })) === J(['b']) && J(tenChanged({ a: 0 }, {})) === J([]));
  // E' 門の7つ（今の写しの形＝鍵なしは上の 336 件で ok のまま）
  const gw = (fn) => { const x = clone(st); fn(x); return roomGate(x); };
  const is = (g, mode, why) => g.mode === mode && g.why === why;
  ok('門1 rate_mode 知らない字 → newer', is(gw((x) => { T(x, 't1').rate_mode = 'zzz'; }), 'newer', 'rate_mode'));
  ok('門2 rate_mode null → rules_bad', is(gw((x) => { T(x, 't1').rate_mode = null; }), 'rules_bad', 'rate_mode'));
  ok('門3 num で rate null → rules_bad', is(gw((x) => { T(x, 't2').rate = null; }), 'rules_bad', 'rate'));
  ok('門4 num で rate 5（範囲の外）→ rules_bad', is(gw((x) => { T(x, 't2').rate = 5; }), 'rules_bad', 'rate'));
  ok('門5 session で rate 100 → rules_bad', is(gw((x) => { T(x, 't1').rate = 100; }), 'rules_bad', 'rate'));
  ok('門6 卓の voided が真偽値でない → rules_bad', is(gw((x) => { T(x, 't1').voided = 'yes'; }), 'rules_bad', 'voided'));
  ok('門7 開催の voided が真偽値でない → rules_bad', is(gw((x) => { x.sessions[0].voided = 1; }), 'rules_bad', 'voided'));
  ok('門＋ 開催の rate が範囲の外 → rules_bad・null は ok', is(gw((x) => { x.sessions[0].rate = 15; }), 'rules_bad', 'rate') && gw((x) => { x.sessions[0].rate = null; }).mode === 'ok');
  ok('門で止まった部屋へは op が当たらない', applyOps((() => { const x = clone(st); T(x, 't1').rate_mode = 'zzz'; return x; })(), [{ op: 'member_add', member_id: 'mz', name: 'z' }]).res.err === 'newer');
}

console.log('■ canon（終えた時の控えの missing と今の missing を比べる字・鍵の順に左右されない＝倉庫の jsonb を回っても同じ・①v4.3）');
{
  const a = [{ table: 1, no: 2, why: 'sum', diff: -10000 }, { table: 1, what: 'chip', diff: 1 }];
  const b = a.map((m) => Object.fromEntries(Object.entries(m).reverse()));
  ok('鍵を逆の順にしても同じ字', canon(a) === canon(b) && JSON.stringify(a) !== JSON.stringify(b));
  ok('並びの順が違えば違う字（1件目と2件目を入れ替え）', canon(a) !== canon([a[1], a[0]]));
  ok('値が違えば違う字（diff −10000 → −9900）', canon(a) !== canon([{ ...a[0], diff: -9900 }, a[1]]));
  ok('入れ子の鍵の順も見ない', canon({ x: { b: 1, a: [{ d: 1, c: 2 }] } }) === canon({ x: { a: [{ c: 2, d: 1 }], b: 1 } }));
  ok('undefined は null と同じ字', canon(undefined) === canon(null));
  // 画面の試験では鍵の順を変えた控えを作れない（倉庫を回った時だけ）＝画面が canon を通して比べている事を字で見る（naoshi 任意1）
  const gr = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'gamen-room.mjs'), 'utf8');
  const cnDef = gr.match(/const cn = \(x\) => ([^;]+);/);
  ok('gamen-room の比べは canon を通す（cn の中身が canon(JSON.parse(JSON.stringify(…)))）', !!cnDef && /^canon\(JSON\.parse\(JSON\.stringify\(/.test(cnDef[1]), cnDef && cnDef[1]);
  ok('gamen-room の missing の比べは cn だけ（JSON.stringify で比べない）', /cn\(lastMissing\) !== cn\(s\.missing\)/.test(gr) && !/JSON\.stringify\(lastMissing\)|JSON\.stringify\(s\.missing\)/.test(gr));
}

console.log('■ 2c-3c’ やきとり（op yakitori_set は外した＝やきとりは extras の種 yaki・write6_yaki_sadame.md v1.1／印は計算に使わない＝③-2 A）');
{
  const YR = { ...rules, yakitori: true, yakitori_pt: 1, yakitori_to: 'split' };
  const C0 = [40000, 30000, 20000, 10000];
  const mk = (R = YR) => applyOps(base(R), [hs('h1', C0)]).state;
  ok('KEYS・OP_NAMES に yakitori_set は無い', KEYS_OF('yakitori_set') === null && !OP_NAMES.includes('yakitori_set'));
  {
    const st = mk();
    const r = applyOp(st, { op: 'yakitori_set', hanchan_id: 'h1', yakitori: [1], base_version: 1 });
    ok('古い端末の yakitori_set → 弾く（黙って当てない・欄を作らない）', !r.ok && r.err === 'bad' && !('yakitori' in H(st, 'h1')), J(r));
  }
  ok('hanchan_start は欄を作らない', (() => { const h = H(mk(), 'h1'); return !('yakitori' in h) && !('yakitori_version' in h); })());
  // 止め1（taiketsu）：版つきの op 4本は base_version の形を「同じ値か」より先に見る（倉庫 mj_w_int）
  {
    const st0 = applyOps(base(YR), [hs('h1', C0, { tobi_to: {} })]).state;
    const st1 = clone(st0); applyOp(st1, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: SEATS, base_version: 1 });
    const same = {
      cell_set: { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 40000 },
      hanchan_order: { op: 'hanchan_order', hanchan_id: 'h1', ton_order: SEATS },
      kyotaku_set: { op: 'kyotaku_set', hanchan_id: 'h1', value: 0 },
      tobi_set: { op: 'tobi_set', hanchan_id: 'h1', tobi_to: {} },
    };
    const BAD = ['x', '1', 1.5, null, 3e9, true];
    let all = true, why = '';
    for (const [name, o] of Object.entries(same)) {
      const stx = name === 'hanchan_order' ? st1 : st0;
      for (const bv of [...BAD, undefined]) {
        const op = { ...o }; if (bv !== undefined) op.base_version = bv;
        const r = applyOp(clone(stx), op);
        if (r.ok || r.err !== 'bad' || r.at !== 'base_version') { all = false; why += name + ':' + J(bv) + '→' + J(r) + ' '; }
      }
      if (!applyOp(clone(stx), { ...o, base_version: 99 }).ok) { all = false; why += name + ':99 '; }
    }
    ok('版つき4本：同じ値でも base_version が整数でない・無い・±20億の外 → bad at base_version／形が正しければ古い版でも ok', all, why);
    ok('違う値で base_version "1" → conflict でなく bad', (() => { const r = applyOp(clone(st0), { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: '1' }); return !r.ok && r.err === 'bad' && r.at === 'base_version'; })());
  }
  ok('hanchanPt：印が在っても順は要らない（yaki は渡しても見ない）', hanchanPt(YR, C0, {}).ok && hanchanPt(YR, C0, { yaki: [1] }).ok && hanchanPt(YR, C0, { yaki: [4] }).ok);
  ok('checkEntry：やきとりで needOrder は立たない（同点だけ）', checkEntry(YR, C0).needOrder === false && checkEntry(YR, C0, 0, [1]).needOrder === false);
  {
    // 古い倉庫から来た印（読む門は形だけ見る）＝計算に使わない
    const st = mk(); H(st, 'h1').yakitori = [1]; H(st, 'h1').yakitori_version = 2;
    const v = tableView(st, 't1');
    ok('表：印が在っても順なしで額を出す（why なし・missing 0・yakiOnly の欄なし）', v.rows[0].ok === true && v.rows[0].why === null && !('yakiOnly' in v.rows[0]) && v.missing.length === 0 && sessionSeisan(st, 's1').missing.length === 0, J(v.rows[0]));
    ok('印の在る半荘と無い半荘で pt が同じ', J(v.rows[0].by) === J(tableView(mk(rules), 't1').rows[0].by));
  }
  const grY = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'gamen-room.mjs'), 'utf8');
  ok('画面の字：控えの used に yakitori_version', /yakitori_version: h\.yakitori_version \?\? 1/.test(grY));
}

console.log('■ ③-2 やきとり（extras の yaki）・合計0の自由な項目・外へ払う種（場代）＝チップと同じ所（司さん 11-21）');
{
  // やきとり 1枚 2pt（20）・コイン 1枚 0.5pt（5・合計0）・場代 1枚 1pt（10・外へ払う）・開催のレート 100＝点は pt10×10
  const TC = [{ id: 'ko', name: 'コイン', pt10: 5, sum0: true }, { id: 'ba', name: '場代', pt10: 10, sum0: false }];
  const R3 = { ...rules, yakitori: true, yakitori_pt: 2, tane_custom: TC };
  const C0 = [40000, 30000, 20000, 10000];
  const X = (m, kind, value) => ({ table_id: 't1', member_id: m, kind, value, version: 1 });
  const mk = (R, xs) => { const st = applyOps(base(R), [hs('h1', C0)]).state; st.extras.push(...xs); return st; };
  const plain = mk(rules, []);
  const p0 = tableView(plain, 't1'), s0 = sessionSeisan(plain, 's1');
  const W = (v, m) => v.windows.find((w) => w.member_id === m);
  const st = mk(R3, [X('m1', 'yaki', 2), X('m4', 'yaki', -2), X('m2', 'c:ko', 3), X('m3', 'c:ko', -3), X('m1', 'c:ba', 1), X('m2', 'c:ba', 2), X('m5', 'c:ba', 1), X('m6', 'yaki', 0)]);
  const v = tableView(st, 't1');
  const d = (m) => W(v, m).hanPt10 === W(p0, m).hanPt10;
  ok('窓：半荘の pt は同じ・yaki 枚と pt10（m1 2枚＝40・点 400／m4 −40）', ['m1', 'm2', 'm3', 'm4'].every(d) && W(v, 'm1').yaki === 2 && W(v, 'm1').yakiPt10 === 40 && W(v, 'm1').yakiBig === 400 && W(v, 'm4').yakiPt10 === -40, J(W(v, 'm1')));
  ok('窓：pt10＝半荘＋やきとり＋コイン（m1 +40・m2 +15・m3 −15・m4 −40）・場代は入らない', W(v, 'm1').pt10 === W(p0, 'm1').pt10 + 40 && W(v, 'm2').pt10 === W(p0, 'm2').pt10 + 15 && W(v, 'm3').pt10 === W(p0, 'm3').pt10 - 15 && W(v, 'm4').pt10 === W(p0, 'm4').pt10 - 40);
  ok('窓：out10（m1 10・m2 20・席に居ない m5 10＝人に出る）・outBig は点（m2 200）・0 の行の m6 は出ない', W(v, 'm1').out10 === 10 && W(v, 'm2').out10 === 20 && !!W(v, 'm5') && W(v, 'm5').out10 === 10 && W(v, 'm2').outBig === 200 && !W(v, 'm6'));
  ok('★場代の行が在る間は今まで通り not_yet で止める（画面の「払う額」欄まで・v2.1 止め2）★＝custWait・dim・missing は c:ba の1件だけ', v.custWait && v.extrasOk && v.windows.every((w) => w.dim) && J(v.missing.filter((m) => m.what)) === J([{ what: 'c:ba', name: '場代', why: 'not_yet' }]), J(v.missing));
  const s = sessionSeisan(st, 's1');
  ok('開催の精算：ten は半荘＋やきとり＋コインの点（m1 +400・m2 +150・m3 −150・m4 −400）・合計0', s.ok && s.ten.m1 === s0.ten.m1 + 400 && s.ten.m2 === s0.ten.m2 + 150 && s.ten.m3 === s0.ten.m3 - 150 && s.ten.m4 === s0.ten.m4 - 400 && Object.values(s.ten).reduce((a, b) => a + b, 0) === 0, J(s.ten));
  ok('開催の精算：out は場代の点（m1 100・m2 200・m5 100）・ten／pay に m5 は居ない', s.ok && J(s.out) === J({ m1: 100, m2: 200, m5: 100 }) && !('m5' in s.ten) && !s.pay.some((x) => x.from === 'm5' || x.to === 'm5'), J(s.out));
  const bd = sessionBreakdown(st, 's1');
  ok('内訳：m1 yaki 2・yaki10 40・out10 10／m2 cust10 15・out10 20', bd.by.m1.yaki === 2 && bd.by.m1.yaki10 === 40 && bd.by.m1.out10 === 10 && bd.by.m2.cust10 === 15 && bd.by.m2.out10 === 20 && bd.used.yaki === true, J(bd.by.m1));
  ok('内訳：Σkei×r/10 ＝ 精算の ten（やきとり・コイン込み・場代は入れない）', Object.keys(s.ten).every((m) => Object.entries(bd.by[m].kei).reduce((a, [r, k]) => a + k * (Number(r) / 10), 0) === s.ten[m]), J(bd.by));
  const ngSt = mk(R3, [X('m1', 'yaki', 2), X('m4', 'yaki', -1)]);
  const ng = tableView(ngSt, 't1');
  ok('やきとりの合計が 0 でない＝extrasOk false・missing {what yaki, diff 1}・額を足さない・dim', !ng.extrasOk && J(ng.missing.filter((m) => m.what)) === J([{ what: 'yaki', diff: 1 }]) && W(ng, 'm1').pt10 === W(p0, 'm1').pt10 && ng.windows.every((w) => w.dim), J(ng.missing));
  ok('やきとりの合計が 0 でない卓は精算でも数えない（ten は半荘だけ）', (() => { const x = sessionSeisan(ngSt, 's1'); return x.ok && x.ten.m1 === s0.ten.m1; })());
  const off = tableView(mk({ ...R3, yakitori: false }, [X('m1', 'yaki', 2), X('m5', 'yaki', 1)]), 't1');
  ok('yakitori が true でない卓の yaki 行は数えない（missing 無し・pt 同じ）が、0 でない行の人は出す（m5）', off.extrasOk && !off.missing.some((m) => m.what) && W(off, 'm1').pt10 === W(p0, 'm1').pt10 && W(off, 'm1').yaki === 0 && !!W(off, 'm5'));
  const z = tableView(mk({ ...R3, yakitori_pt: 0 }, [X('m1', 'yaki', 2), X('m4', 'yaki', -1)]), 't1');
  ok('yakitori_pt 0 は使わない種（write6 v1.1 止め1）＝行は数えない（合計も見ない・missing 無し・pt 同じ・yaki 0）', z.extrasOk && !z.used.yaki && !z.missing.some((m) => m.what) && W(z, 'm1').pt10 === W(p0, 'm1').pt10 && W(z, 'm1').yaki === 0 && z.tableForSeisan.yaki_pt10 === null && z.tableForSeisan.yakis === undefined);
  const ky = [
    [{ yakitori: true, yakitori_pt: 2 }, 'sum0'], [{ yakitori: true, yakitori_pt: 1 }, 'sum0'], [{ yakitori: true, yakitori_pt: 0 }, null], [{ yakitori: false, yakitori_pt: 2 }, null],
    [{ yakitori: 'true', yakitori_pt: 2 }, null], [{ yakitori: true, yakitori_pt: '2' }, null], [{ yakitori: true, yakitori_pt: 1.5 }, null], [{ yakitori: true }, null], [{}, null], [null, null], [undefined, null],
  ];
  ok('kindOf の yaki＝yakitori true かつ pt ≥1 の整数だけ sum0（' + ky.length + ' 通り）・yakiUsed と同じ', ky.every(([r, w]) => kindOf(r, 'yaki') === w && yakiUsed(r) === (w === 'sum0')), J(ky.map(([r, w], i) => (kindOf(r, 'yaki') === w ? null : i)).filter((x) => x !== null)));
  const ea = (R, add) => applyOp(applyOps(base(R), [hs('h1', C0)]).state, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'yaki', add });
  ok('extra_add yaki：使う卓は入る・pt 0／false の卓は bad at kind', ea(R3, 1).ok && ['bad:kind', 'bad:kind'].join() === [ea({ ...R3, yakitori_pt: 0 }, 1), ea({ ...R3, yakitori: false }, 1)].map((r) => r.err + ':' + r.at).join(), J(ea({ ...R3, yakitori_pt: 0 }, 1)));
  ok('門：extras に yaki の行が在っても newer にならない（EXTRA_KINDS に yaki）', (() => { const g = roomGate(st, R3); return g.mode !== 'newer'; })(), J(roomGate(st, R3)));
  const nr = mk(R3, [X('m1', 'c:ba', 3)]);
  nr.tables[0].rate_mode = 'none';
  const nrs = sessionSeisan(nr, 's1');
  ok('レートの無い卓の場代＝outPt10NoRate（m1 30）・out は空', nrs.ok && J(nrs.outPt10NoRate) === J({ m1: 30 }) && J(nrs.out) === '{}', J(nrs));
}

console.log('■ E1（A19）飛び賞＝半荘の pt に入る・押した人がもらう（tobi_to {r}・e_sadame v2 §E1・手で数えた値）');
{
  // 既定の rules＝tobi true・tobi_pt 10（1回＝100 pt10）・開催のレート 100＝点は pt10×10・CB の素の pt＝[600,100,−200,−500]
  const C0 = [40000, 30000, 20000, 10000], CB = [55000, 30000, 20000, -5000];
  const X = (m, kind, value) => ({ table_id: 't1', member_id: m, kind, value, version: 1 });
  const mk = (R, xs, cells = CB, extra = {}) => { const st = applyOps(base(R), [hs('h1', cells, extra)]).state; st.extras.push(...xs); return st; };
  const W = (v, m) => v.windows.find((w) => w.member_id === m);
  const P = (v) => SEATS.map((m) => v.rows[0].by[m].pt10);
  const v0 = tableView(mk(rules, []), 't1');
  ok('押していない＝素の pt のまま（hanchanPt と同じ）・待たない・ok', v0.rows[0].ok && J(P(v0)) === J([600, 100, -200, -500]) && v0.missing.length === 0);
  const v1 = tableView(mk(rules, [], CB, { tobi_to: { r: [0] } }), 't1');
  ok('席0を押す＝半荘の pt [700,100,−200,−600]・basePt10・tobiPt10 も行に', J(P(v1)) === J([700, 100, -200, -600]) && v1.rows[0].by.m1.basePt10 === 600 && v1.rows[0].by.m1.tobiPt10 === 100 && v1.rows[0].by.m4.tobiPt10 === -100, J(P(v1)));
  ok('窓：m1 pt10 700・点 7000・hanPt10 700（飛び賞は半荘に入る）・tobi 0', W(v1, 'm1').pt10 === 700 && W(v1, 'm1').big === 7000 && W(v1, 'm1').hanPt10 === 700 && W(v1, 'm1').tobi === 0 && W(v1, 'm1').tobiPt10 === 0);
  const s1 = sessionSeisan(mk(rules, [], CB, { tobi_to: { r: [0] } }), 's1');
  ok('開催の精算：ten m1 7000・m4 −6000・合計0', s1.ok && s1.ten.m1 === 7000 && s1.ten.m4 === -6000 && Object.values(s1.ten).reduce((x, y) => x + y, 0) === 0, J(s1.ten));
  const b1 = sessionBreakdown(mk(rules, [], CB, { tobi_to: { r: [0] } }), 's1');
  ok('内訳：m1 han 700（飛び賞込み）・tobi10 0・used.tobi false（二重にしない）', b1.by.m1.han === 700 && b1.by.m1.tobi10 === 0 && b1.used.tobi === false);
  const v2 = tableView(mk(rules, [], CB, { tobi_to: { r: [0, 1] } }), 't1');
  ok('席0,1を押す＝[700,200,−200,−700]（2人目にも払う）', J(P(v2)) === J([700, 200, -200, -700]), J(P(v2)));
  ok('古い鍵の形 {3:0}＝押していない＝素の pt', J(P(tableView(mk(rules, [], CB, { tobi_to: { 3: 0 } }), 't1'))) === J([600, 100, -200, -500]));
  ok('tobi_from all＝押さなくても全員から [700,200,−100,−800]', J(P(tableView(mk({ ...rules, tobi_from: 'all' }, []), 't1'))) === J([700, 200, -100, -800]));
  ok('飛んでいない半荘で押す＝0（C0 の素の pt）', J(P(tableView(mk(rules, [], C0, { tobi_to: { r: [0] } }), 't1'))) === J(P(tableView(mk(rules, [], C0), 't1'))));
  ok('tobi false の卓は押しても 0', J(P(tableView(mk({ ...rules, tobi: false }, [], CB, { tobi_to: { r: [0] } }), 't1'))) === J(P(tableView(mk({ ...rules, tobi: false }, []), 't1'))));
  // 古い種 tobi の行（テスト線だけ）＝数えない・門で弾かない
  const old = mk(rules, [X('m1', 'tobi', 2), X('m4', 'tobi', -1), X('m6', 'tobi', 3)]);
  const vo = tableView(old, 't1');
  ok('古い種 tobi の行は数えない＝精算は行が無い時と同じ・extrasOk・missing 無し・m6 を人に足さない', J(sessionSeisan(old, 's1')) === J(sessionSeisan(mk(rules, []), 's1')) && vo.extrasOk && vo.missing.length === 0 && !vo.people.some((p) => p.member_id === 'm6') && W(vo, 'm1').tobi === 0);
  ok('tableForSeisan に tobi_pt10・tobis が無い・used.tobi false・tobiHint・tobiSum が無い', !('tobis' in vo.tableForSeisan) && !('tobi_pt10' in vo.tableForSeisan) && vo.used.tobi === false && !('tobiHint' in vo) && !('tobiSum' in vo));
  ok('門：古い種 tobi の行が在っても newer にならない', roomGate(old, rules).mode !== 'newer');
  // 形と op
  for (const [nm, t, want] of [['{r:[0]}', { r: [0] }, true], ['{r:[]}', { r: [] }, true], ['{r:[1,3]}', { r: [1, 3] }, true], ['r と鍵を混ぜる', { r: [0], 3: 0 }, false], ['昇順でない', { r: [1, 0] }, false], ['重なり', { r: [2, 2] }, false], ['席の外', { r: [4] }, false], ['字', { r: ['0'] }, false], ['配列でない', { r: 1 }, false], ['古い鍵の形', { 3: 0 }, true], ['{}', {}, true]]) ok('tobiShapeOk ' + nm + ' ＝' + want, tobiShapeOk(t, 4) === want);
  const st = mk(rules, []);
  const r1 = applyOp(st, { op: 'tobi_set', hanchan_id: 'h1', tobi_to: { r: [0, 2] }, base_version: 1 });
  ok('tobi_set {r} を受ける＝版+1・pt に入る', r1.ok && H(st, 'h1').tobi_version === 2 && J(P(tableView(st, 't1'))) === J([700, 100, -100, -700]), J(r1));
  ok('tobi_set の形が違う＝bad at tobi_to', applyOp(mk(rules, []), { op: 'tobi_set', hanchan_id: 'h1', tobi_to: { r: [2, 0] }, base_version: 1 }).at === 'tobi_to');
  ok('hanchan_start の tobi_to {r} の形が違う＝bad', applyOps(base(), [hs('h1', CB, { tobi_to: { r: [9] } })]).res.at === 'tobi_to');
  // 点を直しても {r} は変えない（倉庫の mj_w_tobi_fix と同じ・鍵消しは古い形だけ）
  const k0 = applyOps(base(), [hs('h1', C0, { tobi_to: { r: [0] } })]).state;
  const k1 = applyOps(k0, [{ op: 'cell_set', hanchan_id: 'h1', seat: 3, value: -5000, base_version: 1 }, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 55000, base_version: 1 }]);
  ok('点を直して飛んでも {r} はそのまま・版も上げない・pt に入る', k1.ok && J(H(k1.state, 'h1').tobi_to) === J({ r: [0] }) && H(k1.state, 'h1').tobi_version === 1 && J(P(tableView(k1.state, 't1'))) === J([700, 100, -200, -600]), J(k1.res));
  // 倉庫に違う形が置かれた時＝その半荘は why tobi_to（お金に入れない）
  const bad = mk(rules, []); H(bad, 'h1').tobi_to = { r: [3, 1] };
  const vb = tableView(bad, 't1');
  ok('置かれた形が違う＝ok でない・why tobi_to・missing に出る', !vb.rows[0].ok && vb.rows[0].why === 'tobi_to' && vb.missing.some((m) => m.why === 'tobi_to'));
  // 乱数の卓：押した組み合わせで合計0・Σkei×r/10＝ten
  let badN = 0;
  for (let i = 0; i < 300; i++) {
    const rr = [0, 1, 2, 3].filter((s) => (i >> s) & 1);
    const cells = i % 3 === 0 ? C0 : i % 3 === 1 ? CB : [70000, 50000, -5000, -15000];
    const R = { ...rules, tobi_pt: 1 + (i % 30), hakoshita: true, tobi_zero: i % 2 === 0 };
    const r = mk(R, [X('m4', 'chip', i % 5), X('m1', 'chip', -(i % 5))], cells, { tobi_to: { r: rr } });
    const sr = sessionSeisan(r, 's1'), br = sessionBreakdown(r, 's1'), hv = hanchanView(R, H(r, 'h1'));
    if (!sr.ok || !hv.ok || hv.pt10.reduce((x, y) => x + y, 0) !== 0 || Object.values(sr.ten).reduce((x, y) => x + y, 0) !== 0 || !Object.keys(sr.ten).every((m) => Object.entries(br.by[m].kei).reduce((x, [rt, k]) => x + k * (Number(rt) / 10), 0) === sr.ten[m])) badN++;
  }
  ok('300 の卓で合計0・Σkei×r/10＝ten（外れ ' + badN + '）', badN === 0);
}

console.log('■ 2c-2b 人の op 5つ・役の門・入り直しの門（正本＝schema.sql の mj_write ①・③ダッシュ・③ダッシュ2・mj_w_op 末尾・紙 write4_utsushi.md v1.1）');
{
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'schema.sql'), 'utf8');
  const rows = Object.fromEntries(readOps(sql).map((r) => [r.name, r]));
  ok('WHO・WHO_LEAGUE・RE は34個とも schema の mj_ops の who_plain・who_league・re と同じ字', OP_NAMES.every((n) => rows[n] && rows[n].who_plain === WHO[n] && rows[n].who_league === WHO_LEAGUE[n] && rows[n].re === RE[n]), J(OP_NAMES.filter((n) => !rows[n] || rows[n].who_plain !== WHO[n] || rows[n].who_league !== WHO_LEAGUE[n] || rows[n].re !== RE[n])));
  const NY = Object.keys(rows).filter((n) => !OP_NAMES.includes(n)).sort();
  ok('mj_ops に在って写しに無い op は4つ（not_yet＝rules_save・rerev_ok・history_revert・room_export）', J(NY) === J(['history_revert', 'rerev_ok', 'room_export', 'rules_save']), J(NY));
  const ck = /c_keys\s+(?:constant\s+)?jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(sql);
  const cKeys = ck ? JSON.parse(ck[1]) : null;
  ok('KEYS の名と鍵は schema の c_keys と同じ（34個）', !!cKeys && OP_NAMES.length === Object.keys(cKeys).length && OP_NAMES.every((n) => J(cKeys[n]) === J(KEYS_OF(n))), ck ? J(Object.keys(cKeys)) : 'c_keys が読めない');
  ok('PERSON_OPS＝who_plain が nyu でない c_keys の op（schema から引く）', !!cKeys && J([...PERSON_OPS].sort()) === J(Object.keys(cKeys).filter((n) => rows[n] && rows[n].who_plain !== 'nyu' && n !== 'table_rules').sort()), J(PERSON_OPS));   // C4 table_rules は役 kan だが状態を変える op（direct の門は applyOps で別に見る）
  ok('needOf＝mj_w_need（nyu/self/self_or_kan 通す・kan は kan/owner・owner は owner だけ・知らない who は閉じる）',
    needOf('self', 'nyu') === null && needOf('self_or_kan', 'nyu') === null && needOf('kan', 'nyu') === 'kan' && needOf('kan', 'kan') === null && needOf('kan', 'owner') === null &&
    needOf('owner_or_kan', 'nyu') === 'kan' && needOf('owner', 'kan') === 'owner' && needOf('owner', 'owner') === null && needOf('revert_rule', 'owner') === 'revert_rule' && needOf(undefined, 'owner') === 'none');
  const NOW = '2026-11-21T12:00:00Z', NS = Date.parse(NOW) / 1000;
  ok('reauthOk：600秒ちょうどは通る・601秒は弾く・数でない/無い/now が読めない＝弾く', REAUTH_SEC === 600 && reauthOk(NS - 600, NOW) && !reauthOk(NS - 601, NOW) && !reauthOk(undefined, NOW) && !reauthOk(String(NS), NOW) && !reauthOk(NaN, NOW) && !reauthOk(NS, undefined) && !reauthOk(NS, 'zzz'));
  const U1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const s0 = applyOps(emptyState(), [{ op: 'member_add', member_id: 'p1', name: '一' }, { op: 'member_add', member_id: 'p2', name: '二' }, { op: 'member_active', member_id: 'p2', active: false }]).state;
  const keep = J(s0);
  const D = (ops, o = {}) => applyOps(s0, ops, { now: NOW, direct: true, role: 'owner', reauthAt: NS, ...o });
  const E = (r) => (r.ok ? 'ok' : r.res.err + (r.res.at ? '@' + r.res.at : '') + (r.res.need ? ':' + r.res.need : '') + '#' + r.res.i);
  ok('direct が無い組の人の op → err direct（写しだけの弾き・並びに積まない）・state はそのまま', (() => { const r = applyOps(s0, [{ op: 'member_add', member_id: 'p3', name: '三' }, { op: 'member_link', member_id: 'p1' }], { now: NOW, role: 'owner', reauthAt: NS }); return !r.ok && E(r) === 'direct#1' && r.state === s0 && J(s0) === keep; })());
  ok('direct が無くても人の op が無い組は今のまま当たる（今の commit の道）', applyOps(s0, [{ op: 'member_add', member_id: 'p3', name: '三' }], { now: NOW }).ok);
  const cases = [
    ['member_link 在る active → ok・状態は変えない', [{ op: 'member_link', member_id: 'p1' }], {}, 'ok'],
    ['member_link 無い人 → bad@member_id', [{ op: 'member_link', member_id: 'zz' }], {}, 'bad@member_id#0'],
    ['member_link active false → bad@member_id', [{ op: 'member_link', member_id: 'p2' }], {}, 'bad@member_id#0'],
    ['member_link 字でない → bad@member_id', [{ op: 'member_link', member_id: 1 }], {}, 'bad@member_id#0'],
    ['member_unlink active false でも ok（倉庫は active を見ない）', [{ op: 'member_unlink', member_id: 'p2' }], {}, 'ok'],
    ['member_unlink 無い人 → bad@member_id', [{ op: 'member_unlink', member_id: 'zz' }], {}, 'bad@member_id#0'],
    ['member_relink 人の後に user_id（uuid の形でない）→ bad@user_id', [{ op: 'member_relink', member_id: 'p1', user_id: 'u1' }], {}, 'bad@user_id#0'],
    ['member_relink 無い人と悪い user_id → bad@member_id（人が先）', [{ op: 'member_relink', member_id: 'zz', user_id: 'u1' }], {}, 'bad@member_id#0'],
    ['member_relink 大文字の uuid も通る', [{ op: 'member_relink', member_id: 'p1', user_id: U1.toUpperCase() }], {}, 'ok'],
    ['role_set role が悪くて user_id も悪い → bad@role（role が先）', [{ op: 'role_set', user_id: 'x', role: 'owner' }], {}, 'bad@role#0'],
    ['role_set role が字でない → bad@role', [{ op: 'role_set', user_id: U1, role: 1 }], {}, 'bad@role#0'],
    ['role_set user_id が悪い → bad@user_id', [{ op: 'role_set', user_id: 'x', role: 'nyu' }], {}, 'bad@user_id#0'],
    ['role_set nyu → ok（入り直しは見ない）', [{ op: 'role_set', user_id: U1, role: 'nyu' }], { reauthAt: undefined }, 'ok'],
    ['account_remove user_id が悪い → bad@user_id', [{ op: 'account_remove', user_id: '' }], {}, 'bad@user_id#0'],
    ['account_remove → ok', [{ op: 'account_remove', user_id: U1 }], {}, 'ok'],
    ["① が ③' より先：入の組で後ろの op の知らない鍵 → bad@zz#1", [{ op: 'account_remove', user_id: U1 }, { op: 'member_link', member_id: 'p1', zz: 1 }], { role: 'nyu' }, 'bad@zz#1'],
    ['① が中身より先：前の op の中身の誤りより後ろの op の鍵 → bad@zz#1', [{ op: 'member_link', member_id: 'zz' }, { op: 'member_link', member_id: 'p1', zz: 1 }], {}, 'bad@zz#1'],
    ["③' 入で account_remove → mj_role:kan#0", [{ op: 'account_remove', user_id: U1 }], { role: 'nyu' }, 'mj_role:kan#0'],
    ["③' 管で role_set → mj_role:owner#1（組の2つ目）", [{ op: 'member_link', member_id: 'p1' }, { op: 'role_set', user_id: U1, role: 'nyu' }], { role: 'kan' }, 'mj_role:owner#1'],
    ["③' 役が無い＝nyu に倒す → member_relink は mj_role:kan", [{ op: 'member_relink', member_id: 'p1', user_id: U1 }], { role: undefined }, 'mj_role:kan#0'],
    ["③' 入でも member_link・member_unlink は通る（self・self_or_kan）", [{ op: 'member_link', member_id: 'p1' }, { op: 'member_unlink', member_id: 'p1' }], { role: 'nyu' }, 'ok'],
    ["③' が ③'' より先：入が role_set kan（reauth 無し）→ mj_role", [{ op: 'role_set', user_id: U1, role: 'kan' }], { role: 'nyu', reauthAt: undefined }, 'mj_role:owner#0'],
    ["③'' role_set kan で reauthAt 無し → mj_reauth#0", [{ op: 'role_set', user_id: U1, role: 'kan' }], { reauthAt: undefined }, 'mj_reauth#0'],
    ["③'' 601秒前 → mj_reauth#1", [{ op: 'member_link', member_id: 'p1' }, { op: 'role_set', user_id: U1, role: 'kan' }], { reauthAt: NS - 601 }, 'mj_reauth#1'],
    ["③'' 600秒前ちょうど → ok", [{ op: 'role_set', user_id: U1, role: 'kan' }], { reauthAt: NS - 600 }, 'ok'],
    ["③'' が中身より先：role_set kan（reauth 無し）の後ろの op の中身の誤り → mj_reauth", [{ op: 'role_set', user_id: U1, role: 'kan' }, { op: 'member_link', member_id: 'zz' }], { reauthAt: undefined }, 'mj_reauth#0'],
  ];
  for (const [name, ops, o, want] of cases) { const r = D(ops, o); ok(name, E(r) === want && (r.ok ? J(r.state) === keep : r.state === s0) && J(s0) === keep, E(r)); }
  const gl = applyOps(s0, [{ op: 'member_link', member_id: 'p1' }], { now: NOW, direct: true, role: 'kan', reauthAt: NS, roomRules: { zzz: 1 } });
  ok('roomGate が門より先（newer の部屋は人の op も newer）', !gl.ok && gl.res.err === 'newer');
}

console.log('■ 2c-2c 部屋の op 4つ（正本＝408f091 の mj_write ①・mj_w_op・mj_ops・紙 write5_utsushi.md v1）');
{
  const NOW = '2026-11-21T12:00:00Z', NS = Date.parse(NOW) / 1000;
  const s0 = applyOps(emptyState(), [{ op: 'member_add', member_id: 'p1', name: '一' }]).state; const keep = J(s0);
  const D = (ops, o = {}) => applyOps(s0, ops, { now: NOW, direct: true, role: 'owner', reauthAt: NS, ...o });
  const E = (r) => (r.ok ? 'ok' : r.res.err + (r.res.at ? '@' + r.res.at : '') + (r.res.need ? ':' + r.res.need : '') + '#' + r.res.i);
  const H = 'a'.repeat(64), MA = { op: 'member_add', member_id: 'p9', name: '九' }, RS = (pass, url_token_hash) => ({ op: 'room_secret', pass, url_token_hash });
  ok('部屋の op 4つは PERSON_OPS に入る・WHO/RE は mj_ops の字', ['room_leave', 'room_delete', 'room_undelete', 'room_secret'].every((n) => PERSON_OPS.includes(n)) && J([WHO.room_leave, WHO.room_secret, WHO.room_delete, WHO.room_undelete]) === J(['self', 'kan', 'owner', 'owner_or_kan']) && J([RE.room_leave, RE.room_secret, RE.room_delete, RE.room_undelete]) === J(['owner', 'yes', 'yes', 'no']));
  const cases = [
    ['① 組に1つ：前の op の知らない鍵が先 → bad@x#0', [{ ...MA, x: 1 }, { op: 'room_leave' }], {}, 'bad@x#0'],
    ['① 組に1つ：[member_add, room_leave] → bad@op#1', [MA, { op: 'room_leave' }], {}, 'bad@op#1'],
    ['① 組に1つ：[room_leave, member_add] → bad@op#0', [{ op: 'room_leave' }, MA], {}, 'bad@op#0'],
    ['① 組に1つ：[room_secret, room_secret] → bad@op#0', [RS('2741', H), RS('2741', H)], {}, 'bad@op#0'],
    ['① 組に1つ：部屋の op の知らない鍵より長さが先 → bad@op#0', [{ op: 'room_delete', x: 1 }, MA], {}, 'bad@op#0'],
    ['room_delete 1つ（owner・入り直し済み）→ ok・状態は変えない', [{ op: 'room_delete' }], {}, 'ok'],
    ['room_delete 知らない鍵 → bad@x', [{ op: 'room_delete', x: 1 }], {}, 'bad@x#0'],
    ["③' room_delete を kan → mj_role:owner", [{ op: 'room_delete' }], { role: 'kan' }, 'mj_role:owner#0'],
    ["③'' room_delete を owner・reauthAt 無し → mj_reauth", [{ op: 'room_delete' }], { reauthAt: undefined }, 'mj_reauth#0'],
    ["③'' room_delete 601秒前 → mj_reauth", [{ op: 'room_delete' }], { reauthAt: NS - 601 }, 'mj_reauth#0'],
    ['room_leave を nyu・入り直し無し → ok（re owner は持ち主だけ）', [{ op: 'room_leave' }], { role: 'nyu', reauthAt: undefined }, 'ok'],
    ['room_leave を role 無し（nyu に倒す）→ ok', [{ op: 'room_leave' }], { role: undefined, reauthAt: undefined }, 'ok'],
    ["③'' room_leave を owner・入り直し無し → mj_reauth", [{ op: 'room_leave' }], { reauthAt: undefined }, 'mj_reauth#0'],
    ['room_undelete を kan・入り直し無し → ok（re no）', [{ op: 'room_undelete' }], { role: 'kan', reauthAt: undefined }, 'ok'],
    ["③' room_undelete を nyu → mj_role:kan", [{ op: 'room_undelete' }], { role: 'nyu' }, 'mj_role:kan#0'],
    ["③' room_secret を nyu → mj_role:kan", [RS('2741', H)], { role: 'nyu' }, 'mj_role:kan#0'],
    ["③'' room_secret を kan・入り直し無し → mj_reauth（re yes）", [RS('2741', H)], { role: 'kan', reauthAt: undefined }, 'mj_reauth#0'],
    ["③' が中身より先：悪い pass を nyu → mj_role", [RS('ab', H)], { role: 'nyu' }, 'mj_role:kan#0'],
    ['room_secret 正しい（kan）→ ok', [RS('2741', H)], { role: 'kan' }, 'ok'],
    ['room_secret pass 全角の数字4つ（NFKC で半角）→ ok', [RS('２７４１', H)], {}, 'ok'],
    ['room_secret pass 英字4つ → bad@pass（段C＝数字4つだけ）', [RS('abcd', H)], {}, 'bad@pass#0'],
    ['room_secret pass 数字5つ → bad@pass', [RS('27410', H)], {}, 'bad@pass#0'],
    ['room_secret pass 数字3つ → bad@pass', [RS('274', H)], {}, 'bad@pass#0'],
    ['room_secret pass 絵文字4つ → bad@pass', [RS('\u{1F004}'.repeat(4), H)], {}, 'bad@pass#0'],
    ['room_secret pass 数 → bad@pass', [RS(1234, H)], {}, 'bad@pass#0'],
    ['room_secret pass 無し → bad@pass', [{ op: 'room_secret', url_token_hash: H }], {}, 'bad@pass#0'],
    ['room_secret pass も hash も悪い → bad@pass（pass が先）', [RS('ab', 'zz')], {}, 'bad@pass#0'],
    ['room_secret hash 大文字 → bad@url_token_hash', [RS('2741', 'A'.repeat(64))], {}, 'bad@url_token_hash#0'],
    ['room_secret hash 63字 → bad@url_token_hash', [RS('2741', 'a'.repeat(63))], {}, 'bad@url_token_hash#0'],
    ['room_secret hash 無し → bad@url_token_hash', [{ op: 'room_secret', pass: '2741' }], {}, 'bad@url_token_hash#0'],
    ['段C room_share 正しい（owner・入り直し無し＝re no）→ ok', [{ op: 'room_share', name: '週1の会', pass: '2741', url_token_hash: H }], { reauthAt: undefined }, 'ok'],
    ["段C ③' room_share を kan → mj_role:owner", [{ op: 'room_share', name: '週1の会', pass: '2741', url_token_hash: H }], { role: 'kan' }, 'mj_role:owner#0'],
    ['段C room_share 名前が空白だけ → bad@name', [{ op: 'room_share', name: '　 ', pass: '2741', url_token_hash: H }], {}, 'bad@name#0'],
    ['段C room_share 名前41字 → bad@name', [{ op: 'room_share', name: 'あ'.repeat(41), pass: '2741', url_token_hash: H }], {}, 'bad@name#0'],
    ['段C room_share pass 英字 → bad@pass', [{ op: 'room_share', name: '週1の会', pass: 'abcd', url_token_hash: H }], {}, 'bad@pass#0'],
    ['段C room_share hash 無し → bad@url_token_hash', [{ op: 'room_share', name: '週1の会', pass: '2741' }], {}, 'bad@url_token_hash#0'],
    ['段C ① 組に1つ：[room_share, member_add] → bad@op#0', [{ op: 'room_share', name: '週1の会', pass: '2741', url_token_hash: H }, MA], {}, 'bad@op#0'],
    ['段C room_close（owner・入り直し済み）→ ok', [{ op: 'room_close' }], {}, 'ok'],
    ["段C ③'' room_close 入り直し無し → mj_reauth（re yes）", [{ op: 'room_close' }], { reauthAt: undefined }, 'mj_reauth#0'],
    ["段C ③' room_close を kan → mj_role:owner", [{ op: 'room_close' }], { role: 'kan' }, 'mj_role:owner#0'],
    ['段C ① 組に1つ：[member_add, room_close] → bad@op#1', [MA, { op: 'room_close' }], {}, 'bad@op#1'],
  ];
  for (const [name, ops, o, want] of cases) { const r = D(ops, o); ok(name, E(r) === want && (r.ok ? J(r.state) === keep : r.state === s0) && J(s0) === keep, E(r)); }
  ok('direct が無い組の部屋の op → err direct', [{ op: 'room_leave' }, { op: 'room_delete' }, { op: 'room_undelete' }, RS('2741', H)].every((op) => { const r = applyOps(s0, [op], { now: NOW, role: 'owner', reauthAt: NS }); return !r.ok && E(r) === 'direct#0' && r.state === s0; }));
}
console.log("■ 2c-2d1 リーグの op 3つ・③' は who_league が same か who_plain と同じ op だけ（正本＝schema.sql・紙 write7_league_sadame_v11.md）");
{
  const NOW = '2026-11-21T12:00:00Z', NS = Date.parse(NOW) / 1000;
  const s0 = applyOps(emptyState(), [{ op: 'member_add', member_id: 'p1', name: '一' }]).state; const keep = J(s0);
  const D = (ops, o = {}) => applyOps(s0, ops, { now: NOW, direct: true, role: 'owner', reauthAt: NS, ...o });
  const E = (r) => (r.ok ? 'ok' : r.res.err + (r.res.at ? '@' + r.res.at : '') + (r.res.need ? ':' + r.res.need : '') + '#' + r.res.i);
  const L1 = '7d444840-9dc0-41b0-8a2d-1d6a6f3c2b11';
  ok('KEYS（頼みの並び）：session_add・league_create・league_save・league_owner_set',
    J(KEYS_OF('session_add')) === J(['session_id', 'date', 'rate', 'place', 'league_id']) &&
    J(KEYS_OF('league_create')) === J(['league_id', 'name', 'date_from', 'date_to', 'rank_by', 'min_games', 'players_main', 'rules', 'rules_alt']) &&
    J(KEYS_OF('league_save')) === J(['league_id', 'base_version', 'name', 'date_from', 'date_to', 'rank_by', 'min_games', 'rules', 'rules_alt']) &&
    J(KEYS_OF('league_owner_set')) === J(['league_id']));
  ok('リーグの op は PERSON_OPS（direct）・WHO＝kan/none/owner・RE＝no/no/yes', LEAGUE_OPS.every((n) => PERSON_OPS.includes(n)) && J(LEAGUE_OPS.map((n) => WHO[n])) === J(['kan', 'none', 'owner']) && J(LEAGUE_OPS.map((n) => RE[n])) === J(['no', 'no', 'yes']));
  const SKIP = OP_NAMES.filter((n) => !ROLE_AT_GATE(n)).sort();
  ok("③' を飛ばす op＝9つ（session_add・session_edit・table_add・table_edit・table_seats・hanchan_seats・member_rename・member_active・league_save）", J(SKIP) === J(['hanchan_seats', 'league_save', 'member_active', 'member_rename', 'session_add', 'session_edit', 'table_add', 'table_edit', 'table_seats']), J(SKIP));
  const LC = { op: 'league_create', league_id: L1, name: 'リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'pt', min_games: 0, players_main: 4, rules: {}, rules_alt: null };
  const cases = [
    ["league_save を nyu（who_plain none）→ ③' で止めない＝ok（L は倉庫だけ）", [{ op: 'league_save', league_id: L1, base_version: 1 }], { role: 'nyu' }, 'ok'],
    ["league_save を role 無し → ok（③' を飛ばす）", [{ op: 'league_save', league_id: L1, base_version: 1 }], { role: undefined }, 'ok'],
    ['league_create を nyu → mj_role:kan（who_league same）', [LC], { role: 'nyu' }, 'mj_role:kan#0'],
    ['league_create を kan → ok・状態は変えない', [LC], { role: 'kan' }, 'ok'],
    ['league_owner_set を kan → mj_role:owner', [{ op: 'league_owner_set', league_id: L1 }], { role: 'kan' }, 'mj_role:owner#0'],
    ["③'' league_owner_set を owner・入り直し無し → mj_reauth（re yes）", [{ op: 'league_owner_set', league_id: L1 }], { reauthAt: undefined }, 'mj_reauth#0'],
    ['league_owner_set 入り直し済み → ok', [{ op: 'league_owner_set', league_id: L1 }], {}, 'ok'],
    ['league_id が uuid でない → bad@league_id', [{ op: 'league_owner_set', league_id: 'L1' }], {}, 'bad@league_id#0'],
    ['league_save の知らない鍵 players_main → bad@players_main', [{ op: 'league_save', league_id: L1, base_version: 1, players_main: 3 }], {}, 'bad@players_main#0'],
    ['league_create の知らない鍵 → bad@x', [{ ...LC, x: 1 }], {}, 'bad@x#0'],
    ['session_add の league_id null（direct）→ ok', [{ op: 'session_add', session_id: 's9', date: '2026-11-21', rate: 100, league_id: null }], {}, 'ok+'],
    ['session_add の league_id "L1" → bad@league_id', [{ op: 'session_add', session_id: 's9', date: '2026-11-21', rate: 100, league_id: 'L1' }], {}, 'bad@league_id#0'],
    ['session_add の league_id uuid（direct）→ ok・写しは当てない', [{ op: 'session_add', session_id: 's9', date: '2026-11-21', rate: 100, league_id: L1 }], { role: 'nyu' }, 'ok'],
  ];
  for (const [name, ops, o, want] of cases) {
    const r = D(ops, o);
    if (want === 'ok+') { ok(name, r.ok && r.state.sessions.some((x) => x.session_id === 's9') && J(s0) === keep, E(r)); continue; }
    ok(name, E(r) === want && (r.ok ? J(r.state) === keep : r.state === s0) && J(s0) === keep, E(r));
  }
  const n1 = applyOps(s0, [{ op: 'session_add', session_id: 's9', date: '2026-11-21', rate: 100, league_id: null }], { role: 'nyu' });
  ok('league_id null の session_add は並びに積める（direct 無しで ok・開催が増える）', n1.ok && n1.state.sessions.some((x) => x.session_id === 's9'));
  const n2 = applyOps(s0, [{ op: 'session_add', session_id: 's9', date: '2026-11-21', rate: 100, league_id: L1 }], { role: 'nyu' });
  ok('リーグの日の session_add は並びに積まない（direct 無し → err direct・何も当てない）', !n2.ok && E(n2) === 'direct#0' && n2.state === s0);
  ok('direct が無い組のリーグの op 3つ → err direct', [LC, { op: 'league_save', league_id: L1, base_version: 1 }, { op: 'league_owner_set', league_id: L1 }].every((op) => { const r = applyOps(s0, [op], { now: NOW, role: 'owner', reauthAt: NS }); return !r.ok && E(r) === 'direct#0' && r.state === s0; }));
}
console.log('■ B1 卓の席 table_seats（b1_sadame_v2.md v2.1・写しの分）');
{
  const one = (st, op) => applyOps(st, [op]);
  const err = (r) => (r.ok ? 'ok' : r.res.err + '@' + r.res.at);
  const T = (st) => st.tables.find((t) => t.table_id === 't1');
  const st0 = base();
  ok('B1 table_add は seats: [] を作る', J(T(st0).seats) === '[]');
  ok('B1 KEYS：table_seats＝table_id・seats／リーグの日は L／③\' は飛ばす', J(KEYS_OF('table_seats')) === J(['table_id', 'seats']) && WHO.table_seats === 'nyu' && WHO_LEAGUE.table_seats === 'L' && RE.table_seats === 'no' && !ROLE_AT_GATE('table_seats'));
  // seats の無い v2 の写し（B1 の前に作った卓）
  const old = clone(st0); delete T(old).seats;
  let thrown = null;
  try { tableView(old, 't1'); applyOps(old, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }]); sessionBreakdown(old, 's1'); } catch (e) { thrown = String(e); }
  ok('B1 seats の無い v2 の写しで tableView・applyOps・sessionBreakdown が投げない', thrown === null, thrown);
  ok('B1 seats の無い写しの seatPeople は []', J(tableView(old, 't1').seatPeople) === '[]');
  ok('B1 seats の無い写しへも table_seats が当たる', one(old, { op: 'table_seats', table_id: 't1', seats: SEATS }).ok);
  ok('B1 seats の無い写しの門は通る（roomGate ok）', roomGate(old, rules).mode === 'ok', J(roomGate(old, rules)));
  // 当てる・席の順
  const r1 = one(st0, { op: 'table_seats', table_id: 't1', seats: ['m3', 'm1', 'm4', 'm2'] });
  ok('B1 table_seats → ok・t.seats が席の順・seats_version は持たない', r1.ok && J(T(r1.state).seats) === J(['m3', 'm1', 'm4', 'm2']) && !('seats_version' in T(r1.state)));
  ok('B1 seatPeople は席の順の名前', J(tableView(r1.state, 't1').seatPeople.map((x) => x.name)) === J(['佐藤', '山田', '高橋', '鈴木']));
  const same = one(r1.state, { op: 'table_seats', table_id: 't1', seats: ['m3', 'm1', 'm4', 'm2'] });
  ok('B1 同じ値は書かずに ok（同じ物）', same.ok && J(T(same.state).seats) === J(T(r1.state).seats));
  ok('B1 長さ違い・重なり・部屋に無い人・字でない・配列でない は bad@seats', [['m1', 'm2', 'm3'], ['m1', 'm1', 'm3', 'm4'], ['m1', 'm2', 'm3', 'm9'], ['m1', 'm2', 'm3', 4], 'm1'].every((a) => err(one(st0, { op: 'table_seats', table_id: 't1', seats: a })) === 'bad@seats'));
  ok('B1 無い卓・取り消した卓・取り消した開催日は bad@table_id',
    err(one(st0, { op: 'table_seats', table_id: 'tx', seats: SEATS })) === 'bad@table_id' &&
    err(applyOps(st0, [{ op: 'table_edit', table_id: 't1', voided: true }, { op: 'table_seats', table_id: 't1', seats: SEATS }])) === 'bad@table_id' &&
    err(applyOps(st0, [{ op: 'session_edit', session_id: 's1', voided: true }, { op: 'table_seats', table_id: 't1', seats: SEATS }])) === 'bad@table_id');
  const in5 = applyOps(r1.state, [{ op: 'member_add', member_id: 'm5', name: '渡辺' }, { op: 'member_active', member_id: 'm5', active: false }, { op: 'member_active', member_id: 'm1', active: false }]);
  ok('B1 使わない人：新しく入れるのは bad・今の卓の席にいる人は残せる', in5.ok && err(one(in5.state, { op: 'table_seats', table_id: 't1', seats: ['m5', 'm2', 'm3', 'm4'] })) === 'bad@seats' && one(in5.state, { op: 'table_seats', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'] }).ok, err(one(in5.state, { op: 'table_seats', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'] })));
  // 正味の門：半荘0本の卓で席の人は ± を打てる・席にいない人は今まで通り弾く
  const g1 = applyOps(st0, [{ op: 'table_seats', table_id: 't1', seats: SEATS }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 3 }]);
  ok('B1 席を決めて半荘0の卓に chip +3 → ok', g1.ok, J(g1.res));
  const mem5 = applyOps(st0, [{ op: 'member_add', member_id: 'm5', name: '渡辺' }]).state;
  ok('B1 卓の席にいない部屋の人へ +1 は bad@member_id（今のまま）', err(applyOps(mem5, [{ op: 'table_seats', table_id: 't1', seats: SEATS }, { op: 'extra_add', table_id: 't1', member_id: 'm5', kind: 'chip', add: 1 }])) === 'bad@member_id');
  ok('B1 席を決めないと半荘0の卓に +1 は bad@member_id（今のまま）', err(one(st0, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 })) === 'bad@member_id');
  // お金の判じは変えない：席だけの卓は席を決める前と同じ
  const pick = (v) => J({ w: v.windows, p: v.people, r: v.rows, t: v.total10, m: v.missing, s: v.tableForSeisan, e: v.extrasOk });
  ok('B1 席だけの卓の windows・people・rows・精算の判じは席を決める前と同じ', pick(tableView(r1.state, 't1')) === pick(tableView(st0, 't1')));
  ok('B1 席だけの卓の sessionBreakdown（rates・order・kei）は席を決める前と同じ', J(sessionBreakdown(r1.state, 's1')) === J(sessionBreakdown(st0, 's1')));
  const one1 = applyOps(st0, [{ op: 'table_seats', table_id: 't1', seats: ['m3', 'm1', 'm4', 'm2'] }, { op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'chip', add: 2 }]);
  const v1 = tableView(one1.state, 't1');
  ok('B1 ± を1人に押すと windows は押した1人だけ・seatPeople は席の順のまま', one1.ok && J(v1.windows.map((w) => w.member_id)) === J(['m4']) && J(v1.seatPeople.map((x) => x.member_id)) === J(['m3', 'm1', 'm4', 'm2']), J(v1.windows.map((w) => w.member_id)));
  // 半荘の後も卓の席の人は打てる
  const h1 = applyOps(st0, [{ op: 'table_seats', table_id: 't1', seats: SEATS }, { op: 'member_add', member_id: 'm5', name: '渡辺' }, { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m5', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] }]);
  ok('B1 半荘の後も卓の席の人（半荘に居ない m1）は ± を打てる', h1.ok && one(h1.state, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }).ok);
}

console.log('■ C4 途中でルールを変える（c4_sadame v3.3 §2・§3・§3a・§6＝倉庫 write.live と同じ答え）');
{
  const T2 = '00000000-0000-4000-8000-0000000000c2', T3 = '00000000-0000-4000-8000-0000000000c3';
  const K = { direct: true, role: 'kan' };
  const Tb = (x, id) => x.tables.find((y) => y.table_id === id);
  const err = (r) => (r.ok ? 'ok' : r.res.err + '@' + (typeof r.res.at === 'object' ? J(r.res.at) : r.res.at));
  const X = (x, t, m, k = 'chip') => x.extras.find((e) => e.table_id === t && e.member_id === m && e.kind === k);
  const run = (x, ops, o) => { const r = applyOps(x, ops, o); if (!r.ok) throw new Error('C4 の台が当たらない：' + J(r.res)); return r.state; };
  const tr = (rules2, id = T2, tid = 't1') => ({ op: 'table_rules', table_id: tid, new_table_id: id, rules: rules2 });
  const ea = (m, add, extra = {}) => ({ op: 'extra_add', table_id: 't1', member_id: m, kind: 'chip', add, ...extra });
  const umaR = (u) => ({ ...rules, uma: u });
  // 台：h1（m1 トップ）・チップ m1 +3 / m2 -3
  const st0 = run(base(umaR([30, 10, -10, -30])), [hs('h1', [40000, 30000, 20000, 10000]), ea('m1', 3), ea('m2', -3)]);
  const R2 = umaR([40, 20, -20, -40]);
  // 役・direct
  ok('C4 table_rules は並びに積めない（err direct）', err(applyOps(st0, [tr(R2)], { role: 'kan' })) === 'direct@undefined');
  ok('C4 table_rules は kan の役（nyu は mj_role）', applyOps(st0, [tr(R2)], { direct: true, role: 'nyu' }).res.err === 'mj_role');
  // 区切り（鍵同じ）
  const a = applyOps(st0, [tr(R2)], K);
  ok('C4 区切り（チップの鍵同じ）→ ok・前の卓に next_table_id と split_same true', a.ok && Tb(a.state, 't1').next_table_id === T2 && Tb(a.state, 't1').split_same === true, J(a.res));
  ok('C4 新しい卓は label・seats・新しいルールを写し・rate_mode は session（鍵なし）', a.ok && Tb(a.state, T2).label === '卓1' && J(Tb(a.state, T2).rules.uma) === J([40, 20, -20, -40]) && !('rate_mode' in Tb(a.state, T2)));
  ok('C4 鍵同じ→枚が新しい卓へ移る（前の卓は0行・値は同じ）', a.ok && !X(a.state, 't1', 'm1') && X(a.state, T2, 'm1').value === 3 && X(a.state, T2, 'm2').value === -3);
  ok('C4 h1 は前の卓のまま（前の回は前のルール）', a.ok && H(a.state, 'h1').table_id === 't1');
  ok('C4 2回目の区切りは conflict（cur に next）', (() => { const r = applyOps(a.state, [tr(umaR([20, 10, -10, -20]), T3)], K); return !r.ok && r.res.err === 'conflict' && r.res.cur.next_table_id === T2; })());
  ok('C4 同じ new_table_id の送り直しは ok（何も足さない）', (() => { const r = applyOps(a.state, [tr(R2)], K); return r.ok && r.state.tables.length === a.state.tables.length; })());
  ok('C4 同じ rules は区切らずに ok', (() => { const r = applyOps(st0, [tr(clone(Tb(st0, 't1').rules))], K); return r.ok && r.state.tables.length === 1 && Tb(r.state, 't1').next_table_id == null; })());
  ok('C4→A20 players 違いも区切れる（人数の門は無い・a20_sadame v4 §5）', applyOps(st0, [tr({ ...defaultRules(3), rate: 100 })], K).ok);
  ok('C4 取り消した卓 → bad at table_id', err(applyOps(st0, [{ op: 'table_edit', table_id: 't1', voided: true }, tr(R2)], K)) === 'bad@table_id');
  ok('C4 new_table_id が UUID でない → bad at new_table_id', err(applyOps(st0, [tr(R2, 'tx')], K)) === 'bad@new_table_id');
  // rate 3通り
  ok('C4 rules.rate null → rate_mode none', (() => { const r = applyOps(st0, [tr({ ...R2, rate: null })], K); return r.ok && Tb(r.state, T2).rate_mode === 'none' && tableRate(Tb(r.state, T2), r.state.sessions[0]) === null; })());
  ok('C4 rules.rate 50（開催日 100）→ rate_mode num・rate 50', (() => { const r = applyOps(st0, [tr({ ...R2, rate: 50 })], K); return r.ok && Tb(r.state, T2).rate_mode === 'num' && Tb(r.state, T2).rate === 50; })());
  ok('C4 rate が変わると鍵が違う側（チップ合計0なら前の卓に残る・split_same false）', (() => { const r = applyOps(st0, [tr({ ...R2, rate: 50 })], K); return r.ok && Tb(r.state, 't1').split_same === false && X(r.state, 't1', 'm1').value === 3 && !X(r.state, T2, 'm1'); })());
  // T1 num の卓（t.rate 50）を rules.rate 100（開催日と同じ＝session）で区切る＝実際のレートが違う→移さない
  const n50 = clone(st0); Object.assign(Tb(n50, 't1'), { rate_mode: 'num', rate: 50 });
  ok('C4 T1 num の卓（50）→ rules.rate 100（session）＝実際のレートが違う＝移さず残す', (() => { const r = applyOps(n50, [tr(R2)], K); return r.ok && Tb(r.state, 't1').split_same === false && X(r.state, 't1', 'm1').value === 3; })());
  // 鍵違い・合計0でない
  const odd = run(st0, [ea('m3', 2)]);
  ok('C4 鍵違い（チップ単価）で合計≠0 → bad at extras・kind chip', (() => { const r = applyOps(odd, [tr({ ...rules, uma: [30, 10, -10, -30], chip_pt10: 10 })], K); return err(r) === 'bad@extras' && r.res.kind === 'chip'; })());
  ok('C4 鍵同じなら合計≠0 でも区切れる（移すだけ・お金は変わらない）', applyOps(odd, [tr(R2)], K).ok);
  // follow
  ok('C4 follow 無しの hanchan_start が区切られた卓 → bad at table_id', err(applyOps(a.state, [hs('h2', [10000, 20000, 30000, 40000])])) === 'bad@table_id');
  ok('C4 follow 無しの extra_add が区切られた卓 → bad at table_id', err(applyOps(a.state, [ea('m1', 1), ea('m2', -1)])) === 'bad@table_id');
  ok('C4 follow が真偽でない → bad at follow', err(applyOps(a.state, [hs('h2', [10000, 20000, 30000, 40000], { follow: 1 })])) === 'bad@follow');
  ok('C4 区切っていない卓では follow:true は無視（そのまま入る）', (() => { const r = applyOps(st0, [hs('h2', [10000, 20000, 30000, 40000], { follow: true })]); return r.ok && H(r.state, 'h2').table_id === 't1'; })());
  const b = applyOps(a.state, [hs('h2', [10000, 20000, 30000, 40000], { follow: true }), ea('m3', 1, { follow: true }), ea('m4', -1, { follow: true })]);
  ok('C4 follow:true の hanchan_start・extra_add は鎖の最後（T2）へ', b.ok && H(b.state, 'h2').table_id === T2 && X(b.state, T2, 'm3').value === 1 && !X(b.state, 't1', 'm3'), J(b.res));
  const c3 = applyOps(b.state, [tr(umaR([20, 10, -10, -20]), T3, T2)], K);
  ok('C4 2つ区切った鎖（鍵同じ）でも t1 への follow は最後（T3）へ', c3.ok && (() => { const r = applyOps(c3.state, [ea('m1', 1, { follow: true }), ea('m2', -1, { follow: true })]); return r.ok && X(r.state, T3, 'm1').value === 4; })());
  // 鍵違いの区切りの後の遅れた extra_add・split_same 欠け
  const zs = run(base({ ...rules, chip_pt10: 10 }), [hs('h1', [40000, 30000, 20000, 10000]), ea('m1', 2), ea('m2', -2)]);
  const d = applyOps(zs, [tr({ ...rules, chip_pt10: 20 })], K);
  ok('C4 鍵違い・合計0 → ok・前の卓に残る（split_same false）', d.ok && Tb(d.state, 't1').split_same === false && X(d.state, 't1', 'm1').value === 2 && !X(d.state, T2, 'm1'), J(d.res));
  ok('C4 T3 鍵違いの区切りの後の遅れた extra_add（follow:true）→ bad at table_id', err(applyOps(d.state, [ea('m1', 1, { follow: true })])) === 'bad@table_id');
  ok('C4 鍵違いの区切りの後の hanchan_start（follow:true）は鎖の最後へ', (() => { const r = applyOps(d.state, [hs('h2', [10000, 20000, 30000, 40000], { follow: true })]); return r.ok && H(r.state, 'h2').table_id === T2; })());
  const miss = clone(a.state); delete Tb(miss, 't1').split_same;
  ok('C4 N1 写しに split_same が無い卓を通る extra_add → bad at table_id（分からない時は通さない）', err(applyOps(miss, [ea('m1', 1, { follow: true })])) === 'bad@table_id');
  // §3b extra_set は前の卓のまま
  const ver = X(d.state, 't1', 'm1').version;
  ok('C4 §3b 前の卓への extra_set は前の卓の行を直す（鎖の最後へ行かない）', (() => { const r = applyOps(d.state, [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1, base_version: ver }, { op: 'extra_set', table_id: 't1', member_id: 'm2', kind: 'chip', value: -1, base_version: X(d.state, 't1', 'm2').version }]); return r.ok && X(r.state, 't1', 'm1').value === 1 && !X(r.state, T2, 'm1'); })());
  ok('C4 §3b 前の卓への extra_set の版違い → conflict', applyOps(d.state, [{ op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 1, base_version: ver + 5 }]).res?.err === 'conflict');
  // §3a 正味の門＝鎖
  const sub = run(base(umaR([30, 10, -10, -30])), [{ op: 'member_add', member_id: 'm5', name: '渡辺' }, { op: 'member_add', member_id: 'm6', name: '伊藤' }, { op: 'table_seats', table_id: 't1', seats: SEATS },
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m5', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] }, ea('m5', 2), ea('m2', -2)]);
  const e = run(sub, [tr(R2)], K);
  ok('C4 §3a 区切り（鍵同じ）の後、前の卓の半荘にだけ座った代打ち m5 への extra_add（新しい卓へ）は ok', (() => { const r = applyOps(e, [ea('m5', 1, { follow: true }), ea('m1', -1, { follow: true })]); return r.ok && X(r.state, T2, 'm5').value === 3; })(), err(applyOps(e, [ea('m5', 1, { follow: true }), ea('m1', -1, { follow: true })])));
  ok('C4 §3a 同じ m5 への extra_set（新しい卓）も ok', applyOps(e, [{ op: 'extra_set', table_id: T2, member_id: 'm5', kind: 'chip', value: 1, base_version: X(e, T2, 'm5').version }]).ok);
  ok('C4 §3a 鎖のどこにも座っていない m6 への足しは bad at member_id', err(applyOps(e, [ea('m6', 1, { follow: true })])) === 'bad@member_id');
  ok('C4 --waza 門を自分の卓だけで見ると m5 は弾かれる形（新しい卓に半荘0・m5 は卓の席に無い）', !Tb(e, T2).seats.includes('m5') && !e.hanchans.some((h) => h.table_id === T2));
  // v3.1 取り消した半荘だけに座った人の枚を鍵同じで区切る
  const vd = run(sub, [{ op: 'hanchan_void', hanchan_id: 'h1' }]);
  const f2 = applyOps(vd, [tr(R2)], K);
  ok('C4 取り消した半荘だけに座った m5 が枚を持つ時に鍵同じで区切る → ok・行が移る', f2.ok && X(f2.state, T2, 'm5').value === 2 && !X(f2.state, 't1', 'm5'), J(f2.res));
  // §6 精算の期待値（手で数えた・1pt＝100円・オカ 20）
  //  例1 ウマ 10-30→20-40・チップ単価同じ（2.0pt）＝枚が移る
  //   h1（t1・ウマ30-10）：m1 +10+30+20=60／m2 0+10=10／m3 -10-10=-20／m4 -20-30=-50
  //   h2（T2・ウマ40-20）：m4 +10+40+20=70／m3 0+20=20／m2 -10-20=-30／m1 -20-40=-60
  //   チップ m1 +3・m2 -3（区切り前）・m3 +1・m4 -1（区切り後）×2.0pt
  //   m1 60-60+6=6→600／m2 10-30-6=-26→-2600／m3 -20+20+2=2→200／m4 -50+70-2=18→1800
  const s1 = sessionSeisan(b.state, 's1');
  ok('C4 精算 例1（ウマ 10-30→20-40・枚が移る）＝ m1 600・m2 -2600・m3 200・m4 1800', s1.ok && J([s1.ten.m1, s1.ten.m2, s1.ten.m3, s1.ten.m4]) === J([600, -2600, 200, 1800]), J(s1.ten));
  //  例2 チップ単価 1.0→2.0pt・前の卓は合計0で締めて区切る（ウマ 10-20）
  //   h1（t1）：m1 10+20+20=50／m2 0+10=10／m3 -10-10=-20／m4 -20-20=-40・チップ m1 +2・m2 -2 ×1.0pt
  //   h2（T2）：m4 50／m3 10／m2 -20／m1 -40・チップ m3 +1・m4 -1 ×2.0pt
  //   m1 50+2-40=12→1200／m2 10-2-20=-12→-1200／m3 -20+10+2=-8→-800／m4 -40+50-2=8→800
  const g = applyOps(d.state, [hs('h2', [10000, 20000, 30000, 40000], { follow: true }), { op: 'extra_add', table_id: T2, member_id: 'm3', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: T2, member_id: 'm4', kind: 'chip', add: -1 }]);
  const s2 = g.ok ? sessionSeisan(g.state, 's1') : {};
  ok('C4 精算 例2（チップ 1→2pt・0で締めて区切る）＝ m1 1200・m2 -1200・m3 -800・m4 800', s2.ok && J([s2.ten.m1, s2.ten.m2, s2.ten.m3, s2.ten.m4]) === J([1200, -1200, -800, 800]), J(g.res) + J(s2.ten));
}
console.log('■ A20 途中で人数も替える・押した時のルールで数える（a20_sadame v4 §5 の (a)〜(i)・(g2)＝手で出した期待値）');
{
  const T2 = '00000000-0000-4000-8000-0000000000d2';
  const K = { direct: true, role: 'kan' };
  const Tb = (x, id) => x.tables.find((y) => y.table_id === id);
  const err = (r) => (r.ok ? 'ok' : r.res.err + '@' + (typeof r.res.at === 'object' ? J(r.res.at) : r.res.at));
  const run = (x, ops, o) => { const r = applyOps(x, ops, o); if (!r.ok) throw new Error('A20 の台が当たらない：' + J(r.res)); return r.state; };
  const tr = (R, tid = 't1', id = T2) => ({ op: 'table_rules', table_id: tid, new_table_id: id, rules: R });
  const h3 = (id, seats, cells, extra = {}) => ({ op: 'hanchan_start', hanchan_id: id, table_id: T2, seats, cells, ...extra });
  const ten = (st) => { const s = sessionSeisan(st, 's1'); return s.ok ? J(['m1', 'm2', 'm3', 'm4'].map((m) => s.ten[m] ?? null)) : 'ng:' + J(s.err ?? s); };
  const R3 = { ...defaultRules(3), rate: 100, chip_pt10: 20, shugi_pt10: 10, hakoshita: false, round: 'gosha' };
  const R4 = rules;
  // 4人の台：h1・h2 とも m1 40000／m2 30000／m3 20000／m4 10000（返し 30000・ウマ 20/10・オカ 20）
  //   1回ごと m1 10+20+20=50／m2 0+10=10／m3 -10-10=-20／m4 -20-20=-40
  const four = run(base(R4), [{ op: 'table_seats', table_id: 't1', seats: SEATS }, hs('h1', [40000, 30000, 20000, 10000]), hs('h2', [40000, 30000, 20000, 10000])]);
  const to3 = applyOps(four, [tr(R3)], K);
  ok('A20 4人→3人の table_rules は ok（人数の門は無い）', to3.ok, J(to3.res));
  ok('A20 (d) 人数を替えた続きの卓の seats は []・players は 3', to3.ok && J(Tb(to3.state, T2).seats) === '[]' && Tb(to3.state, T2).rules.players === 3);
  ok('A20 (d) 人数が同じ区切りは seats を写す', (() => { const r = applyOps(four, [tr({ ...R4, uma: [30, 10, -10, -30] })], K); return r.ok && J(Tb(r.state, T2).seats) === J(SEATS); })());
  // (a) 3人（返し 40000・ウマ 15/0・オカ 15）で2回：h3 m1 50000／m2 35000／m3 20000・h4 m3 50000／m2 35000／m1 20000
  //   h3 m1 10+15+15=40／m2 -5／m3 -20-15=-35・h4 m3 40／m2 -5／m1 -35
  //   合計 m1 100+40-35=105／m2 20-10=10／m3 -40-35+40=-35／m4 -80 ×100円
  const a3 = to3.ok ? applyOps(to3.state, [h3('h3', ['m1', 'm2', 'm3'], [50000, 35000, 20000], { follow: true }), h3('h4', ['m3', 'm2', 'm1'], [50000, 35000, 20000], { follow: true })]) : { ok: false, res: 'to3' };
  ok('A20 (a) 4人で2回→3人で2回 rate 100 の精算＝ m1 10500・m2 1000・m3 -3500・m4 -8000', a3.ok && ten(a3.state) === J([10500, 1000, -3500, -8000]), a3.ok ? ten(a3.state) : J(a3.res));
  // (c) 区切り前に m4 +2・m1 -2 のチップ（鍵とレートが同じ＝(h) 枚は続きの卓へ移る）→ m4 -80+4=-76／m1 105-4=101
  const ch = run(four, [{ op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'chip', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: -2 }]);
  const c3 = applyOps(ch, [tr(R3)], K);
  ok('A20 (h) 人数だけ替え・鍵とレートが同じ＝split_same true・枚が続きの卓へ', c3.ok && Tb(c3.state, 't1').split_same === true && c3.state.extras.filter((e) => e.table_id === T2).length === 2, J(c3.res));
  const c4 = c3.ok ? applyOps(c3.state, [h3('h3', ['m1', 'm2', 'm3'], [50000, 35000, 20000], { follow: true }), h3('h4', ['m3', 'm2', 'm1'], [50000, 35000, 20000], { follow: true })]) : { ok: false, res: 'c3' };
  ok('A20 (c) 4→3 で抜けた m4 のチップは精算に残る＝ m1 10100・m2 1000・m3 -3500・m4 -7600', c4.ok && ten(c4.state) === J([10100, 1000, -3500, -7600]), c4.ok ? ten(c4.state) : J(c4.res));
  // (g) 古い版（follow:true）の4人の回は続きの卓（3人）へ運ばれて bad at seats
  ok('A20 (g) follow:true の4人の回 → bad at seats（今まで通り）', to3.ok && err(applyOps(to3.state, [hs('h9', [40000, 30000, 20000, 10000], { follow: true })])) === 'bad@seats');
  // (g2) follow の鍵が無い回は区切られた卓で bad at table_id のまま・follow:false の extra_add も bad
  ok('A20 (g2) follow の鍵が無い hanchan_start → bad at table_id', to3.ok && err(applyOps(to3.state, [hs('h9', [40000, 30000, 20000, 10000])])) === 'bad@table_id');
  ok('A20 (g2) follow:null の hanchan_start → bad at follow（真偽でない）', to3.ok && err(applyOps(to3.state, [hs('h9', [40000, 30000, 20000, 10000], { follow: null })])) === 'bad@follow');
  ok('A20 (g2) follow:false の extra_add → bad at table_id', to3.ok && err(applyOps(to3.state, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: false }])) === 'bad@table_id');
  // (e) 入れ終わった前の卓の回を直す＝前の卓・4人のまま
  const e1 = to3.ok ? applyOps(to3.state, [{ op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 1 }]) : { ok: false };
  ok('A20 (e) 前の卓の h1 を直しても t1・4人のまま', e1.ok && H(e1.state, 'h1').table_id === 't1' && H(e1.state, 'h1').cells.length === 4 && H(e1.state, 'h1').cells[0] === 41000);
  // (b) 3人の卓で1回→4人へ・m4 が入る
  //   h1（3人）m1 50000／m2 35000／m3 20000 → 40／-5／-35
  //   h2（4人）m4 40000／m1 30000／m2 20000／m3 10000 → m4 10+20+20=50／m1 0+10=10／m2 -10-10=-20／m3 -20-20=-40
  //   合計 m1 50／m2 -25／m3 -75／m4 50 ×100円
  const three = run(base(R3), [{ op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3'], cells: [50000, 35000, 20000] }]);
  const b4 = applyOps(three, [tr(R4), { op: 'hanchan_start', hanchan_id: 'h2', table_id: T2, seats: ['m4', 'm1', 'm2', 'm3'], cells: [40000, 30000, 20000, 10000], follow: true }], K);
  ok('A20 (b) 3→4 で4人目 m4 が入り精算に出る＝ m1 5000・m2 -2500・m3 -7500・m4 5000', b4.ok && ten(b4.state) === J([5000, -2500, -7500, 5000]), b4.ok ? ten(b4.state) : J(b4.res));
  // (f) ウマだけ替えた鎖（30/10→40/20）で、区切りの後に follow:false で前の卓へ届いた回
  //   h1（t1）m1 40000／m2 30000／m3 20000／m4 10000：m1 10+30+20=60／m2 0+10=10／m3 -10-10=-20／m4 -20-30=-50
  //   h2（follow:false で t1）m4 40000／m3 30000／m2 20000／m1 10000＝前のウマ：m4 60／m3 10／m2 -20／m1 -50（新しいウマなら m4 70＝違う答え）
  //   合計 m1 10／m2 -10／m3 -10／m4 10 ×100円
  const u30 = { ...R4, uma: [30, 10, -10, -30] }, u40 = { ...R4, uma: [40, 20, -20, -40] };
  const f0 = run(base(u30), [{ op: 'table_seats', table_id: 't1', seats: SEATS }, hs('h1', [40000, 30000, 20000, 10000])]);
  const f1 = run(f0, [tr(u40)], K);
  const late = { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [10000, 20000, 30000, 40000], follow: false };
  const f2 = applyOps(f1, [late]);
  ok('A20 (f) follow:false の回は区切られた前の卓に入る', f2.ok && H(f2.state, 'h2').table_id === 't1', J(f2.res));
  ok('A20 (f) 前のウマで数える＝ m1 1000・m2 -1000・m3 -1000・m4 1000', f2.ok && ten(f2.state) === J([1000, -1000, -1000, 1000]), f2.ok ? ten(f2.state) : '');
  // 倉庫の読みの created_at（続きの卓 10:00・h1 09:00・h2 10:05）
  const f3 = f2.ok ? clone(f2.state) : null;
  if (f3) { Tb(f3, T2).created_at = '2026-11-26T10:00:00+00:00'; Tb(f3, 't1').created_at = '2026-11-26T08:00:00+00:00'; H(f3, 'h1').created_at = '2026-11-26T09:00:00+00:00'; H(f3, 'h2').created_at = '2026-11-26T10:05:00+00:00'; }
  const cv = f3 ? chainView(f3, 't1') : null;
  ok('A20 (f) k が1増える（splits.upto 2）', cv && cv.splits.length === 1 && cv.splits[0].upto === 2, cv && J(cv.splits));
  ok('A20 (f) late は区切りの後に作った前の卓の回だけ（h1 false・h2 true）', cv && J(cv.rows.map((r) => [r.hanchan_id, r.late])) === J([['h1', false], ['h2', true]]), cv && J(cv.rows.map((r) => [r.hanchan_id, r.late])));
  ok('A20 (f) created_at が無い写しは late を出さない（黙って true にしない）', f2.ok && chainView(f2.state, 't1').rows.every((r) => r.late === false));
  ok('A20 (f) 区切っていない卓へ follow:false は今まで通りそのまま入る', applyOps(f0, [{ ...late, hanchan_id: 'h3' }]).ok);
  // (i) 持ち点だけ替えた（25000→30000・返し 30000）後に前の持ち点の合計の回を新しい卓へ＝入る・合計違いで ng・精算に入らない
  const i1 = run(f0, [tr({ ...u30, start_pts: 30000 })], K);
  const i2 = applyOps(i1, [{ op: 'hanchan_start', hanchan_id: 'h2', table_id: T2, seats: SEATS, cells: [40000, 30000, 20000, 10000], follow: true }]);
  const iv = i2.ok ? chainView(i2.state, 't1') : null;
  ok('A20 (i) 前の持ち点の合計の回は入る・その回は ng（直してくださいの行）', iv && iv.rows.length === 2 && iv.rows[1].ok === false && iv.rows[0].ok === true, iv && J(iv.rows.map((r) => [r.ok, r.why])));
  ok('A20 (i) 精算は ng の回を足さない（missing に1つ）', i2.ok && sessionSeisan(i2.state, 's1').missing.length === 1, i2.ok ? J(sessionSeisan(i2.state, 's1').missing) : '');
}
console.log('■ D2 リーグの頁の写し scope（d2_sadame v1.1 §2）');
{
  const LG = '0b9d2f1e-5c4a-4e8b-9f3d-2a1c7e6b5d40', LG2 = '1c8e3a2f-6d5b-4f9c-8e4a-3b2d8f7c6e51';
  const ER = (r) => (r.ok ? 'ok' : r.res.err + (r.res.at ? '@' + r.res.at : '') + (r.res.need ? ':' + r.res.need : ''));
  const main = { ...rules, rate: 100 };
  const R3 = { ...defaultRules(3), rate: 50, hakoshita: false };
  const m4 = applyOps(withRules(rules), ['m1', 'm2', 'm3', 'm4'].map((m, i) => ({ op: 'member_add', member_id: m, name: ['山田', '鈴木', '佐藤', '高橋'][i] }))).state;
  const sc = { league_id: LG, isL: true, rules: main, rules_alt: R3, days: [] };
  const sa = (o = {}) => ({ op: 'session_add', session_id: 'd1', date: '2026-11-23', league_id: LG, ...o });
  const a = applyOps(m4, [sa(), { op: 'table_add', table_id: 'u1', session_id: 'd1', label: '卓1' }, { op: 'table_add', table_id: 'u2', session_id: 'd1', label: '卓2', alt: true }], { scope: sc });
  const T = (st, id) => st.tables.find((t) => t.table_id === id);
  ok('D2 scope の session_add＋主の卓＋alt の卓 → ok・日の rate はリーグの主の rate（100）', a.ok && a.state.sessions.find((x) => x.session_id === 'd1').rate === 100, ER(a));
  ok('D2 写しの日は room の st と同じ形（league_id・rules を持たない）', a.ok && J(Object.keys(a.state.sessions.find((x) => x.session_id === 'd1')).sort()) === J(['date', 'rate', 'session_id']));
  ok('D2 主の卓は4人・alt の卓は3人で alt のルール（rate 50）', a.ok && T(a.state, 'u1').rules.players === 4 && T(a.state, 'u2').rules.players === 3 && T(a.state, 'u2').rules.rate === 50);
  ok('D2 返しの days に新しい日の版（主・alt）を足す・渡した scope.days は変えない', a.ok && a.days.length === 1 && a.days[0].session_id === 'd1' && a.days[0].rules === main && a.days[0].rules_alt === R3 && sc.days.length === 0);
  // 開催日の版：リーグの今の版（uma 違い）に変わっても、その日の卓は days の版
  const main2 = { ...main, uma: [30, 10] };
  const sc2 = { ...sc, rules: main2, rules_alt: null, days: a.days };
  const b = applyOps(a.state, [{ op: 'table_add', table_id: 'u3', session_id: 'd1', label: '卓3' }, { op: 'table_add', table_id: 'u4', session_id: 'd1', label: '卓4', alt: true }], { scope: sc2 });
  ok('D2 卓のルールは days のその日の版（リーグの今の版でない）・今の alt が無くても日の alt で作れる', b.ok && J(T(b.state, 'u3').rules) === J(T(a.state, 'u1').rules) && T(b.state, 'u4').rules.players === 3, ER(b));
  ok('D2 op の rate が主と同じ 100 → ok／違う 200 → bad@rate', ER(applyOps(m4, [sa({ rate: 100 })], { scope: sc })) === 'ok' && ER(applyOps(m4, [sa({ rate: 200 })], { scope: sc })) === 'bad@rate');
  ok('D2 他のリーグ・league_id 無し → bad@league_id', ER(applyOps(m4, [sa({ league_id: LG2 })], { scope: sc })) === 'bad@league_id' && ER(applyOps(m4, [sa({ league_id: undefined })], { scope: sc })) === 'bad@league_id');
  const noAlt = { ...sc, rules_alt: null };
  ok('D2 rules_alt の無い日の alt → bad@alt', ER(applyOps(m4, [sa(), { op: 'table_add', table_id: 'u1', session_id: 'd1', label: '卓1', alt: true }], { scope: noAlt })) === 'bad@alt');
  ok('D2 alt が bool でない → bad@alt・scope でない写しの alt true → bad@alt・alt false は ok', ER(applyOps(a.state, [{ op: 'table_add', table_id: 'u5', session_id: 'd1', label: '卓5', alt: 1 }], { scope: { ...sc, days: a.days } })) === 'bad@alt'
    && ER(applyOps(base(), [{ op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2', alt: true }])) === 'bad@alt'
    && ER(applyOps(base(), [{ op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2', alt: false }])) === 'ok');
  ok('D2 scope の days に無い日の table_add → bad@session_id', ER(applyOps(base(), [{ op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' }], { scope: sc })) === 'bad@session_id');
  const bad = applyOps(m4, [sa(), { op: 'table_add', table_id: 'u1', session_id: 'd1', label: '' }], { scope: sc });
  ok('D2 組が弾かれたら days も写しも増えない', !bad.ok && bad.days === undefined && bad.state === m4 && sc.days.length === 0);
  // isL 偽＝L の op は並びに積まない（held を作らない）・nyu の op は通る
  const nl = { ...sc, isL: false, days: a.days };
  const c1 = applyOps(m4, [sa()], { scope: { ...nl, days: [] } });
  ok('D2 isL 偽の session_add → mj_role:L・何も当てない', ER(c1) === 'mj_role:L' && c1.state === m4);
  ok('D2 isL 偽の table_add・table_seats → mj_role:L', ER(applyOps(a.state, [{ op: 'table_add', table_id: 'u9', session_id: 'd1', label: '卓9' }], { scope: nl })) === 'mj_role:L'
    && ER(applyOps(a.state, [{ op: 'table_seats', table_id: 'u1', seats: ['m1', 'm2', 'm3', 'm4'] }], { scope: nl })) === 'mj_role:L');
  const c3 = applyOps(a.state, [hs('h1', [10000, 20000, 30000, 40000], { table_id: 'u1' }), { op: 'extra_add', table_id: 'u1', member_id: 'm1', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 'u1', member_id: 'm2', kind: 'chip', add: -1 }], { scope: nl });
  ok('D2 isL 偽でも hanchan_start・extra_add（nyu）は ok＝1回目の点が入る', c3.ok && c3.state.hanchans.some((h) => h.hanchan_id === 'h1' && h.table_id === 'u1'), ER(c3));
  ok('D2 scope でない写しのリーグの session_add は今のまま err direct', ER(applyOps(m4, [sa()])) === 'direct');
}
console.log('■ P5 分けた読み（p5_sadame v1.3 §3＝loaded・unloaded・readArgs）');
{
  const ER = (r) => (r.ok ? 'ok' : r.res.err + (r.res.at ? '@' + r.res.at : '') + (r.res.id ? ':' + r.res.id : ''));
  // s0＝頭だけ（中身を読んでいない）・s1＝読んだ開催
  const full = applyOps(base(), [{ op: 'session_add', session_id: 's0', date: '2026-11-19', rate: 100 }, { op: 'table_add', table_id: 't0', session_id: 's0', label: '卓1' },
    hs('h1', [40000, 30000, 20000, 10000]), { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -2 }]).state;
  const P = clone(full);
  P.v = 3; P.loaded = ['s1']; P.absent = [];
  P.tables = P.tables.filter((t) => t.session_id !== 's0');
  ok('P5 v3 の写しは門を通る（migrateState ok・形を直さない・loaded を残す）', (() => { const m = migrateState(clone(P), rules); return m.gate.mode === 'ok' && !m.migrated && J(m.st.loaded) === J(['s1']) && m.st.v === 3; })());
  ok('P5 v2 の写しは loaded を足さない（全部読み済み）・並びを捨てない（migrated 偽）', (() => { const m = migrateState(clone(full), rules); return !m.migrated && !('loaded' in m.st) && m.st.v === 2; })());
  const u1 = applyOps(P, [{ op: 'table_add', table_id: 't9', session_id: 's0', label: '卓2' }]);
  ok('P5 読んでいない開催への table_add → unloaded@session_id:s0・写しは変わらない', ER(u1) === 'unloaded@session_id:s0' && u1.state === P, ER(u1));
  ok('P5 読んでいない開催の settle_snap → unloaded@session_id:s0', ER(applyOps(P, [{ op: 'settle_snap', session_id: 's0', rev: 1, content: {}, used: {}, missing: [] }])) === 'unloaded@session_id:s0');
  ok('P5 写しに無い卓の hanchan_start・extra_add・table_seats → unloaded@table_id', ER(applyOps(P, [hs('h9', [40000, 30000, 20000, 10000], { table_id: 't0' })])) === 'unloaded@table_id:t0'
    && ER(applyOps(P, [{ op: 'extra_add', table_id: 't0', member_id: 'm1', kind: 'chip', add: 1 }])) === 'unloaded@table_id:t0'
    && ER(applyOps(P, [{ op: 'table_seats', table_id: 't0', seats: SEATS }])) === 'unloaded@table_id:t0');
  ok('P5 写しに無い半荘の cell_set・hanchan_void → unloaded@hanchan_id', ER(applyOps(P, [{ op: 'cell_set', hanchan_id: 'h0', seat: 0, value: 100, base_version: 1 }])) === 'unloaded@hanchan_id:h0'
    && ER(applyOps(P, [{ op: 'hanchan_void', hanchan_id: 'h0' }])) === 'unloaded@hanchan_id:h0');
  const ok1 = applyOps(P, [hs('h2', [25000, 25000, 25000, 25000]), { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 1 }, { op: 'session_edit', session_id: 's0', place: '東' }]);
  ok('P5 読んだ開催の op と頭だけの開催の session_edit は ok', ok1.ok, ER(ok1));
  const all = { ...clone(P), loaded: ['s0', 's1'] };
  ok('P5 全部の開催が loaded なら写しに無い卓・半荘は今と同じ bad（unloaded にしない）', ER(applyOps(all, [hs('h9', [40000, 30000, 20000, 10000], { table_id: 'tz' })])) === 'bad'
    && ER(applyOps(all, [{ op: 'cell_set', hanchan_id: 'hz', seat: 0, value: 100, base_version: 1 }])) === 'bad');
  ok('P5 loaded の無い写し（base・emptyState）は unloaded を出さない', ER(applyOps(base(), [hs('h9', [40000, 30000, 20000, 10000], { table_id: 'tz' })])) === 'bad'
    && ER(applyOps(emptyState(), [{ op: 'table_add', table_id: 'tz', session_id: 'sz', label: '卓1' }])) === 'bad');
  const na = applyOps(P, [{ op: 'session_add', session_id: 's2', date: '2026-11-23', rate: 100 }, { op: 'table_add', table_id: 't2', session_id: 's2', label: '卓1' }, hs('h3', [40000, 30000, 20000, 10000], { table_id: 't2' })]);
  ok('P5 session_add で作った開催は loaded に足す＝続く table_add・hanchan_start が当たる・元の写しの loaded は変えない', na.ok && J(na.state.loaded) === J(['s1', 's2']) && J(P.loaded) === J(['s1']), ER(na));
  const s0 = sessionSeisan(P, 's0'), b0 = sessionBreakdown(P, 's0');
  ok('P5 頭だけの開催の精算 → err unloaded（ok と 0 を出さない）', s0.ok === false && s0.err === 'unloaded' && !('ten' in s0), J(s0));
  ok('P5 頭だけの開催の1人ずつ → ok 偽・by／order／rates／count は空', b0.ok === false && b0.err === 'unloaded' && J(b0.by) === '{}' && b0.order.length === 0 && b0.rates.length === 0 && b0.count === 0);
  ok('P5 読んだ開催の精算と1人ずつは全部の写しと同じ', canon(sessionSeisan(P, 's1').ten) === canon(sessionSeisan(full, 's1').ten) && sessionSeisan(P, 's1').ok
    && canon(sessionBreakdown(P, 's1').by) === canon(sessionBreakdown(full, 's1').by), J(sessionSeisan(P, 's1')));
  ok('P5 loaded の無い写しの精算は今と同じ（unloaded にしない）', sessionSeisan(full, 's0').ok === true && sessionBreakdown(full, 's0').ok === undefined);
  // readArgs
  const I = (n) => '00000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
  const R = { v: 3, members: [], sessions: [{ session_id: I(1), date: '2026-11-20', rate: 100 }, { session_id: I(2), date: '2026-11-21', rate: 100 }],
    tables: [{ table_id: 'ta', session_id: I(2) }], hanchans: [{ hanchan_id: 'ha', table_id: 'ta' }], extras: [], settles: [], loaded: [I(2)], absent: [I(9)] };
  const ob = [{ op_id: 'x', ops: [{ op: 'session_add', session_id: I(5), date: '2026-11-23' }, { op: 'table_add', table_id: 'tb', session_id: I(5), label: '卓1' }, hs('hb', [1, 2, 3, 4], { table_id: 'tb' })] },
    { op_id: 'y', ops: [{ op: 'cell_set', hanchan_id: 'hb', seat: 0, value: 100, base_version: 1 }, { op: 'cell_set', hanchan_id: 'ha', seat: 0, value: 100, base_version: 1 }] }];
  ok('P5 readArgs：並びの session_add の開催は入れない（その卓・半荘の op も）・写しの半荘→卓→開催を引く', J(readArgs(R, ob, null, 7)) === J({ v: 3, sessions: [I(2)], since: 7 }), J(readArgs(R, ob, null, 7)));
  ok('P5 readArgs：開いている頁の開催を先頭に・loaded に無ければ since 無し', J(readArgs(R, ob, I(1), 7)) === J({ v: 3, sessions: [I(1), I(2)] }));
  ok('P5 readArgs：absent に返った id は since を止めない', J(readArgs(R, [], I(9), 7)) === J({ v: 3, sessions: [I(9)], since: 7 }));
  ok('P5 readArgs：並びの table_add（読んでいない開催）から開催を引く', J(readArgs(R, [{ op_id: 'z', ops: [{ op: 'table_add', table_id: 'td', session_id: I(1), label: '卓2' }, { op: 'extra_add', table_id: 'td', member_id: 'm1', kind: 'chip', add: 1 }] }], null, 7)) === J({ v: 3, sessions: [I(1)] }));
  ok('P5 readArgs：loaded の無い写し（v2）は since 無し＝v3 を読み直す・read_ver が無ければ since 無し', J(readArgs(full, [], null, 7)) === J({ v: 3, sessions: [] }) && J(readArgs(R, [], null, null)) === J({ v: 3, sessions: [] }));
  ok('P5 readArgs：uuid の字でない id は入れない・50 まで', J(readArgs(R, [], 's1', 7).sessions) === '[]' && readArgs(R, [{ op_id: 'w', ops: Array.from({ length: 60 }, (_, i) => ({ op: 'settle_snap', session_id: '00000000-0000-4000-8000-0000000001' + String(i).padStart(2, '0') })) }], null, 7).sessions.length === 50);
  ok('P5 sessionOfRef：table_rules の新しい卓は元の卓の開催・引けなければ null', sessionOfRef(R, [{ ops: [{ op: 'table_rules', table_id: 'ta', new_table_id: 'tn' }] }], 'table_id', 'tn') === I(2) && sessionOfRef(R, [], 'table_id', 'tq') === null);
}
console.log('■ P8 卓の鎖は段の数で切らない（p8_sadame v4 §1-5・§3）');
{
  const K = { direct: true, role: 'kan' };
  const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const N = 1005;
  // 台：h1 と チップ m1 +3 / m2 -3 → ウマだけ変える区切りを N 回（枚の鍵は同じ＝split_same true・枚は最後へ移る）
  let st = applyOps(base({ ...rules, uma: [30, 10, -10, -30] }), [hs('h1', [40000, 30000, 20000, 10000]),
    { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 3 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -3 }]).state;
  let last = 't1';
  for (let i = 1; i <= N; i++) {
    const r = applyOps(st, [{ op: 'table_rules', table_id: last, new_table_id: U(i), rules: { ...rules, uma: i % 2 ? [40, 20, -20, -40] : [30, 10, -10, -30] } }], K);
    if (!r.ok) throw new Error('P8 の台が当たらない：' + i + ' ' + J(r.res));
    st = r.state; last = U(i);
  }
  const ch = tableChain(st, 't1');
  ok('P8 tableChain 1,005 段＝長さ 1,006・頭 t1・最後 ' + N + ' 段目・順（真ん中から引いても同じ）', ch.length === N + 1 && ch[0] === 't1' && ch[N] === U(N) && ch.every((x, i) => x === (i ? U(i) : 't1')) && J(tableChain(st, U(500))) === J(ch) && ch.broken !== true, ch.length + ' ' + ch[N]);
  const cv = chainView(st, U(N));
  ok('P8 chainView の和に1段目（t1）の半荘が入る・broken false', cv && cv.rows.length === 1 && cv.rows[0].table_id === 't1' && cv.broken === false && cv.total10.m1 !== 0, cv && J({ n: cv.rows.length, b: cv.broken }));
  const fa = followT(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true });
  ok('P8 followT は 1,005 段先の最後の卓へ（1000 で切らない）', fa.t && fa.t.table_id === U(N), J(fa.bad));
  const w = applyOps(st, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -1, follow: true }]);
  ok('P8 頭から follow の extra_add が最後の卓に入る（正味の門も通る）', w.ok && w.state.extras.find((e) => e.table_id === U(N) && e.member_id === 'm1').value === 4, J(w.res));
  // 輪（状態を手で壊す）＝子のプロセスで 5 秒で切る（守りを外すと止まらない＝時間切れを赤に数える）
  const small = applyOps(base({ ...rules, uma: [30, 10, -10, -30] }), [hs('h1', [40000, 30000, 20000, 10000]),
    { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 3 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -3 }]).state;
  const sp = applyOps(small, [{ op: 'table_rules', table_id: 't1', new_table_id: U(1), rules: { ...rules, uma: [40, 20, -20, -40] } }], K).state;
  const cyc = clone(sp); cyc.tables.find((t) => t.table_id === U(1)).next_table_id = 't1';
  const xs = cyc.extras.find((e) => e.table_id === U(1) && e.member_id === 'm1');
  const lib = new URL('../lib/room-state.mjs', import.meta.url).href;
  const code = `import { tableChain, followT, chainView, applyOps } from ${J(lib)};
let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => { const st = JSON.parse(s);
const ch = tableChain(st, 't1'); const cv = chainView(st, 't1');
const ft = followT(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true });
const fh = followT(st, { op: 'hanchan_start', table_id: 't1', follow: true });
const g = applyOps(st, [{ op: 'extra_set', table_id: ${J(U(1))}, member_id: 'm1', kind: 'chip', value: 2, base_version: ${xs.version} }]);
console.log(JSON.stringify({ broken: ch.broken === true, len: ch.length, cvBroken: cv.broken, t10: cv.total10.m1, ft: ft.bad && ft.bad.at, fh: fh.bad && fh.bad.at, g: g.ok ? 'ok' : g.res.err + '@' + g.res.at })); });`;
  const cp = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: J(cyc), timeout: 5000, encoding: 'utf8' });
  let o = null; try { o = JSON.parse(cp.stdout); } catch { o = null; }
  ok('P8 輪の試験は 5 秒の内に終わる（時間切れ＝赤）', cp.error == null && cp.signal == null && o !== null, (cp.error && cp.error.code) + ' ' + cp.signal + ' ' + (cp.stderr || '').slice(0, 300));
  ok('P8 輪で tableChain は broken・長さは卓の数まで', o && o.broken === true && o.len <= 2, J(o));
  ok('P8 輪で chainView は broken true・和はそのまま（null にしない）', o && o.cvBroken === true && typeof o.t10 === 'number' && o.t10 !== 0, J(o));
  ok('P8 輪で followT は bad at table_id（extra_add・鍵を見ない hanchan_start も）', o && o.ft === 'table_id' && o.fh === 'table_id', J(o));
  ok('P8 輪の鎖の行を書く組は正味の門で bad at table_id', o && o.g === 'bad@table_id', J(o));
}

console.log('■ E2（A21）1人でも点を入れる・空いた席は null・開いている回は鎖に1つ（e_sadame v2 §E2）');
{
  const er = (r) => (r.ok ? 'ok' : r.res.err + '@' + (typeof r.res.at === 'object' ? J(r.res.at) : r.res.at));
  const run = (x, ops, o) => { const r = applyOps(x, ops, o); if (!r.ok) throw new Error('E2 の台が当たらない：' + J(r.res)); return r.state; };
  const cs = (seat, value, bv, id = 'h1') => ({ op: 'cell_set', hanchan_id: id, seat, value, base_version: bv });
  // 手で数えた値：返し 30000・ウマ [20,10,-10,-20]・オカ +20（(30000−25000)×4／1000）→ [40000,30000,20000,10000] は pt [50,10,-20,-40]
  const FULL10 = [500, 100, -200, -400];
  const s1 = run(base(), [hs('h1', [40000, null, 20000, null], { seen_n: 0 })]);
  const h1 = H(s1, 'h1');
  ok('E2 §1 空いた席が null の始めは通る・cells と cell_ver は席の順に null（倉庫の読みと同じ）', J(h1.cells) === J([40000, null, 20000, null]) && J(h1.cell_ver) === J([1, null, 1, null]), J(h1));
  ok('E2 §1 全部 null は range at cells', er(applyOps(base(), [hs('h1', [null, null, null, null])])) === 'range@cells');
  ok('E2 §1 null と 100点単位でない数の混ぜは range at cells', er(applyOps(base(), [hs('h1', [40050, null, 20000, null])])) === 'range@cells');
  const hv = hanchanView(rules, h1);
  ok('E2 §2 hanchanView＝why cells・seats は点の無い席の番号', hv.ok === false && hv.why === 'cells' && J(hv.seats) === J([1, 3]), J(hv));
  const tv = tableView(s1, 't1');
  ok('E2 §2 tableView の行＝ok false why cells seats・空いた席の cell は null・pt は null', tv.rows[0].ok === false && tv.rows[0].why === 'cells' && J(tv.rows[0].seats) === J([1, 3]) && tv.rows[0].by.m2.cell === null && tv.rows[0].by.m1.cell === 40000 && tv.rows[0].by.m1.pt10 === null, J(tv.rows[0]));
  ok('E2 §2 その回はお金に入れない（total10 は全員 0）・missing に cells と seats', Object.values(tv.total10).every((x) => x === 0) && J(tv.missing) === J([{ no: 1, why: 'cells', seats: [1, 3] }]), J([tv.total10, tv.missing]));
  const cv = chainView(s1, 't1');
  ok('E2 §2 chainView の行も why cells seats', cv.rows[0].why === 'cells' && J(cv.rows[0].seats) === J([1, 3]), J(cv.rows[0]));
  const ss = sessionSeisan(s1, 's1');
  ok('E2 §2 sessionSeisan の missing に卓の番号つきで cells', ss.missing.some((m) => m.table === 1 && m.no === 1 && m.why === 'cells' && J(m.seats) === J([1, 3])), J(ss.missing));
  // 合計の確かめ（A9）は全員そろってから＝合わない数でも null が在る間は sum でなく cells
  const sBad = run(base(), [hs('h1', [90000, null, 20000, null])]);
  ok('E2 §2 null が在る間は合計の違いを出さない（why cells・sum でない）', hanchanView(rules, H(sBad, 'h1')).why === 'cells');
  // §5 (a) 開いている回が在れば次の始めは conflict open・何も書かない
  const a2 = applyOps(s1, [hs('h2', [40000, 30000, 20000, 10000], { seen_n: 1 })]);
  ok('E2 §5(a) 開いている回が在れば始めは conflict at {what:open, hanchan_id}', er(a2) === 'conflict@' + J({ what: 'open', hanchan_id: 'h1' }) && a2.state.hanchans.length === 1, er(a2));
  ok('E2 §5(a) seen_n が無い（古い PWA）でも open は止める', er(applyOps(s1, [hs('h2', [40000, 30000, 20000, 10000])])) === 'conflict@' + J({ what: 'open', hanchan_id: 'h1' }));
  // §4 行の無い席：版0 で v1・行が在れば conflict cur{value,version}・版1以上は conflict cur{null,0}
  const b1 = applyOps(s1, [cs(1, 30000, 0)]);
  ok('E2 §4 行の無い席に版0 で入れると v1', b1.ok && H(b1.state, 'h1').cells[1] === 30000 && H(b1.state, 'h1').cell_ver[1] === 1, er(b1));
  const b2 = applyOps(b1.state, [cs(1, 31000, 0)]);
  ok('E2 §4 2回目の版0（行が在る）は conflict cur {value, version}', er(b2) === 'conflict@' + J({ hanchan_id: 'h1', seat: 1 }) && J(b2.res.cur) === J({ value: 30000, version: 1 }), J(b2.res));
  const b3 = applyOps(s1, [cs(3, 10000, 1)]);
  ok('E2 §4 行の無い席に版1 は conflict cur {null, 0}（例外にしない）', er(b3) === 'conflict@' + J({ hanchan_id: 'h1', seat: 3 }) && J(b3.res.cur) === J({ value: null, version: 0 }), J(b3.res));
  const s2 = run(b1.state, [cs(3, 10000, 0)]);
  const hv2 = hanchanView(rules, H(s2, 'h1'));
  ok('E2 全員そろうと pt＝手で数えた [50,10,-20,-40]（全部で始めた回と同じ）', hv2.ok && J(hv2.pt10) === J(FULL10), J(hv2));
  ok('E2 全員そろうと total10 に入る（m1 +500）', tableView(s2, 't1').total10.m1 === 500);
  // §5 (b) 鎖の回の数（取り消しも）＞ seen_n は conflict new（一番新しい回）
  const c1 = applyOps(s2, [hs('h2', [40000, 30000, 20000, 10000], { seen_n: 0 })]);
  ok('E2 §5(b) seen_n が古い（0＜1）は conflict at {what:new, hanchan_id: 一番新しい}', er(c1) === 'conflict@' + J({ what: 'new', hanchan_id: 'h1' }) && c1.state.hanchans.length === 1, er(c1));
  ok('E2 §5(b) seen_n が今の数なら通る', applyOps(s2, [hs('h2', [40000, 30000, 20000, 10000], { seen_n: 1 })]).ok);
  ok('E2 §5(b) seen_n が無い（古い PWA）は (b) を飛ばす', applyOps(s2, [hs('h2', [40000, 30000, 20000, 10000])]).ok);
  ok('E2 §5 seen_n の形が違う（−1・字・1.5・20億超え）は bad at seen_n', [-1, '1', 1.5, 2000000001].every((v) => er(applyOps(s2, [hs('h2', [40000, 30000, 20000, 10000], { seen_n: v })])) === 'bad@seen_n'));
  ok('E2 §5 seen_n は hanchan_start の鍵（他の op では bad at seen_n）', er(applyOps(s2, [{ ...cs(0, 41000, 1), seen_n: 1 }])) === 'bad@seen_n');
  // 取り消しも数える・取り消した回は開いていない
  const d1 = run(s2, [hs('h2', [40000, null, null, null], { seen_n: 1 }), { op: 'hanchan_void', hanchan_id: 'h2' }]);
  ok('E2 §5 取り消した回も数える（2＞1 は new・一番新しい＝h2）', er(applyOps(d1, [hs('h3', [40000, 30000, 20000, 10000], { seen_n: 1 })])) === 'conflict@' + J({ what: 'new', hanchan_id: 'h2' }));
  const d2 = applyOps(d1, [hs('h3', [null, 30000, null, null], { seen_n: 2 })]);
  ok('E2 §3 取り消した点がまだの回は開いていない＝次の始めは通る', d2.ok, er(d2));
  const d3 = applyOps(d2.state, [{ op: 'hanchan_unvoid', hanchan_id: 'h2' }]);
  ok('E2 点がまだの回を戻す時に他の開いている回が在れば conflict open', er(d3) === 'conflict@' + J({ what: 'open', hanchan_id: 'h3' }) && H(d3.state, 'h2').voided === true, er(d3));
  ok('E2 そろった回は戻しても止めない', applyOps(run(s2, [{ op: 'hanchan_void', hanchan_id: 'h1' }, hs('h2', [null, 30000, null, null])]), [{ op: 'hanchan_unvoid', hanchan_id: 'h1' }]).ok);
  // 区切った卓（鎖）でも開いている回は1つ：頭の卓の開いている回が鎖の最後の卓の始めを止める
  const T2 = '00000000-0000-4000-8000-0000000000e2';
  const ch = run(s1, [{ op: 'table_rules', table_id: 't1', new_table_id: T2, rules: { ...rules, uma: [30, 10, -10, -30] } }], { direct: true, role: 'kan' });
  const e1 = applyOps(ch, [hs('h2', [40000, 30000, 20000, 10000], { follow: true, seen_n: 1 })]);
  ok('E2 §3 鎖の前の卓に開いている回が在れば、区切った後の始めも conflict open', er(e1) === 'conflict@' + J({ what: 'open', hanchan_id: 'h1' }), er(e1));
}

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
