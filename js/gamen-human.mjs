/* gamen-human.mjs — P10 人の確かめ（Cloudflare Turnstile）＝p10_sadame_v1.md v1.1 §1・§4
 * =============================================================================
 * - 倉庫の書き（mj_room_create・mj_room_join・mj_write）が {ok:false, err:'human'} を返した時だけ呼ぶ（gamen-core.mjs rpcRaw）。
 *   読み（mj_my_rooms・mj_read・mj_account・mj_my_rules）は呼ばない＝確かめは出ない。
 * - humanPass({sb, authCheck})＝true（通った＝倉庫に印が付いた）｜false（通らない・つながらない）。★1本だけ走らせる★（同時に弾かれた呼びは同じ答えを待つ＝窓は1つ）。
 * - api.js は ここで初めて読む（他の頁では Cloudflare に1本も出さない）。site key は js/supa-config.js の SUPA.turnstile だけ。
 * - 通った字は出さない（いつもは押す物も無い）。通らない時の帯（確認できませんでした［もう一度］）は呼び手が出す（［捨てる］は出さない）。
 */
const API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const LOAD_MS = 20000, TOKEN_MS = 120000;

let passP = null;
export function humanPass(deps) {
  if (passP) return passP;
  passP = run(deps).catch(() => false).finally(() => { passP = null; });
  return passP;
}

let apiP = null;
function loadApi() {
  if (globalThis.turnstile && typeof globalThis.turnstile.render === 'function') return Promise.resolve(true);
  if (apiP) return apiP;
  apiP = new Promise((res) => {
    const s = document.createElement('script');
    s.src = API; s.async = true;
    const t = setTimeout(() => res(false), LOAD_MS);
    s.onload = () => { clearTimeout(t); res(!!(globalThis.turnstile && typeof globalThis.turnstile.render === 'function')); };
    s.onerror = () => { clearTimeout(t); res(false); };
    document.head.appendChild(s);
  }).then((ok) => { if (!ok) apiP = null; return ok; }); // 読めなかった時は次の［もう一度］でまた読む
  return apiP;
}

function getToken(sitekey) {
  return new Promise((res) => {
    const box = document.createElement('div');
    box.className = 'mj-human'; box.id = 'mjHuman';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '確認しています');
    box.innerHTML = '<div class="mj-human-in"><p>確認しています…</p><div id="mjHumanW"></div></div>';
    document.body.appendChild(box);
    let id = null, done = false;
    const end = (tok) => {
      if (done) return; done = true; clearTimeout(t);
      try { if (id !== null) globalThis.turnstile.remove(id); } catch { /* 外せなくても進む */ }
      box.remove(); res(tok);
    };
    const t = setTimeout(() => end(null), TOKEN_MS);
    try {
      id = globalThis.turnstile.render(box.querySelector('#mjHumanW'), {
        sitekey, action: 'mj_human', language: 'ja',
        callback: (tok) => end(typeof tok === 'string' && tok ? tok : null),
        'error-callback': () => end(null), 'expired-callback': () => end(null), 'timeout-callback': () => end(null),
      });
    } catch { end(null); }
  });
}

async function accessToken(sb) {
  try { const r = await sb().auth.getSession(); return (r && r.data && r.data.session && r.data.session.access_token) || ''; } catch { return ''; }
}

/* mj-human へ送る（返し＝true｜false｜'auth'＝鍵が古い） */
async function post(sb, token) {
  const S = globalThis.SUPA;
  const jwt = await accessToken(sb);
  if (!jwt) return 'auth';
  try {
    const r = await fetch(S.url + '/functions/v1/mj-human', {
      method: 'POST',
      headers: { apikey: S.key, Authorization: 'Bearer ' + jwt, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (r.status === 401) return 'auth';
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    return !!(d && d.ok === true);
  } catch { return false; }
}

async function run({ sb, authCheck }) {
  const S = globalThis.SUPA;
  if (!S || !S.url || !S.key || typeof S.turnstile !== 'string' || !S.turnstile) return false;
  if (typeof document === 'undefined') return false;
  if (!(await loadApi())) return false;
  const tok = await getToken(S.turnstile);
  if (!tok) return false;
  let ok = await post(sb, tok);
  if (ok === 'auth') { // 鍵が古い＝1回だけ引き直して同じ token で送る（401 は mj-human が Cloudflare に問う前に返す＝token はまだ使われていない）
    const a = await authCheck();
    ok = a.kind === 'ok' ? await post(sb, tok) : false;
  }
  return ok === true;
}
