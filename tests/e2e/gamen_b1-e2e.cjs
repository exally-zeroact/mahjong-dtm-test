// B1 卓の席の画面（b1_sadame_v2.md v2.1）の自己確認。node gamen_b1-e2e.cjs <作業木> [--self] [--chromium]
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
const R = { ...defaultRules(4), rate: 50, chip_pt10: 10, shugi_pt10: null, tobi: false };
if (p.get('keep') !== '1') {
  let st = emptyState(); st.rules = R;
  const ops = [
    { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
    { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
    { op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 50 },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  ];
  if (p.get('h') === '1') ops.push({ op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] });
  const r = applyOps(st, ops, { roomRules: R, now: '2026-11-21T00:00:00Z' });
  if (!r.ok) document.body.dataset.err = JSON.stringify(r.res || r);
  if (p.get('nu') === '1') r.state.needs_upload = true;
  localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
  localStorage.setItem('mj-outbox:u1:r1', '[]');
  localStorage.setItem('mj-synced:u1:r1', '1'); // 2d：倉庫と合わせた写しの印（無いと 2d より前の写し＝needs_upload で並びに積まない）
  // 前の版の控え（使わずに消える事を見る）
  localStorage.setItem('mj-seats:u1:r1', JSON.stringify({ table_id: 't1', seats: ['m4', 'm3', 'm2', 'm1'] }));
}
mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar() {}, page: 'room' });
document.body.dataset.ready = '1';
</script>`;
let mutate = null;
const mk = (root, mut) => http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__h.html') { r.writeHead(200, { 'content-type': MT['.html'] }); r.end(H); return; }
  const f = path.join(root, u.replace(/^\/+/, ''));
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  let b = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (mut && mutate && f.endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'text/plain' }); r.end(b);
});
const srv = mk(ROOT, true);
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  const open = async (qs, init) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); if (init) await ctx.addInitScript(init.fn, init.arg); const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000); await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]', { state: 'attached' }); return { pg, ctx }; };
  const all = (pg, s) => pg.evaluate((x) => [...document.querySelectorAll(x)].map((e) => e.textContent).join('|'), s);
  const ls = (pg, k) => pg.evaluate((x) => localStorage.getItem(x), k);
  const opsOf = async (pg) => JSON.parse((await ls(pg, 'mj-outbox:u1:r1')) || '[]').flatMap((g) => g.ops);
  const pickIn = async (pg, ids) => { for (const m of ids) await pg.click('#pBase [data-pick="' + m + '"]'); await pg.click('#pGo'); };
  const ORD = '鈴木|山田|高橋|佐藤';
  try {
    let stAfter;
    // A 0回目・席なし＝［＋名前］×4・窓なし・前の版の控えは使わず消す
    { const { pg, ctx } = await open('');
      ok('A 門を通る', !(await pg.evaluate(() => document.body.dataset.err)), await pg.evaluate(() => document.body.dataset.err));
      ok('A 頭は［＋名前］×4（前の控えを使わない）', (await pg.$$('.r-nm-add')).length === 4, await all(pg, '.r-nm'));
      ok('A 窓なし', (await pg.$$('.r-w')).length === 0);
      ok('A 前の版の mj-seats を消した', (await ls(pg, 'mj-seats:u1:r1')) === null);
      await ctx.close(); }
    // B 席を決める（鈴木・山田・高橋・佐藤の順に押す）
    { const { pg, ctx } = await open('');
      await pg.click('.r-nm'); await pickIn(pg, ['m2', 'm1', 'm4', 'm3']);
      ok('B 頭の名前が席の順', (await all(pg, '.r-nm')) === ORD, await all(pg, '.r-nm'));
      ok('B 窓の名前が席の順', (await all(pg, '.r-w-name')) === ORD, await all(pg, '.r-w-name'));
      ok('B チップの ± が 4人×2', (await pg.$$('.r-pm[data-k="chip"]')).length === 8);
      ok('B 窓は0', (await all(pg, '.r-w-big')).split('|').every((x) => x === '0'), await all(pg, '.r-w-big'));
      ok('B 席だけの卓は［精算を見る］と ✓ を出さない', (await pg.$$('#rSeisan')).length === 0 && (await pg.$$('.r-check')).length === 0);
      const ts = (await opsOf(pg)).filter((o) => o.op === 'table_seats');
      ok('B 並びに table_seats が1つ（席の順）', ts.length === 1 && ts[0].table_id === 't1' && ts[0].seats.join() === 'm2,m1,m4,m3', ts);
      const st = JSON.parse(await ls(pg, 'mj-room:u1:r1'));
      ok('B 写しの卓の席', (st.tables[0].seats || []).join() === 'm2,m1,m4,m3', st.tables[0].seats);
      ok('B localStorage に mj-seats が出来ない', (await ls(pg, 'mj-seats:u1:r1')) === null);
      // C 1人（高橋）に ＋ を押しても並びは席の順・windows に入る
      await pg.click('.r-pm[data-k="chip"][data-m="m4"][data-a="1"]');
      ok('C ± の後も窓は席の順', (await all(pg, '.r-w-name')) === ORD, await all(pg, '.r-w-name'));
      ok('C 高橋のチップ +1', (await all(pg, '.r-cnt')).split('|')[2] === '+1', await all(pg, '.r-cnt'));
      ok('C 合計が合わない字が出る（windows に入った）', (await all(pg, '.r-check.bad')).includes('チップの合計が +1 合いません'), await all(pg, '.r-check'));
      await pg.click('.r-pm[data-k="chip"][data-m="m2"][data-a="-1"]');
      ok('C 2人目で ✓ チップの合計 0', (await all(pg, '.r-check.ok')).includes('チップの合計 0'), await all(pg, '.r-check'));
      ok('C 窓は席の順のまま', (await all(pg, '.r-w-name')) === ORD, await all(pg, '.r-w-name'));
      stAfter = await ls(pg, 'mj-room:u1:r1');
      await ctx.close(); }
    // D 別の端末＝写し（倉庫から来る t.seats）だけで同じ名前の列（± を押す前の写し＝席だけ）
    { const s = JSON.parse(stAfter); s.extras = (s.extras || []).filter(() => false);
      const { pg, ctx } = await open('keep=1', { fn: ([v]) => { localStorage.setItem('mj-room:u1:r1', v); }, arg: [stAfter] });
      ok('D 別端末でも窓が席の順', (await all(pg, '.r-w-name')) === ORD, await all(pg, '.r-w-name'));
      await ctx.close(); }
    // E 0回目に［点を入れる］→人を選ぶ→始める＝table_seats も積み、点の画面へ
    { const { pg, ctx } = await open('');
      await pg.click('#rAdd'); await pickIn(pg, ['m1', 'm2', 'm3', 'm4']);
      ok('E 始めるでも table_seats', (await opsOf(pg)).some((o) => o.op === 'table_seats' && o.seats.join() === 'm1,m2,m3,m4'), await opsOf(pg));
      ok('E 点の画面へ', (await pg.$$('[data-c="0"]')).length === 1);
      await ctx.close(); }
    // F 半荘が在る卓で人を選び直す＝table_seats を送らない
    { const { pg, ctx } = await open('h=1');
      await pg.click('#rAdd'); await pg.click('#ePeople');
      await pg.click('#pBase [data-pick="m1"]'); await pg.click('#pBase [data-pick="m1"]'); await pg.click('#pGo');
      ok('F 点の画面へ戻る', (await pg.$$('[data-c="0"]')).length === 1);
      ok('F 半荘が在る時は table_seats 無し', !(await opsOf(pg)).some((o) => o.op === 'table_seats'), await opsOf(pg));
      await ctx.close(); }
    // G needs_upload の部屋＝並びに積まない・写しの席は替わる
    { const { pg, ctx } = await open('nu=1');
      await pg.click('.r-nm'); await pickIn(pg, ['m2', 'm1', 'm4', 'm3']);
      const ob = await opsOf(pg); const st = JSON.parse(await ls(pg, 'mj-room:u1:r1'));
      ok('G needs_upload：並びは空・写しの席は替わる', ob.length === 0 && st.needs_upload === true && (st.tables[0].seats || []).join() === 'm2,m1,m4,m3', [ob, st.tables[0].seats, st.needs_upload]);
      await ctx.close(); }
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
    console.log(`b1-e2e: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['席を写しから読まない', 'js/gamen-room.mjs', 'const x = tableView(st, table.table_id).seatPeople.map((p) => p.member_id);', 'const x = [];'],
    ['table_seats を積まない', 'js/gamen-room.mjs', "const r = commit([{ op: 'table_seats'", "const r = ({ ok: true }) || commit([{ op: 'table_seats'"],
    ['前の版の控えを書く', 'js/gamen-room.mjs', '      picking = null;\n      if (only) { toRoom(); return; }', '      picking = null; save(SEATS(uid, rid), { table_id: table.table_id, seats });\n      if (only) { toRoom(); return; }'],
    ['前の版の控えを消さない', 'js/gamen-room.mjs', 'try { localStorage.removeItem(SEATS(uid, rid)); }', 'try { }'],
    ['窓を windows だけで描く', 'js/gamen-room.mjs', 'for (const w of seatWin(v)) {', 'for (const w of v.windows) {'],
    ['窓の門を windows だけに', 'js/gamen-room.mjs', 'if (v.windows.length || v.seatPeople.length) h += renderWindows(v);', 'if (v.windows.length) h += renderWindows(v);'],
    ['並べを windows が先に', 'js/gamen-room.mjs', 'const out = v.seatPeople.map((p) => byId.get(p.member_id) || zero(p));', 'const out = v.windows.slice().concat(v.seatPeople.filter((p) => !byId.has(p.member_id)).map(zero));'],
    ['半荘が在っても送る', 'js/gamen-room.mjs', 'if (!nonL(t) && (none(ch) || (none([t.table_id]) && cn(t.seats || []) !== cn(seats)))) {', 'if (!nonL(t)) {'],
    ['席だけの卓で精算を出す', 'js/gamen-room.mjs', 'if (v.windows.length) h += renderCheck(v)', 'if (v.windows.length || v.seatPeople.length) h += renderCheck(v)'],
    ['needs_upload でも並びに積む', 'js/gamen-room.mjs', 'if (!st.needs_upload) { outbox.push', 'if (true) { outbox.push'],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）');
    if (r.fail) red++;
  }
  console.log(`b1-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length ? 0 : 1);
})();
