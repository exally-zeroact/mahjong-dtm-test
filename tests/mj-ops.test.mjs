/* mj-ops.test.mjs — ★操作の表 mahjong.mj_ops の値そのものの誤りを捕まえる★（設計図 §3.1 試験②の後半）
 * =============================================================================
 * 試験は表から引く（名前を字で並べない）が、★表そのものが間違っていたら表から引く試験は全部緑★。
 * だから「管だけ」「合言葉の打ち直し」「履歴に残さない」「消した部屋で通る」の組と行の数 28 は
 * ここに字で固定する＝表を変えた日に ★この試験が赤になる★（v14.1 任意c・v15.8）。
 * 読むのは supabase/schema.sql の insert into mahjong.mj_ops（倉庫に当てる物と同じ字）。
 *
 * 使い方: node tests/mj-ops.test.mjs  /  node tests/mj-ops.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FIXED = {
  count: 28,
  kanOnly: ['league_save', 'room_delete', 'room_secret', 'room_undelete', 'rerev_ok', 'rules_save'],
  needsSecret: ['room_delete', 'room_secret'],
  noHistory: ['device_leave', 'room_export'],
  onDeleted: ['device_leave', 'room_export', 'room_undelete'],
  versioned: ['cell_set', 'extra_set', 'hanchan_order', 'kyotaku_set', 'tobi_set'],
  /* 戻し方（§3.1 の表の「戻し」の列） */
  revert: {
    device_leave: 'none', member_pick: 'prev', member_add: 'inactive', member_rename: 'prev', member_active: 'prev',
    session_add: 'void', session_edit: 'prev', table_add: 'void', table_edit: 'prev',
    hanchan_start: 'void', hanchan_seats: 'prev', hanchan_void: 'unvoid', hanchan_unvoid: 'void',
    cell_set: 'prev', tobi_set: 'prev', kyotaku_set: 'prev', hanchan_order: 'prev',
    extra_set: 'prev', extra_add: 'prev', history_revert: 'prev', settle_snap: 'none',
    league_save: 'rules_version', room_export: 'none', rules_save: 'rules_version', rerev_ok: 'none',
    room_secret: 'none', room_delete: 'none', room_undelete: 'none',
  },
};

/** schema.sql の mj_ops の種を読む → [{name,kan,nyu,on_deleted,needs_secret,writes_history,revert,versioned}] */
export function readOps(sql) {
  const m = /insert\s+into\s+mahjong\.mj_ops\s*\(([^)]*)\)\s*values([\s\S]*?)on\s+conflict/i.exec(sql);
  if (!m) throw new Error('schema.sql に insert into mahjong.mj_ops が無い');
  const cols = m[1].split(',').map((s) => s.trim());
  const rows = [...m[2].matchAll(/\(([^()]*)\)/g)].map((r) => r[1].split(',').map((v) => v.trim()));
  return rows.map((vals) => {
    if (vals.length !== cols.length) throw new Error('列の数が合わない行: ' + vals.join(','));
    const o = {};
    cols.forEach((c, i) => {
      const v = vals[i];
      o[c] = v === 'true' ? true : v === 'false' ? false : v.replace(/^'|'$/g, '');
    });
    return o;
  });
}

const sorted = (a) => [...a].sort().join(',');

/** 違反の一覧を返す（純関数） */
export function judge(ops, F = FIXED) {
  const bad = [];
  if (ops.length !== F.count) bad.push(`行の数 ${ops.length}（設計図は ${F.count}）`);
  const names = ops.map((o) => o.name);
  if (new Set(names).size !== names.length) bad.push('同じ名前の行がある');
  const pick = (fn) => sorted(ops.filter(fn).map((o) => o.name));
  const eq = (label, got, want) => { if (got !== sorted(want)) bad.push(`${label}: 表＝[${got}] 設計図＝[${sorted(want)}]`); };
  eq('管だけ（入×）', pick((o) => o.kan && !o.nyu), F.kanOnly);
  eq('合言葉の打ち直し', pick((o) => o.needs_secret), F.needsSecret);
  eq('履歴に残さない', pick((o) => !o.writes_history), F.noHistory);
  eq('消した部屋で通る', pick((o) => o.on_deleted), F.onDeleted);
  eq('版つき', pick((o) => o.versioned), F.versioned);
  if (ops.some((o) => !o.kan)) bad.push('管が押せない操作がある（管は全部押せる）');
  for (const o of ops) {
    if (!(o.name in F.revert)) bad.push(`設計図に無い操作: ${o.name}`);
    else if (F.revert[o.name] !== o.revert) bad.push(`戻し方が違う: ${o.name}＝${o.revert}（設計図は ${F.revert[o.name]}）`);
  }
  for (const n of Object.keys(F.revert)) if (!names.includes(n)) bad.push(`表に無い操作: ${n}`);
  return bad;
}

const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (DIRECT && process.argv.includes('--self-test')) {
  const ops = readOps(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  let p = 0, f = 0;
  const T = (n, mut) => {
    const c = ops.map((o) => ({ ...o }));
    mut(c);
    if (judge(c).length) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
  };
  console.log('\n[mj-ops --self-test] 表をわざと壊して赤になるか');
  T('入に league_save を開ける', (c) => { c.find((o) => o.name === 'league_save').nyu = true; });
  T('room_delete の合言葉を外す', (c) => { c.find((o) => o.name === 'room_delete').needs_secret = false; });
  T('room_export を履歴に残す', (c) => { c.find((o) => o.name === 'room_export').writes_history = true; });
  T('cell_set を消した部屋で通す', (c) => { c.find((o) => o.name === 'cell_set').on_deleted = true; });
  T('hanchan_order の版を外す', (c) => { c.find((o) => o.name === 'hanchan_order').versioned = false; });
  T('行を1つ消す（27）', (c) => { c.pop(); });
  T('知らない操作を足す（29）', (c) => { c.push({ ...c[0], name: 'room_merge' }); });
  T('戻し方を変える', (c) => { c.find((o) => o.name === 'hanchan_void').revert = 'prev'; });
  T('管から room_secret を外す', (c) => { c.find((o) => o.name === 'room_secret').kan = false; });
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--self-test')) {
  const ops = readOps(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  const bad = judge(ops);
  if (bad.length) { console.log('✗ 操作の表が設計図と違う'); bad.forEach((b) => console.log('   - ' + b)); process.exit(1); }
  console.log(`✓ 操作の表 ${ops.length} 行・管だけ ${FIXED.kanOnly.length}・合言葉 ${FIXED.needsSecret.length}・履歴なし ${FIXED.noHistory.length}・消した部屋 ${FIXED.onDeleted.length}・版つき ${FIXED.versioned.length}＝設計図の通り`);
}
