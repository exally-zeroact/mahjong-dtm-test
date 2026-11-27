/* sweep-mihari.mjs — 掃除の見張り5つ（P7 p7_sadame v2.1 §1-6 ②③）＝読むだけ・1本の式
 * =============================================================================
 * db-checks.live.mjs が khaw で使い（わざと1つずつ壊して赤も見る）、本番の後の kensan とコンサルの週1の読みも同じ式を使う（本番は読むだけ）。
 *  1 消して8日を越えて残る部屋 0
 *  2 直近2日（今日と昨日）の sweep:bad 0
 *  3 直近2日の sweep:tailbad 0
 *  4 cron.job の mj-sweep-tick・mj-sweep-tail・mj-wwatch（P9 の書きの量の見張り・5分ごと）が1本ずつ・active
 *  5 どれも最後の succeeded が AGE_S 以内（tick・tail 5分／wwatch 11分）・直近1日の failed 0
 * ★読めない時も赤★（式が落ちる＝cron が無い等・欄が欠ける・数でない）。
 * 使い方（khaw だけ）: node scripts/sweep-mihari.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const JOBS = ['mj-sweep-tick', 'mj-sweep-tail', 'mj-wwatch'];
export const AGE_S = { 'mj-sweep-tick': 300, 'mj-sweep-tail': 300, 'mj-wwatch': 660 };

/** jsonb を返す式（select の中にも plpgsql の := にも置ける） */
export const MIHARI_EXPR = `jsonb_build_object(
  'old_rooms', (select count(*) from mahjong.rooms x where x.deleted_at < now() - interval '8 days'),
  'bad2d', (select count(*) from mahjong.limits l where l.kind = 'sweep:bad' and l.window_start >= date_trunc('day', now()) - interval '1 day'),
  'tailbad2d', (select count(*) from mahjong.limits l where l.kind = 'sweep:tailbad' and l.window_start >= date_trunc('day', now()) - interval '1 day'),
  'jobs', (select jsonb_object_agg(n, jsonb_build_object(
      'all', (select count(*) from cron.job j where j.jobname = n),
      'active', (select count(*) from cron.job j where j.jobname = n and j.active),
      'ok_age_s', (select extract(epoch from now() - max(d.end_time)) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = n and d.status = 'succeeded'),
      'failed1d', (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = n and d.status = 'failed' and d.start_time > now() - interval '1 day')))
    from unnest(array['mj-sweep-tick', 'mj-sweep-tail', 'mj-wwatch']) n))`;

/** 赤の名の並び（空＝緑）。m が読めない・欄が欠ける時も赤 */
export function mihariAka(m) {
  const aka = [];
  const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  if (!m || typeof m !== 'object') return ['読めない'];
  if (num(m.old_rooms) !== 0) aka.push('1 消して8日を越えて残る部屋=' + m.old_rooms);
  if (num(m.bad2d) !== 0) aka.push('2 直近2日の sweep:bad=' + m.bad2d);
  if (num(m.tailbad2d) !== 0) aka.push('3 直近2日の sweep:tailbad=' + m.tailbad2d);
  for (const n of JOBS) {
    const j = m.jobs && m.jobs[n];
    if (!j) { aka.push('4 ' + n + ' 読めない'); continue; }
    if (num(j.all) !== 1 || num(j.active) !== 1) aka.push(`4 ${n} 本数=${j.all} active=${j.active}`);
    const age = num(j.ok_age_s);
    if (age === null || age > AGE_S[n]) aka.push(`5 ${n} 最後の succeeded=${j.ok_age_s === null ? '無し' : Math.round(age) + '秒前'}`);
    if (num(j.failed1d) !== 0) aka.push(`5 ${n} 直近1日の failed=${j.failed1d}`);
  }
  return aka;
}

/* 直に叩かれた時だけ＝khaw を読むだけ */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8');
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
  if (crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない'); process.exit(1); }
  const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
  let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }
  let m = null, why = '';
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `select ${MIHARI_EXPR} as m` }),
    });
    const t = await r.text();
    if (!r.ok) why = `HTTP ${r.status} ${t.slice(0, 200)}`; else m = JSON.parse(t)[0].m;
  } catch (e) { why = e.message; }
  const aka = m ? mihariAka(m) : ['読めない: ' + why];
  console.log(JSON.stringify(m));
  console.log(aka.length ? '★赤★ ' + aka.join(' / ') : '見張り5つ 緑');
  process.exitCode = aka.length ? 1 : 0;
}
