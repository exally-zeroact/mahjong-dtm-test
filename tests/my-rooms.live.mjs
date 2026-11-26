/* my-rooms.live.mjs — ★A15：続きの部屋を倉庫から（public.mj_my_rooms の p_open・last_date・hanchan_n・member_n）を本物のテスト倉庫で叩く★
 * =============================================================================
 * 定め＝memory/mahjong_tataki_2026-11-20/a15_sadame.md v4.0 §3。手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす）。
 * 1つの取引の塊（最後にわざと例外を投げて全部戻す＝倉庫に何も残さない）：
 *  ① 別の session の同じ人で同じ行／終えた部屋は p_open=true で出ず false で出る／消した部屋・出された部屋（room_bans）・他の人の部屋は出ない
 *  ② カードの数（§1.3）＝共有の表 tests/fixtures/card-counts.json の組を全部部屋にして、出るか（p_open=true）と last_date・hanchan_n・member_n を比べる
 *     （lib cardCounts の試験も同じ表を読む＝定義が割れたら片方が赤）。並びは配列の順＝created_at を clock_timestamp で入れる
 *  ③ 頁：limit 1 で before をたどると全部と同じ並び・重なりも抜けも無い（p_open の両方）
 *  ④ 3引数で呼べる（p_open 既定 false）・前からの欄（room_id kind name role closed created_at last_write_at）がそのまま在る
 *  ⑤ 権限：anon に EXECUTE 無し・PUBLIC 無し・authenticated だけ・3引数の古い形が倉庫に残っていない
 *  ⑥ 速さ（§2）：50部屋（各 1日 80半荘・3万半荘の部屋を1つ混ぜる）で p_open=true の1頁 5回の中央値 ms ≤ 100
 * --waza：5つ壊して狙った試験が赤になるか（壊した関数を塊の初めに当てる＝塊ごと戻る）。
 * 使い方: node tests/my-rooms.live.mjs [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
const CARDS = JSON.parse(fs.readFileSync(new URL('./fixtures/card-counts.json', import.meta.url), 'utf8')).cases;

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
const MAIL = 'mj-myrooms.invalid';
const NB = 'mr' + crypto.randomBytes(3).toString('hex');
const EP = `floor(extract(epoch from now()))`;
const AMRF = `jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5))`;
/* 人 i を session j で */
const asWho = (i, j = i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${j}], 'role', 'authenticated', 'amr', ${AMRF})::text, true);`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const MY = (a, b, n, open) => `public.mj_my_rooms(${a}, ${b}, ${n}${open === undefined ? '' : ', ' + open})`;

/* 部屋（v）を人 us[o] の持ち物で・ルール rs・last_write_at は今から m 分前 */
const mkRoom = (v, rs, o, m, extra = {}) => `
  ${v} := gen_random_uuid(); ${rs} := gen_random_uuid();
  insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, created_at, last_write_at, closed_at, deleted_at)
    values (${v}, '${NB}' || left(${v}::text, 8), lpad((floor(random() * 100000000))::bigint::text, 8, '0'), 'x', md5(random()::text) || md5(random()::text),
            us[${o}], md5(random()::text), now() - interval '1 day', now() - make_interval(mins => ${m}), ${extra.closed || 'null'}, ${extra.deleted || 'null'});
  insert into mahjong.rule_sets (id, version, room_id, rules) values (${rs}, 1, ${v}, '{"players":4}');
  update mahjong.rooms set rule_set_id = ${rs}, rule_version = 1 where id = ${v};
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (${v}, us[${o}], 'kan', 'create');`;
/* 開催（s）を日 dt で・voided sv／卓（t）voided tv／半荘 n（voided は nv 個） */
const mkDay = (v, rs, dt, sv, tabs) => `
  s := gen_random_uuid();
  insert into mahjong.sessions (id, room_id, date, voided, rule_set_id, rule_version, created_at) values (s, ${v}, ${dt}, ${sv}, ${rs}, 1, clock_timestamp());
  ${tabs.map(([tv, n, nv]) => `t := gen_random_uuid();
  insert into mahjong.tables (id, room_id, session_id, label, players, voided, rule_set_id, rule_version, created_at) values (t, ${v}, s, 'A', 4, ${tv}, ${rs}, 1, clock_timestamp());
  insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot, voided)
    select gen_random_uuid(), ${v}, t, 4, '{}'::jsonb, ${rs}, 1, '{"players":4}'::jsonb, k <= ${nv} from generate_series(1, ${n}) k;`).join('\n  ')}`;

/* 表の組 c を人1 の部屋（id は JS で決める）にする。並び＝配列の順（created_at は clock_timestamp）。鎖の印（chain_head・chain_no）は next から付ける */
const U = () => crypto.randomUUID();
const L = (x) => (x === null || x === undefined ? 'null' : "'" + String(x).replace(/'/g, "''") + "'");
function mkCase(c, i) {
  const v = U(), g = U(), out = [];
  const mid = Array.from({ length: c.members }, () => U());
  const M = (nm) => mid[Number(String(nm).slice(1)) - 1];
  out.push(`insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key, created_at, last_write_at)
    values ('${v}', '${NB}' || 'c${i}', lpad((floor(random() * 100000000))::bigint::text, 8, '0'), 'x', md5(random()::text) || md5(random()::text),
            us[1], md5(random()::text), now() - interval '1 day', now() - make_interval(mins => ${100 + i}));
  insert into mahjong.rule_sets (id, version, room_id, rules) values ('${g}', 1, '${v}', '{"players":4}'), ('${g}', 2, '${v}', '{"players":3}');
  update mahjong.rooms set rule_set_id = '${g}', rule_version = 1 where id = '${v}';
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values ('${v}', us[1], 'kan', 'create');`);
  if (mid.length) out.push(`insert into mahjong.members (id, room_id, name, name_key) values ${mid.map((m, k) => `('${m}', '${v}', 'm${k + 1}', 'm${k + 1}')`).join(', ')};`);
  for (const se of c.sessions) {
    const sid = U(), lg = se.league ? U() : null;
    if (lg) out.push(`insert into mahjong.leagues (id, room_id, name, rule_set_id, rule_version, owner_user_id) values ('${lg}', '${v}', 'L', '${g}', 1, us[1]);`);
    out.push(`insert into mahjong.sessions (id, room_id, date, voided, rule_set_id, rule_version, created_at, league_id) values ('${sid}', '${v}', ${L(se.date)}, ${!!se.voided}, '${g}', 1, clock_timestamp(), ${lg ? `'${lg}'` : 'null'});`);
    const tid = Object.fromEntries(se.tables.map((t) => [t.key, U()]));
    const prev = Object.fromEntries(se.tables.filter((t) => t.next).map((t) => [t.next, t.key]));
    const headOf = (k) => { let h = k, n = 0; while (prev[h]) { h = prev[h]; n++; } return [h, n]; };
    for (const t of se.tables) {
      const p = t.players || 4, [h, no] = headOf(t.key);
      out.push(`insert into mahjong.tables (id, room_id, session_id, label, players, voided, rule_set_id, rule_version, created_at, seats, chain_head, chain_no)
    values ('${tid[t.key]}', '${v}', '${sid}', ${L(t.key)}, ${p}, ${!!t.voided}, '${g}', ${p === 3 ? 2 : 1}, clock_timestamp(),
            ${L(JSON.stringify((t.seats || []).map(M)))}::jsonb, ${no ? `'${tid[h]}'` : 'null'}, ${no});`);
    }
    for (const t of se.tables) if (t.next) out.push(`update mahjong.tables set next_table_id = '${tid[t.next]}' where id = '${tid[t.key]}';`);
    for (const t of se.tables) {
      const p = t.players || 4;
      for (const hc of t.hanchans) {
        const seats = Object.fromEntries((hc.seats || Array.from({ length: p }, (_, k) => 'm' + (k + 1))).map((nm, k) => [String(k), M(nm)]));
        out.push(`insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot, voided, created_at)
    select gen_random_uuid(), '${v}', '${tid[t.key]}', ${p}, ${L(JSON.stringify(seats))}::jsonb, '${g}', ${p === 3 ? 2 : 1}, '{"players":${p}}'::jsonb, ${!!hc.voided}, clock_timestamp()
      from generate_series(1, ${hc.n});`);
      }
    }
    if (se.settled) out.push(`insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values ('${v}', '${sid}', 1, '{}', '{}', '[]');`);
  }
  return { v, sql: out.join('\n  ') };
}
const CASES = CARDS.map(mkCase);

const PAGE = (key, open) => `
  ids := '{}'; ba := null; bi := null;
  for i in 1..60 loop
    begin r := ${MY('ba', 'bi', 1, open)}; exception when others then r := jsonb_build_object('raised', sqlerrm, 'rooms', '[]'::jsonb); end;
    exit when jsonb_array_length(r -> 'rooms') = 0;
    ids := ids || (r -> 'rooms' -> 0 ->> 'room_id')::uuid;
    bi := (r -> 'rooms' -> 0 ->> 'room_id')::uuid;
    ba := coalesce((r -> 'rooms' -> 0 ->> 'last_write_at')::timestamptz, (r -> 'rooms' -> 0 ->> 'created_at')::timestamptz);
  end loop;
  res := res || jsonb_build_object('${key}', to_jsonb(ids));`;

const mkSql = (prefix = '') => `do ${q('mr')} declare res jsonb := '{}'; r jsonb; i int; rk int;
  us uuid[] := '{}'; ss uuid[] := '{}'; s uuid; t uuid; ids uuid[]; ba timestamptz; bi uuid; t0 timestamptz; ms float8[] := '{}';
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g6 uuid; vb uuid; gb uuid; vbig uuid; gbig uuid;
begin
  ${prefix}
  for i in 1..4 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 4) k;
  ss := ss || gen_random_uuid(); insert into auth.sessions (id, user_id) values (ss[5], us[1]);   -- 人1の別の端末

  /* 人1：r1 開いた・空／r2 終えた／r3 消した／r4 出された（room_bans）／r5 開いた・開催あり／r6 は人2の部屋 */
  ${mkRoom('r1', 'g1', 1, 10)}
  ${mkRoom('r2', 'g2', 1, 20, { closed: "now() - interval '1 hour'" })}
  ${mkRoom('r3', 'g3', 1, 30, { deleted: "now() - interval '1 hour'" })}
  ${mkRoom('r4', 'g4', 2, 40)}
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (r4, us[1], 'nyu', 'pass');
  insert into mahjong.room_bans (room_id, user_id) values (r4, us[1]);
  ${mkRoom('r5', 'g5', 2, 5)}
  insert into mahjong.room_accounts (room_id, user_id, role, joined_via, last_seen) values (r5, us[1], 'nyu', 'pass', now() - interval '200 days');
  ${mkRoom('r6', 'g6', 2, 1)}
  /* r5：11-20 に 2半荘／11-22 に開催2つ（a＝卓1 3半荘のうち1 voided・卓2 voided で2半荘、b＝卓1 1半荘）／11-23 は voided の開催で5半荘 */
  ${mkDay('r5', 'g5', "'2026-11-20'", false, [[false, 2, 0]])}
  ${mkDay('r5', 'g5', "'2026-11-22'", false, [[false, 3, 1], [true, 2, 0]])}
  ${mkDay('r5', 'g5', "'2026-11-22'", false, [[false, 1, 0]])}
  ${mkDay('r5', 'g5', "'2026-11-23'", true, [[false, 5, 0]])}
  insert into mahjong.members (room_id, name, name_key, active) select r5, 'm' || k, 'm' || k, k <= 3 from generate_series(1, 4) k;
  /* ② 表の組（人1 の部屋） */
  ${CASES.map((x) => x.sql).join('\n  ')}
  ${ROW('ids', `jsonb_build_object('r1', r1, 'r2', r2, 'r3', r3, 'r4', r4, 'r5', r5, 'r6', r6)`)}

  ${asWho(1)}
  ${T('all', MY('null', 'null', 50, 'false'))}
  ${T('open', MY('null', 'null', 50, 'true'))}
  ${T('three', MY('null', 'null', 50))}
  ${T('b0', MY('null', 'null', 0, 'true'))}
  ${T('b51', MY('null', 'null', 51, 'true'))}
  ${T('bh', MY('now()', 'null', 10, 'true'))}
  ${PAGE('pg_all', 'false')}
  ${PAGE('pg_open', 'true')}
  ${asWho(1, 5)}
  ${T('dev2', MY('null', 'null', 50, 'true'))}
  ${asWho(3)}
  ${T('other', MY('null', 'null', 50, 'false'))}
  perform set_config('request.jwt.claims', '', true);
  ${T('nose', MY('null', 'null', 50, 'true'))}

  /* 掃除を回しても 200日開かない入の行は残る（§1.7） */
  perform mahjong_private.mj_sweep_tail(1000);
  ${ROW('kept', `exists (select 1 from mahjong.room_accounts where room_id = r5 and user_id = us[1])`)}

  /* ⑥a 速さ（§2 v4.1）：人4 に 50部屋＝49 は 1日 80半荘（4卓×20）・部屋 25 は 3万半荘を 375日（1日1卓 80半荘）に分けて持つ */
  ${asWho(4)}
  for rk in 1..50 loop
    ${mkRoom('vb', 'gb', 4, 'rk')}
    insert into mahjong.members (room_id, name, name_key) select vb, 'm' || j, 'm' || j from generate_series(1, 4) j;
    if rk = 25 then
      vbig := vb; gbig := gb;
      for i in 1..375 loop
        s := gen_random_uuid(); t := gen_random_uuid();
        insert into mahjong.sessions (id, room_id, date, rule_set_id, rule_version, created_at) values (s, vb, current_date - (375 - i), gb, 1, now() - make_interval(mins => 376 - i));
        insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version) values (t, vb, s, 'A', 4, gb, 1);
        insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot)
        select gen_random_uuid(), vb, t, 4,
               jsonb_build_object('0', 'p' || (j % 5), '1', 'p' || ((j + 1) % 5), '2', 'p' || ((j + 2) % 5), '3', 'p' || ((j + 3) % 5)),
               gb, 1, '{"players":4}'::jsonb from generate_series(1, 80) j;
      end loop;
    else
      s := gen_random_uuid();
      insert into mahjong.sessions (id, room_id, date, rule_set_id, rule_version) values (s, vb, current_date, gb, 1);
      for i in 1..4 loop
        t := gen_random_uuid();
        insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version) values (t, vb, s, 'A', 4, gb, 1);
        insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot)
        select gen_random_uuid(), vb, t, 4,
               jsonb_build_object('0', 'p' || (j % 5), '1', 'p' || ((j + 1) % 5), '2', 'p' || ((j + 2) % 5), '3', 'p' || ((j + 3) % 5)),
               gb, 1, '{"players":4}'::jsonb from generate_series(1, 20) j;
      end loop;
    end if;
  end loop;
  analyze mahjong.hanchans; analyze mahjong.tables; analyze mahjong.sessions;
  ms := '{}';
  for i in 1..5 loop t0 := clock_timestamp(); begin r := ${MY('null', 'null', 50, 'true')}; exception when others then r := jsonb_build_object('raised', sqlerrm, 'rooms', '[]'::jsonb); end; ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::float8; end loop;
  ${ROW('speed', `jsonb_build_object('ms', to_jsonb(ms), 'n', jsonb_array_length(r -> 'rooms'),
    'big', (select max((x ->> 'hanchan_n')::int) from jsonb_array_elements(r -> 'rooms') x),
    'bigm', (select (x ->> 'member_n')::int from jsonb_array_elements(r -> 'rooms') x order by (x ->> 'hanchan_n')::int desc limit 1),
    'all', (select count(*) from mahjong.hanchans where room_id = vbig))`)}

  /* ⑥b 一番重い形（§2 v4.1）：部屋 25 に締めない開催を足し、1卓の鎖に3万半荘（席は5人が回る＝member_n の数えを本当に測る） */
  gb := gbig; s := gen_random_uuid(); t := gen_random_uuid();
  insert into mahjong.sessions (id, room_id, date, rule_set_id, rule_version, created_at) values (s, vbig, current_date, gbig, 1, now());
  insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version) values (t, vbig, s, 'A', 4, gbig, 1);
  insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot)
        select gen_random_uuid(), vbig, t, 4,
               jsonb_build_object('0', 'p' || (j % 5), '1', 'p' || ((j + 1) % 5), '2', 'p' || ((j + 2) % 5), '3', 'p' || ((j + 3) % 5)),
               gb, 1, '{"players":4}'::jsonb from generate_series(1, 30000) j;
  analyze mahjong.hanchans;
  ms := '{}';
  for i in 1..5 loop t0 := clock_timestamp(); begin r := ${MY('null', 'null', 50, 'true')}; exception when others then r := jsonb_build_object('raised', sqlerrm, 'rooms', '[]'::jsonb); end; ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::float8; end loop;
  ${ROW('worst', `jsonb_build_object('ms', to_jsonb(ms), 'n', jsonb_array_length(r -> 'rooms'),
    'big', (select max((x ->> 'hanchan_n')::int) from jsonb_array_elements(r -> 'rooms') x),
    'bigm', (select (x ->> 'member_n')::int from jsonb_array_elements(r -> 'rooms') x order by (x ->> 'hanchan_n')::int desc limit 1),
    'all', (select count(*) from mahjong.hanchans where room_id = vbig))`)}

  /* ⑥c（§2 v1.3）：人3 に 締めた部屋 300（最後の開催に settle_snaps）＋開いた部屋 5・p_open=true で limit 50 を全部たどる */
  ${asWho(3)}
  for rk in 1..305 loop
    ${mkRoom('vb', 'gb', 3, 'rk')}
    s := gen_random_uuid(); t := gen_random_uuid();
    insert into mahjong.sessions (id, room_id, date, rule_set_id, rule_version) values (s, vb, current_date - 1, gb, 1);
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version) values (t, vb, s, 'A', 4, gb, 1);
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot)
        select gen_random_uuid(), vb, t, 4,
               jsonb_build_object('0', 'p' || (j % 5), '1', 'p' || ((j + 1) % 5), '2', 'p' || ((j + 2) % 5), '3', 'p' || ((j + 3) % 5)),
               gb, 1, '{"players":4}'::jsonb from generate_series(1, 8) j;
    if rk % 61 <> 0 then
      insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing) values (vb, s, 1, '{}', '{}', '[]');
    end if;
  end loop;
  analyze mahjong.settle_snaps; analyze mahjong.sessions;
  ms := '{}'; ids := '{}'; ba := null; bi := null;
  for i in 1..20 loop
    t0 := clock_timestamp(); begin r := ${MY('ba', 'bi', 50, 'true')}; exception when others then r := jsonb_build_object('raised', sqlerrm, 'rooms', '[]'::jsonb); end; ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::float8;
    exit when jsonb_array_length(r -> 'rooms') = 0;
    ids := ids || array(select (x ->> 'room_id')::uuid from jsonb_array_elements(r -> 'rooms') x);
    select (x ->> 'last_write_at')::timestamptz, (x ->> 'room_id')::uuid into ba, bi from jsonb_array_elements(r -> 'rooms') x order by coalesce((x ->> 'last_write_at')::timestamptz, (x ->> 'created_at')::timestamptz), (x ->> 'room_id')::uuid limit 1;
  end loop;
  ${ROW('walk', `jsonb_build_object('ms', to_jsonb(ms), 'n', coalesce(array_length(ids, 1), 0))`)}

  ${ROW('acl', `jsonb_build_object(
    'anon', has_function_privilege('anon', 'public.mj_my_rooms(timestamptz, uuid, int, boolean)', 'execute'),
    'auth', has_function_privilege('authenticated', 'public.mj_my_rooms(timestamptz, uuid, int, boolean)', 'execute'),
    'pub', exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = 'public.mj_my_rooms(timestamptz, uuid, int, boolean)'::regprocedure and x.grantee = 0),
    'old3', to_regprocedure('public.mj_my_rooms(timestamptz, uuid, int)') is not null,
    'n', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mj_my_rooms'))`)}
  raise exception 'MJRESULT%', res::text;
end ${q('mr')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const J = (x) => JSON.stringify(x);
const isErr = (r, err, f = {}) => !!r && r.ok === false && r.err === err && Object.entries(f).every(([k, v]) => r[k] === v);
const OLD_KEYS = ['room_id', 'kind', 'name', 'role', 'closed', 'created_at', 'last_write_at'];

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  const I = o.ids || {};
  const pick = (r) => (r?.rooms || []).map((x) => x.room_id);
  const ours = (r) => pick(r).filter((x) => Object.values(I).includes(x));
  const byId = (r, id) => (r?.rooms || []).find((x) => x.room_id === id);
  /* ① */
  ok('① p_open=false：r5 r1 r2 の順で出る（消した・出された・他の人の部屋は出ない）', J(ours(o.all)) === J([I.r5, I.r1, I.r2]), J(ours(o.all)));
  ok('① p_open=true：終えた r2 は出ない（r5 r1）', J(ours(o.open)) === J([I.r5, I.r1]), J(ours(o.open)));
  ok('① p_open=false：表の組の部屋が全部出る（' + CASES.length + '）', CASES.every((c) => !!byId(o.all, c.v)), J(CASES.map((c, k) => (byId(o.all, c.v) ? null : k)).filter((x) => x !== null)));
  ok('① 別の session の同じ人で同じ行', o.dev2?.ok === true && J(o.dev2) === J(o.open), J(o.dev2));
  ok('① 他の人（部屋に居ない）には1つも出ない', o.other?.ok === true && ours(o.other).length === 0, J(o.other));
  ok('① 出された部屋（room_bans）は出ない', !pick(o.all).includes(I.r4), J(pick(o.all)));
  ok('① session 無しは mj_session', isErr(o.nose, 'mj_session'), J(o.nose));
  ok('① limit 0・51 は bad limit・before の片方だけは bad before', isErr(o.b0, 'bad', { what: 'limit' }) && isErr(o.b51, 'bad', { what: 'limit' }) && isErr(o.bh, 'bad', { what: 'before' }), J([o.b0, o.b51, o.bh]));
  /* ② */
  const x5 = byId(o.open, I.r5), x1 = byId(o.open, I.r1);
  CARDS.forEach((c, k) => {
    const w = c.want, a2 = byId(o.all, CASES[k].v), shown = !!byId(o.open, CASES[k].v);
    ok(`② 表 ${k + 1}「${c.name}」`, !!a2 && shown === w.open && a2.last_date === w.last_date && a2.hanchan_n === w.hanchan_n && a2.member_n === w.member_n,
      J({ want: w, got: a2 && { open: shown, last_date: a2.last_date, hanchan_n: a2.hanchan_n, member_n: a2.member_n } }));
  });
  ok('② 開催の無い部屋は last_date null・hanchan_n 0・member_n 0', x1 && x1.last_date === null && x1.hanchan_n === 0 && x1.member_n === 0, J(x1));
  ok('② name は shared だけ（solo の部屋は null）・role は人1の役（r5 nyu）', x5?.role === 'nyu' && (x5.kind === 'shared' ? typeof x5.name === 'string' : x5.name === null), J(x5));
  /* ③ */
  ok('③ before で1件ずつたどる＝全部と同じ並び・重なり無し（false）', J(o.pg_all) === J(pick(o.all)) && new Set(o.pg_all).size === (o.pg_all || []).length, J([o.pg_all, pick(o.all)]));
  ok('③ before で1件ずつたどる＝全部と同じ並び・重なり無し（true）', J(o.pg_open) === J(pick(o.open)) && new Set(o.pg_open).size === (o.pg_open || []).length, J([o.pg_open, pick(o.open)]));
  /* ④ */
  ok('④ 3引数で呼べて p_open=false と同じ行・前からの欄がそろう', o.three?.ok === true && J(o.three) === J(o.all)
    && (o.three.rooms || []).every((x) => OLD_KEYS.every((k) => k in x)) && !J(o.three).includes('room_no'), J(o.three));
  /* ⑤ */
  const a = o.acl || {};
  ok('⑤ anon に EXECUTE 無し・PUBLIC 無し・authenticated だけ・3引数の古い形は無い（1本）', a.anon === false && a.auth === true && a.pub === false && a.old3 === false && Number(a.n) === 1, J(a));
  /* §1.7 */
  ok('§1.7 200日開かない入の行は mj_sweep_tail を回しても残る', o.kept === true, J(o.kept));
  /* ⑥（§2 v4.1） */
  const med = (x) => [...(x?.ms || [])].sort((p, q2) => p - q2)[2];
  const ma = med(o.speed), mb = med(o.worst), wk = o.walk || {}, wmax = Math.max(...(wk.ms || [Infinity]));
  ok(`⑥a 50部屋（3万半荘を375日に分けた部屋1つ）で p_open=true の1頁 中央値 ${ma?.toFixed?.(1)}ms ≤ 100`, o.speed?.n === 50 && o.speed.big === 80 && o.speed.all === 30000 && ma <= 100, J(o.speed));
  ok(`⑥b 一番重い形（1つの鎖に3万半荘）で1頁 中央値 ${mb?.toFixed?.(1)}ms ≤ 200`, o.worst?.n === 50 && o.worst.big === 30000 && o.worst.bigm === 5 && o.worst.all === 60000 && mb <= 200, J(o.worst));
  ok(`⑥c 締めた300＋開いた5 を limit 50 で全部たどる：5部屋・頁ごと最大 ${wmax.toFixed(1)}ms ≤ 100`, wk.n === 5 && wmax <= 100, J(wk));
  return L;
}

/* --waza：関数の字を置き換えて塊の初めに当てる */
const FN = 'public.mj_my_rooms(timestamptz, uuid, int, boolean)';
const brk = (from, to) => `fd := pg_get_functiondef('${FN}'::regprocedure); fd2 := replace(fd, ${q('a')}${from}${q('a')}, ${q('b')}${to}${q('b')});
  if fd2 = fd then raise exception 'waza の字が見つからない'; end if; execute fd2;`;
const T2 = (re) => { const k = CARDS.findIndex((c) => re.test(c.name)); if (k < 0) throw new Error('表の組が無い ' + re); return `② 表 ${k + 1}「`; };
const WZ = [
  ['W1 user_id の絞りを抜く', brk('where a.user_id = v_me and x.deleted_at is null', 'where x.deleted_at is null'), ['① 他の人']],
  ['W2 hanchan_n が voided の半荘を外す', brk('select pg_catalog.count(*) as hn,', 'select pg_catalog.count(*) filter (where not k.voided) as hn,'), [T2(/^8局/)]],
  ['W3 最後の開催で voided を見ない', brk('s.league_id is null and not s.voided', 's.league_id is null'), [T2(/^取り消した開催が最後/)]],
  ['W4 p_open で closed_at を見ない', brk('(not v_open or (x.closed_at is null', '(not v_open or (true'), ['① p_open=true']],
  ['W4b 最後の開催の締めを見ない', brk('not exists (select 1 from mahjong.settle_snaps z where z.session_id = ls.id)', 'true'), [T2(/^最後の開催に締め/)]],
  ['W5 room_bans を見ない', brk('and not exists (select 1 from mahjong.room_bans b where b.room_id = x.id and b.user_id = v_me)', ''), ['① 出された部屋']],
  ['W6 最後の開催を日付で選ぶ（max(date) に戻す）', brk('order by s.created_at desc, s.id desc limit 1) ls', 'order by s.date desc, s.created_at desc limit 1) ls'), [T2(/^日付を前に/)]],
  ['W7 鎖を見ない（今の卓だけ）', brk('(x.id = ft.h or x.chain_head = ft.h)', 'x.id = ft.h'), [T2(/^区切った鎖/)]],
  ['W8 鎖の voided の卓を外す', brk('where x.session_id = q.sid and (x.id = ft.h', 'where x.session_id = q.sid and not x.voided and (x.id = ft.h'), [T2(/^鎖 A→B で B を取り消す→鎖の最後/)]],
  ['W9 member_n を部屋の members の数にする', brk("'member_n', coalesce(c.mn, 0)", "'member_n', (select pg_catalog.count(*) from mahjong.members mm where mm.room_id = q.id)"), [T2(/^10人/)]],
  ['W10 今の卓を created_at desc の1つにする', brk('then 0 else 1 end),', 'then 0 else 1 end), t.created_at desc, t.id desc,'), [T2(/^同じ開催に鎖でない卓が2つ/)]],
  ['W11 卓の seats を jsonb_each で開く', brk('pg_catalog.jsonb_array_elements_text(lt.seats)', 'pg_catalog.jsonb_each_text(lt.seats)'), ['呼びが例外を投げていない']],
  ['W12 控えの卓を鎖の頭にする', brk('order by x.chain_no desc', 'order by x.chain_no asc'), [T2(/^鎖 A→B（4人→3人）/)]],
  ['W13 頭の判じで voided を見ない', brk('(case when not t.voided', '(case when true'), [T2(/^卓1 を取り消す→/)]],
  ['W14 member_n が voided の半荘の席も数える', brk("and not k.voided and e.value <> ''", "and e.value <> ''"), [T2(/^取り消した半荘にだけ座った人/)]],
  ['W15 最後の開催でリーグを外さない', brk('s.league_id is null and not s.voided', 'not s.voided'), [T2(/^リーグの日が後に在る/)]],
];

let pass = 0, fail = 0, exit = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 600) : '')); } };
const leftCheck = async () => {
  const lf = (await rows(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`))[0];
  say('倉庫に試しの人・部屋が残っていない', lf.u === 0 && lf.r === 0, J(lf));
};
const withFd = (body) => body.replace('declare res jsonb', 'declare fd text; fd2 text; res jsonb');

if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  await leftCheck();
  console.log(`\nmy-rooms: ${pass} passed, ${fail} failed`);
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
  console.log(`\nmy-rooms --waza: ${red}/${WZ.length} 狙いが赤になった`);
  process.exitCode = red === WZ.length && !exit ? 0 : 1;
}
