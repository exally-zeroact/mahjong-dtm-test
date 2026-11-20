/* name-key.test.mjs — ★名前のそろえた字★（lib/name-key.mjs）が手で決めた答えを出すか
 * =============================================================================
 * 倉庫の mahjong_private.mj_name_key と同じ字になるかは tests/name-key.live.mjs（鍵が要る＝手元）。
 * ここは「手順そのもの」を手で決めた答えで縛る（手順を変えたら NAME_KEY_VER を上げて、ここも直す）。
 * 使い方: node tests/name-key.test.mjs
 */
import { nameKey, NAME_KEY_VER, SPACES } from '../lib/name-key.mjs';

const CASES = [
  ['カタカナはひらがなに', 'コウオツ', 'こうおつ'],
  ['ひらがなはそのまま', 'こうおつ', 'こうおつ'],
  ['半角カナ（濁点つき）は全角→ひらがな', 'ｶﾞｷﾞ', 'がぎ'],
  ['ヴ・ヵ・ヶ・ヽ・ヾ も寄せる', 'ヴヵヶヽヾ', 'ゔゕゖゝゞ'],
  ['ヷ（U+30F7）は対のひらがなが無い＝そのまま', 'ヷ', 'ヷ'],
  ['のばし棒ーは消さない', 'コーヒー', 'こーひー'],
  ['全角英字は半角の小文字に', 'ＡＢｃ', 'abc'],
  ['半角の大文字は小文字に', 'TSU', 'tsu'],
  ['A〜Z の外の大文字は変えない（Ä・İ）', 'ÄİZ', 'Äİz'],
  ['丸数字は NFKC でほどく', '甲①', '甲1'],
  ['全角の空白と半角の空白を消す', ' 甲　乙 ', '甲乙'],
  ['タブ・改行・幅0の空白・BOM を消す', '\t甲\n\u200b乙\ufeff', '甲乙'],
  ['U+2003（全角幅の空白）も NFKC の後に消える', '甲\u2003乙', '甲乙'],
  ['漢字はそのまま', '甲乙丙', '甲乙丙'],
  ['記号はそのまま', 'つー(仮)', 'つー(仮)'],
  ['空の字は空', '', ''],
  ['null は空（倉庫は strict で null）', null, ''],
  ['カタカナと全角英字と空白が混ざっても同じ人', 'ツー　Ａ', 'つーa'],
];

let p = 0, f = 0;
for (const [name, input, want] of CASES) {
  const got = nameKey(input);
  if (got === want) { p++; console.log(`  ✓ ${name}`); }
  else { f++; console.log(`  ✗ ${name} — ${JSON.stringify(input)} → ${JSON.stringify(got)}（欲しい ${JSON.stringify(want)}）`); }
}
/* 版と空白の数は倉庫の関数と組（変えたら倉庫も変える） */
if (NAME_KEY_VER === 1) { p++; console.log('  ✓ NAME_KEY_VER は 1'); } else { f++; console.log(`  ✗ NAME_KEY_VER が ${NAME_KEY_VER}（倉庫の関数と一緒に変えたか）`); }
if (SPACES.size === 13) { p++; console.log('  ✓ 消す空白は13字'); } else { f++; console.log(`  ✗ 消す空白が ${SPACES.size} 字`); }
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
