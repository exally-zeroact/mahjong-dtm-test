/* db-checks.live.mjs — ★テスト倉庫の表の CHECK が本当に弾くか★（設計図 §3 の頭・v13「数の範囲は表の CHECK に置く」＋v18 の人の列）
 * =============================================================================
 * 本物のテスト倉庫に当てる（鍵 ~/.supabase-token が要る＝CI では走らない・tests-no-ci.json）。
 * ★1つの取引の中で作って、最後に必ず戻す★＝倉庫に1行も残さない（auth.users の仮の人も同じ塊の中で作って戻す）。
 *   各ケースは savepoint で囲み「弾かれた／通った」を表に書いて、最後にその表を読んでから戻す。
 * 範囲の外を1つずつ入れて ★弾かれる★・範囲の端は ★通る★（弾きすぎも赤）。
 * ★4つ目の字＝弾いた決まりの名か sqlstate★（v18 で足した物）＝「別の訳で弾かれて緑」を赤にする。
 *
 * 使い方: node tests/db-checks.live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../scripts/apply-schema.mjs';
import { MIHARI_EXPR, mihariAka } from '../scripts/sweep-mihari.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
/* ★倉庫の門（設計 I-6）★ env の字だけでなく ref を直に見る（字は supa-config.js だけが持つ＝ここは sha256 の頭16字の指紋で照らす）＝khaw（全アプリ共有のテスト倉庫）でなければ1行も呼ばずに止める（本番 auth に試しのアカウントを作らない） */
if ((await import('node:crypto')).createHash('sha256').update(ref).digest('hex').slice(0, 16) !== '3f9e1d8e0f1061e2') { console.log('★中止★ 倉庫が khaw でない（' + ref.slice(0, 4) + '…）＝1行も呼ばない'); process.exit(1); }
if (!/env:\s*'test'/.test(src)) { console.log('★中止★ test の倉庫でない'); process.exit(1); }
const raw = fs.readFileSync(path.join(os.homedir(), '.supabase-token'), 'utf8').trim();
let token = raw; try { token = JSON.parse(raw).token; } catch (_) { /* 素の字 */ }

const ROOM = `insert into mahjong.rooms(name,room_no,pass_hash,url_token_hash,owner_user_id,channel_key)`;
const OPS = `insert into mahjong.mj_ops(name,who_plain,who_league,on_deleted,writes_history,revert,versioned,re)`;
const HIS = `insert into mahjong.history(room_id,group_id,op,tbl`;
const ACC = `insert into mahjong.room_accounts(room_id,user_id,role,joined_via)`;
const ACCM = `insert into mahjong.room_accounts(room_id,user_id,role,joined_via,member_id)`;
const LEA = `insert into mahjong.leagues(room_id,name,rule_set_id,rule_version,owner_user_id)`;

/* [名前, 通るべきか, SQL, 弾く決まり（名か sqlstate）]。前置きで仮の人 U・U2（auth.users）・部屋 R（持ち主 U）・
   ルール S（4人・トップ取り）・S3（3人・消える）・開催日 D・卓 T・半荘 H・人 M を作る */
const CASES = [
  ['cells.value 2000000000（A18 の線 M）は通る', true, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,0,2000000000)`],
  ['cells.value -2000000000 は通る', true, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,2,-2000000000)`],
  ['cells.value 2000000001 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,1,2000000001)`],
  ['cells.value -2000000001 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,1,-2000000001)`],
  ['cells.seat 4 は弾く', false, `insert into mahjong.cells(hanchan_id,seat,value) values (:H,4,0)`],
  ['extras.value 999 は通る', true, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'chip',999)`],
  ['extras.value -1000 は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'shugi',-1000)`],
  ['extras.kind が知らない字は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'yen',1)`],
  ['extras.kind c:<小英数1〜8> は通る（2c-3b・表は形だけ）', true, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'c:ab12cd34',1)`],
  ["extras.kind 'c:' だけは弾く", false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'c:',1)`, '23514'],
  ['extras.kind c:ABC（大文字）は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'c:ABC',1)`, '23514'],
  ['extras.kind c:123456789（9字）は弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'c:123456789',1)`, '23514'],
  ['sessions.rate 15 は弾く（10の倍数でない）', false, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,15,:S,1)`],
  ['sessions.rate 2000000010 は弾く', false, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,2000000010,:S,1)`],
  ['sessions.rate 2000000000 は通る', true, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,2000000000,:S,1)`],
  ['tables.rate 2000000010 は弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode,rate) values (:R,:D,'卓9',4,:S,1,'num',2000000010)`],
  ['tables.rate 2000000000 は通る', true, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode,rate) values (:R,:D,'卓9',4,:S,1,'num',2000000000)`],
  ['sessions.rate null は通る', true, `insert into mahjong.sessions(room_id,date,rate,rule_set_id,rule_version) values (:R,current_date,null,:S,1)`],
  ['tables は rate_mode=num で rate 無しは弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode) values (:R,:D,'卓9',4,:S,1,'num')`],
  ['tables は rate_mode=session で rate 在りは弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version,rate_mode,rate) values (:R,:D,'卓9',4,:S,1,'session',100)`],
  ['tables.players 5 は弾く', false, `insert into mahjong.tables(room_id,session_id,label,players,rule_set_id,rule_version) values (:R,:D,'卓9',5,:S,1)`],
  ['hanchans.players と写しの players が違うと弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) values (gen_random_uuid(),:R,:T,3,'{}',:S,1,'{"players":4}')`],
  ['hanchans の写しに players が無いと弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{}')`],
  ['トップ取りの半荘に消えた供託 1000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4,"kyotaku_end":"top"}',1000)`],
  ['写しに kyotaku_end が無い半荘に 1000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}',1000)`],
  ['消える半荘に 2000000000 は通る', true, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',2000000000)`],
  ['消える半荘に 2000001000 は弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',2000001000)`],
  ['消える半荘に 1500 は弾く（1000 の倍数でない）', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,lost_kyotaku) values (gen_random_uuid(),:R,:T,3,'{}',:S3,1,'{"players":3,"kyotaku_end":"kieru"}',1500)`],
  ['ton_order が人数と違う長さは弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,ton_order) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}','["a","b","c"]')`],
  ['rule_sets の players 5 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":5}')`],
  ['rule_sets の players 無しは弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{}')`],
  ['rule_sets の kyotaku_end x は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"kyotaku_end":"x"}')`],
  ['rule_sets の rate 15 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":15}')`],
  ['rule_sets の rate が字 "100" は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":"100"}')`],
  ['rule_sets の rate 2000000000 は通る', true, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":2000000000}')`],
  ['rule_sets の rate 2000000010 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":2000000010}')`],
  ['rule_sets の rate 9 は弾く', false, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":9}')`],
  ['rule_sets の rate null は通る', true, `insert into mahjong.rule_sets(id,version,room_id,rules) values (gen_random_uuid(),1,:R,'{"players":4,"rate":null}')`],
  ['A18 rule_sets の rate の check は1本（無名の古い物が残らない）', true, `perform 1/(select case when count(*) = 1 then 1 else 0 end from pg_constraint where conrelid = 'mahjong.rule_sets'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rate%')`],
  ['A18 sessions の rate の check は1本', true, `perform 1/(select case when count(*) = 1 then 1 else 0 end from pg_constraint where conrelid = 'mahjong.sessions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rate >= 10%')`],
  ['A18 tables の rate の範囲の check は1本', true, `perform 1/(select case when count(*) = 1 then 1 else 0 end from pg_constraint where conrelid = 'mahjong.tables'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rate >= 10%')`],
  ['A18 hanchans の lost_kyotaku の check は1本', true, `perform 1/(select case when count(*) = 1 then 1 else 0 end from pg_constraint where conrelid = 'mahjong.hanchans'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lost_kyotaku%')`],
  ['A18 cells の value の check は1本', true, `perform 1/(select case when count(*) = 1 then 1 else 0 end from pg_constraint where conrelid = 'mahjong.cells'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%value%')`],
  ['同じ部屋に使っている同じ name_key は弾く', false, `insert into mahjong.members(room_id,name,name_key) values (:R,'甲2','こう')`],
  ['使わない印の人と同じ name_key は通る', true, `insert into mahjong.members(room_id,name,name_key,active) values (:R,'甲3','こう',false)`],
  ['op_results の result 4KB 超えは弾く', false, `insert into mahjong.op_results(room_id,op_id,result,user_id) values (:R,gen_random_uuid(),jsonb_build_object('x',repeat('a',5000)),:U)`, '23514'],
  /* 2c-3c' やきとりは extras の種 'yaki'（チップと同じ ±・write6_yaki_sadame.md v1.1）＝半荘の列 yakitori・yakitori_version と mj_yaki_ok は落とした */
  ["extras.kind 'yaki' は通る（2c-3c'）", true, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'yaki',-3)`],
  ["extras.kind 'yakix' は弾く", false, `insert into mahjong.extras(table_id,member_id,kind,value) values (:T,:M,'yakix',1)`, 'extras_kind_ok'],
  ['hanchans の列 yakitori・yakitori_version と mj_yaki_ok が無い（在れば 0 で割って弾く）', true, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot) select gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}' where 1 / (case when not exists (select 1 from information_schema.columns where table_schema = 'mahjong' and table_name = 'hanchans' and column_name in ('yakitori', 'yakitori_version')) and not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'mahjong_private' and p.proname = 'mj_yaki_ok') then 1 else 0 end) = 1`],
  ['飛び賞の受け取りが飛んだ席と同じは弾く', false, `insert into mahjong.tobi(hanchan_id,busted_seat,receiver) values (:H,2,2)`],
  ['飛び賞の「全員から」(-1) は通る', true, `insert into mahjong.tobi(hanchan_id,busted_seat,receiver) values (:H,3,-1)`],
  ['totals の2行目は弾く', false, `insert into mahjong.totals(id) values (2)`],
  ['部屋番号が8桁でないと弾く', false, `${ROOM} values ('x','1234567','p',md5(random()::text),:U,md5(random()::text))`, '23514'],
  /* ── v18：部屋の持ち主・合言葉・端末 ── */
  ['部屋は持ち主ありで通る（合言葉なし）', true, `${ROOM} values ('x','12345678','p',md5(random()::text),:U,md5(random()::text))`],
  ['部屋の持ち主が空は弾く', false, `${ROOM} values ('x','12345679','p',md5(random()::text),null,md5(random()::text))`, 'rooms_owner_ok'],
  ['部屋に合言葉を書いたら弾く', false, `insert into mahjong.rooms(name,room_no,pass_hash,url_token_hash,owner_user_id,channel_key,admin_secret_hash) values ('x','12345670','p',md5(random()::text),:U,md5(random()::text),'a')`, 'rooms_no_admin_secret'],
  ['端末の表に1行でも弾く（v18 で使わない）', false, `insert into mahjong.devices(room_id,token_hash,entered_by) values (:R,md5(random()::text),'pass')`, 'devices_unused'],
  /* ── v18：アカウント・部屋の人 ── */
  ['アカウントは名前なしで通る', true, `insert into mahjong.accounts(user_id) values (:U2)`],
  ['アカウントの名前20字は通る', true, `insert into mahjong.accounts(user_id,display_name,name_key) values (:U2,repeat('あ',20),'a')`],
  ['アカウントの名前21字は弾く', false, `insert into mahjong.accounts(user_id,display_name,name_key) values (:U2,repeat('あ',21),'a')`, '23514'],
  ['アカウントの名前だけで name_key が空は弾く', false, `insert into mahjong.accounts(user_id,display_name) values (:U2,'甲')`, '23514'],
  ['auth に居ない人のアカウントは弾く', false, `insert into mahjong.accounts(user_id) values (gen_random_uuid())`, '23503'],
  ['部屋の人 管・作った は通る', true, `${ACC} values (:R,:U,'kan','create')`],
  ['部屋の人 入・パス は通る', true, `${ACC} values (:R,:U2,'nyu','pass')`],
  ['部屋の人の役 owner は弾く（持ち主は rooms の列）', false, `${ACC} values (:R,:U,'owner','create')`, '23514'],
  ['部屋の人の入り方 admin は弾く（合言葉はやめた）', false, `${ACC} values (:R,:U,'kan','admin')`, '23514'],
  ['auth に居ない人は部屋の人にできない', false, `${ACC} values (:R,gen_random_uuid(),'nyu','pass')`, '23503'],
  ['同じ部屋の2人を同じ名簿の人につなぐと弾く', false, `${ACCM} values (:R,:U,'kan','create',:M); ${ACCM} values (:R,:U2,'nyu','pass',:M)`, 'room_accounts_member'],
  ['名簿の人に同じ部屋で同じアカウントを2回つなぐと弾く', false, `insert into mahjong.members(room_id,name,name_key,user_id) values (:R,'乙','おつ',:U); insert into mahjong.members(room_id,name,name_key,user_id) values (:R,'丙','へい',:U)`, 'members_user'],
  /* 名乗り member_claims（2c-2b・write4_sekkei.md v1.1 S2・v1.2 N1） */
  ['名乗りは通る', true, `insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U)`],
  ['同じ人が同じ名簿の人に二度名乗ると弾く', false, `insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U); insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U)`, 'member_claims_pkey'],
  ['同じ名簿の人に2人が名乗るのは通る', true, `insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U); insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U2)`],
  ['名簿の人を消すと名乗りも消える（cascade）', true, `insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U); delete from mahjong.members where id = :M; if exists (select 1 from mahjong.member_claims where user_id = :U) then raise exception 'left'; end if`],
  ['アカウントを消すと名乗りも消える（cascade）', true, `insert into mahjong.member_claims(room_id,member_id,user_id) values (:R,:M,:U2); delete from auth.users where id = :U2; if exists (select 1 from mahjong.member_claims where member_id = :M) then raise exception 'left'; end if`],
  ['auth に居ない人を名簿の人につなぐと弾く', false, `insert into mahjong.members(room_id,name,name_key,user_id) values (:R,'乙','おつ',gen_random_uuid())`, '23503'],
  /* ── v18：リーグ・書いた人の列 ── */
  ['リーグは持ち主ありで通る', true, `${LEA} values (:R,'リーグ',:S,1,:U)`],
  ['リーグの持ち主が空は弾く', false, `${LEA} values (:R,'リーグ',:S,1,null)`, 'leagues_owner_ok'],
  /* ── 2c-2d1（write7 v1.1）：リーグのルールの版 ── */
  ['リーグの版が空は弾く', false, `insert into mahjong.leagues(room_id,name,rule_set_id,owner_user_id) values (:R,'リーグ',:S,:U)`, '23502'],
  ['リーグの版 0 は弾く', false, `${LEA} values (:R,'リーグ',:S,0,:U)`, 'leagues_rule_version_ok'],
  ['alt の id だけで版が空は弾く', false, `insert into mahjong.leagues(room_id,name,rule_set_id,rule_version,rule_set_id_alt,owner_user_id) values (:R,'リーグ',:S,1,:S3,:U)`, 'leagues_rule_version_ok'],
  ['alt の版だけで id が空は弾く', false, `insert into mahjong.leagues(room_id,name,rule_set_id,rule_version,rule_version_alt,owner_user_id) values (:R,'リーグ',:S,1,1,:U)`, 'leagues_rule_version_ok'],
  ['alt の id と版がそろえば通る', true, `insert into mahjong.leagues(room_id,name,rule_set_id,rule_version,rule_set_id_alt,rule_version_alt,owner_user_id) values (:R,'リーグ',:S,1,:S3,1,:U)`],
  ['送り直しの答えに人が空は弾く', false, `insert into mahjong.op_results(room_id,op_id,result) values (:R,gen_random_uuid(),'{}')`, 'op_results_user_ok'],
  ['作るの控えに人が空は弾く', false, `insert into mahjong.creates(op_id,room_id) values (gen_random_uuid(),:R)`, 'creates_user_ok'],
  ['マスに端末を書いたら弾く', false, `insert into mahjong.cells(hanchan_id,seat,value,updated_by_device) values (:H,2,0,gen_random_uuid())`, 'cells_no_device'],
  ['マスに人を書くのは通る', true, `insert into mahjong.cells(hanchan_id,seat,value,updated_by_user) values (:H,2,0,:U)`],
  ['チップに端末を書いたら弾く', false, `insert into mahjong.extras(table_id,member_id,kind,value,updated_by_device) values (:T,:M,'chip',1,gen_random_uuid())`, 'extras_no_device'],
  ['半荘に端末を書いたら弾く', false, `insert into mahjong.hanchans(id,room_id,table_id,players,seats,rule_set_id,rule_version,rules_snapshot,created_by_device) values (gen_random_uuid(),:R,:T,4,'{}',:S,1,'{"players":4}',gen_random_uuid())`, 'hanchans_no_device'],
  ['精算の締めに端末を書いたら弾く', false, `insert into mahjong.settle_snaps(room_id,session_id,rev,content,used,missing,made_by_device) values (:R,:D,1,'{}','{}','{}',gen_random_uuid())`, 'settle_snaps_no_device'],
  /* ── v18：履歴の押した人 ── */
  ['履歴の行は押した人と役で通る', true, `${HIS},actor_user_id,actor_role) values (:R,gen_random_uuid(),'cell_set','cells',:U,'nyu')`],
  ['履歴の行に押した人が空は弾く', false, `${HIS},actor_role) values (:R,gen_random_uuid(),'cell_set','cells','nyu')`, 'history_actor_ok'],
  ['履歴の行に役が空は弾く', false, `${HIS},actor_user_id) values (:R,gen_random_uuid(),'cell_set','cells',:U)`, 'history_actor_ok'],
  ['履歴の役 x は弾く', false, `${HIS},actor_user_id,actor_role) values (:R,gen_random_uuid(),'cell_set','cells',:U,'x')`, 'history_actor_role_ok'],
  ['履歴の役 league（L）は通る', true, `${HIS},actor_user_id,actor_role) values (:R,gen_random_uuid(),'league_save','leagues',:U,'league')`],
  ['履歴に v15 の actor を書いたら弾く', false, `${HIS},actor_user_id,actor_role,actor) values (:R,gen_random_uuid(),'cell_set','cells',:U,'nyu','nyu')`, 'history_old_empty'],
  ['履歴に端末を書いたら弾く', false, `${HIS},actor_user_id,actor_role,device_id) values (:R,gen_random_uuid(),'cell_set','cells',:U,'nyu',gen_random_uuid())`, 'history_old_empty'],
  ['要約の行は押した人なしで通る', true, `insert into mahjong.history(room_id,group_id,kind,op,fold) values (:R,gen_random_uuid(),'fold','fold','{}')`],
  /* ── v18：操作の表（K-1）＝既定なし・v15 の列は空だけ ── */
  ['mj_ops に大文字の名は弾く', false, `${OPS} values ('Bad','nyu','same',false,true,'none',false,'no')`, '23514'],
  ['mj_ops の戻し neg は通る', true, `${OPS} values ('zz_check','nyu','same',false,true,'neg',false,'no')`],
  ['mj_ops に v15 の kan を書いたら弾く', false, `insert into mahjong.mj_ops(name,who_plain,who_league,on_deleted,writes_history,revert,versioned,re,kan) values ('zz_check','nyu','same',false,true,'none',false,'no',true)`, 'mj_ops_old_empty'],
  ['mj_ops の who_plain x は弾く', false, `${OPS} values ('zz_check','x','same',false,true,'none',false,'no')`, 'mj_ops_who_ok'],
  ['mj_ops の who_league に kan は弾く', false, `${OPS} values ('zz_check','nyu','kan',false,true,'none',false,'no')`, 'mj_ops_who_ok'],
  ['mj_ops の re x は弾く', false, `${OPS} values ('zz_check','nyu','same',false,true,'none',false,'x')`, 'mj_ops_who_ok'],
  ['mj_ops の re 抜けは弾く（既定なし）', false, `insert into mahjong.mj_ops(name,who_plain,who_league,on_deleted,writes_history,revert,versioned) values ('zz_check','nyu','same',false,true,'none',false)`, '23502'],
  ['mj_ops の on_deleted 抜けは弾く（既定なし）', false, `insert into mahjong.mj_ops(name,who_plain,who_league,writes_history,revert,versioned,re) values ('zz_check','nyu','same',true,'none',false,'no')`, '23502'],
  ['mj_ops の versioned 抜けは弾く（既定なし）', false, `insert into mahjong.mj_ops(name,who_plain,who_league,on_deleted,writes_history,revert,re) values ('zz_check','nyu','same',false,true,'none','no')`, '23502'],
];

/* ★全部を1つの do の塊で走らせ、最後にわざと例外で結果を返す★
   ＝倉庫は必ず全部を戻す（rollback を最後の文に置くと Management API は結果を返さない＝最後の文の行しか返らない）。
   各ケースは内側の begin … exception（＝savepoint）で囲み、通った時も mj_ok の例外でその insert を戻す。 */
const MAIL = 'mj-db-checks.invalid';
function body() {
  const cases = CASES.map(([, , q], i) => {
    const sub = q.replace(/:(S3|U2|R|S|D|T|H|M|U)(?![A-Za-z0-9_])/g, (_, k) => 'v_' + k.toLowerCase());
    return `  begin ${sub}; raise exception 'mj_ok';
  exception when others then
    res := res || jsonb_build_object('${i}', case when sqlerrm = 'mj_ok' then 'ok' else sqlstate || ' ' || coalesce(substring(sqlerrm from 'constraint "([^"]+)"'), left(sqlerrm, 60)) end);
  end;`;
  });
  return `do $t$ declare res jsonb := '{}'; v_r uuid := gen_random_uuid(); v_s uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid(); v_t uuid := gen_random_uuid(); v_h uuid := gen_random_uuid(); v_m uuid := gen_random_uuid();
  v_u uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,aud,role,is_anonymous) values (v_u, v_u::text || '@${MAIL}', 'authenticated', 'authenticated', false),
    (v_u2, v_u2::text || '@${MAIL}', 'authenticated', 'authenticated', false);
  insert into mahjong.rooms(id,name,room_no,pass_hash,url_token_hash,owner_user_id,channel_key)
    values (v_r,'試験の部屋',lpad((floor(random()*1e8))::bigint::text,8,'0'),'p',md5(random()::text),v_u,md5(random()::text));
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
const left = await q(`select (select count(*)::int from mahjong.rooms where name='試験の部屋') as n,
  (select count(*)::int from auth.users where email like '%@${MAIL}') as u, (select count(*)::int from mahjong.mj_ops where name='zz_check') as o`);
let p = 0, f = 0;
for (const [i, [name, want, , cons]] of CASES.entries()) {
  const r = rows.find((x) => x.i === i);
  const got = r ? r.ok : null;
  const consOk = got !== false || !cons || (r.err || '').split(' ').includes(cons);
  if (got === want && consOk) { p++; console.log(`  ✓ ${name}${got ? '' : '（' + r.err + '）'}`); }
  else if (got === want) { f++; console.log(`  ✗ ${name} — 別の訳で弾かれた: ${r.err}（${cons} のはず）`); }
  else { f++; console.log(`  ✗ ${name} — ${got === null ? '結果が無い' : got ? '通ってしまった' : '弾かれた: ' + r.err}`); }
}
if (left[0].n !== 0 || left[0].u !== 0 || left[0].o !== 0) { f++; console.log(`  ✗ 試験の行が倉庫に残った（部屋 ${left[0].n}・仮の人 ${left[0].u}・操作 ${left[0].o}）＝戻っていない`); }
else { p++; console.log('  ✓ 試験の行（部屋・仮の人・操作）は倉庫に1行も残っていない'); }
/* ── P7 掃除の見張り5つ（p7_sadame v2.1 §1-6 ②・scripts/sweep-mihari.mjs と同じ式）──
 * 今の khaw で5つとも緑＋塊の中で1つずつ壊すと★その1つだけ★赤（塊は最後に戻す＝倉庫にも cron にも残らない）。読めない時も赤。 */
{
  const BR = [
    ['1 消して9日の部屋', '1 ', `v_u := gen_random_uuid();
      insert into auth.users(id,email,aud,role,is_anonymous) values (v_u, v_u::text || '@${MAIL}', 'authenticated', 'authenticated', false);
      insert into mahjong.rooms(name,room_no,pass_hash,url_token_hash,owner_user_id,channel_key,deleted_at)
        values ('試験の部屋',lpad((floor(random()*1e8))::bigint::text,8,'0'),'p',md5(random()::text),v_u,md5(random()::text), now() - interval '9 days');`],
    ['2 今日の sweep:bad', '2 ', `insert into mahjong.limits(kind,key,window_start,count) values ('sweep:bad','test:mihari',date_trunc('day',now()),1);`],
    ['3 昨日の sweep:tailbad', '3 ', `insert into mahjong.limits(kind,key,window_start,count) values ('sweep:tailbad','test:mihari',date_trunc('day',now()) - interval '1 day',1);`],
    ['4 tick を止める', '4 mj-sweep-tick', `perform cron.alter_job((select jobid from cron.job where jobname = 'mj-sweep-tick'), active := false);`],
    ['4 tail を消す', '4 mj-sweep-tail', `perform cron.unschedule('mj-sweep-tail');`],   // cron.job へ直の insert は postgres に許されていない＝2本の判定は下の JS で見る
    ['5 tick の succeeded が無い', '5 mj-sweep-tick', `delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname = 'mj-sweep-tick' and d.status = 'succeeded';`],
    ['5 tail の failed 1つ', '5 mj-sweep-tail', `insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
      select j.jobid, (select coalesce(max(runid), 0) + 1 from cron.job_run_details), 0, 'postgres', 'postgres', 'test', 'failed', 'test:mihari', now(), now() from cron.job j where j.jobname = 'mj-sweep-tail';`],
    // P9 §1.3（pbundle v2.1）：書きの量の見張り mj-wwatch も同じ見張りの中（止める・succeeded が無い＝その1つだけ赤）
    ['4 wwatch を止める', '4 mj-wwatch', `perform cron.alter_job((select jobid from cron.job where jobname = 'mj-wwatch'), active := false);`],
    ['5 wwatch の succeeded が無い', '5 mj-wwatch', `delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname = 'mj-wwatch' and d.status = 'succeeded';`],
  ];
  const sqlM = `do $m$ declare res jsonb := '{}'; v_u uuid; begin
  res := res || jsonb_build_object('now', ${MIHARI_EXPR});
${BR.map(([, , body], i) => `  begin
    ${body}
    res := res || jsonb_build_object('b${i}', ${MIHARI_EXPR});
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('b${i}_err', sqlerrm); end if;
  end;`).join('\n')}
  raise exception 'MJRESULT%', res::text;
end $m$;`;
  let mr = null, why = '';
  try { await q(sqlM); why = '結果の例外が来なかった'; } catch (e) {
    const at = e.message.indexOf('MJRESULT');
    if (at < 0) why = e.message.slice(0, 300); else mr = JSON.parse(e.message.slice(at + 8).split(String.fromCharCode(10))[0]);
  }
  const ck = (name, cond, w = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (w ? ' — ' + w : '')); } };
  if (!mr) ck('見張り5つが読めた', false, why);
  else {
    const now = mihariAka(mr.now);
    ck('見張り5つ＝今の khaw で全部緑', now.length === 0, now.join(' / '));
    BR.forEach(([name, head], i) => {
      const err = mr[`b${i}_err`];
      const aka = mihariAka(mr[`b${i}`]);
      const only = head === '4 mj-sweep-tail' ? aka.length >= 1 && aka.every((x) => /^[45] mj-sweep-tail/.test(x)) && aka[0].startsWith(head) : aka.length === 1 && aka[0].startsWith(head);   // job が無い＝その job の 4 と 5 が赤
      ck(`見張り：${name} → その1つだけ赤`, !err && only, err || aka.join(' / '));
    });
    { const two = JSON.parse(JSON.stringify(mr.now)); two.jobs['mj-sweep-tail'].all = 2; two.jobs['mj-sweep-tail'].active = 2; const a2 = mihariAka(two); ck('見張り：tail が2本 → 4 だけ赤（式）', a2.length === 1 && a2[0].startsWith('4 mj-sweep-tail'), a2.join(' / ')); }
    ck('見張り：読めない時（空）も赤', mihariAka(null).length > 0 && mihariAka({ jobs: {} }).length > 0);
  }
}
/* ── P8 鎖の印の見張り（p8_sadame v4 §3・作る時の注「埋め漏れの守り」）──
 * 全部の卓で：next の先は chain_no＝前＋1・chain_head＝前の頭（前が頭なら前の id）／頭（前が無い卓）は chain_head null・chain_no 0／続きの卓には前が在る。
 * 今の khaw で 0＋塊の中で鎖を作って壊すと赤（塊は最後に戻す）。 */
{
  const BAD = `((select count(*)::int from mahjong.tables t join mahjong.tables n on n.id = t.next_table_id
                 where n.chain_no <> t.chain_no + 1 or n.chain_head is distinct from coalesce(t.chain_head, t.id))
             + (select count(*)::int from mahjong.tables t
                 where (t.chain_head is null) <> (t.chain_no = 0)
                    or (t.chain_head is not null and not exists (select 1 from mahjong.tables p where p.next_table_id = t.id))
                    or (t.chain_head is null and exists (select 1 from mahjong.tables p where p.next_table_id = t.id))))`;
  const BR = [
    ['続きの卓の chain_no を飛ばす', `update mahjong.tables set chain_no = 5 where id = v_t2;`],
    ['続きの卓の chain_head を消す', `update mahjong.tables set chain_head = null, chain_no = 0 where id = v_t2;`],
    ['続きの卓の chain_head を別の卓に', `update mahjong.tables set chain_head = gen_random_uuid() where id = v_t2;`],
    ['頭の卓に段を付ける', `update mahjong.tables set chain_no = 1 where id = v_t1;`],
  ];
  const sqlC = `do $c$ declare res jsonb := '{}'; v_u uuid := gen_random_uuid(); v_r uuid := gen_random_uuid(); v_s uuid := gen_random_uuid();
    v_d uuid := gen_random_uuid(); v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid(); begin
  res := res || jsonb_build_object('now', ${BAD});
  begin
    insert into auth.users(id,email,aud,role,is_anonymous) values (v_u, v_u::text || '@${MAIL}', 'authenticated', 'authenticated', false);
    insert into mahjong.rooms(id,name,room_no,pass_hash,url_token_hash,owner_user_id,channel_key)
      values (v_r,'試験の部屋',lpad((floor(random()*1e8))::bigint::text,8,'0'),'p',md5(random()::text),v_u,md5(random()::text));
    insert into mahjong.rule_sets(id,version,room_id,rules) values (v_s,1,v_r,'{"players":4}');
    update mahjong.rooms set rule_set_id=v_s, rule_version=1 where id=v_r;
    insert into mahjong.sessions(id,room_id,date,rule_set_id,rule_version) values (v_d,v_r,current_date,v_s,1);
    insert into mahjong.tables(id,room_id,session_id,label,players,rule_set_id,rule_version,chain_head,chain_no) values
      (v_t3,v_r,v_d,'卓1',4,v_s,1,v_t1,2), (v_t2,v_r,v_d,'卓1',4,v_s,1,v_t1,1), (v_t1,v_r,v_d,'卓1',4,v_s,1,null,0);
    update mahjong.tables set next_table_id = v_t2, split_same = true where id = v_t1;
    update mahjong.tables set next_table_id = v_t3, split_same = true where id = v_t2;
    res := res || jsonb_build_object('ok3', ${BAD});
${BR.map(([, body], i) => `    begin
      ${body}
      res := res || jsonb_build_object('b${i}', ${BAD});
      raise exception 'MJUNDO';
    exception when others then
      if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('b${i}_err', sqlerrm); end if;
    end;`).join('\n')}
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('set_err', sqlerrm); end if;
  end;
  raise exception 'MJRESULT%', res::text;
end $c$;`;
  let cr = null, why = '';
  try { await q(sqlC); why = '結果の例外が来なかった'; } catch (e) {
    const at = e.message.indexOf('MJRESULT');
    if (at < 0) why = e.message.slice(0, 300); else cr = JSON.parse(e.message.slice(at + 8).split(String.fromCharCode(10))[0]);
  }
  const ck = (name, cond, w = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (w ? ' — ' + w : '')); } };
  if (!cr) ck('P8 鎖の印の見張りが読めた', false, why);
  else {
    ck('P8 鎖の印の見張り＝今の khaw で壊れた卓 0', cr.now === 0, JSON.stringify(cr.now));
    ck('P8 鎖の印の見張り＝正しく作った3段の鎖で 0（今の数から増えない）', !cr.set_err && cr.ok3 === cr.now, JSON.stringify([cr.ok3, cr.set_err]));
    BR.forEach(([name], i) => ck(`P8 鎖の印の見張り：${name} → 赤`, !cr['b' + i + '_err'] && cr['b' + i] > cr.now, JSON.stringify([cr['b' + i], cr['b' + i + '_err']])));
  }
}
/* ── P9 §1.3 [R2-SA]（pbundle v2.1）mj_wwatch を呼ぶのは cron の mj-wwatch だけ ──
 * 倉庫の関数の中身（pg_proc.prosrc）に mj_wwatch の字が在るのは mj_wwatch 自身だけ＝客の作る・入る（mj_sweep・mj_sweep_tail）の鍵の下で走らない。
 * 塊の中で mj_sweep_tail に呼びを足すと赤（塊は最後に戻す＝関数は元のまま）。cron.job の mj-wwatch は 1本・'select mahjong_private.mj_wwatch()'。 */
{
  const OTHERS = `(select coalesce(jsonb_agg(n.nspname || '.' || p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where strpos(p.prosrc, 'mj_wwatch') > 0 and not (n.nspname = 'mahjong_private' and p.proname = 'mj_wwatch'))`;
  const sqlW = `do $w$ declare res jsonb := '{}'; v_def text; begin
  res := res || jsonb_build_object('now', ${OTHERS},
    'job', (select coalesce(jsonb_agg(jsonb_build_object('cmd', j.command, 'sch', j.schedule, 'act', j.active)), '[]') from cron.job j where j.jobname = 'mj-wwatch'));
  begin
    select pg_get_functiondef('mahjong_private.mj_sweep_tail(int)'::regprocedure) into v_def;
    execute regexp_replace(v_def, '\\mbegin\\M', 'begin perform mahjong_private.mj_wwatch();');
    res := res || jsonb_build_object('waza', ${OTHERS});
    raise exception 'MJUNDO';
  exception when others then
    if sqlerrm <> 'MJUNDO' then res := res || jsonb_build_object('waza_err', sqlerrm); end if;
  end;
  raise exception 'MJRESULT%', res::text;
end $w$;`;
  let wr = null, why = '';
  try { await q(sqlW); why = '結果の例外が来なかった'; } catch (e) {
    const at = e.message.indexOf('MJRESULT');
    if (at < 0) why = e.message.slice(0, 300); else wr = JSON.parse(e.message.slice(at + 8).split(String.fromCharCode(10))[0]);
  }
  const ck = (name, cond, w = '') => { if (cond) { p++; console.log('  ✓ ' + name); } else { f++; console.log('  ✗ ' + name + (w ? ' — ' + w : '')); } };
  if (!wr) ck('P9 mj_wwatch の呼び手が読めた', false, why);
  else {
    ck('P9 mj_wwatch の字が在る関数は mj_wwatch 自身だけ', Array.isArray(wr.now) && wr.now.length === 0, JSON.stringify(wr.now));
    ck("P9 cron の mj-wwatch は1本・'*/5 * * * *'・active・select mahjong_private.mj_wwatch()", wr.job.length === 1 && wr.job[0].sch === '*/5 * * * *' && wr.job[0].act === true && wr.job[0].cmd === 'select mahjong_private.mj_wwatch()', JSON.stringify(wr.job));
    ck('P9 わざと：mj_sweep_tail に呼びを足す → 赤（mj_sweep_tail が出る）', !wr.waza_err && JSON.stringify(wr.waza) === '["mahjong_private.mj_sweep_tail"]', JSON.stringify([wr.waza, wr.waza_err]));
  }
}
console.log(`\n${p} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
