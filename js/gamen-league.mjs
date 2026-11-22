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
 * 作らない物：人を外す画面・リーグを取り消すボタン・リーグの対局／卓（D2）・順位表（D3）・［このリーグで対局を始める］。
 */
import { needLogin, showLogin, rpc, errText, sb, $, esc, uuid } from './gamen-core.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';
import { mountRules, RULE_ERR, umaText } from './gamen-rules.mjs';

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
  const d = await rpc('mj_read', { p_room_id: rid, p_what: 'room', p_args: {} });
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

/* ── 合図（2c-2f と同じ管の名・event 'w'）＝受けたらその部屋を読み直す（0.3秒まとめ） ── */
const chans = new Map(); // rid → { key, c, timer }
function joinChan(rid) {
  const x = rooms.get(rid);
  const R = x && x.read && x.read.room;
  const key = R && !R.closed && typeof R.channel_key === 'string' ? R.channel_key : null;
  const cur = chans.get(rid);
  if (cur && cur.key === key) return;
  leaveChan(rid);
  if (!key) return;
  const h = { key, c: null, timer: null };
  chans.set(rid, h);
  try {
    h.c = sb().channel(key, { config: { private: false } });
    h.c.on('broadcast', { event: 'w' }, () => {
      if (chans.get(rid) !== h || h.timer) return;
      h.timer = setTimeout(async () => { h.timer = null; if (chans.get(rid) !== h) return; await readOne(rid); if (!$('vList').hidden) renderList(); }, 300);
    }).subscribe(() => {});
  } catch { /* 合図が使えなくても開いた時の読みはある */ }
}
function leaveChan(rid) {
  const h = chans.get(rid);
  if (!h) return;
  chans.delete(rid);
  clearTimeout(h.timer);
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
    h += '<section class="lg-room" data-room="' + esc(rid) + '"><h3 class="sec">' + esc(roomName(x)) + (closed ? '<small class="lg-owari" data-owari>終わった部屋</small>' : '') + '</h3><div class="list">';
    for (const l of live) {
      const sub = [period(l), playersText(l)].filter(Boolean).join(' ・ ');
      h += '<div class="li lg-row" data-lg="' + esc(l.league_id) + '"><span class="lg-l"><span class="row-name">' + esc(l.name) + '</span><span class="row-sub">' + esc(sub) + '</span></span><span class="lg-btns">';
      if (owner && !closed && l.l !== true) h += '<button class="btn-s" type="button" data-own="' + esc(l.league_id) + '" data-r="' + esc(rid) + '">自分を L にする</button>';
      if (!closed) h += '<button class="btn-s" type="button" data-edit="' + esc(l.league_id) + '" data-r="' + esc(rid) + '"' + (l.l === true ? '' : ' disabled') + '>設定を変える</button>';
      h += '</span></div>';
    }
    const mem = Array.isArray(x.read.st.members) ? x.read.st.members.filter((m) => m && m.active !== false) : [];
    h += '<div class="li"><span>名簿 <b data-nmem>' + mem.length + '</b>人</span><button class="btn-s" type="button" data-roster="' + esc(rid) + '" aria-expanded="' + x.roster + '">名簿を見る</button></div>';
    if (x.roster) h += '<div class="li li-sub" data-names="' + esc(rid) + '"><span class="lg-names">' + mem.map((m) => esc(m.name)).join('・') + '</span></div>';
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
  for (const b of $('vList').querySelectorAll('[data-roster]')) b.onclick = () => { const x = rooms.get(b.dataset.roster); x.roster = !x.roster; renderList(); };
  for (const b of $('vList').querySelectorAll('[data-reread]')) b.onclick = async () => { const k = await readOne(b.dataset.reread); if (k === 'mj_session') relogin(() => loadAll()); renderList(); };
}
function wireMsg(pre, m) {
  if (!m) return;
  const a = $(pre + 'Again'), r = $(pre + 'Reread');
  if (a) a.onclick = () => m.again();
  if (r) r.onclick = () => (m.rereadFn ? m.rereadFn() : loadAll());
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
  $('fMin').value = String(okInt(v.min_games) ? v.min_games : 10);
  form.rank = v.rank_by || 'pt';
  form.mainN = v.players_main;
  form.alt = { on: !!v.rules_alt, open: new Set(), ...altFrom(v.rules_alt, 7 - v.players_main) };
  form.ctl = mountRules($('fRules'), {
    rules: v.rules, readOnly: false, lockPlayers: f.mode === 'edit', labels: { sec: '打ち方とレート', players: '主の打ち方' },
    onPlayers: (n) => { readAlt(); form.mainN = n; Object.assign(form.alt, altFrom(null, 7 - n)); renderAlt(); },
  });
  $('fGo').textContent = f.mode === 'create' ? 'このルールでリーグを作る' : '保存';
  renderAlt(); renderRank(); renderFormMsg();
}
function openCreate(rid) {
  const p = loadP(rid).create; // 印が在る＝答えが決まっていない＝同じ中身を出して同じ id で送り直す
  const val = p ? p.op : { name: '', date_from: null, date_to: null, rank_by: 'pt', min_games: 10, players_main: 4, rules: { ...defaultRules(4), rate: 100 }, rules_alt: null };
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
    if (a.open.has('ps')) h += '<div class="li li-sub"><span>持ち点</span><input class="box" id="aStart" inputmode="numeric" value="' + bv(a.start_pts) + '" autocomplete="off"></div><div class="li li-sub"><span>返し</span><input class="box" id="aReturn" inputmode="numeric" value="' + bv(a.return_pts) + '" autocomplete="off"></div>';
    h += '<button type="button" class="li" data-aopen="uma"><span>' + nm + 'のウマ</span><span class="li-v">' + esc(umaText(a.uma)) + '<span class="li-ya" aria-hidden="true">›</span></span></button>';
    if (a.open.has('uma')) h += '<div class="li li-sub"><span class="uma-row">' + a.uma.map((u, i) => '<label><small>' + (i + 1) + '位</small><input class="box" data-auma="' + i + '" inputmode="numeric" value="' + bv(u) + '" autocomplete="off"><button type="button" class="uma-pm" data-aumaneg="' + i + '" aria-label="' + (i + 1) + '位のウマの＋−を替える">±</button></label>').join('') + '</span></div>';
  }
  $('fAlt').innerHTML = h;
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
  const min_games = toInt($('fMin').value);
  if (!(okInt(min_games) && min_games >= 0 && min_games <= 9999)) return { err: '規定の半荘数は 0〜9999 の整数です。' };
  return { val: { name, date_from, date_to, rank_by: form.rank, min_games, players_main: chk.rules.players, rules: chk.rules, rules_alt } };
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
    dropP(rid, kind, lid);
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
  const b = e.target.closest('button'); if (!b || !form) return;
  readAlt();
  const a = form.alt;
  if (b.id === 'aOn') a.on = !a.on;
  else if (b.dataset.aopen) { a.open.has(b.dataset.aopen) ? a.open.delete(b.dataset.aopen) : a.open.add(b.dataset.aopen); }
  else if (b.dataset.aumaneg !== undefined) { const i = Number(b.dataset.aumaneg); if (okInt(a.uma[i])) a.uma[i] = -a.uma[i]; }
  renderAlt();
};
$('fGo').onclick = submit;
$('fAgain').onclick = () => { if (form && form.msg && form.msg.again) form.msg.again(); };
$('fReread').onclick = () => { if (form && form.msg && form.msg.rereadFn) form.msg.rereadFn(); };
$('btnLoginOpen').onclick = () => showLogin(start);

only = new URLSearchParams(location.search).get('room') || null;
show('vLogin');
needLogin(start).catch((e) => { $('vList').hidden = false; $('vList').innerHTML = '<p class="err">止まりました：' + esc(e.message) + '</p>'; });
