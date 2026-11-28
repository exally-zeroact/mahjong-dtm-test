/* a25r.live.mjs — ★8b A25r §1-8 の倉庫：アカウントにつないだ人は member_active false で消せない（err tsunagi）★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/a25r_sadame.md v2.1 §1-8（設計前 taiketsu 止め1→naoshi 止め0）。
 *   門は mj_w_op の member_active の枝の中＝その op を当てる時（行を for update で引いた後・役の門の後）。組の先頭で見ない＝[unlink, active false] は通る。
 *   A＝持ち主・B＝入・C＝管・D＝入・E＝入（抜ける）。A→M0・B→M1・D→M3・E→M4（E は抜ける＝M4 は left の行）。M2 はつないでいない。
 *   M0・M3・M5・M6 はリーグの日の半荘に座った（M3＝D の行はリーグに出た人＝owner_or_sole_L）。M1・M2・M4 はリーグに出ていない。
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/a25r.live.mjs [--waza]
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
const MAIL = 'mj-a25r.invalid';
const NB = 'a25r' + crypto.randomBytes(3).toString('hex');
const PASS = '3817';
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
const W = (key, ops) => `${RS} ${T(key, `public.mj_write(ra, gen_random_uuid(), ${jb(ops)})`)}`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const NAMES = ['山田', '鈴木', '佐藤', '高橋', '伊藤', '渡辺', '中村'];
const M = NAMES.map(() => U());
const L1 = U(), S1 = U(), T1 = U(), H1 = U();
const FR = { players: 4, rate: 100, chip_pt10: 20, kyotaku_end: 'kieru', tobi: true, tobi_pt: 10 };
const SEATS = [0, 3, 5, 6];
const BASE = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: NAMES[i] })),
  { op: 'league_create', league_id: L1, name: 'A25r リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'avg_pt', min_games: 1, players_main: 4, rules: FR, rules_alt: { players: 3 } },
  { op: 'session_add', session_id: S1, date: '2026-11-20', rate: 100 },
  { op: 'table_add', table_id: T1, session_id: S1, label: '卓1' }, { op: 'table_seats', table_id: T1, seats: SEATS.map((i) => M[i]) },
  { op: 'hanchan_start', hanchan_id: H1, table_id: T1, seats: SEATS.map((i) => M[i]), cells: [40000, 30000, 20000, 10000] },
];
const lk = (i) => ({ op: 'member_link', member_id: M[i] });
const ul = (i) => ({ op: 'member_unlink', member_id: M[i] });
const off = (i) => ({ op: 'member_active', member_id: M[i], active: false });
const on = (i) => ({ op: 'member_active', member_id: M[i], active: true });
const rn = (i, name) => ({ op: 'member_rename', member_id: M[i], name });
/* 行の今：u＝つないだ人の番（us の何番目・0＝空き）・a＝active・n＝名 */
const mrow = (k, i) => ROW(k, `select jsonb_build_object('u', coalesce(array_position(us, m.user_id), 0), 'a', m.active, 'n', m.name) from mahjong.members m where m.id = '${M[i]}'`);
const hist = (k) => ROW(k, `select count(*)::int from mahjong.history h where h.room_id = ra`);

const mkSql = (prefix = '') => `do ${q('a25r')} declare res jsonb := '{}'; r jsonb; i int; ra uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  for i in 1..5 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 5) k;
  ${undo('s', `delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${asWho(1)}
    ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'nyu', 'name'), (ra, us[3], 'kan', 'name'), (ra, us[4], 'nyu', 'name'), (ra, us[5], 'nyu', 'name');
    ${W('b', BASE)}
    update mahjong.sessions set league_id = '${L1}' where id = '${S1}' and room_id = ra;
    get diagnostics i = row_count; ${ROW('b_lg', 'i')}
    ${W('la', [lk(0)])}
    ${asWho(2)} ${W('lb', [lk(1)])}
    ${asWho(4)} ${W('ld', [lk(3)])}
    ${asWho(5)} ${W('le', [lk(4)])} ${W('lv', [{ op: 'room_leave' }])}
    ${mrow('m1_0', 1)} ${mrow('m3_0', 3)} ${mrow('m4_0', 4)} ${hist('h0')}
    ${asWho(3)}
    ${undo('k1', `${W('k1', [ul(1), off(1)])} ${mrow('k1_m', 1)}`)}
    ${undo('k2', `${W('k2', [off(1), ul(1)])} ${mrow('k2_m', 1)} ${hist('k2_h')}`)}
    ${undo('k3', `${W('k3', [rn(1, '鈴木2'), off(1)])} ${mrow('k3_m', 1)}`)}
    ${undo('k4', `${W('k4', [off(2)])} ${mrow('k4_m', 2)}`)}
    ${undo('k5', `update mahjong.members set active = false where id = '${M[1]}'; ${W('k5', [on(1)])} ${mrow('k5_m', 1)}`)}
    ${undo('k6', `${W('k6', [ul(3), off(3)])} ${mrow('k6_m', 3)}`)}
    ${undo('k7', `${W('k7', [off(3)])} ${mrow('k7_m', 3)}`)}
    ${undo('k10', `${W('k10', [ul(4), off(4)])} ${mrow('k10_m', 4)}`)}
    ${undo('k11', `${W('k11', [off(4)])} ${mrow('k11_m', 4)}`)}
    ${asWho(1)}
    ${undo('k8', `${W('k8', [off(0)])} ${mrow('k8_m', 0)}`)}
    ${undo('k9', `${W('k9', [ul(4), off(4)])} ${mrow('k9_m', 4)}`)}
    ${undo('k12', `${W('k12', [ul(3), off(3)])} ${mrow('k12_m', 3)}`)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('a25r')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isTsunagi = (x, i, mi) => x?.ok === false && x?.err === 'tsunagi' && x?.i === i && x?.member_id === M[mi] && J(Object.keys(x).sort()) === J(['err', 'i', 'member_id', 'ok']);
const isErr = (x, err, i) => x?.ok === false && x?.err === err && x?.i === i;
const row = (x, u, a, n) => x?.u === u && x?.a === a && (n == null || x?.n === n);
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('台：部屋・人7・リーグの日の半荘・A→M0 B→M1 D→M3 E→M4・E が抜けた', o.made?.room_id && [o.b, o.la, o.lb, o.ld, o.le, o.lv].every((x) => x?.ok === true) && o.b_lg === 1
    && row(o.m1_0, 2, true) && row(o.m3_0, 4, true) && row(o.m4_0, 5, true), J([o.b, o.lb, o.ld, o.le, o.lv, o.m1_0, o.m3_0, o.m4_0]));
  ok('§1-8 管の [unlink, active false]（つないだ人・リーグに出ていない）→ ok・つながりが空き・消えた', o.k1?.ok === true && row(o.k1_m, 0, false), J([o.k1, o.k1_m]));
  ok('§1-8 逆の順 [active false, unlink] → tsunagi（i 0・member_id・誰がつないだかを返さない）', isTsunagi(o.k2, 0, 1), J(o.k2));
  ok('§1-8 tsunagi は組ごと戻る（M1 は B のまま・active のまま・履歴が増えない）', row(o.k2_m, 2, true) && o.k2_h === o.h0, J([o.k2_m, o.k2_h, o.h0]));
  ok('§1-8 組の2つ目で tsunagi（i 1）・1つ目の rename も戻る', isTsunagi(o.k3, 1, 1) && row(o.k3_m, 2, true, '鈴木'), J([o.k3, o.k3_m]));
  ok('§1-8 つないでいない人の active false → ok（門が広すぎない）', o.k4?.ok === true && row(o.k4_m, 0, false), J([o.k4, o.k4_m]));
  ok('§1-8 active true は今まで通り（つないだまま消えていた人を戻せる）', o.k5?.ok === true && row(o.k5_m, 2, true), J([o.k5, o.k5_m]));
  ok('§1-8 管（持ち主でも L でもない）がリーグに出た人に [unlink, active false] → mj_role（i 1）・unlink も戻る', isErr(o.k6, 'mj_role', 1) && row(o.k6_m, 4, true), J([o.k6, o.k6_m]));
  ok('§1-8 役の門が先：管がリーグに出たつないだ人を active false → mj_role（tsunagi でない）', isErr(o.k7, 'mj_role', 0) && row(o.k7_m, 4, true), J([o.k7, o.k7_m]));
  ok('§1-8 持ち主が自分につないだ名を active false → tsunagi', isTsunagi(o.k8, 0, 0) && row(o.k8_m, 1, true), J([o.k8, o.k8_m]));
  ok('§1-8 left の行：持ち主の [unlink, active false] → ok・空き・消えた', o.k9?.ok === true && row(o.k9_m, 0, false), J([o.k9, o.k9_m]));
  ok('§1-8 left の行：管の [unlink, active false] → left（i 0）・E のまま', isErr(o.k10, 'left', 0) && o.k10?.member_id === M[4] && row(o.k10_m, 5, true), J([o.k10, o.k10_m]));
  ok('§1-8 left の行：active false だけ → tsunagi（つながったまま消さない）', isTsunagi(o.k11, 0, 4) && row(o.k11_m, 5, true), J([o.k11, o.k11_m]));
  ok('§1-8 持ち主がリーグに出たつないだ人に [unlink, active false] → ok', o.k12?.ok === true && row(o.k12_m, 0, false), J([o.k12, o.k12_m]));
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
const OP = 'mahjong_private.mj_w_op';
const brk = (pairs) => {
  let t = fnText(OP);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + `\nrevoke all on function ${OP}(uuid, uuid, text, uuid, int, jsonb) from public, anon, authenticated;`;
};
const GATE = 'if not v_b and v_m.user_id is not null then';
const ERR = "perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'tsunagi', 'i', p_i, 'member_id', v_m.id));";
const ROLE = 'perform mahjong_private.mj_w_role(p_room, v_op, null, v_id, p_me, p_role, p_i);\n    if v_op = \'member_rename\' then';
const WZ = [
  ['Z1 門を外す', () => brk([[GATE, 'if false then']]), ['§1-8 逆の順', '§1-8 持ち主が自分につないだ', '§1-8 left の行：active false だけ']],
  ['Z2 組の先頭で見る（同じ組の unlink を数えない）', () => brk([[GATE, 'if not v_b and (v_m.user_id is not null or exists (select 1 from mahjong.history hx where hx.group_id = p_gid and hx.room_id = p_room and hx.op = \'member_unlink\')) then']]),
    ['§1-8 管の [unlink, active false]', '§1-8 left の行：持ち主の', '§1-8 持ち主がリーグに出た']],
  ['Z3 役の門より先に見る', () => brk([[ROLE, "if v_op = 'member_active' and (p_o ->> 'active') = 'false' and v_m.user_id is not null then " + ERR + ' end if;\n    ' + ROLE]]), ['§1-8 役の門が先']],
  ['Z4 active true でも止める', () => brk([[GATE, 'if v_m.user_id is not null then']]), ['§1-8 active true は今まで通り']],
  ['Z5 誰がつないだかを返す', () => brk([[ERR, ERR.replace("'member_id', v_m.id)", "'member_id', v_m.id, 'user_id', v_m.user_id)")]]), ['§1-8 逆の順']],
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
  console.log(`\na25r: ${pass} passed, ${fail} failed`);
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
    console.log(`\na25r --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
