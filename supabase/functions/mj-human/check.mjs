// supabase/functions/mj-human/check.mjs — P10 §3 の判定だけ（Deno と node の両方で読める・網は fetchFn で差し替え）
// 定め＝mahjong_tataki_2026-11-20/p10_sadame_v1.md v1.1 §3（S3: 設定が無ければ閉じる・試しの鍵は TESTKEY_OK=1 の倉庫だけ）
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const ACTION = 'mj_human';

// Cloudflare の答え（siteverify の JSON）を定めの通りに見る。印を付けてよい時だけ {ok:true}
export function judge(env, sv) {
  if (!sv || sv.success !== true) return { ok: false, reason: 'turnstile' };
  if (sv.metadata && sv.metadata.result_with_testing_key === true) {
    // 試しの鍵は hostname が example.com・action 無し＝見ない。通すのは TESTKEY_OK=1（khaw だけ）の時だけ
    return env.MJ_TURNSTILE_TESTKEY_OK === '1' ? { ok: true } : { ok: false, reason: 'testkey' };
  }
  const hosts = String(env.MJ_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(String(sv.hostname || '').toLowerCase())) return { ok: false, reason: 'host' };
  if (sv.action !== ACTION) return { ok: false, reason: 'action' };
  return { ok: true };
}

// 設定の確かめ → siteverify → judge。remoteip は送らない（S6: XFF は信じない）
export async function verifyToken(env, token, fetchFn = fetch, judgeFn = judge) {
  if (!env.MJ_TURNSTILE_SECRET || !String(env.MJ_HOSTS || '').trim()) return { ok: false, reason: 'config' };
  if (typeof token !== 'string' || !token || token.length > 4096) return { ok: false, reason: 'turnstile' };
  let sv;
  try {
    const res = await fetchFn(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.MJ_TURNSTILE_SECRET, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: 'net' };
    sv = await res.json();
  } catch {
    return { ok: false, reason: 'net' };
  }
  return judgeFn(env, sv);
}
