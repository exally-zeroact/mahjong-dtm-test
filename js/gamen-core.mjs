/* gamen-core.mjs — ★画面の土台★（ログイン・倉庫の呼び・入った部屋の覚え・返しの字）
 * =============================================================================
 * 設計図 v18.3 §3.0 C・G・K-6・K-10／§6。
 * - 倉庫の向き先は js/supa-config.js の window.SUPA だけを使う（ここに URL・鍵を書かない）。
 * - ログインは全アプリ共通の部品 js/exally-login.js（メール＋パスワードは常に同時・司さん 11-20）。
 * - 外から呼ぶのは public.mj_* の RPC だけ。jwt 切れの 401 も {err:'mj_session'} と同じに扱う（K-10）。
 * - 入った部屋は端末に「人（user_id）ごとに」覚える（別の人が同じ端末で入っても前の人の部屋を出さない・K-10）。
 */
import { humanPass } from './gamen-human.mjs';
export const APP = '麻雀〜do the math〜';
/* 11-27 23時 司さん「デフォで入ってる名前ださいから do the math にしろ」＝部屋の名が無い時と、部屋なし（solo）の置き名「対局」（倉庫の行もこの字）の時だけ。見出しの題は変えない */
export const ROOM_DEFAULT = 'do the math';
export const roomLabel = (r) => (r && r.name && !(r.kind === 'solo' && r.name === '対局') ? r.name : ROOM_DEFAULT);

let sbClient = null;
export function sb() {
  if (sbClient) return sbClient;
  const S = globalThis.SUPA;
  if (!S || !S.url || !S.key) throw new Error('supa-config が読めていません');
  if (!globalThis.supabase || !globalThis.supabase.createClient) throw new Error('supabase-js が読めていません');
  sbClient = globalThis.supabase.createClient(S.url, S.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'mj-auth' },
  });
  return sbClient;
}

/* ── 2b（login2b_sadame v2 §1）：ログインの誤りが来た時だけ鍵を引き直す ──
 * authCheck()＝{kind:'ok',user}｜{kind:'net',user}｜{kind:'out'}。1本だけ走らせる（同時の呼びは同じ答えを待つ）。
 * ★ログインの画面を出すのは 'out' の時だけ★（電波の時は端末に残っている同じ人で続ける＝別の人の控えに混ざらない） */
const AUTH_KEY = 'mj-auth';
const GUARD_MS = 30000; // 引き直しが通ってから30秒の間に始めた呼びがまた弾かれた＝本当に切れている（引き直しを回し続けない）
let authP = null, okAt = 0;
function storedAuth() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return s && typeof s.refresh_token === 'string' && s.refresh_token ? s : null;
  } catch { return null; }
}
const realUser = (u) => (u && typeof u.id === 'string' && !u.is_anonymous ? u : null);
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
export function authCheck() {
  if (authP) return authP;
  authP = (async () => {
    const s0 = storedAuth();
    if (!s0) return { kind: 'out' };
    const su = realUser(s0.user);
    if (!su) return { kind: 'out' };
    if (isOffline()) return { kind: 'net', user: su };
    let r;
    try { r = await sb().auth.refreshSession({ refresh_token: s0.refresh_token }); } catch (e) { r = { error: e || {} }; }
    if (!storedAuth()) return { kind: 'out' }; // 倉庫の部品が控えを消した＝本当に切れた
    const u = realUser(r && r.data && r.data.session && r.data.session.user);
    if (r && !r.error && u) { okAt = Date.now(); return { kind: 'ok', user: u }; }
    const e = (r && r.error) || {};
    if (e.name === 'AuthApiError' && (e.status === 400 || e.status === 401 || e.status === 403)) return { kind: 'out' }; // 鍵が取り消された・無い
    return { kind: 'net', user: su }; // つながらない・混んでいる・他の窓と重なった＝切れたとは決めない
  })().finally(() => { authP = null; });
  return authP;
}
/* ログインの誤り（401・jwt・倉庫の mj_session）か。403 は入れない（権限の外＝今まで通り）・mj_reauth は入れない（パスワードの入れ直しの門） */
function loginErr(r) {
  if (!r || typeof r !== 'object') return false;
  const e = r.error;
  if (e) {
    const st = r.status ?? e.status ?? e.statusCode;
    if (st === 401) return true;
    if (e.code === 'PGRST301' || e.code === 'PGRST302' || e.code === 'PGRST303') return true;
    return /JWT expired|invalid JWT|JWSError|not authenticated/i.test(String(e.message || ''));
  }
  return !!(r.data && typeof r.data === 'object' && r.data.ok === false && r.data.err === 'mj_session');
}
const NET_RES = () => ({ data: null, error: { message: 'net (auth)' } }); // status 無しの error＝どの呼び手でも「電波」の道（outboxStep は retry）
/* sb().rpc を直に呼ぶ（返し＝{data,error,status} の形のまま）。ログインの誤りなら鍵を引き直して1回だけやり直す
 * ★1回の呼びにつき引き直しは1回★・電波で届かなかった時は数えない（呼び手の今の送り直しが次にまた来る） */
async function rpcAuth(fn, args) {
  const t0 = Date.now();
  const call = async () => { try { return await sb().rpc(fn, args); } catch (e) { return { error: { message: String((e && e.message) || e) } }; } };
  const r = await call();
  if (!loginErr(r)) return r;
  if (okAt > t0) return await call(); // 走っている間に別の呼びが引き直した＝新しい鍵でやり直すだけ
  if (okAt && t0 - okAt < GUARD_MS) return r; // 引き直した後に始めた呼びがまた弾かれた＝本当に切れている
  const a = await authCheck();
  if (a.kind === 'ok') return await call();
  if (a.kind === 'net') return NET_RES();
  return r;
}
/* P10 §4：書きが {ok:false, err:'human'}（この垢はまだ人の確かめを通っていない）なら、確かめを1回出して、通れば同じ呼びを1回だけやり直す
 * （同じ args＝同じ op_id。倉庫は human の門で何も書かずに返している）。通らなければ human の返しのまま＝呼び手が「確認できませんでした」を出す。読みには来ない */
const humanErr = (r) => !!(r && !r.error && r.data && typeof r.data === 'object' && r.data.ok === false && r.data.err === 'human');
export const humanCheck = () => humanPass({ sb, authCheck });
export async function rpcRaw(fn, args) {
  const r = await rpcAuth(fn, args);
  if (!humanErr(r)) return r;
  if (!(await humanCheck())) return r;
  return await rpcAuth(fn, args);
}

/* ── 倉庫の呼び：返しは必ず object（{ok:true,…} か {ok:false, err, …}）にそろえる ── */
export async function rpc(fn, args) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, err: 'offline' };
  const r = await rpcRaw(fn, args);
  if (r.error) {
    const st = r.status || 0;
    if (st === 401 || st === 403 || /jwt/i.test(r.error.message || '')) return { ok: false, err: 'mj_session' };
    if (!st) return { ok: false, err: 'net', detail: r.error.message };
    return { ok: false, err: 'server', detail: r.error.message, status: st };
  }
  const d = r.data;
  if (!d || typeof d !== 'object') return { ok: false, err: 'server', detail: '返しが object でない' };
  return d;
}

/* ── 返しの字（客に見せる字・ここ1か所） ──
 * way＝'create'（作る）｜'name'（部屋名＋パスで入る）｜'url'（URL・QR で入る）｜'close'（部屋を終える・B3b-1）｜'delete'（部屋を消す・A6）｜'league'（リーグの op・D1）。同じ err でも道で意味が違う（gamen_b3a_sadame v1.1）：
 * busy user（作る＝1人1日5つ／入る＝1分10回の外れ）・full（作る＝倉庫の枠／入る＝部屋の人数）・wrong（名前の道／URL の道）・locked（作る＝名前の止め） */
export function errText(res, way) {
  const e = res && res.err;
  const w = res && res.what;
  const join = way === 'name' || way === 'url';
  // way 'close'＝［部屋を終える］（gamen_b3b_sadame v4.1 §2・鍵は at と what の両方を見る）
  if (way === 'close') {
    const at = res && (res.at || res.what);
    if (e === 'bad' && at === 'closed') return 'この部屋はもう終わっています。';
    if (e === 'bad' && at === 'kind') return '部屋なしの対局は終えられません。';
    // full＝H2（h1b_sadame v2.3）の後は op_results の mj_caps 行の欠けだけ（記録の上限は無い・fullji_sadame v1.1 §2）
    if (e === 'full') return '倉庫で止まりました。今は終えられません。';
    if (e === 'mj_reauth') return '部屋を終えるには、パスワードでもう一度ログインしてください。';
    if (e === 'mj_role') return '部屋を終えられるのは部屋の持ち主だけです。';
  }
  // way 'delete'＝［部屋を消す］（a6_sadame v1.3 §1）
  if (way === 'delete') {
    if (e === 'full') return '倉庫で止まりました。今は消せません。';
    if (e === 'mj_reauth') return '部屋を消すには、パスワードでもう一度ログインしてください。';
    if (e === 'mj_role') return '部屋を消せるのは部屋の持ち主だけです。';
  }
  // way 'league'＝リーグの op（league_create・league_save・league_owner_set／d1_sadame v2.1 §1 の表・bad は at か what を見る）。
  // 表に無い err（mj_session・busy・net・offline・server・mj_op_other_user・dup・知らない err）は下の今の字のまま
  if (way === 'league') {
    const at = res && (res.at || res.what);
    // D2（d2_sadame v1.1 §3）：リーグの日の dup＝読み直して開く（字は出さない）・L でない入が卓と日を足そうとした
    if (e === 'dup' && at === 'session') return '';
    if (e === 'mj_role' && res.need === 'L') return '卓と日を足せるのはリーグの L だけです';
    // full＝H2 の後は op_results の mj_caps 行の欠けだけ（leagues・*・history・rule_sets の上限は無い・fullji_sadame v1.1 §2）
    if (e === 'full') return '倉庫で止まりました。もう一度押しても同じです。';
    if (e === 'mj_role') return 'この操作は管か持ち主だけです（リーグの設定はそのリーグの L だけ）。';
    if (e === 'mj_reauth') return 'パスワードでもう一度ログインしてください。';
    if (e === 'gone') return 'この部屋は消されているか、入れなくなりました。';
    if (e === 'internal') return '倉庫で止まりました。もう一度押しても同じです。';
    if (e === 'conflict') return '他の人が先に変えました。新しい中身で開き直しました。';
    if (e === 'bad') {
      if (at === 'closed') return 'この部屋は終わっているのでリーグを作れません。';
      if (at === 'league' || at === 'league_id') return 'このリーグは見つかりません。読み直しました。';
      if (at === 'name') return 'リーグの名前は1〜40字で入れてください。';
      if (at === 'date_from' || at === 'date_to') return '期間は始め≦終わりで入れてください。';
      if (at === 'rules' || at === 'rules_alt') return 'ルールの人数が合いません。';
      if (at === 'date') return '今日はこのリーグの期間の外です'; // D2：session_add の期間の門
      if (at === 'alt') return 'この日はもう一方の卓を作れません';  // D2：table_add の alt
      if (at === 'rate') return '倉庫で止まりました。もう一度押しても同じです。'; // D2：リーグの日の rate
    }
  }
  switch (e) {
    case 'mj_session': return 'ログインが切れました。ログインし直してください。';
    case 'human': return '確認できませんでした。もう一度押してください。'; // P10 §1（［捨てる］は出さない）
    case 'offline': return '電波がありません。つながってからもう一度押してください。';
    case 'net': return 'つながりませんでした。電波を確かめてもう一度押してください。';
    case 'common': return 'よく使われるパスは使えません。別のパスにしてください。';
    case 'wrong': return way === 'url' ? 'この URL の部屋は見つかりません。もらった URL を確かめてください。' : '部屋名かパスが違います。';
    case 'ambiguous': return '同じ名前とパスの部屋が2つ在ります。URL・QR で入ってください。';
    case 'closed': return 'この部屋は終わりました。';
    case 'dup': return w === 'name_pass' ? 'その名前とパスの部屋は今使われています。' : '送り直しが合いませんでした。もう一度最初から押してください。';
    case 'locked':
      if (way === 'create') return 'その部屋名は打ち間違いが続いたので、' + hhmm(res.until) + ' まで使えません。';
      return '打ち間違いが続いたので、' + hhmm(res.until) + ' まで入れません。';
    case 'gone': return 'この部屋は消されています。';
    case 'removed': return 'この部屋からは外されています。部屋の管の人に訊いてください。';
    // 上限を外した後（caps_sadame v1.1 §3）：full は書きの op_results の mj_caps 行の欠けだけ＝入る・作る・名簿・管・名乗りの「いっぱい」は倉庫がもう返さない
    case 'full': return '倉庫で止まりました。もう一度押しても同じです。';
    case 'mismatch': case 'mj_op_other_user': return '送り直しが合いませんでした。もう一度最初から押してください。';
    case 'range': return 'その数は入れられません（範囲）' + (res.key ? '：' + ruleLabel(res.key) : '');
    case 'busy':
      // user＝入るの打ち間違い（ufail1m）だけ残る・作る／共有の1日の数（u1d）は外した（caps_sadame v1.1 §3）
      if (w === 'user' && join) return '打ち間違いが続いたので、1分待ってもう一度。';
      if (w === 'name') return 'その名前の部屋が多すぎます。別の名前にしてください。';
      // P3g（pbundle_sadame v2.1 §2 S5）：人ごとの窓。'all'（全体の窓）は倉庫がもう返さない＝分かれ道を消した
      if (w === 'user_min') return '少し待ってからもう一度押してください。';
      if (w === 'user_day') return '入る試しが多すぎます。' + (untilOk(res.until) ? hhmm(res.until) + ' からもう一度押してください。' : '時間をおいてもう一度押してください。');
      // P6g §5（p6g_sadame v1.1）：書きの窓（write:*）は what で字を分ける＝1日の窓で「1分待って」を出さない・頼める人がいない道もあるので「他の人に」は言わない
      if (typeof w === 'string' && w.startsWith('write:')) {
        if (['write:un1d', 'write:uk1d', 'write:u1d', 'write:rk1d', 'write:rn1d'].includes(w)) return '24時間に書ける数を越えたので、今は送れません。時間をおいてもう一度押してください。';
        if (!['write:rn1m', 'write:u1m', 'write:ur1m'].includes(w)) return '書ける数を越えました（' + w + '）。時間をおいてもう一度押してください。';
      }
      return '混んでいます。1分待ってもう一度押してください。';
    case 'bad':
      if (w === 'name') return '部屋の名前を1〜40字で入れてください。';
      if (w === 'pass') return 'パスは数字4つで入れてください。';
      if (w === 'kind') return '送り直しが合いませんでした。もう一度最初から押してください。';
      if (w === 'key') return 'URL が途中で切れています。もらった URL をそのまま開いてください。';
      return '入れた物が足りません（' + (w || '?') + '）。';
    case 'server': return '倉庫で止まりました（' + (res.detail || '') + '）。';
    default: return '止まりました（' + (e || '?') + '）。';
  }
}
const untilOk = (t) => t !== undefined && t !== null && t !== '' && !isNaN(new Date(t)); // until が読めない時は時刻を出さない
function hhmm(t) {
  const d = new Date(t);
  if (isNaN(d)) return 'しばらく';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
const RULE_LABEL = {
  players: '人数', rate: 'レート', start_pts: '持ち点', return_pts: '返し', uma: 'ウマ',
  chip_pt10: 'チップ1枚の pt', shugi_pt10: '祝儀1枚の pt', tobi_pt: '飛び賞', '(unknown)': '知らない設定', '(object)': 'ルール',
};
export function ruleLabel(k) { return RULE_LABEL[k] || k; }

/* ── ログイン ── */
let loginUi = null;
const SESSION_WAIT_MS = 5000; // 鍵の引き直しが電波で長引く時（倉庫の部品は最大30秒やり直す）は、端末に残っている同じ人で先に進む（2b §6 O4）
/* 返しは user か null だけ（印の型は作らない・2b §2）。null＝本当にログインしていない時だけ */
export async function currentUser() {
  const s0 = storedAuth();
  const g = sb().auth.getSession().then((r) => (r && r.data && r.data.session) || null, () => null);
  const late = {};
  const s = s0 ? await Promise.race([g, new Promise((ok) => setTimeout(() => ok(late), SESSION_WAIT_MS))]) : await g;
  if (s === late) return realUser(s0.user);
  const u = realUser(s && s.user);
  if (u) return u;
  if (!storedAuth()) return null;
  const a = await authCheck();
  return a.kind === 'out' ? null : a.user;
}
/* ログインしていなければ共通のログイン画面を出し、入ったら onUser(user) を呼ぶ。onOut＝ログインしていないと決まった時だけ（頁のログインの箱を出す） */
export async function needLogin(onUser, onOut) {
  const u = await currentUser();
  if (u) { onUser(u); return; }
  if (onOut) onOut();
  showLogin(onUser);
}
/* ★呼びごとの onUser を持つ★（部品は mount の1回しか作らない＝最初の cb を閉じ込めると、2回目の showLogin の続きが捨てられる）
 * 部品の setNewPass は ok(null) を返すことがある＝その時は今の人を引き直してから渡す */
let loginNext = null;
export function showLogin(onUser) {
  if (!globalThis.ExallyLogin) throw new Error('exally-login.js が読めていません');
  loginNext = onUser || null;
  if (!loginUi) {
    loginUi = globalThis.ExallyLogin.mount({
      app: '麻雀の点数・精算',
      brand: '🀄 ' + APP,
      brandSub: '',
      theme: themeFromCss(),
      note: '一度ログインすれば、次からは自動で入れます。戦績はアカウントごとに残ります。',
      sb: sb(),
      onLogin: async (user) => {
        const u = user || (await currentUser());
        const next = loginNext; loginNext = null;
        if (u && next) next(u);
      },
    });
  }
  loginUi.show();
}
/* ★色は css/app.css の :root の変数だけが持つ★＝部品は hex しか受けないので、その場で読んで渡す */
function themeFromCss() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { bg: v("--c-haikei"), card: v("--c-men"), line: v("--c-sen"), accent: v("--c-kon"), accentDark: v("--c-kon"), title: v("--c-ji"), muted: v("--c-ji-usui"), ink: v("--c-ji"), link: v("--c-kon"), danger: v("--c-aka"), shadow: "rgba(0,0,0,.08)" };
}
export async function logout() {
  await sb().auth.signOut({ scope: 'local' });
}

/* ── 入った部屋の覚え（人ごと・端末の中だけ） ── */
const ROOMS_KEY = (uid) => 'mj-rooms:' + uid;
export function myRooms(uid) {
  try {
    const a = JSON.parse(localStorage.getItem(ROOMS_KEY(uid)) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
/* room＝{room_id, kind, name, role, token?}（kind＝'shared'｜'solo'・古い控えは kind 無し＝shared・番号は持たない＝古い控えに在っても出さない。token は作った人か URL で入った人だけが持つ＝URL を回せる） */
export function rememberRoom(uid, room) {
  const a = myRooms(uid).filter((x) => x.room_id !== room.room_id);
  const old = myRooms(uid).find((x) => x.room_id === room.room_id) || {};
  a.unshift({ ...old, ...room, at: Date.now() });
  localStorage.setItem(ROOMS_KEY(uid), JSON.stringify(a)); // A15g §3.2b：切らない（token・A6 の消した印・送りの残りを落とさない・履歴に上限を作らない）
}
/* 控えの行だけを書き換える（★並びと at を変えない＝rememberRoom の unshift を通さない★・2d §3／B3b-1 約束④⑦）。
 * 部屋の rules・closed を足す時に使う。控えに無い部屋は何もしない（null）。返し＝書き換えた後の行 */
export function patchRoom(uid, roomId, patch) {
  const a = myRooms(uid);
  const i = a.findIndex((x) => x.room_id === roomId);
  if (i < 0) return null;
  a[i] = { ...a[i], ...patch, at: a[i].at };
  localStorage.setItem(ROOMS_KEY(uid), JSON.stringify(a));
  return a[i];
}
export function forgetRoom(uid, roomId) {
  localStorage.setItem(ROOMS_KEY(uid), JSON.stringify(myRooms(uid).filter((x) => x.room_id !== roomId)));
}

/* ── 部屋の URL（/r/<token>・設計図 §6） ── */
export function roomUrl(token) {
  return location.origin + '/r/' + token;
}
export function tokenFromPath(path) {
  const m = /^\/r\/([0-9a-f]{32})\/?$/.exec(path || '');
  return m ? m[1] : null;
}

/* ── 小物 ── */
export const $ = (id) => document.getElementById(id);
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
