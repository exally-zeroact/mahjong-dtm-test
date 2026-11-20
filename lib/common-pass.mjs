/* common-pass.mjs — ★よくあるパスの名簿と、パスの形の確かめ★（設計図 §3.1・§3.2「パスの守り」・案 room_create_sekkei.md）
 * =============================================================================
 * 倉庫の表 mahjong.mj_common_pass と ★1字も違わない★（種は supabase/schema.sql の cp 札の jsonb の字1本・
 * tests/common-pass.test.mjs が CI で比べる）。★倉庫の答えが正★＝ここは画面の先回り。
 * passKey＝NFKC → 英字 A〜Z だけ小文字（倉庫の mahjong_private.mj_pass_key と同じ・空白やカナは変えない）。
 * passOk(pass) → { ok: true } か { ok: false, err: 'bad'（打った字もそろえた字も 4〜64字・そろえた字が 72 byte 以下でない）| 'common'（名簿に当たる） }
 * ★倉庫が bf にかけるのは passKey（そろえた字）★＝全角で「１２３４」と打っても半角と同じパス（mj_room_create・mj_room_join）
 */
export const COMMON_PASS = [
  ...'0123456789'.split('').flatMap((d) => [d.repeat(4), d.repeat(6)]),
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890', '0123', '01234', '012345',
  '4321', '54321', '654321', '987654321',
  '1212', '1122', '2580', '1313', '6969', '1004', '2468', '1357', '7890', '4649',
  '1990', '2000', '2010', '2020', '2021', '2022', '2023', '2024', '2025', '2026',
  'password', 'password1', 'passw0rd', 'pass', 'pass1234', 'qwerty', 'qwerty123', 'qwertyuiop', 'asdf', 'asdfgh',
  'asdfghjkl', 'zxcv', 'zxcvbnm', 'abcd', 'abcd1234', 'abc123', 'abcdef', 'aaaa', 'aaaaaa', 'admin',
  'admin123', 'root', 'test', 'test1234', 'guest', 'user', 'login', 'letmein', 'welcome', 'iloveyou',
  'monkey', 'dragon', 'master', 'sunshine', '1q2w3e4r', '1qaz2wsx', 'qazwsx', 'mahjong', 'mahjong1', 'majan',
  'maajan', 'まーじゃん', 'マージャン', 'riichi', 'tsumo', 'dothemath',
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));


export function passKey(s) {
  return String(s).normalize('NFKC').replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}
const SET = new Set(COMMON_PASS.map(passKey));

export function passOk(pass) {
  if (typeof pass !== 'string') return { ok: false, err: 'bad' };
  const n = [...pass].length;
  if (n < 4 || n > 64) return { ok: false, err: 'bad' };
  const k = passKey(pass);
  const nk = [...k].length;
  if (nk < 4 || nk > 64 || new TextEncoder().encode(k).length > 72) return { ok: false, err: 'bad' };
  if (SET.has(k)) return { ok: false, err: 'common' };
  return { ok: true };
}

