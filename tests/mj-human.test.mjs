// tests/mj-human.test.mjs — P10 §3 Edge Function mj-human の判定（check.mjs）を fetch の差し替えで確かめる（deno は無い＝node で）
// node tests/mj-human.test.mjs            … 答え合わせ
// node tests/mj-human.test.mjs --self-test … 判定をわざと壊して赤になるか
import { judge, verifyToken, SITEVERIFY } from '../supabase/functions/mj-human/check.mjs';

const ENV = { MJ_TURNSTILE_SECRET: 's', MJ_HOSTS: 'mj-test.example.app, other.app', MJ_TURNSTILE_TESTKEY_OK: '' };
const REAL = { success: true, hostname: 'mj-test.example.app', action: 'mj_human' };
const TESTK = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
const ok = (body) => async (url, init) => { ok.last = { url, init }; return { ok: true, json: async () => body }; };

function cases(j, v) {
  return [
    ['本物の鍵・host と action が合う', async () => (await v(ENV, 't', ok(REAL))).ok === true],
    ['host は大文字でも合う', async () => j(ENV, { ...REAL, hostname: 'MJ-TEST.example.app' }).ok === true],
    ['2つめの host', async () => j(ENV, { ...REAL, hostname: 'other.app' }).ok === true],
    ['success false', async () => j(ENV, { ...REAL, success: false }).reason === 'turnstile'],
    ['答えが空', async () => j(ENV, null).reason === 'turnstile'],
    ['試しの鍵・TESTKEY_OK 無し＝testkey', async () => j(ENV, TESTK).reason === 'testkey'],
    ['試しの鍵・TESTKEY_OK=1＝通す', async () => j({ ...ENV, MJ_TURNSTILE_TESTKEY_OK: '1' }, TESTK).ok === true],
    ['試しの鍵・TESTKEY_OK=true（1 でない）＝testkey', async () => j({ ...ENV, MJ_TURNSTILE_TESTKEY_OK: 'true' }, TESTK).reason === 'testkey'],
    ['違う host', async () => j(ENV, { ...REAL, hostname: 'evil.app' }).reason === 'host'],
    ['host の一部だけ一致は通さない', async () => j(ENV, { ...REAL, hostname: 'mj-test.example' }).reason === 'host'],
    ['違う action', async () => j(ENV, { ...REAL, action: 'login' }).reason === 'action'],
    ['action 無し（本物の鍵）', async () => j(ENV, { success: true, hostname: 'other.app' }).reason === 'action'],
    ['秘密が無い＝config（網へ出ない）', async () => { let hit = 0; const r = await v({ ...ENV, MJ_TURNSTILE_SECRET: '' }, 't', async () => { hit++; return { ok: true, json: async () => REAL }; }); return r.reason === 'config' && hit === 0; }],
    ['MJ_HOSTS が空＝config', async () => (await v({ ...ENV, MJ_HOSTS: ' ' }, 't', ok(REAL))).reason === 'config'],
    ['試しの鍵でも設定が無ければ config', async () => (await v({ MJ_TURNSTILE_TESTKEY_OK: '1' }, 't', ok(TESTK))).reason === 'config'],
    ['token 無し', async () => (await v(ENV, '', ok(REAL))).reason === 'turnstile'],
    ['token が字でない', async () => (await v(ENV, { a: 1 }, ok(REAL))).reason === 'turnstile'],
    ['網が落ちる＝net', async () => (await v(ENV, 't', async () => { throw new Error('x'); })).reason === 'net'],
    ['HTTP 500＝net', async () => (await v(ENV, 't', async () => ({ ok: false, json: async () => REAL }))).reason === 'net'],
    ['JSON が壊れ＝net', async () => (await v(ENV, 't', async () => ({ ok: true, json: async () => { throw new Error('j'); } }))).reason === 'net'],
    ['送る先・中身（secret と response だけ・remoteip 無し）', async () => {
      await v(ENV, 'tok', ok(REAL)); const b = JSON.parse(ok.last.init.body);
      return ok.last.url === SITEVERIFY && ok.last.init.method === 'POST' && b.secret === 's' && b.response === 'tok' && Object.keys(b).length === 2;
    }],
  ];
}

async function run(j, v) { let pass = 0, fail = [];
  for (const [n, f] of cases(j, v)) { let r = false; try { r = await f(); } catch { r = false; } r ? pass++ : fail.push(n); }
  return { pass, fail };
}

if (process.argv.includes('--self-test')) {
  // 壊し方ごとに、上の答え合わせのどれかが赤になるか
  const W = [
    ['試しの鍵を TESTKEY_OK 無しで通す', (e, s) => (s?.metadata?.result_with_testing_key ? { ok: true } : judge(e, s))],
    ['host を見ない', (e, s) => judge({ ...e, MJ_HOSTS: String(s?.hostname || 'x') + ',' + e.MJ_HOSTS }, s)],
    ['action を見ない', (e, s) => judge(e, s && s.success ? { ...s, action: 'mj_human' } : s)],
    ['success を見ない', (e, s) => judge(e, { ...(s || {}), success: true })],
  ];
  const V = [
    ['設定が無くても網へ出る', async (e, t, f) => { try { const r = await f(SITEVERIFY, { method: 'POST', body: '{}' }); return judge(e, await r.json()); } catch { return { ok: false, reason: 'net' }; } }],
    ['網の失敗を turnstile と言う', async (e, t, f) => { const r = await verifyToken(e, t, f); return r.reason === 'net' ? { ok: false, reason: 'turnstile' } : r; }],
  ];
  let red = 0, all = 0;
  for (const [n, jj] of W) { all++; const r = await run(jj, (e, t, f) => verifyToken(e, t, f, jj)); if (r.fail.length) red++; else console.log('  ✗ 赤にならない:', n); }
  for (const [n, vv] of V) { all++; const r = await run(judge, vv); if (r.fail.length) red++; else console.log('  ✗ 赤にならない:', n); }
  console.log(`mj-human --self-test: ${red}/${all} 壊しが赤`);
  process.exit(red === all ? 0 : 1);
}

const r = await run(judge, verifyToken);
for (const n of r.fail) console.log('  ✗', n);
console.log(`mj-human.test: ${r.pass}/${r.pass + r.fail.length}`);
process.exit(r.fail.length ? 1 : 0);
