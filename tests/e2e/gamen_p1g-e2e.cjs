// P1g（pbundle_sadame v2.1 §3.3）リーグの頁（league.html・js/gamen-league.mjs）の合図で読む束ね＝画面の自己確認。
// node gamen_p1g-e2e.cjs <作業木> [--self] [--chromium]
// 形は gamen_d2-e2e.cjs の写し：本物の league.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）。
// rpc は頁の中の偽：mj_my_rooms は部屋1つ・mj_read は window.__readMs だけ待って返す（読みの始めの時刻・同時に走った本数を数える）。
// 壊し（--self）は配る中身の字を1か所ずつ書き換える（作業木は触らない）。
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const CHROMIUM = process.argv.includes('--chromium');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STUB = `export * from '/js/__core_real.mjs';
export async function needLogin(cb) { cb({ id: 'u1' }); }
export async function currentUser() { return { id: 'u1', email: 'u@example.invalid' }; }
window.__chans = {};
window.__aizu = (key) => { for (const f of window.__chans[key] || []) f({ payload: { v: 999999 } }); };
window.__n = { read: 0, live: 0, max: 0, starts: [] };
window.__readMs = 50;
export async function rpcRaw(fn, args) { return await sb().rpc(fn, args); } // 2b：部屋の mj_read・mj_write は rpcRaw を通る＝偽の sb へ
export function sb() { return { auth: { onAuthStateChange() {} },
  channel(key) { const c = { on(t, ev, cb) { (window.__chans[key] = window.__chans[key] || []).push(cb); return c; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return c; }, send() { return Promise.resolve('ok'); } }; return c; },
  removeChannel() { return Promise.resolve(); } }; }
export async function rpc(fn, args) {
  if (fn === 'mj_my_rooms') return { ok: true, rooms: [{ room_id: 'ra', kind: 'shared', name: '会ra', role: 'kan', closed: false, created_at: '2026-01-01T00:00:00.000Z', last_write_at: null }] };
  if (fn === 'mj_read') {
    const n = window.__n; n.read++; n.live++; n.max = Math.max(n.max, n.live); n.starts.push(performance.now());
    await new Promise((s) => setTimeout(s, window.__readMs));
    n.live--;
    return { ok: true, read_ver: 1, room: { kind: 'shared', name: '会ra', role: 'kan', owner: true, closed: false, rules: window.__rules, channel_key: 'ch-ra' }, st: { members: [] }, leagues: JSON.parse(JSON.stringify(window.__leagues)) };
  }
  return { ok: false, err: 'stub' };
}
export function showLogin(cb) { window.__login = (window.__login || 0) + 1; }
`;

let mutate = null;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/js/gamen-core.mjs') { r.writeHead(200, { 'content-type': MT['.mjs'] }); r.end(STUB); return; }
  if (u === '/js/__core_real.mjs') u = '/js/gamen-core.mjs';
  if (u === '/js/sw-reg.js') { r.writeHead(200, { 'content-type': MT['.js'] }); r.end(''); return; }
  if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  const ext = path.extname(f);
  if (ext === '.png') { r.writeHead(200, { 'content-type': MT[ext] }); r.end(fs.readFileSync(f)); return; }
  let b = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (mutate && f.replace(/\\/g, '/').endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

let RULES = null;
const lg = (id, name) => ({ league_id: id, name, date_from: null, date_to: null, rank_by: 'pt', min_games: 0, players_main: 4, rules: RULES, rules_alt: null, version: 1, voided: false, l: true });

async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([rules, l1]) => { window.__rules = rules; window.__leagues = [l1]; }, [RULES, lg('00000000-0000-4000-8000-000000000901', '金曜リーグ')]);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 20000);
  pg.on('pageerror', (e) => bad.push('頁の例外: ' + String(e.message || e).slice(0, 200)));
  pg.on('console', (m) => { if (m.type() === 'error') bad.push('頁の console: ' + m.text().slice(0, 200)); });
  const N = () => pg.evaluate(() => ({ read: window.__n.read, max: window.__n.max, starts: window.__n.starts.slice() }));
  const aizu = () => pg.evaluate(() => { window.__aizu('ch-ra'); return performance.now(); });
  let NM = '';
  try {
    NM = '開く';
    await pg.goto(`http://127.0.0.1:${port}/league.html`); await pg.waitForSelector('#vList .lg-room');
    await sleep(300);
    const n0 = await N();
    ok('開いた時の読みは1回', n0.read === 1, n0);

    // P1 合図1回＝1秒以内に1回読み、新しいリーグが一覧に出る
    NM = 'P1';
    await pg.evaluate((l2) => { window.__leagues.push(l2); }, lg('00000000-0000-4000-8000-000000000902', '土曜リーグ'));
    const t1 = await aizu();
    await sleep(1200);
    const n1 = await N();
    const s1 = n1.starts.filter((x) => x >= t1);
    ok('P1 合図1回＝読みは1回', s1.length === 1, n1);
    ok('P1 合図から読みの始めまで1秒以内', s1.length > 0 && s1[0] - t1 <= 1000, s1.map((x) => Math.round(x - t1)));
    const names = await pg.evaluate(() => [...document.querySelectorAll('#vList [data-lg] .row-name')].map((e) => e.textContent));
    ok('P1 読み直した中身を描く（土曜リーグが出る）', names.includes('土曜リーグ'), names);

    // P2 読み中に連打50回＝同時に1本・あと1回だけ読む
    NM = 'P2';
    await pg.evaluate(() => { window.__readMs = 600; window.__n.max = 0; });
    const r2 = (await N()).read;
    await aizu(); await sleep(450); // 0.3秒で読み始め・0.9秒まで読み中
    const t2 = await pg.evaluate(() => { for (let i = 0; i < 50; i++) window.__aizu('ch-ra'); return performance.now(); });
    await sleep(2500);
    const n2 = await N();
    ok('P2 読み中の連打50回＝同時に走る読みは1本', n2.max === 1, n2.max);
    ok('P2 読み中の連打50回＝読みは計2回', n2.read - r2 === 2, n2.read - r2);
    const s2 = n2.starts.filter((x) => x >= t2);
    ok('P2 読み中に来た合図＝1秒以内に後の読みが始まる', s2.length === 1 && s2[0] - t2 <= 1000, s2.map((x) => Math.round(x - t2)));

    // P3 3秒の荒らし（10ms ごと）・読み 200ms＝同時1本・14回以下・最後の合図の後にも読む
    NM = 'P3';
    await pg.evaluate(() => { window.__readMs = 200; window.__n.max = 0; });
    const r3 = (await N()).read;
    const sent = await pg.evaluate(() => new Promise((done) => { const s = []; const t0 = performance.now(); const tick = () => { if (performance.now() - t0 >= 3000) { done(s); return; } window.__aizu('ch-ra'); s.push(performance.now()); setTimeout(tick, 10); }; tick(); }));
    await sleep(1500);
    const n3 = await N();
    ok('P3 荒らしでも同時に走る読みは1本', n3.max === 1, n3.max);
    ok('P3 荒らし3秒＝読みは14回以下', n3.read - r3 <= 14, n3.read - r3);
    let worst = 0;
    for (const s of sent) { const st = n3.starts.find((x) => x >= s); worst = Math.max(worst, st === undefined ? 99999 : st - s); }
    ok('P3 どの合図も1秒以内に後の読みが始まる', worst <= 1000, Math.round(worst));
  } catch (e) { fail++; bad.push('止まった ' + NM + ': ' + String(e.message || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  await ctx.close();
  return { pass, fail, bad };
}

const L = 'js/gamen-league.mjs';
const MUT = [
  { file: L, from: "() => { if (chans.get(rid) === h) h.ar.poke(); }", to: '() => {}', name: '合図を受けても読まない（P1）' },
  { file: L, from: "() => { if (chans.get(rid) === h) h.ar.poke(); }", to: "() => { if (chans.get(rid) !== h || h.t) return; h.t = setTimeout(async () => { h.t = null; await readOne(rid); if (!$('vList').hidden) renderList(); }, 300); }", name: '前の形（0.3秒の札だけ・読み中でも重ねる）に戻す（P2・P3）' },
  { file: L, from: "await readOne(rid); if (!$('vList').hidden) renderList(); });", to: 'await readOne(rid); });', name: '読み直した後に描かない（P1）' },
  { file: 'lib/aizu-read.mjs', from: 'if (busy) { again = true; return; }', to: '', name: 'lib：読み中でも重ねて読む（P2・P3）' },
  { file: 'lib/aizu-read.mjs', from: 'if (again && !stopped) {', to: 'if (false) {', name: 'lib：読み中の合図を捨てる（P2）' },
];
(async () => {
  const RL = await import(pathToFileURL(path.join(ROOT, 'lib/rules.mjs')).href);
  RULES = RL.rulesOk({ ...RL.defaultRules(4), rate: 50, chip_pt10: 20 }).rules;
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
      mutate = m;
      const r = await run(br, port);
      if (r.fail) red++;
      console.log((r.fail ? '赤 ' : '★緑（効いていない）') + m.name + '  ✗' + r.fail + (r.fail ? '  例: ' + r.bad[0].slice(0, 140) : ''));
    }
    mutate = null;
    console.log(nm + ' 壊し ' + red + '/' + MUT.length + ' 赤'); code = red === MUT.length ? 0 : 1;
  }
  await Promise.race([br.close(), sleep(10000)]); srv.close(); process.exit(code);
})();
