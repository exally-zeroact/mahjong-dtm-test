/* c20.live.mjs — ★C2-0 §1 の倉庫：mj_read の人に me／taken・member_link の taken の門を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/c20_sadame.md §1 a・c・d。
 *   §1c：A（持ち主）が M0・B（入）が M1 につなぐ。A と B がそれぞれ room v2・room v3・league（v 無し）・league v3 を読む
 *        ＝自分の人に me:true・他の人がつないだ人に taken:true・空きはどちらも無し。読みの json に user_id の字が無い。
 *   §1d：B [unlink M1, link M0(A の)]＝err taken（i 1・member_id M0）・組ごと戻る（M1 は B のまま・名乗り0）
 *        C [unlink M2(空き＝何もしない), link M0]＝claimed（名乗り1）・C [link M0] だけ＝claimed（名乗り1）
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/c20.live.mjs [--waza]
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
const MAIL = 'mj-c20.invalid';
const NB = 'c20' + crypto.randomBytes(3).toString('hex');
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
const W = (key, ops) => `${RS} ${T(key, `public.mj_write(ra, gen_random_uuid(), ${jb(ops)})`)}`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const M = [U(), U(), U(), U()];
const L1 = U();
const FR = { players: 4, rate: 100, chip_pt10: 20, kyotaku_end: 'kieru', tobi: true, tobi_pt: 10 };
const BASE = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '山田鈴木佐藤高橋'.slice(i * 2, i * 2 + 2) })),
  { op: 'league_create', league_id: L1, name: 'C20 リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'avg_pt', min_games: 1, players_main: 4, rules: FR, rules_alt: { players: 3 } },
];
const lk = (i) => ({ op: 'member_link', member_id: M[i] });
const ul = (i) => ({ op: 'member_unlink', member_id: M[i] });
const READS = [
  ['room v2', `'room', '{}'::jsonb`],
  ['room v3', `'room', jsonb_build_object('v', 3)`],
  ['league', `'league', jsonb_build_object('league_id', ${lit(L1)})`],
  ['league v3', `'league', jsonb_build_object('league_id', ${lit(L1)}, 'v', 3)`],
];
const WHO = [['A', 1], ['B', 2]];
const claims = (k, who, mi) => ROW(k, `select count(*)::int from mahjong.member_claims x where x.room_id = ra and x.user_id = us[${who}]${mi == null ? '' : ` and x.member_id = '${M[mi]}'`}`);

const mkSql = (prefix = '') => `do ${q('c20')} declare res jsonb := '{}'; r jsonb; i int; ra uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  for i in 1..3 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 3) k;
  res := res || jsonb_build_object('uids', to_jsonb(us));
  ${undo('s', `delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${asWho(1)}
    ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'nyu', 'name'), (ra, us[3], 'nyu', 'name');
    ${W('b', BASE)}
    ${W('la', [lk(0)])}
    ${asWho(2)} ${W('lb', [lk(1)])}
    ${WHO.map(([w, n]) => `${asWho(n)} ${READS.map(([nm, a], k) => T(`rd_${w}_${k}`, `public.mj_read(ra, ${a})`)).join('\n    ')}`).join('\n    ')}
    ${asWho(2)} ${W('d1', [ul(1), lk(0)])}
    ${ROW('d1_m1', `select m.user_id = us[2] from mahjong.members m where m.id = '${M[1]}'`)}
    ${ROW('d1_m0', `select m.user_id = us[1] from mahjong.members m where m.id = '${M[0]}'`)}
    ${claims('d1_cl', 2, null)}
    ${asWho(3)}
    ${undo('d2', `${W('d2', [ul(2), lk(0)])} ${claims('d2_cl', 3, 0)} ${ROW('d2_m2', `select m.user_id is null from mahjong.members m where m.id = '${M[2]}'`)}`)}
    ${W('d3', [lk(0)])} ${claims('d3_cl', 3, 0)}
    ${ROW('d3_m0', `select m.user_id = us[1] from mahjong.members m where m.id = '${M[0]}'`)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('c20')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const flag = (m) => (m.me === true ? 'me' : '') + (m.taken === true ? 'taken' : '') || '-';
const WANT = { A: ['me', 'taken', '-', '-'], B: ['taken', 'me', '-', '-'] };
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('台：部屋と人とリーグ・A が M0・B が M1 につないだ', o.made?.room_id && o.b?.ok === true && o.la?.ok === true && o.lb?.ok === true, J([o.made, o.b, o.la, o.lb]).slice(0, 400));
  const uids = (o.uids || []).map(String);
  for (const [w] of WHO) {
    READS.forEach(([nm], k) => {
      const rd = o[`rd_${w}_${k}`];
      const mem = rd?.st?.members;
      const got = Array.isArray(mem) ? M.map((id) => { const m = mem.find((x) => x.member_id === id); return m ? flag(m) : '無し'; }) : null;
      ok(`§1c ${w} の ${nm}：me／taken ＝ ${J(WANT[w])}`, rd?.ok === true && J(got) === J(WANT[w]), J(got) + ' ' + J(rd).slice(0, 300));
      const s = J(rd);
      ok(`§1c ${w} の ${nm}：user_id の字が無い（鍵も値も）`, uids.length === 3 && !s.includes('"user_id"') && uids.every((u) => !s.includes(u)), uids.filter((u) => s.includes(u)).join(','));
      ok(`§1c ${w} の ${nm}：me／taken は true の時だけ（false の鍵を出さない）`, Array.isArray(mem) && mem.every((m) => (!('me' in m) || m.me === true) && (!('taken' in m) || m.taken === true) && !(m.me && m.taken)), J(mem).slice(0, 300));
    });
  }
  ok('§1d B [unlink M1, link M0(A の)] ＝ err taken・i 1・member_id M0', o.d1?.ok === false && o.d1?.err === 'taken' && o.d1?.i === 1 && o.d1?.member_id === M[0], J(o.d1));
  ok('§1d taken は組ごと戻る：M1 は B のまま・M0 は A のまま・B の名乗り 0', o.d1_m1 === true && o.d1_m0 === true && o.d1_cl === 0, J([o.d1_m1, o.d1_m0, o.d1_cl]));
  ok('§1d C [unlink M2(空き), link M0] ＝ claimed（何もしない unlink は移りに数えない）・名乗り1', o.d2?.ok === true && o.d2?.results?.[1]?.claimed === true && o.d2_cl === 1 && o.d2_m2 === true, J([o.d2, o.d2_cl, o.d2_m2]).slice(0, 300));
  ok('§1d C [link M0] だけ ＝ claimed・名乗り1・M0 は A のまま', o.d3?.ok === true && o.d3?.results?.[0]?.claimed === true && o.d3_cl === 1 && o.d3_m0 === true, J([o.d3, o.d3_cl, o.d3_m0]).slice(0, 300));
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
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'mahjong_private.mj_r_league3': '(uuid, uuid, bigint, uuid, uuid, uuid)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const OP = 'mahjong_private.mj_w_op', RD = 'public.mj_read', LG = 'mahjong_private.mj_r_league3';
const GATE = "if v_m.user_id is not null and exists (select 1 from mahjong.history hx where hx.group_id = p_gid and hx.room_id = p_room and hx.op = 'member_unlink') then";
const WZ = [
  ['Z1 taken の門を外す（移りでも claimed）', () => brk(OP, [[GATE, 'if false then']]), ['§1d B [unlink M1']],
  ['Z2 taken の門を組を見ずに掛ける（link だけでも taken）', () => brk(OP, [[GATE, 'if v_m.user_id is not null then']]), ['§1d C [link M0] だけ', '§1d C [unlink M2']],
  ['Z3 部屋の読みで me を出さない', () => brk(RD, [[`when m.user_id = v_me then '{"me": true}'::jsonb`, `when m.user_id = v_me then '{}'::jsonb`]]), ['§1c A の room v2', '§1c B の room v3']],
  ['Z4 部屋の読みで自分も taken', () => brk(RD, [[`when m.user_id = v_me then '{"me": true}'::jsonb`, `when false then '{}'::jsonb`]]), ['§1c A の room v2', '§1c A の league：']],
  ['Z5 リーグ v3 で taken を出さない', () => brk(LG, [[`when m.user_id is not null then '{"taken": true}'::jsonb`, `when false then '{}'::jsonb`]]), ['§1c A の league v3', '§1c B の league v3']],
  ['Z6 リーグ v3 で user_id を返す', () => brk(LG, [[`'active', m.active)`, `'active', m.active, 'user_id', m.user_id)`]]), ['§1c A の league v3：user_id']],
  ['Z7 部屋の読みで false の鍵を出す', () => brk(RD, [[`else '{}'::jsonb end\n`, `else '{"me": false}'::jsonb end\n`]]), ['§1c A の room v2：me／taken は true']],
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
  console.log(`\nc20: ${pass} passed, ${fail} failed`);
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
    console.log(`\nc20 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
