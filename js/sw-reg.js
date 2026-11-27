/* sw-reg.js — 件3 PWA の登録と「新しい版」の帯（設計 tataki/sw_sekkei_v1.md v3.3・v2 §4・v2.1 S4）
 * 各画面の head に <script src="/js/sw-reg.js" defer></script>（★必ず / 始まり＝/r/<token> でも同じ道★）。
 * ・登録は /sw.js（scope /）。立ち上げと「見えた時」に reg.update()（iOS のホーム画面でも更新を見に行く）。
 * ・waiting が在れば帯「新しい版があります［入れ替える］」。押した時だけ SKIP_WAITING（mj:before-swap を止められたら送らない）。
 * ・controllerchange：押した画面だけ1回読み直す。初めての登録の claim（立ち上げ時に controller 無し・押していない・1回目）は何もしない。
 *   それ以外は帯「別の画面で新しい版に入れ替えました［読み直す］」（入力の途中で勝手に読み直さない）。
 * ・版の知らせ：控えから開いた画面（meta mj-ver が在る）だけ、見えた時に /version.json を no-store で取り、違えば update→waiting で帯。
 * ・update は1本ずつ（upd）＝見えた時と版の知らせが2本並べると install が2本走る（swupd v1.3.1 §3・11-27 測った）。時間の区切りは付けない（止まった update の後ろには次の update も並ぶ＝画面からは解けない・F10）。
 * ・固まった installing（swupd_sadame v1.4.1）：WebKit は install が済んだ直後に開いた画面に installing のまま動かない登録を渡す（statechange も来ない・11-27 CI 測った）。
 *   installing を見たら SW 本人に MJ_STATE で訊き、済んでいれば待っている版として帯を出す（frozen）。答えが2回返らなければ update を打つ。
 * ・続きの置き場 mj-part を画面が作る（作るだけ・消さない）＝install の外で作った控えは落ちた install の書き込みを残す（v1.3.1 §1 F4・F9）。
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var sw = navigator.serviceWorker;
  var hadCtl = !!sw.controller;
  var changes = 0, swapping = false, regRef = null;
  try { sessionStorage.removeItem('mj.swap'); } catch (_) {}
  // 続きの置き場（install は作らない）。試験の knob MJ_NO_PART で外す（u6・u8b・u12）
  if (!window.MJ_NO_PART && window.caches) { try { caches.open('mj-part').catch(function () {}); } catch (_) {} }
  var inflight = null, tracked = null;
  var frozen = null, probeTimer = null, nullRun = 0, latestVer = null;
  // update は1本ずつ（走っている間はその約束を返す）。もう取り込み中（installing）なら update を打たずそれを追う（札を出す＝開いた時にもう走っていた取り込みも・e2e u5）
  function upd(reg) {
    if (inflight) return inflight;
    if (reg.installing) {
      var w = reg.installing;
      track(reg, w);
      return probe(w).then(function (r) {
        if (r === true) { nullRun = 0; markFrozen(reg, w); return; }
        if (r === false) { nullRun = 0; return; }
        if (++nullRun < 2) return;
        nullRun = 0;
        return doUpdate(reg);   // 答えない installing が2回続いた＝止まった job かもしれない＝それでも update を打つ（他に解ける道が無い）
      });
    }
    return doUpdate(reg);
  }
  function doUpdate(reg) {
    if (inflight) return inflight;
    var p = reg.update().catch(function () {}).then(function () { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }
  var meta = document.querySelector('meta[name="mj-ver"]');
  var PAGE_VER = meta ? meta.getAttribute('content') : null;

  var band = null, msg = null, btn = null, busyTimer = null, failShown = false;
  // busy＝「新しい版を取り込み中」の小さな札（右上・押せない）。busy で無い show は毎回 is-busy を外す＝［入れ替える］が押せないまま残らない（swupd v1.1 §3）
  function show(text, label, onTap, busy) {
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
    band.classList.toggle('is-busy', !!busy);
    if (!busy && busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    band.hidden = false;
  }
  function hide() {
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    if (band) band.hidden = true;
  }
  var isBusy = function () { return !!band && !band.hidden && band.classList.contains('is-busy'); };
  // 取り込めなかった＝1つの画面で1回だけ言う。次に見えた時の reg.update() で取り込み直す（仮の控えの続きから）。2回目からは取り込み中の札を消すだけ（黙って残さない）
  function failBand() {
    if (failShown) { if (isBusy()) hide(); return; }
    failShown = true;
    show('新しい版を取り込めませんでした（次に開いた時にもう一度）', '閉じる', hide);
  }
  // 前の版が動いていて、新しい版を取り込み中（まだ待っている版が無い）時だけ。他の帯が出ている時は出さない（「別の画面で入れ替えました」・待っている版の帯を消さない）
  function maybeBusy(reg, w) {
    if (w.state !== 'installing' || !reg.active || reg.active === w || !sw.controller || swapping || reg.waiting) return;
    if (band && !band.hidden && !isBusy()) return;
    show('新しい版を取り込み中', null, null, true);
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = setTimeout(function () { busyTimer = null; if (isBusy()) failBand(); }, window.MJ_BUSY_MS || 60000);
  }

  function waitInstalled(reg, ms) {
    return new Promise(function (res) {
      var t = setTimeout(function () { res(null); }, ms);
      function check() { if (reg.waiting) { clearTimeout(t); res(reg.waiting); } }
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (w) w.addEventListener('statechange', check);
        check(); // 知らせが遅れて届くと installing はもう null・waiting に移っている（11-26 3本並べ 600回で 31回）
      });
      upd(reg).then(check, function () {});
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
      // 固まった画面は controllerchange も届かない事がある＝5秒で読み直す（読み直すと新しい見え方になる・押した時だけ）
      setTimeout(function () { if (swapping) location.reload(); }, window.MJ_SWAP_RELOAD_MS || 5000);
    };
    if (reg.waiting || frozen) { go(reg.waiting || frozen); return; }
    show('取り込み中', null);
    waitInstalled(reg, 30000).then(go); // update は waitInstalled の中（返った後に waiting を見る）
  }

  function offerSwap() { show('新しい版があります', '入れ替える', swap); }
  // 本当に待っている版の時だけ（前の版が動いていて、これがそれと別）。初めての取り込みは installed の知らせが claim の後に届く事がある（webkit）＝controller だけ見ると偽の帯
  function maybeOffer(reg) {
    var wt = reg.waiting || frozen;
    if (wt && reg.active && wt !== reg.active && sw.controller && !swapping) offerSwap();
  }

  // SW 本人に「install は済んだか」を訊く：true＝済んだ・false＝まだ／落ちた・null＝答え無し（ms）か版が違う（新しい版の名を知っている時だけ照らす）
  function probe(w, ms) {
    return new Promise(function (res) {
      var t = setTimeout(function () { res(null); }, ms || 2000);
      try {
        var ch = new MessageChannel();
        ch.port1.onmessage = function (ev) {
          clearTimeout(t);
          var d = ev.data || {};
          if (latestVer && d.ver && d.ver !== latestVer) { res(null); return; }
          res(d.done === true);
        };
        w.postMessage({ type: 'MJ_STATE' }, [ch.port2]);
      } catch (_) { clearTimeout(t); res(null); }
    });
  }
  function stopProbe() { if (probeTimer) { clearInterval(probeTimer); probeTimer = null; } }
  // 画面には installing と見えるが本人は済んでいる＝待っている版として扱う（取り込み中の札を消して帯）
  function markFrozen(reg, w) {
    stopProbe();
    if (w.state !== 'installing' || frozen === w) return;
    frozen = w;
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    maybeOffer(reg);
  }
  // installing を追っている間、3秒ごとに本人に訊く（最大 40 回＝2分。statechange が来たら・帯を押したら止める）
  function startProbe(reg, w) {
    stopProbe();
    var n = 0;
    var tick = function () {
      if (w.state !== 'installing' || frozen || swapping || ++n > 40) { stopProbe(); return; }
      probe(w).then(function (r) { if (r === true) markFrozen(reg, w); });
    };
    probeTimer = setInterval(tick, 3000);
    tick();
  }

  // 取り込み中の1本を追う（同じ物は1回だけ）
  function track(reg, w) {
    if (!w || w === tracked) return;
    tracked = w;
    maybeBusy(reg, w);
    if (w.state === 'installing') startProbe(reg, w);
    w.addEventListener('statechange', function () {
      stopProbe();
      if (w.state === 'redundant' && !swapping) { if (reg.waiting) maybeOffer(reg); else if (isBusy()) failBand(); return; }
      // w を見る判じは残す（webkit は reg の欄を遅れて写す＝waiting より先に installed が来る事がある）・maybeOffer は足すだけ
      if (w.state === 'installed' && reg.active && reg.active !== w && sw.controller && !swapping) offerSwap(); else maybeOffer(reg);
    });
  }

  function watch(reg) {
    maybeOffer(reg);
    // 画面を開いた時の更新の確かめは register の前に始まる事がある＝もう取り込み中（installing）の物も見る（updatefound を取り逃がさない）
    track(reg, reg.installing);
    // 知らせが遅れて届くと installing はもう null・waiting に移っている＝waiting も見る（11-26 3本並べ 600回で 31回 帯が出なかった）
    reg.addEventListener('updatefound', function () { track(reg, reg.installing); maybeOffer(reg); });
  }

  // p＝見えた時に打った update。違う版でも p の後は帯を見るだけ（もう1本打たない＝2本並べない・v1.3.1 §3。見つからなかった版は次に見えた時）
  function verCheck(reg, p) {
    if (!PAGE_VER) return;
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ver) latestVer = j.ver;
        if (!j || j.ver === PAGE_VER) return;
        if (reg.waiting || frozen) { maybeOffer(reg); return; }
        (p || upd(reg)).then(function () { maybeOffer(reg); }, function () {});
      })
      .catch(function () {});
  }

  sw.addEventListener('controllerchange', function () {
    changes++;
    if (!hadCtl && changes === 1 && !swapping) return;
    if (swapping) { swapping = false; location.reload(); return; }
    show('別の画面で新しい版に入れ替えました', '読み直す', function () { location.reload(); });
  });

  // 登録が在れば getRegistration（列に並ばない）で先に見張る＝register は走っている install の後ろに並んで返らない（WebKit・開いた時にもう取り込み中なら札が出なかった＝e2e u5 11-27 測った）
  function start(reg) {
    if (!reg || regRef) return;
    regRef = reg;
    watch(reg);
    verCheck(reg);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var p = upd(reg);
      p.then(function () { maybeOffer(reg); }, function () {});
      verCheck(reg, p);
    });
  }
  try { sw.getRegistration('/').then(start, function () {}); } catch (_) {}
  sw.register('/sw.js', { scope: '/' }).then(start).catch(function () {});
})();
