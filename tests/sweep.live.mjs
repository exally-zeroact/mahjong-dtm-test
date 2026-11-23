/* sweep.live.mjs — ★ついでの掃除 mahjong_private.mj_sweep を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * 案 mahjong_tataki_2026-11-20/sweep_sekkei.md v1.2 の「試験」⓪〜⑧：
 *  ⓪ 権限＝anon・authenticated に EXECUTE 無し・definer・search_path 空・lock_timeout 50ms
 *  ⑦ ok でない返し（create の bad・join の wrong・bad）では古い行が消えない
 *  ① 古い limits（1m・1h・1d・u1d・sweep:* の境目の前後）・creates・op_results → join の ok で消える・内側は残る・知らない kind は残る
 *     1手順で p_max を超えない（150 入れて 100 → 50 残る）
 *  ② room_accounts：入 181日 消える／入 179日 残る／管 181日・持ち主 181日・L 181日 残る／members.user_id は残る
 *  ③ 空の部屋（段C v10.1 で ⓑ を止めた）：8日・半荘0・誰も来ない・小さい→★消えない★／昨日 last_seen→残る／半荘1→残る／子が p_max 超え→★印も付かない★
 *  ④-0 小さい消した部屋（rule_sets 2版を sessions・tables・hanchans が指す）が1回で消え、set constraints all immediate で赤0
 *  ④ 消して8日の大きい部屋を p_max 1〜13 で回し、毎回 set constraints all immediate → 赤0で減り最後に消える・rooms_all −1・消して6日は残る
 *  ⑤ totals を +3 ずらす→印の無い日に直る・同じ日の2回目は直さない
 *  ⑥ 落ちる部屋（history を消すと例外の trigger）→ create の ok が返る・sweep:bad の印・手順2〜4 は動く・次の呼びは飛ばして次の部屋を消す
 *  ④-1 版 105 の消した部屋＝1回目に消える版は p_max 以下・5回の内に消える
 *  ④-2 rule_set_id が null の消した部屋に版 105＝5回の内に消える（null の穴）
 *  ⑨ 1行も消せない大きい消した部屋（rule_sets の消しを trigger で空に）→ 2回目で mj_sweep_stuck・部屋は残り sweep:bad の印（raise を外すと赤＝確かめた）
 *  ⑧ 1回の掃除（p_max 100・④の部屋）の時間を clock_timestamp で測る
 * 数えは全部自分の行だけ（作った room_id・key が 'test:' の limits・作った op_id）。
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝仮の人・部屋・trigger も全部戻る）。
 * ★1つの取引では並べられない物（dblink 無し）＝見立て★：他の取引が持つ行を skip locked で飛ばす事・lock_timeout で塊を捨てる事。
 * 使い方: node tests/sweep.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { newToken, tokenHash } from '../lib/url-token.mjs';

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
const MAIL = 'mj-sweep.invalid';
const PASS = '2741';   // 段C：作るパスは数字4つ
const TOK = newToken();
const TOKH = await tokenHash(TOK);
const N_U = 6;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated')::text, true);`;
const SW = (n) => `perform mahjong_private.mj_sweep(${n});`;
const ALL = `(select rooms_all from mahjong.totals where id = 1)`;
const OLD = `'2000-01-01 00:00:00+00'::timestamptz`;

/* 部屋を直に作る（v＝部屋の変数・rs＝ルールの変数）。totals も +1（掃除の −1 を比べるため） */
const mkRoom = (v, rs, { created = OLD, deleted = 'null', seen = OLD } = {}) => `
  ${v} := gen_random_uuid(); ${rs} := gen_random_uuid();
  insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, rule_set_id, rule_version, created_at, deleted_at)
    values (${v}, 'sweep', lpad((floor(random() * 100000000))::bigint::text, 8, '0'), 'x', md5(random()::text) || md5(random()::text),
            us[1], md5(random()::text), null, null, ${created}, ${deleted});
  insert into mahjong.rule_sets (id, version, room_id, rules) values (${rs}, 1, ${v}, '{"players":4}');
  update mahjong.rooms set rule_set_id = ${rs}, rule_version = 1 where id = ${v};   -- 外部キーを先送りに頼らない（set constraints は塊を戻しても戻らない）
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via, joined_at, last_seen) values (${v}, us[1], 'kan', 'create', ${created}, ${seen});
  update mahjong.totals set rooms_all = rooms_all + 1 where id = 1;`;
/* 開催日1つ・卓1つ・半荘 n（各 cells 4）を版 ver で（s・t は変数） */
const mkPlay = (v, rs, ver, s, t, n, league = 'null') => `
  ${s} := gen_random_uuid(); ${t} := gen_random_uuid();
  insert into mahjong.sessions (id, room_id, league_id, date, rule_set_id, rule_version) values (${s}, ${v}, ${league}, current_date, ${rs}, ${ver});
  insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version) values (${t}, ${v}, ${s}, 'A', 4, ${rs}, ${ver});
  insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot)
    select gen_random_uuid(), ${v}, ${t}, 4, '{}'::jsonb, ${rs}, ${ver}, '{"players":4}'::jsonb from generate_series(1, ${n});
  insert into mahjong.cells (hanchan_id, seat, value) select h.id, k, 0 from mahjong.hanchans h, generate_series(0, 3) k where h.table_id = ${t};`;
/* 大きい部屋の子（④・⑧） */
const bigKids = (v, rs) => `
  insert into mahjong.rule_sets (id, version, room_id, rules) values (${rs}, 2, ${v}, '{"players":4}'), (${rs}, 3, ${v}, '{"players":4}');
  lg := gen_random_uuid();
  insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id) values (lg, ${v}, 'L', ${rs}, 2, us[1]);
  ${mkPlay(v, rs, 1, 's1', 't1', 15)}
  ${mkPlay(v, rs, 3, 's2', 't2', 15, 'lg')}
  insert into mahjong.tobi (hanchan_id, busted_seat, receiver) select h.id, 0, 1 from mahjong.hanchans h where h.table_id = t2 limit 5;
  insert into mahjong.members (room_id, name, name_key) select ${v}, 'm' || k, 'm' || k from generate_series(1, 4) k;
  insert into mahjong.extras (table_id, member_id, kind, value) select t1, m.id, 'chip', 1 from mahjong.members m where m.room_id = ${v};
  insert into mahjong.history (room_id, group_id, op, actor_user_id, actor_role) select ${v}, gen_random_uuid(), 'x', us[1], 'kan' from generate_series(1, 250);
  insert into mahjong.op_results (room_id, op_id, result, user_id) select ${v}, gen_random_uuid(), '{}'::jsonb, us[1] from generate_series(1, 5);
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) select ${v}, us[k], 'nyu', 'pass' from generate_series(2, 4) k;
  insert into mahjong.room_bans (room_id, user_id) values (${v}, us[5]);
  insert into mahjong.member_claims (room_id, member_id, user_id) select ${v}, m.id, us[k] from mahjong.members m, generate_series(2, 3) k where m.room_id = ${v};   -- 名乗り 8行（2c-2b N1）
  insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values (${v}, s1, 1, '{}', '{}', '[]');`;
/* 部屋に残っている子の数 */
const KIDS = (v) => `(select count(*) from mahjong.history where room_id = ${v}) + (select count(*) from mahjong.hanchans where room_id = ${v})
  + (select count(*) from mahjong.sessions where room_id = ${v}) + (select count(*) from mahjong.members where room_id = ${v})
  + (select count(*) from mahjong.rule_sets where room_id = ${v}) + (select count(*) from mahjong.room_accounts where room_id = ${v})
  + (select count(*) from mahjong.member_claims where room_id = ${v})`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
/* 古い行（①・⑦）：[名, kind, 戻す時間, 消えるか] */
const LIM = [
  ['1m 11分前', 'create:1m', '11 minutes', true], ['1m 9分前', 'create:1m', '9 minutes', false],
  ['ufail1m 11分前', 'join:ufail1m', '11 minutes', true],
  ['1h 121分前', 'join:ok1h', '121 minutes', true], ['1h 119分前', 'join:ok1h', '119 minutes', false],
  ['1d 49時間前', 'create:1d', '49 hours', true], ['1d 47時間前', 'create:1d', '47 hours', false],
  ['u1d 49時間前', 'create:u1d', '49 hours', true], ['u1d 47時間前', 'create:u1d', '47 hours', false],
  ['sweep:bad 49時間前', 'sweep:bad', '49 hours', true], ['sweep:bad 47時間前', 'sweep:bad', '47 hours', false],
  ['write:ur1m 11分前', 'write:ur1m', '11 minutes', true], ['write:ur1m 9分前', 'write:ur1m', '9 minutes', false],
  ['write:rn1d 49時間前', 'write:rn1d', '49 hours', true], ['write:uk1d 47時間前', 'write:uk1d', '47 hours', false],
  ['write:un1d 49時間前', 'write:un1d', '49 hours', true], ['write:u1d 49時間前', 'write:u1d', '49 hours', true], ['write:u1d 47時間前', 'write:u1d', '47 hours', false],
  ['知らない kind 26年前', 'test:zz', '9500 days', false],
];
const LIMV = LIM.map(([, k, ago], i) => `('${k}', 'test:l${i}', now() - interval '${ago}', 1)`).join(', ');
const LIMC = `(select jsonb_agg(l.key order by l.key) from mahjong.limits l where l.key like 'test:l%')`;
const OPS = { c49: crypto.randomUUID(), c47: crypto.randomUUID(), o8: crypto.randomUUID(), o6: crypto.randomUUID() };
const OLDC = `jsonb_build_object('lim', ${LIMC},
  'c49', exists (select 1 from mahjong.creates where op_id = '${OPS.c49}'), 'c47', exists (select 1 from mahjong.creates where op_id = '${OPS.c47}'),
  'o8', exists (select 1 from mahjong.op_results where op_id = '${OPS.o8}'), 'o6', exists (select 1 from mahjong.op_results where op_id = '${OPS.o6}'))`;

const sql = `do ${q('sw')} declare res jsonb := '{}'; r jsonb; i int; kc int; n int; t0 timestamptz; a0 int; e text;
  us uuid[] := '{}'; ss uuid[] := '{}'; r0 uuid; v uuid; rs uuid; v2 uuid; rs2 uuid; s1 uuid; s2 uuid; t1 uuid; t2 uuid; lg uuid; m uuid; ms float8[] := '{}';
begin
  /* khaw の前から在る古い行を先に掃く（掃除は ok の返しでも走る＝自分の行の数えが揺れない・塊の最後で全部戻る） */
  for i in 1..50 loop perform mahjong_private.mj_sweep(1000000); end loop;
  res := res || jsonb_build_object('others_left', (select count(*) from mahjong.rooms x where x.deleted_at < now() - interval '7 days'));   -- 段C v10.1：掃除は ⓐ だけ
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous)
    select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;
  /* ⓪ */
  res := res || jsonb_build_object('priv', (select jsonb_build_object('anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'public', exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0),
      'definer', p.prosecdef, 'config', p.proconfig)
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'mahjong_private' and p.proname = 'mj_sweep'));
  /* 部屋 R0（人 1 が作る＝今の部屋・掃除の対象でない） */
  ${asWho(1)}
  r := public.mj_room_create(gen_random_uuid(), ${lit('掃除の試験')}, ${lit(PASS)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${lit(TOKH)}));
  res := res || jsonb_build_object('made', r);
  r0 := (r->>'room_id')::uuid;
  /* 古い行を入れる */
  insert into mahjong.limits (kind, key, window_start, count) values ${LIMV};
  insert into mahjong.creates (op_id, room_id, user_id, at) values ('${OPS.c49}', r0, us[1], now() - interval '49 hours'), ('${OPS.c47}', r0, us[1], now() - interval '47 hours');
  insert into mahjong.op_results (room_id, op_id, result, user_id, at) values (r0, '${OPS.o8}', '{}', us[1], now() - interval '8 days'), (r0, '${OPS.o6}', '{}', us[1], now() - interval '6 days');
  res := res || jsonb_build_object('old0', ${OLDC});
  /* ⑦ ok でない返し */
  r := public.mj_room_create(null, ${lit('甲')}, ${lit(PASS)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', md5('a') || md5('b')));
  res := res || jsonb_build_object('n_bad', r);
  ${asWho(2)}
  r := public.mj_room_join('url', null, ${lit(newToken())}, null); res := res || jsonb_build_object('n_wrong', r);
  r := public.mj_room_join('zzz', null, null, null); res := res || jsonb_build_object('n_way', r);
  res := res || jsonb_build_object('old_n', ${OLDC});
  /* ① join の ok で消える */
  r := public.mj_room_join('url', null, ${lit(TOK)}, null); res := res || jsonb_build_object('j_ok', r);
  res := res || jsonb_build_object('old1', ${OLDC});
  /* ① p_max：150 入れて 100 */
  insert into mahjong.limits (kind, key, window_start, count) select 'create:1m', 'test:p' || k, now() - interval '1 hour', 1 from generate_series(1, 150) k;
  ${SW(100)}
  res := res || jsonb_build_object('p1', (select count(*) from mahjong.limits where key like 'test:p%'));
  ${SW(100)}
  res := res || jsonb_build_object('p2', (select count(*) from mahjong.limits where key like 'test:p%'));
  /* ② room_accounts の 180日（R0） */
  m := gen_random_uuid();
  insert into mahjong.members (id, room_id, name, name_key, user_id) values (m, r0, '乙', '乙', us[2]);
  update mahjong.room_accounts set last_seen = now() - interval '181 days', member_id = m where room_id = r0 and user_id = us[2];
  update mahjong.room_accounts set role = 'nyu', last_seen = now() - interval '181 days' where room_id = r0 and user_id = us[1];
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via, last_seen) values
    (r0, us[3], 'kan', 'pass', now() - interval '181 days'), (r0, us[4], 'nyu', 'pass', now() - interval '179 days'),
    (r0, us[5], 'nyu', 'pass', now() - interval '181 days');
  insert into mahjong.leagues (room_id, name, rule_set_id, rule_version, owner_user_id) values (r0, 'L', gen_random_uuid(), 1, us[5]);
  ${SW(100)}
  res := res || jsonb_build_object('ra', (select jsonb_object_agg(k, exists (select 1 from mahjong.room_accounts a where a.room_id = r0 and a.user_id = us[k])) from generate_series(1, 5) k),
    'ra_member', (select user_id = us[2] from mahjong.members where id = m));
  /* ③ 空の部屋 */
  ${undo('e1', `${mkRoom('v', 'rs')} a0 := ${ALL}; ${SW(100)}
    res := res || jsonb_build_object('e1', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'rs', exists (select 1 from mahjong.rule_sets where room_id = v), 'all', ${ALL} - a0));`)}
  ${undo('e2', `${mkRoom('v', 'rs', { seen: "now() - interval '1 day'" })} a0 := ${ALL}; ${SW(100)}
    res := res || jsonb_build_object('e2', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'del', (select deleted_at is not null from mahjong.rooms where id = v), 'all', ${ALL} - a0));`)}
  ${undo('e3', `${mkRoom('v', 'rs')} ${mkPlay('v', 'rs', 1, 's1', 't1', 1)} a0 := ${ALL}; ${SW(100)}
    res := res || jsonb_build_object('e3', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'del', (select deleted_at is not null from mahjong.rooms where id = v), 'all', ${ALL} - a0));`)}
  ${undo('e4', `${mkRoom('v', 'rs')} insert into mahjong.members (room_id, name, name_key) select v, 'm' || k, 'm' || k from generate_series(1, 5) k;
    a0 := ${ALL}; ${SW(3)}
    res := res || jsonb_build_object('e4', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'del', (select deleted_at is not null from mahjong.rooms where id = v), 'all', ${ALL} - a0, 'kids', ${KIDS('v')}));`)}
  /* ⑥ 落ちる部屋（★④ の set constraints より前に＝immediate は塊を戻しても残り、create の部屋の先送りの外部キーが落ちる★）（history を消すと例外）→ create の ok・印・手順2〜4 は動く・次は飛ばす */
  ${undo('bad', `create function mahjong_private.mj_test_boom() returns trigger language plpgsql as ${q('bm')} begin raise exception 'boom'; end ${q('bm')};
    create trigger mj_test_boom before delete on mahjong.history for each row execute function mahjong_private.mj_test_boom();
    ${mkRoom('v', 'rs', { deleted: "now() - interval '9 days'" })}
    insert into mahjong.history (room_id, group_id, op, actor_user_id, actor_role) values (v, gen_random_uuid(), 'x', us[1], 'kan');
    ${mkRoom('v2', 'rs2', { deleted: "now() - interval '8 days'" })}
    insert into mahjong.limits (kind, key, window_start, count) values ('create:1m', 'test:b', now() - interval '1 hour', 1);
    ${asWho(6)}
    r := public.mj_room_create(gen_random_uuid(), ${lit('乙')}, ${lit(PASS)}, '{"players":3}'::jsonb, jsonb_build_object('url_token_hash', md5('c') || md5(random()::text)));
    res := res || jsonb_build_object('bad', jsonb_build_object('ret', r, 'room', exists (select 1 from mahjong.rooms where id = v),
      'mark', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text and window_start = date_trunc('day', now())),
      'step3', exists (select 1 from mahjong.limits where key = 'test:b'), 'v2_1', exists (select 1 from mahjong.rooms where id = v2)));
    ${SW(100)}
    res := res || jsonb_build_object('bad2', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'v2', exists (select 1 from mahjong.rooms where id = v2)));`)}
  /* ⑨ 1行も消せない大きい消した部屋（rule_sets の消しを trigger で空にする）→ 2回目の呼びで mj_sweep_stuck・部屋は残り sweep:bad の印（taiketsu-naoshi 直し） */
  ${undo('stk', `create function mahjong_private.mj_test_skip() returns trigger language plpgsql as ${q('sk')} begin return null; end ${q('sk')};
    create trigger mj_test_skip before delete on mahjong.rule_sets for each row execute function mahjong_private.mj_test_skip();
    ${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })}
    insert into mahjong.rule_sets (id, version, room_id, rules) select rs, k, v, '{"players":4}' from generate_series(2, 105) k;
    ${SW(100)}
    res := res || jsonb_build_object('stk1', jsonb_build_object('mark', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text and window_start = date_trunc('day', now())),
      'ra', (select count(*) from mahjong.room_accounts where room_id = v)));
    ${SW(100)}
    res := res || jsonb_build_object('stk', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'rs', (select count(*) from mahjong.rule_sets where room_id = v),
      'mark', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text and window_start = date_trunc('day', now()))));`)}
  /* ④-2 ルールを指さない（rule_set_id null）消した部屋に版 105＝5回の内に消える（not null の穴・taiketsu-naoshi 直し） */
  ${undo('rvn', `${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })}
    update mahjong.rooms set rule_set_id = null, rule_version = null where id = v;
    insert into mahjong.rule_sets (id, version, room_id, rules) select rs, k, v, '{"players":4}' from generate_series(2, 105) k;
    a0 := ${ALL}; for i in 1..5 loop ${SW(100)} end loop;
    res := res || jsonb_build_object('rvn', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'all', ${ALL} - a0,
      'bad', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text)));`)}
  /* ④-1 ルールの版が p_max を超える消した部屋（taiketsu 止め S1）＝p_max 100 固定で 5回の内に消えるか・詰まれば sweep:bad */
  ${undo('rv', `${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })}
    insert into mahjong.rule_sets (id, version, room_id, rules) select rs, k, v, '{"players":4}' from generate_series(2, 105) k;
    a0 := ${ALL}; n := (select count(*) from mahjong.rule_sets where room_id = v); ${SW(100)}
    kc := n - (select count(*) from mahjong.rule_sets where room_id = v);
    for i in 2..5 loop ${SW(100)} end loop;
    res := res || jsonb_build_object('rv', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'all', ${ALL} - a0, 'first', kc,
      'bad', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text)));`)}
  /* ④-0 小さい消した部屋（2版を sessions・tables・hanchans が指す） */
  ${undo('s0', `${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })}
    insert into mahjong.rule_sets (id, version, room_id, rules) values (rs, 2, v, '{"players":4}');
    ${mkPlay('v', 'rs', 1, 's1', 't1', 2)} ${mkPlay('v', 'rs', 2, 's2', 't2', 2)}
    insert into mahjong.members (id, room_id, name, name_key) values (gen_random_uuid(), v, 'c', 'c');
    insert into mahjong.member_claims (room_id, member_id, user_id) select v, m.id, us[2] from mahjong.members m where m.room_id = v;   -- 名乗り1行（2c-2b N1 の 1-a）
    a0 := ${ALL}; ${SW(100)}
    begin set constraints all immediate; e := 'ok'; exception when others then e := sqlerrm; end; set constraints all deferred;
    res := res || jsonb_build_object('s0', jsonb_build_object('room', exists (select 1 from mahjong.rooms where id = v), 'rs', (select count(*) from mahjong.rule_sets where room_id = v),
      'han', (select count(*) from mahjong.hanchans where room_id = v), 'all', ${ALL} - a0, 'fk', e, 'cl', (select count(*) from mahjong.member_claims where room_id = v)));`)}
  /* ④ 大きい消した部屋を p_max 1〜13 で回す・消して6日の部屋は触らない */
  ${undo('big', `${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })} ${bigKids('v', 'rs')}
    ${mkRoom('v2', 'rs2', { deleted: "now() - interval '6 days'" })}
    a0 := ${ALL}; n := ${KIDS('v')}; kc := 0; e := 'ok';
    loop
      kc := kc + 1;
      perform mahjong_private.mj_sweep(1 + kc % 13);
      begin set constraints all immediate; exception when others then e := 'call ' || kc || ': ' || sqlerrm; end; set constraints all deferred;
      exit when e <> 'ok' or not exists (select 1 from mahjong.rooms where id = v) or kc >= 3000;
    end loop;
    res := res || jsonb_build_object('big', jsonb_build_object('kids0', n, 'calls', kc, 'fk', e, 'room', exists (select 1 from mahjong.rooms where id = v),
      'bad', exists (select 1 from mahjong.limits where kind = 'sweep:bad' and key = v::text), 'all', ${ALL} - a0,
      'd6', exists (select 1 from mahjong.rooms where id = v2), 'd6kids', ${KIDS('v2')}, 'cl0', (select count(*) from mahjong.member_claims where room_id = v) = 0));`)}
  /* ⑧ 1回の時間（p_max 100・④の部屋・5回の各々） */
  ${undo('tm', `${mkRoom('v', 'rs', { deleted: "now() - interval '8 days'" })} ${bigKids('v', 'rs')}
    for i in 1..5 loop t0 := clock_timestamp(); ${SW(100)} ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::float8; end loop;
    res := res || jsonb_build_object('tm', to_jsonb(ms), 'tm_kids', ${KIDS('v')});`)}
  /* ⑤ totals の数え直し */
  ${undo('tot', `delete from mahjong.limits where kind = 'sweep:recount' and window_start = date_trunc('day', now());
    update mahjong.totals set rooms_all = rooms_all + 3 where id = 1;
    ${SW(100)}
    res := res || jsonb_build_object('tot1', ${ALL} - (select count(*) from mahjong.rooms where kind = 'shared' and closed_at is null));   -- 段C の式
    update mahjong.totals set rooms_all = rooms_all + 3 where id = 1;
    ${SW(100)}
    res := res || jsonb_build_object('tot2', ${ALL} - (select count(*) from mahjong.rooms where kind = 'shared' and closed_at is null),
      'tot_mark', exists (select 1 from mahjong.limits where kind = 'sweep:recount' and window_start = date_trunc('day', now())));`)}
  raise exception 'MJRESULT%', res::text;
end ${q('sw')};`;

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}

let out = null;
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
if (!isTest) console.log('★中止★ test の倉庫でない');
else {
  const { text: t } = await mq(sql);
  let msg = t; try { msg = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) console.log('★失敗★ 結果の例外が来なかった: ' + msg.slice(0, 800));
  else {
    try { out = JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]); } catch (e) { console.log('★失敗★ 結果が読めない: ' + e.message); }
  }
}
const J = (x) => JSON.stringify(x);
if (out) {
  const errs = Object.keys(out).filter((k) => k.endsWith('_err'));
  ok('塊の中で例外が出ていない', errs.length === 0, J(errs.map((k) => k + '=' + out[k])));
  ok('khaw に前から在る古い部屋は先に掃けた（0）', Number(out.others_left) === 0, String(out.others_left));
  const pv = out.priv || {};
  ok('⓪ anon・authenticated・PUBLIC に EXECUTE 無し', pv.anon === false && pv.auth === false && pv.public === false, J(pv));
  ok('⓪ definer・search_path 空・lock_timeout 50ms', pv.definer === true && J(pv.config) === J(['search_path=""', 'lock_timeout=50ms']), J(pv.config));
  ok('部屋 R0 を作れた', out.made && out.made.ok === true, J(out.made));
  const all = LIM.map((_, i) => 'test:l' + i).sort();
  ok('古い行を全部入れた', J(out.old0.lim) === J(all) && out.old0.c49 && out.old0.c47 && out.old0.o8 && out.old0.o6, J(out.old0));
  /* ⑦ */
  ok('⑦ create の bad・join の wrong・bad が返った', out.n_bad?.err === 'bad' && out.n_wrong?.err === 'wrong' && out.n_way?.err === 'bad', J([out.n_bad, out.n_wrong, out.n_way]));
  ok('⑦ ok でない返しでは古い行が1つも消えない', J(out.old_n) === J(out.old0), J(out.old_n));
  /* ① */
  ok('① join（url）の ok が返った', out.j_ok?.ok === true && out.j_ok.again === false, J(out.j_ok));
  const left = new Set(out.old1.lim || []);
  LIM.forEach(([name, , , gone], i) => ok(`① limits ${name} → ${gone ? '消える' : '残る'}`, left.has('test:l' + i) === !gone));
  ok('① creates 49時間前は消え 47時間前は残る', out.old1.c49 === false && out.old1.c47 === true, J(out.old1));
  ok('① op_results 8日前は消え 6日前は残る', out.old1.o8 === false && out.old1.o6 === true, J(out.old1));
  ok('① 1手順で p_max を超えない（150 → 1回目 50 残る → 2回目 0）', Number(out.p1) === 50 && Number(out.p2) === 0, `${out.p1} → ${out.p2}`);
  /* ② */
  const ra = out.ra || {};
  ok('② 入 181日は消える', ra['2'] === false, J(ra));
  ok('② 入 179日は残る', ra['4'] === true, J(ra));
  ok('② 管 181日は残る', ra['3'] === true, J(ra));
  ok('② 持ち主（入の行・181日）は残る', ra['1'] === true, J(ra));
  ok('② リーグの L（入・181日）は残る', ra['5'] === true, J(ra));
  ok('② members.user_id は残る', out.ra_member === true, String(out.ra_member));
  /* ③ */
  ok('③ 8日・半荘0・誰も来ない・小さい → ★消えない★（段C v10.1 ⓑ を止めた）・rule_sets も残り rooms_all そのまま', out.e1 && out.e1.room === true && out.e1.rs === true && Number(out.e1.all) === 0, J(out.e1));
  ok('③ 昨日 last_seen → 残る（印も付かない）', out.e2 && out.e2.room === true && out.e2.del === false && Number(out.e2.all) === 0, J(out.e2));
  ok('③ 半荘1 → 残る', out.e3 && out.e3.room === true && out.e3.del === false && Number(out.e3.all) === 0, J(out.e3));
  ok('③ 子が p_max を超える → ★消した印も付かない★（段C v10.1・子はそのまま・rooms_all そのまま）', out.e4 && out.e4.room === true && out.e4.del === false && Number(out.e4.all) === 0 && Number(out.e4.kids) === 7, J(out.e4));
  /* ④ */
  ok('④-0 小さい消した部屋（2版を開催日・卓・半荘が指す）が1回で消える・rooms_all −1', out.s0 && out.s0.room === false && Number(out.s0.rs) === 0 && Number(out.s0.han) === 0 && Number(out.s0.all) === -1, J(out.s0));
  ok('④-0 外部キーをその場で見て赤0', out.s0 && out.s0.fk === 'ok', out.s0 && out.s0.fk);
  ok('④-0 小さい消した部屋の名乗り1行も消える（2c-2b N1）', out.s0 && Number(out.s0.cl) === 0 && out.s0.room === false, J(out.s0));
  ok('④-1 1回目の掃除で消えた版は p_max 100 以下（§3.2 手順ごとに最大100行）', out.rv && Number(out.rv.first) > 0 && Number(out.rv.first) <= 100, JSON.stringify(out.rv));
  ok('⑨ 1回目は room_accounts を消して進む（印なし）', out.stk1 && out.stk1.mark === false && Number(out.stk1.ra) === 0, J(out.stk1));
  ok('⑨ 2回目は1行も消せない＝mj_sweep_stuck で部屋は残り sweep:bad の印・版は 105 のまま', out.stk && out.stk.room === true && out.stk.mark === true && Number(out.stk.rs) === 105, J(out.stk));
  ok('④-2 ルールを指さない消した部屋（版 105）も p_max 100 で消える・印なし', out.rvn && out.rvn.room === false && Number(out.rvn.all) === -1 && out.rvn.bad === false, J(out.rvn));
  ok('④-1 ルールの版 105 の消した部屋が p_max 100 で消える・rooms_all −1', out.rv && out.rv.room === false && Number(out.rv.all) === -1, JSON.stringify(out.rv));
  const b = out.big || {};
  ok('④ 大きい部屋を p_max 1〜13 で回して毎回 外部キー赤0', b.fk === 'ok', b.fk);
  ok('④ 最後に rooms が消え rooms_all −1・印は付かない', b.room === false && Number(b.all) === -1 && b.bad === false, J(b));
  ok('④ 大きい部屋の名乗り（8行）も残らない（2c-2b N1）', b.cl0 === true, J(b));
  ok('④ 消して6日の部屋は触らない', b.d6 === true && Number(b.d6kids) === 2, J(b));
  console.log(`    （④ 子 ${b.kids0} 行を ${b.calls} 回で消した）`);
  /* ⑧ */
  const tm = (out.tm || []).map(Number);
  ok('⑧ 1回の掃除（p_max 100）が 5回とも 1秒未満', tm.length === 5 && tm.every((x) => x < 1000), J(tm));
  console.log(`    （⑧ 1回の時間 ms＝${tm.map((x) => x.toFixed(1)).join(' / ')}・残りの子 ${out.tm_kids}）`);
  /* ⑤ */
  ok('⑤ 印の無い日は totals のずれ +3 を直す', Number(out.tot1) === 0, String(out.tot1));
  ok('⑤ 同じ日の2回目は直さない（印が在る）', Number(out.tot2) === 3 && out.tot_mark === true, `${out.tot2} ${out.tot_mark}`);
  /* ⑥ */
  const bd = out.bad || {}, bd2 = out.bad2 || {};
  ok('⑥ 落ちる部屋が在っても create の ok が返る', bd.ret && bd.ret.ok === true, J(bd.ret));
  ok('⑥ 落ちた部屋は残り sweep:bad の印が付く', bd.room === true && bd.mark === true, J(bd));
  ok('⑥ 手順3（古い limits）は同じ呼びで動いた', bd.step3 === false, J(bd));
  ok('⑥ 次の呼びは落ちた部屋を飛ばして次の部屋を消す', bd.v2_1 === true && bd2.room === true && bd2.v2 === false, J([bd, bd2]));
}
if (isTest) {
  const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name in ('sweep', '掃除の試験')) as rooms,
    (select count(*)::int from mahjong.limits where key like 'test:%') as lim,
    (select count(*)::int from pg_proc where proname = 'mj_test_boom') as boom`);
  let left = null; try { left = JSON.parse(lf.text)[0]; } catch (_) { /* 字 */ }
  ok('倉庫に試験の人・部屋・数え・trigger が1つも残っていない', left && left.u === 0 && left.rooms === 0 && left.lim === 0 && left.boom === 0, lf.text.slice(0, 200));
}
console.log(`\nsweep: ${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
