// A11「［対局終了］の後はホームへ・終えた対局は続きの部屋に出さない」の画面の台（a11_sadame.md v2.2 §1・§2・§3）。
// node gamen_a11-e2e.cjs <作業木> [--self] [--chromium]（既定 WebKit）・ONLY=S1,S3 で段を選ぶ
// 形は gamen_p6g-e2e.cjs・gamen_b3b-e2e.cjs の写し：本物の taikyoku.html・index.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// 偽の倉庫 /__rpc：mj_read（room＝v3 の形・kind／closed を返す）・mj_write（applyOps）。端末ごとの ctl：force＝次の mj_write の返しを順に差し替える（{__http} は HTTP の失敗）・delayWrite。
// 網：S4 は navigator.onLine を初めの台本で偽る（window.__on）＝頁は読めるが画面は offline と見る。S5 は ctx.setOffline。
// 段：S1 ひとりの対局で点→精算→［対局終了］→ settle_snap が着いた後に / ・ホームに出ない（hidden）
//     S2 ホーム＝控えに2部屋（新しい方は終えた・古い方は続き）→古い方／closed も出さない／全部終えたら hidden
//     S3 送りが held（conflict・stop）→精算に残る・#sClose は押せる／S4 stale→精算に残り押し手が戻る
//     S5 offline で押す→精算に残り aria-busy=true→online で送ってホームへ／S6 retry（500）→busy のまま→次で ok→ホーム
//     S7 送り中に pendingRule→ホームへ行かない・押し手が戻る（pendingStart は作れない＝飛ばす・訳は報告）
//     S8 ホームの判じ＝pickSession（終えた日に卓を足した写し・最後の開催を取り消した写し・終えた後に次の開催）
//     S9 入っていない物があるまま［n件のまま対局終了］→ホームへ
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）・壊しごとに効く段だけ回す（only）。
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
export async function rpcRaw(fn, args) { return await sb().rpc(fn, args); } // 2b：部屋の mj_read・mj_write は rpcRaw を通る＝偽の sb へ
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
    if (fn === 'mj_read') { LOG.push({ dev, fn, t: Date.now() }); send(mjRead(uid, args)); return; }
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

async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); } };
  DB.clear(); LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = []; let lastPg = null;
  const device = async (dev, uid, seedLs, { fakeOff = false } = {}) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, s, fakeOff]) => {
      window.__dev = dev; window.__uid = uid;
      if (fakeOff) { if (sessionStorage.getItem('__on') !== '1') window.__on = false; Object.defineProperty(Navigator.prototype, 'onLine', { get: () => window.__on !== false, configurable: true }); }
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs || {}, fakeOff]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 20000); lastPg = pg;
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    return { pg, ctx };
  };
  const ctlRoom = (rid, at, extra = {}) => { const R = DB.get(rid); return { room_id: rid, kind: R ? R.kind : 'solo', name: R ? R.name : '会' + rid, role: 'kan', owner: true, rules: RULES, ...(R && R.kind === 'shared' ? { channel_key: R.channel_key } : {}), at, ...extra }; };
  const KEY = (rid) => 'mj-room:u1:' + rid, OUT = (rid) => 'mj-outbox:u1:' + rid;
  const seedOf = (rids, more = {}) => { const o = { 'mj-rooms:u1': rids.map((rid, i) => ctlRoom(rid, 100 - i)), ...more }; for (const rid of rids) { o['mj-synced:u1:' + rid] = '1'; if (!(KEY(rid) in o)) o[KEY(rid)] = clone(DB.get(rid).st); } return o; };
  const openR = async (pg, rid) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}`); };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const snapW = (dev) => writes(dev).filter((x) => x.ops.includes('settle_snap'));
  const waitFor = async (fn, ms, step = 50) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const PM = (m, a = 1) => '#vRoom .r-pm[data-m="' + m + '"][data-k="chip"][data-a="' + a + '"]';
  const path_ = (pg) => new URL(pg.url()).pathname;
  const atHome = (pg) => ['/', '/index.html'].includes(path_(pg));
  const atRoom = (pg) => path_(pg).endsWith('/taikyoku.html');
  const btn = (pg, s = '#sClose') => pg.evaluate((x) => { const b = document.querySelector(x); return b ? { dis: b.disabled, busy: b.getAttribute('aria-busy') } : null; }, s);
  const why = (pg) => pg.evaluate(() => { const v = document.querySelector('#vRoom'); return v ? { white: [...v.querySelectorAll('.r-white,.r-red b')].map((x) => x.textContent), btns: [...v.querySelectorAll('button')].map((x) => x.id || x.textContent) } : null; });
  // A11 v2.2：［対局終了］を書いた後の精算は「HH:MM に対局終了」の行に変わり #sClose/#sClose2 は出ない（last が在る時 closeArea を出さない）
  const endView = (pg) => pg.evaluate(() => { const v = document.querySelector('#vRoom'); if (!v) return false; return [...v.querySelectorAll('.r-white,.r-red b')].some((x) => /に対局終了/.test(x.textContent)) && !v.querySelector('#sClose,#sClose2'); });
  const toSeisan = async (pg) => { await pg.click('#rSeisan'); await pg.waitForSelector('#sClose, #sClose2'); };
  const home = async (pg) => { await pg.waitForSelector('#btnOut'); await sleep(150); return pg.evaluate(() => { const b = document.getElementById('tsuzuki'); const c = b.querySelector('.h-cont') || b; return { hidden: b.hidden, href: c.getAttribute('href'), name: (b.querySelector('.h-r') || {}).textContent || null, owari: !!document.getElementById('hOwari') }; }); };
  const goHomePage = async (pg) => { await pg.goto(`http://127.0.0.1:${port}/index.html`); return home(pg); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const step = async (k, f) => { if (!want(k)) return; try { await f(); } catch (e) { fail++; let pv = ''; if (process.env.DBG && lastPg) pv = '  頁=' + (await lastPg.evaluate(() => location.pathname + ' ' + document.body.innerText.slice(0, 400)).catch(() => '?')); bad.push('止まった(' + k + '): ' + String(e.message || e).split('\n')[0].slice(0, 300) + pv); } };
  try {
    // ── S1 ひとりの対局で点を入れて精算→［対局終了］→ settle_snap が着いた後に / ・ホームに出ない ──
    await step('S1', async () => {
      mkRoom('a1');
      const A = await device('A1', 'u1', seedOf(['a1']));
      ctl('A1').delayWrite = 0;
      await openR(A.pg, 'a1'); await A.pg.waitForSelector('#rAdd'); await sleep(300);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      await put(A.pg, 0, '35000'); await put(A.pg, 1, '30000'); await put(A.pg, 2, '25000'); await put(A.pg, 3, '10000'); await kpk(A.pg, 'ok'); await A.pg.click('#eOk');
      await waitFor(() => DB.get('a1').st.hanchans.length === 2, 6000);
      ok('S1 点（2回目）が倉庫に入る', DB.get('a1').st.hanchans.length === 2, DB.get('a1').st.hanchans.length);
      await waitFor(async () => ((await ls(A.pg, OUT('a1'))) || [1]).length === 0, 6000);
      await A.pg.waitForSelector('#rSeisan'); await toSeisan(A.pg);
      ctl('A1').delayWrite = 700; // 着く前に飛ばないかを見る
      let navAt = 0; A.pg.on('framenavigated', (f) => { if (f === A.pg.mainFrame() && atHome(A.pg) && !navAt) navAt = Date.now(); });
      await A.pg.click('#sClose');
      await sleep(250);
      ok('S1 送りの間は精算に残る・「に対局終了」の行・押し手は出ない', (atRoom(A.pg) && (await endView(A.pg))), [A.pg.url(), await why(A.pg)]);
      await A.pg.waitForURL((u) => ['/', '/index.html'].includes(u.pathname), { timeout: SELF ? 5000 : 10000 }).catch(() => {});
      ok('S1 URL が / になる', atHome(A.pg), A.pg.url());
      const sw = snapW('A1');
      ok('S1 settle_snap は1回・倉庫に settle が1つ', sw.length === 1 && DB.get('a1').st.settles.length === 1, [sw.length, DB.get('a1').st.settles.length]);
      ok('S1 ホームへ行ったのは settle_snap が着いた後', sw.length === 1 && sw[0].done && navAt >= sw[0].done, [sw[0] && sw[0].done, navAt]);
      if (atHome(A.pg)) {
        const h = await home(A.pg);
        ok('S1 ホームの #tsuzuki は hidden（他に部屋が無い）', h.hidden === true, h);
        ok('S1 端末の並びは空', ((await ls(A.pg, OUT('a1'))) || []).length === 0);
      }
    });

    // ── S2 ホーム：控えに部屋2つ（新しい方を終えた・古い方は続き）→古い方を出す ──
    await step('S2', async () => {
      const fin = stOf([SNAP('s1')]), cont = stOf();
      const seed = { 'mj-rooms:u1': [{ room_id: 'n2', kind: 'solo', name: '新しい対局', role: 'kan', owner: true, at: 9 }, { room_id: 'o2', kind: 'solo', name: '古い対局', role: 'kan', owner: true, at: 4 }],
        [KEY('n2')]: fin, [KEY('o2')]: cont };
      const A = await device('A2', 'u1', seed);
      const h = await goHomePage(A.pg);
      ok('S2 新しい方を終えた＝古い方を出す', !h.hidden && h.name === '古い対局' && (h.href || '').includes('room=o2'), h);
      // closed の部屋（写しは続き）も出さない
      const B = await device('B2', 'u1', { 'mj-rooms:u1': [{ room_id: 'c2', kind: 'shared', name: '会c2', role: 'kan', owner: true, closed: true, at: 9 }, { room_id: 'o2', kind: 'solo', name: '古い対局', role: 'kan', owner: true, at: 4 }], [KEY('c2')]: cont, [KEY('o2')]: cont });
      const h2 = await goHomePage(B.pg);
      ok('S2 終えた部屋（closed）は出さない＝次の部屋・「終わりました」も無い', !h2.hidden && h2.name === '古い対局' && !h2.owari, h2);
      // 全部終えた＝hidden
      const C = await device('C2', 'u1', { 'mj-rooms:u1': [{ room_id: 'n2', kind: 'solo', name: '新しい対局', role: 'kan', owner: true, at: 9 }, { room_id: 'o2', kind: 'solo', name: '古い対局', role: 'kan', owner: true, at: 4 }], [KEY('n2')]: fin, [KEY('o2')]: fin });
      const h3 = await goHomePage(C.pg);
      ok('S2 全部終えた＝カードを出さない', h3.hidden === true, h3);
      // 写しの無い部屋（読めない）は終えたと見ない＝出す
      const D = await device('D2', 'u1', { 'mj-rooms:u1': [{ room_id: 'n2', kind: 'solo', name: '新しい対局', role: 'kan', owner: true, at: 9 }, { room_id: 'x2', kind: 'shared', name: '会x2', role: 'kan', owner: true, at: 4 }], [KEY('n2')]: fin });
      const h4 = await goHomePage(D.pg);
      ok('S2 写しの無い部屋は終えたと見ない＝出す', !h4.hidden && h4.name === '会x2', h4);
    });

    // ── S3 送りが held（conflict・stop）→精算に残る・#sClose は押せる・URL は taikyoku ──
    for (const [k, res] of [['conflict', { ok: false, err: 'conflict' }], ['stop', { ok: false, err: 'bad', at: 'rev' }]]) {
      await step('S3', async () => {
        const rid = 'a3' + k; mkRoom(rid);
        const dev = 'A3' + k;
        const A = await device(dev, 'u1', seedOf([rid]));
        await openR(A.pg, rid); await A.pg.waitForSelector('#rSeisan'); await sleep(300);
        await toSeisan(A.pg);
        ctl(dev).force = [res];
        await A.pg.click('#sClose');
        await waitFor(async () => { const o = await ls(A.pg, OUT(rid)); return o && o[0] && o[0].held; }, 5000);
        await sleep(1500);
        const o = await ls(A.pg, OUT(rid));
        ok('S3 ' + k + '：並びの先頭が held', o && o.length === 1 && o[0].held && o[0].held.err === res.err, o);
        ok('S3 ' + k + '：URL は taikyoku のまま', atRoom(A.pg), A.pg.url());
        ok('S3 ' + k + '：精算に残る・「に対局終了」の行', (atRoom(A.pg) && (await endView(A.pg))), await why(A.pg));
        ok('S3 ' + k + '：帯 #rHeld が出る', await has(A.pg, '#rHeld'));
      });
    }

    // ── S4 stale（送った印が6日より古い頭）→精算に残り押し手が戻る ──
    await step('S4', async () => {
      mkRoom('a4');
      const ob = [{ op_id: U(9400), ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -1 }], sent_at: new Date(Date.now() - 7 * 86400e3).toISOString() }];
      const copy = LIB.applyOps(clone(DB.get('a4').st), ob[0].ops, { roomRules: RULES, now: NOW() }).state;
      const A = await device('A4', 'u1', seedOf(['a4'], { [KEY('a4')]: copy, [OUT('a4')]: ob }), { fakeOff: true });
      await openR(A.pg, 'a4'); await A.pg.waitForSelector('#rSeisan'); await sleep(300);
      ok('S4 開いた時は offline と見る（並びは送らない）', writes('A4').length === 0 && !(await has(A.pg, '#rHeld')), writes('A4').length);
      await toSeisan(A.pg);
      await A.pg.click('#sClose'); await sleep(200);
      ok('S4 押した後（offline）＝精算に残る・「に対局終了」の行', (atRoom(A.pg) && (await endView(A.pg))), await why(A.pg));
      await A.pg.evaluate(() => { sessionStorage.setItem('__on', '1'); window.__on = true; window.dispatchEvent(new Event('online')); });
      await waitFor(async () => { const o = await ls(A.pg, OUT('a4')); return o && o[0] && o[0].held; }, 4000);
      await sleep(1200);
      const o = await ls(A.pg, OUT('a4'));
      ok('S4 先頭が held stale・settle は後ろに積まれたまま', o && o.length === 2 && o[0].held && o[0].held.err === 'stale' && o[1].ops[0].op === 'settle_snap', o);
      ok('S4 送らない（mj_write 0）', writes('A4').length === 0, writes('A4').length);
      ok('S4 URL は taikyoku のまま', atRoom(A.pg), A.pg.url());
      ok('S4 精算に残り押し手が戻る（disabled でない・aria-busy=false）・帯 #rHeld', atRoom(A.pg) && (await has(A.pg, '#rHeld')) && JSON.stringify(await btn(A.pg)) === JSON.stringify({ dis: false, busy: 'false' }), [await btn(A.pg), await why(A.pg)]);
    });

    // ── S5 offline で押す→精算に残り aria-busy=true → online で送ってホームへ ──
    await step('S5', async () => {
      mkRoom('a5');
      const A = await device('A5', 'u1', seedOf(['a5']));
      await openR(A.pg, 'a5'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      await A.ctx.setOffline(true); await sleep(200);
      await A.pg.click('#sClose'); await sleep(1500);
      ok('S5 offline＝精算に残る・「に対局終了」の行', (atRoom(A.pg) && (await endView(A.pg))), [A.pg.url(), await why(A.pg)]);
      ok('S5 offline の間は送らない', snapW('A5').length === 0);
      ok('S5 並びに settle_snap が1つ', JSON.stringify(((await ls(A.pg, OUT('a5'))) || []).map((x) => x.ops[0].op)) === '["settle_snap"]', await ls(A.pg, OUT('a5')));
      await A.ctx.setOffline(false);
      await A.pg.waitForURL((u) => ['/', '/index.html'].includes(u.pathname), { timeout: SELF ? 5000 : 10000 }).catch(() => {});
      ok('S5 online で送ってホームへ', atHome(A.pg) && snapW('A5').length === 1 && DB.get('a5').st.settles.length === 1, [A.pg.url(), snapW('A5').length]);
      if (atHome(A.pg)) ok('S5 ホームに出ない', (await home(A.pg)).hidden === true);
    });

    // ── S6 送りが retry（server 500）→busy のまま→次の送りで ok→ホームへ ──
    await step('S6', async () => {
      mkRoom('a6');
      const A = await device('A6', 'u1', seedOf(['a6']));
      await openR(A.pg, 'a6'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      ctl('A6').force = [{ __http: 500 }];
      await A.pg.click('#sClose');
      await waitFor(() => snapW('A6').length >= 1, 3000); await sleep(600);
      ok('S6 1回目は 500＝精算に残る・「に対局終了」の行', snapW('A6').length === 1 && (atRoom(A.pg) && (await endView(A.pg))), [snapW('A6').length, await why(A.pg)]);
      await A.pg.waitForURL((u) => ['/', '/index.html'].includes(u.pathname), { timeout: SELF ? 6000 : 10000 }).catch(() => {});
      ok('S6 次の送りで ok→ホームへ（同じ op_id）', atHome(A.pg) && snapW('A6').length === 2 && snapW('A6')[0].op_id === snapW('A6')[1].op_id && DB.get('a6').st.settles.length === 1, [A.pg.url(), snapW('A6').map((x) => x.op_id)]);
    });

    // ── S7 送り中に pendingRule→ホームへ行かず押し手が戻る ──
    // pendingStart は作れない：startShared は部屋を開いた時（pickSession が null＝新しい開催）の道で、精算の頁で送りの最中に起こす押し手が無い（飛ばす）
    await step('S7', async () => {
      mkRoom('a7', { kind: 'shared' });
      const A = await device('A7', 'u1', seedOf(['a7']));
      await openR(A.pg, 'a7'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      ctl('A7').delayWrite = 4000;
      await A.pg.click('#sClose'); await sleep(150);
      await A.pg.click('#barBack'); await A.pg.waitForSelector('#rSeisan'); // 精算の頁にはルールの入口が無い＝部屋へ戻ってから
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRuleGo');
      await A.pg.click('#rRuleGo');
      const rm = await txt(A.pg, '#rRuleMsg');
      ok('S7 ルールは並びの後（pendingRule）＝「前に入れた点を送っています。送れたら変えます。」', rm === '前に入れた点を送っています。送れたら変えます。', rm);
      await waitFor(() => writes('A7').some((x) => x.ops.includes('table_rules') && x.done), 15000);
      ctl('A7').delayWrite = 0;
      await sleep(1500);
      ok('S7 settle_snap の後に table_rules を送る', snapW('A7').length === 1 && writes('A7').some((x) => x.ops.includes('table_rules')), writes('A7').map((x) => x.ops));
      ok('S7 ホームへ行かない', atRoom(A.pg), A.pg.url());
      if ((await txt(A.pg, '#title')) === 'ルール') await A.pg.click('#barBack');
      await A.pg.waitForSelector('#rSeisan'); await A.pg.click('#rSeisan'); await sleep(300);
      const b = (await btn(A.pg, '#sClose')) || (await btn(A.pg, '#sClose2'));
      ok('S7 精算の押し手が戻る（在れば disabled でない・aria-busy=false）', b === null || JSON.stringify(b) === JSON.stringify({ dis: false, busy: 'false' }), b);
      ok('S7 帰っても並びは空', ((await ls(A.pg, OUT('a7'))) || []).length === 0);
    });

    // ── S8 ホームの判じ＝pickSession ──
    await step('S8', async () => {
      const room = (rid, name, at) => ({ room_id: rid, kind: 'solo', name, role: 'kan', owner: true, at });
      // (a) 終えた開催の日に卓を足した（goMissing の道で足した卓）＝最後の開催は終えたまま＝出さない
      const a = stOf([SNAP('s1'), { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' }, { op: 'table_seats', table_id: 't2', seats: M }, { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't2', seats: M, cells: [40000, 30000, 20000, 10000] }]);
      ok('S8 (a) lib の pickSession＝null', LIB.pickSession(a) === null);
      // (b) 続きの開催 s1 の後に s2 を作って終え、s2 を取り消した＝最後の生きた開催 s1 は続き＝出す
      const b = stOf([{ op: 'session_add', session_id: 's2', date: '2026-11-22', rate: 100 }, { op: 'table_add', table_id: 't3', session_id: 's2', label: '卓1' }, SNAP('s2'), { op: 'session_edit', session_id: 's2', voided: true }]);
      ok('S8 (b) lib の pickSession＝s1', LIB.pickSession(b) === 's1');
      // (c) 終えた s1 の後に新しい開催 s2（まだ終えていない）＝出す
      const c = stOf([SNAP('s1'), { op: 'session_add', session_id: 's2', date: '2026-11-22', rate: 100 }, { op: 'table_add', table_id: 't3', session_id: 's2', label: '卓1' }]);
      ok('S8 (c) lib の pickSession＝s2', LIB.pickSession(c) === 's2');
      // (d) 終えていない s1 を取り消した＝生きた開催が無い＝終えたと見ない（出す）
      const d = stOf([{ op: 'session_edit', session_id: 's1', voided: true }]);
      ok('S8 (d) lib の pickSession＝null・生きた開催 0', LIB.pickSession(d) === null);
      const cases = [['a', a, false], ['b', b, true], ['c', c, true], ['d', d, true]];
      for (const [k, st, show] of cases) {
        const A = await device('A8' + k, 'u1', { 'mj-rooms:u1': [room('r8' + k, '対局' + k, 9), room('z8', '後ろ', 1)], [KEY('r8' + k)]: st, [KEY('z8')]: stOf() });
        const h = await goHomePage(A.pg);
        ok('S8 (' + k + ') ホーム＝' + (show ? '出す' : '出さない（次の部屋）'), show ? h.name === '対局' + k : h.name === '後ろ', h);
      }
    });

    // ── S9 入っていない物があるまま［n件のまま対局終了］→ホームへ ──
    await step('S9', async () => {
      mkRoom('a9', { extra: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }] });
      const A = await device('A9', 'u1', seedOf(['a9']));
      await openR(A.pg, 'a9'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      await A.pg.click('#sClose'); await A.pg.waitForSelector('#sClose2');
      ok('S9 1回目は確かめ（［1件のまま対局終了］）', ((await txt(A.pg, '#sClose2')) || '') === '1件のまま対局終了', await txt(A.pg, '#sClose2'));
      ctl('A9').delayWrite = 500;
      await A.pg.click('#sClose2'); await sleep(150);
      ok('S9 送りの間は精算に残る・「に対局終了」の行（入っていない物 1件）', (atRoom(A.pg) && (await endView(A.pg))) && ((await why(A.pg)).white || []).some((x) => /入っていない物 1件のまま/.test(x)), await why(A.pg));
      await A.pg.waitForURL((u) => ['/', '/index.html'].includes(u.pathname), { timeout: SELF ? 5000 : 10000 }).catch(() => {});
      ok('S9 ホームへ・settle の missing が1件', atHome(A.pg) && DB.get('a9').st.settles.length === 1 && DB.get('a9').st.settles[0].missing.length === 1, [A.pg.url(), DB.get('a9').st.settles.length]);
      if (atHome(A.pg)) ok('S9 ホームに出ない', (await home(A.pg)).hidden === true);
    });

    // ── S10 offline で［対局終了］→手で / を開く→並びが残る部屋は出る／pending-close・needs_upload の部屋も出る ──
    await step('S10', async () => {
      mkRoom('a10');
      const A = await device('A10', 'u1', seedOf(['a10']));
      await openR(A.pg, 'a10'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      await A.ctx.setOffline(true); await sleep(200);
      await A.pg.click('#sClose'); await sleep(800);
      const ob = await ls(A.pg, OUT('a10')), cp = await ls(A.pg, KEY('a10'));
      ok('S10 並びに settle_snap・写しは終えた形（pickSession＝null）', ob && ob.length === 1 && ob[0].ops[0].op === 'settle_snap' && cp && LIB.pickSession(cp) === null, [ob, cp && cp.settles]);
      await A.pg.route('**/__rpc', (rt) => rt.abort()); // 頁を移る間に送らせない（並びを残したまま / を開く）
      await A.ctx.setOffline(false);
      const h = await goHomePage(A.pg);
      ok('S10 並びが残る部屋は #tsuzuki に出る', !h.hidden && (h.href || '').includes('room=a10'), h);
      ok('S10 その間 settle_snap は倉庫に着いていない', DB.get('a10').st.settles.length === 0);
      const fin = stOf([SNAP('s1')]);
      const room = (rid, name, at, extra = {}) => ({ room_id: rid, kind: 'solo', name, role: 'kan', owner: true, at, ...extra });
      const cases = [
        ['pending-close', { [KEY('p10')]: fin, ['mj-pending-close:u1:p10']: U(9100) }, {}],
        ['needs_upload', { [KEY('p10')]: { ...clone(fin), needs_upload: true } }, {}],
        ['closed＋並び', { [KEY('p10')]: fin, [OUT('p10')]: [{ op_id: U(9101), ops: [SNAP('s1')] }] }, { closed: true }],
      ];
      for (const [k, more, rx] of cases) {
        const B = await device('B10' + k, 'u1', { 'mj-rooms:u1': [room('p10', '残り', 9, rx), room('z10', '後ろ', 1)], [KEY('z10')]: stOf(), ...more });
        const hb = await goHomePage(B.pg);
        ok('S10 ' + k + ' の部屋（写しは終えた）は出る', !hb.hidden && hb.name === '残り', hb);
      }
      // 控え：並びが空なら同じ写しは出ない（上の3つが unsent で出ていることの裏）
      const C = await device('C10', 'u1', { 'mj-rooms:u1': [room('p10', '残り', 9), room('z10', '後ろ', 1)], [KEY('z10')]: stOf(), [KEY('p10')]: fin, [OUT('p10')]: [] });
      ok('S10 並びが空の終えた部屋は出ない（裏）', (await goHomePage(C.pg)).name === '後ろ');
    });

    // ── S11 offline で［対局終了］→［←］で部屋へ→次の半荘を打ちかけ→online→ ok でも taikyoku のまま・打ちかけが残る ──
    await step('S11', async () => {
      mkRoom('a11');
      const A = await device('A11', 'u1', seedOf(['a11']));
      await openR(A.pg, 'a11'); await A.pg.waitForSelector('#rSeisan'); await sleep(400);
      await toSeisan(A.pg);
      await A.ctx.setOffline(true); await sleep(200);
      await A.pg.click('#sClose'); await sleep(500);
      ok('S11 offline で精算に残る・「に対局終了」の行', (atRoom(A.pg) && (await endView(A.pg))), await why(A.pg));
      await A.pg.click('#barBack'); await A.pg.waitForSelector('#rAdd');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      await put(A.pg, 0, '35000'); await put(A.pg, 1, '30000');
      const v0 = await A.pg.evaluate(() => [0, 1, 2, 3].map((i) => document.querySelector('[data-c="' + i + '"]').value));
      await A.ctx.setOffline(false);
      await waitFor(() => DB.get('a11').st.settles.length === 1, 8000);
      await sleep(1500);
      ok('S11 online で settle_snap が ok', DB.get('a11').st.settles.length === 1 && snapW('A11').length === 1, snapW('A11').length);
      ok('S11 URL は taikyoku のまま', atRoom(A.pg), A.pg.url());
      const v1 = atRoom(A.pg) ? await A.pg.evaluate(() => [0, 1, 2, 3].map((i) => { const e = document.querySelector('[data-c="' + i + '"]'); return e ? e.value : null; })) : null;
      ok('S11 打ちかけが残る', JSON.stringify(v1) === JSON.stringify(v0) && String(v0[0]).replace(/,/g, '') === '35000', [v0, v1]);
    });
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 4).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

// v2.2 で外した壊し3つ：aria-busy・disabled（［対局終了］を書くと押し手ごと消える＝見えない）・held で goHome を落とさない（held の間は並びが空にならず homeTry が飛ばない＝外から同じ）。
// pendingRule の守りと render() 先頭の page 条件、homeTry の page 条件と render の page 条件はそれぞれ二重の守り＝片方だけ消す壊しは効かない（外した）・両方を消す形で回す。
const GR = 'js/gamen-room.mjs', GH = 'js/gamen-home.mjs';
const MUT = [
  { file: GR, from: "goHome = false; location.assign('/'); return true;", to: 'goHome = false; return false;', name: 'location.assign(/) を消す', only: 'S1,S5,S6,S9' },
  { file: GH, from: 'return local.filter((x) => !finished(uid, x)).map', to: 'return local.map', name: 'ホームを myRooms[0] に戻す', only: 'S1,S2,S8' },
  { file: GR, from: 'function homeOff() { if (!goHome) return; goHome = false; rerender(); }', to: 'function homeOff() {}', name: 'homeOff を空にする', only: 'S4' },
  { file: GR, from: 'if (pendingStart || pendingRule) { homeOff(); kick(); return; }', to: "if (goHome) { goHome = false; location.assign('/'); return; } if (pendingStart || pendingRule) { homeOff(); kick(); return; }", also: ["if (goHome && page !== 'seisan') goHome = false;", ''], name: 'pendingRule が在ってもホームへ（render の page 条件も消す＝二重の守りの片方だけでは効かない）', only: 'S7' },
  { file: GR, from: "if (s.kind === 'retry') { clearTimeout(retryTimer);", to: "if (s.kind === 'retry') { homeOff(); clearTimeout(retryTimer);", name: 'retry で goHome を落とす', only: 'S6' },
  { file: GR, from: "if (offline()) return; // 'online' を待つ", to: "if (offline()) { homeOff(); return; } // 'online' を待つ", name: 'offline で goHome を落とす', only: 'S5' },
  { file: GR, from: 'if (homeTry()) return; // A11', to: 'sync(); return; // 壊し', name: 'done で飛ばない', only: 'S1,S5,S6,S9' },
  { file: 'lib/room-state.mjs', from: 'return (st.sessions || []).some((s) => !s.voided && s.league_id == null) && pickSession(st) === null;', to: 'return (st.settles || []).length > 0;', name: '終えた＝settle が1つでも在る（pickSession でない）', only: 'S8' },
  { file: 'lib/room-state.mjs', from: 'return (st.sessions || []).some((s) => !s.voided && s.league_id == null) && pickSession(st) === null;', to: 'return pickSession(st) === null;', name: '生きた開催 0 も終えたと見る', only: 'S8' },
  { file: GH, from: 'if (r.closed === true) return true;', to: '', name: 'closed を終えたと見ない', only: 'S2' },
  { file: GH, from: 'if (!m || m.gate.mode !== \'ok\') return false;', to: 'if (!m) return true; if (m.gate.mode !== \'ok\') return false;', name: '写しの無い部屋を終えたと見る', only: 'S2' },
  { file: GH, from: 'function unsent(uid, rid, m) {', to: 'function unsent(uid, rid, m) { return false;', name: 'unsent を常に false', only: 'S10' },
  { file: GH, from: "!!pc || !!(m && m.st && m.st.needs_upload)", to: "!!(m && m.st && m.st.needs_upload)", name: 'unsent が pending-close を見ない', only: 'S10' },
  { file: GH, from: "!!pc || !!(m && m.st && m.st.needs_upload)", to: '!!pc', name: 'unsent が needs_upload を見ない', only: 'S10' },
  { file: GH, from: "const m = copyOf(uid, r.room_id);\n  if (unsent(uid, r.room_id, m)) return false;\n  if (r.closed === true) return true;", to: "if (r.closed === true) return true;\n  const m = copyOf(uid, r.room_id);\n  if (unsent(uid, r.room_id, m)) return false;", name: 'closed を unsent より先に見る', only: 'S10' },
  { file: GR, from: "if (goHome && page !== 'seisan') goHome = false;", to: '', also: ["if (!goHome || dead || page !== 'seisan' ||", 'if (!goHome || dead ||'], name: 'page 条件を両方消す', only: 'S7,S11' },
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
