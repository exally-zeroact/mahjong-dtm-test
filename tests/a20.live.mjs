/* a20.live.mjs — ★A20 途中のルール変更で人数も替える・follow:false は押した時の卓へ・late を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め mahjong-wt-keisan/tataki/a20_sadame_v4.md §6 の live 試験＝§5 (a)(d)(f)(g)(g2)(i)＋account_rules の行が新しい人数。
 *   場面ごとに部屋を作り、同じ歩を ①写し（lib/room-state.mjs の applyOps）と ②倉庫（mj_write）に当てて、歩ごとの答えと終わりの mj_read の st を比べる。
 *   終わりの mj_read の st に lib の sessionSeisan・chainView を掛けて、room-state.test の A20 と同じ★手で出した値★になるかを見る（created_at は倉庫の読みの物）。
 * 場面ごとに塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った歩が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/a20.live.mjs [--waza]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { emptyState, applyOps, canon, chainView, sessionSeisan } from '../lib/room-state.mjs';
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
const MAIL = 'mj-a20.invalid';
const NB = 'a20' + crypto.randomBytes(3).toString('hex');
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
const LIBOPT = { direct: true, role: 'owner', now: '2026-11-27T12:00:00Z' };

/* 写しと倉庫の st を揃える（c4.live と同じ＋A20 の created_at は倉庫の読みだけに在る＝比べる前に落とす） */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function norm(st0) {
  const st = JSON.parse(J(st0));
  delete st.rules;
  for (const t of st.tables || []) { if (t.rate_mode === 'session') delete t.rate_mode; delete t.created_at; }
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

/* ── 台（room-state.test の A20 と同じルールと点） ── */
const full = (r) => { const x = rulesOk(r); if (!x.ok) throw new Error('ルールが読めない ' + J(x)); return x.rules; };
const R4 = full({ ...defaultRules(4), rate: 100, chip_pt10: 20, shugi_pt10: 10, hakoshita: false, round: 'gosha' });
const R3 = full({ ...defaultRules(3), rate: 100, chip_pt10: 20, shugi_pt10: 10, hakoshita: false, round: 'gosha' });
const U30 = full({ ...R4, uma: [30, 10, -10, -30] }), U40 = full({ ...R4, uma: [40, 20, -20, -40] });
const I30 = full({ ...U30, start_pts: 30000 });
const M = [U(), U(), U(), U()];
const S1 = U(), T1 = U(), T2 = U(), H1 = U(), H2 = U(), H3 = U(), H4 = U(), H9 = U();
const SEATS = M.slice();
const tr = (R) => ({ op: 'table_rules', table_id: T1, new_table_id: T2, rules: R });
const hs = (id, seats, cells, extra = {}, tid = T1) => ({ op: 'hanchan_start', hanchan_id: id, table_id: tid, seats, cells, ...extra });
const base = (hans) => [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '山田鈴木佐藤高橋'.slice(i * 2, i * 2 + 2) })),
  { op: 'session_add', session_id: S1, date: '2026-11-20', rate: 100 },
  { op: 'table_add', table_id: T1, session_id: S1, label: '卓1' },
  { op: 'table_seats', table_id: T1, seats: SEATS },
  ...hans,
];
const C4321 = [40000, 30000, 20000, 10000];
const ten = (st) => { const s = sessionSeisan(st, S1); return s.ok ? J(M.map((m) => s.ten[m] ?? null)) : 'ng:' + J(s.err ?? s); };
const tb = (st, id) => (st.tables || []).find((t) => t.table_id === id);
const hh = (st, id) => (st.hanchans || []).find((h) => h.hanchan_id === id);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* 場面＝{ name, R（部屋のルール）, base, steps[[名, ops, 期待]], ends(st, o)＝[[名, 真偽, 字]] }・期待は 'ok'／'err@at'・conflict は 'conflict' */
const SCENES = [
  { name: 'A 4人→3人（(a)(d)(g)(g2)）', R: R4, base: base([hs(H1, SEATS, C4321), hs(H2, SEATS, C4321)]),
    steps: [
      ['4人→3人の table_rules', [tr(R3)], 'ok'],
      ['(g) follow:true の4人の回は続きの卓へ運ばれ bad at seats', [hs(H9, SEATS, C4321, { follow: true })], 'bad@seats'],
      ['(g2) follow の鍵が無い hanchan_start', [hs(H9, SEATS, C4321)], 'bad@table_id'],
      ['(g2) follow:null の hanchan_start', [hs(H9, SEATS, C4321, { follow: null })], 'bad@follow'],
      ['(g2) follow:false の extra_add', [{ op: 'extra_add', table_id: T1, member_id: M[0], kind: 'chip', add: 1, follow: false }], 'bad@table_id'],
      ['(a) 3人で2回（follow:true）', [hs(H3, [M[0], M[1], M[2]], [50000, 35000, 20000], { follow: true }), hs(H4, [M[2], M[1], M[0]], [50000, 35000, 20000], { follow: true })], 'ok'],
    ],
    ends: (st, o) => [
      ['(d) 人数を替えた続きの卓：rules.players 3・seats []', tb(st, T2)?.rules?.players === 3 && J(tb(st, T2)?.seats) === '[]', J(tb(st, T2)).slice(0, 300)],
      ['(a) h1・h2 は T1（4人）・h3・h4 は T2（3人）', hh(st, H1)?.table_id === T1 && hh(st, H2)?.table_id === T1 && hh(st, H3)?.table_id === T2 && hh(st, H4)?.table_id === T2 && hh(st, H3)?.cells?.length === 3, J((st.hanchans || []).map((h) => [h.table_id === T1 ? 'T1' : 'T2', h.cells.length]))],
      ['(a) 精算＝ m1 10500・m2 1000・m3 -3500・m4 -8000（手で出した値）', ten(st) === J([10500, 1000, -3500, -8000]), ten(st)],
      ['A14 覚え：書いた人の行が3人（R3）・4人の行は部屋を作った時の R4 のまま', o.mem && o.mem.p3 && canon(o.mem.p3) === canon(R3) && o.mem.p4 && canon(o.mem.p4) === canon(R4), J(o.mem).slice(0, 300)],
    ] },
  { name: 'F ウマだけ替えて follow:false（(f)(d)）', R: U30, base: base([hs(H1, SEATS, C4321)]),
    steps: [
      ['区切り（ウマ 30/10→40/20）', [tr(U40)], 'ok'],
      ['(f) 区切りの後に follow:false で前の卓へ', [hs(H2, SEATS, [10000, 20000, 30000, 40000], { follow: false })], 'ok'],
    ],
    ends: (st) => {
      const cv = chainView(st, T1);
      return [
        ['(d) 人数が同じ区切りは seats を写す', J(tb(st, T2)?.seats) === J(SEATS), J(tb(st, T2)?.seats)],
        ['(f) h2 は前の卓 T1 に入った', hh(st, H2)?.table_id === T1, J(hh(st, H2)).slice(0, 200)],
        ['(f) 前のウマで数える＝ m1 1000・m2 -1000・m3 -1000・m4 1000', ten(st) === J([1000, -1000, -1000, 1000]), ten(st)],
        ['(f) k が1増える（splits.upto 2）', cv && cv.splits.length === 1 && cv.splits[0].upto === 2, cv && J(cv.splits)],
        ['(f) late は倉庫の created_at で h1 false・h2 true', cv && J(cv.rows.map((r) => [r.hanchan_id, r.late])) === J([[H1, false], [H2, true]]), cv && J(cv.rows.map((r) => r.late))],
        ['§6 mj_read の卓と回の created_at は UTC ミリ秒の ISO', [...st.tables, ...st.hanchans].every((x) => ISO.test(x.created_at)), J([...st.tables, ...st.hanchans].map((x) => x.created_at))],
      ];
    } },
  { name: 'I 持ち点だけ替えて前の合計の回（(i)）', R: U30, base: base([hs(H1, SEATS, C4321)]),
    steps: [
      ['区切り（持ち点 25000→30000）', [tr(I30)], 'ok'],
      ['(i) 前の持ち点の合計の回を新しい卓へ（follow:true）＝入る', [hs(H2, SEATS, C4321, { follow: true })], 'ok'],
    ],
    ends: (st) => {
      const cv = chainView(st, T1);
      const s = sessionSeisan(st, S1);
      return [
        ['(i) h2 は T2・その回は ng（直してくださいの行）', hh(st, H2)?.table_id === T2 && cv && cv.rows.length === 2 && cv.rows[0].ok === true && cv.rows[1].ok === false, cv && J(cv.rows.map((r) => [r.ok, r.why]))],
        ['(i) 精算は ng の回を足さない（missing に1つ）', s.missing && s.missing.length === 1, J(s.missing)],
      ];
    } },
];

/* 写しを先に回す */
const fmt = (r) => (!r ? '無し' : r.ok === true ? 'ok' : r.err === 'conflict' ? 'conflict' : r.err + '@' + (typeof r.at === 'object' ? J(r.at) : r.at) + (r.kind ? ':' + r.kind : ''));
const key = (r) => (!r ? null : r.ok === true ? 'ok' : canon({ err: r.err, at: r.at ?? null, i: r.i ?? null, kind: r.kind ?? null, cur: r.cur ?? null }));
const RUN = SCENES.map((sc) => {
  const b = applyOps((() => { const s = emptyState(); s.rules = sc.R; return s; })(), sc.base, LIBOPT);
  if (!b.ok) { console.log('★中止★ 写しの台が当たらない ' + sc.name + ' ' + J(b.res)); process.exit(1); }
  let st = b.state;
  const out = [];
  for (const [sn, ops, want] of sc.steps) {
    const r = applyOps(st, ops, LIBOPT);
    out.push({ sn, ops, want, lib: r.ok ? { ok: true } : r.res });
    if (r.ok) st = r.state;
  }
  return { ...sc, out, libSt: st };
});

const mkSql = (prefix = '') => `do ${q('a20')} declare res jsonb := '{}'; r jsonb; i int; ra uuid;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  for i in 1..1 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 1) k;
  ${asWho(1)}
  ${RUN.map((s, a) => undo('s' + a, `delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${T('made' + a, `public.mj_room_create(gen_random_uuid(), ${lit(NB + a)}, ${lit(PASS)}, ${jb(s.R)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    ${RS} ${T('b' + a, `public.mj_write(ra, gen_random_uuid(), ${jb(s.base)})`)}
    ${s.out.map((x, b) => `${RS} ${T(`w${a}_${b}`, `public.mj_write(ra, gen_random_uuid(), ${jb(x.ops)})`)}`).join('\n    ')}
    ${T('rd' + a, `public.mj_read(ra, 'room', '{}'::jsonb)`)}
    res := res || jsonb_build_object('mem${a}', (select jsonb_build_object('p3', (select x.rules from mahjong.account_rules x where x.user_id = us[1] and x.players = 3),
                                                                     'p4', (select x.rules from mahjong.account_rules x where x.user_id = us[1] and x.players = 4))));`)).join('\n  ')}
  raise exception 'MJRESULT%', res::text;
end ${q('a20')};`;

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
  RUN.forEach((s, a) => {
    ok(`${s.name} 部屋と台が倉庫に当たった`, o['made' + a]?.room_id && o['b' + a]?.ok === true, J([o['made' + a], o['b' + a]]).slice(0, 300));
    s.out.forEach((x, b) => {
      const db = o[`w${a}_${b}`];
      ok(`${s.name} ${x.sn}：倉庫 ${fmt(db)}＝期待 ${x.want}`, fmt(db) === x.want, J(db).slice(0, 300));
      ok(`${s.name} ${x.sn}：写しと倉庫が同じ答え`, key(db) === key(x.lib), '写し ' + J(x.lib) + ' 倉庫 ' + J(db).slice(0, 300));
    });
    const rd = o['rd' + a];
    const d = rd && rd.ok === true && rd.st ? diff(norm(s.libSt), norm(rd.st)) : ['読めない ' + J(rd).slice(0, 300)];
    ok(`${s.name} 終わりの st：写しと倉庫（mj_read）が同じ`, d.length === 0, d.slice(0, 6).join(' ／ '));
    if (rd && rd.st) {
      const st = { ...rd.st, rules: s.R };
      for (const [n, c, info] of s.ends(st, { mem: o['mem' + a] })) ok(`${s.name} ${n}`, c, info);
    }
  });
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
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'mahjong_private.mj_w_tfollow': '(uuid, uuid, int, text, uuid, text, jsonb)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const TF = 'mahjong_private.mj_w_tfollow', OP = 'mahjong_private.mj_w_op';
const FF = "p_op = 'hanchan_start' and (p_o -> 'follow') is not distinct from 'false'::jsonb";
const WZ = [
  ['Z1 follow:false を通さない（今まで通り bad at table_id）', () => brk(TF, [[`if not (${FF}) and`, 'if']]),
    ['F ウマだけ替えて follow:false（(f)(d)） (f) 区切りの後に follow:false で前の卓へ：倉庫']],
  ['Z2 follow:false も鎖の最後へ運ぶ', () => brk(TF, [[`if ${FF} then return s; end if;`, 'null;']]),
    ['F ウマだけ替えて follow:false（(f)(d)） (f) h2 は前の卓 T1 に入った']],
  ['Z3 人数の門を戻す', () => brk(OP, [["-- A20 §6：人数の門は外した", "if (v_rules ->> 'players')::int is distinct from t.players::int then perform mahjong_private.mj_w_bad(p_i, 'players'); end if; --"]]),
    ['A 4人→3人（(a)(d)(g)(g2)） 4人→3人の table_rules：倉庫']],
  ['Z4 人数が違っても席を写す', () => brk(OP, [["case when (v_rules ->> 'players')::int = t.players::int then t.seats else '[]'::jsonb end", 't.seats']]),
    ['A 4人→3人（(a)(d)(g)(g2)） (d) 人数を替えた続きの卓']],
  ['Z5 続きの卓の人数を前の卓のまま', () => brk(OP, [["(v_rules ->> 'players')::smallint, t.rule_set_id, v_rv", 't.players, t.rule_set_id, v_rv']]),
    ['A 4人→3人（(a)(d)(g)(g2)） (a) 3人で2回（follow:true）：倉庫']],
  ['Z6 覚えの人数を前の卓のまま', () => brk(OP, [["values (p_me, (v_rules ->> 'players')::smallint, v_rules,", 'values (p_me, t.players, v_rules,']]),
    ['A 4人→3人（(a)(d)(g)(g2)） A14 覚え']],
  ['Z7 回の created_at を読みに出さない', () => brk('public.mj_read', [["'voided', hh.voided, 'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', hh.created_at), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))", "'voided', hh.voided)"]]),
    ['F ウマだけ替えて follow:false（(f)(d)） (f) late']],
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
  console.log(`\na20: ${pass} passed, ${fail} failed`);
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
    console.log(`\na20 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
