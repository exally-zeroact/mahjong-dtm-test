/* login2b.test.mjs — 2b「ログイン済みならログイン画面を出すな」（login2b_sadame v2 §1・§2）の期待値
 * js/gamen-core.mjs の authCheck・rpcRaw・rpc・currentUser・needLogin を、偽の supabase（refreshSession・getSession・rpc）で回す。
 * 部屋の送りの判じ（lib/outbox.mjs outboxStep）まで通して「電波＝retry／本当に切れた＝login／mj_reauth は引き直さない」を数える。
 * 使い方: node tests/login2b.test.mjs  /  node tests/login2b.test.mjs --self-test（core をわざと壊して赤になるか）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'js', 'gamen-core.mjs');
const { outboxStep } = await import(pathToFileURL(path.join(ROOT, 'lib', 'outbox.mjs')).href);
const J = JSON.stringify;

/* ── 偽の世界（1つの試しごとに作り直す） ── */
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
globalThis.SUPA = { url: 'http://fake.invalid', key: 'k' };
let W = null; // 今の試しの台
globalThis.supabase = { createClient: () => ({
  auth: {
    getSession: async () => { W.gets++; if (W.getHang) return new Promise(() => {}); return { data: { session: W.session }, error: null }; },
    refreshSession: async (arg) => {
      W.refresh++; W.refreshArgs.push(arg);
      await new Promise((r) => setTimeout(r, 5));
      const o = W.refreshPlan.shift() || 'net';
      if (o === 'ok' || o === 'other') {
        const user = { id: o === 'ok' ? 'u1' : 'u2' };
        W.token = 'a' + W.refresh; store.set('mj-auth', J({ access_token: W.token, refresh_token: 'r' + W.refresh, expires_at: 9e9, user }));
        return { data: { session: { access_token: W.token, user }, user }, error: null };
      }
      if (o === 'revoked') return { data: { session: null, user: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token' } };
      if (o === 'wipe') { store.delete('mj-auth'); return { data: { session: null, user: null }, error: { name: 'AuthApiError', status: 429, message: 'rate' } }; }
      if (o === 'busy429') return { data: { session: null, user: null }, error: { name: 'AuthApiError', status: 429, message: 'rate' } };
      if (o === 'throw') throw new Error('lock timeout');
      return { data: { session: null, user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } };
    },
    onAuthStateChange() {},
  },
  rpc: async (fn, args) => {
    W.calls.push({ fn, token: W.token });
    const o = W.rpcPlan.shift() || 'ok';
    if (typeof o === 'function') return o();
    if (o === 'ok') return { data: { ok: true }, error: null, status: 200 };
    if (o === '401') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 };
    if (o === 'anon401') return { data: null, error: { code: '42501', message: 'permission denied for function mj_read' }, status: 401 };
    if (o === '403') return { data: null, error: { code: '42501', message: 'permission denied' }, status: 403 };
    if (o === 'session') return { data: { ok: false, err: 'mj_session' }, error: null, status: 200 };
    if (o === 'reauth') return { data: { ok: false, err: 'mj_reauth', within_min: 10 }, error: null, status: 200 };
    if (o === 'neterr') throw new TypeError('Failed to fetch');
    return { data: { ok: true }, error: null, status: 200 };
  },
}) };
const fresh = (over = {}) => {
  store.clear();
  store.set('mj-auth', J({ access_token: 'a0', refresh_token: 'r0', expires_at: 1, user: { id: 'u1', email: 'u@example.invalid' } }));
  navigator.onLine = true;
  W = { gets: 0, refresh: 0, refreshArgs: [], refreshPlan: [], rpcPlan: [], calls: [], token: 'a0', session: { user: { id: 'u1' } }, getHang: false, ...over };
};
let seq = 0;
const load = async (file) => import(pathToFileURL(file).href + '?v=' + (++seq)); // 試しごとに新しい core（authP・okAt・sbClient を持ち越さない）

async function run(file, quiet, roomSrc) {
  let p = 0, f = 0;
  const ok = (name, c, info) => { if (c) p++; else { f++; if (!quiet) console.log('  ✗ ' + name + (info !== undefined ? '  ' + J(info) : '')); } };
  const T = async (name, fn) => { try { await fn(); } catch (e) { ok(name + ' 例外', false, String(e && e.message || e)); } };
  const step = (r) => outboxStep(r).kind;

  await T('R1', async () => { // 送りが 401（鍵切れ）→ 引き直し ok → 同じ呼びを1回やり直して done・引き直しは1回・2本目は新しい鍵
    fresh({ rpcPlan: ['401', 'ok'], refreshPlan: ['ok'] }); const C = await load(file);
    const r = await C.rpcRaw('mj_write', { p_op_id: 'op1' });
    ok('R1 done', step(r) === 'done', r); ok('R1 引き直し1回', W.refresh === 1, W.refresh);
    ok('R1 呼び2回・2本目は新しい鍵', W.calls.length === 2 && W.calls[1].token === 'a1', W.calls);
    ok('R1 引き直しは控えの refresh_token を渡す', W.refreshArgs[0] && W.refreshArgs[0].refresh_token === 'r0', W.refreshArgs);
  });
  await T('R2', async () => { // 倉庫の mj_session も同じ（関数の頭で返る＝書く前）
    fresh({ rpcPlan: ['session', 'ok'], refreshPlan: ['ok'] }); const C = await load(file);
    const r = await C.rpc('mj_account', {}); ok('R2 ok', r && r.ok === true, r); ok('R2 引き直し1回', W.refresh === 1);
  });
  await T('R3', async () => { // 引き直しても切れたまま（2本目も login）＝ログインの道・回し続けない・その後30秒の呼びは引き直さない
    fresh({ rpcPlan: ['session', 'session', 'session'], refreshPlan: ['ok', 'ok'] }); const C = await load(file);
    const r = await C.rpc('mj_account', {}); ok('R3 mj_session', r && r.err === 'mj_session', r);
    ok('R3 引き直し1回・呼び2回', W.refresh === 1 && W.calls.length === 2, [W.refresh, W.calls.length]);
    const r2 = await C.rpcRaw('mj_write', {}); ok('R3 次の呼び＝login（30秒の守り）', step(r2) === 'login', r2);
    ok('R3 守りの間は引き直さない', W.refresh === 1, W.refresh);
  });
  await T('R4', async () => { // 電波で引き直せない＝retry（ログインの帯にしない）。数えない＝次の送りでまた引き直す。3回目に通れば done
    fresh({ rpcPlan: ['401', '401', '401', 'ok'], refreshPlan: ['net', 'net', 'ok'] }); const C = await load(file);
    const k1 = step(await C.rpcRaw('mj_write', { p_op_id: 'op1' }));
    const k2 = step(await C.rpcRaw('mj_write', { p_op_id: 'op1' }));
    const k3 = step(await C.rpcRaw('mj_write', { p_op_id: 'op1' }));
    ok('R4 net→retry・net→retry・ok→done', J([k1, k2, k3]) === J(['retry', 'retry', 'done']), [k1, k2, k3]);
    ok('R4 引き直し3回', W.refresh === 3, W.refresh);
    const r = await C.rpc('mj_account', {}); ok('R4 通った後の rpc は ok', r && r.ok === true, r);
  });
  await T('R5', async () => { // rpc() の電波＝err net（ログインにしない）
    fresh({ rpcPlan: ['anon401'], refreshPlan: ['net'] }); const C = await load(file);
    const r = await C.rpc('mj_read', {}); ok('R5 net', r && r.err === 'net', r);
  });
  await T('R6', async () => { // 鍵が取り消された（400）＝本当に切れた＝ログイン（今まで通り）
    fresh({ rpcPlan: ['401', '401'], refreshPlan: ['revoked', 'revoked'] }); const C = await load(file);
    const r = await C.rpcRaw('mj_write', {}); ok('R6 login', step(r) === 'login', r);
    const r2 = await C.rpc('mj_account', {}); ok('R6 rpc mj_session', r2 && r2.err === 'mj_session', r2);
  });
  await T('R7', async () => { // 部品が控えを消した（期限切れの 429 等）＝out
    fresh({ rpcPlan: ['401'], refreshPlan: ['wipe'] }); const C = await load(file);
    ok('R7 login', step(await C.rpcRaw('mj_write', {})) === 'login');
  });
  await T('R8', async () => { // 混んでいる（429・控えは残る）・投げた（lock）＝net
    fresh({ rpcPlan: ['401', '401'], refreshPlan: ['busy429', 'throw'] }); const C = await load(file);
    const k1 = step(await C.rpcRaw('mj_write', {})); const k2 = step(await C.rpcRaw('mj_write', {}));
    ok('R8 retry・retry', k1 === 'retry' && k2 === 'retry', [k1, k2]);
  });
  await T('R9', async () => { // mj_reauth（パスワードの入れ直しの門）は引き直さない・そのまま返す
    fresh({ rpcPlan: ['reauth'], refreshPlan: ['ok'] }); const C = await load(file);
    const r = await C.rpcRaw('mj_write', {}); const s = outboxStep(r);
    ok('R9 login mj_reauth', s.kind === 'login' && s.err === 'mj_reauth', s); ok('R9 引き直し0', W.refresh === 0, W.refresh);
  });
  await T('R10', async () => { // 403（権限の外）は引き直さない（今まで通り）
    fresh({ rpcPlan: ['403'], refreshPlan: ['ok'] }); const C = await load(file);
    const r = await C.rpc('mj_read', {}); ok('R10 mj_session', r && r.err === 'mj_session', r); ok('R10 引き直し0', W.refresh === 0);
  });
  await T('R11', async () => { // 2本が同時に 401＝引き直しは1回（同じ答えを待つ）・両方やり直して done
    fresh({ rpcPlan: ['401', '401', 'ok', 'ok'], refreshPlan: ['ok', 'ok'] }); const C = await load(file);
    const [a, b] = await Promise.all([C.rpcRaw('mj_write', { p_op_id: 'x' }), C.rpcRaw('mj_write', { p_op_id: 'y' })]);
    ok('R11 両方 done', step(a) === 'done' && step(b) === 'done', [a, b]); ok('R11 引き直し1回', W.refresh === 1, W.refresh);
  });
  await T('R12', async () => { // 網が切れている＝引き直しに行かず net
    fresh({ rpcPlan: ['401'], refreshPlan: ['ok'] }); const C = await load(file); navigator.onLine = false;
    const k = step(await C.rpcRaw('mj_write', {})); ok('R12 retry', k === 'retry', k); ok('R12 引き直し0', W.refresh === 0);
  });
  await T('R13', async () => { // 呼びが投げた（電波）＝そのまま電波・引き直さない
    fresh({ rpcPlan: ['neterr'] }); const C = await load(file);
    const k = step(await C.rpcRaw('mj_write', {})); ok('R13 retry', k === 'retry', k); ok('R13 引き直し0', W.refresh === 0);
  });
  await T('U1', async () => { // getSession に人＝その人（引き直さない）
    fresh(); const C = await load(file);
    const u = await C.currentUser(); ok('U1 u1', u && u.id === 'u1', u); ok('U1 引き直し0', W.refresh === 0);
  });
  await T('U2', async () => { // getSession が null（電波で引き直せなかった）でも控えが在る＝控えの同じ人（ログインを出さない）
    fresh({ session: null, refreshPlan: ['net'] }); const C = await load(file);
    const u = await C.currentUser(); ok('U2 控えの u1', u && u.id === 'u1', u);
    let out = 0, got = null; await C.needLogin((x) => { got = x; }, () => { out++; });
    ok('U2 needLogin は onUser・onOut なし', got && got.id === 'u1' && out === 0, [got, out]);
  });
  await T('U3', async () => { // 控えが無い＝null（引き直しに行かない）・needLogin は onOut を呼ぶ
    fresh({ session: null }); store.clear(); const C = await load(file);
    const u = await C.currentUser(); ok('U3 null', u === null, u); ok('U3 引き直し0', W.refresh === 0);
    globalThis.ExallyLogin = { mount: () => ({ show() { W.shown = (W.shown || 0) + 1; } }) };
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' }); globalThis.document = { documentElement: {} };
    let out = 0; await C.needLogin(() => {}, () => { out++; }); ok('U3 onOut 1・ログインの箱', out === 1 && W.shown === 1, [out, W.shown]);
  });
  await T('U4', async () => { // getSession が null・引き直しも取り消し＝null
    fresh({ session: null, refreshPlan: ['revoked'] }); const C = await load(file);
    ok('U4 null', (await C.currentUser()) === null);
  });
  await T('U5', async () => { // 控えの人が匿名＝null
    fresh({ session: null, refreshPlan: ['ok'] }); store.set('mj-auth', J({ access_token: 'a0', refresh_token: 'r0', expires_at: 1, user: { id: 'u9', is_anonymous: true } }));
    const C = await load(file); ok('U5 null', (await C.currentUser()) === null);
  });
  await T('U6', async () => { // getSession が長引く（部品の引き直しが電波で30秒やり直す）＝5秒で控えの同じ人
    fresh({ getHang: true }); const C = await load(file);
    const t = Date.now(); const u = await C.currentUser();
    ok('U6 控えの u1', u && u.id === 'u1', u); ok('U6 6秒より前', Date.now() - t < 6000, Date.now() - t);
  });
  // S1 部屋の倉庫の呼び（読み・送り・直送り）は全部 rpcRaw＝sb().rpc を直に呼ぶ所が1つでも残るとそこだけ鍵を引き直さない（8b の［名簿を直す］で1か所落ちた）
  const rs = roomSrc ?? fs.readFileSync(path.join(ROOT, 'js', 'gamen-room.mjs'), 'utf8');
  const raw = (rs.match(/sb\(\)\.rpc\(/g) || []).length, viaRaw = (rs.match(/rpcRaw\('mj_/g) || []).length;
  ok('S1 部屋は sb().rpc を直に呼ばない', raw === 0, raw); ok('S1 部屋の rpcRaw は7か所以上', viaRaw >= 7, viaRaw);
  return { p, f };
}

const self = process.argv.includes('--self-test');
if (!self) {
  console.log('■ 2b ログイン（js/gamen-core.mjs authCheck・rpcRaw・currentUser／login2b_sadame v2）');
  const { p, f } = await run(CORE, false);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  const src = fs.readFileSync(CORE, 'utf8').replace(/\r\n/g, '\n');
  const MUT = [
    ['引き直した後にやり直さない', "  if (a.kind === 'ok') return await call();\n", ''],
    ['やり直しを2回（2本目の login でも引き直す）', '  if (okAt && t0 - okAt < GUARD_MS) return r;', '  if (false) return r;'],
    ['電波をログインにする', "  if (a.kind === 'net') return NET_RES();\n", ''],
    ['mj_session で引き直さない', "  return !!(r.data && typeof r.data === 'object' && r.data.ok === false && r.data.err === 'mj_session');", '  return false;'],
    ['mj_reauth も引き直す', "r.data.err === 'mj_session');", "(r.data.err === 'mj_session' || r.data.err === 'mj_reauth'));"],
    ['403 も引き直す', '    if (st === 401) return true;', '    if (st === 401 || st === 403) return true;'],
    ['1本だけにしない（同時の呼びが2回引き直す）', '  if (authP) return authP;\n', ''],
    ['429 等をログインにする', "    return { kind: 'net', user: su }; // つながらない", "    return { kind: 'out' }; // つながらない"],
    ['控えが消えても net', "    if (!storedAuth()) return { kind: 'out' }; // 倉庫の部品が控えを消した", '    if (false) return { kind: \'out\' }; //'],
    ['取り消し（400）を net', '    if (e.name === \'AuthApiError\' && (e.status === 400', '    if (false && (e.status === 400'],
    ['currentUser が控えを見ない（今までの形）', '  if (!storedAuth()) return null;\n  const a = await authCheck();\n  return a.kind === \'out\' ? null : a.user;', '  return null;'],
    ['currentUser が5秒で先に進まない', '  if (s === late) return realUser(s0.user);', '  if (s === late) return null;'],
    ['needLogin が onOut を呼ばない', '  if (onOut) onOut();\n', ''],
    ['控えの refresh_token を渡さない', 'refreshSession({ refresh_token: s0.refresh_token })', 'refreshSession()'],
    ['網が無くても引き直しに行く', "    if (isOffline()) return { kind: 'net', user: su };\n", ''],
    ['匿名の控えも人にする', "const realUser = (u) => (u && typeof u.id === 'string' && !u.is_anonymous ? u : null);", "const realUser = (u) => (u && typeof u.id === 'string' ? u : null);"],
  ];
  let p = 0, f = 0;
  console.log('[login2b --self-test] core をわざと壊して赤になるか');
  if ((await run(CORE, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of MUT) {
    if (!src.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が core に無い'); continue; }
    const tmp = path.join(path.dirname(CORE), '.core.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, src.replace(from, to));
    try {
      if ((await run(tmp, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } finally { fs.unlinkSync(tmp); }
  }
  { // 部屋の送りを1か所 sb().rpc に戻す
    const rs = fs.readFileSync(path.join(ROOT, 'js', 'gamen-room.mjs'), 'utf8'), a = "rpcRaw('mj_write'";
    if (!rs.includes(a)) { f++; console.log('  ✗ 部屋の送りを sb().rpc に戻す — 壊す所が無い'); }
    else if ((await run(CORE, true, rs.replace(a, "sb().rpc('mj_write'"))).f) { p++; console.log('  ✓ 部屋の送りを sb().rpc に戻す'); } else { f++; console.log('  ✗ 部屋の送りを sb().rpc に戻す — 赤にならなかった'); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
