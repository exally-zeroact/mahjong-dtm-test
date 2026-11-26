/* league-rank.mjs — ★D3 リーグの途中経過（全体の順位・卓ごとの順位）★（定め memory/mahjong_tataki_2026-11-20/d3_sadame.md v1.3）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。st＝リーグの頁の st（mj_read 'league' の v 無し＝全部の日・fillRules の後）。
 *
 * leagueRank(st, { rank_by, complete }) →
 *   { ok: true, rows: [{ member_id, name, pt10, han10, extra10, n, rankSum, rank }], skipped: [...], count }
 *   { ok: false, err: 'unloaded' | 'rank_by' }   ★門に当たれば数を1つも出さない★
 *   門の順＝unloaded（complete が厳密に true でない・st.loaded に入っていない開催が在る）→ rank_by。
 *   数える物（tableRank と同じ）＝取り消していない開催 × 取り消していない卓 × ok の半荘。卓の枚の数は tableView の extrasOk の時だけ
 *     （windows[].pt10 をそのまま足す＝1種でも合計が合わなければその卓の枚の数は全部入れない・外へ払う種は入れない）。
 *   並べ方：pt＝pt10 の大きい順／avg_pt＝pt10/n の大きい順／avg_rank＝rankSum/n の小さい順（★割らずに掛けて比べる★）。
 *     同じ値＝同じ順位（次は飛ぶ）・同じ値の中は名の読み（nameKey）→ member_id。n=0 は rank null で一番下。min_games は見ない（A22）。
 *   skipped＝数えなかった物（取り消しは入れない）：{ session_id, date, table_id, label, what: 'hanchan', no, why } ／
 *     { session_id, date, table_id, label, what: 'extras', kind, diff }（合計違いだけ・外へ払う種の not_yet は写さない）。
 *
 * tableChains(st, sessionId) → [頭の table_id]＝取り消していない卓が1つでも在る鎖ごとに1つ（st.tables の並び）。
 * tableRank(st, headId) → { ok: true, rows, view } ／ { ok: false, err: 'table' }
 *   rows＝鎖の取り消していない卓の windows を人ごとに足した pt10 の大きい順（'pt' の並べ方）＝leagueRank の同じ卓の分と同じ数。
 *   view＝{ rows（chainView の回から取り消した卓の回を抜き no を1から振り直す）, people（取り消していない卓の人）, windows（人ごとの枚の数の和） }
 *
 * completeOf(prev, { res, took, pages }) → boolean（画面の「全部読めた」の印・st の外に持つ・保存しない・開いた時は false）
 *   res＝readSt の返し { data, error, status }・took＝takeRead の返し（'ok' だけが置き換え）または 'local'（手元の op）。
 *   true＝error 無し・data.ok===true・data.st が object・took==='ok'・（data に more の鍵が無い か pages.done===true）の全部の時だけ。
 *   local と data.same＝prev のまま。他（error・ok:false・skip 等）は false。
 */
import { tableView, chainView, tableChain, viewIndex } from './room-state.mjs';
import { nameKey } from './name-key.mjs';

export const RANK_BY = Object.freeze(['pt', 'avg_pt', 'avg_rank']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyOf = (name) => { try { return nameKey(String(name ?? '')); } catch { return String(name ?? ''); } };

/* 卓1つ（取り消していない）の数を人ごとに acc へ足す。skipped に数えなかった物を積む */
function addTable(st, ix, t, s, acc, skipped) {
  const v = tableView(st, t.table_id, ix);
  if (!v) return 0;
  const at = { session_id: s.session_id, date: s.date ?? null, table_id: t.table_id, label: t.label ?? null };
  for (const m of v.missing) {
    if (m.what === undefined) skipped.push({ ...at, what: 'hanchan', no: m.no, why: m.why });
    else if (m.why !== 'not_yet') skipped.push({ ...at, what: 'extras', kind: m.what, diff: m.diff });
  }
  let count = 0;
  const rankSum = {}, n = {};
  for (const r of v.rows) {
    if (!r.ok) continue;
    count++;
    for (const [m, c] of Object.entries(r.by)) { n[m] = (n[m] || 0) + 1; rankSum[m] = (rankSum[m] || 0) + c.rank + 1; }
  }
  for (const w of v.windows) {
    const a = acc.get(w.member_id) || { member_id: w.member_id, pt10: 0, han10: 0, extra10: 0, n: 0, rankSum: 0 };
    a.pt10 += w.pt10; a.han10 += w.hanPt10; a.extra10 += w.pt10 - w.hanPt10;
    a.n += n[w.member_id] || 0; a.rankSum += rankSum[w.member_id] || 0;
    acc.set(w.member_id, a);
  }
  return count;
}

/* a が b より上なら負 */
function cmpBy(rank_by) {
  if (rank_by === 'pt') return (a, b) => b.pt10 - a.pt10;
  if (rank_by === 'avg_pt') return (a, b) => b.pt10 * a.n - a.pt10 * b.n;
  return (a, b) => a.rankSum * b.n - b.rankSum * a.n;
}

function order(list, cmp, names) {
  const live = list.filter((x) => x.n > 0), zero = list.filter((x) => !(x.n > 0));
  const tie = (a, b) => { const ka = keyOf(names(a.member_id)), kb = keyOf(names(b.member_id)); return ka < kb ? -1 : ka > kb ? 1 : a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0; };
  live.sort((a, b) => cmp(a, b) || tie(a, b));
  zero.sort(tie);
  let rank = 0;
  live.forEach((x, i) => { if (i === 0 || cmp(live[i - 1], x) !== 0) rank = i + 1; x.rank = rank; });
  zero.forEach((x) => { x.rank = null; });
  return [...live, ...zero].map((x) => ({ ...x, name: names(x.member_id) }));
}

export function leagueRank(st, opts = {}) {
  const { rank_by, complete } = opts;
  const live = (st.sessions || []).filter((s) => !s.voided);
  if (complete !== true) return { ok: false, err: 'unloaded' };
  if (Array.isArray(st.loaded) && !live.every((s) => st.loaded.includes(s.session_id))) return { ok: false, err: 'unloaded' };
  if (!RANK_BY.includes(rank_by)) return { ok: false, err: 'rank_by' };
  const ix = viewIndex(st);
  const names = (m) => { const x = ix.m.get(m); return x ? x.name : '?'; };
  const acc = new Map(), skipped = [];
  let count = 0;
  for (const s of live) {
    for (const t of st.tables) if (t.session_id === s.session_id && !t.voided) count += addTable(st, ix, t, s, acc, skipped);
  }
  return { ok: true, rows: order([...acc.values()], cmpBy(rank_by), names), skipped, count };
}

export function tableChains(st, sessionId) {
  const isNext = new Set(st.tables.filter((t) => t.next_table_id != null).map((t) => t.next_table_id));
  const byId = new Map(st.tables.map((t) => [t.table_id, t]));
  return st.tables.filter((t) => t.session_id === sessionId && !isNext.has(t.table_id)
    && tableChain(st, t.table_id).some((id) => byId.get(id) && !byId.get(id).voided)).map((t) => t.table_id);
}

export function tableRank(st, headId) {
  const ix = viewIndex(st);
  const head = ix.t.get(headId);
  if (!head) return { ok: false, err: 'table' };
  const s = ix.s.get(head.session_id);
  const ch = tableChain(st, headId);
  const liveIds = ch.filter((id) => ix.t.get(id) && !ix.t.get(id).voided);
  if (!liveIds.length || !s) return { ok: false, err: 'table' };
  const names = (m) => { const x = ix.m.get(m); return x ? x.name : '?'; };
  const acc = new Map(), skipped = [];
  for (const id of liveIds) addTable(st, ix, ix.t.get(id), s, acc, skipped);
  const rows = order([...acc.values()], cmpBy('pt'), names);
  // 詳細：chainView の回から取り消した卓の回を抜き、no を振り直す。人と枚の数は取り消していない卓だけ
  const cv = chainView(st, headId);
  const keep = new Set(liveIds);
  const vrows = (cv ? cv.rows : []).filter((r) => keep.has(r.table_id)).map((r, i) => ({ ...r, no: i + 1 }));
  const parts = liveIds.map((id) => tableView(st, id, ix)).filter(Boolean);
  const people = [];
  for (const p of parts) for (const x of p.people) if (!people.some((y) => y.member_id === x.member_id)) people.push(x);
  const SUM = ['chip', 'shugi', 'yaki', 'tobi', 'chipPt10', 'shugiPt10', 'yakiPt10', 'tobiPt10', 'custPt10', 'out10', 'hanPt10', 'pt10'];
  const windows = people.map((x) => {
    const w = { member_id: x.member_id, name: x.name, dim: false };
    for (const k of SUM) w[k] = 0;
    for (const p of parts) {
      const pw = p.windows.find((y) => y.member_id === x.member_id);
      if (!pw) continue;
      for (const k of SUM) w[k] += pw[k];
      w.dim = w.dim || pw.dim;
    }
    return w;
  });
  return { ok: true, rows, skipped, view: { rows: vrows, people, windows, parts: liveIds } };
}

export function completeOf(prev, { res, took, pages } = {}) {
  if (took === 'local') return prev === true;
  if (!isObj(res) || res.error) return false;
  const d = res.data;
  if (!isObj(d) || d.ok !== true) return false;
  if (d.same === true) return prev === true;
  if (!isObj(d.st) || took !== 'ok') return false;
  if (Object.prototype.hasOwnProperty.call(d, 'more')) return isObj(pages) && pages.done === true;
  return true;
}
