// w2a 画面の自己確認（w2a_sadame v1 §2＝締めた後の変わりがレート無しでも帯に出る）。node gamen_w2a-e2e.cjs <作業木> [--chromium|--self]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test'] }));
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self'), CR = process.argv.includes('--chromium');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
// rnull＝締めた後に開催の rate を null に（点と pt が両方変わる）・mixvoid＝mix の卓2の半荘を取り消す
// rate＝null か数・ed＝chip（A+3/B−3→A+5/B−5）／cell（1回目 山田 40000→42000・高橋 10000→8000）／none（直さない）／mix（rate の開催にレート無しの卓2を足し、卓2のチップだけ直す）
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="bar"></div><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { emptyState, applyOps, sessionSeisan, sessionSig } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const p = new URLSearchParams(location.search);
const rate = p.get('rate') === 'null' ? null : Number(p.get('rate')), ed = p.get('ed');
const R = { ...defaultRules(4), rate, chip_pt10: 10, shugi_pt10: null };
const st = emptyState(); st.rules = R;
const seats = ['m1', 'm2', 'm3', 'm4'];
const ops = [
  { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
  { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
  { op: 'session_add', session_id: 's1', date: '2026-11-28', rate },
  { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
  { op: 'hanchan_start', hanchan_id: 'h0', table_id: 't1', seats, cells: [40000, 30000, 20000, 10000] },
];
const mix = String(ed).startsWith('mix'), ct = mix ? 't2' : 't1';
if (mix) ops.push({ op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' }, { op: 'table_edit', table_id: 't2', rate_mode: 'none', rate: null }, { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't2', seats, cells: [40000, 30000, 20000, 10000] });
ops.push({ op: 'extra_add', table_id: ct, member_id: 'm1', kind: 'chip', add: 3 }, { op: 'extra_add', table_id: ct, member_id: 'm2', kind: 'chip', add: -3 });
let r = applyOps(st, ops, { roomRules: R, now: '2026-11-28T00:00:00Z' });
const die = (x) => { document.body.dataset.err = JSON.stringify(x); };
if (!r.ok) die(r.res);
else {
  const s = sessionSeisan(r.state, 's1');
  const snap = { op: 'settle_snap', session_id: 's1', rev: 1, content: { ten: s.ten, pt10: s.pt10, pt10NoRate: s.pt10NoRate, pay: s.pay, sig: sessionSig(r.state, 's1') }, used: { session: { session_id: 's1', date: '2026-11-28', rate, version: 1 }, tables: [], hanchans: [] }, missing: s.missing };
  r = applyOps(r.state, [snap], { roomRules: R, now: '2026-11-28T03:00:00Z' });
  const ver = (m) => (r.state.extras.find((e) => e.table_id === ct && e.member_id === m && e.kind === 'chip') || {}).version;
  const h0 = r.ok && r.state.hanchans.find((h) => h.hanchan_id === 'h0');
  const after = ed === 'chip' || ed === 'mix' ? [{ op: 'extra_set', table_id: ct, member_id: 'm1', kind: 'chip', value: 5, base_version: ver('m1') }, { op: 'extra_set', table_id: ct, member_id: 'm2', kind: 'chip', value: -5, base_version: ver('m2') }]
    : ed === 'rnull' ? [{ op: 'session_edit', session_id: 's1', rate: null }] : ed === 'mixvoid' ? [{ op: 'hanchan_void', hanchan_id: 'h1' }]
    : ed === 'cell' ? [{ op: 'cell_set', hanchan_id: 'h0', seat: 0, value: 42000, base_version: h0.cell_ver[0] }, { op: 'cell_set', hanchan_id: 'h0', seat: 3, value: 8000, base_version: h0.cell_ver[3] }] : [];
  if (r.ok && after.length) r = applyOps(r.state, after, { roomRules: R });
  if (!r.ok) die(r.res);
}
localStorage.clear();
if (r.ok) { for (const t of r.state.tables) t.seats = seats.slice(); localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state)); localStorage.setItem('mj-synced:u1:r1', '1'); }
mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R, closed: true }, showShare() {}, bar(b) { document.getElementById('bar').textContent = b.title; }, page: 'room' });
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
const BAND = '終えた後に変わりました';
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000);
  const open = async (qs) => {
    await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]');
    const e = await pg.getAttribute('body', 'data-err'); if (e) throw new Error('台の op が弾かれた ' + e);
    await pg.click('#rSeisan'); await pg.waitForSelector('.r-white, .r-red');
  };
  const reds = () => pg.$$eval('.r-red', (xs) => xs.map((x) => x.textContent));
  const band = async () => (await reds()).find((x) => x.startsWith(BAND)) || null;
  // 「終えた時 → 今」の行＝[名前, 前, 今]
  const rows = () => pg.$$eval('.list .li', (xs) => xs.filter((x) => x.querySelector('.li-v')).map((x) => [x.querySelector('.b')?.textContent, x.querySelector('.li-v')?.textContent, x.lastElementChild?.textContent]));
  const secs = () => pg.$$eval('p.sec', (xs) => xs.map((x) => x.textContent));
  const ptList = () => pg.$$eval('p.sec', (xs) => { const s = xs.find((x) => x.textContent === 'レートなしの卓（pt）'); const l = s && s.nextElementSibling; return l ? [...l.querySelectorAll('.li')].map((li) => li.textContent) : null; });
  try {
    // W1 rate null・締めた後にチップ ⇒ 帯2人・pt の行（山田 +53.0→+55.0・鈴木 +7.0→+5.0）
    await open('rate=null&ed=chip');
    ok('W1 帯「' + BAND + '（2人）」', (await band() || '').startsWith(BAND + '（2人）'), await reds());
    let rw = await rows();
    ok('W1 山田 +53.0pt → +55.0pt', rw.some((x) => x[0] === '山田' && x[1] === '+53.0pt →' && x[2] === '+55.0pt'), rw);
    ok('W1 鈴木 +7.0pt → +5.0pt', rw.some((x) => x[0] === '鈴木' && x[1] === '+7.0pt →' && x[2] === '+5.0pt'), rw);
    ok('W1 変わっていない人は行に無い', rw.length === 2, rw);
    ok('W1 小見出し「レートなしの卓（pt）」', (await secs()).includes('レートなしの卓（pt）'), await secs());
    // W6 終えた時のまま見る ⇒ pt の節が控えの数・今の数に戻る ⇒ 今
    await pg.click('#sSnap');
    let pl = await ptList();
    ok('W6 控えの pt 山田 +53.0pt', !!pl && pl.some((x) => x.includes('山田') && x.includes('+53.0pt')), pl);
    await pg.click('#sNow');
    pl = await ptList();
    ok('W6 今の数に戻ると帯（今は +55.0pt）', (await band()) !== null && (await rows()).some((x) => x[0] === '山田' && x[2] === '+55.0pt'), [pl, await reds()]);
    // W2 rate null・半荘の点 ⇒ 帯2人（山田 +50.0→+52.0・高橋 −40.0→−42.0）
    await open('rate=null&ed=cell');
    ok('W2 帯（2人）', (await band() || '').startsWith(BAND + '（2人）'), await reds());
    rw = await rows();
    ok('W2 高橋 −40.0pt → −42.0pt', rw.some((x) => x[0] === '高橋' && x[1] === '−40.0pt →' && x[2] === '−42.0pt'), rw);
    // W3 rate 100・チップ ⇒ 点の行（山田 +5,300→+5,500）・pt の行なし
    await open('rate=100&ed=chip');
    ok('W3 帯（2人）', (await band() || '').startsWith(BAND + '（2人）'), await reds());
    rw = await rows();
    ok('W3 山田 +5,300 → +5,500', rw.some((x) => x[0] === '山田' && x[1] === '+5,300 →' && x[2] === '+5,500'), rw);
    ok('W3 pt の行なし', !rw.some((x) => String(x[2]).endsWith('pt')), rw);
    // W4 rate 100 の開催のレート無しの卓だけ直す ⇒ 帯2人（点は同じ・pt だけ）
    await open('rate=100&ed=mix');
    ok('W4 帯（2人）', (await band() || '').startsWith(BAND + '（2人）'), await reds());
    rw = await rows();
    ok('W4 行は pt だけ（山田 +53.0pt → +55.0pt）', rw.length === 2 && rw.some((x) => x[0] === '山田' && x[2] === '+55.0pt'), rw);
    // W7 rate 100 で締めた後に開催の rate を null ⇒ 点も pt も変わる・人は重ねずに4人（8人にしない）
    await open('rate=100&ed=rnull');
    ok('W7 帯（4人）', (await band() || '').startsWith(BAND + '（4人）'), await reds());
    rw = await rows();
    ok('W7 点の行4つ＋pt の行4つ（山田 +5,300 → 0・+53.0pt）', rw.length === 8 && rw.some((x) => x[0] === '山田' && x[1] === '+5,300 →' && x[2] === '0') && rw.some((x) => x[0] === '山田' && x[1] === '0.0pt →' && x[2] === '+53.0pt'), rw);
    // W8 rate 100 の開催のレート無しの卓の半荘を取り消す ⇒ pt だけ変わる・帯4人
    await open('rate=100&ed=mixvoid');
    ok('W8 帯（4人）', (await band() || '').startsWith(BAND + '（4人）'), await reds());
    rw = await rows();
    ok('W8 行は pt だけ（高橋 −40.0pt → 0.0pt）', rw.length === 4 && rw.every((x) => String(x[2]).endsWith('pt')) && rw.some((x) => x[0] === '高橋' && x[1] === '−40.0pt →' && x[2] === '0.0pt'), rw);
    // W5 直さない ⇒ 帯なし・対局終了の行
    await open('rate=null&ed=none');
    ok('W5 帯なし', (await band()) === null, await reds());
    ok('W5 「に対局終了」の行', ((await pg.textContent('.r-white').catch(() => '')) || '').includes('に対局終了'));
  } catch (e) { fail++; bad.push('例外 ' + String(e.message).split('\n')[0]); }
  await ctx.close();
  return { pass, fail, bad };
}
(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await (CR ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br, port);
    console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`w2a-e2e ${CR ? 'Chromium' : 'WebKit'}: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['pt を比べない', 'js/gamen-room.mjs', 'const ptCh = last && !partial ? tenChanged(', 'const ptCh = false ? tenChanged('],
    ['changed に pt を入れない', 'js/gamen-room.mjs', ': chWho.length > 0);', ': tenCh.length > 0);'],
    ['終えた時のまま見るで今の pt を出す', 'js/gamen-room.mjs', '(viewSnap ? last.content.pt10NoRate : s.pt10NoRate)', '(s.pt10NoRate)'],
    ['人を重ねて数える', 'js/gamen-room.mjs', 'tenCh.concat(ptCh.filter((m) => !tenCh.includes(m)))', 'tenCh.concat(ptCh)'],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）' + (r.fail ? '  例: ' + r.bad[0] : ''));
    if (r.fail) red++;
  }
  console.log(`w2a-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length && W.length ? 0 : 1);
})();
