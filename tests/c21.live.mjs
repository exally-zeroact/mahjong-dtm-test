/* c21.live.mjs — ★C2-1 §1a の倉庫：room_leave は名のつなぎを残し・抜けた人の名（left）への名の op を止め・読みに left:true を出す★（手元・鍵が要る＝tests-no-ci.json）
 * 定め memory/mahjong_tataki_2026-11-20/c2_db.md §1a・試験 c2_shiken.md §4（left-name ops err left・owner unlink・room_secret/account_remove・rejoin・roster left・owner w/o row）。
 *   A＝持ち主・B＝入（抜ける人）・C＝管・D＝入。A→M0・B→M1・C→M2 をつなぐ。D は M1 に名乗り（B は M1 につないでいる＝名乗れない・自分の名乗りを消すのは write.live の waza）。
 *   B が抜ける → M1 は B のまま・抜けた印1（left_hist_id＝抜ける前の最大 id）・B の名乗り0・D の M1 への名乗りは残る
 *   読み（A と C・room v2/v3・league・league v3）＝M1 に taken+left・持ち主 M0 は行が無くても left でない
 *   M1 への rename・relink・link・unlink（管・持ち主・入）＝err left（i・member_id）・持ち主の unlink だけ通る・空きの人の rename は通る
 *   room_secret・account_remove は抜けた人に触らない・入り直す → 印が消え rename が通る・もう一度抜ける → 印を書き直す
 * 全部を1つの塊の中で書いて戻す（倉庫に何も残さない・最後に残りを数える）。
 * --waza：倉庫の関数をわざと壊して、狙った行が赤になるか（壊した関数は塊の初めに当てる＝塊ごと戻る）
 * 使い方: node tests/c21.live.mjs [--waza]
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
const MAIL = 'mj-c21.invalid';
const NB = 'c21' + crypto.randomBytes(3).toString('hex');
const PASS = '2741', PASS2 = '5824';
const EP = `floor(extract(epoch from now()))`;
const asWho = (i) => `perform set_config('request.jwt.claims', jsonb_build_object('sub', us[${i}], 'session_id', ss[${i}], 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ${EP} - 5)))::text, true);`;
const RS = `delete from mahjong.limits where kind like 'write:%';`;
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
const W = (key, ops) => `${RS} ${T(key, `public.mj_write(ra, gen_random_uuid(), ${typeof ops === 'string' ? ops : jb(ops)})`)}`;

const R4 = (() => { const x = rulesOk({ ...defaultRules(4), rate: 100 }); if (!x.ok) throw new Error('ルール ' + J(x)); return x.rules; })();
const M = [U(), U(), U(), U(), U()];
const L1 = U();
const FR = { players: 4, rate: 100, chip_pt10: 20, kyotaku_end: 'kieru', tobi: true, tobi_pt: 10 };
const BASE = [
  ...M.map((id, i) => ({ op: 'member_add', member_id: id, name: '山田鈴木佐藤高橋伊藤'.slice(i * 2, i * 2 + 2) })),
  { op: 'league_create', league_id: L1, name: 'C21 リーグ', date_from: '2026-11-01', date_to: null, rank_by: 'avg_pt', min_games: 1, players_main: 4, rules: FR, rules_alt: { players: 3 } },
];
const lk = (i) => ({ op: 'member_link', member_id: M[i] });
const ul = (i) => ({ op: 'member_unlink', member_id: M[i] });
const rn = (i, name) => ({ op: 'member_rename', member_id: M[i], name });
const rlk = (i, who) => `jsonb_build_array(jsonb_build_object('op', 'member_relink', 'member_id', '${M[i]}', 'user_id', us[${who}]::text))`;
const READS = [
  ['room v2', `'room', '{}'::jsonb`],
  ['room v3', `'room', jsonb_build_object('v', 3)`],
  ['league', `'league', jsonb_build_object('league_id', ${lit(L1)})`],
  ['league v3', `'league', jsonb_build_object('league_id', ${lit(L1)}, 'v', 3)`],
];
const rd = (key, who) => `${asWho(who)} ${READS.map(([, a], k) => T(`${key}_${k}`, `public.mj_read(ra, ${a})`)).join('\n    ')}`;
const muser = (k, i, who) => ROW(k, who == null ? `select m.user_id is null from mahjong.members m where m.id = '${M[i]}'` : `select m.user_id = us[${who}] from mahjong.members m where m.id = '${M[i]}'`);
const lv = (k) => ROW(k, `select jsonb_build_object('n', (select count(*)::int from mahjong.room_leaves x where x.room_id = ra and x.user_id = us[2]),
      'hid', (select x.left_hist_id from mahjong.room_leaves x where x.room_id = ra and x.user_id = us[2]),
      'mx', (select coalesce(max(h.id), 0) from mahjong.history h where h.room_id = ra and h.op <> 'room_leave'))`);
const claims = (k, who, mi) => ROW(k, `select count(*)::int from mahjong.member_claims x where x.room_id = ra and x.user_id = us[${who}]${mi == null ? '' : ` and x.member_id = '${M[mi]}'`}`);

const mkSql = (prefix = '') => `do ${q('c21')} declare res jsonb := '{}'; r jsonb; i int; ra uuid;
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
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (ra, us[2], 'nyu', 'name'), (ra, us[3], 'kan', 'name'), (ra, us[4], 'nyu', 'name');
    ${W('b', BASE)}
    ${W('la', [lk(0)])}
    ${asWho(2)} ${W('lb', [lk(1)])}
    ${asWho(3)} ${W('lc', [lk(2)])}
    ${asWho(4)} ${W('cd', [lk(1)])}
    ${asWho(2)} ${W('lv', [{ op: 'room_leave' }])}
    ${muser('lv_m1', 1, 2)} ${lv('lv1')} ${claims('lv_clb', 2, null)} ${claims('lv_cld', 4, 1)}
    ${rd('rA', 1)}
    ${rd('rC', 3)}
    ${undo('ow', `delete from mahjong.room_accounts a where a.room_id = ra and a.user_id = us[1]; get diagnostics i = row_count; ${ROW('ow_n', 'i')}
      ${rd('rO', 3)}
      ${asWho(3)} ${W('ow_rn', [rn(0, '山田2')])}`)}
    ${asWho(3)}
    ${W('e_rn', [rn(1, '鈴木2')])} ${W('e_rl', rlk(1, 4))} ${W('e_ul', [ul(1)])}
    ${W('e_mix', [rn(3, '高橋2'), rn(1, '鈴木3')])}
    ${ROW('e_mix_m3', `select m.name from mahjong.members m where m.id = '${M[3]}'`)}
    ${undo('okr', `${W('ok_rn3', [rn(3, '高橋4')])} ${W('ok_rn2', [rn(2, '佐藤4')])}`)}
    ${asWho(4)} ${W('e_lk', [lk(1)])}
    ${asWho(1)} ${W('e_orn', [rn(1, '鈴木5')])} ${W('e_orl', rlk(1, 4))}
    ${undo('ou', `${asWho(1)} ${W('ou', [ul(1)])} ${muser('ou_m1', 1, null)} ${rd('rU', 1)}`)}
    ${undo('sec', `${asWho(1)} ${W('sec', `jsonb_build_array(jsonb_build_object('op', 'room_secret', 'pass', ${lit(PASS2)}, 'url_token_hash', md5(random()::text) || md5(random()::text)))`)}
      ${muser('sec_m1', 1, 2)} ${lv('sec_lv')} ${ROW('sec_d', `select count(*)::int from mahjong.room_accounts a where a.room_id = ra and a.user_id = us[4]`)}`)}
    ${undo('ar', `${asWho(1)} ${W('ar', `jsonb_build_array(jsonb_build_object('op', 'account_remove', 'user_id', us[2]::text))`)}
      ${muser('ar_m1', 1, 2)} ${lv('ar_lv')} ${ROW('ar_ban', `select count(*)::int from mahjong.room_bans b where b.room_id = ra`)}`)}
    delete from mahjong.limits where kind like 'join:%';
    ${asWho(2)} ${T('rj', `public.mj_room_join('name', null, null, ${lit(PASS)}, ${lit(NB)})`)}
    ${lv('rj_lv')} ${muser('rj_m1', 1, 2)}
    ${asWho(2)} ${W('rj_rn', [rn(1, '鈴木6')])}
    ${rd('rJ', 1)}
    ${asWho(2)} ${W('lv2', [{ op: 'room_leave' }])}
    ${lv('lv2_lv')} ${muser('lv2_m1', 1, 2)}`)}
  raise exception 'MJRESULT%', res::text;
end ${q('c21')};`;

async function runA(prefix) {
  const { text } = await mq(mkSql(prefix));
  let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) { /* 字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) return { err: msg.slice(0, 800) };
  try { return { out: JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]) }; } catch (e) { return { err: '結果が読めない ' + e.message }; }
}

const flag = (m) => ['me', 'taken', 'left'].filter((k) => m[k] === true).join('+') || '-';
const flags = (o, key, k) => { const mem = o[`${key}_${k}`]?.st?.members; return Array.isArray(mem) ? M.map((id) => { const m = mem.find((x) => x.member_id === id); return m ? flag(m) : '無し'; }) : null; };
const WANT = {
  rA: ['me', 'taken+left', 'taken', '-', '-'],
  rC: ['taken', 'taken+left', 'me', '-', '-'],
  rO: ['taken', 'taken+left', 'me', '-', '-'],
  rU: ['me', '-', 'taken', '-', '-'],
  rJ: ['me', 'taken', 'taken', '-', '-'],
};
const NAMEW = { rA: 'A（持ち主）', rC: 'C（管）', rO: '持ち主の行が無い時の C', rU: '持ち主が M1 を外した後の A', rJ: 'B が入り直した後の A' };
const isLeft = (x, i) => x?.ok === false && x?.err === 'left' && x?.i === i && x?.member_id === M[1];
function check(o) {
  const L = [];
  const ok = (n, c, info) => L.push([n, !!c, info]);
  const errs = Object.keys(o).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + o[k]).join(' / '));
  const raised = Object.keys(o).filter((k) => o[k] && typeof o[k] === 'object' && 'raised' in o[k]);
  ok('呼びが例外を投げていない', raised.length === 0, raised.map((k) => k + '=' + o[k].raised).join(' / '));
  ok('台：部屋と人とリーグ・A→M0・B→M1・C→M2・D の M1 への名乗り', o.made?.room_id && [o.b, o.la, o.lb, o.lc].every((x) => x?.ok === true)
    && o.cd?.results?.[0]?.claimed === true, J([o.lb, o.lc, o.cd]));
  ok('§1a 抜ける：ok・M1 は B につながったまま', o.lv?.ok === true && o.lv_m1 === true, J([o.lv, o.lv_m1]));
  ok('§1a 抜ける：抜けた印1・left_hist_id＝抜ける前の部屋の最大 id', o.lv1?.n === 1 && o.lv1?.hid > 0 && o.lv1?.hid === o.lv1?.mx, J(o.lv1));
  ok('§1a 抜ける：B の名乗りは消え・D の M1 への名乗りは残る', o.lv_clb === 0 && o.lv_cld === 1, J([o.lv_clb, o.lv_cld]));
  const uids = (o.uids || []).map(String);
  for (const key of Object.keys(WANT)) {
    READS.forEach(([nm], k) => {
      const got = flags(o, key, k);
      ok(`§1a 読み ${NAMEW[key]} の ${nm}：${J(WANT[key])}`, o[`${key}_${k}`]?.ok === true && J(got) === J(WANT[key]), J(got) + ' ' + J(o[`${key}_${k}`]).slice(0, 300));
      const mem = o[`${key}_${k}`]?.st?.members;
      ok(`§1a 読み ${NAMEW[key]} の ${nm}：left は true の時だけ・user_id を出さない`, Array.isArray(mem) && mem.every((m) => !('left' in m) || m.left === true)
        && uids.length === 4 && uids.every((u) => !J(o[`${key}_${k}`]).includes(u)), J(mem).slice(0, 300));
    });
  }
  ok('§1a 持ち主の行が無い時：持ち主は抜けた人でない（行を1つ消した・M0 の rename は通る）', o.ow_n === 1 && o.ow_rn?.ok === true, J([o.ow_n, o.ow_rn]));
  ok('§1a 管が抜けた人の名を rename → err left（i 0・member_id M1）', isLeft(o.e_rn, 0), J(o.e_rn));
  ok('§1a 管が抜けた人の名を relink → err left', isLeft(o.e_rl, 0), J(o.e_rl));
  ok('§1a 管が抜けた人の名を unlink → err left', isLeft(o.e_ul, 0), J(o.e_ul));
  ok('§1a 組の2つ目が抜けた人の名 → err left（i 1）・1つ目も戻る', isLeft(o.e_mix, 1) && o.e_mix_m3 === '高橋', J([o.e_mix, o.e_mix_m3]));
  ok('§1a 空きの人・在る人の rename は通る（門が広すぎない）', o.ok_rn3?.ok === true && o.ok_rn2?.ok === true, J([o.ok_rn3, o.ok_rn2]));
  ok('§1a 入が抜けた人の名に link → err left', isLeft(o.e_lk, 0), J(o.e_lk));
  ok('§1a 持ち主でも rename・relink → err left', isLeft(o.e_orn, 0) && isLeft(o.e_orl, 0), J([o.e_orn, o.e_orl]));
  ok('§1a 持ち主の unlink だけ通る・M1 が空きになる', o.ou?.ok === true && o.ou_m1 === true, J([o.ou, o.ou_m1]));
  ok('§1a room_secret は抜けた人に触らない（M1 は B・印1）・入の D は外れる', o.sec?.ok === true && o.sec_m1 === true && o.sec_lv?.n === 1 && o.sec_d === 0, J([o.sec, o.sec_m1, o.sec_lv, o.sec_d]));
  ok('§1a account_remove は抜けた人に効かない（bad user_id・M1 は B・印1・出した印0）', o.ar?.ok === false && o.ar?.err === 'bad' && o.ar?.at === 'user_id'
    && o.ar_m1 === true && o.ar_lv?.n === 1 && o.ar_ban === 0, J([o.ar, o.ar_m1, o.ar_lv, o.ar_ban]));
  ok('§1a 入り直す：ok・印が消える・M1 は B のまま', o.rj?.ok === true && o.rj_lv?.n === 0 && o.rj_m1 === true, J([o.rj, o.rj_lv, o.rj_m1]));
  ok('§1a 入り直した後の rename は通る', o.rj_rn?.ok === true, J(o.rj_rn));
  ok('§1a もう一度抜ける：印1・left_hist_id を書き直す（前より大きい・抜ける前の最大 id）', o.lv2?.ok === true && o.lv2_lv?.n === 1 && o.lv2_lv?.hid > o.lv1?.hid
    && o.lv2_lv?.hid === o.lv2_lv?.mx && o.lv2_m1 === true, J([o.lv2, o.lv2_lv, o.lv1]));
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
const SIG = { 'mahjong_private.mj_w_op': '(uuid, uuid, text, uuid, int, jsonb)', 'mahjong_private.mj_r_league3': '(uuid, uuid, bigint, uuid, uuid, uuid)' };
const brk = (fn, pairs) => {
  let t = fnText(fn);
  for (const [from, to] of pairs) { if (!t.includes(from)) throw new Error(`壊す字が無い（${fn}）: ${from.slice(0, 80)}`); t = t.split(from).join(to); }
  return t + (fn.startsWith('mahjong_private.') ? `\nrevoke all on function ${fn}${SIG[fn]} from public, anon, authenticated;` : '');
};
const OP = 'mahjong_private.mj_w_op', RD = 'public.mj_read', LG = 'mahjong_private.mj_r_league3', JN = 'public.mj_room_join';
const GATE = "if v_op in ('member_rename', 'member_relink', 'member_link', 'member_unlink') and not (v_op = 'member_unlink' and p_role = 'owner') then";
const LEFT_RD = "then '{\"left\": true}'::jsonb else '{}'::jsonb end";
const WZ = [
  ['Z1 left の門を外す', () => brk(OP, [[GATE, 'if false then']]), ['§1a 管が抜けた人の名を rename', '§1a 入が抜けた人の名に link']],
  ['Z2 持ち主の unlink も止める', () => brk(OP, [[" and not (v_op = 'member_unlink' and p_role = 'owner') then", ' then']]), ['§1a 持ち主の unlink だけ通る']],
  ['Z3 門が持ち主を抜けた人に数える', () => brk(OP, [['and m.user_id is not null and m.user_id is distinct from x.owner_user_id', 'and m.user_id is not null']]), ['§1a 持ち主の行が無い時']],
  ['Z4 門が rename を見ない', () => brk(OP, [["if v_op in ('member_rename', 'member_relink',", "if v_op in ('member_relink',"]]), ['§1a 管が抜けた人の名を rename', '§1a 組の2つ目']],
  ['Z5 部屋の読みで left を出さない', () => brk(RD, [[LEFT_RD, "then '{}'::jsonb else '{}'::jsonb end"]]), ['§1a 読み A（持ち主） の room v2', '§1a 読み C（管） の room v3']],
  ['Z6 リーグ v3 で left を出さない', () => brk(LG, [[LEFT_RD, "then '{}'::jsonb else '{}'::jsonb end"]]), ['§1a 読み A（持ち主） の league v3']],
  ['Z7 部屋の読みで持ち主も left', () => brk(RD, [['m.user_id is distinct from r.owner_user_id and', '']]), ['§1a 読み 持ち主の行が無い時の C の room v2']],
  /* Z8（upsert を do nothing に）は入れない：入り直しが印を消すので、2度目の抜けは衝突しない＝赤にならない（on conflict は守りだけ） */
  ['Z9 入り直しで印を消さない', () => brk(JN, [['delete from mahjong.room_leaves x where x.room_id = v_room and x.user_id = v_me;', 'null;']]), ['§1a 入り直す']],
  ['Z10 room_secret が抜けた人も外す', () => brk(OP, [["where a.room_id = p_room and a.role = 'nyu'\n       and not exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = a.user_id);\n    delete from mahjong.room_accounts a where a.room_id = p_room and a.user_id = any(v_us);",
    "where a.room_id = p_room and a.role = 'nyu'\n       and not exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = a.user_id);\n    delete from mahjong.room_accounts a where a.room_id = p_room and a.user_id = any(v_us);\n    v_us := v_us || coalesce((select pg_catalog.array_agg(x.user_id) from mahjong.room_leaves x where x.room_id = p_room), '{}');"]]), ['§1a room_secret']],
  ['Z11 left_hist_id を抜けた後の id で書く', () => brk(OP, [['select coalesce(pg_catalog.max(hx.id), 0) into v_hid from mahjong.history hx where hx.room_id = p_room;', 'v_hid := 0;']]), ['§1a 抜ける：抜けた印1']],
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
  console.log(`\nc21: ${pass} passed, ${fail} failed`);
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
    console.log(`\nc21 --waza: ${red}/${n} 狙いが赤になった`);
    process.exitCode = red === n && fail === 0 ? 0 : 1;
  }
}
