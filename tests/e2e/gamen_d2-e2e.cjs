// D2 リーグの対局（卓1・卓2…を何卓でも）＝画面の分（d2_sadame.md v1.1 §3・§4 の gamen_d2-e2e）の自己確認。
// node gamen_d2-e2e.cjs <作業木> [--self] [--chromium] [--shot=<dir>]
// 形は gamen_c4-e2e.cjs・gamen_d1-e2e.cjs の写し：本物の taikyoku.html・league.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// mj_read（'room'・'league'）・mj_write・mj_my_rooms は★この台の中の偽の倉庫★＝node 側で lib/room-state.mjs の applyOps を当て、
//   d2_sadame §1 の門（L だけの op＝mj_role need L・リーグの日の重なり＝dup what session・期間＝bad what date・alt＝bad what alt・rate＝リーグの主の値）を写した物。
//   ★今の lib は scope（§2）を持たない＝リーグの session_add は偽の倉庫で league_id を外して当て、日と卓のルールは台が後から付ける★。
// ★倉庫と lib が入ってから走らせる段★（今は「保留」と出して数えない）：
//   W1 本物の倉庫（mj_read 'league'・テスト版）で同じ段を回す＝tests/*.live.mjs の側（麻雀の席）／ここでは偽の倉庫だけ
//   W2 ［＋卓］で「もう一方の卓」（alt:true）を写しに当てて送る＝lib の table_add に alt が入ってから（KEYS_OF('table_add') に alt が在れば走る）
//   W3 L でない人の［＋卓］相当の op を写しで弾く（mj_role need L・held を作らない）＝lib の scope.isL が入ってから（applyOps が scope を見れば走る）
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）・壊しごとに効く試しだけ回す（ONLY）。
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const CHROMIUM = process.argv.includes('--chromium');
const SHOT = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice(7) || null;
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
let LIB = null, RL = null, RULES = null, LR4 = null, LR3 = null;
const DB = new Map();   // rid → { kind, name, rules, closed, read_ver, channel_key, st, results, roles, owner, leagues: [], days: [] }
const LOG = [];
const CTL = {};         // dev → { forceWrite: [返し…], holdFirstLeagueAdd: ms }
const ctl = (dev) => (CTL[dev] = CTL[dev] || { forceWrite: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = () => new Date().toISOString();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const pad = (n) => String(n).padStart(2, '0');
const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })();
const NAMES = ['山田', '鈴木', '佐藤', '高橋', '加藤', '中村', '渡辺', '松本'];
const M = NAMES.map((_, i) => 'm' + (i + 1));
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); // 偽の倉庫の id（uuid の形）
const LID = U(900), LID_ALT = U(901), LID_TERM = U(902);

/* ── 偽の倉庫 ── */
const roleOf = (R, uid) => (uid === R.owner ? 'owner' : R.roles[uid] || null);
const lgOfSession = (R, sid) => { const s = R.st.sessions.find((x) => x.session_id === sid); return s && s.league_id ? R.leagues.find((l) => l.league_id === s.league_id) || null : null; };
const lgOfTable = (R, tid) => { const t = R.st.tables.find((x) => x.table_id === tid); return t ? lgOfSession(R, t.session_id) : null; };
const L_OPS = new Set(['session_add', 'session_edit', 'table_add', 'table_edit', 'table_seats', 'hanchan_seats']); // WHO_LEAGUE 'L'（d2 §0）
/* ops を1つずつ当てる（門→lib→台が日・卓のルールを付ける）。返し＝{ ok, st } か 返し */
function fakeApply(R, ops, uid) {
  let st = clone(R.st); st.rules = R.rules;
  const days = clone(R.days);
  for (const op0 of ops) {
    const op = clone(op0);
    let lg = null, alt = false;
    if (op.op === 'session_add' && op.league_id) {
      lg = R.leagues.find((l) => l.league_id === op.league_id);
      if (!lg || lg.voided) return { ok: false, err: 'bad', what: 'league_id' };
      if (lg.l_uid !== uid) return { ok: false, err: 'mj_role', need: 'L' };
      const mine = st.sessions.filter((s) => s.league_id === lg.league_id && !s.voided);
      const last = mine[mine.length - 1];
      if (last && !(st.settles || []).some((x) => x.session_id === last.session_id)) return { ok: false, err: 'dup', what: 'session', session_id: last.session_id };
      if ((lg.date_from && op.date < lg.date_from) || (lg.date_to && op.date > lg.date_to)) return { ok: false, err: 'bad', what: 'date' };
      if (op.rate !== undefined && op.rate !== (lg.rules.rate ?? null)) return { ok: false, err: 'bad', what: 'rate' };
      delete op.league_id;
    } else if (L_OPS.has(op.op)) {
      const sid = op.session_id || (st.tables.find((t) => t.table_id === op.table_id) || {}).session_id || (st.hanchans.find((h) => h.hanchan_id === op.hanchan_id) ? (st.tables.find((t) => t.table_id === st.hanchans.find((h) => h.hanchan_id === op.hanchan_id).table_id) || {}).session_id : null);
      const s = st.sessions.find((x) => x.session_id === sid);
      lg = s && s.league_id ? R.leagues.find((l) => l.league_id === s.league_id) : null;
      if (lg && lg.l_uid !== uid) return { ok: false, err: 'mj_role', need: 'L' };
      if (op.op === 'table_add' && op.alt !== undefined) {
        alt = op.alt === true;
        const d = days.find((x) => x.session_id === op.session_id);
        if (alt && !(lg && d && d.rules_alt)) return { ok: false, err: 'bad', what: 'alt' };
        delete op.alt;
      }
    }
    const r = LIB.applyOps(st, [op], { roomRules: R.rules, now: NOW(), direct: op.op === 'table_rules', role: roleOf(R, uid) || 'nyu' });
    if (!r.ok) return r.res;
    st = r.state; st.rules = R.rules;
    if (op0.op === 'session_add' && op0.league_id) {
      const s = st.sessions.find((x) => x.session_id === op.session_id);
      s.league_id = lg.league_id;
      days.push({ session_id: s.session_id, rules: clone(lg.rules), rules_alt: lg.rules_alt ? clone(lg.rules_alt) : null });
    }
    if (op.op === 'table_add') {
      const t = st.tables.find((x) => x.table_id === op.table_id);
      const d = days.find((x) => x.session_id === op.session_id);
      if (d) t.rules = clone(alt ? d.rules_alt : d.rules); // 卓のルールは開催日の版（主か alt）
    }
  }
  return { ok: true, st, days };
}
function mkRoom(rid, { roles = {}, closed = false } = {}) {
  let st = LIB.emptyState(); st.rules = RULES;
  const r = LIB.applyOps(st, M.map((m, i) => ({ op: 'member_add', member_id: m, name: NAMES[i] })), { roomRules: RULES, now: NOW(), role: 'kan' });
  st = r.state;
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules: RULES, closed, read_ver: 1, channel_key: 'ch-' + rid, st, results: new Map(), roles: { u1: 'kan', u2: 'nyu', ...roles }, owner: 'u1', leagues: [], days: [] });
}
function mkLeague(rid, o) {
  const R = DB.get(rid);
  const lg = { league_id: o.league_id, name: o.name || '金曜リーグ', date_from: o.date_from || null, date_to: o.date_to || null, rank_by: 'pt', min_games: 0, players_main: o.rules.players, rules: o.rules, rules_alt: o.rules_alt || null, version: 1, l_uid: o.l_uid || 'u1', voided: false };
  R.leagues.push(lg); return lg;
}
/* 台の種＝L（u1）が書いた形で当てる（門を通す） */
function seed(rid, ops) { const R = DB.get(rid); const a = fakeApply(R, ops, R.leagues.length ? R.leagues[0].l_uid : 'u1'); if (!a.ok) throw new Error('台の種が弾かれた ' + JSON.stringify(a)); R.st = a.st; R.days = a.days; R.read_ver++; }
function seedAs(rid, uid, ops) { const R = DB.get(rid); const a = fakeApply(R, ops, uid); if (!a.ok) throw new Error('台の種が弾かれた ' + JSON.stringify(a)); R.st = a.st; R.days = a.days; R.read_ver++; }
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; return o; };
function stPart(st, keep) { // keep(session)＝出す開催
  const o = stOut(st);
  const sids = new Set(o.sessions.filter(keep).map((s) => s.session_id));
  const tids = new Set(o.tables.filter((t) => sids.has(t.session_id)).map((t) => t.table_id));
  o.sessions = o.sessions.filter((s) => sids.has(s.session_id)); o.tables = o.tables.filter((t) => tids.has(t.table_id));
  o.hanchans = o.hanchans.filter((h) => tids.has(h.table_id)); o.extras = o.extras.filter((x) => tids.has(x.table_id)); o.settles = (o.settles || []).filter((x) => sids.has(x.session_id));
  return o;
}
const lgOut = (R, l, uid) => ({ league_id: l.league_id, name: l.name, date_from: l.date_from, date_to: l.date_to, rank_by: l.rank_by, min_games: l.min_games, players_main: l.players_main, rules: l.rules, rules_alt: l.rules_alt, version: l.version, voided: l.voided, l: l.l_uid === uid });
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R || !roleOf(R, uid)) return { ok: false, err: 'gone' };
  const args = a.p_args || {};
  const room = { kind: R.kind, name: R.name, role: roleOf(R, uid), owner: roleOf(R, uid) === 'owner', closed: R.closed, rules: R.rules, channel_key: R.channel_key };
  if (a.p_what === 'league') {
    const l = R.leagues.find((x) => x.league_id === args.league_id);
    if (!l) return { ok: false, err: 'bad', what: 'league_id' };
    if (args.since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
    const days = R.days.filter((d) => (R.st.sessions.find((s) => s.session_id === d.session_id) || {}).league_id === l.league_id);
    return { ok: true, read_ver: R.read_ver, room, league: lgOut(R, l, uid), days: clone(days), st: (() => { const p = stPart(R.st, (s) => s.league_id === l.league_id); p.sessions = p.sessions.map((s) => { const c = { ...s }; delete c.league_id; return c; }); return p; })() }; // 本物（schema.sql の st.sessions）と同じ＝日に league_id を付けない
  }
  if (args.since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
  return { ok: true, read_ver: R.read_ver, room, st: stPart(R.st, (s) => !s.league_id), leagues: R.leagues.map((l) => lgOut(R, l, uid)) };
}
async function mjWrite(dev, uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R || !roleOf(R, uid)) return { ok: false, err: 'gone' };
  const c = ctl(dev);
  if (c.forceWrite.length) return c.forceWrite.shift();
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  if (R.closed) return { ok: false, err: 'bad', at: 'closed' };
  if (c.holdLeagueAdd && a.p_ops.some((o) => o.op === 'session_add' && o.league_id)) { const ms = c.holdLeagueAdd; c.holdLeagueAdd = 0; await sleep(ms); }
  const r = fakeApply(R, a.p_ops, uid);
  if (!r.ok) { R.results.set(a.p_op_id, r); return r; }
  R.st = r.st; R.days = r.days; R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
function myRooms(uid) {
  return { ok: true, rooms: [...DB.entries()].filter(([, R]) => roleOf(R, uid)).map(([rid, R], i) => ({ room_id: rid, kind: R.kind, name: R.name, role: roleOf(R, uid), closed: R.closed, created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), last_write_at: null })) };
}
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const send = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: o, error: null, status: 200 })); };
    if (fn === 'mj_read') { LOG.push({ dev, fn, what: args.p_what, args: clone(args.p_args || {}) }); send(mjRead(uid, args)); return; }
    if (fn === 'mj_write') { const e = { dev, fn, op_id: args.p_op_id, ops: clone(args.p_ops) }; LOG.push(e); e.res = await mjWrite(dev, uid, args); send(e.res); return; }
    if (fn === 'mj_my_rooms') { send(myRooms(uid)); return; }
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
  if (mutate && mutate.file && f.replace(/\\/g, '/').endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

/* 台の種の形 */
const day = (sid, date = TODAY) => ({ op: 'session_add', session_id: sid, date, rate: LR4.rate, league_id: LID });
const tb = (tid, sid, label, alt) => ({ op: 'table_add', table_id: tid, session_id: sid, label, ...(alt ? { alt: true } : {}) });
const seats = (tid, s) => ({ op: 'table_seats', table_id: tid, seats: s });
const H = (hid, tid, s, cells) => ({ op: 'hanchan_start', hanchan_id: hid, table_id: tid, seats: s, cells });

async function run(br, port) {
  let pass = 0, fail = 0; const bad = []; const hold = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };
  DB.clear(); LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = [];
  const device = async (dev, uid, seedLs) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, s]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs || {}]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 20000);
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    pg.on('console', (m) => { if (m.type() === 'error') bad.push('頁の console ' + dev + ': ' + m.text().slice(0, 200)); });
    return { pg, ctx };
  };
  const ctlRoom = (rid, uid) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: uid === 'u1' ? 'kan' : 'nyu', owner: uid === 'u1', rules: RULES, channel_key: 'ch-' + rid, at: 1 });
  const seedOf = (uid, rid) => ({ ['mj-rooms:' + uid]: [ctlRoom(rid, uid)] });
  const openL = async (pg, rid, lid = LID) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}&league=${lid}`); try { await pg.waitForSelector('#vRoom .r-top', { timeout: SELF ? 6000 : 10000 }); } catch (e) { console.log((await pg.content()).slice(0, 2000)); throw e; } };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const opsOf = (dev, name) => writes(dev).flatMap((w) => w.ops).filter((o) => o.op === name);
  const reads = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_read').length;
  const waitFor = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const fill = async (pg, cells) => { await pg.waitForSelector('[data-c="0"]'); for (let i = 0; i < cells.length; i++) await put(pg, i, cells[i]); await kpk(pg, 'ok'); await pg.click('#eOk'); };
  const tabs = (pg) => pg.evaluate(() => [...document.querySelectorAll('#rTaku [data-tk]')].map((b) => ({ tid: b.dataset.tk, t: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })));
  const onTab = async (pg) => ((await tabs(pg)).find((x) => x.on) || {}).tid || null;
  const tapTab = (pg, tid) => pg.$eval('#rTaku [data-tk="' + tid + '"]', (b) => b.click()); // 横へ流さずに押す（見える所へ送るのは頁の仕事）
  const tabVisible = (pg) => pg.evaluate(() => { const tk = document.querySelector('#rTaku'); const b = tk && tk.querySelector('[aria-pressed="true"]'); if (!b) return false; const a = tk.getBoundingClientRect(), c = b.getBoundingClientRect(); return c.left >= a.left - 1 && c.right <= a.right + 1; });
  const title = (pg) => txt(pg, '#title');
  const PM = (m, k = 'chip') => '#vRoom .r-pm[data-m="' + m + '"][data-k="' + k + '"][data-a="1"]';
  const aizu = (pg, rid) => pg.evaluate((k) => window.__aizu(k), 'ch-' + rid);
  const shot = async (pg, name) => { if (SHOT && !SELF) await pg.screenshot({ path: path.join(SHOT, 'd2_' + name + (CHROMIUM ? '_chromium' : '') + '.png'), fullPage: true }); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const S1 = U(1), T = (i) => U(100 + i);
  let NM = '';
  const dbg = async (pg) => pg.evaluate(() => { const tk = document.querySelector('#rTaku'); const b = tk && tk.querySelector('[aria-pressed="true"]'); return tk && b ? { sl: tk.scrollLeft, cw: tk.clientWidth, sw: tk.scrollWidth, bl: b.getBoundingClientRect().left, br: b.getBoundingClientRect().right, tl: tk.getBoundingClientRect().left, tr: tk.getBoundingClientRect().right } : null; });
  try {
    // T1 卓 12 本で全部の［卓n］に届く・今の卓が見える所へ送る・高さは字に合わせる（14px→36）・［＋卓］で13本目（名は卓13・送る・見える所へ）
    if (want('T1')) try { NM = 'T1';
      mkRoom('r1'); mkLeague('r1', { league_id: LID, rules: LR4 });
      seed('r1', [day(S1), ...Array.from({ length: 12 }, (_, i) => tb(T(i + 1), S1, '卓' + (i + 1)))]);
      const A = await device('A1', 'u1', seedOf('u1', 'r1'));
      await openL(A.pg, 'r1'); await A.pg.waitForSelector('#rTaku [data-tk]');
      const tl = await tabs(A.pg);
      ok('T1 卓が12本並ぶ（卓1〜卓12）', tl.length === 12 && tl.every((x, i) => x.t === '卓' + (i + 1)), tl.map((x) => x.t));
      ok('T1 開いた時は卓1', tl[0] && tl[0].on);
      ok('T1 題は「日付 卓1」・‹ リーグの名前', (await title(A.pg)) === Number(TODAY.slice(5, 7)) + '/' + Number(TODAY.slice(8, 10)) + ' 卓1' && ((await txt(A.pg, '#barBack')) || '').includes('金曜リーグ'), [await title(A.pg), await txt(A.pg, '#barBack')]);
      const hs = await A.pg.evaluate(() => [...document.querySelectorAll('#rTaku .r-tk')].map((b) => Math.round(b.getBoundingClientRect().height)));
      ok('T1 卓のボタンは高さ36（14px 字）', hs.length === 13 && hs.every((h) => h === 36), hs);
      let reach = 0;
      for (let i = 12; i >= 1; i--) { await tapTab(A.pg, T(i)); if ((await onTab(A.pg)) === T(i) && (await title(A.pg)).endsWith(' 卓' + i) && (await tabVisible(A.pg))) reach++; }
      ok('T1 12本の全部に届く（押すとその卓・題・見える所）', reach === 12, reach);
      await A.pg.click('#rTakuAdd');
      await waitFor(async () => (await tabs(A.pg)).length === 13, 5000);
      const t13 = (await tabs(A.pg))[12];
      ok('T1 ［＋卓］で卓13が足されて開く', t13 && t13.t === '卓13' && t13.on, await tabs(A.pg));
      await sleep(300);
      ok('T1 13本目が見える所へ送られる', await tabVisible(A.pg), await dbg(A.pg));
      await waitFor(() => opsOf('A1', 'table_add').length >= 1, 8000);
      const ta = opsOf('A1', 'table_add');
      ok('T1 送った table_add は卓13・その日・alt 無し', ta.length === 1 && ta[0].label === '卓13' && ta[0].session_id === S1 && ta[0].alt === undefined, ta);
      ok('T1 倉庫に13本', (await waitFor(() => DB.get('r1').st.tables.filter((t) => t.session_id === S1).length === 13, 5000)) >= 0);
      await shot(A.pg, 'taku13');
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T2 卓2で入力中に別の端末の合図（読み直し）→ 保存が卓2に入る・頁は卓2のまま
    if (want('T2')) try { NM = 'T2';
      mkRoom('r2'); mkLeague('r2', { league_id: LID, rules: LR4 });
      seed('r2', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2'), seats(T(1), M.slice(0, 4)), seats(T(2), M.slice(4, 8)), H(U(201), T(1), M.slice(0, 4), [40000, 30000, 20000, 10000])]);
      const A = await device('A2', 'u1', seedOf('u1', 'r2'));
      await openL(A.pg, 'r2'); await A.pg.waitForSelector('#rTaku [data-tk]');
      await tapTab(A.pg, T(2));
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      const r0 = reads('A2');
      seedAs('r2', 'u1', [H(U(202), T(1), M.slice(0, 4), [35000, 30000, 25000, 10000])]); // 別の端末が卓1に入れた
      await aizu(A.pg, 'r2');
      await waitFor(() => reads('A2') > r0, 5000); await sleep(400);
      await fill(A.pg, ['40000', '30000', '20000', '10000']);
      await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('A2', 'hanchan_start').length >= 1, 8000);
      const hs = opsOf('A2', 'hanchan_start');
      ok('T2 保存は卓2へ（hanchan_start の table_id）', hs.length === 1 && hs[0].table_id === T(2), hs.map((h) => h.table_id));
      ok('T2 倉庫の卓2に1本', (await waitFor(() => DB.get('r2').st.hanchans.filter((h) => h.table_id === T(2)).length === 1, 5000)) >= 0);
      ok('T2 読み直しの後も頁は卓2のまま', (await onTab(A.pg)) === T(2), await tabs(A.pg));
      ok('T2 卓2が取り消されていないので帯は無い', !(await has(A.pg, '#rTakuNote')));
      await shot(A.pg, 'taku2');
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T3 チップ±の直後に卓を替えても前の卓に入る（まとめの鍵に卓）
    if (want('T3')) try { NM = 'T3';
      mkRoom('r3'); mkLeague('r3', { league_id: LID, rules: LR4 });
      seed('r3', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2'), seats(T(1), M.slice(0, 4)), seats(T(2), M.slice(4, 8))]);
      const A = await device('A3', 'u1', seedOf('u1', 'r3'));
      await openL(A.pg, 'r3'); await A.pg.waitForSelector(PM('m1'));
      await A.pg.click(PM('m1'));
      await tapTab(A.pg, T(2)); // 0.3秒のまとめより前に替える
      await A.pg.waitForSelector(PM('m5'));
      await A.pg.click(PM('m5'));
      await waitFor(() => opsOf('A3', 'extra_add').length >= 2, 8000);
      const xa = opsOf('A3', 'extra_add');
      ok('T3 卓1で押したチップは卓1へ', xa.some((o) => o.member_id === 'm1' && o.table_id === T(1)) && !xa.some((o) => o.member_id === 'm1' && o.table_id !== T(1)), xa);
      ok('T3 卓2で押したチップは卓2へ', xa.some((o) => o.member_id === 'm5' && o.table_id === T(2)), xa);
      await waitFor(() => DB.get('r3').st.extras.length >= 2, 5000);
      const ex = DB.get('r3').st.extras;
      ok('T3 倉庫にも卓ごとに入った（held 無し）', ex.some((e) => e.table_id === T(1) && e.member_id === 'm1' && e.value === 1) && ex.some((e) => e.table_id === T(2) && e.member_id === 'm5' && e.value === 1), ex);
      ok('T3 並びが空（止まっていない）', (await waitFor(async () => ((await ls(A.pg, 'mj-league-out:u1:' + LID)) || []).length === 0, 5000)) >= 0 && !(await has(A.pg, '#rHeld')));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T4 L でない人の1回目（半荘0本の卓）＝table_seats を送らず hanchan_start の seats だけ・部屋に入る（held にならない）・L は今のまま table_seats を送る
    if (want('T4')) try { NM = 'T4';
      mkRoom('r4'); mkLeague('r4', { league_id: LID, rules: LR4 });
      seed('r4', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2')]);
      const B = await device('B4', 'u2', seedOf('u2', 'r4'));
      await openL(B.pg, 'r4'); await B.pg.waitForSelector('#rAdd');
      await B.pg.click('#rAdd'); await B.pg.waitForSelector('#pGo');
      for (const m of M.slice(0, 4)) await B.pg.click('#pBase [data-pick="' + m + '"]');
      await B.pg.click('#pGo');
      await fill(B.pg, ['40000', '30000', '20000', '10000']);
      await B.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('B4', 'hanchan_start').length >= 1 && DB.get('r4').st.hanchans.length === 1, 8000);
      ok('T4 L でない人は table_seats を送らない', opsOf('B4', 'table_seats').length === 0, opsOf('B4', 'table_seats'));
      ok('T4 1回目の点が部屋に入る', DB.get('r4').st.hanchans.length === 1 && DB.get('r4').st.hanchans[0].table_id === T(1));
      ok('T4 held にならない（並びが空・止まった帯が無い）', ((await ls(B.pg, 'mj-league-out:u2:' + LID)) || []).length === 0 && !(await has(B.pg, '#rHeld')));
      // 名前の列から（L でない人は決めるだけにしない＝点を入れる所へ）
      await tapTab(B.pg, T(2));
      await B.pg.click('#vRoom [data-seats]'); await B.pg.waitForSelector('#pGo');
      ok('T4 L でない人の名前の列は「この4人で始める」', ((await txt(B.pg, '#pGo')) || '').includes('始める'), await txt(B.pg, '#pGo'));
      // L は今のまま（半荘0本の卓で table_seats）
      const A = await device('A4', 'u1', seedOf('u1', 'r4'));
      await openL(A.pg, 'r4'); await A.pg.waitForSelector('#rTaku [data-tk]');
      await tapTab(A.pg, T(2));
      await A.pg.click('#vRoom [data-seats]'); await A.pg.waitForSelector('#pGo');
      for (const m of M.slice(4, 8)) await A.pg.click('#pBase [data-pick="' + m + '"]');
      await A.pg.click('#pGo');
      await waitFor(() => opsOf('A4', 'table_seats').length >= 1, 8000);
      const ts = opsOf('A4', 'table_seats');
      ok('T4 L は半荘0本の卓で table_seats を送る（卓2）', ts.length === 1 && ts[0].table_id === T(2), ts);
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T5 2台で同じ日（dup の後に1つの日）＝L の2台が同時に開く
    if (want('T5')) try { NM = 'T5';
      mkRoom('r5'); mkLeague('r5', { league_id: LID, rules: LR4 });
      const A = await device('A5', 'u1', seedOf('u1', 'r5')), B = await device('B5', 'u1', seedOf('u1', 'r5'));
      ctl('A5').holdLeagueAdd = 1500; // A の session_add は倉庫で待たされる＝B が先に日を作り、A は dup
      const pa = openL(A.pg, 'r5');
      await sleep(300);
      await openL(B.pg, 'r5'); await pa;
      await waitFor(async () => (await onTab(A.pg)) && (await onTab(B.pg)), 10000);
      const ss = DB.get('r5').st.sessions.filter((s) => s.league_id === LID);
      ok('T5 倉庫のリーグの日は1つ', ss.length === 1, ss.length);
      const t1 = DB.get('r5').st.tables.filter((t) => ss[0] && t.session_id === ss[0].session_id);
      ok('T5 両方の端末が同じ日の卓1を開く', t1.length === 1 && (await onTab(A.pg)) === t1[0].table_id && (await onTab(B.pg)) === t1[0].table_id, [await onTab(A.pg), await onTab(B.pg), t1.map((t) => t.table_id)]);
      const sa = [...opsOf('A5', 'session_add'), ...opsOf('B5', 'session_add')];
      ok('T5 session_add は league_id とリーグの主の rate（50）', sa.length >= 1 && sa.every((o) => o.league_id === LID && o.rate === LR4.rate), sa);
      ok('T5 dup の字は出さない', !(await has(A.pg, '#rStartMsg')) && !(await has(B.pg, '#rStartMsg')), [await txt(A.pg, '#rStartMsg'), await txt(B.pg, '#rStartMsg')]);
      ok('T5 開いている日がある時は新しく作らない（もう一度開く）', await (async () => { const n0 = opsOf('B5', 'session_add').length; await openL(B.pg, 'r5'); await waitFor(async () => !!(await onTab(B.pg)), 5000); await sleep(500); return opsOf('B5', 'session_add').length === n0; })());
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T6 L でない人に［＋卓］が無い・L にはある／T6b L でない入で開いている日が無い＝待つ帯・作らない
    if (want('T6')) try { NM = 'T6';
      mkRoom('r6'); mkLeague('r6', { league_id: LID, rules: LR4 });
      const B = await device('B6', 'u2', seedOf('u2', 'r6'));
      await openL(B.pg, 'r6'); await sleep(800);
      ok('T6 L でない入・日が無い＝「L が対局を始めるのを待っています」', ((await txt(B.pg, '#rLWait')) || '') === 'L が対局を始めるのを待っています', await txt(B.pg, '#rLWait'));
      ok('T6 L でない入は日を作らない・［n回目の点を入れる］も出さない', opsOf('B6', 'session_add').length === 0 && !(await has(B.pg, '#rAdd')));
      await shot(B.pg, 'matsu');
      seed('r6', [day(S1), tb(T(1), S1, '卓1')]);
      await aizu(B.pg, 'r6');
      await B.pg.waitForSelector('#rTaku [data-tk]');
      ok('T6 L が始めたら L でない入も開く（待つ帯が消える）', !(await has(B.pg, '#rLWait')) && (await has(B.pg, '#rAdd')));
      ok('T6 L でない人に［＋卓］が無い', !(await has(B.pg, '#rTakuAdd')));
      const A = await device('A6', 'u1', seedOf('u1', 'r6'));
      await openL(A.pg, 'r6'); await A.pg.waitForSelector('#rTaku [data-tk]');
      ok('T6 L には［＋卓］がある', await has(A.pg, '#rTakuAdd'));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T7 もう一方の卓の帯・卓の名に（3人）・［＋卓］で主／もう一方を選ぶ
    if (want('T7')) try { NM = 'T7';
      mkRoom('r7'); mkLeague('r7', { league_id: LID, rules: LR4, rules_alt: LR3 });
      seed('r7', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2'), tb(T(3), S1, '卓3', true)]);
      const A = await device('A7', 'u1', seedOf('u1', 'r7'));
      await openL(A.pg, 'r7'); await A.pg.waitForSelector('#rTaku [data-tk]');
      const tl = await tabs(A.pg);
      ok('T7 卓3 は「卓3（3人）」・卓1・卓2 は人数を付けない', tl.length === 3 && tl[2].t === '卓3（3人）' && tl[0].t === '卓1' && tl[1].t === '卓2', tl.map((x) => x.t));
      ok('T7 主の卓には帯が無い', !(await has(A.pg, '#rAltObi')));
      await tapTab(A.pg, T(3));
      ok('T7 もう一方の卓の帯「3人の卓（リーグのもう一方のルール）」', (await txt(A.pg, '#rAltObi')) === '3人の卓（リーグのもう一方のルール）', await txt(A.pg, '#rAltObi'));
      ok('T7 卓3 の名前の列は3つ', (await A.pg.$$('#vRoom .r-hyou thead [data-seats]')).length === 3);
      await shot(A.pg, 'alt');
      await A.pg.click('#rTakuAdd');
      ok('T7 rules_alt の在る日の［＋卓］は「4人の卓／3人の卓」を選ぶ', (await txt(A.pg, '#rTakuMain')) === '4人の卓' && (await txt(A.pg, '#rTakuAlt')) === '3人の卓', [await txt(A.pg, '#rTakuMain'), await txt(A.pg, '#rTakuAlt')]);
      ok('T7 選ぶまでは送らない', opsOf('A7', 'table_add').length === 0);
      await A.pg.click('#rTakuMain');
      await waitFor(() => opsOf('A7', 'table_add').length >= 1, 8000);
      const ta = opsOf('A7', 'table_add');
      ok('T7 主の卓は alt 無しの table_add（卓4）', ta.length === 1 && ta[0].alt === undefined && ta[0].label === '卓4', ta);
      if (LIB.KEYS_OF('table_add').includes('alt')) { // W2（lib に alt が入ってから）
        await A.pg.click('#rTakuAdd'); await A.pg.click('#rTakuAlt');
        await waitFor(() => opsOf('A7', 'table_add').length >= 2, 8000);
        const t2 = opsOf('A7', 'table_add')[1];
        ok('W2 もう一方の卓は alt:true（卓5）', t2 && t2.alt === true && t2.label === '卓5', t2);
        await waitFor(() => DB.get('r7').st.tables.length === 5, 5000);
        ok('W2 倉庫の卓5は3人', (DB.get('r7').st.tables.find((t) => t.table_id === t2.table_id) || { rules: {} }).rules.players === 3);
      } else hold.push('W2 ［＋卓］のもう一方の卓（alt:true）を写しに当てて送る＝lib の table_add に alt が入ってから');
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T8 選んだ卓が取り消された／消えた時だけ1つ目へ・帯（止め2）
    if (want('T8')) try { NM = 'T8';
      mkRoom('r8'); mkLeague('r8', { league_id: LID, rules: LR4 });
      seed('r8', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2'), tb(T(3), S1, '卓3'), seats(T(1), M.slice(0, 4)), seats(T(2), M.slice(4, 8))]);
      const A = await device('A8', 'u1', seedOf('u1', 'r8'));
      await openL(A.pg, 'r8'); await A.pg.waitForSelector('#rTaku [data-tk]');
      await tapTab(A.pg, T(2));
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]'); // 卓2で入力を開いたまま
      const r0 = reads('A8');
      seedAs('r8', 'u1', [{ op: 'table_edit', table_id: T(2), voided: true }]); // 別の端末が卓2を取り消した
      await aizu(A.pg, 'r8'); await waitFor(() => reads('A8') > r0, 5000); await sleep(400);
      await fill(A.pg, ['40000', '30000', '20000', '10000']);
      await sleep(600);
      ok('T8 入力を開いた卓2が取り消されても卓1へは入れない（取り違えない）', DB.get('r8').st.hanchans.filter((h) => h.table_id === T(1)).length === 0 && !opsOf('A8', 'hanchan_start').some((o) => o.table_id === T(1)), opsOf('A8', 'hanchan_start'));
      if (await has(A.pg, '#eOk')) await A.pg.click('#barBack');
      await A.pg.waitForSelector('#vRoom .r-top');
      ok('T8 取り消された卓2から1つ目（卓1）へ移る', (await onTab(A.pg)) === T(1), await tabs(A.pg));
      ok('T8 帯が出る', !!(await txt(A.pg, '#rTakuNote')), await txt(A.pg, '#rTakuNote'));
      ok('T8 取り消した卓2は並びから消える', !(await tabs(A.pg)).some((x) => x.tid === T(2)), await tabs(A.pg));
      await tapTab(A.pg, T(3));
      ok('T8 卓を選んだら帯は消える', !(await has(A.pg, '#rTakuNote')));
      const r1 = reads('A8');
      seedAs('r8', 'u1', [H(U(801), T(1), M.slice(0, 4), [40000, 30000, 20000, 10000])]);
      await aizu(A.pg, 'r8'); await waitFor(() => reads('A8') > r1, 5000); await sleep(400);
      ok('T8 取り消していない卓3は読み直しの後も残る（帯なし）', (await onTab(A.pg)) === T(3) && !(await has(A.pg, '#rTakuNote')), await tabs(A.pg));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T9 L：期間の外は帯で作らない・倉庫の bad date／bad rate／mj_role need L の字（errText way 'league'）
    if (want('T9')) try { NM = 'T9';
      mkRoom('r9'); mkLeague('r9', { league_id: LID_TERM, rules: LR4, date_from: '2020-01-01', date_to: '2020-12-31' });
      const A = await device('A9', 'u1', seedOf('u1', 'r9'));
      await openL(A.pg, 'r9', LID_TERM); await sleep(800);
      ok('T9 期間の外＝帯「今日はこのリーグの期間の外です」', ((await txt(A.pg, '#rStartMsg')) || '') === '今日はこのリーグの期間の外です', await txt(A.pg, '#rStartMsg'));
      ok('T9 期間の外は session_add を送らない', opsOf('A9', 'session_add').length === 0);
      await shot(A.pg, 'kikan');
      mkRoom('r9b'); mkLeague('r9b', { league_id: LID, rules: LR4 });
      ctl('A9b').forceWrite.push({ ok: false, err: 'bad', what: 'rate' });
      const A2 = await device('A9b', 'u1', seedOf('u1', 'r9b'));
      await openL(A2.pg, 'r9b'); await waitFor(() => has(A2.pg, '#rStartMsg'), 5000);
      ok('T9 倉庫の bad rate の字', (await txt(A2.pg, '#rStartMsg')) === '倉庫で止まりました。もう一度押しても同じです。', await txt(A2.pg, '#rStartMsg'));
      const et = await A2.pg.evaluate(async () => { const m = await import('/js/gamen-core.mjs'); const f = (r) => m.errText(r, 'league'); return [f({ ok: false, err: 'bad', what: 'date' }), f({ ok: false, err: 'bad', what: 'alt' }), f({ ok: false, err: 'bad', what: 'rate' }), f({ ok: false, err: 'mj_role', need: 'L' }), f({ ok: false, err: 'dup', what: 'session', session_id: 'x' }), f({ ok: false, err: 'mj_role' })]; });
      ok('T9 errText way league の5つの字（dup は空）', JSON.stringify(et.slice(0, 5)) === JSON.stringify(['今日はこのリーグの期間の外です', 'この日はもう一方の卓を作れません', '倉庫で止まりました。もう一度押しても同じです。', '卓と日を足せるのはリーグの L だけです', '']), et);
      ok('T9 need の無い mj_role は D1 の字のまま', et[5] === 'この操作は管か持ち主だけです（リーグの設定はそのリーグの L だけ）。', et[5]);
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T10 league.html の［このリーグで対局を始める］→ taikyoku.html?room=&league=（控えに部屋が無い端末でも開く）・終えた部屋には出さない
    if (want('T10')) try { NM = 'T10';
      DB.clear(); // 一覧は u1 の入っている部屋の全部＝前の段の部屋を出さない
      mkRoom('ra'); mkLeague('ra', { league_id: LID, rules: LR4 });
      mkRoom('rb', { closed: true }); mkLeague('rb', { league_id: LID_ALT, rules: LR4, name: '終わったリーグ' });
      seed('ra', [day(S1), tb(T(1), S1, '卓1')]);
      const A = await device('A10', 'u1', {});
      await A.pg.goto(`http://127.0.0.1:${port}/league.html`); await A.pg.waitForSelector('#vList .lg-room');
      const links = await A.pg.evaluate(() => [...document.querySelectorAll('[data-play]')].map((a) => ({ lid: a.dataset.play, href: a.getAttribute('href'), t: a.textContent })));
      ok('T10 終えていない部屋のリーグに［このリーグで対局を始める］', links.length === 1 && links[0].lid === LID && links[0].t === 'このリーグで対局を始める', links);
      ok('T10 行き先は taikyoku.html?room=<id>&league=<league_id>', links[0] && links[0].href === 'taikyoku.html?room=ra&league=' + LID, links[0]);
      const bh = await A.pg.evaluate(() => { const a = document.querySelector('[data-play]'); return a ? Math.round(a.getBoundingClientRect().height) : 0; });
      ok('T10 ボタンの高さ36（14px 字）', bh === 36, bh);
      await shot(A.pg, 'league_list');
      await A.pg.click('[data-play]');
      await A.pg.waitForSelector('#rTaku [data-tk]');
      ok('T10 押すとそのリーグの日の卓1が開く（控えに部屋が無くても）', (await onTab(A.pg)) === T(1) && (await title(A.pg)).endsWith(' 卓1'));
      ok('T10 読みは mj_read league（league_id）', LOG.some((x) => x.dev === 'A10' && x.fn === 'mj_read' && x.what === 'league' && x.args.league_id === LID));
      ok('T10 写しは mj-league:<uid>:<league_id>（部屋の写しと別）', !!(await ls(A.pg, 'mj-league:u1:' + LID)) && !(await ls(A.pg, 'mj-room:u1:ra')));
      ok('T10 控えの部屋の一覧に足さない', !((await ls(A.pg, 'mj-rooms:u1')) || []).some((r) => r.room_id === 'ra'));
      await A.pg.click('#barBack'); await A.pg.waitForSelector('#vList');
      ok('T10 ‹ リーグの名前 でリーグの頁へ戻る', A.pg.url().includes('/league.html?room=ra'), A.pg.url());
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // T11 ふつうの部屋（リーグでない）＝卓の並びは出さない・部屋の st にリーグの日は出ない（読みは 'room'）
    if (want('T11')) try { NM = 'T11';
      mkRoom('rc'); mkLeague('rc', { league_id: LID, rules: LR4 });
      seed('rc', [{ op: 'session_add', session_id: U(2), date: TODAY, rate: 100 }, tb(T(9), U(2), '卓1'), seats(T(9), M.slice(0, 4)), day(S1), tb(T(1), S1, '卓1')]); // ふつうの開催（卓1）とリーグの日
      const A = await device('A11', 'u1', { ...seedOf('u1', 'rc'), ['mj-synced:u1:rc']: '1' });
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=rc`); await A.pg.waitForSelector('#vRoom .r-top'); await sleep(600);
      ok('T11 ふつうの部屋はふつうの開催の卓を開く（窓が出る）', await has(A.pg, PM('m1')));
      ok('T11 ふつうの部屋に卓の並びが無い', !(await has(A.pg, '#rTaku')));
      ok('T11 ふつうの部屋の読みは room だけ', LOG.filter((x) => x.dev === 'A11' && x.fn === 'mj_read').every((x) => x.what === 'room'));
      ok('T11 ‹ ホーム・題は対局のまま', ((await txt(A.pg, '#barBack')) || '').includes('ホーム') && (await title(A.pg)) === '対局');
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad, hold };
}

const G = 'js/gamen-room.mjs';
const MUT = [
  { file: G, from: "      if (cur && cur.session_id === sid && !cur.voided) { setTable(cur); return; }\n", to: '', name: '読み直しで選んだ卓を残さない（T2・T8）', only: 'T2,T8' },
  { file: G, from: "table_id: e.tid, seats: e.seats,", to: 'table_id: table.table_id, seats: e.seats,', name: '保存を開いた時の卓でなく今の卓へ（T8）', only: 'T8' },
  { file: G, from: "ops.push({ op: 'extra_add', table_id: tid, member_id: mid,", to: "ops.push({ op: 'extra_add', table_id: table.table_id, member_id: mid,", name: '± を流す時に今の卓へ（T3）', only: 'T3' },
  { file: G, from: "      if (!nonL(t) && !st.hanchans.some(", to: '      if (!st.hanchans.some(', name: 'L でない人の1回目にも table_seats（T4）', only: 'T4' },
  { file: G, from: "picking = pickOf({ seats: preSeats() || [], only: !nonL(table) });", to: 'picking = pickOf({ seats: preSeats() || [], only: true });', name: 'L でない人の名前の列を「決める」だけにする（T4）', only: 'T4' },
  { file: G, from: "    const canAdd = isL() && !room.closed", to: '    const canAdd = !room.closed', name: 'L でない人にも［＋卓］（T6）', only: 'T6' },
  { file: G, from: "(isL() ? (outOfTerm() ? 'term' : null) : 'wait')", to: "(true ? (outOfTerm() ? 'term' : null) : 'wait')", name: 'L でない入も日を作る（T6）', only: 'T6' },
  { file: G, from: "    if (isAlt(table)) h +=", to: '    if (false) h +=', name: 'もう一方の卓の帯を出さない（T7）', only: 'T7' },
  { file: G, from: "(alt ? '<small>（' + chainLast(t).rules.players + '人）</small>' : '')", to: "''", name: '卓の名に（3人）を付けない（T7）', only: 'T7' },
  { file: G, from: "if (d && d.rules_alt) { takuPick = !takuPick; render(); return; }", to: '', name: 'rules_alt の日でも選ばずに足す（T7）', only: 'T7' },
  { file: G, from: "    takuScroll(tkLeft);\n", to: '', name: '今の卓を見える所へ送らない（T1）', only: 'T1' },
  { file: G, from: "label: '卓' + (st.tables.filter((t) => t.session_id === sid).length + 1) };", to: "label: '卓' };", name: '［＋卓］の名を卓n にしない（T1）', only: 'T1' },
  { file: G, from: "      if (table && table.session_id === sid && t) takuNote =", to: '      if (false) takuNote =', name: '卓が取り消された時に帯を出さない（T8）', only: 'T8' },
  { file: G, from: "st.tables.filter((t) => t.session_id === sid && !t.voided && !st.tables.some(", to: 'st.tables.filter((t) => t.session_id === sid && !st.tables.some(', name: '取り消した卓も並べる（T8）', only: 'T8' },
  { file: G, from: "rate: sc && sc.rules && sc.rules.rate !== undefined ? sc.rules.rate : null, league_id: LG }", to: 'rate: room.rules.rate, league_id: LG }', name: 'リーグの日の rate を部屋の値にする（T5）', only: 'T5' },
  { file: G, from: "if (d && d.ok === false && d.err === 'dup' && d.what === 'session') {", to: 'if (false) {', name: 'dup で読み直して開かない（T5）', only: 'T5' },
  { file: G, from: "      if (lgw === 'term') fail = errText(", to: "      if (lgw === 'term' && false) fail = errText(", name: '期間の外でも作りに行く（T9）', only: 'T9' },
  { file: G, from: "p_what: 'league', p_args:", to: "p_what: 'room', p_args:", name: 'リーグの対局を room で読む（T10・T2）', only: 'T10,T2' },
  { file: G, from: "  const KEYR = LG ? 'mj-league:' + uid + ':' + LG : KEY(uid, rid);", to: '  const KEYR = KEY(uid, rid);', name: 'リーグの写しを部屋の鍵に置く（T10）', only: 'T10' },
  { file: G, from: "    if (!LG || !table) return '';", to: "    if (!table) return '';", name: 'ふつうの部屋にも卓の並び（T11）', only: 'T11' },
  { file: 'js/gamen-league.mjs', from: "      if (!closed) h += '<div class=\"li li-sub lg-play\">", to: "      if (false) h += '<div class=\"li li-sub lg-play\">", name: 'リーグに［このリーグで対局を始める］を出さない（T10）', only: 'T10' },
  { file: 'js/gamen-core.mjs', from: "if (at === 'alt') return 'この日はもう一方の卓を作れません';", to: "if (at === 'alt') return 'x';", name: 'bad alt の字を変える（T9）', only: 'T9' },
  { file: 'js/gamen-core.mjs', from: "if (e === 'dup' && at === 'session') return '';", to: '', name: 'リーグの日の dup に字を出す（T9）', only: 'T9' },
  { file: 'js/gamen-taikyoku.mjs', from: "if (!room && lid) room = { room_id: roomId, kind: 'shared', name: '', role: null };", to: '', name: '控えに無い部屋のリーグを開かない（T10）', only: 'T10' },
  { file: 'css/gamen.css', from: ".r-tk { position: relative; flex: none; display: inline-flex; align-items: center; height: 36px;", to: '.r-tk { position: relative; flex: none; display: inline-flex; align-items: center; height: 30px;', name: '卓のボタンの高さを字に合わせない（T1）', only: 'T1' },
];
(async () => {
  LIB = await import(pathToFileURL(path.join(ROOT, 'lib/room-state.mjs')).href);
  RL = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RL.rulesOk({ ...RL.defaultRules(4), rate: 100, chip_pt10: 20 }).rules;      // 部屋のルール
  LR4 = RL.rulesOk({ ...RL.defaultRules(4), rate: 50, chip_pt10: 20 }).rules;         // リーグの主（rate は部屋と違う 50）
  LR3 = RL.rulesOk({ ...RL.defaultRules(3), rate: 50, chip_pt10: 20 }).rules;         // リーグのもう一方（3人）
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (CHROMIUM ? pw.chromium : pw.webkit).launch();
  const nm = CHROMIUM ? 'Chromium' : 'WebKit';
  let code = 0;
  if (!SELF) {
    const r = await run(br, port);
    console.log(nm + ' ' + r.pass + '/' + (r.pass + r.fail));
    for (const b of r.bad) console.log('  ✗ ' + b);
    for (const h of r.hold) console.log('  保留（倉庫と lib が入ってから）: ' + h);
    code = r.fail ? 1 : 0;
  } else {
    let red = 0;
    for (const m of MUT) {
      mutate = m; process.env.ONLY = m.only || '';
      const r = await run(br, port);
      if (r.fail) red++;
      console.log((r.fail ? '赤 ' : '★緑（効いていない）') + m.name + '  ✗' + r.fail + (r.fail ? '  例: ' + r.bad[0].slice(0, 140) : ''));
    }
    mutate = null;
    console.log(nm + ' 壊し ' + red + '/' + MUT.length + ' 赤'); code = red === MUT.length ? 0 : 1;
  }
  await br.close(); srv.close(); process.exit(code);
})();
