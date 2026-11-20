/* gamen-room.mjs — ★対局の1ページ★（設計図 v18.3 §2 の絵 mahjong_nyuryoku3_v12・名前の入れ方 mahjong_namae_v155）
 * =============================================================================
 * mountRoom(el, { me, room, showShare })
 *   上から：開催日・1pt＝N → 半荘の表（行を押すと直す）→［＋ n回目の点を入れる］→ 人ごとの窓（2×2）
 *          → ✓ チップの合計0・祝儀の合計0・合計0 →［精算を見る（誰が誰に）］
 * 状態は lib/room-state.mjs（端末の写し）。押した事は mj_write の op の組にして未送信の並びに積む。
 * ★倉庫の mj_read／mj_write が来るまでは端末の中だけ★＝WRITE_READY を true にした日から送るだけ（op の形は同じ）。
 * 窓の説明の字は置かない（司さん 11-20 の直4つ目）。合わない訳は窓の下の1行にだけ出す。
 */
import { emptyState, applyOps, tableView, sessionSeisan, checkEntry } from '../lib/room-state.mjs';
import { nameKey } from '../lib/name-key.mjs';
import { esc, uuid } from './gamen-core.mjs';

const WRITE_READY = false; // 倉庫の mj_write が入った日に true（送る所は sendOutbox だけ）
const KEY = (uid, rid) => 'mj-room:' + uid + ':' + rid;
const OUT = (uid, rid) => 'mj-outbox:' + uid + ':' + rid;
const NAMES = (uid) => 'mj-names:' + uid;

const fmt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP');
const fmtPt = (pt10) => (pt10 > 0 ? '+' : pt10 < 0 ? '−' : '') + (Math.abs(pt10) / 10).toFixed(1);
const sign = (n) => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const toInt = (s) => { const t = String(s).replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^[−ー－]/, '-'); return /^-?\d+$/.test(t) ? Number(t) : NaN; };

function load(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? def : v; } catch { return def; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

export function mountRoom(el, { me, room, showShare }) {
  const uid = me.id, rid = room.room_id;
  let st = load(KEY(uid, rid), emptyState());
  let outbox = load(OUT(uid, rid), []);
  let entry = null; // 点を入れる途中 { hanchan_id?, seats:[], cells:[], step, order:[], tobi:{} }
  let picking = null; // 人を選ぶ途中 { seats:[], typed:'', dup:null }
  let showSeisan = false;
  const merge = new Map(); let mergeTimer = null; // extra_add の1秒まとめ

  if (!room.rules) {
    el.innerHTML = '<p class="setsumei">この部屋のルールはまだこの端末に届いていません（倉庫の読み口ができたら出ます）。</p>' +
      '<button class="btn" id="rShare">部屋番号と URL</button>';
    el.querySelector('#rShare').onclick = showShare;
    return;
  }

  /* 押した事を1つの組にして当てる（弾かれたら組ごと当てない） */
  function commit(ops) {
    const r = applyOps(st, ops);
    if (!r.ok) return r.res;
    st = r.state;
    save(KEY(uid, rid), st);
    outbox.push({ op_id: uuid(), ops });
    save(OUT(uid, rid), outbox);
    sendOutbox();
    return { ok: true };
  }
  async function sendOutbox() {
    if (!WRITE_READY) return; // 倉庫の mj_write が来たら：先頭から順に送る・同じ op_id で送り直す・conflict は上に出す
  }

  /* 開催日と卓（今日の物が無ければ作る） */
  function ensureTable() {
    let s = st.sessions.find((x) => x.date === today());
    if (s) return st.tables.find((t) => t.session_id === s.session_id);
    const sid = uuid(), tid = uuid();
    commit([
      { op: 'session_add', session_id: sid, date: today(), rate: room.rules.rate },
      { op: 'table_add', table_id: tid, session_id: sid, rules: room.rules },
    ]);
    return st.tables.find((t) => t.table_id === tid);
  }
  const table = ensureTable();
  const n = table.rules.players;

  /* ── 描く ── */
  function render() {
    const v = tableView(st, table.table_id);
    let h = '';
    h += '<div class="r-top"><span>' + esc(v.date.slice(5).replace('-', '/')) + '・' + (v.rate === null ? 'レートなし' : '1pt＝' + v.rate.toLocaleString('ja-JP')) + '</span>' +
      (outbox.length ? '<span class="r-unsent">未送信 ' + outbox.length + '</span>' : '') +
      '<button class="btn-s" id="rShare">部屋番号と URL</button></div>';
    if (picking) h += renderPick();
    else if (entry) h += renderEntry(v);
    else {
      h += renderTable(v);
      h += '<button class="btn btn-main r-add" id="rAdd">＋ ' + v.nextNo + '回目の点を入れる</button>';
      if (v.windows.length) h += renderWindows(v) + renderCheck(v);
      if (v.windows.length) h += '<button class="btn" id="rSeisan">精算を見る（誰が誰に）</button>';
      if (showSeisan) h += renderSeisan();
    }
    el.innerHTML = h;
    wire(v);
  }

  function renderTable(v) {
    if (!v.rows.length) return '<p class="setsumei">まだ半荘がありません。終わったら点を入れてください。</p>';
    const ppl = v.people;
    let h = '<div class="r-hyou-wrap"><table class="r-hyou"><thead><tr><th></th>' + ppl.map((p) => '<th>' + esc(p.name) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of v.rows) {
      h += '<tr class="r-row' + (r.voided ? ' r-void' : '') + '" data-h="' + esc(r.hanchan_id) + '"><th>' + r.no + '回</th>';
      for (const p of ppl) {
        const c = r.by[p.member_id];
        if (!c) { h += '<td class="r-na">—</td>'; continue; }
        const big = r.ok && c.pt10 !== null ? '<b class="' + sign(c.pt10) + '">' + fmtPt(c.pt10) + '</b>' : '<b class="zero">—</b>';
        const small = (c.rank !== null ? (c.rank + 1) + '位 ' : '') + c.cell.toLocaleString('ja-JP');
        h += '<td>' + big + '<small>' + small + '</small></td>';
      }
      h += '</tr>';
      if (!r.ok && !r.voided) h += '<tr class="r-why"><td colspan="' + (ppl.length + 1) + '">' + esc(whyText(r)) + '</td></tr>';
    }
    h += '</tbody><tfoot><tr><th>計</th>' + ppl.map((p) => '<td><b class="' + sign(v.total10[p.member_id]) + '">' + fmtPt(v.total10[p.member_id]) + '</b></td>').join('') + '</tr></tfoot></table></div>';
    return h;
  }
  function whyText(r) {
    if (r.why === 'sum') return r.no + '回目：合計が ' + fmt(r.diff) + ' 合いません（計に入れていません）';
    if (r.why === 'order') return r.no + '回目：同じ点の人がいます。起家から順を入れてください（行を押す）';
    if (r.why === 'tobi') return r.no + '回目：飛び賞を受け取る人を選んでください（行を押す）';
    return r.no + '回目：入れ直してください（' + r.why + '）';
  }

  function renderWindows(v) {
    let h = '<div class="r-mado">';
    for (const w of v.windows) {
      const unit = w.unit === 'pt' ? 'pt' : '';
      const big = w.unit === 'pt' ? fmtPt(w.big) : fmt(w.big);
      h += '<div class="r-w"><div class="r-w-name">' + esc(w.name) + '</div>' +
        '<div class="r-w-big ' + sign(w.big) + (w.dim ? ' dim' : '') + '">' + big + unit + (w.dim ? '<span class="r-bang" aria-label="チップか祝儀の合計が合いません">!</span>' : '') + '</div>';
      for (const kind of ['chip', 'shugi']) {
        if (!v.used[kind]) continue;
        const cnt = w[kind], val = kind === 'chip' ? w.chipBig : w.shugiBig;
        h += '<div class="r-w-row"><span class="r-w-k">' + (kind === 'chip' ? 'チップ' : '祝儀') + '</span>' +
          '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="-1" aria-label="減らす">−</button>' +
          '<span class="r-cnt">' + (cnt > 0 ? '+' : '') + cnt + '</span>' +
          '<button class="r-pm" data-m="' + esc(w.member_id) + '" data-k="' + kind + '" data-a="1" aria-label="増やす">＋</button>' +
          '<span class="r-w-val ' + sign(val) + '">' + (w.unit === 'pt' ? fmtPt(val) : fmt(val)) + '</span></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }
  function renderCheck(v) {
    const parts = [];
    if (v.used.chip) parts.push(v.chipSum === 0 ? null : 'チップの合計が ' + (v.chipSum > 0 ? '+' : '') + v.chipSum + ' 合いません');
    if (v.used.shugi) parts.push(v.shugiSum === 0 ? null : '祝儀の合計が ' + (v.shugiSum > 0 ? '+' : '') + v.shugiSum + ' 合いません');
    const bad = parts.filter(Boolean);
    if (bad.length) return '<p class="r-check bad">' + esc(bad.join('・')) + '・窓の数に入れていません</p>';
    const okParts = [];
    if (v.used.chip) okParts.push('チップの合計0');
    if (v.used.shugi) okParts.push('祝儀の合計0');
    okParts.push('合計0');
    return '<p class="r-check ok">✓ ' + okParts.join('・') + '</p>';
  }
  function renderSeisan() {
    const s = sessionSeisan(st, table.session_id);
    if (!s.ok) return '<div class="r-seisan"><p class="r-check bad">精算を出せません（' + esc(s.err) + '）</p></div>';
    let h = '<div class="r-seisan"><h3 class="komidashi">精算</h3>';
    if (s.missing.length) h += '<p class="r-check bad">入っていない物 ' + s.missing.length + ' 件（' + esc(s.missing.map((m) => m.no ? m.no + '回目' : (m.what === 'chip' ? 'チップ' : '祝儀') + 'の合計 ' + (m.diff > 0 ? '+' : '') + m.diff).join('／')) + '）</p>';
    if (s.noRateTables.length) h += '<p class="r-check bad">レートなしの卓は点に入れていません</p>';
    const ten = Object.entries(s.ten).sort((a, b) => b[1] - a[1]);
    if (ten.length) h += '<dl class="made">' + ten.map(([m, x]) => '<dt>' + esc(s.name(m)) + '</dt><dd class="' + sign(x) + '">' + fmt(x) + ' 点</dd>').join('') + '</dl>';
    if (s.pay.length) h += '<ul class="r-pay">' + s.pay.map((x) => '<li>' + esc(s.name(x.from)) + ' → ' + esc(s.name(x.to)) + '　<b>' + x.ten.toLocaleString('ja-JP') + ' 点</b></li>').join('') + '</ul>';
    else if (ten.length) h += '<p class="setsumei">払う人はいません。</p>';
    const nr = Object.entries(s.pt10NoRate).sort((a, b) => b[1] - a[1]);
    if (nr.length) h += '<dl class="made">' + nr.map(([m, x]) => '<dt>' + esc(s.name(m)) + '</dt><dd class="' + sign(x) + '">' + fmtPt(x) + ' pt</dd>').join('') + '</dl>';
    return h + '</div>';
  }

  /* ── 人を選ぶ（名簿・この端末で前に使った名前・新しい人） ── */
  function renderPick() {
    const p = picking;
    const active = st.members.filter((m) => m.active);
    const hist = load(NAMES(uid), []).filter((nm) => !st.members.some((m) => m.name_key === nameKey(nm)));
    let h = '<h2 class="komidashi">人を選ぶ</h2>';
    h += '<p class="setsumei">この部屋の人（名簿）・この半荘の' + n + '人を押す　' + p.seats.length + '／' + n + '</p>';
    h += '<div class="chips">' + active.map((m) => '<button data-pick="' + esc(m.member_id) + '" aria-pressed="' + (p.seats.includes(m.member_id)) + '">' + esc(m.name) + '</button>').join('') + '</div>';
    if (hist.length) h += '<p class="setsumei">この端末で前に使った名前（ほかの部屋）</p><div class="chips">' + hist.map((nm) => '<button data-hist="' + esc(nm) + '">' + esc(nm) + '</button>').join('') + '</div>';
    h += '<label class="field"><span>新しい人</span><input id="pNew" maxlength="20" autocomplete="off" value="' + esc(p.typed) + '"></label>';
    const key = nameKey(p.typed);
    if (p.typed.trim()) {
      const cand = active.filter((m) => m.name_key.startsWith(key) && m.name_key !== key);
      if (cand.length) h += '<div class="chips">' + cand.map((m) => '<button data-pick="' + esc(m.member_id) + '">' + esc(m.name) + '</button>').join('') + '</div>';
    }
    if (p.dup) {
      h += '<div class="obi obi-warn">' + esc(p.dup.name) + 'さんはもう名簿にいます。同じ人ですか？</div>' +
        '<button class="btn btn-main" id="pSame">同じ人（名簿の' + esc(p.dup.name) + 'を入れる）</button>' +
        '<button class="btn" id="pOther">別の人（名前を変えて足す 例：' + esc(p.dup.name) + '2）</button>';
    } else h += '<button class="btn" id="pAdd">この名前を足す</button>';
    h += '<p class="err" id="pErr"></p>';
    h += '<button class="btn btn-main" id="pGo"' + (p.seats.length === n ? '' : ' disabled') + '>この' + n + '人で始める</button>';
    h += '<button class="btn btn-sub" id="pCancel">やめる</button>';
    return h;
  }
  function rememberName(nm) {
    const a = load(NAMES(uid), []).filter((x) => nameKey(x) !== nameKey(nm));
    a.unshift(nm); save(NAMES(uid), a.slice(0, 30));
  }
  function addMember(nm) {
    const r = commit([{ op: 'member_add', member_id: uuid(), name: nm }]);
    if (!r.ok && r.err === 'dup') { picking.dup = { member_id: r.member_id, name: r.name }; return null; }
    if (!r.ok) { picking.err = '名前を1〜20字で入れてください。'; return null; }
    rememberName(nm);
    return st.members[st.members.length - 1].member_id;
  }
  function togglePick(mid) {
    const s = picking.seats;
    if (s.includes(mid)) s.splice(s.indexOf(mid), 1);
    else if (s.length < n) s.push(mid);
  }

  /* ── 点を入れる（素点→同点なら起家からの順→飛んだ人の受け取り） ── */
  function lastSeats() {
    const hs = st.hanchans.filter((x) => x.table_id === table.table_id && !x.voided);
    return hs.length ? hs[hs.length - 1].seats.slice() : null;
  }
  function startEntry(hid) {
    if (hid) {
      const x = st.hanchans.find((y) => y.hanchan_id === hid);
      entry = { hanchan_id: hid, seats: x.seats.slice(), cells: x.cells.map(String), lost: String(x.lost || 0), step: 'cells', order: x.order ? x.order.slice() : [], tobi: { ...x.tobi_to }, voided: x.voided, filled: false };
    } else {
      const seats = lastSeats();
      if (!seats) { picking = { seats: [], typed: '', dup: null }; render(); return; }
      entry = { seats, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [], tobi: {}, filled: false };
    }
    render();
  }
  const nameOf = (mid) => (st.members.find((m) => m.member_id === mid) || {}).name || '?';
  function renderEntry(v) {
    const e = entry;
    let h = '<h2 class="komidashi">' + (e.hanchan_id ? (st.hanchans.find((x) => x.hanchan_id === e.hanchan_id).no + '回目を直す') : v.nextNo + '回目の点') + '</h2>';
    if (e.step === 'cells') {
      h += '<div class="r-nyu">' + e.seats.map((m, i) => '<label class="field"><span>' + esc(nameOf(m)) + '</span><input inputmode="numeric" data-c="' + i + '" value="' + esc(e.cells[i]) + '" placeholder="点"></label>').join('') + '</div>';
      h += '<label class="field"><span>消えた供託（終局に残って消えた点）</span><input inputmode="numeric" id="eLost" value="' + esc(e.lost) + '"></label>';
      h += '<div class="btn-line"><button class="btn-s" id="eFill">残りを計算</button>' + (e.hanchan_id ? '' : '<button class="btn-s" id="ePeople">人を替える</button>') + '</div>';
      if (e.filled) h += '<p class="setsumei">残りを計算で埋めた人は、合計の見張りが効きません。打った数を確かめてください。</p>';
    } else if (e.step === 'order') {
      h += '<p class="setsumei">同じ点の人がいます。起家から順に押してください（' + e.order.length + '／' + n + '）</p>';
      h += '<div class="chips">' + e.seats.map((m, i) => '<button data-ord="' + i + '" aria-pressed="' + e.order.includes(i) + '">' + (e.order.includes(i) ? (e.order.indexOf(i) + 1) + '. ' : '') + esc(nameOf(m)) + '</button>').join('') + '</div>';
      h += '<button class="btn-s" id="eOrdReset">押し直す</button>';
    } else if (e.step === 'tobi') {
      const busted = e.busted.filter((b) => e.tobi[b] === undefined);
      const b = busted[0];
      h += '<p class="setsumei">' + esc(nameOf(e.seats[b])) + 'さんが飛びました。飛び賞を受け取る人は？</p>';
      h += '<div class="chips">' + e.seats.map((m, i) => (i === b ? '' : '<button data-tobi="' + i + '" data-b="' + b + '">' + esc(nameOf(m)) + '</button>')).join('') + '<button data-tobi="all" data-b="' + b + '">全員から</button></div>';
    }
    h += '<p class="err" id="eErr"></p>';
    h += '<button class="btn btn-main" id="eOk">' + (e.step === 'cells' ? '入れる' : '次へ') + '</button>';
    if (e.hanchan_id) h += '<button class="btn" id="eVoid">' + (e.voided ? 'この半荘を戻す' : 'この半荘を取り消す') + '</button>';
    h += '<button class="btn btn-sub" id="eCancel">やめる</button>';
    return h;
  }
  function readCells() {
    for (const inp of el.querySelectorAll('[data-c]')) entry.cells[Number(inp.dataset.c)] = inp.value;
    const lost = el.querySelector('#eLost'); if (lost) entry.lost = lost.value;
  }
  function entryNext() {
    const e = entry, R = table.rules;
    const err = (t) => { el.querySelector('#eErr').textContent = t; };
    if (e.step === 'cells') {
      readCells();
      const cells = e.cells.map(toInt);
      if (cells.some((x) => Number.isNaN(x))) return err('全員の点を数で入れてください。');
      if (cells.some((x) => x % 100 !== 0)) return err('点は100点単位で入れてください。');
      const lost = toInt(e.lost || '0');
      if (Number.isNaN(lost) || lost < 0 || lost % 100 !== 0) return err('消えた供託は0以上の100点単位です。');
      const c = checkEntry(R, cells, lost);
      if (!c.ok && c.why === 'sum') return err('合計が ' + fmt(c.diff) + ' 合いません（' + (R.start_pts * n - lost).toLocaleString('ja-JP') + ' になるはず）。');
      if (!c.ok) return err('入れられません（' + c.why + '）。');
      e.num = cells; e.lostNum = lost;
      e.busted = R.tobi_from === 'all' ? [] : c.busted;
      if (!c.needOrder) e.order = [];
      for (const k of Object.keys(e.tobi)) if (!e.busted.includes(Number(k))) delete e.tobi[k];
      if (c.needOrder && e.order.length !== n) { e.order = []; e.step = 'order'; render(); return; }
      if (e.busted.some((b) => e.tobi[b] === undefined)) { e.step = 'tobi'; render(); return; }
      return save1();
    }
    if (e.step === 'order') {
      if (e.order.length !== n) return err('全員を押してください。');
      if (e.busted.some((b) => e.tobi[b] === undefined)) { e.step = 'tobi'; render(); return; }
      return save1();
    }
    if (e.step === 'tobi') { if (e.busted.some((x) => e.tobi[x] === undefined)) return err('受け取る人を選んでください。'); return save1(); }
  }
  function save1() {
    const e = entry;
    let ops;
    if (!e.hanchan_id) {
      const tobi_to = {};
      for (const b of e.busted) tobi_to[b] = e.tobi[b];
      ops = [{ op: 'hanchan_start', hanchan_id: uuid(), table_id: table.table_id, seats: e.seats, cells: e.num, order: e.order.length ? e.order : undefined, lost: e.lostNum, tobi_to }];
    } else {
      const h = st.hanchans.find((x) => x.hanchan_id === e.hanchan_id);
      ops = [];
      e.num.forEach((v, i) => { if (v !== h.cells[i]) ops.push({ op: 'cell_set', hanchan_id: h.hanchan_id, seat: i, value: v, base_version: h.cell_ver[i] }); });
      if (e.lostNum !== h.lost) ops.push({ op: 'kyotaku_set', hanchan_id: h.hanchan_id, value: e.lostNum, base_version: h.lost_ver });
      if (e.order.length && JSON.stringify(e.order) !== JSON.stringify(h.order)) ops.push({ op: 'hanchan_order', hanchan_id: h.hanchan_id, order: e.order, base_version: h.order_ver });
      for (const b of e.busted) if (e.tobi[b] !== h.tobi_to[b]) ops.push({ op: 'tobi_set', hanchan_id: h.hanchan_id, seat: b, to: e.tobi[b], base_version: h.tobi_ver[b] || 0 });
      for (const k of Object.keys(h.tobi_to)) if (!e.busted.includes(Number(k))) ops.push({ op: 'tobi_set', hanchan_id: h.hanchan_id, seat: Number(k), to: null, base_version: h.tobi_ver[k] || 0 });
    }
    if (ops.length) {
      const r = commit(ops);
      if (!r.ok) { el.querySelector('#eErr').textContent = '入れられません（' + r.err + (r.at ? '・' + JSON.stringify(r.at) : '') + '）。'; return; }
    }
    entry = null; render();
  }

  /* ── チップ・祝儀の ±（端末にはすぐ当て、送るのは1秒まとめた1本） ── */
  function plusMinus(mid, kind, add) {
    const r = applyOps(st, [{ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add }]);
    if (!r.ok) return;
    st = r.state; save(KEY(uid, rid), st);
    const k = mid + '|' + kind;
    merge.set(k, (merge.get(k) || 0) + add);
    clearTimeout(mergeTimer);
    mergeTimer = setTimeout(flushMerge, 1000);
    render();
  }
  function flushMerge() {
    const ops = [];
    for (const [k, add] of merge) { if (!add) continue; const [mid, kind] = k.split('|'); ops.push({ op: 'extra_add', table_id: table.table_id, member_id: mid, kind, add }); }
    merge.clear();
    if (!ops.length) return;
    outbox.push({ op_id: uuid(), ops }); save(OUT(uid, rid), outbox);
    sendOutbox(); render();
  }

  /* ── つなぐ ── */
  function wire() {
    const q = (s) => el.querySelector(s);
    const on = (s, f) => { const x = q(s); if (x) x.onclick = f; };
    on('#rShare', showShare);
    on('#rAdd', () => startEntry(null));
    on('#rSeisan', () => { showSeisan = !showSeisan; render(); });
    for (const tr of el.querySelectorAll('.r-row')) tr.onclick = () => startEntry(tr.dataset.h);
    for (const b of el.querySelectorAll('.r-pm')) b.onclick = () => plusMinus(b.dataset.m, b.dataset.k, Number(b.dataset.a));
    if (picking) {
      const inp = q('#pNew');
      inp.oninput = () => { picking.typed = inp.value; picking.dup = null; const pos = inp.selectionStart; render(); const ni = q('#pNew'); ni.focus(); ni.setSelectionRange(pos, pos); };
      for (const b of el.querySelectorAll('[data-pick]')) b.onclick = () => { togglePick(b.dataset.pick); picking.typed = ''; picking.dup = null; render(); };
      for (const b of el.querySelectorAll('[data-hist]')) b.onclick = () => { const mid = addMember(b.dataset.hist); if (mid) togglePick(mid); render(); };
      on('#pAdd', () => { const nm = picking.typed.trim(); if (!nm) return; const mid = addMember(nm); if (mid) { togglePick(mid); picking.typed = ''; } render(); if (picking.err) { q('#pErr').textContent = picking.err; picking.err = null; } });
      on('#pSame', () => { togglePick(picking.dup.member_id); picking.dup = null; picking.typed = ''; render(); });
      on('#pOther', () => { picking.typed = picking.dup.name + '2'; picking.dup = null; render(); });
      on('#pGo', () => { const seats = picking.seats.slice(); picking = null; entry = { seats, cells: new Array(n).fill(''), lost: '0', step: 'cells', order: [], tobi: {}, filled: false }; render(); });
      on('#pCancel', () => { picking = null; render(); });
    }
    if (entry) {
      on('#eOk', entryNext);
      on('#eCancel', () => { entry = null; render(); });
      on('#ePeople', () => { picking = { seats: entry.seats.slice(), typed: '', dup: null }; entry = null; render(); });
      on('#eFill', () => {
        readCells();
        const empty = entry.cells.map((c, i) => (String(c).trim() === '' ? i : -1)).filter((i) => i >= 0);
        if (empty.length !== 1) { q('#eErr').textContent = '空けておくのは1人だけにしてください。'; return; }
        const lost = toInt(entry.lost || '0') || 0;
        const others = entry.cells.reduce((a, c, i) => (i === empty[0] ? a : a + (toInt(c) || 0)), 0);
        entry.cells[empty[0]] = String(table.rules.start_pts * n - lost - others);
        entry.filled = true; render();
      });
      on('#eVoid', () => { commit([{ op: entry.voided ? 'hanchan_unvoid' : 'hanchan_void', hanchan_id: entry.hanchan_id }]); entry = null; render(); });
      on('#eOrdReset', () => { entry.order = []; render(); });
      for (const b of el.querySelectorAll('[data-ord]')) b.onclick = () => { const i = Number(b.dataset.ord); if (!entry.order.includes(i)) entry.order.push(i); render(); };
      for (const b of el.querySelectorAll('[data-tobi]')) b.onclick = () => { const t = b.dataset.tobi; entry.tobi[Number(b.dataset.b)] = t === 'all' ? 'all' : Number(t); if (entry.busted.every((x) => entry.tobi[x] !== undefined)) save1(); else render(); };
    }
  }

  window.addEventListener('pagehide', flushMerge);
  render();
}
