/* shanten.test.mjs — ★待ち・シャンテン・受け入れを、作り方の違う物どうしで突き合わせる★（設計図 §試験 待ち・シャンテン）
 * ① 清一色13枚の全部の組み合わせ（萬子だけ・各0〜4枚・13枚＝93,600通り）で「シャンテンの式が0」⇔「和了の判定で待ちが1つ以上」
 * ② シャンテンの式 と 「1枚替えて聴牌になるか」の探索（和了の判定だけで作る・式を使わない）を、乱数の手と狙った手で突き合わせ
 *    （設計図の「表を引く別の作り」を、この探索に替えた＝tataki/keisan_sekkei_v1.md v1.1）
 * ③ 手で書いた正解表（九蓮9面・国士13面・純空・七対子の4枚・ノベタン・嵌張と両面・枚数の合わない手・和了の14枚・3人・見えている牌）
 * node tests/shanten.test.mjs / --self-test（式をわざと壊して赤になるか）
 */
import { toCounts, parse, indexToCode } from '../lib/tiles.mjs';
import * as S from '../lib/shanten.mjs';

const SELF = process.argv.includes('--self-test');
const bad = [];
let n = 0;
const ok = (what, cond) => { n++; if (!cond) bad.push(what); };
const C = (str) => toCounts(parse(str));
const names = (arr) => arr.map((w) => indexToCode(w.tile)).join(' ');

function run(L, quick) {
  bad.length = 0; n = 0;
  // ③ 手で書いた正解表
  const W = (str, want, what) => { const w = L.waits(C(str)); ok(`${what}（${str}）待ち ${w && names(w)} ／ 正 ${want}`, !!w && names(w) === want); return w; };
  W('1112345678999m', '1m 2m 3m 4m 5m 6m 7m 8m 9m', '九蓮宝燈の9面');
  W('19m19p19s1234567z', '1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z', '国士13面');
  W('19m19p19s1234566z', '7z', '国士の単騎');
  const jun = W('1111m', '1m', '純空（鳴き3つ・1m を4枚）');
  ok('純空の残りは0', !!jun && !!jun[0] && jun[0].left === 0);
  ok('純空の手の式も聴牌（1111m）', L.shantenAll(C('1111m')).best === 0);
  W('2345m123p456p789s', '2m 5m', 'ノベタン');
  W('5677m123p456p789s', '4m 7m', '両面と単騎の複合（5677m）');
  W('4677m123p456p789s', '5m', '嵌張（4677m・7m は形にならない）');
  W('1122m3344p5566s7z', '7z', '七対子の単騎');
  ok('14枚は待ちを出さない＝null', L.waits(C('1133m3344p5566s77z')) === null);
  ok('七対子の4枚は対子2つにしない（1111m22m33p44p55s6z の七対子シャンテン2）', L.shantenChiitoi(C('1111m22m33p44p55s6z')) === 2);
  ok('七対子の4枚の和了は無し（1111m22m33p44p55s）', !L.isAgariChiitoi(C('1111m22m33p44p55s')));
  ok('12枚は形にならない＝null', L.shantenAll(C('123456789m123p')).best === null);
  ok('14枚の和了', L.isAgari(C('123m456m789m123p11z')));
  ok('14枚の和了は analyze14 で agari', L.analyze14(C('123m456m789m123p11z')).agari === true);
  ok('国士の14枚の和了', L.isAgari(C('19m19p19s12345677z')));
  ok('聴牌（123m456p789s11z46p）', L.shantenAll(C('123m456p789s11z46p')).best === 0);
  ok('国士形 13−10−0＝3（19m19p19s1234z258m）', L.shantenKokushi(C('19m19p19s1234z258m')) === 3);
  ok('一般形の最大は8（么九の単騎13種）', L.shantenNormal(C('19m19p19s1234567z')) === 8);
  // 3人：2m〜8m は待ちに入れない
  const w3 = L.waits(C('13m123p456p789s11z'), null, 3);
  ok('3人で2mは待ちに入らない', !!w3 && w3.length === 0);
  const w4 = L.waits(C('13m123p456p789s11z'), null, 4);
  ok('4人なら2m待ち', !!w4 && names(w4) === '2m');
  // 見えている牌を引く
  const seen = new Array(34).fill(0); seen[1] = 3;
  ok('見えている3枚を引いて残り1', L.waits(C('13m123p456p789s11z'), seen)[0].left === 1);
  // 受け入れ：両面2つの1シャンテン（23m67p123s456s11z2z）→ 1m4m5p8p 各4枚＝4種16枚
  const u = L.ukeire(C('23m67p123s456s11z2z'));
  ok(`受け入れ（${u && u.kinds}種 ${u && u.total}枚）`, !!u && u.shanten === 1 && u.kinds === 4 && u.total === 16);

  if (quick) return bad.slice();
  // ① 清一色13枚の全部
  let hands = 0, tenpai = 0;
  const c = new Array(34).fill(0);
  (function rec(i, left) {
    if (i === 9) {
      if (left) return;
      hands++;
      const s0 = L.shantenAll(c).best === 0;
      const w = L.waits(c);
      if (s0) tenpai++;
      if (s0 !== (w.length > 0)) ok(`清一色 ${c.slice(0, 9).join('')}: 式 ${s0} 待ち ${w.length}`, false);
      return;
    }
    for (let k = 0; k <= Math.min(4, left); k++) { c[i] = k; rec(i + 1, left - k); }
    c[i] = 0;
  })(0, 13);
  ok(`清一色の全部の数（${hands}）`, hands === 93600);
  ok(`清一色の聴牌が1つ以上（${tenpai}）`, tenpai > 0);

  // ② 1枚替えの探索と突き合わせ
  const tenpaiBy = (h) => L.waits(h).length > 0;
  function oneSwapTenpai(h) {
    for (let a = 0; a < 34; a++) {
      if (!h[a]) continue;
      h[a]--;
      for (let b = 0; b < 34; b++) {
        if (b === a || h[b] >= 4) continue;
        h[b]++;
        const t = tenpaiBy(h);
        h[b]--;
        if (t) { h[a]++; return true; }
      }
      h[a]++;
    }
    return false;
  }
  let seed = 20261120;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  function draw(pool, k) {
    const h = new Array(34).fill(0);
    let got = 0, guard = 0;
    while (got < k && guard++ < 10000) { const i = pool[Math.floor(rnd() * pool.length)]; if (h[i] < 4) { h[i]++; got++; } }
    return h;
  }
  const ALL = [...Array(34).keys()];
  const MAN = [...Array(9).keys()];
  const PIN_SOU = [...Array(18).keys()].map((x) => x + 9);
  const YAO = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const pools = [['乱数', ALL, 120], ['清一色', MAN, 120], ['2色', PIN_SOU, 120], ['么九', YAO, 60]];
  let checked = 0;
  const dist = [0, 0, 0, 0];
  for (const [nm, pool, cnt] of pools) for (let r = 0; r < cnt; r++) {
    for (const size of [13, 10, 7]) {
      const h = draw(pool, size);
      const s = L.shantenAll(h).best;
      dist[Math.min(3, s)]++;
      const t0 = tenpaiBy(h);
      checked++;
      if ((s === 0) !== t0) { ok(`${nm} ${size}枚 式${s} ／ 和了の判定で聴牌 ${t0}`, false); continue; }
      if (s >= 1) {
        const t1 = oneSwapTenpai(h);
        if ((s === 1) !== t1) ok(`${nm} ${size}枚 式${s} ／ 1枚替えで聴牌 ${t1}`, false);
      }
    }
  }
  ok(`探索で見た手の数（${checked}）`, checked === 420 * 3);
  ok(`聴牌と1シャンテンの手が混ざっている（聴牌${dist[0]}・1シャンテン${dist[1]}）`, dist[0] >= 20 && dist[1] >= 50);
  // 狙った手：七対子形（6対子＋1）
  for (let r = 0; r < 60; r++) {
    const idx = [...ALL].sort(() => rnd() - 0.5).slice(0, 7);
    const h = new Array(34).fill(0);
    idx.slice(0, 6).forEach((i) => (h[i] = 2)); h[idx[6]] = 1;
    ok(`七対子形の聴牌 ${idx.join(',')}`, L.shantenAll(h).best === 0 && L.waits(h).some((w) => w.tile === idx[6]));
  }
  return bad.slice();
}

if (SELF) {
  // 式をわざと壊す：①七対子の式を1つずらす ②和了の判定から七対子を外す ③一般形の塔子の上限を外す
  const mk = (over) => {
    const L = { ...S, ...over };
    L.shantenAll = (c) => { const v = [L.shantenNormal(c), L.shantenChiitoi(c), L.shantenKokushi(c)].filter((x) => x !== null); return { best: v.length ? Math.min(...v) : null }; };
    L.waits = (c, seen, players = 4) => { if (S.tileCount(c) % 3 !== 1) return null; const out = []; for (let i = 0; i < 34; i++) { if (!S.exists(i, players)) continue; c[i]++; const g = L.isAgari(c); c[i]--; if (g) out.push({ tile: i, left: S.remaining(c, seen, i) }); } return out; };
    return L;
  };
  const r1 = run(mk({ shantenChiitoi: (c) => { const v = S.shantenChiitoi(c); return v === null ? v : v + 1; } }), true).length;
  const r2 = run(mk({ isAgari: (c) => S.isAgariNormal(c) || S.isAgariKokushi(c) }), true).length;
  const r3 = run(mk({ isAgari: (c) => { for (const x of c) if (x > 4) return false; return S.isAgari(c); } }), true).length;
  console.log(`自己確認: ${[r1, r2, r3].filter((r) => r > 0).length}/3`); // CI は scripts/ci-yuka.sh で床 3 を見る
  if (r1 > 0 && r2 > 0 && r3 > 0) { console.log(`✓ 自己確認：七対子の式を壊す→赤 ${r1}・和了から七対子を外す→赤 ${r2}・純空を外す→赤 ${r3}`); process.exit(0); }
  console.log(`✗ 自己確認：壊しても赤にならない（${r1}・${r2}・${r3}）`); process.exit(1);
}
const t0 = Date.now();
const res = run(S, false);
if (res.length) { console.log(`✗ 待ち・シャンテン ${res.length}/${n} が違う`); for (const b of res.slice(0, 30)) console.log('  ' + b); process.exit(1); }
console.log(`✓ 待ち・シャンテン ${n} 件 全部 合った（清一色13枚 93,600通り・1枚替えの探索 1,260手・手で書いた正解表）${((Date.now() - t0) / 1000).toFixed(1)}秒`);
