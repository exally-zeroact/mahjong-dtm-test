/* outbox.mjs — ★未送信の並び（mj_write へ送る op の組）の受け方★（純関数・画面と node 試験が同じ物を使う）
 * =============================================================================
 * 取り決め＝memory/mahjong_tataki_2026-11-20/write_sekkei.md §6-11・12・14・14'（v5.2）／画面側の紙＝gamen_write_awase_v1.md v4 節。
 * ★今は WRITE_READY=false＝画面からはまだ送らない★（読み直し mj_read〔2d〕が来るまで true にしない）。
 *
 * outboxStep(res) … res＝supabase-js の rpc の返り { data, error } か、投げた例外を包んだ { error }。
 *   判じの順（先に login を見る＝JWT 切れを retry で回し続けない）：
 *   ① error が 401／JWT（PGRST301・'JWT expired' など）・err 'mj_session' → 'login'（送るのを止める・並びは捨てない）
 *      err 'mj_reauth'（2c-2b 入り直しの門）も 'login'・err は 'mj_reauth' のまま返す＝受け手は refresh だけで送り直さない（amr は refresh で変わらない）・パスワードで入り直してから同じ op_id で送る
 *   ② 返りが無い・data に ok が無い・網の失敗・55P03・40P01・busy  → 'retry'（同じ op_id で後で送り直す・捨てない）
 *   ③ ok:true                                                      → 'done'
 *   ④ conflict → 'conflict'／gone → 'reload'（部屋を読み直す）
 *      dup・linked（2c-2b）→ 'stop'（member_id を添える＝置き換えは 2d）／mj_role（2c-2b）／bad・range・not_yet・full・too_many・internal・mj_op_other_user・知らない err → 'stop'
 * 返し：{ kind, err, member_id? }
 */

const JWT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const RETRY_CODES = new Set(['55P03', '40P01']);
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
  if (e) {
    if (isLoginError(e)) return { kind: 'login', err: 'login' };
    return { kind: 'retry', err: RETRY_CODES.has(e.code) ? e.code : 'net' };
  }
  const d = res.data;
  if (!d || typeof d !== 'object' || typeof d.ok !== 'boolean') return { kind: 'retry', err: 'no_ok' };
  if (d.ok === true) return { kind: 'done', err: null };
  const err = typeof d.err === 'string' ? d.err : 'unknown';
  if (err === 'mj_session') return { kind: 'login', err }; // 倉庫の「ログインが切れている」＝捨てる帯に倒さない
  if (err === 'mj_reauth') return { kind: 'login', err, within_min: d.within_min }; // 入り直しの門（2c-2b）＝err で mj_session と分ける
  if (err === 'busy') return { kind: 'retry', err };
  if (err === 'conflict') return { kind: 'conflict', err };
  if (err === 'gone') return { kind: 'reload', err };
  if (err === 'dup' || err === 'linked') return { kind: 'stop', err, member_id: d.member_id };
  return { kind: 'stop', err, known: STOP_ERRS.has(err) };
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
/* 「捨てる」＝先頭の1件だけを外す。後ろは held_after_drop＝2d の読み直し（mj_read）まで送らない */
export function dropHead(outbox) {
  return outbox.slice(1).map((it) => ({ ...it, held_after_drop: true }));
}
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
