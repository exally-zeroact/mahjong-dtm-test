/* c4.live.mjs — ★C4 途中でルールを変える（table_rules・鎖・follow・正味の門を鎖ごと）を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め mahjong_tataki_2026-11-20/c4_sadame.md v3.3 §6：同じ場面を ①写し（lib/room-state.mjs の applyOps）と ②倉庫（mj_write）に1歩ずつ当て、
 *   歩ごとの答え（ok／err・at・i・kind・cur）と、場面の終わりの mj_read の st（next_table_id・split_same も）を比べる。期待の答えも歩ごとに書く。
 * 場面ごとに塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った歩が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/c4.live.mjs [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { emptyState, applyOps, canon } from '../lib/room-state.mjs';
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

async function mq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');
const J = (x) => String(JSON.stringify(x));   // undefined も字（出しの .slice で落ちない）
const U = () => crypto.randomUUID();
const MAIL = 'mj-c4.invalid';
const NB = 'c4' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
const jb = (x) => `${lit(J(x))}::jsonb`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
const NOW = '2026-11-22T12:00:00Z';
const LIBOPT = { direct: true, role: 'owner', now: NOW };

/* 写しと倉庫の st を揃える（read.live と同じ4つ） */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function norm(st0) {
  const st = JSON.parse(J(st0));
  delete st.rules;
  for (const t of st.tables || []) { if (t.rate_mode === 'session') delete t.rate_mode; delete t.created_at; }   // A20：created_at は倉庫の読みだけ
  for (const h of st.hanchans || []) delete h.created_at;
  st.extras = (st.extras || []).slice().sort((a, b) => cmp(a.table_id, b.table_id) || cmp(a.kind, b.kind) || cmp(a.member_id, b.member_id));
  for (const s of st.settles || []) delete s.at;
  return st;
}
function diff(a, b, p = '') {
  if (canon(a) === canon(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return ks.flatMap((k) => diff(a[k], b[k], p + '.' + k));
  }
  return [p + ' 写し=' + J(a) + ' 倉庫=' + J(b)];
}

/* ── 台（ルール・人・開催・卓 t1・半荘 h1・枚） ── */
const full = (r) => { const x = rulesOk(r); if (!x.ok) throw new Error('ルールが読めない ' + J(x)); return x.rules; };
const R1 = full({ players: 4, rate: 100, chip_pt10: 20, shugi_pt10: 10, uma: [30, 10, -10, -30], hakoshita: false });
const R2 = full({ ...R1, uma: [40, 20, -20, -40] });            // 鍵同じ（ウマだけ）
const RC = full({ ...R1, chip_pt10: 10 });                       // 鍵違い（チップ単価）
const M = [U(), U(), U(), U(), U(), U()];                        // M[4]＝h1 だけに座った代打ち・M[5]＝どこにも座らない人
const S1 = U(), T1 = U(), T2 = U(), T3 = U(), H1 = U(), H2 = U();
const SEAT4 = M.slice(0, 4);
const tr = (rules, id = T2, tid = T1) => ({ op: 'table_rules', table_id: tid, new_table_id: id, rules });
const ea = (m, add, extra = {}) => ({ op: 'extra_add', table_id: T1, member_id: M[m], kind: 'chip', add, ...extra });
const hs = (id, extra = {}) => ({ op: 'hanchan_start', hanchan_id: id, table_id: T1, seats: SEAT4, cells: [10000, 20000, 30000, 40000], ...extra });
const xv = (st, t, m) => (st.extras.find((e) => e.table_id === t && e.member_id === M[m] && e.kind === 'chip') || { version: 0 }).version;
const es = (t, m, value, bv) => ({ op: 'extra_set', table_id: t, member_id: M[m], kind: 'chip', value, base_version: bv });
const BASE_OPS = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '甲乙丙丁戊己'[i] })),
  { op: 'session_add', session_id: S1, date: '2026-11-22', rate: 100 },
  { op: 'table_add', table_id: T1, session_id: S1, label: '卓1' },
  { op: 'table_seats', table_id: T1, seats: SEAT4 },
  { op: 'hanchan_start', hanchan_id: H1, table_id: T1, seats: [M[4], M[1], M[2], M[3]], cells: [40000, 30000, 20000, 10000] },
  { op: 'extra_add', table_id: T1, member_id: M[4], kind: 'chip', add: 3 },
  { op: 'extra_add', table_id: T1, member_id: M[1], kind: 'chip', add: -3 },
];

/* 場面＝[名, 歩[[名, ops か (st)=>ops, 期待]] ]・期待は 'ok'／'err@at'（kind があれば 'bad@extras:chip'）・conflict は 'conflict' */
const SCENES = [
  ['S1 鍵同じ', [
    ['区切り（ウマだけ）', [tr(R2)], 'ok'],
    ['follow 無しの hanchan_start', [hs(H2)], 'bad@table_id'],
    ['follow 無しの extra_add', [ea(4, 1), ea(0, -1)], 'bad@table_id'],
    ['follow が真偽でない', [hs(H2, { follow: 1 })], 'bad@follow'],
    ['follow:true の hanchan_start は鎖の最後', [hs(H2, { follow: true })], 'ok'],
    ['§3a 代打ち M4 への extra_add（鎖の最後へ）', [ea(4, 1, { follow: true }), ea(0, -1, { follow: true })], 'ok'],
    ['§3a どこにも座らない M5 への足し', [ea(5, 1, { follow: true })], 'bad@member_id'],
    ['§3a 代打ち M4 への extra_set（T2）', (st) => [es(T2, 4, 2, xv(st, T2, 4)), es(T2, 0, 1, xv(st, T2, 0))], 'ok'],
    ['2回目の区切り', [tr(full({ ...R1, uma: [20, 10, -10, -20] }), T3)], 'conflict'],
    ['同じ new_table_id の送り直し', [tr(R2)], 'ok'],
  ]],
  ['S2 鍵違い・合計≠0', [
    ['合計を崩す', [ea(2, 2)], 'ok'],
    ['区切り（チップ単価）', [tr(RC)], 'bad@extras:chip'],
  ]],
  ['S3 鍵違い・合計0', [
    ['区切り（チップ単価）', [tr(RC)], 'ok'],
    ['遅れた extra_add（follow:true）', [ea(4, 1, { follow: true }), ea(1, -1, { follow: true })], 'bad@table_id'],
    ['hanchan_start（follow:true）は鎖の最後', [hs(H2, { follow: true })], 'ok'],
    ['§3b 前の卓への extra_set', (st) => [es(T1, 4, 1, xv(st, T1, 4)), es(T1, 1, -1, xv(st, T1, 1))], 'ok'],
    ['§3b 前の卓への extra_set の版違い', (st) => [es(T1, 4, 2, xv(st, T1, 4) + 5)], 'conflict'],
  ]],
  ['S4 rate none', [['rules.rate null', [tr(full({ ...R2, rate: null }))], 'ok']]],
  ['S5 rate num', [['rules.rate 50（開催日 100）', [tr(full({ ...R2, rate: 50 }))], 'ok']]],
  ['S6 T1 num の卓', [
    ['卓を num 50 に', [{ op: 'table_edit', table_id: T1, rate_mode: 'num', rate: 50 }], 'ok'],
    ['区切り（ウマだけ・rules.rate 100＝session）＝実際のレートが違う', [tr(R2)], 'ok'],
    ['移さなかった＝遅れた extra_add は bad', [ea(4, 1, { follow: true }), ea(1, -1, { follow: true })], 'bad@table_id'],
  ]],
  ['S7 取り消した半荘だけに座った人', [
    ['h1 を取り消す', [{ op: 'hanchan_void', hanchan_id: H1 }], 'ok'],
    ['区切り（鍵同じ）＝M4 の行も移る', [tr(R2)], 'ok'],
  ]],
  ['S9 A20 人数違いも区切れる（3人の続きの卓・席は []）', [['players 違い', [tr(full({ players: 3, rate: 100 }))], 'ok']]],
  ['S8 弾き', [
    ['同じ rules は区切らずに ok', [tr(R1)], 'ok'],
    ['new_table_id が UUID でない', [{ ...tr(R2), new_table_id: 'tx' }], 'bad@new_table_id'],
    ['取り消した卓', [{ op: 'table_edit', table_id: T1, voided: true }, tr(R2)], 'bad@table_id'],
  ]],
];

/* 写しを先に回す（歩ごとの ops を決める） */
const fmt = (r) => (!r ? '無し' : r.ok === true ? 'ok' : r.err === 'conflict' ? 'conflict' : r.err + '@' + (typeof r.at === 'object' ? J(r.at) : r.at) + (r.kind ? ':' + r.kind : ''));
const key = (r) => (!r ? null : r.ok === true ? 'ok' : canon({ err: r.err, at: r.at ?? null, i: r.i ?? null, kind: r.kind ?? null, cur: r.cur ?? null }));
const baseLib = applyOps((() => { const s = emptyState(); s.rules = R1; return s; })(), BASE_OPS, LIBOPT);
if (!baseLib.ok) { console.log('★中止★ 写しの台が当たらない ' + J(baseLib.res)); process.exit(1); }
const RUN = SCENES.map(([name, steps]) => {
  let st = baseLib.state;
  const out = [];
  for (const [sn, mk, want] of steps) {
    const ops = typeof mk === 'function' ? mk(st) : mk;
    const r = applyOps(st, ops, LIBOPT);
    out.push({ sn, ops, want, lib: r.ok ? { ok: true } : r.res });
    if (r.ok) st = r.state;
  }
  return { name, steps: out, libSt: st };
});

const mkSql = (prefix = '') => `do ${q('c4')} declare res jsonb := '{}'; r jsonb; i int; ra uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
  for i in 1..1 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u; insert into mahjong.accounts (user_id, human_at) select u, now() from unnest(us) u on conflict (user_id) do update set human_at = now(); -- P10 印
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 1) k;
  ${asWho(1)}
  ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R1)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
  ra := (r->>'room_id')::uuid;
  ${BASE_OPS.map((o, k) => `${RS} ${T('base' + k, `public.mj_write(ra, gen_random_uuid(), ${jb([o])})`)}`).join('\n  ')}
  ${RUN.map((s, a) => undo('s' + a, `${s.steps.map((x, b) => `${RS} ${T(`w${a}_${b}`, `public.mj_write(ra, gen_random_uuid(), ${jb(x.ops)})`)}`).join('\n    ')}
    ${T('rd' + a, `public.mj_read(ra, 'room', '{}'::jsonb)`)}`)).join('\n  ')}
  raise exception 'MJRESULT%', res::text;
end ${q('c4')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  BASE_OPS.forEach((x, k) => ok('台が倉庫に当たった：' + x.op + ' ' + k, o['base' + k] && o['base' + k].ok === true, J(o['base' + k]).slice(0, 300)));
  RUN.forEach((s, a) => {
    s.steps.forEach((x, b) => {
      const db = o[`w${a}_${b}`];
      ok(`${s.name} ${x.sn}：倉庫 ${fmt(db)}＝期待 ${x.want}`, fmt(db) === x.want, J(db).slice(0, 300));
      ok(`${s.name} ${x.sn}：写しと倉庫が同じ答え（err・at・i・kind・cur）`, key(db) === key(x.lib), '写し ' + J(x.lib) + ' 倉庫 ' + J(db).slice(0, 300));
    });
    const rd = o['rd' + a];
    const d = rd && rd.ok === true && rd.st ? diff(norm(s.libSt), norm(rd.st)) : ['読めない ' + J(rd).slice(0, 300)];
    ok(`${s.name} 終わりの st：写しと倉庫（mj_read）が同じ`, d.length === 0, d.slice(0, 6).join(' ／ '));
    if (rd && rd.st) {
      const t1 = rd.st.tables.find((t) => t.table_id === T1), t2 = rd.st.tables.find((t) => t.table_id === T2);
      if (s.name.startsWith('S1') || s.name.startsWith('S7')) ok(`${s.name} mj_read の T1 に next_table_id・split_same true・T2 には無い`, t1 && t1.next_table_id === T2 && t1.split_same === true && t2 && !('next_table_id' in t2) && !('split_same' in t2), J([t1, t2]).slice(0, 400));
      if (s.name.startsWith('S3') || s.name.startsWith('S6')) ok(`${s.name} mj_read の T1 は split_same false`, t1 && t1.next_table_id === T2 && t1.split_same === false, J(t1).slice(0, 300));
      if (s.name.startsWith('S1')) ok('S1 h2 は T2（鎖の最後）・枚は T2 に在り T1 に無い', rd.st.hanchans.find((h) => h.hanchan_id === H2)?.table_id === T2 && !rd.st.extras.some((e) => e.table_id === T1) && rd.st.extras.some((e) => e.table_id === T2 && e.member_id === M[4]), J(rd.st.extras).slice(0, 400));
      if (s.name.startsWith('S9')) ok('S9 A20 続きの卓は3人・席は []・T1 は4人のまま', t2 && t2.rules && t2.rules.players === 3 && J(t2.seats) === '[]' && t1 && t1.rules.players === 4, J([t1 && t1.rules && t1.rules.players, t2]).slice(0, 400));
      if (s.name.startsWith('S7')) ok('S7 取り消した半荘だけの M4 の行が T2 へ移った', rd.st.extras.some((e) => e.table_id === T2 && e.member_id === M[4] && e.value === 3), J(rd.st.extras).slice(0, 400));
    }
  });
  return L;
}

/* ── --waza（壊す関数は schema.sql から取り、字を置き換えて塊の頭で当てる） ── */
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
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
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const TF = 'mahjong_private.mj_w_tfollow', OP = 'mahjong_private.mj_w_op';
const WZ = [
  ['Z1 follow の印を見ない', () => brk(TF, [["and (p_o -> 'follow') is distinct from 'true'::jsonb then\n    perform mahjong_private.mj_w_bad(p_i, 'table_id');", "and false then\n    perform mahjong_private.mj_w_bad(p_i, 'table_id');"]]),
    ['S1 鍵同じ follow 無しの hanchan_start：倉庫']],
  ['Z2 鎖の最後へ運ばない', () => brk(TF, [['  return t;\nend $fn$;', '  return s;\nend $fn$;']]),   // P8 v4：最後でなく始めの卓を返す
    ['S1 鍵同じ 終わりの st', 'S1 h2 は T2']],
  ['Z3 鍵違いの区切りの後の extra_add を通す', () => brk(TF, [["if p_op = 'extra_add' and exists (", 'if false and exists (']]),   // P8 v4 §1-3 c の鍵違い
    ['S3 鍵違い・合計0 遅れた extra_add（follow:true）：倉庫']],
  ['Z4 合計0の門を外す', () => brk(OP, [['group by e.kind having pg_catalog.sum(e.value) <> 0', 'group by e.kind having false']]),
    ['S2 鍵違い・合計≠0 区切り（チップ単価）：倉庫']],
  ['Z5 2回目の区切りの conflict を外す', () => brk(OP, [["if t.next_table_id is not null then\n      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict'", "if false then\n      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict'"]]),
    ['S1 鍵同じ 2回目の区切り：倉庫']],
  ['Z6 rate を rules.rate で比べる', () => brk(OP, [["v_b := (case t.rate_mode when 'num' then t.rate when 'none' then null else v_ss.rate end)", "v_b := ((v_j ->> 'rate')::int)"]]),
    ['S6 T1 num の卓 移さなかった＝遅れた extra_add は bad：倉庫', 'S6 T1 num の卓 mj_read の T1 は split_same false']],
  ['Z7 正味の門を卓ごと（行の卓だけ）に戻す', () => brk('public.mj_write', [
    ['where x.table_id = any (v_ch) and not x.voided', 'where x.table_id = v_ch[pg_catalog.array_length(v_ch, 1)] and not x.voided'],
    ['where y.id = any (v_ch) and s.value = e.m)', 'where y.id = v_ch[pg_catalog.array_length(v_ch, 1)] and s.value = e.m)']]),
    ['S1 鍵同じ §3a 代打ち M4 への extra_add（鎖の最後へ）：倉庫']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋が残っていない', j && j.u === 0 && j.r === 0, text.slice(0, 200));
};

if (process.env.C4_DBG) {
  const a = await runA(brk('public.mj_write', [["v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal');", "v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal', 'why', sqlstate || ' ' || sqlerrm);"]]));
  console.log(a.err || J(a.out.base0) + ' ' + J(a.out.made));
} else if (!WAZA) {
  const a = await runA('');
  if (a.err) say('塊が回った', false, a.err);
  else for (const [n, c, info] of check(a.out)) say(n, c, info);
  await leftCheck();
  console.log(`\nc4: ${pass} passed, ${fail} failed`);
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
    console.log(`\nc4 --waza: ${red}/${WZ.length} 狙いが赤になった`);
    process.exitCode = red === WZ.length && fail === 0 ? 0 : 1;
  }
}
