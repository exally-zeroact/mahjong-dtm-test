/* tiles.mjs — ★牌の名前と34種の番号★（待ち読み・点数計算・牌の絵の共通）
 * 番号：0-8＝1m〜9m・9-17＝1p〜9p・18-26＝1s〜9s・27-33＝東南西北白發中（1z〜7z）。
 * 字の名前：'1m'…'9m'・'0m'＝赤5萬（'0p'・'0s' も）・'1z'…'7z'。赤5は計算では5と同じ（絵と点数のドラだけ別）。
 */
export const SUITS = ['m', 'p', 's', 'z'];
export const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];

export function codeToIndex(code) {
  const n = code[0] === '0' ? 5 : +code[0];
  const s = SUITS.indexOf(code[1]);
  if (s < 0 || !(n >= 1 && n <= (s === 3 ? 7 : 9))) throw new Error('tile ' + code);
  return s * 9 + n - 1;
}
export function indexToCode(i) {
  return (i % 9 + 1) + SUITS[Math.floor(i / 9)];
}
export const isAka = (code) => code[0] === '0';
export const isHonor = (i) => i >= 27;
export const isYaochu = (i) => i >= 27 || i % 9 === 0 || i % 9 === 8;
export const YAOCHU = Array.from({ length: 34 }, (_, i) => i).filter(isYaochu);

/** 名前の並び → 34の数え */
export function toCounts(codes) {
  const c = new Array(34).fill(0);
  for (const x of codes) c[codeToIndex(x)]++;
  return c;
}
/** '123m456p77z' の形（試験と手入力用）→ 名前の並び */
export function parse(str) {
  const out = [];
  let digits = [];
  for (const ch of str.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) digits.push(ch);
    else if (SUITS.includes(ch)) { for (const d of digits) out.push(d + ch); digits = []; }
    else throw new Error('parse ' + str);
  }
  if (digits.length) throw new Error('parse ' + str);
  return out;
}
/** 34の数えから並べた名前（萬→筒→索→字） */
export function countsToCodes(c) {
  const out = [];
  for (let i = 0; i < 34; i++) for (let k = 0; k < c[i]; k++) out.push(indexToCode(i));
  return out;
}
/** 手の並べ替え（赤5は5の所・同じなら赤を先） */
export function sortCodes(codes) {
  return [...codes].sort((a, b) => codeToIndex(a) - codeToIndex(b) || (isAka(b) - isAka(a)));
}
/** 名前（画面の読み上げ） */
export function tileName(code) {
  const i = codeToIndex(code);
  if (i >= 27) return HONOR_NAMES[i - 27];
  const n = i % 9 + 1;
  return (isAka(code) ? '赤' : '') + n + ['萬', '筒', '索'][Math.floor(i / 9)];
}
