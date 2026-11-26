/* rules.live.mjs — ★倉庫の mj_rule_keys・mj_rules_ok と lib/rules.mjs が同じ答えか★（手元・鍵が要る＝tests-no-ci.json）
 * =============================================================================
 * ① 倉庫の表 mahjong.mj_rule_keys の行（key の collate "C" 順）＝ lib の RULE_KEYS（深く同じ）
 * ② 同じ入力の表（JSON の字のまま＝4.0・"300"・null も字の通りに届く）を倉庫の mj_rules_ok と lib の rulesOk に通して、
 *    通る／弾く・弾いた鍵・埋めた結果が全部同じ
 * 倉庫には何も書かない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝db-checks と同じ形）。
 * 使い方: node tests/rules.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { RULE_KEYS, rulesOk } from '../lib/rules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
/* ★倉庫の門（設計 I-6）★ env の字だけでなく ref を直に見る（字は supa-config.js だけが持つ＝ここは sha256 の頭16字の指紋で照らす）＝khaw（全アプリ共有のテスト倉庫）でなければ1行も呼ばずに止める（本番 auth に試しのアカウントを作らない） */
if ((await import('node:crypto')).createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

/* 入力は JSON の字（倉庫にも lib にも同じ字を渡す） */
const RAW = [
  '{"players":4}', '{"players":3}', '{"players":4.0}', '{"players":"4"}', '{"players":5}', '{}', '[]', 'null', '1', '"x"',
  '{"players":4,"oka":true}', '{"players":4,"__proto__":1}', '{"players":4,"Aka":1}',
  '{"players":4,"honba":300}', '{"players":4,"honba":300.0}', '{"players":4,"honba":"300"}', '{"players":4,"honba":1000}',
  '{"players":4,"renpu_fu":2}', '{"players":4,"renpu_fu":"2"}',
  '{"players":4,"aka":1.0}', '{"players":4,"aka":1.5}', '{"players":4,"aka":-1}', '{"players":4,"aka":"1"}', '{"players":4,"aka":null}',
  '{"players":4,"rate":null}', '{"players":4,"rate":10}', '{"players":4,"rate":15}', '{"players":4,"rate":100000}', '{"players":4,"rate":100010}', '{"players":4,"rate":1e3}',
  '{"players":4,"rate":2000000000}', '{"players":4,"rate":2000000010}',
  '{"players":4,"start_pts":300000,"return_pts":300000}', '{"players":4,"start_pts":2000000000,"return_pts":2000000000}', '{"players":4,"start_pts":2000000100,"return_pts":2000000100}',
  '{"players":4,"tenpai_ryo":50000}', '{"players":4,"tenpai_ryo":2000001000}',
  '{"players":4,"chip_pt10":null}', '{"players":4,"chip_pt10":0}', '{"players":4,"chip_pt10":1}', '{"players":4,"chip_pt10":9999}', '{"players":4,"chip_pt10":0.5}',
  '{"players":4,"tobi":null}', '{"players":4,"tobi":1}', '{"players":4,"tobi":false}', '{"players":4,"tobi":"true"}',
  '{"players":4,"start_pts":25050}', '{"players":4,"start_pts":30000,"return_pts":25000}', '{"players":4,"start_pts":25000,"return_pts":25000}',
  '{"players":4,"start_pts":25000.0,"return_pts":30000.00}',
  '{"players":4,"uma":[20,10,-10,-20]}', '{"players":4,"uma":[30,10,-10,-30]}', '{"players":4,"uma":[20.0,10,-10,-20]}',
  '{"players":3,"uma":[20,10,-10,-20]}', '{"players":4,"uma":[20,10,-10,-10]}', '{"players":4,"uma":[10,20,-10,-20]}',
  '{"players":4,"uma":[20.5,9.5,-10,-20]}', '{"players":4,"uma":[1000,0,0,-1000]}', '{"players":3,"uma":[0,0,0]}',
  '{"players":4,"uma":[20,null,-10,-10]}', '{"players":4,"uma":[20,"10",-10,-20]}', '{"players":4,"uma":null}', '{"players":4,"uma":{"a":1}}',
  '{"players":4,"kyotaku_end":"kieru"}', '{"players":4,"kyotaku_end":"x"}', '{"players":4,"round":"none"}', '{"players":4,"round":1}',
  '{"players":4,"tobi":1,"aka":9}', '{"players":3,"kita":"none","tsumo3":"secchan","double_ron":false,"triple_ron":"ari"}',
  '{"players":4,"tie":["kamicha"]}', '{"players":4,"tie":{"k":1}}',
  /* 2c-3a の3鍵（tane の表は tests/fixtures/rules-tane-cases.json＝rules.test と同じ） */
  '{"players":4,"yakitori_to":"top"}', '{"players":4,"yakitori_to":"x"}', '{"players":3,"yakitori_to":"split","yakitori_top_tie":"all"}', '{"players":4,"yakitori_top_tie":null}',
  '{"players":4,"yakitori_to":"each","tane_custom":[{"id":"a","name":"一","pt10":5,"sum0":true}],"aka":9}',
  '{"players":4,"tane_custom":[{"id":"a","name":"一","pt10":5.0,"sum0":true},{"id":"b","name":"二","pt10":1e3,"sum0":false}]}', /* 数の字のまま（表は JSON.parse で 5.0 が 5 になる） */
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/rules-tane-cases.json'), 'utf8')).cases.map((c) => JSON.stringify({ players: 4, tane_custom: c.in })),
];

const D = '$';
const q = (t) => D + t + D;
/* --kari（2c-3a）：khaw に当てる前は schema.sql の「種の check」から mj_rules_ok の revoke までを塊の頭で当てる（塊の終わりの例外で全部戻る＝倉庫を汚さない） */
function kari() {
  if (!process.argv.includes('--kari')) return '';
  const s = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  const a = s.indexOf('-- 種の check（2c-3a'), z = 'revoke all on function mahjong_private.mj_rules_ok(jsonb) from public, anon, authenticated;', b = s.indexOf(z);
  if (a < 0 || b < a) throw new Error('--kari：schema.sql に当てる範囲が見つからない');
  return s.slice(a, b + z.length) + '\n';
}
const sql = kari() + `do ${q('rl')} declare res jsonb := '[]'; c jsonb; r jsonb; keys jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'min', min, 'max', max, 'step', step, 'vals', vals,
         'nullable', nullable, 'def4', def4, 'def3', def3, 'need', need) order by key collate "C"), '[]') into keys from mahjong.mj_rule_keys;
  for c in select value from jsonb_array_elements(${q('in')}${'[' + RAW.join(',') + ']'}${q('in')}::jsonb) loop
    begin
      r := mahjong_private.mj_rules_ok(c);
      -- txt＝数の値を倉庫の字のまま（5.0 と 5 は JSON.parse で同じになる＝字で比べて「整数に直して持つ」を守る）
      res := res || jsonb_build_array(jsonb_build_object('ok', true, 'rules', r, 'txt',
        (select string_agg(e.key || '=' || (e.value)::text, ',' order by e.key collate "C") from jsonb_each(r) e where jsonb_typeof(e.value) = 'number')
        || '|' || coalesce((select string_agg(x ->> 'pt10', ',') from jsonb_array_elements(r -> 'tane_custom') x), '')));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('ok', false, 'err', sqlerrm));
    end;
  end loop;
  raise exception 'MJRESULT%', jsonb_build_object('keys', keys, 'res', res)::text;
end ${q('rl')};`;


async function ask(query, quiet) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  let msg = t; try { msg = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) { if (!quiet) console.log('★失敗★ 結果の例外が来なかった: ' + msg.slice(0, 300)); return null; }
  try { return JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]); } catch (e) { if (!quiet) console.log('★失敗★ 結果が読めない: ' + e.message); return null; }
}
let out = null;
if (!isTest) console.log('★中止★ test の倉庫でない');
else out = await ask(sql, false);
let p = 0, f = 0, quiet = false;
const ok = (name, cond, why = '') => { if (cond) p++; else { f++; if (!quiet) console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
function judge(out) {
  /* ① 表 */
  const so = (o) => JSON.stringify(Object.keys(o).sort().reduce((x, k) => { x[k] = o[k]; return x; }, {}));
  const norm = (k) => ({ ...k, min: k.min == null ? null : Number(k.min), max: k.max == null ? null : Number(k.max), step: k.step == null ? null : Number(k.step) });
  const dbKeys = out.keys.map(norm);
  ok('倉庫の mj_rule_keys は44行', dbKeys.length === RULE_KEYS.length, `${dbKeys.length} 行`);
  RULE_KEYS.forEach((k, i) => ok('鍵の行が同じ: ' + k.key, so(dbKeys[i]) === so(norm(k)), JSON.stringify(dbKeys[i])));
  /* ② 入力の表 */
  const sortObj = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
  ok('答えの数が入力の数と同じ', out.res.length === RAW.length, `${out.res.length}／${RAW.length}`);
  RAW.forEach((s, i) => {
    const js = rulesOk(JSON.parse(s));
    const db = out.res[i] || {};
    const dbErr = db.ok ? null : String(db.err || '').replace(/^mj_range:/, '');
    if (js.ok !== db.ok) ok(s, false, `lib ${js.ok ? '通る' : '弾く ' + js.err}／倉庫 ${db.ok ? '通る' : '弾く ' + db.err}`);
    else if (!js.ok) ok(s, js.err === dbErr, `弾いた鍵 lib ${js.err}／倉庫 ${db.err}`);
    else {
      ok(s, sortObj(js.rules) === sortObj(db.rules), `埋めた結果が違う lib ${sortObj(js.rules).slice(0, 120)}／倉庫 ${sortObj(db.rules).slice(0, 120)}`);
      const jt = Object.keys(js.rules).filter((k) => typeof js.rules[k] === 'number').sort().map((k) => k + '=' + js.rules[k]).join(',') + '|' + (js.rules.tane_custom || []).map((x) => x.pt10).join(',');
      ok(s + '（数の字）', jt === db.txt, `lib ${jt.slice(-60)}／倉庫 ${String(db.txt).slice(-60)}`);
    }
  });
  if (!quiet) console.log(`  入力 ${RAW.length} 件・鍵 ${RULE_KEYS.length} 行を倉庫と lib で比べた`);
}
if (out) judge(out);
console.log(`\n${p} passed, ${f} failed`);
let wazaBad = 0; const fBase = f;
/* --kari --waza（2c-3a）：当てる範囲をわざと壊して回し、★1本でも赤（lib と倉庫の答えが割れる）★になるかを見る＝試験が壊れを見つけられる事の確かめ */
if (out && process.argv.includes('--kari') && process.argv.includes('--waza')) {
  const WAZA = [
    ['並びの上限 5→6', 'pg_catalog.jsonb_array_length(p) > 5', 'pg_catalog.jsonb_array_length(p) > 6'],
    ['物の鍵の数を見ない', 'or (select count(*) from pg_catalog.jsonb_object_keys(e)) <> 4', ''],
    ['id の形 8→9字', "~ '^[a-z0-9]{1,8}$'", "~ '^[a-z0-9]{1,9}$'"],
    ['id の重なりを見ない', "or (e ->> 'id') = any (v_ids)", ''],
    ['name を落とさない', "v_nm := pg_catalog.btrim(e ->> 'name', c_trim);", "v_nm := e ->> 'name';"],
    ['name 10→11字', 'pg_catalog.char_length(v_nm) > 10', 'pg_catalog.char_length(v_nm) > 11'],
    ['そろえた字が空を通す', "if v_key = '' or", 'if'],
    ['名の重なりを見ない', 'or v_key = any (v_keys)', ''],
    ['チップ・祝儀・やきとりを通す', 'or v_key = any (c_res)', ''],
    ['pt10 の下 1→0', 'x < 1 or x > 9999', 'x < 0 or x > 9999'],
    ['pt10 を整数に直さない', "'pt10', x::bigint", "'pt10', e -> 'pt10'"],
    ['sum0 の型を見ない', "if pg_catalog.jsonb_typeof(e -> 'sum0') <> 'boolean' then return null; end if;", ''],
    ['yakitori_to の既定 each→split', '"vals":["each","split","top"],"nullable":false,"def4":"each","def3":"each"', '"vals":["each","split","top"],"nullable":false,"def4":"split","def3":"split"'],
    ['yakitori_top_tie の値から all を落とす', '"vals":["others","all"]', '"vals":["others"]'],
    ['list の枝が null を ok にする', 'if e is not null then ok := true; v := e; end if;', 'ok := true; v := coalesce(e, v);'],
  ];
  const base = kari();
  quiet = true;
  for (const [name, a, b] of WAZA) {
    if (!base.includes(a)) { wazaBad++; console.log('  ✗ waza の的が無い: ' + name); continue; }
    const o = await ask(base.split(a).join(b) + sql.slice(base.length), true);
    const f0 = f; if (o) judge(o); else f++;
    if (f === f0) { wazaBad++; console.log('  ✗ 壊しても緑: ' + name); } else console.log('  ✓ 狙いが赤: ' + name);
  }
  console.log(`  waza ${WAZA.length - wazaBad}/${WAZA.length} 狙いが赤`);
}
process.exitCode = fBase || !out || wazaBad ? 1 : 0;
