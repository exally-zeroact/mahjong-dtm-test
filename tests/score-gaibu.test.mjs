/* score-gaibu.test.mjs — ★件4b：lib/score.mjs を外の公開の計算器（PyPI mahjong）と乱数の手で突き合わせる★（設計 tataki/score_sekkei_v13.md 4b）
 * node tests/score-gaibu.test.mjs             … 種で決まる乱数 1,000 手を両方で数え、翻・符・点が全部同じか
 * node tests/score-gaibu.test.mjs --self-test … lib/score.mjs の式を壊した写しで流して、全部赤になるか（見張りの空振りを見る）
 * python は SCORE_PY（無ければ python3 → python）。PyPI mahjong を tests/score-gaibu.req.txt（== と hash）で入れておく。
 * 赤になる時：python が無い・mahjong の版が違う・免状が MIT でない・外さなかった手で1件でも食い違う・外した手が 50 を超える・比べた手が 1,000 に届かない。
 * ★外す手は計算の前に、入力の中身だけで決める★（今の決め＝外す手 0：生む手を外の計算器と同じルールの中に限る＝4人・包なし・北抜きなし・槍槓なし）。
 * 3人・包・北抜きは手で書いた正解表（tests/score.test.mjs）だけが守り。
 * ★4b が守るのは普通の役・符・ドラ・赤・親子の点だけ★。槍槓・本場・供託は生む手で必ず0。役満（種 20261120 では四暗刻のほかは0手）・天和・三色同刻・
 *   三槓子・混老頭・純全帯はほぼ出ない＝それらは正解表が守る（4b を緑にしたまま壊せる所がある＝11-20 に壊して確かめ、正解表の自己確認に入れた）。
 * 「比べた」のうち点を比べたのは和了の手だけ（残りは両方「役なし」の一致）。「外した手 50 まで」の門は、外す範囲を生む手の側で狭めているので今は赤にならない。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'lib');
const PY = join(HERE, 'score-gaibu.py');
const WANT_VER = readFileSync(join(HERE, 'score-gaibu.req.txt'), 'utf8').match(/^mahjong==(\S+)/m)[1];
const N = 1000, SEED = 20261120, SKIP_MAX = 50;

/* ── 種で決まる乱数 ── */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const code = (i) => (i < 27 ? `${(i % 9) + 1}${'mps'[Math.floor(i / 9)]}` : `${i - 26}z`);

/** 1手を作る（4人・和了の形・あり得ない組みは作らない）→ { ours: lib の入力, py: 外の計算器の入力 } か null（作り直し） */
function makeHand(R) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const cnt = new Array(34).fill(0);
  const take = (i, n = 1) => { cnt[i] += n; return cnt[i] <= 4; };
  const style = R();
  const suitOnly = style < 0.25 ? pick([0, 1, 2]) : -1; // 混一色・清一色に寄せる
  const tileFrom = () => (suitOnly >= 0 ? (R() < 0.75 ? suitOnly * 9 + Math.floor(R() * 9) : 27 + Math.floor(R() * 7)) : Math.floor(R() * 34));
  const sets = []; // { kind:'shun'|'kou', i }
  let pair;
  const form = R() < 0.08 ? 'chiitoi' : 'std';
  if (form === 'chiitoi') {
    const ps = new Set();
    while (ps.size < 7) ps.add(tileFrom());
    for (const i of ps) take(i, 2);
    sets.push(...[...ps].map((i) => ({ kind: 'pair', i })));
  } else {
    for (let k = 0; k < 4; k++) {
      if (R() < 0.6) {
        const s = suitOnly >= 0 ? suitOnly : Math.floor(R() * 3);
        const st = s * 9 + Math.floor(R() * 7);
        if (!take(st) || !take(st + 1) || !take(st + 2)) return null;
        sets.push({ kind: 'shun', i: st });
      } else {
        const i = tileFrom();
        if (!take(i, 3)) return null;
        sets.push({ kind: 'kou', i });
      }
    }
    pair = tileFrom();
    if (!take(pair, 2)) return null;
  }
  /* 鳴き：open の手は面子を1〜3つ鳴く。槓は刻子の一部を槓に */
  const open = form === 'std' && R() < 0.4;
  const melds = [];
  const closedSets = [];
  for (const s of sets) {
    if (s.kind === 'pair') { closedSets.push(s); continue; }
    if (s.kind === 'kou' && R() < 0.12) { // 槓
      if (!take(s.i)) return null;
      const an = !open || R() < 0.5;
      melds.push({ kind: an ? 'ankan' : 'minkan', t: [s.i, s.i, s.i, s.i] });
      continue;
    }
    if (open && melds.filter((m) => m.kind !== 'ankan').length < 3 && R() < 0.55) {
      melds.push(s.kind === 'shun' ? { kind: 'chi', t: [s.i, s.i + 1, s.i + 2] } : { kind: 'pon', t: [s.i, s.i, s.i] });
      continue;
    }
    closedSets.push(s);
  }
  const closed = [];
  for (const s of closedSets) {
    if (s.kind === 'shun') closed.push(s.i, s.i + 1, s.i + 2);
    else if (s.kind === 'kou') closed.push(s.i, s.i, s.i);
    else closed.push(s.i, s.i);
  }
  if (pair !== undefined) closed.push(pair, pair);
  if (!closed.length) return null;
  const win = pick(closed);
  const menzen = melds.every((m) => m.kind === 'ankan');
  const kans = melds.filter((m) => m.kind.endsWith('kan')).length;
  const tsumo = R() < 0.45;
  const oya = R() < 0.25;
  const rw = 27 + (R() < 0.7 ? 0 : 1);
  const pw = oya ? 27 : 28 + Math.floor(R() * 3);
  const riichi = menzen && R() < 0.5 ? (R() < 0.1 ? 2 : 1) : 0;
  const ippatsu = riichi > 0 && kans === 0 && R() < 0.15;
  const rinshan = tsumo && kans > 0 && !ippatsu && R() < 0.3;
  const haitei = tsumo && !rinshan && R() < 0.05;
  const houtei = !tsumo && R() < 0.05;
  const first = tsumo && menzen && kans === 0 && riichi === 0 && R() < 0.01;
  const tenhou = first && oya, chiihou = first && !oya;
  /* ドラ：表示 1＋槓の数・裏は立直の時だけ */
  const nd = 1 + kans;
  const dora = [], ura = [];
  for (let k = 0; k < nd; k++) { const i = Math.floor(R() * 34); if (!take(i)) return null; dora.push(i); }
  if (riichi) for (let k = 0; k < nd; k++) { const i = Math.floor(R() * 34); if (!take(i)) return null; ura.push(i); }
  /* 赤：5 の色ごとに1枚まで（ルール aka=3）。136 の番号の 4i+0 が赤＝赤にしない5は 4i+3 から使う */
  const useAka = R() < 0.4;
  const akaColor = [4, 13, 22].map((i) => useAka && R() < 0.5 && closed.concat(melds.flatMap((m) => m.t)).includes(i));
  const next = new Array(34).fill(0).map((_, i) => ([4, 13, 22].includes(i) && akaColor[[4, 13, 22].indexOf(i)] ? [0, 3, 2, 1] : [3, 2, 1, 0]));
  const id = (i) => 4 * i + next[i].shift();
  /* 手の牌に先に番号を振る（赤は手と鳴きに＝表示牌に赤を回さない） */
  const meldIds = melds.map((m) => m.t.map(id));
  const closedIds = closed.map(id);
  const doraIds = dora.map(id), uraIds = ura.map(id);
  let aka = 0;
  for (const c of [4, 13, 22]) if ([...closedIds, ...meldIds.flat()].includes(4 * c)) aka++;
  if ([...doraIds, ...uraIds].some((x) => [16, 52, 88].includes(x))) return null; // 赤が表示牌に回った＝作り直し
  const winId = closedIds[closed.indexOf(win)];
  const ours = {
    hand: closed.map(code), win: code(win), tsumo,
    melds: melds.map((m) => ({ kind: m.kind, tiles: m.t.map(code) })),
    bakaze: code(rw), jikaze: code(pw), riichi, ippatsu, rinshan, haitei, houtei, chankan: false, tenhou, chiihou,
    dora: dora.map(code), ura: ura.map(code), aka, kita: 0, honba: 0, kyotaku: 0, pao: null,
  };
  const py = {
    tiles: [...closedIds, ...meldIds.flat()], win: winId,
    melds: melds.map((m, k) => ({ type: m.kind === 'chi' ? 'chi' : m.kind === 'pon' ? 'pon' : 'kan', tiles: meldIds[k], opened: m.kind !== 'ankan' })),
    dora: doraIds, ura: uraIds, tsumo, riichi, ippatsu, rinshan, haitei, houtei, tenhou, chiihou, pw, rw, aka: aka > 0,
  };
  return { ours, py, oya };
}

/** 外す手（計算の前に入力の中身だけで決める）＝今は 0（生む手を外の計算器と同じルールの中に限っている） */
const skipReason = () => null;

function makeHands() {
  const R = rng(SEED);
  const hands = [];
  while (hands.length < N) { const h = makeHand(R); if (h) hands.push(h); }
  return hands;
}

function runPy(hands) {
  const cands = process.env.SCORE_PY ? [process.env.SCORE_PY] : ['python3', 'python'];
  for (const exe of cands) {
    const r = spawnSync(exe, ['-I', PY], { input: JSON.stringify(hands.map((h) => h.py)), encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.error && r.error.code === 'ENOENT') continue;
    if (r.status !== 0) return { err: `python が落ちた（${exe}・終わり値 ${r.status}）：${(r.stderr || '').trim().split('\n').slice(-3).join(' / ')}` };
    const [head, body] = r.stdout.trim().split('\n');
    return { meta: JSON.parse(head), res: JSON.parse(body) };
  }
  return { err: 'python が無い（SCORE_PY か python3 / python）' };
}

/** 2つの答えを同じ形にする：{err} か {han, fu, main, additional, ym} */
function oursKey(r, oya, tsumo) {
  if (!r.ok) return { err: r.err };
  const p = r.pts;
  const main = !tsumo ? p.ron : oya ? p.all : p.oya;
  const additional = !tsumo ? 0 : oya ? p.all : p.ko;
  return { han: r.han, fu: r.fu, main, additional, ym: r.yakuman.length > 0 };
}
function same(o, g) {
  if (o.err || g.err) {
    const map = { no_yaku: 'no_yaku', hand_not_winning: 'not_agari' };
    return o.err && g.err && map[g.err] === o.err;
  }
  if (o.main !== g.main || o.additional !== g.additional) return false;
  if (o.ym !== g.ym) return false; // 役の役満か（数え役満は両方とも偽＝翻で比べる）
  if (o.ym) return true; // 役満は点だけ（翻・符の数え方は計算器ごとに違う）
  if (o.han !== g.han) return false;
  return o.han >= 5 || o.fu === g.fu; // 満貫以上は符で点が変わらない
}

function compare(score, hands, gaibu) {
  const bad = [];
  let n = 0, skipped = 0;
  for (const [k, h] of hands.entries()) {
    if (skipReason(h)) { skipped++; continue; }
    let r;
    try { r = score(h.ours, { players: 4 }); } catch (e) { r = { ok: false, err: 'throw ' + e.message }; }
    const o = oursKey(r, h.oya, h.ours.tsumo), g = gaibu[k];
    n++;
    if (!same(o, g)) bad.push({ k, h: h.ours, o, g, yaku: r.ok ? r.yaku.map((y) => `${y.name}${y.han}`).concat(r.yakuman.map((y) => y.name)) : [] });
  }
  return { n, skipped, bad };
}

const hands = makeHands();
const py = runPy(hands);
const fails = [];
if (py.err) fails.push(py.err);
else {
  if (py.meta.version !== WANT_VER) fails.push(`mahjong の版が ${py.meta.version}（固定 ${WANT_VER}）`);
  if (py.meta.license !== 'MIT') fails.push(`mahjong の免状が ${py.meta.license}（MIT でない）`);
  if (py.res.length !== hands.length) fails.push(`外の答えの数 ${py.res.length} ／ 手 ${hands.length}`);
}
if (fails.length) { console.log('✗ 外の計算器'); for (const f of fails) console.log('  ' + f); process.exit(1); }

if (process.argv.includes('--self-test')) {
  const src = readFileSync(join(LIB, 'score.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const BREAKS = [
    ['符の切り上げ（切り捨てに）', 'fu = Math.ceil(raw / 10) * 10;', 'fu = Math.floor(raw / 10) * 10;'],
    ['喰い下がり', 'const k = (h) => (menzen ? h : h - 1);', 'const k = (h) => h;'],
    ['ドラの折り返し（9 の次）', 'return i - (i % 9) + ((i % 9) + 1) % 9;', 'return i + 1;'],
    ['シャンポンのロンは明刻', "open: j === k && wait === 'shanpon' && !ts", 'open: false'],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'gaibu-self-'));
  let caught = 0;
  const miss = [];
  try {
    for (const f of ['tiles.mjs', 'score-table.mjs']) writeFileSync(join(dir, f), readFileSync(join(LIB, f)));
    for (const [k, [name, from, to]] of BREAKS.entries()) {
      if (!src.includes(from)) { miss.push(`${name}：壊す字が見つからない`); continue; }
      const p = join(dir, `score-${k}.mjs`);
      writeFileSync(p, src.replace(from, to));
      const mod = await import(pathToFileURL(p).href);
      if (compare(mod.score, hands, py.res).bad.length > 0) caught++; else miss.push(`${name}：赤にならない`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`自己確認: ${caught}/${BREAKS.length}`); // CI は scripts/ci-yuka.sh で床を見る
  if (miss.length) { console.log('✗ 自己確認'); for (const m of miss) console.log('  ' + m); process.exit(1); }
  console.log(`✓ 自己確認：lib/score.mjs の式を ${BREAKS.length} か所壊して、外の計算器との突き合わせが全部赤になった`);
  process.exit(0);
}

const { score } = await import('../lib/score.mjs');
const { n, skipped, bad } = compare(score, hands, py.res);
const okN = hands.filter((h, k) => py.res[k] && !py.res[k].err).length;
console.log(`外の計算器 mahjong ${py.meta.version}（${py.meta.license}）・種 ${SEED}・手 ${hands.length}（和了 ${okN}・役なし等 ${hands.length - okN}）・比べた ${n}・外した ${skipped}`);
{
  const c = (f) => hands.filter((h, k) => f(h, py.res[k] || {})).length;
  console.log(`  内訳：鳴き在り ${c((h) => h.ours.melds.some((m) => m.kind !== 'ankan'))}・槓 ${c((h) => h.ours.melds.some((m) => m.kind.endsWith('kan')))}・七対子 ${c((h, g) => (g.yaku || []).includes('Chiitoitsu'))}・ツモ ${c((h) => h.ours.tsumo)}・親 ${c((h) => h.oya)}・立直 ${c((h) => h.ours.riichi > 0)}・赤 ${c((h) => h.ours.aka > 0)}・満貫以上 ${c((h, g) => g.han >= 5)}・役満 ${c((h, g) => g.ym)}`);
}
const out = [];
if (n < N - SKIP_MAX) out.push(`比べた手が ${n}（床 ${N - SKIP_MAX}）`);
if (skipped > SKIP_MAX) out.push(`外した手が ${skipped}（上限 ${SKIP_MAX}）`);
if (bad.length) {
  out.push(`食い違い ${bad.length} 手`);
  for (const b of bad.slice(0, 15)) out.push(`  #${b.k} ${b.h.hand.join('')} 和了${b.h.win} 鳴き[${b.h.melds.map((m) => m.kind + ':' + m.tiles.join('')).join(' ')}] ${b.h.tsumo ? 'ツモ' : 'ロン'} 場${b.h.bakaze} 自${b.h.jikaze} 立直${b.h.riichi} ドラ表示${b.h.dora.join('')} 裏${b.h.ura.join('')} 赤${b.h.aka}\n      うち ${JSON.stringify(b.o)} [${b.yaku.join(',')}]\n      外   ${JSON.stringify(b.g)}`);
}
if (out.length) { console.log('✗ 外の計算器との突き合わせ'); for (const x of out) console.log('  ' + x); process.exit(1); }
console.log(`✓ 外の計算器との突き合わせ ${n} 手 全部 同じ（翻・符・点を比べたのは和了 ${okN} 手・残りは両方 役なし）`);
