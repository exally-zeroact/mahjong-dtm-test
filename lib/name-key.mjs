/* name-key.mjs — ★名前のそろえた字★（設計図 v15.8 N1）
 * =============================================================================
 * 倉庫の mahjong_private.mj_name_key(name) と ★1字も違わない手順★（試験＝tests/name-key.live.mjs が
 * 同じ字の表を両方に通して答えが同じかを見る）。画面は「同じ名前の人がいます」を先に出すために使う。
 * ★倉庫が出す key が正★（端末の字は信じない）。ここは画面の先回りだけ。
 *
 * 手順（版 NAME_KEY_VER＝1）：
 *   ① NFKC（全角英数→半角・半角カナ→全角・合字や丸数字もほどく）
 *   ② カタカナ（ァ U+30A1〜ヶ U+30F6・ヽ ヾ）をひらがなに（−0x60）
 *   ③ 空白の字（SPACES の13字）を消す（NFKC の後は全角の空白・U+2000 台も半角の空白になる）
 *   ④ 英字 A〜Z だけを小文字に（★toLowerCase は使わない★＝倉庫の lower() は場所の設定で変わる）
 * 手順を変える日は NAME_KEY_VER を上げ、倉庫の関数と一緒に変える（設計図 N1 の寄せ直しの手順）。
 */
export const NAME_KEY_VER = 1;
/* 消す空白の字（倉庫の関数と同じ13字・\s は JS と倉庫で範囲が違うので使わない） */
export const SPACES = new Set([0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0x85, 0x1680, 0x180e, 0x200b, 0x2028, 0x2029, 0xfeff]);

export function nameKey(name) {
  let s = String(name ?? '').normalize('NFKC');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x30a1 && c <= 0x30f6) || c === 0x30fd || c === 0x30fe) out += String.fromCodePoint(c - 0x60);
    else if (c >= 0x41 && c <= 0x5a) out += String.fromCodePoint(c + 0x20);
    else if (SPACES.has(c)) continue;
    else out += ch;
  }
  return out;
}
