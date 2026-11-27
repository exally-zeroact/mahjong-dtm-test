// C2-3（c2_sadame v9.4 §3）戦績の画面＝senseki.html＋js/gamen-senseki.mjs。
// node gamen_c23-e2e.cjs <作業木> [--self] [--chromium]（既定 WebKit）・ONLY=T1,T2・MUTONLY=<壊しの名の一部>
// 台は gamen_c20-e2e.cjs の写し（本物の senseki.html に、ログインと sb()／rpc() だけ差し替えた gamen-core を噛ませる）。
// 偽の倉庫は mj_account('my_stats') の頁を tests/fixtures/my-stats-live.json（khaw の本物の返し）から配り、after／at の鎖を倉庫と同じに確かめる。
// 期待値は手で書いた数（lib の答えを写して比べない）：A（ra／4頁 pages）＝4人 n6・pt 1800（+180.0）・枚込 1760・点 17600・順位 1位3 2位3／
//   B（rb）＝出た部屋 n3・pt 1500・出た後 1（11/20 卓1 3回目）・出た後に変わった卓 4／C（rc）＝unlinked shared 1。
// 警告の帯・説明の字は出さない（司さん 11-27 v158「警告文いらん」）＝その字が無いことも数える。
const http = require('http'), fs = require('fs'), path = require('path');
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

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/my-stats-live.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const canon = (v) => JSON.stringify(v ?? null);
let mutate = null;
const LOG = [];
const CTL = {};   // dev → { pages: [data…], force: { [呼びの番]: 返し } }
const ctl = (dev) => (CTL[dev] = CTL[dev] || { pages: [], force: {} });

/* 偽の倉庫＝after と at の鎖を倉庫と同じに（at の無い after は bad・after が前の頁の next_after でない＝bad） */
function myStatsPage(c, a) {
  if (!a || a.v !== 1) return { ok: false, err: 'bad', what: 'v' };
  const P = c.pages;
  if (a.after == null) { if (a.at != null) return { ok: false, err: 'bad', what: 'at' }; return clone(P[0]); }
  if (a.at == null) return { ok: false, err: 'bad', what: 'after' };
  for (let i = 1; i < P.length; i++) if (canon(P[i - 1].next_after) === canon(a.after)) return canon(P[0].at) === canon(a.at) ? clone(P[i]) : { ok: false, err: 'bad', what: 'at' };
  return { ok: false, err: 'bad', what: 'after' };
}
const srv = http.createServer(async (q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__rpc') {
    let body = ''; for await (const ch of q) body += ch;
    const { fn, args, dev } = JSON.parse(body);
    const c = ctl(dev);
    const send = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: o, error: null, status: 200 })); };
    if (fn === 'mj_account') {
      const e = { dev, fn, what: args.p_what, args: clone(args.p_args || {}) }; LOG.push(e);
      const k = LOG.filter((x) => x.dev === dev && x.fn === 'mj_account').length;
      if (c.force[k]) { e.res = c.force[k]; send(e.res); return; }
      e.res = args.p_what === 'my_stats' ? myStatsPage(c, args.p_args) : { ok: false, err: 'bad', what: 'what' };
      send(e.res); return;
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
  if (mutate && mutate.file && f.replace(/\\/g, '/').endsWith(mutate.file)) {
    if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); }
    b = b.replace(mutate.from, mutate.to);
  }
  r.writeHead(200, { 'content-type': MT[ext] || 'text/plain' }); r.end(b);
});

/* 2つのレートの台（ra の 卓5・卓6 を卓のレート 50 に）＝レート別の表の期待値：100＝4半荘 +160.0／50＝2半荘 +20.0 */
function twoRates() {
  const d = clone(FX.ra);
  for (const row of d.rows) for (const t of row.st.tables) if (t.label === '卓5' || t.label === '卓6') { t.rate_mode = 'num'; t.rate = 50; }
  return [d];
}
const BAND_WORDS = ['入っていない', '部屋を出た後に', '間違いなら', '数には入っています'];

async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };
  LOG.length = 0; for (const k of Object.keys(CTL)) delete CTL[k];
  const ctxs = [];
  const open = async (dev, pages, force) => {
    const c = ctl(dev); c.pages = pages; c.force = force || {};
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); ctxs.push(ctx);
    await ctx.addInitScript(([d]) => { window.__dev = d; window.__uid = 'u-' + d; }, [dev]);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 6000 : 15000);
    if (process.env.DBG) pg.on('console', (m) => console.log('C', dev, m.text().slice(0, 200)));
    pg.on('pageerror', (e) => bad.push('頁の例外 ' + dev + ': ' + String(e.message || e).slice(0, 200)));
    await pg.goto(`http://127.0.0.1:${port}/senseki.html`);
    await pg.waitForFunction(() => { const v = document.getElementById('vStats'); return (v && !v.hidden && !document.getElementById('sLoading')) || window.__login; });
    return pg;
  };
  const txt = (pg, s) => pg.evaluate((x) => { const e = document.querySelector(x); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, s);
  const all = (pg) => txt(pg, '#vStats');
  const has = async (pg, s) => !!(await pg.$(s));
  const cells = (pg, s) => pg.evaluate((x) => [...document.querySelectorAll(x + ' tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()).join('|')), s);
  const big = (pg) => pg.evaluate(() => [...document.querySelectorAll('.s-grp[data-pl="4"] .s-big b')].map((b) => b.textContent));
  const calls = (dev) => LOG.filter((x) => x.dev === dev && x.fn === 'mj_account');
  const noBand = async (pg, name) => { const t = await all(pg); ok(name + ' 警告・説明の字なし', !BAND_WORDS.some((w) => t.includes(w)), t.slice(0, 200)); };
  const only = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
  const step = async (k, fn) => { if (!only(k)) return; try { await fn(); } catch (e) { ok(k + ' 例外', false, String(e.message || e).slice(0, 300)); } };

  try {
    await step('T1', async () => {
      const pg = await open('T1', [FX.ra]);
      ok('T1 大きい数（合計pt・平均順位・トップ率・ラス率）', canon(await big(pg)) === canon(['+180.0', '1.50', '50%', '0%']), await big(pg));
      ok('T1 見出し＝4人打ち 全部（6半荘）', (await txt(pg, '.s-grp[data-pl="4"] .sec-h')) === '4人打ち 全部（6半荘）', await txt(pg, '.s-grp[data-pl="4"] .sec-h'));
      ok('T1 順位の分布＝1位 3・2位 3', canon(await pg.evaluate(() => [...document.querySelectorAll('.s-dist span')].map((s) => s.textContent))) === canon(['1位 3', '2位 3']));
      ok('T1 レート別＝1pt＝100 6 +180.0', canon(await cells(pg, '.s-rate[data-pl="4"]')) === canon(['レート|半荘|合計pt|平均順位|トップ', '1pt＝100|6|+180.0|1.50|50%']), await cells(pg, '.s-rate[data-pl="4"]'));
      const vs = await cells(pg, '.s-vs');
      ok('T1 相性＝佐藤 6 1.50 +180.0／鈴木 3 2.00 +30.0', vs.includes('佐藤|6|1.50|+180.0') && vs.includes('鈴木|3|2.00|+30.0') && vs.includes('伊藤|3|1.00|+150.0'), vs);
      ok('T1 3人の組は出さない', !(await has(pg, '.s-grp[data-pl="3"]')));
      ok('T1 出た部屋なし（in だけ）', !(await has(pg, '.s-out')));
      ok('T1 目安の字（6＜10）', await has(pg, '#sRough'));
      ok('T1 名前を選ぶ釦なし（unlinked 0）', !(await has(pg, '#sPickMe')));
      ok('T1 移り変わりの線', await has(pg, '.s-trend[data-pl="4"] polyline'));
      const h = await cells(pg, '.s-hist');
      ok('T1 対戦の履歴＝卓ごと6行（11/20 c22e41362・卓1 2回 +60.0）', h.length === 5 && h.includes('11/20 c22e41362・卓1|2回|+60.0 ›'), h);
      ok('T1 読みは1回（1頁）', calls('T1').length === 1 && calls('T1')[0].what === 'my_stats' && canon(calls('T1')[0].args) === canon({ v: 1 }), calls('T1').map((x) => x.args));
      await noBand(pg, 'T1');
    });
    await step('T2', async () => {
      const pg = await open('T2', [FX.ra]);
      await pg.click('#sMode [data-v="extras"]');
      ok('T2 チップ祝儀込＝+176.0', (await big(pg))[0] === '+176.0', await big(pg));
      await pg.click('#sMode [data-v="ten"]');
      ok('T2 点＝+17,600・合計点', (await big(pg))[0] === '+17,600' && (await txt(pg, '.s-grp[data-pl="4"] .s-big small')) === '合計点', [await big(pg), await txt(pg, '.s-grp[data-pl="4"] .s-big small')]);
      await pg.click('#sMode [data-v="pt"]');
      ok('T2 pt に戻す＝+180.0', (await big(pg))[0] === '+180.0');
      await pg.click('#sPl [data-v="3"]');
      ok('T2 3人＝組なし・まだ戦績はありません', !(await has(pg, '.s-grp')) && (await has(pg, '#sEmpty')));
      await pg.click('#sPl [data-v="4"]');
      ok('T2 4人＝+180.0', (await big(pg))[0] === '+180.0');
      ok('T2 読みは1回（切り替えで読み直さない）', calls('T2').length === 1, calls('T2').length);
    });
    await step('T3', async () => {
      const pg = await open('T3', [FX.rb]);
      const o = await cells(pg, '.s-out');
      ok('T3 出た部屋＝c22e41362 3 +150.0 出た後 1', canon(o) === canon(['部屋|半荘|合計|出た後', 'c22e41362|3|+150.0|1 ›']), o);
      ok('T3 大きい数＝+150.0', (await big(pg))[0] === '+150.0', await big(pg));
      ok('T3 相性なし（out の部屋だけ）', !(await has(pg, '.s-vs')));
      await pg.click('.s-out [data-out]');
      const d = await txt(pg, '.s-out .s-open');
      ok('T3 押すと日・卓・点＝11/20 卓1 3回目 1位 40,000 +50.0', !!d && d.includes('11/20 卓1 3回目 1位 40,000 +50.0'), d);
      ok('T3 出た後に変わった卓 4つ（11/21 卓4 ほか）', !!d && d.includes('出た後に変わった卓') && (await pg.$$('.s-out .s-open .s-dt')).length === 1 + 1 + 4 && d.includes('11/21 卓4'), d);
      await pg.click('.s-out [data-out]');
      ok('T3 もう一度押すと閉じる', !(await has(pg, '.s-out .s-open')));
      await noBand(pg, 'T3');
    });
    await step('T4', async () => {
      const pg = await open('T4', [FX.rc]);
      ok('T4 つないだ名が無い部屋＝［あなたの名前を選ぶ］→ホーム', (await txt(pg, '#sPickMe')) === 'あなたの名前を選ぶ' && (await pg.getAttribute('#sPickMe', 'href')) === 'index.html');
      ok('T4 字はほかに出さない（まだ戦績はありません だけ）', (await all(pg)).replace(/全部|リーグ ▾|レート ▾|期間 ▾|場所 ▾|pt だけ|チップ祝儀込|点|4人|3人|あなたの名前を選ぶ/g, '').trim() === 'まだ戦績はありません', await all(pg));
      await noBand(pg, 'T4');
    });
    await step('T5', async () => {
      const pg = await open('T5', FX.pages.map((p) => p.data));
      ok('T5 4頁を読み切って同じ数＝+180.0', (await big(pg))[0] === '+180.0', await big(pg));
      const cs = calls('T5');
      ok('T5 呼び4回・2回目から after＝前の next_after・at＝1頁目の at', cs.length === 4 && cs.slice(1).every((x, i) => canon(x.args.after) === canon(FX.pages[i].data.next_after) && x.args.at === FX.pages[0].data.at) && cs[0].args.after === undefined, cs.map((x) => x.args));
    });
    await step('T6', async () => {
      const pg = await open('T6', FX.pages.map((p) => p.data), { 2: { ok: false, err: 'busy', what: 'read' } });
      ok('T6 途中の頁が busy＝戦績を全部読めていません＋［もう一度］・数は出さない', (await txt(pg, '#sFail b')) === '戦績を全部読めていません' && (await has(pg, '#sRetry')) && !(await has(pg, '.s-grp')), await all(pg));
      await pg.click('#sRetry');
      await pg.waitForSelector('.s-grp');
      const cs = calls('T6');
      ok('T6 ［もう一度］は1頁目から＝+180.0', (await big(pg))[0] === '+180.0' && cs.length === 6 && cs[2].args.after === undefined, cs.map((x) => x.args));
    });
    await step('T7', async () => {
      const P = FX.pages.map((p) => clone(p.data)); P[2].at = '2026-11-27T09:00:00.000000Z';
      const pg = await open('T7', P);
      ok('T7 頁の at が違う＝読めていない', (await txt(pg, '#sFail b')) === '戦績を全部読めていません' && !(await has(pg, '.s-grp')), await all(pg));
    });
    await step('T8', async () => {
      const pg = await open('T8', [FX.ra], { 1: { ok: false, err: 'mj_session' } });
      ok('T8 mj_session＝ログインを出す', (await pg.evaluate(() => window.__login)) === 1);
      await pg.evaluate(() => window.__loginCb());
      await pg.waitForSelector('.s-grp');
      ok('T8 入った後に読む＝+180.0', (await big(pg))[0] === '+180.0');
    });
    await step('T9', async () => {
      const pg = await open('T9', twoRates());
      const rt = await cells(pg, '.s-rate[data-pl="4"]');
      ok('T9 レート別＝100：4 +160.0／50：2 +20.0', canon(rt.slice(1)) === canon(['1pt＝100|4|+160.0|1.25|75%', '1pt＝50|2|+20.0|2.00|0%']), rt);
      await pg.click('#sDims [data-dim="rate"]');
      await pg.click('#sPick button:has-text("1pt＝50")');
      ok('T9 レートで絞る＝2半荘 +20.0・表は出さない', (await big(pg))[0] === '+20.0' && (await txt(pg, '.s-grp[data-pl="4"] .sec-h')) === '4人打ち 1pt＝50（2半荘）' && !(await has(pg, '.s-rate')), [await big(pg), await txt(pg, '.s-grp[data-pl="4"] .sec-h')]);
      ok('T9 絞りの釦にレートの名', (await txt(pg, '#sDims [data-dim="rate"]')) === '1pt＝50 ▾');
      await pg.click('#sDims [data-dim="period"]');
      await pg.click('#sPick button:has-text("2026年11月")');
      ok('T9 期間 2026年11月も＝+20.0', (await big(pg))[0] === '+20.0');
      await pg.click('#sDims [data-dim="all"]');
      ok('T9 全部＝絞りを外す＝+180.0', (await big(pg))[0] === '+180.0' && (await txt(pg, '#sDims [data-dim="rate"]')) === 'レート ▾');
      await pg.click('#sDims [data-dim="period"]');
      ok('T9 期間の候補は 2026年11月 だけ', canon(await pg.evaluate(() => [...document.querySelectorAll('#sPick button')].map((b) => b.textContent))) === canon(['絞らない', '2026年11月']));
    });
    await step('T10', async () => {
      const pg = await open('T10', [FX.ra]);
      await pg.click('.s-hist [data-hist]:has-text("卓1")');
      const d = (await pg.evaluate(() => [...document.querySelectorAll('.s-hist .s-open .s-dt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()))).join('・');
      ok('T10 履歴を押すと半荘ごと＝2回目 1位 40,000 +50.0・3回目 2位 30,000 +10.0', d === '2回目 1位 40,000 +50.0・3回目 2位 30,000 +10.0', d);
    });
    await step('T11', async () => {
      const d = clone(FX.ra); for (const row of d.rows) row.st.v = 99;
      const pg = await open('T11', [d]);
      ok('T11 新しい版の記録＝アプリを新しくして', ((await txt(pg, '#sFail b')) || '').includes('アプリを新しくしてください') && !(await has(pg, '#sRetry')), await all(pg));
    });
  } finally { for (const c of ctxs) await c.close(); }
  return { pass, fail, bad };
}

const GS = 'js/gamen-senseki.mjs';
const MUT = [
  { file: GS, from: "return (v > 0 ? '+' : minus) + s;", to: "return (v > 0 ? '' : minus) + s;", name: '＋の印を落とす', only: 'T1' },
  { file: GS, from: "const s = m === 'ten' ? a.toLocaleString('ja-JP') : (a / 10).toFixed(1);", to: "const s = (a / 10).toFixed(1);", name: '点も10で割る', only: 'T2' },
  { file: GS, from: 'b.onclick = () => { mode = b.dataset.v; draw({}); };', to: 'b.onclick = () => { draw({}); };', name: 'pt・枚・点の切り替えが効かない', only: 'T2' },
  { file: GS, from: "if (!res.more) break;", to: 'break;', name: '1頁目で止める', only: 'T5' },
  { file: GS, from: "...(at ? { at } : {})", to: '', name: 'at を渡さない', only: 'T5' },
  { file: GS, from: "$('sRetry').onclick = () => loadAll();", to: "$('sRetry').onclick = () => {};", name: '［もう一度］が読み直さない', only: 'T6' },
  { file: GS, from: 'if (unl > 0) h +=', to: 'if (false) h +=', name: '名前を選ぶ釦を出さない', only: 'T4' },
  { file: GS, from: 'const nAfter = a ? a.n : 0;', to: 'const nAfter = 0;', name: '出た後の数を0に', only: 'T3' },
  { file: GS, from: "if (a.tables.length) d +=", to: 'if (false) d +=', name: '出た後に変わった卓を出さない', only: 'T3' },
  { file: GS, from: 'filterObj({ rate: r })', to: 'filterObj()', name: 'レート別でレートを絞らない', only: 'T9' },
  { file: GS, from: "filt[openDim] = b.dataset.pick === '__none' ? undefined : ch[openDim][Number(b.dataset.pick)][0];", to: 'void 0;', name: '絞りを選んでも効かない', only: 'T9' },
  { file: GS, from: "f.from = filt.period + '-01';", to: "f.from = '2099-01-01';", name: '期間の始めを違える', only: 'T9' },
  { file: GS, from: "openHist.has(k) ? openHist.delete(k) : openHist.add(k);", to: '', name: '履歴を開けない', only: 'T10' },
  { file: GS, from: "res.err === 'newer' ?", to: 'false ?', name: 'newer を読めないと同じに', only: 'T11' },
  { file: GS, from: "if (res && res.err === 'mj_session') { showLogin(() => loadAll()); return; }", to: '', name: 'mj_session でログインを出さない', only: 'T8' },
  { file: GS, from: "if (x.side !== 'out') continue;", to: '', name: '出た部屋に in も入れる', only: 'T1' },
  { file: GS, from: "if (!g.vs.length) return '';", to: "return '';", name: '相性を出さない', only: 'T1' },
];

(async () => {
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
