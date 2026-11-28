/* rt-hon.live.mjs — ★2c-2f 本物の1本（定め mahjong_tataki_2026-11-20/2c2f_sadame.md v1.2 §3-2）★
 * =============================================================================
 * 本物のテスト倉庫（khaw だけ・read.live:25-27 と同じ門）に捨てアカウント2人（admin で作る・メールは送らない）→ 本物のセッションで
 * A が部屋を作り B が名前＋パスで入る → 2人とも合図（channel_key・公開）に入る →
 *   本道：A が mj_write → ok の read_ver を A の管で送る → B が受けて mj_read を読み終えるまで（20回・★最大 800ms 未満が門★）
 *   控え：A は送らない（倉庫の realtime.send だけ）→ B が受けて読み終えるまで（5回・並べるだけ）
 * 試しの人・部屋・数え・合図の行は finally で消して残り0を数える（本番の倉庫には何も作らない＝門で止まる）。
 * supabase-js は repo に無い＝PW_FROM（例 C:/Users/zeroa/Exally-test/package.json）から借りる。
 * 使い方: PW_FROM=<package.json> node tests/rt-hon.live.mjs [--waza]（--waza＝B が合図で読まない＝合図の道が死ぬと門が赤になるかを見る。11-22 測り：倉庫の送りだけでも 150ms 前後で届く＝端末の送りを外すだけでは赤にならない）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const url = /url:\s*'([^']+)'/.exec(src)[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1];
const anonKey = /key:\s*'([^']+)'/.exec(src)[1];
if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2' || !/env:\s*'test'/.test(src)) {
  console.log('★中止★ 倉庫が khaw（test）でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1);
}
if (!process.env.PW_FROM) { console.log('★中止★ PW_FROM（supabase-js を借りる package.json）が無い'); process.exit(1); }
const { createClient } = createRequire(process.env.PW_FROM)('@supabase/supabase-js');
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
const WAZA = process.argv.includes('--waza');
const N = 20, NB = 5, GATE = 800;

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* 字 */ }
  return { status: r.status, text: t, j };
}
const lit = (s) => '$v$' + s + '$v$';
const J = (x) => JSON.stringify(x);
const MAIL = 'mj-rthon.invalid';
const RNAME = 'rh' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 600) : '')); } };

const ks = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
const srv = (Array.isArray(ks) ? ks : []).find((k) => k.name === 'service_role')?.api_key;
const AU = (pth, o = {}, key = anonKey) => fetch(`${url}/auth/v1${pth}`, { ...o, headers: { apikey: key, 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

const who = [];
let room = null, ck = null;
const clients = [];
try {
  if (!srv) throw new Error('service_role の鍵が引けない');
  const sb = [];
  for (let i = 0; i < 2; i++) {
    const email = `mjrt-${crypto.randomBytes(4).toString('hex')}@${MAIL}`;
    const pw = 'Pw-' + crypto.randomBytes(12).toString('hex');
    const cu = await AU('/admin/users', { method: 'POST', headers: { Authorization: `Bearer ${srv}` }, body: J({ email, password: pw, email_confirm: true }) }, srv);
    const id = cu.j?.id || cu.j?.user?.id || null;
    if (!id) throw new Error('捨てアカウントが作れない ' + cu.s);
    who.push(id);
    const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const li = await c.auth.signInWithPassword({ email, password: pw });
    if (li.error) throw new Error('パスワードで入れない ' + li.error.message);
    await c.realtime.setAuth(li.data.session.access_token);
    sb.push(c); clients.push(c);
  }
  ok('捨てアカウント2人を作って本物のセッションで入れた', true);
  // P10（p10_sadame v1.1 §5）：捨てアカウントに人の確かめの印（無いと作る・入る・書くが err human）
  await mq(`insert into mahjong.accounts (user_id, human_at) select x::uuid, now() from unnest(array[${who.map((x) => `'${x}'`).join(', ')}]) x on conflict (user_id) do update set human_at = now(); select 1 as k`);
  const [A, B] = sb;
  const cr = await A.rpc('mj_room_create', { p_op_id: crypto.randomUUID(), p_name: RNAME, p_pass: PASS, p_rules: { players: 4 }, p_secrets: { url_token_hash: crypto.randomBytes(32).toString('hex') } });
  room = cr.data?.room_id || null; ck = cr.data?.channel_key || null;
  ok('A が部屋を作れた（channel_key が返る）', !!room && !!ck, J(cr.data ?? cr.error));
  if (!room || !ck) throw new Error('部屋が無い＝ここで止める');
  const jn = await B.rpc('mj_room_join', { p_way: 'name', p_room_no: null, p_key: null, p_pass: PASS, p_name: RNAME });
  ok('B が名前＋パスで入れた（同じ channel_key）', jn.data?.ok === true && jn.data?.channel_key === ck, J(jn.data ?? jn.error));
  const r0 = await B.rpc('mj_read', { p_room_id: room, p_what: 'room', p_args: null });
  ok('B の mj_read の room.channel_key が同じ', r0.data?.room?.channel_key === ck, J(r0.data).slice(0, 200));
  let since = r0.data?.read_ver ?? null;

  // B：合図を受けたら v>since の時だけ読む（読み中なら読み終わりにもう1回）＝画面の sync と同じ形
  let lane = false, again = false, want = null;
  const doRead = async () => {
    if (lane) { again = true; return; }
    lane = true;
    do {
      again = false;
      const r = await B.rpc('mj_read', { p_room_id: room, p_what: 'room', p_args: since == null ? null : { since } });
      if (r.data?.ok && typeof r.data.read_ver === 'number') since = r.data.read_ver;
      if (want && since >= want.v) { want.res(performance.now()); want = null; }
    } while (again);
    lane = false;
  };
  const sub = (c, cb) => new Promise((res, rej) => {
    const ch = c.channel(ck, { config: { private: false, broadcast: { self: false } } });
    if (cb) ch.on('broadcast', { event: 'w' }, cb);
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') res(ch); else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') rej(new Error(s)); });
  });
  await sub(B, (m) => { if (WAZA) return; const v = m?.payload?.v; if (typeof v === 'number' && (since == null || v > since)) doRead(); });
  const chA = await sub(A, null);
  ok('2人とも合図に入れた（SUBSCRIBED）', true);

  const one = async (sendIt) => {
    const t0 = performance.now();
    const w = await A.rpc('mj_write', { p_room_id: room, p_op_id: crypto.randomUUID(), p_ops: [{ op: 'member_add', member_id: crypto.randomUUID(), name: '人' + crypto.randomBytes(2).toString('hex') }] });
    const rv = w.data?.read_ver;
    if (!(w.data?.ok === true && typeof rv === 'number')) return { err: J(w.data ?? w.error) };
    const got = new Promise((res) => { want = { v: rv, res }; });
    if (sendIt) chA.send({ type: 'broadcast', event: 'w', payload: { v: rv } });
    const t1 = await Promise.race([got, sleep(5000).then(() => null)]);
    want = null;
    return { ms: t1 == null ? 9999 : Math.round(t1 - t0), wms: 0 };
  };
  await sleep(300);
  const main = [], bak = [];
  for (let i = 0; i < N; i++) { const r = await one(true); main.push(r.err ? 9999 : r.ms); if (r.err) console.log('    書けない ' + r.err); await sleep(250); }
  for (let i = 0; i < NB; i++) { const r = await one(false); bak.push(r.err ? 9999 : r.ms); await sleep(250); }
  const mx = Math.max(...main);
  console.log(`    （本道 ${N}回 ms：${main.join(',')}・最大 ${mx}・真ん中 ${main.slice().sort((a, b) => a - b)[N >> 1]}）`);
  console.log(`    （控え＝倉庫の送りだけ ${NB}回 ms：${bak.join(',')}）`);
  if (!WAZA) ok(`§3-2 本道：A の書き→B が読み終えるまで ${N}回の最大が ${GATE}ms 未満`, mx < GATE, `最大 ${mx}`);
  else ok(`--waza：B が合図で読まないと ${GATE}ms の門が赤になる（門が空振りしない）`, !(mx < GATE), `最大 ${mx}`);
  if (!WAZA) ok('§3-2 控え（倉庫の送りだけ）でも5回とも届く（9999 が無い）', !bak.includes(9999), bak.join(','));
} catch (e) {
  ok('回った', false, String(e.message || e));
} finally {
  for (const c of clients) { try { await c.removeAllChannels(); } catch (_) { /* 次 */ } }
  try {
    const u = who.map((x) => `'${x}'`).join(', ') || 'null';
    const r = await mq(`with d as (delete from mahjong.rooms where owner_user_id in (${u}) or name = ${lit(RNAME)} returning kind, closed_at)
      update mahjong.totals set rooms_all = greatest(rooms_all - (select count(*) from d where kind = 'shared' and closed_at is null), 0) where id = 1;
      delete from mahjong.creates where user_id in (${u});
      delete from mahjong.limits where key in (${u}, ${room ? `'${room}'` : 'null'}, mahjong_private.mj_name_key(${lit(RNAME)})) or kind like 'write:%';
      ${ck ? `delete from realtime.messages where topic = ${lit(ck)};` : ''}
      delete from auth.users where id in (${u}); select 1 as k`);
    if (r.status >= 300) console.log('  ✗ 片付けが落ちた — ' + r.text.slice(0, 300));
  } catch (e) { console.log('  ✗ 片付けが落ちた — ' + String(e.message).slice(0, 300)); }
  const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name = ${lit(RNAME)}) as r,
    (select count(*)::int from mahjong.accounts a left join auth.users x on x.id = a.user_id where x.id is null) as orphan
    ${ck ? `, (select count(*)::int from realtime.messages where topic = ${lit(ck)}) as m` : ''}`);
  const left = lf.j?.[0];
  ok('倉庫に試しの人・部屋・合図の行が残っていない', left && left.u === 0 && left.r === 0 && left.orphan === 0 && (left.m ?? 0) === 0, lf.text.slice(0, 200));
}
console.log(`\nrt-hon${WAZA ? ' --waza' : ''}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
