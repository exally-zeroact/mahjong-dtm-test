/* gamen-home.mjs — ホーム（絵 mahjong_home_v154 ①・設計図 §2 ホーム）
 * 続きの部屋＝この端末でこの人が一番新しく入った部屋を紺のカードで1枚（名前・日・半荘n回目まで・n人・［対局に戻る ›］）。
 * 日・回・人は端末の写し（mj-room:<uid>:<room_id>）の一番新しい卓から出す＝無ければその行は出さない。
 * A11（司さん 11-23「前のが残るのが原因やろ」）：終えた対局は出さない＝控えの並びで終えていない一番新しい部屋を出す（無ければカードを出さない）。
 *   終えた＝部屋を終えた（closed）か、写しの開催が在って pickSession が null（部屋を開いた時に新しい開催を作る判じと同じ）。
 * A15g（a15g_sadame v1.1・司さん 11-23「なんのためのアドレスとパスワードで管理しとんど」）：続きの部屋は倉庫の mj_my_rooms(p_open:true) を全部（上限なし）・新しく動いた順に縦に並べる。
 *   頭にはこの端末で送っていない部屋（倉庫の行に無い物）を足す。読めない・8秒で返らない時だけ端末の控え（A11 の判じ）＋帯。
 *   消した部屋（A6＝控えの行に deleted_at か gone:true）は頭足しと控えでは出さない。倉庫が返した行は出して印を外す（印が古い）。
 * A6（a6_sadame v1.4.3 §2）：［元に戻す］の帯は倉庫の mj_my_rooms(p_deleted) の一覧で出す（同じログインならどの端末でも）。読めない時だけ控えの deleted_at（7日の内）で出す。
 *   一覧を全部読めたら印を合わせる（一覧の部屋に deleted_at・一覧に無い印は端末の時計で 7日−1時間 より新しい＝他で戻した→外す／古い＝期限切れ→gone:true）。印が変わればカードも描き直す。
 */
import { currentUser, showLogin, logout, myRooms, patchRoom, rpc, errText, uuid, esc, $, sb } from './gamen-core.mjs';
import { cardCounts, migrateState, gateText, roomEnded } from '../lib/room-state.mjs';

const md = (d) => (d ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');

function copyOf(uid, rid) {
  let st = null;
  try { st = JSON.parse(localStorage.getItem('mj-room:' + uid + ':' + rid) || 'null'); } catch { st = null; }
  if (!st || typeof st !== 'object' || !Array.isArray(st.tables)) return null;
  return migrateState(st); // ★ここでは保存しない★
}
/* この端末にまだ倉庫へ上がっていない物が在るか（並び・部屋を終える送りの印・写しが唯一の元）＝在る部屋は終えたと見ない（開けば送りが続く） */
function unsent(uid, rid, m) {
  let out = null, pc = null;
  try { out = JSON.parse(localStorage.getItem('mj-outbox:' + uid + ':' + rid) || '[]'); pc = localStorage.getItem('mj-pending-close:' + uid + ':' + rid); } catch { return true; }
  return (Array.isArray(out) && out.length > 0) || !Array.isArray(out) || !!pc || !!(m && m.st && m.st.needs_upload);
}
/* A11 §2：終えた対局か（読めない・門で止まった写し・送っていない物が在る部屋は終えたと見ない＝今まで通り出す） */
function finished(uid, r) {
  const m = copyOf(uid, r.room_id);
  if (unsent(uid, r.room_id, m)) return false;
  if (r.closed === true) return true;
  if (!m || m.gate.mode !== 'ok') return false;
  return roomEnded(m.st);
}
function lastTable(uid, rid) {
  let st = null;
  try { st = JSON.parse(localStorage.getItem('mj-room:' + uid + ':' + rid) || 'null'); } catch { st = null; }
  if (!st || !Array.isArray(st.tables) || !st.tables.length) return null;
  const m = migrateState(st); // 古い形の写しも読む（★ここでは保存しない＝直して保存するのは部屋を開いた時だけ・並びと一緒に★）
  if (m.gate.mode !== 'ok') return { gate: m.gate }; // ③-0 の門：ok でない部屋は表を出さず帯だけ
  return cardCounts(m.st); // A15g §2＝a15_sadame §1.3 そのまま（倉庫の行と同じ数）
}

const PAGE = 50;
const WAIT_MS = 8000; // 1頁の返しをこれだけ待って来なければ控えで出す（後から全部読めたら替える）
const delRow = (x) => !!x.deleted_at || x.gone === true; // A6 の門
const nameOf = (r) => r.name || (r.kind === 'solo' ? '対局' : '部屋');
const card = (rid, name, m, gate) => '<a class="h-cont" href="/taikyoku.html?room=' + encodeURIComponent(rid) + '" data-rid="' + esc(rid) + '"><span class="h-l">続きの部屋</span><span class="h-r">' + esc(name) + '</span>' +
  (m ? '<span class="h-m">' + esc(m) + '</span>' : '') + (gate ? '<span class="h-m h-gate">' + esc(gateText(gate)) + '</span>' : '') + '<span class="h-go">対局に戻る ›</span></a>';
/* 端末の写しから（倉庫の行が無いカード）＝今までの字のまま */
function localCard(uid, r) {
  const lt = lastTable(uid, r.room_id);
  const v = lt && !lt.gate ? lt : null;
  return card(r.room_id, nameOf(r), v ? countsText(v) : '', lt && lt.gate);
}
/* 倉庫の行から（a15_sadame §1.3 の last_date・hanchan_n・member_n） */
const countsText = (r) => [md(typeof r.last_date === 'string' ? r.last_date : ''), r.hanchan_n > 0 ? '半荘' + r.hanchan_n + '回目まで' : '', r.member_n > 0 ? r.member_n + '人' : ''].filter(Boolean).join(' ・ ');
function dbCard(r) {
  return card(r.room_id, nameOf(r), countsText(r), null);
}
/* 並べるカードの html の列。rows＝倉庫の行（null＝読めない＝控えで出す） */
function cardsOf(uid, rows) {
  const local = myRooms(uid).filter((x) => x && x.room_id && !delRow(x));
  if (!rows) return local.filter((x) => !finished(uid, x)).map((x) => localCard(uid, x)); // A11 の判じのまま
  const ids = new Set(rows.map((r) => r.room_id));
  for (const x of myRooms(uid)) if (x && delRow(x) && ids.has(x.room_id)) patchRoom(uid, x.room_id, { gone: false, deleted_at: null }); // 倉庫が返す＝消した印は古い（§1.2）
  const head = local.filter((x) => !ids.has(x.room_id) && unsent(uid, x.room_id, copyOf(uid, x.room_id))); // 送っていない部屋（送れば倉庫の並びになる）
  return [...head.map((x) => localCard(uid, x)), ...rows.map(dbCard)];
}
/* 倉庫を before で最後まで。返し＝{ok:true, rows}｜{ok:false, err}｜null（古い読み）。onPage＝頁を頼む前に呼ぶ（時間切れの時計を回し直す） */
async function readAll(seq, onPage, deleted) {
  const rows = []; let before = null;
  for (;;) {
    onPage();
    const res = await rpc('mj_my_rooms', { p_before_at: before ? before.at : null, p_before_id: before ? before.id : null, p_limit: PAGE, ...(deleted ? { p_deleted: true } : { p_open: true }) });
    if (seq !== drawSeq) return null;
    if (!res || res.ok !== true || !Array.isArray(res.rooms)) return { ok: false, err: (res && res.err) || 'net' }; // 途中の頁で読めない＝倉庫の行は捨てる（半分だけ出さない）
    for (const r of res.rooms) if (r && typeof r.room_id === 'string') rows.push(r);
    if (res.rooms.length < PAGE) return { ok: true, rows };
    const last = res.rooms[res.rooms.length - 1];
    before = deleted ? { at: last.deleted_at, id: last.room_id } : { at: last.last_write_at || last.created_at, id: last.room_id }; // A6：消した一覧は (deleted_at, room_id) の順
  }
}
function paint(list, band) {
  const box = $('tsuzuki'), b = $('hBand');
  box.innerHTML = list.join('');
  box.hidden = !list.length;
  b.hidden = !band;
}

/* A6 §2：［元に戻す］の帯（a6_sadame v1.4.3） */
const DEL_MS = 7 * 24 * 3600e3, MARGIN_MS = 3600e3;
const failed = new Map(); // room_id → {name, kind, msg}＝戻せなかった帯（この頁の間・戻せた時か倉庫の続きの一覧に出た時だけ外す）
let shownDel = []; // 今出している倉庫（か控え）の帯の行
const ageOf = (x) => Date.now() - Date.parse(x.deleted_at);
/* 読めない時だけ：控えの deleted_at（端末の時計で7日の内）を新しい順 */
const deviceDel = (uid) => myRooms(uid).filter((x) => x && typeof x.deleted_at === 'string' && ageOf(x) < DEL_MS).sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at));
/* 倉庫の消した一覧を全部読めた時：印を合わせる。返し＝印が変わったか */
function applyDel(uid, rows) {
  const ids = new Set(rows.map((r) => r.room_id));
  let changed = false;
  for (const x of myRooms(uid)) {
    if (!x || !x.room_id) continue;
    if (ids.has(x.room_id)) { if (!x.deleted_at) { patchRoom(uid, x.room_id, { deleted_at: rows.find((r) => r.room_id === x.room_id).deleted_at }); changed = true; } continue; }
    if (typeof x.deleted_at !== 'string') continue;
    if (ageOf(x) < DEL_MS - MARGIN_MS) { patchRoom(uid, x.room_id, { deleted_at: null }); changed = true; } // 他の端末で戻した（閉じた・締めた部屋は続きの一覧に出ないのでここで外す）
    else if (x.gone !== true) { patchRoom(uid, x.room_id, { gone: true }); changed = true; } // 期限切れ・掃除済み＝カードに戻さない
  }
  return changed;
}
function paintDel(u, list) {
  const el = $('hDel');
  if (!el) return;
  shownDel = u ? list : [];
  const ids = new Set(shownDel.map((x) => x.room_id));
  const all = u ? [...shownDel, ...[...failed].filter(([rid]) => !ids.has(rid)).map(([rid, v]) => ({ room_id: rid, name: v.name, kind: v.kind }))] : [];
  el.hidden = !all.length;
  el.innerHTML = all.map((x) => '<div class="h-del" data-rid="' + esc(x.room_id) + '"><span class="h-del-t">「' + esc(nameOf(x)) + '」を消しました</span>' +
    '<button class="btn btn-line h-del-b" type="button" data-undo="' + esc(x.room_id) + '">元に戻す</button>' +
    (failed.has(x.room_id) ? '<p class="err h-del-e">' + esc(failed.get(x.room_id).msg) + '</p>' : '') + '</div>').join('');
  for (const b of el.querySelectorAll('[data-undo]')) b.onclick = () => undo(u, b.dataset.undo, b);
}
async function undo(u, rid, b) {
  if (b.disabled) return;
  b.disabled = true; b.setAttribute('aria-busy', 'true');
  const res = await rpc('mj_write', { p_room_id: rid, p_op_id: uuid(), p_ops: [{ op: 'room_undelete' }] });
  if (res && res.ok === true) { failed.delete(rid); patchRoom(u.id, rid, { deleted_at: null, gone: false }); draw(); return; }
  if (res && res.err === 'mj_session') { b.disabled = false; b.removeAttribute('aria-busy'); showLogin(() => draw()); return; }
  const x = shownDel.find((r) => r.room_id === rid) || failed.get(rid) || {};
  failed.set(rid, { name: x.name, kind: x.kind, msg: '戻せませんでした（' + errText(res || {}) + '）' });
  paintDel(u, shownDel); // ★描き直さない★（倉庫の一覧から外れていても帯と字を残す）
}

let drawSeq = 0;
async function draw() {
  const seq = ++drawSeq;
  const u = await currentUser();
  if (seq !== drawSeq) return;
  const acct = $('acct');
  if (!u) {
    paintDel(null, []);
    acct.innerHTML = '<button class="btn-s" type="button" id="btnIn">ログイン</button>';
    $('btnIn').onclick = () => showLogin(() => draw());
    paint([], false);
    return;
  }
  acct.innerHTML = '<button class="btn-s" type="button" id="btnOut" title="' + esc(u.email) + '">ログアウト</button>';
  $('btnOut').onclick = async () => { await logout(); draw(); };
  $('hBandAgain').onclick = () => draw();
  // 読み直しの間は今のカードを残す（初めは空＝控えを出して後で入れ替えない）
  let timer = null, fell = false, painted = false, cardRows = null;
  const paintCards = (rows) => { painted = true; cardRows = rows; paint(cardsOf(u.id, rows), !rows); };
  const fallback = () => { if (seq !== drawSeq || fell) return; fell = true; paintCards(null); };
  // A6：帯の読みは並べて走らせる（終わるまで #hDel は前のまま）
  (async () => {
    let dt = null, dfell = false;
    const dfb = () => { if (seq !== drawSeq || dfell) return; dfell = true; paintDel(u, deviceDel(u.id)); };
    const r = await readAll(seq, () => { clearTimeout(dt); dt = setTimeout(dfb, WAIT_MS); }, true);
    clearTimeout(dt);
    if (!r || seq !== drawSeq) return;
    if (!r.ok) { dfell = false; dfb(); return; } // mj_session のログインはカードの読みが出す
    const changed = applyDel(u.id, r.rows); // ★全頁読めた後だけ印を書く★
    paintDel(u, r.rows);
    if (changed && painted) paint(cardsOf(u.id, cardRows), !cardRows); // §2 S1：先に描いたカードを新しい印で描き直す
  })();
  const res = await readAll(seq, () => { clearTimeout(timer); timer = setTimeout(fallback, WAIT_MS); });
  clearTimeout(timer);
  if (!res || seq !== drawSeq) return;
  if (res.ok) {
    let gone = false;
    for (const r of res.rows) if (failed.delete(r.room_id)) gone = true; // 戻しは倉庫で通っていた（返りが切れた）
    paintCards(res.rows);
    if (gone) paintDel(u, shownDel);
    return;
  }
  if (res.err === 'mj_session') showLogin(() => draw());
  fell = false; fallback();
}

sb().auth.onAuthStateChange(() => { draw(); });
draw();
