/* p2-read.live.mjs — ★P2 読みの門・席・頁を本物のテスト倉庫で叩く★（定め mahjong_tataki_2026-11-20/p2_sadame.md v5.1 §3）
 * =============================================================================
 * 手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす）。
 * A（1つの取引の塊・最後にわざと例外で全部戻す）：
 *   §3.1 門＝read:u1m の今の分と前の分の和が 80,000 を越えたら busy what read（v 無しも league v3 も）・他の人は読める・数え（gone・bad は数えない）
 *   §3.2 league v3＝日を触る op を1組ずつ回し、中身が変わった日の day_ver だけが新しい read_ver（他の日は動かない・人とリーグの op は日を動かさない）／
 *        v3 の頁（since・after）を継いだ st＝v 無しの st（締めは最後の rev だけ中身）／roomGate と applyOps が通る／
 *        512KB の天井（1つの卓が越える時だけ1卓の頁）・開催の行と締めはその日の最初の頁だけ・since と after を一緒に／
 *        締めの数＋1 の rev で［対局終了し直す］が ok／room_ns＝cell_set で数え直さない・hanchan_start と void で数え直し・n／last＝v 無しの st から数えた数
 * B（別の接続を並べる・倉庫に書いて finally で消す）：
 *   §3.1 5本目の同時の読み＝read_one／§3.2 待つ鍵を他の接続が持つ間に4本読み→全部が待って新しい n／§3.1 時間切れ＝read_slow で ms が数えに残る
 * --waza：壊して狙った試験が赤になるか（A は壊した関数を塊の頭で当てる＝塊ごと戻る。B は名を変えた写し mahjong_private.mj_read_wz を作って finally で消す）
 * --sokutei：§3.3 の測り（3万半荘の部屋の v3 の ms・room_ns の前と後）を足す
 * 使い方: node tests/p2-read.live.mjs [--waza] [--sokutei] [--b-skip]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { applyOps, roomGate, canon } from '../lib/room-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(/url:\s*'([^']+)'/.exec(src)[1])[1];
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2' || !/env:\s*'test'/.test(src)) {
  console.log('★中止★ 倉庫が khaw（test）でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1);
}
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
const WAZA = process.argv.includes('--waza');
const SOKUTEI = process.argv.includes('--sokutei');
const B_SKIP = process.argv.includes('--b-skip');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}
async function mqRows(query) {
  const { status, text } = await mq(query);
  let rows = null; try { rows = JSON.parse(text); } catch (_) { /* 字 */ }
  if (status >= 300 || !Array.isArray(rows)) throw new Error(`倉庫 ${status}: ${text.slice(0, 400)}`);
  return rows;
}

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const J = (x) => JSON.stringify(x);
const U = () => crypto.randomUUID();
const MAIL = 'mj-p2.invalid';
const NB = 'p2' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const N_U = 3;   // 1＝持ち主・L 2＝入 3＝入っていない人
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const URLH = `md5(random()::text) || md5(random()::text)`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
const RSR = `delete from mahjong.limits where kind = 'read:u1m';`;
const jb = (x) => `${lit(J(x))}::jsonb`;
/* op の $bv＝base_version を倉庫の今の版から引く SQL */
const opsSql = (ops) => `jsonb_build_array(${ops.map((o) => { const { $bv, ...rest } = o; return $bv ? `(${jb(rest)} || jsonb_build_object('base_version', (${$bv})))` : jb(rest); }).join(', ')})`;
const CR = (name, rules) => `public.mj_room_create(gen_random_uuid(), ${lit(name)}, ${lit(PASS)}, ${jb(rules)}, jsonb_build_object('url_token_hash', ${URLH}))`;
const WR = (room, ops) => `public.mj_write(${room}, gen_random_uuid(), ${opsSql(ops)})`;
const RD = (room, argsSql, what = `'room'`) => `public.mj_read(${room}, ${what}, ${argsSql})`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;

/* ── 部屋とリーグ ── */
const FR = { players: 4, rate: 100, chip_pt10: 20, kyotaku_end: 'kieru', tobi: true, tobi_pt: 10 };
const L1 = U();
const LC = { op: 'league_create', league_id: L1, name: 'P2 リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'avg_pt', min_games: 1,
  players_main: 4, rules: FR, rules_alt: { players: 3 } };
const M = [U(), U(), U(), U(), U(), U()];
const [DA, DB, DC, DP, R0] = [U(), U(), U(), U(), U()];
const [TA, TB, TR] = [U(), U(), U()];
const [HA1, HA2, HB1, HR1, HR2, HR3] = [U(), U(), U(), U(), U(), U()];
const S4 = M.slice(0, 4);
const cv = (h, s) => `select version from mahjong.cells where hanchan_id = ${lit(h)}::uuid and seat = ${s}`;
const hv = (h, col) => `select ${col} from mahjong.hanchans where id = ${lit(h)}::uuid`;
const xv = (t, m, k) => `select version from mahjong.extras where table_id = ${lit(t)}::uuid and member_id = ${lit(m)}::uuid and kind = ${lit(k)}`;
/* [名前, ops, 動く日（null＝どの日も動かない）] */
const DSTEPS = [
  ['開催（リーグ）', [{ op: 'session_add', session_id: DA, date: '2026-11-20', rate: null, league_id: L1 }]],
  ['卓＋卓の席', [{ op: 'table_add', table_id: TA, session_id: DA, label: '卓1' }, { op: 'table_seats', table_id: TA, seats: S4 }]],
  ['半荘1', [{ op: 'hanchan_start', hanchan_id: HA1, table_id: TA, seats: S4, cells: [40000, 30000, 20000, 10000] }]],
  ['cell_set 2つ', [{ op: 'cell_set', hanchan_id: HA1, seat: 0, value: 39000, $bv: cv(HA1, 0) }, { op: 'cell_set', hanchan_id: HA1, seat: 3, value: 11000, $bv: cv(HA1, 3) }]],
  ['半荘2（飛び）', [{ op: 'hanchan_start', hanchan_id: HA2, table_id: TA, seats: [M[1], M[0], M[3], M[2]], cells: [52000, 31000, 20000, -3000] }]],
  ['tobi_set', [{ op: 'tobi_set', hanchan_id: HA2, tobi_to: { 3: 0 }, $bv: hv(HA2, 'tobi_version') }]],
  ['hanchan_order', [{ op: 'hanchan_order', hanchan_id: HA1, ton_order: [M[1], M[0], M[2], M[3]], $bv: hv(HA1, 'order_version') }]],
  ['kyotaku_set', [{ op: 'kyotaku_set', hanchan_id: HA1, value: 2000, $bv: hv(HA1, 'version') }]],
  ['extra_add', [{ op: 'extra_add', table_id: TA, member_id: M[0], kind: 'chip', add: 3 }, { op: 'extra_add', table_id: TA, member_id: M[1], kind: 'chip', add: -3 }]],
  ['extra_set', [{ op: 'extra_set', table_id: TA, member_id: M[0], kind: 'chip', value: 5, $bv: xv(TA, M[0], 'chip') }]],
  ['hanchan_void', [{ op: 'hanchan_void', hanchan_id: HA1 }]],
  ['hanchan_unvoid', [{ op: 'hanchan_unvoid', hanchan_id: HA1 }]],
  ['hanchan_seats', [{ op: 'hanchan_seats', hanchan_id: HA1, seats: [M[4], M[1], M[2], M[3]] }]],
  ['table_edit', [{ op: 'table_edit', table_id: TA, rate_mode: 'num', rate: 30 }]],
  ['session_edit', [{ op: 'session_edit', session_id: DA, place: '雀荘 東' }]],
  ['締め rev1', [{ op: 'settle_snap', session_id: DA, rev: 1, content: { ten: { [M[0]]: 12, [M[1]]: -12 } }, used: { chip: true }, missing: [] }]],
  ['次の日の開催・卓・半荘', [{ op: 'session_add', session_id: DB, date: '2026-11-21', rate: null, league_id: L1 }, { op: 'table_add', table_id: TB, session_id: DB, label: '卓1' },
    { op: 'hanchan_start', hanchan_id: HB1, table_id: TB, seats: S4, cells: [25000, 25000, 25000, 25000] }]],
  ['締め rev2', [{ op: 'settle_snap', session_id: DA, rev: 2, content: { ten: { [M[0]]: 10, [M[1]]: -10 } }, used: { chip: true }, missing: [] }]],
  ['次の日の締め', [{ op: 'settle_snap', session_id: DB, rev: 1, content: { ten: {} }, used: {}, missing: [] }]],
  ['3つ目の日', [{ op: 'session_add', session_id: DC, date: '2026-11-22', rate: null, league_id: L1 }]],
  ['人の op（日は動かない）', [{ op: 'member_add', member_id: M[5], name: 'P2の6' }, { op: 'member_rename', member_id: M[4], name: 'P2の5改' }]],
  ['league_save（日は動かない）', [{ op: 'league_save', league_id: L1, base_version: 1, rules: { ...FR, rate: 200 } }]],
  ['日を取り消す', [{ op: 'session_edit', session_id: DC, voided: true }]],
];
const LARGS = (extra = '') => `jsonb_build_object('league_id', ${lit(L1)}, 'v', 3${extra ? ', ' + extra : ''})`;
const LNOV = `jsonb_build_object('league_id', ${lit(L1)})`;
const V3R = `'{"v": 3}'::jsonb`;
const DV = `select coalesce(jsonb_object_agg(id, day_ver), '{}') from mahjong.sessions where room_id = rg and league_id = ${lit(L1)}::uuid`;
/* 頁を回し切る（中身ごと） */
const PAGES = (key, argsSql) => `
    pg := '[]'; r := ${RD('rg', argsSql, `'league'`)}; pg := pg || jsonb_build_array(r); i := 0;
    while coalesce((r ->> 'more')::boolean, false) and i < 40 loop
      i := i + 1; r := ${RD('rg', `(${argsSql}) || jsonb_build_object('after', r -> 'next_after')`, `'league'`)}; pg := pg || jsonb_build_array(r);
    end loop;
    res := res || jsonb_build_object('${key}', pg);`;
/* 頁を回し切る（大きさと数だけ・中身は返さない） */
const PSUM = (key, argsSql) => `
    pg := '[]'; i := 0; r := jsonb_build_object('more', true, 'first', true);
    while coalesce((r ->> 'more')::boolean, false) and i < 40 loop
      t0 := clock_timestamp();
      r := ${RD('rg', `(${argsSql}) || case when r ? 'first' then '{}'::jsonb else jsonb_build_object('after', r -> 'next_after') end`, `'league'`)};
      pg := pg || jsonb_build_array(jsonb_build_object('ok', r -> 'ok', 'err', r -> 'err', 'more', r -> 'more', 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1),
        'body', coalesce(octet_length((r #> '{st,sessions}')::text), 0) + coalesce(octet_length((r #> '{st,tables}')::text), 0) + coalesce(octet_length((r #> '{st,hanchans}')::text), 0)
              + coalesce(octet_length((r #> '{st,extras}')::text), 0) + coalesce(octet_length((r #> '{st,settles}')::text), 0),
        'all', octet_length(r::text),
        'tables', (select jsonb_agg(e ->> 'table_id') from jsonb_array_elements(r #> '{st,tables}') e),
        'sess', (select jsonb_agg(e ->> 'session_id') from jsonb_array_elements(r #> '{st,sessions}') e),
        'sett', (select jsonb_agg(e ->> 'session_id') from jsonb_array_elements(r #> '{st,settles}') e),
        'nh', jsonb_array_length(coalesce(r #> '{st,hanchans}', '[]')), 'nx', jsonb_array_length(coalesce(r #> '{st,extras}', '[]'))));
      i := i + 1;
    end loop;
    res := res || jsonb_build_object('${key}', pg);`;
const BIG_P = 350, BIG_N = 3000;
const BIGT = [U(), U(), U(), U()];   // 0..2＝350 半荘・3＝3000 半荘（1卓で天井を越える）
const SOK_N = 500, SOK_H = 60;       // §3.3 3万半荘

const mkSql = (prefix = '') => `do ${q('p2')} declare res jsonb := '{}'; r jsonb; pg jsonb; i int; v0 bigint; t0 timestamptz;
  us uuid[] := '{}'; ss uuid[] := '{}'; rg uuid;
begin
  ${prefix}
  delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
  ${RSR}
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;
  ${asWho(1)}
  ${T('made', CR(NB + 'の部屋', FR))} rg := (r->>'room_id')::uuid;
  ${asWho(2)} ${T('j2', `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(NB + 'の部屋')})`)}
  ${asWho(1)} ${RS}
  ${T('w_m', WR('rg', M.slice(0, 5).map((id, i) => ({ op: 'member_add', member_id: id, name: 'P2の' + i }))))}
  ${RS} ${T('w_lc', WR('rg', [LC]))}

  /* §3.1 門 */
  ${undo('ga', `${asWho(1)}
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', us[1]::text, date_trunc('minute', now()), 80001);
    ${T('ga_room', RD('rg', `'{}'::jsonb`))} ${T('ga_v3', RD('rg', LARGS(), `'league'`))} ${T('ga_nov', RD('rg', LNOV, `'league'`))} ${T('ga_rv3', RD('rg', V3R))}
    ${asWho(2)} ${T('ga_other', RD('rg', `'{}'::jsonb`))}`)}
  ${undo('gb', `${asWho(1)}
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', us[1]::text, date_trunc('minute', now()), 40001),
      ('read:u1m', us[1]::text, date_trunc('minute', now()) - interval '1 minute', 40000);
    ${T('gb_room', RD('rg', `'{}'::jsonb`))}`)}
  ${undo('gc', `${asWho(1)}
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', us[1]::text, date_trunc('minute', now()), 80000);
    ${T('gc_room', RD('rg', `'{}'::jsonb`))}
    ${ROW('gc_n', `select count from mahjong.limits where kind = 'read:u1m' and key = us[1]::text and window_start = date_trunc('minute', now())`)}`)}
  ${undo('gd', `${asWho(1)}
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', us[1]::text, date_trunc('minute', now()) - interval '2 minute', 90000);
    ${T('gd_room', RD('rg', `'{}'::jsonb`))}
    ${ROW('gd_old', `select count(*) from mahjong.limits where kind = 'read:u1m' and key = us[1]::text and window_start < date_trunc('minute', now()) - interval '1 minute'`)}`)}
  ${undo('gn', `${asWho(1)} ${RSR}
    ${T('gn_r', RD('rg', `'{}'::jsonb`))}
    ${ROW('gn_1', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'read:u1m' and key = us[1]::text`)}
    ${T('gn_bad', RD('rg', `'{}'::jsonb`, `'rooms'`))} ${T('gn_bad2', RD('rg', LARGS(`'after', 'x'`), `'league'`))}
    ${T('gn_bad3', RD('rg', `jsonb_build_object('league_id', ${lit(U())}, 'v', 3)`, `'league'`))}
    ${ROW('gn_2', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'read:u1m' and key = us[1]::text`)}
    ${T('gn_same', RD('rg', `jsonb_build_object('since', (select read_ver from mahjong.rooms where id = rg))`))}
    ${ROW('gn_3', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'read:u1m' and key = us[1]::text`)}
    ${asWho(3)} ${T('gn_gone', RD('rg', `'{}'::jsonb`))}
    ${ROW('gn_u3', `select count(*) from mahjong.limits where kind = 'read:u1m' and key = us[3]::text`)}`)}

  /* §3.2 日を触る op を1組ずつ */
  ${asWho(1)}
  ${DSTEPS.map(([, ops], k) => `${RS} ${RSR} ${T('dw' + k, WR('rg', ops))}
  ${ROW('dv' + k, DV)} ${T('dl' + k, RD('rg', LNOV, `'league'`))}`).join('\n  ')}
  ${RSR}
  /* v3 全部の頁・v 無し（同じ時） */
  ${PAGES('full', LARGS())}
  ${T('vl1', RD('rg', LNOV, `'league'`))}
  v0 := (select read_ver from mahjong.rooms where id = rg);
  ${ROW('v0', 'v0')}
  ${T('same3', RD('rg', LARGS(`'since', v0`), `'league'`))}
  ${T('bad_af1', RD('rg', LARGS(`'after', jsonb_build_object('session_id', ${lit(U())})`), `'league'`))}
  ${T('bad_af2', RD('rg', LARGS(`'after', jsonb_build_object('session_id', ${lit(DA)}, 'table_id', ${lit(TB)})`), `'league'`))}
  ${T('bad_af3', RD('rg', LARGS(`'after', 'x'`), `'league'`))}
  /* since：DB だけ動かす → since v0 の頁を継ぐ */
  ${RS} ${T('sw', WR('rg', [{ op: 'extra_add', table_id: TB, member_id: M[2], kind: 'chip', add: 2 }, { op: 'extra_add', table_id: TB, member_id: M[3], kind: 'chip', add: -2 }]))}
  ${PAGES('since', LARGS(`'since', v0`))}
  ${T('vl2', RD('rg', LNOV, `'league'`))}
  /* 締めの数＋1 の rev で［対局終了し直す］ */
  ${RS} ${T('rerev', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'settle_snap', 'session_id', ${lit(DA)}, 'rev',
      (select count(*) from mahjong.mj_read_dummy_never)::int)))`.replace('(select count(*) from mahjong.mj_read_dummy_never)::int', `(select count(*) + 1 from jsonb_array_elements((select x from jsonb_array_elements(res -> 'full') x limit 1) #> '{st,settles}') e where e ->> 'session_id' = ${lit(DA)})::int`)
      .replace(')))', `, 'content', jsonb_build_object('ten', jsonb_build_object()), 'used', jsonb_build_object(), 'missing', jsonb_build_array())))`))}

  /* 512KB の頁（直に入れる・塊ごと戻す） */
  ${undo('bg', `${asWho(1)} ${RS}
    ${T('bg_s', WR('rg', [{ op: 'session_add', session_id: DP, date: '2026-11-23', rate: null, league_id: L1 }]))}
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, created_at)
      select (${lit(J(BIGT))}::jsonb ->> (k - 1))::uuid, rg, z.id, '卓' || k, 4, z.rule_set_id, z.rule_version, now() + k * interval '1 second'
        from mahjong.sessions z, generate_series(1, 4) k where z.id = ${lit(DP)}::uuid;
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot, voided, created_at)
      select gen_random_uuid(), rg, t.id, 4, jsonb_build_object('0', ${lit(M[0])}, '1', ${lit(M[1])}, '2', ${lit(M[2])}, '3', ${lit(M[3])}),
             t.rule_set_id, t.rule_version, qr.rules, false, t.created_at + j * interval '1 millisecond'
        from mahjong.tables t join mahjong.rule_sets qr on qr.id = t.rule_set_id and qr.version = t.rule_version,
             generate_series(1, ${BIG_N}) j
       where t.session_id = ${lit(DP)}::uuid and (j <= ${BIG_P} or t.id = ${lit(BIGT[3])}::uuid);
    insert into mahjong.cells (hanchan_id, seat, value) select h.id, k, (array[40000, 30000, 20000, 10000])[k + 1]
      from mahjong.hanchans h join mahjong.tables t on t.id = h.table_id, generate_series(0, 3) k where t.session_id = ${lit(DP)}::uuid;
    analyze mahjong.hanchans; analyze mahjong.cells;
    v0 := (select read_ver from mahjong.rooms where id = rg);
    ${RS} ${T('bg_z', WR('rg', [{ op: 'settle_snap', session_id: DP, rev: 1, content: { ten: {} }, used: {}, missing: [] }]))}
    ${RSR} ${PSUM('bg_all', LARGS())}
    ${RSR} ${PSUM('bg_since', LARGS(`'since', v0`))}`)}

  /* room_ns（部屋の日） */
  ${RS} ${T('nw0', WR('rg', [{ op: 'session_add', session_id: R0, date: '2026-11-19', rate: 100 },
    { op: 'table_add', table_id: TR, session_id: R0, label: '卓1' },
    { op: 'hanchan_start', hanchan_id: HR1, table_id: TR, seats: S4, cells: [40000, 30000, 20000, 10000] },
    { op: 'hanchan_start', hanchan_id: HR2, table_id: TR, seats: [M[1], M[0], M[3], M[4]], cells: [40000, 30000, 20000, 10000] }]))}
  ${RSR}
  ${T('n1', RD('rg', V3R))} ${T('n1v', RD('rg', `'{}'::jsonb`))}
  ${ROW('n1x', `select jsonb_build_object('ns', x.ns_ver, 'c', (select ver from mahjong.room_ns where room_id = rg)) from mahjong.rooms x where x.id = rg`)}
  ${RS} ${T('nw1', WR('rg', [{ op: 'cell_set', hanchan_id: HR1, seat: 1, value: 31000, $bv: cv(HR1, 1) }, { op: 'cell_set', hanchan_id: HR1, seat: 2, value: 19000, $bv: cv(HR1, 2) }]))}
  ${T('n2', RD('rg', V3R))}
  ${ROW('n2x', `select jsonb_build_object('ns', x.ns_ver, 'c', (select ver from mahjong.room_ns where room_id = rg)) from mahjong.rooms x where x.id = rg`)}
  ${RS} ${T('nw2', WR('rg', [{ op: 'hanchan_start', hanchan_id: HR3, table_id: TR, seats: [M[4], M[1], M[2], M[3]], cells: [25000, 25000, 25000, 25000] }]))}
  ${T('n3', RD('rg', V3R))} ${T('n3v', RD('rg', `'{}'::jsonb`))}
  ${ROW('n3x', `select jsonb_build_object('ns', x.ns_ver, 'rv', x.read_ver, 'c', (select ver from mahjong.room_ns where room_id = rg)) from mahjong.rooms x where x.id = rg`)}
  ${RS} ${T('nw3', WR('rg', [{ op: 'hanchan_void', hanchan_id: HR2 }]))}
  ${T('n4', RD('rg', V3R))} ${T('n4v', RD('rg', `'{}'::jsonb`))}
  ${ROW('n4x', `select jsonb_build_object('ns', x.ns_ver, 'rv', x.read_ver, 'c', (select ver from mahjong.room_ns where room_id = rg)) from mahjong.rooms x where x.id = rg`)}
  ${SOKUTEI ? undo('sk', `${asWho(1)}
    insert into mahjong.sessions (id, room_id, date, voided, rate, rule_set_id, rule_version, created_at)
      select gen_random_uuid(), rg, date '2025-01-01' + k, false, 100, x.rule_set_id, x.rule_version, now() - (${SOK_N + 10} - k) * interval '1 second'
        from generate_series(1, ${SOK_N}) k, mahjong.rooms x where x.id = rg;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, created_at)
      select gen_random_uuid(), rg, z.id, '卓1', 4, z.rule_set_id, z.rule_version, z.created_at from mahjong.sessions z where z.room_id = rg and z.league_id is null and z.id <> ${lit(R0)}::uuid;
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot, voided, created_at)
      select gen_random_uuid(), rg, t.id, 4, jsonb_build_object('0', ${lit(M[0])}, '1', ${lit(M[1])}, '2', ${lit(M[2])}, '3', ${lit(M[3])}),
             t.rule_set_id, t.rule_version, qr.rules, false, t.created_at + j * interval '1 millisecond'
        from mahjong.tables t join mahjong.sessions z on z.id = t.session_id join mahjong.rule_sets qr on qr.id = t.rule_set_id and qr.version = t.rule_version,
             generate_series(1, ${SOK_H}) j
       where t.room_id = rg and z.league_id is null and z.id <> ${lit(R0)}::uuid;
    insert into mahjong.cells (hanchan_id, seat, value) select h.id, k, (array[40000, 30000, 20000, 10000])[k + 1]
      from mahjong.hanchans h join mahjong.tables t on t.id = h.table_id join mahjong.sessions z on z.id = t.session_id, generate_series(0, 3) k
     where h.room_id = rg and z.league_id is null and z.id <> ${lit(R0)}::uuid;
    analyze mahjong.sessions; analyze mahjong.tables; analyze mahjong.hanchans; analyze mahjong.cells;
    update mahjong.rooms set ns_ver = read_ver + 1000 where id = rg;
    ${RSR}
    t0 := clock_timestamp(); ${T('sk_a', RD('rg', V3R))} ${ROW('sk_a_ms', `round(extract(epoch from clock_timestamp() - t0) * 1000, 1)`)}
    t0 := clock_timestamp(); ${T('sk_b', RD('rg', V3R))} ${ROW('sk_b_ms', `round(extract(epoch from clock_timestamp() - t0) * 1000, 1)`)}
    ${ROW('sk_cnt', `select coalesce(sum(count), 0) from mahjong.limits where kind = 'read:u1m' and key = us[1]::text`)}
    ${ROW('sk_n', `select count(*) from mahjong.hanchans where room_id = rg`)}
    ${ROW('sk_size', `octet_length((res -> 'sk_b')::text)`)}`) : ''}

  raise exception 'MJRESULT%', res::text;
end ${q('p2')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isErr = (r, err, f = {}) => !!r && r.ok === false && r.err === err && Object.entries(f).every(([k, v]) => canon(r[k]) === canon(v));
const isOk = (r) => !!r && r.ok === true;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const CAP = 524288;

/* その日の中身（開催の行・卓・半荘・extras・締め） */
function dayDigest(st, sid) {
  const tabs = (st.tables || []).filter((t) => t.session_id === sid);
  const tids = new Set(tabs.map((t) => t.table_id));
  return canon({ s: (st.sessions || []).filter((s) => s.session_id === sid), t: tabs,
    h: (st.hanchans || []).filter((h) => tids.has(h.table_id)), x: (st.extras || []).filter((e) => tids.has(e.table_id)),
    z: (st.settles || []).filter((z) => z.session_id === sid) });
}
/* st を並べ替えて比べられる形に */
function normSt(st0) {
  const st = JSON.parse(J(st0));
  delete st.loaded; delete st.absent;
  st.sessions = (st.sessions || []).slice().sort((a, b) => cmp(a.session_id, b.session_id));
  st.tables = (st.tables || []).slice().sort((a, b) => cmp(a.table_id, b.table_id));
  st.hanchans = (st.hanchans || []).slice().sort((a, b) => cmp(a.hanchan_id, b.hanchan_id));
  st.extras = (st.extras || []).slice().sort((a, b) => cmp(a.table_id, b.table_id) || cmp(a.kind, b.kind) || cmp(a.member_id, b.member_id));
  st.settles = (st.settles || []).slice().sort((a, b) => cmp(a.session_id, b.session_id) || a.rev - b.rev);
  return st;
}
/* v 無しの締めを v3 の形に（最後の rev 以外は中身を外す） */
function lastRevOnly(st0) {
  const st = JSON.parse(J(st0));
  const mx = {};
  for (const z of st.settles || []) mx[z.session_id] = Math.max(mx[z.session_id] || 0, z.rev);
  st.settles = (st.settles || []).map((z) => (z.rev === mx[z.session_id] ? z : { ...z, content: {}, used: null, missing: null }));
  return st;
}
/* 頁を継ぐ（端末の決まり §1.2・§1.4）：頁に出た日はまるごと置き換え・days に無い日は落とす */
function mergePages(base, pages) {
  const st = base ? JSON.parse(J(base)) : { v: 2, members: [], sessions: [], tables: [], hanchans: [], extras: [], settles: [] };
  const add = { sessions: [], tables: [], hanchans: [], extras: [], settles: [] };
  const touched = new Set();
  for (const p of pages) {
    for (const s of p.st.sessions) touched.add(s.session_id);
    for (const t of p.st.tables) touched.add(t.session_id);
    for (const k of Object.keys(add)) add[k].push(...p.st[k]);
    st.members = p.st.members; st.v = p.st.v;
  }
  const keep = (sid) => !touched.has(sid);
  const dropT = new Set(st.tables.filter((t) => !keep(t.session_id)).map((t) => t.table_id));
  st.sessions = st.sessions.filter((s) => keep(s.session_id)).concat(add.sessions);
  st.tables = st.tables.filter((t) => keep(t.session_id)).concat(add.tables);
  st.hanchans = st.hanchans.filter((h) => !dropT.has(h.table_id)).concat(add.hanchans);
  st.extras = st.extras.filter((e) => !dropT.has(e.table_id)).concat(add.extras);
  st.settles = st.settles.filter((z) => keep(z.session_id)).concat(add.settles);
  const days = new Set((pages.at(-1)?.days || []).map((d) => d.session_id));
  const liveT = new Set(st.tables.filter((t) => days.has(t.session_id)).map((t) => t.table_id));
  st.sessions = st.sessions.filter((s) => days.has(s.session_id));
  st.tables = st.tables.filter((t) => days.has(t.session_id));
  st.hanchans = st.hanchans.filter((h) => liveT.has(h.table_id));
  st.extras = st.extras.filter((e) => liveT.has(e.table_id));
  st.settles = st.settles.filter((z) => days.has(z.session_id));
  return st;
}
/* v 無しの部屋の st から n・last を数える（画面の memberStats と同じ：取り消していない半荘に座った数・その開催の日の最大） */
function nsFrom(st) {
  const sd = Object.fromEntries(st.sessions.map((s) => [s.session_id, s.date]));
  const td = Object.fromEntries(st.tables.map((t) => [t.table_id, sd[t.session_id]]));
  const o = {};
  for (const h of st.hanchans) {
    if (h.voided) continue;
    for (const m of h.seats) { if (!m) continue; const x = (o[m] ||= { n: 0, last: null }); x.n++; const d = td[h.table_id]; if (!x.last || d > x.last) x.last = d; }
  }
  return o;
}
const nsOf = (r) => Object.fromEntries((r?.st?.members || []).map((m) => [m.member_id, { n: m.n, last: m.last }]));
const nsSame = (v3, vl) => {
  const want = nsFrom(vl.st);
  return (v3.st.members || []).every((m) => canon({ n: m.n, last: m.last }) === canon(want[m.member_id] || { n: 0, last: null }));
};

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && 'raised' in o[k]);
  ok('塊の中の呼びが raise しない', raised.length === 0, raised.map((k) => k + '=' + J(o[k])).join(' / '));
  ok('台：部屋・入・人・リーグ', isOk(o.made) && isOk(o.j2) && isOk(o.w_m) && isOk(o.w_lc), J([o.made, o.j2, o.w_m, o.w_lc]));

  /* §3.1 門 */
  const busy = (r) => isErr(r, 'busy', { what: 'read' });
  ok('§3.1 門 今の分 80,001＝v 無しの部屋・league v3・league v 無し・部屋 v3 が全部 busy what read', busy(o.ga_room) && busy(o.ga_v3) && busy(o.ga_nov) && busy(o.ga_rv3),
    J([o.ga_room, o.ga_v3, o.ga_nov, o.ga_rv3]));
  ok('§3.1 門 他の人は読める', isOk(o.ga_other), J(o.ga_other).slice(0, 200));
  ok('§3.1 門 前の分 40,000＋今の分 40,001＝busy（前の分も見る）', busy(o.gb_room), J(o.gb_room));
  ok('§3.1 門 和がちょうど 80,000 は読める・数えが増える', isOk(o.gc_room) && Number(o.gc_n) > 80000, J([o.gc_room?.ok, o.gc_n]));
  ok('§3.1 門 2分前の 90,000 は効かない・古い窓は同じ取引で消す', isOk(o.gd_room) && Number(o.gd_old) === 0, J([o.gd_room?.ok, o.gd_old]));
  ok('§3.1 数え 読むと ms が足される（1 以上）', isOk(o.gn_r) && Number(o.gn_1) >= 1, J(o.gn_1));
  ok('§3.1 数え bad（what・after・無いリーグ）は数えない', isErr(o.gn_bad, 'bad') && isErr(o.gn_bad2, 'bad', { what: 'after' }) && isErr(o.gn_bad3, 'bad', { what: 'league_id' })
    && Number(o.gn_2) === Number(o.gn_1), J([o.gn_bad, o.gn_bad2, o.gn_bad3, o.gn_1, o.gn_2]));
  ok('§3.1 数え same も 1 以上足す', o.gn_same?.same === true && Number(o.gn_3) >= Number(o.gn_2) + 1, J([o.gn_same, o.gn_2, o.gn_3]));
  ok('§3.1 数え gone は数えない', isErr(o.gn_gone, 'gone') && Number(o.gn_u3) === 0, J([o.gn_gone, o.gn_u3]));

  /* §3.2 day_ver */
  let prevSt = null, prevDv = {};
  DSTEPS.forEach(([name], k) => {
    const w = o['dw' + k], dv = o['dv' + k] || {}, st = o['dl' + k]?.st;
    if (!isOk(w) || !st) { ok(`§3.2 日の版 ${k + 1} ${name}：書けた`, false, J(w).slice(0, 400)); prevSt = st || prevSt; prevDv = dv; return; }
    const bad = [];
    for (const sid of Object.keys(dv)) {
      const changed = !prevSt || dayDigest(prevSt, sid) !== dayDigest(st, sid);
      const bumped = dv[sid] !== prevDv[sid];
      if (changed && Number(dv[sid]) !== Number(w.read_ver)) bad.push(`${sid.slice(0, 4)} 変わったのに ${prevDv[sid]}→${dv[sid]}（版 ${w.read_ver}）`);
      if (!changed && bumped) bad.push(`${sid.slice(0, 4)} 変わらないのに ${prevDv[sid]}→${dv[sid]}`);
    }
    ok(`§3.2 日の版 ${k + 1} ${name}：中身が変わった日だけ新しい read_ver`, bad.length === 0 && Object.keys(dv).length >= 1, bad.join(' ／ ') || J(dv));
    prevSt = st; prevDv = dv;
  });
  const dv0 = o['dv' + (DSTEPS.length - 1)] || {};
  ok('§3.2 日の版 3つの日が全部 0 より上（table_rules はリーグの日に無い＝schema.sql の mj_w_op）',
    Object.keys(dv0).length === 3 && Number(dv0[DC]) > 0 && Number(dv0[DA]) > 0 && Number(dv0[DB]) > 0, J(dv0));

  /* §3.2 v3 の頁 = v 無し */
  const full = o.full || [];
  ok('§3.2 v3 全部の頁が ok・小さいので1頁', full.length === 1 && full.every(isOk) && full[0].more === false, J(full.map((p) => [p.ok, p.more, p.err])));
  const m1 = full.length && full.every((p) => isOk(p) && p.st) ? mergePages(null, full) : null;
  const want1 = o.vl1?.st ? lastRevOnly(o.vl1.st) : null;
  ok('§3.2 v3 の st（締めは最後の rev だけ中身）＝v 無しの st', m1 && want1 && canon(normSt(m1)) === canon(normSt(want1)),
    m1 && want1 ? diffShort(normSt(want1), normSt(m1)) : '');
  const days = full[0]?.days || [];
  const vdays = o.vl1?.days || [];
  ok('§3.2 days＝全部の日（session_id・day_ver・date・voided・rules・rules_alt）・rules は v 無しの days と同じ',
    days.length === 3 && days.every((d) => ['session_id', 'day_ver', 'date', 'voided', 'rules', 'rules_alt'].every((k) => k in d))
    && canon(days.map((d) => [d.session_id, d.rules, d.rules_alt])) === canon(vdays.map((d) => [d.session_id, d.rules, d.rules_alt]))
    && days.find((d) => d.session_id === DC)?.voided === true, J(days).slice(0, 600));
  const zs = (m1?.settles || []).filter((z) => z.session_id === DA);
  ok('§3.2 締めは全部の rev の行（数＝2）・中身は最後の rev だけ', zs.length === 2 && J(zs.find((z) => z.rev === 1)?.content) === '{}'
    && zs.find((z) => z.rev === 1)?.used === null && zs.find((z) => z.rev === 2)?.content?.ten?.[M[0]] === 10, J(zs));
  const g = m1 ? roomGate(m1, o.full[0]?.room?.rules) : null;
  const ap = m1 && g?.mode === 'ok' ? applyOps(m1, [{ op: 'member_add', member_id: U(), name: '継ぎ' }], { now: '2026-11-23T12:00:00Z' }) : null;
  ok('§3.2 継いだ st が roomGate ok・applyOps が通る（卓の rules が埋まっている）', g?.mode === 'ok' && ap?.ok === true, J([g, ap?.res]));
  ok('§3.2 v3 の since＝今の版は same', o.same3?.ok === true && o.same3?.same === true, J(o.same3));
  ok('§3.2 after の誤り（無い開催・その開催に無い卓・形）＝bad what after', isErr(o.bad_af1, 'bad', { what: 'after' }) && isErr(o.bad_af2, 'bad', { what: 'after' })
    && isErr(o.bad_af3, 'bad', { what: 'after' }), J([o.bad_af1, o.bad_af2, o.bad_af3]));
  const sp = o.since || [];
  const sd = new Set(sp.flatMap((p) => (p.st?.sessions || []).map((s) => s.session_id).concat((p.st?.tables || []).map((t) => t.session_id))));
  ok('§3.2 since＝動いた日（DB）だけ返す', isOk(o.sw) && sp.every(isOk) && sd.size === 1 && sd.has(DB), J([o.sw?.ok, [...sd]]));
  const m2 = m1 && sp.length && sp.every((p) => isOk(p) && p.st) ? mergePages(m1, sp) : null;
  const want2 = o.vl2?.st ? lastRevOnly(o.vl2.st) : null;
  ok('§3.2 since の頁を前の写しに継いだ st＝v 無しの st', m2 && want2 && canon(normSt(m2)) === canon(normSt(want2)), m2 && want2 ? diffShort(normSt(want2), normSt(m2)) : '');
  ok('§3.2 締めの数＋1 の rev で［対局終了し直す］が ok（conflict にならない）', isOk(o.rerev), J(o.rerev));

  /* §3.2 512KB の頁 */
  const bgp = o.bg_all || [];
  const allT = bgp.flatMap((p) => p.tables || []).filter((t) => BIGT.includes(t));
  const bigPage = bgp.find((p) => (p.tables || []).includes(BIGT[3]));
  ok('§3.2 大きい日：頁が全部 ok・最後だけ more false', bgp.length >= 2 && bgp.every((p) => p.ok === true) && bgp.slice(0, -1).every((p) => p.more === true) && bgp.at(-1).more === false,
    J(bgp.map((p) => [p.ok, p.err, p.more])));
  ok('§3.2 大きい日：どの頁も中身 512KB 以下（1卓の頁を除く）', bgp.every((p) => p.body <= CAP * 1.01 || (p.tables || []).length === 1),
    J(bgp.map((p) => [p.body, (p.tables || []).length])));
  ok('§3.2 大きい日：3000 半荘の卓は1卓だけの頁で 512KB を越える', bigPage && bigPage.tables.length === 1 && bigPage.body > CAP, J(bigPage && [bigPage.body, bigPage.tables.length]));
  ok('§3.2 大きい日：350 半荘の卓3つは1つの頁にまとまる（卓を単位に足す）', bgp.some((p) => BIGT.slice(0, 3).every((t) => (p.tables || []).includes(t))),
    J(bgp.map((p) => (p.tables || []).length)));
  ok('§3.2 大きい日：卓は全部・1回ずつ・半荘の数が合う', allT.length === 4 && new Set(allT).size === 4
    && bgp.reduce((a, p) => a + p.nh, 0) >= BIG_P * 3 + BIG_N, J([allT.length, bgp.reduce((a, p) => a + p.nh, 0)]));
  const sessP = bgp.map((p) => (p.sess || []).filter((s) => s === DP).length);
  const settP = bgp.map((p) => (p.sett || []).filter((s) => s === DP).length);
  ok('§3.2 大きい日：開催の行と締めはその日の最初の頁だけ', sessP.reduce((a, b) => a + b, 0) === 1 && settP.reduce((a, b) => a + b, 0) === 1
    && sessP[bgp.findIndex((p) => (p.tables || []).some((t) => BIGT.includes(t)))] === 1, J([sessP, settP]));
  const bgs = o.bg_since || [];
  ok('§3.2 since と after を一緒に：動いた大きい日だけを頁に分けて返す', bgs.length >= 2 && bgs.every((p) => p.ok === true)
    && bgs.every((p) => (p.sess || []).every((s) => s === DP)) && bgs.flatMap((p) => p.tables || []).length === 4, J(bgs.map((p) => [p.ok, p.err, p.sess, (p.tables || []).length])));

  /* §3.2 room_ns */
  ok('§3.2 room_ns 台が書けた', isOk(o.nw0), J(o.nw0).slice(0, 300));
  ok('§3.2 room_ns 1回目の数え＝v 無しの st から数えた n・last・控えができる', isOk(o.n1) && isOk(o.n1v) && nsSame(o.n1, o.n1v) && o.n1x?.c === o.n1x?.ns,
    J([nsOf(o.n1), o.n1x]).slice(0, 600));
  ok('§3.2 room_ns cell_set（飛びの出ない値）は ns_ver を動かさず数え直さない', isOk(o.nw1) && o.n2x?.ns === o.n1x?.ns && o.n2x?.c === o.n1x?.c && canon(nsOf(o.n2)) === canon(nsOf(o.n1)),
    J([o.n1x, o.n2x]));
  ok('§3.2 room_ns hanchan_start で ns_ver＝新しい read_ver・数え直した n・last が合う', isOk(o.nw2) && o.n3x?.ns === o.n3x?.rv && o.n3x?.c === o.n3x?.ns
    && isOk(o.n3) && nsSame(o.n3, o.n3v) && o.n3.st.members.find((m) => m.member_id === M[4])?.n === 2, J([o.n3x, nsOf(o.n3)]).slice(0, 600));
  ok('§3.2 room_ns hanchan_void でも数え直す', isOk(o.nw3) && o.n4x?.ns === o.n4x?.rv && isOk(o.n4) && nsSame(o.n4, o.n4v)
    && o.n4.st.members.find((m) => m.member_id === M[4])?.n === 1, J([o.n4x, nsOf(o.n4)]).slice(0, 600));
  if (SOKUTEI) {
    ok('§3.3 測り：3万半荘の部屋の v3 が読めた', isOk(o.sk_a) && isOk(o.sk_b), J([o.sk_a?.err, o.sk_b?.err]));
    MEASURE.sk = { hanchans: o.sk_n, ms_recount: o.sk_a_ms, ms_cached: o.sk_b_ms, bytes: o.sk_size, read_ms_sum: o.sk_cnt };
  }
  MEASURE.page = (o.bg_all || []).map((p) => ({ ms: p.ms, body: p.body, all: p.all, tables: (p.tables || []).length }));
  return L;
}
function diffShort(a, b, p = '') {
  if (canon(a) === canon(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) { const d = diffShort(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  return p + ' v無し=' + J(a)?.slice(0, 300) + ' v3=' + J(b)?.slice(0, 300);
}
const MEASURE = {};

/* ── B：別の接続を並べる（倉庫に書いて残して finally で消す） ── */
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const SIG = { 'public.mj_read': '(uuid, text, jsonb)', 'public.mj_write': '(uuid, uuid, jsonb)', 'mahjong_private.mj_r_league3': '(uuid, uuid, bigint, uuid, uuid)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;`;
};
const WZFN = 'mahjong_private.mj_read_wz';
const wzCopy = (pairs) => brk('public.mj_read', pairs).split('create or replace function public.mj_read(').join(`create or replace function ${WZFN}(`)
  .replace(/revoke all on function public\.mj_read\(uuid, text, jsonb\) from public, anon, authenticated;$/, `revoke all on function ${WZFN}(uuid, text, jsonb) from public, anon, authenticated;`);
const NS_LOCK_FROM = `perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mj_room_ns:' || p_room_id::text, 0));
        select n.cache into v_ns from mahjong.room_ns n where n.room_id = p_room_id and n.ver >= r.ns_ver;`;
const NS_LOCK_TRY = `if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('mj_room_ns:' || p_room_id::text, 0)) then
          select n.cache into v_ns from mahjong.room_ns n where n.room_id = p_room_id;
        else
          select n.cache into v_ns from mahjong.room_ns n where n.room_id = p_room_id and n.ver >= r.ns_ver;
        end if;`;
const SLOW_FROM = `  exception when query_canceled then
    v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read_slow');`;
const SLOW_NONE = `  exception when division_by_zero then
    v_out := null;`;

async function runB(mode) {   // mode: null｜'try'（待つ鍵を try に）｜'noslow'（時間切れを拾わない）
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const me = U(), ss = U(), opid = U();
  const claims = lit(J({ sub: me, session_id: ss, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 5 }] }));
  const SET = `(select set_config('request.jwt.claims', ${claims}, true)) c`;
  const fn = mode ? WZFN : 'public.mj_read';
  const rd = (args, sleep = 0) => `select r, pg_catalog.pg_sleep(${sleep}) as z from (select ${fn}('ROOM'::uuid, 'room', ${jb(args)}) as r from ${SET} offset 0) y`;
  const wr = (ops) => `${RS} select public.mj_write('ROOM'::uuid, gen_random_uuid(), ${jb(ops)}) as r from ${SET}`;
  let room = null, made = 0;
  const BM = [U(), U(), U(), U()], BS = U(), BT = U(), BH = [U(), U(), U(), U()];
  const R = (sql) => mqRows(sql.split('ROOM').join(room));
  const t0 = () => Date.now();
  const lim = async () => Number((await R(`select coalesce(sum(count), 0) as n from mahjong.limits where kind = 'read:u1m' and key = '${me}'`))[0].n);
  const NSLOCK = (sec) => `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mj_room_ns:' || 'ROOM', 0)) as a, pg_catalog.pg_sleep(${sec}) as z`;
  try {
    if (mode === 'try') await mqRows(wzCopy([[NS_LOCK_FROM, NS_LOCK_TRY]]));
    if (mode === 'noslow') await mqRows(wzCopy([[SLOW_FROM, SLOW_NONE]]));
    await mqRows(`insert into auth.users (id, email, aud, role, is_anonymous) values ('${me}', '${me}@${MAIL}', 'authenticated', 'authenticated', false);
      insert into auth.sessions (id, user_id) values ('${ss}', '${me}');`);
    const rr = await mqRows(`select public.mj_room_create('${opid}'::uuid, ${lit(NB + 'b')}, ${lit(PASS)}, ${jb(FR)},
      jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text))) as r from ${SET}`);
    room = rr[0]?.r?.room_id;
    if (!room) throw new Error('部屋を作れない: ' + J(rr).slice(0, 300));
    made = 1;
    const w0 = await R(wr([...BM.map((id, i) => ({ op: 'member_add', member_id: id, name: 'B' + i })),
      { op: 'session_add', session_id: BS, date: '2026-11-23', rate: 100 }, { op: 'table_add', table_id: BT, session_id: BS, label: '卓1' },
      { op: 'hanchan_start', hanchan_id: BH[0], table_id: BT, seats: BM, cells: [40000, 30000, 20000, 10000] }]));
    if (w0[0]?.r?.ok !== true) throw new Error('台が書けない ' + J(w0).slice(0, 300));
    await R(`delete from mahjong.limits where kind = 'read:u1m' and key = '${me}'`);

    if (!mode) {
      /* §3.1 read_one：4本が席を持って3秒寝る間に5本目 */
      const s = t0();
      const holders = [0, 1, 2, 3].map(() => R(rd({}, 3)));
      await new Promise((res) => setTimeout(res, 800));
      const s5 = t0();
      const fifth = await R(rd({}));
      const t5 = t0() - s5;
      const hs = await Promise.all(holders);
      const tH = t0() - s;
      ok(`§3.1 5本目の同時の読み＝busy what read_one・すぐ返る（${t5}ms）`, isErr(fifth[0]?.r, 'busy', { what: 'read_one' }) && t5 < 2000, J(fifth[0]?.r));
      ok(`§3.1 4本は読めた（${tH}ms）`, hs.every((x) => x[0]?.r?.ok === true), J(hs.map((x) => x[0]?.r?.err || x[0]?.r?.ok)));
      const after = await R(rd({}));
      ok('§3.1 4本が終われば読める', after[0]?.r?.ok === true, J(after[0]?.r).slice(0, 200));
    }

    if (mode !== 'noslow') {
      /* §3.2 待つ鍵：控えを作る → hanchan_start → 他の接続が鍵を持つ間に4本読む */
      const a0 = await R(rd({ v: 3 }));
      const w1 = await R(wr([{ op: 'hanchan_start', hanchan_id: BH[1], table_id: BT, seats: BM, cells: [40000, 30000, 20000, 10000] }]));
      const s = t0();
      const hold = R(NSLOCK(3));
      await new Promise((res) => setTimeout(res, 500));
      const reads = await Promise.all([0, 1, 2, 3].map(() => R(rd({ v: 3 })).then((x) => [x, t0() - s])));
      await hold;
      const ns = reads.map(([x]) => x[0]?.r?.st?.members?.find((m) => m.member_id === BM[0])?.n);
      ok(`§3.2 鍵を持つ間の4本の読みは待って（${reads.map(([, t]) => t).join('・')}ms）全部が新しい n（${J(ns)}）`,
        a0[0]?.r?.st?.members?.find((m) => m.member_id === BM[0])?.n === 1 && w1[0]?.r?.ok === true
        && reads.every(([x, t]) => x[0]?.r?.ok === true && t >= 2300) && ns.every((n) => n === 2), J(reads.map(([x]) => x[0]?.r?.err)));
    }

    if (mode !== 'try') {
      /* §3.1 時間切れ：鍵を持たせて statement_timeout 800ms */
      const w2 = await R(wr([{ op: 'hanchan_start', hanchan_id: BH[2], table_id: BT, seats: BM, cells: [40000, 30000, 20000, 10000] }]));
      const c0 = await lim();
      const hold = R(NSLOCK(3));
      await new Promise((res) => setTimeout(res, 500));
      let slow = null, serr = null;
      try { slow = await R(`set local statement_timeout = '800ms'; ${rd({ v: 3 })}`); } catch (e) { serr = String(e.message).slice(0, 300); }
      await hold;
      const c1 = await lim();
      ok(`§3.1 時間切れ＝busy what read_slow・経った ms が数えに残る（${c0}→${c1}）`, w2[0]?.r?.ok === true && isErr(slow?.[0]?.r, 'busy', { what: 'read_slow' }) && c1 - c0 >= 700,
        serr || J(slow?.[0]?.r));
    }
  } catch (e) {
    ok('B が回った', false, String(e.message || e).slice(0, 500));
  } finally {
    try {
      await mqRows(`delete from mahjong.rooms where id = ${room ? `'${room}'` : 'null'};
        delete from mahjong.creates where op_id = '${opid}';
        delete from auth.users where email like '%@${MAIL}';
        delete from mahjong.limits where kind like 'write:%' or key in ('${me}'${room ? `, '${room}'` : ''});
        update mahjong.totals set rooms_all = greatest(rooms_all - ${made}, 0) where id = 1;
        drop function if exists ${WZFN}(uuid, text, jsonb);`);
    } catch (e) { ok('片付けが落ちた', false, String(e.message).slice(0, 300)); }
  }
  return L;
}

/* ── --waza（A＝塊の頭で当てる） ── */
const WZ = [
  ['W1 門の天井を外す', () => brk('public.mj_read', [['l.window_start >= v_min - interval \'1 minute\') > 80000 then', 'l.window_start >= v_min - interval \'1 minute\') > 80000000 then']]), ['§3.1 門 今の分']],
  ['W2 門が今の分だけを見る', () => brk('public.mj_read', [["l.window_start >= v_min - interval '1 minute') > 80000", 'l.window_start >= v_min) > 80000']]), ['§3.1 門 前の分']],
  ['W3 数えを足さない', () => brk('public.mj_read', [['  if v_cnt then', '  if false then']]), ['§3.1 数え 読むと']],
  ['W4 gone も数える', () => brk('public.mj_read', [["v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); v_cnt := false; exit body; end if;\n    if r.owner_user_id", "v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); exit body; end if;\n    if r.owner_user_id"],
    ["if v_role is null then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); v_cnt := false; exit body; end if;", "if v_role is null then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); exit body; end if;"]]), ['§3.1 数え gone']],
  ['W5 day_ver が extras を見ない', () => brk('public.mj_write', [["when 'extras'       then (select t.session_id from mahjong.tables t where t.id = (h.row_key ->> 'table_id')::uuid)\n", '']]), [' extra_add：', ' extra_set：']],
  ['W6 day_ver が cells を見ない', () => brk('public.mj_write', [["'hanchans', 'cells'));", "'hanchans'));"]]), [' cell_set 2つ：']],
  ['W7 day_ver が締めを見ない', () => brk('public.mj_write', [["h.tbl in ('sessions', 'settle_snaps',", "h.tbl in ('sessions',"]]), [' 締め rev1：', ' 締め rev2：']],
  ['W8 v3 の卓の rules を抜く', () => brk('mahjong_private.mj_r_league3', [["'rules', (select q.rules from mahjong.rule_sets q where q.id = t.rule_set_id and q.version = t.rule_version), 'seats', t.seats)", "'seats', t.seats)"]]),
    ['§3.2 継いだ st が roomGate']],
  ['W9 締めを最後の rev だけにする', () => brk('mahjong_private.mj_r_league3', [['       where z.session_id = d.id;\n', '       where z.session_id = d.id and z.rev = m.mx;\n']]), ['§3.2 締めは全部の rev', '§3.2 締めの数＋1']],
  ['W10 天井を10倍に', () => brk('mahjong_private.mj_r_league3', [['c_cap constant int := 524288;', 'c_cap constant int := 5242880;']]), ['§3.2 大きい日：どの頁も', '§3.2 大きい日：頁が全部']],
  ['W11 since を見ない', () => brk('mahjong_private.mj_r_league3', [['and (p_since is null or x.day_ver > p_since)', '']]), ['§3.2 since＝動いた日']],
  ['W12 続きの日に開催の行をまた載せる', () => brk('mahjong_private.mj_r_league3', [['    v_head := not v_cont;', '    v_head := true;']]), ['§3.2 大きい日：開催の行と締め']],
  ['W13 ns_ver を動かさない', () => brk('public.mj_write', [['then x.read_ver + 1 else x.ns_ver end', 'then x.ns_ver else x.ns_ver end']]), ['§3.2 room_ns hanchan_start', '§3.2 room_ns hanchan_void']],
  ['W14 ns_ver をいつも動かす', () => brk('public.mj_write', [["h.tbl in ('hanchans', 'sessions', 'tables'))\n", "h.tbl is not null)\n"]]), ['§3.2 room_ns cell_set']],
  ['W15 控えの版を見ない（いつも控えを使う）', () => brk('public.mj_read', [['where n.room_id = p_room_id and n.ver >= r.ns_ver;\n      if not found then', 'where n.room_id = p_room_id;\n      if not found then']]), ['§3.2 room_ns hanchan_start', '§3.2 room_ns hanchan_void']],
];
const WZB = [
  ['WB1 待つ鍵を try にして古い控えを返す', 'try', ['§3.2 鍵を持つ間']],
  ['WB2 時間切れを拾わない', 'noslow', ['§3.1 時間切れ', 'B が回った']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'mahjong_private' and p.proname = 'mj_read_wz') as f`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋・写しの関数が残っていない', j && j.u === 0 && j.r === 0 && j.f === 0, text.slice(0, 200));
};

if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  if (!B_SKIP) for (const [n, c, info] of await runB(null)) say(n, c, info);
  await leftCheck();
  console.log('  測り：' + J(MEASURE));
  console.log(`\np2-read: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  const base = await runA('');
  const b0 = base.err ? null : check(base.out);
  const bB = B_SKIP ? [] : await runB(null);
  if (!b0 || b0.some(([, c]) => !c) || bB.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base.err || [...(b0 || []), ...bB].filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    process.exitCode = 1;
  } else {
    console.log(`  素の回り：A ${b0.length}・B ${bB.length} passed, 0 failed（緑）`);
    let red = 0;
    const all = WZ.length + (B_SKIP ? 0 : WZB.length);
    for (const [name, mk, wants] of WZ) {
      let pre = null; try { pre = mk(); } catch (e) { console.log(`  ✗ ${name} → ${e.message}`); continue; }
      const r = await runA(pre);
      const L = r.err ? null : check(r.out);
      const hit = L && L.filter(([n, c]) => !c && wants.some((w) => n.startsWith(w) || n.includes(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${r.err ? '塊が落ちた ' + r.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([n]) => n).join(' ／ ') : '狙いが赤にならない'}`);
    }
    if (!B_SKIP) for (const [name, mode, wants] of WZB) {
      const L = await runB(mode);
      const hit = L.filter(([n, c]) => !c && wants.some((w) => n.startsWith(w)));
      if (hit.length) red++;
      console.log(`  ${hit.length ? '✓' : '✗'} ${name} → ${hit.length ? '赤：' + hit.map(([n]) => n).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\np2-read --waza: ${red}/${all} 狙いが赤になった`);
    process.exitCode = red === all && fail === 0 ? 0 : 1;
  }
}
