/* gamen-league.mjs — リーグを作る（D1・定め mahjong_tataki_2026-11-20/d1_sadame.md v2.1 §1・§2／絵 mahjong_league_v157 ①）
 * =============================================================================
 * 一覧＝入っている共有の部屋（★mj_my_rooms を before で全部たどる＝端末の控えでなく倉庫★・kind shared だけ）ごとに、
 *   mj_read('room') の leagues（st の外の段・取り消した物も・★since を付けずに読む＝same では leagues が来ない★）を並べる。
 *   league.html?room=<id>＝その部屋だけ読み、取り消したリーグの畳んだ段を開いて出す。
 * 出し分け＝［＋ リーグ］の部屋は mj_my_rooms の role（kan・owner）と closed で先に絞り、mj_read の room.role・owner・closed を正にする。
 *   ［設定を変える］＝終えていない部屋の取り消していないリーグ（押せるのは leagues[].l の人だけ）。
 *   ［自分を L にする］＝部屋の持ち主で l false・終えていない部屋だけ（取り消したリーグも）。取り消したリーグの段は持ち主にだけ。
 * 送り＝league_create・league_save・league_owner_set を mj_write へ直に（direct・並びに積まない・写しはリーグを持たない）。
 *   ★印★（op_id・league_id・送る中身・base_version）は押した時に1回だけ作り localStorage に部屋ごとに持つ＝答えが決まるまで同じ物で送り直す。
 *   返しごとに印を「残す／消す」は定め §1 の表の通り（KEEP＝残す）。字は gamen-core.mjs errText(res, 'league')。
 * 合図＝読んだ部屋の channel_key に入り、受けたらその部屋を since なしで読み直す（倉庫が league の op でも read_ver を上げて合図を出す）。
 * D2（d2_sadame v1.1 §3）：取り消していないリーグ（終えていない部屋）に［このリーグで対局を始める］→ taikyoku.html?room=<id>&league=<league_id>。
 * L（l_sadame v1.3 §1）：A22 規定の半荘数は無し（min_games は 0 で送る）・A16 もう一方の打ち方の箱は js/kenban（− はウマだけ・端末の鍵盤は出さない）・
 *   A24 同じ名前のリーグも作れる（11-27 23時 司さん・同名が並ぶ時は作った日時を添える）・作れたらそのリーグの対局の頁へ・見出しは「部屋 ○○」と小さく・
 *   名簿＝人ごとに［名前を直す］［外す］・下に「外した人」［戻す］（A25・member_rename／member_active・何も消さない）。
 * 作らない物：リーグを取り消すボタン・順位表（D3）。
 */
import { needLogin, showLogin, rpc, errText, sb, $, esc, uuid } from './gamen-core.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { mountRules, RULE_ERR, umaText } from './gamen-rules.mjs';
import { keypadHtml, wireKeypad } from './kenban.mjs';
import { baseSeats } from '../lib/league-round.mjs';
import { tableChains } from '../lib/league-rank.mjs';
import { makeAizuRead } from '../lib/aizu-read.mjs';

const KEEP = new Set(['mj_reauth', 'mj_session', 'busy', 'net', 'offline', 'server', 'internal']); // 印を残す返し（定め §1 の表）
const LOGIN = new Set(['mj_reauth', 'mj_session']);
const RANKS = [['pt', '合計pt'], ['avg_pt', '平均pt']];
const RANK_OLD = ['avg_rank', '平均順位']; // 倉庫に在る（任意 a5）＝作る時は出さず、読んだ物だけ字で見せる
const VIEWS = ['vLogin', 'vList', 'vPick', 'vForm'];

let me = null;
let only = null;          // league.html?room=<id>
let rooms = new Map();    // rid → { rid, my（mj_my_rooms の行・?room の時は null）, read（{room, st, leagues}）, err, dead（取り消しの段を開く）, roster }
let order = [];
let loaded = false;
let listMsg = null;       // { text, again?（［もう一度］の続き）, reread? }
let form = null;          // { mode 'create'|'edit', rid, lid, ctl, mainN, alt, rank, msg, again, stale, busy }
let loadSeq = 0;

/* ── 小物 ── */
const toInt = (s) => { const t = String(s == null ? '' : s).replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^[−ー－]/, '-'); return /^-?\d+$/.test(t) ? Number(t) : NaN; };
const okInt = (v) => Number.isInteger(v);
const n0 = (v) => (okInt(v) ? v.toLocaleString('ja-JP') : '—');
const bv = (v) => (okInt(v) ? (v < 0 ? '−' + -v : String(v)) : '');
const ymd = (d) => (d ? Number(d.slice(0, 4)) + '/' + Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');
const mdhm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const period = (lg) => (lg.date_from || lg.date_to ? ymd(lg.date_from) + '〜' + ymd(lg.date_to) : '');
const playersText = (lg) => lg.players_main + '人' + (lg.rules_alt ? '・' + (7 - lg.players_main) + '人' : '');
function show(id) { for (const v of VIEWS) $(v).hidden = v !== id; window.scrollTo(0, 0); }
function bar(back, title, onBack) {
  const b = $('barBack');
  b.textContent = '‹ ' + back;
  b.onclick = onBack ? (ev) => { ev.preventDefault(); onBack(); } : null;
  $('title').textContent = title;
}

/* ── 印（部屋ごと・localStorage）＝{ create: {op_id, op}|null, save: {lid: {op_id, op}}, owner: {lid: {op_id, op}} } ── */
const PKEY = (rid) => 'mj-league-pending:' + me.id + ':' + rid;
function loadP(rid) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PKEY(rid)) || 'null'); } catch { p = null; }
  if (!p || typeof p !== 'object') p = {};
  return { create: p.create || null, save: p.save || {}, owner: p.owner || {} };
}
function saveP(rid, p) {
  if (!p.create && !Object.keys(p.save).length && !Object.keys(p.owner).length) { localStorage.removeItem(PKEY(rid)); return; }
  localStorage.setItem(PKEY(rid), JSON.stringify(p));
}
function dropP(rid, kind, lid) {
  const p = loadP(rid);
  if (kind === 'create') p.create = null; else delete p[kind][lid];
  saveP(rid, p);
}

/* ── 読む ── */
function addRoom(rid, my) {
  if (rooms.has(rid)) return;
  rooms.set(rid, { rid, my, read: null, err: null, dead: rid === only, roster: false });
  order.push(rid);
}
function dropRoom(rid) { rooms.delete(rid); order = order.filter((x) => x !== rid); leaveChan(rid); }
/* 1部屋を since なしで読む。返し＝'ok'｜'gone'｜err の字 */
async function readOne(rid) {
  const x = rooms.get(rid);
  if (!x) return 'gone';
  const d = await rpc('mj_read', { p_room_id: rid, p_what: 'room', p_args: { v: 3 } }); // P5：使うのは room・members・leagues だけ＝分けた読み（最後の数開催だけ）で足りる
  if (!rooms.has(rid)) return 'gone';
  if (d && d.ok === true && d.room && typeof d.room === 'object') {
    x.read = { room: d.room, st: d.st && typeof d.st === 'object' ? d.st : {}, leagues: Array.isArray(d.leagues) ? d.leagues : [] };
    x.err = null;
    joinChan(rid);
    return 'ok';
  }
  const e = (d && d.err) || 'net';
  if (e === 'gone') { dropRoom(rid); return 'gone'; }
  x.err = e;
  return e;
}
async function loadAll() {
  const seq = ++loadSeq;
  for (const rid of [...chans.keys()]) leaveChan(rid);
  rooms = new Map(); order = []; loaded = false; listMsg = null;
  renderList();
  if (only) addRoom(only, null);
  else {
    let before = null;
    for (;;) {
      const res = await rpc('mj_my_rooms', { p_before_at: before ? before.at : null, p_before_id: before ? before.id : null, p_limit: 50 });
      if (seq !== loadSeq) return;
      if (!res || res.ok !== true || !Array.isArray(res.rooms)) {
        const e = (res && res.err) || 'net';
        if (e === 'mj_session') { relogin(() => loadAll()); }
        listMsg = { text: errText({ err: e }), reread: true }; loaded = true; renderList(); return;
      }
      for (const r of res.rooms) if (r && r.kind === 'shared') addRoom(r.room_id, r);
      if (res.rooms.length < 50) break;
      const last = res.rooms[res.rooms.length - 1];
      before = { at: last.last_write_at || last.created_at, id: last.room_id };
    }
  }
  const got = await Promise.all(order.map((rid) => readOne(rid)));
  if (seq !== loadSeq) return;
  if (got.includes('mj_session')) relogin(() => loadAll());
  if (only && got[0] === 'gone') listMsg = { text: errText({ err: 'gone' }, 'league') };
  loaded = true;
  renderList();
}

/* ── 合図（2c-2f と同じ管の名・event 'w'）＝受けたらその部屋を読み直す（0.3秒まとめ）
 *    P1g（pbundle_sadame v2.1 §3.3）：1部屋の読みは lib/aizu-read.mjs で「読み中1本＋待ち1本」（連打されても重ねて読まない・1秒を越さない） ── */
const chans = new Map(); // rid → { key, c, ar }
function joinChan(rid) {
  const x = rooms.get(rid);
  const R = x && x.read && x.read.room;
  const key = R && !R.closed && typeof R.channel_key === 'string' ? R.channel_key : null;
  const cur = chans.get(rid);
  if (cur && cur.key === key) return;
  leaveChan(rid);
  if (!key) return;
  const h = { key, c: null, ar: null };
  h.ar = makeAizuRead(async () => { if (chans.get(rid) !== h) return; await readOne(rid); if (!$('vList').hidden) renderList(); });
  chans.set(rid, h);
  try {
    h.c = sb().channel(key, { config: { private: false } });
    h.c.on('broadcast', { event: 'w' }, () => { if (chans.get(rid) === h) h.ar.poke(); }).subscribe(() => {});
  } catch { /* 合図が使えなくても開いた時の読みはある */ }
}
function leaveChan(rid) {
  const h = chans.get(rid);
  if (!h) return;
  chans.delete(rid);
  h.ar.stop();
  if (h.c) { try { const p = sb().removeChannel(h.c); if (p && p.catch) p.catch(() => {}); } catch { /* 外せなくても chans に無い＝受けても読まない */ } }
}

/* ── 一覧 ── */
function roomName(x) { return (x.read && x.read.room && x.read.room.name) || (x.my && x.my.name) || '部屋'; }
function msgHtml(m, pre) {
  if (!m) return '';
  return '<div class="obi obi-warn" id="' + pre + 'Msg"><span id="' + pre + 'MsgT">' + esc(m.text) + '</span>' +
    (m.again ? '<button class="btn-s lg-mbtn" type="button" id="' + pre + 'Again">もう一度</button>' : '') +
    (m.reread ? '<button class="btn-s lg-mbtn" type="button" id="' + pre + 'Reread">読み直す</button>' : '') + '</div>';
}
function renderList() {
  show('vList');
  bar('ホーム', 'リーグ', null);
  let h = msgHtml(listMsg, 'l');
  if (!loaded) { $('vList').innerHTML = h; wireMsg('l', listMsg); return; }
  let liveAll = 0;
  for (const rid of order) {
    const x = rooms.get(rid);
    if (!x.read) {
      if (x.err) h += '<h3 class="sec">' + esc(roomName(x)) + '</h3><div class="list"><div class="li" data-rerr="' + esc(rid) + '"><span class="err">' + esc(errText({ err: x.err })) + '</span><button class="btn-s" type="button" data-reread="' + esc(rid) + '">読み直す</button></div></div>';
      continue;
    }
    const R = x.read.room;
    const owner = R.owner === true, closed = R.closed === true;
    const live = x.read.leagues.filter((l) => !l.voided);
    const dead = owner ? x.read.leagues.filter((l) => l.voided) : [];
    liveAll += live.length;
    if (!live.length && !dead.length) continue;
    h += '<section class="lg-room" data-room="' + esc(rid) + '"><h3 class="sec lg-heya" data-heya>部屋 ' + esc(roomName(x)) + (closed ? '<small class="lg-owari" data-owari>終わった部屋</small>' : '') + '</h3><div class="list">';
    const nk = (l) => String(l.name || '').trim();
    for (const l of live) {
      // A24（11-27 23時）：同じ部屋に同じ名前が2つ以上並ぶ時は作った日時を添えて見分ける（倉庫が created_at を返す時だけ）
      const twin = live.some((o) => o !== l && nk(o) === nk(l));
      const made = twin && l.created_at ? '作った ' + mdhm(l.created_at) : '';
      const sub = [period(l), playersText(l), made].filter(Boolean).join(' ・ ');
      h += '<div class="li lg-row" data-lg="' + esc(l.league_id) + '"><span class="lg-l"><span class="row-name">' + esc(l.name) + '</span><span class="row-sub">' + esc(sub) + '</span></span><span class="lg-btns">';
      if (owner && !closed && l.l !== true) h += '<button class="btn-s" type="button" data-own="' + esc(l.league_id) + '" data-r="' + esc(rid) + '">自分を L にする</button>';
      if (!closed) h += '<button class="btn-s" type="button" data-edit="' + esc(l.league_id) + '" data-r="' + esc(rid) + '"' + (l.l === true ? '' : ' disabled') + '>設定を変える</button>';
      h += '</span></div>';
      if (!closed) h += '<div class="li li-sub lg-play"><a class="btn-s" data-play="' + esc(l.league_id) + '" href="taikyoku.html?room=' + encodeURIComponent(rid) + '&amp;league=' + encodeURIComponent(l.league_id) + '">このリーグで対局を始める</a></div>';
    }
    const all = Array.isArray(x.read.st.members) ? x.read.st.members.filter((m) => m && m.member_id) : [];
    const mem = all.filter((m) => m.active !== false), gone = all.filter((m) => m.active === false);
    h += '<div class="li"><span>名簿 <b data-nmem>' + mem.length + '</b>人</span><button class="btn-s" type="button" data-roster="' + esc(rid) + '" aria-expanded="' + x.roster + '">名簿を見る</button></div>';
    if (x.roster) h += rosterHtml(rid, x, mem, gone, closed);
    if (dead.length) {
      h += '<button class="li" type="button" data-dead="' + esc(rid) + '" aria-expanded="' + x.dead + '"><span>取り消したリーグ（' + dead.length + '）</span><span class="li-v"><span class="li-ya" aria-hidden="true">' + (x.dead ? '⌄' : '›') + '</span></span></button>';
      if (x.dead) for (const l of dead) {
        const sub = period(l);
        h += '<div class="li li-sub lg-row" data-void="' + esc(l.league_id) + '"><span class="lg-l"><span class="row-name">' + esc(l.name) + '</span>' + (sub ? '<span class="row-sub">' + esc(sub) + '</span>' : '') + '</span><span class="lg-btns">' +
          (!closed && l.l !== true ? '<button class="btn-s" type="button" data-own="' + esc(l.league_id) + '" data-r="' + esc(rid) + '">自分を L にする</button>' : '') + '</span></div>';
      }
    }
    h += '</div></section>';
  }
  if (!liveAll) h += '<p class="setsumei lg-none" id="lNone">まだリーグがありません</p>';
  h += '<button class="btn btn-main lg-add" type="button" id="lAdd">＋ リーグ</button>';
  $('vList').innerHTML = h;
  wireMsg('l', listMsg);
  $('lAdd').onclick = openPick;
  for (const b of $('vList').querySelectorAll('[data-edit]')) b.onclick = () => openEdit(b.dataset.r, b.dataset.edit);
  for (const b of $('vList').querySelectorAll('[data-own]')) b.onclick = () => ownerSet(b.dataset.r, b.dataset.own);
  for (const b of $('vList').querySelectorAll('[data-dead]')) b.onclick = () => { const x = rooms.get(b.dataset.dead); x.dead = !x.dead; renderList(); };
  for (const b of $('vList').querySelectorAll('[data-roster]')) b.onclick = () => { const x = rooms.get(b.dataset.roster); x.roster = !x.roster; x.mm = null; x.redit = null; if (x.roster) rosterLoad(b.dataset.roster); renderList(); };
  wireRoster();
  for (const b of $('vList').querySelectorAll('[data-reread]')) b.onclick = async () => { const k = await readOne(b.dataset.reread); if (k === 'mj_session') relogin(() => loadAll()); renderList(); };
}
function wireMsg(pre, m) {
  if (!m) return;
  const a = $(pre + 'Again'), r = $(pre + 'Reread');
  if (a) a.onclick = () => m.again();
  if (r) r.onclick = () => (m.rereadFn ? m.rereadFn() : loadAll());
}

/* ── A25 名簿（l_sadame v1.3 §1 A24④・A25）＝人ごとに［名前を直す］［外す］・下に「外した人」［戻す］。何も消さない ──
 * 送り＝member_rename／member_active を部屋の範囲で mj_write へ直に（押した時に1回だけ op_id・答えが決まるまで同じ id）。役の門は倉庫（mj_role need owner_or_sole_L）。
 * 外す前の確かめ＝点の回数（部屋の半荘＋各リーグの半荘・取り消していない回と卓）と、締めていないリーグの日で次の席（baseSeats）に居る卓。
 *   リーグの半荘は mj_read 'room' に来ない＝名簿を開いた時に各リーグを mj_read 'league' で読む（読めない間は［外す］を押せない）。 */
const ROSTER_ERR = { dup: '同じ名前の人がもういます', left: 'この人は部屋を出ています。名前は直せません。', role: 'この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます' };
async function rosterLoad(rid) {
  const x = rooms.get(rid); if (!x || !x.read) return;
  const seq = (x.rseq = (x.rseq || 0) + 1);
  const live = x.read.leagues.filter((l) => !l.voided);
  const got = await Promise.all(live.map((l) => rpc('mj_read', { p_room_id: rid, p_what: 'league', p_args: { league_id: l.league_id } })));
  if (rooms.get(rid) !== x || x.rseq !== seq) return;
  if (got.some((r) => !r || r.ok !== true || !r.st)) { x.mm = { err: true }; renderList(); return; }
  x.mm = { sts: got.map((r) => r.st) };
  renderList();
}
function chainLastT(st, t) {
  const by = new Map((st.tables || []).map((y) => [y.table_id, y]));
  const seen = new Set();
  let c = t;
  while (c && c.next_table_id && by.get(c.next_table_id) && !seen.has(c.next_table_id)) { seen.add(c.next_table_id); c = by.get(c.next_table_id); }
  return c;
}
/* 人の点の回数と、締めていないリーグの日で次の席に居る卓の名 */
function memberUse(x, mid) {
  const seen = new Set(); let n = 0; const at = [];
  const count = (st) => {
    const liveT = new Set((st.tables || []).filter((t) => !t.voided).map((t) => t.table_id));
    for (const h of st.hanchans || []) if (!h.voided && liveT.has(h.table_id) && !seen.has(h.hanchan_id) && Array.isArray(h.seats) && h.seats.includes(mid)) { seen.add(h.hanchan_id); n++; }
  };
  count(x.read.st);
  for (const st of (x.mm && x.mm.sts) || []) {
    count(st);
    for (const s of st.sessions || []) {
      if (s.voided || (st.settles || []).some((y) => y.session_id === s.session_id)) continue;
      for (const hd of tableChains(st, s.session_id)) {
        const t = st.tables.find((y) => y.table_id === hd);
        const last = chainLastT(st, t);
        const np = last && last.rules && Number.isInteger(last.rules.players) ? last.rules.players : null;
        const b = np === null ? null : baseSeats(st, hd, np).seats;
        if (b && b.includes(mid)) at.push(t.label);
      }
    }
  }
  return { n, at };
}
function rosterHtml(rid, x, mem, gone, closed) {
  const ed = x.redit || null; // { mid, kind 'rename'|'off'|'on', msg, busy, p }
  const busy = !!(ed && ed.busy);
  const R = esc(rid);
  let h = '<div class="lg-roster" data-names="' + R + '">';
  if (x.mm && x.mm.err) h += '<div class="li li-sub"><span class="err" data-rerrm>リーグの点が読めませんでした。外す前に読み直してください。</span><button class="btn-s" type="button" data-rload="' + R + '">読み直す</button></div>';
  const msg = (m) => (ed && ed.mid === m.member_id && ed.msg ? '<div class="li li-sub"><span class="err" data-redmsg>' + esc(ed.msg) + '</span></div>' : '');
  for (const m of mem) {
    const mid = esc(m.member_id);
    h += '<div class="li li-sub lg-mem" data-mem="' + mid + '"><span class="row-name">' + esc(m.name) + '</span>';
    if (!closed) h += '<span class="lg-btns"><button class="btn-s" type="button" data-rn="' + mid + '" data-r="' + R + '">名前を直す</button><button class="btn-s" type="button" data-off="' + mid + '" data-r="' + R + '"' + (x.mm && x.mm.sts ? '' : ' disabled') + '>外す</button></span>';
    h += '</div>';
    if (ed && ed.mid === m.member_id && ed.kind === 'rename') {
      h += '<div class="li li-sub lg-ed" data-ed="rename"><input class="h-in" id="rnIn" maxlength="20" autocomplete="off" value="' + esc(ed.val != null ? ed.val : m.name) + '" aria-label="新しい名前"><span class="lg-btns"><button class="btn-s" type="button" data-rnok="' + mid + '" data-r="' + R + '"' + (busy ? ' disabled' : '') + '>保存</button><button class="btn-s" type="button" data-edno="' + R + '">やめる</button></span></div>';
    }
    if (ed && ed.mid === m.member_id && ed.kind === 'off') {
      const u = memberUse(x, m.member_id);
      const t = [u.n ? m.name + 'さんは半荘 ' + u.n + ' 回の点があります。外しても点はリーグの順位に残ります' : m.name + 'さんを外します。人を選ぶ所に出なくなります'];
      if (u.at.length) t.push('今 ' + u.at.join('・') + ' の席にいます。その卓の次の半荘は人を選び直します');
      h += '<div class="li li-sub lg-ed" data-ed="off"><span class="lg-names" data-offt>' + esc(t.join('。') + '。') + '</span><span class="lg-btns"><button class="btn-s" type="button" data-offok="' + mid + '" data-r="' + R + '"' + (busy ? ' disabled' : '') + '>外す</button><button class="btn-s" type="button" data-edno="' + R + '">やめる</button></span></div>';
    }
    h += msg(m);
  }
  if (gone.length) {
    h += '<h4 class="sec lg-gone">外した人</h4>';
    for (const m of gone) {
      const mid = esc(m.member_id);
      h += '<div class="li li-sub lg-mem" data-gone="' + mid + '"><span class="row-name">' + esc(m.name) + '</span>' + (!closed ? '<span class="lg-btns"><button class="btn-s" type="button" data-on="' + mid + '" data-r="' + R + '"' + (busy ? ' disabled' : '') + '>戻す</button></span>' : '') + '</div>';
      h += msg(m);
    }
  }
  return h + '</div>';
}
function rosterErr(res) {
  const e = res && res.err;
  if (e === 'dup') return ROSTER_ERR.dup;
  if (e === 'left') return ROSTER_ERR.left;
  if (e === 'mj_role') return ROSTER_ERR.role;
  return errText(res);
}
async function rosterSend(rid, mid, kind, op) {
  const x = rooms.get(rid); if (!x) return;
  if (x.redit && x.redit.busy) return;
  if (!(x.redit && x.redit.mid === mid && x.redit.kind === kind)) x.redit = { mid, kind };
  const ed = x.redit;
  if (!ed.p || JSON.stringify(ed.p.op) !== JSON.stringify(op)) ed.p = { op_id: uuid(), op }; // 押した時に1回だけ id（同じ中身の送り直しは同じ id）
  ed.busy = true; ed.msg = null; renderList();
  const res = await rpc('mj_write', { p_room_id: rid, p_op_id: ed.p.op_id, p_ops: [ed.p.op] });
  ed.busy = false;
  if (rooms.get(rid) !== x) return;
  if (res && res.ok === true) {
    x.redit = null;
    const k = await readOne(rid);
    if (k === 'mj_session') relogin(() => loadAll());
    else if (k !== 'ok' && k !== 'gone') listMsg = { text: errText({ err: k }), reread: true };
    const y = rooms.get(rid);
    if (y && y.roster) rosterLoad(rid);
    renderList(); return;
  }
  const e = (res && res.err) || 'net';
  if (!KEEP.has(e)) ed.p = null; // 決まった答え＝次は新しい id
  ed.msg = LOGIN.has(e) ? errText(res, 'league') : rosterErr(res || { err: 'net' });
  renderList();
  if (LOGIN.has(e)) relogin(() => rosterSend(rid, mid, kind, op));
}
function wireRoster() {
  const V = $('vList');
  const on = (sel, f) => { for (const b of V.querySelectorAll(sel)) b.onclick = () => f(b); };
  on('[data-rload]', (b) => { const x = rooms.get(b.dataset.rload); x.mm = null; rosterLoad(b.dataset.rload); renderList(); });
  on('[data-rn]', (b) => { const x = rooms.get(b.dataset.r); x.redit = { mid: b.dataset.rn, kind: 'rename' }; renderList(); const i = $('rnIn'); if (i) i.focus(); });
  on('[data-off]', (b) => { const x = rooms.get(b.dataset.r); x.redit = { mid: b.dataset.off, kind: 'off' }; renderList(); });
  on('[data-edno]', (b) => { const x = rooms.get(b.dataset.edno); x.redit = null; renderList(); });
  on('[data-rnok]', (b) => {
    const x = rooms.get(b.dataset.r), i = $('rnIn'), nm = i ? i.value.trim() : '';
    if (x.redit) x.redit.val = i ? i.value : null;
    if (!nm || [...nm].length > 20) { x.redit.msg = '名前は1〜20字で入れてください。'; renderList(); return; }
    rosterSend(b.dataset.r, b.dataset.rnok, 'rename', { op: 'member_rename', member_id: b.dataset.rnok, name: nm });
  });
  on('[data-offok]', (b) => rosterSend(b.dataset.r, b.dataset.offok, 'off', { op: 'member_active', member_id: b.dataset.offok, active: false }));
  on('[data-on]', (b) => rosterSend(b.dataset.r, b.dataset.on, 'on', { op: 'member_active', member_id: b.dataset.on, active: true }));
}

/* ── ［＋ リーグ］：部屋を選ぶ（管か持ち主の共有の部屋で、終えていない物だけ） ── */
function canMake(x) {
  const R = x.read && x.read.room;
  if (!R) return false;
  const myOk = !x.my || ((x.my.role === 'kan' || x.my.role === 'owner') && x.my.closed !== true); // mj_my_rooms で先に絞る
  return myOk && (R.role === 'kan' || R.role === 'owner' || R.owner === true) && R.closed !== true && R.kind !== 'solo';
}
function openPick() {
  const ok = order.filter((rid) => canMake(rooms.get(rid)));
  if (ok.length === 1) { openCreate(ok[0]); return; }
  show('vPick');
  bar('リーグ', 'リーグを作る', () => renderList());
  let h = '';
  if (!ok.length) h = '<p class="setsumei" id="pNone">先に部屋（部屋名＋パス）を作ってください</p><a class="btn btn-main" id="pMakeRoom" href="taikyoku.html">部屋を作る</a>';
  else h = '<div class="list" id="pRooms">' + ok.map((rid) => '<button class="li" type="button" data-pick="' + esc(rid) + '"><span>' + esc(roomName(rooms.get(rid))) + '</span><span class="li-v"><span class="li-ya" aria-hidden="true">›</span></span></button>').join('') + '</div>';
  $('vPick').innerHTML = h;
  for (const b of $('vPick').querySelectorAll('[data-pick]')) b.onclick = () => openCreate(b.dataset.pick);
}

/* ── 作る頁・設定を変える頁（同じ形・絵 v157 ①） ── */
function altFrom(rules, n) {
  const d = rules || defaultRules(n);
  return { start_pts: d.start_pts, return_pts: d.return_pts, uma: d.uma.slice() };
}
function openForm(f) {
  form = { msg: null, stale: false, busy: false, ...f };
  show('vForm');
  bar('リーグ', f.mode === 'create' ? 'リーグを作る' : 'リーグの設定', () => { form = null; renderList(); });
  const v = f.val;
  $('fName').value = v.name || '';
  $('fFrom').value = v.date_from || '';
  $('fTo').value = v.date_to || '';
  form.rank = v.rank_by || 'pt';
  form.mainN = v.players_main;
  form.alt = { on: !!v.rules_alt, open: new Set(), ...altFrom(v.rules_alt, 7 - v.players_main) };
  form.ctl = mountRules($('fRules'), {
    rules: v.rules, readOnly: false, sp: $('fKpSp'), lockPlayers: f.mode === 'edit', labels: { sec: '打ち方とレート', players: '主の打ち方' },
    onPlayers: (n) => { readAlt(); form.mainN = n; Object.assign(form.alt, altFrom(null, 7 - n)); renderAlt(); },
  });
  $('fGo').textContent = f.mode === 'create' ? 'このルールでリーグを作る' : '保存';
  renderAlt(); renderRank(); renderFormMsg();
}
function openCreate(rid) {
  const p = loadP(rid).create; // 印が在る＝答えが決まっていない＝同じ中身を出して同じ id で送り直す
  const val = p ? p.op : { name: '', date_from: null, date_to: null, rank_by: 'pt', min_games: 0, players_main: 4, rules: { ...defaultRules(4), rate: 100 }, rules_alt: null };
  openForm({ mode: 'create', rid, val });
}
function openEdit(rid, lid) {
  const x = rooms.get(rid);
  const lg = x && x.read && x.read.leagues.find((l) => l.league_id === lid);
  if (!lg) { listMsg = { text: errText({ err: 'bad', at: 'league' }, 'league') }; renderList(); return; }
  const p = loadP(rid).save[lid];
  const val = p ? { ...lg, ...p.op, players_main: lg.players_main } : lg;
  openForm({ mode: 'edit', rid, lid, val });
}
function renderAlt() {
  const a = form.alt, nm = (7 - form.mainN) + '人打ち';
  let h = '<div class="li"><span>' + nm + 'の卓も使う</span><button type="button" class="tg" role="switch" id="aOn" aria-checked="' + a.on + '" aria-label="入切"></button></div>';
  if (a.on) {
    h += '<button type="button" class="li" data-aopen="ps"><span>' + nm + 'の持ち点／返し</span><span class="li-v">' + n0(a.start_pts) + ' ／ ' + n0(a.return_pts) + '<span class="li-ya" aria-hidden="true">›</span></span></button>';
    if (a.open.has('ps')) h += '<div class="li li-sub"><span>持ち点</span><input class="box" id="aStart" readonly inputmode="none" value="' + bv(a.start_pts) + '" autocomplete="off"></div><div class="li li-sub"><span>返し</span><input class="box" id="aReturn" readonly inputmode="none" value="' + bv(a.return_pts) + '" autocomplete="off"></div>';
    h += '<button type="button" class="li" data-aopen="uma"><span>' + nm + 'のウマ</span><span class="li-v">' + esc(umaText(a.uma)) + '<span class="li-ya" aria-hidden="true">›</span></span></button>';
    if (a.open.has('uma')) h += '<div class="li li-sub"><span class="uma-row">' + a.uma.map((u, i) => '<label><small>' + (i + 1) + '位</small><input class="box" data-auma="' + i + '" readonly inputmode="none" value="' + bv(u) + '" autocomplete="off"></label>').join('') + '</span></div>';
  }
  $('fAlt').innerHTML = h + keypadHtml({ sp: false });
  // A16：箱はアプリの数字鍵盤（gamen-rules と同じ）＝− はウマだけ・持ち点／返しは6桁・ウマは3桁
  wireKeypad($('fAlt'), { boxes: () => [...$('fAlt').querySelectorAll('input.box')], spec: (x) => (x.dataset.auma !== undefined ? { neg: true, dec: false, max: 3 } : { neg: false, dec: false, max: 6 }), sp: $('fKpSp') });
}
function readAlt() {
  const a = form.alt, el = $('fAlt');
  if ($('aStart')) a.start_pts = toInt($('aStart').value);
  if ($('aReturn')) a.return_pts = toInt($('aReturn').value);
  for (const x of el.querySelectorAll('[data-auma]')) a.uma[Number(x.dataset.auma)] = toInt(x.value);
}
function renderRank() {
  const opts = form.rank === RANK_OLD[0] ? [...RANKS, RANK_OLD] : RANKS;
  $('fRank').innerHTML = opts.map(([v, t]) => '<button type="button" data-rank="' + v + '" aria-pressed="' + (form.rank === v) + '">' + esc(t) + '</button>').join('');
}
function renderFormMsg() {
  const m = form.msg;
  $('fMsg').innerHTML = m ? esc(m.text) : '';
  $('fAgain').hidden = !(m && m.again);
  $('fReread').hidden = !(m && m.reread);
  $('fGo').disabled = form.busy || form.stale;
  $('fGo').setAttribute('aria-busy', form.busy ? 'true' : 'false');
}
function formErr(text) { form.msg = { text }; renderFormMsg(); }
/* 欄を読んで送る中身を作る（倉庫の門の先回り）。返し＝{ err } か { val } */
function readForm() {
  readAlt();
  const name = $('fName').value.trim();
  if (!name || [...name].length > 40) return { err: errText({ err: 'bad', at: 'name' }, 'league') };
  const date_from = $('fFrom').value || null, date_to = $('fTo').value || null;
  for (const d of [date_from, date_to]) if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { err: errText({ err: 'bad', at: 'date_from' }, 'league') };
  if (date_from && date_to && date_from > date_to) return { err: errText({ err: 'bad', at: 'date_to' }, 'league') };
  const rr = form.ctl.read();
  if (rr.yakitori === true && !(Number.isInteger(rr.yakitori_pt) && rr.yakitori_pt >= 1 && rr.yakitori_pt <= 999)) return { err: 'やきとり1枚の pt は 1〜999 です（整数）。' };
  const chk = rulesOk(rr);
  if (!chk.ok) return { err: RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。') };
  let rules_alt = null;
  if (form.alt.on) {
    const a = form.alt;
    const c2 = rulesOk({ ...chk.rules, players: 7 - chk.rules.players, start_pts: a.start_pts, return_pts: a.return_pts, uma: a.uma.slice() });
    if (!c2.ok) return { err: RULE_ERR[c2.err] || ('ルールの「' + c2.err + '」が入れられません。') };
    rules_alt = c2.rules;
  }
  // A24①（司さん 11-27 23時で取り消し）：同じ名前のリーグも作れる・直せる（打つ人・日付・時間で分かる）＝名の重なりは止めない
  return { val: { name, date_from, date_to, rank_by: form.rank, min_games: 0, players_main: chk.rules.players, rules: chk.rules, rules_alt } };
}
async function submit() {
  if (!form || form.busy || form.stale) return;
  const f = form, rid = f.rid;
  const P = loadP(rid);
  let p = f.mode === 'create' ? P.create : P.save[f.lid];
  if (!p) { // ★押した時に1回だけ id を作る★（印が在る間は同じ id・同じ中身）
    const r = readForm();
    if (r.err) { formErr(r.err); return; }
    const v = r.val;
    if (f.mode === 'create') {
      p = { op_id: uuid(), op: { op: 'league_create', league_id: uuid(), name: v.name, date_from: v.date_from, date_to: v.date_to, rank_by: v.rank_by, min_games: v.min_games, players_main: v.players_main, rules: v.rules, rules_alt: v.rules_alt } };
      P.create = p;
    } else {
      const lg = curLeague(rid, f.lid);
      if (!lg) { await afterWrite({ ok: false, err: 'bad', at: 'league' }, rid, 'save', f.lid); return; }
      p = { op_id: uuid(), op: { op: 'league_save', league_id: f.lid, base_version: lg.version, name: v.name, date_from: v.date_from, date_to: v.date_to, rank_by: v.rank_by, min_games: v.min_games, rules: v.rules, rules_alt: v.rules_alt } };
      P.save[f.lid] = p;
    }
    saveP(rid, P); // ★送る前に印を保存★
  }
  f.busy = true; f.msg = null; renderFormMsg();
  const res = await rpc('mj_write', { p_room_id: rid, p_op_id: p.op_id, p_ops: [p.op] });
  f.busy = false;
  if (form !== f) return;
  await afterWrite(res, rid, f.mode === 'create' ? 'create' : 'save', f.mode === 'create' ? null : f.lid);
}
const curLeague = (rid, lid) => { const x = rooms.get(rid); return x && x.read ? x.read.leagues.find((l) => l.league_id === lid) || null : null; };

/* ［自分を L にする］＝league_owner_set（持ち主・入り直し10分＝mj_reauth は印を残してログインし直し） */
let ownBusy = false;
async function ownerSet(rid, lid) {
  if (ownBusy) return;
  const P = loadP(rid);
  let p = P.owner[lid];
  if (!p) { p = { op_id: uuid(), op: { op: 'league_owner_set', league_id: lid } }; P.owner[lid] = p; saveP(rid, P); }
  ownBusy = true; listMsg = null;
  for (const b of $('vList').querySelectorAll('[data-own]')) b.disabled = true;
  const res = await rpc('mj_write', { p_room_id: rid, p_op_id: p.op_id, p_ops: [p.op] });
  ownBusy = false;
  await afterWrite(res, rid, 'owner', lid);
}

/* 返しを受ける（定め §1 の表）。印＝KEEP は残す・他は消す */
async function afterWrite(res, rid, kind, lid) {
  const inForm = kind !== 'owner';
  const again = () => (kind === 'owner' ? ownerSet(rid, lid) : submit());
  const say = (m) => { if (inForm && form) { form.msg = m; renderFormMsg(); } else { listMsg = m; renderList(); } };
  if (res && res.ok === true) {
    // A24②：作れたら一覧に戻らず、そのリーグの対局の頁へ（印を消す前に league_id を取る）
    const pc = kind === 'create' ? loadP(rid).create : null;
    const made = pc && pc.op ? pc.op.league_id : null;
    dropP(rid, kind, lid);
    if (made) { form = null; location.href = 'taikyoku.html?room=' + encodeURIComponent(rid) + '&league=' + encodeURIComponent(made); return; }
    const k = await readOne(rid);
    form = null; listMsg = k === 'ok' || k === 'gone' ? null : { text: errText({ err: k }), reread: true };
    renderList(); return;
  }
  const e = (res && res.err) || 'net', at = res && (res.at || res.what);
  if (KEEP.has(e)) {
    say({ text: errText(res, 'league'), again: e === 'internal' ? null : again });
    if (LOGIN.has(e)) relogin(again);
    return;
  }
  dropP(rid, kind, lid);
  const text = errText(res, 'league');
  if (e === 'gone') { dropRoom(rid); form = null; listMsg = { text }; renderList(); return; }
  if (e === 'conflict' && kind === 'save') { await conflictReopen(rid, lid); return; }
  if (e === 'bad' && (at === 'closed' || at === 'league' || at === 'league_id')) {
    await readOne(rid);
    form = null; listMsg = { text }; renderList(); return;
  }
  let t = text;
  if (e === 'bad' && (at === 'rules' || at === 'rules_alt') && res.key && RULE_ERR[res.key]) t = RULE_ERR[res.key];
  say({ text: t });
}
/* conflict＝読み直して新しい中身で開き直す／読めなければ［読み直す］（読めるまで［保存］は押せない） */
async function conflictReopen(rid, lid) {
  const k = await readOne(rid);
  const lg = k === 'ok' ? curLeague(rid, lid) : null;
  if (k === 'ok' && lg && !lg.voided) {
    openEdit(rid, lid);
    form.msg = { text: errText({ err: 'conflict' }, 'league') }; renderFormMsg(); return;
  }
  if (k === 'ok' || k === 'gone') { form = null; listMsg = { text: errText({ err: 'bad', at: 'league' }, 'league') }; renderList(); return; }
  if (!form) return;
  form.stale = true;
  form.msg = { text: '他の人が先に変えました。読み直せませんでした。', reread: true, rereadFn: () => conflictReopen(rid, lid) };
  renderFormMsg();
}

/* ── ログイン ── */
function relogin(next) {
  showLogin((u) => {
    const same = me && u && u.id === me.id;
    me = u;
    if (same) next(); else start(u);
  });
}
function start(user) {
  me = user;
  form = null;
  loadAll();
}

/* 作る頁の配線（頁の箱は1回だけ作る） */
$('fRank').onclick = (e) => { const b = e.target.closest('button[data-rank]'); if (!b) return; form.rank = b.dataset.rank; renderRank(); };
$('fAlt').onclick = (e) => {
  const b = e.target.closest('button'); if (!b || !form || b.closest('.kp')) return; // 鍵盤の鍵は描き直さない
  readAlt();
  const a = form.alt;
  if (b.id === 'aOn') a.on = !a.on;
  else if (b.dataset.aopen) { a.open.has(b.dataset.aopen) ? a.open.delete(b.dataset.aopen) : a.open.add(b.dataset.aopen); }
  renderAlt();
};
$('fGo').onclick = submit;
$('fAgain').onclick = () => { if (form && form.msg && form.msg.again) form.msg.again(); };
$('fReread').onclick = () => { if (form && form.msg && form.msg.rereadFn) form.msg.rereadFn(); };
$('btnLoginOpen').onclick = () => showLogin(start);

only = new URLSearchParams(location.search).get('room') || null;
show('vLogin');
needLogin(start).catch((e) => { $('vList').hidden = false; $('vList').innerHTML = '<p class="err">止まりました：' + esc(e.message) + '</p>'; });
