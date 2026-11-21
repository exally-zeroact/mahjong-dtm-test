/* sql-guard.mjs — ★倉庫に当てる前の門番★（麻雀〜do the math〜）
 * =============================================================================
 * 正本＝timeally-test scripts/sql-guard.mjs（形はそのまま・部屋の名と足した見張りだけ違う）
 * ★1本でも門番に落ちたら 1文字も当てない★（部分適用は「手元は緑・倉庫は半端」を作る）
 *
 * 止めたい事故:
 *   ① ★消す系（drop table / drop schema / truncate / drop column）が混ざる★
 *   ② ★別のアプリの部屋に当たる★ … 倉庫は全アプリ共有。名前を1つ間違えると他の棚を触る。
 *      ★public に置いてよいのは mj_ で始まる物だけ★（設計図 §3.1＝外から呼ぶ入口 public.mj_*）
 *   ③ ★窓口(view)の security_invoker が抜ける★（今は窓を作らない・作った日に効く）
 *   ④ ★関数の外に DML が裸で置かれる★ … 例外は決まりの表の種（mj_ops・mj_caps・totals の1行）だけ
 *   ⑤ ★部屋 mahjong / mahjong_private を anon・authenticated に開ける★（設計図 §3.1 の権限）
 *      … 客は public.mj_* の入口だけを呼ぶ。表と補助へ USAGE・権限を付けたら中止。
 *      ★入口の関数は authenticated だけ★（v18＝全員ログイン）＝anon・public に execute を付けたら中止。
 *
 * 使い方: node scripts/sql-guard.mjs supabase/schema.sql
 *         node scripts/sql-guard.mjs --self-test   ★わざと危ない物を食わせて止まるか★
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ★直に叩かれた時だけ動く★（apply-schema.mjs が check() を借りる時に CLI を走らせない） */
const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ★このアプリが触ってよい部屋★ */
export const ALLOWED_SCHEMAS = ['mahjong', 'mahjong_private', 'public', 'extensions'];
/* 他のアプリの部屋（見つけたら即中止） */
export const FOREIGN_SCHEMAS = ['kyuyo', 'daikome', 'castally', 'amakase', 'daikou', 'exally', 'seikyu', 'timeally', 'nomiya', 'rakunally'];
/* public に置いてよい名前の頭 */
export const PUBLIC_PREFIX = 'mj_';
/* 関数の外で種を入れてよい表（決まりの表だけ・on conflict で何度当てても同じ） */
export const SEED_TABLES = ['mahjong.mj_ops', 'mahjong.mj_caps', 'mahjong.totals'];

/** コメントを落とす（-- と /* *\/）。文字列リテラルは残す。 */
export function stripComments(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/** $$ … $$ / $tag$ … $tag$ で囲まれた関数の中身を取り出し、外側だけを返す。 */
export function splitBodies(sql) {
  const bodies = [];
  const outer = String(sql).replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, (m) => {
    bodies.push(m);
    return ' $BODY$ ';
  });
  return { outer, bodies };
}

/** 違反を返す（純関数＝self-test で作り物を通せる）。 */
export function check(sql) {
  const bad = [];
  const clean = stripComments(sql);
  const { outer, bodies } = splitBodies(clean);
  const flat = outer.replace(/\s+/g, ' ').toLowerCase();

  /* ① 消す系 — policy / function / constraint / trigger / index の drop だけは許す（作り直しに要る・行は消えない） */
  /* ＋ 列の alter column … drop not null／drop default も許す（決まりを緩めるだけ・行も列も消えない＝v18 で使わない列を空にする） */
  const flatD = flat.replace(/\balter\s+column\s+[a-z_][a-z0-9_]*\s+drop\s+(not\s+null|default)\b/g, 'alter column _ keep');
  const drops = flatD.match(/\bdrop\s+(\w+)/g) || [];
  const DROPPABLE = ['policy', 'function', 'constraint', 'trigger', 'index'];
  for (const d of drops) {
    const what = d.split(/\s+/)[1];
    if (!DROPPABLE.includes(what)) bad.push(`消す系が混ざっている: ${d}`);
  }
  if (/\btruncate\b/.test(flat)) bad.push('truncate が混ざっている');
  if (/\balter\s+table\b[^;]*\bdrop\s+column\b/.test(flat)) bad.push('alter table … drop column（列を落とす）が混ざっている');
  if (/\balter\s+table\b[^;]*\bdrop\b(?!\s+(constraint|column|not null|default))/.test(flat)) bad.push('alter table … drop（想定外）が混ざっている');

  /* ② 別のアプリの部屋 */
  for (const s of FOREIGN_SCHEMAS) {
    if (new RegExp('\\b' + s + '\\.', 'i').test(flat)) bad.push(`他のアプリの部屋に当たっている: ${s}.`);
  }
  /* 作る物の名前を数える（public は mj_ だけ・部屋は mahjong / mahjong_private だけ） */
  const creates = flat.match(/\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|view|function|sequence|type|index)\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][a-z0-9_]*\s+on\s+)?([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?/g) || [];
  for (const c of creates) {
    const m = /([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(c);
    if (/\bindex\b/.test(c)) continue;                 // 索引は on の表で見る（下）
    if (!m) { bad.push(`部屋の名が付いていない: ${c}`); continue; }
    const [, sch, obj] = m;
    if (!ALLOWED_SCHEMAS.includes(sch) || sch === 'extensions') bad.push(`この部屋には作れない: ${sch}.${obj}`);
    else if (sch === 'public' && !obj.startsWith(PUBLIC_PREFIX)) bad.push(`public に mj_ でない名前: public.${obj}`);
  }
  const idxOn = flat.match(/\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?[a-z_][a-z0-9_]*\s+on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/g) || [];
  for (const i of idxOn) {
    const m = /on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(i);
    if (m && m[1] !== 'mahjong') bad.push(`索引を部屋の外の表に付けている: ${m[1]}.${m[2]}`);
  }
  const schemas = flat.match(/\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/g) || [];
  for (const s of schemas) {
    const name = s.split(/\s+/).pop();
    if (!['mahjong', 'mahjong_private'].includes(name)) bad.push(`作ってよい部屋でない: ${name}`);
  }
  const alters = flat.match(/\balter\s+(?:table|view|function)\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/g) || [];
  for (const a of alters) {
    const m = /([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(a);
    if (m[1] === 'public' && !m[2].startsWith(PUBLIC_PREFIX)) bad.push(`public の mj_ でない物を変えている: public.${m[2]}`);
    else if (!['mahjong', 'mahjong_private', 'public'].includes(m[1])) bad.push(`部屋の外を変えている: ${m[1]}.${m[2]}`);
  }

  /* ③ 窓口の security_invoker */
  const views = [...clean.matchAll(/create\s+or\s+replace\s+view\s+((?:public|mahjong)\.[a-z_0-9]+)([\s\S]*?)\bas\b/gi)];
  if (!views.length && /create\s+(or\s+replace\s+)?view/i.test(clean)) bad.push('窓口の書き方が読めない（部屋名を付けること）');
  for (const v of views) {
    const name = v[1];
    const hasInline = /security_invoker\s*=\s*true/i.test(v[2]);
    const hasAlter = new RegExp('alter\\s+view\\s+' + name.replace('.', '\\.') + '\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*true', 'i').test(clean);
    if (!hasInline || !hasAlter) bad.push(`窓口 ${name} の security_invoker=true が足りない（with と alter の両方が要る）`);
  }

  /* ④ 関数の外の裸のDML（種の表への insert … on conflict だけ許す） */
  if (/\b(delete\s+from|update\s+[a-z_0-9.]+\s+set)\b/.test(flat)) bad.push('関数の外に データを書き換える1行がある（update / delete）');
  const stmts = flat.split(';');
  for (const st of stmts) {
    const ins = /\binsert\s+into\s+([a-z_0-9.]+)/.exec(st);
    if (!ins) continue;
    if (!SEED_TABLES.includes(ins[1])) bad.push(`関数の外に insert がある: ${ins[1]}`);
    else if (!/\bon\s+conflict\b/.test(st)) bad.push(`種の insert に on conflict が無い（2回当てると落ちる）: ${ins[1]}`);
  }

  /* ⑤ 部屋を anon・authenticated・public に開けない */
  for (const st of stmts) {
    if (!/^\s*grant\b/.test(st)) continue;
    const toOpen = /\bto\b[^;]*\b(anon|authenticated|public)\b/.test(st);
    if (toOpen && /\b(mahjong|mahjong_private)\b/.test(st)) bad.push(`部屋を客に開けている: ${st.trim().slice(0, 120)}`);
    if (toOpen && /\bon\s+(all\s+)?(tables|table|sequences)\b/.test(st)) bad.push(`表の権限を客に付けている: ${st.trim().slice(0, 120)}`);
    /* ★入口（関数）は authenticated だけ★（v18＝全員ログイン・anon と public には開けない） */
    const to = /\bto\s+([^;]*)$/.exec(st);
    if (/\bon\s+(all\s+)?functions?\b/.test(st) && to && /(^|[\s,])(anon|public)(?![.\w])/.test(to[1])) bad.push(`入口を anon／public に開けている: ${st.trim().slice(0, 120)}`);
  }

  /* 関数の中身は仕事なので通すが、他の部屋・消す系だけは同じ目で見る */
  for (const b of bodies) {
    for (const s of FOREIGN_SCHEMAS) {
      if (new RegExp('\\b' + s + '\\.', 'i').test(b)) bad.push(`関数の中で他の部屋を触っている: ${s}.`);
    }
    if (/\bdrop\s+(table|schema)\b|\btruncate\b/i.test(b)) bad.push('関数の中に 消す系がある');
  }
  return bad;
}

/* ── self-test：わざと危ない物を食わせて止まるか ───────────────────── */
if (DIRECT && process.argv.includes('--self-test')) {
  const OK = `create schema if not exists mahjong;
create schema if not exists mahjong_private;
revoke all on schema mahjong from public, anon, authenticated;
create table if not exists mahjong.rooms(id uuid primary key);
create unique index if not exists rooms_x on mahjong.rooms(id);
create table if not exists mahjong.mj_ops(name text primary key);
insert into mahjong.mj_ops(name) values ('a') on conflict (name) do update set name = excluded.name;
create or replace function public.mj_read(t text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin update mahjong.rooms set id = id; return null; end $$;
revoke all on function public.mj_read(text) from public, anon, authenticated;
grant execute on function public.mj_read(text) to authenticated;`;
  let p = 0, f = 0;
  const T = (n, fn) => { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  const must = (sql, why) => { const b = check(sql); if (!b.length) throw new Error('止まらなかった: ' + why); };
  const pass = (sql) => { const b = check(sql); if (b.length) throw new Error('誤検知: ' + b.join(' / ')); };

  console.log('\n[sql-guard --self-test] わざと危ない物を食わせて止まるか');
  T('★正しい設計図は通る（誤検知が出ない）', () => pass(OK));
  T('drop table を混ぜたら止まる', () => must(OK + '\ndrop table mahjong.rooms;', 'drop table'));
  T('drop schema を混ぜたら止まる', () => must(OK + '\ndrop schema mahjong cascade;', 'drop schema'));
  T('truncate を混ぜたら止まる', () => must(OK + '\ntruncate mahjong.rooms;', 'truncate'));
  T('alter table … drop column を混ぜたら止まる', () => must(OK + '\nalter table mahjong.rooms drop column id;', 'drop column'));
  T('★決まりの付け替え（drop constraint）は通る', () =>
    pass(OK + '\nalter table mahjong.rooms drop constraint if exists rooms_a_check;\nalter table mahjong.rooms add constraint rooms_a_check check (id is not null);'));
  T('★列を足すのは通る', () => pass(OK + '\nalter table mahjong.rooms add column if not exists b int not null default 1;'));
  T('★他のアプリの部屋に当てたら止まる', () => must(OK + '\nselect * from kyuyo.pay_employees;', '他の部屋'));
  T('★timeally の部屋に当てたら止まる', () => must(OK + '\nalter table timeally.tc_x add column z int;', 'timeally'));
  T('★public に mj_ でない関数を作ったら止まる', () =>
    must(OK + "\ncreate or replace function public.get_rooms() returns int language sql as $$ select 1 $$;", 'public の名'));
  T('★public に mj_ でない表を作ったら止まる', () => must(OK + '\ncreate table public.rooms(id int);', 'public の表'));
  T('★部屋名の無い create table は止まる（search_path 次第で public に落ちる）', () => must(OK + '\ncreate table rooms2(id int);', '部屋名なし'));
  T('★mahjong 以外の部屋を作ったら止まる', () => must(OK + '\ncreate schema if not exists mj_other;', '部屋'));
  T('★窓口の security_invoker が抜けたら止まる', () =>
    must(OK + '\ncreate or replace view public.mj_v as select * from mahjong.rooms;', 'with 抜け'));
  T('関数の外の update は止まる', () => must(OK + '\nupdate mahjong.rooms set id = null;', '裸のDML'));
  T('関数の外の delete は止まる', () => must(OK + '\ndelete from mahjong.rooms;', '裸のDML'));
  T('★種の表でない insert は止まる', () => must(OK + "\ninsert into mahjong.rooms(id) values (gen_random_uuid()) on conflict do nothing;", '種でない'));
  T('★種の insert に on conflict が無いと止まる', () => must(OK + "\ninsert into mahjong.mj_ops(name) values ('b');", 'on conflict'));
  T('関数の中の update は通る（仕事そのもの）', () => pass(OK));
  T('関数の中で他の部屋を触ったら止まる', () =>
    must(OK.replace('update mahjong.rooms set id = id;', 'update daikome.dk_companies set id=id;'), '関数の中の他部屋'));
  T('★部屋の USAGE を anon に付けたら止まる', () => must(OK + '\ngrant usage on schema mahjong to anon;', 'USAGE'));
  T('★部屋の表の権限を authenticated に付けたら止まる', () => must(OK + '\ngrant select on all tables in schema mahjong to authenticated;', '表の権限'));
  T('★補助の関数を anon に開けたら止まる', () =>
    must(OK + '\ngrant execute on function mahjong_private.mj_x() to anon;', '補助'));
  T('★列の drop not null／drop default は通る', () =>
    pass(OK + '\nalter table mahjong.rooms alter column id drop not null;\nalter table mahjong.rooms alter column id drop default;'));
  T('★drop not null と並べても drop table は止まる', () =>
    must(OK + '\nalter table mahjong.rooms alter column id drop not null;\ndrop table mahjong.rooms;', 'drop table を並べた'));
  T('★入口を anon に開けたら止まる', () =>
    must(OK + '\ngrant execute on function public.mj_read(text) to anon;', '入口を anon'));
  T('★入口を public に開けたら止まる', () =>
    must(OK + '\ngrant execute on function public.mj_read(text) to authenticated, public;', '入口を public'));
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}

/* ── 本体 ─────────────────────────────────────────────────────────── */
if (DIRECT && !process.argv.includes('--self-test')) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.log('使い方: node scripts/sql-guard.mjs supabase/schema.sql');
    process.exit(2);
  }
  let ng = 0;
  for (const f of files) {
    const bad = check(fs.readFileSync(f, 'utf8'));
    if (bad.length) { ng++; console.log('✗ ' + f); bad.forEach((b) => console.log('   - ' + b)); }
    else console.log('✓ ' + f);
  }
  console.log(ng ? `\n★中止★ ${ng}本が門番に落ちました（1文字も当てません）` : '\n門番: 全部 通りました');
  if (!ng) console.log('KEKKA ' + JSON.stringify({ passed: files.length, failed: 0, mimiso: 0 }));
  process.exit(ng ? 1 : 0);
}
