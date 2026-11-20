/* gamen-home.mjs — ホーム：ログインの在り無しと「続きの部屋」（設計図 §2 ホーム） */
import { currentUser, showLogin, logout, myRooms, esc, $, sb } from './gamen-core.mjs';

async function draw() {
  const u = await currentUser();
  const acct = $('acct');
  const box = $('tsuzuki');
  if (!u) {
    acct.innerHTML = '<button class="btn-s btn-on-kon" type="button" id="btnIn">ログイン</button>';
    $('btnIn').onclick = () => showLogin(() => draw());
    box.hidden = true;
    return;
  }
  acct.innerHTML = '<button class="btn-s btn-on-kon" type="button" id="btnOut" title="' + esc(u.email) + '">ログアウト</button>';
  $('btnOut').onclick = async () => { await logout(); draw(); };
  const rooms = myRooms(u.id);
  box.hidden = rooms.length === 0;
  $('tsuzukiList').innerHTML = rooms.slice(0, 5).map((r) =>
    '<a class="btn btn-row" href="/taikyoku.html?room=' + encodeURIComponent(r.room_id) + '">' +
    '<span class="row-name">' + esc(r.name || '部屋') + '</span>' +
    '<span class="row-sub">' + esc(r.room_no || '') + (r.role === 'kan' ? '・管' : '') + '</span></a>'
  ).join('');
}

sb().auth.onAuthStateChange(() => { draw(); });
draw();
