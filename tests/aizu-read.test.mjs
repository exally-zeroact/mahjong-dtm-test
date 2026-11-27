/* tests/aizu-read.test.mjs — P1g（pbundle_sadame v2.1 §3.3）合図で読む束ね lib/aizu-read.mjs の期待値
 * 使い方: node tests/aizu-read.test.mjs  /  node tests/aizu-read.test.mjs --self-test（lib をわざと壊して赤になるか）
 * 偽の時計（now・setT・clearT を渡す）で、読みの始めの時刻と同時に走る本数を数える。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib', 'aizu-read.mjs');

/* 偽の時計：時刻 t と札の並び。run(ms) で ms 進める（途中の札を順に呼び、読みの返しの Promise も流す） */
function clock() {
  let t = 0, seq = 0;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setT: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearT: (id) => { timers.delete(id); },
    get t() { return t; },
    count: () => timers.size,
    async run(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end; await flush();
    },
  };
}

/* 読み：返すまで readMs かかる（偽の時計の札で返す）。始めの時刻・同時の最大を数える */
function reader(c, readMs) {
  const r = { starts: [], live: 0, maxLive: 0, fail: false };
  r.fn = () => new Promise((res, rej) => {
    r.starts.push(c.t); r.live++; r.maxLive = Math.max(r.maxLive, r.live);
    c.setT(() => { r.live--; if (r.fail) rej(new Error('net')); else res(); }, readMs);
  });
  return r;
}

async function run(M, quiet) {
  let p = 0, f = 0;
  const ok = (name, cond, ex) => { if (cond) { p++; if (!quiet) console.log('  ✓ ' + name); } else { f++; if (!quiet) console.log('  ✗ ' + name + (ex !== undefined ? '  ' + JSON.stringify(ex) : '')); } };
  const mk = (readMs, o = {}) => { const c = clock(); const r = reader(c, readMs); const a = M.makeAizuRead(r.fn, { delay: 300, gap: 250, now: c.now, setT: c.setT, clearT: c.clearT, ...o }); return { c, r, a }; };

  ok('既定の delay は 300', M.AIZU_DELAY_MS === 300);
  {
    const { c, r, a } = mk(200);
    a.poke(); await c.run(299);
    ok('1回の合図＝0.3秒までは読まない', r.starts.length === 0, r.starts);
    await c.run(1);
    ok('1回の合図＝0.3秒で1回読む', r.starts.length === 1 && r.starts[0] === 300, r.starts);
    await c.run(2000);
    ok('1回の合図＝読みは1回だけ', r.starts.length === 1, r.starts);
  }
  {
    const { c, r, a } = mk(200);
    for (let i = 0; i < 10; i++) { a.poke(); await c.run(20); }
    await c.run(2000);
    ok('待ちの間の連打10回＝1回にまとめる', r.starts.length === 1 && r.starts[0] === 300, r.starts);
  }
  {
    const { c, r, a } = mk(600);
    a.poke(); await c.run(350); // 300 で読み始め・900 まで読み中
    for (let i = 0; i < 50; i++) { a.poke(); await c.run(5); }
    ok('読み中の連打50回＝印は1つ（読み中は1本）', a.state().busy === true && a.state().again === true && r.live === 1, a.state());
    await c.run(3000);
    ok('読み中の連打＝読みはあと1回だけ（計2回）', r.starts.length === 2, r.starts);
    ok('読み中に来た合図＝前の読みが返った時にすぐ読む（900）', r.starts[1] === 900, r.starts);
    ok('同時に走った読みは最大1本', r.maxLive === 1, r.maxLive);
  }
  {
    // 3秒間 10ms ごとに合図（荒らし）・読みは 200ms
    const { c, r, a } = mk(200);
    const sent = [];
    for (let i = 0; i < 300; i++) { a.poke(); sent.push(c.t); await c.run(10); }
    await c.run(3000);
    ok('荒らし300回＝同時の読みは最大1本', r.maxLive === 1, r.maxLive);
    let gapOk = true;
    for (let i = 1; i < r.starts.length; i++) if (r.starts[i] - r.starts[i - 1] < 250) gapOk = false;
    ok('荒らし300回＝読みの始めと始めの間は 250 以上', gapOk, r.starts);
    ok('荒らし300回＝読みは 3秒で 14回以下（250ms に1回より少ない）', r.starts.length <= 14, r.starts.length);
    // どの合図にも、その合図より後に始まった読みが1秒以内に在る
    let worst = 0;
    for (const s of sent) { const st = r.starts.find((x) => x >= s); worst = Math.max(worst, st === undefined ? Infinity : st - s); }
    ok('荒らし300回＝どの合図も1秒以内に後の読みが始まる', worst <= 1000, worst);
  }
  {
    // 読みが gap より短い時：次の読みは前の始めから gap 空ける
    const { c, r, a } = mk(50);
    a.poke(); await c.run(360); // 300 で始め・350 で返る
    a.poke(); await c.run(1000); // 360 の合図＝0.3秒で 660
    ok('読みが返った後の合図＝また 0.3秒で読む', r.starts.length === 2 && r.starts[1] === 660, r.starts);
  }
  {
    const { c, r, a } = mk(100, { delay: 0 });
    a.poke(); await c.run(1); // 0 で始め・100 で返る
    a.poke(); await c.run(1000); // 読み中＝again・100 で返った時は間が足りない（250 まで待つ）
    ok('間が足りない時は捨てずに遅らせて読む（250）', r.starts.length === 2 && r.starts[1] === 250, r.starts);
  }
  {
    const { c, r, a } = mk(50, { delay: 0 });
    a.poke(); await c.run(60); // 0 で始め・50 で返る
    a.poke(); await c.run(1000); // 60 の合図＝delay 0 でも前の始めから 250 空ける
    ok('返った後の合図でも始めと始めの間を空ける（250）', r.starts.length === 2 && r.starts[1] === 250, r.starts);
  }
  {
    const { c, r, a } = mk(200);
    a.poke(); await c.run(100); a.stop();
    ok('stop＝待ちの札をその場で消す', c.count() === 0 && a.state().armed === false, c.count());
    await c.run(2000);
    ok('stop＝待っていた読みをしない', r.starts.length === 0, r.starts);
    a.poke(); await c.run(2000);
    ok('stop の後の合図は読まない', r.starts.length === 0, r.starts);
  }
  {
    const { c, r, a } = mk(400);
    a.poke(); await c.run(400); a.poke(); a.stop(); await c.run(3000);
    ok('読み中に stop＝返った後にもう1回読まない', r.starts.length === 1, r.starts);
  }
  {
    const { c, r, a } = mk(200);
    r.fail = true;
    a.poke(); await c.run(350); a.poke(); await c.run(2000);
    ok('読みが失敗しても止まらない（次の合図で読む）', r.starts.length === 2 && a.state().busy === false, { s: r.starts, st: a.state() });
  }
  return { p, f };
}

const self = process.argv.includes('--self-test');
const L0 = await import(pathToFileURL(LIB).href);
if (!self) {
  const { p, f } = await run(L0, false);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  const src = fs.readFileSync(LIB, 'utf8');
  const W = [
    ['読み中でも重ねて読む（busy を見ない）', 'if (busy) { again = true; return; }', ''],
    ['待ちの札が在っても札を足す（まとめない）', 'if (timer || stopped) return;', 'if (stopped) return;'],
    ['読み中の合図を捨てる（again で読まない）', 'if (again && !stopped) {', 'if (false) {'],
    ['読み中の合図を delay 後に回す（1秒を越す）', 'arm(lastStart + gap - now()); } // 読み中', 'arm(delay * 4); } // 読み中'],
    ['間を見ない', 'if (wait > 0) { arm(wait); return; }', ''],
    ['読みが失敗すると busy のまま', 'try { await read(); } catch { /* 読めなくても次の合図と開いた時の読みが控え */ }', 'await read();'],
    ['stop で札を消さない', 'if (timer) { clearT(timer); timer = null; }', ''],
    ['stop が止めの印を立てない', 'stopped = true; again = false;', 'again = false;'],
    ['既定の delay を 1秒にする', 'export const AIZU_DELAY_MS = 300;', 'export const AIZU_DELAY_MS = 1000;'],
  ];
  let p = 0, f = 0;
  console.log('[aizu-read --self-test] lib をわざと壊して赤になるか');
  if ((await run(L0, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of W) {
    const s = src.replace(/\r\n/g, '\n');
    if (!s.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が lib に無い'); continue; }
    const tmp = path.join(path.dirname(LIB), '.aizu-read.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, s.replace(from, to));
    try {
      const M = await import(pathToFileURL(tmp).href);
      if ((await run(M, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } finally { fs.unlinkSync(tmp); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
