/* gamen-taikyoku.mjs — 対局：ログイン→部屋を作る／入る→部屋の中（設計図 §2・§6・§3.0 G）
 * =============================================================================
 * 画面は section を出し入れするだけ（札ごと差し替えない＝今出ていない箱を触って止まる形を作らない）。
 * 入口：mj_room_create(p_op_id, p_name, p_pass, p_rules, p_secrets{url_token_hash})
 *       ＝名前もパスも null で部屋なし（kind solo・作った画面を出さずにそのまま対局）
 *       mj_room_join(p_way 'name'|'url', p_room_no null, p_key, p_pass, p_name)（番号の道 'pass' は画面から呼ばない）
 * ★送り直しは同じ op_id と同じ token で★（返事が切れても部屋を2つ作らない・token が変わると mismatch）。
 */
import { needLogin, showLogin, rpc, errText, rememberRoom, patchRoom, myRooms, roomUrl, tokenFromPath, $, esc, uuid } from './gamen-core.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { mountRules, RULE_ERR } from './gamen-rules.mjs';
import { newToken, tokenHash } from '../lib/url-token.mjs';
import { mountRoom, readRoom, readLeague, saveLeagueInfo, hasLeagueInfo, markSynced, leaveRoom } from './gamen-room.mjs'; // 静的 import（sw が先に持てる形・麻雀-計算 の相談 11-20）

const VIEWS = ['vLogin', 'vChoose', 'vRules', 'vMade', 'vUrlJoin', 'vRoom'];
let me = null;
let rulesCtl = null; // ⑨ のルール設定（作るたびに同じ物を使う）
let lastMade = null; // 作った直後に ‹ ルール設定 で戻っても、同じ中身なら2つ目を作らない
let makeKind = 'shared'; // 'solo'＝［対局を始める］（部屋なし）／'shared'＝［みんなで見る部屋を作る］

const BAR = {
  vLogin: { back: 'ホーム', title: '対局' },
  vChoose: { back: 'ホーム', title: '対局' },
  vUrlJoin: { back: 'ホーム', title: '対局' },
  vRules: { back: '対局', onBack: () => show('vChoose'), title: 'ルール設定' },
};
export function show(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
  if (BAR[id]) bar(BAR[id]);
  window.scrollTo(0, 0);
}
function obi(msg, kind) {
  const o = $('obi');
  o.hidden = !msg;
  o.className = 'obi' + (kind ? ' obi-' + kind : '');
  o.innerHTML = msg || '';
}
function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }

/* ── 作る ── */
const PENDING = () => 'mj-pending-create:' + me.id;
function nameAndPass() {
  if (makeKind === 'solo') return { name: null, pass: null };
  const name = $('cName').value.trim();
  const pass = $('cPass').value.normalize('NFKC').trim(); // 全角の数字も通す（倉庫の mj_pass_key も NFKC）
  if (!name) return { err: '部屋名を入れてください。' };
  if (!/^\d{4}$/.test(pass)) return { err: 'パスは数字4つで入れてください。' };
  return { name, pass };
}
async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function goRules(kind) {
  makeKind = kind;
  $('cErr0').textContent = '';
  const np = nameAndPass();
  if (np.err) { $('cErr0').textContent = np.err; return; }
  if (!rulesCtl) rulesCtl = mountRules($('cRules'), { rules: { ...defaultRules(4), rate: 100 }, readOnly: false });
  $('cErr').textContent = '';
  $('btnCreate').textContent = kind === 'solo' ? 'この設定で対局を始める' : 'この設定で部屋を作る';
  show('vRules');
}
async function doCreate() {
  const btn = $('btnCreate');
  $('cErr').textContent = '';
  const np = nameAndPass();
  if (np.err) { show('vChoose'); $('cErr0').textContent = np.err; return; }
  const { name, pass } = np;
  const rules = rulesCtl.read(); // 倉庫に送るのはルール設定の画面に出ている鍵だけ（残りは倉庫が既定で埋める）
  // やきとりの門（gamen_32b_sadame.md v1.1 止め1）＝rulesOk は pt 0 を通す（古い部屋のため）＝画面からは on で 1〜999 の整数でない部屋を作らせない（黙って0円の種にしない）
  if (rules.yakitori === true && !(Number.isInteger(rules.yakitori_pt) && rules.yakitori_pt >= 1 && rules.yakitori_pt <= 999)) { $('cErr').textContent = 'やきとり1枚の pt は 1〜999 です（整数）。'; return; }
  const chk = rulesOk(rules);
  if (!chk.ok) { $('cErr').textContent = RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。'); return; }
  // 送り直しの印：同じ中身なら同じ op_id と token（返事が切れた時に部屋を2つ作らない）
  const body = JSON.stringify({ name, pass, rules });
  if (lastMade && lastMade.body === body) { made(lastMade.room, pass); return; }
  // 端末に残すのは中身の sha256 だけ（パスの平文を localStorage に置かない）
  const bodyH = await sha256Hex(body);
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING()) || 'null'); } catch { p = null; }
  if (!p || p.bodyH !== bodyH) { p = { op_id: uuid(), token: newToken(), bodyH }; localStorage.setItem(PENDING(), JSON.stringify(p)); }
  busy(btn, true);
  const res = await rpc('mj_room_create', { p_op_id: p.op_id, p_name: name, p_pass: pass, p_rules: rules, p_secrets: { url_token_hash: await tokenHash(p.token) } });
  busy(btn, false);
  if (!res.ok) {
    if (res.err === 'mj_session') { relogin(doCreate); return; }
    // 同じ op と token で送り直しても同じ返しになる物は印を消す（消さないと詰まる・dup／gone＝gamen_b3a_sadame v1.1）
    if (['bad', 'common', 'range', 'mismatch', 'mj_op_other_user', 'dup', 'gone'].includes(res.err)) localStorage.removeItem(PENDING());
    $('cErr').textContent = res.err === 'range' && RULE_ERR[res.key] ? RULE_ERR[res.key] : errText(res, 'create');
    return;
  }
  localStorage.removeItem(PENDING());
  // rules＝倉庫の既定で埋めた形（倉庫の mj_read が来るまで、作った端末だけが部屋のルールを持つ）
  const solo = res.kind === 'solo';
  const room = { room_id: res.room_id, kind: solo ? 'solo' : 'shared', name: solo ? '対局' : name, role: 'kan', owner: true, token: solo ? undefined : p.token, channel_key: res.channel_key, rules: rulesOk(rules).rules };
  rememberRoom(me.id, room);
  markSynced(me.id, room.room_id); // 作った時の写しは空＝倉庫と同じ（2d の印・2d より前の写しと分ける）・他の端末の rules は openRoom の mj_read で控えに入る
  lastMade = { body, room };
  made(room, pass);
}
/* 部屋なし＝作った画面を出さずにそのまま対局へ／部屋＝部屋ができた画面 */
function made(room, pass) { if (room.kind === 'solo') openRoom(room.room_id); else showMade(room, pass); }
/* pass あり＝作った直後（‹ ルール設定・［この設定で対局を始める］）／pass なし＝対局の［ルール］の下から（‹ 対局・［対局に戻る］） */
function showMade(room, pass) {
  $('mName').textContent = room.name || '';
  $('mPass').textContent = pass ? 'パス ' + '●'.repeat(Math.min(pass.length, 12)) + '（作った時に打った物）' : 'パスは作った時に打った物';
  const url = room.token ? roomUrl(room.token) : '';
  $('mUrl').textContent = url;
  $('mQr').innerHTML = url ? qrSvg(url) : '';
  $('mQr').hidden = !url;
  $('mQr').classList.remove('qr-big');
  for (const id of ['btnCopy', 'btnQr']) $(id).hidden = !url;
  $('btnCopy').textContent = 'URL を写す';
  $('btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = '写しました'; }
    catch { $('btnCopy').textContent = '写せませんでした（URL を長押し）'; }
  };
  $('btnQr').textContent = 'QR を見せる';
  $('btnQr').onclick = () => { const big = $('mQr').classList.toggle('qr-big'); $('btnQr').textContent = big ? 'QR を小さく' : 'QR を見せる'; };
  $('btnToRoom').textContent = pass ? 'この設定で対局を始める' : '対局に戻る';
  $('btnToRoom').onclick = () => openRoom(room.room_id);
  show('vMade');
  bar(pass ? { back: 'ルール設定', onBack: () => show('vRules'), title: '部屋ができた' } : { back: '対局', onBack: () => openRoom(room.room_id), title: '部屋ができた' });
}
export function qrSvg(text) {
  if (!globalThis.qrcode) return '';
  const q = globalThis.qrcode(0, 'M');
  q.addData(text); q.make();
  const n = q.getModuleCount(); const m = 4; const s = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
  return '<svg viewBox="0 0 ' + s + ' ' + s + '" role="img" aria-label="部屋の URL の QR" shape-rendering="crispEdges"><rect width="100%" height="100%" class="qr-bg"/><path d="' + d + '" class="qr-fg"/></svg>';
}

/* ── 入る（部屋名＋パス）＝パスは空かだけ見る（古い部屋の英字・4字以上も倉庫が受ける・鍵盤は数字に絞らない） ── */
async function doJoin() {
  const btn = $('btnJoin');
  $('jErr').textContent = '';
  const name = $('jName').value.trim();
  const pass = $('jPass').value;
  if (!name) { $('jErr').textContent = '部屋名を入れてください。'; return; }
  if (!pass) { $('jErr').textContent = 'パスを入れてください。'; return; }
  busy(btn, true);
  const res = await rpc('mj_room_join', { p_way: 'name', p_room_no: null, p_key: null, p_pass: pass, p_name: name });
  busy(btn, false);
  if (!res.ok) {
    if (res.err === 'mj_session') { relogin(doJoin); return; }
    $('jErr').textContent = errText(res, 'name');
    return;
  }
  joined(res, null);
}
function joined(res, token) {
  const old = myRooms(me.id).find((x) => x.room_id === res.room_id);
  // 入れるのは shared だけ（部屋なしは倉庫が潰す）＝kind 'shared'。番号は控えに持たない
  // 終えた部屋に入っていた人＝{ok:true, again:true, closed:true}＝控えに closed を足して読み専で開く（B3b-1 §3）
  const closed = res.again === true && res.closed === true ? { closed: true } : {};
  rememberRoom(me.id, { room_id: res.room_id, kind: 'shared', name: res.name, role: res.role, channel_key: res.channel_key, token: token || (old && old.token) || undefined, ...closed });
  openRoom(res.room_id);
}

/* ── URL で入る（/r/<token>） ── */
async function urlJoin(token) {
  show('vUrlJoin');
  $('uErr').textContent = '';
  $('btnUrlRetry').hidden = true;
  const res = await rpc('mj_room_join', { p_way: 'url', p_room_no: null, p_key: token, p_pass: null, p_name: null });
  if (!res.ok) {
    if (res.err === 'mj_session') { relogin(() => urlJoin(token)); return; }
    $('uMsg').textContent = '入れませんでした。';
    $('uErr').textContent = errText(res, 'url');
    $('btnUrlRetry').hidden = !['net', 'offline', 'busy', 'server'].includes(res.err);
    $('btnUrlRetry').onclick = () => urlJoin(token);
    return;
  }
  joined(res, token);
}

/* ── 部屋の中 ── */
let openSeq = 0; // 開き直したら前の「ルールを読む」の続きを捨てる
const CLOSED_OBI = 'この部屋は終わりました。見ることはできます。';
/* note＝［部屋を終える］の返しの字（もう終わっていた時など・開き直した部屋の中に出す）
 * lid＝D2 リーグの対局（league.html の［このリーグで対局を始める］＝?room=<id>&league=<league_id>）。
 *   リーグの一覧は倉庫の mj_my_rooms から＝この端末の控えに部屋が無くても開く（控えには足さない・最初の mj_read 'league' で rules を知る） */
async function openRoom(roomId, note, lid) {
  leaveRoom(); // 前の部屋の読み・送り・時計・合図を止める（ルールを読む道でも・2c-2f）
  let room = myRooms(me.id).find((x) => x.room_id === roomId);
  if (!room && lid) room = { room_id: roomId, kind: 'shared', name: '', role: null };
  // A15g §3.1：控えに無い部屋（ホームの倉庫の行・別の端末で入った）も断らない＝入っているかは mj_read が決める（ok なら控えに足す・gone なら足さない）
  if (!room) room = { room_id: roomId, kind: 'shared', name: '', role: null, fromDb: true };
  history.replaceState(null, '', '/taikyoku.html?room=' + encodeURIComponent(roomId) + (lid ? '&league=' + encodeURIComponent(lid) : ''));
  obi('');
  // 終えた部屋の帯は mountRoom の前（ルールが届いていない端末・gateOnly の道でも出る・B3b-1 §3 止め2）。足し①の帯が出る時は mountRoom が外す（帯は1枚）
  if (room.closed === true) obi(CLOSED_OBI, 'warn');
  show('vRoom');
  // 部屋なしは URL で入れない（倉庫が潰す）＝［部屋名と URL］を出さない（B3b で［みんなで見る部屋にする］に替わる）
  const share = room.kind !== 'solo' && !room.fromDb ? () => showMade(room, null) : null; // 倉庫から開く部屋は kind が分かってから（§3.2）
  const seq = ++openSeq;
  if (!room.rules || (lid && !hasLeagueInfo(me.id, lid))) { readRules(roomId, share, seq, lid, room); return; }
  mountRoom($('vRoom'), roomOpts(room, share, note, lid));
}
/* 部屋の中へ渡す物。closedObi(on)＝終えた部屋の帯（on＝出す・false＝外す）・reopen(note)＝終えた後に読み専で開き直す */
function roomOpts(room, share, note, lid) {
  const rid = room.room_id;
  return { me, room, showShare: share, bar, relogin, note, ...(lid ? { league: { league_id: lid } } : {}),
    closedObi: (on) => { if (on) obi(CLOSED_OBI, 'warn'); else if ($('obi').textContent === CLOSED_OBI) obi(''); },
    reopen: (n) => openRoom(rid, n, lid) };
}
/* rules の無い端末（join・一覧から入った）＝mountRoom の前に mj_read（2d §3・B3b-1 約束④）。
 * 読めるまで「部屋のルールを読んでいます」＋［もう一度］・10秒ごと（頁が見えている間・mountRoom の外で回す）。
 * rules と closed は控えの行だけを書き換える（ホームの並びと at を変えない＝rememberRoom を通さない・約束⑦） */
function readRules(roomId, share0, seq, lid, room0) {
  let share = share0;
  bar({ back: 'ホーム', title: '対局' });
  $('vRoom').innerHTML = '<p class="setsumei" id="rReading">部屋のルールを読んでいます</p><p class="err" id="rReadErr"></p><button class="btn btn-line" id="rReadAgain">もう一度</button>' +
    (share ? '<button class="btn" id="rShare">部屋名と URL</button>' : '');
  if (share) $('rShare').onclick = share;
  let timer = null, busyRead = false;
  const alive = () => seq === openSeq && !!$('rReading') && !$('vRoom').hidden;
  const once = async () => {
    if (!alive() || busyRead) return;
    if (navigator.onLine === false) { $('rReadErr').textContent = errText({ err: 'offline' }); return; }
    busyRead = true;
    const res = lid ? await readLeague(roomId, lid, null) : await readRoom(roomId, null); // D2：リーグの対局は 'league'（room・league・days が来る）
    busyRead = false;
    if (!alive()) { clearInterval(timer); return; }
    const d = res && res.data;
    if (d && d.ok === true && d.room && d.room.rules && (!lid || d.league)) {
      clearInterval(timer);
      const patch = { rules: d.room.rules };
      if (d.room.closed === true) patch.closed = true;
      let room = patchRoom(me.id, roomId, patch);
      if (!room && lid && room0) { // 控えに無い部屋（リーグの一覧から）＝控えに足さずに今だけの形
        room = Object.assign(room0, patch, { name: d.room.name || '', role: d.room.role ?? null, owner: d.room.owner === true, ...(typeof d.room.channel_key === 'string' ? { channel_key: d.room.channel_key } : {}) });
      }
      if (!room && room0 && room0.fromDb) { // A15g §3.2：倉庫から開いた部屋＝読めたので控えに足す（token は無い）
        rememberRoom(me.id, { room_id: roomId, kind: d.room.kind === 'solo' ? 'solo' : 'shared', name: d.room.name || '', role: d.room.role ?? null, owner: d.room.owner === true,
          ...(typeof d.room.channel_key === 'string' ? { channel_key: d.room.channel_key } : {}), ...patch });
        room = myRooms(me.id).find((x) => x.room_id === roomId) || null;
        if (room) share = room.kind !== 'solo' ? () => showMade(room, null) : null;
      }
      if (!room) { openRoom(roomId); return; }
      if (lid) saveLeagueInfo(me.id, lid, d);
      mountRoom($('vRoom'), roomOpts(room, share, undefined, lid));
      return;
    }
    if (lid && d && d.ok === false && d.err === 'bad') { clearInterval(timer); $('rReadErr').textContent = errText(d, 'league'); $('rReadAgain').hidden = true; return; } // bad league_id＝このリーグは見つかりません
    const e = res && res.error;
    const err = d && d.ok === false ? d.err : e && (e.status === 401 || res.status === 401 || /jwt/i.test(e.message || '')) ? 'mj_session' : 'net';
    if (err === 'mj_session') { clearInterval(timer); relogin(() => openRoom(roomId)); return; }
    if (err === 'gone') { clearInterval(timer); $('rReadErr').textContent = 'この部屋は消されているか、入れなくなりました。'; $('rReadAgain').hidden = true; return; }
    $('rReadErr').textContent = errText({ err });
  };
  $('rReadAgain').onclick = once;
  timer = setInterval(() => { if (!alive()) { clearInterval(timer); return; } if (document.visibilityState === 'visible') once(); }, 10000);
  once();
}

/* 上の帯（‹ 戻る・題・右の字）。onBack が無ければホームへの道のまま。ten＝［点数］の行き先（対局のページだけ・設計図§2「右上の［ルール］の隣に［点数］」） */
function bar({ back = 'ホーム', onBack, title = '', right, onRight, ten } = {}) {
  const t = $('barTen');
  t.hidden = !ten;
  if (ten) t.href = ten; else t.removeAttribute('href');
  const b = $('barBack');
  b.textContent = '‹ ' + back;
  b.onclick = onBack ? (ev) => { ev.preventDefault(); onBack(); } : null;
  if ($('title').textContent !== title) window.scrollTo(0, 0); // 画面が替わったら上から（同じ画面の描き直しでは動かさない）
  $('title').textContent = title;
  const r = $('barR');
  r.hidden = !right;
  r.textContent = right || '';
  r.onclick = right && onRight ? onRight : null;
}

/* ── 始め ── */
/* ログインが切れた時：入り直した人で me を替える。別の人が入ったら、前の人の続き（作る・入る）はせず始めからにする
 * （前の人の mj-rooms:<id>・mj-pending-create:<id> に別の人の部屋を混ぜない） */
function relogin(next) {
  showLogin((u) => {
    const same = me && u && u.id === me.id;
    me = u;
    if (same) next(); else start(u);
  });
}
function start(user) {
  me = user;
  obi('');
  const token = tokenFromPath(location.pathname);
  if (token) { urlJoin(token); return; }
  const q = new URLSearchParams(location.search);
  if (q.get('room')) { openRoom(q.get('room'), undefined, q.get('league') || undefined); return; }
  show('vChoose');
}

$('chSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('chSeg').querySelectorAll('button')) { x.setAttribute('aria-pressed', String(x === b)); $(x.dataset.p).hidden = x !== b; }
});
$('goRules').onclick = () => goRules('shared');
$('btnStart').onclick = () => goRules('solo');
$('btnCreate').onclick = doCreate;
$('btnJoin').onclick = doJoin;
$('btnLoginOpen').onclick = () => showLogin(start);

show('vLogin');
needLogin(start).catch((e) => { obi('止まりました：' + esc(e.message), 'err'); });
