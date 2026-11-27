/* busyji.test.mjs — P3g（pbundle_sadame v2.1 §2 S5）：倉庫の busy の what ごとに errText の字が合うか
 * user_min＝少し待って／solo_day＝24時間100・until の時刻から／user_day＝入る試しが多すぎる・until の時刻から／user（共有の部屋1日5つ）は今のまま／'all' はもう返さない＝分かれ道は無い
 * 使い方: node tests/busyji.test.mjs  /  node tests/busyji.test.mjs --self-test（枝を1つずつ壊すと赤になるか）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'js', 'gamen-core.mjs'), 'utf8');
const U = new Date(2026, 10, 27, 21, 5, 0).toISOString(); // 手元の時計で 21:05（hhmm は手元の時刻で出す）
const WAIT = '時間をおいてもう一度押してください。';

async function check(src) {
  const dir = mkdtempSync(join(tmpdir(), 'busyji-'));
  const p = join(dir, 'gamen-core.mjs');
  writeFileSync(p, src);
  const m = await import(pathToFileURL(p).href + '?t=' + Math.random());
  rmSync(dir, { recursive: true, force: true });
  const t = m.errText;
  let pass = 0, fail = 0;
  const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log('  ✗ ' + name + ' — ' + JSON.stringify(got) + ' ≠ ' + JSON.stringify(want)); } };
  const B = (what, until) => ({ ok: false, err: 'busy', what, ...(until !== undefined ? { until } : {}) });
  for (const way of ['create', 'name', 'url']) eq('user_min ' + way, t(B('user_min'), way), '少し待ってからもう一度押してください。');
  eq('solo_day until', t(B('solo_day', U), 'create'), '24時間で始められる対局の数を越えました（100）。時刻 21:05 から始められます。');
  eq('solo_day until 無し', t(B('solo_day'), 'create'), '24時間で始められる対局の数を越えました（100）。' + WAIT);
  eq('solo_day until 読めない', t(B('solo_day', 'x'), 'create'), '24時間で始められる対局の数を越えました（100）。' + WAIT);
  for (const way of ['name', 'url', 'create', 'write']) eq('user_day until ' + way, t(B('user_day', U), way), '入る試しが多すぎます。21:05 からもう一度押してください。');
  eq('user_day until 無し', t(B('user_day'), 'name'), '入る試しが多すぎます。' + WAIT);
  eq('user_day until null', t(B('user_day', null), 'name'), '入る試しが多すぎます。' + WAIT);
  // 今のまま
  eq('user 作る（共有の部屋1日5つ）', t(B('user'), 'create'), '1人が1日に作れる部屋は5つまでです。明日もう一度。');
  eq('user 入る', t(B('user'), 'name'), '打ち間違いが続いたので、1分待ってもう一度。');
  eq('what 無し', t(B(undefined), 'create'), '混んでいます。1分待ってもう一度押してください。');
  // 'all' の分かれ道は消した（来ても「1分待って」に落ちる）
  eq('all 作る＝分かれ道なし', t(B('all'), 'create'), '混んでいます。1分待ってもう一度押してください。');
  if (src.includes("w === 'all'")) { fail++; console.log("  ✗ gamen-core.mjs に w === 'all' が残っている"); } else pass++;
  return { pass, fail };
}

const BREAKS = [
  ['user_min の枝を消す', (s) => s.replace("if (w === 'user_min') return", 'if (false) return')],
  ['solo_day の枝を消す', (s) => s.replace("if (w === 'solo_day') return", 'if (false) return')],
  ['user_day の枝を消す', (s) => s.replace("if (w === 'user_day') return", 'if (false) return')],
  ['until を読まない', (s) => s.replace("const untilOk = (t) => t !== undefined && t !== null && t !== '' && !isNaN(new Date(t));", 'const untilOk = (t) => false;')],
  ['until が無くても時刻を出す', (s) => s.replace("const untilOk = (t) => t !== undefined && t !== null && t !== '' && !isNaN(new Date(t));", 'const untilOk = (t) => true;')],
  ['solo_day の数を変える', (s) => s.replace('越えました（100）', '越えました（50）')],
  ["'all' の分かれ道を戻す", (s) => s.replace("      if (w === 'user_min') return", "      if (w === 'all' && way === 'create') return '今は混んでいます。少し待ってからもう一度押してください。';\n      if (w === 'user_min') return")],
  ['user の字を変える（残す字の見張り）', (s) => s.replace('1人が1日に作れる部屋は5つまでです。明日もう一度。', '作れません。')],
];

if (process.argv.includes('--self-test')) {
  let bad = 0;
  for (const [name, brk] of BREAKS) {
    const s2 = brk(SRC);
    if (s2 === SRC) { console.log('✗ 壊しが当たらない（字が見つからない）: ' + name); bad++; continue; }
    const r = await check(s2);
    if (r.fail > 0) console.log('✓ 赤になった: ' + name + '（✗ ' + r.fail + '）');
    else { console.log('✗ 赤にならない: ' + name); bad++; }
  }
  console.log(bad === 0 ? 'self-test OK ' + BREAKS.length + '/' + BREAKS.length : 'self-test NG ' + bad);
  console.log('KEKKA ' + JSON.stringify({ passed: BREAKS.length - bad, failed: bad, mimiso: 0 }));
  process.exit(bad === 0 ? 0 : 1);
} else {
  const r = await check(SRC);
  console.log((r.fail === 0 ? 'OK ' : 'NG ') + r.pass + '/' + (r.pass + r.fail));
  process.exit(r.fail === 0 ? 0 : 1);
}
