/* rules.mjs — ★ルールの鍵の表と確かめ★（設計図 v15.8 §3・§4／段2 の案 rules_keys_sekkei.md v2）
 * =============================================================================
 * 倉庫の表 mahjong.mj_rule_keys と ★1字も違わない★（種は supabase/schema.sql の $rk$…$rk$ の1つの jsonb の字・
 * tests/rules-keys.test.mjs が CI で深く比べる）。確かめの手順は倉庫の mahjong_private.mj_rules_ok と同じ
 * （tests/rules.live.mjs が同じ入力の表を両方に通す）。★倉庫の答えが正★＝ここは画面の先回り。
 *
 * rulesOk(rules) → { ok: true, rules: 足りない鍵を players の既定で埋めた物 } か { ok: false, err: 鍵の名 }
 *   見る順（倉庫と同じ）：① object か（'(object)'）② 表に無い鍵（'(unknown)'）③ players（3 か 4 の数・必須）
 *   ④ 表の鍵を名の順（ASCII）に：無ければ既定で埋める・在れば型と範囲 ⑤ return_pts ≥ start_pts（'return_pts'）
 *   kind：int＝整数の数（字 "300" は弾く）・min〜max・step の倍数／enum＝vals のどれかと型ごと同じ／bool／
 *         uma＝長さ players の整数の並び・各 −999〜999・合計0・大きい順（同じは可）。nullable の鍵だけ null を通す。
 *   大きさ：通る物は鍵41個の小さい値だけ＝4KB を超えない（表の CHECK rule_sets_size_ok が網）。
 *
 * ★鍵を後から足す日の決まり★：新しい鍵の既定は「足す前の振る舞い」と同じ値に限る（古い rules_snapshot を
 *   既定で読んだ時に過去の pt が変わらない）。鍵の名を変える・消す日は、引っ越しの読み替え表（段2 の import）にも足す。
 *
 * 鍵の意味の決め（計算と画面が読む）：
 *   オカ＝鍵を持たない。トップに (return_pts − start_pts) × 人数 / 1000 pt（返し＝持ち点ならオカ無し）＝合計は必ず0。
 *   tie：kamicha＝同点は上家（hanchans.ton_order の順）が上の順位／split＝同点の人で、その順位のウマ・オカを合わせて
 *        0.1pt 単位で等しく割り、割り切れない 0.1pt は上家から1つずつ。
 *   tobi_from：busted＝飛んだ人が飛ばした人に tobi_pt／all＝飛んだ人が他の全員に tobi_pt ずつ。飛び賞は分けない
 *        （受け取りの選びの「全員から」＝all と同じ・v15.9）＝余りは出ず起家からの順は要らない（lib/needs-order.mjs）。
 *   hakoshita：false＝素点は0で止め、トップの pt＝他の人の pt の合計の逆（合計0）。
 *   round：gosha 五捨六入／shisha 四捨五入／kirisute 切り捨て（どれも絶対値に当てる＝−12.5→−12 側）／none 丸めない（0.1pt）。
 *   chip_pt10・shugi_pt10＝1枚の pt を 0.1pt 単位の整数で（null＝使わない）。
 *   tenpai_ryo・chombo・chombo_pt・yakitori_pt・aka など局の決めは表示と点数計算の道具の設定（半荘の pt の計算には効かない・
 *        チョンボの pt の罰を入れる日は記す表と needs-order の理由を一緒に足す＝v15.9）。
 */
const B = (key, d4, d3 = d4) => ({ key, kind: 'bool', min: null, max: null, step: null, vals: null, nullable: false, def4: d4, def3: d3, need: false });
const E = (key, vals, d4, d3 = d4) => ({ key, kind: 'enum', min: null, max: null, step: null, vals, nullable: false, def4: d4, def3: d3, need: false });
const I = (key, min, max, step, d4, d3 = d4, nullable = false) => ({ key, kind: 'int', min, max, step, vals: null, nullable, def4: d4, def3: d3, need: false });

/* ★名の順（ASCII＝倉庫の key collate "C" と同じ）に並べて持つ★（下で並べ替える＝手で並べない） */
export const RULE_KEYS = [
  B('atozuke', true),
  I('aka', 0, 4, 1, 3, 2),
  I('chip_pt10', 1, 9999, 1, null, null, true),
  E('chombo', ['mangan', 'pt'], 'mangan'),
  I('chombo_pt', 0, 999, 1, 20),
  B('double_ron', true),
  E('double_ron_kyotaku', ['kamicha', 'split'], 'kamicha'),
  B('double_yakuman', true),
  B('hakoshita', false),
  E('honba', [300, 1500], 300),
  E('kazoe', ['yakuman', 'sanbai'], 'yakuman'),
  E('kita', ['nuki', 'none'], 'none', 'nuki'),
  B('kiriage', false),
  B('kuitan', true),
  E('kyotaku_end', ['top', 'kieru'], 'top'),
  B('nagashi', true),
  B('oorasu_stop', true),
  B('pao', true),
  { key: 'players', kind: 'int', min: 3, max: 4, step: 1, vals: null, nullable: false, def4: 4, def3: 3, need: true },
  I('rate', 10, 100000, 10, null, null, true),
  I('return_pts', 1000, 200000, 100, 30000, 40000),
  E('renpu_fu', [2, 4], 4),
  E('round', ['gosha', 'shisha', 'kirisute', 'none'], 'gosha'),
  I('shugi_pt10', 1, 9999, 1, null, null, true),
  I('start_pts', 1000, 200000, 100, 25000, 35000),
  I('tenpai_ryo', 0, 30000, 1000, 3000),
  E('tie', ['kamicha', 'split'], 'kamicha'),
  B('tobi', true),
  E('tobi_from', ['busted', 'all'], 'busted'),
  I('tobi_pt', 0, 999, 1, 10),
  B('tobi_zero', true),
  B('tochu_kyushu', true),
  B('tochu_sucha', true),
  B('tochu_sufu', true),
  B('tochu_sukan', true),
  E('triple_ron', ['ryukyoku', 'ari'], 'ryukyoku'),
  E('tsumo3', ['son', 'secchan'], 'son'),
  { key: 'uma', kind: 'uma', min: -999, max: 999, step: 1, vals: null, nullable: false, def4: [20, 10, -10, -20], def3: [15, 0, -15], need: false },
  B('west', true),
  B('yakitori', false),
  I('yakitori_pt', 0, 999, 1, 0),
].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
/* double_ron は bool（true＝ダブロンあり／false＝頭ハネ）＝案の enum ari|atamahane を bool にした */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const BY = new Map(RULE_KEYS.map((k) => [k.key, k]));

function okValue(k, v, n) {
  if (v === null) return k.nullable;
  if (k.kind === 'bool') return typeof v === 'boolean';
  if (k.kind === 'enum') return k.vals.some((x) => x === v);
  if (k.kind === 'int') return isInt(v) && v >= k.min && v <= k.max && v % k.step === 0;
  if (k.kind === 'uma') {
    if (!Array.isArray(v) || v.length !== n) return false;
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      if (!isInt(v[i]) || v[i] < k.min || v[i] > k.max) return false;
      if (i > 0 && v[i] > v[i - 1]) return false;
      sum += v[i];
    }
    return sum === 0;
  }
  return false;
}

export function rulesOk(rules) {
  if (!isObj(rules)) return { ok: false, err: '(object)' };
  for (const key of Object.keys(rules)) if (!BY.has(key)) return { ok: false, err: '(unknown)' };
  const n = rules.players;
  if (n !== 3 && n !== 4) return { ok: false, err: 'players' };
  const out = {};
  for (const k of RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rules, k.key)) { out[k.key] = JSON.parse(JSON.stringify(n === 4 ? k.def4 : k.def3)); continue; }
    const v = rules[k.key];
    if (!okValue(k, v, n)) return { ok: false, err: k.key };
    out[k.key] = v;
  }
  if (out.return_pts < out.start_pts) return { ok: false, err: 'return_pts' };
  return { ok: true, rules: out };
}

export function defaultRules(players) {
  return rulesOk({ players }).rules;
}
