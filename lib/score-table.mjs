/* score-table.mjs — ★翻と符から点を出す（早見表と点数計算の共通）★（設計図 v18.3 §計算の道具・tataki/keisan_sekkei_v1.md 件1）
 * =============================================================================
 * 基本点 b = 符 × 2^(翻+2)。満貫＝翻≥5 か b>2000（b を 2000 で止める）。
 *   切り上げ満貫（rules.kiriage=true）＝30符4翻・60符3翻（b=1920）を満貫にする。
 *   跳満 6〜7翻＝3000／倍満 8〜10＝4000／三倍満 11〜12＝6000／役満 13〜＝8000（数え役満）。
 *   rules.kazoe='sanbai'＝13翻以上も三倍満で止める。役の役満（国士など）は yakuman 回数で渡す（翻と別）。
 * 点（c100＝100点に切り上げ）：
 *   子ロン c100(4b)／親ロン c100(6b)／子ツモ 子 c100(b)・親 c100(2b)／親ツモ c100(2b) オール。
 * 3人（rules.players=3）：
 *   tsumo3='son'    ＝ツモ損：居ない北家の分を誰も払わない（1人あたりは4人と同じ）。ロンは4人と同じ。
 *   tsumo3='secchan'＝北家折半：卓で人が足す順と同じ＝4人の時の払い（100点に切り上げ済み）に、
 *                     居ない北家の払いの半分を足して、もう一度100点に切り上げる。
 *                     子ツモ＝親 c100(c100(2b) + c100(b)/2)・子 c100(c100(b) + c100(b)/2)
 *                     親ツモ＝子2人 c100(c100(2b) × 1.5)
 *                     例：子30符1翻 300-500 → 北家の300の半分150を足す → 500-700（合計1200）／子満貫 3000-5000。
 *                     （丸めの順の公開の拠り所は見つからなかった＝11-20 調べ。基本点のまま足す流儀だと 400-600 に割れる）
 * 「無い組み」は null（画面は「—」）：20符のロン・20符1翻のツモ・25符1翻・25符2翻のツモ。
 *   （平和ツモは必ず2翻以上・七対子は2翻で、ツモなら3翻以上・ロンの最低は30符（七対子25符を除く））
 * 本場・供託はここでは足さない（早見表に出ない・点数計算の画面で足す）。
 */

export const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];

const c100 = (x) => Math.ceil(x / 100) * 100;

/** 無い組みか（その翻・符・ロンツモで和了の形が作れない） */
export function impossible(han, fu, tsumo) {
  if (fu === 20 && !tsumo) return true;
  if (fu === 20 && han === 1) return true;
  if (fu === 25 && han === 1) return true;
  if (fu === 25 && han === 2 && tsumo) return true;
  return false;
}

/** 基本点と名前（満貫以上は符を見ない）
 *  opts = { kiriage:false, kazoe:'yakuman', yakuman:0 }  yakuman＝役満の数（1＝役満・2＝ダブル役満…）
 */
export function basePoints(han, fu, opts = {}) {
  const kiriage = !!opts.kiriage;
  const kazoe = opts.kazoe || 'yakuman';
  const ym = opts.yakuman | 0;
  if (ym > 0) return { base: 8000 * ym, name: ym === 1 ? '役満' : ym === 2 ? 'ダブル役満' : ym + '倍役満' };
  if (!Number.isInteger(han) || han < 1) throw new Error('han');
  if (han >= 13) return kazoe === 'sanbai' ? { base: 6000, name: '三倍満' } : { base: 8000, name: '数え役満' };
  if (han >= 11) return { base: 6000, name: '三倍満' };
  if (han >= 8) return { base: 4000, name: '倍満' };
  if (han >= 6) return { base: 3000, name: '跳満' };
  if (han === 5) return { base: 2000, name: '満貫' };
  if (!FU_LIST.includes(fu)) throw new Error('fu');
  const b = fu * 2 ** (han + 2);
  if (b >= 2000) return { base: 2000, name: '満貫' };
  if (kiriage && b === 1920) return { base: 2000, name: '満貫' };
  return { base: b, name: '' };
}

/** 点（客に見える形）
 *  oya: 親か / tsumo: ツモか / rules: { players, tsumo3, kiriage, kazoe } / yakuman: 役満の数
 *  返し：null（無い組み）か
 *   ロン  { ron: 点, total: 点 }
 *   子ツモ { ko: 子1人, oya: 親, total }   親ツモ { all: 1人, total }
 *   どれも { base, name } を足して返す。
 */
export function points(han, fu, oya, tsumo, rules = {}, yakuman = 0) {
  if (!yakuman && han < 5 && impossible(han, fu, tsumo)) return null;
  const { base: b, name } = basePoints(han, fu, { kiriage: rules.kiriage, kazoe: rules.kazoe, yakuman });
  const n = rules.players === 3 ? 3 : 4;
  const sec = n === 3 && rules.tsumo3 === 'secchan';
  if (!tsumo) {
    const r = c100(oya ? 6 * b : 4 * b);
    return { ron: r, total: r, base: b, name };
  }
  if (oya) {
    const a4 = c100(2 * b);
    const all = sec ? c100(a4 * 1.5) : a4;
    return { all, total: all * (n - 1), base: b, name };
  }
  const k4 = c100(b), o4 = c100(2 * b);
  const ko = sec ? c100(k4 + k4 / 2) : k4;
  const op = sec ? c100(o4 + k4 / 2) : o4;
  return { ko, oya: op, total: op + ko * (n - 2), base: b, name };
}

/** 表の字（画面と試験が同じ字を見る）：ロン「3,900」／子ツモ「1,000-2,000」／親ツモ「1,300オール」／無い「—」 */
const fmt = (x) => x.toLocaleString('en-US');
export function label(p) {
  if (!p) return '—';
  if (p.ron != null) return fmt(p.ron);
  if (p.all != null) return fmt(p.all) + 'オール';
  return fmt(p.ko) + '-' + fmt(p.oya);
}

/** 満貫以上の段（早見表の下の表） */
export function limitRows(rules = {}) {
  const rows = [
    { name: '満貫', han: '5', h: 5 },
    { name: '跳満', han: '6〜7', h: 6 },
    { name: '倍満', han: '8〜10', h: 8 },
    { name: '三倍満', han: rules.kazoe === 'sanbai' ? '11〜' : '11〜12', h: 11 },
  ];
  /* 三倍満止めでも役の役満（国士など）はある＝段は消さない（13翻の数えだけ止まる） */
  rows.push(rules.kazoe === 'sanbai' ? { name: '役満', han: '役の役満', h: 0, ym: 1 } : { name: '役満', han: '13〜', h: 13 });
  return rows;
}
