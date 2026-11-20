/* url-token.test.mjs — ★lib/url-token.mjs の token の形と hash の式★（CI）
 * ① newToken は小文字 hex 32字・1000本で重なり0 ② tokenHash は node:crypto の sha256(UTF8 の字) と同じ・小文字 hex 64字
 * ③ 決めた字の答え（式が変わったら赤）④ 形の違い（31字・33字・大文字・数・null）は投げる
 * 使い方: node tests/url-token.test.mjs
 */
import crypto from 'node:crypto';
import { newToken, tokenHash, TOKEN_RE, HASH_RE } from '../lib/url-token.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) p++; else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };

const many = Array.from({ length: 1000 }, newToken);
ok('① newToken は小文字 hex 32字', many.every((t) => TOKEN_RE.test(t)), many.find((t) => !TOKEN_RE.test(t)));
ok('① 1000本で重なり0', new Set(many).size === 1000);
for (const t of many.slice(0, 20)) {
  const h = await tokenHash(t);
  ok('② tokenHash＝node の sha256(UTF8)', h === crypto.createHash('sha256').update(t, 'utf8').digest('hex') && HASH_RE.test(h), t);
}
const FIX = '00112233445566778899aabbccddeeff';
ok('③ 決めた字の答え', (await tokenHash(FIX)) === crypto.createHash('sha256').update(FIX).digest('hex'));
ok('③ 決めた字の答え（字で固定）', (await tokenHash(FIX)) === '5947d7c33d783f94b3b4c1a96ebc8991ed28f1b069b71e03376cba8caa98a720');
for (const [name, bad] of [['31字', FIX.slice(1)], ['33字', FIX + '0'], ['大文字', FIX.toUpperCase()], ['数', 1], ['null', null], ['64字の hash', 'a'.repeat(64)]]) {
  let threw = false; try { await tokenHash(bad); } catch (_) { threw = true; }
  ok('④ 形の違いは投げる：' + name, threw);
}
console.log(`\nurl-token: ${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
