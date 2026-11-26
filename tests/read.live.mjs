/* read.live.mjs — ★2d 読む口 public.mj_read を本物のテスト倉庫で叩く★（定め mahjong_tataki_2026-11-20/2d_sadame.md v2.1 §4 の1〜3）
 * =============================================================================
 * 手元・鍵が要る（tests-no-ci.json）。倉庫は khaw だけ（ref の指紋で照らす）。1つの取引の塊（最後にわざと例外を投げて全部戻す＝倉庫に何も残さない）。
 * §4-1 対応：同じ op の組を ①写し（lib/room-state.mjs の applyOps）と ②倉庫（mj_write）に当て、mj_read の st と写しを canon で比べる（お金の欄＝cells・extras・rate・settles も全部）
 *   ・tests/fixtures/write-cases.json の base_ops＋want_db ?? want が ok の case 全部（部屋は表の rules ごと・case ごとに塊の中で書いて戻す）
 *   ・主な流れ（開催・卓・卓の席・半荘・cell・順・供託・extras 全種〔chip・shugi・yaki・tobi・c:〕・飛び・void/unvoid・直す op・締め・締めの後の次の開催）を1歩ずつ
 *   比べる前に揃える物（形が違っても画面の読みが同じ所だけ）：写しの st.rules を外す・extras を (table_id, kind, member_id) の字順に並べる・settles の at を外す
 *   ・卓の rate_mode 'session' の鍵を外す（倉庫は 'session' の時に鍵を出さない＝rateModeOf が 'session' に倒す）
 * §4-2 門：ログイン無し mj_session・入っていない人 gone・無い部屋 gone・出された人 gone・消した部屋 gone・閉じた部屋 closed:true で読める・solo の持ち主・
 *   入の役・what 違い bad・since の形・since 同じで same・書いた後 read_ver+1・弾かれた組と送り直しは +1 しない・開催の重なりの門（dup what session）
 * §4-3 room_close：history_count 20000 の部屋でも member_add・room_close が ok（H1′＝F の門もたたみも無い）
 * P5（p5_sadame v1.3 §5）：p_args.v 3 の分けた読み＝100開催×60半荘の部屋（倉庫へ直に入れて塊ごと戻す）で loaded（(a) 最後の3＋(b) 取り消していない最後＋(c) sessions）・absent・
 *   members の n／last・v 無しは今の v2・形の誤りは bad what sessions・same・大きさと時間（既定の読みが v2 の 1/20 以下）
 * D1（d1_sadame v2.1 §4）：leagues は st の外の段・形・版・取り消し・l・他の部屋・same・取り消したリーグの L を外す道
 * --waza：壊して狙った試験が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/read.live.mjs [--waza]
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
const J = (x) => JSON.stringify(x);
const U = () => crypto.randomUUID();
const MAIL = 'mj-read.invalid';
const NB = 'rd' + crypto.randomBytes(3).toString('hex');
const P = (s) => NB + 'の' + s;
const PASS = '2741';
const N_U = 9;   // 1＝流れ・G・solo の持ち主 2＝G の入 3＝入っていない人 4＝G から出される人 5〜8＝表の部屋の持ち主 9＝空き
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const URLH = `md5(random()::text) || md5(random()::text)`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
const jb = (x) => `${lit(J(x))}::jsonb`;
const CR = (name, rules) => `public.mj_room_create(gen_random_uuid(), ${name === null ? 'null' : lit(name)}, ${name === null ? 'null' : lit(PASS)}, ${jb(rules)}, jsonb_build_object('url_token_hash', ${URLH}))`;
const WR = (room, ops, op = 'gen_random_uuid()') => `public.mj_write(${room}, ${op}, ${jb(ops)})`;
const RD = (room, args = {}, what = `'room'`) => `public.mj_read(${room}, ${what}, ${args === null ? 'null' : jb(args)})`;
const T = (key, expr) => `begin r := ${expr}; exception when others then r := jsonb_build_object('raised', sqlerrm); end;
    res := res || jsonb_build_object('${key}', r);`;
const ROW = (key, sql) => `res := res || jsonb_build_object('${key}', (${sql}));`;
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
const NOW = '2026-11-22T12:00:00Z';
const L1 = 'a0000000-0000-4000-8000-00000000d101';
const LC1 = { op: 'league_create', league_id: L1, name: 'D1 リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'avg_pt', min_games: 10,
  players_main: 4, rules: { players: 4, rate: 100 }, rules_alt: { players: 3 } };
const LCF = { op: 'league_create', league_id: 'a0000000-0000-4000-8000-00000000d102', name: '別の部屋', players_main: 4, rules: { players: 4 } };
/* D2（d2_sadame v1.1 §4）：'league' の読み＝L1 の日 DS1（主＋alt の卓）・別のリーグ L2 の日 DS2・部屋の日 DS0 */
const L2 = 'a0000000-0000-4000-8000-00000000d103', LF = 'a0000000-0000-4000-8000-00000000d102';
const [DS1, DS2, DT1, DT2, DT3] = ['e301', 'e302', 'e303', 'e304', 'e305'].map((x) => 'a0000000-0000-4000-8000-00000000' + x);
const RDL = (lid, extra = {}) => RD('rg', { league_id: lid, ...extra }, `'league'`);
/* P5：100開催×60半荘（98〜100 は取り消し＝(b) は 97）・2日目の1半荘を取り消す・最新はリーグの日（room の読みに出ない） */
const PM = [U(), U(), U(), U()], P5_RAND = U();
const P5_N = 100, P5_H = 60;
const RDV3 = (extra) => `public.mj_read(rg, 'room', jsonb_build_object('v', 3${extra ? ', ' + extra : ''}))`;
const RM4 = `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'account_remove', 'user_id', us[4])))`;

/* ── 写しと倉庫の st を同じ形に揃える（§ 頭の注の4つだけ） ── */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function norm(st0) {
  const st = JSON.parse(J(st0));
  delete st.rules;
  for (const t of st.tables || []) if (t.rate_mode === 'session') delete t.rate_mode;
  st.extras = (st.extras || []).slice().sort((a, b) => cmp(a.table_id, b.table_id) || cmp(a.kind, b.kind) || cmp(a.member_id, b.member_id));
  for (const s of st.settles || []) delete s.at;
  return st;
}
/* 違う所を短く見せる */
function diff(a, b, p = '') {
  if (canon(a) === canon(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return ks.flatMap((k) => diff(a[k], b[k], p + '.' + k));
  }
  return [p + ' 写し=' + J(a) + ' 倉庫=' + J(b)];
}

/* ── §4-1 の1：write-cases.json（記号の id は部屋ごとに uuid へ写す＝write.live と同じ写し方） ── */
const WT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/write-cases.json'), 'utf8'));
const WT_RK = Object.keys(WT.rules);
const WT_ROOM = Object.fromEntries(WT_RK.map((k, i) => [k, 'rt' + i]));
const WT_IDS = Object.fromEntries(WT_RK.map((k) => [k, {}]));
const WT_ID_KEYS = ['hanchan_id', 'table_id', 'member_id', 'session_id'];
const wtId = (rk, v) => (typeof v !== 'string' ? v : /^[a-z]\d+$/.test(v) ? (WT_IDS[rk][v] ||= U()) : U());
const wtOp = (rk, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  WT_ID_KEYS.includes(k) ? wtId(rk, v) : (k === 'seats' || k === 'ton_order' || k === 'seen_seats') && Array.isArray(v) ? v.map((x) => wtId(rk, x)) : v]));
const WT_OK = WT.cases.filter((c) => (c.want_db ?? c.want) === 'ok')
  .map((c) => ({ ...c, ops: c.ops_repeat ? Array.from({ length: c.ops_repeat.n }, () => c.ops_repeat.op) : c.ops }));
const withRules = (R) => { const st = emptyState(); st.rules = R; return st; };
const WT_BASE = {}, WT_BASE_OPS = {};
for (const k of WT_RK) {
  WT_BASE_OPS[k] = WT.base_ops.map((o) => wtOp(k, o));
  const R = rulesOk(WT.rules[k]);
  const b = R.ok ? applyOps(withRules(R.rules), WT_BASE_OPS[k], { now: NOW }) : { ok: false, res: R };
  WT_BASE[k] = b.ok ? b.state : null;
}
const WT_RUN = WT_OK.map((c) => {
  const ops = c.ops.map((o) => wtOp(c.rules, o));
  const r = WT_BASE[c.rules] ? applyOps(WT_BASE[c.rules], ops, { now: NOW }) : { ok: false };
  return { id: c.id, rules: c.rules, ops, lib: r.ok ? r.state : null, libErr: r.ok ? null : J(r.res) };
});

/* ── §4-1 の2：主な流れ（写しの今の版から base_version を引いて組を作る＝倉庫と写しの版が揃っているかも比べる） ── */
const FR = { players: 4, rate: 100, chip_pt10: 20, shugi_pt10: 10, kyotaku_end: 'kieru', tobi: true, tobi_pt: 10, yakitori: true, yakitori_pt: 10,
  tane_custom: [{ id: 'ko', name: 'コイン', pt10: 5, sum0: true }, { id: 'ba', name: '場代', pt10: 10, sum0: false }] };
const M = [U(), U(), U(), U(), U()], S1 = U(), S2 = U(), T1 = U(), T2 = U(), T3 = U(), H1 = U(), H2 = U(), H3 = U();
const hOf = (st, id) => st.hanchans.find((h) => h.hanchan_id === id);
const xOf = (st, t, m, kind) => st.extras.find((e) => e.table_id === t && e.member_id === m && e.kind === kind);
const SEAT4 = M.slice(0, 4);
const FLOW_STEPS = [
  ['人を5人', () => M.map((id, i) => ({ op: 'member_add', member_id: id, name: ['山田', '鈴木', '佐藤', '高橋', '渡辺'][i] }))],
  ['開催（rate 100・場所）', () => [{ op: 'session_add', session_id: S1, date: '2026-11-22', rate: 100, place: '雀荘 東' }]],
  ['卓＋卓の席', () => [{ op: 'table_add', table_id: T1, session_id: S1, label: '卓1' }, { op: 'table_seats', table_id: T1, seats: SEAT4 }]],
  ['半荘1', () => [{ op: 'hanchan_start', hanchan_id: H1, table_id: T1, seats: SEAT4, cells: [40000, 30000, 20000, 10000] }]],
  ['cell を2つ直す', (st) => [{ op: 'cell_set', hanchan_id: H1, seat: 0, value: 39000, base_version: hOf(st, H1).cell_ver[0] },
    { op: 'cell_set', hanchan_id: H1, seat: 3, value: 11000, base_version: hOf(st, H1).cell_ver[3] }]],
  ['半荘2（飛び・供託が消える）', () => [{ op: 'hanchan_start', hanchan_id: H2, table_id: T1, seats: [M[1], M[0], M[3], M[2]], cells: [52000, 31000, 19000, -3000], lost: 1000 }]],
  ['飛びの受け取り', (st) => [{ op: 'tobi_set', hanchan_id: H2, tobi_to: { 3: 0 }, base_version: hOf(st, H2).tobi_version }]],
  ['東の順', (st) => [{ op: 'hanchan_order', hanchan_id: H1, ton_order: [M[1], M[0], M[2], M[3]], base_version: hOf(st, H1).order_version }]],
  ['供託', (st) => [{ op: 'kyotaku_set', hanchan_id: H1, value: 2000, base_version: hOf(st, H1).version }]],
  ['extras 全種', () => [
    { op: 'extra_add', table_id: T1, member_id: M[0], kind: 'chip', add: 3 }, { op: 'extra_add', table_id: T1, member_id: M[1], kind: 'chip', add: -3 },
    { op: 'extra_add', table_id: T1, member_id: M[2], kind: 'shugi', add: 2 }, { op: 'extra_add', table_id: T1, member_id: M[3], kind: 'shugi', add: -2 },
    { op: 'extra_add', table_id: T1, member_id: M[0], kind: 'yaki', add: -1 }, { op: 'extra_add', table_id: T1, member_id: M[2], kind: 'yaki', add: 1 },
    { op: 'extra_add', table_id: T1, member_id: M[1], kind: 'tobi', add: 1 }, { op: 'extra_add', table_id: T1, member_id: M[2], kind: 'tobi', add: -1 },
    { op: 'extra_add', table_id: T1, member_id: M[1], kind: 'c:ko', add: 4 }, { op: 'extra_add', table_id: T1, member_id: M[3], kind: 'c:ko', add: -4 },
    { op: 'extra_add', table_id: T1, member_id: M[3], kind: 'c:ba', add: 7 }]],
  ['extra_set', (st) => [{ op: 'extra_set', table_id: T1, member_id: M[0], kind: 'chip', value: 5, base_version: xOf(st, T1, M[0], 'chip').version },
    { op: 'extra_set', table_id: T1, member_id: M[1], kind: 'chip', value: -5, base_version: xOf(st, T1, M[1], 'chip').version }]],
  ['半荘1を取り消す', () => [{ op: 'hanchan_void', hanchan_id: H1 }]],
  ['半荘1を戻す', () => [{ op: 'hanchan_unvoid', hanchan_id: H1 }]],
  ['半荘1の席を替える', () => [{ op: 'hanchan_seats', hanchan_id: H1, seats: [M[4], M[1], M[2], M[3]] }]],
  ['人を直す', () => [{ op: 'member_rename', member_id: M[4], name: '渡部' }, { op: 'member_active', member_id: M[4], active: false }]],
  ['開催を直す', () => [{ op: 'session_edit', session_id: S1, rate: 50, place: '雀荘 西' }]],
  ['卓2（レート別）', () => [{ op: 'table_add', table_id: T2, session_id: S1, label: '卓2' }, { op: 'table_edit', table_id: T2, rate_mode: 'num', rate: 30 }]],
  ['卓2 レートなし→取り消し', () => [{ op: 'table_edit', table_id: T2, rate_mode: 'none', rate: null }, { op: 'table_edit', table_id: T2, voided: true }]],
  ['締め', () => [{ op: 'settle_snap', session_id: S1, rev: 1, content: { ten: { [M[0]]: 12, [M[1]]: -12 }, yen: [1, 2] }, used: { chip: true }, missing: [] }]],
  ['締めの後の次の開催', () => [{ op: 'session_add', session_id: S2, date: '2026-11-23', rate: null }, { op: 'table_add', table_id: T3, session_id: S2, label: '卓1' }]],
  ['次の開催の半荘', () => [{ op: 'hanchan_start', hanchan_id: H3, table_id: T3, seats: SEAT4, cells: [25000, 25000, 25000, 25000], ton_order: SEAT4 }]],
];
const FLOW = [];
{
  const R = rulesOk(FR);
  let st = R.ok ? withRules(R.rules) : null;
  for (const [name, mk] of FLOW_STEPS) {
    if (!st) { FLOW.push({ name, ops: [], lib: null, libErr: 'ルールが読めない ' + J(R) }); continue; }
    const ops = mk(st);
    const r = applyOps(st, ops, { now: NOW });
    FLOW.push({ name, ops, lib: r.ok ? r.state : null, libErr: r.ok ? null : J(r.res) });
    st = r.ok ? r.state : null;
  }
}

/* ── 塊 ── */
const mkSql = (prefix = '') => `do ${q('rd')} declare res jsonb := '{}'; r jsonb; i int; v0 bigint;
  us uuid[] := '{}'; ss uuid[] := '{}'; rf uuid; rg uuid; rs uuid; ${WT_RK.map((k) => WT_ROOM[k] + ' uuid;').join(' ')}
begin
  ${prefix}
  delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
  for i in 1..${N_U} loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, ${N_U}) k;

  /* §4-1 の1 表 */
  ${WT_RK.map((k, i) => `${asWho(5 + i)}
  ${T('made_' + WT_ROOM[k], CR(P('t' + i), WT.rules[k]))} ${WT_ROOM[k]} := (r->>'room_id')::uuid;
  ${RS} ${T('tb_' + WT_ROOM[k], WR(WT_ROOM[k], WT_BASE_OPS[k]))}
  ${T('tbr_' + WT_ROOM[k], RD(WT_ROOM[k]))}`).join('\n  ')}
  ${WT_RUN.map((c, i) => undo('tc' + i, `${asWho(5 + WT_RK.indexOf(c.rules))} ${RS}
    ${T('tc' + i, WR(WT_ROOM[c.rules], c.ops))}
    ${T('tcr' + i, RD(WT_ROOM[c.rules]))}`)).join('\n  ')}

  /* §4-1 の2 主な流れ */
  ${asWho(1)}
  ${T('made_rf', CR(P('flow'), FR))} rf := (r->>'room_id')::uuid;
  ${FLOW.map((s, i) => `${RS} ${T('fw' + i, WR('rf', s.ops))}
  ${T('fr' + i, RD('rf'))}`).join('\n  ')}

  /* §4-2 門（部屋 G＝持ち主 1・入 2・出される 4） */
  ${asWho(1)}
  ${T('made_rg', CR(P('g'), { players: 4 }))} rg := (r->>'room_id')::uuid;
  ${asWho(2)} ${T('j2', `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(P('g'))})`)}
  ${asWho(4)} ${T('j4', `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(P('g'))})`)}
  ${asWho(1)} ${RS}
  ${T('g_w1', WR('rg', [{ op: 'member_add', member_id: U(), name: '甲' }]))}
  ${T('g_own', RD('rg'))}
  ${asWho(2)} ${T('g_mem', RD('rg'))}
  ${asWho(3)} ${T('g_out', RD('rg'))}
  ${asWho(1)} ${T('g_ghost', RD('gen_random_uuid()'))}
  ${T('g_null', RD('null'))}
  perform set_config('request.jwt.claims', '', true);
  ${T('g_nos', RD('rg'))}
  ${asWho(1)}
  ${T('g_what', RD('rg', {}, `'rooms'`))} ${T('g_whatn', RD('rg', {}, 'null'))}
  ${T('g_sn', RD('rg', { since: -1 }))} ${T('g_sf', RD('rg', { since: 1.5 }))} ${T('g_ss', RD('rg', { since: '1' }))}
  ${T('g_arr', `public.mj_read(rg, 'room', '[]'::jsonb)`)} ${T('g_argsnull', RD('rg', null))} ${T('g_sincenull', RD('rg', { since: null }))}
  v0 := (select read_ver from mahjong.rooms where id = rg);
  ${ROW('g_v0', 'v0')}
  ${T('g_same', `public.mj_read(rg, 'room', jsonb_build_object('since', v0))`)}
  ${T('g_old', `public.mj_read(rg, 'room', jsonb_build_object('since', v0 - 1))`)}
  ${RS} ${T('g_bad', WR('rg', [{ op: 'member_add', member_id: 'nai', name: '乙' }]))}
  ${ROW('g_vbad', 'select read_ver from mahjong.rooms where id = rg')}
  ${T('g_w2', WR('rg', [{ op: 'member_add', member_id: U(), name: '乙' }], `'a0000000-0000-4000-8000-00000000d201'::uuid`))}
  ${ROW('g_v2', 'select read_ver from mahjong.rooms where id = rg')}
  ${T('g_after', `public.mj_read(rg, 'room', jsonb_build_object('since', v0))`)}
  ${T('g_w2again', WR('rg', [{ op: 'member_add', member_id: U(), name: '乙' }], `'a0000000-0000-4000-8000-00000000d201'::uuid`))}
  ${ROW('g_v3', 'select read_ver from mahjong.rooms where id = rg')}
  ${ROW('g_lastseen', `select jsonb_agg(jsonb_build_array(user_id = us[2], last_seen > now() - interval '1 minute')) from mahjong.room_accounts where room_id = rg`)}
  ${undo('gb', `${asWho(1)} ${RS} ${T('gb_rm', `public.mj_write(rg, gen_random_uuid(), jsonb_build_array(jsonb_build_object('op', 'account_remove', 'user_id', us[4])))`)}
    ${asWho(4)} ${T('gb', RD('rg'))}
    ${ROW('gb_row', `select count(*) from mahjong.room_accounts where room_id = rg and user_id = us[4]`)}
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (rg, us[4], 'nyu', 'name');
    ${T('gb2', RD('rg'))}`)}
  ${undo('gd', `${asWho(1)} ${RS} ${T('gd_w', WR('rg', [{ op: 'room_delete' }]))}
    ${T('gd', RD('rg'))} ${asWho(2)} ${T('gd2', RD('rg'))}`)}
  ${undo('gc', `${asWho(1)} ${RS} ${T('gc_w', WR('rg', [{ op: 'room_close' }]))}
    ${asWho(2)} ${T('gc', RD('rg'))} ${RS} ${T('gc_wr', WR('rg', [{ op: 'member_add', member_id: U(), name: '丙' }]))}`)}
  /* 開催の重なりの門（shared）・solo は今のまま */
  ${undo('gs', `${asWho(1)} ${RS}
    ${T('gs_1', WR('rg', [{ op: 'session_add', session_id: 'a0000000-0000-4000-8000-00000000d301', date: '2026-11-22', rate: null }]))}
    ${T('gs_2', WR('rg', [{ op: 'session_add', session_id: U(), date: '2026-11-22', rate: null }]))}
    ${T('gs_2b', WR('rg', [{ op: 'member_add', member_id: U(), name: '丁' }, { op: 'session_add', session_id: U(), date: '2026-11-22', rate: null }]))}
    ${ROW('gs_n', `select count(*) from mahjong.sessions where room_id = rg`)}
    ${T('gs_v', WR('rg', [{ op: 'session_edit', session_id: 'a0000000-0000-4000-8000-00000000d301', voided: true }]))}
    ${T('gs_3', WR('rg', [{ op: 'session_add', session_id: U(), date: '2026-11-23', rate: null }]))}`)}
  /* D1 リーグの段（塊ごと戻す） */
  ${undo('lg', `${asWho(1)} ${RS}
    v0 := (select read_ver from mahjong.rooms where id = rg);
    ${ROW('lg_v0', 'v0')}
    ${T('lg_c', WR('rg', [LC1]))}
    ${RS} ${T('lg_cf', WR('rf', [LCF]))}
    ${T('lg_since', `public.mj_read(rg, 'room', jsonb_build_object('since', v0))`)}
    ${T('lg_r1', RD('rg'))}
    ${asWho(2)} ${T('lg_r2', RD('rg'))}
    ${asWho(1)} ${RS} ${T('lg_s', WR('rg', [{ op: 'league_save', league_id: L1, base_version: 1, rules: { players: 4, rate: 200 } }]))}
    ${T('lg_r3', RD('rg'))}
    update mahjong.leagues set voided = true where id = ${lit(L1)}::uuid;
    ${T('lg_r4', RD('rg'))}
    update mahjong.leagues set owner_user_id = us[2] where id = ${lit(L1)}::uuid;
    ${T('lg_r5', RD('rg'))} ${asWho(2)} ${T('lg_r6', RD('rg'))}
    update mahjong.leagues set owner_user_id = gen_random_uuid() where id = ${lit(L1)}::uuid;
    ${asWho(1)} ${T('lg_r7', RD('rg'))} ${asWho(2)} ${T('lg_r8', RD('rg'))}
    update mahjong.leagues set owner_user_id = us[4] where id = ${lit(L1)}::uuid;
    ${asWho(1)} ${RS} ${T('lg_k1', RM4)}
    ${RS} ${T('lg_o', WR('rg', [{ op: 'league_owner_set', league_id: L1 }]))}
    ${RS} ${T('lg_k2', RM4)}`)}
  /* D2 リーグの日の読み（塊ごと戻す） */
  ${undo('dl', `${asWho(1)} ${RS}
    ${T('dl_c', WR('rg', [LC1]))}
    ${RS} ${T('dl_c2', WR('rg', [{ ...LC1, league_id: L2, name: 'D2 別', rules_alt: null }]))}
    ${RS} ${T('dl_cf', WR('rf', [LCF]))}
    ${RS} ${T('dl_s1', WR('rg', [{ op: 'session_add', session_id: DS1, date: '2026-11-22', rate: null, league_id: L1 },
      { op: 'table_add', table_id: DT1, session_id: DS1, label: '卓1' }, { op: 'table_add', table_id: DT2, session_id: DS1, label: '卓2', alt: true }]))}
    ${RS} ${T('dl_s2', WR('rg', [{ op: 'session_add', session_id: DS2, date: '2026-11-22', rate: null, league_id: L2 },
      { op: 'table_add', table_id: DT3, session_id: DS2, label: '卓1' }]))}
    ${T('dl_r1', RDL(L1))}
    ${T('dl_r0', RD('rg'))}
    ${T('dl_same', `public.mj_read(rg, 'league', jsonb_build_object('league_id', ${lit(L1)}, 'since', (select read_ver from mahjong.rooms where id = rg)))`)}
    ${RS} ${T('dl_sv', WR('rg', [{ op: 'league_save', league_id: L1, base_version: 1, rules: { players: 4, rate: 200 }, rules_alt: { players: 3, rate: 300 } }]))}
    ${T('dl_r2', RDL(L1))}
    update mahjong.leagues set voided = true where id = ${lit(L2)}::uuid;
    ${T('dl_r3', RDL(L2))}
    ${asWho(3)} ${T('dl_g', RDL(L1))}
    ${asWho(1)} ${T('dl_b1', RDL(LF))} ${T('dl_b2', RDL('a0000000-0000-4000-8000-00000000d1ff'))}
    ${T('dl_b3', RD('rg', {}, `'league'`))} ${T('dl_b4', RDL('L1'))}`)}
  /* P5 分けた読み（塊ごと戻す） */
  ${undo('p5', `${asWho(1)} ${RS}
    ${T('p5_m', WR('rg', PM.map((id, i) => ({ op: 'member_add', member_id: id, name: 'P5の' + i }))))}
    ${RS} ${T('p5_lc', WR('rg', [LC1]))}
    insert into mahjong.sessions (id, room_id, date, voided, rate, rule_set_id, rule_version, created_at)
      select gen_random_uuid(), rg, date '2026-01-01' + k, k >= ${P5_N - 2}, 100, x.rule_set_id, x.rule_version, now() - (1000 - k) * interval '1 second'
        from generate_series(1, ${P5_N}) k, mahjong.rooms x where x.id = rg;
    insert into mahjong.sessions (id, room_id, league_id, date, rate, rule_set_id, rule_version, created_at)
      select gen_random_uuid(), rg, ${lit(L1)}::uuid, date '2026-06-01', 100, x.rule_set_id, x.rule_version, now() from mahjong.rooms x where x.id = rg;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, created_at)
      select gen_random_uuid(), rg, z.id, '卓1', 4, z.rule_set_id, z.rule_version, z.created_at from mahjong.sessions z where z.room_id = rg;
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, rule_set_id, rule_version, rules_snapshot, voided, created_at)
      select gen_random_uuid(), rg, t.id, 4, jsonb_build_object('0', ${lit(PM[0])}, '1', ${lit(PM[1])}, '2', ${lit(PM[2])}, '3', ${lit(PM[3])}),
             t.rule_set_id, t.rule_version, qr.rules, (j = 1 and z.date = date '2026-01-02'), t.created_at + j * interval '1 millisecond'
        from mahjong.tables t join mahjong.sessions z on z.id = t.session_id join mahjong.rule_sets qr on qr.id = t.rule_set_id and qr.version = t.rule_version,
             generate_series(1, ${P5_H}) j
       where t.room_id = rg;
    insert into mahjong.cells (hanchan_id, seat, value) select h.id, k, (array[40000, 30000, 20000, 10000])[k + 1] from mahjong.hanchans h, generate_series(0, 3) k where h.room_id = rg;
    analyze mahjong.sessions; analyze mahjong.tables; analyze mahjong.hanchans; analyze mahjong.cells;
    ${ROW('p5_ids', `select jsonb_agg(id order by created_at, id) from mahjong.sessions where room_id = rg and league_id is null`)}
    ${ROW('p5_lg', `select id from mahjong.sessions where room_id = rg and league_id is not null`)}
    ${ROW('p5_t0', 'clock_timestamp()')} ${T('p5_def', RDV3())} ${ROW('p5_t1', 'clock_timestamp()')}
    ${T('p5_v2', RD('rg'))} ${ROW('p5_t2', 'clock_timestamp()')}
    ${T('p5_req', RDV3(`'sessions', jsonb_build_array((select id::text from mahjong.sessions where room_id = rg and league_id is null order by created_at, id offset 4 limit 1), ${lit(S1)}, ${lit(P5_RAND)}, (select id::text from mahjong.sessions where room_id = rg and league_id is not null))`))}
    ${ROW('p5_t3', 'clock_timestamp()')}
    ${T('p5_vs', RD('rg', { v: '3' }))} ${T('p5_v4', RD('rg', { v: 4 }))}
    ${T('p5_b1', RD('rg', { v: 3, sessions: Array.from({ length: 51 }, () => U()) }))}
    ${T('p5_b50', RD('rg', { v: 3, sessions: Array.from({ length: 50 }, () => U()) }))}
    ${T('p5_b2', RD('rg', { v: 3, sessions: ['x'] }))} ${T('p5_b3', RD('rg', { v: 3, sessions: 'a' }))} ${T('p5_b4', RD('rg', { v: 3, sessions: [1] }))}
    ${T('p5_sn', RD('rg', { v: 3, sessions: null }))}
    ${T('p5_same', RDV3(`'since', (select read_ver from mahjong.rooms where id = rg)`))}`)}
  /* solo */
  ${asWho(1)}
  ${T('made_rs', CR(null, { players: 4 }))} rs := (r->>'room_id')::uuid;
  ${RS} ${T('s_w', WR('rs', [{ op: 'member_add', member_id: U(), name: '甲' }, { op: 'session_add', session_id: U(), date: '2026-11-22', rate: null }]))}
  ${T('s_w2', WR('rs', [{ op: 'session_add', session_id: U(), date: '2026-11-22', rate: null }]))}
  ${T('s_own', RD('rs'))}
  ${asWho(2)} ${T('s_other', RD('rs'))}

  /* §4-3 H1'（h1b_sadame v2）：history_count が大きい部屋でも書ける・閉じられる（F の門は無い） */
  ${undo('fc', `${asWho(1)} ${RS}
    update mahjong.rooms set history_count = 20000 where id = rg;
    ${T('fc_ma', WR('rg', [{ op: 'member_add', member_id: U(), name: '戊' }]))}
    ${T('fc_cl', WR('rg', [{ op: 'room_close' }]))}
    ${ROW('fc_hc', `select history_count - 20000 from mahjong.rooms where id = rg`)}`)}

  raise exception 'MJRESULT%', res::text;
end ${q('rd')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isErr = (r, err, f = {}) => !!r && r.ok === false && r.err === err && Object.entries(f).every(([k, v]) => canon(r[k]) === canon(v));
const isOk = (r) => !!r && r.ok === true;

function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  const same = (lib, rd) => (lib && isOk(rd) && rd.st ? diff(norm(lib), norm(rd.st)) : ['写し ' + (lib ? 'あり' : 'なし') + ' 倉庫 ' + J(rd).slice(0, 300)]);

  /* §4-1 表 */
  ok('§4-1 表：ok の case が40以上（want_db ?? want）', WT_OK.length >= 40, String(WT_OK.length));
  for (const k of WT_RK) {
    const d = same(WT_BASE[k], o['tbr_' + WT_ROOM[k]]);
    ok(`§4-1 表 ${k}：base_ops の後の st が写しと同じ`, isOk(o['made_' + WT_ROOM[k]]) && isOk(o['tb_' + WT_ROOM[k]]) && d.length === 0, J([o['tb_' + WT_ROOM[k]], d.slice(0, 6)]));
  }
  WT_RUN.forEach((c, i) => {
    const d = c.lib ? same(c.lib, o['tcr' + i]) : ['写しが弾いた ' + c.libErr];
    ok('§4-1 表：' + c.id + '＝写しと倉庫の st が同じ', isOk(o['tc' + i]) && d.length === 0, J([o['tc' + i], d.slice(0, 6)]));
  });
  /* §4-1 流れ */
  ok('§4-1 流れ：部屋を作れた', isOk(o.made_rf), J(o.made_rf));
  FLOW.forEach((s, i) => {
    const d = s.lib ? same(s.lib, o['fr' + i]) : ['写しが弾いた ' + s.libErr];
    ok(`§4-1 流れ ${i + 1} ${s.name}：ok・写しと倉庫の st が同じ`, isOk(o['fw' + i]) && d.length === 0, J([o['fw' + i], d.slice(0, 8)]));
  });
  const last = o['fr' + (FLOW.length - 1)];
  ok('§4-1 流れ：お金の欄が在る（extras 11行・settles 1・卓の rate_mode none・半荘3）', isOk(last) && last.st.extras.length === 11 && last.st.settles.length === 1
    && last.st.tables.some((t) => t.rate_mode === 'none') && last.st.hanchans.length === 3, J(last && last.st && { x: last.st.extras.length, s: last.st.settles.length }));

  /* §4-2 門 */
  const g = o.g_own;
  ok('§4-2 持ち主が読める（role owner・owner true・kind shared・name・closed false・rules・st.v 2）', isOk(g) && g.room.role === 'owner' && g.room.owner === true && g.room.kind === 'shared'
    && g.room.name === P('g') && g.room.closed === false && g.room.rules && g.room.rules.players === 4 && g.st.v === 2 && g.st.members.length === 1, J(g).slice(0, 500));
  ok('§4-2 入が読める（role nyu・owner false）', isOk(o.g_mem) && o.g_mem.room.role === 'nyu' && o.g_mem.room.owner === false && canon(o.g_mem.st) === canon(g.st), J(o.g_mem).slice(0, 300));
  ok('§4-2 入っていない人 → gone', isErr(o.g_out, 'gone') && Object.keys(o.g_out).length === 2, J(o.g_out));
  ok('§4-2 無い部屋 → gone（入っていない人と同じ返し）・room_id null → bad', canon(o.g_ghost) === canon(o.g_out) && isErr(o.g_null, 'bad', { what: 'room_id' }), J([o.g_ghost, o.g_null]));
  ok('§4-2 ログイン無し → mj_session', isErr(o.g_nos, 'mj_session'), J(o.g_nos));
  ok('§4-2 what 違い・null → bad what', isErr(o.g_what, 'bad', { what: 'what' }) && isErr(o.g_whatn, 'bad', { what: 'what' }), J([o.g_what, o.g_whatn]));
  ok('§4-2 since が負・小数・字 → bad since／args が配列 → bad args', isErr(o.g_sn, 'bad', { what: 'since' }) && isErr(o.g_sf, 'bad', { what: 'since' }) && isErr(o.g_ss, 'bad', { what: 'since' })
    && isErr(o.g_arr, 'bad', { what: 'args' }), J([o.g_sn, o.g_sf, o.g_ss, o.g_arr]));
  ok('§4-2 args null・since null は全部読む', isOk(o.g_argsnull) && o.g_argsnull.st && isOk(o.g_sincenull) && o.g_sincenull.st, J([o.g_argsnull, o.g_sincenull]).slice(0, 300));
  ok('§4-2 read_ver は書いた組の数（部屋を作って member_add 1組＝1）', Number(o.g_v0) === 1 && g.read_ver === 1, J([o.g_v0, g.read_ver]));
  ok('§4-2 since が今の版 → same（中身を返さない）', isOk(o.g_same) && o.g_same.same === true && o.g_same.read_ver === Number(o.g_v0) && !('st' in o.g_same) && !('room' in o.g_same), J(o.g_same));
  ok('§4-2 since が古い版 → 中身を返す', isOk(o.g_old) && !o.g_old.same && o.g_old.st, J(o.g_old).slice(0, 200));
  ok('§4-2 弾かれた組は read_ver を増やさない', isErr(o.g_bad, 'bad') && Number(o.g_vbad) === Number(o.g_v0), J([o.g_bad, o.g_vbad]));
  ok('§4-2 書いた後 read_ver+1・since 前の版で新しい中身', isOk(o.g_w2) && Number(o.g_v2) === Number(o.g_v0) + 1 && isOk(o.g_after) && o.g_after.read_ver === Number(o.g_v2)
    && o.g_after.st.members.length === 2, J([o.g_w2, o.g_v2, o.g_after && o.g_after.read_ver]));
  ok('§4-2 送り直し（同じ op_id）は read_ver を増やさない', isOk(o.g_w2again) && Number(o.g_v3) === Number(o.g_v2), J([o.g_w2again, o.g_v3]));
  ok('§4-2 読んだ入の last_seen が今', Array.isArray(o.g_lastseen) && o.g_lastseen.some(([me, now]) => me && now), J(o.g_lastseen));
  ok('§4-2 出された人 → gone（行が消える）', isOk(o.gb_rm) && isErr(o.gb, 'gone') && Number(o.gb_row) === 0, J([o.gb_rm, o.gb, o.gb_row]));
  ok('§4-2 出された人の印が在れば room_accounts の行が残っていても gone', isErr(o.gb2, 'gone'), J(o.gb2));
  ok('§4-2 消した部屋 → 持ち主も入も gone', isOk(o.gd_w) && isErr(o.gd, 'gone') && isErr(o.gd2, 'gone'), J([o.gd_w, o.gd, o.gd2]));
  ok('§4-2 閉じた部屋は closed:true で読める・書きは bad closed', isOk(o.gc_w) && isOk(o.gc) && o.gc.room.closed === true && o.gc.st.members.length === 2 && isErr(o.gc_wr, 'bad'),
    J([o.gc_w, o.gc && o.gc.room, o.gc_wr]));
  ok('§4-2 開催の重なりの門：締めの無い開催が在る shared → dup what session（その開催・i）・組ごと弾く', isOk(o.gs_1)
    && isErr(o.gs_2, 'dup', { what: 'session', session_id: 'a0000000-0000-4000-8000-00000000d301', i: 0 })
    && isErr(o.gs_2b, 'dup', { what: 'session', i: 1 }) && Number(o.gs_n) === 1, J([o.gs_1, o.gs_2, o.gs_2b, o.gs_n]));
  ok('§4-2 開催の重なりの門：その開催を取り消した後は作れる', isOk(o.gs_v) && isOk(o.gs_3), J([o.gs_v, o.gs_3]));
  ok('§4-2 solo：重なりの門を見ない（2つ目の開催も ok）・持ち主が読める（kind solo・name の鍵なし）', isOk(o.s_w) && isOk(o.s_w2) && isOk(o.s_own) && o.s_own.room.kind === 'solo'
    && !('name' in o.s_own.room) && o.s_own.room.owner === true && o.s_own.st.sessions.length === 2, J([o.s_w, o.s_w2, o.s_own && o.s_own.room]));
  ok('§4-2 solo：他の人 → gone', isErr(o.s_other, 'gone'), J(o.s_other));
  /* D1 */
  const ST_KEYS = 'extras,hanchans,members,sessions,settles,tables,v';
  const lg = (x) => (x && Array.isArray(x.leagues) ? x.leagues : []);
  const g1 = lg(o.lg_r1)[0] || {};
  ok('D1 塊が回った', !o.lg_err, o.lg_err);
  ok('D1 リーグの段は st の外・st の鍵は今のまま・リーグ無しは []', isOk(g) && canon(g.leagues) === '[]' && !('leagues' in g.st) && Object.keys(g.st).sort().join(',') === ST_KEYS
    && isOk(o.lg_r1) && !('leagues' in o.lg_r1.st) && Object.keys(o.lg_r1.st).sort().join(',') === ST_KEYS, J([g && g.leagues, g && Object.keys(g.st)]));
  ok('D1 作ったリーグの形（欄11・期間・rules と rules_alt・version 1・l true・取り消し印なし・持ち主の id を出さない）', isOk(o.lg_c) && lg(o.lg_r1).length === 1
    && g1.league_id === L1 && g1.name === 'D1 リーグ' && g1.date_from === '2026-11-01' && g1.date_to === null && g1.rank_by === 'avg_pt' && g1.min_games === 10
    && g1.players_main === 4 && g1.rules && g1.rules.players === 4 && g1.rules.rate === 100 && g1.rules_alt && g1.rules_alt.players === 3
    && g1.version === 1 && g1.l === true && Object.keys(g1).length === 11 && !J(o.lg_r1.leagues).includes('owner'), J([o.lg_c, o.lg_r1 && o.lg_r1.leagues]));
  ok('D1 他の部屋のリーグが出ない', isOk(o.lg_cf) && lg(o.lg_r1).length === 1, J([o.lg_cf, lg(o.lg_r1).map((x) => x.league_id)]));
  ok('D1 l は L の人だけ true（入は false）', isOk(o.lg_r2) && lg(o.lg_r2).length === 1 && lg(o.lg_r2)[0].l === false, J(o.lg_r2 && o.lg_r2.leagues));
  ok('D1 league の書きの後は same にならない（read_ver+1）', isOk(o.lg_since) && !o.lg_since.same && o.lg_since.read_ver === Number(o.lg_v0) + 1
    && Array.isArray(o.lg_since.leagues) && o.lg_since.leagues.length === 1, J([o.lg_v0, o.lg_since && o.lg_since.read_ver, o.lg_since && o.lg_since.same]));
  ok('D1 league_save の後 version+1・rules が新しい版・rules_alt は前の版', isOk(o.lg_s) && lg(o.lg_r3)[0] && lg(o.lg_r3)[0].version === 2
    && lg(o.lg_r3)[0].rules.rate === 200 && lg(o.lg_r3)[0].rules_alt.players === 3, J([o.lg_s, o.lg_r3 && o.lg_r3.leagues]));
  ok('D1 取り消したリーグも返す（voided true）', lg(o.lg_r4).length === 1 && lg(o.lg_r4)[0].voided === true, J(o.lg_r4 && o.lg_r4.leagues));
  ok('D1 L が他の人なら持ち主も l false・その人が true', lg(o.lg_r5)[0] && lg(o.lg_r5)[0].l === false && lg(o.lg_r6)[0] && lg(o.lg_r6)[0].l === true,
    J([lg(o.lg_r5), lg(o.lg_r6)]));
  ok('D1 L のアカウントが無いと部屋の持ち主が l true・入は false', lg(o.lg_r7)[0] && lg(o.lg_r7)[0].l === true && lg(o.lg_r8)[0] && lg(o.lg_r8)[0].l === false,
    J([lg(o.lg_r7), lg(o.lg_r8)]));
  ok('D1 取り消したリーグの L は外せない（bad user_id league）→持ち主が league_owner_set→外せる', isErr(o.lg_k1, 'bad', { at: 'user_id', reason: 'league' })
    && isOk(o.lg_o) && isOk(o.lg_k2), J([o.lg_k1, o.lg_o, o.lg_k2]));
  /* D2 §4 read */
  const dl1 = o.dl_r1 || {}, dl2 = o.dl_r2 || {};
  const ids = (x) => (x && x.st && Array.isArray(x.st.sessions) ? x.st.sessions.map((y) => y.session_id) : []);
  const tids = (x) => (x && x.st && Array.isArray(x.st.tables) ? x.st.tables.map((y) => y.table_id) : []);
  ok('D2 塊が回った（リーグ2つ・日2つ・alt の卓）', !o.dl_err && isOk(o.dl_c) && isOk(o.dl_c2) && isOk(o.dl_s1) && isOk(o.dl_s2), J([o.dl_err, o.dl_c, o.dl_c2, o.dl_s1, o.dl_s2]));
  ok("D2 'league' の形＝ok・read_ver・room・league・days・st（leagues の段は無い）・st の鍵は room と同じ", isOk(dl1) && Object.keys(dl1).sort().join(',') === 'days,league,ok,read_ver,room,st'
    && Object.keys(dl1.st).sort().join(',') === ST_KEYS && dl1.league && dl1.league.league_id === L1 && dl1.league.l === true && dl1.room && dl1.room.kind === 'shared', J(dl1 && Object.keys(dl1)));
  ok('D2 st はそのリーグの日だけ（他のリーグ・部屋の日が出ない）・卓は主と alt の2つ', J(ids(dl1)) === J([DS1]) && J(tids(dl1)) === J([DT1, DT2]), J([ids(dl1), tids(dl1)]));
  ok('D2 alt の卓は3人の alt のルール・主の卓は4人・日の rate は主の rules の rate 100', dl1.st && dl1.st.tables && dl1.st.tables[0].rules.players === 4 && dl1.st.tables[1].rules.players === 3
    && dl1.st.sessions[0].rate === 100, J(dl1.st && [dl1.st.sessions, dl1.st.tables && dl1.st.tables.map((t) => t.rules.players)]));
  ok('D2 days＝日ごとの版（主 rate 100・alt 3人）', Array.isArray(dl1.days) && dl1.days.length === 1 && dl1.days[0].session_id === DS1 && dl1.days[0].rules.rate === 100
    && dl1.days[0].rules_alt && dl1.days[0].rules_alt.players === 3, J(dl1.days));
  ok("D2 room の st にリーグの日が出ない", isOk(o.dl_r0) && !ids(o.dl_r0).includes(DS1) && !ids(o.dl_r0).includes(DS2) && !tids(o.dl_r0).includes(DT1), J(ids(o.dl_r0)));
  ok('D2 since が今の版 → same', o.dl_same && o.dl_same.ok === true && o.dl_same.same === true, J(o.dl_same));
  ok('D2 league_save の後も前の日の days は前の版（league は新しい版 rate 200）', isOk(o.dl_sv) && dl2.days && dl2.days[0].rules.rate === 100 && dl2.days[0].rules_alt.rate !== 300
    && dl2.league && dl2.league.rules.rate === 200, J([o.dl_sv, dl2.days, dl2.league && dl2.league.rules]));
  ok('D2 主だけのリーグの日は rules_alt null・取り消したリーグも読める', isOk(o.dl_r3) && o.dl_r3.days.length === 1 && o.dl_r3.days[0].rules_alt === null && o.dl_r3.league.voided === true
    && J(ids(o.dl_r3)) === J([DS2]), J(o.dl_r3 && [o.dl_r3.days, o.dl_r3.league]));
  ok('D2 入でない人 → gone', isErr(o.dl_g, 'gone'), J(o.dl_g));
  ok('D2 他の部屋のリーグ・無いリーグ・league_id 無し・uuid でない → bad what league_id', isErr(o.dl_b1, 'bad', { what: 'league_id' }) && isErr(o.dl_b2, 'bad', { what: 'league_id' })
    && isErr(o.dl_b3, 'bad', { what: 'league_id' }) && isErr(o.dl_b4, 'bad', { what: 'league_id' }), J([o.dl_b1, o.dl_b2, o.dl_b3, o.dl_b4]));
  /* P5（p5_sadame v1.3 §5） */
  {
    const d = o.p5_def, v2 = o.p5_v2, rq = o.p5_req, ids = o.p5_ids || [];
    const sids = (x) => (x && x.st && x.st.sessions ? x.st.sessions.map((z) => z.session_id) : null);
    const tsid = (x) => (x && x.st && x.st.tables ? [...new Set(x.st.tables.map((t) => t.session_id))] : null);
    const want = ids.slice(P5_N - 4);   // (a) 98〜100（取り消し）＋(b) 97
    ok('P5 塊が回った（人4・リーグ・100開催）', !o.p5_err && isOk(o.p5_m) && isOk(o.p5_lc) && ids.length === P5_N, J([o.p5_err, o.p5_m, o.p5_lc, ids.length]));
    ok('P5 既定の loaded＝(a) 最後の3（取り消しも）＋(b) 取り消していない最後・(created_at, id) の順', isOk(d) && d.st.v === 3 && J(d.st.loaded) === J(want) && J(d.st.absent) === '[]', J(d && d.st ? [d.st.loaded, d.st.absent] : d).slice(0, 400));
    ok('P5 開催の頭は全部（リーグの日は出ない）・卓・半荘・cells は loaded の開催だけ', isOk(d) && J(sids(d)) === J(ids) && J(tsid(d)) === J(want) && d.st.hanchans.length === 4 * P5_H
      && d.st.hanchans.every((h) => d.st.tables.some((t) => t.table_id === h.table_id)), J([sids(d) && sids(d).length, tsid(d), d && d.st && d.st.hanchans.length]));
    const sub = (x, keep) => { const k = new Set(keep); const tt = x.st.tables.filter((t) => k.has(t.session_id)); const ti = new Set(tt.map((t) => t.table_id));
      return { tables: tt, hanchans: x.st.hanchans.filter((h) => ti.has(h.table_id)), extras: x.st.extras.filter((e) => ti.has(e.table_id)), settles: x.st.settles.filter((z) => k.has(z.session_id)) }; };
    ok('P5 読んだ開催の中身は v2 の全部の読みと同じ（卓・半荘の no・cells・extras・settles）', isOk(d) && isOk(v2) && canon(sub(d, want)) === canon(sub(v2, want)));
    ok('P5 sessions 指定＝その開催が増える・他の部屋／無い id／リーグの日＝absent（頼んだ順）・中身は返さない', isOk(rq) && J(rq.st.loaded) === J([ids[4], ...want])
      && J(rq.st.absent) === J([S1, P5_RAND, o.p5_lg]) && J(tsid(rq)) === J([ids[4], ...want]), J(rq && rq.st ? [rq.st.loaded, rq.st.absent] : rq).slice(0, 500));
    ok('P5 p_args.v の無い読みは今の v2 の全部（st.v 2・loaded／absent 無し・members に n 無し）', isOk(v2) && v2.st.v === 2 && !('loaded' in v2.st) && !('absent' in v2.st)
      && v2.st.members.every((m) => !('n' in m)) && J(tsid(v2)) === J(ids), J(v2 && v2.st ? [v2.st.v, Object.keys(v2.st)] : v2).slice(0, 300));
    ok('P5 v が 3 でない（字の 3・4）も v2 の全部', isOk(o.p5_vs) && o.p5_vs.st.v === 2 && isOk(o.p5_v4) && o.p5_v4.st.v === 2 && !('loaded' in o.p5_v4.st));
    const stat = (st, mid) => { const hs = st.hanchans.filter((h) => !h.voided && h.seats.includes(mid)); let last = null;
      for (const h of hs) { const t = st.tables.find((x) => x.table_id === h.table_id); const z = t && st.sessions.find((x) => x.session_id === t.session_id); if (z && (!last || z.date > last)) last = z.date; }
      return { n: hs.length, last }; };
    const nl = isOk(d) && isOk(v2) ? d.st.members.map((m) => [m.name, m.n, m.last, stat(v2.st, m.member_id)]) : [];
    ok('P5 members の n／last＝全開催の数（取り消した半荘は数えない・画面の memberStats と同じ）', nl.length >= 4 && nl.every(([, n, last, w]) => n === w.n && last === w.last)
      && nl.filter(([, n]) => n === P5_N * P5_H - 1).length === 4, J(nl).slice(0, 500));
    ok('P5 sessions の形の誤り（51本・uuid でない・配列でない・数）→ bad what sessions', isErr(o.p5_b1, 'bad', { what: 'sessions' }) && isErr(o.p5_b2, 'bad', { what: 'sessions' })
      && isErr(o.p5_b3, 'bad', { what: 'sessions' }) && isErr(o.p5_b4, 'bad', { what: 'sessions' }), J([o.p5_b1, o.p5_b2, o.p5_b3, o.p5_b4]));
    ok('P5 50本の無い id は ok・全部 absent・sessions null は既定の読み', isOk(o.p5_b50) && o.p5_b50.st.absent.length === 50 && isOk(o.p5_sn) && J(o.p5_sn.st.loaded) === J(want));
    ok('P5 v 3 でも since が今の版 → same', o.p5_same && o.p5_same.ok === true && o.p5_same.same === true, J(o.p5_same));
    const ms = (a, b) => Math.round((Date.parse(o[b]) - Date.parse(o[a])));
    const bd = J(d || {}).length, b2 = J(v2 || {}).length, br = J(rq || {}).length;
    P5_MEASURE = { def_bytes: bd, v2_bytes: b2, req_bytes: br, def_ms: ms('p5_t0', 'p5_t1'), v2_ms: ms('p5_t1', 'p5_t2'), req_ms: ms('p5_t2', 'p5_t3') };
    ok('P5 既定の読みの大きさが v2（' + P5_N * P5_H + '半荘）の 1/20 以下', isOk(d) && bd * 20 <= b2, J(P5_MEASURE));
  }
  /* §4-3 */
  ok('§4-3（H1′）history_count 20000 の部屋で member_add → ok', isOk(o.fc_ma), J(o.fc_ma));
  ok('§4-3（H1′）その部屋で room_close → ok・数えは書いた分だけ増える（たたまない）', isOk(o.fc_cl) && Number(o.fc_hc) >= 2, J([o.fc_cl, o.fc_hc]));
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
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const WZ = [
  ['W1 ok の組で read_ver を足さない', () => brk('public.mj_write', [['update mahjong.rooms x set read_ver = x.read_ver + 1,', 'update mahjong.rooms x set read_ver = x.read_ver,']]),
    ['§4-2 書いた後 read_ver+1']],
  ['W3 開催の重なりの門を外す', () => brk('mahjong_private.mj_w_op', [['if v_ida is not null and not exists (select 1 from mahjong.settle_snaps z where z.session_id = v_ida) then', 'if false then']]),
    ['§4-2 開催の重なりの門：締めの無い']],
  ['W4 出された人を通す', () => brk('public.mj_read', [['if v_role is not null and exists (select 1 from mahjong.room_bans b', 'if false and exists (select 1 from mahjong.room_bans b']]),
    ['§4-2 出された人の印が在れば']],
  ['W5 since を見ない', () => brk('public.mj_read', [['if v_since is not null and (v_since::text)::numeric = r.read_ver then', 'if false then']]),
    ['§4-2 since が今の版']],
  ['W6 cells を席の順でなく版の順に並べる', () => brk('public.mj_read', [["'cells', (select pg_catalog.jsonb_agg(c.value order by c.seat)", "'cells', (select pg_catalog.jsonb_agg(c.value order by c.version desc, c.seat desc)"]]),
    ['§4-1 流れ 5 cell を2つ直す']],
  ['W7 extras の値を版に替える', () => brk('public.mj_read', [["'kind', e.kind, 'value', e.value,", "'kind', e.kind, 'value', e.version,"]]),
    ['§4-1 流れ 10 extras 全種']],
  ['W8 leagues の段を外す', () => brk('public.mj_read', [["'st', v_st, 'leagues', v_lg);", "'st', v_st);"]]),
    ['D1 リーグの段は st の外']],
  ['W9 l を常に true', () => brk('public.mj_read', [["'l', l.owner_user_id = v_me or", "'l', true or"]]),
    ['D1 l は L の人だけ']],
  ['W10 他の部屋の where を外す', () => brk('public.mj_read', [['into v_lg from mahjong.leagues l where l.room_id = p_room_id and (v_lid is null or l.id = v_lid);', 'into v_lg from mahjong.leagues l where (v_lid is null or l.id = v_lid);']]),
    ['D1 他の部屋のリーグが出ない']],
  ['W11 版の結びを外す（いつも1版）', () => brk('public.mj_read', [['q.id = l.rule_set_id and q.version = l.rule_version)', 'q.id = l.rule_set_id and q.version = 1)']]),
    ['D1 league_save の後']],
  ['W12 league の where league_id を外す（部屋の全部の日）', () => brk('public.mj_read', [['x.league_id is not distinct from v_lid', '(v_lid is not null or x.league_id is null)']]),
    ['D2 st はそのリーグの日だけ']],
  ['W13 days を今のリーグの版にする', () => brk('public.mj_read', [["'rules', (select q.rules from mahjong.rule_sets q where q.id = x.rule_set_id and q.version = x.rule_version),", "'rules', (select q.rules from mahjong.rule_sets q join mahjong.leagues l2 on l2.id = x.league_id where q.id = l2.rule_set_id and q.version = l2.rule_version),"]]),
    ['D2 league_save の後も前の日']],
  ['W14 他の部屋のリーグを通す', () => brk('public.mj_read', [['where l.id = v_lid and l.room_id = p_room_id) then', 'where l.id = v_lid) then']]),
    ['D2 他の部屋のリーグ']],
  ['W15 P5 (a) の 3 を 2 に', () => brk('public.mj_read', [['order by y.created_at desc, y.id desc limit 3)', 'order by y.created_at desc, y.id desc limit 2)']]),
    ['P5 既定の loaded']],
  ['W16 P5 (b) を外す', () => brk('public.mj_read', [['and not y.voided order by y.created_at desc, y.id desc limit 1)', 'and false order by y.created_at desc, y.id desc limit 1)']]),
    ['P5 既定の loaded']],
  ['W17 P5 sessions の部屋の確かめを外す', () => brk('public.mj_read', [["where x.room_id = p_room_id and x.league_id is null\n         and (x.id in", "where (x.room_id = p_room_id and x.league_id is null or x.id = any(v_req))\n         and (x.id in"]]),
    ['P5 sessions 指定']],
  ['W18 P5 n に取り消した半荘を入れる', () => brk('public.mj_read', [['and s2.league_id is null and not h2.voided', 'and s2.league_id is null']]),
    ['P5 members の n']],
  ['W19 P5 v 3 の印を見ずに分ける', () => brk('public.mj_read', [["(p_args -> 'v') = '3'::jsonb then", 'true then']]),
    ['P5 p_args.v の無い読み']],
];

let pass = 0, fail = 0;
var P5_MEASURE = null;
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
  if (P5_MEASURE) console.log('  P5 測り（バイト・倉庫の中の ms）：' + J(P5_MEASURE));
  console.log(`\nread: ${pass} passed, ${fail} failed`);
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
    console.log(`\nread --waza: ${red}/${WZ.length} 狙いが赤になった`);
    process.exitCode = red === WZ.length && fail === 0 ? 0 : 1;
  }
}
