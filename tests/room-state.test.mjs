/* room-state.test.mjs — ★lib/room-state.mjs（端末の写しに op を当てる・対局の1ページの数）が手で決めた答えを出すか★（CI）
 * op の形・範囲・版は倉庫の取り決め（write_sekkei.md §3・§4・§6 v5.2）＝範囲の端は tests/fixtures/write-cases.json（倉庫の write.live.mjs も読む）。
 * 例は設計図 §2 の絵（1pt＝100・チップ1枚2.0pt・祝儀1枚1.0pt）に寄せた数。
 * 使い方: node tests/room-state.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyState, applyOp, applyOps, tableView, sessionSeisan, checkEntry, pickSession, sessionSig,
  migrateState, tobiSetOp, roomGate, tableRate, tenChanged, sessionBreakdown, canon, NEWER_TEXT, gateText, OP_NAMES, OPS_MAX, CELL_MAX, LOST_MAX, EXTRA_MAX,
} from '../lib/room-state.mjs';
import { defaultRules, rulesOk } from '../lib/rules.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));
const SEATS = ['m1', 'm2', 'm3', 'm4'];

const rules = { ...defaultRules(4), rate: 100, chip_pt10: 20, shugi_pt10: 10 };
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
ok('素点は ±200,000', CELL_MAX === 200000);
ok('消えた供託は 20,000 まで', LOST_MAX === 20000);
ok('チップ・祝儀は ±999', EXTRA_MAX === 999);
ok('1つの組は30個まで', OPS_MAX === 30);
ok('op は18個（2c-2a2 の直す op 6個を足した）', OP_NAMES.length === 18 && J([...OP_NAMES].sort()) === J(['cell_set', 'extra_add', 'extra_set', 'hanchan_order', 'hanchan_seats', 'hanchan_start', 'hanchan_unvoid', 'hanchan_void', 'kyotaku_set', 'member_active', 'member_add', 'member_rename', 'session_add', 'session_edit', 'settle_snap', 'table_add', 'table_edit', 'tobi_set']), J(OP_NAMES));

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
  ok('飛んだ人の受け取りが無いと tobi（席3）', v.rows[1].why === 'tobi' && J(v.rows[1].seats) === J([3]), J(v.rows[1]));
  ok('順を入れる（版1）', applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m2', 'm1', 'm3', 'm4'], base_version: 1 }).ok && H(st, 'h1').order_version === 2);
  ok('受け取りを入れる（版1・まるごと）', applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: { 3: 0 }, base_version: 1 }).ok && J(H(st, 'h2').tobi_to) === J({ 3: 0 }) && H(st, 'h2').tobi_version === 2);
  v = tableView(st, 't1');
  ok('順を入れると上家（鈴木）が1位', v.rows[0].ok && v.rows[0].by.m2.pt10 === 460 && v.rows[0].by.m1.pt10 === 150, J(v.rows[0].by));
  ok('飛び賞は窓の pt に入る（山田 55+10・高橋 −50−10）', v.rows[1].ok && v.rows[1].by.m1.pt10 === 650 && v.rows[1].by.m4.pt10 === -600, J(v.rows[1].by));
  ok('順の同じ値は古い版でも ok', applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m2', 'm1', 'm3', 'm4'], base_version: 1 }).ok);
  const oc = applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', ton_order: ['m1', 'm2', 'm3', 'm4'], base_version: 1 });
  ok('順の古い版で違う値は conflict', oc.err === 'conflict' && oc.cur.version === 2 && J(oc.cur.value) === J(['m2', 'm1', 'm3', 'm4']), J(oc));
  ok('tobi_set はまるごと置き換え（空にすると鍵が消える＝まだ）', applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', tobi_to: {}, base_version: 2 }).ok && J(H(st, 'h2').tobi_to) === '{}' && tableView(st, 't1').rows[1].why === 'tobi');
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
  ok('消した後は聞き直し（tobi）', tableView(r1.state, 't1').rows[0].why === 'tobi');
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

console.log('■ 弾く形（知らない鍵・18個以外・constructor・__proto__・組の数）');
{
  const st = applyOps(base(), [hs('h1', [40000, 30000, 20000, 10000])]).state;
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'room_delete', 'mj_write', '']) {
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
  for (const v of [3, '3', 3.5, -1, null]) {
    const x = { ...clone(st), v }; const keep = J(x);
    const m = migrateState(x);
    ok('st.v ' + J(v) + ' → newer・形を直さない・写しは1字も変わらない', m.gate.mode === 'newer' && !m.migrated && m.st === x && J(x) === keep, J(m.gate));
  }
  const tw = (fn) => { const x = clone(st); fn(x); return migrateState(x).gate; };
  ok('卓の rules が null → rules_bad', tw((x) => { x.tables[0].rules = null; }).mode === 'rules_bad');
  ok('卓の rules が配列 → rules_bad', tw((x) => { x.tables[0].rules = []; }).mode === 'rules_bad');
  ok('卓の rules に知らない鍵 → newer（v:2 の写し＝早い返しの道も門を通る）', (() => { const g = tw((x) => { x.tables[0].rules.zzz = 1; }); return g.mode === 'newer' && g.why === 'zzz'; })());
  ok('③-0 では yakitori_to は知らない鍵 → newer（③-1 から43鍵）', tw((x) => { x.tables[0].rules.yakitori_to = 'each'; }).mode === 'newer');
  ok('41鍵の範囲の外 → rules_bad（鍵名を返す）', (() => { const g = tw((x) => { x.tables[0].rules.aka = 99; }); return g.mode === 'rules_bad' && g.why === 'aka'; })());
  ok('extras の知らない kind（c:x）→ newer', tw((x) => { x.extras.push({ table_id: x.tables[0].table_id, member_id: 'm1', kind: 'c:x', value: 1, version: 1 }); }).mode === 'newer');
  ok('半荘の知らない欄（yakitori）→ newer', tw((x) => { x.hanchans[0].yakitori = []; }).mode === 'newer');
  ok('部屋の rules（roomRules）に知らない鍵 → newer・roomRules を渡さなければ部屋の判じは飛ばす', migrateState(clone(st), { ...rules, yakitori_to: 'each' }).gate.mode === 'newer' && migrateState(clone(st)).gate.mode === 'ok');
  ok('帯の字', gateText({ mode: 'newer' }) === NEWER_TEXT && gateText({ mode: 'rules_bad', why: 'aka' }) === 'この部屋のルールが読めません（aka）');
  const part = clone(st); part.tables[0].rules = { players: 4, rate: 100 }; const keepP = J(part);
  const mp = migrateState(part);
  ok('足りない卓の rules は41鍵に埋める・元の写しは触らない・埋めは migrated を立てない', mp.gate.mode === 'ok' && Object.keys(mp.st.tables[0].rules).length === 41 && J(part) === keepP && !mp.migrated);
  const bad = clone(st); bad.tables[0].rules.zzz = 1; const keepB = J(bad);
  let all = true;
  for (const name of OP_NAMES) { const r = applyOps(bad, [{ op: name }]); if (r.ok || r.res.err !== 'newer' || r.state !== bad || r.idx !== 0) all = false; }
  ok('newer の部屋へ ' + OP_NAMES.length + ' の op 全部 → 何も当たらない（{ok:false, idx:0, res:{err:newer}, state}）', all && J(bad) === keepB && OP_NAMES.length === 18);
  ok('opts.roomRules に知らない鍵 → newer で組ごと止まる', applyOps(st, [{ op: 'member_add', member_id: 'm9', name: '新' }], { roomRules: { ...rules, yakitori_to: 'each' } }).res.err === 'newer');
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

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
