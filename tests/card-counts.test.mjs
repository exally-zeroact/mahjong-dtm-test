/* card-counts.test.mjs — ★続きの部屋のカードの数（lib cardCounts）と終えた判じ（lib roomEnded）を、倉庫と同じ表に当てる★（CI）
 * 表＝tests/fixtures/card-counts.json（a15_sadame §1.3 が正本・倉庫の tests/my-rooms.live.mjs も同じ表を読む＝定義が割れたら片方が赤）
 * 表の短い形を lib の部屋の形（st）に組み直す：並び＝配列の順・members＝m1..mN・hanchans の n＝同じ形の半荘の数（seats を省くと m1..m{卓の players}）
 * want.open＝p_open=true で出る＝!roomEnded(st)
 * 使い方: node tests/card-counts.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardCounts, roomEnded } from '../lib/room-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/card-counts.json'), 'utf8'));
let p = 0, f = 0;
const ok = (name, cond, why = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };

function toSt(c) {
  const ms = Array.from({ length: c.members }, (_, i) => 'm' + (i + 1));
  const st = { members: ms.map((m) => ({ member_id: m, name: m, active: true })), sessions: [], tables: [], hanchans: [], extras: [], settles: [] };
  (c.sessions || []).forEach((s, si) => {
    const sid = 's' + si;
    st.sessions.push({ session_id: sid, date: s.date, voided: s.voided === true, ...(s.league ? { league_id: '00000000-0000-4000-8000-00000000000' + si } : {}) });
    if (s.settled) st.settles.push({ session_id: sid, rev: 1 });
    for (const t of s.tables || []) {
      const tid = sid + ':' + t.key, players = t.players || 4;
      st.tables.push({ table_id: tid, session_id: sid, voided: t.voided === true, next_table_id: t.next ? sid + ':' + t.next : null, seats: t.seats || [] });
      let k = 0;
      for (const g of t.hanchans || []) for (let i = 0; i < g.n; i++) st.hanchans.push({ hanchan_id: tid + ':h' + k++, table_id: tid, seats: g.seats || ms.slice(0, players), voided: g.voided === true });
    }
  });
  return st;
}

ok('表が在って組が1つ以上', Array.isArray(T.cases) && T.cases.length > 0, String(T.cases && T.cases.length));
for (const c of T.cases) {
  const st = toSt(c), w = c.want, got = cardCounts(st), open = !roomEnded(st);
  const same = got.last_date === w.last_date && got.hanchan_n === w.hanchan_n && got.member_n === w.member_n && open === w.open;
  ok(c.name, same, 'want ' + JSON.stringify(w) + ' got ' + JSON.stringify({ open, ...got }));
}
console.log(`\n${p} passed, ${f} failed`);
if (f) process.exitCode = 1;
