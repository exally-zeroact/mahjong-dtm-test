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
 */
import { emptyState, applyOps, tableView, sessionSeisan, sessionBreakdown, tenChanged, tableRate, rateModeOf, checkEntry, pickSession, sessionSig, migrateState, roomGate, gateText, orderIdx, canon, OPS_MAX, CELL_MAX, LOST_MAX } from '../lib/room-state.mjs';
import { heldInfo, outboxStep, retryDelay, holdHead, dropHead, canSend, heldClosed } from '../lib/outbox.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';
import { nameKey } from '../lib/name-key.mjs';
import { esc, uuid, sb, patchRoom } from './gamen-core.mjs';
import { mountRules } from './gamen-rules.mjs';

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

export function mountRoom(el, { me, room, showShare, bar, page: first, relogin }) {
  if (unmountPrev) { const u = unmountPrev; unmountPrev = null; u(); }
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
  const cn = (x) => canon(JSON.parse(JSON.stringify(x === undefined ? null : x))); // JSON を通してから鍵の順に左右されない字（倉庫の jsonb を回っても同じ・v4.3）
  const merge = new Map(); let mergeTimer = null; // extra_add の1秒まとめ
  const toRoom = () => { page = 'room'; entry = null; picking = null; viewSnap = false; confirming = false; closeErr = null; pmErr = null; render(); };

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
  const closedHold = () => !!room.closed && (outbox.length > 0 || !!st.needs_upload); // 約束③・足し①（held は見ない）
  const staleRead = () => WRITE_READY && !stopped && !st.needs_upload && !closedHold() && Date.now() - lastIn > STALE_MS;

  function commit(ops) {
    flushMerge(true); // 1秒まとめを先に並べる（並びの順＝押した順）
    const r = applyOps(st, ops, { now: new Date().toISOString(), roomRules: room.rules });
    if (!r.ok) return r.res;
    st = r.state;
    // needs_upload の部屋（古い写しを直した部屋）は写しが唯一の元＝並びに積まない（2d が写しから作る）
    if (!st.needs_upload) { outbox.push({ op_id: uuid(), ops }); save(OUT(uid, rid), outbox); }
    save(KEY(uid, rid), st); // ★並びを先・写しを後★
    sendOutbox();
    return { ok: true };
  }
  /* 控えに部屋の rules・closed を足す（★行だけ書き換える＝ホームの並びと at を変えない★・約束④⑦） */
  function roomInfo(r) {
    if (!r || typeof r !== 'object') return;
    const patch = {};
    if (r.rules && typeof r.rules === 'object' && cn(r.rules) !== cn(room.rules)) patch.rules = r.rules;
    if (r.closed === true && !room.closed) patch.closed = true;
    if (!Object.keys(patch).length) return;
    Object.assign(room, patch);
    patchRoom(uid, rid, patch);
    st.rules = room.rules;
  }
  function loginStop(err) { stopped = 'login'; loginErr = err || 'mj_session'; clearTimeout(retryTimer); rerender(); }
  function goneStop() { stopped = 'gone'; clearTimeout(retryTimer); rerender(); }
  // 置き換えた後に描くのは room・seisan・rules の頁だけ（edit・pick は入れ物・focus・打ちかけを壊さない＝出る時に描く・v2 止め2）
  function rerender() { if (!dead && ['room', 'seisan', 'rules'].includes(page)) render(); }
  function tagKey() { return [liveTag(), staleRead(), stopped, gateNote, startMsg, outbox.length, heldInfo(outbox) && heldInfo(outbox).why, !!room.closed].join('|'); }
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
    if (!outbox.length || outbox[0].op_id !== head.op_id) { kick(); return; }
    const s = outboxStep(res);
    if (s.kind !== 'retry') { retryN = 0; clearTimeout(retryTimer); }
    if (s.kind === 'done') {
      outbox = outbox.slice(1); save(OUT(uid, rid), outbox);
      refreshTag();
      if (outbox.length) { sendOutbox(); return; }
      if (pendingStart) { kick(); return; }
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
    if (syncAgain && !stopped) { syncAgain = false; sync(); return; } // sync の終わりでまた kick される
    if (pendingStart) {
      if (heldInfo(outbox) || stopped) { pendingStart = null; startMsg = null; rerender(); return; }
      if (!outbox.length && !merge.size) { const t = pendingStart; pendingStart = null; startShared(t); return; }
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
  async function sync() {
    if (!WRITE_READY || dead || stopped) return;
    if (lane) { syncAgain = true; return; }
    if (offline()) { refreshTag(); return; }
    lane = true;
    const res = await readRoom(rid, since);
    lane = false;
    if (dead) return;
    const k = takeRead(res);
    if (k === 'ok') rerender(); else refreshTag();
    kick();
  }

  /* ── 卓を決める ── */
  let table = null, R = room.rules, n = R.players, kieru = false;
  function setTable(t) { table = t || null; R = table ? table.rules : room.rules; n = R.players; kieru = R.kyotaku_end === 'kieru'; }
  function ensureTable() {
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
    if (dead || stopped) return;
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
      else h += '<div class="r-red" id="rHeld"><b>未送信 ' + hi.n + ' 件・この書き込みは入れられません（' + esc(HELD_WHY[hi.why] || hi.why) + '）</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
    }
    if (gateNote) h += '<div class="r-red" id="rGateNote"><b>' + esc(gateNote) + '</b></div>';
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
    if (page === 'edit') return renderEdit();
    if (page === 'pick') return renderPick();
    if (page === 'seisan') return renderSeisan();
    if (page === 'rules') return renderRules();
    // ［点数］＝点数計算（記録しない道具・tensu.html）へ。卓のルールを ?r= に、戻り先を ?from= に渡す（tensu.js の頭の取り決め）
    const ten = '/tensu.html?r=' + encodeURIComponent(JSON.stringify(room.rules)) + '&from=' + encodeURIComponent(location.pathname + location.search);
    bar({ back: 'ホーム', title: '対局', right: 'ルール', onRight: () => { page = 'rules'; render(); }, ten });
    // 卓がまだ無い（shared で開催を倉庫で決める前）＝部屋のルールで空の表だけ出す（最初の点で startShared）
    const v = table ? tableView(st, table.table_id) : { date: today(), rate: room.rules.rate ?? null, rows: [], nextNo: 1, windows: [], seatPeople: [] };
    shownTag = tagKey();
    let h = '<div class="r-top"><span>' + esc(md(v.date)) + '・' + rateText(v.rate) + '</span>' + liveTag() + '</div>' + bandsHtml();
    h += v.rows.length ? renderTable(v) : renderHead(preSeats());
    h += '<button class="btn btn-main r-add" id="rAdd">' + v.nextNo + '回目の点を入れる</button>';
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
    const cells = ps ? ps.map((m) => '<th><button type="button" class="r-nm" data-seats="1" aria-label="' + esc(nameOf(m)) + '・人を選び直す">' + esc(nameOf(m)) + '</button></th>')
      : Array.from({ length: n }, () => '<th><button type="button" class="r-nm r-nm-add" data-seats="1">＋名前</button></th>');
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
      h += '<tr class="' + (r.voided ? 'r-void' : '') + '"><th><button class="r-no" data-h="' + esc(r.hanchan_id) + '" aria-label="' + r.no + '回目を直す">' + r.no + '回</button></th>';
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
          '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="-1" aria-label="' + esc(w.name) + 'の' + label + 'を減らす">−</button>' +
          '<span class="r-cnt">' + fmtCnt(w[kind]) + '</span>' +
          '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="1" aria-label="' + esc(w.name) + 'の' + label + 'を増やす">＋</button>' +
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
    if (bad.length) return tobiHintLine(v.tobiHint) + '<p class="r-check bad">' + esc(bad.join('・')) + '</p>';
    const okParts = [];
    for (const { kind, label } of KINDS) if (v.used[kind]) okParts.push(label + 'の合計 0');
    okParts.push('合計 0');
    return tobiHintLine(v.tobiHint) + '<p class="r-check ok">✓ ' + okParts.join('・') + '</p>';
  }

  function renderRules() {
    bar({ back: '対局', onBack: toRoom, title: 'ルール' });
    shownTag = tagKey();
    el.innerHTML = '<div id="rRules"></div>' + (showShare ? '<button class="btn btn-line" id="rShare">部屋名と URL</button>' : '');
    mountRules(el.querySelector('#rRules'), { rules: { ...R, rate: table ? tableView(st, table.table_id).rate : room.rules.rate ?? null }, readOnly: true });
    if (showShare) el.querySelector('#rShare').onclick = showShare;
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

  function lastSeats() {
    const hs = st.hanchans.filter((x) => x.table_id === table.table_id && !x.voided);
    return hs.length ? hs[hs.length - 1].seats.slice() : null;
  }
  function startEntry(hid) {
    if (hid) {
      const x = st.hanchans.find((y) => y.hanchan_id === hid);
      entry = { hanchan_id: hid, no: x.no, seats: x.seats.slice(), cells: x.cells.map((v) => boxNum(Number(v))), lost: String(x.lost || 0), step: 'cells', order: orderIdx(x) || [], voided: x.voided,
        // 開いた時の値と版（2d §3「edit の entry の版は今のまま」＝読み直しで写しが替わっても、ぶつかれば conflict で止める）
        orig: { cells: x.cells.slice(), cell_ver: x.cell_ver.slice(), lost: x.lost, version: x.version, ton_order: x.ton_order, order_version: x.order_version } };
    } else {
      const seats = lastSeats() || preSeats(); // 半荘が在れば前の席・無ければ前もって決めた卓の人
      if (!seats) { picking = { seats: [] }; page = 'pick'; render(); return; }
      entry = { seats, no: tableView(st, table.table_id).nextNo, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [] };
    }
    page = 'edit'; render();
  }
  function liveCalc() {
    const e = entry;
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
      const op = { op: 'hanchan_start', hanchan_id: uuid(), table_id: table.table_id, seats: e.seats, cells: e.num, lost: e.lostNum };
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
  function missingText(m, many) {
    const pre = many ? '卓' + m.table + '：' : '';
    if (m.no) {
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
    const settles = st.settles.filter((x) => x.session_id === d.sid);
    const last = settles[settles.length - 1];
    const lastMissing = last ? (last.missing || []) : [];
    const partial = lastMissing.length > 0 || s.missing.length > 0;
    if (partial) viewSnap = false; // 終えた時の額を見る道も無い（N2）
    const tenCh = last && !partial ? tenChanged(last.content.ten, s.ten) : []; // 鍵を合わせて比べる（S2 v1.1 止め2）
    const changed = !!last && (partial ? cn(lastMissing) !== cn(s.missing) : tenCh.length > 0);
    const many = d.tables > 1;
    const goBtn = s.missing.length ? '<button class="r-red r-red-btn" id="sGo"><b>入っていない物 ' + s.missing.length + '件</b>' + s.missing.map((m) => '<span>・' + esc(missingText(m, many)) + '</span>').join('') + '<span class="r-link">押すとその場所へ</span></button>' : '';
    const errLine = closeErr ? '<div class="r-red"><b>対局終了を残せませんでした（' + esc(closeErr) + '）</b></div>' : '';
    // ［対局終了］の所＝入っていない物があれば1回目は確かめ（同じ位置に［戻って入れる］・その下に赤の箱と［n件のまま対局終了］）
    const closeArea = (label) => (confirming && s.missing.length
      ? '<button class="btn btn-line" id="sBack">戻って入れる</button><div class="r-red"><b>入っていない物 ' + s.missing.length + '件のまま終了します。この対局の額は出しません</b></div><button class="btn btn-main" id="sClose2">' + s.missing.length + '件のまま対局終了</button>'
      : '<button class="btn btn-main" id="sClose">' + label + '</button>');
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
    if (viewSnap) h += '<button class="btn btn-line" id="sNow">今の数に戻る</button>';
    else if (!last) {
      h += errLine + closeArea('対局終了');
      h += '<p class="r-hint">対局終了すると、次に開いた時は新しい対局になる（この対局の点は消えない）。単位は点（円は出さない）。</p>';
    }
    el.innerHTML = h;
    wireSeisanAll(d, settles.length);
  }
  function wireSeisanAll(d, revs) { wireSeisan(d, revs); wireBands(); }
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
    const r = applyOps(st, [{ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add }], { roomRules: room.rules });
    if (!r.ok) { pmErr = r.res && r.res.at === 'member_id' ? 'この人はこの卓の席にいないので、入れられませんでした' : '入れられませんでした'; render(); return; }
    pmErr = null;
    st = r.state; save(KEY(uid, rid), st);
    const k = mid + '|' + kind;
    merge.set(k, (merge.get(k) || 0) + add);
    clearTimeout(mergeTimer);
    mergeTimer = setTimeout(flushMerge, 1000);
    render();
  }
  // noSend＝読みの置き換えの前（並びに入れるだけ・送りは置き換えの後）
  function flushMerge(quiet, noSend) {
    clearTimeout(mergeTimer);
    const ops = [];
    for (const [k, add] of merge) { if (!add) continue; const [mid, kind] = k.split('|'); ops.push({ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add }); }
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
    q('#rAdd').onclick = () => needTable(() => startEntry(null));
    for (const b of el.querySelectorAll('[data-seats]')) b.onclick = () => needTable(() => { picking = { seats: preSeats() || [], only: true }; page = 'pick'; render(); });
    if (q('#rSeisan')) q('#rSeisan').onclick = () => { page = 'seisan'; viewSnap = false; confirming = false; closeErr = null; render(); };
    for (const b of el.querySelectorAll('.r-no')) b.onclick = () => startEntry(b.dataset.h);
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
      if (!st.hanchans.some((h) => h.table_id === table.table_id && !h.voided)) {
        const r = commit([{ op: 'table_seats', table_id: table.table_id, seats }]);
        if (!r.ok) { el.querySelector('#pErr').textContent = '卓の席を残せませんでした。もう一度押してください。'; return; }
      }
      picking = null;
      if (only) { toRoom(); return; }
      entry = { seats, no: tableView(st, table.table_id).nextNo, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [] };
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
    clearInterval(poll); clearInterval(tick); clearTimeout(retryTimer); clearTimeout(mergeTimer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
  };
  mounted = true;
  render();
  sync(); // 開いた時（読み終えたら並びを送る）
}
