/* common-pass.test.mjs — ★よくあるパスの名簿（schema.sql の種）と lib/common-pass.mjs が1字も違わないか＋形の確かめ★（CI）
 * =============================================================================
 * ① schema.sql の $cp$…$cp$（倉庫の mahjong.mj_common_pass の種）を JSON.parse して lib の COMMON_PASS と同じ並び
 * ② 100個・重なり0・どれもそろえた後の形（passKey(x) === x）・1〜64字
 * ③ passKey（NFKC → A〜Z だけ小文字）と passOk の答えを手で決めた表で
 * 使い方: node tests/common-pass.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_PASS, passKey, passOk } from '../lib/common-pass.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };

const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
const D = '$';
const all = [...sql.matchAll(new RegExp('\\' + D + 'cp\\' + D + '([\\s\\S]*?)\\' + D + 'cp\\' + D, 'g'))];
ok('schema.sql に名簿の種（$cp$ の jsonb の字）がちょうど1つ', all.length === 1, String(all.length));
let seed = null;
try { seed = JSON.parse(all[0][1]); } catch (e) { ok('種が JSON として読める', false, e.message); }
ok('種と lib の COMMON_PASS が同じ並び', JSON.stringify(seed) === JSON.stringify(COMMON_PASS));
ok('100個', COMMON_PASS.length === 100, String(COMMON_PASS.length));
ok('重なり0', new Set(COMMON_PASS).size === COMMON_PASS.length);
ok('どれもそろえた後の形', COMMON_PASS.every((x) => passKey(x) === x), COMMON_PASS.filter((x) => passKey(x) !== x).join(','));
ok('どれも1〜64字（表の CHECK）', COMMON_PASS.every((x) => [...x].length >= 1 && [...x].length <= 64));

const K = [
  ['Password', 'password'], ['ＰＡＳＳ１２３４', 'pass1234'], ['１２３４', '1234'], ['MahJong', 'mahjong'],
  ['マージャン', 'マージャン'], ['ﾏｰｼﾞｬﾝ', 'マージャン'], ['ÄBC', 'Äbc'], ['a b', 'a b'], ['Ａ　Ｂ', 'a b'],
];
for (const [i, o] of K) ok(`passKey(${i}) = ${o}`, passKey(i) === o, passKey(i));

const P = [
  ['abc', 'bad'], ['abcd', 'common'], ['abce', 'ok'], ['x'.repeat(64), 'ok'], ['x'.repeat(65), 'bad'], ['あ'.repeat(24), 'ok'], ['あ'.repeat(25), 'bad'],
  ['Password', 'common'], ['ＰＡＳＳＷＯＲＤ', 'common'], ['１２３４', 'common'], ['ﾏｰｼﾞｬﾝ', 'common'], ['mahjong2', 'ok'],
  ['㍿㍿', 'bad'], ['㍿㍿㍿㍿', 'ok'], ['㍿㍿㍿㍿㍿㍿', 'ok'], ['㍿㍿㍿㍿㍿㍿㍿', 'bad'], [null, 'bad'], [1234, 'bad'], ['ｶﾞｶﾞ', 'bad'],
];
for (const [i, o] of P) {
  const r = passOk(i);
  ok(`passOk(${JSON.stringify(i)}) = ${o}`, (r.ok ? 'ok' : r.err) === o, JSON.stringify(r));
}

console.log(`\ncommon-pass: ${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
