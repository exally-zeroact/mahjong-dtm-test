/* gamen-taikyoku.mjs — 対局：ログイン→部屋を作る／入る→部屋の中（設計図 §2・§6・§3.0 G）
 * =============================================================================
 * 画面は section を出し入れするだけ（札ごと差し替えない＝今出ていない箱を触って止まる形を作らない）。
 * 入口：mj_room_create(p_op_id, p_name, p_pass, p_rules, p_secrets{url_token_hash})
 *       mj_room_join(p_way 'pass'|'url', p_room_no, p_key, p_pass)
 * ★送り直しは同じ op_id と同じ token で★（返事が切れても部屋を2つ作らない・token が変わると mismatch）。
 */
import { needLogin, showLogin, rpc, errText, rememberRoom, myRooms, roomUrl, tokenFromPath, $, esc, uuid } from './gamen-core.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { newToken, tokenHash } from '../lib/url-token.mjs';

const VIEWS = ['vLogin', 'vChoose', 'vCreate', 'vMade', 'vJoin', 'vUrlJoin', 'vRoom'];
let me = null;

export function show(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
  window.scrollTo(0, 0);
}
function obi(msg, kind) {
  const o = $('obi');
  o.hidden = !msg;
  o.className = 'obi' + (kind ? ' obi-' + kind : '');
  o.innerHTML = msg || '';
}
function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }

/* ── 切り替え（seg）と短い選び（chips） ── */
function segVal(id) { const b = $(id).querySelector('[aria-checked="true"]'); return b ? b.dataset.v : null; }
function segInit(id, onChange) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $(id).querySelectorAll('button')) x.setAttribute('aria-checked', x === b ? 'true' : 'false');
    if (onChange) onChange(b.dataset.v);
  });
}

/* ── ルールの欄 ── */
function fillRuleDefaults(players) {
  const d = defaultRules(players);
  $('cStart').value = d.start_pts;
  $('cReturn').value = d.return_pts;
  $('cTobiPt').value = d.tobi_pt;
  $('cUma').innerHTML = d.uma.map((u, i) => '<label><span>' + (i + 1) + '位</span><input inputmode="numeric" data-i="' + i + '" value="' + u + '"></label>').join('');
}
const toInt = (s) => { const t = String(s).replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^[−ー－]/, '-'); return /^-?\d+$/.test(t) ? Number(t) : NaN; };
const toPt10 = (s) => { const t = String(s).trim(); if (!/^\d+(\.\d)?$/.test(t)) return NaN; return Math.round(Number(t) * 10); };

export function readRules() {
  const players = Number(segVal('cPlayers'));
  const r = { players };
  const rateS = $('cRate').value.trim();
  r.rate = rateS === '' ? null : toInt(rateS);
  r.start_pts = toInt($('cStart').value);
  r.return_pts = toInt($('cReturn').value);
  r.uma = Array.from($('cUma').querySelectorAll('input')).map((x) => toInt(x.value));
  if (segVal('cTobi') === '1') { r.tobi_pt = toInt($('cTobiPt').value); } else { r.tobi_pt = 0; }
  r.chip_pt10 = segVal('cChip') === '1' ? toPt10($('cChipPt').value) : null;
  r.shugi_pt10 = segVal('cShugi') === '1' ? toPt10($('cShugiPt').value) : null;
  return r;
}
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
async function doCreate() {
  const btn = $('btnCreate');
  $('cErr').textContent = '';
  const name = $('cName').value.trim();
  const pass = $('cPass').value;
  if (!name) { $('cErr').textContent = '部屋の名前を入れてください。'; return; }
  if (pass.trim().length < 4) { $('cErr').textContent = 'パスは4字以上で入れてください。'; return; }
  const chk = rulesOk(readRules());
  if (!chk.ok) { $('cErr').textContent = RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。'); return; }
  const rules = readRules(); // 倉庫に送るのは客が触った鍵だけ（残りは倉庫が既定で埋める）
  // 送り直しの印：同じ中身なら同じ op_id と token（返事が切れた時に部屋を2つ作らない）
  const body = JSON.stringify({ name, pass, rules });
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING()) || 'null'); } catch { p = null; }
  if (!p || p.body !== body) { p = { op_id: uuid(), token: newToken(), body }; localStorage.setItem(PENDING(), JSON.stringify(p)); }
  busy(btn, true);
  const res = await rpc('mj_room_create', { p_op_id: p.op_id, p_name: name, p_pass: pass, p_rules: rules, p_secrets: { url_token_hash: await tokenHash(p.token) } });
  busy(btn, false);
  if (!res.ok) {
    if (res.err === 'mj_session') { showLogin(() => doCreate()); return; }
    if (['bad', 'common', 'range', 'mismatch', 'mj_op_other_user'].includes(res.err)) localStorage.removeItem(PENDING());
    $('cErr').textContent = res.err === 'range' && RULE_ERR[res.key] ? RULE_ERR[res.key] : errText(res);
    return;
  }
  localStorage.removeItem(PENDING());
  // rules＝倉庫の既定で埋めた形（倉庫の mj_read が来るまで、作った端末だけが部屋のルールを持つ）
  const room = { room_id: res.room_id, room_no: res.room_no, name, role: 'kan', owner: true, token: p.token, channel_key: res.channel_key, rules: rulesOk(rules).rules };
  rememberRoom(me.id, room);
  showMade(room, pass);
}
function fmtNo(no) { return String(no).replace(/^(\d{4})(\d{4})$/, '$1 $2'); }
function showMade(room, pass) {
  $('mNo').textContent = fmtNo(room.room_no);
  $('mPass').textContent = pass || '（作った時に決めたパス）';
  const url = room.token ? roomUrl(room.token) : '';
  $('mUrl').textContent = url;
  $('mQr').innerHTML = url ? qrSvg(url) : '';
  $('btnCopy').hidden = !url;
  $('btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = '写しました'; }
    catch { $('btnCopy').textContent = '写せませんでした（URL を長押しで写してください）'; }
  };
  $('btnToRoom').onclick = () => openRoom(room.room_id);
  show('vMade');
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
    if (res.err === 'mj_session') { showLogin(() => doJoin()); return; }
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
    if (res.err === 'mj_session') { showLogin(() => urlJoin(token)); return; }
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
  const m = await import('./gamen-room.mjs');
  m.mountRoom($('vRoom'), { me, room, showShare: () => showMade(room, null), bar });
}

/* 上の帯（‹ 戻る・題・右の字）。onBack が無ければホームへの道のまま */
function bar({ back = 'ホーム', onBack, title = '', right, onRight } = {}) {
  const b = $('barBack');
  b.textContent = '‹ ' + back;
  b.onclick = onBack ? (ev) => { ev.preventDefault(); onBack(); } : null;
  $('title').textContent = title;
  const r = $('barR');
  r.hidden = !right;
  r.textContent = right || '';
  r.onclick = right && onRight ? onRight : null;
}

/* ── 始め ── */
function start(user) {
  me = user;
  obi('');
  const token = tokenFromPath(location.pathname);
  if (token) { urlJoin(token); return; }
  const q = new URLSearchParams(location.search);
  if (q.get('room')) { openRoom(q.get('room')); return; }
  show('vChoose');
}

segInit('cPlayers', (v) => fillRuleDefaults(Number(v)));
segInit('cTobi', (v) => { $('cTobiPtBox').hidden = v !== '1'; });
segInit('cChip', (v) => { $('cChipPtBox').hidden = v !== '1'; });
segInit('cShugi', (v) => { $('cShugiPtBox').hidden = v !== '1'; });
$('cRateChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) $('cRate').value = b.dataset.v; });
fillRuleDefaults(4);
$('cRate').value = '100';
$('goCreate').onclick = () => { $('cErr').textContent = ''; show('vCreate'); };
$('goJoin').onclick = () => { $('jErr').textContent = ''; show('vJoin'); };
for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => show('vChoose');
$('btnCreate').onclick = doCreate;
$('btnJoin').onclick = doJoin;
$('btnLogin').onclick = () => showLogin(start);

show('vLogin');
needLogin(start).catch((e) => { obi('止まりました：' + esc(e.message), 'err'); });
