/* apply-schema.mjs — ★設計図を倉庫に当てる（門番を必ず通ってから）★（麻雀〜do the math〜）
 * =============================================================================
 * 正本＝timeally-test scripts/apply-schema.mjs（形はそのまま・鍵の置き場と数える物だけ違う）
 * ★向き先は js/supa-config.js からしか読まない★＝このrepoが指している倉庫以外には当たらない。
 * ★env:'prod' のときは --yes-prod を付けないと止まる★（本番倉庫は司さんの一言が先）
 * 鍵: ~/.supabase-token（JSON の token・%TEMP% に置かない＝10-02 消えて半日止まった）★中身を出さない★
 * ★1つの取引で当てる★（begin … commit）＝途中で落ちたら1文字も残らない。
 * 当てた後に ★表・RLS・決まりの表・客の権限を数えて APPLY RESULT: OK/NG を出す★
 *
 * 使い方: node scripts/apply-schema.mjs           … supabase/schema.sql を当てる
 *         node scripts/apply-schema.mjs --probe   … 当てずに数えるだけ
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { check } from './sql-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★今の設計図で在るべき数★（段を足したらここも直す＝数が合わなければ NG） */
export const EXPECT = { tables: 23, ops: 34, caps: 12, rule_keys: 41, common_pass: 100, public_funcs: 1 };

/** ★コメントを落としてから読む★（説明文の env:'prod' を拾って誤読しない） */
export function stripJsComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

function readConfig() {
  const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
  const url = /url:\s*'([^']+)'/.exec(src);
  const env = /env:\s*'([^']+)'/.exec(src);
  if (!url) throw new Error('js/supa-config.js から url を読めません');
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url[1]);
  if (!ref) throw new Error('url の形が想定と違います');
  return { ref: ref[1], env: env ? env[1] : '' };
}

function readToken() {
  const p = path.join(os.homedir(), '.supabase-token');
  if (!fs.existsSync(p)) throw new Error('鍵が見つかりません（~/.supabase-token）');
  const raw = fs.readFileSync(p, 'utf8').trim();
  let t = raw;
  try { t = JSON.parse(raw).token; } catch (_) { /* 素の字ならそのまま */ }
  if (!t) throw new Error('鍵の中身が読めません（~/.supabase-token）');
  return t;
}

async function query(ref, token, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 600)}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

/* ★客（anon・authenticated）が実際に触れるかを has_*_privilege で聞く★
   （grant の字を数えると PUBLIC 経由・既定の権限を見落とす＝timeally 08-22 の教訓） */
const COUNT_SQL = `
with n as (select oid, nspname from pg_namespace where nspname in ('mahjong','mahjong_private'))
select
 (select count(*) from pg_class c join n on n.oid=c.relnamespace where n.nspname='mahjong' and c.relkind='r') as tables,
 (select count(*) from pg_class c join n on n.oid=c.relnamespace where n.nspname='mahjong' and c.relkind='r' and c.relrowsecurity) as rls_on,
 (select count(*) from pg_policies where schemaname in ('mahjong','mahjong_private')) as policies,
 (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'mj\\_%') as public_funcs,
 (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'mj\\_%'
    and p.prosecdef and p.proconfig @> array['search_path=""']
    and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0)) as public_funcs_ok,
 (select count(*) from n where has_schema_privilege('anon', n.oid, 'USAGE') or has_schema_privilege('authenticated', n.oid, 'USAGE')) as client_usage,
 (select count(*) from pg_class c join n on n.oid=c.relnamespace where c.relkind in ('r','v','S')
    and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))) as client_table_priv,
 (select count(*) from pg_proc p join n on n.oid=p.pronamespace
    where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) as client_private_funcs
`;
const SEED_SQL = `select (select count(*) from mahjong.mj_ops) as ops, (select count(*) from mahjong.mj_caps) as caps,
 (select count(*) from mahjong.totals) as totals_rows, (select count(*) from mahjong.mj_rule_keys) as rule_keys,
 (select count(*) from mahjong.mj_common_pass) as common_pass`;

async function main() {
  const cfg = readConfig();
  const probe = process.argv.includes('--probe');
  const yesProd = process.argv.includes('--yes-prod');
  console.log(`倉庫: ${cfg.ref.slice(0, 4)}…（env: ${cfg.env || '不明'}）`);
  if (cfg.env !== 'test' && !yesProd) {
    console.log('★中止★ env が test ではありません。本番に当てるには --yes-prod が要ります（司さんの一言が先）');
    process.exit(1);
  }

  const file = 'supabase/schema.sql';
  const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!probe) {
    const bad = check(sql);
    if (bad.length) {
      console.log(`★中止★ 門番に落ちました（1文字も当てません）: ${file}`);
      bad.forEach((b) => console.log('   - ' + b));
      process.exit(1);
    }
  }

  const token = readToken();
  console.log('鍵: ~/.supabase-token（中身は出しません）');

  const before = await query(cfg.ref, token, COUNT_SQL);
  console.log('当てる前:', JSON.stringify(before[0] || before));

  if (!probe) {
    await query(cfg.ref, token, 'begin;\n' + sql + '\ncommit;');
    console.log(`当てました: ${file}`);
  }

  const a = (await query(cfg.ref, token, COUNT_SQL))[0] || {};
  const s = Number(a.tables) > 0 ? ((await query(cfg.ref, token, SEED_SQL))[0] || {}) : {};
  console.log('当てた後:', JSON.stringify({ ...a, ...s }));

  const clientOk = Number(a.client_usage) === 0 && Number(a.client_table_priv) === 0 && Number(a.client_private_funcs) === 0;
  const ok = Number(a.tables) === EXPECT.tables && Number(a.rls_on) === EXPECT.tables && Number(a.policies) === 0
    && Number(s.ops) === EXPECT.ops && Number(s.caps) === EXPECT.caps && Number(s.rule_keys) === EXPECT.rule_keys && Number(s.totals_rows) === 1
    && Number(s.common_pass) === EXPECT.common_pass
    && Number(a.public_funcs) === EXPECT.public_funcs && Number(a.public_funcs_ok) === EXPECT.public_funcs && clientOk;
  console.log(`\nAPPLY RESULT: ${ok ? 'OK' : 'NG'}`
    + `  表=${a.tables}/${EXPECT.tables} RLS=${a.rls_on} 決まり書き=${a.policies} 操作=${s.ops}/${EXPECT.ops}`
    + ` 上限=${s.caps}/${EXPECT.caps} ルールの鍵=${s.rule_keys}/${EXPECT.rule_keys} よくあるパス=${s.common_pass}/${EXPECT.common_pass}`
    + ` public.mj_*=${a.public_funcs}/${EXPECT.public_funcs}（definer・search_path 空・authenticated だけに EXECUTE〔anon に無い〕・PUBLIC 無し=${a.public_funcs_ok}）`);
  console.log(`  客（anon・authenticated）… 部屋の USAGE=${a.client_usage} 表の権限=${a.client_table_priv} 部屋の関数=${a.client_private_funcs}`
    + `（★全部0★）${clientOk ? '' : ' ← ★ここが NG★'}`);
  process.exit(ok ? 0 : 1);
}

/* ★import しただけで倉庫に当たらないようにする門★（timeally 08-15 実際に踏んだ） */
const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (DIRECT) main().catch((e) => { console.error('★失敗★ ' + e.message); process.exit(1); });
