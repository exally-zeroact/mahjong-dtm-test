/* room-state.mjs — ★部屋の中の状態（端末の写し）と、それから出す対局の1ページの数★（設計図 v18.3 §2・§3.0 K-1・§5）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。倉庫の mj_write が来るまでは、端末がこの状態を持ち、同じ op を
 * 未送信の並びに積む（来たら送るだけ）。★倉庫の答えが正★＝ここは同じ op を端末で先に当てた写し。
 *
 * op の形（mj_write の ops[] の1つ・麻雀 [813104] の直し4つを入れた形）：
 *   member_add    { member_id, name }                         … 同じそろえた字（name_key）の人がいれば err 'dup'（member_id を返す）
 *   session_add   { session_id, date, rate }                  … rate＝null か 10 の倍数（ルールの既定を写す）
 *   table_add     { table_id, session_id, rules }             … rules は卓を作った時のルール（rulesOk を通した物）
 *   hanchan_start { hanchan_id, table_id, seats:[member_id], cells:[素点], order?, lost?, tobi_to? }
 *   cell_set      { hanchan_id, seat, value, base_version }   … 版が違えば conflict（同じ値なら成功）
 *   hanchan_order { hanchan_id, order, base_version }
 *   kyotaku_set   { hanchan_id, value, base_version }
 *   tobi_set      { hanchan_id, seat, to, base_version }      … to＝受け取る席か 'all'
 *   hanchan_void  { hanchan_id } ／ hanchan_unvoid { hanchan_id }
 *   extra_set     { table_id, member_id, kind, value, base_version } … kind＝'chip'|'shugi'
 *   extra_add     { table_id, member_id, kind, add }          … 版なし（倉庫が足す）
 * 返し：{ ok: true } ／ { ok: false, err: 'conflict', at, cur: { value, version } } ／ { ok: false, err: 'range'|'bad'|'dup'|'gone', … }
 */
import { rulesOk } from './rules.mjs';
import { nameKey } from './name-key.mjs';
import { hanchanPt, tobiPt } from './hanchan-pt.mjs';
import { needsOrder } from './needs-order.mjs';
import { seisan } from './seisan.mjs';

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const CELL_MAX = 999900; // 素点の範囲（±・100点単位）

export function emptyState() {
  return { members: [], sessions: [], tables: [], hanchans: [], extras: [], settles: [] };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

function find(list, key, id) { return list.find((x) => x[key] === id); }

/* 版つきの値を書く（同じ値なら版を上げずに成功） */
function setVer(obj, field, verField, value, base, at) {
  const cur = obj[field], v = obj[verField] || 0;
  if (JSON.stringify(cur) === JSON.stringify(value)) return { ok: true };
  if (base !== v) return { ok: false, err: 'conflict', at, cur: { value: cur, version: v } };
  obj[field] = value; obj[verField] = v + 1;
  return { ok: true };
}

/* st を直接書き換える（呼ぶ側が写しを作る）。 */
export function applyOp(st, op) {
  if (!op || typeof op !== 'object' || !isStr(op.op)) return { ok: false, err: 'bad' };
  switch (op.op) {
    case 'member_add': {
      if (!isStr(op.member_id) || !isStr(op.name) || op.name.trim().length === 0 || op.name.length > 20) return { ok: false, err: 'range', at: 'name' };
      if (find(st.members, 'member_id', op.member_id)) return { ok: true };
      const key = nameKey(op.name);
      const same = st.members.find((m) => m.name_key === key);
      if (same) return { ok: false, err: 'dup', member_id: same.member_id, name: same.name, active: same.active };
      st.members.push({ member_id: op.member_id, name: op.name.trim(), name_key: key, active: true });
      return { ok: true };
    }
    case 'session_add': {
      if (!isStr(op.session_id) || !isStr(op.date)) return { ok: false, err: 'bad' };
      if (op.rate !== null && !(isInt(op.rate) && op.rate >= 10 && op.rate <= 100000 && op.rate % 10 === 0)) return { ok: false, err: 'range', at: 'rate' };
      if (!find(st.sessions, 'session_id', op.session_id)) st.sessions.push({ session_id: op.session_id, date: op.date, rate: op.rate });
      return { ok: true };
    }
    case 'table_add': {
      if (!isStr(op.table_id) || !find(st.sessions, 'session_id', op.session_id)) return { ok: false, err: 'bad' };
      const r = rulesOk(op.rules);
      if (!r.ok) return { ok: false, err: 'range', at: r.err };
      if (!find(st.tables, 'table_id', op.table_id)) st.tables.push({ table_id: op.table_id, session_id: op.session_id, rules: r.rules });
      return { ok: true };
    }
    case 'hanchan_start': {
      const t = find(st.tables, 'table_id', op.table_id);
      if (!isStr(op.hanchan_id) || !t) return { ok: false, err: 'bad' };
      if (find(st.hanchans, 'hanchan_id', op.hanchan_id)) return { ok: true };
      const n = t.rules.players;
      if (!Array.isArray(op.seats) || op.seats.length !== n || new Set(op.seats).size !== n || !op.seats.every((m) => find(st.members, 'member_id', m))) return { ok: false, err: 'bad', at: 'seats' };
      if (!Array.isArray(op.cells) || op.cells.length !== n || !op.cells.every((v) => isInt(v) && v % 100 === 0 && Math.abs(v) <= CELL_MAX)) return { ok: false, err: 'range', at: 'cells' };
      const no = st.hanchans.filter((h) => h.table_id === t.table_id).length + 1;
      st.hanchans.push({
        hanchan_id: op.hanchan_id, table_id: t.table_id, no, seats: op.seats.slice(),
        cells: op.cells.slice(), cell_ver: new Array(n).fill(0),
        order: op.order || null, order_ver: 0, lost: op.lost || 0, lost_ver: 0,
        tobi_to: op.tobi_to ? { ...op.tobi_to } : {}, tobi_ver: {}, voided: false,
      });
      return { ok: true };
    }
    case 'cell_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      if (!isInt(op.seat) || op.seat < 0 || op.seat >= h.cells.length) return { ok: false, err: 'bad' };
      if (!isInt(op.value) || op.value % 100 !== 0 || Math.abs(op.value) > CELL_MAX) return { ok: false, err: 'range', at: 'value' };
      const cur = h.cells[op.seat], v = h.cell_ver[op.seat];
      if (cur === op.value) return { ok: true };
      if (op.base_version !== v) return { ok: false, err: 'conflict', at: { hanchan_id: h.hanchan_id, seat: op.seat }, cur: { value: cur, version: v } };
      h.cells[op.seat] = op.value; h.cell_ver[op.seat] = v + 1;
      return { ok: true };
    }
    case 'hanchan_order': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      const n = h.cells.length;
      if (!Array.isArray(op.order) || op.order.length !== n || new Set(op.order).size !== n || !op.order.every((x) => isInt(x) && x >= 0 && x < n)) return { ok: false, err: 'range', at: 'order' };
      return setVer(h, 'order', 'order_ver', op.order.slice(), op.base_version, { hanchan_id: h.hanchan_id, what: 'order' });
    }
    case 'kyotaku_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      if (!isInt(op.value) || op.value < 0 || op.value % 100 !== 0 || op.value > CELL_MAX) return { ok: false, err: 'range', at: 'lost' };
      return setVer(h, 'lost', 'lost_ver', op.value, op.base_version, { hanchan_id: h.hanchan_id, what: 'lost' });
    }
    case 'tobi_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h || !isInt(op.seat) || op.seat < 0 || op.seat >= h.cells.length) return { ok: false, err: 'bad' };
      const okTo = op.to === 'all' || op.to === null || (isInt(op.to) && op.to >= 0 && op.to < h.cells.length && op.to !== op.seat);
      if (!okTo) return { ok: false, err: 'range', at: 'to' };
      const k = String(op.seat);
      const cur = h.tobi_to[k] === undefined ? null : h.tobi_to[k], v = h.tobi_ver[k] || 0;
      if (cur === op.to) return { ok: true };
      if (op.base_version !== v) return { ok: false, err: 'conflict', at: { hanchan_id: h.hanchan_id, what: 'tobi', seat: op.seat }, cur: { value: cur, version: v } };
      if (op.to === null) delete h.tobi_to[k]; else h.tobi_to[k] = op.to;
      h.tobi_ver[k] = v + 1;
      return { ok: true };
    }
    case 'hanchan_void': case 'hanchan_unvoid': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      h.voided = op.op === 'hanchan_void';
      return { ok: true };
    }
    case 'extra_set': case 'extra_add': {
      if (!find(st.tables, 'table_id', op.table_id) || !find(st.members, 'member_id', op.member_id)) return { ok: false, err: 'bad' };
      if (op.kind !== 'chip' && op.kind !== 'shugi') return { ok: false, err: 'bad' };
      let e = st.extras.find((x) => x.table_id === op.table_id && x.member_id === op.member_id && x.kind === op.kind);
      if (!e) { e = { table_id: op.table_id, member_id: op.member_id, kind: op.kind, value: 0, version: 0 }; st.extras.push(e); }
      if (op.op === 'extra_add') {
        if (!isInt(op.add) || op.add === 0 || Math.abs(op.add) > 999) return { ok: false, err: 'range', at: 'add' };
        const nv = e.value + op.add;
        if (Math.abs(nv) > 9999) return { ok: false, err: 'range', at: 'add' };
        e.value = nv; e.version++;
        return { ok: true };
      }
      if (!isInt(op.value) || Math.abs(op.value) > 9999) return { ok: false, err: 'range', at: 'value' };
      if (e.value === op.value) return { ok: true };
      if (op.base_version !== e.version) return { ok: false, err: 'conflict', at: { table_id: op.table_id, member_id: op.member_id, kind: op.kind }, cur: { value: e.value, version: e.version } };
      e.value = op.value; e.version++;
      return { ok: true };
    }
    case 'settle_snap': {
      // 締め＝その時の精算の中身を残す（設計図 §3 settle_snaps）。rev は開催日ごとに 1,2,3…＝違えば重なり
      if (!find(st.sessions, 'session_id', op.session_id)) return { ok: false, err: 'bad' };
      if (!st.settles) st.settles = [];
      const mine = st.settles.filter((x) => x.session_id === op.session_id);
      if (!isInt(op.rev) || !isStr(op.at) || !op.snap || typeof op.snap !== 'object' || Array.isArray(op.snap)) return { ok: false, err: 'bad' };
      if (JSON.stringify(op.snap).length > 32768) return { ok: false, err: 'range', at: 'snap' };
      if (mine.some((x) => x.rev === op.rev)) return { ok: true };
      if (op.rev !== mine.length + 1) return { ok: false, err: 'conflict', at: { session_id: op.session_id, what: 'settle' }, cur: { value: null, version: mine.length } };
      st.settles.push({ session_id: op.session_id, rev: op.rev, at: op.at, snap: clone(op.snap) });
      return { ok: true };
    }
    default:
      return { ok: false, err: 'bad', at: 'op' };
  }
}

/* 1つの mj_write の呼び（ops の組）を丸ごと当てる＝どれか1つでも弾かれたら組ごと当てない（倉庫の取引と同じ） */
export function applyOps(st, ops) {
  const next = clone(st);
  for (let i = 0; i < ops.length; i++) {
    const r = applyOp(next, ops[i]);
    if (!r.ok) return { ok: false, idx: i, res: r, state: st };
  }
  return { ok: true, state: next };
}

/* ── 1つの半荘の答え（pt と飛び賞・入っていない訳） ── */
export function hanchanView(rules, h) {
  const order = h.order || undefined;
  const g = hanchanPt(rules, h.cells, { order, lost: h.lost });
  if (!g.ok) {
    if (g.err === 'sum') return { ok: false, why: 'sum', diff: g.got - g.want };
    if (g.err === 'order') return { ok: false, why: 'order' };
    return { ok: false, why: g.err };
  }
  const tb = tobiPt(rules, h.cells, { to: h.tobi_to });
  if (!tb.ok) return { ok: false, why: tb.err === 'pending' ? 'tobi' : 'tobi_' + tb.err, seats: tb.seats, pt10: g.pt10, rank: g.rank };
  return { ok: true, pt10: g.pt10, rank: g.rank, tobi10: tb.pt10, busted: tb.busted };
}

/* ── 卓の1ページの数 ── */
export function tableView(st, tableId) {
  const t = find(st.tables, 'table_id', tableId);
  if (!t) return null;
  const s = find(st.sessions, 'session_id', t.session_id);
  const R = t.rules, rate = s ? s.rate : null;
  const hs = st.hanchans.filter((h) => h.table_id === tableId);
  const people = [];
  const see = (m) => { if (!people.includes(m)) people.push(m); };
  for (const h of hs) if (!h.voided) h.seats.forEach(see);
  for (const e of st.extras) if (e.table_id === tableId && e.value !== 0) see(e.member_id);
  const name = (m) => { const x = find(st.members, 'member_id', m); return x ? x.name : '?'; };
  const total10 = Object.fromEntries(people.map((m) => [m, 0]));
  const rows = [];
  const complete = [];
  const missing = [];
  for (const h of hs) {
    const v = h.voided ? { ok: false, why: 'void' } : hanchanView(R, h);
    const cellsBy = {};
    h.seats.forEach((m, i) => { cellsBy[m] = { cell: h.cells[i], pt10: v.pt10 ? v.pt10[i] + (v.tobi10 ? v.tobi10[i] : 0) : null, rank: v.rank ? v.rank[i] : null, seat: i }; });
    rows.push({ hanchan_id: h.hanchan_id, no: h.no, voided: h.voided, ok: v.ok, why: v.ok ? null : v.why, diff: v.diff, seats: v.seats, by: cellsBy });
    if (v.ok) {
      h.seats.forEach((m, i) => { total10[m] += v.pt10[i] + v.tobi10[i]; });
      complete.push({ members: h.seats.slice(), pt10: v.pt10, tobi10: v.tobi10 });
    } else if (!h.voided) missing.push({ no: h.no, why: v.why, diff: v.diff });
  }
  const used = { chip: R.chip_pt10 !== null, shugi: R.shugi_pt10 !== null };
  const ex = { chip: {}, shugi: {} };
  for (const e of st.extras) if (e.table_id === tableId) ex[e.kind][e.member_id] = e.value;
  const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const chipSum = used.chip ? sumOf(ex.chip) : 0;
  const shugiSum = used.shugi ? sumOf(ex.shugi) : 0;
  const extrasOk = chipSum === 0 && shugiSum === 0;
  const toBig = (pt10) => (rate === null ? pt10 : pt10 * (rate / 10));
  const windows = people.map((m) => {
    const chip = used.chip ? (ex.chip[m] || 0) : 0, shugi = used.shugi ? (ex.shugi[m] || 0) : 0;
    const extra10 = chip * (R.chip_pt10 || 0) + shugi * (R.shugi_pt10 || 0);
    const pt10 = total10[m] + (extrasOk ? extra10 : 0);
    return {
      member_id: m, name: name(m), pt10, big: toBig(pt10), unit: rate === null ? 'pt' : 'ten', dim: !extrasOk,
      chip, shugi, chipBig: toBig(chip * (R.chip_pt10 || 0)), shugiBig: toBig(shugi * (R.shugi_pt10 || 0)),
      hanPt10: total10[m], chipPt10: chip * (R.chip_pt10 || 0), shugiPt10: shugi * (R.shugi_pt10 || 0),
    };
  });
  if (!extrasOk) {
    if (chipSum !== 0) missing.push({ what: 'chip', diff: chipSum });
    if (shugiSum !== 0) missing.push({ what: 'shugi', diff: shugiSum });
  }
  const tableForSeisan = {
    rate, chip_pt10: R.chip_pt10, shugi_pt10: R.shugi_pt10, hanchans: complete,
    chips: used.chip && chipSum === 0 ? { ...ex.chip } : undefined,
    shugis: used.shugi && shugiSum === 0 ? { ...ex.shugi } : undefined,
  };
  return {
    table_id: tableId, rules: R, rate, date: s ? s.date : null, people: people.map((m) => ({ member_id: m, name: name(m) })),
    rows, total10, windows, used, chipSum, shugiSum, extrasOk, missing, tableForSeisan,
    nextNo: hs.length + 1,
  };
}

/* ── 開催日の精算（そろった半荘とそろった卓のチップ・祝儀だけ） ── */
export function sessionSeisan(st, sessionId) {
  const ts = st.tables.filter((t) => t.session_id === sessionId);
  const views = ts.map((t) => tableView(st, t.table_id));
  const res = seisan(views.map((v) => v.tableForSeisan));
  const name = (m) => { const x = find(st.members, 'member_id', m); return x ? x.name : '?'; };
  return { ...res, name, missing: views.flatMap((v, i) => v.missing.map((x) => ({ table: i + 1, ...x }))), noRateTables: views.map((v, i) => (v.rate === null ? i + 1 : null)).filter((x) => x !== null) };
}

/* ── 入れる前の確かめ（画面が半荘を入れる時に使う） ── */
export function checkEntry(rules, cells, lost = 0) {
  const g = hanchanPt(rules, cells, { order: [...Array(rules.players).keys()], lost });
  if (!g.ok && g.err === 'sum') return { ok: false, why: 'sum', diff: g.got - g.want };
  if (!g.ok) return { ok: false, why: g.err };
  const need = needsOrder(rules, cells);
  const tb = tobiPt(rules, cells, {});
  return { ok: true, needOrder: need.includes('tie'), busted: tb.ok ? tb.busted : tb.seats || [] };
}
