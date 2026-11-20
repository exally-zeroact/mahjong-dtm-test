/* gamen-home.mjs — ホーム（絵 mahjong_home_v154 ①・設計図 §2 ホーム）
 * 続きの部屋＝この端末でこの人が一番新しく入った部屋を紺のカードで1枚（名前（番号）・日・半荘n回目まで・n人・［対局に戻る ›］）。
 * 日・回・人は端末の写し（mj-room:<uid>:<room_id>）の一番新しい卓から出す＝無ければその行は出さない。
 */
import { currentUser, showLogin, logout, myRooms, esc, $, sb } from './gamen-core.mjs';
import { tableView, migrateState, gateText } from '../lib/room-state.mjs';

const fmtNo = (no) => String(no || '').replace(/^(\d{4})(\d{4})$/, '$1 $2');
const md = (d) => (d ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');

function lastTable(uid, rid) {
  let st = null;
  try { st = JSON.parse(localStorage.getItem('mj-room:' + uid + ':' + rid) || 'null'); } catch { st = null; }
  if (!st || !Array.isArray(st.tables) || !st.tables.length) return null;
  const m = migrateState(st); // 古い形の写しも読む（★ここでは保存しない＝直して保存するのは部屋を開いた時だけ・並びと一緒に★）
  if (m.gate.mode !== 'ok') return { gate: m.gate }; // ③-0 の門：ok でない部屋は表を出さず帯だけ
  st = m.st;
  return tableView(st, st.tables[st.tables.length - 1].table_id);
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
  const r = myRooms(u.id)[0];
  box.hidden = !r;
  if (!r) return;
  const lt = lastTable(u.id, r.room_id);
  const v = lt && !lt.gate ? lt : null;
  const m = v ? [md(v.date), v.nextNo > 1 ? '半荘' + (v.nextNo - 1) + '回目まで' : '', v.people.length ? v.people.length + '人' : ''].filter(Boolean).join(' ・ ') : '';
  box.href = '/taikyoku.html?room=' + encodeURIComponent(r.room_id);
  box.innerHTML = '<span class="h-l">続きの部屋</span><span class="h-r">' + esc(r.name || '部屋') + (r.room_no ? '（' + esc(fmtNo(r.room_no)) + '）' : '') + '</span>' +
    (m ? '<span class="h-m">' + esc(m) + '</span>' : '') + (lt && lt.gate ? '<span class="h-m" id="hGate">' + esc(gateText(lt.gate)) + '</span>' : '') + '<span class="h-go">対局に戻る ›</span>';
}

sb().auth.onAuthStateChange(() => { draw(); });
draw();
