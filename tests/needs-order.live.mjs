/* needs-order.live.mjs — ★倉庫の mj_needs_order と lib/needs-order.mjs が同じ答えか★（手元・鍵が要る＝tests-no-ci.json）
 * 表は tests/needs-order.cases.mjs（JSON の字のまま倉庫へ＝35000.0・1e4 も字の通りに届く）。手で決めた答えとも比べる。
 * 倉庫には何も書かない（do の塊の最後でわざと例外を投げて結果を持ち帰る＝db-checks と同じ形）。
 * 使い方: node tests/needs-order.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { needsOrder } from '../lib/needs-order.mjs';
import { CASES } from './needs-order.cases.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
/* ★倉庫の門（設計 I-6）★ env の字だけでなく ref を直に見る（字は supa-config.js だけが持つ＝ここは sha256 の頭16字の指紋で照らす）＝khaw（全アプリ共有のテスト倉庫）でなければ1行も呼ばずに止める（本番 auth に試しのアカウントを作らない） */
if ((await import('node:crypto')).createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
const isTest = /env:\s*'test'/.test(src);
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const D = '$';
const q = (t) => D + t + D;
const pairs = '[' + CASES.map((k) => `[${k.r},${k.c}${k.y === undefined ? '' : ',' + k.y}]`).join(',') + ']';
const sql = `do ${q('no')} declare res jsonb := '[]'; c jsonb;
begin
  for c in select value from jsonb_array_elements(${q('in')}${pairs}${q('in')}::jsonb) loop
    begin
      res := res || jsonb_build_array(mahjong_private.mj_needs_order(c->0, c->1, c->2));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('err', sqlerrm));
    end;
  end loop;
  raise exception 'MJRESULT%', res::text;
end ${q('no')};`;

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
  ok('答えの数が入力の数と同じ', out.length === CASES.length, `${out.length}／${CASES.length}`);
  CASES.forEach((k, i) => {
    const js = JSON.stringify(k.y === undefined ? needsOrder(JSON.parse(k.r), JSON.parse(k.c)) : needsOrder(JSON.parse(k.r), JSON.parse(k.c), JSON.parse(k.y)));
    const db = JSON.stringify(out[i]);
    const want = JSON.stringify(k.want);
    ok(`${k.r} ${k.c} ${k.y ?? ''}`, js === db && db === want, `lib ${js}／倉庫 ${db}／答え ${want}`);
  });
  console.log(`  入力 ${CASES.length} 件を倉庫と lib と答えで比べた`);
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f || !out ? 1 : 0;
