/* outbox.mjs — ★未送信の並び（mj_write へ送る op の組）の受け方★（純関数・画面と node 試験が同じ物を使う）
 * =============================================================================
 * 取り決め＝memory/mahjong_tataki_2026-11-20/write_sekkei.md §6-11・12・14・14'（v5.2）／画面側の紙＝gamen_write_awase_v1.md v4 節。
 * 2d（2d_sadame.md v2.1 §3）から画面が送る（WRITE_READY=true・送るのは js/gamen-room.mjs の sendOutbox だけ）。
 *
 * outboxStep(res) … res＝supabase-js の rpc の返り { data, error, status } か、投げた例外を包んだ { error }（403 は res.status か error.status）。
 *   ①' HTTP 403 → 'stop'（err 'server'）＝回し続けない。err bad かつ at closed → 'closed'（at を添える）＝終えた部屋（at の無い bad は 'stop' のまま）。
 *   stop の返しは at・what を残す（2d）。
 *   判じの順（先に login を見る＝JWT 切れを retry で回し続けない）：
 *   ① error が 401／JWT（PGRST301・'JWT expired' など）・err 'mj_session' → 'login'（送るのを止める・並びは捨てない）
 *      err 'mj_reauth'（2c-2b 入り直しの門）も 'login'・err は 'mj_reauth' のまま返す＝受け手は refresh だけで送り直さない（amr は refresh で変わらない）・パスワードで入り直してから同じ op_id で送る
 *   ② 返りが無い・data に ok が無い・網の失敗・55P03・40P01・busy（分の窓・lock・what 無し）→ 'retry'（同じ op_id で後で送り直す・捨てない）
 *      ★P6g（p6g_sadame v1.1 §1）：busy は what が BUSY_RETRY（分の窓4つ・lock）か what 無しの時だけ retry。他の busy（1日の窓・知らない名）は stop＝held に what を残す★
 *      （名前の形 1m／1d では当てない＝窓が増えた時に黙って retry に倒れない）
 *   ③ ok:true                                                      → 'done'
 *   ④ conflict → 'conflict'／gone → 'reload'（部屋を読み直す）
 *      dup・linked（2c-2b）→ 'stop'（member_id を添える＝置き換えは 2d）／mj_role（2c-2b）／bad・range・not_yet・full・too_many・internal・mj_op_other_user・知らない err → 'stop'
 * 返し：{ kind, err, member_id? }
 */

const JWT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const RETRY_CODES = new Set(['55P03', '40P01']);
/* P6g §1：retry にする busy の what（これ以外は stop）。BUSY_STOP は照合の試験の為の一覧（判じには使わない＝知らない名も stop） */
export const BUSY_RETRY = new Set(['write:all1m', 'write:rn1m', 'write:u1m', 'write:ur1m', 'lock']);
export const BUSY_STOP = new Set(['write:all1d', 'write:rk1d', 'write:rn1d', 'write:un1d', 'write:uk1d', 'write:u1d', 'secret', 'name', 'all', 'user']);
export const busyRetry = (what) => typeof what !== 'string' || BUSY_RETRY.has(what);
const STOP_ERRS = new Set(['bad', 'range', 'dup', 'not_yet', 'full', 'too_many', 'internal', 'mj_op_other_user', 'mj_role', 'linked']);

function isLoginError(e) {
  if (!e) return false;
  const status = e.status ?? e.statusCode;
  if (status === 401) return true;
  if (JWT_CODES.has(e.code)) return true;
  const msg = String(e.message || '');
  return /JWT expired|invalid JWT|JWSError|not authenticated/i.test(msg);
}

export function outboxStep(res) {
  if (!res || typeof res !== 'object') return { kind: 'retry', err: 'no_reply' };
  const e = res.error;
  const status = res.status ?? (e ? e.status ?? e.statusCode : undefined);
  if (e) {
    if (isLoginError(e)) return { kind: 'login', err: 'login' };
    if (status === 403) return { kind: 'stop', err: 'server', status }; // 権限の外（直らない）＝回し続けず字を出して止める（2d §3）
    return { kind: 'retry', err: RETRY_CODES.has(e.code) ? e.code : 'net' };
  }
  const d = res.data;
  if (!d || typeof d !== 'object' || typeof d.ok !== 'boolean') return { kind: 'retry', err: 'no_ok' };
  if (d.ok === true) return { kind: 'done', err: null };
  const err = typeof d.err === 'string' ? d.err : 'unknown';
  if (err === 'mj_session') return { kind: 'login', err }; // 倉庫の「ログインが切れている」＝捨てる帯に倒さない
  if (err === 'mj_reauth') return { kind: 'login', err, within_min: d.within_min }; // 入り直しの門（2c-2b）＝err で mj_session と分ける
  if (err === 'busy') return busyRetry(d.what) ? { kind: 'retry', err, what: d.what } : { kind: 'stop', err, what: d.what }; // P6g §1
  if (err === 'conflict') return { kind: 'conflict', err };
  if (err === 'gone') return { kind: 'reload', err };
  if (err === 'bad' && d.at === 'closed') return { kind: 'closed', err, at: d.at }; // 終えた部屋（倉庫 mj_write の閉じた門）＝捨てる帯に倒さない（B3b-1 約束①）
  if (err === 'dup' || err === 'linked') return { kind: 'stop', err, member_id: d.member_id, at: d.at, what: d.what };
  return { kind: 'stop', err, known: STOP_ERRS.has(err), at: d.at, what: d.what };
}

/* retry の待ち（ms）：2s・4s・8s…60s で止まる（回数で捨てない） */
export function retryDelay(n) {
  const k = Math.max(0, Math.min(Number.isInteger(n) ? n : 0, 10));
  return Math.min(60000, 2000 * 2 ** k);
}

/* 並びの先頭を止める（held を保存する＝読み込み直しでも残る） */
export function holdHead(outbox, err) {
  if (!outbox.length) return outbox;
  return [{ ...outbox[0], held: { err } }, ...outbox.slice(1)];
}
/* 「捨てる」＝先頭の1件だけを外す。後ろは held_after_drop＝2d の読み直し（mj_read）まで送らない
 * ★先頭が held closed（終えた部屋へ送れなかった点）なら外さない★（約束②＝［捨てる］で点を消さない・守りを lib に置く） */
export const heldClosed = (outbox) => !!(outbox.length && outbox[0].held && outbox[0].held.err === 'closed');
/* ★P6g §3（v1.1 止め1）：先頭が held busy なら、次の組に同じ held を移す★（読み直しの当て直しで印が消えて残りが黙って送られ、窓が空いた後に2重になる道を塞ぐ） */
export function dropHead(outbox) {
  if (heldClosed(outbox)) return outbox;
  const h = outbox.length ? outbox[0].held : null;
  if (h && h.err === 'busy') {
    const rest = outbox.slice(1);
    if (!rest.length) return rest;
    return [{ ...rest[0], held: { err: 'busy', ...(h.what !== undefined ? { what: h.what } : {}) } }, ...rest.slice(1)];
  }
  return outbox.slice(1).map((it) => ({ ...it, held_after_drop: true }));
}
/* P6g §3［もう一度送る］：先頭の held busy だけを外す（op_id・sent_at はそのまま＝倉庫は op_results を先に引く） */
export function unholdBusy(outbox) {
  if (!outbox.length || !outbox[0].held || outbox[0].held.err !== 'busy') return outbox;
  const { held, ...it } = outbox[0];
  return [it, ...outbox.slice(1)];
}
/* P6g §4：並びのどれかに held が在る（held_after_drop は含めない） */
export const heldAny = (outbox) => outbox.some((it) => !!it.held);
/* 今送ってよいか（先頭が held か、held_after_drop が在る間は送らない） */
export function canSend(outbox) {
  if (!outbox.length) return false;
  return !outbox[0].held && !outbox.some((it) => it.held_after_drop);
}
export function heldInfo(outbox) {
  if (!outbox.length) return null;
  if (outbox[0].held) return { why: outbox[0].held.err, n: outbox.length };
  if (outbox.some((it) => it.held_after_drop)) return { why: 'after_drop', n: outbox.length };
  return null;
}

/* ── 2c-2f 合図（2c2f_sadame.md v1.2 §2）＝中身は版の数だけ・中身は mj_read で読み直す ──
 * aizuSendV(d)＝mj_write の返し（data）が ok:true で read_ver が数の時だけ、その数（合図の payload.v）。それ以外は null＝送らない。
 * aizuReadV(payload, since)＝受けた合図の v が数で、今持っている since（写しを置き換えた時の read_ver・null＝まだ）より大きい時だけ v。それ以外は null＝読まない。
 *   ★v は since に入れない★（since は読みの返しの read_ver だけ＝偽の大きな v で控えを汚さない）。
 * AIZU_GAP_MS＝読みの始めと始めの間（連打の守り・間が足りない読みは捨てずに遅らせる）。 */
export const AIZU_GAP_MS = 250;
const isVer = (v) => typeof v === 'number' && Number.isFinite(v);
export function aizuSendV(d) {
  return d && typeof d === 'object' && d.ok === true && isVer(d.read_ver) ? d.read_ver : null;
}
export function aizuReadV(payload, since) {
  const v = payload && typeof payload === 'object' ? payload.v : undefined;
  if (!isVer(v)) return null;
  if (isVer(since) && v <= since) return null;
  return v;
}
