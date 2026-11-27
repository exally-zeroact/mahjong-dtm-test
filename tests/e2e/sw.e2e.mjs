/* sw.e2e.mjs — 端末の控え（sw.js・js/sw-reg.js）を ★本物の SW の台★（webkit 390×844）で確かめる（設計 tataki/sw_sekkei_v1.md v3.3）
 * 真似の台（tests/sw.test.mjs）では見えない所だけ：
 *   a 初めての登録（controller 無し）の claim では帯も読み直しも出ない・2回目に開くと控えの html（meta mj-ver）で素材は全部 /v/<VER>/
 *   b ネットが落ちても控えから開く（名簿の画面・/r/<token>＝対局）
 *   c 版を上げる→2枚とも帯「新しい版があります」→押した1枚だけ読み直して新しい版・もう1枚は読み直さず帯「別の画面で…」
 *   d 入れ替えた直後に同じ tab で index→taikyoku と進む・別の画面を開く＝取り（performance の resource）が全部1つの版
 *   e controller 無しで開いた画面（初めての claim は無視）が、後の［入れ替える］では読み直す
 *   f manifest の start_url は素の /index.html（/v/ に解けない）・版を2つ上げても素の道で開いて最新の版
 *   u 取り込みが落ちても止まらない・黙らない（swupd_sadame v1.1）：503 が続く→右上の取り込み中の札→「取り込めませんでした」→次に見えた時は残りだけ取って帯→押せる／
 *     一時の 503・中身違いは取り直して帯だけ／待っている版が在る間に次の版が落ちても札も失敗も出さず帯のまま／中身違いが続く→失敗・前の版で動く／
 *     取りが止まったまま（返事が無い）→札はボタン・入力・鍵盤に重ならず押せない・MJ_BUSY_MS で「取り込めませんでした」／
 *     v1.3.1：続きの置き場 mj-part（画面と activate が作る・install は作らない）→ mj-conf → 使い捨て・update は1本ずつ・1回の取りと install の締め切り・
 *     締め切りの後に遅れて落ちた古い取り込みが次の控えを消さない・他の版の物の掃除（u1 u1b u2〜u5 u6 u7a u7b u8a u8b u9 u12）
 *   SW 側の knob（MJ_FETCH_MS・MJ_INSTALL_MS）は写しの sw.js の頭に self.MJ_*= を書いてから版を上げる（knobs）
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
import { computeAll, writeSw, binarySet, served, readSw } from '../../scripts/sw-assets.mjs';

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
/** 写しの sw.js の頭に SW 側の knob を書く（{} で消す）。版上げ（bump）の前に呼ぶ＝sw.js の字が変わり次の install で効く */
function knobs(d, o) {
  let t = rd(d, 'sw.js').replace(/^\/\*E2E-KNOBS\*\/.*\n/m, '');
  const line = Object.keys(o).length ? '/*E2E-KNOBS*/ ' + Object.entries(o).map(([k, v]) => 'self.' + k + ' = ' + v + ';').join(' ') + '\n' : '';
  if (!t.includes("\nconst VER = '")) throw new Error('sw.js に const VER が無い');
  t = t.replace("\nconst VER = '", '\n' + line + "const VER = '");
  fs.writeFileSync(path.join(d, 'sw.js'), t);
}
let bumps = 0;
function bump(d) { fs.appendFileSync(path.join(d, 'css/app.css'), `\n/* e2e の版上げ ${++bumps} */\n`); return rewrite(d); }

/* ネット無し＝繋がせない（listen を閉じ、開いている接続も切る）。受けてから切る（socket.destroy）形だと、CI の webkit は
   SW の取りの接続が切られた所で通信の処理ごと落ち、SW の登録と控えが丸ごと消える（11-24 調べ 40回中5回・赤の回は caches.keys()=[]）＝客の端末の圏外とも違う */
/* 落とし（u）：failN[道]=n＝n回 503／badN[道]=n＝n回 中身違い（200）／stall に在る道＝返事をしない（held に持つ・release で 503・releaseBad で 200 の中身違い）／
   stallOnce に在る道＝次の1回だけ返事をしない。count[道]＝来た回数 */
function serve(d) {
  const st = { offline: false, log: [], count: {}, failN: {}, badN: {}, stall: new Set(), stallOnce: new Set(), held: [], swT: [] };
  const socks = new Set();
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    st.log.push(u);
    if (st.offline) { q.socket.destroy(); return; }
    st.count[u] = (st.count[u] || 0) + 1;
    if (u === '/sw.js') st.swT.push([Date.now(), q.headers['service-worker'] || '', q.headers['cache-control'] || '']);
    if (st.stall.has(u)) { st.held.push(r); return; }
    if (st.stallOnce.has(u)) { st.stallOnce.delete(u); st.held.push(r); return; }
    if (st.failN[u] > 0) { st.failN[u]--; r.writeHead(503, { 'cache-control': 'no-store' }); r.end(); return; }
    if (st.badN[u] > 0) { st.badN[u]--; r.writeHead(200, { 'content-type': MT[path.extname(u)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end('/* e2e の中身違い */'); return; }
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
  st.release = () => { st.stall.clear(); st.stallOnce.clear(); for (const r of st.held.splice(0)) { try { r.writeHead(503); r.end(); } catch (_) {} } };
  st.releaseBad = () => { for (const r of st.held.splice(0)) { try { r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); r.end('/* e2e の遅れた中身違い */'); } catch (_) {} } };
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
    const V1 = bump(d);
    const p2 = await ctx.newPage();
    const e2 = errsOf(p2);
    await p2.goto(base + 'machi.html');
    ok('c 版上げの後に開いた2枚目は帯「新しい版があります」', await bandHas(p2, '新しい版があります'));
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

    // u 取り込みが落ちても止まらない・黙らない（swupd_sadame v1.3.1 §1〜§4）
    // 前の画面の context は閉じる＝他の登録の更新の取りが落としの回数を食わない
    for (const c of ctxs.splice(0)) await c.close().catch(() => {});
    const AS = readSw(rd(d, 'sw.js')).assets.map(([p]) => p);
    const X = '/lib/score.mjs', Y = '/lib/tiles.mjs';
    ok('u 名簿に X・Y が在る', AS.includes(X) && AS.includes(Y), AS.length + '本');
    const FAIL = '新しい版を取り込めませんでした', NEWV = '新しい版があります';
    const snap = () => Object.fromEntries(AS.map((p) => [p, st.count[p] || 0]));
    const delta = (a) => AS.filter((p) => (st.count[p] || 0) !== a[p]).map((p) => p + '+' + ((st.count[p] || 0) - a[p]));
    const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((ok2) => setTimeout(ok2, 100)); } return false; };
    const vis = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const regOf = (p) => p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { inst: !!(r && r.installing), wait: !!(r && r.waiting) }; });
    const idle = (p, ms = 30000) => waitFor(p, async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r && !r.installing; }, null, ms);
    const busySeen = (p) => waitFor(p, () => { const b = document.querySelector('.mj-swband'); return !!b && !b.hidden && b.classList.contains('is-busy'); });
    const isBusyNow = (p) => p.evaluate(() => { const b = document.querySelector('.mj-swband'); return !!b && b.classList.contains('is-busy'); });
    const bt = (p) => p.evaluate(() => window.__bt || []);
    const swCount = () => st.count['/sw.js'] || 0;
    // 置き場の中身（mj-part・mj-conf）：mine＝今の版 v の /v/・other＝他の版の /v/・conf＝supa-config が在る・all＝全部。無い控えは null
    const part = (p, v) => p.evaluate(async (v2) => {
      const out = {};
      for (const k of ['mj-part', 'mj-conf']) {
        if (!(await caches.has(k))) { out[k] = null; continue; }
        const ks = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
        out[k] = { mine: ks.filter((x) => x.startsWith('/v/' + v2 + '/')).length, other: ks.filter((x) => x.startsWith('/v/') && !x.startsWith('/v/' + v2 + '/')).length, conf: ks.includes('/js/supa-config.js'), all: ks.length };
      }
      return out;
    }, v);
    const dropCache = (p, ...ns) => p.evaluate(async (a) => { for (const n2 of a) await caches.delete(n2); }, ns);
    const noPart = (p, on) => p.evaluate((o) => { if (o) localStorage.setItem('e2e.nopart', '1'); else localStorage.removeItem('e2e.nopart'); }, on);
    const isDoneNow = (p, v) => p.evaluate(async (v2) => (await caches.has('mj-' + v2)) && !!(await (await caches.open('mj-' + v2)).match('/__mj_done')), v);
    const failThenIdle = async (p, what) => {
      ok(what + ' 取れないままなら「取り込めませんでした」', await bandHas(p, FAIL));
      await idle(p); await p.waitForTimeout(1500); await idle(p);
      const R2 = await regOf(p);
      ok(what + ' 落ちた後に待っている版も取り込み中も無い', !R2.wait && !R2.inst, JSON.stringify(R2));
    };
    const tapReload = async (p, what) => {
      ok(what + '：帯は押せる（取り込み中の札のままでない）', !(await isBusyNow(p)));
      const n0 = (await look(p)).loads;
      await p.click('.mj-swband-btn', { timeout: 5000 });
      ok(what + '：押すと読み直す', await waitFor(p, (k) => Number(sessionStorage.getItem('e2e.loads')) > k, n0));
      await p.waitForLoadState('load');
      return look(p);
    };

    const ctxU = await newCtx(); ctxs.push(ctxU);
    await ctxU.addInitScript(() => {
      window.MJ_BUSY_MS = 4000;
      window.MJ_NO_PART = localStorage.getItem('e2e.nopart') === '1';   // u12・u6・u8b＝画面が mj-part を作らない
      // 帯の移り変わりを全部残す（B:＝取り込み中の札）＝一瞬だけ出た「取り込めませんでした」も見る
      window.__bt = []; let last = '';
      const rec = () => { const b = document.querySelector('.mj-swband'); const s = b && !b.hidden ? (b.classList.contains('is-busy') ? 'B:' : '') + b.textContent : ''; if (s !== last) { last = s; window.__bt.push(s); } };
      new MutationObserver(rec).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const u = await ctxU.newPage();
    const eu = errsOf(u);
    await u.goto(base + 'index.html');
    ok('u 初めの画面に controller', await ctlReady(u));
    ok('u 控えに完了印', await doneReady(u, V3));
    await u.reload();

    // u1 X の中身違いが続く（200 で返す＝WebKit が自分で取り直さない・503 は WebKit が約250ms おきに3回ほど取り直して SW の回数に届かない＝11-27 測った）
    //    → 取り込み中の札 → 「取り込めませんでした」 → 置き場 mj-part に X の外が残る → 直った後に見えた時は X だけ取って帯 → 押せる
    st.badN[X] = 99;
    const V4 = bump(d);
    let a0 = snap();
    const s0 = swCount(); const t0u = Date.now(); const k0 = st.swT.length;
    await vis(u);
    ok('u1 取り込み中は右上の札', await busySeen(u));
    await failThenIdle(u, 'u1');
    const nx = (st.count[X] || 0) - a0[X];
    ok('u1 X は1回の取り込みで3回取りに来た（取り直し）', nx >= 3 && nx % 3 === 0, String(nx));
    // u1b 1回見えると、見えた時の update と版の照らしの update が重なる＝1本ずつ（v1.3.1 §3・並べると /sw.js を2回取る）
    // 画面の update() の取りは cache-control: max-age=0。付いていない取りは WebKit 自身の soft update（約300ms 後・画面の外）＝WebKit はそれで install をもう1本、前の install の後ろに並べる事がある（X 6＝並ばず続き・11-27 測った）
    const mine1 = st.swT.slice(k0).filter((x) => x[2] === 'max-age=0').length;
    ok('u1b 1回見えた時の update は1本（画面の /sw.js の取りは1回・install は並ばない）', mine1 === 1 && nx % 3 === 0 && nx <= 6, String(mine1) + ' x' + nx + ' ' + JSON.stringify(st.swT.slice(Math.max(0, k0 - 2)).map(([t, a, b]) => [t - t0u, a, b])));
    let P = await part(u, V4);
    ok('u1 置き場 mj-part に X の外が全部残る', !!P['mj-part'] && P['mj-part'].mine === AS.length - 1, JSON.stringify(P));
    st.badN[X] = 0;
    a0 = snap();
    await vis(u);
    ok('u1 直った後に見えた時に取り込み直して帯「新しい版があります」', await bandHas(u, NEWV));
    const dl = delta(a0);
    ok('u1 2回目は X だけ取る（置き場の続きから）', dl.length === 1 && dl[0].startsWith(X + '+'), dl.join(','));
    P = await part(u, V4);
    ok('u1 写した後 mj-part は残り、今の版の物は0', !!P['mj-part'] && P['mj-part'].mine === 0, JSON.stringify(P));
    L = await tapReload(u, 'u1');
    ok('u1 読み直した画面は新しい版', L.ver === V4, L.ver + ' / ' + V4);

    // u3 X が 503 のまま → 「取り込めませんでした」・待っている版は無い・前の版で動く
    st.failN[X] = 99;
    const V5 = bump(d);
    a0 = snap();
    await vis(u);
    await failThenIdle(u, 'u3');
    L = await look(u);
    ok('u3 前の版のまま', L.ver === V4, L.ver);
    ok('u3 X は3回より多く取りに来た', (st.count[X] || 0) - a0[X] >= 3, String((st.count[X] || 0) - a0[X]));
    st.failN[X] = 0;

    // u2 X が1回 503・Y が1回中身違い → 取り直して帯だけ・「取り込めませんでした」は1回も出ない（開き直した画面）
    st.failN[X] = 1; st.badN[Y] = 1;
    const V6 = bump(d);
    a0 = snap();
    await u.reload();
    ok('u2 一時の落ちは取り直して帯「新しい版があります」', await bandHas(u, NEWV));
    let B = await bt(u);
    ok('u2 「取り込めませんでした」は1回も出ない', !B.some((s) => s.includes(FAIL)), B.join(' | '));
    ok('u2 中身違いの Y は取り直した', (st.count[Y] || 0) - a0[Y] >= 2 && !st.badN[Y], JSON.stringify(delta(a0)));

    // u4 V6 が待っている間に次の版 V7 が落ち続ける → 札も失敗も出さず帯のまま → 押すと V6
    await u.evaluate(() => { window.__bt = []; });
    st.failN[X] = 99;
    const V7 = bump(d);
    a0 = snap();
    await vis(u);
    ok('u4 次の版の取り込みが X を3回取りに来る', await until(() => (st.count[X] || 0) - a0[X] >= 3));
    await idle(u);
    await u.waitForTimeout(300);
    B = await bt(u);
    L = await look(u);
    ok('u4 待っている版が在る間は札も「取り込めませんでした」も出ない', !B.some((s) => s.startsWith('B:') || s.includes(FAIL)), B.join(' | '));
    ok('u4 帯「新しい版があります」は残る', L.band.includes(NEWV), L.band);
    st.stall.add(X);                    // u5 用＝押した後の読み直しで始まる V7 の取り込みを X で止める
    L = await tapReload(u, 'u4');
    ok('u4 押すと待っていた版', L.ver === V6, L.ver + ' / ' + V6 + ' (V7 ' + V7 + ')');

    // u5 取りが止まったまま → 新しく開いた画面にも札・ボタン・入力・鍵盤に重ならない・押せない → MJ_BUSY_MS で「取り込めませんでした」
    for (const pg of ['index.html', 'taikyoku.html']) {
      const q = await ctxU.newPage();
      const eq = errsOf(q);
      await q.goto(base + pg);
      const seen5 = await busySeen(q);
      ok('u5 ' + pg + ' 取り込み中の札', seen5, seen5 ? '' : JSON.stringify({ st: await q.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return [r.installing && r.installing.state, !!r.active, r.active === r.installing, !!navigator.serviceWorker.controller]; }), reg: await regOf(q), x: st.count[X] - a0[X], sw: swCount(), held: st.held.length, bt: await bt(q), L: await look(q) }));
      if (!seen5) { await q.close(); continue; }
      const H = await q.evaluate(() => {
        const b = document.querySelector('.mj-swband');
        const r = b.getBoundingClientRect();
        const over = [...document.querySelectorAll('button,input,select,textarea,a,[role="button"],.kp')]
          .filter((e) => !b.contains(e))
          .filter((e) => { const s = e.getBoundingClientRect(); return s.width > 0 && s.height > 0 && s.left < r.right && r.left < s.right && s.top < r.bottom && r.top < s.bottom; })
          .map((e) => e.tagName + '.' + e.className + '#' + e.id);
        return { pe: getComputedStyle(b).pointerEvents, over, top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      ok('u5 ' + pg + ' 札は押せない（指は下へ通す）', H.pe === 'none', H.pe);
      ok('u5 ' + pg + ' 札はボタン・入力・鍵盤に重ならない', H.over.length === 0, H.over.join(',') + ' ' + JSON.stringify([H.top, H.bottom]));
      ok('u5 ' + pg + ' 止まったままなら MJ_BUSY_MS で「取り込めませんでした」', await bandHas(q, FAIL));
      ok('u5 ' + pg + ' 失敗の帯は押せる', !(await isBusyNow(q)));
      ok('u5 ' + pg + ' 画面の err 0', eq.length === 0, eq.join(' / '));
      await q.close();
    }
    // 止めを解く→V7 を取り込んで入れ替える（後の節を V7 から始める）
    st.failN[X] = 0; st.release();
    await idle(u, 90000);
    if (!(await regOf(u)).wait) { await vis(u); await waitFor(u, async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r && !!r.waiting; }, null, 60000); }
    await u.reload();
    ok('u5 止めを解いた後 V7 が取り込めて帯', await bandHas(u, NEWV));
    L = await tapReload(u, 'u5');
    ok('u5 入れ替えて V7', L.ver === V7, L.ver + ' / ' + V7);

    // u9 置き場の掃除：他の版の物（偽の /v/ffffffffffff/x と落ちた V5 の残り）は install の始めに消える・写した後は今の版の物も0
    await u.evaluate(async () => { await (await caches.open('mj-part')).put('/v/ffffffffffff/x', new Response('古')); });
    const V8 = bump(d);
    await vis(u);
    ok('u9 版上げで帯', await bandHas(u, NEWV));
    P = await part(u, V8);
    ok('u9 置き場から他の版の物が消える', !!P['mj-part'] && P['mj-part'].other === 0 && !!P['mj-conf'] && P['mj-conf'].other === 0, JSON.stringify(P));
    ok('u9 写した後 置き場の今の版の物は0・mj-conf は supa-config だけ', P['mj-part'].mine === 0 && P['mj-conf'].all === 1 && P['mj-conf'].conf, JSON.stringify(P));
    L = await tapReload(u, 'u9');
    ok('u9 入れ替えて V8', L.ver === V8, L.ver + ' / ' + V8);

    // u7a 1回の取りの締め切り（MJ_FETCH_MS）だけ：X の1回目は返事が無い → 切って取り直す → 通る
    knobs(d, { MJ_FETCH_MS: 2000, MJ_INSTALL_MS: 60000 });
    st.stallOnce.add(X);
    const V9 = bump(d);
    a0 = snap();
    const t7 = Date.now();
    await vis(u);
    ok('u7a 返事の無い取りを切って取り直し、帯', await bandHas(u, NEWV));
    const n7 = (st.count[X] || 0) - a0[X];
    ok('u7a X は2回（切った1回＋取り直し）・20秒より早い', n7 === 2 && Date.now() - t7 < 20000, JSON.stringify([n7, Date.now() - t7]));
    L = await tapReload(u, 'u7a');
    ok('u7a 入れ替えて V9', L.ver === V9, L.ver + ' / ' + V9);

    // u7b install の締め切り（MJ_INSTALL_MS 8秒）：X が返らない → 締め切りで install が終わる → 次の install は通る →
    //     持ったままの古い取りが遅れて中身違いで返っても、次の install の出来上がった控えは消えない（v1.3.1 §2）
    knobs(d, { MJ_FETCH_MS: 60000, MJ_INSTALL_MS: 8000 });
    st.stall.add(X);
    const V10 = bump(d);
    const T7 = [Date.now()];
    await vis(u);
    ok('u7b 取り込みが始まる', await waitFor(u, async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r && !!r.installing; }, null, 10000));
    const t8 = Date.now();
    // WebKit は締め切りの前でも getRegistration の installing が空に見える事がある（11-27 測った＝4秒で idle・page の reg はまだ installing）＝締め切り（8秒）を過ぎてから見る
    await until(() => Date.now() - T7[0] > 9000, 12000);
    ok('u7b 締め切りで install が終わる（15秒以内）', await idle(u, 15000), String(Date.now() - t8));
    ok('u7b 締め切りの後 待っている版は無い', !(await regOf(u)).wait);
    ok('u7b 「取り込めませんでした」', await bandHas(u, FAIL));
    st.stall.delete(X);                 // 持っている古い取り（held）は返さないまま
    T7.push(Date.now());
    const a7 = snap(); const s7 = swCount();
    await vis(u);
    const ok7 = await bandHas(u, NEWV);
    ok('u7b 締め切りの後の install は通って帯', ok7, ok7 ? '' : JSON.stringify({ reg: await regOf(u), d: delta(a7), sw: swCount() - s7, held: st.held.length, bt: await bt(u), T7: T7.map((t) => t - T7[0]), log: st.log.slice(-15) }));
    ok('u7b その控えに完了印', await isDoneNow(u, V10));
    st.badN[X] = 99; st.releaseBad();   // 古い取りに中身違い（200）で返す
    await u.waitForTimeout(5000);
    ok('u7b 古い取りが遅れて中身違いで返っても mj-' + V10 + ' の完了印は残る', await isDoneNow(u, V10));
    st.badN[X] = 0;
    L = await tapReload(u, 'u7b');
    ok('u7b 入れ替えて V10', L.ver === V10, L.ver + ' / ' + V10);
    knobs(d, {});

    // u12 今の客（mj-part が無く mj-conf だけ）：mj-conf に続ける・写した後 mj-conf は supa-config だけ／u8b activate が mj-part を作る
    await noPart(u, true); await u.reload(); await dropCache(u, 'mj-part');
    P = await part(u, V10);
    ok('u12 置き場は mj-conf だけ', P['mj-part'] === null && !!P['mj-conf'] && P['mj-conf'].conf, JSON.stringify(P));
    st.badN[X] = 99;
    const V11 = bump(d);
    await vis(u);
    await failThenIdle(u, 'u12');
    P = await part(u, V11);
    ok('u12 install は mj-part を作らない・mj-conf に X の外が残る', P['mj-part'] === null && !!P['mj-conf'] && P['mj-conf'].mine === AS.length - 1, JSON.stringify(P));
    st.badN[X] = 0;
    a0 = snap();
    await vis(u);
    ok('u12 直った後に帯', await bandHas(u, NEWV));
    const dl12 = delta(a0);
    ok('u12 2回目は X だけ取る（mj-conf の続きから）', dl12.length === 1 && dl12[0].startsWith(X + '+'), dl12.join(','));
    P = await part(u, V11);
    ok('u12 写した後 mj-conf は supa-config だけ', !!P['mj-conf'] && P['mj-conf'].all === 1 && P['mj-conf'].conf, JSON.stringify(P));
    ok('u8b 入れ替える前は mj-part が無い', P['mj-part'] === null, JSON.stringify(P));
    L = await tapReload(u, 'u12');
    ok('u12 入れ替えて V11', L.ver === V11, L.ver + ' / ' + V11);
    P = await part(u, V11);
    ok('u8b activate が mj-part を作る（画面は MJ_NO_PART で作らない）', P['mj-part'] !== null, JSON.stringify(P));

    // u6 置き場が無い（mj-part も mj-conf も無い）：使い捨てで取り込める・続けない・install は mj-part を作らない
    await dropCache(u, 'mj-part', 'mj-conf');
    st.badN[X] = 99;
    const V12 = bump(d);
    await vis(u);
    await failThenIdle(u, 'u6');
    P = await part(u, V12);
    ok('u6 落ちた install は mj-part を作らない', P['mj-part'] === null, JSON.stringify(P));
    st.badN[X] = 0;
    a0 = snap();
    await vis(u);
    ok('u6 置き場が無くても（使い捨て）取り込めて帯', await bandHas(u, NEWV));
    const dl6 = delta(a0);
    ok('u6 使い捨ては続けない（全部取り直す）', dl6.length === AS.length, dl6.length + ' / ' + AS.length);
    L = await tapReload(u, 'u6');
    ok('u6 入れ替えて V12', L.ver === V12, L.ver + ' / ' + V12);

    // u8a 画面が mj-part を作る（MJ_NO_PART を外して開く）
    await noPart(u, false); await dropCache(u, 'mj-part'); await u.reload();
    ok('u8a 画面を開くと mj-part が出来る', await waitFor(u, async () => caches.has('mj-part'), null, 5000));
    st.release();
    ok('u 画面の err 0', eu.length === 0, eu.join(' / '));
  } catch (e) {
    if (e !== STOP) bad.push('落ちた：' + (e && e.message ? e.message.split('\n')[0] : String(e)));
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
    st.release(); srv.closeAllConnections?.(); srv.close();
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
  // u（swupd v1.1）
  ['取った物を飛ばさない（続きから取れない）', 'sw.js', rep('if (!have || have.headers.get(SHA_H) !== want) todo.push', 'todo.push')],
  ['取り直さない（1回だけ）', 'sw.js', rep('const TRIES = self.MJ_TRIES || [0, 500, 1500];', 'const TRIES = [0];')],
  ['取り込み中の札を出さない', 'js/sw-reg.js', rep('    maybeBusy(reg, w);\n', '')],
  ['「取り込めませんでした」を出さない', 'js/sw-reg.js', rep("show('新しい版を取り込めませんでした（次に開いた時にもう一度）', '閉じる', hide);", '')],
  ['札の is-busy を外さない（帯が押せないまま）', 'js/sw-reg.js', rep("band.classList.toggle('is-busy', !!busy);", "if (busy) band.classList.add('is-busy');")],
  // u（swupd v1.3.1）
  ['activate が mj-part を作らない', 'sw.js', rep('    await caches.open(PART);           // 次の版', '    // 次の版')],
  ['install が mj-part を作る', 'sw.js', rep('  if (await caches.has(PART)) return PART;', '  await caches.open(PART); return PART;')],
  ['他の版を置き場から消さない', 'sw.js', rep('    await cleanOther(PART);\n    await cleanOther(CONF);\n', '')],
  ['1回の取りの締め切りが無い', 'sw.js', rep('const t = setTimeout(cut, FETCH_MS);', 'const t = 0;')],
  ['install の締め切りが無い', 'sw.js', rep("timer = setTimeout(() => { ac.abort(); ng(new Error('install の締め切り')); }, INSTALL_MS);", 'timer = null;')],
  ['mj-conf に続けない', 'sw.js', rep('  if (await caches.has(CONF)) return CONF;\n', '')],
  // u（11-27 e2e で見つけた sw-reg の直し）。e2e で赤にできない壊し＝画面の mj-part（activate も作る）・v1.1 の古い取り込み（WebKit は落ちた worker を止める）・update を並べる（WebKit の job の列が並べる）は単体の試験（sw-reg.test h・g／sw.test）で見る・待っている版が在る時の札の守り（WebKit の u4 では取り込みの知らせが画面に届かず、両方外しても緑＝11-27 測った・帯が出れば札はすぐ消える）
  ['register だけ待つ（開いた時もう取り込み中なら札が出ない）', 'js/sw-reg.js', rep("  try { sw.getRegistration('/').then(start, function () {}); } catch (_) {}\n", '')],
  ['使い捨てを消さない（死んだ控えに続ける）', 'sw.js', rep('    await caches.delete(FB);', '    //')],
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
      // 手元で1つだけ見る時＝SW_BREAK=<名の一部>（CI は付けない＝全部）
      // CI は SW_SHARD=k/n で壊しを n 組に割って並べて回す（21か所を1本で回すと test job の20分に当たった＝CI 45947921947）。k 組目＝i % n === k-1
      const sh = /^(\d+)\/(\d+)$/.exec(process.env.SW_SHARD || '');
      if (process.env.SW_SHARD && !(sh && +sh[1] >= 1 && +sh[1] <= +sh[2])) { process.exitCode = 1; throw new Error('SW_SHARD の形が違う：' + process.env.SW_SHARD); }
      const all = sh ? BREAKS.filter((_, i) => i % +sh[2] === +sh[1] - 1) : BREAKS;
      const only = process.env.SW_BREAK ? all.filter(([nm]) => nm.includes(process.env.SW_BREAK)) : all;
      for (const [name, file, fn] of only) {
        try {
          const r = await runFresh(() => { const d = copyRoot(); fs.writeFileSync(path.join(d, file), fn(rd(d, file))); rewrite(d); return d; });
          // webkit の落ちだけの赤は「壊しが効いた」と数えない（偽の n/n を出さない）
          if (r.bad.length && r.bad.every(isWk)) console.log(`  ✗ 不定（webkit の落ちだけ）：${name}`);
          else if (r.bad.length) red++; else console.log(`  ✗ 壊しても緑のまま：${name}`);
        } catch (e) { console.log(`  ✗ 壊しが作れない：${name} — ${e.message}`); }
      }
      console.log(`自己確認: ${red}/${only.length}`);
      process.exitCode = red === only.length && only.length > 0 ? 0 : 1;
    }
  }
} finally {
  await shut();
  // webkit の子が残ると node が抜けない（11-21 手元で 8/8 を出した後 77分止まった）＝終わり値を持って抜ける
  process.exit(process.exitCode ?? 0);
}
