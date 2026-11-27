// L リーグの直し（l_sadame v1.3 §1 A22・A16・A24・A25 名簿）＝league.html の画面の分の自己確認（計算の席の持ち物・js/gamen-league.mjs）。
// node gamen_l-e2e.cjs <作業木> [--self] [--chromium] [--shot=<dir>]
// 台は gamen_d2-e2e.cjs の写し（本物の league.html に、ログインと sb()／rpc() だけ差し替えた gamen-core・偽の倉庫は lib/room-state.mjs の applyOps）。
//   足し＝league_create を偽の倉庫で受ける（本物と同じく同じ名の止めは無い＝11-27 A24）。名簿の member_rename／member_active は lib の門のまま。
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
let LG_HOLD = null; // L5：リーグを読む答えを止めておく（読む前の［外す］が押せないかを見る）
const mkHold = () => { let f; const p = new Promise((s) => { f = s; }); return { p, go: f }; };
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
const lgOut = (R, l, uid) => ({ league_id: l.league_id, name: l.name, date_from: l.date_from, date_to: l.date_to, rank_by: l.rank_by, min_games: l.min_games, players_main: l.players_main, rules: l.rules, rules_alt: l.rules_alt, version: l.version, voided: l.voided, ...(l.created_at ? { created_at: l.created_at } : {}), l: l.l_uid === uid });
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
let mjWrite = async function (dev, uid, a) {
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
    if (fn === 'mj_read') { LOG.push({ dev, fn, what: args.p_what, args: clone(args.p_args || {}) }); if (args.p_what === 'league' && LG_HOLD) await LG_HOLD.p; send(mjRead(uid, args)); return; }
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

/* ── L の偽の倉庫の足し（league_create・名簿の op は lib のまま） ── */
const mjWriteD2 = mjWrite;
mjWrite = async function (dev, uid, a) {
  const R = DB.get(a.p_room_id);
  const c = ctl(dev);
  if (R && !c.forceWrite.length && a.p_ops.length === 1 && a.p_ops[0].op === 'league_create') {
    if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
    const o = a.p_ops[0];
    R.leagues.push({ league_id: o.league_id, name: o.name, date_from: o.date_from, date_to: o.date_to, rank_by: o.rank_by, min_games: o.min_games, players_main: o.players_main, rules: o.rules, rules_alt: o.rules_alt, version: 1, l_uid: uid, voided: false, created_at: '2026-11-27T23:00:00+09:00' });
    R.read_ver++;
    const r = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, r); return r;
  }
  return mjWriteD2(dev, uid, a);
};

async function run(br, port) {
  let pass = 0, fail = 0; const bad = []; const hold = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };
  DB.clear(); LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = [];
  const device = async (dev, uid) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' }); ctxs.push(ctx);   // 作った日時は端末の時刻で出す＝CI（UTC）でも日本の端末と同じに
    await ctx.addInitScript(([dev, uid]) => { window.__dev = dev; window.__uid = uid; }, [dev, uid]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 20000);
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    pg.on('console', (m) => { if (m.type() === 'error') bad.push('頁の console ' + dev + ': ' + m.text().slice(0, 200)); });
    return { pg, ctx };
  };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const opsOf = (dev, name) => writes(dev).flatMap((w) => w.ops).filter((o) => o.op === name);
  const waitFor = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kp = (pg, k) => pg.click('#fAlt .kp [data-kp="' + k + '"]');
  const shot = async (pg, name) => { if (SHOT && !SELF) await pg.screenshot({ path: path.join(SHOT, 'l_' + name + (CHROMIUM ? '_chromium' : '') + '.png'), fullPage: true }); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const openList = async (pg, rid = 'ra') => { await pg.goto(`http://127.0.0.1:${port}/league.html?room=${rid}`); await pg.waitForSelector('#vList #lAdd'); };
  const openForm = async (pg) => { await pg.click('#lAdd'); if (await pg.isVisible('#vPick')) await pg.click('#vPick [data-pick="ra"]'); await pg.waitForSelector('#vForm:not([hidden]) #fGo'); };
  let NM = '';
  try {
    // L1 A22 規定の半荘数が無い・min_games 0／A16 もう一方の箱はアプリの鍵盤（− はウマだけ・± は無い）／A24② 作れたらそのリーグの対局の頁へ
    if (want('L1')) try { NM = 'L1';
      DB.clear(); mkRoom('ra');
      const A = await device('A1', 'u1');
      await openList(A.pg); await openForm(A.pg);
      ok('L1 規定の半荘数の欄が無い', !(await has(A.pg, '#fMin')) && !((await txt(A.pg, '#vForm')) || '').includes('規定の半荘'));
      await A.pg.fill('#fName', '火曜リーグ');
      await A.pg.click('#aOn');
      await A.pg.click('#fAlt [data-aopen="ps"]');
      const st = await A.pg.evaluate(() => { const x = document.querySelector('#aStart'); return x ? { ro: x.readOnly, im: x.getAttribute('inputmode') } : null; });
      ok('L1 持ち点の箱は readonly・inputmode none', st && st.ro === true && st.im === 'none', st);
      await A.pg.click('#aStart');
      ok('L1 持ち点を押すとアプリの鍵盤が出る', await A.pg.isVisible('#fAlt .kp'));
      ok('L1 持ち点では − の鍵が効かない', await A.pg.evaluate(() => { const b = document.querySelector('#fAlt .kp [data-kp="neg"]'); return !!b && b.disabled; }));
      for (let j = 0; j < 7; j++) await kp(A.pg, 'bs');
      for (const ch of '35000') await kp(A.pg, ch);
      await kp(A.pg, 'ok');
      ok('L1 鍵盤で打った持ち点（3桁の区切り）', (await A.pg.inputValue('#aStart')) === '35,000', await A.pg.inputValue('#aStart'));
      await A.pg.click('#fAlt [data-aopen="uma"]');
      ok('L1 ウマの横に［±］が無い', !(await has(A.pg, '#fAlt .uma-pm')) && !(await has(A.pg, '[data-aumaneg]')));
      const n3 = await A.pg.evaluate(() => document.querySelectorAll('#fAlt [data-auma]').length);
      await A.pg.click('#fAlt [data-auma="0"]');
      for (let j = 0; j < 4; j++) await kp(A.pg, 'bs');
      for (const ch of '10') await kp(A.pg, ch);
      await kp(A.pg, 'next');
      for (let i = 1; i < n3 - 1; i++) { for (let j = 0; j < 4; j++) await kp(A.pg, 'bs'); await kp(A.pg, '0'); await kp(A.pg, 'next'); }
      for (let j = 0; j < 4; j++) await kp(A.pg, 'bs');
      await kp(A.pg, 'neg'); for (const ch of '10') await kp(A.pg, ch);
      await kp(A.pg, 'ok');
      ok('L1 ウマの − は鍵盤の −', /^[−-]10$/.test(await A.pg.inputValue('#fAlt [data-auma="' + (n3 - 1) + '"]')), await A.pg.inputValue('#fAlt [data-auma="' + (n3 - 1) + '"]'));
      await shot(A.pg, 'form');
      await A.pg.click('#fGo');
      await A.pg.waitForURL(/taikyoku\.html/, { timeout: SELF ? 6000 : 15000 }).catch(() => {});
      const cr = opsOf('A1', 'league_create')[0];
      ok('L1 送る min_games は 0', cr && cr.min_games === 0, cr && cr.min_games);
      const want3 = [10, ...Array(Math.max(0, n3 - 2)).fill(0), -10];
      ok('L1 もう一方の持ち点とウマが送られる', cr && cr.rules_alt && cr.rules_alt.start_pts === 35000 && JSON.stringify(cr.rules_alt.uma) === JSON.stringify(want3), cr && cr.rules_alt);
      const u = new URL(A.pg.url());
      ok('L1 作れたらそのリーグの対局の頁へ', u.pathname.endsWith('/taikyoku.html') && u.searchParams.get('room') === 'ra' && !!cr && u.searchParams.get('league') === cr.league_id, A.pg.url());
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L2 A24（11-27 23時 司さん）同じ名前のリーグも作れる（送る）・一覧で同じ名が並ぶ時は作った日時で見分ける・違う名には日時を出さない
    if (want('L2')) try { NM = 'L2';
      DB.clear(); mkRoom('ra'); const lg1 = mkLeague('ra', { league_id: LID, name: '金曜リーグ', rules: LR4 }); lg1.created_at = '2026-11-20T10:05:00+09:00';
      const other = mkLeague('ra', { league_id: LID_ALT, name: '土曜リーグ', rules: LR4 }); other.created_at = '2026-11-21T10:00:00+09:00';
      const A = await device('A2', 'u1');
      await openList(A.pg); await openForm(A.pg);
      await A.pg.fill('#fName', ' 金曜リーグ ');
      await A.pg.click('#fGo');
      await A.pg.waitForURL(/taikyoku\.html/, { timeout: SELF ? 6000 : 15000 }).catch(() => {});
      ok('L2 同じ名でも league_create を送る', opsOf('A2', 'league_create').length === 1 && opsOf('A2', 'league_create')[0].name === '金曜リーグ', opsOf('A2', 'league_create'));
      ok('L2 同じ名のリーグが2つになる', DB.get('ra').leagues.filter((l) => l.name === '金曜リーグ' && !l.voided).length === 2, DB.get('ra').leagues.map((l) => l.name));
      DB.get('ra').leagues.find((l) => l.league_id !== LID && l.name === '金曜リーグ').created_at = '2026-11-27T23:10:00+09:00';
      await A.pg.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});   // 対局の頁の読みが走り中に移ると WebKit が打ち切りを頁の例外で出す（客の害は無い）
      await openList(A.pg);
      const subs = await A.pg.evaluate(() => [...document.querySelectorAll('.lg-row')].map((r) => r.querySelector('.row-name').textContent + '|' + r.querySelector('.row-sub').textContent));
      ok('L2 同じ名の2つは作った日時で分かる', subs.some((t) => t.startsWith('金曜リーグ|') && t.includes('作った 11/20 10:05')) && subs.some((t) => t.startsWith('金曜リーグ|') && t.includes('作った 11/27 23:10')), subs);
      ok('L2 違う名には作った日時を出さない', subs.some((t) => t.startsWith('土曜リーグ|') && !t.includes('作った')), subs);
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L3 A24③ 一覧の見出しは「部屋 ○○」と小さく・行の主はリーグの名
    if (want('L3')) try { NM = 'L3';
      DB.clear(); mkRoom('ra'); mkLeague('ra', { league_id: LID, name: '金曜リーグ', rules: LR4 });
      const A = await device('A3', 'u1');
      await openList(A.pg);
      const hd = await A.pg.evaluate(() => { const h = document.querySelector('[data-heya]'), n = document.querySelector('.lg-row .row-name'); return h && n ? { t: h.textContent, hs: parseFloat(getComputedStyle(h).fontSize), ns: parseFloat(getComputedStyle(n).fontSize) } : null; });
      ok('L3 見出しは「部屋 会ra」', hd && hd.t.startsWith('部屋 会ra'), hd);
      ok('L3 見出しはリーグの名より小さい', hd && hd.hs < hd.ns, hd);
      await shot(A.pg, 'list');
      // 11-27 23時 司さん：部屋の名が無い時の既定は「do the math」（見出しの「部屋 」は変えない）
      DB.get('ra').name = null; DB.get('ra').read_ver++;
      await openList(A.pg);
      const hd2 = await A.pg.evaluate(() => { const h = document.querySelector('[data-heya]'); return h ? h.textContent : null; });
      ok('L3 名の無い部屋の見出しは「部屋 do the math」', !!hd2 && hd2.startsWith('部屋 do the math'), hd2);
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L4 A25 名前を直す（member_rename・同じ名は dup の字・点は人に付いたまま）
    if (want('L4')) try { NM = 'L4';
      DB.clear(); mkRoom('ra'); mkLeague('ra', { league_id: LID, name: '金曜リーグ', rules: LR4 });
      const A = await device('A4', 'u1');
      await openList(A.pg);
      await A.pg.click('[data-roster="ra"]');
      await A.pg.waitForSelector('[data-rn="m1"]');
      await A.pg.click('[data-rn="m1"]');
      await A.pg.fill('#rnIn', '山田太郎');
      await A.pg.click('[data-rnok="m1"]');
      await waitFor(async () => ((await txt(A.pg, '[data-mem="m1"] .row-name')) || '') === '山田太郎', 5000);
      const rn = opsOf('A4', 'member_rename');
      ok('L4 member_rename を1つ送る', rn.length === 1 && rn[0].member_id === 'm1' && rn[0].name === '山田太郎', rn);
      ok('L4 名簿に新しい名', (await txt(A.pg, '[data-mem="m1"] .row-name')) === '山田太郎');
      ok('L4 倉庫の名も替わった', DB.get('ra').st.members.find((m) => m.member_id === 'm1').name === '山田太郎');
      await A.pg.click('[data-rn="m2"]');
      await A.pg.fill('#rnIn', '山田太郎');
      await A.pg.click('[data-rnok="m2"]');
      await waitFor(async () => !!(await A.pg.$('[data-redmsg]')), 5000);
      ok('L4 同じ名は「同じ名前の人がもういます」', ((await txt(A.pg, '[data-redmsg]')) || '').includes('同じ名前の人がもういます'), await txt(A.pg, '[data-redmsg]'));
      ctl('A4').forceWrite.push({ ok: false, err: 'mj_role', need: 'owner_or_sole_L' });
      await A.pg.fill('#rnIn', '鈴木一郎');
      await A.pg.click('[data-rnok="m2"]');
      await waitFor(async () => ((await txt(A.pg, '[data-redmsg]')) || '').includes('持ち主'), 5000);
      ok('L4 役の門は「部屋の持ち主だけが直せます」', ((await txt(A.pg, '[data-redmsg]')) || '').includes('この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます'), await txt(A.pg, '[data-redmsg]'));
    } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }

    // L5 A25 外す（確かめ：点の回数・今 卓n の席）→ 外した人［戻す］
    if (want('L5')) try { NM = 'L5';
      DB.clear(); mkRoom('ra'); mkLeague('ra', { league_id: LID, name: '金曜リーグ', rules: LR4 });
      const S1 = U(1), T1 = U(101);
      seed('ra', [day(S1), tb(T1, S1, '卓1'), H(U(201), T1, ['m1', 'm2', 'm3', 'm4'], [40000, 30000, 20000, 10000]), seats(T1, ['m1', 'm2', 'm3', 'm4'])]);
      const A = await device('A5', 'u1');
      await openList(A.pg);
      LG_HOLD = mkHold();
      await A.pg.click('[data-roster="ra"]');
      await A.pg.waitForSelector('[data-off="m3"]');
      ok('L5 リーグを読む前は［外す］が押せない', await A.pg.evaluate(() => document.querySelector('[data-off="m3"]').disabled === true));
      LG_HOLD.go(); LG_HOLD = null;
      await A.pg.waitForSelector('[data-off="m3"]:not([disabled])');
      ok('L5 リーグを読んでから［外す］が押せる', LOG.some((x) => x.dev === 'A5' && x.fn === 'mj_read' && x.what === 'league' && x.args.league_id === LID));
      await A.pg.click('[data-off="m3"]');
      const t = (await txt(A.pg, '[data-offt]')) || '';
      ok('L5 確かめに点の回数', t.includes('佐藤さんは半荘 1 回の点があります。外しても点はリーグの順位に残ります'), t);
      ok('L5 確かめに今の席の卓', t.includes('今 卓1 の席にいます。その卓の次の半荘は人を選び直します'), t);
      await A.pg.click('[data-edno="ra"]');
      ok('L5 やめるで何も送らない', opsOf('A5', 'member_active').length === 0 && !(await has(A.pg, '[data-offt]')));
      await A.pg.click('[data-off="m5"]');
      const t5 = (await txt(A.pg, '[data-offt]')) || '';
      ok('L5 点の無い人は点と席の字を出さない', !t5.includes('点があります') && !t5.includes('席にいます'), t5);
      await A.pg.click('[data-edno="ra"]');
      await A.pg.click('[data-off="m3"]');
      await A.pg.click('[data-offok="m3"]');
      await A.pg.waitForSelector('[data-gone="m3"]');
      const oa = opsOf('A5', 'member_active');
      ok('L5 member_active false を送る', oa.length === 1 && oa[0].member_id === 'm3' && oa[0].active === false, oa);
      ok('L5 外した人の段に出て名簿の数が減る', (await txt(A.pg, '.lg-gone')) === '外した人' && !(await has(A.pg, '[data-mem="m3"]')) && (await txt(A.pg, '[data-nmem]')) === '7');
      await shot(A.pg, 'roster');
      await A.pg.click('[data-on="m3"]');
      await A.pg.waitForSelector('[data-mem="m3"]');
      const ob = opsOf('A5', 'member_active');
      ok('L5 戻す＝member_active true', ob.length === 2 && ob[1].active === true, ob);
      ok('L5 戻すと外した人の段が消える', !(await has(A.pg, '[data-gone]')) && !(await has(A.pg, '.lg-gone')));
    } catch (e) { if (LG_HOLD) { LG_HOLD.go(); LG_HOLD = null; } fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad, hold };
}

const G = 'js/gamen-league.mjs';
const MUT = [
  { file: 'league.html', from: '<div class="list" id="fAlt"></div>', to: '<div class="list" id="fAlt"></div><input class="box" id="fMin" value="10">', name: '規定の半荘数の欄を戻す（L1）', only: 'L1' },
  { file: G, from: 'min_games: 0, players_main: chk.rules.players', to: 'min_games: 10, players_main: chk.rules.players', name: 'min_games を 10 で送る（L1）', only: 'L1' },
  { file: G, from: "boxes: () => [...$('fAlt').querySelectorAll('input.box')]", to: "boxes: () => [...$('fAlt').querySelectorAll('input.box[data-auma]')]", name: '持ち点の箱をアプリの鍵盤につながない（L1）', only: 'L1' },
  { file: G, from: "  $('fAlt').innerHTML = h + keypadHtml({ sp: false });", to: "  $('fAlt').innerHTML = h;", name: 'もう一方の箱にアプリの鍵盤を付けない（L1）', only: 'L1' },
  { file: G, from: "{ neg: true, dec: false, max: 3 } : { neg: false, dec: false, max: 6 }), sp: $('fKpSp') });", to: "{ neg: true, dec: false, max: 3 } : { neg: true, dec: false, max: 6 }), sp: $('fKpSp') });", name: '持ち点でも − が効く（L1）', only: 'L1' },
  { file: G, from: "    if (made) { form = null; location.href =", to: "    if (false) { form = null; location.href =", name: '作れたら一覧に戻す（L1）', only: 'L1' },
  { file: G, from: "const twin = live.some((o) => o !== l && nk(o) === nk(l));", to: 'const twin = false;', name: '同じ名に作った日時を出さない（L2）', only: 'L2' },
  { file: G, from: "const twin = live.some((o) => o !== l && nk(o) === nk(l));", to: 'const twin = true;', name: '違う名にも作った日時を出す（L2）', only: 'L2' },
  { file: G, from: "  return { val: { name, date_from, date_to, rank_by: form.rank,", to: "  if (rooms.get(form.rid).read.leagues.some((l) => !l.voided && String(l.name).trim() === name)) return { err: 'x' }; return { val: { name, date_from, date_to, rank_by: form.rank,", name: '同じ名の止めを戻す（L2）', only: 'L2' },
  { file: G, from: 'data-heya>部屋 \' + esc(roomName(x))', to: 'data-heya>\' + esc(roomName(x))', name: '見出しに「部屋」を付けない（L3）', only: 'L3' },
  { file: G, from: "const ROOM_DEFAULT = 'do the math';", to: "const ROOM_DEFAULT = '部屋';", name: '名の無い部屋を「部屋」と出す（L3）', only: 'L3' },
  { file: 'css/gamen.css', from: '.lg-heya { font-size: 12px;', to: '.lg-heya { font-size: 18px;', name: '見出しをリーグの名より大きくする（L3）', only: 'L3' },
  { file: G, from: "rosterSend(b.dataset.r, b.dataset.rnok, 'rename', { op: 'member_rename', member_id: b.dataset.rnok, name: nm });", to: '', name: '名前を直すを送らない（L4）', only: 'L4' },
  { file: G, from: "  if (e === 'dup') return ROSTER_ERR.dup;\n", to: '', name: '名の dup に字を出さない（L4）', only: 'L4' },
  { file: G, from: "  if (e === 'mj_role') return ROSTER_ERR.role;\n", to: '', name: '役の門の字を出さない（L4）', only: 'L4' },
  { file: G, from: "  count(x.read.st);\n  for (const st of (x.mm && x.mm.sts) || []) {\n    count(st);", to: "  count(x.read.st);\n  for (const st of (x.mm && x.mm.sts) || []) {\n", name: 'リーグの半荘を点の回数に数えない（L5）', only: 'L5' },
  { file: G, from: "        if (b && b.includes(mid)) at.push(t.label);", to: '', name: '今の席の卓を出さない（L5）', only: 'L5' },
  { file: G, from: "(x.mm && x.mm.sts ? '' : ' disabled')", to: "''", name: 'リーグを読む前から［外す］を押せる（L5）', only: 'L5' },
  { file: G, from: "const mem = all.filter((m) => m.active !== false), gone = all.filter((m) => m.active === false);", to: 'const mem = all, gone = [];', name: '外した人を名簿に並べたまま（L5）', only: 'L5' },
  { file: G, from: "{ op: 'member_active', member_id: b.dataset.on, active: true }", to: "{ op: 'member_active', member_id: b.dataset.on, active: false }", name: '戻すで active true を送らない（L5）', only: 'L5' },
];
(async () => {
  LIB = await import(pathToFileURL(path.join(ROOT, 'lib/room-state.mjs')).href);
  RL = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RL.rulesOk({ ...RL.defaultRules(4), rate: 100, chip_pt10: 20 }).rules;
  LR4 = RL.rulesOk({ ...RL.defaultRules(4), rate: 50, chip_pt10: 20 }).rules;
  LR3 = RL.rulesOk({ ...RL.defaultRules(3), rate: 50, chip_pt10: 20 }).rules;
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
  await Promise.race([br.close().catch(() => {}), sleep(15000)]); srv.close(); process.exit(code); // WebKit の close が戻らず札を135分持った（11-27）＝15秒で見切って抜ける
})();
