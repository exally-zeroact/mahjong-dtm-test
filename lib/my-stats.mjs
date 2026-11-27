/* my-stats.mjs — ★C2 自分の戦績（部屋をまたいで・出た部屋も）★（定め memory/mahjong_tataki_2026-11-20/c2_sadame.md v9.4 §2・試験 c2_shiken.md）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。★自分で式を持たない★＝数は room-state の tableView（D3 leagueRank の addTable と同じ）だけから取る。
 *
 * pages＝[{ after, data }]（after＝その頁を読んだ時に渡した印・1頁目は null／data＝mj_account('my_stats') の返し）
 * myComplete(pages) → { ok: true } ／ { ok: false, err: 'unloaded' | 'bad' }
 *   unloaded＝頁が無い・ok でない（busy も）・more が最後の頁だけ false でない・after が前の頁の next_after と違う・at が違う・同じ部屋の side が頁で違う
 *   bad＝形が違う（rows・room_id・side・me・st・out の al・1頁目の unlinked）
 * myStats(pages, { filter, mode, players }) →
 *   { ok: true, groups, skipped, unlinked, afterLeave, noRate, outRooms } ／ { ok: false, err: 'unloaded' | 'bad' | 'newer' | 'mode' | 'players' | 'filter' }
 *   mode＝'pt'（半荘の pt10・飛び賞込み）／'extras'（＋卓の枚＝windows の pt10−hanPt10・extrasOk の卓だけ・外へ払う種は入らない）／
 *         'ten'（卓のレートで換えた点＝pt10×rate/10・rate null の卓は入れず noRate に数える）
 *   ★数える単位（定め §2 UNIT）★＝n・順位・pt は半荘ごと／枚（extras）と点（ten）の枚の分は卓ごと（卓の最後に数えた半荘へ付ける）
 *   players＝'all' | 4 | 3（groups は 4人と3人を別に数える＝ラス＝4位／3位）
 *   filter＝{ league?: id|null, rate?: 数|null, from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', place?: 字|null }（undefined＝絞らない・null＝「無し」の組）
 *   groups＝{ 4?: G, 3?: G }・G＝{ players, n, v（mode の単位の合計）, pt10, rankCounts, rankSum, top, last, rentai, tobi,
 *     scoreSum, scoreMax, scoreMin, extras: { chip, shugi, yaki, extra10, tables }, trend: [{ date, v, sum }], months, places, games, vs, rough }
 *   skipped＝取り消していない ok でない自分の半荘 { what: 'hanchan', room_id, room, side, date, label, no, why }＋
 *     数えなかった卓の枚 { what: 'extras', room_id, room, side, date, label, why: 'sum' | 'not_yet' | 'big' }（取り消しは出さない）
 *   afterLeave＝[{ room_id, n, rows: [{ date, label, no }], tables: [{ date, label }] }]＝n・rows は al.h のうち★この呼びで groups に足した半荘だけ★
 *   ★出た部屋（out）の他の人は仮の id のまま・頁を跨いで突き合わせない★・相性（vs）は in の部屋だけ。
 */
import { migrateState, viewIndex, tableView, tableRate, bustedSeats } from './room-state.mjs';
import { mulS, addS } from './safe-int.mjs';

export const MODES = Object.freeze(['pt', 'extras', 'ten']);
export const PLAYERS = Object.freeze(['all', 4, 3]);
export const ROUGH_N = 10; // n<10＝「半荘数が少ないので目安」（設計図 §8）
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const canon = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ARR = ['members', 'sessions', 'tables', 'hanchans', 'extras'];

function rowOk(r, side) {
  if (!isObj(r) || !isStr(r.room_id) || (r.side !== 'in' && r.side !== 'out')) return false;
  if (side && side !== r.side) return false;
  if (!Array.isArray(r.me) || !r.me.length || !r.me.every(isStr)) return false;
  if (!isObj(r.st)) return false;
  for (const k of ARR) if (k !== 'members' && !Array.isArray(r.st[k])) return false;
  if (r.side === 'in' && !Array.isArray(r.st.members)) return false;
  if (r.side === 'out') {
    if (!isObj(r.al) || !Array.isArray(r.al.t) || !Array.isArray(r.al.h) || !r.al.t.every(isStr) || !r.al.h.every(isStr)) return false;
  }
  return true;
}

export function myComplete(pages) {
  if (!Array.isArray(pages) || !pages.length) return { ok: false, err: 'unloaded' };
  const sideOf = new Map();
  let at;
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    if (!isObj(pg) || !isObj(pg.data) || pg.data.ok !== true) return { ok: false, err: 'unloaded' };
    const d = pg.data;
    const last = i === pages.length - 1;
    if (d.more !== !last) return { ok: false, err: 'unloaded' };
    if (i === 0 ? pg.after != null : canon(pg.after) !== canon(pages[i - 1].data.next_after)) return { ok: false, err: 'unloaded' };
    if (i === 0) at = d.at; else if (canon(d.at) !== canon(at)) return { ok: false, err: 'unloaded' };
    if (!Array.isArray(d.rows)) return { ok: false, err: 'bad' };
    if (i === 0 && !(isObj(d.unlinked) && Object.values(d.unlinked).every((n) => Number.isInteger(n) && n >= 0))) return { ok: false, err: 'bad' };
    for (const r of d.rows) {
      if (!rowOk(r)) return { ok: false, err: 'bad' };
      const s = sideOf.get(r.room_id);
      if (s !== undefined && s !== r.side) return { ok: false, err: 'unloaded' };
      sideOf.set(r.room_id, r.side);
    }
  }
  return { ok: true };
}

function filterOk(f) {
  if (f === undefined || f === 'all') return true;
  if (!isObj(f)) return false;
  for (const k of Object.keys(f)) if (!['league', 'rate', 'from', 'to', 'place'].includes(k)) return false;
  if (f.league !== undefined && f.league !== null && !isStr(f.league)) return false;
  if (f.rate !== undefined && f.rate !== null && !Number.isInteger(f.rate)) return false;
  for (const k of ['from', 'to']) if (f[k] !== undefined && !(typeof f[k] === 'string' && DAY.test(f[k]))) return false;
  if (f.place !== undefined && f.place !== null && typeof f.place !== 'string') return false;
  return true;
}
function passes(f, s, rate) {
  if (f === undefined || f === 'all') return true;
  if (f.league !== undefined && (s.league_id ?? null) !== f.league) return false;
  if (f.rate !== undefined && rate !== f.rate) return false;
  if (f.from !== undefined && !(typeof s.date === 'string' && s.date >= f.from)) return false;
  if (f.to !== undefined && !(typeof s.date === 'string' && s.date <= f.to)) return false;
  if (f.place !== undefined && (s.place ?? null) !== f.place) return false;
  return true;
}

function newGroup(players) {
  return {
    players, n: 0, v: 0, pt10: 0, rankCounts: Array(players).fill(0), rankSum: 0, top: 0, last: 0, rentai: 0, tobi: 0,
    scoreSum: 0, scoreMax: null, scoreMin: null, extras: { chip: 0, shugi: 0, yaki: 0, extra10: 0, tables: 0 },
    trend: [], months: {}, places: {}, games: [], vs: {}, rough: true,
  };
}
const bump = (o, k, n, v, rank) => { const x = o[k] || (o[k] = { n: 0, v: 0, rankSum: 0 }); x.n += n; x.v = addS(x.v, v); x.rankSum += rank; };

export function myStats(pages, opts = {}) {
  const { filter, mode, players = 'all' } = opts;
  const c = myComplete(pages);
  if (!c.ok) return c;
  if (!MODES.includes(mode)) return { ok: false, err: 'mode' };
  if (!PLAYERS.includes(players)) return { ok: false, err: 'players' };
  if (!filterOk(filter)) return { ok: false, err: 'filter' };
  const groups = {}, skipped = [], afterBy = new Map(), outRooms = new Set();
  let noRate = 0, seq = 0;
  const G = (n) => groups[n] || (groups[n] = newGroup(n));
  for (const pg of pages) {
    for (const row of pg.data.rows) {
      const st0 = row.side === 'out' ? { ...row.st, members: [] } : row.st; // out＝名簿は返らない＝members=[] で viewIndex を通す
      const mig = migrateState(st0);
      if (mig.gate.mode === 'newer') return { ok: false, err: 'newer' };
      if (mig.gate.mode !== 'ok') return { ok: false, err: 'bad' };
      const st = mig.st, ix = viewIndex(st), me = new Set(row.me);
      const at = { room_id: row.room_id, room: row.name ?? null, side: row.side };
      if (row.side === 'out') outRooms.add(row.room_id);
      const alH = row.side === 'out' ? new Set(row.al.h) : null;
      const counted = [];
      for (const s of st.sessions) {
        if (s.voided) continue;
        for (const t of st.tables) {
          if (t.session_id !== s.session_id || t.voided) continue;
          const v = tableView(st, t.table_id, ix);
          if (!v || !isObj(v.rules)) continue;
          const n = v.rules.players;
          if (players !== 'all' && n !== players) continue;
          if (!passes(filter, s, v.rate)) continue;
          if (!v.people.some((p) => me.has(p.member_id))) continue; // 自分が座るか枚を持つ卓だけ
          const where = { ...at, date: s.date ?? null, label: t.label ?? null };
          if (mode === 'ten' && v.rate === null) { noRate++; continue; }
          if (mode === 'ten' && v.bigNg) { skipped.push({ what: 'extras', ...where, why: 'big' }); continue; }
          const useEx = mode !== 'pt';
          if (useEx && !v.extrasOk) skipped.push({ what: 'extras', ...where, why: 'sum' });
          else if (mode === 'ten' && v.custWait) skipped.push({ what: 'extras', ...where, why: 'not_yet' });
          const conv = (pt10) => (mode === 'ten' ? mulS(pt10, v.rate / 10) : pt10);
          const g = G(n);
          let lastGame = null;
          for (const r of v.rows) {
            if (r.voided) continue;
            const m = Object.keys(r.by).find((k) => me.has(k));
            if (m === undefined) continue;
            if (!r.ok) { skipped.push({ what: 'hanchan', ...where, no: r.no, why: r.why }); continue; }
            const b = r.by[m];
            const cells = Object.values(r.by).sort((x, y) => x.seat - y.seat).map((x) => x.cell);
            const busted = bustedSeats(v.rules, cells).includes(b.seat);
            const val = conv(b.pt10);
            g.n++; g.v = addS(g.v, val); g.pt10 += b.pt10;
            g.rankCounts[b.rank]++; g.rankSum += b.rank + 1;
            if (b.rank === 0) g.top++;
            if (b.rank === n - 1) g.last++;
            if (b.rank <= 1) g.rentai++;
            if (busted) g.tobi++;
            g.scoreSum += b.cell;
            g.scoreMax = g.scoreMax === null ? b.cell : Math.max(g.scoreMax, b.cell);
            g.scoreMin = g.scoreMin === null ? b.cell : Math.min(g.scoreMin, b.cell);
            const game = { ...at, session_id: s.session_id, date: s.date ?? null, place: s.place ?? null, table_id: t.table_id, label: t.label ?? null,
              hanchan_id: r.hanchan_id, no: r.no, rank: b.rank, cell: b.cell, pt10: b.pt10, busted, v: val, ex: 0, seq: seq++ };
            g.games.push(game); lastGame = game;
            counted.push(game);
            bump(g.months, typeof s.date === 'string' ? s.date.slice(0, 7) : '', 1, val, b.rank + 1);
            bump(g.places, s.place ?? '', 1, 0, b.rank + 1);
            g.places[s.place ?? ''].v = addS(g.places[s.place ?? ''].v, val);
            if (row.side === 'in') {
              for (const o of Object.keys(r.by)) {
                if (me.has(o)) continue;
                const k = row.room_id + '\u0000' + o;
                const x = g.vs[k] || (g.vs[k] = { room_id: row.room_id, member_id: o, name: ix.m.get(o)?.name ?? '?', n: 0, rankSum: 0, myPt10: 0, theirPt10: 0 });
                x.n++; x.rankSum += b.rank + 1; x.myPt10 += b.pt10; x.theirPt10 += r.by[o].pt10;
              }
            }
          }
          // 枚＝卓ごと（卓の最後に数えた半荘へ付ける）。extrasOk の卓だけ・外へ払う種（out10）は windows の pt10 に入らない
          if (v.extrasOk) {
            const ws = v.windows.filter((w) => me.has(w.member_id));
            const ex10 = ws.reduce((a, w) => a + (w.pt10 - w.hanPt10), 0);
            if (ws.length) {
              g.extras.chip += ws.reduce((a, w) => a + w.chip, 0); g.extras.shugi += ws.reduce((a, w) => a + w.shugi, 0);
              g.extras.yaki += ws.reduce((a, w) => a + w.yaki, 0); g.extras.extra10 += ex10; g.extras.tables++;
            }
            if (useEx && ex10 !== 0) {
              const exv = conv(ex10);
              g.v = addS(g.v, exv);
              const mk = typeof s.date === 'string' ? s.date.slice(0, 7) : '';
              bump(g.months, mk, 0, exv, 0); bump(g.places, s.place ?? '', 0, exv, 0);
              if (lastGame) lastGame.ex = exv;
              else g.games.push({ ...at, session_id: s.session_id, date: s.date ?? null, place: s.place ?? null, table_id: t.table_id, label: t.label ?? null, hanchan_id: null, no: null, v: 0, ex: exv, seq: seq++ });
            }
          }
        }
      }
      if (row.side === 'out') {
        const a = afterBy.get(row.room_id) || { room_id: row.room_id, n: 0, rows: [], tables: [] };
        for (const gm of counted) if (alH.has(gm.hanchan_id)) { a.n++; a.rows.push({ date: gm.date, label: gm.label, no: gm.no }); }
        for (const id of row.al.t) {
          const t = ix.t.get(id);
          if (t) a.tables.push({ date: ix.s.get(t.session_id)?.date ?? null, label: t.label ?? null });
        }
        afterBy.set(row.room_id, a);
      }
    }
  }
  for (const g of Object.values(groups)) {
    g.rough = g.n < ROUGH_N;
    g.games.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : a.seq - b.seq));
    let sum = 0;
    g.trend = g.games.map((x) => { sum = addS(sum, addS(x.v, x.ex)); return { date: x.date, v: addS(x.v, x.ex), sum }; });
    g.games = g.games.filter((x) => x.hanchan_id !== null);
    g.vs = Object.values(g.vs);
  }
  return {
    ok: true, groups, skipped, unlinked: { ...pages[0].data.unlinked }, noRate, outRooms: outRooms.size,
    afterLeave: [...afterBy.values()].filter((a) => a.n > 0 || a.tables.length > 0),
  };
}
