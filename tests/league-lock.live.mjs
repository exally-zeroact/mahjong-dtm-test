/* league-lock.live.mjs — ★2c-2d1（write7_league_sadame_v11.md 止め5）人ごと24時間5本を、別の部屋から同時に来た2本の接続で破れないか★
 * =============================================================================
 * 1つの取引では2本を並べられない（dblink 無し）＝ここだけ倉庫に「書いて残す」：
 *   ① 試しの人1人（@mj-lock.invalid）と部屋2つ（w-lock-a・w-lock-b）を作り、その人が作ったリーグを4本入れる（24時間内）
 *   ② 部屋 a と部屋 b で league_create を2本の接続で同時に送る（1本目は書いた後 3秒寝てから閉じる＝鍵が無ければ2本目も「4本」と数える）
 *   ③ 答え：片方 ok・片方 too_many（what league_create）・その人のリーグは5本
 *   ④ 回りごとに全部消す（部屋・人・creates・write:* の上限の行・totals の rooms_all を作った数だけ戻す）＝倉庫に試しの物を残さない
 * ★同じ人の書き込みを並べる物は2つ在る★（11-21 測り）：mj_me の last_seen の upsert（ON CONFLICT DO UPDATE は WHERE が偽でも accounts の行を鍵する
 *   ＝人の鍵を外しても2本目は transactionid で accounts の行を待った）と、league_create の人の鍵（pg_advisory_xact_lock）。
 *   前者は last_seen の作りのついで＝それに頼らず人の鍵で守る。
 * --waza：W1＝mj_me の行の鍵だけ外して②（人の鍵だけで緑のままが正しい）→ W2＝人の鍵も外して②（★6本目が通って赤★が正しい）。
 *         finally で schema.sql の本当の mj_w_op・mj_me を当て直す（当て直しが落ちたら「★中止★ npm run db:apply」と出す）。
 * 使い方: node tests/league-lock.live.mjs [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(/url:\s*'([^']+)'/.exec(src)[1])[1];
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2' || !/env:\s*'test'/.test(src)) {
  console.log('★中止★ 倉庫が khaw（test）でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1);
}
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
const WAZA = process.argv.includes('--waza');
const MAIL = 'mj-lock.invalid';
const lit = (s) => '$v$' + s + '$v$';

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await r.text();
  let rows = null; try { rows = JSON.parse(text); } catch (_) { /* 字 */ }
  if (r.status >= 300 || !Array.isArray(rows)) throw new Error(`倉庫 ${r.status}: ${text.slice(0, 400)}`);
  return rows;
}

const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const LOCK = "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mj_league_create:' || p_me::text, 0));";
const OP = fnText('mahjong_private.mj_w_op');
if (!OP.includes(LOCK)) { console.log('★中止★ mj_w_op に人の鍵の行が無い'); process.exit(1); }
const REVOKE = 'revoke all on function mahjong_private.mj_w_op(uuid, uuid, text, uuid, int, jsonb) from public, anon, authenticated;';
const ME = fnText('mahjong_private.mj_me');
const UPSERT = "    on conflict (user_id) do update set last_seen = pg_catalog.now()\n    where a.last_seen < pg_catalog.now() - interval '1 minute';";
if (!ME.includes(UPSERT)) { console.log('★中止★ mj_me に last_seen の upsert が無い'); process.exit(1); }
const REVOKE_ME = 'revoke all on function mahjong_private.mj_me() from public, anon, authenticated;';

let pass = 0, fail = 0, exit = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + info : '')); } };
const lc = () => lit(JSON.stringify([{ op: 'league_create', league_id: crypto.randomUUID(), name: 'lock', date_from: '2026-11-01', date_to: '2026-11-30', players_main: 4, rules: { players: 4 } }]));

/* 1回の回り：①人と部屋とリーグ4本 → ②同時に2本 → ③数える → ④片付け。返すのは ③ が通ったか（片付けの残りは最後に別の行で数える） */
async function race(label) {
  const me = crypto.randomUUID(), ss = crypto.randomUUID();
  const ops = [crypto.randomUUID(), crypto.randomUUID()];
  const claims = lit(JSON.stringify({ sub: me, session_id: ss, role: 'authenticated' }));
  /* 1本の文＝1つの取引：claims を置く→書く→（1本目だけ）寝る→閉じる（commit） */
  const call = (room, sleep) => `select r, pg_catalog.pg_sleep(${sleep}) as z from (
  select public.mj_write('${room}'::uuid, gen_random_uuid(), ${lc()}::jsonb) as r from (select set_config('request.jwt.claims', ${claims}, true)) c offset 0) y`;
  const rooms = [];
  let made = 0, res = null;
  try {
    await mq(`insert into auth.users (id, email, aud, role, is_anonymous) values ('${me}', '${me}@${MAIL}', 'authenticated', 'authenticated', false);
      insert into auth.sessions (id, user_id) values ('${ss}', '${me}');`);
    for (const [k, opid] of [['a', ops[0]], ['b', ops[1]]]) {
      const rr = await mq(`select public.mj_room_create('${opid}'::uuid, ${lit('w-lock-' + k)}, ${lit('2741')}, '{"players":4}'::jsonb,
        jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text))) as r from (select set_config('request.jwt.claims', ${claims}, true)) c`);
      const rid = rr[0]?.r?.room_id;
      if (!rid) throw new Error('部屋を作れない: ' + JSON.stringify(rr).slice(0, 300));
      rooms.push(rid); made++;
    }
    await mq(`insert into mahjong.leagues (room_id, name, rule_set_id, rule_version, owner_user_id, created_by)
      select '${rooms[0]}', 'pre' || k, r.rule_set_id, r.rule_version, '${me}', '${me}' from mahjong.rooms r, generate_series(1, 4) k where r.id = '${rooms[0]}';`);
    /* ② 同時に2本（2本目は 0.5秒後＝1本目が書いて寝ている間に着く） */
    const t0 = Date.now(), tm2 = (p) => p.then((v) => [v, Date.now() - t0]);
    const p1 = tm2(mq(call(rooms[0], 3)));
    await new Promise((r) => setTimeout(r, 500));
    const p2 = tm2(mq(call(rooms[1], 0)));
    const [[a, ta], [b, tb]] = await Promise.all([p1, p2]);
    const ra = a[0]?.r, rb = b[0]?.r;
    const n = (await mq(`select count(*)::int as n from mahjong.leagues where created_by = '${me}'`))[0].n;
    const okN = [ra, rb].filter((x) => x?.ok === true).length;
    const tm = [ra, rb].filter((x) => x?.ok === false && x.err === 'too_many' && x.what === 'league_create').length;
    console.log(`  （${label}：1本目 ${ta}ms・2本目 ${tb}ms で返った・リーグ ${n} 本）`);
    res = { good: okN === 1 && tm === 1 && n === 5, info: JSON.stringify({ a: ra, b: rb, n }) };
  } catch (e) {
    res = { good: false, err: true, info: '回らなかった — ' + String(e.message || e).slice(0, 500) };
  } finally {
    try {
      await mq(`delete from mahjong.rooms where id in (${rooms.map((r) => `'${r}'`).join(', ') || 'null'});
        delete from mahjong.creates where op_id in ('${ops[0]}', '${ops[1]}');
        delete from auth.users where email like '%@${MAIL}';
        delete from mahjong.limits where kind like 'write:%' or key in ('${me}'${rooms.map((r) => `, '${r}'`).join('')});
        update mahjong.totals set rooms_all = greatest(rooms_all - ${made}, 0) where id = 1;`);
    } catch (e) { console.log('  ✗ 片付けが落ちた — ' + String(e.message).slice(0, 300)); fail++; }
  }
  return res;
}

const NAME = '⑯ 2本の接続×2部屋：4本の人の5本目と6本目が同時 → 片方 ok・片方 too_many（what league_create）・リーグは5本';
let brokeMe = false, brokeOp = false, red = 0;
try {
  if (!WAZA) {
    const r = await race('本物');
    ok(NAME, r.good, r.info);
  } else {
    /* W1：mj_me の行の鍵だけ外す＝人の鍵だけで守れるか（緑が正しい） */
    brokeMe = true;
    await mq(ME.split(UPSERT).join('    on conflict (user_id) do nothing;') + '\n' + REVOKE_ME);
    console.log('  （--waza W1：mj_me の行の鍵を外した＝人の鍵だけ）');
    const r1 = await race('W1');
    ok('W1 人の鍵だけで ' + NAME, r1.good, r1.info);
    /* W2：人の鍵も外す＝6本目が通って赤になるのが正しい（試験が同時の破れを見つけられる証拠） */
    brokeOp = true;
    await mq(OP.split(LOCK).join('null;') + '\n' + REVOKE);
    console.log('  （--waza W2：人の鍵も外した）');
    const r2 = await race('W2');
    if (!r2.good && !r2.err) { red++; console.log('  ✓ W2 両方外すと ⑯ が赤になった — ' + r2.info); }
    else { fail++; console.log('  ✗ W2 両方外しても ⑯ が赤にならない — ' + r2.info); }
  }
} catch (e) {
  fail++; console.log('  ✗ 回らなかった — ' + String(e.message || e).slice(0, 500));
} finally {
  if (brokeOp) {
    try { await mq(OP + '\n' + REVOKE); console.log('  （本当の mj_w_op を当て直した）'); }
    catch (e) { console.log('★中止★ mj_w_op を当て直せない＝今すぐ npm run db:apply — ' + String(e.message).slice(0, 300)); exit = 1; }
  }
  if (brokeMe) {
    try { await mq(ME + '\n' + REVOKE_ME); console.log('  （本当の mj_me を当て直した）'); }
    catch (e) { console.log('★中止★ mj_me を当て直せない＝今すぐ npm run db:apply — ' + String(e.message).slice(0, 300)); exit = 1; }
  }
  const left = (await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like 'w-lock-%') as r`))[0];
  ok('倉庫に試しの人・部屋が残っていない', left.u === 0 && left.r === 0, JSON.stringify(left));
}
if (WAZA) {
  console.log(`\nleague-lock --waza: W1 と片付け ${fail === 0 ? '緑' : '赤'}・W2 ${red}/1 狙いが赤になった`);
  process.exitCode = red === 1 && fail === 0 && !exit ? 0 : 1;
} else {
  console.log(`\nleague-lock: ${pass} passed, ${fail} failed`);
  process.exitCode = fail || exit ? 1 : 0;
}
