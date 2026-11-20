/* gamen-taikyoku.mjs — 対局：ログイン→部屋を作る／入る→部屋の中（設計図 §2・§6・§3.0 G）
 * =============================================================================
 * 画面は section を出し入れするだけ（札ごと差し替えない＝今出ていない箱を触って止まる形を作らない）。
 * 入口：mj_room_create(p_op_id, p_name, p_pass, p_rules, p_secrets{url_token_hash})
 *       mj_room_join(p_way 'pass'|'url', p_room_no, p_key, p_pass)
 * ★送り直しは同じ op_id と同じ token で★（返事が切れても部屋を2つ作らない・token が変わると mismatch）。
 */
import { needLogin, showLogin, rpc, errText, rememberRoom, myRooms, roomUrl, tokenFromPath, $, esc, uuid } from './gamen-core.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { mountRules } from './gamen-rules.mjs';
import { newToken, tokenHash } from '../lib/url-token.mjs';
import { mountRoom } from './gamen-room.mjs'; // 静的 import（sw が先に持てる形・麻雀-計算 の相談 11-20）

const VIEWS = ['vLogin', 'vChoose', 'vRules', 'vMade', 'vUrlJoin', 'vRoom'];
let me = null;
let rulesCtl = null; // ⑨ のルール設定（作るたびに同じ物を使う）
let lastMade = null; // 作った直後に ‹ ルール設定 で戻っても、同じ中身なら2つ目を作らない

const BAR = {
  vLogin: { back: 'ホーム', title: '対局' },
  vChoose: { back: 'ホーム', title: '対局' },
  vUrlJoin: { back: 'ホーム', title: '対局' },
  vRules: { back: '部屋を作る', onBack: () => show('vChoose'), title: 'ルール設定' },
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

const RULE_ERR = {
  rate: 'レートは10の倍数で 10〜100,000 か「なし」です。',
  start_pts: '持ち点は 1,000〜200,000 の100の倍数です。',
  return_pts: '返しは持ち点以上・100の倍数です。',
  uma: 'ウマは人数分の整数で、上から大きい順・合計0にしてください。',
  tobi_pt: '飛び賞は 0〜999 の整数です。',
  chip_pt10: 'チップ1枚の pt は 0.1〜999.9 です（0.1 単位）。',
  shugi_pt10: '祝儀1枚の pt は 0.1〜999.9 です（0.1 単位）。',
};

/* ── 作る ── */
const PENDING = () => 'mj-pending-create:' + me.id;
function nameAndPass() {
  const name = $('cName').value.trim();
  const pass = $('cPass').value;
  if (!name) return { err: '部屋の名前を入れてください。' };
  if (pass.trim().length < 4) return { err: 'パスは4字以上で入れてください。' };
  return { name, pass };
}
async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function goRules() {
  $('cErr0').textContent = '';
  const np = nameAndPass();
  if (np.err) { $('cErr0').textContent = np.err; return; }
  if (!rulesCtl) rulesCtl = mountRules($('cRules'), { rules: { ...defaultRules(4), rate: 100 }, readOnly: false });
  $('cErr').textContent = '';
  show('vRules');
}
async function doCreate() {
  const btn = $('btnCreate');
  $('cErr').textContent = '';
  const np = nameAndPass();
  if (np.err) { show('vChoose'); $('cErr0').textContent = np.err; return; }
  const { name, pass } = np;
  const rules = rulesCtl.read(); // 倉庫に送るのはルール設定の画面に出ている鍵だけ（残りは倉庫が既定で埋める）
  const chk = rulesOk(rules);
  if (!chk.ok) { $('cErr').textContent = RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。'); return; }
  // 送り直しの印：同じ中身なら同じ op_id と token（返事が切れた時に部屋を2つ作らない）
  const body = JSON.stringify({ name, pass, rules });
  if (lastMade && lastMade.body === body) { showMade(lastMade.room, pass); return; }
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
    if (['bad', 'common', 'range', 'mismatch', 'mj_op_other_user'].includes(res.err)) localStorage.removeItem(PENDING());
    $('cErr').textContent = res.err === 'range' && RULE_ERR[res.key] ? RULE_ERR[res.key] : errText(res);
    return;
  }
  localStorage.removeItem(PENDING());
  // rules＝倉庫の既定で埋めた形（倉庫の mj_read が来るまで、作った端末だけが部屋のルールを持つ）
  const room = { room_id: res.room_id, room_no: res.room_no, name, role: 'kan', owner: true, token: p.token, channel_key: res.channel_key, rules: rulesOk(rules).rules };
  rememberRoom(me.id, room);
  lastMade = { body, room };
  showMade(room, pass);
}
function fmtNo(no) { return String(no).replace(/^(\d{4})(\d{4})$/, '$1 $2'); }
/* pass あり＝作った直後（‹ ルール設定・［この設定で対局を始める］）／pass なし＝対局の［ルール］の下から（‹ 対局・［対局に戻る］） */
function showMade(room, pass) {
  $('mNo').textContent = fmtNo(room.room_no);
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

/* ── 入る（番号＋パス） ── */
async function doJoin() {
  const btn = $('btnJoin');
  $('jErr').textContent = '';
  const no = $('jNo').value.replace(/[\s-]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const pass = $('jPass').value;
  if (!/^\d{8}$/.test(no)) { $('jErr').textContent = '部屋番号は8桁の数字です。'; return; }
  if (!pass) { $('jErr').textContent = 'パスを入れてください。'; return; }
  busy(btn, true);
  const res = await rpc('mj_room_join', { p_way: 'pass', p_room_no: no, p_key: null, p_pass: pass });
  busy(btn, false);
  if (!res.ok) {
    if (res.err === 'mj_session') { relogin(doJoin); return; }
    $('jErr').textContent = errText(res);
    return;
  }
  joined(res, null);
}
function joined(res, token) {
  const old = myRooms(me.id).find((x) => x.room_id === res.room_id);
  rememberRoom(me.id, { room_id: res.room_id, room_no: res.room_no, name: res.name, role: res.role, channel_key: res.channel_key, token: token || (old && old.token) || undefined });
  openRoom(res.room_id);
}

/* ── URL で入る（/r/<token>） ── */
async function urlJoin(token) {
  show('vUrlJoin');
  $('uErr').textContent = '';
  $('btnUrlRetry').hidden = true;
  const res = await rpc('mj_room_join', { p_way: 'url', p_room_no: null, p_key: token, p_pass: null });
  if (!res.ok) {
    if (res.err === 'mj_session') { relogin(() => urlJoin(token)); return; }
    $('uMsg').textContent = '入れませんでした。';
    $('uErr').textContent = errText(res);
    $('btnUrlRetry').hidden = !['net', 'offline', 'busy', 'server'].includes(res.err);
    $('btnUrlRetry').onclick = () => urlJoin(token);
    return;
  }
  joined(res, token);
}

/* ── 部屋の中 ── */
async function openRoom(roomId) {
  const room = myRooms(me.id).find((x) => x.room_id === roomId);
  if (!room) { show('vChoose'); obi('この端末ではまだその部屋に入っていません。部屋番号とパスか URL で入ってください。', 'warn'); return; }
  history.replaceState(null, '', '/taikyoku.html?room=' + encodeURIComponent(roomId));
  obi('');
  show('vRoom');
  mountRoom($('vRoom'), { me, room, showShare: () => showMade(room, null), bar });
}

/* 上の帯（‹ 戻る・題・右の字）。onBack が無ければホームへの道のまま */
function bar({ back = 'ホーム', onBack, title = '', right, onRight } = {}) {
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
  if (q.get('room')) { openRoom(q.get('room')); return; }
  show('vChoose');
}

$('chSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('chSeg').querySelectorAll('button')) { x.setAttribute('aria-pressed', String(x === b)); $(x.dataset.p).hidden = x !== b; }
});
$('goRules').onclick = goRules;
$('btnCreate').onclick = doCreate;
$('btnJoin').onclick = doJoin;
$('btnLoginOpen').onclick = () => showLogin(start);

show('vLogin');
needLogin(start).catch((e) => { obi('止まりました：' + esc(e.message), 'err'); });
