// supabase/functions/mj-human — P10 Turnstile：垢ごとに1回、人の確かめを通ったら印（mahjong.accounts.human_at）を付ける
// 定め＝p10_sadame_v1.md v1.1 §3。入力 POST {token}＋Authorization: Bearer <客の JWT>（verify_jwt on）
// 出力 {ok:true} | {ok:false, reason: config|turnstile|testkey|host|action|net}（200）／JWT 無し・悪い＝401／倉庫の失敗＝500 {reason:'db'}
// uid は auth.getUser(jwt) だけから取る（体の中の uid は読まない）。印は直の接続（SUPABASE_DB_URL）で mahjong_private.mj_human_mark だけ。
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';
import { verifyToken } from './check.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  const auth = req.headers.get('authorization') || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return json({ ok: false, reason: 'auth' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uErr } = await sb.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (uErr || !uid) return json({ ok: false, reason: 'auth' }, 401);

  let body: { token?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'turnstile' }); }

  const env = {
    MJ_TURNSTILE_SECRET: Deno.env.get('MJ_TURNSTILE_SECRET') || '',
    MJ_HOSTS: Deno.env.get('MJ_HOSTS') || '',
    MJ_TURNSTILE_TESTKEY_OK: Deno.env.get('MJ_TURNSTILE_TESTKEY_OK') || '',
  };
  const v = await verifyToken(env, body?.token);
  if (!v.ok) return json(v);

  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) return json({ ok: false, reason: 'config' });
  const sql = postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const rows = await sql`select mahjong_private.mj_human_mark(${uid}::uuid) as r`;
    if (rows[0]?.r !== true) return json({ ok: false, reason: 'db' }, 500);
    return json({ ok: true });
  } catch {
    return json({ ok: false, reason: 'db' }, 500);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
});
