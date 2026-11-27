/* P1g（pbundle_sadame v2.1 §3.3）：合図（event 'w'）で読む時の束ね。
 * 部屋の人が合図を連打しても、1部屋の読みは「読み中1本＋待ち1本」まで（何回来ても待ちは1本）。
 * 合図から読みの始めまでは delay（0.3秒）か、読み中の1本が終わるまで＝1秒を越さない（2c2f_sadame v1.2「1秒かからんように」）。
 * 読みの始めと始めの間は gap（AIZU_GAP_MS）空ける（部屋の頁 gamen-room の sync と同じ間）。
 *
 * makeAizuRead(read, { delay, gap, now, setT, clearT })
 *   poke()  合図が来た。読み中なら「もう1回」の印だけ。待ちの札が在れば何もしない（その読みが合図の後に始まる）。無ければ delay 後に読む
 *   stop()  札を消し、これから読まない（読み中の返しを捨てるのは呼ぶ側）
 *   state() { busy, again, armed }（試験用）
 */
import { AIZU_GAP_MS } from './outbox.mjs';

export const AIZU_DELAY_MS = 300;

export function makeAizuRead(read, o = {}) {
  const delay = o.delay ?? AIZU_DELAY_MS;
  const gap = o.gap ?? AIZU_GAP_MS;
  const now = o.now || Date.now;
  const setT = o.setT || setTimeout;
  const clearT = o.clearT || clearTimeout;
  let busy = false, again = false, timer = null, stopped = false, lastStart = -Infinity;

  function arm(ms) {
    if (timer || stopped) return;
    timer = setT(fire, Math.max(0, ms));
  }
  async function fire() {
    timer = null;
    if (stopped) return;
    const wait = lastStart + gap - now();
    if (wait > 0) { arm(wait); return; }
    busy = true; again = false; lastStart = now(); // 今から読む＝これより前の合図はこの読みで足りる
    try { await read(); } catch { /* 読めなくても次の合図と開いた時の読みが控え */ }
    busy = false;
    if (again && !stopped) { again = false; arm(lastStart + gap - now()); } // 読み中に来た合図＝すぐ1回（間だけ守る）
  }
  return {
    poke() {
      if (stopped) return;
      if (busy) { again = true; return; }
      arm(delay);
    },
    stop() {
      stopped = true; again = false;
      if (timer) { clearT(timer); timer = null; }
    },
    state: () => ({ busy, again, armed: !!timer }),
  };
}
