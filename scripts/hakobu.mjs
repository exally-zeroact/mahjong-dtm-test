/* hakobu.mjs — テスト線の commit の中身を 本番の作業木へ 運ぶ（麻雀・件5-a・定め v5.1）
 * =============================================================================
 * ★なぜ★ 2026-09-12 rakually で git archive | tar で丸ごと運び、テスト線の js/supa-config.js が
 *   本番へ紛れ込んだ（客の画面に「テスト環境」の帯・客の書き込み先が試験の倉庫）。手で写さない・tar を使わない。
 * ★考え★ 網（fetch・gh）を呼ばない・運び元の作業木を読まない（sha の中身だけ）・
 *   運び先へは名札の判じが通るまで1字も書かない。判じは使い捨ての箱で tests/supa-config-matches-repo.test.mjs を
 *   子の node で走らせる（import しない・あの試験を1字も変えない・この道具は ref を1字も持たない）。
 *
 * 使い方: node scripts/hakobu.mjs --sha <40字> --to <本番の作業木> [--dry]
 *         node scripts/hakobu.mjs --self-test     （網を呼ばない・使い捨ての repo だけ）
 * 終わり値: 0＝運んだ（--dry は数えただけ）／1＝止めた・書いた後の判じが駄目／2＝使い方の誤り
 *
 * ★道具の外★ <sha> の CI・e2e・WebKit が緑かは kensan-kazu の1行（紙の通り・終わり値0だけ）で人が見る。
 *   本番で commit・push するのは本番前 taiketsu の後。件5-a' （麻雀の tools/ci-3tsu.mjs）が入るまでは
 *   kensan-kazu が必ず3＝運べる sha は無い。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ME = 'scripts/hakobu.mjs';
const NAFUDA = 'js/supa-config.js';
const NAFUDA_TEST = 'tests/supa-config-matches-repo.test.mjs';
/* ★本番だけの作り（NEVER_SHIP＝PROD_ONLY・1つの名札）★ 運ばない・消さない。増えたらここに足す */
export const PROD_ONLY = [NAFUDA];
const SRC_REPO = 'exally-zeroact/mahjong-dtm-test';
const DST_REPO = 'exally-zeroact/mahjong-dtm';
const SOTO = [
  '道具の外① <sha> の CI・e2e・WebKit は kensan-kazu の1行（紙 hakobu_sadame の「道具の外」の字の通り）の終わり値 0 だけで運ぶ（3・1 は運ばない）',
  '道具の外② 本番で commit・push するのは本番前 taiketsu（patch-id の比べ込み）の後',
  '道具の外③ 本番の CI が緑になるまで客に出ない事を Vercel の配信の向きで確かめる（件5-b）',
];

/* 子の git・node に渡さない env（親の GIT_* で別の repo を触らない・先読みを持ち込まない） */
export function cleanEnv(env = process.env) {
  const o = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_CEILING_DIRECTORIES|NODE_OPTIONS)$/i.test(k)) continue;
    if (/^GIT_CONFIG/i.test(k)) continue;
    o[k] = v;
  }
  return o;
}
const ENV = cleanEnv();

function git(cwd, args, opt = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], {
    env: ENV, maxBuffer: 512 * 1024 * 1024, input: opt.input,
    encoding: opt.buf ? undefined : 'utf8',
  });
  if (r.status !== 0 && !opt.ok) {
    const e = new Error('git ' + args.join(' ') + ' が失敗: ' + String(r.stderr || '').trim());
    e.code = opt.code || 'git';
    throw e;
  }
  return opt.buf ? r.stdout : (opt.ok ? { status: r.status, out: String(r.stdout || '').trim() } : String(r.stdout || '').trim());
}

class Tomari extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const stop = (code, msg) => { throw new Tomari(code, msg); };

/* origin の url → 「持ち主/名前」（https・git@・末尾 .git の有無）。読めなければ '' */
export function repoOf(url) {
  const u = String(url || '').trim();
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(u);
  return m ? m[1] + '/' + m[2] : '';
}

/* ls-tree -r -z → [{mode,type,oid,p}] */
function lsTree(cwd, rev) {
  const out = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', rev], { buf: true });
  const rows = [];
  for (const rec of out.toString('utf8').split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, type, oid] = rec.slice(0, tab).split(' ');
    rows.push({ mode, type, oid, p: rec.slice(tab + 1) });
  }
  return rows;
}

/* cat-file --batch で blob を全部読む（LF のまま・作業木は見ない） */
function readBlobs(cwd, oids) {
  const uniq = [...new Set(oids)];
  if (!uniq.length) return new Map();
  const out = git(cwd, ['cat-file', '--batch'], { buf: true, input: uniq.join('\n') + '\n' });
  const m = new Map();
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(10, i);
    const head = out.slice(i, nl).toString('utf8').split(' ');
    if (head[1] !== 'blob') throw new Tomari('blob', '中身が読めない: ' + head.join(' '));
    const size = Number(head[2]);
    m.set(head[0], out.slice(nl + 1, nl + 1 + size));
    i = nl + 1 + size + 1;
  }
  if (m.size !== uniq.length) throw new Tomari('blob', `中身を読み切れない（${m.size}/${uniq.length}）`);
  return m;
}

/* ★大小を畳んで比べる★ 大小だけ違う組・ファイルとディレクトリの入れ替え（a と a/b） */
export function oomojiKumi(paths, waza) {
  const bad = [];
  const fold = (s) => (waza === 'oomoji' ? s : s.toLowerCase());
  const byFold = new Map();
  for (const p of new Set(paths)) {
    const k = fold(p);
    if (!byFold.has(k)) byFold.set(k, new Set());
    byFold.get(k).add(p);
  }
  for (const s of byFold.values()) if (s.size > 1) bad.push('大小だけ違う: ' + [...s].join(' と '));
  const files = new Set(byFold.keys());
  for (const k of files) {
    const seg = k.split('/');
    for (let j = 1; j < seg.length; j++) {
      const d = seg.slice(0, j).join('/');
      if (files.has(d)) bad.push('ファイルとディレクトリの入れ替え: ' + d + ' と ' + k);
    }
  }
  return bad;
}

/* 子の node の結果の判じ：exit 0 かつ「✓ 合っている」の行 */
export function hanji(r, waza) {
  const out = String(r.stdout || '');
  const okExit = waza === 'exit' ? true : r.status === 0;
  const okLine = waza === 'gyou' ? true : /^\s*✓ 合っている\s*$/m.test(out);
  return okExit && okLine;
}

function runNafuda(cwd) {
  const r = spawnSync(process.execPath, [path.join(cwd, NAFUDA_TEST)], { cwd, env: ENV, encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '') + (r.stderr || '') };
}

/* ══════════ 本体（self-test から from・waza を渡せる） ══════════ */
export function hakobu({ from = ROOT, sha, to, dry = false, waza = '', log = console.log } = {}) {
  const ops = [];
  /* 1. 引数 */
  if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) stop('sha', '--sha は 40字の16進（短い sha・枝名・HEAD は止め）: ' + sha);
  if (!to || !fs.existsSync(to)) stop('to', '--to が無い: ' + to);
  const toTop = git(to, ['rev-parse', '--show-toplevel'], { ok: true });
  if (toTop.status !== 0 || path.resolve(toTop.out) !== path.resolve(to)) stop('to', '--to が作業木の根でない: ' + to);
  const fromTop = path.resolve(git(from, ['rev-parse', '--show-toplevel']));
  if (fromTop === path.resolve(to)) stop('to', '運び元と運び先が同じ所');

  /* 2. 運び元 */
  const fromOrigin = git(from, ['remote', 'get-url', 'origin'], { ok: true });
  if (repoOf(fromOrigin.out) !== SRC_REPO) stop('from-origin', '運び元の origin が ' + SRC_REPO + ' でない: ' + (fromOrigin.out || '無し'));
  const has = git(from, ['cat-file', '-e', sha + '^{commit}'], { ok: true });
  if (has.status !== 0) stop('sha', '運び元に無い commit: ' + sha);
  const atama = git(from, ['rev-parse', '-q', '--verify', 'refs/remotes/origin/main'], { ok: true }).out;
  const headOk = waza === 'atama'
    ? git(from, ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main'], { ok: true }).status === 0
    : atama === sha;
  if (!headOk) stop('atama', `手元の refs/remotes/origin/main（${atama.slice(0, 9) || '無し'}）と同じ sha でない（祖先も運ばない）`);

  /* 3. 運び先 */
  const toOrigin = git(to, ['remote', 'get-url', 'origin'], { ok: true });
  const toRepo = repoOf(toOrigin.out);
  if (waza !== 'origin' && toRepo !== DST_REPO) stop('to-origin', '運び先の origin が ' + DST_REPO + ' でない: ' + (toOrigin.out || '無し'));
  const eda = git(to, ['symbolic-ref', '-q', '--short', 'HEAD'], { ok: true }).out;
  if (eda !== 'main') stop('eda', '運び先の枝が main でない: ' + (eda || '外れた HEAD'));
  const st = git(to, ['status', '--porcelain', '-uall']);
  if (st) stop('mi-commit', '運び先に未commit（?? も）が在る:\n' + st.split('\n').slice(0, 10).join('\n'));

  /* 4. 中身を全部読む（sha の中身だけ） */
  const never = waza === 'never' ? [] : PROD_ONLY;
  const all = lsTree(from, sha);
  for (const e of all) {
    if (e.mode === '120000') stop('symlink', 'symlink が在る: ' + e.p);
    if (e.mode === '160000' || e.type === 'commit') stop('submodule', 'submodule が在る: ' + e.p);
    if (e.type !== 'blob') stop('blob', 'blob でない物: ' + e.p);
  }
  if (!all.some((e) => e.p === NAFUDA_TEST)) stop('nafuda-test', '<sha> に ' + NAFUDA_TEST + ' が無い');
  const ship = all.filter((e) => !never.includes(e.p));
  const bytes = readBlobs(from, ship.map((e) => e.oid));
  const nafudaTestBytes = readBlobs(from, [all.find((e) => e.p === NAFUDA_TEST).oid]).values().next().value;
  if (waza === 'sagyougi') {
    /* 壊し：作業木から読む */
    for (const e of ship) { const f = path.join(from, e.p); if (fs.existsSync(f)) bytes.set(e.oid + ':' + e.p, fs.readFileSync(f)); }
  }
  const body = (e) => (waza === 'sagyougi' && bytes.has(e.oid + ':' + e.p) ? bytes.get(e.oid + ':' + e.p) : bytes.get(e.oid));

  /* 走っている自分が sha の自分と違えば声 */
  const meInSha = all.find((e) => e.p === ME);
  try {
    const mine = fs.readFileSync(fileURLToPath(import.meta.url));
    const theirs = meInSha ? readBlobs(from, [meInSha.oid]).get(meInSha.oid) : null;
    if (from === ROOT && (!theirs || !theirs.equals(mine))) log('★声★ 走っている ' + ME + ' が <sha> の物と違う（' + (theirs ? '中身が違う' : '<sha> に無い') + '）');
  } catch { /* 読めない時は声だけの所なので止めない */ }

  /* 運び先の HEAD・大小を畳んだ判じ（--dry でも） */
  const head = new Map(lsTree(to, 'HEAD').map((e) => [e.p, e]));
  const kumi = oomojiKumi([...ship.map((e) => e.p), ...head.keys()], waza);
  if (kumi.length) stop('oomoji', kumi.slice(0, 10).join('\n'));

  /* 5. 名札の判じ（使い捨ての箱・運び先に書かない） */
  const nafudaDst = path.join(to, NAFUDA);
  if (!fs.existsSync(nafudaDst)) stop('nafuda', '運び先に ' + NAFUDA + ' が無い');
  const nafudaMae = fs.readFileSync(nafudaDst);
  const hako = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobu-hako-'));
  try {
    git(hako, ['init', '-q', '-b', 'main']);
    git(hako, ['remote', 'add', 'origin', toOrigin.out || '']);
    fs.mkdirSync(path.join(hako, 'js'), { recursive: true });
    fs.mkdirSync(path.join(hako, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(hako, NAFUDA), nafudaMae);
    fs.writeFileSync(path.join(hako, NAFUDA_TEST), nafudaTestBytes);
    const r = runNafuda(hako);
    if (!hanji(r, waza)) stop('nafuda', '名札の判じが駄目（運び先の ' + NAFUDA + ' が本番の名札でない）:\n' + r.stdout.trim().split('\n').slice(-6).join('\n'));
  } finally {
    fs.rmSync(hako, { recursive: true, force: true });
  }

  /* 数え */
  const shipSet = new Set(ship.map((e) => e.p));
  const keshi = [...head.keys()].filter((p) => !shipSet.has(p) && (waza === 'nokosu-1' || !PROD_ONLY.includes(p)));
  const nokoshi = [...head.keys()].filter((p) => !shipSet.has(p) && PROD_ONLY.includes(p) && waza !== 'nokosu-1');
  let atarashii = 0, kawaru = 0, onaji = 0;
  for (const e of ship) { const h = head.get(e.p); if (!h) atarashii++; else if (h.oid === e.oid) onaji++; else kawaru++; }
  const jikkou = ship.filter((e) => e.mode === '100755').map((e) => e.p);
  const kazoe = () => {
    log(`運ぶ sha ${sha.slice(0, 9)}：全部 ${ship.length}（新しく入る ${atarashii}・変わる ${kawaru}・同じ ${onaji}）／消す ${keshi.length}${keshi.length ? '（' + keshi.join('・') + '）' : ''}`);
    log(`本番だけの作りで残す ${nokoshi.length}${nokoshi.length ? '（' + nokoshi.join('・') + '）' : ''}／運ばない名札 ${PROD_ONLY.join('・')}`);
    log(`100755 の物 ${jikkou.length}${jikkou.length ? '（' + jikkou.join('・') + '＝commit の時に席が印を付ける）' : ''}`);
  };

  /* 6. --dry */
  if (dry && waza !== 'dry') {
    kazoe();
    log('--dry＝運び先は1字も変わっていない');
    for (const s of SOTO) log(s);
    return { ok: true, dry: true, ops, keshi, atarashii, kawaru, onaji };
  }

  /* 7. 書く（②を先に消してから書く） */
  const kesu = () => {
    if (waza === 'nokosu-2') return;
    for (const p of keshi) { fs.rmSync(path.join(to, p), { force: true }); ops.push('消す ' + p); }
  };
  if (waza !== 'jun') kesu();
  let kaketa = 0;
  for (const e of ship) {
    const f = path.join(to, e.p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body(e));
    ops.push('書く ' + e.p);
    kaketa++;
  }
  if (waza === 'jun') kesu();
  log(`書けた ${kaketa}／${ship.length}`);

  /* 8. 書いた後：運び先そのもので名札の判じ・名札が1字も変わっていない */
  const r2 = runNafuda(to);
  const nafudaAto = fs.existsSync(nafudaDst) ? fs.readFileSync(nafudaDst) : null;
  const okAto = hanji(r2, waza) && nafudaAto && nafudaAto.equals(nafudaMae);
  kazoe();
  for (const s of SOTO) log(s);
  if (!okAto) {
    log('★書いた後の判じが駄目★（書いた物は戻さない＝本番の作業木で commit しなければ外へは出ない）');
    return { ok: false, code: 'ato', ops, keshi };
  }
  return { ok: true, ops, keshi, atarashii, kawaru, onaji };
}

/* ══════════ 自己確認 ══════════ */
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobu-self-'));
  const hooks = path.join(tmp, 'no-hooks');
  fs.mkdirSync(hooks);
  const G = (cwd, args, opt) => git(cwd, ['-c', 'user.name=hakobu-self', '-c', 'user.email=hakobu-self@invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + hooks, '-c', 'core.autocrlf=false', ...args], opt);

  /* 偽の名札の ref の字は 運び元の試験の REFS の1行を字で読んで取る（取れない＝赤） */
  const testSrc = fs.readFileSync(path.join(ROOT, NAFUDA_TEST));
  const m = /export const REFS = \{\s*prod:\s*'([a-z0-9]+)',\s*test:\s*'([a-z0-9]+)'\s*\}/.exec(testSrc.toString('utf8'));
  if (!m) { console.log('✗ REFS の1行が読めない'); console.log('自己確認: 0/1'); process.exit(1); }
  const REF = { prod: m[1], test: m[2] };
  const url = (r) => 'https://' + r + '.supabase' + '.co';
  const cfg = (env, r) => `window.SUPA = {\n  url: '${url(r)}',\n  key: 'sb_publishable_XXXX',\n  env: '${env}'\n};\n`;

  let n = 0;
  const mk = () => path.join(tmp, 'r' + (++n));
  const put = (dir, p, s) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

  /* 偽の運び元 */
  function moto({ origin = 'https://github.com/' + SRC_REPO + '.git', extra = {}, nafudaTest = true, symlink = false } = {}) {
    const d = mk(); fs.mkdirSync(d);
    G(d, ['init', '-q', '-b', 'main']);
    G(d, ['remote', 'add', 'origin', origin]);
    put(d, NAFUDA, cfg('test', REF.test));
    if (nafudaTest) put(d, NAFUDA_TEST, testSrc);
    put(d, 'index.html', '<p>a</p>\n<p>b</p>\n');
    put(d, 'lib/x.mjs', 'export const x = 1;\nexport const y = 2;\n');
    for (const [p, s] of Object.entries(extra)) put(d, p, s);
    G(d, ['add', '-A']);
    if (symlink) {
      const oid = G(d, ['hash-object', '-w', '--stdin'], { input: 'index.html' });
      G(d, ['update-index', '--add', '--cacheinfo', '120000,' + oid + ',link.html']);
    }
    G(d, ['commit', '-q', '-m', 'm1']);
    const s1 = G(d, ['rev-parse', 'HEAD']);
    put(d, 'lib/x.mjs', 'export const x = 1;\nexport const y = 3;\n');
    G(d, ['add', 'lib/x.mjs']);
    G(d, ['commit', '-q', '-m', 'm2']);
    const s2 = G(d, ['rev-parse', 'HEAD']);
    G(d, ['update-ref', 'refs/remotes/origin/main', s2]);
    return { d, s1, s2 };
  }
  /* 偽の運び先 */
  function saki({ origin = 'https://github.com/' + DST_REPO + '.git', nafuda = cfg('prod', REF.prod), eda = 'main', extra = {}, dirty = false } = {}) {
    const d = mk(); fs.mkdirSync(d);
    G(d, ['init', '-q', '-b', eda]);
    if (origin) G(d, ['remote', 'add', 'origin', origin]);
    if (nafuda !== null) put(d, NAFUDA, nafuda);
    put(d, 'README.md', 'x\n');
    for (const [p, s] of Object.entries(extra)) put(d, p, s);
    G(d, ['add', '-A']);
    G(d, ['commit', '-q', '-m', 'p0']);
    if (dirty) put(d, 'yogore.txt', 'x\n');
    return d;
  }
  const status = (d) => G(d, ['status', '--porcelain', '-uall']);
  const shas = (d) => G(d, ['rev-parse', 'HEAD']) + '|' + (fs.existsSync(path.join(d, NAFUDA)) ? fs.readFileSync(path.join(d, NAFUDA)).toString('base64') : '-');
  const quiet = () => {};
  const tryRun = (o) => { try { return hakobu({ log: quiet, ...o }); } catch (e) { if (process.env.HAKOBU_DBG) console.log('[dbg]', e.code, e.message); return { ok: false, code: e.code || 'nage', msg: e.message }; } };

  /* 試しの組（各々 true＝思った通り） */
  const KUMI = [];
  const K = (name, fn) => KUMI.push({ name, fn });

  K('通る：prod＋本番 ref の名札 → 運ばれる・名札 不変・運んだ bytes に \\r 0・README（本番の HEAD だけ）は②で消える', (w) => {
    const a = moto(); const b = saki();
    const mae = fs.readFileSync(path.join(b, NAFUDA));
    const r = tryRun({ from: a.d, sha: a.s2, to: b, waza: w });
    if (!r.ok) return false;
    const ato = fs.readFileSync(path.join(b, NAFUDA));
    const x = fs.readFileSync(path.join(b, 'lib/x.mjs'), 'utf8');
    const cr = ['index.html', 'lib/x.mjs'].reduce((s, p) => s + (fs.readFileSync(path.join(b, p), 'utf8').match(/\r/g) || []).length, 0);
    return mae.equals(ato) && x.includes('y = 3') && cr === 0 && !fs.existsSync(path.join(b, 'README.md'))
      && fs.readFileSync(path.join(b, NAFUDA_TEST)).equals(testSrc);
  });
  K('消す：sha に無い old.html・tests/old.test.mjs は消え、supa-config（本番だけの作り）は残る', (w) => {
    const a = moto(); const b = saki({ extra: { 'old.html': 'o\n', 'tests/old.test.mjs': 'o\n' } });
    const mae = fs.readFileSync(path.join(b, NAFUDA));
    const r = tryRun({ from: a.d, sha: a.s2, to: b, waza: w });
    return r.ok && !fs.existsSync(path.join(b, 'old.html')) && !fs.existsSync(path.join(b, 'tests/old.test.mjs'))
      && fs.existsSync(path.join(b, NAFUDA)) && fs.readFileSync(path.join(b, NAFUDA)).equals(mae);
  });
  K('順：②を先に消してから書く（ops の消すが全部 書くより前）', (w) => {
    const a = moto(); const b = saki({ extra: { 'old.html': 'o\n' } });
    const r = tryRun({ from: a.d, sha: a.s2, to: b, waza: w });
    if (!r.ok) return false;
    const lastKesu = r.ops.map((o) => o.startsWith('消す')).lastIndexOf(true);
    const firstKaku = r.ops.findIndex((o) => o.startsWith('書く'));
    return lastKesu >= 0 && firstKaku > lastKesu;
  });
  K('--dry（通る時）：運び先の status 空・HEAD と名札が前と同じ・old の2本は「消す」に並ぶが消えない', (w) => {
    const a = moto(); const b = saki({ extra: { 'old.html': 'o\n', 'tests/old.test.mjs': 'o\n' } });
    const mae = shas(b);
    const r = tryRun({ from: a.d, sha: a.s2, to: b, dry: true, waza: w });
    return r.ok && r.dry === true && status(b) === '' && shas(b) === mae && r.keshi.includes('old.html') && r.keshi.includes('tests/old.test.mjs');
  });
  K('CRLF：運び元の作業木を eol=crlf で取り直すと \\r が在る（0 なら赤）・それでも運んだ bytes に \\r 0', (w) => {
    const a = moto(); const b = saki();
    fs.writeFileSync(path.join(a.d, '.git/info/attributes'), '* text eol=crlf\n');
    G(a.d, ['-c', 'core.autocrlf=true', 'rm', '-q', '--cached', '-r', '.']);
    G(a.d, ['-c', 'core.autocrlf=true', 'reset', '-q', '--hard']);
    const crMoto = (fs.readFileSync(path.join(a.d, 'lib/x.mjs'), 'utf8').match(/\r/g) || []).length;
    if (crMoto === 0) return false;
    const r = tryRun({ from: a.d, sha: a.s2, to: b, waza: w });
    const cr = (fs.readFileSync(path.join(b, 'lib/x.mjs'), 'utf8').match(/\r/g) || []).length;
    return r.ok && cr === 0;
  });
  const tomaru = (name, code, mkA, mkB, shaOf, extra = {}) => {
    for (const dry of [false, true]) {
      K(`止まる${dry ? '（--dry）' : ''}：${name}（${code}）・運び先の status 空・HEAD と名札 不変`, (w) => {
        const a = mkA(); const b = mkB();
        const mae = b && fs.existsSync(b) ? shas(b) : '';
        const st0 = b && fs.existsSync(b) ? status(b) : '';
        const r = tryRun({ from: a.d, sha: shaOf(a), to: b, dry, waza: w, ...extra });
        return !r.ok && r.code === code && status(b) === st0 && shas(b) === mae;
      });
    }
  };
  tomaru('sha が短い', 'sha', () => moto(), () => saki(), (a) => a.s2.slice(0, 12));
  tomaru('祖先の sha（origin/main と同じでない）', 'atama', () => moto(), () => saki(), (a) => a.s1);
  tomaru('運び元 origin が mahjong-dtm-test でない', 'from-origin', () => moto({ origin: 'https://github.com/' + DST_REPO + '.git' }), () => saki(), (a) => a.s2);
  tomaru('sha に名札の試験が無い', 'nafuda-test', () => moto({ nafudaTest: false }), () => saki(), (a) => a.s2);
  tomaru('運び先 origin が mahjong-dtm-test', 'to-origin', () => moto(), () => saki({ origin: 'git@github.com:' + SRC_REPO + '.git' }), (a) => a.s2);
  tomaru('運び先 origin が他', 'to-origin', () => moto(), () => saki({ origin: 'https://github.com/exally-zeroact/hoka' }), (a) => a.s2);
  tomaru('運び先 origin が無い', 'to-origin', () => moto(), () => saki({ origin: '' }), (a) => a.s2);
  tomaru('運び先の枝が main 以外', 'eda', () => moto(), () => saki({ eda: 'dev' }), (a) => a.s2);
  tomaru('運び先に未commit（??）', 'mi-commit', () => moto(), () => saki({ dirty: true }), (a) => a.s2);
  tomaru('名札 env test', 'nafuda', () => moto(), () => saki({ nafuda: cfg('test', REF.test) }), (a) => a.s2);
  tomaru('名札 prod なのに url が試験の ref', 'nafuda', () => moto(), () => saki({ nafuda: cfg('prod', REF.test) }), (a) => a.s2);
  tomaru('名札が無い', 'nafuda', () => moto(), () => saki({ nafuda: null }), (a) => a.s2);
  tomaru('symlink', 'symlink', () => moto({ symlink: true }), () => saki(), (a) => a.s2);
  tomaru('大小だけ違う（本番 lib/X.mjs・sha lib/x.mjs）', 'oomoji', () => moto(), () => saki({ extra: { 'lib/X.mjs': 'o\n' } }), (a) => a.s2);
  tomaru('ファイルとディレクトリの入れ替え（本番 lib ファイル・sha lib/x.mjs）', 'oomoji', () => moto(), () => saki({ extra: { 'lib': 'o\n' } }), (a) => a.s2);

  /* 判じ・大小の部品（壊しの exit・行を見分ける） */
  K('判じ：exit 1 で「✓ 合っている」が在っても駄目', (w) => hanji({ status: 1, stdout: '  ✓ 合っている\n' }, w) === false);
  K('判じ：exit 0 で「✓ 合っている」が無ければ駄目', (w) => hanji({ status: 0, stdout: '  ✗ 違う\n' }, w) === false);
  K('判じ：exit 0 と「✓ 合っている」で良し', (w) => hanji({ status: 0, stdout: '\n[x]\n  ✓ 合っている\n' }, w) === true);
  K('大小：Foo.html と foo.html を組で返す', (w) => oomojiKumi(['Foo.html', 'foo.html'], w).length === 1);
  K('url の読み：https・git@・.git の有無', () => repoOf('https://github.com/' + DST_REPO) === DST_REPO && repoOf('git@github.com:' + DST_REPO + '.git') === DST_REPO
    && repoOf('https://github.com/' + SRC_REPO + '.git') === SRC_REPO && repoOf('') === '');
  K('env：GIT_DIR・GIT_CONFIG_*・GIT_CEILING_DIRECTORIES・NODE_OPTIONS を外す', () => {
    const e = cleanEnv({ GIT_DIR: 'x', GIT_CONFIG_COUNT: '1', GIT_CEILING_DIRECTORIES: 'x', NODE_OPTIONS: 'x', GIT_WORK_TREE: 'x', GIT_INDEX_FILE: 'x', PATH: 'p' });
    return Object.keys(e).join() === 'PATH';
  });

  const WAZA = process.env.HAKOBU_DBG ? [] : [
    ['never', 'NEVER_SHIP を空'], ['origin', 'origin の判じを常に真'], ['exit', '子の exit を見ない'], ['gyou', '「✓ 合っている」を見ない'],
    ['sagyougi', '作業木から読む'], ['dry', '--dry で書く'], ['atama', '頭と同じかを見ない（祖先を通す）'], ['nokosu-2', '②を消さない'],
    ['nokosu-1', '①を消す'], ['oomoji', '大小を畳まない'], ['jun', '書いてから消す'],
  ];
  let midori = 0, zenbu = 0;
  console.log('\n[hakobu --self-test] 網を呼ばない・使い捨ての repo だけ');
  const only = process.env.HAKOBU_DBG ? KUMI.filter((k) => k.name.includes(process.env.HAKOBU_DBG)) : KUMI;
  const kekka = (w) => only.map((k) => { let ok; try { ok = k.fn(w) === true; } catch (e) { ok = false; if (process.env.HAKOBU_DBG) console.log('[dbg throw]', e.message); } return { k, ok }; });
  const midoriKumi = [];
  for (const { k, ok } of kekka('')) {
    zenbu++; if (ok) { midori++; midoriKumi.push(k); }
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + k.name);
  }
  {
    for (const [w, nm] of WAZA) {
      /* 壊しは最初の赤で打ち切る（全部回すと5分を越える） */
      const aka = [];
      /* 壊さなければ緑の組だけで数える（元から赤の組で赤を数えない） */
      for (const k of midoriKumi) { let ok; try { ok = k.fn(w) === true; } catch { ok = false; } if (!ok) { aka.push(k.name); break; } }
      zenbu++; if (aka.length) midori++;
      console.log('  ' + (aka.length ? '✓' : '✗') + ' 壊し「' + nm + '」→ 赤' + (aka.length ? '（' + aka[0].slice(0, 40) + '…）' : '  ★赤にならない★'));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`自己確認: ${midori}/${zenbu}`);
  process.exit(midori === zenbu ? 0 : 1);
}

/* ══════════ 入口 ══════════ */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) selfTest();
  else {
    const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
    const sha = val('--sha'), to = val('--to');
    if (!sha || !to) { console.log('使い方: node scripts/hakobu.mjs --sha <40字> --to <本番の作業木> [--dry] ／ --self-test'); process.exit(2); }
    try {
      const r = hakobu({ sha, to: path.resolve(to), dry: a.includes('--dry') });
      process.exit(r.ok ? 0 : 1);
    } catch (e) {
      console.log('★止めた★（' + (e.code || '?') + '）' + e.message);
      console.log('運び先は1字も変わっていない（書く前に止めた）');
      for (const s of SOTO) console.log(s);
      process.exit(1);
    }
  }
}
