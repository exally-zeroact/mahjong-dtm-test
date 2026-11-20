/* room-state.mjs — ★部屋の中の状態（端末の写し）と、それから出す対局の1ページの数★（設計図 v18.3 §2・§3.0 K-1・§5）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。倉庫の mj_write が来るまでは、端末がこの状態を持ち、同じ op を
 * 未送信の並びに積む（来たら送るだけ）。★倉庫の答えが正★＝ここは同じ op を端末で先に当てた写し。
 * ★op の形・範囲・版は倉庫の取り決め（memory/mahjong_tataki_2026-11-20/write_sekkei.md §3・§4・§6 v5.2）に合わせる★
 * 　画面側の紙＝gamen_write_awase_v1.md の v4・v5 節。範囲の表＝tests/fixtures/write-cases.json（倉庫の試験も読める）。
 *
 * op 12個（知らない op・知らない引数の鍵は bad）：
 *   member_add    { member_id, name }                  … trim の後 1〜20字・active で同じ name_key → dup（member_id を返す）
 *   session_add   { session_id, date, rate, place? }   … rate＝null か 10〜100,000 の10の倍数・place 40字まで
 *   table_add     { table_id, session_id, label }      … label 1〜20字・ルールは op で送らない＝写しの st.rules（画面が置く）を写す
 *   hanchan_start { hanchan_id, table_id, seats:[member_id], cells, ton_order?:[member_id], lost?, tobi_to? }
 *   cell_set      { hanchan_id, seat, value, base_version }        … cell_ver[seat]
 *   hanchan_order { hanchan_id, ton_order, base_version }          … order_version
 *   kyotaku_set   { hanchan_id, value, base_version }              … version（void・unvoid でも上がる）
 *   tobi_set      { hanchan_id, tobi_to, base_version }            … tobi_version・まるごと置き換え
 *   hanchan_void  { hanchan_id } ／ hanchan_unvoid { hanchan_id }  … 同じ値なら書かずに ok・違えば version+1
 *   extra_add     { table_id, member_id, kind, add }               … add ±1〜999・合計 ±999・版は見ない
 *   settle_snap   { session_id, rev, content, used, missing }      … at は写しでは applyOps の opts.now
 * 版は作った時1。返し：{ ok: true } ／ { ok: false, err: 'conflict', at, cur: { value, version } } ／ { ok: false, err: 'range'|'bad'|'dup'|'too_many', … }
 */
import { rulesOk } from './rules.mjs';
import { nameKey } from './name-key.mjs';
import { hanchanPt, tobiPt } from './hanchan-pt.mjs';
import { needsOrder } from './needs-order.mjs';
import { seisan } from './seisan.mjs';

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const CELL_MAX = 200000;  // 素点 ±200,000（100点単位・倉庫 schema:217）
export const LOST_MAX = 20000;   // 消えた供託 0〜20,000 の1000の倍数（kieru の時だけ非0・schema:201）
export const EXTRA_MAX = 999;    // チップ・祝儀の1回の足しと合計 ±999
export const OPS_MAX = 30;       // 1つの組の op の数（超えたら too_many＝倉庫 §2 段1）
export const SNAP_MAX = 32768;   // settle_snap の content・used・missing の合わせた UTF-8 のバイト数。★写しは空白の無い JSON で数えるので倉庫より短く数える（鍵が多いほど差が開く）＝写しが通しても倉庫が range を返す事がある★（write2_sekkei.md §5）

const KEYS = {
  member_add: ['member_id', 'name'],
  session_add: ['session_id', 'date', 'rate', 'place'],
  table_add: ['table_id', 'session_id', 'label'],
  hanchan_start: ['hanchan_id', 'table_id', 'seats', 'cells', 'ton_order', 'lost', 'tobi_to'],
  cell_set: ['hanchan_id', 'seat', 'value', 'base_version'],
  hanchan_order: ['hanchan_id', 'ton_order', 'base_version'],
  kyotaku_set: ['hanchan_id', 'value', 'base_version'],
  tobi_set: ['hanchan_id', 'tobi_to', 'base_version'],
  hanchan_void: ['hanchan_id'],
  hanchan_unvoid: ['hanchan_id'],
  extra_add: ['table_id', 'member_id', 'kind', 'add'],
  settle_snap: ['session_id', 'rev', 'content', 'used', 'missing'],
};
export const OP_NAMES = Object.keys(KEYS);

export function emptyState() {
  return { v: 2, members: [], sessions: [], tables: [], hanchans: [], extras: [], settles: [] };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
function find(list, key, id) { return list.find((x) => x[key] === id); }
/* 鍵の順に左右されない比べ（tobi_to・settle_snap の中身） */
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (isObj(x)) return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}
const cellOk = (v) => isInt(v) && v % 100 === 0 && Math.abs(v) <= CELL_MAX;
export function lostOk(rules, v) {
  if (!isInt(v) || v < 0 || v > LOST_MAX || v % 1000 !== 0) return false;
  return v === 0 || rules.kyotaku_end === 'kieru';
}
/* mj_tobi_ok と同じ形：鍵 '0'〜n−1・値は鍵と違う 0〜n−1 の整数か 'all'（飛んでいない席の鍵も弾かない） */
export function tobiShapeOk(t, n) {
  if (!isObj(t)) return false;
  return Object.keys(t).every((k) => {
    if (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= n) return false;
    const v = t[k];
    return v === 'all' || (isInt(v) && v >= 0 && v < n && v !== Number(k));
  });
}
/* ton_order が seats と同じ顔ぶれか */
function sameMembers(a, seats) {
  return Array.isArray(a) && a.length === seats.length && new Set(a).size === a.length && a.every((m) => seats.includes(m));
}
/* lib へ渡す時だけ席の番号に直す */
export function orderIdx(h) { return h.ton_order ? h.ton_order.map((m) => h.seats.indexOf(m)) : null; }
/* 飛んだ席（lib の tobiPt と同じ判じ） */
export function bustedSeats(rules, cells) {
  if (rules.tobi !== true) return [];
  const b = [];
  cells.forEach((v, s) => { if (v < 0 || (rules.tobi_zero === true && v === 0)) b.push(s); });
  return b;
}
const conflict = (at, value, version) => ({ ok: false, err: 'conflict', at, cur: { value, version } });

/* st を直接書き換える（呼ぶ側が写しを作る）。opts.now＝settle_snap の at（倉庫の now() の代わり） */
export function applyOp(st, op, opts = {}) {
  if (!isObj(op) || !isStr(op.op) || !Object.hasOwn(KEYS, op.op)) return { ok: false, err: 'bad', at: 'op' };
  const allow = KEYS[op.op];
  for (const k of Object.keys(op)) if (k !== 'op' && !allow.includes(k)) return { ok: false, err: 'bad', at: k };
  switch (op.op) {
    case 'member_add': {
      if (!isStr(op.member_id) || typeof op.name !== 'string') return { ok: false, err: 'bad' };
      const nm = op.name.trim();
      const len = [...nm].length; // 倉庫の char_length と同じ（コードポイント）
      if (len === 0 || len > 20) return { ok: false, err: 'range', at: 'name' };
      if (find(st.members, 'member_id', op.member_id)) return { ok: true };
      const key = nameKey(nm);
      const same = st.members.find((m) => m.active && m.name_key === key);
      if (same) return { ok: false, err: 'dup', member_id: same.member_id, name: same.name };
      st.members.push({ member_id: op.member_id, name: nm, name_key: key, active: true });
      return { ok: true };
    }
    case 'session_add': {
      if (!isStr(op.session_id) || !isStr(op.date) || !('rate' in op)) return { ok: false, err: 'bad' };
      if (op.rate !== null && !(isInt(op.rate) && op.rate >= 10 && op.rate <= 100000 && op.rate % 10 === 0)) return { ok: false, err: 'range', at: 'rate' };
      if (op.place !== undefined && op.place !== null && (typeof op.place !== 'string' || [...op.place].length > 40)) return { ok: false, err: 'range', at: 'place' };
      if (find(st.sessions, 'session_id', op.session_id)) return { ok: true };
      const s = { session_id: op.session_id, date: op.date, rate: op.rate };
      if (isStr(op.place)) s.place = op.place;
      st.sessions.push(s);
      return { ok: true };
    }
    case 'table_add': {
      if (!isStr(op.table_id) || typeof op.label !== 'string') return { ok: false, err: 'bad' };
      if (find(st.tables, 'table_id', op.table_id)) return { ok: true };
      const s = find(st.sessions, 'session_id', op.session_id);
      if (!s || s.voided) return { ok: false, err: 'bad' };
      if ([...op.label].length < 1 || [...op.label].length > 20) return { ok: false, err: 'range', at: 'label' };
      const r = rulesOk(st.rules);
      if (!r.ok) return { ok: false, err: 'bad', at: 'rules' }; // 倉庫では「部屋のルールが無い」
      st.tables.push({ table_id: op.table_id, session_id: s.session_id, label: op.label, rules: r.rules });
      return { ok: true };
    }
    case 'hanchan_start': {
      if (!isStr(op.hanchan_id)) return { ok: false, err: 'bad' };
      if (find(st.hanchans, 'hanchan_id', op.hanchan_id)) return { ok: true };
      const t = find(st.tables, 'table_id', op.table_id);
      if (!t || t.voided) return { ok: false, err: 'bad' };
      const R = t.rules, n = R.players;
      if (!Array.isArray(op.seats) || op.seats.length !== n || new Set(op.seats).size !== n || !op.seats.every((m) => { const x = find(st.members, 'member_id', m); return x && x.active; })) return { ok: false, err: 'bad', at: 'seats' };
      if (!Array.isArray(op.cells) || op.cells.length !== n || !op.cells.every(cellOk)) return { ok: false, err: 'range', at: 'cells' };
      const lost = op.lost === undefined || op.lost === null ? 0 : op.lost;
      if (!lostOk(R, lost)) return { ok: false, err: 'range', at: 'lost' };
      if (op.ton_order !== undefined && op.ton_order !== null && !sameMembers(op.ton_order, op.seats)) return { ok: false, err: 'bad', at: 'ton_order' };
      const tobi = op.tobi_to === undefined || op.tobi_to === null ? {} : op.tobi_to;
      if (!tobiShapeOk(tobi, n)) return { ok: false, err: 'bad', at: 'tobi_to' };
      const no = st.hanchans.filter((h) => h.table_id === t.table_id).length + 1;
      st.hanchans.push({
        hanchan_id: op.hanchan_id, table_id: t.table_id, no, seats: op.seats.slice(),
        cells: op.cells.slice(), cell_ver: new Array(n).fill(1),
        ton_order: op.ton_order ? op.ton_order.slice() : null, order_version: 1,
        lost, version: 1, tobi_to: { ...tobi }, tobi_version: 1, voided: false,
      });
      return { ok: true };
    }
    case 'cell_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h || !isInt(op.seat) || op.seat < 0 || op.seat >= h.cells.length) return { ok: false, err: 'bad' };
      if (!cellOk(op.value)) return { ok: false, err: 'range', at: 'value' };
      const cur = h.cells[op.seat], v = h.cell_ver[op.seat];
      if (cur === op.value) return { ok: true };
      if (op.base_version !== v) return conflict({ hanchan_id: h.hanchan_id, seat: op.seat }, cur, v);
      h.cells[op.seat] = op.value; h.cell_ver[op.seat] = v + 1;
      return { ok: true };
    }
    case 'hanchan_order': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      if (!sameMembers(op.ton_order, h.seats)) return { ok: false, err: 'bad', at: 'ton_order' };
      if (canon(h.ton_order) === canon(op.ton_order)) return { ok: true };
      if (op.base_version !== h.order_version) return conflict({ hanchan_id: h.hanchan_id, what: 'order' }, h.ton_order, h.order_version);
      h.ton_order = op.ton_order.slice(); h.order_version++;
      return { ok: true };
    }
    case 'kyotaku_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      const t = find(st.tables, 'table_id', h.table_id);
      if (!lostOk(t.rules, op.value)) return { ok: false, err: 'range', at: 'value' };
      if (h.lost === op.value) return { ok: true };
      if (op.base_version !== h.version) return conflict({ hanchan_id: h.hanchan_id, what: 'lost' }, h.lost, h.version);
      h.lost = op.value; h.version++;
      return { ok: true };
    }
    case 'tobi_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      if (!tobiShapeOk(op.tobi_to, h.cells.length)) return { ok: false, err: 'bad', at: 'tobi_to' };
      if (canon(h.tobi_to) === canon(op.tobi_to)) return { ok: true };
      if (op.base_version !== h.tobi_version) return conflict({ hanchan_id: h.hanchan_id, what: 'tobi' }, h.tobi_to, h.tobi_version);
      h.tobi_to = { ...op.tobi_to }; h.tobi_version++;
      return { ok: true };
    }
    case 'hanchan_void': case 'hanchan_unvoid': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      const want = op.op === 'hanchan_void';
      if (h.voided === want) return { ok: true };
      h.voided = want; h.version++;
      return { ok: true };
    }
    case 'extra_add': {
      const t = find(st.tables, 'table_id', op.table_id);
      if (!t || !isStr(op.member_id) || (op.kind !== 'chip' && op.kind !== 'shugi')) return { ok: false, err: 'bad' };
      if (!isInt(op.add) || op.add === 0 || Math.abs(op.add) > EXTRA_MAX) return { ok: false, err: 'range', at: 'add' };
      const seated = st.hanchans.some((h) => h.table_id === t.table_id && !h.voided && h.seats.includes(op.member_id));
      const hasRow = st.extras.some((x) => x.table_id === t.table_id && x.member_id === op.member_id);
      if (!seated && !hasRow) return { ok: false, err: 'bad', at: 'member_id' };
      const e = st.extras.find((x) => x.table_id === op.table_id && x.member_id === op.member_id && x.kind === op.kind);
      const nv = (e ? e.value : 0) + op.add;
      const was = e ? e.value : 0; // 古い写しの ±999 の外の行は 0 に近づく向きだけ通す（直せなくしない）
      if (Math.abs(nv) > EXTRA_MAX && !(Math.abs(was) > EXTRA_MAX && Math.abs(nv) < Math.abs(was))) return { ok: false, err: 'range', at: 'add' };
      if (e) { e.value = nv; e.version++; } else st.extras.push({ table_id: op.table_id, member_id: op.member_id, kind: op.kind, value: nv, version: 1 });
      return { ok: true };
    }
    case 'settle_snap': {
      // 締め＝その時の精算の中身を残す。rev は開催日ごとに 1,2,3…（今の最大＋1 でなければ conflict・同じ rev で同じ中身は ok）
      if (!find(st.sessions, 'session_id', op.session_id)) return { ok: false, err: 'bad' };
      if (!isInt(op.rev) || !isObj(op.content) || !isObj(op.used) || !Array.isArray(op.missing)) return { ok: false, err: 'bad' };
      if (new TextEncoder().encode(JSON.stringify([op.content, op.used, op.missing])).length > SNAP_MAX) return { ok: false, err: 'range', at: 'content' };
      if (!st.settles) st.settles = [];
      const mine = st.settles.filter((x) => x.session_id === op.session_id);
      const max = mine.reduce((a, x) => Math.max(a, x.rev), 0);
      const same = mine.find((x) => x.rev === op.rev);
      if (same) {
        if (canon([same.content, same.used, same.missing]) === canon([op.content, op.used, op.missing])) return { ok: true };
        return conflict({ session_id: op.session_id, what: 'settle' }, null, max);
      }
      if (op.rev !== max + 1) return conflict({ session_id: op.session_id, what: 'settle' }, null, max);
      st.settles.push({ session_id: op.session_id, rev: op.rev, at: opts.now || new Date().toISOString(), content: clone(op.content), used: clone(op.used), missing: clone(op.missing) });
      return { ok: true };
    }
  }
  return { ok: false, err: 'bad', at: 'op' };
}

/* 1つの mj_write の呼び（ops の組）を丸ごと当てる＝どれか1つでも弾かれたら組ごと当てない（倉庫の取引と同じ）
 * 組の終わりに §4 の「飛びの古い受け取り」を消す：触った半荘ごとに、組の初めに飛んでいなかった席が終わりに飛んでいて、
 * tobi_to にその席の鍵が在り、組に同じ半荘の tobi_set も hanchan_start も無い時だけ、その鍵を消して tobi_version+1 */
export function applyOps(st, ops, opts = {}) {
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, idx: 0, res: { ok: false, err: 'bad' }, state: st };
  if (ops.length > OPS_MAX) return { ok: false, idx: OPS_MAX, res: { ok: false, err: 'too_many' }, state: st };
  const next = clone(st);
  const before = new Map(next.hanchans.map((h) => [h.hanchan_id, h.cells.slice()]));
  const touched = new Set(), whole = new Set();
  for (let i = 0; i < ops.length; i++) {
    const r = applyOp(next, ops[i], opts);
    if (!r.ok) return { ok: false, idx: i, res: { ...r, i }, state: st };
    const o = ops[i];
    if (o.hanchan_id) touched.add(o.hanchan_id);
    if (o.op === 'tobi_set' || o.op === 'hanchan_start') whole.add(o.hanchan_id);
  }
  for (const hid of touched) {
    if (whole.has(hid) || !before.has(hid)) continue;
    const h = find(next.hanchans, 'hanchan_id', hid);
    const t = find(next.tables, 'table_id', h.table_id);
    const was = bustedSeats(t.rules, before.get(hid)), now = bustedSeats(t.rules, h.cells);
    let drop = false;
    for (const s of now) if (!was.includes(s) && h.tobi_to[String(s)] !== undefined) { delete h.tobi_to[String(s)]; drop = true; }
    if (drop) h.tobi_version++;
  }
  return { ok: true, state: next };
}

/* 直す画面の tobi_set（v5 止め1）：tobi_set を抜いた組 ops を一度写しに当て（§4 の鍵消しの後）、その tobi_to と
 * want（直した後の飛んだ席の鍵だけ）を比べ、違う時だけ tobi_set を返す（同じなら null）＝また飛んで同じ人を選んだ時も
 * 「前と同じ」で送らずに倉庫に鍵を消される事が無い。base_version は組の前の tobi_version（組に tobi_set が入れば鍵消しは起きない） */
export function tobiSetOp(st, ops, hanchanId, want) {
  const h = find(st.hanchans, 'hanchan_id', hanchanId);
  if (!h) return null;
  const trial = ops.length ? applyOps(st, ops) : { ok: true, state: st };
  const th = trial.ok ? find(trial.state.hanchans, 'hanchan_id', hanchanId) : h;
  if (canon(th.tobi_to) === canon(want)) return null;
  return { op: 'tobi_set', hanchan_id: hanchanId, tobi_to: { ...want }, base_version: h.tobi_version };
}

/* ── 古い形の写し（st.v が 2 でない＝cell_ver 0始まり・order・lost_ver・席ごとの tobi_ver・settles の snap）を新しい形へ ──
 * v3：op を並べ直さない＝形だけ直し、値は1つも変えない（範囲の外もそのまま・常に保存）。needs_upload を付ける＝
 * 写しに在って倉庫に無い物を作るのは 2d（mj_read で見比べてから・範囲と卓のルールを確かめ・30個ごと）。
 * 返し：{ st, migrated }＝migrated の時、呼ぶ側は古い並びを捨て、★並びを先に保存してから写しを保存★する（home は保存しない）。 */
export function migrateState(st0) {
  if (!isObj(st0)) return { st: emptyState(), migrated: false };
  if (st0.v === 2) return { st: st0, migrated: false };
  const st = clone(st0);
  for (const k of ['members', 'sessions', 'tables', 'hanchans', 'extras', 'settles']) if (!Array.isArray(st[k])) st[k] = [];
  const perSession = {};
  for (const t of st.tables) {
    perSession[t.session_id] = (perSession[t.session_id] || 0) + 1;
    if (typeof t.label !== 'string') t.label = '卓' + perSession[t.session_id];
  }
  for (const h of st.hanchans) {
    h.cell_ver = h.cells.map(() => 1);
    h.ton_order = Array.isArray(h.order) ? h.order.map((i) => h.seats[i]) : (h.ton_order || null);
    h.order_version = 1;
    h.version = h.voided ? 2 : 1;
    const tt = {};
    for (const [k, v] of Object.entries(h.tobi_to || {})) if (v !== null && v !== undefined) tt[k] = v;
    h.tobi_to = tt; h.tobi_version = 1;
    if (!isInt(h.lost)) h.lost = 0;
    delete h.order; delete h.order_ver; delete h.lost_ver; delete h.tobi_ver;
  }
  for (const e of st.extras) e.version = 1;
  st.settles = st.settles.map((x) => ({ session_id: x.session_id, rev: x.rev, at: x.at, content: x.content || x.snap || {}, used: x.used || null, missing: Array.isArray(x.missing) ? x.missing : [] }));
  st.v = 2;
  st.needs_upload = st.members.length + st.sessions.length > 0;
  return { st, migrated: true };
}

/* ── 1つの半荘の答え（pt と飛び賞・入っていない訳） ── */
export function hanchanView(rules, h) {
  const order = orderIdx(h) || undefined;
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
/* 部屋を開いた時に続ける開催（司さん 11-20 19時「時間にすんなや・清算押したらその対局が終わる・常に保存が普通」）
 * 区切りは人が精算の画面で［この対局を終える］を押した時だけ（＝その開催に settle_snap が1つでもある）
 * 時間・日付・中身の比べで推し量らない＝押すまでは何日空いても続き・日を跨いでも続き・終えた開催は消さない
 * 返り＝続ける session_id／null＝新しく作る */
export function pickSession(st) {
  const ss = (st.sessions || []).filter((s) => !s.voided);
  if (!ss.length) return null;
  const last = ss[ss.length - 1];
  const ended = (st.settles || []).some((x) => x.session_id === last.session_id);
  return ended ? null : last.session_id;
}
/* その開催の中身の印（終えた時の控えに残す・今は pickSession では使わない）＝開催・卓・半荘（マス・順・飛び・供託・取り消しの全部）・チップ祝儀を id の順に並べた JSON の FNV-1a 32bit×2 */
export function sessionSig(st, sessionId) {
  const byId = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  const s = (st.sessions || []).find((x) => x.session_id === sessionId) || null;
  const ts = (st.tables || []).filter((t) => t.session_id === sessionId).sort(byId('table_id'));
  const tid = new Set(ts.map((t) => t.table_id));
  const hs = (st.hanchans || []).filter((h) => tid.has(h.table_id)).sort(byId('hanchan_id'));
  const xs = (st.extras || []).filter((e) => tid.has(e.table_id)).sort((a, b) => (a.table_id + a.member_id + a.kind).localeCompare(b.table_id + b.member_id + b.kind));
  const txt = JSON.stringify([s, ts, hs, xs]);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ txt.length;
  for (let i = 0; i < txt.length; i++) {
    const c = txt.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
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
