/* room-state.mjs — ★部屋の中の状態（端末の写し）と、それから出す対局の1ページの数★（設計図 v18.3 §2・§3.0 K-1・§5）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。倉庫の mj_write が来るまでは、端末がこの状態を持ち、同じ op を
 * 未送信の並びに積む（来たら送るだけ）。★倉庫の答えが正★＝ここは同じ op を端末で先に当てた写し。
 * ★op の形・範囲・版は倉庫の取り決め（memory/mahjong_tataki_2026-11-20/write_sekkei.md §3・§4・§6 v5.2）に合わせる★
 * 　画面側の紙＝gamen_write_awase_v1.md の v4・v5 節。範囲の表＝tests/fixtures/write-cases.json（倉庫の試験も読める）。
 *
 * op 18個（知らない op・知らない引数の鍵は bad）：
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
 *   ── 直す op 6個（2c-2a2・正本＝supabase/schema.sql の mj_write・write2_sekkei.md §2）＝版つきは extra_set だけ（他は後の書きが勝つ）──
 *   member_rename { member_id, name }                  … 自分を除く active で同じ name_key → dup（at name）
 *   member_active { member_id, active }                … true にする時だけ自分を除く active で同じ name_key → dup（at active）
 *   session_edit  { session_id, date?, place?, rate?, voided? }      … 在る鍵だけ session_add と同じ確かめ（place・rate は null で消す）
 *   table_edit    { table_id, label?, rate_mode?, rate?, voided? }   … 組の後の rate_mode が num の時だけ rate（num でないのに rate を送れば bad・写しは rate を消す）
 *   hanchan_seats { hanchan_id, seats }                … 取り消した半荘は bad・新しく入れる人だけ active を見る・顔ぶれが変われば ton_order null・order_version+1
 *   extra_set     { table_id, member_id, kind, value, base_version } … 行が無い時は base_version 0 で作る（0 でなければ conflict cur{0,0}・value 0 は作らずに ok）
 *   ★写しは members・sessions・tables の版と seats_version を持たない（形を足すと古い端末の門が newer で止まる）＝版つきでない op は版を返さない。
 *   ★リーグ（not_yet）は写しに無い。席にいない人のチップ・祝儀は applyOps の組の終わりの「正味の門」で見る（applyOp だけでは見ない）。
 * 版は作った時1。返し：{ ok: true } ／ { ok: false, err: 'conflict', at, cur: { value, version } } ／ { ok: false, err: 'range'|'bad'|'dup'|'too_many', … }
 */
import { rulesOk, RULE_KEYS } from './rules.mjs';
import { nameKey, btrim } from './name-key.mjs';
import { hanchanPt, tobiPt } from './hanchan-pt.mjs';
import { needsOrder } from './needs-order.mjs';
import { seisan } from './seisan.mjs';

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
/* 倉庫の日付の門と同じ：YYYY-MM-DD の形で、その日が在る（2026-02-30 は bad） */
const isDate = (x) => { if (typeof x !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x) || x.startsWith('0000')) return false; /* 倉庫の date に0年は無い */ const d = new Date(x + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x; };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const CELL_MAX = 200000;  // 素点 ±200,000（100点単位・倉庫 schema:217）
export const LOST_MAX = 20000;   // 消えた供託 0〜20,000 の1000の倍数（kieru の時だけ非0・schema:201）
export const EXTRA_MAX = 999;    // チップ・祝儀の1回の足しと合計 ±999
export const OPS_MAX = 30;       // 1つの組の op の数（超えたら too_many＝倉庫 §2 段1）
export const SNAP_MAX = 32768;   // settle_snap の content・used・missing の合わせた UTF-8 のバイト数。★写しは空白の無い JSON で数えるので倉庫より短く数える（鍵が多いほど差が開く）＝写しが通しても倉庫が range を返す事がある★（write2_sekkei.md §5）

/* btrim＝倉庫の c_trim と同じ5字だけを前後から削る（lib/name-key.mjs に1つだけ持つ＝rules の tane_custom と共有） */

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
  member_rename: ['member_id', 'name'],
  member_active: ['member_id', 'active'],
  session_edit: ['session_id', 'date', 'place', 'rate', 'voided'],
  table_edit: ['table_id', 'label', 'rate_mode', 'rate', 'voided'],
  hanchan_seats: ['hanchan_id', 'seats'],
  extra_set: ['table_id', 'member_id', 'kind', 'value', 'base_version'],
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
/* 倉庫の mj_w_int と同じ（整数で ±20億の内・外は bad） */
const wInt = (v) => isInt(v) && Math.abs(v) <= 2000000000;
/* 種の確かめ（2c-3b）＝倉庫の mahjong_private.mj_w_kind と同じ：'sum0'（合計0の種）／'out'（外へ払う種）／null（弾く）
 * 'chip'・'shugi'＝rules の *_pt10 が null なら null・他 'sum0'（rules が無い・鍵が無いも sum0）
 * 'c:<id>'＝rules.tane_custom が配列で id 一致が在る時だけ（pt10 の鍵の在りで判じない）・sum0 false＝'out'・他 'sum0'／それ以外＝null */
export const CUST_KIND = /^c:[a-z0-9]{1,8}$/;
export function kindOf(rules, kind) {
  if (typeof kind !== 'string') return null;
  if (kind === 'chip' || kind === 'shugi') return isObj(rules) && rules[kind + '_pt10'] === null ? null : 'sum0';
  if (!CUST_KIND.test(kind) || !isObj(rules) || !Array.isArray(rules.tane_custom)) return null;
  const x = rules.tane_custom.find((e) => isObj(e) && e.id === kind.slice(2));
  if (!x) return null;
  return x.sum0 === false ? 'out' : 'sum0';
}
/* extra_add・extra_set の頭の確かめ（倉庫と同じ順）：卓 → kind（使わない種・無い c:<id> も＝kindOf）→ 部屋の人 → 取り消した卓・開催日
 * 通れば { kd }（'sum0'／'out'）・だめなら { bad } */
function extraGate(st, t, op) {
  if (!t) return { bad: { ok: false, err: 'bad', at: 'table_id' } };
  const kd = kindOf(t.rules, op.kind);
  if (!kd) return { bad: { ok: false, err: 'bad', at: 'kind' } };
  if (!isStr(op.member_id) || !find(st.members, 'member_id', op.member_id)) return { bad: { ok: false, err: 'bad', at: 'member_id' } };
  const s = find(st.sessions, 'session_id', t.session_id);
  if (t.voided === true || (s && s.voided === true)) return { bad: { ok: false, err: 'bad', at: 'table_id' } };
  return { kd };
}

/* st を直接書き換える（呼ぶ側が写しを作る）。opts.now＝settle_snap の at（倉庫の now() の代わり） */
export function applyOp(st, op, opts = {}) {
  if (!isObj(op) || !isStr(op.op) || !Object.hasOwn(KEYS, op.op)) return { ok: false, err: 'bad', at: 'op' };
  const allow = KEYS[op.op];
  for (const k of Object.keys(op)) if (k !== 'op' && !allow.includes(k)) return { ok: false, err: 'bad', at: k };
  switch (op.op) {
    case 'member_add': {
      // 倉庫 mj_write と同じ順（schema.sql の member_add）：在る人は名前を見ずに ok → 名前の字 → 字の長さ → そろえた字（1〜40字）→ dup
      if (!isStr(op.member_id)) return { ok: false, err: 'bad', at: 'member_id' };
      if (find(st.members, 'member_id', op.member_id)) return { ok: true };
      if (typeof op.name !== 'string') return { ok: false, err: 'bad', at: 'name' };
      const nm = btrim(op.name);
      const len = [...nm].length; // 倉庫の char_length と同じ（コードポイント）
      if (len === 0 || len > 20) return { ok: false, err: 'bad', at: 'name' }; // 字の長さの外は倉庫と同じ bad（数の範囲の外だけ range・write2_sekkei §9）
      const key = nameKey(nm);
      const kl = [...key].length;
      if (kl === 0 || kl > 40) return { ok: false, err: 'bad', at: 'name' }; // ゼロ幅の字だけ・NFKC で伸びる字（倉庫の mj_name_key の後の字数）
      const same = st.members.find((m) => m.active && m.name_key === key);
      if (same) return { ok: false, err: 'dup', member_id: same.member_id, name: same.name };
      st.members.push({ member_id: op.member_id, name: nm, name_key: key, active: true });
      return { ok: true };
    }
    case 'session_add': {
      // 倉庫と同じ順：在る開催は中身を見ずに ok → 日付（形と実在）→ rate（鍵が無い・null＝null／整数でない・数でない＝bad／範囲の外＝range）→ place
      if (!isStr(op.session_id)) return { ok: false, err: 'bad', at: 'session_id' };
      if (find(st.sessions, 'session_id', op.session_id)) return { ok: true };
      if (!isDate(op.date)) return { ok: false, err: 'bad', at: 'date' };
      const rate = op.rate === undefined ? null : op.rate;
      if (rate !== null && !(typeof rate === 'number' && Number.isInteger(rate) && Math.abs(rate) <= 2000000000)) return { ok: false, err: 'bad', at: 'rate' }; // 倉庫の mj_w_int と同じ（±20億の外は bad）
      if (rate !== null && !(rate >= 10 && rate <= 100000 && rate % 10 === 0)) return { ok: false, err: 'range', at: 'rate' };
      if (op.place !== undefined && op.place !== null && (typeof op.place !== 'string' || [...op.place].length > 40)) return { ok: false, err: 'bad', at: 'place' };
      const s = { session_id: op.session_id, date: op.date, rate };
      if (isStr(op.place)) s.place = op.place;
      st.sessions.push(s);
      return { ok: true };
    }
    case 'table_add': {
      if (!isStr(op.table_id) || typeof op.label !== 'string') return { ok: false, err: 'bad' };
      if (find(st.tables, 'table_id', op.table_id)) return { ok: true };
      const s = find(st.sessions, 'session_id', op.session_id);
      if (!s || s.voided) return { ok: false, err: 'bad' };
      const lb = btrim(op.label);
      if ([...lb].length < 1 || [...lb].length > 20) return { ok: false, err: 'bad', at: 'label' };
      const r = rulesOk(st.rules);
      if (!r.ok) return { ok: false, err: 'bad', at: 'rules' }; // 倉庫では「部屋のルールが無い」
      st.tables.push({ table_id: op.table_id, session_id: s.session_id, label: lb, rules: r.rules });
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
      // 倉庫と同じ順：卓 → kind → 使わない種 → 人（部屋に在るか）→ 取り消した卓・開催日 → add。席にいない人は組の終わりの正味の門（applyOps）
      const t = find(st.tables, 'table_id', op.table_id);
      const xg = extraGate(st, t, op);
      if (xg.bad) return xg.bad;
      if (!wInt(op.add) || op.add === 0) return { ok: false, err: 'bad', at: 'add' }; // 0 と数でない物は倉庫と同じ bad
      if (Math.abs(op.add) > EXTRA_MAX) return { ok: false, err: 'range', at: 'add' };
      const e = st.extras.find((x) => x.table_id === op.table_id && x.member_id === op.member_id && x.kind === op.kind);
      const nv = (e ? e.value : 0) + op.add;
      const was = e ? e.value : 0; // 古い写しの ±999 の外の行は 0 に近づく向きだけ通す（直せなくしない）
      if (Math.abs(nv) > EXTRA_MAX && !(Math.abs(was) > EXTRA_MAX && Math.abs(nv) < Math.abs(was))) return { ok: false, err: 'range', at: 'add' };
      if (xg.kd === 'out' && nv < 0) return { ok: false, err: 'bad', at: 'add' }; // 外へ払う種（2c-3b）は足した後が 0〜999（倉庫 :2017・:2028）
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
    case 'member_rename': case 'member_active': {
      const m = isStr(op.member_id) ? find(st.members, 'member_id', op.member_id) : null;
      if (!m) return { ok: false, err: 'bad', at: 'member_id' };
      if (op.op === 'member_rename') {
        if (typeof op.name !== 'string') return { ok: false, err: 'bad', at: 'name' };
        const nm = btrim(op.name), len = [...nm].length;
        if (len === 0 || len > 20) return { ok: false, err: 'bad', at: 'name' };
        const key = nameKey(nm), kl = [...key].length;
        if (kl === 0 || kl > 40) return { ok: false, err: 'bad', at: 'name' };
        if (nm === m.name) return { ok: true };
        const same = st.members.find((x) => x !== m && x.active && x.name_key === key); // 自分を除く（Ab → aB は通る）
        if (same) return { ok: false, err: 'dup', at: 'name', member_id: same.member_id, name: same.name };
        m.name = nm; m.name_key = key;
        return { ok: true };
      }
      if (typeof op.active !== 'boolean') return { ok: false, err: 'bad', at: 'active' };
      if (m.active === op.active) return { ok: true };
      if (op.active) {
        const same = st.members.find((x) => x !== m && x.active && x.name_key === m.name_key);
        if (same) return { ok: false, err: 'dup', at: 'active', member_id: same.member_id, name: same.name };
      }
      m.active = op.active;
      return { ok: true };
    }
    case 'session_edit': {
      // 倉庫と同じ順：開催 → date → place → rate → voided → 同じなら書かずに ok
      const s = isStr(op.session_id) ? find(st.sessions, 'session_id', op.session_id) : null;
      if (!s) return { ok: false, err: 'bad', at: 'session_id' };
      let date = s.date, place = s.place === undefined ? null : s.place, rate = s.rate === undefined ? null : s.rate, voided = s.voided === true;
      if (own(op, 'date')) { if (!isDate(op.date)) return { ok: false, err: 'bad', at: 'date' }; date = op.date; }
      if (own(op, 'place')) {
        place = null;
        if (op.place !== null) {
          if (typeof op.place !== 'string' || [...op.place].length > 40) return { ok: false, err: 'bad', at: 'place' };
          place = op.place;
        }
      }
      if (own(op, 'rate')) {
        rate = null;
        if (op.rate !== null) {
          if (!wInt(op.rate)) return { ok: false, err: 'bad', at: 'rate' };
          if (!rateOk(op.rate)) return { ok: false, err: 'range', at: 'rate' };
          rate = op.rate;
        }
      }
      if (own(op, 'voided')) { if (typeof op.voided !== 'boolean') return { ok: false, err: 'bad', at: 'voided' }; voided = op.voided; }
      s.date = date; s.rate = rate;
      if (isStr(place)) s.place = place; else delete s.place; // session_add と同じ（空の place は持たない）
      if (voided) s.voided = true; else delete s.voided;
      return { ok: true };
    }
    case 'table_edit': {
      // 倉庫と同じ順：卓 → label → rate_mode → rate（組の後の mode で見る）→ voided
      const t = isStr(op.table_id) ? find(st.tables, 'table_id', op.table_id) : null;
      if (!t) return { ok: false, err: 'bad', at: 'table_id' };
      let label = t.label, mode = rateModeOf(t), rate = own(t, 'rate') ? t.rate : null, voided = t.voided === true;
      if (own(op, 'label')) {
        if (typeof op.label !== 'string') return { ok: false, err: 'bad', at: 'label' };
        label = btrim(op.label);
        if ([...label].length < 1 || [...label].length > 20) return { ok: false, err: 'bad', at: 'label' };
      }
      if (own(op, 'rate_mode')) {
        if (typeof op.rate_mode !== 'string' || !RATE_MODES.has(op.rate_mode)) return { ok: false, err: 'bad', at: 'rate_mode' };
        mode = op.rate_mode;
      }
      if (mode === 'num') {
        if (own(op, 'rate')) {
          if (op.rate === null || !wInt(op.rate)) return { ok: false, err: 'bad', at: 'rate' };
          if (!rateOk(op.rate)) return { ok: false, err: 'range', at: 'rate' };
          rate = op.rate;
        } else if (rate === null || rate === undefined) return { ok: false, err: 'bad', at: 'rate' };
      } else {
        if (own(op, 'rate') && op.rate !== null) return { ok: false, err: 'bad', at: 'rate' };
        rate = null;
      }
      if (own(op, 'voided')) { if (typeof op.voided !== 'boolean') return { ok: false, err: 'bad', at: 'voided' }; voided = op.voided; }
      t.label = label;
      if (mode !== 'session' || own(t, 'rate_mode')) t.rate_mode = mode; // 鍵の無い今の写し（＝session）のままなら鍵を足さない
      if (mode === 'num') t.rate = rate; else delete t.rate;
      if (voided) t.voided = true; else delete t.voided;
      return { ok: true };
    }
    case 'hanchan_seats': {
      const h = isStr(op.hanchan_id) ? find(st.hanchans, 'hanchan_id', op.hanchan_id) : null;
      if (!h || h.voided) return { ok: false, err: 'bad', at: 'hanchan_id' };
      const n = h.seats.length, a = op.seats;
      if (!Array.isArray(a) || a.length !== n || !a.every(isStr) || new Set(a).size !== n) return { ok: false, err: 'bad', at: 'seats' };
      // 部屋の人か・使わない印の人は今の席に居る人だけ通す（v1510:195＝新しく入れる人だけ active を見る）
      if (!a.every((id) => { const x = find(st.members, 'member_id', id); return x && (x.active || h.seats.includes(id)); })) return { ok: false, err: 'bad', at: 'seats' };
      if (a.every((id, i) => h.seats[i] === id)) return { ok: true };
      // 顔ぶれ（集合）が変わったら東の並びは合わない＝null・order_version+1（並べ替えだけなら残す＝倉庫の D2）
      if (h.ton_order !== null && !sameMembers(a, h.seats)) { h.ton_order = null; h.order_version++; }
      h.seats = a.slice();
      return { ok: true };
    }
    case 'extra_set': {
      // 倉庫と同じ順：卓 → kind → 使わない種 → 人 → 取り消した卓・開催日 → value → base_version → 行の版
      const t = find(st.tables, 'table_id', op.table_id);
      const xg = extraGate(st, t, op);
      if (xg.bad) return xg.bad;
      if (!wInt(op.value)) return { ok: false, err: 'bad', at: 'value' };
      if (Math.abs(op.value) > EXTRA_MAX) return { ok: false, err: 'range', at: 'value' };
      if (xg.kd === 'out' && op.value < 0) return { ok: false, err: 'bad', at: 'value' }; // 外へ払う種（2c-3b）＝base_version の conflict より先（倉庫 :2310）
      if (!wInt(op.base_version)) return { ok: false, err: 'bad', at: 'base_version' };
      const at = { table_id: t.table_id, member_id: op.member_id, kind: op.kind, what: 'extra' };
      const e = st.extras.find((x) => x.table_id === t.table_id && x.member_id === op.member_id && x.kind === op.kind);
      if (e) {
        if (e.value === op.value) return { ok: true };
        if (e.version !== op.base_version) return conflict(at, e.value, e.version);
        e.value = op.value; e.version++;
        return { ok: true };
      }
      // 行が無い（決め F）：base_version 0 でなければ conflict cur{0,0}（value 0 でも先に見る）・value 0 は作らずに ok
      if (op.base_version !== 0) return conflict(at, 0, 0);
      if (op.value === 0) return { ok: true };
      st.extras.push({ table_id: t.table_id, member_id: op.member_id, kind: op.kind, value: op.value, version: 1 });
      return { ok: true };
    }
  }
  return { ok: false, err: 'bad', at: 'op' };
}

/* ── ③-0 境目の門（yakitori_custom_v1.md v7〜v7.3）＝★部屋ごとに1回だけ判じ、だめなら部屋を丸ごと読むだけ★ ──
 * newer＝先の版の形（st.v が 1・2 の外／知らない rules の鍵／知らない extras の kind／半荘の知らない欄）
 * rules_bad＝知っている鍵だけなのに値が壊れている（rulesOk が落ちる・rules が object でない）
 * どちらもお金の数を1つも出さない・書かない（一部の卓だけ読めても部屋ごと止める＝読める卓だけで精算すると額が黙って違う）。
 * 部屋の rules は★引数 roomRules（サーバから来た room.rules）だけ★を見る＝st.rules は見ない（emptyState や古い写しは持たない）。 */
const RULE_SET = new Set(RULE_KEYS.map((k) => k.key));
const EXTRA_KINDS = new Set(['chip', 'shugi']);
const KNOWN_H = new Set(['hanchan_id', 'table_id', 'no', 'seats', 'cells', 'cell_ver', 'ton_order', 'order_version', 'lost', 'version', 'tobi_to', 'tobi_version', 'voided']);
export const GATE_OK = Object.freeze({ mode: 'ok', why: null });
export const NEWER_TEXT = 'この部屋はこのアプリの版では開けません。アプリを新しくしてください';
export const gateText = (g) => (g.mode === 'newer' ? NEWER_TEXT : 'この部屋のルールが読めません（' + g.why + '）');
function rulesGate(r) {
  if (!isObj(r)) return { mode: 'rules_bad', why: '(object)' };
  for (const k of Object.keys(r)) if (!RULE_SET.has(k)) return { mode: 'newer', why: k };
  const x = rulesOk(r);
  return x.ok ? null : { mode: 'rules_bad', why: x.err };
}
/* S2（s2_seisan_rate_v1.md v1.1 E'）＝倉庫 schema の check と同じ範囲（rate_mode ∈ session/num/none・num の時だけ rate・rate は10〜100000の10の倍数）
 * 鍵が無いのは今の写し（rate_mode 無し＝session・rate 無し・voided 無し）＝通す。在って壊れている物は止める（2d で倉庫の写しが来る時に備える） */
const RATE_MODES = new Set(['session', 'num', 'none']);
const rateOk = (r) => typeof r === 'number' && Number.isInteger(r) && r >= 10 && r <= 100000 && r % 10 === 0;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function rateGate(t) {
  let mode = 'session';
  if (own(t, 'rate_mode')) {
    if (typeof t.rate_mode !== 'string') return { mode: 'rules_bad', why: 'rate_mode' };
    if (!RATE_MODES.has(t.rate_mode)) return { mode: 'newer', why: 'rate_mode' };
    mode = t.rate_mode;
  }
  if (mode === 'num' ? !rateOk(t.rate) : own(t, 'rate') && t.rate !== null) return { mode: 'rules_bad', why: 'rate' };
  if (own(t, 'voided') && typeof t.voided !== 'boolean') return { mode: 'rules_bad', why: 'voided' };
  return null;
}
function sessionGate(s) {
  if (!isObj(s)) return { mode: 'rules_bad', why: '(object)' };
  if (own(s, 'voided') && typeof s.voided !== 'boolean') return { mode: 'rules_bad', why: 'voided' };
  if (own(s, 'rate') && s.rate !== null && !rateOk(s.rate)) return { mode: 'rules_bad', why: 'rate' };
  return null;
}
const vOk = (v) => v === undefined || v === 1 || v === 2;
/* 形を直した後の写し（v===2）を見る。roomRules が undefined なら部屋の rules の判じだけ飛ばす */
export function roomGate(st, roomRules) {
  if (!isObj(st) || !vOk(st.v)) return { mode: 'newer', why: 'v' };
  if (roomRules !== undefined) { const g = rulesGate(roomRules); if (g) return g; }
  for (const t of st.tables || []) { const g = isObj(t) ? rulesGate(t.rules) || rateGate(t) : { mode: 'rules_bad', why: '(object)' }; if (g) return g; }
  for (const s of st.sessions || []) { const g = sessionGate(s); if (g) return g; }
  // 種＝chip・shugi・自由な項目 c:<id> の形（卓の tane_custom に無い id の行は newer にせず数えない＝倉庫の tstate と同じ）
  for (const e of st.extras || []) if (!isObj(e) || !(EXTRA_KINDS.has(e.kind) || (typeof e.kind === 'string' && CUST_KIND.test(e.kind)))) return { mode: 'newer', why: 'kind' };
  for (const h of st.hanchans || []) if (!isObj(h) || Object.keys(h).some((k) => !KNOWN_H.has(k))) return { mode: 'newer', why: 'hanchan' };
  return GATE_OK;
}
/* 全卓の t.rules を44鍵に埋めた写しを返す（clone・元は触らない）＝R を直に読む5か所が埋めた rules を読む。門が ok の時だけ呼ぶ */
function fillRules(st) {
  const out = clone(st);
  for (const t of out.tables) { const x = rulesOk(t.rules); if (x.ok) t.rules = x.rules; }
  return out;
}

/* 1つの mj_write の呼び（ops の組）を丸ごと当てる＝どれか1つでも弾かれたら組ごと当てない（倉庫の取引と同じ）
 * 組の終わりに §4 の「飛びの古い受け取り」を消す：触った半荘ごとに、組の初めに飛んでいなかった席が終わりに飛んでいて、
 * tobi_to にその席の鍵が在り、組に同じ半荘の tobi_set も hanchan_start も無い時だけ、その鍵を消して tobi_version+1 */
export function applyOps(st, ops, opts = {}) {
  const g = roomGate(st, opts.roomRules); // ③-0 の門＝ok でなければ組ごと何も当てない（どの道から op を作っても書けない）
  if (g.mode !== 'ok') return { ok: false, idx: 0, res: { ok: false, err: g.mode, why: g.why }, state: st };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, idx: 0, res: { ok: false, err: 'bad' }, state: st };
  if (ops.length > OPS_MAX) return { ok: false, idx: OPS_MAX, res: { ok: false, err: 'too_many' }, state: st };
  const next = clone(st);
  const before = new Map(next.hanchans.map((h) => [h.hanchan_id, h.cells.slice()]));
  const touched = new Set(), whole = new Set();
  const rows = new Map(); // 正味の門：この組で値が変わった extras の行＝{ b：組の前の値（行が無ければ null）, i：最後に変えた op }
  const rowOf = (o) => next.extras.find((x) => x.table_id === o.table_id && x.member_id === o.member_id && x.kind === o.kind);
  for (let i = 0; i < ops.length; i++) {
    const o0 = ops[i];
    const isX = isObj(o0) && (o0.op === 'extra_add' || o0.op === 'extra_set');
    const pre = isX ? rowOf(o0) : undefined, preV = pre ? pre.value : null;
    const r = applyOp(next, ops[i], opts);
    if (!r.ok) return { ok: false, idx: i, res: { ...r, i }, state: st };
    if (isX) {
      const post = rowOf(o0), postV = post ? post.value : null;
      if (postV !== preV) {
        const k = canon([o0.table_id, o0.member_id, o0.kind]);
        rows.set(k, { t: o0.table_id, m: o0.member_id, kind: o0.kind, b: rows.has(k) ? rows.get(k).b : preV, i });
      }
    }
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
  // 正味の門（v1510:195①・倉庫 mj_write の組の終わりと同じ）：組の後に、その卓の取り消していない半荘の席にいない人の行は
  // 0 へ近づき 0 を越えない時だけ通す（行の無かった人への足しは弾く）。席にいる人は ±999 の範囲だけ（op で見た）
  // 見る順も倉庫と同じ（2つ以上弾かれる時に返す i が割れない）：卓（table_id の字順）→ row_key::text の字順
  // ＝jsonb は鍵を短い順に書く（{"kind","table_id","member_id"}）ので卓の中では kind → member_id
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const order = [...rows.values()].sort((a, b) => cmp(a.t, b.t) || cmp(a.kind, b.kind) || cmp(a.m, b.m));
  for (const x of order) {
    const e = next.extras.find((y) => y.table_id === x.t && y.member_id === x.m && y.kind === x.kind);
    if (!e) continue;
    const seated = next.hanchans.some((h) => h.table_id === x.t && !h.voided && h.seats.includes(x.m));
    if (!seated && (x.b === null || Math.abs(e.value) > Math.abs(x.b) || e.value * x.b < 0)) {
      return { ok: false, idx: x.i, res: { ok: false, err: 'bad', at: 'member_id', i: x.i }, state: st };
    }
  }
  return { ok: true, state: next };
}

/* 直す画面の tobi_set（v5 止め1）：tobi_set を抜いた組 ops を一度写しに当て（§4 の鍵消しの後）、その tobi_to と
 * want（直した後の飛んだ席の鍵だけ）を比べ、違う時だけ tobi_set を返す（同じなら null）＝また飛んで同じ人を選んだ時も
 * 「前と同じ」で送らずに倉庫に鍵を消される事が無い。base_version は組の前の tobi_version（組に tobi_set が入れば鍵消しは起きない） */
export function tobiSetOp(st, ops, hanchanId, want, opts = {}) {
  const h = find(st.hanchans, 'hanchan_id', hanchanId);
  if (!h) return null;
  const trial = ops.length ? applyOps(st, ops, opts) : { ok: true, state: st };
  const th = trial.ok ? find(trial.state.hanchans, 'hanchan_id', hanchanId) : h;
  if (canon(th.tobi_to) === canon(want)) return null;
  return { op: 'tobi_set', hanchan_id: hanchanId, tobi_to: { ...want }, base_version: h.tobi_version };
}

/* ── 古い形の写し（st.v が 2 でない＝cell_ver 0始まり・order・lost_ver・席ごとの tobi_ver・settles の snap）を新しい形へ ──
 * v3：op を並べ直さない＝形だけ直し、値は1つも変えない（範囲の外もそのまま・常に保存）。needs_upload を付ける＝
 * 写しに在って倉庫に無い物を作るのは 2d（mj_read で見比べてから・範囲と卓のルールを確かめ・30個ごと）。
 * 返し：{ st, migrated, gate }（gate＝roomGate・ok の時だけ全卓の rules を埋める＝埋めは migrated を立てない）＝migrated の時、呼ぶ側は古い並びを捨て、★並びを先に保存してから写しを保存★する（home は保存しない）。 */
export function migrateState(st0, roomRules) {
  if (!isObj(st0)) return { st: emptyState(), migrated: false, gate: GATE_OK };
  if (!vOk(st0.v)) return { st: st0, migrated: false, gate: { mode: 'newer', why: 'v' } }; // 先の版＝形を直さず・保存させず
  if (st0.v === 2) return done(st0, false, roomRules);
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
  return done(st, true, roomRules);
}
function done(st, migrated, roomRules) {
  const gate = roomGate(st, roomRules);
  return { st: gate.mode === 'ok' ? fillRules(st) : st, migrated, gate };
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

/* ── 卓のレート（S2 v1.1 A'）＝倉庫と同じ：rate_mode 'num'→卓の rate／'none'→null／'session'（鍵が無い時も）→開催の rate（開催の取り消しは見ない＝精算の方で止める） ── */
export const rateModeOf = (t) => (Object.prototype.hasOwnProperty.call(t, 'rate_mode') ? t.rate_mode : 'session');
export function tableRate(t, s) {
  const mode = rateModeOf(t);
  if (mode === 'num') return t.rate;
  if (mode === 'none') return null;
  return s ? s.rate : null;
}

/* ── 卓の1ページの数 ── */
export function tableView(st, tableId) {
  const t = find(st.tables, 'table_id', tableId);
  if (!t) return null;
  const s = find(st.sessions, 'session_id', t.session_id);
  const R = t.rules, rate = tableRate(t, s);
  const hs = st.hanchans.filter((h) => h.table_id === tableId);
  const people = [];
  const see = (m) => { if (!people.includes(m)) people.push(m); };
  for (const h of hs) if (!h.voided) h.seats.forEach(see);
  // 自由な項目（2c-3b）＝卓の tane_custom の並びの順。数えるのは並びに在る id の行だけ（倉庫の tstate と同じ）
  const tane = isObj(R) && Array.isArray(R.tane_custom) ? R.tane_custom.filter((x) => isObj(x) && typeof x.id === 'string') : [];
  const custKinds = new Set(tane.map((x) => 'c:' + x.id));
  // 人＝chip・shugi の 0 でない行（使わない種も今まで通り）と、数える c: の 0 でない行
  for (const e of st.extras) if (e.table_id === tableId && e.value !== 0 && (e.kind === 'chip' || e.kind === 'shugi' || custKinds.has(e.kind))) see(e.member_id);
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
  for (const e of st.extras) if (e.table_id === tableId && (e.kind === 'chip' || e.kind === 'shugi')) ex[e.kind][e.member_id] = e.value;
  const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const chipSum = used.chip ? sumOf(ex.chip) : 0;
  const shugiSum = used.shugi ? sumOf(ex.shugi) : 0;
  // 各 c: の種：ng＝合計0の種で合計≠0（倉庫の extra_state ng と同じ）／wait＝ng でないが 0 でない行が在る
  // （自由な項目のお金＝③-2 はまだ無い＝抜いた額を黙って出さない・止めて警告）。1つの種に missing は1件（ng を先に）
  const cust = tane.map((x) => {
    const kind = 'c:' + x.id;
    const xs = st.extras.filter((e) => e.table_id === tableId && e.kind === kind);
    const sum = xs.reduce((a, e) => a + e.value, 0);
    const ng = x.sum0 !== false && sum !== 0;
    return { kind, name: x.name, sum0: x.sum0 !== false, sum, ng, wait: !ng && xs.some((e) => e.value !== 0) };
  });
  const custWait = cust.some((c) => c.wait);
  const extrasOk = chipSum === 0 && shugiSum === 0 && !cust.some((c) => c.ng);
  const toBig = (pt10) => (rate === null ? pt10 : pt10 * (rate / 10));
  const windows = people.map((m) => {
    const chip = used.chip ? (ex.chip[m] || 0) : 0, shugi = used.shugi ? (ex.shugi[m] || 0) : 0;
    const extra10 = chip * (R.chip_pt10 || 0) + shugi * (R.shugi_pt10 || 0);
    const pt10 = total10[m] + (extrasOk ? extra10 : 0);
    return {
      member_id: m, name: name(m), pt10, big: toBig(pt10), unit: rate === null ? 'pt' : 'ten', dim: !extrasOk || custWait,
      chip, shugi, chipBig: toBig(chip * (R.chip_pt10 || 0)), shugiBig: toBig(shugi * (R.shugi_pt10 || 0)),
      hanPt10: total10[m], chipPt10: chip * (R.chip_pt10 || 0), shugiPt10: shugi * (R.shugi_pt10 || 0),
    };
  });
  if (!extrasOk) {
    if (chipSum !== 0) missing.push({ what: 'chip', diff: chipSum });
    if (shugiSum !== 0) missing.push({ what: 'shugi', diff: shugiSum });
  }
  // missing の並び＝chip → shugi → c:（tane_custom の並びの順）
  for (const c of cust) {
    if (c.ng) missing.push({ what: c.kind, name: c.name, diff: c.sum });
    else if (c.wait) missing.push({ what: c.kind, name: c.name, why: 'not_yet' });
  }
  const tableForSeisan = {
    rate, chip_pt10: R.chip_pt10, shugi_pt10: R.shugi_pt10, hanchans: complete,
    chips: used.chip && chipSum === 0 ? { ...ex.chip } : undefined,
    shugis: used.shugi && shugiSum === 0 ? { ...ex.shugi } : undefined,
  };
  return {
    table_id: tableId, rules: R, rate, date: s ? s.date : null, people: people.map((m) => ({ member_id: m, name: name(m) })),
    rows, total10, windows, used, chipSum, shugiSum, extrasOk, cust, custWait, missing, tableForSeisan,
    nextNo: hs.length + 1,
  };
}

/* ── 開催日の精算（そろった半荘とそろった卓のチップ・祝儀だけ） ── */
/* 部屋を開いた時に続ける開催（司さん 11-20 19時「時間にすんなや・清算押したらその対局が終わる・常に保存が普通」）
 * 区切りは人が精算の画面で［対局終了］を押した時だけ（＝その開催に settle_snap が1つでもある）
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
/* 開催の精算（S2 v1.1 C'）＝取り消した卓は精算・未入力・レートなしに入れない／卓の番号は全卓の中の順（取り消しで番号がずれない）
 * 開催が無い→err 'session'・開催が取り消し→err 'voided'（お金の数を出さない） */
export function sessionSeisan(st, sessionId) {
  const name = (m) => { const x = find(st.members, 'member_id', m); return x ? x.name : '?'; };
  const s = find(st.sessions, 'session_id', sessionId);
  if (!s) return { ok: false, err: 'session', name, missing: [], noRateTables: [] };
  if (s.voided) return { ok: false, err: 'voided', name, missing: [], noRateTables: [] };
  const ts = st.tables.filter((t) => t.session_id === sessionId);
  const live = ts.map((t, i) => ({ t, no: i + 1 })).filter((x) => !x.t.voided).map((x) => ({ ...x, v: tableView(st, x.t.table_id) }));
  const res = seisan(live.map((x) => x.v.tableForSeisan));
  return { ...res, name, missing: live.flatMap((x) => x.v.missing.map((m) => ({ table: x.no, ...m }))), noRateTables: live.filter((x) => x.v.rate === null).map((x) => x.no) };
}
/* 終えた時の点と今の点の違う人（S2 v1.1 止め2）＝両方の鍵を合わせて比べる（取り消した卓にだけ居た人も漏らさない）
 * 並び＝終えた時の鍵の順＋今にだけ在る鍵の順 */
export function tenChanged(lastTen, nowTen) {
  const a = lastTen || {}, b = nowTen || {};
  const keys = Object.keys(a).concat(Object.keys(b).filter((k) => !Object.prototype.hasOwnProperty.call(a, k)));
  return keys.filter((m) => (a[m] || 0) !== (b[m] || 0));
}
/* 精算の画面の「1人ずつ」の数（S2 v1.1 止め4）＝取り消していない・レートのある卓だけ（レートなしの卓の pt は pt10NoRate の節だけに出す）
 * by[人]＝{ han, n, chip, chip10, shugi, shugi10, kei:{ レート: pt10 } }（Σ kei[r]×r/10 ＝ 精算の ten）
 * rates＝数えた卓のうち半荘かチップ・祝儀が1つでも在る卓のレート（重ねない・小さい順）
 * count＝取り消していない卓の取り消していない半荘（レートなしの卓も数える）・tables＝取り消していない卓の数 */
export function sessionBreakdown(st, sessionId) {
  const s = find(st.sessions, 'session_id', sessionId);
  const live = st.tables.filter((t) => t.session_id === sessionId && !t.voided);
  const by = {}, order = [], rates = [];
  let count = 0;
  const used = { chip: false, shugi: false };
  for (const t of live) {
    const v = tableView(st, t.table_id);
    count += v.rows.filter((r) => !r.voided).length;
    if (v.rate === null) continue;
    if ((v.rows.some((r) => r.ok) || v.windows.length) && !rates.includes(v.rate)) rates.push(v.rate);
    if (v.used.chip && v.extrasOk) used.chip = true;
    if (v.used.shugi && v.extrasOk) used.shugi = true;
    for (const w of v.windows) {
      if (!by[w.member_id]) { by[w.member_id] = { han: 0, n: 0, chip: 0, chip10: 0, shugi: 0, shugi10: 0, kei: {} }; order.push(w.member_id); }
      const b = by[w.member_id];
      b.han += w.hanPt10; b.n += v.rows.filter((r) => r.ok && r.by[w.member_id]).length;
      let k = w.hanPt10;
      if (v.extrasOk) { b.chip += w.chip; b.chip10 += w.chipPt10; b.shugi += w.shugi; b.shugi10 += w.shugiPt10; k += w.chipPt10 + w.shugiPt10; }
      b.kei[v.rate] = (b.kei[v.rate] || 0) + k;
    }
  }
  rates.sort((x, y) => x - y);
  return { sid: sessionId, date: s ? s.date : null, by, order, count, used, rates, tables: live.length };
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
