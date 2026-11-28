/* c22.live.mjs — ★C2-1 §1b の倉庫：public.mj_account('my_stats') を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/c2_db.md §1b・試験 c2_shiken.md §4 の DB の項（out anon・no out table w/o me・ban/deleted/unlinked・busy・paging・al.t/al.h）。
 *   A＝持ち主（M0）・B＝入で M1 につないで抜ける人・C＝入でつないでいない人・D＝入で M4 につないで出された人（room_bans）。
 *   S1：T1（H1 に B が座る・H2 は座らない）・T2（B は半荘に座らず枚 +2）・T3（B 無し）・T5（H7 に B・抜けた後に触らない）・T6（H8 に B・抜けた後は他の人の枚だけ触る）。S2：T4（H5 に B）。
 *   B が抜けた後に A が：H1 の点を直す・T2 で他の人の枚・S2 を取り消す・T1 に B が座る H6。
 *   B の読み＝out・卓は T1 T2 T4 T5 T6（T3 無し）・他の人は o1…（id も名も出ない）・al.t＝T1 T2 T4 T6・al.h＝H1 H6（S2 は取り消し＝H5 無し・T5 は触っていない・T6 は枚だけ＝H8 無し）
 *   A の読み＝in・members と settles 在り・卓 5 つ。C＝行0・unlinked 1。D＝行0。消した部屋＝行0。busy・形の誤り。
 *   頁：半荘の上限を 2 に下げた関数で A が頁を回す＝全部の卓が1回ずつ・最後だけ more false・at は同じ。
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか
 * 使い方: node tests/c22.live.mjs [--waza]
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
const MAIL = 'mj-c22.invalid';
const NB = 'c22' + crypto.randomBytes(3).toString('hex');
const PASS = '2741';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%' or kind = 'read:u1m';`;
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
const ACC = (key, args) => `${RS} ${T(key, `public.mj_account('my_stats', ${args})`)}`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100, chip_pt10: 20 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const NAMES = ['山田', '鈴木', '佐藤', '高橋', '伊藤'];
const M = [U(), U(), U(), U(), U()];
const S1 = U(), S2 = U();
const [T1, T2, T3, T4, T5, T6] = [U(), U(), U(), U(), U(), U()];
const [H1, H2, H3, H4, H5, H6, H7, H8] = [U(), U(), U(), U(), U(), U(), U(), U()];
const C4 = [40000, 30000, 20000, 10000];
const hs = (id, tid, seats) => ({ op: 'hanchan_start', hanchan_id: id, table_id: tid, seats: seats.map((i) => M[i]), cells: C4 });
const ta = (tid, sid, label, seats) => [{ op: 'table_add', table_id: tid, session_id: sid, label }, { op: 'table_seats', table_id: tid, seats: seats.map((i) => M[i]) }];
const BASE = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: NAMES[i] })),
  { op: 'session_add', session_id: S1, date: '2026-11-20', rate: 100 },
  ...ta(T1, S1, '卓1', [0, 1, 2, 3]), hs(H1, T1, [0, 1, 2, 3]), hs(H2, T1, [0, 2, 3, 4]),
  ...ta(T2, S1, '卓2', [1, 0, 2, 3]), hs(H3, T2, [0, 2, 3, 4]),
  { op: 'extra_add', table_id: T2, member_id: M[1], kind: 'chip', add: 2 }, { op: 'extra_add', table_id: T2, member_id: M[0], kind: 'chip', add: -2 },
  ...ta(T3, S1, '卓3', [0, 2, 3, 4]), hs(H4, T3, [0, 2, 3, 4]),
  ...ta(T5, S1, '卓5', [1, 0, 2, 3]), hs(H7, T5, [1, 0, 2, 3]),
  ...ta(T6, S1, '卓6', [1, 0, 2, 3]), hs(H8, T6, [1, 0, 2, 3]),
  // shared の部屋は S1 に締めが無いと S2 を作れない（dup what session の門）＝S1 を締めてから S2
  { op: 'settle_snap', session_id: S1, rev: 1, content: {}, used: {}, missing: [] },
  { op: 'session_add', session_id: S2, date: '2026-11-21', rate: 100 },
  ...ta(T4, S2, '卓4', [0, 1, 2, 3]), hs(H5, T4, [0, 1, 2, 3]),
];
const AFTER = [
  { op: 'cell_set', hanchan_id: H1, seat: 0, value: 41000, base_version: 1 },
  { op: 'extra_add', table_id: T2, member_id: M[2], kind: 'chip', add: 1 }, { op: 'extra_add', table_id: T2, member_id: M[3], kind: 'chip', add: -1 },
  { op: 'session_edit', session_id: S2, voided: true },
  // T6 は他の人の枚だけ＝卓は al.t に入るが、座った H8 は触っていない＝al.h に入れない（Z6）
  { op: 'extra_add', table_id: T6, member_id: M[2], kind: 'chip', add: 1 }, { op: 'extra_add', table_id: T6, member_id: M[3], kind: 'chip', add: -1 },
  hs(H6, T1, [1, 0, 2, 3]),
];
const lk = (i) => ({ op: 'member_link', member_id: M[i] });
const P1 = `jsonb_build_object('v', 1)`;

const mkSql = (prefix = '', paging = false) => `do ${q('c22')} declare res jsonb := '{}'; r jsonb; i int; ra uuid; pg jsonb := '[]'; nx jsonb;
  us uuid[] := '{}'; ss uuid[] := '{}';
begin
  ${prefix}
  for i in 1..4 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u; insert into mahjong.accounts (user_id, human_at) select u, now() from unnest(us) u on conflict (user_id) do update set human_at = now(); -- P10 印
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 4) k;
  res := res || jsonb_build_object('uids', to_jsonb(us));
  ${undo('s', `delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${asWho(1)}
    ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    ${ROW('kind', `select x.kind from mahjong.rooms x where x.id = ra`)}
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'nyu', 'name'), (ra, us[3], 'nyu', 'name'), (ra, us[4], 'nyu', 'name');
    ${W('b', BASE)}
    ${W('la', [lk(0)])}
    ${asWho(2)} ${W('lb', [lk(1)])}
    ${asWho(4)} ${W('ld', [lk(4)])}
    insert into mahjong.room_bans (room_id, user_id) values (ra, us[4]);
    delete from mahjong.room_accounts a where a.room_id = ra and a.user_id = us[4];
    ${asWho(2)} ${W('lv', [{ op: 'room_leave' }])}
    ${asWho(1)} ${W('af', AFTER)}
    -- 1つの塊の中では now() が塊の始め・開催の created_at は clock_timestamp()＝読みの at（now()）より後になる。本物は書きの塊が先に閉じる＝部屋と開催を1時間前へ（並びはそのまま）
    update mahjong.rooms x set created_at = x.created_at - interval '1 hour' where x.id = ra;
    update mahjong.sessions x set created_at = x.created_at - interval '1 hour' where x.room_id = ra;
    ${paging ? `${asWho(1)}
    ${RS} r := public.mj_account('my_stats', ${P1}); pg := pg || jsonb_build_array(jsonb_build_object('after', null, 'data', r));
    for i in 1..12 loop
      exit when coalesce((r->>'more')::boolean, false) is not true;
      nx := jsonb_build_object('v', 1, 'after', r->'next_after', 'at', r->'at');
      ${RS} r := public.mj_account('my_stats', nx); pg := pg || jsonb_build_array(jsonb_build_object('after', nx->'after', 'data', r));
    end loop;
    res := res || jsonb_build_object('pages', pg);` : `
    ${asWho(2)} ${ACC('rb', P1)}
    ${asWho(1)} ${ACC('ra', P1)}
    ${asWho(3)} ${ACC('rc', P1)}
    ${asWho(4)} ${ACC('rd', P1)}
    ${asWho(1)} ${ACC('past', `jsonb_build_object('v', 1, 'at', '2000-01-01T00:00:00Z', 'after', jsonb_build_object('room_id', '00000000-0000-0000-0000-000000000000', 'session_id', '00000000-0000-0000-0000-000000000000', 'created_at', '2000-01-01T00:00:00Z'))`)}
    ${T('e_what', `public.mj_account('x', ${P1})`)}
    ${T('e_v', `public.mj_account('my_stats', '{}'::jsonb)`)}
    ${T('e_after', `public.mj_account('my_stats', jsonb_build_object('v', 1, 'after', jsonb_build_object('room_id', ra, 'session_id', ra, 'created_at', '2026-01-01T00:00:00Z')))`)}
    ${T('e_tid', `public.mj_account('my_stats', jsonb_build_object('v', 1, 'at', '2030-01-01T00:00:00Z', 'after', jsonb_build_object('room_id', ra, 'session_id', '${S2}', 'created_at', '2026-01-01T00:00:00Z', 'table_id', '${T1}')))`)}
    ${RS} insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', us[1]::text, date_trunc('minute', now()), 90000);
    ${T('busy', `public.mj_account('my_stats', ${P1})`)}
    ${undo('del', `update mahjong.rooms x set deleted_at = now() where x.id = ra; ${ACC('rdel', P1)}`)}`}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('c22')};`;

async function runA(prefix, paging) {
  const { text } = await mq(mkSql(prefix, paging));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const KNOWN_H = new Set(['hanchan_id', 'table_id', 'no', 'seats', 'cells', 'cell_ver', 'ton_order', 'order_version', 'lost', 'version', 'tobi_to', 'tobi_version', 'voided', 'yakitori', 'yakitori_version', 'order_cells', 'created_at']);
const sortJ = (a) => J([...(a || [])].sort());
const myRow = (x, ra) => (x?.rows || []).find((w) => w.room_id === ra);
const isBad = (x, what) => x?.ok === false && x?.err === 'bad' && x?.what === what;

function checkBase(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  const ra = o.made?.room_id;
  ok('台：部屋・人・卓・半荘・枚・つなぎ・抜ける・抜けた後の書き', ra && [o.la, o.b, o.lb, o.ld, o.lv, o.af].every((x) => x?.ok === true), J([o.la, o.lb, o.ld, o.lv, o.af, o.b?.ok]).slice(0, 600));
  // B＝out
  const b = myRow(o.rb, ra);
  ok('§1b B：ok・その部屋の行は1つ・side out・me＝[M1]', o.rb?.ok === true && (o.rb.rows || []).filter((w) => w.room_id === ra).length === 1
    && b?.side === 'out' && J(b?.me) === J([M[1]]), J(o.rb).slice(0, 400));
  const bt = (b?.st?.tables || []).map((t) => t.table_id);
  ok('§1b no out table w/o me：out の卓は T1 T2 T4 T5 T6（T3 無し）', sortJ(bt) === sortJ([T1, T2, T4, T5, T6]), J(bt));
  const bh = (b?.st?.hanchans || []).map((h) => h.hanchan_id);
  ok('§1b out：その卓の半荘は全部（座っていない H2・H3 も・抜けた後の H6 も）', sortJ(bh) === sortJ([H1, H2, H3, H5, H6, H7, H8]), J(bh));
  const bx = b?.st?.extras || [];
  ok('§1b out：T2 の枚は全部（自分の +2・他の人の行も）', bx.filter((e) => e.table_id === T2).length === 4 && bx.some((e) => e.member_id === M[1] && e.value === 2), J(bx));
  const bs = J(b?.st);
  const others = [0, 2, 3, 4].map((i) => M[i]);
  ok('§1b out anon：他の人の member_id も名も無い・members と settles は返さない', b && others.every((m) => !bs.includes(m)) && NAMES.every((n) => !J(b).includes(n))
    && !('members' in (b.st || {})) && !('settles' in (b.st || {})), bs.slice(0, 400));
  const h1 = (b?.st?.hanchans || []).find((h) => h.hanchan_id === H1);
  const t1 = (b?.st?.tables || []).find((t) => t.table_id === T1);
  ok('§1b out anon：席は自分の M1 のまま・他は o1… の仮の id（半荘の席・卓の席・枚）', h1 && h1.seats[1] === M[1] && [0, 2, 3].every((k) => /^o\d+$/.test(h1.seats[k]))
    && t1 && t1.seats[1] === M[1] && t1.seats.filter((x) => /^o\d+$/.test(x)).length === 3
    && bx.filter((e) => e.member_id !== M[1]).every((e) => /^o\d+$/.test(e.member_id)), J([h1?.seats, t1?.seats]));
  ok('§1b out anon：同じ人は同じ仮の id（H1 の席0 と T1 の席0）', h1 && t1 && h1.seats[0] === t1.seats[0], J([h1?.seats, t1?.seats]));
  ok('§1b out：半荘の鍵は lib の KNOWN_H の中だけ', (b?.st?.hanchans || []).length > 0 && b.st.hanchans.every((h) => Object.keys(h).every((k) => KNOWN_H.has(k))), J(b?.st?.hanchans?.[0]).slice(0, 300));
  ok('§1b al.t＝抜けた後に触った卓 T1 T2 T4 T6（T5 は触っていない）', sortJ(b?.al?.t) === sortJ([T1, T2, T4, T6]), J(b?.al));
  ok('§1b al.h＝H1（点）・H6（抜けた後に座った）だけ（S2 を取り消した H5・T2 の枚・T6 の枚だけ（座った H8）・座っていない H2 は入らない）', sortJ(b?.al?.h) === sortJ([H1, H6]), J(b?.al));
  ok('§1b 開催にリーグの鍵・取り消しはそのまま返す（S2 voided）', (b?.st?.sessions || []).find((s) => s.session_id === S2)?.voided === true, J(b?.st?.sessions));
  ok('§1b 1頁で済む時：more false・next_after 無し・at は字', o.rb?.more === false && !('next_after' in (o.rb || {})) && typeof o.rb?.at === 'string', J([o.rb?.more, o.rb?.at]));
  ok('§1b B の1頁目 unlinked は {}', J(o.rb?.unlinked) === '{}', J(o.rb?.unlinked));
  // A＝in
  const a = myRow(o.ra, ra);
  ok('§1b A：side in・me＝[M0]・卓6・半荘8・members（名つき）と settles 在り・al 無し', a?.side === 'in' && J(a?.me) === J([M[0]]) && (a?.st?.tables || []).length === 6
    && (a?.st?.hanchans || []).length === 8 && (a?.st?.members || []).length === 5 && Array.isArray(a?.st?.settles) && !('al' in (a || {})), J(a).slice(0, 400));
  ok('§1b A：自分の名に me・抜けた B の名に taken+left', a && a.st.members.find((m) => m.member_id === M[0])?.me === true
    && a.st.members.find((m) => m.member_id === M[1])?.left === true, J(a?.st?.members));
  // C・D・消した部屋
  ok('§1b つないでいない C：その部屋の行は無い・unlinked に kind ごと1', o.rc?.ok === true && !myRow(o.rc, ra) && o.rc?.unlinked?.[o.kind] === 1, J(o.rc));
  ok('§1b 出された D（room_bans）：その部屋の行は無い・unlinked にも数えない', o.rd?.ok === true && !myRow(o.rd, ra) && !o.rd?.unlinked?.[o.kind], J(o.rd));
  ok('§1b 消した部屋：行は無い', o.rdel?.ok === true && !myRow(o.rdel, ra), J(o.rdel).slice(0, 200));
  ok('§1b at より後に作った部屋は入れない（at 2000 年）', o.past?.ok === true && (o.past.rows || []).length === 0 && !('unlinked' in o.past), J(o.past).slice(0, 200));
  // 門・形
  ok('§1b busy：read:u1m が 80,000ms を越えたら ok:false busy', o.busy?.ok === false && o.busy?.err === 'busy' && o.busy?.what === 'read', J(o.busy));
  ok('§1b 形の誤り：what・v・at の無い after・その開催に無い table_id', isBad(o.e_what, 'what') && isBad(o.e_v, 'v') && isBad(o.e_after, 'after') && isBad(o.e_tid, 'after'), J([o.e_what, o.e_v, o.e_after, o.e_tid]));
  const uids = (o.uids || []).map(String);
  ok('§1b 読みに user_id の字が無い', uids.length === 4 && [o.ra, o.rb, o.rc].every((x) => uids.every((u) => !J(x).includes(u))), '');
  return L;
}

function checkPaging(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('頁：塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const ra = o.made?.room_id;
  const pg = o.pages || [];
  ok('頁：全部 ok・2頁以上・最後だけ more false・at は全部同じ', pg.length >= 2 && pg.every((p) => p.data?.ok === true)
    && pg.every((p, i) => p.data.more === (i < pg.length - 1)) && pg.every((p) => p.data.at === pg[0].data.at), J(pg.map((p) => [p.data?.ok, p.data?.more, p.data?.at, p.data?.err])));
  ok('頁：next_after は {room_id, session_id, created_at[, table_id]}・次の頁の after と同じ', pg.slice(0, -1).every((p, i) => p.data.next_after?.room_id && p.data.next_after?.session_id
    && /Z$/.test(p.data.next_after?.created_at || '') && J(pg[i + 1].after) === J(p.data.next_after)), J(pg.map((p) => p.data?.next_after)));
  const rows = pg.flatMap((p) => (p.data?.rows || []).filter((w) => w.room_id === ra));
  const tids = rows.flatMap((w) => (w.st?.tables || []).map((t) => t.table_id));
  const hids = rows.flatMap((w) => (w.st?.hanchans || []).map((h) => h.hanchan_id));
  ok('頁：卓は全部が1回ずつ（T1〜T6）・半荘も1回ずつ（8）', sortJ(tids) === sortJ([T1, T2, T3, T4, T5, T6]) && hids.length === 8 && new Set(hids).size === 8, J([tids, hids.length]));
  ok('頁：1頁の半荘は上限 2 まで（1つの鎖だけの頁を除く）', pg.every((p) => { const w = myRow(p.data, ra); const n = (w?.st?.hanchans || []).length; return n <= 2 || (w?.st?.tables || []).length === 1; }),
    J(pg.map((p) => [(myRow(p.data, ra)?.st?.tables || []).length, (myRow(p.data, ra)?.st?.hanchans || []).length])));
  ok('頁：unlinked は1頁目だけ', 'unlinked' in (pg[0]?.data || {}) && pg.slice(1).every((p) => !('unlinked' in p.data)), '');
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
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t;
};
const AC = 'public.mj_account';
const SMALL = () => brk(AC, [['c_mh constant int := 2000', 'c_mh constant int := 2']]);
const WZ = [
  ['Z1 半荘の席を仮の id にしない', () => brk(AC, [["coalesce(v_map -> (e.value #>> '{}'), e.value) order by e.key::int", 'e.value order by e.key::int']]), ['§1b out anon']],
  ['Z2 out に自分の居ない卓も入れる', () => brk(AC, [["and (v_side = 'in'\n", "and (true or v_side = 'in'\n"]]), ['§1b no out table w/o me']],
  ['Z3 al が抜ける前の履歴も数える', () => brk(AC, [['h.id > v_left', 'h.id > 0']]), ['§1b al.t']],
  ['Z4 al.h が開催の取り消しを見ない', () => brk(AC, [['and not a.voided and not s.voided', 'and not a.voided']]), ['§1b al.h']],
  ['Z5 room_bans を見ない', () => brk(AC, [['and not exists (select 1 from mahjong.room_bans b where b.room_id = x.id and b.user_id = v_me)\n              order by x.id', 'order by x.id']]), ['§1b 出された D']],
  ['Z6 枚の行だけで al.h に全部の半荘', () => brk(AC, [["hit.tbl in ('tables', 'sessions') and hit.k in", "hit.tbl in ('tables', 'sessions', 'extras') and hit.k in"]]), ['§1b al.h']],
  ['Z7 門が busy を見ない', () => brk(AC, [["l.kind = 'read:u1m' and l.key = v_uk and l.window_start >= v_min - interval '1 minute') > 80000", "l.kind = 'read:u1m' and l.key = v_uk and l.window_start >= v_min - interval '1 minute') > 800000000"]]), ['§1b busy']],
  ['Z8 消した部屋も返す', () => brk(AC, [['where x.deleted_at is null and x.created_at <= v_at\n                and (v_ar', 'where x.created_at <= v_at\n                and (v_ar']]), ['§1b 消した部屋']],
  ['Z9 頁の上限を見ない（頁の回り）', () => brk(AC, [['c_mh constant int := 2000', 'c_mh constant int := 2000000']]), ['頁：全部 ok・2頁以上'], true],
  ['Z10 鎖で切った頁の続きで同じ鎖を飛ばさない（頁の回り）', () => brk(AC, [['c_mh constant int := 2000', 'c_mh constant int := 2'], ['and (ch.hcr, ch.hid) <= (v_akcr, v_akid)', 'and (ch.hcr, ch.hid) < (v_akcr, v_akid)']]), ['頁：卓は全部が1回ずつ'], true],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋が残っていない', j && j.u === 0 && j.r === 0, text.slice(0, 200));
};
const both = async (mkB, mkP) => {
  const a = await runA(mkB, false);
  const p = await runA(mkP, true);
  return { err: a.err || p.err, L: a.err || p.err ? null : [...checkBase(a.out), ...checkPaging(p.out)] };
};

const only = process.env.MJ_WAZA_ONLY;
if (!WAZA) {
  const r = await both('', SMALL());
  if (r.err) say('塊が回った', false, r.err);
  else for (const [n, c, info] of r.L) say(n, c, info);
  await leftCheck();
  console.log(`\nc22: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  const r0 = await both('', SMALL());
  if (!r0.L || r0.L.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (r0.err || r0.L.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    process.exitCode = 1;
  } else {
    console.log(`  素の回り：${r0.L.length} passed, 0 failed（緑）`);
    let red = 0, n = 0;
    for (const [name, mk, wants, pagingOnly] of WZ) {
      if (only && !name.includes(only)) continue;
      n++;
      const rr = pagingOnly ? await runA(mk(), true) : await runA(mk(), false);
      const L = rr.err ? null : (pagingOnly ? checkPaging(rr.out) : checkBase(rr.out));
      const hit = L && L.filter(([nm, c]) => !c && wants.some((w) => nm.startsWith(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${rr.err ? '塊が落ちた ' + rr.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([nm]) => nm).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\nc22 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
