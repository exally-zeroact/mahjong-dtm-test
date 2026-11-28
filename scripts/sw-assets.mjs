/* sw-assets.mjs — 件3 PWA の名簿（控えに入れる物）と版（VER）を機械で作る（設計 tataki/sw_sekkei_v1.md v3.3）
 * ============================================================================
 * 名簿＝根の *.html から src= / href= をたどり、js/mjs は静的 import / export from をたどり、manifest.json の icons を足した物。
 *   ★手で書かない★（足し忘れ・消し忘れが起きない）。/js/supa-config.js は入れない（本番だけ中身が違う＝NEVER_SHIP・sw はネットを先に見る）。
 * 版（VER）＝名簿の各ファイルの中身の sha256 を道の順に並べ、sw.js（VER の字と名簿の間を空にした物）も足した sha256 の先頭12字。
 *   字の物は CRLF→LF に直して数える（倉庫と配る中身は LF）。-text（png）はそのまま。字か -text かは `git ls-files --eol` の i/ で決める。
 * 使い方：
 *   node scripts/sw-assets.mjs --write   … sw.js の VER と名簿・version.json を書く（html・js・css を変えたら push の前に回す）
 *   node scripts/sw-assets.mjs           … 書かずに、今の sw.js と合うかだけ言う（合わなければ exit 1）
 * ★画面の席も、html・js・css・icons を変えたら --write を回してから押す（回し忘れは tests/sw.test.mjs が赤にする）★
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NOT_LISTED = new Set(['/js/supa-config.js', '/sw.js', '/version.json']);
const BEGIN = '/*ASSETS-BEGIN*/';
const END = '/*ASSETS-END*/';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** git が -text と見ている道（png 等）。未登録のファイルは字として扱う。 */
export function binarySet(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '--eol'], { cwd: root, encoding: 'utf8' });
  const s = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^i\/(\S+)\s+w\/\S+\s+attr\/\S*\s+(.+)$/);
    if (m && m[1] === '-text') s.add('/' + m[2].trim());
  }
  return s;
}

/** 配る中身（字は CRLF→LF） */
export function served(root, p, bin) {
  const buf = fs.readFileSync(path.join(root, p.slice(1)));
  if (bin.has(p)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

/** 参照の字を、読んでいるファイルを基準に道へ直す。外・# だけ・data: 等は null。 */
export function resolveRef(ref, fromPath) {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const u = new URL(ref, 'https://x' + fromPath);
  if (u.origin !== 'https://x') return null;
  return { path: decodeURIComponent(u.pathname), hasQuery: /[?#]/.test(ref) };
}

/** 名簿をたどる。返り＝{ list: 道の並び, problems: [言う事] } */
export function collect(root = ROOT) {
  const problems = [];
  const seen = new Set();
  const queue = [];
  const htmls = fs.readdirSync(root).filter((f) => f.endsWith('.html')).sort().map((f) => '/' + f);
  const add = (p, from) => {
    if (NOT_LISTED.has(p) || seen.has(p)) return;
    if (!fs.existsSync(path.join(root, p.slice(1)))) { problems.push(`在らない道 ${p}（${from} から）`); return; }
    seen.add(p); queue.push(p);
  };
  for (const h of htmls) add(h, '根');
  while (queue.length) {
    const p = queue.shift();
    const text = fs.readFileSync(path.join(root, p.slice(1)), 'utf8');
    if (p.endsWith('.html')) {
      for (const m of stripComments(text).matchAll(/\s(?:src|href)\s*=\s*"([^"]*)"/g)) {
        const r = resolveRef(m[1], p);
        if (!r) continue;
        if (r.hasQuery && !NOT_LISTED.has(r.path)) problems.push(`? か # の付いた参照 ${m[1]}（${p}）＝書き換えで素のまま取られる`);
        add(r.path, p);
      }
    } else if (/\.m?js$/.test(p)) {
      const code = stripJsComments(text);
      for (const m of code.matchAll(/(?:^|[;\s}])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|(?:^|[;\s}])import\s*['"]([^'"]+)['"]/g)) {
        const r = resolveRef(m[1] || m[2], p);
        if (r) add(r.path, p);
      }
    } else if (p === '/manifest.json') {
      for (const ic of JSON.parse(text).icons || []) { const r = resolveRef(ic.src, p); if (r) add(r.path, p); }
    }
  }
  return { list: [...seen].sort(), problems };
}

/* 他の origin の script を後から読んでよいファイルと、その URL（ここに足すのは1件ずつ・定めの節を書く） */
const CROSS_ORIGIN_SCRIPT = { '/js/gamen-human.mjs': 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' }; // P10 §4

/** 後から読む道（名簿に入らない取り）を探す。返り＝[言う事] */
export function lateLoads(root, list) {
  const bad = [];
  for (const p of list) {
    if (/\.m?js$/.test(p)) {
      const code = stripJsComments(fs.readFileSync(path.join(root, p.slice(1)), 'utf8'));
      if (/\bimport\s*\(/.test(code)) bad.push(`${p} に import(`);
      if (/\bimportScripts\s*\(/.test(code)) bad.push(`${p} に importScripts(`);
      // P10 §4：Turnstile の api.js は Cloudflare からしか読めない（名簿に入れられない他の origin・sw.js は他の origin を触らない）＝この1ファイルが、決めた1つの URL だけを読む時に限って通す
      const xo = CROSS_ORIGIN_SCRIPT[p];
      const xoOk = !!xo && code.includes("const API = '" + xo + "'") && /\.src = API;/.test(code) && (code.match(/\.src\s*=/g) || []).length === 1 && (code.match(/createElement\(\s*['"](?:script|link)['"]/g) || []).length === 1;
      if (/createElement\(\s*['"](?:script|link)['"]/.test(code) && !xoOk) bad.push(`${p} に createElement('script'|'link')`);
    } else if (p.endsWith('.css')) {
      const css = fs.readFileSync(path.join(root, p.slice(1)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/url\(\s*(?!['"]?data:)/.test(css)) bad.push(`${p} に url(`);
      if (/@import\b/.test(css)) bad.push(`${p} に @import`);
    }
  }
  return bad;
}

/** sw.js の VER の字と名簿の間を空にした中身（循環を切る） */
export function blankSw(swText) {
  const a = swText.indexOf(BEGIN), b = swText.indexOf(END);
  if (a < 0 || b < a) throw new Error('sw.js に ' + BEGIN + ' … ' + END + ' が無い');
  const t = swText.slice(0, a + BEGIN.length) + swText.slice(b);
  return t.replace(/\r\n/g, '\n').replace(/const VER = '[^']*';/, "const VER = '';");
}

export function computeAll(root = ROOT, swText = fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), bin = binarySet(root)) {
  const { list, problems } = collect(root);
  const assets = list.map((p) => [p, sha(served(root, p, bin))]);
  const h = crypto.createHash('sha256');
  for (const [p, s] of assets) h.update(p + '\n' + s + '\n');
  h.update('/sw.js\n' + sha(Buffer.from(blankSw(swText), 'utf8')) + '\n');
  return { ver: h.digest('hex').slice(0, 12), assets, problems };
}

export function renderAssets(assets) {
  return '[\n' + assets.map(([p, s]) => `  ['${p}', '${s}'],`).join('\n') + '\n]';
}

export function readSw(swText) {
  const ver = (swText.match(/const VER = '([^']*)';/) || [])[1];
  const a = swText.indexOf(BEGIN), b = swText.indexOf(END);
  const body = a >= 0 && b > a ? swText.slice(a + BEGIN.length, b) : '';
  const assets = [...body.matchAll(/\['([^']+)',\s*'([0-9a-f]{64})'\]/g)].map((m) => [m[1], m[2]]);
  return { ver, assets };
}

export function writeSw(swText, ver, assets) {
  const a = swText.indexOf(BEGIN), b = swText.indexOf(END);
  const out = swText.slice(0, a + BEGIN.length) + renderAssets(assets) + swText.slice(b);
  return out.replace(/const VER = '[^']*';/, `const VER = '${ver}';`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const swPath = path.join(ROOT, 'sw.js');
  const swText = fs.readFileSync(swPath, 'utf8').replace(/\r\n/g, '\n');
  const { ver, assets, problems } = computeAll(ROOT, swText);
  const late = lateLoads(ROOT, assets.map((a) => a[0]));
  for (const m of [...problems, ...late]) console.log('✗ ' + m);
  if (problems.length || late.length) { process.exitCode = 1; }
  else if (process.argv.includes('--write')) {
    fs.writeFileSync(swPath, writeSw(swText, ver, assets));
    fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ ver }) + '\n');
    console.log(`書いた：VER ${ver}・名簿 ${assets.length} 本`);
  } else {
    const cur = readSw(swText);
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).ver;
    const same = cur.ver === ver && vj === ver && JSON.stringify(cur.assets) === JSON.stringify(assets);
    console.log(same ? `合う：VER ${ver}・名簿 ${assets.length} 本` : `✗ 合わない（引き直し ${ver}・sw.js ${cur.ver}・version.json ${vj}）＝ node scripts/sw-assets.mjs --write`);
    if (!same) process.exitCode = 1;
  }
}
