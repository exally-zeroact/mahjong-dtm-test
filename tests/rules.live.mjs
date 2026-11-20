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
];

const D = '$';
const q = (t) => D + t + D;
const sql = `do ${q('rl')} declare res jsonb := '[]'; c jsonb; r jsonb; keys jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'min', min, 'max', max, 'step', step, 'vals', vals,
         'nullable', nullable, 'def4', def4, 'def3', def3, 'need', need) order by key collate "C"), '[]') into keys from mahjong.mj_rule_keys;
  for c in select value from jsonb_array_elements(${q('in')}${'[' + RAW.join(',') + ']'}${q('in')}::jsonb) loop
    begin
      r := mahjong_private.mj_rules_ok(c);
      res := res || jsonb_build_array(jsonb_build_object('ok', true, 'rules', r));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('ok', false, 'err', sqlerrm));
    end;
  end loop;
  raise exception 'MJRESULT%', jsonb_build_object('keys', keys, 'res', res)::text;
end ${q('rl')};`;


let out = null;
if (!isTest) console.log('★中止★ test の倉庫でない');
else {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  let msg = t; try { msg = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ }
  const at = msg.indexOf('MJRESULT');
  if (at < 0) console.log('★失敗★ 結果の例外が来なかった: ' + msg.slice(0, 300));
  else {
    try { out = JSON.parse(msg.slice(at + 8).split(String.fromCharCode(10))[0]); } catch (e) { console.log('★失敗★ 結果が読めない: ' + e.message); }
  }
}
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
if (out) {
  /* ① 表 */
  const so = (o) => JSON.stringify(Object.keys(o).sort().reduce((x, k) => { x[k] = o[k]; return x; }, {}));
  const norm = (k) => ({ ...k, min: k.min == null ? null : Number(k.min), max: k.max == null ? null : Number(k.max), step: k.step == null ? null : Number(k.step) });
  const dbKeys = out.keys.map(norm);
  ok('倉庫の mj_rule_keys は41行', dbKeys.length === RULE_KEYS.length, `${dbKeys.length} 行`);
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
    else ok(s, sortObj(js.rules) === sortObj(db.rules), `埋めた結果が違う lib ${sortObj(js.rules).slice(0, 120)}／倉庫 ${sortObj(db.rules).slice(0, 120)}`);
  });
  console.log(`  入力 ${RAW.length} 件・鍵 ${RULE_KEYS.length} 行を倉庫と lib で比べた`);
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
