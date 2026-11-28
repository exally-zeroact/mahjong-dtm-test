/* kamicha.test.mjs — ★点の行の［上家］の印 → 起家からの並び（lib/kamicha.mjs）が手で決めた答えを出すか＋全部の形★（CI・A13 a13g_sadame §5）
 * 正解表＝4人 既定（25000持ち 30000返し・ウマ 10-20・オカ 20）の pt を手で計算した値。
 * 総当たり＝4人・3人で素点の形（同じ点が出やすい値の組）× 印の押し方（席の部分集合の並び全部）を回し、
 *   ok の時：lib の順位で、同じ点の組の中は「印の人が押した順で上・印の無い人が一番下」になる／同じ点でない人の位置を入れ替えても pt が同じ
 *   ok でない時：印の無い人が2人以上の組がある
 *   marksFromOrder→fromMarks で同じ順位に戻る・sameTie が順位の同じさと一致
 * 使い方: node tests/kamicha.test.mjs
 */
import { groups, fromMarks, marksFromOrder, sameTie, tapMark, labels } from '../lib/kamicha.mjs';
import { hanchanPt } from '../lib/hanchan-pt.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; } else { f++; if (f <= 30) console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const show = (name, cond, why = '') => { ok(name, cond, why); if (cond) console.log('  ✓ ' + name); };
const J = JSON.stringify;
const R4 = (o = {}) => ({ players: 4, ...o });
const R3 = (o = {}) => ({ players: 3, ...o });
const ptOf = (R, c, marks) => { const m = fromMarks(R, c, marks); return m.need ? (m.ok ? hanchanPt(R, c, { order: m.order }) : null) : hanchanPt(R, c, {}); };

console.log('■ 正解表（4人 既定）');
// 40000・40000・10000・10000：1位 (40000−30000)/1000+20+20=+50.0・2位 10+10=+20.0・3位 −20−10=−30.0・4位 −20−20=−40.0
let g = ptOf(R4(), [40000, 40000, 10000, 10000], [0, 2]);
show('トップ同点・ドベ同点で田中と鈴木を押す（絵 v3 の形）→ [+50,+20,−30,−40]', g && g.ok && J(g.pt10) === J([500, 200, -300, -400]), J(g));
g = ptOf(R4(), [40000, 40000, 10000, 10000], [1, 3]);
show('佐藤と山田を押す → [+20,+50,−40,−30]', g && g.ok && J(g.pt10) === J([200, 500, -400, -300]), J(g));
g = ptOf(R4(), [40000, 40000, 10000, 10000], [2, 0]);
show('押す順が違っても組が別なら同じ答え [+50,+20,−30,−40]', g && g.ok && J(g.pt10) === J([500, 200, -300, -400]), J(g));
let m = fromMarks(R4(), [40000, 40000, 10000, 10000], [0]);
show('ドベ同点に印が無い → ok でない・印の無い席 [2,3]', m.need && !m.ok && J(m.seats) === J([2, 3]), J(m));
m = fromMarks(R4(), [40000, 30000, 20000, 10000], []);
show('同じ点が無い → 印は要らない', m.need === false, J(m));
m = fromMarks(R4(), [40000, 30000, 20000, 10000], [3, 1]);
show('同じ点が無い時の印は無視（need:false）', m.need === false, J(m));
// 3人同点 30000・30000・30000・10000：1位 0+20+20=+40・2位 0+10=+10・3位 0−10=−10・4位 −20−20=−40
m = fromMarks(R4(), [30000, 30000, 30000, 10000], [2]);
show('3人同点で1人だけ押す → ok でない（あと1人）', m.need && !m.ok && J(m.seats) === J([0, 1]), J(m));
g = ptOf(R4(), [30000, 30000, 30000, 10000], [2, 0]);
show('3人同点で 席2→席0 の順に押す → 席2 が1位・席0 が2位・席1 が3位 [+10,−10,+40,−40]', g && g.ok && J(g.pt10) === J([100, -100, 400, -400]), J(g));
m = fromMarks(R4(), [30000, 30000, 30000, 10000], [2, 0, 1]);
show('3人とも押してもよい', m.ok && J(m.order.slice(0, 3)) === J([2, 0, 1]), J(m));
// 箱下なし：−500 と 0 は同じ x（0）＝同点
m = fromMarks(R4(), [60000, 40500, 0, -500], []);
show('箱下なし：0 と −500 は同点 → 印が要る', m.need && !m.ok && J(m.seats) === J([2, 3]), J(m));
m = fromMarks(R4({ hakoshita: true }), [60000, 40500, 0, -500], []);
show('箱下あり：0 と −500 は別 → 要らない', m.need === false, J(m));
show('groups 2組', J(groups(R4(), [10000, 40000, 10000, 40000])) === J([[0, 2], [1, 3]]));
show('marksFromOrder：並び [3,2,1,0] → 組ごとに一番下を除く [1] と [3]（2人の同点は上家の1人だけ色）', J(marksFromOrder(R4(), [40000, 40000, 10000, 10000], [3, 2, 1, 0])) === J([1, 3]));
show('marksFromOrder：3人の同点 並び [2,0,1,3] → [2,0]', J(marksFromOrder(R4(), [30000, 30000, 30000, 10000], [2, 0, 1, 3])) === J([2, 0]));
show('marksFromOrder：並びが無い → []', J(marksFromOrder(R4(), [40000, 40000, 10000, 10000], null)) === J([]));
show('sameTie：組の中の前後が同じなら他の人の位置は違ってよい', sameTie(R4(), [40000, 40000, 10000, 30000], [0, 3, 1, 2], [2, 0, 3, 1]));
show('sameTie：組の中が逆なら false', !sameTie(R4(), [40000, 40000, 10000, 30000], [0, 1, 2, 3], [1, 0, 2, 3]));
show('fromMarks：範囲外・重ねた印は捨てる', J(fromMarks(R4(), [40000, 40000, 10000, 10000], [9, 0, 0, -1, 2]).order) === J([0, 2, 1, 3]));

console.log('■ 総当たり（4人・3人 × 印の押し方 全部）');
const VALS = [-1000, -500, 0, 10000, 25000, 30000, 35000, 40000, 50000, 60000];
// 最後の人＝合計の残り（lib は素点の合計が 持ち点×人数 でない形を受けない）。残りが同じ点になる形も入るよう VALS に返しの近くを入れる
function* cellsOf(n, want) { const m = n - 1; const idx = new Array(m).fill(0); for (;;) { const c = idx.map((i) => VALS[i]); c.push(want - c.reduce((x, y) => x + y, 0)); yield c; let k = 0; while (k < m && ++idx[k] === VALS.length) idx[k++] = 0; if (k === m) return; } }
function* marksOf(n) { // 席の部分集合の並び全部
  const seats = [...Array(n).keys()];
  function* go(pre) { yield pre; for (const s of seats) if (!pre.includes(s)) yield* go(pre.concat(s)); }
  yield* go([]);
}
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map((r) => [x].concat(r))));
let cases = 0, tieOk = 0, tieBad = 0;
for (const n of [4, 3]) for (const hako of [false, true]) {
  const R = { players: n, hakoshita: hako };
  const want = hanchanPt(R, new Array(n).fill(0), {}).want;
  for (const c of cellsOf(n, want)) {
    const gs = groups(R, c);
    for (const mk of marksOf(n)) {
      cases++;
      const r = fromMarks(R, c, mk);
      if (!gs.length) { ok('同点なし→need false ' + J([n, hako, c, mk]), r.need === false); continue; }
      const bad = gs.some((gg) => gg.filter((s) => !mk.includes(s)).length > 1);
      if (bad) { tieBad++; ok('印が足りない→ok でない ' + J([n, hako, c, mk]), r.need && !r.ok); continue; }
      ok('印が足りる→ok ' + J([n, hako, c, mk]), r.need && r.ok && r.order.length === n && new Set(r.order).size === n);
      if (!r.ok) continue;
      tieOk++;
      const h = hanchanPt(R, c, { order: r.order });
      ok('lib が通す ' + J([n, hako, c, mk]), h.ok, J(h));
      if (!h.ok) continue;
      // 組の中の順位：印の人は押した順に上・印の無い人は一番下
      for (const gg of gs) {
        const want = mk.filter((s) => gg.includes(s)).concat(gg.filter((s) => !mk.includes(s)));
        const got = gg.slice().sort((a, b) => h.rank[a] - h.rank[b]);
        ok('組の順位＝印の順 ' + J([n, hako, c, mk, gg]), J(got) === J(want), J({ rank: h.rank, want }));
      }
      // 同じ点でない人の位置は答えを変えない：組の中の前後を保つ並び全部で pt が同じ
      for (const o of perms([...Array(n).keys()])) {
        if (!sameTie(R, c, o, r.order)) continue;
        const h2 = hanchanPt(R, c, { order: o });
        ok('他の人の位置は効かない ' + J([n, hako, c, mk, o]), h2.ok && J(h2.pt10) === J(h.pt10) && J(h2.rank) === J(h.rank));
      }
      // 直す画面：並び→印→並びで同じ順位
      const back = fromMarks(R, c, marksFromOrder(R, c, r.order));
      ok('印の戻し ' + J([n, hako, c, mk]), back.ok && sameTie(R, c, back.order, r.order));
    }
  }
}
console.log('  形 ' + cases.toLocaleString('en-US') + ' 通り（同点で印が足りる ' + tieOk.toLocaleString('en-US') + '・足りない ' + tieBad.toLocaleString('en-US') + '）');
ok('同点の形を回した', tieOk > 1000 && tieBad > 1000);
console.log('■ v2 押し方と字（tapMark・labels）');
{
  const C2 = [40000, 40000, 10000, 10000], C3 = [30000, 30000, 30000, 10000];
  const T = (lb) => lb.map((x) => (x.on ? '*' : '') + x.text).join(',');
  let mk = tapMark(R4(), C2, [], 0);
  show('2人の同点：席0 を押す → [0]', J(mk) === J([0]));
  mk = tapMark(R4(), C2, mk, 1);
  show('2人の同点：相手（席1）を押すと印が移る → [1]', J(mk) === J([1]));
  show('2人の同点：もう1回押すと外れる → []', J(tapMark(R4(), C2, mk, 1)) === J([]));
  show('別の組の印は残る（[0] に席2 → [0,2]）', J(tapMark(R4(), C2, [0], 2)) === J([0, 2]));
  show('2人の同点の字は色だけ（*上家,上家,*上家,上家）', T(labels(R4(), C2, [0, 2])) === '*上家,上家,*上家,上家', T(labels(R4(), C2, [0, 2])));
  mk = tapMark(R4(), C3, tapMark(R4(), C3, [], 2), 0);
  show('3人の同点：席2→席0 → 上家1・上家2（押してない席1 は 上家）', T(labels(R4(), C3, mk)) === '*上家2,上家,*上家1,上家', T(labels(R4(), C3, mk)));
  show('3人の同点：上家1 を外すと番号が詰まる', T(labels(R4(), C3, tapMark(R4(), C3, mk, 2))) === '*上家1,上家,上家,上家', T(labels(R4(), C3, tapMark(R4(), C3, mk, 2))));
  const P = [40000, 40000, 10000, NaN];
  mk = tapMark(R4(), P, tapMark(R4(), P, [], 0), 1);
  show('点が欠けている間は組が無い＝そのまま足す [0,1]', J(mk) === J([0, 1]));
  show('点が揃って2人の同点に2人とも印 → 番号で順を見せる', T(labels(R4(), C2, mk)) === '*上家1,*上家2,上家,上家', T(labels(R4(), C2, mk)));
  show('同点でない席の印は 上家 の色だけ', T(labels(R4(), [40000, 30000, 20000, 10000], [3])) === '上家,上家,上家,*上家');
}
console.log('■ v2 総当たり：画面の字から組の中の順が読める（押した順・点が揃う前後・直す画面の始め）');
{
  // 画面から読む順＝組の中で 番号の印（番号順）→ 番号の無い印（いても1人）→ 印の無い席（席の順）
  const readBack = (lb, g) => {
    const num = g.filter((s) => lb[s].on && lb[s].text !== '上家').sort((a, b) => Number(lb[a].text.slice(2)) - Number(lb[b].text.slice(2)));
    const plain = g.filter((s) => lb[s].on && lb[s].text === '上家');
    return { order: num.concat(plain, g.filter((s) => !lb[s].on)), plainN: plain.length, numN: num.length };
  };
  const V2 = [0, 10000, 25000, 30000, 40000];
  let seen = 0;
  for (const n of [3, 4]) for (const hako of [false, true]) {
    const R = { players: n, hakoshita: hako };
    const want = n === 4 ? 100000 : 105000;
    const m = n - 1, idx = new Array(m).fill(0);
    for (;;) {
      const c = idx.map((i) => V2[i]); c.push(want - c.reduce((x, y) => x + y, 0));
      const gs = groups(R, c);
      if (gs.length) {
        const partial = c.slice(); partial[n - 1] = NaN;
        const seqs = [[]];
        for (let L = 0; L < 3; L++) for (const q of seqs.slice()) if (q.length === L) for (let s = 0; s < n; s++) seqs.push(q.concat(s));
        for (const pre of seqs) for (const post of seqs) {
          if (pre.length + post.length > 4) continue;
          let mk = [];
          for (const s of pre) mk = tapMark(R, partial, mk, s);
          for (const s of post) mk = tapMark(R, c, mk, s);
          const lb = labels(R, c, mk), r = fromMarks(R, c, mk);
          seen++;
          for (const g of gs) {
            const rb = readBack(lb, g);
            ok('組に番号の無い印は1人まで・番号と混ざらない ' + J([n, hako, c, pre, post, g]), rb.plainN <= 1 && !(rb.plainN && rb.numN), J(lb));
            if (g.length === 2 && !pre.length) ok('2人の同点を点が揃ってから押すと印は1つまで ' + J([c, post]), g.filter((s) => mk.includes(s)).length <= 1, J(mk));
            if (r.ok) { const o = r.order.filter((s) => g.includes(s)); ok('画面の字＝保存する順 ' + J([n, hako, c, pre, post, g]), J(rb.order) === J(o), J({ lb, o })); }
          }
          if (r.ok) { // 直す画面の始め：保存した順から印→字→同じ順
            const lb2 = labels(R, c, marksFromOrder(R, c, r.order));
            for (const g of gs) ok('直す始めの字＝前の順 ' + J([c, r.order, g]), J(readBack(lb2, g).order) === J(r.order.filter((s) => g.includes(s))), J(lb2));
          }
        }
      }
      let k = 0; while (k < m && ++idx[k] === V2.length) idx[k++] = 0; if (k === m) break;
    }
  }
  console.log('  押し方 ' + seen.toLocaleString('en-US') + ' 通り');
  ok('押し方を回した', seen > 1000);
}
console.log(`\nkamicha.test: ${p} ok / ${f} ng`);
console.log('KEKKA ' + JSON.stringify({ passed: p, failed: f, mimiso: 0 }));   // ci-3tsu（tools/_bunrui.mjs）が読む約束の行
if (f) process.exit(1);
