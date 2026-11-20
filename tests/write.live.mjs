/* write.live.mjs — ★書く入口 public.mj_write を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * 案 mahjong_tataki_2026-11-20/write_sekkei.md v5.2 の「試験」§8 ⓪〜⑨・⑧'：
 *  ⓪ ログイン無し → mj_session・anon と PUBLIC に EXECUTE が無い・下請けは客から呼べない
 *  ① 一本道（member_add×4 → session_add → table_add → hanchan_start → cell_set で崩す → 戻す → extra_add ± → settle_snap）
 *  ② 弾き（別の人の op_id・別の部屋の id・同じ id の作る op・3人卓の seat 3・知らない鍵・league_id・not_yet 22個・31個・知らない op）
 *  ③ 範囲 ④ 版 ⑤ 飛び賞 ⑥ そろった後 ⑦ チップ・祝儀（11通り・倉庫と lib〔画面の lib/room-state.mjs の tableView〕に同じ表を通す）
 *  ⑧ 数え（先見・後見の busy・internal と一時の失敗・古い窓・入と管が別）⑧' 上限 ⑨ 送り直し・部屋・last_seen
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝仮の人・部屋・trigger も全部戻る）。
 * ★now() が取引の中で止まる＝節ごとに write:* の行を消してから始める（1分の上限の偽の赤を出さない）★
 * ★lib の比べ＝この repo の lib/room-state.mjs（gamen-1 は 5290b84 で main に入った）を読む。MJ_GAMEN_LIB で別の置き場を指せる。無ければ赤（未測定）★
 * 使い方: node tests/write.live.mjs            … 試験
 *         node tests/write.live.mjs --waza     … ★わざと壊して狙った試験が赤になるか★（14か所を1つずつ壊す・先に素の回りが緑か見る・壊した関数は塊と一緒に戻る）
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
const PASS = 'Zq9Pass';
const N_U = 7;                                // 1＝A・C・E・F の持ち主 2＝A の入 3＝A の管 4＝入っていない人 5＝出す人 6＝B の持ち主 7＝空き
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
  'rn', ${LS('rn1d')}, 'uk', ${LS('uk1d')}, 'rk', ${LS('rk1d')}, 'all1d', ${LS('all1d')})`;
const W = (key, who, room, ops, opid) => `${asWho(who)}
  cx := ${CNT(room)};
  begin r := public.mj_write(${room}, ${opid ? `'${opid}'::uuid` : 'gen_random_uuid()'}, ${ops}); exception when others then r := jsonb_build_object('raised', sqlerrm); end;
  res := res || jsonb_build_object('${key}', r, '${key}_c0', cx, '${key}_c1', ${CNT(room)});`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const HR = (h) => `select jsonb_build_object('state', state, 'why', state_reason, 'fc', first_complete_at is not null, 'ch', changed_after_complete_at is not null,
  'cb', changed_by_user, 'v', version, 'tobi', tobi_to, 'tv', tobi_version, 'voided', voided, 'seats', seats, 'ov', order_version, 'ton', ton_order, 'lost', lost_kyotaku)
  from mahjong.hanchans where id = '${h}'`;
const TR = (t) => `select jsonb_build_object('c', chip_state, 's', shugi_state, 'e', extra_state) from mahjong.tables where id = '${t}'`;
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
const ov = (h) => S(`(select to_jsonb(order_version) from mahjong.hanchans where id = '${h}')`);
const TON4 = [MA[1], MA[0], MA[3], MA[2]];
/* ⑧' op_results の消す順：Q1 は op_id が一番小さく、Q2 は一番大きいが at が一番古い＝at の順なら Q2 が消え、op_id の順なら Q1 が消える */
const OPQ1 = '00000000-0000-4000-8000-000000000001', OPQ2 = 'ffffffff-ffff-4fff-bfff-fffffffffffe', OPQ3 = U();
const BIG = 'x'.repeat(33000);
/* 32KB ちょうど：content {"big": "x…"} は n+11 字・used {} と missing [] は2字ずつ＝n+15 = 32768（倉庫で re5_len を数えて確かめる） */
const EDGE = 'x'.repeat(32768 - 15);
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
const NAMES12 = ['member_add', 'session_add', 'table_add', 'hanchan_start', 'hanchan_order', 'cell_set', 'tobi_set', 'kyotaku_set', 'extra_add', 'settle_snap', 'hanchan_void', 'hanchan_unvoid'];

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
  for nm in select name from mahjong.mj_ops where name not in (${NAMES12.map((n) => `'${n}'`).join(', ')}) order by name loop
    r := public.mj_write(ra, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', nm)));
    arr := arr || jsonb_build_object(nm, r);
  end loop;
  res := res || jsonb_build_object('ny', arr);
  ${W('many', 2, 'ra', A(...Array.from({ length: 31 }, () => O('hanchan_void', { hanchan_id: HA1 }))))}
  ${W('fooop', 2, 'ra', A(O('foo')))}
  ${W('notarr', 2, 'ra', `'{}'::jsonb`)}

  /* ③ 範囲 */
  ${RS}
  ${W('r1', 2, 'ra', A(O('cell_set', { hanchan_id: HA1, seat: 1, value: 200100, base_version: 1 })))}
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
  ${W('rr3', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 100010 })))}
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
  ${undo('re', `${RS}
    ${W('re1', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 10 })))}
    ${W('re2', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-20', rate: 100000, place: 'あ'.repeat(40) })))}
    ${W('re3', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'あ'.repeat(20) })))}
    ${W('re4', 2, 'ra', A(ma(U(), 'い'.repeat(20))))}
    res := res || jsonb_build_object('re5_len', octet_length(jsonb_build_object('big', '${EDGE}')::text) + octet_length('{}'::jsonb::text) + octet_length('[]'::jsonb::text));
    ${W('re5', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: { big: EDGE }, used: {}, missing: [] })))}
    ${W('re6', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: SNAPREV, content: { big: EDGE + 'x' }, used: {}, missing: [] })))}`)}

  /* ③' 取り消した開催日・卓／リーグの日（行を直に変えて塊ごと戻す） */
  ${RS}
  ${undo('vs', `update mahjong.sessions set voided = true where id = '${SA}';
    ${W('vs1', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: '消した日' })))}`)}
  ${undo('vt', `update mahjong.tables set voided = true where id = '${TA}';
    ${W('vt1', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}`)}
  ${undo('lgd', `insert into mahjong.leagues (id, room_id, name, rule_set_id, owner_user_id) values ('${U()}', ra, 'L', (select rule_set_id from mahjong.rooms where id = ra), us[1]);
    update mahjong.sessions set league_id = (select id from mahjong.leagues where room_id = ra limit 1) where id = '${SA}';
    ${W('lg1', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: 'リーグ' })))}
    ${W('lg2', 2, 'ra', A(cs(HA1, 0, 39000)))}
    ${W('lg3', 2, 'ra', A(O('extra_add', { table_id: TA, member_id: MA[0], kind: 'chip', add: 1 })))}
    ${W('lg4', 2, 'ra', A(O('settle_snap', { session_id: SA, rev: 2, content: {}, used: {}, missing: [] })))}`)}

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

  /* ⑧ 数え */
  ${RS}
  ${undo('b1', `insert into mahjong.limits (kind, key, window_start, count) values ('write:ur1m', ra::text || ':' || us[2]::text, date_trunc('minute', now()), 120);
    ${W('b1', 2, 'ra', A(ma(U(), '先見')))}`)}
  ${RS}
  ${undo('b2', `insert into mahjong.limits (kind, key, window_start, count) values ('write:rn1d', ra::text, date_trunc('hour', now()), 2999);
    ${W('b2', 2, 'ra', A(ma(U(), '後見1'), ma(U(), '後見2')))}`)}
  ${RS}
  ${undo('b3', `insert into mahjong.limits (kind, key, window_start, count) values ('write:rn1d', ra::text, date_trunc('hour', now()) - interval '3 hours', 3000);
    ${W('b3n', 2, 'ra', A(ma(U(), '入満ち')))}
    ${W('b3k', 3, 'ra', A(ma(U(), '管は書ける')))}`)}
  ${RS}
  ${undo('b4', `insert into mahjong.limits (kind, key, window_start, count) values ('write:rk1d', ra::text, date_trunc('hour', now()), 3000);
    ${W('b4k', 3, 'ra', A(ma(U(), '管満ち')))}
    ${W('b4n', 2, 'ra', A(ma(U(), '入は書ける')))}`)}
  ${RS}
  ${undo('bo', `insert into mahjong.limits (kind, key, window_start, count) values ('write:ur1m', ra::text || ':' || us[2]::text, date_trunc('minute', now()) - interval '5 minutes', 7),
      ('write:rn1d', ra::text, now() - interval '25 hours', 9);
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
  ${undo('ft', `update mahjong.mj_caps set cap = (select count(*) from mahjong.tables where session_id = '${SA}') where tbl = 'tables' and scope = 'session';
    ${W('ft', 2, 'ra', A(O('table_add', { table_id: U(), session_id: SA, label: '満ち' })))}`)}
  ${undo('fh', `update mahjong.mj_caps set cap = (select count(*) from mahjong.hanchans where table_id = '${TA}') where tbl = 'hanchans' and scope = 'table';
    ${W('fh', 2, 'ra', A(O('hanchan_start', { hanchan_id: U(), table_id: TA, seats: MA.slice(0, 4), cells: C4 })))}`)}
  ${undo('fs', `update mahjong.mj_caps set cap = (select count(*) from mahjong.sessions where room_id = ra) where tbl = 'sessions' and scope = 'room';
    ${W('fs', 2, 'ra', A(O('session_add', { session_id: U(), date: '2026-11-21', rate: null })))}`)}
  ${undo('fp', `update mahjong.mj_caps set cap = (select row_count from mahjong.rooms where id = ra) where tbl = '*' and scope = 'room';
    ${W('fp', 2, 'ra', A(ma(U(), 'P 満ち')))}`)}
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
  ${undo('fhi', `update mahjong.mj_caps set cap = (select history_count from mahjong.rooms where id = ra) where tbl = 'history' and scope = 'room';
    ${W('fhi', 2, 'ra', A(ma(U(), '履歴満ち')))}`)}

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
`;

const mkSql = (prefix = '') => `do ${q('wt')} declare res jsonb := '{}'; r jsonb; cx jsonb; i int; nm text; arr jsonb; v_no text;
  ra uuid; rb uuid; rc uuid; re uuid; rf uuid; rz uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
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
  const rejNyu = { ...none, ur: 1, u: 1, rn1m: 1, all1m: 1, rn: 0, uk: 0, rk: 0, all1d: 0 };
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
  ok('① 入の書き込みは ur・u・rn1m・all1m に 4・rn1d に 4・管の数えは 0', has('m4', { ur: 4, u: 4, rn1m: 4, all1m: 4, rn: 4, uk: 0, rk: 0, all1d: 4 }), J(d('m4')));
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
  ok('② 12個の外の22個は全部 not_yet（i:0）', Object.keys(ny).length === 22 && Object.values(ny).every((r) => r.ok === false && r.err === 'not_yet' && r.i === 0), J(ny));
  ok('② 31個 → too_many', isErr('many', 'too_many'), J(R('many')));
  ok('② 知らない op → bad・配列でない → bad', isErr('fooop', 'bad', { at: 'op' }) && isErr('notarr', 'bad', { what: 'ops' }), J([R('fooop'), R('notarr')]));
  /* ③ */
  ok('③ cells 200,100 → range', isErr('r1', 'range', { at: 'value' }) && has('r1', rejNyu), J([R('r1'), d('r1')]));
  ok('③ top のルールで kyotaku 1000 → range', isErr('r2', 'range'), J(R('r2')));
  ok('③ kieru で 1000 → ok（版 +1）', isOk('r3') && out.r3_row?.lost === 1000 && out.r3_row.v === 2, J([R('r3'), out.r3_row]));
  ok('③ kieru で 100 → range', isErr('r4', 'range'), J(R('r4')));
  ok('③ extra の合計 1001 → range', isErr('r5', 'range', { at: 'add' }), J(R('r5')));
  ok('③ top のルールで lost 1000 の hanchan_start → range', isErr('r6', 'range', { at: 'lost' }), J(R('r6')));
  ok('③ 100 の倍数でない cells → range', isErr('r7', 'range', { at: 'cells' }), J(R('r7')));
  ok('③ seats の重なり → bad', isErr('r8', 'bad', { at: 'seats' }), J(R('r8')));
  ok('③ rate 15・0・100,010 → range at rate', ['rr1', 'rr2', 'rr3'].every((k) => isErr(k, 'range', { at: 'rate' })) && has('rr1', rejNyu), J(['rr1', 'rr2', 'rr3'].map(R)));
  ok('③ date 2026-02-30・2026/11/20 → bad at date', isErr('rd1', 'bad', { at: 'date' }) && isErr('rd2', 'bad', { at: 'date' }), J([R('rd1'), R('rd2')]));
  ok('③ place 41字 → bad at place', isErr('rpl', 'bad', { at: 'place' }), J(R('rpl')));
  ok('③ label 空白だけ・21字 → bad at label', isErr('rl1', 'bad', { at: 'label' }) && isErr('rl2', 'bad', { at: 'label' }), J([R('rl1'), R('rl2')]));
  ok('③ name 21字・空白だけ → bad at name', isErr('rn1', 'bad', { at: 'name' }) && isErr('rn2', 'bad', { at: 'name' }), J([R('rn1'), R('rn2')]));
  ok('③ settle_snap rev 0 → bad at rev・32KB 越え → range at size', isErr('rs0', 'bad', { at: 'rev' }) && isErr('rsz', 'range', { at: 'size' }) && has('rsz', rejNyu), J([R('rs0'), R('rsz'), d('rsz')]));
  ok('③ 通る端：rate 10・100,000・place 40字 → ok', isOk('re1') && isOk('re2'), J([R('re1'), R('re2'), out.re_err]));
  ok('③ 通る端：label 20字・name 20字 → ok', isOk('re3') && isOk('re4'), J([R('re3'), R('re4'), out.re_err]));
  ok('③ 通る端：settle_snap ちょうど 32,768 → ok・1 越え → range at size', out.re5_len === 32768 && isOk('re5') && isErr('re6', 'range', { at: 'size' }), J([out.re5_len, R('re5'), R('re6'), out.re_err]));
  /* ③' */
  ok("③' 取り消した開催日に table_add → bad at session_id", isErr('vs1', 'bad', { at: 'session_id' }) && has('vs1', rejNyu), J([R('vs1'), d('vs1'), out.vs_err]));
  ok("③' 取り消した卓に hanchan_start → bad at table_id", isErr('vt1', 'bad', { at: 'table_id' }), J([R('vt1'), out.vt_err]));
  ok("③' リーグの日：table_add・cell_set・extra_add・settle_snap → not_yet at league", ['lg1', 'lg2', 'lg3', 'lg4'].every((k) => isErr(k, 'not_yet', { at: 'league' })) && has('lg2', rejNyu),
    J([...['lg1', 'lg2', 'lg3', 'lg4'].map(R), out.lgd_err]));
  /* ④ */
  ok('④ 古い版 → conflict と cur（値・版）', isErr('v1', 'conflict', { cur: { value: 30000, version: 1 } }) && has('v1', rejNyu), J([R('v1'), d('v1')]));
  ok('④ void の後の kyotaku_set の古い版 → conflict（hanchans.version）', isOk('v2') && isErr('v3', 'conflict', { cur: { value: 1000, version: 3 } }), J([R('v2'), R('v3'), out.vv_err]));
  ok('④ 同値は ok・履歴0・op_results 0', isOk('v4') && has('v4', none), J([R('v4'), d('v4')]));
  ok('④ settle_snap 同じ rev 同じ中身 → ok・書かない', isOk('v5') && has('v5', none), J([R('v5'), d('v5')]));
  ok('④ settle_snap 同じ rev 違う中身 → conflict', isErr('v6', 'conflict'), J(R('v6')));
  ok('④ settle_snap 飛んだ rev → conflict', isErr('v7', 'conflict', { cur: { value: 1, version: 1 } }), J(R('v7')));
  ok('④ settle_snap rev2（missing は一覧）→ ok', isOk('v8'), J(R('v8')));
  /* ⑤ */
  ok('⑤ 飛んだ席の鍵が無い → input tobi', out.ts_row?.state === 'input' && out.ts_row.why === 'tobi', J([R('ts'), out.ts_row]));
  ok('⑤ tobi_set で入れて ok（tobi_version 2）', isOk('tset') && out.tset_row?.state === 'ok' && out.tset_row.tv === 2, J([R('tset'), out.tset_row]));
  ok('⑤ 飛んでいない席の鍵も弾かず入る（そろったは ok のまま）', isOk('tnb') && J(out.tnb_row?.tobi) === J({ 1: 2, 3: 0 }) && out.tnb_row.state === 'ok', J([R('tnb'), out.tnb_row]));
  ok('⑤ tobi_set の古い版 → conflict（what tobi・cur は今の tobi_to と版）・何も書かない', isErr('tcf', 'conflict', { at: { what: 'tobi', hanchan_id: HA2 }, cur: { value: out.tnb_row?.tobi, version: out.tnb_row?.tv } })
    && has('tcf', rejNyu), J([R('tcf'), d('tcf')]));
  ok('⑤ 自分の席・players 外・null・配列 → bad（mj_tobi_ok）', ['tself', 'tout', 'tnull', 'tarr'].every((k) => isErr(k, 'bad', { at: 'tobi_to' })), J(['tself', 'tout', 'tnull', 'tarr'].map(R)));
  ok('⑤ 点を直して飛ばなくなる → 鍵は残る・ok', isOk('tun') && J(out.tun_row?.tobi) === J({ 1: 2, 3: 0 }) && out.tun_row.state === 'ok', J([R('tun'), out.tun_row]));
  ok('⑤ また飛ぶ（tobi_set 無しの組）→ 鍵が消えて input tobi・tobi_version+1・履歴に tobi_auto', isOk('tre') && J(out.tre_row?.tobi) === J({ 1: 2 })
    && out.tre_row.state === 'input' && out.tre_row.why === 'tobi' && out.tre_row.tv === out.tun_row.tv + 1 && has('tre', { hc: 3 }), J([R('tre'), out.tre_row, d('tre')]));
  ok('⑤ 同じ組に tobi_set が在れば消さない', isOk('tk') && isOk('tre2') && J(out.tre2_row?.tobi) === J({ 1: 2, 3: 1 }) && out.tre2_row.state === 'ok', J([R('tre2'), out.tre2_row]));
  ok('⑤ 表へ直に配列・自分の席 → 23514・"all" は通る', out.d_arr === '23514' && out.d_self === '23514' && out.d_ok === 'none', J([out.d_arr, out.d_self, out.d_ok]));
  ok('⑤ mj_tobi_ok：配列 false・null false・{"0":1,"2":"all"} true・3人で受け取り3 false', out.fn_arr === false && out.fn_null === false && out.fn_ok === true && out.fn_3p === false,
    J([out.fn_arr, out.fn_null, out.fn_ok, out.fn_3p]));
  ok('⑤ tobi_from all のルールでは鍵無しで ok', out.hc_all?.state === 'ok', J(out.hc_all));
  /* ⑥ */
  ok('⑥ ok の半荘を cell_set → changed_after_complete_at・changed_by_user', out.c1_row?.ch === true && out.c1_row.cb === u[1], J(out.c1_row));
  ok('⑥ void → voided・版+1・changed', isOk('vo1') && out.vo1_row?.voided === true && out.vo1_row.ch === true, J([R('vo1'), out.vo1_row, out.vo_err]));
  ok('⑥ 同値の void は書かない', isOk('vo2') && has('vo2', none), J([R('vo2'), d('vo2')]));
  ok('⑥ unvoid → 戻る・そろったを出し直す', isOk('vo3') && out.vo3_row?.voided === false && out.vo3_row.state === 'ok', J([R('vo3'), out.vo3_row]));
  /* ⑦ */
  ok('⑦ 4部屋の用意と extras → ok', ['k_a', 'k_c', 'k_e', 'k_f', 'kx_ra', 'kx_rc', 'kx_re', 'kx_rf'].every((k) => isOk(k)), J(['k_a', 'k_c', 'k_e', 'k_f', 'kx_ra', 'kx_rc', 'kx_re', 'kx_rf'].map(R)));
  CASES.forEach((c, i) => {
    const db = out['case' + i] ? [out['case' + i].c, out['case' + i].s, out['case' + i].e] : null;
    ok(`⑦ ${c[0]}：倉庫 ${J(db)} ＝ 手の答え ${J(c[8])}`, J(db) === J(c[8]));
    if (lib.mod) { const lv = libCase(lib.mod, c); ok(`⑦ ${c[0]}：lib ${J(lv)} ＝ 倉庫`, J(lv) === J(db)); }
  });
  ok('⑦ lib（画面の room-state.mjs）を読めた' + (lib.where ? '（' + lib.where + '）' : ''), !!lib.mod, lib.err || '');
  ok('⑦ 倉庫だけの守り：chip_pt10 の鍵が無い → 使う側（+1 で ng）', isOk('kf1') && out.kf1_row?.c === 'ng', J([R('kf1'), out.kf1_row, out.kf_err]));
  /* ⑧ */
  const busyD = { ...none, ur: 1, u: 1, rn1m: 1, all1m: 1, rn: 0, all1d: 0 };
  ok('⑧ 先見の busy（ur1m 120）→ busy・何も書かない・ur1m は +1・rn1d は 0', isErr('b1', 'busy', { what: 'write:ur1m' }) && has('b1', busyD), J([R('b1'), d('b1')]));
  ok('⑧ 後見の busy（rn1d 2999＋2行）→ busy・何も書かない・ur1m +1・rn1d 0', isErr('b2', 'busy', { what: 'write:rn1d' }) && has('b2', busyD), J([R('b2'), d('b2')]));
  ok('⑧ 入で rn1d が満ちても管は書ける', isErr('b3n', 'busy', { what: 'write:rn1d' }) && isOk('b3k'), J([R('b3n'), R('b3k')]));
  ok('⑧ 管の rk1d が満ちても入は書ける', isErr('b4k', 'busy', { what: 'write:rk1d' }) && isOk('b4n'), J([R('b4k'), R('b4n')]));
  ok('⑧ 古い窓は書いた時に消える', isOk('bo') && Number(out.bo_left) === 0, J([R('bo'), out.bo_left, out.bo_err]));
  ok('⑧ 同値だけの組 → ok・op_results 0・分は +1・rn1d 0', isOk('sv') && has('sv', { ...none, ur: 1, rn: 0 }), J(d('sv')));
  ok('⑧ 入の1行 → ur・u・rn1m・all1m・rn1d・all1d に +1・uk・rk 0', isOk('okn') && has('okn', { ur: 1, u: 1, rn1m: 1, all1m: 1, rn: 1, all1d: 1, uk: 0, rk: 0, op: 1 }), J(d('okn')));
  ok('⑧ 管の1行 → uk・rk に +1・rn1m・rn1d 0', isOk('okk') && has('okk', { ur: 1, u: 1, rn1m: 0, rn: 0, uk: 1, rk: 1, all1d: 1 }), J(d('okk')));
  ok('⑧ 持ち主の1行 → 管と同じ（uk・rk）', isOk('oko') && has('oko', { rn: 0, uk: 1, rk: 1 }), J(d('oko')));
  ok('⑧ 例外（P0001）→ internal・何も書かない・ur1m +1', isErr('ie_P0001', 'internal') && has('ie_P0001', busyD), J([R('ie_P0001'), d('ie_P0001'), out.ie_err]));
  ['55P03', '40P01', '40001'].forEach((c) => ok(`⑧ 一時の失敗（${c}）→ busy lock・何も書かない・ur1m +1・rn1d 0`, isErr('ie_' + c, 'busy', { what: 'lock' }) && has('ie_' + c, busyD), J([R('ie_' + c), d('ie_' + c)])));
  /* ⑧' */
  ok("⑧' members が上限 → full members・何も書かない", isErr('fm', 'full', { what: 'members' }) && has('fm', busyD), J([R('fm'), d('fm'), out.fm_err]));
  ok("⑧' tables（開催日ごと）が上限 → full tables", isErr('ft', 'full', { what: 'tables' }), J([R('ft'), out.ft_err]));
  ok("⑧' hanchans（卓ごと）が上限 → full hanchans", isErr('fh', 'full', { what: 'hanchans' }), J([R('fh'), out.fh_err]));
  ok("⑧' sessions が上限 → full sessions", isErr('fs', 'full', { what: 'sessions' }), J([R('fs'), out.fs_err]));
  ok("⑧' P（部屋の行）が上限 → full *", isErr('fp', 'full', { what: '*' }), J([R('fp'), out.fp_err]));
  ok("⑧' mj_caps の行が無い → full", isErr('fn', 'full', { what: 'members' }), J([R('fn'), out.fn_err]));
  ok("⑧' op_results が上限を越えると古い物が消える（full にならない）", isOk('fo1') && isOk('fo2') && Number(out.fo2_c1?.op) === 1, J([R('fo2'), out.fo2_c1, out.fo_err]));
  ok("⑧' op_results は at の古い物から消す（op_id の順でない）・今の組は残る", ['fq1', 'fq2', 'fq3'].every(isOk) && J(out.fq_left) === J([OPQ1, OPQ3].sort()), J([out.fq_left, out.fq_err]));
  ok("⑧' history（F）が上限 → full history・何も書かない", isErr('fhi', 'full', { what: 'history' }) && has('fhi', busyD), J([R('fhi'), d('fhi'), out.fhi_err]));
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
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('end $fn$;', a);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + 'end $fn$;'.length);
};
/* [名, 関数, 壊す字, 替える字, 2つ目の替え（無ければ null）, 狙った試験の名の頭] */
const WAZA = [
  ['op_results を書かない', 'public.mj_write', 'insert into mahjong.op_results (room_id, op_id, result, user_id) values (p_room_id, p_op_id, v_ret, v_me);', 'null;', null, '⑨ 同じ人の同じ op_id 2回'],
  ['卓の部屋を確かめない', 'mahjong_private.mj_w_t', 'where x.id = p_tid and x.room_id = p_room for update', 'where x.id = p_tid for update', null, '② 別の部屋の table_id'],
  ['MJ001 を値に直さない（internal に化ける）', 'public.mj_write', 'v_ret := sqlerrm::jsonb; v_n := 0;', "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0;", null, '② 別の部屋の hanchan_id'],
  ['limits を塊の中で数える（弾きで戻る）', 'public.mj_write', "    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);",
    "    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_n);\n    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);", ['  perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_n);\n  return v_ret;', '  return v_ret;'], '⑧ 後見の busy'],
  ['mj_tobi_ok が受け取りの席を見ない', 'mahjong_private.mj_tobi_ok', 'if x % 1 <> 0 or x < 0 or x >= p_players or x = k then return false; end if;', 'null;', null, '⑤ 自分の席・players 外'],
  ['チップの式（合計0でなくても ok）', 'mahjong_private.mj_w_tstate', "when v_c = 0 then 'ok'", "when v_c >= 0 then 'ok'", null, '⑦ c4 チップ +1 だけ（祝儀は使わない）：倉庫'],
  ['mj_caps を見ない', 'public.mj_write', 'if v_cap is null or v_c > v_cap then', 'if false then', null, "⑧' members が上限"],
  ['一時の失敗を busy にしない', 'public.mj_write', "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'lock'); v_n := 0;", "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0;", null, '⑧ 一時の失敗（55P03）'],
  ['並びの顔ぶれを比べない（p_set）', 'mahjong_private.mj_w_people', '  elsif (select pg_catalog.array_agg((t.v', '  elsif false and (select pg_catalog.array_agg((t.v', null, "①' hanchan_order に席にいない人"],
  ['op_results を op_id の順で消す', 'public.mj_write', 'order by o.at, o.op_id limit v_c - v_cap', 'order by o.op_id limit v_c - v_cap', null, "⑧' op_results は at の古い物から消す"],
  ['extra_add が席を見ない', 'mahjong_private.mj_w_op', '    if not exists (select 1 from mahjong.hanchans x where x.table_id = t.id and not x.voided', '    if false and not exists (select 1 from mahjong.hanchans x where x.table_id = t.id and not x.voided', null, "①' extra_add：部屋の人だがその卓の席にも行にもいない"],
  ['取り消した開催日を見ない', 'mahjong_private.mj_w_op', 'if s.voided then', 'if false then', null, "③' 取り消した開催日に table_add"],
  ['リーグの日を見ない（卓から）', 'mahjong_private.mj_w_t', 's.league_id is not null) then', 'false) then', null, "③' リーグの日"],
  ['履歴の上限（F）を見ない', 'public.mj_write', 'if v_cap is null or r.history_count + v_n > v_cap then', 'if false then', null, "⑧' history（F）が上限"],
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
    if (!b0 || b0.f > 0) {
      console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base.err || bl.filter((s) => s.startsWith('  ✗')).slice(0, 5).join(' ／ ')));
      exit = 1;
    } else {
      console.log(`  素の回り：${b0.p} passed, 0 failed（緑）`);
      for (const [name, fn, from, to, extra, want] of WAZA) {
        let t = fnText(fn);
        if (!t.includes(from)) { console.log(`  ✗ 壊す字が無い（${name}）`); exit = 1; continue; }
        t = t.split(from).join(to);
        if (extra) { if (!t.includes(extra[0])) { console.log(`  ✗ 壊す字が無い（${name}・2つ目）`); exit = 1; continue; } t = t.split(extra[0]).join(extra[1]); }
        if (!bl.some((s) => s.startsWith('  ✓ ' + want))) { console.log(`  ✗ ${name}：狙った試験「${want}」が素の回りに無い`); exit = 1; continue; }
        const r = await runSql(mkSql(t));
        if (r.err) { console.log(`  ✗ ${name}：塊が回らなかった ${r.err.slice(0, 300)}`); exit = 1; continue; }
        const lines = [];
        const { f } = check(r.out, lib, (s) => lines.push(s));
        const hit = lines.filter((s) => s.startsWith('  ✗ ' + want));
        if (hit.length) { red++; console.log(`  ✓ ${name} → 狙いが赤（${hit[0].trim().slice(0, 90)}）・赤は全部で ${f}`); }
        else { console.log(`  ✗ ${name} → 狙った試験「${want}」が赤にならない（全部の赤 ${f}）`); exit = 1; }
      }
    }
    console.log(`
write --waza: ${red}/${WAZA.length} 狙いが赤になった`);
    if (red !== WAZA.length) exit = 1;
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
