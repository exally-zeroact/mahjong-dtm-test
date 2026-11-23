/* fullji.test.mjs — ★H2（対局の記録の上限を外した）の後、errText の full の字が事実に合うか★（fullji_sadame v1.1 §2・§3）
 * close と league の op が受け得る full は op_results の mj_caps 行の欠けだけ＝「記録がいっぱい」「リーグは50まで」は出さない。
 * 入る・作る（97 行）の「いっぱい」は上限が残る（room_accounts・rooms）＝今の字のまま。
 * 使い方: node tests/fullji.test.mjs  /  node tests/fullji.test.mjs --self-test（字を前に戻す・league の枝を消すと赤になるか）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(HERE, '..', 'js', 'gamen-core.mjs');
const SRC = readFileSync(SRC_PATH, 'utf8');

const CLOSE_FULL = '倉庫で止まりました。今は終えられません。';
const LEAGUE_FULL = '倉庫で止まりました。もう一度押しても同じです。';

async function check(src) {
  const dir = mkdtempSync(join(tmpdir(), 'fullji-'));
  const p = join(dir, 'gamen-core.mjs');
  writeFileSync(p, src);
  const m = await import(pathToFileURL(p).href + '?t=' + Math.random());
  rmSync(dir, { recursive: true, force: true });
  const t = m.errText;
  let pass = 0, fail = 0;
  const ok = (name, cond, why = '') => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  const eq = (name, got, want) => ok(name, got === want, JSON.stringify(got) + ' ≠ ' + JSON.stringify(want));

  eq('close full what op_results', t({ ok: false, err: 'full', what: 'op_results' }, 'close'), CLOSE_FULL);
  eq('close full（what 無し）', t({ ok: false, err: 'full' }, 'close'), CLOSE_FULL);
  eq('league full what op_results', t({ ok: false, err: 'full', what: 'op_results' }, 'league'), LEAGUE_FULL);
  eq('league full what leagues（H2 前の倉庫の返し）', t({ ok: false, err: 'full', what: 'leagues' }, 'league'), LEAGUE_FULL);
  eq('league full what history', t({ ok: false, err: 'full', what: 'history' }, 'league'), LEAGUE_FULL);
  eq('league full what *', t({ ok: false, err: 'full', what: '*' }, 'league'), LEAGUE_FULL);
  eq('league full（what 無し）', t({ ok: false, err: 'full' }, 'league'), LEAGUE_FULL);
  // 残す字（上限が残る）
  eq('入る（name）full＝人数がいっぱい', t({ ok: false, err: 'full' }, 'name'), 'この部屋は人数がいっぱいで入れません。');
  eq('入る（url）full＝人数がいっぱい', t({ ok: false, err: 'full' }, 'url'), 'この部屋は人数がいっぱいで入れません。');
  eq('作る full＝倉庫がいっぱい', t({ ok: false, err: 'full' }, 'create'), '今は部屋を作れません（倉庫がいっぱいです）。少し待ってからもう一度。');
  // close・league の他の字は変わらない
  eq('close bad closed', t({ ok: false, err: 'bad', at: 'closed' }, 'close'), 'この部屋はもう終わっています。');
  eq('close mj_role', t({ ok: false, err: 'mj_role' }, 'close'), '部屋を終えられるのは部屋の持ち主だけです。');
  eq('league internal', t({ ok: false, err: 'internal' }, 'league'), '倉庫で止まりました。もう一度押しても同じです。');
  eq('league too_many', t({ ok: false, err: 'too_many' }, 'league'), '24時間に作れるリーグは5つまでです。');
  // 死んだ字が残っていない
  ok('gamen-core.mjs に「記録がいっぱい」が0', !src.includes('記録がいっぱい'));
  ok('gamen-core.mjs に「リーグは50まで」が0', !src.includes('リーグは50まで'));
  return { pass, fail };
}

const BREAKS = [
  ['close の字を前に戻す', (s) => s.replace("return '" + CLOSE_FULL + "'", "return 'この部屋は記録がいっぱいのため、今は終えられません。'")],
  ['league の full の枝を消す（作る の字へ落ちる）', (s) => s.replace("    if (e === 'full') return '" + LEAGUE_FULL + "';", '')],
  ['league の full を前の what ごとの字に戻す', (s) => s.replace("    if (e === 'full') return '" + LEAGUE_FULL + "';", "    if (e === 'full') { if (at === 'leagues') return 'この部屋のリーグは50までです。'; return 'この部屋は記録がいっぱいです（' + at + '）。'; }")],
  ['入る の字を変える（残す字の見張り）', (s) => s.replace('この部屋は人数がいっぱいで入れません。', '入れません。')],
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
  console.log('KEKKA ' + JSON.stringify({ passed: r.pass, failed: r.fail, mimiso: 0 }));
  process.exit(r.fail === 0 ? 0 : 1);
}
