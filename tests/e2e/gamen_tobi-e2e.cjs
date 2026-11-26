// E1（A19・e_sadame v2）飛び賞＝点の行の［飛び賞］釦（押した人がもらう・何人でも）の画面の自己確認。node gamen_tobi-e2e.cjs <作業木> [--self] [--chromium]
//   お金は「押さない時の一覧の pt」と「押した時の pt」の差で見る（ウマ・オカに左右されない）＝手で数えた値（tobi_pt 10 → 1回 pt10 100）
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const p = new URLSearchParams(location.search);
const n = Number(p.get('n') || 4);
const R = { ...defaultRules(n), rate: 50, chip_pt10: null, shugi_pt10: null, tobi: p.get('t') !== '0', tobi_pt: Number(p.get('pt') ?? 10), tobi_from: p.get('from') || 'busted' };
if (n === 3) { R.start_pts = 45000; R.return_pts = 50000; }
const mem = ['m1', 'm2', 'm3', 'm4'].slice(0, n), nm = ['山田', '鈴木', '佐藤', '高橋'];
let st = emptyState(); st.rules = R;
const ops = [...mem.map((m, i) => ({ op: 'member_add', member_id: m, name: nm[i] })),
  { op: 'session_add', session_id: 's1', date: '2026-11-26', rate: 50 }, { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  { op: 'table_seats', table_id: 't1', seats: mem }]; // 卓の席は倉庫の t.seats（mj-seats は画面が始めに消す＝:164・半荘の無い台は席を選ぶ頁へ行って [data-c] が出ない＝CI 45891321404 tobi）
if (p.get('ex') === '1') ops.push({ op: 'hanchan_start', hanchan_id: 'h0', table_id: 't1', seats: mem, cells: [50000, 30000, 25000, -5000] }, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'tobi', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'tobi', add: -1 });
const r = applyOps(st, ops, { roomRules: R, now: '2026-11-26T00:00:00Z' });
if (!r.ok) document.body.dataset.err = JSON.stringify(r.res || r);
localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
localStorage.setItem('mj-seats:u1:r1', JSON.stringify({ table_id: 't1', seats: mem }));
mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar() {}, page: 'room' });
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
  const open = async (qs) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000); pg.on('pageerror', (e) => console.log('✗ 頁の例外 ' + String(e.message || e).slice(0, 300))); await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]', { state: 'attached' }); return { pg, ctx }; };
  const all = (pg, s) => pg.evaluate((x) => [...document.querySelectorAll(x)].map((e) => e.textContent).join('|'), s);
  const toNum = (s) => Math.round(Number(String(s).replace('−', '-').replace(/[+,]/g, '')) * 10);
  const hs = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r1')).hanchans);
  // 部屋の一覧の最後の回の pt（名前ごとの字）
  const lastPt = (pg, n) => pg.evaluate((k) => {
    const heads = [...document.querySelectorAll('table.r-hyou thead th')].slice(1).map((x) => x.textContent);
    const rows = [...document.querySelectorAll('table.r-hyou tbody tr')].filter((x) => x.querySelector('.r-no'));
    const tr = rows[rows.length - 1]; if (!tr) return null;
    const tds = [...tr.querySelectorAll('td')];
    return ['山田', '鈴木', '佐藤', '高橋'].slice(0, k).map((nm) => { const td = tds[heads.indexOf(nm)]; const b = td && td.querySelector('b'); return b ? b.textContent : null; });
  }, n);
  // 点を入れて［飛び賞］を押して入れる
  const enter = async (pg, cells, press) => {
    await pg.click('#rAdd'); await pg.waitForSelector('[data-c="0"]');
    for (const [i, v] of cells.entries()) { await pg.click('[data-c="' + i + '"]'); await pg.keyboard.type(String(v)); }
    await pg.keyboard.press('Escape');
    for (const i of press) await pg.click('[data-tobi="' + i + '"]');
    await pg.click('#eOk'); await pg.waitForSelector('table.r-hyou');
  };
  const ptNums = (a) => (a && a.every((v) => v && v !== '—') ? a.map(toNum) : null);
  const delta = async (qs, n, cells, press) => {
    const a = await open(qs); await enter(a.pg, cells, []); const p0 = await lastPt(a.pg, n); await a.ctx.close();
    const b = await open(qs); await enter(b.pg, cells, press); const p1 = await lastPt(b.pg, n); const h = await hs(b.pg); await b.ctx.close();
    const x0 = ptNums(p0), x1 = ptNums(p1);
    return { d: x0 && x1 ? x1.map((x, i) => x - x0[i]) : null, p0, p1, tobi_to: h && h.length ? h[h.length - 1].tobi_to : null };
  };
  try {
    // A 行の形＝［名前］［飛び賞］［上家］［点］・pt の字は無い
    { const { pg, ctx } = await open('');
      ok('A 門を通る', !(await pg.evaluate(() => document.body.dataset.err)), await pg.evaluate(() => document.body.dataset.err));
      await pg.click('#rAdd'); await pg.waitForSelector('[data-c="0"]');
      const shape = await pg.evaluate(() => [...document.querySelectorAll('.r-er')].map((r) => [...r.children].map((c) => (c.dataset.tobi !== undefined ? 'T' : c.dataset.kam !== undefined ? 'K' : c.dataset.c !== undefined ? 'V' : c.classList.contains('r-er-n') ? 'N' : '?')).join('')));
      ok('A 4行とも 名前・飛び賞・上家・点', shape.length === 4 && shape.every((s) => s === 'NTKV'), shape);
      ok('A pt の字（data-p）が無い', (await pg.$$('.r-ent [data-p], .r-er-p')).length === 0);
      const t = await pg.evaluate(() => { const b = document.querySelector('[data-tobi="2"]'); const s = getComputedStyle(b); return { txt: b.textContent, lab: b.getAttribute('aria-label'), pr: b.getAttribute('aria-pressed'), h: Math.round(b.getBoundingClientRect().height), fs: s.fontSize }; });
      ok('A 釦は「飛び賞」・aria-label・押していない・高さ36・14px', t.txt === '飛び賞' && t.lab === '佐藤が飛び賞をもらう' && t.pr === 'false' && t.h === 36 && t.fs === '14px', t);
      await pg.click('[data-tobi="2"]');
      ok('A 押すと aria-pressed true', (await pg.getAttribute('[data-tobi="2"]', 'aria-pressed')) === 'true');
      await pg.click('[data-tobi="2"]');
      ok('A もう1回で外す', (await pg.getAttribute('[data-tobi="2"]', 'aria-pressed')) === 'false');
      const w = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('.r-er')].map((r) => r.scrollWidth - r.clientWidth)));
      ok('A 390幅で行がはみ出さない', w <= 0, w);
      await ctx.close(); }
    // B 3人 [230000,65000,-160000]：押す0 → [+100,0,−100]・押す0,1 → [+100,+100,−200]
    { const x = await delta('n=3', 3, [230000, 65000, -160000], [0]);
      ok('B 3人 押す0：差 [+100,0,−100]', JSON.stringify(x.d) === '[100,0,-100]', x);
      ok('B 保存 tobi_to {r:[0]}', JSON.stringify(x.tobi_to) === '{"r":[0]}', x.tobi_to); }
    { const x = await delta('n=3', 3, [230000, 65000, -160000], [1, 0]);
      ok('B 3人 押す0,1：差 [+100,+100,−200]', JSON.stringify(x.d) === '[100,100,-200]', x);
      ok('B 保存は並べる {r:[0,1]}', JSON.stringify(x.tobi_to) === '{"r":[0,1]}', x.tobi_to); }
    // C 4人 2人飛び：押す1 → [0,+200,−100,−100]・押す1,2（飛んだ人も押せる）→ [0,+200,0,−200]
    { const x = await delta('', 4, [70000, 50000, -5000, -15000], [1]);
      ok('C 4人 2人飛び 押す1：差 [0,+200,−100,−100]', JSON.stringify(x.d) === '[0,200,-100,-100]', x); }
    { const x = await delta('', 4, [70000, 50000, -5000, -15000], [2, 1]);
      ok('C 押す1,2：飛んだ人は払ってもらう [0,+200,0,−200]', JSON.stringify(x.d) === '[0,200,0,-200]', x); }
    // D 誰も押さない＝0・待ちにしない・字も無い／押したが誰も飛んでいない＝0
    { const { pg, ctx } = await open('');
      await enter(pg, [50000, 30000, 25000, -5000], []);
      const lp = await lastPt(pg, 4);
      ok('D 飛んだが押さない：一覧の回は数が出る（— でない・理由の行なし）', !!ptNums(lp) && (await pg.$$('.r-why')).length === 0, lp);
      ok('D 押さない：飛び賞の字が部屋に無い', !/飛び賞/.test(await pg.locator('#app').innerText()));
      const h = await hs(pg); ok('D 押さない：tobi_to を付けない', Object.keys(h[h.length - 1].tobi_to || {}).length === 0, h[h.length - 1].tobi_to);
      await ctx.close(); }
    { const x = await delta('', 4, [40000, 30000, 20000, 10000], [0]);
      ok('D 誰も飛んでいない：押しても差0', JSON.stringify(x.d) === '[0,0,0,0]', x); }
    // E 釦が無い卓＝tobi false・tobi_pt 0・払う先「全員」
    for (const [qs, nm] of [['t=0', 'tobi false'], ['pt=0', 'pt 0'], ['from=all', '払う先 全員']]) {
      const { pg, ctx } = await open(qs);
      await pg.click('#rAdd'); await pg.waitForSelector('[data-c="0"]');
      ok('E ' + nm + '：［飛び賞］釦が無い', (await pg.$$('[data-tobi]')).length === 0);
      await ctx.close();
    }
    // F 直す＝押した人を戻す・変えた時だけ tobi_set・点だけ直しても押した人は変わらない
    { const { pg, ctx } = await open('');
      await enter(pg, [70000, 50000, -5000, -15000], [1]);
      const id = (await hs(pg))[0].hanchan_id;
      await pg.click('.r-no[data-h="' + id + '"]'); await pg.waitForSelector('[data-tobi="1"]');
      ok('F 直す頁は押した人を戻す', (await pg.getAttribute('[data-tobi="1"]', 'aria-pressed')) === 'true' && (await pg.getAttribute('[data-tobi="0"]', 'aria-pressed')) === 'false');
      await pg.click('[data-c="0"]'); await pg.keyboard.type('71000'); await pg.click('[data-c="1"]'); await pg.keyboard.type('49000'); await pg.keyboard.press('Escape');
      await pg.click('#eOk'); await pg.waitForSelector('table.r-hyou');
      let h = (await hs(pg))[0];
      ok('F 点だけ直す：tobi_to そのまま・tobi_version 1', JSON.stringify(h.tobi_to) === '{"r":[1]}' && h.tobi_version === 1 && h.cells[0] === 71000, [h.tobi_to, h.tobi_version, h.cells]);
      await pg.click('.r-no[data-h="' + id + '"]'); await pg.waitForSelector('[data-tobi="0"]');
      await pg.click('[data-tobi="0"]'); await pg.click('#eOk'); await pg.waitForSelector('table.r-hyou');
      h = (await hs(pg))[0];
      ok('F 押す人を足す：tobi_to {r:[0,1]}・tobi_version 2', JSON.stringify(h.tobi_to) === '{"r":[0,1]}' && h.tobi_version === 2, [h.tobi_to, h.tobi_version]);
      await ctx.close(); }
    // G 窓に飛び賞の行が無い・昔の種 tobi の行（テスト線だけ）は開ける・0 と数える
    { const a = await open('ex=1');
      ok('G 昔の tobi の行：門を通る', !(await a.pg.evaluate(() => document.body.dataset.err)) && (await a.pg.$$('#rGate')).length === 0, await a.pg.evaluate(() => document.body.dataset.err));
      ok('G 窓に飛び賞の ± が無い', (await a.pg.$$('.r-pm[data-k="tobi"]')).length === 0);
      ok('G 窓と✓に飛び賞の字・ヒントが無い', !/飛び賞/.test(await all(a.pg, '.r-w, .r-check')) && (await a.pg.$$('#rTobiHint')).length === 0, await all(a.pg, '.r-w, .r-check'));
      await a.pg.click('#rSeisan');
      const bigA = await all(a.pg, '.r-card .r-card-big'), subA = await all(a.pg, '.r-card .r-card-sub, .r-check');
      await a.ctx.close();
      ok('G 精算の札が4枚出る（昔の行で止めない）', bigA.split('|').filter(Boolean).length === 4, bigA);
      ok('G 精算の内訳・✓に飛び賞が無い', !/飛び賞/.test(subA), subA); }
    // G2 昔の tobi の行は 0＝行が無い時と同じ額
    { const a = await open('ex=1'); await a.pg.click('#rSeisan'); const x = await all(a.pg, '.r-card .r-card-big'); await a.ctx.close();
      const b = await open('ex=0'); await b.pg.click('#rAdd'); await b.pg.waitForSelector('[data-c="0"]');
      for (const [i, v] of [50000, 30000, 25000, -5000].entries()) { await b.pg.click('[data-c="' + i + '"]'); await b.pg.keyboard.type(String(v)); }
      await b.pg.keyboard.press('Escape'); await b.pg.click('#eOk'); await b.pg.waitForSelector('table.r-hyou');
      await b.pg.click('#rSeisan'); const y = await all(b.pg, '.r-card .r-card-big'); await b.ctx.close();
      ok('G2 昔の tobi の行は 0（行の無い同じ回と同じ額）', x === y && !!x, [x, y]); }
  } catch (e) { fail++; bad.push('例外 ' + String(e.message).split('\n')[0]); }
  return { pass, fail, bad };
}
(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (process.argv.includes('--chromium') ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br, port);
    if (r.bad.length) console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`tobi-e2e: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['釦を出さない', 'js/gamen-room.mjs', "return tobiUsed(R0) && R0.tobi_from === 'busted'; }", 'return false; }'],
    ['払う先「全員」でも釦を出す', 'js/gamen-room.mjs', "return tobiUsed(R0) && R0.tobi_from === 'busted'; }", 'return tobiUsed(R0); }'],
    ['もう1回で外さない', 'js/gamen-room.mjs', 'entry.tobiR = entry.tobiR.includes(i) ? entry.tobiR.filter((x) => x !== i) : [...entry.tobiR, i];', 'entry.tobiR = [...new Set([...entry.tobiR, i])];'],
    ['新しい回に tobi_to を付けない', 'js/gamen-room.mjs', 'if (tobiBtnOn() && e.tobiR.length) op.tobi_to = { r: tobiRSorted(e.tobiR) };', 'if (false) op.tobi_to = null;'],
    ['並べずに保存', 'js/gamen-room.mjs', 'const tobiRSorted = (a) => [...new Set(a)].sort((x, y) => x - y);', 'const tobiRSorted = (a) => [...new Set(a)];'],
    ['直す時に tobi_set を送らない', 'js/gamen-room.mjs', 'if (tobiBtnOn() && canon(tobiRSorted(e.tobiR)) !== canon(tobiRSorted(h.tobiR))) ops.push(', 'if (false) ops.push('],
    ['直す頁で押した人を戻さない', 'js/gamen-room.mjs', 'const tobiROf = (t) => (t && Array.isArray(t.r) ? t.r.filter((x) => Number.isInteger(x)) : []);', 'const tobiROf = (t) => [];'],
    ['窓に飛び賞の行を戻す', 'js/gamen-room.mjs', "{ kind: 'yaki', label: 'やきとり' }];", "{ kind: 'yaki', label: 'やきとり' }, { kind: 'tobi', label: '飛び賞' }];"],
    ['釦を出す所を消す', 'js/gamen-room.mjs', "'</span>' + (tb ? '<button type=\"button\" class=\"r-kam r-tobi\"", "'</span>' + (false ? '<button type=\"button\" class=\"r-kam r-tobi\""],
    ['pt の字を戻す', 'js/gamen-room.mjs', "'の素点\"></div>').join('') + '</div>';", "'の素点\"><span class=\"r-er-p\" data-p=\"' + i + '\">+0.0</span></div>').join('') + '</div>';"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）');
    if (r.fail) red++;
  }
  console.log(`tobi-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length ? 0 : 1);
})();
