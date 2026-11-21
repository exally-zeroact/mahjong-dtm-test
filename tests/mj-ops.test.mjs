/* mj-ops.test.mjs — ★操作の表 mahjong.mj_ops の値そのものの誤りを捕まえる★（案 v18_login_sekkei.md K-1・I-5）
 * =============================================================================
 * 試験は表から引く（名前を字で並べない）が、★表そのものが間違っていたら表から引く試験は全部緑★。
 * だから ★K-1 の全34行×全列★（2c-3c で足した yakitori_set は 2c-3c' で外した＝やきとりは extras の種 yaki・write6_yaki_sadame.md） をここに字で固定する（K-1 の表から起こした字・schema.sql からは写さない）
 * ＝表を変えた日に ★この試験が赤になる★。読むのは supabase/schema.sql の insert into mahjong.mj_ops（倉庫に当てる物と同じ字）。
 * 字の読み替え（K-1 → 表）：
 *   who_plain：本人=self／入=nyu／本人か管=self_or_kan／管=kan／持ち主=owner／持ち主か管=owner_or_kan／K-2 の決まり=revert_rule／—=none
 *   who_league：＝=same／L=L／入=nyu／持ち主か唯一の L=owner_or_sole_L／K-2=revert_rule／持ち主=owner
 *   re：×=no／○=yes／持ち主の時=owner／付ける時=grant
 *
 * 使い方: node tests/mj-ops.test.mjs  /  node tests/mj-ops.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 列の並び＝[who_plain, who_league, on_deleted, writes_history, revert, versioned, re] */
export const COLS = ['who_plain', 'who_league', 'on_deleted', 'writes_history', 'revert', 'versioned', 're'];
const o = true, x = false;
export const FIXED = {
  count: 34,
  /* 種に書いてはいけない v15 の列（倉庫では空だけ＝mj_ops_old_empty） */
  oldEmpty: ['kan', 'nyu', 'needs_secret'],
  rows: {
    room_leave:       ['self',         'same',            o, o, 'none',          x, 'owner'],
    member_add:       ['nyu',          'same',            x, o, 'inactive',      x, 'no'],
    member_rename:    ['nyu',          'owner_or_sole_L', x, o, 'prev',          x, 'no'],
    member_active:    ['nyu',          'owner_or_sole_L', x, o, 'prev',          x, 'no'],
    member_link:      ['self',         'same',            x, o, 'prev',          x, 'no'],
    member_unlink:    ['self_or_kan',  'same',            x, o, 'prev',          x, 'no'],
    member_relink:    ['kan',          'same',            x, o, 'prev',          x, 'no'],
    session_add:      ['nyu',          'L',               x, o, 'void',          x, 'no'],
    session_edit:     ['nyu',          'L',               x, o, 'prev',          x, 'no'],
    table_add:        ['nyu',          'L',               x, o, 'void',          x, 'no'],
    table_edit:       ['nyu',          'L',               x, o, 'prev',          x, 'no'],
    hanchan_start:    ['nyu',          'nyu',             x, o, 'void',          x, 'no'],
    hanchan_seats:    ['nyu',          'L',               x, o, 'prev',          x, 'no'],
    hanchan_void:     ['nyu',          'nyu',             x, o, 'unvoid',        x, 'no'],
    hanchan_unvoid:   ['nyu',          'nyu',             x, o, 'void',          x, 'no'],
    cell_set:         ['nyu',          'nyu',             x, o, 'prev',          o, 'no'],
    tobi_set:         ['nyu',          'nyu',             x, o, 'prev',          o, 'no'],
    kyotaku_set:      ['nyu',          'nyu',             x, o, 'prev',          o, 'no'],
    hanchan_order:    ['nyu',          'nyu',             x, o, 'prev',          o, 'no'],
    extra_set:        ['nyu',          'nyu',             x, o, 'prev',          o, 'no'],
    extra_add:        ['nyu',          'nyu',             x, o, 'neg',           x, 'no'],
    history_revert:   ['revert_rule',  'revert_rule',     x, o, 'prev',          x, 'no'],
    settle_snap:      ['nyu',          'nyu',             x, o, 'none',          x, 'no'],
    league_create:    ['kan',          'same',            x, o, 'void',          x, 'no'],
    league_save:      ['none',         'L',               x, o, 'rules_version', x, 'no'],
    room_export:      ['nyu',          'same',            o, x, 'none',          x, 'no'],
    rules_save:       ['kan',          'same',            x, o, 'rules_version', x, 'no'],
    rerev_ok:         ['kan',          'L',               x, o, 'none',          x, 'no'],
    room_secret:      ['kan',          'same',            x, o, 'none',          x, 'yes'],
    room_delete:      ['owner',        'same',            x, o, 'none',          x, 'yes'],
    room_undelete:    ['owner_or_kan', 'same',            o, o, 'none',          x, 'no'],
    role_set:         ['owner',        'same',            x, o, 'prev',          x, 'grant'],
    account_remove:   ['kan',          'same',            x, o, 'none',          x, 'no'],
    league_owner_set: ['owner',        'owner',           x, o, 'prev',          x, 'yes'],
  },
};

/** schema.sql の mj_ops の種を読む → [{name, …列}] */
export function readOps(sql) {
  const m = /insert\s+into\s+mahjong\.mj_ops\s*\(([^)]*)\)\s*values([\s\S]*?)on\s+conflict/i.exec(sql);
  if (!m) throw new Error('schema.sql に insert into mahjong.mj_ops が無い');
  const cols = m[1].split(',').map((s) => s.trim());
  const rows = [...m[2].matchAll(/\(([^()]*)\)/g)].map((r) => r[1].split(',').map((v) => v.trim()));
  return rows.map((vals) => {
    if (vals.length !== cols.length) throw new Error('列の数が合わない行: ' + vals.join(','));
    const r = {};
    cols.forEach((c, i) => {
      const v = vals[i];
      r[c] = v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v.replace(/^'|'$/g, '');
    });
    return r;
  });
}

/** 違反の一覧を返す（純関数） */
export function judge(ops, F = FIXED) {
  const bad = [];
  if (ops.length !== F.count) bad.push(`行の数 ${ops.length}（K-1 は ${F.count}）`);
  if (Object.keys(F.rows).length !== F.count) bad.push(`固定の字の行の数 ${Object.keys(F.rows).length}（K-1 は ${F.count}）`);
  const names = ops.map((r) => r.name);
  if (new Set(names).size !== names.length) bad.push('同じ名前の行がある');
  for (const r of ops) {
    for (const c of F.oldEmpty) if (r[c] !== undefined && r[c] !== null) bad.push(`${r.name}: v15 の列 ${c} に値が在る（空だけ）`);
    const want = F.rows[r.name];
    if (!want) { bad.push(`K-1 に無い操作: ${r.name}`); continue; }
    COLS.forEach((c, i) => {
      if (!(c in r)) bad.push(`${r.name}: 列 ${c} が書かれていない（既定は置かない＝全列を書く）`);
      else if (r[c] !== want[i]) bad.push(`${r.name}.${c}＝${r[c]}（K-1 は ${want[i]}）`);
    });
  }
  for (const n of Object.keys(F.rows)) if (!names.includes(n)) bad.push(`表に無い操作: ${n}`);
  return bad;
}

const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (DIRECT && process.argv.includes('--self-test')) {
  const ops = readOps(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  let p = 0, f = 0;
  const T = (n, mut) => {
    const c = ops.map((r) => ({ ...r }));
    mut(c);
    if (judge(c).length) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
  };
  const row = (c, n) => c.find((r) => r.name === n);
  console.log('\n[mj-ops --self-test] 表をわざと壊して赤になるか');
  if (judge(ops).length) { console.log('  ✗ はじめの表が赤（壊す前から合っていない）'); process.exit(1); }
  T('league_save を入に開ける（who_plain none→nyu）', (c) => { row(c, 'league_save').who_plain = 'nyu'; });
  T('room_delete の入り直しを外す（re yes→no）', (c) => { row(c, 'room_delete').re = 'no'; });
  T('role_set の「付ける時」を常に（grant→yes）', (c) => { row(c, 'role_set').re = 'yes'; });
  T('room_export を履歴に残す', (c) => { row(c, 'room_export').writes_history = true; });
  T('cell_set を消した部屋で通す', (c) => { row(c, 'cell_set').on_deleted = true; });
  T('hanchan_order の版を外す', (c) => { row(c, 'hanchan_order').versioned = false; });
  T('extra_add の戻しを prev に', (c) => { row(c, 'extra_add').revert = 'prev'; });
  T('member_rename のリーグの日を same に', (c) => { row(c, 'member_rename').who_league = 'same'; });
  T('hanchan_seats のリーグの日を nyu に', (c) => { row(c, 'hanchan_seats').who_league = 'nyu'; });
  T('account_remove を持ち主だけに', (c) => { row(c, 'account_remove').who_plain = 'owner'; });
  T('league_owner_set のリーグの日を L に', (c) => { row(c, 'league_owner_set').who_league = 'L'; });
  T('行を1つ消す（34）', (c) => { c.pop(); });
  T('知らない操作を足す（36）', (c) => { c.push({ ...c[0], name: 'room_merge' }); });
  T('列を1つ書き忘れる（re 抜け）', (c) => { delete row(c, 'member_link').re; });
  T('v15 の kan 列に値を入れる', (c) => { row(c, 'cell_set').kan = true; });
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--self-test')) {
  const ops = readOps(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  const bad = judge(ops);
  if (bad.length) { console.log('✗ 操作の表が K-1 と違う'); bad.forEach((b) => console.log('   - ' + b)); process.exit(1); }
  console.log(`✓ 操作の表 ${ops.length} 行 × ${COLS.length} 列＝K-1 の通り（v15 の列 ${FIXED.oldEmpty.join('・')} は種に無い）`);
}
