/*
 * C2-2（memory/mahjong_tataki_2026-11-20/c2_sadame.md v9.4 §2・c2_shiken.md）自分の戦績（lib/my-stats.mjs）＝期待値。
 * 使い方: node tests/my-stats.test.mjs  /  node tests/my-stats.test.mjs --self-test（lib をわざと壊して赤になるか）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyState, applyOps, migrateState } from '../lib/room-state.mjs';
import { leagueRank } from '../lib/league-rank.mjs';
import { defaultRules } from '../lib/rules.mjs';

const J = JSON.stringify;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib', 'my-stats.mjs');

// 返し=持ち点・ウマ0＝pt10＝(素点−持ち点)/100 を手で足せる形。チップ1枚＝2pt（pt10 20）
const R4 = { ...defaultRules(4), start_pts: 25000, return_pts: 25000, uma: [0, 0, 0, 0], rate: 100, chip_pt10: 20, tobi: false };
const R3 = { ...defaultRules(3), start_pts: 35000, return_pts: 35000, uma: [0, 0, 0], rate: 100, chip_pt10: 20, tobi: false };
const NAMES = { m1: '山田', m2: '鈴木', m3: '佐藤', m4: '高橋', m5: '伊藤', m6: '渡辺' };
function apply(st, ops) { const r = applyOps(st, ops); if (!r.ok) throw new Error('当たらない：' + J(r.res) + ' ' + J(ops[r.res.i] || null)); return r.state; }
const hs = (id, t, seats, cells) => ({ op: 'hanchan_start', hanchan_id: id, table_id: t, seats, cells });
const chip = (t, m, add) => ({ op: 'extra_add', table_id: t, member_id: m, kind: 'chip', add });

/* 自分＝m1。期待（4人）：
 * s1 11-20 rate100 雀荘A：t1 h1 40000/30000/20000/10000 → m1 150（1位）・チップ m1+2 m2−2 → +40
 *                        t2 [m5 m6 m3 m4]（m1 居ない）＋ m5 チップ +1 だけ（合計違い）＝★自分の卓でない＝skipped に出ない★
 * s2 11-21 rate50 雀荘B：t3 h3 20000/40000/30000/10000 → m1 −50（3位）＋ h3b 合計違い（skipped）
 *                        t4 h4 28000/26000/24000/22000 → 30（1位）＋ m1 チップ +1 だけ（合計違い＝枚は入れない・skipped extras）
 *                        t5→t6 の鎖（split_same=false＝前の卓に残った枚）：t5 h5 50000/25000/15000/10000 → 250（1位）・チップ m1+1 m3−1 → +20
 *                                                                        t6 h6 31000/29000/21000/19000 → 60（1位）＋ h9（取り消した半荘）
 *                        t8（取り消した卓）h8
 * s3 11-22（取り消した日）：t7 h7
 * s4 12-01 rate なし 家（3人）：t9 h10 45000/35000/25000 → 100（1位）
 * pt：4人 n5 150−50+30+250+60＝440・3人 n1 100／extras：4人 440+40+20＝500／ten：4人 (150+40)×10＋(−50+30+250+60+20)×5＝1900+1550＝3450・3人は noRate 1 */
function build() {
  let st = emptyState(); st.rules = R4;
  st = apply(st, [
    ...Object.entries(NAMES).map(([id, name]) => ({ op: 'member_add', member_id: id, name })),
    { op: 'session_add', session_id: 's1', date: '2026-11-20', rate: 100, place: '雀荘A' },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' },
  ]);
  st = apply(st, [hs('h1', 't1', ['m1', 'm2', 'm3', 'm4'], [40000, 30000, 20000, 10000]), hs('h2', 't2', ['m5', 'm6', 'm3', 'm4'], [35000, 26000, 24000, 15000])]);
  st = apply(st, [chip('t1', 'm1', 2), chip('t1', 'm2', -2)]);
  st.extras.push({ ...st.extras.find((e) => e.table_id === 't1' && e.member_id === 'm1'), table_id: 't2', member_id: 'm5', value: 1 });
  st = apply(st, [
    { op: 'session_add', session_id: 's2', date: '2026-11-21', rate: 50, place: '雀荘B' },
    { op: 'table_add', table_id: 't3', session_id: 's2', label: '卓1' },
    { op: 'table_add', table_id: 't4', session_id: 's2', label: '卓2' },
    { op: 'table_add', table_id: 't5', session_id: 's2', label: '卓3' },
    { op: 'table_add', table_id: 't6', session_id: 's2', label: '卓3' },
    { op: 'table_add', table_id: 't8', session_id: 's2', label: '卓4' },
  ]);
  st = apply(st, [
    hs('h3', 't3', ['m1', 'm5', 'm2', 'm6'], [20000, 40000, 30000, 10000]),
    hs('h3b', 't3', ['m1', 'm5', 'm2', 'm6'], [30000, 30000, 30000, 30000]),
    hs('h4', 't4', ['m1', 'm2', 'm3', 'm4'], [28000, 26000, 24000, 22000]),
    hs('h5', 't5', ['m1', 'm2', 'm3', 'm4'], [50000, 25000, 15000, 10000]),
    hs('h6', 't6', ['m1', 'm2', 'm3', 'm4'], [31000, 29000, 21000, 19000]),
    hs('h9', 't6', ['m1', 'm2', 'm3', 'm4'], [60000, 20000, 10000, 10000]),
    hs('h8', 't8', ['m1', 'm2', 'm3', 'm4'], [60000, 20000, 10000, 10000]),
  ]);
  st = apply(st, [chip('t5', 'm1', 1), chip('t5', 'm3', -1)]);
  st.extras.push({ ...st.extras.find((e) => e.table_id === 't1' && e.member_id === 'm1'), table_id: 't4', value: 1 });
  st.tables.find((t) => t.table_id === 't5').next_table_id = 't6';
  st = apply(st, [{ op: 'hanchan_void', hanchan_id: 'h9' }]);
  st = apply(st, [{ op: 'table_edit', table_id: 't8', voided: true }]);
  st = apply(st, [{ op: 'session_add', session_id: 's3', date: '2026-11-22', rate: 100 }, { op: 'table_add', table_id: 't7', session_id: 's3', label: '卓1' }]);
  st = apply(st, [hs('h7', 't7', ['m1', 'm2', 'm3', 'm4'], [60000, 20000, 10000, 10000])]);
  st = apply(st, [{ op: 'session_edit', session_id: 's3', voided: true }]);
  st = apply(st, [{ op: 'session_add', session_id: 's4', date: '2026-12-01', rate: null, place: '家' }, { op: 'table_add', table_id: 't9', session_id: 's4', label: '卓1' }]);
  st.tables.find((t) => t.table_id === 't9').rules = R3;
  st = apply(st, [hs('h10', 't9', ['m1', 'm2', 'm3'], [45000, 35000, 25000])]);
  const { settles, ...rest } = st; void settles;
  return rest;
}
/* out の形＝他の人を仮の id（o1・o2…）に・members／settles を返さない（c2_db.md §1b） */
function anon(st, me) {
  const map = new Map();
  const to = (m) => (m === null || m === undefined || me.includes(m) ? m : (map.has(m) ? map.get(m) : (map.set(m, 'o' + (map.size + 1)), map.get(m))));
  const x = JSON.parse(J(st));
  delete x.members;
  for (const h of x.hanchans) { h.seats = h.seats.map(to); if (Array.isArray(h.ton_order)) h.ton_order = h.ton_order.map(to); if (h.tobi_to && typeof h.tobi_to === 'object') h.tobi_to = JSON.parse(J(h.tobi_to)); }
  for (const t of x.tables) if (Array.isArray(t.seats)) t.seats = t.seats.map(to);
  for (const e of x.extras) e.member_id = to(e.member_id);
  return x;
}
const NA = { room_id: 'r1', created_at: '2026-11-20T00:00:00Z', session_id: 's2' };
function pagesOf(rows, { split = true, at = 'T0', unlinked = { room: 1 } } = {}) {
  if (!split || rows.length < 2) return [{ after: null, data: { ok: true, rows, more: false, next_after: null, at, unlinked } }];
  return [
    { after: null, data: { ok: true, rows: rows.slice(0, 1), more: true, next_after: NA, at, unlinked } },
    { after: NA, data: { ok: true, rows: rows.slice(1), more: false, next_after: null, at } },
  ];
}
const inRow = (st, id = 'r1') => ({ room_id: id, kind: 'room', name: '金曜会', side: 'in', me: ['m1'], st });
const outRow = (st, al = { t: [], h: [] }, id = 'r2') => ({ room_id: id, kind: 'room', name: '出た部屋', side: 'out', me: ['m1'], st: anon(st, ['m1']), al });

async function run(L, quiet) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) { p++; if (!quiet) console.log('  ✓ ' + name); } else { f++; if (!quiet) console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  const st = build();
  const P1 = pagesOf([inRow(st)]);
  const S = (mode, o = {}, pages = P1) => L.myStats(pages, { mode, ...o });
  const pt = S('pt'), ex = S('extras'), ten = S('ten');
  if (!quiet) console.log('■ 数（pt／込み／点・半荘ごと・卓ごと）');
  ok('pt：4人 n5・440（鎖の前の卓の半荘も・取り消しは入れない）', pt.ok && pt.groups[4].n === 5 && pt.groups[4].v === 440, J(pt.groups?.[4] && { n: pt.groups[4].n, v: pt.groups[4].v }));
  ok('pt：3人は別の組 n1・100', pt.ok && pt.groups[3].n === 1 && pt.groups[3].v === 100 && pt.groups[3].rankCounts.length === 3);
  ok('extras：卓ごとの枚（t1 +40・split_same=false で前の卓 t5 に残った +20）＝500・合計違いの t4 は入れない', ex.ok && ex.groups[4].v === 500, J(ex.groups?.[4]?.v));
  ok('extras：枚の収支 chip +3（t1 2・t5 1）・extrasOk で自分の窓が在る卓 4（t1 t3 t5 t6）', ex.ok && ex.groups[4].extras.chip === 3 && ex.groups[4].extras.tables === 4 && ex.groups[4].extras.extra10 === 60, J(ex.groups?.[4]?.extras));
  ok('ten：pt10×rate/10（1900+1550＝3450）', ten.ok && ten.groups[4].v === 3450, J(ten.groups?.[4]?.v));
  ok('ten：rate なしの卓は入れず noRate 1・3人の組も無い', ten.ok && ten.noRate === 1 && !ten.groups[3]);
  ok('pt・extras では noRate 0', pt.noRate === 0 && ex.noRate === 0);
  ok('順位：1位4・3位1・rankSum 7・top 4・last 0・連対 4', (() => { const g = pt.groups[4]; return J(g.rankCounts) === J([4, 0, 1, 0]) && g.rankSum === 7 && g.top === 4 && g.last === 0 && g.rentai === 4; })(), J(pt.groups[4].rankCounts));
  ok('素点 max 50000・min 20000・和 169000', pt.groups[4].scoreMax === 50000 && pt.groups[4].scoreMin === 20000 && pt.groups[4].scoreSum === 169000);
  ok('3人のラス＝3位（4人のラスと混ぜない）', (() => { const st2 = build(); st2.hanchans.find((h) => h.hanchan_id === 'h10').cells = [25000, 35000, 45000]; const r = L.myStats(pagesOf([inRow(st2)]), { mode: 'pt' }); return r.ok && r.groups[3].last === 1 && r.groups[4].last === 0; })());
  ok('rough：n<10 は目安', pt.groups[4].rough === true);
  ok('推移：日の順・込みは卓の最後の半荘に枚を足す（sum 500）', (() => { const t = ex.groups[4].trend; return t.length === 5 && t[t.length - 1].sum === 500 && t[0].date === '2026-11-20' && t[0].v === 190; })(), J(ex.groups[4].trend));
  ok('月・場所：11月 n5 v500・雀荘B n4', ex.groups[4].months['2026-11'].n === 5 && ex.groups[4].months['2026-11'].v === 500 && ex.groups[4].places['雀荘B'].n === 4);
  ok('games は自分の半荘だけ5つ（取り消し・合計違いは無い）', J(pt.groups[4].games.map((x) => x.hanchan_id)) === J(['h1', 'h3', 'h4', 'h5', 'h6']), J(pt.groups[4].games.map((x) => x.hanchan_id)));
  if (!quiet) console.log('■ skipped（取り消しは出さない・自分の卓だけ）');
  ok('skipped：合計違いの半荘 h3b（取り消した h7・h8・h9 は出ない）', J(pt.skipped.map((x) => [x.what, x.no, x.why])) === J([['hanchan', 2, 'sum']]), J(pt.skipped));
  ok('extras の skipped：t4 の枚だけ（自分の居ない t2 は出ない）', J(ex.skipped.filter((x) => x.what === 'extras').map((x) => x.label)) === J(['卓2']) && ex.skipped.find((x) => x.what === 'extras').date === '2026-11-21', J(ex.skipped));
  if (!quiet) console.log('■ D3 leagueRank と1点も違わない・in と out が同じ');
  const lr = leagueRank(migrateState(st).st, { rank_by: 'pt', complete: true });
  const m1 = lr.ok && lr.rows.find((r) => r.member_id === 'm1');
  ok('extras の4人+3人＝leagueRank の pt10・pt＝han10', m1 && ex.groups[4].v + ex.groups[3].v === m1.pt10 && pt.groups[4].v + pt.groups[3].v === m1.han10, J(m1));
  const P2 = pagesOf([outRow(st)]);
  for (const mode of ['pt', 'extras', 'ten']) {
    const a = S(mode), b = S(mode, {}, P2);
    ok('in と out が同じ数（' + mode + '）', b.ok && J(Object.values(a.groups).map((g) => [g.n, g.v, g.rankSum])) === J(Object.values(b.groups).map((g) => [g.n, g.v, g.rankSum])) && J(a.skipped.map((x) => x.no)) === J(b.skipped.map((x) => x.no)), J(b));
  }
  ok('out は vs（相性）を作らない・in は作る', S('pt', {}, P2).groups[4].vs.length === 0 && pt.groups[4].vs.length > 0);
  ok('相性：m2 と5回・自分の rankSum 7', (() => { const x = pt.groups[4].vs.find((v) => v.member_id === 'm2'); return x && x.n === 5 && x.rankSum === 7 && x.name === '鈴木'; })(), J(pt.groups[4].vs));
  ok('出た部屋の数 outRooms', S('pt', {}, P2).outRooms === 1 && pt.outRooms === 0);
  if (!quiet) console.log('■ 絞り（filter・players）');
  ok('期間 11-21 だけ：n4 v290', (() => { const r = S('pt', { filter: { from: '2026-11-21', to: '2026-11-21' } }); return r.ok && r.groups[4].n === 4 && r.groups[4].v === 290 && !r.groups[3]; })());
  ok('レート 50 だけ：n4・レートなしの組＝3人だけ', S('pt', { filter: { rate: 50 } }).groups[4].n === 4 && S('pt', { filter: { rate: null } }).groups[3].n === 1 && !S('pt', { filter: { rate: null } }).groups[4]);
  ok('場所 雀荘A：n1', S('pt', { filter: { place: '雀荘A' } }).groups[4].n === 1);
  ok('リーグ無しの日だけ（league null）＝全部', S('pt', { filter: { league: null } }).groups[4].n === 5);
  ok('players 3 だけ', (() => { const r = S('pt', { players: 3 }); return r.ok && !r.groups[4] && r.groups[3].n === 1; })());
  ok('形の違う mode・players・filter は止める', S('x').err === 'mode' && S('pt', { players: 5 }).err === 'players' && S('pt', { filter: { from: '11/21' } }).err === 'filter' && S('pt', { filter: { zz: 1 } }).err === 'filter');
  if (!quiet) console.log('■ 出た後の印（afterLeave＝al.h のうち groups に足した半荘だけ）');
  const AL = { t: ['t4', 't6'], h: ['h6', 'h3b', 'h9'] };
  const PA = pagesOf([outRow(st, AL)]);
  const al = S('pt', {}, PA);
  ok('n1（h6）・合計違い h3b と取り消した h9 は入らない・卓は2つ', al.ok && al.afterLeave.length === 1 && al.afterLeave[0].n === 1 && J(al.afterLeave[0].rows) === J([{ date: '2026-11-21', label: '卓3', no: 1 }]) && al.afterLeave[0].tables.length === 2, J(al.afterLeave));
  ok('filter で外れた半荘は n に入らない（11-20 だけ＝n0・卓は残る）', (() => { const r = S('pt', { filter: { to: '2026-11-20' } }, PA); return r.ok && r.afterLeave[0].n === 0 && r.afterLeave[0].tables.length === 2; })());
  ok('ten で rate なしの卓の半荘は n に入らない', (() => { const r = S('ten', {}, pagesOf([outRow(st, { t: [], h: ['h10'] })])); return r.ok && r.afterLeave.length === 0; })());
  ok('印は数を変えない（al を外しても同じ）', J(Object.values(al.groups).map((g) => g.v)) === J(Object.values(S('pt', {}, P2).groups).map((g) => g.v)));
  if (!quiet) console.log('■ 全部読めたか（myComplete）');
  const both = pagesOf([inRow(st), outRow(st)]);
  ok('2頁で足す：in+out の n＝10', (() => { const r = S('pt', {}, both); return r.ok && r.groups[4].n === 10; })());
  const cp = () => JSON.parse(J(both));
  ok('more が残る（最後の頁が more:true）＝unloaded', (() => { const x = cp(); x[1].data.more = true; return S('pt', {}, x).err === 'unloaded'; })());
  ok('頁が欠けた（1頁目だけ）＝unloaded', S('pt', {}, cp().slice(0, 1)).err === 'unloaded');
  ok('after が前の next_after と違う＝unloaded', (() => { const x = cp(); x[1].after = { ...NA, session_id: 's9' }; return S('pt', {}, x).err === 'unloaded'; })());
  ok('at が違う＝unloaded', (() => { const x = cp(); x[1].data.at = 'T1'; return S('pt', {}, x).err === 'unloaded'; })());
  ok('busy（ok:false）＝unloaded', (() => { const x = cp(); x[1].data = { ok: false, err: 'busy' }; return S('pt', {}, x).err === 'unloaded'; })());
  ok('同じ部屋の side が頁で違う＝unloaded', (() => { const x = cp(); x[1].data.rows[0].room_id = 'r1'; return S('pt', {}, x).err === 'unloaded'; })());
  ok('空＝unloaded', S('pt', {}, []).err === 'unloaded');
  ok('形が違う（me が空・out に al が無い・unlinked 無し）＝bad', (() => { const a = cp(); a[0].data.rows[0].me = []; const b = cp(); delete b[1].data.rows[0].al; const c = cp(); delete c[0].data.unlinked; return S('pt', {}, a).err === 'bad' && S('pt', {}, b).err === 'bad' && S('pt', {}, c).err === 'bad'; })());
  ok('知らない欄の写し＝newer（黙って数えない）', (() => { const x = cp(); x[0].data.rows[0].st.hanchans[0].zzz = 1; return S('pt', {}, x).err === 'newer'; })());
  ok('unlinked は1頁目の物', S('pt', {}, both).unlinked.room === 1);
  if (!quiet) console.log('■ 本物の倉庫の返し（tests/fixtures/my-stats-live.json＝9c679f8 の mj_account my_stats を khaw で c22 の台から取った物）');
  /* 台（c22）：ルール＝defaultRules(4)＋rate 100・チップ1枚 pt10 20。半荘は全部 40000/30000/20000/10000（席の順）＝1位 pt10 500・2位 100。
   * H1 は抜けた後に席0を 41000 へ＝合計違い（skipped）。S2（T4・H5）は取り消し。B＝M1（出た人）・A＝M0（持ち主）。
   * B：H6・H7・H8 が1位（H1 は合計違い・H5 は取り消し）＝n3 pt 1500・T2 の枚 +2＝+40 → extras 1540・ten 15400。卓は T1 T2 T5 T6 の4。
   *    afterLeave＝al.h（H1 H6）のうち数えた H6（卓1 の3つ目）だけ n1・卓は al.t の4（取り消した日の卓4 も＝c2_db §1b）。
   * A：H2 H3 H4 が1位・H6 H7 H8 が2位＝n6 pt 1800・枚 −2＝−40 → 1760。C＝行0・unlinked shared 1。D（出された）＝行0。 */
  const LV = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'my-stats-live.json'), 'utf8'));
  const one = (d) => [{ after: null, data: d }];
  const lv = (d, mode) => L.myStats(one(d), { mode });
  ok('本物：B（out）pt n3・1500・1位3', (() => { const r = lv(LV.rb, 'pt'); return r.ok && r.groups[4].n === 3 && r.groups[4].v === 1500 && J(r.groups[4].rankCounts) === J([3, 0, 0, 0]) && !r.groups[3]; })(), J(lv(LV.rb, 'pt')).slice(0, 300));
  ok('本物：B extras 1540・ten 15400・枚 chip 2 卓4', (() => { const e = lv(LV.rb, 'extras'), t = lv(LV.rb, 'ten'); return e.ok && e.groups[4].v === 1540 && e.groups[4].extras.chip === 2 && e.groups[4].extras.tables === 4 && t.ok && t.groups[4].v === 15400; })());
  ok('本物：B skipped＝H1（卓1 の1つ目・sum）だけ・outRooms 1・vs 無し', (() => { const r = lv(LV.rb, 'pt'); return r.ok && J(r.skipped.map((x) => [x.what, x.label, x.no, x.why, x.side])) === J([['hanchan', '卓1', 1, 'sum', 'out']]) && r.outRooms === 1 && r.groups[4].vs.length === 0; })());
  ok('本物：B afterLeave n1（卓1 の3つ目）・卓4つ', (() => { const r = lv(LV.rb, 'pt'); return r.ok && r.afterLeave.length === 1 && r.afterLeave[0].n === 1 && J(r.afterLeave[0].rows) === J([{ date: '2026-11-20', label: '卓1', no: 3 }]) && r.afterLeave[0].tables.length === 4; })(), J(lv(LV.rb, 'pt').afterLeave));
  ok('本物：A（in）pt n6・1800・1位3 2位3・extras 1760・vs 在り', (() => { const r = lv(LV.ra, 'pt'), e = lv(LV.ra, 'extras'); return r.ok && r.groups[4].n === 6 && r.groups[4].v === 1800 && J(r.groups[4].rankCounts) === J([3, 3, 0, 0]) && e.ok && e.groups[4].v === 1760 && r.groups[4].vs.length > 0 && r.afterLeave.length === 0; })());
  ok('本物：C＝数0・unlinked {shared:1}／D＝数0・unlinked {}', (() => { const c = lv(LV.rc, 'pt'), d = lv(LV.rd, 'pt'); return c.ok && !c.groups[4] && J(c.unlinked) === J({ shared: 1 }) && d.ok && !d.groups[4] && J(d.unlinked) === J({}); })());
  ok('本物：頁（4頁・more/next_after/at の鎖）＝complete ok・1頁と同じ数', (() => { const c = L.myComplete(LV.pages), r = L.myStats(LV.pages, { mode: 'extras' }); return LV.pages.length > 1 && c.ok && r.ok && r.groups[4].n === 6 && r.groups[4].v === 1760; })(), J(L.myComplete(LV.pages)));
  ok('本物：頁の1つを抜くと unloaded', (() => { const x = LV.pages.filter((_, i) => i !== 1); return L.myStats(x, { mode: 'pt' }).err === 'unloaded'; })());
  return { p, f };
}

const self = process.argv.includes('--self-test');
const L0 = await import(pathToFileURL(LIB).href);
if (!self) {
  const { p, f } = await run(L0, false);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  const src = fs.readFileSync(LIB, 'utf8');
  const W = [
    ['鎖の最後の卓だけ足す', 'if (t.session_id !== s.session_id || t.voided) continue;', 'if (t.session_id !== s.session_id || t.voided || t.next_table_id != null) continue;'],
    ['extrasOk を見ずに枚を足す', 'if (v.extrasOk) {', 'if (true) {'],
    ['×rate（/10 を忘れる）', 'mulS(pt10, v.rate / 10)', 'mulS(pt10, v.rate)'],
    ['complete を見ない', 'if (!c.ok) return c;', ''],
    ['取り消した日を数える', 'if (s.voided) continue;', ''],
    ['取り消した卓を数える', 'if (t.session_id !== s.session_id || t.voided) continue;', 'if (t.session_id !== s.session_id) continue;'],
    ['取り消した半荘を数える', 'if (r.voided) continue;', ''],
    ['4人と3人を混ぜる', 'const g = G(n);', 'const g = G(4);'],
    ['rate なしの卓を ten に入れる', "if (mode === 'ten' && v.rate === null) { noRate++; continue; }", ''],
    ['自分の居ない卓も見る', 'if (!v.people.some((p) => me.has(p.member_id))) continue;', ''],
    ['ok でない半荘を skipped に出さない', "skipped.push({ what: 'hanchan'", "[].push({ what: 'hanchan'"],
    ['afterLeave に al.h をそのまま数える', 'for (const gm of counted) if (alH.has(gm.hanchan_id))', 'for (const gm of row.al.h.map((h) => ({ hanchan_id: h }))) if (true)'],
    ['afterLeave を groups 抜きの全部の半荘で数える', 'counted.push(game);', 'counted.push(game); counted.push({ ...game, hanchan_id: "h3b" });'],
    ['newer を黙って数える', "if (mig.gate.mode === 'newer') return { ok: false, err: 'newer' };", ''],
    ['more を見ない', 'if (d.more !== !last) return', 'if (false) return'],
    ['at を見ない', "else if (canon(d.at) !== canon(at)) return { ok: false, err: 'unloaded' };", ''],
    ['out にも相性を作る', "if (row.side === 'in') {", 'if (true) {'],
    ['2頁目からも unlinked を求める', 'if (i === 0 && !(isObj(d.unlinked)', 'if (!(isObj(d.unlinked)'],
  ];
  let p = 0, f = 0;
  console.log('[my-stats --self-test] lib をわざと壊して赤になるか');
  if ((await run(L0, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of W) {
    if (!src.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が lib に無い'); continue; }
    const tmp = path.join(path.dirname(LIB), '.my-stats.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, src.replace(from, to));
    try {
      const M = await import(pathToFileURL(tmp).href);
      if ((await run(M, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } catch (e) { p++; console.log('  ✓ ' + n + '（投げた：' + String(e.message).slice(0, 60) + '）'); } finally { fs.unlinkSync(tmp); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
