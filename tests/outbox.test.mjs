/* outbox.test.mjs — ★lib/outbox.mjs（未送信の並びの受け方）が取り決め §6-11・12・14・14' の通りに振り分けるか★（CI）
 * 使い方: node tests/outbox.test.mjs  /  node tests/outbox.test.mjs --self-test（振り分けをわざと壊して赤になるか）
 */
import { outboxStep, retryDelay, holdHead, dropHead, canSend, heldInfo, heldClosed, aizuSendV, aizuReadV, AIZU_GAP_MS, BUSY_RETRY, BUSY_STOP, unholdBusy, heldAny, heldHuman, unholdHuman } from '../lib/outbox.mjs';
import { readFileSync } from 'node:fs';

const CASES = [
  // [名前, res, kind, err?]
  ['ok:true は done', { data: { ok: true } }, 'done'],
  ['401 は login（retry にしない）', { error: { status: 401, message: 'Unauthorized' } }, 'login'],
  ['PGRST301 は login', { error: { code: 'PGRST301', message: 'JWT expired' } }, 'login'],
  ['err mj_session は login（捨てる帯に倒さない）', { data: { ok: false, err: 'mj_session' } }, 'login', 'mj_session'],
  ['JWT expired の字だけでも login', { error: { message: 'JWT expired' } }, 'login'],
  ['返りが無い は retry', null, 'retry'],
  ['data が無い は retry', { data: null, error: null }, 'retry'],
  ['data に ok が無い は retry', { data: { foo: 1 } }, 'retry'],
  ['網の失敗 は retry', { error: { message: 'Failed to fetch' } }, 'retry'],
  ['55P03 は retry', { error: { code: '55P03', message: 'lock not available' } }, 'retry', '55P03'],
  ['40P01 は retry', { error: { code: '40P01', message: 'deadlock detected' } }, 'retry', '40P01'],
  ['busy（what 無し）は retry', { data: { ok: false, err: 'busy' } }, 'retry', 'busy'],
  // P6g §1（p6g_sadame v1.1）：分の窓と lock だけ retry・1日の窓と知らない名は stop
  ...['write:rn1m', 'write:u1m', 'write:ur1m', 'lock', 'user_min'].map((w) => ['P6g busy ' + w + ' は retry', { data: { ok: false, err: 'busy', what: w } }, 'retry', 'busy']),
  ...['write:un1d', 'write:uk1d', 'write:u1d', 'write:rk1d', 'write:rn1d', 'write:all1d', 'write:all1m', 'write:zz1m', 'secret', 'name', 'user_day', 'solo_day'].map((w) => ['P6g busy ' + w + ' は stop', { data: { ok: false, err: 'busy', what: w } }, 'stop', 'busy']),
  ['conflict は conflict', { data: { ok: false, err: 'conflict', i: 0 } }, 'conflict'],
  ['E2 conflict の at（open・new）は振り分けに残す', { data: { ok: false, err: 'conflict', at: { what: 'open', hanchan_id: 'h1' } } }, 'conflict'],
  ['gone は reload', { data: { ok: false, err: 'gone' } }, 'reload'],
  ['mj_reauth は login（err は mj_reauth のまま＝mj_session と分ける）', { data: { ok: false, err: 'mj_reauth', within_min: 10, i: 0 } }, 'login', 'mj_reauth'],
  ...['bad', 'range', 'not_yet', 'full', 'too_many', 'internal', 'mj_op_other_user', 'mj_role'].map((e) => [e + ' は stop', { data: { ok: false, err: e } }, 'stop', e]),
  ['知らない err は stop', { data: { ok: false, err: 'zzz' } }, 'stop', 'zzz'],
  ['err が無い ok:false は stop', { data: { ok: false } }, 'stop'],
];

function run(step, drop = dropHead) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  for (const [name, res, kind, err] of CASES) {
    const r = step(res);
    ok(name, r.kind === kind && (err === undefined || r.err === err), JSON.stringify(r));
  }
  const cf = step({ data: { ok: false, err: 'conflict', i: 0, at: { what: 'new', hanchan_id: 'h7' } } });
  ok('E2 §6 conflict は at を添える（画面が open・new の回を開く）', cf.kind === 'conflict' && JSON.stringify(cf.at) === JSON.stringify({ what: 'new', hanchan_id: 'h7' }), JSON.stringify(cf));
  const cf0 = step({ data: { ok: false, err: 'conflict', i: 0 } });
  ok('E2 at の無い conflict は at の鍵を付けない', cf0.kind === 'conflict' && !('at' in cf0), JSON.stringify(cf0));
  const d = step({ data: { ok: false, err: 'dup', member_id: 'm9', name: '山田' } });
  ok('dup は stop で member_id を添える', d.kind === 'stop' && d.err === 'dup' && d.member_id === 'm9', JSON.stringify(d));
  const l = step({ data: { ok: false, err: 'linked', i: 0, member_id: 'm8' } });
  ok('linked は stop で member_id を添える（2c-2b）', l.kind === 'stop' && l.err === 'linked' && l.member_id === 'm8', JSON.stringify(l));
  const se = step({ data: { ok: false, err: 'settled', i: 0, table_id: 't3', session_id: 's2' } });
  ok('settled は stop で known・table_id と session_id を添える（L A25・締めたリーグの日の卓）', se.kind === 'stop' && se.err === 'settled' && se.known === true && se.table_id === 't3' && se.session_id === 's2', JSON.stringify(se));
  const lf = step({ data: { ok: false, err: 'left', i: 0, member_id: 'm7' } });
  ok('left は stop で member_id を添える（C2-3・出た人の名は直せない）', lf.kind === 'stop' && lf.err === 'left' && lf.member_id === 'm7', JSON.stringify(lf));
  const m = step({ data: { ok: false, err: 'mj_role', i: 0, need: 'kan' } });
  ok('mj_role は名の在る stop（known）', m.kind === 'stop' && m.known === true, JSON.stringify(m));
  // ── 2d（2d_sadame.md v2.1 §3）──
  const c = step({ data: { ok: false, err: 'bad', at: 'closed', i: 0 } });
  ok('2d bad かつ at closed は closed（at を添える）', c.kind === 'closed' && c.err === 'bad' && c.at === 'closed', JSON.stringify(c));
  const b0 = step({ data: { ok: false, err: 'bad' } });
  ok('2d at の無い bad は stop のまま', b0.kind === 'stop' && b0.err === 'bad' && b0.at === undefined, JSON.stringify(b0));
  const bk = step({ data: { ok: false, err: 'bad', at: 'kind', i: 2 } });
  ok('2d bad at kind は stop で at を残す', bk.kind === 'stop' && bk.at === 'kind', JSON.stringify(bk));
  const rg = step({ data: { ok: false, err: 'range', at: 'value', what: 'cell', i: 1 } });
  ok('2d range は stop で at と what を残す', rg.kind === 'stop' && rg.err === 'range' && rg.at === 'value' && rg.what === 'cell', JSON.stringify(rg));
  const dw = step({ data: { ok: false, err: 'dup', what: 'session', session_id: 's1' } });
  ok('2d dup session は stop で what を残す', dw.kind === 'stop' && dw.err === 'dup' && dw.what === 'session', JSON.stringify(dw));
  const f1 = step({ data: null, error: { message: 'permission denied for function mj_write', code: '42501' }, status: 403 });
  ok('2d 403（返しの status）は stop server（回し続けない）', f1.kind === 'stop' && f1.err === 'server' && f1.status === 403, JSON.stringify(f1));
  const f2 = step({ error: { message: 'Forbidden', status: 403 } });
  ok('2d 403（error の status）は stop server', f2.kind === 'stop' && f2.err === 'server', JSON.stringify(f2));
  const f3 = step({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 });
  ok('2d 401 は 403 より先に login', f3.kind === 'login', JSON.stringify(f3));
  const f4 = step({ data: null, error: { message: 'upstream' }, status: 503 });
  ok('2d 503 は retry のまま', f4.kind === 'retry', JSON.stringify(f4));
  const hc = [{ op_id: 'a', ops: [1], held: { err: 'closed' } }, { op_id: 'b', ops: [2] }];
  const hd = drop(hc);
  ok('2d 先頭が held closed なら［捨てる］でも外さない', hd.length === 2 && hd[0].op_id === 'a' && hd[0].held.err === 'closed' && !hd[1].held_after_drop, JSON.stringify(hd));
  // P10 §4（S2）：human＝人の確かめ待ち。捨てない・［捨てる］で外さない・確かめの後に外して送る
  const hu = step({ data: { ok: false, err: 'human' } });
  ok('P10 human は human（stop・retry に倒さない）', hu.kind === 'human' && hu.err === 'human', JSON.stringify(hu));
  const hh = [{ op_id: 'a', sent_at: 't', ops: [1], held: { err: 'human' } }, { op_id: 'b', ops: [2] }];
  const hhd = drop(hh);
  ok('P10 先頭が held human なら［捨てる］でも外さない', hhd.length === 2 && hhd[0].op_id === 'a' && hhd[0].held.err === 'human' && !hhd[1].held_after_drop, JSON.stringify(hhd));
  ok('P10 held human の間は送らない', !canSend(hh) && heldInfo(hh).why === 'human');
  const uh = unholdHuman(hh);
  ok('P10 unholdHuman は先頭の held human だけ外す（op_id・sent_at はそのまま）', uh[0].op_id === 'a' && uh[0].sent_at === 't' && !uh[0].held && canSend(uh) && uh.length === 2);
  const ubz = [{ op_id: 'a', held: { err: 'busy', what: 'write:u1d' } }];
  ok('P10 human でない held は unholdHuman で外さない', unholdHuman(ubz) === ubz && !heldHuman(ubz) && heldHuman(hh));
  ok('2d heldClosed は held closed の先頭だけ真', heldClosed(hc) && !heldClosed([{ op_id: 'a', held: { err: 'range' } }]) && !heldClosed([]) && !heldClosed([{ op_id: 'a' }]));
  // P6g §3（v1.1 止め1）：busy の［捨てる］は次の組へ held を移す（後ろを黙って送らない）
  const bw = step({ data: { ok: false, err: 'busy', what: 'write:un1d' } });
  ok('P6g busy の stop は what を返す', bw.what === 'write:un1d', JSON.stringify(bw));
  const hb = drop([{ op_id: 'a', sent_at: 'x', held: { err: 'busy', what: 'write:un1d' } }, { op_id: 'b' }, { op_id: 'c' }]);
  ok('P6g held busy の［捨てる］は次の組に held busy を移す', hb.length === 2 && hb[0].op_id === 'b' && hb[0].held && hb[0].held.err === 'busy' && hb[0].held.what === 'write:un1d' && !hb[1].held && !canSend(hb) && heldInfo(hb).why === 'busy', JSON.stringify(hb));
  const hb1 = drop([{ op_id: 'a', held: { err: 'busy', what: 'write:u1d' } }]);
  ok('P6g held busy が1組なら［捨てる］で空', hb1.length === 0, JSON.stringify(hb1));
  const hr = drop([{ op_id: 'a', held: { err: 'stale' } }, { op_id: 'b' }]);
  ok('2d held stale は［捨てる］で外せる', hr.length === 1 && hr[0].op_id === 'b' && hr[0].held_after_drop === true, JSON.stringify(hr));
  return { p, f };
}

const self = process.argv.includes('--self-test');
if (!self) {
  console.log('■ 振り分け');
  const r = run(outboxStep);
  let p = r.p, f = r.f;
  const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  console.log('  （' + r.p + ' 件の振り分けが合った）');
  console.log('■ 待ち');
  ok('1回目 2秒', retryDelay(0) === 2000);
  ok('2回目 4秒', retryDelay(1) === 4000);
  ok('伸びても 60秒で止まる', retryDelay(5) === 60000 && retryDelay(99) === 60000);
  console.log('■ 止めた並び（held は保存される形）');
  const ob = [{ op_id: 'a', ops: [1] }, { op_id: 'b', ops: [2] }, { op_id: 'c', ops: [3] }];
  ok('止める前は送ってよい', canSend(ob) && heldInfo(ob) === null);
  const h = holdHead(ob, 'range');
  ok('先頭に held が付く・後ろは触らない', h[0].held.err === 'range' && !h[1].held && h.length === 3);
  ok('held の間は送らない', !canSend(h) && heldInfo(h).why === 'range' && heldInfo(h).n === 3);
  ok('JSON にしても held が残る（読み込み直しで消えない）', JSON.parse(JSON.stringify(h))[0].held.err === 'range');
  ok('元の並びは書き換えない', !ob[0].held);
  const dr = dropHead(h);
  ok('捨てる＝先頭の1件だけ外す', dr.length === 2 && dr[0].op_id === 'b');
  ok('捨てた後も読み直しまで送らない（held_after_drop）', !canSend(dr) && dr.every((x) => x.held_after_drop) && heldInfo(dr).why === 'after_drop');
  ok('空の並びは送らない', !canSend([]) && heldInfo([]) === null);
  console.log('■ P6g ［もう一度送る］・書きの門（p6g_sadame v1.1 §3・§4）');
  const ub = unholdBusy([{ op_id: 'a', sent_at: 't', held: { err: 'busy', what: 'write:un1d' } }, { op_id: 'b' }]);
  ok('［もう一度送る］は先頭の held busy だけ外す（op_id・sent_at はそのまま）', ub[0].op_id === 'a' && ub[0].sent_at === 't' && !ub[0].held && canSend(ub));
  const uc = [{ op_id: 'a', held: { err: 'conflict' } }];
  ok('busy でない held は［もう一度送る］で外さない', unholdBusy(uc) === uc);
  ok('heldAny は並びのどこかの held で真・held_after_drop では偽', heldAny([{ op_id: 'a' }, { op_id: 'b', held: { err: 'range' } }]) && !heldAny([{ op_id: 'a', held_after_drop: true }]) && !heldAny([]));
  console.log('■ P6g 照合（schema の busy の名が retry か stop のどちらか1つだけ）');
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = (name) => { const i = sql.lastIndexOf('create or replace function ' + name + '('); if (i < 0) return ''; const j = sql.indexOf('$fn$;', sql.indexOf('$fn$', i) + 4); return sql.slice(i, j); };
  const over = body('mahjong_private.mj_w_over');
  const names = new Set([...over.matchAll(/\('(write:[a-z0-9]+)'/g)].map((m) => m[1]));
  for (const f of ['public.mj_write', 'mahjong_private.mj_w_op']) for (const m of body(f).matchAll(/'err', 'busy'[^)]*?'what', '([^']+)'/g)) names.add(m[1]);
  ok('照合で拾った名がある（mj_w_over・mj_write・mj_w_op）', names.size >= 8 && names.has('lock'), [...names].join(','));
  for (const n of names) ok('照合 ' + n + ' は1つだけに在る', BUSY_RETRY.has(n) !== BUSY_STOP.has(n), n);
  ok('照合 BUSY_RETRY と BUSY_STOP は重ならない', [...BUSY_RETRY].every((n) => !BUSY_STOP.has(n)));
  console.log('■ 2c-2f 合図（2c2f_sadame v1.2 §2）');
  ok('ok と read_ver（数）なら送る v', aizuSendV({ ok: true, read_ver: 7 }) === 7 && aizuSendV({ ok: true, read_ver: 0 }) === 0);
  ok('ok でない返しは送らない', aizuSendV({ ok: false, err: 'conflict', read_ver: 7 }) === null && aizuSendV(null) === null && aizuSendV(undefined) === null && aizuSendV('x') === null);
  ok('read_ver が数でない時は送らない', aizuSendV({ ok: true }) === null && aizuSendV({ ok: true, read_ver: '7' }) === null && aizuSendV({ ok: true, read_ver: NaN }) === null && aizuSendV({ ok: true, read_ver: null }) === null);
  ok('since より大きい v は読む', aizuReadV({ v: 8 }, 7) === 8 && aizuReadV({ v: 1 }, null) === 1);
  ok('since 以下の v は読まない', aizuReadV({ v: 7 }, 7) === null && aizuReadV({ v: 3 }, 7) === null);
  ok('v が数でない合図は読まない', aizuReadV({ v: '9' }, 7) === null && aizuReadV({}, 7) === null && aizuReadV(null, 7) === null && aizuReadV({ v: Infinity }, 7) === null);
  ok('読みの始めの間は 250ms', AIZU_GAP_MS === 250);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  // わざと壊した振り分けで赤になるか
  const wrap = (mut) => (res) => mut(res, outboxStep(res));
  const T = [
    ['login を見ずに retry にする（JWT 切れで回り続ける）', wrap((res, r) => (r.kind === 'login' ? { kind: 'retry', err: 'net' } : r))],
    ['mj_session を stop にする', wrap((res, r) => (r.err === 'mj_session' ? { kind: 'stop', err: 'mj_session' } : r))],
    ['busy を stop にする（捨てる帯に倒す）', wrap((res, r) => (r.err === 'busy' ? { kind: 'stop', err: 'busy' } : r))],
    ['P6g 1日の busy を retry にする（黙って送り直す）', wrap((res, r) => (r.err === 'busy' ? { kind: 'retry', err: 'busy' } : r))],
    ['P6g busy の what を落とす', wrap((res, r) => (r.err === 'busy' ? { ...r, what: undefined } : r))],
    ['P6g held busy の［捨てる］で後ろを held_after_drop にする（前の作り）', outboxStep, (ob) => (ob.length && ob[0].held && ob[0].held.err === 'closed' ? ob : ob.slice(1).map((it) => ({ ...it, held_after_drop: true })))],
    ['ok が無い返りを done にする', wrap((res, r) => (r.err === 'no_ok' ? { kind: 'done', err: null } : r))],
    ['gone を conflict にする', wrap((res, r) => (r.kind === 'reload' ? { kind: 'conflict', err: 'gone' } : r))],
    ['知らない err を done にする', wrap((res, r) => (r.err === 'zzz' ? { kind: 'done', err: null } : r))],
    ['dup の member_id を落とす', wrap((res, r) => (r.err === 'dup' ? { kind: 'stop', err: 'dup' } : r))],
    ['55P03 を stop にする', wrap((res, r) => (r.err === '55P03' ? { kind: 'stop', err: '55P03' } : r))],
    ['2d bad closed を stop にする（［捨てる］の帯に倒す）', wrap((res, r) => (r.kind === 'closed' ? { kind: 'stop', err: 'bad' } : r))],
    ['2d at の無い bad も closed にする', wrap((res, r) => (r.kind === 'stop' && r.err === 'bad' ? { kind: 'closed', err: 'bad', at: 'closed' } : r))],
    ['2d stop の at を落とす', wrap((res, r) => (r.kind === 'stop' ? { ...r, at: undefined } : r))],
    ['C2-3 left を stop にしない（retry で回し続ける）', wrap((res, r) => (r.err === 'left' ? { kind: 'retry', err: 'net' } : r))],
    ['C2-3 left の member_id を落とす', wrap((res, r) => (r.err === 'left' ? { ...r, member_id: undefined } : r))],
    ['L A25 settled を stop にしない（retry で回し続ける）', wrap((res, r) => (r.err === 'settled' ? { kind: 'retry', err: 'net' } : r))],
    ['L A25 settled の table_id を落とす', wrap((res, r) => (r.err === 'settled' ? { ...r, table_id: undefined } : r))],
    ['2d stop の what を落とす', wrap((res, r) => (r.kind === 'stop' ? { ...r, what: undefined } : r))],
    ['2d 403 を retry にする（回し続ける）', wrap((res, r) => (r.err === 'server' ? { kind: 'retry', err: 'net' } : r))],
    ['2d held closed も［捨てる］で外す', outboxStep, (ob) => ob.slice(1).map((it) => ({ ...it, held_after_drop: true }))],
    ['P10 human を stop にする（知らない err と同じ）', wrap((res, r) => (r.err === 'human' ? { kind: 'stop', err: 'human', known: false } : r))],
    ['P10 human を retry にする（網と同じ・永久に送り直す）', wrap((res, r) => (r.err === 'human' ? { kind: 'retry', err: 'net' } : r))],
    ['P10 held human も［捨てる］で外す', outboxStep, (ob) => (heldClosed(ob) ? ob : ob.slice(1).map((it) => ({ ...it, held_after_drop: true })))],
  ];
  let p = 0, f = 0;
  console.log('[outbox --self-test] 振り分けをわざと壊して赤になるか');
  if (run(outboxStep).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, step, drop] of T) { if (run(step, drop).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); } }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
