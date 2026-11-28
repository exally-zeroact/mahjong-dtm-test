/* lf.live.mjs — ★L §2（l_sadame v1.3）の倉庫の門を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 *   ① 締めの門：リーグの日に締め（settle_snap）が在れば、その日の卓の table_edit voided true／false＝err settled（table_id・session_id）
 *      締めた後でも同じ値の送り直し（何も変わらない）は ok・締める前は通る・ふつうの部屋の日は締めた後も今のまま通る・voided 以外（label）は締めた後も通る
 *   ② 名（司さん 11-27 23時「同じ名前のリーグも作れる」）：同じ部屋で同じ名のリーグを作る・改名で同じ名にするのは通る（門を置かない事を確かめる）
 *   ③ 作った日時（A24・11-27）：mj_read の room の leagues[] に created_at（倉庫の leagues.created_at・UTC・"YYYY-MM-DDTHH:MM:SSZ"・小数なし）
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/lf.live.mjs [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { rulesOk, defaultRules } from '../lib/rules.mjs';

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

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const J = (x) => String(JSON.stringify(x));
const U = () => crypto.randomUUID();
const MAIL = 'mj-lf.invalid';
const NB = 'lf' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
const jb = (x) => `${lit(J(x))}::jsonb`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sel) => `res := res || jsonb_build_object('${key}', (${sel}));`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
const W = (room, key, ops) => `${RS} ${T(key, `public.mj_write(${room}, gen_random_uuid(), ${jb(ops)})`)}`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const M = [U(), U(), U(), U()];
const L1 = U(), L2 = U(), L3 = U(), L4 = U(), L5 = U(), LX = U();
const S1 = U(), S2 = U();
const T1 = U(), T2 = U(), T3 = U();
const FR = { players: 4, rate: 100 };
const lc = (id, name) => ({ op: 'league_create', league_id: id, name, date_from: '2026-11-01', date_to: null, players_main: 4, rules: FR });
const BASE = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '山田鈴木佐藤高橋'.slice(i * 2, i * 2 + 2) })),
  lc(L1, 'L 本'),
  { op: 'session_add', session_id: S1, date: '2026-11-20', rate: null, league_id: L1 },
  { op: 'table_add', table_id: T1, session_id: S1, label: '卓1' },
  { op: 'table_add', table_id: T2, session_id: S1, label: '卓2' },
  { op: 'session_add', session_id: S2, date: '2026-11-21', rate: 100 },
  { op: 'table_add', table_id: T3, session_id: S2, label: '卓1' },
];
const SNAP = (sid) => ({ op: 'settle_snap', session_id: sid, rev: 1, content: { ten: {} }, used: {}, missing: [] });
const te = (tid, o) => ({ op: 'table_edit', table_id: tid, ...o });
const tv = (tid) => `select t.voided from mahjong.tables t where t.id = '${tid}'`;
const nl = (name) => `select count(*)::int from mahjong.leagues x where x.room_id = ra and x.name = ${lit(name)}`;

const mkSql = (prefix = '') => `do ${q('lf')} declare res jsonb := '{}'; r jsonb; i int; ra uuid; rb uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  for i in 1..1 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u; insert into mahjong.accounts (user_id, human_at) select u, now() from unnest(us) u on conflict (user_id) do update set human_at = now(); -- P10 印
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 1) k;
  ${undo('s', `delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${asWho(1)}
    ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB + 'a')}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    ${T('madeb', `public.mj_room_create(gen_random_uuid(), ${lit(NB + 'b')}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    rb := (r->>'room_id')::uuid;
    ${W('ra', 'b', BASE)}
    -- ① 締める前：リーグの日の卓を消して戻す＝通る
    ${undo('pre', `${W('ra', 'pre1', [te(T1, { voided: true })])} ${ROW('pre1_v', tv(T1))}
      ${W('ra', 'pre2', [te(T1, { voided: false })])} ${ROW('pre2_v', tv(T1))}`)}
    -- 卓2 は消してから締める（戻すの門を見る）
    ${W('ra', 'v2', [te(T2, { voided: true })])}
    ${W('ra', 'sn1', [SNAP(S1)])}
    ${W('ra', 'sn2', [SNAP(S2)])}
    ${W('ra', 'a1', [te(T1, { voided: true })])} ${ROW('a1_v', tv(T1))}
    ${W('ra', 'a2', [te(T2, { voided: false })])} ${ROW('a2_v', tv(T2))}
    ${W('ra', 'a3', [te(T1, { voided: false })])}
    ${W('ra', 'a4', [te(T2, { voided: true })])}
    ${W('ra', 'a5', [te(T1, { label: '卓A' })])}
    ${W('ra', 'a6', [te(T1, { label: '卓B' }), te(T2, { voided: false })])} ${ROW('a6_l', `select t.label from mahjong.tables t where t.id = '${T1}'`)}
    ${undo('pl', `${W('ra', 'p1', [te(T3, { voided: true })])} ${ROW('p1_v', tv(T3))}`)}
    -- ② 名：同じ名でも通る
    ${W('ra', 'n1', [lc(L2, ' L 本 ')])} ${ROW('n1_n', nl('L 本'))}
    ${W('ra', 'n2', [lc(L1, 'L 本')])}
    ${W('rb', 'n3', [lc(L3, 'L 本')])}
    ${W('ra', 'n4', [lc(L4, 'L 別')])}
    ${undo('nv', `update mahjong.leagues x set voided = true where x.id = '${L4}';
      ${W('ra', 'n5', [lc(L5, 'L 別')])}`)}
    ${W('ra', 'n6', [{ op: 'league_save', league_id: L4, base_version: 1, name: 'L 本' }])} ${ROW('n6_n', `select x.name from mahjong.leagues x where x.id = '${L4}'`)}
    ${W('ra', 'n7', [{ op: 'league_save', league_id: L4, base_version: 1, name: ' L 別 ' }])}
    ${undo('nx', `${W('ra', 'n8', [{ op: 'league_save', league_id: L4, base_version: 1, name: 'L 新' }])}
      ${W('ra', 'n9', [lc(LX, 'L 別')])}`)}
    -- ③ 作った日時：読みの leagues[].created_at が倉庫の値と同じ（v 3 と v 2 の両方）
    ${T('rd3', `public.mj_read(ra, 'room', ${jb({ v: 3 })})`)}
    ${T('rd2', `public.mj_read(ra, 'room', '{}'::jsonb)`)}
    ${ROW('lc_want', `select jsonb_object_agg(x.id::text, to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) from mahjong.leagues x where x.room_id = ra`)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('lf')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isSettled = (x, tid) => x?.ok === false && x?.err === 'settled' && x?.i === 0 && x?.table_id === tid && x?.session_id === S1;
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('台：部屋2つ・人・リーグ・リーグの日（卓2つ）・ふつうの日（卓1つ）', o.made?.room_id && o.madeb?.room_id && o.b?.ok === true, J([o.made, o.madeb, o.b]).slice(0, 400));
  ok('①締める前：リーグの日の卓を消す・戻すは通る', o.pre1?.ok === true && o.pre1_v === true && o.pre2?.ok === true && o.pre2_v === false, J([o.pre1, o.pre1_v, o.pre2, o.pre2_v]));
  ok('①台：卓2 を消して両方の日を締めた', o.v2?.ok === true && o.sn1?.ok === true && o.sn2?.ok === true, J([o.v2, o.sn1, o.sn2]));
  ok('①締めた後：リーグの日の卓を消す＝err settled（table_id・session_id）・消えていない', isSettled(o.a1, T1) && o.a1_v === false, J([o.a1, o.a1_v]));
  ok('①締めた後：リーグの日の消した卓を戻す＝err settled・戻っていない', isSettled(o.a2, T2) && o.a2_v === true, J([o.a2, o.a2_v]));
  ok('①締めた後：同じ値の送り直し（消していない卓に false・消した卓に true）は ok', o.a3?.ok === true && o.a4?.ok === true, J([o.a3, o.a4]));
  ok('①締めた後：voided でない直し（label）は通る', o.a5?.ok === true, J(o.a5));
  ok('①締めた後：組の2つ目が門＝err settled（i 1）・1つ目の label も戻る', o.a6?.ok === false && o.a6?.err === 'settled' && o.a6?.i === 1 && o.a6?.table_id === T2 && o.a6_l === '卓A', J([o.a6, o.a6_l]));
  ok('①ふつうの部屋の日は締めた後も卓を消せる（今のまま）', o.p1?.ok === true && o.p1_v === true, J([o.p1, o.p1_v]));
  ok('②同じ部屋・同じ名のリーグも作れる・同じ league_id の送り直しは ok', o.n1?.ok === true && o.n1_n === 2 && o.n2?.ok === true, J([o.n1, o.n1_n, o.n2]));
  ok('②league_save で他のリーグと同じ名へ改名できる', o.n6?.ok === true && o.n6_n === 'L 本', J([o.n6, o.n6_n]));
  const CA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const want = o.lc_want || {};
  const caOk = (rd) => {
    const lg = rd?.ok === true && Array.isArray(rd.leagues) ? rd.leagues : null;
    return !!lg && lg.length === 3 && Object.keys(want).length === 3
      && lg.every((x) => typeof x.created_at === 'string' && CA.test(x.created_at) && x.created_at === want[x.league_id]);
  };
  ok('③mj_read の leagues[].created_at が倉庫の作った日時（UTC・Z・小数なし）・v 3 と v 2', caOk(o.rd3) && caOk(o.rd2), J([o.rd3?.leagues, o.rd2?.leagues, want]).slice(0, 600));
  return L;
}

/* ── --waza ── */
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'public.mj_read': '(uuid, text, jsonb)' };
const RD = 'public.mj_read';
const RDG = `\ngrant execute on function ${RD}${SIG[RD]} to authenticated;`;
const CA0 = `'created_at', pg_catalog.to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),`;
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;`;
};
const OP = 'mahjong_private.mj_w_op';
const G1 = 'if v_b is distinct from t.voided then';
const G2 = 'if v_ss.league_id is not null and exists';
const WZ = [
  ['Z1 締めの門を外す', () => brk(OP, [[G2, 'if false and exists']]), ['①締めた後：リーグの日の卓を消す', '①締めた後：リーグの日の消した卓を戻す']],
  ['Z2 締めの門を voided が変わらない時も掛ける', () => brk(OP, [[G1, 'if true then']]), ['①締めた後：同じ値の送り直し', '①締めた後：voided でない直し']],
  ['Z3 締めの門をふつうの部屋の日にも掛ける', () => brk(OP, [[G2, 'if true and exists']]), ['①ふつうの部屋の日']],
  ['Z4 読みから created_at を外す', () => brk(RD, [[CA0, '']]) + RDG, ['③mj_read の leagues']],
  ['Z5 created_at に小数を付ける', () => brk(RD, [[CA0, CA0.replace('SS"Z"', 'SS.US"Z"')]]) + RDG, ['③mj_read の leagues']],
  ['Z6 created_at を UTC でなく倉庫の時刻で出す', () => brk(RD, [[CA0, CA0.replace(` at time zone 'UTC'`, ` at time zone 'Asia/Tokyo'`)]]) + RDG, ['③mj_read の leagues']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋が残っていない', j && j.u === 0 && j.r === 0, text.slice(0, 200));
};

const only = process.env.MJ_WAZA_ONLY;
if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  await leftCheck();
  console.log(`\nlf: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  const base0 = await runA('');
  const b0 = base0.err ? null : check(base0.out);
  if (!b0 || b0.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (base0.err || b0.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    process.exitCode = 1;
  } else {
    console.log(`  素の回り：${b0.length} passed, 0 failed（緑）`);
    let red = 0, n = 0;
    for (const [name, mk, wants] of WZ) {
      if (only && !name.includes(only)) continue;
      n++;
      const r = await runA(mk());
      const L = r.err ? null : check(r.out);
      const hit = L && L.filter(([nm, c]) => !c && wants.some((w) => nm.startsWith(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${r.err ? '塊が落ちた ' + r.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([nm]) => nm).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\nlf --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
