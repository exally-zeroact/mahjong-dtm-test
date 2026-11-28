/* rt.live.mjs — ★2c-2f 合図（倉庫からの控えの送り）と mj_write の ok の read_ver・mj_read の channel_key を本物のテスト倉庫で叩く★（定め mahjong_tataki_2026-11-20/2c2f_sadame.md v1.2 §3-1）
 * =============================================================================
 * 手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす・read.live:25-27 と同じ門）。1つの取引の塊（最後にわざと例外＝全部戻す＝realtime.messages の行も戻る）。
 * 見る物：ok の返しに read_ver（＝rooms.read_ver）／ok の組の後に topic＝channel_key・event 'w'・payload.v＝read_ver の行が1つ／弾かれた組と送り直しは0／
 *   room_secret・room_share は古い名と新しい名に1つずつ／K-3 の継ぎで1つ（＋その組の ok で1つ）／mj_read の room.channel_key＝今の名。
 *   P1（pbundle_sadame.md v2.1 §3）：account_remove・room_leave は channel_key を新しくし、古い名と新しい名に1つずつ・その後の書きは古い名に来ない。
 * --waza：Z1 送りを外す／Z2 包みを外して無い関数を呼ぶ（書きが internal）／Z3 古い名を外す／Z4 account_remove の付け替えを外す／Z5 room_leave の付け替えを外す → それぞれ狙いが赤。
 * 使い方: node tests/rt.live.mjs [--waza]
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
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').split('\r\n').join('\n');   // 作業木の CRLF でも壊す字が当たる

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const J = (x) => JSON.stringify(x);
const U = () => crypto.randomUUID();
const MAIL = 'mj-rt.invalid';
const NB = 'rt' + crypto.randomBytes(3).toString('hex');
const PASS = '2741', PASS2 = '8360';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', ${EP} - 3000), jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const URLH = () => `${lit(crypto.randomBytes(32).toString('hex'))}`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
/* 合図の行＝topic と event 'w' の行の v の並び（入れた順）。P-e（pe_sadame v1.1 §1.1）：移る間は公開と鍵つきに1つずつ＝key は公開・key_p は鍵つき */
const MSG1 = (key, ch, pv) => ROW(key, `select coalesce(jsonb_agg((m.payload ->> 'v')::bigint order by m.inserted_at, m.id), '[]'::jsonb) from realtime.messages m where m.topic = ${ch} and m.event = 'w' and m.private = ${pv}`);
const MSG = (key, ch) => MSG1(key, ch, 'false') + ' ' + MSG1(key + '_p', ch, 'true');
const RV = (key, room) => ROW(key, `select to_jsonb(read_ver) from mahjong.rooms where id = ${room}`);
const CK = (room) => `(select channel_key from mahjong.rooms where id = ${room})`;
const MA = (name) => `jsonb_build_array(jsonb_build_object('op', 'member_add', 'member_id', gen_random_uuid(), 'name', ${lit(name)}))`;
const OPW = U();

const mkSql = (prefix = '') => `do ${q('rt')} declare res jsonb := '{}'; r jsonb; i int;
  us uuid[] := '{}'; ss uuid[] := '{}'; rg uuid; rs uuid; ck0 text; ck1 text; cs0 text; cs1 text; ca1 text; cl1 text;
begin
  ${prefix}
  delete from mahjong.limits where kind like 'create:%' or kind like 'join:%' or kind like 'secret:%';
  for i in 1..5 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u; insert into mahjong.accounts (user_id, human_at) select u, now() from unnest(us) u on conflict (user_id) do update set human_at = now(); -- P10 印
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 5) k;

  /* 部屋 G（shared・持ち主 1・管 2） */
  ${asWho(1)}
  ${T('made_g', `public.mj_room_create(gen_random_uuid(), ${lit(NB + 'g')}, ${lit(PASS)}, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${URLH()}))`)} rg := (r->>'room_id')::uuid;
  ${asWho(2)} ${T('j2', `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(NB + 'g')})`)}
  update mahjong.room_accounts set role = 'kan' where room_id = rg and user_id = us[2];   -- room_secret は入を外す＝管にしておく（K-3 も管が書く）
  ck0 := ${CK('rg')};
  ${MSG('m0', 'ck0')}
  /* ok の組 */
  ${asWho(1)} ${RS}
  ${T('w1', `public.mj_write(rg, '${OPW}', ${MA('甲')})`)}
  ${RV('w1_rv', 'rg')} ${MSG('m1', 'ck0')}
  /* 弾かれた組（名前が無い＝bad） */
  ${RS} ${T('wb', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'member_add', 'member_id', gen_random_uuid())))`)}
  ${MSG('mb', 'ck0')}
  /* 送り直し（同じ op_id） */
  ${RS} ${T('wr', `public.mj_write(rg, '${OPW}', ${MA('甲')})`)}
  ${MSG('mr', 'ck0')}
  /* mj_read の channel_key（入が読む） */
  ${asWho(2)} ${T('rd0', `public.mj_read(rg, 'room', null)`)}
  res := res || jsonb_build_object('ck0_ok', (r -> 'room' ->> 'channel_key') = ck0);
  /* room_secret（持ち主・amr 新しい） */
  ${asWho(1)} ${RS}
  ${T('ws', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'room_secret', 'pass', ${lit(PASS2)}, 'url_token_hash', ${URLH()})))`)}
  ck1 := ${CK('rg')};
  ${RV('ws_rv', 'rg')} ${MSG('ms_old', 'ck0')} ${MSG('ms_new', 'ck1')}
  res := res || jsonb_build_object('ck_changed', ck1 is distinct from ck0);
  ${asWho(2)} ${T('rd1', `public.mj_read(rg, 'room', null)`)}
  res := res || jsonb_build_object('ck1_ok', (r -> 'room' ->> 'channel_key') = ck1);
  /* K-3：持ち主のアカウントが消えた→入が書く＝継ぎで1つ＋ok で1つ */
  delete from auth.users where id = us[1];
  ${asWho(2)} ${RS}
  ${RV('k3_rv0', 'rg')}
  ${T('wk', `public.mj_write(rg, gen_random_uuid(), ${MA('乙')})`)}
  ${RV('k3_rv', 'rg')} ${MSG('mk', 'ck1')}
  /* room_share（solo の部屋を shared へ＝合図の名が変わる） */
  ${asWho(3)}
  ${T('made_s', `public.mj_room_create(gen_random_uuid(), null, null, '{"players":4}'::jsonb, jsonb_build_object('url_token_hash', ${URLH()}))`)} rs := (r->>'room_id')::uuid;
  cs0 := ${CK('rs')};
  ${RS} ${T('wsh', `public.mj_write(rs, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'room_share', 'name', ${lit(NB + 's')}, 'pass', ${lit(PASS)}, 'url_token_hash', ${URLH()})))`)}
  cs1 := ${CK('rs')};
  ${RV('wsh_rv', 'rs')} ${MSG('msh_old', 'cs0')} ${MSG('msh_new', 'cs1')}
  res := res || jsonb_build_object('cs_changed', cs1 is distinct from cs0);
  /* P1 §3：4 と 5 が G に入る（パスは room_secret の後の PASS2）→ 管 2 が 4 を出す（account_remove）→ 5 が抜ける（room_leave） */
  ${asWho(4)} ${T('j4', `public.mj_room_join('name', null, null, ${lit(PASS2)}, ${lit(NB + 'g')})`)}
  ${asWho(5)} ${T('j5', `public.mj_room_join('name', null, null, ${lit(PASS2)}, ${lit(NB + 'g')})`)}
  ck1 := ${CK('rg')};
  ${asWho(2)} ${RS}
  ${T('wa', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'account_remove', 'user_id', us[4])))`)}
  ca1 := ${CK('rg')};
  ${RV('wa_rv', 'rg')} ${MSG('ma_old', 'ck1')} ${MSG('ma_new', 'ca1')}
  res := res || jsonb_build_object('ca_changed', ca1 is distinct from ck1, 'ca_hex', ca1 ~ '^[0-9a-f]{32}$');
  ${asWho(5)} ${RS}
  ${T('wl', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'room_leave')))`)}
  cl1 := ${CK('rg')};
  ${RV('wl_rv', 'rg')} ${MSG('ml_old', 'ca1')} ${MSG('ml_new', 'cl1')}
  res := res || jsonb_build_object('cl_changed', cl1 is distinct from ca1 and cl1 is distinct from ck1, 'cl_hex', cl1 ~ '^[0-9a-f]{32}$');
  /* その後の書き（管 2）＝新しい名に1つ・古い2つの名には来ない */
  ${asWho(2)} ${RS}
  ${T('wz', `public.mj_write(rg, gen_random_uuid(), ${MA('丙')})`)}
  ${RV('wz_rv', 'rg')} ${MSG('mz_ck1', 'ck1')} ${MSG('mz_ca1', 'ca1')} ${MSG('mz_cl1', 'cl1')}
  ${T('rd2', `public.mj_read(rg, 'room', null)`)}
  res := res || jsonb_build_object('cl1_ok', (r -> 'room' ->> 'channel_key') = cl1);
  raise exception 'MJRESULT%', res::text;
end ${q('rt')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isOk = (r) => !!r && r.ok === true;
const eqv = (a, b) => J(a) === J(b);

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('部屋を作れた・入れた', isOk(o.made_g) && isOk(o.j2) && isOk(o.made_s), J([o.made_g, o.j2, o.made_s]).slice(0, 300));
  ok('作った時は合図0', eqv(o.m0, []), J(o.m0));
  ok('§3-1 ok の返しに read_ver（＝rooms.read_ver）', isOk(o.w1) && typeof o.w1.read_ver === 'number' && o.w1.read_ver === o.w1_rv, J([o.w1, o.w1_rv]));
  ok('§3-1 ok の組で合図1つ（v＝read_ver）', eqv(o.m1, [o.w1_rv]), J(o.m1));
  ok('§3-1 弾かれた組は合図0', o.wb && o.wb.ok === false && eqv(o.mb, o.m1), J([o.wb, o.mb]));
  ok('§3-1 送り直しは合図0（答えは同じ read_ver）', isOk(o.wr) && o.wr.read_ver === o.w1.read_ver && eqv(o.mr, o.m1), J([o.wr, o.mr]));
  ok('§3-1 mj_read の room に channel_key（今の名）', o.ck0_ok === true && o.ck1_ok === true, J([o.ck0_ok, o.ck1_ok]));
  ok('§3-1 room_secret は古い名と新しい名に1つずつ', isOk(o.ws) && o.ck_changed === true && eqv(o.ms_old, [...o.m1, o.ws_rv]) && eqv(o.ms_new, [o.ws_rv]), J([o.ws, o.ws_rv, o.ms_old, o.ms_new]));
  ok('§3-1 K-3 の継ぎで1つ＋その組の ok で1つ', isOk(o.wk) && eqv(o.mk, [o.ws_rv, o.k3_rv0 + 1, o.k3_rv]) && o.k3_rv === o.k3_rv0 + 2 && o.wk.read_ver === o.k3_rv, J([o.wk, o.k3_rv0, o.k3_rv, o.mk]));
  ok('§3-1 room_share は古い名と新しい名に1つずつ', isOk(o.wsh) && o.cs_changed === true && eqv(o.msh_old, [o.wsh_rv]) && eqv(o.msh_new, [o.wsh_rv]), J([o.wsh, o.wsh_rv, o.msh_old, o.msh_new]));
  ok('P1 4・5 が入れた', isOk(o.j4) && isOk(o.j5), J([o.j4, o.j5]));
  ok('P1 account_remove は channel_key を新しくする（32字の hex）', isOk(o.wa) && o.ca_changed === true && o.ca_hex === true, J([o.wa, o.ca_changed, o.ca_hex]));
  ok('P1 account_remove は古い名と新しい名に1つずつ', isOk(o.wa) && Array.isArray(o.ma_old) && o.ma_old[o.ma_old.length - 1] === o.wa_rv && eqv(o.ma_new, [o.wa_rv]), J([o.wa_rv, o.ma_old, o.ma_new]));
  ok('P1 room_leave は channel_key を新しくする（32字の hex）', isOk(o.wl) && o.cl_changed === true && o.cl_hex === true, J([o.wl, o.cl_changed, o.cl_hex]));
  ok('P1 room_leave は古い名と新しい名に1つずつ', isOk(o.wl) && eqv(o.ml_old, [o.wa_rv, o.wl_rv]) && eqv(o.ml_new, [o.wl_rv]), J([o.wl_rv, o.ml_old, o.ml_new]));
  ok('P1 その後の書きは今の名だけに来る（出した人・抜けた人の名に来ない）', isOk(o.wz) && eqv(o.mz_cl1, [o.wl_rv, o.wz_rv]) && eqv(o.mz_ca1, o.ml_old) && J(o.mz_ck1) === J(o.ma_old), J([o.wz_rv, o.mz_ck1, o.mz_ca1, o.mz_cl1]));
  ok('P1 残った人の mj_read は新しい名を返す', o.cl1_ok === true, J(o.cl1_ok));
  const pk = Object.keys(o).filter((k) => k.endsWith('_p') && Array.isArray(o[k]));
  const pbad = pk.filter((k) => !eqv(o[k], o[k.slice(0, -2)]));
  ok('P-e §1.1 鍵つき（private）にも公開と同じ合図が同じ順で来る（全部の名）', pk.length >= 15 && pbad.length === 0, pk.length + ' 本・違う=' + pbad.map((k) => k + J(o[k]) + '≠' + J(o[k.slice(0, -2)])).join(' '));
  return L;
}

const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
/* P1 の付け替えの行（schema.sql と同じ字＝無ければ brk が投げる） */
const P1A = "    update mahjong.rooms x set channel_key = pg_catalog.encode(extensions.gen_random_bytes(16), 'hex') where x.id = p_room;   -- P1 §3：出した人の名を捨てる（account_remove）\n";
const P1L = "    update mahjong.rooms x set channel_key = pg_catalog.encode(extensions.gen_random_bytes(16), 'hex') where x.id = p_room;   -- P1 §3：抜けた人の名を捨てる（room_leave）\n";
const SIG = { 'mahjong_private.mj_w_signal': '(text, bigint)', 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const WZ = [
  ['Z1 送りを外す', () => brk('mahjong_private.mj_w_signal', [["perform realtime.send(pg_catalog.jsonb_build_object('v', p_v), 'w', p_ch, false);", 'null;']]),
    ['§3-1 ok の組で合図1つ']],
  ['Z2 包みを外して無い関数を呼ぶ', () => brk('mahjong_private.mj_w_signal', [
    ["  begin\n    perform realtime.send(pg_catalog.jsonb_build_object('v', p_v), 'w', p_ch, false);\n  exception when others then\n    raise log 'mj_w_signal % %', sqlstate, sqlerrm;\n  end;",
      "  perform realtime.send_nai(pg_catalog.jsonb_build_object('v', p_v), 'w', p_ch, false);"]]),
    ['§3-1 ok の返しに read_ver']],
  ['Z3 古い名を外す', () => brk('public.mj_write', [['perform mahjong_private.mj_w_signal(v_ch0, v_rv);', 'perform mahjong_private.mj_w_signal(v_ch1, v_rv);']]),
    ['§3-1 room_secret は古い名と新しい名', '§3-1 room_share は古い名と新しい名']],
  ['Z4 account_remove の付け替えを外す', () => brk('mahjong_private.mj_w_op', [[P1A, '']]), ['P1 account_remove は channel_key']],
  ['Z5 room_leave の付け替えを外す', () => brk('mahjong_private.mj_w_op', [[P1L, '']]), ['P1 room_leave は channel_key']],
  ['Z6 鍵つきの送りを外す', () => brk('mahjong_private.mj_w_signal', [["perform realtime.send(pg_catalog.jsonb_build_object('v', p_v), 'w', p_ch, true);", 'null;']]),
    ['P-e §1.1 鍵つき']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋が残っていない', j && j.u === 0 && j.r === 0, text.slice(0, 200));
};

if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  await leftCheck();
  console.log(`\nrt: ${pass} passed, ${fail} failed`);
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
    for (const [name, mk, wants] of WZ) {
      const r = await runA(mk());
      const L = r.err ? null : check(r.out);
      const hit = L && L.filter(([n, c]) => !c && wants.some((w) => n.startsWith(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${r.err ? '塊が落ちた ' + r.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([n]) => n).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\nrt --waza: ${red}/${WZ.length} 狙いが赤になった`);
    process.exitCode = red === WZ.length && fail === 0 ? 0 : 1;
  }
}
