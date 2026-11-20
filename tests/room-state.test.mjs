/* room-state.test.mjs — ★lib/room-state.mjs（端末の写しに op を当てる・対局の1ページの数）が手で決めた答えを出すか★（CI）
 * 例は設計図 §2 の絵（1pt＝100・チップ1枚2.0pt・祝儀1枚1.0pt）に寄せた数。
 * 使い方: node tests/room-state.test.mjs
 */
import { emptyState, applyOp, applyOps, tableView, sessionSeisan, checkEntry } from '../lib/room-state.mjs';
import { defaultRules } from '../lib/rules.mjs';

let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const J = JSON.stringify;

const rules = { ...defaultRules(4), rate: 100, chip_pt10: 20, shugi_pt10: 10 };
const base = () => {
  const r = applyOps(emptyState(), [
    { op: 'member_add', member_id: 'm1', name: '山田' },
    { op: 'member_add', member_id: 'm2', name: '鈴木' },
    { op: 'member_add', member_id: 'm3', name: '佐藤' },
    { op: 'member_add', member_id: 'm4', name: '高橋' },
    { op: 'session_add', session_id: 's1', date: '2026-11-20', rate: 100 },
    { op: 'table_add', table_id: 't1', session_id: 's1', rules },
  ]);
  return r.state;
};

console.log('■ 名簿');
{
  const st = base();
  const r = applyOp(st, { op: 'member_add', member_id: 'm9', name: 'やまだ' });
  ok('ひらがなとカタカナ違いは別の字（山田 と やまだ は別）', r.ok);
  const r2 = applyOp(st, { op: 'member_add', member_id: 'm10', name: 'ヤマダ' });
  ok('やまだ と ヤマダ は同じ人＝dup（先の member_id を返す）', !r2.ok && r2.err === 'dup' && r2.member_id === 'm9', J(r2));
  const r3 = applyOp(st, { op: 'member_add', member_id: 'm11', name: ' 山 田 ' });
  ok('空白を消すと同じ＝dup', !r3.ok && r3.err === 'dup' && r3.member_id === 'm1', J(r3));
  ok('同じ member_id の送り直しは成功（2人にしない）', applyOp(st, { op: 'member_add', member_id: 'm1', name: '山田' }).ok && st.members.length === 5);
  ok('空の名前は range', applyOp(st, { op: 'member_add', member_id: 'mx', name: '  ' }).err === 'range');
}

console.log('■ 半荘を入れる・組ごと当てる');
{
  const st0 = base();
  const bad = applyOps(st0, [
    { op: 'member_add', member_id: 'm5', name: '渡辺' },
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm5'], cells: [42300, 31000, 18200, 8501] },
  ]);
  ok('組の中の1つが弾かれたら組ごと当てない（人も足さない）', !bad.ok && bad.idx === 1 && bad.state.members.length === 4, J(bad.res));
  const r = applyOps(st0, [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [42300, 31000, 18200, 8500] },
    { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [20100, 11600, 38900, 29400] },
    { op: 'hanchan_start', hanchan_id: 'h3', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [33200, 45700, 5300, 15800] },
  ]);
  ok('3回入る', r.ok && r.state.hanchans.length === 3);
  const v = tableView(r.state, 't1');
  // 絵の1回目：2位 1.0+10=11.0・3位 −11.8−10=−21.8→−22・4位 −21.5−20=−41.5→−41（五捨六入）・トップ 52
  ok('1回目の pt（絵の数を五捨六入で丸めた物）', J(['m1', 'm2', 'm3', 'm4'].map((m) => v.rows[0].by[m].pt10)) === J([520, 110, -220, -410]), J(v.rows[0].by));
  ok('順位', J(['m1', 'm2', 'm3', 'm4'].map((m) => v.rows[0].by[m].rank)) === J([0, 1, 2, 3]));
  ok('計の合計は0', Object.values(v.total10).reduce((a, b) => a + b, 0) === 0, J(v.total10));
  ok('次は4回目', v.nextNo === 4);
  ok('入っていない物 0', v.missing.length === 0, J(v.missing));
}

console.log('■ 合わない半荘は計に入れず、訳を出す');
{
  const st = applyOps(base(), [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] },
    { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 9000] },
  ]).state;
  const v = tableView(st, 't1');
  ok('2回目は sum・差 −1000', !v.rows[1].ok && v.rows[1].why === 'sum' && v.rows[1].diff === -1000, J(v.rows[1]));
  ok('計は1回目だけ', J(v.total10) === J({ m1: 500, m2: 100, m3: -200, m4: -400 }), J(v.total10));
  ok('入っていない物に2回目', J(v.missing) === J([{ no: 2, why: 'sum', diff: -1000 }]), J(v.missing));
  const r = applyOp(st, { op: 'kyotaku_set', hanchan_id: 'h2', value: 1000, base_version: 0 });
  const v2 = tableView(st, 't1');
  ok('消えた供託 1000 を入れると合う', r.ok && v2.rows[1].ok, J(v2.rows[1]));
}

console.log('■ 版（cell_set）と conflict');
{
  const st = applyOps(base(), [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] },
  ]).state;
  ok('版0で直せる', applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 0 }).ok);
  const c = applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 39000, base_version: 0 });
  ok('古い版で直すと conflict（今の値と版を返す）', !c.ok && c.err === 'conflict' && J(c.cur) === J({ value: 41000, version: 1 }), J(c));
  ok('同じ値なら古い版でも成功', applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 0, value: 41000, base_version: 0 }).ok);
  ok('100点単位でない値は range', applyOp(st, { op: 'cell_set', hanchan_id: 'h1', seat: 1, value: 30050, base_version: 0 }).err === 'range');
}

console.log('■ 同点（起家からの順）と飛び賞の受け取り');
{
  const st = applyOps(base(), [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [35400, 35400, 15100, 14100] },
    { op: 'hanchan_start', hanchan_id: 'h2', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [50000, 30000, 25000, -5000] },
  ]).state;
  let v = tableView(st, 't1');
  ok('同点で順が無いと order', v.rows[0].why === 'order', J(v.rows[0]));
  ok('飛んだ人の受け取りが無いと tobi（席3）', v.rows[1].why === 'tobi' && J(v.rows[1].seats) === J([3]), J(v.rows[1]));
  applyOp(st, { op: 'hanchan_order', hanchan_id: 'h1', order: [1, 0, 2, 3], base_version: 0 });
  applyOp(st, { op: 'tobi_set', hanchan_id: 'h2', seat: 3, to: 0, base_version: 0 });
  v = tableView(st, 't1');
  ok('順を入れると上家（鈴木）が1位', v.rows[0].ok && v.rows[0].by.m2.pt10 === 460 && v.rows[0].by.m1.pt10 === 150, J(v.rows[0].by));
  ok('飛び賞は窓の pt に入る（山田 55+10・高橋 −50−10）', v.rows[1].ok && v.rows[1].by.m1.pt10 === 650 && v.rows[1].by.m4.pt10 === -600, J(v.rows[1].by));
  ok('checkEntry：同点は順が要る', checkEntry(rules, [35400, 35400, 15100, 14100]).needOrder === true);
  ok('checkEntry：飛んだ席', J(checkEntry(rules, [50000, 30000, 25000, -5000]).busted) === J([3]));
  ok('checkEntry：合計が合わない', J(checkEntry(rules, [40000, 30000, 20000, 9000])) === J({ ok: false, why: 'sum', diff: -1000 }));
}

console.log('■ 人ごとの窓（絵の形）・チップ・祝儀');
{
  const st = applyOps(base(), [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] },
    { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 3 },
    { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -1 },
  ]).state;
  let v = tableView(st, 't1');
  ok('チップが合わない間は薄く（dim）・窓の数にチップを入れない', v.windows.every((w) => w.dim) && v.windows[0].big === 5000, J(v.windows[0]));
  ok('合わない訳は missing に1つ（chip +2）', J(v.missing) === J([{ what: 'chip', diff: 2 }]), J(v.missing));
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm4', kind: 'chip', add: -2 });
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'shugi', add: 2 });
  applyOp(st, { op: 'extra_add', table_id: 't1', member_id: 'm3', kind: 'shugi', add: -2 });
  v = tableView(st, 't1');
  const w = Object.fromEntries(v.windows.map((x) => [x.member_id, x]));
  // 山田 50+3×2.0+2×1.0＝58.0pt → ×100＝5,800 ・チップの横 3×2.0×100＝600・祝儀の横 200
  ok('山田の窓＝+5,800（チップ +600・祝儀 +200）', !w.m1.dim && w.m1.big === 5800 && w.m1.chipBig === 600 && w.m1.shugiBig === 200, J(w.m1));
  ok('窓の合計は0', v.windows.reduce((a, x) => a + x.big, 0) === 0);
  ok('extra_set の古い版は conflict', applyOp(st, { op: 'extra_set', table_id: 't1', member_id: 'm1', kind: 'chip', value: 5, base_version: 0 }).err === 'conflict');
  const s = sessionSeisan(st, 's1');
  ok('精算の点は窓と同じ', s.ok && s.ten.m1 === 5800, J(s));
  ok('誰が誰に（3回まで）', s.ok && s.pay.length <= 3 && s.pay.reduce((a, x) => a + x.ten, 0) === 5800 + w.m2.big, J(s.pay));
}

console.log('■ レートなしの卓・チップを使わない卓');
{
  const r2 = { ...defaultRules(4) }; // rate null・chip/shugi null
  const st = applyOps(emptyState(), [
    { op: 'member_add', member_id: 'a', name: 'A' }, { op: 'member_add', member_id: 'b', name: 'B' },
    { op: 'member_add', member_id: 'c', name: 'C' }, { op: 'member_add', member_id: 'd', name: 'D' },
    { op: 'session_add', session_id: 's', date: '2026-11-20', rate: null },
    { op: 'table_add', table_id: 't', session_id: 's', rules: r2 },
    { op: 'hanchan_start', hanchan_id: 'h', table_id: 't', seats: ['a', 'b', 'c', 'd'], cells: [40000, 30000, 20000, 10000] },
  ]).state;
  const v = tableView(st, 't');
  ok('レートなしは大きく pt（unit pt）', v.windows[0].unit === 'pt' && v.windows[0].big === 500, J(v.windows[0]));
  ok('チップ・祝儀を使わない卓は used false', v.used.chip === false && v.used.shugi === false);
  const s = sessionSeisan(st, 's');
  ok('レートなしの卓は点に混ぜない', s.ok && J(s.ten) === '{}' && s.pt10NoRate.a === 500 && J(s.noRateTables) === J([1]), J(s));
}

console.log('■ 取り消した半荘');
{
  const st = applyOps(base(), [
    { op: 'hanchan_start', hanchan_id: 'h1', table_id: 't1', seats: ['m1', 'm2', 'm3', 'm4'], cells: [40000, 30000, 20000, 10000] },
    { op: 'hanchan_void', hanchan_id: 'h1' },
  ]).state;
  const v = tableView(st, 't1');
  ok('取り消した半荘は計に入れず、入っていない物にも数えない', J(v.total10) === '{}' && v.missing.length === 0 && v.rows[0].voided, J(v));
}

console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
