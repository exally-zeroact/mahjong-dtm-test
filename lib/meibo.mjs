/* meibo.mjs — ★人の［名前を直す］［外す］［戻す］の部品（l_sadame v1.3 §1 A24④・A25）★（純関数・リーグの頁と対局の頁が同じ物を使う）
 * =============================================================================
 * 何も消さない＝外すは member_active false（人を選ぶ所に出ないだけ・点は人 member_id に付いたまま）。
 * 画面ごとに違う物（HTML・どこへ送るか・読み直し）は各頁が持つ。ここは「字・確かめの字・送る op・押した時の op_id」だけ。
 *
 *   MEIBO_ERR / meiboErr(res)      … 倉庫の返し（dup・left・mj_role・tsunagi）の字。知らない err は null（＝各頁の errText に任せる）
 *   nameCheck(raw)                 … 直す名の確かめ（前後の空白を除いて1〜20字）→ { ok, name } か { ok:false, msg }
 *   memberOp.rename/off/on         … 送る op（member_rename／member_active false／true）
 *   memberUse(roomSt, leagueSts, mid) … 点の回数（部屋の st＋各リーグの st・取り消していない回と卓・同じ半荘は1回）と、
 *                                    締めていないリーグの日の次の席（baseSeats）に居る卓の名（次の席を見るのは leagueSts だけ）。
 *                                    リーグの半荘は部屋の読みに来ない＝各リーグを mj_read league で読んでから渡す（読めない間は［外す］を押させない）
 *   offText(name, use, opts)       … 外す前の確かめの字（opts.verb '消す'＝対局の頁：「消します」＋「下の［戻す］で戻せます。」・既定は「外す」／opts.unlink＝つながりも外す時に「その人の戦績とのつながりも外れます（点は残ります）。」／opts.room＝ふつうの部屋：「点は精算に残ります」・リーグの順位と言わない＝a25r §1-3 任意1）
 *   pressOp(ed, op, uuid)          … 押した時に1回だけ op_id（同じ中身の送り直しは同じ id）→ { op_id, op }
 *   keepId(err)                    … 答えが決まらない返し（印を残す＝次も同じ id）か
 */
import { baseSeats } from './league-round.mjs';
import { tableChains } from './league-rank.mjs';

export const MEIBO_ERR = Object.freeze({
  dup: '同じ名前の人がもういます',
  left: 'この人は部屋を出ています。名前は直せません。',
  role: 'この人はほかのリーグにも出ているので、部屋の持ち主だけが直せます',
  tsunagi: 'アカウントにつながっている人です。部屋の画面の［つながりを外して消す］から消してください', // a25r v2.1 §1-8：つないだ人の active false は倉庫が断る
});
export function meiboErr(res) {
  const e = res && res.err;
  if (e === 'dup') return MEIBO_ERR.dup;
  if (e === 'left') return MEIBO_ERR.left;
  if (e === 'mj_role') return MEIBO_ERR.role;
  if (e === 'tsunagi') return MEIBO_ERR.tsunagi;
  return null;
}

export const NAME_MAX = 20;
export const NAME_MSG = '名前は1〜20字で入れてください。';
export function nameCheck(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || [...name].length > NAME_MAX) return { ok: false, msg: NAME_MSG };
  return { ok: true, name };
}

export const memberOp = Object.freeze({
  rename: (mid, name) => ({ op: 'member_rename', member_id: mid, name }),
  off: (mid) => ({ op: 'member_active', member_id: mid, active: false }),
  on: (mid) => ({ op: 'member_active', member_id: mid, active: true }),
});

function chainLastT(st, t) {
  const by = new Map((st.tables || []).map((y) => [y.table_id, y]));
  const seen = new Set();
  let c = t;
  while (c && c.next_table_id && by.get(c.next_table_id) && !seen.has(c.next_table_id)) { seen.add(c.next_table_id); c = by.get(c.next_table_id); }
  return c;
}
export function memberUse(roomSt, leagueSts, mid) {
  const seen = new Set(); let n = 0; const at = [];
  const count = (st) => {
    const liveT = new Set((st.tables || []).filter((t) => !t.voided).map((t) => t.table_id));
    for (const h of st.hanchans || []) if (!h.voided && liveT.has(h.table_id) && !seen.has(h.hanchan_id) && Array.isArray(h.seats) && h.seats.includes(mid)) { seen.add(h.hanchan_id); n++; }
  };
  if (roomSt) {
    // 分けた読み（st.loaded が在る＝写しは最後の数開催だけ）では、倉庫が league の無い全開催で数えた members の n を使う（gamen-room memberStats と同じ）
    const mm = Array.isArray(roomSt.loaded) ? (roomSt.members || []).find((m) => m.member_id === mid) : null;
    if (mm && Number.isInteger(mm.n)) n += mm.n;
    else count(roomSt);
  }
  for (const st of leagueSts || []) {
    if (!st) continue;
    count(st);
    for (const s of st.sessions || []) {
      if (s.voided || (st.settles || []).some((y) => y.session_id === s.session_id)) continue;
      for (const hd of tableChains(st, s.session_id)) {
        const t = (st.tables || []).find((y) => y.table_id === hd);
        const last = chainLastT(st, t);
        const np = last && last.rules && Number.isInteger(last.rules.players) ? last.rules.players : null;
        const b = np === null ? null : baseSeats(st, hd, np).seats;
        if (b && b.includes(mid)) at.push(t.label);
      }
    }
  }
  return { n, at };
}

export function offText(name, use, opts) {
  const kesu = !!opts && opts.verb === '消す';
  const t = [use && use.n ? name + 'さんは半荘 ' + use.n + ' 回の点があります。' + (kesu ? '消しても' : '外しても') + (opts && opts.room === true ? '点は精算に残ります' : '点はリーグの順位に残ります') : name + 'さんを' + (kesu ? '消します' : '外します') + '。人を選ぶ所に出なくなります'];
  if (use && use.at && use.at.length) t.push('今 ' + use.at.join('・') + ' の席にいます。その卓の次の半荘は人を選び直します');
  if (opts && opts.unlink === true) t.push('その人の戦績とのつながりも外れます（点は残ります）');
  return t.join('。') + '。' + (kesu ? '下の［戻す］で戻せます。' : '');
}

export function pressOp(ed, op, uuid) {
  if (ed && ed.p && JSON.stringify(ed.p.op) === JSON.stringify(op)) return ed.p;
  return { op_id: uuid(), op };
}
export const KEEP_ID = new Set(['mj_reauth', 'mj_session', 'busy', 'net', 'offline', 'server', 'internal']); // 印を残す返し（定め §1 の表）
export const keepId = (err) => KEEP_ID.has(err);
