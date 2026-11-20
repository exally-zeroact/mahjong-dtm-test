/* room-create.live.mjs — ★入口 public.mj_room_create を本物のテスト倉庫で叩く★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * 案 room_create_sekkei.md の試験の節＋叩き room_create_tome.txt（止め2・直し5）：
 *  ① 作れて rooms・rule_sets・devices・creates・totals・limits が1ずつ増える（名前の前後の空白は落ちる・row_count 1・版1）
 *  ② 同じ op_id で送り直し＝部屋1つのまま同じ返し ／ 秘密が違う送り直し＝mismatch ／ 消した部屋＝gone
 *  ③ 形の違い・ルールの範囲の外・よくあるパス（全角も）を弾く ④ 既定のルールが埋まる（41鍵）
 *  ⑤ pass_hash は $2a$10$・そろえた字で照らせる・平文（パス・合言葉）は部屋の行のどこにも無い・合言葉は sha256
 *  ⑥ 一意の当たり＝dup ⑦ R−20 で full ⑧ 1分20・24時間200 で busy（24時間より前の窓は数えず、作った時に消える）
 *  ★ok でない返しの後は creates・limits・totals・部屋の数が1つも増えていない★（S1・N2）
 *  ⑨ 関数の権限（definer・search_path 空・anon と authenticated だけに EXECUTE）
 *  ⑩ 客の鍵で PostgREST から1回呼んで届く（形の違いで bad を返す呼びだけ＝倉庫に何も残さない）
 * 倉庫には何も残さない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝全部戻る）。
 * ★同時に同じ op_id が2本来た時（totals の for update で2本目が待つ）は1つの取引の中では試せない（dblink 無し）＝見立て★
 * 使い方: node tests/room-create.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const url = /url:\s*'([^']+)'/.exec(src)[1];
const anonKey = /key:\s*'([^']+)'/.exec(src)[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1];
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const D = '$';
const q = (t) => D + t + D;
const lit = (s) => q('v') + s + q('v');                     // 字はドルの札で包む（引用符の逃がしが要らない）
const hex = () => crypto.randomBytes(32).toString('hex');
const uid = () => crypto.randomUUID();
const ADM = 'Ab3dEf6hIj9kLm2P';
const PASS = 'Zq9Pass';
const sec = (u, a, d) => JSON.stringify({ url_token_hash: u, admin_secret: a, device_token_hash: d });
const call = (op, name, pass, rules, secrets) =>
  `public.mj_room_create(${op === null ? 'null' : lit(op) + '::uuid'}, ${name === null ? 'null' : lit(name)}, ${pass === null ? 'null' : lit(pass)}, `
  + `${rules === null ? 'null' : lit(rules) + '::jsonb'}, ${secrets === null ? 'null' : lit(secrets) + '::jsonb'})`;

const OP1 = uid(), U1 = hex(), V1 = hex();
const S1 = sec(U1, ADM, V1);

/* ③ 弾く表：[名, 呼び, 期待の err, 期待の what/key] */
const BAD = [
  ['op_id が null', call(null, '甲', PASS, '{"players":4}', S1), 'bad', 'op_id'],
  ['名前が空', call(uid(), '', PASS, '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'name'],
  ['名前が全角の空白だけ', call(uid(), '　 ', PASS, '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'name'],
  ['名前が null', call(uid(), null, PASS, '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'name'],
  ['名前41字', call(uid(), 'あ'.repeat(41), PASS, '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'name'],
  ['パス3字', call(uid(), '甲', 'abc', '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'pass'],
  ['パス65字', call(uid(), '甲', 'x'.repeat(65), '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'pass'],
  ['パスがそろえて73 byte 以上', call(uid(), '甲', '㍿'.repeat(7), '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'pass'],
  ['パスが null', call(uid(), '甲', null, '{"players":4}', sec(hex(), ADM, hex())), 'bad', 'pass'],
  ['秘密が null', call(uid(), '甲', PASS, '{"players":4}', null), 'bad', 'secrets'],
  ['秘密に channel_key を足した（4つ）', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ url_token_hash: hex(), admin_secret: ADM, device_token_hash: hex(), channel_key: hex() })), 'bad', 'secrets'],
  ['秘密が配列', call(uid(), '甲', PASS, '{"players":4}', '[1,2,3]'), 'bad', 'secrets'],
  ['url が hex でない', call(uid(), '甲', PASS, '{"players":4}', sec('g'.repeat(64), ADM, hex())), 'bad', 'url_token_hash'],
  ['url が大文字の hex', call(uid(), '甲', PASS, '{"players":4}', sec(hex().toUpperCase(), ADM, hex())), 'bad', 'url_token_hash'],
  ['url が63字', call(uid(), '甲', PASS, '{"players":4}', sec(hex().slice(1), ADM, hex())), 'bad', 'url_token_hash'],
  ['url が数', call(uid(), '甲', PASS, '{"players":4}', JSON.stringify({ url_token_hash: 1, admin_secret: ADM, device_token_hash: hex() })), 'bad', 'url_token_hash'],
  ['端末が hex でない', call(uid(), '甲', PASS, '{"players":4}', sec(hex(), ADM, 'z'.repeat(64))), 'bad', 'device_token_hash'],
  ['url と端末が同じ', (() => { const h = hex(); return call(uid(), '甲', PASS, '{"players":4}', sec(h, ADM, h)); })(), 'bad', 'device_token_hash'],
  ['合言葉15字', call(uid(), '甲', PASS, '{"players":4}', sec(hex(), ADM.slice(1), hex())), 'bad', 'admin_secret'],
  ['合言葉に記号', call(uid(), '甲', PASS, '{"players":4}', sec(hex(), 'Ab3dEf6hIj9kLm2!', hex())), 'bad', 'admin_secret'],
  ['合言葉に全角', call(uid(), '甲', PASS, '{"players":4}', sec(hex(), 'Ａb3dEf6hIj9kLm2P', hex())), 'bad', 'admin_secret'],
  ['ルール players 5', call(uid(), '甲', PASS, '{"players":5}', sec(hex(), ADM, hex())), 'range', 'players'],
  ['ルール null', call(uid(), '甲', PASS, null, sec(hex(), ADM, hex())), 'range', '(object)'],
  ['ルールに無い鍵', call(uid(), '甲', PASS, '{"players":4,"zzz":1}', sec(hex(), ADM, hex())), 'range', '(unknown)'],
  ['ルール 返し＜持ち点', call(uid(), '甲', PASS, '{"players":4,"start_pts":30000,"return_pts":25000}', sec(hex(), ADM, hex())), 'range', 'return_pts'],
  ['よくあるパス Password', call(uid(), '甲', 'Password', '{"players":4}', sec(hex(), ADM, hex())), 'common', null],
  ['よくあるパス 全角の１２３４', call(uid(), '甲', '１２３４', '{"players":4}', sec(hex(), ADM, hex())), 'common', null],
  ['よくあるパス 半角カナのﾏｰｼﾞｬﾝ', call(uid(), '甲', 'ﾏｰｼﾞｬﾝ', '{"players":4}', sec(hex(), ADM, hex())), 'common', null],
  ['一意の当たり url（別の op_id）', call(uid(), '甲', PASS, '{"players":4}', sec(U1, ADM, hex())), 'dup', 'url_token_hash'],
  ['一意の当たり 端末（別の op_id）', call(uid(), '甲', PASS, '{"players":4}', sec(hex(), ADM, V1)), 'dup', 'device_token_hash'],
  ['送り直しで url が違う', call(OP1, '甲', PASS, '{"players":4}', sec(hex(), ADM, V1)), 'mismatch', null],
  ['送り直しで端末が違う', call(OP1, '甲', PASS, '{"players":4}', sec(U1, ADM, hex())), 'mismatch', null],
];

const CNT = `jsonb_build_object('rooms', (select count(*) from mahjong.rooms), 'rule_sets', (select count(*) from mahjong.rule_sets),
  'devices', (select count(*) from mahjong.devices), 'creates', (select count(*) from mahjong.creates),
  'totals', (select rooms_all from mahjong.totals where id = 1),
  'lim', (select coalesce(sum(count), 0) from mahjong.limits where kind like 'create:%'),
  'lim_rows', (select count(*) from mahjong.limits where kind like 'create:%'))`;
/* 塊の中だけで書いて戻す：body を走らせ、結果を v に入れてから例外で戻す */
const undo = (key, body) => `
  begin
    ${body}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('${key}_err', sqlerrm); end if;
  end;`;
const fresh = () => call(uid(), '乙', PASS, '{"players":3}', sec(hex(), ADM, hex()));

const sql = `do ${q('rc')} declare res jsonb := '{}'; r jsonb; c0 jsonb; c1 jsonb; cx jsonb; t jsonb; rid uuid; n int;
begin
  c0 := ${CNT};
  r := ${call(OP1, '　甲の部屋 ', PASS, '{"players":4}', S1)};
  c1 := ${CNT};
  rid := (r->>'room_id')::uuid;
  res := res || jsonb_build_object('r1', r, 'c0', c0, 'c1', c1,
    'room', (select to_jsonb(x) - 'pass_hash' from mahjong.rooms x where x.id = rid),
    'room_text', (select to_jsonb(x)::text from mahjong.rooms x where x.id = rid),
    'pass_prefix', (select substr(x.pass_hash, 1, 7) from mahjong.rooms x where x.id = rid),
    'crypt_key', (select x.pass_hash = extensions.crypt(${lit(PASS.toLowerCase())}, x.pass_hash) from mahjong.rooms x where x.id = rid),
    'crypt_raw', (select x.pass_hash = extensions.crypt(${lit(PASS)}, x.pass_hash) from mahjong.rooms x where x.id = rid),
    'crypt_wide', (select x.pass_hash = extensions.crypt(mahjong_private.mj_pass_key(${lit('Ｚｑ９Ｐａｓｓ')}), x.pass_hash) from mahjong.rooms x where x.id = rid),
    'adm_ok', (select x.admin_secret_hash = encode(sha256(convert_to(${lit(ADM)}, 'UTF8')), 'hex') from mahjong.rooms x where x.id = rid),
    'rs', (select jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'nkeys', (select count(*) from jsonb_object_keys(s.rules)), 'players', s.rules->'players')) from mahjong.rule_sets s where s.room_id = rid),
    'dev', (select jsonb_agg(jsonb_build_object('id', d.id, 'is_admin', d.is_admin, 'entered_by', d.entered_by, 'token_hash', d.token_hash)) from mahjong.devices d where d.room_id = rid),
    'cr', (select to_jsonb(c) from mahjong.creates c where c.op_id = ${lit(OP1)}::uuid));
  r := ${call(OP1, '別の名前', 'otherpass9', '{"players":3}', S1)};
  res := res || jsonb_build_object('r2', r, 'c2', ${CNT});
  t := '[]';
  ${BAD.map(([, c]) => `begin r := ${c}; exception when others then r := jsonb_build_object('raised', sqlerrm); end; t := t || jsonb_build_array(r);`).join('\n  ')}
  res := res || jsonb_build_object('bad', t, 'c3', ${CNT});
  ${undo('gone', `update mahjong.rooms set deleted_at = now() where id = rid;
    r := ${call(OP1, '甲', PASS, '{"players":4}', S1)}; res := res || jsonb_build_object('gone', r, 'c_gone', ${CNT});`)}
  ${undo('full', `update mahjong.totals set rooms_all = (select cap - 20 from mahjong.mj_caps where tbl = 'rooms' and scope = 'all') where id = 1;
    cx := ${CNT}; r := ${fresh()}; res := res || jsonb_build_object('full', r, 'c_full0', cx, 'c_full1', ${CNT});
    update mahjong.totals set rooms_all = (select cap - 21 from mahjong.mj_caps where tbl = 'rooms' and scope = 'all') where id = 1;
    r := ${fresh()}; res := res || jsonb_build_object('full_m1', r);`)}
  ${undo('b1m', `insert into mahjong.limits (kind, key, window_start, count) values ('create:1m', 'all', date_trunc('minute', now()), 20)
      on conflict (kind, key, window_start) do update set count = 20;
    cx := ${CNT}; r := ${fresh()}; res := res || jsonb_build_object('b1m', r, 'c_b1m0', cx, 'c_b1m1', ${CNT});
    update mahjong.limits set count = 19 where kind = 'create:1m' and key = 'all' and window_start = date_trunc('minute', now());
    r := ${fresh()}; res := res || jsonb_build_object('b1m_19', r);`)}
  ${undo('b1d', `select coalesce(sum(count), 0) into n from mahjong.limits where kind = 'create:1d' and key = 'all' and window_start > now() - interval '24 hours';
    insert into mahjong.limits (kind, key, window_start, count) values ('create:1d', 'all', date_trunc('hour', now()) - interval '23 hours', 200 - n)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 200 - n;
    cx := ${CNT}; r := ${fresh()}; res := res || jsonb_build_object('b1d', r, 'c_b1d0', cx, 'c_b1d1', ${CNT});`)}
  ${undo('old', `insert into mahjong.limits (kind, key, window_start, count) values ('create:1d', 'all', date_trunc('hour', now()) - interval '25 hours', 5000)
      on conflict (kind, key, window_start) do update set count = 5000;
    r := ${fresh()};
    res := res || jsonb_build_object('old', r, 'old_left', (select count(*) from mahjong.limits where kind = 'create:1d' and window_start <= now() - interval '24 hours'));`)}
  res := res || jsonb_build_object('funcs', (select jsonb_agg(jsonb_build_object('name', p.proname, 'definer', p.prosecdef, 'config', p.proconfig,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public', exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)))
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'mj\\_%'),
    'priv_anon', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('mahjong', 'mahjong_private') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  raise exception 'MJRESULT%', res::text;
end ${q('rc')};`;

let out = null;
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
if (!isTest) console.log('★中止★ test の倉庫でない');
else {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  let msg = t; try { msg = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) console.log('★失敗★ 結果の例外が来なかった: ' + msg.slice(0, 600));
  else {
    try { out = JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]); } catch (e) { console.log('★失敗★ 結果が読めない: ' + e.message); }
  }
}
const d = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Number(b[k]) - Number(a[k])]));
const so = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort().map((k) => k + ":" + JSON.stringify(o[k])).join(",") : JSON.stringify(o));
const same = (a, b) => so(a) === so(b);
if (out) {
  /* ① */
  const r1 = out.r1 || {};
  ok('① 作れた', r1.ok === true, JSON.stringify(r1));
  ok('① rooms・rule_sets・devices・creates・totals・limits が1ずつ（limits は 1m と 1d に1ずつ）',
    same(d(out.c0, out.c1), { rooms: 1, rule_sets: 1, devices: 1, creates: 1, totals: 1, lim: 2, lim_rows: d(out.c0, out.c1).lim_rows }), JSON.stringify(d(out.c0, out.c1)));
  ok('① 部屋番号は8桁', /^[0-9]{8}$/.test(r1.room_no || ''), r1.room_no);
  ok('① channel_key は倉庫が作った32字の hex', /^[0-9a-f]{32}$/.test(r1.channel_key || '') && out.room.channel_key === r1.channel_key);
  ok('① 名前の前後の空白（全角も）が落ちた', out.room.name === '甲の部屋', out.room.name);
  ok('① row_count 1・rule_version 1・rule_set_id が rule_sets の id', out.room.row_count === 1 && out.room.rule_version === 1
    && out.rs.length === 1 && out.rs[0].id === out.room.rule_set_id && out.rs[0].version === 1, JSON.stringify(out.rs));
  ok('① 端末は管・作った・送った token_hash・device_id が返しと同じ', out.dev.length === 1 && out.dev[0].is_admin === true
    && out.dev[0].entered_by === 'create' && out.dev[0].token_hash === V1 && out.dev[0].id === r1.device_id);
  ok('① creates に op_id と部屋', out.cr && out.cr.room_id === r1.room_id);
  ok('① url_token_hash は送った物', out.room.url_token_hash === U1);
  /* ④ */
  ok('④ 既定のルールが埋まった（41鍵・players 4）', out.rs[0].nkeys === 41 && out.rs[0].players === 4, JSON.stringify(out.rs[0]));
  /* ⑤ */
  ok('⑤ pass_hash は $2a$10$', out.pass_prefix === '$2a$10$', out.pass_prefix);
  ok('⑤ そろえた字で照らせる（大文字・全角で打っても同じ）', out.crypt_key === true && out.crypt_wide === true && out.crypt_raw === false);
  ok('⑤ 合言葉は sha256', out.adm_ok === true);
  ok('⑤ 平文のパス・合言葉は部屋の行のどこにも無い', !out.room_text.includes(PASS) && !out.room_text.toLowerCase().includes(PASS.toLowerCase()) && !out.room_text.includes(ADM));
  /* ② */
  const r2 = out.r2 || {};
  ok('② 同じ op_id の送り直し＝同じ返し', same(r2, r1), JSON.stringify(r2));
  ok('② 送り直しで何も増えない', same(out.c1, out.c2), JSON.stringify(d(out.c1, out.c2)));
  ok('② 消した部屋への送り直し＝gone', out.gone && out.gone.ok === false && out.gone.err === 'gone', JSON.stringify(out.gone || out.gone_err));
  ok('② gone で何も増えない', out.c_gone && same(out.c2, out.c_gone));
  /* ③⑥ */
  BAD.forEach(([name, , err, what], i) => {
    const r = out.bad[i] || {};
    const got = r.what ?? r.key ?? null;
    ok('③ ' + name + ` → ${err}${what ? ':' + what : ''}`, r.ok === false && r.err === err && got === what, JSON.stringify(r));
  });
  ok('③ 弾いた後に creates・limits・totals・部屋が1つも増えていない', same(out.c2, out.c3), JSON.stringify(d(out.c2, out.c3)));
  /* ⑦ */
  ok('⑦ R−20 で full', out.full && out.full.err === 'full', JSON.stringify(out.full || out.full_err));
  ok('⑦ full で何も増えない', out.c_full0 && same(out.c_full0, out.c_full1));
  ok('⑦ R−21 なら作れる', out.full_m1 && out.full_m1.ok === true, JSON.stringify(out.full_m1));
  /* ⑧ */
  ok('⑧ 1分20個の後は busy', out.b1m && out.b1m.err === 'busy', JSON.stringify(out.b1m || out.b1m_err));
  ok('⑧ busy の時に limits・部屋が増えない', out.c_b1m0 && same(out.c_b1m0, out.c_b1m1), JSON.stringify(out.c_b1m0 && d(out.c_b1m0, out.c_b1m1)));
  ok('⑧ 1分19個なら作れる', out.b1m_19 && out.b1m_19.ok === true, JSON.stringify(out.b1m_19));
  ok('⑧ 24時間で200個の後は busy', out.b1d && out.b1d.err === 'busy', JSON.stringify(out.b1d || out.b1d_err));
  ok('⑧ busy（1日）の時に何も増えない', out.c_b1d0 && same(out.c_b1d0, out.c_b1d1));
  ok('⑧ 24時間より前の窓は数えず、作った時に消える', out.old && out.old.ok === true && Number(out.old_left) === 0, JSON.stringify({ old: out.old, left: out.old_left, e: out.old_err }));
  /* ⑨ */
  const fn = (out.funcs || []);
  ok('⑨ public.mj_* は mj_room_create の1本', fn.length === 1 && fn[0].name === 'mj_room_create', JSON.stringify(fn));
  ok('⑨ definer・search_path 空・anon と authenticated に EXECUTE・PUBLIC 無し', fn[0] && fn[0].definer === true
    && JSON.stringify(fn[0].config) === JSON.stringify(['search_path=""']) && fn[0].anon && fn[0].auth && !fn[0].public, JSON.stringify(fn[0]));
  ok('⑨ 部屋の関数は客から呼べない', Number(out.priv_anon) === 0, String(out.priv_anon));
  const errs = Object.keys(out).filter((k) => k.endsWith('_err'));
  ok('塊の中で思わぬ例外が無い', errs.length === 0, errs.map((k) => k + '=' + out[k]).join(' / '));
}
/* ⑩ 客の鍵で PostgREST から（形の違い＝倉庫に何も残さない） */
if (isTest) {
  const r = await fetch(`${url}/rest/v1/rpc/mj_room_create`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_op_id: null, p_name: '甲', p_pass: 'x', p_rules: { players: 4 }, p_secrets: {} }),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (_) { /* 字 */ }
  ok('⑩ 客の鍵で呼べて bad:op_id が返る', r.status === 200 && j && j.ok === false && j.err === 'bad' && j.what === 'op_id', `${r.status} ${t.slice(0, 200)}`);
}
console.log(`\nroom-create: ${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
