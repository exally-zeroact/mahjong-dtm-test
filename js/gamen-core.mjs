/* gamen-core.mjs — ★画面の土台★（ログイン・倉庫の呼び・入った部屋の覚え・返しの字）
 * =============================================================================
 * 設計図 v18.3 §3.0 C・G・K-6・K-10／§6。
 * - 倉庫の向き先は js/supa-config.js の window.SUPA だけを使う（ここに URL・鍵を書かない）。
 * - ログインは全アプリ共通の部品 js/exally-login.js（メール＋パスワードは常に同時・司さん 11-20）。
 * - 外から呼ぶのは public.mj_* の RPC だけ。jwt 切れの 401 も {err:'mj_session'} と同じに扱う（K-10）。
 * - 入った部屋は端末に「人（user_id）ごとに」覚える（別の人が同じ端末で入っても前の人の部屋を出さない・K-10）。
 */
export const APP = '麻雀〜do the math〜';

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

/* ── 倉庫の呼び：返しは必ず object（{ok:true,…} か {ok:false, err, …}）にそろえる ── */
export async function rpc(fn, args) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, err: 'offline' };
  let r;
  try {
    r = await sb().rpc(fn, args);
  } catch (e) {
    return { ok: false, err: 'net', detail: String(e && e.message || e) };
  }
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

/* ── 返しの字（客に見せる字・ここ1か所） ── */
export function errText(res) {
  const e = res && res.err;
  const w = res && res.what;
  switch (e) {
    case 'mj_session': return 'ログインが切れました。ログインし直してください。';
    case 'offline': return '電波がありません。つながってからもう一度押してください。';
    case 'net': return 'つながりませんでした。電波を確かめてもう一度押してください。';
    case 'common': return 'よく使われるパスは使えません。別のパスにしてください。';
    case 'wrong': return '部屋番号かパスが違います。';
    case 'locked': return '打ち間違いが続いたので、' + hhmm(res.until) + ' まで入れません。';
    case 'gone': return 'この部屋は消されています。';
    case 'removed': return 'この部屋からは外されています。部屋の管の人に訊いてください。';
    case 'full': return '今は部屋を作れません（倉庫がいっぱいです）。少し待ってからもう一度。';
    case 'mismatch': case 'mj_op_other_user': return '送り直しが合いませんでした。もう一度最初から押してください。';
    case 'range': return 'その数は入れられません（範囲）' + (res.key ? '：' + ruleLabel(res.key) : '');
    case 'busy':
      if (w === 'user') return '1人が1日に作れる部屋は5つまでです。明日もう一度。';
      if (w === 'room') return 'この部屋は今混んでいます。1分待ってもう一度。';
      return '混んでいます。1分待ってもう一度押してください。';
    case 'bad':
      if (w === 'name') return '部屋の名前を1〜40字で入れてください。';
      if (w === 'pass') return 'パスは4字以上で入れてください。';
      if (w === 'room_no') return '部屋番号は8桁の数字です。';
      if (w === 'key') return 'URL が途中で切れています。もらった URL をそのまま開いてください。';
      return '入れた物が足りません（' + (w || '?') + '）。';
    case 'server': return '倉庫で止まりました（' + (res.detail || '') + '）。';
    default: return '止まりました（' + (e || '?') + '）。';
  }
}
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
export async function currentUser() {
  const r = await sb().auth.getSession();
  const s = r && r.data && r.data.session;
  return s && s.user && !s.user.is_anonymous ? s.user : null;
}
/* ログインしていなければ共通のログイン画面を出し、入ったら onUser(user) を呼ぶ */
export async function needLogin(onUser) {
  const u = await currentUser();
  if (u) { onUser(u); return; }
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
/* room＝{room_id, room_no, name, role, token?}（token は作った人か URL で入った人だけが持つ＝URL を回せる） */
export function rememberRoom(uid, room) {
  const a = myRooms(uid).filter((x) => x.room_id !== room.room_id);
  const old = myRooms(uid).find((x) => x.room_id === room.room_id) || {};
  a.unshift({ ...old, ...room, at: Date.now() });
  localStorage.setItem(ROOMS_KEY(uid), JSON.stringify(a.slice(0, 30)));
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
