// A20 途中で人数も替える（a20_sadame v4 §1-§4・§9 の画面の台）：ルールの頁で 3人⇔4人・打つ人を選び直す・follow:false・late の行。
// node gamen_a20-e2e.cjs <作業木> [--self] [--chromium]
// 形は gamen_c4-e2e.cjs の写し（偽の倉庫＝lib の applyOps・mj_my_rules は MEMO を返す・倉庫と同じく行に created_at を付ける）。
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）・壊しごとに効く試しだけ回す（ONLY）。
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
export async function rpcRaw(fn, args) { return await sb().rpc(fn, args); } // 2b：部屋の mj_read・mj_write は rpcRaw を通る＝偽の sb へ
export function sb() { return { auth: { onAuthStateChange() {} }, rpc: call }; }
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
let LIB = null, RULES = null, RL = null;
const DB = new Map();   // rid → { kind, name, rules, closed, read_ver, st, results:Map, roles:{uid:role} }
const LOG = [];
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = () => new Date().toISOString();
const T2 = '00000000-0000-4000-8000-000000000002';
const M4 = ['m1', 'm2', 'm3', 'm4'];
const base = () => [
  { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
  { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
  { op: 'member_add', member_id: 'm5', name: '代打' },
  { op: 'session_add', session_id: 's1', date: '2026-11-22', rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  { op: 'table_seats', table_id: 't1', seats: M4 },
];
const H1 = { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: M4, cells: [40000, 30000, 20000, 10000] };
const H2 = { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm5'], cells: [35000, 30000, 25000, 10000] }; // m5＝前の卓の半荘にだけ座った代打ち
const umaR = (uma) => RL.rulesOk({ ...RULES, uma }).rules;            // 鍵が同じ区切り（ウマだけ）
const chipR = (pt10) => RL.rulesOk({ ...RULES, chip_pt10: pt10 }).rules; // 鍵が違う区切り（チップの単価）
const split = (rules, tid = 't1', nt = T2) => ({ op: 'table_rules', table_id: tid, new_table_id: nt, rules });
const opt = (direct) => ({ roomRules: RULES, now: NOW(), direct, role: 'kan' });
function mkRoom(rid, ops, { roles = {} } = {}) {
  let st = LIB.emptyState(); st.rules = RULES;
  for (const o of ops) { // 1つずつ（table_rules は direct）
    const r = LIB.applyOps(st, [o], opt(o.op === 'table_rules'));
    if (!r.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(o) + ' ' + JSON.stringify(r.res));
    st = r.state;
  }
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules: RULES, closed: false, read_ver: 1, st, results: new Map(), roles });
  return st;
}
function dbApply(rid, ops) { const R = DB.get(rid); const r = LIB.applyOps(R.st, ops, opt(ops.some((o) => o.op === 'table_rules'))); if (!r.ok) throw new Error('dbApply ' + JSON.stringify(r.res)); R.st = r.state; R.st.rules = RULES; R.read_ver++; }
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; return o; };
const roleOf = (R, uid) => R.roles[uid] || 'kan';
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  const since = a.p_args && a.p_args.since;
  if (since === R.read_ver) return { ok: true, same: true, read_ver: R.read_ver };
  return { ok: true, read_ver: R.read_ver, room: { kind: R.kind, name: R.name, role: roleOf(R, uid), owner: true, closed: R.closed, rules: R.rules }, st: stOut(R.st) };
}
function mjWrite(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  const ops = a.p_ops;
  const r = LIB.applyOps(R.st, ops, { roomRules: R.rules, now: NOW(), direct: ops.some((o) => o.op === 'table_rules'), role: roleOf(R, uid) });
  if (!r.ok) return r.res;
  R.st = r.state; R.st.rules = R.rules; R.read_ver++; stamp(R.st);
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
    const { fn, args, dev, uid } = JSON.parse(body);
    const send = (o, status = 200) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: o, error: null, status })); };
    if (fn === 'mj_my_rules') { LOG.push({ dev, fn }); send(clone(MEMO)); return; }
    if (fn === 'mj_read') { LOG.push({ dev, fn }); send(mjRead(uid, args)); return; }
    if (fn === 'mj_write') { const e = { dev, fn, op_id: args.p_op_id, ops: clone(args.p_ops) }; LOG.push(e); e.res = mjWrite(uid, args); send(e.res); return; }
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

const fmtPt = (pt10) => (pt10 > 0 ? '+' : pt10 < 0 ? '−' : '') + (Math.abs(pt10) / 10).toFixed(1);
// A8：ルールの箱は readonly＋inputmode none（アプリの数字鍵盤）＝fill できない。箱を押し ⌫ で空にして鍵で打つ（− は neg・. は dot）
async function kpPut(pg, sel, v) {
  const K = (k) => pg.click('.kp:not([hidden]) [data-kp="' + k + '"]');
  await pg.click(sel);
  for (let j = 0; j < 8; j++) await K('bs');
  for (const ch of String(v)) await K(ch === '-' || ch === '−' ? 'neg' : ch === '.' ? 'dot' : ch);
}
let MEMO = { ok: true, rules: {}, last: 4 }; // 偽の mj_my_rules の返し（試しごとに替える）
const R3 = () => RL.rulesOk({ ...RL.defaultRules(3), rate: 100, chip_pt10: 20 }).rules;
// 偽の倉庫の作った時刻（倉庫は行に created_at を付けて返す＝late の答えの元・A20 §9 任意3）
const stamp = (st, at) => { for (const x of [...st.tables, ...st.hanchans]) if (!x.created_at) x.created_at = at || NOW(); };
function mkRoomR(rid, ops, rules) {
  let st = LIB.emptyState(); st.rules = rules;
  for (const o of ops) {
    const r = LIB.applyOps(st, [o], { roomRules: rules, now: NOW(), direct: o.op === 'table_rules', role: 'kan' });
    if (!r.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(o) + ' ' + JSON.stringify(r.res));
    st = r.state;
  }
  stamp(st, '2026-11-22T00:00:00.000Z');
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules, closed: false, read_ver: 1, st, results: new Map(), roles: {} });
}
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  DB.clear(); LOG.length = 0;
  const ctxs = [];
  const device = async (dev, uid, seed) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([dev, uid, seed]) => {
      window.__dev = dev; window.__uid = uid;
      if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); }
    }, [dev, uid, seed]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 30000);
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    pg.on('console', (m) => { if (m.type() === 'error') bad.push('頁の console ' + dev + ': ' + m.text().slice(0, 200)); });
    return { pg, ctx };
  };
  const ctlRoom = (rid) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: 'kan', owner: true, rules: DB.get(rid).rules, at: 1 });
  const seedOf = (uid, rid) => ({ ['mj-rooms:' + uid]: [ctlRoom(rid)], ['mj-room:' + uid + ':' + rid]: clone(DB.get(rid).st), ['mj-synced:' + uid + ':' + rid]: '1' });
  const openR = async (pg, rid) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}`); await pg.waitForSelector('#vRoom .r-top', { timeout: 8000 }); };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const opsOf = (dev, name) => writes(dev).flatMap((w) => w.ops).filter((o) => o.op === name);
  const waitFor = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const vis = (pg) => pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const vals = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-c]')].map((x) => x.value));
  const disabled = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.disabled : null; }, s);
  const rulesGo = async (pg, n) => { await pg.click('#barR'); await pg.waitForSelector('#rRules [data-players="' + n + '"]', { timeout: 8000 }); await pg.click('#rRules [data-players="' + n + '"]'); await pg.click('#rRuleGo'); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  const M3 = ['m1', 'm2', 'm3'];
  const base = (rules) => [
    { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
    { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
    { op: 'session_add', session_id: 's1', date: '2026-11-22', rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_seats', table_id: 't1', seats: rules.players === 3 ? M3 : M4 },
  ];
  const H1 = { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: M4, cells: [40000, 30000, 20000, 10000] };
  try {
    // A 4→3 をルールの頁で押す：覚えの人数の鍵だけ替わり、他（レート・チップ）は卓のまま・table_rules に人数3・次の回は打つ人を選び直す・follow:false で新しい卓へ
    if (want('A')) {
      MEMO = { ok: true, rules: { 3: { ...RL.defaultRules(3), rate: 50, chip_pt10: null, uma: [20, 0, -20], start_pts: 30000, return_pts: 35000 } }, last: 4 };
      mkRoomR('a1', [...base(RULES), H1], RULES);
      const A = await device('A1', 'u1', seedOf('u1', 'a1'));
      await openR(A.pg, 'a1'); await sleep(300);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRules');
      ok('A 覚えを読みに行く（mj_my_rules）', (await waitFor(() => LOG.some((x) => x.dev === 'A1' && x.fn === 'mj_my_rules'), 8000)) >= 0);
      await A.pg.waitForSelector('#rRules [data-players="3"]', { timeout: 8000 });
      await A.pg.click('#rRules [data-players="3"]'); await A.pg.click('#rRuleGo');
      await waitFor(() => opsOf('A1', 'table_rules').length >= 1, 8000);
      const tr = opsOf('A1', 'table_rules')[0], r = tr && tr.rules;
      ok('A table_rules に人数3', r && r.players === 3, r);
      ok('A 人数の鍵は覚えから（ウマ 20/0/-20・持ち点 30000・返し 35000・赤 2・北 nuki）', r && JSON.stringify(r.uma) === '[20,0,-20]' && r.start_pts === 30000 && r.return_pts === 35000 && r.aka === 2 && r.kita === 'nuki', r);
      ok('A 他の鍵は卓のまま（レート 100・チップ 2.0）', r && r.rate === 100 && r.chip_pt10 === 20, r);
      await A.pg.waitForSelector('#rRuleNote');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('#pGo');
      ok('A 帯「今の回から3人打ちです…」', (await txt(A.pg, '#pReN')) === '今の回から3人打ちです。打つ人を選び直してください（打った点は残っています）。', await txt(A.pg, '#pReN'));
      ok('A 選び直すまで押せない（4人選んだまま）', (await disabled(A.pg, '#pGo')) === true);
      await A.pg.click('#pBase [data-pick="m4"]');
      ok('A 1人外すと押せる', (await disabled(A.pg, '#pGo')) === false);
      await A.pg.click('#pGo'); await A.pg.waitForSelector('[data-c="0"]');
      ok('A 点の箱は3つ', (await A.pg.locator('[data-c]').count()) === 3);
      await put(A.pg, 0, '45000'); await put(A.pg, 1, '30000'); await put(A.pg, 2, '15000'); await kpk(A.pg, 'ok');
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('A1', 'hanchan_start').length >= 1, 8000);
      const hs = opsOf('A1', 'hanchan_start')[0], nt = DB.get('a1').st.tables.find((t) => t.table_id === 't1').next_table_id;
      ok('A 保存は follow:false・新しい卓・3人', hs && hs.follow === false && hs.table_id === nt && JSON.stringify(hs.seats) === JSON.stringify(M3) && hs.cells.length === 3, [hs, nt]);
      ok('A 倉庫に入った（新しい卓に3人の回）', DB.get('a1').st.hanchans.some((h) => h.table_id === nt && h.seats.length === 3));
    }
    // B 入力中に他の端末が 4→3 に替えた＝読み直しで選び直しへ・打った点は人ごとに残る・外した人の点は見せて送らない
    if (want('B')) {
      MEMO = { ok: true, rules: {}, last: 4 };
      mkRoomR('b1', [...base(RULES), H1], RULES);
      const A = await device('A2', 'u1', seedOf('u1', 'b1'));
      await openR(A.pg, 'b1'); await sleep(300);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="3"]');
      await put(A.pg, 0, '40000'); await put(A.pg, 1, '30000'); await put(A.pg, 2, '20000'); await put(A.pg, 3, '10000'); await kpk(A.pg, 'ok');
      const r3 = R3();
      dbApply('b1', [{ op: 'table_rules', table_id: 't1', new_table_id: T2, rules: r3 }]); stamp(DB.get('b1').st);
      await vis(A.pg);
      ok('B 読み直しで選び直しの頁へ', (await waitFor(() => has(A.pg, '#pReN'), 8000)) >= 0, await txt(A.pg, '#title'));
      ok('B 帯「今の回から3人打ちです…」', (await txt(A.pg, '#pReN')) === '今の回から3人打ちです。打つ人を選び直してください（打った点は残っています）。', await txt(A.pg, '#pReN'));
      await A.pg.click('#pBase [data-pick="m4"]');
      ok('B 外した人：高橋 10,000', (await txt(A.pg, '#pOut')) === '外した人：高橋 10,000', await txt(A.pg, '#pOut'));
      await A.pg.click('#pGo'); await A.pg.waitForSelector('[data-c="0"]');
      ok('B 3人の点は残っている', JSON.stringify(await vals(A.pg)) === JSON.stringify(['40,000', '30,000', '20,000']), await vals(A.pg));
      const S = r3.start_pts;
      await put(A.pg, 0, String(S + 15000)); await put(A.pg, 1, String(S)); await put(A.pg, 2, String(S - 15000)); await kpk(A.pg, 'ok');
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('A2', 'hanchan_start').length >= 1, 8000);
      const hs = opsOf('A2', 'hanchan_start')[0];
      ok('B 保存は鎖の最後（T2）へ3人・外した人の点は送らない', hs && hs.table_id === T2 && hs.follow === false && JSON.stringify(hs.seats) === JSON.stringify(M3) && hs.cells.length === 3 && !hs.cells.includes(10000), hs);
    }
    // C 3→4：選び直した［始める］で、鎖に回が在っても続きの卓に回が無ければ table_seats を送る（4人目のチップ）
    if (want('C')) {
      MEMO = { ok: true, rules: {}, last: 3 };
      const r3 = R3(), S = r3.start_pts;
      mkRoomR('c1', [...base(r3), { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: M3, cells: [S + 10000, S, S - 10000] }], r3);
      const A = await device('A3', 'u1', seedOf('u1', 'c1'));
      await openR(A.pg, 'c1'); await sleep(300);
      await rulesGo(A.pg, 4);
      await waitFor(() => opsOf('A3', 'table_rules').length >= 1, 8000);
      const tr = opsOf('A3', 'table_rules')[0];
      ok('C table_rules に人数4（既定の人数の鍵）', tr && tr.rules.players === 4 && JSON.stringify(tr.rules.uma) === '[20,10,-10,-20]' && tr.rules.aka === 3 && tr.rules.kita === 'none', tr);
      await A.pg.waitForSelector('#rRuleNote');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('#pGo');
      ok('C 帯「今の回から4人打ちです…」', (await txt(A.pg, '#pReN')) === '今の回から4人打ちです。打つ人を選び直してください（打った点は残っています）。', await txt(A.pg, '#pReN'));
      ok('C 3人のままでは押せない', (await disabled(A.pg, '#pGo')) === true);
      await A.pg.click('#pBase [data-pick="m4"]');
      await A.pg.click('#pGo'); await A.pg.waitForSelector('[data-c="3"]');
      await waitFor(() => opsOf('A3', 'table_seats').length >= 1, 8000);
      const nt = DB.get('c1').st.tables.find((t) => t.table_id === 't1').next_table_id;
      const ts = opsOf('A3', 'table_seats');
      ok('C 続きの卓へ table_seats（4人）', ts.length === 1 && ts[0].table_id === nt && JSON.stringify(ts[0].seats) === JSON.stringify(M4), [ts, nt]);
      await put(A.pg, 0, '40000'); await put(A.pg, 1, '30000'); await put(A.pg, 2, '20000'); await put(A.pg, 3, '10000'); await kpk(A.pg, 'ok');
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('A3', 'hanchan_start').length >= 1, 8000);
      const hs = opsOf('A3', 'hanchan_start')[0];
      ok('C 保存は新しい卓へ4人', hs && hs.table_id === nt && hs.seats.length === 4 && hs.follow === false, hs);
    }
    // D 押した時に見えていた卓へ（follow:false）：開いた後に他の端末が区切っても、読み直す前に押した回は前の卓へ・一覧に「ルールを変える前に保存した回」
    if (want('D')) {
      MEMO = { ok: true, rules: {}, last: 4 };
      mkRoomR('d1', [...base(RULES), H1], RULES);
      const A = await device('A4', 'u1', seedOf('u1', 'd1'));
      await openR(A.pg, 'd1'); await sleep(300);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="3"]');
      await put(A.pg, 0, '35000'); await put(A.pg, 1, '30000'); await put(A.pg, 2, '20000'); await put(A.pg, 3, '15000'); await kpk(A.pg, 'ok');
      // 区切りは押す直前（10秒の読み直しより前＝この端末はまだ知らない）
      dbApply('d1', [{ op: 'table_rules', table_id: 't1', new_table_id: T2, rules: RL.rulesOk({ ...RULES, uma: [30, 10, -10, -30] }).rules }]); stamp(DB.get('d1').st);
      await sleep(20);
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => opsOf('A4', 'hanchan_start').length >= 1, 8000);
      const hs = opsOf('A4', 'hanchan_start')[0];
      ok('D 押した時の卓（t1）へ follow:false', hs && hs.table_id === 't1' && hs.follow === false, hs);
      ok('D 倉庫でも前の卓に入った', DB.get('d1').st.hanchans.some((h) => h.hanchan_id === hs.hanchan_id && h.table_id === 't1'));
      await vis(A.pg);
      ok('D 一覧に「ルールを変える前に保存した回」', (await waitFor(async () => (await txt(A.pg, '#vRoom .r-late td')) === 'ルールを変える前に保存した回', 8000)) >= 0, await txt(A.pg, '#vRoom .r-hyou'));
      ok('D 前からの回には出ない（1つだけ）', (await A.pg.locator('#vRoom .r-late').count()) === 1);
    }
    // E 覚えが読めない時に人数を押す＝既定＋帯（黙らない）
    if (want('E')) {
      MEMO = { ok: false, err: 'net' };
      mkRoomR('e1', [...base(RULES), H1], RULES);
      const A = await device('A5', 'u1', seedOf('u1', 'e1'));
      await openR(A.pg, 'e1'); await sleep(300);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRules [data-players="3"]', { timeout: 8000 });
      ok('E 押す前は帯なし', (await A.pg.locator('#rMemo:not([hidden])').count()) === 0);
      await A.pg.click('#rRules [data-players="3"]');
      ok('E 帯「前のルールが読めないので、いつものルールで出しています。」', (await A.pg.locator('#rMemo:not([hidden])').count()) === 1 && (await txt(A.pg, '#rMemo')) === '前のルールが読めないので、いつものルールで出しています。');
    }
  } catch (e) { if (process.env.DBG) for (const c of ctxs) for (const p of c.pages()) console.log('DBG', await p.evaluate(() => [document.title, (document.querySelector('#title') || {}).textContent, document.querySelector('#eKp') && document.querySelector('#eKp').hidden, (document.activeElement || {}).outerHTML, [...document.querySelectorAll('[data-c]')].map((x) => x.value)]).catch(() => null)); fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

const G = 'js/gamen-room.mjs', GR = 'js/gamen-rules.mjs';
const MUT = [
  { file: G, from: "lockPlayers: !memOk, midGame: true,", to: 'lockPlayers: !memOk,', name: '途中の人数替えで覚えを全部写す（A）', only: 'A' },
  { file: G, from: "      const rr = { ...R, ...ruleCtl.full(), ...ruleCtl.read() };", to: '      const rr = { ...R, ...ruleCtl.read(), players: R.players };', name: '人数を送らない（A・C）', only: 'A,C' },
  { file: G, from: "      const rr = { ...R, ...ruleCtl.full(), ...ruleCtl.read() };", to: '      const rr = { ...R, ...ruleCtl.read() };', name: '画面に出ない人数の鍵（赤・北）を前のまま送る（A・C）', only: 'A,C' },
  { file: G, from: "  const needReN = () => { const t = eFollow(); return !!(t && t.rules.players !== entry.seats.length); };", to: '  const needReN = () => false;', name: '入力中に人数が替わっても選び直さない（B）', only: 'B' },
  { file: G, from: "    e.seats.forEach((m, i) => { if (String(e.cells[i]).trim() !== '') carry[m] = e.cells[i]; else delete carry[m]; });", to: '', name: '打った点を残さない（B）', only: 'B' },
  { file: G, from: "(out.length ? '<p class=\"r-hint\" id=\"pOut\">", to: "(false ? '<p class=\"r-hint\" id=\"pOut\">", name: '外した人の点を見せない（B）', only: 'B' },
  { file: G, from: "(none(ch) || (none([t.table_id]) && cn(t.seats || []) !== cn(seats)))", to: 'none(ch)', name: '続きの卓に table_seats を送らない（C）', only: 'C' },
  { file: G, from: "cells: e.num, lost: e.lostNum, follow: false, seen_n:", to: 'cells: e.num, lost: e.lostNum, follow: true, seen_n:', name: 'follow:true のまま（D）', only: 'D' },
  { file: G, from: "      if (r.late) h +=", to: '      if (false) h +=', name: 'late の行を出さない（D）', only: 'D' },
  { file: G, from: "    const onBad = () => { ruleMemo = true;", to: '    const onBad = () => { return; ruleMemo = true;', name: '読めない帯を出さない（E）', only: 'E' },
  { file: GR, from: "if (midGame) { const x = swapPlayers(r, n, m);", to: 'if (midGame && false) { const x = swapPlayers(r, n, m);', name: 'mountRules が midGame を見ない（A）', only: 'A' },
];

(async () => {
  LIB = await import(pathToFileURL(path.join(ROOT, 'lib/room-state.mjs')).href);
  RL = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RL.rulesOk({ ...RL.defaultRules(4), rate: 100, chip_pt10: 20 }).rules;
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
    let red = 0; const M = MUT;
    for (const m of M) {
      mutate = m; process.env.ONLY = m.only || '';
      const r = await run(br, port);
      if (r.fail) red++;
      console.log((r.fail ? '赤 ' : '★緑（効いていない）') + m.name + '  ✗' + r.fail + (r.fail ? '  例: ' + r.bad[0].slice(0, 120) : ''));
    }
    mutate = null;
    console.log('壊し ' + red + '/' + M.length + ' 赤'); code = red === M.length ? 0 : 1;
  }
  await br.close(); srv.close(); process.exit(code);
})();
