/* room-state.mjs — ★部屋の中の状態（端末の写し）と、それから出す対局の1ページの数★（設計図 v18.3 §2・§3.0 K-1・§5）
 * =============================================================================
 * 画面と node 試験が同じ物を使う純関数。倉庫の mj_write が来るまでは、端末がこの状態を持ち、同じ op を
 * 未送信の並びに積む（来たら送るだけ）。★倉庫の答えが正★＝ここは同じ op を端末で先に当てた写し。
 * ★op の形・範囲・版は倉庫の取り決め（memory/mahjong_tataki_2026-11-20/write_sekkei.md §3・§4・§6 v5.2）に合わせる★
 * 　画面側の紙＝gamen_write_awase_v1.md の v4・v5 節。範囲の表＝tests/fixtures/write-cases.json（倉庫の試験も読める）。
 *
 * op 30個（知らない op・知らない引数の鍵は bad）：
 *   member_add    { member_id, name }                  … trim の後 1〜20字・active で同じ name_key → dup（member_id を返す）
 *   session_add   { session_id, date, rate, place? }   … rate＝null か 10〜2,000,000,000 の10の倍数・place 40字まで
 *   table_add     { table_id, session_id, label }      … label 1〜20字・ルールは op で送らない＝写しの st.rules（画面が置く）を写す
 *   hanchan_start { hanchan_id, table_id, seats:[member_id], cells, ton_order?:[member_id], lost?, tobi_to? }
 *   cell_set      { hanchan_id, seat, value, base_version }        … cell_ver[seat]
 *   hanchan_order { hanchan_id, ton_order, base_version }          … order_version
 *   kyotaku_set   { hanchan_id, value, base_version }              … version（void・unvoid でも上がる）
 *   tobi_set      { hanchan_id, tobi_to, base_version }            … tobi_version・まるごと置き換え（B2 段2 から★お金に使わない★＝飛び賞は extras の種 'tobi'・倉庫と対で残す・tobi_chip_v3.md）
 *   （yakitori_set は 2c-3c' で外した＝やきとりは extras の種 'yaki'・write6_yaki_sadame.md v1.1。古い倉庫の半荘の yakitori／yakitori_version の欄は読む門が形だけ見て計算には使わない）
 *   ★版つきの op は base_version の形（整数・±20億）を「同じ値か」より先に見る（倉庫 mj_w_int と同じ順）★
 *   hanchan_void  { hanchan_id } ／ hanchan_unvoid { hanchan_id }  … 同じ値なら書かずに ok・違えば version+1
 *   extra_add     { table_id, member_id, kind, add }               … add ±1〜999・合計 ±999・版は見ない
 *   settle_snap   { session_id, rev, content, used, missing }      … at は写しでは applyOps の opts.now
 *   ── 直す op 6個（2c-2a2・正本＝supabase/schema.sql の mj_write・write2_sekkei.md §2）＝版つきは extra_set だけ（他は後の書きが勝つ）──
 *   member_rename { member_id, name }                  … 自分を除く active で同じ name_key → dup（at name）
 *   member_active { member_id, active }                … true にする時だけ自分を除く active で同じ name_key → dup（at active）
 *   session_edit  { session_id, date?, place?, rate?, voided? }      … 在る鍵だけ session_add と同じ確かめ（place・rate は null で消す）
 *   table_edit    { table_id, label?, rate_mode?, rate?, voided? }   … 組の後の rate_mode が num の時だけ rate（num でないのに rate を送れば bad・写しは rate を消す）
 *   table_seats   { table_id, seats }                  … B1＝卓の席（0回目の ± の門と名前の列だけ・お金の判じは変えない）・後勝ち・長さ＝players・重なり無し・部屋の人（使わない人は今の卓の席にいる人だけ）・取り消した卓/開催日は bad・同じ値は書かない
 *   hanchan_seats { hanchan_id, seats }                … 取り消した半荘は bad・新しく入れる人だけ active を見る・顔ぶれが変われば ton_order null・order_version+1
 *   extra_set     { table_id, member_id, kind, value, base_version } … 行が無い時は base_version 0 で作る（0 でなければ conflict cur{0,0}・value 0 は作らずに ok）
 *   ★写しは members・sessions・tables の版と seats_version を持たない（形を足すと古い端末の門が newer で止まる）＝版つきでない op は版を返さない。
 *   ── リーグの op 3個（2c-2d1・正本＝schema.sql の mj_write・紙 mahjong_tataki_2026-11-20/write7_league_sadame_v11.md）──
 *   league_create { league_id, name, date_from, date_to, rank_by, min_games, players_main, rules, rules_alt }
 *   league_save   { league_id, base_version, name, date_from, date_to, rank_by, min_games, rules, rules_alt } ／ league_owner_set { league_id }
 *   ★写しはリーグ（leagues・L・リーグのルールの版）を持たない＝人の op と同じく direct の門・league_id の形だけ見て状態は変えずに ok★（中身・L・版・上限は倉庫だけ）
 *   session_add の league_id：無いか null＝今まで通り／uuid でない＝bad at league_id／uuid＝リーグの日（ルールはリーグの主・役は L）＝写しは当てられない＝direct でない組は err 'direct'・direct の組は状態を変えずに ok
 *   ★リーグの日の開催・卓・半荘は写しに無い。席にいない人のチップ・祝儀は applyOps の組の終わりの「正味の門」で見る（applyOp だけでは見ない）。
 *   ── 人の op 5個（2c-2b・正本＝schema.sql の mj_w_op 末尾・紙 mahjong_tataki_2026-11-20/write4_utsushi.md v1.1）──
 *   member_link { member_id } ／ member_unlink { member_id } ／ member_relink { member_id, user_id } ／ role_set { user_id, role } ／ account_remove { user_id }
 *   ★写しは人のつなぎ・room_accounts・持ち主を持たない＝形と「在る・active」だけ見て状態は変えずに ok★（linked・claimed・full・持ち主・居ない人は倉庫だけが決める）
 *   ── 部屋の op 4個（2c-2c・正本＝408f091 の mj_write ①・mj_w_op・紙 write5_utsushi.md v1）──
 *   room_leave {} ／ room_delete {} ／ room_undelete {} ／ room_secret { pass, url_token_hash }＝組の中で1つだけ（長さ>1 なら bad at op）・人の op と同じく direct の門・状態は変えない
 *   ★alone・gone・common・same・K-3 の継ぎ・channel_key は倉庫だけ★
 *   ★人の op は並びに積まない★＝opts.direct !== true の組は err 'direct'（写しだけの弾き）。人の op の画面はその場で送って倉庫の答えを出す。
 * 組の頭（applyOps＝倉庫 mj_write と同じ順）：① 形（全部の op の名と鍵）→ direct の門 → ③' 役の門（opts.role・無ければ nyu）→ ③'' 入り直しの門（opts.reauthAt）→ op ごと
 * 版は作った時1。返し：{ ok: true } ／ { ok: false, err: 'conflict', at, cur: { value, version } } ／ { ok: false, err: 'range'|'bad'|'dup'|'too_many', … }
 */
import { rulesOk, RULE_KEYS } from './rules.mjs';
import { nameKey, btrim } from './name-key.mjs';
import { hanchanPt, tobiPt, tobiROk } from './hanchan-pt.mjs';
import { needsOrder, orderCovered } from './needs-order.mjs';
import { seisan } from './seisan.mjs';
import { M, mulS, addS, addK } from './safe-int.mjs';

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
/* 段C：新しく決めるパス＝倉庫 mj_pass_key（NFKC・A〜Z だけ小文字）の後に数字4つ（全角の数字も通る） */
const passOk4 = (p) => typeof p === 'string' && /^[0-9]{4}$/.test(p.normalize('NFKC').replace(/[A-Z]/g, (c) => c.toLowerCase()));
/* 倉庫の日付の門と同じ：YYYY-MM-DD の形で、その日が在る（2026-02-30 は bad） */
const isDate = (x) => { if (typeof x !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x) || x.startsWith('0000')) return false; /* 倉庫の date に0年は無い */ const d = new Date(x + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x; };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const CELL_MAX = M;       // A18：素点の上限は機械の限界 ±20億だけ（100点単位・倉庫 schema:270）
export const LOST_MAX = M;       // A18：消えた供託 0〜20億の1000の倍数（kieru の時だけ非0・schema:254）
export const EXTRA_MAX = 999;    // チップ・祝儀の1回の足しと合計 ±999
export const OPS_MAX = 30;       // 1つの組の op の数（超えたら too_many＝倉庫 §2 段1）
export const SNAP_MAX = 32768;   // settle_snap の content・used・missing の合わせた UTF-8 のバイト数。★写しは空白の無い JSON で数えるので倉庫より短く数える（鍵が多いほど差が開く）＝写しが通しても倉庫が range を返す事がある★（write2_sekkei.md §5）

/* btrim＝倉庫の c_trim と同じ5字だけを前後から削る（lib/name-key.mjs に1つだけ持つ＝rules の tane_custom と共有） */

const KEYS = {
  member_add: ['member_id', 'name'],
  session_add: ['session_id', 'date', 'rate', 'place', 'league_id'],
  table_add: ['table_id', 'session_id', 'label', 'alt'],   // D2 alt＝リーグの日のもう一方のルールの卓
  hanchan_start: ['hanchan_id', 'table_id', 'seats', 'cells', 'ton_order', 'lost', 'tobi_to', 'follow', 'seen_cells'],   // A13 §6 seen_cells＝保存した人が見た点   // C4 follow＝区切られた卓なら鎖の最後へ（新しい版はいつも true）
  cell_set: ['hanchan_id', 'seat', 'value', 'base_version'],
  hanchan_order: ['hanchan_id', 'ton_order', 'base_version', 'seen_cells', 'seen_seats'],   // A13 §6 [s1][s3]
  kyotaku_set: ['hanchan_id', 'value', 'base_version'],
  tobi_set: ['hanchan_id', 'tobi_to', 'base_version'],
  hanchan_void: ['hanchan_id'],
  hanchan_unvoid: ['hanchan_id'],
  extra_add: ['table_id', 'member_id', 'kind', 'add', 'follow'],
  settle_snap: ['session_id', 'rev', 'content', 'used', 'missing'],
  member_rename: ['member_id', 'name'],
  member_active: ['member_id', 'active'],
  session_edit: ['session_id', 'date', 'place', 'rate', 'voided'],
  table_edit: ['table_id', 'label', 'rate_mode', 'rate', 'voided'],
  hanchan_seats: ['hanchan_id', 'seats'],
  table_seats: ['table_id', 'seats'],
  extra_set: ['table_id', 'member_id', 'kind', 'value', 'base_version'],
  table_rules: ['table_id', 'new_table_id', 'rules'],   // C4（c4_sadame v3.3 §2）途中でルールを変える＝卓を区切る・役 kan・direct
  member_link: ['member_id'],
  member_unlink: ['member_id'],
  member_relink: ['member_id', 'user_id'],
  role_set: ['user_id', 'role'],
  account_remove: ['user_id'],
  room_leave: [],
  room_delete: [],
  room_undelete: [],
  room_secret: ['pass', 'url_token_hash'],
  room_share: ['name', 'pass', 'url_token_hash'],   // 段C（heya_mirutoki_sadame.md §4）＝部屋なしをみんなで見る部屋に
  room_close: [],                                   // 段C＝［部屋を終える］
  league_create: ['league_id', 'name', 'date_from', 'date_to', 'rank_by', 'min_games', 'players_main', 'rules', 'rules_alt'],
  league_save: ['league_id', 'base_version', 'name', 'date_from', 'date_to', 'rank_by', 'min_games', 'rules', 'rules_alt'],
  league_owner_set: ['league_id'],
};
export const OP_NAMES = Object.keys(KEYS);
export const KEYS_OF = (name) => (Object.hasOwn(KEYS, name) ? [...KEYS[name]] : null); // 試験が schema の c_keys と比べる
/* 役の門・入り直しの門の表（倉庫 mahjong.mj_ops の who_plain・re と同じ字＝room-state.test が schema.sql と1行ずつ比べる） */
export const ROOM_OPS = Object.freeze(['room_leave', 'room_delete', 'room_undelete', 'room_secret', 'room_share', 'room_close']); // 2c-2c 部屋の op（段C で2つ足した）＝組の中で1つだけ（倉庫 mj_write ①）
export const LEAGUE_OPS = Object.freeze(['league_create', 'league_save', 'league_owner_set']); // 2c-2d1＝写しはリーグを持たない＝人の op と同じ direct の門
export const PERSON_OPS = Object.freeze(['member_link', 'member_unlink', 'member_relink', 'role_set', 'account_remove', ...ROOM_OPS, ...LEAGUE_OPS]);
export const WHO = Object.freeze(Object.fromEntries(OP_NAMES.map((n) => [n, { member_link: 'self', member_unlink: 'self_or_kan', member_relink: 'kan', role_set: 'owner', account_remove: 'kan', room_leave: 'self', room_secret: 'kan', room_delete: 'owner', room_undelete: 'owner_or_kan', room_share: 'owner', room_close: 'owner', table_rules: 'kan', league_create: 'kan', league_save: 'none', league_owner_set: 'owner' }[n] || 'nyu'])));
/* リーグの日の役（mj_ops.who_league と同じ字＝試験が schema と1行ずつ比べる）＝③' は who_league が same か who_plain と同じ op だけ見る（他は倉庫が op の中で対象が分かってから見る・v1.1 止め1） */
export const WHO_LEAGUE = Object.freeze(Object.fromEntries(OP_NAMES.map((n) => [n, { member_rename: 'owner_or_sole_L', member_active: 'owner_or_sole_L', session_add: 'L', session_edit: 'L', table_add: 'L', table_edit: 'L', hanchan_seats: 'L', table_seats: 'L', league_save: 'L', league_owner_set: 'owner' }[n] || (['hanchan_start', 'hanchan_void', 'hanchan_unvoid', 'cell_set', 'tobi_set', 'kyotaku_set', 'hanchan_order', 'extra_set', 'extra_add', 'settle_snap'].includes(n) ? 'nyu' : 'same')])));
export const ROLE_AT_GATE = (n) => WHO_LEAGUE[n] === 'same' || WHO_LEAGUE[n] === WHO[n]; // ③' で見る op
export const RE = Object.freeze(Object.fromEntries(OP_NAMES.map((n) => [n, n === 'role_set' ? 'grant' : ({ room_leave: 'owner', room_secret: 'yes', room_delete: 'yes', room_close: 'yes', league_owner_set: 'yes' }[n] || 'no')])));
export const REAUTH_SEC = 600; // 10分（倉庫 mj_w_reauth_ok）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // 倉庫 mj_w_uuid と同じ形
const isKan = (role) => role === 'kan' || role === 'owner';
/* 倉庫 mj_w_need と同じ（null＝通る・字＝足りない役・知らない who は閉じる） */
export function needOf(who, role) {
  if (who === 'nyu' || who === 'self' || who === 'self_or_kan') return null;
  if (who === 'kan' || who === 'owner_or_kan') return isKan(role) ? null : 'kan';
  if (who === 'owner') return role === 'owner' ? null : 'owner';
  return typeof who === 'string' ? who : 'none';
}
/* 倉庫 mj_w_reauth_ok と同じ＝amr の timestamp の最大（秒の数）が now − 600秒 以上。数でない・now が読めない＝false（閉じる側） */
export function reauthOk(reauthAt, now) {
  const n = Date.parse(now) / 1000;
  return typeof reauthAt === 'number' && Number.isFinite(reauthAt) && Number.isFinite(n) && reauthAt >= n - REAUTH_SEC;
}
/* ① 形（倉庫 mj_write ①）：object でない・op が字でない・知らない名＝bad at op／組の長さ>1 で部屋の op＝bad at op（2c-2c）／知らない鍵＝bad at 鍵 */
function formErr(op, len = 1) {
  if (!isObj(op) || !isStr(op.op) || !Object.hasOwn(KEYS, op.op)) return { ok: false, err: 'bad', at: 'op' };
  if (len > 1 && ROOM_OPS.includes(op.op)) return { ok: false, err: 'bad', at: 'op' };
  const allow = KEYS[op.op];
  for (const k of Object.keys(op)) if (k !== 'op' && !allow.includes(k)) return { ok: false, err: 'bad', at: k };
  return null;
}

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
/* mj_tobi_ok と同じ形：E1（A19）の新しい形 {r:[押した席・昇順・重なり無し・0〜n−1]}（鍵は r だけ・空も可）か、
 * 古い形＝鍵 '0'〜n−1・値は鍵と違う 0〜n−1 の整数か 'all'（飛んでいない席の鍵も弾かない・★お金に使わない＝押していない★） */
export function tobiShapeOk(t, n) {
  if (!isObj(t)) return false;
  if (Object.prototype.hasOwnProperty.call(t, 'r')) return Object.keys(t).length === 1 && tobiROk(t.r, n);
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
/* A13 §6：seen_cells の形（長さ n・どれも正しい点）＝壊れていれば bad */
function seenCellsOk(a, n) { return Array.isArray(a) && a.length === n && a.every(cellOk); }
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
/* やきとりの席（2c-3c）＝倉庫 mj_yaki_ok と同じ：配列・各が整数・0〜n−1・前より大きい（昇順・重なり無し） */
export const yakiOk = (y, n) => Array.isArray(y) && isInt(n) && y.every((v, i) => isInt(v) && v >= 0 && v < n && (i === 0 || v > y[i - 1]));
/* 欄が無い半荘＝[]・版1（欄は遅く作る＝倉庫の既定と同じ） */
export const yakiOf = (h) => (Object.prototype.hasOwnProperty.call(h, 'yakitori') ? h.yakitori : []);
/* 種の確かめ（2c-3b）＝倉庫の mahjong_private.mj_w_kind と同じ：'sum0'（合計0の種）／'out'（外へ払う種）／null（弾く）
 * 'chip'・'shugi'＝rules の *_pt10 が null なら null・他 'sum0'（rules が無い・鍵が無いも sum0）
 * 'c:<id>'＝rules.tane_custom が配列で id 一致が在る時だけ（pt10 の鍵の在りで判じない）・sum0 false＝'out'・他 'sum0'／それ以外＝null
 * 'yaki'（③-2・2c-3c'）＝yakiUsed(rules) の時だけ 'sum0'・他 null（pt 0 は使わない種＝入らない＝黙って0円にしない・write6_yaki_sadame.md v1.1 止め1）
 * 'tobi'（B2・tobi_chip_v3.md）＝tobiUsed(rules) の時だけ 'sum0'・他 null（yaki と同じ） */
export const CUST_KIND = /^c:[a-z0-9]{1,8}$/;
/* やきとりを使う種にする条件（倉庫の mj_w_kind・tstate と同じ1つの条件）＝yakitori が true かつ yakitori_pt が1以上の整数 */
export const yakiUsed = (rules) => isObj(rules) && rules.yakitori === true && isInt(rules.yakitori_pt) && rules.yakitori_pt >= 1;
/* 飛び賞を使う種にする条件（B2・倉庫の mj_w_kind・tstate と同じ1つの条件）＝tobi が true かつ tobi_pt が1以上の整数 */
export const tobiUsed = (rules) => isObj(rules) && rules.tobi === true && isInt(rules.tobi_pt) && rules.tobi_pt >= 1;
export function kindOf(rules, kind) {
  if (typeof kind !== 'string') return null;
  if (kind === 'chip' || kind === 'shugi') return isObj(rules) && rules[kind + '_pt10'] === null ? null : 'sum0';
  if (kind === 'yaki') return yakiUsed(rules) ? 'sum0' : null;
  if (kind === 'tobi') return tobiUsed(rules) ? 'sum0' : null;
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

/* ── C4（c4_sadame v3.3 §3・§3a）区切った卓の鎖 ──
 * followT＝新しく作る書き（hanchan_start・extra_add）の卓。区切られた卓（next_table_id）なら鎖の最後へ運ぶ（倉庫 mj_w_tfollow と同じ順と答え）：
 *   follow が在って真偽でない＝bad at follow／区切られた卓で follow:true でない＝bad at table_id（古い版を止める）／
 *   A20（a20_sadame v4 §5）hanchan_start で follow:false と書いた時だけ、区切られた卓にそのまま入る（押した時に見えていた卓）＝鍵が無いのは今まで通り bad at table_id／
 *   extra_add は鍵が違う区切り（split_same が true でない・欠けも）を通れば bad at table_id。卓が無い時は { t: undefined }（呼ぶ側の今の答え） */
export function followT(st, op) {
  let t = find(st.tables, 'table_id', op.table_id);
  if (!t) return { t };
  if (own(op, 'follow') && typeof op.follow !== 'boolean') return { bad: { ok: false, err: 'bad', at: 'follow' } };
  if (t.next_table_id == null) return { t };
  if (op.op === 'hanchan_start' && op.follow === false) return { t }; // A20 §5
  // P8（p8_sadame v4 §1-5）段の数で切らない・卓は Map で1回引く・一度見た卓に戻ったら（状態が壊れた時）bad
  const byId = new Map(st.tables.map((x) => [x.table_id, x]));
  const seen = new Set();
  while (t && t.next_table_id != null) {
    if (op.follow !== true) return { bad: { ok: false, err: 'bad', at: 'table_id' } };
    if (op.op === 'extra_add' && t.split_same !== true) return { bad: { ok: false, err: 'bad', at: 'table_id' } };
    if (seen.has(t.table_id)) return { bad: { ok: false, err: 'bad', at: 'table_id' } };
    seen.add(t.table_id);
    t = byId.get(t.next_table_id);
  }
  return t ? { t } : { bad: { ok: false, err: 'bad', at: 'table_id' } };
}
/* 卓の鎖（next_table_id でつながる卓の全部・頭から順）＝区切っていない卓は [自分]（倉庫 mj_w_chain と同じ）。
 * P8（p8_sadame v4 §1-5）段の数で切らない・Map を呼びごとに1回作る＝O(T＋L)。一度見た卓に戻ったら止めて配列に broken=true
 * （倉庫の形では起きない＝lib の状態が壊れた時の守り・正味の門は broken なら bad at table_id） */
export function tableChain(st, tableId) {
  const byId = new Map(), prev = new Map();
  for (const x of st.tables) { byId.set(x.table_id, x); if (x.next_table_id != null) prev.set(x.next_table_id, x.table_id); }
  let head = tableId, broken = false;
  const up = new Set([head]);
  while (prev.has(head)) { const p = prev.get(head); if (up.has(p)) { broken = true; break; } up.add(p); head = p; }
  const out = [head], seen = new Set([head]);
  for (;;) {
    const t = byId.get(out[out.length - 1]);
    if (!t || t.next_table_id == null) break;
    if (seen.has(t.next_table_id)) { broken = true; break; }
    seen.add(t.next_table_id); out.push(t.next_table_id);
  }
  if (broken) out.broken = true;
  return out;
}
/* 枚の値に効く鍵（§2-8・倉庫の table_rules と同じ7つ＋実際のレート） */
export const SPLIT_KEYS = Object.freeze(['chip_pt10', 'shugi_pt10', 'yakitori', 'yakitori_pt', 'tobi', 'tobi_pt', 'tane_custom']);

/* st を直接書き換える（呼ぶ側が写しを作る）。opts.now＝settle_snap の at（倉庫の now() の代わり） */
/* D2：rules の rate（数でなければ null＝倉庫の session_add と同じ読み） */
const rateOfRules = (r) => (isObj(r) && typeof r.rate === 'number' && Number.isInteger(r.rate) ? r.rate : null);

/* ── P5 §3（p5_sadame v1.3）分けた読み（st.v 3）：中身を読んだ開催＝st.loaded（無い st＝全部読み済み＝今と同じ） ──
 * 中身を読んでいない開催への op は ok にせず err 'unloaded'（at＝session_id／分からない時は table_id・hanchan_id と id）＝写しの上で黙って作らない */
const T_OPS = new Set(['table_add', 'table_edit', 'table_seats', 'table_rules', 'hanchan_start', 'extra_add', 'extra_set']);
const H_OPS = new Set(['cell_set', 'hanchan_order', 'kyotaku_set', 'tobi_set', 'hanchan_void', 'hanchan_unvoid', 'hanchan_seats']);
function unloadedOf(st, op) {
  if (!Array.isArray(st.loaded)) return null;
  const L = new Set(st.loaded);
  const allIn = st.sessions.every((x) => L.has(x.session_id));
  const un = (at, id) => ({ ok: false, err: 'unloaded', at, id });
  if ((op.op === 'table_add' || op.op === 'settle_snap') && isStr(op.session_id)) {
    return !L.has(op.session_id) && find(st.sessions, 'session_id', op.session_id) ? un('session_id', op.session_id) : null;
  }
  if (op.op === 'table_add') return null;
  if (T_OPS.has(op.op) && isStr(op.table_id)) {
    const t = find(st.tables, 'table_id', op.table_id);
    if (t) return L.has(t.session_id) ? null : un('session_id', t.session_id);
    return allIn ? null : un('table_id', op.table_id);
  }
  if (H_OPS.has(op.op) && isStr(op.hanchan_id)) {
    if (find(st.hanchans, 'hanchan_id', op.hanchan_id)) return null;
    return allIn ? null : un('hanchan_id', op.hanchan_id);
  }
  return null;
}
const opsOf = (outbox) => (Array.isArray(outbox) ? outbox : []).flatMap((it) => (isObj(it) && Array.isArray(it.ops) ? it.ops.filter(isObj) : []));
/* 卓・半荘の id から開催 id を引く＝置き換える前の写し（op を作った時の写し）と並びの前の op（table_add・hanchan_start・table_rules の新しい卓）から。引けなければ null */
export function sessionOfRef(st, outbox, at, id, depth = 0) {
  if (!isStr(id) || depth > 50) return null;
  if (at === 'session_id') return id;
  const ops = opsOf(outbox);
  let tid = id;
  if (at === 'hanchan_id') {
    const h = find(st.hanchans || [], 'hanchan_id', id);
    tid = h ? h.table_id : (ops.find((o) => o.op === 'hanchan_start' && o.hanchan_id === id) || {}).table_id;
  } else if (at !== 'table_id') return null;
  if (!isStr(tid)) return null;
  const t = find(st.tables || [], 'table_id', tid);
  if (t) return t.session_id;
  const ta = ops.find((o) => o.op === 'table_add' && o.table_id === tid);
  if (ta) return isStr(ta.session_id) ? ta.session_id : null;
  const tr = ops.find((o) => o.op === 'table_rules' && o.new_table_id === tid);
  return tr ? sessionOfRef(st, outbox, 'table_id', tr.table_id, depth + 1) : null;
}
/* mj_read 'room' の p_args（P5 §3 readArgs）＝{ v: 3, sessions, since? }
 * sessions＝開いている頁の開催＋並びの op が触る開催（★並びの session_add が作る開催は入れない＝倉庫にまだ無い★）・50 まで
 * since＝その組が全部 st.loaded（か倉庫が absent と返した id）の中に在る時だけ read_ver（違えば無し＝same で中身が来ない事を避ける）。loaded の無い写しは無し */
export function readArgs(st, outbox, pageSid, readVer) {
  const ops = opsOf(outbox);
  const made = new Set(ops.filter((o) => o.op === 'session_add').map((o) => o.session_id));
  const want = [];
  const add = (sid) => { if (typeof sid === 'string' && UUID.test(sid) && !made.has(sid) && !want.includes(sid)) want.push(sid); };
  add(pageSid);
  for (const o of ops) {
    if (o.op === 'session_add') continue;
    if (isStr(o.session_id)) add(o.session_id);
    if (isStr(o.table_id)) add(sessionOfRef(st, outbox, 'table_id', o.table_id));
    if (isStr(o.hanchan_id) && o.op !== 'hanchan_start') add(sessionOfRef(st, outbox, 'hanchan_id', o.hanchan_id));
  }
  const sessions = want.slice(0, 50);
  const known = isObj(st) && Array.isArray(st.loaded) ? new Set([...st.loaded, ...(Array.isArray(st.absent) ? st.absent : [])]) : null;
  const since = known && isInt(readVer) && readVer >= 0 && sessions.every((x) => known.has(x)) ? readVer : null;
  return since === null ? { v: 3, sessions } : { v: 3, sessions, since };
}

export function applyOp(st, op, opts = {}) {
  const fe = formErr(op);
  if (fe) return fe;
  const ul = unloadedOf(st, op);
  if (ul) return ul;
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
      // ③' を飛ばした op の役（倉庫 mj_w_role）＝リーグでない日は who_plain（nyu＝通る）・リーグの日の L は倉庫だけ
      const sc = opts.scope, isLg = op.league_id !== undefined && op.league_id !== null;
      if (isLg && !(typeof op.league_id === 'string' && UUID.test(op.league_id))) return { ok: false, err: 'bad', at: 'league_id' };
      if (isLg && !sc) return { ok: true }; // リーグの日＝scope でない写しは当てない（direct の組だけここへ来る）
      if (!isDate(op.date)) return { ok: false, err: 'bad', at: 'date' };
      const rate = op.rate === undefined ? null : op.rate;
      if (rate !== null && !(typeof rate === 'number' && Number.isInteger(rate) && Math.abs(rate) <= 2000000000)) return { ok: false, err: 'bad', at: 'rate' }; // 倉庫の mj_w_int と同じ（±20億の外は bad）
      if (rate !== null && !(rate >= 10 && rate <= M && rate % 10 === 0)) return { ok: false, err: 'range', at: 'rate' }; // A18 §1b
      if (op.place !== undefined && op.place !== null && (typeof op.place !== 'string' || [...op.place].length > 40)) return { ok: false, err: 'bad', at: 'place' };
      // D2 §2：scope（リーグの頁の写し）＝その scope のリーグの日だけ当てる（他のリーグ・league_id 無しは bad）・rate はリーグの主の rules の rate
      //   （op の rate は無いか同じ値だけ＝倉庫と同じ bad at rate）・新しい日の版＝scope の今の rules／rules_alt を days に足す。期間と重なりは倉庫だけ
      let rate2 = rate;
      if (sc) {
        if (!isLg || op.league_id !== sc.league_id) return { ok: false, err: 'bad', at: 'league_id' };
        const lr = rateOfRules(sc.rules);
        if (rate !== null && rate !== lr) return { ok: false, err: 'bad', at: 'rate' };
        rate2 = lr;
      }
      const s = { session_id: op.session_id, date: op.date, rate: rate2 };
      if (isStr(op.place)) s.place = op.place;
      st.sessions.push(s);
      if (Array.isArray(st.loaded) && !st.loaded.includes(op.session_id)) st.loaded.push(op.session_id); // P5：作った開催は中身も在る（続く table_add が当たる）
      if (sc) { if (!Array.isArray(sc.days)) sc.days = []; sc.days.push({ session_id: op.session_id, rules: sc.rules, rules_alt: sc.rules_alt ?? null }); }
      return { ok: true };
    }
    case 'table_add': {
      if (!isStr(op.table_id) || typeof op.label !== 'string') return { ok: false, err: 'bad' };
      if (find(st.tables, 'table_id', op.table_id)) return { ok: true };
      const s = find(st.sessions, 'session_id', op.session_id);
      if (!s || s.voided) return { ok: false, err: 'bad' };
      const lb = btrim(op.label);
      if ([...lb].length < 1 || [...lb].length > 20) return { ok: false, err: 'bad', at: 'label' };
      // D2 §2：alt（任意 bool）＝scope の写しで、その日の days に rules_alt が在る時だけ（他は倉庫と同じ bad at alt）
      //   scope の卓のルールは days のその日の版（リーグの今の版でない）・scope でない写しは部屋のルール（alt true は bad）
      if (op.alt !== undefined && op.alt !== null && typeof op.alt !== 'boolean') return { ok: false, err: 'bad', at: 'alt' };
      const alt = op.alt === true;
      let src = st.rules;
      if (opts.scope) {
        const d = (opts.scope.days || []).find((x) => x.session_id === s.session_id);
        if (!d) return { ok: false, err: 'bad', at: 'session_id' }; // その scope のリーグの日でない
        if (alt && !isObj(d.rules_alt)) return { ok: false, err: 'bad', at: 'alt' };
        src = alt ? d.rules_alt : d.rules;
      } else if (alt) return { ok: false, err: 'bad', at: 'alt' };
      const r = rulesOk(src);
      if (!r.ok) return { ok: false, err: 'bad', at: 'rules' }; // 倉庫では「部屋のルールが無い」
      st.tables.push({ table_id: op.table_id, session_id: s.session_id, label: lb, rules: r.rules, seats: [] });
      return { ok: true };
    }
    case 'hanchan_start': {
      if (!isStr(op.hanchan_id)) return { ok: false, err: 'bad' };
      if (find(st.hanchans, 'hanchan_id', op.hanchan_id)) return { ok: true };
      const ft = followT(st, op);   // C4：区切られていれば鎖の最後
      if (ft.bad) return ft.bad;
      const t = ft.t;
      if (!t || t.voided) return { ok: false, err: 'bad' };
      const R = t.rules, n = R.players;
      if (!Array.isArray(op.seats) || op.seats.length !== n || new Set(op.seats).size !== n || !op.seats.every((m) => { const x = find(st.members, 'member_id', m); return x && x.active; })) return { ok: false, err: 'bad', at: 'seats' };
      if (!Array.isArray(op.cells) || op.cells.length !== n || !op.cells.every(cellOk)) return { ok: false, err: 'range', at: 'cells' };
      const lost = op.lost === undefined || op.lost === null ? 0 : op.lost;
      if (!wInt(lost)) return { ok: false, err: 'bad', at: 'lost' }; // A18 §4：倉庫 mj_w_int が先
      if (!lostOk(R, lost)) return { ok: false, err: 'range', at: 'lost' };
      if (op.ton_order !== undefined && op.ton_order !== null && !sameMembers(op.ton_order, op.seats)) return { ok: false, err: 'bad', at: 'ton_order' };
      // A13 §6：seen_cells は付けるなら cells と同じ（違えば・形が壊れていれば bad）・付けなければ order_cells は null（古い PWA）
      const sc = op.seen_cells === undefined || op.seen_cells === null ? null : op.seen_cells;
      if (sc !== null && (!seenCellsOk(sc, n) || canon(sc) !== canon(op.cells))) return { ok: false, err: 'bad', at: 'seen_cells' };
      const tobi = op.tobi_to === undefined || op.tobi_to === null ? {} : op.tobi_to;
      if (!tobiShapeOk(tobi, n)) return { ok: false, err: 'bad', at: 'tobi_to' };
      const no = st.hanchans.filter((h) => h.table_id === t.table_id).length + 1;
      st.hanchans.push({
        hanchan_id: op.hanchan_id, table_id: t.table_id, no, seats: op.seats.slice(),
        cells: op.cells.slice(), cell_ver: new Array(n).fill(1),
        ton_order: op.ton_order ? op.ton_order.slice() : null, order_version: 1,
        lost, version: 1, tobi_to: { ...tobi }, tobi_version: 1, voided: false,
      });
      if (op.ton_order && sc !== null) st.hanchans[st.hanchans.length - 1].order_cells = sc.slice(); // 鍵は null でない時だけ（倉庫の読みと同じ）
      return { ok: true };
    }
    case 'cell_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h || !isInt(op.seat) || op.seat < 0 || op.seat >= h.cells.length) return { ok: false, err: 'bad' };
      if (!wInt(op.value)) return { ok: false, err: 'bad', at: 'value' }; // A18 §4：倉庫 mj_w_int が先（±20億の外は bad）
      if (!cellOk(op.value)) return { ok: false, err: 'range', at: 'value' };
      if (!wInt(op.base_version)) return { ok: false, err: 'bad', at: 'base_version' }; // 倉庫 mj_w_int＝同じ値より先
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
      if (!wInt(op.base_version)) return { ok: false, err: 'bad', at: 'base_version' }; // 倉庫 mj_w_int＝同じ値より先
      // A13 §6：seen_cells（保存した人が見た点）・[s3] seen_seats（見た席＝今と違えば conflict・何も書かない）
      const sc = op.seen_cells === undefined || op.seen_cells === null ? null : op.seen_cells;
      if (sc !== null && !seenCellsOk(sc, h.cells.length)) return { ok: false, err: 'bad', at: 'seen_cells' };
      const ss = op.seen_seats === undefined || op.seen_seats === null ? null : op.seen_seats;
      if (ss !== null && (!Array.isArray(ss) || ss.length !== h.seats.length || !ss.every(isStr))) return { ok: false, err: 'bad', at: 'seen_seats' };
      if (ss !== null && !ss.every((m, i) => m.toLowerCase() === h.seats[i].toLowerCase())) return conflict({ hanchan_id: h.hanchan_id, what: 'order' }, h.ton_order, h.order_version);
      const oc0 = own(h, 'order_cells') ? h.order_cells : null;
      if (canon(h.ton_order) === canon(op.ton_order) && canon(oc0) === canon(sc)) return { ok: true };
      if (op.base_version !== h.order_version) return conflict({ hanchan_id: h.hanchan_id, what: 'order' }, h.ton_order, h.order_version);
      h.ton_order = op.ton_order.slice(); h.order_version++;
      if (sc !== null) h.order_cells = sc.slice(); else delete h.order_cells;
      return { ok: true };
    }
    case 'kyotaku_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      const t = find(st.tables, 'table_id', h.table_id);
      if (!wInt(op.value)) return { ok: false, err: 'bad', at: 'value' }; // A18 §4：倉庫 mj_w_int が先
      if (!lostOk(t.rules, op.value)) return { ok: false, err: 'range', at: 'value' };
      if (!wInt(op.base_version)) return { ok: false, err: 'bad', at: 'base_version' }; // 倉庫 mj_w_int＝同じ値より先
      if (h.lost === op.value) return { ok: true };
      if (op.base_version !== h.version) return conflict({ hanchan_id: h.hanchan_id, what: 'lost' }, h.lost, h.version);
      h.lost = op.value; h.version++;
      return { ok: true };
    }
    case 'tobi_set': {
      const h = find(st.hanchans, 'hanchan_id', op.hanchan_id);
      if (!h) return { ok: false, err: 'bad' };
      if (!tobiShapeOk(op.tobi_to, h.cells.length)) return { ok: false, err: 'bad', at: 'tobi_to' };
      if (!wInt(op.base_version)) return { ok: false, err: 'bad', at: 'base_version' }; // 倉庫 mj_w_int＝同じ値より先
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
      const ft = followT(st, op);   // C4：鍵が同じ区切りだけ鎖の最後へ
      if (ft.bad) return ft.bad;
      const t = ft.t;
      const xg = extraGate(st, t, op);
      if (xg.bad) return xg.bad;
      if (!wInt(op.add) || op.add === 0) return { ok: false, err: 'bad', at: 'add' }; // 0 と数でない物は倉庫と同じ bad
      if (Math.abs(op.add) > EXTRA_MAX) return { ok: false, err: 'range', at: 'add' };
      const e = st.extras.find((x) => x.table_id === t.table_id && x.member_id === op.member_id && x.kind === op.kind);
      const nv = (e ? e.value : 0) + op.add;
      const was = e ? e.value : 0; // 古い写しの ±999 の外の行は 0 に近づく向きだけ通す（直せなくしない）
      if (Math.abs(nv) > EXTRA_MAX && !(Math.abs(was) > EXTRA_MAX && Math.abs(nv) < Math.abs(was))) return { ok: false, err: 'range', at: 'add' };
      if (xg.kd === 'out' && nv < 0) return { ok: false, err: 'bad', at: 'add' }; // 外へ払う種（2c-3b）は足した後が 0〜999（倉庫 :2017・:2028）
      if (e) { e.value = nv; e.version++; } else st.extras.push({ table_id: t.table_id, member_id: op.member_id, kind: op.kind, value: nv, version: 1 });
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
      if (h.ton_order !== null && !sameMembers(a, h.seats)) { h.ton_order = null; h.order_version++; delete h.order_cells; }
      // A13 §6 [s2]：人が同じ並べ替えだけなら order_cells を人に付けて動かす（新[新しい席(m)] = 前[前の席(m)]）
      else if (own(h, 'order_cells') && Array.isArray(h.order_cells) && h.order_cells.length === n) { const oc = h.order_cells; h.order_cells = a.map((m) => oc[h.seats.indexOf(m)]); }
      h.seats = a.slice();
      return { ok: true };
    }
    case 'table_seats': {
      // B1（b1_sadame_v2.md）＝倉庫の table_seats と同じ確かめ。古い写し（v2）の卓は seats が無い＝[] と読む・seats_version は持たない（:29）
      const t = isStr(op.table_id) ? find(st.tables, 'table_id', op.table_id) : null;
      const s = t ? find(st.sessions, 'session_id', t.session_id) : null;
      if (!t || t.voided || !s || s.voided) return { ok: false, err: 'bad', at: 'table_id' };
      const n = isObj(t.rules) ? t.rules.players : undefined, a = op.seats, cur = t.seats ?? [];
      if (!Array.isArray(a) || a.length !== n || !a.every(isStr) || new Set(a).size !== n) return { ok: false, err: 'bad', at: 'seats' };
      if (!a.every((id) => { const x = find(st.members, 'member_id', id); return x && (x.active || cur.includes(id)); })) return { ok: false, err: 'bad', at: 'seats' };
      if (cur.length === a.length && a.every((id, i) => cur[i] === id)) return { ok: true };
      t.seats = a.slice();
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
    case 'table_rules': {
      // C4（c4_sadame v3.3 §2）倉庫と同じ順：卓 → new_table_id（在れば続きの卓の時だけ ok）→ 取り消し → rules → 2回目 conflict（A20：人数は替えてよい） → 同じ rules は ok → 枚の鍵 → 合計0の門
      const t = isStr(op.table_id) ? find(st.tables, 'table_id', op.table_id) : null;
      if (!t) return { ok: false, err: 'bad', at: 'table_id' };
      if (!(typeof op.new_table_id === 'string' && UUID.test(op.new_table_id))) return { ok: false, err: 'bad', at: 'new_table_id' };
      if (find(st.tables, 'table_id', op.new_table_id)) return t.next_table_id === op.new_table_id ? { ok: true } : { ok: false, err: 'bad', at: 'new_table_id' };
      const s = find(st.sessions, 'session_id', t.session_id);
      if (t.voided === true || !s || s.voided === true) return { ok: false, err: 'bad', at: 'table_id' };
      const x = rulesOk(op.rules);
      if (!x.ok) return { ok: false, err: 'bad', at: 'rules' };
      const R = x.rules;
      if (t.next_table_id != null) return { ok: false, err: 'conflict', at: { table_id: t.table_id, what: 'next' }, cur: { next_table_id: t.next_table_id } };
      if (canon(R) === canon(t.rules)) return { ok: true };
      const nr = typeof R.rate === 'number' ? R.rate : null;
      const mode = nr === null ? 'none' : nr === s.rate ? 'session' : 'num';
      const nt = { table_id: op.new_table_id, session_id: t.session_id, label: t.label, rules: R, seats: isObj(t.rules) && R.players === t.rules.players ? (t.seats ?? []).slice() : [] }; // A20 §1-5：人数が違えば空（画面が table_seats で選び直す）
      if (mode !== 'session') nt.rate_mode = mode;
      if (mode === 'num') nt.rate = nr;
      const same = tableRate(t, s) === tableRate(nt, s) && SPLIT_KEYS.every((k) => canon(t.rules[k] ?? null) === canon(R[k] ?? null));
      if (!same) {
        const sums = new Map();
        for (const e of st.extras) if (e.table_id === t.table_id) sums.set(e.kind, (sums.get(e.kind) || 0) + e.value);
        const bad = [...sums].filter(([, v]) => v !== 0).map(([k]) => k).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (bad.length) return { ok: false, err: 'bad', at: 'extras', kind: bad[0] };
      }
      st.tables.push(nt);
      t.next_table_id = op.new_table_id; t.split_same = same;
      if (same) for (const e of st.extras) if (e.table_id === t.table_id) { e.table_id = op.new_table_id; e.version = 1; }
      return { ok: true };
    }
    // ── 人の op（2c-2b）＝形と在るだけ・状態は変えない（倉庫 mj_w_op 末尾と同じ順） ──
    case 'member_link':
    case 'member_unlink':
    case 'member_relink': {
      const m = isStr(op.member_id) ? find(st.members, 'member_id', op.member_id) : undefined;
      if (!m || (op.op !== 'member_unlink' && !m.active)) return { ok: false, err: 'bad', at: 'member_id' }; // unlink は active を見ない（倉庫と同じ）
      if (op.op === 'member_relink' && !(typeof op.user_id === 'string' && UUID.test(op.user_id))) return { ok: false, err: 'bad', at: 'user_id' };
      return { ok: true };
    }
    case 'role_set':
      if (typeof op.role !== 'string' || (op.role !== 'kan' && op.role !== 'nyu')) return { ok: false, err: 'bad', at: 'role' };
      if (!(typeof op.user_id === 'string' && UUID.test(op.user_id))) return { ok: false, err: 'bad', at: 'user_id' };
      return { ok: true };
    case 'account_remove':
      if (!(typeof op.user_id === 'string' && UUID.test(op.user_id))) return { ok: false, err: 'bad', at: 'user_id' };
      return { ok: true };
    // ── 部屋の op（2c-2c）＝状態は変えない（写しは rooms・room_accounts・持ち主・deleted_at・リーグを持たない） ──
    case 'room_leave':
    case 'room_delete':
    case 'room_undelete':
    case 'room_close':
      return { ok: true };   // 部屋なし・終えた部屋の弾き（bad kind・closed）は倉庫だけ（写しは kind・closed_at を持たない）
    case 'room_share':
      // 倉庫の順（段C v10.1）：kind（倉庫だけ）→ name（1〜40字・そろえて空でない）→ pass（そろえて数字4つ）→ url_token_hash。止め・数え・組の比べは倉庫だけ
      if (typeof op.name !== 'string' || [...btrim(op.name)].length < 1 || [...btrim(op.name)].length > 40 || !nameKey(btrim(op.name))) return { ok: false, err: 'bad', at: 'name' };
      if (!passOk4(op.pass)) return { ok: false, err: 'bad', at: 'pass' };
      if (typeof op.url_token_hash !== 'string' || !/^[0-9a-f]{64}$/.test(op.url_token_hash)) return { ok: false, err: 'bad', at: 'url_token_hash' };
      return { ok: true };
    case 'room_secret':
      // 倉庫の順：pass（段C＝NFKC でそろえた後に数字4つ）→ url_token_hash。same・組の比べ・他の部屋と同じ URL・部屋なしの bad kind は倉庫だけ（写しは緩い側）
      if (!passOk4(op.pass)) return { ok: false, err: 'bad', at: 'pass' };
      if (typeof op.url_token_hash !== 'string' || !/^[0-9a-f]{64}$/.test(op.url_token_hash)) return { ok: false, err: 'bad', at: 'url_token_hash' };
      return { ok: true };
    // ── リーグの op（2c-2d1）＝league_id の形だけ・状態は変えない（中身・L・版・上限は倉庫だけ） ──
    case 'league_create':
    case 'league_save':
    case 'league_owner_set':
      if (!(typeof op.league_id === 'string' && UUID.test(op.league_id))) return { ok: false, err: 'bad', at: 'league_id' };
      return { ok: true };
  }
  return { ok: false, err: 'bad', at: 'op' };
}

/* ── ③-0 境目の門（yakitori_custom_v1.md v7〜v7.3）＝★部屋ごとに1回だけ判じ、だめなら部屋を丸ごと読むだけ★ ──
 * newer＝先の版の形（st.v が 1・2 の外／知らない rules の鍵／知らない extras の kind／半荘の知らない欄）
 * rules_bad＝知っている鍵だけなのに値が壊れている（rulesOk が落ちる・rules が object でない）
 * どちらもお金の数を1つも出さない・書かない（一部の卓だけ読めても部屋ごと止める＝読める卓だけで精算すると額が黙って違う）。
 * 部屋の rules は★引数 roomRules（サーバから来た room.rules）だけ★を見る＝st.rules は見ない（emptyState や古い写しは持たない）。 */
const RULE_SET = new Set(RULE_KEYS.map((k) => k.key));
const EXTRA_KINDS = new Set(['chip', 'shugi', 'yaki', 'tobi']);
const KNOWN_H = new Set(['hanchan_id', 'table_id', 'no', 'seats', 'cells', 'cell_ver', 'ton_order', 'order_version', 'lost', 'version', 'tobi_to', 'tobi_version', 'voided', 'yakitori', 'yakitori_version', 'order_cells']);   // A13 §6 order_cells＝形が壊れていても newer にせず「覆っていない」と読む（orderCovered）
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
const rateOk = (r) => typeof r === 'number' && Number.isInteger(r) && r >= 10 && r <= M && r % 10 === 0; // A18 §1b
// A18 §2：窓の数のどれか1つでも null（safe の外）
const winNull = (w) => ['big', 'pt10', 'chipBig', 'shugiBig', 'yakiBig', 'tobiBig', 'outBig', 'hanPt10'].some((k) => w[k] === null);
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
const vOk = (v) => v === undefined || v === 1 || v === 2 || v === 3; // 3＝P5 の分けた読み（loaded・absent・members の n／last）
/* 形を直した後の写し（v===2）を見る。roomRules が undefined なら部屋の rules の判じだけ飛ばす */
export function roomGate(st, roomRules) {
  if (!isObj(st) || !vOk(st.v)) return { mode: 'newer', why: 'v' };
  if (roomRules !== undefined) { const g = rulesGate(roomRules); if (g) return g; }
  for (const t of st.tables || []) { const g = isObj(t) ? rulesGate(t.rules) || rateGate(t) : { mode: 'rules_bad', why: '(object)' }; if (g) return g; }
  for (const s of st.sessions || []) { const g = sessionGate(s); if (g) return g; }
  // 種＝chip・shugi・自由な項目 c:<id> の形（卓の tane_custom に無い id の行は newer にせず数えない＝倉庫の tstate と同じ）
  for (const e of st.extras || []) if (!isObj(e) || !(EXTRA_KINDS.has(e.kind) || (typeof e.kind === 'string' && CUST_KIND.test(e.kind)))) return { mode: 'newer', why: 'kind' };
  for (const h of st.hanchans || []) if (!isObj(h) || Object.keys(h).some((k) => !KNOWN_H.has(k))) return { mode: 'newer', why: 'hanchan' };
  // やきとりの欄（2c-3c）：在るなら2つそろって形が正しい（players は卓の rules から＝cells が壊れた半荘でも落ちない）
  for (const h of st.hanchans || []) {
    const hy = own(h, 'yakitori'), hv = own(h, 'yakitori_version');
    if (!hy && !hv) continue;
    const t = (st.tables || []).find((x) => isObj(x) && x.table_id === h.table_id);
    const n = t && isObj(t.rules) ? t.rules.players : undefined;
    if (hy !== hv || !yakiOk(h.yakitori, n) || !(isInt(h.yakitori_version) && h.yakitori_version >= 1)) return { mode: 'rules_bad', why: 'yakitori' };
  }
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
  const no = (i, res) => ({ ok: false, idx: i, res: { ...res, i }, state: st });
  // ① 形（全部の op を先に＝後ろの op の鍵の誤りが前の op の中身の誤りより先＝倉庫と同じ）
  for (let i = 0; i < ops.length; i++) { const fe = formErr(ops[i], ops.length); if (fe) return no(i, fe); }
  // 人の op は並びに積まない（写しだけの弾き・v1.1 S1）
  if (opts.direct !== true) for (let i = 0; i < ops.length; i++) if (PERSON_OPS.includes(ops[i].op)) return no(i, { ok: false, err: 'direct' });
  // ③' 役の門（役が無い＝nyu に倒す）
  const role = opts.role === undefined ? 'nyu' : opts.role;
  for (let i = 0; i < ops.length; i++) { if (!ROLE_AT_GATE(ops[i].op)) continue; const need = needOf(WHO[ops[i].op], role); if (need !== null) return no(i, { ok: false, err: 'mj_role', need }); }
  // D2 §2：scope の写しで L でない＝WHO_LEAGUE が L の op は並びに積まない（held を作らない）
  if (isObj(opts.scope) && opts.scope.isL !== true) for (let i = 0; i < ops.length; i++) if (WHO_LEAGUE[ops[i].op] === 'L') return no(i, { ok: false, err: 'mj_role', need: 'L' });
  // リーグの日の session_add は並びに積まない（写しはリーグのルール・L を持たない）＝scope の写しは applyOp がそのリーグの日だけ当てる（他のリーグは bad・D2 §2）
  if (opts.direct !== true) for (let i = 0; i < ops.length; i++) if (ops[i].op === 'session_add' && typeof ops[i].league_id === 'string' && UUID.test(ops[i].league_id) && !isObj(opts.scope)) return no(i, { ok: false, err: 'direct' });
  // C4 table_rules は並びに積まない（画面はその場で送る・c4_sadame §2）
  if (opts.direct !== true) for (let i = 0; i < ops.length; i++) if (ops[i].op === 'table_rules') return no(i, { ok: false, err: 'direct' });
  // ③'' 入り直しの門（re＝grant は role_set で role kan の時だけ）
  let ra;
  for (let i = 0; i < ops.length; i++) {
    const re = RE[ops[i].op];
    if (re === 'yes' || (re === 'owner' && role === 'owner') || (re === 'grant' && ops[i].op === 'role_set' && ops[i].role === 'kan') || !['no', 'yes', 'owner', 'grant'].includes(re)) {
      if (ra === undefined) ra = reauthOk(opts.reauthAt, opts.now);
      if (!ra) return no(i, { ok: false, err: 'mj_reauth', within_min: 10 });
    }
  }
  const next = clone(st);
  // D2 §2：scope の days は組が通った時だけ増やす（組の写しの days に足し・返しの days で渡す＝呼ぶ側が scope.days を置き換える）
  if (isObj(opts.scope)) opts = { ...opts, scope: { ...opts.scope, days: Array.isArray(opts.scope.days) ? opts.scope.days.slice() : [] } };
  const before = new Map(next.hanchans.map((h) => [h.hanchan_id, h.cells.slice()]));
  const touched = new Set(), whole = new Set();
  // 正味の門：この組で値が変わった extras の行（倉庫の history の行と同じ）＝{ t, m, kind, i：最後に変えた extra の op（無ければ 0＝移しだけ） }
  //   b（組の前）は st・a（組の後）は next から読む。C4：extra_add は運んだ先の卓の行・table_rules の移しは前と後の卓の行を両方数える
  const rows = new Map();
  const rowIn = (S, t, m, kind) => S.extras.find((x) => x.table_id === t && x.member_id === m && x.kind === kind);
  const mark = (t, m, kind, i) => { const k = canon([t, m, kind]); const p = rows.get(k); rows.set(k, { t, m, kind, i: i === null ? (p ? p.i : 0) : i }); };
  for (let i = 0; i < ops.length; i++) {
    const o0 = ops[i];
    const isX = isObj(o0) && (o0.op === 'extra_add' || o0.op === 'extra_set');
    const tid = isX ? (o0.op === 'extra_add' ? followT(next, o0).t : find(next.tables, 'table_id', o0.table_id))?.table_id : undefined;
    const pre = isX ? rowIn(next, tid, o0.member_id, o0.kind) : undefined, preV = pre ? pre.value : null;
    const moved = o0.op === 'table_rules' ? next.extras.filter((x) => x.table_id === o0.table_id).map((x) => [x.member_id, x.kind]) : [];
    const had = o0.op === 'table_rules' && !!find(next.tables, 'table_id', o0.new_table_id);
    const r = applyOp(next, ops[i], opts);
    if (!r.ok) return { ok: false, idx: i, res: { ...r, i }, state: st };
    if (isX) {
      const post = rowIn(next, tid, o0.member_id, o0.kind), postV = post ? post.value : null;
      if (postV !== preV) mark(tid, o0.member_id, o0.kind, i);
    }
    if (o0.op === 'table_rules' && !had && find(next.tables, 'table_id', o0.table_id)?.split_same === true) {
      for (const [m, kind] of moved) { mark(o0.table_id, m, kind, null); mark(o0.new_table_id, m, kind, null); }
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
    if (isObj(h.tobi_to) && Object.prototype.hasOwnProperty.call(h.tobi_to, 'r')) continue; // E1：押した人の形は点を直しても変えない（倉庫の mj_w_tobi_fix と同じ）
    for (const s of now) if (!was.includes(s) && h.tobi_to[String(s)] !== undefined) { delete h.tobi_to[String(s)]; drop = true; }
    if (drop) h.tobi_version++;
  }
  // 正味の門（v1510:195①・倉庫 mj_write の組の終わりと同じ）＝C4 §3a（v3.3 T2）鎖ごと・人と種ごと：
  //   B＝組の前の行の値の合計（全部行が無ければ null）・A＝組の後の合計（無い行は0）。鎖のどの卓の取り消していない半荘の席にも
  //   卓の席（B1）にもいない人は、0 へ近づき 0 を越えない時だけ通す（行の無かった人への足しは弾く）。席にいる人は ±999 の範囲だけ（op で見た）
  //   見る順も倉庫と同じ：鎖の頭（table_id の字順）→ kind → member_id・返す i はその組の行の i の最大
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const groups = new Map();
  for (const x of rows.values()) {
    const ch = tableChain(next, x.t), k = canon([ch[0], x.kind, x.m]);
    const b0 = rowIn(st, x.t, x.m, x.kind), a0 = rowIn(next, x.t, x.m, x.kind);
    const g = groups.get(k) || { head: ch[0], ch, m: x.m, kind: x.kind, B: null, A: 0, i: 0 };
    if (b0) g.B = (g.B ?? 0) + b0.value;
    g.A += a0 ? a0.value : 0;
    g.i = Math.max(g.i, x.i);
    groups.set(k, g);
  }
  const order = [...groups.values()].sort((a, b) => cmp(a.head, b.head) || cmp(a.kind, b.kind) || cmp(a.m, b.m));
  for (const g of order) {
    if (g.ch.broken) return { ok: false, idx: g.i, res: { ok: false, err: 'bad', at: 'table_id', i: g.i }, state: st };   // P8：鎖が壊れた時は通さない
    const seated = next.hanchans.some((h) => g.ch.includes(h.table_id) && !h.voided && h.seats.includes(g.m))
      || g.ch.some((tid) => ((find(next.tables, 'table_id', tid) || {}).seats ?? []).includes(g.m));
    if (!seated && (g.B === null || Math.abs(g.A) > Math.abs(g.B) || g.A * g.B < 0)) {
      return { ok: false, idx: g.i, res: { ok: false, err: 'bad', at: 'member_id', i: g.i }, state: st };
    }
  }
  return opts.scope ? { ok: true, state: next, days: opts.scope.days } : { ok: true, state: next };
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
  if (st0.v === 2 || st0.v === 3) return done(st0, false, roomRules); // P5：v2 は loaded 無し＝全部読み済みのまま（並びも捨てない）
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

/* ── 1つの半荘の答え（pt・入っていない訳） ──
 * E1（A19・e_sadame v2）：飛び賞は半荘の pt に入る＝pt10＝basePt10（素点・ウマ・オカ）＋tobiPt10（tobiPt・tobi_to {r}）。
 * 押していない・古い鍵の形＝飛び賞 0（待たない）。tobi_to の形が違う＝why 'tobi_to'。busted＝飛んだ席（bustedSeats） */
export function hanchanView(rules, h) {
  // A13 §6：保存した人が見ていない同点は覆わない＝order を渡さない（同点なら why 'order'・倉庫の hstate と同じ）
  const order = orderCovered(rules, h.cells, h.ton_order, own(h, 'order_cells') ? h.order_cells : null) ? orderIdx(h) || undefined : undefined;
  const g = hanchanPt(rules, h.cells, { order, lost: h.lost });
  if (!g.ok) {
    if (g.err === 'sum') return { ok: false, why: 'sum', diff: g.got - g.want };
    return { ok: false, why: g.err };
  }
  const tb = tobiPt(rules, h.cells, { to: h.tobi_to });
  if (!tb.ok) return { ok: false, why: 'tobi_to' };
  const pt10 = g.pt10.map((x, i) => x + tb.pt10[i]);
  if (pt10.reduce((a, x) => a + x, 0) !== 0) throw new Error('半荘の pt（飛び賞込み）の合計が 0 でない（計算の穴）');
  return { ok: true, pt10, basePt10: g.pt10, tobiPt10: tb.pt10, rank: g.rank, busted: bustedSeats(rules, h.cells) };
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
const BUILTIN = new Set(['chip', 'shugi', 'yaki', 'tobi']);
/* P8：ix＝viewIndex(st)（省けば今まで通り find）＝鎖の段ごとに全部の卓・半荘・枚を見直さない。答えと並びは同じ */
export function viewIndex(st) {
  const by = (list, key) => { const m = new Map(); for (const x of list) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const one = (list, key) => { const m = new Map(); for (const x of list) if (!m.has(x[key])) m.set(x[key], x); return m; };
  return { t: one(st.tables, 'table_id'), s: one(st.sessions, 'session_id'), m: one(st.members, 'member_id'), h: by(st.hanchans, 'table_id'), e: by(st.extras, 'table_id') };
}
export function tableView(st, tableId, ix) {
  const t = ix ? ix.t.get(tableId) : find(st.tables, 'table_id', tableId);
  if (!t) return null;
  const s = ix ? ix.s.get(t.session_id) : find(st.sessions, 'session_id', t.session_id);
  const EX = ix ? (ix.e.get(tableId) || []) : st.extras;
  const R = t.rules, rate = tableRate(t, s);
  const hs = ix ? (ix.h.get(tableId) || []) : st.hanchans.filter((h) => h.table_id === tableId);
  const people = [];
  const see = (m) => { if (!people.includes(m)) people.push(m); };
  for (const h of hs) if (!h.voided) h.seats.forEach(see);
  // 自由な項目（2c-3b）＝卓の tane_custom の並びの順。数えるのは並びに在る id の行だけ（倉庫の tstate と同じ）
  const tane = isObj(R) && Array.isArray(R.tane_custom) ? R.tane_custom.filter((x) => isObj(x) && typeof x.id === 'string') : [];
  const custKinds = new Set(tane.map((x) => 'c:' + x.id));
  // 人＝chip・shugi・yaki の 0 でない行（使わない種も今まで通り）と、数える c: の 0 でない行（外へ払う種も入る）
  // E1：種 tobi の古い行は数えない（人も足さない・飛び賞は半荘の pt に入った）
  for (const e of EX) if (e.table_id === tableId && e.value !== 0 && e.kind !== 'tobi' && (BUILTIN.has(e.kind) || custKinds.has(e.kind))) see(e.member_id);
  const name = (m) => { const x = ix ? ix.m.get(m) : find(st.members, 'member_id', m); return x ? x.name : '?'; };
  const total10 = Object.fromEntries(people.map((m) => [m, 0]));
  const rows = [];
  const complete = [];
  const missing = [];
  for (const h of hs) {
    const v = h.voided ? { ok: false, why: 'void' } : hanchanView(R, h);
    const cellsBy = {};
    h.seats.forEach((m, i) => { cellsBy[m] = { cell: h.cells[i], pt10: v.pt10 ? v.pt10[i] : null, basePt10: v.basePt10 ? v.basePt10[i] : null, tobiPt10: v.tobiPt10 ? v.tobiPt10[i] : null, rank: v.rank ? v.rank[i] : null, seat: i }; });
    rows.push({ hanchan_id: h.hanchan_id, no: h.no, voided: h.voided, ok: v.ok, why: v.ok ? null : v.why, diff: v.diff, seats: v.seats, by: cellsBy });
    if (v.ok) {
      h.seats.forEach((m, i) => { total10[m] += v.pt10[i]; });
      complete.push({ members: h.seats.slice(), pt10: v.pt10 });
    } else if (!h.voided) missing.push({ no: h.no, why: v.why, diff: v.diff });
  }
  // ③-2：やきとり＝extras の種 'yaki'（chip と同じ・卓で人ごとに ±・合計0・1枚＝yakitori_pt×10）。yakiUsed でない卓（false か pt 0）は使わない種＝数えない
  // E1：飛び賞は半荘の pt に入る＝extras の種 'tobi' の行は数えない（used.tobi false・窓の tobi・tobiPt10・tobiBig は 0＝sessionView・リーグの和で二重にしない）
  const used = { chip: R.chip_pt10 !== null, shugi: R.shugi_pt10 !== null, yaki: yakiUsed(R), tobi: false };
  const yakiPt10 = used.yaki ? R.yakitori_pt * 10 : null;
  const tobiPt10 = null;
  const ex = { chip: {}, shugi: {}, yaki: {}, tobi: {} };
  for (const e of EX) if (e.table_id === tableId && BUILTIN.has(e.kind)) ex[e.kind][e.member_id] = e.value;
  const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const chipSum = used.chip ? sumOf(ex.chip) : 0;
  const shugiSum = used.shugi ? sumOf(ex.shugi) : 0;
  const yakiSum = used.yaki ? sumOf(ex.yaki) : 0;
  // 各 c: の種：ng＝合計0の種で合計≠0（倉庫の extra_state ng と同じ）／合計0の種のお金は chip と同じに pt10 へ足す（③-2）
  // wait＝★外へ払う種（sum0 false）で 0 でない行が在る★＝画面に「払う額」の欄ができるまで止めて警告（v2.1 止め2・外す日は画面と同じ押し）。1つの種に missing は1件（ng を先に）
  const cust = tane.map((x) => {
    const kind = 'c:' + x.id;
    const xs = EX.filter((e) => e.table_id === tableId && e.kind === kind);
    const sum = xs.reduce((a, e) => a + e.value, 0);
    const ng = x.sum0 !== false && sum !== 0;
    const by = {};
    for (const e of xs) by[e.member_id] = e.value;
    return { kind, name: x.name, pt10: x.pt10, sum0: x.sum0 !== false, sum, ng, wait: x.sum0 === false && xs.some((e) => e.value !== 0), by };
  });
  const custWait = cust.some((c) => c.wait);
  const extrasOk = chipSum === 0 && shugiSum === 0 && yakiSum === 0 && !cust.some((c) => c.ng);
  const toBig = (pt10) => (rate === null ? pt10 : mulS(pt10, rate / 10)); // A18 §2：safe の外は null
  const windows = people.map((m) => {
    const chip = used.chip ? (ex.chip[m] || 0) : 0, shugi = used.shugi ? (ex.shugi[m] || 0) : 0, yaki = used.yaki ? (ex.yaki[m] || 0) : 0;
    const yakiPt = yaki * (yakiPt10 || 0);
    const tobi = used.tobi ? (ex.tobi[m] || 0) : 0, tobiAmt = tobi * (tobiPt10 || 0);
    const custPt10 = cust.reduce((a, c) => a + (c.sum0 ? (c.by[m] || 0) * c.pt10 : 0), 0);
    const out10 = cust.reduce((a, c) => a + (c.sum0 ? 0 : (c.by[m] || 0) * c.pt10), 0);
    const extra10 = chip * (R.chip_pt10 || 0) + shugi * (R.shugi_pt10 || 0) + yakiPt + tobiAmt + custPt10;
    const pt10 = total10[m] + (extrasOk ? extra10 : 0);
    return {
      member_id: m, name: name(m), pt10, big: toBig(pt10), unit: rate === null ? 'pt' : 'ten', dim: !extrasOk || custWait,
      chip, shugi, chipBig: toBig(chip * (R.chip_pt10 || 0)), shugiBig: toBig(shugi * (R.shugi_pt10 || 0)),
      hanPt10: total10[m], chipPt10: chip * (R.chip_pt10 || 0), shugiPt10: shugi * (R.shugi_pt10 || 0),
      yaki, yakiPt10: yakiPt, yakiBig: toBig(yakiPt), tobi, tobiPt10: tobiAmt, tobiBig: toBig(tobiAmt), custPt10, out10, outBig: toBig(out10),
    };
  });
  if (!extrasOk) {
    if (chipSum !== 0) missing.push({ what: 'chip', diff: chipSum });
    if (shugiSum !== 0) missing.push({ what: 'shugi', diff: shugiSum });
    if (yakiSum !== 0) missing.push({ what: 'yaki', diff: yakiSum });
  }
  // missing の並び＝chip → shugi → yaki → c:（tane_custom の並びの順・倉庫の extras の理由の順と同じ）
  for (const c of cust) {
    if (c.ng) missing.push({ what: c.kind, name: c.name, diff: c.sum });
    else if (c.wait) missing.push({ what: c.kind, name: c.name, why: 'not_yet' });
  }
  const tableForSeisan = {
    rate, chip_pt10: R.chip_pt10, shugi_pt10: R.shugi_pt10, hanchans: complete,
    chips: used.chip && chipSum === 0 ? { ...ex.chip } : undefined,
    shugis: used.shugi && shugiSum === 0 ? { ...ex.shugi } : undefined,
    yaki_pt10: yakiPt10, yakis: used.yaki && yakiSum === 0 ? { ...ex.yaki } : undefined,
    customs: cust.filter((c) => c.sum0 && !c.ng).map((c) => ({ pt10: c.pt10, counts: { ...c.by } })),
    outs: cust.filter((c) => !c.sum0).map((c) => ({ pt10: c.pt10, counts: { ...c.by } })),
  };
  return {
    table_id: tableId, rules: R, rate, date: s ? s.date : null, people: people.map((m) => ({ member_id: m, name: name(m) })),
    seatPeople: (t.seats ?? []).map((m) => ({ member_id: m, name: name(m) })), // B1＝卓の席の順（画面の名前の列だけ・お金の判じには使わない）
    rows, total10, windows, used, chipSum, shugiSum, yakiSum, extrasOk, cust, custWait, missing, tableForSeisan,
    bigNg: windows.some(winNull), // A18 §2：窓の印1つ（画面はこれだけを見る）
    nextNo: hs.length + 1,
  };
}

/* ── C4 §5a 対局の頁は鎖で1つ（画面だけの読み出し・お金の式は卓ごとの tableView のまま・倉庫は変えない） ──
 * chainView(st, tableId)＝tableId の鎖（tableChain）の全部の卓をまとめた形（鎖の最後の卓の tableView を元に）：
 *   rows＝鎖の順→卓の中の no の順・no は★通し番号★（1〜）・tno＝卓の中の no・table_id＝その回の卓
 *   people＝鎖の卓の people の和＋最後でない卓の seats（最後の卓の seats は今まで通り seatPeople）
 *   total10・windows の pt10／big／hanPt10＝鎖の卓の和（big はレートのある卓だけ・最後の卓がレートなしなら pt10 の和）
 *   windows の枚の数と額（chip・chipBig…）＝最後の卓の値（± の送り先＝最後の卓）・dim＝どれかの卓が合わない
 *   nextNo＝鎖の回の数＋1・splits＝最後でない卓ごと { table_id, upto（その卓までの通し番号）, same（split_same） }・parts＝卓ごとの tableView */
export function chainView(st, tableId) {
  const ix = viewIndex(st);
  if (!ix.t.get(tableId)) return null;
  const ch = tableChain(st, tableId);
  const parts = ch.map((tid) => tableView(st, tid, ix)).filter(Boolean);
  const last = parts[parts.length - 1];
  const rows = [], splits = [], people = [];
  const see = (p) => { if (!people.some((x) => x.member_id === p.member_id)) people.push(p); };
  const name = (m) => { const x = ix.m.get(m); return x ? x.name : '?'; };
  parts.forEach((p, i) => {
    const nt = ix.t.get(p.table_id).next_table_id != null ? ix.t.get(ix.t.get(p.table_id).next_table_id) : null;
    const cut = nt && typeof nt.created_at === 'string' ? Date.parse(nt.created_at) : NaN;
    for (const r of p.rows) {
      const h = find(st.hanchans, 'hanchan_id', r.hanchan_id);
      const at = h && typeof h.created_at === 'string' ? Date.parse(h.created_at) : NaN;
      // A20 §1-1・§9 任意3：前の卓の回で、作った時刻が続きの卓より後＝ルールを変える前に保存した回（倉庫の読みの created_at で決める）
      rows.push({ ...r, no: rows.length + 1, tno: r.no, table_id: p.table_id, late: at > cut });
    }
    p.people.forEach(see);
    if (i < parts.length - 1) {
      for (const m of ix.t.get(p.table_id).seats ?? []) see({ member_id: m, name: name(m) });
      splits.push({ table_id: p.table_id, upto: rows.length, same: ix.t.get(p.table_id).split_same === true });
    }
  });
  const total10 = Object.fromEntries(people.map((p) => [p.member_id, parts.reduce((a, v) => (v.total10[p.member_id] === undefined ? a : addS(a, v.total10[p.member_id])), 0)]));
  const rated = last.rate !== null;
  const windows = people.map((p) => {
    const lw = last.windows.find((w) => w.member_id === p.member_id);
    const base = lw ? { ...lw } : { member_id: p.member_id, name: p.name, chip: 0, shugi: 0, chipBig: 0, shugiBig: 0, chipPt10: 0, shugiPt10: 0, yaki: 0, yakiPt10: 0, yakiBig: 0, tobi: 0, tobiPt10: 0, tobiBig: 0, custPt10: 0, out10: 0, outBig: 0, unit: rated ? 'ten' : 'pt' };
    let pt10 = 0, big = 0, han = 0, dim = false;
    for (const v of parts) {
      const w = v.windows.find((x) => x.member_id === p.member_id);
      if (!w) continue;
      pt10 = addS(pt10, w.pt10); han = addS(han, w.hanPt10); dim = dim || w.dim;
      if (!rated) big = addS(big, w.pt10); else if (v.rate !== null) big = addS(big, w.big);
    }
    return { ...base, pt10, big, hanPt10: han, dim: dim || parts.some((v) => !v.extrasOk || v.custWait) };
  });
  return {
    ...last, people, rows, total10, windows, chain: ch, parts, splits,
    bigNg: parts.some((v) => v.bigNg) || windows.some(winNull), // A18 §2：…last の後に、つないだ窓の印を合わせて置く
    extrasOk: parts.every((v) => v.extrasOk), nextNo: rows.length + 1,
    broken: ch.broken === true,   // P8：和はそのまま・壊れた鎖の印だけ足す
  };
}

/* ── 開催日の精算（そろった半荘とそろった卓のチップ・祝儀だけ） ── */
/* 部屋を開いた時に続ける開催（司さん 11-20 19時「時間にすんなや・清算押したらその対局が終わる・常に保存が普通」）
 * 区切りは人が精算の画面で［対局終了］を押した時だけ（＝その開催に settle_snap が1つでもある）
 * 時間・日付・中身の比べで推し量らない＝押すまでは何日空いても続き・日を跨いでも続き・終えた開催は消さない
 * 返り＝続ける session_id／null＝新しく作る */
export function pickSession(st) {
  const ss = (st.sessions || []).filter((s) => !s.voided && s.league_id == null); // A15 §1.2b：リーグの日は見ない（既定の読みにリーグの日は来ない・リーグの頁の日は league_id を持たない＝今の動きは変わらない）
  if (!ss.length) return null;
  const last = ss[ss.length - 1];
  const ended = (st.settles || []).some((x) => x.session_id === last.session_id);
  return ended ? null : last.session_id;
}
/* A15g：その部屋の最後の開催を［対局終了］で終えたか＝続きの部屋に出さない（倉庫 mj_my_rooms p_open の §1.2b と同じ判じ） */
export function roomEnded(st) {
  return (st.sessions || []).some((s) => !s.voided && s.league_id == null) && pickSession(st) === null;
}
/* A15g §2：続きの部屋のカードの数＝定義は a15_sadame §1.3 そのまま（倉庫 mj_my_rooms と同じ答え・期待値は tests/fixtures/card-counts.json）
 * 最後の開催＝リーグでない・voided でない開催の最後（pickSession と同じ並び）
 * 卓＝部屋を開いた時に出る卓（gamen-room の firstTable）＝その開催の卓を st の並びで、voided でなくどの卓の next でもない頭の1つ目・無ければその開催の卓の1つ目
 * hanchan_n＝その鎖の卓の半荘の数（voided の卓・半荘も数える＝chainView rows と同じ数・ルールを読まずに数える）
 * member_n＝鎖の voided でない半荘に座った人（重なり除く）・0 なら鎖の最後の卓の seats の値の人数
 * 返り＝{ last_date, hanchan_n, member_n }（開催が無ければ last_date null・卓が無ければ 0／0） */
const seatIds = (x) => (x && typeof x === 'object' ? Object.values(x) : []).filter((m) => typeof m === 'string' && m);
export function cardCounts(st) {
  const tables = st.tables || [];
  const ss = (st.sessions || []).filter((x) => !x.voided && x.league_id == null);
  const last = ss[ss.length - 1];
  if (!last) return { last_date: null, hanchan_n: 0, member_n: 0 };
  const day = tables.filter((t) => t.session_id === last.session_id);
  const head = day.find((t) => !t.voided && !tables.some((x) => x.next_table_id === t.table_id)) || day[0];
  if (!head) return { last_date: last.date ?? null, hanchan_n: 0, member_n: 0 };
  const ch = tableChain(st, head.table_id), inChain = new Set(ch);
  const who = new Set();
  let n = 0;
  for (const h of st.hanchans || []) if (inChain.has(h.table_id)) { n++; if (!h.voided) for (const m of seatIds(h.seats)) who.add(m); }
  if (!who.size) { const lt = tables.find((x) => x.table_id === ch[ch.length - 1]) || head; for (const m of seatIds(lt.seats)) who.add(m); }
  return { last_date: last.date ?? null, hanchan_n: n, member_n: who.size };
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
  if (Array.isArray(st.loaded) && !st.loaded.includes(sessionId)) return { ok: false, err: 'unloaded', name, missing: [], noRateTables: [] }; // P5：頭だけの開催は額を出さない
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
  const at = (o, m) => (o[m] === undefined ? 0 : o[m]); // A18：null は数と違う＝変わった人に出す
  return keys.filter((m) => at(a, m) !== at(b, m));
}
/* 精算の画面の「1人ずつ」の数（S2 v1.1 止め4）＝取り消していない・レートのある卓だけ（レートなしの卓の pt は pt10NoRate の節だけに出す）
 * by[人]＝{ han, n, chip, chip10, shugi, shugi10, yaki, yaki10, tobi, tobi10, cust10, out10, kei:{ レート: pt10 } }（Σ kei[r]×r/10 ＝ 精算の ten・out10 は kei に入れない＝外へ払う種）
 * rates＝数えた卓のうち半荘かチップ・祝儀が1つでも在る卓のレート（重ねない・小さい順）
 * count＝取り消していない卓の取り消していない半荘（レートなしの卓も数える）・tables＝取り消していない卓の数 */
export function sessionBreakdown(st, sessionId) {
  const s = find(st.sessions, 'session_id', sessionId);
  // P5：頭だけの開催は数えない（by・order・rates・count は空で残す＝画面が !ok より前に読む）
  if (Array.isArray(st.loaded) && !st.loaded.includes(sessionId)) return { ok: false, err: 'unloaded', sid: sessionId, date: s ? s.date : null, by: {}, order: [], count: 0, used: { chip: false, shugi: false, yaki: false, tobi: false }, rates: [], tables: 0 };
  const live = st.tables.filter((t) => t.session_id === sessionId && !t.voided);
  const by = {}, order = [], rates = [];
  let count = 0;
  const used = { chip: false, shugi: false, yaki: false, tobi: false };
  for (const t of live) {
    const v = tableView(st, t.table_id);
    count += v.rows.filter((r) => !r.voided).length;
    if (v.rate === null) continue;
    if ((v.rows.some((r) => r.ok) || v.windows.length) && !rates.includes(v.rate)) rates.push(v.rate);
    if (v.used.chip && v.extrasOk) used.chip = true;
    if (v.used.shugi && v.extrasOk) used.shugi = true;
    if (v.used.yaki && v.extrasOk) used.yaki = true;
    if (v.used.tobi && v.extrasOk) used.tobi = true;
    for (const w of v.windows) {
      if (!by[w.member_id]) { by[w.member_id] = { han: 0, n: 0, chip: 0, chip10: 0, shugi: 0, shugi10: 0, yaki: 0, yaki10: 0, tobi: 0, tobi10: 0, cust10: 0, out10: 0, kei: {} }; order.push(w.member_id); }
      const b = by[w.member_id];
      b.han += w.hanPt10; b.n += v.rows.filter((r) => r.ok && r.by[w.member_id]).length;
      let k = w.hanPt10;
      if (v.extrasOk) { b.chip += w.chip; b.chip10 += w.chipPt10; b.shugi += w.shugi; b.shugi10 += w.shugiPt10; b.yaki += w.yaki; b.yaki10 += w.yakiPt10; b.tobi += w.tobi; b.tobi10 += w.tobiPt10; b.cust10 += w.custPt10; k += w.chipPt10 + w.shugiPt10 + w.yakiPt10 + w.tobiPt10 + w.custPt10; }
      b.out10 += w.out10;
      addK(b.kei, v.rate, k);
    }
  }
  rates.sort((x, y) => x - y);
  // A18 §2：額は lib が持つ（keiBig＝kei×rate/10）・どれか1つでも null なら bigNg
  let bigNg = live.some((t) => { const v = tableView(st, t.table_id); return v && v.rate !== null && v.bigNg; });
  for (const m of order) {
    const b = by[m];
    b.keiBig = Object.fromEntries(Object.keys(b.kei).map((r) => [r, mulS(b.kei[r], Number(r) / 10)]));
    if (Object.values(b.kei).some((x) => x === null) || Object.values(b.keiBig).some((x) => x === null)) bigNg = true;
  }
  return { sid: sessionId, date: s ? s.date : null, by, order, count, used, rates, tables: live.length, bigNg };
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
