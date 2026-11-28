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
 * A6（a6_sadame v1.3・司さん 11-23「部屋を消せない」）＋A27（a27_sadame v1.1）：［ルール］の頁の［部屋を終える］の下に［部屋を消す］（owner だけ・リーグの対局は外す）。印 mj-pending-delete:<uid>:<rid>＝同じ op_id で送り直す。
 *   通った（か印が在る時の gone）＝この端末の並び・終える印を消し、控えの行に deleted_at→ホーム（7日の間はホームの帯から戻せる）。印の無い gone＝控えに gone:true（ホームのカードに出さない・次の ok の読みで外す）。
 * B3b-1（gamen_b3b_sadame.md v4.1）：［ルール］の頁に［部屋を終える］（kan か owner・shared で終えていない部屋だけ）。
 *   送る前に必ず flushMerge(true)→未送信0 の門（頁を出す時・窓を開く時・窓の［部屋を終える］の3回）。印 mj-pending-close:<uid>:<rid>＝同じ op_id で送り直す。
 *   書く口は writeBlocked()＝控えの closed か、印がある間（closing）＝commit・plusMinus・flushMerge の3口で止める。
 *   終えた部屋は読み専（見るだけ）・足し①（closed で未送信が在る）は精算と窓の額を出さない。
 * 2c-2f 合図（2c2f_sadame.md v1.2 §2）：部屋を開いたら控えの channel_key の公開の合図に入る（shared で終えていない部屋だけ）。
 *   送る＝mj_write が ok と read_ver（数）を返したら今の管から {v: read_ver} を1回（SUBSCRIBED の時だけ・待たない・失敗は捨てる）。
 *   受け＝v が since より大きい時だけすぐ sync（読み中・送り中は syncAgain）。読みの始めと始めの間は AIZU_GAP_MS（間が足りない読みは遅らせて必ず読む）。
 *   mj_read の返しの room.channel_key が控えと違えば控えを書き換えて付け直す（roomInfo＝takeRead の門より前）。± のまとめは 0.3秒。
 * D2（d2_sadame.md v1.1 §3・絵 mahjong_league_v157 ②）：mountRoom の league＝{ league_id }＝リーグの対局（taikyoku.html?room=<id>&league=<league_id>）。
 *   読みは mj_read 'league'（{league_id, since?}）・写しの鍵 mj-league:<uid>:<league_id>・並び mj-league-out:…・league と days の控え mj-league-info:…。
 *   applyOps に opts.scope＝{league_id, isL, rules, rules_alt, days}（lib §2）。合図は部屋の channel_key のまま。
 *   上の［卓1］［卓2］…は何卓でも横に流す（今の卓が見える所へ）・L にだけ［＋卓］（rules_alt の在る日は主の人数／もう一方を選ぶ）。
 *   L：開いている最後の日を開く・無ければ今日で session_add（期間の外は帯で作らない・dup は読み直して開く）。L でない入：開いている日を開く・無ければ待つ帯。
 * 卓の取り違えの守り（§3 止め2・ふつうの部屋でも）：選んだ卓は読み直しの後も残す（消えた・取り消された時だけ1つ目へ・帯）。
 *   入力・人を選ぶは開いた時の table_id に結ぶ（保存はその卓へ）・± のまとめの鍵は 卓|人|種（流す時もその卓へ）。
 * L でない入の1回目（§3 止め1）：リーグの日で L でない人は、半荘0本の卓でも table_seats を送らない（席は hanchan_start の seats だけ）。
 */
import { emptyState, applyOps, tableView, chainView, tableChain, needOf, WHO, sessionSeisan, sessionBreakdown, tenChanged, tableRate, rateModeOf, checkEntry, pickSession, sessionSig, migrateState, readArgs, sessionOfRef, roomGate, gateText, orderIdx, canon, tobiUsed, OPS_MAX, CELL_MAX, LOST_MAX } from '../lib/room-state.mjs';
import { heldInfo, outboxStep, retryDelay, holdHead, dropHead, canSend, heldClosed, aizuSendV, aizuReadV, AIZU_GAP_MS, unholdBusy, heldAny, heldHuman, unholdHuman } from '../lib/outbox.mjs';
import { fromMarks, marksFromOrder, sameTie, tapMark, labels } from '../lib/kamicha.mjs';
import { orderCovered } from '../lib/needs-order.mjs'; // A13 §6：保存した人が見た同点の組だけ ton_order が効く
import { nameKey } from '../lib/name-key.mjs';
import { nextSeats } from '../lib/league-round.mjs'; // L A23（l_sadame v1.3 §1 A23）：リーグの日の次の半荘の人（卓の席 t.seats が正・他の卓と重なれば選ぶ）
import { meiboErr, nameCheck, memberOp, memberUse, offText, pressOp } from '../lib/meibo.mjs'; // 8b A25r（a25r_sadame v2.1）：対局の画面の［名簿を直す］＝リーグの名簿と同じ部品
import { esc, uuid, sb, patchRoom, rpc, rpcRaw, errText, myRooms, humanCheck, ROOM_DEFAULT } from './gamen-core.mjs'; // 2b：mj_read・mj_write は rpcRaw（ログインの誤りなら鍵を1回引き直す・電波は送り直しの道）
import { mountRules, RULE_ERR } from './gamen-rules.mjs';
import { pickStart } from './rules-memory.mjs'; // A20 §1-7：途中で人数を押した時の覚え（A14 mj_my_rules・gamen-taikyoku と同じ取り込み）
import { rulesOk } from '../lib/rules.mjs';
import { mulS } from '../lib/safe-int.mjs'; // A18 §2：画面で掛けない（safe の外は null）
import { wireKeypad } from './kenban.mjs'; // A17：点の鍵盤も A8 の部品（−→1→0 で −10・入っている数は最初の数で置き換え・他の釦を押しても下の空きを残す）

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
/* P5（p5_sadame v1.3 §4）：a＝readArgs の {v:3, sessions, since?}（mountRoom の読み）か since（数・null）＝その時は {v:3} と since だけ（★v を付ける＝最後の3開催＋取り消していない最後だけが来る★） */
export async function readRoom(rid, a) {
  const args = a && typeof a === 'object' ? a : a === null || a === undefined ? { v: 3 } : { v: 3, since: a };
  try {
    return await rpcRaw('mj_read', { p_room_id: rid, p_what: 'room', p_args: args });
  } catch (e) { return { error: { message: String((e && e.message) || e) } }; }
}
/* D2：mj_read 'league'（返し＝{data,error,status} か {error}・readRoom と同じ形） */
export async function readLeague(rid, lid, since) {
  try {
    return await rpcRaw('mj_read', { p_room_id: rid, p_what: 'league', p_args: since === null || since === undefined ? { league_id: lid } : { league_id: lid, since } });
  } catch (e) { return { error: { message: String((e && e.message) || e) } }; }
}
/* D2：リーグの控え（league＝D1 §2 の形・days＝その日の版）。'league' の返しが ok で league が在る時だけ書く */
const LINFO = (uid, lid) => 'mj-league-info:' + uid + ':' + lid;
export function saveLeagueInfo(uid, lid, d) {
  if (!d || typeof d !== 'object' || !d.league || typeof d.league !== 'object') return null;
  const v = { league: d.league, days: Array.isArray(d.days) ? d.days : [] };
  try { localStorage.setItem(LINFO(uid, lid), JSON.stringify(v)); } catch { /* 書けなくても読みのたびに置く */ }
  return v;
}
export function hasLeagueInfo(uid, lid) { try { return !!localStorage.getItem(LINFO(uid, lid)); } catch { return false; } }
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
const BIG_TEXT = '数が大きすぎて計算できません'; // A18 §2：safe の外の額は出さない（窓・精算）
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

export function mountRoom(el, { me, room, showShare, bar, page: first, relogin, note, closedObi, reopen, league }) {
  leaveRoom();
  const uid = me.id, rid = room.room_id;
  // D2：リーグの対局は写し・並びを部屋と別の鍵に置く（部屋の写しとリーグの日を混ぜない）
  const LG = league && typeof league.league_id === 'string' && league.league_id ? league.league_id : null;
  const KEYR = LG ? 'mj-league:' + uid + ':' + LG : KEY(uid, rid);
  const OUTR = LG ? 'mj-league-out:' + uid + ':' + LG : OUT(uid, rid);
  let lgInfo = LG ? load(LINFO(uid, LG), null) : null; // { league, days }
  const isL = () => !!(lgInfo && lgInfo.league && lgInfo.league.l === true);
  const scope = () => (LG && lgInfo && lgInfo.league ? { league_id: LG, isL: isL(), rules: lgInfo.league.rules, rules_alt: lgInfo.league.rules_alt || null, days: lgInfo.days || [] } : null);
  // lib §2：scope の組が通ると返しに days（新しい日の版を足した物）＝控えの days を置き換える
  const takeDays = (a) => { if (LG && lgInfo && a && a.ok && Array.isArray(a.days)) { lgInfo = { ...lgInfo, days: a.days }; try { localStorage.setItem(LINFO(uid, LG), JSON.stringify(lgInfo)); } catch { /* 次の読みで置く */ } } };
  const aopts = (x) => { const sc = scope(); return { now: new Date().toISOString(), roomRules: room.rules, ...(sc ? { scope: sc } : {}), ...(x || {}) }; };
  // 古い形の写し（st.v が 2 でない）は形だけ直す（値は変えない・needs_upload＝倉庫へ上げるのは 2d）。
  // 直した時は古い並び（古い形の op）を捨て、★並びを先に保存してから写しを保存★（途中で落ちても次に開けば同じ直しになる）
  // ③-0 の門（yakitori_custom_v1.md v7〜v7.3）：gate が ok でない部屋は帯だけ出して return＝表・入れる所を1つも作らない・並びも積まない・保存しない
  const mig = migrateState(load(KEYR, emptyState()));
  const gateOnly = (g) => {
    bar({ back: 'ホーム', title: '対局' });
    el.innerHTML = '<div class="r-red" id="rGate"><b>' + esc(gateText(g)) + '</b></div>';
  };
  if (mig.gate.mode !== 'ok') { gateOnly(mig.gate); return; }
  let st = mig.st;
  if (!st.settles) st.settles = [];
  let outbox = mig.migrated ? [] : load(OUTR, []);
  let humanBusy = false; // P10 §4：確かめの窓が出ている間（［もう一度］を2重に押さない）
  if (heldHuman(outbox)) setTimeout(() => humanAgain(), 0); // P10 §4：開いた時に先頭が held human＝確かめを1回出す（通れば送る）
  if (mig.migrated) { save(OUTR, outbox); save(KEYR, st); }
  let page = first || 'room'; // room | edit | pick | seisan | rules
  let entry = null;
  let prefill = null; // E2 §6：始めがぶつかった（open／new）＝読み直した後にその回を開いて、この端末が打った数を空いた箱へ入れる
  let picking = null;
  let viewSnap = false;
  let confirming = false; // 入っていない物があるまま終える時の確かめ（開いている画面の間だけ）
  let endAsk = false;     // A27 §1：部屋の頁の［対局終了］を押した印＝精算の頁を描いた1回だけ使う（頭で必ず下ろす・精算の頁を離れたら下ろす）
  let closeErr = null;    // 対局終了を残せなかった時の err
  let goHome = false;     // A11：［対局終了］の後、並びを送り切ったらホームへ（端末に残さない・送れずに止まったら精算に残る）
  let pmErr = null;       // チップ等の［−］［＋］が弾かれた時の字（黙らない・v1.1）
  let dropAllAsk = false; // P6g §3：［全部捨てる］の確かめの段
  const HELD_GATE = '止まっている点を先に片付けてください'; // P6g §4 書きの門の字
  let ruleNote = null;    // C4 §3：開いていた卓が区切られて鎖の最後へ移った時の帯（次に書くまで出す）
  let ruleMsg = null;     // C4 §2：［このルールにする］（A20 で「次の回から」を消した）が通らなかった時の帯（ルールの頁）
  let ruleCtl = null;     // ルールの頁の打てる形（読み直しで描き直す時に打ちかけを残す）
  let ruleMem = null, ruleMemSeq = 0, ruleMemo = false; // A20 §1-7：覚えの読み（null＝まだ・'loading'・{memory}）・古い返しを捨てる番号・「読めない」帯を出す印
  let meBusy = false, meOp = null, meMsg = null, meRead = false; // C2-0（c20_sadame v2.1）［これは私］の直送（返りが切れた時は同じ組だけ同じ op_id）
  let ruleBusy = false, ruleOp = null, pendingRule = null; // table_rules の直送（返りが切れた時は同じ op_id）・並びを送り切ってから送る続き
  const cn = (x) => canon(JSON.parse(JSON.stringify(x === undefined ? null : x))); // JSON を通してから鍵の順に左右されない字（倉庫の jsonb を回っても同じ・v4.3）
  const merge = new Map(); let mergeTimer = null; // extra_add のまとめ（最後に押してから 0.3秒・2c-2f で 1秒→0.3秒）
  let fixing = null;      // C4 §3b：精算の内訳で［直す］を開いている前の卓の枚 { t, m, kind }
  const toRoom = () => { endAsk = false; page = 'room'; entry = null; picking = null; viewSnap = false; confirming = false; closeErr = null; pmErr = null; fixing = null; ruleCtl = null; ruleMsg = null; ruleMem = null; ruleMemSeq++; ruleMemo = false; render(); };

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
  if (WRITE_READY && !LG && !localStorage.getItem(SYNCED(uid, rid)) && !st.needs_upload && (st.members.length || st.sessions.length || outbox.length)) {
    st.needs_upload = true; save(KEYR, st);
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
  // P5 §3・§4：並びの当て直しで unloaded が出た開催（次の読みで sessions に足す）・その置き換えで読み直した回数（1回まで）・読めない間の帯
  const want = new Set();
  let unTry = 0;
  let loadNote = false;
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
  const writeBlocked = () => !!room.closed || closingOn() || stopped === 'deleted'; // A6：消した後（ホームへ移るまで）は何も積まない
  const blockRes = () => ({ ok: false, err: room.closed ? 'closed' : 'closing' });
  let closeUi = { open: closingOn(), msg: null, retry: false }; // 印が在れば確かめの窓を開いたまま（同じ op_id で送り直せる）
  let closeBusy = false;
  // A6：消す印（同じ op_id で送り直す・読み込み直しの後も2段目を開いたまま）
  const PDEL = 'mj-pending-delete:' + uid + ':' + rid;
  const delOn = () => { try { return !!localStorage.getItem(PDEL); } catch { return false; } };
  const dropDel = () => { try { localStorage.removeItem(PDEL); } catch { /* 消せなくても次の ok か gone で消す */ } };
  let delUi = { open: delOn(), msg: null, retry: delOn() }; // 印が在れば［もう一度］（自動では送らない）
  let delBusy = false;
  const staleRead = () => WRITE_READY && !stopped && !st.needs_upload && !closedHold() && Date.now() - lastIn > STALE_MS;

  function commit(ops) {
    if (writeBlocked()) return blockRes(); // ★flushMerge より前で判じる★（終えた部屋・終える送りの最中は写し・merge・並びのどれも変えない）
    if (heldAny(outbox)) return { ok: false, err: 'held', msg: HELD_GATE }; // P6g §4：held の間は書きの全部を止める（当て直しで held から後ろが画面から消え、入れ直すと2重）
    flushMerge(true); // 1秒まとめを先に並べる（並びの順＝押した順）
    const r = applyOps(st, ops, aopts());
    if (!r.ok) {
      if (r.res.err === 'unloaded') { const sid = sessionOfRef(st, outbox, r.res.at, r.res.id); if (sid) want.add(sid); loadNote = true; sync(); } // P5：その開催を読んでから
      return r.res;
    }
    st = r.state; takeDays(r);
    // needs_upload の部屋（古い写しを直した部屋）は写しが唯一の元＝並びに積まない（2d が写しから作る）
    if (!st.needs_upload) { outbox.push({ op_id: uuid(), ops }); save(OUTR, outbox); }
    save(KEYR, st); // ★並びを先・写しを後★
    ruleNote = null; takuNote = null;
    sendOutbox();
    return { ok: true };
  }
  /* 控えに部屋の rules・closed を足す（★行だけ書き換える＝ホームの並びと at を変えない★・約束④⑦） */
  function roomInfo(r) {
    if (!r || typeof r !== 'object') return;
    const patch = {};
    if (r.rules && typeof r.rules === 'object' && cn(r.rules) !== cn(room.rules)) patch.rules = r.rules;
    if (r.closed === true && !room.closed) patch.closed = true;
    if (typeof r.owner === 'boolean' && r.owner !== (room.owner === true)) patch.owner = r.owner; // A6 §1：mj_read の room だけが boolean の owner を持つ（2台目の持ち主の端末にも［部屋を消す］）
    if (typeof r.channel_key === 'string' && r.channel_key && r.channel_key !== room.channel_key) patch.channel_key = r.channel_key; // 2c-2f：名が変わった（room_secret など）＝控えを書き換えて付け直す
    if (!Object.keys(patch).length) return;
    Object.assign(room, patch);
    patchRoom(uid, rid, patch);
    st.rules = room.rules;
    if (patch.closed) { try { localStorage.removeItem(PCLOSE); } catch { /* 読めなくても closed が勝つ */ } if (!table && !closedHold()) setTable(closedTable()); } // 終わった＝終える送りの印は要らない
    if ((patch.channel_key || patch.closed) && mounted) joinChan(); // 2c-2f：新しい名へ付け直す（古い名は外す）・終えた部屋は外すだけ
  }
  /* A11 §1：送り切った（並び・1秒まとめ・続きが全部空）時だけホームへ。done 以外で終わった道は homeOff で落とす */
  function homeOff() { if (!goHome) return; goHome = false; rerender(); }
  function homeTry() {
    if (!goHome || dead || page !== 'seisan' || outbox.length || merge.size || st.needs_upload || pendingRule || pendingStart) return false;
    goHome = false; location.assign('/'); return true;
  }
  function loginStop(err) { homeOff(); stopped = 'login'; loginErr = err || 'mj_session'; clearTimeout(retryTimer); rerender(); }
  function goneStop() {
    if (delOn()) { delDone(); return; } // A6：消す印が在る＝消した（前の返りが切れた）＝片付けてホームへ
    homeOff(); stopped = 'gone'; clearTimeout(retryTimer); leaveChan();
    // A6 §1：この端末で消した部屋（deleted_at）は gone を足さない（戻す帯が残る）。他の人・持ち主の別の端末＝gone:true（ホームのカードに出さない・持ち主の別の端末の帯は倉庫の消した一覧から出る＝v1.4.3）
    const row = myRooms(uid).find((x) => x.room_id === rid);
    if (!(row && row.deleted_at) && room.gone !== true) { room.gone = true; patchRoom(uid, rid, { gone: true }); }
    rerender();
  }
  // 置き換えた後に描くのは room・seisan・rules の頁だけ（edit・pick は入れ物・focus・打ちかけを壊さない＝出る時に描く・v2 止め2）
  function rerender() { if (!dead && ['room', 'seisan', 'rules'].includes(page)) render(); }
  /* P10 §4：確かめが通ったら先頭の held human を外して送る（op_id はそのまま）・通らなければ帯のまま（点は捨てない） */
  function humanAgain() {
    if (humanBusy || dead || !heldHuman(outbox)) return;
    humanBusy = true; rerender();
    humanCheck().then((ok) => {
      humanBusy = false;
      if (dead) return;
      if (ok && heldHuman(outbox)) { outbox = unholdHuman(outbox); save(OUTR, outbox); retryN = 0; rerender(); sendOutbox(); return; }
      rerender();
    });
  }
  function tagKey() { return [liveTag(), staleRead(), stopped, gateNote, startMsg, outbox.length, heldInfo(outbox) && heldInfo(outbox).why, !!room.closed, closingOn(), closeBusy, canDel()].join('|'); }
  function refreshTag() { if (!dead && tagKey() !== shownTag) rerender(); }

  /* 送り（約束⑤＝rpcRaw（sb().rpc と同じ {data,error,status}）を outboxStep へ） */
  async function sendOutbox() {
    if (!WRITE_READY || !mounted || dead || stopped || lane || st.needs_upload) { if (!lane) homeOff(); return; } // lane＝送りの最中（その返りが続ける）
    if (closedHold()) { homeOff(); return; } // 控えが closed で並びが在る＝送らない（倉庫は bad closed で返す・B3b-1 §0 止め3）
    if (!canSend(outbox)) { homeOff(); return; }
    if (offline()) return; // 'online' を待つ（先回りはここ・outboxStep は返しの判じだけ）
    let head = outbox[0];
    if (head.sent_at && Date.now() - Date.parse(head.sent_at) > SENT_MAX_MS) {
      outbox = holdHead(outbox, 'stale'); save(OUTR, outbox); homeOff(); refreshTag(); return; // 倉庫に入ったか確かめられない＝自動で送り直さない
    }
    if (!head.sent_at) { head = { ...head, sent_at: new Date().toISOString() }; outbox = [head, ...outbox.slice(1)]; save(OUTR, outbox); } // ★送った印を先に保存★（v1 止め1）
    lane = true;
    let res;
    try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: head.op_id, p_ops: head.ops }); }
    catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
    lane = false;
    if (dead) return;
    aizuOut(res && res.data); // 2c-2f：ok と read_ver ならその場で合図（待たない）
    if (!outbox.length || outbox[0].op_id !== head.op_id) { homeOff(); kick(); return; }
    const s = outboxStep(res);
    if (s.kind !== 'retry') { retryN = 0; clearTimeout(retryTimer); }
    if (s.kind === 'done') {
      outbox = outbox.slice(1); save(OUTR, outbox);
      refreshTag();
      if (outbox.length) { sendOutbox(); return; }
      if (pendingStart || pendingRule) { homeOff(); kick(); return; }
      if (homeTry()) return; // A11
      sync(); return; // 送りで並びが空になった時に読み直す
    }
    if (s.kind === 'retry') { clearTimeout(retryTimer); retryTimer = setTimeout(() => sendOutbox(), retryDelay(retryN++)); refreshTag(); return; }
    if (s.kind === 'login') { loginStop(s.err); return; }
    if (s.kind === 'reload') { goneStop(); return; }
    if (s.kind === 'closed') { // 足し①：黙って捨てない＝その組と後ろは並びに残し（送り直さない）、写しもそのまま。控えに closed
      outbox = holdHead(outbox, 'closed'); save(OUTR, outbox);
      homeOff(); roomInfo({ closed: true }); pendingStart = null; rerender(); return;
    }
    if (s.kind === 'conflict' && startConflict(head, s)) return;
    outbox = [{ ...outbox[0], held: { err: s.err, ...(s.at !== undefined ? { at: s.at } : {}), ...(s.what !== undefined ? { what: s.what } : {}) } }, ...outbox.slice(1)]; // conflict・stop＝先頭で止める（後ろは送らない）・P6g：what も残す（busy の字）
    save(OUTR, outbox);
    pendingStart = null; startMsg = null; goHome = false;
    rerender();
  }
  // E2 §6：hanchan_start が conflict {what:'open'|'new'}＝止めない。その op と、並びの後ろの同じ uuid の op を消し、読み直してからその回を開く
  //   （何も自動で送らない・打った数は空いた箱へ入れて見せる＝見ないまま捨てない）
  function startConflict(head, s) {
    const at = s.at;
    const so = head.ops.find((o) => o.op === 'hanchan_start');
    if (!so || !at || typeof at !== 'object' || (at.what !== 'open' && at.what !== 'new') || typeof at.hanchan_id !== 'string') return false;
    const gone = so.hanchan_id;
    // 消す op の中の数（始めの点＋後から同じ回へ打った cell_set・tobi_set）を全部拾う＝見ないまま捨てない
    const cells = so.cells.slice(); let tobiR = so.tobi_to && Array.isArray(so.tobi_to.r) ? so.tobi_to.r.slice() : [];
    for (const it of outbox) for (const o of it.ops) { if (o.hanchan_id !== gone) continue; if (o.op === 'cell_set' && Number.isInteger(o.seat) && o.seat >= 0 && o.seat < cells.length) cells[o.seat] = o.value; if (o.op === 'tobi_set' && o.tobi_to && Array.isArray(o.tobi_to.r)) tobiR = o.tobi_to.r.slice(); }
    outbox = outbox.map((it) => { const ops = it.ops.filter((o) => o.hanchan_id !== gone); return ops.length === it.ops.length ? it : { op_id: uuid(), ops }; }).filter((it) => it.ops.length);
    save(OUTR, outbox);
    prefill = { target: at.hanchan_id, seats: so.seats.slice(), cells, tobiR };
    pendingStart = null; startMsg = null; since = null;
    refreshTag(); sync();
    return true;
  }
  // 読み直した写しに目当ての回が在れば開く（無ければ次の読みを待つ）
  function openPrefill() {
    const p = prefill;
    if (room.closed) { prefill = null; return false; }
    const x = st.hanchans.find((h) => h.hanchan_id === p.target);
    if (!x) return false;
    prefill = null;
    const typed = (m) => { const j = p.seats.indexOf(m); return j >= 0 && Number.isInteger(p.cells[j]) ? p.cells[j] : null; };
    const xr = chainView(st, x.table_id).rows.find((y) => y.hanchan_id === x.hanchan_id);
    const no = xr ? xr.no : x.no;
    if (!x.voided && x.cells.some((v) => v === null)) {
      startEntry(x.hanchan_id);
      const other = [];
      entry.seats.forEach((m, i) => { const t = typed(m); if (t === null) return; if (x.cells[i] === null) entry.cells[i] = boxNum(t); else if (x.cells[i] !== t) other.push(nameOf(m) + ' ' + x.cells[i].toLocaleString('ja-JP') + '点'); });
      entry.note = other.length ? '他の端末が先に ' + no + '回目を入れました（' + other.join('・') + '）' : '他の端末が先に ' + no + '回目を始めました。空いた所に打った点を入れました。';
    } else {
      // Build note：目当ての回がもう埋まった（new）＝新しい回として打った数を残して開く
      startEntry(null);
      if (entry && page === 'edit' && !entry.hanchan_id) { entry.seats.forEach((m, i) => { const t = typed(m); if (t !== null) entry.cells[i] = boxNum(t); }); entry.tobiR = p.tobiR.filter((i) => i < entry.seats.length); entry.note = '他の端末が先に ' + no + '回目を入れました。打った点は残しています。'; }
    }
    if (page === 'edit') render(); // startEntry が描いた後に打った数を入れた＝描き直す（pick へ行った時は startEntry が描いた）
    return true;
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
    if (room.gone === true) { room.gone = false; patchRoom(uid, rid, { gone: false }); } // A6 §1：読めた＝部屋は在る（戻された）＝gone を外す（same の読みでも）
    if (d.same) { lastIn = Date.now(); return 'same'; }
    roomInfo(d.room); // ★closed は写しを置き換える前に控えへ（約束⑦）・rules も控えへ（約束④）
    if (LG) { const li = saveLeagueInfo(uid, LG, d); if (li) lgInfo = li; } // D2：L か・リーグの版・その日の版（置き換えない時も新しくする）
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
    const nb = [], unSid = [];
    let unNo = false;
    for (const it0 of outbox) {
      const it = { ...it0 };
      delete it.held_after_drop; // 当て直しを通った＝外す（止めた組が在れば先頭まで来た時にそこで止まる）
      if (!stop && it.held) stop = true;
      if (!stop) {
        const r = applyOps(cur, it.ops, aopts());
        if (r.ok) cur = r.state;
        else if (r.res.err === 'unloaded') { // P5 §3：読んでいない開催への op＝held にしない・開催は置き換える前の写しと並びから引く
          const sid = sessionOfRef(st, outbox, r.res.at, r.res.id);
          if (sid) unSid.push(sid); else unNo = true;
          stop = true;
        } else { it.held = { err: r.res.err, ...(r.res.at !== undefined ? { at: r.res.at } : {}) }; stop = true; }
      }
      nb.push(it);
    }
    // ★unloaded が1つでも出た読みは skip★＝写し（st・KEY）も並びも置き換えない・保存しない・since も進めない
    if (unSid.length || unNo) {
      for (const x of unSid) want.add(x);
      if (unSid.length && !unNo && unTry < 1) { unTry++; syncAgain = true; return 'skip'; } // since 無しで1回だけ読み直す（kick の頭で sync）
      loadNote = true; return 'skip'; // 2回目も（か開催を引けない）＝並びはそのまま「読み込み中」の帯（何も捨てない）
    }
    unTry = 0; loadNote = false;
    outbox = nb; st = cur;
    save(OUTR, outbox); save(KEYR, st); // ★並びを先・写しを後★
    since = typeof d.read_ver === 'number' ? d.read_ver : null;
    lastIn = Date.now();
    if (Array.isArray(st.loaded)) for (const x of [...want]) if (st.loaded.includes(x) || (Array.isArray(st.absent) && st.absent.includes(x))) want.delete(x); // P5：読めた開催は頼み終わり（並びが触る間は readArgs が頼み続ける）
    if (!LG) markSynced(uid, rid);
    repick();
    return 'ok';
  }
  // P5 §4：room の読みの p_args＝lib の readArgs（並びが触る開催＋今の卓の開催）に want（unloaded が出た開催）を足す。sn が null＝since を付けない
  function roomArgs(sn) {
    const a = readArgs(st, outbox, table ? table.session_id : null, sn === null || sn === undefined ? null : sn);
    for (const x of want) {
      if (a.sessions.length >= 50) break;
      if (!a.sessions.includes(x)) a.sessions.push(x);
    }
    if (want.size) delete a.since; // P5 §3：unloaded の後の読み直し・まだ読んでいない開催を頼む読みは since を付けない（same で中身が来ない）
    return a;
  }
  const readSt = (sn) => (LG ? readLeague(rid, LG, sn) : readRoom(rid, roomArgs(sn))); // D2：リーグの対局は 'league' を読む
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
    const res = await readSt(since);
    lane = false;
    if (dead) return;
    const ln = loadNote;
    const k = takeRead(res);
    if (k === 'ok') entryFollow(); // A20 §1-2：入力中の読み直し＝鎖の最後の人数・ルールに付いて行く
    if (k === 'ok' && page === 'pick' && picking && picking.shownAct !== actKey()) renderPick(); // 8b §1-7：人を選ぶ頁も読み直しに付いて行く（別の端末で消した・戻した人）
    if (k === 'ok' || ln !== loadNote) rerender(); else refreshTag(); // P5：「読み込み中」の帯が立った・消えた時も描き直す
    if (meRead) { meRead = false; if (page === 'me') renderMe(); } // C2-0：taken・linked・dup の後の読み直しで名前の頁を描き直す（打ちかけの名前は残す）
    kick();
  }

  /* ── 卓を決める ── */
  // D2：卓がまだ無い時のルール＝リーグの対局はリーグの主のルール（人数の列）・ふつうは部屋のルール
  const baseRules = () => (LG && lgInfo && lgInfo.league && lgInfo.league.rules && typeof lgInfo.league.rules === 'object' ? lgInfo.league.rules : room.rules);
  let table = null, R = baseRules(), n = R.players, kieru = false;
  let takuNote = null;   // D2 §3 止め2：開いていた卓が消えた・取り消されたので1つ目へ移った帯（卓を選ぶか書くまで出す）
  let takuMsg = null;    // D2：［＋卓］が通らなかった字（errText way 'league'）
  let takuPick = false;  // D2：rules_alt の在る日の［＋卓］＝主の人数／もう一方を選ぶ所を開いている
  // C4 §3：卓を選ぶ所（ensureTable・repick・closedTable・startShared）は★鎖の最後の卓★（区切った前の卓は回を直す時だけ・回の卓のまま）
  const chainLast = (t) => { if (!t) return null; const ch = tableChain(st, t.table_id); return st.tables.find((x) => x.table_id === ch[ch.length - 1]) || t; };
  function setTable(t) { table = chainLast(t); R = table ? table.rules : baseRules(); n = R.players; kieru = R.kyotaku_end === 'kieru'; }
  const tOf = (tid) => chainLast(st.tables.find((x) => x.table_id === tid) || null); // 結んだ卓（入力・人を選ぶ）の今の鎖の最後
  // その日の卓（区切った鎖は頭だけ・取り消した卓は出さない）＝［卓1］［卓2］…の並び（倉庫の st の順）
  const dayHeads = (sid) => st.tables.filter((t) => t.session_id === sid && !t.voided && !st.tables.some((x) => x.next_table_id === t.table_id));
  // その日の1つ目の卓（取り消していない卓を先に）
  const firstTable = (sid) => dayHeads(sid)[0] || st.tables.find((t) => t.session_id === sid) || null;
  // D2：mj_read 'league' はそのリーグの日だけを返し、日に league_id を付けない（schema.sql の st.sessions）＝リーグの対局の頁では在る日は全部リーグの日
  const lgSess = (s) => !!s && (!!LG || (typeof s.league_id === 'string' && !!s.league_id));
  const lgDay = (t) => lgSess(t && st.sessions.find((x) => x.session_id === t.session_id));
  const nonL = (t) => !!LG && lgDay(t) && !isL(); // §3 止め1：リーグの日で L でない
  const dayOf = (sid) => (lgInfo && Array.isArray(lgInfo.days) ? lgInfo.days.find((d) => d && d.session_id === sid) : null) || null;
  const mainN = (sid) => { const d = dayOf(sid); const r = (d && d.rules) || (lgInfo && lgInfo.league && lgInfo.league.rules); return r && Number.isInteger(r.players) ? r.players : null; };
  const isAlt = (t) => !!(LG && t && lgDay(t) && mainN(t.session_id) !== null && t.rules && t.rules.players !== mainN(t.session_id)); // もう一方の卓＝その日の主と人数が違う
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
    const t0 = sid0 && firstTable(sid0);
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
  // D2 §3 止め2：選んだ卓は残す（同じ開催で取り消していなければ）。消えた・取り消された時だけ1つ目へ移って帯
  function pick0() {
    if (room.closed) { setTable(closedTable()); return; }
    const sid = pickSession(st);
    const cur = table ? st.tables.find((x) => x.table_id === table.table_id) || null : null;
    if (sid) {
      if (cur && cur.session_id === sid && !cur.voided) { setTable(cur); return; }
      const t = firstTable(sid);
      if (table && table.session_id === sid && t) takuNote = '開いていた卓が無くなったので、' + (t.label || '卓1') + 'を開きました';
      setTable(t); return;
    }
    setTable(cur);
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
      const k = takeRead(await readSt(null));
      if (dead || k === 'login' || k === 'gone') return;
      if (!table && k !== 'ok') fail = '電波がつながってから始められます。';
      // D2 §3：L でない入は日を作らない（帯「L が対局を始めるのを待っています」）・L は期間の外なら作らない
      const lgw = LG && !table && !fail ? (isL() ? (outOfTerm() ? 'term' : null) : 'wait') : null;
      if (lgw === 'term') fail = errText({ ok: false, err: 'bad', at: 'date' }, 'league');
      if (!table && !fail && !lgw) {
        const ids = startOp || (startOp = { op_id: uuid(), sid: uuid(), tid: uuid(), date: today() });
        const sc = LG ? scope() : null;
        const ops = [
          LG ? { op: 'session_add', session_id: ids.sid, date: ids.date, rate: sc && sc.rules && sc.rules.rate !== undefined ? sc.rules.rate : null, league_id: LG } // rate＝リーグの主のルールの値（§1：違えば bad rate）
            : { op: 'session_add', session_id: ids.sid, date: ids.date, rate: room.rules.rate },
          { op: 'table_add', table_id: ids.tid, session_id: ids.sid, label: '卓1' },
        ];
        let res;
        try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: ids.op_id, p_ops: ops }); }
        catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
        if (dead) return;
        const d = res && res.data;
        if (d && d.ok === false && d.err === 'dup' && d.what === 'session') {
          // 他の端末が先に始めた＝読み直してその開催の最初の卓を使う
          startOp = null;
          const k2 = takeRead(await readSt(null));
          if (dead || k2 === 'login' || k2 === 'gone') return;
          if (!table && d.session_id) setTable(firstTable(d.session_id));
          if (!table) fail = '始められませんでした。もう一度押してください。';
        } else {
          const s = outboxStep(res);
          if (s.kind === 'done') {
            aizuOut(d); // 2c-2f
            startOp = null;
            const a = applyOps(st, ops, aopts());
            if (a.ok) { st = a.state; takeDays(a); save(KEYR, st); }
            setTable(st.tables.find((t) => t.table_id === ids.tid) || null);
            if (!table && LG) { // 写しに当てられなかった（lib の scope の前など）＝倉庫に入った日を読み直して開く
              const k3 = takeRead(await readSt(null));
              if (dead || k3 === 'login' || k3 === 'gone') return;
              if (!table) setTable(st.tables.find((t) => t.table_id === ids.tid) || null);
            }
            if (!table) fail = '始められませんでした。もう一度押してください。';
          } else if (s.kind === 'login') { loginStop(s.err); return; }
          else if (s.kind === 'reload') { goneStop(); return; }
          else if (s.kind === 'closed') { roomInfo({ closed: true }); startOp = null; fail = 'この部屋は終わりました。'; }
          else if (s.kind === 'retry') fail = s.err === 'busy' ? '混んでいます。1分待ってもう一度押してください。' : 'つながりませんでした。電波を確かめてもう一度押してください。'; // startOp は残す＝次も同じ op_id
          else if (s.err === 'busy') { startOp = null; fail = errText({ err: 'busy', what: s.what }, LG ? 'league' : 'write'); } // P6g §5：1日の窓は「1分待って」にしない
          else if (s.err === 'human') { startOp = null; fail = errText({ err: 'human' }); } // P10 §1：確かめが通らなかった＝もう一度押すとまた確かめを出す
          else { startOp = null; fail = LG ? errText(d && typeof d === 'object' ? d : { err: s.err }, 'league') || '始められませんでした（' + s.err + '）。' : '始められませんでした（' + s.err + '）。'; }
        }
      }
    } finally { lane = false; }
    if (dead) return;
    startMsg = fail;
    if (table && !fail) { then(); kick(); return; }
    render(); kick();
  }
  // D2：今日がリーグの期間の外か（date_from・date_to は在る時だけ）
  function outOfTerm() {
    const lg = lgInfo && lgInfo.league, t = today();
    return !!(lg && ((typeof lg.date_from === 'string' && lg.date_from && t < lg.date_from) || (typeof lg.date_to === 'string' && lg.date_to && t > lg.date_to)));
  }
  setTable(ensureTable());

  const nameOf = (mid) => (st.members.find((m) => m.member_id === mid) || {}).name || '?';
  const actOf = (mid) => st.members.some((m) => m.member_id === mid && m.active); // 8b §1-7：hanchan_start は active の人だけ通す（schema.sql mj_w_people）
  const actKey = () => st.members.map((m) => [m.member_id, m.name, m.active, m.me, m.taken, m.left].join(':')).join('|'); // 8b：名簿の行（名・消した・つながり）が替わったか
  let mb = null; // 8b §1-1：［名簿を直す］の開き { open, ed:{mid,kind,msg,busy,p,val}, mm:null|{err}|{room,sts}, seq }
  const rateText = (rate) => (rate === null || rate === undefined ? 'レートなし' : '1pt＝' + rate.toLocaleString('ja-JP'));
  const liveTag = () => {
    if (closedHold()) return '<span class="r-live ng">● 送れていない点があります・部屋が終わっています</span>';
    if (st.needs_upload) return '<span class="r-live ng">● この端末だけ（まだ送っていない）</span>';
    if (heldInfo(outbox)) return '<span class="r-live ng">● 未送信 ' + outbox.length + '・止まっています</span>';
    if (staleRead()) return '<span class="r-live ng">● 最新を読めていません' + (outbox.length ? '・未送信 ' + outbox.length : '') + '</span>';
    return outbox.length ? '<span class="r-live ng">● 未送信 ' + outbox.length + '</span>' : '';
  };
  // P6g §3：1日の窓の busy の帯の字（what ごと）
  const busyHeldText = (w) => (['write:un1d', 'write:uk1d', 'write:u1d'].includes(w) ? '24時間に書ける数を越えました。この点は送れていません。他の人に入れてもらう時は［捨てる］（残すと後で2重）'
    : w === 'write:rk1d' ? '部屋の管の全員で24時間に書ける数を越えました。この点は送れていません。入の人に入れてもらう時は［捨てる］（残すと後で2重）'
    : w === 'write:rn1d' ? '部屋の入の全員で24時間に書ける数を越えました。この点は送れていません。管の人に入れてもらう時は［捨てる］（残すと後で2重）'
    : '書ける数を越えたので止めました（' + (w || '?') + '）。この点は送れていません。');
  const HELD_WHY = { conflict: '他の端末が先に直しました', dup: '同じ名前の人がもういます', range: '範囲の外です', server: '倉庫で止まりました', full: '倉庫で止まりました', mj_role: 'この役ではできません' };
  /* 帯（頁の上）＝足し①・消えた部屋・ログイン・止まった並び・読んだ st の門・始められなかった字 */
  function bandsHtml() {
    let h = '';
    if (loadNote) h += '<div class="r-red" id="rLoading"><b>この日の記録を読み込んでいます</b></div>'; // P5 §4：読めない間（並びは捨てない）
    if (closedHold()) h += '<div class="r-red" id="rClosed"><b>この部屋は終わりました。この端末で入れた点のうち、まだ送れていない分が部屋に入っていません。この端末では見られます。</b></div>';
    if (stopped === 'gone') h += '<div class="r-red" id="rGone"><b>この部屋は消されているか、入れなくなりました。</b></div>';
    if (stopped === 'login') h += '<div class="r-red" id="rLogin"><b>' + (loginErr === 'mj_reauth' ? 'ログインし直してから送ります。' : 'ログインが切れました。ログインし直してください。') + '</b>' + (relogin ? '<button class="btn btn-main" id="rRelogin">ログインし直す</button>' : '') + '</div>';
    const hi = !st.needs_upload && !closedHold() ? heldInfo(outbox) : null;
    if (hi && !heldClosed(outbox)) {
      const h0 = outbox[0].held;
      const old = !!(outbox[0].sent_at && Date.now() - Date.parse(outbox[0].sent_at) > SENT_MAX_MS); // §3：6日を越えた busy は stale と同じ（［捨てる］だけ）
      if (hi.why === 'busy' && old) h += '<div class="r-red" id="rHeld"><b>この端末の点が部屋に入ったか確かめられません。</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      else if (hi.why === 'busy') h += '<div class="r-red" id="rHeld" data-what="' + esc(h0.what || '') + '"><b>送れていない点が ' + hi.n + ' 組あります。' + esc(busyHeldText(h0.what)) + '</b>' +
        (hi.n > 1 ? '<span>他の人が入れ直した時は［全部捨てる］</span>' : '') +
        '<button class="btn btn-line" id="rDrop">捨てる</button>' +
        (hi.n > 1 ? (dropAllAsk ? '<button class="btn btn-aka" id="rDropAll2">' + hi.n + ' 組を全部捨てる</button>' : '<button class="btn btn-line" id="rDropAll">全部捨てる</button>') : '') +
        '<button class="btn btn-main" id="rResend">もう一度送る</button></div>';
      else if (hi.why === 'after_drop') h += '<div class="r-red" id="rHeld"><b>未送信 ' + hi.n + ' 件・部屋を読み直してから送ります</b></div>';
      else if (hi.why === 'stale') h += '<div class="r-red" id="rHeld"><b>この端末の点が部屋に入ったか確かめられません。</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      // C4 §3 T3：鍵が違う区切りの後の extra_add（倉庫が bad at table_id）＝前のルールで押した枚を新しい単価で数えない
      else if (hi.why === 'bad' && outbox[0].held.at === 'table_id' && outbox[0].ops.some((o) => o.op === 'extra_add')) h += '<div class="r-red" id="rHeld"><b>ルールが変わりました。チップ等を入れ直してください</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      // 8b §1-7：古い写しのまま積んだ hanchan_start に消された人（倉庫が bad at seats）＝［選び直す］（その組を外して点を人ごとに残し人を選ぶ頁へ）
      else if (hi.why === 'bad' && outbox[0].held && outbox[0].held.at === 'seats' && outbox[0].ops.some((o) => o.op === 'hanchan_start')) h += '<div class="r-red" id="rHeld" data-why="offseat"><b>消された人がいるので入れられませんでした</b><button class="btn btn-main" id="rRePick">選び直す</button><button class="btn btn-line" id="rDrop">捨てる</button></div>';
      else if (hi.why === 'human') h += '<div class="r-red" id="rHeld" data-why="human"><b>確認できませんでした</b><button class="btn btn-main" id="rHuman"' + (humanBusy ? ' disabled' : '') + '>もう一度</button></div>'; // P10 §1：［捨てる］は出さない（点は通った後に送る）
      else h += '<div class="r-red" id="rHeld"><b>未送信 ' + hi.n + ' 件・この書き込みは入れられません（' + esc(HELD_WHY[hi.why] || hi.why) + '）</b><button class="btn btn-line" id="rDrop">捨てる</button></div>';
    }
    if (gateNote) h += '<div class="r-red" id="rGateNote"><b>' + esc(gateNote) + '</b></div>';
    if (ruleNote && page === 'room') h += '<div class="r-red" id="rRuleNote"><b>' + esc(ruleNote) + '</b></div>';
    if (takuNote && page === 'room') h += '<div class="r-red" id="rTakuNote"><b>' + esc(takuNote) + '</b></div>';
    if (takuMsg && page === 'room') h += '<div class="r-red" id="rTakuMsg"><b>' + esc(takuMsg) + '</b></div>';
    if (LG && page === 'room' && !table && !room.closed && !stopped && !isL()) h += '<p class="r-check bad" id="rLWait">L が対局を始めるのを待っています</p>';
    if (startMsg) h += '<p class="r-check bad" id="rStartMsg">' + esc(startMsg) + '</p>';
    return h;
  }
  const staleHtml = () => (staleRead() ? '<p class="r-check bad" id="rStale">最新を読めていないので、他の端末の点が入っていないかもしれません。</p>' : '');
  function wireBands() {
    const q = (s) => el.querySelector(s);
    if (q('#rRePick')) q('#rRePick').onclick = () => { // 8b §1-7：その組を並びから外し・その組の点を carry にして人を選ぶ頁へ
      const g = outbox[0], hs = g && g.ops.find((o) => o.op === 'hanchan_start');
      if (!hs) return;
      const t = tOf(hs.table_id);
      dropAllAsk = false; outbox = dropHead(outbox); save(OUTR, outbox); since = null;
      if (!t) { rerender(); sync(); return; }
      const carry = {};
      hs.seats.forEach((m, i) => { const v = Array.isArray(hs.cells) ? hs.cells[i] : null; if (v !== null && v !== undefined) carry[m] = boxNum(Number(v)); });
      const tr = hs.tobi_to && Array.isArray(hs.tobi_to.r) ? hs.tobi_to.r : [];
      picking = { seats: hs.seats.filter(actOf), tid: t.table_id, n: t.rules.players, carry, tobiM: tr.map((i) => hs.seats[i]).filter(actOf), offB: hs.seats.filter((m) => !actOf(m)).map(nameOf) };
      entry = null; page = 'pick'; render(); sync();
    };
    if (q('#rDrop')) q('#rDrop').onclick = () => { dropAllAsk = false; outbox = dropHead(outbox); save(OUTR, outbox); since = null; rerender(); sync(); }; // 後ろは held_after_drop＝読み直しで当て直してから送る（捨てた組は写しに当たっている＝since を戻して必ず置き換える）
    // P6g §3：［全部捨てる］は1段確かめる・merge も空にする（押す前の ± が後で黙って送られない）・［もう一度送る］は先頭の held busy を外して1回だけ送る
    if (q('#rDropAll')) q('#rDropAll').onclick = () => { dropAllAsk = true; rerender(); };
    if (q('#rDropAll2')) q('#rDropAll2').onclick = () => { dropAllAsk = false; clearTimeout(mergeTimer); merge.clear(); outbox = []; save(OUTR, outbox); since = null; rerender(); sync(); };
    if (q('#rHuman')) q('#rHuman').onclick = () => humanAgain();
    if (q('#rResend')) q('#rResend').onclick = () => { dropAllAsk = false; outbox = unholdBusy(outbox); save(OUTR, outbox); retryN = 0; rerender(); sendOutbox(); };
    if (q('#rRelogin')) q('#rRelogin').onclick = () => relogin(() => { if (dead) return; stopped = null; loginErr = null; rerender(); kick(); sync(); });
  }

  function render() {
    if (page !== 'seisan') endAsk = false; // A27 §1：押した印は精算の頁の外へ持ち越さない
    if (goHome && page !== 'seisan') goHome = false; // A11 止め2：精算を離れた（打ちかけ・別の頁）＝ホームへ飛ばない
    // 終えた部屋の頁は room・seisan・rules だけ（他に居たら room へ・B3b-1 §3）
    if (room.closed && !['room', 'seisan', 'rules'].includes(page)) { page = 'room'; entry = null; picking = null; }
    if (closedObi) closedObi(!!room.closed && !closedHold()); // 足し①の帯が出る時は「見ることはできます」の帯を外す（帯は1枚）
    if (prefill && openPrefill()) return;
    if (page === 'edit') return renderEdit();
    if (page === 'pick') return renderPick();
    if (page === 'me') return renderMe();
    if (page === 'seisan') return renderSeisan();
    if (page === 'rules') return renderRules();
    // ［点数］＝点数計算（記録しない道具・tensu.html）へ。卓のルールを ?r= に、戻り先を ?from= に渡す（tensu.js の頭の取り決め）
    const ten = '/tensu.html?r=' + encodeURIComponent(JSON.stringify(LG ? R : room.rules)) + '&from=' + encodeURIComponent(location.pathname + location.search);
    // D2（絵 v157 ②）：リーグの対局は ‹ リーグの名前・題は「日付 卓n」
    const lgName = LG && lgInfo && lgInfo.league && typeof lgInfo.league.name === 'string' && lgInfo.league.name ? lgInfo.league.name : ROOM_DEFAULT; // 名が無い・まだ読めていない時＝do the math（11-27 司さん）
    const tHead = table ? st.tables.find((x) => x.table_id === tableChain(st, table.table_id)[0]) || table : null;
    const tDate = table ? (st.sessions.find((x) => x.session_id === table.session_id) || {}).date : null;
    bar({ back: LG ? lgName : 'ホーム', onBack: LG ? () => { location.href = '/league.html?room=' + encodeURIComponent(rid); } : undefined,
      title: LG && tHead ? md(tDate) + ' ' + (tHead.label || '卓') : '対局', right: 'ルール', onRight: () => { page = 'rules'; render(); }, ten });
    // 卓がまだ無い（shared で開催を倉庫で決める前）＝部屋のルールで空の表だけ出す（最初の点で startShared）
    const noteHtml = note ? '<p class="r-check bad" id="rCloseNote">' + esc(note) + '</p>' : '';
    // 終えた部屋に開催が1つも無い＝中身の字だけ（卓を触らない・B3b-1 §3 止め1）
    if (room.closed && !table) { shownTag = tagKey(); el.innerHTML = bandsHtml() + noteHtml + '<p class="setsumei" id="rEmpty">この部屋は終わりました。中身はありません。</p>'; wireBands(); return; } // A27：［部屋を消す］はルールの頁
    const v = table ? chainView(st, table.table_id) : { date: today(), rate: baseRules().rate ?? null, rows: [], nextNo: 1, windows: [], seatPeople: [], parts: [] }; // C4 §5a：鎖で1つ
    shownTag = tagKey();
    const tkLeft = el.querySelector('#rTaku') ? el.querySelector('#rTaku').scrollLeft : 0; // 描き直しても横の位置を残す
    let h = takuHtml() + '<div class="r-top"><span>' + esc(md(v.date)) + '・' + rateText(v.rate) + '</span>' + liveTag() + '</div>' + bandsHtml() + noteHtml;
    if (isAlt(table)) h += '<div class="r-white" id="rAltObi">' + n + '人の卓（リーグのもう一方のルール）</div>';
    h += v.rows.length ? renderTable(v) : renderHead(preSeats());
    // 終えた部屋は［n回目の点を入れる］を出さない・終える送りの最中（closing）は押せない形
    if (!room.closed && !(LG && !table && !isL())) h += '<button class="btn btn-main r-add" id="rAdd"' + (closingOn() ? ' disabled' : '') + '>' + v.nextNo + '回目の点を入れる</button>'; // L でない入は日が開くまで出さない
    h += staleHtml(); // 窓の上（2d §3 読めない時）
    // B1：席だけの卓（行がまだ無い）も窓と ± を出す＝並べは seatWin（画面だけ）。✓ と［精算を見る］は今まで通り windows が在る時だけ
    if (v.windows.length || v.seatPeople.length) h += renderWindows(v);
    if (v.windows.length) h += renderCheck(v) + (pmErr ? '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>' : '') + '<button class="btn btn-line" id="rSeisan">精算を見る（誰が誰に）</button>';
    else if (pmErr) h += '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>';
    // A27 §1（司さん 11-26「ここに出すなら対局終了ボタンやろが」）：頁の一番下は［対局終了］＝精算の頁の［対局終了］と同じ道（出す条件も同じ・押したら精算の頁で押す）
    if (table && v.windows.length && !room.closed && !st.settles.some((x) => x.session_id === table.session_id)) h += '<button class="btn btn-main" id="rEnd"' + (closingOn() || goHome ? ' disabled' : '') + '>対局終了</button>';
    el.innerHTML = h;
    const wrap = el.querySelector('.r-hyou-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    takuScroll(tkLeft);
    wireRoom(); wireBands();
  }
  /* ── D2：［卓1］［卓2］…（何卓でも横に流す）・L にだけ［＋卓］ ── */
  function takuHtml() {
    if (!LG || !table) return '';
    const sid = table.session_id, on = tableChain(st, table.table_id)[0];
    const heads = dayHeads(sid);
    let h = '<div class="r-taku" id="rTaku">';
    for (const t of heads) {
      const alt = isAlt(chainLast(t));
      h += '<button type="button" class="r-tk" data-tk="' + esc(t.table_id) + '" aria-pressed="' + (t.table_id === on) + '">' + esc(t.label || '卓') + (alt ? '<small>（' + chainLast(t).rules.players + '人）</small>' : '') + '</button>';
    }
    const canAdd = isL() && !room.closed && lgDay(table);
    if (canAdd) h += '<button type="button" class="r-tk r-tk-add" id="rTakuAdd" aria-expanded="' + takuPick + '"' + (closingOn() ? ' disabled' : '') + '>＋卓</button>';
    h += '</div>';
    if (canAdd && takuPick) {
      const d = dayOf(sid), m = mainN(sid);
      const a = d && d.rules_alt && Number.isInteger(d.rules_alt.players) ? d.rules_alt.players : null;
      h += '<div class="chips r-tk-pick" id="rTakuPick"><button type="button" id="rTakuMain">' + (m || n) + '人の卓</button>' + (a ? '<button type="button" id="rTakuAlt">' + a + '人の卓</button>' : '') + '</div>';
    }
    return h;
  }
  // 今の卓が見える所へ（前の横の位置から・はみ出す時だけ真ん中へ寄せる）
  function takuScroll(left) {
    const tk = el.querySelector('#rTaku');
    if (!tk) return;
    tk.scrollLeft = left;
    const b = tk.querySelector('[aria-pressed="true"]');
    if (!b) return;
    const x = b.getBoundingClientRect().left - tk.getBoundingClientRect().left + tk.scrollLeft; // 並びの中での左の位置
    if (x < tk.scrollLeft || x + b.offsetWidth > tk.scrollLeft + tk.clientWidth) tk.scrollLeft = Math.max(0, x - (tk.clientWidth - b.offsetWidth) / 2);
  }
  function pickTaku(tid) {
    const t = st.tables.find((x) => x.table_id === tid);
    if (!t) return;
    setTable(t); takuNote = null; takuMsg = null; pmErr = null; ruleNote = null; takuPick = false;
    render();
  }
  // ［＋卓］＝table_add（名は「卓n」・n＝その日の卓の数+1・alt はもう一方の卓）。並びに積む（L でない・alt の無い日は写しで弾く＝lib §2）
  function addTaku(alt) {
    if (!table || writeBlocked()) return;
    const sid = table.session_id, tid = uuid();
    const op = { op: 'table_add', table_id: tid, session_id: sid, label: '卓' + (st.tables.filter((t) => t.session_id === sid).length + 1) };
    if (alt) op.alt = true;
    takuPick = false;
    const r = commit([op]);
    if (!r.ok) { takuMsg = r.msg || errText(r, 'league') || '卓を足せませんでした（' + r.err + '）'; render(); return; }
    takuMsg = null;
    setTable(st.tables.find((t) => t.table_id === tid) || table);
    render();
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
        const small = c.cell === null ? 'まだ' : (c.rank !== null ? (c.rank + 1) + '位 ' : '') + boxNum(c.cell);
        h += '<td>' + big + '<small>' + small + '</small></td>';
      }
      h += '</tr>';
      if (r.late) h += '<tr class="r-late"><td colspan="' + (ppl.length + 1) + '">ルールを変える前に保存した回</td></tr>'; // A20 §1-1
      if (!r.ok && !r.voided) h += '<tr class="r-why"><td colspan="' + (ppl.length + 1) + '">' + esc(whyText(r)) + '</td></tr>';
    }
    h += '</tbody><tfoot><tr><th>計</th>' + ppl.map((p) => '<td><b class="' + sign(v.total10[p.member_id]) + '">' + fmtPt(v.total10[p.member_id]) + '</b></td>').join('') + '</tr></tfoot></table></div>';
    if (v.rows.length > 10) h += '<p class="r-hint">↑ 上へなぞると 1回・2回 が出る（計は動かない）</p>';
    return h;
  }
  // E2 §2：点がまだの席の名前（seats＝席の番号）
  const cellsWho = (hid, seats) => { const h = st.hanchans.find((x) => x.hanchan_id === hid); const nm = h && Array.isArray(seats) ? seats.map((i) => nameOf(h.seats[i])).filter(Boolean) : []; return nm.length ? '（' + nm.join('・') + '）' : ''; };
  function whyText(r) {
    if (r.why === 'sum') return r.no + '回目：素点の合計が ' + diffText(r.diff) + '（計に入れていません）';
    if (r.why === 'cells') return r.no + '回目＝点がまだ' + cellsWho(r.hanchan_id, r.seats);
    if (r.why === 'order') return r.no + '回目：同じ点の人の［上家］を押してください（「' + r.no + '回」を押す）';
    return r.no + '回目：入れ直してください（' + r.why + '）';
  }

  // 窓の種＝人ごとに ±・合計0（司さん 11-21「チップと同じやろが」＝飛び賞も同じ形）。lib の tableView が used[kind]・w[kind]・w[kind+'Big'|'Pt10']・v[kind+'Sum'] を返す種だけ出る
  //   ＝飛び賞（'tobi'・B2 tobi_chip_v3.md）は tobi が true かつ tobi_pt≥1 の卓だけ used.tobi が立つ。受け取る人を選ぶ窓は無くした
  const KINDS = [{ kind: 'chip', label: 'チップ' }, { kind: 'shugi', label: '祝儀' }, { kind: 'yaki', label: 'やきとり' }]; // E1（A19）：飛び賞は窓の行でなく点の行の［飛び賞］釦（hanchanView の tobiPt）
  const perOf = (v, kind) => (kind === 'chip' ? R.chip_pt10 : kind === 'shugi' ? R.shugi_pt10 : (v.tableForSeisan || {})[kind + '_pt10']);
  function renderWindows(v) {
    // 足し①（終えた部屋に送れていない点が在る）＝この端末の額は部屋の額と違う＝窓は名前だけと赤い1行（v4 止め4）
    if (closedHold()) return '<div class="r-mado">' + seatWin(v).map((w) => '<div class="r-w"><div class="r-w-name">' + esc(w.name) + '</div></div>').join('') + '</div><p class="r-check bad" id="rMadoNo">この端末の点の一部が部屋に入っていないので、額は出しません。</p>';
    // A18 §2：窓の数のどれか1つでも safe の外（lib の bigNg）＝窓全体を名前だけと帯にして額を出さない（fmt・sign・unit に null を渡さない）
    if (v.bigNg) return '<div class="r-mado">' + seatWin(v).map((w) => '<div class="r-w"><div class="r-w-name">' + esc(w.name) + '</div></div>').join('') + '</div><p class="r-check bad" id="rMadoBig">' + BIG_TEXT + '</p>';
    const pmOff = closingOn() ? ' disabled' : ''; // 終える送りの最中は ± を押せない形
    const ten = v.rate !== null;
    const unit = (pt10) => (ten ? mulS(pt10, v.rate / 10).toLocaleString('ja-JP') : (pt10 / 10).toFixed(1) + 'pt'); // A18：1枚の額は lib の mulS（bigNg が false の間は null にならない）
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
    if (bad.length) return '<p class="r-check bad">' + esc(bad.join('・')) + '</p>';
    const okParts = [];
    for (const { kind, label } of KINDS) if (v.used[kind]) okParts.push(label + 'の合計 0');
    okParts.push('合計 0');
    return '<p class="r-check ok">✓ ' + okParts.join('・') + '</p>';
  }

  // C4 §2・A20：ルールを変えられる時（変えた時点から＝A20 §1-1）＝部屋を作れる立場（WHO table_rules＝kan）・終えていない部屋・卓が在り取り消していない・リーグの日でない
  function canRule() {
    if (room.closed || !table || table.voided || stopped) return false;
    const s = st.sessions.find((x) => x.session_id === table.session_id);
    if (!s || s.voided || lgSess(s)) return false;
    return needOf(WHO.table_rules, room.role) === null;
  }
  function renderRules() {
    bar({ back: '対局', onBack: toRoom, title: 'ルール' });
    const close = closeHtml(); // ★数える前に flushMerge(true)（1回目＝頁を出す時）★＝札の数も流した後の数
    shownTag = tagKey();
    const edit = canRule();
    const cur = { ...R, rate: table ? tableView(st, table.table_id).rate : room.rules.rate ?? null };
    if (edit && ruleMem === null) loadRuleMem(); // A20 §1-7：人数を押す前に覚えを読む（読み中は人数を押せない）
    const memOk = edit && ruleMem && ruleMem !== 'loading';
    const draft = edit && ruleCtl ? { ...cur, ...ruleCtl.full() } : cur; // 読み直しで描き直しても打ちかけを残す（full＝人数で替えた aka・kita も）
    el.innerHTML = (ruleMsg ? '<div class="r-red" id="rRuleMsg"><b>' + esc(ruleMsg) + '</b></div>' : '') +
      (edit ? '<div class="obi obi-warn" id="rMemo"' + (ruleMemo ? '' : ' hidden') + '>前のルールが読めないので、いつものルールで出しています。</div>' : '') + '<div id="rRules"></div>' +
      (edit ? '<p class="err" id="rRuleErr"></p><button class="btn btn-main" id="rRuleGo"' + (ruleBusy || closingOn() ? ' disabled' : '') + ' aria-busy="' + (ruleBusy ? 'true' : 'false') + '">このルールにする</button>' : '') +
      (showShare ? '<button class="btn btn-line" id="rShare">部屋名と URL</button>' : '') + close + delHtml(); // A27 §2：［部屋を消す］は［部屋を終える］の下
    el.insertAdjacentHTML('beforeend', '<div class="kp-sp" id="rKpSp" hidden></div>'); // KPSP：鍵盤の下の空きは釦（［部屋を消す］まで）より下
    const onBad = () => { ruleMemo = true; const b = el.querySelector('#rMemo'); if (b) b.hidden = false; }; // A14g と同じ帯（黙らない）
    ruleCtl = mountRules(el.querySelector('#rRules'), { rules: draft, readOnly: !edit, lockPlayers: !memOk, midGame: true, memory: memOk ? ruleMem.memory : undefined, onBad, sp: el.querySelector('#rKpSp') });
    if (!edit) ruleCtl = null;
    if (showShare) el.querySelector('#rShare').onclick = showShare;
    if (edit) el.querySelector('#rRuleGo').onclick = () => {
      const rr = { ...R, ...ruleCtl.full(), ...ruleCtl.read() }; // A20 §1-7：人数も送る（full＝画面に出ない鍵も人数で替えた値）
      const err = (t) => { el.querySelector('#rRuleErr').textContent = t; };
      if (rr.yakitori === true && !(Number.isInteger(rr.yakitori_pt) && rr.yakitori_pt >= 1 && rr.yakitori_pt <= 999)) return err('やきとり1枚の pt は 1〜999 です（整数）。');
      const chk = rulesOk(rr);
      if (!chk.ok) return err(RULE_ERR[chk.err] || ('ルールの「' + chk.err + '」が入れられません。'));
      ruleMsg = null;
      sendRules(chk.rules);
    };
    wireClose(); wireDel();
  }
  // A20 §1-7：覚え（mj_my_rules）を読む＝gamen-taikyoku と同じ（5秒で切る・読めない／崩れは 'bad'＝押した時に既定＋帯）
  async function loadRuleMem() {
    ruleMem = 'loading';
    const seq = ++ruleMemSeq;
    let timer, res;
    try { res = await Promise.race([rpc('mj_my_rules', {}), new Promise((ok) => { timer = setTimeout(() => ok({ ok: false, err: 'timeout' }), 5000); })]); }
    catch (e) { res = { ok: false, err: 'net' }; }
    clearTimeout(timer);
    if (dead || seq !== ruleMemSeq) return; // 頁を離れた後の古い返し
    const s = pickStart(res);
    ruleMem = { memory: s.unread ? { 3: 'bad', 4: 'bad' } : { 3: s.bad.includes(3) ? 'bad' : s.memory[3], 4: s.bad.includes(4) ? 'bad' : s.memory[4] } };
    if (page === 'rules') render();
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
    try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: ids.op_id, p_ops: [op] }); }
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
    ruleMsg = s.err === 'busy' ? (s.kind === 'retry' ? '混んでいます。1分待ってもう一度押してください。' : errText({ err: 'busy', what: s.what }, 'write')) // P6g §5
      : s.kind === 'retry' ? 'つながりませんでした。電波を確かめてもう一度押してください。' : ruleErrText(d || { err: s.err });
    rerender(); kick();
  }
  const ruleErrText = (r) => (r && r.err === 'bad' && r.at === 'extras' ? '前のルールのチップ等を合計0にしてから変えてください'
    : 'ルールを変えられません（' + (HELD_WHY[r && r.err] || (r && r.err) || '?') + '）');
  function ruleDone(next) {
    const was = table.table_id;
    st = next; save(KEYR, st);
    setTable(st.tables.find((t) => t.table_id === was));
    ruleCtl = null; ruleMsg = null; page = 'room'; ruleMem = null; ruleMemSeq++; ruleMemo = false; // 送った人数は倉庫が覚えた＝次に開く時に読み直す
    ruleNote = table.table_id !== was ? ruleChangedText(chainView(st, table.table_id)) : null; // 同じ rules＝区切らない＝何も変わらない
    render();
  }

  // ── ［部屋を終える］（B3b-1 §0〜§2）──
  // 出すのは shared で終えていない部屋の kan か owner（持ち主かは倉庫が決める）・mj_role を受けた端末（not_owner）には出さない
  const canClose = () => shared && !LG && !room.closed && !room.not_owner && (room.role === 'kan' || room.owner === true);
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

  // ── A6 ［部屋を消す］（a6_sadame v1.3 §1）──
  // 出すのは持ち主（room.owner＝作った時か mj_read）・mj_role を受けた端末には出さない・リーグの対局は外す・印の無い gone（もう消えている）も出さない
  function canDel() { return !LG && room.owner === true && !room.not_owner && stopped !== 'deleted' && (stopped !== 'gone' || delOn()); }
  const unsentN = () => outbox.length + (merge.size ? Math.ceil(merge.size / OPS_MAX) : 0);
  function delHtml() {
    const retry = delUi.retry && canDel() ? '<button class="btn btn-line" id="rDelRetry"' + (delBusy ? ' disabled' : '') + '>もう一度</button>' : '';
    const msg = delUi.msg ? '<p class="err" id="rDelMsg">' + esc(delUi.msg) + '</p>' : '';
    if (!canDel()) return msg ? '<div class="r-close" id="rDelBox">' + msg + '</div>' : '';
    let h = '<div class="r-close" id="rDelBox">';
    if (!delUi.open) h += '<button class="btn btn-aka-line" id="rDelRoom">部屋を消す</button>';
    else {
      const n = unsentN();
      h += '<p class="setsumei" id="rDelQ">部屋を消すと、入っていた人も誰も開けなくなります。7日の間は、ホームの［対局］（部屋を作る・入る）の一番下から戻せます。</p>' +
        (n ? '<p class="setsumei" id="rDelUnsent">この端末のまだ送れていない点 ' + n + '組も消えます。</p>' : '') +
        '<button class="btn btn-aka" id="rDelGo"' + (delBusy ? ' disabled' : '') + ' aria-busy="' + (delBusy ? 'true' : 'false') + '">部屋を消す</button>';
      if (!delOn()) h += '<button class="btn btn-line" id="rDelNo">やめる</button>'; // 送った後（印が在る間）はやめられない＝倉庫で通ったか分からない
    }
    return h + msg + retry + '</div>';
  }
  function wireDel() {
    const q = (s) => el.querySelector(s);
    if (q('#rDelRoom')) q('#rDelRoom').onclick = () => { if (delBusy) return; delUi = { open: true, msg: null, retry: false }; rerender(); };
    if (q('#rDelGo')) q('#rDelGo').onclick = () => sendDel();
    if (q('#rDelRetry')) q('#rDelRetry').onclick = () => sendDel();
    if (q('#rDelNo')) q('#rDelNo').onclick = () => { if (delOn()) return; delUi = { open: false, msg: null, retry: false }; rerender(); };
  }
  async function sendDel() {
    if (delBusy || dead || !canDel()) return;
    let op = null;
    try { op = localStorage.getItem(PDEL); } catch { op = null; }
    if (!op) { op = uuid(); localStorage.setItem(PDEL, op); } // 送り直しは同じ op_id
    delBusy = true; delUi = { open: true, msg: null, retry: false }; rerender();
    const res = await rpc('mj_write', { p_room_id: rid, p_op_id: op, p_ops: [{ op: 'room_delete' }] });
    delBusy = false;
    if (dead) return;
    delReply(res && typeof res === 'object' ? res : {});
  }
  function delReply(res) {
    const e = res.err;
    if (res.ok === true || e === 'gone') { delDone(); return; } // gone＝もう消えている（前の返りが切れた）＝印が在るので通ったと見る
    if (e === 'mj_reauth' || e === 'mj_session') { // 印は残す＝入り直したら同じ op_id
      delUi = { open: true, msg: errText(res, 'delete'), retry: false }; rerender();
      if (relogin) relogin(() => { if (!dead) sendDel(); });
      return;
    }
    if (e === 'mj_role') { dropDel(); room.not_owner = true; patchRoom(uid, rid, { not_owner: true }); delUi = { open: false, msg: errText(res, 'delete'), retry: false }; rerender(); return; }
    if (e === 'net' || e === 'offline' || e === 'busy' || e === 'server' || e === undefined || e === null) { delUi = { open: true, msg: errText(res, 'delete'), retry: true }; rerender(); return; } // 印は残す
    dropDel(); delUi = { open: false, msg: errText(res, 'delete'), retry: false }; rerender(); // full・mj_op_other_user・bad ほか＝同じ op_id でも同じ
  }
  /* 消した＝★先に stopped と並びを空に★（遅れて返る送りの done は空を保存するだけ）→ 印・並び・終える印を消す → 控えに deleted_at → ホーム */
  function delDone() {
    homeOff(); stopped = 'deleted';
    outbox = []; clearTimeout(mergeTimer); merge.clear(); clearTimeout(retryTimer);
    dropDel();
    try { localStorage.removeItem(OUTR); localStorage.removeItem(PCLOSE); } catch { /* 消せなくてもホームは deleted_at で出さない */ }
    patchRoom(uid, rid, { deleted_at: new Date().toISOString(), gone: false });
    leaveChan();
    location.assign('/');
  }

  function memberStats(mid) {
    // P5 §4：分けた読み（st.loaded が在る）では倉庫が全開催で数えた members の n・last を使う（写しには最後の数開催しか無い）
    const mm = Array.isArray(st.loaded) ? st.members.find((m) => m.member_id === mid) : null;
    if (mm && Number.isInteger(mm.n)) return { count: mm.n, last: typeof mm.last === 'string' ? mm.last : null };
    const hs = st.hanchans.filter((h) => !h.voided && h.seats.includes(mid));
    let last = null;
    for (const h of hs) { const t = st.tables.find((x) => x.table_id === h.table_id); const s = t && st.sessions.find((x) => x.session_id === t.session_id); if (s && (!last || s.date > last)) last = s.date; }
    return { count: hs.length, last };
  }
  function histNames() { return load(NAMES(uid), []).filter((nm) => !st.members.some((m) => m.name_key === nameKey(nm))); }
  /* ── C2-0（c20_sadame v2.1）［これは私］＝部屋の名簿の1人を自分のアカウントにつなぐ（op member_link・直送・並びに積まない）──
   * me・taken は倉庫の読み（mj_read の members）が付ける印。押せるのは終えていない部屋で、端末だけの写しでない時だけ */
  const myMember = () => st.members.find((m) => m.me === true && m.active) || null;
  const meOk = () => !room.closed && !st.needs_upload;
  function meHtml() {
    if (!meOk()) return '';
    const me = myMember();
    const msg = meMsg && page === 'pick' ? '<p class="err" id="pMeErr">' + esc(meMsg) + '</p>' : '';
    if (!me) return '<div class="r-white" id="pMeBand"><b>この部屋のあなたの名前を選ぶと、あなたの戦績に入ります</b><button class="btn btn-line btn-s" id="pMeGo">あなたの名前を選ぶ</button></div>' + msg;
    return '<p class="r-me" id="pMeLine">あなた＝<b>' + esc(me.name) + '</b><button class="btn btn-line btn-s" id="pMeGo">変える</button></p>' + msg;
  }
  function meBack() { meMsg = null; page = picking ? 'pick' : 'room'; render(); }
  function renderMe() {
    if (!meOk()) { meBack(); return; }
    bar({ back: picking ? '人を選ぶ' : '対局', onBack: meBack, title: 'あなたの名前' });
    const typed = el.querySelector('#meNew') ? el.querySelector('#meNew').value : '';
    const me = myMember();
    const others = st.members.filter((m) => m.active && m !== me);
    let h = '<p class="sec">' + (me ? 'あなた＝' + esc(me.name) + '・別の名前を押すと付け替える' : 'この部屋の名簿で、あなたの名前を押す') + '</p>';
    if (others.length) {
      h += '<div class="r-cand" id="meList">' + others.map((m) => {
        const lock = m.taken === true && !!me; // S1：me が在る間は他の人の名前を押せない（押すと M が外れて名乗りだけになる）
        const sub = m.taken === true ? (lock ? 'ほかの人がつないでいます。付け替えは部屋の管に頼んでください' : 'ほかの人がつないでいます（押すと名乗りが残ります）') : 'これは私';
        return '<button data-me="' + esc(m.member_id) + '"' + (lock || meBusy ? ' disabled' : '') + '><span>' + esc(m.name) + '</span><small>' + sub + '</small></button>';
      }).join('') + '</div>';
      if (me) h += '<p class="r-hint" id="meWarn">' + esc(me.name) + 'の半荘はあなたの戦績から外れ、選んだ名前の半荘が入ります。</p>';
    } else h += '<p class="r-hint">名簿にほかの名前がありません。</p>';
    h += mbHtml();
    h += '<p class="sec">名簿にいない時</p><label class="r-in"><span>名前</span><input id="meNew" maxlength="20" autocomplete="off" placeholder="（打つ）"></label>';
    h += '<button class="btn btn-main" id="meNewGo"' + (meBusy ? ' disabled' : '') + '>足して、これは私</button>';
    h += '<p class="err" id="meErr">' + esc(meMsg || '') + '</p>';
    el.innerHTML = h;
    el.querySelector('#meNew').value = typed;
    for (const b of el.querySelectorAll('#meList [data-me]')) b.onclick = () => mePick(b.dataset.me);
    el.querySelector('#meNewGo').onclick = () => meNew(el.querySelector('#meNew').value.trim());
    mbWire();
  }
  function meDraw() { if (page === 'me') renderMe(); else if (page === 'pick') renderPick(); }
  /* ── 8b A25r（a25r_sadame v2.1）［名簿を直す］＝人ごとに［名前を直す］［消す］・下に「消した人」［戻す］。点は人に付いたまま（member_active false）──
   * §1-5 送り＝並び（outbox）に積まず mj_write へ直に（sendMe と同じ門）・押した時に1回だけ op_id（pressOp）・答えが決まるまで同じ id
   * §1-8 自分の行は［消す］なし・他の人がつないだ行（taken）と出た人の行（left）は［つながりを外して消す］＝組 [member_unlink, member_active false] */
  const mbOk = () => !room.closed && !closingOn() && !writeBlocked();
  const mbTie = (m) => m.taken === true || m.left === true;
  function mbOffText(m) {
    let t = offText(m.name, memberUse(mb.mm.room, mb.mm.sts, m.member_id), { verb: '消す', unlink: mbTie(m), room: !LG });
    if (!LG && table && (lastSeats() || []).includes(m.member_id)) t += '次の半荘は人を選び直します。'; // §1-4 任意3
    return t;
  }
  function mbHtml() {
    if (!mbOk()) return '';
    if (!mb || !mb.open) return '<p class="r-mbgo"><button class="btn btn-line btn-s" id="mbGo">名簿を直す</button></p>';
    const ed = mb.ed, busy = !!(ed && ed.busy);
    const msg = (m) => (ed && ed.mid === m.member_id && ed.msg ? '<p class="err" id="mbMsg">' + esc(ed.msg) + '</p>' : '');
    let h = '<p class="r-mbgo"><button class="btn btn-line btn-s" id="mbGo" aria-expanded="true">名簿を直す</button></p><div class="r-mb" id="mbBox">';
    if (mb.mm && mb.mm.err) h += '<p class="err" id="mbRerr">点が読めませんでした。消す前に読み直してください</p><button class="btn-s" id="mbLoad">読み直す</button>';
    for (const m of st.members.filter((x) => x.active)) {
      const mid = esc(m.member_id);
      h += '<div class="r-mbrow" data-mb="' + mid + '"><span class="row-name">' + esc(m.name) + '</span><span class="lg-btns">';
      if (m.left !== true) h += '<button class="btn-s" data-mbrn="' + mid + '">名前を直す</button>';
      if (m.me !== true) h += '<button class="btn-s" data-mboff="' + mid + '">' + (mbTie(m) ? 'つながりを外して消す' : '消す') + '</button>';
      h += '</span></div>';
      if (m.me === true) h += '<p class="r-hint" data-mbme>あなたの名前は消せません（［変える］で別の名前に付け替えると消せます）</p>';
      if (ed && ed.mid === m.member_id && ed.kind === 'rename') h += '<div class="r-mbed" data-ed="rename"><input class="h-in" id="mbIn" maxlength="20" autocomplete="off" value="' + esc(ed.val != null ? ed.val : m.name) + '" aria-label="新しい名前"><span class="lg-btns"><button class="btn-s" id="mbRnOk"' + (busy ? ' disabled' : '') + '>保存</button><button class="btn-s" data-mbno>やめる</button></span></div>';
      if (ed && ed.mid === m.member_id && ed.kind === 'off') {
        const ok = !!(mb.mm && mb.mm.room);
        h += '<div class="r-mbed" data-ed="off"><span id="mbOffT">' + (ok ? esc(mbOffText(m)) : mb.mm && mb.mm.err ? '' : '点を読んでいます…') + '</span><span class="lg-btns"><button class="btn-s" id="mbOffOk"' + (ok && !busy ? '' : ' disabled') + '>' + (mbTie(m) ? 'つながりを外して消す' : '消す') + '</button><button class="btn-s" data-mbno>やめる</button></span></div>';
      }
      h += msg(m);
    }
    const gone = st.members.filter((x) => !x.active && x.left !== true);
    if (gone.length) {
      h += '<p class="sec" id="mbGone">消した人</p>';
      for (const m of gone) h += '<div class="r-mbrow" data-mbg="' + esc(m.member_id) + '"><span class="row-name">' + esc(m.name) + '</span><span class="lg-btns"><button class="btn-s" data-mbon="' + esc(m.member_id) + '"' + (busy ? ' disabled' : '') + '>戻す</button></span></div>' + msg(m);
    }
    return h + '</div>';
  }
  // §1-4：［消す］を押した時に読む＝部屋（分けた読みなら members[].n）と取り消していない各リーグ。全部 ok まで確かめの［消す］は押せない
  async function mbLoad() {
    if (!mb) return;
    const seq = (mb.seq = (mb.seq || 0) + 1);
    mb.mm = null;
    const r = await readRoom(rid, null);
    const d = r && r.data;
    if (dead || !mb || mb.seq !== seq) return;
    if (r.error || !d || d.ok !== true || !d.st) { mb.mm = { err: true }; meDraw(); return; }
    const live = (Array.isArray(d.leagues) ? d.leagues : []).filter((l) => !l.voided);
    const got = await Promise.all(live.map((l) => readLeague(rid, l.league_id, null)));
    if (dead || !mb || mb.seq !== seq) return;
    if (got.some((x) => !x || x.error || !x.data || x.data.ok !== true || !x.data.st)) { mb.mm = { err: true }; meDraw(); return; }
    mb.mm = { room: d.st, sts: got.map((x) => x.data.st) };
    meDraw();
  }
  async function mbSend(mid, kind, ops) {
    if (!mb || dead) return;
    if (!(mb.ed && mb.ed.mid === mid && mb.ed.kind === kind)) mb.ed = { mid, kind };
    const ed = mb.ed;
    if (ed.busy) return;
    const say = (m) => { ed.msg = m; meDraw(); };
    if (stopped) return say('今は書き込めません（上の帯を見てください）。');
    if (writeBlocked()) return say('この部屋は終わりました（終えています）。名簿は直せません。');
    if (heldInfo(outbox)) return say('止まっている書き込みがあります。先にそちらを片付けてください。');
    flushMerge(true, true);
    if (outbox.length || merge.size) { kick(); return say('前に入れた点を送っています。送れたら、もう一度押してください。'); } // §1-5 v1 止め1
    if (st.needs_upload) return say('この端末の点をまだ部屋に入れていません。入れてから直してください。');
    if (offline()) return say('電波がつながってから直せます。');
    if (lane) return say('読み込み中です。少し待ってもう一度押してください。');
    ed.p = pressOp(ed, ops, uuid);
    lane = true; ed.busy = true; ed.msg = null; meDraw();
    let res;
    try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: ed.p.op_id, p_ops: ops }); } // 2b：ログインの誤りなら鍵を1回引き直す
    catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
    lane = false; ed.busy = false;
    if (dead) return;
    const d = res && res.data, s = outboxStep(res);
    if (s.kind !== 'retry') ed.p = null;
    if (s.kind === 'done') {
      aizuOut(d);
      const a = applyOps(st, ops, aopts({ direct: true, role: room.role })); // §1-5 v1 止め2：読みが skip でも写しは新しい
      if (a.ok) { st = a.state; save(KEYR, st); }
      if (mb) mb.ed = null;
      sync(); meDraw(); return;
    }
    if (s.kind === 'login') { loginStop(s.err); return; }
    if (s.kind === 'reload') { goneStop(); return; }
    if (s.kind === 'closed') { roomInfo({ closed: true }); render(); return; }
    if (s.kind === 'retry') return say('送れませんでした。電波を確かめてもう一度押してください。');
    if (s.err === 'tsunagi') { sync(); return say('この人は今アカウントにつながりました。読み直すと［つながりを外して消す］になります。'); } // §1-8 止めA
    if (['dup', 'left', 'mj_role'].includes(s.err)) sync();
    return say(meiboErr({ err: s.err }) || errText({ err: s.err, what: s.what, at: s.at }, 'write'));
  }
  function mbWire() {
    const q = (s) => el.querySelector(s), all = (s) => el.querySelectorAll(s);
    if (q('#mbGo')) q('#mbGo').onclick = () => { mb = mb && mb.open ? null : { open: true, ed: null, mm: null }; meDraw(); };
    if (!mb || !mb.open) return;
    if (q('#mbLoad')) q('#mbLoad').onclick = () => { mbLoad(); meDraw(); };
    for (const b of all('[data-mbrn]')) b.onclick = () => { mb.ed = { mid: b.dataset.mbrn, kind: 'rename' }; meDraw(); const i = q('#mbIn'); if (i) i.focus(); };
    for (const b of all('[data-mboff]')) b.onclick = () => { mb.ed = { mid: b.dataset.mboff, kind: 'off' }; mbLoad(); meDraw(); };
    for (const b of all('[data-mbno]')) b.onclick = () => { mb.ed = null; meDraw(); };
    for (const b of all('[data-mbon]')) b.onclick = () => mbSend(b.dataset.mbon, 'on', [memberOp.on(b.dataset.mbon)]);
    if (q('#mbIn')) q('#mbIn').oninput = (e) => { if (mb && mb.ed) mb.ed.val = e.target.value; };
    if (q('#mbRnOk')) q('#mbRnOk').onclick = () => {
      const i = q('#mbIn'), c = nameCheck(i ? i.value : '');
      mb.ed.val = i ? i.value : null;
      if (!c.ok) { mb.ed.msg = c.msg; meDraw(); return; }
      mbSend(mb.ed.mid, 'rename', [memberOp.rename(mb.ed.mid, c.name)]);
    };
    if (q('#mbOffOk')) q('#mbOffOk').onclick = () => {
      const mid = mb.ed.mid, m = st.members.find((x) => x.member_id === mid);
      if (!m || !(mb.mm && mb.mm.room)) return;
      mbSend(mid, 'off', (mbTie(m) ? [{ op: 'member_unlink', member_id: mid }] : []).concat([memberOp.off(mid)])); // §1-8：unlink が先（user_id が空になって tsunagi の門を通る）
    };
  }
  function mePick(mid) {
    const x = st.members.find((m) => m.member_id === mid && m.active);
    if (!x) return;
    const me = myMember();
    if (me && x.taken === true) return; // 押せない形（古い画面でも送らない）
    sendMe((me ? [{ op: 'member_unlink', member_id: me.member_id }] : []).concat([{ op: 'member_link', member_id: mid }]), { mid, name: x.name });
  }
  function meNew(nm) {
    const key = nameKey(nm || '');
    if (!nm || [...nm].length > 20 || !key) { meMsg = '名前は1〜20字です。'; meDraw(); return; }
    if (st.members.some((m) => m.active && m.name_key === key)) { meMsg = '同じ名前が名簿にいます。上の一覧から選んでください。'; meDraw(); return; }
    const id = meOp && meOp.addKey === key ? meOp.addId : uuid(); // 返りが切れた後の押し直しは同じ id（同じ組＝同じ op_id）
    const me = myMember();
    sendMe((me ? [{ op: 'member_unlink', member_id: me.member_id }] : []).concat([{ op: 'member_add', member_id: id, name: nm }, { op: 'member_link', member_id: id }]), { mid: id, name: nm, addKey: key, add: true });
  }
  async function sendMe(ops, t) {
    if (meBusy || dead) return;
    const say = (m) => { meMsg = m; meDraw(); };
    if (stopped) return say('今は書き込めません（上の帯を見てください）。');
    if (writeBlocked()) return say('この部屋は終わりました（終えています）。名前は選べません。');
    if (heldInfo(outbox)) return say('止まっている書き込みがあります。先にそちらを片付けてください。');
    flushMerge(true, true);
    if (outbox.length || merge.size) { kick(); return say('前に入れた点を送っています。送れたら、もう一度押してください。'); }
    if (offline()) return say('電波がつながってから選べます。');
    if (lane) return say('読み込み中です。少し待ってもう一度押してください。');
    const key = JSON.stringify(ops);
    if (!meOp || meOp.key !== key) meOp = { key, op_id: uuid(), addKey: t.addKey, addId: t.add ? t.mid : undefined };
    const opId = meOp.op_id;
    lane = true; meBusy = true; meMsg = null; meDraw();
    let res;
    try { res = await rpcRaw('mj_write', { p_room_id: rid, p_op_id: opId, p_ops: ops }); }
    catch (e) { res = { error: { message: String((e && e.message) || e) } }; }
    lane = false; meBusy = false;
    if (dead) return;
    const d = res && res.data;
    const s = outboxStep(res);
    if (s.kind !== 'retry') meOp = null;
    if (s.kind === 'done') {
      aizuOut(d);
      const a = applyOps(st, ops, aopts({ direct: true, role: room.role }));
      if (a.ok) { st = a.state; save(KEYR, st); }
      const rs = d && Array.isArray(d.results) ? d.results : [];
      const last = rs[rs.length - 1];
      if (last && last.claimed === true) { meMsg = '『' + t.name + '』はほかの人がつないでいます。部屋の管に付け替えを頼んでください（名乗りを残しました）'; sync(); meDraw(); return; }
      for (const m of st.members) { if (m.member_id === t.mid) { m.me = true; delete m.taken; } else if (m.me === true) delete m.me; }
      save(KEYR, st);
      if (picking && t.add && picking.seats.length < picking.n && !picking.seats.includes(t.mid)) picking.seats.push(t.mid); // 足した自分はこの半荘に入れる
      meMsg = null; page = picking ? 'pick' : 'room'; sync(); render(); return;
    }
    if (s.kind === 'login') { loginStop(s.err); return; }
    if (s.kind === 'reload') { goneStop(); return; }
    if (s.kind === 'closed') { roomInfo({ closed: true }); render(); return; }
    if (s.kind === 'retry') return say(s.err === 'busy' ? '混んでいます。1分待ってもう一度押してください。' : 'つながりませんでした。電波を確かめてもう一度押してください。');
    const me = myMember();
    if (s.err === 'taken') { meRead = true; sync(); return say('『' + t.name + '』は今ほかの人がつなぎました。' + (me ? 'あなたの名前は' + me.name + 'のままです。' : '')); }
    if (s.err === 'linked') { meRead = true; sync(); return say('あなたは別の名前につながっていました。読み直しました。もう一度選んでください。'); }
    if (s.err === 'dup') { meRead = true; sync(); return say('同じ名前が名簿にいます。上の一覧から選んでください。'); }
    if (s.err === 'mj_role') sync();
    return say(errText({ err: s.err, what: s.what, at: s.at }, 'write'));
  }
  function renderPick() {
    bar({ back: '対局', onBack: toRoom, title: '人を選ぶ' });
    const p = picking;
    if (p.seats.some((m) => !actOf(m))) { p.offB = [...new Set((p.offB || []).concat(p.seats.filter((m) => !actOf(m)).map(nameOf)))]; p.seats = p.seats.filter(actOf); } // 8b §1-7：開いている間に消した人は抜く（帯に名前）
    p.shownAct = actKey();
    const n = p.n; // D2 止め2：開いた時の卓の人数（読み直しで今の卓が替わっても）
    const act = st.members.filter((m) => m.active);
    const hist = histNames();
    let h = meHtml() + (p.offB && p.offB.length ? '<div class="r-red" id="pOffB"><b>' + esc(p.offB.join('・')) + 'さんを消したので、打つ人を選び直してください（打った点は残っています）</b></div>' : '') + (p.reN ? '<div class="r-red" id="pReN"><b>今の回から' + n + '人打ちです。打つ人を選び直してください（打った点は残っています）。</b></div>' : '') + '<div id="pBase">';
    if (act.length) h += '<p class="sec">この部屋の人（名簿）・この半荘の' + n + '人を押す　<b class="kon">' + p.seats.length + '／' + n + '</b></p><div class="chips">' + act.map((m) => '<button data-pick="' + esc(m.member_id) + '" aria-pressed="' + p.seats.includes(m.member_id) + '">' + esc(m.name) + (m.me === true ? '<small class="r-me-tag">あなた</small>' : '') + '</button>').join('') + '</div>';
    if (hist.length) h += '<p class="sec">この端末で前に使った名前（ほかの部屋）</p><div class="chips">' + hist.map((nm) => '<button data-hist="' + esc(nm) + '">' + esc(nm) + '</button>').join('') + '</div>';
    if (act.length || hist.length) h += '<p class="r-hint">押すだけでこの半荘に入る。ほかの部屋の名前を押すと、この部屋の名簿にも足される。</p>';
    h += '</div><p class="sec">新しい人</p><label class="r-in"><span>名前</span><input id="pNew" maxlength="20" autocomplete="off" placeholder="（打つ）"></label>';
    h += '<div id="pCand"></div><p class="err" id="pErr"></p>';
    // A20 §3：外した人の打った点は保存するまで見せ続ける（押し直せば戻る）
    const out = Object.keys(p.carry || {}).filter((m) => !p.seats.includes(m));
    h += mbHtml();
    h += '<div id="pFoot"><button class="btn btn-main" id="pGo"' + (p.seats.length === n ? '' : ' disabled') + '>この' + n + '人で' + (p.only ? '決める' : '始める') + '</button>' +
      '<p class="r-hint">席（東南西北）は選ばない。</p>' + (!p.only && nonL(tOf(p.tid)) ? '<p class="r-hint" id="pOnly">この半荘だけ</p>' : '') + (out.length ? '<p class="r-hint" id="pOut">外した人：' + out.map((m) => esc(nameOf(m)) + ' ' + esc(p.carry[m])).join('・') + '</p>' : '') + '</div>';
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
      h += '<button data-new="1"><span>' + esc(typed) + '</span><small>新しい人で足す</small></button>';
      if (meOk() && !myMember()) h += '<button data-newme="1"' + (meBusy ? ' disabled' : '') + '><span>' + esc(typed) + '</span><small>新しい人で足す（これは私）</small></button>';
      h += '</div>';
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
    if (!r.ok) return { err: r.msg || '名前は1〜20字です。' };
    rememberName(nm);
    return { mid: st.members[st.members.length - 1].member_id };
  }
  function seat(mid) {
    const s = picking.seats, n = picking.n;
    if (s.includes(mid)) s.splice(s.indexOf(mid), 1);
    else if (s.length < n) s.push(mid);
    else { el.querySelector('#pErr').textContent = 'もう' + n + '人です。外す人を先に押してください。'; return false; }
    return true;
  }
  function pickDone(mid) { if (mid && !picking.seats.includes(mid)) seat(mid); renderPick(); }

  // D2 止め2：人を選ぶ所は開いた時の卓に結ぶ（tid・n）
  const pickOf = (o) => ({ ...o, tid: table.table_id, n });
  function lastSeats() {
    const ch = tableChain(st, table.table_id);
    const hs = ch.flatMap((tid) => st.hanchans.filter((x) => x.table_id === tid && !x.voided));
    return hs.length ? hs[hs.length - 1].seats.slice() : null;
  }
  // E1 §6：保存の形 tobi_to = {"r":[並べた重ならない席]}。昔の鍵の形（テスト線だけ）は押していない扱い
  const tobiROf = (t) => (t && Array.isArray(t.r) ? t.r.filter((x) => Number.isInteger(x)) : []);
  const tobiRSorted = (a) => [...new Set(a)].sort((x, y) => x - y);
  function startEntry(hid) {
    // E2 §3：鎖に開いている回（取り消していない・点がまだの席が在る）が在れば、新しい回でなくその回を開く（鎖に1つだけ）
    if (!hid && table) { const ch = tableChain(st, table.table_id); const op = st.hanchans.find((h) => ch.includes(h.table_id) && !h.voided && h.cells.some((v) => v === null)); if (op) hid = op.hanchan_id; }
    if (hid) {
      const x = st.hanchans.find((y) => y.hanchan_id === hid);
      // C4 §5a：番号は鎖の通し番号・数えはその回の卓のルール（直す書きはその回の卓のまま＝運ばない）
      const xr = chainView(st, table.table_id).rows.find((y) => y.hanchan_id === hid);
      const xt = st.tables.find((y) => y.table_id === x.table_id);
      entry = { hanchan_id: hid, tid: x.table_id, no: xr ? xr.no : x.no, R: xt ? xt.rules : R, seats: x.seats.slice(), cells: x.cells.map((v) => (v === null ? '' : boxNum(Number(v)))), lost: String(x.lost || 0), marks: x.cells.includes(null) ? [] : orderCovered(xt ? xt.rules : R, x.cells, x.ton_order, Object.prototype.hasOwnProperty.call(x, 'order_cells') ? x.order_cells : null) ? marksFromOrder(xt ? xt.rules : R, x.cells, orderIdx(x)) : [], voided: x.voided, tobiR: tobiROf(x.tobi_to), // A13：前の並びから同じ点の人の［上家］の印を戻す（§6＝覆っていない新しい同点なら印は空＝押し直し・行ごと）
        // 開いた時の値と版（2d §3「edit の entry の版は今のまま」＝読み直しで写しが替わっても、ぶつかれば conflict で止める）
        orig: { cells: x.cells.slice(), cell_ver: x.cell_ver.slice(), lost: x.lost, version: x.version, ton_order: x.ton_order, order_version: x.order_version, order_cells: Object.prototype.hasOwnProperty.call(x, 'order_cells') ? x.order_cells : null, tobiR: tobiROf(x.tobi_to), tobi_version: x.tobi_version } };
    } else {
      // L A23：リーグの日は nextSeats（卓の席が正しければそれ・空なら前の半荘・他の卓と重なる・外した人入り＝null＝選ぶ）。ふつうの部屋は今まで通り
      const lgT = lgDay(table), ls = lastSeats();
      { // 8b §1-7：前の回か卓の席に消した人が居れば点の頁へ行かず人を選ぶ（preSeats・nextSeats より前）
        const tS = (tOf(table.table_id) || table).seats, tA = Array.isArray(tS) && tS.length ? tS : null;
        const base = lgT ? tA || ls : ls || tA;
        if (Array.isArray(base) && base.some((m) => !actOf(m))) { picking = pickOf({ seats: base.filter(actOf), carry: {}, tobiM: [], offB: base.filter((m) => !actOf(m)).map(nameOf) }); page = 'pick'; render(); return; }
      }
      const seats = lgT ? nextSeats(st, table.table_id, n, { league: true }) || (ls && ls.length !== n ? ls : null) : ls || preSeats(); // 半荘が在れば前の席・無ければ前もって決めた卓の人（A20 の人数違いはリーグの日も選び直しの帯）
      if (!seats) { picking = pickOf({ seats: [] }); page = 'pick'; render(); return; }
      if (seats.length !== n) { picking = pickOf({ seats, carry: {}, tobiM: [], reN: true }); page = 'pick'; render(); return; } // A20 §1-2・§3：前の回と人数が違う＝打つ人を選び直す
      entry = { seats, tid: table.table_id, no: chainView(st, table.table_id).nextNo, R, cells: new Array(n).fill(''), lost: '0', marks: [], tobiR: [] }; // D2 止め2：保存は開いた時の卓へ
    }
    page = 'edit'; render();
  }
  // その回の卓のルール（C4 §5a：前の回は前の卓のルールで数える・新しい回は鎖の最後の卓）
  // A20 §4・§9 任意1：新しい回は描く時・押す時に毎回、結んだ卓の今の鎖の最後を引く（entry.tid・no も付いて行く）。直す回は今まで通りその回の卓
  function eFollow() {
    const e = entry;
    if (!e || e.hanchan_id) return null;
    const t = tOf(e.tid);
    if (t) { e.tid = t.table_id; e.no = chainView(st, t.table_id).nextNo; }
    return t;
  }
  const eRules = () => { const t = eFollow(); const R1 = (t && t.rules) || (entry && entry.R) || R; return { R: R1, n: R1.players, kieru: R1.kyotaku_end === 'kieru' }; };
  const needReN = () => { const t = eFollow(); return !!(t && t.rules.players !== entry.seats.length); };
  // A20 §3：人数が替わった＝打つ人を選び直す（点は人ごとに残す・［飛び賞］の印も人に付ける）。呼ぶ前に readCells（edit の頁の時）
  function reNPick() {
    const e = entry, t = eFollow();
    const carry = { ...(e.carry || {}) };
    e.seats.forEach((m, i) => { if (String(e.cells[i]).trim() !== '') carry[m] = e.cells[i]; else delete carry[m]; });
    picking = { seats: e.seats.slice(), tid: t.table_id, n: t.rules.players, carry, tobiM: e.tobiR.map((i) => e.seats[i]), reN: true };
    entry = null; page = 'pick'; render();
  }
  // 8b §1-7 v1 止め3：新しい回の点の頁で［入れる］の時に消した人が居る＝積まずに人を選ぶ（打った点は人ごとに carry）
  function offPick() {
    const e = entry, t = eFollow() || tOf(e.tid);
    const carry = { ...(e.carry || {}) };
    e.seats.forEach((m, i) => { if (String(e.cells[i]).trim() !== '') carry[m] = e.cells[i]; else delete carry[m]; });
    picking = { seats: e.seats.filter(actOf), tid: t.table_id, n: t.rules.players, carry, tobiM: e.tobiR.map((i) => e.seats[i]).filter(actOf), offB: e.seats.filter((m) => !actOf(m)).map(nameOf) };
    entry = null; page = 'pick'; render();
  }
  // A20 §1-2：入力中の読み直し（sync の後）＝人数が違えば選び直し・同じ人数でルールが替わったら見えている数えを替える（送る卓と揃える）
  //   箱の形（［飛び賞］釦・［消えた供託］の欄）が同じなら描き直さず合計と［上家］の字だけ（打っている途中で鍵盤を閉じない）
  const eShape = () => String(tobiBtnOn()) + String(eRules().kieru);
  function entryFollow() {
    if (page !== 'edit' || !entry || entry.hanchan_id) return;
    if (needReN()) { readCells(); reNPick(); return; }
    if (entry.shownR === cn(eRules().R)) return;
    if (eShape() !== entry.shownK) { readCells(); render(); return; }
    entry.shownR = cn(eRules().R); liveUpdate();
  }
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
    return { want, got, filled, nums, rest, sug }; // E1：行の pt の字は消した（pt と順位は対局の一覧で出す）
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
    if (needReN()) return reNPick(); // A20 §1-2
    const { n, kieru } = eRules();
    e.shownR = cn(eRules().R); e.shownK = eShape();
    bar({ back: '対局', onBack: toRoom, title: e.no + '回目の点を' + (e.hanchan_id ? '直す' : '入れる') });
    let h = '';
    {
      const c = liveCalc();
      // A13（11-23 司さん）＝全員の行の点のすぐ左に、いつも［上家］（押したら色だけ変わる・番号は出さない）
      const lb = kamLabels(); // A13 v2 §1 [stop1]：描くたびに labels から（番号を消さない）
      // E1（A19 11-26 司さん）＝行は［名前］…［飛び賞］［上家］［点］・pt の字は消して点の箱を右端に。［飛び賞］は押した人がもらう（何人でも）
      const tb = tobiBtnOn();
      h += '<div class="r-ent' + (tb ? ' r-ent-tb' : '') + '">' + e.seats.map((m, i) => '<div class="r-er"><span class="r-er-n">' + esc(nameOf(m)) + '</span>' + (tb ? '<button type="button" class="r-kam r-tobi" data-tobi="' + i + '" aria-pressed="' + e.tobiR.includes(i) + '" aria-label="' + esc(nameOf(m)) + 'が飛び賞をもらう">飛び賞</button>' : '') + '<button type="button" class="r-kam" data-kam="' + i + '" aria-pressed="' + lb[i].on + '" aria-label="' + esc(nameOf(m)) + 'が' + lb[i].text + '">' + lb[i].text + '</button><input class="r-er-v" readonly inputmode="none" data-c="' + i + '" value="' + esc(e.cells[i]) + '" placeholder="' + esc(sugText(c, i)) + '" autocomplete="off" aria-label="' + esc(nameOf(m)) + 'の素点"></div>').join('') + '</div>';
      if (e.note) h += '<p class="r-check mada" id="eNote">' + esc(e.note) + '</p>';
      if (kieru) h += '<label class="r-in"><span>消えた供託</span><input id="eLost" readonly inputmode="none" value="' + esc(e.lost) + '" autocomplete="off"></label>';
      h += sumLine(c) + '<p class="r-hint">pt と順位は点から自動で出す。</p>';
    }
    h += '<p class="err" id="eErr"></p>';
    h += '<button class="btn btn-main" id="eOk">' + (e.hanchan_id ? '直す' : '入れる') + '</button>';
    if (e.hanchan_id) h += '<button class="btn btn-line" id="eVoid">' + (e.voided ? 'この半荘を戻す' : 'この半荘を取り消す') + '</button>';
    else h += '<button class="btn btn-line" id="ePeople">人を替える</button>';
    h += '<div class="kp-sp" id="eKpSp" hidden></div>' + KP_HTML;
    el.innerHTML = h;
    wireEdit();
  }
  // アプリの数字鍵盤（司さん 11-21 夜「iPhoneでもAndroidでもキーボードだしたらよかろが」）＝A17 から js/kenban.mjs（A8）の部品。鍵は箱に入った時に部品が描く
  //   KP_SPEC＝−あり・小数なし・10桁（A18：±20億 CELL_MAX の外は保存の時に字で弾く）
  const KP_SPEC = { neg: true, dec: false, max: 10 };
  const KP_HTML = '<div class="kp" id="eKp" role="group" aria-label="数字の鍵盤" hidden></div>';
  function readCells() {
    for (const inp of el.querySelectorAll('[data-c]')) entry.cells[Number(inp.dataset.c)] = inp.value;
    const lost = el.querySelector('#eLost'); if (lost) entry.lost = lost.value;
  }
  function liveUpdate() {
    readCells();
    const c = liveCalc();
    for (const inp of el.querySelectorAll('[data-c]')) inp.placeholder = sugText(c, Number(inp.dataset.c));
    el.querySelector('#eSum').outerHTML = sumLine(c);
    drawKam();
  }
  // A13 v2：［上家］の字と押した印は今の点と印から毎回引く（同じ点の組は点で変わる）
  // E1：［飛び賞］釦は飛び賞を使う卓（tobi true・tobi_pt≥1）で払う先が「飛ばした人」の時だけ（「全員」は今のまま・釦なし）
  function tobiBtnOn() { const R0 = eRules().R; return tobiUsed(R0) && R0.tobi_from === 'busted'; }
  function kamLabels() { const e = entry; return labels(eRules().R, e.cells.map(toInt), e.marks); }
  function drawKam() {
    const lb = kamLabels();
    for (const b of el.querySelectorAll('[data-kam]')) { const i = Number(b.dataset.kam), x = lb[i]; b.setAttribute('aria-pressed', String(x.on)); b.textContent = x.text; b.setAttribute('aria-label', nameOf(entry.seats[i]) + 'が' + x.text); }
  }
  function entryNext() {
    const e = entry;
    const { R, n, kieru } = eRules();
    const err = (t) => { el.querySelector('#eErr').textContent = t; };
    {
      readCells();
      if (needReN()) return reNPick(); // A20 §1-2：［保存］を押した時も人数を見る（古い長さのまま送らない）
      if (!e.hanchan_id && e.seats.some((m) => !actOf(m))) return offPick(); // 8b §1-7 v1 止め3
      const cells = e.cells.map(toInt);
      // E2 §1（11-26 司さん＝代表1人でも各自でも）：1つでも入っていれば入れる（空いた席は null）・全部空は止める
      const blank = e.cells.map((v) => String(v).trim() === '');
      if (blank.every(Boolean) || cells.some((x, i) => Number.isNaN(x) && !blank[i])) return err('全員の点を数で入れてください。');
      if (e.hanchan_id && blank.some((b, i) => b && e.orig.cells[i] !== null)) return err('入っている点は消せません。数を入れてください。');
      const got = cells.filter((x) => !Number.isNaN(x));
      if (got.some((x) => x % 100 !== 0)) return err('点は100点単位で入れてください。');
      if (got.some((x) => Math.abs(x) > CELL_MAX)) return err('点は ±' + CELL_MAX.toLocaleString('ja-JP') + ' までです。');
      const lost = kieru ? toInt(e.lost || '0') : 0;
      if (Number.isNaN(lost) || lost < 0 || lost % 1000 !== 0 || lost > LOST_MAX) return err('消えた供託は0〜' + LOST_MAX.toLocaleString('ja-JP') + 'の1000点単位です。');
      if (blank.some(Boolean)) { e.num = cells.map((x) => (Number.isNaN(x) ? null : x)); e.lostNum = lost; e.order = []; return save1(); } // E2 §2：合計と［上家］は全員そろってから
      const c = checkEntry(R, cells, lost);
      if (!c.ok && c.why === 'sum') return err('素点の合計が ' + diffText(c.diff) + 'です。');
      if (!c.ok) return err('入れられません（' + c.why + '）。');
      e.num = cells; e.lostNum = lost;
      // A13：同じ点の人がいて［上家］の印が足りなければ同じ画面で止める（別の画面・窓にしない）
      const k = c.needOrder ? fromMarks(R, cells, e.marks) : { need: false };
      if (k.need && !k.ok) return err('同じ点の人の［上家］を押してください。');
      e.order = k.need ? k.order : [];
      return save1();
    }
  }
  const seenN = (tid) => { const ch = tableChain(st, tid); return st.hanchans.filter((h) => ch.includes(h.table_id)).length; };
  function save1() {
    const e = entry;
    let ops;
    if (!e.hanchan_id) {
      eFollow(); // A20 §1-1：押した時に見えていた卓＝この端末の鎖の最後
      const op = { op: 'hanchan_start', hanchan_id: uuid(), table_id: e.tid, seats: e.seats, cells: e.num, lost: e.lostNum, follow: false, seen_n: seenN(e.tid) }; // E2 §5 seen_n＝この端末が持つ鎖の回の数（取り消しも数える）・A20 §1-1：follow:false＝倉庫に届いた時に区切られていてもその卓に入る（押した時のルール）
      if (e.order.length) { op.ton_order = e.order.map((i) => e.seats[i]); op.seen_cells = e.num.slice(); }
      if (tobiBtnOn() && e.tobiR.length) op.tobi_to = { r: tobiRSorted(e.tobiR) }; // E1 §6 // 順は member_id の配列（§6-6）・A13 §6＝見た点を付ける
      ops = [op];
      // L A23：L がリーグの日に［人を替える］で替えた＝同じ組で卓の席も替える（次の半荘も同じ人）。送る卓＝押した時の鎖の最後（e.tid）
      if (e.tSeats && lgDay(tOf(e.tid)) && isL()) { const tl = tOf(e.tid); if (tl && cn(tl.seats || []) !== cn(e.seats)) ops.push({ op: 'table_seats', table_id: tl.table_id, seats: e.seats.slice() }); }
    } else {
      const h = { hanchan_id: e.hanchan_id, ...e.orig };
      ops = [];
      e.num.forEach((v, i) => { if (v !== h.cells[i]) ops.push({ op: 'cell_set', hanchan_id: h.hanchan_id, seat: i, value: v, base_version: h.cell_ver[i] ?? 0 }); }); // E2 §4：行が無い席は版0（倉庫が v1 で入れる）
      // E1 §6：押した人が変わった時だけ tobi_set（版＝開いた時の tobi_version）。点を直しても押した人は変えない
      if (tobiBtnOn() && canon(tobiRSorted(e.tobiR)) !== canon(tobiRSorted(h.tobiR))) ops.push({ op: 'tobi_set', hanchan_id: h.hanchan_id, tobi_to: { r: tobiRSorted(e.tobiR) }, base_version: h.tobi_version });
      if (e.lostNum !== h.lost) ops.push({ op: 'kyotaku_set', hanchan_id: h.hanchan_id, value: e.lostNum, base_version: h.version });
      const was = h.ton_order ? h.ton_order.map((m) => e.seats.indexOf(m)) : null;
      // A13：同じ点の組の中の前後が前と同じなら並びは書かない（同じ点でない人の位置は答えを変えない＝要らない版上げをしない）
      // A13 §6：前と同じでも、保存した人が見た点（order_cells）が今の同点の組を覆っていなければ見た点を付けて書き直す
      const cov = e.num.includes(null) ? true : orderCovered(eRules().R, e.num, h.ton_order, h.order_cells); // E2：点がまだの回は並びを書かない（e.order は空）
      const ton = e.order.length && !(was && sameTie(eRules().R, e.num, was, e.order) && cov) ? e.order.map((i) => e.seats[i]) : null;
      if (ton && (canon(ton) !== canon(h.ton_order) || !cov)) ops.push({ op: 'hanchan_order', hanchan_id: h.hanchan_id, ton_order: ton, base_version: h.order_version, seen_cells: e.num.slice(), seen_seats: e.seats.slice() });
    }
    if (ops.length) {
      const r = commit(ops);
      if (!r.ok) { el.querySelector('#eErr').textContent = r.msg ? r.msg : '入れられません（' + r.err + (r.at ? '・' + JSON.stringify(r.at) : '') + '）。'; return; }
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
      if (m.why === 'order') return pre + m.no + '回目＝同じ点の人の［上家］がまだ';
      if (m.why === 'cells') return pre + m.no + '回目＝点がまだ' + (h ? cellsWho(h.hanchan_id, m.seats) : '');
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
    const ask = endAsk; endAsk = false; // A27 §1（止め1）：早い return（読み込み中・出せない・足し①）の前に必ず下ろす＝後の［精算を見る］で締めない
    bar({ back: '対局', onBack: toRoom, title: '精算' });
    const d = seisanData(), s = d.s;
    shownTag = tagKey();
    const top = '<div class="r-top"><span>' + (d.date ? esc(md(d.date)) + '・' : '') + ratesText(d.rates) + '・半荘' + d.count + '回</span>' + liveTag() + '</div>' + bandsHtml() + staleHtml(); // 精算の頁の上（2d §3 読めない時）
    if (!s.ok && s.err === 'unloaded') { // P5 §4：開いた開催が loaded に無い＝sessions に入れて読み直してから出す（額は出さない）
      if (!want.has(d.sid)) { want.add(d.sid); sync(); }
      el.innerHTML = '<div class="r-top"><span>' + (d.date ? esc(md(d.date)) : '') + '</span>' + liveTag() + '</div>' + bandsHtml() + staleHtml() + '<div class="r-red" id="sLoading"><b>この日の記録を読み込んでいます</b></div>'; wireBands(); return; // 半荘の数・レートも読めるまで出さない
    }
    if (!s.ok || d.bigNg) { el.innerHTML = top + '<div class="r-red"' + (s.err === 'big' || d.bigNg ? ' id="sBig"' : '') + '><b>' + (s.err === 'voided' ? 'この対局は取り消されています（精算は出しません）' : s.err === 'big' || d.bigNg ? BIG_TEXT : '精算を出せません（' + esc(s.err) + '）') + '</b></div>'; wireBands(); return; } // A18 §2：big＝払う表も1人ずつも出さない
    // 足し①＝この端末の写しの点が部屋に入っていない＝partial と同じく誰が誰に・1人ずつの額を1つも出さない（v3 止め2・s.missing が空でも出す）
    if (closedHold()) { el.innerHTML = top + '<div class="r-red" id="sClosedNo"><b>この端末の点の一部が部屋に入っていないので、精算の額は出しません。</b></div>'; wireBands(); return; }
    const settles = st.settles.filter((x) => x.session_id === d.sid);
    const last = settles[settles.length - 1];
    const lastMissing = last ? (last.missing || []) : [];
    const partial = lastMissing.length > 0 || s.missing.length > 0;
    if (partial) viewSnap = false; // 終えた時の額を見る道も無い（N2）
    const tenCh = last && !partial ? tenChanged(last.content.ten, s.ten) : []; // 鍵を合わせて比べる（S2 v1.1 止め2）
    const ptCh = last && !partial ? tenChanged(last.content.pt10NoRate || {}, s.pt10NoRate || {}) : []; // w2a：レートなしの卓の pt も比べる（締めた後の変わり・お金）
    const chWho = tenCh.concat(ptCh.filter((m) => !tenCh.includes(m))); // 重ねずに数える（点と pt の両方が変わった人は1人）
    const changed = !!last && (partial ? cn(lastMissing) !== cn(s.missing) : chWho.length > 0);
    const many = chainHeads(d.sid).length > 1; // C4：区切った卓の鎖は1つの卓と数える
    const goBtn = s.missing.length ? '<button class="r-red r-red-btn" id="sGo"><b>入っていない物 ' + s.missing.length + '件</b>' + s.missing.map((m) => '<span>・' + esc(missingText(m, many, d.sid)) + '</span>').join('') + '<span class="r-link">押すとその場所へ</span></button>' : '';
    const errLine = closeErr ? '<div class="r-red"><b>' + (closeErr === HELD_GATE ? esc(HELD_GATE) : '対局終了を残せませんでした（' + esc(closeErr) + '）') + '</b></div>' : '';
    // ［対局終了］の所＝入っていない物があれば1回目は確かめ（同じ位置に［戻って入れる］・その下に赤の箱と［n件のまま対局終了］）
    // 終えた部屋は［対局終了］を出さない・終える送りの最中は押せない形（B3b-1 §3）
    const cz = closingOn() || goHome ? ' disabled' : ''; // A11：ホームへ行く送りの間も押せない
    const bz = ' aria-busy="' + (goHome ? 'true' : 'false') + '"';
    const closeArea = (label) => (room.closed ? '' : confirming && s.missing.length
      ? '<button class="btn btn-line" id="sBack">戻って入れる</button><div class="r-red"><b>入っていない物 ' + s.missing.length + '件のまま終了します。この対局の額は出しません</b></div><button class="btn btn-main" id="sClose2"' + cz + bz + '>' + s.missing.length + '件のまま対局終了</button>'
      : '<button class="btn btn-main" id="sClose"' + cz + bz + '>' + label + '</button>');
    let h = top;
    if (last) {
      if (lastMissing.length) h += '<div class="r-red"><b>' + hm(last.at) + ' に対局終了（入っていない物 ' + lastMissing.length + '件のまま・額は出しません）</b></div>';
      else h += '<div class="r-white">' + hm(last.at) + ' に対局終了</div>';
    }
    if (changed && !viewSnap) {
      if (partial) {
        h += '<div class="r-red"><b>入っていない物が変わりました（' + lastMissing.length + '件 → ' + s.missing.length + '件）</b></div>' + goBtn;
      } else {
        h += '<div class="r-red"><b>終えた後に変わりました（' + chWho.length + '人）</b><span>' + chWho.map((m) => esc(s.name(m))).join('・') + '</span></div>';
        h += '<p class="sec">終えた時 → 今</p><div class="list">' + tenCh.map((m) => { const a = last.content.ten[m] || 0, b = s.ten[m] || 0; return '<div class="li"><span class="b">' + esc(s.name(m)) + '</span><span class="li-v">' + fmt(a) + ' →</span><span class="' + sign(b) + ' b">' + fmt(b) + '</span></div>'; }).join('') + '</div>';
        if (ptCh.length) h += '<p class="sec">レートなしの卓（pt）</p><div class="list">' + ptCh.map((m) => { const a = (last.content.pt10NoRate || {})[m] || 0, b = (s.pt10NoRate || {})[m] || 0; return '<div class="li"><span class="b">' + esc(s.name(m)) + '</span><span class="li-v">' + fmtPt(a) + 'pt →</span><span class="' + sign(b) + ' b">' + fmtPt(b) + 'pt</span></div>'; }).join('') + '</div>'; // w2a
      }
      h += errLine + closeArea('今の中身で対局終了し直す');
      if (!partial) h += '<button class="btn btn-line" id="sSnap">終えた時のまま見る</button>';
      el.innerHTML = h; wireSeisanAll(d, settles.length); return;
    }
    if (!viewSnap) {
      h += goBtn;
      if (!partial) {
        if (!s.noRateTables.length) h += '<p class="r-check ok">✓ ' + d.count + '回とも合計0' + (d.used.chip ? '・チップ0' : '') + (d.used.shugi ? '・祝儀0' : '') + (d.used.yaki ? '・やきとり0' : '') + '</p>';
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
          const total10 = b.han + b.chip10 + b.shugi10 + b.yaki10 + (b.tobi10 || 0) + b.cust10; // lib の kei と同じ足し方（E1：飛び賞は半荘の pt に入る・昔の種 tobi の行は0）
          h += head + '<div class="r-card-sub">' + parts.map(esc).join('　') + '</div><div class="r-card-kei">計 ' + (Object.keys(b.kei).length ? keiText(b.kei) : fmtPt(total10) + 'pt') + '</div></div>';
        }
      }
      const nr = Object.entries((viewSnap ? last.content.pt10NoRate : s.pt10NoRate) || {}); // w2a：終えた時のまま見る間は控えの pt
      if (nr.length) h += '<p class="sec">レートなしの卓（pt）</p><div class="list">' + nr.map(([m, x]) => '<div class="li"><span>' + esc(s.name(m)) + '</span><span class="' + sign(x) + ' b">' + fmtPt(x) + 'pt</span></div>').join('') + '</div>';
    }
    if (!viewSnap) h += splitHtml(d.sid, partial);
    if (viewSnap) h += '<button class="btn btn-line" id="sNow">今の数に戻る</button>';
    else if (!last && !room.closed) {
      h += errLine + closeArea('対局終了');
      h += '<p class="r-hint">対局終了すると、次に開いた時は新しい対局になる（この対局の点は消えない）。単位は点（円は出さない）。</p>';
    }
    el.innerHTML = h;
    wireSeisanAll(d, settles.length);
    // A27 §1：部屋の頁の［対局終了］＝この頁の［対局終了］を押したのと同じ（入っていない物があれば確かめ・無ければ締めてホーム）。次の手で、その時の頁の釦を引き直して押す（古い d で配線を続けない）
    if (ask) setTimeout(() => { if (dead || page !== 'seisan') return; const b = el.querySelector('#sClose'); if (b && !b.disabled) b.click(); }, 0);
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
      if (!r.ok) { fixing = { ...fixing, err: r.msg || '入れられませんでした（' + r.err + '）' }; render(); return; }
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
        if (h) { setTable(t); startEntry(h.hanchan_id); return; } // D2：その回の卓を開いてから（卓が何卓でも番号と戻り先が合う）
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
      goHome = !st.needs_upload; // A11：commit の中の送りが早く返る道（canSend 偽など）でも落とせるよう、先に立てる
      const r = commit([{ op: 'settle_snap', session_id: d.sid, rev: revs + 1, content: { ten: s.ten, pt10: s.pt10, pt10NoRate: s.pt10NoRate, pay: s.pay, sig: sessionSig(st, d.sid) }, used, missing: s.missing }]);
      confirming = false;
      closeErr = r.ok ? null : (r.msg || r.err || '?');
      if (!r.ok) goHome = false;
      if (r.ok) viewSnap = false;
      if (homeTry()) return; // 並びに積まずに空のまま（起きない見込み・積んだら done で飛ぶ）
      render();
    };
    if (q('#sClose')) q('#sClose').onclick = () => {
      if (goHome) return;
      if (d.s.missing.length) { confirming = true; closeErr = null; render(); return; } // 1回目は確かめだけ
      doClose();
    };
    if (q('#sClose2')) q('#sClose2').onclick = () => { if (confirming && !goHome) doClose(); };
    if (q('#sBack')) q('#sBack').onclick = goMissing;
    if (q('#sGo')) q('#sGo').onclick = goMissing;
    if (q('#sSnap')) q('#sSnap').onclick = () => { viewSnap = true; render(); };
    if (q('#sNow')) q('#sNow').onclick = () => { viewSnap = false; render(); };
  }

  function plusMinus(mid, kind, add) {
    if (writeBlocked()) return blockRes(); // ★写しに直に保存する前（applyOps より前）で止める★（± は commit を通らない・v3.1 naoshi）
    if (heldAny(outbox)) { pmErr = HELD_GATE; render(); return; } // P6g §4
    const r = applyOps(st, [{ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add, follow: true }], aopts());
    if (!r.ok) { pmErr = r.res && r.res.at === 'member_id' ? 'この人はこの卓の席にいないので、入れられませんでした' : '入れられませんでした'; render(); return; }
    pmErr = null; ruleNote = null; takuNote = null;
    st = r.state; save(KEYR, st);
    const k = table.table_id + '|' + mid + '|' + kind; // D2 止め2：まとめの鍵に卓を入れる（流す時もその卓へ）
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
    for (const [k, add] of merge) { if (!add) continue; const [tid, mid, kind] = k.split('|'); ops.push({ op: 'extra_add', table_id: tid, member_id: mid, kind, add, follow: true }); }
    merge.clear();
    if (!ops.length || st.needs_upload) return; // needs_upload の部屋は写しが元（並びに積まない）
    for (let i = 0; i < ops.length; i += OPS_MAX) outbox.push({ op_id: uuid(), ops: ops.slice(i, i + OPS_MAX) }); // 30個ごとの組
    save(OUTR, outbox);
    if (noSend === true) return;
    sendOutbox(); if (!quiet && page === 'room') render();
  }
  flushNow = () => flushMerge(true);

  function wireRoom() {
    const q = (s) => el.querySelector(s);
    if (q('#rAdd')) q('#rAdd').onclick = () => { if (!writeBlocked()) needTable(() => startEntry(null)); };
    // D2 止め1：リーグの日で L でない人は卓の席を決めない（選んだ人はそのまま点を入れる所へ＝席は hanchan_start の seats だけ）
    for (const b of el.querySelectorAll('[data-seats]')) b.onclick = () => { if (!room.closed) needTable(() => { picking = pickOf({ seats: preSeats() || [], only: !nonL(table) }); page = 'pick'; render(); }); };
    for (const b of el.querySelectorAll('[data-tk]')) b.onclick = () => pickTaku(b.dataset.tk);
    if (q('#rTakuAdd')) q('#rTakuAdd').onclick = () => { if (writeBlocked()) return; const d = dayOf(table.session_id); if (d && d.rules_alt) { takuPick = !takuPick; render(); return; } addTaku(false); };
    if (q('#rTakuMain')) q('#rTakuMain').onclick = () => addTaku(false);
    if (q('#rTakuAlt')) q('#rTakuAlt').onclick = () => addTaku(true);
    if (q('#rSeisan')) q('#rSeisan').onclick = () => { page = 'seisan'; viewSnap = false; confirming = false; closeErr = null; render(); };
    if (q('#rEnd')) q('#rEnd').onclick = () => { if (closingOn() || goHome) return; page = 'seisan'; viewSnap = false; confirming = false; closeErr = null; endAsk = true; render(); };
    for (const b of el.querySelectorAll('.r-no')) b.onclick = () => { if (!room.closed) startEntry(b.dataset.h); };
    for (const b of el.querySelectorAll('.r-pm')) b.onclick = () => plusMinus(b.dataset.m, b.dataset.k, Number(b.dataset.a));
  }
  function wirePick() {
    const q = (s) => el.querySelector(s);
    const inp = q('#pNew');
    inp.addEventListener('input', drawCand);
    inp.addEventListener('compositionend', drawCand);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { const b = q('[data-new]') || q('#pSame'); if (b) b.click(); } });
    if (q('#pMeGo')) q('#pMeGo').onclick = () => { meMsg = null; page = 'me'; render(); };
    mbWire();
    for (const b of q('#pBase').querySelectorAll('[data-pick]')) b.onclick = () => { if (seat(b.dataset.pick)) renderPick(); };
    for (const b of q('#pBase').querySelectorAll('[data-hist]')) b.onclick = () => { const r = addMember(b.dataset.hist); pickDone(r.mid || r.dup); };
    q('#pGo').onclick = () => {
      const seats = picking.seats.slice(), only = picking.only, t = tOf(picking.tid);
      if (!t) { el.querySelector('#pErr').textContent = 'この卓は無くなりました。戻って卓を選んでください。'; return; }
      if (t.rules.players !== picking.n) { picking.tid = t.table_id; picking.n = t.rules.players; picking.reN = true; if (!picking.carry) picking.carry = {}; if (!picking.tobiM) picking.tobiM = []; renderPick(); return; } // A20 §1-2：選んでいる間に人数が替わった
      const ch = tableChain(st, t.table_id);
      // 取り消していない半荘が0本の卓だけ、卓の席を倉庫へ（op table_seats・only でも同じ）。半荘が在る時は送らない（entry.seats＝半荘の席）
      // A20 §4：鎖に回が在っても、鎖の最後の卓に自分の回が無く席が違えば送る（3→4 で4人目のチップ・lib と倉庫は通す）
      // D2 §3 止め1：リーグの日で L でない人は送らない（table_seats は L だけ＝送ると held）
      const none = (ids) => !st.hanchans.some((h) => ids.includes(h.table_id) && !h.voided);
      if (!nonL(t) && (none(ch) || (none([t.table_id]) && cn(t.seats || []) !== cn(seats)))) {
        const r = commit([{ op: 'table_seats', table_id: t.table_id, seats }]);
        if (!r.ok) { el.querySelector('#pErr').textContent = r.msg || '卓の席を残せませんでした。もう一度押してください。'; return; }
      }
      const carry = picking.carry || {}, tobiM = picking.tobiM || [];
      picking = null;
      if (only) { toRoom(); return; }
      const tSeats = lgDay(t) && isL() && cn(t.seats || []) !== cn(seats); // L A23：L の［人を替える］は保存の時に table_seats も（L でない人はその半荘だけ）
      entry = { tSeats, seats, tid: t.table_id, no: chainView(st, t.table_id).nextNo, R: t.rules, cells: seats.map((m) => (Object.prototype.hasOwnProperty.call(carry, m) ? carry[m] : '')), lost: '0', marks: [], tobiR: seats.map((m, i) => (tobiM.includes(m) ? i : -1)).filter((i) => i >= 0), carry }; // A20 §3：点は人ごとに戻す（外した人の点は carry に残る＝送らない）・E1：［飛び賞］の印（1200 と同じ形・無いと描く所の e.tobiR.includes で落ちる＝CI 45891321404 d2 B4）
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
    const nm = box.querySelector('[data-newme]');
    if (nm) nm.onclick = () => meNew(q('#pNew').value.trim());
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
    // 数字鍵盤（A17＝kenban.mjs の wireKeypad）：箱に入った時の最初の数の鍵は中身を置き換える（勧めた残りも打ち直せる）・入ってすぐ − 1 0 は −10
    if (q('#eKp')) wireKeypad(el, { boxes: () => [...el.querySelectorAll('[data-c]'), ...(q('#eLost') ? [q('#eLost')] : [])], spec: () => KP_SPEC, onChange: liveUpdate });
    if (q('#ePeople')) q('#ePeople').onclick = () => { readCells(); if (!tOf(entry.tid)) return; reNPick(); picking.reN = false; render(); }; // A20 §3：人を替えても打った点は人ごとに残す
    if (q('#eVoid')) q('#eVoid').onclick = () => { const r = commit([{ op: entry.voided ? 'hanchan_unvoid' : 'hanchan_void', hanchan_id: entry.hanchan_id }]); if (r && r.msg) { el.querySelector('#eErr').textContent = r.msg; return; } toRoom(); }; // P6g §4：門で止めたら部屋へ戻らず字
    // E1［飛び賞］：押せばもらう印・もう1回で外す（何人でも）。鍵盤は閉じない（［上家］と同じ）
    for (const b of el.querySelectorAll('[data-tobi]')) {
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.onclick = () => {
        readCells();
        const i = Number(b.dataset.tobi);
        entry.tobiR = entry.tobiR.includes(i) ? entry.tobiR.filter((x) => x !== i) : [...entry.tobiR, i];
        b.setAttribute('aria-pressed', String(entry.tobiR.includes(i)));
      };
    }
    // A13［上家］：押せば印・もう1回で外す。鍵盤が開いていても箱から focus を外さない（鍵盤を閉じない＝頁がずれず押した手が逃げない）
    for (const b of el.querySelectorAll('[data-kam]')) {
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.onclick = () => {
        readCells();
        entry.marks = tapMark(eRules().R, entry.cells.map(toInt), entry.marks, Number(b.dataset.kam)); // 2人の同点は相手の印を外す（ラジオ）
        const er = q('#eErr'); if (er) er.textContent = '';
        liveUpdate();
      };
    }
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
  // D2 §3：リーグの対局は開いた時に日を決める（L＝開いている日か今日で session_add・L でない入＝開いている日を読むだけ）
  if (LG && !table && !room.closed && !stopped) needTable(() => render());
}
