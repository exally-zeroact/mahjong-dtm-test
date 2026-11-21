/* rules.test.mjs — ★ルールの鍵の表（schema.sql の種）と lib/rules.mjs が1字も違わないか＋確かめの答え★（CI）
 * =============================================================================
 * ① schema.sql の $rk$…$rk$（倉庫の mahjong.mj_rule_keys の種）を JSON.parse して lib の RULE_KEYS と深く比べる
 * ② 鍵の数と名の組を★ここに字で固定★（表を変えた日に赤＝変えた人がここも直す＝設計の変わりを見落とさない）
 * ③ rulesOk に手で決めた答え（弾く／通る／既定で埋める）
 * 倉庫の mj_rules_ok が同じ答えを出すかは tests/rules.live.mjs（鍵が要る＝手元）。
 * 使い方: node tests/rules.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_KEYS, rulesOk, defaultRules } from '../lib/rules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };

/* ① 種と lib */
const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
const D = '$';
const m = new RegExp('\\' + D + 'rk\\' + D + '([\\s\\S]*?)\\' + D + 'rk\\' + D).exec(sql);
let seed = null;
try { seed = JSON.parse(m[1]); } catch (e) { /* 下で赤 */ }
ok('schema.sql に鍵の種（$rk$ の jsonb の字）が1つ在って読める', Array.isArray(seed));
ok('種と lib の RULE_KEYS が深く同じ', JSON.stringify(seed) === JSON.stringify(RULE_KEYS),
  '違う鍵: ' + (seed || []).filter((k, i) => JSON.stringify(k) !== JSON.stringify(RULE_KEYS[i])).map((k) => k.key).join(','));

/* ② 鍵の数と名の組を字で固定 */
const NAMES = 'aka atozuke chip_pt10 chombo chombo_pt double_ron double_ron_kyotaku double_yakuman hakoshita honba kazoe '
  + 'kiriage kita kuitan kyotaku_end nagashi oorasu_stop pao players rate renpu_fu return_pts round shugi_pt10 start_pts '
  + 'tane_custom tenpai_ryo tie tobi tobi_from tobi_pt tobi_zero tochu_kyushu tochu_sucha tochu_sufu tochu_sukan triple_ron tsumo3 uma '
  + 'west yakitori yakitori_pt yakitori_to yakitori_top_tie';
ok('鍵は44個', RULE_KEYS.length === 44, `${RULE_KEYS.length} 個`);
ok('鍵の名の組と並び（ASCII 順）が字の通り', RULE_KEYS.map((k) => k.key).join(' ') === NAMES);
ok('null を通す鍵は rate・chip_pt10・shugi_pt10 だけ', RULE_KEYS.filter((k) => k.nullable).map((k) => k.key).join(',') === 'chip_pt10,rate,shugi_pt10');
ok('無いと弾く鍵は players だけ', RULE_KEYS.filter((k) => k.need).map((k) => k.key).join(',') === 'players');
ok('既定（4人・3人）がどれも自分の確かめを通る', rulesOk(defaultRules(4)).ok && rulesOk(defaultRules(3)).ok);
// S2（11-21 司さん）：箱下の既定は「あり」（4人・3人）。保存済みの false は替わらない（鍵を持っていればその値）
ok('箱下の既定はあり（4人・3人）', defaultRules(4).hakoshita === true && defaultRules(3).hakoshita === true);
ok('保存済みの箱下なしはなしのまま', rulesOk({ players: 4, hakoshita: false }).rules.hakoshita === false && rulesOk({ players: 3, hakoshita: false }).rules.hakoshita === false);

/* ③ 手で決めた答え */
const CASES = [
  ['object でない', [1], '(object)'],
  ['null', null, '(object)'],
  ['表に無い鍵', { players: 4, oka: true }, '(unknown)'],
  ['players 無し', {}, 'players'],
  ['players 5', { players: 5 }, 'players'],
  ['players が字 "4"', { players: '4' }, 'players'],
  ['honba が字 "300"（型ごと比べる）', { players: 4, honba: '300' }, 'honba'],
  ['honba 1000', { players: 4, honba: 1000 }, 'honba'],
  ['renpu_fu 4 は通る', { players: 4, renpu_fu: 2 }, null],
  ['rate 15（10の倍数でない）', { players: 4, rate: 15 }, 'rate'],
  ['rate 100000 は通る', { players: 4, rate: 100000 }, null],
  ['rate null は通る', { players: 4, rate: null }, null],
  ['chip_pt10 0', { players: 4, chip_pt10: 0 }, 'chip_pt10'],
  ['chip_pt10 9999 は通る', { players: 4, chip_pt10: 9999 }, null],
  ['chip_pt10 小数 0.5', { players: 4, chip_pt10: 0.5 }, 'chip_pt10'],
  ['tobi が null（null を通さない鍵）', { players: 4, tobi: null }, 'tobi'],
  ['tobi が 1（bool でない）', { players: 4, tobi: 1 }, 'tobi'],
  ['start_pts 25050（100の倍数でない）', { players: 4, start_pts: 25050 }, 'start_pts'],
  ['返し＜持ち点', { players: 4, start_pts: 30000, return_pts: 25000 }, 'return_pts'],
  ['返し＝持ち点（オカ無し）は通る', { players: 4, start_pts: 25000, return_pts: 25000 }, null],
  ['uma の長さが人数と違う', { players: 3, uma: [20, 10, -10, -20] }, 'uma'],
  ['uma の合計が0でない', { players: 4, uma: [20, 10, -10, -10] }, 'uma'],
  ['uma が大きい順でない', { players: 4, uma: [10, 20, -10, -20] }, 'uma'],
  ['uma に小数', { players: 4, uma: [20.5, 9.5, -10, -20] }, 'uma'],
  ['uma 1000 は範囲の外', { players: 4, uma: [1000, 0, 0, -1000] }, 'uma'],
  ['uma 同じ値の並び 0,0,0 は通る', { players: 3, uma: [0, 0, 0] }, null],
  ['kyotaku_end x', { players: 4, kyotaku_end: 'x' }, 'kyotaku_end'],
  ['round none は通る', { players: 4, round: 'none' }, null],
  ['二つ弾く時は名の順で先の鍵（aka が tobi より先）', { players: 4, tobi: 1, aka: 9 }, 'aka'],
];
for (const [name, input, want] of CASES) {
  const r = rulesOk(input);
  if (want === null) ok(name, r.ok, JSON.stringify(r));
  else ok(name + ' は弾く（' + want + '）', !r.ok && r.err === want, JSON.stringify(r));
}
const d3 = rulesOk({ players: 3 }).rules;
ok('3人の既定＝35000/40000・ウマ 15/0/−15・赤2・北抜き', d3.start_pts === 35000 && d3.return_pts === 40000
  && JSON.stringify(d3.uma) === '[15,0,-15]' && d3.aka === 2 && d3.kita === 'nuki');
const d4 = rulesOk({ players: 4, kyotaku_end: 'kieru' }).rules;
ok('4人の既定で埋め、在る鍵はそのまま（kyotaku_end kieru）', d4.start_pts === 25000 && d4.return_pts === 30000
  && JSON.stringify(d4.uma) === '[20,10,-10,-20]' && d4.kyotaku_end === 'kieru' && Object.keys(d4).length === 44);

/* ④ 2c-3a の3鍵（yakitori_to・yakitori_top_tie・tane_custom）＝表 tests/fixtures/rules-tane-cases.json（倉庫も rules.live が同じ表を通す） */
ok('既定 yakitori_to each・yakitori_top_tie others・tane_custom []', d4.yakitori_to === 'each' && d4.yakitori_top_tie === 'others' && JSON.stringify(d4.tane_custom) === '[]'
  && d3.yakitori_to === 'each' && d3.yakitori_top_tie === 'others' && JSON.stringify(d3.tane_custom) === '[]');
for (const [v, good] of [['each', 1], ['split', 1], ['top', 1], ['x', 0], [null, 0], [1, 0]]) { const r = rulesOk({ players: 4, yakitori_to: v }); ok('yakitori_to ' + JSON.stringify(v) + (good ? ' 通る' : ' 弾く'), good ? r.ok : !r.ok && r.err === 'yakitori_to'); }
for (const [v, good] of [['others', 1], ['all', 1], ['each', 0], [null, 0]]) { const r = rulesOk({ players: 4, yakitori_top_tie: v }); ok('yakitori_top_tie ' + JSON.stringify(v) + (good ? ' 通る' : ' 弾く'), good ? r.ok : !r.ok && r.err === 'yakitori_top_tie'); }
const TANE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/rules-tane-cases.json'), 'utf8')).cases;
ok('tane の表は40行より多い', TANE.length > 40, String(TANE.length));
for (const c of TANE) {
  const src = { players: 4, tane_custom: c.in }; const keep = JSON.stringify(src);
  const r = rulesOk(src);
  if (c.want) ok('tane ' + c.id, r.ok && JSON.stringify(r.rules.tane_custom) === JSON.stringify(c.want) && JSON.stringify(src) === keep, JSON.stringify(r.ok ? r.rules.tane_custom : r));
  else ok('tane ' + c.id + '（弾く）', !r.ok && r.err === 'tane_custom', JSON.stringify(r.ok ? r.rules.tane_custom : r));
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
