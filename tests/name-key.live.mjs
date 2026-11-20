/* name-key.live.mjs — ★倉庫の mj_name_key と lib/name-key.mjs が1字も違わないか★（設計図 v15.8 N1）
 * =============================================================================
 * 本物のテスト倉庫に当てる（鍵 ~/.supabase-token が要る＝CI では走らない・tests-no-ci.json）。読むだけ（行を作らない）。
 * 同じ字の表を両方に通して、答えが全部同じかを見る。表＝カタカナの区画 U+30A0〜30FF 全部・ひらがな・半角カナ U+FF61〜FF9F 全部・
 * A〜Z a〜z 全角英字・消す空白13字＋NFKC で空白になる字・名前らしい字の組。
 * 使い方: node tests/name-key.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { nameKey, SPACES } from '../lib/name-key.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
/* ★倉庫の門（設計 I-6）★ env の字だけでなく ref を直に見る（字は supa-config.js だけが持つ＝ここは sha256 の頭16字の指紋で照らす）＝khaw（全アプリ共有のテスト倉庫）でなければ1行も呼ばずに止める（本番 auth に試しのアカウントを作らない） */
if ((await import('node:crypto')).createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
if (!/env:\s*'test'/.test(src)) { console.log('★中止★ test の倉庫でない'); process.exit(1); }
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const T = [];
const range = (a, b) => { for (let c = a; c <= b; c++) T.push(String.fromCodePoint(c)); };
range(0x30a0, 0x30ff);           // カタカナの区画 全部（寄せる字も寄せない字も）
range(0x3041, 0x3096);           // ひらがな
range(0xff61, 0xff9f);           // 半角カナ 全部
range(0x41, 0x5a); range(0x61, 0x7a); range(0xff21, 0xff3a); range(0xff41, 0xff5a);
for (const c of SPACES) T.push('甲' + String.fromCodePoint(c) + '乙');
for (const c of [0x3000, 0xa0, 0x2002, 0x2003, 0x2009, 0x202f, 0x205f]) T.push('甲' + String.fromCodePoint(c) + '乙');
T.push('ｶﾞｷﾞｸﾞ', 'ﾊﾟﾋﾟ', 'ｳﾞ', 'コーヒー', 'ツー　Ａ', ' 甲 ', '甲①②', '㍻', 'ÄİZ', 'Straße', 'ﬁ', '髙橋', '𠮷野', 'つー(仮)', '');

/* 字の表は jsonb で1本に渡す（引用は使い捨ての札つきの $…$） */
const tag = 'mjnk' + Math.random().toString(36).slice(2, 8);
const quote = '$' + tag + '$';
const sql = 'select jsonb_agg(mahjong_private.mj_name_key(x) order by i) as k from jsonb_array_elements_text('
  + quote + JSON.stringify(T) + quote + '::jsonb) with ordinality t(x, i)';
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const body = await r.text();
/* ★process.exit は使わない★（fetch の後に呼ぶと Windows の node が UV_HANDLE_CLOSING で落ちて exit 127） */
const got = r.ok ? JSON.parse(body)[0].k : null;
if (!r.ok) console.log(`★失敗★ HTTP ${r.status}: ${body.slice(0, 300)}`);
else if (!Array.isArray(got) || got.length !== T.length) console.log(`★失敗★ 倉庫の答えが ${got?.length} 件（送った ${T.length} 件）`);
const whole = Array.isArray(got) && got.length === T.length;
let p = 0, f = 0;
if (whole) T.forEach((s, i) => {
  const js = nameKey(s);
  if (js === got[i]) p++;
  else { f++; console.log(`  ✗ ${JSON.stringify(s)}（U+${[...s].map((c) => c.codePointAt(0).toString(16)).join(' ')}）倉庫 ${JSON.stringify(got[i])}／lib ${JSON.stringify(js)}`); }
});
console.log(`  表 ${T.length} 件を倉庫と lib に通した`);
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f || !whole ? 1 : 0;
