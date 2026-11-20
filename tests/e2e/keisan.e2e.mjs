/* keisan.e2e.mjs — 早見表（hayami.html）と待ち読み（machi.html）を ★本物の画面★ で押して確かめる（webkit 390×844）
 * 計算そのものは tests/score-table.test.mjs・tests/shanten.test.mjs が見る。ここは「画面が lib を正しく繋いで出すか」：
 *   早見表＝子/親・ロン/ツモの切り替え・切り上げ満貫・3人折半の字・押す所の高さ（16px の字→44）
 *   待ち読み＝13枚（九蓮 9種23枚）・14枚（中を切る）・見えている牌・3人で 2〜8萬が消える・全部消す・手牌を押して外す・
 *             読み直しで残る・壊れた localStorage で落ちない（端末から戻す値の守り）
 * 配り方：作業木を http でそのまま出す（vercel.json の rewrites は要らない2枚だけ）。
 * node tests/e2e/keisan.e2e.mjs / --self-test（配る中身をわざと壊して、壊し1つごとに赤になるか＝作業木のファイルは触らない）
 * playwright は package.json に入れない（Vercel が devDependencies を入れる）＝CI は `npm i --no-save playwright@1.60.0`。
 * 手元で node_modules に無い時は PW_FROM=<playwright の入った package.json> で借りる。
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = process.argv.includes('--self-test');
let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PW_FROM) { console.log('✗ playwright が無い（CI は npm i --no-save playwright@1.60.0・手元は PW_FROM）'); process.exit(1); }
  pw = createRequire(process.env.PW_FROM)('playwright');
}

const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let mutate = null; // { file, from, to }：配る時だけ字を替える
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    if (mutate && rel === mutate.file) d = Buffer.from(d.toString('utf8').replace(/\r\n/g, '\n').split(mutate.from).join(mutate.to));
    r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    r.end(d);
  });
}).listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const browser = await pw.webkit.launch();

// 閉じが止まっても出しは出た後＝5秒で切る（自己確認の終わりで browser.close が返らない事があった・11-20）
const shut = () => Promise.race([browser.close().catch(() => {}), new Promise((ok) => setTimeout(ok, 5000))]).then(() => { srv.closeAllConnections?.(); srv.close(); });

const bad = [];
let n = 0;
// 自己確認の壊しの時は最初の赤で打ち切る（16回×全部押すと CI の20分を越える・11-20）
const STOP = Symbol('stop');
let fast = false;
const ok = (what, cond) => { n++; if (!cond) { bad.push(what); if (fast) throw STOP; } };

async function open(page0, store) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (store) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('e2e.set')) { localStorage.setItem(k, v); sessionStorage.setItem('e2e.set', '1'); } }, store);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + page0);
  await p.waitForSelector(page0 === 'hayami.html' ? '#hy-main tbody tr' : '#kb button', { timeout: 5000 }).catch(() => {});
  return { p, ctx, errs };
}
// 早見表の1マス（行＝符・列＝翻）の字
const cellText = (p, fu, han) => p.$$eval('#hy-main tbody tr', (rows, [fu, han]) => {
  const r = rows.find((x) => x.querySelector('th').textContent.startsWith(fu + '符'));
  return r ? r.querySelectorAll('td')[han - 1].innerText.replace(/\s+/g, '/') : null;
}, [fu, han]);
const txt = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');
const press = (p, seg, v) => p.click(`#${seg} button[data-v="${v}"]`);
const tap = async (p, codes) => { for (const c of codes) await p.click(`#kb button[data-c="${c}"]`); };
const split = (s) => s.match(/\d[mpsz]/g);

async function hayami() {
  const { p, ctx, errs } = await open('hayami.html');
  ok('早見 子ロン 30符1翻＝1,000', (await cellText(p, 30, 1)) === '1,000');
  ok('早見 子ロン 30符4翻＝7,700（切り上げなし）', (await cellText(p, 30, 4)) === '7,700');
  await press(p, 'seg-oya', 'oya');
  ok('早見 親ロン 30符1翻＝1,500', (await cellText(p, 30, 1)) === '1,500');
  await press(p, 'seg-agari', 'tsumo');
  ok('早見 親ツモ 30符1翻＝500（見出しにオール）', (await cellText(p, 30, 1)) === '500' && (await txt(p, '#hy-main thead')).includes('オール'));
  await press(p, 'seg-oya', 'ko');
  ok('早見 子ツモ 30符1翻＝上 300 下 500', (await cellText(p, 30, 1)) === '300/500');
  await p.$eval('details#hy-rules', (d) => { d.open = true; });
  await p.selectOption('#r-players', '3');
  await p.selectOption('#r-tsumo3', 'secchan');
  ok('早見 3人折半 子ツモ 30符1翻＝500/700', (await cellText(p, 30, 1)) === '500/700');
  ok('早見 3人折半の字が出る', (await txt(p, '#hy-note')).includes('3人の折半'));
  await p.selectOption('#r-players', '4');
  ok('早見 4人に戻すと折半の選びは押せない', await p.$eval('#r-tsumo3', (e) => e.disabled));
  await press(p, 'seg-agari', 'ron');
  await p.selectOption('#r-kiriage', '1');
  ok('早見 切り上げ満貫あり 子ロン 30符4翻＝8,000', (await cellText(p, 30, 4)) === '8,000');
  const hs = await p.$$eval('.seg button, .opts select, details.card > summary', (es) => es.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(`早見 押す所の高さが全部 44 以上（${hs.join(',')}）`, hs.length >= 8 && hs.every((h) => h >= 44));
  ok(`早見 横にはみ出さない（${await p.evaluate(() => document.documentElement.scrollWidth)}）`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  // 読み直しで残る
  await p.reload(); await p.waitForSelector('#hy-main tbody tr', { timeout: 5000 });
  ok('早見 読み直しても切り上げありのまま', (await cellText(p, 30, 4)) === '8,000');
  ok(`早見 落ちない（${errs.join(' | ')}）`, errs.length === 0);
  await ctx.close();
  // 壊れた localStorage
  const b = await open('hayami.html', ['mj.hayami.v1', '{"oya":"xx","agari":7,"players":"5","kiriage":"<b>"}']);
  ok('早見 壊れた値は既定に戻る（子ロン 30符1翻＝1,000・子が押されている）', (await cellText(b.p, 30, 1)) === '1,000'
    && (await b.p.getAttribute('#seg-oya button[data-v="ko"]', 'aria-pressed')) === 'true');
  const b2 = await open('hayami.html', ['mj.hayami.v1', '{oops']);
  ok('早見 JSON でない値でも表が出る', (await cellText(b2.p, 30, 1)) === '1,000');
  ok(`早見 壊れた値で落ちない（${[...b.errs, ...b2.errs].join(' | ')}）`, b.errs.length + b2.errs.length === 0);
  await b.ctx.close(); await b2.ctx.close();
}

async function machi() {
  const { p, ctx, errs } = await open('machi.html');
  ok('待ち 4人の牌の選びは34', (await p.$$('#kb button[data-c]')).length === 34);
  await tap(p, split('1m1m1m2m3m4m5m6m7m8m9m9m9m'));
  ok('待ち 手牌 13/13', (await txt(p, '#hand-h')).includes('13/13'));
  ok('待ち 13枚が埋まると選びが押せない', await p.$eval('#kb button[data-c="5p"]', (e) => e.disabled));
  const r1 = await txt(p, '#result');
  ok(`待ち 九蓮＝聴牌 9種23枚（${r1.slice(0, 30)}）`, r1.includes('聴牌') && r1.includes('9種 23枚'));
  ok('待ち 九蓮の待ちの行は9本', (await p.$$('#result .wrow')).length === 9);
  // 見えている牌に 1m を1枚入れる→1m は残り0・22枚
  await press(p, 'seg-target', 'seen');
  await tap(p, ['1m']);
  ok('待ち 見えている牌 1枚', (await txt(p, '#seen-h')).includes('1枚'));
  ok('待ち 見えている 1m を引いて 9種22枚', (await txt(p, '#result')).includes('9種 22枚'));
  ok('待ち 1m は4枚使ったので押せない', await p.$eval('#kb button[data-c="1m"]', (e) => e.disabled));
  await p.click('#clear-seen');
  ok('待ち 見えている牌を全部消すと 23枚に戻る', (await txt(p, '#result')).includes('9種 23枚') && (await txt(p, '#seen-h')).includes('0枚'));
  // 手牌を押して外す（先頭の 1m）
  await p.click('#hand button[data-k="0"]');
  ok('待ち 手牌を押すと1枚外れる（12/13）', (await txt(p, '#hand-h')).includes('12/13'));
  // 読み直しで残る
  await p.reload(); await p.waitForSelector('#kb button', { timeout: 5000 });
  ok('待ち 読み直しても手牌 12/13 のまま', (await txt(p, '#hand-h')).includes('12/13'));
  // 3人：2〜8萬が消え、手の 2〜8萬も落ちる
  await p.$eval('details.card', (d) => { d.open = true; });
  await p.selectOption('#r-players', '3');
  ok('待ち 3人は牌の選びが27（2〜8萬なし）', (await p.$$('#kb button[data-c]')).length === 27 && !(await p.$('#kb button[data-c="5m"]')));
  ok('待ち 3人にすると手の 2〜8萬が落ちる（1m1m9m9m9m＝5/13）', (await txt(p, '#hand-h')).includes('5/13'));
  await p.selectOption('#r-players', '4');
  await p.click('#clear-hand');
  ok('待ち 手牌を全部消すと 0/13 と案内', (await txt(p, '#hand-h')).includes('0/13') && (await txt(p, '#result')).includes('下の牌を押して'));
  // 14枚：中を切って 3s6s 待ち（2種8枚）
  await press(p, 'seg-target', 'hand');
  await press(p, 'seg-mode', '14');
  await tap(p, split('1m2m3m4p5p6p7s8s9s1z1z4s5s7z'));
  ok('待ち 手牌 14/14', (await txt(p, '#hand-h')).includes('14/14'));
  const top = await p.$eval('#result .drow', (e) => ({ t: e.querySelector('svg title, [aria-label]') ? '' : '', s: e.innerText })).catch(() => null);
  const firstName = await p.$eval('#result .drow', (e) => e.innerHTML.includes('中')).catch(() => false);
  ok(`待ち 14枚の一番上は中を切る→聴牌 待ち 2種8枚（${top && top.s}）`, !!top && firstName && top.s.includes('聴牌 待ち 2種 8枚'));
  await press(p, 'seg-mode', '13');
  ok('待ち 13枚に戻すと手牌は13枚に切られる', (await txt(p, '#hand-h')).includes('13/13'));
  const hs = await p.$$eval('.seg button, .opts select, details.card > summary', (es) => es.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(`待ち 押す所の高さが 44 以上（${hs.join(',')}）`, hs.length >= 6 && hs.every((h) => h >= 44));
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(`待ち 横にはみ出さない（${sw}）`, sw <= 390);
  ok(`待ち 落ちない（${errs.join(' | ')}）`, errs.length === 0);
  await ctx.close();
  // 壊れた localStorage：知らない字・5枚目・枚数の越え・形の違う値
  const b = await open('machi.html', ['mj.machi.v1', JSON.stringify({ mode: '99', target: 'x', players: 'abc', hand: ['1m', '1m', '1m', '1m', '1m', 'zz', 3, '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '1s', '2s', '3s'], seen: 'oops' })]);
  ok('待ち 壊れた値＝13枚に戻り・5枚目と知らない字を落として 13/13', (await txt(b.p, '#hand-h')).includes('13/13'));
  ok('待ち 壊れた値＝4人に戻る（選び34）', (await b.p.$$('#kb button[data-c]')).length === 34);
  ok('待ち 壊れた値＝見えている牌なし', (await txt(b.p, '#seen-h')).includes('0枚'));
  const b3 = await open('machi.html', ['mj.machi.v1', JSON.stringify({ players: '3', hand: ['1m', '5m', '9m'], seen: ['2m', '1p'] })]);
  ok('待ち 3人で覚えた手の 2〜8萬は読む時に落ちる（2/13・見えている 1枚）', (await txt(b3.p, '#hand-h')).includes('2/13') && (await txt(b3.p, '#seen-h')).includes('1枚'));
  await b3.ctx.close();
  const b2 = await open('machi.html', ['mj.machi.v1', '{oops']);
  ok('待ち JSON でない値でも選びが出る', (await b2.p.$$('#kb button[data-c]')).length === 34);
  ok(`待ち 壊れた値で落ちない（${[...b.errs, ...b2.errs].join(' | ')}）`, b.errs.length + b2.errs.length === 0);
  await b.ctx.close(); await b2.ctx.close();
}

async function run() {
  bad.length = 0; n = 0;
  for (const [nm, fn] of [['早見表', hayami], ['待ち読み', machi]]) {
    try { await fn(); } catch (e) {
      if (e === STOP) break;
      bad.push(`${nm} の途中で止まった（${String(e.message).split(String.fromCharCode(10))[0]}）`);
      if (fast) break;
    }
  }
  for (const c of browser.contexts()) await c.close().catch(() => {});
  return bad.slice();
}

// 壊し：1つごとに上のどれかが赤になる事（作業木は触らず、配る字だけ替える）
const BREAKS = [
  ['js/hayami.js', '${f(p.ko)}<br>${f(p.oya)}', '${f(p.oya)}<br>${f(p.ko)}', '子ツモの上下を入れ替える'],
  ['js/hayami.js', 'if (!ALLOWED[k].includes(st[k])) st[k] = DEF[k];', '', '早見の端末の値の守りを外す'],
  ['js/hayami.js', "kiriage: st.kiriage === '1'", 'kiriage: false', '切り上げの選びを繋がない'],
  ['js/hayami.js', 'tsumo3: st.tsumo3,', "tsumo3: 'son',", '3人折半を繋がない'],
  ['lib/score-table.mjs', 'const ko = sec ? c100(k4 + k4 / 2) : k4;', 'const ko = sec ? c100(k4 * 1.5) + 100 : k4;', '折半の子の払いを壊す'],
  ['css/app.css', 'flex: 1; min-height: 44px;', 'flex: 1; min-height: 40px; height: 40px;', '切り替えの高さを 40 にする'],
  ['js/machi.js', ".filter(ok).slice(0, +st.mode);", ';', '待ちの端末の値の守りを外す'],
  ['js/machi.js', 'if (!exists(i, players())) return', 'if (false) return', '3人で 2〜8萬を消さない'],
  ['js/machi.js', ' || !exists(i, +st.players)) return false;', ') return false;', '3人で覚えた 2〜8萬を読む時に落とさない'],
  ['js/machi.js', '.splice(+b.dataset.k, 1); save(); render(); });\n$(\'seen\')', '.splice(+b.dataset.k, 0); save(); render(); });\n$(\'seen\')', '手牌を押しても外れない'],
  ['js/machi.js', "$('clear-hand').addEventListener('click', () => { st.hand = [];", "$('clear-hand').addEventListener('click', () => {", '手牌の全部消すが効かない'],
  ['js/machi.js', 'else st.seen.push(c);', 'else st.hand.push(c);', '見えている牌に入らない'],
  ['js/machi.js', 'localStorage.setItem(KEY,', "localStorage.setItem('x' + KEY,", '端末に覚えない'],
  ['js/machi.js', 'if (k === \'mode\' && st.hand.length > max()) st.hand = st.hand.slice(0, max());', '', '13枚に戻しても切らない'],
  ['lib/shanten.mjs', null, null, '待ちの残り枚数を1枚ずらす'],
];

if (!SELF) {
  const b = await run();
  for (const x of b) console.log('  ✗ ' + x);
  console.log(b.length ? `✗ 画面の試験 ${b.length}/${n} 件が違う` : `✓ 画面の試験 ${n} 件（早見表・待ち読み・webkit 390×844）`);
  await shut();
  process.exit(b.length ? 1 : 0);
}

let red = 0;
const base = await run();
if (base.length) { console.log(`✗ 自己確認の前に、壊さない時が赤（${base.join(' / ')}）`); }
for (const [file, from0, to0, what] of BREAKS) {
  let from = from0, to = to0;
  if (from === null) { // shanten.mjs の残り枚数の式：中身を読んで「left:」の所を探す
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = src.match(/left: (remaining\([^)]*\))/); // 括弧の中のコンマで切らない（11-20 taiketsu 任意1）
    if (!m) { console.log(`  ✗ 壊しの場所が無い：${what}`); continue; }
    from = m[0]; to = `left: (${m[1]}) + 1`;
  }
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'); // 手元の autocrlf でも壊しの字を見つける
  if (!src.includes(from)) { console.log(`  ✗ 壊しの字が ${file} に無い（${what}）＝壊しを直す`); continue; }
  mutate = { file, from, to }; fast = true;
  const b = await run();
  mutate = null; fast = false;
  if (b.length) { red++; console.log(`  ✓ ${what} → 赤 ${b.length}（${b[0]}）`); } else console.log(`  ✗ ${what} でも緑のまま`);
}
const all = base.length ? 0 : red;
console.log(`自己確認: ${all}/${BREAKS.length}`);
await shut();
process.exit(!base.length && red === BREAKS.length ? 0 : 1);
