// A6＋A27「［部屋を消す］はルールの頁の［部屋を終える］の下・［元に戻す］は taikyoku.html（部屋を作る・入る）の一番下 #tModosu・ホームに帯を出さない・対局の頁の一番下は［対局終了］#rEnd」の画面の台
// （a6_sadame.md v1.4.3 §3 の段を a27_sadame.md v1.1 §5 の置き場に書き直した＝gamen_a6-e2e.cjs の A27 版。A27 が入る push で tests/e2e/gamen_a6-e2e.cjs をこれで置き換える）。
// 帯（bands）＝taikyoku.html の #tModosu の行。ホーム（home()）はカードだけ＋ homeBand（ホームに帯が在るか＝いつも false が正）。
// E1-E4＝A27 §1 の［対局終了］#rEnd（E3＝押した印が読み込み中の頁で落ちる＝後の［精算を見る］で締めない／E4＝読み込みの後に同じ頁で描き直しても締めない）。
// v1.4.3：偽の倉庫に mj_my_rooms（p_open＝入った部屋で消していない・閉じていない・締めていない／p_deleted＝持ち主で消して7日の内・deleted_at の新しい順・(deleted_at, room_id) の頁）。
//   ctl(dev).by['mj_my_rooms:open:1'|'mj_my_rooms:deleted:2'…] = { force:[…], delayMs, hold:Promise }＝読み1つ・頁1つだけ切る・遅らせる（N1）。
// node gamen_a6-e2e.cjs <作業木> [--self] [--chromium]（既定 WebKit）・ONLY=D1,D3 で段を選ぶ
// 形は gamen_a11-e2e.cjs の写し：本物の taikyoku.html・index.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// 偽の倉庫 /__rpc：mj_read（消した部屋は gone・owner は持ち主の uid か）・mj_write（room_delete＝持ち主だけ・room_undelete＝消した部屋だけ通す・他の op は applyOps・消した部屋は gone）。
// 端末ごとの ctl：force＝次の mj_write の返しを順に差し替える（{__http} は HTTP の失敗）・lose＝倉庫に当ててから HTTP 500（返りが切れた）・delayOp＝その op を含む書きだけ遅らせる。
// 段：D1 持ち主のひとりの対局で消す→/・カード無し・帯1つ→［元に戻す］→カードが戻る・倉庫の deleted_at が空
//     D2 持ち主でない（owner:false）＝箱が無い／リーグの対局＝箱が無い
//     D3 未送信1組→2段目に「1組も消えます」→消した後に並びの鍵が無い・ホームにカードが無い
//     D4 mj_reauth→ログインし直す→同じ op_id で送り直し→ホーム
//     D5 網の失敗→［もう一度］→同じ op_id→ホーム
//     D6 印が在るまま開き直す→2段目が開いて［もう一度］・自動では送らない・［やめる］は無い
//     D7 他の人の端末（消された後に開く）→帯 #rGone・控えに gone:true・ホームのカードに出ない
//     D8 持ち主の2台目（控えに owner 無し）→読んだ後に箱が出る
//     D9 返りが切れた（倉庫では消えた）→開き直す→gone→片付けて / ・帯
//     D10 2部屋を消す→帯2つ（新しい順）→古い方を戻す→その部屋のカード・もう1つの帯は残る
//     D11 消した後に部屋を開き直す（gone）→控えに gone を足さない→ホームで戻す→カードが戻る
//     D12 他の人の端末は gone:true でカードが消える→持ち主が戻す→URL で開いて読めた＝gone が外れる→カードが戻る
//     D13 ± を送っている最中に消す→並びの鍵は空のまま
//     D14 closed の返し（roomInfo({closed:true})）を通っても持ち主の箱は残る
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）・壊しごとに効く段だけ回す（only）。
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test'] }));
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
const LOG = [];
const CTL = {};
const ctl = (dev) => (CTL[dev] = CTL[dev] || { force: [], by: {}, page: {} });
let LW = 1; // 書いた順（p_open の並び）
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = () => new Date().toISOString();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const NAMES = ['山田', '鈴木', '佐藤', '高橋'];
const M = ['m1', 'm2', 'm3', 'm4'];

function stOf(extra = []) {
  let st = LIB.emptyState(); st.rules = RULES;
  const ops = M.map((m, i) => ({ op: 'member_add', member_id: m, name: NAMES[i] }));
  ops.push({ op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_seats', table_id: 't1', seats: M }, { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: M, cells: [40000, 30000, 20000, 10000] }, ...extra);
  const r = LIB.applyOps(st, ops, { roomRules: RULES, now: '2026-11-21T00:00:00Z', role: 'kan' });
  if (!r.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(r.res));
  return r.state;
}
function mkRoom(rid, { kind = 'solo', closed = false, owner = 'u1', name } = {}) {
  DB.set(rid, { users: new Set([owner]), lw: LW++, settled: false, kind, name: name || (kind === 'solo' ? '対局' : '会' + rid), rules: RULES, closed, owner, deleted_at: null, read_ver: 1, channel_key: 'ch-' + rid, st: stOf(), results: new Map() });
}
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; delete o.loaded; delete o.absent; return o; };
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R || R.deleted_at) return { ok: false, err: 'gone' };
  R.users.add(uid);
  const args = a.p_args && typeof a.p_args === 'object' ? a.p_args : {};
  const room = { kind: R.kind, name: R.kind === 'shared' ? R.name : undefined, role: 'kan', owner: R.owner === uid, closed: R.closed, rules: R.rules, channel_key: R.kind === 'shared' ? R.channel_key : undefined };
  if (a.p_what === 'league') {
    const o = stOut(R.st);
    return { ok: true, read_ver: R.read_ver, room, league: { league_id: args.league_id, name: 'リーグ', l: true, rules: R.rules }, days: [], st: { ...o, v: 3, members: o.members.map((m) => ({ ...m, n: 0, last: null })), loaded: o.sessions.map((s) => s.session_id), absent: [] } };
  }
  if (a.p_what !== 'room') return { ok: false, err: 'bad', what: 'what' };
  if (args.since !== undefined && args.since !== null && args.since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
  const o = stOut(R.st);
  const st = { ...o, v: 3, members: o.members.map((m) => ({ ...m, n: 0, last: null })), loaded: o.sessions.map((s) => s.session_id), absent: [] };
  return { ok: true, read_ver: R.read_ver, room, st, leagues: [] };
}
function mjWrite(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  const ops = a.p_ops.map((o) => o.op);
  if (ops.includes('room_undelete')) {
    if (R.owner !== uid) return { ok: false, err: 'mj_role' };
    R.deleted_at = null; R.read_ver++; const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
  }
  if (R.deleted_at) return { ok: false, err: 'gone' };
  if (ops.includes('room_delete')) {
    if (R.owner !== uid) return { ok: false, err: 'mj_role' };
    R.deleted_at = NOW(); R.read_ver++; const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
  }
  if (R.closed) return { ok: false, err: 'bad', at: 'closed', i: 0 };
  const r = LIB.applyOps(R.st, a.p_ops, { roomRules: R.rules, now: NOW(), role: 'kan' });
  if (!r.ok) { R.results.set(a.p_op_id, r.res); return r.res; }
  R.st = r.state; R.st.rules = R.rules; R.read_ver++; R.lw = LW++;
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
/* mj_my_rooms の偽（a15_sadame §1・a6db_sadame §1 の形だけ） */
const DAY = 24 * 3600e3;
function myRoomsOf(uid, a, list) {
  const lim = Math.max(1, Math.min(50, a.p_limit || 50));
  let rows;
  if (list === 'deleted') {
    rows = [...DB.entries()].filter(([, R]) => R.owner === uid && R.deleted_at && Date.now() - Date.parse(R.deleted_at) <= 7 * DAY)
      .map(([rid, R]) => ({ room_id: rid, kind: R.kind, name: R.kind === 'shared' ? R.name : null, role: 'owner', closed: R.closed, created_at: '2026-11-21T00:00:00Z', last_write_at: null, last_date: '2026-11-21', hanchan_n: 1, member_n: 4, deleted_at: R.deleted_at, undo_until: new Date(Date.parse(R.deleted_at) + 7 * DAY).toISOString() }))
      .sort((x, y) => (x.deleted_at < y.deleted_at ? 1 : x.deleted_at > y.deleted_at ? -1 : x.room_id < y.room_id ? 1 : -1));
    if (a.p_before_at) rows = rows.filter((r) => r.deleted_at < a.p_before_at || (r.deleted_at === a.p_before_at && r.room_id < a.p_before_id));
  } else {
    rows = [...DB.entries()].filter(([, R]) => R.users.has(uid) && !R.deleted_at && !R.closed && !R.settled)
      .sort(([ia, x], [ib, y]) => y.lw - x.lw || (ia < ib ? 1 : -1))
      .map(([rid, R]) => ({ room_id: rid, kind: R.kind, name: R.kind === 'shared' ? R.name : null, role: 'kan', closed: false, created_at: '2026-11-21T00:00:00Z', last_write_at: new Date(Date.UTC(2026, 10, 21) + R.lw * 1000).toISOString(), last_date: '2026-11-21', hanchan_n: 1, member_n: 4 }));
    if (a.p_before_at) { const i = rows.findIndex((r) => r.room_id === a.p_before_id); rows = i < 0 ? [] : rows.slice(i + 1); }
  }
  return { ok: true, rooms: rows.slice(0, lim) };
}
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const c = ctl(dev);
    const send = (o, status = 200) => { if (r.destroyed) return; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o.error ? { ...o, status } : { data: o, error: null, status })); };
    if (fn === 'mj_my_rooms') {
      const list = args.p_deleted === true ? 'deleted' : 'open';
      if (args.p_deleted === true && args.p_open === true) { send({ ok: false, err: 'bad', what: 'deleted' }); return; }
      c.page[list] = args.p_before_id ? (c.page[list] || 0) + 1 : 1;
      const key = 'mj_my_rooms:' + list + ':' + c.page[list];
      LOG.push({ dev, fn, list, page: c.page[list], key, t: Date.now() });
      const k = c.by[key] || c.by['mj_my_rooms:' + list] || {};
      if (k.hold) await k.hold;
      if (k.delayMs) await sleep(k.delayMs);
      if (k.force && k.force.length) { const x = k.force.shift(); if (x && x.__http !== undefined) { send({ data: null, error: { message: 'upstream' } }, x.__http); return; } send(x); return; }
      send(myRoomsOf(uid, args, list)); return;
    }
    if (fn === 'mj_read') { LOG.push({ dev, fn, t: Date.now() }); if (c.readHold) await c.readHold; send(mjRead(uid, args)); return; }
    if (fn === 'mj_write') {
      const e = { dev, fn, op_id: args.p_op_id, ops: args.p_ops.map((o) => o.op), t: Date.now() }; LOG.push(e);
      if (c.delayOp && e.ops.includes(c.delayOp.op)) await sleep(c.delayOp.ms);
      if (c.force.length) { const x = c.force.shift(); e.res = x; if (x.__http) { send({ data: null, error: { message: 'upstream' } }, x.__http); return; } send(x); e.done = Date.now(); return; }
      e.res = mjWrite(uid, args);
      if (c.lose && e.ops.includes('room_delete')) { c.lose = false; send({ data: null, error: { message: 'lost' } }, 500); return; }
      send(e.res); e.done = Date.now(); return;
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
  if (mutate && mutate.file && f.replace(/\\/g, '/').endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); if (mutate.also) { for (const [x, y] of (Array.isArray(mutate.also[0]) ? mutate.also : [mutate.also])) { if (!b.includes(x)) { console.log('✗ 壊しの字が無い ' + x); process.exit(2); } b = b.replace(x, y); } } }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); } };
  DB.clear(); LOG.length = 0; LW = 1; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = []; let lastPg = null;
  const device = async (dev, uid, seedLs) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, s]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs || {}]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 15000); lastPg = pg;
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    return { pg, ctx };
  };
  const rowOf = (rid, uid, at, extra = {}) => { const R = DB.get(rid); return { room_id: rid, kind: R.kind, name: R.name, role: 'kan', ...(R.owner === uid ? { owner: true } : {}), rules: RULES, ...(R.kind === 'shared' ? { channel_key: R.channel_key } : {}), at, ...extra }; };
  const KEY = (uid, rid) => 'mj-room:' + uid + ':' + rid, OUT = (uid, rid) => 'mj-outbox:' + uid + ':' + rid, PDEL = (uid, rid) => 'mj-pending-delete:' + uid + ':' + rid;
  const seedOf = (uid, rows, more = {}) => { const o = { ['mj-rooms:' + uid]: rows, ...more }; for (const x of rows) { o['mj-synced:' + uid + ':' + x.room_id] = '1'; if (!(KEY(uid, x.room_id) in o)) o[KEY(uid, x.room_id)] = clone(DB.get(x.room_id).st); } return o; };
  const openR = async (pg, rid, q = '') => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}${q}`); };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const lsRaw = (pg, k) => pg.evaluate((x) => localStorage.getItem(x), k);
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const delW = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write' && x.ops.includes('room_delete'));
  const waitFor = async (fn, ms, step = 50) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const path_ = (pg) => new URL(pg.url()).pathname;
  const atHome = (pg) => ['/', '/index.html'].includes(path_(pg));
  const waitHome = (pg) => pg.waitForURL((u) => ['/', '/index.html'].includes(u.pathname), { timeout: SELF ? 5000 : 10000 }).catch(() => {});
  const home = async (pg) => { await pg.waitForSelector('#btnOut'); await sleep(400); return pg.evaluate(() => { const b = document.getElementById('tsuzuki'); const cs = [...b.querySelectorAll('.h-cont')]; return { hidden: b.hidden || !cs.length, cards: cs.map((c) => c.dataset.rid), href: cs[0] ? cs[0].getAttribute('href') : null, name: cs[0] ? (cs[0].querySelector('.h-r') || {}).textContent : null, fb: !document.getElementById('hBand').hidden, homeBand: !!document.querySelector('#hDel, .h-del, [data-undo]') }; }); };
  // A27 §4：消した部屋の行＝taikyoku.html（部屋を作る・入る）の一番下 #tModosu
  const modosuNow = (pg) => pg.evaluate(() => { const d = document.getElementById('tModosu'); const sec = d ? d.querySelector('.sec') : null; return { shown: !!d && !d.hidden, sec: sec ? sec.textContent : null, bands: d && !d.hidden ? [...d.querySelectorAll('.h-del')].map((x) => ({ rid: x.dataset.rid, t: (x.querySelector('.h-del-t') || {}).textContent, e: (x.querySelector('.h-del-e') || {}).textContent || null })) : [] }; });
  const modosu = async (pg) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html`); await pg.waitForFunction(() => { const v = document.getElementById('vChoose'); return v && !v.hidden; }); await sleep(500); return modosuNow(pg); };
  const onModosu = (pg) => path_(pg) === '/taikyoku.html' && !new URL(pg.url()).searchParams.get('room');
  const rulesPage = async (pg) => { await pg.waitForFunction(() => { const r = document.getElementById('barR'); return r && !r.hidden && r.textContent === 'ルール'; }); await pg.click('#barR'); await pg.waitForSelector('#rRules'); await sleep(200); };
  const goHomePage = async (pg) => { await pg.goto(`http://127.0.0.1:${port}/index.html`); return home(pg); };
  const roomReady = async (pg) => { await pg.waitForSelector('#vRoom .r-top'); await sleep(400); };
  const delNow = async (pg) => { if (!(await has(pg, '#rRules'))) await rulesPage(pg); await pg.click('#rDelRoom'); await pg.waitForSelector('#rDelGo'); await pg.click('#rDelGo'); };
  const undoAt = async (pg, rid) => { if (!onModosu(pg)) await modosu(pg); await pg.click('#tModosu [data-undo="' + rid + '"]'); await sleep(400); return modosuNow(pg); };
  const PM = (m, a = 1) => '#vRoom .r-pm[data-m="' + m + '"][data-k="chip"][data-a="' + a + '"]';
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const step = async (k, f) => { if (!want(k)) return; DB.clear(); LW = 1; for (const x of Object.keys(CTL)) delete CTL[x]; try { await f(); } catch (e) { fail++; let pv = ''; if (process.env.DBG && lastPg) pv = '  頁=' + (await lastPg.evaluate(() => location.pathname + ' ' + document.body.innerText.slice(0, 400)).catch(() => '?')); bad.push('止まった(' + k + '): ' + String(e.message || e).split('\n')[0].slice(0, 300) + pv); } };
  try {
    const DELQ = '部屋を消すと、入っていた人も誰も開けなくなります。7日の間は、ホームの［対局］（部屋を作る・入る）の一番下から戻せます。'; // a27_sadame §2（止め2）
    // 一番下＝見える物の一番下（KPSP の鍵盤の下の空き .kp-sp は釦より下に置く・鍵盤を閉じている間は hidden＝数えない）
    const isLast = (pg, sel) => pg.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; let l = b.parentElement.lastElementChild; while (l && l !== b && l.classList.contains('kp-sp') && l.hidden) l = l.previousElementSibling; return l === b; }, sel);
    await step('D1', async () => {
      mkRoom('d1');
      const A = await device('A1', 'u1', seedOf('u1', [rowOf('d1', 'u1', 9)]));
      await openR(A.pg, 'd1'); await roomReady(A.pg);
      ok('D1 部屋の頁に［部屋を消す］が無い（A27 §2）', !(await has(A.pg, '#rDelBox')) && !(await has(A.pg, '#rDelRoom')));
      ok('D1 部屋の頁の一番下は［対局終了］#rEnd（A27 §1）', (await isLast(A.pg, '#rEnd')) && (await txt(A.pg, '#rEnd')) === '対局終了', await A.pg.evaluate(() => { const b = document.getElementById('rEnd'); return b ? b.parentElement.lastElementChild.id : null; }));
      await rulesPage(A.pg);
      ok('D1 持ち主にルールの頁の #rDelBox が在る（頁の一番下）', (await has(A.pg, '#rDelBox #rDelRoom')) && (await isLast(A.pg, '#rDelBox')));
      await A.pg.click('#rDelRoom'); await A.pg.waitForSelector('#rDelQ');
      if (process.env.SHOT) { const el = await A.pg.$("#rDelBox"); if (el) await el.scrollIntoViewIfNeeded(); await A.pg.screenshot({ path: require("path").join(process.env.SHOT, "a27_kesu_" + (CHROMIUM ? "cr" : "wk") + ".png") }); }
      ok('D1 2段目の字（§2 の字のまま）・［やめる］が在る', (await txt(A.pg, '#rDelQ')) === DELQ && (await has(A.pg, '#rDelNo')) && !(await has(A.pg, '#rDelUnsent')), await txt(A.pg, '#rDelQ'));
      await A.pg.click('#rDelNo'); await sleep(100);
      ok('D1 ［やめる］で1段目に戻る', (await has(A.pg, '#rDelRoom')) && !(await has(A.pg, '#rDelQ')));
      await delNow(A.pg); await waitHome(A.pg);
      ok('D1 消すと URL が /', atHome(A.pg), A.pg.url());
      ok('D1 倉庫の deleted_at が在る', !!DB.get('d1').deleted_at);
      const h = await home(A.pg);
      ok('D1 ホーム＝カードが無い・帯を出さない（A27 §3）', h.hidden === true && h.homeBand === false, h);
      ok('D1 消す印が残っていない', (await lsRaw(A.pg, PDEL('u1', 'd1'))) === null);
      const m = await modosu(A.pg);
      ok('D1 対局の頁の一番下に見出しと行1つ「「対局」を消しました」', m.shown && m.sec === '消した部屋（7日の間は戻せます）' && m.bands.length === 1 && m.bands[0].t === '「対局」を消しました' && (await isLast(A.pg, '#tModosu')), m);
      const m2 = await undoAt(A.pg, 'd1');
      ok('D1 戻す→倉庫の deleted_at が空・行が消えて見出しごと出ない', DB.get('d1').deleted_at === null && m2.bands.length === 0 && m2.shown === false, m2);
      const h2 = await goHomePage(A.pg);
      ok('D1 戻す→ホームにカードが戻る', !h2.hidden && (h2.href || '').includes('room=d1'), h2);
    });

    await step('D2', async () => {
      mkRoom('d2', { kind: 'shared', owner: 'u9' });
      const A = await device('A2', 'u1', seedOf('u1', [rowOf('d2', 'u1', 9)]));
      await openR(A.pg, 'd2'); await roomReady(A.pg); await sleep(300); await rulesPage(A.pg);
      ok('D2 持ち主でない（owner:false）＝ルールの頁に箱が無い', (await has(A.pg, '#rRules')) && !(await has(A.pg, '#rDelBox')));
      mkRoom('d2b', { kind: 'shared', owner: 'u9' });
      const B = await device('B2', 'u1', seedOf('u1', [{ ...rowOf('d2b', 'u1', 9), owner: true }]));
      await openR(B.pg, 'd2b'); await roomReady(B.pg); await sleep(300); await rulesPage(B.pg);
      ok('D2 控えの owner:true も読んだ false で外れる', (await has(B.pg, '#rRules')) && !(await has(B.pg, '#rDelBox')), await ls(B.pg, 'mj-rooms:u1'));
      mkRoom('d2l', { kind: 'shared', owner: 'u1' });
      const C = await device('C2', 'u1', seedOf('u1', [rowOf('d2l', 'u1', 9)]));
      await openR(C.pg, 'd2l', '&league=L1'); await roomReady(C.pg); await sleep(300); await rulesPage(C.pg);
      ok('D2 リーグの対局＝ルールの頁に箱が無い', (await has(C.pg, '#rRules')) && !(await has(C.pg, '#rDelBox')));
    });

    await step('D3', async () => {
      mkRoom('d3');
      const out = [{ op_id: 'held-1', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }], held: { err: 'conflict' } }];
      const A = await device('A3', 'u1', seedOf('u1', [rowOf('d3', 'u1', 9)], { [OUT('u1', 'd3')]: out }));
      await openR(A.pg, 'd3'); await roomReady(A.pg); await rulesPage(A.pg);
      await A.pg.click('#rDelRoom'); await A.pg.waitForSelector('#rDelQ');
      ok('D3 2段目に「1組も消えます」', /まだ送れていない点 1組も消えます/.test((await txt(A.pg, '#rDelUnsent')) || ''), await txt(A.pg, '#rDelBox'));
      await A.pg.click('#rDelGo'); await waitHome(A.pg);
      ok('D3 消すと /', atHome(A.pg), A.pg.url());
      ok('D3 並びの鍵が無い', (await lsRaw(A.pg, OUT('u1', 'd3'))) === null, await lsRaw(A.pg, OUT('u1', 'd3')));
      const h = await home(A.pg);
      ok('D3 ホームにカードが無い（未送信のカードも出ない）・帯も無い', h.hidden === true && h.homeBand === false, h);
    });

    await step('D4', async () => {
      mkRoom('d4');
      const A = await device('A4', 'u1', seedOf('u1', [rowOf('d4', 'u1', 9)]));
      await openR(A.pg, 'd4'); await roomReady(A.pg);
      ctl('A4').force = [{ ok: false, err: 'mj_reauth', within_min: 10 }];
      await delNow(A.pg);
      await waitFor(async () => (await A.pg.evaluate(() => window.__login || 0)) > 0, 4000);
      ok('D4 mj_reauth→ログインし直しを出す・字', (await A.pg.evaluate(() => window.__login || 0)) === 1 && /パスワードでもう一度ログイン/.test((await txt(A.pg, '#rDelMsg')) || ''), await txt(A.pg, '#rDelBox'));
      ok('D4 印が残る', !!(await lsRaw(A.pg, PDEL('u1', 'd4'))));
      await A.pg.evaluate(() => window.__loginCb({ id: 'u1' }));
      await waitHome(A.pg);
      const w = delW('A4');
      ok('D4 入り直したら同じ op_id で送り直し→/', atHome(A.pg) && w.length === 2 && w[0].op_id === w[1].op_id, w.map((x) => x.op_id));
    });

    await step('D5', async () => {
      mkRoom('d5');
      const A = await device('A5', 'u1', seedOf('u1', [rowOf('d5', 'u1', 9)]));
      await openR(A.pg, 'd5'); await roomReady(A.pg);
      ctl('A5').force = [{ __http: 500 }];
      await delNow(A.pg);
      await A.pg.waitForSelector('#rDelRetry');
      ok('D5 網の失敗→［もう一度］・［やめる］は無い', (await has(A.pg, '#rDelRetry')) && !(await has(A.pg, '#rDelNo')) && !!(await lsRaw(A.pg, PDEL('u1', 'd5'))));
      await A.pg.click('#rDelRetry'); await waitHome(A.pg);
      const w = delW('A5');
      ok('D5 ［もう一度］は同じ op_id→/', atHome(A.pg) && w.length === 2 && w[0].op_id === w[1].op_id, w.map((x) => x.op_id));
    });

    await step('D6', async () => {
      mkRoom('d6');
      const A = await device('A6', 'u1', seedOf('u1', [rowOf('d6', 'u1', 9)], { [PDEL('u1', 'd6')]: 'op-d6-held' }));
      await openR(A.pg, 'd6'); await roomReady(A.pg); await sleep(600);
      ok('D6 印が在っても部屋の頁には箱を出さない', !(await has(A.pg, '#rDelBox')));
      await rulesPage(A.pg);
      ok('D6 印が在る＝ルールの頁で2段目が開いて［もう一度］・［やめる］無し', (await has(A.pg, '#rDelQ')) && (await has(A.pg, '#rDelRetry')) && !(await has(A.pg, '#rDelNo')), await txt(A.pg, '#rDelBox'));
      ok('D6 自動では送らない', delW('A6').length === 0);
      await A.pg.click('#rDelRetry'); await waitHome(A.pg);
      const w = delW('A6');
      ok('D6 ［もう一度］は印の op_id', atHome(A.pg) && w.length === 1 && w[0].op_id === 'op-d6-held', w.map((x) => x.op_id));
    });

    await step('D7', async () => {
      mkRoom('d7', { kind: 'shared', owner: 'u1' });
      DB.get('d7').deleted_at = NOW();
      const B = await device('B7', 'u2', seedOf('u2', [rowOf('d7', 'u2', 9)]));
      await openR(B.pg, 'd7'); await B.pg.waitForSelector('#rGone');
      const row = ((await ls(B.pg, 'mj-rooms:u2')) || []).find((x) => x.room_id === 'd7');
      ok('D7 他の人＝帯 #rGone・控えに gone:true・deleted_at 無し', row && row.gone === true && !row.deleted_at, row);
      ok('D7 他の人には箱が無い', !(await has(B.pg, '#rDelBox')));
      const h = await goHomePage(B.pg);
      ok('D7 ホームにカードも帯も無い', h.hidden === true && h.homeBand === false, h);
      const mb = await modosu(B.pg);
      ok('D7 他の人の対局の頁に戻す行は無い', mb.bands.length === 0 && mb.shown === false, mb);
      ctl('B7').by['mj_my_rooms:open'] = { force: [{ __http: 0 }] }; // 11-26 --self：カードの読みを切った控えでも gone の部屋は出ない
      const hf = await goHomePage(B.pg);
      ok('D7 控え（読めない）でも gone の部屋のカードは出ない', hf.fb === true && !hf.cards.includes('d7'), hf);
    });

    await step('D8', async () => {
      mkRoom('d8', { kind: 'shared', owner: 'u1' });
      const row = { ...rowOf('d8', 'u1', 9) }; delete row.owner;
      const A = await device('A8', 'u1', seedOf('u1', [row]));
      await openR(A.pg, 'd8'); await roomReady(A.pg); await rulesPage(A.pg);
      await waitFor(() => has(A.pg, '#rDelRoom'), 3000);
      ok('D8 持ち主の2台目（控えに owner 無し）＝読んだ後にルールの頁に箱が出る', await has(A.pg, '#rDelRoom'));
      const r2 = ((await ls(A.pg, 'mj-rooms:u1')) || [])[0];
      ok('D8 控えに owner:true', r2 && r2.owner === true, r2);
    });

    await step('D9', async () => {
      mkRoom('d9');
      const A = await device('A9', 'u1', seedOf('u1', [rowOf('d9', 'u1', 9)]));
      await openR(A.pg, 'd9'); await roomReady(A.pg);
      ctl('A9').lose = true;
      await delNow(A.pg);
      await A.pg.waitForSelector('#rDelRetry');
      ok('D9 倉庫では消えた・端末は［もう一度］', !!DB.get('d9').deleted_at && !atHome(A.pg));
      await openR(A.pg, 'd9'); await waitHome(A.pg);
      ok('D9 開き直す→gone→印が在る＝片付けて /', atHome(A.pg), A.pg.url());
      ok('D9 印が消えた', (await lsRaw(A.pg, PDEL('u1', 'd9'))) === null);
      const h = await home(A.pg);
      ok('D9 カード無し・ホームに帯無し', h.hidden === true && h.homeBand === false, h);
      const m = await modosu(A.pg);
      ok('D9 対局の頁に行が1つ', m.bands.length === 1 && m.bands[0].rid === 'd9', m);
    });

    await step('D9', async () => {
      mkRoom('d9b');
      const A = await device('A9b', 'u1', seedOf('u1', [rowOf('d9b', 'u1', 9)]));
      await openR(A.pg, 'd9b'); await roomReady(A.pg); await rulesPage(A.pg);
      DB.get('d9b').deleted_at = NOW(); // 持ち主の別の端末で先に消した
      await delNow(A.pg); await waitHome(A.pg);
      ok('D9 消す返しが gone＝もう消えている＝通ったと見て /', atHome(A.pg) && delW('A9b').length === 1, [A.pg.url(), await txt(A.pg, '#rDelBox')]);
      if (atHome(A.pg)) { const m = await modosu(A.pg); ok('D9 gone の後も対局の頁に行が1つ', m.bands.length === 1 && m.bands[0].rid === 'd9b', m); }
    });

    await step('D10', async () => {
      mkRoom('d10a', { kind: 'shared', name: '前の会' }); mkRoom('d10b', { kind: 'shared', name: '後の会' });
      const A = await device('A10', 'u1', seedOf('u1', [rowOf('d10a', 'u1', 9), rowOf('d10b', 'u1', 8)]));
      await openR(A.pg, 'd10a'); await roomReady(A.pg); await rulesPage(A.pg);
      ok('D10 shared＝［部屋を消す］は［部屋を終える］の下（頁の一番下）', (await A.pg.evaluate(() => { const c = document.getElementById('rCloseBox'); const d = document.getElementById('rDelBox'); return !!c && !!d && !!(c.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING); })) && (await isLast(A.pg, '#rDelBox')));
      await delNow(A.pg); await waitHome(A.pg);
      await sleep(30);
      await openR(A.pg, 'd10b'); await roomReady(A.pg); await delNow(A.pg); await waitHome(A.pg);
      const h = await home(A.pg);
      ok('D10 ホームにカード無し・帯無し', h.hidden === true && h.homeBand === false, h);
      const m = await modosu(A.pg);
      if (process.env.SHOT) { const el = await A.pg.$("#tModosu"); if (el) await el.scrollIntoViewIfNeeded(); await A.pg.screenshot({ path: require("path").join(process.env.SHOT, "a27_modosu_" + (CHROMIUM ? "cr" : "wk") + ".png") }); }
      ok('D10 行2つ・新しい順（後に消した方が上）', m.bands.length === 2 && m.bands[0].rid === 'd10b' && m.bands[1].rid === 'd10a', m);
      // 11-26 --self：戻した後の読みを切る（対局の頁の読み直し1回＋ホームの消した一覧1回＝2回・カードの読み1回）＝控えの印を戻す時に外していなければカードが出ない
      ctl('A10').by['mj_my_rooms:open'] = { force: [{ __http: 0 }] }; ctl('A10').by['mj_my_rooms:deleted'] = { force: [{ __http: 0 }, { __http: 0 }] };
      const m2 = await undoAt(A.pg, 'd10a');
      ok('D10 古い方を戻す→もう1つの行は残る・倉庫', m2.bands.length === 1 && m2.bands[0].rid === 'd10b' && DB.get('d10a').deleted_at === null && !!DB.get('d10b').deleted_at, m2);
      const r10 = ((await ls(A.pg, 'mj-rooms:u1')) || []).find((x) => x.room_id === 'd10a') || {};
      const h2 = await goHomePage(A.pg);
      ok('D10 戻したら控えの印が外れる（読めなくても控えからカード）', !r10.deleted_at && r10.gone !== true && h2.fb === true && h2.cards.includes('d10a') && (h2.href || '').includes('room=d10a'), [r10, h2]);
    });

    await step('D11', async () => {
      mkRoom('d11', { kind: 'shared' });
      const A = await device('A11', 'u1', seedOf('u1', [rowOf('d11', 'u1', 9)]));
      await openR(A.pg, 'd11'); await roomReady(A.pg); await delNow(A.pg); await waitHome(A.pg);
      await A.pg.goBack().catch(() => {}); await sleep(300);
      await openR(A.pg, 'd11'); await A.pg.waitForSelector('#rGone');
      const row = ((await ls(A.pg, 'mj-rooms:u1')) || []).find((x) => x.room_id === 'd11');
      ok('D11 消した端末で開き直す（gone）＝gone を足さない', row && row.gone !== true && !!row.deleted_at, row);
      const m = await modosu(A.pg);
      ok('D11 対局の頁に行が残る', m.bands.length === 1 && m.bands[0].rid === 'd11', m);
      await undoAt(A.pg, 'd11');
      const h2 = await goHomePage(A.pg);
      ok('D11 戻す→カードが戻る', !h2.hidden && (h2.href || '').includes('room=d11'), h2);
    });

    await step('D12', async () => {
      mkRoom('d12', { kind: 'shared', owner: 'u1' });
      DB.get('d12').deleted_at = NOW();
      const B = await device('B12', 'u2', seedOf('u2', [rowOf('d12', 'u2', 9)]));
      await openR(B.pg, 'd12'); await B.pg.waitForSelector('#rGone');
      const h = await goHomePage(B.pg);
      ok('D12 他の人の端末＝カードが消える', h.hidden === true, h);
      DB.get('d12').deleted_at = null; // 持ち主が戻した
      await openR(B.pg, 'd12'); await roomReady(B.pg); await sleep(300);
      const row = ((await ls(B.pg, 'mj-rooms:u2')) || []).find((x) => x.room_id === 'd12');
      ok('D12 読めた＝gone が外れる', row && row.gone === false, row);
      const h2 = await goHomePage(B.pg);
      ok('D12 カードが戻る', !h2.hidden && (h2.href || '').includes('room=d12'), h2);
    });

    await step('D13', async () => {
      mkRoom('d13');
      const A = await device('A13', 'u1', seedOf('u1', [rowOf('d13', 'u1', 9)]));
      await openR(A.pg, 'd13'); await roomReady(A.pg);
      ctl('A13').delayOp = { op: 'extra_add', ms: 1500 };
      await A.pg.click(PM('m1', 1));
      await sleep(500); // まとめ 0.3秒が流れて送りの最中
      await A.pg.click(PM('m2', 1)); // 2つ目を押してすぐルールの頁で消す（ルールの頁は出す時にまとめを流す＝送りの最中の並びに積まれる）
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rDelRoom'); await A.pg.click('#rDelRoom'); await A.pg.waitForSelector('#rDelGo');
      await A.pg.click('#rDelGo'); await waitHome(A.pg);
      await sleep(2000);
      const raw = await lsRaw(A.pg, OUT('u1', 'd13'));
      ok('D13 送りの最中に消しても並びの鍵は空のまま', raw === null || raw === '[]', raw);
      const h = await home(A.pg);
      ok('D13 ホームにカードが無い', h.hidden === true, h);
    });

    await step('D14', async () => {
      mkRoom('d14', { kind: 'shared', closed: true });
      const out = [{ op_id: 'c-1', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }] }];
      const A = await device('A14', 'u1', seedOf('u1', [rowOf('d14', 'u1', 9)], { [OUT('u1', 'd14')]: out }));
      await openR(A.pg, 'd14'); await roomReady(A.pg);
      await waitFor(async () => { const r = ((await ls(A.pg, 'mj-rooms:u1')) || [])[0]; return r && r.closed === true; }, 4000);
      await sleep(500);
      ok('D14 終えた部屋の頁に［対局終了］#rEnd は出ない（A27 §1）', !(await has(A.pg, '#rEnd')));
      await rulesPage(A.pg);
      const r = ((await ls(A.pg, 'mj-rooms:u1')) || [])[0];
      ok('D14 closed の返しの後も owner が残りルールの頁に箱が在る', r && r.closed === true && r.owner === true && (await has(A.pg, '#rDelRoom')), [r, await has(A.pg, '#rDelRoom')]);
    });

    // ===== A27 §1：部屋の頁の一番下の［対局終了］#rEnd =====
    const snapW = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write' && x.ops.includes('settle_snap'));
    await step('E1', async () => {
      mkRoom('e1');
      const A = await device('E1A', 'u1', seedOf('u1', [rowOf('e1', 'u1', 9)]));
      await openR(A.pg, 'e1'); await roomReady(A.pg);
      ok('E1 #rEnd が在って押せる', (await has(A.pg, '#rEnd')) && !(await A.pg.$eval('#rEnd', (b) => b.disabled)));
      await A.pg.click('#rEnd'); await waitHome(A.pg);
      ok('E1 入っていない物 0＝そのまま締めて（settle_snap 1回）ホームへ（精算の頁の［対局終了］と同じ道）', atHome(A.pg) && snapW('E1A').length === 1, [A.pg.url(), snapW('E1A').length, await txt(A.pg, 'main')]);
    });
    const unloadedSeed = (rid) => { const o = seedOf('u1', [rowOf(rid, 'u1', 9)]); o[KEY('u1', rid)] = { ...clone(DB.get(rid).st), loaded: [] }; return o; };
    await step('E3', async () => {
      mkRoom('e3');
      let go; ctl('E3A').readHold = new Promise((s) => { go = s; }); // 倉庫の読みを止める＝写しは開催を読んでいない（unloaded）
      const A = await device('E3A', 'u1', unloadedSeed('e3'));
      await openR(A.pg, 'e3'); await roomReady(A.pg);
      await A.pg.click('#rEnd'); await A.pg.waitForSelector('#sLoading');
      await A.pg.click('#barBack'); await A.pg.waitForSelector('#rSeisan');
      ctl('E3A').readHold = null; go(); await sleep(1200);
      await A.pg.click('#rSeisan'); await A.pg.waitForSelector('#sClose'); await sleep(800);
      ok('E3 ［対局終了］→読み込み中→戻る→［精算を見る］＝締めない（settle_snap 0・精算の頁に残る）', snapW('E3A').length === 0 && !atHome(A.pg) && (await has(A.pg, '#sClose')), [snapW('E3A').length, A.pg.url()]);
    });
    await step('E4', async () => {
      mkRoom('e4');
      let go; ctl('E4A').readHold = new Promise((s) => { go = s; });
      const A = await device('E4A', 'u1', unloadedSeed('e4'));
      await openR(A.pg, 'e4'); await roomReady(A.pg);
      await A.pg.click('#rEnd'); await A.pg.waitForSelector('#sLoading');
      ctl('E4A').readHold = null; go();
      await A.pg.waitForSelector('#sClose'); await sleep(800);
      ok('E4 ［対局終了］→読み込み中→読めて同じ頁を描き直す＝締めない（印は読み込み中の頁で落ちる・a27 止め1）', snapW('E4A').length === 0 && !atHome(A.pg), [snapW('E4A').length, A.pg.url()]);
    });

    // ===== v1.4.3（帯は倉庫の消した一覧から）＝A27 で taikyoku.html の #tModosu へ =====
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    const D_ = 24 * 3600e3;
    await step('V1', async () => {
      mkRoom('v1');
      const A = await device('V1A', 'u1', seedOf('u1', [rowOf('v1', 'u1', 9)]));
      await openR(A.pg, 'v1'); await roomReady(A.pg); await delNow(A.pg); await waitHome(A.pg);
      const h = await home(A.pg); const ma = await modosu(A.pg);
      ok('V1 A：カード無し・ホームに帯無し・対局の頁に行1つ', h.hidden && h.homeBand === false && ma.bands.length === 1 && ma.bands[0].rid === 'v1', [h, ma]);
      const B = await device('V1B', 'u1', {});
      const mb = await modosu(B.pg);
      ok('V1 B（同じログイン・控え無し）：倉庫から行1つ', mb.bands.length === 1 && mb.bands[0].rid === 'v1' && mb.bands[0].t === '「対局」を消しました', mb);
      const mb2 = await undoAt(B.pg, 'v1');
      const hb2 = await goHomePage(B.pg);
      ok('V1 B で戻す→倉庫の deleted_at 空・B にカード・行無し', DB.get('v1').deleted_at === null && hb2.cards.includes('v1') && mb2.bands.length === 0, [mb2, hb2]);
      const ha = await goHomePage(A.pg);
      ok('V1 A を開き直す→カードが戻る・控えの印が外れた', ha.cards.includes('v1') && !(((await ls(A.pg, 'mj-rooms:u1')) || []).find((x) => x.room_id === 'v1') || {}).deleted_at, ha);
      const ma2 = await modosu(A.pg);
      ok('V1 A の対局の頁に行無し', ma2.bands.length === 0, ma2);
    });
    await step('V2', async () => {
      mkRoom('v2');
      const out = [{ op_id: 'v2-1', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }] }];
      const B = await device('V2B', 'u1', seedOf('u1', [rowOf('v2', 'u1', 9)], { [OUT('u1', 'v2')]: out }));
      DB.get('v2').deleted_at = ago(60e3); // A が消した
      const h = await goHomePage(B.pg); await sleep(300); const h2 = await home(B.pg);
      const del2 = !!(((await ls(B.pg, 'mj-rooms:u1')) || []).find((x) => x.room_id === 'v2') || {}).deleted_at; // ホームの読みだけで（対局の頁へ行く前に）
      ok('V2 B：送っていない部屋でも頭のカード無し・ホームの読みで控えに deleted_at', !h2.cards.includes('v2') && del2 && h2.homeBand === false, [h, h2, del2]);
      const m = await modosu(B.pg);
      ok('V2 B：対局の頁に行あり', m.bands.length === 1 && m.bands[0].rid === 'v2', m);
    });
    await step('V3', async () => {
      mkRoom('v3', { kind: 'shared', owner: 'u9' }); DB.get('v3').users.add('u1');
      DB.get('v3').deleted_at = ago(60e3);
      const M = await device('V3M', 'u1', seedOf('u1', [rowOf('v3', 'u1', 9)]));
      const m = await modosu(M.pg);
      ok('V3 持ち主でない人：行無し', m.bands.length === 0, m);
    });
    await step('V5', async () => {
      for (let i = 0; i < 51; i++) { const id = 'v5-' + String(i).padStart(2, '0'); mkRoom(id); DB.get(id).deleted_at = ago((i + 1) * 60e3); }
      const B = await device('V5B', 'u1', {});
      await modosu(B.pg); await waitFor(async () => (await modosuNow(B.pg)).bands.length === 51, 5000);
      const m2 = await modosuNow(B.pg); const ids = m2.bands.map((x) => x.rid);
      ok('V5 51部屋＝行51・重なり無し・新しい順', ids.length === 51 && new Set(ids).size === 51 && ids[0] === 'v5-00' && ids[50] === 'v5-50', ids.slice(0, 3).concat(ids.slice(-2), [ids.length]));
      ok('V5 頁は2回（50＋1）', LOG.filter((x) => x.dev === 'V5B' && x.list === 'deleted').length >= 2);
      mkRoom('v5x'); mkRoom('v5y', { closed: true });
      const C = await device('V5C', 'u1', seedOf('u1', [rowOf('v5-00', 'u1', 9), rowOf('v5y', 'u1', 8, { deleted_at: ago(D_) })]));
      ctl('V5C').by['mj_my_rooms:deleted:2'] = { force: [{ __http: 0 }] };
      const mc = await modosu(C.pg); await sleep(300); const mc2 = await modosuNow(C.pg);
      const rows = (await ls(C.pg, 'mj-rooms:u1')) || [];
      ok('V5 2頁目が読めない→控えの行だけ（v5y）・1頁目の印は書かない', mc2.bands.length === 1 && mc2.bands[0].rid === 'v5y' && !(rows.find((x) => x.room_id === 'v5-00') || {}).deleted_at, [mc, mc2.bands, rows.map((x) => [x.room_id, x.deleted_at || null])]);
    });
    await step('V6', async () => {
      mkRoom('v6');
      const B = await device('V6B', 'u1', seedOf('u1', [rowOf('v6', 'u1', 9, { deleted_at: ago(D_) })]));
      ctl('V6B').by['mj_my_rooms:deleted'] = { force: [{ __http: 0 }] };
      const m = await modosu(B.pg);
      ok('V6 消した一覧が読めない→控えの行', m.bands.length === 1 && m.bands[0].rid === 'v6', m);
      DB.get('v6').deleted_at = ago(D_);
      const m2 = await modosu(B.pg);
      ok('V6 読めた→倉庫の行', m2.bands.length === 1 && m2.bands[0].rid === 'v6', m2);
    });
    await step('V7', async () => {
      mkRoom('v7'); DB.get('v7').deleted_at = ago(8 * D_); // 掃除前の期限切れ（倉庫の一覧に無い）
      mkRoom('v7c', { closed: true }); // 他の端末で戻した閉じた部屋
      const out = [{ op_id: 'v7-1', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }] }];
      const B = await device('V7B', 'u1', seedOf('u1', [rowOf('v7', 'u1', 9, { deleted_at: ago(7 * D_ + 60e3) }), rowOf('v7c', 'u1', 8, { deleted_at: ago(2 * D_) })], { [OUT('u1', 'v7c')]: out }));
      const h = await goHomePage(B.pg); await sleep(300); const h2 = await home(B.pg);
      const rows = (await ls(B.pg, 'mj-rooms:u1')) || []; const r7 = rows.find((x) => x.room_id === 'v7') || {}, r7c = rows.find((x) => x.room_id === 'v7c') || {};
      const m = await modosu(B.pg);
      ok('V7 期限切れ＝gone:true・deleted_at 残す・行無し', r7.gone === true && !!r7.deleted_at && m.bands.length === 0, [r7, m.bands]);
      ok('V7 2日前で一覧に無い（他で戻した閉じた部屋）＝印を外す・送っていないカードが頭に戻る', !r7c.deleted_at && h2.cards.includes('v7c'), [r7c, h2.cards, h]);
      ctl('V7B').by['mj_my_rooms:open'] = { force: [{ __http: 0 }] };
      const h3 = await goHomePage(B.pg); await sleep(300); const h4 = await home(B.pg);
      ok('V7 カードが読めない（控え）でも期限切れの部屋はカードに出ない', h4.fb === true && !h4.cards.includes('v7'), [h3, h4]);
    });
    await step('V8', async () => {
      mkRoom('v8');
      const out = [{ op_id: 'v8-1', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1, follow: true }] }];
      const B = await device('V8B', 'u1', seedOf('u1', [rowOf('v8', 'u1', 9)], { [OUT('u1', 'v8')]: out }));
      DB.get('v8').deleted_at = ago(60e3);
      ctl('V8B').by['mj_my_rooms:deleted:1'] = { delayMs: 3000 };
      await B.pg.goto(`http://127.0.0.1:${port}/index.html`); await B.pg.waitForSelector('#btnOut');
      await waitFor(async () => (await B.pg.$('#tsuzuki .h-cont')) !== null, 1200);
      const early = await home(B.pg);
      await sleep(3200); const late = await home(B.pg);
      ok('V8 カードが先に出た（送っていない頭のカード）', early.cards.includes('v8'), early);
      ok('V8 消した一覧の読みの後に頭のカードが消える・ホームに帯は出さない', !late.cards.includes('v8') && late.homeBand === false, late);
    });
    await step('V9', async () => {
      mkRoom('v9'); mkRoom('v9o');
      DB.get('v9').deleted_at = ago(2 * 60e3); DB.get('v9o').deleted_at = ago(60e3);
      const B = await device('V9B', 'u1', {});
      const m = await modosu(B.pg);
      ok('V9a 行2つ', m.bands.length === 2, m);
      DB.get('v9').deleted_at = ago(8 * D_); // 7日の境を越えた
      ctl('V9B').force = [{ ok: false, err: 'gone' }];
      const nMy = () => LOG.filter((x) => x.dev === 'V9B' && x.fn === 'mj_my_rooms').length; const n0 = nMy();
      const m2 = await undoAt(B.pg, 'v9');
      ok('V9a 戻せない時は描き直さない（倉庫を読み直さない・定め §2 no draw()）', nMy() === n0, [n0, nMy()]);
      ok('V9a 戻せない→行と「戻せませんでした」が残る', m2.bands.some((x) => x.rid === 'v9' && /戻せませんでした/.test(x.e || '')), m2);
      const m3 = await undoAt(B.pg, 'v9o'); await sleep(300); const m4 = await modosuNow(B.pg);
      const h4 = await goHomePage(B.pg);
      ok('V9a 描き直した後（他の部屋を戻した）も v9 の行と字が残る・v9 のカード無し', m4.bands.some((x) => x.rid === 'v9' && /戻せませんでした/.test(x.e || '')) && !h4.cards.includes('v9') && h4.cards.includes('v9o'), [m3, m4, h4]);
      mkRoom('v9n'); mkRoom('v9m');
      const C = await device('V9C', 'u1', seedOf('u1', [rowOf('v9n', 'u1', 9, { deleted_at: ago(2 * 60e3) }), rowOf('v9m', 'u1', 8, { deleted_at: ago(60e3) })]));
      DB.get('v9n').deleted_at = ago(2 * 60e3); DB.get('v9m').deleted_at = ago(60e3);
      ctl('V9C').by['mj_my_rooms:deleted'] = { force: [{ __http: 0 }, { __http: 0 }, { __http: 0 }] };
      const c1 = await modosu(C.pg);
      ok('V9b 網の外＝控えの行2つ', c1.bands.length === 2, c1);
      ok('V9b 控えの行は deleted_at の新しい順（控えの並びに頼らない）', c1.bands.map((x) => x.rid).join() === 'v9m,v9n', c1.bands.map((x) => x.rid));
      ctl('V9C').force = [{ __http: 0 }];
      const c2 = await undoAt(C.pg, 'v9n');
      const c3 = await undoAt(C.pg, 'v9m'); await sleep(300); const c4 = await modosuNow(C.pg);
      ok('V9b 網の失敗の行と字が、描き直した後も残る', c4.bands.some((x) => x.rid === 'v9n' && /戻せませんでした/.test(x.e || '')), [c2, c3, c4]);
    });
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 4).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

const GR = 'js/gamen-room.mjs', GH = 'js/gamen-home.mjs', HM = 'js/heya-modosu.mjs';
const MUT = [
  // A27 §1-2（置き場）
  { file: GR, from: "close + delHtml(); // A27 §2", to: "close; // 壊し", name: 'ルールの頁に箱を出さない', only: 'D1,D8,D14' },
  { file: GR, from: "    el.innerHTML = h;\n    const wrap", to: "    h += delHtml();\n    el.innerHTML = h;\n    const wrap", name: '部屋の頁にも箱を出す（A6 の形）', only: 'D1,D6' },
  { file: GR, from: "h += '<button class=\"btn btn-main\" id=\"rEnd\"'", to: "h += '<button class=\"btn btn-main\" id=\"rEndX\"'", name: '部屋の頁に［対局終了］を出さない', only: 'D1,E1' },
  { file: GR, from: "if (table && v.windows.length && !room.closed && ", to: "if (table && v.windows.length && ", name: '終えた部屋にも［対局終了］を出す', only: 'D14' },
  { file: GR, from: "closeErr = null; endAsk = true; render(); };", to: "closeErr = null; render(); };", name: '［対局終了］が精算を開くだけで締めない', only: 'E1' },
  { file: GR, from: "const ask = endAsk; endAsk = false; // A27", to: "const ask = endAsk; // A27", name: '精算の頁の頭で印を下ろさない（止め1 の前の形）', only: 'E4' },
  { file: GR, from: "const ask = endAsk; endAsk = false; // A27", to: "const ask = endAsk; // A27", also: [["const toRoom = () => { endAsk = false; ", "const toRoom = () => { "], ["    if (page !== 'seisan') endAsk = false;", "    //"]], name: '印を一度も下ろさない', only: 'E3' },
  { file: GR, from: "7日の間は、ホームの［対局］（部屋を作る・入る）の一番下から戻せます。", to: "7日の間はホームから戻せます。", name: '2段目の字が古い（止め2 の前）', only: 'D1' },
  // A6（そのまま）
  { file: GR, from: "    if (typeof r.owner === 'boolean' && r.owner !== (room.owner === true)) patch.owner = r.owner;", to: '', name: 'roomInfo が owner を写さない', only: 'D2,D8' },
  { file: GR, from: "function canDel() { return !LG && ", to: 'function canDel() { return ', name: 'リーグの対局にも箱を出す', only: 'D2' },
  { file: GR, from: "    if (delOn()) { delDone(); return; } // A6", to: '    // 壊し', name: 'goneStop が印を見ない', only: 'D9' },
  { file: GR, from: "if (!(row && row.deleted_at) && room.gone !== true)", to: 'if (false)', name: 'gone:true を足さない', only: 'D7,D12' },
  { file: GR, from: "if (!(row && row.deleted_at) && room.gone !== true)", to: 'if (room.gone !== true)', name: '消した端末にも gone を足す（v1.2 の形）', only: 'D11' },
  { file: GR, from: "    if (room.gone === true) { room.gone = false; patchRoom(uid, rid, { gone: false }); } // A6", to: '    // 壊し', name: '読めても gone を外さない', only: 'D12' },
  { file: GR, from: "localStorage.removeItem(OUTR); localStorage.removeItem(PCLOSE);", to: 'localStorage.removeItem(PCLOSE);', name: '消した後に並びの鍵を消さない', only: 'D3' },
  { file: GR, from: "const writeBlocked = () => !!room.closed || closingOn() || stopped === 'deleted';", to: 'const writeBlocked = () => !!room.closed || closingOn();', also: ['outbox = []; clearTimeout(mergeTimer); merge.clear(); clearTimeout(retryTimer);', 'outbox = []; clearTimeout(retryTimer);'], name: '消した後も積める＋まとめを空にしない（二重の守りを両方外す）', only: 'D13' },
  { file: GR, from: "if (!op) { op = uuid(); localStorage.setItem(PDEL, op); } // 送り直しは同じ op_id", to: 'op = uuid(); localStorage.setItem(PDEL, op);', name: '送り直しで op_id を替える', only: 'D4,D5,D6' },
  { file: GR, from: "let delUi = { open: delOn(), msg: null, retry: delOn() };", to: 'let delUi = { open: false, msg: null, retry: false };', name: '印が在っても1段目で開く', only: 'D6' },
  { file: GR, from: "(n ? '<p class=\"setsumei\" id=\"rDelUnsent\">", to: "(false ? '<p class=\"setsumei\" id=\"rDelUnsent\">", name: '未送信の数を出さない', only: 'D3' },
  { file: GR, from: "    if (e === 'mj_reauth' || e === 'mj_session') { // 印は残す", to: "    if (e === 'mj_session') { // 印は残す", name: 'mj_reauth でログインし直さない', only: 'D4' },
  { file: GR, from: "if (res.ok === true || e === 'gone') { delDone(); return; }", to: "if (res.ok === true) { delDone(); return; }", name: '消す返しの gone を通ったと見ない', only: 'D9' },
  // ホーム（カードと印）
  { file: GH, from: "const delRow = (x) => !!x.deleted_at || x.gone === true;", to: "const delRow = (x) => x.gone === true;", name: 'ホームが deleted_at を見ない', only: 'D3,V2,V8' },
  { file: GH, from: "const delRow = (x) => !!x.deleted_at || x.gone === true;", to: "const delRow = (x) => !!x.deleted_at;", name: 'ホームが gone を見ない', only: 'D7,D12' },
  { file: GH, from: "    if (changed && painted) paint(cardsOf(u.id, cardRows), !cardRows);", to: '', name: '印が変わってもカードを描き直さない', only: 'V8' },
  { file: GH, from: "    const changed = applyDel(u.id, r.rows);", to: "    const changed = false;", name: 'ホームが一覧の印を控えに写さない', only: 'V2,V8' },
  // 戻す所（heya-modosu.mjs＝A27 でホームから移した）
  { file: HM, from: ".sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))", to: '', name: '控えの行を並べ替えない', only: 'V9' },
  { file: HM, from: "    paint(rows);\n", to: "    paint(deviceDel(u.id));\n", name: '読めても控えの行を出す（v1.3 の形）', only: 'V1,V3' },
  { file: HM, from: "if (ageOf(x) < DEL_MS - MARGIN_MS) {", to: "if (true) {", name: '期限切れの印も外す（S4 の前の形）', only: 'V7' },
  { file: HM, from: "if (ageOf(x) < DEL_MS - MARGIN_MS) {", to: "if (false) {", name: '他で戻した印を外さない', only: 'V7' },
  { file: HM, from: "    paint(shown); // ★読み直さない★", to: '    draw(); //', name: '戻せない時に描き直す（v1.3 の形）', only: 'V9' },
  { file: HM, from: "...[...failed].filter(([rid]) => !ids.has(rid))", to: "...[...failed].filter(() => false)", name: '一覧に無い失敗の行を出さない', only: 'V9' },
  { file: HM, from: "      before = { at: last.deleted_at, id: last.room_id };", to: "      before = { at: last.last_write_at || last.created_at, id: last.room_id };", name: '消した一覧の頁の目印が違う', only: 'V5' },
  { file: HM, from: "patchRoom(u.id, rid, { deleted_at: null, gone: false });", to: '', name: '戻しても控えを直さない', only: 'D10' },
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
