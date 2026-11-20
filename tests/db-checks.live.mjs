/* db-checks.live.mjs — ★テスト倉庫の表の CHECK が本当に弾くか★（設計図 §3 の頭・v13「数の範囲は表の CHECK に置く」）
 * =============================================================================
 * 本物のテスト倉庫に当てる（鍵 ~/.supabase-token が要る＝CI では走らない・tests-no-ci.json）。
 * ★1つの取引の中で作って、最後に必ず rollback★＝倉庫に1行も残さない。
 *   各ケースは savepoint で囲み「弾かれた／通った」を表に書いて、最後にその表を読んでから rollback。
 * 範囲の外を1つずつ入れて ★弾かれる★・範囲の端は ★通る★（弾きすぎも赤）。
 *
 * 使い方: node tests/db-checks.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
if (!/env:\s*'test'/.test(src)) { console.log('★中止★ test の倉庫でない'); process.exit(1); }
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

/* [名前, 通るべきか, SQL]。前置きで部屋 R・ルール S（4人・トップ取り）・S3（3人・消える）・開催日 D・卓 T・半荘 H・人 M を作る */
const CASES = [
  ['cells.value 200000 は通る', true, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,0,200000)`],
  ['cells.value 200001 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,1,200001)`],
  ['cells.value -200001 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,1,-200001)`],
  ['cells.seat 4 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,4,0)`],
  ['extras.value 999 は通る', true, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'chip',999)`],
  ['extras.value -1000 は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'shugi',-1000)`],
  ['extras.kind が知らない字は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'yen',1)`],
  ['sessions.rate 15 は弾く（10の倍数でない）', false, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,15,:S,1)`],
  ['sessions.rate 100010 は弾く', false, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,100010,:S,1)`],
  ['sessions.rate null は通る', true, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,null,:S,1)`],
  ['tables は rate_mode=num で rate 無しは弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode) values (:R,:D,'卓9',4,:S,1,'num')`],
  ['tables は rate_mode=session で rate 在りは弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode,rate) values (:R,:D,'卓9',4,:S,1,'session',100)`],
  ['tables.players 5 は弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version) values (:R,:D,'卓9',5,:S,1)`],
  ['hanchans.players と写しの players が違うと弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) values (gen_random_uuid(),:R,:T,3,'{}',:S,1,'{"players":4}')`],
  ['hanchans の写しに players が無いと弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{}')`],
  ['トップ取りの半荘に消えた供託 1000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4,"kyotaku_end":"top"}',1000)`],
  ['写しに kyotaku_end が無い半荘に 1000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}',1000)`],
  ['消える半荘に 20000 は通る', true, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',20000)`],
  ['消える半荘に 21000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',21000)`],
  ['消える半荘に 1500 は弾く（1000 の倍数でない）', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',1500)`],
  ['ton_order が人数と違う長さは弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,ton_order) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}','["a","b","c"]')`],
  ['rule_sets の players 5 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":5}')`],
  ['rule_sets の players 無しは弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{}')`],
  ['rule_sets の kyotaku_end x は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"kyotaku_end":"x"}')`],
  ['rule_sets の rate 15 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":15}')`],
  ['rule_sets の rate が字 "100" は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":"100"}')`],
  ['rule_sets の rate 100000 は通る', true, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":100000}')`],
  ['同じ部屋に使っている同じ name_key は弾く', false, `insert into mahjong.members(room_id,name,name_key) values (:R,'甲2','こう')`],
  ['使わない印の人と同じ name_key は通る', true, `insert into mahjong.members(room_id,name,name_key,active) values (:R,'甲3','こう',false)`],
  ['op_results の result 4KB 超えは弾く', false, `insert into mahjong.op_results(room_id,op_id,result) values (:R,gen_random_uuid(),jsonb_build_object('x',repeat('a',5000)))`],
  ['飛び賞の受け取りが飛んだ席と同じは弾く', false, `insert into mahjong.tobi(hanchan_id,busted_seat,receiver) values (:H,2,2)`],
  ['飛び賞の「全員から」(-1) は通る', true, `insert into mahjong.tobi(hanchan_id,busted_seat,receiver) values (:H,3,-1)`],
  ['totals の2行目は弾く', false, `insert into mahjong.totals(id) values (2)`],
  ['部屋番号が8桁でないと弾く', false, `insert into mahjong.rooms(name,room_no,pass_hash,url_token_hash,admin_secret_hash,channel_key) values ('x','1234567','p',md5(random()::text),'a',md5(random()::text))`],
  ['mj_ops に大文字の名は弾く', false, `insert into mahjong.mj_ops(name,kan,nyu,revert) values ('Bad',true,true,'none')`],
];

/* ★全部を1つの do の塊で走らせ、最後にわざと例外で結果を返す★
   ＝倉庫は必ず全部を戻す（rollback を最後の文に置くと Management API は結果を返さない＝最後の文の行しか返らない）。
   各ケースは内側の begin … exception（＝savepoint）で囲み、通った時も mj_ok の例外でその insert を戻す。 */
function body() {
  const cases = CASES.map(([, , q], i) => {
    const sub = q.replace(/:(S3|R|S|D|T|H|M)(?![A-Za-z0-9_])/g, (_, k) => 'v_' + k.toLowerCase());
    return `  begin ${sub}; raise exception 'mj_ok';
  exception when others then
    res := res || jsonb_build_object('${i}', case when sqlerrm = 'mj_ok' then 'ok' else sqlstate || ' ' || coalesce(substring(sqlerrm from 'constraint "([^"]+)"'), left(sqlerrm, 60)) end);
  end;`;
  });
  return `do $t$ declare res jsonb := '{}'; v_r uuid := gen_random_uuid(); v_s uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid(); v_t uuid := gen_random_uuid(); v_h uuid := gen_random_uuid(); v_m uuid := gen_random_uuid();
begin
  insert into mahjong.rooms(id,name,room_no,pass_hash,url_token_hash,admin_secret_hash,channel_key)
    values (v_r,'試験の部屋',lpad((floor(random()*1e8))::bigint::text,8,'0'),'p',md5(random()::text),'a',md5(random()::text));
  insert into mahjong.rule_sets(id,version,room_id,rules) values (v_s,1,v_r,'{"players":4,"kyotaku_end":"top"}');
  insert into mahjong.rule_sets(id,version,room_id,rules) values (v_s3,1,v_r,'{"players":3,"kyotaku_end":"kieru"}');
  update mahjong.rooms set rule_set_id=v_s, rule_version=1 where id=v_r;
  insert into mahjong.sessions(id,room_id,date,rule_set_id,rule_version) values (v_d,v_r,current_date,v_s,1);
  insert into mahjong.tables(id,room_id,session_id,label,players,rule_set_id,rule_version) values (v_t,v_r,v_d,'卓1',4,v_s,1);
  insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) values (v_h,v_r,v_t,4,'{}',v_s,1,'{"players":4}');
  insert into mahjong.members(id,room_id,name,name_key) values (v_m,v_r,'甲','こう');
${cases.join(String.fromCharCode(10))}
  raise exception 'MJRESULT%', res::text;
end $t$;`;
}

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch (_) { /* 素の字 */ } throw new Error(`HTTP ${r.status}: ${m}`); }
  return JSON.parse(t);
}

let res = null;
try { await q(body()); } catch (e) {
  /* 結果の JSON は改行を含まない1行（res::text） */
  const at = e.message.indexOf('MJRESULT');
  if (at < 0) { console.log('★失敗★ ' + e.message); process.exitCode = 1; }
  else res = JSON.parse(e.message.slice(at + 8).split(String.fromCharCode(10))[0]);
}
if (!res) { console.log('★失敗★ 結果の例外が来なかった（=戻っていない恐れ）'); process.exitCode = 1; throw new Error('結果なし'); }
const rows = Object.entries(res).map(([i, v]) => ({ i: Number(i), ok: v === 'ok', err: v === 'ok' ? null : v }));
const left = await q(`select count(*)::int as n from mahjong.rooms where name='試験の部屋'`);
let p = 0, f = 0;
for (const [i, [name, want]] of CASES.entries()) {
  const r = rows.find((x) => x.i === i);
  const got = r ? r.ok : null;
  if (got === want) { p++; console.log(`  ✓ ${name}${got ? '' : '（' + (r.err || '').split(' ')[0] + '）'}`); }
  else { f++; console.log(`  ✗ ${name} — ${got === null ? '結果が無い' : got ? '通ってしまった' : '弾かれた: ' + r.err}`); }
}
if (left[0].n !== 0) { f++; console.log(`  ✗ 試験の部屋が倉庫に ${left[0].n} 行残った（rollback されていない）`); }
else { p++; console.log('  ✓ 試験の行は倉庫に1行も残っていない（rollback）'); }
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
