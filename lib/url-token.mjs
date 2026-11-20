/* url-token.mjs — ★部屋の URL の token の作り方と hash の取り方（1本だけ）★（案 room_join_sekkei.md v1.1 N1・設計図 §6）
 * =============================================================================
 * token＝128bit＝16 byte の乱数の小文字 hex 32字（URL の /r/<token>）。
 * url_token_hash＝sha256(token の hex の字を UTF8 で) の小文字 hex 64字＝mj_room_create が受けて rooms.url_token_hash に置く物。
 * 倉庫の mj_room_join は平文の token を受けて同じ式で hash にして比べる＝★倉庫が漏れても hash から入れない★。
 * ★端末も試験もここを使う★（自分で作って自分で hash する試験にしない＝tests/url-token.test.mjs と room-join.live.mjs）
 * ブラウザと node（>=20）の両方で動く（globalThis.crypto の getRandomValues・subtle）。
 */
export const TOKEN_RE = /^[0-9a-f]{32}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export function newToken() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return hex(b);
}

export async function tokenHash(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new Error('url-token: token は小文字 hex 32字');
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(d));
}
