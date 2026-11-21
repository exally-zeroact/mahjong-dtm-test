/* bunrui.test.mjs — tools/_bunrui.mjs（CI の段を 測った/読めない/exit0failed 等に 割る）の 正解表（11-22 件5-a'）
 *   node tests/bunrui.test.mjs              … 正解表
 *   node tests/bunrui.test.mjs --self-test  … 読む式を わざと 壊して 正解表が 赤に なるか（自己確認: a/b）
 * ★麻雀で 足した 1か所★＝行頭の「自己確認: a/b」を 約束の 行として 読む（KEKKA が 在れば そちらが 先）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tools', '_bunrui.mjs');

const ROWS = [
  // [名, 終わり値, 出し, 欲しい桶, 欲しい passed]
  ['自己確認 52/52 → 測った', 0, '  ✓ a\n自己確認: 52/52\n✓ 床: x は 52 組 以上\n', '測った', 52],
  ['自己確認 51/52 で終わり値0 → exit0failed', 0, '自己確認: 51/52\n', 'exit0failed', 51],
  ['自己確認 0/0 は読まない → 読めない', 0, '自己確認: 0/0\n', '読めない', 0],
  ['a>b は読まない → 読めない', 0, '自己確認: 9/8\n', '読めない', 0],
  ['自己確認: OK の字は読まない（✓ だけ）→ 読めない', 0, '  ✓ x\n自己確認 OK（わざと 食い違わせると 赤に なる）\n', '読めない', 0],
  ['行の途中の 自己確認: 3/3 は読まない', 0, '  ✓ 説明 自己確認: 3/3\n', '読めない', 0],
  ['✓ だけ → 読めない', 0, '✓ 早見表 605 マス\n', '読めない', 0],
  ['KEKKA → 測った', 0, '✓ 早見表 605 マス\nKEKKA {"passed":605,"failed":0,"mimiso":0}\n', '測った', 605],
  ['KEKKA が自己確認より先', 0, '自己確認: 3/3\nKEKKA {"passed":7,"failed":0,"mimiso":0}\n', '測った', 7],
  ['KEKKA の未測定 → 一部抜け', 0, 'KEKKA {"passed":5,"failed":0,"mimiso":1}\n', '一部抜け', 5],
  ['終わり値1 は自己確認が満点でも 赤', 1, '自己確認: 8/8\n', '赤', 8],
  ['✗ が在る終わり値0 → exit0failed', 0, '  ✓ a\n  ✗ b\n', 'exit0failed', 0],
  ['最後の 自己確認 を読む', 0, '自己確認: 1/2\n自己確認: 4/4\n', '測った', 4],
];

function judge(bunrui) {
  const bad = [];
  for (const [nm, st, out, oke, p] of ROWS) {
    const r = bunrui(st, out);
    if (r.oke !== oke || r.passed !== p) bad.push(`${nm}：桶 ${r.oke}／passed ${r.passed}（欲しい ${oke}／${p}）`);
  }
  return bad;
}

const BREAKS = [
  ['自己確認を読まない', 'if (!m.length) return yomuJikakunin(out);', 'if (!m.length) return null;'],
  ['a>b も通す', 'if (!(b > 0) || a > b) return null;', 'if (!(b > 0)) return null;'],
  ['failed を 0 に', 'return { passed: a, failed: b - a, mimiso: 0 };', 'return { passed: a, failed: 0, mimiso: 0 };'],
  ['最初の 自己確認 を読む', 'const a = +m[m.length - 1][1], b = +m[m.length - 1][2];', 'const a = +m[0][1], b = +m[0][2];'],
  ['行頭でなくても読む', "matchAll(/^\\s*自己確認:", "matchAll(/自己確認:"],
];

if (process.argv.includes('--self-test')) {
  const base = judge((await import(pathToFileURL(SRC).href)).bunrui);
  if (base.length) { console.log(`✗ 壊す前に赤が ${base.length} 本`); base.forEach((b) => console.log('  ' + b)); process.exit(1); }
  const src = fs.readFileSync(SRC, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mahjong-bunrui-'));
  let red = 0;
  try {
    BREAKS.forEach(([nm, a, b], i) => {
      if (src.split(a).length !== 2) { console.log(`  ✗ 壊し「${nm}」の元の字が1つでない`); return; }
      fs.writeFileSync(path.join(tmp, `b${i}.mjs`), src.replace(a, () => b));
    });
    for (let i = 0; i < BREAKS.length; i++) {
      const f = path.join(tmp, `b${i}.mjs`);
      if (!fs.existsSync(f)) continue;
      const n = judge((await import(pathToFileURL(f).href)).bunrui).length;
      if (n > 0) { red++; console.log(`  ✓ 壊し「${BREAKS[i][0]}」→ 赤 ${n}`); }
      else console.log(`  ✗ 壊し「${BREAKS[i][0]}」でも緑`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`自己確認: ${red}/${BREAKS.length}`);
  process.exit(red === BREAKS.length ? 0 : 1);
}

const bad = judge((await import(pathToFileURL(SRC).href)).bunrui);
if (bad.length) { console.log(`✗ 段の割り方 ${bad.length}/${ROWS.length} が違う`); bad.forEach((b) => console.log('  ' + b)); process.exit(1); }
console.log(`✓ 段の割り方 ${ROWS.length} 行 全部 正解表と同じ`);
console.log('KEKKA ' + JSON.stringify({ passed: ROWS.length, failed: 0, mimiso: 0 }));
