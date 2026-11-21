/* outbox.test.mjs — ★lib/outbox.mjs（未送信の並びの受け方）が取り決め §6-11・12・14・14' の通りに振り分けるか★（CI）
 * 使い方: node tests/outbox.test.mjs  /  node tests/outbox.test.mjs --self-test（振り分けをわざと壊して赤になるか）
 */
import { outboxStep, retryDelay, holdHead, dropHead, canSend, heldInfo } from '../lib/outbox.mjs';

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
  ['busy は retry', { data: { ok: false, err: 'busy' } }, 'retry', 'busy'],
  ['conflict は conflict', { data: { ok: false, err: 'conflict', i: 0 } }, 'conflict'],
  ['gone は reload', { data: { ok: false, err: 'gone' } }, 'reload'],
  ['mj_reauth は login（err は mj_reauth のまま＝mj_session と分ける）', { data: { ok: false, err: 'mj_reauth', within_min: 10, i: 0 } }, 'login', 'mj_reauth'],
  ...['bad', 'range', 'not_yet', 'full', 'too_many', 'internal', 'mj_op_other_user', 'mj_role'].map((e) => [e + ' は stop', { data: { ok: false, err: e } }, 'stop', e]),
  ['知らない err は stop', { data: { ok: false, err: 'zzz' } }, 'stop', 'zzz'],
  ['err が無い ok:false は stop', { data: { ok: false } }, 'stop'],
];

function run(step) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  for (const [name, res, kind, err] of CASES) {
    const r = step(res);
    ok(name, r.kind === kind && (err === undefined || r.err === err), JSON.stringify(r));
  }
  const d = step({ data: { ok: false, err: 'dup', member_id: 'm9', name: '山田' } });
  ok('dup は stop で member_id を添える', d.kind === 'stop' && d.err === 'dup' && d.member_id === 'm9', JSON.stringify(d));
  const l = step({ data: { ok: false, err: 'linked', i: 0, member_id: 'm8' } });
  ok('linked は stop で member_id を添える（2c-2b）', l.kind === 'stop' && l.err === 'linked' && l.member_id === 'm8', JSON.stringify(l));
  const m = step({ data: { ok: false, err: 'mj_role', i: 0, need: 'kan' } });
  ok('mj_role は名の在る stop（known）', m.kind === 'stop' && m.known === true, JSON.stringify(m));
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
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  // わざと壊した振り分けで赤になるか
  const wrap = (mut) => (res) => mut(res, outboxStep(res));
  const T = [
    ['login を見ずに retry にする（JWT 切れで回り続ける）', wrap((res, r) => (r.kind === 'login' ? { kind: 'retry', err: 'net' } : r))],
    ['mj_session を stop にする', wrap((res, r) => (r.err === 'mj_session' ? { kind: 'stop', err: 'mj_session' } : r))],
    ['busy を stop にする（捨てる帯に倒す）', wrap((res, r) => (r.err === 'busy' ? { kind: 'stop', err: 'busy' } : r))],
    ['ok が無い返りを done にする', wrap((res, r) => (r.err === 'no_ok' ? { kind: 'done', err: null } : r))],
    ['gone を conflict にする', wrap((res, r) => (r.kind === 'reload' ? { kind: 'conflict', err: 'gone' } : r))],
    ['知らない err を done にする', wrap((res, r) => (r.err === 'zzz' ? { kind: 'done', err: null } : r))],
    ['dup の member_id を落とす', wrap((res, r) => (r.err === 'dup' ? { kind: 'stop', err: 'dup' } : r))],
    ['55P03 を stop にする', wrap((res, r) => (r.err === '55P03' ? { kind: 'stop', err: '55P03' } : r))],
  ];
  let p = 0, f = 0;
  console.log('[outbox --self-test] 振り分けをわざと壊して赤になるか');
  if (run(outboxStep).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, step] of T) { if (run(step).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); } }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
