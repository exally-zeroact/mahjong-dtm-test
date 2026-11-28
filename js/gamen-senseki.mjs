/* gamen-senseki.mjs — ★C2-3 戦績の画面★（定め memory/mahjong_tataki_2026-11-20/c2_sadame.md v9.4 §3・絵 mahjong_senseki_tochu_v158 ①②）
 * =============================================================================
 * 読み＝倉庫 mj_account('my_stats', {v:1, after, at}) を more が false になるまで頁ごとに（at＝1頁目の at・after＝前の頁の next_after）。
 * 数＝★lib/my-stats.mjs の myComplete／myStats だけ★（この画面は式を持たない・足すのは lib が返した v の並べと表示だけ）。
 * ★警告と説明の帯は出さない（司さん 11-27 v158「警告文いらん」）★＝skipped は出さない・unlinked は［あなたの名前を選ぶ］釦だけ・
 *   出た部屋と出た後は数だけ（押すと日・卓・点）。残すのは読めなかった時の「戦績を全部読めていません」＋［もう一度］だけ（1頁目から読み直す）。
 */
import { needLogin, showLogin, rpc, $, esc } from './gamen-core.mjs';
import { myComplete, myStats } from '../lib/my-stats.mjs';
import { NEWER_TEXT, tableRate } from '../lib/room-state.mjs';
import { addS } from '../lib/safe-int.mjs';

const MODE_LABEL = [['pt', 'pt だけ'], ['extras', 'チップ祝儀込'], ['ten', '点']];
const PL_LABEL = [['all', '全部'], [4, '4人'], [3, '3人']];
const DIMS = [['league', 'リーグ'], ['rate', 'レート'], ['period', '期間'], ['place', '場所']];
const READ_FAIL = '戦績を全部読めていません';

let pages = null;      // 読み切った頁（myComplete が ok の物だけ置く）
let readSeq = 0;
let mode = 'pt';
let players = 'all';
const filt = { league: undefined, rate: undefined, period: undefined, place: undefined }; // undefined＝絞らない・null＝「無し」
let openDim = null;    // 選ぶ所を開いている絞り
const openHist = new Set();
const openOut = new Set();

/* ── 字の形 ── */
const minus = '−';
export function fmtV(v, m) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = m === 'ten' ? a.toLocaleString('ja-JP') : (a / 10).toFixed(1);
  return (v > 0 ? '+' : minus) + s;
}
const cls = (v) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');
const pct = (a, n) => (n ? Math.round((a / n) * 100) + '%' : '—');
const avg = (sum, n) => (n ? (sum / n).toFixed(2) : '—');
const md = (d) => (typeof d === 'string' && d.length >= 10 ? Number(d.slice(5, 7)) + '/' + d.slice(8, 10) : '');
const roomName = (r) => (r == null || r === '' ? '1人で入力' : r);
const rateText = (r) => (r === null ? 'レート無し' : '1pt＝' + r);

/* ── 読み（頁を全部） ── */
async function loadAll() {
  const seq = ++readSeq;
  pages = null;
  draw({ loading: true });
  const got = [];
  let after = null, at = null;
  for (;;) {
    const res = await rpc('mj_account', { p_what: 'my_stats', p_args: { v: 1, ...(after ? { after } : {}), ...(at ? { at } : {}) } });
    if (seq !== readSeq) return;
    if (res && res.err === 'mj_session') { showLogin(() => loadAll()); return; }
    if (!res || res.ok !== true) { draw({ fail: true }); return; }
    got.push({ after, data: res });
    if (!res.more) break;
    if (!res.next_after || JSON.stringify(res.next_after) === JSON.stringify(after)) { draw({ fail: true }); return; } // 進まない頁＝読めていない
    after = res.next_after; at = res.at;
  }
  const c = myComplete(got);
  if (!c.ok) { draw({ fail: true }); return; }
  pages = got;
  draw({});
}

/* ── 絞りの候補（頁の中の開催と卓から拾うだけ） ── */
function choices() {
  const leagues = new Map(), rates = new Set(), months = new Set(), places = new Set();
  let noLeague = false;
  for (const pg of pages) for (const row of pg.data.rows) {
    for (const l of row.leagues || []) if (l && l.league_id) leagues.set(l.league_id, l.name || '?');
    const ses = new Map((row.st.sessions || []).map((s) => [s.session_id, s]));
    for (const s of row.st.sessions || []) {
      if (s.voided) continue;
      if (!s.league_id) noLeague = true;
      if (typeof s.date === 'string') months.add(s.date.slice(0, 7));
      places.add(s.place ?? null);
    }
    for (const t of row.st.tables || []) {
      const s = ses.get(t.session_id);
      if (!s || s.voided || t.voided) continue;
      rates.add(tableRate(t, s));
    }
  }
  return {
    league: [...[...leagues].map(([id, name]) => [id, name]), ...(noLeague ? [[null, 'リーグ無し']] : [])],
    rate: [...rates].sort((a, b) => (a === null ? 1 : b === null ? -1 : b - a)).map((r) => [r, rateText(r)]),
    period: [...months].sort().reverse().map((m) => [m, m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月']),
    place: [...places].sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)).map((p) => [p, p === null || p === '' ? '場所無し' : p]),
  };
}
function filterObj(extra) {
  const f = {};
  if (filt.league !== undefined) f.league = filt.league;
  if (filt.rate !== undefined) f.rate = filt.rate;
  if (filt.place !== undefined) f.place = filt.place;
  if (filt.period !== undefined) {
    const [y, m] = filt.period.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    f.from = filt.period + '-01'; f.to = filt.period + '-' + String(last).padStart(2, '0');
  }
  return { ...f, ...(extra || {}) };
}
const anyFilter = () => DIMS.some(([k]) => filt[k] !== undefined);

/* ── 描く ── */
function draw(o) {
  const main = $('vStats');
  main.hidden = false;
  if (o.loading) { main.innerHTML = '<p class="empty" id="sLoading">読み込んでいます</p>'; return; }
  if (o.fail) {
    main.innerHTML = '<div class="r-red" id="sFail"><b>' + READ_FAIL + '</b><button class="btn btn-line" type="button" id="sRetry">もう一度</button></div>';
    $('sRetry').onclick = () => loadAll();
    return;
  }
  const res = myStats(pages, { filter: filterObj(), mode, players });
  if (!res.ok) {
    main.innerHTML = res.err === 'newer' ? '<div class="r-red" id="sFail"><b>' + esc(NEWER_TEXT) + '</b></div>'
      : '<div class="r-red" id="sFail"><b>' + READ_FAIL + '</b><button class="btn btn-line" type="button" id="sRetry">もう一度</button></div>';
    const b = $('sRetry'); if (b) b.onclick = () => loadAll();
    return;
  }
  const ch = choices();
  let h = '';
  const unl = Object.values(res.unlinked || {}).reduce((a, n) => a + n, 0);
  if (unl > 0) h += '<a class="btn btn-main" id="sPickMe" href="index.html">あなたの名前を選ぶ</a>';
  // 絞り
  h += '<div class="chips" id="sDims"><button type="button" data-dim="all" aria-pressed="' + !anyFilter() + '">全部</button>';
  for (const [k, lb] of DIMS) {
    const v = filt[k];
    const name = v === undefined ? lb : (ch[k].find((x) => x[0] === v) || [v, String(v)])[1];
    h += '<button type="button" data-dim="' + k + '" aria-pressed="' + (v !== undefined) + '" aria-expanded="' + (openDim === k) + '">' + esc(name) + ' ▾</button>';
  }
  h += '</div>';
  if (openDim) {
    h += '<div class="chips" id="sPick"><button type="button" data-pick="__none" aria-pressed="' + (filt[openDim] === undefined) + '">絞らない</button>';
    ch[openDim].forEach(([v, lb], i) => { h += '<button type="button" data-pick="' + i + '" aria-pressed="' + (filt[openDim] === v) + '">' + esc(lb) + '</button>'; });
    h += '</div>';
  }
  h += segHtml('sMode', MODE_LABEL, mode) + segHtml('sPl', PL_LABEL, players);
  const gs = [res.groups[4], res.groups[3]].filter((g) => g && g.n > 0);
  if (!gs.length && !res.afterLeave.length) h += '<p class="empty" id="sEmpty">まだ戦績はありません</p>';
  const unit = mode === 'ten' ? '点' : 'pt';
  for (const g of gs) h += groupHtml(g, unit, ch); // n<10 の「目安」の字は出さない（司さん 11-27「警告文いらん」・コンサル 11-28）
  for (const g of gs) h += vsHtml(g);
  h += outHtml(gs, res.afterLeave);
  h += histHtml(gs);
  main.innerHTML = h;
  wire(ch);
}
const segHtml = (id, list, cur) => '<div class="seg" id="' + id + '">' + list.map(([v, lb]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (String(v) === String(cur)) + '">' + lb + '</button>').join('') + '</div>';

function groupHtml(g, unit, ch) {
  const P = g.players;
  const fl = anyFilter() ? DIMS.filter(([k]) => filt[k] !== undefined).map(([k]) => (ch[k].find((x) => x[0] === filt[k]) || [0, '?'])[1]).join('・') : '全部';
  let h = '<div class="card s-grp" data-pl="' + P + '"><p class="sec-h">' + P + '人打ち　' + esc(fl) + '（' + g.n + '半荘）</p>';
  h += '<div class="s-big"><div><b class="' + cls(g.v) + '">' + fmtV(g.v, mode) + '</b><small>合計' + unit + '</small></div>' +
    '<div><b>' + avg(g.rankSum, g.n) + '</b><small>平均順位</small></div><div><b>' + pct(g.top, g.n) + '</b><small>トップ率</small></div>' +
    '<div><b>' + pct(g.last, g.n) + '</b><small>ラス率</small></div></div>';
  h += '<p class="sec-h s-sub">順位の分布</p><div class="s-dist">';
  g.rankCounts.forEach((c, i) => { if (c > 0) h += '<span class="s-r' + (i === P - 1 ? 'L' : i) + '" style="flex:' + c + '">' + (i + 1) + '位 ' + c + '</span>'; });
  h += '</div></div>';
  // レート別（lib をレートごとに呼ぶ＝lib の数のまま）
  if (filt.rate === undefined && ch.rate.length) {
    let rows = '';
    for (const [r, lb] of ch.rate) {
      const x = myStats(pages, { filter: filterObj({ rate: r }), mode, players: P });
      const q = x.ok && x.groups[P];
      if (!q || !q.n) continue;
      rows += '<tr><td>' + esc(lb) + '</td><td>' + q.n + '</td><td class="' + cls(q.v) + '">' + fmtV(q.v, mode) + '</td><td>' + avg(q.rankSum, q.n) + '</td><td>' + pct(q.top, q.n) + '</td></tr>';
    }
    if (rows) h += '<div class="card s-rate" data-pl="' + P + '"><p class="sec-h">レート別</p><table class="s-tb"><tr><th>レート</th><th>半荘</th><th>合計' + unit + '</th><th>平均順位</th><th>トップ</th></tr>' + rows + '</table></div>';
  }
  // 移り変わり
  if (g.trend.length) {
    const W = 336, H = 110, pad = 8;
    const sums = [0, ...g.trend.map((t) => t.sum)];
    const lo = Math.min(...sums), hi = Math.max(...sums), span = hi - lo || 1;
    const y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
    const pts = sums.map((v, i) => (sums.length === 1 ? 0 : Math.round((W * i) / (sums.length - 1))) + ',' + y(v).toFixed(1)).join(' ');
    h += '<div class="card s-trend" data-pl="' + P + '"><p class="sec-h">' + unit + ' の移り変わり</p><svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + unit + ' の移り変わり">' +
      '<line x1="0" y1="' + y(0).toFixed(1) + '" x2="' + W + '" y2="' + y(0).toFixed(1) + '" stroke="var(--c-sen)"/>' +
      '<polyline fill="none" stroke="var(--c-kon)" stroke-width="2.5" points="' + pts + '"/></svg></div>';
  }
  return h;
}

function vsHtml(g) {
  if (!g.vs.length) return '';
  const list = [...g.vs].sort((a, b) => b.n - a.n);
  let h = '<div class="card s-vs" data-pl="' + g.players + '"><p class="sec-h">相性（同じ卓の人・自分から見て' + (g.players === 3 ? '・3人' : '') + '）</p><table class="s-tb"><tr><th>相手</th><th>一緒の半荘</th><th>自分の平均順位</th><th>自分の pt</th></tr>';
  for (const x of list) h += '<tr><td>' + esc(x.name) + '</td><td>' + x.n + '</td><td>' + avg(x.rankSum, x.n) + '</td><td class="' + cls(x.myPt10) + '">' + fmtV(x.myPt10, 'pt') + '</td></tr>';
  return h + '</table></div>';
}

function outHtml(gs, afterLeave) {
  const by = new Map();
  for (const g of gs) for (const x of g.games) {
    if (x.side !== 'out') continue;
    const r = by.get(x.room_id) || { room: x.room, n: 0, v: 0, games: [] };
    r.n++; r.v = addS(r.v, addS(x.v, x.ex)); r.games.push(x);
    by.set(x.room_id, r);
  }
  for (const a of afterLeave) if (!by.has(a.room_id)) by.set(a.room_id, { room: null, n: 0, v: 0, games: [] });
  if (!by.size) return '';
  const al = new Map(afterLeave.map((a) => [a.room_id, a]));
  let h = '<div class="card s-out"><p class="sec-h">出た部屋</p><table class="s-tb"><tr><th>部屋</th><th>半荘</th><th>合計</th><th>出た後</th></tr>';
  for (const [id, r] of by) {
    const a = al.get(id);
    const nAfter = a ? a.n : 0;
    h += '<tr class="s-tap" data-out="' + esc(id) + '"><td>' + esc(roomName(r.room)) + '</td><td>' + r.n + '</td><td class="' + cls(r.v) + '">' + fmtV(r.v, mode) + '</td><td>' + nAfter + (a ? ' ›' : '') + '</td></tr>';
    if (a && openOut.has(id)) {
      let d = '';
      for (const x of a.rows) {
        const gm = r.games.find((y) => y.date === x.date && y.label === x.label && y.no === x.no);
        d += '<div class="s-dt">' + md(x.date) + ' ' + esc(x.label || '') + ' ' + x.no + '回目' + (gm ? '　' + (gm.rank + 1) + '位 ' + Number(gm.cell).toLocaleString('ja-JP') + '<span class="' + cls(gm.v) + '"> ' + fmtV(gm.v, mode) + '</span>' : '') + '</div>';
      }
      if (a.tables.length) d += '<div class="s-dt s-dt-h">出た後に変わった卓</div>' + a.tables.map((t) => '<div class="s-dt">' + md(t.date) + ' ' + esc(t.label || '') + '</div>').join('');
      h += '<tr class="s-open"><td colspan="4">' + d + '</td></tr>';
    }
  }
  return h + '</table></div>';
}

function histHtml(gs) {
  const by = new Map();
  for (const g of gs) for (const x of g.games) {
    const k = x.room_id + '|' + x.session_id + '|' + x.table_id; // 字の鍵（属性に NUL を入れると HTML が U+FFFD に替える）
    const r = by.get(k) || { date: x.date, room: x.room, label: x.label, n: 0, v: 0, games: [] };
    r.n++; r.v = addS(r.v, addS(x.v, x.ex)); r.games.push(x);
    by.set(k, r);
  }
  if (!by.size) return '';
  const list = [...by].sort((a, b) => (String(a[1].date) < String(b[1].date) ? 1 : String(a[1].date) > String(b[1].date) ? -1 : 0));
  let h = '<div class="card s-hist"><p class="sec-h">対戦の履歴</p><table class="s-tb">';
  for (const [k, r] of list) {
    h += '<tr class="s-tap" data-hist="' + esc(k) + '"><td>' + md(r.date) + ' ' + esc(roomName(r.room)) + (r.label ? '・' + esc(r.label) : '') + '</td><td>' + r.n + '回</td><td class="' + cls(r.v) + '">' + fmtV(r.v, mode) + ' ›</td></tr>';
    if (openHist.has(k)) {
      const d = r.games.sort((a, b) => a.no - b.no).map((x) => '<div class="s-dt">' + x.no + '回目　' + (x.rank + 1) + '位 ' + Number(x.cell).toLocaleString('ja-JP') + '<span class="' + cls(addS(x.v, x.ex)) + '"> ' + fmtV(addS(x.v, x.ex), mode) + '</span></div>').join('');
      h += '<tr class="s-open"><td colspan="3">' + d + '</td></tr>';
    }
  }
  return h + '</table></div>';
}

function wire(ch) {
  for (const b of document.querySelectorAll('#sDims button')) b.onclick = () => {
    const d = b.dataset.dim;
    if (d === 'all') { for (const [k] of DIMS) filt[k] = undefined; openDim = null; }
    else openDim = openDim === d ? null : d;
    draw({});
  };
  for (const b of document.querySelectorAll('#sPick button')) b.onclick = () => {
    filt[openDim] = b.dataset.pick === '__none' ? undefined : ch[openDim][Number(b.dataset.pick)][0];
    openDim = null; draw({});
  };
  for (const b of document.querySelectorAll('#sMode button')) b.onclick = () => { mode = b.dataset.v; draw({}); };
  for (const b of document.querySelectorAll('#sPl button')) b.onclick = () => { players = b.dataset.v === 'all' ? 'all' : Number(b.dataset.v); draw({}); };
  for (const tr of document.querySelectorAll('[data-hist]')) tr.onclick = () => { const k = tr.dataset.hist; openHist.has(k) ? openHist.delete(k) : openHist.add(k); draw({}); };
  for (const tr of document.querySelectorAll('[data-out]')) tr.onclick = () => { const k = tr.dataset.out; openOut.has(k) ? openOut.delete(k) : openOut.add(k); draw({}); };
}

function start() { $('vLogin').hidden = true; loadAll(); }
if (typeof document !== 'undefined' && document.getElementById('vStats')) {
  $('btnLoginOpen').onclick = () => showLogin(start);
  needLogin(start).catch((e) => { $('vStats').hidden = false; $('vStats').innerHTML = '<p class="err">止まりました：' + esc(e.message) + '</p>'; });
}
