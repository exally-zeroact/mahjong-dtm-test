/* sw.js — 麻雀〜do the math〜 の PWA（件3・設計 tataki/sw_sekkei_v1.md v3.3）
 * ============================================================================
 * ★VER と名簿は手で書かない★＝ node scripts/sw-assets.mjs --write が書く（tests/sw.test.mjs が引き直して突き合わせる）。
 * 芯＝★版を道に入れる（控えの中だけ）★：install で html の <script src> と <link rel="stylesheet" href> の名簿の道を
 *   /v/<VER>/<道> に書き換えて控えに入れる。import は全部相対なので、1つの画面の取りはその html の版の控えにしか行かない＝混ざらない。
 *   repo の html・js は1字も変えない（ネットで開く時は普通のウェブ）。a href・manifest・apple-touch-icon は触らない。
 * 控え：mj-<VER>（完了印 /__mj_done つきの物だけ使う）・mj-part（取りかけの続きの置き場・画面と activate が作る）・mj-tmp-<VER>-*（取りかけ）・mj-conf（supa-config.js の写し・mj-part が無い時の続きの置き場）。
 * ★install は続きの置き場を作らない★（swupd_sadame v1.3.1 §1：WebKit は落ちた install だけが触った控えを中身ごと捨て、名前だけ残して以後の put を黙って捨てる＝11-27 測った）。
 * 入れ替え：install で skipWaiting しない。画面の［入れ替える］で SKIP_WAITING が来た時だけ（js/sw-reg.js）。
 */
const VER = 'bfd1817e0d7d';
const ASSETS = /*ASSETS-BEGIN*/[
  ['/css/app.css', 'a6e53f787d1abea30eb68312e845b011a8dd664f5a84dc61a8e6ed05079323ce'],
  ['/css/gamen.css', '23dc29163b81070b05bdc08837356eb01a55c3ea2239f48ac0a665346700f428'],
  ['/hayami.html', 'c7bc810ac6db0b854f1c390ed4eeaba37c95f4c4685d4ad8f50db8f36d598cc4'],
  ['/icons/apple-touch-icon.png', '21c5521d6542c0ba80efacadf3821ee9a56c499a008619075f75f6c6d9f56ff0'],
  ['/icons/icon-192.png', '5857277bafb6ddcbfa834336110ec15859121db6bc7371f4bab8021fc5b6dc6a'],
  ['/icons/icon-512.png', 'ff686a73f1bc0a7fb0c475cee7f023fa12b92b1f5d3796b5b66c8f9231f794f3'],
  ['/index.html', '0dc9aba9ca83990c25df06e7d16b8f2fa3adebfb494d5afda83365595cfc907a'],
  ['/js/env-badge.js', '30640dd937852a701454d15305038370525bb5d836156d910e7691118fc736df'],
  ['/js/exally-login.js', 'fa2b5a3dfbef2889c2c37fc66dfbc8de4b53e770e8aa20fc6e0d6d769c940573'],
  ['/js/gamen-core.mjs', '634d3cc7d796a87680684d6c2a9f9131d9be7d266c21505d8457cb70f7bfed76'],
  ['/js/gamen-home.mjs', '096b1a9f82731eb9ee82613a4226103c19ce54c840187c9db6ec66b2cbe48e73'],
  ['/js/gamen-human.mjs', 'f32257812d6555e5a937813e8ff2186afdc72e642f4b84bf322dc697a3cfaec7'],
  ['/js/gamen-league.mjs', '15ce54fc0777a9238be61f6dc9a93ce0f9c8f2535f4908345260b32bc5b009f4'],
  ['/js/gamen-room.mjs', '4d379fc74744688527222d90ab4ad3bd2ac53b8c0c71ef1aafdc85facc11376a'],
  ['/js/gamen-rules.mjs', '13246bf062b14e9d9dd582e445744c8d9262e43979124576705cb0a0766ed03e'],
  ['/js/gamen-senseki.mjs', 'f302eb92131c0f78e4214c4b806252266261000f0dd5280e6cca5658793789e1'],
  ['/js/gamen-taikyoku.mjs', 'c8244b44e8d23220bb5950253926983f7de9249d660712c4003c3588c5084968'],
  ['/js/hayami.js', '167581be01dd85d035811d003ec14c8a3de274faf10b943d773c9c6db95ddeae'],
  ['/js/heya-modosu.mjs', '3e678e183723b1fa36285a2e3c267133c81041a1fb0606fa059af5d25c888e1c'],
  ['/js/kenban.mjs', 'ad7e1f231d24f51d6517e904f1d81fefe883f396a8b0123b1c049b9094715a7a'],
  ['/js/machi.js', '4f67b69bf283207cfa0a92ff5eccc56f23d6e5f6b608b1bfdf7308190234c9c7'],
  ['/js/rules-memory.mjs', '38dc35121e4c63683a3a2ff658803d73368436990a20f121540d9b25b4391495'],
  ['/js/sw-reg.js', '175c262793f9402a85417459d3f939c6af34137c9eade7ac8ad487c91ed010c7'],
  ['/js/tensu.js', 'fdc340cfe6837fdcf72a03eacbc89f685820bb958a28f2e54eb96a4093bb80e4'],
  ['/js/tile-svg.mjs', '215a0635d07aadc3e93122a5dfcf35326a223775eef70cbe6e668e05d069d7ef'],
  ['/league.html', '235b43c44e69c9fb6083500bf893d722bfd19bdc126000b144c7200406c960f0'],
  ['/lib/aizu-read.mjs', '753d3a178348aa8c4fe3ab48f6de21e02ba3277c62661ef7f2751369684d28ce'],
  ['/lib/hanchan-pt.mjs', '7e824f2397ed1107d320a40800d17f7eca26053c917712e71ee0e9028d4de338'],
  ['/lib/kamicha.mjs', '678b1620ad2f741e044cc1da7ceabd5b9be20c49a5cba2b97180974556cebfcc'],
  ['/lib/league-rank.mjs', 'b581d6419d0e47096699ebd290a156aa2d027fb94eff5d0b420e899833401e57'],
  ['/lib/league-round.mjs', '5d7675480bd067e8f1b012b2c00694f9f013339dbc65c185d5e8efba3d170b1c'],
  ['/lib/meibo.mjs', 'b7100c5ee8b3b885a0175705a44754b9814ea1f62a465e7d7fb8950323272369'],
  ['/lib/my-stats.mjs', 'c69ac0283a7a6d8f45adcf973c746ff10cb538ebc59b21e1d8fdf4ae4b44f4bb'],
  ['/lib/name-key.mjs', '1e5f1c335584fc1b346706ffabc1a446a72496d9834600f4585dcb702f426b43'],
  ['/lib/needs-order.mjs', 'ce391d9728b7d0b7697b40a83452f23395c12277997351ca4396166d95e5f2e2'],
  ['/lib/outbox.mjs', 'f4ea32f35292c29c0d37c04c40a0749cfbe6c1c980125fb1c8a7b03b9b4fd99e'],
  ['/lib/room-state.mjs', 'a3fc5d23c5040eea4a262acc0a2fee27012164df80fff90accc08e37bc0a2dec'],
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
  ['/senseki.html', '65099ba89490f306c334175d20e80bb2367f5def43ae2dcff52b7322d9977963'],
  ['/taikyoku.html', '846cda4c739ebedf1ffe2eb04331b104fcff75771b65d5cf458cedb43cb76b64'],
  ['/tensu.html', '9ecd17a292b5d4619c8cee2aca9039db40fe244189b60d3ce0ef9001c11a0f0c'],
  ['/vendor/qrcode-generator.js', '79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c'],
  ['/vendor/supabase-2.112.4.js', 'f8ce7fab799af1916019cbd0b485b39bb80dbdbc6dc062909a751c9e5198e04c'],
]/*ASSETS-END*/;

const O = self.location.origin;
const C = 'mj-' + VER;
const TMP = 'mj-tmp-' + VER + '-';
const CONF = 'mj-conf';
const CONF_PATH = '/js/supa-config.js';
const PART = 'mj-part';                        // 続きの置き場（install の外＝画面の sw-reg.js と activate が作る）
const FB = 'mj-tmp-' + VER + '-x';              // mj-part も mj-conf も無い時の使い捨て（続きは無い）
const DONE = O + '/__mj_done';
const CACHE_RE = /^mj-[0-9a-f]{12}$/;
const V_RE = /^\/v\/([0-9a-f]{12})(\/.*)$/;
const TOKEN_RE = /^\/r\/([0-9a-f]{32})\/?$/; // js/gamen-core.mjs の tokenFromPath と同じ字（試験で見る）
const PATHS = new Map(ASSETS);
const WAIT = self.MJ_WAIT_MS || 3000;          // 画面と supa-config のネット待ち
const RETRY = self.MJ_RETRY_MS || 30000;       // 取り直しが落ちた後に、次に走れるまで
const vkey = (ver, p) => O + '/v/' + ver + p;
const TRIES = self.MJ_TRIES || [0, 500, 1500]; // 1つの素材を取る回数と、その前に待つ ms（iOS の電波の揺れ・一時の 5xx）
const POOL = 4;                                // 同時に取る本数（45本を1本ずつだと遅い＝取り込みの途中で iOS が SW を止める）
const INSTALL_MS = self.MJ_INSTALL_MS || 90000; // install 全体の締め切り（iOS で返らない取りが在っても install を終わらせ、画面に「取り込めませんでした」）
const FETCH_MS = self.MJ_FETCH_MS || 20000;     // 1回の取りの締め切り（返事が無い取りは1回の落ちとして取り直す）
const VPRE = O + '/v/';
const SHA_H = 'x-mj-sha';                      // 仮の控えに入れた素材の「取った中身の sha」＝次の取り込みで飛ばしてよいかの印
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

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

const stopped = (signal) => !!(signal && signal.aborted);

/** 1つの素材をネットから取り、sha を照らす。落ち・ok でない・寄り道・中身違い・FETCH_MS 越えは待ってやり直す（TRIES の回数）。全部だめなら投げる。
 *  signal（install の締め切り）が切れたら、次の取り直しをしない・今の取りも切る。 */
async function fetchOne(p, want, signal) {
  let last = null;
  for (const wait of TRIES) {
    if (wait) await pause(wait);
    if (stopped(signal)) throw new Error('締め切り');
    const ac = new AbortController();
    const cut = () => ac.abort();
    if (signal) signal.addEventListener('abort', cut);
    const t = setTimeout(cut, FETCH_MS);
    try {
      const r = await fetch(new Request(O + p, { cache: 'reload', signal: ac.signal }));
      if (!r.ok || r.redirected) { last = new Error('取れない ' + p + ' ' + r.status); continue; }
      const buf = await r.arrayBuffer();
      if (hex(await crypto.subtle.digest('SHA-256', buf)) !== want) { last = new Error('中身が違う ' + p); continue; }
      return { buf, ct: r.headers.get('Content-Type') };
    } catch (err) { last = err; } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', cut); }
  }
  throw last;
}

/** 名簿を仮の控えへ（swupd_sadame v1.1 §2）。仮に在って印 x-mj-sha が名簿と同じ物は取らない＝取り込みが途中で止まっても（iOS が SW を止める・電波）
 *  次は残りだけ取る。同じ VER＝同じ名簿の sha なので混ざらない。POOL 本ずつ並べ、1つでも取れなければ他を取り終えてから投げる（取れた物は仮に残る）。 */
async function fillInto(tmpName, signal) {
  const tmp = await caches.open(tmpName);
  const todo = [];
  for (const [p, want] of ASSETS) {
    const have = await tmp.match(vkey(VER, p));
    if (!have || have.headers.get(SHA_H) !== want) todo.push([p, want]);
  }
  let next = 0, fail = null;
  const lane = async () => {
    while (next < todo.length && !stopped(signal)) {
      const [p, want] = todo[next++];
      try {
        const { buf, ct } = await fetchOne(p, want, signal);
        if (stopped(signal)) break;
        const headers = new Headers();
        if (ct) headers.set('Content-Type', ct);
        headers.set(SHA_H, want);
        const body = p.endsWith('.html') ? rewriteHtml(new TextDecoder().decode(buf), p) : buf;
        await tmp.put(vkey(VER, p), new Response(body, { status: 200, headers }));
      } catch (err) { if (!fail) fail = err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, todo.length) }, lane));
  if (stopped(signal)) throw new Error('締め切り');
  if (fail) throw fail;
}

/** 置き場から mj-<VER> へ ★この VER の /v/ の物だけ★ 写し（mj-conf の supa-config は写さない）、名簿が全部そろったと数えてから完了印。
 *  置き場が mj-part・mj-conf なら写した物だけ消す（控えは残す）。使い捨て（mj-tmp-*）は控えごと消す。締め切りが切れたら写しも印もしない。 */
async function promote(tmpName, signal) {
  const tmp = await caches.open(tmpName);
  const c = await caches.open(C);
  const mine = (await tmp.keys()).filter((req) => req.url.startsWith(VPRE + VER + '/'));
  for (const req of mine) {
    if (stopped(signal)) throw new Error('締め切り');
    await c.put(req, await tmp.match(req));
  }
  for (const [p] of ASSETS) if (!(await c.match(vkey(VER, p)))) throw new Error('写しが欠けた ' + p);
  if (stopped(signal)) throw new Error('締め切り');
  await c.put(DONE, new Response(JSON.stringify({ ver: VER, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  if (tmpName === PART || tmpName === CONF) { for (const req of mine) await tmp.delete(req); }
  else await caches.delete(tmpName);
}

/** 続きの置き場から、他の版の /v/ の物を消す（mj-conf の supa-config は触らない）。残るのは今の VER の分だけ。 */
async function cleanOther(name) {
  if (!(await caches.has(name))) return;
  const c = await caches.open(name);
  for (const req of await c.keys()) if (req.url.startsWith(VPRE) && !req.url.startsWith(VPRE + VER + '/')) await c.delete(req);
}

async function dropTmp(keepPrefix) {
  for (const k of await caches.keys()) if (k.startsWith('mj-tmp-') && !(keepPrefix && k.startsWith(keepPrefix))) await caches.delete(k);
}

/** 落ちても mj-<VER> を消さない（v1.3.1 §2：締め切りの後に遅れて落ちた古い取り込みが、次の install の出来上がった控えを消していた）。
 *  印の無い mj-<VER> は始めにだけ消す（取りの道は印の在る控えしか使わない＝fromCache・isDone）。置き場は残す＝次は残りだけ。 */
async function build(tmpName, signal) {
  await caches.delete(C);              // 印の無い mj-<VER> は使わない＝消して取り直す
  await fillInto(tmpName, signal);
  await promote(tmpName, signal);
}

/** 続きの置き場を選ぶ（install は作らない）：mj-part → mj-conf → 使い捨て。 */
async function pickStore() {
  if (await caches.has(PART)) return PART;
  if (await caches.has(CONF)) return CONF;
  return FB;
}

self.addEventListener('install', (e) => {
  const ac = new AbortController();
  let timer = null;
  const run = (async () => {
    await dropTmp(TMP);                // 他の版の仮は残骸
    await caches.delete(FB);           // 使い捨ては毎回新しく（dropTmp(TMP) は同じ版の名を残す）
    if (await isDone(C)) return;       // 完了印の在る控えは取り直さない
    await cleanOther(PART);
    await cleanOther(CONF);
    await build(await pickStore(), ac.signal);
  })();
  const deadline = new Promise((_, ng) => { timer = setTimeout(() => { ac.abort(); ng(new Error('install の締め切り')); }, INSTALL_MS); });
  e.waitUntil(Promise.race([run, deadline]).finally(() => { clearTimeout(timer); ac.abort(); }));
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
    await caches.open(PART);           // 次の版の続きの置き場（install の外で作る＝v1.3.1 §1）
    await self.clients.claim();
  })());
});

/** 画面からの「install は済んだか」（swupd_sadame v1.4.1 §2）。WebKit は install が済んだ直後に開いた画面に installing のまま動かない登録を渡す
 *  （11-27 CI で測った・statechange も来ない）＝画面は w.state を信じられない＝本人に訊く。答えは SW が止まって起こされても残る物だけで作る
 *  （自分の state・完了印）。redundant（落ちた・捨てられた）は済んでいない。 */
async function myState() {
  const st = self.serviceWorker ? self.serviceWorker.state : null;
  if (st === 'installed' || st === 'activating' || st === 'activated') return true;
  if (st === 'redundant') return false;
  try { return await isDone(C); } catch (_) { return false; }
}

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d && d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d && d.type === 'MJ_STATE' && e.ports && e.ports[0] && !self.MJ_STATE_OFF) {
    const port = e.ports[0];
    e.waitUntil(myState().then((done) => port.postMessage({ done, ver: VER })));
  }
});

let refilling = null, refillFailAt = 0;
/** 控えが欠けた・追い出された時の取り直し＝sw の中で1本だけ。 */
function startRefill(e) {
  if (refilling || Date.now() - refillFailAt < RETRY) return;
  refilling = (async () => {
    try {
      await build(TMP + 'r');          // 自分の仮の続きから・他の版の仮（新しい版の取り込み中の物）には触らない（§2・前は dropTmp(null) で消していた）
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
