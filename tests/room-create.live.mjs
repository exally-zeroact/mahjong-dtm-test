/* room-create.live.mjs — ★入口 public.mj_room_create を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * v18（全員ログイン・人×部屋＝room_accounts・合言葉と端末の秘密なし・案 v18_login_sekkei.md G・K-7・K-10）：
 *  ⓪ 人＝mj_me：claims 無し・匿名・session 無し・users 無し・消した人・止めた人・not_after 切れ・他人の session_id・
 *     uuid でない字＝mj_session（何も増えない）
 *  ① 作れて rooms・rule_sets・room_accounts・creates・totals・accounts が1ずつ・limits の create:* は増えない（caps v1.1＝u1m・u1d・su1d をやめた）
 *     持ち主＝作った人・room_accounts は kan・create・admin_secret_hash 空・creates.user_id・返しの鍵は ok・room_id・room_no・channel_key の4つ
 *  ② 同じ op_id で送り直し＝同じ返し ／ url が違う＝mismatch ／ 消した部屋＝gone ／ 別の人の同じ op_id＝mj_op_other_user
 *  ③ 形の違い（secrets は url_token_hash の1つだけ・2つ3つは bad:secrets）・ルールの範囲の外・よくあるパスを弾く ④ 既定のルール（44鍵）
 *  ⑤ pass_hash は $2a$10$・そろえた字で照らせる・平文のパスは部屋の行のどこにも無い
 *  ⑥ 一意の当たり＝dup ⑦ P3：R はやめた＝開いた shared が多くても full にならない ⑧ P3：人ごと1分5（部屋なしも）で busy:user_min・部屋なし人ごと24時間100で busy:solo_day（until）・人ごと24時間5部屋で busy:user（4なら作れる・別の人は作れる）
 *  ★ok でない返しの後は creates・limits・totals・部屋の数が1つも増えていない★（S1・N2）
 *  ⑨ 関数の権限（definer・search_path 空・authenticated だけに EXECUTE・anon と PUBLIC に無し）
 *  ⑩ anon の鍵の PostgREST は 401/403 ／ 捨てアカウント（admin で作る＝メールを送らない）で呼んで bad:op_id →
 *     signOut 後の同じ token は mj_session → admin で消す（accounts の行も外部キーで消える）
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝仮の人 auth.users・auth.sessions も全部戻る）。
 * 人を替える＝set_config('request.jwt.claims', {sub, session_id, role}, true)（11-20 khaw で auth.uid()・auth.jwt() が通るのを測った）
 * ★同時に同じ op_id が2本来た時（totals の for update で2本目が待つ）は1つの取引の中では試せない（dblink 無し）＝見立て★
 * 使い方: node tests/room-create.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const url = /url:\s*'([^']+)'/.exec(src)[1];
const anonKey = /key:\s*'([^']+)'/.exec(src)[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1];
/* ★倉庫の門（設計 I-6）★ env の字だけでなく ref を直に見る（字は supa-config.js だけが持つ＝ここは sha256 の頭16字の指紋で照らす）＝khaw（全アプリ共有のテスト倉庫）でなければ1行も呼ばずに止める（本番 auth に試しのアカウントを作らない） */
if ((await import('node:crypto')).createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');                     // 字はドルの札で包む（引用符の逃がしが要らない）
const hex = () => crypto.randomBytes(32).toString('hex');
const uid = () => crypto.randomUUID();
const MAIL = 'mj-room-create.invalid';
const PASS = '２７４１';   // 段C：パスは数字4つ（全角で打っても NFKC で 2741）
const PKEY = '2741';
const sec = (u) => JSON.stringify({ url_token_hash: u });
const call = (op, name, pass, rules, secrets) =>
  `public.mj_room_create(${op === null ? 'null' : lit(op) + '::uuid'}, ${name === null ? 'null' : lit(name)}, ${pass === null ? 'null' : lit(pass)}, `
  + `${rules === null ? 'null' : lit(rules) + '::jsonb'}, ${secrets === null ? 'null' : lit(secrets) + '::jsonb'})`;
/* 人を替える（塊の中の変数 v_u・v_s など、または字） */
const asWho = (sub, sid) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', ${sub}, 'session_id', ${sid}, 'role', 'authenticated')::text, true);`;
const AS_U = asWho('v_u', 'v_s'), AS_U2 = asWho('v_u2', 'v_s2');

const OP1 = uid(), U1 = hex();
const S1 = sec(U1);

/* ③ 弾く表（人は U）：[名, 呼び, 期待の err, 期待の what/key] */
const BAD = [
  ['op_id が null', call(null, '甲', PASS, '{"players":4}', S1), 'bad', 'op_id'],
  ['名前が空', call(uid(), '', PASS, '{"players":4}', sec(hex())), 'bad', 'name'],
  ['名前が全角の空白だけ', call(uid(), '　 ', PASS, '{"players":4}', sec(hex())), 'bad', 'name'],
  ['名前が null', call(uid(), null, PASS, '{"players":4}', sec(hex())), 'bad', 'name'],
  ['名前41字', call(uid(), 'あ'.repeat(41), PASS, '{"players":4}', sec(hex())), 'bad', 'name'],
  ['パス3字', call(uid(), '甲', 'abc', '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['段C パスが英字4つ', call(uid(), '甲', 'abcd', '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['段C パスが数字5つ', call(uid(), '甲', '12345', '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['段C パスが数字3つ', call(uid(), '甲', '123', '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['段C 名前がそろえると空（ゼロ幅の空白だけ）', call(uid(), '\u200b', '1234', '{"players":4}', sec(hex())), 'bad', 'name'],
  ['パス65字', call(uid(), '甲', 'x'.repeat(65), '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['パスがそろえて73 byte 以上', call(uid(), '甲', '㍿'.repeat(7), '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['パスが null', call(uid(), '甲', null, '{"players":4}', sec(hex())), 'bad', 'pass'],
  ['秘密が null', call(uid(), '甲', PASS, '{"players":4}', null), 'bad', 'secrets'],
  ['秘密が空の物', call(uid(), '甲', PASS, '{"players":4}', '{}'), 'bad', 'secrets'],
  ['秘密が2つ（前の合言葉）', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ url_token_hash: hex(), admin_secret: 'Ab3dEf6hIj9kLm2P' })), 'bad', 'secrets'],
  ['秘密が3つ（前の形）', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ url_token_hash: hex(), admin_secret: 'Ab3dEf6hIj9kLm2P', device_token_hash: hex() })), 'bad', 'secrets'],
  ['秘密が配列', call(uid(), '甲', PASS, '{"players":4}', '[1]'), 'bad', 'secrets'],
  ['秘密の1つが別の名', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ device_token_hash: hex() })), 'bad', 'url_token_hash'],
  ['url が hex でない', call(uid(), '甲', PASS, '{"players":4}', sec('g'.repeat(64))), 'bad', 'url_token_hash'],
  ['url が大文字の hex', call(uid(), '甲', PASS, '{"players":4}', sec(hex().toUpperCase())), 'bad', 'url_token_hash'],
  ['url が63字', call(uid(), '甲', PASS, '{"players":4}', sec(hex().slice(1))), 'bad', 'url_token_hash'],
  ['url が数', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ url_token_hash: 1 })), 'bad', 'url_token_hash'],
  ['ルール players 5', call(uid(), '甲', PASS, '{"players":5}', sec(hex())), 'range', 'players'],
  ['ルール null', call(uid(), '甲', PASS, null, sec(hex())), 'range', '(object)'],
  ['ルールに無い鍵', call(uid(), '甲', PASS, '{"players":4,"zzz":1}', sec(hex())), 'range', '(unknown)'],
  ['ルール 返し＜持ち点', call(uid(), '甲', PASS, '{"players":4,"start_pts":30000,"return_pts":25000}', sec(hex())), 'range', 'return_pts'],
  ['一意の当たり url（別の op_id）', call(uid(), '甲', PASS, '{"players":4}', sec(U1)), 'dup', 'url_token_hash'],
  ['送り直しで url が違う', call(OP1, '甲', PASS, '{"players":4}', sec(hex())), 'mismatch', null],
];

/* ⓪ 人で弾く表：[名, 前の手（塊の中で書いて戻す）, 人の claims] ＝全部 mj_session・何も増えない */
const SESS = [
  ['claims が無い', '', `perform set_config('request.jwt.claims', '', true);`],
  ['claims が空の物', '', `perform set_config('request.jwt.claims', '{}', true);`],
  ['匿名の人', '', asWho('v_u3', 'v_s3')],
  ['session が倉庫に無い', '', asWho('v_u', 'gen_random_uuid()')],
  ['session_id が claims に無い', '', `perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u, 'role', 'authenticated')::text, true);`],
  ['人が auth.users に無い', '', asWho('gen_random_uuid()', 'gen_random_uuid()')],
  ['消した人（deleted_at）', 'update auth.users set deleted_at = now() where id = v_u;', AS_U],
  ['止めた人（banned_until が先）', `update auth.users set banned_until = now() + interval '1 day' where id = v_u;`, AS_U],
  ['session の not_after 切れ', `update auth.sessions set not_after = now() - interval '1 second' where id = v_s;`, AS_U],
  ['他人の session_id', '', asWho('v_u', 'v_s2')],
  ['sub が uuid でない字', '', asWho(`'abc'`, 'v_s')],
  ['session_id が uuid でない字', '', asWho('v_u', `'abc'`)],
];

const CNT = `jsonb_build_object('rooms', (select count(*) from mahjong.rooms), 'rule_sets', (select count(*) from mahjong.rule_sets),
  'room_accounts', (select count(*) from mahjong.room_accounts), 'creates', (select count(*) from mahjong.creates),
  'accounts', (select count(*) from mahjong.accounts),
  'totals', (select rooms_all from mahjong.totals where id = 1),
  'lim', (select coalesce(sum(count), 0) from mahjong.limits where kind like 'create:%'),
  'lim_u', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'create:u1d'),
  'lim_rows', (select count(*) from mahjong.limits where kind like 'create:%'))`;
/* 塊の中だけで書いて戻す：body を走らせ、結果を res に入れてから例外で戻す（plpgsql の変数は戻らない） */
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
let FN = 0;
const fresh = () => call(uid(), '乙' + (++FN), PASS, '{"players":3}', sec(hex()));   // 段C：同じ名前とパスは dup＝毎回名前を変える

const sql = `do ${q('rc')} declare res jsonb := '{}'; r jsonb; c0 jsonb; c1 jsonb; cx jsonb; t jsonb; rid uuid; n int;
  v_u uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_u3 uuid := gen_random_uuid();
  v_s uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid();
begin
  /* 2b-2：khaw の前から在る古い行を先に掃く（掃除は ok の返しで走る＝表全体の数えが揺れない・塊の最後で全部戻る） */
  for i in 1..50 loop perform mahjong_private.mj_sweep(1000000); end loop;
  res := res || jsonb_build_object('others_left', (select count(*) from mahjong.rooms x where x.deleted_at < now() - interval '7 days'));   -- 段C v10.1：掃除は ⓐ（消して7日）だけ
  insert into auth.users (id, email, aud, role, is_anonymous) values
    (v_u, v_u::text || '@${MAIL}', 'authenticated', 'authenticated', false),
    (v_u2, v_u2::text || '@${MAIL}', 'authenticated', 'authenticated', false),
    (v_u3, null, 'authenticated', 'authenticated', true);
  insert into auth.sessions (id, user_id) values (v_s, v_u), (v_s2, v_u2), (v_s3, v_u3);
  ${AS_U2}
  perform mahjong_private.mj_me();                         -- U2 の accounts を先に作る（後の比べを accounts で汚さない）
  res := res || jsonb_build_object('u', v_u, 'u2', v_u2);
  /* ⓪ */
  t := '[]';
  ${SESS.map(([, pre, who], i) => `begin
    ${pre} ${who}
    cx := ${CNT}; r := ${fresh()};
    res := res || jsonb_build_object('s${i}_c', cx, 's${i}_c1', ${CNT}, 's${i}_acc', (select count(*) from mahjong.accounts where user_id = v_u));
    t := t || jsonb_build_array(r);
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then t := t || jsonb_build_array(jsonb_build_object('raised', sqlerrm)); end if;
  end;`).join('\n  ')}
  res := res || jsonb_build_object('sess', t);
  /* ① */
  ${AS_U}
  c0 := ${CNT};
  r := ${call(OP1, '　甲の部屋 ', PASS, '{"players":4}', S1)};
  c1 := ${CNT};
  rid := (r->>'room_id')::uuid;
  res := res || jsonb_build_object('r1', r, 'c0', c0, 'c1', c1,
    'room', (select to_jsonb(x) - 'pass_hash' from mahjong.rooms x where x.id = rid),
    'room_text', (select (to_jsonb(x) - 'id' - 'room_no' - 'url_token_hash' - 'channel_key' - 'owner_user_id' - 'rule_set_id')::text from mahjong.rooms x where x.id = rid),   -- 段C：4桁のパスが番号・hex に偶然在るのを外す
    'pass_prefix', (select substr(x.pass_hash, 1, 7) from mahjong.rooms x where x.id = rid),
    'crypt_key', (select x.pass_hash = extensions.crypt(${lit(PKEY)}, x.pass_hash) from mahjong.rooms x where x.id = rid),
    'crypt_raw', (select x.pass_hash = extensions.crypt(${lit(PASS)}, x.pass_hash) from mahjong.rooms x where x.id = rid),
    'crypt_wide', (select x.pass_hash = extensions.crypt(mahjong_private.mj_pass_key(${lit(PASS)}), x.pass_hash) from mahjong.rooms x where x.id = rid),
    'rs', (select jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'nkeys', (select count(*) from jsonb_object_keys(s.rules)), 'players', s.rules->'players')) from mahjong.rule_sets s where s.room_id = rid),
    'ra', (select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role, 'joined_via', a.joined_via, 'member_id', a.member_id)) from mahjong.room_accounts a where a.room_id = rid),
    'dev', (select count(*) from mahjong.devices d where d.room_id = rid),
    'acc', (select count(*) from mahjong.accounts a where a.user_id = v_u),
    'cr', (select to_jsonb(c) from mahjong.creates c where c.op_id = ${lit(OP1)}::uuid),
    'lim_kinds', (select jsonb_object_agg(k, s) from (select l.kind || ':' || case when l.key = v_u::text then 'U' else l.key end as k, sum(l.count) as s
       from mahjong.limits l where l.kind like 'create:%' group by 1) z));
  r := ${call(OP1, '別の名前', '9999', '{"players":3}', S1)};
  res := res || jsonb_build_object('r2', r, 'c2', ${CNT});
  t := '[]';
  ${BAD.map(([, c]) => `begin r := ${c}; exception when others then r := jsonb_build_object('raised', sqlerrm); end; t := t || jsonb_build_array(r);`).join('\n  ')}
  res := res || jsonb_build_object('bad', t, 'c3', ${CNT});
  /* ② 別の人の同じ op_id（K-7） */
  ${AS_U2}
  r := ${call(OP1, '甲', PASS, '{"players":4}', S1)};
  res := res || jsonb_build_object('other', r, 'c_other', ${CNT});
  ${AS_U}
  ${undo('gone', `update mahjong.rooms set deleted_at = now() where id = rid;
    r := ${call(OP1, '甲', PASS, '{"players":4}', S1)}; res := res || jsonb_build_object('gone', r, 'c_gone', ${CNT});`)}
  ${undo('p1234', `r := ${call(uid(), '甲', '1234', '{"players":4}', sec(hex()))}; res := res || jsonb_build_object('p1234', r);`)}
  ${undo('nofull', `update mahjong.totals set rooms_all = 10000 where id = 1;   -- P3：R をやめた＝開いた shared が 201 でも 10000 でも作れる
    res := res || jsonb_build_object('caps_rooms', (select count(*) from mahjong.mj_caps where tbl = 'rooms' and scope = 'all'));
    r := ${fresh()}; res := res || jsonb_build_object('nofull', r, 'nofull_t', (select rooms_all from mahjong.totals where id = 1));`)}
  ${undo('b1m', `insert into mahjong.limits (kind, key, window_start, count) values ('create:u1m', v_u::text, date_trunc('minute', now()), 5)
      on conflict (kind, key, window_start) do update set count = 5;
    cx := ${CNT}; r := ${fresh()}; res := res || jsonb_build_object('b1m', r, 'c_b1m0', cx, 'c_b1m1', ${CNT});
    r := ${call(uid(), null, null, '{"players":4}', sec(hex()))}; res := res || jsonb_build_object('b1m_solo', r, 'c_b1m2', ${CNT});
    ${AS_U2}
    r := ${fresh()}; res := res || jsonb_build_object('b1m_other', r);
    ${AS_U}
    update mahjong.limits set count = 4 where kind = 'create:u1m' and key = v_u::text and window_start = date_trunc('minute', now());
    r := ${fresh()}; res := res || jsonb_build_object('b1m_19', r);`)}
  /* ⑧ P3 部屋なし人ごと24時間100（create:su1d）：23時間前に 60・今の時に 40＝100 → 101本目は busy solo_day・until＝23時間前の窓＋24時間 */
  ${undo('b1d', `delete from mahjong.limits where kind = 'create:su1d' and key = v_u::text;
    insert into mahjong.limits (kind, key, window_start, count) values ('create:su1d', v_u::text, date_trunc('hour', now()) - interval '23 hours', 60),
      ('create:su1d', v_u::text, date_trunc('hour', now()), 40);
    cx := ${CNT}; r := ${call(uid(), null, null, '{"players":4}', sec(hex()))}; res := res || jsonb_build_object('b1d', r, 'c_b1d0', cx, 'c_b1d1', ${CNT},
      'b1d_until', date_trunc('hour', now()) + interval '1 hour');
    r := ${fresh()}; res := res || jsonb_build_object('b1d_shared', r);
    ${AS_U2}
    r := ${call(uid(), null, null, '{"players":4}', sec(hex()))}; res := res || jsonb_build_object('b1d_other', r);
    ${AS_U}
    update mahjong.limits set count = 39 where kind = 'create:su1d' and key = v_u::text and window_start = date_trunc('hour', now());
    r := ${call(uid(), null, null, '{"players":4}', sec(hex()))}; res := res || jsonb_build_object('b1d_99', r,
      'b1d_99n', (select sum(count) from mahjong.limits where kind = 'create:su1d' and key = v_u::text));`)}
  ${undo('old', `insert into mahjong.limits (kind, key, window_start, count) values ('create:su1d', v_u::text, date_trunc('hour', now()) - interval '25 hours', 5000)
      on conflict (kind, key, window_start) do update set count = 5000;
    r := ${call(uid(), null, null, '{"players":4}', sec(hex()))};
    res := res || jsonb_build_object('old', r, 'old_left', (select count(*) from mahjong.limits where kind = 'create:su1d' and key = v_u::text and window_start <= now() - interval '24 hours'));`)}
  /* ⑧ 人ごと24時間5部屋（U は ① で1つ作った＝窓に足して5にする／4にする） */
  ${undo('u5', `select coalesce(sum(count), 0) into n from mahjong.limits where kind = 'create:u1d' and key = v_u::text and window_start > now() - interval '24 hours';
    insert into mahjong.limits (kind, key, window_start, count) values ('create:u1d', v_u::text, date_trunc('hour', now()) - interval '23 hours', 5 - n)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 5 - n;
    cx := ${CNT}; r := ${fresh()}; res := res || jsonb_build_object('u5', r, 'c_u50', cx, 'c_u51', ${CNT});
    ${AS_U2}
    r := ${fresh()}; res := res || jsonb_build_object('u5_other', r);
    ${AS_U}
    update mahjong.limits set count = count - 1 where kind = 'create:u1d' and key = v_u::text and window_start = date_trunc('hour', now()) - interval '23 hours';
    r := ${fresh()}; res := res || jsonb_build_object('u4', r);`)}
  ${undo('u_old', `insert into mahjong.limits (kind, key, window_start, count) values ('create:u1d', v_u::text, date_trunc('hour', now()) - interval '25 hours', 50)
      on conflict (kind, key, window_start) do update set count = 50;
    r := ${fresh()};
    res := res || jsonb_build_object('u_old', r, 'u_old_left', (select count(*) from mahjong.limits where kind = 'create:u1d' and key = v_u::text and window_start <= now() - interval '24 hours'));`)}
  res := res || jsonb_build_object('funcs', (select jsonb_agg(jsonb_build_object('name', p.proname, 'definer', p.prosecdef, 'config', p.proconfig,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public', exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)))
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'mj\\_%'),
    'priv_anon', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('mahjong', 'mahjong_private') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  raise exception 'MJRESULT%', res::text;
end ${q('rc')};`;

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
  if (at < 0) console.log('★失敗★ 結果の例外が来なかった: ' + msg.slice(0, 600));
  else {
    try { out = JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]); } catch (e) { console.log('★失敗★ 結果が読めない: ' + e.message); }
  }
}
const d = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Number(b[k]) - Number(a[k])]));
const so = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort().map((k) => k + ":" + JSON.stringify(o[k])).join(",") : JSON.stringify(o));
const same = (a, b) => so(a) === so(b);
if (out) {
  ok('khaw に前から在る古い部屋は先に掃けた（0＝表全体の数えが掃除で揺れない・taiketsu 直し N1）', Number(out.others_left) === 0, String(out.others_left));
  /* ⓪ */
  SESS.forEach(([name], i) => {
    const r = out.sess[i] || {};
    ok('⓪ ' + name + ' → mj_session', r.ok === false && r.err === 'mj_session' && Object.keys(r).length === 2, JSON.stringify(r));
    ok('⓪ ' + name + ' で何も増えない（accounts も）', out[`s${i}_c`] && same(out[`s${i}_c`], out[`s${i}_c1`]) && Number(out[`s${i}_acc`]) === 0,
      JSON.stringify(out[`s${i}_c`] && d(out[`s${i}_c`], out[`s${i}_c1`])));
  });
  /* ① */
  const r1 = out.r1 || {};
  ok('① 作れた', r1.ok === true, JSON.stringify(r1));
  ok('① 返しの鍵は ok・room_id・kind・room_no・channel_key の5つ（段C で kind）・kind shared', Object.keys(r1).sort().join(',') === 'channel_key,kind,ok,room_id,room_no' && r1.kind === 'shared', JSON.stringify(Object.keys(r1)));
  ok('① rooms・rule_sets・room_accounts・creates・totals・accounts が1ずつ・limits の create:* は +0（caps v1.1）',
    same(d(out.c0, out.c1), { rooms: 1, rule_sets: 1, room_accounts: 1, creates: 1, accounts: 1, totals: 1, lim: 0, lim_u: 0, lim_rows: 0 }), JSON.stringify(d(out.c0, out.c1)));
  ok('① caps v1.1：作った人の create:* の窓は1つも無い（u1m・u1d・su1d を書かない）', Object.keys(out.lim_kinds || {}).filter((k) => k.endsWith(':U')).length === 0, JSON.stringify(out.lim_kinds));
  ok('① 部屋番号は8桁', /^[0-9]{8}$/.test(r1.room_no || ''), r1.room_no);
  ok('① channel_key は倉庫が作った32字の hex', /^[0-9a-f]{32}$/.test(r1.channel_key || '') && out.room.channel_key === r1.channel_key);
  ok('① 名前の前後の空白（全角も）が落ちた', out.room.name === '甲の部屋', out.room.name);
  ok('① 持ち主＝作った人', out.room.owner_user_id === out.u, out.room.owner_user_id);
  ok('① 合言葉の列は空', out.room.admin_secret_hash === null, String(out.room.admin_secret_hash));
  ok('① row_count 1・rule_version 1・rule_set_id が rule_sets の id', out.room.row_count === 1 && out.room.rule_version === 1
    && out.rs.length === 1 && out.rs[0].id === out.room.rule_set_id && out.rs[0].version === 1, JSON.stringify(out.rs));
  ok('① room_accounts は作った人1行・kan・create・member 空', out.ra && out.ra.length === 1 && out.ra[0].user_id === out.u
    && out.ra[0].role === 'kan' && out.ra[0].joined_via === 'create' && out.ra[0].member_id === null, JSON.stringify(out.ra));
  ok('① devices は0行', Number(out.dev) === 0, String(out.dev));
  ok('① accounts に作った人', Number(out.acc) === 1, String(out.acc));
  ok('① creates に op_id・部屋・作った人', out.cr && out.cr.room_id === r1.room_id && out.cr.user_id === out.u, JSON.stringify(out.cr));
  ok('① url_token_hash は送った物', out.room.url_token_hash === U1);
  /* ④ */
  ok('④ 既定のルールが埋まった（44鍵・players 4）', out.rs[0].nkeys === 44 && out.rs[0].players === 4, JSON.stringify(out.rs[0]));
  /* ⑤ */
  ok('⑤ pass_hash は $2a$10$', out.pass_prefix === '$2a$10$', out.pass_prefix);
  ok('⑤ そろえた字で照らせる（大文字・全角で打っても同じ）', out.crypt_key === true && out.crypt_wide === true && out.crypt_raw === false);
  ok('⑤ 平文のパスは部屋の行のどこにも無い', !out.room_text.includes(PASS) && !out.room_text.toLowerCase().includes(PASS.toLowerCase()));
  /* ② */
  const r2 = out.r2 || {};
  ok('② 同じ op_id の送り直し＝同じ返し', same(r2, r1), JSON.stringify(r2));
  ok('② 送り直しで何も増えない', same(out.c1, out.c2), JSON.stringify(d(out.c1, out.c2)));
  ok('② 別の人の同じ op_id＝mj_op_other_user', out.other && out.other.ok === false && out.other.err === 'mj_op_other_user', JSON.stringify(out.other));
  ok('② mj_op_other_user で何も増えない', out.c_other && same(out.c3, out.c_other), JSON.stringify(out.c_other && d(out.c3, out.c_other)));
  ok('② 消した部屋への送り直し＝gone', out.gone && out.gone.ok === false && out.gone.err === 'gone', JSON.stringify(out.gone || out.gone_err));
  ok('② gone で何も増えない', out.c_gone && same(out.c3, out.c_gone));
  /* ③⑥ */
  BAD.forEach(([name, , err, what], i) => {
    const r = out.bad[i] || {};
    const got = r.what ?? r.key ?? null;
    ok('③ ' + name + ` → ${err}${what ? ':' + what : ''}`, r.ok === false && r.err === err && got === what, JSON.stringify(r));
  });
  ok('③ 弾いた後に creates・limits・totals・部屋が1つも増えていない', same(out.c2, out.c3), JSON.stringify(d(out.c2, out.c3)));
  /* ⑦ */
  ok('⑦ P3：mj_caps に rooms/all が無い', Number(out.caps_rooms) === 0, JSON.stringify({ c: out.caps_rooms, e: out.nofull_err }));
  ok('⑦ P3：開いた shared が 10000 でも full にならず作れる（rooms_all は数えだけ +1）', out.nofull && out.nofull.ok === true && Number(out.nofull_t) === 10001, JSON.stringify({ r: out.nofull, t: out.nofull_t, e: out.nofull_err }));
  ok('B0 よくあるパスの弾きは無い＝1234 で作れる', out.p1234 && out.p1234.ok === true, JSON.stringify(out.p1234));
  /* ⑧ */
  ok('⑧ caps v1.1：前の上限（人ごと1分5）の窓が5でも6個目を作れる', out.b1m?.ok === true && out.b1m.kind === 'shared', JSON.stringify(out.b1m || out.b1m_err));
  ok('⑧ caps v1.1：その時 部屋は1つ増え limits の create:* は増えない', out.c_b1m0 && d(out.c_b1m0, out.c_b1m1).lim === 0 && d(out.c_b1m0, out.c_b1m1).lim_rows === 0 && d(out.c_b1m0, out.c_b1m1).rooms === 1, JSON.stringify(out.c_b1m0 && d(out.c_b1m0, out.c_b1m1)));
  ok('⑧ caps v1.1：部屋なしも6個目を作れる（create:* は増えない）', out.b1m_solo?.ok === true && out.b1m_solo.kind === 'solo' && out.c_b1m1 && d(out.c_b1m1, out.c_b1m2).lim === 0 && d(out.c_b1m1, out.c_b1m2).lim_rows === 0, JSON.stringify(out.b1m_solo));
  ok('⑧ P3：その時も別の人は作れる（他の人の数えで止まらない）', out.b1m_other && out.b1m_other.ok === true, JSON.stringify(out.b1m_other));
  ok('⑧ 1分4個なら作れる', out.b1m_19 && out.b1m_19.ok === true, JSON.stringify(out.b1m_19));
  ok('⑧ caps v1.1：前の上限（部屋なし 24時間100）の窓が100でも101個目を作れる', out.b1d?.ok === true && out.b1d.kind === 'solo', JSON.stringify([out.b1d, out.b1d_err]));
  ok('⑧ caps v1.1：その時 limits の create:* は増えない', out.c_b1d0 && d(out.c_b1d0, out.c_b1d1).lim === 0 && d(out.c_b1d0, out.c_b1d1).lim_rows === 0, JSON.stringify(out.c_b1d0 && d(out.c_b1d0, out.c_b1d1)));
  ok('⑧ P3：部屋なしの24時間100は shared を止めない・別の人の部屋なしも止めない', out.b1d_shared?.ok === true && out.b1d_other?.ok === true, JSON.stringify([out.b1d_shared, out.b1d_other]));
  ok('⑧ caps v1.1：窓が99でも作れて su1d は99のまま（数えない）', out.b1d_99?.ok === true && Number(out.b1d_99n) === 99, JSON.stringify([out.b1d_99, out.b1d_99n]));
  ok('⑧ caps v1.1：24時間より前の古い窓が在っても作れ、作る時に読まず消さない（1行残る）', out.old?.ok === true && Number(out.old_left) === 1, JSON.stringify({ old: out.old, left: out.old_left, e: out.old_err }));
  ok('⑧ caps v1.1：前の上限（人ごと24時間5部屋）の窓が5でも6部屋目を作れる', out.u5?.ok === true && out.u5.kind === 'shared', JSON.stringify(out.u5 || out.u5_err));
  ok('⑧ caps v1.1：その時 部屋は1つ増え limits の create:* は増えない', out.c_u50 && d(out.c_u50, out.c_u51).lim === 0 && d(out.c_u50, out.c_u51).lim_rows === 0 && d(out.c_u50, out.c_u51).rooms === 1, JSON.stringify(out.c_u50 && d(out.c_u50, out.c_u51)));
  ok('⑧ 別の人は作れる', out.u5_other && out.u5_other.ok === true, JSON.stringify(out.u5_other));
  ok('⑧ 人ごと4部屋なら作れる', out.u4 && out.u4.ok === true, JSON.stringify(out.u4));
  ok('⑧ caps v1.1：人ごとの古い窓が在っても作れ、読まず消さない（1行残る）', out.u_old?.ok === true && Number(out.u_old_left) === 1, JSON.stringify({ r: out.u_old, left: out.u_old_left, e: out.u_old_err }));
  /* ⑨ */
  const fn = (out.funcs || []);
  const fc = fn.find((x) => x.name === 'mj_room_create');   // 段2c-1 から public.mj_* は3本（mj_room_join は room-join.live ⑮・mj_write は write.live ⓪）
  ok('⑨ public.mj_* に mj_room_create が1本（全部で create・join・write・my_rooms・read・my_rules・account の7本＝段C・2d・A14・C2-1 §1b）', fn.filter((x) => x.name === 'mj_room_create').length === 1
    && fn.map((x) => x.name).sort().join(',') === 'mj_account,mj_my_rooms,mj_my_rules,mj_read,mj_room_create,mj_room_join,mj_write', JSON.stringify(fn.map((x) => x.name)));
  ok('⑨ definer・search_path 空・authenticated に EXECUTE・anon と PUBLIC に無し', fc && fc.definer === true
    && JSON.stringify(fc.config) === JSON.stringify(['search_path=""']) && !fc.anon && fc.auth && !fc.public, JSON.stringify(fc));
  ok('⑨ 部屋の関数は客から呼べない', Number(out.priv_anon) === 0, String(out.priv_anon));
  const errs = Object.keys(out).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + out[k]).join(' / '));
}
/* ⑩ 客の側から（anon の鍵＝弾かれる／捨てアカウント＝bad:op_id → signOut 後は mj_session）＝倉庫に何も残さない */
if (isTest) {
  const rpc = (bearer) => fetch(`${url}/rest/v1/rpc/mj_room_create`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_op_id: null, p_name: '甲', p_pass: 'x', p_rules: { players: 4 }, p_secrets: {} }),
  }).then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* 字 */ } return { s: r.status, t, j }; });
  const a0 = await rpc(anonKey);
  ok('⑩ anon の鍵の PostgREST は 401/403', a0.s === 401 || a0.s === 403, `${a0.s} ${a0.t.slice(0, 200)}`);

  const ks = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const srv = (Array.isArray(ks) ? ks : []).find((k) => k.name === 'service_role')?.api_key;
  const AU = (p, o = {}, key = anonKey) => fetch(`${url}/auth/v1${p}`, { ...o, headers: { apikey: key, 'Content-Type': 'application/json', ...(o.headers || {}) } })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
  const email = `mjrc-${crypto.randomBytes(4).toString('hex')}@${MAIL}`;
  const pw = 'Pw-' + crypto.randomBytes(12).toString('hex');
  let who = null;
  if (!srv) ok('⑩ service_role の鍵が引けた', false);
  else {
    try {
      const cu = await AU('/admin/users', { method: 'POST', headers: { Authorization: `Bearer ${srv}` }, body: JSON.stringify({ email, password: pw, email_confirm: true }) }, srv);
      who = cu.j?.id || cu.j?.user?.id || null;
      ok('⑩ 捨てアカウントを admin で作れた（メールは送らない）', !!who, `${cu.s} ${JSON.stringify(cu.j).slice(0, 200)}`);
      const li = await AU('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: pw }) });
      const at = li.j?.access_token;
      ok('⑩ パスワードで入れた', !!at, `${li.s}`);
      if (at) {
        const a1 = await rpc(at);
        ok('⑩ 入った人の token で呼べて bad:op_id', a1.s === 200 && a1.j && a1.j.ok === false && a1.j.err === 'bad' && a1.j.what === 'op_id', `${a1.s} ${a1.t.slice(0, 200)}`);
        const lo = await AU('/logout', { method: 'POST', headers: { Authorization: `Bearer ${at}` } });
        ok('⑩ signOut できた', lo.s === 204 || lo.s === 200, String(lo.s));
        const a2 = await rpc(at);
        ok('⑩ signOut 後の同じ token は mj_session', a2.s === 200 && a2.j && a2.j.ok === false && a2.j.err === 'mj_session', `${a2.s} ${a2.t.slice(0, 200)}`);
      }
    } finally {
      if (who) {
        const dl = await AU(`/admin/users/${who}`, { method: 'DELETE', headers: { Authorization: `Bearer ${srv}` } }, srv);
        ok('⑩ 捨てアカウントを消した', dl.s === 200 || dl.s === 204, String(dl.s));
      }
    }
  }
  /* 残り：仮の人・捨てアカウント・その accounts の行・試験の部屋 */
  const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.accounts a left join auth.users x on x.id = a.user_id where x.id is null) as orphan,
    (select count(*)::int from mahjong.rooms where name = '甲の部屋' or name ~ '^乙[0-9]+$') as rooms`);
  let left = null; try { left = JSON.parse(lf.text)[0]; } catch (_) { /* 字 */ }
  ok('倉庫に試験の人・部屋が1つも残っていない', left && left.u === 0 && left.orphan === 0 && left.rooms === 0, lf.text.slice(0, 200));
}
console.log(`\nroom-create: ${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
