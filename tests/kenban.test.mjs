/*
 * A8（tataki/a8_sadame_v1.md）アプリの数字鍵盤の字の作り（js/kenban.mjs の kpPress）＝正解表。
 * 箱の字 → 鍵の並び → 期待の字。spec＝{ neg, dec, max }。fresh＝箱に入って最初の鍵か。
 */
import { kpPress, kpNextFresh } from '../js/kenban.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const run = (start, keys, spec, fresh = true) => { let t = start, fr = fresh; for (const k of keys) { t = kpPress(t, k, spec, fr); fr = kpNextFresh(fr, k, spec); } return t; };
const eq = (name, start, keys, spec, want, fresh = true) => { const g = run(start, keys, spec, fresh); ok(`${name}：${JSON.stringify(start)} ＋ ${keys.join(' ')} → ${JSON.stringify(want)}`, g === want, JSON.stringify(g)); };

const UMA = { neg: true, dec: false, max: 3 };
const PTS = { neg: false, dec: false, max: 6 };
const CHIP = { neg: false, dec: true, max: 3 };

console.log('■ ウマ（−あり・3桁）');
eq('入ってすぐ − 1 0 → −10（A3 の −101 にしない）', '10', ['neg', '1', '0'], UMA, '−10');
eq('− を2回で ＋ に戻して打つ', '10', ['neg', 'neg', '5'], UMA, '5');
eq('−20 の箱に入って 1 5 → 15（置き換えは＋）', '−20', ['1', '5'], UMA, '15');
eq('最初の数で置き換え→−', '10', ['2', '0', 'neg'], UMA, '−20');
eq('続きで − を替える', '−20', ['neg'], UMA, '20', false);
eq('4桁目は入らない', '', ['1', '2', '3', '4'], UMA, '123');
eq('⌫ で数を消し、空なら − を消す', '−5', ['bs', 'bs'], UMA, '', false);

console.log('■ 持ち点・返し（−なし・000・区切り）');
eq('25 000 → 25,000', '30000', ['2', '5', '000'], PTS, '25,000');
eq('− は効かない', '25,000', ['neg'], PTS, '25,000', false);
eq('− が効かない箱は入ってすぐの − も置き換えに効かない', '25,000', ['neg', '3'], PTS, '3');
eq('7桁目は入らない', '', ['1', '000', '000'], PTS, '1,000');
eq('先の 0 は残さない', '', ['0', '0', '5'], PTS, '5');

console.log('■ チップ・祝儀（小数1桁）');
eq('2 . 5 → 2.5', '2.0', ['2', 'dot', '5'], CHIP, '2.5');
eq('. から → 0.5', '', ['dot', '5'], CHIP, '0.5');
eq('小数2桁目は入らない', '', ['1', 'dot', '2', '3'], CHIP, '1.2');
eq('「.」の2回目は入らない', '', ['1', 'dot', 'dot', '2'], CHIP, '1.2');
eq('⌫ で小数→点→整数', '1.2', ['bs', 'bs', 'bs'], CHIP, '', false);
eq('dec でない箱の「.」は効かない', '5', ['dot'], PTS, '5', false);
eq('最初の数で置き換え（2.0→3）', '2.0', ['3'], CHIP, '3');


console.log('■ 点の箱（A17・対局の入力・−あり・10桁＝gamen-room の KP_SPEC）');
const TEN = { neg: true, dec: false, max: 10 };
eq('空に入ってすぐ − 1 0 → −10（前は −101）', '', ['neg', '1', '0'], TEN, '−10');
eq('− 1 5 000 → −15,000', '', ['neg', '1', '5', '000'], TEN, '−15,000');
eq('3 0 000 → 30,000（000 の鍵）', '', ['3', '0', '000'], TEN, '30,000');
eq('入っている 1 に − 1 0 → −10（前は −110）', '1', ['neg', '1', '0'], TEN, '−10');
eq('入っている 1,000 に − 1 0 → −10（前は −100,010）', '1,000', ['neg', '1', '0'], TEN, '−10');
eq('勧めの 10,000 に − 1 → −1（前は −100,001）', '10,000', ['neg', '1'], TEN, '−1');
eq('先の 0 を残さない（前は /^0+(?=d)/ の誤りで 05）', '', ['0', '5'], TEN, '5');
eq('入っている −20,000 に 5 → 5（置き換えは＋）', '−20,000', ['5'], TEN, '5');
eq('10桁まで（11桁目は入らない）', '', ['9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9'], TEN, '9,999,999,999');
eq('000 で11桁になる時は000ごと入らない', '', ['1', '2', '3', '4', '5', '6', '7', '8', '000'], TEN, '12,345,678');
eq('続きで − を替える', '25,000', ['neg'], TEN, '−25,000', false);

// 自己確認：わざと違う期待で ✗ になるか（正解表が空回りしていない）
const bad = run('', ['2', '5', '000'], PTS) === '25000';
ok('自己確認（区切りの無い字を正にしたら外れる）', !bad);

console.log(`\n${p} passed, ${f} failed`);
console.log(`KEKKA: ${p}/${p + f}`);
process.exitCode = f ? 1 : 0;
