/*
 * D3（memory/mahjong_tataki_2026-11-20/d3_sadame.md v1.3 §3）リーグの途中経過（lib/league-rank.mjs）＝期待値。
 * 使い方: node tests/league-rank.test.mjs  /  node tests/league-rank.test.mjs --self-test（lib をわざと壊して赤になるか）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyState, applyOps } from '../lib/room-state.mjs';
import { defaultRules } from '../lib/rules.mjs';

const J = JSON.stringify;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib', 'league-rank.mjs');

// 返し=持ち点・ウマ0＝pt＝(素点−25000)/1000 を手で足せる形。チップ1枚＝2pt（pt10 20）
const R = { ...defaultRules(4), start_pts: 25000, return_pts: 25000, uma: [0, 0, 0, 0], rate: 100, chip_pt10: 20, tobi: false };
const NAMES = { m1: '山田', m2: '鈴木', m3: '佐藤', m4: '高橋', m5: '伊藤', m6: '渡辺' };
function apply(st, ops) { const r = applyOps(st, ops); if (!r.ok) throw new Error('当たらない：' + J(r.res) + ' ' + J(ops[r.res.i] || null)); return r.state; }
const hs = (id, t, seats, cells) => ({ op: 'hanchan_start', hanchan_id: id, table_id: t, seats, cells });

/* 2日・人の入れ替え（A23 の形）
 * 1日目 s1：t1 [m1 m2 m3 m4] h1 40000/30000/20000/10000 → 150/50/−50/−150・チップ m1 +2 m2 −2 → +40/−40
 *           t2 [m5 m6 m3 m4] h2 35000/26000/24000/15000 → 100/10/−10/−100（★同じ点の半荘は上家の印が要る＝作らない★）
 * 2日目 s2：t3 [m1 m5 m2 m6] h3 20000/40000/30000/10000 → −50/150/50/−150 ＋ h3b 合計違い（skipped）
 *           t4 [m1 m2 m3 m4] h4 28000/26000/24000/22000 → 30/10/−10/−30 ＋ チップ m1 +1 だけ（合計違い＝t4 の枚は入れない・skipped extras）
 *           t5→t6 の鎖（A20 の区切り）：t5 [m1..m4] h5 50000/25000/15000/10000（t5 は取り消す＝入れない）・t6 [m1..m4] h6 31000/29000/21000/19000 → 60/40/−40/−60
 * 3日目 s3（取り消した日）：t7 h7 60000/… → 入れない
 * 期待 pt10：m1 150+40−50+30+60＝230／m2 50−40+50+10+40＝110／m3 −50−10−10−40＝−110／m4 −150−100−30−60＝−340／m5 100+150＝250／m6 10−150＝−140 */
function build() {
  let st = emptyState(); st.rules = R;
  st = apply(st, [
    ...Object.entries(NAMES).map(([id, name]) => ({ op: 'member_add', member_id: id, name })),
    { op: 'session_add', session_id: 's1', date: '2026-11-20', rate: 100 },
    { op: 'table_add', table_id: 't1', session_id: 's1', label: '卓1' },
    { op: 'table_add', table_id: 't2', session_id: 's1', label: '卓2' },
  ]);
  st = apply(st, [hs('h1', 't1', ['m1', 'm2', 'm3', 'm4'], [40000, 30000, 20000, 10000]), hs('h2', 't2', ['m5', 'm6', 'm3', 'm4'], [35000, 26000, 24000, 15000])]);
  st = apply(st, [{ op: 'extra_add', table_id: 't1', member_id: 'm1', kind: 'chip', add: 2 }, { op: 'extra_add', table_id: 't1', member_id: 'm2', kind: 'chip', add: -2 }]);
  st = apply(st, [
    { op: 'session_add', session_id: 's2', date: '2026-11-21', rate: 100 },
    { op: 'table_add', table_id: 't3', session_id: 's2', label: '卓1' },
    { op: 'table_add', table_id: 't4', session_id: 's2', label: '卓2' },
    { op: 'table_add', table_id: 't5', session_id: 's2', label: '卓3' },
    { op: 'table_add', table_id: 't6', session_id: 's2', label: '卓3' },
  ]);
  st = apply(st, [
    hs('h3', 't3', ['m1', 'm5', 'm2', 'm6'], [20000, 40000, 30000, 10000]),
    hs('h3b', 't3', ['m1', 'm5', 'm2', 'm6'], [30000, 30000, 30000, 30000]),
    hs('h4', 't4', ['m1', 'm2', 'm3', 'm4'], [28000, 26000, 24000, 22000]),
    hs('h5', 't5', ['m1', 'm2', 'm3', 'm4'], [50000, 25000, 15000, 10000]),
    hs('h6', 't6', ['m1', 'm2', 'm3', 'm4'], [31000, 29000, 21000, 19000]),
  ]);
  // t4 のチップの合計違い（m1 +1 だけ）＝倉庫の読みで来る形を写しに置く
  st.extras.push({ ...st.extras.find((e) => e.table_id === 't1' && e.member_id === 'm1'), table_id: 't4', value: 1 });
  st.tables.find((t) => t.table_id === 't5').next_table_id = 't6';
  st = apply(st, [{ op: 'table_edit', table_id: 't5', voided: true }]);
  st = apply(st, [
    { op: 'session_add', session_id: 's3', date: '2026-11-22', rate: 100 },
    { op: 'table_add', table_id: 't7', session_id: 's3', label: '卓1' },
  ]);
  st = apply(st, [hs('h7', 't7', ['m1', 'm2', 'm3', 'm4'], [60000, 20000, 10000, 10000])]);
  st = apply(st, [{ op: 'session_edit', session_id: 's3', voided: true }]);
  return st;
}

async function run(L, quiet) {
  let p = 0, f = 0;
  const ok = (name, cond, why = '') => { if (cond) { p++; if (!quiet) console.log('  ✓ ' + name); } else { f++; if (!quiet) console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
  const st = build();
  const by = (res) => Object.fromEntries(res.rows.map((r) => [r.member_id, r]));

  if (!quiet) console.log('■ leagueRank pt（2日・人の入れ替え・チップ込み・取り消しと未入力は入れない）');
  const a = L.leagueRank(st, { rank_by: 'pt', complete: true });
  ok('ok', a.ok === true, J(a));
  const A = a.ok ? by(a) : {};
  const want = { m1: 230, m2: 110, m3: -110, m4: -340, m5: 250, m6: -140 };
  ok('人ごとの pt10 が手で足した値と合う', a.ok && Object.entries(want).every(([m, v]) => A[m] && A[m].pt10 === v), J(a.ok && Object.fromEntries(a.rows.map((r) => [r.member_id, r.pt10]))));
  ok('並び m5 m1 m2 m3 m6 m4・順位 1〜6', a.ok && J(a.rows.map((r) => r.member_id)) === J(['m5', 'm1', 'm2', 'm3', 'm6', 'm4']) && J(a.rows.map((r) => r.rank)) === J([1, 2, 3, 4, 5, 6]));
  ok('チップは extra10 に（m1 +40・m2 −40）・半荘は han10（m1 150−50+30+60＝190・m2 50+50+10+40＝150）', a.ok && A.m1.extra10 === 40 && A.m2.extra10 === -40 && A.m1.han10 === 190 && A.m2.han10 === 150);
  ok('n＝数えた半荘（m1 は h1・h3・h4・h6＝4・h3b 未入力と h5 取り消し卓と h7 取り消し日は数えない）', a.ok && A.m1.n === 4 && A.m2.n === 4 && A.m3.n === 4 && A.m4.n === 4 && A.m5.n === 2 && A.m6.n === 2, J(a.ok && a.rows.map((r) => [r.member_id, r.n])));
  ok('count＝数えた半荘の数 5（h1 h2 h3 h4 h6）', a.ok && a.count === 5, J(a.count));
  ok('名は今の名', a.ok && A.m1.name === '山田');
  ok('skipped＝h3b の未入力と t4 のチップの合計違い（取り消した卓・日は出ない）', a.ok && a.skipped.length === 2
    && a.skipped.some((s) => s.what === 'hanchan' && s.table_id === 't3' && s.session_id === 's2')
    && a.skipped.some((s) => s.what === 'extras' && s.kind === 'chip' && s.table_id === 't4' && s.diff === 1)
    && !a.skipped.some((s) => s.table_id === 't5' || s.table_id === 't7'), J(a.skipped));

  // 外へ払う種（場代＝sum0 false）の行は数えた物＝skipped に出さない・pt にも入れない（tableView の not_yet）
  const so = build();
  so.tables = so.tables.map((t) => (t.table_id === 't1' ? { ...t, rules: { ...t.rules, tane_custom: [{ id: 'ba', name: '場代', pt10: 10, sum0: false }] } } : t));
  so.extras.push({ ...so.extras.find((e) => e.table_id === 't1' && e.member_id === 'm1'), kind: 'c:ba', value: 3 });
  const o = L.leagueRank(so, { rank_by: 'pt', complete: true });
  ok('外へ払う種の not_yet は skipped に出ない・pt に入らない（m1 230 のまま）', o.ok && o.skipped.length === 2 && by(o).m1.pt10 === 230, J(o.ok && [o.skipped, by(o).m1]));

  if (!quiet) console.log('■ 門');
  for (const c of [undefined, false, 'true', 1, null]) ok('complete ' + J(c) + ' → unloaded', J(L.leagueRank(st, { rank_by: 'pt', complete: c })) === J({ ok: false, err: 'unloaded' }));
  ok('rank_by が知らない → rank_by', J(L.leagueRank(st, { rank_by: 'min_games', complete: true })) === J({ ok: false, err: 'rank_by' }));
  ok('門の順＝unloaded が先', L.leagueRank(st, { rank_by: 'zzz', complete: false }).err === 'unloaded');
  const half = { ...st, loaded: ['s1'] };
  ok('st.loaded に入っていない開催が在る → unloaded（守りの重ね）', L.leagueRank(half, { rank_by: 'pt', complete: true }).err === 'unloaded');
  ok('取り消した日だけ loaded に無いのは通す', L.leagueRank({ ...st, loaded: ['s1', 's2'] }, { rank_by: 'pt', complete: true }).ok === true);

  if (!quiet) console.log('■ 並べ方（avg_pt・avg_rank・同点・n=0）');
  const ap = L.leagueRank(st, { rank_by: 'avg_pt', complete: true });
  // 平均 pt10：m5 250/2＝125・m1 230/4＝57.5・m2 110/4＝27.5・m3 −110/4＝−27.5・m6 −140/2＝−70・m4 −340/4＝−85
  ok('avg_pt の並び m5 m1 m2 m3 m6 m4', ap.ok && J(ap.rows.map((r) => r.member_id)) === J(['m5', 'm1', 'm2', 'm3', 'm6', 'm4']), J(ap.ok && ap.rows.map((r) => [r.member_id, r.pt10, r.n])));
  const ar = L.leagueRank(st, { rank_by: 'avg_rank', complete: true });
  // 順位の和：h1 m1 1 m2 2 m3 3 m4 4／h2 m5 1 m6 2 m3 3 m4 4／h3 m5 1 m2 2 m1 3 m6 4／h4 m1 1 m2 2 m3 3 m4 4／h6 m1 1 m2 2 m3 3 m4 4
  // m1 (1+3+1+1)/4＝1.5・m2 (2+2+2+2)/4＝2・m3 (3+3+3+3)/4＝3・m4 16/4＝4・m5 2/2＝1・m6 6/2＝3
  ok('avg_rank の rankSum（m1 6・m2 8・m3 12・m4 16・m5 2・m6 6）', ar.ok && J(Object.fromEntries(ar.rows.map((r) => [r.member_id, r.rankSum]))) === J({ m5: 2, m1: 6, m2: 8, m3: 12, m6: 6, m4: 16 }), J(ar.ok && ar.rows.map((r) => [r.member_id, r.rankSum, r.n])));
  ok('avg_rank 並び m5 m1 m2・m3 と m6 は 3.0 で同じ順位 4（名の読み順で 佐藤 が先）・m4 は 6', ar.ok && J(ar.rows.map((r) => [r.member_id, r.rank])) === J([['m5', 1], ['m1', 2], ['m2', 3], ['m3', 4], ['m6', 4], ['m4', 6]]), J(ar.ok && ar.rows.map((r) => [r.member_id, r.rank])));
  // n=0：m7 はチップだけ（t2 で m7 +1・m5 −1＝合計0）＝pt10 20 でも順位 null で一番下・m5 は 250−20＝230
  let st2 = apply(build(), [{ op: 'member_add', member_id: 'm7', name: '相沢' }]);
  const e0 = st2.extras.find((e) => e.table_id === 't1' && e.member_id === 'm1');
  st2.extras.push({ ...e0, table_id: 't2', member_id: 'm7', value: 1 }, { ...e0, table_id: 't2', member_id: 'm5', value: -1 });
  const z = L.leagueRank(st2, { rank_by: 'pt', complete: true });
  const Z = z.ok ? by(z) : {};
  ok('n=0 の人は pt10 20 でも一番下・rank null／m5 は 230（m1 と同点＝同じ順位 1・名の読みで 伊藤 が先）', z.ok && z.rows[z.rows.length - 1].member_id === 'm7' && Z.m7.rank === null && Z.m7.pt10 === 20 && Z.m7.n === 0 && Z.m5.pt10 === 230 && Z.m5.rank === 1 && Z.m1.rank === 1 && Z.m2.rank === 3 && z.rows[0].member_id === 'm5', J(z.ok && z.rows.map((r) => [r.member_id, r.pt10, r.rank])));
  const mk = (rows) => L.leagueRank({ ...emptyState(), members: Object.entries(NAMES).map(([member_id, name]) => ({ member_id, name, active: true })), sessions: [], tables: [], hanchans: [], extras: [] }, { rank_by: 'pt', complete: true });
  ok('開催が0 → ok・rows 空', J(mk().rows) === '[]' && mk().count === 0);

  if (!quiet) console.log('■ tableChains・tableRank（A20 の鎖・取り消した卓）');
  ok('s2 の頭＝t3 t4 t5（t6 は t5 の続き＝出さない・二重に出さない）', J(L.tableChains(st, 's2')) === J(['t3', 't4', 't5']), J(L.tableChains(st, 's2')));
  ok('s1 の頭＝t1 t2', J(L.tableChains(st, 's1')) === J(['t1', 't2']));
  const onlyVoid = { ...st, tables: st.tables.map((t) => (t.table_id === 't6' ? { ...t, voided: true } : t)) };
  ok('鎖の卓が全部取り消し → 出さない', J(L.tableChains(onlyVoid, 's2')) === J(['t3', 't4']), J(L.tableChains(onlyVoid, 's2')));
  const tr = L.tableRank(st, 't5');
  const TR = tr.ok ? by(tr) : {};
  ok('t5→t6 の鎖は取り消した t5 を数えない（m1 60・m2 40・m3 −40・m4 −60）', tr.ok && TR.m1.pt10 === 60 && TR.m2.pt10 === 40 && TR.m3.pt10 === -40 && TR.m4.pt10 === -60, J(tr.ok && tr.rows.map((r) => [r.member_id, r.pt10])));
  ok('卓の順位 1〜4', tr.ok && J(tr.rows.map((r) => r.rank)) === J([1, 2, 3, 4]));
  ok('詳細の回は t6 の1回だけ・no は 1 から', tr.ok && tr.view.rows.length === 1 && tr.view.rows[0].no === 1 && tr.view.rows[0].table_id === 't6', J(tr.ok && tr.view.rows.map((r) => [r.table_id, r.no])));
  const t1r = L.tableRank(st, 't1');
  ok('t1 の詳細の枚の数＝チップ m1 +2（取り消していない卓の和）', t1r.ok && t1r.view.windows.find((w) => w.member_id === 'm1').chip === 2);
  // 卓ごとの和＝全体（取り消していない卓を全部足すと leagueRank と同じ）
  const sumT = {};
  for (const sid of ['s1', 's2']) for (const h of L.tableChains(st, sid)) { const x = L.tableRank(st, h); if (x.ok) for (const r of x.rows) sumT[r.member_id] = (sumT[r.member_id] || 0) + r.pt10; }
  ok('卓ごとの pt を全部の卓で足すと全体と1点も違わない', a.ok && Object.entries(want).every(([m, v]) => sumT[m] === v), J(sumT));
  ok('無い卓 → table', J(L.tableRank(st, 'zz')) === J({ ok: false, err: 'table' }));
  ok('鎖が全部取り消し → table', L.tableRank(onlyVoid, 't5').err === 'table');

  if (!quiet) console.log('■ completeOf（画面の「全部読めた」の印）');
  const okRes = { data: { ok: true, read_ver: 3, st: {} }, error: null, status: 200 };
  ok('v 無しの ok＋took ok → true', L.completeOf(false, { res: okRes, took: 'ok' }) === true);
  ok('took skip → false', L.completeOf(true, { res: okRes, took: 'skip' }) === false);
  ok('took fail → false', L.completeOf(true, { res: okRes, took: 'fail' }) === false);
  ok('took 無し → false', L.completeOf(false, { res: okRes }) === false);
  ok('{error} → false', L.completeOf(true, { res: { error: { message: 'x' } }, took: 'ok' }) === false);
  ok('ok:false（gone）→ false', L.completeOf(true, { res: { data: { ok: false, err: 'gone' } }, took: 'ok' }) === false);
  ok('st が無い ok → false', L.completeOf(false, { res: { data: { ok: true } }, took: 'ok' }) === false);
  ok('same → 前のまま（false→false・true→true）', L.completeOf(false, { res: { data: { ok: true, same: true } }, took: 'same' }) === false && L.completeOf(true, { res: { data: { ok: true, same: true } }, took: 'same' }) === true);
  ok('local → 前のまま', L.completeOf(false, { took: 'local' }) === false && L.completeOf(true, { took: 'local' }) === true);
  ok('v3 の more:true の頁 → false', L.completeOf(false, { res: { data: { ok: true, st: {}, more: true } }, took: 'ok', pages: { done: false } }) === false);
  ok('v3 の最後の頁まで足した → true', L.completeOf(false, { res: { data: { ok: true, st: {}, more: false } }, took: 'ok', pages: { done: true } }) === true);
  ok('v3 で pages 無し → false', L.completeOf(false, { res: { data: { ok: true, st: {}, more: false } }, took: 'ok' }) === false);
  ok('res 無し → false', L.completeOf(true, {}) === false && L.completeOf(true) === false);
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
    ['extrasOk を見ずに枚を足す', 'a.pt10 += w.pt10;', 'a.pt10 += w.hanPt10 + w.chipPt10;'],
    ['取り消した卓を数える（全体）', "t.session_id === s.session_id && !t.voided", 't.session_id === s.session_id'],
    ['取り消した日を数える', "(st.sessions || []).filter((s) => !s.voided)", '(st.sessions || [])'],
    ['未入力を skipped に出さない', "if (m.what === undefined) skipped.push", 'if (false) skipped.push'],
    ['合計違いの extras を skipped に出さない', "else if (m.why !== 'not_yet') skipped.push", 'else if (false) skipped.push'],
    ['外へ払う種の not_yet も skipped に写す', "else if (m.why !== 'not_yet') skipped.push", 'else skipped.push'],
    ['unloaded の門を外す', 'if (complete !== true) return', 'if (false) return'],
    ['complete を見ず st.loaded だけで判じる', 'if (complete !== true) return', 'if (Array.isArray(st.loaded) && false) return'],
    ['同点を別の順位にする', 'cmp(live[i - 1], x) !== 0', 'true'],
    ['n=0 を下にしない', 'const live = list.filter((x) => x.n > 0), zero = list.filter((x) => !(x.n > 0));', 'const live = list, zero = [];'],
    ['tableChains で頭以外も出す', '!isNext.has(t.table_id)', 'true'],
    ['tableRank で取り消した卓を数える', 'const liveIds = ch.filter((id) => ix.t.get(id) && !ix.t.get(id).voided);', 'const liveIds = ch.filter((id) => ix.t.get(id));'],
    ['completeOf が took を見ない', "if (!isObj(d.st) || took !== 'ok') return false;", 'if (!isObj(d.st)) return false;'],
    ['completeOf を「more が無い」で作る（error を見ない）', 'if (!isObj(res) || res.error) return false;', 'if (!isObj(res)) return true;'],
    ['completeOf の same で true にする', 'if (d.same === true) return prev === true;', 'if (d.same === true) return true;'],
    ['completeOf の v3 を pages を見ずに通す', "return isObj(pages) && pages.done === true;", "return d.more === false;"],
  ];
  let p = 0, f = 0;
  console.log('[league-rank --self-test] lib をわざと壊して赤になるか');
  if ((await run(L0, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of W) {
    if (!src.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が lib に無い'); continue; }
    const tmp = path.join(path.dirname(LIB), '.league-rank.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, src.replace(from, to));
    try {
      const M = await import(pathToFileURL(tmp).href);
      if ((await run(M, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } finally { fs.unlinkSync(tmp); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
