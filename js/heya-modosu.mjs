/* heya-modosu.mjs — 消した部屋を戻す（A6 a6_sadame v1.4.3 §2 の帯の中身を A27 a27_sadame v1.1 §3-4 でホームから移した）
 * 司さん 11-26「ホームにこんなんいらんごちゃごちゃするけん出すな」＝ホームには出さない。置き場は taikyoku.html（ホームの［対局］＝部屋を作る・入る）の一番下。
 * ・一覧＝倉庫の mj_my_rooms(p_deleted) を全頁（同じログインならどの端末でも）。8秒で返らない・読めない時だけ端末の控えの deleted_at（7日の内）。
 * ・全頁読めたら印を合わせる（applyDel＝ホームの読みも使う）。［元に戻す］＝mj_write room_undelete。戻せなかった字はこの頁の間は残す。
 * ・0件なら見出しごと出さない。
 */
import { myRooms, patchRoom, rpc, errText, uuid, esc, roomLabel } from './gamen-core.mjs';

export const DEL_MS = 7 * 24 * 3600e3;
const MARGIN_MS = 3600e3, PAGE = 50, WAIT_MS = 8000;
const ageOf = (x) => Date.now() - Date.parse(x.deleted_at);
const nameOf = roomLabel; // 名の無い部屋・部屋なしの置き名＝do the math（gamen-core）
/* 読めない時だけ：控えの deleted_at（端末の時計で7日の内）を新しい順 */
export const deviceDel = (uid) => myRooms(uid).filter((x) => x && typeof x.deleted_at === 'string' && ageOf(x) < DEL_MS).sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at));
/* 倉庫の消した一覧を全部読めた時：印を合わせる。返し＝印が変わったか */
export function applyDel(uid, rows) {
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

/* el に「消した部屋」を描く。u＝ログインした人。relogin(next)＝mj_session の時に入り直して next を呼ぶ */
export function mountModosu(el, u, relogin) {
  if (!el || !u) return;
  let seq = 0, shown = [];
  const failed = new Map(); // room_id → {name, kind, msg}＝戻せなかった行（この頁の間・戻せた時か倉庫の一覧から外れても残す）
  function paint(list) {
    shown = list;
    const ids = new Set(list.map((x) => x.room_id));
    const all = [...list, ...[...failed].filter(([rid]) => !ids.has(rid)).map(([rid, v]) => ({ room_id: rid, name: v.name, kind: v.kind }))];
    el.hidden = !all.length;
    el.innerHTML = all.length ? '<p class="sec">消した部屋（7日の間は戻せます）</p>' + all.map((x) => '<div class="h-del" data-rid="' + esc(x.room_id) + '"><span class="h-del-t">「' + esc(nameOf(x)) + '」を消しました</span>' +
      '<button class="btn btn-line h-del-b" type="button" data-undo="' + esc(x.room_id) + '">元に戻す</button>' +
      (failed.has(x.room_id) ? '<p class="err h-del-e">' + esc(failed.get(x.room_id).msg) + '</p>' : '') + '</div>').join('') : '';
    for (const b of el.querySelectorAll('[data-undo]')) b.onclick = () => undo(b.dataset.undo, b);
  }
  async function undo(rid, b) {
    if (b.disabled) return;
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    const res = await rpc('mj_write', { p_room_id: rid, p_op_id: uuid(), p_ops: [{ op: 'room_undelete' }] });
    if (res && res.ok === true) { failed.delete(rid); patchRoom(u.id, rid, { deleted_at: null, gone: false }); draw(); return; }
    if (res && res.err === 'mj_session' && relogin) { b.disabled = false; b.removeAttribute('aria-busy'); relogin(() => draw()); return; }
    const x = shown.find((r) => r.room_id === rid) || failed.get(rid) || {};
    failed.set(rid, { name: x.name, kind: x.kind, msg: '戻せませんでした（' + errText(res || {}) + '）' });
    paint(shown); // ★読み直さない★（倉庫の一覧から外れていても行と字を残す）
  }
  async function draw() {
    const my = ++seq;
    let dt = null, fell = false;
    const fb = () => { if (my !== seq || fell) return; fell = true; paint(deviceDel(u.id)); };
    const rows = []; let before = null, ok = true;
    for (;;) {
      clearTimeout(dt); dt = setTimeout(fb, WAIT_MS);
      const res = await rpc('mj_my_rooms', { p_before_at: before ? before.at : null, p_before_id: before ? before.id : null, p_limit: PAGE, p_deleted: true });
      if (my !== seq) { clearTimeout(dt); return; }
      if (!res || res.ok !== true || !Array.isArray(res.rooms)) { ok = false; break; } // 途中の頁で読めない＝倉庫の行は捨てる（半分だけ出さない）
      for (const r of res.rooms) if (r && typeof r.room_id === 'string') rows.push(r);
      if (res.rooms.length < PAGE) break;
      const last = res.rooms[res.rooms.length - 1];
      before = { at: last.deleted_at, id: last.room_id }; // 消した一覧は (deleted_at, room_id) の順
    }
    clearTimeout(dt);
    if (!ok) { fell = false; fb(); return; }
    applyDel(u.id, rows); // ★全頁読めた後だけ印を書く★
    paint(rows);
  }
  draw();
}
