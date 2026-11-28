// 2b 画面の試験（login2b_sadame v2 §4＝ログイン済みならログインの画面を出さない）。node gamen_2b-e2e.cjs <作業木> [--chromium|--self] [ONLY=T1,T2]
// 本物の js/gamen-core.mjs・本物の vendor/supabase-js を使い、倉庫の向き先（supa-config）だけを自分の http の偽の auth/rest へ向ける。
// ★外へ出る呼びは全部止めて数える（0 でなければ赤・O5）★＝本物の倉庫には1本も届かない。
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test', process.cwd()] }));
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self'), CR = process.argv.includes('--chromium');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const U = { id: '00000000-0000-4000-8000-0000000002b1', aud: 'authenticated', role: 'authenticated', email: 't2b@example.invalid', is_anonymous: false, app_metadata: {}, user_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (name, exp) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: U.id, exp, role: 'authenticated', aud: 'authenticated', jti: name, session_id: 's2b' }) + '.c2ln';
const nowS = () => Math.floor(Date.now() / 1000);

// ── 偽の倉庫（1件ごとに fresh() で作り直す） ──
let S = null, R4 = null;
function fresh(o = {}) {
  S = { refresh: o.refresh || 'ok', refreshHits: 0, n: 0, valid: new Set(), plan: o.plan || {}, body: o.body || {}, calls: [], ext: [] };
  return S;
}
function session(name, rt, expS) { return { access_token: jwt(name, expS), token_type: 'bearer', expires_in: 3600, expires_at: expS, refresh_token: rt, user: U }; }
function defBody(fn, args) {
  if (S.body[fn]) return typeof S.body[fn] === 'function' ? S.body[fn](args) : S.body[fn];
  if (fn === 'mj_my_rooms') return { ok: true, rooms: [] };
  if (fn === 'mj_read') return { ok: true, same: true };
  return { ok: true };
}
function sbApi(q, r, u, body) {
  const send = (st, o, raw) => { r.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); r.end(raw !== undefined ? raw : JSON.stringify(o)); };
  if (u.pathname === '/auth/v1/token' && u.query.grant_type === 'refresh_token') {
    S.refreshHits++;
    if (S.refresh === 'net') return send(503, null, 'unavailable');
    if (S.refresh === 'bad') return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    const k = ++S.n, s = session('at' + k, 'rt' + k, nowS() + 3600);
    S.valid.add(s.access_token);
    return send(200, s);
  }
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
  if (m) {
    const fn = m[1]; let args = {};
    try { args = JSON.parse(body || '{}'); } catch { /* 空 */ }
    const tok = String(q.headers.authorization || '').replace(/^Bearer /, '');
    const c = { fn, args, valid: S.valid.has(tok), st: 0 }; S.calls.push(c);
    const p = S.plan[fn];
    if (p && p.length) { const x = p.shift(); c.st = x.status; return send(x.status, x.body); }
    if (!c.valid) { c.st = 401; return send(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }); }
    c.st = 200; return send(200, defBody(fn, args));
  }
  return send(404, { message: 'no fake ' + u.pathname });
}

const SEED = `<!doctype html><meta charset="utf-8"><title>seed</title>`;
// 部屋の頁だけの台（本物の core・vendor・supa-config＝偽の倉庫へ）。並びに1組（m5 を足す）を積んでから開く
const ROOM = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css">
<script src="/js/supa-config.js"></script><script src="/vendor/supabase-2.112.4.js"></script><script src="/js/exally-login.js"></script>
<div id="bar"></div><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const uid = '${U.id}', R = defaultRules(4);
const st = emptyState(); st.rules = R;
const add = { op_id: 'op-2b-1', ops: [{ op: 'member_add', member_id: 'm5', name: '田中' }] };
const r = applyOps(st, [{ op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' }, ...add.ops], { roomRules: R, now: '2026-11-28T00:00:00Z' });
if (!r.ok) document.body.dataset.err = JSON.stringify(r.res);
localStorage.setItem('mj-room:' + uid + ':r1', JSON.stringify(r.state));
localStorage.setItem('mj-outbox:' + uid + ':r1', JSON.stringify([add]));
localStorage.setItem('mj-synced:' + uid + ':r1', '1');
mountRoom(document.getElementById('app'), { me: { id: uid }, room: { room_id: 'r1', rules: R, kind: 'shared', name: '卓' }, showShare: null, bar(b) { document.getElementById('bar').textContent = b.title; }, relogin() {}, page: 'room' });
document.body.dataset.ready = '1';
</script>`;
// ログインの箱・重ね（#loginOv.open）・部屋の赤い帯（#rLogin）が一瞬でも出たかを最初の描きから数える
const SEEN = `(() => { const w = window; w.__seen = { ov: 0, vl: 0, rl: 0 };
  const chk = () => { const o = document.getElementById('loginOv'); if (o && o.classList.contains('open')) w.__seen.ov++;
    const v = document.getElementById('vLogin'); if (v && !v.hidden) w.__seen.vl++; if (document.getElementById('rLogin')) w.__seen.rl++; };
  new MutationObserver(chk).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('DOMContentLoaded', chk); })();`;

let mutate = null, PORT = 0;
const srv = http.createServer((q, r) => {
  let body = '';
  q.on('data', (d) => { body += d; });
  q.on('end', () => {
    const u = url.parse(q.url, true), p = decodeURIComponent(u.pathname);
    if (p.startsWith('/auth/v1/') || p.startsWith('/rest/v1/')) return sbApi(q, r, u, body);
    if (q.method === 'OPTIONS') { r.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); r.end(); return; }
    const html = (s) => { r.writeHead(200, { 'content-type': MT['.html'] }); r.end(s); };
    if (p === '/__seed.html') return html(SEED);
    if (p === '/__room.html') return html(ROOM);
    if (p === '/js/supa-config.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end(`window.SUPA = { url: 'http://127.0.0.1:${PORT}', key: 'fake-anon-key-2b', env: 'test' };`); return; }
    if (p === '/js/sw-reg.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end('/* 試験では端末の控えを使わない */'); return; }
    const f = path.join(ROOT, (p === '/' ? '/index.html' : p).replace(/^\/+/, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    let b = fs.readFileSync(f);
    const ext = path.extname(f);
    if (['.html', '.js', '.mjs', '.css'].includes(ext)) {
      b = b.toString('utf8').replace(/\r\n/g, '\n');
      if (mutate && f.endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
    }
    r.writeHead(200, { 'content-type': MT[ext] || 'application/octet-stream' }); r.end(b);
  });
});

async function run(br) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); if (SELF) throw new Error('赤 ' + name); } };
  const base = `http://127.0.0.1:${PORT}`;
  // 1件＝新しい ctx（端末の控えは空から）。stored＝'expired'｜'fresh'（at0 は効く）｜'stale'（at0 は効かないが期限は先）｜'soon'（200秒後に切れる）
  async function open(o) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route('**/*', (rt) => { const h = new URL(rt.request().url()).hostname; if (h === '127.0.0.1') return rt.continue(); S.ext.push(rt.request().url()); return rt.abort(); });
    await ctx.addInitScript(SEEN);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 15000 : 30000);
    if (o.clock) await pg.clock.install();
    await pg.goto(base + '/__seed.html');
    const exp = o.stored === 'expired' ? nowS() - 60 : o.stored === 'soon' ? nowS() + 200 : nowS() + 3600;
    const s = session('at0', 'rt0', exp);
    if (o.stored === 'fresh' || o.stored === 'soon') S.valid.add(s.access_token);
    await pg.evaluate((v) => { localStorage.clear(); localStorage.setItem('mj-auth', v); }, JSON.stringify(s));
    await pg.goto(base + o.page);
    return { ctx, pg };
  }
  const seen = (pg) => pg.evaluate(() => window.__seen);
  const until = async (pg, f, ms, step) => { // 時計を入れた頁は早送りしながら待つ（電波の失敗のやり直し・60秒の控え）
    const end = Date.now() + ms;
    for (;;) { if (await f()) return true; if (Date.now() > end) return false; if (step) await pg.clock.fastForward(step); await sleep(step ? 150 : 100); }
  };
  const calls = (fn, pred) => S.calls.filter((c) => c.fn === fn && (!pred || pred(c)));
  const outbox = (pg) => pg.evaluate((k) => localStorage.getItem(k), 'mj-outbox:' + U.id + ':r1');
  const want = (t) => !ONLY.length || ONLY.includes(t);
  let cur = null;
  try {
    // T1 鍵が切れている・引き直しは通る ⇒ どの頁もログインの箱・重ねを一度も出さず、新しい鍵で読む
    for (const pgName of ['/index.html', '/league.html', '/senseki.html', '/taikyoku.html']) {
      if (!want('T1')) break;
      fresh();
      cur = await open({ stored: 'expired', page: pgName }); const { pg } = cur;
      const got = await until(pg, async () => S.calls.some((c) => c.valid), 20000);
      await sleep(800);
      const sn = await seen(pg);
      ok('T1 ' + pgName + ' 新しい鍵で読んだ', got && S.refreshHits >= 1, { hits: S.refreshHits, calls: S.calls.map((c) => c.fn + ':' + c.st) });
      ok('T1 ' + pgName + ' 重ねもログインの箱も出ない', sn.ov === 0 && sn.vl === 0, sn);
      await cur.ctx.close(); cur = null;
    }
    // T2 部屋の書き（mj_write）が1回だけ 401 ⇒ 鍵を引き直して同じ op_id で1回送り直す・赤い帯なし
    if (want('T2')) {
      fresh({ plan: { mj_write: [{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }] } });
      cur = await open({ stored: 'fresh', page: '/__room.html' }); const { pg } = cur;
      const done = await until(pg, async () => (await outbox(pg)) === '[]', 20000);
      const w = calls('mj_write'), sn = await seen(pg);
      ok('T2 並びが空になった', done, await outbox(pg));
      ok('T2 書きは2回（401→引き直し→同じ op_id）', w.length === 2 && w.every((c) => c.args.p_op_id === 'op-2b-1') && w[1].valid, w.map((c) => [c.args.p_op_id, c.st]));
      ok('T2 引き直しは1回', S.refreshHits === 1, S.refreshHits);
      ok('T2 赤い帯なし', sn.rl === 0 && sn.ov === 0, sn);
      await cur.ctx.close(); cur = null;
    }
    // T2b ホームから部屋を開く（readRules）の mj_read が1回 401 ⇒ 引き直して開く・重ねなし
    if (want('T2b')) {
      fresh({ plan: { mj_read: [{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }] }, body: { mj_read: (a) => (a.p_args === null ? { ok: true, room: { rules: R4, name: '卓', kind: 'shared', owner: true, role: null }, read_ver: 1 } : { ok: true, same: true }) } });
      cur = await open({ stored: 'fresh', page: '/taikyoku.html?room=r1' }); const { pg } = cur;
      const opened = await until(pg, async () => !(await pg.$('#rReading')) && S.calls.filter((c) => c.fn === 'mj_read').length >= 2, 20000);
      const sn = await seen(pg);
      ok('T2b 部屋が開いた（ルールを読んだ後に部屋の読み）', opened, S.calls.map((c) => c.fn + ':' + c.st));
      ok('T2b 引き直しは1回・重ねなし', S.refreshHits === 1 && sn.ov === 0 && sn.vl === 0, { hits: S.refreshHits, sn });
      await cur.ctx.close(); cur = null;
    }
    // T3 引き直しが電波で通らない ⇒ 重ねなし・ホームは電波の帯。61秒後に［もう一度］で読める
    if (want('T3')) {
      fresh({ refresh: 'net' });
      cur = await open({ stored: 'expired', page: '/index.html', clock: true }); const { pg } = cur;
      const band = await until(pg, async () => (await pg.$eval('#hBand', (e) => !e.hidden).catch(() => false)) && S.refreshHits >= 1, 25000, 3000);
      let sn = await seen(pg);
      ok('T3 電波の帯が出た', band, { hits: S.refreshHits, calls: S.calls.map((c) => c.fn + ':' + c.st) });
      ok('T3 重ねなし', sn.ov === 0, sn);
      S.refresh = 'ok';
      await pg.clock.fastForward(61000);
      await pg.$eval('#hBandAgain', (e) => e.click()); // 鍵の自動の引き直しで帯が先に消えていても押せる
      const back = await until(pg, async () => (await pg.$eval('#hBand', (e) => e.hidden).catch(() => false)) && S.calls.some((c) => c.fn === 'mj_my_rooms' && c.valid), 20000, 1000);
      sn = await seen(pg);
      ok('T3 ［もう一度］で新しい鍵で読めて帯が消えた', back, S.calls.map((c) => c.fn + ':' + c.st));
      ok('T3 最後まで重ねなし', sn.ov === 0, sn);
      await cur.ctx.close(); cur = null;
    }
    // T4 鍵が取り消されている（400 invalid_grant）⇒ 今まで通りログインを出す（見張りが空振りしていない印も兼ねる）
    if (want('T4')) {
      fresh({ refresh: 'bad' });
      cur = await open({ stored: 'expired', page: '/taikyoku.html' }); const { pg } = cur;
      const shown = await until(pg, async () => (await seen(pg)).ov > 0, 20000);
      const sn = await seen(pg);
      ok('T4 ログインの重ねとログインの箱が出た', shown && sn.vl > 0, sn);
      await cur.ctx.close(); cur = null;
    }
    // T5 倉庫が mj_session を続けて返す ⇒ 引き直しは1回・読みは1本につき2回まで・ログインを出す
    if (want('T5')) {
      fresh({ body: { mj_my_rooms: { ok: false, err: 'mj_session' } } });
      cur = await open({ stored: 'fresh', page: '/index.html' }); const { pg } = cur;
      const shown = await until(pg, async () => (await seen(pg)).ov > 0, 20000);
      await sleep(1000);
      const op = calls('mj_my_rooms', (c) => c.args.p_open === true).length, dl = calls('mj_my_rooms', (c) => c.args.p_deleted === true).length;
      ok('T5 ログインの重ねが出た', shown, await seen(pg));
      ok('T5 引き直しは1回', S.refreshHits === 1, S.refreshHits);
      ok('T5 読みは1本につき2回（やり直しは1回だけ）', op === 2 && dl === 2, { op, dl });
      await cur.ctx.close(); cur = null;
    }
    // T6 部屋：mj_reauth は引き直さず今の字
    if (want('T6')) {
      fresh({ body: { mj_write: { ok: false, err: 'mj_reauth', within_min: 10 } } });
      cur = await open({ stored: 'fresh', page: '/__room.html' }); const { pg } = cur;
      const red = await until(pg, async () => !!(await pg.$('#rLogin')), 20000);
      ok('T6 mj_reauth＝引き直し0回・「ログインし直してから送ります。」', red && S.refreshHits === 0 && (await pg.textContent('#rLogin')).includes('ログインし直してから送ります。'), { hits: S.refreshHits });
      await cur.ctx.close(); cur = null;
      // T6 部屋：読みで1回引き直した後、書きが mj_session を続ける ⇒ 30秒の内なのでもう引き直さずに赤い帯
      fresh({ plan: { mj_read: [{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }] }, body: { mj_write: { ok: false, err: 'mj_session' } } });
      cur = await open({ stored: 'fresh', page: '/__room.html' });
      const red2 = await until(cur.pg, async () => !!(await cur.pg.$('#rLogin')), 20000);
      ok('T6 続く mj_session＝引き直しは読みの1回だけ・書きは1回・赤い帯', red2 && S.refreshHits === 1 && calls('mj_write').length === 1 && (await cur.pg.textContent('#rLogin')).includes('ログインが切れました'), { hits: S.refreshHits, w: calls('mj_write').length });
      await cur.ctx.close(); cur = null;
    }
    // T6n 部屋：鍵が効かず、引き直しが電波で3回以上通らない ⇒ 赤い帯を出さずに送り直し続け、通ったら同じ op_id で1回だけ入る
    if (want('T6n')) {
      fresh({ refresh: 'net' });
      cur = await open({ stored: 'stale', page: '/__room.html', clock: true }); const { pg } = cur;
      const tries = await until(pg, async () => S.calls.filter((c) => c.st === 401).length >= 3, 30000, 4000);
      ok('T6n 401 を3回以上受けた（電波の引き直しが続いた）', tries, S.calls.map((c) => c.fn + ':' + c.st));
      ok('T6n その間 赤い帯なし', (await seen(pg)).rl === 0, await seen(pg));
      S.refresh = 'ok';
      await pg.clock.fastForward(61000);
      const done = await until(pg, async () => (await outbox(pg)) === '[]', 30000, 4000);
      const good = calls('mj_write', (c) => c.st === 200);
      ok('T6n 通った後に並びが空・入ったのは1回・op_id は同じ', done && good.length === 1 && calls('mj_write').every((c) => c.args.p_op_id === 'op-2b-1'), calls('mj_write').map((c) => c.st));
      ok('T6n 最後まで赤い帯なし', (await seen(pg)).rl === 0, await seen(pg));
      await cur.ctx.close(); cur = null;
    }
    // T6b ホームの2本の読み（続き・消した）が同時に 401 ⇒ 引き直しは1回・両方読める
    if (want('T6b')) {
      fresh();
      cur = await open({ stored: 'stale', page: '/index.html' }); const { pg } = cur;
      const both = await until(pg, async () => calls('mj_my_rooms', (c) => c.valid && c.args.p_open === true).length >= 1 && calls('mj_my_rooms', (c) => c.valid && c.args.p_deleted === true).length >= 1, 20000);
      await sleep(800);
      ok('T6b 両方の読みが新しい鍵で通った', both, S.calls.map((c) => c.fn + ':' + c.st));
      ok('T6b 引き直しは1回・重ねなし', S.refreshHits === 1 && (await seen(pg)).ov === 0, { hits: S.refreshHits });
      await cur.ctx.close(); cur = null;
    }
    // T7 ホーム：同じ人の TOKEN_REFRESHED ⇒ カードを読み直さない
    if (want('T7')) {
      fresh();
      cur = await open({ stored: 'soon', page: '/index.html', clock: true }); const { pg } = cur;
      const first = await until(pg, async () => calls('mj_my_rooms', (c) => c.args.p_open === true).length >= 1, 20000);
      await sleep(1000);
      const n0 = calls('mj_my_rooms', (c) => c.args.p_open === true).length;
      await pg.clock.fastForward(120000);
      await until(pg, async () => S.refreshHits >= 1, 10000);
      await sleep(1500);
      const n1 = calls('mj_my_rooms', (c) => c.args.p_open === true).length;
      ok('T7 鍵の自動の引き直しが起きた（空振りでない）', first && S.refreshHits >= 1, { hits: S.refreshHits });
      ok('T7 同じ人の引き直しでカードを読み直さない', n0 === 1 && n1 === 1, { n0, n1 });
      await cur.ctx.close(); cur = null;
    }
    ok('外へ出た呼び 0', S.ext.length === 0, S.ext.slice(0, 5));
  } catch (e) { if (!SELF || !String(e.message).startsWith('赤 ')) bad.push('例外 ' + String(e.message).split('\n')[0]); fail++; }
  if (cur) await cur.ctx.close().catch(() => {});
  return { pass, fail, bad };
}

(async () => {
  R4 = (await import(url.pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href)).defaultRules(4);
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  PORT = srv.address().port;
  const br = await (CR ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br);
    console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`2b-e2e ${CR ? 'Chromium' : 'WebKit'}: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const C = 'js/gamen-core.mjs';
  const W = [
    ['引き直した後にやり直さない', C, "  if (a.kind === 'ok') return await call();", "  if (a.kind === 'ok') return r;"],
    ['やり直しを2回する', C, "  if (a.kind === 'ok') return await call();", "  if (a.kind === 'ok') { const r2 = await call(); return loginErr(r2) ? await call() : r2; }"],
    ['電波を切れたとする', C, "return { kind: 'net', user: su }; // つながらない", "return { kind: 'out' }; // つながらない"],
    ['リーグでログインの箱を先に出す', 'js/gamen-league.mjs', "needLogin(start, () => show('vLogin')).catch", "show('vLogin'); needLogin(start, () => show('vLogin')).catch"],
    ['対局でログインの箱を先に出す', 'js/gamen-taikyoku.mjs', "needLogin(start, () => show('vLogin')).catch", "show('vLogin'); needLogin(start, () => show('vLogin')).catch"],
    ['ホームが鍵の知らせのたびに描き直す', 'js/gamen-home.mjs', '  if (drawnId !== undefined && id === drawnId && !(readFell && id)) return;', '  if (false) return;'],
    ['mj_reauth でも引き直す', C, "r.data.ok === false && r.data.err === 'mj_session');", "r.data.ok === false && (r.data.err === 'mj_session' || r.data.err === 'mj_reauth'));"],
    ['30秒の守りを外す', C, '  if (okAt && t0 - okAt < GUARD_MS) return r;', ''],
    ['電波の引き直しを1回と数える', C, "  if (a.kind === 'net') return NET_RES();", "  if (a.kind === 'net') return r;"],
    ['引き直しを1本にまとめない', C, '  if (authP) return authP;', '  if (false) return authP;'],
    ['ルールの読みが引き直さない', 'js/gamen-room.mjs', "return await rpcRaw('mj_read', { p_room_id: rid, p_what: 'room', p_args: args });", "return await sb().rpc('mj_read', { p_room_id: rid, p_what: 'room', p_args: args });"],
    ['部屋の送りが引き直さない', 'js/gamen-room.mjs', "try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: head.op_id, p_ops: head.ops }); }", "try { res = await sb().rpc('mj_write', { p_room_id: rid, p_op_id: head.op_id, p_ops: head.ops }); }"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）' + (r.fail && r.bad[0] ? '  例: ' + r.bad[0] : ''));
    if (r.fail) red++;
  }
  console.log(`2b-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length && W.length ? 0 : 1);
})();
