/* shanten.mjs — ★シャンテン・待ち・受け入れ★（待ち読みの計算・設計 tataki/keisan_sekkei_v1.md 件2）
 * =============================================================================
 * 手は34の数え（lib/tiles.mjs）。手の枚数 n：
 *   n = 3k+1（1・4・7・10・13）＝待ちを見る／n = 3k+2（2・5・8・11・14）＝何を切るかを見る。
 *   足りない分は鳴いた面子（called = 4 − k）とみなす。七対子・国士は鳴いていない時（13/14枚）だけ。
 *   n = 3k（3・6・9・12）は形にならない＝null。
 * シャンテン（−1＝和了・0＝聴牌）：
 *   一般形＝色ごとに「面子・塔子・雀頭」の分け方を全部出して（色ごとに控える）、合わせて 8−2面子−塔子−雀頭 の一番小さい物。
 *          面子＋塔子は 4 まで（超えた塔子は数えない）。
 *   七対子＝6 − 対子の種類 + max(0, 7 − 種類)（同じ牌4枚は対子1つ）。
 *   国士＝13 − 么九の種類 − (么九の対子があれば1)。
 * 和了の判定（シャンテンとは別の作り＝試験で突き合わせる）：
 *   一般形＝雀頭を決めて、一番小さい牌から刻子か順子を取っていく。七対子＝7種がちょうど2枚ずつ。国士＝么九13種＋どれか1枚。
 * ★純空（手で4枚使っている牌）★：一般形は5枚目を足した形も和了と見る＝待ちに数え、残りは0と出す
 *   （シャンテンの式も同じ形を聴牌と数える＝両方が同じ決め）。七対子は同じ牌を2枚ちょうどしか認めない（4枚は対子2つにしない）。
 * 残り＝4 − 手の数 − 見えている数（下は0）。3人の時は 2m〜8m は無い牌＝残り0・待ちにも受け入れにも入れない。
 */
import { YAOCHU } from './tiles.mjs';

const memo = new Map();
/* 1色（9か7）の分け方の全部：[面子, 塔子, 雀頭] の組み（良い物だけ） */
function suitOptions(cs, honor) {
  const key = (honor ? 'z' : 's') + cs.join('');
  const hit = memo.get(key);
  if (hit) return hit;
  const out = new Map();
  const c = cs.slice();
  const len = c.length;
  function rec(i, m, t, p) {
    while (i < len && c[i] === 0) i++;
    if (i >= len) { const k = m * 100 + t * 10 + p; out.set(k, [m, t, p]); return; }
    if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, p); c[i] += 3; }
    if (!honor && i + 2 < len && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      if (!p) { c[i] -= 2; rec(i, m, t, 1); c[i] += 2; }
      c[i] -= 2; rec(i, m, t + 1, p); c[i] += 2;
    }
    if (!honor && i + 1 < len && c[i + 1]) { c[i]--; c[i + 1]--; rec(i, m, t + 1, p); c[i]++; c[i + 1]++; }
    if (!honor && i + 2 < len && c[i + 2]) { c[i]--; c[i + 2]--; rec(i, m, t + 1, p); c[i]++; c[i + 2]++; }
    c[i]--; rec(i, m, t, p); c[i]++;
  }
  rec(0, 0, 0, 0);
  /* 同じ雀頭の有無の中で、面子も「面子＋塔子」も劣る物は捨てる（速さのため）。
   * 答え＝8 − 面子 − min(面子＋塔子, 4) − 雀頭 は面子と「面子＋塔子」が多いほど小さい＝捨てても答えは変わらない。
   * 雀頭のある組みとない組みは比べない（雀頭は全体で1つまで＝ある方が良いとは限らない）。 */
  const all = [...out.values()];
  const keep = all.filter((a) => !all.some((b) => b !== a && b[2] === a[2] && b[0] >= a[0] && b[0] + b[1] >= a[0] + a[1] && (b[0] > a[0] || b[0] + b[1] > a[0] + a[1])));
  memo.set(key, keep);
  return keep;
}

export const tileCount = (c) => c.reduce((a, b) => a + b, 0);
function calledOf(n) {
  if (n % 3 === 0) return null;
  return n % 3 === 1 ? (13 - n) / 3 : (14 - n) / 3;
}

export function shantenNormal(c) {
  const called = calledOf(tileCount(c));
  if (called === null) return null;
  const parts = [suitOptions(c.slice(0, 9), false), suitOptions(c.slice(9, 18), false), suitOptions(c.slice(18, 27), false), suitOptions(c.slice(27, 34), true)];
  let best = 8;
  for (const a of parts[0]) for (const b of parts[1]) for (const d of parts[2]) for (const e of parts[3]) {
    const p = a[2] + b[2] + d[2] + e[2];
    if (p > 1) continue;
    const m = called + a[0] + b[0] + d[0] + e[0];
    let t = a[1] + b[1] + d[1] + e[1];
    if (m + t > 4) t = 4 - m;
    const s = 8 - 2 * m - t - p;
    if (s < best) best = s;
  }
  return best;
}
export function shantenChiitoi(c) {
  const n = tileCount(c);
  if (n !== 13 && n !== 14) return null;
  let pairs = 0, kinds = 0;
  for (const x of c) { if (x >= 1) kinds++; if (x >= 2) pairs++; }
  return 6 - pairs + Math.max(0, 7 - kinds);
}
export function shantenKokushi(c) {
  const n = tileCount(c);
  if (n !== 13 && n !== 14) return null;
  let kinds = 0, pair = 0;
  for (const i of YAOCHU) { if (c[i] >= 1) kinds++; if (c[i] >= 2) pair = 1; }
  return 13 - kinds - pair;
}
export function shantenAll(c) {
  const normal = shantenNormal(c), chiitoi = shantenChiitoi(c), kokushi = shantenKokushi(c);
  const v = [normal, chiitoi, kokushi].filter((x) => x !== null);
  return { best: v.length ? Math.min(...v) : null, normal, chiitoi, kokushi };
}

/* ── 和了の判定（別の作り） ── */
function takeSets(c, i) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) { c[i] -= 3; const ok = takeSets(c, i); c[i] += 3; if (ok) return true; }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; const ok = takeSets(c, i); c[i]++; c[i + 1]++; c[i + 2]++; return ok; }
  return false;
}
export function isAgariNormal(c) {
  const n = tileCount(c);
  if (n % 3 !== 2) return false;
  const w = c.slice();
  for (let i = 0; i < 34; i++) {
    if (w[i] < 2) continue;
    w[i] -= 2;
    const ok = takeSets(w, 0);
    w[i] += 2;
    if (ok) return true;
  }
  return false;
}
export function isAgariChiitoi(c) {
  if (tileCount(c) !== 14) return false;
  let k = 0;
  for (const x of c) { if (x === 2) k++; else if (x !== 0) return false; }
  return k === 7;
}
export function isAgariKokushi(c) {
  if (tileCount(c) !== 14) return false;
  let pair = 0;
  for (let i = 0; i < 34; i++) {
    if (!YAOCHU.includes(i)) { if (c[i]) return false; continue; }
    if (c[i] === 0) return false;
    if (c[i] === 2) pair++;
    else if (c[i] !== 1) return false;
  }
  return pair === 1;
}
export const isAgari = (c) => isAgariNormal(c) || isAgariChiitoi(c) || isAgariKokushi(c);

/* ── 画面が使う答え ── */
const SANMA_NONE = new Set([1, 2, 3, 4, 5, 6, 7]); // 2m〜8m
export const exists = (i, players) => !(players === 3 && SANMA_NONE.has(i));
export function remaining(c, seen, i) {
  return Math.max(0, 4 - c[i] - (seen ? seen[i] : 0));
}

/** 13枚（3k+1）の待ち：和了になる牌の全部（純空も入れる・残り0） */
export function waits(c, seen = null, players = 4) {
  const n = tileCount(c);
  if (n % 3 !== 1) return null;
  const out = [];
  for (let i = 0; i < 34; i++) {
    if (!exists(i, players)) continue;
    c[i]++;
    const ok = isAgari(c);
    c[i]--;
    if (ok) out.push({ tile: i, left: remaining(c, seen, i) });
  }
  return out;
}

/** 受け入れ：足すとシャンテンが下がる牌（形ごと）。kind = 'best'｜'normal'｜'chiitoi'｜'kokushi' */
const FN = { best: (c) => shantenAll(c).best, normal: shantenNormal, chiitoi: shantenChiitoi, kokushi: shantenKokushi };
export function ukeire(c, seen = null, players = 4, kind = 'best') {
  const f = FN[kind];
  const now = f(c);
  if (now === null) return null;
  const tiles = [];
  let total = 0;
  for (let i = 0; i < 34; i++) {
    if (!exists(i, players) || c[i] >= 4) continue; // 手で4枚持つ牌は引けない＝受け入れに数えない（待ちの純空とは別・11-20 taiketsu-naoshi の任意1）
    c[i]++;
    const s = f(c);
    c[i]--;
    if (s !== null && s < now) { const left = remaining(c, seen, i); tiles.push({ tile: i, left }); total += left; }
  }
  return { shanten: now, tiles, kinds: tiles.length, total };
}

/** 13枚の答え（画面の上の段）：シャンテン（形ごと）・待ち（聴牌の時）・受け入れ（形ごと） */
export function analyze13(c, seen = null, players = 4) {
  const s = shantenAll(c);
  if (s.best === null) return null;
  const res = { shanten: s, ukeire: {} };
  for (const k of ['best', 'normal', 'chiitoi', 'kokushi']) if (k === 'best' || s[k] !== null) res.ukeire[k] = ukeire(c, seen, players, k);
  if (s.best === 0) {
    res.waits = waits(c, seen, players);
    res.waitTotal = res.waits.reduce((a, w) => a + w.left, 0);
  }
  return res;
}

/** 14枚（3k+2）：切る牌ごとの［シャンテン・受け入れ］を良い順（シャンテン小→枚数多→種類多→牌の順） */
export function analyze14(c, seen = null, players = 4) {
  const n = tileCount(c);
  if (n % 3 !== 2) return null;
  const agari = isAgari(c);
  const rows = [];
  for (let i = 0; i < 34; i++) {
    if (!c[i]) continue;
    c[i]--;
    const u = ukeire(c, seen, players, 'best');
    const w = u.shanten === 0 ? waits(c, seen, players) : null;
    c[i]++;
    rows.push({ discard: i, shanten: u.shanten, kinds: u.kinds, total: u.total, tiles: u.tiles, waits: w });
  }
  rows.sort((a, b) => a.shanten - b.shanten || b.total - a.total || b.kinds - a.kinds || a.discard - b.discard);
  return { agari, shanten: shantenAll(c), rows };
}
