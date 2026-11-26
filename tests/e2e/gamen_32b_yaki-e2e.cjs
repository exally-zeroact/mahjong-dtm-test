// ③-2 B 画面の自己確認（gamen_32b_sadame.md v1.1 §7）。node yaki-e2e.cjs <作業木> [--self]
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="app"></div><div id="rr"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { mountRules } from '/js/gamen-rules.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const p = new URLSearchParams(location.search);
const R = { ...defaultRules(4), rate: 50, chip_pt10: null, shugi_pt10: null, yakitori: p.get('y') === '1', yakitori_pt: Number(p.get('pt') || 0) };
if (p.get('mode') === 'rules') { window.ctl = mountRules(document.getElementById('rr'), { rules: { ...R } }); }
else {
  let st = emptyState(); st.rules = R;
  const r = applyOps(st, [
    { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
    { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
    { op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 50 },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] },
  ], { roomRules: R });
  if (!r.ok) { document.body.dataset.err = JSON.stringify(r.res); }
  localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
  mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar() {}, page: p.get('page') || 'room' });
}
document.body.dataset.ready = '1';
</script>`;
let mutate = null;
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  // 作る時の門：本物の taikyoku.html に、ログインと rpc だけ差し替えた gamen-core を噛ませる（倉庫へは行かない）
  if (u === '/js/gamen-core.mjs') { r.writeHead(200, { 'content-type': MT['.mjs'] }); r.end(`export * from '/js/__core_real.mjs';
export async function needLogin(cb) { cb({ id: 'u1' }); }
export async function rpc(fn, args) { (window.__rpc = window.__rpc || []).push({ fn, args }); return { ok: false, err: 'stub' }; }
`); return; }
  if (u === '/js/__core_real.mjs') { r.writeHead(200, { 'content-type': MT['.mjs'] }); r.end(fs.readFileSync(path.join(ROOT, 'js', 'gamen-core.mjs'), 'utf8')); return; }
  if (u === '/__h.html') { r.writeHead(200, { 'content-type': MT['.html'] }); r.end(H); return; }
  const f = path.join(ROOT, u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  let b = fs.readFileSync(f, 'utf8');
  if (mutate && f.endsWith(mutate.file)) { if (!b.includes(mutate.from)) { console.log('✗ 壊しの字が無い ' + mutate.from); process.exit(2); } b = b.replace(mutate.from, mutate.to); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'text/plain' }); r.end(b);
});
// A8：ルールの箱は readonly＋inputmode none（アプリの数字鍵盤）＝fill できない。箱を押し ⌫ で空にして鍵で打つ（− は neg・. は dot）
async function kpPut(pg, sel, v) {
  const K = (k) => pg.click('.kp:not([hidden]) [data-kp="' + k + '"]');
  await pg.click(sel);
  for (let j = 0; j < 8; j++) await K('bs');
  for (const ch of String(v)) await K(ch === '-' || ch === '−' ? 'neg' : ch === '.' ? 'dot' : ch);
  await K('ok'); // 人と同じく ✓ で閉じる（開いたままだと下の［部屋を作る］が鍵盤の下に隠れる・CI 45811332647）
}
async function run(br, port) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info ? '  ' + info : '')); } };
  const open = async (qs) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000); await pg.goto(`http://127.0.0.1:${port}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]'); return { pg, ctx }; };
  const txt = (pg, s) => pg.$eval(s, (e) => e.textContent).catch(() => null);
  const cardBig = (pg, name) => pg.evaluate((nm) => { const c = [...document.querySelectorAll('.r-card')].find((x) => x.querySelector('.r-w-name')?.textContent === nm); return c ? c.querySelector('.r-card-big').textContent : null; }, name);
  const cardSub = (pg, name) => pg.evaluate((nm) => { const c = [...document.querySelectorAll('.r-card')].find((x) => x.querySelector('.r-w-name')?.textContent === nm); return c && c.querySelector('.r-card-sub') ? c.querySelector('.r-card-sub').textContent : null; }, name);
  const toNum = (s) => Number(String(s).replace('−', '-').replace(/[+,]/g, ''));
  // 0. 土台（やきとり on 5pt・枚を入れない）の精算の額
  let base;
  { const { pg, ctx } = await open('y=1&pt=5');
    ok('on 5pt：やきとりの − ＋ が 4人×2', (await pg.$$('.r-pm[data-k="yaki"]')).length === 8);
    ok('on 5pt：1枚＝250（5pt×レート50）', (await pg.evaluate(() => [...document.querySelectorAll('.r-w-k')].map((e) => e.textContent))).includes('やきとり1枚＝250'));
    await pg.click('#rSeisan'); base = { a: toNum(await cardBig(pg, '山田')), b: toNum(await cardBig(pg, '鈴木')) }; await ctx.close(); }
  // 1. 山田 +1・鈴木 −1
  { const { pg, ctx } = await open('y=1&pt=5');
    await pg.click('.r-pm[data-k="yaki"][data-m="m1"][data-a="1"]'); await pg.click('.r-pm[data-k="yaki"][data-m="m2"][data-a="-1"]');
    const ck = await txt(pg, '.r-check');
    ok('±1：✓ やきとりの合計 0', ck && ck.includes('やきとりの合計 0') && !ck.includes('合いません'), ck);
    const vals = await pg.evaluate(() => [...document.querySelectorAll('.r-w')].map((w) => [w.querySelector('.r-w-name').textContent, [...w.querySelectorAll('.r-w-k')].findIndex((k) => k.textContent.startsWith('やきとり')), [...w.querySelectorAll('.r-w-val')].map((v) => v.textContent)]));
    const vOf = (nm) => { const x = vals.find((v) => v[0] === nm); return x ? x[2][x[1]] : null; };
    ok('±1：窓のやきとりの額 山田 +250・鈴木 −250', vOf('山田') === '+250' && vOf('鈴木') === '−250', JSON.stringify(vals));
    await pg.click('#rSeisan');
    const a = toNum(await cardBig(pg, '山田')), b = toNum(await cardBig(pg, '鈴木'));
    ok('±1：精算 山田＝土台＋250・鈴木＝土台−250', a === base.a + 250 && b === base.b - 250, `${base.a}→${a} ${base.b}→${b}`);
    const sub = await cardSub(pg, '山田');
    ok('±1：内訳「やきとり +1枚 +5.0」', sub && sub.includes('やきとり +1枚 +5.0'), sub);
    const chk = await pg.evaluate(() => [...document.querySelectorAll('.r-check')].map((e) => e.textContent).join('|'));
    ok('±1：精算の✓に「やきとり0」', chk.includes('やきとり0'), chk);
    await ctx.close(); }
  // 2. 山田 +1 だけ（合わない）
  { const { pg, ctx } = await open('y=1&pt=5');
    await pg.click('.r-pm[data-k="yaki"][data-m="m1"][data-a="1"]');
    const ck = await txt(pg, '.r-check.bad');
    ok('+1 だけ：bad「やきとりの合計が +1 合いません」', ck && ck.includes('やきとりの合計が +1 合いません'), ck);
    await pg.click('#rSeisan');
    const body = await pg.evaluate(() => [...document.querySelectorAll('.r-red, .r-red-btn')].map((e) => e.textContent).join('|'));
    ok('+1 だけ：入っていない物「やきとりの合計が +1 で合いません」', body.includes('やきとりの合計が +1 で合いません'), body);
    ok('+1 だけ：額の札を出さない', (await pg.$$('.r-card')).length === 0);
    await ctx.close(); }
  // 3. on・pt 0 と off
  for (const [qs, want, nm] of [['y=1&pt=0', 'あり・1枚 0 pt＝数えません', 'on・pt0'], ['y=0&pt=5', 'なし', 'off']]) {
    const { pg, ctx } = await open(qs);
    ok(nm + '：やきとりの行が出ない', (await pg.$$('.r-pm[data-k="yaki"]')).length === 0);
    await ctx.close();
    const o = await open(qs + '&page=rules');
    const t = await o.pg.evaluate(() => [...document.querySelectorAll('.li')].map((e) => e.textContent).find((s) => s.startsWith('やきとり')) || null);
    ok(nm + '：ルールの字「やきとり' + want + '」', t === 'やきとり' + want, t);
    await o.ctx.close();
  }
  // 4. ルールの画面（作る側）の read()
  { const { pg, ctx } = await open('y=0&pt=0&mode=rules');
    let r = await pg.evaluate(() => window.ctl.read());
    ok('read()：off の既定＝yakitori false・pt は数', r.yakitori === false && Number.isInteger(r.yakitori_pt), JSON.stringify([r.yakitori, r.yakitori_pt]));
    await pg.click('#rYakiOn'); await kpPut(pg, '#rYaki', '7');
    r = await pg.evaluate(() => window.ctl.read());
    ok('read()：on・7＝yakitori true・pt 7', r.yakitori === true && r.yakitori_pt === 7, JSON.stringify([r.yakitori, r.yakitori_pt]));
    await kpPut(pg, '#rYaki', '0'); r = await pg.evaluate(() => window.ctl.read());
    ok('read()：on・0＝pt 0 のまま渡る（作る門で止める）', r.yakitori === true && r.yakitori_pt === 0);
    await pg.click('#rYakiOn'); await kpPut(pg, '#rYaki', ''); r = await pg.evaluate(() => window.ctl.read());
    ok('read()：空の箱のまま off＝yakitori false・pt 0（NaN を残さない・A8 で字は打てない）', r.yakitori === false && r.yakitori_pt === 0, JSON.stringify([r.yakitori, r.yakitori_pt]));
    await ctx.close(); }
  // 5. 作る時の門（gamen-taikyoku doCreate）＝on・pt 0 は倉庫へ送らない／on・7 は yakitori true・7 で送る
  { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000);
    await pg.goto(`http://127.0.0.1:${port}/taikyoku.html`); await pg.waitForSelector('#cName', { state: 'visible' });
    await pg.fill('#cName', '試しの会'); await pg.fill('#cPass', '1234'); await pg.click('#goRules');
    await pg.click('#rYakiOn'); await kpPut(pg, '#rYaki', '0'); await pg.click('#btnCreate'); await pg.waitForTimeout(300);
    const e0 = await txt(pg, '#cErr'), n0 = await pg.evaluate(() => (window.__rpc || []).filter((x) => x.fn === 'mj_room_create').length); // A14g：開いた時に mj_my_rules を読む＝作る口だけ数える
    ok('作る門：on・pt 0＝字を出して倉庫へ送らない', e0 === 'やきとり1枚の pt は 1〜999 です（整数）。' && n0 === 0, JSON.stringify([e0, n0]));
    await kpPut(pg, '#rYaki', '7'); await pg.click('#btnCreate'); await pg.waitForFunction(() => (window.__rpc || []).some((x) => x.fn === 'mj_room_create')).catch(() => {});
    const c = await pg.evaluate(() => (window.__rpc || []).filter((x) => x.fn === 'mj_room_create').map((x) => [x.fn, x.args && x.args.p_rules && x.args.p_rules.yakitori, x.args && x.args.p_rules && x.args.p_rules.yakitori_pt]));
    ok('作る門：on・7＝mj_room_create に yakitori true・7', c.length === 1 && c[0][0] === 'mj_room_create' && c[0][1] === true && c[0][2] === 7, JSON.stringify(c));
    await ctx.close(); }
  return { pass, fail, bad };
}
(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  const port = srv.address().port;
  const br = await pw.webkit.launch();
  if (!SELF) {
    const r = await run(br, port);
    console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`yaki-e2e: ${r.pass} passed, ${r.fail} failed`);
    await br.close(); srv.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['確かめから yaki を抜く', 'lib/room-state.mjs', "    if (yakiSum !== 0) missing.push({ what: 'yaki'", "    if (false) missing.push({ what: 'yaki'"],
    ['内訳から yaki を抜く', 'js/gamen-room.mjs', "if (d.used.yaki) parts.push(", "if (false) parts.push("],
    ['窓の種から yaki を抜く', 'js/gamen-room.mjs', "{ kind: 'yaki', label: 'やきとり' }, ", ""],
    ['read() から yakitori を抜く', 'js/gamen-rules.mjs', "yakitori: r.yakitori === true, yakitori_pt:", "zz: 0, yakitori_ptx:"],
    ['pt 0 の見せ方を「あり」に', 'js/gamen-rules.mjs', "'あり・1枚 0 pt＝数えません'", "'1枚 ＝ <b>0</b> pt'"],
    ['off で NaN を残す', 'js/gamen-rules.mjs', "r.yakitori_pt = r.yakitori ? p : (Number.isInteger(p) && p >= 1 && p <= 999 ? p : 0);", "r.yakitori_pt = p;"],
    ['作る門を外す', 'js/gamen-taikyoku.mjs', "if (rules.yakitori === true && !(Number.isInteger", "if (false && !(Number.isInteger"],
    ['missingText で yaki を祝儀と呼ぶ', 'js/gamen-room.mjs', "yaki: 'やきとり', tobi: '飛び賞' };", "yaki: '祝儀', tobi: '飛び賞' };"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port).catch((e) => ({ fail: 1, bad: ["例外 " + String(e.message).split(String.fromCharCode(10))[0]] }));
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）');
    if (r.fail) red++;
  }
  console.log(`yaki-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); process.exit(red === W.length ? 0 : 1);
})();
