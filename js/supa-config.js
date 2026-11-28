/* supa-config.js — ★テスト用DB★ (mahjong-dtm-test)
 * ============================================================================
 * ★このrepoで 倉庫の向き先（URL・鍵・ref）を持ってよいのは このファイルだけ★
 *   他のどのファイルにも書かない。tests/no-hardcoded-supa.test.mjs が破りを赤にする。
 * ★repo名を環境の証拠にするな★＝判断は remote と この env でする。
 * ★このファイルを本番repo(mahjong-dtm)に絶対にコピーしない★（運ぶ道具の NEVER_SHIP）
 *   本番の supa-config.js は 本番倉庫を指し env:'prod'。だから本番に帯は出ない。
 * env = この配信がどの環境か（'test' | 'prod'）＝js/env-badge.js の帯はこれ1つで決まる。
 * 倉庫: DB-test（全アプリ共有のテスト倉庫）。部屋(schema): mahjong。
 *   全員アドレスでログイン（共有の Supabase Auth・v18）。画面は public.mj_* の関数（RPC）だけを呼ぶ（表は直接読まない）。
 */
window.SUPA = {
  url: 'https://khawdrnvssdenumbiwfg.supabase.co',
  key: 'sb_publishable_UrRIobyVFbaJI_85RBxBOA_GZ4OUxPm',
  env: 'test',
  turnstile: '1x00000000000000000000AA' // P10 §4：Cloudflare Turnstile の site key（テスト＝必ず通る公開の試しの key・本番の supa-config は本番の key）
};
