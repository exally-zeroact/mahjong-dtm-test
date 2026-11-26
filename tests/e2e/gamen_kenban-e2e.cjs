// 点を入れる画面の残り（gamen_nokori_sadame.md）＋アプリの数字鍵盤（gamen_kenban_sadame.md）の自己確認。node gamen_kenban-e2e.cjs <作業木> [--self] [--chromium]
// ★A17 用（258afa1 の js/kenban.mjs）＝鍵盤の壊し9件を kenban.mjs へ。A17 を入れる push で gamen_kenban-e2e.cjs をこれに差し替える★
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test'] }));
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="bar"></div><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const p = new URLSearchParams(location.search);
const R = { ...defaultRules(p.get('n') === '3' ? 3 : 4), rate: 100, chip_pt10: 20, shugi_pt10: null, ...(p.get('k') ? { kyotaku_end: 'kieru' } : {}), ...(p.get('notobi') ? { tobi: false } : {}) };
let st = emptyState(); st.rules = R;
const ops = [
  { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
  { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
  { op: 'member_add', member_id: 'm5', name: '伊藤' },
  { op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 100 },
  { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
];
if (p.get('h') === '1' || p.get('h') === 'void') ops.push({ op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] });
if (p.get('h') === 'void') ops.push({ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -1 });
let r = applyOps(st, ops, { roomRules: R, now: '2026-11-21T00:00:00Z' });
if (r.ok && p.get('h') === 'void') r = applyOps(r.state, [{ op: 'hanchan_void', hanchan_id: 'h1' }], { roomRules: R, now: '2026-11-21T00:00:01Z' });
if (!r.ok) document.body.dataset.err = JSON.stringify(r.res);
localStorage.clear();
localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
const S = { ok: { table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'] }, n3: { table_id: 't1', seats: ['m1', 'm2', 'm3'] }, ghost: { table_id: 't1', seats: ['m1', 'm2', 'm3', 'mx'] }, other: { table_id: 't9', seats: ['m1', 'm2', 'm3', 'm4'] }, dup: { table_id: 't1', seats: ['m1', 'm1', 'm3', 'm4'] } }[p.get('seats')];
// B1（b1_sadame_v2.md v2.1）：卓の席の正本は写しの t.seats（前の mj-seats は使わない）＝S を写しの卓に直に置く（ghost/dup は op が弾くので直に・other は卓が無い＝席なし）
if (S) { const t = r.state.tables.find((x) => x.table_id === S.table_id); if (t) t.seats = S.seats.slice(); localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state)); }
window.bars = [];
mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar(b) { window.bars.push(b.title); document.getElementById('bar').textContent = b.title; }, page: 'room' });
document.body.dataset.ready = '1';
</script>`;
let mutate = null;
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__h.html') { r.writeHead(200, { 'content-type': MT['.html'] }); r.end(H); return; }
  const f = path.join(ROOT, u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  let b = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (mutate && f.endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'text/plain' }); r.end(b);
});
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000);
  const open = async (qs) => { await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]'); const e = await pg.getAttribute('body', 'data-err'); if (e) throw new Error('台の op が弾かれた ' + e); };
  const heads = () => pg.$$eval('.r-hyou thead .r-nm', (xs) => xs.map((x) => x.textContent));
  try {
    const sum = () => pg.textContent('#eSum');
    const ph = () => pg.$$eval('[data-c]', (xs) => xs.map((x) => x.placeholder));
    const box = (i) => pg.locator('[data-c="' + i + '"]');
    const kpk = (k) => pg.click('#eKp [data-kp="' + k + '"]');
    // 箱を押して鍵盤で打つ（先に ⌫ で空にする・'-' は − の鍵）
    const put = async (i, v) => {
      const b = typeof i === 'string' ? pg.locator(i) : box(i);
      await b.click();
      for (let j = 0; j < 9; j++) await kpk('bs');
      for (const ch of String(v)) await kpk(ch === '-' ? 'neg' : ch);
    };
    // A 何も入れていない
    await open('seats=ok'); await pg.click('#rAdd');
    ok('A 素点の合計 100,000 だけ', (await sum()).trim() === '素点の合計 100,000', await sum());
    ok('A 勧めは無い', (await ph()).every((x) => x === ''), await ph());
    // B 1人入れたら残り
    await put(0, '32000');
    ok('B 残り 68,000', (await sum()).includes('残り 68,000'), await sum());
    ok('B 勧めはまだ無い', (await ph()).every((x) => x === ''), await ph());
    // C 3人入れたら4人目に残りを薄く
    await put(1, '28000'); await put(2, '30000');
    ok('C 残り 10,000', (await sum()).includes('残り 10,000'), await sum());
    ok('C 4人目の箱だけに 10,000', JSON.stringify(await ph()) === JSON.stringify(['', '', '', '10,000']), await ph());
    if (process.env.SHOT && !SELF) await pg.screenshot({ path: process.env.SHOT, scale: 'css' });
    ok('C 押すまで値は空', (await box(3).inputValue()) === '');
    // D 押せば値になる・✓・pt
    await box(3).click();
    ok('D 値が 10,000', (await box(3).inputValue()) === '10,000', await box(3).inputValue());
    ok('D ✓ 素点の合計', (await pg.getAttribute('#eSum', 'class')).includes('ok') && (await sum()).includes('✓'), await sum());
    ok('D pt が出る', ((await pg.textContent('[data-p="3"]')) || '').trim() !== '');
    // E 打ち直せる・合わなければ赤で多い
    await put(3, '11000');
    ok('E 赤で 1,000 多い', (await pg.getAttribute('#eSum', 'class')).includes('bad') && (await sum()).includes('1,000 多い'), await sum());
    await put(3, '9000');
    ok('E 赤で 1,000 少ない', (await sum()).includes('1,000 少ない'), await sum());
    // F 100の倍数でない残りは勧めない
    await put(3, ''); await put(2, '30050');
    ok('F 残り 9,950 は出す', (await sum()).includes('残り 9,950'), await sum());
    ok('F 勧めは無い', (await ph()).every((x) => x === ''), await ph());
    // G 数でない箱（「-」だけ）が在れば勧めない
    await put(2, '-');
    ok('G 「-」だけの箱が在れば勧めない', (await ph()).every((x) => x === ''), await ph());
    // H 負の残り
    await put(0, '50000'); await put(1, '50000'); await put(2, '10000');
    ok('H 残り −10,000', (await sum()).includes('残り −10,000'), await sum());
    ok('H 勧め −10,000', (await ph())[3] === '−10,000', await ph());
    await box(3).click();
    ok('H 押せば ✓', (await sum()).includes('✓'), await sum());
    // I 入れれば保存は今まで通り
    await open('seats=ok'); await pg.click('#rAdd');
    await put(0, '32000'); await put(1, '28000'); await put(2, '30000'); await box(3).click(); await kpk('ok'); await pg.click('#eOk');
    const hs = await pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r1')).hanchans);
    ok('I 半荘1つ・素点そのまま', hs.length === 1 && hs[0].cells.join() === '32000,28000,30000,10000', hs.map((h) => h.cells));
    // J 消えた供託で残りが変わる
    await open('seats=ok&k=1'); await pg.click('#rAdd');
    await put(0, '30000'); await put(1, '30000'); await put(2, '30000');
    ok('J 供託0で 10,000', (await ph())[3] === '10,000', await ph());
    await put('#eLost', '1000');
    ok('J 供託1,000で 9,000', (await ph())[3] === '9,000' && (await sum()).includes('残り 9,000'), { ph: await ph(), s: await sum() });
    // K 3人打ち
    await open('n=3&seats=n3'); await pg.click('#rAdd');
    await put(0, '40000'); await put(1, '40000');
    ok('K 3人で 25,000', JSON.stringify(await ph()) === JSON.stringify(['', '', '25,000']) && (await sum()).includes('105,000'), { ph: await ph(), s: await sum() });
    // L 鍵盤（司さん 18:26：3人で 70,000＋78,000・残りは −／夜「キーボードだしたらよかろが」「＋はいらん」）
    await open('n=3&seats=n3&notobi=1');
    ok('L 対局の押しに＋が無い', !(await pg.textContent('#rAdd')).includes('＋'), await pg.textContent('#rAdd'));
    await pg.click('#rAdd');
    ok('L ［±］は無い・＋の鍵も無い', (await pg.locator('.r-er-pm, [data-neg]').count()) === 0 && !(await pg.locator('#eKp').textContent()).includes('＋'));
    ok('L 鍵盤は箱を押すまで出ない', await pg.locator('#eKp').isHidden());
    const ro = await box(0).evaluate((x) => ({ ro: x.readOnly, im: x.inputMode }));
    ok('L 箱は readonly・inputmode none', ro.ro === true && ro.im === 'none', ro);
    await box(0).click();
    ok('L 押すと鍵盤が出る', await pg.locator('#eKp').isVisible());
    const keys = await pg.$$eval('#eKp [data-kp]', (xs) => xs.map((x) => x.dataset.kp));
    ok('L 並び 1 2 3 ⌫ / 4 5 6 − / 7 8 9 ↓ / 000 0 ✓', keys.join() === '1,2,3,bs,4,5,6,neg,7,8,9,next,000,0,ok', keys);
    const ks = await pg.locator('#eKp [data-kp="5"]').evaluate((b) => ({ h: b.getBoundingClientRect().height, fs: getComputedStyle(b).fontSize }));
    ok('L 鍵の高さ60・字24px', ks.h === 60 && ks.fs === '24px', ks);
    const okw = await pg.locator('#eKp [data-kp="ok"]').evaluate((b) => b.getBoundingClientRect().width), k0w = await pg.locator('#eKp [data-kp="0"]').evaluate((b) => b.getBoundingClientRect().width);
    ok('L ✓ は2列', okw > k0w * 1.9, { okw, k0w });
    for (const k of ['1', '2', '000']) await kpk(k);
    ok('L 1→2→000 で 12,000', (await box(0).inputValue()) === '12,000', await box(0).inputValue());
    await kpk('bs');
    ok('L ⌫ で 1,200', (await box(0).inputValue()) === '1,200', await box(0).inputValue());
    await kpk('neg');
    ok('L − で −1,200', (await box(0).inputValue()) === '−1,200', await box(0).inputValue());
    await kpk('neg');
    ok('L もう一度で 1,200', (await box(0).inputValue()) === '1,200', await box(0).inputValue());
    await kpk('next');
    ok('L ↓ で次の箱へ', (await box(1).evaluate((x) => x === document.activeElement)) && (await pg.locator('#eKp').isVisible()));
    for (const k of ['7', '8', '000']) await kpk(k);
    ok('L 鍵を押しても箱から focus が外れない', await box(1).evaluate((x) => x === document.activeElement));
    await put(0, '70000');
    ok('L 残り −43,000・勧め −43,000', (await sum()).includes('残り −43,000') && (await ph())[2] === '−43,000', { s: await sum(), ph: await ph() });
    await box(2).click();
    ok('L 勧めの箱を押すと −43,000・✓', (await box(2).inputValue()) === '−43,000' && (await sum()).includes('✓'), await box(2).inputValue());
    await kpk('5');
    ok('L 押して入った後の数は置き換え', (await box(2).inputValue()) === '5', await box(2).inputValue());
    await kpk('bs'); await kpk('neg'); for (const k of ['4', '3', '000']) await kpk(k);
    ok('L 鍵で −43,000 → ✓', (await box(2).inputValue()) === '−43,000' && (await sum()).includes('✓'), { v: await box(2).inputValue(), s: await sum() });
    await pg.setViewportSize({ width: 390, height: 560 });
    const cover = await pg.evaluate(() => { const o = document.getElementById('eOk'); o.scrollIntoView({ block: 'nearest' }); const k = document.getElementById('eKp').getBoundingClientRect(); return { kTop: Math.round(k.top), oBot: Math.round(o.getBoundingClientRect().bottom) }; });
    ok('L 鍵盤が出ても［入れる］は鍵盤の上に出せる', cover.oBot <= cover.kTop, cover);
    const sp = await pg.evaluate(() => { const e = document.getElementById('eKpSp'), k = document.getElementById('eKp'); return { sp: e && !e.hidden ? Math.round(e.getBoundingClientRect().height) : 0, kp: Math.round(k.getBoundingClientRect().height) }; });
    ok('L 鍵盤が出ている間は下に鍵盤の高さの空き', sp.sp > 0 && sp.sp >= sp.kp - 1, sp);
    await pg.setViewportSize({ width: 390, height: 844 });
    if (process.env.SHOT2 && !SELF) await pg.screenshot({ path: process.env.SHOT2, scale: 'css' });
    await kpk('next');
    ok('L 最後の箱の ↓ で閉じる', await pg.locator('#eKp').isHidden());
    await box(1).click(); await kpk('ok');
    ok('L ✓ で閉じる', await pg.locator('#eKp').isHidden());
    // 机の鍵盤
    await box(1).click(); await pg.keyboard.press('Backspace'); await pg.keyboard.type('7'); await pg.keyboard.press('Backspace'); await pg.keyboard.type('8');
    ok('L 机の鍵盤で打ち直し 78,008', (await box(1).inputValue()) === '78,008', await box(1).inputValue());
    for (let j = 0; j < 3; j++) await pg.keyboard.press('Backspace');
    await pg.keyboard.type('000'); await pg.keyboard.press('Escape');
    ok('L 机の鍵盤 Escape で閉じる・78,000', (await box(1).inputValue()) === '78,000' && (await pg.locator('#eKp').isHidden()), await box(1).inputValue());
    // 合わないまま［入れる］＝差に + を付けない
    await put(1, '79000'); await kpk('ok'); await pg.click('#eOk');
    const er = await pg.textContent('#eErr');
    ok('L 合わない時は「1,000 多い」・+ なし', er.includes('1,000 多い') && !er.includes('+'), er);
    await put(1, '78000'); await kpk('ok');
    await pg.click('#eOk');
    const hs3 = await pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r1')).hanchans);
    ok('L 飛びなしで − のまま保存', hs3.length === 1 && hs3[0].cells.join() === '70000,78000,-43000', hs3.map((h) => h.cells));
    // M 飛びありでも − を受ける（B2 から受け取りの段は無い＝そのまま入る）
    await open('n=3&seats=n3'); await pg.click('#rAdd');
    await put(0, '70000'); await put(1, '78000'); await box(2).click(); await kpk('ok'); await pg.click('#eOk');
    const hsM = await pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r1')).hanchans);
    ok('M 飛びありは − のまま入る・受け取りの段に行かない', hsM.length === 1 && hsM[0].cells.some((v) => v < 0) && !((await pg.locator('#app').innerText()) || '').includes('飛びました'), hsM.map((h) => h.cells));
    const t = await pg.locator('#app').innerText();
    ok('K NaN の字が無い', !/NaN|undefined/.test(t));
  } finally { await ctx.close(); }
  return { pass, fail, bad };
}
(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (process.argv.includes('--chromium') ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br, port).catch((e) => ({ pass: 0, fail: 1, bad: ['例外 ' + String(e.message).split('\n')[0]] }));
    console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`kenban-e2e: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['残りを出さない', 'js/gamen-room.mjs', "(c.nums ? '・残り '", "(false ? '・残り '"],
    ['残りの符号が逆', 'js/gamen-room.mjs', '    const rest = want - got;', '    const rest = got - want;'],
    ['勧めを置かない', 'js/gamen-room.mjs', "const sugText = (c, i) => (c.sug === i ?", "const sugText = (c, i) => (false ?"],
    ['押しても値にしない', 'js/gamen-room.mjs', "      inp.addEventListener('focus',", "      inp.addEventListener('focusx',"],
    ['100の倍数でなくても勧める', 'js/gamen-room.mjs', ' && rest % 100 === 0', ''],
    ['字の箱も空と数える', 'js/gamen-room.mjs', 'nums === n - 1 && ', ''],
    ['多い少ないが逆', 'js/gamen-room.mjs', "(c.got > c.want ? ' 多い' : ' 少ない')", "(c.got > c.want ? ' 少ない' : ' 多い')"],
    ['供託の箱で変わらない', 'js/gamen-room.mjs', '    for (const inp of el.querySelectorAll("[data-c]")) inp.placeholder'.replace(/"/g, String.fromCharCode(39)), '    if (0) inp.placeholder'],
    ['端末の鍵盤を出す', 'js/kenban.mjs', "x.setAttribute('inputmode', 'none');", "x.setAttribute('inputmode', 'numeric');"],
    ['鍵盤を出さない', 'js/kenban.mjs', 'kp.hidden = false; if (sp)', 'if (sp)'],
    ['最初の数で置き換えない', 'js/kenban.mjs', "if (fresh) { neg = fresh === 'neg'; ip = ''; fp = null; }", ''],
    ['− の鍵が効かない', 'js/kenban.mjs', "} else if (key === 'neg') { if (spec.neg) neg = !neg; }", '}'],
    ['⌫ が効かない', 'js/kenban.mjs', 'else if (ip) ip = ip.slice(0, -1);', 'else if (ip) ip = ip;'],
    ['↓ が次へ行かない', 'js/kenban.mjs', 'if (j >= 0 && j + 1 < bs.length) bs[j + 1].focus(); else close();', 'close();'],
    ['鍵で focus が外れる', 'js/kenban.mjs', "kp.addEventListener('mousedown', (ev) => ev.preventDefault());", ''],
    ['勧めの − を半角に戻す', 'js/gamen-room.mjs', "const sugText = (c, i) => (c.sug === i ? boxNum(c.rest)", "const sugText = (c, i) => (c.sug === i ? (c.rest < 0 ? '-' : '') + Math.abs(c.rest).toLocaleString('ja-JP')"],
    ['鍵盤の − を半角に戻す', 'js/kenban.mjs', "return (neg ? '−' : '')", "return (neg ? '-' : '')"],
    ['下の空きを作らない', 'js/kenban.mjs', 'kp.hidden = false; if (sp) sp.hidden = false;', 'kp.hidden = false;'],
    ['机の鍵盤が効かない', 'js/kenban.mjs', 'ev.preventDefault(); press(k);', 'return;'],
    ['鍵の高さ 50', 'css/gamen.css', '.kp button { height: 60px;', '.kp button { height: 50px;'],
    ['対局の押しに＋を戻す', 'js/gamen-room.mjs', `'>' + v.nextNo + '回目の点を入れる</button>'`, `'>＋ ' + v.nextNo + '回目の点を入れる</button>'`],
    ['差に＋を付ける', 'js/gamen-room.mjs', "const diffText = (d) => Math.abs(d).toLocaleString('ja-JP')", 'const diffText = (d) => fmt(d)'],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port).catch((e) => ({ fail: 1, bad: ['例外 ' + String(e.message).split('\n')[0]] }));
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）');
    if (r.fail) red++;
  }
  console.log(`kenban-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length ? 0 : 1);
})();
