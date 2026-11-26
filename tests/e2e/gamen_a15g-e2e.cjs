// 11-26 A6 の上でも回るように p_deleted の読みは空で返す（前の形＝gamen_a15g-e2e_pre-a6.cjs）
// A15g（a15g_sadame v2.0）ホームの続きの部屋を倉庫 mj_my_rooms(p_open:true) から・読めない時だけ控え＋帯／控えに無い部屋を開く。
// node gamen_a15g-e2e.cjs <作業木> [--self] [--chromium]（既定 WebKit）・ONLY=H1,H2
// 台は gamen_a11-e2e.cjs の写し（本物の index.html・taikyoku.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる）。偽の倉庫に mj_my_rooms（MY・ctl.myForce・ctl.holdMy）を足した。
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const CHROMIUM = process.argv.includes('--chromium');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STUB = `export * from '/js/__core_real.mjs';
export async function needLogin(cb) { cb({ id: window.__uid }); }
export async function currentUser() { return { id: window.__uid, email: 'u@example.invalid' }; }
async function call(fn, args) {
  try {
    const r = await fetch('/__rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, args, dev: window.__dev, uid: window.__uid }) });
    return await r.json();
  } catch (e) { return { data: null, error: { message: String((e && e.message) || e) } }; }
}
window.__chans = {};
export function sb() { return { auth: { onAuthStateChange() {}, signOut() { return Promise.resolve(); } }, rpc: call,
  channel(key) { const c = { on(t, ev, cb) { (window.__chans[key] = window.__chans[key] || []).push(cb); return c; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return c; }, send() { return Promise.resolve('ok'); } }; return c; },
  removeChannel() { return Promise.resolve(); } }; }
export async function rpc(fn, args) {
  if (navigator.onLine === false) return { ok: false, err: 'offline' };
  const r = await call(fn, args);
  if (r.error) { const st = r.status || 0; if (st === 401 || st === 403) return { ok: false, err: 'mj_session' }; if (!st) return { ok: false, err: 'net' }; return { ok: false, err: 'server', detail: r.error.message, status: st }; }
  const d = r.data;
  if (!d || typeof d !== 'object') return { ok: false, err: 'server', detail: '返しが object でない' };
  return d;
}
export function showLogin(cb) { window.__login = (window.__login || 0) + 1; window.__loginCb = cb; }
`;

let mutate = null;
let LIB = null, RULES = null;
const DB = new Map();
const DEL = new Map(); // uid → mj_my_rooms(p_deleted) の行（A6 の上で回す時だけ・既定は空）
const MY = new Map(); // uid → mj_my_rooms(p_open) の行（並び済み）
const LOG = [];
const CTL = {};
const ctl = (dev) => (CTL[dev] = CTL[dev] || { force: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = () => new Date().toISOString();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NAMES = ['山田', '鈴木', '佐藤', '高橋'];
const M = ['m1', 'm2', 'm3', 'm4'];
const SNAP = (sid) => ({ op: 'settle_snap', session_id: sid, rev: 1, content: {}, used: {}, missing: [] });

/* 部屋＝開催1つ（s1・卓 t1・半荘1回・m1〜m4）＋extra */
function stOf(extra = []) {
  let st = LIB.emptyState(); st.rules = RULES;
  const ops = M.map((m, i) => ({ op: 'member_add', member_id: m, name: NAMES[i] }));
  ops.push({ op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_seats', table_id: 't1', seats: M }, { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: M, cells: [40000, 30000, 20000, 10000] }, ...extra);
  const r = LIB.applyOps(st, ops, { roomRules: RULES, now: '2026-11-21T00:00:00Z', role: 'kan' });
  if (!r.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(r.res));
  return r.state;
}
function mkRoom(rid, { kind = 'solo', extra = [], closed = false } = {}) {
  DB.set(rid, { kind, name: kind === 'solo' ? '対局' : '会' + rid, rules: RULES, closed, read_ver: 1, channel_key: 'ch-' + rid, st: stOf(extra), results: new Map() });
}
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; delete o.loaded; delete o.absent; return o; };
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  const args = a.p_args && typeof a.p_args === 'object' ? a.p_args : {};
  const room = { kind: R.kind, name: R.kind === 'shared' ? R.name : undefined, role: 'kan', owner: true, closed: R.closed, rules: R.rules, channel_key: R.kind === 'shared' ? R.channel_key : undefined };
  if (a.p_what !== 'room') return { ok: false, err: 'bad', what: 'what' };
  if (args.since !== undefined && args.since !== null && args.since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
  const o = stOut(R.st);
  if (args.v !== 3) { o.v = 2; return { ok: true, read_ver: R.read_ver, room, st: o, leagues: [] }; }
  const loaded = o.sessions.map((s) => s.session_id);
  const st = { ...o, v: 3, members: o.members.map((m) => ({ ...m, n: 0, last: null })), loaded, absent: [] };
  return { ok: true, read_ver: R.read_ver, room, st, leagues: [] };
}
function mjWrite(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  if (R.closed) return { ok: false, err: 'bad', at: 'closed', i: 0 };
  const r = LIB.applyOps(R.st, a.p_ops, { roomRules: R.rules, now: NOW(), role: 'kan', direct: a.p_ops.some((o) => o.op === 'table_rules') });
  if (!r.ok) { R.results.set(a.p_op_id, r.res); return r.res; }
  R.st = r.state; R.st.rules = R.rules; R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const c = ctl(dev);
    const send = (o, status = 200) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o.error ? { ...o, status } : { data: o, error: null, status })); };
    if (fn === 'mj_my_rooms' && args.p_deleted) { send({ ok: true, rooms: (DEL.get(uid) || []).slice(0, args.p_limit) }); return; } // A6 v1.4.3 から ホームは消した一覧も読む＝A15g の試しでは消した部屋は0（A6 の試しは gamen_a6-e2e.cjs）
    if (fn === 'mj_my_rooms') {
      LOG.push({ dev, fn, args, t: Date.now() });
      if (c.holdMy) await c.holdMy;
      if (c.myForce && c.myForce.length) { const x = c.myForce.shift(); if (x && x.__http !== undefined) { send({ data: null, error: { message: 'upstream' } }, x.__http); return; } send(x); return; }
      const all = MY.get(uid) || [];
      const i = args.p_before_id ? all.findIndex((r) => r.room_id === args.p_before_id) + 1 : 0;
      send({ ok: true, rooms: all.slice(i, i + args.p_limit) }); return;
    }
    if (fn === 'mj_read') { LOG.push({ dev, fn, t: Date.now() }); while (c.holdRead) await sleep(100); send(mjRead(uid, args)); return; }
    if (fn === 'mj_write') {
      const e = { dev, fn, op_id: args.p_op_id, ops: args.p_ops.map((o) => o.op), t: Date.now() }; LOG.push(e);
      if (c.delayWrite) await sleep(c.delayWrite);
      if (c.force.length) { const x = c.force.shift(); e.res = x; if (x.__http) { send({ data: null, error: { message: 'upstream' } }, x.__http); return; } send(x); e.done = Date.now(); return; }
      e.res = mjWrite(uid, args); send(e.res); e.done = Date.now(); return;
    }
    send({ ok: false, err: 'stub' }); return;
  }
  if (u === '/js/gamen-core.mjs') { r.writeHead(200, { 'content-type': MT['.mjs'] }); r.end(STUB); return; }
  if (u === '/js/__core_real.mjs') u = '/js/gamen-core.mjs';
  if (u === '/js/sw-reg.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end(''); return; }
  if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  const ext = path.extname(f);
  if (ext === '.png') { r.writeHead(200, { 'content-type': MT[ext] }); r.end(fs.readFileSync(f)); return; }
  let b = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (mutate && mutate.file && f.replace(/\\/g, '/').endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); if (mutate.also) { if (!b.includes(mutate.also[0])) { console.log('✗ 壊しの字が無い ' + mutate.also[0]); process.exit(2); } b = b.replace(mutate.also[0], mutate.also[1]); } }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

const row = (rid, o = {}) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: 'kan', closed: false, created_at: '2026-11-01T00:00:00Z', last_write_at: '2026-11-20T00:00:00Z', last_date: '2026-11-21', hanchan_n: 3, member_n: 4, ...o });
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); } };
  DB.clear(); MY.clear(); LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = [];
  const device = async (dev, uid, seedLs) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, s]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs || {}]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 20000);
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    return { pg, ctx };
  };
  const ctlRoom = (rid, at, extra = {}) => { const R = DB.get(rid); return { room_id: rid, kind: R ? R.kind : 'shared', name: R ? R.name : '会' + rid, role: 'kan', owner: true, rules: RULES, ...(R && R.kind === 'shared' ? { channel_key: R.channel_key } : {}), at, ...extra }; };
  const KEY = (rid) => 'mj-room:u1:' + rid, OUT = (rid) => 'mj-outbox:u1:' + rid;
  const seedOf = (rows, more = {}) => { const o = { 'mj-rooms:u1': rows, ...more }; for (const x of rows) { const R = DB.get(x.room_id); if (R && !(KEY(x.room_id) in o)) { o[KEY(x.room_id)] = clone(R.st); o['mj-synced:u1:' + x.room_id] = '1'; } } return o; };
  const cards = (pg) => pg.evaluate(() => { const b = document.getElementById('tsuzuki'); const band = document.getElementById('hBand');
    return { hidden: b.hidden, band: !band.hidden, list: [...b.querySelectorAll('.h-cont')].map((c) => ({ rid: c.dataset.rid, href: c.getAttribute('href'), name: (c.querySelector('.h-r') || {}).textContent, m: (c.querySelector('.h-m') || {}).textContent || '' })) }; });
  const ids = (c) => c.list.map((x) => x.rid).join();
  const goHome = async (pg) => { await pg.goto(`http://127.0.0.1:${port}/index.html`); await pg.waitForSelector('#btnOut'); };
  const waitFor = async (fn, ms, step = 50) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const myCalls = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_my_rooms' && !x.args.p_deleted);
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const shareShown = (pg) => pg.evaluate(() => [...document.querySelectorAll('#vRoom button, #vRoom a')].some((b) => /部屋名と URL/.test(b.textContent)));
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const step = async (k, f) => { if (!want(k)) return; try { await f(); } catch (e) { fail++; bad.push('止まった(' + k + ') ' + String(e && e.message || e).slice(0, 300)); } finally { DEL.clear(); for (const c of ctxs.splice(0)) await c.close().catch(() => {}); } };
  try {
    await step('H1', async () => {
      MY.set('u1', [row('r2', { name: '金曜会', last_date: '2026-11-25', hanchan_n: 5, member_n: 4 }), row('r1', { name: '土曜会', last_date: '2026-11-02', hanchan_n: 0, member_n: 0 })]);
      const A = await device('H1', 'u1', {});
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).list.length === 2, 5000);
      const c = await cards(A.pg);
      ok('H1 2枚・倉庫の順', ids(c) === 'r2,r1' && !c.hidden, c);
      ok('H1 字（日・半荘・人）', c.list[0] && c.list[0].name === '金曜会' && c.list[0].m === '11/25 ・ 半荘5回目まで ・ 4人', c.list[0]);
      ok('H1 0 の欄は出さない', c.list[1] && c.list[1].m === '11/2', c.list[1]);
      ok('H1 押す先', c.list[0] && c.list[0].href === '/taikyoku.html?room=r2', c.list[0]);
      ok('H1 帯は出ない', !c.band);
      ok('H1 p_open:true・limit 50', myCalls('H1').length === 1 && myCalls('H1').every((x) => x.args.p_open === true && x.args.p_limit === 50), myCalls('H1').map((x) => x.args));
    });
    await step('H1b', async () => {
      const rows = []; for (let i = 0; i < 51; i++) rows.push(row('p' + String(i).padStart(2, '0'), { last_write_at: new Date(Date.UTC(2026, 10, 20) - i * 60000).toISOString() }));
      MY.set('u1', rows);
      const A = await device('H1b', 'u1', {});
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).list.length === 51, 6000);
      const c = await cards(A.pg); const calls = myCalls('H1b');
      ok('H1b 51枚', c.list.length === 51 && c.list[50].rid === 'p50', c.list.length);
      ok('H1b 2頁目は before つき', calls.length === 2 && calls[1].args.p_before_id === 'p49' && calls[1].args.p_before_at === rows[49].last_write_at, calls.map((x) => x.args));
    });
    await step('H2', async () => {
      mkRoom('lx', { kind: 'shared' }); mkRoom('ly', { kind: 'shared' });
      MY.set('u1', [row('ly'), row('db1')]);
      const A = await device('H2', 'u1', seedOf([ctlRoom('lx', 200), ctlRoom('ly', 100)], { [OUT('lx')]: [{ op_id: 'o1', ops: [] }], [OUT('ly')]: [{ op_id: 'o2', ops: [] }] }));
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).list.length >= 3, 5000); await sleep(200);
      const c = await cards(A.pg);
      ok('H2 送っていない部屋が頭・倉庫に在る部屋は1枚', ids(c) === 'lx,ly,db1', ids(c));
    });
    await step('H3', async () => {
      mkRoom('fa', { kind: 'shared' }); mkRoom('fb', { kind: 'shared', extra: [{ op: 'settle_snap', session_id: 's1', rev: 1, content: {}, used: {}, missing: [] }] });
      MY.set('u1', [row('zz', { name: '倉庫の会' })]);
      const A = await device('H3', 'u1', seedOf([ctlRoom('fb', 200), ctlRoom('fa', 100)]));
      ctl('H3').myForce = [{ __http: 0 }];
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).band, 5000);
      let c = await cards(A.pg);
      ok('H3 net→控えの終えていない部屋だけ＋帯', c.band && ids(c) === 'fa', c);
      await A.pg.click('#hBandAgain'); await waitFor(async () => !(await cards(A.pg)).band, 5000);
      c = await cards(A.pg);
      ok('H3 ［もう一度］で倉庫の並び・帯消え', !c.band && ids(c) === 'zz', c);
      const hb = await A.pg.evaluate(() => { const b = document.getElementById('hBandAgain'); return b ? getComputedStyle(b).minHeight : null; });
      ok('H3 ［もう一度］は高さ36', hb === '36px', hb);
    });
    await step('H3b', async () => {
      mkRoom('fa', { kind: 'shared' });
      const rows = []; for (let i = 0; i < 50; i++) rows.push(row('q' + i)); MY.set('u1', rows);
      const A = await device('H3b', 'u1', seedOf([ctlRoom('fa', 100)]));
      ctl('H3b').myForce = [{ ok: true, rooms: rows }, { __http: 500 }];
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).band, 5000);
      const c = await cards(A.pg);
      ok('H3b 2頁目で読めない→控えだけ（1頁目は混ざらない）', c.band && ids(c) === 'fa', c.list.length);
    });
    await step('H4', async () => {
      mkRoom('fa', { kind: 'shared' });
      const A = await device('H4', 'u1', seedOf([ctlRoom('fa', 100)]));
      ctl('H4').myForce = [{ __http: 401 }];
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).band, 5000);
      const c = await cards(A.pg); const lg = await A.pg.evaluate(() => window.__login || 0);
      ok('H4 mj_session→ログインの窓＋控え＋帯', lg >= 1 && c.band && ids(c) === 'fa', { lg, c });
    });
    await step('H5', async () => {
      mkRoom('ds', { kind: 'shared' }); mkRoom('do', { kind: 'solo' });
      MY.set('u1', [row('ds', { name: DB.get('ds').name }), row('do', { kind: 'solo', name: null }), row('dg')]);
      const old = [ctlRoom('old0', 1, { token: 'a'.repeat(32) })];
      for (let i = 1; i <= 30; i++) old.unshift(ctlRoom('o' + i, 1 + i));
      const A = await device('H5', 'u1', { 'mj-rooms:u1': old });
      await goHome(A.pg); await waitFor(async () => (await cards(A.pg)).list.length === 3, 5000);
      await A.pg.click('#tsuzuki .h-cont[data-rid="ds"]');
      await A.pg.waitForSelector('#rAdd'); await sleep(300);
      const rows = await ls(A.pg, 'mj-rooms:u1');
      ok('H5 倉庫から開いた部屋が控えに足る', rows.some((x) => x.room_id === 'ds' && x.kind === 'shared' && x.rules), rows.length);
      ok('H5 31件を越えても古い token の行が残る', rows.length === 32 && rows.some((x) => x.room_id === 'old0' && x.token), rows.length);
      // solo：読む間（mj_read を遅らせる）も開いた後も［部屋名と URL］無し
      ctl('H5').holdRead = true;
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=do`); await A.pg.waitForSelector('#rReading');
      ok('H5 solo を読む間に［部屋名と URL］無し', !(await shareShown(A.pg)));
      ctl('H5').holdRead = false;
      await A.pg.waitForSelector('#rAdd', { timeout: 15000 }); await sleep(300);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRules'); await sleep(200); // 釦はルールの頁にだけ出る
      ok('H5 solo を開いた後も［部屋名と URL］無し（ルールの頁）', !(await shareShown(A.pg)));
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=dg`);
      const w = await waitFor(async () => /消されているか、入れなくなりました/.test(await A.pg.evaluate(() => document.body.innerText)), 6000);
      const rows2 = await ls(A.pg, 'mj-rooms:u1');
      ok('H5 gone→字', w >= 0);
      ok('H5 gone→控えは増えない', !rows2.some((x) => x.room_id === 'dg') && rows2.length === 33, rows2.length);
    });
    await step('H5b', async () => {
      mkRoom('fa', { kind: 'shared' }); mkRoom('fd', { kind: 'shared' });
      MY.set('u1', [row('zz')]); // 本物の倉庫は A6 の p_deleted=false で消した部屋を返さない
      let rel; ctl('H5b').holdMy = new Promise((s) => { rel = s; });
      const fdAt = new Date().toISOString(); DEL.set('u1', [row('fd', { role: 'owner', deleted_at: fdAt, undo_until: new Date(Date.parse(fdAt) + 7 * 864e5).toISOString() })]); // 本物の倉庫なら今消した fd は消した一覧に在る（無いと A6 §3 9c で「他で戻した」と見る）
      const A = await device('H5b', 'u1', seedOf([ctlRoom('fd', 200, { deleted_at: fdAt }), ctlRoom('fa', 100)], { [OUT('fd')]: [{ op_id: 'o', ops: [] }] }));
      await goHome(A.pg);
      await sleep(3000); let c = await cards(A.pg);
      ok('H5b 待つ間は空・帯無し', c.hidden && !c.band, c);
      const t = await waitFor(async () => (await cards(A.pg)).band, 9000);
      c = await cards(A.pg);
      ok('H5b 8秒で控え＋帯（消した部屋は出ない）', t >= 0 && ids(c) === 'fa', { t, c });
      ctl('H5b').holdMy = null; rel();
      await waitFor(async () => !(await cards(A.pg)).band, 5000);
      c = await cards(A.pg);
      ok('H5b 放すと倉庫に替わる・帯消え', !c.band && ids(c) === 'zz', c);
    });
    await step('H5c', async () => {
      mkRoom('gc', { kind: 'shared' });
      MY.set('u1', [row('gc')]); // 他の端末で［元に戻す］→倉庫は行を返す
      const A = await device('H5c', 'u1', seedOf([ctlRoom('gc', 100, { gone: true, deleted_at: new Date().toISOString() })], {}));
      await goHome(A.pg);
      await waitFor(async () => (await cards(A.pg)).list.length === 1, 6000);
      const c = await cards(A.pg); const r = ((await ls(A.pg, 'mj-rooms:u1')) || []).find((x) => x.room_id === 'gc');
      ok('H5c 控えが gone でも倉庫の行はカードに出る', ids(c) === 'gc', c);
      ok('H5c 控えの消した印が外れる', !!r && r.gone !== true && !r.deleted_at, r);
    });
    await step('H6', async () => {
      MY.set('u1', [row('stale')]);
      let rel; ctl('H6').holdMy = new Promise((s) => { rel = s; });
      const A = await device('H6', 'u1', {});
      await goHome(A.pg); await sleep(300);
      ctl('H6').holdMy = null; MY.set('u1', [row('new2')]);
      await A.pg.evaluate(() => document.getElementById('hBandAgain').click());
      await waitFor(async () => (await cards(A.pg)).list.length === 1, 5000);
      MY.set('u1', [row('stale')]); rel(); await sleep(800);
      const c = await cards(A.pg);
      ok('H6 古い読みの返しで並びが替わらない', ids(c) === 'new2', c.list);
    });
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
  return { pass, fail, bad };
}
const GH = 'js/gamen-home.mjs', GC = 'js/gamen-core.mjs', GT = 'js/gamen-taikyoku.mjs';
const MUT = [
  { file: GH, from: "return { ok: false, err: (res && res.err) || 'net' }; // 途中の頁", to: "return rows.length ? { ok: true, rows } : { ok: false, err: (res && res.err) || 'net' }; // 途中の頁", name: '途中で読めない頁の前の行を使う', only: 'H3b' },
  { file: GC, from: 'JSON.stringify(a)); // A15g', to: 'JSON.stringify(a.slice(0, 30))); // A15g', name: '30件切りを戻す', only: 'H5' },
  { file: GH, from: 'timer = setTimeout(fallback, WAIT_MS);', to: '', name: '時間切れを抜く', only: 'H5b' },
  { file: GH, from: 'const delRow = (x) => !!x.deleted_at || x.gone === true;', to: 'const delRow = (x) => false;', name: 'A6 の門を抜く', only: 'H5b' },
  { file: GH, from: '  for (const x of myRooms(uid)) if (x && delRow(x) && ids.has(x.room_id)) patchRoom(uid, x.room_id, { gone: false, deleted_at: null });', to: '  rows = rows.filter((r) => !myRooms(uid).some((x) => x && delRow(x) && x.room_id === r.room_id));', name: '倉庫の行にも A6 の門', only: 'H5c' },
  { file: GH, from: '  for (const x of myRooms(uid)) if (x && delRow(x) && ids.has(x.room_id)) patchRoom(uid, x.room_id, { gone: false, deleted_at: null });', to: '', name: '消した印を外さない', only: 'H5c' },
  { file: GH, from: 'const seq = ++drawSeq;', to: 'const seq = drawSeq;', name: '古い読みを捨てない', only: 'H6' },
  { file: GH, from: 'const head = local.filter((x) => !ids.has(x.room_id) && unsent(', to: 'const head = [].filter((x) => !ids.has(x.room_id) && unsent(', name: '送っていない部屋を足さない', only: 'H2' },
  { file: GH, from: 'const ids = new Set(rows.map((r) => r.room_id));', to: 'const ids = new Set();', name: '同じ部屋を2枚にする', only: 'H2' },
  { file: GH, from: 'if (!rows) return local.filter((x) => !finished(uid, x))', to: 'if (!rows) return local.filter((x) => true)', name: '控えで終えた部屋も出す', only: 'H3' },
  { file: GT, from: "if (room) share = room.kind !== 'solo' ?", to: 'if (room) share = true ?', name: '開いた solo に share', only: 'H5' },
  { file: GT, from: "room.kind !== 'solo' && !room.fromDb ?", to: "room.kind !== 'solo' ?", name: '読む間の今だけの形に share', only: 'H5' },
  { file: GT, from: "if (!room) room = { room_id: roomId, kind: 'shared', name: '', role: null, fromDb: true };", to: "if (!room) { show('vChoose'); return; }", name: '控えに無い部屋を断る', only: 'H5' },
];

(async () => {
  LIB = await import(pathToFileURL(path.join(ROOT, 'lib/room-state.mjs')).href);
  const RLm = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RLm.rulesOk({ ...RLm.defaultRules(4), rate: 100, chip_pt10: 20 }).rules;
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (CHROMIUM ? pw.chromium : pw.webkit).launch();
  const nm = CHROMIUM ? 'Chromium' : 'WebKit';
  let code = 0;
  if (!SELF) {
    const r = await run(br, port);
    console.log(nm + ' ' + r.pass + '/' + (r.pass + r.fail));
    for (const b of r.bad) console.log('  ✗ ' + b);
    code = r.fail ? 1 : 0;
  } else {
    let red = 0;
    const base = process.env.ONLY;
    for (const m of MUT) {
      // 壊す前の赤（作りがまだ定めに届いていない所）は数えない＝壊しで新しく赤になった物だけ
      const key = (b) => b.split('  ')[0];
      mutate = null; process.env.ONLY = m.only || '';
      const base0 = new Set((await run(br, port)).bad.map(key));
      mutate = m;
      const r = await run(br, port);
      const nb = r.bad.filter((b) => !base0.has(key(b)));
      if (nb.length) red++;
      console.log((nb.length ? '赤 ' : '★緑（効いていない）') + m.name + '  新しい赤 ' + nb.length + '（壊す前から赤 ' + base0.size + '）' + (nb.length ? '  例: ' + nb[0].slice(0, 160) : ''));
    }
    mutate = null; process.env.ONLY = base || '';
    console.log(nm + ' 壊し ' + red + '/' + MUT.length + ' 赤'); code = red === MUT.length ? 0 : 1;
  }
  await br.close(); srv.close(); process.exit(code);
})();
