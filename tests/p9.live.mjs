/* p9.live.mjs — ★P9（pbundle_sadame v2.1 §1・§5）を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/pbundle_sadame.md §1（全員の窓 all1d・all1m をやめる・重み・書きの量の見張り wwatch）。
 *  W 書き：入の1行で write:all* の行が増えない・小さい組の重み＝行の数（u1m +1）・32KB の締め1つの重み＝32（u1m・ur1m・uk1d・rk1d・u1d が +32）
 *  E 見張り mahjong_private.mj_wwatch()：
 *    E0 表が空なら from＝history の max(id)（今から数える・rows 0）
 *    E1 書いた後の1回＝(from, to] が書いた行の数だけ進む・bytes＝pg_column_size の和・同じ時の同じ from は1行（上書き）・limits の行は増えない
 *    E2 1回で進むのは 50,000 まで
 *    E3 大きさが読めない回（塊の中で sum を 1/0 にした関数）＝bytes null で行を書き、先へ進む
 *    E4 alert＝24時間の rows の和 200,000 は null・200,001 で rows24・bytes 200MB 越えで bytes24・rooms_all 5,001 で rooms_all・25時間前の行は和に入れない
 *    E5 30日より古い行は消える・29日は残る
 *    E6 anon・authenticated は mj_wwatch を呼べない・表 wwatch は RLS 在り・読めも書けもしない
 *  （mj_wwatch を呼ぶのが cron の mj-wwatch だけなのは db-checks.live.mjs が見る）
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。塊の始めに wwatch を exclusive で押さえる＝cron の1回はその間 lock_timeout 1s で捨てる（関数の中で受ける）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか
 * 使い方: node tests/p9.live.mjs [--waza]
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
const MAIL = 'mj-p9.invalid';
const NB = 'p9' + crypto.randomBytes(3).toString('hex');
const PASS = '3852';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%' and kind not like 'write:all%';`;
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
/* 窓の数え（呼びの前後で比べる）＝自分の人・部屋の行だけ＋write:all* は全部の行の数 */
const LS = (k, key) => `(select coalesce(sum(l.count), 0) from mahjong.limits l where l.kind = 'write:${k}' and l.key = ${key})`;
const CNT = `jsonb_build_object('u', ${LS('u1m', 'us[1]::text')}, 'ur', ${LS('ur1m', "ra::text || ':' || us[1]::text")}, 'uk', ${LS('uk1d', "ra::text || ':' || us[1]::text")},
  'rk', ${LS('rk1d', 'ra::text')}, 'ud', ${LS('u1d', 'us[1]::text')}, 'all', (select count(*) from mahjong.limits l where l.kind like 'write:all%'),
  'h', (select count(*) from mahjong.history h where h.room_id = ra))`;
const W = (key, ops) => `${RS} cx := ${CNT};
    ${T(key, `public.mj_write(ra, gen_random_uuid(), ${jb(ops)})`)}
    res := res || jsonb_build_object('${key}_c0', cx, '${key}_c1', ${CNT});`;
const WW = `(select coalesce(jsonb_agg(jsonb_build_object('hour', w.hour, 'from', w.from_id, 'to', w.to_id, 'rows', w.rows, 'bytes', w.bytes, 'rooms', w.rooms_all, 'alert', w.alert) order by w.hour, w.from_id), '[]') from mahjong.wwatch w)`;
const MX = `(select coalesce(max(h.id), 0) from mahjong.history h)`;
const HOUR = `date_trunc('hour', now())`;
const CALL = `perform mahjong_private.mj_wwatch();`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const M0 = U(), M1 = U(), S1 = U();
const PADN = 32768 - 13;   // content {"p": "x…"} の字の長さ＝N＋9・used {}＝2・missing []＝2 → 和 32,768＝締めの門のちょうど上限
const BIG = { op: 'settle_snap', session_id: S1, rev: 1, content: { p: 'x'.repeat(PADN) }, used: {}, missing: [] };

const mkSql = (prefix = '') => `do ${q('p9')} declare res jsonb := '{}'; r jsonb; cx jsonb; ra uuid; i int;
  us uuid[] := '{}'; ss uuid[] := '{}'; v_mx0 bigint; v_mx1 bigint; v_lc bigint; v_t timestamptz; v_def text;
begin
  ${prefix}
  lock table mahjong.wwatch in exclusive mode;
  for i in 1..2 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 2) k;
  ${undo('s', `
    -- E6 権限
    ${ROW('perm', `select jsonb_build_object(
        'anon_x', has_function_privilege('anon', 'mahjong_private.mj_wwatch()', 'execute'),
        'auth_x', has_function_privilege('authenticated', 'mahjong_private.mj_wwatch()', 'execute'),
        'rls', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'mahjong' and c.relname = 'wwatch'),
        'anon_t', has_table_privilege('anon', 'mahjong.wwatch', 'select') or has_table_privilege('anon', 'mahjong.wwatch', 'insert'),
        'auth_t', has_table_privilege('authenticated', 'mahjong.wwatch', 'select') or has_table_privilege('authenticated', 'mahjong.wwatch', 'insert'))`)}
    -- E0 空の表
    delete from mahjong.wwatch;
    v_mx0 := ${MX};
    ${CALL}
    ${ROW('e0', WW)} ${ROW('mx0', 'select v_mx0')}
    -- W 書き
    delete from mahjong.limits where kind like 'create:%' or kind like 'join:%';
    ${asWho(1)}
    ${T('made', `public.mj_room_create(gen_random_uuid(), ${lit(NB)}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`)}
    ra := (r->>'room_id')::uuid;
    ${W('w1', [{ op: 'member_add', member_id: M0, name: '山田' }])}
    ${W('w2', [{ op: 'member_add', member_id: M1, name: '鈴木' }, { op: 'session_add', session_id: S1, date: '2026-11-27', rate: 100 }])}
    ${W('big', [BIG])}
    ${ROW('bigsz', `select octet_length(z.content::text) + octet_length(z.used::text) + octet_length(z.missing::text) from mahjong.settle_snaps z where z.session_id = '${S1}' and z.rev = 1`)}
    -- E1 の前：見張りの印を今の書きの直前に置き直す（試しの塊は全部戻す＝戻した取引の id の空きが 50,000 を越えると E1 が1回で届かない・11-27 khaw で 61,488）
    v_mx0 := (select pg_catalog.min(h.id) - 1 from mahjong.history h where h.room_id = ra);
    update mahjong.wwatch set from_id = v_mx0, to_id = v_mx0;
    ${ROW('mx0e1', 'select v_mx0')}
    -- E1 書いた後の1回
    v_mx1 := ${MX};
    v_lc := (select count(*) from mahjong.limits);
    v_t := clock_timestamp();
    ${CALL}
    ${ROW('e1ms', 'select extract(epoch from clock_timestamp() - v_t) * 1000')}
    ${ROW('e1lim', 'select (select count(*) from mahjong.limits) - v_lc')}
    ${ROW('e1', WW)} ${ROW('mx1', 'select v_mx1')}
    ${ROW('e1bytes', `select coalesce(sum(coalesce(pg_column_size(h.before_value), 0) + coalesce(pg_column_size(h.after_value), 0) + coalesce(pg_column_size(h.fold), 0)), 0) from mahjong.history h where h.id > v_mx0 and h.id <= v_mx1`)}
    -- E2 50,000 まで
    delete from mahjong.wwatch;
    insert into mahjong.wwatch (hour, from_id, to_id, rows) values (${HOUR} - interval '2 hours', v_mx1 - 60000, v_mx1 - 60000, 0);
    ${CALL}
    ${ROW('e2', WW)}
    -- E3 大きさが読めない回（今の関数の sum を 1/0 に）
    delete from mahjong.wwatch;
    insert into mahjong.wwatch (hour, from_id, to_id, rows) values (${HOUR} - interval '2 hours', v_mx1 - 5, v_mx1 - 5, 0);
    ${undo('e3', `
      v_def := pg_get_functiondef('mahjong_private.mj_wwatch()'::regprocedure);
      if position('from mahjong.history h where h.id > v_from' in v_def) = 0 then raise exception 'E3 の壊す字が無い'; end if;
      execute replace(v_def, 'from mahjong.history h where h.id > v_from', 'from mahjong.history h where 1 / 0 = 1 and h.id > v_from');
      ${CALL}
      ${ROW('e3', WW)}`)}
    -- E4 alert（25時間前の大きい行は和に入れない）
    delete from mahjong.wwatch;
    insert into mahjong.wwatch (hour, from_id, to_id, rows, bytes) values
      (${HOUR} - interval '25 hours', 1, 2, 1000000000, 1000000000000),
      (${HOUR} - interval '1 hour', 3, v_mx1, 200000, 0);
    update mahjong.totals set rooms_all = 5000 where id = 1;
    ${CALL} ${ROW('a0', `select w.alert from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    ${ROW('a0rooms', `select w.rooms_all from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    delete from mahjong.wwatch w where w.hour = ${HOUR};
    update mahjong.wwatch w set rows = 200001 where w.from_id = 3;
    ${CALL} ${ROW('a1', `select w.alert from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    delete from mahjong.wwatch w where w.hour = ${HOUR};
    update mahjong.wwatch w set rows = 0, bytes = 200 * 1024 * 1024 where w.from_id = 3;
    ${CALL} ${ROW('a2', `select w.alert from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    delete from mahjong.wwatch w where w.hour = ${HOUR};
    update mahjong.wwatch w set bytes = 200 * 1024 * 1024 + 1 where w.from_id = 3;
    ${CALL} ${ROW('a3', `select w.alert from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    delete from mahjong.wwatch w where w.hour = ${HOUR};
    update mahjong.wwatch w set bytes = 0 where w.from_id = 3;
    update mahjong.totals set rooms_all = 5001 where id = 1;
    ${CALL} ${ROW('a4', `select w.alert from mahjong.wwatch w where w.hour = ${HOUR} and w.from_id = v_mx1`)}
    -- E5 30日
    delete from mahjong.wwatch;
    insert into mahjong.wwatch (hour, from_id, to_id, rows) values (${HOUR} - interval '31 days', 1, 2, 0), (${HOUR} - interval '29 days', 3, v_mx1, 0);
    ${CALL}
    ${ROW('e5', WW)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('p9')};`;

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
  const d = (k) => { const a = o[k + '_c0'], b = o[k + '_c1']; return a && b ? Object.fromEntries(Object.keys(a).map((x) => [x, Number(b[x]) - Number(a[x])])) : null; };
  const p = o.perm || {};
  ok('E6 anon・authenticated は mj_wwatch を呼べない・wwatch は RLS 在り・読めも書けもしない', p.anon_x === false && p.auth_x === false && p.rls === true && p.anon_t === false && p.auth_t === false, J(p));
  const e0 = o.e0 || [];
  ok('E0 空の表＝1行・from＝to＝history の max(id)・rows 0', e0.length === 1 && Number(e0[0].from) === Number(o.mx0) && Number(e0[0].to) === Number(o.mx0) && Number(e0[0].rows) === 0, J([e0, o.mx0]));
  ok('台：部屋を作る・書き3つが ok', o.made?.ok === true && [o.w1, o.w2, o.big].every((x) => x?.ok === true), J([o.made, o.w1, o.w2, o.big?.ok === true ? 'ok' : o.big]).slice(0, 600));
  const w1 = d('w1'), w2 = d('w2'), bg = d('big');
  ok('W 1行の組（持ち主）＝u1m・ur1m・uk1d・rk1d・u1d +1・write:all* の行は増えない', w1 && w1.h === 1 && w1.u === 1 && w1.ur === 1 && w1.uk === 1 && w1.rk === 1 && w1.ud === 1 && w1.all === 0, J(w1));
  ok('W 2行の組＝重み 2（行の数のまま）・all 0', w2 && w2.h === 2 && w2.u === 2 && w2.ud === 2 && w2.all === 0, J(w2));
  ok('W 締めの大きさがちょうど 32,768', Number(o.bigsz) === 32768, J(o.bigsz));
  ok('W 32KB の締め1つ＝重み 32（u1m・ur1m・uk1d・rk1d・u1d +32）・履歴は1行・all 0', bg && bg.h === 1 && bg.u === 32 && bg.ur === 32 && bg.uk === 32 && bg.rk === 32 && bg.ud === 32 && bg.all === 0, J(bg));
  const e1 = o.e1 || [];
  const mx0 = Number(o.mx0e1), mx1 = Number(o.mx1);
  ok('E1 書いた後の1回＝同じ時の同じ from は1行（上書き）・from＝前の max・to＝今の max・rows＝その差（≥ 4）', e1.length === 1 && Number(e1[0].from) === mx0 && Number(e1[0].to) === mx1 && Number(e1[0].rows) === mx1 - mx0 && mx1 - mx0 >= 4, J([e1, mx0, mx1]));
  ok('E1 bytes＝(from, to] の pg_column_size の和（> 0）', e1.length === 1 && Number(e1[0].bytes) === Number(o.e1bytes) && Number(o.e1bytes) > 0, J([e1[0]?.bytes, o.e1bytes]));
  ok('E1 limits の行は増えない（見張りは limits に書かない）', Number(o.e1lim) === 0, J(o.e1lim));
  ok('E1 1回は 1,000ms 未満', Number(o.e1ms) < 1000, J(o.e1ms));
  const e2 = (o.e2 || []).find((w) => Number(w.from) === mx1 - 60000 && Number(w.rows) > 0) || (o.e2 || []).filter((w) => Number(w.from) === mx1 - 60000).pop();
  ok('E2 1回で進むのは 50,000 まで', (o.e2 || []).length === 2 && e2 && Number(e2.to) === mx1 - 10000 && Number(e2.rows) === 50000, J(o.e2));
  const e3 = (o.e3 || []).filter((w) => Number(w.from) === mx1 - 5 && Number(w.to) === mx1);
  ok('E3 大きさが読めない回＝bytes null で行を書いて先へ進む（rows 5）', (o.e3 || []).length === 2 && e3.length === 1 && e3[0].bytes === null && Number(e3[0].rows) === 5, J(o.e3));
  ok('E4 24時間の rows 200,000・rooms_all 5,000 → alert null（25時間前は数えない）・rooms_all を書く', o.a0 === null && Number(o.a0rooms) === 5000, J([o.a0, o.a0rooms]));
  ok('E4 rows 200,001 → rows24=200001', o.a1 === 'rows24=200001', J(o.a1));
  ok('E4 bytes 200MB ちょうど → null', o.a2 === null, J(o.a2));
  ok('E4 bytes 200MB＋1 → bytes24=209715201', o.a3 === 'bytes24=209715201', J(o.a3));
  ok('E4 rooms_all 5,001 → rooms_all=5001', o.a4 === 'rooms_all=5001', J(o.a4));
  const e5 = o.e5 || [];
  ok('E5 31日前の行は消え・29日前は残る（＋今の1行）', e5.length === 2 && !e5.some((w) => Number(w.from) === 1) && e5.some((w) => Number(w.from) === 3), J(e5));
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
const WF = 'mahjong_private.mj_wwatch';
const WZ = [
  ['Z1 1回の幅を見ない', () => brk(WF, [['v_from + 50000', 'v_from + 50000000']]), ['E2']],
  ['Z2 大きさの例外を受けない', () => brk(WF, [['v_bytes := null;', 'raise;']]), ['E3']],
  ['Z3 空の表で 0 から数える', () => brk(WF, [['v_from := coalesce(v_from, v_max);', 'v_from := coalesce(v_from, 0);']]), ['E0']],
  ['Z4 rows の線が 1 ずれる', () => brk(WF, [['v_r24 > 200000', 'v_r24 > 200001']]), ['E4 rows 200,001']],
  ['Z5 30日で消さない', () => brk(WF, [["interval '30 days' limit 1000", "interval '3000 days' limit 1000"]]), ['E5']],
  ['Z6 24時間の窓を見ない', () => brk(WF, [["where w.hour > pg_catalog.now() - interval '24 hours'", 'where true']]), ['E4 24時間']],
  ['Z7 重みが大きさを見ない', () => brk('public.mj_write', [['/ 1024.0)::int)', '/ 1024000.0)::int)']]), ['W 32KB']],
  ['Z8 全員の窓 all1d を戻す', () => brk('mahjong_private.mj_w_count', [["('write:rk1d',  v_rk,       true,", "('write:all1d', 'all',      true,  case when p_room is null then 0 else v_d end),\n      ('write:rk1d',  v_rk,       true,"]]), ['W 1行の組']],
];

let pass = 0, fail = 0;
const say = (name, c, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' — ' + String(info).slice(0, 900) : '')); } };
const leftCheck = async () => {
  const { text } = await mq(`select (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.rooms where name like '${NB}%') as r,
    (select count(*)::int from mahjong.wwatch where from_id in (1, 3)) as w, (select count(*)::int from pg_proc where prosrc like '%1 / 0 = 1 and h.id > v_from%') as f`);
  let j = null; try { j = JSON.parse(text)[0]; } catch (_) { /* 字 */ }
  say('倉庫に試しの人・部屋・見張りの行・壊した関数が残っていない', j && j.u === 0 && j.r === 0 && j.w === 0 && j.f === 0, text.slice(0, 200));
};

const only = process.env.MJ_WAZA_ONLY;
if (!WAZA) {
  const r = await runA('');
  if (r.err) say('塊が回った', false, r.err);
  else for (const [n, c, info] of check(r.out)) say(n, c, info);
  await leftCheck();
  console.log(`\np9: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} else {
  const r0 = await runA('');
  const L0 = r0.err ? null : check(r0.out);
  if (!L0 || L0.some(([, c]) => !c)) {
    console.log('★中止★ 壊す前の素の回りが緑でない＝--waza は数えない: ' + (r0.err || L0.filter(([, c]) => !c).map(([n]) => n).join(' ／ ')));
    process.exitCode = 1;
  } else {
    console.log(`  素の回り：${L0.length} passed, 0 failed（緑）`);
    let red = 0, n = 0;
    for (const [name, mk, wants] of WZ) {
      if (only && !name.includes(only)) continue;
      n++;
      const rr = await runA(mk());
      const L = rr.err ? null : check(rr.out);
      const hit = L && L.filter(([nm, c]) => !c && wants.some((w) => nm.startsWith(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${rr.err ? '塊が落ちた ' + rr.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([nm]) => nm).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\np9 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
