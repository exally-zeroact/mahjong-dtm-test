/* league-round.mjs — ★A23 リーグの［次の対局］と次の半荘の人★（定め memory/mahjong_tataki_2026-11-20/l_sadame.md v1.3 §1 A23・§2・§3）
 * =============================================================================
 * 画面（gamen-room.mjs）と node 試験が同じ物を使う純関数。st＝その頁の st（リーグの頁は mj_read 'league'）。
 *
 * baseSeats(st, tableId, n) → { seats: [member_id…] | null, from: 'table' | 'hanchan' | null }
 *   土台の規則（他の卓との重なりは見ない）。卓＝tableId の鎖の最後の卓。
 *   ・卓の席（t.seats）が在る（1人以上）＝n 人・重ならない・全員名簿に居て active ならそれ。★正しくない時は前の半荘に戻らず null★（v1.2 止め1）
 *   ・卓の席が空＝鎖の取り消していない最後の半荘の席が、同じ条件ならそれ。でなければ null。
 *
 * nextSeats(st, tableId, n, { league }) → [member_id…] | null（null＝人を選ぶ）
 *   ・league !== true（ふつうの部屋）＝今の画面の lastSeats と同じ＝鎖の取り消していない最後の半荘の席（無ければ null）。
 *   ・league === true＝baseSeats の seats。その日の他の卓（tableChains の頭・自分の鎖を除く）の baseSeats と1人でも重なれば null。
 *     ★他の卓は土台の規則で見る（互いを見る輪にしない）★
 *   league の印は画面の lgSess（'league' の読みの日に league_id は無い＝lib は st から判じない・v1.1 止め3）。
 *
 * roundCheck(st, sessionId, picks) →
 *   { ok: true, ops: [{ op: 'table_seats', table_id, seats }…], notFull: [頭], open: [{ table_id: 頭, count }] }
 *   { ok: false, err: 'table', table_id } … picks の鍵がその日の卓の頭でない
 *   { ok: false, err: 'pick', table_id, member_id? } … 選んだ人が重なる・名簿に無い・外した人
 *   { ok: false, err: 'dup', member_id, tables: [頭, 頭] } … ★全部の卓★で同じ人が2つの卓に居る（v1 止め1）
 *   picks＝{ 頭の table_id: [member_id…] }。n 人そろった卓だけ選び直す。足りない卓（1人以上 n 人未満）は notFull・今のまま。
 *   重なりは、選び直した卓＝選んだ人／選び直さない卓＝baseSeats（null は見ない）で全部の卓を見る。
 *   ops＝選び直して今の卓の席と違う卓だけ、鎖の最後の卓へ table_seats（1つの組で送る）。
 *   open＝打ち途中の回（取り消していない・点がまだの席が在る）の数（その回の人は替わらない＝帯）。
 */
import { tableChain } from './room-state.mjs';
import { tableChains } from './league-rank.mjs';

const isArr = Array.isArray;

function chainLastOf(st, tableId) {
  const ch = tableChain(st, tableId);
  const id = ch.length ? ch[ch.length - 1] : tableId;
  return (st.tables || []).find((t) => t.table_id === id) || null;
}
function chainHanchans(st, tableId) {
  const ch = new Set(tableChain(st, tableId));
  return (st.hanchans || []).filter((h) => ch.has(h.table_id) && !h.voided);
}
/* n 人・重ならない・全員名簿に居て active */
function okSeats(st, seats, n) {
  if (!isArr(seats) || seats.length !== n || new Set(seats).size !== n) return false;
  return seats.every((m) => { const x = (st.members || []).find((y) => y.member_id === m); return !!x && x.active !== false; });
}
const nOf = (st, tableId) => { const t = chainLastOf(st, tableId); return t && t.rules && Number.isInteger(t.rules.players) ? t.rules.players : null; };

export function baseSeats(st, tableId, n) {
  const t = chainLastOf(st, tableId);
  if (!t) return { seats: null, from: null };
  if (isArr(t.seats) && t.seats.length > 0) return okSeats(st, t.seats, n) ? { seats: t.seats.slice(), from: 'table' } : { seats: null, from: null };
  const hs = chainHanchans(st, tableId);
  const last = hs.length ? hs[hs.length - 1] : null;
  return last && okSeats(st, last.seats, n) ? { seats: last.seats.slice(), from: 'hanchan' } : { seats: null, from: null };
}

export function nextSeats(st, tableId, n, opts = {}) {
  if (!opts || opts.league !== true) {
    const hs = chainHanchans(st, tableId);
    return hs.length ? hs[hs.length - 1].seats.slice() : null;
  }
  const b = baseSeats(st, tableId, n).seats;
  if (!b) return null;
  const t = (st.tables || []).find((x) => x.table_id === tableId);
  if (!t) return null;
  const mine = new Set(tableChain(st, tableId));
  for (const h of tableChains(st, t.session_id)) {
    if (mine.has(h)) continue;
    const hn = nOf(st, h);
    const o = hn === null ? null : baseSeats(st, h, hn).seats;
    if (o && o.some((m) => b.includes(m))) return null;
  }
  return b;
}

export function roundCheck(st, sessionId, picks) {
  const heads = tableChains(st, sessionId);
  const p = picks && typeof picks === 'object' ? picks : {};
  for (const k of Object.keys(p)) if (!heads.includes(k)) return { ok: false, err: 'table', table_id: k };
  const final = [], ops = [], notFull = [], open = [];
  for (const h of heads) {
    const n = nOf(st, h);
    const pk = isArr(p[h]) ? p[h] : [];
    const last = chainLastOf(st, h);
    if (n !== null && pk.length === n) {
      if (new Set(pk).size !== n) return { ok: false, err: 'pick', table_id: h };
      for (const m of pk) {
        const x = (st.members || []).find((y) => y.member_id === m);
        if (!x || x.active === false) return { ok: false, err: 'pick', table_id: h, member_id: m };
      }
      final.push([h, pk]);
      const cur = isArr(last.seats) ? last.seats : [];
      if (cur.length !== pk.length || cur.some((m, i) => m !== pk[i])) ops.push({ op: 'table_seats', table_id: last.table_id, seats: pk.slice() });
    } else {
      if (pk.length > 0) notFull.push(h);
      const b = n === null ? null : baseSeats(st, h, n).seats;
      if (b) final.push([h, b]);
    }
    const c = chainHanchans(st, h).filter((x) => isArr(x.cells) && x.cells.some((v) => v === null)).length;
    if (c) open.push({ table_id: h, count: c });
  }
  const where = new Map();
  for (const [h, seats] of final) {
    for (const m of seats) {
      if (where.has(m)) return { ok: false, err: 'dup', member_id: m, tables: [where.get(m), h] };
      where.set(m, h);
    }
  }
  return { ok: true, ops, notFull, open };
}
