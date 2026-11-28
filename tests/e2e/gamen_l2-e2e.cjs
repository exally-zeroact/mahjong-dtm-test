// L A23・A25・D3 リーグの対局の画面（l_sadame v1.3 §1・§3 の e2e）＋8b（a25r_sadame）。台は gamen_d2-e2e.cjs の写し（偽の倉庫）。
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
  const shot = async (pg, name) => { if (SHOT && !SELF) await pg.screenshot({ path: path.join(SHOT, 'l2_' + name + (CHROMIUM ? '_chromium' : '') + '.png'), fullPage: true }); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const S1 = U(1), T = (i) => U(100 + i);
  let NM = '';
  const dbg = async (pg) => pg.evaluate(() => { const tk = document.querySelector('#rTaku'); const b = tk && tk.querySelector('[aria-pressed="true"]'); return tk && b ? { sl: tk.scrollLeft, cw: tk.clientWidth, sw: tk.scrollWidth, bl: b.getBoundingClientRect().left, br: b.getBoundingClientRect().right, tl: tk.getBoundingClientRect().left, tr: tk.getBoundingClientRect().right } : null; });
  try {
    const vtxt = (pg) => txt(pg, '#vRoom');
    const tapPick = (pg, m) => pg.$eval('#pBase [data-pick="' + m + '"]', (b) => b.click());
    const four = ['40000', '30000', '20000', '10000'];
    const groupOf = (dev) => writes(dev).find((w) => w.ops.some((o) => o.op === 'hanchan_start'));

    // L1 A23 次の半荘の人（リーグの日）：卓の席 t.seats が在れば前の半荘でなくそれ／他の卓の次の席と重なれば人を選ぶ
    if (want('L1')) try { NM = 'L1';
      mkRoom('l1'); mkLeague('l1', { league_id: LID, rules: LR4 });
      seed('l1', [day(S1), tb(T(1), S1, '卓1'), H(U(301), T(1), M.slice(4, 8), [40000, 30000, 20000, 10000]), seats(T(1), M.slice(0, 4))]);
      const A = await device('L1', 'u1', seedOf('u1', 'l1'));
      await openL(A.pg, 'l1'); await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      const t1 = await vtxt(A.pg);
      ok('L1 卓の席（山田…）で開く・前の半荘の人（加藤…）でない', t1.includes(NAMES[0]) && t1.includes(NAMES[3]) && !t1.includes(NAMES[4]), t1.slice(0, 200));
      mkRoom('l1b'); mkLeague('l1b', { league_id: LID, rules: LR4 });
      seed('l1b', [day(S1), tb(T(1), S1, '卓1'), tb(T(2), S1, '卓2'), H(U(302), T(1), M.slice(0, 4), [40000, 30000, 20000, 10000]), seats(T(2), M.slice(3, 7))]);
      const B = await device('L1b', 'u1', seedOf('u1', 'l1b'));
      await openL(B.pg, 'l1b'); await B.pg.click('#rAdd');
      await waitFor(async () => (await has(B.pg, '#pGo')) || (await has(B.pg, '[data-c="0"]')), 8000);
      ok('L1 前の半荘の人（m4）が卓2の席にもいる＝人を選ぶ頁（点の頁へ行かない）', (await has(B.pg, '#pGo')) && !(await has(B.pg, '[data-c="0"]')));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L2 A23 L の［人を替える］＝保存の時に同じ組で table_seats（次の半荘も同じ人）
    if (want('L2')) try { NM = 'L2';
      mkRoom('l2'); mkLeague('l2', { league_id: LID, rules: LR4 });
      seed('l2', [day(S1), tb(T(1), S1, '卓1'), seats(T(1), M.slice(0, 4)), H(U(311), T(1), M.slice(0, 4), [40000, 30000, 20000, 10000])]);
      const A = await device('L2', 'u1', seedOf('u1', 'l2'));
      await openL(A.pg, 'l2'); await A.pg.click('#rAdd'); await A.pg.waitForSelector('#ePeople');
      await A.pg.click('#ePeople'); await A.pg.waitForSelector('#pGo');
      ok('L2 L には「この半荘だけ」を出さない', !(await has(A.pg, '#pOnly')));
      await tapPick(A.pg, 'm4'); await tapPick(A.pg, 'm5'); await A.pg.click('#pGo');
      await fill(A.pg, four); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => !!groupOf('L2'), 8000);
      const g = groupOf('L2');
      const ts = g ? g.ops.filter((o) => o.op === 'table_seats') : [];
      ok('L2 hanchan_start と同じ組で table_seats（山田・鈴木・佐藤・加藤）', ts.length === 1 && ts[0].table_id === T(1) && JSON.stringify(ts[0].seats) === JSON.stringify(['m1', 'm2', 'm3', 'm5']), g && g.ops);
      await waitFor(() => JSON.stringify((DB.get('l2').st.tables.find((t) => t.table_id === T(1)) || {}).seats) === JSON.stringify(['m1', 'm2', 'm3', 'm5']), 5000);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      const t2 = await vtxt(A.pg);
      ok('L2 次の半荘も替えた人（加藤 入り・高橋 無し）', t2.includes(NAMES[4]) && !t2.includes(NAMES[3]), t2.slice(0, 200));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L3 A23 L でない人の［人を替える］＝その半荘だけ（hint・table_seats を送らない）
    if (want('L3')) try { NM = 'L3';
      mkRoom('l3'); mkLeague('l3', { league_id: LID, rules: LR4 });
      seed('l3', [day(S1), tb(T(1), S1, '卓1'), seats(T(1), M.slice(0, 4)), H(U(321), T(1), M.slice(0, 4), [40000, 30000, 20000, 10000])]);
      const A = await device('L3', 'u2', seedOf('u2', 'l3'));
      await openL(A.pg, 'l3'); await A.pg.click('#rAdd'); await A.pg.waitForSelector('#ePeople');
      await A.pg.click('#ePeople'); await A.pg.waitForSelector('#pGo');
      ok('L3 L でない人には「この半荘だけ」', ((await txt(A.pg, '#pOnly')) || '') === 'この半荘だけ');
      await tapPick(A.pg, 'm4'); await tapPick(A.pg, 'm5'); await A.pg.click('#pGo');
      await fill(A.pg, four); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => !!groupOf('L3'), 8000);
      const g = groupOf('L3');
      ok('L3 hanchan_start は替えた人・table_seats は送らない', g && g.res && g.res.ok === true && JSON.stringify(g.ops.find((o) => o.op === 'hanchan_start').seats) === JSON.stringify(['m1', 'm2', 'm3', 'm5']) && opsOf('L3', 'table_seats').length === 0, g && { ops: g.ops, res: g.res });
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad, hold };
}

const G = 'js/gamen-room.mjs';
const MUT = [
  { file: G, from: "const seats = lgT ? nextSeats(st, table.table_id, n, { league: true }) || (ls && ls.length !== n ? ls : null) : ls || preSeats();", to: 'const seats = ls || preSeats();', name: 'リーグの日も前の半荘の人（L1）', only: 'L1' },
  { file: G, from: "const seats = lgT ? nextSeats(st, table.table_id, n, { league: true })", to: "const seats = lgT ? (ls && ls.length === n ? ls : null)", name: '他の卓と重なっても前の半荘で始める（L1）', only: 'L1' },
  { file: G, from: "const tSeats = lgDay(t) && isL() &&", to: 'const tSeats = false &&', name: 'L の［人を替える］で卓の席を送らない（L2）', only: 'L2' },
  { file: G, from: "if (e.tSeats && lgDay(tOf(e.tid)) && isL()) {", to: 'if (lgDay(tOf(e.tid))) {', name: 'L でない人の［人を替える］でも卓の席を送る（L3）', only: 'L3' },
  { file: G, from: "'<p class=\"r-hint\" id=\"pOnly\">この半荘だけ</p>'", to: "''", name: '「この半荘だけ」を出さない（L3）', only: 'L3' },
  { file: G, from: "(!p.only && nonL(tOf(p.tid)) ?", to: '(!p.only ?', name: 'L にも「この半荘だけ」（L2）', only: 'L2' },
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
