// C2-0（c20_sadame v2.1 §5）［これは私］＝人を選ぶ頁の帯と印・あなたの名前の頁・新しい名前を足して自分にする・直送の門と返し。
// node gamen_c20-e2e.cjs <作業木> [--self] [--chromium]（既定 WebKit）・ONLY=T1,T2・MUTONLY=<壊しの名の一部>
// 台は gamen_d2-e2e.cjs の写し（本物の taikyoku.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる）。
// 偽の倉庫は links{member_id: uid}・claims を持ち、mj_read の members に me／taken を付け（§1a・user_id は出さない）、
//   mj_write の member_link／member_unlink を §1d の通りに当てる（linked・同じ組に unlink が在って X が taken＝err taken で組ごと戻す・link だけ＝claimed）。
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
export async function rpcRaw(fn, args) { return await sb().rpc(fn, args); } // 2b：部屋の mj_read・mj_write は rpcRaw を通る＝偽の sb へ
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
const DB = new Map();   // rid → { kind, name, rules, closed, read_ver, channel_key, st, results, roles, owner, leagues, days, links: {mid: uid}, claims: [] }
const LOG = [];
const CTL = {};         // dev → { forceWrite: [返し…], delayWrite: ms, holdWrite: bool, holdRead: bool }
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

/* ── 偽の倉庫（c20_sadame §1 の形）── */
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
/* 人の op の倉庫の決まり（§1d・mj_w_op の member_link／member_unlink）＝links の写しに順に当てる。返し＝{ ok, links, claims, results } か err */
function personOps(R, ops, uid) {
  const links = { ...R.links }; const claims = []; const results = []; let freed = false;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op === 'member_unlink') { if (links[op.member_id] === uid) { delete links[op.member_id]; freed = true; } results.push({}); continue; }
    if (op.op === 'member_link') {
      const cur = links[op.member_id];
      if (cur === uid) { results.push({}); continue; }
      const mine = Object.keys(links).find((k) => links[k] === uid);
      if (mine) return { ok: false, err: 'linked', i, member_id: mine };
      if (cur) { if (freed) return { ok: false, err: 'taken', i, member_id: op.member_id }; claims.push({ member_id: op.member_id, user_id: uid }); results.push({ claimed: true }); continue; }
      links[op.member_id] = uid; results.push({}); continue;
    }
    results.push({});
  }
  return { ok: true, links, claims, results };
}
function mkRoom(rid, { closed = false, names = NAMES, links = {} } = {}) {
  let st = LIB.emptyState(); st.rules = RULES;
  if (names.length) st = LIB.applyOps(st, names.map((nm, i) => ({ op: 'member_add', member_id: M[i], name: nm })), { roomRules: RULES, now: NOW(), role: 'kan' }).state;
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules: RULES, closed, read_ver: 1, channel_key: 'ch-' + rid, st, results: new Map(), roles: { u1: 'kan', u2: 'nyu' }, owner: 'u1', leagues: [], days: [], links: { ...links }, claims: [] });
}
function seed(rid, ops) { const R = DB.get(rid); const a = fakeApply(R, ops, 'u1'); if (!a.ok) throw new Error('台の種が弾かれた ' + JSON.stringify(a)); R.st = a.st; R.days = a.days; R.read_ver++; }
/* 部屋＝今日の開催 s1・卓 t1（席なし・半荘なし）＝［＋名前］で人を選ぶ頁が開く */
const day0 = () => [{ op: 'session_add', session_id: 's1', date: TODAY, rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' }];
function mkRoomT(rid, o = {}) { mkRoom(rid, o); seed(rid, day0()); }
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; return o; };
function stPart(R, keep, uid) {
  const o = stOut(R.st);
  const sids = new Set(o.sessions.filter(keep).map((s) => s.session_id));
  const tids = new Set(o.tables.filter((t) => sids.has(t.session_id)).map((t) => t.table_id));
  o.sessions = o.sessions.filter((s) => sids.has(s.session_id)); o.tables = o.tables.filter((t) => tids.has(t.table_id));
  o.hanchans = o.hanchans.filter((h) => tids.has(h.table_id)); o.extras = o.extras.filter((x) => tids.has(x.table_id)); o.settles = (o.settles || []).filter((x) => sids.has(x.session_id));
  // §1a：me＝呼んだ人につながっている・taken＝ほかの人につながっている（user_id は出さない・無い鍵＝false）
  o.members = o.members.map((m) => { const u = R.links[m.member_id]; return u === uid ? { ...m, me: true } : u ? { ...m, taken: true } : m; });
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
  return { ok: true, read_ver: R.read_ver, room, st: stPart(R, (s) => !s.league_id, uid), leagues: R.leagues.map((l) => lgOut(l, uid)) };
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
  R.st = r.st; R.days = r.days; R.links = p.links; R.claims.push(...p.claims); R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver, results: p.results }; R.results.set(a.p_op_id, res); return res;
}
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const c = ctl(dev);
    const send = (o, status = 200) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o && o.__http ? { data: null, error: { message: 'upstream' }, status: o.__http } : { data: o, error: null, status })); };
    if (fn === 'mj_read') { const e = { dev, fn, what: args.p_what, args: clone(args.p_args || {}) }; LOG.push(e); while (c.holdRead) await sleep(50); send(mjRead(uid, args)); return; }
    if (fn === 'mj_write') {
      const e = { dev, fn, op_id: args.p_op_id, ops: clone(args.p_ops) }; LOG.push(e);
      while (c.holdWrite) await sleep(50);
      if (c.delayWrite) await sleep(c.delayWrite);
      if (c.forceWrite.length && args.p_ops.some((o) => /^member_/.test(o.op))) { e.res = c.forceWrite.shift(); send(e.res); return; }
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
  const device = async (dev, uid, seedLs) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, s]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seedLs || {}]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 15000);
    if (process.env.DBG) pg.on('console', (m) => console.log('C', dev, m.text().slice(0, 200)));
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    return { pg, ctx };
  };
  const ctlRoom = (rid) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: 'kan', owner: true, rules: RULES, channel_key: 'ch-' + rid, at: 1 });
  const seedOf = (rid, more = {}) => ({ 'mj-rooms:u1': [ctlRoom(rid)], ...more });
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const body = (pg) => pg.evaluate(() => document.getElementById('vRoom').textContent);
  const mw = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write' && x.ops.some((o) => /^member_(link|unlink)$/.test(o.op)));
  const shape = (w) => w.ops.map((o) => o.op + ':' + o.member_id);
  const reads = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_read').length;
  const waitFor = async (fn, ms, step = 50) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const tags = (pg) => pg.evaluate(() => [...document.querySelectorAll('#pBase [data-pick]')].filter((b) => b.querySelector('.r-me-tag')).map((b) => b.dataset.pick));
  const openPick = async (pg, rid, lid) => {
    await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}` + (lid ? '&league=' + lid : ''));
    await pg.waitForSelector('#vRoom [data-seats]'); await sleep(250);
    await pg.click('#vRoom [data-seats]'); await pg.waitForSelector('#pGo');
  };
  const openMe = async (pg, rid, lid) => { await openPick(pg, rid, lid); await pg.click('#pMeGo'); await pg.waitForSelector('#meNewGo'); };
  const meTxt = async (pg) => ((await txt(pg, '#meErr')) || '') + ((await txt(pg, '#pMeErr')) || '');
  const waitMsg = (pg, re, ms = 5000) => waitFor(async () => re.test(await meTxt(pg)), ms);
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const step = async (k, f) => { if (!want(k)) return; try { await f(); } catch (e) { fail++; bad.push('止まった(' + k + ') ' + String(e && e.message || e).slice(0, 300)); } finally { for (const c of ctxs.splice(0)) await c.close().catch(() => {}); } };
  try {
    await step('T1', async () => {
      mkRoomT('r1'); mkRoomT('r1b', { links: { m2: 'u1', m3: 'u2' } });
      let A = await device('T1', 'u1', seedOf('r1'));
      await openPick(A.pg, 'r1');
      ok('T1 me 無し＝帯と［あなたの名前を選ぶ］', await has(A.pg, '#pMeBand') && /あなたの戦績に入ります/.test(await txt(A.pg, '#pMeBand')) && (await txt(A.pg, '#pMeGo')) === 'あなたの名前を選ぶ', await txt(A.pg, '#pMeBand'));
      ok('T1 me 無し＝印なし', (await tags(A.pg)).length === 0, await tags(A.pg));
      const B = await device('T1b', 'u1', seedOf('r1b'));
      await openPick(B.pg, 'r1b');
      ok('T1 me＝「あなた＝鈴木」＋［変える］', /あなた＝鈴木/.test((await txt(B.pg, '#pMeLine')) || '') && (await txt(B.pg, '#pMeGo')) === '変える' && !(await has(B.pg, '#pMeBand')), await txt(B.pg, '#pMeLine'));
      ok('T1 印は自分の名前だけ（taken には付けない）', (await tags(B.pg)).join() === 'm2', await tags(B.pg));
    });
    await step('T2', async () => {
      mkRoomT('r2');
      const A = await device('T2', 'u1', seedOf('r2'));
      await openMe(A.pg, 'r2');
      ok('T2 me 無し＝警告の行なし', !(await has(A.pg, '#meWarn')));
      await A.pg.click('#meList [data-me="m3"]'); await A.pg.waitForSelector('#pGo'); await waitFor(async () => (await tags(A.pg)).length === 1, 3000);
      const w = mw('T2');
      ok('T2 送りは1回・[member_link m3]', w.length === 1 && shape(w[0]).join() === 'member_link:m3', w.map(shape));
      ok('T2 人を選ぶ頁へ戻り「あなた＝佐藤」・印は m3', /あなた＝佐藤/.test((await txt(A.pg, '#pMeLine')) || '') && (await tags(A.pg)).join() === 'm3', await tags(A.pg));
      ok('T2 倉庫は m3＝u1', DB.get('r2').links.m3 === 'u1');
    });
    await step('T3', async () => {
      mkRoomT('r3', { links: { m1: 'u1' } });
      const A = await device('T3', 'u1', seedOf('r3'));
      await openMe(A.pg, 'r3');
      ok('T3 自分の名前は一覧に出さない・警告の行', !(await has(A.pg, '#meList [data-me="m1"]')) && /山田の半荘はあなたの戦績から外れ/.test((await txt(A.pg, '#meWarn')) || ''), await txt(A.pg, '#meWarn'));
      await A.pg.click('#meList [data-me="m3"]'); await A.pg.waitForSelector('#pGo'); await waitFor(async () => (await tags(A.pg)).join() === 'm3', 3000);
      const w = mw('T3');
      ok('T3 [member_unlink m1, member_link m3] の順', w.length === 1 && shape(w[0]).join() === 'member_unlink:m1,member_link:m3', w.map(shape));
      ok('T3 印は m3 だけ（m1 に残らない）', (await tags(A.pg)).join() === 'm3', await tags(A.pg));
      ok('T3 倉庫は m3＝u1・m1 空き', DB.get('r3').links.m3 === 'u1' && !DB.get('r3').links.m1, DB.get('r3').links);
    });
    await step('T4', async () => {
      mkRoomT('r4');
      const A = await device('T4', 'u1', seedOf('r4'));
      await openMe(A.pg, 'r4');
      await A.pg.fill('#meNew', '中村'); await A.pg.click('#meNewGo'); await A.pg.waitForSelector('#pGo'); await sleep(300);
      const w = mw('T4');
      const ops = w.length ? w[0].ops : [];
      ok('T4 [member_add id 中村, member_link 同じ id]', w.length === 1 && ops.length === 2 && ops[0].op === 'member_add' && ops[0].name === '中村' && ops[1].op === 'member_link' && ops[1].member_id === ops[0].member_id, w.map((x) => x.ops));
      const id = ops[0] && ops[0].member_id;
      ok('T4 足した名前に印・この半荘に入った', (await tags(A.pg)).join() === id && (await A.pg.getAttribute('#pBase [data-pick="' + id + '"]', 'aria-pressed')) === 'true' && /1／4/.test((await txt(A.pg, '.kon')) || ''), [await tags(A.pg), await txt(A.pg, '.kon')]);
      await A.pg.click('#pMeGo'); await A.pg.waitForSelector('#meNewGo');
      await A.pg.fill('#meNew', '佐藤'); await A.pg.click('#meNewGo'); await sleep(200);
      ok('T4 名簿に居る名前＝送らず字・打った名前は残す', mw('T4').length === 1 && /同じ名前が名簿にいます/.test(await meTxt(A.pg)) && (await A.pg.inputValue('#meNew')) === '佐藤', [await meTxt(A.pg), await A.pg.inputValue('#meNew')]);
      await A.pg.fill('#meNew', ''); await A.pg.click('#meNewGo'); await sleep(100);
      ok('T4 空＝送らず字', mw('T4').length === 1 && /1〜20字/.test(await meTxt(A.pg)), await meTxt(A.pg));
    });
    await step('T5', async () => {
      mkRoomT('r5', { links: { m3: 'u2' } });
      const A = await device('T5', 'u1', seedOf('r5'));
      await openMe(A.pg, 'r5');
      ok('T5 me 無し＝taken も押せる・字', !(await A.pg.isDisabled('#meList [data-me="m3"]')) && /押すと名乗りが残ります/.test((await txt(A.pg, '#meList [data-me="m3"]')) || ''), await txt(A.pg, '#meList [data-me="m3"]'));
      await A.pg.click('#meList [data-me="m3"]');
      ok('T5 claimed＝名乗りの字', (await waitMsg(A.pg, /『佐藤』はほかの人がつないでいます。部屋の管に付け替えを頼んでください/)) >= 0, await meTxt(A.pg));
      ok('T5 送りは [member_link m3]・名乗りの行1・つなぎは u2 のまま', mw('T5').length === 1 && shape(mw('T5')[0]).join() === 'member_link:m3' && DB.get('r5').claims.length === 1 && DB.get('r5').links.m3 === 'u2', [mw('T5').map(shape), DB.get('r5').claims]);
      await sleep(300);
      const me = await A.pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r5') || 'null'));
      ok('T5 写しに me を付けない', me && !me.members.some((m) => m.me === true), me && me.members);
    });
    await step('T6', async () => {
      mkRoomT('r6');
      const A = await device('T6', 'u1', seedOf('r6'));
      ctl('T6').holdWrite = true;
      // 並びに1組入れる＝人を選ぶ頁の「新しい人で足す」（並びを通る）を、送りを止めた間に押す
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=r6`); await A.pg.waitForSelector('#vRoom [data-seats]'); await sleep(250);
      await A.pg.click('#vRoom [data-seats]'); await A.pg.waitForSelector('#pGo');
      await A.pg.fill('#pNew', '中村'); if ((await waitFor(() => has(A.pg, '[data-new]'), 4000)) < 0) throw new Error('data-new 無し ' + (await body(A.pg)).slice(0, 300) + ' writes ' + JSON.stringify(LOG.filter((x) => x.dev === 'T6').map((x) => x.fn + (x.ops ? x.ops.map((o) => o.op).join('+') : ''))));
      await A.pg.click('[data-new]'); await sleep(300);
      const ob = await A.pg.evaluate(() => JSON.parse(localStorage.getItem('mj-outbox:u1:r6') || '[]').length);
      await A.pg.click('#pMeGo'); await A.pg.waitForSelector('#meNewGo');
      await A.pg.click('#meList [data-me="m3"]'); await sleep(300);
      ok('T6 並びが空でない＝送らず字', ob >= 1 && mw('T6').length === 0 && /前に入れた点を送っています/.test(await meTxt(A.pg)), [ob, mw('T6').length, await meTxt(A.pg)]);
      ctl('T6').holdWrite = false;
      await waitFor(async () => LOG.filter((x) => x.dev === 'T6' && x.fn === 'mj_write').every((x) => x.res), 5000); // 止めた送りを済ませてから（次の回の倉庫に入れない）
    });
    await step('T7', async () => {
      mkRoomT('r7');
      const A = await device('T7', 'u1', seedOf('r7'));
      await openMe(A.pg, 'r7');
      await A.ctx.setOffline(true); await sleep(100);
      await A.pg.click('#meList [data-me="m3"]'); await sleep(300);
      ok('T7 電波なし＝送らず字', mw('T7').length === 0 && /電波がつながってから選べます/.test(await meTxt(A.pg)), await meTxt(A.pg));
      await A.ctx.setOffline(false);
    });
    await step('T8', async () => {
      mkRoomT('r8');
      const A = await device('T8', 'u1', seedOf('r8'));
      await openMe(A.pg, 'r8');
      ctl('T8').forceWrite.push({ ok: false, err: 'linked', i: 0, member_id: 'm1' });
      const r0 = reads('T8');
      await A.pg.click('#meList [data-me="m3"]');
      ok('T8 linked＝字', (await waitMsg(A.pg, /あなたは別の名前につながっていました。読み直しました/)) >= 0, await meTxt(A.pg));
      ok('T8 linked＝読み直す', (await waitFor(async () => reads('T8') > r0, 3000)) >= 0, [r0, reads('T8')]);
    });
    await step('T9', async () => {
      mkRoomT('r9');
      const st = clone(DB.get('r9').st); st.needs_upload = true; st.members = st.members.map((m, i) => (i === 0 ? { ...m, me: true } : m));
      const A = await device('T9', 'u1', seedOf('r9', { 'mj-room:u1:r9': st }));
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=r9`); await A.pg.waitForSelector('#vRoom [data-seats]'); await sleep(250);
      await A.pg.click('#vRoom [data-seats]'); await A.pg.waitForSelector('#pGo');
      ok('T9 端末だけの写し＝帯も行も出さない', !(await has(A.pg, '#pMeBand')) && !(await has(A.pg, '#pMeLine')) && !(await has(A.pg, '#pMeGo')));
      await A.pg.fill('#pNew', '中村'); await A.pg.waitForSelector('[data-new]');
      ok('T9 端末だけの写し＝（これは私）の候補なし', !(await has(A.pg, '[data-newme]')));
      mkRoomT('r9c');
      const B = await device('T9c', 'u1', seedOf('r9c'));
      await openPick(B.pg, 'r9c');
      DB.get('r9c').closed = true; DB.get('r9c').read_ver++;
      await B.pg.evaluate(() => window.__aizu('ch-r9c'));
      const r9 = LOG.filter((x) => x.dev === 'T9c' && x.fn === 'mj_read').length;
      await B.pg.evaluate(() => window.__aizu('ch-r9c'));
      await waitFor(async () => LOG.filter((x) => x.dev === 'T9c' && x.fn === 'mj_read').length > r9, 4000); await sleep(400);
      if (await has(B.pg, '#pMeGo')) await B.pg.click('#pMeGo'); await sleep(300);
      ok('T9 終えた部屋＝名前の頁を開かない・帯なし', !(await has(B.pg, '#meNewGo')) && !(await has(B.pg, '#pMeBand')) && !(await has(B.pg, '#pMeGo')), [LOG.filter((x) => x.dev === 'T9c' && x.fn === 'mj_read').length, (await body(B.pg)).slice(0, 200)]);
    });
    await step('T10', async () => {
      mkRoomT('r10');
      const A = await device('T10', 'u1', seedOf('r10'));
      await openMe(A.pg, 'r10');
      ctl('T10').delayWrite = 800;
      await A.pg.evaluate(() => { const b = document.querySelector('#meList [data-me="m3"]'); b.click(); b.click(); });
      await sleep(100);
      const dis = await A.pg.evaluate(() => [...document.querySelectorAll('#meList [data-me], #meNewGo')].every((b) => b.disabled));
      const t = await meTxt(A.pg);
      await A.pg.waitForSelector('#pGo'); await sleep(300);
      ok('T10 2度押し＝送りは1回', mw('T10').length === 1, mw('T10').map(shape));
      ok('T10 送り中は押せない・字を出さない', dis && !/読み込み中/.test(t), [dis, t]);
    });
    await step('T10b', async () => {
      mkRoomT('r10b');
      const A = await device('T10b', 'u1', seedOf('r10b'));
      await openMe(A.pg, 'r10b');
      await sleep(1200);
      ctl('T10b').holdRead = true; DB.get('r10b').read_ver++;
      const r0 = reads('T10b');
      await A.pg.evaluate(() => window.__aizu('ch-r10b'));
      await waitFor(async () => reads('T10b') > r0, 4000);
      await A.pg.click('#meList [data-me="m3"]'); await sleep(200);
      ok('T10b 読み中＝送らず字', mw('T10b').length === 0 && /読み込み中です。少し待ってもう一度押してください/.test(await meTxt(A.pg)), [reads('T10b') - r0, await meTxt(A.pg)]);
      ctl('T10b').holdRead = false;
    });
    await step('T11', async () => {
      mkRoomT('r11', { names: [] });
      const A = await device('T11', 'u1', seedOf('r11'));
      await openPick(A.pg, 'r11');
      ok('T11 名簿が空＝帯', await has(A.pg, '#pMeBand'));
      await A.pg.fill('#pNew', '中村'); await A.pg.waitForSelector('[data-new]');
      ok('T11 候補に（これは私）', /新しい人で足す（これは私）/.test((await txt(A.pg, '[data-newme]')) || '') && /^中村新しい人で足す$/.test((await txt(A.pg, '[data-new]')) || ''), [await txt(A.pg, '[data-newme]'), await txt(A.pg, '[data-new]')]);
      await A.pg.click('[data-newme]'); await waitFor(async () => (await tags(A.pg)).length === 1, 4000);
      const w = mw('T11'); const ops = w.length ? w[0].ops : [];
      ok('T11 [member_add, member_link] 同じ id・印・この半荘に入った', w.length === 1 && ops.length === 2 && ops[0].op === 'member_add' && ops[1].member_id === ops[0].member_id && (await tags(A.pg)).join() === ops[0].member_id && /1／4/.test((await txt(A.pg, '.kon')) || ''), [w.map((x) => x.ops), await txt(A.pg, '.kon')]);
      await A.pg.fill('#pNew', '松本'); await A.pg.waitForSelector('[data-new]');
      ok('T11 me が在る＝（これは私）の候補なし', !(await has(A.pg, '[data-newme]')));
    });
    await step('T12', async () => {
      mkRoomT('r12', { links: { m1: 'u1', m3: 'u2' } });
      const A = await device('T12', 'u1', seedOf('r12'));
      await openMe(A.pg, 'r12');
      ok('T12 me＝M・X taken＝押せない・字', (await A.pg.isDisabled('#meList [data-me="m3"]')) && /付け替えは部屋の管に頼んでください/.test((await txt(A.pg, '#meList [data-me="m3"]')) || '') && !(await A.pg.isDisabled('#meList [data-me="m2"]')), await txt(A.pg, '#meList [data-me="m3"]'));
      await A.pg.evaluate(() => { const b = document.querySelector('#meList [data-me="m3"]'); b.disabled = false; b.click(); });
      await sleep(400);
      ok('T12 押せない形を押しても送らない', mw('T12').length === 0 && DB.get('r12').links.m1 === 'u1', mw('T12').map(shape));
    });
    await step('T13', async () => {
      mkRoomT('r13', { links: { m1: 'u1' } });
      const A = await device('T13', 'u1', seedOf('r13'));
      await openMe(A.pg, 'r13');
      await A.pg.fill('#meNew', '中村'); await A.pg.click('#meNewGo'); await A.pg.waitForSelector('#pGo'); await sleep(300);
      const w = mw('T13'); const ops = w.length ? w[0].ops : [];
      ok('T13 [member_unlink m1, member_add id, member_link id]', w.length === 1 && ops.map((o) => o.op).join() === 'member_unlink,member_add,member_link' && ops[0].member_id === 'm1' && ops[2].member_id === ops[1].member_id, w.map((x) => x.ops));
      ok('T13 印は足した名前だけ', ops[1] && (await tags(A.pg)).join() === ops[1].member_id, await tags(A.pg));
    });
    await step('T14', async () => {
      mkRoomT('r14');
      const A = await device('T14', 'u1', seedOf('r14'));
      await openMe(A.pg, 'r14');
      const c = ctl('T14');
      c.forceWrite.push({ ok: false, err: 'dup', what: 'member' });
      await A.pg.fill('#meNew', '中村'); await A.pg.click('#meNewGo');
      ok('T14 dup＝字', (await waitMsg(A.pg, /同じ名前が名簿にいます。上の一覧から選んでください/)) >= 0, await meTxt(A.pg));
      c.forceWrite.push({ ok: false, err: 'full', what: 'member_claims_user' });
      await A.pg.click('#meList [data-me="m3"]');
      ok('T14 full（名乗り）＝いっぱいと言わない（caps_sadame v1.1 §3）', (await waitMsg(A.pg, /倉庫で止まりました。もう一度押しても同じです。/)) >= 0 && !/いっぱい/.test(await meTxt(A.pg)), await meTxt(A.pg));
      c.forceWrite.push({ ok: false, err: 'mj_session' });
      await A.pg.click('#meList [data-me="m2"]'); await sleep(500);
      const n = mw('T14').length;
      await A.pg.evaluate(() => { const b = document.querySelector('#meList [data-me="m3"]'); if (b) b.click(); }); await sleep(400);
      ok('T14 mj_session＝止める（次の押しは送らない）', mw('T14').length === n, [n, mw('T14').length]);
    });
    await step('T15', async () => {
      mkRoom('r15');
      DB.get('r15').leagues.push({ league_id: LID, name: '金曜リーグ', rules: LR4, l_uid: 'u1' });
      seed('r15', [{ op: 'session_add', session_id: 's1', date: TODAY, rate: LR4.rate, league_id: LID }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' }]);
      const A = await device('T15', 'u1', seedOf('r15'));
      await openPick(A.pg, 'r15', LID);
      ok('T15 リーグの人を選ぶ頁＝帯', await has(A.pg, '#pMeBand'));
      await A.pg.click('#pMeGo'); await A.pg.waitForSelector('#meNewGo');
      await A.pg.click('#meList [data-me="m3"]'); await A.pg.waitForSelector('#pGo'); await waitFor(async () => (await tags(A.pg)).length === 1, 3000);
      ok('T15 [member_link m3]・印', mw('T15').length === 1 && shape(mw('T15')[0]).join() === 'member_link:m3' && (await tags(A.pg)).join() === 'm3', [mw('T15').map(shape), await tags(A.pg)]);
    });
    await step('T16', async () => {
      mkRoomT('r16');
      const A = await device('T16', 'u1', seedOf('r16'));
      await openMe(A.pg, 'r16');
      ctl('T16').forceWrite.push({ __http: 502 }, { __http: 502 });
      await A.pg.click('#meList [data-me="m3"]');
      ok('T16 切れた＝字', (await waitMsg(A.pg, /つながりませんでした/)) >= 0, await meTxt(A.pg));
      await A.pg.click('#meList [data-me="m3"]'); await waitFor(async () => mw('T16').length === 2, 3000); await sleep(200);
      await A.pg.click('#meList [data-me="m4"]'); await A.pg.waitForSelector('#pGo'); await sleep(200);
      const w = mw('T16');
      ok('T16 同じ組の押し直し＝同じ op_id', w.length === 3 && w[0].op_id === w[1].op_id, w.map((x) => x.op_id));
      ok('T16 別の名前＝新しい op_id・通る', w.length === 3 && w[2].op_id !== w[0].op_id && DB.get('r16').links.m4 === 'u1', [w.map((x) => x.op_id), DB.get('r16').links]);
    });
    await step('T17', async () => {
      mkRoomT('r17', { links: { m1: 'u1' } });
      const A = await device('T17', 'u1', seedOf('r17'));
      await openMe(A.pg, 'r17');
      const R = DB.get('r17'); R.links.m3 = 'u2'; R.read_ver++; // ほかの人が今つないだ（合図はまだ来ない）
      await A.pg.click('#meList [data-me="m3"]');
      ok('T17 taken＝字（あなたは山田のまま）', (await waitMsg(A.pg, /『佐藤』は今ほかの人がつなぎました。あなたの名前は山田のままです/)) >= 0, await meTxt(A.pg));
      ok('T17 送りは [unlink m1, link m3]・倉庫は戻った（m1＝u1・名乗り0）', mw('T17').length === 1 && shape(mw('T17')[0]).join() === 'member_unlink:m1,member_link:m3' && R.links.m1 === 'u1' && R.claims.length === 0, [mw('T17').map(shape), R.links, R.claims]);
      ok('T17 読み直して m3 は押せない', (await waitFor(async () => (await has(A.pg, '#meList [data-me="m3"]')) && (await A.pg.isDisabled('#meList [data-me="m3"]')), 4000)) >= 0, [reads('T17'), (await body(A.pg)).slice(0, 300)]);
      await A.pg.click('#meNewGo').catch(() => {});
      ok('T17 頁の字は「あなた＝山田」', /あなた＝山田/.test(await body(A.pg)), (await body(A.pg)).slice(0, 120));
    });
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
  return { pass, fail, bad };
}
const GR = 'js/gamen-room.mjs';
const MUT = [
  { file: GR, from: 'const lock = m.taken === true && !!me;', to: 'const lock = false;', name: 'taken を押せる（me が在る間）', only: 'T12' },
  { file: GR, from: 'if (me && x.taken === true) return; // 押せない形', to: '// 押せない形', name: '押せない形でも送る', only: 'T12' },
  { file: GR, from: "sendMe((me ? [{ op: 'member_unlink', member_id: me.member_id }] : []).concat([{ op: 'member_link', member_id: mid }]), { mid, name: x.name });", to: "sendMe([{ op: 'member_link', member_id: mid }].concat(me ? [{ op: 'member_unlink', member_id: me.member_id }] : []), { mid, name: x.name });", name: 'unlink と link の順を逆に', only: 'T3' },
  { file: GR, from: 'if (last && last.claimed === true)', to: 'if (false)', name: 'claimed を見ない', only: 'T5' },
  { file: GR, from: "if (s.err === 'taken') { meRead = true; sync(); return", to: "if (s.err === 'taken') { return", name: 'taken で読み直さない', only: 'T17' },
  { file: GR, from: "if (meRead) { meRead = false; if (page === 'me') renderMe(); }", to: '', name: '読み直しで名前の頁を描き直さない', only: 'T17' },
  { file: GR, from: "const typed = el.querySelector('#meNew') ? el.querySelector('#meNew').value : '';", to: "const typed = '';", name: '打ちかけの名前を消す', only: 'T4' },
  { file: GR, from: 'const meOk = () => !room.closed && !st.needs_upload;', to: 'const meOk = () => !room.closed;', name: '端末だけの写しでも出す', only: 'T9' },
  { file: GR, from: "if (outbox.length || merge.size) { kick(); return say('前に入れた点", to: "if (false) { kick(); return say('前に入れた点", name: '並びの門を抜く', only: 'T6' },
  { file: GR, from: "if (offline()) return say('電波がつながってから選べます。');", to: '', name: '電波の門を抜く', only: 'T7' },
  { file: GR, from: 'if (meBusy || dead) return;', to: 'if (dead) return;', name: '送り中の門を抜く', only: 'T10' },
  { file: GR, from: "if (lane) return say('読み込み中です。少し待ってもう一度押してください。');", to: 'if (lane) return;', name: '読み中を黙って返す', only: 'T10b' },
  { file: GR, from: 'if (!meOp || meOp.key !== key) meOp =', to: 'if (!meOp) meOp =', name: 'op_id を組に結ばない', only: 'T16' },
  { file: GR, from: "if (s.kind !== 'retry') meOp = null;", to: 'meOp = null;', name: '切れた後に op_id を替える', only: 'T16' },
  { file: GR, from: "(m.me === true ? '<small class=\"r-me-tag\">あなた</small>' : '')", to: "''", name: '印を出さない', only: 'T1' },
  { file: GR, from: 'if (meOk() && !myMember()) h += \'<button data-newme', to: 'if (meOk()) h += \'<button data-newme', name: '（これは私）を me が在っても出す', only: 'T11' },
  { file: GR, from: "{ op: 'member_link', member_id: id }]), { mid: id", to: "{ op: 'member_link', member_id: uuid() }]), { mid: id", name: 'add と link の id を分ける', only: 'T4' },
  { file: GR, from: 'picking.seats.push(t.mid); // 足した自分', to: 'void 0; // 足した自分', name: '足した自分を半荘に入れない', only: 'T4,T11' },
  { file: GR, from: "if (s.err === 'mj_role') sync();", to: "if (s.err === 'mj_role') sync(); if (s.err === 'full') return say('名乗りがいっぱいです（管に付け替えを頼んでください）');", name: '名簿の full も名乗りの字', only: 'T14' },
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
    for (const b of r.bad) console.log('  ✗ ' + b);
    code = r.fail ? 1 : 0;
  } else {
    let red = 0;
    const base = process.env.ONLY;
    for (const m of MUT.filter((x) => !process.env.MUTONLY || x.name.includes(process.env.MUTONLY))) {
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
