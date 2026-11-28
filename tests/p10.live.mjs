/* p10.live.mjs — ★P10 Turnstile の倉庫：印（human_at）の無い垢は 作る・入る・書く が err human（値で返す）・読むは通る★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/p10_sadame_v1.md v1.1 §2・§5（設計前 taiketsu 止め6→naoshi 止め0）。
 *   A＝印あり（持ち主）・B＝印なし（後で mj_human_mark で印）・C＝印なし（部屋の入・読むだけ）・D＝印なし（当て直しで印が付かないか＝S4）。
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数・一度きりの塊をわざと壊して、狙った行が赤になるか（壊した物は塊の初めに当てる＝塊ごと戻る）
 * --pre：P10 をまだ当てていない倉庫で、塊の初めに P10 の所（一度きりの塊・mj_human_ok/mark・門の3関数）を当ててから回す（塊ごと戻る＝他の席に出ない）
 * 使い方: node tests/p10.live.mjs [--waza] [--pre]
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
const PRE = process.argv.includes('--pre');

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
const MAIL = 'mj-p10.invalid';
const NB = 'p10' + crypto.randomBytes(3).toString('hex');
const PASS = '4826';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%' or kind like 'create:%' or kind like 'join:%';`;
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

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/\r\n/g, '\n');
/* 一度きりの塊（S4）＝schema.sql の do $p10$ … end $p10$; をそのまま当て直す（execute の中の do） */
const ONCE = (() => {
  const a = SCHEMA.indexOf('do $p10$'); const b = SCHEMA.indexOf('end $p10$;', a);
  if (a < 0 || b < 0) throw new Error('一度きりの塊が見つからない');
  return SCHEMA.slice(a, b + 'end $p10$;'.length);
})();
const CREATE = (nm) => `public.mj_room_create(gen_random_uuid(), ${lit(nm)}, ${lit(PASS)}, ${jb(R4)}, jsonb_build_object('url_token_hash', md5(random()::text) || md5(random()::text)))`;
const JOIN = `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(NB)})`;
const WRITE = () => `public.mj_write(ra, gen_random_uuid(), ${jb([{ op: 'member_add', member_id: crypto.randomUUID(), name: '印の人' + crypto.randomBytes(2).toString('hex') }])})`;
const hum = (k, i) => ROW(k, `select jsonb_build_object('row', count(*)::int, 'h', count(a.human_at)::int) from mahjong.accounts a where a.user_id = us[${i}]`);
const cnt = (k, sel) => ROW(k, `select count(*)::int from ${sel}`);
const PUBQ = "select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('mj_human_ok', 'mj_human_mark')";

const mkSql = (prefix = '', once = ONCE) => `do ${q('p10t')} declare res jsonb := '{}'; r jsonb; ra uuid; h1 timestamptz;
  us uuid[] := '{}'; ss uuid[] := '{}'; i int;
begin
  ${prefix}
  ${ROW('acc_null', 'select count(*)::int from mahjong.accounts where human_at is null')}
  for i in 1..4 loop us := us || gen_random_uuid(); ss := ss || gen_random_uuid(); end loop;
  insert into auth.users (id, email, aud, role, is_anonymous) select u, u::text || '@${MAIL}', 'authenticated', 'authenticated', false from unnest(us) u;
  insert into auth.sessions (id, user_id) select ss[k], us[k] from generate_series(1, 4) k;
  insert into mahjong.accounts (user_id, human_at) values (us[1], now()) on conflict (user_id) do update set human_at = now();
  insert into mahjong.accounts (user_id) values (us[4]) on conflict (user_id) do update set human_at = null;
  ${undo('s', `${RS}
    ${hum('b0', 2)}
    ${asWho(2)}
    ${T('bc', CREATE(NB + 'b'))}
    ${cnt('bc_rooms', `mahjong.rooms where name like '${NB}%'`)}
    ${cnt('bc_lim', `mahjong.limits where key = us[2]::text or kind like 'create:%'`)}
    ${asWho(1)}
    ${T('ac', CREATE(NB))}
    ra := (r->>'room_id')::uuid;
    ${asWho(2)} ${RS}
    ${T('bj', JOIN)}
    ${cnt('bj_ra', `mahjong.room_accounts where room_id = ra and user_id = us[2]`)}
    ${cnt('bj_lim', `mahjong.limits where kind like 'join:%'`)}
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'nyu', 'name'), (ra, us[3], 'nyu', 'name');
    ${cnt('h0', `mahjong.history h where h.room_id = ra`)}
    ${T('bw', WRITE())}
    ${cnt('bw_h', `mahjong.history h where h.room_id = ra`)}
    ${asWho(3)}
    ${T('cr', `public.mj_read(ra, 'room', null)`)}
    ${T('cm', 'public.mj_my_rooms(null, null, 20)')}
    ${T('cu', 'public.mj_my_rules()')}
    ${T('cs', `public.mj_account('my_stats', null)`)}
    ${T('cw', WRITE())}
    ${hum('c1', 3)}
    perform set_config('request.jwt.claims', '', true);
    ${ROW('mk', 'mahjong_private.mj_human_mark(us[2])')}
    ${ROW('mk0', 'mahjong_private.mj_human_mark(gen_random_uuid())')}
    h1 := (select a.human_at from mahjong.accounts a where a.user_id = us[2]);
    ${ROW('mk2', 'mahjong_private.mj_human_mark(us[2])')}
    ${ROW('mk_same', '(select a.human_at from mahjong.accounts a where a.user_id = us[2]) = h1')}
    delete from mahjong.accounts where user_id = us[3];
    ${ROW('mk3', 'mahjong_private.mj_human_mark(us[3])')}
    ${hum('c2', 3)}
    ${asWho(2)} ${RS}
    ${T('bw2', WRITE())}
    ${T('bc2', CREATE(NB + 'c'))}
    perform set_config('request.jwt.claims', '', true);
    ${ROW('g', `jsonb_build_object(
      'mark_auth', has_function_privilege('authenticated', 'mahjong_private.mj_human_mark(uuid)', 'execute'),
      'mark_anon', has_function_privilege('anon', 'mahjong_private.mj_human_mark(uuid)', 'execute'),
      'ok_auth', has_function_privilege('authenticated', 'mahjong_private.mj_human_ok(uuid)', 'execute'),
      'ok_anon', has_function_privilege('anon', 'mahjong_private.mj_human_ok(uuid)', 'execute'),
      'pub', (${PUBQ}))`)}
    ${hum('d0', 4)}
    begin execute ${lit(once)}; exception when others then res := res || jsonb_build_object('once_raised', sqlerrm); end;
    ${hum('d1', 4)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('p10t')};`;

async function runA(prefix, once, first) {
  const { text } = await mq(mkSql((PRE ? preSql(first) : '') + prefix, once));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const isHuman = (x) => x?.ok === false && x?.err === 'human' && J(Object.keys(x).sort()) === J(['err', 'ok']);
const notHuman = (x) => x != null && !(typeof x === 'object' && 'raised' in x) && x?.err !== 'human';
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  ok('台：印ありの A が部屋を作れる', o.ac?.ok === true && !!o.ac?.room_id, J(o.ac));
  ok('台：B は初め印なし', o.b0?.h === 0, J(o.b0));
  ok('§2.2 印なしの B の 作る → err human（値・ok false・例外でない）', isHuman(o.bc), J(o.bc));
  ok('§2.2 作るの門は数えの前（部屋0・create の窓を焼かない）', o.bc_rooms === 0 && o.bc_lim === 0, J([o.bc_rooms, o.bc_lim]));
  ok('§2.2 印なしの B の 入る → err human・入っていない・join の窓を焼かない', isHuman(o.bj) && o.bj_ra === 0 && o.bj_lim === 0, J([o.bj, o.bj_ra, o.bj_lim]));
  ok('§2.2 印なしの B の 書く（部屋の入でも）→ err human・履歴が増えない', isHuman(o.bw) && o.bw_h === o.h0, J([o.bw, o.bw_h, o.h0]));
  ok('§2.2 印なしの C の 書く → err human', isHuman(o.cw), J(o.cw));
  ok('§1 読むは門に掛からない（mj_read・mj_my_rooms・mj_my_rules・mj_account）', [o.cr, o.cm, o.cu, o.cs].every(notHuman) && o.cr?.ok !== false,
    J([o.cr?.ok ?? o.cr, o.cm?.ok ?? o.cm, o.cu?.ok ?? o.cu, o.cs?.ok ?? o.cs]));
  ok('§1 読むだけでは印が付かない（C はまだ印なし）', o.c1?.h === 0, J(o.c1));
  ok('§2.3 mj_human_mark：在る人→true・居ない uid→false', o.mk === true && o.mk0 === false, J([o.mk, o.mk0]));
  ok('§2.3 2回目の印は時刻を変えない（coalesce）', o.mk2 === true && o.mk_same === true, J([o.mk2, o.mk_same]));
  ok('§2.3 accounts の行が無い人にも行を作って印', o.mk3 === true && o.c2?.row === 1 && o.c2?.h === 1, J([o.mk3, o.c2]));
  ok('§2.2 印の後 B は 書ける・作れる', o.bw2?.ok === true && o.bc2?.ok === true, J([o.bw2, o.bc2]));
  ok('§2.3-4 S5：mj_human_mark・mj_human_ok は客（authenticated・anon）が呼べない・public に無い',
    o.g && !o.g.mark_auth && !o.g.mark_anon && !o.g.ok_auth && !o.g.ok_anon && o.g.pub === 0, J(o.g));
  ok('§2.1 S4：schema を当て直しても印なしの D に印が付かない（一度きりの塊は2回目に何もしない）',
    !o.once_raised && o.d0?.row === 1 && o.d0?.h === 0 && o.d1?.h === 0, J([o.once_raised, o.d0, o.d1]));
  if (PRE) ok('§2.1 S4 --pre：初めて当てた時に在った垢は全部 印あり（埋めた）', o.acc_null === 0, J(o.acc_null));
  return L;
}

/* ── --waza ── */
const fnText = (name) => {
  const a = SCHEMA.indexOf(`create or replace function ${name}(`);
  const b = SCHEMA.indexOf('$fn$;', SCHEMA.indexOf('$fn$', a) + 4);
  if (a < 0 || b < 0) throw new Error('関数が見つからない: ' + name);
  return SCHEMA.slice(a, b + '$fn$;'.length);
};
const brk = (name, pairs) => {
  let t = fnText(name);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t;
};
const GATE = "if not mahjong_private.mj_human_ok(v_me) then return pg_catalog.jsonb_build_object('ok', false, 'err', 'human'); end if; -- P10 §2.2";
const ONCE_IF = /if not exists \(select 1 from information_schema\.columns c\s+where c\.table_schema = 'mahjong' and c\.table_name = 'accounts' and c\.column_name = 'human_at'\) then/;
const ONCE_ADD = 'alter table mahjong.accounts add column human_at timestamptz default pg_catalog.now();';
if (!ONCE_IF.test(ONCE) || !ONCE.includes(ONCE_ADD)) throw new Error('一度きりの塊の if・add が見つからない');
const ONCE_EVERY = ONCE.replace(ONCE_IF, 'if true then').replace(ONCE_ADD, 'update mahjong.accounts set human_at = coalesce(human_at, pg_catalog.now());')
  .replace('alter table mahjong.accounts alter column human_at drop default;', '');
const WZ = [
  ['Z1 mj_write の門を外す', () => [brk('public.mj_write', [[GATE, '']]), ONCE], ['§2.2 印なしの B の 書く', '§2.2 印なしの C の 書く']],
  ['Z2 mj_room_create の門を外す', () => [brk('public.mj_room_create', [[GATE, '']]), ONCE], ['§2.2 印なしの B の 作る']],
  ['Z3 mj_room_join の門を外す', () => [brk('public.mj_room_join', [[GATE, '']]), ONCE], ['§2.2 印なしの B の 入る']],
  ['Z4 一度きりの守りを外す（当てるたびに埋める）', () => ['', ONCE_EVERY], ['§2.1 S4']],
  ...(PRE ? [['Z6 初めの埋めを外す（列を足すだけ）', () => ['', ONCE, ONCE.replace(ONCE_ADD, ONCE_ADD.replace(' default pg_catalog.now()', ''))], ['§2.1 S4 --pre']]] : []),
  ['Z5 印の関数を authenticated に開ける', () => ['grant execute on function mahjong_private.mj_human_mark(uuid) to authenticated;', ONCE], ['§2.3-4 S5']],
];

const priv = (name, sig) => fnText(name) + `
revoke all on function ${name}(${sig}) from public, anon, authenticated;`;
const preSql = (first = ONCE) => [`execute ${lit(first)};`, priv('mahjong_private.mj_human_ok', 'uuid'), priv('mahjong_private.mj_human_mark', 'uuid'),
  fnText('public.mj_room_create'), fnText('public.mj_room_join'), fnText('public.mj_write')].join(String.fromCharCode(10));
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
  console.log(`\np10: ${pass} passed, ${fail} failed`);
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
      const [pre, once, first] = mk();
      const r = await runA(pre, once, first);
      const L = r.err ? null : check(r.out);
      const hit = L && L.filter(([nm, c]) => !c && wants.some((w) => nm.startsWith(w)));
      const good = !!hit && hit.length > 0;
      if (good) red++;
      console.log(`  ${good ? '✓' : '✗'} ${name} → ${r.err ? '塊が落ちた ' + r.err.slice(0, 200) : hit.length ? '赤：' + hit.map(([nm]) => nm).join(' ／ ') : '狙いが赤にならない'}`);
    }
    await leftCheck();
    console.log(`\np10 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
