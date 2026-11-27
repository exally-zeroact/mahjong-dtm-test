/* sw.test.mjs — 件3 PWA（sw.js・js/sw-reg.js・名簿と版）の試験（設計 tataki/sw_sekkei_v1.md v3.3）
 * 1  名簿＝html・import・manifest をたどって引き直した物と sw.js の名簿（道と sha）が同じ
 * 1b 名簿の js に import( ・importScripts・後から script を作る道、css に url( ・@import が無い
 * 1d supa-config.js は名簿に入らない
 * 2  引き直した VER＝sw.js の VER＝version.json の ver
 * 3  根の html 全部に <script src="/js/sw-reg.js" defer>（/ 始まり）
 * S  sw.js の字：ignoreSearch 無し・install に skipWaiting 無し・/r/ の字が gamen-core の tokenFromPath と同じ・sw-reg が /sw.js を / 始まりで登録
 * 4  node の真似の台（caches・fetch・clients を小さく真似て sw.js を読む）で動きを見る：
 *    q 控えの html は script src と stylesheet href の名簿の道だけ /v/<VER>/・a href・manifest・apple-touch-icon・supa-config は替わらない・meta mj-ver
 *    b ?room=・/r/<token>・/r/<token>/・/ が控えの画面　c 5xx も名簿の外の答えも控えに入らない・404 はそのまま
 *    d install で skipWaiting しない・SKIP_WAITING でだけする　e 名簿の外の画面で3秒越え／すぐ落ちた時は控えの /index.html
 *    s activate で今と「1つ前」だけ残る・mj-conf と mj-tmp は残る　g install で中身が違う／5xx の時は控えが残らず仮は残る・直った後は残りだけ取る（swupd v1.1）
 *    g2 一時の 5xx・中身違いは取り直して通る　g3 取りは並ぶ（同時に2本以上）
 *    h GET 以外・他の origin・/version.json は素通し　i 完了印の在る控えは取り直さない
 *    j 印の無い控えは使わない（画面はネットの素の html・裏で取り直して印が付く）　t 取り直しは重なっても1本
 *    k 取り直しが落ちたら印は付かない・すぐには走り直さない・他の版の仮（取り込み中の物）を消さない　r /v/<古い版>/ は古い控えから・控えに無ければ素の道を取る
 *    l supa-config＝初めてはネットの答え・遅い／5xx は mj-conf・ok なら入れ直す　p 素の道はネットが先・落ちた時だけ控え
 * --self-test＝上の決まりをわざと壊した sw.js・sw-reg.js・html の写しを食わせて、壊しごとに赤になるか（CI 床＝壊しの数）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, collect, lateLoads, computeAll, readSw, writeSw, binarySet, served } from '../scripts/sw-assets.mjs';

const ORIGIN = 'https://m.test';
const BIN = binarySet(ROOT);
const CT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 真似の台 ───────────────────────────────────────────── */
class FakeCache {
  constructor() { this.m = new Map(); }
  key(r) { return typeof r === 'string' ? new URL(r, ORIGIN).href : r.url; }
  async put(r, res) { const buf = await res.arrayBuffer(); this.m.set(this.key(r), { buf, status: res.status, headers: [...res.headers] }); }
  async match(r, opt) {
    let k = this.key(r);
    if (opt && opt.ignoreSearch) { const u = new URL(k); u.search = ''; for (const kk of this.m.keys()) { const v = new URL(kk); v.search = ''; if (v.href === u.href) { k = kk; break; } } }
    const v = this.m.get(k);
    return v ? new Response(v.buf.slice(0), { status: v.status, headers: v.headers }) : undefined;
  }
  async keys() { return [...this.m.keys()].map((url) => ({ url })); }  // 本物と同じく Request の形（.url）で返す
  async delete(r) { return this.m.delete(this.key(r)); }
}
class FakeCaches {
  constructor() { this.c = new Map(); }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new FakeCache()); return this.c.get(n); }
  async has(n) { return this.c.has(n); }
  async delete(n) { return this.c.delete(n); }
  async keys() { return [...this.c.keys()]; }
}

function serverFrom(root) {
  const files = new Map();
  const add = (p) => files.set(p, { buf: served(root, p, BIN), status: 200, ct: CT[path.extname(p)] || 'application/octet-stream' });
  for (const f of fs.readdirSync(root)) if (f.endsWith('.html') || f === 'manifest.json' || f === 'version.json') add('/' + f);
  for (const d of ['css', 'js', 'lib', 'vendor', 'icons']) for (const f of fs.readdirSync(path.join(root, d))) add('/' + d + '/' + f);
  return files;
}

function makeEnv(swText, opt = {}) {
  const caches = new FakeCaches();
  const files = opt.files || serverFrom(ROOT);
  const log = [];
  const net = { delay: {}, hold: {}, fail: new Set(), status: {}, body: {}, statusN: {}, bodyN: {}, live: 0, peak: 0 };
  const fetchFn = async (req) => {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
    log.push({ url: url.href, path: url.pathname, cache: req.cache });
    net.live++; net.peak = Math.max(net.peak, net.live);
    try {
    const sig = typeof req === 'string' ? null : req.signal;
    const wait = (ms) => new Promise((ok, ng) => { const t = setTimeout(ok, ms); if (sig) sig.addEventListener('abort', () => { clearTimeout(t); ng(new DOMException('aborted', 'AbortError')); }); });
    const h = net.hold[url.pathname]; if (h) { delete net.hold[url.pathname]; await wait(h); }
    const d = net.delay[url.pathname]; if (d) await wait(d);
    if (sig && sig.aborted) throw new DOMException('aborted', 'AbortError');
    if (net.statusN[url.pathname] > 0) { net.statusN[url.pathname]--; return new Response('一時', { status: 503 }); }
    if (net.bodyN[url.pathname] > 0) { net.bodyN[url.pathname]--; return new Response('違う中身', { status: 200 }); }
    if (net.fail.has(url.pathname) || net.fail.has('*')) throw new TypeError('ネットが無い');
    if (url.origin !== ORIGIN) return new Response('外', { status: 200 });
    const f = files.get(url.pathname);
    const st = net.status[url.pathname] || (f ? 200 : 404);
    const body = net.body[url.pathname] !== undefined ? net.body[url.pathname] : (f ? f.buf : 'Not Found');
    return new Response(st === 204 ? null : body, { status: st, headers: { 'Content-Type': f ? f.ct : 'text/plain' } });
    } finally { net.live--; }
  };
  const listeners = {};
  let skipped = 0, claimed = 0;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => { skipped++; return Promise.resolve(); },
    clients: { claim: async () => { claimed++; } },
    MJ_WAIT_MS: 60, MJ_RETRY_MS: opt.retry || 10000, MJ_TRIES: [0, 1, 1],
  };
  if (opt.installMs) self.MJ_INSTALL_MS = opt.installMs;
  if (opt.fetchMs) self.MJ_FETCH_MS = opt.fetchMs;
  const ctx = { self, caches, fetch: fetchFn, Request, Response, Headers, URL, TextDecoder, crypto: globalThis.crypto, setTimeout, clearTimeout, console, Date, Promise, Uint8Array, AbortController, CustomEvent: undefined, DOMException };
  vm.runInNewContext(swText, ctx, { filename: 'sw.js' });
  const bg = [];
  const env = {
    caches, files, log, net, bg,
    get skipped() { return skipped; }, get claimed() { return claimed; },
    async install() { const ps = []; listeners.install({ waitUntil: (p) => ps.push(p) }); try { await Promise.all(ps); return true; } catch (_) { return false; } },
    async activate() { const ps = []; listeners.activate({ waitUntil: (p) => ps.push(p) }); await Promise.all(ps); },
    message(data) { listeners.message({ data }); },
    /** 取り。返り＝Response か null（素通し） */
    async get(p, o = {}) {
      const request = { url: new URL(p, o.origin || ORIGIN).href, method: o.method || 'GET', mode: o.mode || 'no-cors', cache: 'default' };
      let resp = null;
      listeners.fetch({ request, respondWith: (x) => { resp = x; }, waitUntil: (x) => bg.push(Promise.resolve(x).catch(() => {})) });
      return resp ? await resp : null;
    },
    nav(p) { return env.get(p, { mode: 'navigate' }); },
    async settle() { while (bg.length) await bg.shift(); },
  };
  return env;
}

const isDoneIn = async (e, ver) => (await e.caches.has('mj-' + ver)) && !!(await (await e.caches.open('mj-' + ver)).match(ORIGIN + '/__mj_done'));

/* ── 試験の本体（壊しの写しでも同じ物を回す） ─────────────── */
async function run(t) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) p++; else { f++; if (!t.quiet) console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  const root = t.root || ROOT;
  const swText = t.sw;
  const { ver, assets, problems } = computeAll(root, swText, BIN);
  const cur = readSw(swText);
  const list = assets.map((a) => a[0]);

  ok('1 名簿をたどって問題0', problems.length === 0, problems.join(' / '));
  ok('1 名簿（道と sha）が sw.js と同じ', JSON.stringify(cur.assets) === JSON.stringify(assets), `引き直し ${assets.length} 本・sw.js ${cur.assets.length} 本`);
  const late = lateLoads(root, list);
  ok('1b 後から読む道 0', late.length === 0, late.join(' / '));
  ok('1d supa-config.js は名簿の外', !list.includes('/js/supa-config.js') && !cur.assets.some((a) => a[0] === '/js/supa-config.js'));
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).ver;
  ok('2 VER＝sw.js＝version.json', cur.ver === ver && vj === ver, `引き直し ${ver}・sw.js ${cur.ver}・version.json ${vj}`);
  for (const h of fs.readdirSync(root).filter((x) => x.endsWith('.html'))) {
    const tx = fs.readFileSync(path.join(root, h), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    ok('3 ' + h + ' に <script src="/js/sw-reg.js" defer>', /<script src="\/js\/sw-reg\.js" defer><\/script>/.test(tx));
  }
  ok('S ignoreSearch を使わない', !/ignoreSearch/.test(swText));
  const inst = swText.slice(swText.indexOf("addEventListener('install'"), swText.indexOf("addEventListener('activate'"));
  ok('S install に skipWaiting が無い', inst.length > 0 && !/skipWaiting/.test(inst));
  const core = fs.readFileSync(path.join(root, 'js/gamen-core.mjs'), 'utf8').match(/tokenFromPath[\s\S]*?(\/\^\\\/r\\\/[^\n]*?\$\/)/);
  const mine = swText.match(/const TOKEN_RE = (\/[^\n]*?\$\/);/);
  ok('S /r/ の字が tokenFromPath と同じ', core && mine && core[1] === mine[1], `${core && core[1]} / ${mine && mine[1]}`);
  const reg = fs.readFileSync(path.join(root, 'js/sw-reg.js'), 'utf8');
  ok('S sw-reg は /sw.js を scope / で登録', /register\('\/sw\.js', \{ scope: '\/' \}\)/.test(reg));
  ok('S sw-reg は load で mj.swap を消す・初めての claim を無視する形', /removeItem\('mj\.swap'\)/.test(reg) && /!hadCtl && changes === 1 && !swapping/.test(reg));
  ok('S sw-reg の installed の帯は前の版が動いている時だけ（初めての取り込みで偽の帯を出さない）', /w\.state === 'installed' && reg\.active && reg\.active !== w && sw\.controller/.test(reg));

  // 動き（真似の台）。名簿が空の写し（壊しで名簿が合わない時）でも回す。
  const V = cur.ver;
  const vp = (q) => '/v/' + V + q;
  const text = async (r) => (r ? await r.text() : '');
  const files = t.files || serverFrom(root);
  {
    const e = makeEnv(swText, { files });
    ok('d install（名簿が全部そろう）', await e.install());
    ok('d install で skipWaiting しない', e.skipped === 0);
    const c = await e.caches.open('mj-' + V);
    ok('q 控えに名簿の全部と完了印', (await Promise.all(cur.assets.map(async ([q]) => !!(await c.match(ORIGIN + vp(q)))))).every(Boolean) && !!(await c.match(ORIGIN + '/__mj_done')));
    let qBad = [];
    for (const [q] of cur.assets.filter((a) => a[0].endsWith('.html'))) {
      const h = await text(await c.match(ORIGIN + vp(q)));
      if (!h.includes('<meta name="mj-ver" content="' + V + '">')) qBad.push(q + ' meta 無し');
      for (const m of h.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link|a)\b[^>]*>/gi)) {
        const tag = m[0];
        const at = (tag.match(/\s(?:src|href)\s*=\s*"([^"]*)"/) || [])[1];
        if (!at) continue;
        const isV = at.startsWith('/v/' + V + '/');
        const plain = isV ? at.slice(('/v/' + V).length) : decodeURIComponent(new URL(at, 'https://x' + q).pathname);
        const should = (/^<script/i.test(tag) || /\srel="stylesheet"/i.test(tag)) && cur.assets.some((a) => a[0] === plain) && !/[?#]/.test(at);
        if (should !== isV) qBad.push(`${q}: ${tag}`);
      }
    }
    ok('q 書き換えは script src と stylesheet href の名簿の道だけ（a・manifest・icon・supa-config は替わらない）', qBad.length === 0 && cur.assets.length > 0, qBad.slice(0, 3).join(' / '));
    const tk = await e.caches.open('mj-' + V);
    const ty = await text(await tk.match(ORIGIN + vp('/taikyoku.html')));
    ok('q taikyoku の manifest・apple-touch-icon・/index.html の a は素の道', /href="\/manifest\.json"/.test(ty) && /href="\/icons\/apple-touch-icon\.png"/.test(ty) && /src="\/js\/supa-config\.js"/.test(ty));
    const ctm = await tk.match(ORIGIN + vp('/js/gamen-taikyoku.mjs'));
    ok('q Content-Type を引き継ぐ（module の MIME）', ctm && /javascript/.test(ctm.headers.get('Content-Type') || ''));

    for (const n of ['/taikyoku.html?room=abc', '/r/' + '0123456789abcdef'.repeat(2), '/r/' + '0123456789abcdef'.repeat(2) + '/']) {
      const r = await e.nav(n);
      ok('b ' + n + ' は控えの taikyoku', (await text(r)).includes('content="' + V + '"') && (await text(await e.nav(n))).includes('gamen-taikyoku'));
    }
    ok('b / は控えの index', (await text(await e.nav('/'))).includes('gamen-home'));
    ok('b /r/ の字が違う（31字）なら名簿の外の画面（ネットの 404）', (await e.nav('/r/' + 'a'.repeat(31))).status === 404);

    e.log.length = 0;
    const a1 = await e.get(vp('/lib/score.mjs'));
    ok('r /v/<今の版>/ は控えから（ネットに行かない）', a1 && a1.status === 200 && e.log.length === 0);

    e.net.status['/nope.html'] = 503;
    const r5 = await e.nav('/nope.html');
    ok('c 名簿の外の 5xx はそのまま返し控えに入らない', r5.status === 503 && !(await (await e.caches.open('mj-' + V)).match(ORIGIN + '/nope.html')) && !(await (await e.caches.open('mj-' + V)).match(ORIGIN + vp('/nope.html'))));
    ok('c 名簿の外の 404 はそのまま', (await e.nav('/zzz')).status === 404);

    e.net.delay['/slow.html'] = 400;
    const t0 = Date.now(); const rs = await e.nav('/slow.html');
    ok('e 名簿の外の画面で3秒越えは控えの /index.html', (await text(rs)).includes('gamen-home') && Date.now() - t0 < 300);
    e.net.fail.add('/down.html');
    ok('e すぐ落ちた時も控えの /index.html', (await text(await e.nav('/down.html'))).includes('gamen-home'));

    ok('h GET 以外は素通し', (await e.get('/index.html', { method: 'POST' })) === null);
    ok('h 他の origin は素通し', (await e.get('https://x.supabase.co/rest/v1/a', { origin: 'https://x.supabase.co' })) === null);
    ok('h /version.json は素通し', (await e.get('/version.json?t=1')) === null);

    e.message({ type: 'SKIP_WAITING' });
    ok('d SKIP_WAITING でだけ skipWaiting', e.skipped === 1);

    // p 素の道＝ネットが先・落ちた時だけ控え
    e.log.length = 0;
    e.net.body['/manifest.json'] = '{"net":1}';
    ok('p 素の道はネットが先', (await text(await e.get('/manifest.json'))) === '{"net":1}' && e.log.length === 1);
    e.net.fail.add('/manifest.json');
    ok('p ネットが落ちた時だけ今の版の控え', (await text(await e.get('/manifest.json'))).includes('"start_url"'));

    // i 完了印の在る控えは取り直さない
    e.log.length = 0;
    ok('i 2回目の install は取らない', (await e.install()) && e.log.length === 0);

    // r 古い版の控えから・無ければ素の道
    const old = await e.caches.open('mj-aaaaaaaaaaaa');
    await old.put(ORIGIN + '/v/aaaaaaaaaaaa/lib/score.mjs', new Response('// 古い版'));
    ok('r 印の無い古い控えは使わない', !(await text(await e.get('/v/aaaaaaaaaaaa/lib/score.mjs'))).includes('古い版'));
    await old.put(ORIGIN + '/__mj_done', new Response(JSON.stringify({ ver: 'aaaaaaaaaaaa', at: 1 })));
    ok('r /v/<古い版>/ は古い控えから', (await text(await e.get('/v/aaaaaaaaaaaa/lib/score.mjs'))) === '// 古い版');
    e.log.length = 0;
    await e.get('/v/aaaaaaaaaaaa/lib/tiles.mjs');
    ok('r 控えに無ければ素の道を cache reload で取る（/v/ のままネットへ行かない）', e.log.length === 1 && e.log[0].path === '/lib/tiles.mjs' && e.log[0].cache === 'reload', JSON.stringify(e.log));

    // s activate
    const mk = async (n, at) => { const x = await e.caches.open(n); if (at) await x.put(ORIGIN + '/__mj_done', new Response(JSON.stringify({ at }))); };
    await mk('mj-bbbbbbbbbbbb', 5); await mk('mj-cccccccccccc', 0); await mk('mj-conf'); await mk('mj-tmp-dddddddddddd-r1');
    // cccc は印の無い控え（at 0 は印を置かない）
    await e.activate();
    const ks = (await e.caches.keys()).sort();
    ok('s activate で今と1つ前（一番新しく完了した bbbb）だけ・mj-conf と mj-tmp は残る・mj-part を作る', JSON.stringify(ks) === JSON.stringify(['mj-' + V, 'mj-bbbbbbbbbbbb', 'mj-conf', 'mj-part', 'mj-tmp-dddddddddddd-r1'].sort()), ks.join(','));
    ok('s activate で claim', e.claimed === 1);
  }
  {
    // g 中身が違う／5xx の install は落ちる・控え（mj-<VER>）は残らず仮は残る・直った後の install は落ちた1つだけ取る（swupd v1.1 §2）
    for (const [name, p, set] of [['中身が違う', '/lib/score.mjs', (e) => { e.net.body['/lib/score.mjs'] = 'x'; }], ['5xx', '/js/tensu.js', (e) => { e.net.status['/js/tensu.js'] = 500; }]]) {
      const e = makeEnv(swText, { files });
      await e.caches.open('mj-part');   // 画面の sw-reg.js が作った置き場
      set(e);
      const res = await e.install();
      const ks = await e.caches.keys();
      ok('g install（' + name + '）は落ち、控えは残らない', res === false && !(await isDoneIn(e, V)), ks.join(','));
      const kept = (await (await e.caches.open('mj-part')).keys()).length;
      ok('g install（' + name + '）の置き場 mj-part に取れた ' + (list.length - 1) + ' 本が残る', kept === list.length - 1, ks.join(',') + ' ' + kept);
      delete e.net.body[p]; delete e.net.status[p];
      e.log.length = 0;
      const res2 = await e.install();
      const got = e.log.filter((x) => x.cache === 'reload').map((x) => x.path);
      ok('g 直った後の install（' + name + '）は通り、落ちた1つだけ取る', res2 === true && got.length === 1 && got[0] === p && await isDoneIn(e, V) && !(await e.caches.keys()).some((k) => k.startsWith('mj-tmp-')), JSON.stringify([res2, got]));
      const left = (await (await e.caches.open('mj-part')).keys()).filter((r) => r.url.includes('/v/')).length;
      ok('g 写した後 mj-part は残り、中の /v/ は0', (await e.caches.has('mj-part')) && left === 0, String(left));
    }
    // g4 mj-part が無く mj-conf が在る（今の客）＝mj-conf に続ける・写した後 mj-conf は supa-config だけ
    {
      const e = makeEnv(swText, { files });
      await (await e.caches.open('mj-conf')).put(ORIGIN + '/js/supa-config.js', new Response('window.SUPA={}'));
      e.net.body['/lib/score.mjs'] = 'x';
      ok('g4 mj-conf の時も落ちる', (await e.install()) === false);
      delete e.net.body['/lib/score.mjs'];
      e.log.length = 0;
      const res2 = await e.install();
      const got = e.log.filter((x) => x.cache === 'reload').map((x) => x.path);
      ok('g4 mj-conf に続けて落ちた1つだけ取る', res2 === true && got.length === 1 && await isDoneIn(e, V), JSON.stringify(got));
      const ck = (await (await e.caches.open('mj-conf')).keys()).map((r) => new URL(r.url).pathname);
      ok('g4 写した後 mj-conf は supa-config だけ', JSON.stringify(ck) === JSON.stringify(['/js/supa-config.js']), ck.join(','));
      ok('g4 install は mj-part を作らない', !(await e.caches.has('mj-part')));
    }
    // g5 置き場が無い（mj-part も mj-conf も無い）＝使い捨て・続きは無い（毎回消して全部取る）・install は mj-part を作らない
    {
      const e = makeEnv(swText, { files });
      e.net.body['/lib/score.mjs'] = 'x';
      ok('g5 使い捨ての時も落ちる', (await e.install()) === false);
      ok('g5 落ちた install は mj-part を作らない', !(await e.caches.has('mj-part')));
      delete e.net.body['/lib/score.mjs'];
      e.log.length = 0;
      const res2 = await e.install();
      const got = e.log.filter((x) => x.cache === 'reload').length;
      ok('g5 使い捨ては続けない（全部 ' + list.length + ' 本取り直す）', res2 === true && got === list.length && await isDoneIn(e, V), String(got));
      ok('g5 通った後 使い捨ては残らず mj-part も無い', !(await e.caches.keys()).some((k) => k.startsWith('mj-tmp-')) && !(await e.caches.has('mj-part')));
    }
    // g6 他の版の物を置き場から消す（mj-conf の supa-config は触らない）
    {
      const e = makeEnv(swText, { files });
      await (await e.caches.open('mj-part')).put(ORIGIN + '/v/ffffffffffff/x', new Response('古'));
      const cf = await e.caches.open('mj-conf');
      await cf.put(ORIGIN + '/js/supa-config.js', new Response('c')); await cf.put(ORIGIN + '/v/eeeeeeeeeeee/y', new Response('古'));
      await e.install();
      const pk = (await (await e.caches.open('mj-part')).keys()).length;
      const ck = (await (await e.caches.open('mj-conf')).keys()).map((r) => new URL(r.url).pathname);
      ok('g6 mj-part の他の版は消える', pk === 0, String(pk));
      ok('g6 mj-conf の他の版は消え supa-config は残る', JSON.stringify(ck) === JSON.stringify(['/js/supa-config.js']), ck.join(','));
    }
    // g7 1回の取りの締め切り（FETCH_MS）＝返事の無い取りは切って取り直す
    {
      const e = makeEnv(swText, { files, fetchMs: 40, installMs: 5000 });
      await e.caches.open('mj-part');
      e.net.hold['/lib/score.mjs'] = 3000;
      const t0 = Date.now();
      const res = await e.install();
      const n = e.log.filter((x) => x.path === '/lib/score.mjs').length;
      ok('g7 返事の無い取りを切って取り直し、install が通る（2回・早い）', res === true && n === 2 && Date.now() - t0 < 1500, JSON.stringify([res, n, Date.now() - t0]));
    }
    // g8 install の締め切り（INSTALL_MS）＝落ちて、取りの列も写しも止まる
    {
      const e = makeEnv(swText, { files, installMs: 60 });
      await e.caches.open('mj-part');
      for (const q of list) e.net.delay[q] = 30;
      const t0 = Date.now();
      const res = await e.install();
      const dt = Date.now() - t0;
      const n1 = e.log.length;
      await sleep(400);
      const n2 = e.log.length;
      const pk = (await (await e.caches.open('mj-part')).keys()).length;
      ok('g8 締め切りで install が落ちる（早い）', res === false && dt < 300, JSON.stringify([res, dt]));
      ok('g8 締め切りの後は次の取りをしない・写しも印もしない', n2 === n1 && n2 < list.length && !(await isDoneIn(e, V)) && pk < list.length, JSON.stringify([n1, n2, pk]));
    }
    // g9 締め切りで切れた古い取り込みが遅れて落ちても、次の install の出来上がった控えを消さない（v1.3.1 §2）
    {
      const e = makeEnv(swText, { files, installMs: 150, fetchMs: 60000 });
      await e.caches.open('mj-part');
      e.net.hold['/lib/score.mjs'] = 700;
      const t0 = Date.now();
      ok('g9 1回目は締め切りで落ちる', (await e.install()) === false);
      ok('g9 2回目は通る', (await e.install()) === true && await isDoneIn(e, V));
      e.net.body['/lib/score.mjs'] = 'x';
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
      ok('g9 古い取り込みが遅れて落ちても控えと印は残る', await isDoneIn(e, V));
      delete e.net.body['/lib/score.mjs'];
    }
    // g2 一時の 5xx・中身違い（1回ずつ）は取り直して通る
    {
      const e = makeEnv(swText, { files });
      e.net.statusN['/js/tensu.js'] = 1; e.net.bodyN['/lib/score.mjs'] = 1;
      ok('g2 一時の 5xx・中身違いは取り直して install が通る', (await e.install()) === true && await isDoneIn(e, V));
    }
    // g3 取りは並ぶ
    {
      const e = makeEnv(swText, { files });
      for (const p of list) e.net.delay[p] = 5;
      await e.install();
      ok('g3 install の取りは同時に2本以上（4本まで）', e.net.peak >= 2 && e.net.peak <= 4, String(e.net.peak));
    }
  }
  {
    // j・t 印の無い控え＝画面はネット・取り直しは1本・印が付く
    const e = makeEnv(swText, { files });
    const half = await e.caches.open('mj-' + V);
    await half.put(ORIGIN + vp('/index.html'), new Response('<html>半端</html>'));
    e.net.delay['/css/app.css'] = 40;
    const r = await e.nav('/index.html');
    const r2 = await e.get(vp('/lib/score.mjs'));
    await e.nav('/hayami.html');
    const rt = await text(r);
    ok('j 印の無い控えの時、画面はネットの素の html', rt.includes('src="js/gamen-home.mjs"') && !rt.includes('mj-ver'));
    ok('j 印の無い控えの /v/ は素の道をネットから', r2 && r2.status === 200);
    await e.settle();
    const idx = e.log.filter((x) => x.path === '/index.html' && x.cache === 'reload').length;
    ok('t 取り直しは重なっても1本（/index.html を取りに行ったのは1回）', idx === 1, String(idx));
    ok('j 裏で取り直して完了印が付く', !!(await (await e.caches.open('mj-' + V)).match(ORIGIN + '/__mj_done')));
    ok('j 取り直しの仮は残らない', !(await e.caches.keys()).some((k) => k.startsWith('mj-tmp-')));
  }
  {
    // k 取り直しが落ちた
    const e = makeEnv(swText, { files, retry: 10000 });
    e.net.status['/lib/tiles.mjs'] = 500;
    await e.nav('/index.html'); await e.settle();
    const ks = await e.caches.keys();
    ok('k 取り直しが落ちたら印は無い', !(await isDoneIn(e, V)), ks.join(','));
    delete e.net.status['/lib/tiles.mjs'];
    e.log.length = 0;
    await e.nav('/index.html'); await e.settle();
    ok('k 落ちた直後は走り直さない（RETRY の間）', e.log.filter((x) => x.cache === 'reload').length === 0);
  }
  {
    // k2 取り直しは他の版の仮（新しい版の取り込み中の物）を消さない
    const e = makeEnv(swText, { files });
    await (await e.caches.open('mj-tmp-ffffffffffff-i')).put(ORIGIN + '/v/ffffffffffff/index.html', new Response('x'));
    await e.nav('/index.html'); await e.settle();
    ok('k2 取り直しは印を付ける', await isDoneIn(e, V));
    ok('k2 取り直しは他の版の仮を消さない', (await e.caches.keys()).includes('mj-tmp-ffffffffffff-i'));
  }
  {
    // l supa-config
    const e = makeEnv(swText, { files });
    e.net.status['/js/supa-config.js'] = 500;
    ok('l 初めて（mj-conf 無し）はネットの答えをそのまま（5xx も）', (await e.get('/js/supa-config.js')).status === 500);
    ok('l ok でない答えは mj-conf に入れない', !(await (await e.caches.open('mj-conf')).match(ORIGIN + '/js/supa-config.js')));
    delete e.net.status['/js/supa-config.js'];
    await e.get('/js/supa-config.js'); await e.settle();
    ok('l ok なら mj-conf に入れる', !!(await (await e.caches.open('mj-conf')).match(ORIGIN + '/js/supa-config.js')));
    e.net.body['/js/supa-config.js'] = 'window.SUPA={new:1}';
    e.net.delay['/js/supa-config.js'] = 400;
    ok('l 遅い（3秒越え）時は mj-conf', !(await text(await e.get('/js/supa-config.js'))).includes('new:1'));
    await e.settle();
    ok('l 遅れて返った ok で mj-conf を入れ直す', (await text(await (await e.caches.open('mj-conf')).match(ORIGIN + '/js/supa-config.js'))).includes('new:1'));
    delete e.net.delay['/js/supa-config.js'];
    e.net.status['/js/supa-config.js'] = 503;
    ok('l 5xx の時は mj-conf', (await e.get('/js/supa-config.js')).status === 200);
    delete e.net.status['/js/supa-config.js'];
    e.net.body['/js/supa-config.js'] = 'window.SUPA={newer:1}';
    ok('l ok ならネットの答え', (await text(await e.get('/js/supa-config.js'))).includes('newer:1'));
  }
  return { p, f };
}

/* ── 壊し（--self-test） ────────────────────────────────── */
function copyRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-sw-'));
  for (const f of fs.readdirSync(ROOT)) if (/\.(html|json)$/.test(f) || f === 'sw.js') fs.copyFileSync(path.join(ROOT, f), path.join(d, f));
  for (const sub of ['css', 'js', 'lib', 'vendor', 'icons']) fs.cpSync(path.join(ROOT, sub), path.join(d, sub), { recursive: true });
  return d;
}
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => (s) => { if (!s.includes(a)) throw new Error('壊しの字が見つからない：' + a); return s.split(a).join(b); };
const BREAKS = [
  ['ignoreSearch を足す', { sw: rep("match(vkey(ver, p))", "match(vkey(ver, p), { ignoreSearch: true })") }],
  ['ok を見ない', { sw: rep('if (!r.ok || r.redirected) { last', 'if (false) { last') }],
  ['install で skipWaiting', { sw: rep("self.addEventListener('install', (e) => {\n", "self.addEventListener('install', (e) => {\n  self.skipWaiting();\n") }],
  ['名簿から1つ外す', { sw: (s) => s.replace(/\n  \['\/lib\/score\.mjs', '[0-9a-f]{64}'\],/, '') }],
  ['VER をずらす', { sw: (s) => s.replace(/const VER = '[0-9a-f]{12}';/, "const VER = 'ffffffffffff';") }],
  ['a href・manifest まで書き換える', { sw: rep("(/\\srel\\s*=\\s*\"[^\"]*\\bstylesheet\\b[^\"]*\"/i.test(t) ? swap(t, 'href') : t)", "swap(t, 'href')") }],
  ['完了印を見ない', { sw: rep("if (!(await caches.has(name))) return false;\n  return !!(await (await caches.open(name)).match(DONE));", 'return caches.has(name);') }],
  ['install 失敗で置き場も消す（続きから取れない）', { sw: rep('  await fillInto(tmpName, signal);\n  await promote', '  try { await fillInto(tmpName, signal); } catch (err) { await caches.delete(tmpName); throw err; }\n  await promote') }],
  ['install が mj-part を作る', { sw: rep('  if (await caches.has(PART)) return PART;', '  await caches.open(PART); return PART;') }],
  ['mj-conf に続けない', { sw: rep('  if (await caches.has(CONF)) return CONF;\n', '') }],
  ['使い捨てを消さない（死んだ控えに続ける）', { sw: rep('    await caches.delete(FB);', '    //') }],
  ['他の版を置き場から消さない', { sw: rep('    await cleanOther(PART);\n    await cleanOther(CONF);\n', '') }],
  ['promote が mj-conf ごと消す', { sw: rep('if (tmpName === PART || tmpName === CONF)', 'if (tmpName === PART)') }],
  ['promote が mj-part の写した物を残す', { sw: rep('{ for (const req of mine) await tmp.delete(req); }', '{}') }],
  ['activate が mj-part を作らない', { sw: rep('    await caches.open(PART);           // 次の版', '    // 次の版') }],
  ['1回の取りの締め切りが無い', { sw: rep('const t = setTimeout(cut, FETCH_MS);', 'const t = 0;') }],
  ['install の締め切りが無い', { sw: rep("timer = setTimeout(() => { ac.abort(); ng(new Error('install の締め切り')); }, INSTALL_MS);", 'timer = null;') }],
  ['v1.1 の古い取り込み（切らない＋落ちたら控えを消す）', { sw: (s) => rep('const stopped = (signal) => !!(signal && signal.aborted);', 'const stopped = () => false;')(rep("    if (signal) signal.addEventListener('abort', cut);\n", '')(rep('  await fillInto(tmpName, signal);\n  await promote(tmpName, signal);', '  try { await fillInto(tmpName, signal); await promote(tmpName, signal); } catch (err) { await caches.delete(C); throw err; }')(s))) }],
  ['取った物を飛ばさない（いつも全部取る）', { sw: rep("if (!have || have.headers.get(SHA_H) !== want) todo.push", "todo.push") }],
  ['取り直さない（1回だけ）', { sw: rep('const TRIES = self.MJ_TRIES || [0, 500, 1500];', 'const TRIES = [0];') }],
  ['並べない（1本ずつ）', { sw: rep('const POOL = 4;', 'const POOL = 1;') }],
  ['取り直しが他の版の仮を消す', { sw: rep("      await build(TMP + 'r');", "      await dropTmp(null);\n      await build(TMP + 'r');") }],
  ['activate が mj-conf も消す', { sw: rep('const CACHE_RE = /^mj-[0-9a-f]{12}$/;', 'const CACHE_RE = /^mj-/;') }],
  ['取り直しを1本に絞らない', { sw: rep('if (refilling || Date.now()', 'if (Date.now()') }],
  ['/v/ のままネットへ', { sw: rep("O + p + url.search, { cache: 'reload' }", "O + url.pathname + url.search, { cache: 'reload' }") }],
  ['supa-config の時間切れが無い', { sw: rep('const r = await Promise.race([net.catch(() => null), timer]);\n  if (r && r.ok', 'const r = await net.catch(() => null);\n  if (r && r.ok') }],
  ['/r/ の字を変える', { sw: rep('const TOKEN_RE = /^\\/r\\/([0-9a-f]{32})\\/?$/;', 'const TOKEN_RE = /^\\/r\\/([0-9a-f]+)\\/?$/;') }],
  ['素の道を控えが先にする', { sw: rep('try {\n    return await fetch(e.request);\n  } catch (err) {\n    const hit', 'try {\n    const h0 = PATHS.has(url.pathname) ? await fromCache(VER, url.pathname) : null; if (h0) return h0;\n    return await fetch(e.request);\n  } catch (err) {\n    const hit') }],
  ['meta mj-ver を足さない', { sw: rep(".replace(/<head\\b[^>]*>/i, (h) => h + '<meta name=\"mj-ver\" content=\"' + VER + '\">')", '') }],
  ['3秒の切りが無い', { sw: rep("const r = await Promise.race([net.catch(() => 'error'), timer]);", "const r = await net.catch(() => 'error');") }],
  ['名簿の外の画面の 404 を index に化かす', { sw: rep("if (r !== 'timeout' && r !== 'error') return r;", "if (r !== 'timeout' && r !== 'error' && r.ok) return r;") }],
  ['activate で古いのを全部消す', { sw: rep('for (const k of olds) if (k !== prev) await caches.delete(k);', 'for (const k of olds) await caches.delete(k);') }],
  ['html の sw-reg 行を外す', { file: ['tensu.html', rep('<script src="/js/sw-reg.js" defer></script>', '')] }],
  ['sw-reg を相対で登録', { file: ['js/sw-reg.js', rep("register('/sw.js', { scope: '/' })", "register('sw.js', { scope: '/' })")] }],
  ['sw-reg が初めての claim で帯を出す', { file: ['js/sw-reg.js', rep('if (!hadCtl && changes === 1 && !swapping) return;', '')] }],
  ['sw-reg の installed で前の版を見ない', { file: ['js/sw-reg.js', rep('reg.active && reg.active !== w && sw.controller', 'sw.controller')] }],
  ['名簿の js に import( を足す', { file: ['lib/score.mjs', (s) => s + '\nexport const later = () => import("./tiles.mjs");\n'] }],
  ['css に url( を足す', { file: ['css/app.css', (s) => s + '\n.x { background: url(/icons/icon-192.png); }\n'] }],
  ['version.json をずらす', { file: ['version.json', () => '{"ver":"eeeeeeeeeeee"}\n'], raw: true }],
];

if (process.argv.includes('--self-test')) {
  const base = await run({ sw: SW, quiet: true });
  if (base.f) { console.log(`✗ 壊す前に赤が ${base.f} 本（先に本番の試験を緑に）`); process.exit(1); }
  let red = 0;
  for (const [name, b] of BREAKS) {
    let res;
    try {
      if (b.sw) res = await run({ sw: b.sw(SW), quiet: true });
      else {
        const d = copyRoot();
        const fp = path.join(d, b.file[0]);
        fs.writeFileSync(fp, b.file[1](fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n')));
        // 壊した人が押す前に --write を回した形にする（名簿の sha 違いでなく、その決まりの試験で赤になるかを測る）。
        // raw＝version.json の壊しは作り直すと消えるので、そのまま。
        if (!b.raw) {
          const sp = path.join(d, 'sw.js');
          const st = fs.readFileSync(sp, 'utf8').replace(/\r\n/g, '\n');
          const g = computeAll(d, st, BIN);
          fs.writeFileSync(sp, writeSw(st, g.ver, g.assets));
          fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ ver: g.ver }) + '\n');
        }
        try { res = await run({ sw: fs.readFileSync(path.join(d, 'sw.js'), 'utf8').replace(/\r\n/g, '\n'), root: d, quiet: true }); }
        finally { fs.rmSync(d, { recursive: true, force: true }); }
      }
    } catch (err) { console.log(`  ✗ 壊しが作れない：${name} — ${err.message}`); continue; }
    if (res.f > 0) red++; else console.log(`  ✗ 壊しても緑のまま：${name}`);
  }
  console.log(`自己確認: ${red}/${BREAKS.length}`);
  process.exitCode = red === BREAKS.length ? 0 : 1;
} else {
  const { p, f } = await run({ sw: SW });
  console.log(`\nsw: ${p} passed, ${f} failed`);
  process.exitCode = f ? 1 : 0;
}
