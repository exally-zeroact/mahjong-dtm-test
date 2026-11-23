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
    // 字のファイルは LF にそろえて配る（repo・Vercel・CI と同じ中身＝sw.js の名簿の sha が合い、手元でも SW が効く・件3）
    if (!/\.(png|ico|jpe?g|webp|woff2?)$/i.test(rel)) d = Buffer.from(d.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (mutate && rel === mutate.file) d =Buffer.from(d.toString('utf8').replace(/\r\n/g, '\n').split(mutate.from).join(mutate.to));
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

// 点数計算（tensu.html・件4c）：絵 dougu_v153 ① の手（立直・平和・ドラ1＝3翻30符 3,900）と、ルールの帯・戻り先・端末の値・包・本場・3人
const R4 = { players: 4, kuitan: true, aka: 3, double_yakuman: true, renpu_fu: 4, kiriage: false, kazoe: 'yakuman', tsumo3: 'son', honba: 300, kita: 'none', pao: true };
const tq = (r, from) => 'tensu.html?' + (r === undefined ? '' : 'r=' + encodeURIComponent(typeof r === 'string' ? r : JSON.stringify(r))) + (from === undefined ? '' : '&from=' + encodeURIComponent(from));
const HAND = '2m3m4m5m6m7m2p3p4p6s7s9p9p8s';
async function tensu() {
  const { p, ctx, errs } = await open(tq(R4, '/taikyoku.html?t=1'));
  ok('点数 4人の牌の選びは34', (await p.$$('#kb button[data-c]')).length === 34);
  ok('点数 11鍵そろい＝帯なし', await p.$eval('#obi', (e) => e.hidden));
  ok('点数 戻り先＝/taikyoku.html?t=1', (await p.getAttribute('#back', 'href')) === '/taikyoku.html?t=1' && (await txt(p, '#back')).includes('対局'));
  await p.click('.chip[data-k="riichi"][data-v="1"]');
  await p.click('#dora-card'); await tap(p, ['7s']);
  ok('点数 ドラ表示 7索→ドラ 8索', (await txt(p, '#dora-to')).includes('8索'));
  await p.click('#hand-h');
  await tap(p, split(HAND));
  ok('点数 14枚で鍵盤が押せない', await p.$eval('#kb button[data-c="1m"]', (e) => e.disabled));
  ok('点数 最後の牌に和了の枠', (await p.$$('#hand .tbtn.win')).length === 1 && await p.$eval('#hand .tbtn:last-child', (e) => e.classList.contains('win')));
  ok(`点数 子ロン 3翻30符 3,900（${(await txt(p, '#result')).slice(0, 20)}）`, (await txt(p, '#hanfu')).includes('3翻 30符') && (await txt(p, '#pts')) === '3,900');
  const y = await txt(p, '#yaku');
  ok('点数 役＝立直・平和・ドラ', ['立直', '平和', 'ドラ'].every((s) => y.includes(s)));
  ok('点数 符の内訳＝副底20・門前ロン10', (await txt(p, '#fu')).includes('門前ロン') && (await txt(p, '#fu')).includes('20符'));
  const [a, b2] = await p.$$eval('#yaku > span', (s) => [s[0].getBoundingClientRect().top, s[2].getBoundingClientRect().top]);
  ok('点数 役は2列（立直と平和が同じ行）', Math.abs(a - b2) < 1);
  ok('点数 払いの箱は本場0・包なしで出さない', !(await p.$('#pay')));
  await p.click('.chip[data-k="agari"][data-v="tsumo"]');
  ok('点数 子ツモ 4翻20符 1,300-2,600', (await txt(p, '#pts')) === '1,300-2,600');
  await p.click('.chip[data-k="oya"][data-v="oya"]');
  ok('点数 親を押すと自風 東', (await txt(p, '#jikaze')).includes('東'));
  ok('点数 親ツモ 2,600オール', (await txt(p, '#pts')) === '2,600オール');
  await p.click('.chip[data-k="agari"][data-v="ron"]');
  ok('点数 親ロン 5,800', (await txt(p, '#pts')) === '5,800');
  await p.click('.chip[data-k="oya"][data-v="ko"]');
  ok('点数 子に戻すと自風 南', (await txt(p, '#jikaze')).includes('南'));
  // 押す所の高さ（チップ 14px→36）・はみ出し0・包「なし」なら包の選びを出さない
  await p.click('#more summary');
  const lay = await p.evaluate(() => { const o = []; const W = document.documentElement.clientWidth; for (const e of document.querySelectorAll('button, select, summary, a')) { const r = e.getBoundingClientRect(); if (!r.width) continue; if (r.right > W + 0.5) o.push('はみ出し ' + (e.id || e.textContent.trim().slice(0, 6))); if (!e.closest('#kb,#hand,#melds,#dora,#ura') && r.height < (parseFloat(getComputedStyle(e).fontSize) >= 16 ? 44 : 36) - 0.5) o.push('低い ' + (e.id || e.textContent.trim().slice(0, 6)) + ' ' + Math.round(r.height)); } return o; });
  ok(`点数 高さ・はみ出し（${lay.slice(0, 3).join('・')}）`, lay.length === 0);
  ok('点数 チップ6つが1段', new Set(await p.$$eval('#chips .chip', (s) => s.map((e) => Math.round(e.getBoundingClientRect().top)))).size === 1);
  ok('点数 包なしなら包の選びを出さない', !(await p.isVisible('#pao-same')) && !(await p.isVisible('#pao-who')));
  // 本場1＝払いの箱に 4,200
  await p.click('button[data-s="honba"][data-d="1"]');
  ok('点数 1本場 受け取り計 4,200', (await txt(p, '#pay')).includes('4,200'));
  // ドラの札を2度押すと最後の1枚を外す（1本場のまま＝子ロン 2翻30符 2,000）
  await p.click('#dora-card'); await p.click('#dora-card');
  ok('点数 ドラを2度押すと外れる', (await p.$$('#dora .tbtn')).length === 0 && (await txt(p, '#pts')) === '2,000');
  // 手牌を押すと外れる→残りの字
  await p.click('#hand .tbtn:last-child');
  ok('点数 和了牌を外すと「あと 1 枚」', (await txt(p, '#result')).includes('あと 1 枚'));
  // 端末に覚える（読み直しで手が残る）
  await p.reload(); await p.waitForSelector('#kb button');
  ok('点数 読み直しで手が残る（13枚）', (await p.$$('#hand .tbtn')).length === 13);
  ok(`点数 画面の誤り0（${errs.join(' / ').slice(0, 80)}）`, errs.length === 0);
  await ctx.close();

  // 和了牌＝最後に入れた牌（任意a）：3p 嵌張＝立直・ドラ1 2翻40符 2,600（最初の 2m を和了牌にすると平和がつき 3,900）
  {
    const c = await open(tq(R4));
    await c.p.click('.chip[data-k="riichi"][data-v="1"]');
    await c.p.click('#dora-card'); await tap(c.p, ['7s']); await c.p.click('#hand-h');
    await tap(c.p, split('2m3m4m5m6m7m2p4p6s7s8s9p9p3p'));
    ok(`点数 和了牌＝最後の 3p 嵌張 2,600（${await txt(c.p, '#pts')}）`, (await txt(c.p, '#pts')) === '2,600' && (await txt(c.p, '#hanfu')).includes('40符'));
    await c.ctx.close();
  }
  // 卓の rules 44鍵まるごと（対局の［点数］の口）＝帯なし・from は ?room= を残す
  {
    const full3 = JSON.parse(JSON.stringify((await import('../../lib/rules.mjs')).defaultRules(3)));
    const c = await open(tq(full3, '/taikyoku.html?room=x1'));
    ok('点数 44鍵の3人＝帯なし・鍵盤27', await c.p.$eval('#obi', (e) => e.hidden) && (await c.p.$$('#kb button[data-c]')).length === 27);
    ok('点数 from=/taikyoku.html?room=x1 を残す', (await c.p.getAttribute('#back', 'href')) === '/taikyoku.html?room=x1');
    await c.ctx.close();
  }
  // 点数計算の CSS は body.tensu の時だけ（止め2・対局の .chips 等を変えない）＝配った中身を読む（壊しが効くように）
  {
    const css = (await (await fetch(BASE + 'css/app.css')).text()).replace(/\r\n/g, '\n');
    const k = css.indexOf('/* ── 点数計算（tensu.html');
    const sels = k < 0 ? [] : css.slice(k).split('\n').slice(1).filter((l) => l.includes('{')).flatMap((l) => l.split('{')[0].split(','));
    const out = sels.filter((x) => !x.trim().startsWith('body.tensu '));
    ok(`点数 CSS の選び ${sels.length} 本が全部 body.tensu（外れ ${out.slice(0, 2).join('・')}）`, sels.length >= 20 && out.length === 0);
  }
  // 帯：?r= 無し・壊れ・落ちる・欠け
  for (const [r, want, what] of [[undefined, '既定のルール（4人）', '無し'], ['{oops', '既定のルール（4人）', '壊れ'], [{ players: 5 }, '既定のルール（4人）', '落ちる'], [{ players: 4 }, '一部のルールが既定', '欠け']]) {
    const c = await open(tq(r));
    ok(`点数 ?r= ${what}＝帯「${want}」`, !(await c.p.$eval('#obi', (e) => e.hidden)) && (await txt(c.p, '#obi')).includes(want));
    await c.ctx.close();
  }
  // 戻り先：外・壊れ・別の道は ホーム／同じ origin の絶対は組み直す／/r/<token>
  const okTok = '/r/' + '0123456789abcdef'.repeat(2) + '?x=1';
  for (const [f, want] of [['//evil.example/taikyoku.html', 'index.html'], ['/\\evil.example/taikyoku.html', 'index.html'], ['%2F%2Fevil.example/taikyoku.html', 'index.html'], ['/\t/evil.example/taikyoku.html', 'index.html'], ['/\ttaikyoku.html', '/taikyoku.html'], ['/index.html?x', 'index.html'], ['/r/ABC', 'index.html'], ['javascript:alert(1)', 'index.html'], [okTok, okTok], ['@SELF/taikyoku.html?t=2', '/taikyoku.html?t=2']]) {
    const c = await open(tq(R4, f.replace('@SELF/', BASE)));
    ok(`点数 from=${JSON.stringify(f)} → ${want}`, (await c.p.getAttribute('#back', 'href')) === want);
    await c.ctx.close();
  }
  // 壊れた端末の値：読めない牌・多すぎ・変な鍵は落として動く
  const bad1 = await open(tq(R4), ['mj.tensu.v1', JSON.stringify({ agari: 'x', riichi: 9, jikaze: '8z', hand: ['1m', '1m', '1m', '1m', '1m', 'zz', 3, '0m', '8sXYZ', ...split('2p3p4p5p6p7p8p9p1s2s3s4s5s')], dora: 'x', melds: [{ kind: 'pon', tiles: ['1m', '1m'] }], aka: 99, pao: 'x' })]);
  const hn = (await bad1.p.$$('#hand .tbtn')).length;
  const n1m = (await bad1.p.$$('#hand button[aria-label="1萬を外す"]')).length;
  ok(`点数 壊れた端末の値を落とす（手 ${hn}・1萬 ${n1m}＝5枚目を落として4）`, hn === 14 && n1m === 4 && (await txt(bad1.p, '#jikaze')).includes('南'));
  ok('点数 長い牌の字（8sXYZ）は落とす', (await bad1.p.$$('#hand button[aria-label="8索を外す"]')).length === 0);
  ok(`点数 壊れた端末の値で誤り0（${bad1.errs.join(' / ').slice(0, 80)}）`, bad1.errs.length === 0);
  await bad1.ctx.close();
  const bad2 = await open(tq(R4), ['mj.tensu.v1', '{oops']);
  ok('点数 読めない端末の値でも開く', (await bad2.p.$$('#kb button[data-c]')).length === 34 && bad2.errs.length === 0);
  await bad2.ctx.close();
  // 包なしのルール・3人
  const np = await open(tq({ ...R4, pao: false }));
  ok('点数 pao=false で包を出さない', await np.p.$eval('#pao-box', (e) => e.hidden));
  await np.ctx.close();
  const s3 = await open(tq({ ...R4, players: 3, kita: 'nuki', aka: 2 }), ['mj.tensu.v1', JSON.stringify({ melds: [{ kind: 'chi', tiles: ['1p', '2p', '3p'] }, { kind: 'pon', tiles: ['5p', '5p', '5p'] }] })]);
  ok('点数 3人で覚えたチーは落とす・ポンは残す', (await s3.p.$$('#melds .tbtn')).length === 1);
  ok('点数 3人の牌の選びは27（2〜8萬なし）', (await s3.p.$$('#kb button[data-c]')).length === 27);
  await s3.p.click('#more summary');
  ok('点数 3人はチーを出さない・北抜きを出す', !(await s3.p.isVisible('#meld-kinds [data-t="chi"]')) && !!(await s3.p.$('#v-kita')));
  await s3.p.click('#jikaze'); await s3.p.click('#jikaze');
  ok('点数 3人の自風は北を飛ばす（南→西→東）', (await txt(s3.p, '#jikaze')).includes('東'));
  await s3.ctx.close();
}

// ルールの画面の数字鍵盤（A8・tataki/a8_sadame_v1.md）＝端末の鍵盤を出さない・ウマの［±］無し・− はウマだけ・チップは小数1桁
async function rulesKp() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE + 'taikyoku.html');
  await p.evaluate(async () => {
    const m = await import('/js/gamen-rules.mjs'); const R = await import('/lib/rules.mjs');
    document.body.innerHTML = '<main><div id="x"></div></main>';
    window.__c = m.mountRules(document.getElementById('x'), { rules: { ...R.defaultRules(4), rate: 100 } });
  });
  await p.click('[data-open="uma"]');
  ok('ルール ウマの［±］が 0個', (await p.locator('.uma-pm').count()) === 0);
  const bx = await p.locator('#x input.box').evaluateAll((xs) => xs.map((x) => x.readOnly && x.inputMode === 'none'));
  ok('ルール 箱は全部 readonly・inputmode none（8箱以上）', bx.length >= 8 && bx.every(Boolean));
  await p.click('[data-uma="1"]');
  for (const k of ['neg', '1', '0']) await p.click(`#x .kp [data-kp="${k}"]`);
  ok('ルール ウマ2位に 入ってすぐ − 1 0 → −10', (await p.inputValue('[data-uma="1"]')) === '−10');
  await p.click('#x .kp [data-kp="next"]');
  ok('ルール ↓ で次の箱（3位）', await p.evaluate(() => document.activeElement && document.activeElement.dataset.uma === '2'));
  await p.click('[data-uma="3"]');
  await p.click('#x .kp [data-kp="next"]');
  ok('ルール ↓ で鍵の並びが替わる箱（ウマ4位→チップ）へ移っても描き直さず focus が残る', await p.evaluate(() => document.activeElement && document.activeElement.id === 'rChip'));
  await p.click('#x .kp [data-kp="ok"]');
  await p.click('#rRate');
  ok('ルール レートで − は押せない', await p.locator('#x .kp [data-kp="neg"]').isDisabled());
  await p.click('#rChipOn');
  await p.click('#rChip');
  for (const k of ['2', 'dot', '5']) await p.click(`#x .kp [data-kp="${k}"]`);
  await p.click('#x .kp [data-kp="ok"]');
  const r = await p.evaluate(() => window.__c.read());
  ok('ルール read() の uma[1] −10・chip_pt10 25（鍵盤を開いたまま入切を押せる）', r.uma[1] === -10 && r.chip_pt10 === 25);
  await ctx.close();
}

async function run() {
  bad.length = 0; n = 0;
  for (const [nm, fn] of [['早見表', hayami], ['待ち読み', machi], ['点数計算', tensu], ['ルールの鍵盤', rulesKp]]) {
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
  ["js/tensu.js","tsumo: st.agari === 'tsumo',","tsumo: false,","ツモを式に繋がない"],
  ["js/tensu.js","if (v === 'oya') st.jikaze = '1z';","if (v === 'oya') st.jikaze = '2z';","親を押しても自風が東にならない"],
  ["js/tensu.js","if (SCORE_KEYS.some(","if (false && SCORE_KEYS.some(","ルールの欠けで帯を出さない"],
  ["js/tensu.js","(u.pathname === '/taikyoku.html' || (m && TOKEN_RE.test(m[1])))","true","戻り先の道を見ない"],
  ["js/tensu.js","$('back').href = u.pathname + u.search;","$('back').href = f;","戻り先を組み直さない"],
  ["js/tensu.js","st.hand = (Array.isArray(st.hand) ? st.hand : []).filter(take).slice(0, 14 - 3 * st.melds.length);","","点数の端末の値の守りを外す"],
  ["js/tensu.js","if (target === t && st[t].length) st[t].pop(); else target = t;","target = t;","ドラを2度押しても外れない"],
  ["js/tensu.js","if (st.honba || st.kyotaku || input().pao)","if (st.kyotaku || input().pao)","本場で払いの箱を出さない"],
  ["js/tensu.js","localStorage.setItem(KEY,","localStorage.setItem('x' + KEY,","点数の手を端末に覚えない"],
  ["js/tensu.js","if (!exists(i, P)) return '';","if (false) return '';","3人で 2〜8萬を鍵盤から消さない"],
  ["js/tensu.js","for (const id of ['bakaze', 'jikaze'])","for (const id of ['bakaze'])","自風が回らない"],
  ["css/app.css","body.tensu .chips[hidden] { display: none; }\n","","包の選びの隠しが効かない"],
  ["css/app.css","body.tensu .yk2 { grid-template-columns: 1fr auto 1fr auto; column-gap: 16px; }\n","","役を2列にしない"],
  ["css/app.css","min-height: 36px; padding: 0 12px; font: inherit; font-size: 14px; border: 1px solid var(--c-sen); border-radius: 18px;","min-height: 30px; height: 30px; padding: 0 12px; font: inherit; font-size: 14px; border: 1px solid var(--c-sen); border-radius: 18px;","チップの高さを 30 にする"],
  ["css/app.css",".chip { position: relative; min-height: 36px; padding: 0 12px;",".chip { position: relative; min-height: 36px; padding: 0 24px;","チップが2段に折れる"],
  ["js/tensu.js","if (n[i] >= 4) return false; n[i]++;","n[i]++;","端末の値の4枚の上限を外す"],
  ["js/tensu.js","win: st.hand[st.hand.length - 1],","win: st.hand[0],","和了牌を最後の牌にしない"],
  ["js/tensu.js","typeof c === 'string' && c.length === 2 ?","typeof c === 'string' ?","長い牌の字を落とさない"],
  ["js/tensu.js"," && !(P === 3 && m.kind === 'chi')","","3人で覚えたチーを落とさない"],
  ["css/app.css","body.tensu .chips { display: flex;",".chips { display: flex;","点数の CSS を全部の画面に効かせる"],
  ['lib/shanten.mjs', null, null, '待ちの残り枚数を1枚ずらす'],
  ['js/kenban.mjs', "if (fresh) { neg = fresh === 'neg';", "if (fresh) { neg = false;", 'ルール 入ってすぐの − を数の符号にしない'],
  ['js/kenban.mjs', "const close = (keepSp) => { const x = inp; inp = null; kp.hidden = true; if (sp && !keepSp) sp.hidden = true;", "const close = (keepSp) => { const x = inp; inp = null; kp.hidden = true; if (sp) sp.hidden = true;", 'ルール 箱から外れて閉じる時に下の空きを消す（入切が押せない）'],
  ['js/kenban.mjs', "kp.addEventListener('click', (ev) => { ev.stopPropagation();", "kp.addEventListener('click', (ev) => {", 'ルール 鍵の click を外へ出す（↓ で描き直して focus が飛ぶ）'],
];

if (!SELF) {
  const b = await run();
  for (const x of b) console.log('  ✗ ' + x);
  console.log(b.length ? `✗ 画面の試験 ${b.length}/${n} 件が違う` : `✓ 画面の試験 ${n} 件（早見表・待ち読み・点数計算・ルールの鍵盤・webkit 390×844）`);
  if (!b.length) console.log('KEKKA ' + JSON.stringify({ passed: n, failed: 0, mimiso: 0 }));
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
