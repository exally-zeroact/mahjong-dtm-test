/* hayami.js — 早見表の画面（計算は lib/score-table.mjs・記録はしない・ルールの選びだけ端末に覚える） */
import { FU_LIST, points, label, limitRows } from '../lib/score-table.mjs';

const f = (x) => x.toLocaleString('en-US');
/* マスの字：ツモは幅が足りないので 子ツモ＝上に子の払い・下に親の払い／親ツモ＝1人の払い（「オール」は見出しに出す） */
function cell(p) {
  if (!p || p.ron != null) return label(p);
  if (p.all != null) return f(p.all);
  return `<span class="two">${f(p.ko)}<br>${f(p.oya)}</span>`;
}

const KEY = 'mj.hayami.v1';
const st = Object.assign({ oya: 'ko', agari: 'ron', players: '4', tsumo3: 'son', kiriage: '0', kazoe: 'yakuman' },
  (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 覚えられない端末でも表は出す */ } };
const $ = (id) => document.getElementById(id);
const rules = () => ({ players: +st.players, tsumo3: st.tsumo3, kiriage: st.kiriage === '1', kazoe: st.kazoe });

function render() {
  for (const [id, k] of [['seg-oya', 'oya'], ['seg-agari', 'agari']])
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === st[k]));
  for (const k of ['players', 'tsumo3', 'kiriage', 'kazoe']) $('r-' + k).value = st[k];
  $('r-tsumo3').disabled = st.players !== '3';
  const oya = st.oya === 'oya', tsumo = st.agari === 'tsumo', R = rules();
  const unit = tsumo ? (oya ? '<span class="sub">オール</span>' : '<span class="sub">子／親</span>') : '';
  let h = '<thead><tr><th scope="col">符＼翻' + unit + '</th>' + [1, 2, 3, 4].map((x) => `<th scope="col">${x}翻</th>`).join('') + '</tr></thead><tbody>';
  for (const fu of FU_LIST) {
    h += `<tr><th scope="row">${fu}符${fu === 25 ? '<span class="sub">七対子</span>' : fu === 20 ? '<span class="sub">平和ツモ</span>' : ''}</th>`;
    for (let han = 1; han <= 4; han++) {
      const p = points(han, fu, oya, tsumo, R);
      h += `<td${p && p.base === 2000 ? ' class="man"' : ''}>${cell(p)}</td>`;
    }
    h += '</tr>';
  }
  $('hy-main').innerHTML = h + '</tbody>';
  $('hy-main').classList.toggle('tsumo', tsumo);
  const n3 = R.players === 3;
  $('hy-note').textContent = '色付き＝満貫。' + (R.kiriage ? '30符4翻・60符3翻は切り上げて満貫。' : '30符4翻・60符3翻を満貫に切り上げるかはルールで選ぶ。')
    + (tsumo ? (oya ? '親ツモは子の1人ずつの払い（オール）。' : '子ツモは上が子の払い・下が親の払い。') : '')
    + (n3 && tsumo ? (R.tsumo3 === 'son' ? '3人のツモ損＝居ない人の分は払わない。' : '3人の折半＝4人の時の払いに、居ない人の払いの半分を足して100点に切り上げ。') : '');
  let L = '<thead><tr><th scope="col"></th><th scope="col">翻</th><th scope="col">子</th><th scope="col">親</th></tr></thead><tbody>';
  for (const r of limitRows(R))
    L += `<tr><th scope="row">${r.name}</th><td>${r.han}</td><td>${cell(points(r.h, 30, false, tsumo, R, r.ym || 0))}</td><td>${cell(points(r.h, 30, true, tsumo, R, r.ym || 0))}${tsumo ? '<span class="sub">オール</span>' : ''}</td></tr>`;
  $('hy-limit').innerHTML = L + '</tbody>';
  $('hy-limit').classList.toggle('tsumo', tsumo);
}

for (const [id, k] of [['seg-oya', 'oya'], ['seg-agari', 'agari']])
  $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st[k] = b.dataset.v; save(); render(); });
for (const k of ['players', 'tsumo3', 'kiriage', 'kazoe'])
  $('r-' + k).addEventListener('change', (e) => { st[k] = e.target.value; save(); render(); });
render();
