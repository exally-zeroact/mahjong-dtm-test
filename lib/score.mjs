/* score.mjs — ★点数計算（役・符・点・包）★（件4a・設計＝tataki/score_sekkei_v13.md v1.5）
 * score(input, rules) → { ok: true, han, fu, yaku, yakuman, fuParts, dora, pts, pay, form } か { ok: false, err }
 *   err：'count' 'over4' 'aka' 'sanma' 'dora' 'flags' 'not_agari' 'no_yaku'
 * 決め（設計 v1.5 の通り・紙に無い事は足していない）：
 *   高点法＝全部の分け方×待ちの取り方で、和了った人の受け取り（本場・供託を除く）→翻→符の順で一番高い形。
 *   double_yakuman=false＝全部1倍止め（複合も1倍）。true＝国士13面・四暗刻単騎・純正九蓮・大四喜を2倍・複合は足す。
 *   槓は一発を消す・北抜きは消さない。北抜きの後の天和・地和は無し。
 *   包＝払う人を替えるだけ（合計は包なしと同じ）。ツモ＝責任者が包の役満 P の合計＋自分の R の分／ロン＝P を半分ずつ（same なら全部放銃者）。
 *   3人の本場は1人あたり4人と同じ（ツモ損も折半も）。北が表示牌の次（ドラ）なら抜いた北もドラに数える。
 */
import { codeToIndex } from './tiles.mjs';
import { points } from './score-table.mjs';

const isYao = (i) => i >= 27 || i % 9 === 0 || i % 9 === 8;
const isHon = (i) => i >= 27;
const isDragon = (i) => i >= 31;
const isWind = (i) => i >= 27 && i <= 30;
const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2s 3s 4s 6s 8s 發
const KITA = 30;
const AKA_LIM = { 0: [0, 0, 0], 1: [0, 1, 0], 2: [0, 1, 1], 3: [1, 1, 1], 4: [1, 2, 1] }; // 萬・筒・索
const SANMA_NONE = (i) => i >= 1 && i <= 7;

function normRules(r = {}) {
  const players = r.players === 3 ? 3 : 4;
  return {
    players,
    kuitan: r.kuitan !== false,
    aka: Number.isInteger(r.aka) ? r.aka : players === 3 ? 2 : 3,
    double_yakuman: r.double_yakuman !== false,
    renpu_fu: r.renpu_fu === 2 ? 2 : 4,
    kiriage: !!r.kiriage,
    kazoe: r.kazoe === 'sanbai' ? 'sanbai' : 'yakuman',
    tsumo3: r.tsumo3 === 'secchan' ? 'secchan' : 'son',
    honba: r.honba === 1500 ? 1500 : 300,
    kita: r.kita ? r.kita : players === 3 ? 'nuki' : 'none',
    pao: r.pao !== false,
  };
}

/** ドラ表示牌 → ドラの番号 */
export function doraOf(i, players = 4) {
  if (i >= 27) return i <= 30 ? 27 + ((i - 27 + 1) % 4) : 31 + ((i - 31 + 1) % 3);
  if (players === 3 && i === 0) return 8; // 3人の 1m 表示→9m
  if (players === 3 && i === 8) return 0; // 9m 表示→1m
  return i - (i % 9) + ((i % 9) + 1) % 9;
}

const fail = (err, why) => ({ ok: false, err, why });

function idx(code) {
  if (typeof code !== 'string' || code.length !== 2) throw new Error('name');
  return codeToIndex(code);
}

function readMeld(m) {
  if (!m || !Array.isArray(m.tiles)) return null;
  let t;
  try { t = m.tiles.map(idx).sort((a, b) => a - b); } catch { return null; }
  const same = t.every((x) => x === t[0]);
  if (m.kind === 'chi') {
    if (t.length !== 3 || isHon(t[0]) || t[1] !== t[0] + 1 || t[2] !== t[0] + 2 || Math.floor(t[0] / 9) !== Math.floor(t[2] / 9)) return null;
    return { type: 'shun', idx: t[0], open: true, kind: 'chi', tiles: t };
  }
  if (m.kind === 'pon') return t.length === 3 && same ? { type: 'kou', idx: t[0], open: true, kind: 'pon', tiles: t } : null;
  if (m.kind === 'minkan') return t.length === 4 && same ? { type: 'kan', idx: t[0], open: true, kind: 'minkan', tiles: t } : null;
  if (m.kind === 'ankan') return t.length === 4 && same ? { type: 'kan', idx: t[0], open: false, kind: 'ankan', tiles: t } : null;
  return null;
}

/** 34の数え → 面子の分け方（雀頭1つ＋面子 n 組）を全部 */
function decompose(c, nSets) {
  const out = [];
  const sets = [];
  const rec = (start) => {
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) { if (sets.length === nSets) out.push(sets.slice()); return; }
    if (c[i] >= 3) { c[i] -= 3; sets.push({ type: 'kou', idx: i }); rec(i); sets.pop(); c[i] += 3; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: 'shun', idx: i }); rec(i); sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  const res = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    out.length = 0;
    rec(0);
    for (const s of out) res.push({ pair: p, sets: s });
    c[p] += 2;
  }
  return res;
}

function yakuhaiOf(i, bakaze, jikaze) {
  let n = 0;
  if (isDragon(i)) n++;
  if (i === bakaze) n++;
  if (i === jikaze) n++;
  return n;
}

/** 普通の形（雀頭＋4組）の1つの取り方を数える */
function evalNormal(ctx, form) {
  const { inp, R, bakaze, jikaze, menzen, oya } = ctx;
  const all = [...form.sets, ...ctx.melds];
  const tilesOf = (s) => (s.type === 'shun' ? [s.idx, s.idx + 1, s.idx + 2] : [s.idx]);
  const allIdx = [form.pair, ...all.flatMap(tilesOf)];
  const shuns = all.filter((s) => s.type === 'shun');
  const kous = all.filter((s) => s.type !== 'shun');
  const kans = all.filter((s) => s.type === 'kan');
  const concealedKou = kous.filter((s) => !s.open).length;
  const suitsUsed = new Set(allIdx.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
  const hasHonor = allIdx.some(isHon);
  const winIdx = ctx.win;

  /* 役満 */
  const ym = [];
  const D = R.double_yakuman;
  if (concealedKou === 4) ym.push(form.wait === 'tanki' ? { name: '四暗刻単騎', mult: D ? 2 : 1 } : { name: '四暗刻', mult: 1 });
  if (kous.filter((s) => isDragon(s.idx)).length === 3) ym.push({ name: '大三元', mult: 1, key: 'daisangen' });
  const windKou = kous.filter((s) => isWind(s.idx)).length;
  if (windKou === 4) ym.push({ name: '大四喜', mult: D ? 2 : 1, key: 'daisuushii' });
  else if (windKou === 3 && isWind(form.pair)) ym.push({ name: '小四喜', mult: 1 });
  if (allIdx.every(isHon)) ym.push({ name: '字一色', mult: 1 });
  if (allIdx.every((i) => GREEN.has(i))) ym.push({ name: '緑一色', mult: 1 });
  if (allIdx.every((i) => isYao(i) && !isHon(i))) ym.push({ name: '清老頭', mult: 1 });
  if (kans.length === 4) ym.push({ name: '四槓子', mult: 1, key: 'suukantsu' });
  if (ctx.melds.length === 0 && suitsUsed.size === 1 && !hasHonor) {
    const c = ctx.handCounts, s = [...suitsUsed][0] * 9;
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    if (need.every((n, k) => c[s + k] >= n)) {
      const c13 = c.slice(); c13[winIdx]--;
      const jun = need.every((n, k) => c13[s + k] === n);
      ym.push(jun ? { name: '純正九蓮宝燈', mult: D ? 2 : 1 } : { name: '九蓮宝燈', mult: 1 });
    }
  }
  if (ym.length) return { ym };

  /* 普通の役 */
  const yaku = [];
  const add = (name, han) => yaku.push({ name, han });
  const pairYh = yakuhaiOf(form.pair, bakaze, jikaze);
  const pinfu = menzen && ctx.melds.length === 0 && shuns.length === 4 && pairYh === 0 && form.wait === 'ryanmen' && !inp.rinshan;
  if (inp.riichi === 2) add('ダブル立直', 2); else if (inp.riichi === 1) add('立直', 1);
  if (inp.ippatsu) add('一発', 1);
  if (menzen && inp.tsumo) add('門前清自摸和', 1);
  if (allIdx.every((i) => !isYao(i)) && (menzen || R.kuitan)) add('断么九', 1);
  if (pinfu) add('平和', 1);
  if (menzen) {
    const cnt = {};
    for (const s of form.sets.filter((s) => s.type === 'shun')) cnt[s.idx] = (cnt[s.idx] || 0) + 1;
    const pairs = Object.values(cnt).reduce((a, n) => a + Math.floor(n / 2), 0);
    if (pairs === 2) add('二盃口', 3); else if (pairs === 1) add('一盃口', 1);
  }
  for (const s of kous) {
    if (isDragon(s.idx)) add(['白', '發', '中'][s.idx - 31], 1);
    if (s.idx === bakaze) add('場風 ' + '東南西北'[bakaze - 27], 1);
    if (s.idx === jikaze) add('自風 ' + '東南西北'[jikaze - 27], 1);
  }
  if (inp.rinshan) add('嶺上開花', 1);
  if (inp.chankan) add('槍槓', 1);
  if (inp.haitei) add('海底摸月', 1);
  if (inp.houtei) add('河底撈魚', 1);
  const k = (h) => (menzen ? h : h - 1);
  for (let n = 0; n < 7; n++) {
    const has = (s) => shuns.some((x) => x.idx === s * 9 + n);
    if (has(0) && has(1) && has(2)) { add('三色同順', k(2)); break; }
  }
  for (let s = 0; s < 3; s++) {
    const has = (n) => shuns.some((x) => x.idx === s * 9 + n);
    if (has(0) && has(3) && has(6)) { add('一気通貫', k(2)); break; }
  }
  const setYao = (s) => (s.type === 'shun' ? s.idx % 9 === 0 || s.idx % 9 === 6 : isYao(s.idx));
  if (shuns.length >= 1 && isYao(form.pair) && all.every(setYao)) {
    if (hasHonor) add('混全帯么九', k(2)); else add('純全帯么九', k(3));
  }
  if (kous.length === 4) add('対々和', 2);
  if (concealedKou === 3) add('三暗刻', 2);
  for (let n = 0; n < 9; n++) {
    if ([0, 1, 2].every((s) => kous.some((x) => x.idx === s * 9 + n))) { add('三色同刻', 2); break; }
  }
  if (kans.length === 3) add('三槓子', 2);
  if (allIdx.every(isYao) && hasHonor) add('混老頭', 2);
  if (kous.filter((s) => isDragon(s.idx)).length === 2 && isDragon(form.pair)) add('小三元', 2);
  if (suitsUsed.size === 1) { if (hasHonor) add('混一色', k(3)); else add('清一色', k(6)); }

  /* 符 */
  const fuParts = [];
  let fu;
  if (pinfu && inp.tsumo) { fu = 20; fuParts.push({ name: '平和ツモ', fu: 20 }); }
  else {
    fuParts.push({ name: '副底', fu: 20 });
    if (menzen && !inp.tsumo) fuParts.push({ name: '門前ロン', fu: 10 });
    if (inp.tsumo && !pinfu) fuParts.push({ name: 'ツモ', fu: 2 });
    for (const s of kous) {
      const y = isYao(s.idx);
      const nm = '東南西北白發中'[s.idx - 27] || ((s.idx % 9) + 1) + 'mps'[Math.floor(s.idx / 9)];
      let f, what;
      if (s.type === 'kan') { f = s.open ? (y ? 16 : 8) : (y ? 32 : 16); what = s.open ? '明槓' : '暗槓'; }
      else { f = s.open ? (y ? 4 : 2) : (y ? 8 : 4); what = s.open ? '明刻' : '暗刻'; }
      fuParts.push({ name: what + ' ' + nm, fu: f });
    }
    let pf = 0;
    if (isDragon(form.pair)) pf += 2;
    if (form.pair === bakaze && form.pair === jikaze) pf += R.renpu_fu;
    else { if (form.pair === bakaze) pf += 2; if (form.pair === jikaze) pf += 2; }
    if (pf) fuParts.push({ name: '雀頭', fu: pf });
    if (form.wait === 'kanchan' || form.wait === 'penchan' || form.wait === 'tanki')
      fuParts.push({ name: { kanchan: '嵌張', penchan: '辺張', tanki: '単騎' }[form.wait], fu: 2 });
    const raw = fuParts.reduce((a, p) => a + p.fu, 0);
    fu = Math.ceil(raw / 10) * 10;
    if (!menzen && fu === 20) { fu = 30; fuParts.push({ name: '喰い平和形（30符）', fu: 30 - raw }); }
  }
  return { yaku, fu, fuParts, allIdx };
}

function evalChiitoi(ctx) {
  const { inp, R } = ctx;
  const allIdx = [];
  ctx.handCounts.forEach((n, i) => { for (let k = 0; k < n; k++) allIdx.push(i); });
  if (allIdx.every(isHon)) return { ym: [{ name: '字一色', mult: 1 }] };
  const yaku = [];
  const add = (name, han) => yaku.push({ name, han });
  if (inp.riichi === 2) add('ダブル立直', 2); else if (inp.riichi === 1) add('立直', 1);
  if (inp.ippatsu) add('一発', 1);
  if (inp.tsumo) add('門前清自摸和', 1);
  if (allIdx.every((i) => !isYao(i))) add('断么九', 1);
  if (inp.haitei) add('海底摸月', 1);
  if (inp.houtei) add('河底撈魚', 1);
  if (inp.rinshan) add('嶺上開花', 1);
  if (inp.chankan) add('槍槓', 1);
  add('七対子', 2);
  const hasHonor = allIdx.some(isHon);
  if (allIdx.every(isYao) && hasHonor) add('混老頭', 2);
  const suits = new Set(allIdx.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
  if (suits.size === 1) { if (hasHonor) add('混一色', 3); else add('清一色', 6); }
  return { yaku, fu: 25, fuParts: [{ name: '七対子', fu: 25 }], allIdx };
}

export function score(input, rulesIn) {
  const R = normRules(rulesIn);
  const inp = Object.assign({ melds: [], riichi: 0, dora: [], ura: [], aka: 0, kita: 0, honba: 0, kyotaku: 0, pao: null }, input || {});
  /* ── 枚数と名前 ── */
  if (!Array.isArray(inp.hand) || !Array.isArray(inp.melds) || !Array.isArray(inp.dora) || !Array.isArray(inp.ura)) return fail('count', 'type');
  if ([...inp.hand, ...inp.dora, ...inp.ura, ...inp.melds.flatMap((m) => (m && m.tiles) || [])].some((x) => typeof x === 'string' && x[0] === '0')) return fail('aka', '0x');
  let hand, dora, ura;
  try { hand = inp.hand.map(idx); dora = inp.dora.map(idx); ura = inp.ura.map(idx); } catch { return fail('count', 'name'); }
  const melds = inp.melds.map(readMeld);
  if (melds.some((m) => !m)) return fail('count', 'meld');
  if (hand.length !== 14 - 3 * melds.length) return fail('count', 'len');
  let win;
  try { win = idx(inp.win); } catch { return fail('count', 'win'); }
  if (!hand.includes(win)) return fail('count', 'win');
  for (const k of ['aka', 'kita', 'honba', 'kyotaku']) if (!Number.isInteger(inp[k]) || inp[k] < 0) return fail('count', k);
  if (inp.kita > 4) return fail('count', 'kita');
  if (![0, 1, 2].includes(inp.riichi)) return fail('flags', 'riichi');
  /* ── 3人 ── */
  const three = R.players === 3;
  if (three) {
    if (melds.some((m) => m.kind === 'chi')) return fail('sanma', 'chi');
    const every = [...hand, ...dora, ...ura, ...melds.flatMap((m) => m.tiles)];
    if (every.some(SANMA_NONE)) return fail('sanma', '2-8m');
  }
  /* ── 同じ牌5枚 ── */
  const cnt = new Array(34).fill(0);
  for (const i of [...hand, ...dora, ...ura, ...melds.flatMap((m) => m.tiles)]) cnt[i]++;
  cnt[KITA] += inp.kita;
  if (cnt.some((n) => n > 4)) return fail('over4');
  /* ── ドラ表示の数 ── */
  const nKan = melds.filter((m) => m.type === 'kan').length;
  if (dora.length > 1 + nKan || ura.length > 1 + nKan) return fail('dora');
  /* ── 赤 ── */
  const lim = AKA_LIM[R.aka] || AKA_LIM[0];
  const fives = [0, 0, 0];
  for (const i of [...hand, ...melds.flatMap((m) => m.tiles)]) if (i < 27 && i % 9 === 4) fives[Math.floor(i / 9)]++;
  const akaMax = fives.reduce((a, n, s) => a + Math.min(n, lim[s]), 0);
  if (inp.aka > akaMax) return fail('aka', 'limit');
  /* ── あり得ない組み ── */
  const winds = [27, 28, 29, 30];
  let bakaze, jikaze;
  try { bakaze = idx(inp.bakaze); jikaze = idx(inp.jikaze); } catch { return fail('flags', 'kaze'); }
  if (!winds.includes(bakaze) || !winds.includes(jikaze)) return fail('flags', 'kaze');
  if (three && (bakaze === KITA || jikaze === KITA)) return fail('flags', 'sanma-kita');
  const oya = jikaze === 27;
  const ts = !!inp.tsumo;
  const B = (k) => !!inp[k];
  const openCall = melds.some((m) => m.kind !== 'ankan');
  const F = (cond, why) => (cond ? why : null);
  const flag =
    F(B('ippatsu') && !inp.riichi, 'ippatsu') ||
    F(inp.riichi && openCall, 'riichi-open') ||
    F(B('haitei') && !ts, 'haitei') || F(B('houtei') && ts, 'houtei') || F(B('chankan') && ts, 'chankan') || F(B('rinshan') && !ts, 'rinshan-ron') ||
    F(B('rinshan') && !(nKan > 0 || (three && inp.kita >= 1)), 'rinshan') ||
    F(B('ippatsu') && B('rinshan') && (!three || inp.kita === 0), 'ippatsu-rinshan') ||
    F((B('rinshan') && (B('haitei') || B('chankan') || B('houtei'))) || (B('haitei') && B('houtei')) || (B('chankan') && (B('houtei') || B('haitei'))) || (B('tenhou') && B('chiihou')), 'pair') ||
    F((B('tenhou') || B('chiihou')) && (inp.riichi || B('ippatsu') || B('rinshan') || B('haitei') || B('houtei') || B('chankan') || !ts || melds.length > 0 || inp.kita > 0), 'tenhou') ||
    F(B('tenhou') && !oya, 'tenhou-ko') || F(B('chiihou') && oya, 'chiihou-oya') ||
    F(inp.kita > 0 && (!three || R.kita === 'none'), 'kita') ||
    F(!inp.riichi && ura.length > 0, 'ura');
  if (flag) return fail('flags', flag);
  /* ── 包の入力 ── */
  const pao = inp.pao;
  if (pao != null) {
    if (!R.pao) return fail('flags', 'pao-off');
    if (typeof pao !== 'object' || !['daisangen', 'daisuushii', 'suukantsu'].includes(pao.yaku)) return fail('flags', 'pao');
    if (!ts && typeof pao.same !== 'boolean') return fail('flags', 'pao-same');
    if (ts && pao.same !== undefined) return fail('flags', 'pao-same');
    if (ts && !oya && !['oya', 'ko'].includes(pao.who)) return fail('flags', 'pao-who');
    if ((!ts || oya) && pao.who !== undefined) return fail('flags', 'pao-who');
    const called = (pred) => melds.filter((m) => m.type !== 'shun' && pred(m.idx));
    const hasOpen = (ms) => ms.some((m) => m.kind === 'pon' || m.kind === 'minkan');
    if (pao.yaku === 'daisangen') { const ms = called(isDragon); if (ms.length < 3 || !hasOpen(ms)) return fail('flags', 'pao-meld'); }
    if (pao.yaku === 'daisuushii') { const ms = called(isWind); if (ms.length < 4 || !hasOpen(ms)) return fail('flags', 'pao-meld'); }
    if (pao.yaku === 'suukantsu') { const ks = melds.filter((m) => m.type === 'kan'); if (ks.length < 4 || !ks.some((m) => m.kind === 'minkan')) return fail('flags', 'pao-meld'); }
  }
  /* ── 分け方 ── */
  const handCounts = new Array(34).fill(0);
  for (const i of hand) handCounts[i]++;
  const menzen = !openCall;
  const ctx = { inp, R, bakaze, jikaze, menzen, oya, win, handCounts, melds };
  const cands = [];
  for (const d of decompose(handCounts.slice(), 4 - melds.length)) {
    if (d.pair === win) cands.push(evalNormal(ctx, { pair: d.pair, sets: d.sets.map((s) => ({ ...s, open: false })), wait: 'tanki', at: -1 }));
    d.sets.forEach((s, k) => {
      let wait = null;
      if (s.type === 'kou' && s.idx === win) wait = 'shanpon';
      if (s.type === 'shun' && win >= s.idx && win <= s.idx + 2) {
        const pos = win - s.idx, n = s.idx % 9;
        wait = pos === 1 ? 'kanchan' : (pos === 0 && n === 6) || (pos === 2 && n === 0) ? 'penchan' : 'ryanmen';
      }
      if (!wait) return;
      const sets = d.sets.map((x, j) => ({ ...x, open: j === k && wait === 'shanpon' && !ts }));
      cands.push(evalNormal(ctx, { pair: d.pair, sets, wait, at: k }));
    });
  }
  if (melds.length === 0) {
    if (handCounts.filter((n) => n === 2).length === 7) cands.push(evalChiitoi(ctx));
    const y = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
    if (y.every((i) => handCounts[i] >= 1) && y.reduce((a, i) => a + handCounts[i], 0) === 14) {
      const c13 = handCounts.slice(); c13[win]--;
      const thirteen = y.every((i) => c13[i] === 1);
      cands.push({ ym: [thirteen ? { name: '国士無双13面', mult: R.double_yakuman ? 2 : 1 } : { name: '国士無双', mult: 1 }] });
    }
  }
  if (!cands.length) return fail('not_agari');
  /* ── ドラ ── */
  const doraT = dora.map((i) => doraOf(i, R.players)), uraT = inp.riichi ? ura.map((i) => doraOf(i, R.players)) : [];
  const allTiles = [...hand, ...melds.flatMap((m) => m.tiles)];
  const countIn = (ts2) => ts2.reduce((a, d) => a + allTiles.filter((i) => i === d).length + (d === KITA ? inp.kita : 0), 0);
  const doraN = { dora: countIn(doraT), ura: countIn(uraT), aka: inp.aka, kita: three && R.kita === 'nuki' ? inp.kita : 0 };
  const doraHan = doraN.dora + doraN.ura + doraN.aka + doraN.kita;
  /* ── 一番高い形 ── */
  let best = null;
  const tenchi = inp.tenhou ? { name: '天和', mult: 1 } : inp.chiihou ? { name: '地和', mult: 1 } : null;
  for (const c0 of cands) {
    const c = tenchi ? { ym: [tenchi, ...(c0.ym || [])] } : c0;
    let r;
    if (c.ym) {
      const mult = R.double_yakuman ? c.ym.reduce((a, y) => a + y.mult, 0) : 1;
      const pts = points(0, 0, oya, ts, R, mult);
      r = { han: 0, fu: 0, yaku: [], yakuman: c.ym.map(({ name, mult: m }) => ({ name, mult: R.double_yakuman ? m : 1 })), ymRaw: c.ym, mult, fuParts: [], pts };
    } else {
      const yh = c.yaku.reduce((a, y) => a + y.han, 0);
      if (yh === 0) continue;
      const han = yh + doraHan;
      const pts = points(han, c.fu, oya, ts, R, 0);
      if (!pts) continue;
      r = { han, fu: c.fu, yaku: c.yaku, yakuman: [], mult: 0, fuParts: c.fuParts, pts };
    }
    const better = !best || r.pts.total > best.pts.total || (r.pts.total === best.pts.total && (r.han > best.han || (r.han === best.han && r.fu > best.fu)));
    if (better) best = r;
  }
  if (!best) return fail('no_yaku');
  /* ── 包の役が手に在るか ── */
  let P = null;
  if (pao) {
    const y = best.ymRaw && best.ymRaw.find((x) => x.key === pao.yaku);
    if (!y) return fail('flags', 'pao-yaku');
    const pm = R.double_yakuman ? y.mult : 1;
    P = points(0, 0, oya, ts, R, pm);
    P.mult = pm;
  }
  const pay = payOf(best, P, { oya, ts, R, pao, honba: inp.honba, kyotaku: inp.kyotaku });
  const out = { ok: true, han: best.han, fu: best.fu, yaku: best.yaku, yakuman: best.yakuman, fuParts: best.fuParts, dora: best.mult ? { dora: 0, ura: 0, aka: 0, kita: 0 } : doraN, pts: best.pts, pay };
  return out;
}

/** 人ごとの払い：rows＝[{ who, pts, n }]（n＝その払いをする人の数）・total＝和了った人が受け取る合計（供託を除く）・kyotaku */
function payOf(best, P, { oya, ts, R, pao, honba, kyotaku }) {
  const n = R.players;
  const unit = R.honba === 1500 ? 500 : 100;
  const hRon = unit * 3 * honba, hEach = unit * honba;
  const rows = [];
  const pts = best.pts;
  if (!P) {
    if (!ts) rows.push({ who: '放銃者', pts: pts.ron + hRon, n: 1 });
    else if (oya) rows.push({ who: '子（各）', pts: pts.all + hEach, n: n - 1 });
    else { rows.push({ who: '親', pts: pts.oya + hEach, n: 1 }); rows.push({ who: '子（各）', pts: pts.ko + hEach, n: n - 2 }); }
  } else {
    const Rm = best.mult - P.mult;
    const Rp = Rm > 0 ? points(0, 0, oya, ts, R, Rm) : null;
    if (!ts) {
      const half = P.ron / 2;
      if (pao.same) rows.push({ who: '放銃者（責任者）', pts: P.ron + (Rp ? Rp.ron : 0) + hRon, n: 1 });
      else { rows.push({ who: '放銃者', pts: half + (Rp ? Rp.ron : 0) + hRon, n: 1 }); rows.push({ who: '責任者', pts: half, n: 1 }); }
    } else {
      const hAll = hEach * (n - 1);
      if (oya) {
        rows.push({ who: '責任者', pts: P.total + (Rp ? Rp.all : 0) + hAll, n: 1 });
        if (n - 2 > 0) rows.push({ who: '子（各）', pts: Rp ? Rp.all : 0, n: n - 2 });
      } else {
        const mine = Rp ? (pao.who === 'oya' ? Rp.oya : Rp.ko) : 0;
        rows.push({ who: '責任者', pts: P.total + mine + hAll, n: 1 });
        if (pao.who === 'oya') { if (n - 2 > 0) rows.push({ who: '子（各）', pts: Rp ? Rp.ko : 0, n: n - 2 }); }
        else { rows.push({ who: '親', pts: Rp ? Rp.oya : 0, n: 1 }); if (n - 3 > 0) rows.push({ who: '子（各）', pts: Rp ? Rp.ko : 0, n: n - 3 }); }
      }
    }
  }
  const total = rows.reduce((a, r) => a + r.pts * r.n, 0);
  return { rows, total, kyotaku: 1000 * kyotaku };
}
