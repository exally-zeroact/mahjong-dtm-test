/* pe-rt.live.mjs — ★P-e 合図は倉庫だけが送る・部屋の人だけが鍵つき（private）で受ける（定め mahjong_tataki_2026-11-20/pe_sadame.md v1.1 §2）★
 * =============================================================================
 * 本物のテスト倉庫（khaw だけ・rt-hon.live と同じ門）に捨てアカウント4人（admin で作る・メールは送らない）→ 本物のセッションで
 *   A が部屋を作り B・D が名前＋パスで入る（C は入らない）→
 *   1 B は鍵つきに入れる（SUBSCRIBED）／C（部屋の人でない）は鍵つきに入れない
 *   2 倉庫の書き（A の mj_write）→ B が鍵つきで {v}＝read_ver を受ける・20回の書き→B が読み終えるまでの最大 < 800ms（倉庫の送りだけ・T2）
 *   3 A（部屋の人）が鍵つきで送る → B に届かない（insert の決まりが無い）
 *   4 A が同じ名の公開に {v: 大} を送る → 鍵つきの B に届かない（別の合図）
 *   5 A が D を出す（account_remove）→ D は新しい名でも古い名でも鍵つきに入れない（room_bans）・B は新しい名に入り直せる
 *   6 A が部屋を消す（room_delete）→ B は鍵つきに入れない → room_undelete → B はまた入れる
 * 試しの人・部屋・数え・合図の行は finally で消して残り0を数える（本番の倉庫には何も作らない＝門で止まる）。
 * --waza：khaw に一時の決まり（insert 誰でも・select 誰でも）を足して 1 の C と 3 が赤になるかを見る（finally で外し、外れたことを数える）。
 * supabase-js は repo に無い＝PW_FROM（例 C:/Users/zeroa/Exally-test/package.json）から借りる。
 * 使い方: PW_FROM=<package.json> node tests/pe-rt.live.mjs [--waza]
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
const N = 20, GATE = 800, QUIET = 1500;

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* 字 */ }
  return { status: r.status, text: t, j };
}
const lit = (s) => '$v$' + s + '$v$';
const J = (x) => JSON.stringify(x);
const MAIL = 'mj-pert.invalid';
const RNAME = 'pe' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WZ_POL = ['mj_rt_waza_i', 'mj_rt_waza_s'];

let pass = 0, fail = 0;
const ok = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 600) : '')); } };
/* --waza の狙い＝この名の行が赤になるか（赤＝門が効いている証） */
const aim = {};
const ok2 = (key, name, c, info) => { aim[key] = !!c; if (!WAZA) ok(name, c, info); else console.log(`    （${key} ${c ? '緑' : '赤'}：${name}）`); };

const ks = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
const srv = (Array.isArray(ks) ? ks : []).find((k) => k.name === 'service_role')?.api_key;
const AU = (pth, o = {}, key = anonKey) => fetch(`${url}/auth/v1${pth}`, { ...o, headers: { apikey: key, 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

/* 合図に入る：SUBSCRIBED／CHANNEL_ERROR／TIMED_OUT／none（6秒で何も来ない） */
const join = (c, topic, priv, cb) => new Promise((res) => {
  const ch = c.channel(topic, { config: { private: priv, broadcast: { self: false } } });
  if (cb) ch.on('broadcast', { event: 'w' }, cb);
  let done = false;
  const fin = (s) => { if (done) return; done = true; res({ s, ch }); };
  ch.subscribe((s) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') fin(s); });
  setTimeout(() => fin('none'), 6000);
});
const leave = async (c, ch) => { try { await c.removeChannel(ch); } catch (_) { /* 次 */ } };
const W = (c, room, ops) => c.rpc('mj_write', { p_room_id: room, p_op_id: crypto.randomUUID(), p_ops: ops });
const MA = () => [{ op: 'member_add', member_id: crypto.randomUUID(), name: '人' + crypto.randomBytes(2).toString('hex') }];

const who = [];
let room = null, ck = null, ck2 = null;
const clients = [];
try {
  if (!srv) throw new Error('service_role の鍵が引けない');
  const sb = [];
  for (let i = 0; i < 4; i++) {
    const email = `mjpe-${crypto.randomBytes(4).toString('hex')}@${MAIL}`;
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
  await mq(`insert into mahjong.accounts (user_id, human_at) select x::uuid, now() from unnest(array[${who.map((x) => `'${x}'`).join(', ')}]) x on conflict (user_id) do update set human_at = now(); select 1 as k`);
  const [A, B, C, D] = sb;
  const cr = await A.rpc('mj_room_create', { p_op_id: crypto.randomUUID(), p_name: RNAME, p_pass: PASS, p_rules: { players: 4 }, p_secrets: { url_token_hash: crypto.randomBytes(32).toString('hex') } });
  room = cr.data?.room_id || null; ck = cr.data?.channel_key || null;
  if (!room || !ck) throw new Error('部屋が作れない ' + J(cr.data ?? cr.error));
  const jb = await B.rpc('mj_room_join', { p_way: 'name', p_room_no: null, p_key: null, p_pass: PASS, p_name: RNAME });
  const jd = await D.rpc('mj_room_join', { p_way: 'name', p_room_no: null, p_key: null, p_pass: PASS, p_name: RNAME });
  ok('捨てアカウント4人・A が部屋を作り B・D が入れた', jb.data?.ok === true && jd.data?.ok === true, J([jb.data ?? jb.error, jd.data ?? jd.error]));
  if (WAZA) {
    const r = await mq(`create policy mj_rt_waza_i on realtime.messages for insert to authenticated with check (true);
      create policy mj_rt_waza_s on realtime.messages for select to authenticated using (true); select 1 as k`);
    if (r.status >= 300) throw new Error('--waza の決まりが足せない ' + r.text.slice(0, 200));
  }

  // B：鍵つきで受けた {v} を並べ、v>since の時だけ読む（画面の sync と同じ形）
  const r0 = await B.rpc('mj_read', { p_room_id: room, p_what: 'room', p_args: null });
  let since = r0.data?.read_ver ?? null;
  const got = [];
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
  const onB = (m) => { const v = m?.payload?.v; got.push(v); if (typeof v === 'number' && (since == null || v > since)) doRead(); };

  // 1
  const jB = await join(B, ck, true, onB);
  ok('1 B（部屋の人）は鍵つきに入れる', jB.s === 'SUBSCRIBED', jB.s);
  const jC = await join(C, ck, true, null);
  ok2('c', '1 C（部屋の人でない）は鍵つきに入れない', jC.s !== 'SUBSCRIBED', jC.s);
  await leave(C, jC.ch);
  if (jB.s !== 'SUBSCRIBED') throw new Error('B が入れない＝ここで止める');
  await sleep(300);

  // 2
  const ms = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const w = await W(A, room, MA());
    const rv = w.data?.read_ver;
    if (!(w.data?.ok === true && typeof rv === 'number')) { ms.push(9999); console.log('    書けない ' + J(w.data ?? w.error)); continue; }
    const p = new Promise((res) => { want = { v: rv, res }; });
    const t1 = await Promise.race([p, sleep(5000).then(() => null)]);
    want = null;
    ms.push(t1 == null ? 9999 : Math.round(t1 - t0));
    await sleep(250);
  }
  const mx = Math.max(...ms);
  console.log(`    （倉庫の送りだけ・鍵つき ${N}回 ms：${ms.join(',')}・最大 ${mx}・真ん中 ${ms.slice().sort((a, b) => a - b)[N >> 1]}）`);
  ok(`2 倉庫の書き→B が鍵つきで受けて読み終えるまで ${N}回の最大が ${GATE}ms 未満`, mx < GATE, `最大 ${mx}`);
  ok('2 B が受けた v は全部 read_ver の数（偽が混ざっていない）', got.length >= N && got.every((v) => typeof v === 'number' && v <= since), J(got).slice(0, 300));

  // 3（A も鍵つきに入り、送る）
  const jA = await join(A, ck, true, null);
  ok('3 A（持ち主）も鍵つきに入れる', jA.s === 'SUBSCRIBED', jA.s);
  const FAKE = 9e15;
  let n0 = got.length;
  const s3 = await jA.ch.send({ type: 'broadcast', event: 'w', payload: { v: FAKE } });
  await sleep(QUIET);
  ok2('s', '3 A が鍵つきで送った {v} は B に届かない（insert の決まりが無い）', !got.slice(n0).includes(FAKE), 'send=' + s3 + ' 届いた=' + J(got.slice(n0)));

  // 4（同じ名の公開に送る）。同じ端末の同じ名は supabase-js が前の合図を返す＝鍵つきを抜けてから公開に入る
  await leave(A, jA.ch);
  const jAp = await join(A, ck, false, null);
  n0 = got.length;
  const s4 = await jAp.ch.send({ type: 'broadcast', event: 'w', payload: { v: FAKE + 1 } });
  await sleep(QUIET);
  ok('4 同じ名の公開に送った {v} は鍵つきの B に届かない', jAp.s === 'SUBSCRIBED' && !got.slice(n0).includes(FAKE + 1), jAp.s + ' send=' + s4 + ' 届いた=' + J(got.slice(n0)));
  await leave(A, jAp.ch);

  // 5（D を出す）
  const wr = await W(A, room, [{ op: 'account_remove', user_id: who[3] }]);
  const r1 = await B.rpc('mj_read', { p_room_id: room, p_what: 'room', p_args: null });
  ck2 = r1.data?.room?.channel_key || null;
  ok('5 A が D を出せた・名が変わった', wr.data?.ok === true && !!ck2 && ck2 !== ck, J([wr.data ?? wr.error, !!ck2]));
  const jDo = await join(D, ck, true, null); await leave(D, jDo.ch);
  const jDn = await join(D, ck2 || 'x', true, null); await leave(D, jDn.ch);
  ok2('d', '5 出された D は古い名にも新しい名にも鍵つきで入れない', jDo.s !== 'SUBSCRIBED' && jDn.s !== 'SUBSCRIBED', jDo.s + ' / ' + jDn.s);
  await leave(B, jB.ch);
  const jB2 = await join(B, ck2 || 'x', true, onB);
  ok('5 残った B は新しい名に鍵つきで入れる', jB2.s === 'SUBSCRIBED', jB2.s);
  await leave(B, jB2.ch);

  // 6（消す・戻す）
  const wd = await W(A, room, [{ op: 'room_delete' }]);
  const jB3 = await join(B, ck2 || 'x', true, null); await leave(B, jB3.ch);
  ok2('x', '6 消した部屋（7日の取り消し待ち）は鍵つきに入れない', wd.data?.ok === true && jB3.s !== 'SUBSCRIBED', J(wd.data ?? wd.error) + ' ' + jB3.s);
  const wu = await W(A, room, [{ op: 'room_undelete' }]);
  const r2 = await B.rpc('mj_read', { p_room_id: room, p_what: 'room', p_args: null });
  const ck3 = r2.data?.room?.channel_key || ck2;
  const jB4 = await join(B, ck3 || 'x', true, null); await leave(B, jB4.ch);
  ok('6 room_undelete の後は B がまた鍵つきに入れる', wu.data?.ok === true && jB4.s === 'SUBSCRIBED', J(wu.data ?? wu.error) + ' ' + jB4.s);

  if (WAZA) {
    const red = ['c', 's'].filter((k) => aim[k] === false);
    ok('--waza：誰でも送れる・誰でも受ける決まりを足すと 1 の C と 3 が赤になる（門が空振りしない）', red.length === 2, '赤=' + red.join(','));
  }
} catch (e) {
  ok('回った', false, String(e.message || e));
} finally {
  for (const c of clients) { try { await c.removeAllChannels(); } catch (_) { /* 次 */ } }
  if (WAZA) { try { await mq(WZ_POL.map((p) => `drop policy if exists ${p} on realtime.messages;`).join(' ') + ' select 1 as k'); } catch (_) { /* 下で数える */ } }
  try {
    const u = who.map((x) => `'${x}'`).join(', ') || 'null';
    const tp = [ck, ck2].filter(Boolean).map(lit).join(', ');
    const r = await mq(`with d as (delete from mahjong.rooms where owner_user_id in (${u}) or name = ${lit(RNAME)} returning kind, closed_at, deleted_at)
      update mahjong.totals set rooms_all = greatest(rooms_all - (select count(*) from d where kind = 'shared' and closed_at is null and deleted_at is null), 0) where id = 1;
      delete from mahjong.creates where user_id in (${u});
      delete from mahjong.limits where key in (${u}, ${room ? `'${room}'` : 'null'}, mahjong_private.mj_name_key(${lit(RNAME)})) or kind like 'write:%';
      ${tp ? `delete from realtime.messages where topic in (${tp});` : ''}
      delete from auth.users where id in (${u}); select 1 as k`);
    if (r.status >= 300) console.log('  ✗ 片付けが落ちた — ' + r.text.slice(0, 300));
  } catch (e) { console.log('  ✗ 片付けが落ちた — ' + String(e.message).slice(0, 300)); }
  const tp = [ck, ck2].filter(Boolean).map(lit).join(', ');
  const lf = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u,
    (select count(*)::int from mahjong.rooms where name = ${lit(RNAME)}) as r,
    (select count(*)::int from mahjong.accounts a left join auth.users x on x.id = a.user_id where x.id is null) as orphan,
    (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'mj_rt_waza%') as wz
    ${tp ? `, (select count(*)::int from realtime.messages where topic in (${tp})) as m` : ''}`);
  const left = lf.j?.[0];
  ok('倉庫に試しの人・部屋・合図の行・一時の決まりが残っていない', left && left.u === 0 && left.r === 0 && left.orphan === 0 && left.wz === 0 && (left.m ?? 0) === 0, lf.text.slice(0, 200));
}
console.log(`\npe-rt${WAZA ? ' --waza' : ''}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
