/* score.test.mjs — ★点数計算（lib/score.mjs）の手で書いた正解表★（件4a・設計 tataki/score_sekkei_v13.md v1.5）
 * node tests/score.test.mjs             … 正解表（各行の点・翻/符・役の名・払い）を全部見る
 * node tests/score.test.mjs --self-test … lib/score.mjs の式を1つずつ壊した写しを流して、全部赤になるか（見張りの空振りを見る）
 * 各行の答えは手で数えた（式から写していない）。形＝'点 翻/符 役,役' か 'Y倍 役満の名'（役満）か 'E:エラー'。
 * 払いの行＝'人:点x人数 … 計 合計'（供託は ' 供 点'）。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '../lib/tiles.mjs';
import { label } from '../lib/score-table.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'lib');

const R4 = { players: 4 }, R3 = { players: 3 }, R3H = { players: 3, tsumo3: 'secchan' };

/** 1行の入力を作る：o＝{ t ツモ, oya, b 場風, j 自風, r 立直, m 鳴き['pon:555z'], d ドラ表示, u 裏, aka, kita, ip 一発 … rules } */
function inp(hand, win, o = {}) {
  const melds = (o.m || []).map((s) => { const [kind, t] = s.split(':'); return { kind, tiles: parse(t) }; });
  return {
    hand: parse(hand), win, melds, tsumo: !!o.t,
    bakaze: o.b || '1z', jikaze: o.j || (o.oya ? '1z' : '2z'),
    riichi: o.r || 0, ippatsu: !!o.ip, rinshan: !!o.rin, haitei: !!o.hai, houtei: !!o.hou, chankan: !!o.chan,
    tenhou: !!o.ten, chiihou: !!o.chii,
    dora: o.d ? parse(o.d) : [], ura: o.u ? parse(o.u) : [], aka: o.aka || 0, kita: o.kita || 0,
    honba: o.hb || 0, kyotaku: o.kyo || 0, pao: o.pao === undefined ? null : o.pao,
  };
}
const sortNames = (s) => s.split(',').filter(Boolean).sort().join(',');
function show(r) {
  if (!r.ok) return 'E:' + r.err;
  if (r.yakuman.length) return `${label(r.pts)} Y${r.pts.base / 8000} ${sortNames(r.yakuman.map((y) => y.name).join(','))}`;
  return `${label(r.pts)} ${r.han}/${r.fu} ${sortNames(r.yaku.map((y) => y.name).join(','))}`;
}
function norm(want) {
  if (want.startsWith('E:')) return want;
  const [a, b, ...c] = want.split(' ');
  return `${a} ${b} ${sortNames(c.join(' '))}`;
}
const payStr = (p) => p.rows.map((x) => `${x.who}:${x.pts}x${x.n}`).join(' ') + ` 計${p.total}` + (p.kyotaku ? ` 供${p.kyotaku}` : '');

/* ── 正解表 ── [説明, 手, 和了牌, 入力の o, 答え, 払い(任意)] */
const H1 = '234567m345p678s88p'; // 平和・断么九（4m 両面）
const H2 = '123345m456p678s22p'; // 3m＝両面（345）と辺張（123）の取り方
const S3 = '111m123p456p789s99m'; // 3人でも使える手（2〜8萬なし）
const DSG = ['pon:555z', 'pon:666z', 'pon:777z'];
const ROWS = [
  // 平和の手
  ['平和 子ロン', H1, '4m', {}, '2,000 2/30 平和,断么九', '放銃者:2000x1 計2000'],
  ['平和 子ツモ', H1, '4m', { t: 1 }, '700-1,300 3/20 門前清自摸和,平和,断么九', '親:1300x1 子（各）:700x2 計2700'],
  ['平和 親ロン', H1, '4m', { oya: 1 }, '2,900 2/30 平和,断么九'],
  ['平和 親ツモ', H1, '4m', { oya: 1, t: 1 }, '1,300オール 3/20 門前清自摸和,平和,断么九', '子（各）:1300x3 計3900'],
  ['平和 2m で和了（両面）', H1, '2m', {}, '2,000 2/30 平和,断么九'],
  ['立直 平和 子ロン', H1, '4m', { r: 1 }, '3,900 3/30 立直,平和,断么九'],
  ['立直 一発 ツモ', H1, '4m', { r: 1, ip: 1, t: 1 }, '2,000-4,000 5/20 立直,一発,門前清自摸和,平和,断么九'],
  ['ダブル立直 親ロン', H1, '4m', { r: 2, oya: 1 }, '11,600 4/30 ダブル立直,平和,断么九'],
  ['ダブル立直 親ロン 切り上げ', H1, '4m', { r: 2, oya: 1, rules: { players: 4, kiriage: true } }, '12,000 4/30 ダブル立直,平和,断么九'],
  ['ドラ 7s→8s 1枚', H1, '4m', { r: 1, d: '7s' }, '7,700 4/30 立直,平和,断么九'],
  ['ドラ 7s→8s 切り上げ満貫', H1, '4m', { r: 1, d: '7s', rules: { players: 4, kiriage: true } }, '8,000 4/30 立直,平和,断么九'],
  ['ドラ 7p→8p 雀頭2枚', H1, '4m', { r: 1, d: '7p' }, '8,000 5/30 立直,平和,断么九'],
  ['赤1', H1, '4m', { r: 1, aka: 1 }, '7,700 4/30 立直,平和,断么九'],
  ['赤2（萬と筒の5）', H1, '4m', { r: 1, aka: 2 }, '8,000 5/30 立直,平和,断么九'],
  ['赤3＝5索が無いので上限超え', H1, '4m', { r: 1, aka: 3 }, 'E:aka'],
  ['赤1 ルール aka=0', H1, '4m', { r: 1, aka: 1, rules: { players: 4, aka: 0 } }, 'E:aka'],
  ['裏 7p→8p 2枚', H1, '4m', { r: 1, u: '7p' }, '8,000 5/30 立直,平和,断么九'],
  ['裏 立直なし', H1, '4m', { u: '7p' }, 'E:flags'],
  ['嵌張 3m 子ロン', H1, '3m', {}, '1,300 1/40 断么九'],
  ['嵌張 3m 子ツモ', H1, '3m', { t: 1 }, '500-1,000 2/30 門前清自摸和,断么九'],
  ['海底 ツモ', H1, '4m', { t: 1, hai: 1 }, '1,300-2,600 4/20 海底摸月,門前清自摸和,平和,断么九'],
  ['河底 ロン', H1, '4m', { hou: 1 }, '3,900 3/30 河底撈魚,平和,断么九'],
  ['槍槓 ロン', H1, '4m', { chan: 1 }, '3,900 3/30 槍槓,平和,断么九'],
  ['本場2 ロン', H1, '4m', { hb: 2 }, '2,000 2/30 平和,断么九', '放銃者:2600x1 計2600'],
  ['本場1 子ツモ', H1, '4m', { t: 1, hb: 1 }, '700-1,300 3/20 門前清自摸和,平和,断么九', '親:1400x1 子（各）:800x2 計3000'],
  ['本場1 1500 ロン', H1, '4m', { hb: 1, rules: { players: 4, honba: 1500 } }, '2,000 2/30 平和,断么九', '放銃者:3500x1 計3500'],
  ['本場1 1500 子ツモ', H1, '4m', { t: 1, hb: 1, rules: { players: 4, honba: 1500 } }, '700-1,300 3/20 門前清自摸和,平和,断么九', '親:1800x1 子（各）:1200x2 計4200'],
  ['供託1', H1, '4m', { kyo: 1 }, '2,000 2/30 平和,断么九', '放銃者:2000x1 計2000 供1000'],
  ['供託2 本場1 親ロン', H1, '4m', { oya: 1, kyo: 2, hb: 1 }, '2,900 2/30 平和,断么九', '放銃者:3200x1 計3200 供2000'],
  ['喰いタン off でも門前は断么九', H1, '4m', { rules: { players: 4, kuitan: false } }, '2,000 2/30 平和,断么九'],
  // 高い方の取り方
  ['両面と辺張 → 両面（平和）', H2, '3m', {}, '1,000 1/30 平和'],
  ['両面と辺張 ツモ → 平和ツモ', H2, '3m', { t: 1 }, '400-700 2/20 門前清自摸和,平和'],
  ['両面と辺張 親ロン', H2, '3m', { oya: 1 }, '1,500 1/30 平和'],
  ['辺張だけ 3m', '123m456p678s789s22p', '3m', { r: 1 }, '1,300 1/40 立直'],
  ['同じ手 1m は両面', '123m456p678s789s22p', '1m', { r: 1 }, '2,000 2/30 立直,平和'],
  ['刻子と順子のどちらにも取れる 2m', '222234m456p678s88s', '2m', {}, '1,300 1/40 断么九'],
  ['刻子と順子 2m ツモ', '222234m456p678s88s', '2m', { t: 1 }, '500-1,000 2/30 門前清自摸和,断么九'],
  // 喰い
  ['喰いタン ロン＝喰い平和形30符', '567m345p678s88p', '5m', { m: ['chi:234m'] }, '1,000 1/30 断么九'],
  ['喰いタン off', '567m345p678s88p', '5m', { m: ['chi:234m'], rules: { players: 4, kuitan: false } }, 'E:no_yaku'],
  ['喰いタン ツモ', '567m345p678s88p', '5m', { m: ['chi:234m'], t: 1 }, '300-500 1/30 断么九'],
  ['立直にチー', '567m345p678s88p', '5m', { m: ['chi:234m'], r: 1 }, 'E:flags'],
  // 役牌
  ['白 暗刻 ロン', '234m456p789s555z99m', '9s', {}, '1,300 1/40 白'],
  ['白 暗刻 ツモ', '234m456p789s555z99m', '9s', { t: 1 }, '500-1,000 2/30 門前清自摸和,白'],
  ['白 ポン ロン', '234m456p789s99m', '9s', { m: ['pon:555z'] }, '1,000 1/30 白'],
  ['白 暗槓 ロン', '234m456p789s99m', '9s', { m: ['ankan:5555z'] }, '2,300 1/70 白'],
  ['白 明槓 ロン', '234m456p789s99m', '9s', { m: ['minkan:5555z'] }, '1,300 1/40 白'],
  ['白 暗槓 嶺上ツモ', '234m456p789s99m', '9s', { m: ['ankan:5555z'], t: 1, rin: 1 }, '2,000-3,900 3/60 嶺上開花,門前清自摸和,白'],
  ['ドラ 中→白', '234m456p789s555z99m', '9s', { d: '7z' }, '8,000 4/40 白'],
  ['東 親（場風と自風）', '234m456p789s111z99m', '9s', { oya: 1 }, '3,900 2/40 場風 東,自風 東'],
  ['東 子（場風だけ）', '234m456p789s111z99m', '9s', {}, '1,300 1/40 場風 東'],
  ['南 自風', '234m456p789s222z99m', '9s', {}, '1,300 1/40 自風 南'],
  ['南 場風（自風 西）', '234m456p789s222z99m', '9s', { b: '2z', j: '3z' }, '1,300 1/40 場風 南'],
  ['西 子の南家＝役なし', '234m456p789s333z99m', '9s', {}, 'E:no_yaku'],
  ['西 ドラだけ', '234m456p789s333z99m', '9s', { d: '2z' }, 'E:no_yaku'],
  ['中 ポン 么九の明刻', '234m456p678s88p', '4m', { m: ['pon:777z'] }, '1,000 1/30 中'],
  // 雀頭の符
  ['連風の雀頭 4符 親ロン', '234m456p789s123s11z', '1s', { oya: 1, r: 1 }, '2,000 1/40 立直'],
  ['連風4符 親ツモ（嵌張・暗刻）', '234m555p789s123s11z', '2s', { oya: 1, r: 1, t: 1 }, '1,300オール 2/40 立直,門前清自摸和'],
  ['連風2符 親ツモ（同じ手）', '234m555p789s123s11z', '2s', { oya: 1, r: 1, t: 1, rules: { players: 4, renpu_fu: 2 } }, '1,000オール 2/30 立直,門前清自摸和'],
  ['三元牌の雀頭 2符', '234m456p789s123s55z', '1s', { r: 1 }, '1,300 1/40 立直'],
  ['客風の雀頭は平和', '234m456p789s123s33z', '1s', { r: 1 }, '2,000 2/30 立直,平和'],
  ['単騎 2符', '234m456p789s123s33z', '3z', { r: 1 }, '1,300 1/40 立直'],
  // 七対子・二盃口
  ['七対子 立直 ロン', '1122m3344p5566s77z', '7z', { r: 1 }, '3,200 3/25 立直,七対子'],
  ['七対子 ツモ', '1122m3344p5566s77z', '7z', { t: 1 }, '800-1,600 3/25 門前清自摸和,七対子'],
  ['七対子 立直ツモ ドラ2', '1122m3344p5566s77z', '7z', { r: 1, t: 1, d: '1m' }, '3,000-6,000 6/25 立直,門前清自摸和,七対子'],
  ['七対子 断么九', '2233m4466p5588s77s', '7s', {}, '3,200 3/25 七対子,断么九'],
  ['七対子 断么九 喰いタン off', '2233m4466p5588s77s', '7s', { rules: { players: 4, kuitan: false } }, '3,200 3/25 七対子,断么九'],
  ['七対子に同じ牌4枚＝和了でない', '1111m3344p5566s77z', '7z', {}, 'E:not_agari'],
  ['七対子 混一色', '1133557799m1122z', '2z', {}, '8,000 5/25 七対子,混一色'],
  ['二盃口と七対子 → 二盃口', '223344m556677p88s', '8s', {}, '8,000 4/40 二盃口,断么九'],
  ['二盃口 清一色 と七対子', '11223355778899m', '5m', {}, '16,000 9/40 二盃口,清一色'],
  ['一盃口 平和 断么九', '223344m567p678s55s', '2m', {}, '3,900 3/30 一盃口,平和,断么九'],
  ['一盃口は鳴くと無い', '567p678s55s', '5p', { m: ['chi:234m', 'chi:234m'] }, '1,000 1/30 断么九'],
  // 三色・一通・帯么九
  ['三色同順 平和', '123m123p123s456m99p', '4m', {}, '3,900 3/30 三色同順,平和'],
  ['三色同順 鳴き 1翻', '123m123p456m99p', '4m', { m: ['chi:123s'] }, '1,000 1/30 三色同順'],
  ['一気通貫 平和', '123456789m234p55s', '1m', {}, '3,900 3/30 一気通貫,平和'],
  ['一気通貫 鳴き 1翻', '123456m234p55s', '1m', { m: ['chi:789m'] }, '1,000 1/30 一気通貫'],
  ['混全帯么九', '123m999m789p789s33z', '9p', {}, '2,600 2/40 混全帯么九'],
  ['純全帯么九', '123m999m789p789s11p', '9p', {}, '5,200 3/40 純全帯么九'],
  ['純全帯么九 鳴き 2翻', '999m789p789s11p', '9p', { m: ['chi:123m'] }, '2,000 2/30 純全帯么九'],
  // 刻子の役
  ['対々和 断么九 ロン（シャンポンは明刻）', '444s888s55p', '8s', { m: ['pon:222m', 'pon:777p'] }, '3,900 3/30 対々和,断么九'],
  ['対々和 断么九 ツモ', '444s888s55p', '8s', { m: ['pon:222m', 'pon:777p'], t: 1 }, '1,300-2,600 3/40 対々和,断么九'],
  ['三暗刻', '222m444p666s789s99m', '9s', {}, '3,200 2/50 三暗刻'],
  ['シャンポンのロン＝三暗刻にならない', '222m444p666s345s88m', '6s', { r: 1 }, '2,600 2/40 立直,断么九'],
  ['シャンポンのツモ＝三暗刻', '222m444p666s345s88m', '6s', { r: 1, t: 1 }, '2,000-4,000 5/40 立直,門前清自摸和,三暗刻,断么九'],
  ['三色同刻 三暗刻 断么九', '222m222p222s345m88s', '5m', {}, '8,000 5/50 三暗刻,三色同刻,断么九'],
  ['三槓子 三暗刻 120符（4a-0 の例）', '234s11z', '1z', { oya: 1, m: ['ankan:1111m', 'ankan:9999m', 'ankan:5555p'] }, '12,000 4/120 三暗刻,三槓子'],
  ['混老頭 対々和 三暗刻 場風', '111m999p999s111z11s', '9s', {}, '12,000 7/60 三暗刻,対々和,混老頭,場風 東'],
  ['同じ手 ツモ＝四暗刻', '111m999p999s111z11s', '9s', { t: 1 }, '8,000-16,000 Y1 四暗刻'],
  ['混老頭 対々和 鳴き', '111z999s11p', '1p', { m: ['pon:111m', 'pon:999p'] }, '8,000 5/50 対々和,混老頭,場風 東'],
  ['小三元', '234m567p555z666z77z', '4m', {}, '8,000 4/50 小三元,白,發'],
  ['混一色 白', '123m345m678m555z22z', '6m', {}, '8,000 4/40 混一色,白'],
  ['混一色 鳴き', '123m345m678m22z', '6m', { m: ['pon:555z'] }, '3,900 3/30 混一色,白'],
  ['清一色 平和', '123m345m567m789m99m', '9m', {}, '12,000 7/30 平和,清一色'],
  ['清一色 鳴き 5翻', '345m567m789m99m', '9m', { m: ['chi:123m'] }, '8,000 5/30 清一色'],
  // 符
  ['暗槓 中張 ロン', '234m678s345s88p', '2m', { m: ['ankan:5555p'] }, '1,600 1/50 断么九'],
  ['明槓 中張 ツモ', '234m678s345s88p', '2m', { m: ['minkan:5555p'], t: 1 }, '300-500 1/30 断么九'],
  ['3翻60符', '111m999p111z456s55s', '4s', {}, '7,700 3/60 三暗刻,場風 東'],
  ['3翻60符 切り上げ', '111m999p111z456s55s', '4s', { rules: { players: 4, kiriage: true } }, '8,000 3/60 三暗刻,場風 東'],
  // 数え・三倍満
  ['三倍満 11翻', '11223355778899m', '5m', { r: 1, t: 1 }, '6,000-12,000 11/30 二盃口,清一色,立直,門前清自摸和'],
  ['数え役満 13翻', '11223355778899m', '5m', { r: 1, t: 1, d: '4m' }, '8,000-16,000 13/30 二盃口,清一色,立直,門前清自摸和'],
  ['三倍満止め 13翻', '11223355778899m', '5m', { r: 1, t: 1, d: '4m', rules: { players: 4, kazoe: 'sanbai' } }, '6,000-12,000 13/30 二盃口,清一色,立直,門前清自摸和'],
  // ドラの折り返し
  ['ドラ 9m→1m', H2, '3m', { r: 1, d: '9m' }, '3,900 3/30 立直,平和'],
  ['ドラ 北→東', '234m456p789s123s11z', '1s', { oya: 1, r: 1, d: '4z' }, '7,700 3/40 立直'],
  ['ドラ 9p→1p', S3, '9s', { r: 1, d: '9p' }, '2,600 2/40 立直'],
  // 役満
  ['国士無双', '119m19p19s1234567z', '9m', {}, '32,000 Y1 国士無双'],
  ['国士無双13面', '119m19p19s1234567z', '1m', {}, '64,000 Y2 国士無双13面'],
  ['国士無双13面 ダブルなし', '119m19p19s1234567z', '1m', { rules: { players: 4, double_yakuman: false } }, '32,000 Y1 国士無双13面'],
  ['国士無双 親ロン', '119m19p19s1234567z', '9m', { oya: 1 }, '48,000 Y1 国士無双'],
  ['四暗刻 ツモ', '222m444p666s888s99m', '8s', { t: 1 }, '8,000-16,000 Y1 四暗刻'],
  ['四暗刻 シャンポンのロン＝三暗刻 対々和', '222m444p666s888s99m', '8s', {}, '8,000 4/50 三暗刻,対々和'],
  ['四暗刻単騎 ロン', '222m444p666s888s99m', '9m', {}, '64,000 Y2 四暗刻単騎'],
  ['四暗刻単騎 ダブルなし', '222m444p666s888s99m', '9m', { rules: { players: 4, double_yakuman: false } }, '32,000 Y1 四暗刻単騎'],
  ['大三元', '555z666z777z123m44p', '4p', {}, '32,000 Y1 大三元'],
  ['字一色', '222z555z666z77z', '2z', { m: ['pon:111z'] }, '32,000 Y1 字一色'],
  ['字一色 七対子', '11223344556677z', '7z', {}, '32,000 Y1 字一色'],
  ['緑一色', '234s234s666s888s66z', '6z', {}, '32,000 Y1 緑一色'],
  ['清老頭', '111s999s99m', '9s', { m: ['pon:111m', 'pon:999p'] }, '32,000 Y1 清老頭'],
  ['四槓子', '66p', '6p', { m: ['minkan:2222m', 'ankan:3333p', 'minkan:4444s', 'ankan:5555s'] }, '32,000 Y1 四槓子'],
  ['小四喜', '234m111z222z333z44z', '4m', {}, '32,000 Y1 小四喜'],
  ['大四喜', '333z444z55m', '5m', { m: ['pon:111z', 'pon:222z'] }, '64,000 Y2 大四喜'],
  ['大四喜 ダブルなし', '333z444z55m', '5m', { m: ['pon:111z', 'pon:222z'], rules: { players: 4, double_yakuman: false } }, '32,000 Y1 大四喜'],
  ['純正九蓮宝燈', '11123455678999m', '5m', {}, '64,000 Y2 純正九蓮宝燈'],
  ['九蓮宝燈', '11123455678999m', '2m', {}, '32,000 Y1 九蓮宝燈'],
  ['天和', H1, '4m', { oya: 1, t: 1, ten: 1 }, '16,000オール Y1 天和'],
  ['地和', H1, '4m', { t: 1, chii: 1 }, '8,000-16,000 Y1 地和'],
  ['天和 四暗刻 複合', '222m444p666s888s99m', '8s', { oya: 1, t: 1, ten: 1 }, '32,000オール Y2 四暗刻,天和'],
  ['天和 四暗刻 ダブルなし＝1倍', '222m444p666s888s99m', '8s', { oya: 1, t: 1, ten: 1, rules: { players: 4, double_yakuman: false } }, '16,000オール Y1 四暗刻,天和'],
  ['大三元 字一色 複合', '666z777z111z22z', '2z', { m: ['pon:555z'] }, '64,000 Y2 大三元,字一色'],
  ['大三元 字一色 ダブルなし', '666z777z111z22z', '2z', { m: ['pon:555z'], rules: { players: 4, double_yakuman: false } }, '32,000 Y1 大三元,字一色'],
  // 3人
  ['3人 ロン', S3, '9s', { r: 1, rules: R3 }, '1,300 1/40 立直'],
  ['3人 ドラ 1m→9m', S3, '9s', { r: 1, d: '1m', rules: R3 }, '5,200 3/40 立直'],
  ['3人 ドラ 9m→1m', S3, '9s', { r: 1, d: '9m', rules: R3 }, '8,000 4/40 立直'],
  ['3人 北抜き1', S3, '9s', { r: 1, kita: 1, rules: R3 }, '2,600 2/40 立直'],
  ['3人 北抜き2 ドラ 西→北', S3, '9s', { r: 1, kita: 2, d: '3z', rules: R3 }, '8,000 5/40 立直'],
  ['3人 北抜きだけ＝役なし', S3, '9s', { kita: 1, rules: R3 }, 'E:no_yaku'],
  ['3人 ツモ損 本場1', S3, '9s', { r: 1, t: 1, hb: 1, rules: R3 }, '500-1,000 2/30 立直,門前清自摸和', '親:1100x1 子（各）:600x1 計1700'],
  ['3人 折半 本場1', S3, '9s', { r: 1, t: 1, hb: 1, rules: R3H }, '800-1,300 2/30 立直,門前清自摸和', '親:1400x1 子（各）:900x1 計2300'],
  ['3人 ツモ損 親満貫', S3, '9s', { oya: 1, r: 1, ip: 1, t: 1, d: '1m', rules: R3 }, '4,000オール 5/30 立直,一発,門前清自摸和', '子（各）:4000x2 計8000'],
  ['3人 折半 親満貫', S3, '9s', { oya: 1, r: 1, ip: 1, t: 1, d: '1m', rules: R3H }, '6,000オール 5/30 立直,一発,門前清自摸和', '子（各）:6000x2 計12000'],
  ['3人 北抜きの嶺上＋一発は通す', S3, '9s', { r: 1, ip: 1, rin: 1, t: 1, kita: 1, rules: R3 }, '2,000-4,000 5/30 立直,一発,門前清自摸和,嶺上開花'],
  ['3人 北の暗刻は役牌でない', '111m123p456p444z99m', '9m', { r: 1, rules: R3 }, '1,600 1/50 立直'],
  ['4人 自風 北の暗刻', '111m123p456p444z99m', '9m', { r: 1, j: '4z' }, '3,200 2/50 立直,自風 北'],
  ['3人 自風 北', S3, '9s', { r: 1, j: '4z', rules: R3 }, 'E:flags'],
  ['3人 場風 北', S3, '9s', { r: 1, b: '4z', rules: R3 }, 'E:flags'],
  ['3人 チー', '123p456p789s99m', '9s', { m: ['chi:123s'], rules: R3 }, 'E:sanma'],
  ['3人 5m が手に', H1, '4m', { rules: R3 }, 'E:sanma'],
  ['3人 ドラ表示 5m', S3, '9s', { r: 1, d: '5m', rules: R3 }, 'E:sanma'],
  ['3人 北抜き＋手の北で5枚', '111m123p456p444z99m', '9m', { r: 1, kita: 2, rules: R3 }, 'E:over4'],
  ['3人 北抜きなしのルール', S3, '9s', { r: 1, kita: 1, rules: { players: 3, kita: 'none' } }, 'E:flags'],
  ['3人 北抜き1 の天和', S3, '9s', { oya: 1, t: 1, ten: 1, kita: 1, rules: R3 }, 'E:flags'],
  // 包
  ['包 子ツモ 責任者 子', '123m44p', '4p', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' } }, '8,000-16,000 Y1 大三元', '責任者:32000x1 親:0x1 子（各）:0x1 計32000'],
  ['包 子ツモ 責任者 親', '123m44p', '4p', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'oya' } }, '8,000-16,000 Y1 大三元', '責任者:32000x1 子（各）:0x2 計32000'],
  ['包 親ツモ', '123m44p', '4p', { m: DSG, t: 1, oya: 1, pao: { yaku: 'daisangen' } }, '16,000オール Y1 大三元', '責任者:48000x1 子（各）:0x2 計48000'],
  ['包 ロン（放銃者と責任者が別）', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisangen', same: false } }, '32,000 Y1 大三元', '放銃者:16000x1 責任者:16000x1 計32000'],
  ['包 ロン（放銃者が責任者）', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisangen', same: true } }, '32,000 Y1 大三元', '放銃者（責任者）:32000x1 計32000'],
  ['包 3人ツモ損 子ツモ', '123p44s', '4s', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: R3 }, '8,000-16,000 Y1 大三元', '責任者:24000x1 親:0x1 計24000'],
  ['包 3人折半 子ツモ', '123p44s', '4s', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: R3H }, '12,000-20,000 Y1 大三元', '責任者:32000x1 親:0x1 計32000'],
  ['包 3人折半 子ツモ 責任者 親', '123p44s', '4s', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'oya' }, rules: R3H }, '12,000-20,000 Y1 大三元', '責任者:32000x1 子（各）:0x1 計32000'],
  ['包 複合 子ロン', '111z22z', '2z', { m: DSG, pao: { yaku: 'daisangen', same: false } }, '64,000 Y2 大三元,字一色', '放銃者:48000x1 責任者:16000x1 計64000'],
  ['包 複合 子ツモ 責任者 親', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'oya' } }, '16,000-32,000 Y2 大三元,字一色', '責任者:48000x1 子（各）:8000x2 計64000'],
  ['包 複合 子ツモ 責任者 子', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' } }, '16,000-32,000 Y2 大三元,字一色', '責任者:40000x1 親:16000x1 子（各）:8000x1 計64000'],
  ['包 複合 ダブルなし＝全部責任者の分', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: { players: 4, double_yakuman: false } }, '8,000-16,000 Y1 大三元,字一色', '責任者:32000x1 親:0x1 子（各）:0x1 計32000'],
  ['包 大四喜 ダブル ロン', '55m', '5m', { m: ['pon:111z', 'pon:222z', 'pon:333z', 'pon:444z'], pao: { yaku: 'daisuushii', same: false } }, '64,000 Y2 大四喜', '放銃者:32000x1 責任者:32000x1 計64000'],
  ['包 大四喜 ダブルなし ロン', '55m', '5m', { m: ['pon:111z', 'pon:222z', 'pon:333z', 'pon:444z'], pao: { yaku: 'daisuushii', same: false }, rules: { players: 4, double_yakuman: false } }, '32,000 Y1 大四喜', '放銃者:16000x1 責任者:16000x1 計32000'],
  ['包 本場2 子ツモ', '123m44p', '4p', { m: DSG, t: 1, hb: 2, pao: { yaku: 'daisangen', who: 'ko' } }, '8,000-16,000 Y1 大三元', '責任者:32600x1 親:0x1 子（各）:0x1 計32600'],
  ['包 本場1 3人ツモ損', '123p44s', '4s', { m: DSG, t: 1, hb: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: R3 }, '8,000-16,000 Y1 大三元', '責任者:24200x1 親:0x1 計24200'],
  ['包 本場1 ロン（本場は放銃者）', '123m44p', '4p', { m: DSG, hb: 1, pao: { yaku: 'daisangen', same: false } }, '32,000 Y1 大三元', '放銃者:16300x1 責任者:16000x1 計32300'],
  ['包 四槓子 ロン', '66p', '6p', { m: ['minkan:2222m', 'ankan:3333p', 'minkan:4444s', 'ankan:5555s'], pao: { yaku: 'suukantsu', same: false } }, '32,000 Y1 四槓子', '放銃者:16000x1 責任者:16000x1 計32000'],
  ['包 四槓子 全部暗槓', '66p', '6p', { m: ['ankan:2222m', 'ankan:3333p', 'ankan:4444s', 'ankan:5555s'], pao: { yaku: 'suukantsu', same: false } }, 'E:flags'],
  ['包 3人折半 複合 子ツモ 責任者 子', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: R3H }, '24,000-40,000 Y2 大三元,字一色', '責任者:44000x1 親:20000x1 計64000'],
  ['包 3人折半 複合 子ツモ 責任者 親', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'oya' }, rules: R3H }, '24,000-40,000 Y2 大三元,字一色', '責任者:52000x1 子（各）:12000x1 計64000'],
  ['包 3人ツモ損 複合 子ツモ 責任者 子', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'ko' }, rules: R3 }, '16,000-32,000 Y2 大三元,字一色', '責任者:32000x1 親:16000x1 計48000'],
  ['包 3人ツモ損 複合 子ツモ 責任者 親', '111z22z', '2z', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'oya' }, rules: R3 }, '16,000-32,000 Y2 大三元,字一色', '責任者:40000x1 子（各）:8000x1 計48000'],
  ['包 大四喜 風の1組が手の中', '444z55m', '5m', { m: ['pon:111z', 'pon:222z', 'pon:333z'], pao: { yaku: 'daisuushii', same: false } }, 'E:flags'],
  ['包 大四喜 全部暗槓', '55m', '5m', { m: ['ankan:1111z', 'ankan:2222z', 'ankan:3333z', 'ankan:4444z'], pao: { yaku: 'daisuushii', same: false } }, 'E:flags'],
  ['包 三元牌が全部手の中', '555z666z777z123m44p', '4p', { pao: { yaku: 'daisangen', same: false } }, 'E:flags'],
  ['包 大四喜の包を大三元の手に', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisuushii', same: false } }, 'E:flags'],
  ['包 ロンで same 無し', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisangen' } }, 'E:flags'],
  ['包 ツモで same 在り', '123m44p', '4p', { m: DSG, t: 1, pao: { yaku: 'daisangen', same: false, who: 'ko' } }, 'E:flags'],
  ['包 子ツモで who 無し', '123m44p', '4p', { m: DSG, t: 1, pao: { yaku: 'daisangen' } }, 'E:flags'],
  ['包 子ツモで who が変', '123m44p', '4p', { m: DSG, t: 1, pao: { yaku: 'daisangen', who: 'x' } }, 'E:flags'],
  ['包 ロンで who 在り', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisangen', same: false, who: 'ko' } }, 'E:flags'],
  ['包 親ツモで who 在り', '123m44p', '4p', { m: DSG, t: 1, oya: 1, pao: { yaku: 'daisangen', who: 'ko' } }, 'E:flags'],
  ['包 ルールで包なし', '123m44p', '4p', { m: DSG, pao: { yaku: 'daisangen', same: false }, rules: { players: 4, pao: false } }, 'E:flags'],
  ['包 役の名が変', '123m44p', '4p', { m: DSG, pao: { yaku: 'x', same: false } }, 'E:flags'],
  // あり得ない組み
  ['立直に明槓', '234m456p789s99m', '9s', { r: 1, m: ['minkan:5555z'] }, 'E:flags'],
  ['立直にチー', '234m456p99m', '9m', { r: 1, m: ['chi:678s', 'chi:789s'] }, 'E:flags'],
  ['嶺上と槍槓', '234m456p789s99m', '9s', { m: ['ankan:5555z'], rin: 1, chan: 1 }, 'E:flags'],
  ['嶺上と河底', '234m456p789s99m', '9s', { m: ['ankan:5555z'], rin: 1, hou: 1 }, 'E:flags'],
  ['海底と河底', H1, '4m', { hai: 1, hou: 1 }, 'E:flags'],
  ['槍槓と海底', H1, '4m', { chan: 1, hai: 1 }, 'E:flags'],
  ['天和に一発（立直つき＝天和の項で止まる）', H1, '4m', { oya: 1, t: 1, ten: 1, r: 1, ip: 1 }, 'E:flags'],
  ['地和に海底', H1, '4m', { t: 1, chii: 1, hai: 1 }, 'E:flags'],
  ['地和に一発（立直つき）', H1, '4m', { t: 1, chii: 1, r: 1, ip: 1 }, 'E:flags'],
  ['地和に嶺上', '234m456p789s99m', '9s', { t: 1, chii: 1, rin: 1, m: ['ankan:5555z'] }, 'E:flags'],
  ['天和に嶺上', '234m456p789s99m', '9s', { oya: 1, t: 1, ten: 1, rin: 1, m: ['ankan:5555z'] }, 'E:flags'],
  ['天和に海底', H1, '4m', { oya: 1, t: 1, ten: 1, hai: 1 }, 'E:flags'],
  ['地和に河底', H1, '4m', { t: 1, chii: 1, hou: 1 }, 'E:flags'],
  ['地和に槍槓', H1, '4m', { chii: 1, chan: 1 }, 'E:flags'],
  ['地和にロン', H1, '4m', { chii: 1 }, 'E:flags'],
  ['3人 槓も北抜きも無い嶺上', S3, '9s', { t: 1, rin: 1, rules: R3 }, 'E:flags'],
  ['3人 kita=0 の一発と嶺上（槓は一発を消す）', '123p456p789s99m', '9s', { m: ['ankan:1111m'], r: 1, ip: 1, t: 1, rin: 1, rules: R3 }, 'E:flags'],
  ['一発に立直なし', H1, '4m', { ip: 1 }, 'E:flags'],
  ['海底にロン', H1, '4m', { hai: 1 }, 'E:flags'],
  ['河底にツモ', H1, '4m', { t: 1, hou: 1 }, 'E:flags'],
  ['槍槓にツモ', H1, '4m', { t: 1, chan: 1 }, 'E:flags'],
  ['嶺上にロン', '234m456p789s99m', '9s', { m: ['ankan:5555z'], rin: 1 }, 'E:flags'],
  ['嶺上に槓なし', H1, '4m', { t: 1, rin: 1 }, 'E:flags'],
  ['一発と嶺上 4人（槓は一発を消す）', '234m456p789s99m', '9s', { m: ['ankan:5555z'], r: 1, ip: 1, t: 1, rin: 1 }, 'E:flags'],
  ['嶺上と海底', '234m456p789s99m', '9s', { m: ['ankan:5555z'], t: 1, rin: 1, hai: 1 }, 'E:flags'],
  ['槍槓と河底', H1, '4m', { chan: 1, hou: 1 }, 'E:flags'],
  ['天和と地和', H1, '4m', { oya: 1, t: 1, ten: 1, chii: 1 }, 'E:flags'],
  ['天和に子', H1, '4m', { t: 1, ten: 1 }, 'E:flags'],
  ['地和に親', H1, '4m', { oya: 1, t: 1, chii: 1 }, 'E:flags'],
  ['天和にロン', H1, '4m', { oya: 1, ten: 1 }, 'E:flags'],
  ['天和に立直', H1, '4m', { oya: 1, t: 1, ten: 1, r: 1 }, 'E:flags'],
  ['天和に暗槓', '234m456p789s99m', '9s', { oya: 1, t: 1, ten: 1, m: ['ankan:5555z'] }, 'E:flags'],
  ['立直にポン', '234m456p789s99m', '9s', { r: 1, m: ['pon:555z'] }, 'E:flags'],
  ['立直に暗槓は通す', '234m456p789s99m', '9s', { r: 1, m: ['ankan:5555z'] }, '4,500 2/70 立直,白'],
  ['4人で北抜き', H1, '4m', { kita: 1 }, 'E:flags'],
  ['場風 5z', H1, '4m', { b: '5z' }, 'E:flags'],
  ['立直 3', H1, '4m', { r: 3 }, 'E:flags'],
  // 枚数・名前・赤
  ['13枚', '234567m345p678s8p', '4m', {}, 'E:count'],
  ['和了牌が手に無い', H1, '1m', {}, 'E:count'],
  ['牌の名前が変（8z）', '234567m345p678s88z', '4m', {}, 'E:count'],
  ['チーが順子でない', '567m345p678s88p', '5m', { m: ['chi:124m'] }, 'E:count'],
  ['ポンが同じ牌でない', '567m345p678s88p', '5m', { m: ['pon:223m'] }, 'E:count'],
  ['字のチー', '567m345p678s88p', '5m', { m: ['chi:123z'] }, 'E:count'],
  ['同じ牌5枚（暗槓＋ドラ表示）', '444p666s888s99m', '9m', { m: ['ankan:2222m'], d: '2m' }, 'E:over4'],
  ['ドラ表示2枚 槓なし', H1, '4m', { d: '1m2m' }, 'E:dora'],
  ['裏表示2枚 槓なし', H1, '4m', { r: 1, u: '1m2m' }, 'E:dora'],
  ['ドラ表示2枚 槓1つ', '234m456p789s99m', '9s', { m: ['ankan:5555z'], d: '1p9p' }, '2,300 1/70 白'],
  ['赤の名前 0m', '234067m345p678s88p', '4m', {}, 'E:aka'],
  ['赤 aka=4（筒は2枚まで）3枚', '234m555p678s345s88p', '3s', { r: 1, aka: 3, rules: { players: 4, aka: 4 } }, '8,000 5/40 立直,断么九'],
  ['赤 aka=4 4枚＝上限超え', '234m555p678s345s88p', '3s', { r: 1, aka: 4, rules: { players: 4, aka: 4 } }, 'E:aka'],
  ['赤 aka=4（索は1枚まで）5索2枚で赤2＝上限超え', '234m678p345s567s88p', '3s', { r: 1, aka: 2, rules: { players: 4, aka: 4 } }, 'E:aka'],
  ['赤 aka=3 筒は1枚まで 2枚', '234m555p678s678s88p', '2m', { r: 1, aka: 2, rules: { players: 4, aka: 3 } }, 'E:aka'],
  ['和了の形でない', '123m456p789s12s355z', '1s', {}, 'E:not_agari'],
];

function run(score) {
  const bad = [];
  let n = 0;
  for (const [desc, hand, win, o, want, wantPay] of ROWS) {
    const rules = o.rules || R4;
    let r;
    try { r = score(inp(hand, win, o), rules); } catch (e) { r = { ok: false, err: 'throw ' + e.message }; }
    n++;
    const got = show(r);
    if (got !== norm(want)) bad.push(`${desc}: 出た ${got} ／ 正 ${want}`);
    if (wantPay) {
      n++;
      const gp = r.ok ? payStr(r.pay) : 'E';
      if (gp !== wantPay) bad.push(`${desc}（払い）: 出た ${gp} ／ 正 ${wantPay}`);
    }
    // 包は払う人を替えるだけ＝合計は包なしと同じ（どの包の行も見る）
    if (r.ok && o.pao) {
      n++;
      const r0 = score(inp(hand, win, { ...o, pao: undefined }), rules);
      if (!r0.ok || r0.pay.total !== r.pay.total) bad.push(`${desc}（包の合計＝包なし）: 包 ${r.pay.total} ／ 包なし ${r0.ok ? r0.pay.total : r0.err}`);
    }
  }
  return { n, bad };
}

const ROW_FLOOR = 200;

if (process.argv.includes('--self-test')) {
  // lib/score.mjs の式を1つずつ壊した写しを流す＝全部赤（bad>0）でないと見張りが空振りしている
  const src = readFileSync(join(LIB, 'score.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const BREAKS = [
    ['平和の判定（両面を見ない）', "form.wait === 'ryanmen' && !inp.rinshan", '!inp.rinshan'],
    ['符の切り上げ（切り捨てに）', 'fu = Math.ceil(raw / 10) * 10;', 'fu = Math.floor(raw / 10) * 10;'],
    ['高点法の比べ（安い方を取る）', 'r.pts.total > best.pts.total', 'r.pts.total < best.pts.total'],
    ['ドラの折り返し（9 の次）', 'return i - (i % 9) + ((i % 9) + 1) % 9;', 'return i + 1;'],
    ['3人の 1m 表示→9m', 'if (players === 3 && i === 0) return 8;', ''],
    ['役満の2倍（国士13面）', "'国士無双13面', mult: R.double_yakuman ? 2 : 1", "'国士無双13面', mult: 1"],
    ['喰い下がり', 'const k = (h) => (menzen ? h : h - 1);', 'const k = (h) => h;'],
    ['シャンポンのロンは明刻', "open: j === k && wait === 'shanpon' && !ts", 'open: false'],
    ['包のツモ＝合計（ロンの値にする）', 'P.total + mine + hAll', 'P.ron + mine + hAll'],
    ['連風の符', 'pf += R.renpu_fu;', 'pf += 4;'],
    ['北抜きは一発を消さない', "(!three || inp.kita === 0), 'ippatsu-rinshan'", "true, 'ippatsu-rinshan'"],
    ['帯么九は順子が要る', 'if (shuns.length >= 1 && isYao(form.pair)', 'if (isYao(form.pair)'],
    ['3人の本場は1人あたり4人と同じ', 'hEach = unit * honba;', 'hEach = (unit * 3 * honba) / (n - 1);'],
    ['喰い平和形は30符', "fu = 30; fuParts.push({ name: '喰い平和形（30符）'", "fu = 20; fuParts.push({ name: '喰い平和形（30符）'"],
    ['赤の色ごとの上限', '4: [1, 2, 1] };', '4: [1, 2, 2] };'],
    ['包の R の責任者分（who で親子を分けない）', "const mine = Rp ? (pao.who === 'oya' ? Rp.oya : Rp.ko) : 0;", 'const mine = Rp ? Rp.ko : 0;'],
    ['大三元', "isDragon(s.idx)).length === 3) ym.push", "isDragon(s.idx)).length === 9) ym.push"],
    ['三色同刻2->1', "add('三色同刻', 2)", "add('三色同刻', 1)"],
    ['三槓子2->1', "add('三槓子', 2)", "add('三槓子', 1)"],
    ['混老頭2->1', "if (allIdx.every(isYao) && hasHonor) add('混老頭', 2);", "if (allIdx.every(isYao) && hasHonor) add('混老頭', 1);"],
    ['純全帯3->2', "add('純全帯么九', k(3))", "add('純全帯么九', k(2))"],
    ['本場ロン x3 -> x2', 'const hRon = unit * 3 * honba', 'const hRon = unit * 2 * honba'],
    ['天和なし', "inp.tenhou ? { name: '天和', mult: 1 }", "inp.tenhou ? null"],
    ['供託（1本 1,000 点）', 'return { rows, total, kyotaku: 1000 * kyotaku };', 'return { rows, total, kyotaku: 0 };'],
    ['包の who を見る', "if (ts && !oya && !['oya', 'ko'].includes(pao.who)) return fail('flags', 'pao-who');", ''],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'score-self-'));
  let caught = 0;
  const miss = [];
  try {
    for (const f of ['tiles.mjs', 'score-table.mjs']) writeFileSync(join(dir, f), readFileSync(join(LIB, f)));
    for (const [k, [name, from, to]] of BREAKS.entries()) {
      if (!src.includes(from)) { miss.push(`${name}：壊す字が見つからない`); continue; }
      const p = join(dir, `score-${k}.mjs`);
      writeFileSync(p, src.replace(from, to));
      const mod = await import(pathToFileURL(p).href);
      if (run(mod.score).bad.length > 0) caught++; else miss.push(`${name}：赤にならない`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`自己確認: ${caught}/${BREAKS.length}`); // CI は scripts/ci-yuka.sh で床を見る
  if (miss.length) { console.log('✗ 自己確認'); for (const m of miss) console.log('  ' + m); process.exit(1); }
  console.log(`✓ 自己確認：lib/score.mjs の式を ${BREAKS.length} か所壊して全部赤になった`);
  process.exit(0);
}

const { score } = await import('../lib/score.mjs');
const { n, bad } = run(score);
if (ROWS.length < ROW_FLOOR) bad.push(`正解表の行が ${ROWS.length}（床 ${ROW_FLOOR}）`);
if (bad.length) { console.log(`✗ 点数計算 ${bad.length}/${n} が違う`); for (const b of bad) console.log('  ' + b); process.exit(1); }
console.log(`✓ 点数計算 正解表 ${ROWS.length} 行（${n} か所）全部 同じ`);
console.log('KEKKA ' + JSON.stringify({ passed: n, failed: 0, mimiso: 0 }));
