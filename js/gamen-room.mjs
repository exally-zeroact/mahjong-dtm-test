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
 * ★倉庫の mj_read／mj_write が来るまでは端末の中だけ★＝WRITE_READY を true にした日から送るだけ（op の形は同じ）。
 */
import { emptyState, applyOps, tableView, sessionSeisan, sessionBreakdown, tenChanged, tableRate, rateModeOf, checkEntry, pickSession, sessionSig, migrateState, roomGate, gateText, orderIdx, canon, OPS_MAX, CELL_MAX, LOST_MAX } from '../lib/room-state.mjs';
import { heldInfo } from '../lib/outbox.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';
import { nameKey } from '../lib/name-key.mjs';
import { esc, uuid } from './gamen-core.mjs';
import { mountRules } from './gamen-rules.mjs';

const WRITE_READY = false; // 倉庫の mj_write が入った日に true（送る所は sendOutbox だけ）
const KEY = (uid, rid) => 'mj-room:' + uid + ':' + rid;
const OUT = (uid, rid) => 'mj-outbox:' + uid + ':' + rid;
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

export function mountRoom(el, { me, room, showShare, bar, page: first }) {
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
  async function sendOutbox() {
    if (!WRITE_READY) return; // 倉庫の mj_write が来たら：先頭から順に送る・同じ op_id で送り直す・conflict は上に出す
  }

  function ensureTable() {
    const sid0 = pickSession(st); // 区切りは［対局終了］を押した時だけ（時間・日付で決めない・司さん 11-20）
    const t0 = sid0 && st.tables.find((t) => t.session_id === sid0);
    if (t0) return t0;
    const sid = uuid(), tid = uuid();
    commit([
      { op: 'session_add', session_id: sid, date: today(), rate: room.rules.rate },
      { op: 'table_add', table_id: tid, session_id: sid, label: '卓1' },
    ]);
    return st.tables.find((t) => t.table_id === tid);
  }
  const table = ensureTable();
  const R = table.rules, n = R.players;
  const nameOf = (mid) => (st.members.find((m) => m.member_id === mid) || {}).name || '?';
  const rateText = (rate) => (rate === null ? 'レートなし' : '1pt＝' + rate.toLocaleString('ja-JP'));
  const liveTag = () => {
    if (st.needs_upload) return '<span class="r-live ng">● この端末だけ（まだ送っていない）</span>';
    if (heldInfo(outbox)) return '<span class="r-live ng">● 未送信 ' + outbox.length + '・止まっています</span>';
    return outbox.length ? '<span class="r-live ng">● 未送信 ' + outbox.length + '</span>' : '';
  };

  function render() {
    if (page === 'edit') return renderEdit();
    if (page === 'pick') return renderPick();
    if (page === 'seisan') return renderSeisan();
    if (page === 'rules') return renderRules();
    // ［点数］＝点数計算（記録しない道具・tensu.html）へ。卓のルールを ?r= に、戻り先を ?from= に渡す（tensu.js の頭の取り決め）
    const ten = '/tensu.html?r=' + encodeURIComponent(JSON.stringify(room.rules)) + '&from=' + encodeURIComponent(location.pathname + location.search);
    bar({ back: 'ホーム', title: '対局', right: 'ルール', onRight: () => { page = 'rules'; render(); }, ten });
    const v = tableView(st, table.table_id);
    let h = '<div class="r-top"><span>' + esc(md(v.date)) + '・' + rateText(v.rate) + '</span>' + liveTag() + '</div>';
    h += v.rows.length ? renderTable(v) : renderHead(preSeats());
    h += '<button class="btn btn-main r-add" id="rAdd">' + v.nextNo + '回目の点を入れる</button>';
    // B1：席だけの卓（行がまだ無い）も窓と ± を出す＝並べは seatWin（画面だけ）。✓ と［精算を見る］は今まで通り windows が在る時だけ
    if (v.windows.length || v.seatPeople.length) h += renderWindows(v);
    if (v.windows.length) h += renderCheck(v) + (pmErr ? '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>' : '') + '<button class="btn btn-line" id="rSeisan">精算を見る（誰が誰に）</button>';
    else if (pmErr) h += '<p class="r-check bad" id="rPmErr">' + esc(pmErr) + '</p>';
    el.innerHTML = h;
    const wrap = el.querySelector('.r-hyou-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    wireRoom();
  }

  // 0回目（行が0）の表の頭＝卓の人が在れば名前の列・無ければ［＋名前］×n。押すと人を選ぶ（決めるだけ・点の画面へは行かない）
  function renderHead(ps) {
    const cells = ps ? ps.map((m) => '<th><button type="button" class="r-nm" data-seats="1" aria-label="' + esc(nameOf(m)) + '・人を選び直す">' + esc(nameOf(m)) + '</button></th>')
      : Array.from({ length: n }, () => '<th><button type="button" class="r-nm r-nm-add" data-seats="1">＋名前</button></th>');
    return '<div class="r-hyou-wrap"><table class="r-hyou"><thead><tr><th></th>' + cells.join('') + '</tr></thead></table></div>';
  }
  // 卓の席（倉庫の t.seats＝tableView の seatPeople）。長さ n・全員 active の時だけ使う
  function preSeats() {
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
    el.innerHTML = '<div id="rRules"></div>' + (showShare ? '<button class="btn btn-line" id="rShare">部屋名と URL</button>' : '');
    mountRules(el.querySelector('#rRules'), { rules: { ...R, rate: tableView(st, table.table_id).rate }, readOnly: true });
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
      entry = { hanchan_id: hid, no: x.no, seats: x.seats.slice(), cells: x.cells.map((v) => boxNum(Number(v))), lost: String(x.lost || 0), step: 'cells', order: orderIdx(x) || [], voided: x.voided };
    } else {
      const seats = lastSeats() || preSeats(); // 半荘が在れば前の席・無ければ前もって決めた卓の人
      if (!seats) { picking = { seats: [] }; page = 'pick'; render(); return; }
      entry = { seats, no: tableView(st, table.table_id).nextNo, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [] };
    }
    page = 'edit'; render();
  }
  const kieru = R.kyotaku_end === 'kieru';
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
      const h = st.hanchans.find((x) => x.hanchan_id === e.hanchan_id);
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
    const top = '<div class="r-top"><span>' + (d.date ? esc(md(d.date)) + '・' : '') + ratesText(d.rates) + '・半荘' + d.count + '回</span>' + liveTag() + '</div>';
    if (!s.ok) { el.innerHTML = top + '<div class="r-red"><b>' + (s.err === 'voided' ? 'この対局は取り消されています（精算は出しません）' : '精算を出せません（' + esc(s.err) + '）') + '</b></div>'; return; }
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
      el.innerHTML = h; wireSeisan(d, settles.length); return;
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
    wireSeisan(d, settles.length);
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
  function flushMerge(quiet) {
    clearTimeout(mergeTimer);
    const ops = [];
    for (const [k, add] of merge) { if (!add) continue; const [mid, kind] = k.split('|'); ops.push({ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add }); }
    merge.clear();
    if (!ops.length || st.needs_upload) return; // needs_upload の部屋は写しが元（並びに積まない）
    for (let i = 0; i < ops.length; i += OPS_MAX) outbox.push({ op_id: uuid(), ops: ops.slice(i, i + OPS_MAX) }); // 30個ごとの組
    save(OUT(uid, rid), outbox);
    sendOutbox(); if (!quiet && page === 'room') render();
  }
  flushNow = () => flushMerge(true);

  function wireRoom() {
    const q = (s) => el.querySelector(s);
    q('#rAdd').onclick = () => startEntry(null);
    for (const b of el.querySelectorAll('[data-seats]')) b.onclick = () => { picking = { seats: preSeats() || [], only: true }; page = 'pick'; render(); };
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
  render();
}
