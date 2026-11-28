// 8b A25r 対局の画面の［名簿を直す］（a25r_sadame v2.1 §3 の e2e・WebKit）。台は gamen_c20-e2e.cjs の写し（本物の taikyoku.html に、ログインと sb()／rpc() だけ差し替えた gamen-core）。
// node gamen_a25r-e2e.cjs <作業木> [--self] [--chromium]・ONLY=R1,R2・MUTONLY=<壊しの名の一部>
// 偽の倉庫は links{member_id: uid}・left（出た人）を持ち、mj_read の members に me／taken／left を付け、mj_write の人の op に倉庫の門を当てる
//   （出た人の rename／unlink＝left（持ち主の unlink は通す）・ほかの人の unlink は管・member_active false はその op の時に user_id が在れば tsunagi＝§1-8）。
// 部屋の読みは split で分けた読み（最後の3開催・members[].n は全開催の数）にできる。
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）・壊す前から赤の物は数えない。
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
window.__aizu = (key) => { for (const f of window.__chans[key] || []) f({ payload: { v: 999999 } }); };
export function sb() { return { auth: { onAuthStateChange() {} }, rpc: call,
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
let LIB = null, RL = null, RULES = null, LR4 = null;
const DB = new Map();   // rid → { kind, name, rules, closed, read_ver, channel_key, st, results, roles, owner, leagues, days, links: {mid: uid}, left: Set(mid), split }
const LOG = [];
const CTL = {};         // dev → { forceWrite: [返し…]（member_ の組だけ）, offOnWrite: [op…]（点の組を受ける直前に倉庫へ当てる）, failPlain: n（点の組を 503）, holdRead: bool（部屋の読みの答えを止める・held に放す手）, failRead: n（since の無い部屋の読みを 500） }
const ctl = (dev) => (CTL[dev] = CTL[dev] || { forceWrite: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = () => new Date().toISOString();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const pad = (n) => String(n).padStart(2, '0');
const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })();
const NAMES = ['山田', '鈴木', '佐藤', '高橋', '加藤'];
const M = NAMES.map((_, i) => 'm' + (i + 1));
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const LID = U(900);

/* ── 偽の倉庫（a25r_sadame v2.1 §1-5〜§1-8 の門）── */
const roleOf = (R, uid) => (uid === R.owner ? 'owner' : R.roles[uid] || null);
function fakeApply(R, ops, uid) {
  let st = clone(R.st); st.rules = R.rules;
  const days = clone(R.days);
  for (const op0 of ops) {
    const op = clone(op0);
    let lg = null;
    if (op.op === 'session_add' && op.league_id) { lg = R.leagues.find((l) => l.league_id === op.league_id); if (!lg) return { ok: false, err: 'bad', what: 'league_id' }; delete op.league_id; }
    const r = LIB.applyOps(st, [op], { roomRules: R.rules, now: NOW(), direct: op.op === 'table_rules' || LIB.PERSON_OPS.includes(op.op), role: roleOf(R, uid) || 'nyu' });
    if (!r.ok) return r.res;
    st = r.state; st.rules = R.rules;
    if (lg) { const s = st.sessions.find((x) => x.session_id === op.session_id); s.league_id = lg.league_id; days.push({ session_id: s.session_id, rules: clone(lg.rules), rules_alt: null }); }
    if (op.op === 'table_add') { const t = st.tables.find((x) => x.table_id === op.table_id); const d = days.find((x) => x.session_id === op.session_id); if (d) t.rules = clone(d.rules); }
  }
  return { ok: true, st, days };
}
/* 人の op の門（mj_w_op）：rename・unlink は出た人（left）に err left（持ち主の unlink だけ通す）／ほかの人がつないだ人の unlink は管（mj_w_is_kan）／
 *   member_active false はその op を当てる時に user_id が在れば err tsunagi（同じ組で unlink が先なら通る＝§1-8）／link は c20 §1d の通り */
function personOps(R, ops, uid) {
  const links = { ...R.links }; const left = new Set(R.left); const claims = []; const results = []; let freed = false;
  const role = roleOf(R, uid), kan = role === 'owner' || role === 'kan';
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i], mid = op.member_id;
    if (op.op === 'member_rename' && left.has(mid)) return { ok: false, err: 'left', i, member_id: mid };
    if (op.op === 'member_unlink') {
      const cur = links[mid];
      if (cur === uid) { delete links[mid]; freed = true; results.push({}); continue; }
      if (cur && left.has(mid)) { if (role !== 'owner') return { ok: false, err: 'left', i, member_id: mid }; delete links[mid]; left.delete(mid); results.push({}); continue; }
      if (cur) { if (!kan) return { ok: false, err: 'mj_role', need: 'kan' }; delete links[mid]; results.push({}); continue; }
      results.push({}); continue;
    }
    if (op.op === 'member_active' && op.active === false && links[mid]) return { ok: false, err: 'tsunagi', i, member_id: mid };
    if (op.op === 'member_link') {
      const cur = links[mid];
      if (cur === uid) { results.push({}); continue; }
      const mine = Object.keys(links).find((k) => links[k] === uid);
      if (mine) return { ok: false, err: 'linked', i, member_id: mine };
      if (cur) { if (freed) return { ok: false, err: 'taken', i, member_id: mid }; claims.push({ member_id: mid, user_id: uid }); results.push({ claimed: true }); continue; }
      links[mid] = uid; results.push({}); continue;
    }
    results.push({});
  }
  return { ok: true, links, left, claims, results };
}
function mkRoom(rid, { closed = false, links = {}, left = [] } = {}) {
  let st = LIB.emptyState(); st.rules = RULES;
  st = LIB.applyOps(st, NAMES.map((nm, i) => ({ op: 'member_add', member_id: M[i], name: nm })), { roomRules: RULES, now: NOW(), role: 'kan' }).state;
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules: RULES, closed, read_ver: 1, channel_key: 'ch-' + rid, st, results: new Map(), roles: { u1: 'kan', u2: 'nyu', u3: 'kan' }, owner: 'u1', leagues: [], days: [], links: { ...links }, left: new Set(left), claims: [], split: false });
}
function seed(rid, ops) { const R = DB.get(rid); const a = fakeApply(R, ops, 'u1'); if (!a.ok) throw new Error('台の種が弾かれた ' + JSON.stringify(a)); R.st = a.st; R.days = a.days; R.read_ver++; }
const H = (hid, tid, s, cells = [40000, 30000, 20000, 10000]) => ({ op: 'hanchan_start', hanchan_id: hid, table_id: tid, seats: s, cells });
const day0 = () => [{ op: 'session_add', session_id: 's1', date: TODAY, rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' }];
/* ふつうの部屋＝今日の開催 s1・卓 t1・山田 鈴木 佐藤 高橋 の半荘 h1 */
function mkRoomH(rid, o = {}) { mkRoom(rid, o); seed(rid, [...day0(), H('h1', 't1', M.slice(0, 4))]); }
function mkRoomT(rid, o = {}) { mkRoom(rid, o); seed(rid, day0()); }
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; return o; };
function stPart(R, keep, uid) {
  const o = stOut(R.st);
  const sids = new Set(o.sessions.filter(keep).map((s) => s.session_id));
  const tids = new Set(o.tables.filter((t) => sids.has(t.session_id)).map((t) => t.table_id));
  o.sessions = o.sessions.filter((s) => sids.has(s.session_id)); o.tables = o.tables.filter((t) => tids.has(t.table_id));
  o.hanchans = o.hanchans.filter((h) => tids.has(h.table_id)); o.extras = o.extras.filter((x) => tids.has(x.table_id)); o.settles = (o.settles || []).filter((x) => sids.has(x.session_id));
  o.members = o.members.map((m) => { const u = R.links[m.member_id]; return R.left.has(m.member_id) && u ? { ...m, left: true } : u === uid ? { ...m, me: true } : u ? { ...m, taken: true } : m; });
  return o;
}
/* 分けた読み（v3）＝写しは最後の3開催だけ・members[].n は倉庫が league の無い全開催で数えた数 */
function splitOf(R, o) {
  const all = stOut(R.st);
  const plain = new Set(all.sessions.filter((s) => !s.league_id).map((s) => s.session_id));
  const liveT = new Set(all.tables.filter((t) => plain.has(t.session_id) && !t.voided).map((t) => t.table_id));
  const keep = new Set(o.sessions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-3).map((s) => s.session_id));
  const tids = new Set(o.tables.filter((t) => keep.has(t.session_id)).map((t) => t.table_id));
  o.sessions = o.sessions.filter((s) => keep.has(s.session_id)); o.tables = o.tables.filter((t) => tids.has(t.table_id));
  o.hanchans = o.hanchans.filter((h) => tids.has(h.table_id)); o.extras = o.extras.filter((x) => tids.has(x.table_id)); o.settles = (o.settles || []).filter((x) => keep.has(x.session_id));
  o.loaded = [...keep];
  o.members = o.members.map((m) => ({ ...m, n: all.hanchans.filter((h) => !h.voided && liveT.has(h.table_id) && h.seats.includes(m.member_id)).length, last: null }));
  return o;
}
const lgOut = (l, uid) => ({ league_id: l.league_id, name: l.name, date_from: null, date_to: null, rank_by: 'pt', min_games: 0, players_main: l.rules.players, rules: l.rules, rules_alt: null, version: 1, voided: false, l: l.l_uid === uid });
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R || !roleOf(R, uid)) return { ok: false, err: 'gone' };
  const args = a.p_args || {};
  const room = { kind: R.kind, name: R.name, role: roleOf(R, uid), owner: roleOf(R, uid) === 'owner', closed: R.closed, rules: R.rules, channel_key: R.channel_key };
  if (args.since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
  if (a.p_what === 'league') {
    const l = R.leagues.find((x) => x.league_id === args.league_id);
    if (!l) return { ok: false, err: 'bad', what: 'league_id' };
    const days = R.days.filter((d) => (R.st.sessions.find((s) => s.session_id === d.session_id) || {}).league_id === l.league_id);
    const p = stPart(R, (s) => s.league_id === l.league_id, uid); p.sessions = p.sessions.map((s) => { const c = { ...s }; delete c.league_id; return c; });
    return { ok: true, read_ver: R.read_ver, room, league: lgOut(l, uid), days: clone(days), st: p };
  }
  let p = stPart(R, (s) => !s.league_id, uid);
  if (R.split) p = splitOf(R, p);
  return { ok: true, read_ver: R.read_ver, room, st: p, leagues: R.leagues.map((l) => lgOut(l, uid)) };
}
async function mjWrite(dev, uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R || !roleOf(R, uid)) return { ok: false, err: 'gone' };
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  if (R.closed) return { ok: false, err: 'bad', at: 'closed' };
  const p = personOps(R, a.p_ops, uid);
  if (!p.ok) { R.results.set(a.p_op_id, p); return p; }
  const r = fakeApply(R, a.p_ops, uid);
  if (!r.ok) { R.results.set(a.p_op_id, r); return r; }
  R.st = r.st; R.days = r.days; R.links = p.links; R.left = p.left; R.claims.push(...p.claims); R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver, results: p.results }; R.results.set(a.p_op_id, res); return res;
}
/* 別の端末（台）が倉庫へ直に当てる（画面を通さない） */
function dbDo(rid, ops) { const R = DB.get(rid); const a = fakeApply(R, ops, 'u1'); if (!a.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(a)); R.st = a.st; R.days = a.days; R.read_ver++; }
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const c = ctl(dev);
    const send = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o && o.__http ? { data: null, error: { message: 'upstream' }, status: o.__http } : { data: o, error: null, status: 200 })); };
    if (fn === 'mj_read') {
      const e = { dev, fn, what: args.p_what, args: clone(args.p_args || {}) }; LOG.push(e);
      const pa = args.p_args || {};
      if (c.failRead && args.p_what === 'room' && (pa.since === undefined || pa.since === null)) { c.failRead--; e.res = { __http: 500 }; send(e.res); return; }
      if (c.holdRead && args.p_what === 'room') await new Promise((s) => (c.held = c.held || []).push(s)); // 部屋の読みの答えを止める（書いた後の写しへの当てが読みより先に効くかを見る）
      send(mjRead(uid, args)); return;
    }
    if (fn === 'mj_write') {
      const e = { dev, fn, op_id: args.p_op_id, ops: clone(args.p_ops) }; LOG.push(e);
      const mem = args.p_ops.some((o) => /^member_/.test(o.op));
      if (c.forceWrite.length && mem) { e.res = c.forceWrite.shift(); send(e.res); return; }
      if (c.failPlain && !mem) { e.res = { __http: 503 }; send(e.res); return; }
      if (c.offOnWrite && !mem) { dbDo(args.p_room_id, c.offOnWrite); c.offOnWrite = null; } // 書く直前に別の端末が消した（写しは古いまま＝倉庫が bad seats）
      e.res = await mjWrite(dev, uid, args); send(e.res); return;
    }
    if (fn === 'mj_my_rooms') { send({ ok: true, rooms: [] }); return; }
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
  if (mutate && mutate.file && f.replace(/\\/g, '/').endsWith(mutate.file)) {
    for (const [from, to] of [[mutate.from, mutate.to], ...(mutate.also ? [mutate.also] : [])]) { if (!b.includes(from)) { console.log('✗ 壊しの字が無い ' + from); process.exit(2); } b = b.replace(from, to); }
  }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };
  DB.clear(); LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = [];
  const device = async (dev, uid, rid, lid) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    const R = DB.get(rid), role = roleOf(R, uid);
    const seedLs = { ['mj-rooms:' + uid]: [{ room_id: rid, kind: 'shared', name: '会' + rid, role: role === 'owner' ? 'kan' : role, owner: role === 'owner', rules: RULES, channel_key: 'ch-' + rid, at: 1 }] };
    await ctx.addInitScript(([dev, uid, s]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 15000);
    if (process.env.DBG) pg.on('console', (m) => console.log('C', dev, m.text().slice(0, 200)));
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    pg.__url = `http://127.0.0.1:${port}/taikyoku.html?room=${rid}` + (lid ? '&league=' + lid : '');
    return { pg, ctx };
  };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const body = (pg) => pg.evaluate(() => document.getElementById('vRoom').textContent);
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const memW = (dev) => writes(dev).filter((w) => w.ops.some((o) => /^member_/.test(o.op)));
  const shape = (w) => (w ? w.ops.map((o) => o.op + ':' + o.member_id).join(',') : null);
  const reads = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_read').length;
  const waitFor = async (fn, ms, step = 50) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const chips = (pg) => pg.evaluate(() => [...document.querySelectorAll('#pBase [data-pick]')].map((b) => ({ m: b.dataset.pick, t: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })));
  const lsHas = (pg, s) => pg.evaluate((x) => Object.keys(localStorage).some((k) => k !== '__seeded' && /out/.test(k) && (localStorage.getItem(k) || '').includes(x)), s);
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const fill = async (pg, cells) => { await pg.waitForSelector('[data-c="0"]'); for (let i = 0; i < cells.length; i++) await put(pg, i, cells[i]); await kpk(pg, 'ok'); await pg.click('#eOk'); };
  const four = ['40000', '30000', '20000', '10000'];
  const aizu = (pg, rid) => pg.evaluate((k) => window.__aizu(k), 'ch-' + rid);
  const open = async (pg, sel = '#rAdd') => { await pg.goto(pg.__url); await pg.waitForSelector(sel); await sleep(250); };
  /* 人を選ぶ頁へ：半荘の在る卓は［n回目の点を入れる］→（点の頁なら［人を替える］）／半荘の無い卓は［＋名前］ */
  const toPick = async (pg) => {
    if (await has(pg, '#rAdd')) { await pg.click('#rAdd'); await pg.waitForSelector('#pGo, #ePeople'); if (!(await has(pg, '#pGo'))) await pg.click('#ePeople'); }
    else await pg.click('#vRoom [data-seats]');
    await pg.waitForSelector('#pGo');
  };
  const mbOpen = async (pg) => { await pg.click('#mbGo'); await pg.waitForSelector('#mbBox'); };
  const offAsk = async (pg, mid) => { await pg.click('[data-mboff="' + mid + '"]'); await pg.waitForSelector('#mbOffOk:not([disabled])'); return (await txt(pg, '#mbOffT')) || ''; };
  const rename = async (pg, mid, nm) => { await pg.click('[data-mbrn="' + mid + '"]'); await pg.waitForSelector('#mbIn'); await pg.fill('#mbIn', nm); await pg.click('#mbRnOk'); };
  const mbMsg = async (pg) => (await txt(pg, '#mbMsg')) || '';
  const digits = async (pg, i) => ((await pg.evaluate((x) => { const e = document.querySelector(x); return e ? ('value' in e ? e.value : e.textContent) : null; }, '[data-c="' + i + '"]')) || '').replace(/[^0-9-]/g, '');
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const step = async (k, f) => { if (!want(k)) return; try { await f(); } catch (e) { fail++; bad.push('止まった(' + k + ') ' + String(e && e.message || e).split('\n')[0].slice(0, 300)); } finally { for (const c of ctxs.splice(0)) await c.close().catch(() => {}); } };
  try {
    // R1 ふつうの部屋：名前を直す→人を選ぶ・あなたの名前・点の表が新しい名／同じ名に直す→dup の字・名は元のまま
    await step('R1', async () => {
      mkRoomH('r1');
      const A = await device('R1', 'u1', 'r1');
      await open(A.pg); await toPick(A.pg); await mbOpen(A.pg);
      await rename(A.pg, 'm3', '佐々木');
      await waitFor(async () => ((await chips(A.pg)).find((c) => c.m === 'm3') || {}).t === '佐々木', 5000);
      const w = memW('R1')[0];
      ok('R1 member_rename を直に1つ送る（並びに積まない）', shape(w) === 'member_rename:m3' && w.ops[0].name === '佐々木' && w.res && w.res.ok === true, w);
      ok('R1 人を選ぶの名が新しい名', ((await chips(A.pg)).find((c) => c.m === 'm3') || {}).t === '佐々木', await chips(A.pg));
      ok('R1 倉庫の名も新しい名', DB.get('r1').st.members.find((m) => m.member_id === 'm3').name === '佐々木');
      await rename(A.pg, 'm2', '山田');
      await waitFor(async () => (await mbMsg(A.pg)) !== '', 5000);
      ok('R1 同じ名に直す＝「同じ名前の人がもういます」', (await mbMsg(A.pg)) === '同じ名前の人がもういます', await mbMsg(A.pg));
      ok('R1 同じ名に直した後も名は元のまま', DB.get('r1').st.members.find((m) => m.member_id === 'm2').name === '鈴木' && ((await chips(A.pg)).find((c) => c.m === 'm2') || {}).t === '鈴木');
      await A.pg.click('#pMeGo'); await A.pg.waitForSelector('#meNewGo');
      ok('R1 あなたの名前の頁も新しい名', /佐々木/.test((await txt(A.pg, '#meList [data-me="m3"]')) || ''), await txt(A.pg, '#meList'));
      ok('R1 あなたの名前の頁にも［名簿を直す］', await has(A.pg, '#mbGo'));
      await open(A.pg);
      const b = await body(A.pg);
      ok('R1 点の表が新しい名（佐藤 が無い）', b.includes('佐々木') && !b.includes('佐藤'), b.slice(0, 200));
    });

    // R2 リーグの卓：名前を直す・点の在る人を消す（回数はリーグの読みから・リーグの順位に残る）
    await step('R2', async () => {
      mkRoom('r2'); const R = DB.get('r2'); R.leagues.push({ league_id: LID, name: '金曜リーグ', rules: LR4, l_uid: 'u1' });
      seed('r2', [{ op: 'session_add', session_id: 'ls1', date: TODAY, rate: LR4.rate, league_id: LID }, { op: 'table_add', table_id: 'lt1', session_id: 'ls1', label: '卓1' }, { op: 'table_seats', table_id: 'lt1', seats: M.slice(0, 4) }, H('lh1', 'lt1', M.slice(0, 4))]);
      const A = await device('R2', 'u1', 'r2', LID);
      await open(A.pg); await toPick(A.pg); await mbOpen(A.pg);
      await rename(A.pg, 'm2', '鈴木二');
      await waitFor(async () => ((await chips(A.pg)).find((c) => c.m === 'm2') || {}).t === '鈴木二', 5000);
      ok('R2 リーグの卓でも名前を直せる', ((await chips(A.pg)).find((c) => c.m === 'm2') || {}).t === '鈴木二' && R.st.members.find((m) => m.member_id === 'm2').name === '鈴木二', await chips(A.pg));
      const t = await offAsk(A.pg, 'm2');
      ok('R2 確かめ＝リーグの半荘 1 回・リーグの順位に残る・戻せる', t.includes('鈴木二さんは半荘 1 回の点があります。消しても点はリーグの順位に残ります') && t.endsWith('下の［戻す］で戻せます。'), t);
      await A.pg.click('#mbOffOk'); await A.pg.waitForSelector('[data-mbg="m2"]');
      ok('R2 消すと人を選ぶに出ない・消した人の段', !(await chips(A.pg)).some((c) => c.m === 'm2') && (await txt(A.pg, '#mbGone')) === '消した人');
    });

    // R3 ふつうの部屋・4開催（分けた読み）：確かめに全部の回数・消すと人を選ぶに出ない・点の表は同じ・前の回の人＝次の半荘は人を選ぶ帯・［戻す］で戻る
    await step('R3', async () => {
      mkRoom('r3');
      const old = [['sa', '2025-01-01'], ['sb', '2025-01-02'], ['sc', '2025-01-03']];
      seed('r3', old.flatMap(([s, d], i) => [{ op: 'session_add', session_id: s, date: d, rate: 100 }, { op: 'table_add', table_id: 't' + s, session_id: s, label: '卓1' }, H('h' + s, 't' + s, ['m1', 'm2', 'm3', 'm5'])]).concat(day0(), [H('h1', 't1', M.slice(0, 4))]));
      DB.get('r3').split = true;
      const A = await device('R3', 'u1', 'r3');
      await open(A.pg);
      const before = await body(A.pg);
      await toPick(A.pg); await mbOpen(A.pg);
      const t = await offAsk(A.pg, 'm3');
      ok('R3 確かめ＝分けた読みでも 4 回（部屋の分は倉庫の n）・精算に残る', t.includes('佐藤さんは半荘 4 回の点があります。消しても点は精算に残ります。'), t);
      ok('R3 前の回の席の人＝「次の半荘は人を選び直します」', t.includes('次の半荘は人を選び直します。'), t);
      await A.pg.click('#mbOffOk'); await A.pg.waitForSelector('[data-mbg="m3"]');
      const w = memW('R3')[0];
      ok('R3 member_active false を1つ', shape(w) === 'member_active:m3' && w.ops[0].active === false && w.res.ok === true, w);
      ok('R3 消すと人を選ぶに出ない（席からも抜く）', !(await chips(A.pg)).some((c) => c.m === 'm3'), await chips(A.pg));
      await open(A.pg);
      ok('R3 点の表と精算は消す前と同じ', (await body(A.pg)) === before, [(await body(A.pg)).slice(0, 160), before.slice(0, 160)]);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('#pGo, [data-c="0"]');
      ok('R3 前の回に居た人を消して［次の半荘］＝人を選ぶ頁と帯（点の頁へ行かない）', ((await txt(A.pg, '#pOffB')) || '').includes('佐藤さんを消したので、打つ人を選び直してください') && !(await has(A.pg, '[data-c="0"]')), await txt(A.pg, '#pOffB'));
      await mbOpen(A.pg); await A.pg.click('[data-mbon="m3"]'); await A.pg.waitForSelector('[data-mb="m3"]');
      ok('R3 ［戻す］＝member_active true・人を選ぶに戻る', memW('R3').length === 2 && memW('R3')[1].ops[0].active === true && (await chips(A.pg)).some((c) => c.m === 'm3') && !(await has(A.pg, '#mbGone')));
    });

    // R4 読めない時は確かめの［消す］が押せず［読み直す］
    await step('R4', async () => {
      mkRoomH('r4');
      const A = await device('R4', 'u1', 'r4');
      await open(A.pg); await toPick(A.pg); await mbOpen(A.pg);
      ctl('R4').failRead = 1;
      await A.pg.click('[data-mboff="m3"]'); await A.pg.waitForSelector('#mbRerr');
      ok('R4 読めない＝字と［読み直す］・確かめの［消す］は押せない', (await txt(A.pg, '#mbRerr')) === '点が読めませんでした。消す前に読み直してください' && (await has(A.pg, '#mbLoad')) && (await A.pg.$eval('#mbOffOk', (b) => b.disabled)));
      await A.pg.click('#mbOffOk', { force: true }).catch(() => {}); await sleep(300);
      ok('R4 押せない［消す］は何も送らない', memW('R4').length === 0, memW('R4'));
      await A.pg.click('#mbLoad'); await A.pg.waitForSelector('#mbOffOk:not([disabled])');
      ok('R4 読み直すと押せる', !(await has(A.pg, '#mbRerr')));
    });

    // R5 別の端末が前の回の人を消した後に［次の半荘］＝人を選ぶ頁と帯
    await step('R5', async () => {
      mkRoomH('r5');
      const A = await device('R5', 'u1', 'r5');
      await open(A.pg);
      const n0 = reads('R5');
      dbDo('r5', [{ op: 'member_active', member_id: 'm4', active: false }]); await aizu(A.pg, 'r5');
      await waitFor(() => reads('R5') > n0, 5000); await sleep(400);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('#pGo, [data-c="0"]');
      ok('R5 点の頁へ行かず人を選ぶ・帯「高橋さんを消したので」', ((await txt(A.pg, '#pOffB')) || '').includes('高橋さんを消したので') && !(await has(A.pg, '[data-c="0"]')));
      const c = await chips(A.pg);
      ok('R5 残りの3人は選んだまま・高橋は出ない', c.filter((x) => x.on).map((x) => x.m).join() === 'm1,m2,m3' && !c.some((x) => x.m === 'm4'), c);
    });

    // R6 倉庫が mj_role を返す＝字が出て並びは空のまま・点はそのまま入れられる
    await step('R6', async () => {
      mkRoomH('r6');
      const A = await device('R6', 'u1', 'r6');
      await open(A.pg); await toPick(A.pg); await mbOpen(A.pg);
      ctl('R6').forceWrite.push({ ok: false, err: 'mj_role', need: 'owner_or_sole_L' });
      await rename(A.pg, 'm3', '佐々木');
      await waitFor(async () => (await mbMsg(A.pg)) !== '', 5000);
      ok('R6 mj_role の字', (await mbMsg(A.pg)) === 'この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます', await mbMsg(A.pg));
      ok('R6 並び（outbox）に member_ を積まない', !(await lsHas(A.pg, 'member_')));
      await A.pg.click('#pGo'); await fill(A.pg, four); await A.pg.waitForSelector('#rAdd');
      await waitFor(() => writes('R6').some((w) => w.ops.some((o) => o.op === 'hanchan_start') && w.res && w.res.ok), 6000);
      ok('R6 点はそのまま入れられる', writes('R6').some((w) => w.ops.some((o) => o.op === 'hanchan_start') && w.res && w.res.ok === true));
    });

    // R7 並びに送り待ちが在る時に［消す］＝送らず字（v1 止め1）
    await step('R7', async () => {
      mkRoomH('r7');
      const A = await device('R7', 'u1', 'r7');
      await open(A.pg);
      ctl('R7').failPlain = 99;
      await A.pg.click('#rAdd'); await fill(A.pg, four); await A.pg.waitForSelector('#rAdd');
      await waitFor(() => writes('R7').length > 0, 6000);
      await toPick(A.pg); await mbOpen(A.pg);
      await offAsk(A.pg, 'm5');
      await A.pg.click('#mbOffOk');
      await waitFor(async () => (await mbMsg(A.pg)) !== '', 5000);
      ok('R7 送り待ちが在る＝「前に入れた点を送っています」', (await mbMsg(A.pg)) === '前に入れた点を送っています。送れたら、もう一度押してください。', await mbMsg(A.pg));
      ok('R7 member_active を送らない', memW('R7').length === 0, memW('R7'));
      ctl('R7').failPlain = 0;
    });

    // R8 読みが skip（same）の間に消す＝写しで消えている（v1 止め2）・次の半荘は人を選ぶ
    await step('R8', async () => {
      mkRoomH('r8');
      const A = await device('R8', 'u1', 'r8');
      await open(A.pg); await toPick(A.pg); await mbOpen(A.pg);
      const t = await offAsk(A.pg, 'm4');
      ctl('R8').holdRead = true;
      ok('R8 確かめは読めた（数の読みは same にしない）', t.includes('高橋さんは半荘 1 回の点があります。'), t);
      await A.pg.click('#mbOffOk');
      await waitFor(async () => await has(A.pg, '[data-mbg="m4"]'), 5000);
      ok('R8 読みが届く前に写しで消えている（消した人の段・人を選ぶに出ない）', (await has(A.pg, '[data-mbg="m4"]')) && !(await chips(A.pg)).some((c) => c.m === 'm4'), await chips(A.pg));
      ctl('R8').holdRead = false; for (const s of ctl('R8').held || []) s(); ctl('R8').held = [];
      await open(A.pg); await A.pg.click('#rAdd'); await A.pg.waitForSelector('#pGo, [data-c="0"]');
      ok('R8 開き直しても写しに残り［次の半荘］は人を選ぶ', ((await txt(A.pg, '#pOffB')) || '').includes('高橋さんを消したので') && !(await has(A.pg, '[data-c="0"]')));
    });

    // R9 点の頁を開いている間に別の端末が消す＝［入れる］で人を選ぶ頁・点は残る（v1 止め3）
    await step('R9', async () => {
      mkRoomH('r9');
      const A = await device('R9', 'u1', 'r9');
      await open(A.pg); await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      const n0 = reads('R9');
      dbDo('r9', [{ op: 'member_active', member_id: 'm4', active: false }]); await aizu(A.pg, 'r9');
      await waitFor(() => reads('R9') > n0, 5000); await sleep(400);
      await fill(A.pg, four);
      await A.pg.waitForSelector('#pGo, #rAdd');
      ok('R9 ［入れる］で積まずに人を選ぶ頁・帯', ((await txt(A.pg, '#pOffB')) || '').includes('高橋さんを消したので') && !writes('R9').some((w) => w.ops.some((o) => o.op === 'hanchan_start')), await txt(A.pg, '#vRoom'));
      await A.pg.click('#pBase [data-pick="m5"]'); await A.pg.click('#pGo'); await A.pg.waitForSelector('[data-c="0"]');
      const got = [await digits(A.pg, 0), await digits(A.pg, 1), await digits(A.pg, 2)];
      ok('R9 打った点は人ごとに残る（山田 40000・鈴木 30000・佐藤 20000）', got.join() === '40000,30000,20000', got);
    });

    // R10 古い写しで積んだ hanchan_start が倉庫で bad seats＝帯と［選び直す］
    await step('R10', async () => {
      mkRoomH('r10');
      const A = await device('R10', 'u1', 'r10');
      await open(A.pg); await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      ctl('R10').offOnWrite = [{ op: 'member_active', member_id: 'm4', active: false }];
      await fill(A.pg, four);
      await A.pg.waitForSelector('#rRePick');
      ok('R10 帯「消された人がいるので入れられませんでした」＋［選び直す］［捨てる］', ((await txt(A.pg, '#rHeld')) || '').includes('消された人がいるので入れられませんでした') && (await has(A.pg, '#rDrop')));
      await A.pg.click('#rRePick'); await A.pg.waitForSelector('#pGo');
      await waitFor(async () => !(await chips(A.pg)).some((c) => c.m === 'm4'), 5000);
      ok('R10 ［選び直す］＝人を選ぶ頁・帯・高橋は出ない', ((await txt(A.pg, '#pOffB')) || '').includes('高橋さんを消したので') && !(await chips(A.pg)).some((c) => c.m === 'm4'), await chips(A.pg));
      ok('R10 その組は並びから外れた', !(await lsHas(A.pg, 'hanchan_start')));
    });

    // R11 つながり：自分の行に［消す］が無い・taken の行は［つながりを外して消す］＝[unlink, active false]・その人は別の名前に［これは私］・left の行は持ち主が通す
    await step('R11', async () => {
      mkRoomT('r11', { links: { m1: 'u1', m2: 'u2', m4: 'u9' }, left: ['m4'] });
      const A = await device('R11', 'u1', 'r11');
      await open(A.pg, '#vRoom [data-seats]'); await toPick(A.pg); await mbOpen(A.pg);
      ok('R11 自分の行に［消す］が無く字', !(await has(A.pg, '[data-mboff="m1"]')) && ((await txt(A.pg, '[data-mbme]')) || '').includes('あなたの名前は消せません') && (await has(A.pg, '[data-mbrn="m1"]')));
      ok('R11 taken の行＝［つながりを外して消す］', (await txt(A.pg, '[data-mboff="m2"]')) === 'つながりを外して消す');
      ok('R11 left の行＝［名前を直す］なし・［つながりを外して消す］', !(await has(A.pg, '[data-mbrn="m4"]')) && (await txt(A.pg, '[data-mboff="m4"]')) === 'つながりを外して消す');
      const t = await offAsk(A.pg, 'm2');
      ok('R11 確かめに「戦績とのつながりも外れます」', t.includes('その人の戦績とのつながりも外れます（点は残ります）'), t);
      await A.pg.click('#mbOffOk'); await A.pg.waitForSelector('[data-mbg="m2"]');
      const w = memW('R11')[0];
      ok('R11 組＝[member_unlink, member_active false]（unlink が先）・ok', shape(w) === 'member_unlink:m2,member_active:m2' && w.res && w.res.ok === true, w && { s: shape(w), res: w.res });
      ok('R11 倉庫のつながりが外れた', DB.get('r11').links.m2 === undefined);
      await offAsk(A.pg, 'm4'); await A.pg.click('#mbOffOk'); await A.pg.waitForSelector('[data-mbg="m4"]');
      ok('R11 left の行は持ち主が通す', shape(memW('R11')[1]) === 'member_unlink:m4,member_active:m4' && memW('R11')[1].res.ok === true, memW('R11')[1]);
      const B = await device('R11b', 'u2', 'r11');
      await open(B.pg, '#vRoom [data-seats]'); await toPick(B.pg); await B.pg.click('#pMeGo'); await B.pg.waitForSelector('#meNewGo');
      await B.pg.click('#meList [data-me="m5"]');
      await waitFor(() => writes('R11b').some((x) => x.res && x.res.ok), 5000);
      const wb = writes('R11b')[0];
      ok('R11 消された人は別の名前に［これは私］できる', shape(wb) === 'member_link:m5' && wb.res.ok === true && DB.get('r11').links.m5 === 'u2', wb && { s: shape(wb), res: wb.res });
    });

    // R12 管でない人の taken＝mj_role の字／管（持ち主でない）の left＝left の字
    await step('R12', async () => {
      mkRoomT('r12', { links: { m1: 'u1' } });
      const A = await device('R12', 'u2', 'r12');
      await open(A.pg, '#vRoom [data-seats]'); await toPick(A.pg); await mbOpen(A.pg);
      await offAsk(A.pg, 'm1'); await A.pg.click('#mbOffOk');
      await waitFor(async () => (await mbMsg(A.pg)) !== '', 5000);
      ok('R12 管でない人＝mj_role の字・つながりは残る', (await mbMsg(A.pg)) === 'この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます' && DB.get('r12').links.m1 === 'u1', await mbMsg(A.pg));
      mkRoomT('r12b', { links: { m4: 'u9' }, left: ['m4'] });
      const B = await device('R12b', 'u3', 'r12b');
      await open(B.pg, '#vRoom [data-seats]'); await toPick(B.pg); await mbOpen(B.pg);
      await offAsk(B.pg, 'm4'); await B.pg.click('#mbOffOk');
      await waitFor(async () => (await mbMsg(B.pg)) !== '', 5000);
      ok('R12 管（持ち主でない）の left＝left の字', (await mbMsg(B.pg)) === 'この人は部屋を出ています。名前は直せません。' && DB.get('r12b').links.m4 === 'u9', await mbMsg(B.pg));
    });

    // R13 確かめの後に別の端末がつないだ＝tsunagi の字で読み直し（止めA）
    await step('R13', async () => {
      mkRoomT('r13');
      const A = await device('R13', 'u1', 'r13');
      await open(A.pg, '#vRoom [data-seats]'); await toPick(A.pg); await mbOpen(A.pg);
      await offAsk(A.pg, 'm5');
      DB.get('r13').links.m5 = 'u2'; DB.get('r13').read_ver++;
      await A.pg.click('#mbOffOk');
      await waitFor(async () => (await mbMsg(A.pg)) !== '', 5000);
      ok('R13 tsunagi＝「この人は今アカウントにつながりました…」', (await mbMsg(A.pg)) === 'この人は今アカウントにつながりました。読み直すと［つながりを外して消す］になります。', await mbMsg(A.pg));
      await waitFor(async () => (await txt(A.pg, '[data-mboff="m5"]')) === 'つながりを外して消す', 5000);
      ok('R13 読み直すと［つながりを外して消す］', (await txt(A.pg, '[data-mboff="m5"]')) === 'つながりを外して消す' && DB.get('r13').st.members.find((m) => m.member_id === 'm5').active === true);
    });

    // R14 終えた部屋は［名簿を直す］が無い
    await step('R14', async () => {
      mkRoomH('r14', { closed: true });
      const A = await device('R14', 'u1', 'r14');
      await A.pg.goto(A.pg.__url); await A.pg.waitForSelector('#vRoom'); await sleep(800);
      if (await has(A.pg, '#rAdd:not([disabled])')) { await A.pg.click('#rAdd'); await sleep(500); }
      ok('R14 終えた部屋に［名簿を直す］が無い', !(await has(A.pg, '#mbGo')));
    });
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

const GR = 'js/gamen-room.mjs';
const MUT = [
  { file: GR, from: "if (outbox.length || merge.size) { kick(); return say('前に入れた点を送っています。送れたら、もう一度押してください。'); } // §1-5", to: "if (false) { kick(); return say(''); } // §1-5", name: '送り待ちが在っても送る', only: 'R7' },
  { file: GR, from: 'if (a.ok) { st = a.state; save(KEYR, st); }\n      if (mb) mb.ed = null;', to: 'if (mb) mb.ed = null;', name: 'ok の後に写しへ当てない', only: 'R8' },
  { file: GR, from: 'if (!e.hanchan_id && e.seats.some((m) => !actOf(m))) return offPick();', to: 'void 0;', name: '［入れる］で active を見ない', only: 'R9' },
  { file: GR, from: "if (m.me !== true) h += '<button class=\"btn-s\" data-mboff=", to: "if (true) h += '<button class=\"btn-s\" data-mboff=", name: '自分の行に［消す］', only: 'R11' },
  { file: GR, from: "(mbTie(m) ? [{ op: 'member_unlink', member_id: mid }] : []).concat", to: '[].concat', name: 'taken の行で unlink を送らず active false だけ', only: 'R11' },
  { file: GR, from: "(mbTie(m) ? [{ op: 'member_unlink', member_id: mid }] : []).concat([memberOp.off(mid)])", to: "[memberOp.off(mid)].concat(mbTie(m) ? [{ op: 'member_unlink', member_id: mid }] : [])", name: '組の順を逆（active false が先）', only: 'R11' },
  { file: GR, from: "(ok && !busy ? '' : ' disabled')", to: "(!busy ? '' : ' disabled')", also: ['if (!m || !(mb.mm && mb.mm.room)) return;', 'if (!m) return;'], name: '確かめを読む前に押せる', only: 'R4' },
  { file: GR, from: 'if (Array.isArray(base) && base.some((m) => !actOf(m)))', to: 'if (false)', name: '消した人を前の回の席に残す', only: 'R3,R5' },
  { file: 'lib/meibo.mjs', from: 'const mm = Array.isArray(roomSt.loaded) ?', to: 'const mm = false ?', name: '部屋の分を st だけで数える', only: 'R3' },
  { file: GR, from: "outbox[0].held && outbox[0].held.at === 'seats' &&", to: 'false &&', name: 'bad seats の帯を出さない', only: 'R10' },
  { file: GR, from: "if (s.err === 'tsunagi') {", to: 'if (false) {', name: 'tsunagi の字を出さない', only: 'R13' },
];

(async () => {
  LIB = await import(pathToFileURL(path.join(ROOT, 'lib/room-state.mjs')).href);
  RL = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RL.rulesOk({ ...RL.defaultRules(4), rate: 100, chip_pt10: 20 }).rules;
  LR4 = RL.rulesOk({ ...RL.defaultRules(4), rate: 50, chip_pt10: 20 }).rules;
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (CHROMIUM ? pw.chromium : pw.webkit).launch();
  const nm = CHROMIUM ? 'Chromium' : 'WebKit';
  let code = 0;
  if (!SELF) {
    if (process.env.MUTAPPLY) mutate = MUT.find((x) => x.name.includes(process.env.MUTAPPLY));
    const r = await run(br, port);
    console.log(nm + ' ' + r.pass + '/' + (r.pass + r.fail));
    if (process.env.LOGDUMP) for (const x of LOG) console.log('L', x.dev, x.fn, x.what || '', JSON.stringify(x.args || x.ops || '').slice(0, 120), JSON.stringify(x.res || '').slice(0, 80));
    for (const b of r.bad) console.log('  ✗ ' + b);
    code = r.fail ? 1 : 0;
  } else {
    let red = 0;
    const base = process.env.ONLY;
    const list = MUT.filter((x) => !process.env.MUTONLY || x.name.includes(process.env.MUTONLY));
    for (const m of list) {
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
    console.log(nm + ' 壊し ' + red + '/' + list.length + ' 赤'); code = red === list.length ? 0 : 1;
  }
  await br.close(); srv.close(); process.exit(code);
})();
