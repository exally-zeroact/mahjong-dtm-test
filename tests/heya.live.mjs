/* heya.live.mjs — ★段C：部屋は見る時だけ＋部屋名とパス4桁で入る（紙 heya_mirutoki_sadame.md v10・v10.1・v10.2）を本物のテスト倉庫で叩く★
 * =============================================================================
 * 手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす）。
 * A＝1つの取引の塊（最後にわざと例外を投げて全部戻す＝倉庫に何も残さない）で §8 を見る：
 *   部屋なし：作る→番号・名前が出ない／番号・url・名前の3つで部屋なしと無い部屋の返しが同じ（例外0）／sweep を回しても（30日進めても）消えない
 *     ／持ち主の room_delete は7日後に消える／room_secret・room_close は bad kind／room_share で shared になり名前で入れる／mj_my_rooms に出る
 *   数え：create 5回の後の room_share が busy user・逆も／busy で数え・totals が変わらない／room_close→room_delete→物理の消しで rooms_all が1回だけ減る
 *     ／数え直しと足し引きが同じ値／部屋なしをいくつ作っても R を見ない
 *   組：同じ名前・違うパスで2部屋・それぞれに入る／同じ組は dup／揺れでも同じ／終えた後は同じ組で作れ新しい方に入る／送り直しは ok で数えない
 *     ／名前ごと5回で止め（join・create・room_share から）・当たっても戻らない／room_secret 4回目 busy・塊が戻っても数えは残る・他の部屋と同じパスは dup
 *     ／消した部屋の組（★実装で紙と違えた所＝消した印の7日の部屋も組を持つ・room_undelete は比べない★）／ambiguous は数えない
 *     ／閉じた部屋は入っている人 again closed・他は closed・書きは bad closed／room_share・room_secret の送り直しは今の channel_key
 * B＝同時（1つの取引では並べられない＝ここだけ倉庫に書いて finally で消す）：同じ組で create×create・room_share×create・room_secret×create・
 *   create×room_share・create×room_secret を2本の接続で走らせ、開いた部屋がちょうど1つか（1本目は書いた後 3秒寝てから閉じる）。
 * --waza：9つ壊して狙った試験が赤になるか（1〜7・9 は A の塊の初めに壊した関数を当てる＝塊ごと戻る／8 は B＝壊した関数を当てて回し finally で当て直す）。
 * 使い方: node tests/heya.live.mjs [--waza]
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
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(/url:\s*'([^']+)'/.exec(src)[1])[1];
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2' || !/env:\s*'test'/.test(src)) {
  console.log('★中止★ 倉庫が khaw（test）でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1);
}
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
const WAZA = process.argv.includes('--waza');

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}
async function rows(query) {
  const { status, text } = await mq(query);
  let j = null; try { j = JSON.parse(text); } catch (_) { /* 字 */ }
  if (status >= 300 || !Array.isArray(j)) throw new Error(`倉庫 ${status}: ${text.slice(0, 400)}`);
  return j;
}

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const MAIL = 'mj-heya.invalid';
const NB = 'hy' + crypto.randomBytes(3).toString('hex');      // 回りごとの名前の頭（khaw の他の部屋と当たらない）
const P = (s) => NB + 'の' + s;
const N_U = 8;
const EP = `floor(extract(epoch from now()))`;
const AMRF = `jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', ${AMRF})::text, true);`;
const URLH = `md5(random()::text) || md5(random()::text)`;
const C = (name, pass, url = URLH, op = 'gen_random_uuid()') =>
  `public.mj_room_create(${op}, ${name === null ? 'null' : lit(name)}, ${pass === null ? 'null' : lit(pass)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${url}))`;
const JN = (name, pass) => `public.mj_room_join('name', null, null, ${lit(pass)}, ${lit(name)})`;
const JP = (no, pass) => `public.mj_room_join('pass', ${no}, null, ${lit(pass)})`;
const JU = (key) => `public.mj_room_join('url', null, ${key}, null)`;
const OPS = (op, f = {}) => `jsonb_build_array(jsonb_build_object('op', '${op}'${Object.entries(f).map(([k, v]) => `, '${k}', ${v}`).join('')}))`;
const SH = (name, pass) => OPS('room_share', { name: lit(name), pass: lit(pass), url_token_hash: URLH });
const SEC = (pass) => OPS('room_secret', { pass: lit(pass), url_token_hash: URLH });
const WR = (room, ops, op = 'gen_random_uuid()') => `public.mj_write(${room}, ${op}, ${ops})`;
/* 1つ呼んで key に入れる（例外も拾う） */
/* P3：1つの取引の中は now() が同じ＝同じ人の続けての呼びが人ごとの1分の窓（create:u1m 5・join:ubf1m 20）に当たる＝T は呼ぶ前に空ける（その窓は room-create・room-join と下の ub・um で試す） */
const Z = `delete from mahjong.limits where kind in ('create:u1m', 'join:ubf1m');`;
const T0 = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const T = (key, expr) => `${Z} ${T0(key, expr)}`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const CNT = `jsonb_build_object('rooms', (select count(*) from mahjong.rooms), 'totals', (select rooms_all from mahjong.totals where id = 1),
  'c1m', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'create:1m'), 'c1d', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'create:1d'),
  'u1d', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'create:u1d'), 'nf', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:nfail1h'),
  'uf', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ufail1m'), 'f1m', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:fail1m'),
  'sec', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'secret:r1d'), 'creates', (select count(*) from mahjong.creates),
  'su', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'create:su1d'), 'ud', (select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ufail1d'))`;   // P3
const SNAP = (key) => ROW(key, CNT);
const FORMULA = `(select count(*) from mahjong.rooms where kind = 'shared' and closed_at is null)`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;

const TOK_S = newToken(), TOKH_S = await tokenHash(TOK_S);   // 部屋なしの URL（lib で作る）
const TOK_C = newToken(), TOKH_C = await tokenHash(TOK_C);   // 終える部屋の URL
const TOK_X = newToken();                                     // どの部屋にも無い URL

/* ── A：1つの取引の塊 ── */
const mkSql = (prefix = '') => `do ${q('hy')} declare res jsonb := '{}'; r jsonb; c0 jsonb; c1 jsonb; i int; a0 int; ck text; ghost text;
  us uuid[] := '{}'; ss uuid[] := '{}'; s1 uuid; s2 uuid; ra uuid; rb uuid; rc uuid; op uuid; op2 uuid;
begin
  ${prefix}
  for i in 1..50 loop perform mahjong_private.mj_sweep(1000000); end loop;
  delete from mahjong.limits where kind in ('create:1m', 'create:1d');   -- 外の回りの数えに揺らされない（塊の最後で戻る）
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;
  ${ROW('f0', `select jsonb_build_object('t', (select rooms_all from mahjong.totals where id = 1), 'f', ${FORMULA})`)}
  loop ghost := lpad((floor(random() * 100000000))::bigint::text, 8, '0'); exit when not exists (select 1 from mahjong.rooms where room_no = ghost); end loop;

  /* ── 部屋なし ── */
  ${asWho(1)}
  ${SNAP('s_c0')}
  op := gen_random_uuid();
  ${T('s_make', C(null, null, lit(TOKH_S), 'op'))}
  s1 := (r->>'room_id')::uuid;
  ${SNAP('s_c1')}
  ${ROW('s_row', `select jsonb_build_object('name', name, 'pass_hash', pass_hash, 'name_key', name_key, 'kind', kind, 'no8', room_no ~ '^[0-9]{8}$', 'closed', closed_at) from mahjong.rooms where id = s1`)}
  ${T('s_again', C(null, null, lit(TOKH_S), 'op'))}
  ${T('s_kind', C(P('k'), '2741', lit(TOKH_S), 'op'))}
  ${SNAP('s_c2')}
  ${T('s_half1', C(P('k'), null))}
  ${T('s_half2', C(null, '2741'))}
  ${undo('sq', `${asWho(2)}
    ${SNAP('sq_c0')} ${T('sq_no', JP(`(select room_no from mahjong.rooms where id = s1)`, '2741'))} ${SNAP('sq_c1')}
    ${T('sq_no_g', JP('ghost', '2741'))} ${SNAP('sq_c2')}
    ${T('sq_url', JU(lit(TOK_S)))} ${SNAP('sq_c3')}
    ${T('sq_url_g', JU(lit(TOK_X)))} ${SNAP('sq_c4')}
    ${T('sq_name', JN('対局', '2741'))} ${SNAP('sq_c5')}
    ${T('sq_name_g', JN(P('none'), '2741'))} ${SNAP('sq_c6')}
    ${asWho(1)}
    ${T('sq_own', JU(lit(TOK_S)))}`)}
  ${undo('ssw', `${T('ssw_a', C(P('sw'), '2741'))} ra := (r->>'room_id')::uuid;
    update mahjong.rooms set created_at = now() - interval '30 days', last_write_at = null where id in (s1, ra);
    update mahjong.room_accounts set last_seen = now() - interval '30 days', joined_at = now() - interval '30 days' where room_id in (s1, ra);
    a0 := (select rooms_all from mahjong.totals where id = 1);
    for i in 1..5 loop perform mahjong_private.mj_sweep(1000000); end loop;
    ${ROW('ssw', `select jsonb_build_object('solo', (select deleted_at is null from mahjong.rooms where id = s1), 'shared', (select deleted_at is null from mahjong.rooms where id = ra),
      'all', (select rooms_all from mahjong.totals where id = 1) - a0)`)}`)}
  ${undo('sdel', `${T('sdel_w', WR('s1', OPS('room_delete')))}
    a0 := (select rooms_all from mahjong.totals where id = 1);
    update mahjong.rooms set deleted_at = now() - interval '6 days' where id = s1;
    for i in 1..3 loop perform mahjong_private.mj_sweep(1000000); end loop;
    ${ROW('sdel6', `select count(*) from mahjong.rooms where id = s1`)}
    update mahjong.rooms set deleted_at = now() - interval '8 days' where id = s1;
    for i in 1..3 loop perform mahjong_private.mj_sweep(1000000); end loop;
    ${ROW('sdel', `select jsonb_build_object('left', (select count(*) from mahjong.rooms where id = s1), 'all', (select rooms_all from mahjong.totals where id = 1) - a0)`)}`)}
  ${T('s_secret', WR('s1', SEC('8360')))}
  ${T('s_close', WR('s1', OPS('room_close')))}
  ${undo('sh', `${SNAP('sh_c0')}
    op2 := gen_random_uuid();
    ${T('sh', WR('s1', SH(P('sh'), '2741'), 'op2'))}
    ${SNAP('sh_c1')}
    ${ROW('sh_row', `select jsonb_build_object('kind', kind, 'name', name, 'nk', name_key = mahjong_private.mj_name_key(${lit(P('sh'))}), 'ch', channel_key, 'no_solo', pass_hash <> '!solo',
      'url', url_token_hash <> ${lit(TOKH_S)}) from mahjong.rooms where id = s1`)}
    ${ROW('sh_hist', `select jsonb_agg(jsonb_build_array(h.op, h.tbl, h.col, h.before_value, h.after_value)) from mahjong.history h where h.room_id = s1 and h.op = 'room_share'`)}
    ${ROW('sh_opr', `select result from mahjong.op_results where room_id = s1 and op_id = op2`)}
    update mahjong.rooms set channel_key = md5('heya-ch') where id = s1;
    ${T('sh_again', WR('s1', SH(P('sh'), '2741'), 'op2'))}
    ${T('sh_shared', WR('s1', SH(P('sh2'), '2741')))}
    ${asWho(2)}
    ${T('sh_join', JN(P('sh'), '2741'))}
    ${ROW('sh_jv', `select joined_via from mahjong.room_accounts where room_id = s1 and user_id = us[2]`)}
    ${asWho(1)}
    ${T('sh_my', `public.mj_my_rooms(null, null, 50)`)}`)}
  ${undo('my', `${T('my_a', C(P('my'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('my_close', WR('ra', OPS('room_close')))}
    ${T('my_all', `public.mj_my_rooms(null, null, 50)`)}
    ${T('my_p1', `public.mj_my_rooms(null, null, 1)`)}
    ${T('my_p2', `public.mj_my_rooms((select coalesce(last_write_at, created_at) from mahjong.rooms where id = (r -> 'rooms' -> 0 ->> 'room_id')::uuid), (r -> 'rooms' -> 0 ->> 'room_id')::uuid, 1)`)}
    ${T('my_b0', `public.mj_my_rooms(null, null, 0)`)}
    ${T('my_b51', `public.mj_my_rooms(null, null, 51)`)}
    ${T('my_bh', `public.mj_my_rooms(now(), null, 10)`)}
    ${asWho(3)}
    ${T('my_other', `public.mj_my_rooms(null, null, 50)`)}`)}

  /* ── 数え ── */
  ${undo('cu', `${asWho(3)}
    for i in 1..5 loop ${Z} r := ${C(null, null)}; end loop;
    ${T('cu_solo', C(null, null))} s2 := (r->>'room_id')::uuid;
    ${T('cu_c1', C(P('cu1'), '2741'))} ${T('cu_c2', C(P('cu2'), '2741'))} ${T('cu_c3', C(P('cu3'), '2741'))} ${T('cu_c4', C(P('cu4'), '2741'))} ${T('cu_c5', C(P('cu5'), '2741'))}
    ${SNAP('cu_s0')}
    ${T('cu_share', WR('s2', SH(P('cu6'), '2741')))}
    ${SNAP('cu_s1')}
    ${T('cu_c6', C(P('cu7'), '2741'))}
    ${SNAP('cu_s2')}`)}
  ${undo('cr', `${asWho(4)}
    ${T('cr_solo', C(null, null))} s2 := (r->>'room_id')::uuid;
    ${T('cr_c1', C(P('cr1'), '2741'))} ${T('cr_c2', C(P('cr2'), '2741'))} ${T('cr_c3', C(P('cr3'), '2741'))} ${T('cr_c4', C(P('cr4'), '2741'))}
    ${T('cr_share', WR('s2', SH(P('cr5'), '2741')))}
    ${SNAP('cr_s0')}
    ${T('cr_c5', C(P('cr6'), '2741'))}
    ${SNAP('cr_s1')}`)}
  ${undo('cl', `${T('cl_a', C(P('cl'), '2741'))} ra := (r->>'room_id')::uuid;
    a0 := (select rooms_all from mahjong.totals where id = 1);
    ${T('cl_close', WR('ra', OPS('room_close')))}
    ${ROW('cl_1', `select (select rooms_all from mahjong.totals where id = 1) - a0`)}
    ${ROW('cl_row', `select jsonb_build_object('closed', closed_at is not null, 'nk', name_key) from mahjong.rooms where id = ra`)}
    ${T('cl_again', WR('ra', OPS('room_close')))}
    ${T('cl_ma', WR('ra', OPS('member_add', { member_id: 'to_jsonb(gen_random_uuid()::text)', name: lit('甲') })))}
    ${T('cl_del', WR('ra', OPS('room_delete')))}
    ${ROW('cl_2', `select (select rooms_all from mahjong.totals where id = 1) - a0`)}
    update mahjong.rooms set deleted_at = now() - interval '8 days' where id = ra;
    for i in 1..3 loop perform mahjong_private.mj_sweep(1000000); end loop;
    ${ROW('cl_3', `select jsonb_build_object('left', (select count(*) from mahjong.rooms where id = ra), 'd', (select rooms_all from mahjong.totals where id = 1) - a0)`)}`)}
  ${undo('rc', `${asWho(5)}
    ${T('rc_a', C(P('rc'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('rc_s', C(null, null))} s2 := (r->>'room_id')::uuid;
    ${T('rc_sh', WR('s2', SH(P('rc2'), '2741')))}
    ${T('rc_cl', WR('ra', OPS('room_close')))}
    ${T('rc_s3', C(null, null))}
    ${ROW('rc_1', `select jsonb_build_object('t', (select rooms_all from mahjong.totals where id = 1), 'f', ${FORMULA})`)}
    delete from mahjong.limits where kind = 'sweep:recount' and window_start = date_trunc('day', now());
    perform mahjong_private.mj_sweep(100);
    ${ROW('rc_2', `select jsonb_build_object('t', (select rooms_all from mahjong.totals where id = 1), 'f', ${FORMULA},
      'mark', exists (select 1 from mahjong.limits where kind = 'sweep:recount' and window_start = date_trunc('day', now())))`)}`)}
  ${undo('rr', `update mahjong.totals set rooms_all = 10000 where id = 1;   -- P3：R をやめた＝開いた shared が 201 でも 10000 でも作れる
    ${asWho(6)}
    ${SNAP('rr_c0')}
    ${T('rr_s1', C(null, null))} s2 := (r->>'room_id')::uuid;
    ${T('rr_s2', C(null, null))} ${T('rr_s3', C(null, null))}
    ${SNAP('rr_c1')}
    ${T('rr_sh', C(P('rr'), '2741'))}
    ${T('rr_share', WR('s2', SH(P('rr2'), '2741')))}
    ${SNAP('rr_c2')}`)}

  /* ── 組 ── */
  ${undo('p1', `${T('p1_a', C(P('まーじゃん'), '2741'))} ra := (r->>'room_id')::uuid;
    ${asWho(2)} ${T('p1_b', C(P('まーじゃん'), '8360'))} rb := (r->>'room_id')::uuid;
    ${asWho(3)} ${T('p1_ja', JN(P('まーじゃん'), '2741'))}
    ${ROW('p1_jv', `select joined_via from mahjong.room_accounts where room_id = ra and user_id = us[3]`)}
    ${asWho(4)} ${T('p1_jb', JN(P('まーじゃん'), '8360'))}
    ${asWho(6)} ${T('p1_jw', JN(P('まーじゃん'), '0000'))}
    ${asWho(7)} ${T('p1_jv2', JN(NB.toUpperCase().replace(/[0-9A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)) + ' の　マージャン', '２７４１'))}
    ${asWho(5)}
    ${SNAP('p1_c0')}
    ${T('p1_dup', C(P('まーじゃん'), '2741'))}
    ${T('p1_dupv', C(NB.toUpperCase().replace(/[0-9A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)) + ' の　マージャン', '２７４１'))}
    ${SNAP('p1_c1')}`)}
  ${undo('p2', `${T('p2_a', C(P('cl'), '2741', lit(TOKH_C)))} ra := (r->>'room_id')::uuid;
    ${asWho(3)} ${T('p2_in', JU(lit(TOK_C)))}
    ${asWho(1)} ${T('p2_close', WR('ra', OPS('room_close')))}
    ${asWho(4)} ${T('p2_jn0', JN(P('cl'), '2741'))}
    ${asWho(3)} ${T('p2_m_url', JU(lit(TOK_C)))} ${T('p2_m_no', JP(`(select room_no from mahjong.rooms where id = ra)`, '2741'))}
    ${T('p2_m_write', WR('ra', OPS('member_add', { member_id: 'to_jsonb(gen_random_uuid()::text)', name: lit('乙') })))}
    ${asWho(5)} ${SNAP('p2_c0')} ${T('p2_o_url', JU(lit(TOK_C)))} ${T('p2_o_no', JP(`(select room_no from mahjong.rooms where id = ra)`, '2741'))} ${SNAP('p2_c1')}
    ${asWho(2)} ${T('p2_new', C(P('cl'), '2741'))} rb := (r->>'room_id')::uuid;
    ${asWho(4)} ${T('p2_jn', JN(P('cl'), '2741'))}
    ${asWho(3)} ${T('p2_leave', WR('ra', OPS('room_leave')))}`)}
  ${undo('p3', `op := gen_random_uuid();
    ${T('p3_a', C(P('rs'), '2741', lit('a'.repeat(64)), 'op'))}
    ${SNAP('p3_c0')}
    ${T('p3_b', C(P('rs'), '2741', lit('a'.repeat(64)), 'op'))}
    ${SNAP('p3_c1')}`)}
  ${undo('nj', `${T('nj_a', C(P('nj'), '2741'))}
    ${asWho(2)} ${T('nj_s', C(null, null))} s2 := (r->>'room_id')::uuid;
    for i in 1..4 loop ${Z} r := ${JN(P('nj'), '0000')}; end loop;
    ${T('nj_hit', JN(P('nj'), '2741'))}
    ${T('nj_w5', JN(P('nj'), '0001'))}
    ${ROW('nj_nf', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:nfail1h' and key = mahjong_private.mj_name_key(${lit(P('nj'))}) || ':' || us[2]::text`)}
    ${ROW('nj_nf_all', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:nfail1h' and key like mahjong_private.mj_name_key(${lit(P('nj'))}) || ':%'`)}
    ${T('nj_lock_in', JN(P('nj'), '2741'))}
    ${T('nj_lock_c', C(P('nj'), '9999'))}
    ${T('nj_lock_sh', WR('s2', SH(P('nj'), '9999')))}
    ${T('nj_other', C(P('nj2'), '2741'))}
    ${asWho(3)} ${T('nj_b_j', JN(P('nj'), '2741'))}
    ${asWho(4)} ${T('nj_b_w', JN(P('nj'), '0002'))}
    ${asWho(5)} ${T('nj_b_c', C(P('nj'), '9999'))}`)}
  ${undo('nc', `${T('nc_a', C(P('nc'), '2741'))}
    ${asWho(2)} for i in 1..5 loop ${Z} r := ${C(P('nc'), '2741')}; res := res || jsonb_build_object('nc_d' || i, r); end loop;
    ${T('nc_lock', C(P('nc'), '2741'))}
    ${T('nc_lock_j', JN(P('nc'), '2741'))}
    ${ROW('nc_ud', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ufail1d' and key = us[2]::text`)}
    ${asWho(3)} ${T('nc_b_j', JN(P('nc'), '2741'))}`)}
  ${undo('ns', `${T('ns_a', C(P('ns'), '2741'))}
    ${asWho(2)} ${T('ns_s', C(null, null))} s2 := (r->>'room_id')::uuid;
    for i in 1..5 loop ${Z} r := ${WR('s2', SH(P('ns'), '2741'))}; res := res || jsonb_build_object('ns_d' || i, r); end loop;
    ${T('ns_lock', WR('s2', SH(P('ns'), '2741')))}
    ${ROW('ns_kind', `select kind from mahjong.rooms where id = s2`)}
    ${ROW('ns_ud', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ufail1d' and key = us[2]::text`)}`)}
  ${undo('sc', `${T('sc_a', C(P('sc'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('sc_b', C(P('sc'), '8360'))} rb := (r->>'room_id')::uuid;
    ${T('sc_dup', WR('ra', SEC('8360')))}
    ${ROW('sc_n1', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'secret:r1d' and key = ra::text`)}
    op := gen_random_uuid();
    ${T('sc_1', WR('ra', SEC('1111'), 'op'))}
    ${T('sc_2', WR('ra', SEC('1112')))}
    ${ROW('sc_n3', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'secret:r1d' and key = ra::text`)}
    ${T('sc_4', WR('ra', SEC('1113')))}
    ${ROW('sc_pass', `select extensions.crypt('1112', pass_hash) = pass_hash from mahjong.rooms where id = ra`)}
    update mahjong.rooms set channel_key = md5('heya-sc') where id = ra;
    ${T('sc_again', WR('ra', SEC('1111'), 'op'))}
    ${ROW('sc_opr', `select result from mahjong.op_results where room_id = ra and op_id = op`)}`)}
  ${undo('ud', `${T('ud_a', C(P('ud'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('ud_del', WR('ra', OPS('room_delete')))}
    ${asWho(2)} ${T('ud_dup', C(P('ud'), '2741'))} ${T('ud_jn_del', JN(P('ud'), '2741'))}
    ${asWho(1)} ${T('ud_undel', WR('ra', OPS('room_undelete')))}
    ${asWho(3)} ${T('ud_jn', JN(P('ud'), '2741'))}
    ${asWho(1)} ${T('ud_del2', WR('ra', OPS('room_delete')))}
    update mahjong.rooms set deleted_at = now() - interval '8 days' where id = ra;
    ${asWho(2)} ${T('ud_new', C(P('ud'), '2741'))}`)}
  ${undo('uc', `${T('uc_a', C(P('uc'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('uc_close', WR('ra', OPS('room_close')))} ${T('uc_del', WR('ra', OPS('room_delete')))}
    ${asWho(2)} ${T('uc_new', C(P('uc'), '2741'))}
    ${asWho(1)} ${T('uc_undel', WR('ra', OPS('room_undelete')))}
    ${ROW('uc_row', `select jsonb_build_object('closed', closed_at is not null, 'del', deleted_at is not null, 'nk', name_key) from mahjong.rooms where id = ra`)}`)}
  ${undo('am', `${T('am_a', C(P('am'), '2741'))} ra := (r->>'room_id')::uuid;
    ${T('am_b', C(P('am'), '8360'))} rb := (r->>'room_id')::uuid;
    update mahjong.rooms set pass_hash = (select pass_hash from mahjong.rooms where id = ra) where id = rb;   -- 段C の前から在る同じ組を作る
    ${asWho(3)} ${SNAP('am_c0')} ${T('am_j', JN(P('am'), '2741'))} ${SNAP('am_c1')}`)}
  ${undo('bn', `insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, kind, name_key)
      select gen_random_uuid(), ${lit(P('bn'))}, lpad((floor(random() * 100000000))::bigint::text, 8, '0'), extensions.crypt(lpad(k::text, 4, '0'), extensions.gen_salt('bf', 4)),
             ${URLH}, us[1], md5(random()::text), 'shared', mahjong_private.mj_name_key(${lit(P('bn'))}) from generate_series(1, 20) k;
    ${T('bn_c', C(P('bn'), '2741'))}`)}
  ${undo('fa', `${T('fa_a', C(P('fa'), '2741'))}
    ${asWho(2)} ${T('fa_s', C(null, null))} s2 := (r->>'room_id')::uuid;
    insert into mahjong.limits (kind, key, window_start, count) values ('join:ufail1d', us[2]::text, date_trunc('hour', now()) - interval '2 hours', 50)
      on conflict (kind, key, window_start) do update set count = 50;
    ${T('fa_j', JN(P('fa'), '2741'))}
    ${T('fa_c', C(P('fa2'), '2741'))}
    ${T('fa_sh', WR('s2', SH(P('fa3'), '2741')))}
    ${T('fa_solo', C(null, null))}
    ${asWho(3)} ${T('fa_other', JN(P('fa'), '2741'))}`)}
  ${undo('ub', `insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, kind, name_key)
      select gen_random_uuid(), ${lit(P('ub'))}, lpad((floor(random() * 100000000))::bigint::text, 8, '0'), extensions.crypt(lpad(k::text, 4, '0'), extensions.gen_salt('bf', 4)),
             ${URLH}, us[1], md5(random()::text), 'shared', mahjong_private.mj_name_key(${lit(P('ub'))}) from generate_series(1, 20) k;
    ${asWho(2)} ${T('ub_1', JN(P('ub'), '9999'))}
    ${ROW('ub_n', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ubf1m' and key = us[2]::text`)}
    ${SNAP('ub_c0')}
    ${T0('ub_2', JN(P('ub'), '0001'))}
    ${SNAP('ub_c1')}
    ${ROW('ub_n2', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'join:ubf1m' and key = us[2]::text`)}
    ${asWho(3)} ${T0('ub_other', JN(P('ub'), '0002'))}`)}
  ${undo('um', `${asWho(7)} ${T('um_s', C(null, null))} s2 := (r->>'room_id')::uuid;
    insert into mahjong.limits (kind, key, window_start, count) values ('create:u1m', us[7]::text, date_trunc('minute', now()), 5)
      on conflict (kind, key, window_start) do update set count = 5;
    ${T0('um_sh', WR('s2', SH(P('um'), '2741')))}
    ${ROW('um_kind', `select kind from mahjong.rooms where id = s2`)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('hy')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const J = (x) => JSON.stringify(x);
const dl = (a, b) => (a && b ? Object.fromEntries(Object.keys(a).map((k) => [k, Number(b[k]) - Number(a[k])])) : null);
const same = (a, b) => J(a) === J(b);
const isErr = (r, err, f = {}) => !!r && r.ok === false && r.err === err && Object.entries(f).every(([k, v]) => r[k] === v);
const zero = (d, keys) => !!d && keys.every((k) => d[k] === 0);

/* A の答えを試験の行に（名, 通ったか, 見せる字） */
function checkA(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない（internal の外）', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('当てた後の rooms_all＝開いた shared の数（数え直しの式）', o.f0 && Number(o.f0.t) === Number(o.f0.f), J(o.f0));
  /* 部屋なし */
  const sm = o.s_make || {};
  ok('部屋なし：作れる・kind solo・番号を返さない・channel_key は返す', sm.ok === true && sm.kind === 'solo' && !('room_no' in sm) && /^[0-9a-f]{32}$/.test(sm.channel_key || ''), J(sm));
  ok("部屋なし：行は name '対局'・pass_hash '!solo'・name_key null・番号は今の式（8桁）", o.s_row && o.s_row.name === '対局' && o.s_row.pass_hash === '!solo' && o.s_row.name_key === null && o.s_row.no8 === true && o.s_row.kind === 'solo', J(o.s_row));
  const sd = dl(o.s_c0, o.s_c1);
  ok('部屋なし：R を見ない＝totals は増えない・P3 全体の 1m・1d は書かない・部屋なしの su1d +1・人ごと u1d は増えない', sd && sd.totals === 0 && sd.c1m === 0 && sd.c1d === 0 && sd.su === 1 && sd.u1d === 0 && sd.rooms === 1, J(sd));
  ok('部屋なし：同じ op_id の送り直し＝同じ返し（番号なし）', same(o.s_again, sm), J(o.s_again));
  ok('部屋なし：同じ op_id で kind が違う送り直し＝bad kind・何も残さない', isErr(o.s_kind, 'bad', { what: 'kind' }) && zero(dl(o.s_c1, o.s_c2), ['rooms', 'totals', 'c1m', 'c1d', 'u1d', 'nf', 'creates']), J([o.s_kind, dl(o.s_c1, o.s_c2)]));
  ok('名前とパスの片方だけ null は bad', isErr(o.s_half1, 'bad', { what: 'pass' }) && isErr(o.s_half2, 'bad', { what: 'name' }), J([o.s_half1, o.s_half2]));
  const sqA = [o.sq_no, o.sq_url, o.sq_name], sqB = [o.sq_no_g, o.sq_url_g, o.sq_name_g];
  const sqD = [dl(o.sq_c0, o.sq_c1), dl(o.sq_c2, o.sq_c3), dl(o.sq_c4, o.sq_c5)], sqG = [dl(o.sq_c1, o.sq_c2), dl(o.sq_c3, o.sq_c4), dl(o.sq_c5, o.sq_c6)];
  ok('番号・url で部屋なしと無い部屋の返しが同じ（例外0・数えも同じ）', [0, 1].every((i) => sqA[i] && same(sqA[i], sqB[i]) && same(sqD[i], sqG[i]) && sqA[i].err === 'wrong'), J({ a: sqA, b: sqB, d: sqD, g: sqG }));
  ok("名前の道で部屋なしの名 '対局' は無い名前と同じ返し", sqA[2] && same(sqA[2], sqB[2]) && same(sqD[2], sqG[2]) && sqA[2].err === 'wrong', J([sqA[2], sqB[2], sqD[2], sqG[2]]));
  ok('持ち主でも url で部屋なしには入れない（無い部屋と同じ）', isErr(o.sq_own, 'wrong'), J(o.sq_own));
  ok('sweep を回しても（30日進めても・半荘0）部屋なしも開いた shared も消えない・rooms_all そのまま', o.ssw && o.ssw.solo === true && o.ssw.shared === true && Number(o.ssw.all) === 0, J(o.ssw));
  ok('部屋なし：持ち主の room_delete は ok・6日では消えず・7日を過ぎると物理で消える・rooms_all は変わらない', o.sdel_w?.ok === true && Number(o.sdel6) === 1 && o.sdel && Number(o.sdel.left) === 0 && Number(o.sdel.all) === 0, J([o.sdel_w, o.sdel6, o.sdel]));
  ok('部屋なし：room_secret・room_close は bad kind（internal でない）', isErr(o.s_secret, 'bad', { at: 'kind' }) && isErr(o.s_close, 'bad', { at: 'kind' }), J([o.s_secret, o.s_close]));
  const shd = dl(o.sh_c0, o.sh_c1);
  const shk = o.sh?.results?.[0]?.channel_key;
  ok('room_share：ok・新しい channel_key を返す・kind shared・名前と name_key・パスと url を作り直す', o.sh?.ok === true && /^[0-9a-f]{32}$/.test(shk || '') && o.sh_row && o.sh_row.kind === 'shared'
    && o.sh_row.name === P('sh') && o.sh_row.nk === true && o.sh_row.ch === shk && o.sh_row.no_solo === true && o.sh_row.url === true, J([o.sh, o.sh_row]));
  ok('room_share：rooms_all +1・作るの数え u1d +1（P3 全体の 1m・1d は書かない・su1d は足さない）', shd && shd.totals === 1 && shd.c1m === 0 && shd.c1d === 0 && shd.u1d === 1 && shd.su === 0, J(shd));
  ok('room_share：履歴に pass・hash・channel_key を書かない', Array.isArray(o.sh_hist) && o.sh_hist.length === 1 && !J(o.sh_hist).includes(shk || 'x') && !J(o.sh_hist).includes('$2'), J(o.sh_hist));
  ok('room_share：op_results に channel_key を残さない', o.sh_opr && o.sh_opr.ok === true && !J(o.sh_opr).includes('channel_key'), J(o.sh_opr));
  ok('room_share の送り直し → ok で今の channel_key を読み直して返す（v10.2）', o.sh_again?.ok === true && o.sh_again.results?.[0]?.channel_key === crypto.createHash('md5').update('heya-ch').digest('hex'), J(o.sh_again));
  ok('room_share：shared の部屋へは bad kind', isErr(o.sh_shared, 'bad', { at: 'kind' }), J(o.sh_shared));
  ok('room_share の後は名前で入れる（joined_via name）', o.sh_join?.ok === true && o.sh_join.again === false && o.sh_jv === 'name', J([o.sh_join, o.sh_jv]));
  const shm = (o.sh_my?.rooms || []).find((x) => x.room_id === sm.room_id);
  ok('mj_my_rooms：shared にした部屋は名前つきで出る', shm && shm.kind === 'shared' && shm.name === P('sh') && shm.closed === false && shm.role === 'kan', J(o.sh_my));
  const my = o.my_all?.rooms || [];
  const myS = my.find((x) => x.room_id === sm.room_id), myA = my.find((x) => x.room_id === o.my_a?.room_id);
  ok('mj_my_rooms：部屋なしは kind solo・名前なしで出る・番号は返さない', o.my_all?.ok === true && myS && myS.kind === 'solo' && (myS.name === null || myS.name === undefined) && !J(o.my_all).includes('room_no'), J(o.my_all));
  ok('mj_my_rooms：終えた部屋も closed true で出る', myA && myA.closed === true && myA.name === P('my'), J(myA));
  ok('mj_my_rooms：1件ずつめくると次の部屋（並び＝新しい順・id の逆順）', o.my_p1?.rooms?.length === 1 && o.my_p2?.rooms?.length === 1 && o.my_p1.rooms[0].room_id !== o.my_p2.rooms[0].room_id
    && my.length >= 2 && my[0].room_id === o.my_p1.rooms[0].room_id && my[1].room_id === o.my_p2.rooms[0].room_id, J([o.my_p1, o.my_p2]));
  ok('mj_my_rooms：limit 0・51 は bad limit・before の片方だけは bad before', isErr(o.my_b0, 'bad', { what: 'limit' }) && isErr(o.my_b51, 'bad', { what: 'limit' }) && isErr(o.my_bh, 'bad', { what: 'before' }), J([o.my_b0, o.my_b51, o.my_bh]));
  ok('mj_my_rooms：他の人の部屋は出ない', o.my_other?.ok === true && !(o.my_other.rooms || []).some((x) => x.room_id === sm.room_id || x.room_id === o.my_a?.room_id), J(o.my_other));
  /* 数え */
  ok('create 5回の後の room_share は busy user', isErr(o.cu_share, 'busy', { what: 'user' }) && [1, 2, 3, 4, 5].every((i) => o['cu_c' + i]?.ok === true), J([o.cu_share, o.cu_c5]));
  ok('部屋なしは 5回作っても人ごとの数えに入らない（その後に shared を5つ作れる）', o.cu_solo?.ok === true && o.cu_c5?.ok === true, J([o.cu_solo, o.cu_c5]));
  ok('busy user の room_share は数え・totals・部屋を変えない', zero(dl(o.cu_s0, o.cu_s1), ['totals', 'c1m', 'c1d', 'u1d', 'nf', 'rooms']), J(dl(o.cu_s0, o.cu_s1)));
  ok('create 6回目（room_share が間に無くても）busy user・何も変えない', isErr(o.cu_c6, 'busy', { what: 'user' }) && zero(dl(o.cu_s1, o.cu_s2), ['totals', 'c1m', 'c1d', 'u1d', 'rooms', 'creates']), J([o.cu_c6, dl(o.cu_s1, o.cu_s2)]));
  ok('逆も：create 4回＋room_share 1回の後の create は busy user・何も変えない', o.cr_share?.ok === true && isErr(o.cr_c5, 'busy', { what: 'user' }) && zero(dl(o.cr_s0, o.cr_s1), ['totals', 'c1m', 'c1d', 'u1d', 'rooms', 'creates']), J([o.cr_share, o.cr_c5]));
  ok('room_close：ok・closed_at・name_key null・rooms_all −1', o.cl_close?.ok === true && Number(o.cl_1) === -1 && o.cl_row && o.cl_row.closed === true && o.cl_row.nk === null, J([o.cl_close, o.cl_1, o.cl_row]));
  ok('終えた部屋：room_close は bad closed・member_add は bad closed（塊ごと）', isErr(o.cl_again, 'bad', { at: 'closed' }) && isErr(o.cl_ma, 'bad', { at: 'closed' }), J([o.cl_again, o.cl_ma]));
  ok('room_close→room_delete→物理の消しで rooms_all が1回だけ減る', o.cl_del?.ok === true && Number(o.cl_2) === -1 && o.cl_3 && Number(o.cl_3.left) === 0 && Number(o.cl_3.d) === -1, J([o.cl_del, o.cl_2, o.cl_3]));
  ok('数え直しと足し引きが同じ値（create・部屋なし・room_share・room_close の後・数え直しても変わらない）', o.rc_1 && Number(o.rc_1.t) === Number(o.rc_1.f) && o.rc_2 && Number(o.rc_2.t) === Number(o.rc_2.f)
    && o.rc_2.mark === true && o.rc_sh?.ok === true && o.rc_cl?.ok === true, J([o.rc_1, o.rc_2]));
  ok('P3：開いた shared が 10000 でも部屋なし・shared の create・room_share が作れる（R は無い・totals は shared の2つだけ +2）', ['rr_s1', 'rr_s2', 'rr_s3', 'rr_sh'].every((k) => o[k]?.ok === true) && o.rr_share?.ok === true
    && dl(o.rr_c0, o.rr_c1)?.totals === 0 && dl(o.rr_c1, o.rr_c2)?.totals === 2, J([o.rr_sh, o.rr_share, dl(o.rr_c0, o.rr_c1), dl(o.rr_c1, o.rr_c2)]));
  /* 組 */
  ok('同じ名前・違うパスで2部屋作れる', o.p1_a?.ok === true && o.p1_b?.ok === true, J([o.p1_a, o.p1_b]));
  ok('名前で入れる：パスごとにそれぞれの部屋へ', o.p1_ja?.ok === true && o.p1_ja.room_id === o.p1_a?.room_id && o.p1_jb?.ok === true && o.p1_jb.room_id === o.p1_b?.room_id, J([o.p1_ja, o.p1_jb]));
  ok('名前で入れる（joined_via name）', o.p1_ja?.ok === true && o.p1_jv === 'name', J([o.p1_ja, o.p1_jv]));
  ok('名前の道：違うパスは wrong', isErr(o.p1_jw, 'wrong'), J(o.p1_jw));
  ok('名前の道：揺れ（全角・大文字・空白・カタカナ）と全角のパスでも同じ部屋へ', o.p1_jv2?.ok === true && o.p1_jv2.room_id === o.p1_a?.room_id, J(o.p1_jv2));
  ok('同じ組は dup name_pass・揺れでも同じ', isErr(o.p1_dup, 'dup', { what: 'name_pass' }) && isErr(o.p1_dupv, 'dup', { what: 'name_pass' }), J([o.p1_dup, o.p1_dupv]));
  const p1d = dl(o.p1_c0, o.p1_c1);
  ok('dup は何も作らない（部屋・totals・creates・作るの数え）・名前の止めだけ +2', zero(p1d, ['rooms', 'totals', 'creates', 'c1m', 'c1d', 'u1d']) && p1d.nf === 2, J(p1d));
  ok('終えた部屋は名前の道で引かない（wrong）', isErr(o.p2_jn0, 'wrong'), J(o.p2_jn0));
  ok('終えた部屋：入っている人は url・番号で again closed', o.p2_m_url?.ok === true && o.p2_m_url.again === true && o.p2_m_url.closed === true && o.p2_m_no?.ok === true && o.p2_m_no.closed === true, J([o.p2_m_url, o.p2_m_no]));
  ok('終えた部屋：入っている人の書きは bad closed', isErr(o.p2_m_write, 'bad', { at: 'closed' }), J(o.p2_m_write));
  ok('終えた部屋：入っていない人は closed（数えない）', isErr(o.p2_o_url, 'closed') && isErr(o.p2_o_no, 'closed') && zero(dl(o.p2_c0, o.p2_c1), ['uf', 'f1m', 'nf']), J([o.p2_o_url, o.p2_o_no, dl(o.p2_c0, o.p2_c1)]));
  ok('終えた後は同じ組で作れ、名前で新しい方に入る', o.p2_new?.ok === true && o.p2_jn?.ok === true && o.p2_jn.room_id === o.p2_new.room_id, J([o.p2_new, o.p2_jn]));
  ok('終えた部屋でも room_leave は通る', o.p2_leave?.ok === true, J(o.p2_leave));
  ok('送り直しは ok で同じ部屋・数えない', o.p3_a?.ok === true && same(o.p3_a, o.p3_b) && zero(dl(o.p3_c0, o.p3_c1), ['rooms', 'totals', 'creates', 'c1m', 'c1d', 'u1d', 'nf']), J([o.p3_b, dl(o.p3_c0, o.p3_c1)]));
  ok('名前ごと5回で止め（join の外れ・P3＝名前×人）＝その人は入っていても・create・room_share も locked', Number(o.nj_nf) === 5 && Number(o.nj_nf_all) === 5 && isErr(o.nj_w5, 'wrong') && isErr(o.nj_lock_in, 'locked')
    && isErr(o.nj_lock_c, 'locked') && isErr(o.nj_lock_sh, 'locked') && !!o.nj_lock_in?.until, J([o.nj_nf, o.nj_nf_all, o.nj_lock_in, o.nj_lock_c, o.nj_lock_sh]));
  ok('当たっても戻らない（外れ4・当たり1・外れ1で止め）', o.nj_hit?.ok === true && Number(o.nj_nf) === 5 && isErr(o.nj_lock_in, 'locked'), J([o.nj_hit, o.nj_nf]));
  ok('P3：人A の名前の止めは人B を止めない（B は入れる・外れは wrong・同じ名前で作れる＝dup でない組）', o.nj_b_j?.ok === true && isErr(o.nj_b_w, 'wrong') && isErr(o.nj_b_c, 'dup', { what: 'name_pass' }) === false && o.nj_b_c?.ok === true,
    J([o.nj_b_j, o.nj_b_w, o.nj_b_c]));
  ok('名前の止めは他の名前を止めない', o.nj_other?.ok === true, J(o.nj_other));
  ok('create の dup 5回で止め（その人の create・join とも locked）', [1, 2, 3, 4, 5].every((i) => isErr(o['nc_d' + i], 'dup', { what: 'name_pass' })) && isErr(o.nc_lock, 'locked') && isErr(o.nc_lock_j, 'locked'), J([o.nc_d5, o.nc_lock, o.nc_lock_j]));
  ok('P3：create の dup も1人の外れ24時間50に数える（5）・他の人は止めない', Number(o.nc_ud) === 5 && o.nc_b_j?.ok === true, J([o.nc_ud, o.nc_b_j]));
  ok('room_share の dup 5回で止め（6回目 locked・部屋なしのまま）', [1, 2, 3, 4, 5].every((i) => isErr(o['ns_d' + i], 'dup', { at: 'name_pass' })) && isErr(o.ns_lock, 'locked') && o.ns_kind === 'solo', J([o.ns_d5, o.ns_lock, o.ns_kind]));
  ok('P3：room_share の dup も1人の外れ24時間50に数える（5）', Number(o.ns_ud) === 5, J(o.ns_ud));
  ok('room_secret で他の部屋と同じ組 → dup name_pass', isErr(o.sc_dup, 'dup', { at: 'name_pass' }), J(o.sc_dup));
  ok('room_secret の dup も1日3回に数える（塊が戻っても残る）', Number(o.sc_n1) === 1, String(o.sc_n1));
  ok('room_secret 4回目は busy what secret（3回目まで ok・パスは3回目の物）', o.sc_1?.ok === true && o.sc_2?.ok === true && Number(o.sc_n3) === 3 && isErr(o.sc_4, 'busy', { what: 'secret' }) && o.sc_pass === true, J([o.sc_1, o.sc_2, o.sc_n3, o.sc_4]));
  ok('room_secret の送り直し → ok で今の channel_key（op_results に残さない）', o.sc_again?.ok === true && o.sc_again.results?.[0]?.channel_key === crypto.createHash('md5').update('heya-sc').digest('hex')
    && o.sc_opr && !J(o.sc_opr).includes('channel_key'), J([o.sc_again, o.sc_opr]));
  ok('★紙と違えた所★ 消した印の7日の部屋も組を持つ＝同じ組は dup・名前の道では引かない', o.ud_del?.ok === true && isErr(o.ud_dup, 'dup', { what: 'name_pass' }) && isErr(o.ud_jn_del, 'wrong'), J([o.ud_del, o.ud_dup, o.ud_jn_del]));
  ok('★紙と違えた所★ room_undelete は比べずに戻せ、名前で入れる・7日を過ぎた消した部屋は組を持たない', o.ud_undel?.ok === true && o.ud_jn?.ok === true && o.ud_jn.room_id === o.ud_a?.room_id && o.ud_new?.ok === true, J([o.ud_undel, o.ud_jn, o.ud_new]));
  ok('終えて消した部屋の room_undelete は組を比べず、終えたまま（name_key null）', o.uc_new?.ok === true && o.uc_undel?.ok === true && o.uc_row && o.uc_row.closed === true && o.uc_row.del === false && o.uc_row.nk === null, J([o.uc_new, o.uc_undel, o.uc_row]));
  ok('ambiguous（同じ名前とパスが2つ）は数えない', isErr(o.am_j, 'ambiguous') && zero(dl(o.am_c0, o.am_c1), ['uf', 'f1m', 'nf']), J([o.am_j, dl(o.am_c0, o.am_c1)]));
  ok('同じ name_key の開いた部屋が20 → busy what name', isErr(o.bn_c, 'busy', { what: 'name' }), J(o.bn_c));
  ok('P3：名前の道も1人の外れ24時間50 を見る（busy user_day・until）', o.fa_a?.ok === true && isErr(o.fa_j, 'busy', { what: 'user_day' }) && !!o.fa_j?.until, J([o.fa_a, o.fa_j]));
  ok('P3：その時 shared の create・room_share も busy user_day・部屋なしは作れる・他の人は入れる', isErr(o.fa_c, 'busy', { what: 'user_day' }) && isErr(o.fa_sh, 'busy', { what: 'user_day' }) && o.fa_solo?.ok === true && o.fa_other?.ok === true,
    J([o.fa_c, o.fa_sh, o.fa_solo, o.fa_other]));
  ok('P3：同じ名前の部屋20＝名前の道の1回で bf 20（wrong）・同じ分の次は busy user_min で何も増えない・他の人は入れる', isErr(o.ub_1, 'wrong') && Number(o.ub_n) === 20 && isErr(o.ub_2, 'busy', { what: 'user_min' })
    && Number(o.ub_n2) === 20 && same(o.ub_c0, o.ub_c1) && o.ub_other?.ok === true, J([o.ub_1, o.ub_n, o.ub_2, o.ub_n2, o.ub_other]));
  ok('P3：room_share も人ごと1分5を見る（busy user_min・部屋なしのまま）', isErr(o.um_sh?.results ? o.um_sh : o.um_sh, 'busy', { what: 'user_min' }) && o.um_kind === 'solo', J([o.um_sh, o.um_kind]));
  return L;
}

/* ── B：同時（2本の接続） ── */
const claims = (u, s) => lit(JSON.stringify({ sub: u, session_id: s, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 5 }] }));
const wrapSleep = (inner, u, s, sleep) => `select r, pg_catalog.pg_sleep(${sleep}) as z from (
  select ${inner} as r from (select set_config('request.jwt.claims', ${claims(u, s)}, true)) c offset 0) y`;
const rCreate = (u, s, name, pass, sleep) => wrapSleep(`public.mj_room_create(gen_random_uuid(), ${lit(name)}, ${lit(pass)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${URLH}))`, u, s, sleep);
const rShare = (u, s, room, name, pass, sleep) => wrapSleep(`public.mj_write('${room}'::uuid, gen_random_uuid(), ${SH(name, pass)})`, u, s, sleep);
const rSecret = (u, s, room, pass, sleep) => wrapSleep(`public.mj_write('${room}'::uuid, gen_random_uuid(), ${SEC(pass)})`, u, s, sleep);
/* 倉庫に直に部屋を1つ（同時の前の支度＝作るの数えに入れない）。shared は totals +1 */
const mkRoomSql = (id, owner, kind, name, pass) => `
  insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, kind, name_key)
    values ('${id}', ${lit(kind === 'solo' ? '対局' : name)}, lpad((floor(random() * 100000000))::bigint::text, 8, '0'),
            ${kind === 'solo' ? `'!solo'` : `extensions.crypt(${lit(pass)}, extensions.gen_salt('bf', 10))`}, ${URLH}, '${owner}', md5(random()::text), '${kind}',
            ${kind === 'solo' ? 'null' : `mahjong_private.mj_name_key(${lit(name)})`});
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values ('${id}', '${owner}', 'kan', 'create');
  ${kind === 'shared' ? 'update mahjong.totals set rooms_all = rooms_all + 1 where id = 1;' : ''}`;
const RACES = [
  ['create×create', async (u, nm) => ({ a: rCreate(u[0], u[1], nm, '2741', 3), b: rCreate(u[2], u[3], nm, '2741', 0), pass: '2741' })],
  ['room_share×create', async (u, nm, mk) => { const sid = crypto.randomUUID(); await mk(sid, u[0], 'solo'); return { a: rShare(u[0], u[1], sid, nm, '2741', 3), b: rCreate(u[2], u[3], nm, '2741', 0), pass: '2741' }; }],
  ['room_secret×create', async (u, nm, mk) => { const x = crypto.randomUUID(); await mk(x, u[0], 'shared', nm, '1111'); return { a: rSecret(u[0], u[1], x, '2222', 3), b: rCreate(u[2], u[3], nm, '2222', 0), pass: '2222' }; }],
  ['create×room_share', async (u, nm, mk) => { const sid = crypto.randomUUID(); await mk(sid, u[2], 'solo'); return { a: rCreate(u[0], u[1], nm, '2741', 3), b: rShare(u[2], u[3], sid, nm, '2741', 0), pass: '2741' }; }],
  ['create×room_secret', async (u, nm, mk) => { const x = crypto.randomUUID(); await mk(x, u[2], 'shared', nm, '1111'); return { a: rCreate(u[0], u[1], nm, '2222', 3), b: rSecret(u[2], u[3], x, '2222', 0), pass: '2222' }; }],
];
async function race(i, label, make) {
  const u = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];   // [人a, session a, 人b, session b]
  const nm = `${NB}-race${i}`;
  const mine = [];
  let res = null, made = 0;
  try {
    await rows(`insert into auth.users (id, email, aud, role, is_anonymous) values ('${u[0]}', '${u[0]}@${MAIL}', 'authenticated', 'authenticated', false), ('${u[2]}', '${u[2]}@${MAIL}', 'authenticated', 'authenticated', false);
      insert into auth.sessions (id, user_id) values ('${u[1]}', '${u[0]}'), ('${u[3]}', '${u[2]}'); select 1 as k`);
    const mk = async (id, owner, kind, name, pass) => { mine.push(id); await rows(mkRoomSql(id, owner, kind, name, pass) + ' select 1 as k'); };
    const w = (await rows(`select date_trunc('minute', now()) as m, date_trunc('hour', now()) as h`))[0];
    const { a, b, pass } = await make(u, nm, mk);
    const t0 = Date.now(), tm = (p) => p.then((v) => [v, Date.now() - t0]);
    const pa = tm(rows(a));
    await new Promise((r) => setTimeout(r, 800));
    const pb = tm(rows(b));
    const st = await Promise.allSettled([pa, pb]);   // both settle before throw = no unhandled rejection (W8 restore must run)
    const bad = st.find((s) => s.status === 'rejected'); if (bad) throw bad.reason;
    const [[ra, ta], [rb, tb]] = st.map((s) => s.value);
    const A = ra[0]?.r, B = rb[0]?.r;
    made = [A, B].filter((x) => x && x.ok === true && (x.kind === 'shared' || Array.isArray(x.results) && /share/.test(label))).length;
    const n = (await rows(`select count(*) filter (where extensions.crypt(${lit(pass)}, pass_hash) = pass_hash)::int as n from mahjong.rooms
      where name_key = mahjong_private.mj_name_key(${lit(nm)}) and kind = 'shared' and closed_at is null and deleted_at is null`))[0].n;
    const dup = [A, B].filter((x) => x && x.ok === false && x.err === 'dup' && (x.what === 'name_pass' || x.at === 'name_pass')).length;
    const okN = [A, B].filter((x) => x && x.ok === true).length;
    console.log(`  （${label}：1本目 ${ta}ms・2本目 ${tb}ms で返った・同じ組の開いた部屋 ${n}）`);
    res = { n, good: n === 1 && okN === 1 && dup === 1, info: J({ a: A, b: B, n }), w };
  } catch (e) {
    res = { n: -1, good: false, err: true, info: '回らなかった — ' + String(e.message || e).slice(0, 400) };
  } finally {
    try {
      const sub = '';   // P3：全体の窓（create:1m・1d の 'all'）はやめた＝引く物が無い
      await rows(`with d as (delete from mahjong.rooms where owner_user_id in ('${u[0]}', '${u[2]}') or id in (${mine.map((x) => `'${x}'`).join(', ') || 'null'}) returning kind, closed_at)
        update mahjong.totals set rooms_all = greatest(rooms_all - (select count(*) from d where kind = 'shared' and closed_at is null), 0) where id = 1;
        delete from mahjong.creates where user_id in ('${u[0]}', '${u[2]}');
        delete from mahjong.limits where key in ('${u[0]}', '${u[2]}', mahjong_private.mj_name_key(${lit(nm)})) or key like mahjong_private.mj_name_key(${lit(nm)}) || ':%' or (kind = 'secret:r1d' and key in (${mine.map((x) => `'${x}'`).join(', ') || "''"})) or kind like 'write:%';
        ${sub}
        delete from auth.users where id in ('${u[0]}', '${u[2]}'); select 1 as k`);
    } catch (e) { console.log('  ✗ 片付けが落ちた — ' + String(e.message).slice(0, 300)); res = { ...(res || {}), good: false, cleanFail: true }; }
  }
  return res;
}
async function runB() {
  const out = [];
  for (let i = 0; i < RACES.length; i++) out.push([RACES[i][0], await race(i, RACES[i][0], RACES[i][1])]);
  return out;
}

/* ── --waza の壊し方 ── */
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn.replace(/\(.*$/, '')}${fnSig(fn)} from public, anon, authenticated;` : '');
};
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'mahjong_private.mj_pair_bf': '(text, text, uuid, jsonb, uuid)' };
const fnSig = (fn) => SIG[fn] || '';
const CREATE_RECHECK = "v_pair := mahjong_private.mj_pair_bf(v_nk, v_key, null, coalesce(v_pre -> 'seen', '{}'::jsonb), v_me);   -- ★引き直し★";
const SHARE_RECHECK = "v_j := mahjong_private.mj_pair_bf(v_rk, v_key, p_room, case when p_o -> '_pre' ->> 'nk' = v_rk then p_o -> '_pre' -> 'seen' else '{}'::jsonb end, p_me);   -- ★引き直し★";
const SECRET_PAIR = "v_j := mahjong_private.mj_pair_bf(s.name_key, v_key, p_room, case when p_o -> '_pre' ->> 'nk' = s.name_key then p_o -> '_pre' -> 'seen' else '{}'::jsonb end, p_me);   -- ★room_secret の比べ★";
const WZ = [
  ['W1 名前の道がパス・locked・1人の外れ24時間50 を見ない', () => brk('public.mj_room_join', [
    ["v_until := mahjong_private.mj_day_until('join:ufail1d', v_me::text, 50);   -- ★人の24時間50★", 'v_until := null;'],
    ['v_until := mahjong_private.mj_nfail_until(v_nk, v_me);   -- ★名前の道の止め★', 'v_until := null;'],
    ['if extensions.crypt(v_pk, cand.pass_hash) = cand.pass_hash then   -- ★名前の道の比べ★', 'if true then']]),
    ['名前の道：違うパスは wrong', '名前ごと5回で止め（join の外れ', 'P3：名前の道も1人の外れ24時間50 を見る']],
  ['W11 P3 名前の道が bf を数えない', () => brk('public.mj_room_join', [['    if not mahjong_private.mj_ubf_take(v_me, case when v_n < 1 then 1 else v_n::int end) then   -- ★名前の道の bf の数え★', '    if false then']]),
    ['P3：同じ名前の部屋20']],
  ['W2 joined_via で落ちる（name を決まりから外す）', () => `alter table mahjong.room_accounts drop constraint room_accounts_joined_via_ok;
    alter table mahjong.room_accounts add constraint room_accounts_joined_via_ok check (joined_via in ('pass', 'url', 'create', 'import')) not valid;`,   // not valid＝khaw に今ある name の行は見ない（新しい行だけ止める）
    ['名前で入れる（joined_via name）']],
  ['W3 比べが閉じた部屋を見る', () => brk('mahjong_private.mj_pair_bf', [["where r.name_key = p_nk and r.kind = 'shared' and r.closed_at is null", "where mahjong_private.mj_name_key(r.name) = p_nk and r.kind = 'shared'"]]),
    ['終えた後は同じ組で作れ']],
  ['W4 dup を数えない', () => brk('public.mj_room_create', [['      perform mahjong_private.mj_nfail_add(v_nk, v_me);   -- ★dup の数え★（名前ごとの止め・当たっても戻さない）', '      null;']])
    + '\n' + brk('public.mj_write', [["    perform mahjong_private.mj_nfail_add(nullif(mahjong_private.mj_name_key(pg_catalog.btrim(p_ops -> 0 ->> 'name', ' ' || chr(9) || chr(10) || chr(13) || chr(12288))), ''), v_me);   -- ★room_share の dup の数え★", '    null;']]),
    ['create の dup 5回で止め', 'room_share の dup 5回で止め']],
  ['W5 当たりで数えを戻す', () => brk('public.mj_room_join', [['      v_found := true; v_ok := true;   -- ★名前の道の当たり★',
    "      v_found := true; v_ok := true; delete from mahjong.limits l where l.kind = 'join:nfail1h' and l.key = v_nk || ':' || v_me::text;"]]),
    ['当たっても戻らない']],
  ['W6 room_secret が比べを通らない', () => brk('mahjong_private.mj_w_op', [[SECRET_PAIR, "v_j := '{\"busy\": false, \"hit\": false}'::jsonb;"]]),
    ['room_secret で他の部屋と同じ組 → dup']],
  ['W7 room_share が create:u1d を見ない', () => brk('mahjong_private.mj_w_op', [['    if (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l   -- ★room_share の人ごとの数え★', '    if false and (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l']]),
    ['create 5回の後の room_share は busy user']],
  ['W9 部屋なし潰しを外す', () => brk('public.mj_room_join', [["  if v_found and v_kind = 'solo' then v_found := false; end if;   -- ★部屋なし潰し★", '  null;']]),
    ['番号・url で部屋なしと無い部屋の返しが同じ']],
  ['W10 P4 room_secret の1日3回を4回に', () => brk('public.mj_write', [["interval '24 hours') >= 3 then", "interval '24 hours') >= 4 then"]]),
    ['room_secret 4回目は busy what secret']],
];
const W8 = () => [brk('public.mj_room_create', [[CREATE_RECHECK, "v_pair := coalesce(v_pre, mahjong_private.mj_pair_bf(v_nk, v_key, null, '{}'::jsonb, v_me));"]]),
  brk('mahjong_private.mj_w_op', [[SHARE_RECHECK, "v_j := coalesce(p_o -> '_pre', mahjong_private.mj_pair_bf(v_rk, v_key, p_room, '{}'::jsonb, p_me));"],
    [SECRET_PAIR, "v_j := coalesce(p_o -> '_pre', mahjong_private.mj_pair_bf(s.name_key, v_key, p_room, '{}'::jsonb, p_me));"]])].join('\n');
const W8_RESTORE = () => fnText('public.mj_room_create') + '\n' + fnText('mahjong_private.mj_w_op') + '\nrevoke all on function mahjong_private.mj_w_op(uuid, uuid, text, uuid, int, jsonb) from public, anon, authenticated;';

let pass = 0, fail = 0, exit = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 600) : '')); } };
const leftCheck = async () => {
  const lf = (await rows(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name like '${NB}%') as r,
    (select jsonb_build_object('t', (select rooms_all from mahjong.totals where id = 1), 'f', ${FORMULA})) as tf`))[0];
  say('倉庫に試しの人・部屋が残っていない・rooms_all＝開いた shared の数', lf.u === 0 && lf.r === 0 && Number(lf.tf.t) === Number(lf.tf.f), J(lf));
};

if (!WAZA) {
  console.log('■ A（1つの取引の塊・全部戻す）');
  const a = await runA('');
  if (a.err) { say('A の塊が回った', false, a.err); }
  else for (const [n, c, info] of checkA(a.out)) say(n, c, info);
  console.log('■ B（2本の接続で同時・書いて finally で消す）');
  for (const [label, r] of await runB()) say(`同じ組を同時に ${label} → 開いた部屋はちょうど1つ（片方 ok・片方 dup name_pass）`, r.good, r.info);
  await leftCheck();
  console.log(`\nheya: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  let red = 0;
  const base = await runA('');
  const b0 = base.err ? null : checkA(base.out);
  if (!b0 || b0.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base.err || b0.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    exit = 1;
  } else {
    console.log(`  素の回り：${b0.length} passed, 0 failed（緑）`);
    for (const [name, mkPrefix, wants] of WZ) {
      let pre;
      try { pre = mkPrefix(); } catch (e) { console.log(`  ✗ ${name}：${e.message}`); exit = 1; continue; }
      for (const w of wants) if (!b0.some(([n]) => n.startsWith(w))) { console.log(`  ✗ ${name}：狙った試験「${w}」が素の回りに無い`); exit = 1; }
      const r = await runA(pre);
      if (r.err) { console.log(`  ✗ ${name}：塊が回らなかった ${r.err.slice(0, 300)}`); exit = 1; continue; }
      const L = checkA(r.out);
      const hit = wants.map((w) => L.find(([n, c]) => n.startsWith(w) && !c));
      const reds = L.filter(([, c]) => !c).length;
      if (hit.every(Boolean)) { red++; console.log(`  ✓ ${name} → 狙い ${wants.length} つとも赤・赤は全部で ${reds}`); }
      else { console.log(`  ✗ ${name} → 狙いが赤にならない: ${wants.filter((_, i) => !hit[i]).join(' ／ ')}（全部の赤 ${reds}）`); exit = 1; }
    }
    /* W8：totals を押さえた後の引き直しをしない＝同時に作ると2つ（壊した関数を倉庫に当てて回し、finally で当て直す） */
    let broke = false;
    try {
      await rows(W8() + '\nselect 1 as k');
      broke = true;
      console.log('  （W8：create・room_share・room_secret の引き直しを外して当てた）');
      const rs = await runB();
      const twoAll = rs.every(([, r]) => !r.err && r.n === 2);
      rs.forEach(([label, r]) => console.log(`    ${label}：開いた部屋 ${r.n}${r.err ? '（' + r.info + '）' : ''}`));
      if (twoAll) { red++; console.log('  ✓ W8 引き直しを外すと同時の5組とも開いた部屋が2つ（狙いが赤）'); }
      else { console.log('  ✗ W8 引き直しを外しても2つにならない組が在る'); exit = 1; }
    } catch (e) {
      console.log('  ✗ W8 回らなかった — ' + String(e.message || e).slice(0, 400)); exit = 1;
    } finally {
      if (broke) {
        try { await rows(W8_RESTORE() + '\nselect 1 as k'); console.log('  （本当の mj_room_create・mj_w_op を当て直した）'); }
        catch (e) { console.log('★中止★ 当て直せない＝今すぐ npm run db:apply — ' + String(e.message).slice(0, 300)); exit = 1; }
      }
      await leftCheck();
    }
  }
  console.log(`\nheya --waza: ${red}/${WZ.length + 1} 狙いが赤になった`);
  process.exitCode = red === WZ.length + 1 && !exit && !fail ? 0 : 1;
}
