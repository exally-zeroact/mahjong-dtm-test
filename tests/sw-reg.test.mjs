/* sw-reg.test.mjs — js/sw-reg.js の帯「新しい版があります」の取りこぼし（定め swflake v2・11-26）
 * 真似の navigator.serviceWorker の上で sw-reg.js を走らせ、updatefound が来ないまま waiting が出来る形でも帯が出るかを見る。
 * a 版の知らせ（version.json 違い）→ update() が waiting ありで返る（updatefound 無し）＝帯（3本並べ 600回の赤30 の形）
 * b 見えた時の update() が waiting ありで返る＝帯
 * c updatefound の時にもう installing=null・waiting あり＝帯
 * d 初めての取り込み（controller 無し）＝帯を出さない
 * e waiting が active と同じ＝帯を出さない
 * f ［入れ替える］を押した時 waiting 無し→ update() が waiting ありで返る（updatefound 無し）＝30 秒待たずに SKIP_WAITING
 * g 見えた時と版の知らせが重なっても update は1本ずつ（swupd v1.3.1 §3）
 * h 画面が続きの置き場 mj-part を作る・MJ_NO_PART の時は作らない（v1.3.1 §1）
 * --self-test＝sw-reg.js をわざと壊した写しで、壊しごとに赤になるか（CI 床＝壊しの数）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/sw-reg.js'), 'utf8').replace(/\r\n/g, '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAND = '新しい版があります';

function makeEl() {
  const cls = new Set();
  return { hidden: false, textContent: '', className: '', type: '', onclick: null, kids: [], setAttribute() {}, appendChild(c) { this.kids.push(c); },
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) } };
}

/** opt: ctl（controller が在る）・ver（version.json の答え）・onUpdate(reg, env)（update() が返る直前に呼ぶ） */
function makeEnv(src, opt = {}) {
  const A = { state: 'activated', postMessage() {} };
  const posted = [];
  const W = { state: 'installed', postMessage: (m) => posted.push(m), addEventListener() {} };
  const regL = {};
  const reg = {
    installing: null, waiting: null, active: A, updates: 0,
    addEventListener: (t, fn) => { (regL[t] = regL[t] || []).push(fn); },
    update() { reg.updates++; return (opt.updMs ? sleep(opt.updMs) : Promise.resolve()).then(() => { if (opt.onUpdate) opt.onUpdate(reg, env); }); },
  };
  const docL = {};
  const body = makeEl();
  const document = {
    visibilityState: 'visible', body,
    querySelector: (s) => (s === 'meta[name="mj-ver"]' ? { getAttribute: () => 'V0' } : null),
    createElement: () => makeEl(),
    addEventListener: (t, fn) => { (docL[t] = docL[t] || []).push(fn); },
  };
  const sw = {
    controller: opt.ctl === false ? null : A,
    addEventListener() {},
    register: () => Promise.resolve(reg),
  };
  const opened = [];
  const caches = { open: (n) => { opened.push(n); return Promise.resolve({}); } };
  const window = { dispatchEvent: () => true, caches, MJ_NO_PART: opt.noPart ? 1 : undefined };
  const fetch = async () => ({ ok: true, json: async () => ({ ver: opt.ver || 'V0' }) });
  class CustomEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } }
  const ctx = {
    navigator: { serviceWorker: sw }, document, window, caches, fetch, CustomEvent, Date, Promise, setTimeout, clearTimeout,
    sessionStorage: { removeItem() {}, setItem() {} }, location: { reload() {} }, console,
  };
  const env = {
    reg, W, A, posted, opened,
    band() { const b = body.kids[0]; return b && !b.hidden ? b.kids[0].textContent : ''; },
    tap() { const b = body.kids[0]; if (b && b.kids[1].onclick) b.kids[1].onclick(); },
    fire(t) { for (const fn of regL[t] || []) fn(); },
    visible() { for (const fn of docL.visibilitychange || []) fn(); },
  };
  vm.runInNewContext(src, ctx, { filename: 'sw-reg.js' });
  return env;
}

async function run(src, quiet) {
  let p = 0, f = 0;
  const ok = (name, cond) => { if (cond) p++; else f++; if (!quiet || !cond) console.log(`${cond ? '  ✓' : '  ✗'} ${name}`); };
  const toWaiting = (reg, env) => { reg.waiting = env.W; };
  {
    const e = makeEnv(src, { ver: 'V1', onUpdate: toWaiting });
    await sleep(20);
    ok('a 版の知らせ→update が waiting ありで返る（updatefound 無し）＝帯', e.band() === BAND);
  }
  {
    let on = false;
    const e = makeEnv(src, { onUpdate: (reg, env) => { if (on) toWaiting(reg, env); } });
    await sleep(20);
    const before = e.band();
    on = true; e.visible();
    await sleep(20);
    ok('b 見えた時の update が waiting ありで返る＝帯', before === '' && e.band() === BAND);
  }
  {
    const e = makeEnv(src);
    await sleep(20);
    e.reg.waiting = e.W; e.fire('updatefound');
    await sleep(5);
    ok('c updatefound の時にもう installing=null・waiting あり＝帯', e.band() === BAND);
  }
  {
    const e = makeEnv(src, { ctl: false, ver: 'V1', onUpdate: toWaiting });
    await sleep(20);
    e.fire('updatefound'); e.visible();
    await sleep(20);
    ok('d 初めての取り込み（controller 無し）＝帯を出さない', e.band() === '');
  }
  {
    const e = makeEnv(src, { ver: 'V1', onUpdate: (reg) => { reg.waiting = reg.active; } });
    await sleep(20);
    e.fire('updatefound');
    await sleep(5);
    ok('e waiting が active と同じ＝帯を出さない', e.band() === '');
  }
  {
    let on = false;
    const e = makeEnv(src, { onUpdate: (reg, env) => { if (on) toWaiting(reg, env); } });
    await sleep(20);
    // 帯を出してから waiting を消す（前の版の取り込みが捨てられた形）→ 押すと取り直し
    e.reg.waiting = e.W; e.fire('updatefound'); await sleep(5);
    e.reg.waiting = null; on = true;
    e.tap();
    await sleep(50);
    ok('f 押した時 waiting 無し→update が waiting ありで返る＝すぐ SKIP_WAITING', e.posted.length === 1 && e.posted[0].type === 'SKIP_WAITING');
  }
  {
    const e = makeEnv(src, { ver: 'V1', updMs: 40 });
    await sleep(5); // register の後（見えた時の聞き手が付いた後）
    e.visible();
    await sleep(10);
    const mid = e.reg.updates;
    await sleep(80);
    ok('g 見えた時と版の知らせが重なっても update は1本ずつ', mid === 1 && e.reg.updates === 1);
    e.visible();
    await sleep(80);
    ok('g 前の update が返った後の update は走る', e.reg.updates === 2);
  }
  {
    const e = makeEnv(src);
    const e2 = makeEnv(src, { noPart: true });
    await sleep(5);
    ok('h 画面が mj-part を作る', JSON.stringify(e.opened) === JSON.stringify(['mj-part']));
    ok('h MJ_NO_PART の時は作らない', e2.opened.length === 0);
  }
  return { p, f };
}

const rep = (a, b) => (s) => { if (!s.includes(a)) throw new Error('壊しの字が見つからない：' + a); return s.split(a).join(b); };
const BREAKS = [
  ['版の知らせの update の後に帯を見ない', rep('(p || upd(reg)).then(function () { maybeOffer(reg); }, function () {});', '(p || upd(reg)).catch(function () {});')],
  ['見えた時の update の後に帯を見ない', rep("      p.then(function () { maybeOffer(reg); }, function () {});\n", "      p.catch(function () {});\n")],
  ['updatefound で waiting を見ない', rep('track(reg, reg.installing); maybeOffer(reg); });', 'track(reg, reg.installing); });')],
  ['押した時の update の後に waiting を見ない', rep('upd(reg).then(check, function () {});', 'upd(reg).catch(function () {});')],
  ['update を並べてよい', rep('    if (inflight) return inflight;\n', '')],
  ['画面が mj-part を作らない', rep("caches.open('mj-part')", 'Promise.resolve()')],
  ['帯の判じで controller を見ない', rep('reg.waiting !== reg.active && sw.controller && !swapping', 'reg.waiting !== reg.active && !swapping')],
  ['帯の判じで active と同じかを見ない', rep('reg.waiting && reg.active && reg.waiting !== reg.active && sw.controller', 'reg.waiting && reg.active && sw.controller')],
];

if (process.argv.includes('--self-test')) {
  const base = await run(SRC, true);
  if (base.f) { console.log(`✗ 壊す前に赤が ${base.f} 本（先に本番の試験を緑に）`); process.exit(1); }
  let red = 0;
  for (const [name, b] of BREAKS) {
    let res;
    try { res = await run(b(SRC), true); } catch (err) { console.log(`  ✗ 壊しが作れない：${name} — ${err.message}`); continue; }
    if (res.f > 0) { red++; console.log(`  ✓ 赤になった：${name}`); } else console.log(`  ✗ 壊しても緑のまま：${name}`);
  }
  console.log(`自己確認: ${red}/${BREAKS.length}`);
  process.exitCode = red === BREAKS.length ? 0 : 1;
} else {
  const { p, f } = await run(SRC, false);
  console.log(`\nsw-reg: ${p} passed, ${f} failed`);
  process.exitCode = f ? 1 : 0;
}
