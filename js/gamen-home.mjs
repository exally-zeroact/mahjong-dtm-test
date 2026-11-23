/* gamen-home.mjs — ホーム（絵 mahjong_home_v154 ①・設計図 §2 ホーム）
 * 続きの部屋＝この端末でこの人が一番新しく入った部屋を紺のカードで1枚（名前・日・半荘n回目まで・n人・［対局に戻る ›］）。
 * 日・回・人は端末の写し（mj-room:<uid>:<room_id>）の一番新しい卓から出す＝無ければその行は出さない。
 * A11（司さん 11-23「前のが残るのが原因やろ」）：終えた対局は出さない＝控えの並びで終えていない一番新しい部屋を出す（無ければカードを出さない）。
 *   終えた＝部屋を終えた（closed）か、写しの開催が在って pickSession が null（部屋を開いた時に新しい開催を作る判じと同じ）。
 */
import { currentUser, showLogin, logout, myRooms, esc, $, sb } from './gamen-core.mjs';
import { chainView, migrateState, gateText, pickSession } from '../lib/room-state.mjs';

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
  const ss = (m.st.sessions || []).filter((x) => !x.voided);
  return ss.length > 0 && pickSession(m.st) === null;
}
function lastTable(uid, rid) {
  let st = null;
  try { st = JSON.parse(localStorage.getItem('mj-room:' + uid + ':' + rid) || 'null'); } catch { st = null; }
  if (!st || !Array.isArray(st.tables) || !st.tables.length) return null;
  const m = migrateState(st); // 古い形の写しも読む（★ここでは保存しない＝直して保存するのは部屋を開いた時だけ・並びと一緒に★）
  if (m.gate.mode !== 'ok') return { gate: m.gate }; // ③-0 の門：ok でない部屋は表を出さず帯だけ
  st = m.st;
  return chainView(st, st.tables[st.tables.length - 1].table_id); // C4 §5a：区切った卓の鎖は1つ（「n回目まで」は鎖の通し番号）
}

async function draw() {
  const u = await currentUser();
  const acct = $('acct');
  const box = $('tsuzuki');
  if (!u) {
    acct.innerHTML = '<button class="btn-s" type="button" id="btnIn">ログイン</button>';
    $('btnIn').onclick = () => showLogin(() => draw());
    box.hidden = true;
    return;
  }
  acct.innerHTML = '<button class="btn-s" type="button" id="btnOut" title="' + esc(u.email) + '">ログアウト</button>';
  $('btnOut').onclick = async () => { await logout(); draw(); };
  const r = myRooms(u.id).find((x) => !finished(u.id, x)); // A11：終えた対局は続きの部屋に出さない
  box.hidden = !r;
  if (!r) return;
  const lt = lastTable(u.id, r.room_id);
  const v = lt && !lt.gate ? lt : null;
  const m = v ? [md(v.date), v.nextNo > 1 ? '半荘' + (v.nextNo - 1) + '回目まで' : '', v.people.length ? v.people.length + '人' : ''].filter(Boolean).join(' ・ ') : '';
  box.href = '/taikyoku.html?room=' + encodeURIComponent(r.room_id);
  box.innerHTML = '<span class="h-l">続きの部屋</span><span class="h-r">' + esc(r.name || (r.kind === 'solo' ? '対局' : '部屋')) + '</span>' + // 終えた部屋は出さない（A11・前の「終わりました」の印は外した）
    (m ? '<span class="h-m">' + esc(m) + '</span>' : '') + (lt && lt.gate ? '<span class="h-m" id="hGate">' + esc(gateText(lt.gate)) + '</span>' : '') + '<span class="h-go">対局に戻る ›</span>';
}

sb().auth.onAuthStateChange(() => { draw(); });
draw();
