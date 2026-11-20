/* machi.js — 待ち読みの画面（計算は lib/shanten.mjs・絵は js/tile-svg.mjs・記録はしない・端末に覚えるだけ）
 * 画面＝machi.html（13枚の待ち・14枚の何を切る・見えている牌・3人）。webkit 390×844 で写して確かめた（11-20）。
 * machi.html に要る id：seg-mode(13/14)・hand-h・hand・clear-hand・result・seg-target(hand/seen)・kb・seen-h・seen・clear-seen・r-players
 */
import { codeToIndex, indexToCode, sortCodes, tileName, toCounts } from '../lib/tiles.mjs';
import { analyze13, analyze14, exists } from '../lib/shanten.mjs';
import { tileSVG } from './tile-svg.mjs';

const KEY = 'mj.machi.v1';
const st = Object.assign({ mode: '13', target: 'hand', players: '4', hand: [], seen: [] },
  (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
// 端末から戻した物を信じない：知らない字・1種5枚目・枚数の越えを落とす（11-20 taiketsu-naoshi の任意4）
(() => {
  if (!['13', '14'].includes(st.mode)) st.mode = '13';
  if (!['hand', 'seen'].includes(st.target)) st.target = 'hand';
  if (!['3', '4'].includes(st.players)) st.players = '4';
  const n = new Array(34).fill(0);
  const idx = (c) => { try { return typeof c === 'string' ? codeToIndex(c) : -1; } catch { return -1; } }; // codeToIndex は知らない字で投げる
  const ok = (c) => { const i = idx(c); if (!(i >= 0 && i < 34) || n[i] >= 4 || !exists(i, +st.players)) return false; n[i]++; return true; };
  st.hand = (Array.isArray(st.hand) ? st.hand : []).filter(ok).slice(0, +st.mode);
  n.fill(0); for (const c of st.hand) n[idx(c)]++; // 切って落とした手牌を見えている牌の数に残さない（11-20 taiketsu 任意2）
  st.seen = (Array.isArray(st.seen) ? st.seen : []).filter(ok);
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 覚えられなくても動く */ } };
const $ = (id) => document.getElementById(id);
const KB = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
  '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
const players = () => +st.players;
const max = () => +st.mode;
const used = (i) => st.hand.filter((c) => codeToIndex(c) === i).length + st.seen.filter((c) => codeToIndex(c) === i).length;
const T = (i, w) => tileSVG(indexToCode(i), w, tileName(indexToCode(i)));
const sh = (v) => (v === null ? '—' : v === -1 ? '和了' : v === 0 ? '聴牌' : v + 'シャンテン');

function dropMissing() {
  const keep = (c) => exists(codeToIndex(c), players());
  st.hand = st.hand.filter(keep); st.seen = st.seen.filter(keep);
}

function resultHTML() {
  const n = st.hand.length;
  if (n === 0) return '<p class="empty">下の牌を押して手牌を入れてください。</p>';
  const c = toCounts(st.hand), seen = toCounts(st.seen), P = players();
  if (n % 3 === 0) return `<p class="empty">${n}枚では形になりません。13枚（鳴いたら10・7・4・1枚）で待ち、14枚（11・8・5・2枚）で何を切るかを出します。</p>`;
  if (n % 3 === 1) {
    const r = analyze13(c, seen, P);
    const s = r.shanten;
    const forms = `一般形 ${sh(s.normal)}・七対子 ${sh(s.chiitoi)}・国士 ${sh(s.kokushi)}`;
    if (s.best === 0) {
      let h = `<div class="res-top"><span>聴牌（0シャンテン）</span><span class="big">${r.waits.length}種 ${r.waitTotal}枚</span></div>`; // 絵 v153＝聴牌の時は形の内訳を出さない
      for (const w of r.waits) h += `<div class="wrow">${T(w.tile, 32)}<span class="bar"><i style="width:${w.left * 25}%"></i></span><span class="n">残り ${w.left}枚</span></div>`;
      h += '<p class="note">残り＝4枚 − 手の中の数 − 見えている牌。</p>';
      if (r.waits.some((w) => c[w.tile] >= 4)) h += '<p class="note">残り0枚の待ちは、その牌を手で4枚使っています（純空）。和了の形ではあっても、引く事はできません。</p>';
      return h;
    }
    const u = r.ukeire.best;
    let h = `<div class="res-top"><span>${s.best}シャンテン</span><span class="big">${u.kinds}種 ${u.total}枚</span></div><p class="forms">${forms}／受け入れ＝引くとシャンテンが下がる牌</p>`;
    h += '<div class="tiles">' + u.tiles.map((t) => `<span title="残り${t.left}枚">${T(t.tile, 28)}</span>`).join('') + '</div>';
    for (const [k, nm] of [['normal', '一般形'], ['chiitoi', '七対子'], ['kokushi', '国士']]) {
      const x = r.ukeire[k];
      if (x && s[k] === s.best) h += `<p class="forms">${nm}で ${x.kinds}種 ${x.total}枚</p>`;
    }
    return h;
  }
  const r = analyze14(c, seen, P);
  let h = r.agari
    ? '<div class="res-top"><span>和了の形です</span><span class="big">和了</span></div><p class="forms">切るとどうなるかも下に出します。</p>'
    : `<div class="res-top"><span>何を切るか</span><span class="big">${sh(r.rows[0].shanten)}</span></div><p class="forms">良い順（シャンテンが小さい→枚数が多い）</p>`;
  for (const row of r.rows) {
    const what = row.shanten === 0 ? `聴牌 待ち ${row.waits.length}種 ${row.waits.reduce((a, w) => a + w.left, 0)}枚` : `${row.shanten}シャンテン 受け入れ ${row.kinds}種 ${row.total}枚`;
    const list = row.shanten === 0 ? row.waits : row.tiles;
    h += `<div class="drow"><span>${T(row.discard, 30)}</span><span class="what">切る → ${what}</span><span class="tiles">${list.map((t) => T(t.tile, 20)).join('')}</span></div>`;
  }
  return h;
}

function tileBtns(arr, w) {
  return arr.map((c, k) => `<button type="button" class="tbtn" data-k="${k}" aria-label="${tileName(c)}を外す">${tileSVG(c, w, tileName(c))}</button>`).join('');
}

function render() {
  for (const [id, k] of [['seg-mode', 'mode'], ['seg-target', 'target']])
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === st[k]));
  $('r-players').value = st.players;
  st.hand = sortCodes(st.hand); st.seen = sortCodes(st.seen);
  $('hand-h').textContent = `手牌 ${st.hand.length}/${max()}`;
  $('hand').innerHTML = tileBtns(st.hand, 21);
  $('seen-h').textContent = `見えている牌 ${st.seen.length}枚`;
  $('seen').innerHTML = st.seen.length ? tileBtns(st.seen, 23) : '<p class="empty">なし</p>';
  const full = st.target === 'hand' && st.hand.length >= max();
  $('kb').innerHTML = KB.map((c) => {
    const i = codeToIndex(c);
    if (!exists(i, players())) return '';
    const dis = full || used(i) >= 4;
    return `<button type="button" class="tbtn" data-c="${c}" aria-label="${tileName(c)}"${dis ? ' disabled' : ''}>${tileSVG(c, 36, tileName(c))}</button>`;
  }).join('');
  $('result').innerHTML = resultHTML();
}

$('kb').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]'); if (!b || b.disabled) return;
  const c = b.dataset.c;
  if (used(codeToIndex(c)) >= 4) return;
  if (st.target === 'hand') { if (st.hand.length >= max()) return; st.hand.push(c); } else st.seen.push(c);
  save(); render();
});
$('hand').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; st.hand.splice(+b.dataset.k, 1); save(); render(); });
$('seen').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; st.seen.splice(+b.dataset.k, 1); save(); render(); });
$('clear-hand').addEventListener('click', () => { st.hand = []; save(); render(); });
$('clear-seen').addEventListener('click', () => { st.seen = []; save(); render(); });
for (const [id, k] of [['seg-mode', 'mode'], ['seg-target', 'target']])
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    st[k] = b.dataset.v;
    if (k === 'mode' && st.hand.length > max()) st.hand = st.hand.slice(0, max());
    save(); render();
  });
$('r-players').addEventListener('change', (e) => { st.players = e.target.value; dropMissing(); save(); render(); });
render();
