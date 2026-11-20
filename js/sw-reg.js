/* sw-reg.js — 件3 PWA の登録と「新しい版」の帯（設計 tataki/sw_sekkei_v1.md v3.3・v2 §4・v2.1 S4）
 * 各画面の head に <script src="/js/sw-reg.js" defer></script>（★必ず / 始まり＝/r/<token> でも同じ道★）。
 * ・登録は /sw.js（scope /）。立ち上げと「見えた時」に reg.update()（iOS のホーム画面でも更新を見に行く）。
 * ・waiting が在れば帯「新しい版があります［入れ替える］」。押した時だけ SKIP_WAITING（mj:before-swap を止められたら送らない）。
 * ・controllerchange：押した画面だけ1回読み直す。初めての登録の claim（立ち上げ時に controller 無し・押していない・1回目）は何もしない。
 *   それ以外は帯「別の画面で新しい版に入れ替えました［読み直す］」（入力の途中で勝手に読み直さない）。
 * ・版の知らせ：控えから開いた画面（meta mj-ver が在る）だけ、見えた時に /version.json を no-store で取り、違えば update→waiting で帯。
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var sw = navigator.serviceWorker;
  var hadCtl = !!sw.controller;
  var changes = 0, swapping = false, regRef = null;
  try { sessionStorage.removeItem('mj.swap'); } catch (_) {}
  var meta = document.querySelector('meta[name="mj-ver"]');
  var PAGE_VER = meta ? meta.getAttribute('content') : null;

  var band = null, msg = null, btn = null;
  function show(text, label, onTap) {
    if (!band) {
      band = document.createElement('div');
      band.className = 'mj-swband';
      band.setAttribute('role', 'status');
      msg = document.createElement('span');
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mj-swband-btn';
      band.appendChild(msg); band.appendChild(btn);
      document.body.appendChild(band);
    }
    msg.textContent = text;
    btn.hidden = !label;
    btn.textContent = label || '';
    btn.onclick = onTap || null;
    band.hidden = false;
  }

  function waitInstalled(reg, ms) {
    return new Promise(function (res) {
      var t = setTimeout(function () { res(null); }, ms);
      function check() { if (reg.waiting) { clearTimeout(t); res(reg.waiting); } }
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (w) w.addEventListener('statechange', check);
      });
      check();
    });
  }

  function swap() {
    var reg = regRef;
    if (!reg) return;
    var ev = new CustomEvent('mj:before-swap', { cancelable: true });
    if (!window.dispatchEvent(ev)) { show('書き込みが終わってから入れ替えます', '入れ替える', swap); return; }
    var go = function (w) {
      if (!w) { show('取り込めませんでした（電波）', '入れ替える', swap); return; }
      swapping = true;
      try { sessionStorage.setItem('mj.swap', '1'); } catch (_) {}
      w.postMessage({ type: 'SKIP_WAITING' });
    };
    if (reg.waiting) { go(reg.waiting); return; }
    show('取り込み中', null);
    reg.update().catch(function () {});
    waitInstalled(reg, 30000).then(go);
  }

  function offerSwap() { show('新しい版があります', '入れ替える', swap); }

  function watch(reg) {
    if (reg.waiting && sw.controller) offerSwap();
    // 画面を開いた時の更新の確かめは register の前に始まる事がある＝もう取り込み中（installing）の物も見る（updatefound を取り逃がさない）
    function track(w) {
      if (!w) return;
      w.addEventListener('statechange', function () {
        // 本当に待っている版の時だけ（前の版が動いていて、これがそれと別）。初めての取り込みは installed の知らせが claim の後に届く事がある（webkit）＝controller だけ見ると偽の帯
        if (w.state === 'installed' && reg.active && reg.active !== w && sw.controller && !swapping) offerSwap();
      });
    }
    track(reg.installing);
    reg.addEventListener('updatefound', function () { track(reg.installing); });
  }

  function verCheck(reg) {
    if (!PAGE_VER) return;
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.ver === PAGE_VER) return;
        if (reg.waiting) offerSwap(); else reg.update().catch(function () {});
      })
      .catch(function () {});
  }

  sw.addEventListener('controllerchange', function () {
    changes++;
    if (!hadCtl && changes === 1 && !swapping) return;
    if (swapping) { swapping = false; location.reload(); return; }
    show('別の画面で新しい版に入れ替えました', '読み直す', function () { location.reload(); });
  });

  sw.register('/sw.js', { scope: '/' }).then(function (reg) {
    regRef = reg;
    watch(reg);
    verCheck(reg);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      reg.update().catch(function () {});
      verCheck(reg);
    });
  }).catch(function () {});
})();
