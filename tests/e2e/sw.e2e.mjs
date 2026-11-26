/* sw.e2e.mjs — 端末の控え（sw.js・js/sw-reg.js）を ★本物の SW の台★（webkit 390×844）で確かめる（設計 tataki/sw_sekkei_v1.md v3.3）
 * 真似の台（tests/sw.test.mjs）では見えない所だけ：
 *   a 初めての登録（controller 無し）の claim では帯も読み直しも出ない・2回目に開くと控えの html（meta mj-ver）で素材は全部 /v/<VER>/
 *   b ネットが落ちても控えから開く（名簿の画面・/r/<token>＝対局）
 *   c 版を上げる→2枚とも帯「新しい版があります」→押した1枚だけ読み直して新しい版・もう1枚は読み直さず帯「別の画面で…」
 *   d 入れ替えた直後に同じ tab で index→taikyoku と進む・別の画面を開く＝取り（performance の resource）が全部1つの版
 *   e controller 無しで開いた画面（初めての claim は無視）が、後の［入れ替える］では読み直す
 *   f manifest の start_url は素の /index.html（/v/ に解けない）・版を2つ上げても素の道で開いて最新の版
 * 配り方：作業木の写し（tmp）を http で出す。版上げ＝写しの css に1行足して sw-assets と同じ式で sw.js・version.json を書き直す（作業木は触らない）。
 * node tests/e2e/sw.e2e.mjs / --self-test（写しの sw.js・sw-reg.js をわざと壊して、壊し1つごとに赤になるか）
 * playwright は package.json に入れない＝CI は `npm i --no-save playwright@1.60.0`。手元は PW_FROM=<playwright の入った package.json>。
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { computeAll, writeSw, binarySet, served } from '../../scripts/sw-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = process.argv.includes('--self-test');
let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PW_FROM) { console.log('✗ playwright が無い（CI は npm i --no-save playwright@1.60.0・手元は PW_FROM）'); process.exit(1); }
  pw = createRequire(process.env.PW_FROM)('playwright');
}

const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const BIN = binarySet(ROOT);
const TOKEN = '0123456789abcdef0123456789abcdef';

function copyRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-swe2e-'));
  for (const f of fs.readdirSync(ROOT)) if (/\.(html|json)$/.test(f) || f === 'sw.js') fs.copyFileSync(path.join(ROOT, f), path.join(d, f));
  for (const sub of ['css', 'js', 'lib', 'vendor', 'icons']) fs.cpSync(path.join(ROOT, sub), path.join(d, sub), { recursive: true });
  return d;
}
const rd = (d, p) => fs.readFileSync(path.join(d, p), 'utf8').replace(/\r\n/g, '\n');
/** sw-assets --write と同じ式で写しの sw.js・version.json を書き直す。返り＝VER */
function rewrite(d) {
  const st = rd(d, 'sw.js');
  const g = computeAll(d, st, BIN);
  if (g.problems.length) throw new Error('名簿の問題：' + g.problems.join(' / '));
  fs.writeFileSync(path.join(d, 'sw.js'), writeSw(st, g.ver, g.assets));
  fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ ver: g.ver }) + '\n');
  return g.ver;
}
let bumps = 0;
function bump(d) { fs.appendFileSync(path.join(d, 'css/app.css'), `\n/* e2e の版上げ ${++bumps} */\n`); return rewrite(d); }

/* ネット無し＝繋がせない（listen を閉じ、開いている接続も切る）。受けてから切る（socket.destroy）形だと、CI の webkit は
   SW の取りの接続が切られた所で通信の処理ごと落ち、SW の登録と控えが丸ごと消える（11-24 調べ 40回中5回・赤の回は caches.keys()=[]）＝客の端末の圏外とも違う */
function serve(d) {
  const st = { offline: false, log: [] };
  const socks = new Set();
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    st.log.push((Date.now() % 100000) + " " + u);
    if (st.offline) { q.socket.destroy(); return; }
    let rel = u.replace(/^\/+/, '') || 'index.html';
    if (/^r\/[0-9a-f]{32}\/?$/.test(rel)) rel = 'taikyoku.html';   // vercel.json の rewrites と同じ
    const f = path.join(d, rel);
    if (!f.startsWith(d) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(f.startsWith(d) ? 404 : 403); r.end(); return; }
    // 配る字は sha を測るのと同じ served()（CRLF→LF＝repo と Vercel と CI の中身）。手元の作業木は autocrlf で CRLF の事がある
    r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    r.end(served(d, '/' + rel.split(path.sep).join('/'), BIN));
  });
  srv.on('connection', (s) => { socks.add(s); s.once('close', () => socks.delete(s)); });
  let port = 0;
  const listen = () => new Promise((ok, ng) => { srv.once('error', ng); srv.listen(port, '127.0.0.1', () => { srv.off('error', ng); port = srv.address().port; ok(); }); });
  st.goOffline = () => { st.offline = true; srv.close(); for (const s of socks) s.destroy(); };
  st.goOnline = async () => { await listen(); st.offline = false; };
  return listen().then(() => ({ srv, st, base: `http://127.0.0.1:${port}/` }));
}

const browser = await pw.webkit.launch();
const shut = () => Promise.race([browser.close().catch(() => {}), new Promise((ok) => setTimeout(ok, 5000))]);

const STOP = Symbol('stop');
let fast = false;

/* 画面の見え方を1回で引く */
const look = (p) => p.evaluate(() => {
  const m = document.querySelector('meta[name="mj-ver"]');
  const b = document.querySelector('.mj-swband');
  const res = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname);
  return {
    path: location.pathname,
    ver: m ? m.getAttribute('content') : null,
    ctl: !!navigator.serviceWorker.controller,
    band: b && !b.hidden ? b.textContent : '',
    loads: Number(sessionStorage.getItem('e2e.loads') || 0),
    vers: [...new Set(res.filter((x) => x.startsWith('/v/')).map((x) => x.split('/')[2]))],
    plain: res.filter((x) => /\.(m?js|css)$/.test(x) && !x.startsWith('/v/') && x !== '/js/supa-config.js' && x !== '/js/sw-reg.js'),
    title: document.title,
  };
});
const waitFor = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const ctlReady = (p) => waitFor(p, () => !!navigator.serviceWorker.controller);
const bandHas = (p, s) => waitFor(p, (t) => { const b = document.querySelector('.mj-swband'); return !!b && !b.hidden && b.textContent.includes(t); }, s, 30000);
/** SW が控えを作り終えた（完了印）を待つ */
const doneReady = (p, ver) => waitFor(p, async (v) => { const c = await caches.open('mj-' + v); return !!(await c.match('/__mj_done')); }, ver, 30000);

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // 読み込みの回数を tab ごとに数える（読み直されたかを見る）
  await ctx.addInitScript(() => { try { sessionStorage.setItem('e2e.loads', String(Number(sessionStorage.getItem('e2e.loads') || 0) + 1)); } catch (_) {} });
  return ctx;
}
function errsOf(p) {
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supa-config|supabase/i.test(m.text())) errs.push(m.text()); });
  return errs;
}

async function run(d) {
  const bad = [];
  let n = 0;
  const ok = (what, cond, why = '') => { n++; if (!cond) { bad.push(what + (why ? ' — ' + why : '')); if (fast) throw STOP; } };
  const { srv, st, base } = await serve(d);
  const ctxs = [];
  try {
    let V0 = JSON.parse(rd(d, 'version.json')).ver;

    // a 初めての登録
    const ctx = await newCtx(); ctxs.push(ctx);
    const p1 = await ctx.newPage();
    const e1 = errsOf(p1);
    await p1.goto(base + 'index.html');
    ok('a 初めて開くと controller が付く（claim）', await ctlReady(p1));
    ok('a 控えに完了印', await doneReady(p1, V0));
    await p1.waitForTimeout(500);
    let L = await look(p1);
    ok('a 初めての claim では帯が出ない', L.band === '', L.band);
    ok('a 初めての claim では読み直さない', L.loads === 1, String(L.loads));
    ok('a 初めての画面はネットの素の html（mj-ver 無し）', L.ver === null, String(L.ver));
    await p1.reload();
    L = await look(p1);
    ok('a 2回目は控えの html（mj-ver＝VER）', L.ver === V0, `${L.ver} / ${V0}`);
    ok('a 2回目の素材は全部 /v/<VER>/', L.vers.length === 1 && L.vers[0] === V0 && L.plain.length === 0, JSON.stringify([L.vers, L.plain]));

    // b ネットが落ちても開く
    st.goOffline();
    const pOff = await ctx.newPage();
    const eOff = errsOf(pOff);
    const g1 = await pOff.goto(base + 'hayami.html').then(() => true, (e) => e.message);
    ok('b ネット無しで早見表が開く', g1 === true, String(g1));
    ok('b ネット無しの早見表は表が出る', await waitFor(pOff, () => document.querySelectorAll('#hy-main tbody tr').length > 0, null, 8000));
    L = await look(pOff);
    ok('b ネット無しの早見表は控えの版', L.ver === V0, String(L.ver));
    const g2 = await pOff.goto(base + 'r/' + TOKEN).then(() => true, (e) => e.message);
    L = await look(pOff);
    ok('b ネット無しで /r/<token> は控えの対局', g2 === true && L.ver === V0 && L.path === '/r/' + TOKEN, JSON.stringify([g2, L.ver, L.path]));
    await pOff.close();
    await st.goOnline();
    ok('b 画面の err 0', eOff.length === 0, eOff.join(' / '));

    // c 版を上げる・2枚
    const logAt = st.log.length; const tb = Date.now() % 100000;
    const V1 = bump(d);
    const p2 = await ctx.newPage();
    const e2 = errsOf(p2);
    await p2.goto(base + 'machi.html');
    const hasB = await bandHas(p2, '新しい版があります');
    if (!hasB || process.env.DIAG_ALL) {
      console.log("DIAG " + (hasB ? "green" : "RED") + " bumpAt=" + tb + " V0=" + V0 + " V1=" + V1);
      console.log("DIAG p2log " + JSON.stringify(await p2.evaluate(() => window.__mjlog)));
      console.log("DIAG p2reg " + JSON.stringify(await p2.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && [r.installing && r.installing.state, r.waiting && r.waiting.state, r.active && r.active.state, !!navigator.serviceWorker.controller]; })));
      console.log("DIAG srv " + JSON.stringify(st.log.slice(logAt)));
    }
    ok('c 版上げの後に開いた2枚目は帯「新しい版があります」', hasB);
    await p1.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    ok('c 開いていた1枚目にも帯「新しい版があります」', await bandHas(p1, '新しい版があります'));
    L = await look(p2);
    ok('c 押す前の2枚目はまだ前の版', L.ver === V0, String(L.ver));
    const loads1 = (await look(p1)).loads;
    await p1.click('.mj-swband-btn');
    ok('c 押した1枚目は読み直す', await waitFor(p1, (n0) => Number(sessionStorage.getItem('e2e.loads')) > n0, loads1));
    await p1.waitForLoadState('load');
    L = await look(p1);
    ok('c 押した1枚目は新しい版で開き直す', L.ver === V1 && L.vers.length === 1 && L.vers[0] === V1, JSON.stringify([L.ver, L.vers, V1]));
    ok('c 読み直した1枚目に帯は無い', L.band === '', L.band);
    ok('c 押していない2枚目は帯「別の画面で新しい版に入れ替えました」', await bandHas(p2, '別の画面で新しい版に入れ替えました'));
    L = await look(p2);
    ok('c 押していない2枚目は勝手に読み直さない', L.loads === 1 && L.ver === V0, JSON.stringify([L.loads, L.ver]));

    // d 入れ替えた直後に進む
    await p1.goto(base + 'taikyoku.html');
    L = await look(p1);
    ok('d 同じ tab で index→taikyoku＝取りが全部新しい版', L.ver === V1 && L.vers.length === 1 && L.vers[0] === V1 && L.plain.length === 0, JSON.stringify([L.ver, L.vers, L.plain]));
    const p3 = await ctx.newPage();
    const e3 = errsOf(p3);
    await p3.goto(base + 'senseki.html');
    L = await look(p3);
    ok('d 入れ替えた直後に別の画面を開く＝取りが全部新しい版', L.ver === V1 && L.vers.length === 1 && L.vers[0] === V1 && L.plain.length === 0, JSON.stringify([L.ver, L.vers, L.plain]));
    ok('d 古い版の控えは1つだけ残る（今と1つ前）', await p3.evaluate(async () => (await caches.keys()).filter((k) => /^mj-[0-9a-f]{12}$/.test(k)).length) <= 2);
    await p2.click('.mj-swband-btn');
    ok('d 2枚目の［読み直す］で新しい版', await waitFor(p2, (v) => { const m = document.querySelector('meta[name="mj-ver"]'); return !!m && m.getAttribute('content') === v; }, V1));
    ok('c・d 画面の err 0', [...e1, ...e2, ...e3].length === 0, [...e1, ...e2, ...e3].join(' / '));

    // e controller 無しで開いた画面の2回目の change
    const ctxE = await newCtx(); ctxs.push(ctxE);
    const q1 = await ctxE.newPage();
    await q1.goto(base + 'tensu.html');
    ok('e 初めての画面に controller が付く', await ctlReady(q1));
    ok('e 控えに完了印', await doneReady(q1, V1));
    const V2 = bump(d);
    await q1.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    ok('e controller 無しで開いた画面にも帯', await bandHas(q1, '新しい版があります'));
    const lq = (await look(q1)).loads;
    await q1.click('.mj-swband-btn');
    ok('e その画面の［入れ替える］は読み直す（2回目の change）', await waitFor(q1, (n0) => Number(sessionStorage.getItem('e2e.loads')) > n0, lq));
    await q1.waitForLoadState('load');
    L = await look(q1);
    ok('e 読み直した画面は新しい版', L.ver === V2, `${L.ver} / ${V2}`);

    // f start_url
    const man = JSON.parse(rd(d, 'manifest.json'));
    const start = new URL(man.start_url, base + 'manifest.json');
    ok('f start_url は素の /index.html', start.pathname === '/index.html', start.pathname);
    const V3 = bump(d);
    const f1 = await ctxE.newPage();
    await f1.goto(base + 'index.html');
    ok('f 版を上げると帯', await bandHas(f1, '新しい版があります'));
    await f1.click('.mj-swband-btn');
    await waitFor(f1, (v) => { const m = document.querySelector('meta[name="mj-ver"]'); return !!m && m.getAttribute('content') === v; }, V3);
    const f2 = await ctxE.newPage();
    await f2.goto(start.href);
    L = await look(f2);
    ok('f start_url で開くと素の道で最新の版', L.path === '/index.html' && L.ver === V3, JSON.stringify([L.path, L.ver, V3]));
    const hrefs = await f2.evaluate(() => [...document.querySelectorAll('a[href],link[rel="manifest"],link[rel="apple-touch-icon"]')].map((a) => a.getAttribute('href')));
    ok('f 控えの html でも a href・manifest・apple-touch-icon は /v/ にならない', hrefs.length > 0 && hrefs.every((h) => !h.includes('/v/')), hrefs.join(','));
  } catch (e) {
    if (e !== STOP) bad.push('落ちた：' + (e && e.message ? e.message.split('\n')[0] : String(e)));
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
    srv.closeAllConnections?.(); srv.close();
  }
  return { n, bad };
}

/* ── 壊し（--self-test）＝写しだけ壊す。sw-reg.js は名簿に在るので壊した後に書き直す ── */
const rep = (a, b) => (s) => { if (!s.includes(a)) throw new Error('壊しの字が見つからない：' + a); return s.split(a).join(b); };
const BREAKS = [
  ['初めての claim でも帯を出す', 'js/sw-reg.js', rep('if (!hadCtl && changes === 1 && !swapping) return;', '')],
  ['押した画面を読み直さない', 'js/sw-reg.js', rep('if (swapping) { swapping = false; location.reload(); return; }', 'if (swapping) { swapping = false; return; }')],
  ['押していない画面も読み直す', 'js/sw-reg.js', rep("show('別の画面で新しい版に入れ替えました', '読み直す', function () { location.reload(); });", 'location.reload();')],
  ['SKIP_WAITING を受けない', 'sw.js', rep("if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();", '')],
  ['名簿の画面もネットだけ', 'sw.js', rep('if (PATHS.has(p) && p.endsWith(\'.html\')) {\n    const hit = await fromCache(VER, p);\n    if (hit) return hit;\n  }', '')],
  ['控えの html に mj-ver を足さない', 'sw.js', rep(".replace(/<head\\b[^>]*>/i, (h) => h + '<meta name=\"mj-ver\" content=\"' + VER + '\">')", '')],
  ['/r/ を対局にしない', 'sw.js', rep("else if (TOKEN_RE.test(p)) p = '/taikyoku.html';", '')],
  ['manifest の href も /v/ にする', 'sw.js', rep("(/\\srel\\s*=\\s*\"[^\"]*\\bstylesheet\\b[^\"]*\"/i.test(t) ? swap(t, 'href') : t)", "swap(t, 'href')")],
];

const t0 = Date.now();
/* webkit そのものの落ち（internal error）だけは写しを作り直して1回やり直す（11-21 CI で1回・後ろが巻き添えで赤）。
   壊しの赤は assert の赤なのでやり直しで消えない。壊しが webkit の落ちで「赤に見える」のもこれで防ぐ */
const isWk = (x) => /internal error/i.test(x);
async function runFresh(mk) {
  for (let i = 0; ; i++) {
    const d = mk();
    try {
      const r = await run(d);
      if (i === 0 && r.bad.some(isWk)) {
        const msg = 'webkit の internal error＝1回やり直す：' + r.bad.find(isWk).split('\n')[0];
        console.log('  ↻ ' + msg);
        // やり直しは緑に隠れる＝CI の summary に残して、増えたら人が見る（客の端末で間欠的に落ちる不具合かもしれない）
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '- ⚠ sw e2e ' + msg + '\n');
        continue;
      }
      return r;
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
}
try {
  if (!SELF) {
    const { n, bad } = await runFresh(copyRoot);
    for (const b of bad) console.log('  ✗ ' + b);
    console.log(`\nsw e2e: ${n - bad.length}/${n} ・ ${Math.round((Date.now() - t0) / 1000)}秒`);
    process.exitCode = bad.length ? 1 : 0;
  } else {
    const base = await runFresh(copyRoot);
    if (base.bad.length) { console.log(`✗ 壊す前に赤が ${base.bad.length} 本（先に本体を緑に）`); for (const b of base.bad) console.log('  ✗ ' + b); process.exitCode = 1; }
    else {
      fast = true;
      let red = 0;
      for (const [name, file, fn] of BREAKS) {
        try {
          const r = await runFresh(() => { const d = copyRoot(); fs.writeFileSync(path.join(d, file), fn(rd(d, file))); rewrite(d); return d; });
          // webkit の落ちだけの赤は「壊しが効いた」と数えない（偽の n/n を出さない）
          if (r.bad.length && r.bad.every(isWk)) console.log(`  ✗ 不定（webkit の落ちだけ）：${name}`);
          else if (r.bad.length) red++; else console.log(`  ✗ 壊しても緑のまま：${name}`);
        } catch (e) { console.log(`  ✗ 壊しが作れない：${name} — ${e.message}`); }
      }
      console.log(`自己確認: ${red}/${BREAKS.length}`);
      process.exitCode = red === BREAKS.length ? 0 : 1;
    }
  }
} finally {
  await shut();
  // webkit の子が残ると node が抜けない（11-21 手元で 8/8 を出した後 77分止まった）＝終わり値を持って抜ける
  process.exit(process.exitCode ?? 0);
}
