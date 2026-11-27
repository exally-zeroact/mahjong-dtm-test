/* meibo.test.mjs — lib/meibo.mjs（人の［名前を直す］［外す］［戻す］の部品・l_sadame v1.3 §1 A24④・A25）の期待値
 * 使い方: node tests/meibo.test.mjs  /  node tests/meibo.test.mjs --self-test（lib をわざと壊して赤になるか）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib', 'meibo.mjs');
const J = JSON.stringify;

const M = (id, active = true) => ({ member_id: id, name: id, active });
const R4 = { players: 4 };
// 部屋の st（ふつうの日）＝m1 の点が2回（1回は取り消した回・1回は消した卓）＋1回
const roomSt = () => ({
  members: ['m1', 'm2', 'm3', 'm4', 'm5'].map((m) => M(m)),
  sessions: [{ session_id: 's1' }],
  tables: [{ table_id: 'r1', session_id: 's1', label: '卓1', rules: R4 }, { table_id: 'r2', session_id: 's1', label: '卓2', rules: R4, voided: true }],
  hanchans: [
    { hanchan_id: 'h1', table_id: 'r1', seats: ['m1', 'm2', 'm3', 'm4'] },
    { hanchan_id: 'h2', table_id: 'r1', seats: ['m1', 'm2', 'm3', 'm4'], voided: true },
    { hanchan_id: 'h3', table_id: 'r2', seats: ['m1', 'm2', 'm3', 'm4'] },
  ],
  settles: [],
});
// リーグの st＝日 d1（締めていない）卓1 の次の席に m1・日 d2（締めた）卓1 の次の席にも m1
const lgSt = () => ({
  members: ['m1', 'm2', 'm3', 'm4', 'm5'].map((m) => M(m)),
  sessions: [{ session_id: 'd1' }, { session_id: 'd2' }],
  tables: [
    { table_id: 'a1', session_id: 'd1', label: '卓1', rules: R4, seats: ['m1', 'm2', 'm3', 'm4'] },
    { table_id: 'a2', session_id: 'd1', label: '卓2', rules: R4, seats: [] },
    { table_id: 'b1', session_id: 'd2', label: '東', rules: R4, seats: ['m1', 'm2', 'm3', 'm4'] },
  ],
  hanchans: [
    { hanchan_id: 'L1', table_id: 'a1', seats: ['m1', 'm2', 'm3', 'm4'] },
    { hanchan_id: 'L2', table_id: 'a2', seats: ['m5', 'm2', 'm3', 'm4'] },
    { hanchan_id: 'L3', table_id: 'b1', seats: ['m1', 'm2', 'm3', 'm4'] },
  ],
  settles: [{ session_id: 'd2' }],
});

async function run(L, quiet) {
  let p = 0, f = 0;
  const ok = (name, c, info) => { if (c) { p++; if (!quiet) console.log('  ✓ ' + name); } else { f++; if (!quiet) console.log('  ✗ ' + name + (info !== undefined ? '  ' + J(info) : '')); } };
  try {
    // 字
    ok('dup → 同じ名前の人がもういます', L.meiboErr({ err: 'dup' }) === '同じ名前の人がもういます');
    ok('left → この人は部屋を出ています。名前は直せません。', L.meiboErr({ err: 'left' }) === 'この人は部屋を出ています。名前は直せません。');
    ok('mj_role → 部屋の持ち主だけが直せます', L.meiboErr({ err: 'mj_role' }) === 'この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます');
    ok('知らない err・null は null（各頁の errText に任せる）', L.meiboErr({ err: 'net' }) === null && L.meiboErr(null) === null);
    // 名の確かめ
    ok('前後の空白を除く', J(L.nameCheck('  一郎 ')) === J({ ok: true, name: '一郎' }));
    ok('空・空白だけ・字でない → 1〜20字の字', !L.nameCheck('').ok && !L.nameCheck('   ').ok && !L.nameCheck(null).ok && L.nameCheck('').msg === '名前は1〜20字で入れてください。');
    ok('20字は通る・21字は止める（字の数＝絵文字も1字）', L.nameCheck('あ'.repeat(20)).ok && !L.nameCheck('あ'.repeat(21)).ok && L.nameCheck('😀'.repeat(20)).ok);
    // op
    ok('rename の op', J(L.memberOp.rename('m1', '一郎')) === J({ op: 'member_rename', member_id: 'm1', name: '一郎' }));
    ok('off＝active false・on＝active true（何も消さない）', J(L.memberOp.off('m1')) === J({ op: 'member_active', member_id: 'm1', active: false }) && J(L.memberOp.on('m1')) === J({ op: 'member_active', member_id: 'm1', active: true }));
    // 点の回数と今の席
    const u1 = L.memberUse(roomSt(), [lgSt()], 'm1');
    ok('m1＝部屋1回（取り消した回・消した卓は数えない）＋リーグ2回＝3', u1.n === 3, u1);
    ok('m1 の今の席＝締めていない日の卓1 だけ（締めた日の「東」は出さない）', J(u1.at) === J(['卓1']), u1);
    const u5 = L.memberUse(roomSt(), [lgSt()], 'm5');
    ok('m5＝リーグ1回・卓2 は卓の席が空＝前の半荘の人（m5）', u5.n === 1 && J(u5.at) === J(['卓2']), u5);
    const uR = L.memberUse(roomSt(), [], 'm1');
    ok('部屋の st は点の回数だけ（次の席は見ない）', uR.n === 1 && uR.at.length === 0, uR);
    const dupSt = lgSt();
    ok('同じ半荘が2つの写しに在っても1回', L.memberUse(roomSt(), [dupSt, dupSt], 'm1').n === 3);
    const offSt = lgSt(); offSt.members.find((m) => m.member_id === 'm2').active = false;
    ok('外した人が居る卓の次の席は決まらない＝今の席に出さない', J(L.memberUse(null, [offSt], 'm1').at) === J([]), L.memberUse(null, [offSt], 'm1'));
    const vS = lgSt(); vS.sessions[0].voided = true;
    ok('取り消した日の卓は今の席に出さない', L.memberUse(null, [vS], 'm1').at.length === 0);
    ok('点の無い人は0回', L.memberUse(roomSt(), [lgSt()], 'zz').n === 0);
    // 確かめの字
    ok('点が在る人の字', L.offText('佐藤', { n: 2, at: [] }) === '佐藤さんは半荘 2 回の点があります。外しても点はリーグの順位に残ります。');
    ok('点の無い人の字', L.offText('佐藤', { n: 0, at: [] }) === '佐藤さんを外します。人を選ぶ所に出なくなります。');
    ok('今の席の卓を足す', L.offText('佐藤', { n: 1, at: ['卓1', '卓3'] }) === '佐藤さんは半荘 1 回の点があります。外しても点はリーグの順位に残ります。今 卓1・卓3 の席にいます。その卓の次の半荘は人を選び直します。');
    // 消す（対局の頁・a25r v1）＝「消します」＋最後に［戻す］・既定は「外す」のまま
    ok('消す：点の無い人', L.offText('佐藤', { n: 0, at: [] }, { verb: '消す' }) === '佐藤さんを消します。人を選ぶ所に出なくなります。下の［戻す］で戻せます。', L.offText('佐藤', { n: 0, at: [] }, { verb: '消す' }));
    ok('消す：点が在る人・今の席', L.offText('佐藤', { n: 2, at: ['卓1'] }, { verb: '消す' }) === '佐藤さんは半荘 2 回の点があります。消しても点はリーグの順位に残ります。今 卓1 の席にいます。その卓の次の半荘は人を選び直します。下の［戻す］で戻せます。', L.offText('佐藤', { n: 2, at: ['卓1'] }, { verb: '消す' }));
    ok('知らない verb・opts 無しは外す（［戻す］の字を付けない）', L.offText('佐藤', { n: 0, at: [] }, { verb: 'x' }) === '佐藤さんを外します。人を選ぶ所に出なくなります。' && L.offText('佐藤', { n: 0, at: [] }, {}) === '佐藤さんを外します。人を選ぶ所に出なくなります。');
    // 分けた読み（st.loaded）＝部屋の分は倉庫の members[].n（写しの半荘は数えない）・リーグの分は今まで通り足す
    const split = (nv) => ({ ...roomSt(), loaded: [], members: [{ member_id: 'm1', name: '一', active: true, ...(nv === undefined ? {} : { n: nv }) }] });
    const uS = L.memberUse(split(7), [lgSt()], 'm1'), uS0 = L.memberUse(split(7), [], 'm1');
    ok('分けた読みは部屋の分＝members の n', uS0.n === 7, uS0);
    ok('分けた読み＋リーグ＝n＋リーグの回数', uS.n === 7 + (u1.n - uR.n), { uS, u1, uR });
    ok('分けた読みで n が無い人は写しを数える', L.memberUse(split(undefined), [], 'm1').n === uR.n);
    ok('分けた読みでない（v2）は n が在っても写しを数える', L.memberUse({ ...roomSt(), members: [{ member_id: 'm1', n: 7 }] }, [], 'm1').n === uR.n);
    // 押した時の op_id
    let k = 0; const uu = () => 'id' + (++k);
    const p1 = L.pressOp(null, L.memberOp.off('m1'), uu);
    const p2 = L.pressOp({ p: p1 }, L.memberOp.off('m1'), uu);
    const p3 = L.pressOp({ p: p1 }, L.memberOp.on('m1'), uu);
    ok('初めて押す＝新しい id', p1.op_id === 'id1');
    ok('同じ中身の送り直し＝同じ id', p2 === p1 && p2.op_id === 'id1');
    ok('中身が変われば新しい id', p3.op_id === 'id2');
    ok('印を残す返し（net・busy・mj_session…）と決まる返し（dup・left・mj_role・bad）', ['mj_reauth', 'mj_session', 'busy', 'net', 'offline', 'server', 'internal'].every(L.keepId) && !['dup', 'left', 'mj_role', 'bad'].some(L.keepId));
  } catch (e) { f++; if (!quiet) console.log('  ✗ 止まった ' + String(e && e.stack || e).split('\n')[0]); }
  return { p, f };
}

const self = process.argv.includes('--self-test');
const L0 = await import(pathToFileURL(LIB).href);
if (!self) {
  console.log('■ lib/meibo.mjs（l_sadame v1.3 A24④・A25）');
  const { p, f } = await run(L0, false);
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
} else {
  const src = fs.readFileSync(LIB, 'utf8');
  const W = [
    ['dup の字を出さない', "  if (e === 'dup') return MEIBO_ERR.dup;\n", ''],
    ['mj_role の字を出さない', "  if (e === 'mj_role') return MEIBO_ERR.role;\n", ''],
    ['名の前後の空白を除かない', "typeof raw === 'string' ? raw.trim() : ''", "typeof raw === 'string' ? raw : ''"],
    ['名を 21 字まで通す', 'export const NAME_MAX = 20;', 'export const NAME_MAX = 21;'],
    ['外すで消す（active を見ない op）', "off: (mid) => ({ op: 'member_active', member_id: mid, active: false }),", "off: (mid) => ({ op: 'member_active', member_id: mid, active: true }),"],
    ['取り消した回も数える', '    for (const h of st.hanchans || []) if (!h.voided && liveT.has', '    for (const h of st.hanchans || []) if (liveT.has'],
    ['リーグの半荘を数えない', '    if (!st) continue;\n    count(st);\n', '    if (!st) continue;\n'],
    ['締めた日の卓も今の席に出す', "      if (s.voided || (st.settles || []).some((y) => y.session_id === s.session_id)) continue;", '      if (s.voided) continue;'],
    ['今の席の卓を出さない', '        if (b && b.includes(mid)) at.push(t.label);', ''],
    ['送り直しで新しい id', '  if (ed && ed.p && JSON.stringify(ed.p.op) === JSON.stringify(op)) return ed.p;\n', ''],
    ['net で印を消す', "'busy', 'net', 'offline'", "'busy', 'offline'"],
    ['消すでも外すの字', "  const kesu = !!opts && opts.verb === '消す';", '  const kesu = false;'],
    ['どの verb でも消すの字', "  const kesu = !!opts && opts.verb === '消す';", '  const kesu = !!opts;'],
    ['消すで［戻す］の字を付けない', " + (kesu ? '下の［戻す］で戻せます。' : '');", ";"],
    ['分けた読みでも写しを数える', '    if (mm && Number.isInteger(mm.n)) n += mm.n;\n    else count(roomSt);', '    count(roomSt);'],
    ['v2 でも n を使う', 'const mm = Array.isArray(roomSt.loaded) ? (roomSt.members', 'const mm = true ? (roomSt.members'],
    ['分けた読みで n と写しを両方数える', '    if (mm && Number.isInteger(mm.n)) n += mm.n;\n    else count(roomSt);', '    if (mm && Number.isInteger(mm.n)) n += mm.n;\n    count(roomSt);'],
  ];
  let p = 0, f = 0;
  console.log('[meibo --self-test] lib をわざと壊して赤になるか');
  if ((await run(L0, true)).f) { console.log('  ✗ 壊す前から赤'); process.exit(1); }
  for (const [n, from, to] of W) {
    const s = src.replace(/\r\n/g, '\n');
    if (!s.includes(from)) { f++; console.log('  ✗ ' + n + ' — 壊す所が lib に無い'); continue; }
    const tmp = path.join(path.dirname(LIB), '.meibo.waza.' + p + f + '.mjs');
    fs.writeFileSync(tmp, s.replace(from, to));
    try {
      const Mx = await import(pathToFileURL(tmp).href);
      if ((await run(Mx, true)).f) { p++; console.log('  ✓ ' + n); } else { f++; console.log('  ✗ ' + n + ' — 赤にならなかった'); }
    } finally { fs.unlinkSync(tmp); }
  }
  console.log('\n' + p + ' passed, ' + f + ' failed');
  console.log('自己確認: ' + p + '/' + (p + f));
  process.exit(f ? 1 : 0);
}
