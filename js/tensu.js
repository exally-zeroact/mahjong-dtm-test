/* tensu.js — 点数計算の画面（件4c・設計 tataki/score_sekkei_v13.md「画面（4c・絵 v153 ①）」・絵 mahjong_dougu_v153.png ①）
 * 計算は lib/score.mjs だけ（画面で式を持たない）・絵は js/tile-svg.mjs・記録はしない・端末に覚えるのは今の手だけ（mj.tensu.v1）。
 * ルール＝?r=<11鍵の JSON>（対局のページが卓の写しから渡す）を rulesOk に通す。無い・落ちた・欠けた時は帯を必ず出す（黙って既定にしない）。
 * 戻り先＝?from= の origin が同じで、道が /taikyoku.html か /r/<token>（TOKEN_RE）の時だけ。生の from でなく pathname＋search を組み直す。
 * 子/親は自風で決まる（親＝自風 東・score と同じ）。最後に入れた牌＝和了牌。
 */
import { codeToIndex, indexToCode, tileName } from '../lib/tiles.mjs';
import { exists } from '../lib/shanten.mjs';
import { score, doraOf } from '../lib/score.mjs';
import { label } from '../lib/score-table.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { TOKEN_RE } from '../lib/url-token.mjs';
import { tileSVG } from './tile-svg.mjs';

const $ = (id) => document.getElementById(id);
const SCORE_KEYS = ['players', 'kuitan', 'aka', 'double_yakuman', 'renpu_fu', 'kiriage', 'kazoe', 'tsumo3', 'honba', 'kita', 'pao'];

/* ── ルール（?r=） ── */
const q = new URLSearchParams(location.search);
let R, obi = '';
{
  let got = null;
  try { got = q.has('r') ? JSON.parse(q.get('r')) : null; } catch { got = null; }
  const v = got ? rulesOk(got) : { ok: false };
  if (v.ok) {
    R = v.rules;
    if (SCORE_KEYS.some((k) => !Object.prototype.hasOwnProperty.call(got, k))) obi = '一部のルールが既定';
  } else { R = defaultRules(4); obi = '既定のルール（4人）で計算'; }
}
const P = R.players;
if (obi) { $('obi').textContent = obi; $('obi').hidden = false; }

/* ── 戻り先（?from=） ── */
{
  const f = q.get('from');
  if (f) {
    try {
      const u = new URL(f, location.origin);
      const m = u.pathname.match(/^\/r\/([^/]+)$/);
      if (u.origin === location.origin && (u.pathname === '/taikyoku.html' || (m && TOKEN_RE.test(m[1])))) {
        $('back').href = u.pathname + u.search;
        $('back').textContent = '‹ 対局';
      }
    } catch { /* 読めない from は ホームへ */ }
  }
}

/* ── 今の手（端末に覚える・戻した物を信じない） ── */
const KEY = 'mj.tensu.v1';
const WINDS = P === 3 ? ['1z', '2z', '3z'] : ['1z', '2z', '3z', '4z'];
const FLAGS = ['ippatsu', 'rinshan', 'haitei', 'houtei', 'chankan', 'tenhou', 'chiihou'];
const MELD_N = { chi: 3, pon: 3, minkan: 4, ankan: 4 };
const DEF = { agari: 'ron', riichi: 0, bakaze: '1z', jikaze: '2z', hand: [], dora: [], ura: [], melds: [], aka: 0, kita: 0, honba: 0, kyotaku: 0, pao: '', paoSame: false, paoWho: 'ko' };
for (const k of FLAGS) DEF[k] = false;
const st = Object.assign({}, DEF, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
let target = 'hand';
const okCode = (c) => { try { const i = typeof c === 'string' && c.length === 2 ? codeToIndex(c) : -1; return i >= 0 && i < 34 && c[0] !== '0' && exists(i, P); } catch { return false; } };
(() => {
  if (!['ron', 'tsumo'].includes(st.agari)) st.agari = 'ron';
  if (![0, 1, 2].includes(st.riichi)) st.riichi = 0;
  for (const k of FLAGS) st[k] = st[k] === true;
  if (!WINDS.includes(st.bakaze)) st.bakaze = '1z';
  if (!WINDS.includes(st.jikaze)) st.jikaze = '2z';
  for (const [k, max] of [['aka', 4], ['kita', 4], ['honba', 20], ['kyotaku', 20]]) if (!Number.isInteger(st[k]) || st[k] < 0 || st[k] > max) st[k] = 0;
  if (!(P === 3 && R.kita === 'nuki')) st.kita = 0;
  if (!['', 'daisangen', 'daisuushii', 'suukantsu'].includes(st.pao) || !R.pao) st.pao = '';
  st.paoSame = st.paoSame === true;
  if (!['oya', 'ko'].includes(st.paoWho)) st.paoWho = 'ko';
  st.melds = (Array.isArray(st.melds) ? st.melds : []).filter((m) => m && MELD_N[m.kind] && !(P === 3 && m.kind === 'chi') && Array.isArray(m.tiles) && m.tiles.length === MELD_N[m.kind] && m.tiles.every(okCode)).slice(0, 4);
  const n = new Array(34).fill(0);
  for (const m of st.melds) for (const c of m.tiles) n[codeToIndex(c)]++;
  n[30] += st.kita;
  if (n.some((x) => x > 4)) { st.melds = []; n.fill(0); n[30] += st.kita; }
  const take = (c) => { if (!okCode(c)) return false; const i = codeToIndex(c); if (n[i] >= 4) return false; n[i]++; return true; };
  st.hand = (Array.isArray(st.hand) ? st.hand : []).filter(take).slice(0, 14 - 3 * st.melds.length);
  st.dora = (Array.isArray(st.dora) ? st.dora : []).filter(take).slice(0, 5);
  st.ura = (Array.isArray(st.ura) ? st.ura : []).filter(take).slice(0, 5);
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 覚えられなくても動く */ } };

const KB = Array.from({ length: 34 }, (_, i) => indexToCode(i));
const maxHand = () => 14 - 3 * st.melds.length;
const maxDora = () => 1 + st.melds.filter((m) => m.kind.endsWith('kan')).length;
function used(i) {
  let n = 0;
  for (const c of [...st.hand, ...st.dora, ...st.ura, ...st.melds.flatMap((m) => m.tiles)]) if (codeToIndex(c) === i) n++;
  return n + (i === 30 ? st.kita : 0);
}
const meldTiles = (kind, i) => (kind === 'chi' ? (i < 27 && i % 9 <= 6 ? [i, i + 1, i + 2] : null) : new Array(MELD_N[kind]).fill(i));
function canTap(i) {
  if (target === 'hand') return st.hand.length < maxHand() && used(i) < 4;
  if (target === 'dora' || target === 'ura') return st[target].length < maxDora() && used(i) < 4;
  if (P === 3 && target === 'chi') return false;
  const t = meldTiles(target, i);
  if (!t || !t.every((x) => exists(x, P))) return false;
  if (st.melds.length >= 4 || st.hand.length > maxHand() - 3) return false;
  const need = {}; for (const x of t) need[x] = (need[x] || 0) + 1;
  return Object.entries(need).every(([x, k]) => used(+x) + k <= 4);
}

/* ── 字 ── */
const ERR = {
  count: '牌の数か形が合いません', over4: '同じ牌が5枚以上あります', aka: '赤の枚数が多すぎます（5の牌の数とルールの赤の数まで）',
  sanma: '3人打ちでは使えない牌か鳴きです（2〜8萬・チー）', dora: 'ドラ表示が多すぎます（1＋槓の数まで）',
  not_agari: '和了の形になっていません', no_yaku: '役がありません（ドラだけでは和了れません）', flags: 'あり得ない組み合わせです',
};
const WHY = {
  ippatsu: '一発は立直の時だけ', 'riichi-open': '鳴いていると立直はできません', haitei: '海底はツモの時だけ', houtei: '河底はロンの時だけ',
  chankan: '槍槓はロンの時だけ', 'rinshan-ron': '嶺上はツモの時だけ', rinshan: '嶺上は槓（3人は北抜き）の後だけ', 'ippatsu-rinshan': '槓の後の嶺上に一発は付きません',
  pair: '同時には起きない状況です', tenhou: '天和・地和はツモだけで、鳴き・立直・他の状況とは付きません', 'tenhou-ko': '天和は親だけ', 'chiihou-oya': '地和は子だけ',
  kita: '北抜きは3人打ちで北抜きありの時だけ', ura: '裏ドラは立直の時だけ', riichi: '立直の数が読めません', kaze: '風が読めません', 'sanma-kita': '3人打ちに北の風はありません',
  'pao-off': 'このルールでは包はありません', 'pao-same': '包のロンは「放銃者が責任者」かを選んでください', 'pao-who': '包の子のツモは責任者が親か子かを選んでください',
  'pao-yaku': '包の役が手にありません', 'pao-meld': '包の役の鳴きが足りません',
};
const fmt = (x) => x.toLocaleString('en-US');
const nm = (i) => tileName(indexToCode(i));
const T = (c, w) => tileSVG(c, w, tileName(c));
const MELD_NAME = { chi: 'チー', pon: 'ポン', minkan: '明槓', ankan: '暗槓' };

function input() {
  const inp = {
    hand: st.hand, win: st.hand[st.hand.length - 1], melds: st.melds, tsumo: st.agari === 'tsumo', riichi: st.riichi,
    bakaze: st.bakaze, jikaze: st.jikaze, dora: st.dora, ura: st.ura, aka: st.aka, kita: st.kita, honba: st.honba, kyotaku: st.kyotaku,
  };
  for (const k of FLAGS) if (st[k]) inp[k] = true;
  if (st.pao && R.pao) {
    inp.pao = { yaku: st.pao };
    if (!inp.tsumo) inp.pao.same = st.paoSame;
    else if (st.jikaze !== '1z') inp.pao.who = st.paoWho;
  }
  return inp;
}

function resultHTML() {
  const left = maxHand() - st.hand.length;
  if (left > 0) return `<p class="empty">あと ${left} 枚入れてください。</p>`;
  const r = score(input(), R);
  if (!r.ok) return `<p class="err" id="err">${ERR[r.err] || r.err}${r.err === 'flags' && r.why ? '：' + (WHY[r.why] || r.why) : ''}</p>`;
  let h;
  if (r.yakuman.length) {
    h = `<div class="res-top"><span>${r.pts.name}</span><span class="big" id="pts">${label(r.pts)}</span></div><div class="yk yk2">`;
    for (const y of r.yakuman) h += `<span>${y.name}</span><span>${y.mult > 1 ? y.mult + '倍' : ''}役満</span>`;
    h += '</div>';
  } else {
    h = `<div class="res-top"><span id="hanfu">${r.han}翻 ${r.fu}符${r.pts.name ? '　' + r.pts.name : ''}</span><span class="big" id="pts">${label(r.pts)}</span></div><div class="yk yk2" id="yaku">`;
    const rows = [...r.yaku];
    for (const [k, n] of [['dora', 'ドラ'], ['ura', '裏ドラ'], ['aka', '赤ドラ'], ['kita', '北抜き']]) if (r.dora[k] > 0) rows.push({ name: n, han: r.dora[k] });
    for (const y of rows) h += `<span>${y.name}</span><span>${y.han}翻</span>`;
    h += '</div><h3 class="sec-h">符の内訳</h3><div class="yk yk2 fu" id="fu">';
    for (const f of r.fuParts) h += `<span>${f.name}</span><span>${f.fu}符</span>`;
    h += `<span>計</span><span>${r.fu}符</span></div>`;
  }
  if (st.honba || st.kyotaku || input().pao) {
    h += '<h3 class="sec-h">払い</h3><div class="yk" id="pay">';
    for (const x of r.pay.rows) h += `<span>${x.who}${x.n > 1 ? ' ×' + x.n : ''}</span><span>${fmt(x.pts)}</span>`;
    h += `<span>受け取り 計</span><span>${fmt(r.pay.total)}${r.pay.kyotaku ? '＋供託 ' + fmt(r.pay.kyotaku) : ''}</span></div>`;
  }
  return h;
}

function stepsHTML() {
  const rows = [['aka', '赤', 4], ['honba', '本場', 20], ['kyotaku', '供託', 20]];
  if (P === 3 && R.kita === 'nuki') rows.splice(1, 0, ['kita', '北抜き', 4]);
  return rows.map(([k, n, max]) => `<div class="step"><span>${n}</span><button type="button" class="btn-s" data-s="${k}" data-d="-1" aria-label="${n}を減らす"${st[k] <= 0 ? ' disabled' : ''}>−</button><span class="v" id="v-${k}">${st[k]}</span><button type="button" class="btn-s" data-s="${k}" data-d="1" aria-label="${n}を増やす"${st[k] >= max || (k === 'kita' && used(30) >= 4) ? ' disabled' : ''}>＋</button></div>`).join('');
}

function render() {
  const oya = st.jikaze === '1z';
  for (const b of document.querySelectorAll('.chip[data-k]')) {
    const k = b.dataset.k, v = b.dataset.v;
    const on = k === 'agari' ? st.agari === v : k === 'oya' ? (v === 'oya') === oya : k === 'riichi' ? st.riichi === +v : st[k];
    b.setAttribute('aria-pressed', String(!!on));
  }
  $('bakaze').textContent = '場風 ' + nm(codeToIndex(st.bakaze));
  $('jikaze').textContent = '自風 ' + nm(codeToIndex(st.jikaze));
  for (const el of document.querySelectorAll('.pick')) el.setAttribute('aria-pressed', String(el.dataset.t === target));
  $('hand-h').textContent = `手牌（${maxHand() - 1}枚）＋ 和了牌`;
  $('hand').innerHTML = st.hand.map((c, k) => `<button type="button" class="tbtn${k === maxHand() - 1 ? ' win' : ''}" data-k="${k}" aria-label="${tileName(c)}を外す">${T(c, 23)}</button>`).join('');
  $('dora').innerHTML = st.dora.map((c, k) => `<span class="tbtn" data-k="${k}">${T(c, 24)}</span>`).join('') || '<span class="empty">押して入れる</span>';
  $('dora-to').textContent = st.dora.length ? '→ ドラ ' + st.dora.map((c) => nm(doraOf(codeToIndex(c), P))).join('・') : '';
  $('ura').innerHTML = st.ura.map((c) => `<span class="tbtn">${T(c, 24)}</span>`).join('') || '<span class="empty">押して入れる</span>';
  $('melds').innerHTML = st.melds.map((m, k) => `<button type="button" class="tbtn meld" data-m="${k}" aria-label="${MELD_NAME[m.kind]}を外す">${m.tiles.map((c) => T(c, 21)).join('')}<span class="mk">${MELD_NAME[m.kind]}</span></button>`).join('');
  $('kb-h').textContent = target === 'hand' ? '牌を足す' : target === 'dora' ? 'ドラ表示を足す' : target === 'ura' ? '裏ドラ表示を足す' : target === 'chi' ? 'チーの一番小さい牌を選ぶ' : MELD_NAME[target] + 'の牌を選ぶ';
  $('kb').innerHTML = KB.map((c) => {
    const i = codeToIndex(c);
    if (!exists(i, P)) return '';
    return `<button type="button" class="tbtn" data-c="${c}" aria-label="${tileName(c)}"${canTap(i) ? '' : ' disabled'}>${tileSVG(c, 36, tileName(c))}</button>`;
  }).join('');
  $('steps').innerHTML = stepsHTML();
  $('meld-kinds').querySelector('[data-t="chi"]').hidden = P === 3;
  $('pao-box').hidden = !R.pao;
  $('pao').value = st.pao;
  $('pao-same').hidden = !st.pao || st.agari !== 'ron';
  $('pao-who').hidden = !st.pao || st.agari !== 'tsumo' || oya;
  $('pao-same').querySelector('button').setAttribute('aria-pressed', String(st.paoSame));
  for (const b of $('pao-who').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === st.paoWho));
  $('result').innerHTML = resultHTML();
}

/* ── 押す ── */
$('kb').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]'); if (!b || b.disabled) return;
  const c = b.dataset.c, i = codeToIndex(c);
  if (!canTap(i)) return;
  if (target === 'hand') st.hand.push(c);
  else if (target === 'dora' || target === 'ura') st[target].push(c);
  else { st.melds.push({ kind: target, tiles: meldTiles(target, i).map(indexToCode) }); target = 'hand'; }
  save(); render();
});
$('hand').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; st.hand.splice(+b.dataset.k, 1); save(); render(); });
$('melds').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (!b) return; st.melds.splice(+b.dataset.m, 1); save(); render(); });
$('clear-hand').addEventListener('click', (e) => { e.stopPropagation(); st.hand = []; st.melds = []; st.dora = []; st.ura = []; target = 'hand'; save(); render(); });
for (const el of document.querySelectorAll('.pick')) el.addEventListener('click', (e) => {
  if (e.target.closest('#hand button, #clear-hand')) return;
  const t = el.dataset.t;
  if (t === 'dora' || t === 'ura') { if (target === t && st[t].length) st[t].pop(); else target = t; }
  else target = target === t && t !== 'hand' ? 'hand' : t;
  save(); render();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.chip[data-k]'); if (!b) return;
  const k = b.dataset.k, v = b.dataset.v;
  if (k === 'agari') st.agari = v;
  else if (k === 'oya') { if (v === 'oya') st.jikaze = '1z'; else if (st.jikaze === '1z') st.jikaze = '2z'; }
  else if (k === 'riichi') st.riichi = st.riichi === +v ? 0 : +v;
  else st[k] = !st[k];
  save(); render();
});
for (const id of ['bakaze', 'jikaze']) $(id).addEventListener('click', () => { st[id] = WINDS[(WINDS.indexOf(st[id]) + 1) % WINDS.length]; save(); render(); });
$('steps').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-s]'); if (!b || b.disabled) return;
  st[b.dataset.s] += +b.dataset.d; save(); render();
});
$('pao').addEventListener('change', (e) => { st.pao = e.target.value; save(); render(); });
$('pao-same').addEventListener('click', (e) => { if (!e.target.closest('button')) return; st.paoSame = !st.paoSame; save(); render(); });
$('pao-who').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; st.paoWho = b.dataset.v; save(); render(); });
render();
