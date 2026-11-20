/* room-join.live.mjs — ★入口 public.mj_room_join を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * 案 room_join_sekkei.md v1.2 の「試験」⓪〜⑮（設計図 v18.3 G・K-7・K-10・§3.2）：
 *  ⓪ 人＝mj_me で弾く（claims 無し・匿名・session 無し・他人の session_id）＝mj_session・何も増えない
 *  ① 形の違い＝bad:what・何も増えない
 *  ② pass で入る→again:false・nyu・pass／同じ人→again:true・行1つ・ok1h そのまま／外れのパスでも again（bf を見ていない）・時間も測る
 *  ③ url で入る（lib/url-token.mjs の newToken・tokenHash で作った部屋）／hash の字＝bad:key／別の 32 hex＝wrong・ufail+1・fail1m そのまま
 *     倉庫の hash と lib の hash が同じ
 *  ④ 外れ4回→fail_count 4／5回目→locked 15分・fail_count 0／locked に正しいパス＝locked（数えない）／url は入れる／入っている人は again
 *  ⑤ パスで新しく入ると fail_count 0・url と again では戻らない
 *  ⑥ 人ごと1分10→busy:user（pass・url とも・数えない）・窓を前の分にずらすと通る
 *  ⑦ 全体1分100→pass は busy:all・url は通る・窓が明けたら通る
 *  ⑧ 無い番号→wrong・fail1m・ufail +1／在る部屋の外れと無い番号の時間（塊の中の clock_timestamp・各20回）の中央値の差が bf 1回の 25% 内
 *  ⑨ 消した部屋→gone（入っている人も）・行を作らない ⑩ 人数の上限→full ⑪ ok1h 60→busy:room・1時間より前の窓は数えず消える
 *  ⑫ room_bans に在る人→removed（数えない）・印を消すと入れる
 *  ⑬ anon は 401/403・捨てアカウントで外れ→wrong で数えが残る／GET と Prefer: tx=rollback で外れを送って「wrong なのに数えが残らない」道が無い
 *  ⑭ 平文のパス・token が rooms・room_accounts・limits の字に無い ⑮ 関数の権限（public.mj_* 2本・definer・search_path 空・authenticated だけ）
 *  ★wrong 以外の ok でない返しの後は数え（limits の join:*・fail_count・room_accounts）が1つも増えていない★
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝仮の人・部屋も全部戻る）。
 * ⑬ の捨てアカウントの数え（limits の join:*）は最後に消す（mahjong の limits を書くのは試験だけ＝khaw の客の行は0）。
 * ★同じ人の同時の join 2本・掃除との輪は1つの取引では並べられない（dblink 無し）＝見立て★
 * 使い方: node tests/room-join.live.mjs
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
const anonKey = /key:\s*'([^']+)'/.exec(src)[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1];
/* ★倉庫の門（設計 I-6）★ ref の sha256 の頭16字で照らす＝khaw でなければ1行も呼ばずに止める */
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const MAIL = 'mj-room-join.invalid';
const PASS = 'Zq9Pass';
const BADPASS = 'Wr0ngPass';
const TOK = newToken();                       // ★lib で作る★（自分で作って自分で hash しない）
const TOKH = await tokenHash(TOK);
const OTHER = newToken();
const L = (s) => (s === null ? 'null' : lit(s));
/* 呼び（引数は SQL の式） */
const J = (way, no, key, pass) => `public.mj_room_join(${way}, ${no}, ${key}, ${pass})`;
const JP = (pass) => J(L('pass'), 'v_no', 'null', L(pass));               // この部屋にパスで
const JU = (key) => J(L('url'), 'null', L(key), 'null');                   // URL で
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated')::text, true);`;
const N_U = 8;                                // 1＝持ち主 2＝pass で入る 3＝url で入る 4＝外す人 5〜7＝入る人 8＝別の部屋の人

/* 数え（ok でない返しの前後で比べる） */
const CNT = `jsonb_build_object('ra', (select count(*) from mahjong.room_accounts where room_id = rid),
  'fail', (select fail_count from mahjong.rooms where id = rid),
  'lock', (select locked_until is not null from mahjong.rooms where id = rid),
  'f1m', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:fail1m'),
  'uf', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ufail1m'),
  'ok1h', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ok1h'),
  'bans', (select count(*) from mahjong.room_bans where room_id = rid))`;
/* 1つ呼んで key に入れる（例外も拾う）＋前後の数え */
const T = (key, expr) => `cx := ${CNT};
    begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r, '${key}_c0', cx, '${key}_c1', ${CNT});`;
/* 塊の中だけで書いて戻す */
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;

/* ① 形の違い（人は 5＝まだ入っていない）：[名, 呼び, what] */
const BAD = [
  ['way が admin', J(L('admin'), 'v_no', 'null', L(PASS)), 'way'],
  ['way が null', J('null', 'v_no', 'null', L(PASS)), 'way'],
  ['pass に key も在る（取り違え）', J(L('pass'), 'v_no', L(TOK), L(PASS)), 'key'],
  ['room_no が null', J(L('pass'), 'null', 'null', L(PASS)), 'room_no'],
  ['room_no 7字', J(L('pass'), 'substr(v_no, 2)', 'null', L(PASS)), 'room_no'],
  ['room_no に字', J(L('pass'), L('1234567a'), 'null', L(PASS)), 'room_no'],
  ['パス null', J(L('pass'), 'v_no', 'null', 'null'), 'pass'],
  ['パス3字', J(L('pass'), 'v_no', 'null', L('abc')), 'pass'],
  ['パス65字', J(L('pass'), 'v_no', 'null', L('x'.repeat(65))), 'pass'],
  ['パスがそろえて73 byte 以上', J(L('pass'), 'v_no', 'null', L('㍿'.repeat(7))), 'pass'],
  ['url に room_no も在る（取り違え）', J(L('url'), 'v_no', L(TOK), 'null'), 'room_no'],
  ['url に pass も在る（取り違え）', J(L('url'), 'null', L(TOK), L(PASS)), 'pass'],
  ['key が null', J(L('url'), 'null', 'null', 'null'), 'key'],
  ['key 31字', JU(TOK.slice(1)), 'key'],
  ['key 33字', JU(TOK + 'a'), 'key'],
  ['key が大文字', JU(TOK.toUpperCase()), 'key'],
  ['key が hash の字（64字）', JU(TOKH), 'key'],
];

/* ⓪ 人で弾く：[名, claims] */
const SESS = [
  ['claims が無い', `perform set_config('request.jwt.claims', '', true);`],
  ['匿名の人', `perform set_config('request.jwt.claims', jsonb_build_object('sub', va, 'session_id', sa, 'role', 'authenticated')::text, true);`],
  ['session が倉庫に無い', `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[5], 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);`],
  ['他人の session_id', `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[5], 'session_id', ss[6], 'role', 'authenticated')::text, true);`],
];

/* ⑧ の時間：in_room＝在る部屋の外れ／ghost＝無い番号／bf＝crypt 1回（各20回・毎回 fail と数えを0に戻して locked・busy に当てない） */
const RESET = `update mahjong.rooms set fail_count = 0, locked_until = null where id = rid; delete from mahjong.limits where kind in ('join:fail1m', 'join:ufail1m');`;
const timing = `
    for i in 1..20 loop
      ${RESET}
      t0 := clock_timestamp(); r := ${JP(BADPASS)}; a_in := a_in || (extract(epoch from clock_timestamp() - t0) * 1000)::float8;
      if r->>'err' is distinct from 'wrong' then res := res || jsonb_build_object('tm_in_bad', r); end if;
      ${RESET}
      t0 := clock_timestamp(); r := ${J(L('pass'), 'v_ghost', 'null', L(BADPASS))}; a_gh := a_gh || (extract(epoch from clock_timestamp() - t0) * 1000)::float8;
      if r->>'err' is distinct from 'wrong' then res := res || jsonb_build_object('tm_gh_bad', r); end if;
      t0 := clock_timestamp(); perform extensions.crypt(${lit(BADPASS.toLowerCase())}, (select pass_hash from mahjong.rooms where id = rid));
      a_bf := a_bf || (extract(epoch from clock_timestamp() - t0) * 1000)::float8;
    end loop;
    res := res || jsonb_build_object('tm',
      jsonb_build_object('in', (select percentile_cont(0.5) within group (order by x) from unnest(a_in) x),
                         'gh', (select percentile_cont(0.5) within group (order by x) from unnest(a_gh) x),
                         'bf', (select percentile_cont(0.5) within group (order by x) from unnest(a_bf) x)));`;

const sql = `do ${q('rj')} declare res jsonb := '{}'; r jsonb; cx jsonb; rid uuid; v_no text; v_ghost text; i int;
  us uuid[] := '{}'; ss uuid[] := '{}'; va uuid := gen_random_uuid(); sa uuid := gen_random_uuid();
  t0 timestamptz; a_in float8[] := '{}'; a_gh float8[] := '{}'; a_bf float8[] := '{}'; a_ag float8[] := '{}';
  v_min timestamptz := date_trunc('minute', now());
begin
  /* 2b-2：khaw の前から在る古い行を先に掃く（掃除は ok の返しで走る＝表全体の数えが揺れない・塊の最後で全部戻る） */
  for i in 1..50 loop perform mahjong_private.mj_sweep(1000000); end loop;
  res := res || jsonb_build_object('others_left', (select count(*) from mahjong.rooms x where x.deleted_at < now() - interval '7 days' or (x.deleted_at is null and x.created_at < now() - interval '7 days' and (x.last_write_at is null or x.last_write_at < now() - interval '7 days') and not exists (select 1 from mahjong.hanchans h where h.room_id = x.id) and not exists (select 1 from mahjong.room_accounts a where a.room_id = x.id and a.last_seen >= now() - interval '7 days'))));
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous)
    select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.users (id, email, aud, role, is_anonymous) values (va, null, 'authenticated', 'authenticated', true);
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;
  insert into auth.sessions (id, user_id) values (sa, va);
  /* 部屋（人 1 が作る・URL の hash は lib の物） */
  ${asWho(1)}
  r := public.mj_room_create(gen_random_uuid(), ${lit('甲の部屋')}, ${lit(PASS)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${lit(TOKH)}));
  res := res || jsonb_build_object('made', r);
  rid := (r->>'room_id')::uuid; v_no := r->>'room_no';
  loop
    v_ghost := lpad((floor(random() * 100000000))::bigint::text, 8, '0');
    exit when not exists (select 1 from mahjong.rooms where room_no = v_ghost);
  end loop;
  res := res || jsonb_build_object('u', to_jsonb(us), 'rid', rid,
    'h_db', encode(sha256(convert_to(${lit(TOK)}, 'UTF8')), 'hex'), 'h_room', (select url_token_hash from mahjong.rooms where id = rid));
  /* ⓪ */
  ${SESS.map(([, who], i) => `${who}\n  ${T('s' + i, JP(PASS))}`).join('\n  ')}
  /* ① */
  ${asWho(5)}
  ${BAD.map((b, i) => T('b' + i, b[1])).join('\n  ')}
  /* ② */
  ${asWho(2)}
  ${T('p1', JP(PASS))}
  res := res || jsonb_build_object('p1_row', (select to_jsonb(a) from mahjong.room_accounts a where room_id = rid and user_id = us[2]));
  ${T('p2', JP(PASS))}
  ${T('p3', JP(BADPASS))}
  for i in 1..20 loop
    t0 := clock_timestamp(); r := ${JP(BADPASS)}; a_ag := a_ag || (extract(epoch from clock_timestamp() - t0) * 1000)::float8;
  end loop;
  res := res || jsonb_build_object('p_rows', (select count(*) from mahjong.room_accounts where room_id = rid and user_id = us[2]),
    'tm_again', (select percentile_cont(0.5) within group (order by x) from unnest(a_ag) x));
  /* 持ち主も again（持ち主の行は create の kan） */
  ${asWho(1)}
  ${T('own', JP(PASS))}
  /* ③ */
  ${asWho(3)}
  ${T('u1', JU(TOK))}
  res := res || jsonb_build_object('u1_row', (select to_jsonb(a) from mahjong.room_accounts a where room_id = rid and user_id = us[3]));
  ${undo('uw', T('uw', JU(OTHER)))}
  /* ④ 外れ（人 4） */
  ${undo('lk', `${asWho(4)}
    for i in 1..4 loop r := ${JP(BADPASS)}; res := res || jsonb_build_object('lk_w' || i, r); end loop;
    res := res || jsonb_build_object('lk_f4', (select fail_count from mahjong.rooms where id = rid));
    ${T('lk5', JP(BADPASS))}
    res := res || jsonb_build_object('lk_after', (select jsonb_build_object('fail', fail_count,
      'min', extract(epoch from locked_until - now()) / 60) from mahjong.rooms where id = rid));
    ${asWho(5)}
    ${T('lk_ok', JP(PASS))}
    ${T('lk_url', JU(TOK))}
    ${asWho(2)}
    ${T('lk_again', JP(PASS))}`)}
  /* ⑤ fail_count を0に戻すのはパスで新しく入った時だけ */
  ${undo('fc', `update mahjong.rooms set fail_count = 3 where id = rid;
    ${asWho(5)}
    r := ${JU(TOK)}; res := res || jsonb_build_object('fc_url', r, 'fc_after_url', (select fail_count from mahjong.rooms where id = rid));
    ${asWho(2)}
    r := ${JP(PASS)}; res := res || jsonb_build_object('fc_again', r, 'fc_after_again', (select fail_count from mahjong.rooms where id = rid));
    ${asWho(6)}
    r := ${JP(PASS)}; res := res || jsonb_build_object('fc_pass', r, 'fc_after_pass', (select fail_count from mahjong.rooms where id = rid));`)}
  /* ⑥ 人ごと1分10 */
  ${undo('bu', `${asWho(4)}
    insert into mahjong.limits (kind, key, window_start, count) values ('join:ufail1m', us[4]::text, v_min, 10)
      on conflict (kind, key, window_start) do update set count = 10;
    ${T('bu_p', JP(BADPASS))}
    ${T('bu_ok', JP(PASS))}
    ${T('bu_u', JU(OTHER))}
    update mahjong.limits set window_start = v_min - interval '1 minute' where kind = 'join:ufail1m' and key = us[4]::text;
    ${T('bu_next', JP(BADPASS))}`)}
  /* ⑦ 全体1分100（pass だけ） */
  ${undo('ba', `delete from mahjong.limits where kind = 'join:fail1m';
    insert into mahjong.limits (kind, key, window_start, count) values ('join:fail1m', 'all', v_min, 100);
    ${asWho(4)}
    ${T('ba_p', JP(BADPASS))}
    ${asWho(5)}
    ${T('ba_u', JU(TOK))}
    ${asWho(6)}
    update mahjong.limits set window_start = v_min - interval '1 minute' where kind = 'join:fail1m';
    ${T('ba_next', JP(PASS))}`)}
  /* ⑧ 無い番号 */
  ${undo('gh', `${asWho(4)}
    ${T('gh', J(L('pass'), 'v_ghost', 'null', L(PASS)))}
    ${T('gh_u', JU(OTHER))}`)}
  ${undo('tm', `${asWho(4)} ${timing}`)}
  /* ⑨ 消した部屋 */
  ${undo('dl', `update mahjong.rooms set deleted_at = now() where id = rid;
    ${asWho(5)}
    ${T('dl_p', JP(PASS))}
    ${T('dl_u', JU(TOK))}
    ${T('dl_bad', JP(BADPASS))}
    ${asWho(2)}
    ${T('dl_in', JP(PASS))}`)}
  /* ⑩ 人数の上限（上限を今の人数に下げる） */
  ${undo('fu', `update mahjong.mj_caps set cap = (select count(*) from mahjong.room_accounts where room_id = rid) where tbl = 'room_accounts' and scope = 'room';
    ${asWho(5)}
    ${T('fu', JP(PASS))}
    ${asWho(2)}
    ${T('fu_in', JP(PASS))}
    update mahjong.mj_caps set cap = cap + 1 where tbl = 'room_accounts' and scope = 'room';
    ${asWho(5)}
    ${T('fu_m1', JP(PASS))}`)}
  /* ⑪ 部屋ごとの新しい入り 1時間60 */
  ${undo('br', `delete from mahjong.limits where kind = 'join:ok1h' and key = rid::text;
    insert into mahjong.limits (kind, key, window_start, count) values ('join:ok1h', rid::text, date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00'), 60);
    ${asWho(5)}
    ${T('br', JP(PASS))}
    ${asWho(2)}
    ${T('br_in', JP(PASS))}
    update mahjong.limits set window_start = window_start - interval '65 minutes' where kind = 'join:ok1h' and key = rid::text;
    ${asWho(5)}
    ${T('br_next', JP(PASS))}
    res := res || jsonb_build_object('br_old', (select count(*) from mahjong.limits where kind = 'join:ok1h' and key = rid::text and window_start <= now() - interval '1 hour'));`)}
  /* ⑫ 出した人の印 */
  ${undo('bn', `insert into mahjong.room_bans (room_id, user_id) values (rid, us[7]);
    ${asWho(7)}
    ${T('bn', JP(PASS))}
    ${T('bn_u', JU(TOK))}
    delete from mahjong.room_bans where room_id = rid and user_id = us[7];
    ${T('bn_next', JP(PASS))}`)}
  /* ⑭ 平文の字（②③の後・外れのパスも送った後） */
  res := res || jsonb_build_object('plain', jsonb_build_object(
    'rooms', (select to_jsonb(x)::text from mahjong.rooms x where x.id = rid),
    'ra', (select coalesce(jsonb_agg(to_jsonb(a)), '[]')::text from mahjong.room_accounts a where a.room_id = rid),
    'lim', (select coalesce(jsonb_agg(to_jsonb(l)), '[]')::text from mahjong.limits l where l.kind like 'join:%')));
  /* ⑮ */
  res := res || jsonb_build_object('funcs', (select jsonb_agg(jsonb_build_object('name', p.proname, 'definer', p.prosecdef, 'config', p.proconfig,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public', exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) order by p.proname)
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'mj\\_%'));
  raise exception 'MJRESULT%', res::text;
end ${q('rj')};`;

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
const so = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort().map((k) => k + ':' + JSON.stringify(o[k])).join(',') : JSON.stringify(o));
const same = (a, b) => so(a) === so(b);
const dd = (a, b) => (a && b ? Object.fromEntries(Object.keys(a).map((k) => [k, typeof a[k] === 'boolean' ? `${a[k]}→${b[k]}` : Number(b[k]) - Number(a[k])])) : null);
const R = (k) => (out && out[k]) || {};
const isErr = (k, err, extra = {}) => { const r = R(k); return r.ok === false && r.err === err && Object.entries(extra).every(([x, v]) => r[x] === v); };
const still = (k) => same(out[k + '_c0'], out[k + '_c1']);
const delta = (k) => dd(out[k + '_c0'], out[k + '_c1']);
const okRet = (k, again, role = 'nyu') => { const r = R(k); return r.ok === true && r.again === again && r.role === role && r.room_id === out.rid
  && Object.keys(r).sort().join(',') === 'again,channel_key,name,ok,role,room_id,room_no'; };

if (out) {
  ok('khaw に前から在る古い部屋は先に掃けた（0＝表全体の数えが掃除で揺れない・taiketsu 直し N1）', Number(out.others_left) === 0, String(out.others_left));
  ok('部屋を作れた（URL の hash は lib/url-token.mjs の物）', out.made && out.made.ok === true, JSON.stringify(out.made));
  /* ⓪ */
  SESS.forEach(([name], i) => {
    ok('⓪ ' + name + ' → mj_session', isErr('s' + i, 'mj_session') && Object.keys(R('s' + i)).length === 2, JSON.stringify(R('s' + i)));
    ok('⓪ ' + name + ' で何も増えない', still('s' + i), JSON.stringify(delta('s' + i)));
  });
  /* ① */
  BAD.forEach(([name, , what], i) => {
    ok('① ' + name + ' → bad:' + what, isErr('b' + i, 'bad', { what }), JSON.stringify(R('b' + i)));
    ok('① ' + name + ' で何も増えない', still('b' + i), JSON.stringify(delta('b' + i)));
  });
  /* ② */
  ok('② パスで入れた＝again:false・nyu・返しの鍵7つ', okRet('p1', false), JSON.stringify(R('p1')));
  ok('② 返しの room_no・name・channel_key が部屋の物', R('p1').room_no === out.made.room_no && R('p1').name === '甲の部屋' && R('p1').channel_key === out.made.channel_key);
  ok('② room_accounts に nyu・pass の行', out.p1_row && out.p1_row.role === 'nyu' && out.p1_row.joined_via === 'pass' && out.p1_row.member_id === null, JSON.stringify(out.p1_row));
  ok('② 入って room_accounts +1・ok1h +1・外れの数えは増えない', same(delta('p1'), { ra: 1, fail: 0, lock: 'false→false', f1m: 0, uf: 0, ok1h: 1, bans: 0 }), JSON.stringify(delta('p1')));
  ok('② 同じ人＝again:true', okRet('p2', true), JSON.stringify(R('p2')));
  ok('② again で何も増えない（ok1h もそのまま）', still('p2'), JSON.stringify(delta('p2')));
  ok('② 外れのパスでも again:true（bf を回していない）', okRet('p3', true), JSON.stringify(R('p3')));
  ok('② 外れのパスの again で数えが増えない', still('p3'), JSON.stringify(delta('p3')));
  ok('② 行は1つのまま', Number(out.p_rows) === 1, String(out.p_rows));
  ok('② again の時間は bf 1回の 1/4 より短い', out.tm && Number(out.tm_again) < Number(out.tm.bf) / 4, JSON.stringify({ again: out.tm_again, bf: out.tm && out.tm.bf }));
  ok('② 持ち主も again:true・役は kan', okRet('own', true, 'kan'), JSON.stringify(R('own')));
  /* ③ */
  ok('③ 倉庫の hash（sha256 の hex）と lib の hash が同じ', out.h_db === TOKH, `${out.h_db} / ${TOKH}`);
  ok('③ 部屋の url_token_hash は lib の hash', out.h_room === TOKH);
  ok('③ URL で入れた＝again:false', okRet('u1', false), JSON.stringify(R('u1')));
  ok('③ room_accounts に nyu・url の行', out.u1_row && out.u1_row.role === 'nyu' && out.u1_row.joined_via === 'url', JSON.stringify(out.u1_row));
  ok('③ URL で入って ok1h +1・外れは増えない', same(delta('u1'), { ra: 1, fail: 0, lock: 'false→false', f1m: 0, uf: 0, ok1h: 1, bans: 0 }), JSON.stringify(delta('u1')));
  ok('③ 別の 32 hex＝wrong', isErr('uw', 'wrong'), JSON.stringify(R('uw') || out.uw_err));
  ok('③ URL の外れは ufail +1・fail1m と fail_count は増えない', same(delta('uw'), { ra: 0, fail: 0, lock: 'false→false', f1m: 0, uf: 1, ok1h: 0, bans: 0 }), JSON.stringify(delta('uw')));
  /* ④ */
  ok('④ 外れ4回は wrong', [1, 2, 3, 4].every((i) => (out['lk_w' + i] || {}).err === 'wrong'), JSON.stringify([1, 2, 3, 4].map((i) => out['lk_w' + i])));
  ok('④ 外れ4回で fail_count 4', Number(out.lk_f4) === 4, String(out.lk_f4));
  ok('④ 5回目も wrong', isErr('lk5', 'wrong'), JSON.stringify(R('lk5') || out.lk_err));
  ok('④ 5回目で locked 15分・fail_count 0', out.lk_after && out.lk_after.fail === 0 && Math.abs(out.lk_after.min - 15) < 0.2, JSON.stringify(out.lk_after));
  ok('④ locked の部屋に正しいパス＝locked（until 付き）', isErr('lk_ok', 'locked') && !!R('lk_ok').until, JSON.stringify(R('lk_ok')));
  ok('④ locked の返しで数えが増えない', still('lk_ok'), JSON.stringify(delta('lk_ok')));
  ok('④ locked でも URL では入れる', okRet('lk_url', false), JSON.stringify(R('lk_url')));
  ok('④ locked でも入っている人は again', okRet('lk_again', true), JSON.stringify(R('lk_again')));
  /* ⑤ */
  ok('⑤ URL で入っても fail_count は戻らない', (out.fc_url || {}).ok === true && Number(out.fc_after_url) === 3, JSON.stringify({ r: out.fc_url, f: out.fc_after_url, e: out.fc_err }));
  ok('⑤ again でも fail_count は戻らない', (out.fc_again || {}).again === true && Number(out.fc_after_again) === 3, String(out.fc_after_again));
  ok('⑤ パスで新しく入ると fail_count 0', (out.fc_pass || {}).again === false && Number(out.fc_after_pass) === 0, JSON.stringify({ r: out.fc_pass, f: out.fc_after_pass }));
  /* ⑥ */
  ok('⑥ 人ごと1分10の後＝busy:user（外れのパス）', isErr('bu_p', 'busy', { what: 'user' }), JSON.stringify(R('bu_p') || out.bu_err));
  ok('⑥ 人ごと1分10の後＝busy:user（正しいパスでも）', isErr('bu_ok', 'busy', { what: 'user' }), JSON.stringify(R('bu_ok')));
  ok('⑥ 人ごと1分10の後＝busy:user（URL も）', isErr('bu_u', 'busy', { what: 'user' }), JSON.stringify(R('bu_u')));
  ok('⑥ busy:user で数えが増えない', still('bu_p') && still('bu_ok') && still('bu_u'), JSON.stringify([delta('bu_p'), delta('bu_ok'), delta('bu_u')]));
  ok('⑥ 窓を前の分にずらすと通る（wrong＝bf まで行った）', isErr('bu_next', 'wrong'), JSON.stringify(R('bu_next')));
  /* ⑦ */
  ok('⑦ 全体1分100の後＝pass は busy:all', isErr('ba_p', 'busy', { what: 'all' }), JSON.stringify(R('ba_p') || out.ba_err));
  ok('⑦ busy:all で数えが増えない', still('ba_p'), JSON.stringify(delta('ba_p')));
  ok('⑦ 全体1分100でも URL は通る', okRet('ba_u', false), JSON.stringify(R('ba_u')));
  ok('⑦ 窓が明けたらパスで入れる', okRet('ba_next', false), JSON.stringify(R('ba_next')));
  /* ⑧ */
  ok('⑧ 無い番号＝wrong', isErr('gh', 'wrong') && Object.keys(R('gh')).length === 2, JSON.stringify(R('gh') || out.gh_err));
  ok('⑧ 無い番号で fail1m +1・ufail +1（部屋の fail_count は触らない）', same(delta('gh'), { ra: 0, fail: 0, lock: 'false→false', f1m: 1, uf: 1, ok1h: 0, bans: 0 }), JSON.stringify(delta('gh')));
  ok('⑧ 無い URL＝wrong・ufail +1 だけ', isErr('gh_u', 'wrong') && same(delta('gh_u'), { ra: 0, fail: 0, lock: 'false→false', f1m: 0, uf: 1, ok1h: 0, bans: 0 }), JSON.stringify([R('gh_u'), delta('gh_u')]));
  ok('⑧ 時間の測りで返しが全部 wrong', !out.tm_in_bad && !out.tm_gh_bad && !out.tm_err, JSON.stringify({ a: out.tm_in_bad, b: out.tm_gh_bad, e: out.tm_err }));
  ok('⑧ 在る部屋の外れと無い番号の時間の差が bf 1回の 25% 内', out.tm && Math.abs(out.tm.in - out.tm.gh) <= out.tm.bf * 0.25, JSON.stringify(out.tm));
  /* ⑨ */
  ok('⑨ 消した部屋＝gone（パス）', isErr('dl_p', 'gone'), JSON.stringify(R('dl_p') || out.dl_err));
  ok('⑨ 消した部屋＝gone（URL）', isErr('dl_u', 'gone'), JSON.stringify(R('dl_u')));
  ok('⑨ 消した部屋＝外れのパスでも gone（bf の前）', isErr('dl_bad', 'gone'), JSON.stringify(R('dl_bad')));
  ok('⑨ 消した部屋＝入っている人も gone', isErr('dl_in', 'gone'), JSON.stringify(R('dl_in')));
  ok('⑨ gone で行も数えも増えない', ['dl_p', 'dl_u', 'dl_bad', 'dl_in'].every(still), JSON.stringify(['dl_p', 'dl_u', 'dl_bad', 'dl_in'].map(delta)));
  /* ⑩ */
  ok('⑩ 人数が上限＝full', isErr('fu', 'full'), JSON.stringify(R('fu') || out.fu_err));
  ok('⑩ full で何も増えない', still('fu'), JSON.stringify(delta('fu')));
  ok('⑩ 上限でも入っている人は again', okRet('fu_in', true), JSON.stringify(R('fu_in')));
  ok('⑩ 上限を1上げると入れる', okRet('fu_m1', false), JSON.stringify(R('fu_m1')));
  /* ⑪ */
  ok('⑪ 部屋の新しい入り1時間60の後＝busy:room', isErr('br', 'busy', { what: 'room' }), JSON.stringify(R('br') || out.br_err));
  ok('⑪ busy:room で何も増えない', still('br'), JSON.stringify(delta('br')));
  ok('⑪ busy:room でも入っている人は again', okRet('br_in', true), JSON.stringify(R('br_in')));
  ok('⑪ 1時間より前の窓は数えず入れる', okRet('br_next', false), JSON.stringify(R('br_next')));
  ok('⑪ 1時間より前の窓は入った時に消える', Number(out.br_old) === 0, String(out.br_old));
  /* ⑫ */
  ok('⑫ 出した人＝removed（パス）', isErr('bn', 'removed') && Object.keys(R('bn')).length === 2, JSON.stringify(R('bn') || out.bn_err));
  ok('⑫ 出した人＝removed（URL）', isErr('bn_u', 'removed'), JSON.stringify(R('bn_u')));
  ok('⑫ removed で数えが増えない', still('bn') && still('bn_u'), JSON.stringify([delta('bn'), delta('bn_u')]));
  ok('⑫ 印を消すと入れる', okRet('bn_next', false), JSON.stringify(R('bn_next')));
  /* ⑭ */
  const pl = out.plain || {};
  const hits = ['rooms', 'ra', 'lim'].filter((k) => { const s = String(pl[k] || '').toLowerCase();
    return [PASS, BADPASS, TOK, OTHER].some((x) => s.includes(x.toLowerCase())); });
  ok('⑭ 平文のパス・外れのパス・token が rooms・room_accounts・limits の字に無い', pl.rooms && hits.length === 0, hits.join(','));
  /* ⑮ */
  const fn = out.funcs || [];
  ok('⑮ public.mj_* は mj_room_create・mj_room_join の2本', fn.map((x) => x.name).join(',') === 'mj_room_create,mj_room_join', JSON.stringify(fn.map((x) => x.name)));
  ok('⑮ 2本とも definer・search_path 空・authenticated だけに EXECUTE', fn.length === 2 && fn.every((x) => x.definer === true
    && JSON.stringify(x.config) === JSON.stringify(['search_path=""']) && !x.anon && x.auth && !x.public), JSON.stringify(fn));
  const errs = Object.keys(out).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + out[k]).join(' / '));
  const raised = Object.keys(out).filter((k) => out[k] && typeof out[k] === 'object' && 'raised' in out[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + out[k].raised).join(' / '));
}

/* ⑬ 客の側から（anon＝弾かれる／捨てアカウント＝外れが数えに残る・GET と tx=rollback で数えが消える道が無い） */
if (isTest) {
  const body = (no) => ({ p_way: 'pass', p_room_no: no, p_key: null, p_pass: BADPASS });
  const rpc = (bearer, opt = {}) => fetch(`${url}/rest/v1/rpc/mj_room_join${opt.qs || ''}`, {
    method: opt.method || 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(opt.headers || {}) },
    body: opt.method === 'GET' ? undefined : JSON.stringify(opt.body),
  }).then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* 字 */ } return { s: r.status, t, j }; });
  const a0 = await rpc(anonKey, { body: body('00000000') });
  ok('⑬ anon の鍵の PostgREST は 401/403', a0.s === 401 || a0.s === 403, `${a0.s} ${a0.t.slice(0, 200)}`);

  const ks = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const srv = (Array.isArray(ks) ? ks : []).find((k) => k.name === 'service_role')?.api_key;
  const AU = (pth, o = {}, key = anonKey) => fetch(`${url}/auth/v1${pth}`, { ...o, headers: { apikey: key, 'Content-Type': 'application/json', ...(o.headers || {}) } })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
  const email = `mjrj-${crypto.randomBytes(4).toString('hex')}@${MAIL}`;
  const pw = 'Pw-' + crypto.randomBytes(12).toString('hex');
  let who = null;
  const uf = async (id) => { const r = await mq(`select coalesce(sum(count), 0)::int as n from mahjong.limits where kind = 'join:ufail1m' and key = ${lit(id)}`);
    try { return JSON.parse(r.text)[0].n; } catch (_) { return null; } };
  /* 無い番号（倉庫に無い事を先に見る） */
  let ghost = null;
  for (let i = 0; i < 20 && !ghost; i++) {
    const g = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const r = await mq(`select count(*)::int as n from mahjong.rooms where room_no = ${lit(g)}`);
    try { if (JSON.parse(r.text)[0].n === 0) ghost = g; } catch (_) { /* 次 */ }
  }
  if (!srv) ok('⑬ service_role の鍵が引けた', false);
  else if (!ghost) ok('⑬ 無い番号を選べた', false);
  else {
    try {
      const cu = await AU('/admin/users', { method: 'POST', headers: { Authorization: `Bearer ${srv}` }, body: JSON.stringify({ email, password: pw, email_confirm: true }) }, srv);
      who = cu.j?.id || cu.j?.user?.id || null;
      ok('⑬ 捨てアカウントを admin で作れた（メールは送らない）', !!who, `${cu.s} ${JSON.stringify(cu.j).slice(0, 200)}`);
      const li = await AU('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: pw }) });
      const at = li.j?.access_token;
      ok('⑬ パスワードで入れた', !!at, `${li.s}`);
      if (at && who) {
        const n0 = await uf(who);
        const a1 = await rpc(at, { body: body(ghost) });
        const n1 = await uf(who);
        ok('⑬ PostgREST から外れ＝wrong', a1.s === 200 && a1.j && a1.j.ok === false && a1.j.err === 'wrong', `${a1.s} ${a1.t.slice(0, 200)}`);
        ok('⑬ PostgREST の外れが数えに残る（ufail +1）', n1 === n0 + 1, `${n0}→${n1}`);
        const qs = '?' + new URLSearchParams({ p_way: 'pass', p_room_no: ghost, p_pass: BADPASS }).toString();
        const g1 = await rpc(at, { method: 'GET', qs });
        const n2 = await uf(who);
        const gWrong = g1.s === 200 && g1.j && g1.j.err === 'wrong';
        ok('⑬ GET の呼びで「wrong なのに数えが残らない」道が無い', !gWrong || n2 === n1 + 1, `${g1.s} ${g1.t.slice(0, 160)} 数え ${n1}→${n2}`);
        const t1 = await rpc(at, { body: body(ghost), headers: { Prefer: 'tx=rollback' } });
        const n3 = await uf(who);
        const tWrong = t1.s === 200 && t1.j && t1.j.err === 'wrong';
        ok('⑬ Prefer: tx=rollback で「wrong なのに数えが残らない」道が無い', !tWrong || n3 === n2 + 1, `${t1.s} ${t1.t.slice(0, 160)} 数え ${n2}→${n3}`);
        console.log(`    （測り：GET＝${g1.s}・tx=rollback＝${t1.s}・数え ${n0}→${n1}→${n2}→${n3}）`);
      }
    } finally {
      if (who) {
        const dl = await AU(`/admin/users/${who}`, { method: 'DELETE', headers: { Authorization: `Bearer ${srv}` } }, srv);
        ok('⑬ 捨てアカウントを消した', dl.s === 200 || dl.s === 204, String(dl.s));
        /* limits の key は字＝外部キーで消えない＝ここで消す（fail1m 'all' も試験が足した分＝mahjong の limits を書くのは試験だけ） */
        await mq(`delete from mahjong.limits where kind like 'join:%' and (key = ${lit(who)} or (kind = 'join:fail1m' and window_start >= now() - interval '10 minutes'))`);
      }
    }
  }
  const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.accounts a left join auth.users x on x.id = a.user_id where x.id is null) as orphan,
    (select count(*)::int from mahjong.rooms where name = '甲の部屋') as rooms,
    (select count(*)::int from mahjong.limits where kind like 'join:%') as lim`);
  let left = null; try { left = JSON.parse(lf.text)[0]; } catch (_) { /* 字 */ }
  ok('倉庫に試験の人・部屋・join の数えが1つも残っていない', left && left.u === 0 && left.orphan === 0 && left.rooms === 0 && left.lim === 0, lf.text.slice(0, 200));
}
console.log(`\nroom-join: ${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
