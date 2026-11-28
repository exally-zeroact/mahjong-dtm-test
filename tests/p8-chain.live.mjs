/* p8-chain.live.mjs — ★P8 卓の鎖を段の数で切らない（chain_head・chain_no・mj_w_chain・mj_w_tfollow v4）を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め mahjong_tataki_2026-11-20/p8_sadame.md v4 §3：
 *   塊の試し（1つの取引で積んで戻す）＝鎖 1,005 段を mj_write の table_rules で積み、
 *     ・mj_w_chain の長さ 1,005 と順・真ん中／最後から引いても同じ・別の鎖を拾わない・無い卓＝[p_tid]
 *     ・頭から follow の extra_add（M4＝頭の卓の h1 だけに座った人＝正味の門が鎖の全部を見る）と hanchan_start が最後の卓へ
 *     ・follow 無しの extra_add・hanchan_start（頭・真ん中）＝bad at table_id
 *     ・頭の区切りだけ鍵違い＝頭から extra_add は bad／2段目からは ok（始めより前の鍵違いは見ない）
 *     ・真ん中の区切りが鍵違い＝頭から extra_add は bad／その先からは ok／hanchan_start は ok
 *     ・埋めの文の冪等（chain_* を消して埋めを2回＝1回目で元に戻り、2回目は 0 行）
 *   並ぶ事の確かめ（league-lock の形＝2本の接続・書いて残して finally で消す）＝
 *     A が最後の卓を table_rules で区切って寝ている間に、B が頭から follow の extra_add → B は A を待ち、新しい最後に着く／A が鍵違いなら B は bad。
 *     （mj_write は部屋の行を for no key update で押さえる＝同じ部屋の書きは1列＝定め §3 の「同時の区切りの窓」は起きない。
 *      b の繰り返しは守りとして残す・ここは並ぶ事だけを数える）
 * --waza：倉庫の関数をわざと壊して、狙った確かめが赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る・並ぶ試しは壊さない）
 * 使い方: node tests/p8-chain.live.mjs [--waza] [--race-skip]
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
const RACE_SKIP = process.argv.includes('--race-skip');

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
const J = (x) => String(JSON.stringify(x));
const jb = (x) => `${lit(J(x))}::jsonb`;
const U = () => crypto.randomUUID();
const MAIL = 'mj-p8.invalid';
const NB = 'p8' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const N = Number(process.env.P8_N || 1005);   // 鎖の段の数（卓の数）＝1000 を越える
const MID = Math.floor(N / 2), LATE = Math.floor(N * 0.7);   // 真ん中・後ろの方の段（ids の 1 始まりの番）
const EP = `floor(extract(epoch from now()))`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;

const full = (r) => { const x = rulesOk(r); if (!x.ok) throw new Error('ルールが読めない ' + J(x)); return x.rules; };
const R1 = full({ players: 4, rate: 100, chip_pt10: 20, shugi_pt10: 10, uma: [30, 10, -10, -30], hakoshita: false });
const R2 = full({ ...R1, uma: [40, 20, -20, -40] });            // 鍵同じ（ウマだけ）
const C1 = full({ ...R1, chip_pt10: 10 });                       // 鍵違い（チップ単価）
const C2 = full({ ...R2, chip_pt10: 10 });
const M = [U(), U(), U(), U(), U(), U()];                        // M[4]＝頭の卓の h1 だけに座った代打ち・M[5]＝どこにも座らない人
const S1 = U(), T0 = U(), TX = U(), TX2 = U(), H1 = U();
const SEAT4 = M.slice(0, 4);
const BASE_OPS = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '甲乙丙丁戊己'[i] })),
  { op: 'session_add', session_id: S1, date: '2026-11-22', rate: 100 },
  { op: 'table_add', table_id: T0, session_id: S1, label: '卓1' },
  { op: 'table_seats', table_id: T0, seats: SEAT4 },
  { op: 'hanchan_start', hanchan_id: H1, table_id: T0, seats: [M[4], M[1], M[2], M[3]], cells: [40000, 30000, 20000, 10000] },
  { op: 'extra_add', table_id: T0, member_id: M[4], kind: 'chip', add: 3 },
  { op: 'extra_add', table_id: T0, member_id: M[1], kind: 'chip', add: -3 },
  { op: 'table_add', table_id: TX, session_id: S1, label: '卓2' },   // 別の鎖（1段だけ区切る）
  { op: 'table_seats', table_id: TX, seats: SEAT4 },
];

/* 塊の中の言葉（plpgsql） */
const asWho = `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[1], 'session_id', ss[1], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const W = (key, opsExpr) => `${RS} t0 := clock_timestamp(); ${T(key, `public.mj_write(ra, gen_random_uuid(), ${opsExpr})`)}
    res := res || jsonb_build_object('${key}_ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1));`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
/* 鎖を積む：頭 T0 から N-1 回 table_rules（ids に頭から順に入る）。k 段目（1 から）の区切りが k >= kd なら鍵違いの組（C1/C2）・他は R1/R2（ウマを交互） */
const build = (key, kd) => `
    ids := array[${lit(T0)}::uuid]; t0 := clock_timestamp();
    for k in 1..${N - 1} loop
      nid := gen_random_uuid();
      ${RS}
      r := public.mj_write(ra, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'table_rules', 'table_id', ids[k], 'new_table_id', nid,
             'rules', case when k >= ${kd} then (case when k % 2 = 1 then ${jb(C2)} else ${jb(C1)} end) else (case when k % 2 = 1 then ${jb(R2)} else ${jb(R1)} end) end)));
      if r ->> 'ok' is distinct from 'true' then res := res || jsonb_build_object('${key}_build', jsonb_build_object('k', k, 'r', r)); exit; end if;
      ids := ids || nid;
    end loop;
    res := res || jsonb_build_object('${key}_n', cardinality(ids), '${key}_build_ms', round(extract(epoch from clock_timestamp() - t0) * 1000));`;
const ea = (tidExpr, m, add, follow) => `jsonb_build_array(jsonb_build_object('op', 'extra_add', 'table_id', ${tidExpr}, 'member_id', ${lit(M[m])}::uuid, 'kind', 'chip', 'add', ${add}${follow ? `, 'follow', true` : ''}))`;
const ea2 = (tidExpr, follow) => `(${ea(tidExpr, 4, 1, follow)} || ${ea(tidExpr, 0, -1, follow)})`;
const hs = (key, tidExpr, follow) => `hid := gen_random_uuid(); ${W(key, `jsonb_build_array(jsonb_build_object('op', 'hanchan_start', 'hanchan_id', hid, 'table_id', ${tidExpr}, 'seats', ${jb(SEAT4)}, 'cells', ${jb([10000, 20000, 30000, 40000])}${follow ? `, 'follow', true` : ''}))`)}
    res := res || jsonb_build_object('${key}_at', (select h.table_id = ids[cardinality(ids)] from mahjong.hanchans h where h.id = hid));`;

/* 埋めの文（schema.sql の当て直しの文をそのまま） */
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const FILL = (() => {
  const a = SCHEMA.indexOf('with recursive c(id, head, no) as (');
  const e = 't.chain_no <> c.no);';
  const b = SCHEMA.indexOf(e, a);
  if (a < 0 || b < 0) throw new Error('schema.sql に埋めの文が無い');
  return SCHEMA.slice(a, b + e.length - 1);   // 終わりの ; は外す（execute に渡す）
})();

const mkSql = (prefix = '', only = 'A') => `do ${q('p8')} declare res jsonb := '{}'; r jsonb; k int; ra uuid; nid uuid; hid uuid; ids uuid[]; t0 timestamptz; n1 int; n2 int;
  us uuid[] := array[gen_random_uuid()]; ss uuid[] := array[gen_random_uuid()];
begin
  ${prefix}
  delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
  insert into auth.users (id, email, aud, role, is_anonymous) values (us[1], us[1]::text || '@${MAIL}', 'authenticated', 'authenticated', false); insert into mahjong.accounts (user_id, human_at) values (us[1], now()) on conflict (user_id) do update set human_at = now(); -- P10 印
  insert into auth.sessions (id, user_id) values (ss[1], us[1]);
  ${asWho}
  ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R1)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
  ra := (r->>'room_id')::uuid;
  ${BASE_OPS.map((o, k) => `${RS} ${T('base' + k, `public.mj_write(ra, gen_random_uuid(), ${jb([o])})`)}`).join('\n  ')}
  ${W('one', ea2(lit(TX) + '::uuid', false))}
  ${RS} ${T('xsplit', `public.mj_write(ra, gen_random_uuid(), ${jb([{ op: 'table_rules', table_id: TX, new_table_id: TX2, rules: R2 }])})`)}

  -- A：鍵同じの鎖 ${N} 段
  ${only !== 'A' ? '' : undo('A', `${build('A', N + 10)}
    nid := gen_random_uuid();
    res := res || jsonb_build_object('A_chain', (mahjong_private.mj_w_chain(ids[1]) = ids),
      'A_chain_n', cardinality(mahjong_private.mj_w_chain(ids[1])),
      'A_chain_mid', (mahjong_private.mj_w_chain(ids[${MID}]) = ids), 'A_chain_last', (mahjong_private.mj_w_chain(ids[${N}]) = ids),
      'A_chain_x', (select cardinality(c) = 2 and c[1] = ${lit(TX)}::uuid and not (c && ids) from (select mahjong_private.mj_w_chain(${lit(TX)}::uuid) c) z),
      'A_chain_none', (select c = array[nid] from (select mahjong_private.mj_w_chain(nid) c) z),
      'A_nos', (select bool_and(t.chain_no = o.n - 1 and (t.chain_head is not distinct from (case when o.n = 1 then null else ids[1] end))) from unnest(ids) with ordinality o(id, n) join mahjong.tables t on t.id = o.id));
    ${W('A_x_ea', ea2(lit(TX2) + '::uuid', false))}
    ${W('A_nf_ea_head', ea2('ids[1]', false))}
    ${W('A_nf_ea_mid', ea2(`ids[${MID}]`, false))}
    ${hs('A_nf_hs_head', 'ids[1]', false)}
    ${W('A_f_ea_head', ea2('ids[1]', true))}
    res := res || jsonb_build_object('A_f_ea_at', (select coalesce(bool_and(e.table_id = ids[${N}]), false) from mahjong.extras e where e.member_id = ${lit(M[4])}::uuid and e.table_id = any(ids)),
      'A_f_ea_v', (select e.value from mahjong.extras e where e.member_id = ${lit(M[4])}::uuid and e.table_id = ids[${N}]));
    ${W('A_f_ea_m5', `jsonb_build_array(jsonb_build_object('op', 'extra_add', 'table_id', ids[1], 'member_id', ${lit(M[5])}::uuid, 'kind', 'chip', 'add', 1, 'follow', true))`)}
    ${hs('A_f_hs_head', 'ids[1]', true)}
    ${hs('A_f_hs_mid', `ids[${LATE}]`, true)}
    t0 := clock_timestamp(); perform mahjong_private.mj_w_chain(ids[1]);
    res := res || jsonb_build_object('A_chain_ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 2));
    -- 埋めの冪等：この部屋の印を消して埋めを2回
    update mahjong.tables x set chain_head = null, chain_no = 0 where x.room_id = ra;
    execute ${lit(FILL)}; get diagnostics n1 = row_count;
    execute ${lit(FILL)}; get diagnostics n2 = row_count;
    res := res || jsonb_build_object('A_fill1', n1, 'A_fill2', n2, 'A_fill_chain', (mahjong_private.mj_w_chain(ids[1]) = ids),
      'A_fill_x', (select cardinality(mahjong_private.mj_w_chain(${lit(TX)}::uuid)) = 2));`)}

  -- B：頭の区切りだけ鍵違い
  ${only !== 'B' ? '' : undo('B', `${build('B', 1)}
    ${W('B_ea_head', ea2('ids[1]', true))}
    ${W('B_ea_2nd', ea2('ids[2]', true))}
    res := res || jsonb_build_object('B_ea_2nd_at', (select coalesce(bool_and(e.table_id = ids[${N}]), false) from mahjong.extras e where e.member_id = ${lit(M[0])}::uuid and e.table_id = any(ids)));
    ${hs('B_hs_head', 'ids[1]', true)}`)}

  -- C：真ん中（${MID} 段目）の区切りが鍵違い
  ${only !== 'C' ? '' : undo('C', `${build('C', MID)}
    ${W('C_ea_head', ea2('ids[1]', true))}
    ${W('C_ea_499', ea2(`ids[${MID}]`, true))}
    ${W('C_ea_501', ea2(`ids[${MID + 1}]`, true))}
    ${hs('C_hs_head', 'ids[1]', true)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('p8')};`;

/* 場面 A・B・C は別の文（1つの文は倉庫の statement_timeout 120 秒まで＝1,005 段を3つ積むと越える）。順に回す（limits の消しが鍵で並ぶ） */
async function runOne(prefix, only) {
  const { text } = await mq(mkSql(prefix, only));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: only + ': ' + msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: only + ': 結果が読めない ' + e.message }; }
}
async function runA(prefix, scenes = ['A', 'B', 'C']) {
  const out = {};
  for (const s of scenes) {
    const r = await runOne(prefix, s);
    if (r.err) return r;
    Object.assign(out, r.out);
  }
  return { out };
}

const fmt = (r) => (!r ? '無し' : r.raised ? 'raised ' + r.raised : r.ok === true ? 'ok' : r.err === 'conflict' ? 'conflict' : r.err + '@' + (typeof r.at === 'object' ? J(r.at) : r.at));
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  ok('部屋を作れた', o.made && o.made.ok === true, J(o.made).slice(0, 200));
  BASE_OPS.forEach((x, k) => ok('台が倉庫に当たった：' + x.op + ' ' + k, o['base' + k] && o['base' + k].ok === true, J(o['base' + k]).slice(0, 200)));
  ok('台：別の卓の1段の区切り', o.xsplit && o.xsplit.ok === true, J(o.xsplit).slice(0, 200));
  for (const s of ['A', 'B', 'C']) ok(`${s} 鎖を ${N} 段積めた（mj_write の table_rules）`, o[s + '_n'] === N && !o[s + '_build'], J(o[s + '_build'] || o[s + '_n']).slice(0, 300));
  const w = (n, k, want) => ok(`${n}：倉庫 ${fmt(o[k])}＝期待 ${want}`, fmt(o[k]) === want, J(o[k]).slice(0, 300));
  ok('A mj_w_chain(頭) の長さ ' + N + '・順が積んだ順と同じ', o.A_chain === true && o.A_chain_n === N, J([o.A_chain, o.A_chain_n]));
  ok('A mj_w_chain を 500 段目・最後から引いても同じ', o.A_chain_mid === true && o.A_chain_last === true, J([o.A_chain_mid, o.A_chain_last]));
  ok('A mj_w_chain は別の鎖（卓2）を拾わない・卓2 の鎖は2段', o.A_chain_x === true, J(o.A_chain_x));
  ok('A 無い卓の mj_w_chain＝[p_tid]', o.A_chain_none === true, J(o.A_chain_none));
  ok('A 卓の印（頭 null・0／続き 頭の id・段）が積んだ順と同じ', o.A_nos === true, J(o.A_nos));
  w('A follow 無しの extra_add（頭）', 'A_nf_ea_head', 'bad@table_id');
  w('A follow 無しの extra_add（500 段目）', 'A_nf_ea_mid', 'bad@table_id');
  w('A follow 無しの hanchan_start（頭）', 'A_nf_hs_head', 'bad@table_id');
  w('A 頭から follow の extra_add（M4＝頭の h1 だけ）', 'A_f_ea_head', 'ok');
  ok('A M4 の枚は最後の卓だけに在り値 4（3 移り＋1）', o.A_f_ea_at === true && o.A_f_ea_v === 4, J([o.A_f_ea_at, o.A_f_ea_v]));
  w('A 頭から follow の extra_add（どこにも座らない M5）', 'A_f_ea_m5', 'bad@member_id');
  w('A 頭から follow の hanchan_start', 'A_f_hs_head', 'ok');
  ok('A 頭からの hanchan_start は最後の卓', o.A_f_hs_head_at === true, J(o.A_f_hs_head_at));
  w('A 700 段目から follow の hanchan_start', 'A_f_hs_mid', 'ok');
  ok('A 700 段目からの hanchan_start は最後の卓', o.A_f_hs_mid_at === true, J(o.A_f_hs_mid_at));
  ok(`A 埋め 1回目で印が戻る（${o.A_fill1} 行）・2回目は 0 行`, o.A_fill1 >= N && o.A_fill2 === 0 && o.A_fill_chain === true && o.A_fill_x === true, J([o.A_fill1, o.A_fill2, o.A_fill_chain, o.A_fill_x]));
  w('B 頭の区切りだけ鍵違い：頭から extra_add', 'B_ea_head', 'bad@table_id');
  w('B 頭の区切りだけ鍵違い：2段目から extra_add（始めより前は見ない）', 'B_ea_2nd', 'ok');
  ok('B 2段目からの extra_add は最後の卓へ', o.B_ea_2nd_at === true, J(o.B_ea_2nd_at));
  w('B 頭から hanchan_start は鍵違いでも ok', 'B_hs_head', 'ok');
  w('C 500 段目の区切りが鍵違い：頭から extra_add', 'C_ea_head', 'bad@table_id');
  w('C 500 段目の区切りが鍵違い：500 段目（区切った卓）から extra_add', 'C_ea_499', 'bad@table_id');
  w('C 500 段目の区切りが鍵違い：その先（501）から extra_add', 'C_ea_501', 'ok');
  w('C 頭から hanchan_start は鍵違いでも ok', 'C_hs_head', 'ok');
  return L;
}

/* ── 並ぶ事の確かめ（2本の接続・倉庫に書いて残して finally で消す） ── */
async function race(label, keyDiff) {
  const me = U(), ss = U(), opid = U();
  const claims = lit(J({ sub: me, session_id: ss, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 5 }] }));
  const call = (room, ops, sleep) => `select r, pg_catalog.pg_sleep(${sleep}) as z from (
  select public.mj_write('${room}'::uuid, gen_random_uuid(), ${jb(ops)}) as r from (select set_config('request.jwt.claims', ${claims}, true)) c offset 0) y`;
  let room = null, made = 0, res = null;
  const ids = [T0, U(), U()], L1 = U();
  try {
    await mqRows(`insert into auth.users (id, email, aud, role, is_anonymous) values ('${me}', '${me}@${MAIL}', 'authenticated', 'authenticated', false); insert into mahjong.accounts (user_id, human_at) values ('${me}', now()) on conflict (user_id) do update set human_at = now(); -- P10 印
      insert into auth.sessions (id, user_id) values ('${ss}', '${me}');`);
    const rr = await mqRows(`select public.mj_room_create('${opid}'::uuid, ${lit(NB + 'r')}, ${lit(PASS)}, ${jb(R1)},
      jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text))) as r from (select set_config('request.jwt.claims', ${claims}, true)) c`);
    room = rr[0]?.r?.room_id;
    if (!room) throw new Error('部屋を作れない: ' + J(rr).slice(0, 300));
    made = 1;
    const pre = [...BASE_OPS.slice(0, 12),
      { op: 'table_rules', table_id: ids[0], new_table_id: ids[1], rules: R2 },
      { op: 'table_rules', table_id: ids[1], new_table_id: ids[2], rules: R1 }];
    for (const o of pre) {
      const x = await mqRows(`${RS} ${call(room, [o], 0)}`);
      if (x[0]?.r?.ok !== true) throw new Error('台が当たらない ' + o.op + ' ' + J(x).slice(0, 300));
    }
    /* A：最後の卓 ids[2] を区切って 3 秒寝る／B：0.5 秒後に頭から follow の extra_add（S＝頭 ≠ L0） */
    const t0 = Date.now(), tm = (p) => p.then((v) => [v, Date.now() - t0]);
    const pA = tm(mqRows(`${RS} ${call(room, [{ op: 'table_rules', table_id: ids[2], new_table_id: L1, rules: keyDiff ? C2 : R2 }], 3)}`));
    await new Promise((r) => setTimeout(r, 500));
    const pB = tm(mqRows(call(room, [{ op: 'extra_add', table_id: ids[0], member_id: M[4], kind: 'chip', add: 1, follow: true },
      { op: 'extra_add', table_id: ids[0], member_id: M[0], kind: 'chip', add: -1, follow: true }], 0)));
    const [[a, ta], [b, tb]] = await Promise.all([pA, pB]);
    const ra = a[0]?.r, rb = b[0]?.r;
    const at = (await mqRows(`select coalesce(array_agg(distinct e.table_id::text), '{}') as t from mahjong.extras e where e.member_id = '${M[0]}' and e.table_id in ('${ids.join("','")}', '${L1}')`))[0].t;
    console.log(`  （${label}：A ${ta}ms・B ${tb}ms で返った・M0 の枚の卓 ${J(at)}）`);
    const waited = tb >= 2500;
    const good = ra?.ok === true && waited && (keyDiff ? (rb?.ok === false && rb.err === 'bad' && rb.at === 'table_id' && at.length === 0)
      : (rb?.ok === true && at.length === 1 && at[0] === L1));
    res = { good, info: J({ a: ra, b: rb, tb, at }) };
  } catch (e) {
    res = { good: false, info: '回らなかった — ' + String(e.message || e).slice(0, 500) };
  } finally {
    try {
      await mqRows(`delete from mahjong.rooms where id = ${room ? `'${room}'` : 'null'};
        delete from mahjong.creates where op_id = '${opid}';
        delete from auth.users where email like '%@${MAIL}';
        delete from mahjong.limits where kind like 'write:%' or key in ('${me}'${room ? `, '${room}'` : ''});
        update mahjong.totals set rooms_all = greatest(rooms_all - ${made}, 0) where id = 1;`);
    } catch (e) { console.log('  ✗ 片付けが落ちた — ' + String(e.message).slice(0, 300)); fail++; }
  }
  return res;
}

/* ── --waza（壊す関数は schema.sql から取り、字を置き換えて塊の頭で当てる） ── */
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'mahjong_private.mj_w_tfollow': '(uuid, uuid, int, text, uuid, text, jsonb)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;`;
};
const TF = 'mahjong_private.mj_w_tfollow', OP = 'mahjong_private.mj_w_op';
const INS = 'coalesce(t.chain_head, t.id), t.chain_no + 1);   -- P8：鎖の印';
const WZ = [
  ['P1 鍵違いの見方から id = H を外す（頭の行が抜ける）', () => brk(TF, [["exists (select 1 from mahjong.tables x where (x.id = v_h or x.chain_head = v_h)", 'exists (select 1 from mahjong.tables x where (x.chain_head = v_h)']]),
    ['B 頭の区切りだけ鍵違い：頭から extra_add：'], ['B']],
  ['P2 鍵違いの見方から chain_no >= S を外す（始めより前も見る）', () => brk(TF, [['and x.chain_no >= s.chain_no and x.chain_no < t.chain_no', 'and x.chain_no < t.chain_no']]),
    ['B 頭の区切りだけ鍵違い：2段目から extra_add（始めより前は見ない）：'], ['B']],
  ['P3 続きの卓に chain_head を書かない', () => brk(OP, [[INS, 'null, t.chain_no + 1);']]),
    ['A mj_w_chain(頭) の長さ', 'A 頭からの hanchan_start は最後の卓'], ['A']],
  ['P4 続きの卓に chain_no を書かない', () => brk(OP, [[INS, 'coalesce(t.chain_head, t.id), 0);']]),
    ['A mj_w_chain(頭) の長さ', 'A 頭から follow の extra_add（M4'], ['A']],
  ['P5 区切られた卓で follow 無しを止める行（1902）を外す', () => brk(TF, [["if (p_o -> 'follow') is distinct from 'true'::jsonb then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;", 'null;']]),
    ['A follow 無しの extra_add（500 段目）', 'A follow 無しの hanchan_start（頭）'], ['A']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋が残っていない', j && j.u === 0 && j.r === 0, text.slice(0, 200));
};
const msLine = (o) => `  （ms：1段の卓の extra_add ${o.one_ms}・鎖の外の卓 ${o.A_x_ea_ms}・1,005 段の頭から extra_add ${o.A_f_ea_head_ms}・hanchan_start ${o.A_f_hs_head_ms}・mj_w_chain ${o.A_chain_ms}・積み A ${o.A_build_ms}／B ${o.B_build_ms}／C ${o.C_build_ms}）`;

if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else { for (const [n, c, info] of check(a.out)) say(n, c, info); console.log(msLine(a.out)); }
  if (!RACE_SKIP) {
    const r1 = await race('鍵同じ', false);
    say('並ぶ：A が最後を区切って寝る間の B（頭から follow の extra_add）は A を待ち、新しい最後の卓に着く', r1.good, r1.info);
    const r2 = await race('鍵違い', true);
    say('並ぶ：A の区切りが鍵違いなら、待った B は bad at table_id（枚はどこにも入らない）', r2.good, r2.info);
  }
  await leftCheck();
  console.log(`\np8-chain: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  const base = await runA('');
  const b0 = base.err ? null : check(base.out);
  if (!b0 || b0.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base.err || b0.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    process.exitCode = 1;
  } else {
    console.log(`  素の回り：${b0.length} passed, 0 failed（緑）`);
    let red = 0;
    for (const [name, mk, wants, scenes] of WZ) {
      const r = await runA(mk(), scenes);
      const L = r.err ? null : check(r.out);
      const hit = L ? L.filter(([n, c]) => !c && wants.some((w) => n.startsWith(w))) : [];
      const good = hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${r.err ? '塊が落ちた ' + r.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([n]) => n).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\np8-chain --waza: ${red}/${WZ.length} 狙いが赤になった`);
    process.exitCode = red === WZ.length && fail === 0 ? 0 : 1;
  }
}
