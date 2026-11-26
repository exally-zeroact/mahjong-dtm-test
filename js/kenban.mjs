/*
 * アプリの数字鍵盤（部品）＝A8（tataki/a8_sadame_v1.md）。A3（gamen-room.mjs の点の鍵盤）と同じ鍵の並び・同じ動き。
 * 司さん 11-21「iPhoneでもAndroidでもキーボードだしたらよかろが」「そもそも＋ボタンはいらんやろが」＝端末の鍵盤は出さない・− は鍵の「−」だけ。
 *
 * kpPress(text, key, spec, fresh) → 次の字（純関数・node 試験はここを見る）
 *   spec＝{ neg: −を打てるか, dec: 小数1桁まで打てるか（「000」の所が「.」）, max: 整数の桁の上限 }
 *   fresh＝箱に入ってまだ数を打っていないか（最初の数の鍵は中身を置き換える）：false／true（＋で置き換え）／'neg'（−を押した＝−で置き換え）
 *   ★最初の数の前の「−」は fresh を消さない★（A3 は「−」の後の数が足し算になり 10→−101。A8 では −→1→0 で −10）
 * kpNextFresh(fresh, key) → 鍵の後の fresh
 * keypadHtml(spec) → 鍵盤の HTML（id は付けない＝1頁に2つ在っても混ざらない）
 * wireKeypad(host, { boxes, spec, onChange }) → 箱の focus で鍵盤を出す・鍵を押したら字を作る。host の中の .kp と .kp-sp を使う
 */
const KEYS = (dec) => [['1'], ['2'], ['3'], ['bs', '⌫', '1字消す'], ['4'], ['5'], ['6'], ['neg', '−', '＋−を替える'], ['7'], ['8'], ['9'], ['next', '↓', '次の箱へ'], dec ? ['dot', '.', '小数点'] : ['000'], ['0'], ['ok', '✓', '閉じる']];

export function kpPress(text, key, spec = {}, fresh = false) {
  const max = spec.max || 6;
  const t = String(text || '').trim();
  let neg = /^[-−ー－]/.test(t);
  const body = (neg ? t.slice(1) : t).replace(/[^0-9.]/g, '');
  let [ip, fp] = body.includes('.') ? [body.slice(0, body.indexOf('.')), body.slice(body.indexOf('.') + 1).replace(/\./g, '')] : [body, null];
  if (!spec.dec) fp = null;
  if (/^[0-9]+$/.test(key) || key === 'dot') {
    if (fresh) { neg = fresh === 'neg'; ip = ''; fp = null; }
    if (key === 'dot') { if (!spec.dec || fp !== null) return show(neg, ip, fp); if (ip === '') ip = '0'; fp = ''; }
    else if (fp !== null) { if (fp.length >= 1) return show(neg, ip, fp); fp += key; }
    else { const d = (ip + key).replace(/^0+(?=\d)/, ''); if (d.length > max) return show(neg, ip, fp); ip = d; }
  } else if (key === 'bs') {
    if (fp !== null) fp = fp === '' ? null : fp.slice(0, -1);
    else if (ip) ip = ip.slice(0, -1);
    else neg = false;
  } else if (key === 'neg') { if (spec.neg) neg = !neg; }
  return show(neg, ip, fp);
}
export function kpNextFresh(fresh, key, spec = {}) {
  if (key === 'neg' && !spec.neg) return fresh; // 効かない鍵は何も変えない
  if (key === 'dot' && !spec.dec) return fresh;
  if (fresh && key === 'neg') return fresh === 'neg' ? true : 'neg';
  return false;
}
function show(neg, ip, fp) {
  const i = ip === '' ? '' : Number(ip).toLocaleString('ja-JP');
  return (neg ? '−' : '') + i + (fp === null ? '' : '.' + fp);
}

// sp:false＝下の空きは呼ぶ側がボタンより下に置く（wireKeypad の sp に渡す）＝空きが釦より上だと鍵盤を開いた時に釦が鍵盤の下に隠れて押せない（KPSP・CI 45811332647）
export function keypadHtml({ sp = true } = {}) {
  return (sp ? '<div class="kp-sp" hidden></div>' : '') + '<div class="kp" role="group" aria-label="数字の鍵盤" hidden></div>';
}
function keysHtml(spec) {
  return KEYS(spec.dec).map(([k, t, a]) => '<button type="button" data-kp="' + k + '"' + (a ? ' aria-label="' + a + '"' : '')
    + ' class="' + (k === 'next' || k === 'ok' ? 'kp-do' : '') + (k === 'ok' ? ' kp-ok' : '') + '"'
    + (k === 'neg' && !spec.neg ? ' disabled aria-disabled="true"' : '') + '>' + (t || k) + '</button>').join('');
}

export function wireKeypad(host, { boxes, spec, onChange, sp: spOut }) {
  const kp = host.querySelector('.kp'), sp = spOut || host.querySelector('.kp-sp');
  if (!kp) return;
  if (spOut) spOut.hidden = true; // 外の空きは描き直しで消えない＝つなぎ直す時に隠す（中の空きが描き直しで隠れるのと同じ）
  let inp = null, fresh = false;
  // 閉じる：✓・最後の ↓ は下の空きも消す。箱から外れて閉じる時（他の釦を押した）は空きを残す
  //   ＝押した瞬間に空きが消えると頁がずれ、指を離す所が釦から外れて押せない（11-23 Chromium・WebKit で測った）
  const close = (keepSp) => { const x = inp; inp = null; kp.hidden = true; if (sp && !keepSp) sp.hidden = true; if (x) x.blur(); };
  const press = (k) => {
    if (!inp) return;
    if (k === 'ok') return close();
    if (k === 'next') { const bs = boxes(), j = bs.indexOf(inp); if (j >= 0 && j + 1 < bs.length) bs[j + 1].focus(); else close(); return; }
    const sp1 = spec(inp);
    inp.value = kpPress(inp.value, k, sp1, fresh);
    fresh = kpNextFresh(fresh, k, sp1);
    if (onChange) onChange(inp);
  };
  kp.addEventListener('mousedown', (ev) => ev.preventDefault()); // 鍵を押しても箱から focus を外さない
  // 鍵の click は外へ出さない（↓ で次の箱の鍵に作り直すと押した鍵が頁から外れ、外の click の受け手が「鍵盤の外」と見て描き直すため）
  kp.addEventListener('click', (ev) => { ev.stopPropagation(); const b = ev.target.closest('[data-kp]'); if (b && !b.disabled) press(b.dataset.kp); });
  for (const x of boxes()) {
    x.setAttribute('readonly', '');
    x.setAttribute('inputmode', 'none');
    x.addEventListener('focus', () => {
      inp = x; fresh = true;
      const h = keysHtml(spec(x)); if (kp.dataset.h !== h) { kp.innerHTML = h; kp.dataset.h = h; } // 並びが同じなら作り直さない
      kp.hidden = false; if (sp) sp.hidden = false;
      x.scrollIntoView({ block: 'nearest' });
    });
    x.addEventListener('blur', (ev) => { if (inp === x && !boxes().includes(ev.relatedTarget)) close(true); });
    // 机の鍵盤（パソコン）も同じ動き
    x.addEventListener('keydown', (ev) => {
      const k = /^[0-9]$/.test(ev.key) ? ev.key : { '-': 'neg', '.': 'dot', Backspace: 'bs', Enter: 'next', Escape: 'ok' }[ev.key];
      if (!k || ev.isComposing) return;
      ev.preventDefault(); press(k);
    });
  }
}
