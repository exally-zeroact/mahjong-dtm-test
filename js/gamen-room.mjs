/* gamen-room.mjs — ★対局の1ページと、その先の画面（直す・人を選ぶ・精算・ルール）★
 * =============================================================================
 * 正の絵（司さんに出した一番新しい版・memory/mahjong_tataki_2026-11-20/）：
 *   対局＝mahjong_nyuryoku4_v122（①表は1回ずつ伸び10回分で止まる・計は下に固定 ②「n回」を押すと直す ③直す画面）
 *   精算＝mahjong_seisan_v153／人を選ぶ＝mahjong_namae_v155／ルール＝mahjong_home_v154 ③
 * mountRoom(el, { me, room, showShare, bar, page })＝showShare が無い（部屋なしの対局）時は［部屋名と URL］を出さない
 *   bar({ back, onBack, title, right, onRight, ten })＝上の帯（‹ 戻る・題・右の字・ten＝［点数］の行き先）を変える
 * ★窓に説明の字を置かない★（司さん 11-20「赤丸の説明いらん」）＝窓は名前・大きい数（pt×レートの点）・チップ／祝儀の行だけ。
 *   チップ・祝儀の「1枚＝」と横の数はレートで換えた点（レートなしの卓は pt）。
 * 状態は lib/room-state.mjs（端末の写し）。押した事は mj_write の op の組にして未送信の並びに積む。
 * 2d（2d_sadame.md v2.1 §3）：WRITE_READY=true＝並びを mj_write へ送り（sendOutbox）、mj_read で読み直して写しを置き換える（sync）。
 *   送りと読みは1つの部屋で1本ずつ（lane）。置き換えは倉庫の st→migrateState→roomGate→並びを先頭から当て直す。
 *   置き換えない時＝st.needs_upload（端末だけの写し・2e まで）／控えが closed で並びが在る（約束③）／先頭に sent_at（送った印）が在り決まっていない。
 *   開催は倉庫で決める（shared は開いた時に作らない・最初の点で mj_read→無ければ [session_add, table_add] を直に送る）。
 * B3b-1（gamen_b3b_sadame.md v4.1）：［ルール］の頁に［部屋を終える］（kan か owner・shared で終えていない部屋だけ）。
 *   送る前に必ず flushMerge(true)→未送信0 の門（頁を出す時・窓を開く時・窓の［部屋を終える］の3回）。印 mj-pending-close:<uid>:<rid>＝同じ op_id で送り直す。
 *   書く口は writeBlocked()＝控えの closed か、印がある間（closing）＝commit・plusMinus・flushMerge の3口で止める。
 *   終えた部屋は読み専（見るだけ）・足し①（closed で未送信が在る）は精算と窓の額を出さない。
 * 2c-2f 合図（2c2f_sadame.md v1.2 §2）：部屋を開いたら控えの channel_key の公開の合図に入る（shared で終えていない部屋だけ）。
 *   送る＝mj_write が ok と read_ver（数）を返したら今の管から {v: read_ver} を1回（SUBSCRIBED の時だけ・待たない・失敗は捨てる）。
 *   受け＝v が since より大きい時だけすぐ sync（読み中・送り中は syncAgain）。読みの始めと始めの間は AIZU_GAP_MS（間が足りない読みは遅らせて必ず読む）。
 *   mj_read の返しの room.channel_key が控えと違えば控えを書き換えて付け直す（roomInfo＝takeRead の門より前）。± のまとめは 0.3秒。
 */
import { emptyState, applyOps, tableView, chainView, tableChain, needOf, WHO, sessionSeisan, sessionBreakdown, tenChanged, tableRate, rateModeOf, checkEntry, pickSession, sessionSig, migrateState, roomGate, gateText, orderIdx, canon, OPS_MAX, CELL_MAX, LOST_MAX } from '../lib/room-state.mjs';
import { heldInfo, outboxStep, retryDelay, holdHead, dropHead, canSend, heldClosed, aizuSendV, aizuReadV, AIZU_GAP_MS } from '../lib/outbox.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';
import { nameKey } from '../lib/name-key.mjs';
import { esc, uuid, sb, patchRoom, rpc, errText } from './gamen-core.mjs';
import { mountRules, RULE_ERR } from './gamen-rules.mjs';
import { rulesOk } from '../lib/rules.mjs';

const WRITE_READY = true; // 2d：倉庫の mj_read が入った（送る所は sendOutbox・直に送るのは開催の始めの startShared だけ）
const KEY = (uid, rid) => 'mj-room:' + uid + ':' + rid;
const OUT = (uid, rid) => 'mj-outbox:' + uid + ':' + rid;
// 2d の印：この端末の写しが倉庫から読んだ物（か作った時の空）＝無くて写しか並びが在れば 2d より前の端末だけの物＝needs_upload（2d §3）
const SYNCED = (uid, rid) => 'mj-synced:' + uid + ':' + rid;
export function markSynced(uid, rid) { try { localStorage.setItem(SYNCED(uid, rid), '1'); } catch { /* 書けなくても次の読みで付く */ } }
const POLL_MS = 10000;               // 読み直し（頁が見えている間だけ）
const STALE_MS = 30000;              // 最後に倉庫の物を入れてからこれを越えたら「最新を読めていません」
const SENT_MAX_MS = 6 * 24 * 3600e3; // op_results は7日で掃除（schema.sql:1162）＝送った印から6日を越えた未決の先頭は送らずに held stale
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/* mj_read を直に呼ぶ（gamen-core の rpc() は data だけで error・status を落とす＝約束⑤と同じ形）。返し＝{data,error,status} か {error} */
export async function readRoom(rid, since) {
  try {
    return await sb().rpc('mj_read', { p_room_id: rid, p_what: 'room', p_args: since === null || since === undefined ? {} : { since } });
  } catch (e) { return { error: { message: String((e && e.message) || e) } }; }
}
let unmountPrev = null; // 開き直した時に前の部屋の読み・送り・時計を止める
/* 開いている部屋を閉じる（読み・送り・時計・合図を止める）＝別の部屋へ移る時（gamen-taikyoku の openRoom の頭・2c-2f） */
export function leaveRoom() { if (unmountPrev) { const u = unmountPrev; unmountPrev = null; u(); } }
const NAMES = (uid) => 'mj-names:' + uid;
// 前の版の卓の人の控え（この端末だけ）。B1（b1_sadame_v2.md v2.1）から卓の席の正本は倉庫の t.seats（op table_seats）＝★もう書かない・開いたら消す★
const SEATS = (uid, rid) => 'mj-seats:' + uid + ':' + rid;

// 素点の差は + を付けない（司さん 11-21 夜「点を入れるところに＋なんかいるか？」）＝「1,000 多い／少ない」
const diffText = (d) => Math.abs(d).toLocaleString('ja-JP') + (d > 0 ? ' 多い' : ' 少ない');
const fmt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP');
const fmtPt = (pt10) => (pt10 > 0 ? '+' : pt10 < 0 ? '−' : '') + (Math.abs(pt10) / 10).toFixed(1);
const fmtCnt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
const sign = (n) => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');
const md = (d) => (d ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');
const hm = (iso) => { const d = new Date(iso); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// 点の箱に出す字（−は全角に揃える・コンサル 11-21 夜「合計の行は −・欄の薄い字は -」）＝toInt は − も読む
const boxNum = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP');
const toInt = (s) => { const t = String(s).replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^[−ー－]/, '-'); return /^-?\d+$/.test(t) ? Number(t) : NaN; };

function load(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? def : v; } catch { return def; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
/* 閉じる時に1秒まとめ（extra_add）を流す＝今開いている部屋の1つだけ（開き直しで古い部屋の物を呼ばない） */
let flushNow = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (flushNow) flushNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && flushNow) flushNow(); });
}

export function mountRoom(el, { me, room, showShare, bar, page: first, relogin, note, closedObi, reopen }) {
  leaveRoom();
  const uid = me.id, rid = room.room_id;
  // 古い形の写し（st.v が 2 でない）は形だけ直す（値は変えない・needs_upload＝倉庫へ上げるのは 2d）。
  // 直した時は古い並び（古い形の op）を捨て、★並びを先に保存してから写しを保存★（途中で落ちても次に開けば同じ直しになる）
  // ③-0 の門（yakitori_custom_v1.md v7〜v7.3）：gate が ok でない部屋は帯だけ出して return＝表・入れる所を1つも作らない・並びも積まない・保存しない
  const mig = migrateState(load(KEY(uid, rid), emptyState()));
  const gateOnly = (g) => {
    bar({ back: 'ホーム', title: '対局' });
    el.innerHTML = '<div class="r-red" id="rGate"><b>' + esc(gateText(g)) + '</b></div>';
  };
  if (mig.gate.mode !== 'ok') { gateOnly(mig.gate); return; }
  let st = mig.st;
  if (!st.settles) st.settles = [];
  let outbox = mig.migrated ? [] : load(OUT(uid, rid), []);
  if (mig.migrated) { save(OUT(uid, rid), outbox); save(KEY(uid, rid), st); }
  let page = first || 'room'; // room | edit | pick | seisan | rules
  let entry = null;
  let picking = null;
  let viewSnap = false;
  let confirming = false; // 入っていない物があるまま終える時の確かめ（開いている画面の間だけ）
  let closeErr = null;    // 対局終了を残せなかった時の err
  let pmErr = null;       // チップ等の［−］［＋］が弾かれた時の字（黙らない・v1.1）
  let ruleNote = null;    // C4 §3：開いていた卓が区切られて鎖の最後へ移った時の帯（次に書くまで出す）
  let ruleMsg = null;     // C4 §2：［次の回からこのルールにする］が通らなかった時の帯（ルールの頁）
  let ruleCtl = null;     // ルールの頁の打てる形（読み直しで描き直す時に打ちかけを残す）
  let ruleBusy = false, ruleOp = null, pendingRule = null; // table_rules の直送（返りが切れた時は同じ op_id）・並びを送り切ってから送る続き
  const cn = (x) => canon(JSON.parse(JSON.stringify(x === undefined ? null : x))); // JSON を通してから鍵の順に左右されない字（倉庫の jsonb を回っても同じ・v4.3）
  const merge = new Map(); let mergeTimer = null; // extra_add のまとめ（最後に押してから 0.3秒・2c-2f で 1秒→0.3秒）
  let fixing = null;      // C4 §3b：精算の内訳で［直す］を開いている前の卓の枚 { t, m, kind }
  const toRoom = () => { page = 'room'; entry = null; picking = null; viewSnap = false; confirming = false; closeErr = null; pmErr = null; fixing = null; ruleCtl = null; ruleMsg = null; render(); };

  if (!room.rules) {
    bar({ back: 'ホーム', title: '対局' });
    el.innerHTML = '<p class="setsumei">この部屋のルールはまだこの端末に届いていません（倉庫の読み口ができたら出ます）。</p>' +
      (showShare ? '<button class="btn" id="rShare">部屋名と URL</button>' : '');
    if (showShare) el.querySelector('#rShare').onclick = showShare;
    return;
  }
  const g2 = roomGate(st, room.rules); // room.rules が入った後に部屋の rules も見る
  if (g2.mode !== 'ok') { gateOnly(g2); return; }
  try { localStorage.removeItem(SEATS(uid, rid)); } catch { /* 消せなくても使わない */ }
  st.rules = room.rules; // 卓を作る時のルール（op では送らない＝倉庫は開催日のルールを使う・§3 table_add）
  const shared = room.kind !== 'solo'; // 古い控えは kind 無し＝shared
  // ★2d より前の写しと並び（v1.1 naoshi の止め）★：印が無く、写しに人か開催が在るか並びが空でない＝端末だけの物＝needs_upload（送らない・置き換えない・2e で上げる）
  if (WRITE_READY && !localStorage.getItem(SYNCED(uid, rid)) && !st.needs_upload && (st.members.length || st.sessions.length || outbox.length)) {
    st.needs_upload = true; save(KEY(uid, rid), st);
  }

  // ── 送りと読み（2d §3）──
  let lane = false;        // 送りと読みは1本ずつ（送り中に次の送り・読みを始めない）
  let dead = false;        // 開き直した・頁を替えた（前の返しを捨てる）
  let mounted = false;     // 開き終えるまで送らない（開いた時の ensureTable の commit は開き終えた後の sync→kick で送る）
  let stopped = null;      // 'login'｜'gone'＝送りと読みを止める
  let loginErr = null;     // 'mj_session'｜'mj_reauth'
  let retryN = 0, retryTimer = null;
  let since = null;        // 写しを置き換えた時の read_ver（置き換えた時だけ進める）
  let lastIn = Date.now(); // 最後に倉庫の物を写しに入れた時（置き換えた時か same の時だけ）
  let gateNote = null;     // 読んだ st が newer・rules_bad の時の帯（置き換えない）
  let startMsg = null;     // 開催を始められなかった時の字
  let startOp = null;      // 開催の直送の op_id（返りが切れた時に同じ op_id で送り直す）
  let pendingStart = null; // 並びを送り切ってから始める続き
  let shownTag = null;
  let syncAgain = false;   // 送り・読みの最中に頼まれた読み直し（1本が終わったら読む）
  // ── 2c-2f 合図（2c2f_sadame v1.2 §2）：合図は読む切っ掛けを足すだけ（10秒の読み・見えた時・online・開いた時・30秒の札はそのまま） ──
  let chan = null, chanUp = false;       // 今入っている合図の管と、それが SUBSCRIBED か
  let lastReadAt = 0, gapTimer = null;   // 読みの始め（始めと始めの間を AIZU_GAP_MS 空ける・間が足りない読みは捨てずに遅らせる）
  function joinChan() {
    leaveChan();
    const key = room.channel_key;
    if (dead || !shared || room.closed || typeof key !== 'string' || !key) return; // 部屋なし（solo）・終えた部屋・名を知らない（一覧から入った＝最初の mj_read の後）は入らない
    let c = null;
    try {
      c = sb().channel(key, { config: { private: false } });
      chan = c;
      c.on('broadcast', { event: 'w' }, (m) => { if (chan === c) aizuIn(m && m.payload); })
        .subscribe((s) => { if (chan === c) chanUp = s === 'SUBSCRIBED'; });
    } catch { if (chan === c) { chan = null; chanUp = false; } } // 合図が使えなくても10秒の読みが控え
  }
  function leaveChan() {
    const c = chan; chan = null; chanUp = false;
    if (!c) return;
    try { const p = sb().removeChannel(c); if (p && p.catch) p.catch(() => {}); } catch { /* 外せなくても chan===c でない＝受けても読まない */ }
  }
  // mj_write の返し（data）が ok で read_ver が数の時だけ、今の管から1回（★SUBSCRIBED でない時は送らない＝httpSend にしない★・待たない・失敗は黙って捨てる）
  function aizuOut(d) {
    const v = aizuSendV(d);
    if (v === null || !chan || !chanUp) return;
    try { const p = chan.send({ type: 'broadcast', event: 'w', payload: { v } }); if (p && p.catch) p.catch(() => {}); } catch { /* 倉庫の送りと10秒の読みが控え */ }
  }
  // 受け＝v が since より大きい時だけすぐ読む（★v は since に入れない★）
  function aizuIn(payload) {
    if (dead || stopped || aizuReadV(payload, since) === null) return;
    sync();
  }
  // 約束③・足し①（held は見ない）。merge＝1秒まとめに残った ±（閉じた部屋では flushMerge が積まない＝写しにだけ在る）も未送信に数える
  const closedHold = () => !!room.closed && (outbox.length > 0 || merge.size > 0 || !!st.needs_upload);
  // ── B3b-1 部屋を終える：印が在る間はずっと closing（網切れ・［もう一度］・ログインし直し・読み込み直しの後も・v4 止め2） ──
  const PCLOSE = 'mj-pending-close:' + uid + ':' + rid;
  const closingOn = () => { try { return !!localStorage.getItem(PCLOSE); } catch { return false; } };
  const writeBlocked = () => !!room.closed || closingOn();
  const blockRes = () => ({ ok: false, err: room.closed ? 'closed' : 'closing' });
  let closeUi = { open: closingOn(), msg: null, retry: false }; // 印が在れば確かめの窓を開いたまま（同じ op_id で送り直せる）
  let closeBusy = false;
  const staleRead = () => WRITE_READY && !stopped && !st.needs_upload && !closedHold() && Date.now() - lastIn > STALE_MS;

  function commit(ops) {
    if (writeBlocked()) return blockRes(); // ★flushMerge より前で判じる★（終えた部屋・終える送りの最中は写し・merge・並びのどれも変えない）
    flushMerge(true); // 1秒まとめを先に並べる（並びの順＝押した順）
    const r = applyOps(st, ops, { now: new Date().toISOString(), roomRules: room.rules });
    if (!r.ok) return r.res;
    st = r.state;
    // needs_upload の部屋（古い写しを直した部屋）は写しが唯一の元＝並びに積まない（2d が写しから作る）
    if (!st.needs_upload) { outbox.push({ op_id: uuid(), ops }); save(OUT(uid, rid), outbox); }
    save(KEY(uid, rid), st); // ★並びを先・写しを後★
    ruleNote = null;
    sendOutbox();
    return { ok: true };
  }
  /* 控えに部屋の rules・closed を足す（★行だけ書き換える＝ホームの並びと at を変えない★・約束④⑦） */
  function roomInfo(r) {
    if (!r || typeof r !== 'object') return;
    const patch = {};
    if (r.rules && typeof r.rules === 'object' && cn(r.rules) !== cn(room.rules)) patch.rules = r.rules;
    if (r.closed === true && !room.closed) patch.closed = true;
    if (typeof r.channel_key === 'string' && r.channel_key && r.channel_key !== room.channel_key) patch.channel_key = r.channel_key; // 2c-2f：名が変わった（room_secret など）＝控えを書き換えて付け直す
    if (!Object.keys(patch).length) return;
    Object.assign(room, patch);
    patchRoom(uid, rid, patch);
    st.rules = room.rules;
    if (patch.closed) { try { localStorage.removeItem(PCLOSE); } catch { /* 読めなくても closed が勝つ */ } if (!table && !closedHold()) setTable(closedTable()); } // 終わった＝終える送りの印は要らない
    if ((patch.channel_key || patch.closed) && mounted) joinChan(); // 2c-2f：新しい名へ付け直す（古い名は外す）・終えた部屋は外すだけ
  }
  function loginStop(err) { stopped = 'login'; loginErr = err || 'mj_session'; clearTimeout(retryTimer); rerender(); }
  function goneStop() { stopped = 'gone'; clearTimeout(retryTimer); leaveChan(); rerender(); }
  // 置き換えた後に描くのは room・seisan・rules の頁だけ（edit・pick は入れ物・focus・打ちかけを壊さない＝出る時に描く・v2 止め2）
  function rerender() { if (!dead && ['room', 'seisan', 'rules'].includes(page)) render(); }
  function tagKey() { return [liveTag(), staleRead(), stopped, gateNote, startMsg, outbox.length, heldInfo(outbox) && heldInfo(outbox).why, !!room.closed, closingOn(), closeBusy].join('|'); }
  function refreshTag() { if (!dead && tagKey() !== shownTag) rerender(); }

  /* 送り（約束⑤＝sb().rpc を直に呼び {data,error,status} を outboxStep へ） */
  async function sendOutbox() {
    if (!WRITE_READY || !mounted || dead || stopped || lane || st.needs_upload) return;
    if (closedHold()) return; // 控えが closed で並びが在る＝送らない（倉庫は bad closed で返す・B3b-1 §0 止め3）
    if (!canSend(outbox)) return;
    if (offline()) return; // 'online' を待つ（先回りはここ・outboxStep は返しの判じだけ）
    let head = outbox[0];
    if (head.sent_at && Date.now() - Date.parse(head.sent_at) > SENT_MAX_MS) {
      outbox = holdHead(outbox, 'stale'); save(OUT(uid, rid), outbox); refreshTag(); return; // 倉庫に入ったか確かめられない＝自動で送り直さない
    }
    if (!head.sent_at) { head = { ...head, sent_at: new Date().toISOString() }; outbox = [head, ...outbox.slice(1)]; save(OUT(uid, rid), outbox); } // ★送った印を先に保存★（v1 止め1）
    lane = true;
    let res;
    try { res = await sb().rpc('mj_write', { p_room_id: rid, p_op_id: head.op_id, p_ops: head.ops }); }
    catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
    lane = false;
    if (dead) return;
    aizuOut(res && res.data); // 2c-2f：ok と read_ver ならその場で合図（待たない）
    if (!outbox.length || outbox[0].op_id !== head.op_id) { kick(); return; }
    const s = outboxStep(res);
    if (s.kind !== 'retry') { retryN = 0; clearTimeout(retryTimer); }
    if (s.kind === 'done') {
      outbox = outbox.slice(1); save(OUT(uid, rid), outbox);
      refreshTag();
      if (outbox.length) { sendOutbox(); return; }
      if (pendingStart || pendingRule) { kick(); return; }
      sync(); return; // 送りで並びが空になった時に読み直す
    }
    if (s.kind === 'retry') { clearTimeout(retryTimer); retryTimer = setTimeout(() => sendOutbox(), retryDelay(retryN++)); refreshTag(); return; }
    if (s.kind === 'login') { loginStop(s.err); return; }
    if (s.kind === 'reload') { goneStop(); return; }
    if (s.kind === 'closed') { // 足し①：黙って捨てない＝その組と後ろは並びに残し（送り直さない）、写しもそのまま。控えに closed
      outbox = holdHead(outbox, 'closed'); save(OUT(uid, rid), outbox);
      roomInfo({ closed: true }); pendingStart = null; rerender(); return;
    }
    outbox = [{ ...outbox[0], held: { err: s.err, ...(s.at !== undefined ? { at: s.at } : {}) } }, ...outbox.slice(1)]; // conflict・stop＝先頭で止める（後ろは送らない）
    save(OUT(uid, rid), outbox);
    pendingStart = null; startMsg = null;
    rerender();
  }
  function kick() {
    if (dead || lane) return;
    if (syncAgain && !stopped) { syncAgain = false; if (sync()) return; } // sync の終わりでまた kick される（読みの間が足りず遅らせた時は送りを先に）
    if (pendingStart) {
      if (heldInfo(outbox) || stopped) { pendingStart = null; startMsg = null; rerender(); return; }
      if (!outbox.length && !merge.size) { const t = pendingStart; pendingStart = null; startShared(t); return; }
    }
    if (pendingRule) { // C4：並びを送り切ってから table_rules
      if (heldInfo(outbox) || stopped) { pendingRule = null; ruleMsg = null; rerender(); }
      else if (!outbox.length && !merge.size) { const r = pendingRule; pendingRule = null; ruleMsg = null; sendRules(r); return; }
    }
    sendOutbox();
  }

  /* 読みの返しを写しへ（返し＝'ok' 置き換えた｜'same'｜'skip' 読めたが置き換えない｜'fail'｜'login'｜'gone'） */
  function takeRead(res) {
    if (!res || typeof res !== 'object') return 'fail';
    if (res.error) { if (outboxStep(res).kind === 'login') { loginStop('mj_session'); return 'login'; } return 'fail'; }
    const d = res.data;
    if (!d || typeof d !== 'object' || typeof d.ok !== 'boolean') return 'fail';
    if (!d.ok) {
      if (d.err === 'mj_session') { loginStop('mj_session'); return 'login'; }
      if (d.err === 'gone') { goneStop(); return 'gone'; }
      return 'fail';
    }
    if (d.same) { lastIn = Date.now(); return 'same'; }
    roomInfo(d.room); // ★closed は写しを置き換える前に控えへ（約束⑦）・rules も控えへ（約束④）
    if (st.needs_upload) return 'skip';              // 端末だけの写し＝2e まで倉庫の物で上書きしない
    if (closedHold()) return 'skip';                 // 約束③
    flushMerge(true, true);                          // 1秒まとめを並びに入れてから（置き換えで ± が消えない）
    if (closedHold()) return 'skip';
    if (outbox.length && outbox[0].sent_at && !outbox[0].held) return 'skip'; // 送った印が決まるまで置き換えない（先に同じ op_id で送り直す）
    const m = migrateState(d.st, room.rules);
    if (m.gate.mode !== 'ok') { gateNote = gateText(m.gate); return 'skip'; } // newer・rules_bad＝置き換えず帯
    gateNote = null;
    const base = m.st;
    if (!base.settles) base.settles = [];
    base.rules = room.rules;
    delete base.needs_upload;
    // 並びを先頭から当て直す。当たらない組はその組を held（err＝その返し）にして後ろは当てずに残す。止めてある組（held）から後ろも当てない
    let cur = base, stop = false;
    const nb = [];
    for (const it0 of outbox) {
      const it = { ...it0 };
      delete it.held_after_drop; // 当て直しを通った＝外す（止めた組が在れば先頭まで来た時にそこで止まる）
      if (!stop && it.held) stop = true;
      if (!stop) {
        const r = applyOps(cur, it.ops, { now: new Date().toISOString(), roomRules: room.rules });
        if (r.ok) cur = r.state;
        else { it.held = { err: r.res.err, ...(r.res.at !== undefined ? { at: r.res.at } : {}) }; stop = true; }
      }
      nb.push(it);
    }
    outbox = nb; st = cur;
    save(OUT(uid, rid), outbox); save(KEY(uid, rid), st); // ★並びを先・写しを後★
    since = typeof d.read_ver === 'number' ? d.read_ver : null;
    lastIn = Date.now();
    markSynced(uid, rid);
    repick();
    return 'ok';
  }
  // 読み直しを頼む。返し＝今読み始めたか（false＝止まっている・1本の最中＝syncAgain・網が無い・間が足りず遅らせた）
  function sync() {
    if (!WRITE_READY || dead || stopped) return false;
    if (lane) { syncAgain = true; return false; }
    if (offline()) { refreshTag(); return false; }
    const wait = lastReadAt + AIZU_GAP_MS - Date.now(); // 2c-2f 連打の守り：読みの始めと始めの間を空ける（★捨てずに遅らせて必ず1回読む★）
    if (wait > 0) { if (!gapTimer) gapTimer = setTimeout(() => { gapTimer = null; sync(); }, wait); return false; }
    readNow();
    return true;
  }
  async function readNow() {
    lane = true; syncAgain = false; lastReadAt = Date.now(); // 今から読む＝これより前の頼みはこの読みで足りる
    const res = await readRoom(rid, since);
    lane = false;
    if (dead) return;
    const k = takeRead(res);
    if (k === 'ok') rerender(); else refreshTag();
    kick();
  }

  /* ── 卓を決める ── */
  let table = null, R = room.rules, n = R.players, kieru = false;
  // C4 §3：卓を選ぶ所（ensureTable・repick・closedTable・startShared）は★鎖の最後の卓★（区切った前の卓は回を直す時だけ・回の卓のまま）
  const chainLast = (t) => { if (!t) return null; const ch = tableChain(st, t.table_id); return st.tables.find((x) => x.table_id === ch[ch.length - 1]) || t; };
  function setTable(t) { table = chainLast(t); R = table ? table.rules : room.rules; n = R.players; kieru = R.kyotaku_end === 'kieru'; }
  // 鎖の中で最後の卓より前の回の数（通し番号）＝帯「n回目まで前のルール」の n
  const uptoOf = (v) => (v.splits.length ? v.splits[v.splits.length - 1].upto : 0);
  const ruleChangedText = (v) => { const k = uptoOf(v); return k > 0 ? 'ルールが変わりました（' + k + '回目まで前のルール）' : 'ルールが変わりました'; };
  // 終えた部屋の卓＝最後の開催（取り消していない最後）の最初の卓（取り消していない卓を先に）＝続きの開催が無くても見せる（B3b-1 §3 止め1）
  function closedTable() {
    const ss = st.sessions.filter((s) => !s.voided);
    const last = ss[ss.length - 1];
    if (!last) return null;
    const ts = st.tables.filter((t) => t.session_id === last.session_id);
    return ts.find((t) => !t.voided) || ts[0] || null;
  }
  function ensureTable() {
    if (room.closed) return closedTable(); // ★終えた部屋は何も作らない★
    const sid0 = pickSession(st); // 区切りは［対局終了］を押した時だけ（時間・日付で決めない・司さん 11-20）
    const t0 = sid0 && st.tables.find((t) => t.session_id === sid0);
    if (t0) return t0;
    if (shared && !st.needs_upload) return null; // ★開催は倉庫で決める（v1 止め2）＝shared は開いた時に何も作らない（最初の点で startShared）
    const sid = uuid(), tid = uuid();
    commit([
      { op: 'session_add', session_id: sid, date: today(), rate: room.rules.rate },
      { op: 'table_add', table_id: tid, session_id: sid, label: '卓1' },
    ]);
    return st.tables.find((t) => t.table_id === tid);
  }
  // 置き換えのたびに開催と卓を決め直す（続きの開催が無くなった時は今の卓が写しに在ればそのまま見せる＝終えた対局を開き直すまで見せる今の動き）
  function repick() {
    const was = table && table.table_id;
    pick0();
    // C4 §3：開いていた卓が読み直しで区切られた（鎖の最後が替わった）＝鎖の最後へ移って帯
    if (was && table && table.table_id !== was && tableChain(st, table.table_id).includes(was)) ruleNote = ruleChangedText(chainView(st, table.table_id));
  }
  function pick0() {
    if (room.closed) { setTable(closedTable()); return; }
    const sid = pickSession(st);
    const t = sid && st.tables.find((x) => x.session_id === sid);
    if (t) { setTable(t); return; }
    setTable(table ? st.tables.find((x) => x.table_id === table.table_id) : null);
  }
  /* 最初の点（窓の ± ・［n回目の点を入れる］・卓の席）の前に卓を決める */
  function needTable(then) {
    if (table) { then(); return; }
    if (!shared || st.needs_upload) { setTable(ensureTable()); if (table) then(); return; }
    startShared(then);
  }
  /* shared：mj_read で続きの開催を探し、無ければ [session_add, table_add] を並びを通さず直に送る（★並びが空の時だけ★） */
  async function startShared(then) {
    if (dead || stopped || writeBlocked()) return;
    if (heldInfo(outbox)) { startMsg = null; render(); return; } // 止まっている間は始めない（今の held の帯）
    if (outbox.length || merge.size) { flushMerge(true, true); pendingStart = then; startMsg = '前に入れた点を送っています。送れたら始めます。'; render(); kick(); return; }
    if (offline()) { startMsg = '電波がつながってから始められます。'; render(); return; }
    if (lane) { pendingStart = then; return; }
    lane = true; startMsg = null;
    let fail = null;
    try {
      const k = takeRead(await readRoom(rid, null));
      if (dead || k === 'login' || k === 'gone') return;
      if (!table && k !== 'ok') fail = '電波がつながってから始められます。';
      if (!table && !fail) {
        const ids = startOp || (startOp = { op_id: uuid(), sid: uuid(), tid: uuid(), date: today() });
        const ops = [
          { op: 'session_add', session_id: ids.sid, date: ids.date, rate: room.rules.rate },
          { op: 'table_add', table_id: ids.tid, session_id: ids.sid, label: '卓1' },
        ];
        let res;
        try { res = await sb().rpc('mj_write', { p_room_id: rid, p_op_id: ids.op_id, p_ops: ops }); }
        catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
        if (dead) return;
        const d = res && res.data;
        if (d && d.ok === false && d.err === 'dup' && d.what === 'session') {
          // 他の端末が先に始めた＝読み直してその開催の最初の卓を使う
          startOp = null;
          const k2 = takeRead(await readRoom(rid, null));
          if (dead || k2 === 'login' || k2 === 'gone') return;
          if (!table && d.session_id) setTable(st.tables.find((t) => t.session_id === d.session_id) || null);
          if (!table) fail = '始められませんでした。もう一度押してください。';
        } else {
          const s = outboxStep(res);
          if (s.kind === 'done') {
            aizuOut(d); // 2c-2f
            startOp = null;
            const a = applyOps(st, ops, { now: new Date().toISOString(), roomRules: room.rules });
            if (a.ok) { st = a.state; save(KEY(uid, rid), st); }
            setTable(st.tables.find((t) => t.table_id === ids.tid) || null);
            if (!table) fail = '始められませんでした。もう一度押してください。';
          } else if (s.kind === 'login') { loginStop(s.err); return; }
          else if (s.kind === 'reload') { goneStop(); return; }
          else if (s.kind === 'closed') { roomInfo({ closed: true }); startOp = null; fail = 'この部屋は終わりました。'; }
          else if (s.kind === 'retry') fail = 'つながりませんでした。電波を確かめてもう一度押してください。'; // startOp は残す＝次も同じ op_id
          else { startOp = null; fail = '始められませんでした（' + s.err + '）。'; }
        }
      }
    } finally { lane = false; }
    if (dead) return;
    startMsg = fail;
    if (table && !fail) { then(); kick(); return; }
    render(); kick();
  }
  setTable(ensureTable());

  const nameOf = (mid) => (st.members.find((m) => m.member_id === mid) || {}).name || '?';
  const rateText = (rate) => (rate === null || rate === undefined ? 'レートなし' : '1pt＝' + rate.toLocaleString('ja-JP'));
  const liveTag = () => {
    if (closedHold()) return '<span class="r-live ng">● 送れていない点があります・部屋が終わっています</span>';
    if (st.needs_upload) return '<span class="r-live ng">● この端末だけ（まだ送っていない）</span>';
    if (heldInfo(outbox)) return '<span class="r-live ng">● 未送信 ' + outbox.length + '・止まっています</span>';
    if (staleRead()) return '<span class="r-live ng">● 最新を読めていません' + (outbox.length ? '・未送信 ' + outbox.length : '') + '</span>';
    return outbox.length ? '<span class="r-live ng">● 未送信 ' + outbox.length + '</span>' : '';
  };
  const HELD_WHY = { conflict: '他の端末が先に直しました', dup: '同じ名前の人がもういます', range: '範囲の外です', server: '倉庫で止まりました', full: '部屋がいっぱいです', mj_role: 'この役ではできません' };
  /* 帯（頁の上）＝足し①・消えた部屋・ログイン・止まった並び・読んだ st の門・始められなかった字 */
  function bandsHtml() {
    let h = '';
    if (closedHold()) h += '<div class="r-red" id="rClosed"><b>この部屋は終わりました。この端末で入れた点のうち、まだ送れていない分が部屋に入っていません。この端末では見られます。</b></div>';
    if (stopped === 'gone') h += '<div class="r-red" id="rGone"><b>この部屋は消されているか、入れなくなりました。</b></div>';
    if (stopped === 'login') h += '<div class="r-red" id="rLogin"><b>' + (loginErr === 'mj_reauth' ? 'ログインし直してから送ります。' : 'ログインが切れました。ログインし直してください。') + '</b>' + (relogin ? '<button class="btn btn-main" id="rRelogin">ログインし直す</button>' : '') + '</div>';
    const hi = !st.needs_upload && !closedHold() ? heldInfo(outbox) : null;
    if (hi && !heldClosed(outbox)) {
      if (hi.why === 'after_drop') h += '<div class="r-red" id="rHeld"><b>未送信 ' + hi.n + ' 件・部屋を読み直してから送ります</b></div>';
      else if (hi.why === 'stale') h += '<div class="r-red" id="rHeld"><b>この端末の点が部屋に入ったか確かめられません。</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      // C4 §3 T3：鍵が違う区切りの後の extra_add（倉庫が bad at table_id）＝前のルールで押した枚を新しい単価で数えない
      else if (hi.why === 'bad' && outbox[0].held.at === 'table_id' && outbox[0].ops.some((o) => o.op === 'extra_add')) h += '<div class="r-red" id="rHeld"><b>ルールが変わりました。チップ等を入れ直してください</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      else h += '<div class="r-red" id="rHeld"><b>未送信 ' + hi.n + ' 件・この書き込みは入れられません（' + esc(HELD_WHY[hi.why] || hi.why) + '）</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
    }
    if (gateNote) h += '<div class="r-red" id="rGateNote"><b>' + esc(gateNote) + '</b></div>';
    if (ruleNote && page === 'room') h += '<div class="r-red" id="rRuleNote"><b>' + esc(ruleNote) + '</b></div>';
    if (startMsg) h += '<p class="r-check bad" id="rStartMsg">' + esc(startMsg) + '</p>';
    return h;
  }
  const staleHtml = () => (staleRead() ? '<p class="r-check bad" id="rStale">最新を読めていないので、他の端末の点が入っていないかもしれません。</p>' : '');
  function wireBands() {
    const q = (s) => el.querySelector(s);
    if (q('#rDrop')) q('#rDrop').onclick = () => { outbox = dropHead(outbox); save(OUT(uid, rid), outbox); since = null; rerender(); sync(); }; // 後ろは held_after_drop＝読み直しで当て直してから送る（捨てた組は写しに当たっている＝since を戻して必ず置き換える）
    if (q('#rRelogin')) q('#rRelogin').onclick = () => relogin(() => { if (dead) return; stopped = null; loginErr = null; rerender(); kick(); sync(); });
  }

  function render() {
    // 終えた部屋の頁は room・seisan・rules だけ（他に居たら room へ・B3b-1 §3）
    if (room.closed && !['room', 'seisan', 'rules'].includes(page)) { page = 'room'; entry = null; picking = null; }
    if (closedObi) closedObi(!!room.closed && !closedHold()); // 足し①の帯が出る時は「見ることはできます」の帯を外す（帯は1枚）
    if (page === 'edit') return renderEdit();
    if (page === 'pick') return renderPick();
    if (page === 'seisan') return renderSeisan();
    if (page === 'rules') return renderRules();
    // ［点数］＝点数計算（記録しない道具・tensu.html）へ。卓のルールを ?r= に、戻り先を ?from= に渡す（tensu.js の頭の取り決め）
    const ten = '/tensu.html?r=' + encodeURIComponent(JSON.stringify(room.rules)) + '&from=' + encodeURIComponent(location.pathname + location.search);
    bar({ back: 'ホーム', title: '対局', right: 'ルール', onRight: () => { page = 'rules'; render(); }, ten });
    // 卓がまだ無い（shared で開催を倉庫で決める前）＝部屋のルールで空の表だけ出す（最初の点で startShared）
    const noteHtml = note ? '<p class="r-check bad" id="rCloseNote">' + esc(note) + '</p>' : '';
    // 終えた部屋に開催が1つも無い＝中身の字だけ（卓を触らない・B3b-1 §3 止め1）
    if (room.closed && !table) { shownTag = tagKey(); el.innerHTML = bandsHtml() + noteHtml + '<p class="setsumei" id="rEmpty">この部屋は終わりました。中身はありません。</p>'; wireBands(); return; }
    const v = table ? chainView(st, table.table_id) : { date: today(), rate: room.rules.rate ?? null, rows: [], nextNo: 1, windows: [], seatPeople: [], parts: [] }; // C4 §5a：鎖で1つ
    shownTag = tagKey();
    let h = '<div class="r-top"><span>' + esc(md(v.date)) + '・' + rateText(v.rate) + '</span>' + liveTag() + '</div>' + bandsHtml() + noteHtml;
    h += v.rows.length ? renderTable(v) : renderHead(preSeats());
    // 終えた部屋は［n回目の点を入れる］を出さない・終える送りの最中（closing）は押せない形
    if (!room.closed) h += '<button class="btn btn-main r-add" id="rAdd"' + (closingOn() ? ' disabled' : '') + '>' + v.nextNo + '回目の点を入れる</button>';
    h += staleHtml(); // 窓の上（2d §3 読めない時）
    // B1：席だけの卓（行がまだ無い）も窓と ± を出す＝並べは seatWin（画面だけ）。✓ と［精算を見る］は今まで通り windows が在る時だけ
    if (v.windows.length || v.seatPeople.length) h += renderWindows(v);
    if (v.windows.length) h += renderCheck(v) + (pmErr ? '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>' : '') + '<button class="btn btn-line" id="rSeisan">精算を見る（誰が誰に）</button>';
    else if (pmErr) h += '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>';
    el.innerHTML = h;
    const wrap = el.querySelector('.r-hyou-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    wireRoom(); wireBands();
  }

  // 0回目（行が0）の表の頭＝卓の人が在れば名前の列・無ければ［＋名前］×n。押すと人を選ぶ（決めるだけ・点の画面へは行かない）
  function renderHead(ps) {
    const off = room.closed ? ' disabled' : ''; // 終えた部屋は卓の席を決めない（人を選ぶ頁へ行かない）
    const cells = ps ? ps.map((m) => '<th><button type="button" class="r-nm" data-seats="1"' + off + ' aria-label="' + esc(nameOf(m)) + '・人を選び直す">' + esc(nameOf(m)) + '</button></th>')
      : Array.from({ length: n }, () => '<th><button type="button" class="r-nm r-nm-add" data-seats="1"' + off + '>＋名前</button></th>');
    return '<div class="r-hyou-wrap"><table class="r-hyou"><thead><tr><th></th>' + cells.join('') + '</tr></thead></table></div>';
  }
  // 卓の席（倉庫の t.seats＝tableView の seatPeople）。長さ n・全員 active の時だけ使う
  function preSeats() {
    if (!table) return null;
    const x = tableView(st, table.table_id).seatPeople.map((p) => p.member_id);
    if (x.length !== n || new Set(x).size !== n) return null;
    if (!x.every((m) => { const y = st.members.find((z) => z.member_id === m); return y && y.active; })) return null;
    return x;
  }
  // 窓の並べ（画面だけ・お金の数は v.windows のまま）＝卓の席の順に「windows に在ればその窓・無ければ0の見せ窓」→席に居ない windows の人を今の順で
  function seatWin(v) {
    const byId = new Map(v.windows.map((w) => [w.member_id, w]));
    const zero = (p) => {
      const w = { member_id: p.member_id, name: p.name, big: 0, pt10: 0, dim: false };
      for (const { kind } of KINDS) { w[kind] = 0; w[kind + 'Big'] = 0; w[kind + 'Pt10'] = 0; }
      return w;
    };
    const out = v.seatPeople.map((p) => byId.get(p.member_id) || zero(p));
    const inSeat = new Set(v.seatPeople.map((p) => p.member_id));
    for (const w of v.windows) if (!inSeat.has(w.member_id)) out.push(w);
    return out;
  }
  function renderTable(v) {
    if (!v.rows.length) return '';
    const ppl = v.people;
    let h = '<div class="r-hyou-wrap"><table class="r-hyou"><thead><tr><th></th>' + ppl.map((p) => '<th>' + esc(p.name) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of v.rows) {
      h += '<tr class="' + (r.voided ? 'r-void' : '') + '"><th><button class="r-no" data-h="' + esc(r.hanchan_id) + '"' + (room.closed ? ' disabled aria-label="' + r.no + '回目"' : ' aria-label="' + r.no + '回目を直す"') + '>' + r.no + '回</button></th>'; // 終えた部屋は直す頁へ入らない
      for (const p of ppl) {
        const c = r.by[p.member_id];
        if (!c) { h += '<td class="r-na">—</td>'; continue; }
        const big = r.ok && c.pt10 !== null ? '<b class="' + sign(c.pt10) + '">' + fmtPt(c.pt10) + '</b>' : '<b class="zero">—</b>';
        const small = (c.rank !== null ? (c.rank + 1) + '位 ' : '') + boxNum(c.cell);
        h += '<td>' + big + '<small>' + small + '</small></td>';
      }
      h += '</tr>';
      if (!r.ok && !r.voided) h += '<tr class="r-why"><td colspan="' + (ppl.length + 1) + '">' + esc(whyText(r)) + '</td></tr>';
    }
    h += '</tbody><tfoot><tr><th>計</th>' + ppl.map((p) => '<td><b class="' + sign(v.total10[p.member_id]) + '">' + fmtPt(v.total10[p.member_id]) + '</b></td>').join('') + '</tr></tfoot></table></div>';
    if (v.rows.length > 10) h += '<p class="r-hint">↑ 上へなぞると 1回・2回 が出る（計は動かない）</p>';
    return h;
  }
  function whyText(r) {
    if (r.why === 'sum') return r.no + '回目：素点の合計が ' + diffText(r.diff) + '（計に入れていません）';
    if (r.why === 'order') return r.no + '回目：同じ点の人がいます。起家からの順を入れてください（「' + r.no + '回」を押す）';
    return r.no + '回目：入れ直してください（' + r.why + '）';
  }

  // 窓の種＝人ごとに ±・合計0（司さん 11-21「チップと同じやろが」＝飛び賞も同じ形）。lib の tableView が used[kind]・w[kind]・w[kind+'Big'|'Pt10']・v[kind+'Sum'] を返す種だけ出る
  //   ＝飛び賞（'tobi'・B2 tobi_chip_v3.md）は tobi が true かつ tobi_pt≥1 の卓だけ used.tobi が立つ。受け取る人を選ぶ窓は無くした
  const KINDS = [{ kind: 'chip', label: 'チップ' }, { kind: 'shugi', label: '祝儀' }, { kind: 'yaki', label: 'やきとり' }, { kind: 'tobi', label: '飛び賞' }];
  const perOf = (v, kind) => (kind === 'chip' ? R.chip_pt10 : kind === 'shugi' ? R.shugi_pt10 : (v.tableForSeisan || {})[kind + '_pt10']);
  function renderWindows(v) {
    // 足し①（終えた部屋に送れていない点が在る）＝この端末の額は部屋の額と違う＝窓は名前だけと赤い1行（v4 止め4）
    if (closedHold()) return '<div class="r-mado">' + seatWin(v).map((w) => '<div class="r-w"><div class="r-w-name">' + esc(w.name) + '</div></div>').join('') + '</div><p class="r-check bad" id="rMadoNo">この端末の点の一部が部屋に入っていないので、額は出しません。</p>';
    const pmOff = closingOn() ? ' disabled' : ''; // 終える送りの最中は ± を押せない形
    const ten = v.rate !== null;
    const unit = (pt10) => (ten ? (pt10 * v.rate / 10).toLocaleString('ja-JP') : (pt10 / 10).toFixed(1) + 'pt');
    let h = '<div class="r-mado">';
    for (const w of seatWin(v)) {
      const big = ten ? fmt(w.big) : fmtPt(w.big) + '<small>pt</small>';
      h += '<div class="r-w"><div class="r-w-name">' + esc(w.name) + '</div>' +
        '<div class="r-w-big ' + sign(w.big) + (w.dim ? ' dim' : '') + '">' + big + (w.dim ? '<span class="r-bang" aria-label="' + (v.custWait || (v.cust || []).some((c) => c.ng) ? 'チップ・祝儀・やきとり・飛び賞・自由な項目のどれかが合わないか数えられません' : 'チップ・祝儀・やきとり・飛び賞のどれかの合計が合いません') + '">!</span>' : '') + '</div>';
      // ③-2：やきとりはチップと同じ行（chip → shugi → yaki）。1枚の pt10 は lib の tableForSeisan.yaki_pt10（lib と同じ数）
      for (const { kind, label } of KINDS) {
        if (!v.used[kind]) continue;
        const per = perOf(v, kind);
        const val = ten ? w[kind + 'Big'] : w[kind + 'Pt10'];
        const valText = val === 0 ? '0' : (ten ? fmt(val) : fmtPt(val));
        h += '<div class="r-w-k">' + label + '<span>1枚＝' + unit(per) + '</span></div><div class="r-w-row">' +
          (room.closed ? '' : '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="-1"' + pmOff + ' aria-label="' + esc(w.name) + 'の' + label + 'を減らす">−</button>') + // 終えた部屋は［−］［＋］を出さない
          '<span class="r-cnt">' + fmtCnt(w[kind]) + '</span>' +
          (room.closed ? '' : '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="1"' + pmOff + ' aria-label="' + esc(w.name) + 'の' + label + 'を増やす">＋</button>') +
          '<span class="r-w-val ' + (val === 0 ? 'zero' : sign(val)) + '">' + valText + '</span></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }
  // 飛び賞のヒント（止めない・お金は動かさない）＝飛んだ半荘が在るのに飛び賞の行が全部0
  const tobiHintLine = (on) => (on ? '<p class="r-check mada" id="rTobiHint">飛び賞が入っていません</p>' : '');
  function renderCheck(v) {
    const bad = [];
    for (const { kind, label } of KINDS) if (v.used[kind] && v[kind + 'Sum'] !== 0) bad.push(label + 'の合計が ' + fmtCnt(v[kind + 'Sum']) + ' 合いません');
    // 自由な項目（2c-3b）：合わない・この版で数えられない物が在る間は緑の ✓ を出さない
    for (const c of v.cust || []) {
      if (c.ng) bad.push(c.name + 'の合計が ' + fmtCnt(c.sum) + ' 合いません');
      else if (c.wait) bad.push(c.name + 'はこの版では数えられません');
    }
    // C4 §3b：鎖の前の卓（鍵が違う区切りで残した枚）の合計が合わない＝精算は今の extrasOk の止め（ここは字だけ）
    for (const [i, p] of (v.parts || []).slice(0, -1).entries()) {
      for (const { kind, label } of KINDS) if (p.used[kind] && p[kind + 'Sum'] !== 0) bad.push(v.splits[i].upto + '回目までの' + label + 'の合計が ' + fmtCnt(p[kind + 'Sum']) + ' 合いません');
      for (const c of p.cust || []) if (c.ng) bad.push(v.splits[i].upto + '回目までの' + c.name + 'の合計が ' + fmtCnt(c.sum) + ' 合いません');
    }
    if (bad.length) return tobiHintLine(v.tobiHint) + '<p class="r-check bad">' + esc(bad.join('・')) + '</p>';
    const okParts = [];
    for (const { kind, label } of KINDS) if (v.used[kind]) okParts.push(label + 'の合計 0');
    okParts.push('合計 0');
    return tobiHintLine(v.tobiHint) + '<p class="r-check ok">✓ ' + okParts.join('・') + '</p>';
  }

  // C4 §2：次の回から変えられる時＝部屋を作れる立場（WHO table_rules＝kan）・終えていない部屋・卓が在り取り消していない・リーグの日でない
  function canRule() {
    if (room.closed || !table || table.voided || stopped) return false;
    const s = st.sessions.find((x) => x.session_id === table.session_id);
    if (!s || s.voided || (typeof s.league_id === 'string' && s.league_id)) return false;
    return needOf(WHO.table_rules, room.role) === null;
  }
  function renderRules() {
    bar({ back: '対局', onBack: toRoom, title: 'ルール' });
    const close = closeHtml(); // ★数える前に flushMerge(true)（1回目＝頁を出す時）★＝札の数も流した後の数
    shownTag = tagKey();
    const edit = canRule();
    const cur = { ...R, rate: table ? tableView(st, table.table_id).rate : room.rules.rate ?? null };
    const draft = edit && ruleCtl ? { ...cur, ...ruleCtl.read() } : cur; // 読み直しで描き直しても打ちかけを残す
    el.innerHTML = (ruleMsg ? '<div class="r-red" id="rRuleMsg"><b>' + esc(ruleMsg) + '</b></div>' : '') + '<div id="rRules"></div>' +
      (edit ? '<p class="err" id="rRuleErr"></p><button class="btn btn-main" id="rRuleGo"' + (ruleBusy || closingOn() ? ' disabled' : '') + ' aria-busy="' + (ruleBusy ? 'true' : 'false') + '">次の回からこのルールにする</button>' : '') +
      (showShare ? '<button class="btn btn-line" id="rShare">部屋名と URL</button>' : '') + close;
    ruleCtl = mountRules(el.querySelector('#rRules'), { rules: draft, readOnly: !edit, lockPlayers: true });
    if (!edit) ruleCtl = null;
    if (showShare) el.querySelector('#rShare').onclick = showShare;
    if (edit) el.querySelector('#rRuleGo').onclick = () => {
      const rr = { ...R, ...ruleCtl.read(), players: R.players };
      const err = (t) => { el.querySelector('#rRuleErr').textContent = t; };
      if (rr.yakitori === true && !(Number.isInteger(rr.yakitori_pt) && rr.yakitori_pt >= 1 && rr.yakitori_pt <= 999)) return err('やきとり1枚の pt は 1〜999 です（整数）。');
      const chk = rulesOk(rr);
      if (!chk.ok) return err(RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。'));
      ruleMsg = null;
      sendRules(chk.rules);
    };
    wireClose();
  }
  /* C4 §2 table_rules＝並びに積まず直に送る（direct）。送る前に ± のまとめと並びを空にする（startShared と同じ・送り切ってから続き）。
   * ok＝写しに当てて鎖の最後へ移り帯／同じ rules＝何も変わらない／bad at extras＝帯だけ（変えない）／conflict at next＝読み直して鎖の最後で開き直す */
  async function sendRules(rules) {
    if (ruleBusy || dead || stopped || writeBlocked() || !canRule()) return;
    flushMerge(true, true);
    const op0 = { op: 'table_rules', table_id: table.table_id, rules };
    const opts = () => ({ direct: true, role: room.role, roomRules: room.rules, now: new Date().toISOString() });
    if (st.needs_upload) { // 端末だけの写し（2e まで送らない）＝写しにだけ当てる（lib は倉庫と同じ答え）
      const a = applyOps(st, [{ ...op0, new_table_id: uuid() }], opts());
      if (!a.ok) { ruleMsg = ruleErrText(a.res); render(); return; }
      ruleDone(a.state); return;
    }
    if (heldInfo(outbox)) { ruleMsg = '止まっている書き込みがあります。先にそちらを片付けてください。'; render(); return; }
    if (outbox.length || merge.size) { pendingRule = rules; ruleMsg = '前に入れた点を送っています。送れたら変えます。'; render(); kick(); return; }
    if (offline()) { ruleMsg = '電波がつながってから変えられます。'; render(); return; }
    if (lane) { pendingRule = rules; return; }
    const ids = ruleOp && cn(ruleOp.rules) === cn(rules) && ruleOp.table_id === table.table_id ? ruleOp : (ruleOp = { op_id: uuid(), new_table_id: uuid(), rules, table_id: table.table_id });
    const op = { ...op0, new_table_id: ids.new_table_id };
    lane = true; ruleBusy = true; rerender();
    let res;
    try { res = await sb().rpc('mj_write', { p_room_id: rid, p_op_id: ids.op_id, p_ops: [op] }); }
    catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
    lane = false; ruleBusy = false;
    if (dead) return;
    const d = res && res.data;
    const s = outboxStep(res);
    if (s.kind !== 'retry') ruleOp = null; // retry は同じ op_id で送り直す
    if (s.kind === 'done') {
      aizuOut(d);
      const a = applyOps(st, [op], opts());
      if (a.ok) ruleDone(a.state); else { since = null; ruleMsg = null; page = 'room'; render(); }
      sync(); return;
    }
    if (s.kind === 'login') { loginStop(s.err); return; }
    if (s.kind === 'reload') { goneStop(); return; }
    if (s.kind === 'closed') { roomInfo({ closed: true }); rerender(); return; }
    if (s.kind === 'conflict') { since = null; ruleMsg = null; page = 'room'; render(); sync(); return; } // 他の端末が先に区切った＝読み直して鎖の最後へ（repick が帯）
    ruleMsg = s.kind === 'retry' ? 'つながりませんでした。電波を確かめてもう一度押してください。' : ruleErrText(d || { err: s.err });
    rerender(); kick();
  }
  const ruleErrText = (r) => (r && r.err === 'bad' && r.at === 'extras' ? '前のルールのチップ等を合計0にしてから変えてください'
    : 'ルールを変えられません（' + (HELD_WHY[r && r.err] || (r && r.err) || '?') + '）');
  function ruleDone(next) {
    const was = table.table_id;
    st = next; save(KEY(uid, rid), st);
    setTable(st.tables.find((t) => t.table_id === was));
    ruleCtl = null; ruleMsg = null; page = 'room';
    ruleNote = table.table_id !== was ? ruleChangedText(chainView(st, table.table_id)) : null; // 同じ rules＝区切らない＝何も変わらない
    render();
  }

  // ── ［部屋を終える］（B3b-1 §0〜§2）──
  // 出すのは shared で終えていない部屋の kan か owner（持ち主かは倉庫が決める）・mj_role を受けた端末（not_owner）には出さない
  const canClose = () => shared && !room.closed && !room.not_owner && (room.role === 'kan' || room.owner === true);
  /* 未送信0 の門＝★数える前に必ず flushMerge(true)★（1秒まとめは1秒後まで並びに入らない＝数えずに終えると黙って欠ける・止め2）。null＝送ってよい */
  function closeGate() {
    flushMerge(true);
    if (st.needs_upload) return 'この端末の点がまだ部屋に上がっていません。上がってから終えられます。';
    if (outbox.length || merge.size) return 'この端末にまだ送れていない点が ' + outbox.length + ' 組あります。' + (heldInfo(outbox) ? '止まっています。' : '') + '送れてから終えられます。';
    return null;
  }
  function closeHtml() {
    const msg = closeUi.msg ? '<p class="err" id="rCloseMsg">' + esc(closeUi.msg) + '</p>' + (closeUi.retry ? '<button class="btn btn-line" id="rCloseRetry"' + (closeBusy ? ' disabled' : '') + '>もう一度</button>' : '') : '';
    if (!canClose()) return msg ? '<div class="r-close" id="rCloseBox">' + msg + '</div>' : '';
    const gate = closeGate();
    let h = '<div class="r-close" id="rCloseBox">';
    if (!closeUi.open) h += '<button class="btn btn-aka-line" id="rCloseRoom"' + (gate ? ' disabled' : '') + '>部屋を終える</button>';
    else {
      h += '<p class="setsumei" id="rCloseQ">部屋を終えると、この部屋にはもう誰も書けません。入っていた人は見られます。同じ部屋名とパスでまた作れます。</p>' +
        '<p class="setsumei" id="rCloseOthers">他の人の端末にまだ送れていない点があると、その点は部屋に入りません。</p>' +
        '<button class="btn btn-aka" id="rCloseGo"' + (gate || closeBusy ? ' disabled' : '') + ' aria-busy="' + (closeBusy ? 'true' : 'false') + '">部屋を終える</button>';
      if (!closingOn()) h += '<button class="btn btn-line" id="rCloseNo">やめる</button>'; // 送った後（印が在る間）はやめられない＝倉庫で通ったか分からない
    }
    if (gate) h += '<p class="err" id="rCloseGate">' + esc(gate) + '</p>';
    return h + msg + '</div>';
  }
  function wireClose() {
    const q = (s) => el.querySelector(s);
    if (q('#rCloseRoom')) q('#rCloseRoom').onclick = () => { if (closeBusy) return; closeUi.msg = null; closeUi.retry = false; if (!closeGate()) closeUi.open = true; render(); }; // 2回目＝窓を開く時
    if (q('#rCloseGo')) q('#rCloseGo').onclick = () => sendClose();
    if (q('#rCloseRetry')) q('#rCloseRetry').onclick = () => sendClose();
    if (q('#rCloseNo')) q('#rCloseNo').onclick = () => { if (closingOn()) return; closeUi = { open: false, msg: null, retry: false }; render(); };
  }
  const dropClose = () => { try { localStorage.removeItem(PCLOSE); } catch { /* 消せなくても次の ok で消す */ } };
  /* 送る＝「flushMerge(true)→数える→0 なら closing（印）→送る」（どの送り直しも同じ道・3回目＝窓の［部屋を終える］）。送り直しは印の op_id */
  async function sendClose() {
    if (closeBusy || dead || !canClose()) return;
    if (closeGate()) { closeUi.msg = null; closeUi.retry = false; rerender(); return; } // 増えていたら送らない
    let op = null;
    try { op = localStorage.getItem(PCLOSE); } catch { op = null; }
    if (!op) { op = uuid(); localStorage.setItem(PCLOSE, op); } // ★印を置いた後は ± が merge に入らない（closing）★
    closeBusy = true; closeUi.open = true; closeUi.msg = null; closeUi.retry = false; rerender();
    const res = await rpc('mj_write', { p_room_id: rid, p_op_id: op, p_ops: [{ op: 'room_close' }] });
    closeBusy = false;
    if (dead) return;
    aizuOut(res); // 2c-2f：終えた事も合図（他の端末がすぐ読んで読み専になる）・rpc() の返しは data そのもの
    closeReply(res && typeof res === 'object' ? res : {});
  }
  function closeReply(res) {
    const e = res.err, at = res.at || res.what;
    if (res.ok === true || (e === 'bad' && at === 'closed')) {
      // ok／もう終わっている＝控えの行に closed（★rememberRoom を通さない＝ホームの並びと at を変えない★）→ 読み専で開き直す
      dropClose();
      closeUi = { open: false, msg: null, retry: false };
      room.closed = true; patchRoom(uid, rid, { closed: true }); leaveChan(); // 終えた部屋は合図から外す
      const nt = res.ok === true ? null : errText(res, 'close');
      if (reopen) { reopen(nt); return; }
      note = nt; page = 'room'; setTable(closedTable()); render(); return;
    }
    if (e === 'mj_reauth' || e === 'mj_session') {
      // 印は残す＝同じ人が入り直したら同じ op_id で送り直す（別の人なら gamen-taikyoku の relogin が start＝前の人の印は使わない）
      closeUi.msg = errText(res, 'close'); closeUi.retry = false; rerender();
      if (relogin) relogin(() => { if (!dead) sendClose(); });
      return;
    }
    if (e === 'mj_role') { dropClose(); room.not_owner = true; patchRoom(uid, rid, { not_owner: true }); closeUi = { open: false, msg: errText(res, 'close'), retry: false }; rerender(); return; }
    if (e === 'net' || e === 'offline' || e === 'busy' || e === 'server' || e === undefined || e === null) { closeUi.msg = errText(res, 'close'); closeUi.retry = true; rerender(); return; } // 印は残す
    if (e === 'internal') { closeUi.msg = errText(res, 'close'); closeUi.retry = false; rerender(); return; } // 印は残す
    // gone・mj_op_other_user・full（op_results の mj_caps 行の欠け）・bad kind・知らない err＝同じ op_id で送り直しても同じ＝印を消す（黙らない）
    dropClose(); closeUi = { open: false, msg: errText(res, 'close'), retry: false }; rerender();
  }

  function memberStats(mid) {
    const hs = st.hanchans.filter((h) => !h.voided && h.seats.includes(mid));
    let last = null;
    for (const h of hs) { const t = st.tables.find((x) => x.table_id === h.table_id); const s = t && st.sessions.find((x) => x.session_id === t.session_id); if (s && (!last || s.date > last)) last = s.date; }
    return { count: hs.length, last };
  }
  function histNames() { return load(NAMES(uid), []).filter((nm) => !st.members.some((m) => m.name_key === nameKey(nm))); }
  function renderPick() {
    bar({ back: '対局', onBack: toRoom, title: '人を選ぶ' });
    const p = picking;
    const act = st.members.filter((m) => m.active);
    const hist = histNames();
    let h = '<div id="pBase">';
    if (act.length) h += '<p class="sec">この部屋の人（名簿）・この半荘の' + n + '人を押す　<b class="kon">' + p.seats.length + '／' + n + '</b></p><div class="chips">' + act.map((m) => '<button data-pick="' + esc(m.member_id) + '" aria-pressed="' + p.seats.includes(m.member_id) + '">' + esc(m.name) + '</button>').join('') + '</div>';
    if (hist.length) h += '<p class="sec">この端末で前に使った名前（ほかの部屋）</p><div class="chips">' + hist.map((nm) => '<button data-hist="' + esc(nm) + '">' + esc(nm) + '</button>').join('') + '</div>';
    if (act.length || hist.length) h += '<p class="r-hint">押すだけでこの半荘に入る。ほかの部屋の名前を押すと、この部屋の名簿にも足される。</p>';
    h += '</div><p class="sec">新しい人</p><label class="r-in"><span>名前</span><input id="pNew" maxlength="20" autocomplete="off" placeholder="（打つ）"></label>';
    h += '<div id="pCand"></div><p class="err" id="pErr"></p>';
    h += '<div id="pFoot"><button class="btn btn-main" id="pGo"' + (p.seats.length === n ? '' : ' disabled') + '>この' + n + '人で' + (p.only ? '決める' : '始める') + '</button>' +
      '<p class="r-hint">席（東南西北）は選ばない。同点の時だけ「上家はどっち？」を聞く（ルールが上家取りの時）。</p></div>';
    el.innerHTML = h;
    wirePick();
  }
  function drawCand() {
    const inp = el.querySelector('#pNew');
    const typed = inp.value.trim(), key = nameKey(typed);
    el.querySelector('#pBase').hidden = !!typed;
    el.querySelector('#pFoot').hidden = !!typed;
    el.querySelector('#pErr').textContent = '';
    const box = el.querySelector('#pCand');
    if (!typed) { box.innerHTML = ''; return; }
    const act = st.members.filter((m) => m.active);
    const same = act.find((m) => m.name_key === key);
    if (same) {
      const s = memberStats(same.member_id);
      box.innerHTML = '<div class="r-red"><b>' + esc(same.name) + 'さんはもう名簿にいます。同じ人ですか？</b><span>半荘 ' + s.count + '回' + (s.last ? '・最後は ' + md(s.last) : '') + '</span></div>' +
        '<button class="btn btn-main" id="pSame" data-m="' + esc(same.member_id) + '">同じ人（名簿の' + esc(same.name) + 'を入れる）</button>' +
        '<button class="btn btn-line" id="pOther" data-n="' + esc(same.name) + '">別の人（名前を変えて足す 例：' + esc(same.name) + '2）</button>' +
        '<p class="r-hint">同じ字のまま2人目は足せない。</p>';
    } else {
      const fromRoom = act.filter((m) => m.name_key.startsWith(key));
      const fromHist = histNames().filter((nm) => nameKey(nm).startsWith(key));
      let h = '<p class="sec">候補（押すとその人がこの半荘に入る）</p><div class="r-cand">';
      h += fromRoom.map((m) => '<button data-pick="' + esc(m.member_id) + '"><span>' + esc(m.name) + '</span><small>この部屋の人・半荘 ' + memberStats(m.member_id).count + '回</small></button>').join('');
      h += fromHist.map((nm) => '<button data-hist="' + esc(nm) + '"><span>' + esc(nm) + '</span><small>この端末で前に使った</small></button>').join('');
      h += '<button data-new="1"><span>' + esc(typed) + '</span><small>新しい人で足す</small></button></div>';
      h += '<p class="r-hint">打った字の頭で探す。</p>';
      box.innerHTML = h;
    }
    wireCand();
  }
  function rememberName(nm) {
    const a = load(NAMES(uid), []).filter((x) => nameKey(x) !== nameKey(nm));
    a.unshift(nm); save(NAMES(uid), a.slice(0, 30));
  }
  function addMember(nm) {
    const r = commit([{ op: 'member_add', member_id: uuid(), name: nm }]);
    if (!r.ok && r.err === 'dup') return { dup: r.member_id };
    if (!r.ok) return { err: '名前は1〜20字です。' };
    rememberName(nm);
    return { mid: st.members[st.members.length - 1].member_id };
  }
  function seat(mid) {
    const s = picking.seats;
    if (s.includes(mid)) s.splice(s.indexOf(mid), 1);
    else if (s.length < n) s.push(mid);
    else { el.querySelector('#pErr').textContent = 'もう' + n + '人です。外す人を先に押してください。'; return false; }
    return true;
  }
  function pickDone(mid) { if (mid && !picking.seats.includes(mid)) seat(mid); renderPick(); }

  const inChain = (tid) => tableChain(st, table.table_id).includes(tid); // C4 §5a：鎖のどれかの卓
  function lastSeats() {
    const ch = tableChain(st, table.table_id);
    const hs = ch.flatMap((tid) => st.hanchans.filter((x) => x.table_id === tid && !x.voided));
    return hs.length ? hs[hs.length - 1].seats.slice() : null;
  }
  function startEntry(hid) {
    if (hid) {
      const x = st.hanchans.find((y) => y.hanchan_id === hid);
      // C4 §5a：番号は鎖の通し番号・数えはその回の卓のルール（直す書きはその回の卓のまま＝運ばない）
      const xr = chainView(st, table.table_id).rows.find((y) => y.hanchan_id === hid);
      const xt = st.tables.find((y) => y.table_id === x.table_id);
      entry = { hanchan_id: hid, no: xr ? xr.no : x.no, R: xt ? xt.rules : R, seats: x.seats.slice(), cells: x.cells.map((v) => boxNum(Number(v))), lost: String(x.lost || 0), step: 'cells', order: orderIdx(x) || [], voided: x.voided,
        // 開いた時の値と版（2d §3「edit の entry の版は今のまま」＝読み直しで写しが替わっても、ぶつかれば conflict で止める）
        orig: { cells: x.cells.slice(), cell_ver: x.cell_ver.slice(), lost: x.lost, version: x.version, ton_order: x.ton_order, order_version: x.order_version } };
    } else {
      const seats = lastSeats() || preSeats(); // 半荘が在れば前の席・無ければ前もって決めた卓の人
      if (!seats) { picking = { seats: [] }; page = 'pick'; render(); return; }
      entry = { seats, no: chainView(st, table.table_id).nextNo, R, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [] };
    }
    page = 'edit'; render();
  }
  // その回の卓のルール（C4 §5a：前の回は前の卓のルールで数える・新しい回は鎖の最後の卓）
  const eRules = () => { const R1 = (entry && entry.R) || R; return { R: R1, n: R1.players, kieru: R1.kyotaku_end === 'kieru' }; };
  function liveCalc() {
    const e = entry;
    const { R, n, kieru } = eRules();
    const cells = e.cells.map(toInt);
    const lostRaw = kieru ? toInt(e.lost || '0') : 0;
    const lost = Number.isNaN(lostRaw) ? 0 : lostRaw;
    const want = R.start_pts * n - lost;
    const filled = cells.every((x) => !Number.isNaN(x));
    const got = cells.reduce((a, x) => a + (Number.isNaN(x) ? 0 : x), 0);
    // 残り（司さん 11-21 17:26「1人入れた時点で残りの点数も出して」）＝want − 入れた箱の和。数の箱が n−1 で空が1つなら、その箱に残りを薄く勧める
    const nums = cells.filter((x) => !Number.isNaN(x)).length;
    const empty = e.cells.map((v, i) => (String(v).trim() === '' ? i : -1)).filter((i) => i >= 0);
    const rest = want - got;
    const sug = nums === n - 1 && empty.length === 1 && rest % 100 === 0 && Math.abs(rest) <= CELL_MAX ? empty[0] : -1;
    let pt = null;
    if (filled) {
      const c = checkEntry(R, cells, lost);
      if (c.ok && (!c.needOrder || e.order.length === n)) {
        const g = hanchanPt(R, cells, { order: c.needOrder ? e.order : [...Array(n).keys()], lost });
        if (g.ok) pt = g.pt10;
      }
    }
    return { want, got, filled, pt, nums, rest, sug };
  }
  function sumLine(c) {
    const W = c.want.toLocaleString('ja-JP');
    if (c.filled && c.got === c.want) return '<p class="r-check ok" id="eSum">✓ 素点の合計 ' + W + '</p>';
    if (c.filled) return '<p class="r-check bad" id="eSum">素点の合計 ' + c.got.toLocaleString('ja-JP') + '・' + W + ' より ' + Math.abs(c.got - c.want).toLocaleString('ja-JP') + (c.got > c.want ? ' 多い' : ' 少ない') + '</p>';
    return '<p class="r-check mada" id="eSum">素点の合計 ' + W + (c.nums ? '・残り ' + (c.rest < 0 ? '−' : '') + Math.abs(c.rest).toLocaleString('ja-JP') : '') + '</p>';
  }
  const sugText = (c, i) => (c.sug === i ? boxNum(c.rest) : '');
  function renderEdit() {
    const e = entry;
    const { n, kieru } = eRules();
    bar({ back: '対局', onBack: toRoom, title: e.no + '回目の点を' + (e.hanchan_id ? '直す' : '入れる') });
    let h = '';
    if (e.step === 'cells') {
      const c = liveCalc();
      h += '<div class="r-ent">' + e.seats.map((m, i) => '<label class="r-er"><span class="r-er-n">' + esc(nameOf(m)) + '</span><input class="r-er-v" readonly inputmode="none" data-c="' + i + '" value="' + esc(e.cells[i]) + '" placeholder="' + esc(sugText(c, i)) + '" autocomplete="off" aria-label="' + esc(nameOf(m)) + 'の素点"><span class="r-er-p ' + (c.pt ? sign(c.pt[i]) : '') + '" data-p="' + i + '">' + (c.pt ? fmtPt(c.pt[i]) : '') + '</span></label>').join('') + '</div>';
      if (kieru) h += '<label class="r-in"><span>消えた供託</span><input id="eLost" readonly inputmode="none" value="' + esc(e.lost) + '" autocomplete="off"></label>';
      h += sumLine(c) + '<p class="r-hint">pt と順位は点から自動で出す。</p>';
    } else if (e.step === 'order') {
      h += '<p class="sec">同じ点の人がいます。起家から順に押してください　<b class="kon">' + e.order.length + '／' + n + '</b></p>';
      h += '<div class="chips">' + e.seats.map((m, i) => '<button data-ord="' + i + '" aria-pressed="' + e.order.includes(i) + '">' + (e.order.includes(i) ? (e.order.indexOf(i) + 1) + '. ' : '') + esc(nameOf(m)) + '</button>').join('') + '</div>';
      h += '<button class="btn-s" id="eOrdReset">押し直す</button>';
    }
    h += '<p class="err" id="eErr"></p>';
    h += '<button class="btn btn-main" id="eOk">' + (e.step !== 'cells' ? '次へ' : e.hanchan_id ? '直す' : '入れる') + '</button>';
    if (e.hanchan_id) h += '<button class="btn btn-line" id="eVoid">' + (e.voided ? 'この半荘を戻す' : 'この半荘を取り消す') + '</button>';
    else if (e.step === 'cells') h += '<button class="btn btn-line" id="ePeople">人を替える</button>';
    if (e.step === 'cells') h += '<div class="kp-sp" id="eKpSp" hidden></div>' + KP_HTML;
    el.innerHTML = h;
    wireEdit();
  }
  // アプリの数字鍵盤（司さん 11-21 夜「iPhoneでもAndroidでもキーボードだしたらよかろが」・定め gamen_kenban_sadame.md）＝端末の鍵盤は出さない（箱は readonly＋inputmode none）
  //   並び＝端末の大きな数字鍵盤の 1〜9・0・⌫ に − と 000・↓（次の人へ）・✓（閉じる）。字 24px・鍵 60px（2.5）
  const KP_KEYS = [['1'], ['2'], ['3'], ['bs', '⌫', '1字消す'], ['4'], ['5'], ['6'], ['neg', '−', '＋−を替える'], ['7'], ['8'], ['9'], ['next', '↓', '次の人へ'], ['000'], ['0'], ['ok', '✓', '閉じる']];
  const KP_HTML = '<div class="kp" id="eKp" role="group" aria-label="数字の鍵盤" hidden>' + KP_KEYS.map(([k, t, a]) => '<button type="button" data-kp="' + k + '"' + (a ? ' aria-label="' + a + '"' : '') + ' class="' + (k === 'next' || k === 'ok' ? 'kp-do' : '') + (k === 'ok' ? ' kp-ok' : '') + '">' + (t || k) + '</button>').join('') + '</div>';
  function readCells() {
    for (const inp of el.querySelectorAll('[data-c]')) entry.cells[Number(inp.dataset.c)] = inp.value;
    const lost = el.querySelector('#eLost'); if (lost) entry.lost = lost.value;
  }
  function liveUpdate() {
    readCells();
    const c = liveCalc();
    for (const inp of el.querySelectorAll('[data-c]')) inp.placeholder = sugText(c, Number(inp.dataset.c));
    for (const s of el.querySelectorAll('[data-p]')) { const i = Number(s.dataset.p); s.textContent = c.pt ? fmtPt(c.pt[i]) : ''; s.className = 'r-er-p ' + (c.pt ? sign(c.pt[i]) : ''); }
    el.querySelector('#eSum').outerHTML = sumLine(c);
  }
  function entryNext() {
    const e = entry;
    const { R, n, kieru } = eRules();
    const err = (t) => { el.querySelector('#eErr').textContent = t; };
    if (e.step === 'cells') {
      readCells();
      const cells = e.cells.map(toInt);
      if (cells.some((x) => Number.isNaN(x))) return err('全員の点を数で入れてください。');
      if (cells.some((x) => x % 100 !== 0)) return err('点は100点単位で入れてください。');
      if (cells.some((x) => Math.abs(x) > CELL_MAX)) return err('点は ±' + CELL_MAX.toLocaleString('ja-JP') + ' までです。');
      const lost = kieru ? toInt(e.lost || '0') : 0;
      if (Number.isNaN(lost) || lost < 0 || lost % 1000 !== 0 || lost > LOST_MAX) return err('消えた供託は0〜' + LOST_MAX.toLocaleString('ja-JP') + 'の1000点単位です。');
      const c = checkEntry(R, cells, lost);
      if (!c.ok && c.why === 'sum') return err('素点の合計が ' + diffText(c.diff) + 'です。');
      if (!c.ok) return err('入れられません（' + c.why + '）。');
      e.num = cells; e.lostNum = lost;
      if (!c.needOrder) e.order = [];
      if (c.needOrder && e.order.length !== n) { e.order = []; e.step = 'order'; render(); return; }
      return save1();
    }
    if (e.step === 'order') {
      if (e.order.length !== n) return err('全員を押してください。');
      return save1();
    }
  }
  function save1() {
    const e = entry;
    let ops;
    if (!e.hanchan_id) {
      const op = { op: 'hanchan_start', hanchan_id: uuid(), table_id: table.table_id, seats: e.seats, cells: e.num, lost: e.lostNum, follow: true }; // C4 §3 U1：新しい版はいつも follow:true（区切られた卓なら倉庫が鎖の最後へ）
      if (e.order.length) op.ton_order = e.order.map((i) => e.seats[i]); // 順は member_id の配列（§6-6）
      ops = [op];
    } else {
      const h = { hanchan_id: e.hanchan_id, ...e.orig };
      ops = [];
      e.num.forEach((v, i) => { if (v !== h.cells[i]) ops.push({ op: 'cell_set', hanchan_id: h.hanchan_id, seat: i, value: v, base_version: h.cell_ver[i] }); });
      if (e.lostNum !== h.lost) ops.push({ op: 'kyotaku_set', hanchan_id: h.hanchan_id, value: e.lostNum, base_version: h.version });
      const ton = e.order.length ? e.order.map((i) => e.seats[i]) : null;
      if (ton && canon(ton) !== canon(h.ton_order)) ops.push({ op: 'hanchan_order', hanchan_id: h.hanchan_id, ton_order: ton, base_version: h.order_version });
    }
    if (ops.length) {
      const r = commit(ops);
      if (!r.ok) { el.querySelector('#eErr').textContent = '入れられません（' + r.err + (r.at ? '・' + JSON.stringify(r.at) : '') + '）。'; return; }
    }
    toRoom();
  }

  // 精算の数は lib の sessionBreakdown（S2 v1.1 止め4＝取り消していない・レートのある卓だけ・卓ごとのレートは kei で分ける）
  function seisanData() {
    const sid = table.session_id;
    return { ...sessionBreakdown(st, sid), s: sessionSeisan(st, sid) };
  }
  const ratesText = (rates) => (rates.length > 1 ? 'レートは卓ごと' : rateText(rates.length ? rates[0] : null));
  const keiText = (kei) => Object.keys(kei).map(Number).sort((a, b) => a - b).map((r) => fmtPt(kei[r]) + 'pt × ' + r.toLocaleString('ja-JP')).join(' ＋ ');
  function missingText(m, many, sid) {
    const pre = many ? '卓' + m.table + '：' : '';
    if (m.no) {
      // C4 §5a：鎖の卓の回は通し番号で呼ぶ（m.table は開催の卓の順・m.no は卓の中の no）
      const t = st.tables.filter((x) => x.session_id === sid)[(m.table || 1) - 1];
      const h = t && st.hanchans.find((x) => x.table_id === t.table_id && x.no === m.no);
      const r = h && chainView(st, t.table_id).rows.find((x) => x.hanchan_id === h.hanchan_id);
      if (r) m = { ...m, no: r.no };
      if (m.why === 'sum') return pre + m.no + '回目＝素点の合計が ' + diffText(m.diff);
      if (m.why === 'order') return pre + m.no + '回目＝起家からの順がまだ';
      return pre + m.no + '回目＝入れ直しが要ります';
    }
    // 自由な項目（2c-3b）：合計が合わない／お金の数え方がこの版に無い（③-2 の前）
    if (typeof m.what === 'string' && m.what.startsWith('c:')) {
      const nm = typeof m.name === 'string' ? m.name : m.what;
      return pre + (m.why === 'not_yet' ? nm + 'はこの版では精算に入れられません' : nm + 'の合計が ' + fmtCnt(m.diff) + ' で合いません');
    }
    // 名を知る種だけ名で呼ぶ（知らない what は名前を当てない＝v1.1 任意5）
    const KN = { chip: 'チップ', shugi: '祝儀', yaki: 'やきとり', tobi: '飛び賞' };
    if (Object.prototype.hasOwnProperty.call(KN, m.what)) return pre + KN[m.what] + 'の合計が ' + fmtCnt(m.diff) + ' で合いません（' + (m.what === 'yaki' || m.what === 'tobi' ? KN[m.what] : 'チップ・祝儀') + 'を入れていません）';
    return pre + '知らない項目（' + String(m.what) + '）の合計が合いません';
  }
  // ①［対局終了］（shuuryou_v1.md v4〜v4.3・司さん 11-21「対局終了にしろ」）
  // ★入っていない物が1件でもある間（今か、終えた時の控えに）は、お金の数を1つも出さない（止めて警告）★＝partial の1つの判じを下の全部が見る
  function renderSeisan() {
    bar({ back: '対局', onBack: toRoom, title: '精算' });
    const d = seisanData(), s = d.s;
    shownTag = tagKey();
    const top = '<div class="r-top"><span>' + (d.date ? esc(md(d.date)) + '・' : '') + ratesText(d.rates) + '・半荘' + d.count + '回</span>' + liveTag() + '</div>' + bandsHtml() + staleHtml(); // 精算の頁の上（2d §3 読めない時）
    if (!s.ok) { el.innerHTML = top + '<div class="r-red"><b>' + (s.err === 'voided' ? 'この対局は取り消されています（精算は出しません）' : '精算を出せません（' + esc(s.err) + '）') + '</b></div>'; wireBands(); return; }
    // 足し①＝この端末の写しの点が部屋に入っていない＝partial と同じく誰が誰に・1人ずつの額を1つも出さない（v3 止め2・s.missing が空でも出す）
    if (closedHold()) { el.innerHTML = top + '<div class="r-red" id="sClosedNo"><b>この端末の点の一部が部屋に入っていないので、精算の額は出しません。</b></div>'; wireBands(); return; }
    const settles = st.settles.filter((x) => x.session_id === d.sid);
    const last = settles[settles.length - 1];
    const lastMissing = last ? (last.missing || []) : [];
    const partial = lastMissing.length > 0 || s.missing.length > 0;
    if (partial) viewSnap = false; // 終えた時の額を見る道も無い（N2）
    const tenCh = last && !partial ? tenChanged(last.content.ten, s.ten) : []; // 鍵を合わせて比べる（S2 v1.1 止め2）
    const changed = !!last && (partial ? cn(lastMissing) !== cn(s.missing) : tenCh.length > 0);
    const many = chainHeads(d.sid).length > 1; // C4：区切った卓の鎖は1つの卓と数える
    const goBtn = s.missing.length ? '<button class="r-red r-red-btn" id="sGo"><b>入っていない物 ' + s.missing.length + '件</b>' + s.missing.map((m) => '<span>・' + esc(missingText(m, many, d.sid)) + '</span>').join('') + '<span class="r-link">押すとその場所へ</span></button>' : '';
    const errLine = closeErr ? '<div class="r-red"><b>対局終了を残せませんでした（' + esc(closeErr) + '）</b></div>' : '';
    // ［対局終了］の所＝入っていない物があれば1回目は確かめ（同じ位置に［戻って入れる］・その下に赤の箱と［n件のまま対局終了］）
    // 終えた部屋は［対局終了］を出さない・終える送りの最中は押せない形（B3b-1 §3）
    const cz = closingOn() ? ' disabled' : '';
    const closeArea = (label) => (room.closed ? '' : confirming && s.missing.length
      ? '<button class="btn btn-line" id="sBack">戻って入れる</button><div class="r-red"><b>入っていない物 ' + s.missing.length + '件のまま終了します。この対局の額は出しません</b></div><button class="btn btn-main" id="sClose2"' + cz + '>' + s.missing.length + '件のまま対局終了</button>'
      : '<button class="btn btn-main" id="sClose"' + cz + '>' + label + '</button>');
    let h = top;
    if (last) {
      if (lastMissing.length) h += '<div class="r-red"><b>' + hm(last.at) + ' に対局終了（入っていない物 ' + lastMissing.length + '件のまま・額は出しません）</b></div>';
      else h += '<div class="r-white">' + hm(last.at) + ' に対局終了</div>';
    }
    if (changed && !viewSnap) {
      if (partial) {
        h += '<div class="r-red"><b>入っていない物が変わりました（' + lastMissing.length + '件 → ' + s.missing.length + '件）</b></div>' + goBtn;
      } else {
        h += '<div class="r-red"><b>終えた後に変わりました（' + tenCh.length + '人）</b><span>' + tenCh.map((m) => esc(s.name(m))).join('・') + '</span></div>';
        h += '<p class="sec">終えた時 → 今</p><div class="list">' + tenCh.map((m) => { const a = last.content.ten[m] || 0, b = s.ten[m] || 0; return '<div class="li"><span class="b">' + esc(s.name(m)) + '</span><span class="li-v">' + fmt(a) + ' →</span><span class="' + sign(b) + ' b">' + fmt(b) + '</span></div>'; }).join('') + '</div>';
      }
      h += errLine + closeArea('今の中身で対局終了し直す');
      if (!partial) h += '<button class="btn btn-line" id="sSnap">終えた時のまま見る</button>';
      el.innerHTML = h; wireSeisanAll(d, settles.length); return;
    }
    if (!viewSnap) {
      h += goBtn;
      // 飛び賞のヒント（B2・止めない）＝この対局の卓のどれかで飛んだのに飛び賞の行が全部0
      h += tobiHintLine(st.tables.some((t) => t.session_id === d.sid && !t.voided && tableView(st, t.table_id).tobiHint));
      if (!partial) {
        if (!s.noRateTables.length) h += '<p class="r-check ok">✓ ' + d.count + '回とも合計0' + (d.used.chip ? '・チップ0' : '') + (d.used.shugi ? '・祝儀0' : '') + (d.used.yaki ? '・やきとり0' : '') + (d.used.tobi ? '・飛び賞0' : '') + '</p>';
        else h += '<div class="r-red"><b>レートなしの卓は点に入れていません（pt で下に別に出します）</b></div>';
      }
    }
    if (!partial) {
      const pay = viewSnap ? last.content.pay : s.pay;
      const ten = viewSnap ? last.content.ten : s.ten;
      if (Object.keys(ten).length) {
        h += '<p class="sec">誰が誰に（' + pay.length + '回' + (viewSnap ? '' : 'で済む') + '）</p>';
        if (pay.length) h += '<div class="list">' + pay.map((x) => '<div class="li r-pay"><span class="minus b">' + esc(s.name(x.from)) + '</span><span class="plus b r-pay-to">→ ' + esc(s.name(x.to)) + '</span><span class="r-pay-n">' + x.ten.toLocaleString('ja-JP') + '</span></div>').join('') + '</div>';
        else h += '<p class="setsumei">払う人はいません。</p>';
        h += '<p class="sec">1人ずつ（点＝pt × レート）</p>';
        // 札は今の並び＋点にだけ在る人・内訳の無い人と終えた時のまま見る間は名前と額だけ（内訳は今の数＝控えと混ざる・N1）
        for (const m of d.order.concat(Object.keys(ten).filter((k) => !d.order.includes(k)))) {
          if (ten[m] === undefined) continue;
          const b = d.by[m];
          const head = '<div class="r-card"><div class="r-card-top"><span class="r-w-name">' + esc(s.name(m)) + '</span><span class="r-card-big ' + sign(ten[m]) + '">' + fmt(ten[m]) + '</span></div>';
          if (!b || viewSnap) { h += head + '</div>'; continue; }
          const parts = ['半荘 ' + b.n + '回 ' + fmtPt(b.han)];
          if (d.used.chip) parts.push('チップ ' + fmtCnt(b.chip) + '枚 ' + fmtPt(b.chip10));
          if (d.used.shugi) parts.push('祝儀 ' + fmtCnt(b.shugi) + '枚 ' + fmtPt(b.shugi10));
          if (d.used.yaki) parts.push('やきとり ' + fmtCnt(b.yaki) + '枚 ' + fmtPt(b.yaki10));
          if (d.used.tobi) parts.push('飛び賞 ' + fmtCnt(b.tobi) + '枚 ' + fmtPt(b.tobi10));
          const total10 = b.han + b.chip10 + b.shugi10 + b.yaki10 + b.tobi10 + b.cust10; // lib の kei と同じ足し方
          h += head + '<div class="r-card-sub">' + parts.map(esc).join('　') + '</div><div class="r-card-kei">計 ' + (Object.keys(b.kei).length ? keiText(b.kei) : fmtPt(total10) + 'pt') + '</div></div>';
        }
      }
      const nr = Object.entries(s.pt10NoRate || {});
      if (nr.length && !viewSnap) h += '<p class="sec">レートなしの卓（pt）</p><div class="list">' + nr.map(([m, x]) => '<div class="li"><span>' + esc(s.name(m)) + '</span><span class="' + sign(x) + ' b">' + fmtPt(x) + 'pt</span></div>').join('') + '</div>';
    }
    if (!viewSnap) h += splitHtml(d.sid, partial);
    if (viewSnap) h += '<button class="btn btn-line" id="sNow">今の数に戻る</button>';
    else if (!last && !room.closed) {
      h += errLine + closeArea('対局終了');
      h += '<p class="r-hint">対局終了すると、次に開いた時は新しい対局になる（この対局の点は消えない）。単位は点（円は出さない）。</p>';
    }
    el.innerHTML = h;
    wireSeisanAll(d, settles.length);
  }
  function wireSeisanAll(d, revs) { wireSeisan(d, revs); wireFix(); wireBands(); }
  // C4 §5：開催の取り消していない卓の鎖の頭（区切っていない卓は自分）
  function chainHeads(sid) {
    const live = st.tables.filter((t) => t.session_id === sid && !t.voided);
    return live.filter((t) => !st.tables.some((x) => x.next_table_id === t.table_id)).map((t) => t.table_id);
  }
  /* C4 §3b・§5：精算の内訳を区切りごとに（式は変えない＝卓ごとの tableView の数を出すだけ）。
   * 鍵が違う区切り（split_same でない）で前の卓に枚の行が残っている時だけ、その欄に［直す］＝今の値を出し、打った値を extra_set（前の卓のまま） */
  function splitHtml(sid, partial) {
    let h = '';
    for (const head of chainHeads(sid)) {
      const v = chainView(st, head);
      if (v.parts.length < 2) continue;
      v.parts.forEach((p, i) => {
        const from = i === 0 ? 1 : v.splits[i - 1].upto + 1, upto = i < v.splits.length ? v.splits[i].upto : v.rows.length;
        const range = i === v.parts.length - 1 ? from + '回目から' : from === upto ? from + '回目' : upto < from ? '回なし' : from + '〜' + upto + '回目';
        const fix = i < v.splits.length && !v.splits[i].same && st.extras.some((e) => e.table_id === p.table_id);
        h += '<p class="sec" data-part="' + i + '">' + esc(range) + '</p><div class="list" data-part-t="' + esc(p.table_id) + '">';
        for (const w of p.windows) {
          const bits = [];
          if (!partial) bits.push('半荘 ' + fmtPt(w.hanPt10));
          for (const { kind, label } of KINDS) if (p.used[kind] && !fix) bits.push(label + ' ' + fmtCnt(w[kind]) + '枚');
          h += '<div class="li"><span class="b">' + esc(w.name) + '</span><span class="li-v">' + esc(bits.join('・')) + '</span></div>';
          if (!fix || room.closed) continue;
          for (const { kind, label } of KINDS) {
            if (!p.used[kind]) continue;
            const on = fixing && fixing.t === p.table_id && fixing.m === w.member_id && fixing.kind === kind;
            const key = esc(p.table_id + '|' + w.member_id + '|' + kind);
            h += '<div class="li li-sub" data-fixrow="' + key + '"><span>' + label + '</span><span class="li-v">' + (on
              ? '<input class="box" id="sFixV" inputmode="numeric" value="' + esc(fmtCnt(w[kind])) + '" autocomplete="off" aria-label="' + esc(w.name) + 'の' + label + 'の枚"><button type="button" class="btn-s" id="sFixNeg" aria-label="＋−を替える">±</button><button type="button" class="btn-s" id="sFixGo">入れる</button>'
              : '<b class="r-fixv">' + fmtCnt(w[kind]) + '</b>枚<button type="button" class="btn-s" data-fix="' + key + '"' + (closingOn() ? ' disabled' : '') + '>直す</button>') + '</span></div>';
          }
        }
        h += '</div>';
        if (fix && fixing && fixing.err && fixing.t === p.table_id) h += '<p class="err" id="sFixErr">' + esc(fixing.err) + '</p>';
      });
    }
    return h;
  }
  function wireFix() {
    for (const b of el.querySelectorAll('[data-fix]')) b.onclick = () => { const [t, m, kind] = b.dataset.fix.split('|'); fixing = { t, m, kind }; render(); const i = el.querySelector('#sFixV'); if (i) i.focus(); };
    const neg = el.querySelector('#sFixNeg'), go = el.querySelector('#sFixGo'), inp = el.querySelector('#sFixV');
    if (neg) neg.onclick = () => { const x = toInt(inp.value); if (!Number.isNaN(x)) inp.value = fmtCnt(-x); };
    if (go) go.onclick = () => {
      const x = toInt(String(inp.value).replace(/^\+/, ''));
      if (Number.isNaN(x) || Math.abs(x) > 999) { fixing = { ...fixing, err: '枚は −999〜999 の整数です。' }; render(); return; }
      const row = st.extras.find((e) => e.table_id === fixing.t && e.member_id === fixing.m && e.kind === fixing.kind);
      // base_version＝写しの行の版・行が無ければ 0（conflict は今の並びの帯＝［捨てる］で読み直す）
      const r = commit([{ op: 'extra_set', table_id: fixing.t, member_id: fixing.m, kind: fixing.kind, value: x, base_version: row ? row.version : 0 }]);
      if (!r.ok) { fixing = { ...fixing, err: '入れられませんでした（' + r.err + '）' }; render(); return; }
      fixing = null; render();
    };
  }
  function wireSeisan(d, revs) {
    const q = (x) => el.querySelector(x);
    const goMissing = () => {
      confirming = false;
      const m = d.s.missing[0];
      if (m && m.no) {
        const t = st.tables.filter((x) => x.session_id === d.sid)[(m.table || 1) - 1];
        const h = t && st.hanchans.find((x) => x.table_id === t.table_id && x.no === m.no);
        if (h) { startEntry(h.hanchan_id); return; }
      }
      toRoom();
    };
    // §3 settle_snap：content（精算の中身）・used（使った版）・missing（入っていない物の一覧＝n件のまま終えた時はここに残る）。at は倉庫の now()
    const doClose = () => {
      const s = d.s;
      const ss = st.sessions.find((x) => x.session_id === d.sid);
      // 使った版（S2 v1.1 D'）＝取り消していない卓だけ・卓は実際に使ったレート（倉庫は used の中身を見ない）
      const tabs = st.tables.filter((t) => t.session_id === d.sid && !t.voided);
      const used = {
        session: { session_id: d.sid, date: ss.date, rate: ss.rate, version: ss.version ?? 1 },
        tables: tabs.map((t) => ({ table_id: t.table_id, rate_mode: rateModeOf(t), rate: tableRate(t, ss), version: t.version ?? 1 })),
        hanchans: st.hanchans.filter((h) => tabs.some((t) => t.table_id === h.table_id)).map((h) => ({ hanchan_id: h.hanchan_id, table_id: h.table_id, version: h.version, cell_ver: h.cell_ver.slice(), order_version: h.order_version, tobi_version: h.tobi_version, yakitori_version: h.yakitori_version ?? 1 })),
      };
      const r = commit([{ op: 'settle_snap', session_id: d.sid, rev: revs + 1, content: { ten: s.ten, pt10: s.pt10, pt10NoRate: s.pt10NoRate, pay: s.pay, sig: sessionSig(st, d.sid) }, used, missing: s.missing }]);
      confirming = false;
      closeErr = r.ok ? null : (r.err || '?');
      if (r.ok) viewSnap = false;
      render();
    };
    if (q('#sClose')) q('#sClose').onclick = () => {
      if (d.s.missing.length) { confirming = true; closeErr = null; render(); return; } // 1回目は確かめだけ
      doClose();
    };
    if (q('#sClose2')) q('#sClose2').onclick = () => { if (confirming) doClose(); };
    if (q('#sBack')) q('#sBack').onclick = goMissing;
    if (q('#sGo')) q('#sGo').onclick = goMissing;
    if (q('#sSnap')) q('#sSnap').onclick = () => { viewSnap = true; render(); };
    if (q('#sNow')) q('#sNow').onclick = () => { viewSnap = false; render(); };
  }

  function plusMinus(mid, kind, add) {
    if (writeBlocked()) return blockRes(); // ★写しに直に保存する前（applyOps より前）で止める★（± は commit を通らない・v3.1 naoshi）
    const r = applyOps(st, [{ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add, follow: true }], { roomRules: room.rules });
    if (!r.ok) { pmErr = r.res && r.res.at === 'member_id' ? 'この人はこの卓の席にいないので、入れられませんでした' : '入れられませんでした'; render(); return; }
    pmErr = null; ruleNote = null;
    st = r.state; save(KEY(uid, rid), st);
    const k = mid + '|' + kind;
    merge.set(k, (merge.get(k) || 0) + add);
    clearTimeout(mergeTimer);
    mergeTimer = setTimeout(flushMerge, 300); // 2c-2f：最後の押しから 0.3秒で並べる（1秒未満で他の端末へ）
    render();
  }
  // noSend＝読みの置き換えの前（並びに入れるだけ・送りは置き換えの後）
  function flushMerge(quiet, noSend) {
    clearTimeout(mergeTimer);
    if (writeBlocked()) return blockRes(); // 並びに積む前で止める（merge も消さない＝閉じた部屋では写しにだけ在る ± を closedHold が数える）
    const ops = [];
    for (const [k, add] of merge) { if (!add) continue; const [mid, kind] = k.split('|'); ops.push({ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add, follow: true }); }
    merge.clear();
    if (!ops.length || st.needs_upload) return; // needs_upload の部屋は写しが元（並びに積まない）
    for (let i = 0; i < ops.length; i += OPS_MAX) outbox.push({ op_id: uuid(), ops: ops.slice(i, i + OPS_MAX) }); // 30個ごとの組
    save(OUT(uid, rid), outbox);
    if (noSend === true) return;
    sendOutbox(); if (!quiet && page === 'room') render();
  }
  flushNow = () => flushMerge(true);

  function wireRoom() {
    const q = (s) => el.querySelector(s);
    if (q('#rAdd')) q('#rAdd').onclick = () => { if (!writeBlocked()) needTable(() => startEntry(null)); };
    for (const b of el.querySelectorAll('[data-seats]')) b.onclick = () => { if (!room.closed) needTable(() => { picking = { seats: preSeats() || [], only: true }; page = 'pick'; render(); }); };
    if (q('#rSeisan')) q('#rSeisan').onclick = () => { page = 'seisan'; viewSnap = false; confirming = false; closeErr = null; render(); };
    for (const b of el.querySelectorAll('.r-no')) b.onclick = () => { if (!room.closed) startEntry(b.dataset.h); };
    for (const b of el.querySelectorAll('.r-pm')) b.onclick = () => plusMinus(b.dataset.m, b.dataset.k, Number(b.dataset.a));
  }
  function wirePick() {
    const q = (s) => el.querySelector(s);
    const inp = q('#pNew');
    inp.addEventListener('input', drawCand);
    inp.addEventListener('compositionend', drawCand);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { const b = q('[data-new]') || q('#pSame'); if (b) b.click(); } });
    for (const b of q('#pBase').querySelectorAll('[data-pick]')) b.onclick = () => { if (seat(b.dataset.pick)) renderPick(); };
    for (const b of q('#pBase').querySelectorAll('[data-hist]')) b.onclick = () => { const r = addMember(b.dataset.hist); pickDone(r.mid || r.dup); };
    q('#pGo').onclick = () => {
      const seats = picking.seats.slice(), only = picking.only;
      // 取り消していない半荘が0本の卓だけ、卓の席を倉庫へ（op table_seats・only でも同じ）。半荘が在る時は送らない（entry.seats＝半荘の席）
      if (!st.hanchans.some((h) => inChain(h.table_id) && !h.voided)) {
        const r = commit([{ op: 'table_seats', table_id: table.table_id, seats }]);
        if (!r.ok) { el.querySelector('#pErr').textContent = '卓の席を残せませんでした。もう一度押してください。'; return; }
      }
      picking = null;
      if (only) { toRoom(); return; }
      entry = { seats, no: chainView(st, table.table_id).nextNo, R, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [] };
      page = 'edit'; render();
    };
  }
  function wireCand() {
    const q = (s) => el.querySelector(s);
    const box = q('#pCand');
    for (const b of box.querySelectorAll('[data-pick]')) b.onclick = () => pickDone(b.dataset.pick);
    for (const b of box.querySelectorAll('[data-hist]')) b.onclick = () => { const r = addMember(b.dataset.hist); pickDone(r.mid || r.dup); };
    const nb = box.querySelector('[data-new]');
    if (nb) nb.onclick = () => { const r = addMember(q('#pNew').value.trim()); if (r.err) { q('#pErr').textContent = r.err; return; } pickDone(r.mid || r.dup); };
    if (q('#pSame')) q('#pSame').onclick = () => pickDone(q('#pSame').dataset.m);
    if (q('#pOther')) q('#pOther').onclick = () => { const i = q('#pNew'); i.value = q('#pOther').dataset.n + '2'; drawCand(); i.focus(); };
  }
  function wireEdit() {
    const q = (s) => el.querySelector(s);
    q('#eOk').onclick = entryNext;
    for (const inp of el.querySelectorAll('[data-c]')) {
      inp.addEventListener('input', liveUpdate);
      // 勧めた残りは押せば値になる（全部を選ぶ＝打てば上書き）
      inp.addEventListener('focus', () => { if (inp.value.trim() !== '' || !inp.placeholder) return; inp.value = inp.placeholder; liveUpdate(); inp.select(); });
      // 絵 nyuryoku4 ③＝枠の素点は「20,100」と区切って見せる（打っている間はそのまま・離れたら区切る）
      inp.addEventListener('blur', () => { const v = toInt(inp.value); if (!Number.isNaN(v)) { inp.value = boxNum(v); readCells(); } });
    }
    if (q('#eLost')) q('#eLost').addEventListener('input', liveUpdate);
    // 数字鍵盤：今の箱（kpInp）に入った時の最初の数の鍵は中身を置き換える（勧めた残りも打ち直せる）
    const kp = q('#eKp');
    if (kp) {
      let kpInp = null, kpFresh = false;
      const boxes = () => [...el.querySelectorAll('[data-c]'), ...(q('#eLost') ? [q('#eLost')] : [])];
      const kpClose = () => { const x = kpInp; kpInp = null; kp.hidden = true; q('#eKpSp').hidden = true; if (x) x.blur(); };
      const kpKey = (k) => {
        if (!kpInp) return;
        if (k === 'ok') return kpClose();
        if (k === 'next') { const bs = boxes(), j = bs.indexOf(kpInp); if (j >= 0 && j + 1 < bs.length) bs[j + 1].focus(); else kpClose(); return; }
        const t = kpInp.value.trim();
        let neg = /^[-−ー－]/.test(t), digits = (neg ? t.slice(1) : t).replace(/[^0-9]/g, '');
        if (/^[0-9]+$/.test(k)) {
          if (kpFresh) { if (digits) neg = false; digits = ''; }
          const d = (digits + k).replace(/^0+(?=d)/, '');
          if (d.length > 6) return; // ±200,000（CELL_MAX）より長い数は打たせない
          digits = d;
        } else if (k === 'bs') { if (digits) digits = digits.slice(0, -1); else neg = false; }
        else if (k === 'neg') neg = !neg;
        kpFresh = false;
        kpInp.value = (neg ? '−' : '') + (digits === '' ? '' : Number(digits).toLocaleString('ja-JP'));
        liveUpdate();
      };
      kp.addEventListener('mousedown', (ev) => ev.preventDefault()); // 鍵を押しても箱から focus を外さない
      for (const b of kp.querySelectorAll('[data-kp]')) b.onclick = () => kpKey(b.dataset.kp);
      for (const inp of boxes()) {
        inp.addEventListener('focus', () => { kpInp = inp; kpFresh = true; kp.hidden = false; q('#eKpSp').hidden = false; inp.scrollIntoView({ block: 'nearest' }); });
        inp.addEventListener('blur', (ev) => { if (kpInp === inp && !boxes().includes(ev.relatedTarget)) kpClose(); });
        // 机の鍵盤（パソコン）も同じ動き
        inp.addEventListener('keydown', (ev) => {
          const k = /^[0-9]$/.test(ev.key) ? ev.key : { '-': 'neg', Backspace: 'bs', Enter: 'next', Escape: 'ok' }[ev.key];
          if (!k || ev.isComposing) return;
          ev.preventDefault(); kpKey(k);
        });
      }
    }
    if (q('#ePeople')) q('#ePeople').onclick = () => { readCells(); picking = { seats: entry.seats.slice() }; entry = null; page = 'pick'; render(); };
    if (q('#eVoid')) q('#eVoid').onclick = () => { commit([{ op: entry.voided ? 'hanchan_unvoid' : 'hanchan_void', hanchan_id: entry.hanchan_id }]); toRoom(); };
    if (q('#eOrdReset')) q('#eOrdReset').onclick = () => { entry.order = []; render(); };
    for (const b of el.querySelectorAll('[data-ord]')) b.onclick = () => { const i = Number(b.dataset.ord); if (!entry.order.includes(i)) entry.order.push(i); render(); };
  }

  window.addEventListener('pagehide', flushMerge);

  // ── 読み直しの時計（2d §3）：開いた時・送りで並びが空になった時・10秒ごと（頁が見えている間だけ）・見えた時・'online' の時 ──
  const poll = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') sync(); }, POLL_MS);
  const tick = setInterval(refreshTag, 2000); // 30秒の札を出す（描くのは札が変わった時だけ）
  const onVis = () => { if (document.visibilityState === 'visible') sync(); };
  const onOnline = () => { kick(); sync(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);
  unmountPrev = () => {
    flushMerge(true, true);
    dead = true;
    clearInterval(poll); clearInterval(tick); clearTimeout(retryTimer); clearTimeout(mergeTimer); clearTimeout(gapTimer);
    leaveChan(); // 2c-2f：部屋を出る・別の部屋へ移る時は合図から外す
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
  };
  mounted = true;
  joinChan(); // 2c-2f：控えの channel_key で合図に入る（無ければ最初の mj_read の後に roomInfo で入る）
  render();
  sync(); // 開いた時（読み終えたら並びを送る）
}
