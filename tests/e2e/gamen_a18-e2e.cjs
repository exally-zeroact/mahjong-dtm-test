// A18 画面の自己確認（a18_sadame v5 §2・§6）。node gamen_a18-e2e.cjs <作業木> [--chromium|--self]
// ★A17 用（825acd2）＝鍵盤の桁の上限は KP_SPEC.max へ。A17 を入れる push で gamen_a18-e2e.cjs をこれに差し替える★
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(require.resolve('playwright', { paths: ['C:/Users/zeroa/Exally-test'] }));
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self'), CR = process.argv.includes('--chromium');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="bar"></div><div id="app"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { RULE_ERR } from '/js/gamen-rules.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
window.RULE_ERR = RULE_ERR;
const p = new URLSearchParams(location.search);
const rate = Number(p.get('rate') || 50), n = Number(p.get('n') || 1), big = p.get('big') === '1';
const R = { ...defaultRules(4), rate, chip_pt10: p.get('chip') ? Number(p.get('chip')) : null, shugi_pt10: null, ...(big ? { start_pts: 500000000, return_pts: 500000000 } : {}) };
const st = emptyState(); st.rules = R;
const ops = [
  { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
  { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
  { op: 'session_add', session_id: 's1', date: '2026-11-26', rate },
  { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
];
for (let i = 0; i < n; i++) ops.push({ op: 'hanchan_start', hanchan_id: 'h' + i, table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: big ? [1400000000, 400000000, 200000000, 0] : [40000, 30000, 20000, 10000] });
const r = applyOps(st, ops, { roomRules: R, now: '2026-11-26T00:00:00Z' });
if (!r.ok) document.body.dataset.err = JSON.stringify(r.res);
localStorage.clear();
const t = r.ok && r.state.tables.find((x) => x.table_id === 't1'); if (t) t.seats = ['m1', 'm2', 'm3', 'm4'];
localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar(b) { document.getElementById('bar').textContent = b.title; }, page: 'room' });
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
const BIG = '数が大きすぎて計算できません';
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000);
  const open = async (qs) => { await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]'); const e = await pg.getAttribute('body', 'data-err'); if (e) throw new Error('台の op が弾かれた ' + e); };
  const wins = () => pg.$$eval('.r-w', (xs) => xs.map((w) => ({ n: w.querySelector('.r-w-name')?.textContent, big: w.querySelector('.r-w-big')?.textContent ?? null, k: [...w.querySelectorAll('.r-w-k')].map((e) => e.textContent) })));
  const has = async (s) => (await pg.$$(s)).length;
  const reds = () => pg.$$eval('.r-red', (xs) => xs.map((x) => x.textContent));
  try {
    // A ふつう（rate 50・1回）＝額が出る・帯なし
    await open('rate=50&n=1');
    let w = await wins();
    ok('A 窓4つに額', w.length === 4 && w.every((x) => x.big !== null), w);
    ok('A 帯なし', (await has('#rMadoBig')) === 0);
    await pg.click('#rSeisan');
    ok('A 精算 札4つ', (await has('.r-card')) === 4, await has('.r-card'));
    ok('A 精算 帯なし', (await has('#sBig')) === 0, await reds());
    // B rate 20億・1回＝safe の内（1.8e15）＝そのまま出る
    await open('rate=2000000000&n=1&big=1&chip=10');
    w = await wins();
    ok('B 窓に額 +1,800,040,000,000,000', w[0] && w[0].big === '+1,800,040,000,000,000', w[0]);
    ok('B チップ1枚＝2,000,000,000', w[0] && w[0].k.some((k) => k.includes('1枚＝2,000,000,000')), w[0] && w[0].k);
    ok('B 帯なし', (await has('#rMadoBig')) === 0);
    await pg.click('#rSeisan');
    ok('B 精算 札4つ・帯なし', (await has('.r-card')) === 4 && (await has('#sBig')) === 0, await reds());
    // C 6回＝山田の額が safe の外（bigNg）＝窓は名前だけ＋帯・精算は帯だけ
    await open('rate=2000000000&n=6&big=1&chip=10');
    w = await wins();
    ok('C 窓は名前4つだけ（額・行なし）', w.length === 4 && w.every((x) => x.big === null && x.k.length === 0) && w.map((x) => x.n).join() === '山田,鈴木,佐藤,高橋', w);
    ok('C 帯「' + BIG + '」', (await pg.textContent('#rMadoBig').catch(() => null)) === BIG);
    ok('C ± の釦なし', (await has('.r-pm')) === 0, await has('.r-pm'));
    await pg.click('#rSeisan');
    ok('C 精算 帯 #sBig「' + BIG + '」', ((await pg.textContent('#sBig').catch(() => '')) || '').trim() === BIG, await reds());
    ok('C 精算 札も払いも出さない', (await has('.r-card')) === 0 && (await has('.r-pay')) === 0, [await has('.r-card'), await has('.r-pay')]);
    ok('C 精算 内部の字（big）を出さない', !(await pg.textContent('#app')).includes('（big）'));
    // D 鍵盤＝10桁まで（11桁目は入らない）・±20億の外は保存の時に字
    await open('rate=50&n=1');
    await pg.click('#rAdd');
    const kpk = (k) => pg.click('#eKp [data-kp="' + k + '"]');
    const put = async (i, v) => { await pg.locator('[data-c="' + i + '"]').click(); for (let j = 0; j < 12; j++) await kpk('bs'); for (const ch of v) await kpk(ch); };
    await put(0, '99999999999');
    const v0 = await pg.locator('[data-c="0"]').inputValue();
    ok('D 10桁まで 9,999,999,999', v0 === '9,999,999,999', v0);
    await put(0, '2000000100'); await kpk('ok');
    for (const i of [1, 2, 3]) { await put(i, '0'); await kpk('ok'); }
    await pg.click('#eOk');
    const er = await pg.textContent('#eErr');
    ok('D ±20億の外は「点は ±2,000,000,000 までです。」', er === '点は ±2,000,000,000 までです。', er);
    // E ルールの字
    const re = await pg.evaluate(() => [window.RULE_ERR.rate, window.RULE_ERR.start_pts]);
    ok('E rate の字', re[0] === 'レートは10以上の10の倍数か「なし」です。', re[0]);
    ok('E 持ち点の字（上限の数を書かない）', re[1] === '持ち点は 1,000以上の100の倍数です。', re[1]);
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
    console.log(`a18-e2e ${CR ? 'Chromium' : 'WebKit'}: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['窓の帯を外す（null を fmt に渡す）', 'js/gamen-room.mjs', '    if (v.bigNg) return', '    if (false) return'],
    ['精算で big を内部の字で出す', 'js/gamen-room.mjs', "s.err === 'big' || d.bigNg ? BIG_TEXT", 'false ? BIG_TEXT'],
    ['精算の門で big を通す', 'js/gamen-room.mjs', 'if (!s.ok || d.bigNg) {', "if (!s.ok && s.err !== 'big') {"],
    ['鍵盤を6桁に戻す', 'js/gamen-room.mjs', 'const KP_SPEC = { neg: true, dec: false, max: 10 };', 'const KP_SPEC = { neg: true, dec: false, max: 6 };'],
    ['rate の字を前に戻す', 'js/gamen-rules.mjs', "'レートは10以上の10の倍数か「なし」です。'", "'レートは10の倍数で 10〜100,000 か「なし」です。'"],
    ['持ち点の字を前に戻す', 'js/gamen-rules.mjs', "'持ち点は 1,000以上の100の倍数です。'", "'持ち点は 1,000〜200,000 の100の倍数です。'"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）' + (r.fail ? '  例: ' + r.bad[0] : ''));
    if (r.fail) red++;
  }
  console.log(`a18-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length ? 0 : 1);
})();
