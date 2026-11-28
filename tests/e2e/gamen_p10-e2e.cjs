// P10 画面の試験（p10_sadame_v1.md v1.1 §1・§4・§5「初めての書きで確かめが出て、op は1回だけ入る」）。node gamen_p10-e2e.cjs <作業木> [--chromium|--self]
// 偽の倉庫＝この中の http。Cloudflare の api.js は ctx.route で偽の turnstile に差し替える（外へは1本も出さない・数える）。
// ★WebKit は手元で回さない（CLAUDE.md 規則10）＝CI の脚で回す★
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test', process.cwd()] }));
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self'), CR = process.argv.includes('--chromium');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const U = { id: '00000000-0000-4000-8000-0000000010a1', aud: 'authenticated', role: 'authenticated', email: 'tp10@example.invalid', is_anonymous: false, app_metadata: {}, user_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (name, exp) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: U.id, exp, role: 'authenticated', aud: 'authenticated', jti: name, session_id: 'sp10' }) + '.sig';
const nowS = () => Math.floor(Date.now() / 1000);
const TS_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// ── 偽の倉庫（1件ごとに fresh() で作り直す） ──
// ts＝偽の turnstile の答え（'ok' token を返す｜'fail' error-callback）・hm＝mj-human の答え（'ok'｜'no'）
let S = null;
function fresh(o = {}) {
  S = { ts: o.ts || 'ok', hm: o.hm || 'ok', marked: false, n: 0, valid: new Set(), calls: [], human: [], tsLoads: 0, ext: [] };
  return S;
}
function session(name, rt, expS) { return { access_token: jwt(name, expS), token_type: 'bearer', expires_in: 3600, expires_at: expS, refresh_token: rt, user: U }; }
function sbApi(q, r, u, body) {
  const send = (st, o) => { r.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); r.end(JSON.stringify(o)); };
  const tok = String(q.headers.authorization || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/token' && u.query.grant_type === 'refresh_token') {
    const k = ++S.n, s = session('at' + k, 'rt' + k, nowS() + 3600);
    S.valid.add(s.access_token);
    return send(200, s);
  }
  if (u.pathname === '/functions/v1/mj-human') {
    let b = {}; try { b = JSON.parse(body || '{}'); } catch { /* 空 */ }
    const c = { token: b.token, valid: S.valid.has(tok), apikey: q.headers.apikey }; S.human.push(c);
    if (!c.valid) return send(401, { ok: false, reason: 'auth' });
    if (S.hm === 'ok' && typeof b.token === 'string' && b.token) { S.marked = true; return send(200, { ok: true }); }
    return send(200, { ok: false, reason: 'turnstile' });
  }
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
  if (m) {
    const fn = m[1]; let args = {};
    try { args = JSON.parse(body || '{}'); } catch { /* 空 */ }
    const c = { fn, args, valid: S.valid.has(tok), res: null }; S.calls.push(c);
    if (!c.valid) return send(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' });
    if (fn === 'mj_my_rooms') return send(200, c.res = { ok: true, rooms: [] });
    if (fn === 'mj_read') return send(200, c.res = { ok: true, same: true });
    if (fn === 'mj_write') return send(200, c.res = S.marked ? { ok: true } : { ok: false, err: 'human' });
    return send(200, c.res = { ok: true });
  }
  return send(404, { message: 'no fake ' + u.pathname });
}

const SEED = `<!doctype html><meta charset="utf-8"><title>seed</title>`;
// 部屋の頁だけの台（本物の core・human・vendor）。並びに1組（m5 を足す）を積んでから開く。?held=1＝その組が held human のまま残っている端末
const ROOM = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css">
<script src="/js/supa-config.js"></script><script src="/vendor/supabase-2.112.4.js"></script><script src="/js/exally-login.js"></script>
<div id="bar"></div><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const uid = '${U.id}', R = defaultRules(4);
const st = emptyState(); st.rules = R;
const add = { op_id: 'op-p10-1', ops: [{ op: 'member_add', member_id: 'm5', name: '田中' }] };
const r = applyOps(st, [{ op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' }, ...add.ops], { roomRules: R, now: '2026-11-28T00:00:00Z' });
if (!r.ok) document.body.dataset.err = JSON.stringify(r.res);
const held = new URLSearchParams(location.search).get('held') === '1';
const none = new URLSearchParams(location.search).get('none') === '1';
localStorage.setItem('mj-room:' + uid + ':r1', JSON.stringify(r.state));
localStorage.setItem('mj-outbox:' + uid + ':r1', JSON.stringify(none ? [] : [held ? { ...add, held: { err: 'human' } } : add]));
localStorage.setItem('mj-synced:' + uid + ':r1', '1');
mountRoom(document.getElementById('app'), { me: { id: uid }, room: { room_id: 'r1', rules: R, kind: 'shared', name: '卓' }, showShare: null, bar(b) { document.getElementById('bar').textContent = b.title; }, relogin() {}, page: 'room' });
document.body.dataset.ready = '1';
</script>`;
// 確かめの窓（#mjHuman）が一瞬でも出たかを数える
const SEEN = `(() => { const w = window; w.__seen = { hw: 0 };
  const chk = () => { if (document.getElementById('mjHuman')) w.__seen.hw++; };
  new MutationObserver(chk).observe(document, { subtree: true, childList: true }); })();`;
// 偽の turnstile（本物の api.js の explicit render と同じ呼び方）
const tsStub = (mode) => `window.turnstile = { render(el, o) { if (!el || o.action !== 'mj_human' || !o.sitekey) { setTimeout(() => o['error-callback'] && o['error-callback'](), 20); return 'w0'; }
  window.__tsN = (window.__tsN || 0) + 1; setTimeout(() => ${mode === 'ok' ? "o.callback('tok-' + window.__tsN)" : "o['error-callback']()"}, 300); return 'w' + window.__tsN; }, remove() {} };`;

let mutate = null, PORT = 0;
const srv = http.createServer((q, r) => {
  let body = '';
  q.on('data', (d) => { body += d; });
  q.on('end', () => {
    const u = url.parse(q.url, true), p = decodeURIComponent(u.pathname);
    if (q.method === 'OPTIONS') { r.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); r.end(); return; }
    if (p.startsWith('/auth/v1/') || p.startsWith('/rest/v1/') || p.startsWith('/functions/v1/')) return sbApi(q, r, u, body);
    const html = (s) => { r.writeHead(200, { 'content-type': MT['.html'] }); r.end(s); };
    if (p === '/__seed.html') return html(SEED);
    if (p === '/__room.html') return html(ROOM);
    if (p === '/js/supa-config.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end(`window.SUPA = { url: 'http://127.0.0.1:${PORT}', key: 'fake-anon-key-p10', env: 'test', turnstile: '1x00000000000000000000AA' };`); return; }
    if (p === '/js/sw-reg.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end('/* 試験では端末の控えを使わない */'); return; }
    const f = path.join(ROOT, (p === '/' ? '/index.html' : p).replace(/^\/+/, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    let b = fs.readFileSync(f);
    const ext = path.extname(f);
    if (['.html', '.js', '.mjs', '.css'].includes(ext)) {
      b = b.toString('utf8').replace(/\r\n/g, '\n');
      if (mutate && f.endsWith(mutate.file)) {
        const n = b.split(mutate.from).length - 1;
        if (n !== 1) { console.log('✗ 壊しの字が ' + n + ' か所（1つでない） ' + mutate.from); process.exit(2); } // 写した行に当たって空振りしない（c20 11-28 の教訓）
        b = b.replace(mutate.from, () => mutate.to);
      }
    }
    r.writeHead(200, { 'content-type': MT[ext] || 'application/octet-stream' }); r.end(b);
  });
});

async function run(br) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); if (SELF) throw new Error('赤 ' + name); } };
  const base = `http://127.0.0.1:${PORT}`;
  async function open(page) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route('**/*', (rt) => {
      const u = rt.request().url(), h = new URL(u).hostname;
      if (h === '127.0.0.1') return rt.continue();
      if (u === TS_URL) { S.tsLoads++; return rt.fulfill({ status: 200, contentType: 'text/javascript', body: tsStub(S.ts) }); }
      S.ext.push(u); return rt.abort();
    });
    await ctx.addInitScript(SEEN);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 15000 : 30000);
    await pg.goto(base + '/__seed.html');
    const s = session('at0', 'rt0', nowS() + 3600);
    S.valid.add(s.access_token);
    await pg.evaluate((v) => { localStorage.clear(); localStorage.setItem('mj-auth', v); }, JSON.stringify(s));
    await pg.goto(base + page);
    return { ctx, pg };
  }
  const until = async (f, ms) => { const end = Date.now() + ms; for (;;) { if (await f()) return true; if (Date.now() > end) return false; await sleep(100); } };
  const writes = () => S.calls.filter((c) => c.fn === 'mj_write');
  const outbox = async (pg) => JSON.parse((await pg.evaluate((k) => localStorage.getItem(k), 'mj-outbox:' + U.id + ':r1')) || '[]');
  const want = (t) => !ONLY.length || ONLY.includes(t);
  const band = (pg) => pg.evaluate(() => { const b = document.getElementById('rHeld'); return b ? { why: b.dataset.why || '', text: b.textContent, again: !!document.getElementById('rHuman'), drop: !!document.getElementById('rDrop') } : null; });
  let cur = null;
  try {
    // T1 初めての書き（並びの1組）⇒ 倉庫は human ⇒ 確かめの窓が1回出て、通れば同じ op_id で1回だけ入る
    if (want('T1')) {
      fresh();
      cur = await open('/__room.html'); const { pg } = cur;
      const done = await until(async () => (await outbox(pg)).length === 0, 20000);
      await sleep(500);
      const w = writes();
      ok('T1 並びが空になった（入った）', done, { calls: S.calls.map((c) => c.fn + ':' + JSON.stringify(c.res)) });
      ok('T1 書きは2回（human・ok）で同じ op_id', w.length === 2 && w.every((c) => c.args.p_op_id === 'op-p10-1') && w[0].res.err === 'human' && w[1].res.ok === true, w.map((c) => [c.args.p_op_id, c.res]));
      ok('T1 確かめの窓が出て、閉じた', (await pg.evaluate(() => window.__seen.hw)) > 0 && !(await pg.$('#mjHuman')));
      ok('T1 mj-human は1回・効く鍵・token・apikey', S.human.length === 1 && S.human[0].valid && S.human[0].token === 'tok-1' && S.human[0].apikey === 'fake-anon-key-p10', S.human);
      ok('T1 帯は無い', !(await band(pg)), await band(pg));
      await cur.ctx.close(); cur = null;
    }
    // T2 確かめが通らない（Cloudflare の error）⇒ 帯「確認できませんでした［もう一度］」・［捨てる］無し・点は並びに残る ⇒ ［もう一度］で通れば入る
    if (want('T2')) {
      fresh({ ts: 'fail' });
      cur = await open('/__room.html'); const { pg } = cur;
      const shown = await until(async () => !!(await band(pg)), 20000);
      const b = await band(pg), ob = await outbox(pg);
      ok('T2 帯は human・［もう一度］在り・［捨てる］無し', shown && b.why === 'human' && b.again && !b.drop && b.text.includes('確認できませんでした'), b);
      ok('T2 点は並びに残る（held human）', ob.length === 1 && ob[0].op_id === 'op-p10-1' && ob[0].held && ob[0].held.err === 'human', ob);
      ok('T2 mj-human は呼ばない（token が無い）', S.human.length === 0, S.human);
      S.ts = 'ok';
      await pg.click('#rHuman');
      const done = await until(async () => (await outbox(pg)).length === 0, 20000);
      await sleep(500);
      const w = writes();
      ok('T2 ［もう一度］で通って入った・同じ op_id・帯は消えた', done && w.length === 2 && w.every((c) => c.args.p_op_id === 'op-p10-1') && w[1].res.ok === true && !(await band(pg)), { w: w.map((c) => c.res), b: await band(pg) });
      await cur.ctx.close(); cur = null;
    }
    // T3 mj-human が ok:false（倉庫の印が付かない）⇒ 書き直さず帯（点は残る）
    if (want('T3')) {
      fresh({ hm: 'no' });
      cur = await open('/__room.html'); const { pg } = cur;
      const shown = await until(async () => !!(await band(pg)), 20000);
      await sleep(500);
      const b = await band(pg), ob = await outbox(pg);
      ok('T3 帯は human・点は残る・書きは1回だけ', shown && b.why === 'human' && !b.drop && ob.length === 1 && writes().length === 1 && S.human.length === 1, { b, n: writes().length, h: S.human.length });
      await cur.ctx.close(); cur = null;
    }
    // T4 前に止まった端末（並びの先頭が held human）を開く ⇒ 押さなくても確かめを1回出して送る
    if (want('T4')) {
      fresh();
      cur = await open('/__room.html?held=1'); const { pg } = cur;
      const done = await until(async () => (await outbox(pg)).length === 0, 20000);
      await sleep(500);
      const w = writes();
      ok('T4 開いただけで確かめ→送った（書き1回・ok・同じ op_id）', done && S.human.length === 1 && w.length === 1 && w[0].args.p_op_id === 'op-p10-1' && w[0].res.ok === true, { h: S.human.length, w: w.map((c) => c.res) });
      await cur.ctx.close(); cur = null;
    }
    // T5 読みだけ（並びが空）⇒ Cloudflare に1本も出さない・窓は出ない
    if (want('T5')) {
      fresh();
      cur = await open('/__room.html?none=1'); const { pg } = cur;
      await until(async () => S.calls.some((c) => c.fn === 'mj_read'), 20000);
      await sleep(1500);
      ok('T5 読みだけでは api.js を読まない・窓なし・mj-human なし', S.tsLoads === 0 && (await pg.evaluate(() => window.__seen.hw)) === 0 && S.human.length === 0, { ts: S.tsLoads, h: S.human.length, calls: S.calls.map((c) => c.fn) });
      await cur.ctx.close(); cur = null;
    }
    ok('外へ出た呼び 0（api.js は差し替え）', S.ext.length === 0, S.ext.slice(0, 5));
  } catch (e) { if (!SELF || !String(e.message).startsWith('赤 ')) bad.push('例外 ' + String(e.message).split('\n')[0]); fail++; }
  if (cur) await cur.ctx.close().catch(() => {});
  return { pass, fail, bad };
}

(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  PORT = srv.address().port;
  const br = await (CR ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br);
    console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`p10-e2e ${CR ? 'Chromium' : 'WebKit'}: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const C = 'js/gamen-core.mjs', H = 'js/gamen-human.mjs', G = 'js/gamen-room.mjs';
  const W = [
    ['通った後に書き直さない', C, '  if (!(await humanCheck())) return r;\n  return await rpcAuth(fn, args);', '  await humanCheck(); return r;'],
    ['human を見分けない', C, "r.data.ok === false && r.data.err === 'human');", "r.data.ok === false && r.data.err === 'human_x');"],
    ['mj-human の答えを見ない', H, 'return !!(d && d.ok === true);', 'return true;'],
    ['客の鍵を付けない', H, "Authorization: 'Bearer ' + jwt,", "Authorization: 'Bearer x',"],
    ['action を付けない', H, "sitekey, action: 'mj_human',", 'sitekey,'],
    ['帯に［捨てる］を出す', G, `'>もう一度</button></div>'; // P10 §1`, `'>もう一度</button><button class="btn btn-line" id="rDrop">捨てる</button></div>'; // P10 §1`],
    ['開いた時に確かめない', G, '  if (heldHuman(outbox)) setTimeout(() => humanAgain(), 0);', ''],
    ['通った後に held を外さない', G, 'if (ok && heldHuman(outbox)) { outbox = unholdHuman(outbox); save(OUTR, outbox);', 'if (ok && heldHuman(outbox)) { save(OUTR, outbox);'],
    ['読みでも api.js を読む', H, "export function humanPass(deps) {", "loadApi();\nexport function humanPass(deps) {"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）' + (r.fail && r.bad[0] ? '  例: ' + r.bad[0] : ''));
    if (r.fail) red++;
  }
  console.log(`p10-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length && W.length ? 0 : 1);
})();
