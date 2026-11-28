// C4 途中でルールを変える（c4_sadame.md v3.3 §3・§3b・§5a・§6 の画面の台）＋［ルール］で変える形（table_rules を送る口）の自己確認。
// node gamen_c4-e2e.cjs <作業木> [--self] [--chromium]
// 形は gamen_b3b-e2e.cjs の写し：本物の taikyoku.html・index.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// mj_read・mj_write は★この台の中の偽の倉庫★（node 側で lib/room-state.mjs の applyOps を当てる＝follow・鎖・split_same・正味の門は lib の答え＝倉庫と同じ答えの試験は tests の lib 試験）。
// 区切りは偽の倉庫に table_rules を直に当てて作る（他の端末が［ルール］で変えた真似）か、画面の［このルールにする］（A20 で「次の回から」を消した）から。
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
  R.st = r.state; R.st.rules = R.rules; R.read_ver++;
  const res = { ok: true, read_ver: R.read_ver }; R.results.set(a.p_op_id, res); return res;
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const c of q) body += c;
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

const fmtPt = (pt10) => (pt10 > 0 ? '+' : pt10 < 0 ? '−' : '') + (Math.abs(pt10) / 10).toFixed(1);
// A8：ルールの箱は readonly＋inputmode none（アプリの数字鍵盤）＝fill できない。箱を押し ⌫ で空にして鍵で打つ（− は neg・. は dot）
async function kpPut(pg, sel, v) {
  const K = (k) => pg.click('.kp:not([hidden]) [data-kp="' + k + '"]');
  await pg.click(sel);
  for (let j = 0; j < 8; j++) await K('bs');
  for (const ch of String(v)) await K(ch === '-' || ch === '−' ? 'neg' : ch === '.' ? 'dot' : ch);
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
  const ctlRoom = (rid, extra = {}) => ({ room_id: rid, kind: 'shared', name: '会' + rid, role: 'kan', owner: true, rules: RULES, at: 1, ...extra });
  const seedOf = (uid, rid, room, more = {}) => ({ ['mj-rooms:' + uid]: [room || ctlRoom(rid)], ['mj-room:' + uid + ':' + rid]: clone(DB.get(rid).st), ['mj-synced:' + uid + ':' + rid]: '1', ...more });
  const openR = async (pg, rid) => { await pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=${rid}`); try { await pg.waitForSelector('#vRoom .r-top', { timeout: 8000 }); } catch (e) { console.log((await pg.content()).slice(0, 3000)); throw e; } };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent : null; }, s);
  const has = async (pg, s) => !!(await pg.$(s));
  const ls = (pg, k) => pg.evaluate((x) => JSON.parse(localStorage.getItem(x) || 'null'), k);
  const writes = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_write');
  const opsOf = (dev, name) => writes(dev).flatMap((w) => w.ops).filter((o) => o.op === name);
  const reads = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_read').length;
  const waitFor = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await fn()) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(step); } };
  const kpk = (pg, k) => pg.click('#eKp [data-kp="' + k + '"]');
  const put = async (pg, i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 9; j++) await kpk(pg, 'bs'); for (const ch of String(v)) await kpk(pg, ch === '-' ? 'neg' : ch); };
  const PM = (m, k = 'chip') => '#vRoom .r-pm[data-m="' + m + '"][data-k="' + k + '"][data-a="1"]';
  const rowNos = (pg) => pg.evaluate(() => [...document.querySelectorAll('#vRoom .r-hyou tbody .r-no')].map((b) => b.textContent));
  const cellBig = (pg, i, col) => pg.evaluate(([i, col]) => { const tr = document.querySelectorAll('#vRoom .r-hyou tbody tr:not(.r-why)')[i]; const td = tr && tr.querySelectorAll('td')[col]; const b = td && td.querySelector('b'); return b ? b.textContent : null; }, [i, col]);
  const vis = (pg) => pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const outLen = async (pg, uid, rid) => ((await ls(pg, 'mj-outbox:' + uid + ':' + rid)) || []).length;
  const enterNew = async (pg, cells) => { await pg.click('#rAdd'); await pg.waitForSelector('[data-c="0"]'); for (let i = 0; i < 4; i++) await put(pg, i, cells[i]); await kpk(pg, 'ok'); await pg.click('#eOk'); await pg.waitForSelector('#vRoom .r-top'); };
  const only = process.env.ONLY || '';
  const want = (k) => !only || only.split(',').includes(k);
  // 回の pt（卓のルールで）＝lib の hanchanView（画面は同じ物を出す）
  const ptOf = (rules, cells, seat) => LIB.hanchanView(rules, { cells, lost: 0, ton_order: null, seats: M4 }).pt10[seat];
  try {
    // C1 送る extra_add（± のまとめ）に follow:true・hanchan_start は A20 §1-1 から follow:false（押した時に見えていた卓）
    if (want('C1')) {
      mkRoom('a1', [...base(), H1]);
      const A = await device('A1', 'u1', seedOf('u1', 'a1'));
      await openR(A.pg, 'a1'); await A.pg.waitForSelector(PM('m1')); await sleep(300);
      await A.pg.click(PM('m1'));
      await waitFor(() => opsOf('A1', 'extra_add').length >= 1, 8000);
      await enterNew(A.pg, ['35000', '30000', '20000', '15000']);
      await waitFor(() => opsOf('A1', 'hanchan_start').length >= 1, 8000);
      const xa = opsOf('A1', 'extra_add'), hs = opsOf('A1', 'hanchan_start');
      ok('C1 extra_add に follow:true', xa.length >= 1 && xa.every((o) => o.follow === true), xa);
      ok('C1 hanchan_start に follow:false（A20）', hs.length === 1 && hs[0].follow === false, hs);
      ok('C1 倉庫に入った（2回目・チップ +1）', DB.get('a1').st.hanchans.length === 2 && DB.get('a1').st.extras.some((x) => x.member_id === 'm1' && x.value === 1));
    }

    // C2 鍵が同じ区切りの後の対局の頁：前の回が通し番号で残る・数えは回の卓のルール・前の回の直しは前の卓へ cell_set・代打ちに窓が出て鎖の最後へ extra_add（follow:true）・新しい回は鎖の最後へ
    if (want('C2')) {
      const newR = RL.rulesOk({ ...RULES, uma: [30, 10, -10, -30], kyotaku_end: 'kieru' }).rules; // 鍵が同じ区切り（ウマと供託の終わり＝どちらも SPLIT_KEYS の外）。E1 で直す頁の pt の字を消した＝直す頁で回の卓のルールが見えるのは［消えた供託］の欄
      mkRoom('b1', [...base(), H1, H2, split(newR)]);
      const A = await device('A2', 'u1', seedOf('u1', 'b1'));
      await openR(A.pg, 'b1'); await A.pg.waitForSelector(PM('m5')); await sleep(300);
      ok('C2 前の回が通し番号で残る（1回・2回）', JSON.stringify(await rowNos(A.pg)) === JSON.stringify(['1回', '2回']), await rowNos(A.pg));
      ok('C2 次は3回目（nextNo＝鎖の回の数＋1）', ((await txt(A.pg, '#rAdd')) || '').startsWith('3回目'), await txt(A.pg, '#rAdd'));
      const old0 = fmtPt(ptOf(RULES, H1.cells, 0)), new0 = fmtPt(ptOf(newR, H1.cells, 0));
      ok('C2 1回目は前のルールで数えたまま（台の確かめ：前と後で違う）', old0 !== new0 && (await cellBig(A.pg, 0, 0)) === old0, [await cellBig(A.pg, 0, 0), old0, new0]);
      ok('C2 前の卓だけに座った代打ち（m5）に±の窓が出る', await has(A.pg, PM('m5')));
      await A.pg.click(PM('m5'));
      await waitFor(() => DB.get('b1').st.extras.some((x) => x.member_id === 'm5'), 8000);
      const xa = opsOf('A2', 'extra_add');
      ok('C2 代打ちの ± は鎖の最後の卓へ follow:true で入る', xa.length === 1 && xa[0].table_id === T2 && xa[0].follow === true && DB.get('b1').st.extras.some((x) => x.member_id === 'm5' && x.table_id === T2 && x.value === 1), [xa, DB.get('b1').st.extras]);
      // 前の回（1回目）を直す＝前の卓のまま cell_set・見せる pt は前のルール
      await A.pg.click('#vRoom .r-no[data-h="h1"]'); await A.pg.waitForSelector('[data-c="0"]');
      ok('C2 直す頁の題は通し番号', ((await txt(A.pg, '#title')) || '').startsWith('1回目'), await txt(A.pg, '#title'));
      ok('C2 直す頁は前の卓のルール（前の卓は供託が消えない＝［消えた供託］の欄が無い）', (await A.pg.locator('#eLost').count()) === 0);
      await put(A.pg, 0, '41000'); await put(A.pg, 1, '29000'); await kpk(A.pg, 'ok');
      await A.pg.click('#eOk'); await A.pg.waitForSelector('#vRoom .r-top');
      // E1：直す頁の pt の字は消した＝保存した後の一覧の h1 の行で、4人の pt が前の卓のルールの数か
      { const C1 = [41000, 29000, 20000, 10000]; const pv = await A.pg.evaluate(() => { const b = document.querySelector('#vRoom .r-no[data-h="h1"]'); const tr = b && b.closest('tr'); return tr ? [...tr.querySelectorAll('td b')].map((x) => x.textContent).sort() : null; });
        const want = [0, 1, 2, 3].map((s) => fmtPt(ptOf(RULES, C1, s))).sort(), other = [0, 1, 2, 3].map((s) => fmtPt(ptOf(newR, C1, s))).sort();
        ok('C2 直した回の pt は前の卓のルール（一覧の h1）', JSON.stringify(pv) === JSON.stringify(want) && JSON.stringify(want) !== JSON.stringify(other), [pv, want, other]); }
      await waitFor(() => opsOf('A2', 'cell_set').length >= 2, 8000);
      const h1 = DB.get('b1').st.hanchans.find((h) => h.hanchan_id === 'h1');
      ok('C2 前の回の直しは前の卓のまま（cell_set・h1 は t1）', opsOf('A2', 'cell_set').length === 2 && h1.table_id === 't1' && h1.cells[0] === 41000, h1);
      await enterNew(A.pg, ['35000', '30000', '20000', '15000']);
      await waitFor(() => DB.get('b1').st.hanchans.length === 3, 8000);
      const h3 = DB.get('b1').st.hanchans.find((h) => !['h1', 'h2'].includes(h.hanchan_id));
      ok('C2 新しい回は鎖の最後の卓（A20：follow:false で鎖の最後を指す）', h3 && h3.table_id === T2 && opsOf('A2', 'hanchan_start')[0].table_id === T2 && opsOf('A2', 'hanchan_start')[0].follow === false, h3);
      await waitFor(async () => (await rowNos(A.pg)).length === 3, 4000);
      ok('C2 新しい回は通し番号3', JSON.stringify(await rowNos(A.pg)) === JSON.stringify(['1回', '2回', '3回']), await rowNos(A.pg));
      // ホームの「n回目まで」も鎖で数える
      await A.pg.goto(`http://127.0.0.1:${port}/index.html`); await A.pg.waitForSelector('#tsuzuki:not([hidden])');
      ok('C2 ホームの「半荘3回目まで」（鎖で数える）', ((await txt(A.pg, '#tsuzuki .h-m')) || '').includes('半荘3回目まで'), await txt(A.pg, '#tsuzuki .h-m'));
    }

    // C3 鍵が違う区切りの後：精算の内訳の前の卓の欄に［直す］→ extra_set が前の卓へ・内訳の値が変わる／鍵が同じ区切りでは［直す］が出ない
    if (want('C3')) {
      mkRoom('c1', [...base(), H1, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -2 }, split(chipR(30))]);
      ok('C3 台：鍵が違う区切り＝枚は前の卓に残る', DB.get('c1').st.extras.every((x) => x.table_id === 't1') && DB.get('c1').st.tables.find((t) => t.table_id === 't1').split_same === false);
      const A = await device('A3', 'u1', seedOf('u1', 'c1'));
      await openR(A.pg, 'c1'); await sleep(300);
      await A.pg.click('#rSeisan'); await A.pg.waitForSelector('[data-fix]');
      const F = '[data-fixrow="t1|m1|chip"]';
      ok('C3 前の卓の m1 チップの欄に今の値 +2 と［直す］', (await txt(A.pg, F + ' .r-fixv')) === '+2' && await has(A.pg, F + ' [data-fix]'), await txt(A.pg, F));
      ok('C3 新しい卓の欄には［直す］が無い', !(await has(A.pg, '[data-fix^="' + T2 + '|"]')));
      await A.pg.click(F + ' [data-fix]'); await A.pg.waitForSelector('#sFixV');
      await A.pg.fill('#sFixV', '3'); await A.pg.click('#sFixGo');
      await waitFor(() => opsOf('A3', 'extra_set').length >= 1 && DB.get('c1').st.extras.some((x) => x.member_id === 'm1' && x.value === 3), 8000);
      const xs = opsOf('A3', 'extra_set');
      ok('C3 extra_set は前の卓（t1）・base_version＝写しの行の版', xs.length === 1 && xs[0].table_id === 't1' && xs[0].value === 3 && xs[0].base_version === 1, xs);
      ok('C3 倉庫の前の卓の行が直った（鎖の最後へ行かない）', DB.get('c1').st.extras.some((x) => x.table_id === 't1' && x.member_id === 'm1' && x.value === 3) && !DB.get('c1').st.extras.some((x) => x.table_id === T2));
      await waitFor(async () => (await txt(A.pg, F + ' .r-fixv')) === '+3', 4000);
      ok('C3 内訳の値が変わる（+3）', (await txt(A.pg, F + ' .r-fixv')) === '+3', await txt(A.pg, F));
      ok('C3 前の卓の合計が0でない＝精算は止めて警告（入っていない物）', ((await txt(A.pg, '#sGo')) || '').includes('チップ'), await txt(A.pg, '#sGo'));
      // 鍵が同じ区切り
      mkRoom('c2', [...base(), H1, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -2 }, split(umaR([30, 10, -10, -30])),
        { op: 'extra_set', table_id: 't1', member_id: 'm3', kind: 'chip', value: 1, base_version: 0 }]); // 鍵が同じ区切りの後に前の卓に行が在っても（倉庫の extra_set は前の卓を直せる）口は出さない
      ok('C3 台：鍵が同じ区切り＋前の卓に行', DB.get('c2').st.tables.find((t) => t.table_id === 't1').split_same === true && DB.get('c2').st.extras.some((x) => x.table_id === 't1'));
      const B = await device('B3', 'u1', seedOf('u1', 'c2'));
      await openR(B.pg, 'c2'); await sleep(300);
      await B.pg.click('#rSeisan'); await B.pg.waitForSelector('[data-part="1"]');
      ok('C3 鍵が同じ区切りは［直す］を出さない（内訳は区切りごとに出る）', !(await has(B.pg, '[data-fix]')) && (await txt(B.pg, '[data-part="0"]')) === '1回目' && (await txt(B.pg, '[data-part="1"]')) === '2回目から', [await txt(B.pg, '[data-part="0"]'), await txt(B.pg, '[data-part="1"]')]);
    }

    // C3b 鍵が違う区切りでも前の卓に枚の行が無ければ［直す］を出さない
    if (want('C3')) {
      mkRoom('c3', [...base(), H1, split(chipR(30))]);
      const C = await device('C3b', 'u1', seedOf('u1', 'c3'));
      await openR(C.pg, 'c3'); await sleep(300);
      await C.pg.click('#rSeisan'); await C.pg.waitForSelector('[data-part="1"]');
      ok('C3b 鍵が違う区切り・前の卓に行が無い＝［直す］なし', DB.get('c3').st.tables.find((t) => t.table_id === 't1').split_same === false && !(await has(C.pg, '[data-fix]')));
    }

    // C4 開いていた卓が他の端末の区切りで読み直しに区切られた＝鎖の最後へ移り帯「ルールが変わりました（n回目まで前のルール）」
    if (want('C4')) {
      mkRoom('d1', [...base(), H1]);
      const A = await device('A4', 'u1', seedOf('u1', 'd1'));
      await openR(A.pg, 'd1'); await A.pg.waitForSelector(PM('m1')); await waitFor(() => reads('A4') >= 1, 4000); await sleep(300);
      ok('C4 区切る前は帯なし・次は2回目', !(await has(A.pg, '#rRuleNote')) && ((await txt(A.pg, '#rAdd')) || '').startsWith('2回目'));
      dbApply('d1', [split(umaR([30, 10, -10, -30]))]);
      const r0 = reads('A4'); await vis(A.pg); await waitFor(() => reads('A4') > r0, 4000, 50);
      await waitFor(() => has(A.pg, '#rRuleNote'), 4000);
      ok('C4 帯「ルールが変わりました（1回目まで前のルール）」', (await txt(A.pg, '#rRuleNote')) === 'ルールが変わりました（1回目まで前のルール）', await txt(A.pg, '#rRuleNote'));
      await A.pg.click(PM('m2'));
      await waitFor(() => DB.get('d1').st.extras.some((x) => x.member_id === 'm2'), 8000);
      ok('C4 移った後の ± は鎖の最後の卓', opsOf('A4', 'extra_add').every((o) => o.table_id === T2), opsOf('A4', 'extra_add'));
      // A10（司さん「ずっと出る」）：帯は変わった直後だけ＝次に書いたら消す
      await waitFor(async () => !(await has(A.pg, '#rRuleNote')), 4000);
      ok('C4 書いた後は帯「ルールが変わりました」が消える（A10）', !(await has(A.pg, '#rRuleNote')), await txt(A.pg, '#rRuleNote'));
    }

    // C5 follow の無い書き（古い版の並び）が区切った卓（鍵が違う）を指す＝倉庫が bad at table_id → 帯が出て止まる（消えて見えない・二重に入れない）
    if (want('C5')) {
      const st0 = mkRoom('e1', [...base(), H1]);
      dbApply('e1', [split(chipR(30))]);
      const ob = [{ op_id: '11111111-1111-4111-8111-111111111111', ops: [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }] }];
      const A = await device('A5', 'u1', { ['mj-rooms:u1']: [ctlRoom('e1')], ['mj-room:u1:e1']: clone(st0), ['mj-synced:u1:e1']: '1', ['mj-outbox:u1:e1']: ob });
      await A.pg.goto(`http://127.0.0.1:${port}/taikyoku.html?room=e1`); await A.pg.waitForSelector('#vRoom .r-top');
      await waitFor(() => has(A.pg, '#rHeld'), 8000);
      ok('C5 帯「ルールが変わりました。チップ等を入れ直してください」', ((await txt(A.pg, '#rHeld')) || '').startsWith('ルールが変わりました。チップ等を入れ直してください'), await txt(A.pg, '#rHeld'));
      ok('C5 並びに残る（黙って捨てない）・倉庫に入らない', (await outLen(A.pg, 'u1', 'e1')) === 1 && !DB.get('e1').st.extras.length);
      // 倉庫そのものも follow の無い書きを bad at table_id で弾く（偽の倉庫＝lib）
      const res = mjWrite('u1', { p_room_id: 'e1', p_op_id: 'x5', p_ops: ob[0].ops });
      ok('C5 倉庫の答え bad at table_id', res.err === 'bad' && res.at === 'table_id', res);
    }

    // C6 ［ルール］で変える（kan）＝A20 から人数も押せる（覚えを読んだ後）・table_rules が送られる・次の回は新しい卓・前の回は前のルールで数えたまま・帯
    if (want('C6')) {
      mkRoom('f1', [...base(), H1]);
      const A = await device('A6', 'u1', seedOf('u1', 'f1'));
      await openR(A.pg, 'f1'); await A.pg.waitForSelector(PM('m1')); await sleep(300);
      const pt0 = await cellBig(A.pg, 0, 0);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRules');
      ok('C6 kan には［このルールにする］（主ボタン）', (await txt(A.pg, '#rRuleGo')) === 'このルールにする' && ((await A.pg.getAttribute('#rRuleGo', 'class')) || '').includes('btn-main'));
      ok('C6 人数を押せる（A20・覚えを読んだ後に 4人/3人の押しボタン）', (await waitFor(() => has(A.pg, '#rRules [data-players]'), 8000)) >= 0);
      await A.pg.click('#rRules [data-open="uma"]'); await A.pg.waitForSelector('[data-uma="0"]');
      for (const [i, v] of [[0, '30'], [1, '10'], [2, '−10'], [3, '−30']]) await kpPut(A.pg, '[data-uma="' + i + '"]', v);
      await A.pg.click('#rRuleGo');
      await waitFor(() => opsOf('A6', 'table_rules').length >= 1, 8000);
      const tr = opsOf('A6', 'table_rules');
      ok('C6 table_rules が1つ送られる（直送・新しい卓の uuid・ウマ 30-10）', tr.length === 1 && tr[0].table_id === 't1' && /^[0-9a-f-]{36}$/.test(tr[0].new_table_id) && JSON.stringify(tr[0].rules.uma) === '[30,10,-10,-30]' && tr[0].rules.players === 4, tr);
      await A.pg.waitForSelector('#rRuleNote');
      ok('C6 帯「ルールが変わりました（1回目まで前のルール）」', (await txt(A.pg, '#rRuleNote')) === 'ルールが変わりました（1回目まで前のルール）', await txt(A.pg, '#rRuleNote'));
      ok('C6 前の回は前のルールで数えたまま', (await cellBig(A.pg, 0, 0)) === pt0 && pt0 === fmtPt(ptOf(RULES, H1.cells, 0)), [await cellBig(A.pg, 0, 0), pt0]);
      const nt = DB.get('f1').st.tables.find((t) => t.table_id === 't1').next_table_id;
      await enterNew(A.pg, ['40000', '30000', '20000', '10000']);
      await waitFor(() => DB.get('f1').st.hanchans.length === 2, 8000);
      const h2 = DB.get('f1').st.hanchans.find((h) => h.hanchan_id !== 'h1');
      ok('C6 次の回は新しい卓へ', !!nt && h2 && h2.table_id === nt, [nt, h2]);
      await waitFor(async () => (await rowNos(A.pg)).length === 2, 4000);
      ok('C6 次の回は新しいルールで数える', (await cellBig(A.pg, 1, 0)) === fmtPt(ptOf(umaR([30, 10, -10, -30]), [40000, 30000, 20000, 10000], 0)) && (await cellBig(A.pg, 0, 0)) === pt0, [await cellBig(A.pg, 1, 0), await cellBig(A.pg, 0, 0)]);
    }

    // C7 bad at extras（鍵が違う変え方で前の卓のチップの合計が0でない）＝帯だけ・ルールは変えない
    if (want('C7')) {
      mkRoom('g1', [...base(), H1, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }]);
      const A = await device('A7', 'u1', seedOf('u1', 'g1'));
      await openR(A.pg, 'g1'); await sleep(300);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRuleGo');
      await kpPut(A.pg, '#rChip', '3.0'); await A.pg.click('#rRuleGo');
      await waitFor(() => has(A.pg, '#rRuleMsg'), 8000);
      ok('C7 帯「前のルールのチップ等を合計0にしてから変えてください」', (await txt(A.pg, '#rRuleMsg')) === '前のルールのチップ等を合計0にしてから変えてください', await txt(A.pg, '#rRuleMsg'));
      ok('C7 倉庫は区切らない', DB.get('g1').st.tables.length === 1 && opsOf('A7', 'table_rules').length === 1, DB.get('g1').st.tables.length);
    }

    // C8 kan でない人（nyu）には打てる形が出ない（見るだけ）
    if (want('C8')) {
      mkRoom('h8', [...base(), H1], { roles: { u2: 'nyu' } });
      const A = await device('A8', 'u2', seedOf('u2', 'h8', ctlRoom('h8', { role: 'nyu', owner: undefined })));
      await openR(A.pg, 'h8'); await sleep(300);
      await A.pg.click('#barR'); await A.pg.waitForSelector('#rRules');
      ok('C8 nyu には［このルールにする］も打つ箱も無い', !(await has(A.pg, '#rRuleGo')) && !(await has(A.pg, '#rRules .box')) && !(await has(A.pg, '#rRules [data-open]')));
    }
  } catch (e) { fail++; bad.push('止まった: ' + String(e.message || e).split('\n').slice(0, 6).join(' | ')); }
  for (const c of ctxs) await c.close().catch(() => {});
  return { pass, fail, bad };
}

const G = 'js/gamen-room.mjs', L = 'lib/room-state.mjs';
const MUT = [
  { file: G, from: "cells: e.num, lost: e.lostNum, follow: false, seen_n:", to: 'cells: e.num, lost: e.lostNum, follow: true, seen_n:', name: 'hanchan_start を follow:true のまま（C1・C2）', only: 'C1,C2' },
  { file: G, from: "ops.push({ op: 'extra_add', table_id: tid, member_id: mid, kind, add, follow: true }); }", to: "ops.push({ op: 'extra_add', table_id: tid, member_id: mid, kind, add }); }", name: '± のまとめに follow を付けない（C1）', only: 'C1' },
  { file: L, from: "rows.push({ ...r, no: rows.length + 1, tno: r.no, table_id: p.table_id, late: at > cut });", to: 'rows.push({ ...r, tno: r.no, table_id: p.table_id, late: at > cut });', name: '通し番号をやめる（卓の中の no）（C2）', only: 'C2' },
  { file: G, from: "const v = table ? chainView(st, table.table_id) :", to: 'const v = table ? tableView(st, table.table_id) :', name: '対局の頁を鎖でなく自分の卓だけ（C2）', only: 'C2' },
  { file: G, from: "const fix = i < v.splits.length && !v.splits[i].same &&", to: 'const fix = i < v.splits.length &&', name: '鍵が同じ区切りでも［直す］を出す（C3）', only: 'C3' },
  { file: G, from: " && st.extras.some((e) => e.table_id === p.table_id);", to: ';', name: '前の卓に行が無くても［直す］を出す（C3b）', only: 'C3' },
  { file: G, from: "base_version: row ? row.version : 0 }", to: 'base_version: 0 }', name: '［直す］の base_version を写しの版にしない（C3）', only: 'C3' },
  { file: G, from: "  function setTable(t) { table = chainLast(t);", to: '  function setTable(t) { table = t || null;', name: '卓を鎖の最後にしない（C2・C4）', only: 'C2,C4' },
  { file: G, from: "    if (was && table && table.table_id !== was && tableChain(st, table.table_id).includes(was)) ruleNote", to: '    if (false) ruleNote', name: '区切られた時に帯を出さない（C4）', only: 'C4' },
  { file: G, from: '    ruleNote = null; takuNote = null;', to: '    takuNote = null;', name: '書いても帯「ルールが変わりました」を消さない（A10）', only: 'C4' },
  { file: G, from: "      else if (hi.why === 'bad' && outbox[0].held.at === 'table_id' && outbox[0].ops.some((o) => o.op === 'extra_add')) h +=", to: '      else if (false) h +=', name: 'bad at table_id の帯を出さない（C5）', only: 'C5' },
  { file: G, from: "    return needOf(WHO.table_rules, room.role) === null;", to: '    return true;', name: 'nyu にも打てる形を出す（C8）', only: 'C8' },
  { file: G, from: "{ rules: draft, readOnly: !edit, lockPlayers: !memOk,", to: '{ rules: draft, readOnly: !edit, lockPlayers: true,', name: '人数を押せない（C6）', only: 'C6' },
  { file: G, from: "  const ruleErrText = (r) => (r && r.err === 'bad' && r.at === 'extras' ?", to: '  const ruleErrText = (r) => (false ?', name: 'bad at extras の帯の字を出さない（C7）', only: 'C7' },
  { file: G, from: "const R1 = (t && t.rules) || (entry && entry.R) || R;", to: 'const R1 = R;', name: '前の回を鎖の最後の卓のルールで数える（C2）', only: 'C2' },
  { file: L, from: "const ch = tableChain(st, head.table_id), inChain = new Set(ch);", to: "const ch = [head.table_id], inChain = new Set(ch);", name: 'ホームを鎖で数えない（C2）', only: 'C2' },
  { file: G, from: "    ruleNote = table.table_id !== was ? ruleChangedText(chainView(st, table.table_id)) : null;", to: '    ruleNote = null;', name: '［ルール］で変えた後に帯を出さない（C6）', only: 'C6' },
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
