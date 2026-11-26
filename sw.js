/* sw.js — 麻雀〜do the math〜 の PWA（件3・設計 tataki/sw_sekkei_v1.md v3.3）
 * ============================================================================
 * ★VER と名簿は手で書かない★＝ node scripts/sw-assets.mjs --write が書く（tests/sw.test.mjs が引き直して突き合わせる）。
 * 芯＝★版を道に入れる（控えの中だけ）★：install で html の <script src> と <link rel="stylesheet" href> の名簿の道を
 *   /v/<VER>/<道> に書き換えて控えに入れる。import は全部相対なので、1つの画面の取りはその html の版の控えにしか行かない＝混ざらない。
 *   repo の html・js は1字も変えない（ネットで開く時は普通のウェブ）。a href・manifest・apple-touch-icon は触らない。
 * 控え：mj-<VER>（完了印 /__mj_done つきの物だけ使う）・mj-tmp-<VER>-*（取りかけ）・mj-conf（supa-config.js の写し）。
 * 入れ替え：install で skipWaiting しない。画面の［入れ替える］で SKIP_WAITING が来た時だけ（js/sw-reg.js）。
 */
const VER = '25f5ebfee24d';
const ASSETS = /*ASSETS-BEGIN*/[
  ['/css/app.css', '6c76c1512ed6471b09e88a64322f41fe8df3cb8c910d877ef9d29b53c62f5517'],
  ['/css/gamen.css', '80c5cb4dbe450d44c3071ff2f42186786f79c0364727024c92375b57aa29dee9'],
  ['/hayami.html', 'c7bc810ac6db0b854f1c390ed4eeaba37c95f4c4685d4ad8f50db8f36d598cc4'],
  ['/icons/apple-touch-icon.png', '21c5521d6542c0ba80efacadf3821ee9a56c499a008619075f75f6c6d9f56ff0'],
  ['/icons/icon-192.png', '5857277bafb6ddcbfa834336110ec15859121db6bc7371f4bab8021fc5b6dc6a'],
  ['/icons/icon-512.png', 'ff686a73f1bc0a7fb0c475cee7f023fa12b92b1f5d3796b5b66c8f9231f794f3'],
  ['/index.html', 'b539695cf57e03ff56411f16e7b41010d06bd5e87f96029ef2e2b0b0a1440249'],
  ['/js/env-badge.js', '30640dd937852a701454d15305038370525bb5d836156d910e7691118fc736df'],
  ['/js/exally-login.js', 'fa2b5a3dfbef2889c2c37fc66dfbc8de4b53e770e8aa20fc6e0d6d769c940573'],
  ['/js/gamen-core.mjs', 'bc767af815bda845916eeef4b761017114a4de2bca7a29fb62d17371807aa4da'],
  ['/js/gamen-home.mjs', '23289b2e1c368a39d95127f80fc84430355348f3ff63d348d0fb46a5f146ae2c'],
  ['/js/gamen-league.mjs', '841ae20c16ad5a4a63212215476513bd791a19ee6c642ffe9edab146cc2ce1c2'],
  ['/js/gamen-room.mjs', '2c1305286372c286a9661dbb9bce8e18c47d27446352552914a10c8dd0cd4737'],
  ['/js/gamen-rules.mjs', '1eb2da094b1b81d331782e48f1bcc488202cb4147a9344447b92402e977ba005'],
  ['/js/gamen-taikyoku.mjs', 'f17e5f54dadb8c677238a75edd3bc9570ed2fc78ca2f45ae33e719a20658ff97'],
  ['/js/hayami.js', '167581be01dd85d035811d003ec14c8a3de274faf10b943d773c9c6db95ddeae'],
  ['/js/machi.js', '4f67b69bf283207cfa0a92ff5eccc56f23d6e5f6b608b1bfdf7308190234c9c7'],
  ['/js/sw-reg.js', '6cabdb55f344b5ec9f1087e98e13efb4d7d41491745d089ee1c9fede624cd6ba'],
  ['/js/tensu.js', 'fdc340cfe6837fdcf72a03eacbc89f685820bb958a28f2e54eb96a4093bb80e4'],
  ['/js/tile-svg.mjs', '215a0635d07aadc3e93122a5dfcf35326a223775eef70cbe6e668e05d069d7ef'],
  ['/league.html', '7ccae6a1ccb102414140241c88aceeb0fd91f6ba059cfad413199bd5cf939d1a'],
  ['/lib/hanchan-pt.mjs', 'f1a67f90e95c393059bd3c420abb0cfde632b31f7a1e4fa079229a0113a4b04d'],
  ['/lib/kamicha.mjs', '678b1620ad2f741e044cc1da7ceabd5b9be20c49a5cba2b97180974556cebfcc'],
  ['/lib/name-key.mjs', '1e5f1c335584fc1b346706ffabc1a446a72496d9834600f4585dcb702f426b43'],
  ['/lib/needs-order.mjs', 'ce391d9728b7d0b7697b40a83452f23395c12277997351ca4396166d95e5f2e2'],
  ['/lib/outbox.mjs', 'f35b2ec198a083e9aa5362ba5f035b97f959bf6bb54bfd178a5f512ceeb26bb9'],
  ['/lib/room-state.mjs', 'c3d47394d6b3cc8c1017661a5e24cfee0f5acbfc225b245791e705cce98c4759'],
  ['/lib/rules.mjs', 'e389644031b87167e7f9f5fec6b20d997e6d93fee5862e4ba66677856d034f36'],
  ['/lib/safe-int.mjs', 'c3d97c57acb9e2308a2e0e827a715a18b39659985877044b8c5b8d4379fb6b83'],
  ['/lib/score-table.mjs', 'ebde7f0da8aa0905d774caeef696b46e1c2c6832f8674cf2c3fbb38a73644dd0'],
  ['/lib/score.mjs', '8bb312dcb210b70cf618df8f3b8bf30a40260f21a3943443cefe0fddb118d824'],
  ['/lib/seisan.mjs', '39878c6c204fae32087705a306d0450bd30002e03ce4fab0e2ee5e9fdbeb303b'],
  ['/lib/shanten.mjs', 'c996f78b984a5b40c966f53bb9ae2c33e6e5ec9d5de9e07c568a31ebcce10512'],
  ['/lib/tiles.mjs', 'e2bd47542544f03e5a57d71cb09627dd995ca3b011f602fbdf108c1f6993abc5'],
  ['/lib/url-token.mjs', 'ee07da319cfea8a33cd1d2b049a60232fd1eaa63eaa5f7789f658931c17bb04c'],
  ['/machi.html', 'e90ddcde5e14ffd8830168be90dd8e021a431dd7580c040fd6b2e3a46c9da54e'],
  ['/manifest.json', '5d695eeb2f751e68f43ffd19adfec9144eccf4466f69dd9f86a48c4e00508afa'],
  ['/senseki.html', 'd374c1503dddb32142cd5f31133c4e51b67009531db32950d655a165998557e5'],
  ['/taikyoku.html', '26d768ead7bac001fdec69c3f73b0dd2d39160513ab9a240658a680731e57eee'],
  ['/tensu.html', '9ecd17a292b5d4619c8cee2aca9039db40fe244189b60d3ce0ef9001c11a0f0c'],
  ['/vendor/qrcode-generator.js', '79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c'],
  ['/vendor/supabase-2.112.4.js', 'f8ce7fab799af1916019cbd0b485b39bb80dbdbc6dc062909a751c9e5198e04c'],
]/*ASSETS-END*/;

const O = self.location.origin;
const C = 'mj-' + VER;
const TMP = 'mj-tmp-' + VER + '-';
const CONF = 'mj-conf';
const CONF_PATH = '/js/supa-config.js';
const DONE = O + '/__mj_done';
const CACHE_RE = /^mj-[0-9a-f]{12}$/;
const V_RE = /^\/v\/([0-9a-f]{12})(\/.*)$/;
const TOKEN_RE = /^\/r\/([0-9a-f]{32})\/?$/; // js/gamen-core.mjs の tokenFromPath と同じ字（試験で見る）
const PATHS = new Map(ASSETS);
const WAIT = self.MJ_WAIT_MS || 3000;          // 画面と supa-config のネット待ち
const RETRY = self.MJ_RETRY_MS || 30000;       // 取り直しが落ちた後に、次に走れるまで
const vkey = (ver, p) => O + '/v/' + ver + p;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 控えの html の書き換え＝<script src> と <link rel="stylesheet" href> の、名簿の道と一致する物だけ。<!-- --> の中は触らない。 */
function rewriteHtml(text, htmlPath) {
  const swap = (tag, attr) => tag.replace(new RegExp('(\\s' + attr + '\\s*=\\s*")([^"]*)(")'), (all, a, ref, z) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || /[?#]/.test(ref)) return all;
    const p = decodeURIComponent(new URL(ref, 'https://x' + htmlPath).pathname);
    return PATHS.has(p) ? a + '/v/' + VER + p + z : all;
  });
  const parts = text.split(/(<!--[\s\S]*?-->)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/<script\b[^>]*>/gi, (t) => swap(t, 'src'))
      .replace(/<link\b[^>]*>/gi, (t) => (/\srel\s*=\s*"[^"]*\bstylesheet\b[^"]*"/i.test(t) ? swap(t, 'href') : t));
  }
  return parts.join('').replace(/<head\b[^>]*>/i, (h) => h + '<meta name="mj-ver" content="' + VER + '">');
}

async function isDone(name) {
  if (!(await caches.has(name))) return false;
  return !!(await (await caches.open(name)).match(DONE));
}

/** 名簿を全部ネットから取り、sha を照らして仮の控えへ。1つでも違えば投げる。 */
async function fillInto(tmpName) {
  const tmp = await caches.open(tmpName);
  for (const [p, want] of ASSETS) {
    const r = await fetch(new Request(O + p, { cache: 'reload' }));
    if (!r.ok || r.redirected) throw new Error('取れない ' + p + ' ' + r.status);
    const buf = await r.arrayBuffer();
    const got = hex(await crypto.subtle.digest('SHA-256', buf));
    if (got !== want) throw new Error('中身が違う ' + p);
    const headers = new Headers();
    const ct = r.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    const body = p.endsWith('.html') ? rewriteHtml(new TextDecoder().decode(buf), p) : buf;
    await tmp.put(vkey(VER, p), new Response(body, { status: 200, headers }));
  }
}

/** 仮から mj-<VER> へ写し、名簿が全部そろったと数えてから完了印。仮は消す。 */
async function promote(tmpName) {
  const tmp = await caches.open(tmpName);
  const c = await caches.open(C);
  for (const req of await tmp.keys()) await c.put(req, await tmp.match(req));
  for (const [p] of ASSETS) if (!(await c.match(vkey(VER, p)))) throw new Error('写しが欠けた ' + p);
  await c.put(DONE, new Response(JSON.stringify({ ver: VER, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  await caches.delete(tmpName);
}

async function dropTmp(keepPrefix) {
  for (const k of await caches.keys()) if (k.startsWith('mj-tmp-') && !(keepPrefix && k.startsWith(keepPrefix))) await caches.delete(k);
}

async function build(tmpName) {
  try {
    await caches.delete(C);            // 印の無い mj-<VER> は使わない＝消して取り直す
    await fillInto(tmpName);
    await promote(tmpName);
  } catch (err) {
    await caches.delete(tmpName);
    await caches.delete(C);
    throw err;
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await dropTmp(TMP);                // 同じ登録の install は1つずつ＝他の版の仮は残骸
    if (await isDone(C)) return;       // 完了印の在る控えは取り直さない
    await build(TMP + 'i');
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 今の版と、完了印の在る中で一番新しく完了した「1つ前」だけを残す。mj-conf・mj-tmp-* は形が違うので消さない。
    let prev = null, prevAt = -1;
    const olds = (await caches.keys()).filter((k) => CACHE_RE.test(k) && k !== C);
    for (const k of olds) {
      const m = await (await caches.open(k)).match(DONE);
      if (!m) continue;
      const at = (await m.json()).at;
      if (at > prevAt) { prevAt = at; prev = k; }
    }
    for (const k of olds) if (k !== prev) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

let refilling = null, refillFailAt = 0, refillN = 0;
/** 控えが欠けた・追い出された時の取り直し＝sw の中で1本だけ。 */
function startRefill(e) {
  if (refilling || Date.now() - refillFailAt < RETRY) return;
  refilling = (async () => {
    try {
      await dropTmp(null);
      await build(TMP + 'r' + (++refillN) + '-' + Date.now());
    } catch (_) {
      refillFailAt = Date.now();
    } finally {
      refilling = null;
    }
  })();
  e.waitUntil(refilling);
}

async function fromCache(ver, p) {
  const name = 'mj-' + ver;
  if (!(await isDone(name))) return null;
  return (await (await caches.open(name)).match(vkey(ver, p))) || null;
}

async function onNavigate(e, url) {
  let p = url.pathname;
  if (p === '/') p = '/index.html';
  else if (TOKEN_RE.test(p)) p = '/taikyoku.html';
  const done = await isDone(C);
  if (!done) { startRefill(e); return fetch(e.request); }          // 控えが使えない＝この画面は全部ネット（素の html）
  if (PATHS.has(p) && p.endsWith('.html')) {
    const hit = await fromCache(VER, p);
    if (hit) return hit;
  }
  // 名簿の外の画面：ネットを3秒待つ。すぐ落ちた・3秒を越えた時は控えの /index.html。ネットの答えは ok でなくてもそのまま。
  const net = fetch(e.request);
  const timer = new Promise((res) => setTimeout(() => res('timeout'), WAIT));
  const r = await Promise.race([net.catch(() => 'error'), timer]);
  if (r !== 'timeout' && r !== 'error') return r;
  return (await fromCache(VER, '/index.html')) || Response.error();
}

async function onAsset(e, url) {
  const m = url.pathname.match(V_RE);
  if (m) {
    const [, ver, p] = m;
    const hit = url.search ? null : await fromCache(ver, p);
    if (hit) return hit;
    if (ver === VER) startRefill(e);
    return fetch(new Request(O + p + url.search, { cache: 'reload' }));   // /v/ のままネットへ行かない（rewrite は無い）
  }
  // 素の道（ネットで開いた画面の素材・manifest・icons）＝ネットを先に見る（ネットの html と同じ配信にそろう）。落ちた時だけ今の版の控え。
  try {
    return await fetch(e.request);
  } catch (err) {
    const hit = !url.search && PATHS.has(url.pathname) ? await fromCache(VER, url.pathname) : null;
    if (hit) return hit;
    throw err;
  }
}

/** supa-config.js：ネットを3秒待つ。ok なら mj-conf に入れ直す。3秒越え・落ちた・5xx は mj-conf、無ければネットの答え。 */
async function onConf(e) {
  const req = new Request(O + CONF_PATH, { cache: 'no-store' });
  const net = fetch(req).then(async (r) => {
    if (r.ok && !r.redirected) await (await caches.open(CONF)).put(O + CONF_PATH, r.clone());
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  const old = await (await caches.open(CONF)).match(O + CONF_PATH);
  if (!old) return net;
  const timer = new Promise((res) => setTimeout(() => res(null), WAIT));
  const r = await Promise.race([net.catch(() => null), timer]);
  if (r && r.ok && !r.redirected) return r;
  return old;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== O) return;
  if (url.pathname === '/version.json' || url.pathname === '/sw.js') return;
  if (url.pathname === CONF_PATH) { e.respondWith(onConf(e)); return; }
  if (req.mode === 'navigate') { e.respondWith(onNavigate(e, url)); return; }
  e.respondWith(onAsset(e, url));
});
