/* write.live.mjs — ★書く入口 public.mj_write を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * 案 mahjong_tataki_2026-11-20/write_sekkei.md v5.2 の「試験」§8 ⓪〜⑨・⑧'：
 *  ⓪ ログイン無し → mj_session・anon と PUBLIC に EXECUTE が無い・下請けは客から呼べない
 *  ① 一本道（member_add×4 → session_add → table_add → hanchan_start → cell_set で崩す → 戻す → extra_add ± → settle_snap）
 *  ② 弾き（別の人の op_id・別の部屋の id・同じ id の作る op・3人卓の seat 3・知らない鍵・league_id・not_yet 4個・31個・知らない op）
 *  ③ 範囲 ④ 版 ⑤ 飛び賞 ⑥ そろった後 ⑦ チップ・祝儀（11通り・倉庫と lib〔画面の lib/room-state.mjs の tableView〕に同じ表を通す）
 *  ⑦' 2c-2a1（紙 write2_sekkei.md v3.3）＝卓の一度そろった（first_complete_at）・卓の印・正味の門（v1510:195①）・使わない種と取り消した開催日・前の組の締め
 *  ⑪ 2c-2a2（作り write_2c2a2_tsukuri.md）＝直す op 6個（member_rename・member_active・session_edit・table_edit・hanchan_seats・extra_set）と印・版
 *  ⑫ 2c-3b（紙 write3_sekkei.md §3）＝自由な項目の枚 c:<id>  ⑬ 2c-3c’（write6_yaki_sadame.md v1.1）＝やきとりは extras の種 'yaki'（使う＝yakitori true かつ pt≥1・合計0・理由は yaki が c: より先・op yakitori_set は無い）
 *  ⑭ 2c-2b（紙 write4_sekkei.md v1〜v1.2・write4_shiken_keikaku.md）＝人の op 5つ（member_link・member_unlink・member_relink・role_set・account_remove）・役の門 mj_role・入り直しの門 mj_reauth（jwt の amr 10分）・名乗り member_claims
 *  ⑮ 2c-2c（紙 write5_sadame.md v1.1）＝部屋の op 4つ（room_leave・room_delete・room_undelete・room_secret）・K-3 の継ぎ（段1＝持ち主のアカウントが消えた時）・組に1つだけ
 *  ⑯ 2c-2d1（紙 write7_league_sadame_v11.md）＝リーグの op 3つ・役は op の中の mj_w_role・リーグのルールの版・上限 leagues／rule_sets・人ごと24時間5本・消えた L の継ぎ
 *  ⑩ 2c-2a0＝範囲の端の表 tests/fixtures/write-cases.json を倉庫に流す（want_db ?? want と ok／err だけ比べる・弾いた組は何も書かない）
 *  ⑧ 数え（先見・後見の busy・internal と一時の失敗・古い窓・入と管が別）⑧' 上限 ⑨ 送り直し・部屋・last_seen
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝仮の人・部屋・trigger も全部戻る）。
 * ★now() が取引の中で止まる＝節ごとに write:* の行を消してから始める（1分の上限の偽の赤を出さない）★
 * ★lib の比べ＝この repo の lib/room-state.mjs（gamen-1 は 5290b84 で main に入った）を読む。MJ_GAMEN_LIB で別の置き場を指せる。無ければ赤（未測定）★
 * 使い方: node tests/write.live.mjs            … 試験
 *         node tests/write.live.mjs --kari     … ★倉庫に当てる前の schema.sql の 2c-2a2 の列と関数を塊の頭で当てて回す（塊ごと戻る＝倉庫を汚さない・--waza とも組める）★
 *         node tests/write.live.mjs --waza     … ★わざと壊して狙った試験が赤になるか★（WAZA の全部を1つずつ壊す・先に素の回りが緑か見る・壊した関数は塊と一緒に戻る）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const url = /url:\s*'([^']+)'/.exec(src)[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1];
/* ★倉庫の門（設計 I-6）★ ref の sha256 の頭16字で照らす＝khaw でなければ1行も呼ばずに止める */
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const MAIL = 'mj-write.invalid';
const PASS = '2741';   // 段C：作る・替えるパスは数字4つ
const N_U = 11;                               // 1＝A・C・E・F の持ち主 2＝A の入 3＝A の管 4＝入っていない人 5＝出す人 6＝B の持ち主 7＝空き 8〜11＝⑭ で A に足す人 xu1〜4
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated')::text, true);`;
const U = () => crypto.randomUUID();
const RS = `delete from mahjong.limits where kind like 'write:%';`;

/* ── op を SQL の jsonb で組む（版は倉庫の今の値を引く） ── */
const S = (sql) => ({ sql });
const V = (v) => (v && typeof v === 'object' && 'sql' in v ? v.sql : `${lit(JSON.stringify(v))}::jsonb`);
const O = (name, f = {}) => `jsonb_build_object('op', '${name}'${Object.entries(f).map(([k, v]) => `, '${k}', ${V(v)}`).join('')})`;
const A = (...xs) => `jsonb_build_array(${xs.join(', ')})`;
const cv = (h, seat) => S(`(select to_jsonb(version) from mahjong.cells where hanchan_id = '${h}' and seat = ${seat})`);
const hv = (h) => S(`(select to_jsonb(version) from mahjong.hanchans where id = '${h}')`);
const tv = (h) => S(`(select to_jsonb(tobi_version) from mahjong.hanchans where id = '${h}')`);
const cs = (h, seat, value) => O('cell_set', { hanchan_id: h, seat, value, base_version: cv(h, seat) });
const ma = (id, name) => O('member_add', { member_id: id, name });

/* 数え（呼びの前後で比べる・部屋の変数 v） */
const LS = (k) => `(select coalesce(sum(count), 0) from mahjong.limits where kind = 'write:${k}')`;
const CNT = (v) => `jsonb_build_object('rc', (select row_count from mahjong.rooms where id = ${v}), 'hc', (select history_count from mahjong.rooms where id = ${v}),
  'h', (select count(*) from mahjong.history where room_id = ${v}), 'op', (select count(*) from mahjong.op_results where room_id = ${v}),
  'm', (select count(*) from mahjong.members where room_id = ${v}), 'x', (select coalesce(sum(e.value), 0) from mahjong.extras e join mahjong.tables t on t.id = e.table_id where t.room_id = ${v}),
  'ur', ${LS('ur1m')}, 'u', ${LS('u1m')}, 'rn1m', ${LS('rn1m')}, 'all1m', ${LS('all1m')},
  'un', ${LS('un1d')}, 'ud', ${LS('u1d')}, 'uk', ${LS('uk1d')}, 'rk', ${LS('rk1d')}, 'all1d', ${LS('all1d')}, 'rn', ${LS('rn1d')})`;
const W = (key, who, room, ops, opid) => `${asWho(who)}
  cx := ${CNT(room)};
  begin r := public.mj_write(${room}, ${opid ? `'${opid}'::uuid` : 'gen_random_uuid()'}, ${ops}); exception when others then r := jsonb_build_object('raised', sqlerrm); end;
  res := res || jsonb_build_object('${key}', r, '${key}_c0', cx, '${key}_c1', ${CNT(room)});`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const HR = (h) => `select jsonb_build_object('state', state, 'why', state_reason, 'fc', first_complete_at is not null, 'ch', changed_after_complete_at is not null,
  'cb', changed_by_user, 'v', version, 'tobi', tobi_to, 'tv', tobi_version, 'voided', voided, 'seats', seats, 'ov', order_version, 'ton', ton_order, 'lost', lost_kyotaku)
  from mahjong.hanchans where id = '${h}'`;
const TR = (t) => `select jsonb_build_object('c', chip_state, 's', shugi_state, 'e', extra_state) from mahjong.tables where id = '${t}'`;
const TX = (t) => `select jsonb_build_object('e', extra_state, 'fc', first_complete_at is not null, 'ch', changed_after_complete_at is not null, 'cb', changed_by_user) from mahjong.tables where id = '${t}'`;
/* 塊の中だけで書いて戻す */
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
/* 直に書いて sqlstate を持ち帰る */
const st8 = (key, body) => `
  begin
    ${body}
    res := res || jsonb_build_object('${key}', 'none');
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}', sqlstate); end if;
  end;`;

/* ── 部屋の中の id（JS で作る） ── */
const MA = [U(), U(), U(), U(), U()];         // A の人（4 は席にいない人）
const SA = U(), TA = U(), HA1 = U(), HA2 = U();
const MB = [U(), U(), U()], SB = U(), TB = U(), HB = U();
const MC = [U(), U(), U(), U()], SC = U(), MEm = [U(), U(), U(), U()], SE = U(), MF = [U(), U(), U(), U()], SF = U();
const OP_M4 = U(), OPX = U();
const C4 = [25000, 25000, 25000, 25000];
/* ①' 並び：MX＝部屋の active な人だが席にいない（顔ぶれの比べ p_set だけが弾く）・HA3＝並び無しの同点・HA4＝ton_order つきで始める */
const MX = U(), HA3 = U(), HA4 = U();
/* ⑦' 2c-2a1：[卓, 半荘]（部屋 A・開催日 SA・席は MA[0..3]・MA[4] は席にいない人） */
const PN = [U(), U()], PP = [U(), U()], PQ = [U(), U()], GN = [U(), U()], SV = [U(), U()], SW = [U(), U()];
const xa = (T, who, add, kind = 'chip') => O('extra_add', { table_id: T[0], member_id: typeof who === 'number' ? MA[who] : who, kind, add });
/* ⑫ 2c-3b 自由な項目（write3_sekkei.md §3）：ra のルールに tane_custom を塊の中だけ足す（並びは ko・ba・ke＝id の順と違う＝理由が並びの順か見る） */
const TC = [{ id: 'ko', name: 'コイン', pt10: 5, sum0: true }, { id: 'ba', name: '場代', pt10: 10, sum0: false }, { id: 'ke', name: '景品', pt10: 3, sum0: true }];
const C3N = [U(), U()], C3P = [U(), U()], C3Q = [U(), U()];
/* ⑬ 2c-3c’ やきとり＝extras の種 'yaki'（write6_yaki_sadame.md v1.1）：Y1・Y2 使う卓（pt 10）・Y3 pt 0 の卓・Y4 yakitori false の卓 */
const Y1 = [U(), U()], Y2 = [U(), U()], Y3 = [U(), U()], Y4 = [U(), U()];
/* ⑯ B2 段1 飛び賞＝extras の種 'tobi'（tobi_chip_v3.md）：B1・B2 使う卓（tobi true・pt 10）・B3 pt 0 の卓・B4 tobi false の卓 */
const B1 = [U(), U()], B2 = [U(), U()], B3 = [U(), U()], B4 = [U(), U()];
/* ⑰ B1 卓の席 op table_seats（b1_sadame_v2.md v2.1）：TS＝半荘0の卓・TSV＝取り消す卓 */
const TS = U(), TSV = U();
/* ⑤'' E2（A21・e_sadame v2 §E2）：TE＝E2 だけの卓（開催日 SA）・HE1〜HE3＝その卓の回 */
const TE = U(), HE1 = U(), HE2 = U(), HE3 = U();
const hsE = (h, cells, x = {}) => O('hanchan_start', { hanchan_id: h, table_id: TE, seats: MA.slice(0, 4), cells, ...x });
const csE = (h, seat, value, bv) => O('cell_set', { hanchan_id: h, seat, value, base_version: bv });
const NCE = (h) => `select count(*) from mahjong.cells where hanchan_id = '${h}'`;
/* mj_read の2つの組み立て（素の room・v3）から回を1つ引く（cells・cell_ver） */
const RDE = (h, v3) => `select jsonb_build_object('c', x -> 'cells', 'v', x -> 'cell_ver') from (select jsonb_path_query_first(public.mj_read(ra, 'room', '${v3 ? '{"v":3}' : '{}'}'::jsonb),
  '$.** ? (@.hanchan_id == "${h}" && exists(@.cell_ver))') x) q`;
const TSR = (t) => `select jsonb_build_object('seats', seats, 'sv', seats_version, 'v', version) from mahjong.tables where id = '${t}'`;
const tse = (t, seats) => O('table_seats', { table_id: t, seats });
const YR = (o) => `update mahjong.rule_sets set rules = rules || ${lit(JSON.stringify(o))}::jsonb where id = (select rule_set_id from mahjong.rooms where id = ra);`;
const TK = (t) => `select jsonb_build_object('c', chip_state, 's', shugi_state, 'e', extra_state, 'why', extra_reason, 'fc', first_complete_at is not null) from mahjong.tables where id = '${t}'`;
const XSUM = (t, kind) => `select coalesce(sum(value), 0) from mahjong.extras where table_id = '${t}' and kind = '${kind}'`;
const mkT = (T, cells = C4) => [O('table_add', { table_id: T[0], session_id: SA, label: 'p' }), O('hanchan_start', { hanchan_id: T[1], table_id: T[0], seats: MA.slice(0, 4), cells })];
const ov = (h) => S(`(select to_jsonb(order_version) from mahjong.hanchans where id = '${h}')`);
const TON4 = [MA[1], MA[0], MA[3], MA[2]];
/* ⑧' op_results の消す順：Q1 は op_id が一番小さく、Q2 は一番大きいが at が一番古い＝at の順なら Q2 が消え、op_id の順なら Q1 が消える */
const OPQ1 = '00000000-0000-4000-8000-000000000001', OPQ2 = 'ffffffff-ffff-4fff-bfff-fffffffffffe', OPQ3 = U();
const BIG = 'x'.repeat(33000);
/* 32KB ちょうど：content {"big": "x…"} は n+11 字・used {} と missing [] は2字ずつ＝n+15 = 32768（倉庫で re5_len を数えて確かめる） */
const EDGE = 'x'.repeat(32768 - 15);
/* N7（write2_sekkei.md）鍵の多い中身＝鍵 500 個（k000〜k499・値「あ」3バイト）＋ p に x の詰め。倉庫の jsonb::text は「: 」「, 」に空白が入る＝
 * 鍵 500 個で 2 + 500×13 + 499×2 = 7,500・p の行は n+7 と区切り2・used と missing で 4 → 7,513 + n = 32,768 で n = 25,255（倉庫で many_len を数えて確かめる）。
 * 写し（JSON.stringify の UTF-8）は空白が無い＝同じ中身を 1,000 バイトほど短く数える＝写しが通しても倉庫は range を返す（写しの注の向き）。 */
const MANY = (n) => Object.fromEntries([['p', 'x'.repeat(n)], ...Array.from({ length: 500 }, (_, i) => ['k' + String(i).padStart(3, '0'), 'あ'])]);
const MANY_N = 25255;
/* ⑪ 2c-2a2：人 K1・K2（部屋 A に足す）・卓 [卓, 半荘]（開催日 SA・席は MA[0..3]）・KN は合計が合わない卓（そろっていない） */
const C4D = [40000, 30000, 20000, 10000];   // 同点の無い素点（並びが要らない＝そろう）
const K1 = U(), K2 = U(), KT = [U(), U()], KV = [U(), U()], KN = [U(), U()], KS = [U(), U()], KX = [U(), U()], KW = [U(), U()];
const KY = [U(), U()], KQ = [U(), U()], KR = [U(), U()], KZ = [U(), U()];   // 止めの直し（X1 KY・X4 KQ KR・止め3 KZ）
const TL = (t) => `select jsonb_build_object('label', label, 'mode', rate_mode, 'rate', rate, 'voided', voided, 'v', version, 'fc', first_complete_at is not null,
  'ch', changed_after_complete_at is not null) from mahjong.tables where id = '${t}'`;
const SV2 = (h) => `select jsonb_build_object('sv', seats_version, 'v', version, 'ov', order_version, 'ton', ton_order, 'seats', seats, 'ch', changed_after_complete_at is not null) from mahjong.hanchans where id = '${h}'`;
const MR = (m) => `select jsonb_build_object('name', name, 'key', name_key, 'active', active, 'v', version) from mahjong.members where id = '${m}'`;
const xs2 = (T, who, value, bv, kind = 'chip') => O('extra_set', { table_id: T[0], member_id: typeof who === 'number' ? MA[who] : who, kind, value, base_version: bv });
const HCOL = (key, col) => `select count(*) from mahjong.history where row_key ->> 'id' = '${key}' and col = '${col}'`;
const SNAPREV = S(`(select to_jsonb(coalesce(max(rev), 0) + 1) from mahjong.settle_snaps where session_id = '${SA}')`);
/* ⑦ チップ・祝儀の11通り：[名, 部屋, chip_pt10, shugi_pt10, 卓, 半荘, extras[[人, 種, 足す]], 席にいない人の行, 答え[c, s, e]] */
const CASES = [
  ['c0 extras 0行の新しい卓（半荘なし）', 'rc', 10, 10, U(), null, [], null, ['ok', 'ok', 'ok']],
  ['c1 両方使う・行が無い', 'rc', 10, 10, U(), U(), [], null, ['ok', 'ok', 'ok']],
  ['c2 両方0', 'rc', 10, 10, U(), U(), [[0, 'chip', 1], [1, 'chip', -1], [0, 'shugi', 2], [1, 'shugi', -2]], null, ['ok', 'ok', 'ok']],
  ['c3 チップだけ合い祝儀が合わない', 'rc', 10, 10, U(), U(), [[0, 'chip', 1], [1, 'chip', -1], [0, 'shugi', 2], [1, 'shugi', -1]], null, ['ok', 'ng', 'ng']],
  ['c10 両方合わない', 'rc', 10, 10, U(), U(), [[0, 'chip', 1], [0, 'shugi', 1]], null, ['ng', 'ng', 'ng']],
  ['c4 チップ +1 だけ（祝儀は使わない）', 'ra', 10, null, U(), U(), [[0, 'chip', 1]], null, ['ng', 'unused', 'ng']],
  ['c9 チップ +5 −2', 'ra', 10, null, U(), U(), [[0, 'chip', 5], [1, 'chip', -2]], null, ['ng', 'unused', 'ng']],
  ['c8 席にいない人の行も合計に入る', 'ra', 10, null, U(), U(), [[0, 'chip', 1]], -1, ['ok', 'unused', 'ok']],
  ['c5 チップ null・祝儀 +1 −1', 're', null, 10, U(), U(), [[0, 'shugi', 1], [1, 'shugi', -1]], null, ['unused', 'ok', 'ok']],
  ['c6 両方 null・行が無い', 'rf', null, null, U(), U(), [], null, ['unused', 'unused', 'ok']],
  ['c7 チップ null なのにチップの行 +3', 'rf', null, null, U(), U(), [[0, 'chip', 3]], null, ['unused', 'unused', 'ok']],
];
const RM = { ra: { m: MA, s: SA }, rc: { m: MC, s: SC }, re: { m: MEm, s: SE }, rf: { m: MF, s: SF } };
const HC_ALL = U(), TC_ALL = U();             // C（tobi_from all）で飛んだ半荘
const setupOps = (room) => {
  const { m, s } = RM[room];
  const xs = [];
  if (room !== 'ra') { m.forEach((id, i) => xs.push(ma(id, 'p' + i))); xs.push(O('session_add', { session_id: s, date: '2026-11-20', rate: null })); }
  else xs.push(ma(MA[4], '戊'));
  CASES.filter((c) => c[1] === room).forEach((c) => {
    xs.push(O('table_add', { table_id: c[4], session_id: s, label: c[0].slice(0, 3) }));
    if (c[5]) xs.push(O('hanchan_start', { hanchan_id: c[5], table_id: c[4], seats: m.slice(0, 4), cells: C4 }));
  });
  if (room === 'rc') {
    xs.push(O('table_add', { table_id: TC_ALL, session_id: s, label: 'all' }));
    xs.push(O('hanchan_start', { hanchan_id: HC_ALL, table_id: TC_ALL, seats: m.slice(0, 4), cells: [60000, 30000, 20000, -10000] }));
  }
  return A(...xs);
};
const extraOps = (room) => A(...CASES.filter((c) => c[1] === room).flatMap((c) => c[6].map(([who, kind, add]) => O('extra_add', { table_id: c[4], member_id: RM[room].m[who], kind, add }))));
const NAMES31 = ['member_add', 'session_add', 'table_add', 'hanchan_start', 'hanchan_order', 'cell_set', 'tobi_set', 'kyotaku_set', 'extra_add', 'settle_snap', 'hanchan_void', 'hanchan_unvoid',
  'member_rename', 'member_active', 'session_edit', 'table_edit', 'hanchan_seats', 'table_seats', 'extra_set',
  'member_link', 'member_unlink', 'member_relink', 'role_set', 'account_remove', 'room_leave', 'room_delete', 'room_undelete', 'room_secret', 'room_share', 'room_close',   // 段C で2つ
  'league_create', 'league_save', 'league_owner_set',
  'table_rules'];   // C4 で足した（中身の試験は tests/c4.live.mjs）
/* ⑮ 2c-2c 部屋の op 4つ（write5_sadame.md v1.1）：⑭ の H14 で人と名簿の人をそろえる・送り直しは決めた op_id で */
const WAo = (key, who, amr, room, ops, opid) => W(key, who, room, ops, opid).replace(asWho(who), asWhoA(who, amr));
const OPL = U(), OPD = U(), OPS = U();
const H1 = crypto.randomBytes(32).toString('hex');
const PASS2 = '8360';   // 段C：数字4つ
const sec = (pass, url) => O('room_secret', { pass, url_token_hash: url });
const RL = O('room_leave'), RD = O('room_delete'), RU = O('room_undelete');
const LG = (name, who, voided = false) => `insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id, voided) values ('${U()}', ra, '${name}', (select rule_set_id from mahjong.rooms where id = ra), (select rule_version from mahjong.rooms where id = ra), us[${who}], ${voided});`;
const JA = (who, ago) => `update mahjong.room_accounts set joined_at = now() - interval '${ago}' where room_id = ra and user_id = us[${who}];`;
const JOIN = (key, who, pass) => `${asWho(who)} r := public.mj_room_join('pass', v_no, null, ${lit(pass)}); res := res || jsonb_build_object('${key}', r);`;
const ST15 = (key) => ROW(key, `select jsonb_build_object(
    'lu', (select jsonb_agg(m.user_id order by x.o) from unnest(array[${L.map((id) => `'${id}'::uuid`).join(', ')}]) with ordinality x(id, o) left join mahjong.members m on m.id = x.id),
    'ra', (select jsonb_object_agg(a.user_id, a.role) from mahjong.room_accounts a where a.room_id = ra),
    'bans', (select jsonb_agg(b.user_id) from mahjong.room_bans b where b.room_id = ra),
    'cl', (select jsonb_agg(jsonb_build_array(c.member_id, c.user_id)) from mahjong.member_claims c where c.room_id = ra),
    'own', (select owner_user_id from mahjong.rooms where id = ra), 'del', (select deleted_at is not null from mahjong.rooms where id = ra),
    'ch', (select channel_key from mahjong.rooms where id = ra), 'url', (select url_token_hash from mahjong.rooms where id = ra),
    'lg', (select jsonb_agg(l.owner_user_id order by l.name) from mahjong.leagues l where l.room_id = ra))`);
/* ⑯ 2c-2d1 リーグの op 3つ（write7_league_sadame_v11.md）：GA〜GH＝リーグの id・GS*＝開催日・GT*＝卓 */
const [GA, GB, GC, GE, GF, GH] = [U(), U(), U(), U(), U(), U()];
const [GS1, GS2, GS3, GS4, GS5, GS6, GT2, GT3, GT4, GT5] = Array.from({ length: 10 }, U);
const R4 = { players: 4 }, R4b = { players: 4, chip_pt10: 10 }, R3 = { players: 3, kyotaku_end: 'kieru' };
const lc = (id, f = {}) => O('league_create', { league_id: id, name: 'リ', date_from: '2026-11-01', date_to: '2026-11-30', players_main: 4, rules: R4, ...f });
const lgv = (id) => S(`(select to_jsonb(version) from mahjong.leagues where id = '${id}')`);
const lsv = (id, f = {}) => O('league_save', { league_id: id, base_version: lgv(id), ...f });
const sad = (sid, lid) => O('session_add', { session_id: sid, date: '2026-11-21', rate: null, league_id: lid });
const tad = (tid, sid) => O('table_add', { table_id: tid, session_id: sid, label: 'リ卓' });
const GL = (id, who, room = 'ra', voided = false) => `insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id, voided) values ('${id}', ${room}, 'g', (select rule_set_id from mahjong.rooms where id = ${room}), (select rule_version from mahjong.rooms where id = ${room}), us[${who}], ${voided});`;
const LGR = (id) => `select jsonb_build_object('own', owner_user_id::text, 'by', created_by::text, 'rv', rule_version, 'rva', rule_version_alt, 'alt', rule_set_id_alt is not null, 'v', version, 'name', name) from mahjong.leagues where id = '${id}'`;
const SSR = (sid, lid) => `select jsonb_build_object('lg', rule_set_id = (select rule_set_id from mahjong.leagues where id = '${lid}'), 'room', rule_set_id = (select rule_set_id from mahjong.rooms where id = room_id), 'rv', rule_version) from mahjong.sessions where id = '${sid}'`;
/* ⑭ 2c-2b 人の op 5つ（write4_sekkei.md v1〜v1.2）：人 8〜11＝足す人 xu1〜4（各節の頭で ra の room_accounts へ nyu で直に入れる）・L0〜L9＝各節の頭で足す名簿の人
 *  入り直しの jwt＝asWhoA（asWho に amr を足す）。FRESH は古い otp と新しい password（max を見るか）・OLD＝601秒前・空・字の timestamp・字の amr */
/* ⑯' D2 §4（d2_sadame v1.1）：DL1＝主4人(rate 100)＋alt 3人・DL2＝主だけ・DS*＝開催日・DT*＝卓 */
const [DL1, DL2, DS1, DS2, DS3, DT1, DT2, DT3, DT4] = Array.from({ length: 9 }, U);
const DT7 = Array.from({ length: 7 }, U), DT11 = U();
const R4r = { players: 4, rate: 100 }, R3b = { players: 3, kyotaku_end: 'kieru', chip_pt10: 10 };
const sadD = (sid, lid, f = {}) => O('session_add', { session_id: sid, date: '2026-11-21', rate: null, league_id: lid, ...f });
const tadA = (tid, sid, alt) => O('table_add', { table_id: tid, session_id: sid, label: 'リ卓', alt });
/* 卓のルール＝開催日の主（sm）か alt（sa）の版か・人数 */
const TRD = (t, sid) => `select jsonb_build_object('p', t.players, 'sm', t.rule_set_id = s.rule_set_id and t.rule_version = s.rule_version,
  'sa', t.rule_set_id = s.rule_set_id_alt and t.rule_version = s.rule_version_alt) from mahjong.tables t, mahjong.sessions s where t.id = '${t}' and s.id = '${sid}'`;
const SLD = (sid, lid) => `select jsonb_build_object('rate', s.rate, 'alt', s.rule_set_id_alt is not null, 'same', (s.rule_set_id_alt, s.rule_version_alt) = (l.rule_set_id_alt, l.rule_version_alt),
  'main', (s.rule_set_id, s.rule_version) = (l.rule_set_id, l.rule_version)) from mahjong.sessions s, mahjong.leagues l where s.id = '${sid}' and l.id = '${lid}'`;
const L = Array.from({ length: 10 }, () => U());
const UJ = (i) => S(`to_jsonb(us[${i}]::text)`);
const asWhoA = (i, amr) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', ${amr})::text, true);`;
const EP = `floor(extract(epoch from now()))`;
const AMR = {
  fresh: `jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', ${EP} - 3000), jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5))`,
  old: `jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 601))`,
  empty: `'[]'::jsonb`,
  strts: `jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', (${EP})::text))`,
  str: `to_jsonb('password'::text)`,
};
const WA = (key, who, amr, room, ops) => W(key, who, room, ops).replace(asWho(who), asWhoA(who, amr));
const LU = (i, who) => `update mahjong.members set user_id = us[${who}] where id = '${L[i]}';`;
const CL = (i, who) => `insert into mahjong.member_claims (room_id, member_id, user_id) values (ra, '${L[i]}', us[${who}]);`;
const lk = (i) => O('member_link', { member_id: L[i] });
const ul = (i) => O('member_unlink', { member_id: L[i] });
const rl = (i, who) => O('member_relink', { member_id: L[i], user_id: UJ(who) });
const rset = (who, role) => O('role_set', { user_id: UJ(who), role });
const ar = (who) => O('account_remove', { user_id: UJ(who) });
const H14 = (p) => `${RS}
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) select ra, us[k], 'nyu', 'pass' from generate_series(8, 11) k;
    ${W(p + '0', 1, 'ra', A(...L.map((id, i) => ma(id, 'L' + i))))}`;
const ST14 = (key) => ROW(key, `select jsonb_build_object(
    'lu', (select jsonb_agg(m.user_id order by x.o) from unnest(array[${L.map((id) => `'${id}'::uuid`).join(', ')}]) with ordinality x(id, o) left join mahjong.members m on m.id = x.id),
    'ra', (select jsonb_object_agg(a.user_id, a.role) from mahjong.room_accounts a where a.room_id = ra),
    'bans', (select jsonb_agg(b.user_id) from mahjong.room_bans b where b.room_id = ra),
    'cl', (select jsonb_agg(jsonb_build_array(c.member_id, c.user_id)) from mahjong.member_claims c where c.room_id = ra))`);

/* ⑩ 範囲の端の表（2c-2a0・紙 write2_sekkei.md §1 2c-2a0・§5）＝tests/fixtures/write-cases.json を倉庫に流す（画面の写しの試験 room-state.test.mjs と同じ表）
 *  部屋は表の rules ごとに1つ（持ち主＝人7）・base_ops を当ててから、case ごとに塊の中で書いて戻す。比べは want_db ?? want と ok／err だけ。
 *  ★ok の行は「通る事」だけを守る（書けた中身は見ない＝中身は ①〜⑨ の手書きの試験が見る）・③ は入の数え rejNyu・at・空白だけの label を見るので残す（taiketsu 2c-2a0 注意3・任意1）★
 *  記号の id（h1・t1・m1・s1 …）は部屋ごとに uuid へ写す・記号でない字（例 nai）は新しい uuid＝無い物。 */
const WT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/write-cases.json'), 'utf8'));
const WT_RK = Object.keys(WT.rules);
const WT_ROOM = Object.fromEntries(WT_RK.map((k, i) => [k, 'rt' + i]));
const WT_IDS = Object.fromEntries(WT_RK.map((k) => [k, {}]));
const WT_ID_KEYS = ['hanchan_id', 'table_id', 'member_id', 'session_id'];
const wtId = (rk, v) => (typeof v !== 'string' ? v : /^[a-z]\d+$/.test(v) ? (WT_IDS[rk][v] ||= U()) : U());
const wtOp = (rk, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  WT_ID_KEYS.includes(k) ? wtId(rk, v) : (k === 'seats' || k === 'ton_order' || k === 'seen_seats') && Array.isArray(v) ? v.map((x) => wtId(rk, x)) : v]));
const wtOps = (rk, ops) => A(...ops.map((o) => `${lit(JSON.stringify(wtOp(rk, o)))}::jsonb`));
const WT_CASES = WT.cases.map((c) => ({ ...c, ops: c.ops_repeat ? Array.from({ length: c.ops_repeat.n }, () => c.ops_repeat.op) : c.ops }));
const ROOMS = [['ra', 1, '{"players":4,"chip_pt10":10}'], ['rc', 1, '{"players":4,"tobi_from":"all","chip_pt10":10,"shugi_pt10":10}'],
  ['re', 1, '{"players":4,"shugi_pt10":10}'], ['rf', 1, '{"players":4}'], ['rb', 6, '{"players":3,"kyotaku_end":"kieru"}']];

const body = `
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;
  res := res || jsonb_build_object('u', to_jsonb(us));
  ${ROOMS.map(([v, who, rules]) => `${asWho(who)}
  r := public.mj_room_create(gen_random_uuid(), ${lit('w-' + v)}, ${lit(PASS)}, ${lit(rules)}::jsonb, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)));
  res := res || jsonb_build_object('made_${v}', r); ${v} := (r->>'room_id')::uuid;`).join('\n  ')}
  v_no := (select room_no from mahjong.rooms where id = ra);
  ${asWho(2)} r := public.mj_room_join('pass', v_no, null, ${lit(PASS)}); res := res || jsonb_build_object('j2', r);
  ${asWho(3)} r := public.mj_room_join('pass', v_no, null, ${lit(PASS)}); res := res || jsonb_build_object('j3', r);
  ${asWho(5)} r := public.mj_room_join('pass', v_no, null, ${lit(PASS)}); res := res || jsonb_build_object('j5', r);
  update mahjong.room_accounts set role = 'kan' where room_id = ra and user_id = us[3];

  /* ⓪ */
  perform set_config('request.jwt.claims', '', true);
  begin r := public.mj_write(ra, gen_random_uuid(), ${A(O('hanchan_void', { hanchan_id: HA1 }))}); exception when others then r := jsonb_build_object('raised', sqlerrm); end;
  res := res || jsonb_build_object('z0', r);
  res := res || jsonb_build_object('fw', (select jsonb_build_object('definer', p.prosecdef, 'config', p.proconfig,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0))
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'mj_write'));
  res := res || jsonb_build_object('priv', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'mahjong_private' and (p.proname like 'mj\\_w\\_%' or p.proname = 'mj_tobi_ok')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    'nw', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'mahjong_private' and (p.proname like 'mj\\_w\\_%' or p.proname = 'mj_tobi_ok')));

  /* ① 一本道（入の人 2） */
  ${RS}
  ${W('m4', 2, 'ra', A(ma(MA[0], '甲'), ma(MA[1], '乙'), ma(MA[2], '丙'), ma(MA[3], '丁')), OP_M4)}
  ${W('s1', 2, 'ra', A(O('session_add', { session_id: SA, date: '2026-11-20', rate: null })))}
  ${W('t1', 2, 'ra', A(O('table_add', { table_id: TA, session_id: SA, label: '卓1' })))}
  ${ROW('t1_row', TR(TA))}
  ${W('h1', 2, 'ra', A(O('hanchan_start', { hanchan_id: HA1, table_id: TA, seats: MA.slice(0, 4), cells: [40000, 30000, 20000, 10000] })))}
  ${ROW('h1_row', HR(HA1))}
  ${ROW('h1_cells', `select jsonb_agg(jsonb_build_array(seat, value, version) order by seat) from mahjong.cells where hanchan_id = '${HA1}'`)}
  ${W('c1', 2, 'ra', A(cs(HA1, 0, 39000)))}
  ${ROW('c1_row', HR(HA1))}
  ${W('c2', 2, 'ra', A(cs(HA1, 0, 40000)))}
  ${ROW('c2_row', HR(HA1))}
  ${W('x1', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[0], kind: 'chip', add: 2 })))}
  ${ROW('x1_row', TR(TA))}
  ${W('x2', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[1], kind: 'chip', add: -2 })))}
  ${ROW('x2_row', TR(TA))}
  ${W('ss1', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 1, content: { a: 1 }, used: { h: {} }, missing: [] })))}
  ${ROW('hist1', `select jsonb_agg(jsonb_build_object('op', op, 'tbl', tbl, 'role', actor_role, 'who', actor_user_id) order by id) from mahjong.history where room_id = ra and op = 'cell_set'`)}

  /* ①' 並び（hanchan_start の ton_order・hanchan_order）＋席にいない人の extra_add */
  ${RS}
  ${W('o_h', 2, 'ra', A(ma(MX, '己'), O('hanchan_start', { hanchan_id: HA3, table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}
  ${ROW('o_h_row', HR(HA3))}
  ${W('o_s', 2, 'ra', A(O('hanchan_start', { hanchan_id: HA4, table_id: TA, seats: MA.slice(0, 4), cells: C4, ton_order: TON4 })))}
  ${ROW('o_s_row', HR(HA4))}
  ${W('o_sb', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4, ton_order: [MA[0], MA[1], MA[2], MX] })))}
  ${W('o_o', 2, 'ra', A(O('hanchan_order', { hanchan_id: HA3, ton_order: MA.slice(0, 4), base_version: ov(HA3) })))}
  ${ROW('o_o_row', HR(HA3))}
  ${W('o_ob', 2, 'ra', A(O('hanchan_order', { hanchan_id: HA3, ton_order: [MA[0], MA[1], MA[2], MX], base_version: ov(HA3) })))}
  ${W('o_oc', 2, 'ra', A(O('hanchan_order', { hanchan_id: HA3, ton_order: TON4, base_version: 1 })))}
  ${W('o_os', 2, 'ra', A(O('hanchan_order', { hanchan_id: HA3, ton_order: MA.slice(0, 4), base_version: 1 })))}
  ${W('x_ns', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MX, kind: 'chip', add: 1 })))}

  /* ② 弾き */
  ${RS}
  ${W('b_setup', 6, 'rb', A(...MB.map((m, i) => ma(m, 'b' + i)), O('session_add', { session_id: SB, date: '2026-11-20', rate: 100 }),
    O('table_add', { table_id: TB, session_id: SB, label: 'B' }), O('hanchan_start', { hanchan_id: HB, table_id: TB, seats: MB, cells: [35000, 35000, 35000] })))}
  ${ROW('hb_row', HR(HB))}
  ${W('o1', 3, 'ra', A(ma(U(), '別')), OP_M4)}
  ${W('xb1', 2, 'ra', A(O('cell_set', { hanchan_id: HB, seat: 0, value: 0, base_version: 1 })))}
  ${W('xb2', 2, 'ra', A(O('extra_add', { table_id: TB, member_id: MA[0], kind: 'chip', add: 1 })))}
  ${W('xb3', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MB[0], kind: 'chip', add: 1 })))}
  ${W('xb4', 2, 'ra', A(ma(MB[0], '別の部屋の id')))}
  ${W('xb5', 2, 'ra', A(O('session_add', { session_id: SB, date: '2026-11-20', rate: null })))}
  ${W('xb6', 2, 'ra', A(O('table_add', { table_id: TB, session_id: SA, label: 'x' })))}
  ${W('xb7', 2, 'ra', A(O('hanchan_start', { hanchan_id: HB, table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}
  ${W('same1', 2, 'ra', A(ma(MA[0], 'ちがう名'), O('session_add', { session_id: SA, date: '2026-01-01', rate: null }),
    O('table_add', { table_id: TA, session_id: SA, label: 'ちがう' }), O('hanchan_start', { hanchan_id: HA1, table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}
  ${W('seat3', 6, 'rb', A(O('cell_set', { hanchan_id: HB, seat: 3, value: 0, base_version: 1 })))}
  ${W('unk', 2, 'ra', A(O('cell_set', { hanchan_id: HA1, seat: 0, value: 40000, base_version: 1, foo: 1 })))}
  ${W('lg', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: null, league_id: U() })))}
  ${W('dupn', 2, 'ra', A(ma(U(), ' 甲 ')))}
  ${asWho(2)}
  arr := '{}';
  for nm in select name from mahjong.mj_ops where name not in (${NAMES31.map((n) => `'${n}'`).join(', ')}) order by name loop
    r := public.mj_write(ra, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', nm)));
    arr := arr || jsonb_build_object(nm, r);
  end loop;
  res := res || jsonb_build_object('ny', arr);
  ${W('many', 2, 'ra', A(...Array.from({ length: 31 }, () => O('hanchan_void', { hanchan_id: HA1 }))))}
  ${W('fooop', 2, 'ra', A(O('foo')))}
  ${W('notarr', 2, 'ra', `'{}'::jsonb`)}

  /* ③ 範囲 */
  ${RS}
  ${W('r1', 2, 'ra', A(O('cell_set', { hanchan_id: HA1, seat: 1, value: 150, base_version: 1 })))}
  ${W('r2', 2, 'ra', A(O('kyotaku_set', { hanchan_id: HA1, value: 1000, base_version: hv(HA1) })))}
  ${W('r3', 6, 'rb', A(O('kyotaku_set', { hanchan_id: HB, value: 1000, base_version: hv(HB) })))}
  ${ROW('r3_row', HR(HB))}
  ${W('r4', 6, 'rb', A(O('kyotaku_set', { hanchan_id: HB, value: 100, base_version: hv(HB) })))}
  ${W('r5', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[0], kind: 'chip', add: 999 })))}
  ${W('r6', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4, lost: 1000 })))}
  ${W('r7', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: [25050, 24950, 25000, 25000] })))}
  ${W('r8', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: [MA[0], MA[0], MA[1], MA[2]], cells: C4 })))}
  ${W('rr1', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 15 })))}
  ${W('rr2', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 0 })))}
  ${W('rr3', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 1999999995 })))}
  ${W('rd1', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-02-30', rate: null })))}
  ${W('rd2', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026/11/20', rate: null })))}
  ${W('rpl', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: null, place: 'あ'.repeat(41) })))}
  ${W('rl1', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: ' 　 ' })))}
  ${W('rl2', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'あ'.repeat(21) })))}
  ${W('rn1', 2, 'ra', A(ma(U(), 'あ'.repeat(21))))}
  ${W('rn2', 2, 'ra', A(ma(U(), ' 　 ')))}
  ${W('rs0', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 0, content: {}, used: {}, missing: [] })))}
  ${W('rsz', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 2, content: { big: BIG }, used: {}, missing: [] })))}
  /* ③ 通る端（11-20 叩き直し 注意2＝厳しくしすぎても緑のままにしない・塊の中で書いて戻す） */
  /* 2d：開催の重なりの門（shared で締めの無い開催が在ると dup）＝re2 は re1 と別の塊（同じ塊だと re1 の開催が締め無しで残って dup） */
  ${undo('re2b', `${RS}
    ${W('re2', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 2000000000, place: 'あ'.repeat(40) })))}`)}
  ${undo('re', `${RS}
    ${W('re1', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 10 })))}
    ${W('re3', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'あ'.repeat(20) })))}
    ${W('re4', 2, 'ra', A(ma(U(), 'い'.repeat(20))))}
    res := res || jsonb_build_object('re5_len', octet_length(jsonb_build_object('big', '${EDGE}')::text) + octet_length('{}'::jsonb::text) + octet_length('[]'::jsonb::text));
    ${W('re5', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: { big: EDGE }, used: {}, missing: [] })))}
    ${W('re6', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: { big: EDGE + 'x' }, used: {}, missing: [] })))}`)}
  ${undo('rm', `${RS}
    res := res || jsonb_build_object('many_len', octet_length(${V(MANY(MANY_N))}::text) + octet_length('{}'::jsonb::text) + octet_length('[]'::jsonb::text));
    ${W('rm1', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: MANY(MANY_N), used: {}, missing: [] })))}
    ${W('rm2', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: MANY(MANY_N + 1), used: {}, missing: [] })))}`)}

  /* ③' 取り消した開催日・卓／リーグの日（行を直に変えて塊ごと戻す） */
  ${RS}
  ${undo('vs', `update mahjong.sessions set voided = true where id = '${SA}';
    ${W('vs1', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: '消した日' })))}`)}
  ${undo('vt', `update mahjong.tables set voided = true where id = '${TA}';
    ${W('vt1', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}`)}
  ${undo('lgd', `insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id) values ('${U()}', ra, 'L', (select rule_set_id from mahjong.rooms where id = ra), (select rule_version from mahjong.rooms where id = ra), us[1]);
    update mahjong.sessions set league_id = (select id from mahjong.leagues where room_id = ra limit 1) where id = '${SA}';
    ${W('lg1', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'リーグ' })))}
    ${W('lg2', 2, 'ra', A(cs(HA1, 0, 39000)))}
    ${W('lg3', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[0], kind: 'chip', add: 1 })))}
    ${W('lg4', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 2, content: {}, used: {}, missing: [] })))}
    ${W('lg5', 1, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'リーグL' })))}`)}

  /* ④ 版 */
  ${RS}
  ${W('v1', 2, 'ra', A(O('cell_set', { hanchan_id: HA1, seat: 1, value: 31000, base_version: 0 })))}
  ${undo('vv', `${W('v2', 6, 'rb', A(O('hanchan_void', { hanchan_id: HB })))}
    ${W('v3', 6, 'rb', A(O('kyotaku_set', { hanchan_id: HB, value: 2000, base_version: 2 })))}`)}
  ${W('v4', 2, 'ra', A(cs(HA1, 0, 40000)))}
  ${W('v5', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 1, content: { a: 1 }, used: { h: {} }, missing: [] })))}
  ${W('v6', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 1, content: { a: 2 }, used: { h: {} }, missing: [] })))}
  ${W('v7', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 3, content: { a: 3 }, used: {}, missing: [] })))}
  ${W('v8', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 2, content: { a: 3 }, used: {}, missing: [{ table: 1, no: 2, why: 'sum' }] })))}

  /* ⑤ 飛び賞（A＝tobi true・busted・tobi_zero） */
  ${RS}
  ${W('ts', 2, 'ra', A(O('hanchan_start', { hanchan_id: HA2, table_id: TA, seats: MA.slice(0, 4), cells: [60000, 30000, 20000, -10000] })))}
  ${ROW('ts_row', HR(HA2))}
  ${W('tset', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 3: 0 }, base_version: tv(HA2) })))}
  ${ROW('tset_row', HR(HA2))}
  ${W('tnb', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 3: 0, 1: 2 }, base_version: tv(HA2) })))}
  ${ROW('tnb_row', HR(HA2))}
  ${W('tcf', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 3: 2 }, base_version: 1 })))}
  ${W('tself', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 3: 3 }, base_version: tv(HA2) })))}
  ${W('tout', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 4: 0 }, base_version: tv(HA2) })))}
  ${W('tnull', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 3: null }, base_version: tv(HA2) })))}
  ${W('tarr', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: [0], base_version: tv(HA2) })))}
  ${W('tun', 2, 'ra', A(cs(HA2, 3, 10000), cs(HA2, 0, 40000)))}
  ${ROW('tun_row', HR(HA2))}
  ${W('tre', 2, 'ra', A(cs(HA2, 3, -10000), cs(HA2, 0, 60000)))}
  ${ROW('tre_row', HR(HA2))}
  ${W('tun2', 2, 'ra', A(cs(HA2, 3, 10000), cs(HA2, 0, 40000)))}
  ${W('tk', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { 1: 2, 3: 1 }, base_version: tv(HA2) })))}
  ${ROW('tk_row', HR(HA2))}
  ${W('tre2', 2, 'ra', A(cs(HA2, 3, -10000), cs(HA2, 0, 60000), O('tobi_set', { hanchan_id: HA2, tobi_to: { 1: 2, 3: 1 }, base_version: tv(HA2) })))}
  ${ROW('tre2_row', HR(HA2))}
  ${st8('d_arr', `update mahjong.hanchans set tobi_to = '[]'::jsonb where id = '${HA2}';`)}
  ${st8('d_self', `update mahjong.hanchans set tobi_to = '{"3":3}'::jsonb where id = '${HA2}';`)}
  ${st8('d_ok', `update mahjong.hanchans set tobi_to = '{"3":"all"}'::jsonb where id = '${HA2}';`)}
  res := res || jsonb_build_object('fn_arr', mahjong_private.mj_tobi_ok('[]'::jsonb, 4::smallint), 'fn_null', mahjong_private.mj_tobi_ok('{"0":null}'::jsonb, 4::smallint),
    'fn_ok', mahjong_private.mj_tobi_ok('{"0":1,"2":"all"}'::jsonb, 4::smallint), 'fn_3p', mahjong_private.mj_tobi_ok('{"0":3}'::jsonb, 3::smallint));
  /* ⑤' E1（e_sadame v2 §E1-6）押した人の形 {"r":[席…]}＝小さい順・同じ席1回・0〜players−1・鍵は r だけ・[] も可・点を直しても変えない */
  ${W('tr', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [0, 2] }, base_version: tv(HA2) })))}
  ${ROW('tr_row', HR(HA2))}
  ${W('tr_un', 2, 'ra', A(cs(HA2, 3, 10000), cs(HA2, 0, 40000)))}
  ${W('tr_re', 2, 'ra', A(cs(HA2, 3, -10000), cs(HA2, 0, 60000)))}
  ${ROW('tr_re_row', HR(HA2))}
  ${W('tr_unsorted', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [2, 0] }, base_version: tv(HA2) })))}
  ${W('tr_dup', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [0, 0] }, base_version: tv(HA2) })))}
  ${W('tr_out', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [4] }, base_version: tv(HA2) })))}
  ${W('tr_neg', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [-1] }, base_version: tv(HA2) })))}
  ${W('tr_frac', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [0.5] }, base_version: tv(HA2) })))}
  ${W('tr_str', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: ['0'] }, base_version: tv(HA2) })))}
  ${W('tr_notarr', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: 0 }, base_version: tv(HA2) })))}
  ${W('tr_x', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [0], 3: 0 }, base_version: tv(HA2) })))}
  ${W('tr_empty', 2, 'ra', A(O('tobi_set', { hanchan_id: HA2, tobi_to: { r: [] }, base_version: tv(HA2) })))}
  ${ROW('tr_empty_row', HR(HA2))}
  res := res || jsonb_build_object('fr_3all', mahjong_private.mj_tobi_ok('{"r":[0,1,2]}'::jsonb, 3::smallint), 'fr_3out', mahjong_private.mj_tobi_ok('{"r":[3]}'::jsonb, 3::smallint),
    'fr_4all', mahjong_private.mj_tobi_ok('{"r":[0,1,2,3]}'::jsonb, 4::smallint));
  /* ⑤'' E2（e_sadame v2 §E2）1人でも点を入れる：空いた席は null（行を作らない）・開いている回は鎖に1つ・seen_n・行の無い席は版0 */
  ${RS}
  ${W('e_t', 2, 'ra', A(O('table_add', { table_id: TE, session_id: SA, label: 'E2' })))}
  ${W('e1', 2, 'ra', A(hsE(HE1, [40000, null, 20000, null], { seen_n: 0 })))}
  ${ROW('e1_nc', NCE(HE1))}
  ${ROW('e1_row', HR(HE1))}
  ${ROW('e1_rd', RDE(HE1, false))}
  ${ROW('e1_rd3', RDE(HE1, true))}
  ${W('e_open', 2, 'ra', A(hsE(HE2, [40000, 30000, 20000, 10000], { seen_n: 1 })))}
  ${W('e_open_old', 2, 'ra', A(hsE(HE2, [40000, 30000, 20000, 10000])))}
  ${W('e_resend', 2, 'ra', A(hsE(HE1, [40000, null, 20000, null], { seen_n: 0 })))}
  ${W('e_allnull', 2, 'ra', A(hsE(U(), [null, null, null, null], { seen_n: 1 })))}
  ${W('e_mix', 2, 'ra', A(hsE(U(), [40050, null, 20000, null], { seen_n: 1 })))}
  ${W('e_str', 2, 'ra', A(hsE(U(), ['x', null, 20000, null], { seen_n: 1 })))}
  ${W('e_sn_neg', 2, 'ra', A(hsE(U(), [40000, null, 20000, null], { seen_n: -1 })))}
  ${W('e_sn_frac', 2, 'ra', A(hsE(U(), [40000, null, 20000, null], { seen_n: 1.5 })))}
  ${W('e_sn_str', 2, 'ra', A(hsE(U(), [40000, null, 20000, null], { seen_n: '1' })))}
  ${W('e_sc', 2, 'ra', A(hsE(U(), [40000, null, 20000, null], { seen_n: 1, ton_order: MA.slice(0, 4), seen_cells: [40000, 0, 20000, 0] })))}
  ${W('e_bv1', 2, 'ra', A(csE(HE1, 3, 10000, 1)))}
  ${W('e_bv0', 2, 'ra', A(csE(HE1, 1, 30000, 0)))}
  ${ROW('e_bv0_nc', NCE(HE1))}
  ${W('e_bv0b', 2, 'ra', A(csE(HE1, 1, 31000, 0)))}
  ${W('e_bv0same', 2, 'ra', A(csE(HE1, 1, 30000, 0)))}
  ${W('e_fill', 2, 'ra', A(csE(HE1, 3, 10000, 0)))}
  ${ROW('e_fill_row', HR(HE1))}
  ${ROW('e_fill_rd', RDE(HE1, false))}
  ${W('e_new', 2, 'ra', A(hsE(HE2, [null, 50000, null, null], { seen_n: 0 })))}
  ${W('e_h2', 2, 'ra', A(hsE(HE2, [null, 50000, null, null], { seen_n: 1 })))}
  ${W('e_v2', 2, 'ra', A(O('hanchan_void', { hanchan_id: HE2 })))}
  ${W('e_new_void', 2, 'ra', A(hsE(HE3, [10000, null, null, null], { seen_n: 1 })))}
  ${W('e_h3', 2, 'ra', A(hsE(HE3, [10000, null, null, null], { seen_n: 2 })))}
  ${W('e_unv', 2, 'ra', A(O('hanchan_unvoid', { hanchan_id: HE2 })))}
  ${ROW('e_unv_row', HR(HE2))}

  /* ⑥ そろった後 */
  ${RS}
  ${undo('vo', `${W('vo1', 2, 'ra', A(O('hanchan_void', { hanchan_id: HA1 })))}
    ${ROW('vo1_row', HR(HA1))}
    ${W('vo2', 2, 'ra', A(O('hanchan_void', { hanchan_id: HA1 })))}
    ${W('vo3', 2, 'ra', A(O('hanchan_unvoid', { hanchan_id: HA1 })))}
    ${ROW('vo3_row', HR(HA1))}`)}

  /* ⑦ チップ・祝儀（11通り）＋ C の tobi_from all */
  ${RS}
  ${W('k_a', 1, 'ra', setupOps('ra'))}
  ${W('k_c', 1, 'rc', setupOps('rc'))}
  ${W('k_e', 1, 're', setupOps('re'))}
  ${W('k_f', 1, 'rf', setupOps('rf'))}
  ${CASES.filter((c) => c[7] !== null).map((c) => `insert into mahjong.extras (table_id, member_id, kind, value) values ('${c[4]}', '${MA[4]}', 'chip', ${c[7]});`).join('\n  ')}
  ${['ra', 'rc', 're', 'rf'].map((rm) => (CASES.some((c) => c[1] === rm && c[6].length) ? W('kx_' + rm, 1, rm, extraOps(rm)) : '')).join('\n  ')}
  ${CASES.map((c, i) => ROW('case' + i, TR(c[4]))).join('\n  ')}
  ${ROW('hc_all', HR(HC_ALL))}
  ${undo('kf', `update mahjong.rule_sets set rules = rules - 'chip_pt10' where id = (select rule_set_id from mahjong.rooms where id = rf);
    ${W('kf1', 1, 'rf', A(O('extra_add', { table_id: CASES[9][4], member_id: MF[0], kind: 'chip', add: 1 })))}
    ${ROW('kf1_row', TR(CASES[9][4]))}`)}
  ${ROW('c7_x', `select count(*) from mahjong.extras where table_id = '${CASES[10][4]}'`)}

  /* ⑫ 2c-3b 自由な項目 */
  ${undo('k3', `update mahjong.rule_sets set rules = rules || ${lit(JSON.stringify({ tane_custom: TC }))}::jsonb where id = (select rule_set_id from mahjong.rooms where id = ra);
    ${W('k3a', 1, 'ra', A(...mkT(C3N), ...mkT(C3P), ...mkT(C3Q)))}
    ${W('k3b', 2, 'ra', A(xa(C3N, 0, 3, 'c:ko')))}
    ${ROW('k3b_t', TK(C3N[0]))}
    ${W('k3c', 2, 'ra', A(xa(C3N, 1, -3, 'c:ko')))}
    ${ROW('k3c_t', TK(C3N[0]))}
    ${W('k3d', 2, 'ra', A(xa(C3P, 0, 5, 'c:ba')))}
    ${ROW('k3d_t', TK(C3P[0]))}
    ${W('k3e', 2, 'ra', A(xa(C3P, 0, -6, 'c:ba')))}
    ${ROW('k3e_x', XSUM(C3P[0], 'c:ba'))}
    ${W('k3e2', 2, 'ra', A(xa(C3P, 0, -5, 'c:ba')))}
    ${ROW('k3e2_x', XSUM(C3P[0], 'c:ba'))}
    ${W('k3f', 2, 'ra', A(xa(C3Q, 0, -1, 'c:ba')))}
    ${W('k3g', 2, 'ra', A(O('extra_set', { table_id: C3Q[0], member_id: MA[0], kind: 'c:ba', value: -1, base_version: 0 })))}
    ${W('k3g2', 2, 'ra', A(O('extra_set', { table_id: C3Q[0], member_id: MA[0], kind: 'c:ba', value: 0, base_version: 0 })))}
    ${W('k3h', 2, 'ra', A(xa(C3Q, 0, 1, 'c:zz')))}
    ${W('k3i1', 2, 'ra', A(xa(C3Q, 0, 1, 'c:')))}
    ${W('k3i2', 2, 'ra', A(xa(C3Q, 0, 1, 'c:ABC')))}
    ${W('k3i3', 2, 'ra', A(xa(C3Q, 0, 1, 'c:123456789')))}
    ${ROW('k3i_x', `select count(*) from mahjong.extras where table_id = '${C3Q[0]}'`)}
    ${W('k3j', 2, 'ra', A(xa(C3Q, 0, 1, 'c:ke'), xa(C3Q, 0, 1, 'c:ko')))}
    ${ROW('k3j_t', TK(C3Q[0]))}
    ${W('k3m', 2, 'ra', A(xa(C3Q, 0, 1)))}
    ${ROW('k3m_t', TK(C3Q[0]))}
    ${W('k3n', 2, 'ra', A(xa(C3P, 4, 1), xa(C3P, 4, 1, 'c:ko')))}
    ${W('k3o', 2, 'ra', A(xa(C3P, 4, 1, 'c:ko'), xa(C3P, 4, 1)))}
    ${W('k3k', 2, 'ra', A(xa(C3N, 0, 1)))}
    ${ROW('k3k_t', TK(C3N[0]))}
    ${W('k3l', 2, 'ra', A(O('extra_set', { table_id: C3P[0], member_id: MA[1], kind: 'c:ko', value: 2, base_version: 0 })))}
    ${ROW('k3l_t', TK(C3P[0]))}
    ${ROW('k3l_x', XSUM(C3P[0], 'c:ko'))}`)}
  ${undo('k4', `${W('k4a', 1, 'ra', A(...mkT(C3N)))}
    ${W('k4b', 2, 'ra', A(xa(C3N, 0, 1, 'c:ko')))}`)}

  /* ⑬ 2c-3c’ やきとり＝extras の種 'yaki'（倉庫だけ＝写しの 'yaki' は計算の B と同じ押し） */
  ${RS}
  ${undo('y5', `${YR({ yakitori: true, yakitori_pt: 10, tane_custom: TC })}
    ${W('y5a', 1, 'ra', A(...mkT(Y1), ...mkT(Y2)))}
    ${W('y5b', 2, 'ra', A(xa(Y1, 0, 3, 'yaki')))}
    ${ROW('y5b_t', TK(Y1[0]))}
    ${ROW('y5b_x', XSUM(Y1[0], 'yaki'))}
    ${W('y5c', 2, 'ra', A(xa(Y1, 1, -3, 'yaki')))}
    ${ROW('y5c_t', TK(Y1[0]))}
    ${W('y5d', 2, 'ra', A(O('extra_set', { table_id: Y2[0], member_id: MA[0], kind: 'yaki', value: 2, base_version: 0 })))}
    ${ROW('y5d_t', TK(Y2[0]))}
    ${W('y5e', 2, 'ra', A(xa(Y2, 1, 1, 'c:ko')))}
    ${ROW('y5e_t', TK(Y2[0]))}
    ${W('y5f', 2, 'ra', A(xa(Y2, 1, -2, 'yaki')))}
    ${ROW('y5f_t', TK(Y2[0]))}
    ${W('y5g', 2, 'ra', A(xa(Y1, 0, 1000, 'yaki')))}
    ${W('y5h', 2, 'ra', A(O('yakitori_set', { hanchan_id: Y1[1], yakitori: [0], base_version: 1 })))}`)}
  ${undo('y6', `${YR({ yakitori: true, yakitori_pt: 0 })}
    ${W('y6a', 1, 'ra', A(...mkT(Y3)))}
    ${W('y6b', 2, 'ra', A(xa(Y3, 0, 1, 'yaki')))}
    ${W('y6c', 2, 'ra', A(O('extra_set', { table_id: Y3[0], member_id: MA[0], kind: 'yaki', value: 1, base_version: 0 })))}
    ${ROW('y6_x', `select count(*) from mahjong.extras where table_id = '${Y3[0]}'`)}`)}
  ${undo('y7', `${YR({ yakitori: false, yakitori_pt: 10 })}
    ${W('y7a', 1, 'ra', A(...mkT(Y4)))}
    ${W('y7b', 2, 'ra', A(xa(Y4, 0, 1, 'yaki')))}`)}

  /* ⑯ B2 段1 飛び賞＝extras の種 'tobi'（倉庫だけ＝写しの 'tobi' は段2 の押し） */
  ${RS}
  ${undo('ob5', `${YR({ tobi: true, tobi_pt: 10, yakitori: true, yakitori_pt: 10, tane_custom: TC })}
    ${W('ob5a', 1, 'ra', A(...mkT(B1), ...mkT(B2)))}
    ${W('ob5b', 2, 'ra', A(xa(B1, 0, 3, 'tobi')))}
    ${ROW('ob5b_t', TK(B1[0]))}
    ${ROW('ob5b_x', XSUM(B1[0], 'tobi'))}
    ${W('ob5c', 2, 'ra', A(xa(B1, 1, -3, 'tobi')))}
    ${ROW('ob5c_t', TK(B1[0]))}
    ${W('ob5d', 2, 'ra', A(xa(B2, 0, 1, 'yaki'), xa(B2, 0, 1, 'tobi'), xa(B2, 0, 1, 'c:ko')))}
    ${ROW('ob5d_t', TK(B2[0]))}
    ${W('ob5e', 2, 'ra', A(xa(B2, 1, -1, 'yaki')))}
    ${ROW('ob5e_t', TK(B2[0]))}
    ${W('ob5f', 2, 'ra', A(xa(B2, 1, -1, 'tobi')))}
    ${ROW('ob5f_t', TK(B2[0]))}
    ${W('ob5g', 2, 'ra', A(O('extra_set', { table_id: B1[0], member_id: MA[2], kind: 'tobi', value: 2, base_version: 0 })))}
    ${ROW('ob5g_t', TK(B1[0]))}`)}
  ${undo('ob6', `${YR({ tobi: true, tobi_pt: 0 })}
    ${W('ob6a', 1, 'ra', A(...mkT(B3)))}
    ${W('ob6b', 2, 'ra', A(xa(B3, 0, 1, 'tobi')))}
    ${W('ob6c', 2, 'ra', A(O('extra_set', { table_id: B3[0], member_id: MA[0], kind: 'tobi', value: 1, base_version: 0 })))}
    ${ROW('ob6_x', `select count(*) from mahjong.extras where table_id = '${B3[0]}'`)}`)}
  ${undo('ob7', `${YR({ tobi: false, tobi_pt: 10 })}
    ${W('ob7a', 1, 'ra', A(...mkT(B4)))}
    ${W('ob7b', 2, 'ra', A(xa(B4, 0, 1, 'tobi')))}`)}

  /* ⑰ B1 卓の席 op table_seats（半荘0の卓に席を決めて ± を打つ） */
  ${RS}
  ${undo('q', `${W('q0', 1, 'ra', A(O('table_add', { table_id: TS, session_id: SA, label: 'q' }), O('table_add', { table_id: TSV, session_id: SA, label: 'qv' })))}
    ${ROW('q0_t', TSR(TS))}
    ${W('q1', 2, 'ra', A(xa([TS], 0, 3)))}
    ${W('q2', 2, 'ra', A(tse(TS, MA.slice(0, 4))))}
    ${ROW('q2_t', TSR(TS))}
    ${ROW('q2_hc', HCOL(TS, 'seats'))}
    ${W('q3', 2, 'ra', A(tse(TS, MA.slice(0, 4))))}
    ${W('q4', 2, 'ra', A(xa([TS], 0, 3)))}
    ${W('q5', 2, 'ra', A(xa([TS], 4, 3)))}
    ${W('q6', 2, 'ra', A(tse(TS, MA.slice(0, 3))))}
    ${W('q7', 2, 'ra', A(tse(TS, [...MA.slice(0, 4), MA[0]])))}
    ${W('q8', 2, 'ra', A(tse(TS, [MA[0], MA[1], MA[2], MA[2]])))}
    ${W('q9', 2, 'ra', A(tse(TS, [MA[0], MA[1], MA[2], MB[0]])))}
    ${W('qa', 2, 'ra', A(O('table_edit', { table_id: TSV, voided: true }), tse(TSV, MA.slice(0, 4))))}
    ${W('qb', 2, 'ra', A(tse(TS, [MA[1], MA[4], MA[2], MA[3]].map((m) => m.toUpperCase()))))}
    ${ROW('qb_t', TSR(TS))}
    ${ROW('qb_hc', HCOL(TS, 'seats'))}
    ${ROW('qb_x', `select count(*) from mahjong.extras where table_id = '${TS}'`)}
    ${st8('qc', `update mahjong.tables set seats = '{}'::jsonb where id = '${TS}';`)}
    ${st8('qd', `update mahjong.tables set seats = ${lit(JSON.stringify(MA.slice(0, 3)))}::jsonb where id = '${TS}';`)}`)}

  /* ⑦' 2c-2a1 卓の一度そろった・卓の印 */
  ${RS}
  ${undo('p', `${W('p0', 1, 'ra', A(...mkT(PN), ...mkT(PP), ...mkT(PQ)))}
    ${ROW('p0_n', TX(PN[0]))}
    ${W('p1', 2, 'ra', A(xa(PN, 0, 3)))}
    ${ROW('p1_n', TX(PN[0]))}
    ${W('p2', 2, 'ra', A(xa(PN, 1, -3)))}
    ${ROW('p2_n', TX(PN[0]))}
    ${W('p3', 2, 'ra', A(xa(PN, 0, 2)))}
    ${ROW('p3_n', TX(PN[0]))}
    ${W('p4', 2, 'ra', A(xa(PP, 0, 3), xa(PP, 1, -3)))}
    ${ROW('p4_p', TX(PP[0]))}
    ${W('p5', 2, 'ra', A(xa(PQ, 0, 3)))}
    ${W('p6', 2, 'ra', A(xa(PQ, 0, -3)))}
    ${ROW('p6_q', TX(PQ[0]))}
    ${W('p7', 2, 'ra', A(xa(PP, 0, 1), xa(PP, 0, -1)))}
    ${ROW('p7_p', TX(PP[0]))}
    ${W('p8', 2, 'ra', A(xa(PP, 2, 1)))}
    ${ROW('p8_p', TX(PP[0]))}`)}
  /* ⑦' 正味の門（MA[4]＝席にいない人・行は直に入れる） */
  ${RS}
  ${undo('g', `${W('g0', 1, 'ra', A(...mkT(GN)))}
    insert into mahjong.extras (table_id, member_id, kind, value) values ('${GN[0]}', '${MA[4]}', 'chip', 3);
    ${W('g1', 2, 'ra', A(xa(GN, 4, -3)))}
    ${W('g2', 2, 'ra', A(xa(GN, 4, -1)))}
    update mahjong.extras set value = 3 where table_id = '${GN[0]}' and member_id = '${MA[4]}';
    ${W('g3', 2, 'ra', A(xa(GN, 4, -5)))}
    ${W('g4', 2, 'ra', A(xa(GN, 4, 1)))}
    ${W('g5', 2, 'ra', A(xa(GN, 4, -1), xa(GN, 4, 1)))}
    ${W('g6', 2, 'ra', A(xa(GN, 0, 1), xa(GN, 4, 1)))}
    ${W('g7', 2, 'ra', A(xa(GN, 4, -2)))}
    ${ROW('g7_v', `select value from mahjong.extras where table_id = '${GN[0]}' and member_id = '${MA[4]}'`)}`)}
  /* ⑦' 使わない種・取り消した開催日（確かめの順 kind → unused → member → range） */
  ${RS}
  ${undo('u', `${W('u1', 2, 'ra', A(xa([TA], 0, 1, 'shugi')))}
    ${W('u2', 2, 'ra', A(xa([TA], U(), 1, 'shugi')))}
    ${W('u5', 2, 'ra', A(xa([TA], U(), 1000)))}
    update mahjong.sessions set voided = true where id = '${SA}';
    ${W('u3', 2, 'ra', A(xa([TA], 0, 1)))}
    ${W('u4', 2, 'ra', A(xa([TA], 0, 1, 'shugi')))}`)}
  /* ⑦' 前の組の締め（made_at < now()・この塊は1つの取引＝ここまでの締めは made_at = now()＝同じ組と同じ） */
  ${RS}
  ${undo('s', `${W('s0', 1, 'ra', A(...mkT(SW), ...mkT(SV, [25000, 25000, 25000, 24000])))}
    ${W('s1', 2, 'ra', A(xa(SW, 0, 1)))}
    ${ROW('s1_w', TX(SW[0]))}
    ${W('s1h', 2, 'ra', A(cs(SV[1], 3, 24500)))}
    ${ROW('s1h_v', HR(SV[1]))}
    insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing, made_at)
      values (ra, '${SA}', (select coalesce(max(rev), 0) + 1 from mahjong.settle_snaps where session_id = '${SA}'), '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, now() - interval '1 minute');
    ${W('s2', 2, 'ra', A(xa(SV, 0, 1)))}
    ${ROW('s2_v', TX(SV[0]))}
    ${W('s2h', 2, 'ra', A(cs(SV[1], 3, 24600)))}
    ${ROW('s2h_v', HR(SV[1]))}`)}

  /* ⑪ 2c-2a2 人の名前と在籍 */
  ${RS}
  ${undo('k', `${W('km0', 1, 'ra', A(ma(K1, 'Ab'), ma(K2, 'Cd')))}
    ${W('km1', 2, 'ra', A(O('member_rename', { member_id: K1, name: 'aB' })))}
    ${ROW('km1_r', MR(K1))}
    ${W('km2', 2, 'ra', A(O('member_rename', { member_id: K1, name: ' cd　' })))}
    ${W('km3', 2, 'ra', A(O('member_rename', { member_id: K1, name: 'aB' })))}
    ${W('km4', 2, 'ra', A(O('member_rename', { member_id: U(), name: 'x' })))}
    ${W('km5', 2, 'ra', A(O('member_rename', { member_id: K1, name: ' 　' })))}
    ${W('km6', 2, 'ra', A(O('member_active', { member_id: K2, active: false })))}
    ${W('km7', 2, 'ra', A(O('member_rename', { member_id: K1, name: 'Cd' })))}
    ${W('km8', 2, 'ra', A(O('member_active', { member_id: K2, active: true })))}
    ${W('km9', 2, 'ra', A(O('member_active', { member_id: K2, active: 'yes' })))}
    ${W('kma', 2, 'ra', A(O('member_rename', { member_id: MB[0], name: 'よそ' })))}
    ${ROW('km_h', HCOL(K1, 'name'))}
    ${ROW('km_r', MR(K1))}
    ${ROW('km_r2', MR(K2))}`)}
  ${undo('kl', `insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id) values ('${U()}', ra, 'L', (select rule_set_id from mahjong.rooms where id = ra), (select rule_version from mahjong.rooms where id = ra), us[1]);
    update mahjong.sessions set league_id = (select id from mahjong.leagues where room_id = ra limit 1) where id = '${SA}';
    ${W('kl1', 2, 'ra', A(O('member_rename', { member_id: MA[0], name: 'リーグ' })))}
    ${W('kl2', 2, 'ra', A(O('member_active', { member_id: MA[0], active: false })))}
    ${W('kl3', 2, 'ra', A(O('member_rename', { member_id: MA[4], name: 'リーグ外' })))}
    ${W('kl4', 2, 'ra', A(O('session_edit', { session_id: SA, place: 'x' })))}
    ${W('kl5', 2, 'ra', A(O('table_edit', { table_id: TA, label: 'x' })))}
    ${W('kl6', 1, 'ra', A(O('session_edit', { session_id: SA, place: 'x' })))}
    ${W('kl7', 1, 'ra', A(O('table_edit', { table_id: TA, label: 'x' })))}
    ${W('kl8', 1, 'ra', A(O('member_rename', { member_id: MA[0], name: 'リーグL' })))}`)}
  /* ⑪ 開催日を直す */
  ${RS}
  ${undo('ke', `${W('ke0', 1, 'ra', A(...mkT(KT, C4D), ...mkT(KN, [25000, 25000, 25000, 24000]), ...mkT(KQ, C4D), ...mkT(KR, C4D)))}
    ${W('ke9', 2, 'ra', A(O('table_edit', { table_id: KQ[0], rate_mode: 'num', rate: 50 }), O('table_edit', { table_id: KR[0], rate_mode: 'none' })))}
    update mahjong.tables set changed_after_complete_at = null where id in ('${KQ[0]}', '${KR[0]}');
    ${W('ke1', 2, 'ra', A(O('session_edit', { session_id: SA, place: '雀荘' })))}
    ${W('ke2', 2, 'ra', A(O('session_edit', { session_id: SA, place: '雀荘' })))}
    ${W('ke3', 2, 'ra', A(O('session_edit', { session_id: SA, date: null })))}
    ${W('ke4', 2, 'ra', A(O('session_edit', { session_id: SA, rate: 15 })))}
    ${W('ke5', 2, 'ra', A(O('session_edit', { session_id: SA, place: 'x', league_id: U() })))}
    ${W('ke6', 2, 'ra', A(O('session_edit', { session_id: SA, voided: 'x' })))}
    ${W('ke7', 2, 'ra', A(O('session_edit', { session_id: SA, date: '2026-02-30' })))}
    ${W('ke8', 2, 'ra', A(O('session_edit', { session_id: SA, rate: 50, date: '2026-11-21' })))}
    ${ROW('ke8_t', TL(KT[0]))}
    ${ROW('ke8_n', TL(KN[0]))}
    ${ROW('ke8_q', TL(KQ[0]))}
    ${ROW('ke8_r', TL(KR[0]))}
    ${ROW('ke8_h', HR(KT[1]))}
    ${ROW('ke8_s', `select jsonb_build_object('rate', rate, 'date', date, 'place', place, 'v', version) from mahjong.sessions where id = '${SA}'`)}
    ${ROW('ke8_hist', `select count(*) from mahjong.history where row_key ->> 'id' = '${SA}' and tbl = 'sessions' and col in ('rate', 'date')`)}`)}
  ${undo('kv', `${W('kv0', 1, 'ra', A(...mkT(KV, C4D)))}
    ${W('kv1', 2, 'ra', A(O('session_edit', { session_id: SA, voided: true })))}
    ${ROW('kv1_h', HR(KV[1]))}
    ${ROW('kv1_t', TL(KV[0]))}
    ${W('kv3', 2, 'ra', A(O('table_edit', { table_id: KV[0], rate_mode: 'num', rate: 50 })))}
    ${ROW('kv3_t', TL(KV[0]))}
    ${W('kv4', 2, 'ra', A(xs2(KV, 0, 1, 0)))}
    update mahjong.hanchans set changed_after_complete_at = null where id = '${KV[1]}';
    ${W('kv2', 2, 'ra', A(O('session_edit', { session_id: SA, voided: false })))}
    ${ROW('kv2_h', HR(KV[1]))}`)}
  /* ⑪ 卓を直す */
  ${RS}
  ${undo('kt', `${W('kt0', 1, 'ra', A(...mkT(KT, C4D), ...mkT(KV, C4D), ...mkT(KN, [25000, 25000, 25000, 24000])))}
    ${W('kt1', 2, 'ra', A(O('table_edit', { table_id: KT[0], label: ' 卓2　' })))}
    ${ROW('kt1_t', TL(KT[0]))}
    ${W('kt2', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num' })))}
    ${W('kt3', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num', rate: 50 })))}
    ${ROW('kt3_t', TL(KT[0]))}
    ${ROW('kt3_h', HR(KT[1]))}
    ${W('kt4', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate: 60 })))}
    ${W('kt5', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'none', rate: 50 })))}
    ${W('kt6', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'none' })))}
    ${ROW('kt6_t', TL(KT[0]))}
    ${W('kt7', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'x' })))}
    ${W('kt8', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num', rate: null })))}
    ${W('kt9', 2, 'ra', A(O('table_edit', { table_id: KN[0], rate_mode: 'num', rate: 50 })))}
    ${ROW('kt9_t', TL(KN[0]))}
    ${W('ktv', 2, 'ra', A(O('table_edit', { table_id: KV[0], voided: true })))}
    ${ROW('ktv_h', HR(KV[1]))}
    ${ROW('ktv_t', TL(KV[0]))}
    ${W('ktx', 2, 'ra', A(xa(KV, 0, 1)))}
    ${W('kty', 2, 'ra', A(xs2(KV, 0, 1, 0)))}
    ${W('ktw', 2, 'ra', A(O('table_edit', { table_id: KV[0], label: 'x' })))}
    update mahjong.hanchans set changed_after_complete_at = null where id = '${KV[1]}';
    ${W('ktu', 2, 'ra', A(O('table_edit', { table_id: KV[0], voided: false })))}
    ${ROW('ktu_h', HR(KV[1]))}
    ${ROW('ktu_t', TL(KV[0]))}
    ${W('kts1', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num', rate: 50 })))}
    ${W('kts2', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'session' })))}
    ${ROW('kts2_t', TL(KT[0]))}
    ${W('kts3', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'session', rate: 50 })))}
    ${W('ktr1', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num', rate: 15 })))}
    ${W('ktr2', 2, 'ra', A(O('table_edit', { table_id: KT[0], rate_mode: 'num', rate: 1999999995 })))}
    ${W('kr1', 2, 'ra', A(O('session_edit', { session_id: SB, place: 'x' })))}
    ${W('kr2', 2, 'ra', A(O('table_edit', { table_id: TB, label: 'x' })))}
    ${W('kr3', 2, 'ra', A(O('hanchan_seats', { hanchan_id: HB, seats: MA.slice(0, 4) })))}
    ${W('kr4', 2, 'ra', A(O('extra_set', { table_id: TB, member_id: MA[0], kind: 'chip', value: 1, base_version: 0 })))}
    ${W('kr5', 2, 'ra', A(O('table_edit', { table_id: KT[0], players: 3 })))}
    ${W('kr6', 2, 'ra', A(O('table_edit', { table_id: KT[0], rule_set_id: U() })))}
    ${W('kr7', 2, 'ra', A(O('session_edit', { session_id: SA, rule_version: 1 })))}`)}
  /* ⑪ 取り消しの卓の印（mj_w_tvoid）：入力中（同点＝半荘はそろわない）でチップだけそろった卓 */
  ${RS}
  ${undo('ky', `${W('ky0', 1, 'ra', A(...mkT(KY), xa(KY, 0, 3), xa(KY, 1, -3)))}
    ${ROW('ky0_t', TL(KY[0]))}
    ${W('ky1', 2, 'ra', A(O('table_edit', { table_id: KY[0], voided: true })))}
    ${ROW('ky1_t', TL(KY[0]))}
    ${ROW('ky1_h', HR(KY[1]))}`)}
  /* ⑪ 席を直す */
  ${RS}
  ${undo('ks', `${W('ks0', 1, 'ra', A(O('table_add', { table_id: KS[0], session_id: SA, label: 's' }),
      O('hanchan_start', { hanchan_id: KS[1], table_id: KS[0], seats: MA.slice(0, 4), cells: C4, ton_order: TON4 })))}
    ${W('ks1', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[1], MA[0], MA[2], MA[3]] })))}
    ${ROW('ks1_h', SV2(KS[1]))}
    ${W('ks2', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[1], MA[0], MA[2], MA[3]] })))}
    ${W('ks3', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[1], MA[0], MA[2], MA[4]] })))}
    ${ROW('ks3_h', SV2(KS[1]))}
    update mahjong.members set active = false where id in ('${MA[4]}', '${MA[3]}');
    ${W('ks4', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[0], MA[1], MA[2], MA[4]] })))}
    ${W('ks5', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[0], MA[1], MA[2], MA[3]] })))}
    ${W('ks6', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[0], MA[1], MA[2]] })))}
    ${W('ks7', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[0], MA[1], MA[2], MA[2]] })))}
    ${W('ks8', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[0], MA[1], MA[2], MB[0]] })))}
    ${W('ks9', 2, 'ra', A(O('hanchan_void', { hanchan_id: KS[1] }), O('hanchan_seats', { hanchan_id: KS[1], seats: [MA[1], MA[0], MA[2], MA[4]] })))}
    ${ROW('ks_h', SV2(KS[1]))}`)}
  /* ⑪ チップ・祝儀を値で置く（版つき・行が無い時は決め F） */
  ${RS}
  ${undo('kx', `${W('kx0', 1, 'ra', A(...mkT(KX, C4D), ...mkT(KW, C4D), ...mkT(KZ, C4D)))}
    ${W('kx1', 2, 'ra', A(xs2(KX, 0, 3, 0)))}
    ${W('kx2', 2, 'ra', A(xs2(KX, 0, 3, 99)))}
    ${W('kx3', 2, 'ra', A(xs2(KX, 0, 5, 0)))}
    ${W('kx4', 2, 'ra', A(xs2(KX, 0, 5, 1)))}
    ${W('kx5', 2, 'ra', A(xs2(KX, 1, 0, 0)))}
    ${W('kx6', 2, 'ra', A(xs2(KX, 1, 2, 1)))}
    ${W('kx7', 2, 'ra', A(xs2(KX, 1, 2, 0, 'shugi')))}
    ${W('kx8', 2, 'ra', A(xs2(KX, 1, 1000, 0)))}
    ${W('kx9', 2, 'ra', A(xs2(KX, 4, 1, 0)))}
    ${W('kxa', 2, 'ra', A(xs2(KX, 1, -5, 0)))}
    ${ROW('kxa_t', TX(KX[0]))}
    ${W('kxb', 2, 'ra', A(xs2(KX, 1, -4, 1)))}
    ${ROW('kxb_t', TX(KX[0]))}
    ${ROW('kx_v', `select jsonb_object_agg(member_id, jsonb_build_array(value, version)) from mahjong.extras where table_id = '${KX[0]}'`)}
    ${W('kxc', 2, 'ra', A(xs2(KW, 0, 2, 0), xs2(KW, 1, -2, 0)))}
    ${ROW('kxc_t', TX(KW[0]))}
    ${W('kxd', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KW[1], seats: [MA[0], MA[4], MA[2], MA[3]] })))}
    ${W('kxe', 2, 'ra', A(xs2(KW, 1, -3, 1)))}
    ${W('kxf', 2, 'ra', A(xs2(KW, 1, -1, 1)))}
    ${W('kxg', 2, 'ra', A(xs2(KX, 2, 0, 1)))}
    ${W('kz1', 2, 'ra', A(xs2(KZ, 3, 3, 0), xs2(KZ, 2, -3, 0)))}
    ${W('kz2', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KZ[1], seats: [MA[0], MA[1], MA[2], MA[4]] }), xs2(KZ, 3, 0, 1), xs2(KZ, 4, 3, 0)))}
    ${ROW('kz2_v', `select jsonb_object_agg(member_id, jsonb_build_array(value, version)) from mahjong.extras where table_id = '${KZ[0]}'`)}
    ${W('kz3', 2, 'ra', A(O('hanchan_seats', { hanchan_id: KZ[1], seats: MA.slice(0, 4) }), xs2(KZ, 4, 0, 1), xs2(KZ, 3, 3, 2)))}
    ${ROW('kz3_v', `select jsonb_object_agg(member_id, jsonb_build_array(value, version)) from mahjong.extras where table_id = '${KZ[0]}'`)}`)}

  /* ⑧ 数え */
  ${RS}
  ${undo('b1', `insert into mahjong.limits (kind, key, window_start, count) values ('write:ur1m', ra::text || ':' || us[2]::text, date_trunc('minute', now()), 120);
    ${W('b1', 2, 'ra', A(ma(U(), '先見')))}`)}
  ${RS}
  ${undo('b2', `insert into mahjong.limits (kind, key, window_start, count) values ('write:un1d', ra::text || ':' || us[2]::text, date_trunc('hour', now()), 1499);
    ${W('b2', 2, 'ra', A(ma(U(), '後見1'), ma(U(), '後見2')))}`)}
  ${RS}
  ${undo('b3', `insert into mahjong.limits (kind, key, window_start, count) values ('write:un1d', ra::text || ':' || us[2]::text, date_trunc('hour', now()) - interval '3 hours', 1500);
    ${W('b3n', 2, 'ra', A(ma(U(), '入満ち')))}
    ${W('b3b', 5, 'ra', A(ma(U(), '別の入は書ける')))}
    ${W('b3k', 3, 'ra', A(ma(U(), '管は書ける')))}`)}
  ${RS}
  ${undo('b5', `insert into mahjong.limits (kind, key, window_start, count) values ('write:u1d', us[2]::text, date_trunc('hour', now()) - interval '2 hours', 2999);
    ${W('b5n', 2, 'ra', A(ma(U(), '人の1日1'), ma(U(), '人の1日2')))}
    ${W('b5b', 5, 'ra', A(ma(U(), '別の人は書ける')))}`)}
  ${RS}
  ${undo('b5k', `insert into mahjong.limits (kind, key, window_start, count) values ('write:u1d', us[3]::text, date_trunc('hour', now()), 3000);
    ${W('b5k', 3, 'ra', A(ma(U(), '管も人の1日')))}`)}
  ${RS}
  ${undo('b6', `insert into mahjong.limits (kind, key, window_start, count) values ('write:rn1d', ra::text, date_trunc('hour', now()), 3000);
    ${W('b6', 2, 'ra', A(ma(U(), '古い rn1d は読まない')))}`)}
  ${RS}
  ${undo('b4', `insert into mahjong.limits (kind, key, window_start, count) values ('write:rk1d', ra::text, date_trunc('hour', now()), 7500);
    ${W('b4k', 3, 'ra', A(ma(U(), '管満ち')))}
    ${W('b4n', 2, 'ra', A(ma(U(), '入は書ける')))}`)}
  ${RS}
  ${undo('bo', `insert into mahjong.limits (kind, key, window_start, count) values ('write:ur1m', ra::text || ':' || us[2]::text, date_trunc('minute', now()) - interval '5 minutes', 7),
      ('write:un1d', ra::text || ':' || us[2]::text, now() - interval '25 hours', 1500),
      ('write:u1d', us[2]::text, now() - interval '25 hours', 3000);
    ${W('bo', 2, 'ra', A(ma(U(), '古い窓')))}
    ${ROW('bo_left', `select count(*) from mahjong.limits where kind like 'write:%' and (window_start < date_trunc('minute', now()) - interval '1 minute' and kind like '%1m' or window_start <= now() - interval '24 hours')`)}`)}
  ${RS}
  ${W('sv', 2, 'ra', A(cs(HA1, 0, 40000)))}
  ${W('okn', 2, 'ra', A(ma(U(), '入の1行')))}
  ${W('okk', 3, 'ra', A(ma(U(), '管の1行')))}
  ${W('oko', 1, 'ra', A(ma(U(), '持ち主の1行')))}
  ${RS}
  ${undo('ie', `create function mahjong_private.mj_test_boom() returns trigger language plpgsql as ${q('tb')}
      begin raise exception using errcode = current_setting('mj.test_err'), message = 'boom'; end ${q('tb')};
    create trigger mj_test_boom before insert on mahjong.members for each row execute function mahjong_private.mj_test_boom();
    ${['P0001', '55P03', '40P01', '40001'].map((c) => `perform set_config('mj.test_err', '${c}', true);
    ${W('ie_' + c, 2, 'ra', A(ma(U(), 'boom')))}`).join('\n    ')}`)}

  /* ⑧' 上限 */
  ${RS}
  ${undo('fm', `update mahjong.mj_caps set cap = (select count(*) from mahjong.members where room_id = ra) where tbl = 'members' and scope = 'room';
    ${W('fm', 2, 'ra', A(ma(U(), '満ち')))}`)}
  /* H1'（h1b_sadame v2）：前の上限を1つ越える数でも書ける（full にならない） */
  ${undo('ft', `insert into mahjong.tables select (jsonb_populate_record(null::mahjong.tables, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'next_table_id', null))).*
      from mahjong.tables t, generate_series(1, 10 - (select count(*) from mahjong.tables where session_id = '${SA}')::int) k where t.id = '${TA}';
    ${W('ft', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: '11卓目' })))}
    ${ROW('ft_n', `select count(*) from mahjong.tables where session_id = '${SA}'`)}`)}
  ${undo('fh', `insert into mahjong.hanchans select (jsonb_populate_record(null::mahjong.hanchans, to_jsonb(h) || jsonb_build_object('id', gen_random_uuid(), 'voided', true))).*
      from (select * from mahjong.hanchans where table_id = '${TA}' limit 1) h, generate_series(1, 60 - (select count(*) from mahjong.hanchans where table_id = '${TA}')::int) k;
    ${W('fh', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}
    ${ROW('fh_n', `select count(*) from mahjong.hanchans where table_id = '${TA}'`)}`)}
  ${undo('fs', `insert into mahjong.sessions select (jsonb_populate_record(null::mahjong.sessions, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'voided', true, 'created_at', x.created_at - interval '1 day'))).*   -- 取り消した古い日（開催の重なりの門に当てない）
      from (select * from mahjong.sessions where room_id = ra limit 1) x, generate_series(1, 3000 - (select count(*) from mahjong.sessions where room_id = ra)::int) k;
    ${W('fs', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-21', rate: null })))}
    ${ROW('fs_n', `select count(*) from mahjong.sessions where room_id = ra`)}`)}
  ${undo('fp', `update mahjong.rooms set row_count = 30000 where id = ra;
    ${W('fp', 2, 'ra', A(ma(U(), 'P 越え')))}
    ${ROW('fp_n', `select row_count from mahjong.rooms where id = ra`)}`)}
  ${undo('fn', `delete from mahjong.mj_caps where tbl = 'members' and scope = 'room';
    ${W('fn', 2, 'ra', A(ma(U(), 'cap 無し')))}`)}
  ${undo('fo', `update mahjong.mj_caps set cap = 1 where tbl = 'op_results' and scope = 'room';
    ${W('fo1', 2, 'ra', A(ma(U(), '答え1')))}
    ${W('fo2', 2, 'ra', A(ma(U(), '答え2')))}`)}
  ${undo('fq', `delete from mahjong.op_results where room_id = ra;
    update mahjong.mj_caps set cap = 2 where tbl = 'op_results' and scope = 'room';
    ${W('fq1', 2, 'ra', A(ma(U(), '順1')), OPQ1)}
    update mahjong.op_results set at = now() - interval '2 hours' where room_id = ra and op_id = '${OPQ1}';
    ${W('fq2', 2, 'ra', A(ma(U(), '順2')), OPQ2)}
    update mahjong.op_results set at = now() - interval '3 hours' where room_id = ra and op_id = '${OPQ2}';
    ${W('fq3', 2, 'ra', A(ma(U(), '順3')), OPQ3)}
    ${ROW('fq_left', `select jsonb_agg(op_id::text order by op_id) from mahjong.op_results where room_id = ra`)}`)}
  ${undo('fhi', `update mahjong.rooms set history_count = 10000 where id = ra;
    ${W('fhi', 2, 'ra', A(ma(U(), '履歴越え')))}
    ${ROW('fhi_n', `select history_count from mahjong.rooms where id = ra`)}`)}

  /* ⑭ 2c-2b 人の op 5つ（write4_sekkei.md v1〜v1.2・各節を undo で分ける） */
  ${undo('qr', `${H14('qr')}
    ${W('qr1', 2, 'ra', A(rl(0, 2)))}
    ${W('qr2', 2, 'ra', A(ar(5)))}
    ${W('qr3', 3, 'ra', A(rset(2, 'kan')))}
    ${W('qr4', 2, 'ra', A(ma(U(), 'qr4'), ar(5)))}`)}
  ${undo('qa', `${H14('qa')}
    ${WA('qa1', 1, AMR.old, 'ra', A(rset(2, 'kan')))}
    ${ST14('qa1_s')}
    ${W('qa2', 1, 'ra', A(rset(2, 'kan')))}
    ${WA('qa3', 1, AMR.empty, 'ra', A(rset(2, 'kan')))}
    ${WA('qa4', 1, AMR.strts, 'ra', A(rset(2, 'kan')))}
    ${WA('qa5', 1, AMR.str, 'ra', A(rset(2, 'kan')))}
    ${WA('qa6', 1, AMR.fresh, 'ra', A(rset(2, 'kan')))}
    ${ST14('qa6_s')}
    ${W('qa7', 1, 'ra', A(rset(2, 'nyu')))}
    ${ST14('qa7_s')}`)}
  ${undo('ql', `${H14('ql')}
    ${W('ql1', 2, 'ra', A(lk(0)))}
    ${W('ql2', 2, 'ra', A(lk(0)))}
    ${W('ql3', 2, 'ra', A(lk(1)))}
    ${LU(2, 8)}
    ${W('ql4', 3, 'ra', A(lk(2)))}
    ${W('ql5', 3, 'ra', A(lk(2)))}
    ${ST14('ql5_s')}
    ${CL(0, 9)}
    ${W('ql6', 2, 'ra', A(ul(0), lk(1)))}
    ${ST14('ql6_s')}
    ${CL(1, 3)}
    ${W('ql7', 3, 'ra', A(lk(3)))}
    ${ST14('ql7_s')}
    ${LU(4, 10)}
    ${W('ql8', 11, 'ra', A(lk(1)))}
    ${W('ql9', 11, 'ra', A(lk(2)))}
    ${W('ql10', 11, 'ra', A(lk(3)))}
    ${W('ql11', 11, 'ra', A(lk(4)))}
    ${undo('qlc', `update mahjong.mj_caps set cap = (select count(*) from mahjong.member_claims where room_id = ra) where tbl = 'member_claims' and scope = 'room';
      ${W('ql12', 9, 'ra', A(lk(2)))}`)}
    update mahjong.members set active = false where id = '${L[9]}';
    ${W('ql13', 9, 'ra', A(lk(9)))}
    ${W('ql14', 9, 'ra', A(O('member_link', { member_id: MB[0] })))}`)}
  ${undo('qu', `${H14('qu')}
    ${LU(0, 2)} ${LU(1, 8)} ${LU(2, 9)}
    ${W('qu1', 2, 'ra', A(ul(0)))}
    ${W('qu2', 3, 'ra', A(ul(1)))}
    ${W('qu3', 2, 'ra', A(ul(2)))}
    ${W('qu4', 2, 'ra', A(ul(5)))}
    ${ST14('qu_s')}`)}
  ${undo('qe', `${H14('qe')}
    ${LU(0, 2)}
    ${W('qe1', 3, 'ra', A(rl(1, 2)))}
    ${ST14('qe1_s')}
    ${W('qe2', 3, 'ra', A(rl(2, 4)))}
    insert into mahjong.room_bans (room_id, user_id) values (ra, us[5]);
    ${W('qe3', 3, 'ra', A(rl(2, 5)))}
    ${undo('qeo', `delete from mahjong.room_accounts where room_id = ra and user_id = us[1];
      ${W('qe4', 3, 'ra', A(rl(3, 1)))}
      ${ST14('qe4_s')}`)}`)}
  ${undo('qs', `${H14('qs')}
    ${WA('qs1', 1, AMR.fresh, 'ra', A(rset(8, 'kan')))}
    ${WA('qs2', 1, AMR.fresh, 'ra', A(rset(9, 'kan')))}
    ${WA('qs3', 1, AMR.fresh, 'ra', A(rset(10, 'kan')))}
    ${WA('qs4', 1, AMR.fresh, 'ra', A(rset(11, 'kan')))}
    ${ST14('qs_s')}
    ${WA('qs5', 1, AMR.fresh, 'ra', A(rset(3, 'kan')))}
    ${WA('qs6', 1, AMR.fresh, 'ra', A(rset(1, 'kan')))}
    insert into mahjong.room_bans (room_id, user_id) values (ra, us[5]);
    ${WA('qs7', 1, AMR.fresh, 'ra', A(rset(5, 'nyu')))}
    ${WA('qs8', 1, AMR.fresh, 'ra', A(rset(2, 'boss')))}`)}
  ${undo('qx', `${H14('qx')}
    ${LU(4, 5)} ${LU(0, 8)} ${CL(0, 5)} ${CL(4, 9)}
    ${W('qx1', 3, 'ra', A(ar(5)))}
    ${ST14('qx1_s')}
    ${W('qx2', 5, 'ra', A(ma(U(), 'qx2')))}
    ${asWho(5)} r := public.mj_room_join('pass', v_no, null, ${lit(PASS)}); res := res || jsonb_build_object('qx3', r);
    ${W('qx4', 3, 'ra', A(ar(5)))}
    ${W('qx5', 3, 'ra', A(ar(1)))}
    ${W('qx6', 1, 'ra', A(ar(3)))}
    ${undo('qxl', `insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id, voided) values ('${U()}', ra, 'L', (select rule_set_id from mahjong.rooms where id = ra), (select rule_version from mahjong.rooms where id = ra), us[2], true);
      ${W('qx7', 3, 'ra', A(ar(2)))}`)}
    ${W('qx8', 3, 'ra', A(ar(4)))}
    ${undo('qxc', `update mahjong.mj_caps set cap = (select count(*) from mahjong.room_bans where room_id = ra) where tbl = 'room_bans' and scope = 'room';
      ${W('qx9', 3, 'ra', A(ar(2)))}`)}`)}
  /* ⑮ 2c-2c 部屋の op 4つ（write5_sadame.md v1.1・各節を undo で分ける） */
  ${undo('zrl', `${H14('zrl')}
    ${JA(2, '3 days')} ${JA(8, '2 days')} ${JA(3, '1 day')}
    ${LU(0, 2)} ${LU(1, 9)} ${CL(1, 2)}
    ${LG('a', 2, true)} ${LG('b', 1)}
    ${W('zrl1', 2, 'ra', A(RL), OPL)}
    ${ST15('zrl1_s')}
    ${ROW('zrl1_lv', `select jsonb_build_object('n', (select count(*)::int from mahjong.room_leaves x where x.room_id = ra and x.user_id = us[2]), 'hid', (select bool_and(x.left_hist_id = (select max(h.id) from mahjong.history h where h.room_id = ra and h.op <> 'room_leave')) from mahjong.room_leaves x where x.room_id = ra and x.user_id = us[2]))`)}
    ${W('zrl2', 2, 'ra', A(RL), OPL)}
    ${W('zrl3', 2, 'ra', A(ma(U(), 'zrl3')))}
    ${WA('zrl4', 1, AMR.old, 'ra', A(RL))}
    ${W('zrl5', 3, 'ra', A(RL, ma(U(), 'zrl5')))}
    ${W('zrl5b', 3, 'ra', A(ma(U(), 'zrl5b'), RD))}
    ${WA('zrl6', 1, AMR.fresh, 'ra', A(RL))}
    ${ST15('zrl6_s')}`)}
  ${undo('zrk', `${H14('zrk')}
    update mahjong.room_accounts set role = 'nyu' where room_id = ra and user_id = us[3];
    ${JA(8, '2 days')} ${JA(2, '1 day')} ${JA(3, '1 hour')}
    ${undo('zrka', `delete from mahjong.room_accounts where room_id = ra and user_id <> us[1];
      ${WA('zrk2', 1, AMR.fresh, 'ra', A(RL))}`)}
    ${WA('zrk1', 1, AMR.fresh, 'ra', A(RL))}
    ${ST15('zrk1_s')}`)}
  ${undo('zrd', `${RS}
    ${W('zrd1', 2, 'ra', A(RD))}
    ${W('zrd2', 3, 'ra', A(RD))}
    ${WA('zrd3', 1, AMR.old, 'ra', A(RD))}
    ${WAo('zrd4', 1, AMR.fresh, 'ra', A(RD), OPD)}
    ${ST15('zrd4_s')}
    ${WAo('zrd5', 1, AMR.fresh, 'ra', A(RD), OPD)}
    ${W('zrd6', 2, 'ra', A(ma(U(), 'zrd6')))}
    ${JOIN('zrd7', 4, PASS)}
    ${W('zrd8', 2, 'ra', A(RU))}
    ${W('zrd9', 3, 'ra', A(RU))}
    ${ST15('zrd9_s')}
    ${W('zrd10', 3, 'ra', A(RU))}
    ${undo('zrdo', `update mahjong.rooms set deleted_at = now() - interval '8 days' where id = ra;
      ${W('zrd11', 1, 'ra', A(RU))}`)}`)}
  ${undo('zsc', `${H14('zsc')}
    ${LU(0, 2)} ${LU(1, 8)} ${CL(2, 8)} ${CL(3, 3)}
    ${LG('c', 9)}
    insert into mahjong.room_bans (room_id, user_id) values (ra, us[7]);
    ${W('zsc1', 2, 'ra', A(sec(PASS2, H1)))}
    ${WA('zsc2', 3, AMR.old, 'ra', A(sec(PASS2, H1)))}
    ${WA('zsc3', 3, AMR.fresh, 'ra', A(sec('abc', H1)))}
    ${WA('zsc4', 3, AMR.fresh, 'ra', A(sec(PASS2, 'xyz')))}
    ${WA('zsc5', 3, AMR.fresh, 'ra', A(O('room_secret', { pass: PASS2 })))}
    ${WA('zsc7', 3, AMR.fresh, 'ra', A(sec(PASS, H1)))}
    ${WA('zsc7b', 3, AMR.fresh, 'ra', A(sec('２７４１', H1)))}
    ${WA('zsc8', 3, AMR.fresh, 'ra', A(sec(PASS2, S('(select to_jsonb(url_token_hash) from mahjong.rooms where id = ra)'))))}
    ${WA('zsc9', 3, AMR.fresh, 'ra', A(sec(PASS2, S('(select to_jsonb(url_token_hash) from mahjong.rooms where id = rb)'))))}
    ${WA('zsc10', 3, AMR.fresh, 'ra', A(ma(U(), 'zsc10'), sec(PASS2, H1)))}
    ${ST15('zsc0_s')}
    ${WAo('zsc11', 3, AMR.fresh, 'ra', A(sec(PASS2, H1)), OPS)}
    ${ST15('zsc11_s')}
    ${ROW('zsc11_h', `select jsonb_agg(jsonb_build_array(tbl, col, before_value, after_value) order by id) from mahjong.history where room_id = ra and op = 'room_secret'`)}
    ${ROW('zsc11_o', `select result from mahjong.op_results where room_id = ra and op_id = '${OPS}'`)}
    ${WAo('zsc12', 3, AMR.fresh, 'ra', A(sec(PASS2, H1)), OPS)}
    ${JOIN('zsc13', 4, PASS)}
    ${JOIN('zsc14', 7, PASS2)}`)}
  ${undo('zsc15b', `${H14('zsc15b')}
    ${WA('zsc15', 3, AMR.fresh, 'ra', A(sec('1234', H1)))}`)}
  ${undo('zk3', `${H14('zk3')}
    update mahjong.room_accounts set role = 'kan' where room_id = ra and user_id = us[8];
    ${JA(2, '5 days')} ${JA(8, '2 days')} ${JA(3, '1 day')}
    ${LG('d', 1)}
    delete from auth.users where id = us[1];
    ${W('zk31', 2, 'ra', A(ma(U(), 'zk31')))}
    ${ST15('zk31_s')}
    ${ROW('zk31_h', `select jsonb_agg(jsonb_build_array(tbl, col) order by id) from mahjong.history where room_id = ra and op = 'owner_inherit'`)}`)}
  ${undo('zk3b', `${RS}
    delete from auth.users where id = us[1];
    ${WA('zk3b1', 3, AMR.fresh, 'ra', A(RD))}
    ${ST15('zk3b1_s')}`)}
  /* ⑨ 送り直し・部屋・last_seen */
  ${RS}
  ${W('rs1', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[2], kind: 'chip', add: 1 })), OPX)}
  ${ROW('rs1_x', `select value from mahjong.extras where table_id = '${TA}' and member_id = '${MA[2]}' and kind = 'chip'`)}
  ${W('rs2', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[2], kind: 'chip', add: 1 })), OPX)}
  ${ROW('rs2_x', `select value from mahjong.extras where table_id = '${TA}' and member_id = '${MA[2]}' and kind = 'chip'`)}
  ${undo('dl', `update mahjong.rooms set deleted_at = now() where id = ra;
    ${W('dl', 2, 'ra', A(ma(U(), '消した部屋')))}`)}
  ${W('nm', 4, 'ra', A(ma(U(), '入っていない')))}
  ${W('bn0', 5, 'ra', A(ma(U(), '出す前')))}
  ${undo('bn', `insert into mahjong.room_bans (room_id, user_id) values (ra, us[5]);
    ${W('bn', 5, 'ra', A(ma(U(), '出した後')))}`)}
  ${undo('ow', `delete from mahjong.room_accounts where room_id = ra and user_id = us[1];
    ${W('ow', 1, 'ra', A(ma(U(), '持ち主だけ')))}`)}
  rz := gen_random_uuid();
  ${W('nr', 2, 'rz', A(ma(U(), '無い部屋')))}
  update mahjong.room_accounts set last_seen = now() - interval '2 hours' where room_id = ra and user_id = us[2];
  ${W('ls1', 2, 'ra', A(ma(U(), '久しぶり')))}
  ${ROW('ls1_v', `select last_seen = now() from mahjong.room_accounts where room_id = ra and user_id = us[2]`)}
  update mahjong.room_accounts set last_seen = now() - interval '5 minutes' where room_id = ra and user_id = us[2];
  ${W('ls2', 2, 'ra', A(ma(U(), 'さっき')))}
  ${ROW('ls2_v', `select last_seen = now() - interval '5 minutes' from mahjong.room_accounts where room_id = ra and user_id = us[2]`)}
  /* ⑯ 2c-2d1 リーグの op 3つ（write7_league_sadame_v11.md・各節を undo で分ける） */
  ${RS}
  ${undo('g1', `${W('g1a', 2, 'ra', A(lc(GA)))}
    ${W('g1b', 1, 'ra', A(lc(GA, { rules_alt: R3 })))}
    ${ROW('g1b_r', LGR(GA))}
    ${W('g1c', 3, 'ra', A(lsv(GA, { name: '管' })))}
    ${W('g1d', 1, 'ra', A(lsv(GA, { name: 'リ2' })))}
    ${W('g1s1', 1, 'ra', A(sad(GS1, GA)))}
    ${W('g1e', 1, 'ra', A(lsv(GA, { rules: R4b })))}
    ${ROW('g1e_r', LGR(GA))}
    insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values (ra, '${GS1}', 1, '{}', '{}', '[]');   /* D2 §1：リーグの日は前の日を締めてから次の日 */
    ${W('g1s2', 1, 'ra', A(sad(GS2, GA), tad(GT2, GS2)))}
    ${ROW('g1v1', SSR(GS1, GA))} ${ROW('g1v2', SSR(GS2, GA))}
    ${ROW('g1vt', `select rule_version from mahjong.tables where id = '${GT2}'`)}
    ${W('g1f', 3, 'ra', A(sad(GS3, GA), tad(GT3, GS3)))}
    update mahjong.leagues set owner_user_id = us[2] where id = '${GA}';
    insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values (ra, '${GS2}', 1, '{}', '{}', '[]');
    ${W('g1g', 2, 'ra', A(sad(GS4, GA), tad(GT4, GS4)))}
    ${W('g1g2', 5, 'ra', A(sad(GS5, GA), tad(GT5, GS5)))}
    update mahjong.leagues set owner_user_id = us[1] where id = '${GA}';
    ${W('g1h', 1, 'ra', A(lc(GB, { rules: R3 })))}
    ${W('g1i', 1, 'ra', A(lc(GB, { rules_alt: R4 })))}
    ${W('g1j', 1, 'ra', A(lsv(GA, { players_main: 3 })))}
    ${W('g1k', 1, 'ra', A(lsv(GA, { rules: R3 })))}
    ${W('g1n', 1, 'ra', A(lsv(GA, { rules_alt: null })))}
    ${ROW('g1n_r', LGR(GA))}
    ${ROW('g1n_rs', `select count(*) from mahjong.rule_sets where room_id = ra`)}
    ${W('g1n2', 1, 'ra', A(lsv(GA, { rules: R4b })))}
    update mahjong.leagues set voided = true where id = '${GA}';
    ${W('g1l', 1, 'ra', A(sad(GS6, GA)))}
    ${W('g1m', 1, 'ra', A(lsv(GA, { name: '消した' })))}`)}
  ${RS}
  ${undo('g2', `insert into mahjong.leagues (room_id, name, rule_set_id, rule_version, owner_user_id)
      select ra, 'c' || k, (select rule_set_id from mahjong.rooms where id = ra), (select rule_version from mahjong.rooms where id = ra), us[1]
        from generate_series(1, 50 - (select count(*) from mahjong.leagues where room_id = ra)::int) k;
    ${W('g2a', 1, 'ra', A(lc(GB)))}
    ${ROW('g2a_n', `select count(*) from mahjong.leagues where room_id = ra`)}`)}
  ${RS}
  ${undo('g3', `insert into mahjong.rule_sets (id, version, room_id, rules)
      select gen_random_uuid(), 1, ra, '{"players":4}'::jsonb from generate_series(1, 500 - (select count(*) from mahjong.rule_sets where room_id = ra)::int) k;
    ${W('g3a', 1, 'ra', A(lc(GB)))}
    ${ROW('g3a_n', `select count(*) from mahjong.rule_sets where room_id = ra`)}
    ${W('g3b', 1, 'ra', A(lc(GC)))}
    ${W('g3c', 1, 'ra', A(lsv(GB, { rules: R4b })))}
    ${W('g3d', 1, 'ra', A(lsv(GB, { name: '名だけ' })))}`)}
  ${RS}
  ${undo('g4', `${W('g4a', 1, 'ra', A(lc(U())))} ${W('g4b', 1, 'ra', A(lc(U())))} ${W('g4c', 1, 'ra', A(lc(U())))}
    ${RS} ${W('g4d', 1, 'rc', A(lc(U())))} ${W('g4e', 1, 'rc', A(lc(U())))}
    ${W('g4f', 1, 'rc', A(lc(U())))}
    ${W('g4g', 3, 'ra', A(lc(U())))}
    update mahjong.leagues set created_at = now() - interval '25 hours' where id = (select id from mahjong.leagues where created_by = us[1] order by id limit 1);
    ${W('g4h', 1, 'rc', A(lc(U())))}`)}
  ${RS}
  ${undo('g5', `${GL(GE, 5)} ${GL(GF, 5, 'ra', true)} ${GL(GH, 3)}
    delete from auth.users where id = us[5];
    ${W('g5a', 2, 'ra', A(ma(U(), 'g5a')))}
    ${ROW('g5a_e', LGR(GE))} ${ROW('g5a_f', LGR(GF))} ${ROW('g5a_h', LGR(GH))}
    ${ROW('g5a_h2', `select jsonb_build_object('n', count(*), 'g', count(distinct group_id), 'same', bool_and(group_id = (select group_id from mahjong.history where room_id = ra and op = 'member_add' order by id desc limit 1)), 'col', min(col)) from mahjong.history where room_id = ra and op = 'league_inherit'`)}
    ${W('g5b', 2, 'ra', A(ma(U(), 'g5b')))}`)}
  ${RS}
  ${undo('g6', `${GL(GE, 5)}
    delete from auth.users where id = us[5];
    ${W('g6a', 1, 'ra', A(O('league_save', { league_id: GE, base_version: 1, name: '継いだ後' })))}`)}
  ${RS}
  ${undo('g7', `${GL(GE, 2)}
    update mahjong.sessions set league_id = '${GE}' where id = '${SA}';
    ${W('g7a', 2, 'ra', A(O('member_rename', { member_id: MA[0], name: 'ただ1人の L' })))}
    ${GL(GF, 1)}
    insert into mahjong.sessions (id, room_id, league_id, date, rule_set_id, rule_version)
      select '${GS1}', ra, '${GF}', '2026-11-22', rule_set_id, rule_version from mahjong.rooms where id = ra;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version)
      select '${GT2}', ra, '${GS1}', 'g7', 4, rule_set_id, rule_version from mahjong.rooms where id = ra;
    update mahjong.hanchans set table_id = '${GT2}' where id = (select h.id from mahjong.hanchans h where h.room_id = ra and h.seats::text like '%' || '${MA[0]}' || '%' order by h.id limit 1);
    ${W('g7b', 2, 'ra', A(O('member_rename', { member_id: MA[0], name: '2人の L' })))}`)}

  ${RS}
  /* ⑯' D2 §4：alt の卓・開催日の版・重なり・期間・rate・卓 11 本目・締めた後の2日目 */
  ${undo('g8', `${W('g8a', 1, 'ra', A(O('league_create', { league_id: DL1, name: 'D2', date_from: '2026-11-01', date_to: '2026-11-30', players_main: 4, rules: R4r, rules_alt: R3 })))}
    ${W('g8b', 1, 'ra', A(sadD(DS1, DL1), tadA(DT1, DS1, true), tadA(DT2, DS1, false)))}
    ${ROW('g8b_s', SLD(DS1, DL1))} ${ROW('g8b_t1', TRD(DT1, DS1))} ${ROW('g8b_t2', TRD(DT2, DS1))}
    ${W('g8c', 1, 'ra', A(lsv(DL1, { rules_alt: R3b })))}
    ${ROW('g8c_s', SLD(DS1, DL1))}
    ${W('g8d', 1, 'ra', A(tadA(DT3, DS1, true)))}
    ${ROW('g8d_t', TRD(DT3, DS1))}
    ${W('g8e', 1, 'ra', A(sadD(DS2, DL1)))}
    ${W('g8f', 1, 'ra', A(tadA(DT4, DS1, 1)))}
    ${W('g8g', 1, 'ra', A(tadA(DT4, SA, true)))}
    ${RS}
    ${W('g8h0', 1, 'ra', A(O('league_create', { league_id: DL2, name: 'D2b', date_from: '2026-11-01', date_to: '2026-11-30', players_main: 4, rules: R4r })))}
    ${W('g8h', 1, 'ra', A(sadD(DS3, DL2, { date: '2026-12-01' })))}
    ${W('g8h2', 1, 'ra', A(sadD(DS3, DL2, { date: '2026-10-31' })))}
    ${W('g8i', 1, 'ra', A(sadD(DS3, DL2, { rate: 50 })))}
    ${W('g8j', 1, 'ra', A(sadD(DS3, DL2, { rate: 100 })))}
    ${ROW('g8j_s', SLD(DS3, DL2))}
    ${W('g8k', 1, 'ra', A(tadA(DT4, DS3, true)))}
    ${RS}
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version)
      select x.id, ra, '${DS1}', 'd2', 4, s.rule_set_id, s.rule_version from mahjong.sessions s, unnest(array[${DT7.map((id) => `'${id}'::uuid`).join(', ')}]) x(id) where s.id = '${DS1}';
    ${W('g8l', 1, 'ra', A(tadA(DT11, DS1, false)))}
    ${ROW('g8l_n', `select count(*) from mahjong.tables where session_id = '${DS1}'`)}
    insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values (ra, '${DS1}', 1, '{}', '{}', '[]');
    ${W('g8m', 1, 'ra', A(sadD(DS2, DL1), tadA(DT4, DS2, true)))}
    ${ROW('g8m_s', SLD(DS2, DL1))} ${ROW('g8m_t', TRD(DT4, DS2))}`)}

  /* ⑩ 表（人7 が持ち主の部屋を rules ごとに作る） */
  ${WT_RK.map((k) => `${asWho(7)}
  r := public.mj_room_create(gen_random_uuid(), ${lit('w-rt-' + k)}, ${lit(PASS)}, ${lit(JSON.stringify(WT.rules[k]))}::jsonb, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)));
  res := res || jsonb_build_object('made_${WT_ROOM[k]}', r); ${WT_ROOM[k]} := (r->>'room_id')::uuid;
  ${RS}
  ${W('tb_' + WT_ROOM[k], 7, WT_ROOM[k], wtOps(k, WT.base_ops))}`).join('\n  ')}
  ${WT_CASES.map((c, i) => undo('tc' + i, `${RS}
    ${W('tc' + i, 7, WT_ROOM[c.rules] || 'rz', wtOps(WT_ROOM[c.rules] ? c.rules : WT_RK[0], c.ops))}`)).join('\n  ')}
`;

const mkSql = (prefix = '') => `do ${q('wt')} declare res jsonb := '{}'; r jsonb; cx jsonb; i int; nm text; arr jsonb; v_no text;
  ra uuid; rb uuid; rc uuid; re uuid; rf uuid; rz uuid; ${WT_RK.map((k) => WT_ROOM[k] + ' uuid;').join(' ')}
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${KARI()}
  ${prefix}
  ${body}
  raise exception 'MJRESULT%', res::text;
end ${q('wt')};`;

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}
async function runSql(sql) {
  const { text: t } = await mq(sql);
  let msg = t; try { msg = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: '結果の例外が来なかった: ' + msg.slice(0, 1500) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない: ' + e.message }; }
}

/* ── lib（画面の lib/room-state.mjs の tableView）＝⑦ の比べ ── */
async function loadLib() {
  const cands = [process.env.MJ_GAMEN_LIB, path.join(ROOT, 'lib')].filter(Boolean);
  for (const d of cands) {
    const p = path.join(d, 'room-state.mjs');
    if (fs.existsSync(p)) { try { return { mod: await import(pathToFileURL(p).href), where: p }; } catch (e) { return { err: p + ' ' + e.message }; } }
  }
  return { err: 'lib/room-state.mjs が見つからない（' + cands.join(' ／ ') + '）' };
}
const libCase = (mod, c) => {
  const st = mod.emptyState();
  st.sessions.push({ session_id: 's', rate: null });
  st.tables.push({ table_id: 't', session_id: 's', rules: { chip_pt10: c[2], shugi_pt10: c[3] } });
  const m = ['m0', 'm1', 'm2', 'm3'];
  c[6].forEach(([who, kind, add]) => {
    const e = st.extras.find((x) => x.member_id === m[who] && x.kind === kind);
    if (e) e.value += add; else st.extras.push({ table_id: 't', member_id: m[who], kind, value: add });
  });
  if (c[7] !== null) st.extras.push({ table_id: 't', member_id: 'outsider', kind: 'chip', value: c[7] });
  const v = mod.tableView(st, 't');
  const one = (k) => (!v.used[k] ? 'unused' : (k === 'chip' ? v.chipSum : v.shugiSum) === 0 ? 'ok' : 'ng');
  return [one('chip'), one('shugi'), v.extrasOk ? 'ok' : 'ng'];
};

function check(out, lib, say) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) { p++; say('  ✓ ' + name); } else { f++; say('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  const J = (x) => JSON.stringify(x);
  const JS = (o) => J(Object.fromEntries(Object.entries(o || {}).sort()));   // jsonb は鍵を長さ→字の順に並べる＝順で比べない
  const R = (k) => (out && out[k]) || {};
  const d = (k) => { const a = out[k + '_c0'], b = out[k + '_c1']; return a && b ? Object.fromEntries(Object.keys(a).map((x) => [x, Number(b[x]) - Number(a[x])])) : null; };
  const has = (k, want) => { const x = d(k); return !!x && Object.entries(want).every(([a, v]) => x[a] === v); };
  const isErr = (k, err, extra = {}) => { const r = R(k); return r.ok === false && r.err === err && Object.entries(extra).every(([x, v]) => J(r[x]) === J(v)); };
  const isOk = (k) => R(k).ok === true;
  const none = { rc: 0, hc: 0, h: 0, op: 0, m: 0, x: 0 };
  const rejNyu = { ...none, ur: 1, u: 1, rn1m: 0, all1m: 0, un: 0, ud: 0, uk: 0, rk: 0, all1d: 0 }; // P6：弾いた呼びは分け合う rn1m・all1m に数えない
  const u = out.u || [];

  ok('部屋を5つ作れた・3人が入れた', ['ra', 'rb', 'rc', 're', 'rf'].every((v) => out['made_' + v]?.ok === true) && ['j2', 'j3', 'j5'].every((k) => out[k]?.ok === true),
    J(['ra', 'rb', 'rc', 're', 'rf', 'j2', 'j3', 'j5'].map((k) => out['made_' + k] || out[k])));
  /* ⓪ */
  ok('⓪ ログイン無し → mj_session（鍵は2つ）', isErr('z0', 'mj_session') && Object.keys(R('z0')).length === 2, J(R('z0')));
  const fw = out.fw || {};
  ok('⓪ mj_write は definer・search_path 空・authenticated だけ・anon と PUBLIC に無し', fw.definer === true && J(fw.config) === J(['search_path=""']) && fw.auth === true && !fw.anon && !fw.public, J(fw));
  ok('⓪ 下請け（mj_w_*・mj_tobi_ok）は客から呼べない', Number(out.priv) === 0 && Number(out.nw) >= 15, `${out.priv} / ${out.nw}`);
  /* ① */
  ok('① member_add×4 → ok・results 4つ（v1）', isOk('m4') && J(R('m4').results) === J([0, 1, 2, 3].map((i) => ({ i, v: 1 }))), J(R('m4')));
  ok('① member_add×4 で行+4・履歴+4・op_results+1', has('m4', { rc: 4, hc: 4, h: 4, op: 1, m: 4 }), J(d('m4')));
  ok('① 入の書き込みは ur・u・rn1m・all1m に 4・un1d・u1d に 4・管の数えは 0・rn1d は数えない', has('m4', { ur: 4, u: 4, rn1m: 4, all1m: 4, un: 4, ud: 4, rn: 0, uk: 0, rk: 0, all1d: 4 }), J(d('m4')));
  ok('① session_add → ok・行+1', isOk('s1') && has('s1', { rc: 1, hc: 1, op: 1 }), J([R('s1'), d('s1')]));
  ok('① table_add → ok・初めの state（チップ使う＝ok・祝儀 null＝unused・extra ok）', isOk('t1') && JS(out.t1_row) === JS({ c: 'ok', s: 'unused', e: 'ok' }), J([R('t1'), out.t1_row]));
  ok('① hanchan_start → ok・行+5（半荘1＋マス4）・履歴+5', isOk('h1') && has('h1', { rc: 5, hc: 5, h: 5 }), J([R('h1'), d('h1')]));
  ok('① 始めた半荘はそろった ok・first_complete_at・版1・tobi {}', out.h1_row?.state === 'ok' && out.h1_row.fc === true && out.h1_row.v === 1 && J(out.h1_row.tobi) === '{}' && out.h1_row.tv === 1, J(out.h1_row));
  ok('① seats は {"席": member_id}', J(out.h1_row?.seats) === J({ 0: MA[0], 1: MA[1], 2: MA[2], 3: MA[3] }), J(out.h1_row?.seats));
  ok('① マスは版1で4つ', J(out.h1_cells) === J([[0, 40000, 1], [1, 30000, 1], [2, 20000, 1], [3, 10000, 1]]), J(out.h1_cells));
  ok('① cell_set で合計を崩す → ok・state ng sum・v2', isOk('c1') && J(R('c1').results) === J([{ i: 0, v: 2 }]) && out.c1_row?.state === 'ng' && out.c1_row.why === 'sum', J([R('c1'), out.c1_row]));
  ok('① 戻す → state ok', isOk('c2') && out.c2_row?.state === 'ok' && out.c2_row.why === null, J([R('c2'), out.c2_row]));
  ok('① extra_add +2 → チップ ng・extra ng', isOk('x1') && JS(out.x1_row) === JS({ c: 'ng', s: 'unused', e: 'ng' }) && has('x1', { rc: 1, hc: 1, x: 2 }), J([R('x1'), out.x1_row, d('x1')]));
  ok('① extra_add −2 → ok', isOk('x2') && JS(out.x2_row) === JS({ c: 'ok', s: 'unused', e: 'ok' }), J([R('x2'), out.x2_row]));
  ok('① settle_snap rev1 → ok・行+1', isOk('ss1') && has('ss1', { rc: 1, hc: 1 }), J([R('ss1'), d('ss1')]));
  ok('① 履歴の行は押した人・役（入）', Array.isArray(out.hist1) && out.hist1.length === 2 && out.hist1.every((x) => x.role === 'nyu' && x.who === u[1] && x.tbl === 'cells'), J(out.hist1));
  /* ①' */
  ok("①' 並び無しの同点で始める → ok・input order", isOk('o_h') && out.o_h_row?.state === 'input' && out.o_h_row.why === 'order' && out.o_h_row.ton === null, J([R('o_h'), out.o_h_row]));
  ok("①' ton_order つきで始める → ok・その並び・同点でも ok", isOk('o_s') && J(out.o_s_row?.ton) === J(TON4) && out.o_s_row.state === 'ok' && out.o_s_row.ov === 1, J([R('o_s'), out.o_s_row]));
  ok("①' 始めの ton_order に席にいない人（部屋の active な人）→ bad at ton_order・何も書かない", isErr('o_sb', 'bad', { at: 'ton_order' }) && has('o_sb', rejNyu), J([R('o_sb'), d('o_sb')]));
  ok("①' hanchan_order → ok（order_version 2）・並びが入って ok・履歴+1", isOk('o_o') && J(R('o_o').results) === J([{ i: 0, v: 2 }]) && J(out.o_o_row?.ton) === J(MA.slice(0, 4))
    && out.o_o_row.ov === 2 && out.o_o_row.state === 'ok' && has('o_o', { rc: 0, hc: 1, h: 1, op: 1 }), J([R('o_o'), out.o_o_row, d('o_o')]));
  ok("①' hanchan_order に席にいない人 → bad at ton_order", isErr('o_ob', 'bad', { at: 'ton_order' }) && has('o_ob', rejNyu), J([R('o_ob'), d('o_ob')]));
  ok("①' hanchan_order の古い版 → conflict（what order・cur は今の並びと版2）", isErr('o_oc', 'conflict', { at: { what: 'order', hanchan_id: HA3 }, cur: { value: MA.slice(0, 4), version: 2 } }), J(R('o_oc')));
  ok("①' hanchan_order 同じ並び（古い版でも）→ ok・書かない", isOk('o_os') && has('o_os', none), J([R('o_os'), d('o_os')]));
  ok("①' extra_add：部屋の人だがその卓の席にも行にもいない → bad at member_id", isErr('x_ns', 'bad', { at: 'member_id' }) && has('x_ns', rejNyu), J([R('x_ns'), d('x_ns')]));
  /* ② */
  ok('② B の用意（3人・kieru）→ ok・同点の半荘は input order', isOk('b_setup') && out.hb_row?.state === 'input' && out.hb_row.why === 'order', J([R('b_setup'), out.hb_row]));
  ok('② 別の人の同じ op_id → mj_op_other_user・何も書かない', isErr('o1', 'mj_op_other_user') && has('o1', none), J([R('o1'), d('o1')]));
  ok('② 別の部屋の hanchan_id → bad', isErr('xb1', 'bad', { at: 'hanchan_id' }) && has('xb1', rejNyu), J([R('xb1'), d('xb1')]));
  ok('② 別の部屋の table_id → bad', isErr('xb2', 'bad', { at: 'table_id' }), J(R('xb2')));
  ok('② 別の部屋の member_id → bad', isErr('xb3', 'bad', { at: 'member_id' }), J(R('xb3')));
  ok('② 作る op：別の部屋の member_id → bad', isErr('xb4', 'bad', { at: 'member_id' }), J(R('xb4')));
  ok('② 作る op：別の部屋の session_id・table_id・hanchan_id → bad', isErr('xb5', 'bad', { at: 'session_id' }) && isErr('xb6', 'bad', { at: 'table_id' }) && isErr('xb7', 'bad', { at: 'hanchan_id' }), J([R('xb5'), R('xb6'), R('xb7')]));
  ok('② 作る op：同じ部屋の同じ id（中身が違っても）→ ok・何も書かない', isOk('same1') && has('same1', none), J([R('same1'), d('same1')]));
  ok('② 3人卓の seat 3 → bad', isErr('seat3', 'bad', { at: 'seat' }), J(R('seat3')));
  ok('② 知らない引数の鍵 → bad at foo', isErr('unk', 'bad', { at: 'foo', i: 0 }) && has('unk', { ...none, ur: 0, u: 1 }), J([R('unk'), d('unk')]));
  ok('② session_add の league_id → bad', isErr('lg', 'bad', { at: 'league_id' }), J(R('lg')));
  ok('② 同じ名前（trim の後）→ dup・member_id と name を添える', isErr('dupn', 'dup') && R('dupn').member_id === MA[0] && R('dupn').name === '甲', J(R('dupn')));
  const ny = out.ny || {};
  ok('② op 33個（段C）の外の4個は全部 not_yet（i:0）', J(Object.keys(ny).sort()) === J(['history_revert', 'rerev_ok', 'room_export', 'rules_save']) && Object.values(ny).every((r) => r.ok === false && r.err === 'not_yet' && r.i === 0), J(ny));
  ok('② 31個 → too_many', isErr('many', 'too_many'), J(R('many')));
  ok('② 知らない op → bad・配列でない → bad', isErr('fooop', 'bad', { at: 'op' }) && isErr('notarr', 'bad', { what: 'ops' }), J([R('fooop'), R('notarr')]));
  /* ③ */
  ok('③ cells 150（100の倍数でない）→ range', isErr('r1', 'range', { at: 'value' }) && has('r1', rejNyu), J([R('r1'), d('r1')]));
  ok('③ top のルールで kyotaku 1000 → range', isErr('r2', 'range'), J(R('r2')));
  ok('③ kieru で 1000 → ok（版 +1）', isOk('r3') && out.r3_row?.lost === 1000 && out.r3_row.v === 2, J([R('r3'), out.r3_row]));
  ok('③ kieru で 100 → range', isErr('r4', 'range'), J(R('r4')));
  ok('③ extra の合計 1001 → range', isErr('r5', 'range', { at: 'add' }), J(R('r5')));
  ok('③ top のルールで lost 1000 の hanchan_start → range', isErr('r6', 'range', { at: 'lost' }), J(R('r6')));
  ok('③ 100 の倍数でない cells → range', isErr('r7', 'range', { at: 'cells' }), J(R('r7')));
  ok('③ seats の重なり → bad', isErr('r8', 'bad', { at: 'seats' }), J(R('r8')));
  ok('③ rate 15・0・1,999,999,995 → range at rate', ['rr1', 'rr2', 'rr3'].every((k) => isErr(k, 'range', { at: 'rate' })) && has('rr1', rejNyu), J(['rr1', 'rr2', 'rr3'].map(R)));
  ok('③ date 2026-02-30・2026/11/20 → bad at date', isErr('rd1', 'bad', { at: 'date' }) && isErr('rd2', 'bad', { at: 'date' }), J([R('rd1'), R('rd2')]));
  ok('③ place 41字 → bad at place', isErr('rpl', 'bad', { at: 'place' }), J(R('rpl')));
  ok('③ label 空白だけ・21字 → bad at label', isErr('rl1', 'bad', { at: 'label' }) && isErr('rl2', 'bad', { at: 'label' }), J([R('rl1'), R('rl2')]));
  ok('③ name 21字・空白だけ → bad at name', isErr('rn1', 'bad', { at: 'name' }) && isErr('rn2', 'bad', { at: 'name' }), J([R('rn1'), R('rn2')]));
  ok('③ settle_snap rev 0 → bad at rev・32KB 越え → range at size', isErr('rs0', 'bad', { at: 'rev' }) && isErr('rsz', 'range', { at: 'size' }) && has('rsz', rejNyu), J([R('rs0'), R('rsz'), d('rsz')]));
  ok('③ 通る端：rate 10・2,000,000,000・place 40字 → ok', isOk('re1') && isOk('re2'), J([R('re1'), R('re2'), out.re_err, out.re2b_err]));
  ok('③ 通る端：label 20字・name 20字 → ok', isOk('re3') && isOk('re4'), J([R('re3'), R('re4'), out.re_err]));
  {
    const libLen = Buffer.byteLength(J(MANY(MANY_N + 1))) + 8;   // 写しは content・used・missing を配列ごと stringify＝［］と区切り2つで +8
    ok('③ N7 鍵 500 個と「あ」の中身：倉庫で数えて 32,768 ちょうど → ok・1 越え → range at size（写しは同じ中身を短く数える）',
      out.many_len === 32768 && isOk('rm1') && isErr('rm2', 'range', { at: 'size' }) && libLen < 32768, J([out.many_len, libLen, R('rm1'), R('rm2'), out.rm_err]));
  }
  ok('③ 通る端：settle_snap ちょうど 32,768 → ok・1 越え → range at size', out.re5_len === 32768 && isOk('re5') && isErr('re6', 'range', { at: 'size' }), J([out.re5_len, R('re5'), R('re6'), out.re_err]));
  /* ③' */
  ok("③' 取り消した開催日に table_add → bad at session_id", isErr('vs1', 'bad', { at: 'session_id' }) && has('vs1', rejNyu), J([R('vs1'), d('vs1'), out.vs_err]));
  ok("③' 取り消した卓に hanchan_start → bad at table_id", isErr('vt1', 'bad', { at: 'table_id' }), J([R('vt1'), out.vt_err]));
  ok("③' リーグの日（2c-2d1 定め v1.1）：L でない入の table_add → mj_role need L（op の中の門・数えは弾きと同じ）", isErr('lg1', 'mj_role', { need: 'L', i: 0 }) && has('lg1', rejNyu), J([R('lg1'), d('lg1'), out.lgd_err]));
  ok("③' リーグの日：cell_set・extra_add・settle_snap は入でも通る（who_league nyu）・L の table_add は通る", ['lg2', 'lg3', 'lg4', 'lg5'].every(isOk), J(['lg2', 'lg3', 'lg4', 'lg5'].map(R)));
  /* ④ */
  ok('④ 古い版 → conflict と cur（値・版）', isErr('v1', 'conflict', { cur: { value: 30000, version: 1 } }) && has('v1', rejNyu), J([R('v1'), d('v1')]));
  ok('④ void の後の kyotaku_set の古い版 → conflict（hanchans.version）', isOk('v2') && isErr('v3', 'conflict', { cur: { value: 1000, version: 3 } }), J([R('v2'), R('v3'), out.vv_err]));
  ok('④ 同値は ok・履歴0・op_results 0', isOk('v4') && has('v4', none), J([R('v4'), d('v4')]));
  ok('④ settle_snap 同じ rev 同じ中身 → ok・書かない', isOk('v5') && has('v5', none), J([R('v5'), d('v5')]));
  ok('④ settle_snap 同じ rev 違う中身 → conflict', isErr('v6', 'conflict'), J(R('v6')));
  ok('④ settle_snap 飛んだ rev → conflict', isErr('v7', 'conflict', { cur: { value: 1, version: 1 } }), J(R('v7')));
  ok('④ settle_snap rev2（missing は一覧）→ ok', isOk('v8'), J(R('v8')));
  /* ⑤ */
  ok('⑤ 飛んだ席の鍵が無くても ok・why null・一度そろった（B2 段1＝④を外した）', out.ts_row?.state === 'ok' && out.ts_row.why === null && out.ts_row.fc === true, J([R('ts'), out.ts_row]));
  ok('⑤ tobi_set で入れて ok（tobi_version 2）', isOk('tset') && out.tset_row?.state === 'ok' && out.tset_row.tv === 2, J([R('tset'), out.tset_row]));
  ok('⑤ 飛んでいない席の鍵も弾かず入る（そろったは ok のまま）', isOk('tnb') && J(out.tnb_row?.tobi) === J({ 1: 2, 3: 0 }) && out.tnb_row.state === 'ok', J([R('tnb'), out.tnb_row]));
  ok('⑤ tobi_set の古い版 → conflict（what tobi・cur は今の tobi_to と版）・何も書かない', isErr('tcf', 'conflict', { at: { what: 'tobi', hanchan_id: HA2 }, cur: { value: out.tnb_row?.tobi, version: out.tnb_row?.tv } })
    && has('tcf', rejNyu), J([R('tcf'), d('tcf')]));
  ok('⑤ 自分の席・players 外・null・配列 → bad（mj_tobi_ok）', ['tself', 'tout', 'tnull', 'tarr'].every((k) => isErr(k, 'bad', { at: 'tobi_to' })), J(['tself', 'tout', 'tnull', 'tarr'].map(R)));
  ok('⑤ 点を直して飛ばなくなる → 鍵は残る・ok', isOk('tun') && J(out.tun_row?.tobi) === J({ 1: 2, 3: 0 }) && out.tun_row.state === 'ok', J([R('tun'), out.tun_row]));
  ok('⑤ また飛ぶ（tobi_set 無しの組）→ 鍵が消える・ok・why null・tobi_version+1・履歴に tobi_auto（鍵消しは今のまま）', isOk('tre') && J(out.tre_row?.tobi) === J({ 1: 2 })
    && out.tre_row.state === 'ok' && out.tre_row.why === null && out.tre_row.tv === out.tun_row.tv + 1 && has('tre', { hc: 3 }), J([R('tre'), out.tre_row, d('tre')]));
  ok('⑤ 同じ組に tobi_set が在れば消さない', isOk('tk') && isOk('tre2') && J(out.tre2_row?.tobi) === J({ 1: 2, 3: 1 }) && out.tre2_row.state === 'ok', J([R('tre2'), out.tre2_row]));
  ok('⑤ 表へ直に配列・自分の席 → 23514・"all" は通る', out.d_arr === '23514' && out.d_self === '23514' && out.d_ok === 'none', J([out.d_arr, out.d_self, out.d_ok]));
  ok('⑤ mj_tobi_ok：配列 false・null false・{"0":1,"2":"all"} true・3人で受け取り3 false', out.fn_arr === false && out.fn_null === false && out.fn_ok === true && out.fn_3p === false,
    J([out.fn_arr, out.fn_null, out.fn_ok, out.fn_3p]));
  ok("⑤' {r:[0,2]} → ok・tobi_to はそのまま・版+1", isOk('tr') && J(out.tr_row?.tobi) === J({ r: [0, 2] }) && out.tr_row.state === 'ok', J([R('tr'), out.tr_row]));
  ok("⑤' {r} の形は点を直して飛び直しても変えない（鍵消し無し・版そのまま）", isOk('tr_un') && isOk('tr_re') && J(out.tr_re_row?.tobi) === J({ r: [0, 2] }) && out.tr_re_row.tv === out.tr_row?.tv, J([R('tr_re'), out.tr_row, out.tr_re_row]));
  ok("⑤' {r} の小さい順でない・同じ席2回・players 外・負・小数・字・配列でない・r 以外の鍵 → bad at tobi_to", ['tr_unsorted', 'tr_dup', 'tr_out', 'tr_neg', 'tr_frac', 'tr_str', 'tr_notarr', 'tr_x'].every((k) => isErr(k, 'bad', { at: 'tobi_to' })), J(['tr_unsorted', 'tr_dup', 'tr_out', 'tr_neg', 'tr_frac', 'tr_str', 'tr_notarr', 'tr_x'].map(R)));
  ok("⑤' {r:[]}（誰も押していない）→ ok", isOk('tr_empty') && J(out.tr_empty_row?.tobi) === J({ r: [] }), J([R('tr_empty'), out.tr_empty_row]));
  /* ⑤'' E2 */
  const cfE = (k, at, cur) => isErr(k, 'conflict', { at }) && (cur === undefined ? !('cur' in R(k)) : J(R(k).cur) === J(cur));
  ok("⑤'' E2 空いた席が null の始め → ok・行は半荘1＋数の席2・履歴+3", isOk('e1') && has('e1', { rc: 3, hc: 3, h: 3 }) && Number(out.e1_nc) === 2, J([R('e1'), d('e1'), out.e1_nc]));
  ok("⑤'' E2 点がまだの回は state input・理由 cells", out.e1_row?.state === 'input' && out.e1_row.why === 'cells', J(out.e1_row));
  ok("⑤'' E2 mj_read（素の room）の cells・cell_ver は席の数で空いた席は null", J(out.e1_rd) === J({ c: [40000, null, 20000, null], v: [1, null, 1, null] }), J(out.e1_rd));
  ok("⑤'' E2 mj_read（v3）の cells・cell_ver も席の数で空いた席は null", J(out.e1_rd3) === J({ c: [40000, null, 20000, null], v: [1, null, 1, null] }), J(out.e1_rd3));
  ok("⑤'' E2 開いている回が在る卓の始め → conflict at {what:open, hanchan_id}・cur 無し・何も書かない", cfE('e_open', { what: 'open', hanchan_id: HE1 }) && has('e_open', none), J([R('e_open'), d('e_open')]));
  ok("⑤'' E2 seen_n の無い古い PWA の始めも open で止める", cfE('e_open_old', { what: 'open', hanchan_id: HE1 }) && has('e_open_old', none), J(R('e_open_old')));
  ok("⑤'' E2 同じ hanchan_id の送り直しは門より先に ok（made 0）", isOk('e_resend') && has('e_resend', { rc: 0, h: 0 }), J([R('e_resend'), d('e_resend')]));
  ok("⑤'' E2 全部 null・100点単位でない数 → range at cells／字 → bad at cells（門より先）", isErr('e_allnull', 'range', { at: 'cells' }) && isErr('e_mix', 'range', { at: 'cells' }) && isErr('e_str', 'bad', { at: 'cells' }),
    J([R('e_allnull'), R('e_mix'), R('e_str')]));
  ok("⑤'' E2 seen_n が負・小数・字 → bad at seen_n", ['e_sn_neg', 'e_sn_frac', 'e_sn_str'].every((k) => isErr(k, 'bad', { at: 'seen_n' })), J(['e_sn_neg', 'e_sn_frac', 'e_sn_str'].map(R)));
  ok("⑤'' E2 空いた席のある始めの seen_cells（数だけ）→ bad at seen_cells（例外にしない）", isErr('e_sc', 'bad', { at: 'seen_cells' }), J(R('e_sc')));
  ok("⑤'' E2 行の無い席に版1 → conflict cur {null, 0}", cfE('e_bv1', { seat: 3, what: 'cell', hanchan_id: HE1 }, { value: null, version: 0 }) && has('e_bv1', none), J(R('e_bv1')));
  ok("⑤'' E2 行の無い席に版0 → ok・v1・行+1", isOk('e_bv0') && J(R('e_bv0').results) === J([{ i: 0, v: 1 }]) && Number(out.e_bv0_nc) === 3 && has('e_bv0', { rc: 1, h: 1 }), J([R('e_bv0'), d('e_bv0'), out.e_bv0_nc]));
  ok("⑤'' E2 行が在る席に2回目の版0（違う数）→ conflict cur {value, version}", cfE('e_bv0b', { seat: 1, what: 'cell', hanchan_id: HE1 }, { value: 30000, version: 1 }), J(R('e_bv0b')));
  ok("⑤'' E2 行が在る席に同じ数の版0 → ok（何もしない）", isOk('e_bv0same') && has('e_bv0same', { rc: 0, h: 0 }), J([R('e_bv0same'), d('e_bv0same')]));
  ok("⑤'' E2 全員そろうと state ok・読みは [40000,30000,20000,10000]・版 [1,1,1,1]", isOk('e_fill') && out.e_fill_row?.state === 'ok' && J(out.e_fill_rd) === J({ c: [40000, 30000, 20000, 10000], v: [1, 1, 1, 1] }),
    J([R('e_fill'), out.e_fill_row, out.e_fill_rd]));
  ok("⑤'' E2 鎖の回の数＞seen_n → conflict at {what:new, hanchan_id: 一番新しい回}・何も書かない", cfE('e_new', { what: 'new', hanchan_id: HE1 }) && has('e_new', none), J([R('e_new'), d('e_new')]));
  ok("⑤'' E2 取り消した回も鎖の回の数に入る（void の後 seen_n 1 の始め → conflict new・hanchan_id は取り消した一番新しい回・何も書かない）", cfE('e_new_void', { what: 'new', hanchan_id: HE2 }) && has('e_new_void', none), J([R('e_new_void'), d('e_new_void')]));
  ok("⑤'' E2 取り消した回は開いていない・数には入る（void の後 seen_n 2 で始め ok）", isOk('e_h2') && isOk('e_v2') && isOk('e_h3'), J([R('e_h2'), R('e_v2'), R('e_h3')]));
  ok("⑤'' E2 点がまだの回を戻す時に鎖に他の開いている回 → conflict open・戻さない", cfE('e_unv', { what: 'open', hanchan_id: HE3 }) && out.e_unv_row?.voided === true, J([R('e_unv'), out.e_unv_row]));
  ok("⑤' mj_tobi_ok：3人 [0,1,2] true・3人 [3] false・4人 [0,1,2,3] true", out.fr_3all === true && out.fr_3out === false && out.fr_4all === true, J([out.fr_3all, out.fr_3out, out.fr_4all]));
  ok('⑤ tobi_from all のルールでは鍵無しで ok', out.hc_all?.state === 'ok', J(out.hc_all));
  /* ⑥ */
  ok('⑥ ok の半荘を cell_set → changed_after_complete_at・changed_by_user', out.c1_row?.ch === true && out.c1_row.cb === u[1], J(out.c1_row));
  ok('⑥ void → voided・版+1・changed', isOk('vo1') && out.vo1_row?.voided === true && out.vo1_row.ch === true, J([R('vo1'), out.vo1_row, out.vo_err]));
  ok('⑥ 同値の void は書かない', isOk('vo2') && has('vo2', none), J([R('vo2'), d('vo2')]));
  ok('⑥ unvoid → 戻る・そろったを出し直す', isOk('vo3') && out.vo3_row?.voided === false && out.vo3_row.state === 'ok', J([R('vo3'), out.vo3_row]));
  /* ⑦ */
  ok('⑦ 4部屋の用意と extras → ok', ['k_a', 'k_c', 'k_e', 'k_f', 'kx_ra', 'kx_rc', 'kx_re'].every((k) => isOk(k)), J(['k_a', 'k_c', 'k_e', 'k_f', 'kx_ra', 'kx_rc', 'kx_re'].map(R)));
  ok('⑦ c7 使わない種（チップ null）への extra_add → bad at kind・行0（2c-2a1）', isErr('kx_rf', 'bad', { at: 'kind' }) && Number(out.c7_x) === 0, J([R('kx_rf'), out.c7_x]));
  CASES.forEach((c, i) => {
    const db = out['case' + i] ? [out['case' + i].c, out['case' + i].s, out['case' + i].e] : null;
    ok(`⑦ ${c[0]}：倉庫 ${J(db)} ＝ 手の答え ${J(c[8])}`, J(db) === J(c[8]));
    if (lib.mod) { const lv = libCase(lib.mod, c); ok(`⑦ ${c[0]}：lib ${J(lv)} ＝ 倉庫`, J(lv) === J(db)); }
  });
  ok('⑦ lib（画面の room-state.mjs）を読めた' + (lib.where ? '（' + lib.where + '）' : ''), !!lib.mod, lib.err || '');
  ok('⑦ 倉庫だけの守り：chip_pt10 の鍵が無い → 使う側（+1 で ng）', isOk('kf1') && out.kf1_row?.c === 'ng', J([R('kf1'), out.kf1_row, out.kf_err]));
  /* ⑫ 2c-3b 自由な項目（倉庫だけ＝写しは画面が 2c-3b の形を持つまで比べない） */
  const tk = (k, e, why, fc) => out[k]?.e === e && out[k]?.why === why && out[k]?.fc === fc;
  ok('⑫ 卓の用意（ルールに tane_custom ko・ba・ke）→ ok', isOk('k3a'), J([R('k3a'), out.k3_err]));
  ok('⑫ 合計0の種 c:ko に +3 → ok・卓は ng・理由 c:ko・chip は ok のまま', isOk('k3b') && tk('k3b_t', 'ng', 'c:ko', false) && out.k3b_t.c === 'ok', J([R('k3b'), out.k3b_t]));
  ok('⑫ c:ko の −3 で合計0 → ok・理由 null・一度そろった', isOk('k3c') && tk('k3c_t', 'ok', null, true), J([R('k3c'), out.k3c_t]));
  ok('⑫ 外へ払う種だけ（c:ba +5）→ ok・卓は ok・★一度そろったにしない★', isOk('k3d') && tk('k3d_t', 'ok', null, false), J([R('k3d'), out.k3d_t]));
  ok('⑫ 外へ払う種：足して負になる extra_add（5−6）→ bad at add・何も書かない', isErr('k3e', 'bad', { at: 'add' }) && Number(out.k3e_x) === 5, J([R('k3e'), out.k3e_x]));
  ok('⑫ 外へ払う種：足して0になる extra_add（5−5）→ ok', isOk('k3e2') && Number(out.k3e2_x) === 0, J([R('k3e2'), out.k3e2_x]));
  ok('⑫ 外へ払う種：行の無い人へ −1 → bad at add', isErr('k3f', 'bad', { at: 'add' }), J(R('k3f')));
  ok('⑫ 外へ払う種：extra_set の −1 → bad at value', isErr('k3g', 'bad', { at: 'value' }), J(R('k3g')));
  ok('⑫ 外へ払う種：extra_set の 0（行なし）→ ok', isOk('k3g2'), J(R('k3g2')));
  ok('⑫ ルールに無い id（c:zz）→ bad at kind', isErr('k3h', 'bad', { at: 'kind' }), J(R('k3h')));
  ok("⑫ 形の違う種（'c:'・'c:ABC'・'c:123456789'）→ bad at kind・行0", ['k3i1', 'k3i2', 'k3i3'].every((k) => isErr(k, 'bad', { at: 'kind' })) && Number(out.k3i_x) === 0,
    J([R('k3i1'), R('k3i2'), R('k3i3'), out.k3i_x]));
  ok('⑫ 合計0の種が2つ ng（c:ke と c:ko）→ 理由は tane_custom の並びの順の最初（c:ko）', isOk('k3j') && tk('k3j_t', 'ng', 'c:ko', false), J([R('k3j'), out.k3j_t]));
  ok('⑫ 正味の門で chip と c:ko が両方弾かれる → 字順 C で c:ko が先（i 1）', isErr('k3n', 'bad', { at: 'member_id', i: 1 }), J(R('k3n')));
  ok('⑫ 正味の門で c:ko と chip（並びを逆に）→ c:ko が先（i 0）', isErr('k3o', 'bad', { at: 'member_id', i: 0 }), J(R('k3o')));
  ok('⑫ chip の ng と合計0の種の ng が重なる → 卓 ng・理由は自由な項目（c:ko）・chip_state は ng（理由が chip を隠さない＝chip は chip_state で見る）', isOk('k3m') && tk('k3m_t', 'ng', 'c:ko', false) && out.k3m_t.c === 'ng', J([R('k3m'), out.k3m_t]));
  ok('⑫ chip だけ ng → 理由 null（今まで通り）・一度そろったは消えない', isOk('k3k') && tk('k3k_t', 'ng', null, true) && out.k3k_t.c === 'ng', J([R('k3k'), out.k3k_t]));
  ok('⑫ extra_set で合計0の種 c:ko を 2 → ok・卓は ng 理由 c:ko', isOk('k3l') && tk('k3l_t', 'ng', 'c:ko', false) && Number(out.k3l_x) === 2, J([R('k3l'), out.k3l_t, out.k3l_x]));
  ok('⑫ tane_custom の無いルール（ra のまま）で c:ko → bad at kind', isOk('k4a') && isErr('k4b', 'bad', { at: 'kind' }), J([R('k4a'), R('k4b'), out.k4_err]));
  /* ⑬ 2c-3c’ やきとり＝extras の種 'yaki'（倉庫だけ） */
  ok('⑬ 卓の用意（ルール yakitori true・pt 10・tane_custom）→ ok', isOk('y5a'), J([R('y5a'), out.y5_err]));
  ok("⑬ yaki +3 → ok・卓は ng・理由 'yaki'・行の合計 3", isOk('y5b') && tk('y5b_t', 'ng', 'yaki', false) && Number(out.y5b_x) === 3, J([R('y5b'), out.y5b_t, out.y5b_x]));
  ok('⑬ yaki −3 で合計0 → ok・理由 null・一度そろった', isOk('y5c') && tk('y5c_t', 'ok', null, true), J([R('y5c'), out.y5c_t]));
  ok("⑬ extra_set の yaki 2 → ok・卓は ng 理由 'yaki'", isOk('y5d') && tk('y5d_t', 'ng', 'yaki', false), J([R('y5d'), out.y5d_t]));
  ok("⑬ yaki と c:ko が両方 ng → 理由は 'yaki'（yaki が c: より先）", isOk('y5e') && tk('y5e_t', 'ng', 'yaki', false), J([R('y5e'), out.y5e_t]));
  ok("⑬ yaki がそろって c:ko だけ ng → 理由 'c:ko'", isOk('y5f') && tk('y5f_t', 'ng', 'c:ko', false), J([R('y5f'), out.y5f_t]));
  ok('⑬ yaki の +1000 → range at add（chip の ③ r5 と同じ）', isErr('y5g', 'range', { at: 'add' }), J(R('y5g')));
  ok('⑬ op yakitori_set は無い → bad at op（古い端末が送っても黙って消えない）', isErr('y5h', 'bad', { at: 'op' }), J(R('y5h')));
  ok('⑬ pt 0 の卓（yakitori true）：yaki の extra_add・extra_set → bad at kind・行0（黙って0円にしない）', isOk('y6a') && isErr('y6b', 'bad', { at: 'kind' }) && isErr('y6c', 'bad', { at: 'kind' }) && Number(out.y6_x) === 0, J([R('y6a'), R('y6b'), R('y6c'), out.y6_x, out.y6_err]));
  ok('⑬ yakitori false の卓：yaki → bad at kind', isOk('y7a') && isErr('y7b', 'bad', { at: 'kind' }), J([R('y7a'), R('y7b'), out.y7_err]));
  /* ⑯ B2 段1 飛び賞＝extras の種 'tobi'（倉庫だけ） */
  ok('⑯ 卓の用意（ルール tobi true・pt 10・yakitori true・tane_custom）→ ok', isOk('ob5a'), J([R('ob5a'), out.ob5_err]));
  ok("⑯ tobi +3 → ok・行の合計 3・E1：卓は ok（種 tobi の行は数えない）", isOk('ob5b') && tk('ob5b_t', 'ok', null, false) && Number(out.ob5b_x) === 3, J([R('ob5b'), out.ob5b_t, out.ob5b_x]));
  ok('⑯ tobi −3 で合計0 → ok・理由 null・E1：tobi の行だけでは一度そろったにしない', isOk('ob5c') && tk('ob5c_t', 'ok', null, false), J([R('ob5c'), out.ob5c_t]));
  ok("⑯ yaki・tobi・c:ko が全部 ng → 理由は 'yaki'", isOk('ob5d') && tk('ob5d_t', 'ng', 'yaki', false), J([R('ob5d'), out.ob5d_t]));
  ok("⑯ yaki がそろって tobi・c:ko が残る → E1：理由 'c:ko'（tobi は数えない）", isOk('ob5e') && tk('ob5e_t', 'ng', 'c:ko', false), J([R('ob5e'), out.ob5e_t]));
  ok("⑯ tobi もそろって c:ko だけ ng → 理由 'c:ko'", isOk('ob5f') && tk('ob5f_t', 'ng', 'c:ko', false), J([R('ob5f'), out.ob5f_t]));
  ok("⑯ extra_set の tobi 2 → ok・E1：卓は ok のまま", isOk('ob5g') && tk('ob5g_t', 'ok', null, false), J([R('ob5g'), out.ob5g_t]));
  ok('⑯ pt 0 の卓（tobi true）：tobi の extra_add・extra_set → bad at kind・行0（黙って0円にしない）', isOk('ob6a') && isErr('ob6b', 'bad', { at: 'kind' }) && isErr('ob6c', 'bad', { at: 'kind' }) && Number(out.ob6_x) === 0, J([R('ob6a'), R('ob6b'), R('ob6c'), out.ob6_x, out.ob6_err]));
  ok('⑯ tobi false の卓：tobi → bad at kind', isOk('ob7a') && isErr('ob7b', 'bad', { at: 'kind' }), J([R('ob7a'), R('ob7b'), out.ob7_err]));
  /* ⑰ B1 卓の席 op table_seats */
  const vq = (k, v) => J(R(k).results) === J([{ i: 0, v }]);   // v1 はこの後で決まる（同じ形）
  ok('⑰ 卓の用意 → ok・seats は []・seats_version 1', isOk('q0') && J(out.q0_t?.seats) === '[]' && out.q0_t?.sv === 1, J([R('q0'), out.q0_t, out.q_err]));
  ok('⑰ 席を決める前：半荘0の卓に chip +3 → bad at member_id（今のまま）', isErr('q1', 'bad', { at: 'member_id' }), J(R('q1')));
  ok('⑰ table_seats：席を決める → ok・seats_version 2・version は上げない・history 1', isOk('q2') && vq('q2', 2) && J(out.q2_t?.seats) === J(MA.slice(0, 4)) && out.q2_t?.sv === 2
    && out.q2_t?.v === out.q0_t?.v && Number(out.q2_hc) === 1 && has('q2', { hc: 1, h: 1 }), J([R('q2'), out.q2_t, out.q2_hc, d('q2')]));
  ok('⑰ table_seats：同じ → ok・書かない（v2）', isOk('q3') && vq('q3', 2) && has('q3', { hc: 0, h: 0 }), J([R('q3'), d('q3')]));
  ok('⑰ 卓の席の人に半荘0の卓で chip +3 → ok（正味の門が卓の席を見る）', isOk('q4') && has('q4', { x: 3 }), J([R('q4'), d('q4')]));
  ok('⑰ 卓の席にいない部屋の人に chip +3 → bad at member_id', isErr('q5', 'bad', { at: 'member_id' }) && has('q5', { x: 0 }), J([R('q5'), d('q5')]));
  ok('⑰ table_seats：長さ違い（3人・5つ目が重なり）→ bad at seats', isErr('q6', 'bad', { at: 'seats' }) && isErr('q7', 'bad', { at: 'seats' }), J([R('q6'), R('q7')]));
  ok('⑰ table_seats：重なり → bad at seats', isErr('q8', 'bad', { at: 'seats' }), J(R('q8')));
  ok('⑰ table_seats：よその部屋の人 → bad at seats', isErr('q9', 'bad', { at: 'seats' }), J(R('q9')));
  ok('⑰ table_seats：取り消した卓 → bad at table_id（i 1）', isErr('qa', 'bad', { at: 'table_id', i: 1 }), J(R('qa')));
  ok('⑰ table_seats：替える（大文字で送る）→ 小文字で入る・seats_version 3・history 2・外した人の行は残る', isOk('qb') && vq('qb', 3) && J(out.qb_t?.seats) === J([MA[1], MA[4], MA[2], MA[3]])
    && out.qb_t?.sv === 3 && Number(out.qb_hc) === 2 && Number(out.qb_x) === 1, J([R('qb'), out.qb_t, out.qb_hc, out.qb_x]));
  ok('⑰ 列の check：配列でない・長さ違いを表へ直に → 23514', out.qc === '23514' && out.qd === '23514', J([out.qc, out.qd, out.q_err]));
  /* ⑦' 2c-2a1 */
  const tx = (k, fc, ch, e) => out[k]?.fc === fc && out[k]?.ch === ch && (e === undefined || out[k]?.e === e);
  ok("⑦' 卓の用意 → ok", isOk('p0') && isOk('g0') && isOk('s0'), J([R('p0'), R('g0'), R('s0'), out.p_err, out.g_err, out.s_err]));
  ok("⑦' 生まれた卓は first_complete_at 空（行0で合計0でも）", tx('p0_n', false, false, 'ok'), J(out.p0_n));
  ok("⑦' 最初の extra_add（A +3）は印なし・空のまま", isOk('p1') && tx('p1_n', false, false, 'ng'), J([R('p1'), out.p1_n]));
  ok("⑦' A +3 → B −3 でそろう・その組は印なし", isOk('p2') && tx('p2_n', true, false, 'ok'), J([R('p2'), out.p2_n]));
  ok("⑦' そろった卓を ng に壊す extra_add → 卓の印・first_complete_at は消えない", isOk('p3') && tx('p3_n', true, true, 'ng') && !!out.p3_n?.cb, J([R('p3'), out.p3_n]));
  ok("⑦' 1組［A +3・B −3］でそろう（state は ok のまま変わらない書き）・印なし", isOk('p4') && tx('p4_p', true, false, 'ok'), J([R('p4'), out.p4_p]));
  ok("⑦' A +3 → A −3（行は在るが0）は空のまま", isOk('p6') && tx('p6_q', false, false, 'ok'), J([R('p6'), out.p6_q]));
  ok("⑦' 同じ組で +1 と −1（正味が同じ）→ 印なし", isOk('p7') && tx('p7_p', true, false, 'ok'), J([R('p7'), out.p7_p]));
  ok("⑦' そろった卓に extra_add（ok→ng）→ 卓の印", isOk('p8') && tx('p8_p', true, true, 'ng'), J([R('p8'), out.p8_p]));
  ok("⑦' 正味の門：席にいない人の 3 → 0 は ok", isOk('g1'), J([R('g1'), out.g_err]));
  ok("⑦' 正味の門：0 → −1（0から離れる）は bad at member_id", isErr('g2', 'bad', { at: 'member_id', i: 0 }) && has('g2', rejNyu), J([R('g2'), d('g2')]));
  ok("⑦' 正味の門：3 → −2（0を越える）は bad", isErr('g3', 'bad', { at: 'member_id' }), J(R('g3')));
  ok("⑦' 正味の門：3 → 4（離れる）は bad", isErr('g4', 'bad', { at: 'member_id' }), J(R('g4')));
  ok("⑦' 正味の門：1組で −1・+1（正味が同じ）は ok", isOk('g5'), J(R('g5')));
  ok("⑦' 正味の門：弾きの i は最後にその行を触った op（席の人 +1・席にいない人 +1 → i 1）", isErr('g6', 'bad', { at: 'member_id', i: 1 }), J(R('g6')));
  ok("⑦' 正味の門：3 → 1 は ok（行は 1）", isOk('g7') && Number(out.g7_v) === 1, J([R('g7'), out.g7_v]));
  ok("⑦' 使わない種（祝儀 null）への extra_add → bad at kind", isErr('u1', 'bad', { at: 'kind' }), J([R('u1'), out.u_err]));
  ok("⑦' 確かめの順：使わない種で部屋にいない人 → kind が先", isErr('u2', 'bad', { at: 'kind' }), J(R('u2')));
  ok("⑦' 確かめの順：部屋にいない人に add 1000 → member が先（range でない）", isErr('u5', 'bad', { at: 'member_id' }), J(R('u5')));
  ok("⑦' 取り消した開催日の卓への extra_add → bad at table_id", isErr('u3', 'bad', { at: 'table_id' }), J(R('u3')));
  ok("⑦' 取り消した開催日でも使わない種なら kind が先", isErr('u4', 'bad', { at: 'kind' }), J(R('u4')));
  ok("⑦' 同じ取引の締め（made_at = now()）だけの開催日：そろっていない卓に extra_add → 卓の印なし", isOk('s1') && tx('s1_w', false, false), J([R('s1'), out.s1_w, out.s_err]));
  ok("⑦' 同じ取引の締めだけ：そろっていない半荘に cell_set → 半荘の印なし", isOk('s1h') && out.s1h_v?.ch === false && out.s1h_v?.fc === false, J([R('s1h'), out.s1h_v]));
  ok("⑦' 前の組で締めた開催日：そろっていない卓に extra_add → 卓の印", isOk('s2') && tx('s2_v', false, true), J([R('s2'), out.s2_v]));
  ok("⑦' 前の組で締めた開催日：そろっていない半荘に cell_set → 半荘の印", isOk('s2h') && out.s2h_v?.ch === true && out.s2h_v?.fc === false, J([R('s2h'), out.s2h_v]));
  /* ⑪ 2c-2a2 */
  const v1 = (k, v) => J(R(k).results) === J([{ i: 0, v }]);
  ok('⑪ 用意（人・卓）→ ok', ['km0', 'ke0', 'ke9', 'kv0', 'kt0', 'ky0', 'ks0', 'kx0'].every(isOk), J(['km0', 'ke0', 'ke9', 'kv0', 'kt0', 'ky0', 'ks0', 'kx0'].map(R).concat([out.k_err, out.kl_err, out.ke_err, out.kv_err, out.kt_err, out.ky_err, out.ks_err, out.kx_err])));
  ok('⑪ member_rename：Ab → aB（そろえた字が同じでも自分は dup にしない）→ ok・v2', isOk('km1') && v1('km1', 2) && out.km1_r?.name === 'aB' && has('km1', { rc: 0, hc: 1, h: 1, m: 0 }), J([R('km1'), out.km1_r, d('km1')]));
  ok('⑪ member_rename：ほかの active の人と同じ（前後の空白・全角空白は除く）→ dup・member_id と name', isErr('km2', 'dup', { at: 'name', i: 0 }) && R('km2').member_id === K2 && R('km2').name === 'Cd', J(R('km2')));
  ok('⑪ member_rename：同じ名前 → ok・書かない（v2）', isOk('km3') && v1('km3', 2) && has('km3', { hc: 0, h: 0 }), J([R('km3'), d('km3')]));
  ok('⑪ member_rename：無い人・よその部屋の人 → bad at member_id', isErr('km4', 'bad', { at: 'member_id' }) && isErr('kma', 'bad', { at: 'member_id' }), J([R('km4'), R('kma')]));
  ok('⑪ member_rename：空白だけ → bad at name', isErr('km5', 'bad', { at: 'name' }) && has('km5', rejNyu), J([R('km5'), d('km5')]));
  ok('⑪ member_active：false → ok・inactive の人の名は使える（K1 を Cd に）', isOk('km6') && isOk('km7'), J([R('km6'), R('km7')]));
  ok('⑪ member_active：true に戻す時だけ同じ名の active な人 → dup at active', isErr('km8', 'dup', { at: 'active' }) && R('km8').member_id === K1 && out.km_r2?.active === false, J([R('km8'), out.km_r2]));
  ok('⑪ member_active：boolean でない → bad at active', isErr('km9', 'bad', { at: 'active' }), J(R('km9')));
  ok('⑪ member_rename の履歴は col name で2行・版3', Number(out.km_h) === 2 && out.km_r?.v === 3 && out.km_r?.name === 'Cd', J([out.km_h, out.km_r]));
  ok('⑪ リーグの日に出た人の rename・active：持ち主でも唯一の L でもない入 → mj_role need owner_or_sole_L', isErr('kl1', 'mj_role', { need: 'owner_or_sole_L' }) && isErr('kl2', 'mj_role', { need: 'owner_or_sole_L' }), J([R('kl1'), R('kl2'), out.kl_err]));
  ok('⑪ リーグの日に出ていない人の rename は通る', isOk('kl3'), J(R('kl3')));
  ok('⑪ リーグの日の session_edit・table_edit：L でない入 → mj_role need L', isErr('kl4', 'mj_role', { need: 'L' }) && isErr('kl5', 'mj_role', { need: 'L' }), J([R('kl4'), R('kl5')]));
  ok('⑪ リーグの日の session_edit・table_edit・rename：L（持ち主）は通る', ['kl6', 'kl7', 'kl8'].every(isOk), J(['kl6', 'kl7', 'kl8'].map(R)));
  ok('⑪ session_edit：place → ok・履歴1', isOk('ke1') && has('ke1', { hc: 1, h: 1 }), J([R('ke1'), d('ke1')]));
  ok('⑪ session_edit：同じ → ok・書かない', isOk('ke2') && has('ke2', { hc: 0, h: 0 }), J([R('ke2'), d('ke2')]));
  ok('⑪ session_edit：date null・2026-02-30 → bad at date', isErr('ke3', 'bad', { at: 'date' }) && isErr('ke7', 'bad', { at: 'date' }), J([R('ke3'), R('ke7')]));
  ok('⑪ session_edit：rate 15 → range at rate', isErr('ke4', 'range', { at: 'rate' }), J(R('ke4')));
  ok('⑪ session_edit：league_id の鍵 → bad at league_id', isErr('ke5', 'bad', { at: 'league_id' }), J(R('ke5')));
  ok('⑪ session_edit：voided が boolean でない → bad at voided', isErr('ke6', 'bad', { at: 'voided' }), J(R('ke6')));
  ok('⑪ session_edit：rate と date → 履歴は変わった列ごと（2行）', isOk('ke8') && Number(out.ke8_hist) === 2 && out.ke8_s?.rate === 50 && out.ke8_s?.date === '2026-11-21', J([R('ke8'), out.ke8_hist, out.ke8_s]));
  ok('⑪ session_edit のレート：そろった卓（rate_mode session）に卓の印・半荘には付けない', out.ke8_t?.ch === true && out.ke8_h?.ch === false, J([out.ke8_t, out.ke8_h]));
  ok('⑪ session_edit のレート：そろっていない卓には印なし', out.ke8_n?.ch === false && out.ke8_n?.fc === false, J(out.ke8_n));
  ok('⑪ session_edit のレート：num・none の卓（半荘はそろった）には印なし', isOk('ke9') && out.ke8_q?.ch === false && out.ke8_q?.mode === 'num'
    && out.ke8_r?.ch === false && out.ke8_r?.mode === 'none', J([R('ke9'), out.ke8_q, out.ke8_r]));
  ok('⑪ table_edit のレート：取り消した開催日のそろった卓には印なし', isOk('kv3') && out.kv3_t?.mode === 'num' && out.kv3_t?.ch === false, J([R('kv3'), out.kv3_t]));
  ok('⑪ extra_set：取り消した開催日の卓 → bad at table_id', isErr('kv4', 'bad', { at: 'table_id' }), J(R('kv4')));
  ok('⑪ extra_add：取り消した卓 → bad at table_id', isErr('ktx', 'bad', { at: 'table_id' }), J(R('ktx')));
  ok('⑪ extra_set：取り消した卓 → bad at table_id', isErr('kty', 'bad', { at: 'table_id' }), J(R('kty')));
  ok('⑪ table_edit：num の rate 15・1999999995 → range at rate（internal にならない）', isErr('ktr1', 'range', { at: 'rate' }) && isErr('ktr2', 'range', { at: 'rate' }), J([R('ktr1'), R('ktr2')]));
  ok('⑪ 取り消し（mj_w_tvoid）：入力中でチップだけそろった卓（f0）→ 卓の印・半荘には付けない', isOk('ky0') && out.ky0_t?.fc === true && out.ky0_t?.ch === false
    && isOk('ky1') && out.ky1_t?.ch === true && out.ky1_t?.voided === true && out.ky1_h?.fc === false && out.ky1_h?.ch === false, J([R('ky0'), out.ky0_t, R('ky1'), out.ky1_t, out.ky1_h]));
  ok('⑪ session_edit の取り消し：下の半荘に印・一度もそろっていない卓（f0 なし）には付けない', isOk('kv1') && out.kv1_h?.ch === true && out.kv1_t?.ch === false, J([R('kv1'), out.kv1_h, out.kv1_t]));
  ok('⑪ session_edit の戻し（voided false）：下の半荘に印', isOk('kv2') && out.kv2_h?.ch === true, J([R('kv2'), out.kv2_h]));
  ok('⑪ table_edit の戻し（voided false）：半荘に印・f0 の無い卓には付けない', isOk('ktu') && out.ktu_h?.ch === true && out.ktu_t?.ch === false && out.ktu_t?.voided === false, J([R('ktu'), out.ktu_h, out.ktu_t]));
  ok('⑪ table_edit：session に戻すと倉庫が rate を null に・session＋rate → bad at rate', isOk('kts1') && isOk('kts2') && out.kts2_t?.mode === 'session' && out.kts2_t?.rate === null
    && isErr('kts3', 'bad', { at: 'rate' }), J([R('kts1'), R('kts2'), out.kts2_t, R('kts3')]));
  ok('⑪ よその部屋の開催日・卓・半荘 → bad（session_id・table_id・hanchan_id・extra_set の table_id）', isErr('kr1', 'bad', { at: 'session_id' }) && isErr('kr2', 'bad', { at: 'table_id' })
    && isErr('kr3', 'bad', { at: 'hanchan_id' }) && isErr('kr4', 'bad', { at: 'table_id' }), J(['kr1', 'kr2', 'kr3', 'kr4'].map(R)));
  ok('⑪ 受けない鍵（table_edit の players・rule_set_id・session_edit の rule_version）→ bad at その鍵', isErr('kr5', 'bad', { at: 'players' }) && isErr('kr6', 'bad', { at: 'rule_set_id' })
    && isErr('kr7', 'bad', { at: 'rule_version' }), J(['kr5', 'kr6', 'kr7'].map(R)));
  ok('⑪ table_edit：label は5字だけ btrim', isOk('kt1') && out.kt1_t?.label === '卓2' && out.kt1_t?.ch === false, J([R('kt1'), out.kt1_t]));
  ok('⑪ table_edit：num で rate が無く今も null → bad at rate', isErr('kt2', 'bad', { at: 'rate' }), J(R('kt2')));
  ok('⑪ table_edit：num・50 → ok・卓の印・半荘には付けない', isOk('kt3') && out.kt3_t?.mode === 'num' && out.kt3_t?.rate === 50 && out.kt3_t?.ch === true && out.kt3_h?.ch === false, J([R('kt3'), out.kt3_t, out.kt3_h]));
  ok('⑪ table_edit：mode が num のまま rate だけ → ok', isOk('kt4'), J(R('kt4')));
  ok('⑪ table_edit：none に rate 50 → bad at rate・none だけ → ok で rate は null', isErr('kt5', 'bad', { at: 'rate' }) && isOk('kt6') && out.kt6_t?.rate === null && out.kt6_t?.mode === 'none', J([R('kt5'), R('kt6'), out.kt6_t]));
  ok('⑪ table_edit：rate_mode x → bad・num で rate null → bad at rate', isErr('kt7', 'bad', { at: 'rate_mode' }) && isErr('kt8', 'bad', { at: 'rate' }), J([R('kt7'), R('kt8')]));
  ok('⑪ table_edit：そろっていない卓のレート → 印なし', isOk('kt9') && out.kt9_t?.ch === false, J([R('kt9'), out.kt9_t]));
  ok('⑪ table_edit の取り消し：半荘に印・f0 の無い卓には付けない・取り消した卓の label も直せる', isOk('ktv') && out.ktv_h?.ch === true && out.ktv_t?.ch === false && out.ktv_t?.voided === true && isOk('ktw'), J([R('ktv'), out.ktv_h, out.ktv_t, R('ktw')]));
  ok('⑪ hanchan_seats：並べ替え → ok・seats_version 2・version は上げない・顔ぶれ同じ＝東の並びは残る・印', isOk('ks1') && v1('ks1', 2) && out.ks1_h?.sv === 2 && out.ks1_h?.v === 1
    && J(out.ks1_h?.ton) === J(TON4) && out.ks1_h?.ov === 1 && out.ks1_h?.ch === true, J([R('ks1'), out.ks1_h]));
  ok('⑪ hanchan_seats：同じ → ok・書かない（v2）', isOk('ks2') && v1('ks2', 2) && has('ks2', { hc: 0, h: 0 }), J([R('ks2'), d('ks2')]));
  ok('⑪ hanchan_seats：顔ぶれが変わる → ton_order null・order_version+1・履歴2行', isOk('ks3') && out.ks3_h?.ton === null && out.ks3_h?.ov === 2 && out.ks3_h?.sv === 3 && has('ks3', { hc: 2, h: 2 }), J([R('ks3'), out.ks3_h, d('ks3')]));
  ok('⑪ hanchan_seats：inactive でも今の席にいる人は ok・席にいない inactive は bad', isOk('ks4') && isErr('ks5', 'bad', { at: 'seats' }), J([R('ks4'), R('ks5')]));
  ok('⑪ hanchan_seats：長さ・重なり・よその部屋の人 → bad at seats', ['ks6', 'ks7', 'ks8'].every((k) => isErr(k, 'bad', { at: 'seats' })), J(['ks6', 'ks7', 'ks8'].map(R)));
  ok('⑪ hanchan_seats：取り消した半荘 → bad at hanchan_id（i 1）', isErr('ks9', 'bad', { at: 'hanchan_id', i: 1 }), J(R('ks9')));
  ok('⑪ extra_set：行が無く bv 0 → 作る（v1）', isOk('kx1') && v1('kx1', 1) && has('kx1', { rc: 1, hc: 1, x: 3 }), J([R('kx1'), d('kx1')]));
  ok('⑪ extra_set：同じ値 → bv が違っても ok（v1）', isOk('kx2') && v1('kx2', 1) && has('kx2', { hc: 0, h: 0 }), J([R('kx2'), d('kx2')]));
  ok('⑪ extra_set：版が古い → conflict（at に卓・人・種・extra・cur に値と版）', isErr('kx3', 'conflict', { i: 0 }) && JS(R('kx3').cur) === JS({ value: 3, version: 1 })
    && JS(R('kx3').at) === JS({ table_id: KX[0], member_id: MA[0], kind: 'chip', what: 'extra' }), J(R('kx3')));
  ok('⑪ extra_set：版が合う → ok（v2）', isOk('kx4') && v1('kx4', 2), J(R('kx4')));
  ok('⑪ extra_set：行が無く 0 → 書かずに ok（v0）', isOk('kx5') && v1('kx5', 0) && has('kx5', { rc: 0, hc: 0, h: 0, x: 0 }), J([R('kx5'), d('kx5')]));
  ok('⑪ extra_set：行が無く bv 1 → conflict cur {0, 0}', isErr('kx6', 'conflict') && JS(R('kx6').cur) === JS({ value: 0, version: 0 }), J(R('kx6')));
  ok('⑪ extra_set：行が無く value 0・bv 1 → conflict cur {0, 0}（0 の ok より先）', isErr('kxg', 'conflict') && JS(R('kxg').cur) === JS({ value: 0, version: 0 }), J(R('kxg')));
  ok('⑪ 正味の門：1組［hanchan_seats A′→A・extra_set A′→0・A→+3］→ ok・戻しの組も ok', isOk('kz1') && isOk('kz2') && isOk('kz3')
    && J(out.kz2_v?.[MA[3]]) === J([0, 2]) && J(out.kz2_v?.[MA[4]]) === J([3, 1]) && J(out.kz3_v?.[MA[3]]) === J([3, 3]) && J(out.kz3_v?.[MA[4]]) === J([0, 2]),
    J([R('kz1'), R('kz2'), out.kz2_v, R('kz3'), out.kz3_v]));
  ok('⑪ extra_set：使わない種 → bad at kind・1000 → range at value', isErr('kx7', 'bad', { at: 'kind' }) && isErr('kx8', 'range', { at: 'value' }), J([R('kx7'), R('kx8')]));
  ok('⑪ extra_set：席にいない人に 0 から離れる値 → bad at member_id（正味の門）', isErr('kx9', 'bad', { at: 'member_id' }), J(R('kx9')));
  ok('⑪ extra_set：そろう（A 5・B −5）→ 印なし・そろった後に変える → 卓の印', isOk('kxa') && out.kxa_t?.fc === true && out.kxa_t?.ch === false && isOk('kxb') && out.kxb_t?.ch === true && out.kxb_t?.e === 'ng',
    J([R('kxa'), out.kxa_t, R('kxb'), out.kxb_t]));
  ok('⑪ extra_set：行の値と版', J(out.kx_v?.[MA[0]]) === J([5, 2]) && J(out.kx_v?.[MA[1]]) === J([-4, 2]), J(out.kx_v));
  ok('⑪ extra_set：席から外れた人は 0 へ近づく時だけ（−2 → −3 bad・−2 → −1 ok）', isOk('kxc') && out.kxc_t?.e === 'ok' && isOk('kxd') && isErr('kxe', 'bad', { at: 'member_id' }) && isOk('kxf'),
    J([R('kxc'), out.kxc_t, R('kxd'), R('kxe'), R('kxf')]));
  /* ⑧ */
  const busyD = { ...none, ur: 1, u: 1, rn1m: 0, all1m: 0, un: 0, ud: 0, all1d: 0 };
  ok('⑧ 先見の busy（ur1m 120）→ busy・何も書かない・ur1m は +1・rn1m・all1m・un1d・u1d は 0', isErr('b1', 'busy', { what: 'write:ur1m' }) && has('b1', busyD), J([R('b1'), d('b1')]));
  ok('⑧ 後見の busy（un1d 1499＋2行）→ busy・何も書かない・ur1m +1・rn1m・all1m・un1d・u1d 0', isErr('b2', 'busy', { what: 'write:un1d' }) && has('b2', busyD), J([R('b2'), d('b2')]));
  ok('⑧ 入A の un1d が満ちても同じ部屋の入B と管は書ける（P6＝垢を足して他の人を止められない）', isErr('b3n', 'busy', { what: 'write:un1d' }) && isOk('b3b') && has('b3b', { un: 1, ud: 1 }) && isOk('b3k'), J([R('b3n'), R('b3b'), d('b3b'), R('b3k')]));
  ok('⑧ 人の u1d 2999＋2行 → busy write:u1d・何も書かない／別の人は書ける', isErr('b5n', 'busy', { what: 'write:u1d' }) && has('b5n', busyD) && isOk('b5b'), J([R('b5n'), d('b5n'), R('b5b')]));
  ok('⑧ 管も u1d で止まる', isErr('b5k', 'busy', { what: 'write:u1d' }), J([R('b5k')]));
  ok('⑧ 前の版の rn1d 3000 が在っても入は書ける（読まない）', isOk('b6') && has('b6', { un: 1, rn: 0 }), J([R('b6'), d('b6')]));
  ok('⑧ 管の rk1d が満ちても入は書ける', isErr('b4k', 'busy', { what: 'write:rk1d' }) && isOk('b4n'), J([R('b4k'), R('b4n')]));
  ok('⑧ 古い窓は書いた時に消える（25時間前の un1d 1500・u1d 3000 は数えない）', isOk('bo') && Number(out.bo_left) === 0, J([R('bo'), out.bo_left, out.bo_err]));
  ok('⑧ 同値だけの組 → ok・op_results 0・人の分は +1・分け合う分と1日は 0', isOk('sv') && has('sv', { ...none, ur: 1, rn1m: 0, all1m: 0, un: 0, ud: 0 }), J(d('sv')));
  ok('⑧ 入の1行 → ur・u・rn1m・all1m・un1d・u1d・all1d に +1・uk・rk 0', isOk('okn') && has('okn', { ur: 1, u: 1, rn1m: 1, all1m: 1, un: 1, ud: 1, all1d: 1, uk: 0, rk: 0, rn: 0, op: 1 }), J(d('okn')));
  ok('⑧ 管の1行 → uk・rk・u1d に +1・rn1m・un1d 0', isOk('okk') && has('okk', { ur: 1, u: 1, rn1m: 0, un: 0, ud: 1, uk: 1, rk: 1, all1d: 1 }), J(d('okk')));
  ok('⑧ 持ち主の1行 → 管と同じ（uk・rk）', isOk('oko') && has('oko', { un: 0, ud: 1, uk: 1, rk: 1 }), J(d('oko')));
  ok('⑧ 例外（P0001）→ internal・何も書かない・ur1m +1', isErr('ie_P0001', 'internal') && has('ie_P0001', busyD), J([R('ie_P0001'), d('ie_P0001'), out.ie_err]));
  ['55P03', '40P01', '40001'].forEach((c) => ok(`⑧ 一時の失敗（${c}）→ busy lock・何も書かない・ur1m +1・分け合う分と1日 0`, isErr('ie_' + c, 'busy', { what: 'lock' }) && has('ie_' + c, busyD), J([R('ie_' + c), d('ie_' + c)])));
  /* ⑧' */
  ok("⑧' members が上限 → full members・何も書かない", isErr('fm', 'full', { what: 'members' }) && has('fm', busyD), J([R('fm'), d('fm'), out.fm_err]));
  ok("⑧' H1' tables：開催日に10卓ある所へ11卓目 → ok（full にならない）", isOk('ft') && Number(out.ft_n) >= 11, J([R('ft'), out.ft_n, out.ft_err]));
  ok("⑧' H1' hanchans：卓に60半荘ある所へ61本目 → ok", isOk('fh') && Number(out.fh_n) >= 61, J([R('fh'), out.fh_n, out.fh_err]));
  ok("⑧' H1' sessions：部屋に3000日ある所へ3001日目 → ok", isOk('fs') && Number(out.fs_n) >= 3001, J([R('fs'), out.fs_n, out.fs_err]));
  ok("⑧' H1' P：部屋の行 30000 の所へ書く → ok・数えは増える", isOk('fp') && Number(out.fp_n) > 30000, J([R('fp'), out.fp_n, out.fp_err]));
  ok("⑧' mj_caps の行が無い → full", isErr('fn', 'full', { what: 'members' }), J([R('fn'), out.fn_err]));
  ok("⑧' op_results が上限を越えると古い物が消える（full にならない）", isOk('fo1') && isOk('fo2') && Number(out.fo2_c1?.op) === 1, J([R('fo2'), out.fo2_c1, out.fo_err]));
  ok("⑧' op_results は at の古い物から消す（op_id の順でない）・今の組は残る", ['fq1', 'fq2', 'fq3'].every(isOk) && J(out.fq_left) === J([OPQ1, OPQ3].sort()), J([out.fq_left, out.fq_err]));
  ok("⑧' H1' history：history_count 10000 の所へ書く → ok・数えは増える（F の門もたたみも無い）", isOk('fhi') && Number(out.fhi_n) > 10000, J([R('fhi'), out.fhi_n, out.fhi_err]));
  /* ⑨ */
  ok('⑨ 同じ人の同じ op_id 2回 → 同じ答え・extra は1回だけ足す', isOk('rs1') && J(R('rs2')) === J(R('rs1')) && Number(out.rs1_x) === 1 && Number(out.rs2_x) === 1 && has('rs2', { ...none, ur: 1, rn: 0 }),
    J([R('rs1'), R('rs2'), out.rs1_x, out.rs2_x, d('rs2')]));
  ok('⑨ 消した部屋 → gone・u1m だけ +1', isErr('dl', 'gone') && has('dl', { ...none, ur: 0, u: 1, rn: 0 }), J([R('dl'), d('dl'), out.dl_err]));
  ok('⑨ 入っていない人 → gone', isErr('nm', 'gone') && has('nm', { ...none, ur: 0, u: 1 }), J([R('nm'), d('nm')]));
  ok('⑨ 出す前の人は書ける・出した人 → gone', isOk('bn0') && isErr('bn', 'gone'), J([R('bn0'), R('bn'), out.bn_err]));
  ok('⑨ 持ち主は room_accounts の行が無くても書ける', isOk('ow'), J([R('ow'), out.ow_err]));
  ok('⑨ 無い部屋 → gone', isErr('nr', 'gone'), J(R('nr')));
  ok('⑨ last_seen：2時間前の行は now() に上がる', isOk('ls1') && out.ls1_v === true, J([R('ls1'), out.ls1_v]));
  ok('⑨ last_seen：5分前の行は動かない', isOk('ls2') && out.ls2_v === true, J([R('ls2'), out.ls2_v]));
  /* ⑭ 2c-2b 人の op 5つ */
  const ui = (x) => (x ? u.indexOf(x) + 1 : null);
  const st = (k) => { const o = out[k] || {}; return { lu: (o.lu || []).map(ui), ra: Object.fromEntries(Object.entries(o.ra || {}).map(([a, b]) => [ui(a), b])),
    bans: (o.bans || []).map(ui).sort((a, b) => a - b), cl: (o.cl || []).map(([m, x]) => [L.indexOf(m), ui(x)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]) }; };
  const r0 = (k) => JS((R(k).results || [])[0]);
  ok('⑭ 用意（各節の頭で名簿 L0〜L9）→ ok', ['qr0', 'qa0', 'ql0', 'qu0', 'qe0', 'qs0', 'qx0'].every(isOk), J(['qr0', 'qa0', 'ql0', 'qu0', 'qe0', 'qs0', 'qx0'].map(R)));
  ok('⑭ 役：入の member_relink・account_remove → mj_role need kan・何も書かない', isErr('qr1', 'mj_role', { i: 0, need: 'kan' }) && isErr('qr2', 'mj_role', { i: 0, need: 'kan' }) && has('qr1', rejNyu) && has('qr2', rejNyu),
    J([R('qr1'), R('qr2'), d('qr1'), d('qr2')]));
  ok('⑭ 役：管の role_set → mj_role need owner・何も書かない', isErr('qr3', 'mj_role', { i: 0, need: 'owner' }) && has('qr3', none), J([R('qr3'), d('qr3')]));
  ok('⑭ 役：組の2つ目で足りない → mj_role i 1・1つ目も書かない', isErr('qr4', 'mj_role', { i: 1, need: 'kan' }) && has('qr4', none), J([R('qr4'), d('qr4')]));
  ok('⑭ 入り直し：持ち主 OLD で role_set kan → mj_reauth within_min 10・役は nyu のまま', isErr('qa1', 'mj_reauth', { within_min: 10, i: 0 }) && st('qa1_s').ra[2] === 'nyu' && has('qa1', none), J([R('qa1'), st('qa1_s').ra]));
  ok('⑭ 入り直し：amr 無し・空・字の timestamp・字の amr → mj_reauth', ['qa2', 'qa3', 'qa4', 'qa5'].every((k) => isErr(k, 'mj_reauth', { within_min: 10, i: 0 })), J(['qa2', 'qa3', 'qa4', 'qa5'].map(R)));
  ok('⑭ 入り直し：FRESH（古い otp と新しい password＝max を見る）→ ok・kan に・履歴1', isOk('qa6') && st('qa6_s').ra[2] === 'kan' && has('qa6', { hc: 1, h: 1 }), J([R('qa6'), st('qa6_s').ra, d('qa6')]));
  ok('⑭ 入り直し：amr 無しで nyu へ下げる → ok', isOk('qa7') && st('qa7_s').ra[2] === 'nyu', J([R('qa7'), st('qa7_s').ra]));
  ok('⑭ link：空きへ → ok v2・履歴1', isOk('ql1') && r0('ql1') === JS({ i: 0, v: 2 }) && has('ql1', { hc: 1, h: 1 }), J([R('ql1'), d('ql1')]));
  ok('⑭ link：二度 → ok・書かない', isOk('ql2') && r0('ql2') === JS({ i: 0, v: 2 }) && has('ql2', { hc: 0, h: 0 }), J([R('ql2'), d('ql2')]));
  ok('⑭ link：別の人にもう一人 → linked member_id', isErr('ql3', 'linked', { i: 0, member_id: L[0] }), J(R('ql3')));
  ok('⑭ link：他人の人 → ok claimed（v そのまま・名乗り1行・hc 0）・二度目も1行', isOk('ql4') && r0('ql4') === JS({ i: 0, v: 1, claimed: true }) && has('ql4', { hc: 0, h: 0, rc: 0 })
    && isOk('ql5') && has('ql5', { hc: 0, h: 0 }) && J(st('ql5_s').cl) === J([[2, 3]]) && st('ql5_s').lu[2] === 8, J([R('ql4'), R('ql5'), d('ql4'), st('ql5_s')]));
  ok('⑭ link：[unlink L0, link L1] で移れて L0 の名乗りが消える', isOk('ql6') && st('ql6_s').lu[0] === null && st('ql6_s').lu[1] === 2 && !st('ql6_s').cl.some((c) => c[0] === 0) && has('ql6', { hc: 2 }),
    J([R('ql6'), st('ql6_s'), d('ql6')]));
  ok('⑭ link：名乗った人が空きへつながると、その人の名乗りが全部消える（N3）', isOk('ql7') && st('ql7_s').lu[3] === 3 && !st('ql7_s').cl.some((c) => c[1] === 3), J([R('ql7'), st('ql7_s')]));
  ok('⑭ link：1人4つ目 → full member_claims_user', ['ql8', 'ql9', 'ql10'].every((k) => isOk(k) && R(k).results?.[0]?.claimed === true) && isErr('ql11', 'full', { what: 'member_claims_user' }),
    J(['ql8', 'ql9', 'ql10', 'ql11'].map(R)));
  ok('⑭ link：部屋の cap → full member_claims', isErr('ql12', 'full', { what: 'member_claims' }), J([R('ql12'), out.qlc_err]));
  ok('⑭ link：使わない印の人・よその部屋の人 → bad member_id', isErr('ql13', 'bad', { at: 'member_id' }) && isErr('ql14', 'bad', { at: 'member_id' }), J([R('ql13'), R('ql14')]));
  ok('⑭ unlink：本人 → ok・履歴1', isOk('qu1') && st('qu_s').lu[0] === null && has('qu1', { hc: 1, h: 1 }), J([R('qu1'), d('qu1')]));
  ok('⑭ unlink：管が他人の → ok', isOk('qu2') && st('qu_s').lu[1] === null, J(R('qu2')));
  ok('⑭ unlink：入が他人の → mj_role need kan・外れない', isErr('qu3', 'mj_role', { i: 0, need: 'kan' }) && st('qu_s').lu[2] === 9, J([R('qu3'), st('qu_s')]));
  ok('⑭ unlink：空 → ok・書かない', isOk('qu4') && has('qu4', { hc: 0, h: 0 }), J([R('qu4'), d('qu4')]));
  ok('⑭ relink：付け替えで前の人が空く（hist 2）', isOk('qe1') && has('qe1', { hc: 2, h: 2 }) && st('qe1_s').lu[0] === null && st('qe1_s').lu[1] === 2, J([R('qe1'), d('qe1'), st('qe1_s')]));
  ok('⑭ relink：部屋に居ない人 → bad user_id', isErr('qe2', 'bad', { at: 'user_id' }), J(R('qe2')));
  ok('⑭ relink：出した人 → bad user_id', isErr('qe3', 'bad', { at: 'user_id' }), J(R('qe3')));
  ok('⑭ relink：持ち主（room_accounts の行が無くても）→ ok', isOk('qe4') && st('qe4_s').lu[3] === 1, J([R('qe4'), out.qeo_err]));
  ok('⑭ role_set：管5（持ち主＋us3＋xu1〜3）まで通る・xu4 で full admins', ['qs1', 'qs2', 'qs3'].every(isOk) && isErr('qs4', 'full', { what: 'admins' })
    && [8, 9, 10].every((i) => st('qs_s').ra[i] === 'kan') && st('qs_s').ra[11] === 'nyu', J([...['qs1', 'qs2', 'qs3', 'qs4'].map(R), st('qs_s').ra]));
  ok('⑭ role_set：同じ役 → ok・書かない', isOk('qs5') && has('qs5', { hc: 0, h: 0 }), J([R('qs5'), d('qs5')]));
  ok('⑭ role_set：持ち主へ・出した人 → bad user_id', isErr('qs6', 'bad', { at: 'user_id' }) && isErr('qs7', 'bad', { at: 'user_id' }), J([R('qs6'), R('qs7')]));
  ok("⑭ role_set：role 'boss' → bad at role", isErr('qs8', 'bad', { at: 'role' }), J(R('qs8')));
  { const s = st('qx1_s');
    ok('⑭ account_remove：管が入を出す → ok（印1・行0・つながり外れ・名乗り0・hc 3）', isOk('qx1') && has('qx1', { hc: 3, h: 3 }) && J(s.bans) === J([5]) && !(5 in s.ra) && s.lu[4] === null && s.lu[0] === 8
      && !s.cl.some((c) => c[1] === 5 || c[0] === 4), J([R('qx1'), d('qx1'), s])); }
  ok('⑭ account_remove：出した人の mj_write → gone・mj_room_join → removed', isErr('qx2', 'gone') && out.qx3?.err === 'removed', J([R('qx2'), out.qx3]));
  ok('⑭ account_remove：二度目 → ok・書かない', isOk('qx4') && has('qx4', { hc: 0, h: 0 }), J([R('qx4'), d('qx4')]));
  ok('⑭ account_remove：持ち主 → bad reason owner・管 → reason kan', isErr('qx5', 'bad', { at: 'user_id', reason: 'owner' }) && isErr('qx6', 'bad', { at: 'user_id', reason: 'kan' }), J([R('qx5'), R('qx6')]));
  ok('⑭ account_remove：リーグの持ち主（取り消した行でも）→ reason league', isErr('qx7', 'bad', { at: 'user_id', reason: 'league' }), J([R('qx7'), out.qxl_err]));
  ok('⑭ account_remove：行も印も無い → bad user_id', isErr('qx8', 'bad', { at: 'user_id' }), J(R('qx8')));
  ok('⑭ account_remove：room_bans の cap → full room_bans', isErr('qx9', 'full', { what: 'room_bans' }), J([R('qx9'), out.qxc_err]));
  /* ⑮ 2c-2c 部屋の op 4つ */
  const s15 = (k) => { const o = out[k] || {}; return { ...st(k), own: ui(o.own), del: o.del, ch: o.ch, url: o.url, lg: (o.lg || []).map(ui) }; };
  const raK = (x) => Object.keys(x.ra).map(Number).sort((a, b) => a - b);
  ok('⑮ room_leave：入が抜ける → ok・行が消え・名簿のつなぎは残り（C2-1 §1a）・自分の名乗りが消え・自分が L のリーグ（取り消した物も）は持ち主へ・履歴2・抜けた印1（left_hist_id＝抜ける前の最大 id）', isOk('zrl1') && has('zrl1', { hc: 2, h: 2, rc: 0 })
    && !raK(s15('zrl1_s')).includes(2) && s15('zrl1_s').lu[0] === 2 && J(s15('zrl1_s').cl) === '[]' && J(s15('zrl1_s').lg) === '[1,1]' && out.zrl1_lv?.n === 1 && out.zrl1_lv?.hid === true, J([R('zrl1'), d('zrl1'), s15('zrl1_s'), out.zrl1_lv]));
  ok('⑮ room_leave：送り直し・抜けた後の書き込み → gone（S5）', isErr('zrl2', 'gone') && isErr('zrl3', 'gone'), J([R('zrl2'), R('zrl3')]));
  ok('⑮ room_leave：持ち主は amr が古いと mj_reauth', isErr('zrl4', 'mj_reauth', { within_min: 10 }) && has('zrl4', { hc: 0 }), J(R('zrl4')));
  ok('⑮ 組に1つだけ：部屋の op を他の op と混ぜる → bad at op・何も書かない', isErr('zrl5', 'bad', { i: 0, at: 'op' }) && isErr('zrl5b', 'bad', { i: 1, at: 'op' }) && has('zrl5', { hc: 0, m: 0 }) && has('zrl5b', { hc: 0, m: 0 }), J([R('zrl5'), R('zrl5b')]));
  ok('⑮ room_leave：持ち主が抜ける → 一番古い管が継ぐ・持ち主のリーグも継ぐ人へ・履歴3', isOk('zrl6') && has('zrl6', { hc: 3, h: 3 }) && s15('zrl6_s').own === 3
    && !raK(s15('zrl6_s')).includes(1) && s15('zrl6_s').ra[3] === 'kan' && J(s15('zrl6_s').lg) === '[3,3]', J([R('zrl6'), d('zrl6'), s15('zrl6_s')]));
  ok('⑮ room_leave：管が居ない → 一番古い入が継いで kan になる', isOk('zrk1') && s15('zrk1_s').own === 8 && s15('zrk1_s').ra[8] === 'kan' && has('zrk1', { hc: 3 }), J([R('zrk1'), d('zrk1'), s15('zrk1_s')]));
  ok('⑮ room_leave：ほかに誰も居ない持ち主 → bad reason alone・何も書かない', isErr('zrk2', 'bad', { at: 'op', reason: 'alone' }) && has('zrk2', { hc: 0 }), J(R('zrk2')));
  ok('⑮ room_delete：入・管 → mj_role need owner・持ち主の amr が古い → mj_reauth', isErr('zrd1', 'mj_role', { need: 'owner' }) && isErr('zrd2', 'mj_role', { need: 'owner' }) && isErr('zrd3', 'mj_reauth'), J([R('zrd1'), R('zrd2'), R('zrd3')]));
  ok('⑮ room_delete：持ち主 → ok・消した印・履歴1', isOk('zrd4') && has('zrd4', { hc: 1 }) && s15('zrd4_s').del === true, J([R('zrd4'), s15('zrd4_s')]));
  ok('⑮ room_delete の後：送り直し・書き込み・入る → gone', isErr('zrd5', 'gone') && isErr('zrd6', 'gone') && R('zrd7').err === 'gone', J([R('zrd5'), R('zrd6'), out.zrd7]));
  ok('⑮ room_undelete：入 → mj_role need kan・管 → ok（入り直し不要）・戻る・二度目は書かない', isErr('zrd8', 'mj_role', { need: 'kan' }) && isOk('zrd9') && has('zrd9', { hc: 1 })
    && s15('zrd9_s').del === false && isOk('zrd10') && has('zrd10', { hc: 0 }), J([R('zrd8'), R('zrd9'), R('zrd10'), s15('zrd9_s')]));
  ok('⑮ room_undelete：7日より前に消した部屋 → gone', isErr('zrd11', 'gone'), J(R('zrd11')));
  ok('⑮ room_secret：入 → mj_role need kan・管の amr が古い → mj_reauth', isErr('zsc1', 'mj_role', { need: 'kan' }) && isErr('zsc2', 'mj_reauth'), J([R('zsc1'), R('zsc2')]));
  ok('⑮ room_secret：形が悪い（短いパス・URL の字・URL が無い）→ bad', isErr('zsc3', 'bad', { at: 'pass' }) && isErr('zsc4', 'bad', { at: 'url_token_hash' }) && isErr('zsc5', 'bad', { at: 'url_token_hash' }), J([R('zsc3'), R('zsc4'), R('zsc5')]));
  ok('⑮ room_secret：1234 でも通る（B0＝よくあるパスの弾きを外した）→ ok', isOk('zsc15'), J(R('zsc15')));
  ok('⑮ room_secret：前と同じパス（大文字でも）→ bad reason same', isErr('zsc7', 'bad', { at: 'pass', reason: 'same' }) && isErr('zsc7b', 'bad', { at: 'pass', reason: 'same' }), J([R('zsc7'), R('zsc7b')]));
  ok('⑮ room_secret：今と同じ URL → bad reason same', isErr('zsc8', 'bad', { at: 'url_token_hash', reason: 'same' }), J(R('zsc8')));
  ok('⑮ room_secret：他の部屋の URL → bad at url_token_hash・弾いた組は何も書かない', isErr('zsc9', 'bad', { at: 'url_token_hash' }) && R('zsc9').reason === undefined
    && ['zsc3', 'zsc4', 'zsc5', 'zsc7', 'zsc7b', 'zsc8', 'zsc9'].every((k) => has(k, { hc: 0, h: 0 })), J(R('zsc9')));
  ok('⑮ room_secret：組に1つだけ → bad i 1 at op', isErr('zsc10', 'bad', { i: 1, at: 'op' }), J(R('zsc10')));
  const k11 = R('zsc11').results?.[0]?.channel_key;
  ok('⑮ room_secret：管が押す → ok・新しい channel_key・入の行が消え（L と管は残る）・消した入のつなぎと名乗りが消え・出した印0・履歴2', isOk('zsc11') && /^[0-9a-f]{32}$/.test(k11 || '')
    && k11 === s15('zsc11_s').ch && k11 !== s15('zsc0_s').ch && s15('zsc11_s').url === H1 && J(raK(s15('zsc11_s'))) === '[1,3,9]' && s15('zsc11_s').ra[9] === 'nyu'
    && s15('zsc11_s').lu[0] === null && s15('zsc11_s').lu[1] === null && J(s15('zsc11_s').cl) === '[[3,3]]' && J(s15('zsc11_s').bans) === '[]' && has('zsc11', { hc: 2, h: 2, rc: 0 }),
    J([R('zsc11'), d('zsc11'), s15('zsc11_s')]));
  ok('⑮ room_secret：履歴に pass・hash・channel_key が無い', Array.isArray(out.zsc11_h) && out.zsc11_h.length === 2 && !J(out.zsc11_h).includes(k11) && !J(out.zsc11_h).includes(H1)
    && !J(out.zsc11_h).includes(PASS2) && !J(out.zsc11_h).includes('$2'), J(out.zsc11_h));
  ok('⑮ room_secret：送り直しの答えに channel_key を書かない（op_results）', out.zsc11_o && out.zsc11_o.ok === true && !J(out.zsc11_o).includes('channel_key') && !J(out.zsc11_o).includes(k11), J(out.zsc11_o));
  ok('⑮ room_secret：送り直し → 今の channel_key を読み直して返す（S2）', isOk('zsc12') && R('zsc12').results?.[0]?.channel_key === k11 && has('zsc12', { hc: 0 }), J(R('zsc12')));
  ok('⑮ room_secret：前のパスで入る → wrong', out.zsc13?.err === 'wrong', J(out.zsc13));
  ok('⑮ room_secret：出した人も新しいパスで入れる（印を全部消す）', out.zsc14?.ok === true, J(out.zsc14));
  ok('⑮ K-3 段1：持ち主のアカウントが消えた → 入の呼びで一番古い管が継ぐ（入の方が古くても管が先）・リーグも・その呼びは ok', isOk('zk31') && s15('zk31_s').own === 8 && J(s15('zk31_s').lg) === '[8]'
    && J(out.zk31_h) === J([['rooms', 'owner_user_id'], ['leagues', 'owner_user_id']]) && has('zk31', { hc: 3, h: 3 }), J([R('zk31'), d('zk31'), s15('zk31_s'), out.zk31_h]));
  ok('⑮ K-3 段1：継いだ本人はその呼びから持ち主（room_delete が通る）', isOk('zk3b1') && s15('zk3b1_s').own === 3 && s15('zk3b1_s').del === true, J([R('zk3b1'), s15('zk3b1_s')]));
  /* ⑯ 2c-2d1 リーグの op 3つ */
  const g = (k) => out[k] || {};
  ok("⑯ league_create：入 → mj_role need kan（③' の門＝who_league same）", isErr('g1a', 'mj_role', { need: 'kan', i: 0 }) && has('g1a', none), J([R('g1a'), d('g1a')]));
  ok('⑯ league_create：管は通る・L と作った人は自分・版1・alt も版1・行3（リーグ1＋版2）・履歴1', isOk('g1b') && has('g1b', { rc: 3, hc: 1, h: 1 })
    && g('g1b_r').own === u[0] && g('g1b_r').by === u[0] && g('g1b_r').rv === 1 && g('g1b_r').rva === 1 && g('g1b_r').alt === true, J([R('g1b'), d('g1b'), g('g1b_r')]));
  ok('⑯ league_save：L でない管 → mj_role need L（何も書かない）', isErr('g1c', 'mj_role', { need: 'L', i: 0 }) && has('g1c', none), J([R('g1c'), d('g1c')]));
  ok('⑯ league_save：L は通る・版2・履歴1', isOk('g1d') && R('g1d').results?.[0]?.v === 2 && has('g1d', { hc: 1, rc: 0 }), J([R('g1d'), d('g1d')]));
  ok('⑯ league_save でルールを替えた後：新しい開催日は新しい版（リーグの主・rooms の版でない）・前の開催日は前の版・卓は開催日の版', isOk('g1s1') && isOk('g1e') && isOk('g1s2')
    && g('g1e_r').rv === 2 && g('g1v1').lg === true && g('g1v1').room === false && g('g1v1').rv === 1 && g('g1v2').lg === true && g('g1v2').rv === 2 && out.g1vt === 2
    && has('g1e', { rc: 1, hc: 1 }), J([R('g1s1'), R('g1e'), d('g1e'), R('g1s2'), g('g1e_r'), g('g1v1'), g('g1v2'), out.g1vt]));
  ok('⑯ 同じ組の session_add(league_id)→table_add：L でない管 → mj_role need L i 0・何も書かない', isErr('g1f', 'mj_role', { need: 'L', i: 0 }) && has('g1f', none), J([R('g1f'), d('g1f')]));
  ok('⑯ 同じ組の session_add(league_id)→table_add：L の入は通る・L でない入 → mj_role need L i 0', isOk('g1g') && has('g1g', { rc: 2, hc: 2 }) && isErr('g1g2', 'mj_role', { need: 'L', i: 0 }) && has('g1g2', none),
    J([R('g1g'), d('g1g'), R('g1g2'), d('g1g2')]));
  ok('⑯ league_create：rules の players が players_main と違う → bad at rules・alt が同じ players → bad at rules_alt', isErr('g1h', 'bad', { at: 'rules' }) && isErr('g1i', 'bad', { at: 'rules_alt' })
    && has('g1h', { rc: 0, hc: 0 }) && has('g1i', { rc: 0, hc: 0 }), J([R('g1h'), R('g1i')]));
  ok('⑯ league_save：players_main は替えられない（bad at players_main）・rules の players 違い → bad at rules', isErr('g1j', 'bad', { at: 'players_main' }) && isErr('g1k', 'bad', { at: 'rules' }), J([R('g1j'), R('g1k')]));
  ok('⑯ league_save：rules_alt null → alt を外す（rule_sets の行は残す）・同じ rules をもう一度 → 版を足さない', isOk('g1n') && g('g1n_r').alt === false && g('g1n_r').rva === null && has('g1n', { rc: 0, hc: 1 })
    && isOk('g1n2') && has('g1n2', { rc: 0 }) && g('g1n_r').rv === 2, J([R('g1n'), d('g1n'), g('g1n_r'), out.g1n_rs, R('g1n2'), d('g1n2')]));
  ok('⑯ 取り消したリーグ：session_add → bad at league_id・league_save → bad at league', isErr('g1l', 'bad', { at: 'league_id' }) && isErr('g1m', 'bad', { at: 'league' }), J([R('g1l'), R('g1m')]));
  ok("⑯ H1' leagues：50本の部屋で league_create → ok（51本目・full にならない）", isOk('g2a') && Number(out.g2a_n) >= 51, J([R('g2a'), out.g2a_n, out.g2_err]));
  ok("⑯ H1' rule_sets：500 の部屋で作って 501・もう1本・league_save で版を足す → 全部 ok・名だけの save も ok", isOk('g3a') && Number(out.g3a_n) === 501
    && isOk('g3b') && isOk('g3c') && isOk('g3d'), J([R('g3a'), out.g3a_n, R('g3b'), R('g3c'), R('g3d'), out.g3_err]));
  ok('⑯ 人ごと24時間5本：2部屋で5本は通る・6本目 → too_many what league_create・別の人は通る・25時間前の1本は数えない', ['g4a', 'g4b', 'g4c', 'g4d', 'g4e'].every(isOk)
    && isErr('g4f', 'too_many', { what: 'league_create' }) && has('g4f', { rc: 0, hc: 0 }) && isOk('g4g') && isOk('g4h'), J(['g4a', 'g4b', 'g4c', 'g4d', 'g4e', 'g4f', 'g4g', 'g4h'].map(R).concat([out.g4_err])));
  ok('⑯ 消えた L：部屋に居る人の呼びで持ち主へ継ぐ（取り消したリーグも）・版+1・履歴は1リーグ1行で同じ group_id・数えに足す・居る L は変えない・2回目は継がない', isOk('g5a')
    && g('g5a_e').own === u[0] && g('g5a_e').v === 2 && g('g5a_f').own === u[0] && g('g5a_h').own === u[2] && g('g5a_h').v === 1
    && g('g5a_h2').n === 2 && g('g5a_h2').g === 1 && g('g5a_h2').same === true && g('g5a_h2').col === 'owner_user_id' && has('g5a', { hc: 3, h: 3 })
    && isOk('g5b') && has('g5b', { hc: 1 }), J([R('g5a'), d('g5a'), g('g5a_e'), g('g5a_f'), g('g5a_h'), g('g5a_h2'), d('g5b'), out.g5_err]));
  ok('⑯ 消えた L：継いだ同じ呼びの league_save（前の版）→ conflict cur 2', isErr('g6a', 'conflict', { cur: { version: 2 } }), J([R('g6a'), out.g6_err]));
  ok('⑯ owner_or_sole_L：出たリーグの L が自分1人の入は rename が通る・L が2人なら mj_role need owner_or_sole_L', isOk('g7a') && isErr('g7b', 'mj_role', { need: 'owner_or_sole_L' }), J([R('g7a'), R('g7b'), out.g7_err]));
  /* ⑯' D2 §4 */
  ok('⑯ D2 alt の卓：ルールは開催日の alt の版・3人／alt 偽は主の版・4人・rate は主の rules の 100', isOk('g8a') && isOk('g8b')
    && g('g8b_s').rate === 100 && g('g8b_s').alt === true && g('g8b_s').same === true && g('g8b_s').main === true
    && J(g('g8b_t1')) === J({ p: 3, sa: true, sm: false }) && J(g('g8b_t2')) === J({ p: 4, sa: false, sm: true }), J([R('g8a'), R('g8b'), g('g8b_s'), g('g8b_t1'), g('g8b_t2'), out.g8_err]));
  ok('⑯ D2 日の途中の league_save で alt を替えても開催日の alt の版は変わらない・後の alt の卓も開催日の版', isOk('g8c') && g('g8c_s').same === false && g('g8c_s').alt === true
    && isOk('g8d') && J(g('g8d_t')) === J({ p: 3, sa: true, sm: false }), J([R('g8c'), g('g8c_s'), R('g8d'), g('g8d_t')]));
  ok('⑯ D2 締めの無い日が在るリーグの2日目 → dup what session（前の日の id）・何も書かない', isErr('g8e', 'dup', { what: 'session', session_id: DS1 }) && has('g8e', none), J([R('g8e'), d('g8e')]));
  ok('⑯ D2 alt 1（bool でない）→ bad at alt', isErr('g8f', 'bad', { at: 'alt' }) && has('g8f', none), J([R('g8f'), d('g8f')]));
  ok('⑯ D2 ふつうの日で alt → bad at alt', isErr('g8g', 'bad', { at: 'alt' }) && has('g8g', none), J([R('g8g'), d('g8g')]));
  ok('⑯ D2 期間の外（後・前）→ bad at date', isOk('g8h0') && isErr('g8h', 'bad', { at: 'date' }) && isErr('g8h2', 'bad', { at: 'date' }) && has('g8h', none), J([R('g8h0'), R('g8h'), R('g8h2')]));
  ok('⑯ D2 主の rules と違う rate → bad at rate・同じ rate は ok', isErr('g8i', 'bad', { at: 'rate' }) && has('g8i', none) && isOk('g8j') && g('g8j_s').rate === 100 && g('g8j_s').alt === false,
    J([R('g8i'), R('g8j'), g('g8j_s')]));
  ok('⑯ D2 主だけのリーグで alt → bad at alt', isErr('g8k', 'bad', { at: 'alt' }) && has('g8k', none), J([R('g8k'), d('g8k')]));
  ok('⑯ D2 卓 11 本目も ok', isOk('g8l') && Number(g('g8l_n')) === 11, J([R('g8l'), out.g8l_n]));
  ok('⑯ D2 1日目を締めた後の2日目は ok・alt の版は今のリーグの版', isOk('g8m') && g('g8m_s').same === true && g('g8m_s').alt === true && J(g('g8m_t')) === J({ p: 3, sa: true, sm: false }),
    J([R('g8m'), g('g8m_s'), g('g8m_t')]));
  /* ⑩ 範囲の端の表（write-cases.json） */
  ok('⑩ 表の版1・case 84以上・rules は表の名だけ', WT.v === 1 && WT_CASES.length >= 84 && WT_CASES.every((c) => c.rules in WT.rules), J(WT_CASES.filter((c) => !(c.rules in WT.rules)).map((c) => c.id + ':' + c.rules)));
  ok('⑩ 表の部屋を作れて base_ops が当たった', WT_RK.every((k) => out['made_' + WT_ROOM[k]]?.ok === true && isOk('tb_' + WT_ROOM[k])), J(WT_RK.map((k) => [out['made_' + WT_ROOM[k]], R('tb_' + WT_ROOM[k])])));
  WT_CASES.forEach((c, i) => {
    const want = c.want_db ?? c.want;
    const r = R('tc' + i);
    const got = r.ok === true ? 'ok' : r.ok === false ? r.err : 'なし';
    ok('⑩ 表：' + c.id, got === want, 'want ' + want + ' got ' + got + ' ' + J(r));
    if (want !== 'ok') ok('⑩ 表：' + c.id + '＝弾いた組は何も書かない', has('tc' + i, { rc: 0, hc: 0, h: 0, op: 0, m: 0, x: 0 }), J(d('tc' + i)));
  });
  /* 全体 */
  const errs = Object.keys(out).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + out[k]).join(' / '));
  const raised = Object.keys(out).filter((k) => out[k] && typeof out[k] === 'object' && 'raised' in out[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + out[k].raised).join(' / '));
  return { p, f };
}

/* ── --waza：1か所ずつ壊して、塊の初めに壊した関数を当ててから同じ試験を回す ──
 * ★数え方（11-20 本番前 taiketsu 注意6）★ 先に壊さない素の回りが全部緑かを見る（赤なら --waza は数えない）。
 *   壊した回りは「狙った試験（want の字で始まる名）」が ✗ になった時だけ ✓（よその試験の赤では数えない＝狙いの外れを見逃さない）。 */
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');   // 作業木の CRLF（autocrlf）でも壊す字が当たるように
/* --kari（作り write_2c2a2_tsukuri.md の 6）：khaw に当てる前は 2c-2a2 の列と変えた関数をここで当てる（塊の終わりの例外で全部戻る） */
const KARI_FN = ['mahjong_private.mj_w_tf0', 'mahjong_private.mj_w_trate', 'mahjong_private.mj_w_tvoid', 'mahjong_private.mj_w_op', 'public.mj_write',
  'mahjong_private.mj_tobi_ok', 'mahjong_private.mj_w_tobi_fix', 'mahjong_private.mj_w_tstate',   // E1：当てる前は {r} の形・鍵消し・卓の tobi をここで当てる
  'public.mj_read'];   // E2：当てる前は読みの cells・cell_ver を席の数（空いた席は null）でここで当てる
function KARI() {
  if (!process.argv.includes('--kari')) return '';
  const a = SCHEMA.indexOf('alter table mahjong.hanchans add column if not exists seats_version');
  const b = SCHEMA.indexOf('\n', SCHEMA.indexOf('add constraint hanchans_seats_version_ok', a));
  if (a < 0 || b < 0) throw new Error('--kari：seats_version の alter が見つからない');
  /* 新しい下請けは create で PUBLIC に EXECUTE が付く＝schema.sql と同じく塊の中で外す（⓪ の数え） */
  return SCHEMA.slice(a, b) + '\n  ' + KARI_FN.map(fnText).join('\n  ') + '\n  '
    + KARI_FN.filter((x) => x.startsWith('mahjong_private.')).map((x) => `revoke all on function ${x} from public, anon, authenticated;`).join('\n  ');
}
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);   // 終わり＝本体の閉じ（plpgsql の end $fn$; も language sql の $fn$; も）
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
/* [名, 関数, 壊す字, 替える字, 2つ目の替え（無ければ null）, 狙った試験の名の頭] */
const WAZA = [
  ['素点の範囲を見ない（表の行で赤になるか）', 'mahjong_private.mj_w_op', 'if v_x not between -2000000000 and 2000000000 or v_x % 100 <> 0 then', 'if false then', null, '⑩ 表：cell_set の100の倍数でない値は range'],
  ['op_results を書かない', 'public.mj_write', "insert into mahjong.op_results (room_id, op_id, result, user_id) values (p_room_id, p_op_id,\n        case when v_op0 in ('room_secret', 'room_share') then pg_catalog.jsonb_set(v_ret, '{results,0}', (v_ret #> '{results,0}') - 'channel_key') else v_ret end, v_me);", 'null;', null, '⑨ 同じ人の同じ op_id 2回'],
  ['卓の部屋を確かめない', 'mahjong_private.mj_w_t', 'where x.id = p_tid and x.room_id = p_room for update', 'where x.id = p_tid for update', null, '② 別の部屋の table_id'],
  ['MJ001 を値に直さない（internal に化ける）', 'public.mj_write', 'v_ret := sqlerrm::jsonb; v_n := 0;', "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0;", null, '② 別の部屋の hanchan_id'],
  ['limits を塊の中で数える（弾きで戻る）', 'public.mj_write', "    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);",
    "    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_n);\n    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);", ['  perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_n);\n  return v_ret;', '  return v_ret;'], '⑧ 後見の busy'],
  ['mj_tobi_ok が受け取りの席を見ない', 'mahjong_private.mj_tobi_ok', 'if x % 1 <> 0 or x < 0 or x >= p_players or x = k then return false; end if;', 'null;', null, '⑤ 自分の席・players 外'],
  ['チップの式（合計0でなくても ok）', 'mahjong_private.mj_w_tstate', "when v_c = 0 then 'ok'", "when v_c >= 0 then 'ok'", null, '⑦ c4 チップ +1 だけ（祝儀は使わない）：倉庫'],
  ['mj_caps を見ない', 'public.mj_write', 'if v_cap is null or v_c is null or v_c > v_cap then', 'if false then', null, "⑧' members が上限"],
  ['一時の失敗を busy にしない', 'public.mj_write', "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'lock'); v_n := 0;", "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0;", null, '⑧ 一時の失敗（55P03）'],
  ['並びの顔ぶれを比べない（p_set）', 'mahjong_private.mj_w_people', '  elsif (select pg_catalog.array_agg((t.v', '  elsif false and (select pg_catalog.array_agg((t.v', null, "①' hanchan_order に席にいない人"],
  ['op_results を op_id の順で消す', 'public.mj_write', 'order by o.at, o.op_id limit v_c - v_cap', 'order by o.op_id limit v_c - v_cap', null, "⑧' op_results は at の古い物から消す"],
  ['正味の門が行の無い人を見ない', 'public.mj_write', 'and (e.b is null or pg_catalog.abs', 'and (false or pg_catalog.abs', null, "①' extra_add：部屋の人だがその卓の席にも行にもいない"],
  ['取り消した開催日を見ない', 'mahjong_private.mj_w_op', 'if s.voided then', 'if false then', null, "③' 取り消した開催日に table_add"],
  ['リーグの日を見ない（卓から）', 'mahjong_private.mj_w_t', 'select s.league_id into v_l from mahjong.sessions s where s.id = t.session_id;', 'v_l := null;', null, '⑪ リーグの日の session_edit・table_edit：L でない入'],
  ['正味の門の |a| ≤ |b| を外す', 'public.mj_write', 'pg_catalog.abs(e.a) > pg_catalog.abs(e.b)', 'false', null, "⑦' 正味の門：3 → 4"],
  ['正味の門の符号の比べを外す', 'public.mj_write', ' or e.a * e.b < 0', '', null, "⑦' 正味の門：3 → −2"],
  ['卓の印を書かない', 'public.mj_write', 'if v_f0 and v_mk then perform mahjong_private.mj_w_tchanged', 'if false then perform mahjong_private.mj_w_tchanged', null, "⑦' そろった卓を ng に壊す"],
  ['一度そろったに (b) 0でない行を見ない', 'mahjong_private.mj_w_tstate', "v_done := v_es = 'ok' and exists", "v_done := v_es = 'ok' or exists", null, "⑦' 生まれた卓は first_complete_at 空"],
  ['tstate の where の足しを外す', 'mahjong_private.mj_w_tstate', '\n     or (v_done and t.first_complete_at is null));', ');', null, "⑦' 1組［A +3・B −3］でそろう"],
  ['組の前の first_complete_at を読まない', 'mahjong_private.mj_w_tf0', 'select x.first_complete_at is not null', 'select false', null, "⑦' そろった卓を ng に壊す"],
  ['使わない種の bad を外す（2c-3b で mj_w_kind へ移した）', 'mahjong_private.mj_w_kind', "if p_rules -> (v_k || '_pt10') = 'null'::jsonb then return null; end if;", 'null;', null, "⑦' 使わない種（祝儀 null）"],
  ['取り消した開催日の bad を外す', 'mahjong_private.mj_w_op', 'if t.voided or exists (select 1 from mahjong.sessions z where z.id = t.session_id and z.voided) then', 'if false then', null, "⑦' 取り消した開催日の卓"],
  ['卓の締めの判じを外す', 'mahjong_private.mj_w_tf0', 'or exists (select 1 from mahjong.settle_snaps z where z.session_id = x.session_id and z.made_at < pg_catalog.now())', 'or false', null, "⑦' 前の組で締めた開催日：そろっていない卓"],
  ['卓の締めの made_at < now() を外す', 'mahjong_private.mj_w_tf0', 'z.session_id = x.session_id and z.made_at < pg_catalog.now()', 'z.session_id = x.session_id', null, "⑦' 同じ取引の締め（made_at = now()）"],
  ['半荘の締めの判じを外す', 'mahjong_private.mj_w_changed', 'where t.id = x.table_id and z.made_at < pg_catalog.now()', 'where false', null, "⑦' 前の組で締めた開催日：そろっていない半荘"],
  ['半荘の締めの made_at < now() を外す', 'mahjong_private.mj_w_changed', 'where t.id = x.table_id and z.made_at < pg_catalog.now()', 'where t.id = x.table_id', null, "⑦' 同じ取引の締めだけ：そろっていない半荘"],
  /* H1'（h1b_sadame v2 §3）：消した上限の門を1つずつ戻す＝「越えても ok」の試験が赤になるか */
  ["P の門を戻す（30000）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if r.row_count + v_made > 30000 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', '*')); end if;\n", null, "⑧' H1' P："],
  ["F の門を戻す（10000）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if r.history_count + v_n > 10000 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'history')); end if;\n", null, "⑧' H1' history："],
  ["日の上限を戻す（3000）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if (select pg_catalog.count(*) from mahjong.sessions x where x.room_id = p_room_id) > 3000 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'sessions')); end if;\n", null, "⑧' H1' sessions："],
  ["卓の上限を戻す（10）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if coalesce((select pg_catalog.max(c) from (select pg_catalog.count(*) c from mahjong.tables x where x.room_id = p_room_id group by x.session_id) z), 0) > 10 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'tables')); end if;\n", null, "⑧' H1' tables："],
  ["半荘の上限を戻す（60）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if coalesce((select pg_catalog.max(c) from (select pg_catalog.count(*) c from mahjong.hanchans x where x.room_id = p_room_id group by x.table_id) z), 0) > 60 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'hanchans')); end if;\n", null, "⑧' H1' hanchans："],
  ["リーグの上限を戻す（50）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if (select pg_catalog.count(*) from mahjong.leagues x where x.room_id = p_room_id) > 50 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'leagues')); end if;\n", null, "⑯ H1' leagues："],
  ["ルールの上限を戻す（500）", 'public.mj_write', "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n", "    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）\n    if (select pg_catalog.count(*) from mahjong.rule_sets x where x.room_id = p_room_id) > 500 then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'rule_sets')); end if;\n", null, "⑯ H1' rule_sets："],
  /* ── 2c-2a2（作り write_2c2a2_tsukuri.md の 4）── */
  ['rename の dup で自分を除かない', 'mahjong_private.mj_w_op', 'x.name_key = v_key and x.id <> v_m.id limit 1', 'x.name_key = v_key limit 1', null, '⑪ member_rename：Ab → aB'],
  ['active に戻す時の dup を見ない', 'mahjong_private.mj_w_op', 'if v_b then\n        select x.id, x.name into c', 'if false then\n        select x.id, x.name into c', null, '⑪ member_active：true に戻す時だけ'],
  ['extra_set の版を比べない', 'mahjong_private.mj_w_op', 'if c.version <> v_bv then', 'if false then', null, '⑪ extra_set：版が古い'],
  ['extra_set の行なしで bv≠0 を見ない（F）', 'mahjong_private.mj_w_op', 'if v_bv <> 0 then', 'if false then', null, '⑪ extra_set：行が無く bv 1'],
  ['hanchan_seats が inactive を見ない', 'mahjong_private.mj_w_op', 'where x.room_id = p_room and not x.active', 'where false and not x.active', null, '⑪ hanchan_seats：inactive でも'],
  ['hanchan_seats が今の席の inactive も弾く', 'mahjong_private.mj_w_op', '\n                 and not exists (select 1 from pg_catalog.jsonb_each_text(h.seats) w where w.value = x.id::text)) then', ') then', null, '⑪ hanchan_seats：inactive でも'],
  ['顔ぶれが変わっても ton_order を残す', 'mahjong_private.mj_w_op', 'set ton_order = null, order_cells = null, order_version', 'set ton_order = h.ton_order, order_cells = h.order_cells, order_version', null, '⑪ hanchan_seats：顔ぶれが変わる'],
  ['seats_version を上げない', 'mahjong_private.mj_w_op', 'set seats = v_j2, seats_version = x.seats_version + 1', 'set seats = v_j2', null, '⑪ hanchan_seats：並べ替え'],
  ['hanchan_seats が半荘の印を書かない', 'mahjong_private.mj_w_op', "'seats', h.seats, v_j2, h.seats_version + 1);\n    perform mahjong_private.mj_w_changed(h.id, p_me);", "'seats', h.seats, v_j2, h.seats_version + 1);", null, '⑪ hanchan_seats：並べ替え'],
  ['レートの印を書かない（mj_w_trate）', 'mahjong_private.mj_w_trate', 'perform mahjong_private.mj_w_tchanged(p_tid, p_me);', 'null;', null, '⑪ table_edit：num・50'],
  ['取り消しで半荘に印を書かない（mj_w_tvoid）', 'mahjong_private.mj_w_tvoid', 'perform mahjong_private.mj_w_changed(y.id, p_me);', 'null;', null, '⑪ table_edit の取り消し'],
  ['取り消しの卓の印が f0 を見ない（mj_w_tvoid）', 'mahjong_private.mj_w_tvoid', 'if mahjong_private.mj_w_tf0(p_tid) then', 'if true then', null, '⑪ table_edit の取り消し'],
  ['session_edit の取り消しで印を書かない', 'mahjong_private.mj_w_op', 'if v_b is distinct from v_ss.voided then', 'if false then', null, '⑪ session_edit の取り消し'],
  ['session_edit のレートで印を書かない', 'mahjong_private.mj_w_op', 'if v_rate is distinct from v_ss.rate and not v_b then', 'if false then', null, '⑪ session_edit のレート：そろった卓'],
  ['session_edit の鍵に league_id を足す', 'public.mj_write', '"session_edit": ["session_id", "date", "place", "rate", "voided"]', '"session_edit": ["session_id", "date", "place", "rate", "voided", "league_id"]', null, '⑪ session_edit：league_id の鍵'],
  ['session に戻しても rate を null にしない', 'mahjong_private.mj_w_op', "mahjong_private.mj_w_bad(p_i, 'rate'); end if;\n      v_rate := null;", "mahjong_private.mj_w_bad(p_i, 'rate'); end if;", null, '⑪ table_edit：session に戻すと'],
  /* ── 2c-2a2 本番前 taiketsu の止めの直し（止め2・注意2・注意3）── */
  ['取り消しの卓の印を書かない（mj_w_tvoid の f0）', 'mahjong_private.mj_w_tvoid', 'if mahjong_private.mj_w_tf0(p_tid) then perform', 'if false then perform', null, '⑪ 取り消し（mj_w_tvoid）'],
  ['extra_set が取り消した開催日を見ない', 'mahjong_private.mj_w_op', 'if t.voided or exists (select 1 from mahjong.sessions z2 where z2.id = t.session_id and z2.voided) then', 'if t.voided then', null, '⑪ extra_set：取り消した開催日の卓'],
  ['extra_set が取り消した卓を見ない', 'mahjong_private.mj_w_op', 'if t.voided or exists (select 1 from mahjong.sessions z2', 'if exists (select 1 from mahjong.sessions z2', null, '⑪ extra_set：取り消した卓'],
  ['extra_add が取り消した卓を見ない', 'mahjong_private.mj_w_op', 'if t.voided or exists (select 1 from mahjong.sessions z where', 'if exists (select 1 from mahjong.sessions z where', null, '⑪ extra_add：取り消した卓'],
  ['session_edit のレートの印が rate_mode を見ない', 'mahjong_private.mj_w_op', "and not x.voided and x.rate_mode = 'session' order by x.id", 'and not x.voided order by x.id', null, '⑪ session_edit のレート：num・none'],
  ['table_edit のレートの印が取り消した開催日を見ない', 'mahjong_private.mj_w_op', '\n       and not exists (select 1 from mahjong.sessions z3 where z3.id = t.session_id and z3.voided) then', ' then', null, '⑪ table_edit のレート：取り消した開催日'],
  ['rate の範囲を見ない（table_edit を狙う）', 'mahjong_private.mj_w_op', "if v_rate not between 10 and 2000000000 or v_rate % 10 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'rate', 'range'); end if;", 'null;', null, '⑪ table_edit：num の rate 15'],
  ['hanchan_seats が部屋の人か見ない', 'mahjong_private.mj_w_op', 'where x.room_id = p_room and x.id in (select (q.v', 'where x.id in (select (q.v', null, '⑪ hanchan_seats：長さ・重なり・よその部屋の人'],
  ['extra_set の行なし value 0 で bv を見ない', 'mahjong_private.mj_w_op', 'if v_bv <> 0 then', 'if false then', null, '⑪ extra_set：行が無く value 0'],
  /* 2c-3b（write3_sekkei.md §3 --waza）。check の正規表現（表）は関数でない＝db-checks.live の行で守る */
  ['c:<id> を tane_custom の id と照らさない', 'mahjong_private.mj_w_kind', "where q.e ->> 'id' = pg_catalog.substr(v_k, 3) limit 1;", 'limit 1;', null, '⑫ ルールに無い id'],
  ['外へ払う種の負の門を外す', 'mahjong_private.mj_w_op', "if v_kd = 'out' and", 'if false and', null, '⑫ 外へ払う種：'],
  ['tstate が合計0の自由な項目を見ない', 'mahjong_private.mj_w_tstate', " or v_why is not null then 'ng'", " then 'ng'", null, '⑫ 合計0の種 c:ko に +3'],
  ['一度そろったに外へ払う種も数える', 'mahjong_private.mj_w_tstate', 'or e.kind = any (v_sum0)));', "or e.kind like 'c:%'));", null, '⑫ 外へ払う種だけ'],
  ['正味の門の字順を C にしない（libc の en_US は : を飛ばす＝khaw の既定 ICU では割れない）', 'public.mj_write', 'order by q.kd collate "C", q.m collate "C" loop', 'order by q.kd collate "en_US.utf8", q.m collate "C" loop', null, '⑫ 正味の門で chip と c:ko'],
  ['理由を id の順にする', 'mahjong_private.mj_w_tstate', '   order by u.n limit 1;', '   order by u.k limit 1;', null, '⑫ 合計0の種が2つ ng'],
  /* 2c-3c（write3_sekkei.md §4 --waza・v1.1 S1 S3） */
  /* ── 2c-3c’ やきとり＝extras の種 yaki（write6_yaki_sadame.md v1.1）── */
  ["yaki の pt を見ない（pt 0 も使う）", "mahjong_private.mj_w_yaki_used", ">= 1 else false end", ">= 0 else false end", null, "⑬ pt 0 の卓"],
  ["yaki を使わない卓でも通す", "mahjong_private.mj_w_kind", "return case when mahjong_private.mj_w_yaki_used(p_rules) then 'sum0' end;", "return 'sum0';", null, "⑬ yakitori false の卓"],
  ["tstate が yaki を数えない", "mahjong_private.mj_w_tstate", "then v_sum0 := array['yaki'] || v_sum0;", "then v_sum0 := v_sum0;", null, "⑬ yaki +3"],
  ["理由の順を c: → yaki に", "mahjong_private.mj_w_tstate", "array['yaki'] || v_sum0", "v_sum0 || array['yaki']", null, "⑬ yaki と c:ko が両方"],
  /* ── B2 段1 飛び賞＝extras の種 tobi（tobi_chip_v3.md）── */
  ["tobi の pt を見ない（pt 0 も使う）", "mahjong_private.mj_w_tobi_used", ">= 1 else false end", ">= 0 else false end", null, "⑯ pt 0 の卓"],
  ["tobi を使わない卓でも通す", "mahjong_private.mj_w_kind", "return case when mahjong_private.mj_w_tobi_used(p_rules) then 'sum0' end;", "return 'sum0';", null, "⑯ tobi false の卓"],
  ["E1：tstate がまた tobi を数える", "mahjong_private.mj_w_tstate", "  -- E1（e_sadame v2 §E1-7）", "  if mahjong_private.mj_w_tobi_used(rs) then v_sum0 := array['tobi'] || v_sum0; end if;\n  --", null, "⑯ tobi +3"],
  ["E1：{r} の同じ席2回を通す", "mahjong_private.mj_tobi_ok", "or x <= v_prev then", "or x < v_prev then", null, "⑤' {r} の小さい順でない"],
  ["E1：{r} に他の鍵が在っても通す", "mahjong_private.mj_tobi_ok", "jsonb_object_keys(p)) <> 1 then return false;", "jsonb_object_keys(p)) < 1 then return false;", null, "⑤' {r} の小さい順でない"],
  ["E1：{r} の形を通さない", "mahjong_private.mj_tobi_ok", "    return true;\n  end if;", "    return false;\n  end if;", null, "⑤' {r:[0,2]}"],
  ["E2：始めの門 (a) open を外す", "mahjong_private.mj_w_op", "\n    if v_h2 is not null then", "\n    if false then", null, "⑤'' E2 開いている回が在る卓の始め"],
  ["E2：始めの門 (b) new を外す", "mahjong_private.mj_w_op", "if v_sn is not null and (select", "if false and (select", null, "⑤'' E2 鎖の回の数＞seen_n"],
  ["E2：(b) で取り消した回を数えない", "mahjong_private.mj_w_op", "(select pg_catalog.count(*) from mahjong.hanchans x where x.table_id = any(v_ch2)) > v_sn", "(select pg_catalog.count(*) from mahjong.hanchans x where x.table_id = any(v_ch2) and not x.voided) > v_sn", null, "⑤'' E2 取り消した回も鎖の回の数に入る"],
  ["E2：全部 null の始めを通す", "mahjong_private.mj_w_op", "if v_nc = 0 then", "if false then", null, "⑤'' E2 全部 null"],
  ["E2：空いた席にも行を作る（値 0）", "mahjong_private.mj_w_op", "if pg_catalog.jsonb_typeof(p_o -> 'cells' -> k) = 'null' then continue; end if;   -- E2 §1：空いた席は行を作らない\n      insert into mahjong.cells (hanchan_id, seat, value, updated_by_user) values (v_id, k, ((p_o -> 'cells' -> k)::numeric)::int, p_me);",
    "insert into mahjong.cells (hanchan_id, seat, value, updated_by_user) values (v_id, k, coalesce(((p_o -> 'cells' -> k) #>> '{}')::int, 0), p_me);", null, "⑤'' E2 空いた席が null の始め"],
  ["E2：行の無い席の版1 を入れてしまう", "mahjong_private.mj_w_op", "      if v_bv <> 0 then\n        perform", "      if false then\n        perform", null, "⑤'' E2 行の無い席に版1"],
  ["E2：読みが空いた席を詰める", "public.mj_read", "left join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s", "join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s", null, "⑤'' E2 mj_read（素の room）"],
  ["E2：戻す時の門を外す", "mahjong_private.mj_w_op", "\n      if v_h2 is not null then", "\n      if false then", null, "⑤'' E2 点がまだの回を戻す"],
  ["④を残す（飛んだら why tobi で待つ）", "mahjong_private.mj_w_hstate", "    v_st := 'ok'; v_why := null;", "    v_st := case when exists (select 1 from pg_catalog.jsonb_array_elements(mahjong_private.mj_w_busted(p_hid)) t(v) where not (h.tobi_to ? (t.v::text))) then 'input' else 'ok' end; v_why := case when v_st = 'input' then 'tobi' end;", null, "⑤ 飛んだ席の鍵が無くても ok"],
  ["段1 で tobi_set を捨てる", "mahjong_private.mj_w_op", "update mahjong.hanchans x set tobi_to = v_j, tobi_version = x.tobi_version + 1 where x.id = h.id;", "update mahjong.hanchans x set tobi_to = x.tobi_to where x.id = h.id;", null, "⑤ tobi_set で入れて ok"],
  /* ── ⑰ B1 卓の席 op table_seats（b1_sadame_v2.md v2.1）── */
  ['正味の門が卓の席を見ない', 'public.mj_write', "\n           and not exists (select 1 from mahjong.tables y, pg_catalog.jsonb_array_elements_text(y.seats) s\n                            where y.id = any (v_ch) and s.value = e.m)", '', null, '⑰ 卓の席の人に半荘0の卓で chip +3'],
  ['table_seats が長さを見ない', 'mahjong_private.mj_w_op', " or pg_catalog.jsonb_array_length(v_j) <> t.players then", ' then', null, '⑰ table_seats：長さ違い'],
  ['table_seats がよその部屋を見ない', 'mahjong_private.mj_w_op', "where x.room_id = p_room and x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))) <> t.players then", "where x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))) <> t.players then", null, '⑰ table_seats：よその部屋の人'],
  /* ⑮ 2c-2c 部屋の op 4つ（write5_sadame.md v1.1 S1〜S4・K-3・組に1つ） */
  ["room_secret の前と同じパスを見ない", 'mahjong_private.mj_w_op', "if extensions.crypt(v_key, s.pass_hash) = s.pass_hash then", "if false then", null, '⑮ room_secret：前と同じパス'],
  ["room_secret の今と同じ URL を見ない", 'mahjong_private.mj_w_op', "if v_s = s.url_token_hash then", "if false then", null, '⑮ room_secret：今と同じ URL'],
  ["op_results に channel_key を残す", 'public.mj_write', "case when v_op0 in ('room_secret', 'room_share') then pg_catalog.jsonb_set(v_ret, '{results,0}', (v_ret #> '{results,0}') - 'channel_key') else v_ret end", "v_ret", null, '⑮ room_secret：送り直しの答えに channel_key を書かない'],
  ["送り直しで channel_key を読み直さない", 'public.mj_write', "if v_op0 in ('room_secret', 'room_share') and (v_x ->> 'ok') = 'true' then", "if false then", null, '⑮ room_secret：送り直し →'],
  ["履歴に channel_key を書く", 'mahjong_private.mj_w_op', "'secret', null, null, null);", "'secret', null, pg_catalog.to_jsonb(v_kd), null);", null, '⑮ room_secret：履歴に'],
  ["room_secret で名乗りを消さない", 'mahjong_private.mj_w_op', "delete from mahjong.member_claims x where x.member_id = any(v_ids) or (x.room_id = p_room and x.user_id = any(v_us));", "null;", null, '⑮ room_secret：管が押す'],
  ["room_secret で L の行も消す", 'mahjong_private.mj_w_op', "and a.role = 'nyu'\n       and not exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = a.user_id);", "and a.role = 'nyu';", null, '⑮ room_secret：管が押す'],
  ["room_secret で出した印を消さない", 'mahjong_private.mj_w_op', "delete from mahjong.room_bans b where b.room_id = p_room;", "null;", null, '⑮ room_secret：出した人'],
  ["継ぐ順で管を先にしない", 'mahjong_private.mj_w_inherit', "order by (a.role = 'kan') desc, a.joined_at", "order by a.joined_at", null, '⑮ K-3 段1：持ち主のアカウントが消えた'],
  ["継ぎでリーグを移さない", 'mahjong_private.mj_w_inherit', "where l.room_id = p_room and l.owner_user_id = p_from;", "where l.room_id = p_room and l.owner_user_id = p_from and false;", null, '⑮ room_leave：持ち主が抜ける'],
  ["継いだ人の役を kan に直さない", 'mahjong_private.mj_w_inherit', "update mahjong.room_accounts a set role = 'kan' where a.room_id = p_room and a.user_id = v_to;", "null;", null, '⑮ room_leave：管が居ない'],
  ["room_leave の alone を外す", 'mahjong_private.mj_w_op', "perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'op', 'reason', 'alone'));", "null;", null, '⑮ room_leave：ほかに誰も居ない'],
  ["room_leave でつなぎを外す（C2-1 前の形）", 'mahjong_private.mj_w_op', "    insert into mahjong.room_leaves (room_id, user_id, left_at, left_hist_id)", "    update mahjong.members m set user_id = null, version = m.version + 1 where m.room_id = p_room and m.user_id = p_me;\n    insert into mahjong.room_leaves (room_id, user_id, left_at, left_hist_id)", null, '⑮ room_leave：入が抜ける'],
  ["room_leave で自分の名乗りを消さない", 'mahjong_private.mj_w_op', "delete from mahjong.member_claims x where x.room_id = p_room and x.user_id = p_me;\n    insert into mahjong.room_leaves", "insert into mahjong.room_leaves", null, '⑮ room_leave：入が抜ける'],
  ["room_leave で抜けた印を書かない", 'mahjong_private.mj_w_op', "insert into mahjong.room_leaves (room_id, user_id, left_at, left_hist_id) values (p_room, p_me, pg_catalog.now(), v_hid)\n      on conflict (room_id, user_id) do update set left_at = excluded.left_at, left_hist_id = excluded.left_hist_id;", "null;", null, '⑮ room_leave：入が抜ける'],
  ["部屋の op を組に混ぜてよい", 'public.mj_write', "if v_len > 1 and v_name in ('room_leave', 'room_delete', 'room_undelete', 'room_secret', 'room_share', 'room_close') then", "if false then", null, '⑮ 組に1つだけ'],
  ["K-3 段1 を外す", 'public.mj_write', "if v_role is not null and not exists (select 1 from auth.users u where u.id = r.owner_user_id) then", "if false then", null, '⑮ K-3 段1'],
  /* ⑭ 2c-2b 人の op 5つ（紙 write4_shiken_keikaku.md の13本） */
  ["役の門を外す（kan の case）", 'mahjong_private.mj_w_need', "when p_who in ('kan', 'owner_or_kan') then case when mahjong_private.mj_w_is_kan(p_role) then null else 'kan' end", "when p_who in ('kan', 'owner_or_kan') then null", null, '⑭ 役：入の member_relink・account_remove'],
  ["owner を kan で通す", 'mahjong_private.mj_w_need', "when p_who = 'owner' then case when p_role = 'owner' then null else 'owner' end", "when p_who = 'owner' then case when mahjong_private.mj_w_is_kan(p_role) then null else 'owner' end", null, '⑭ 役：管の role_set'],
  ["入り直しの門を外す", 'public.mj_write', "if not v_ra then", "if false then", null, '⑭ 入り直し：持ち主 OLD'],
  ["grant を「いつも」入り直しにする", 'public.mj_write', "(v_re = 'grant' and (p_ops -> v_i ->> 'op') = 'role_set' and (p_ops -> v_i ->> 'role') is not distinct from 'kan')", "v_re = 'grant'", null, '⑭ 入り直し：amr 無しで nyu へ下げる'],
  ["名乗りを残さない", 'mahjong_private.mj_w_op', "insert into mahjong.member_claims (room_id, member_id, user_id) values (p_room, v_id, p_me);", "null;", null, '⑭ link：他人の人'],
  ["linked を外す", 'mahjong_private.mj_w_op', "perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'linked', 'i', p_i, 'member_id', v_id2));", "null;", null, '⑭ link：別の人にもう一人'],
  ["admins の +1（持ち主）を外す", 'mahjong_private.mj_w_op', "+ 1 + 1 > v_cap2", "+ 1 > v_cap2", null, '⑭ role_set：管5'],
  ["relink の付ける人の確かめを外す", 'mahjong_private.mj_w_op', "if not (coalesce(v_u = v_own, false) or exists (select 1 from mahjong.room_accounts a where a.room_id = p_room and a.user_id = v_u))", "if not (true)", null, '⑭ relink：部屋に居ない人'],
  ["account_remove のリーグの持ち主の確かめを外す", 'mahjong_private.mj_w_op', "if exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = v_u) then", "if false then", null, '⑭ account_remove：リーグの持ち主'],
  ["account_remove で members.user_id を外さない", 'mahjong_private.mj_w_op', "m.user_id = v_u order by m.id for update loop", "m.user_id = v_u and false order by m.id for update loop", null, '⑭ account_remove：管が入を出す'],
  ["account_remove で room_bans を足さない", 'mahjong_private.mj_w_op', "insert into mahjong.room_bans (room_id, user_id) values (p_room, v_u) on conflict (room_id, user_id) do nothing;", "null;", null, '⑭ account_remove：管が入を出す'],
  ["amr が空・字で通す", 'mahjong_private.mj_w_reauth_ok', "return v_max is not null and v_max >=", "return v_max is null or v_max >=", null, '⑭ 入り直し：amr 無し・空・字'],
  ["unlink で名乗りを消さない", 'mahjong_private.mj_w_op', "delete from mahjong.member_claims x where x.member_id = v_id;", "null;", null, '⑭ link：[unlink L0, link L1]'],
  ["つながった時に名乗りを消さない", 'mahjong_private.mj_w_op', "delete from mahjong.member_claims x where x.member_id = v_id or (x.room_id = p_room and x.user_id = p_me);", "null;", null, '⑭ link：名乗った人が空きへつながると'],
  /* ⑯ 2c-2d1（write7_league_sadame_v11.md の waza・人の鍵は tests/league-lock.live.mjs --waza） */
  ["③' で who_league を見ずに全部の op を見る", 'public.mj_write', "v_need := case when v_wl = 'same' or v_wl = v_who then mahjong_private.mj_w_need(v_who, v_role) end;", "v_need := mahjong_private.mj_w_need(v_who, v_role);", null, '⑯ league_save：L は通る'],
  ["league_save の役の門を外す", 'mahjong_private.mj_w_op', "perform mahjong_private.mj_w_role(p_room, v_op, v_id, null, p_me, p_role, p_i);   -- L・取り消したリーグ＝bad at league", "null;", null, '⑯ league_save：L でない管'],
  ["session_add が rooms の版を写す", 'mahjong_private.mj_w_op', "select g.rule_set_id, g.rule_version, g.rule_set_id_alt, g.rule_version_alt into s;", "select x.rule_set_id, x.rule_version, null::uuid as rule_set_id_alt, null::int as rule_version_alt into s from mahjong.rooms x where x.id = p_room;", null, '⑯ league_save でルールを替えた後'],
  ["24時間5本を6本にする", 'mahjong_private.mj_w_op', "x.created_at > pg_catalog.now() - interval '24 hours') >= 5 then", "x.created_at > pg_catalog.now() - interval '24 hours') >= 6 then", null, '⑯ 人ごと24時間5本'],
  ["消えた L を継がない", 'public.mj_write', "if v_role is not null then\n    for v_lg in", "if false then\n    for v_lg in", null, '⑯ 消えた L：部屋に居る人'],
  ["owner_or_sole_L で他の L を見ない", 'mahjong_private.mj_w_role', "elsif not exists (select 1 from mahjong.leagues l where l.id = any(v_ls) and l.owner_user_id is distinct from p_me) then v_need := null;", "elsif true then v_need := null;", null, '⑯ owner_or_sole_L'],
  /* ⑯' D2（d2_sadame v1.1 §4） */
  ["D2 リーグの日の重なりの門を外す", 'mahjong_private.mj_w_op', "select x.id into v_ida from mahjong.sessions x where x.league_id = v_id2 and not x.voided", "select x.id into v_ida from mahjong.sessions x where false and x.league_id = v_id2 and not x.voided", null, '⑯ D2 締めの無い日が在るリーグの2日目'],
  ["D2 alt の卓を今のリーグの版にする", 'mahjong_private.mj_w_op', "v_ida := s.rule_set_id_alt; v_rv := s.rule_version_alt;", "select l.rule_set_id_alt, l.rule_version_alt into v_ida, v_rv from mahjong.leagues l where l.id = s.league_id;", null, '⑯ D2 日の途中の league_save'],
  ["D2 期間の門を外す", 'mahjong_private.mj_w_op', "if (g.date_from is not null and v_d < g.date_from)", "if false and (g.date_from is not null and v_d < g.date_from)", null, '⑯ D2 期間の外'],
  ["D2 違う rate の門を外す", 'mahjong_private.mj_w_op', "if v_rate is not null and v_rate is distinct from v_x then perform mahjong_private.mj_w_bad(p_i, 'rate'); end if;", "null;", null, '⑯ D2 主の rules と違う rate'],
  ["D2 rate を主の rules から写さない", 'mahjong_private.mj_w_op', "      v_rate := v_x;", "      null;", null, '⑯ D2 alt の卓'],
  ["D2 alt の門を外す", 'mahjong_private.mj_w_op', "if v_alt and (s.league_id is null or s.rule_set_id_alt is null) then", "if false then", null, '⑯ D2 ふつうの日で alt'],
];

let exit = 0;
if (!isTest) { console.log('★中止★ test の倉庫でない'); exit = 1; }
else {
  const lib = await loadLib();
  if (process.argv.includes('--waza')) {
    let red = 0;
    const base = await runSql(mkSql());
    const bl = [];
    const b0 = base.err ? null : check(base.out, lib, (s) => bl.push(s));
    /* MJ_WAZA_ONLY＝名にこの字を含む壊しだけ回す（直した1本の回し直し用・数は「回した数」で出す） */
    const only = process.env.MJ_WAZA_ONLY;
    const WZ0 = only ? WAZA.filter(([n]) => n.includes(only)) : WAZA;
    /* MJ_WAZA_SLICE＝「始め:終わり」で WAZA の並びの一部だけ回す（khaw は 114 本を続けて回すと CPU が絞られて 544 になる・11-22 測った）
     * MJ_WAZA_REST＝1本ごとに休む秒。続けて2本 塊が回らなかったら残りは回さず「未測定」で止める（落ちた倉庫を叩き続けない） */
    const sl = /^(\d+):(\d+)$/.exec(process.env.MJ_WAZA_SLICE || '');
    const WZ = sl ? WZ0.slice(Number(sl[1]), Number(sl[2])) : WZ0;
    const rest = Number(process.env.MJ_WAZA_REST || 0) * 1000;
    let down = 0, unmeasured = 0;
    if (!b0 || b0.f > 0) {
      console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base.err || bl.filter((s) => s.startsWith('  ✗')).slice(0, 5).join(' ／ ')));
      exit = 1;
    } else {
      console.log(`  素の回り：${b0.p} passed, 0 failed（緑）`);
      for (const [name, fn, from, to, extra, want] of WZ) {
        let t = fnText(fn);
        if (!t.includes(from)) { console.log(`  ✗ 壊す字が無い（${name}）`); exit = 1; continue; }
        t = t.split(from).join(to);
        if (extra) { if (!t.includes(extra[0])) { console.log(`  ✗ 壊す字が無い（${name}・2つ目）`); exit = 1; continue; } t = t.split(extra[0]).join(extra[1]); }
        if (!bl.some((s) => s.startsWith('  ✓ ' + want))) { console.log(`  ✗ ${name}：狙った試験「${want}」が素の回りに無い`); exit = 1; continue; }
        if (down >= 2) { unmeasured++; exit = 1; continue; }
        if (rest) await new Promise((ok) => setTimeout(ok, rest));
        const r = await runSql(mkSql(t));
        if (r.err) { down++; console.log(`  ✗ ${name}：塊が回らなかった ${r.err.slice(0, 300)}`); exit = 1; continue; }
        down = 0;
        const lines = [];
        const { f } = check(r.out, lib, (s) => lines.push(s));
        const hit = lines.filter((s) => s.startsWith('  ✗ ' + want));
        if (hit.length) { red++; console.log(`  ✓ ${name} → 狙いが赤（${hit[0].trim().slice(0, 90)}）・赤は全部で ${f}`); }
        else { console.log(`  ✗ ${name} → 狙った試験「${want}」が赤にならない（全部の赤 ${f}）`); exit = 1; }
      }
    }
    console.log(`
write --waza: ${red}/${WZ.length} 狙いが赤になった${only ? `（MJ_WAZA_ONLY で ${WAZA.length} 本から絞った）` : ''}${sl ? `（MJ_WAZA_SLICE ${sl[1]}:${sl[2]}・全部で ${WZ0.length} 本）` : ''}${unmeasured ? `・★未測定 ${unmeasured}（倉庫が続けて落ちたので回していない）★` : ''}`);
    if (red !== WZ.length) exit = 1;
  } else {
    const r = await runSql(mkSql());
    if (r.err) { console.log('★失敗★ ' + r.err); exit = 1; }
    else {
      const { p, f } = check(r.out, lib, (s) => console.log(s));
      /* 残っていないか（塊の外で数える） */
      const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like 'w-r%') as rooms`);
      let left = null; try { left = JSON.parse(lf.text)[0]; } catch (_) { /* 字 */ }
      const clean = left && left.u === 0 && left.rooms === 0;
      console.log(`  ${clean ? '✓' : '✗'} 倉庫に試験の人・部屋が残っていない${clean ? '' : ' — ' + lf.text.slice(0, 200)}`);
      console.log(`\nwrite: ${p + (clean ? 1 : 0)} passed, ${f + (clean ? 0 : 1)} failed`);
      exit = f || !clean ? 1 : 0;
    }
  }
}
process.exitCode = exit;
