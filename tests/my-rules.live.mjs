/* my-rules.live.mjs — ★A14：覚えたルール（mahjong.account_rules・public.mj_my_rules）を本物のテスト倉庫で叩く★
 * =============================================================================
 * 定め＝memory/mahjong_tataki_2026-11-20/a14_sadame.md v1.1 §4。手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす）。
 * 1つの取引の塊（最後にわざと例外を投げて全部戻す＝倉庫に何も残さない）：
 *  ① 作ると覚える（3人・4人が別）／table_rules で上書き／作るの送り直し（同じ op_id）で古い値に戻らない／
 *     table_rules の送り直しで落ちず覚えも動かない／他の人の table_rules で自分の覚えが変わらない（その人に付く）／リーグの作り・保存では覚えない
 *  ② mj_my_rules は他の人の行を返さない・行が無い人は両方 null・last（新しい方の人数）も null・session 無しは mj_session
 *  ③ 人を消すと行が消える（cascade）
 *  ④ 権限：mj_my_rules は anon に EXECUTE 無し・PUBLIC 無し・authenticated だけ／account_rules は RLS 入・客の表の権限0
 * --with-schema：作業木の supabase/schema.sql を同じ取引の頭で当ててから回す（塊ごと戻る＝khaw に残らない。押す番の前に確かめる時）
 * --waza：5つ壊して狙った試験が赤になるか（壊した関数を塊の初めに当てる＝塊ごと戻る）。
 * 使い方: node tests/my-rules.live.mjs [--with-schema] [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { rulesOk } from '../lib/rules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(/url:\s*'([^']+)'/.exec(src)[1])[1];
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2' || !/env:\s*'test'/.test(src)) {
  console.log('★中止★ 倉庫が khaw（test）でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1);
}
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
const WAZA = process.argv.includes('--waza');
const HEAD = process.argv.includes('--with-schema') ? 'begin;\n' + fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8') + '\n' : '';

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
const J = (x) => String(JSON.stringify(x));
const U = () => crypto.randomUUID();
const jb = (x) => `${lit(J(x))}::jsonb`;
const MAIL = 'mj-myrules.invalid';
const NB = 'ru' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%' or kind like 'create:%' or kind like 'join:%';`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const MINE = (key) => `${T(key, 'public.mj_my_rules()')}`;
/* 人 i の覚え（表をじかに）＝{"3":…, "4":…} */
const RAWR = (i) => `(select coalesce(jsonb_object_agg(a.players::text, a.rules), '{}'::jsonb) from mahjong.account_rules a where a.user_id = us[${i}])`;

/* ── ルール（lib で埋めた形＝倉庫の mj_rules_ok と同じ鍵がそろう） ── */
const full = (r) => { const x = rulesOk(r); if (!x.ok) throw new Error('ルールが読めない ' + J(x)); return x.rules; };
const A4 = full({ players: 4, rate: 100, uma: [30, 10, -10, -30] });
const B4 = full({ ...A4, uma: [40, 20, -20, -40] });     // table_rules（鍵同じ＝ウマだけ）
const C4 = full({ ...A4, uma: [20, 10, -10, -20] });     // 人2 の table_rules
const E4 = full({ ...A4, uma: [50, 30, -30, -50] });     // 2つ目の部屋（送り直しの前に覚えを替える）
const L4 = full({ ...A4, uma: [15, 5, -5, -15] });       // リーグ
const A3 = full({ players: 3, rate: 50 });
const A3b = full({ ...A3, rate: 30 });                   // 3人の部屋の table_rules（4 の後に 3 を変える＝last 3）
const M = [U(), U(), U(), U()];
const S1 = U(), T1 = U(), NT1 = U(), NT2 = U(), LG = U();
const M3 = [U(), U(), U()], S3 = U(), T3 = U(), NT3 = U();
const OP1 = U();
const W = (key, room, ops) => `${RS} ${T(key, `public.mj_write(${room}, gen_random_uuid(), ${jb(ops)})`)}`;
const CR = (op, name, rules, uh) => `public.mj_room_create(${op}, ${lit(name)}, ${lit(PASS)}, ${jb(rules)}, jsonb_build_object('url_token_hash', ${uh}))`;
const BASE_OPS = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '甲乙丙丁'[i] })),
  { op: 'session_add', session_id: S1, date: '2026-11-23', rate: 100 },
  { op: 'table_add', table_id: T1, session_id: S1, label: '卓1' },
  { op: 'table_seats', table_id: T1, seats: M },
];
const BASE3 = [
  ...M3.map((id, i) => ({ op: 'member_add', member_id: id, name: '子丑寅'[i] })),
  { op: 'session_add', session_id: S3, date: '2026-11-23', rate: 50 },
  { op: 'table_add', table_id: T3, session_id: S3, label: '卓1' },
  { op: 'table_seats', table_id: T3, seats: M3 },
];
const TR = (tid, nid, rules) => ({ op: 'table_rules', table_id: tid, new_table_id: nid, rules });

const mkSql = (prefix = '') => `${HEAD}do ${q('ru')} declare res jsonb := '{}'; r jsonb; i int; ra uuid; rb uuid; r3 uuid;
  us uuid[] := '{}'; ss uuid[] := '{}'; uh text := md5(random()::text) || md5(random()::text);
begin
  ${prefix}
  for i in 1..3 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 3) k;
  ${ROW('ids', `jsonb_build_object('u1', us[1], 'u2', us[2], 'u3', us[3])`)}

  /* 人1：4人の部屋 A を A4 で作る → 覚え 4＝A4・3＝null */
  ${asWho(1)} ${RS}
  ${T('mk_a', CR(`'${OP1}'::uuid`, NB + 'a', A4, 'uh'))}
  ra := (r ->> 'room_id')::uuid;
  ${MINE('m1')}
  ${ROW('rs_a', `(select x.rules from mahjong.rule_sets x join mahjong.rooms o on o.rule_set_id = x.id and o.rule_version = x.version where o.id = ra)`)}
  /* 3人の部屋を A3 で → 3＝A3・4 は A4 のまま */
  ${RS} ${T('mk_3', CR('gen_random_uuid()', NB + 'c', A3, "md5(random()::text) || md5(random()::text)"))}
  r3 := (r ->> 'room_id')::uuid;
  ${MINE('m2')}
  ${ROW('rs_3', `(select x.rules from mahjong.rule_sets x join mahjong.rooms o on o.rule_set_id = x.id and o.rule_version = x.version where o.id = r3)`)}

  /* 部屋 A に台を置いて table_rules（B4）→ 4＝B4 */
  ${BASE_OPS.map((o, k) => W('base' + k, 'ra', [o])).join('\n  ')}
  ${W('tr1', 'ra', [TR(T1, NT1, B4)])}
  ${MINE('m3')}
  ${ROW('rs_tr1', `(select x.rules from mahjong.rule_sets x join mahjong.tables t on t.rule_set_id = x.id and t.rule_version = x.version where t.id = '${NT1}'::uuid)`)}
  /* 4 の後に 3人の部屋で table_rules（A3b）→ 3＝A3b・last 3 */
  ${BASE3.map((o, k) => W('b3_' + k, 'r3', [o])).join('\n  ')}
  ${W('tr3', 'r3', [TR(T3, NT3, A3b)])}
  ${MINE('m3b')}
  /* 作るの送り直し（同じ op_id・A4）→ ok で同じ部屋・覚えは B4 のまま・last も 3 のまま */
  ${RS} ${T('mk_a2', CR(`'${OP1}'::uuid`, NB + 'a', A4, 'uh'))}
  ${MINE('m4')}
  /* 2つ目の部屋を E4 で → 4＝E4。そこで table_rules の送り直し（NT1・B4）→ ok・覚えは E4 のまま */
  ${RS} ${T('mk_b', CR('gen_random_uuid()', NB + 'b', E4, "md5(random()::text) || md5(random()::text)"))}
  rb := (r ->> 'room_id')::uuid;
  ${W('tr1b', 'ra', [TR(T1, NT1, B4)])}
  ${MINE('m5')}
  /* 同じルールの table_rules（NT2・今の卓 NT1 と同じ B4）→ 区切らずに ok・覚えは E4 のまま */
  ${W('tr_same', 'ra', [TR(NT1, NT2, B4)])}
  ${MINE('m5s')}
  ${ROW('nt2', `exists (select 1 from mahjong.tables t where t.id = '${NT2}'::uuid)`)}

  /* 人2 を部屋 A の管にして table_rules（NT1→NT2・C4）→ 人2 の 4＝C4・人1 は E4 のまま */
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'kan', 'pass');
  ${asWho(2)}
  ${W('tr2', 'ra', [TR(NT1, NT2, C4)])}
  ${MINE('m6_u2')}
  ${ROW('m6_u1', RAWR(1))}

  /* リーグの作り・保存（人1・L4）→ 人1 の覚えは E4 のまま */
  ${asWho(1)}
  ${W('lc', 'ra', [{ op: 'league_create', league_id: LG, name: 'リ', date_from: '2026-11-01', date_to: '2026-11-30', players_main: 4, rules: L4 }])}
  ${ROW('m7a', RAWR(1))}
  ${RS} ${T('ls', `public.mj_write(ra, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'league_save', 'league_id', '${LG}'::uuid,
    'base_version', (select version from mahjong.leagues where id = '${LG}'::uuid), 'rules', ${jb({ ...L4, uma: [25, 5, -5, -25] })})))`)}
  ${ROW('m7b', RAWR(1))}

  /* ② 行の無い人3・session 無し */
  ${asWho(3)}
  ${MINE('m8_u3')}
  perform set_config('request.jwt.claims', '', true);
  ${MINE('nose')}

  /* ③ 人2 を消すと行が消える */
  ${ROW('u2_before', `(select count(*)::int from mahjong.account_rules where user_id = us[2])`)}
  begin delete from auth.users where id = us[2]; exception when others then res := res || jsonb_build_object('del_err', sqlerrm); end;
  ${ROW('u2_after', `(select count(*)::int from mahjong.account_rules where user_id = us[2])`)}

  /* ④ 権限 */
  ${ROW('acl', `jsonb_build_object(
    'anon', has_function_privilege('anon', 'public.mj_my_rules()', 'execute'),
    'auth', has_function_privilege('authenticated', 'public.mj_my_rules()', 'execute'),
    'pub', exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = 'public.mj_my_rules()'::regprocedure and x.grantee = 0),
    'definer', (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.mj_my_rules()'::regprocedure),
    'rls', (select c.relrowsecurity from pg_class c where c.oid = 'mahjong.account_rules'::regclass),
    'tpriv', has_table_privilege('anon', 'mahjong.account_rules', 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('authenticated', 'mahjong.account_rules', 'SELECT,INSERT,UPDATE,DELETE'))`)}
  raise exception 'MJRESULT%', res::text;
end ${q('ru')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const eqr = (a, b) => J(a) === J(b) || (a && b && typeof a === 'object' && typeof b === 'object'
  && Object.keys({ ...a, ...b }).every((k) => J(a[k]) === J(b[k])));
const uma = (x) => J(x?.uma);
const isOk = (r) => r && r.ok === true;

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  BASE_OPS.forEach((x, k) => ok('台が倉庫に当たった：' + x.op + ' ' + k, isOk(o['base' + k]), J(o['base' + k]).slice(0, 300)));
  BASE3.forEach((x, k) => ok('3人の台が倉庫に当たった：' + x.op + ' ' + k, isOk(o['b3_' + k]), J(o['b3_' + k]).slice(0, 300)));
  const g = (k, p) => o[k]?.rules?.[p];
  /* ① */
  ok('① 作ると覚える：4＝作った部屋の rule_sets の行と同じ（A4 のウマ）・3 は null', isOk(o.mk_a) && isOk(o.m1) && eqr(g('m1', '4'), o.rs_a)
    && uma(g('m1', '4')) === uma(A4) && o.m1.rules['3'] === null, J([o.mk_a, o.m1, o.rs_a]).slice(0, 500));
  ok('① 3人と4人は別：3＝A3（rule_sets と同じ）・4 は A4 のまま', isOk(o.mk_3) && eqr(g('m2', '3'), o.rs_3) && g('m2', '3')?.players === 3
    && uma(g('m2', '4')) === uma(A4), J([o.mk_3, o.m2]).slice(0, 500));
  ok('① table_rules で上書き：4＝新しい卓の rule_sets の行（B4）', isOk(o.tr1) && eqr(g('m3', '4'), o.rs_tr1) && uma(g('m3', '4')) === uma(B4), J([o.tr1, o.m3]).slice(0, 500));
  ok('① 4 の後に 3人で table_rules：3＝A3b・4 は B4 のまま', isOk(o.tr3) && g('m3b', '3')?.rate === 30 && uma(g('m3b', '4')) === uma(B4), J([o.tr3, o.m3b]).slice(0, 500));
  ok('① 作るの送り直し：ok で同じ部屋・覚えは B4 のまま（A4 に戻らない）', isOk(o.mk_a2) && o.mk_a2.room_id === o.mk_a?.room_id && uma(g('m4', '4')) === uma(B4), J([o.mk_a2, o.m4]).slice(0, 500));
  /* last（a14g §1・updated_at が新しい方の人数） */
  ok('① last：4だけ→4・3→4の順で作る→3・その後 4 の table_rules→4・4 の後に 3人の table_rules→3・作るの送り直しでは動かない（3）・次に 4 を作る→4',
    o.m1?.last === 4 && o.m2?.last === 3 && o.m3?.last === 4 && o.m3b?.last === 3 && o.m4?.last === 3 && o.m5?.last === 4,
    J(['m1', 'm2', 'm3', 'm3b', 'm4', 'm5'].map((k) => o[k]?.last)));
  ok('① table_rules の送り直し：ok（internal にならない）・覚えは E4 のまま', isOk(o.mk_b) && isOk(o.tr1b) && uma(g('m5', '4')) === uma(E4), J([o.tr1b, o.m5]).slice(0, 500));
  ok('① 同じルールの table_rules：区切らずに ok・覚えは E4 のまま', isOk(o.tr_same) && o.nt2 === false && uma(g('m5s', '4')) === uma(E4), J([o.tr_same, o.nt2, o.m5s]).slice(0, 500));
  ok('① 他の人の table_rules：その人に付く（人2 の 4＝C4）・人1 は E4 のまま', isOk(o.tr2) && uma(g('m6_u2', '4')) === uma(C4) && g('m6_u2', '3') === null
    && uma(o.m6_u1?.['4']) === uma(E4), J([o.tr2, o.m6_u2, o.m6_u1]).slice(0, 500));
  ok('① リーグの作り・保存では覚えない（人1 は E4 のまま）', isOk(o.lc) && isOk(o.ls) && uma(o.m7a?.['4']) === uma(E4) && uma(o.m7b?.['4']) === uma(E4),
    J([o.lc, o.ls, o.m7a, o.m7b]).slice(0, 500));
  /* ② */
  ok('② 行が無い人は両方 null・last も null（他の人の行を返さない）', isOk(o.m8_u3) && o.m8_u3.rules?.['3'] === null && o.m8_u3.rules?.['4'] === null && o.m8_u3.last === null, J(o.m8_u3));
  ok('② 人2 の last は自分の行だけで決まる（4）', o.m6_u2?.last === 4, J(o.m6_u2));
  ok('② session 無しは mj_session', o.nose?.ok === false && o.nose.err === 'mj_session', J(o.nose));
  /* ③ */
  ok('③ 人を消すと行が消える（cascade）', o.u2_before === 1 && o.u2_after === 0 && !o.del_err, J([o.u2_before, o.u2_after, o.del_err]));
  /* ④ */
  const a = o.acl || {};
  ok('④ mj_my_rules は definer・search_path 空・anon と PUBLIC に EXECUTE 無し・authenticated だけ', a.anon === false && a.auth === true && a.pub === false && a.definer === true, J(a));
  ok('④ account_rules は RLS 入・客（anon・authenticated）の表の権限0', a.rls === true && a.tpriv === false, J(a));
  return L;
}

/* --waza：関数の字を置き換えて塊の初めに当てる */
const brk = (fn, from, to) => `fd := pg_get_functiondef('${fn}'::regprocedure); fd2 := replace(fd, ${q('a')}${from}${q('a')}, ${q('b')}${to}${q('b')});
  if fd2 = fd then raise exception 'waza の字が見つからない'; end if; execute fd2;`;
const UPS = (who, n, rv) => `insert into mahjong.account_rules (user_id, players, rules) values (${who}, ${n}, ${rv}) on conflict (user_id, players) do update set rules = excluded.rules;`;
const FC = 'public.mj_room_create(uuid, text, text, jsonb, jsonb)';
const FO = 'mahjong_private.mj_w_op(uuid, uuid, text, uuid, int, jsonb)';
const MIS = `if r.url_token_hash <> v_url then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mismatch'); end if;`;
const RES = `if v_r <> p_room or t.next_table_id is distinct from v_id then perform mahjong_private.mj_w_bad(p_i, 'new_table_id'); end if;`;
const WZ = [
  ['W1 作るの送り直しの道でも覚える', brk(FC, MIS, MIS + ' ' + UPS('v_me', "(v_rules ->> 'players')::smallint", 'v_rules')), ['① 作るの送り直し']],
  ['W2 覚えを部屋の持ち主に付ける', brk(FO, 'values (p_me, t.players, v_rules, pg_catalog.clock_timestamp())', 'values ((select o.owner_user_id from mahjong.rooms o where o.id = p_room), t.players, v_rules, pg_catalog.clock_timestamp())'), ['① 他の人の table_rules']],
  ['W3 table_rules の送り直しの道でも覚える', brk(FO, RES, RES + ' ' + UPS('p_me', 't.players', "mahjong_private.mj_w_rules(p_o -> 'rules', 'rules', p_i)")), ['① table_rules の送り直し']],
  ['W4 mj_my_rules の人の絞りを抜く', brk('public.mj_my_rules()', 'a.user_id = v_me and ', ''), ['② 行が無い人']],
  ['W5 last を時刻で並べない（人数だけ）', brk('public.mj_my_rules()', 'order by a.updated_at desc, a.players desc', 'order by a.players desc'), ['① last']],
];

let pass = 0, fail = 0, exit = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 600) : '')); } };
const leftCheck = async () => {
  const lf = (await rows(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`))[0];
  say('倉庫に試しの人・部屋が残っていない', lf.u === 0 && lf.r === 0, J(lf));
};
const withFd = (body) => body.replace('declare res jsonb', 'declare fd text; fd2 text; res jsonb');

if (HEAD) console.log('  （--with-schema：作業木の schema.sql を同じ取引の頭で当てて回す＝塊ごと戻る）');
if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  await leftCheck();
  console.log(`\nmy-rules: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  let red = 0;
  const base = await runA('');
  const b0 = base.err ? null : check(base.out);
  if (!b0 || b0.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない: ' + (base.err || b0.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    exit = 1;
  } else {
    console.log(`  素の回り：${b0.length} passed, 0 failed（緑）`);
    for (const [name, pre, wants] of WZ) {
      for (const w of wants) if (!b0.some(([n]) => n.startsWith(w))) { console.log(`  ✗ ${name}：狙った試験「${w}」が素の回りに無い`); exit = 1; }
      const { text } = await mq(withFd(mkSql(pre)));
      let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
      const at = msg.indexOf('MJRESULT');
      if (at < 0) { console.log(`  ✗ ${name}：塊が回らなかった ${msg.slice(0, 300)}`); exit = 1; continue; }
      const L = check(JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]));
      const hit = wants.map((w) => L.find(([n, c]) => n.startsWith(w) && !c));
      if (hit.every(Boolean)) { red++; console.log(`  ✓ ${name} → 狙いが赤・赤は全部で ${L.filter(([, c]) => !c).length}`); }
      else { console.log(`  ✗ ${name} → 狙いが赤にならない`); exit = 1; }
    }
  }
  await leftCheck();
  console.log(`\nmy-rules --waza: ${red}/${WZ.length} 狙いが赤になった`);
  process.exitCode = red === WZ.length && !exit ? 0 : 1;
}
