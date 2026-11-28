// E2（A21・e_sadame v2 §E2）代表1人でも各自でも点を入れる＝画面の分の自己確認。node gamen_e2-e2e.cjs <作業木> [--self] [--chromium]
// 形は gamen_c4-e2e.cjs の写し：本物の taikyoku.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// mj_read・mj_write は★この台の中の偽の倉庫★＝lib の applyOps＋倉庫の門 (a) 開いている回 open・(b) seen_n より回が多い new（§5）。freeze＝古い写しのまま送らせる（最初の書きで解く）。
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
  { op: 'session_add', session_id: 's1', date: '2026-11-26', rate: 100 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  { op: 'table_seats', table_id: 't1', seats: M4 },
];
const HS = (id, cells) => ({ op: 'hanchan_start', hanchan_id: id, table_id: 't1', seats: M4, cells });
const opt = () => ({ roomRules: RULES, now: NOW(), role: 'kan' });
function mkRoom(rid, ops) {
  let st = LIB.emptyState(); st.rules = RULES;
  for (const o of ops) { const r = LIB.applyOps(st, [o], opt()); if (!r.ok) throw new Error('台の op が弾かれた ' + JSON.stringify(o) + ' ' + JSON.stringify(r.res)); st = r.state; }
  DB.set(rid, { kind: 'shared', name: '会' + rid, rules: RULES, closed: false, read_ver: 1, st, results: new Map(), roles: {}, frozen: null });
  return st;
}
// 他の端末が書いた真似（倉庫へ直に当てる）
function dbApply(rid, ops) { const R = DB.get(rid); const r = LIB.applyOps(R.st, ops, opt()); if (!r.ok) throw new Error('dbApply ' + JSON.stringify(r.res)); R.st = r.state; R.st.rules = RULES; R.read_ver++; }
// 古い写しのまま送らせる＝freeze の間は読みに凍らせた写しを返す（最初の mj_write で解く）
function freeze(rid) { const R = DB.get(rid); R.frozen = { st: clone(R.st), read_ver: R.read_ver }; }
const stOut = (st) => { const o = clone(st); delete o.rules; delete o.needs_upload; return o; };
function mjRead(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  const v = R.frozen || { st: R.st, read_ver: R.read_ver };
  const since = a.p_args && a.p_args.since;
  if (since === v.read_ver) return { ok: true, same: true, read_ver: v.read_ver };
  return { ok: true, read_ver: v.read_ver, room: { kind: R.kind, name: R.name, role: 'kan', owner: true, closed: R.closed, rules: R.rules }, st: stOut(v.st) };
}
// 倉庫の門（e_sadame E2 §5）：hanchan_start＝(a) 鎖に開いている回 → conflict open／(b) 鎖の回の数 > seen_n → conflict new。何も書かない
function guard(R, ops) {
  for (const o of ops) {
    if (o.op !== 'hanchan_start') continue;
    const ch = LIB.tableChain(R.st, o.table_id);
    const hs = R.st.hanchans.filter((h) => ch.includes(h.table_id));
    const open = hs.find((h) => !h.voided && h.cells.some((v) => v === null));
    if (open) return { ok: false, err: 'conflict', at: { what: 'open', hanchan_id: open.hanchan_id } };
    if (o.seen_n !== undefined && hs.length > o.seen_n) return { ok: false, err: 'conflict', at: { what: 'new', hanchan_id: hs[hs.length - 1].hanchan_id } };
  }
  return null;
}
function mjWrite(uid, a) {
  const R = DB.get(a.p_room_id);
  if (!R) return { ok: false, err: 'gone' };
  R.frozen = null;
  if (R.results.has(a.p_op_id)) return R.results.get(a.p_op_id);
  const g = guard(R, a.p_ops);
  if (g) return g;
  const r = LIB.applyOps(R.st, a.p_ops, { roomRules: R.rules, now: NOW(), role: 'kan' });
  if (!r.ok) return r.res;
  R.st = r.state; R.st.rules = R.rules; R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; try { for await (const c of q) body += c; } catch (_) { return; } // 画面が閉じて問いが切れた（aborted・ECONNRESET）＝答えずに捨てる（握らないと試験の箱ごと落ちる・33c4f7f の a25r で1回）
    const { fn, args, dev, uid } = JSON.parse(body);
    const send = (o, status = 200) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: o, error: null, status })); };
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
    pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) bad.push('頁の console ' + dev + ': ' + m.text().slice(0, 200)); });
    return { pg, ctx };
  };
  const ctlRoom = (rid) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: 'kan', owner: true, rules: RULES, at: 1 });
  const seedOf = (uid, rid) => ({ ['mj-rooms:' + uid]: [ctlRoom(rid)], ['mj-room:' + uid + ':' + rid]: clone(DB.get(rid).st), ['mj-synced:' + uid + ':' + rid]: '1' });
  const openR = async (pg, rid) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}`); try { await pg.waitForSelector('#vRoom .r-top', { timeout: 8000 }); } catch (e) { console.log((await pg.content()).slice(0, 3000)); throw e; } };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const opsOf = (dev, name) => writes(dev).flatMap((w) => w.ops).filter((o) => o.op === name);
  const waitFor = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const outLen = async (pg, uid, rid) => ((await ls(pg, 'mj-outbox:' + uid + ':' + rid)) || []).length;
  // 箱の数（字から数だけ）・空は ''
  const boxes = (pg) => pg.evaluate(() => [0, 1, 2, 3].map((i) => { const e = document.querySelector('[data-c="' + i + '"]'); if (!e) return null; const s = String(e.value ?? e.textContent).replace(/[,\s]/g, '').replace('−', '-'); return s; }));
  // 点を入れる（map＝席→点・入れない席は空のまま）
  const fill = async (pg, map) => { for (const [i, v] of Object.entries(map)) await put(pg, Number(i), v); await kpk(pg, 'ok'); };
  const enter = async (pg, map) => { await pg.click('#rAdd'); await pg.waitForSelector('[data-c="0"]'); await fill(pg, map); await pg.click('#eOk'); await pg.waitForSelector('#vRoom .r-top'); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  try {
    // T1 1人だけ入れる＝hanchan_start の空いた席は null・seen_n 0・一覧に「まだ」と名前（E2 §1・§2・§5）
    if (want('T1')) {
      mkRoom('p1', base());
      const A = await device('A1', 'u1', seedOf('u1', 'p1'));
      await openR(A.pg, 'p1');
      await enter(A.pg, { 0: 30000 });
      await waitFor(async () => DB.get('p1').st.hanchans.length === 1, 5000);
      const hs = opsOf('A1', 'hanchan_start');
      ok('T1 hanchan_start の点＝[30000,null,null,null]', hs.length === 1 && JSON.stringify(hs[0].cells) === '[30000,null,null,null]', hs);
      ok('T1 seen_n＝0（鎖に回が無い）', hs.length === 1 && hs[0].seen_n === 0, hs[0] && hs[0].seen_n);
      ok('T1 倉庫の回も null のまま', DB.get('p1').st.hanchans.length === 1 && JSON.stringify(DB.get('p1').st.hanchans[0].cells) === '[30000,null,null,null]', DB.get('p1').st.hanchans);
      await waitFor(async () => (await txt(A.pg, '#vRoom .r-hyou tbody tr.r-why')) !== null, 3000);
      ok('T1 一覧の字「1回目＝点がまだ（鈴木・佐藤・高橋）」', (await txt(A.pg, '#vRoom .r-hyou tbody tr.r-why')) === '1回目＝点がまだ（鈴木・佐藤・高橋）', await txt(A.pg, '#vRoom .r-hyou tbody tr.r-why'));
      const mada = await A.pg.evaluate(() => [...document.querySelectorAll('#vRoom .r-hyou tbody td small')].filter((e) => e.textContent === 'まだ').length);
      ok('T1 点がまだの欄は「まだ」（3つ）', mada === 3, mada);
    }
    // T2 全部空＝止める・送らない
    if (want('T2')) {
      mkRoom('p2', base());
      const A = await device('A2', 'u1', seedOf('u1', 'p2'));
      await openR(A.pg, 'p2');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]'); await A.pg.click('#eOk'); await sleep(300);
      ok('T2 字「全員の点を数で入れてください。」', (await txt(A.pg, '#eErr')) === '全員の点を数で入れてください。', await txt(A.pg, '#eErr'));
      ok('T2 送らない・並びも空', writes('A2').length === 0 && (await outLen(A.pg, 'u1', 'p2')) === 0);
    }
    // T3 開いている回が在る＝［＋］でその回を開く（新しい回でない）・空いた席を入れると cell_set 版0（E2 §3・§4）
    if (want('T3')) {
      mkRoom('p3', [...base(), HS('h1', [30000, null, null, null])]);
      const A = await device('A3', 'u1', seedOf('u1', 'p3'));
      await openR(A.pg, 'p3');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      ok('T3 開いた頁は 1回目（新しい2回目でない）', ((await txt(A.pg, '#title')) || '').startsWith('1回目'), await txt(A.pg, '#title'));
      ok('T3 入っている点は見せ・空いた箱は空', JSON.stringify(await boxes(A.pg)) === JSON.stringify(['30000', '', '', '']), await boxes(A.pg));
      await fill(A.pg, { 1: 25000 }); await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(async () => DB.get('p3').st.hanchans[0].cells[1] === 25000, 5000);
      const cs = opsOf('A3', 'cell_set');
      ok('T3 cell_set 席1・25000・版0 の1つだけ', cs.length === 1 && cs[0].seat === 1 && cs[0].value === 25000 && cs[0].base_version === 0, cs);
      ok('T3 hanchan_start を送らない', opsOf('A3', 'hanchan_start').length === 0);
      ok('T3 倉庫の h1＝[30000,25000,null,null]・回は1つ', DB.get('p3').st.hanchans.length === 1 && JSON.stringify(DB.get('p3').st.hanchans[0].cells) === '[30000,25000,null,null]', DB.get('p3').st.hanchans);
    }
    // T4 入っている点は消せない
    if (want('T4')) {
      mkRoom('p4', [...base(), HS('h1', [30000, null, null, null])]);
      const A = await device('A4', 'u1', seedOf('u1', 'p4'));
      await openR(A.pg, 'p4');
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      await put(A.pg, 0, ''); await put(A.pg, 1, 25000); await kpk(A.pg, 'ok'); await A.pg.click('#eOk'); await sleep(300);
      ok('T4 字「入っている点は消せません。数を入れてください。」', (await txt(A.pg, '#eErr')) === '入っている点は消せません。数を入れてください。', await txt(A.pg, '#eErr'));
      ok('T4 送らない', writes('A4').length === 0 && (await outLen(A.pg, 'u1', 'p4')) === 0);
    }
    // T5 seen_n は取り消した回も数える
    if (want('T5')) {
      mkRoom('p5', [...base(), HS('h1', [40000, 30000, 20000, 10000]), HS('h2', [35000, 30000, 25000, 10000]), { op: 'hanchan_void', hanchan_id: 'h2' }]);
      const A = await device('A5', 'u1', seedOf('u1', 'p5'));
      await openR(A.pg, 'p5');
      await enter(A.pg, { 0: 45000, 1: 30000, 2: 15000, 3: 10000 });
      await waitFor(async () => DB.get('p5').st.hanchans.length === 3, 5000);
      const hs = opsOf('A5', 'hanchan_start');
      ok('T5 seen_n＝2（取り消した h2 も数える）', hs.length === 1 && hs[0].seen_n === 2, hs[0] && hs[0].seen_n);
      ok('T5 倉庫に入った（門を通る）', DB.get('p5').st.hanchans.length === 3);
    }
    // T6 始めがぶつかる（他の端末が開いた回が在る＝open）＝止めない・その回を開いて打った数を空いた箱へ・違う数は字で（E2 §6）
    if (want('T6')) {
      mkRoom('p6', base());
      const A = await device('A6', 'u1', seedOf('u1', 'p6'));
      await openR(A.pg, 'p6');
      freeze('p6'); dbApply('p6', [HS('h1', [40000, 25000, null, null])]);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]'); await fill(A.pg, { 0: 30000, 2: 20000 }); await A.pg.click('#eOk');
      const t = await waitFor(async () => has(A.pg, '#eNote'), 8000);
      ok('T6 h1 の直す頁が開く（字が出る）', t >= 0);
      ok('T6 字「他の端末が先に 1回目を入れました（山田 40,000点）」', (await txt(A.pg, '#eNote')) === '他の端末が先に 1回目を入れました（山田 40,000点）', await txt(A.pg, '#eNote'));
      ok('T6 題は 1回目', ((await txt(A.pg, '#title')) || '').startsWith('1回目'), await txt(A.pg, '#title'));
      ok('T6 箱＝倉庫の 40000・25000＋打った 20000・空', JSON.stringify(await boxes(A.pg)) === JSON.stringify(['40000', '25000', '20000', '']), await boxes(A.pg));
      ok('T6 止めない（帯なし・並びは空）', !(await has(A.pg, '#rHeld')) && (await outLen(A.pg, 'u1', 'p6')) === 0, await outLen(A.pg, 'u1', 'p6'));
      await sleep(500);
      ok('T6 自動で送らない（書きは始めの1つだけ）', writes('A6').length === 1, writes('A6').length);
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(async () => DB.get('p6').st.hanchans[0].cells[2] === 20000, 5000);
      const cs = opsOf('A6', 'cell_set');
      ok('T6 入れる＝cell_set 席2・20000・版0', cs.length === 1 && cs[0].seat === 2 && cs[0].value === 20000 && cs[0].base_version === 0, cs);
      ok('T6 倉庫の h1＝[40000,25000,20000,null]・回は1つ', DB.get('p6').st.hanchans.length === 1 && JSON.stringify(DB.get('p6').st.hanchans[0].cells) === '[40000,25000,20000,null]', DB.get('p6').st.hanchans);
    }
    // T7 始めがぶつかる（知らない回が増えた＝new）＝新しい回として打った数を残して開く
    if (want('T7')) {
      mkRoom('p7', base());
      const A = await device('A7', 'u1', seedOf('u1', 'p7'));
      await openR(A.pg, 'p7');
      freeze('p7'); dbApply('p7', [HS('h1', [40000, 30000, 20000, 10000])]);
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]'); await fill(A.pg, { 0: 35000, 1: 30000, 2: 25000, 3: 10000 }); await A.pg.click('#eOk');
      const t = await waitFor(async () => has(A.pg, '#eNote'), 8000);
      ok('T7 新しい回の頁が開く（字が出る）', t >= 0);
      ok('T7 字「他の端末が先に 1回目を入れました。打った点は残しています。」', (await txt(A.pg, '#eNote')) === '他の端末が先に 1回目を入れました。打った点は残しています。', await txt(A.pg, '#eNote'));
      ok('T7 題は 2回目', ((await txt(A.pg, '#title')) || '').startsWith('2回目'), await txt(A.pg, '#title'));
      ok('T7 打った点が残る', JSON.stringify(await boxes(A.pg)) === JSON.stringify(['35000', '30000', '25000', '10000']), await boxes(A.pg));
      ok('T7 止めない・自動で送らない', !(await has(A.pg, '#rHeld')) && (await outLen(A.pg, 'u1', 'p7')) === 0 && writes('A7').length === 1, writes('A7').length);
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(async () => DB.get('p7').st.hanchans.length === 2, 5000);
      const hs = opsOf('A7', 'hanchan_start');
      ok('T7 入れ直しは seen_n 1 で倉庫に入る', hs.length === 2 && hs[1].seen_n === 1 && DB.get('p7').st.hanchans.length === 2, hs.map((o) => o.seen_n));
    }
    // T8 繋がらない間に始め＋同じ回の cell_set を打った → 繋がると始めがぶつかる＝両方消し、両方の数を空いた箱へ（見ないまま捨てない）
    if (want('T8')) {
      mkRoom('p8', base());
      const A = await device('A8', 'u1', seedOf('u1', 'p8'));
      await openR(A.pg, 'p8');
      await A.ctx.setOffline(true);
      await enter(A.pg, { 0: 30000 });
      await A.pg.click('#rAdd'); await A.pg.waitForSelector('[data-c="0"]');
      ok('T8 繋がらない間も開いている回（1回目）を開く', ((await txt(A.pg, '#title')) || '').startsWith('1回目'), await txt(A.pg, '#title'));
      await fill(A.pg, { 1: 25000 }); await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      const n0 = await outLen(A.pg, 'u1', 'p8');
      ok('T8 並びに2つ（始め・cell_set）・送っていない', n0 === 2 && writes('A8').length === 0, n0);
      freeze('p8'); dbApply('p8', [HS('h9', [null, null, null, 10000])]);
      await A.ctx.setOffline(false);
      const t = await waitFor(async () => has(A.pg, '#eNote'), 15000);
      ok('T8 h9 の直す頁が開く', t >= 0);
      ok('T8 箱＝打った 30000・25000＋倉庫の 10000', JSON.stringify(await boxes(A.pg)) === JSON.stringify(['30000', '25000', '', '10000']), await boxes(A.pg));
      ok('T8 並びは空（両方消した）・帯なし・書きは1つ', (await outLen(A.pg, 'u1', 'p8')) === 0 && !(await has(A.pg, '#rHeld')) && writes('A8').length === 1, [await outLen(A.pg, 'u1', 'p8'), writes('A8').length]);
      ok('T8 倉庫は h9 だけ', DB.get('p8').st.hanchans.length === 1 && DB.get('p8').st.hanchans[0].hanchan_id === 'h9');
    }
  } catch (e) { fail++; bad.push('例外 ' + String((e && e.stack) || e).slice(0, 300)); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

const G = 'js/gamen-room.mjs';
const MUT = [
  { file: G, from: "if (blank.every(Boolean) || cells.some((x, i) => Number.isNaN(x) && !blank[i])) return err(", to: "if (cells.some((x) => Number.isNaN(x))) return err(", name: '1人だけでは入れられない（T1）', only: 'T1' },
  { file: G, from: "if (blank.every(Boolean) || cells.some(", to: "if (cells.some(", name: '全部空でも止めない（T2）', only: 'T2' },
  { file: G, from: "if (r.why === 'cells') return r.no + '回目＝点がまだ' + cellsWho(r.hanchan_id, r.seats);", to: '', name: '一覧の「点がまだ」の字を出さない（T1）', only: 'T1' },
  { file: G, from: "const small = c.cell === null ? 'まだ' :", to: 'const small =', name: '点がまだの欄に「まだ」を出さない（T1）', only: 'T1' },
  { file: G, from: "if (op) hid = op.hanchan_id; }", to: 'if (false) hid = op.hanchan_id; }', name: '開いている回が在っても新しい回を開く（T3・T8）', only: 'T3,T8' },
  { file: G, from: "base_version: h.cell_ver[i] ?? 0 });", to: 'base_version: h.cell_ver[i] });', name: '行が無い席の版を0にしない（T3・T6）', only: 'T3,T6' },
  { file: G, from: "if (e.hanchan_id && blank.some((b, i) => b && e.orig.cells[i] !== null)) return err(", to: "if (false) return err(", name: '入っている点を消せる（T4）', only: 'T4' },
  { file: G, from: ", seen_n: seenN(e.tid) };", to: ' };', name: 'seen_n を送らない（T1・T5・T7）', only: 'T1,T5,T7' },
  { file: G, from: "return st.hanchans.filter((h) => ch.includes(h.table_id)).length; };", to: 'return st.hanchans.filter((h) => ch.includes(h.table_id) && !h.voided).length; };', name: 'seen_n に取り消した回を数えない（T5）', only: 'T5' },
  { file: G, from: "if (s.kind === 'conflict' && startConflict(head, s)) return;", to: '', name: '始めのぶつかりを止める（held）（T6・T7）', only: 'T6,T7' },
  { file: G, from: "if (x.cells[i] === null) entry.cells[i] = boxNum(t);", to: 'if (false) entry.cells[i] = boxNum(t);', name: '打った数を空いた箱へ入れない（T6）', only: 'T6' },
  { file: G, from: "if (e.note) h += '<p class=\"r-check mada\" id=\"eNote\">' + esc(e.note) + '</p>';", to: '', name: 'ぶつかった字を出さない（T6・T7）', only: 'T6,T7' },
  { file: G, from: "entry.seats.forEach((m, i) => { const t = typed(m); if (t !== null) entry.cells[i] = boxNum(t); });", to: '', name: 'new の時に打った点を残さない（T7）', only: 'T7' },
  { file: G, from: "if (o.op === 'cell_set' && Number.isInteger(o.seat) && o.seat >= 0 && o.seat < cells.length) cells[o.seat] = o.value;", to: '', name: '後の cell_set の数を拾わない（T8）', only: 'T8' },
  { file: G, from: "if (page === 'edit') render(); // startEntry", to: 'if (false) render(); // startEntry', name: '打った数を入れた後に描き直さない（T6・T7）', only: 'T6,T7' },
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
