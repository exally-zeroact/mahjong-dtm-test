// B2 飛び賞＝チップと同じ ±・合計0 の画面（tobi_chip_v3.md 段2）の自己確認。node gamen_tobi-e2e.cjs <作業木> [--old <古い版の作業木>] [--self] [--chromium]
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require('playwright');
const ROOT = path.resolve(process.argv[2]);
const SELF = process.argv.includes('--self');
const oi = process.argv.indexOf('--old'), OLD = oi > 0 ? path.resolve(process.argv[oi + 1]) : null;
const MT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const H = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/gamen.css"><div id="app"></div><div id="rr"></div>
<script type="module">
import { mountRoom } from '/js/gamen-room.mjs';
import { mountRules } from '/js/gamen-rules.mjs';
import { emptyState, applyOps } from '/lib/room-state.mjs';
import { defaultRules } from '/lib/rules.mjs';
const p = new URLSearchParams(location.search);
const R = { ...defaultRules(4), rate: 50, chip_pt10: null, shugi_pt10: null, tobi: p.get('t') !== '0', tobi_pt: Number(p.get('pt') ?? 10) };
if (p.get('mode') === 'rules') { window.ctl = mountRules(document.getElementById('rr'), { rules: { ...R } }); }
else {
  if (p.get('keep') !== '1') {
    let st = emptyState(); st.rules = R;
    const ops = [
      { op: 'member_add', member_id: 'm1', name: '山田' }, { op: 'member_add', member_id: 'm2', name: '鈴木' },
      { op: 'member_add', member_id: 'm3', name: '佐藤' }, { op: 'member_add', member_id: 'm4', name: '高橋' },
      { op: 'session_add', session_id: 's1', date: '2026-11-21', rate: 50 },
      { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
      { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: p.get('bust') === '0' ? [40000, 30000, 20000, 10000] : [50000, 30000, 25000, -5000] },
    ];
    if (p.get('ex') === '1') ops.push({ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'tobi', add: 1 }, { op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'tobi', add: -1 });
    const r = applyOps(st, ops, { roomRules: R, now: '2026-11-21T00:00:00Z' });
    if (!r.ok) document.body.dataset.err = JSON.stringify(r.res || r);
    localStorage.setItem('mj-room:u1:r1', JSON.stringify(r.state));
    localStorage.setItem('mj-seats:u1:r1', JSON.stringify({ table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'] }));
    window.__st = JSON.stringify(r.state);
  }
  if (p.get('build') !== '1') mountRoom(document.getElementById('app'), { me: { id: 'u1' }, room: { room_id: 'r1', rules: R }, showShare() {}, bar() {}, page: p.get('page') || 'room' });
}
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
const srv = mk(ROOT, true), srvOld = OLD ? mk(OLD, false) : null;
async function run(br, port, portOld) {
  let pass = 0, fail = 0; const bad = [];
  const ok = (name, c, info) => { if (c) pass++; else { fail++; bad.push(name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
  const open = async (qs, p = port, init) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); if (init) await ctx.addInitScript(init.fn, init.arg); const pg = await ctx.newPage(); pg.setDefaultTimeout(SELF ? 4000 : 30000); await pg.goto(`http://127.0.0.1:${p}/__h.html?${qs}`); await pg.waitForSelector('body[data-ready="1"]', { state: 'attached' }); return { pg, ctx }; };
  const all = (pg, s) => pg.evaluate((x) => [...document.querySelectorAll(x)].map((e) => e.textContent).join('|'), s);
  const card = (pg, nm, s) => pg.evaluate(([n, x]) => { const c = [...document.querySelectorAll('.r-card')].find((y) => y.querySelector('.r-w-name')?.textContent === n); return c && c.querySelector(x) ? c.querySelector(x).textContent : null; }, [nm, s]);
  const toNum = (s) => Number(String(s).replace('−', '-').replace(/[+,]/g, ''));
  const wval = (pg, nm) => pg.evaluate((n) => { const w = [...document.querySelectorAll('.r-w')].find((x) => x.querySelector('.r-w-name').textContent === n); if (!w) return null; const i = [...w.querySelectorAll('.r-w-k')].findIndex((k) => k.textContent.startsWith('飛び賞')); return i < 0 ? null : w.querySelectorAll('.r-w-val')[i].textContent; }, nm);
  try {
    // 0. 土台（飛び賞 on 10pt・飛んだ半荘・枚を入れない）
    let base;
    { const { pg, ctx } = await open('');
      ok('A 門を通る（err 無し）', !(await pg.evaluate(() => document.body.dataset.err)), await pg.evaluate(() => document.body.dataset.err));
      ok('A 飛び賞の − ＋ が 4人×2', (await pg.$$('.r-pm[data-k="tobi"]')).length === 8);
      ok('A 1枚＝500（10pt×レート50）', (await all(pg, '.r-w-k')).includes('飛び賞1枚＝500'), await all(pg, '.r-w-k'));
      ok('A 飛んだのに0枚＝窓に「飛び賞が入っていません」', ((await all(pg, '#rTobiHint')) || '').includes('飛び賞が入っていません'));
      ok('A ヒントは止めない＝✓ 飛び賞の合計 0', (await all(pg, '.r-check.ok')).includes('飛び賞の合計 0'), await all(pg, '.r-check'));
      ok('A 受け取りの字が無い', !/受け取/.test(await pg.locator('#app').innerText()));
      await pg.click('#rSeisan');
      ok('A 精算にもヒント', ((await all(pg, '#rTobiHint')) || '').includes('飛び賞が入っていません'));
      ok('A 精算は額を出す（止めない）', (await pg.$$('.r-card')).length === 4);
      base = { a: toNum(await card(pg, '山田', '.r-card-big')), d: toNum(await card(pg, '高橋', '.r-card-big')) };
      await ctx.close(); }
    { const { pg, ctx } = await open('');
      const sm = await pg.locator('#app').innerText();
      ok('H 表の小さい字の − は全角（4位 −5,000）', sm.includes('4位 −5,000') && !/-d/.test(sm), sm.slice(0, 200));
      await ctx.close(); }
    // 1. 山田 +1・高橋 −1
    { const { pg, ctx } = await open('');
      await pg.click('.r-pm[data-k="tobi"][data-m="m1"][data-a="1"]'); await pg.click('.r-pm[data-k="tobi"][data-m="m4"][data-a="-1"]');
      ok('B ±1：ヒントが消える', (await pg.$$('#rTobiHint')).length === 0);
      ok('B ±1：✓ 飛び賞の合計 0', (await all(pg, '.r-check.ok')).includes('飛び賞の合計 0'), await all(pg, '.r-check'));
      ok('B ±1：窓 山田 +500・高橋 −500', (await wval(pg, '山田')) === '+500' && (await wval(pg, '高橋')) === '−500', [await wval(pg, '山田'), await wval(pg, '高橋')]);
      await pg.click('#rSeisan');
      const a = toNum(await card(pg, '山田', '.r-card-big')), d = toNum(await card(pg, '高橋', '.r-card-big'));
      ok('B ±1：精算 山田＝土台＋500・高橋＝土台−500', a === base.a + 500 && d === base.d - 500, [base, a, d]);
      ok('B ±1：内訳「飛び賞 +1枚 +10.0」', ((await card(pg, '山田', '.r-card-sub')) || '').includes('飛び賞 +1枚 +10.0'), await card(pg, '山田', '.r-card-sub'));
      ok('B ±1：精算の✓に「飛び賞0」', (await all(pg, '.r-check')).includes('飛び賞0'), await all(pg, '.r-check'));
      ok('B ±1：精算のヒントも消える', (await pg.$$('#rTobiHint')).length === 0);
      await ctx.close(); }
    // 2. 山田 +1 だけ
    { const { pg, ctx } = await open('');
      await pg.click('.r-pm[data-k="tobi"][data-m="m1"][data-a="1"]');
      ok('C +1 だけ：「飛び賞の合計が +1 合いません」', (await all(pg, '.r-check.bad')).includes('飛び賞の合計が +1 合いません'), await all(pg, '.r-check'));
      await pg.click('#rSeisan');
      const body = await all(pg, '.r-red, .r-red-btn');
      ok('C +1 だけ：入っていない物「飛び賞の合計が +1 で合いません（飛び賞を入れていません）」', body.includes('飛び賞の合計が +1 で合いません（飛び賞を入れていません）'), body);
      ok('C +1 だけ：額の札を出さない', (await pg.$$('.r-card')).length === 0);
      await ctx.close(); }
    // 3. 使わない卓（tobi false・pt 0）と飛んでいない卓
    for (const [qs, nm] of [['t=0', 'tobi false'], ['pt=0', 'pt 0']]) {
      const { pg, ctx } = await open(qs);
      ok('D ' + nm + '：飛び賞の行もヒントも出ない', (await pg.$$('.r-pm[data-k="tobi"]')).length === 0 && (await pg.$$('#rTobiHint')).length === 0);
      await ctx.close();
    }
    { const { pg, ctx } = await open('bust=0');
      ok('D 飛んでいない：行は出る・ヒントは出ない', (await pg.$$('.r-pm[data-k="tobi"]')).length === 8 && (await pg.$$('#rTobiHint')).length === 0);
      await ctx.close(); }
    // 4. 点を入れる＝飛んでも受け取りを選ぶ段が無い・tobi_to を付けない
    { const { pg, ctx } = await open('');
      await pg.click('#rAdd');
      const put = async (i, s, neg) => { await pg.click('[data-c="' + i + '"]'); await pg.keyboard.type(s); if (neg) await pg.click('#eKp [data-kp="neg"]'); };
      await put(0, '60000'); await put(1, '30000'); await put(2, '15000'); await put(3, '5000', true);
      await pg.click('#eKp [data-kp="ok"]'); await pg.click('#eOk');
      const hs = await pg.evaluate(() => JSON.parse(localStorage.getItem('mj-room:u1:r1')).hanchans);
      ok('E 飛んだ半荘がそのまま入る', hs.length === 2 && hs[1].cells.join() === '60000,30000,15000,-5000', hs.map((h) => h.cells));
      ok('E 受け取りの段に行かない', !/飛びました|受け取/.test(await pg.locator('#app').innerText()));
      ok('E tobi_to は空', hs[1] && Object.keys(hs[1].tobi_to || {}).length === 0, hs[1] && hs[1].tobi_to);
      await ctx.close(); }
    // 5. ルールの画面＝払う先は隠す・鍵は残す
    { const { pg, ctx } = await open('mode=rules');
      await pg.evaluate(() => { for (const x of document.querySelectorAll('[data-open], .li')) if (/細か|詳し|その他/.test(x.textContent)) x.click(); });
      const t = await pg.locator('#rr').innerText();
      ok('F 払う先の字が無い', !t.includes('飛び賞を払う先'));
      ok('F 細かいルールは開いている（同じ点が見える）', t.includes('同じ点'), t.slice(0, 300));
      const r = await pg.evaluate(() => window.ctl.read());
      ok('F read() に tobi_from が残る', r.tobi_from === 'busted', r.tobi_from);
      await ctx.close(); }
    // 6. 古い版の端末＝tobi の行で門が newer＝「アプリを新しくしてください」
    if (portOld) {
      const b = await open('ex=1&build=1');
      const stJson = await b.pg.evaluate(() => window.__st); await b.ctx.close();
      ok('G 新しい版の写しに tobi の行', /"kind":"tobi"/.test(stJson || ''));
      const o = await open('keep=1&ex=1', portOld, { fn: ([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('mj-seats:u1:r1', JSON.stringify({ table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'] })); }, arg: ['mj-room:u1:r1', stJson] });
      const g = (await all(o.pg, '#rGate')) || '';
      ok('G 古い版は門で止めて「新しくしてください」', g.includes('アプリを新しくしてください'), g);
      ok('G 古い版は表を作らない', (await o.pg.$$('.r-pm')).length === 0 && (await o.pg.$$('#rAdd')).length === 0);
      await o.ctx.close();
    }
  } catch (e) { fail++; bad.push('例外 ' + String(e.message).split('\n')[0]); }
  return { pass, fail, bad };
}
(async () => {
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  if (srvOld) await new Promise((s) => srvOld.listen(0, '127.0.0.1', s));
  const port = srv.address().port, portOld = srvOld ? srvOld.address().port : null;
  const br = await (process.argv.includes('--chromium') ? pw.chromium : pw.webkit).launch();
  if (!SELF) {
    const r = await run(br, port, portOld);
    if (r.bad.length) console.log(r.bad.map((b) => '✗ ' + b).join('\n'));
    console.log(`tobi-e2e: ${r.pass} passed, ${r.fail} failed${portOld ? '' : '（古い版は見ていない＝--old）'}`);
    await br.close(); srv.close(); if (srvOld) srvOld.close(); process.exit(r.fail ? 1 : 0);
  }
  const W = [
    ['表の小さい字を半角に戻す', 'js/gamen-room.mjs', "(c.rank + 1) + '位 ' : '') + boxNum(c.cell);", "(c.rank + 1) + '位 ' : '') + c.cell.toLocaleString('ja-JP');"],
    ['窓の種から tobi を抜く', 'js/gamen-room.mjs', ", { kind: 'tobi', label: '飛び賞' }];", "];"],
    ['窓のヒントを出さない', 'js/gamen-room.mjs', "const tobiHintLine = (on) => (on ?", "const tobiHintLine = (on) => (false ?"],
    ['精算のヒントを出さない', 'js/gamen-room.mjs', "h += tobiHintLine(st.tables.some(", "h += tobiHintLine(false && st.tables.some("],
    ['入っていない物で飛び賞を祝儀と呼ぶ', 'js/gamen-room.mjs', "tobi: '飛び賞' };", "tobi: '祝儀' };"],
    ['内訳から飛び賞を抜く', 'js/gamen-room.mjs', "if (d.used.tobi) parts.push(", "if (false) parts.push("],
    ['精算の✓から飛び賞0を抜く', 'js/gamen-room.mjs', "(d.used.tobi ? '・飛び賞0' : '')", "''"],
    ['払う先を見せる', 'js/gamen-rules.mjs', "for (const d of DETAIL) if (!d.hide) h += ", "for (const d of DETAIL) h += "],
    ['隠した鍵を保存で落とす', 'js/gamen-rules.mjs', "for (const d of DETAIL) out[d.key] = r[d.key];", "for (const d of DETAIL) if (!d.hide) out[d.key] = r[d.key];"],
    ['点を入れる時に tobi_to を付ける', 'js/gamen-room.mjs', "cells: e.num, lost: e.lostNum };", "cells: e.num, lost: e.lostNum, tobi_to: { 3: 0 } };"],
  ];
  let red = 0;
  for (const [nm, file, from, to] of W) {
    mutate = { file: file.replace(/\//g, path.sep), from, to };
    const r = await run(br, port, portOld);
    console.log((r.fail ? '✓ 赤 ' : '✗ 緑のまま ') + nm + '（' + r.fail + '）');
    if (r.fail) red++;
  }
  console.log(`tobi-e2e self: ${red}/${W.length} 赤`);
  await br.close(); srv.close(); if (srvOld) srvOld.close(); process.exit(red === W.length ? 0 : 1);
})();
