-- =============================================================================
-- 麻雀〜do the math〜 倉庫の設計図（部屋 mahjong・mahjong_private）
-- 正本＝設計図 v18.3 §3.0（全員アドレスでログイン・人ごと管理＝project_mahjong_sekkeizu_2026-11-20.md・
--   案 mahjong_tataki_2026-11-20/v18_login_sekkei.md の C・E・F・G・K-1）＋ v15.8 §3・§3.1・§3.2（表・上限）
--
-- ★何度当てても同じ結果になる書き方だけ★（if not exists・on conflict・add column if not exists）
-- ★消す系は書かない★（scripts/sql-guard.mjs が止める）＝使わなくなった列・表は残して「空だけ」の check で閉じる
-- ★客は部屋に1歩も入れない★＝外から呼べるのは public.mj_* だけ・★ログインした人（authenticated）だけ★（anon は revoke）
--   表・補助には USAGE も権限も付けない。RLS も全部の表で入にする（決まり書きは0本＝誰も読めない）。
-- ★人＝共有の auth のアカウント★（mahjong_private.mj_me が呼んだ人を確かめる）。端末の秘密・管理の合言葉はやめた（v18）。
-- ★無料の名簿は麻雀に作らない★＝全アプリ共通の権利の表（管理アプリ・public.app_is_free('mahjong')）を読む（v18.4 で入れる）。
-- 段1'＝表・表の CHECK・決まりの表（mj_ops 34行・mj_caps）・totals の1行・権限・入口1本目 mj_room_create。
-- 段2b-1（この版）＝入口2本目 mj_room_join＋表 room_bans。残り（ついでの掃除 2b-2／mj_write／mj_read／mj_room_import／mj_account）は後の段。
-- ★押さえる順（§3.2）＝accounts（mj_me）→ rooms → totals → limits（(kind,key) の字の順）→ その他・ついでの掃除は本体の後ろで全部 skip locked★
-- 点は整数（点棒そのまま）・pt は 0.1pt 単位の整数（pt10）・レートは10の倍数（1pt＝N点）。
-- =============================================================================

create schema if not exists mahjong;
create schema if not exists mahjong_private;
revoke all on schema mahjong from public, anon, authenticated;
revoke all on schema mahjong_private from public, anon, authenticated;

-- ── 部屋 ────────────────────────────────────────────────────────────────
create table if not exists mahjong.rooms (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 40),
  room_no           text not null unique check (room_no ~ '^[0-9]{8}$'),
  pass_hash         text not null,                       -- bf（倉庫が作る）
  url_token_hash    text not null unique,                -- sha256（端末が送る）
  owner_user_id     uuid,                                -- 部屋の持ち主（auth.users.id・外部キーにしない＝K-3 で継ぐ・rooms_owner_ok）
  admin_secret_hash text,                                -- ★使わない（v18 で合言葉をやめた）★＝空だけ（rooms_no_admin_secret）
  channel_key       text not null unique,                -- 合図の名前（入った人にだけ渡す）
  fail_count        int not null default 0 check (fail_count >= 0),
  locked_until      timestamptz,
  rule_set_id       uuid,                                -- 部屋のルール（リーグでない対局）
  rule_version      int,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,                         -- 7日の取り消し待ち
  last_write_at     timestamptz,
  history_count     int not null default 0 check (history_count >= 0),   -- §3.2 F 以下（要約の行も数える）
  row_count         int not null default 0 check (row_count >= 0),       -- §3.2 P 以下（履歴と端末以外）
  min_count         int not null default 0 check (min_count >= 0),       -- 入の端末の1分
  min_start         timestamptz,
  export_count      int not null default 0 check (export_count >= 0),    -- 入の書き出しの1時間
  export_start      timestamptz,
  admin_join_count  int not null default 0 check (admin_join_count >= 0),-- 管の入りの成功の1時間
  admin_join_start  timestamptz,
  last_secret_at    timestamptz,                         -- 最後の room_secret（入の24時間の切れ目）
  check ((rule_set_id is null) = (rule_version is null))
);
-- v18：持ち主の列を足し、合言葉の列は空だけにする（前の版の倉庫にも同じ形を当てる）
alter table mahjong.rooms add column if not exists owner_user_id uuid;
alter table mahjong.rooms alter column admin_secret_hash drop not null;
alter table mahjong.rooms drop constraint if exists rooms_owner_ok;
alter table mahjong.rooms add constraint rooms_owner_ok check (owner_user_id is not null);
alter table mahjong.rooms drop constraint if exists rooms_no_admin_secret;
alter table mahjong.rooms add constraint rooms_no_admin_secret check (admin_secret_hash is null);
create index if not exists rooms_owner on mahjong.rooms(owner_user_id);
-- 段C（heya_mirutoki_sadame.md v10・v10.1・v10.2）：部屋なし（solo）と みんなで見る部屋（shared）・終えた印・名前のそろえた字
--   kind＝'shared'｜'solo'（既定 shared＝今在る部屋は全部 shared）／closed_at＝持ち主の［部屋を終える］（room_close）だけが付ける
--   name_key＝shared で終えていない間だけ mj_name_key(name)（部屋なし・終えた部屋は null）＝名前で入る道と組の比べが引く（一意にしない＝パスは塩つき bf）
--   部屋なしの行＝name '対局'・pass_hash '!solo'（欄を埋めるだけ・どの比べにも通さない）・room_no は今の式（返さない）
alter table mahjong.rooms add column if not exists kind text not null default 'shared';
alter table mahjong.rooms add column if not exists closed_at timestamptz;
alter table mahjong.rooms add column if not exists name_key text;
alter table mahjong.rooms drop constraint if exists rooms_kind_ok;
alter table mahjong.rooms add constraint rooms_kind_ok check (kind in ('shared', 'solo'));
alter table mahjong.rooms drop constraint if exists rooms_name_key_ok;
alter table mahjong.rooms add constraint rooms_name_key_ok check (name_key is null or (kind = 'shared' and closed_at is null));
alter table mahjong.rooms drop constraint if exists rooms_solo_open;
alter table mahjong.rooms add constraint rooms_solo_open check (kind = 'shared' or closed_at is null);
-- 索引＝名前の道と組の比べが引く（★紙 §2 は deleted_at is null も条件に置くが、組の比べは消した印の7日の部屋も引く＝下の mj_pair_bf の注★）
create index if not exists rooms_name_key_open on mahjong.rooms(name_key) where name_key is not null and closed_at is null;
-- 2d（2d_sadame.md v2.1 §1）：読む口 mj_read の版＝mj_write の組が ok で返るたび +1（書かなかった組も・送り直しは +1 しない）・K-3 の継ぎでも +1
alter table mahjong.rooms add column if not exists read_ver bigint not null default 0;
alter table mahjong.rooms drop constraint if exists rooms_read_ver_ok;
alter table mahjong.rooms add constraint rooms_read_ver_ok check (read_ver >= 0);
-- P2 §1.6（p2_sadame v5.1）：部屋 v3 の members の n・last の版＝組に tbl が hanchans・sessions・tables の履歴の行が在る時だけ mj_write が新しい read_ver にする
alter table mahjong.rooms add column if not exists ns_ver bigint not null default 0;

-- ── ルールの1組（版ごとの行・変えると版を足す・卓が指す行は消さない） ──────
create table if not exists mahjong.rule_sets (
  id         uuid not null,
  version    int  not null check (version >= 1),
  room_id    uuid not null references mahjong.rooms(id) on delete cascade,
  rules      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (id, version),
  -- 中身の細かい確かめは mahjong_private.mj_rules_ok（段2）。表では外せない3つだけを持つ（S3・S4・D7）
  check (jsonb_typeof(rules) = 'object'),
  check (coalesce(rules->>'kyotaku_end', 'top') in ('top', 'kieru'))
  -- rate の check は A18 の節（rule_sets_rate_ok）
);
create index if not exists rule_sets_room on mahjong.rule_sets(room_id);
-- ★players は必須（S3）★＝鍵が無いと ->> は null で、null in (…) は null＝CHECK を素通りする（11-20 試験で踏んだ）
--   coalesce で '' に倒して弾く。最初の版の無名の決まり（rule_sets_rules_check1＝素通りする形）は付け替える（行は消えない）
alter table mahjong.rule_sets drop constraint if exists rule_sets_rules_check1;
alter table mahjong.rule_sets drop constraint if exists rule_sets_players_ok;
-- ★jsonb の数で比べる★（->> は字 "3" と数 3 を同じ '3' にする＝字を通した・N2）
alter table mahjong.rule_sets add constraint rule_sets_players_ok check (coalesce(rules->'players', 'null'::jsonb) in ('3'::jsonb, '4'::jsonb));
alter table mahjong.rule_sets drop constraint if exists rule_sets_size_ok;
alter table mahjong.rule_sets add constraint rule_sets_size_ok check (octet_length(rules::text) <= 4096);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_rule_fk') then
    alter table mahjong.rooms add constraint rooms_rule_fk foreign key (rule_set_id, rule_version)
      references mahjong.rule_sets(id, version) deferrable initially deferred;
  end if;
end $$;

-- ── 部屋の人（名前は部屋の名簿に1つ・使わない印だけ・本当には消さない） ─────
create table if not exists mahjong.members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 20),
  name_key     text not null check (char_length(name_key) between 1 and 40),  -- 倉庫が出す（端末の字は信じない）
  name_key_ver int  not null default 1 check (name_key_ver >= 1),
  active       boolean not null default true,
  version      int not null default 1 check (version >= 1),
  created_at   timestamptz not null default now()
);
create unique index if not exists members_name_key on mahjong.members(room_id, name_key) where active;
create index if not exists members_room on mahjong.members(room_id);
-- v18 F：名簿の人とアカウントのつなぎ（［これは私］・アカウントが消えたら名前だけの人に戻る＝半荘は残る）
alter table mahjong.members add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists members_user on mahjong.members(room_id, user_id) where user_id is not null;
create index if not exists members_user_all on mahjong.members(user_id) where user_id is not null;   -- my_stats が全部の部屋から集める

-- ── リーグ ─────────────────────────────────────────────────────────────
create table if not exists mahjong.leagues (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references mahjong.rooms(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  date_from       date,
  date_to         date,
  rank_by         text not null default 'pt' check (rank_by in ('pt', 'avg_rank', 'avg_pt')),
  min_games       int not null default 0 check (min_games between 0 and 9999),
  players_main    smallint not null default 4 check (players_main in (3, 4)),
  rule_set_id     uuid not null,                      -- 主のルール（players＝players_main・op の確かめ）
  rule_set_id_alt uuid,                               -- もう一方の打ち方（null＝使わない）
  version         int not null default 1 check (version >= 1),
  created_at      timestamptz not null default now(),
  check (date_from is null or date_to is null or date_from <= date_to),
  check (rule_set_id_alt is null or rule_set_id_alt <> rule_set_id)
);
create index if not exists leagues_room on mahjong.leagues(room_id);
-- v18 E：リーグの持ち主 L（作った人・外部キーにしない＝K-3 で継ぐ）と取り消し印（league_create の戻し）
alter table mahjong.leagues add column if not exists owner_user_id uuid;
alter table mahjong.leagues add column if not exists voided boolean not null default false;
alter table mahjong.leagues drop constraint if exists leagues_owner_ok;
alter table mahjong.leagues add constraint leagues_owner_ok check (owner_user_id is not null);
-- 2c-2d1（write7 v1.1）：作った人 created_by（人ごと24時間5本の数え・変えない・null＝前の行・外部キー無し）と
--   リーグのルールの版（rooms の rule_set_id／rule_version と同じ持ち方・★外部キーは付けない★＝掃除が rule_sets を leagues より先に消す）
alter table mahjong.leagues add column if not exists created_by uuid;
alter table mahjong.leagues add column if not exists rule_version int;
alter table mahjong.leagues add column if not exists rule_version_alt int;
update mahjong.leagues g set rule_version = coalesce((select pg_catalog.max(r.version) from mahjong.rule_sets r where r.id = g.rule_set_id), 1)
 where g.rule_version is null;
update mahjong.leagues g set rule_version_alt = coalesce((select pg_catalog.max(r.version) from mahjong.rule_sets r where r.id = g.rule_set_id_alt), 1)
 where g.rule_set_id_alt is not null and g.rule_version_alt is null;
update mahjong.leagues g set rule_version_alt = null where g.rule_set_id_alt is null and g.rule_version_alt is not null;
alter table mahjong.leagues alter column rule_version set not null;
alter table mahjong.leagues drop constraint if exists leagues_rule_version_ok;
alter table mahjong.leagues add constraint leagues_rule_version_ok check (rule_version >= 1
  and (rule_set_id_alt is null) = (rule_version_alt is null) and (rule_version_alt is null or rule_version_alt >= 1));
create index if not exists leagues_created_by on mahjong.leagues(created_by, created_at);

-- ── 開催日 ─────────────────────────────────────────────────────────────
create table if not exists mahjong.sessions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  league_id    uuid references mahjong.leagues(id) on delete cascade,
  date         date not null,
  place        text check (place is null or char_length(place) <= 40),
  voided       boolean not null default false,
  rate         int, -- check は A18 の節（*_rate_ok）
  rule_set_id  uuid not null,
  rule_version int  not null,
  version      int not null default 1 check (version >= 1),
  created_at   timestamptz not null default now(),
  foreign key (rule_set_id, rule_version) references mahjong.rule_sets(id, version)
);
create index if not exists sessions_room on mahjong.sessions(room_id, date);
-- D2 §1（d2_sadame v1.1）：リーグの日のもう一方のルールの版（開催日の版＝session_add で写す・null＝使わない・league の日だけ）
alter table mahjong.sessions add column if not exists rule_set_id_alt uuid;
alter table mahjong.sessions add column if not exists rule_version_alt int;
alter table mahjong.sessions drop constraint if exists sessions_alt_fk;
alter table mahjong.sessions add constraint sessions_alt_fk foreign key (rule_set_id_alt, rule_version_alt) references mahjong.rule_sets(id, version);
alter table mahjong.sessions drop constraint if exists sessions_alt_ok;
alter table mahjong.sessions add constraint sessions_alt_ok check ((rule_set_id_alt is null) = (rule_version_alt is null)
  and (rule_set_id_alt is null or league_id is not null));
create index if not exists sessions_league on mahjong.sessions(league_id, created_at) where league_id is not null;
-- P2 §1.1（p2_sadame v5.1）：その日の版＝その日の行（開催・卓・半荘・点・extras・締め）を触った mj_write の組の read_ver（0＝P2 より前から触っていない）
alter table mahjong.sessions add column if not exists day_ver bigint not null default 0;
-- P2 §1.6：部屋 v3 の members の n・last の控え（rooms の行とは別＝rooms の行の鍵を取らない）。ver＝数えた時の読み始めの rooms.ns_ver
create table if not exists mahjong.room_ns (
  room_id uuid primary key references mahjong.rooms(id) on delete cascade,
  ver     bigint not null,
  cache   jsonb not null
);

-- ── 卓（players・ルールは table_add で決まる・半荘のある卓は変えない＝op の確かめ） ──
create table if not exists mahjong.tables (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  session_id   uuid not null references mahjong.sessions(id) on delete cascade,
  label        text not null check (char_length(label) between 1 and 20),
  players      smallint not null check (players in (3, 4)),
  rule_set_id  uuid not null,
  rule_version int  not null,
  rate_mode    text not null default 'session' check (rate_mode in ('session', 'num', 'none')),
  rate         int, -- check は A18 の節（*_rate_ok）
  voided       boolean not null default false,
  version      int not null default 1 check (version >= 1),
  extra_state  text not null default 'input' check (extra_state in ('ok', 'input', 'ng')),
  extra_reason text,
  created_at   timestamptz not null default now(),
  check ((rate_mode = 'num') = (rate is not null)),
  foreign key (rule_set_id, rule_version) references mahjong.rule_sets(id, version)
);
create index if not exists tables_session on mahjong.tables(session_id);
create index if not exists tables_room on mahjong.tables(room_id);

-- ── 半荘（id は端末の uuid・並びは (created_at, id)・局ごとの入力は持たない） ──
create table if not exists mahjong.hanchans (
  id                        uuid primary key,
  room_id                   uuid not null references mahjong.rooms(id) on delete cascade,
  table_id                  uuid not null references mahjong.tables(id) on delete cascade,
  players                   smallint not null check (players in (3, 4)),
  seats                     jsonb not null check (jsonb_typeof(seats) = 'object'),
  ton_order                 jsonb check (ton_order is null or jsonb_typeof(ton_order) = 'array'),
  order_version             int not null default 1 check (order_version >= 1),
  rule_set_id               uuid not null,
  rule_version              int  not null,
  rules_snapshot            jsonb not null check (jsonb_typeof(rules_snapshot) = 'object'),
  voided                    boolean not null default false,
  version                   int not null default 1 check (version >= 1),
  lost_kyotaku              int not null default 0,
  state                     text not null default 'input' check (state in ('ok', 'input', 'ng')),
  state_reason              text,
  first_complete_at         timestamptz,
  changed_after_complete_at timestamptz,
  changed_by_device         uuid,
  created_by_device         uuid,
  created_at                timestamptz not null default now(),
  foreign key (rule_set_id, rule_version) references mahjong.rule_sets(id, version),
  -- 人数は写しと同じ（写しに players が無い半荘は通らない形・v15.8 S3）
  check (case when rules_snapshot->>'players' in ('3', '4') then (rules_snapshot->>'players')::int else 0 end = players),
  -- 消えた供託の check は A18 の節（hanchans_lost_ok）
  check (ton_order is null or jsonb_array_length(ton_order) = players)
);
create index if not exists hanchans_table on mahjong.hanchans(table_id, created_at, id);
create index if not exists hanchans_room on mahjong.hanchans(room_id);
-- v18：書いた人は端末でなくアカウント（auth.users.id・外部キーにしない）＝端末の列は空だけ
alter table mahjong.hanchans add column if not exists created_by_user uuid;
alter table mahjong.hanchans add column if not exists changed_by_user uuid;
alter table mahjong.hanchans drop constraint if exists hanchans_no_device;
alter table mahjong.hanchans add constraint hanchans_no_device check (created_by_device is null and changed_by_device is null);

-- ── 半荘の最後の点のマス（席で持つ） ─────────────────────────────────────
create table if not exists mahjong.cells (
  hanchan_id        uuid not null references mahjong.hanchans(id) on delete cascade,
  seat              smallint not null check (seat between 0 and 3),
  value             int not null, -- check は A18 の節（cells_value_ok）
  version           int not null default 1 check (version >= 1),
  updated_by_device uuid,
  updated_at        timestamptz not null default now(),
  primary key (hanchan_id, seat)
);

-- ── A18 点の上限（11-26 司さん「勝手に点数の上限決めるな」）＝機械の限界 M＝±2,000,000,000（mj_w_int と同じ線）だけ残す ──
-- 前の版の create の中の無名の check（自動の名）は pg_constraint から名を引いて落とし、名の付いた1本に付け替える（当て直しで転ばない・行は消えない）
-- ★def の字の 20000／200000 は 2000000000 にも含まれる＝新しい名は conname で外す★
do $a18$
declare r record;
begin
  for r in select c.conrelid::regclass::text as t, c.conname from pg_catalog.pg_constraint c
            where c.contype = 'c' and (
                 (c.conrelid = 'mahjong.rule_sets'::regclass and c.conname <> 'rule_sets_rate_ok'
                   and pg_catalog.pg_get_constraintdef(c.oid) like '%rate%' and pg_catalog.pg_get_constraintdef(c.oid) like '%100000%')
              or (c.conrelid = 'mahjong.sessions'::regclass and c.conname <> 'sessions_rate_ok'
                   and pg_catalog.pg_get_constraintdef(c.oid) like '%rate%' and pg_catalog.pg_get_constraintdef(c.oid) like '%100000%')
              or (c.conrelid = 'mahjong.tables'::regclass and c.conname <> 'tables_rate_ok'
                   and pg_catalog.pg_get_constraintdef(c.oid) like '%rate%' and pg_catalog.pg_get_constraintdef(c.oid) like '%100000%')
              or (c.conrelid = 'mahjong.hanchans'::regclass and c.conname <> 'hanchans_lost_ok'
                   and pg_catalog.pg_get_constraintdef(c.oid) like '%lost_kyotaku%' and pg_catalog.pg_get_constraintdef(c.oid) like '%20000%')
              or (c.conrelid = 'mahjong.cells'::regclass and c.conname <> 'cells_value_ok'
                   and pg_catalog.pg_get_constraintdef(c.oid) like '%value%' and pg_catalog.pg_get_constraintdef(c.oid) like '%200000%')) loop
    execute pg_catalog.format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $a18$;
alter table mahjong.rule_sets drop constraint if exists rule_sets_rate_ok;
-- ★数に換えるのは数の時だけ（AND の並びは倉庫が守らない＝case で分ける）
alter table mahjong.rule_sets add constraint rule_sets_rate_ok check (
  case when rules->'rate' is null or jsonb_typeof(rules->'rate') = 'null' then true
       when jsonb_typeof(rules->'rate') = 'number'
         then (rules->>'rate')::numeric between 10 and 2000000000 and (rules->>'rate')::numeric % 10 = 0
       else false end);
alter table mahjong.sessions drop constraint if exists sessions_rate_ok;
alter table mahjong.sessions add constraint sessions_rate_ok check (rate is null or (rate between 10 and 2000000000 and rate % 10 = 0));
alter table mahjong.tables drop constraint if exists tables_rate_ok;
alter table mahjong.tables add constraint tables_rate_ok check (rate is null or (rate between 10 and 2000000000 and rate % 10 = 0));
-- 消えた供託（ルールが「消える」の時だけ非0・写しに鍵が無い半荘は非0が入らない・S4）
alter table mahjong.hanchans drop constraint if exists hanchans_lost_ok;
alter table mahjong.hanchans add constraint hanchans_lost_ok check (lost_kyotaku between 0 and 2000000000 and lost_kyotaku % 1000 = 0
  and (lost_kyotaku = 0 or coalesce(rules_snapshot->>'kyotaku_end', '') = 'kieru'));
alter table mahjong.cells drop constraint if exists cells_value_ok;
alter table mahjong.cells add constraint cells_value_ok check (value between -2000000000 and 2000000000);
alter table mahjong.cells add column if not exists updated_by_user uuid;
alter table mahjong.cells drop constraint if exists cells_no_device;
alter table mahjong.cells add constraint cells_no_device check (updated_by_device is null);

-- ── 卓のチップ・祝儀・自由な項目の枚（卓ごと・人ごと） ─────────────────────────
create table if not exists mahjong.extras (
  table_id          uuid not null references mahjong.tables(id) on delete cascade,
  member_id         uuid not null references mahjong.members(id) on delete cascade,
  kind              text not null,                   -- 種の check は下の alter（extras_kind_ok・2c-3b で自由な項目 c:<id> を足した）
  value             int not null check (value between -999 and 999),
  version           int not null default 1 check (version >= 1),
  updated_by_device uuid,
  updated_at        timestamptz not null default now(),
  primary key (table_id, member_id, kind)
);
alter table mahjong.extras add column if not exists updated_by_user uuid;
alter table mahjong.extras drop constraint if exists extras_no_device;
alter table mahjong.extras add constraint extras_no_device check (updated_by_device is null);
-- 種の check（2c-3b・write3_sekkei.md §1・C2）：create の中の古い無名の check（'chip' を含む）は pg_constraint から名を引いて落とす
--   c:<id>＝ルールの tane_custom の id（^[a-z0-9]{1,8}$）・どの id が在るかは mj_w_kind が卓のルールで見る（表は形だけ）
do $exck$
declare r record;
begin
  for r in select c.conname from pg_catalog.pg_constraint c
            where c.conrelid = 'mahjong.extras'::regclass and c.contype = 'c' and c.conname <> 'extras_kind_ok'
              and pg_catalog.pg_get_constraintdef(c.oid) like '%''chip''%' loop
    execute pg_catalog.format('alter table mahjong.extras drop constraint %I', r.conname);
  end loop;
end $exck$;
alter table mahjong.extras drop constraint if exists extras_kind_ok;
alter table mahjong.extras add constraint extras_kind_ok check (kind in ('chip', 'shugi', 'yaki', 'tobi') or kind ~ '^c:[a-z0-9]{1,8}$');  -- 2c-3c'：やきとり 'yaki'・B2：飛び賞 'tobi' を足した

-- ── 飛び賞の受け取り（receiver＝席 0〜3・−1＝全員から＝飛んだ人が他の全員に tobi_pt ずつ・分けない＝v15.9） ──
create table if not exists mahjong.tobi (
  hanchan_id  uuid not null references mahjong.hanchans(id) on delete cascade,
  busted_seat smallint not null check (busted_seat between 0 and 3),
  receiver    smallint not null check (receiver between -1 and 3),
  version     int not null default 1 check (version >= 1),
  primary key (hanchan_id, busted_seat),
  check (receiver <> busted_seat)
);

-- ── 入った端末（端末の秘密は部屋ごと・token_hash は一意） ─────────────────
create table if not exists mahjong.devices (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  token_hash   text not null unique,
  win_start    timestamptz,                                         -- 端末の1分
  win_count    int not null default 0 check (win_count >= 0),
  export_start timestamptz,                                         -- 端末ごとの書き出しの1時間
  export_count int not null default 0 check (export_count >= 0),
  member_id    uuid references mahjong.members(id) on delete set null,
  is_admin     boolean not null default false,
  entered_by   text not null check (entered_by in ('pass', 'url', 'create', 'import', 'admin')),
  expires_at   timestamptz not null default now() + interval '180 days',
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists devices_room on mahjong.devices(room_id, last_seen);
-- ★v18 で使わない★（端末の秘密をやめ、人×部屋の room_accounts にした）＝行は1つも入らない
alter table mahjong.devices drop constraint if exists devices_unused;
alter table mahjong.devices add constraint devices_unused check (false);

-- ── アカウント（共有の auth の人・初めて呼んだ時に mj_me が作る・auth.users に trigger は付けない＝v18 C） ──
create table if not exists mahjong.accounts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 20),
  name_key     text check (name_key is null or char_length(name_key) between 1 and 40),
  free_once    boolean not null default false,       -- 一度無料で呼んだ（画面の案内だけ・門には使わない）
  created_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  check ((display_name is null) = (name_key is null))
);

-- ── 部屋の人（人×部屋・devices の代わり＝v18 C）・持ち主は rooms.owner_user_id（行が無くても段1を通る） ──
create table if not exists mahjong.room_accounts (
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('kan', 'nyu')),
  member_id    uuid references mahjong.members(id) on delete set null,
  joined_via   text not null,                                       -- 決まりは下の room_accounts_joined_via_ok（段C で 'name' を足した）
  joined_at    timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  win_start    timestamptz,                                         -- 人×部屋の1分
  win_count    int not null default 0 check (win_count >= 0),
  export_start timestamptz,                                         -- 人×部屋の書き出しの1時間
  export_count int not null default 0 check (export_count >= 0),
  primary key (room_id, user_id)
);
create unique index if not exists room_accounts_member on mahjong.room_accounts(room_id, member_id) where member_id is not null;
create index if not exists room_accounts_user on mahjong.room_accounts(user_id);
create index if not exists room_accounts_seen on mahjong.room_accounts(room_id, last_seen);

-- ── A14（a14_sadame v1.1 §1）：覚えたルール（人×人数・前回作った／途中で変えたルール・次の新しい対局の既定）──
--   1人2行が天井（上限・掃除は要らない）。読み書きは definer の関数だけ（RLS 入・客の権限0＝下の全部の表の回し）。
create table if not exists mahjong.account_rules (
  user_id    uuid not null references auth.users(id) on delete cascade,
  players    smallint not null check (players in (3, 4)),
  rules      jsonb not null check (jsonb_typeof(rules) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, players)
);
-- 段C：入り方に 'name'（部屋名＋パス）を足す＝create table の中の check は名前が倉庫の付けた名＝pg_constraint で引いて落としてから付け直す
do $jvdo$
declare v_c text;
begin
  for v_c in select c.conname from pg_catalog.pg_constraint c
              where c.conrelid = 'mahjong.room_accounts'::regclass and c.contype = 'c'
                and pg_catalog.pg_get_constraintdef(c.oid) like '%joined_via%' loop
    execute pg_catalog.format('alter table mahjong.room_accounts drop constraint if exists %I', v_c);
  end loop;
end $jvdo$;
alter table mahjong.room_accounts add constraint room_accounts_joined_via_ok check (joined_via in ('pass', 'url', 'create', 'import', 'name'));

-- ── 部屋から出した人の印（案 room_join v1.1 N4）＝account_remove（2c）が足す・room_secret（2c・必ずパスと URL を全部変える）が部屋の分を全部消す ──
--   mj_room_join は当たった後にここを見て removed（数えない）。上限なし（caps v1.1・11-27 やめた）
create table if not exists mahjong.room_bans (
  room_id uuid not null references mahjong.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- ── C2-1 §1a 抜けた印（c2_db.md §1a）＝room_leave で書き直す・mj_room_join で消す・room_secret は触らない。left_hist_id＝抜けた時の部屋の history の最大 id（無ければ 0）＝その後の書きを al に数える ──
create table if not exists mahjong.room_leaves (
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  left_at      timestamptz not null default now(),
  left_hist_id bigint not null default 0,
  primary key (room_id, user_id)
);

-- ── 名乗り（2c-2b・write4_sekkei.md v1.1 S2・v1.2 N1〜N5）＝他の人がつないだ名簿の人へ member_link した印（v18 F の帯の元）──
--   帯を出すのは読む側（mj_read・2d＝名乗った人が今その部屋の room_accounts に行が在り room_bans に無い時だけ）。履歴は書かない・P に数えない。
--   消す：その member の user_id が変わった時（link・unlink・relink・account_remove）にその member の分を全部・つながった人／出した人のその部屋の分を全部。
--   上限なし（caps v1.1・11-27 やめた）
create table if not exists mahjong.member_claims (
  room_id   uuid not null references mahjong.rooms(id) on delete cascade,
  member_id uuid not null references mahjong.members(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  at        timestamptz not null default now(),
  primary key (member_id, user_id)
);
create index if not exists member_claims_room_user on mahjong.member_claims(room_id, user_id);

-- ── 送り直しの答え（部屋ごと7日・10,000件まで・4KB まで・行を書いた組だけ・同じ op_id で別の人には返さない＝K-7） ──
create table if not exists mahjong.op_results (
  room_id uuid not null references mahjong.rooms(id) on delete cascade,
  op_id   uuid not null,
  result  jsonb not null check (octet_length(result::text) <= 4096),
  at      timestamptz not null default now(),
  primary key (room_id, op_id)
);
create index if not exists op_results_at on mahjong.op_results(room_id, at);
alter table mahjong.op_results add column if not exists user_id uuid;
alter table mahjong.op_results drop constraint if exists op_results_user_ok;
alter table mahjong.op_results add constraint op_results_user_ok check (user_id is not null);

-- ── 全部の書き込みの履歴（1取引＝1組・F＝10,000 行を超えたら組ごとに要約へたたむ） ──
create table if not exists mahjong.history (
  id            bigint generated always as identity primary key,
  room_id       uuid not null references mahjong.rooms(id) on delete cascade,
  group_id      uuid not null,
  kind          text not null default 'row' check (kind in ('row', 'fold')),
  op            text not null,
  orig_op       text,                                  -- 戻しの行は元の操作の名
  tbl           text,
  row_key       jsonb,
  col           text,
  before_value  jsonb,
  after_value   jsonb,
  after_version int,
  device_id     uuid,                                  -- ★使わない（v18）★＝空だけ（history_old_empty）
  actor         text check (actor in ('nyu', 'kan')),  -- ★使わない（v18）★＝空だけ（actor_user_id・actor_role に替えた）
  member_name   text,
  fold          jsonb,                                 -- 要約の中身（kind=fold の時だけ）
  at            timestamptz not null default now(),
  check ((kind = 'fold') = (fold is not null))
);
create index if not exists history_room on mahjong.history(room_id, id);
create index if not exists history_group on mahjong.history(group_id);
-- v18：押した人はアカウントと押した時の役（入／管／持ち主／L）。前の版の「actor 必須」の決まりと端末の索引は外す（行は消えない）
alter table mahjong.history add column if not exists actor_user_id uuid;
alter table mahjong.history add column if not exists actor_role text;
alter table mahjong.history drop constraint if exists history_check1;
alter table mahjong.history drop constraint if exists history_actor_role_ok;
alter table mahjong.history add constraint history_actor_role_ok check (actor_role is null or actor_role in ('nyu', 'kan', 'owner', 'league'));
alter table mahjong.history drop constraint if exists history_actor_ok;
alter table mahjong.history add constraint history_actor_ok check (kind = 'fold' or (actor_user_id is not null and actor_role is not null));
alter table mahjong.history drop constraint if exists history_old_empty;
alter table mahjong.history add constraint history_old_empty check (actor is null and device_id is null);
drop index if exists mahjong.history_actor_at;
drop index if exists mahjong.history_device_at;
create index if not exists history_user_at on mahjong.history(room_id, actor_user_id, at) where kind = 'row';

-- ── 精算の締め ───────────────────────────────────────────────────────────
create table if not exists mahjong.settle_snaps (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references mahjong.rooms(id) on delete cascade,
  session_id     uuid not null references mahjong.sessions(id) on delete cascade,
  rev            int not null check (rev >= 1),
  content        jsonb not null,
  used           jsonb not null,      -- 使った半荘・卓の版・卓ごとのレートと rate_mode・開催日の版
  missing        jsonb not null,      -- 入っていない物の一覧
  made_by_device uuid,
  made_at        timestamptz not null default now(),
  unique (session_id, rev)
);
alter table mahjong.settle_snaps add column if not exists made_by_user uuid;
alter table mahjong.settle_snaps drop constraint if exists settle_snaps_no_device;
alter table mahjong.settle_snaps add constraint settle_snaps_no_device check (made_by_device is null);

-- ── 上限の数え（全体／部屋・端末の鍵は持たない）・外からは見えない ─────────
create table if not exists mahjong.limits (
  kind         text not null,
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0 check (count >= 0),
  primary key (kind, key, window_start)
);

-- ── 倉庫全体の数（1行） ───────────────────────────────────────────────────
create table if not exists mahjong.totals (
  id        smallint primary key check (id = 1),
  rooms_all int not null default 0 check (rooms_all >= 0)   -- 段C から＝kind shared かつ closed_at null の部屋の数（消した印の7日も入る・部屋なしと終えた部屋は入れない・≦R）
);
insert into mahjong.totals (id, rooms_all) values (1, 0) on conflict (id) do nothing;

-- ── P9 §1.3 書きの量の見張り（pbundle_sadame v2.1・[N1]）＝limits でない自分の表（掃除と kindcheck は見ない）・cron の mj-wwatch だけが書く ──
--   1行＝1回の見回り（history の id の (from_id, to_id] の行の数と大きさ）・hour＝見回りの時・30日で消す・alert＝24時間の和が線を越えた時の字
create table if not exists mahjong.wwatch (
  hour      timestamptz not null,
  from_id   bigint not null,
  to_id     bigint not null,
  rows      bigint not null,
  bytes     bigint,                 -- 読めなかった回は null（それでも先へ進む）
  rooms_all int,
  alert     text,
  primary key (hour, from_id)
);

-- ── 作る・引っ越しの送り直し（op_id 一意・2日で掃除） ─────────────────────
create table if not exists mahjong.creates (
  op_id   uuid primary key,
  room_id uuid not null,
  at      timestamptz not null default now()
);
-- v18：作った人（外部キーにしない）＝同じ op_id で別の人の送り直しは弾く（mj_op_other_user）
alter table mahjong.creates add column if not exists user_id uuid;
alter table mahjong.creates drop constraint if exists creates_user_ok;
alter table mahjong.creates add constraint creates_user_ok check (user_id is not null);

-- ── 操作の表（★正本★＝案 v18_login_sekkei.md K-1 の全34行・全列・mj_write はここに無い名を弾く・試験もここから引く） ──
--   who_plain＝リーグでない日の押せる人／who_league＝リーグの日（対象の sessions.league_id が在る）の押せる人（K-2）
--     self＝本人だけ／nyu＝入った人（管・持ち主も）／self_or_kan＝本人か管／kan＝管か持ち主／owner＝部屋の持ち主だけ／
--     owner_or_kan＝持ち主か管／revert_rule＝history_revert の決まり（K-2）／none＝押せない（league_save はリーグの行が対象＝常に who_league）／
--     same＝リーグの日でも who_plain と同じ／L＝そのリーグの持ち主／owner_or_sole_L＝部屋の持ち主か、その人が出たリーグの L が全部同じ1人ならその人
--   re＝入り直して10分以内が要るか：no／yes／owner（持ち主が押す時だけ）／grant（管を付ける時だけ）
--   ★既定の値は置かない★（新しい op は全列を書かないと入らない）。kan・nyu・needs_secret は v15 の列＝使わない（空だけ）
create table if not exists mahjong.mj_ops (
  name           text primary key check (name ~ '^[a-z_]+$'),
  kan            boolean,                  -- ★使わない（v18）★
  nyu            boolean,                  -- ★使わない（v18）★
  on_deleted     boolean not null,         -- 消した部屋で通る
  needs_secret   boolean,                  -- ★使わない（v18）★
  writes_history boolean not null,         -- 履歴と op_results に残す（× は書き込みの数にも入らない）
  revert         text not null,            -- 戻し方（mj_ops_revert_ok）
  versioned      boolean not null,         -- base_version つき
  who_plain      text,
  who_league     text,
  re             text
);
-- 前の版の倉庫を同じ形に（列は消さない・空にする）
alter table mahjong.mj_ops alter column kan drop not null;
alter table mahjong.mj_ops alter column nyu drop not null;
alter table mahjong.mj_ops alter column needs_secret drop not null;
alter table mahjong.mj_ops alter column kan drop default;            -- 前の版の既定（needs_secret false 等）が新しい行に入ると mj_ops_old_empty で止まる（11-20 khaw で測った）
alter table mahjong.mj_ops alter column nyu drop default;
alter table mahjong.mj_ops alter column needs_secret drop default;
alter table mahjong.mj_ops alter column on_deleted drop default;
alter table mahjong.mj_ops alter column writes_history drop default;
alter table mahjong.mj_ops alter column versioned drop default;
alter table mahjong.mj_ops add column if not exists who_plain text;
alter table mahjong.mj_ops add column if not exists who_league text;
alter table mahjong.mj_ops add column if not exists re text;
alter table mahjong.mj_ops drop constraint if exists mj_ops_revert_check;
alter table mahjong.mj_ops drop constraint if exists mj_ops_revert_ok;
alter table mahjong.mj_ops add constraint mj_ops_revert_ok check (revert in ('prev', 'void', 'unvoid', 'inactive', 'neg', 'rules_version', 'none'));
alter table mahjong.mj_ops drop constraint if exists mj_ops_old_empty;
alter table mahjong.mj_ops drop constraint if exists mj_ops_who_ok;
-- ★種に無い行は消す★（種から外した op が倉庫に残って通り続けない・N4）＝送り込みと消しを1つの文で
do $opsdo$ begin
with up as (
insert into mahjong.mj_ops (name, who_plain, who_league, on_deleted, writes_history, revert, versioned, re) values
  ('room_leave',       'self',         'same',            true,  true,  'none',          false, 'owner'),
  ('member_add',       'nyu',          'same',            false, true,  'inactive',      false, 'no'),
  ('member_rename',    'nyu',          'owner_or_sole_L', false, true,  'prev',          false, 'no'),
  ('member_active',    'nyu',          'owner_or_sole_L', false, true,  'prev',          false, 'no'),
  ('member_link',      'self',         'same',            false, true,  'prev',          false, 'no'),
  ('member_unlink',    'self_or_kan',  'same',            false, true,  'prev',          false, 'no'),
  ('member_relink',    'kan',          'same',            false, true,  'prev',          false, 'no'),
  ('session_add',      'nyu',          'L',               false, true,  'void',          false, 'no'),
  ('session_edit',     'nyu',          'L',               false, true,  'prev',          false, 'no'),
  ('table_add',        'nyu',          'L',               false, true,  'void',          false, 'no'),
  ('table_edit',       'nyu',          'L',               false, true,  'prev',          false, 'no'),
  ('hanchan_start',    'nyu',          'nyu',             false, true,  'void',          false, 'no'),
  ('hanchan_seats',    'nyu',          'L',               false, true,  'prev',          false, 'no'),
  ('table_seats',      'nyu',          'L',               false, true,  'prev',          false, 'no'),
  ('hanchan_void',     'nyu',          'nyu',             false, true,  'unvoid',        false, 'no'),
  ('hanchan_unvoid',   'nyu',          'nyu',             false, true,  'void',          false, 'no'),
  ('cell_set',         'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('tobi_set',         'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('kyotaku_set',      'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('hanchan_order',    'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('extra_set',        'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('extra_add',        'nyu',          'nyu',             false, true,  'neg',           false, 'no'),
  ('table_rules',      'kan',          'same',            false, true,  'none',          false, 'no'),    -- C4 途中でルールを変える
  ('history_revert',   'revert_rule',  'revert_rule',     false, true,  'prev',          false, 'no'),
  ('settle_snap',      'nyu',          'nyu',             false, true,  'none',          false, 'no'),
  ('league_create',    'kan',          'same',            false, true,  'void',          false, 'no'),
  ('league_save',      'none',         'L',               false, true,  'rules_version', false, 'no'),
  ('room_export',      'nyu',          'same',            true,  false, 'none',          false, 'no'),
  ('rules_save',       'kan',          'same',            false, true,  'rules_version', false, 'no'),
  ('rerev_ok',         'kan',          'L',               false, true,  'none',          false, 'no'),
  ('room_secret',      'kan',          'same',            false, true,  'none',          false, 'yes'),
  ('room_delete',      'owner',        'same',            false, true,  'none',          false, 'yes'),
  ('room_undelete',    'owner_or_kan', 'same',            true,  true,  'none',          false, 'no'),
  ('room_share',       'owner',        'same',            false, true,  'none',          false, 'no'),    -- 段C v10.1＝部屋なしをみんなで見る部屋に（何も壊さない＝入り直しは求めない）
  ('room_close',       'owner',        'same',            false, true,  'none',          false, 'yes'),   -- 段C＝［部屋を終える］
  ('role_set',         'owner',        'same',            false, true,  'prev',          false, 'grant'),
  ('account_remove',   'kan',          'same',            false, true,  'none',          false, 'no'),
  ('league_owner_set', 'owner',        'owner',           false, true,  'prev',          false, 'yes')
on conflict (name) do update set
  kan = null, nyu = null, needs_secret = null,
  who_plain = excluded.who_plain, who_league = excluded.who_league, on_deleted = excluded.on_deleted,
  writes_history = excluded.writes_history, revert = excluded.revert, versioned = excluded.versioned, re = excluded.re
  returning name)
delete from mahjong.mj_ops o where o.name not in (select up.name from up);
end $opsdo$;
alter table mahjong.mj_ops alter column who_plain set not null;
alter table mahjong.mj_ops alter column who_league set not null;
alter table mahjong.mj_ops alter column re set not null;
alter table mahjong.mj_ops add constraint mj_ops_old_empty check (kan is null and nyu is null and needs_secret is null);
alter table mahjong.mj_ops add constraint mj_ops_who_ok check (
  who_plain in ('self', 'nyu', 'self_or_kan', 'kan', 'owner', 'owner_or_kan', 'revert_rule', 'none')
  and who_league in ('same', 'L', 'nyu', 'owner_or_sole_L', 'revert_rule', 'owner')
  and re in ('no', 'yes', 'owner', 'grant'));

-- ── 表ごとの行の上限（段6＝当てた後に実の数で見る・§3.2） ──────────────────
--   scope: room＝部屋ごと／session＝開催日ごと／table＝卓ごと
--   H1'（h1b_sadame v2・11-23 司さん「勝手に上限決めんな」）：対局の記録（P・F・日・卓・半荘・リーグ・ルール）の上限は無い。残るのは人の上限と rooms・op_results だけ。rooms.row_count は数えだけ残す（門には使わない・mj_sweep は読まない）
--   ★op_results は P に数えない★（自分の上限 op_results/room 10,000＝越えたら mj_write が古い物から消す・mj_sweep が row_count を減らさずに消すため）
create table if not exists mahjong.mj_caps (
  tbl   text not null,
  scope text not null check (scope in ('room', 'session', 'table', 'all')),
  cap   int  not null check (cap > 0),
  primary key (tbl, scope)
);
-- ★種に無い行は消す★（v18 で devices の行を room_accounts に替えた＝古い行を残さない）
do $capsdo$ begin
with up as (
insert into mahjong.mj_caps (tbl, scope, cap) values
  -- members 300・room_accounts 200・admins 5・room_bans 200・member_claims 200・member_claims_user 3 はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）＝下の delete で倉庫からも消える
  ('op_results',    'room',    10000)     -- P3：('rooms','all',200)＝R はやめた（下の delete で倉庫からも消える）
on conflict (tbl, scope) do update set cap = excluded.cap
  returning tbl, scope)
delete from mahjong.mj_caps m where (m.tbl, m.scope) not in (select up.tbl, up.scope from up);
end $capsdo$;

-- ── 名前のそろえた字（v15.8 N1・版1）＝lib/name-key.mjs と1字も違わない手順 ───────
--   ① NFKC ② カタカナ（ァ〜ヶ・ヽ ヾ）→ひらがな ③ 空白の字（下の13字を字で固定・s は場所の設定で変わるので使わない）を消す
--   ④ 英字 A〜Z だけ小文字（lower() は場所の設定で変わるので使わない）＝translate 1回で ②③④
--   試験＝tests/name-key.live.mjs（同じ字の表を倉庫と lib に通して同じ答え）
create or replace function mahjong_private.mj_name_key(p_name text) returns text
language sql immutable strict parallel safe set search_path = '' as $fn$
  select pg_catalog.translate(pg_catalog.normalize(p_name, 'NFKC'),
    'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶヽヾABCDEFGHIJKLMNOPQRSTUVWXYZ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(133) || chr(5760) || chr(6158) || chr(8203) || chr(8232) || chr(8233) || chr(65279),
    'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖゝゞabcdefghijklmnopqrstuvwxyz')
$fn$;
revoke all on function mahjong_private.mj_name_key(text) from public, anon, authenticated;

-- 段C（§5・§2）当てる時の今の部屋：name_key の埋めは終えていない shared の null の行だけ（消した印の7日の部屋も埋める＝戻した部屋が名前の道と比べに出る）
--   ＋rooms_all を新しい式（shared かつ closed_at null）で1回数え直す（何度当てても同じ）
do $ncdo$
begin
  update mahjong.rooms x set name_key = nullif(mahjong_private.mj_name_key(x.name), '')
   where x.kind = 'shared' and x.closed_at is null and x.name_key is null;
  update mahjong.totals t set rooms_all = (select pg_catalog.count(*) from mahjong.rooms x where x.kind = 'shared' and x.closed_at is null)
   where t.id = 1;
end $ncdo$;

-- ── ルールの鍵の表（★正本★・種は下の rk 札で囲んだ jsonb の字1本＝lib/rules.mjs の RULE_KEYS と同じ・tests/rules-keys.test.mjs が CI で比べる）──
-- ★鍵を後から足す日は、新しい鍵の既定を「足す前の振る舞い」と同じ値に限る（古い rules_snapshot の pt を変えない）★
-- ★在る鍵の既定を替える日（S2 hakoshita false→true）は、新しく作るルールにだけ効く（保存した rules と写しは鍵を全部持つ＝mj_rules_ok が埋める）★
create table if not exists mahjong.mj_rule_keys (
  key      text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  kind     text not null,                   -- 種の check は下の alter（mj_rule_keys_kind_ok・2c-3a で list を足した）
  min      numeric,
  max      numeric,
  step     numeric check (step is null or step > 0),
  vals     jsonb check (vals is null or jsonb_typeof(vals) = 'array'),
  nullable boolean not null,
  def4     jsonb not null,                  -- 4人の既定（null は 'null'::jsonb）
  def3     jsonb not null,                  -- 3人の既定
  need     boolean not null,                -- 無いと弾く（players だけ）
  check ((kind = 'enum') = (vals is not null)),
  check ((kind in ('int', 'uma')) = (min is not null and max is not null and step is not null))
);
-- 種の check（2c-3a・write3_sekkei.md v1.1 C2）：create の中の古い無名の check（'bool' を含み 'list' を含まない）は pg_constraint から名を引いて落とす
do $rkck$
declare r record;
begin
  for r in select c.conname from pg_catalog.pg_constraint c
            where c.conrelid = 'mahjong.mj_rule_keys'::regclass and c.contype = 'c' and c.conname <> 'mj_rule_keys_kind_ok'
              and pg_catalog.pg_get_constraintdef(c.oid) like '%''bool''%' loop
    execute pg_catalog.format('alter table mahjong.mj_rule_keys drop constraint %I', r.conname);
  end loop;
end $rkck$;
alter table mahjong.mj_rule_keys drop constraint if exists mj_rule_keys_kind_ok;
alter table mahjong.mj_rule_keys add constraint mj_rule_keys_kind_ok check (kind in ('int', 'enum', 'bool', 'uma', 'list'));
do $rkdo$
declare seed jsonb := $rk$[
  {"key":"aka","kind":"int","min":0,"max":4,"step":1,"vals":null,"nullable":false,"def4":3,"def3":2,"need":false},
  {"key":"atozuke","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"chip_pt10","kind":"int","min":1,"max":9999,"step":1,"vals":null,"nullable":true,"def4":null,"def3":null,"need":false},
  {"key":"chombo","kind":"enum","min":null,"max":null,"step":null,"vals":["mangan","pt"],"nullable":false,"def4":"mangan","def3":"mangan","need":false},
  {"key":"chombo_pt","kind":"int","min":0,"max":999,"step":1,"vals":null,"nullable":false,"def4":20,"def3":20,"need":false},
  {"key":"double_ron","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"double_ron_kyotaku","kind":"enum","min":null,"max":null,"step":null,"vals":["kamicha","split"],"nullable":false,"def4":"kamicha","def3":"kamicha","need":false},
  {"key":"double_yakuman","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"hakoshita","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"honba","kind":"enum","min":null,"max":null,"step":null,"vals":[300,1500],"nullable":false,"def4":300,"def3":300,"need":false},
  {"key":"kazoe","kind":"enum","min":null,"max":null,"step":null,"vals":["yakuman","sanbai"],"nullable":false,"def4":"yakuman","def3":"yakuman","need":false},
  {"key":"kiriage","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":false,"def3":false,"need":false},
  {"key":"kita","kind":"enum","min":null,"max":null,"step":null,"vals":["nuki","none"],"nullable":false,"def4":"none","def3":"nuki","need":false},
  {"key":"kuitan","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"kyotaku_end","kind":"enum","min":null,"max":null,"step":null,"vals":["top","kieru"],"nullable":false,"def4":"top","def3":"top","need":false},
  {"key":"nagashi","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"oorasu_stop","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"pao","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"players","kind":"int","min":3,"max":4,"step":1,"vals":null,"nullable":false,"def4":4,"def3":3,"need":true},
  {"key":"rate","kind":"int","min":10,"max":2000000000,"step":10,"vals":null,"nullable":true,"def4":null,"def3":null,"need":false},
  {"key":"renpu_fu","kind":"enum","min":null,"max":null,"step":null,"vals":[2,4],"nullable":false,"def4":4,"def3":4,"need":false},
  {"key":"return_pts","kind":"int","min":1000,"max":2000000000,"step":100,"vals":null,"nullable":false,"def4":30000,"def3":40000,"need":false},
  {"key":"round","kind":"enum","min":null,"max":null,"step":null,"vals":["gosha","shisha","kirisute","none"],"nullable":false,"def4":"none","def3":"none","need":false},
  {"key":"shugi_pt10","kind":"int","min":1,"max":9999,"step":1,"vals":null,"nullable":true,"def4":null,"def3":null,"need":false},
  {"key":"start_pts","kind":"int","min":1000,"max":2000000000,"step":100,"vals":null,"nullable":false,"def4":25000,"def3":35000,"need":false},
  {"key":"tane_custom","kind":"list","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":[],"def3":[],"need":false},
  {"key":"tenpai_ryo","kind":"int","min":0,"max":2000000000,"step":1000,"vals":null,"nullable":false,"def4":3000,"def3":3000,"need":false},
  {"key":"tie","kind":"enum","min":null,"max":null,"step":null,"vals":["kamicha","split"],"nullable":false,"def4":"kamicha","def3":"kamicha","need":false},
  {"key":"tobi","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"tobi_from","kind":"enum","min":null,"max":null,"step":null,"vals":["busted","all"],"nullable":false,"def4":"busted","def3":"busted","need":false},
  {"key":"tobi_pt","kind":"int","min":0,"max":999,"step":1,"vals":null,"nullable":false,"def4":10,"def3":10,"need":false},
  {"key":"tobi_zero","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"tochu_kyushu","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"tochu_sucha","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"tochu_sufu","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"tochu_sukan","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"triple_ron","kind":"enum","min":null,"max":null,"step":null,"vals":["ryukyoku","ari"],"nullable":false,"def4":"ryukyoku","def3":"ryukyoku","need":false},
  {"key":"tsumo3","kind":"enum","min":null,"max":null,"step":null,"vals":["son","secchan"],"nullable":false,"def4":"son","def3":"son","need":false},
  {"key":"uma","kind":"uma","min":-999,"max":999,"step":1,"vals":null,"nullable":false,"def4":[20,10,-10,-20],"def3":[15,0,-15],"need":false},
  {"key":"west","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":true,"def3":true,"need":false},
  {"key":"yakitori","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":false,"def3":false,"need":false},
  {"key":"yakitori_pt","kind":"int","min":0,"max":999,"step":1,"vals":null,"nullable":false,"def4":0,"def3":0,"need":false},
  {"key":"yakitori_to","kind":"enum","min":null,"max":null,"step":null,"vals":["each","split","top"],"nullable":false,"def4":"each","def3":"each","need":false},
  {"key":"yakitori_top_tie","kind":"enum","min":null,"max":null,"step":null,"vals":["others","all"],"nullable":false,"def4":"others","def3":"others","need":false}
]$rk$;
begin
  with up as (
    insert into mahjong.mj_rule_keys (key, kind, min, max, step, vals, nullable, def4, def3, need)
    select e->>'key', e->>'kind', (e->>'min')::numeric, (e->>'max')::numeric, (e->>'step')::numeric,
           case when jsonb_typeof(e->'vals') = 'array' then e->'vals' end,
           (e->>'nullable')::boolean, e->'def4', e->'def3', (e->>'need')::boolean
      from jsonb_array_elements(seed) e
    on conflict (key) do update set kind = excluded.kind, min = excluded.min, max = excluded.max, step = excluded.step,
      vals = excluded.vals, nullable = excluded.nullable, def4 = excluded.def4, def3 = excluded.def3, need = excluded.need
    returning key)
  delete from mahjong.mj_rule_keys r where r.key not in (select up.key from up);
end $rkdo$;

-- ── 自由な項目の並び tane_custom の確かめ（2c-3a・lib/rules.mjs の okTane と1字も違わない手順・write3_sekkei.md §2 と v1.3）──
-- 通れば作り直した並び（落とした name・整数の pt10・鍵は id, name, pt10, sum0）を返す／だめなら null（呼ぶ側が mj_range:tane_custom）。
--   並び 0〜5 物・各物はちょうど4鍵・id ^[a-z0-9]{1,8}$ で一意・name は c_trim の5字を前後から落として 1〜10 符号点・
--   mj_name_key が空でない・mj_name_key で重ならない・「チップ」「祝儀」「やきとり」と mj_name_key で同じでない・pt10 整数 1〜9999・sum0 bool
create or replace function mahjong_private.mj_rules_tane(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $fn$
declare
  c_trim constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  c_res  text[] := array[mahjong_private.mj_name_key('チップ'), mahjong_private.mj_name_key('祝儀'), mahjong_private.mj_name_key('やきとり')];
  e jsonb; o jsonb := '[]'::jsonb; v_nm text; v_key text; v_ids text[] := '{}'; v_keys text[] := '{}'; x numeric;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'array' or pg_catalog.jsonb_array_length(p) > 5 then return null; end if;
  for e in select t.x from pg_catalog.jsonb_array_elements(p) with ordinality t(x, i) order by t.i loop
    if pg_catalog.jsonb_typeof(e) <> 'object'
       or (select count(*) from pg_catalog.jsonb_object_keys(e)) <> 4
       or not (e ?& array['id', 'name', 'pt10', 'sum0']) then return null; end if;
    if pg_catalog.jsonb_typeof(e -> 'id') <> 'string' or not ((e ->> 'id') ~ '^[a-z0-9]{1,8}$') or (e ->> 'id') = any (v_ids) then return null; end if;
    if pg_catalog.jsonb_typeof(e -> 'name') <> 'string' then return null; end if;
    v_nm := pg_catalog.btrim(e ->> 'name', c_trim);
    if pg_catalog.char_length(v_nm) < 1 or pg_catalog.char_length(v_nm) > 10 then return null; end if;
    v_key := mahjong_private.mj_name_key(v_nm);
    if v_key = '' or v_key = any (v_keys) or v_key = any (c_res) then return null; end if;
    if pg_catalog.jsonb_typeof(e -> 'pt10') <> 'number' then return null; end if;
    x := (e -> 'pt10')::numeric;
    if x % 1 <> 0 or x < 1 or x > 9999 then return null; end if;
    if pg_catalog.jsonb_typeof(e -> 'sum0') <> 'boolean' then return null; end if;
    v_ids := v_ids || (e ->> 'id'); v_keys := v_keys || v_key;
    o := o || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', e ->> 'id', 'name', v_nm, 'pt10', x::bigint, 'sum0', e -> 'sum0'));
  end loop;
  return o;
end $fn$;
revoke all on function mahjong_private.mj_rules_tane(jsonb) from public, anon, authenticated;

-- ── ルールの確かめ（rules_save・league_save・mj_room_create・mj_room_import が同じ物を呼ぶ＝設計図 §3）──
-- 確かめて、足りない鍵を players の既定で埋めた jsonb を返す。弾く時は例外 'mj_range:<鍵>'（呼ぶ側が「範囲」の値に換える）。
-- 見る順は lib/rules.mjs の rulesOk と同じ：object → 表に無い鍵 → players → 鍵の名の順（collate "C"）→ 返し≧持ち点。
-- ★数は整数に直して持つ（25000.0 → 25000）・enum は表の値を持つ★＝写し（rules_snapshot）の ->>::int が落ちない。
create or replace function mahjong_private.mj_rules_ok(p_rules jsonb) returns jsonb
language plpgsql stable set search_path = '' as $fn$
declare
  k record; v jsonb; e jsonb; o jsonb := '{}'::jsonb; n int; i int; ok boolean; x numeric; prev numeric; s numeric; arr jsonb;
begin
  if p_rules is null or pg_catalog.jsonb_typeof(p_rules) <> 'object' then raise exception 'mj_range:(object)'; end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_rules) t(key)
             where not exists (select 1 from mahjong.mj_rule_keys r where r.key = t.key)) then
    raise exception 'mj_range:(unknown)';
  end if;
  v := p_rules -> 'players';
  if v is null or pg_catalog.jsonb_typeof(v) <> 'number' or v not in ('3'::jsonb, '4'::jsonb) then raise exception 'mj_range:players'; end if;
  n := (v::numeric)::int;
  for k in select * from mahjong.mj_rule_keys r order by r.key collate "C" loop
    v := p_rules -> k.key;
    if v is null then
      o := o || pg_catalog.jsonb_build_object(k.key, case when n = 4 then k.def4 else k.def3 end);
      continue;
    end if;
    ok := false;
    if pg_catalog.jsonb_typeof(v) = 'null' then
      ok := k.nullable;
    elsif k.kind = 'bool' then
      ok := pg_catalog.jsonb_typeof(v) = 'boolean';
    elsif k.kind = 'enum' then
      select t.x into e from pg_catalog.jsonb_array_elements(k.vals) t(x)
        where pg_catalog.jsonb_typeof(t.x) = pg_catalog.jsonb_typeof(v) and t.x = v limit 1;
      if found then ok := true; v := e; end if;
    elsif k.kind = 'int' then
      if pg_catalog.jsonb_typeof(v) = 'number' then
        x := v::numeric;
        if x % 1 = 0 and x >= k.min and x <= k.max and x % k.step = 0 then ok := true; v := pg_catalog.to_jsonb(x::bigint); end if;
      end if;
    elsif k.kind = 'list' then
      e := mahjong_private.mj_rules_tane(v);
      if e is not null then ok := true; v := e; end if;
    elsif k.kind = 'uma' then
      if pg_catalog.jsonb_typeof(v) = 'array' and pg_catalog.jsonb_array_length(v) = n then
        ok := true; s := 0; prev := null; arr := '[]'::jsonb;
        for i in 0 .. n - 1 loop
          e := v -> i;
          if pg_catalog.jsonb_typeof(e) <> 'number' then ok := false; exit; end if;
          x := e::numeric;
          if x % 1 <> 0 or x < k.min or x > k.max or (prev is not null and x > prev) then ok := false; exit; end if;
          s := s + x; prev := x; arr := arr || pg_catalog.jsonb_build_array(x::bigint);
        end loop;
        if ok and s <> 0 then ok := false; end if;
        if ok then v := arr; end if;
      end if;
    end if;
    if not ok then raise exception 'mj_range:%', k.key; end if;
    o := o || pg_catalog.jsonb_build_object(k.key, v);
  end loop;
  if (o ->> 'return_pts')::numeric < (o ->> 'start_pts')::numeric then raise exception 'mj_range:return_pts'; end if;
  return o;
end $fn$;
revoke all on function mahjong_private.mj_rules_ok(jsonb) from public, anon, authenticated;

-- ── 起家からの順が要る半荘か（lib/needs-order.mjs と同じ答え・設計図 v15.9 §3） ──────────────────
-- 返し＝理由の jsonb 配列：[]＝要らない／["tie"]＝同じ素点が2人以上（箱下なしは0未満を0にして比べる・鍵が無ければ箱下なし）／
-- ["incomplete"]＝rules が object でない・players が 3/4 でない・cells が長さ players の整数の並びでない（止める側）。
-- 2c-3c'：やきとりは extras の種 'yaki'（チップと同じ ±・司さん 11-21）＝順の理由 yaki と3つ目の引数 p_yaki を外した（tie だけ・lib の needsOrder(rules, cells) と同じ）
--   3引数の版（2c-3c）は drop する（呼ぶのは hstate の plpgsql だけ＝依存は無い）
drop function if exists mahjong_private.mj_needs_order(jsonb, jsonb, jsonb);
create or replace function mahjong_private.mj_needs_order(p_rules jsonb, p_cells jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $fn$
declare
  n int; hako boolean; e jsonb; x numeric; seen numeric[] := '{}'; v_tie boolean := false; v_res jsonb := '[]'::jsonb;
begin
  if p_rules is null or pg_catalog.jsonb_typeof(p_rules) <> 'object' then return '["incomplete"]'::jsonb; end if;
  e := p_rules -> 'players';
  if e is null or pg_catalog.jsonb_typeof(e) <> 'number' or e not in ('3'::jsonb, '4'::jsonb) then return '["incomplete"]'::jsonb; end if;
  n := (e::numeric)::int;
  if p_cells is null or pg_catalog.jsonb_typeof(p_cells) <> 'array' or pg_catalog.jsonb_array_length(p_cells) <> n then
    return '["incomplete"]'::jsonb;
  end if;
  hako := coalesce(p_rules -> 'hakoshita' = 'true'::jsonb, false);
  -- 形を先に全部見る（lib と同じ順＝同点と形の崩れが混ざっても incomplete）
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_cells) t(v)
             where pg_catalog.jsonb_typeof(t.v) <> 'number' or (t.v::numeric) % 1 <> 0) then
    return '["incomplete"]'::jsonb;
  end if;
  for e in select t.v from pg_catalog.jsonb_array_elements(p_cells) t(v) loop
    x := e::numeric;
    if not hako and x < 0 then x := 0; end if;
    if x = any(seen) then v_tie := true; exit; end if;
    seen := seen || x;
  end loop;
  if v_tie then v_res := v_res || '["tie"]'::jsonb; end if;
  return v_res;
end $fn$;
revoke all on function mahjong_private.mj_needs_order(jsonb, jsonb) from public, anon, authenticated;

-- A13 §6（a13g_sadame v3.2）：ton_order が今の同点の組を覆っているか＝lib/needs-order.mjs の orderCovered と同じ答え（tests/needs-order.live.mjs）
--   ton_order null → false／order_cells null（この直しの前の行＝古い画面は本当の席順を書いた）→ true／order_cells の形が壊れている → false
--   それ以外＝今の cells の同点の組（x が同じ2人以上）ごとに、order_cells での x が組で1つにそろっていれば覆っている（x＝箱下ありはそのまま・なしは 0 未満を 0）
create or replace function mahjong_private.mj_order_covered(p_rules jsonb, p_cells jsonb, p_ton jsonb, p_oc int[]) returns boolean
language plpgsql immutable set search_path = '' as $fn$
declare hako boolean;
begin
  if p_ton is null or p_ton = 'null'::jsonb then return false; end if;
  if p_oc is null then return true; end if;
  if p_rules is null or pg_catalog.jsonb_typeof(p_rules) <> 'object' or pg_catalog.jsonb_typeof(p_cells) is distinct from 'array' then return false; end if;
  if pg_catalog.array_ndims(p_oc) is distinct from 1 or pg_catalog.cardinality(p_oc) <> pg_catalog.jsonb_array_length(p_cells)
     or exists (select 1 from pg_catalog.unnest(p_oc) u(x) where u.x is null) then
    return false;
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_cells) t(v) where pg_catalog.jsonb_typeof(t.v) <> 'number') then return false; end if;
  hako := coalesce(p_rules -> 'hakoshita' = 'true'::jsonb, false);
  return not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_cells) with ordinality t(v, o)
     group by case when hako then t.v::numeric else greatest(t.v::numeric, 0) end
    having pg_catalog.count(*) >= 2
       and pg_catalog.count(distinct case when hako then p_oc[t.o] else greatest(p_oc[t.o], 0) end) > 1);
end $fn$;
revoke all on function mahjong_private.mj_order_covered(jsonb, jsonb, jsonb, int[]) from public, anon, authenticated;

-- ── パスのそろえた字（版1）─────────────────────
--   ① NFKC（全角の数字・英字を半角に＝日本語の打ち方で「１２３４」と打っても同じパス）② 英字 A〜Z だけ小文字
--   （lower() は場所の設定で変わるので使わない・カナや空白は変えない＝mj_name_key は借りない）
--   ★bf にかけるのもこのそろえた字★（端末ごとの打ち方の違いで入れなくならない・mj_room_join も同じ物を通す）
create or replace function mahjong_private.mj_pass_key(p_pass text) returns text
language sql immutable strict parallel safe set search_path = '' as $fn$
  select pg_catalog.translate(pg_catalog.normalize(p_pass, 'NFKC'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$fn$;
revoke all on function mahjong_private.mj_pass_key(text) from public, anon, authenticated;

-- ── よくあるパスの名簿は B0（11-21 司さん「パスは簡単なやつでええ」）で外した＝どの門も読まない・行は0にする
--    （表は残す＝sql-guard が drop table を止める・形の門＝4〜64字・72バイトは残す）──
create table if not exists mahjong.mj_common_pass (
  key text primary key check (char_length(key) between 1 and 64)
);
do $cpdo$
begin
  delete from mahjong.mj_common_pass;
end $cpdo$;

-- ── 呼んだ人の門＝mj_who（v18 C・K-10・P2 §2.5 で分けた）＝全部の入口の頭で mj_me／mj_me_read から呼ぶ・null＝弾く（{ok:false, err:'mj_session'}） ─────────────
--   auth.uid() の人が auth.users に在り（匿名でない・止められていない・消されていない）、かつ jwt の session_id が
--   auth.sessions に在る（signOut 済みの古い access token を最大1時間生かさない・not_after 切れも弾く）時だけ uid を返す。
--   uuid に直せない字・claim が無い時も null（閉じる側）。accounts を作る・last_seen を1分に1回書くのは mj_me（押さえる）と mj_me_read（押さえない）。
--   ★関数の持ち主（postgres）は auth.users・auth.sessions を読める＝I-7①（khaw 11-20 測り）★
create or replace function mahjong_private.mj_who() returns uuid
language plpgsql stable set search_path = '' as $fn$
declare
  v_uid uuid; v_sid uuid;
begin
  begin
    v_uid := auth.uid();
    v_sid := (auth.jwt() ->> 'session_id')::uuid;
  exception when others then
    return null;
  end;
  if v_uid is null or v_sid is null then return null; end if;
  if not exists (select 1 from auth.users u
                  where u.id = v_uid and u.is_anonymous is false and u.deleted_at is null
                    and (u.banned_until is null or u.banned_until <= pg_catalog.now())) then
    return null;
  end if;
  if not exists (select 1 from auth.sessions s
                  where s.id = v_sid and s.user_id = v_uid and (s.not_after is null or s.not_after > pg_catalog.now())) then
    return null;
  end if;
  return v_uid;
end $fn$;
revoke all on function mahjong_private.mj_who() from public, anon, authenticated;
-- 書き・入室・一覧の人＝mj_me。★accounts の行を取引の終わりまで押さえる（on conflict do update は where が偽でも押さえる）★
--   ＝同じ人の join／write が1本ずつに並ぶ＝人ごとの上限（join:ufail1m・write:u1m/u1d）の読みと足しはこの押さえで守られている。外すな。
create or replace function mahjong_private.mj_me() returns uuid
language plpgsql volatile set search_path = '' as $fn$
declare
  v_uid uuid;
begin
  v_uid := mahjong_private.mj_who();
  if v_uid is null then return null; end if;
  insert into mahjong.accounts as a (user_id) values (v_uid)
    on conflict (user_id) do update set last_seen = pg_catalog.now()
    where a.last_seen < pg_catalog.now() - interval '1 minute';
  return v_uid;
end $fn$;
revoke all on function mahjong_private.mj_me() from public, anon, authenticated;
-- P2 §2.3（11-23 測った）：読みの人＝mj_me_read。押さえない（mj_me の押さえで同じ人の読み4席が1本ずつに並び、5本目が busy でなく 12秒待った）。
--   在れば skip locked で古い時だけ last_seen を足す（他が押さえていれば足さずに通る）・無い時だけ入れる（初めての同時は後の1本が先の commit を待つ）
create or replace function mahjong_private.mj_me_read() returns uuid
language plpgsql volatile set search_path = '' as $fn$
declare
  v_uid uuid;
begin
  v_uid := mahjong_private.mj_who();
  if v_uid is null then return null; end if;
  if exists (select 1 from mahjong.accounts a where a.user_id = v_uid) then
    update mahjong.accounts a set last_seen = pg_catalog.now()
     where a.ctid = any(array(select y.ctid from mahjong.accounts y
                               where y.user_id = v_uid and y.last_seen < pg_catalog.now() - interval '1 minute'
                               for update skip locked));
  else
    insert into mahjong.accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  end if;
  return v_uid;
end $fn$;
revoke all on function mahjong_private.mj_me_read() from public, anon, authenticated;

-- P3（pbundle_sadame v2.1 §2）：全体の窓（create:1m・create:1d・join:fail1m の 'all'）はやめた＝残りの行は mj_sweep の 3 古い行（1m＝10分・1d＝2日）で消える（関数の外に delete を置かない＝sql-guard ④）

-- ── 段C §3 名前ごとの止め（kind 'join:nfail1h'・P3 [S2]：key＝name_key || ':' || user_id＝名前×人・15分の窓＝date_bin）──
--   足す＝名前の道の外れ・create shared と room_share の dup（当たっても戻さない）。5 に着いたらその人はその名前を窓の終わりまで止め（読みは押さえない＝§6）
--   他の人の外れでは止まらない（垢を足して客を止められない）。1人の当て推量の上限は join:ufail1d（24時間50）
drop function if exists mahjong_private.mj_nfail_until(text);
drop function if exists mahjong_private.mj_nfail_add(text);
create or replace function mahjong_private.mj_nfail_until(p_nk text, p_me uuid) returns timestamptz
language sql stable set search_path = '' as $fn$
  select case when coalesce(pg_catalog.sum(l.count), 0) >= 5 then w.s + interval '15 minutes' end
    from (select pg_catalog.date_bin('15 minutes', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00') as s) w
    left join mahjong.limits l on l.kind = 'join:nfail1h' and l.key = p_nk || ':' || p_me::text and l.window_start = w.s
   group by w.s
$fn$;
revoke all on function mahjong_private.mj_nfail_until(text, uuid) from public, anon, authenticated;
create or replace function mahjong_private.mj_nfail_add(p_nk text, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
begin
  if p_nk is null or p_me is null then return; end if;
  insert into mahjong.limits (kind, key, window_start, count)
    values ('join:nfail1h', p_nk || ':' || p_me::text, pg_catalog.date_bin('15 minutes', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00'), 1)
    on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
end $fn$;
revoke all on function mahjong_private.mj_nfail_add(text, uuid) from public, anon, authenticated;

-- ── P3 人ごとの窓の下請け（pbundle_sadame v2.1 §2）──
-- 24時間の窓（1時間ごとの行）が p_cap に着いていれば「1つ足せるようになる時刻」＝古い窓から抜けて p_cap 未満になる窓の始め＋24時間。着いていなければ null
create or replace function mahjong_private.mj_day_until(p_kind text, p_key text, p_cap int) returns timestamptz
language sql stable set search_path = '' as $fn$
  select w.s + interval '24 hours' from (
    select l.window_start as s, pg_catalog.sum(l.count) over (order by l.window_start) as cum, pg_catalog.sum(l.count) over () as tot
      from mahjong.limits l where l.kind = p_kind and l.key = p_key and l.window_start > pg_catalog.now() - interval '24 hours') w
   where w.tot >= p_cap and w.tot - w.cum < p_cap
   order by w.s limit 1
$fn$;
revoke all on function mahjong_private.mj_day_until(text, text, int) from public, anon, authenticated;
-- 窓に p_n を足す（p_old 以前の同じ kind・key の窓は先に消す）
create or replace function mahjong_private.mj_lim_add(p_kind text, p_key text, p_ws timestamptz, p_old timestamptz, p_n int) returns void
language plpgsql set search_path = '' as $fn$
begin
  if p_key is null or p_n is null or p_n <= 0 then return; end if;
  delete from mahjong.limits l where l.kind = p_kind and l.key = p_key and l.window_start <= p_old;
  insert into mahjong.limits (kind, key, window_start, count) values (p_kind, p_key, p_ws, p_n)
    on conflict (kind, key, window_start) do update set count = mahjong.limits.count + excluded.count;
end $fn$;
revoke all on function mahjong_private.mj_lim_add(text, text, timestamptz, timestamptz, int) from public, anon, authenticated;
-- [S3] bf の数え：1人1分20回（join:ubf1m）。bf の前に比べる部屋の数を足す（当たりの道も数える）。越えるなら足さずに false
--   押さえる順：key は人ごと＝同じ人の join／write は mj_me の accounts の押さえで1本ずつ＝他の取引と同じ行を取り合わない
create or replace function mahjong_private.mj_ubf_take(p_me uuid, p_n int) returns boolean
language plpgsql set search_path = '' as $fn$
declare v_min timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now()); v_n bigint;
begin
  if p_me is null or p_n is null or p_n <= 0 then return true; end if;
  select coalesce(pg_catalog.sum(l.count), 0) into v_n from mahjong.limits l
   where l.kind = 'join:ubf1m' and l.key = p_me::text and l.window_start = v_min;
  if v_n + p_n > 20 then return false; end if;
  perform mahjong_private.mj_lim_add('join:ubf1m', p_me::text, v_min, v_min - interval '1 minute', p_n);
  return true;
end $fn$;
revoke all on function mahjong_private.mj_ubf_take(uuid, int) from public, anon, authenticated;

-- ── 段C §3 組の比べ（mj_pair_check の bf の所）──
--   相手＝同じ name_key の shared で終えていない部屋（自分の部屋 p_self は外す）。返し＝{busy, hit, n, nk, seen:{id:{s,h}}}
--   busy＝相手が20以上（作ると21＝越える）＝bf しない。p_seen＝押さえる前の下見の seen（s＝pass_hash・deleted_at・closed_at の字が同じなら h を使い、
--   違う・下見に無い部屋だけ bf する）＝押さえた後の引き直しはこの関数をもう一度呼ぶ（★引き直し★の行）。
--   ★実装で紙と違えた所（v10.3 で叩く）★：相手に「消した印の7日の shared」も入れる＝消した部屋と同じ組は7日の間作れない。
--     訳＝room_undelete は平文のパスを持たない（塩つき bf どうしは比べられない）＝紙 §3 の「room_undelete の比べ」は作れない。
--     消した部屋の組を空けないでおけば、戻した時に同じ組が2つ開く事が起きない（room_undelete は比べずに通す）。
drop function if exists mahjong_private.mj_pair_bf(text, text, uuid, jsonb);
create or replace function mahjong_private.mj_pair_bf(p_nk text, p_pk text, p_self uuid, p_seen jsonb, p_me uuid) returns jsonb
language plpgsql set search_path = '' as $fn$
declare
  v_seen jsonb := '{}'::jsonb; v_n int; v_need int; v_hit boolean := false; v_h boolean; v_s text; v_old jsonb; x record;
begin
  select pg_catalog.count(*) into v_n from mahjong.rooms r
   where r.name_key = p_nk and r.kind = 'shared' and r.closed_at is null
     and (r.deleted_at is null or r.deleted_at >= pg_catalog.now() - interval '7 days') and r.id is distinct from p_self;
  if v_n >= 20 then
    return pg_catalog.jsonb_build_object('busy', true, 'what', 'name', 'hit', false, 'n', v_n, 'nk', p_nk, 'seen', '{}'::jsonb);
  end if;
  -- P3 [S3] bf の前に数える＝下見で bf していない・変わった部屋の数（p_me が null＝数えない）
  select pg_catalog.count(*) into v_need from mahjong.rooms r
   where r.name_key = p_nk and r.kind = 'shared' and r.closed_at is null
     and (r.deleted_at is null or r.deleted_at >= pg_catalog.now() - interval '7 days') and r.id is distinct from p_self
     and (coalesce(p_seen, '{}'::jsonb) -> (r.id::text) ->> 's') is distinct from (r.pass_hash || '|' || coalesce(r.deleted_at::text, '') || '|' || coalesce(r.closed_at::text, ''));
  if not mahjong_private.mj_ubf_take(p_me, v_need) then
    return pg_catalog.jsonb_build_object('busy', true, 'what', 'user_min', 'hit', false, 'n', v_n, 'nk', p_nk, 'seen', '{}'::jsonb);
  end if;
  for x in select r.id, r.pass_hash, r.deleted_at, r.closed_at from mahjong.rooms r
            where r.name_key = p_nk and r.kind = 'shared' and r.closed_at is null
              and (r.deleted_at is null or r.deleted_at >= pg_catalog.now() - interval '7 days') and r.id is distinct from p_self
            order by r.created_at, r.id loop
    v_s := x.pass_hash || '|' || coalesce(x.deleted_at::text, '') || '|' || coalesce(x.closed_at::text, '');
    v_old := coalesce(p_seen, '{}'::jsonb) -> (x.id::text);
    if v_old is not null and (v_old ->> 's') = v_s then
      v_h := (v_old ->> 'h')::boolean;
    else
      v_h := extensions.crypt(p_pk, x.pass_hash) = x.pass_hash;
    end if;
    v_seen := v_seen || pg_catalog.jsonb_build_object(x.id::text, pg_catalog.jsonb_build_object('s', v_s, 'h', v_h));
    if v_h then v_hit := true; end if;
  end loop;
  return pg_catalog.jsonb_build_object('busy', false, 'hit', v_hit, 'n', v_n, 'nk', p_nk, 'seen', v_seen);
end $fn$;
revoke all on function mahjong_private.mj_pair_bf(text, text, uuid, jsonb, uuid) from public, anon, authenticated;

-- mj_write の room_share・room_secret の下見（★押さえの外★＝② の部屋の行を押さえる前に bf を済ませる）。
--   持ち主か管でない・形が違う・部屋なし／shared の取り違え・止め中は null（下見なし＝押さえた後に全部 bf）。平文のパスは返さない。
create or replace function mahjong_private.mj_pair_pre(p_room uuid, p_me uuid, p_o jsonb) returns jsonb
language plpgsql set search_path = '' as $fn$
declare
  c_trim constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  x record; v_nk text; v_pk text;
begin
  select r.kind, r.name_key, r.owner_user_id, r.closed_at, r.deleted_at into x from mahjong.rooms r where r.id = p_room;
  if not found or x.deleted_at is not null or x.closed_at is not null then return null; end if;
  if x.owner_user_id is distinct from p_me
     and not exists (select 1 from mahjong.room_accounts a where a.room_id = p_room and a.user_id = p_me and a.role = 'kan'
                       and not exists (select 1 from mahjong.room_bans b where b.room_id = p_room and b.user_id = p_me)) then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(p_o -> 'pass') is distinct from 'string' then return null; end if;
  v_pk := mahjong_private.mj_pass_key(p_o ->> 'pass');
  if v_pk is null or v_pk !~ '^[0-9]{4}$' then return null; end if;
  if (p_o ->> 'op') = 'room_share' then
    if x.kind <> 'solo' or pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then return null; end if;
    v_nk := nullif(mahjong_private.mj_name_key(pg_catalog.btrim(p_o ->> 'name', c_trim)), '');
    if v_nk is null or mahjong_private.mj_nfail_until(v_nk, p_me) is not null then return null; end if;
  elsif (p_o ->> 'op') = 'room_secret' then
    if x.kind <> 'shared' then return null; end if;
    v_nk := x.name_key;
  end if;
  if v_nk is null then return null; end if;
  return mahjong_private.mj_pair_bf(v_nk, v_pk, p_room, '{}'::jsonb, p_me);
end $fn$;
revoke all on function mahjong_private.mj_pair_pre(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── P7（p7_sadame v2.1）掃除の量：部屋をまたぐ印・外部キーの子の索引9つ（§1-5）・尾の索引4つ（§1-2a） ──
alter table mahjong.rooms add column if not exists swept_at timestamptz;   -- 1-b の後に書く＝次の回は他の部屋が先（§1-3）
create index if not exists rooms_rule on mahjong.rooms(rule_set_id, rule_version) where rule_set_id is not null;   -- rooms_rule_fk
create index if not exists settle_snaps_room on mahjong.settle_snaps(room_id);
create index if not exists extras_member on mahjong.extras(member_id);
create index if not exists devices_member on mahjong.devices(member_id) where member_id is not null;
create index if not exists room_accounts_member_all on mahjong.room_accounts(member_id) where member_id is not null;
create index if not exists sessions_rule on mahjong.sessions(rule_set_id, rule_version);
create index if not exists sessions_rule_alt on mahjong.sessions(rule_set_id_alt, rule_version_alt) where rule_set_id_alt is not null;
create index if not exists tables_rule on mahjong.tables(rule_set_id, rule_version);
create index if not exists hanchans_rule on mahjong.hanchans(rule_set_id, rule_version);
create index if not exists op_results_at_only on mahjong.op_results(at);
create index if not exists creates_at on mahjong.creates(at);
create index if not exists limits_window on mahjong.limits(window_start);
-- A15 §1.7（a15_sadame v1.1）：入180日の掃除をやめた＝それだけが使っていた索引を消す
drop index if exists mahjong.room_accounts_nyu_seen;
create index if not exists rooms_sweep_pick on mahjong.rooms(swept_at nulls first, deleted_at, id) where deleted_at is not null;   -- §2 の測り（11-23）＝部屋を選ぶ所が呼びごとに rooms を読み切っていた（10秒ごと）＝消した部屋だけの小さい索引・選ぶ順そのまま

-- ── ついでの掃除（段2b-2・案 mahjong_tataki_2026-11-20/sweep_sekkei.md v1.2＝設計前 taiketsu 止め3→叩き直し 止め1→止め0）──
-- 呼ぶのは入口（mj_room_create・mj_room_join）の ok:true を返す直前だけ（外側も begin … exception で包む＝掃除が落ちても入口の返しは変わらない）。
-- ★待たない★＝取る行は全部 for update skip locked・関数に lock_timeout 50ms（取れない待ちは 55P03 でその手順の塊だけ戻る）。
-- 手順（各々が別の塊・別の枠 p_max＝試験で切れ目を動かす・入口からは既定の 100）。順は本体の押さえる順（rooms→totals→limits）を崩さない：
--   1 部屋の物理の消し（いちばん古い1部屋）＝ⓐ 消して7日だけ（ⓑ 空・放置の部屋の消しは段C v10.1 で止めた＝後にした守り）
--     1-a 子の行の合計（cells・tobi・rule_sets も入れる）が p_max 以下＝totals を skip locked で取れたら hanchans→tables→sessions→room_accounts→devices を明に消してから rooms（残りは cascade）・開いた shared だった時だけ rooms_all −1
--         （sessions・tables・hanchans の rule_sets への外部キーは NO ACTION＝rooms の cascade に任せると順で落ちる＝v1.2）
--     1-b 大きい部屋＝ⓐ は子を決まった順に枠の数だけ消す（hanchans は cells・tobi が付く＝残り÷9・rule_sets は sessions の後で rooms が指す1行と開催日・卓・半荘が指す版を除く＝S1・1回の掃除は手順ごとに p_max 行まで＝設計図 §3.2）
--     塊が落ちた部屋は limits ('sweep:bad', 部屋, 今日) の印＝その日は飛ばす
--   4 totals の数え直し（1日1回・印 sweep:recount）  2 （A15 でやめた＝入った部屋は消さない・外れるのは出る・出される・パスが変わる時だけ）
--   3 古い行＝op_results 7日・creates 2日・limits（kind の終わり 1m＝10分・1h＝2時間・1d／u1d／sweep:*＝2日・★他の kind は消さず log★）
-- P7：手順1（部屋の消し）だけ＝mj_sweep_room（1部屋・true＝部屋を1つ選べた）。尾（2・3・4）は mj_sweep_tail（別の取引で毎分＝§1-2a）
create or replace function mahjong_private.mj_sweep_room(p_max int default 1000) returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '50ms' as $fn$
declare
  v_max  int := greatest(coalesce(p_max, 100), 1);
  v_room uuid; v_del timestamptz; v_rs uuid; v_rv int; v_n bigint; v_left bigint; v_d bigint; v_all int; v_real bigint;
  v_open boolean;
  v_day  timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
begin
  -- ── 1 部屋の物理の消し ──
  begin
    -- 段C v10.1 止め1：ⓑ（空・放置の消し）は kind を問わず止めた＝終わるのは持ち主の［部屋を終える］だけ・消えるのは持ち主が消して7日だけ（ⓐ）
    select x.id, x.deleted_at, x.rule_set_id, x.rule_version, (x.kind = 'shared' and x.closed_at is null)
      into v_room, v_del, v_rs, v_rv, v_open from mahjong.rooms x
     where x.deleted_at < pg_catalog.now() - interval '7 days'
       and not exists (select 1 from mahjong.limits l where l.kind = 'sweep:bad' and l.key = x.id::text and l.window_start = v_day)
     order by x.swept_at nulls first, x.deleted_at, x.id   -- P7 §1-3：1-b の後の部屋は他の部屋の後へ
     limit 1 for update of x skip locked;
    if v_room is not null then
      -- 子の行の数（各表 v_max+1 で打ち切る＝数えも枠の内）
      v_n := (select pg_catalog.count(*) from (select 1 from mahjong.history z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.op_results z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.hanchans z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.cells z join mahjong.hanchans h on h.id = z.hanchan_id where h.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.tobi z join mahjong.hanchans h on h.id = z.hanchan_id where h.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.extras z join mahjong.tables t on t.id = z.table_id where t.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.tables z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.settle_snaps z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.sessions z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.room_accounts z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.members z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.leagues z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.room_bans z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.member_claims z where z.room_id = v_room limit v_max + 1) q)   -- 2c-2b v1.2 N1
           + (select pg_catalog.count(*) from (select 1 from mahjong.devices z where z.room_id = v_room limit v_max + 1) q)
           + (select pg_catalog.count(*) from (select 1 from mahjong.rule_sets z where z.room_id = v_room limit v_max + 1) q);
      -- rule_sets も数える＝1-a の cascade で消える行も p_max の内（§3.2 手順ごとに最大100行）。版が多い部屋は 1-b ⓐ が枠ずつ消す（rooms が指す1行は残す＝taiketsu 止め S1）
      if v_n <= v_max then
        -- 1-a 小さい部屋＝totals を取れた時だけ（create の中なら自分で持っている）
        select t.rooms_all into v_all from mahjong.totals t where t.id = 1 for update skip locked;
        if found then
          delete from mahjong.hanchans z where z.room_id = v_room;
          delete from mahjong.tables z where z.room_id = v_room;
          delete from mahjong.sessions z where z.room_id = v_room;
          delete from mahjong.room_accounts z where z.room_id = v_room;
          delete from mahjong.member_claims z where z.room_id = v_room;   -- 2c-2b v1.2 N1＝cascade に任せない
          delete from mahjong.devices z where z.room_id = v_room;
          delete from mahjong.rooms x where x.id = v_room;
          if v_open then update mahjong.totals set rooms_all = greatest(rooms_all - 1, 0) where id = 1; end if;   -- 段C：開いた shared の時だけ引く
        end if;
      else
        -- 1-b ⓐ 消して7日の大きい部屋＝子を決まった順に枠の数だけ（rooms の行は次の回の 1-a で消す）
        v_left := v_max;
        if v_left > 0 then
          delete from mahjong.history z where z.ctid = any(array(select y.ctid from mahjong.history y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.op_results z where z.ctid = any(array(select y.ctid from mahjong.op_results y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.hanchans z where z.ctid = any(array(select y.ctid from mahjong.hanchans y where y.room_id = v_room limit greatest(1, v_left / 9) for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d * 9;
        end if;
        if v_left > 0 then
          delete from mahjong.extras z where z.ctid = any(array(select y.ctid from mahjong.extras y join mahjong.tables t on t.id = y.table_id
            where t.room_id = v_room limit v_left for update of y skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.tables z where z.ctid = any(array(select y.ctid from mahjong.tables y where y.room_id = v_room
            and not exists (select 1 from mahjong.hanchans h where h.table_id = y.id) limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.settle_snaps z where z.ctid = any(array(select y.ctid from mahjong.settle_snaps y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.sessions z where z.ctid = any(array(select y.ctid from mahjong.sessions y where y.room_id = v_room
            and not exists (select 1 from mahjong.tables t where t.session_id = y.id)
            and not exists (select 1 from mahjong.settle_snaps s where s.session_id = y.id) limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          -- ルールの版＝rooms が指す1行（先送りの外部キー）と、まだ残る開催日・卓・半荘が指す版（NO ACTION）は残す
          delete from mahjong.rule_sets z where z.ctid = any(array(select y.ctid from mahjong.rule_sets y where y.room_id = v_room
            and (v_rs is null or not (y.id = v_rs and y.version = v_rv))   -- 部屋がルールを指さない（null）時は全部が対象（not null は null＝1行も選ばない穴・taiketsu-naoshi 直し）
            and not exists (select 1 from mahjong.sessions s where s.rule_set_id = y.id and s.rule_version = y.version)
            and not exists (select 1 from mahjong.tables t where t.rule_set_id = y.id and t.rule_version = y.version)
            and not exists (select 1 from mahjong.hanchans h where h.rule_set_id = y.id and h.rule_version = y.version) limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.room_accounts z where z.ctid = any(array(select y.ctid from mahjong.room_accounts y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then   -- 名乗り（2c-2b v1.2 N1）＝members の前に明に消す（cascade で枠の外の行を消さない）
          delete from mahjong.member_claims z where z.ctid = any(array(select y.ctid from mahjong.member_claims y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.members z where z.ctid = any(array(select y.ctid from mahjong.members y where y.room_id = v_room
            and not exists (select 1 from mahjong.extras e where e.member_id = y.id) limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.leagues z where z.ctid = any(array(select y.ctid from mahjong.leagues y where y.room_id = v_room
            and not exists (select 1 from mahjong.sessions s where s.league_id = y.id) limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.room_bans z where z.ctid = any(array(select y.ctid from mahjong.room_bans y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        if v_left > 0 then
          delete from mahjong.devices z where z.ctid = any(array(select y.ctid from mahjong.devices y where y.room_id = v_room limit v_left for update skip locked));
          get diagnostics v_d = row_count; v_left := v_left - v_d;
        end if;
        -- 1行も消せなかった（全部ほかが持っている等）＝例外で塊を戻して sweep:bad の印＝その日は飛ばす（同じ部屋で手順1を止めない）
        if v_left = v_max then raise exception 'mj_sweep_stuck'; end if;
        update mahjong.rooms set swept_at = pg_catalog.now() where id = v_room;   -- P7 §1-3
      end if;
    end if;
  exception when others then
    raise log 'mj_sweep room % %', v_room, sqlstate;
    if v_room is not null then
      begin
        insert into mahjong.limits (kind, key, window_start, count) values ('sweep:bad', v_room::text, v_day, 1)
          on conflict (kind, key, window_start) do nothing;
      exception when others then
        raise log 'mj_sweep bad-mark %', sqlstate;
      end;
    end if;
  end;

  return v_room is not null;
end $fn$;
revoke all on function mahjong_private.mj_sweep_room(int) from public, anon, authenticated;

-- P7 §1-2b：尾の消し損ねの印（黙らない）＝limits ('sweep:tailbad', 手順, 今日)。この insert も落ちたら例外のまま上へ（cron の job は failed）
create or replace function mahjong_private.mj_sweep_tailbad(p_step text) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  insert into mahjong.limits (kind, key, window_start, count)
    values ('sweep:tailbad', p_step, pg_catalog.date_trunc('day', pg_catalog.now()), 1)
    on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
end $fn$;
revoke all on function mahjong_private.mj_sweep_tailbad(text) from public, anon, authenticated;

-- P7 §1-2a：尾＝（2 入180日は A15 でやめた）3 古い行 → 窓の無い kind（1日1回）→ cron の記録 → 4 数え直し（印の無い日だけ totals を取る＝最後）
create or replace function mahjong_private.mj_sweep_tail(p_max int default 1000) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '50ms' as $fn$
declare
  v_max  int := greatest(coalesce(p_max, 1000), 1);
  v_all int; v_real bigint; v_d bigint;
  v_day  timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
begin
  -- ── 2 入の room_accounts 180日＝A15 §1.7 でやめた（司さん「対局は全部残す」「履歴に上限作るな」・入った部屋は全部ホームに出す） ──

  -- ── 3 古い行 ──
  begin
    delete from mahjong.op_results z where z.ctid = any(array(
      select y.ctid from mahjong.op_results y where y.at < pg_catalog.now() - interval '7 days' limit v_max for update skip locked));
  exception when others then
    raise log 'mj_sweep op_results %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('op_results');
  end;
  begin
    delete from mahjong.creates z where z.ctid = any(array(
      select y.ctid from mahjong.creates y where y.at < pg_catalog.now() - interval '2 days' limit v_max for update skip locked));
  exception when others then
    raise log 'mj_sweep creates %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('creates');
  end;
  begin
    delete from mahjong.limits z where z.ctid = any(array(
      select y.ctid from mahjong.limits y
       where y.window_start < pg_catalog.now() - interval '10 minutes'   -- P7：limits_window が効く前置き（下の3つはどれもこれより古い）
         and ((y.kind like '%1m' and y.window_start < pg_catalog.now() - interval '10 minutes')
          or (y.kind like '%1h' and y.window_start < pg_catalog.now() - interval '2 hours')
          or ((y.kind like '%1d' or y.kind like 'sweep:%') and y.window_start < pg_catalog.now() - interval '2 days'))
       limit v_max for update skip locked));
  exception when others then
    raise log 'mj_sweep limits %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('limits');
  end;
  -- 窓が無い kind（消さない）＝1日1回だけ全部を読む（印 sweep:kindcheck）・在れば log と tailbad
  begin
    insert into mahjong.limits (kind, key, window_start, count) values ('sweep:kindcheck', '*', v_day, 1)
      on conflict (kind, key, window_start) do nothing;
    get diagnostics v_d = row_count;
    if v_d = 1 and exists (select 1 from mahjong.limits y where not (y.kind like '%1m' or y.kind like '%1h' or y.kind like '%1d' or y.kind like 'sweep:%')) then
      raise log 'mj_sweep limits: kind に窓が無い行がある（消さない）';
      perform mahjong_private.mj_sweep_tailbad('kind');
    end if;
  exception when others then
    raise log 'mj_sweep kindcheck %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('kindcheck');
  end;
  -- cron の記録＝自分の3つの job（P9 で mj-wwatch を足した）の行だけ・7日より古い物（共有の倉庫・他のアプリの行は触らない＝§1-7）
  begin
    if exists (select 1 from pg_catalog.pg_namespace n where n.nspname = 'cron') then
      execute 'delete from cron.job_run_details d where d.jobid in (select j.jobid from cron.job j where j.jobname in (''mj-sweep-tick'', ''mj-sweep-tail'', ''mj-wwatch'')) and d.end_time < pg_catalog.now() - interval ''7 days''';
    end if;
  exception when others then
    raise log 'mj_sweep cron %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('cron');
  end;

  -- ── 4 totals の数え直し（1日1回・★今日の印が無い時だけ totals を取る★＝先に印を鍵なしで見る・最後の手順） ──
  begin
    if not exists (select 1 from mahjong.limits l where l.kind = 'sweep:recount' and l.key = '*' and l.window_start = v_day) then
      select t.rooms_all into v_all from mahjong.totals t where t.id = 1 for update skip locked;
      if found then
        insert into mahjong.limits (kind, key, window_start, count) values ('sweep:recount', '*', v_day, 1)
          on conflict (kind, key, window_start) do nothing;
        get diagnostics v_d = row_count;
        if v_d = 1 then
          select pg_catalog.count(*) into v_real from mahjong.rooms x where x.kind = 'shared' and x.closed_at is null;   -- 段C の式
          if v_real <> v_all then
            raise log 'mj_sweep recount % -> %', v_all, v_real;
            update mahjong.totals set rooms_all = v_real where id = 1;
          end if;
        end if;
      end if;
    end if;
  exception when others then
    raise log 'mj_sweep recount %', sqlstate;
    perform mahjong_private.mj_sweep_tailbad('recount');
  end;
end $fn$;
revoke all on function mahjong_private.mj_sweep_tail(int) from public, anon, authenticated;

-- 作る/入るの ok の直前（6か所）は今まで通り＝部屋1つ＋尾（cron が無くても進む＝§1-4）
create or replace function mahjong_private.mj_sweep(p_max int default 100) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '50ms' as $fn$
begin
  perform mahjong_private.mj_sweep_room(p_max);
  perform mahjong_private.mj_sweep_tail(p_max);
end $fn$;
revoke all on function mahjong_private.mj_sweep(int) from public, anon, authenticated;

-- P7 §1-2：10秒ごとの tick＝1つの取引を短く（p_ms か p_rooms 回の早い方）・尾は入れない・外側は例外を飲まない（部屋ごとの失敗は sweep:bad）
create or replace function mahjong_private.mj_sweep_tick(p_rooms int default 5, p_batch int default 1000, p_ms int default 200) returns int
language plpgsql security definer set search_path = '' set lock_timeout = '50ms' as $fn$
declare
  v_t0 timestamptz := pg_catalog.clock_timestamp();
  v_n  int := 0;
begin
  loop
    exit when v_n >= greatest(coalesce(p_rooms, 5), 1);
    exit when v_n > 0 and pg_catalog.clock_timestamp() - v_t0 >= pg_catalog.make_interval(secs => greatest(coalesce(p_ms, 200), 1) / 1000.0);
    v_n := v_n + 1;
    exit when not mahjong_private.mj_sweep_room(p_batch);
  end loop;
  return v_n;
end $fn$;
revoke all on function mahjong_private.mj_sweep_tick(int, int, int) from public, anon, authenticated;

-- P7 §1-1：時間で回す（cron.schedule は同じ名なら上書き＝当て直しで2本にならない・jobid も保つ）
create extension if not exists pg_cron;
select cron.schedule('mj-sweep-tick', '10 seconds', 'select mahjong_private.mj_sweep_tick()');
select cron.schedule('mj-sweep-tail', '* * * * *', 'select mahjong_private.mj_sweep_tail(1000)');

-- P9 §1.3 [N1][R2-SA] 書きの量の見張り＝cron の mj-wwatch（5分ごと）だけが呼ぶ（★mj_sweep・mj_sweep_tail・客の呼びからは呼ばない★＝客の作る・入るの鍵の下で走らせない）
--   しおり＝wwatch の max(to_id)（空なら history の max(id)＝今から数える）。1回で history の id を最大 50,000 進む（主キーの幅だけ・中身は読まない＝pg_column_size）
--   大きさが読めない回は bytes null で行を書いて先へ進む。24時間の和 rows>200,000・bytes>200MB・totals.rooms_all>5,000 で alert。30日より古い行は1回 1,000 まで消す
--   読む人＝コンサルの週1の本番読み（alert is not null）・kensan は最後の alert と最後の行の時を出す
create or replace function mahjong_private.mj_wwatch() returns void
language plpgsql set search_path = '' set lock_timeout = '1s' as $fn$
declare
  v_from bigint; v_max bigint; v_to bigint; v_bytes bigint; v_r24 bigint; v_b24 bigint; v_rooms int; v_al text;
  v_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
begin
  begin
    select coalesce(pg_catalog.max(h.id), 0) into v_max from mahjong.history h;
    select pg_catalog.max(w.to_id) into v_from from mahjong.wwatch w;
    v_from := coalesce(v_from, v_max);
    v_to := greatest(v_from, least(v_max, v_from + 50000));
    begin
      select coalesce(pg_catalog.sum(coalesce(pg_catalog.pg_column_size(h.before_value), 0) + coalesce(pg_catalog.pg_column_size(h.after_value), 0)
                                   + coalesce(pg_catalog.pg_column_size(h.fold), 0)), 0)
        into v_bytes from mahjong.history h where h.id > v_from and h.id <= v_to;
    exception when others then
      raise log 'mj_wwatch bytes % %', sqlstate, sqlerrm;
      v_bytes := null;
    end;
    select t.rooms_all into v_rooms from mahjong.totals t where t.id = 1;
    select coalesce(pg_catalog.sum(w.rows), 0), coalesce(pg_catalog.sum(w.bytes), 0) into v_r24, v_b24
      from mahjong.wwatch w where w.hour > pg_catalog.now() - interval '24 hours';
    v_r24 := v_r24 + (v_to - v_from); v_b24 := v_b24 + coalesce(v_bytes, 0);
    v_al := nullif(pg_catalog.concat_ws(' ',
      case when v_r24 > 200000 then 'rows24=' || v_r24 end,
      case when v_b24 > 200 * 1024 * 1024 then 'bytes24=' || v_b24 end,
      case when v_rooms > 5000 then 'rooms_all=' || v_rooms end), '');
    insert into mahjong.wwatch (hour, from_id, to_id, rows, bytes, rooms_all, alert)
      values (v_hour, v_from, v_to, v_to - v_from, v_bytes, v_rooms, v_al)
      on conflict (hour, from_id) do update set to_id = excluded.to_id, rows = excluded.rows, bytes = excluded.bytes,
        rooms_all = excluded.rooms_all, alert = excluded.alert;
    delete from mahjong.wwatch z where z.ctid = any(array(
      select w.ctid from mahjong.wwatch w where w.hour < pg_catalog.now() - interval '30 days' limit 1000));
  exception when others then
    raise log 'mj_wwatch % %', sqlstate, sqlerrm;
  end;
end $fn$;
revoke all on function mahjong_private.mj_wwatch() from public, anon, authenticated;
select cron.schedule('mj-wwatch', '*/5 * * * *', 'select mahjong_private.mj_wwatch()');

-- ── 入口1本目：部屋を作る（設計図 §2・§3.0・§3.1・§3.2・案 v18_login_sekkei.md G＋前の叩き room_create_tome.txt 止め2直し5）──
-- ⓪ 呼んだ人＝mj_me（null なら {ok:false, err:'mj_session'}＝画面は「ログインが切れました」・K-10）。作った人が持ち主で管。
-- p_secrets＝{url_token_hash} の1つだけ（128bit 乱数の sha256＝小文字 hex 64字）。channel_key は倉庫が作る（16 byte の乱数の hex）。
-- 返し：{ok:true, room_id, kind, room_no（shared だけ）, channel_key} ／ {ok:false, err:'mj_session'｜'mj_op_other_user'｜'bad', what｜'range', key｜
--   'gone'｜'mismatch'｜'dup', what(…｜name_pass)｜'busy', what(user_min｜solo_day（until）｜user｜user_day（until）｜room_no｜name)｜'locked', until}。
--   段C：名前もパスも null＝部屋なし（solo）＝R・人ごとの数え・組の比べを見ない。
--   ★ok でない返しは creates・totals・部屋に何も残さない★（S1・N2）＝残るのは mj_me の accounts の行と、
--   ★dup name_pass の時の名前ごとの止めの数え（join:nfail1h）・1人の外れ（join:ufail1d）と bf の数え（join:ubf1m＝下見で足した分）だけ★（段C §3・P3）
-- 順（S1）：人 → 形 → ルール → よくあるパス → totals を for update（作るを全体で1列に並べる＝同じ op_id の2本目はここで待つ）
--   → creates に在れば送り直しの返し（N1・別の人なら mj_op_other_user＝K-7）→ 一意の当たりを bf の前に見る → full（R−20）
--   → busy（全体 1分20・24時間200 → 人ごと24時間5部屋＝足す前に cap を見る）→ 部屋番号 → 書く（unique_violation は塊ごと戻して dup）。
-- 押さえる順：作るは totals を先に押さえ、新しい行しか書かない（今の部屋の行は押さえない）＝§3.2 の rooms→totals の例外。
-- 「1日」は直近24時間の転がし（v15.2）＝limits の create:1d（全体）・create:u1d（key＝user_id）は1時間ごとの窓を24本まで持って足す。
-- ★平文のパスは どの表にも・raise の字にも入れない★（引数で受けるだけ）
create or replace function public.mj_room_create(p_op_id uuid, p_name text, p_pass text, p_rules jsonb, p_secrets jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c_trim  constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  v_me    uuid; v_name text; v_key text; v_rules jsonb; v_url text; v_kind text; v_nk text;
  v_all   int; v_cap int; v_room uuid; v_cuser uuid; v_rs uuid; v_no text; v_ch text;
  v_n     bigint; v_i int; v_d1 int; v_err text; v_cons text;
  v_pre   jsonb; v_pair jsonb; v_until timestamptz;
  v_min   timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_hour  timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  r       record;
begin
  -- ⓪ 人（K-10）
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;

  -- ① 形（数えに入れない）。段C：名前もパスも null＝部屋なし（solo）・片方だけ null は bad・shared のパスはそろえた後に数字4つ
  if p_op_id is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'op_id'); end if;
  if p_name is null and p_pass is null then
    v_kind := 'solo'; v_name := '対局';
  else
    v_kind := 'shared';
    v_name := pg_catalog.btrim(coalesce(p_name, ''), c_trim);
    if pg_catalog.char_length(v_name) not between 1 and 40 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name');
    end if;
    v_nk := nullif(mahjong_private.mj_name_key(v_name), '');
    if v_nk is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name'); end if;
    if p_pass is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass'); end if;
    v_key := mahjong_private.mj_pass_key(p_pass);
    if v_key is null or v_key !~ '^[0-9]{4}$' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass'); end if;
  end if;
  if p_secrets is null or pg_catalog.jsonb_typeof(p_secrets) <> 'object'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_secrets)) <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'secrets');
  end if;
  v_url := case when pg_catalog.jsonb_typeof(p_secrets -> 'url_token_hash') = 'string' then p_secrets ->> 'url_token_hash' end;
  if v_url is null or v_url !~ '^[0-9a-f]{64}$' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'url_token_hash'); end if;

  -- ② ルール（弾く時は mj_range:<鍵>）
  begin
    v_rules := mahjong_private.mj_rules_ok(p_rules);
  exception when others then
    v_err := sqlerrm;
    if v_err like 'mj\_range:%' then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'range', 'key', pg_catalog.substr(v_err, 10));
    end if;
    raise;
  end;

  -- ③ 段C §3 組の比べの下見（shared だけ・★押さえの外で bf★）＝名前の止め中は bf をせずに locked・送り直しは下見しない
  if v_kind = 'shared' and not exists (select 1 from mahjong.creates c where c.op_id = p_op_id) then
    v_until := mahjong_private.mj_nfail_until(v_nk, v_me);
    if v_until is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', v_until); end if;
    -- P3 [S2] 1人の当て推量の24時間50（dup も数える）
    v_until := mahjong_private.mj_day_until('join:ufail1d', v_me::text, 50);
    if v_until is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_day', 'until', v_until); end if;
    v_pre := mahjong_private.mj_pair_bf(v_nk, v_key, null, '{}'::jsonb, v_me);
    if (v_pre ->> 'what') = 'user_min' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_min'); end if;
  end if;

  -- ④ 作るを全体で1列に並べる
  select t.rooms_all into v_all from mahjong.totals t where t.id = 1 for update;

  -- ⑤ 送り直し（N1）＝同じ op_id は作らずに同じ返し（数えに入れない）・別の人の op_id は返さない（K-7）・kind が違えば bad kind（何も残さない）
  select c.room_id, c.user_id into v_room, v_cuser from mahjong.creates c where c.op_id = p_op_id;
  if found then
    if v_cuser is distinct from v_me then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_op_other_user'); end if;
    select x.id, x.room_no, x.channel_key, x.url_token_hash, x.deleted_at, x.kind into r from mahjong.rooms x where x.id = v_room;
    if not found or r.deleted_at is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    if r.kind <> v_kind then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'kind'); end if;
    if r.url_token_hash <> v_url then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mismatch'); end if;
    begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
    if r.kind = 'solo' then
      return pg_catalog.jsonb_build_object('ok', true, 'room_id', r.id, 'kind', r.kind, 'channel_key', r.channel_key);
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'room_id', r.id, 'kind', r.kind, 'room_no', r.room_no, 'channel_key', r.channel_key);
  end if;

  -- ⑥ 一意の当たりを bf の前に（S1）
  if exists (select 1 from mahjong.rooms x where x.url_token_hash = v_url) then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'what', 'url_token_hash');
  end if;

  if v_kind = 'shared' then
    -- ⑥' 名前の止め（押さえた後にもう一度・読みは押さえない）
    v_until := mahjong_private.mj_nfail_until(v_nk, v_me);
    if v_until is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', v_until); end if;
    -- ⑦ P3：R（mj_caps rooms/all＝開いた shared の数の上限）はやめた（pbundle_sadame v2.1 §2.2・rooms_all は数えだけ＝見張り wwatch の alert 5000）
  end if;

  -- ⑧ 作るの数え（create:u1m 1分5・create:su1d 24時間100・create:u1d 24時間5）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）。パスの総当たりの守り（ubf・ufail1d・nfail）は残す

  -- ⑧' 段C §3 組の比べ（totals を押さえた後に同じ name_key の集まりを丸ごと引き直し、下見で bf していない・変わった部屋だけ bf）
  if v_kind = 'shared' then
    v_pair := mahjong_private.mj_pair_bf(v_nk, v_key, null, coalesce(v_pre -> 'seen', '{}'::jsonb), v_me);   -- ★引き直し★
    if (v_pair ->> 'busy')::boolean then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', coalesce(v_pair ->> 'what', 'name')); end if;
    if (v_pair ->> 'hit')::boolean then
      perform mahjong_private.mj_nfail_add(v_nk, v_me);   -- ★dup の数え★（名前ごとの止め・当たっても戻さない）
      perform mahjong_private.mj_lim_add('join:ufail1d', v_me::text, v_hour, pg_catalog.now() - interval '24 hours', 1);   -- P3 [S2]：dup も1人の当て推量の24時間50に数える
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'what', 'name_pass');
    end if;
  end if;

  -- ⑨ 部屋番号＝4 byte の乱数（4,200,000,000 以上は引き直し＝偏りなし）の 1e8 の余りを8桁前0・最大8回（部屋なしも今の式・返さない）
  for v_i in 1 .. 8 loop
    v_n := ('x' || '00000000' || pg_catalog.encode(extensions.gen_random_bytes(4), 'hex'))::bit(64)::bigint;
    continue when v_n >= 4200000000;
    v_no := pg_catalog.lpad((v_n % 100000000)::text, 8, '0');
    exit when not exists (select 1 from mahjong.rooms x where x.room_no = v_no);
    v_no := null;
  end loop;
  if v_no is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'room_no'); end if;

  -- ⑩ 書く（S2 の順）。一意の当たりは塊ごと戻して dup（塊の中は全部戻る）
  v_room := pg_catalog.gen_random_uuid();
  v_rs   := pg_catalog.gen_random_uuid();
  v_ch   := pg_catalog.encode(extensions.gen_random_bytes(16), 'hex');
  begin
    insert into mahjong.rooms (id, name, room_no, pass_hash, url_token_hash, owner_user_id, channel_key,
                               rule_set_id, rule_version, row_count, kind, name_key)
    values (v_room, v_name, v_no,
            case when v_kind = 'solo' then '!solo' else extensions.crypt(v_key, extensions.gen_salt('bf', 10)) end,
            v_url, v_me, v_ch, v_rs, 1, 1, v_kind, v_nk);
    insert into mahjong.rule_sets (id, version, room_id, rules) values (v_rs, 1, v_room, v_rules);
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (v_room, v_me, 'kan', 'create');
    insert into mahjong.creates (op_id, room_id, user_id) values (p_op_id, v_room, v_me);
    if v_kind = 'shared' then update mahjong.totals set rooms_all = rooms_all + 1 where id = 1; end if;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'what',
      case v_cons when 'rooms_url_token_hash_key' then 'url_token_hash'
                  when 'rooms_room_no_key' then 'room_no' when 'rooms_channel_key_key' then 'channel_key'
                  when 'creates_pkey' then 'op_id' else 'other' end);
  end;
  -- A14 §2.1：新しい部屋と rule_sets を入れた道だけで覚える（送り直しの道⑤では覚えない）・落ちたら呑まない（server）
  insert into mahjong.account_rules (user_id, players, rules, updated_at) values (v_me, (v_rules ->> 'players')::smallint, v_rules, pg_catalog.clock_timestamp())
    on conflict (user_id, players) do update set rules = excluded.rules, updated_at = excluded.updated_at;   -- 時刻は clock（last の比べ＝同じ取引でも前後が付く）
  begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
  if v_kind = 'solo' then
    return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'kind', v_kind, 'channel_key', v_ch);
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'kind', v_kind, 'room_no', v_no, 'channel_key', v_ch);
end $fn$;
revoke all on function public.mj_room_create(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mj_room_create(uuid, text, text, jsonb, jsonb) to authenticated;

-- ── 入口2本目：部屋に入る（案 tataki/room_join_sekkei.md v1.2＝設計前 taiketsu 止め2直し6・叩き直し 止め1直し2 → 止め0）──
-- ⓪ 人＝mj_me。way＝'pass'（部屋番号8桁＋パス）｜'url'（URL の token の平文＝小文字 hex 32字＝lib/url-token.mjs・倉庫が sha256 にして比べる）。
-- 送り直しは op_id でなく一意 (room_id, user_id)＝同じ人は同じ行（again）。join は履歴を書かない（K-1 に join の op は無い）。
-- 返し：{ok:true, room_id, room_no, name, channel_key, role, again} ／ {ok:false, err:'mj_session'｜'bad', what｜'wrong'｜'locked', until｜
--   'busy', what(user｜user_day（until）｜user_min｜room)｜'gone'｜'full'｜'removed'}。★数えを残す ok でない返しは wrong だけ★（外れの数え）。
-- 走る順：⓪ 人 → ① 形 → ② 部屋を押さえずに引く → ⑤ 入っている人は数えも bf も見ずに again（rooms を押さえない）
--   → ③ 人ごとの外れ 1分10 → ④ pass だけ全体の外れ 1分100 → 無い部屋（pass はふりの bf 1回）→ ⑥ 消した部屋 → ⑦ locked
--   → ⑧ bf（★押さえの外★）→ 部屋を for no key update で押さえて引き直す（変わっていれば wrong で数えない・行が無ければ gone）
--   → 外れ＝fail_count と limits → ⑨ もう一度入っているか → bans → 200人 → 1時間60 → 書く。
-- 押さえる順（§3.2）＝accounts（mj_me）→ rooms（その1部屋）→ limits（(kind,key) の字の順＝join:fail1m → join:ok1h → join:ufail1m）。
-- 残余：⑤は rooms を押さえない＝同時に account_remove・room_delete が通ると1回だけ again が返る（次の呼びで removed／gone）。
-- ★平文のパス・token は どの表にも・raise の字にも入れない★
-- 段C（§5）：way 'name'（部屋名＋パス・p_name）を足した＝引数を5つにして古い4引数を落とす。部屋なし（solo）はどの道でも無い部屋と同じ返し。
--   name の順＝形 → 人ごと 1分10・全体 1分100 → 名前の止め（入っている人も）→ name_key の開いた shared を作った順に1回ずつ bf
--   → 当たり1＝その部屋で ⑤ 以降は url と同じ道／2以上＝ambiguous（数えない）／0＝wrong（名前の止めの数え +1）。部屋ごとの fail_count・locked_until は見ない。
--   終えた部屋（closed_at）＝入っている人は {ok:true, again:true, closed:true}・入っていない人は {ok:false, err:'closed'}（数えない）・名前の道は引かない。
drop function if exists public.mj_room_join(text, text, text, text);
create or replace function public.mj_room_join(p_way text, p_room_no text, p_key text, p_pass text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c_dummy constant text := '$2a$10$' || 'mjdummysaltmjdummysalt';   -- ふりの bf の塩（cost 10＝本物と同じ重さ・22字）
  c_trim  constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  v_me   uuid; v_pk text; v_uh text; v_found boolean := false; v_ok boolean := false; v_role text;
  v_room uuid; v_no text; v_name text; v_ch text; v_hash text; v_url text; v_del timestamptz; v_lock timestamptz;
  v_kind text; v_closed timestamptz; v_nk text; v_hits int := 0; v_cands int := 0; v_until timestamptz;
  v_n    bigint; v_cap int;
  v_min  timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_5m   timestamptz := pg_catalog.date_bin('5 minutes', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');
  r      record; cand record;
begin
  -- ⓪ 人（K-10）
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;

  -- ① 形（数えに入れない・何も残さない）＝使わない方の引数が在っても bad（取り違えを黙って通さない）
  if p_way is null or p_way not in ('pass', 'url', 'name') then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'way'); end if;
  if p_way in ('pass', 'url') and p_name is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name'); end if;
  if p_way = 'pass' then
    if p_key is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'key'); end if;
    if p_room_no is null or p_room_no !~ '^[0-9]{8}$' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_no'); end if;
    if p_pass is null or pg_catalog.char_length(p_pass) not between 4 and 64 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
    end if;
    v_pk := mahjong_private.mj_pass_key(p_pass);
    if pg_catalog.octet_length(v_pk) > 72 or pg_catalog.char_length(v_pk) not between 4 and 64 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
    end if;
    -- ② 押さえずに引く
    select x.id, x.room_no, x.name, x.channel_key, x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until, x.kind, x.closed_at
      into v_room, v_no, v_name, v_ch, v_hash, v_url, v_del, v_lock, v_kind, v_closed
      from mahjong.rooms x where x.room_no = p_room_no;
    v_found := found;
  elsif p_way = 'url' then
    if p_room_no is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_no'); end if;
    if p_pass is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass'); end if;
    if p_key is null or p_key !~ '^[0-9a-f]{32}$' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'key'); end if;
    v_uh := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex');
    select x.id, x.room_no, x.name, x.channel_key, x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until, x.kind, x.closed_at
      into v_room, v_no, v_name, v_ch, v_hash, v_url, v_del, v_lock, v_kind, v_closed
      from mahjong.rooms x where x.url_token_hash = v_uh;
    v_found := found;
  else
    -- 段C §5 way 'name'＝部屋名（1〜40字）とパスだけ（パスの形は今の 4〜64字のまま）
    if p_room_no is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_no'); end if;
    if p_key is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'key'); end if;
    if p_name is null or pg_catalog.char_length(p_name) not between 1 and 40 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name');
    end if;
    v_nk := nullif(mahjong_private.mj_name_key(pg_catalog.btrim(p_name, c_trim)), '');
    if v_nk is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name'); end if;
    if p_pass is null or pg_catalog.char_length(p_pass) not between 4 and 64 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
    end if;
    v_pk := mahjong_private.mj_pass_key(p_pass);
    if pg_catalog.octet_length(v_pk) > 72 or pg_catalog.char_length(v_pk) not between 4 and 64 then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
    end if;
  end if;
  -- 段C §5 部屋なし潰し：番号・url のどの道でも無い部屋と同じ返し（番号はふりの bf 1回・今の無い番号と同じ数え）
  if v_found and v_kind = 'solo' then v_found := false; end if;   -- ★部屋なし潰し★

  if p_way <> 'name' then
    -- ⑤ 入っている人＝数えも bf も locked も見ない（S1）・fail_count は触らない（N3）・rooms は押さえない
    if v_found then
      select a.role into v_role from mahjong.room_accounts a where a.room_id = v_room and a.user_id = v_me;
      if found then
        if v_del is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
        update mahjong.room_accounts a set last_seen = pg_catalog.now() where a.room_id = v_room and a.user_id = v_me;
        begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
        if v_closed is not null then
          return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
            'channel_key', v_ch, 'role', v_role, 'again', true, 'closed', true);
        end if;
        return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
          'channel_key', v_ch, 'role', v_role, 'again', true);
      end if;
      -- 段C §5 終えた部屋に入っていない人＝closed（数えない）
      if v_del is null and v_closed is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'closed'); end if;
    end if;
  end if;

  -- ③ 人ごとの外れ 1分10（どの道も・bf の前）
  select coalesce(pg_catalog.sum(l.count), 0) into v_n from mahjong.limits l
   where l.kind = 'join:ufail1m' and l.key = v_me::text and l.window_start = v_min;
  if v_n >= 10 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user'); end if;
  -- ④ P3：全体の外れ 1分100（join:fail1m 'all'）はやめた＝1人の外れ 24時間50（join:ufail1d・どの道も・[S2]）
  v_until := mahjong_private.mj_day_until('join:ufail1d', v_me::text, 50);   -- ★人の24時間50★
  if v_until is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_day', 'until', v_until); end if;

  if p_way = 'name' then
    -- 名前の止め（入っている人も止める）
    v_until := mahjong_private.mj_nfail_until(v_nk, v_me);   -- ★名前の道の止め★
    if v_until is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', v_until); end if;
    -- P3 [S3] bf の数え（比べる部屋の数・無い名前はふりの1回）＝bf の前
    select pg_catalog.count(*) into v_n from mahjong.rooms y where y.name_key = v_nk and y.kind = 'shared' and y.deleted_at is null and y.closed_at is null;
    if not mahjong_private.mj_ubf_take(v_me, case when v_n < 1 then 1 else v_n::int end) then   -- ★名前の道の bf の数え★
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_min');
    end if;
    -- name_key で開いた shared を作った順に1つずつ bf（1部屋1回・★押さえの外★）
    for cand in select y.id, y.room_no, y.name, y.channel_key, y.pass_hash, y.url_token_hash, y.deleted_at, y.locked_until, y.kind, y.closed_at
               from mahjong.rooms y
              where y.name_key = v_nk and y.kind = 'shared' and y.deleted_at is null and y.closed_at is null
              order by y.created_at, y.id loop
      v_cands := v_cands + 1;
      if extensions.crypt(v_pk, cand.pass_hash) = cand.pass_hash then   -- ★名前の道の比べ★
        v_hits := v_hits + 1;
        if v_hits = 1 then
          v_room := cand.id; v_no := cand.room_no; v_name := cand.name; v_ch := cand.channel_key; v_hash := cand.pass_hash; v_url := cand.url_token_hash;
          v_del := cand.deleted_at; v_lock := cand.locked_until; v_kind := cand.kind; v_closed := cand.closed_at;
        end if;
      end if;
    end loop;
    if v_cands = 0 then perform extensions.crypt(v_pk, c_dummy); end if;   -- 無い名前もふりの bf 1回（時間をそろえる）
    if v_hits >= 2 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'ambiguous'); end if;   -- 段C前から在る同じ組（数えない）
    if v_hits = 1 then
      v_found := true; v_ok := true;   -- ★名前の道の当たり★
      -- ⑤ 入っている人（url と同じ道）
      select a.role into v_role from mahjong.room_accounts a where a.room_id = v_room and a.user_id = v_me;
      if found then
        update mahjong.room_accounts a set last_seen = pg_catalog.now() where a.room_id = v_room and a.user_id = v_me;
        begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
        return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
          'channel_key', v_ch, 'role', v_role, 'again', true);
      end if;
    end if;
  end if;

  if v_found then
    -- ⑥ 消した部屋（bf の前＝消した部屋のパスは試せない・在り無しは見える＝残余）
    if v_del is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    -- ⑦ pass だけ：止めている部屋（bf をしない・数えない）
    if p_way = 'pass' and v_lock is not null and v_lock > pg_catalog.now() then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', v_lock);
    end if;
    -- ⑧ 比べ（★押さえの外★＝bf の間、同じ部屋の again・書き込みを待たせない）・名前の道は上で bf 済み
    if p_way = 'pass' then
      if not mahjong_private.mj_ubf_take(v_me, 1) then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_min'); end if;   -- P3 [S3]
      v_ok := extensions.crypt(v_pk, v_hash) = v_hash;
    elsif p_way = 'url' then
      v_ok := true;
    end if;
    -- 押さえて引き直す（v1.1 直し1・v1.2 直し1・段C で closed_at も）
    select x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until, x.fail_count, x.closed_at into r
      from mahjong.rooms x where x.id = v_room for no key update;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    if r.pass_hash <> v_hash or r.url_token_hash <> v_url or r.deleted_at is distinct from v_del or r.closed_at is distinct from v_closed then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'wrong');            -- 間に room_secret・room_delete・room_close が通った＝数えない
    end if;
    if p_way = 'pass' and r.locked_until is not null and r.locked_until > pg_catalog.now() then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', r.locked_until);
    end if;
  elsif p_way = 'pass' then
    if not mahjong_private.mj_ubf_take(v_me, 1) then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user_min'); end if;   -- P3 [S3]（ふりの bf も数える）
    perform extensions.crypt(v_pk, c_dummy);                                          -- 無い番号（部屋なしも）もふりの bf 1回（時間をそろえる）
  end if;

  -- 外れ＝数えを残す（この返しだけ）。rooms → limits の順・limits は (kind,key) の字の順（join:fail1m → join:nfail1h → join:ufail1m）
  if not v_ok then
    if v_found and p_way = 'pass' then
      update mahjong.rooms x set
        fail_count   = case when x.fail_count + 1 >= 5 then 0 else x.fail_count + 1 end,
        locked_until = case when x.fail_count + 1 >= 5 then pg_catalog.now() + interval '15 minutes' else x.locked_until end
       where x.id = v_room;
    end if;
    if p_way = 'name' then perform mahjong_private.mj_nfail_add(v_nk, v_me); end if;
    perform mahjong_private.mj_lim_add('join:ufail1d', v_me::text, pg_catalog.date_trunc('hour', pg_catalog.now()), pg_catalog.now() - interval '24 hours', 1);   -- P3 [S2]：1人の外れ 24時間50
    delete from mahjong.limits l where l.kind = 'join:ufail1m' and l.key = v_me::text and l.window_start < v_min;
    insert into mahjong.limits (kind, key, window_start, count) values ('join:ufail1m', v_me::text, v_min, 1)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'wrong');
  end if;

  -- ⑨ 当たった後（rooms を押さえたまま）
  select a.role into v_role from mahjong.room_accounts a where a.room_id = v_room and a.user_id = v_me;
  if found then
    update mahjong.room_accounts a set last_seen = pg_catalog.now() where a.room_id = v_room and a.user_id = v_me;
    begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
    return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
      'channel_key', v_ch, 'role', v_role, 'again', true);
  end if;
  if exists (select 1 from mahjong.room_bans b where b.room_id = v_room and b.user_id = v_me) then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'removed');
  end if;
  -- 1部屋の人 200（full）・1部屋1時間60人（busy room）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）

  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (v_room, v_me, 'nyu', p_way);
  delete from mahjong.room_leaves x where x.room_id = v_room and x.user_id = v_me;   -- C2-1 §1a：入り直し＝抜けた印を消す（名はつながったまま＝ふつうに戻る）
  if p_way = 'pass' then update mahjong.rooms x set fail_count = 0 where x.id = v_room and x.fail_count <> 0; end if;
  -- ⑩ ついでの掃除＝返しを決めた後・return の直前（§3.2・2b-2）
  begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
  return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
    'channel_key', v_ch, 'role', 'nyu', 'again', false);
end $fn$;
revoke all on function public.mj_room_join(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mj_room_join(text, text, text, text, text) to authenticated;

-- ── 入口：自分の部屋の一覧（段C §5・A15＝a15_sadame v4.1 §1・§2）──
-- mj_session・p_limit 1〜50（他は bad what limit）・p_before_at と p_before_id は両方在るか両方 null（片方だけは bad what before）。
-- 対象＝呼んだ人の room_accounts が在り deleted_at null・room_bans に本人が無い部屋（p_open=false は終えた部屋も・
--   true は closed_at null で、最後の開催に締め（settle_snaps）が無い部屋＝lib pickSession と同じ判じ・絞りは limit の前）。
-- 並び＝(coalesce(last_write_at, created_at) desc, id desc)。読むだけ（数えない・読みの門の外）。
-- 数（a15_sadame §1.3 が正本・期待値は tests/fixtures/card-counts.json）：
--   最後の開催＝league_id is null・not voided の開催を (created_at desc, id desc) で1つ。
--   今の卓＝部屋を開いた時に出る卓（js/gamen-room.mjs firstTable）：最後の開催の卓を (created_at, id) に並べ、
--     voided でなく、どの卓の next_table_id でもない卓の1つ目・無ければ卓の1つ目。その鎖＝coalesce(chain_head, id) の卓（voided も含む）。
--   hanchan_n＝鎖の半荘の数（voided も）・member_n＝鎖の voided でない半荘の seats（object）の値の人・
--     その半荘が0なら鎖の最後の卓（chain_no 一番大きい）の seats（array）の要素の人。どちらも空でない字を重なり無しで。
-- 返し＝{ok:true, rooms:[{room_id, kind, name（shared だけ）, role, closed, created_at, last_write_at, last_date, hanchan_n, member_n}]}。
-- 3引数の前の形は drop（残すと名前で呼んだ時に PGRST203）。今の画面（3つの名前）は p_open 既定 false。
-- ★plpgsql のまま★（language sql だと作る時に中身を確かめ、この後で足す列 tables.seats・chain_head に当たって初めの当てが落ちる）。
-- A6（a6db_sadame v1.1）：p_deleted=true＝自分が持ち主（owner_user_id）で、消して7日の内（deleted_at >= now()-7日＝mj_write の門と同じ側）の部屋だけ。
--   room_accounts は見ない（kan の他の人には出さない＝taiketsu S1）・出された印も見ない（mj_write の持ち主の道と同じ）。
--   並び＝(deleted_at desc, id desc)・before は (deleted_at, id) と比べる。行は A15 の欄＋deleted_at・undo_until（＝deleted_at＋7日）・role は 'owner'。
--   p_open と両方 true は bad what deleted。p_deleted=false（null も）の道は前と同じ行（deleted_at の欄は足さない）。4引数の前の形は drop。
drop function if exists public.mj_my_rooms(timestamptz, uuid, int);
drop function if exists public.mj_my_rooms(timestamptz, uuid, int, boolean);
create or replace function public.mj_my_rooms(p_before_at timestamptz, p_before_id uuid, p_limit int, p_open boolean default false, p_deleted boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_me uuid; v_rooms jsonb; v_open boolean := coalesce(p_open, false); v_del boolean := coalesce(p_deleted, false);
begin
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;
  if p_limit is null or p_limit not between 1 and 50 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'limit'); end if;
  if (p_before_at is null) <> (p_before_id is null) then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'before'); end if;
  if v_open and v_del then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'deleted'); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('room_id', q.id, 'kind', q.kind,
           'name', case when q.kind = 'shared' then q.name end, 'role', q.role, 'closed', q.closed_at is not null,
           'created_at', q.created_at, 'last_write_at', q.last_write_at,
           'last_date', q.last_date, 'hanchan_n', coalesce(c.hn, 0), 'member_n', coalesce(c.mn, 0))
           || case when v_del then pg_catalog.jsonb_build_object('deleted_at', q.dd, 'undo_until', q.dd + interval '7 days') else '{}'::jsonb end
           order by q.t desc, q.id desc), '[]'::jsonb)
    into v_rooms
    from ((select x.id, x.kind, x.name, x.closed_at, x.created_at, x.last_write_at, a.role,
                 coalesce(x.last_write_at, x.created_at) as t, ls.id as sid, ls.date as last_date, null::timestamptz as dd
            from mahjong.room_accounts a join mahjong.rooms x on x.id = a.room_id
            left join lateral (select s.id, s.date from mahjong.sessions s
                                where s.room_id = x.id and s.league_id is null and not s.voided
                                order by s.created_at desc, s.id desc limit 1) ls on true
           where a.user_id = v_me and x.deleted_at is null
             and (not v_open or (x.closed_at is null
                                 and (ls.id is null or not exists (select 1 from mahjong.settle_snaps z where z.session_id = ls.id))))
             and not exists (select 1 from mahjong.room_bans b where b.room_id = x.id and b.user_id = v_me)
             and (p_before_at is null or (coalesce(x.last_write_at, x.created_at), x.id) < (p_before_at, p_before_id))
             and not v_del
           order by coalesce(x.last_write_at, x.created_at) desc, x.id desc
           limit p_limit)
          union all
          (select x.id, x.kind, x.name, x.closed_at, x.created_at, x.last_write_at, 'owner'::text,
                 x.deleted_at as t, ls.id as sid, ls.date as last_date, x.deleted_at as dd
            from mahjong.rooms x
            left join lateral (select s.id, s.date from mahjong.sessions s
                                where s.room_id = x.id and s.league_id is null and not s.voided
                                order by s.created_at desc, s.id desc limit 1) ls on true
           where v_del and x.owner_user_id = v_me
             and x.deleted_at is not null and x.deleted_at >= pg_catalog.now() - interval '7 days'
             and (p_before_at is null or (x.deleted_at, x.id) < (p_before_at, p_before_id))
           order by x.deleted_at desc, x.id desc
           limit p_limit)) q
    left join lateral (select coalesce(t.chain_head, t.id) as h from mahjong.tables t
                        where t.session_id = q.sid
                        order by (case when not t.voided
                                         and not exists (select 1 from mahjong.tables y where y.next_table_id = t.id) then 0 else 1 end),
                                 t.created_at, t.id
                        limit 1) ft on true
    -- 鎖の半荘は1回だけ読む（hn＝全部・nv＝voided でない）。人は group by でまとめる（count(distinct) の並べ替えより速い・答えは同じ）。
    left join lateral (select pg_catalog.count(*) as hn, pg_catalog.count(*) filter (where not k.voided) as nv
                         from mahjong.hanchans k
                        where k.table_id in (select x.id from mahjong.tables x where x.session_id = q.sid and (x.id = ft.h or x.chain_head = ft.h))) c1 on ft.h is not null
    left join lateral (select c1.hn, case when c1.nv > 0
                                          then (select pg_catalog.count(*) from (select e.value from mahjong.hanchans k
                                                                                   cross join lateral pg_catalog.jsonb_each_text(k.seats) e
                                                                                  where k.table_id in (select x.id from mahjong.tables x where x.session_id = q.sid and (x.id = ft.h or x.chain_head = ft.h))
                                                                                    and not k.voided and e.value <> ''
                                                                                  group by e.value) g)
                                          else (select pg_catalog.count(*) from (select e.value
                                                  from (select x.seats from mahjong.tables x
                                                         where x.session_id = q.sid and (x.id = ft.h or x.chain_head = ft.h)
                                                         order by x.chain_no desc, x.created_at desc, x.id desc limit 1) lt
                                                  cross join lateral pg_catalog.jsonb_array_elements_text(lt.seats) e
                                                 where e.value <> '' group by e.value) g) end as mn) c on ft.h is not null;
  return pg_catalog.jsonb_build_object('ok', true, 'rooms', v_rooms);
end $fn$;
revoke all on function public.mj_my_rooms(timestamptz, uuid, int, boolean, boolean) from public, anon, authenticated;
grant execute on function public.mj_my_rooms(timestamptz, uuid, int, boolean, boolean) to authenticated;

-- ── A14 §3：覚えたルールを読む＝{ok:true, rules:{"3": obj|null, "4": obj|null}, last: 3|4|null（updated_at が新しい方・同じなら 4）}（本人の行だけ・中身は確かめ直さない＝画面が既定に戻して帯）──
--   mj_me_read（押さえない）・session 無しは mj_session・読むだけ（数えない）
create or replace function public.mj_my_rules()
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_me uuid;
begin
  v_me := mahjong_private.mj_me_read();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'rules', pg_catalog.jsonb_build_object(
    '3', (select a.rules from mahjong.account_rules a where a.user_id = v_me and a.players = 3),
    '4', (select a.rules from mahjong.account_rules a where a.user_id = v_me and a.players = 4)),
    'last', (select a.players from mahjong.account_rules a where a.user_id = v_me order by a.updated_at desc, a.players desc limit 1));
end $fn$;
revoke all on function public.mj_my_rules() from public, anon, authenticated;
grant execute on function public.mj_my_rules() to authenticated;

-- ══ 段2c-1：書く入口 public.mj_write（案 mahjong_tataki_2026-11-20/write_sekkei.md v5.2）══════════════
-- op は28個（member_add・session_add・table_add・hanchan_start・hanchan_order・cell_set・tobi_set・
--   kyotaku_set・extra_add・settle_snap・hanchan_void・hanchan_unvoid＋2c-2a2 の直す op＝member_rename・member_active・
--   session_edit・table_edit・hanchan_seats・extra_set）＋2c-2b の人の op 5個（member_link・member_unlink・member_relink・role_set・account_remove）
--   ＋2c-2c の部屋の op 4個（room_leave・room_delete・room_undelete・room_secret＝組の中で1つだけ）＋段C の room_share・room_close（同じく1つだけ）。
--   残り7個は not_yet（2c-2d 〜）。2c-2c から K-3 の段1（持ち主のアカウントが消えていたら居る人の呼びで継ぐ）が全部の op に効く。2c-2b から役の門（mj_ops.who_plain）と入り直しの門（mj_ops.re・jwt の amr 10分）が全部の op に効く。
-- ★2c-2（履歴のたたみ・op_results の掃除・room_secret・リーグの L）が済むまで本番の倉庫へ出さない★
-- 段：⓪ 人 → ① 形（行を読まない）→ ② 部屋（rooms を for no key update で押さえる）→ ③ op_id → ④ 先見
--   → ⑤ 塊（副取引＝op・組の終わりの出し直し・上限・数え・履歴・後見・op_results）→ ⑥ 数え（塊の外・limits は一番最後）
-- 押さえる順＝accounts（mj_me）→ rooms → 子の表（塊）→ limits（設計図 284 の「limits → その他」の逆＝mj_write の行）。
-- 弾きは SQLSTATE 'MJ001'（message＝返しの jsonb）・一時の失敗（40P01・55P03・40001）は busy・それ以外は internal。

-- ── 表の直し（§1）──
-- 飛び賞は半荘の行に持つ：{"席の字": 受け取り（他の席の番号か "all"）}・鍵が無い＝受け取りがまだ（null は入れない）
alter table mahjong.hanchans add column if not exists tobi_to jsonb not null default '{}'::jsonb;
alter table mahjong.hanchans add column if not exists tobi_version int not null default 1;
alter table mahjong.hanchans drop constraint if exists hanchans_tobi_version_ok;
alter table mahjong.hanchans add constraint hanchans_tobi_version_ok check (tobi_version >= 1);
-- （旧）やきとり（2c-3c・write3_sekkei.md §4）＝席の番号の並び（昇順・重なり無し・0〜players−1＝細かい形は op yakitori_set で見る）・[]＝なし（未入力の印は持たない＝v1.1 S2・司さん「やきとりない時もある」）
--   ★席で持つ★（tobi_to・cells と同じ＝hanchan_seats で人を直しても印は席に残る）
-- 2c-3c'（write6_yaki_sadame.md v1.1 止め2）：やきとりは extras の種 'yaki' へ移した＝半荘の列 yakitori・yakitori_version を落とす
--   ★列が在る時だけ数える★（落とした後の2回目の当てでも落ちない）・印のある半荘が1本でも在れば止める（黙って消さない・計算の止め5）
--   順＝check 2つ → 列 2つ → 関数 mj_yaki_ok（check が呼ぶので最後・下の drop function）
do $yk$
declare v_n bigint;
begin
  if exists (select 1 from information_schema.columns c
             where c.table_schema = 'mahjong' and c.table_name = 'hanchans' and c.column_name = 'yakitori') then
    lock table mahjong.hanchans in share mode;
    execute 'select pg_catalog.count(*) from mahjong.hanchans where yakitori <> ''[]''::jsonb' into v_n;
    if v_n <> 0 then
      raise exception 'mj_schema: やきとりの印のある半荘が % 本在る（2c-3c'' で列を落とす前に始末を決める）', v_n;
    end if;
    alter table mahjong.hanchans drop constraint if exists hanchans_yakitori_ok;
    alter table mahjong.hanchans drop constraint if exists hanchans_yakitori_version_ok;
    alter table mahjong.hanchans drop column if exists yakitori;
    alter table mahjong.hanchans drop column if exists yakitori_version;
  end if;
end $yk$;
-- 席の版（段2c-2a2・hanchan_seats が +1・倉庫の中だけ＝客は base_version を送らない・kyotaku_set の version とは別）
alter table mahjong.hanchans add column if not exists seats_version int not null default 1;
alter table mahjong.hanchans drop constraint if exists hanchans_seats_version_ok;
alter table mahjong.hanchans add constraint hanchans_seats_version_ok check (seats_version >= 1);
-- A13 §6（a13g_sadame v3.2）：order_cells＝ton_order を書いた人が見た点（席の番号順）。null＝この直しの前の行か ton_order が null（古い画面は本当の席順＝覆う）
alter table mahjong.hanchans add column if not exists order_cells int[];
alter table mahjong.hanchans drop constraint if exists hanchans_order_cells_ok;
alter table mahjong.hanchans add constraint hanchans_order_cells_ok check (order_cells is null
  or (ton_order is not null and pg_catalog.array_ndims(order_cells) = 1 and pg_catalog.cardinality(order_cells) = players and pg_catalog.array_position(order_cells, null) is null));
-- 卓の席（B1・b1_sadame_v2.md v2.1）＝0回目から ± を打てる人の門と画面の名前の列だけに効く（お金の判じは変えない）
--   seats＝member_id（小文字の字）の配列・長さ 0 か players／seats_version は倉庫の中だけ（客は base_version を送らない）
alter table mahjong.tables add column if not exists seats jsonb not null default '[]'::jsonb;
alter table mahjong.tables add column if not exists seats_version int not null default 1;
alter table mahjong.tables drop constraint if exists tables_seats_ok;
alter table mahjong.tables add constraint tables_seats_ok check (jsonb_typeof(seats) = 'array' and jsonb_array_length(seats) in (0, players));
alter table mahjong.tables drop constraint if exists tables_seats_version_ok;
alter table mahjong.tables add constraint tables_seats_version_ok check (seats_version >= 1);
-- チップ・祝儀は種ごとの state（unused＝ルールで使わない）。extra_state は「使う種が全部 ok なら ok・どれか ng なら ng」
alter table mahjong.tables add column if not exists chip_state text not null default 'unused';
alter table mahjong.tables add column if not exists shugi_state text not null default 'unused';
alter table mahjong.tables drop constraint if exists tables_chip_state_ok;
alter table mahjong.tables add constraint tables_chip_state_ok check (chip_state in ('ok', 'ng', 'unused'));
alter table mahjong.tables drop constraint if exists tables_shugi_state_ok;
alter table mahjong.tables add constraint tables_shugi_state_ok check (shugi_state in ('ok', 'ng', 'unused'));
-- 卓の「一度そろった」と、そろった後に変えた印（段2c-2a1・hanchans と同じ形＝設計図:139「卓は tables の同じ列」）
--   first_complete_at＝使う種が全部 合計0 かつ使う種に0でない行が在る時に入る（後で ng に戻っても消さない）
--   changed_after_complete_at＝最後に変わった時（消さない・帯は画面が最新の締めの made_at と比べる＝別件 D）
alter table mahjong.tables add column if not exists first_complete_at timestamptz;
alter table mahjong.tables add column if not exists changed_after_complete_at timestamptz;
alter table mahjong.tables add column if not exists changed_by_user uuid;
-- C4（c4_sadame.md v3.3）途中でルールを変える＝卓を区切って続きの卓を作る。next_table_id＝続きの卓（1つの卓の続きは1つだけ）・
--   split_same＝区切りの前後で「枚の値に効く鍵」が同じだったか（true＝枚を続きの卓へ移した・extra_add は続きへ運ぶ／false＝前の卓に残した・extra_add は bad）
alter table mahjong.tables add column if not exists next_table_id uuid references mahjong.tables(id) on delete set null;
alter table mahjong.tables add column if not exists split_same boolean;
create unique index if not exists tables_next_one on mahjong.tables(next_table_id) where next_table_id is not null;
-- P8（p8_sadame v4 §1-1）卓に鎖の印＝chain_head（鎖の頭の卓・null＝自分が頭）・chain_no（頭から何段目・頭は0）。
--   鎖は索引1本で引く（段ごとにたどらない＝段の数の切りも輪も無い）。書くのは table_rules の続きの卓の insert だけ。FK は付けない（insert の鍵と tfollow の押さえがぶつかる種）
alter table mahjong.tables add column if not exists chain_head uuid;
alter table mahjong.tables add column if not exists chain_no int not null default 0;
create index if not exists tables_chain on mahjong.tables(chain_head, chain_no) where chain_head is not null;
create index if not exists tables_chain_diff on mahjong.tables(chain_head, chain_no) where next_table_id is not null and split_same is not true;
-- 当て直しで今の行を next の鎖から埋める（冪等＝同じなら書かない）
with recursive c(id, head, no) as (
  select t.id, t.id, 0 from mahjong.tables t where not exists (select 1 from mahjong.tables p where p.next_table_id = t.id)
  union all
  select x.next_table_id, c.head, c.no + 1 from c join mahjong.tables x on x.id = c.id where x.next_table_id is not null
) cycle id set lp using pth
update mahjong.tables t set chain_head = case when c.no = 0 then null else c.head end, chain_no = c.no
  from c where t.id = c.id and not c.lp
   and (t.chain_head is distinct from (case when c.no = 0 then null else c.head end) or t.chain_no <> c.no);
-- 表 mahjong.tobi は使わない（書く関数が無い・飛び賞は hanchans.tobi_to）。2c-2 で行0を数えてから消す
--   （その時 tests/db-checks.live.mjs:66-67・tests/sweep.live.mjs:79・mj_sweep の tobi の数えも一緒に直す）。

-- 飛び賞の形（CHECK と mj_write が同じ物を呼ぶ）：object・鍵は '0'〜players−1・値は鍵と違う 0〜players−1 の整数か "all"
--   E1（e_sadame v2 §E1-6）：新しい形 {"r":[席…]}＝鍵は r だけ・値は 0〜players−1 の整数の配列・小さい順・同じ席は1回（[] も可）＝押した人がもらう
--   古い鍵の形（テスト線だけ）もそのまま通す（lib は押していないと読む）
create or replace function mahjong_private.mj_tobi_ok(p jsonb, p_players smallint) returns boolean
language plpgsql immutable set search_path = '' as $fn$
declare
  e record; k int; x numeric; v_prev int;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then return false; end if;
  if p_players is null or p_players not in (3, 4) then return false; end if;
  if p ? 'r' then
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p)) <> 1 then return false; end if;
    if pg_catalog.jsonb_typeof(p -> 'r') <> 'array' then return false; end if;
    v_prev := -1;
    for e in select t.value from pg_catalog.jsonb_array_elements(p -> 'r') with ordinality t(value, n) order by t.n loop
      if pg_catalog.jsonb_typeof(e.value) <> 'number' then return false; end if;
      x := e.value::numeric;
      if x % 1 <> 0 or x < 0 or x >= p_players or x <= v_prev then return false; end if;
      v_prev := x::int;
    end loop;
    return true;
  end if;
  for e in select t.key, t.value from pg_catalog.jsonb_each(p) t loop
    if e.key !~ '^[0-3]$' then return false; end if;
    k := e.key::int;
    if k >= p_players then return false; end if;
    if e.value = '"all"'::jsonb then continue; end if;
    if pg_catalog.jsonb_typeof(e.value) <> 'number' then return false; end if;
    x := e.value::numeric;
    if x % 1 <> 0 or x < 0 or x >= p_players or x = k then return false; end if;
  end loop;
  return true;
end $fn$;
revoke all on function mahjong_private.mj_tobi_ok(jsonb, smallint) from public, anon, authenticated;
-- やきとりの席の並びの確かめ mj_yaki_ok（2c-3c）は 2c-3c' で外した（列と check は上の $yk$ で落とした後）
drop function if exists mahjong_private.mj_yaki_ok(jsonb, smallint);
alter table mahjong.hanchans drop constraint if exists hanchans_tobi_ok;
alter table mahjong.hanchans add constraint hanchans_tobi_ok check (mahjong_private.mj_tobi_ok(tobi_to, players));

-- ── 下請け（全部 mahjong_private・客は呼べない） ──
-- 弾く（返しの jsonb を message に入れて MJ001 を投げる＝塊ごと戻り、外で値に直す）
create or replace function mahjong_private.mj_w_err(p jsonb) returns void
language plpgsql set search_path = '' as $fn$
begin
  raise exception using errcode = 'MJ001', message = p::text;
end $fn$;
revoke all on function mahjong_private.mj_w_err(jsonb) from public, anon, authenticated;

create or replace function mahjong_private.mj_w_bad(p_i int, p_at text, p_err text default 'bad') returns void
language plpgsql set search_path = '' as $fn$
begin
  perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', p_err, 'i', p_i, 'at', p_at));
end $fn$;
revoke all on function mahjong_private.mj_w_bad(int, text, text) from public, anon, authenticated;

-- 引数の uuid（字で uuid の形でなければ bad）
create or replace function mahjong_private.mj_w_uuid(a jsonb, k text, p_i int) returns uuid
language plpgsql set search_path = '' as $fn$
begin
  if pg_catalog.jsonb_typeof(a -> k) is distinct from 'string'
     or (a ->> k) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform mahjong_private.mj_w_bad(p_i, k);
  end if;
  return (a ->> k)::uuid;
end $fn$;
revoke all on function mahjong_private.mj_w_uuid(jsonb, text, int) from public, anon, authenticated;

-- 引数の整数（数で整数で ±2,000,000,000 の内でなければ bad）
create or replace function mahjong_private.mj_w_int(a jsonb, k text, p_i int) returns int
language plpgsql set search_path = '' as $fn$
declare x numeric;
begin
  if pg_catalog.jsonb_typeof(a -> k) is distinct from 'number' then perform mahjong_private.mj_w_bad(p_i, k); end if;
  x := (a -> k)::numeric;
  if x % 1 <> 0 or x < -2000000000 or x > 2000000000 then perform mahjong_private.mj_w_bad(p_i, k); end if;
  return x::int;
end $fn$;
revoke all on function mahjong_private.mj_w_int(jsonb, text, int) from public, anon, authenticated;

-- 履歴の1行（変えた値ごと）
create or replace function mahjong_private.mj_w_hist(p_room uuid, p_gid uuid, p_op text, p_me uuid, p_role text,
  p_tbl text, p_key jsonb, p_col text, p_before jsonb, p_after jsonb, p_ver int) returns void
language plpgsql set search_path = '' as $fn$
begin
  insert into mahjong.history (room_id, group_id, op, tbl, row_key, col, before_value, after_value, after_version, actor_user_id, actor_role)
  values (p_room, p_gid, p_op, p_tbl, p_key, p_col, p_before, p_after, p_ver, p_me, p_role);
end $fn$;
revoke all on function mahjong_private.mj_w_hist(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, jsonb, int) from public, anon, authenticated;

-- H1'（h1b_sadame v1・11-23 司さん「履歴に上限作るな」）＝履歴に上限もたたみも置かない＝前に当てた mj_w_fold を消す
drop function if exists mahjong_private.mj_w_fold(uuid, uuid);

-- 卓を引いて押さえる（違う部屋・無い → bad）＋役（2c-2d1＝開催日のリーグで mj_w_role・取り消したリーグの日は bad at league）
--   ★前の3つの引数の版は落とす（残すと役を見ない道が残る）★
drop function if exists mahjong_private.mj_w_t(uuid, uuid, int);
create or replace function mahjong_private.mj_w_t(p_room uuid, p_tid uuid, p_i int, p_op text, p_me uuid, p_role text) returns mahjong.tables
language plpgsql set search_path = '' as $fn$
declare t mahjong.tables; v_l uuid;
begin
  select x.* into t from mahjong.tables x where x.id = p_tid and x.room_id = p_room for update;
  if not found then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
  select s.league_id into v_l from mahjong.sessions s where s.id = t.session_id;
  perform mahjong_private.mj_w_role(p_room, p_op, v_l, null, p_me, p_role, p_i);
  return t;
end $fn$;
revoke all on function mahjong_private.mj_w_t(uuid, uuid, int, text, uuid, text) from public, anon, authenticated;

-- C4 §3（v3.3 U1・T3）新しく作る書き（hanchan_start・extra_add）の卓＝区切られていれば鎖の最後へ運ぶ。
--   follow は無いか真偽（他は bad at follow）。区切られた卓で follow:true でなければ bad at table_id（古い版を止める）。
--   extra_add は鍵が違う区切り（split_same が true でない）を1つでも通れば bad at table_id。
--   卓は mj_w_t が for update で押さえた後の行の next_table_id を読む＝同時の table_rules と取り違えない
create or replace function mahjong_private.mj_w_tfollow(p_room uuid, p_tid uuid, p_i int, p_op text, p_me uuid, p_role text, p_o jsonb) returns mahjong.tables
language plpgsql set search_path = '' as $fn$
declare t mahjong.tables; s mahjong.tables; v_h uuid; v_l uuid;
begin
  -- P8 v4 §1-3 a：今の頭をそのまま（役の確かめ→follow の型→next が無ければ返す→区切られた卓で follow:true でなければ bad）
  t := mahjong_private.mj_w_t(p_room, p_tid, p_i, p_op, p_me, p_role);
  if p_o ? 'follow' and pg_catalog.jsonb_typeof(p_o -> 'follow') <> 'boolean' then perform mahjong_private.mj_w_bad(p_i, 'follow'); end if;
  if t.next_table_id is null then return t; end if;
  -- A20 §6：follow:false と書いた hanchan_start だけ、区切られた卓にそのまま入れる（押した時に見えていた卓のルール・人数）。鍵が無い・他の op は今まで通り
  --   入れるのは S だが、最後の卓 L も follow:true と同じ順（S→L）で押さえる＝E2 §5 の open／new の門が同時の hanchan_start と並ぶ
  if not (p_op = 'hanchan_start' and (p_o -> 'follow') is not distinct from 'false'::jsonb) and (p_o -> 'follow') is distinct from 'true'::jsonb then
    perform mahjong_private.mj_w_bad(p_i, 'table_id');
  end if;
  s := t;
  v_h := coalesce(s.chain_head, s.id);
  -- b：最後の卓（鎖の印で1行）を押さえる。押さえた後に next が在る間（同時の区切り）は続きへ進んで押さえ直す
  select x.id into v_l from mahjong.tables x where (x.id = v_h or x.chain_head = v_h) order by x.chain_no desc limit 1;
  t := mahjong_private.mj_w_t(p_room, v_l, p_i, p_op, p_me, p_role);
  while t.next_table_id is not null loop
    t := mahjong_private.mj_w_t(p_room, t.next_table_id, p_i, p_op, p_me, p_role);
  end loop;
  -- 埋め漏れの守り（通さない側）：S と違う最後なのに段が S より大きくない＝印が壊れている
  if t.id <> s.id and t.chain_no <= s.chain_no then raise exception 'mj_write: 卓の鎖の印が壊れている'; end if;
  if p_op = 'hanchan_start' and (p_o -> 'follow') is not distinct from 'false'::jsonb then return s; end if;   -- A20 §6：L は押さえた・入れるのは押した時の卓
  -- c：鍵違いは鎖が止まった後に見る（L を押さえた＝S〜L の間の next・split_same はもう変わらない）
  if p_op = 'extra_add' and exists (select 1 from mahjong.tables x where (x.id = v_h or x.chain_head = v_h)
       and x.chain_no >= s.chain_no and x.chain_no < t.chain_no and x.next_table_id is not null and x.split_same is not true) then
    perform mahjong_private.mj_w_bad(p_i, 'table_id');
  end if;
  return t;
end $fn$;
revoke all on function mahjong_private.mj_w_tfollow(uuid, uuid, int, text, uuid, text, jsonb) from public, anon, authenticated;

-- C4 §3a 卓の鎖（next_table_id でつながる卓の全部・頭から順）＝区切っていない卓は自分1つ
create or replace function mahjong_private.mj_w_chain(p_tid uuid) returns uuid[]
language sql stable set search_path = '' as $fn$
  -- P8 v4 §1-2：鎖の印で引く（頭は PK・残りは索引 tables_chain）＝たどらない。卓が無い時は今と同じ [p_tid]
  select coalesce((select pg_catalog.array_agg(x.id order by x.chain_no) from mahjong.tables x
                    where x.id = h.h or x.chain_head = h.h), array[p_tid])
    from (select coalesce((select coalesce(y.chain_head, y.id) from mahjong.tables y where y.id = p_tid), p_tid) as h) h
$fn$;
revoke all on function mahjong_private.mj_w_chain(uuid) from public, anon, authenticated;

-- 半荘を引いて押さえる（同じ決め）
drop function if exists mahjong_private.mj_w_h(uuid, uuid, int);
create or replace function mahjong_private.mj_w_h(p_room uuid, p_hid uuid, p_i int, p_op text, p_me uuid, p_role text) returns mahjong.hanchans
language plpgsql set search_path = '' as $fn$
declare h mahjong.hanchans; v_l uuid;
begin
  select x.* into h from mahjong.hanchans x where x.id = p_hid and x.room_id = p_room for update;
  if not found then perform mahjong_private.mj_w_bad(p_i, 'hanchan_id'); end if;
  select s.league_id into v_l from mahjong.tables t join mahjong.sessions s on s.id = t.session_id where t.id = h.table_id;
  perform mahjong_private.mj_w_role(p_room, p_op, v_l, null, p_me, p_role, p_i);
  return h;
end $fn$;
revoke all on function mahjong_private.mj_w_h(uuid, uuid, int, text, uuid, text) from public, anon, authenticated;

-- 席の並び（member_id の配列）を確かめる：長さ n・部屋の active な人・重なり無し（seats と比べる時は p_set）
create or replace function mahjong_private.mj_w_people(p_room uuid, a jsonb, p_n int, p_i int, p_at text, p_set jsonb default null) returns jsonb
language plpgsql set search_path = '' as $fn$
declare e jsonb; k int;
begin
  if pg_catalog.jsonb_typeof(a) is distinct from 'array' or pg_catalog.jsonb_array_length(a) <> p_n then
    perform mahjong_private.mj_w_bad(p_i, p_at);
  end if;
  for k in 0 .. p_n - 1 loop
    e := a -> k;
    if pg_catalog.jsonb_typeof(e) <> 'string'
       or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform mahjong_private.mj_w_bad(p_i, p_at);
    end if;
  end loop;
  if (select pg_catalog.count(distinct (t.v #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(a) t(v)) <> p_n then
    perform mahjong_private.mj_w_bad(p_i, p_at);
  end if;
  if p_set is null then
    if (select pg_catalog.count(*) from mahjong.members m
         where m.room_id = p_room and m.active and m.id in (select (t.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(a) t(v))) <> p_n then
      perform mahjong_private.mj_w_bad(p_i, p_at);
    end if;
  elsif (select pg_catalog.array_agg((t.v #>> '{}')::uuid order by (t.v #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(a) t(v))
        is distinct from (select pg_catalog.array_agg(t.v::uuid order by t.v::uuid) from pg_catalog.jsonb_each_text(p_set) t(k, v)) then
    perform mahjong_private.mj_w_bad(p_i, p_at);
  end if;
  return (select pg_catalog.jsonb_agg(pg_catalog.lower(t.v #>> '{}') order by t.o) from pg_catalog.jsonb_array_elements(a) with ordinality t(v, o));
end $fn$;
revoke all on function mahjong_private.mj_w_people(uuid, jsonb, int, int, text, jsonb) from public, anon, authenticated;

-- A13 §6：op の seen_cells（保存した人が見た点）の形＝長さ p_n・どれも正しい点（整数・±2000000000・100の倍数）＝壊れていれば bad（at seen_cells）
create or replace function mahjong_private.mj_w_seen_cells(a jsonb, p_n int, p_i int) returns int[]
language plpgsql set search_path = '' as $fn$
declare k int; v numeric; r int[] := '{}';
begin
  if pg_catalog.jsonb_typeof(a) is distinct from 'array' or pg_catalog.jsonb_array_length(a) <> p_n then
    perform mahjong_private.mj_w_bad(p_i, 'seen_cells');
  end if;
  for k in 0 .. p_n - 1 loop
    if pg_catalog.jsonb_typeof(a -> k) <> 'number' then perform mahjong_private.mj_w_bad(p_i, 'seen_cells'); end if;
    v := (a -> k)::numeric;
    if v % 1 <> 0 or v not between -2000000000 and 2000000000 or v % 100 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'seen_cells'); end if;
    r := r || v::int;
  end loop;
  return r;
end $fn$;
revoke all on function mahjong_private.mj_w_seen_cells(jsonb, int, int) from public, anon, authenticated;

-- 飛んだ席（ルールの tobi が true で tobi_from が 'all' でない時だけ・0未満、tobi_zero なら0以下）＝lib の tobiPt と同じ判じ
create or replace function mahjong_private.mj_w_busted(p_hid uuid) returns jsonb
language plpgsql set search_path = '' as $fn$
declare rs jsonb;
begin
  select h.rules_snapshot into rs from mahjong.hanchans h where h.id = p_hid;
  if rs is null or rs -> 'tobi' is distinct from 'true'::jsonb or rs -> 'tobi_from' = '"all"'::jsonb then return '[]'::jsonb; end if;
  return coalesce((select pg_catalog.jsonb_agg(c.seat order by c.seat) from mahjong.cells c
                    where c.hanchan_id = p_hid and (c.value < 0 or (rs -> 'tobi_zero' = 'true'::jsonb and c.value = 0))), '[]'::jsonb);
end $fn$;
revoke all on function mahjong_private.mj_w_busted(uuid) from public, anon, authenticated;

-- 組の初めに飛んでいなかった席が今飛んでいて鍵が在れば消す（この組に同じ半荘の tobi_set・hanchan_start が無い時だけ呼ぶ）
create or replace function mahjong_private.mj_w_tobi_fix(p_room uuid, p_gid uuid, p_me uuid, p_role text, p_hid uuid, p_b0 jsonb) returns int
language plpgsql set search_path = '' as $fn$
declare h mahjong.hanchans; v_new jsonb; s jsonb;
begin
  select x.* into h from mahjong.hanchans x where x.id = p_hid for update;
  if not found then return 0; end if;
  if h.voided then return 0; end if;
  if h.tobi_to ? 'r' then return 0; end if;  -- E1 §E1-6：押した人の形は点を直しても変えない
  v_new := h.tobi_to;
  for s in select t.v from pg_catalog.jsonb_array_elements(mahjong_private.mj_w_busted(p_hid)) t(v) loop
    if not (coalesce(p_b0, '[]'::jsonb) @> pg_catalog.jsonb_build_array(s)) and v_new ? (s::text) then
      v_new := v_new - (s::text);
    end if;
  end loop;
  if v_new = h.tobi_to then return 0; end if;
  update mahjong.hanchans x set tobi_to = v_new, tobi_version = x.tobi_version + 1 where x.id = p_hid;
  perform mahjong_private.mj_w_hist(p_room, p_gid, 'tobi_auto', p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', p_hid),
    'tobi_to', h.tobi_to, v_new, h.tobi_version + 1);
  return 1;
end $fn$;
revoke all on function mahjong_private.mj_w_tobi_fix(uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- 半荘の「そろった」（取り消していない半荘）＝lib と同じ順：① cells ② 合計 ③ 順 ④ 飛び賞
create or replace function mahjong_private.mj_w_hstate(p_hid uuid) returns void
language plpgsql set search_path = '' as $fn$
declare h mahjong.hanchans; rs jsonb; v_cells jsonb; v_cnt int; v_sum bigint; v_st text; v_why text;
begin
  select x.* into h from mahjong.hanchans x where x.id = p_hid for update;
  if not found then return; end if;
  if h.voided then return; end if;
  rs := h.rules_snapshot;
  select pg_catalog.jsonb_agg(c.value order by c.seat), pg_catalog.count(*), coalesce(pg_catalog.sum(c.value), 0)
    into v_cells, v_cnt, v_sum from mahjong.cells c where c.hanchan_id = p_hid;
  if v_cnt < h.players then
    v_st := 'input'; v_why := 'cells';
  elsif pg_catalog.jsonb_typeof(rs -> 'start_pts') is distinct from 'number'
        or v_sum <> (rs -> 'start_pts')::numeric * h.players - h.lost_kyotaku then
    v_st := 'ng'; v_why := 'sum';
  -- A13 §6：保存した人が見ていない同点（2台が別の点を直して出来た組）は覆わない＝順がまだ（lib hanchanView と同じ orderCovered）
  elsif mahjong_private.mj_needs_order(rs, v_cells) ? 'tie' and not mahjong_private.mj_order_covered(rs, v_cells, h.ton_order, h.order_cells) then
    v_st := 'input'; v_why := 'order';
  -- B2 段1（tobi_chip_v3.md）：④ 飛び賞の受け取りを待つ（why 'tobi'）は外した＝飛び賞は extras の種 'tobi'（チップと同じ ±）
  --   mj_w_busted・mj_w_tobi_fix・op tobi_set・列 tobi_to は写しの鍵消しと対なので今のまま（段3 で決める）
  else
    v_st := 'ok'; v_why := null;
  end if;
  update mahjong.hanchans x set state = v_st, state_reason = v_why,
    first_complete_at = case when v_st = 'ok' and x.first_complete_at is null then pg_catalog.now() else x.first_complete_at end
   where x.id = p_hid
     and (x.state is distinct from v_st or x.state_reason is distinct from v_why or (v_st = 'ok' and x.first_complete_at is null));
end $fn$;
revoke all on function mahjong_private.mj_w_hstate(uuid) from public, anon, authenticated;
-- 2c-3c'（定め v1.1 任意4）：順の理由 yaki は外した＝前の当てで state_reason yaki の半荘を今の決まりで出し直す（0本なら何もしない・2回目の当てでも同じ）
do $yr$
declare r record;
begin
  for r in select x.id from mahjong.hanchans x where x.state_reason in ('yaki', 'tobi') loop  -- B2 段1：④を外した＝why 'tobi' の半荘も出し直す
    perform mahjong_private.mj_w_hstate(r.id);
  end loop;
end $yr$;

-- やきとりを使う卓か（2c-3c'・write6_yaki_sadame.md v1.1 止め1）＝ルールの yakitori が JSON の true かつ yakitori_pt が1以上の整数
--   ★pt 0 は使わない種★（chip_pt10 が null と同じ＝黙って0円の行を作らない）・lib の yakiUsed と同じ条件（計算 aba53ce）
create or replace function mahjong_private.mj_w_yaki_used(p_rules jsonb) returns boolean
language sql immutable set search_path = '' as $fn$
  select coalesce(p_rules -> 'yakitori' = 'true'::jsonb, false)
     and coalesce(pg_catalog.jsonb_typeof(p_rules -> 'yakitori_pt') = 'number', false)
     and case when pg_catalog.jsonb_typeof(p_rules -> 'yakitori_pt') = 'number'
              then ((p_rules -> 'yakitori_pt')::numeric) % 1 = 0 and ((p_rules -> 'yakitori_pt')::numeric) >= 1 else false end
$fn$;
revoke all on function mahjong_private.mj_w_yaki_used(jsonb) from public, anon, authenticated;

-- 飛び賞を使う卓か（B2 段1・tobi_chip_v3.md）＝ルールの tobi が JSON の true かつ tobi_pt が1以上の整数（lib の tobiUsed と同じ・pt 0 は使わない種）
create or replace function mahjong_private.mj_w_tobi_used(p_rules jsonb) returns boolean
language sql immutable set search_path = '' as $fn$
  select coalesce(p_rules -> 'tobi' = 'true'::jsonb, false)
     and coalesce(pg_catalog.jsonb_typeof(p_rules -> 'tobi_pt') = 'number', false)
     and case when pg_catalog.jsonb_typeof(p_rules -> 'tobi_pt') = 'number'
              then ((p_rules -> 'tobi_pt')::numeric) % 1 = 0 and ((p_rules -> 'tobi_pt')::numeric) >= 1 else false end
$fn$;
revoke all on function mahjong_private.mj_w_tobi_used(jsonb) from public, anon, authenticated;

-- 種の確かめ（2c-3b・write3_sekkei.md §3）：卓のルール p_rules で種 p_kind を見て 'sum0'（合計0の種）／'out'（外へ払う種）／null（弾く）
--   'yaki'（2c-3c'）＝mj_w_yaki_used が true の時だけ 'sum0'・でなければ null
--   'chip'・'shugi'＝*_pt10 が JSON の null なら null（使わない種）・でなければ 'sum0'（鍵が無いのも使う側＝倉庫だけの守り・今まで通り）
--   'c:<id>'＝tane_custom が配列で id が一致する物が在る時だけ（★pt10 の鍵の在りで判じない★）・sum0 false＝'out'／それ以外＝'sum0'
--   それ以外（字でない・形が違う・無い id）＝null
create or replace function mahjong_private.mj_w_kind(p_rules jsonb, p_kind jsonb) returns text
language plpgsql immutable set search_path = '' as $fn$
declare v_k text; v_t jsonb;
begin
  if p_kind is null or pg_catalog.jsonb_typeof(p_kind) <> 'string' then return null; end if;
  v_k := p_kind #>> '{}';
  if v_k in ('chip', 'shugi') then
    if p_rules -> (v_k || '_pt10') = 'null'::jsonb then return null; end if;
    return 'sum0';
  end if;
  if v_k = 'yaki' then
    return case when mahjong_private.mj_w_yaki_used(p_rules) then 'sum0' end;
  end if;
  if v_k = 'tobi' then  -- B2 段1
    return case when mahjong_private.mj_w_tobi_used(p_rules) then 'sum0' end;
  end if;
  if v_k !~ '^c:[a-z0-9]{1,8}$' or pg_catalog.jsonb_typeof(p_rules -> 'tane_custom') is distinct from 'array' then return null; end if;
  select q.e into v_t from pg_catalog.jsonb_array_elements(p_rules -> 'tane_custom') q(e)
   where q.e ->> 'id' = pg_catalog.substr(v_k, 3) limit 1;
  if v_t is null then return null; end if;
  return case when v_t -> 'sum0' = 'false'::jsonb then 'out' else 'sum0' end;
end $fn$;
revoke all on function mahjong_private.mj_w_kind(jsonb, jsonb) from public, anon, authenticated;

-- 卓のチップ・祝儀・自由な項目（種ごと）：使う＝ルールの *_pt10 が JSON の null でない（鍵が無い・数でない値も使う側＝倉庫だけの守り）
--   使う種は extras のその種の合計が0なら ok・でなければ ng（行が無い＝0）。extra_state＝使う種が全部 ok なら ok
--   自由な項目（2c-3b）：合計0の種（sum0 true）はその種の合計が0でなければ ng・extra_reason＝tane_custom の並びの順の最初の 'c:<id>'
--     （chip・shugi の ng は今まで通り reason null）・外へ払う種（sum0 false）は合計を見ない・卓のルールに無い c:<id> の行は数えない
--   やきとり（2c-3c'）：使う卓（mj_w_yaki_used）だけ 'yaki' の合計を見る・ng なら extra_reason は 'yaki' が c:<id> より先
--     使わない卓の 'yaki' の行は数えない（chip の unused と同じ）
create or replace function mahjong_private.mj_w_tstate(p_tid uuid) returns void
language plpgsql set search_path = '' as $fn$
declare rs jsonb; v_c bigint; v_s bigint; v_cs text; v_ss text; v_es text; v_done boolean; v_why text; v_sum0 text[];
begin
  select r.rules into rs from mahjong.tables t join mahjong.rule_sets r on r.id = t.rule_set_id and r.version = t.rule_version
   where t.id = p_tid for update of t;
  if not found then return; end if;
  select coalesce(pg_catalog.sum(e.value) filter (where e.kind = 'chip'), 0), coalesce(pg_catalog.sum(e.value) filter (where e.kind = 'shugi'), 0)
    into v_c, v_s from mahjong.extras e where e.table_id = p_tid;
  v_cs := case when rs -> 'chip_pt10' = 'null'::jsonb then 'unused' when v_c = 0 then 'ok' else 'ng' end;
  v_ss := case when rs -> 'shugi_pt10' = 'null'::jsonb then 'unused' when v_s = 0 then 'ok' else 'ng' end;
  v_sum0 := array(select 'c:' || (q.e ->> 'id') from pg_catalog.jsonb_array_elements(
                     case when pg_catalog.jsonb_typeof(rs -> 'tane_custom') = 'array' then rs -> 'tane_custom' else '[]'::jsonb end) with ordinality q(e, n)
                   where q.e -> 'sum0' is distinct from 'false'::jsonb order by q.n);
  -- 2c-3c'：使うやきとりは合計0の種の先頭（reason の順＝yaki → c:<id>）
  -- E1（e_sadame v2 §E1-7）：飛び賞は半荘の［飛び賞］釦（tobi_to {r}）＝種 'tobi' の行は受けるが数えない（ng にしない・そろったにも入れない）
  if mahjong_private.mj_w_yaki_used(rs) then v_sum0 := array['yaki'] || v_sum0; end if;
  select u.k into v_why from pg_catalog.unnest(v_sum0) with ordinality u(k, n)
   where coalesce((select pg_catalog.sum(e.value) from mahjong.extras e where e.table_id = p_tid and e.kind = u.k), 0) <> 0
   order by u.n limit 1;
  v_es := case when v_cs = 'ng' or v_ss = 'ng' or v_why is not null then 'ng' else 'ok' end;
  -- 一度そろった（2c-2a1）＝ok かつ使う種に0でない行が在る（生まれた卓・入れて戻した卓は行0か全部0＝入らない）
  --   使う種＝使う chip・shugi・合計0の自由な項目（2c-3b）＝★外へ払う種の行だけでは入らない★（場代だけの卓は「そろった」にしない）
  v_done := v_es = 'ok' and exists (select 1 from mahjong.extras e where e.table_id = p_tid and e.value <> 0
    and ((e.kind = 'chip' and v_cs <> 'unused') or (e.kind = 'shugi' and v_ss <> 'unused') or e.kind = any (v_sum0)));
  update mahjong.tables t set chip_state = v_cs, shugi_state = v_ss, extra_state = v_es, extra_reason = v_why,
    first_complete_at = case when v_done and t.first_complete_at is null then pg_catalog.now() else t.first_complete_at end
   where t.id = p_tid and ((t.chip_state, t.shugi_state, t.extra_state, t.extra_reason) is distinct from (v_cs, v_ss, v_es, v_why)
     or (v_done and t.first_complete_at is null));
end $fn$;
revoke all on function mahjong_private.mj_w_tstate(uuid) from public, anon, authenticated;
-- 流し込み（2c-2a1・何回流しても同じ）：既存の卓の state を出し直し、そろっていれば first_complete_at を入れる
do $fl$ begin
  perform mahjong_private.mj_w_tstate(t.id) from mahjong.tables t where t.first_complete_at is null or t.extra_reason = 'tobi';
end $fl$;

-- そろった後に変えた印（ok になった事のある半荘か、前の組で締めた開催日の半荘を変えた時）
--   締めの判じは made_at < now()＝同じ組で書いた締めは外れる（made_at は default now()・紙 v3.2 §7）
create or replace function mahjong_private.mj_w_changed(p_hid uuid, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
begin
  update mahjong.hanchans x set changed_after_complete_at = pg_catalog.now(), changed_by_user = p_me
   where x.id = p_hid and (x.first_complete_at is not null
     or exists (select 1 from mahjong.tables t join mahjong.settle_snaps z on z.session_id = t.session_id
                 where t.id = x.table_id and z.made_at < pg_catalog.now()));
end $fn$;
revoke all on function mahjong_private.mj_w_changed(uuid, uuid) from public, anon, authenticated;

-- 卓の印（2c-2a1）：組の終わりに mj_write が判じて呼ぶ（一度そろったか前の組で締めた卓・正味が変わった行あり）
create or replace function mahjong_private.mj_w_tchanged(p_tid uuid, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
begin
  update mahjong.tables t set changed_after_complete_at = pg_catalog.now(), changed_by_user = p_me where t.id = p_tid;
end $fn$;
revoke all on function mahjong_private.mj_w_tchanged(uuid, uuid) from public, anon, authenticated;

-- 卓の「組の前にそろっていた」f0（2c-2a1）＝first_complete_at か、前の組の締め（made_at < now()＝同じ組の締めは外れる・紙 v3.2 §7）
--   組の終わりの卓の印（mj_write）と、2c-2a2 のレート・取り消しの印が同じ1本を呼ぶ
create or replace function mahjong_private.mj_w_tf0(p_tid uuid) returns boolean
language plpgsql set search_path = '' as $fn$
declare v boolean;
begin
  select x.first_complete_at is not null
      or exists (select 1 from mahjong.settle_snaps z where z.session_id = x.session_id and z.made_at < pg_catalog.now())
    into v from mahjong.tables x where x.id = p_tid;
  return coalesce(v, false);
end $fn$;
revoke all on function mahjong_private.mj_w_tf0(uuid) from public, anon, authenticated;

-- レートを直した印（2c-2a2・卓だけ）：下に取り消していない一度そろった半荘が在るか、卓の f0（レートは半荘の pt もチップ・祝儀も精算を変える）
create or replace function mahjong_private.mj_w_trate(p_tid uuid, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
begin
  if mahjong_private.mj_w_tf0(p_tid)
     or exists (select 1 from mahjong.hanchans x where x.table_id = p_tid and not x.voided and x.first_complete_at is not null) then
    perform mahjong_private.mj_w_tchanged(p_tid, p_me);
  end if;
end $fn$;
revoke all on function mahjong_private.mj_w_trate(uuid, uuid) from public, anon, authenticated;

-- 取り消し（と戻し）の印（2c-2a2・正本 v1510:179-180＝片方の外＝両方）：下の取り消していない半荘ごとに半荘の印（mj_w_changed の判じ）
--   ＋卓の f0 が在れば卓にも（精算は半荘の state を見ずにそろった卓のチップを足す＝半荘の印だけだとチップの消えが抜ける）
create or replace function mahjong_private.mj_w_tvoid(p_tid uuid, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
declare y record;
begin
  for y in select x.id from mahjong.hanchans x where x.table_id = p_tid and not x.voided order by x.id loop
    perform mahjong_private.mj_w_changed(y.id, p_me);
  end loop;
  if mahjong_private.mj_w_tf0(p_tid) then perform mahjong_private.mj_w_tchanged(p_tid, p_me); end if;
end $fn$;
revoke all on function mahjong_private.mj_w_tvoid(uuid, uuid) from public, anon, authenticated;

-- 書き込みの数え（§5・P6 p6_sadame v3.1）：分の窓＝人ごとの ur1m・u1m は max(1,n)（弾いた呼びの罰）・入だけ rn1m は n だけ（弾いた呼びで他の人を止めない）
--   P9（pbundle v2.1 §1）：全員で分け合う all1d・all1m はやめた＝他の人の量で正直な客を止めない（古い行は mj_sweep の '%1d'・'%1m' で消える）・量は wwatch で見る
--   n＝組の重み＝max(history の行, ceil(大きさ ÷ 1,024))（mj_write が数える）
--   24時間（時の窓24本）＝入 un1d（部屋×人 1,500）・管と持ち主 uk1d（部屋×人 1,500）・rk1d（部屋 7,500）・人ごと u1d（部屋をまたぐ 3,000）
--   P6 で入の部屋の1日 rn1d（3,000）はやめた＝垢を足して部屋の入の全員を24時間止められたため。古い rn1d の行は mj_sweep の '%1d' で消える
--   p_room が null＝段①②の弾き＝u1m だけに1。古い窓は同じ取引で消す。(kind, key) の字の順に upsert
-- 2c-2f 合図（2c2f_sadame v1.2 §1）＝倉庫からの送りは控え（本道は書いた端末の websocket）。中身は版の数だけ。
-- ★送りの失敗で書きを落とさない★＝自分の begin…exception で包む（realtime の無い倉庫・名の変わり）。呼ぶ側の権限（mj_write の持ち主）で realtime.messages へ入る＝塊が戻れば行も戻る。
create or replace function mahjong_private.mj_w_signal(p_ch text, p_v bigint) returns void
language plpgsql set search_path = '' as $fn$
begin
  if p_ch is null or p_v is null then return; end if;
  begin
    perform realtime.send(pg_catalog.jsonb_build_object('v', p_v), 'w', p_ch, false);
  exception when others then
    raise log 'mj_w_signal % %', sqlstate, sqlerrm;
  end;
end $fn$;
revoke all on function mahjong_private.mj_w_signal(text, bigint) from public, anon, authenticated;

create or replace function mahjong_private.mj_w_count(p_room uuid, p_me uuid, p_role text, p_n int) returns void
language plpgsql set search_path = '' as $fn$
declare
  r record; v_m int := greatest(1, coalesce(p_n, 0)); v_d int := greatest(0, coalesce(p_n, 0));
  v_nyu boolean := p_role = 'nyu'; v_kan boolean := p_role in ('kan', 'owner');
  v_min timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_rk text := p_room::text; v_ru text := p_room::text || ':' || p_me::text;
begin
  for r in
    select k.kind, k.key, k.day, k.add from (values
      ('write:rk1d',  v_rk,       true,  case when p_room is null or not v_kan then 0 else v_d end),
      ('write:rn1m',  v_rk,       false, case when p_room is null or not v_nyu then 0 else v_d end),
      ('write:u1d',   p_me::text, true,  case when p_room is null then 0 else v_d end),
      ('write:u1m',   p_me::text, false, 1 * case when p_room is null then 1 else v_m end),
      ('write:uk1d',  v_ru,       true,  case when p_room is null or not v_kan then 0 else v_d end),
      ('write:un1d',  v_ru,       true,  case when p_room is null or not v_nyu then 0 else v_d end),
      ('write:ur1m',  v_ru,       false, case when p_room is null then 0 else v_m end)
    ) k(kind, key, day, add)
    where k.add > 0 and k.key is not null
    order by k.kind collate "C", k.key collate "C"
  loop
    if r.day then
      delete from mahjong.limits l where l.kind = r.kind and l.key = r.key and l.window_start <= pg_catalog.now() - interval '24 hours';
    else
      delete from mahjong.limits l where l.kind = r.kind and l.key = r.key and l.window_start < v_min;
    end if;
    insert into mahjong.limits (kind, key, window_start, count) values (r.kind, r.key, case when r.day then v_hour else v_min end, r.add)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + excluded.count;
  end loop;
end $fn$;
revoke all on function mahjong_private.mj_w_count(uuid, uuid, text, int) from public, anon, authenticated;

-- 越える窓の名（無ければ null）：p_m＝分の窓に足す数・p_d＝24時間に足す数
create or replace function mahjong_private.mj_w_over(p_room uuid, p_me uuid, p_role text, p_m int, p_d int) returns text
language plpgsql set search_path = '' as $fn$
declare
  v text; v_nyu boolean := p_role = 'nyu'; v_kan boolean := p_role in ('kan', 'owner');
  v_min timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_rk text := p_room::text; v_ru text := p_room::text || ':' || p_me::text;
begin
  select k.kind into v from (values
      ('write:rk1d',  v_rk,       true,  case when v_kan then p_d else 0 end, 7500),
      ('write:rn1m',  v_rk,       false, case when v_nyu then p_m else 0 end, 600),
      ('write:u1d',   p_me::text, true,  p_d, 3000),
      ('write:u1m',   p_me::text, false, p_m, 300),
      ('write:uk1d',  v_ru,       true,  case when v_kan then p_d else 0 end, 1500),
      ('write:un1d',  v_ru,       true,  case when v_nyu then p_d else 0 end, 1500),
      ('write:ur1m',  v_ru,       false, p_m, 120)
    ) k(kind, key, day, add, cap)
   where k.add > 0
     and (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l
           where l.kind = k.kind and l.key = k.key
             and case when k.day then l.window_start > pg_catalog.now() - interval '24 hours' else l.window_start = v_min end) + k.add > k.cap
   order by k.kind collate "C" limit 1;
  return v;
end $fn$;
revoke all on function mahjong_private.mj_w_over(uuid, uuid, text, int, int) from public, anon, authenticated;

-- ── 2c-2b 役の門・入り直しの門の下請け（write4_sekkei.md §1・§2＋v1.1 C2＝例外を出さない字・塊の外で呼ぶ） ──
-- 管か（who_plain の kan／self_or_kan の「管」・持ち主も管＝v1.1 O3）
create or replace function mahjong_private.mj_w_is_kan(p_role text) returns boolean
language sql immutable set search_path = '' as $fn$
  select coalesce(p_role in ('kan', 'owner'), false);
$fn$;
revoke all on function mahjong_private.mj_w_is_kan(text) from public, anon, authenticated;
-- 役の足りなさ（null＝通る・字＝足りない役）。知らない who_plain は閉じる（none・revert_rule は c_keys に無いので①で止まる）
create or replace function mahjong_private.mj_w_need(p_who text, p_role text) returns text
language sql immutable set search_path = '' as $fn$
  select case
    when p_who in ('nyu', 'self', 'self_or_kan') then null
    when p_who in ('kan', 'owner_or_kan') then case when mahjong_private.mj_w_is_kan(p_role) then null else 'kan' end
    when p_who = 'owner' then case when p_role = 'owner' then null else 'owner' end
    else coalesce(p_who, 'none') end;
$fn$;
revoke all on function mahjong_private.mj_w_need(text, text) from public, anon, authenticated;
-- 2c-2d1（write7 v1.1 止め1）役の見方＝op の中で対象が分かった所で呼ぶ（③' は who_league が same か who_plain と同じ op だけを見る）
--   p_league＝対象のリーグの日のリーグ（null＝リーグでない日）・p_member＝owner_or_sole_L の op の名簿の人
--   リーグでない日＝who_plain（mj_w_need）／リーグの日＝who_league：same＝who_plain・nyu＝通る・L＝そのリーグの L が自分・owner＝部屋の持ち主
--   owner_or_sole_L＝その人が出たリーグ（取り消した半荘・卓・開催日・リーグも数える）が無ければ who_plain・在れば部屋の持ち主か、その全部の L が自分
--   取り消したリーグの日＝bad at league（member の op は数えるだけ）。足りない＝MJ001 {ok:false, err:'mj_role', i, need}（数えは ③' と同じ v_n 0）
create or replace function mahjong_private.mj_w_role(p_room uuid, p_op text, p_league uuid, p_member uuid, p_me uuid, p_role text, p_i int) returns void
language plpgsql set search_path = '' as $fn$
declare v_wp text; v_wl text; v_need text; g mahjong.leagues; v_ls uuid[];
begin
  select m.who_plain, m.who_league into v_wp, v_wl from mahjong.mj_ops m where m.name = p_op;
  if v_wp is null or v_wl is null then perform mahjong_private.mj_w_bad(p_i, 'op'); end if;
  if v_wl = 'owner_or_sole_L' then
    select pg_catalog.array_agg(distinct z.league_id) into v_ls
      from mahjong.hanchans x join mahjong.tables y on y.id = x.table_id join mahjong.sessions z on z.id = y.session_id
     where x.room_id = p_room and z.league_id is not null
       and exists (select 1 from pg_catalog.jsonb_each_text(x.seats) q where q.value = p_member::text);
    if v_ls is null then v_need := mahjong_private.mj_w_need(v_wp, p_role);
    elsif p_role = 'owner' then v_need := null;
    elsif not exists (select 1 from mahjong.leagues l where l.id = any(v_ls) and l.owner_user_id is distinct from p_me) then v_need := null;
    else v_need := 'owner_or_sole_L';
    end if;
  elsif p_league is null then
    v_need := mahjong_private.mj_w_need(v_wp, p_role);
  else
    select l.* into g from mahjong.leagues l where l.id = p_league and l.room_id = p_room;
    if not found or g.voided then perform mahjong_private.mj_w_bad(p_i, 'league'); end if;
    v_need := case v_wl
      when 'same'  then mahjong_private.mj_w_need(v_wp, p_role)
      when 'nyu'   then null
      when 'L'     then case when g.owner_user_id = p_me then null else 'L' end
      when 'owner' then mahjong_private.mj_w_need('owner', p_role)
      else coalesce(v_wl, 'none') end;
  end if;
  if v_need is not null then
    perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_role', 'i', p_i, 'need', v_need));
  end if;
end $fn$;
revoke all on function mahjong_private.mj_w_role(uuid, text, uuid, uuid, uuid, text, int) from public, anon, authenticated;

-- 2c-2d1 ルールを確かめてそろえる（弾く＝bad at p_at・key に鍵の名）
create or replace function mahjong_private.mj_w_rules(p_rules jsonb, p_at text, p_i int) returns jsonb
language plpgsql set search_path = '' as $fn$
declare v jsonb; e text;
begin
  begin
    v := mahjong_private.mj_rules_ok(p_rules);
  exception when others then
    e := sqlerrm;
    perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', p_at,
      'key', case when e like 'mj\_range:%' then pg_catalog.substr(e, 10) else null end));
  end;
  return v;
end $fn$;
revoke all on function mahjong_private.mj_w_rules(jsonb, text, int) from public, anon, authenticated;

-- 2c-2d1 日付（無い・null＝null／'YYYY-MM-DD' でなければ bad at k）
create or replace function mahjong_private.mj_w_date(a jsonb, k text, p_i int) returns date
language plpgsql set search_path = '' as $fn$
declare d date;
begin
  if a -> k is null or a -> k = 'null'::jsonb then return null; end if;
  if pg_catalog.jsonb_typeof(a -> k) <> 'string' then perform mahjong_private.mj_w_bad(p_i, k); end if;
  begin
    d := (a ->> k)::date;
  exception when others then
    d := null;
  end;
  if d is null or pg_catalog.to_char(d, 'YYYY-MM-DD') <> (a ->> k) then perform mahjong_private.mj_w_bad(p_i, k); end if;
  return d;
end $fn$;
revoke all on function mahjong_private.mj_w_date(jsonb, text, int) from public, anon, authenticated;
-- 10分の内に入り直したか（K-6）＝jwt の amr の各 timestamp（数の物だけ）の最大が now() − 10分 以上。jwt が読めない・amr が配列でない・数の timestamp が無い＝false（閉じる側）
--   ★refresh では amr が変わらない（I-7③）＝refresh だけの token は10分の外になる＝閉じる側★
create or replace function mahjong_private.mj_w_reauth_ok() returns boolean
language plpgsql stable set search_path = '' as $fn$
declare v_j jsonb; v_max numeric;
begin
  begin
    v_j := auth.jwt() -> 'amr';
  exception when others then
    return false;
  end;
  if v_j is null or pg_catalog.jsonb_typeof(v_j) <> 'array' then return false; end if;
  select pg_catalog.max((t.e -> 'timestamp')::numeric) into v_max
    from pg_catalog.jsonb_array_elements(v_j) t(e)
   where pg_catalog.jsonb_typeof(t.e) = 'object' and pg_catalog.jsonb_typeof(t.e -> 'timestamp') = 'number';
  return v_max is not null and v_max >= pg_catalog.date_part('epoch', pg_catalog.now()) - 600;
end $fn$;
revoke all on function mahjong_private.mj_w_reauth_ok() from public, anon, authenticated;

-- ── 2c-2c K-3 持ち主の継ぎ（write5_sadame.md）＝p_from の後を継ぐ人＝その部屋の room_accounts の p_from 以外（出した人を除く）で
--   管の joined_at 最古（同じなら user_id の字順）→無ければ入の最古。継ぐ人の役は kan に直す・p_from が持ち主の L のリーグ（取り消した物も）を継ぐ人へ。
--   返し＝書いた履歴の行の数（1〜3）・継げる人が居ない＝-1（何も書かない）
create or replace function mahjong_private.mj_w_inherit(p_room uuid, p_gid uuid, p_op text, p_me uuid, p_role text, p_from uuid) returns int
language plpgsql set search_path = '' as $fn$
declare v_to uuid; v_r text; v_n int := 1;
begin
  select a.user_id, a.role into v_to, v_r from mahjong.room_accounts a
   where a.room_id = p_room and a.user_id <> p_from
     and not exists (select 1 from mahjong.room_bans b where b.room_id = p_room and b.user_id = a.user_id)
   order by (a.role = 'kan') desc, a.joined_at, a.user_id::text limit 1 for update;
  if not found then return -1; end if;
  update mahjong.rooms x set owner_user_id = v_to where x.id = p_room;
  perform mahjong_private.mj_w_hist(p_room, p_gid, p_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'owner_user_id',
    pg_catalog.to_jsonb(p_from::text), pg_catalog.to_jsonb(v_to::text), null);
  if v_r <> 'kan' then
    update mahjong.room_accounts a set role = 'kan' where a.room_id = p_room and a.user_id = v_to;
    perform mahjong_private.mj_w_hist(p_room, p_gid, p_op, p_me, p_role, 'room_accounts',
      pg_catalog.jsonb_build_object('room_id', p_room, 'user_id', v_to), 'role', pg_catalog.to_jsonb(v_r), pg_catalog.to_jsonb('kan'::text), null);
    v_n := v_n + 1;
  end if;
  update mahjong.leagues l set owner_user_id = v_to, version = l.version + 1 where l.room_id = p_room and l.owner_user_id = p_from;
  if found then
    perform mahjong_private.mj_w_hist(p_room, p_gid, p_op, p_me, p_role, 'leagues', pg_catalog.jsonb_build_object('room_id', p_room), 'owner_user_id',
      pg_catalog.to_jsonb(p_from::text), pg_catalog.to_jsonb(v_to::text), null);
    v_n := v_n + 1;
  end if;
  return v_n;
end $fn$;
revoke all on function mahjong_private.mj_w_inherit(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- 1つの op を当てる（§3）。返し＝{r:{i, v?}, made, hist, h?, t?, fresh?, cap?:{tbl, id}}
create or replace function mahjong_private.mj_w_op(p_room uuid, p_me uuid, p_role text, p_gid uuid, p_i int, p_o jsonb) returns jsonb
language plpgsql set search_path = '' as $fn$
declare
  c_trim constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  v_op text := p_o ->> 'op';
  v_id uuid; v_id2 uuid; v_r uuid; v_s text; v_key text; v_n int; v_x int; v_bv int; v_rc int; k int; v_kd text;
  v_j jsonb; v_j2 jsonb; v_j3 jsonb; v_rules jsonb; v_d date; v_rate int; v_oc int[];
  v_sn int; v_nc int; v_ch2 uuid[]; v_h2 uuid;   -- E2（e_sadame v2 §E2）seen_n・数の入った席の数・卓の鎖・ぶつかった回
  t mahjong.tables; h mahjong.hanchans; s record; c record;
  v_b boolean; v_mode text; v_y record; v_m mahjong.members; v_ss mahjong.sessions;
  v_u uuid; v_own uuid; v_m2 mahjong.members; v_cap2 int; v_us uuid[]; v_ids uuid[];
  v_hid bigint;   -- C2-1 §1a room_leave の left_hist_id
  g mahjong.leagues; v_ra jsonb; v_d2 date; v_ida uuid; v_rv int; v_rva int; v_alt boolean; v_rk text; v_s2 text;
begin
  -- C2-1 §1a：抜けた人の名（user_id が在り・その人の room_accounts が無く・持ち主でない）への rename・relink・link・unlink＝left（持ち主の unlink だけ通す）
  if v_op in ('member_rename', 'member_relink', 'member_link', 'member_unlink') and not (v_op = 'member_unlink' and p_role = 'owner') then
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    if exists (select 1 from mahjong.members m join mahjong.rooms x on x.id = m.room_id
                where m.id = v_id and m.room_id = p_room and m.user_id is not null and m.user_id is distinct from x.owner_user_id
                  and not exists (select 1 from mahjong.room_accounts a where a.room_id = p_room and a.user_id = m.user_id)) then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'left', 'i', p_i, 'member_id', v_id));
    end if;
  end if;
  -- ── 作る op ──
  if v_op = 'member_add' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    select m.room_id into v_r from mahjong.members m where m.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'member_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    if pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_s := pg_catalog.btrim(p_o ->> 'name', c_trim);
    if pg_catalog.char_length(v_s) not between 1 and 20 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_key := mahjong_private.mj_name_key(v_s);
    if v_key is null or pg_catalog.char_length(v_key) not between 1 and 40 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    select m.id, m.name into c from mahjong.members m where m.room_id = p_room and m.active and m.name_key = v_key limit 1;
    if found then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'at', 'name',
        'member_id', c.id, 'name', c.name));
    end if;
    insert into mahjong.members (id, room_id, name, name_key, created_at) values (v_id, p_room, v_s, v_key, pg_catalog.clock_timestamp());   -- 2d：組の中の順を残す（mj_read の並び (created_at, id)）
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('name', v_s), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1);   -- 人の数 300（full members）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）

  elsif v_op = 'session_add' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'session_id', p_i);
    select x.room_id into v_r from mahjong.sessions x where x.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    if pg_catalog.jsonb_typeof(p_o -> 'date') is distinct from 'string' or (p_o ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      perform mahjong_private.mj_w_bad(p_i, 'date');
    end if;
    begin
      v_d := (p_o ->> 'date')::date;
    exception when others then
      v_d := null;
    end;
    if v_d is null or pg_catalog.to_char(v_d, 'YYYY-MM-DD') <> (p_o ->> 'date') then perform mahjong_private.mj_w_bad(p_i, 'date'); end if;
    v_rate := null;
    if p_o -> 'rate' is not null and p_o -> 'rate' <> 'null'::jsonb then
      v_rate := mahjong_private.mj_w_int(p_o, 'rate', p_i);
      if v_rate not between 10 and 2000000000 or v_rate % 10 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'rate', 'range'); end if;
    end if;
    v_s := null;
    if p_o -> 'place' is not null and p_o -> 'place' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_o -> 'place') <> 'string' or pg_catalog.char_length(p_o ->> 'place') > 40 then
        perform mahjong_private.mj_w_bad(p_i, 'place');
      end if;
      v_s := p_o ->> 'place';
    end if;
    -- 2c-2d1：リーグの日＝その部屋の取り消していないリーグ（bad at league_id）・役は L・ルールはリーグの主の版（rooms の版でない）
    v_id2 := null;
    if p_o -> 'league_id' is not null and p_o -> 'league_id' <> 'null'::jsonb then
      v_id2 := mahjong_private.mj_w_uuid(p_o, 'league_id', p_i);
      select x.* into g from mahjong.leagues x where x.id = v_id2 and x.room_id = p_room for share;
      if not found or g.voided then perform mahjong_private.mj_w_bad(p_i, 'league_id'); end if;
    end if;
    perform mahjong_private.mj_w_role(p_room, v_op, v_id2, null, p_me, p_role, p_i);
    if v_id2 is null then
      select x.rule_set_id, x.rule_version, null::uuid as rule_set_id_alt, null::int as rule_version_alt into s from mahjong.rooms x where x.id = p_room;
    else
      select g.rule_set_id, g.rule_version, g.rule_set_id_alt, g.rule_version_alt into s;
    end if;
    if s.rule_set_id is null then perform mahjong_private.mj_w_bad(p_i, 'rules'); end if;
    -- D2 §1：リーグの日＝重なりの門（同じリーグの取り消していない最後の日（(created_at, id)）に締めが無ければ dup what session）
    --   → 期間（date_from・date_to の外は bad at date・作る時だけ）→ rate（倉庫がリーグの主の rules の rate を書く・op の rate は無いか同じ値だけ＝違えば bad at rate）
    --   2台が同時でも rooms の行を段②で押さえている（for no key update）＝重ならない
    if v_id2 is not null then
      select x.id into v_ida from mahjong.sessions x where x.league_id = v_id2 and not x.voided
       order by x.created_at desc, x.id desc limit 1;
      if v_ida is not null and not exists (select 1 from mahjong.settle_snaps z where z.session_id = v_ida) then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'what', 'session', 'session_id', v_ida));
      end if;
      if (g.date_from is not null and v_d < g.date_from) or (g.date_to is not null and v_d > g.date_to) then
        perform mahjong_private.mj_w_bad(p_i, 'date');
      end if;
      select r.rules into v_rules from mahjong.rule_sets r where r.id = s.rule_set_id and r.version = s.rule_version;
      v_x := case when pg_catalog.jsonb_typeof(v_rules -> 'rate') = 'number' then (v_rules ->> 'rate')::int end;
      if v_rate is not null and v_rate is distinct from v_x then perform mahjong_private.mj_w_bad(p_i, 'rate'); end if;
      v_rate := v_x;
    end if;
    -- 2d §1 開催の重なりの門（v1 止め2）：shared の部屋のリーグでない開催は、リーグの日でない・取り消していない最後の開催（(created_at, id) の順＝写しの pickSession）に
    --   締め（settle_snap）が無ければ dup what session（その開催の id）＝2台が別の開催を作らない。solo は今のまま
    if v_id2 is null and (select x.kind from mahjong.rooms x where x.id = p_room) = 'shared' then
      select x.id into v_ida from mahjong.sessions x where x.room_id = p_room and x.league_id is null and not x.voided
       order by x.created_at desc, x.id desc limit 1;
      if v_ida is not null and not exists (select 1 from mahjong.settle_snaps z where z.session_id = v_ida) then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'what', 'session', 'session_id', v_ida));
      end if;
    end if;
    insert into mahjong.sessions (id, room_id, league_id, date, place, rate, rule_set_id, rule_version, rule_set_id_alt, rule_version_alt, created_at)
      values (v_id, p_room, v_id2, v_d, v_s, v_rate, s.rule_set_id, s.rule_version, s.rule_set_id_alt, s.rule_version_alt, pg_catalog.clock_timestamp());
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'sessions', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('date', v_d, 'rate', v_rate, 'place', v_s)
        || case when v_id2 is null then '{}'::jsonb else pg_catalog.jsonb_build_object('league_id', v_id2) end, 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1);

  elsif v_op = 'table_add' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'table_id', p_i);
    select x.room_id into v_r from mahjong.tables x where x.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    v_id2 := mahjong_private.mj_w_uuid(p_o, 'session_id', p_i);
    select x.* into s from mahjong.sessions x where x.id = v_id2 and x.room_id = p_room;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
    if s.voided then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
    perform mahjong_private.mj_w_role(p_room, v_op, s.league_id, null, p_me, p_role, p_i);
    if pg_catalog.jsonb_typeof(p_o -> 'label') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
    v_s := pg_catalog.btrim(p_o ->> 'label', c_trim);
    if pg_catalog.char_length(v_s) not between 1 and 20 then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
    -- D2 §1：alt（任意 bool・null＝偽）＝true はリーグの日で開催日の alt の版が在る時だけ（他は bad at alt）＝卓のルールは開催日の alt の版
    v_alt := false;
    if p_o -> 'alt' is not null and p_o -> 'alt' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_o -> 'alt') <> 'boolean' then perform mahjong_private.mj_w_bad(p_i, 'alt'); end if;
      v_alt := (p_o ->> 'alt')::boolean;
    end if;
    if v_alt and (s.league_id is null or s.rule_set_id_alt is null) then perform mahjong_private.mj_w_bad(p_i, 'alt'); end if;
    if v_alt then
      v_ida := s.rule_set_id_alt; v_rv := s.rule_version_alt;
    else
      v_ida := s.rule_set_id; v_rv := s.rule_version;
    end if;
    select r.rules into v_rules from mahjong.rule_sets r where r.id = v_ida and r.version = v_rv;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, extra_state, chip_state, shugi_state, created_at)
      values (v_id, p_room, v_id2, v_s, (v_rules ->> 'players')::smallint, v_ida, v_rv, 'ok', 'unused', 'unused', pg_catalog.clock_timestamp());
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('session_id', v_id2, 'label', v_s) || case when v_alt then '{"alt": true}'::jsonb else '{}'::jsonb end, 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 't', v_id);

  elsif v_op = 'hanchan_start' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i);
    select x.room_id into v_r from mahjong.hanchans x where x.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'hanchan_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    t := mahjong_private.mj_w_tfollow(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role, p_o);   -- C4：区切られていれば鎖の最後
    if t.voided then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
    select r.rules into v_rules from mahjong.rule_sets r where r.id = t.rule_set_id and r.version = t.rule_version;
    v_n := t.players;
    v_j := mahjong_private.mj_w_people(p_room, p_o -> 'seats', v_n, p_i, 'seats');            -- 席の member_id（小文字）
    v_j2 := (select pg_catalog.jsonb_object_agg((t2.o - 1)::text, t2.v) from pg_catalog.jsonb_array_elements(v_j) with ordinality t2(v, o));
    if pg_catalog.jsonb_typeof(p_o -> 'cells') is distinct from 'array' or pg_catalog.jsonb_array_length(p_o -> 'cells') <> v_n then
      perform mahjong_private.mj_w_bad(p_i, 'cells');
    end if;
    -- E2 §1：空いた席は null（行を作らない）・1つは数（全部 null は range at cells）
    v_nc := 0;
    for k in 0 .. v_n - 1 loop
      if pg_catalog.jsonb_typeof(p_o -> 'cells' -> k) = 'null' then continue; end if;
      v_nc := v_nc + 1;
      if pg_catalog.jsonb_typeof(p_o -> 'cells' -> k) <> 'number' or ((p_o -> 'cells' -> k)::numeric) % 1 <> 0 then
        perform mahjong_private.mj_w_bad(p_i, 'cells');
      end if;
      if ((p_o -> 'cells' -> k)::numeric) not between -2000000000 and 2000000000 or ((p_o -> 'cells' -> k)::numeric) % 100 <> 0 then
        perform mahjong_private.mj_w_bad(p_i, 'cells', 'range');
      end if;
    end loop;
    if v_nc = 0 then perform mahjong_private.mj_w_bad(p_i, 'cells', 'range'); end if;
    v_j3 := null;
    if p_o -> 'ton_order' is not null and p_o -> 'ton_order' <> 'null'::jsonb then
      v_j3 := mahjong_private.mj_w_people(p_room, p_o -> 'ton_order', v_n, p_i, 'ton_order', v_j2);
    end if;
    -- A13 §6：seen_cells は付けるなら cells と同じ（違えば・形が壊れていれば bad）・付けなければ order_cells は null（古い PWA）
    v_oc := null;
    if p_o -> 'seen_cells' is not null and p_o -> 'seen_cells' <> 'null'::jsonb then
      v_oc := mahjong_private.mj_w_seen_cells(p_o -> 'seen_cells', v_n, p_i);
      if v_oc is distinct from (select pg_catalog.array_agg(case when pg_catalog.jsonb_typeof(e.v) = 'number' then ((e.v)::numeric)::int end order by e.o)
                                  from pg_catalog.jsonb_array_elements(p_o -> 'cells') with ordinality e(v, o)) then   -- E2：空いた席は null のまま比べる（seen_cells は数だけ＝違う＝bad）
        perform mahjong_private.mj_w_bad(p_i, 'seen_cells');
      end if;
    end if;
    if v_j3 is null then v_oc := null; end if;
    v_x := 0;
    if p_o -> 'lost' is not null and p_o -> 'lost' <> 'null'::jsonb then
      v_x := mahjong_private.mj_w_int(p_o, 'lost', p_i);
      if v_x not between 0 and 2000000000 or v_x % 1000 <> 0 or (v_x <> 0 and coalesce(v_rules ->> 'kyotaku_end', '') <> 'kieru') then
        perform mahjong_private.mj_w_bad(p_i, 'lost', 'range');
      end if;
    end if;
    v_rules := coalesce(v_rules, '{}'::jsonb);
    if p_o -> 'tobi_to' is not null and p_o -> 'tobi_to' <> 'null'::jsonb
       and not mahjong_private.mj_tobi_ok(p_o -> 'tobi_to', v_n::smallint) then
      perform mahjong_private.mj_w_bad(p_i, 'tobi_to');
    end if;
    -- E2 §5：seen_n＝端末が持つ鎖の回の数（取り消しも数える）・付けるなら 0 以上の整数（mj_w_int が先）
    v_sn := null;
    if p_o -> 'seen_n' is not null and p_o -> 'seen_n' <> 'null'::jsonb then
      v_sn := mahjong_private.mj_w_int(p_o, 'seen_n', p_i);
      if v_sn < 0 then perform mahjong_private.mj_w_bad(p_i, 'seen_n'); end if;
    end if;
    -- E2 §5 門（何も書かない・最後の卓は mj_w_tfollow が押さえた）：(a) 鎖に開いている回（取り消していない・行の無い席が在る）→ open
    --   (b) 鎖の回の数（取り消しも）＞ seen_n → new（一番新しい回＝鎖の順・卓の中は作った順）。seen_n が無い古い PWA は (b) だけ飛ばす
    v_ch2 := mahjong_private.mj_w_chain(t.id);
    select x.id into v_h2 from mahjong.hanchans x
     where x.table_id = any(v_ch2) and not x.voided
       and (select pg_catalog.count(*) from mahjong.cells c2 where c2.hanchan_id = x.id) < x.players
     order by pg_catalog.array_position(v_ch2, x.table_id), x.created_at, x.id limit 1;
    if v_h2 is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('what', 'open', 'hanchan_id', v_h2)));
    end if;
    if v_sn is not null and (select pg_catalog.count(*) from mahjong.hanchans x where x.table_id = any(v_ch2)) > v_sn then
      select x.id into v_h2 from mahjong.hanchans x where x.table_id = any(v_ch2)
       order by pg_catalog.array_position(v_ch2, x.table_id) desc, x.created_at desc, x.id desc limit 1;
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('what', 'new', 'hanchan_id', v_h2)));
    end if;
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, ton_order, order_cells, rule_set_id, rule_version, rules_snapshot,
                                  lost_kyotaku, tobi_to, created_by_user, created_at)
      values (v_id, p_room, t.id, v_n, v_j2, v_j3, v_oc, t.rule_set_id, t.rule_version, v_rules, v_x,
              case when p_o -> 'tobi_to' is null or p_o -> 'tobi_to' = 'null'::jsonb then '{}'::jsonb else p_o -> 'tobi_to' end, p_me, pg_catalog.clock_timestamp());
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('table_id', t.id, 'seats', v_j2, 'ton_order', v_j3, 'lost', v_x,
        'tobi_to', (select x.tobi_to from mahjong.hanchans x where x.id = v_id))
        || case when v_oc is not null then pg_catalog.jsonb_build_object('order_cells', pg_catalog.to_jsonb(v_oc)) else '{}'::jsonb end, 1);
    for k in 0 .. v_n - 1 loop
      if pg_catalog.jsonb_typeof(p_o -> 'cells' -> k) = 'null' then continue; end if;   -- E2 §1：空いた席は行を作らない
      insert into mahjong.cells (hanchan_id, seat, value, updated_by_user) values (v_id, k, ((p_o -> 'cells' -> k)::numeric)::int, p_me);
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'cells', pg_catalog.jsonb_build_object('hanchan_id', v_id, 'seat', k),
        'value', null, p_o -> 'cells' -> k, 1);
    end loop;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1 + v_nc, 'hist', 1 + v_nc,
      'h', v_id, 'fresh', true, 't', t.id);

  -- ── 版つきの op ──
  elsif v_op = 'cell_set' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    k := mahjong_private.mj_w_int(p_o, 'seat', p_i);
    if k < 0 or k >= h.players then perform mahjong_private.mj_w_bad(p_i, 'seat'); end if;
    v_x := mahjong_private.mj_w_int(p_o, 'value', p_i);
    if v_x not between -2000000000 and 2000000000 or v_x % 100 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'value', 'range'); end if;
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    select x.value, x.version into c from mahjong.cells x where x.hanchan_id = h.id and x.seat = k for update;
    if not found then
      -- E2 §4：行の無い席＝版0 なら v1 で入れる・版1以上は conflict cur {null, 0}（例外にしない）。半荘は mj_w_h が押さえた＝同じ席の入れは並ばない
      if v_bv <> 0 then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
          'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'cell', 'seat', k),
          'cur', pg_catalog.jsonb_build_object('value', null, 'version', 0)));
      end if;
      insert into mahjong.cells (hanchan_id, seat, value, updated_by_user) values (h.id, k, v_x, p_me);
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'cells', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'seat', k),
        'value', null, pg_catalog.to_jsonb(v_x), 1);
      perform mahjong_private.mj_w_changed(h.id, p_me);
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 'h', h.id);
    end if;
    if c.value = v_x then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version), 'made', 0, 'hist', 0, 'h', h.id);
    end if;
    if v_bv <> c.version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'cell', 'seat', k),
        'cur', pg_catalog.jsonb_build_object('value', c.value, 'version', c.version)));
    end if;
    update mahjong.cells x set value = v_x, version = x.version + 1, updated_by_user = p_me, updated_at = pg_catalog.now()
     where x.hanchan_id = h.id and x.seat = k;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: cell_set の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'cells', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'seat', k),
      'value', pg_catalog.to_jsonb(c.value), pg_catalog.to_jsonb(v_x), c.version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version + 1), 'made', 0, 'hist', 1, 'h', h.id);

  elsif v_op = 'hanchan_order' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    v_j := mahjong_private.mj_w_people(p_room, p_o -> 'ton_order', h.players, p_i, 'ton_order', h.seats);
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    -- A13 §6：seen_cells（保存した人が見た点）・[s3] seen_seats（見た席＝今と違えば conflict・何も書かない）
    v_oc := null;
    if p_o -> 'seen_cells' is not null and p_o -> 'seen_cells' <> 'null'::jsonb then
      v_oc := mahjong_private.mj_w_seen_cells(p_o -> 'seen_cells', h.players, p_i);
    end if;
    if p_o -> 'seen_seats' is not null and p_o -> 'seen_seats' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_o -> 'seen_seats') <> 'array' or pg_catalog.jsonb_array_length(p_o -> 'seen_seats') <> h.players
         or exists (select 1 from pg_catalog.jsonb_array_elements(p_o -> 'seen_seats') q(v) where pg_catalog.jsonb_typeof(q.v) <> 'string' or (q.v #>> '{}') = '') then
        perform mahjong_private.mj_w_bad(p_i, 'seen_seats');
      end if;
      if exists (select 1 from pg_catalog.jsonb_array_elements_text(p_o -> 'seen_seats') with ordinality q(v, o)
                  where pg_catalog.lower(q.v) is distinct from (h.seats ->> (q.o - 1)::text)) then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
          'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'order'),
          'cur', pg_catalog.jsonb_build_object('value', h.ton_order, 'version', h.order_version)));
      end if;
    end if;
    if h.ton_order is not distinct from v_j and h.order_cells is not distinct from v_oc then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.order_version), 'made', 0, 'hist', 0, 'h', h.id);
    end if;
    if v_bv <> h.order_version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'order'),
        'cur', pg_catalog.jsonb_build_object('value', h.ton_order, 'version', h.order_version)));
    end if;
    update mahjong.hanchans x set ton_order = v_j, order_cells = v_oc, order_version = x.order_version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: hanchan_order の更新が % 行', v_rc; end if;
    v_n := 0;
    if h.ton_order is distinct from v_j then
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
        'ton_order', h.ton_order, v_j, h.order_version + 1);
      v_n := v_n + 1;
    end if;
    if h.order_cells is distinct from v_oc then
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
        'order_cells', pg_catalog.to_jsonb(h.order_cells), pg_catalog.to_jsonb(v_oc), h.order_version + 1);
      v_n := v_n + 1;
    end if;
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.order_version + 1), 'made', 0, 'hist', v_n, 'h', h.id);

  elsif v_op = 'kyotaku_set' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    v_x := mahjong_private.mj_w_int(p_o, 'value', p_i);
    if v_x not between 0 and 2000000000 or v_x % 1000 <> 0 or (v_x <> 0 and coalesce(h.rules_snapshot ->> 'kyotaku_end', '') <> 'kieru') then
      perform mahjong_private.mj_w_bad(p_i, 'value', 'range');
    end if;
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    if h.lost_kyotaku = v_x then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.version), 'made', 0, 'hist', 0, 'h', h.id);
    end if;
    if v_bv <> h.version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'kyotaku'),
        'cur', pg_catalog.jsonb_build_object('value', h.lost_kyotaku, 'version', h.version)));
    end if;
    update mahjong.hanchans x set lost_kyotaku = v_x, version = x.version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: kyotaku_set の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
      'lost_kyotaku', pg_catalog.to_jsonb(h.lost_kyotaku), pg_catalog.to_jsonb(v_x), h.version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.version + 1), 'made', 0, 'hist', 1, 'h', h.id);

  elsif v_op = 'tobi_set' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    v_j := p_o -> 'tobi_to';
    if not coalesce(mahjong_private.mj_tobi_ok(v_j, h.players), false) then perform mahjong_private.mj_w_bad(p_i, 'tobi_to'); end if;
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    if h.tobi_to = v_j then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.tobi_version), 'made', 0, 'hist', 0,
        'h', h.id, 'fresh', true);
    end if;
    if v_bv <> h.tobi_version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'tobi'),
        'cur', pg_catalog.jsonb_build_object('value', h.tobi_to, 'version', h.tobi_version)));
    end if;
    update mahjong.hanchans x set tobi_to = v_j, tobi_version = x.tobi_version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: tobi_set の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
      'tobi_to', h.tobi_to, v_j, h.tobi_version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.tobi_version + 1), 'made', 0, 'hist', 1,
      'h', h.id, 'fresh', true);


  elsif v_op = 'hanchan_void' or v_op = 'hanchan_unvoid' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    if h.voided = (v_op = 'hanchan_void') then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.version), 'made', 0, 'hist', 0, 'h', h.id, 't', h.table_id);
    end if;
    -- E2 Build：点がまだの回を戻す時、鎖に他の開いている回が在れば conflict open（開いている回は鎖に1つ）
    --   鎖の卓を段の順に押さえる＝同時の hanchan_start（mj_w_tfollow が最後の卓を押さえる）と並ぶ
    if v_op = 'hanchan_unvoid' and (select pg_catalog.count(*) from mahjong.cells c2 where c2.hanchan_id = h.id) < h.players then
      v_ch2 := mahjong_private.mj_w_chain(h.table_id);
      perform 1 from mahjong.tables x where x.id = any(v_ch2) order by x.chain_no, x.id for update;
      select x.id into v_h2 from mahjong.hanchans x
       where x.table_id = any(v_ch2) and not x.voided and x.id <> h.id
         and (select pg_catalog.count(*) from mahjong.cells c2 where c2.hanchan_id = x.id) < x.players
       order by pg_catalog.array_position(v_ch2, x.table_id), x.created_at, x.id limit 1;
      if v_h2 is not null then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
          'at', pg_catalog.jsonb_build_object('what', 'open', 'hanchan_id', v_h2)));
      end if;
    end if;
    update mahjong.hanchans x set voided = (v_op = 'hanchan_void'), version = x.version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: % の更新が % 行', v_op, v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
      'voided', pg_catalog.to_jsonb(h.voided), pg_catalog.to_jsonb(not h.voided), h.version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.version + 1), 'made', 0, 'hist', 1, 'h', h.id, 't', h.table_id);

  -- ── 版を見ない op ──
  elsif v_op = 'extra_add' then
    -- 確かめの順（2c-2a1・写しとそろえる）：kind → unused（使わない種）→ member（人・取り消した卓と開催日）→ add の range
    --   席にいない人の足しは組の終わりの正味の門（v1510:195①）で見る
    t := mahjong_private.mj_w_tfollow(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role, p_o);   -- C4：鍵が同じ区切りだけ鎖の最後へ
    -- 種（2c-3b）：chip・shugi・卓のルールの tane_custom に在る c:<id> だけ・使わない種も bad at kind（mj_w_kind）
    v_kd := mahjong_private.mj_w_kind((select r.rules from mahjong.rule_sets r where r.id = t.rule_set_id and r.version = t.rule_version), p_o -> 'kind');
    if v_kd is null then perform mahjong_private.mj_w_bad(p_i, 'kind'); end if;
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    if not exists (select 1 from mahjong.members m where m.id = v_id and m.room_id = p_room) then
      perform mahjong_private.mj_w_bad(p_i, 'member_id');
    end if;
    if t.voided or exists (select 1 from mahjong.sessions z where z.id = t.session_id and z.voided) then
      perform mahjong_private.mj_w_bad(p_i, 'table_id');
    end if;
    v_x := mahjong_private.mj_w_int(p_o, 'add', p_i);
    if v_x = 0 then perform mahjong_private.mj_w_bad(p_i, 'add'); end if;
    if v_x not between -999 and 999 then perform mahjong_private.mj_w_bad(p_i, 'add', 'range'); end if;
    select e.value, e.version into c from mahjong.extras e where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind') for update;
    if found then
      if c.value + v_x not between -999 and 999 then perform mahjong_private.mj_w_bad(p_i, 'add', 'range'); end if;
      -- 外へ払う種（2c-3b）は足した後が 0 未満なら bad（0〜999）
      if v_kd = 'out' and c.value + v_x < 0 then perform mahjong_private.mj_w_bad(p_i, 'add'); end if;
      update mahjong.extras e set value = e.value + v_x, version = e.version + 1, updated_by_user = p_me, updated_at = pg_catalog.now()
       where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind');
      get diagnostics v_rc = row_count;
      if v_rc <> 1 then raise exception 'mj_write: extra_add の更新が % 行', v_rc; end if;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
        pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value',
        pg_catalog.to_jsonb(c.value), pg_catalog.to_jsonb(c.value + v_x), c.version + 1);
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version + 1), 'made', 0, 'hist', 1, 't', t.id,
        'ek', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'));
    end if;
    if v_kd = 'out' and v_x < 0 then perform mahjong_private.mj_w_bad(p_i, 'add'); end if;
    insert into mahjong.extras (table_id, member_id, kind, value, updated_by_user) values (t.id, v_id, p_o ->> 'kind', v_x, p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
      pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value', null, pg_catalog.to_jsonb(v_x), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 't', t.id,
      'ek', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'));

  elsif v_op = 'settle_snap' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'session_id', p_i);
    select x.* into s from mahjong.sessions x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
    perform mahjong_private.mj_w_role(p_room, v_op, s.league_id, null, p_me, p_role, p_i);
    v_x := mahjong_private.mj_w_int(p_o, 'rev', p_i);
    if v_x < 1 then perform mahjong_private.mj_w_bad(p_i, 'rev'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'content') is distinct from 'object' then perform mahjong_private.mj_w_bad(p_i, 'content'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'used') is distinct from 'object' then perform mahjong_private.mj_w_bad(p_i, 'used'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'missing') is distinct from 'array' then perform mahjong_private.mj_w_bad(p_i, 'missing'); end if;
    if pg_catalog.octet_length((p_o -> 'content')::text) + pg_catalog.octet_length((p_o -> 'used')::text)
       + pg_catalog.octet_length((p_o -> 'missing')::text) > 32768 then
      perform mahjong_private.mj_w_bad(p_i, 'size', 'range');
    end if;
    select coalesce(pg_catalog.max(x.rev), 0) into v_n from mahjong.settle_snaps x where x.session_id = v_id;
    select x.content, x.used, x.missing into c from mahjong.settle_snaps x where x.session_id = v_id and x.rev = v_x;
    if found then
      if c.content = p_o -> 'content' and c.used = p_o -> 'used' and c.missing = p_o -> 'missing' then
        return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_x), 'made', 0, 'hist', 0);
      end if;
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('session_id', v_id, 'what', 'rev'), 'cur', pg_catalog.jsonb_build_object('value', v_n, 'version', v_n)));
    end if;
    if v_x <> v_n + 1 then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('session_id', v_id, 'what', 'rev'), 'cur', pg_catalog.jsonb_build_object('value', v_n, 'version', v_n)));
    end if;
    insert into mahjong.settle_snaps (room_id, session_id, rev, content, used, missing, made_by_user)
      values (p_room, v_id, v_x, p_o -> 'content', p_o -> 'used', p_o -> 'missing', p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'settle_snaps',
      pg_catalog.jsonb_build_object('session_id', v_id, 'rev', v_x), null, null, pg_catalog.jsonb_build_object('rev', v_x), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_x), 'made', 1, 'hist', 1);
  -- ── 直す op（2c-2a2・紙 write2_sekkei.md §9・作り write_2c2a2_tsukuri.md） ──
  elsif v_op = 'member_rename' or v_op = 'member_active' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    select x.* into v_m from mahjong.members x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'member_id'); end if;
    -- リーグの日に出た人（取り消した半荘・卓・開催日・リーグも含む）＝owner_or_sole_L・出ていなければ who_plain（2c-2d1 mj_w_role）
    perform mahjong_private.mj_w_role(p_room, v_op, null, v_id, p_me, p_role, p_i);
    if v_op = 'member_rename' then
      if pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
      v_s := pg_catalog.btrim(p_o ->> 'name', c_trim);
      if pg_catalog.char_length(v_s) not between 1 and 20 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
      v_key := mahjong_private.mj_name_key(v_s);
      if v_key is null or pg_catalog.char_length(v_key) not between 1 and 40 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
      if v_s = v_m.name then
        return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version), 'made', 0, 'hist', 0);
      end if;
      -- 自分を除く（'Ab' → 'aB' は key が同じでも自分なので通る）
      select x.id, x.name into c from mahjong.members x where x.room_id = p_room and x.active and x.name_key = v_key and x.id <> v_m.id limit 1;
      if found then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'at', 'name',
          'member_id', c.id, 'name', c.name));
      end if;
      update mahjong.members x set name = v_s, name_key = v_key, version = x.version + 1 where x.id = v_m.id;
      get diagnostics v_rc = row_count;
      if v_rc <> 1 then raise exception 'mj_write: member_rename の更新が % 行', v_rc; end if;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_m.id),
        'name', pg_catalog.to_jsonb(v_m.name), pg_catalog.to_jsonb(v_s), v_m.version + 1);
    else
      if pg_catalog.jsonb_typeof(p_o -> 'active') is distinct from 'boolean' then perform mahjong_private.mj_w_bad(p_i, 'active'); end if;
      v_b := (p_o ->> 'active')::boolean;
      if v_m.active = v_b then
        return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version), 'made', 0, 'hist', 0);
      end if;
      -- 8b A25r §1-8：アカウントにつないだ人は消せない＝その op を当てる時に見る（同じ組の member_unlink が先なら user_id は空＝通る）・役の門の後・誰がつないだかは返さない
      if not v_b and v_m.user_id is not null then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'tsunagi', 'i', p_i, 'member_id', v_m.id));
      end if;
      if v_b then
        select x.id, x.name into c from mahjong.members x where x.room_id = p_room and x.active and x.name_key = v_m.name_key and x.id <> v_m.id limit 1;
        if found then
          perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'at', 'active',
            'member_id', c.id, 'name', c.name));
        end if;
      end if;
      update mahjong.members x set active = v_b, version = x.version + 1 where x.id = v_m.id;
      get diagnostics v_rc = row_count;
      if v_rc <> 1 then raise exception 'mj_write: member_active の更新が % 行', v_rc; end if;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_m.id),
        'active', pg_catalog.to_jsonb(v_m.active), pg_catalog.to_jsonb(v_b), v_m.version + 1);
    end if;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version + 1), 'made', 0, 'hist', 1);

  elsif v_op = 'session_edit' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'session_id', p_i);
    select x.* into v_ss from mahjong.sessions x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
    perform mahjong_private.mj_w_role(p_room, v_op, v_ss.league_id, null, p_me, p_role, p_i);
    -- 在る鍵だけ session_add と同じ確かめ（date は null 不可・place と rate は null で消す）
    v_d := v_ss.date; v_s := v_ss.place; v_rate := v_ss.rate; v_b := v_ss.voided;
    if p_o ? 'date' then
      if pg_catalog.jsonb_typeof(p_o -> 'date') is distinct from 'string' or (p_o ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        perform mahjong_private.mj_w_bad(p_i, 'date');
      end if;
      begin
        v_d := (p_o ->> 'date')::date;
      exception when others then
        v_d := null;
      end;
      if v_d is null or pg_catalog.to_char(v_d, 'YYYY-MM-DD') <> (p_o ->> 'date') then perform mahjong_private.mj_w_bad(p_i, 'date'); end if;
    end if;
    if p_o ? 'place' then
      v_s := null;
      if p_o -> 'place' <> 'null'::jsonb then
        if pg_catalog.jsonb_typeof(p_o -> 'place') <> 'string' or pg_catalog.char_length(p_o ->> 'place') > 40 then
          perform mahjong_private.mj_w_bad(p_i, 'place');
        end if;
        v_s := p_o ->> 'place';
      end if;
    end if;
    if p_o ? 'rate' then
      v_rate := null;
      if p_o -> 'rate' <> 'null'::jsonb then
        v_rate := mahjong_private.mj_w_int(p_o, 'rate', p_i);
        if v_rate not between 10 and 2000000000 or v_rate % 10 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'rate', 'range'); end if;
      end if;
    end if;
    if p_o ? 'voided' then
      if pg_catalog.jsonb_typeof(p_o -> 'voided') is distinct from 'boolean' then perform mahjong_private.mj_w_bad(p_i, 'voided'); end if;
      v_b := (p_o ->> 'voided')::boolean;
    end if;
    if (v_d, v_s, v_rate, v_b) is not distinct from (v_ss.date, v_ss.place, v_ss.rate, v_ss.voided) then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_ss.version), 'made', 0, 'hist', 0);
    end if;
    update mahjong.sessions x set date = v_d, place = v_s, rate = v_rate, voided = v_b, version = x.version + 1 where x.id = v_ss.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: session_edit の更新が % 行', v_rc; end if;
    v_n := 0;
    v_j := pg_catalog.jsonb_build_object('date', pg_catalog.to_jsonb(v_ss.date), 'place', pg_catalog.to_jsonb(v_ss.place),
      'rate', pg_catalog.to_jsonb(v_ss.rate), 'voided', pg_catalog.to_jsonb(v_ss.voided));
    v_j2 := pg_catalog.jsonb_build_object('date', pg_catalog.to_jsonb(v_d), 'place', pg_catalog.to_jsonb(v_s),
      'rate', pg_catalog.to_jsonb(v_rate), 'voided', pg_catalog.to_jsonb(v_b));
    for v_key in select t2.k from pg_catalog.jsonb_object_keys(v_j) t2(k) order by t2.k loop
      if (v_j -> v_key) is distinct from (v_j2 -> v_key) then
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'sessions', pg_catalog.jsonb_build_object('id', v_ss.id),
          v_key, v_j -> v_key, v_j2 -> v_key, v_ss.version + 1);
        v_n := v_n + 1;
      end if;
    end loop;
    -- 印：取り消し（戻し）は下の取り消していない卓ごと／レートは組の後に取り消していない開催日の rate_mode session の卓だけ
    if v_b is distinct from v_ss.voided then
      for v_y in select x.id from mahjong.tables x where x.session_id = v_ss.id and not x.voided order by x.id loop
        perform mahjong_private.mj_w_tvoid(v_y.id, p_me);
      end loop;
    end if;
    if v_rate is distinct from v_ss.rate and not v_b then
      for v_y in select x.id from mahjong.tables x where x.session_id = v_ss.id and not x.voided and x.rate_mode = 'session' order by x.id loop
        perform mahjong_private.mj_w_trate(v_y.id, p_me);
      end loop;
    end if;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_ss.version + 1), 'made', 0, 'hist', v_n);

  elsif v_op = 'table_edit' then
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role);
    v_s := t.label; v_mode := t.rate_mode; v_rate := t.rate; v_b := t.voided;
    if p_o ? 'label' then
      if pg_catalog.jsonb_typeof(p_o -> 'label') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
      v_s := pg_catalog.btrim(p_o ->> 'label', c_trim);
      if pg_catalog.char_length(v_s) not between 1 and 20 then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
    end if;
    if p_o ? 'rate_mode' then
      if pg_catalog.jsonb_typeof(p_o -> 'rate_mode') is distinct from 'string' or (p_o ->> 'rate_mode') not in ('session', 'num', 'none') then
        perform mahjong_private.mj_w_bad(p_i, 'rate_mode');
      end if;
      v_mode := p_o ->> 'rate_mode';
    end if;
    -- 組の後の mode が num＝rate の鍵が在れば数（null は bad）・無ければ今の rate（null なら bad）／num でない＝null 以外は bad・倉庫が null にする
    if v_mode = 'num' then
      if p_o ? 'rate' then
        if p_o -> 'rate' = 'null'::jsonb then perform mahjong_private.mj_w_bad(p_i, 'rate'); end if;
        v_rate := mahjong_private.mj_w_int(p_o, 'rate', p_i);
        if v_rate not between 10 and 2000000000 or v_rate % 10 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'rate', 'range'); end if;
      elsif v_rate is null then
        perform mahjong_private.mj_w_bad(p_i, 'rate');
      end if;
    else
      if p_o ? 'rate' and p_o -> 'rate' <> 'null'::jsonb then perform mahjong_private.mj_w_bad(p_i, 'rate'); end if;
      v_rate := null;
    end if;
    if p_o ? 'voided' then
      if pg_catalog.jsonb_typeof(p_o -> 'voided') is distinct from 'boolean' then perform mahjong_private.mj_w_bad(p_i, 'voided'); end if;
      v_b := (p_o ->> 'voided')::boolean;
    end if;
    if (v_s, v_mode, v_rate, v_b) is not distinct from (t.label, t.rate_mode, t.rate, t.voided) then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', t.version), 'made', 0, 'hist', 0);
    end if;
    -- L §2①（l_sadame v1.3）：リーグの日の卓の voided が変わる時だけ・その日に締め（settle_snap）が在れば settled（ふつうの部屋の日は今のまま）
    --   段②の rooms の鍵で settle_snap とは並ばないが、重ねの守りとして日の行を for share で読んでから締めを見る
    if v_b is distinct from t.voided then
      select x.* into v_ss from mahjong.sessions x where x.id = t.session_id for share;
      if v_ss.league_id is not null and exists (select 1 from mahjong.settle_snaps z where z.session_id = t.session_id) then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'settled', 'i', p_i, 'table_id', t.id, 'session_id', t.session_id));
      end if;
    end if;
    update mahjong.tables x set label = v_s, rate_mode = v_mode, rate = v_rate, voided = v_b, version = x.version + 1 where x.id = t.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: table_edit の更新が % 行', v_rc; end if;
    v_n := 0;
    v_j := pg_catalog.jsonb_build_object('label', pg_catalog.to_jsonb(t.label), 'rate_mode', pg_catalog.to_jsonb(t.rate_mode),
      'rate', pg_catalog.to_jsonb(t.rate), 'voided', pg_catalog.to_jsonb(t.voided));
    v_j2 := pg_catalog.jsonb_build_object('label', pg_catalog.to_jsonb(v_s), 'rate_mode', pg_catalog.to_jsonb(v_mode),
      'rate', pg_catalog.to_jsonb(v_rate), 'voided', pg_catalog.to_jsonb(v_b));
    for v_key in select t2.k from pg_catalog.jsonb_object_keys(v_j) t2(k) order by t2.k loop
      if (v_j -> v_key) is distinct from (v_j2 -> v_key) then
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', t.id),
          v_key, v_j -> v_key, v_j2 -> v_key, t.version + 1);
        v_n := v_n + 1;
      end if;
    end loop;
    if v_b is distinct from t.voided then perform mahjong_private.mj_w_tvoid(t.id, p_me); end if;
    -- レートの印は取り消した卓・取り消した開催日の卓には付けない（session_edit と同じ）
    if (v_mode, v_rate) is distinct from (t.rate_mode, t.rate) and not v_b
       and not exists (select 1 from mahjong.sessions z3 where z3.id = t.session_id and z3.voided) then
      perform mahjong_private.mj_w_trate(t.id, p_me);
    end if;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', t.version + 1), 'made', 0, 'hist', v_n);

  elsif v_op = 'hanchan_seats' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i, v_op, p_me, p_role);
    if h.voided then perform mahjong_private.mj_w_bad(p_i, 'hanchan_id'); end if;
    -- 席の確かめ（mj_w_people は全員 active を見る＝ここは inactive も部屋の人・今の席にいない inactive だけ bad）
    v_j := p_o -> 'seats';
    if pg_catalog.jsonb_typeof(v_j) is distinct from 'array' or pg_catalog.jsonb_array_length(v_j) <> h.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    for k in 0 .. h.players - 1 loop
      if pg_catalog.jsonb_typeof(v_j -> k) <> 'string'
         or ((v_j -> k) #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform mahjong_private.mj_w_bad(p_i, 'seats');
      end if;
    end loop;
    if (select pg_catalog.count(distinct (q.v #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(v_j) q(v)) <> h.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    if (select pg_catalog.count(*) from mahjong.members x
         where x.room_id = p_room and x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))) <> h.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    if exists (select 1 from mahjong.members x where x.room_id = p_room and not x.active
                 and x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))
                 and not exists (select 1 from pg_catalog.jsonb_each_text(h.seats) w where w.value = x.id::text)) then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    v_j2 := (select pg_catalog.jsonb_object_agg((q.o - 1)::text, pg_catalog.lower(q.v #>> '{}')) from pg_catalog.jsonb_array_elements(v_j) with ordinality q(v, o));
    if h.seats = v_j2 then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.seats_version), 'made', 0, 'hist', 0, 'h', h.id, 't', h.table_id);
    end if;
    v_n := 1;
    -- 顔ぶれ（集合）が変わったら東の並びは合わない＝null＋order_version+1
    if h.ton_order is not null
       and (select pg_catalog.array_agg(w.value order by w.value) from pg_catalog.jsonb_each_text(h.seats) w)
           is distinct from (select pg_catalog.array_agg(w.value order by w.value) from pg_catalog.jsonb_each_text(v_j2) w) then
      update mahjong.hanchans x set ton_order = null, order_cells = null, order_version = x.order_version + 1 where x.id = h.id;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
        'ton_order', h.ton_order, null, h.order_version + 1);
      v_n := 2;
    -- A13 §6 [s2]：人が同じ並べ替えだけなら order_cells を人に付けて動かす（新[新しい席(m)] = 前[前の席(m)]・古い null は null のまま）
    elsif h.order_cells is not null then
      v_oc := (select pg_catalog.array_agg(h.order_cells[(o.key)::int + 1] order by (n.key)::int)
                 from pg_catalog.jsonb_each_text(v_j2) n join pg_catalog.jsonb_each_text(h.seats) o on o.value = n.value);
      if v_oc is distinct from h.order_cells then
        update mahjong.hanchans x set order_cells = v_oc where x.id = h.id;
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
          'order_cells', pg_catalog.to_jsonb(h.order_cells), pg_catalog.to_jsonb(v_oc), h.order_version);
        v_n := 2;
      end if;
    end if;
    update mahjong.hanchans x set seats = v_j2, seats_version = x.seats_version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: hanchan_seats の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
      'seats', h.seats, v_j2, h.seats_version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.seats_version + 1), 'made', 0, 'hist', v_n,
      'h', h.id, 't', h.table_id);

  elsif v_op = 'table_seats' then
    -- B1（b1_sadame_v2.md v2.1）：卓の席＝後勝ち・base_version 無し。確かめは hanchan_seats と同じ（今の卓の席にいない inactive だけ bad）
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role);
    if t.voided or exists (select 1 from mahjong.sessions z where z.id = t.session_id and z.voided) then
      perform mahjong_private.mj_w_bad(p_i, 'table_id');
    end if;
    v_j := p_o -> 'seats';
    if pg_catalog.jsonb_typeof(v_j) is distinct from 'array' or pg_catalog.jsonb_array_length(v_j) <> t.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    for k in 0 .. t.players - 1 loop
      if pg_catalog.jsonb_typeof(v_j -> k) <> 'string'
         or ((v_j -> k) #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform mahjong_private.mj_w_bad(p_i, 'seats');
      end if;
    end loop;
    if (select pg_catalog.count(distinct (q.v #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(v_j) q(v)) <> t.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    if (select pg_catalog.count(*) from mahjong.members x
         where x.room_id = p_room and x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))) <> t.players then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    if exists (select 1 from mahjong.members x where x.room_id = p_room and not x.active
                 and x.id in (select (q.v #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v_j) q(v))
                 and not exists (select 1 from pg_catalog.jsonb_array_elements_text(t.seats) w where w.value = x.id::text)) then
      perform mahjong_private.mj_w_bad(p_i, 'seats');
    end if;
    v_j2 := (select pg_catalog.jsonb_agg(pg_catalog.lower(q.v #>> '{}') order by q.o) from pg_catalog.jsonb_array_elements(v_j) with ordinality q(v, o));
    if t.seats = v_j2 then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', t.seats_version), 'made', 0, 'hist', 0);
    end if;
    update mahjong.tables x set seats = v_j2, seats_version = x.seats_version + 1 where x.id = t.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: table_seats の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', t.id),
      'seats', t.seats, v_j2, t.seats_version + 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', t.seats_version + 1), 'made', 0, 'hist', 1);

  elsif v_op = 'extra_set' then
    -- 確かめの順は extra_add と同じ（kind → unused → member → 取り消した卓・開催日 → value の range）→ base_version
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role);
    -- 種（2c-3b）：extra_add と同じ（mj_w_kind）
    v_kd := mahjong_private.mj_w_kind((select r2.rules from mahjong.rule_sets r2 where r2.id = t.rule_set_id and r2.version = t.rule_version), p_o -> 'kind');
    if v_kd is null then perform mahjong_private.mj_w_bad(p_i, 'kind'); end if;
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    if not exists (select 1 from mahjong.members x where x.id = v_id and x.room_id = p_room) then
      perform mahjong_private.mj_w_bad(p_i, 'member_id');
    end if;
    if t.voided or exists (select 1 from mahjong.sessions z2 where z2.id = t.session_id and z2.voided) then
      perform mahjong_private.mj_w_bad(p_i, 'table_id');
    end if;
    v_x := mahjong_private.mj_w_int(p_o, 'value', p_i);
    if v_x not between -999 and 999 then perform mahjong_private.mj_w_bad(p_i, 'value', 'range'); end if;
    -- 外へ払う種（2c-3b）は 0 未満なら bad（0〜999）
    if v_kd = 'out' and v_x < 0 then perform mahjong_private.mj_w_bad(p_i, 'value'); end if;
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    select e.value, e.version into c from mahjong.extras e where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind') for update;
    if found then
      if c.value = v_x then
        return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version), 'made', 0, 'hist', 0, 't', t.id);
      end if;
      if c.version <> v_bv then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
          'at', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind', 'what', 'extra'),
          'cur', pg_catalog.jsonb_build_object('value', c.value, 'version', c.version)));
      end if;
      update mahjong.extras e set value = v_x, version = e.version + 1, updated_by_user = p_me, updated_at = pg_catalog.now()
       where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind');
      get diagnostics v_rc = row_count;
      if v_rc <> 1 then raise exception 'mj_write: extra_set の更新が % 行', v_rc; end if;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
        pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value',
        pg_catalog.to_jsonb(c.value), pg_catalog.to_jsonb(v_x), c.version + 1);
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version + 1), 'made', 0, 'hist', 1, 't', t.id,
        'ek', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'));
    end if;
    -- 行が無い（決め F）：base_version が 0 でなければ conflict cur{0,0}（value 0 でも先に見る）・0 は書かずに ok（v 0）・そうでなければ作る
    if v_bv <> 0 then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind', 'what', 'extra'),
        'cur', pg_catalog.jsonb_build_object('value', 0, 'version', 0)));
    end if;
    if v_x = 0 then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 0), 'made', 0, 'hist', 0, 't', t.id);
    end if;
    insert into mahjong.extras (table_id, member_id, kind, value, updated_by_user) values (t.id, v_id, p_o ->> 'kind', v_x, p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
      pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value', null, pg_catalog.to_jsonb(v_x), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 't', t.id,
      'ek', pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'));

  -- ── C4（c4_sadame.md v3.3 §2）途中でルールを変える＝卓を区切って続きの卓を新しいルールで作る（役 kan・画面は direct で送る） ──
  elsif v_op = 'table_rules' then
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i, v_op, p_me, p_role);
    v_id := mahjong_private.mj_w_uuid(p_o, 'new_table_id', p_i);
    select x.room_id into v_r from mahjong.tables x where x.id = v_id;
    if found then
      -- 送り直し：前の卓の続きの卓なら書かずに ok・他は bad
      if v_r <> p_room or t.next_table_id is distinct from v_id then perform mahjong_private.mj_w_bad(p_i, 'new_table_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    select x.* into v_ss from mahjong.sessions x where x.id = t.session_id;
    if t.voided or v_ss.voided or v_ss.league_id is not null then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
    v_rules := mahjong_private.mj_w_rules(p_o -> 'rules', 'rules', p_i);
    -- A20 §6：人数の門は外した（途中で3人⇔4人）。続きの卓の人数＝新しい rules の players・席は人数が同じなら写し違えば []
    if t.next_table_id is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('table_id', t.id, 'what', 'next'), 'cur', pg_catalog.jsonb_build_object('next_table_id', t.next_table_id)));
    end if;
    select r.rules into v_j from mahjong.rule_sets r where r.id = t.rule_set_id and r.version = t.rule_version;
    if v_rules = v_j then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    -- 新しい卓のレート：rules.rate が null→none／開催日と同じ→session／違う→num
    v_rate := case when pg_catalog.jsonb_typeof(v_rules -> 'rate') = 'number' then (v_rules ->> 'rate')::int end;
    v_mode := case when v_rate is null then 'none' when v_rate = v_ss.rate then 'session' else 'num' end;
    -- 枚の値に効く鍵（§2-8・T1＝レートは両方の卓の実際のレート）
    v_b := (case t.rate_mode when 'num' then t.rate when 'none' then null else v_ss.rate end)
             is not distinct from (case v_mode when 'num' then v_rate when 'none' then null else v_ss.rate end)
           and not exists (select 1 from pg_catalog.unnest(array['chip_pt10', 'shugi_pt10', 'yakitori', 'yakitori_pt', 'tobi', 'tobi_pt', 'tane_custom']) q(k)
                            where coalesce(v_j -> q.k, 'null'::jsonb) <> coalesce(v_rules -> q.k, 'null'::jsonb));
    if not v_b then
      -- 鍵が違う＝前の卓の種ごとの合計が全部0でなければ bad at extras（kind を添える）
      select e.kind into v_kd from mahjong.extras e where e.table_id = t.id group by e.kind having pg_catalog.sum(e.value) <> 0
       order by e.kind collate "C" limit 1;
      if found then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'extras', 'kind', v_kd));
      end if;
    end if;
    select pg_catalog.max(r.version) + 1 into v_rv from mahjong.rule_sets r where r.id = t.rule_set_id;
    insert into mahjong.rule_sets (id, version, room_id, rules) values (t.rule_set_id, v_rv, p_room, v_rules);
    -- A14 §2.2：新しい規則の行を入れた時だけ・書いた本人に覚える（送り直し・同じルールの道では覚えない）・落ちたら呑まない（internal）
    insert into mahjong.account_rules (user_id, players, rules, updated_at) values (p_me, (v_rules ->> 'players')::smallint, v_rules, pg_catalog.clock_timestamp())
      on conflict (user_id, players) do update set rules = excluded.rules, updated_at = excluded.updated_at;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, rate_mode, rate, extra_state, chip_state, shugi_state, seats, created_at, chain_head, chain_no)
      values (v_id, p_room, t.session_id, t.label, (v_rules ->> 'players')::smallint, t.rule_set_id, v_rv, v_mode, case when v_mode = 'num' then v_rate end,
              'ok', 'unused', 'unused', case when (v_rules ->> 'players')::int = t.players::int then t.seats else '[]'::jsonb end,
              pg_catalog.clock_timestamp(), coalesce(t.chain_head, t.id), t.chain_no + 1);   -- P8：鎖の印
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('session_id', t.session_id, 'label', t.label, 'from_table_id', t.id, 'rule_version', v_rv), 1);
    update mahjong.tables x set next_table_id = v_id, split_same = v_b, version = x.version + 1 where x.id = t.id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', t.id),
      'next_table_id', null, pg_catalog.jsonb_build_object('next_table_id', v_id, 'split_same', v_b), t.version + 1);
    v_n := 2;
    if v_b then
      -- 鍵が同じ＝枚の行を続きの卓へ移す（同じ値・前の卓は行0）
      for c in select e.member_id, e.kind, e.value, e.version from mahjong.extras e where e.table_id = t.id order by e.member_id, e.kind collate "C" loop
        insert into mahjong.extras (table_id, member_id, kind, value, updated_by_user) values (v_id, c.member_id, c.kind, c.value, p_me);
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
          pg_catalog.jsonb_build_object('table_id', v_id, 'member_id', c.member_id, 'kind', c.kind), 'value', null, pg_catalog.to_jsonb(c.value), 1);
        delete from mahjong.extras e where e.table_id = t.id and e.member_id = c.member_id and e.kind = c.kind;
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
          pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', c.member_id, 'kind', c.kind), 'value', pg_catalog.to_jsonb(c.value), null, c.version + 1);
        v_n := v_n + 2;
      end loop;
    end if;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 2, 'hist', v_n, 't', v_id, 't2', t.id);

  -- ── 2c-2b 人の op 5つ（write4_sekkei.md §3＋v1.1 S1・S2＋v1.2 N3・N4）・役は mj_write の門が先に見た ──
  elsif v_op = 'member_link' then
    -- 本人＝いつも呼んだ人（user_id を引数に取らない）
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    select * into v_m from mahjong.members m where m.id = v_id and m.room_id = p_room for update;
    if not found or not v_m.active then perform mahjong_private.mj_w_bad(p_i, 'member_id'); end if;
    if v_m.user_id = p_me then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version), 'made', 0, 'hist', 0); end if;
    -- 自分が同じ部屋の別の人に既につながっている＝linked（先に member_unlink・同じ組に [unlink, link] で移れる）
    select m.id into v_id2 from mahjong.members m where m.room_id = p_room and m.user_id = p_me and m.id <> v_id;
    if found then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'linked', 'i', p_i, 'member_id', v_id2));
    end if;
    -- C2-0 §1d：他の人がつないだ人へ、同じ組に member_unlink が在る（移ろうとした）＝taken で組ごと戻す（link だけの組は今まで通り claimed）
    if v_m.user_id is not null and exists (select 1 from mahjong.history hx where hx.group_id = p_gid and hx.room_id = p_room and hx.op = 'member_unlink') then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'taken', 'i', p_i, 'member_id', v_id));
    end if;
    if v_m.user_id is not null then
      -- 他の人がつないだ人＝名乗りを1行残して ok（claimed・つないだ人の id は返さない＝v1.1 S2）・二度目は足さない・履歴なし
      if not exists (select 1 from mahjong.member_claims x where x.member_id = v_id and x.user_id = p_me) then
        -- 名乗りの数（部屋 200・1人 3）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）
        insert into mahjong.member_claims (room_id, member_id, user_id) values (p_room, v_id, p_me);
      end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version, 'claimed', true), 'made', 0, 'hist', 0);
    end if;
    update mahjong.members m set user_id = p_me, version = m.version + 1 where m.id = v_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_id), 'user_id',
      null, pg_catalog.to_jsonb(p_me::text), v_m.version + 1);
    -- つながった（N3）＝その人の分の名乗りを全部・その member の名乗りを全部消す
    delete from mahjong.member_claims x where x.member_id = v_id or (x.room_id = p_room and x.user_id = p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version + 1), 'made', 0, 'hist', 1);

  elsif v_op = 'member_unlink' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    select * into v_m from mahjong.members m where m.id = v_id and m.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'member_id'); end if;
    if v_m.user_id is null then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version), 'made', 0, 'hist', 0); end if;
    -- 本人か管（self_or_kan の「本人か」は対象を見て判じる）
    if v_m.user_id <> p_me and not mahjong_private.mj_w_is_kan(p_role) then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_role', 'i', p_i, 'need', 'kan'));
    end if;
    update mahjong.members m set user_id = null, version = m.version + 1 where m.id = v_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_id), 'user_id',
      pg_catalog.to_jsonb(v_m.user_id::text), null, v_m.version + 1);
    delete from mahjong.member_claims x where x.member_id = v_id;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version + 1), 'made', 0, 'hist', 1);

  elsif v_op = 'member_relink' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    select * into v_m from mahjong.members m where m.id = v_id and m.room_id = p_room for update;
    if not found or not v_m.active then perform mahjong_private.mj_w_bad(p_i, 'member_id'); end if;
    v_u := mahjong_private.mj_w_uuid(p_o, 'user_id', p_i);
    select x.owner_user_id into v_own from mahjong.rooms x where x.id = p_room;
    -- 付ける人＝部屋の持ち主（行が無い事がある）か、部屋に行が在る人・どちらも出した人は除く
    if not (coalesce(v_u = v_own, false) or exists (select 1 from mahjong.room_accounts a where a.room_id = p_room and a.user_id = v_u))
       or exists (select 1 from mahjong.room_bans b where b.room_id = p_room and b.user_id = v_u) then
      perform mahjong_private.mj_w_bad(p_i, 'user_id');
    end if;
    if v_m.user_id = v_u then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version), 'made', 0, 'hist', 0); end if;
    v_n := 1;
    -- 付け替え＝その人が同じ部屋の別の人につながっていれば先に外す（一意の索引 (room_id, user_id)）
    select * into v_m2 from mahjong.members m where m.room_id = p_room and m.user_id = v_u and m.id <> v_id for update;
    if found then
      update mahjong.members m set user_id = null, version = m.version + 1 where m.id = v_m2.id;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_m2.id), 'user_id',
        pg_catalog.to_jsonb(v_u::text), null, v_m2.version + 1);
      delete from mahjong.member_claims x where x.member_id = v_m2.id;
      v_n := 2;
    end if;
    update mahjong.members m set user_id = v_u, version = m.version + 1 where m.id = v_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_id), 'user_id',
      pg_catalog.to_jsonb(v_m.user_id::text), pg_catalog.to_jsonb(v_u::text), v_m.version + 1);
    -- その member の名乗りと、つながった人のその部屋の名乗りを消す（N3 と同じ）
    delete from mahjong.member_claims x where x.member_id = v_id or (x.room_id = p_room and x.user_id = v_u);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', v_m.version + 1), 'made', 0, 'hist', v_n);

  elsif v_op = 'role_set' then
    if pg_catalog.jsonb_typeof(p_o -> 'role') is distinct from 'string' or (p_o ->> 'role') not in ('kan', 'nyu') then
      perform mahjong_private.mj_w_bad(p_i, 'role');
    end if;
    v_u := mahjong_private.mj_w_uuid(p_o, 'user_id', p_i);
    select x.owner_user_id into v_own from mahjong.rooms x where x.id = p_room;
    -- 持ち主の役は変えない（K-3 で継ぐ）
    if v_u = v_own then perform mahjong_private.mj_w_bad(p_i, 'user_id'); end if;
    select a.role into v_s from mahjong.room_accounts a where a.room_id = p_room and a.user_id = v_u for update;
    if not found or exists (select 1 from mahjong.room_bans b where b.room_id = p_room and b.user_id = v_u) then
      perform mahjong_private.mj_w_bad(p_i, 'user_id');
    end if;
    if v_s = (p_o ->> 'role') then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 0); end if;
    -- 管の数 5（full admins）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）
    update mahjong.room_accounts a set role = p_o ->> 'role' where a.room_id = p_room and a.user_id = v_u;
    -- room_accounts に版の列は無い（2c-2e の戻しは「今の role ＝ after_value」で比べる＝v1.1 C3②）
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'room_accounts',
      pg_catalog.jsonb_build_object('room_id', p_room, 'user_id', v_u), 'role', pg_catalog.to_jsonb(v_s), p_o -> 'role', null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 1);

  elsif v_op = 'account_remove' then
    v_u := mahjong_private.mj_w_uuid(p_o, 'user_id', p_i);
    select x.owner_user_id into v_own from mahjong.rooms x where x.id = p_room;
    if v_u = v_own then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'user_id', 'reason', 'owner'));
    end if;
    select a.role, a.joined_via, a.joined_at into c from mahjong.room_accounts a where a.room_id = p_room and a.user_id = v_u for update;
    if not found then
      -- 行が無く出した印が在る＝二度押し（書かずに ok）・どちらも無い＝bad
      if exists (select 1 from mahjong.room_bans b where b.room_id = p_room and b.user_id = v_u) then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 0); end if;
      perform mahjong_private.mj_w_bad(p_i, 'user_id');
    end if;
    if c.role = 'kan' then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'user_id', 'reason', 'kan'));
    end if;
    -- その部屋のリーグの持ち主（取り消したリーグも＝v1.1 O2）＝先に league_owner_set
    if exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = v_u) then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'user_id', 'reason', 'league'));
    end if;
    -- 出した人の印 200（full room_bans）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）
    insert into mahjong.room_bans (room_id, user_id) values (p_room, v_u) on conflict (room_id, user_id) do nothing;
    delete from mahjong.room_accounts a where a.room_id = p_room and a.user_id = v_u;
    update mahjong.rooms x set channel_key = pg_catalog.encode(extensions.gen_random_bytes(16), 'hex') where x.id = p_room;   -- P1 §3：出した人の名を捨てる（account_remove）
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'room_accounts',
      pg_catalog.jsonb_build_object('room_id', p_room, 'user_id', v_u), null,
      pg_catalog.jsonb_build_object('role', c.role, 'joined_via', c.joined_via, 'joined_at', c.joined_at), null, null);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'room_bans',
      pg_catalog.jsonb_build_object('room_id', p_room, 'user_id', v_u), null, null, pg_catalog.jsonb_build_object('at', pg_catalog.now()), null);
    v_n := 2;
    -- その人につながった名簿の人を全部外す（v1 止め2・半荘は残る＝名前だけの人に戻る）
    for v_m2 in select * from mahjong.members m where m.room_id = p_room and m.user_id = v_u order by m.id for update loop
      update mahjong.members m set user_id = null, version = m.version + 1 where m.id = v_m2.id;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_m2.id), 'user_id',
        pg_catalog.to_jsonb(v_u::text), null, v_m2.version + 1);
      delete from mahjong.member_claims x where x.member_id = v_m2.id;
      v_n := v_n + 1;
    end loop;
    delete from mahjong.member_claims x where x.room_id = p_room and x.user_id = v_u;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', v_n);

  -- ── 2c-2c 部屋の op 4つ（write5_sadame.md v1.1・組の中で1つだけ＝mj_write ①）──
  elsif v_op = 'room_leave' then
    -- 持ち主なら K-3 で継ぐ（居ない＝alone）・持ち主でなければ自分が L のリーグを部屋の持ち主へ
    select x.owner_user_id into v_own from mahjong.rooms x where x.id = p_room;
    -- C2-1 §1a：抜けた印（この組の書きより前の history の最大 id）
    select coalesce(pg_catalog.max(hx.id), 0) into v_hid from mahjong.history hx where hx.room_id = p_room;
    v_n := 0;
    if v_own = p_me then
      v_n := mahjong_private.mj_w_inherit(p_room, p_gid, v_op, p_me, p_role, p_me);
      if v_n < 0 then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'op', 'reason', 'alone'));
      end if;
    else
      update mahjong.leagues l set owner_user_id = v_own, version = l.version + 1 where l.room_id = p_room and l.owner_user_id = p_me;
      if found then
        perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'leagues', pg_catalog.jsonb_build_object('room_id', p_room), 'owner_user_id',
          pg_catalog.to_jsonb(p_me::text), pg_catalog.to_jsonb(v_own::text), null);
        v_n := 1;
      end if;
    end if;
    -- 自分の外し（決めた事2・S3＝まとめ1行・S4＝member_id でも名乗りを消す）
    select a.role, a.joined_via, a.joined_at into c from mahjong.room_accounts a where a.room_id = p_room and a.user_id = p_me for update;
    delete from mahjong.room_accounts a where a.room_id = p_room and a.user_id = p_me;
    update mahjong.rooms x set channel_key = pg_catalog.encode(extensions.gen_random_bytes(16), 'hex') where x.id = p_room;   -- P1 §3：抜けた人の名を捨てる（room_leave）
    -- C2-1 §1a：つないだ名は外さない（抜けた人の名＝left）・自分の名乗りだけ消す（他の人が自分の名に名乗った行は残す）
    delete from mahjong.member_claims x where x.room_id = p_room and x.user_id = p_me;
    insert into mahjong.room_leaves (room_id, user_id, left_at, left_hist_id) values (p_room, p_me, pg_catalog.now(), v_hid)
      on conflict (room_id, user_id) do update set left_at = excluded.left_at, left_hist_id = excluded.left_hist_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'room_accounts',
      pg_catalog.jsonb_build_object('room_id', p_room, 'user_id', p_me), null,
      pg_catalog.jsonb_build_object('role', c.role, 'joined_via', c.joined_via, 'joined_at', c.joined_at, 'unlinked', 0), null, null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', v_n + 1);

  elsif v_op = 'room_delete' then
    -- もう消した部屋は ② が gone（on_deleted ×）
    update mahjong.rooms x set deleted_at = pg_catalog.now() where x.id = p_room;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'deleted_at',
      null, pg_catalog.to_jsonb(pg_catalog.now()), null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 1);

  elsif v_op = 'room_undelete' then
    -- 7日より前は ② が gone・消していない部屋は書かない
    -- 段C：組を比べない（平文のパスを持たない＝比べられない）。消した印の7日の shared も組を持つ（mj_pair_bf）ので戻しても同じ組が2つ開かない
    select x.deleted_at into s from mahjong.rooms x where x.id = p_room;
    if s.deleted_at is null then return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 0); end if;
    update mahjong.rooms x set deleted_at = null where x.id = p_room;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'deleted_at',
      pg_catalog.to_jsonb(s.deleted_at), null, null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 1);

  elsif v_op = 'room_secret' then
    -- 段C：部屋なしは bad kind（★パスを比べる前＝crypt に '!solo' を通さない★）
    select x.pass_hash, x.url_token_hash, x.kind, x.name_key into s from mahjong.rooms x where x.id = p_room;
    if s.kind <> 'shared' then perform mahjong_private.mj_w_bad(p_i, 'kind'); end if;
    -- 形（段C＝そろえた後に数字4つ）→ S1 の門（前と同じパス・今と同じ URL・他の部屋と同じ URL）＝どれも何も書かない
    if pg_catalog.jsonb_typeof(p_o -> 'pass') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'pass'); end if;
    v_key := mahjong_private.mj_pass_key(p_o ->> 'pass');
    if v_key is null or v_key !~ '^[0-9]{4}$' then perform mahjong_private.mj_w_bad(p_i, 'pass'); end if;
    v_s := case when pg_catalog.jsonb_typeof(p_o -> 'url_token_hash') = 'string' then p_o ->> 'url_token_hash' end;
    if v_s is null or v_s !~ '^[0-9a-f]{64}$' then perform mahjong_private.mj_w_bad(p_i, 'url_token_hash'); end if;
    -- よくあるパスの弾きは B0 で外した
    if extensions.crypt(v_key, s.pass_hash) = s.pass_hash then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'pass', 'reason', 'same'));
    end if;
    if v_s = s.url_token_hash then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'url_token_hash', 'reason', 'same'));
    end if;
    if exists (select 1 from mahjong.rooms x where x.url_token_hash = v_s and x.id <> p_room) then perform mahjong_private.mj_w_bad(p_i, 'url_token_hash'); end if;
    -- 段C §3 組の比べ（部屋の行 → totals を押さえて引き直し・下見で bf していない／変わった部屋だけ bf）
    perform 1 from mahjong.totals tt where tt.id = 1 for update;
    v_j := mahjong_private.mj_pair_bf(s.name_key, v_key, p_room, case when p_o -> '_pre' ->> 'nk' = s.name_key then p_o -> '_pre' -> 'seen' else '{}'::jsonb end, p_me);   -- ★room_secret の比べ★
    if (v_j ->> 'busy')::boolean then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'i', p_i, 'what', coalesce(v_j ->> 'what', 'name'))); end if;
    if (v_j ->> 'hit')::boolean then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'at', 'name_pass')); end if;
    v_kd := pg_catalog.encode(extensions.gen_random_bytes(16), 'hex');
    update mahjong.rooms x set pass_hash = extensions.crypt(v_key, extensions.gen_salt('bf', 10)), url_token_hash = v_s, channel_key = v_kd,
      last_secret_at = pg_catalog.now(), fail_count = 0, locked_until = null where x.id = p_room;
    -- 入の行を消す（L の行〔取り消したリーグも〕と管は残す）・消した入の名簿のつなぎを外す・名乗りを消す（S4）・出した印を全部消す
    select coalesce(pg_catalog.array_agg(a.user_id order by a.user_id), '{}') into v_us from mahjong.room_accounts a
     where a.room_id = p_room and a.role = 'nyu'
       and not exists (select 1 from mahjong.leagues l where l.room_id = p_room and l.owner_user_id = a.user_id);
    delete from mahjong.room_accounts a where a.room_id = p_room and a.user_id = any(v_us);
    select coalesce(pg_catalog.array_agg(m.id order by m.id), '{}') into v_ids from mahjong.members m where m.room_id = p_room and m.user_id = any(v_us);
    update mahjong.members m set user_id = null, version = m.version + 1 where m.id = any(v_ids);
    delete from mahjong.member_claims x where x.member_id = any(v_ids) or (x.room_id = p_room and x.user_id = any(v_us));
    delete from mahjong.room_bans b where b.room_id = p_room;
    get diagnostics v_x = row_count;
    -- ★履歴に pass・hash・channel_key を書かない★（S3＝まとめ2行・人の id の列は書かない）
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'secret', null, null, null);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'room_accounts', pg_catalog.jsonb_build_object('room_id', p_room), null, null,
      pg_catalog.jsonb_build_object('removed', pg_catalog.cardinality(v_us), 'unlinked', pg_catalog.cardinality(v_ids), 'unbanned', v_x), null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'channel_key', v_kd), 'made', 0, 'hist', 2);

  -- ── 段C の部屋の op 2つ（heya_mirutoki_sadame.md §4・v10.1 決まらない3）──
  elsif v_op = 'room_share' then
    -- 順＝kind（開いた部屋なしだけ）→ 形 → url（今と同じ・他の部屋と同じ）→ 名前の止め → totals を押さえて R−20・作るの数え 3つ → 組の比べ
    select x.kind, x.url_token_hash into s from mahjong.rooms x where x.id = p_room;
    if s.kind <> 'solo' then perform mahjong_private.mj_w_bad(p_i, 'kind'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_s := pg_catalog.btrim(p_o ->> 'name', c_trim);
    if pg_catalog.char_length(v_s) not between 1 and 40 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_rk := nullif(mahjong_private.mj_name_key(v_s), '');
    if v_rk is null then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'pass') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'pass'); end if;
    v_key := mahjong_private.mj_pass_key(p_o ->> 'pass');
    if v_key is null or v_key !~ '^[0-9]{4}$' then perform mahjong_private.mj_w_bad(p_i, 'pass'); end if;
    v_kd := case when pg_catalog.jsonb_typeof(p_o -> 'url_token_hash') = 'string' then p_o ->> 'url_token_hash' end;
    if v_kd is null or v_kd !~ '^[0-9a-f]{64}$' then perform mahjong_private.mj_w_bad(p_i, 'url_token_hash'); end if;
    if v_kd = s.url_token_hash then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', p_i, 'at', 'url_token_hash', 'reason', 'same'));
    end if;
    if exists (select 1 from mahjong.rooms x where x.url_token_hash = v_kd and x.id <> p_room) then perform mahjong_private.mj_w_bad(p_i, 'url_token_hash'); end if;
    if mahjong_private.mj_nfail_until(v_rk, p_me) is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'i', p_i, 'until', mahjong_private.mj_nfail_until(v_rk, p_me)));
    end if;
    -- 部屋の行 → totals（★新しく押さえる★）・1人の外れ24時間50（パスの守り＝残す）。作るの数え（1分5・24時間5）はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）
    select tt.rooms_all into v_n from mahjong.totals tt where tt.id = 1 for update;
    if mahjong_private.mj_day_until('join:ufail1d', p_me::text, 50) is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'i', p_i, 'what', 'user_day', 'until', mahjong_private.mj_day_until('join:ufail1d', p_me::text, 50)));
    end if;
    -- 組の比べ（押さえた後の引き直し）
    v_j := mahjong_private.mj_pair_bf(v_rk, v_key, p_room, case when p_o -> '_pre' ->> 'nk' = v_rk then p_o -> '_pre' -> 'seen' else '{}'::jsonb end, p_me);   -- ★引き直し★
    if (v_j ->> 'busy')::boolean then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'i', p_i, 'what', coalesce(v_j ->> 'what', 'name'))); end if;
    if (v_j ->> 'hit')::boolean then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'i', p_i, 'at', 'name_pass')); end if;
    v_s2 := pg_catalog.encode(extensions.gen_random_bytes(16), 'hex');
    update mahjong.rooms x set kind = 'shared', name = v_s, name_key = v_rk, pass_hash = extensions.crypt(v_key, extensions.gen_salt('bf', 10)),
      url_token_hash = v_kd, channel_key = v_s2, fail_count = 0, locked_until = null where x.id = p_room;
    update mahjong.totals set rooms_all = rooms_all + 1 where id = 1;
    -- ★履歴に pass・hash・channel_key を書かない★（名前だけ）
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'kind',
      pg_catalog.to_jsonb('solo'::text), pg_catalog.jsonb_build_object('kind', 'shared', 'name', v_s), null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'channel_key', v_s2), 'made', 0, 'hist', 1);

  elsif v_op = 'room_close' then
    -- 開いた shared だけ（部屋なし＝bad kind・終えた部屋は mj_write の閉じた門が bad closed）
    select x.kind, x.closed_at into s from mahjong.rooms x where x.id = p_room;
    if s.kind <> 'shared' then perform mahjong_private.mj_w_bad(p_i, 'kind'); end if;
    if s.closed_at is not null then perform mahjong_private.mj_w_bad(p_i, 'closed'); end if;
    perform 1 from mahjong.totals tt where tt.id = 1 for update;   -- 部屋の行 → totals
    update mahjong.rooms x set closed_at = pg_catalog.now(), name_key = null where x.id = p_room;
    update mahjong.totals set rooms_all = greatest(rooms_all - 1, 0) where id = 1;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'rooms', pg_catalog.jsonb_build_object('id', p_room), 'closed_at',
      null, pg_catalog.to_jsonb(pg_catalog.now()), null);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i), 'made', 0, 'hist', 1);
  end if;
  -- ── リーグの op（2c-2d1・write7_league_sadame_v11.md） ──
  if v_op = 'league_create' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'league_id', p_i);
    select x.room_id into v_r from mahjong.leagues x where x.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'league_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    if pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_s := pg_catalog.btrim(p_o ->> 'name', c_trim);
    if pg_catalog.char_length(v_s) not between 1 and 40 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    v_d := mahjong_private.mj_w_date(p_o, 'date_from', p_i);
    v_d2 := mahjong_private.mj_w_date(p_o, 'date_to', p_i);
    if v_d > v_d2 then perform mahjong_private.mj_w_bad(p_i, 'date_to'); end if;
    v_rk := 'pt';
    if p_o -> 'rank_by' is not null and p_o -> 'rank_by' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_o -> 'rank_by') <> 'string' or (p_o ->> 'rank_by') not in ('pt', 'avg_rank', 'avg_pt') then
        perform mahjong_private.mj_w_bad(p_i, 'rank_by');
      end if;
      v_rk := p_o ->> 'rank_by';
    end if;
    v_x := 0;
    if p_o -> 'min_games' is not null and p_o -> 'min_games' <> 'null'::jsonb then
      v_x := mahjong_private.mj_w_int(p_o, 'min_games', p_i);
      if v_x not between 0 and 9999 then perform mahjong_private.mj_w_bad(p_i, 'min_games'); end if;
    end if;
    if pg_catalog.jsonb_typeof(p_o -> 'players_main') is distinct from 'number' or (p_o ->> 'players_main') not in ('3', '4') then
      perform mahjong_private.mj_w_bad(p_i, 'players_main');
    end if;
    v_n := (p_o ->> 'players_main')::int;
    v_rules := mahjong_private.mj_w_rules(p_o -> 'rules', 'rules', p_i);
    if (v_rules ->> 'players')::int is distinct from v_n then perform mahjong_private.mj_w_bad(p_i, 'rules'); end if;
    v_ra := null;
    if p_o -> 'rules_alt' is not null and p_o -> 'rules_alt' <> 'null'::jsonb then
      v_ra := mahjong_private.mj_w_rules(p_o -> 'rules_alt', 'rules_alt', p_i);
      if (v_ra ->> 'players')::int is distinct from 7 - v_n then perform mahjong_private.mj_w_bad(p_i, 'rules_alt'); end if;
    end if;
    -- 人ごと24時間5本（too_many league_create）とその鍵はやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）
    v_ida := pg_catalog.gen_random_uuid();
    insert into mahjong.rule_sets (id, version, room_id, rules) values (v_ida, 1, p_room, v_rules);
    v_id2 := null;
    if v_ra is not null then
      v_id2 := pg_catalog.gen_random_uuid();
      insert into mahjong.rule_sets (id, version, room_id, rules) values (v_id2, 1, p_room, v_ra);
    end if;
    insert into mahjong.leagues (id, room_id, name, date_from, date_to, rank_by, min_games, players_main,
                                 rule_set_id, rule_version, rule_set_id_alt, rule_version_alt, owner_user_id, created_by)
      values (v_id, p_room, v_s, v_d, v_d2, v_rk, v_x, v_n, v_ida, 1, v_id2, case when v_id2 is null then null else 1 end, p_me, p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'leagues', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('name', v_s, 'date_from', v_d, 'date_to', v_d2, 'rank_by', v_rk, 'min_games', v_x, 'players_main', v_n,
        'alt', v_id2 is not null), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', case when v_id2 is null then 2 else 3 end, 'hist', 1);

  elsif v_op = 'league_save' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'league_id', p_i);
    select x.* into g from mahjong.leagues x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'league_id'); end if;
    perform mahjong_private.mj_w_role(p_room, v_op, v_id, null, p_me, p_role, p_i);   -- L・取り消したリーグ＝bad at league
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    -- 在る鍵だけ替える（session_edit と同じ・null で消せるのは date_from／date_to／rules_alt）・bad が conflict より先
    v_s := g.name;
    if p_o ? 'name' then
      if pg_catalog.jsonb_typeof(p_o -> 'name') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
      v_s := pg_catalog.btrim(p_o ->> 'name', c_trim);
      if pg_catalog.char_length(v_s) not between 1 and 40 then perform mahjong_private.mj_w_bad(p_i, 'name'); end if;
    end if;
    v_d := g.date_from; v_d2 := g.date_to;
    if p_o ? 'date_from' then v_d := mahjong_private.mj_w_date(p_o, 'date_from', p_i); end if;
    if p_o ? 'date_to' then v_d2 := mahjong_private.mj_w_date(p_o, 'date_to', p_i); end if;
    if v_d > v_d2 then perform mahjong_private.mj_w_bad(p_i, 'date_to'); end if;
    v_rk := g.rank_by;
    if p_o ? 'rank_by' then
      if pg_catalog.jsonb_typeof(p_o -> 'rank_by') is distinct from 'string' or (p_o ->> 'rank_by') not in ('pt', 'avg_rank', 'avg_pt') then
        perform mahjong_private.mj_w_bad(p_i, 'rank_by');
      end if;
      v_rk := p_o ->> 'rank_by';
    end if;
    v_x := g.min_games;
    if p_o ? 'min_games' then
      v_x := mahjong_private.mj_w_int(p_o, 'min_games', p_i);
      if v_x not between 0 and 9999 then perform mahjong_private.mj_w_bad(p_i, 'min_games'); end if;
    end if;
    v_rules := null;
    if p_o ? 'rules' then
      v_rules := mahjong_private.mj_w_rules(p_o -> 'rules', 'rules', p_i);
      if (v_rules ->> 'players')::int is distinct from g.players_main then perform mahjong_private.mj_w_bad(p_i, 'rules'); end if;
    end if;
    v_alt := p_o ? 'rules_alt'; v_ra := null;
    if v_alt and p_o -> 'rules_alt' <> 'null'::jsonb then
      v_ra := mahjong_private.mj_w_rules(p_o -> 'rules_alt', 'rules_alt', p_i);
      if (v_ra ->> 'players')::int is distinct from 7 - g.players_main then perform mahjong_private.mj_w_bad(p_i, 'rules_alt'); end if;
    end if;
    if v_bv <> g.version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('league_id', v_id, 'what', 'league'), 'cur', pg_catalog.jsonb_build_object('version', g.version)));
    end if;
    -- ルールの版（替えた時だけ同じ id の次の版・済んだ開催日／卓／半荘の版は変えない＝新しい開催日から効く）
    v_n := 0; v_rv := g.rule_version; v_ida := g.rule_set_id_alt; v_rva := g.rule_version_alt;
    if v_rules is not null and v_rules is distinct from (select r.rules from mahjong.rule_sets r where r.id = g.rule_set_id and r.version = g.rule_version) then
      select pg_catalog.max(r.version) + 1 into v_rv from mahjong.rule_sets r where r.id = g.rule_set_id;
      insert into mahjong.rule_sets (id, version, room_id, rules) values (g.rule_set_id, v_rv, p_room, v_rules);
      v_n := v_n + 1;
    end if;
    if v_alt then
      if v_ra is null then
        v_ida := null; v_rva := null;
      elsif v_ida is null then
        v_ida := pg_catalog.gen_random_uuid(); v_rva := 1;
        insert into mahjong.rule_sets (id, version, room_id, rules) values (v_ida, 1, p_room, v_ra);
        v_n := v_n + 1;
      elsif v_ra is distinct from (select r.rules from mahjong.rule_sets r where r.id = v_ida and r.version = v_rva) then
        select pg_catalog.max(r.version) + 1 into v_rva from mahjong.rule_sets r where r.id = v_ida;
        insert into mahjong.rule_sets (id, version, room_id, rules) values (v_ida, v_rva, p_room, v_ra);
        v_n := v_n + 1;
      end if;
    end if;
    v_j := pg_catalog.jsonb_build_object('name', g.name, 'date_from', g.date_from, 'date_to', g.date_to, 'rank_by', g.rank_by, 'min_games', g.min_games,
      'rule_version', g.rule_version, 'rule_set_id_alt', g.rule_set_id_alt, 'rule_version_alt', g.rule_version_alt);
    v_j2 := pg_catalog.jsonb_build_object('name', v_s, 'date_from', v_d, 'date_to', v_d2, 'rank_by', v_rk, 'min_games', v_x,
      'rule_version', v_rv, 'rule_set_id_alt', v_ida, 'rule_version_alt', v_rva);
    if v_j = v_j2 then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', g.version), 'made', 0, 'hist', 0);
    end if;
    update mahjong.leagues x set name = v_s, date_from = v_d, date_to = v_d2, rank_by = v_rk, min_games = v_x,
      rule_version = v_rv, rule_set_id_alt = v_ida, rule_version_alt = v_rva, version = x.version + 1 where x.id = v_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'leagues', pg_catalog.jsonb_build_object('id', v_id), null, v_j, v_j2, g.version + 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', g.version + 1), 'made', v_n, 'hist', 1);

  elsif v_op = 'league_owner_set' then
    -- 押せるのは部屋の持ち主（③'・入り直し10分）＝L を自分に。もう自分＝書かない
    v_id := mahjong_private.mj_w_uuid(p_o, 'league_id', p_i);
    select x.* into g from mahjong.leagues x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'league_id'); end if;
    if g.owner_user_id = p_me then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', g.version), 'made', 0, 'hist', 0);
    end if;
    update mahjong.leagues x set owner_user_id = p_me, version = x.version + 1 where x.id = v_id;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'leagues', pg_catalog.jsonb_build_object('id', v_id), 'owner_user_id',
      pg_catalog.to_jsonb(g.owner_user_id::text), pg_catalog.to_jsonb(p_me::text), g.version + 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', g.version + 1), 'made', 0, 'hist', 1);
  end if;
  raise exception 'mj_write: 当て方の無い op %', v_op;
end $fn$;
revoke all on function mahjong_private.mj_w_op(uuid, uuid, text, uuid, int, jsonb) from public, anon, authenticated;

-- ── 入口3本目：書く ──
-- 返し：{ok:true, results:[{i, v?, claimed?}]} ／ {ok:false, err:'mj_session'｜'bad'｜'too_many'｜'not_yet'｜'gone'｜'mj_op_other_user'｜'mj_role'（i・need）｜'mj_reauth'（within_min・i）｜'linked'（i・member_id）｜
--   'busy'（what＝越えた窓・lock）｜'conflict'（i・at・cur）｜'range'｜'dup'｜'full'（what＝表）｜'internal', …}
create or replace function public.mj_write(p_room_id uuid, p_op_id uuid, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c_keys constant jsonb := '{
    "member_add": ["member_id", "name"],
    "session_add": ["session_id", "date", "rate", "place", "league_id"],
    "table_add": ["table_id", "session_id", "label", "alt"],
    "hanchan_start": ["hanchan_id", "table_id", "seats", "cells", "ton_order", "lost", "tobi_to", "follow", "seen_cells", "seen_n"],
    "hanchan_order": ["hanchan_id", "ton_order", "base_version", "seen_cells", "seen_seats"],
    "cell_set": ["hanchan_id", "seat", "value", "base_version"],
    "tobi_set": ["hanchan_id", "tobi_to", "base_version"],
    "kyotaku_set": ["hanchan_id", "value", "base_version"],
    "extra_add": ["table_id", "member_id", "kind", "add", "follow"],
    "settle_snap": ["session_id", "rev", "content", "used", "missing"],
    "hanchan_void": ["hanchan_id"],
    "hanchan_unvoid": ["hanchan_id"],
    "member_rename": ["member_id", "name"],
    "member_active": ["member_id", "active"],
    "session_edit": ["session_id", "date", "place", "rate", "voided"],
    "table_edit": ["table_id", "label", "rate_mode", "rate", "voided"],
    "hanchan_seats": ["hanchan_id", "seats"],
    "table_seats": ["table_id", "seats"],
    "extra_set": ["table_id", "member_id", "kind", "value", "base_version"],
    "table_rules": ["table_id", "new_table_id", "rules"],
    "member_link": ["member_id"],
    "member_unlink": ["member_id"],
    "member_relink": ["member_id", "user_id"],
    "role_set": ["user_id", "role"],
    "account_remove": ["user_id"],
    "room_leave": [],
    "room_delete": [],
    "room_undelete": [],
    "room_secret": ["pass", "url_token_hash"],
    "room_share": ["name", "pass", "url_token_hash"],
    "room_close": [],
    "league_create": ["league_id", "name", "date_from", "date_to", "rank_by", "min_games", "players_main", "rules", "rules_alt"],
    "league_save": ["league_id", "base_version", "name", "date_from", "date_to", "rank_by", "min_games", "rules", "rules_alt"],
    "league_owner_set": ["league_id"]}'::jsonb;
  v_me uuid; v_role text; v_ret jsonb; v_o jsonb; v_x jsonb; v_name text; v_k text; v_uid uuid; v_i int; v_len int;
  v_n int := 0; v_made int := 0; v_items jsonb := '[]'::jsonb; v_gid uuid := pg_catalog.gen_random_uuid();
  v_b0 jsonb := '{}'::jsonb; v_hs jsonb := '{}'::jsonb; v_fresh jsonb := '{}'::jsonb; v_ts jsonb := '{}'::jsonb;
  v_cap int; v_c bigint; v_hid text;
  v_ei jsonb := '{}'::jsonb; v_f0 boolean; v_mk boolean; e record; v_ch uuid[];
  v_who text; v_re text; v_need text; v_ra boolean; v_wl text; v_lg record;
  v_pre jsonb; v_op0 text;
  v_rv bigint; v_ch0 text; v_ch1 text;   -- 2c-2f：送る版・組の頭の合図の名・ok の後の合図の名
  v_w int := 0;   -- P9 §1.2：窓に足す重み（戻った組は 0）
  r record;
begin
  -- ⓪ 人（数えない）
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;

  -- ① 形（行は読まない）＝弾きは u1m に1
  if p_room_id is null then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_id');
  elsif p_op_id is null then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'op_id');
  elsif p_ops is null or pg_catalog.jsonb_typeof(p_ops) <> 'array' or pg_catalog.jsonb_array_length(p_ops) = 0 then
    v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'ops');
  elsif pg_catalog.jsonb_array_length(p_ops) > 30 then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'too_many');
  else
    v_len := pg_catalog.jsonb_array_length(p_ops);
    for v_i in 0 .. v_len - 1 loop
      v_o := p_ops -> v_i;
      if pg_catalog.jsonb_typeof(v_o) <> 'object' or pg_catalog.jsonb_typeof(v_o -> 'op') is distinct from 'string' then
        v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', v_i, 'at', 'op'); exit;
      end if;
      v_name := v_o ->> 'op';
      if not exists (select 1 from mahjong.mj_ops m where m.name = v_name) then
        v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', v_i, 'at', 'op'); exit;
      end if;
      if not (c_keys ? v_name) then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'not_yet', 'i', v_i); exit; end if;
      -- 2c-2c 決めた事1：部屋の op は組の中で1つだけ（他の op と混ぜない）
      if v_len > 1 and v_name in ('room_leave', 'room_delete', 'room_undelete', 'room_secret', 'room_share', 'room_close') then
        v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', v_i, 'at', 'op'); exit;
      end if;
      select t.k into v_k from pg_catalog.jsonb_object_keys(v_o) t(k) where t.k <> 'op' and not ((c_keys -> v_name) ? t.k) order by t.k limit 1;
      if v_k is not null then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', v_i, 'at', v_k); exit; end if;
    end loop;
  end if;
  if v_ret is not null then perform mahjong_private.mj_w_count(null, v_me, null, 0); return v_ret; end if;
  v_op0 := p_ops -> 0 ->> 'op';

  -- ①' 段C §3 組の比べの下見（room_share・room_secret＝★部屋の行を押さえる前に bf★・持ち主か管でなければ下見しない）
  if v_op0 in ('room_share', 'room_secret') then
    begin
      v_pre := mahjong_private.mj_pair_pre(p_room_id, v_me, p_ops -> 0);
    exception when others then
      v_pre := null;
    end;
  end if;

  -- ② 部屋（同じ文で押さえる＝同じ部屋の書き込みは1列に並ぶ）
  select x.id, x.owner_user_id, x.deleted_at, x.row_count, x.history_count, x.kind, x.closed_at into r
    from mahjong.rooms x where x.id = p_room_id for no key update;
  if not found then
    perform mahjong_private.mj_w_count(null, v_me, null, 0);
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone');
  end if;
  if r.owner_user_id = v_me then
    v_role := 'owner';
  else
    select a.role into v_role from mahjong.room_accounts a where a.room_id = p_room_id and a.user_id = v_me;
    if v_role is not null and exists (select 1 from mahjong.room_bans b where b.room_id = p_room_id and b.user_id = v_me) then v_role := null; end if;
  end if;
  -- K-3 段1（2c-2c）＝持ち主のアカウントが消えていたら、部屋に居る人の呼びで継ぐ（履歴・同じ group_id・塊の外＝この呼びが弾かれても継ぎは残る）
  if v_role is not null and not exists (select 1 from auth.users u where u.id = r.owner_user_id) then
    v_n := mahjong_private.mj_w_inherit(p_room_id, v_gid, 'owner_inherit', v_me, v_role, r.owner_user_id);
    if v_n < 0 then
      -- 呼んだ人が居るので起きない見立て（守り）＝消した部屋にして gone
      update mahjong.rooms x set deleted_at = coalesce(x.deleted_at, pg_catalog.now()) where x.id = p_room_id;
      perform mahjong_private.mj_w_count(null, v_me, null, 0);
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone');
    end if;
    update mahjong.rooms x set history_count = x.history_count + v_n, read_ver = x.read_ver + 1 where x.id = p_room_id
      returning x.read_ver, x.channel_key into v_rv, v_ch1;   -- 2d：持ち主が変わる＝読む側の owner・role も変わる
    perform mahjong_private.mj_w_signal(v_ch1, v_rv);   -- 2c-2f §1 K-3 の継ぎ（塊の外＝継ぎと一緒に残る）
    select x.id, x.owner_user_id, x.deleted_at, x.row_count, x.history_count, x.kind, x.closed_at into r from mahjong.rooms x where x.id = p_room_id;
    if r.owner_user_id = v_me then v_role := 'owner'; end if;
    v_n := 0;
  end if;
  -- 2c-2d1（write7 v1.1）消えた L の継ぎ＝K-3 段1の後・塊の外：L のアカウントが消えたリーグ（取り消しも）を部屋の持ち主へ・1リーグ1行の履歴・同じ group_id
  if v_role is not null then
    for v_lg in select l.id, l.owner_user_id, l.version from mahjong.leagues l
                 where l.room_id = p_room_id and l.owner_user_id <> r.owner_user_id
                   and not exists (select 1 from auth.users u where u.id = l.owner_user_id)
                 order by l.id for update loop
      update mahjong.leagues l set owner_user_id = r.owner_user_id, version = l.version + 1 where l.id = v_lg.id;
      perform mahjong_private.mj_w_hist(p_room_id, v_gid, 'league_inherit', v_me, v_role, 'leagues', pg_catalog.jsonb_build_object('id', v_lg.id),
        'owner_user_id', pg_catalog.to_jsonb(v_lg.owner_user_id::text), pg_catalog.to_jsonb(r.owner_user_id::text), v_lg.version + 1);
      v_n := v_n + 1;
    end loop;
    if v_n > 0 then
      update mahjong.rooms x set history_count = x.history_count + v_n where x.id = p_room_id;
      r.history_count := r.history_count + v_n;
      v_n := 0;
    end if;
  end if;
  if v_role is null or r.deleted_at < pg_catalog.now() - interval '7 days'
     or (r.deleted_at is not null and exists (select 1 from pg_catalog.jsonb_array_elements(p_ops) t(o)
                                               join mahjong.mj_ops m on m.name = t.o ->> 'op' where not m.on_deleted)) then
    perform mahjong_private.mj_w_count(null, v_me, null, 0);
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone');
  end if;
  update mahjong.room_accounts a set last_seen = pg_catalog.now()
   where a.room_id = p_room_id and a.user_id = v_me and a.last_seen < pg_catalog.now() - interval '1 hour';

  -- ③ op_id（送り直し＝書かずに同じ答え・別の人の op_id は返さない＝K-7）
  select o.result, o.user_id into v_x, v_uid from mahjong.op_results o where o.room_id = p_room_id and o.op_id = p_op_id;
  if found then
    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
    if v_uid is distinct from v_me then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_op_other_user'); end if;
    -- 2c-2c S2：room_secret・room_share（段C v10.2）の答え（op 名で決める）は channel_key を今の rooms から読み直して足す・もう役が足りなければ役で止める
    if v_op0 in ('room_secret', 'room_share') and (v_x ->> 'ok') = 'true' then
      v_need := mahjong_private.mj_w_need((select m.who_plain from mahjong.mj_ops m where m.name = v_op0), v_role);
      if v_need is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_role', 'i', 0, 'need', v_need); end if;
      return pg_catalog.jsonb_set(v_x, '{results,0,channel_key}', pg_catalog.to_jsonb((select x.channel_key from mahjong.rooms x where x.id = p_room_id)));
    end if;
    return v_x;
  end if;

  -- ③' 役の門（2c-2b・write4_sekkei.md §1）＝送り直しの後・先見の前・塊の外（例外を出さない字）・組のどれか1つでも足りなければ全部を当てない
  --   2c-2d1：ここで見るのは who_league が same か who_plain と同じ op だけ。他は op の中で対象が分かった所で mj_w_role（同じ組で作った開催日も見える）
  for v_i in 0 .. v_len - 1 loop
    select m.who_plain, m.who_league into v_who, v_wl from mahjong.mj_ops m where m.name = p_ops -> v_i ->> 'op';
    v_need := case when v_wl = 'same' or v_wl = v_who then mahjong_private.mj_w_need(v_who, v_role) end;
    if v_need is not null then
      perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_role', 'i', v_i, 'need', v_need);
    end if;
  end loop;
  -- ③'' 入り直しの門（K-6・§2）＝役の門の後（役が足りない人に「入り直して」と言わない）・re＝yes いつも／owner 持ち主の時／grant 役を付ける時（role_set の role kan）
  for v_i in 0 .. v_len - 1 loop
    select m.re into v_re from mahjong.mj_ops m where m.name = p_ops -> v_i ->> 'op';
    if v_re = 'yes' or (v_re = 'owner' and v_role = 'owner')
       or (v_re = 'grant' and (p_ops -> v_i ->> 'op') = 'role_set' and (p_ops -> v_i ->> 'role') is not distinct from 'kan')
       or v_re not in ('no', 'yes', 'owner', 'grant') then
      if v_ra is null then v_ra := mahjong_private.mj_w_reauth_ok(); end if;
      if not v_ra then
        perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
        return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_reauth', 'within_min', 10, 'i', v_i);
      end if;
    end if;
  end loop;

  -- ④' 段C §3 room_secret は1部屋1日3回（secret:r1d・key＝room_id）＝4回目は busy what secret（塊の外・数えない）
  if v_op0 = 'room_secret' and (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l
       where l.kind = 'secret:r1d' and l.key = p_room_id::text and l.window_start > pg_catalog.now() - interval '24 hours') >= 3 then
    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'secret');
  end if;

  -- ④ 先見（越えるなら何も書かない）
  v_k := mahjong_private.mj_w_over(p_room_id, v_me, v_role, 1, 1);
  if v_k is not null then
    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', v_k);
  end if;

  -- ⑤ 塊（副取引）
  begin
    select x.channel_key into v_ch0 from mahjong.rooms x where x.id = p_room_id;   -- 2c-2f：組の頭の合図の名（room_secret・room_share で変わる）
    -- 段C §4 終えた shared で通る op＝room_leave・room_export・room_delete・room_undelete だけ（他は塊ごと bad closed）
    if r.closed_at is not null and exists (select 1 from pg_catalog.jsonb_array_elements(p_ops) t(o)
                                            where (t.o ->> 'op') not in ('room_leave', 'room_export', 'room_delete', 'room_undelete')) then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'at', 'closed'));
    end if;
    for v_i in 0 .. v_len - 1 loop
      v_o := p_ops -> v_i;
      if v_i = 0 and v_pre is not null then v_o := v_o || pg_catalog.jsonb_build_object('_pre', v_pre); end if;   -- 下見の答え（倉庫の中だけ・① の鍵の門の後）
      -- 組の初めの飛んだ席（その半荘を初めて触る前に取る）
      v_hid := v_o ->> 'hanchan_id';
      if v_hid is not null and v_hid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_hid := pg_catalog.lower(v_hid);
        if not (v_b0 ? v_hid) and exists (select 1 from mahjong.hanchans x where x.id = v_hid::uuid and x.room_id = p_room_id) then
          v_b0 := v_b0 || pg_catalog.jsonb_build_object(v_hid, mahjong_private.mj_w_busted(v_hid::uuid));
        end if;
      end if;
      v_x := mahjong_private.mj_w_op(p_room_id, v_me, v_role, v_gid, v_i, v_o);
      v_items := v_items || pg_catalog.jsonb_build_array(v_x -> 'r');
      v_made := v_made + (v_x ->> 'made')::int;
      v_n := v_n + (v_x ->> 'hist')::int;
      if v_x ? 'h' then v_hs := v_hs || pg_catalog.jsonb_build_object(v_x ->> 'h', true); end if;
      if v_x ? 'fresh' then v_fresh := v_fresh || pg_catalog.jsonb_build_object(v_x ->> 'h', true); end if;
      if v_x ? 't' then v_ts := v_ts || pg_catalog.jsonb_build_object(v_x ->> 't', true); end if;
      if v_x ? 't2' then v_ts := v_ts || pg_catalog.jsonb_build_object(v_x ->> 't2', true); end if;   -- C4 table_rules＝前の卓も出し直す
      if v_x ? 'ek' then v_ei := v_ei || pg_catalog.jsonb_build_object((v_x -> 'ek')::text, v_i); end if;
    end loop;

    -- 組の終わりの出し直し（§4）：飛びの古い受け取り → 半荘のそろった → 卓のチップ・祝儀
    for v_k in select t.k from pg_catalog.jsonb_object_keys(v_hs) t(k) order by t.k loop
      if not (v_fresh ? v_k) and v_b0 ? v_k then
        v_n := v_n + mahjong_private.mj_w_tobi_fix(p_room_id, v_gid, v_me, v_role, v_k::uuid, v_b0 -> v_k);
      end if;
      perform mahjong_private.mj_w_hstate(v_k::uuid);
    end loop;
    -- C4 §3a（c4_sadame v3.3 T2）正味の門（v1510:195①）は鎖ごと・人と種ごと：鎖＝next_table_id でつながる卓の全部（区切っていない卓は自分1つ＝今と同じ）。
    --   行ごとに b（組の前＝最初の before）・a（組の後＝最後の after）→ 人と種で B＝sum(b)（全部 null なら null）・A＝sum(coalesce(a,0))。
    --   ルールの区切りで行を移しても合計は変わらない＝通る。席＝鎖のどれかの卓の取り消していない半荘の seats か tables.seats。
    --   鎖の頭の字順（C）→ kind → member_id の順に見る（lib と同じ i）
    --   ★「order by 1 collate "C"」は列の番号でなく整数 1 の式になり全部の書きが internal（42804）＝字の列に名を付けて外で並べる★
    for v_k in select hd.x from (select distinct (mahjong_private.mj_w_chain(t.k::uuid))[1]::text as x from pg_catalog.jsonb_object_keys(v_ts) t(k)) hd
               order by hd.x collate "C" loop
      v_ch := mahjong_private.mj_w_chain(v_k::uuid);
      for e in select q.m, q.kd, pg_catalog.sum(q.b) as b, pg_catalog.sum(coalesce(q.a, 0)) as a, pg_catalog.max(q.i) as i
                 from (select h.row_key ->> 'member_id' as m, h.row_key ->> 'kind' as kd,
                              ((pg_catalog.array_agg(h.before_value order by h.id))[1])::int as b,
                              ((pg_catalog.array_agg(h.after_value order by h.id desc))[1])::int as a,
                              coalesce((v_ei ->> (h.row_key::text))::int, 0) as i
                         from mahjong.history h
                        where h.group_id = v_gid and h.room_id = p_room_id and h.kind = 'row' and h.tbl = 'extras'
                          and (h.row_key ->> 'table_id')::uuid = any (v_ch)
                        group by h.row_key) q
                group by q.m, q.kd order by q.kd collate "C", q.m collate "C" loop
        if not exists (select 1 from mahjong.hanchans x where x.table_id = any (v_ch) and not x.voided
                         and exists (select 1 from pg_catalog.jsonb_each_text(x.seats) s where s.value = e.m))
           and not exists (select 1 from mahjong.tables y, pg_catalog.jsonb_array_elements_text(y.seats) s
                            where y.id = any (v_ch) and s.value = e.m)
           and (e.b is null or pg_catalog.abs(e.a) > pg_catalog.abs(e.b) or e.a * e.b < 0) then
          perform mahjong_private.mj_w_bad(e.i, 'member_id');
        end if;
      end loop;
    end loop;
    for v_k in select t.k from pg_catalog.jsonb_object_keys(v_ts) t(k) order by t.k loop
      -- 2c-2a1：組の前の「一度そろった」（tstate の前に読む）＝first_complete_at か前の組の締め（made_at < now()）
      v_f0 := mahjong_private.mj_w_tf0(v_k::uuid);
      v_mk := false;
      -- この組の extras の行ごとに 組の前 b（一番先の行の前の値・null＝行が無かった）と 組の後 a（一番後の行の後の値）＝history.id 順
      for e in select h.row_key, (pg_catalog.array_agg(h.before_value order by h.id))[1] as b,
                      (pg_catalog.array_agg(h.after_value order by h.id desc))[1] as a
                 from mahjong.history h
                where h.group_id = v_gid and h.room_id = p_room_id and h.kind = 'row' and h.tbl = 'extras'
                  and h.row_key ->> 'table_id' = v_k
                group by h.row_key order by h.row_key::text collate "C" loop   -- 字順は C（写しの JS の < と同じ・既定の照合だと ':' を飛ばして c:ko と chip が入れ替わる＝2c-3b N2）
        -- 正味の門は上の鎖の loop へ移した（C4 §3a）
        if coalesce((e.b)::int, 0) <> (e.a)::int then v_mk := true; end if;
      end loop;
      if v_f0 and v_mk then perform mahjong_private.mj_w_tchanged(v_k::uuid, v_me); end if;
      perform mahjong_private.mj_w_tstate(v_k::uuid);
    end loop;

    -- H1'（h1b_sadame v2）：対局の記録に上限を置かない＝P・F・日・卓・半荘・リーグ・ルールの門は無い（行は全部残す・人の上限 members だけ下の輪で見る）
    -- ↑の members の輪もやめた（caps v1.1・司さん 11-27「上限いらん・リリースは課金の塩梅で決める」）

    -- 部屋の数え
    if v_n > 0 then
      update mahjong.rooms x set row_count = x.row_count + v_made, history_count = x.history_count + v_n, last_write_at = pg_catalog.now()
       where x.id = p_room_id;
    end if;

    -- P9 §1.2（p2p9 §3.2）重み＝max(この組の history の行, ceil(大きさ ÷ 1,024))。大きさ＝行の before・after の字の長さ、締めの行は content・used・missing の長さ
    --   （締めの門の 32,768 と同じ量り＝32KB の締め 1つ＝32）。正直な組（数行・数百B）は行の数のまま
    if v_n > 0 then
      select greatest(v_n, pg_catalog.ceil(coalesce(pg_catalog.sum(case when h.tbl = 'settle_snaps' then
               coalesce((select pg_catalog.octet_length(z.content::text) + pg_catalog.octet_length(z.used::text) + pg_catalog.octet_length(z.missing::text)
                           from mahjong.settle_snaps z where z.session_id = (h.row_key ->> 'session_id')::uuid and z.rev = (h.row_key ->> 'rev')::int), 0)
             else coalesce(pg_catalog.octet_length(h.before_value::text), 0) + coalesce(pg_catalog.octet_length(h.after_value::text), 0) end), 0) / 1024.0)::int)
        into v_w from mahjong.history h where h.group_id = v_gid;
    end if;
    -- 後見（実の履歴の重みで）
    v_k := mahjong_private.mj_w_over(p_room_id, v_me, v_role, greatest(1, v_w), v_w);
    if v_k is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', v_k));
    end if;

    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);
    -- 2d §1：読む口の版＝ok で返る組は全部 +1（書かなかった組も＝余分な読みは害が無い・塊の中＝弾かれた組は戻る）
    -- P2 §1.6：組に tbl が hanchans・sessions・tables の履歴の行が在る時だけ ns_ver＝新しい read_ver（同じ文＝x.read_ver は前の値）
    update mahjong.rooms x set read_ver = x.read_ver + 1,
           ns_ver = case when exists (select 1 from mahjong.history h where h.group_id = v_gid and h.room_id = p_room_id and h.tbl in ('hanchans', 'sessions', 'tables'))
                         then x.read_ver + 1 else x.ns_ver end
     where x.id = p_room_id returning x.read_ver, x.channel_key into v_rv, v_ch1;
    -- P2 §1.1：この組の履歴の行が触った日（開催）の day_ver＝新しい read_ver（同じ塊＝弾かれた組は戻る）
    --   開催の引き方＝sessions・settle_snaps は鍵そのもの／tables・extras は卓から／hanchans・cells は半荘の卓から（他の tbl は日を持たない）
    update mahjong.sessions s set day_ver = v_rv
     where s.room_id = p_room_id and s.id in (
       select case h.tbl
                when 'sessions'     then (h.row_key ->> 'id')::uuid
                when 'settle_snaps' then (h.row_key ->> 'session_id')::uuid
                when 'tables'       then (select t.session_id from mahjong.tables t where t.id = (h.row_key ->> 'id')::uuid)
                when 'extras'       then (select t.session_id from mahjong.tables t where t.id = (h.row_key ->> 'table_id')::uuid)
                when 'hanchans'     then (select t.session_id from mahjong.hanchans z join mahjong.tables t on t.id = z.table_id where z.id = (h.row_key ->> 'id')::uuid)
                when 'cells'        then (select t.session_id from mahjong.hanchans z join mahjong.tables t on t.id = z.table_id where z.id = (h.row_key ->> 'hanchan_id')::uuid)
              end
         from mahjong.history h
        where h.group_id = v_gid and h.room_id = p_room_id and h.tbl in ('sessions', 'settle_snaps', 'tables', 'extras', 'hanchans', 'cells'));
    v_ret := v_ret || pg_catalog.jsonb_build_object('read_ver', v_rv);   -- 2c-2f v1.2：書いた端末が合図に載せる版
    perform mahjong_private.mj_w_signal(v_ch0, v_rv);   -- 2c-2f §1 控えの送り（塊の中＝組が戻れば合図も出ない）
    if v_ch1 is distinct from v_ch0 then perform mahjong_private.mj_w_signal(v_ch1, v_rv); end if;   -- room_secret・room_share＝古い名と新しい名の両方
    -- 送り直しの答え（履歴の行を書いた組だけ・部屋で cap を越えたら古い物から消す＝full にしない）
    if v_n > 0 then
      insert into mahjong.op_results (room_id, op_id, result, user_id) values (p_room_id, p_op_id,
        case when v_op0 in ('room_secret', 'room_share') then pg_catalog.jsonb_set(v_ret, '{results,0}', (v_ret #> '{results,0}') - 'channel_key') else v_ret end, v_me);   -- 2c-2c S2・段C v10.2
      select m.cap into v_cap from mahjong.mj_caps m where m.tbl = 'op_results' and m.scope = 'room';
      if v_cap is null then perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'op_results')); end if;
      select pg_catalog.count(*) into v_c from mahjong.op_results o where o.room_id = p_room_id;
      if v_c > v_cap then
        delete from mahjong.op_results z where z.ctid = any(array(
          select o.ctid from mahjong.op_results o where o.room_id = p_room_id and o.op_id <> p_op_id order by o.at, o.op_id limit v_c - v_cap));
      end if;
    end if;
  exception
    when sqlstate 'MJ001' then
      v_ret := sqlerrm::jsonb; v_n := 0; v_w := 0;
    when deadlock_detected or lock_not_available or serialization_failure then
      v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'lock'); v_n := 0; v_w := 0;
    when others then
      raise log 'mj_write internal % %', sqlstate, sqlerrm;
      v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0; v_w := 0;
  end;

  -- ⑥ 数え（塊の外＝戻らない・limits は一番最後・(kind,key) の字の順＝join:nfail1h → secret:r1d → write:*）
  --   段C §3：room_share の dup name_pass＝名前の止め +1／room_secret の ok と dup name_pass＝secret:r1d +1（塊が戻っても残る）
  if v_op0 = 'room_share' and (v_ret ->> 'err') = 'dup' and (v_ret ->> 'at') = 'name_pass' then
    perform mahjong_private.mj_nfail_add(nullif(mahjong_private.mj_name_key(pg_catalog.btrim(p_ops -> 0 ->> 'name', ' ' || chr(9) || chr(10) || chr(13) || chr(12288))), ''), v_me);   -- ★room_share の dup の数え★
    perform mahjong_private.mj_lim_add('join:ufail1d', v_me::text, pg_catalog.date_trunc('hour', pg_catalog.now()), pg_catalog.now() - interval '24 hours', 1);   -- P3 [S2]：dup も1人の当て推量の24時間50に数える
  end if;
  if v_op0 = 'room_secret' and ((v_ret ->> 'ok') = 'true' or ((v_ret ->> 'err') = 'dup' and (v_ret ->> 'at') = 'name_pass')) then
    delete from mahjong.limits l where l.kind = 'secret:r1d' and l.key = p_room_id::text and l.window_start <= pg_catalog.now() - interval '24 hours';
    insert into mahjong.limits (kind, key, window_start, count) values ('secret:r1d', p_room_id::text, pg_catalog.date_trunc('hour', pg_catalog.now()), 1)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
  end if;
  perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_w);
  return v_ret;
end $fn$;
revoke all on function public.mj_write(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mj_write(uuid, uuid, jsonb) to authenticated;

-- P2 §1.2〜1.5（p2_sadame v5.1）：リーグの v3 の1頁＝★stable＝中の文は全部、呼んだ文の写真を見る★（read_ver・days・中身が同じ写真＝v5.1 §1.3「同じ1つの select 文」）
--   返す日＝p_since が在れば day_ver > p_since の日・無ければ全部、を (created_at, id) の順に p_after_s・p_after_t より後から。
--   1頁は 512KB の天井：卓を単位に足す（1つの卓が越える時はその卓だけ）。届いたら more true と next_after（返した最後の開催 id・卓 id＝卓の無い日は null）。
--   開催の行と締めはその日の最初の頁に・extras はその卓と一緒に。締めは全部の rev の行（settles.length が rev）・中身はその日の最後の rev だけ（他は content {}・used と missing null）。
--   st の形は今のまま（v 2・卓の rules を埋める＝roomGate がそのまま通る）。返し＝{read_ver, days, more, st, next_after?}｜{bad:'after'}
-- C2-0 §1a：p_me（呼んだ人）を足した＝members に me／taken（user_id は返さない）。前の5つの引数の形は消す
drop function if exists mahjong_private.mj_r_league3(uuid, uuid, bigint, uuid, uuid);
create or replace function mahjong_private.mj_r_league3(p_room uuid, p_lid uuid, p_since bigint, p_after_s uuid, p_after_t uuid, p_me uuid) returns jsonb
language plpgsql stable set search_path = '' as $fn$
declare
  c_cap constant int := 524288;
  v_rv bigint; v_days jsonb; v_mem jsonb; v_ac timestamptz; v_tc timestamptz; v_own uuid;
  d record; t record; v_cont boolean; v_head boolean; v_hj jsonb; v_hs jsonb; v_hsz int := 0;
  v_tj jsonb; v_hh jsonb; v_ex jsonb; v_usz int;
  v_size int := 0; v_units int := 0; v_more boolean := false; v_ls uuid; v_lt uuid;
  a_s jsonb[] := '{}'; a_t jsonb[] := '{}'; a_h jsonb[] := '{}'; a_e jsonb[] := '{}'; a_z jsonb[] := '{}';
begin
  select x.read_ver, x.owner_user_id into v_rv, v_own from mahjong.rooms x where x.id = p_room;
  -- 毎回返す段：days（全部の日）・members
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', x.id, 'day_ver', x.day_ver,
           'date', pg_catalog.to_char(x.date, 'YYYY-MM-DD'), 'voided', x.voided,
           'rules', (select q.rules from mahjong.rule_sets q where q.id = x.rule_set_id and q.version = x.rule_version),
           'rules_alt', (select q.rules from mahjong.rule_sets q where x.rule_set_id_alt is not null and q.id = x.rule_set_id_alt and q.version = x.rule_version_alt))
           order by x.created_at, x.id), '[]'::jsonb)
    into v_days from mahjong.sessions x where x.room_id = p_room and x.league_id = p_lid;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member_id', m.id, 'name', m.name, 'name_key', m.name_key, 'active', m.active)
           || case when m.user_id = p_me then '{"me": true}'::jsonb when m.user_id is not null then '{"taken": true}'::jsonb else '{}'::jsonb end
           || case when m.user_id is not null and m.user_id is distinct from v_own and not exists (select 1 from mahjong.room_accounts a where a.room_id = m.room_id and a.user_id = m.user_id) then '{"left": true}'::jsonb else '{}'::jsonb end
           order by m.created_at, m.id), '[]'::jsonb)
    into v_mem from mahjong.members m where m.room_id = p_room;
  -- 続きの頁の始め（無い開催・その開催に無い卓＝bad after）
  if p_after_s is not null then
    select x.created_at into v_ac from mahjong.sessions x where x.id = p_after_s and x.room_id = p_room and x.league_id = p_lid;
    if not found then return '{"bad": "after"}'::jsonb; end if;
    if p_after_t is not null then
      select y.created_at into v_tc from mahjong.tables y where y.id = p_after_t and y.session_id = p_after_s;
      if not found then return '{"bad": "after"}'::jsonb; end if;
    end if;
  end if;
  <<days>>
  for d in select x.* from mahjong.sessions x
            where x.room_id = p_room and x.league_id = p_lid and (p_since is null or x.day_ver > p_since)
              and (p_after_s is null or (x.created_at, x.id) >= (v_ac, p_after_s))
            order by x.created_at, x.id loop
    v_cont := coalesce(d.id = p_after_s, false);   -- 前の頁の続きの日（開催の行と締めはもう返した）
    if v_cont and p_after_t is null then continue; end if;   -- 卓の無い日まで返した
    v_head := not v_cont;
    if v_head then
      v_hj := pg_catalog.jsonb_build_object('session_id', d.id, 'date', pg_catalog.to_char(d.date, 'YYYY-MM-DD'), 'rate', d.rate)
              || case when d.place is not null and d.place <> '' then pg_catalog.jsonb_build_object('place', d.place) else '{}'::jsonb end
              || case when d.voided then '{"voided": true}'::jsonb else '{}'::jsonb end;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', z.session_id, 'rev', z.rev,
               'at', pg_catalog.to_char(z.made_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'content', case when z.rev = m.mx then z.content else '{}'::jsonb end,
               'used', case when z.rev = m.mx then z.used end, 'missing', case when z.rev = m.mx then z.missing end)
               order by z.made_at, z.session_id, z.rev), '[]'::jsonb)
        into v_hs
        from mahjong.settle_snaps z cross join (select pg_catalog.max(y.rev) as mx from mahjong.settle_snaps y where y.session_id = d.id) m
       where z.session_id = d.id;
      v_hsz := pg_catalog.octet_length(v_hj::text) + pg_catalog.octet_length(v_hs::text);
    end if;
    for t in select y.* from mahjong.tables y
              where y.session_id = d.id and (not v_cont or (y.created_at, y.id) > (v_tc, p_after_t))
              order by y.created_at, y.id loop
      v_tj := pg_catalog.jsonb_build_object('table_id', t.id, 'session_id', t.session_id, 'label', t.label,
                'rules', (select q.rules from mahjong.rule_sets q where q.id = t.rule_set_id and q.version = t.rule_version), 'seats', t.seats,
                'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', t.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))   -- A20 §6 late：区切りの時刻＝続きの卓の created_at
              || case when t.rate_mode <> 'session' then pg_catalog.jsonb_build_object('rate_mode', t.rate_mode) else '{}'::jsonb end
              || case when t.rate_mode = 'num' then pg_catalog.jsonb_build_object('rate', t.rate) else '{}'::jsonb end
              || case when t.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
              || case when t.next_table_id is not null then pg_catalog.jsonb_build_object('next_table_id', t.next_table_id, 'split_same', t.split_same) else '{}'::jsonb end;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('hanchan_id', hh.id, 'table_id', hh.table_id, 'no', hh.no,
               'seats', (select pg_catalog.jsonb_agg(e.value order by e.key::int) from pg_catalog.jsonb_each(hh.seats) e),
               'cells', (select pg_catalog.jsonb_agg(c.value order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s),
               'cell_ver', (select pg_catalog.jsonb_agg(c.version order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s),
               'ton_order', hh.ton_order, 'order_version', hh.order_version, 'lost', hh.lost_kyotaku, 'version', hh.version,
               'tobi_to', hh.tobi_to, 'tobi_version', hh.tobi_version, 'voided', hh.voided, 'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', hh.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
               || case when hh.order_cells is not null then pg_catalog.jsonb_build_object('order_cells', pg_catalog.to_jsonb(hh.order_cells)) else '{}'::jsonb end   -- A13 §6：null でない時だけ
               order by hh.created_at, hh.id), '[]'::jsonb)
        into v_hh
        from (select z.*, pg_catalog.row_number() over (order by z.created_at, z.id) as no from mahjong.hanchans z where z.table_id = t.id) hh;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table_id', e.table_id, 'member_id', e.member_id, 'kind', e.kind, 'value', e.value, 'version', e.version)
               order by e.kind collate "C", e.member_id::text collate "C"), '[]'::jsonb)
        into v_ex from mahjong.extras e where e.table_id = t.id;
      v_usz := pg_catalog.octet_length(v_tj::text) + pg_catalog.octet_length(v_hh::text) + pg_catalog.octet_length(v_ex::text)
               + case when v_head then v_hsz else 0 end;
      if v_units > 0 and v_size + v_usz > c_cap then v_more := true; exit days; end if;
      if v_head then a_s := a_s || v_hj; a_z := a_z || v_hs; v_head := false; end if;
      a_t := a_t || v_tj; a_h := a_h || v_hh; a_e := a_e || v_ex;
      v_size := v_size + v_usz; v_units := v_units + 1; v_ls := d.id; v_lt := t.id;
    end loop;
    if v_head then   -- 卓の無い日＝開催の行と締めだけで1つ
      if v_units > 0 and v_size + v_hsz > c_cap then v_more := true; exit days; end if;
      a_s := a_s || v_hj; a_z := a_z || v_hs;
      v_size := v_size + v_hsz; v_units := v_units + 1; v_ls := d.id; v_lt := null;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('read_ver', v_rv, 'days', v_days, 'more', v_more,
    'st', pg_catalog.jsonb_build_object('v', 2, 'members', v_mem,
      'sessions', pg_catalog.to_jsonb(a_s),
      'tables', pg_catalog.to_jsonb(a_t),
      -- 卓ごとの配列（a_h・a_e・a_z の1つ＝配列）を順のまま1本に
      'hanchans', (select coalesce(pg_catalog.jsonb_agg(e.value order by u.o, e.o), '[]'::jsonb)
                     from pg_catalog.unnest(a_h) with ordinality u(j, o), pg_catalog.jsonb_array_elements(u.j) with ordinality e(value, o)),
      'extras', (select coalesce(pg_catalog.jsonb_agg(e.value order by u.o, e.o), '[]'::jsonb)
                   from pg_catalog.unnest(a_e) with ordinality u(j, o), pg_catalog.jsonb_array_elements(u.j) with ordinality e(value, o)),
      'settles', (select coalesce(pg_catalog.jsonb_agg(e.value order by u.o, e.o), '[]'::jsonb)
                    from pg_catalog.unnest(a_z) with ordinality u(j, o), pg_catalog.jsonb_array_elements(u.j) with ordinality e(value, o))))
    || case when v_more then pg_catalog.jsonb_build_object('next_after', pg_catalog.jsonb_build_object('session_id', v_ls, 'table_id', v_lt)) else '{}'::jsonb end;
end $fn$;
revoke all on function mahjong_private.mj_r_league3(uuid, uuid, bigint, uuid, uuid, uuid) from public, anon, authenticated;

-- ── 2d 読む口 public.mj_read（2d_sadame.md v2.1 §1・設計図 §G）──────────────────────────────
--   通す人＝mj_write 段1 と同じ（持ち主か room_accounts の行・出された人は通さない）。無い・入っていない・消した印（deleted_at）＝gone（在るかを見せない）
--   閉じた部屋も読める（closed true）・部屋なし（solo）も持ち主は読める。p_what は 'room' と 'league'（D2 §1＝そのリーグの日だけの st・league・days）。p_args＝{since?:int}＝今の read_ver なら same（中身を返さない）
--   st は端末の写し（lib/room-state.mjs）と★同じ形・同じ鍵だけ★（写しに無い欄を出すと端末の門が newer で止まる）。D1：leagues は st の外の段（same の時は返さない）。リーグの日とその卓・半荘・extras・締めは出さない
--   並び＝members・sessions・tables・hanchans は (created_at, id)（写しの配列の順＝pickSession が最後を見る）・hanchans.no は卓の中の (created_at, id) の順の番号
--   last_seen は mj_write 段1 と同じ（1時間以上前の時だけ）
-- P2 §2（p2_sadame v5.1）：読みを時間で量る＝窓 read:u1m（key＝人・1分・数＝ms）。★v 無しも v3 も同じ門★＝今の分と前の分の和が 80,000 を越えていたら busy what read。
--   門の後で人ごとに4本の席（pg_try_advisory_xact_lock(人の鍵, 0〜3)）＝4本とも埋まっていれば busy what read_one（数えない）。
--   中身を組む所は begin…exception when query_canceled（時間切れ＝busy what read_slow）で包み、終わりと時間切れの両方で経った ms（切り上げ・same は 1）を同じ取引で足す。gone・bad・mj_session は数えない。
-- P2 §1：'league' の p_args.v = 3＝{league_id, v:3, since?, after?:{session_id, table_id|null}}＝mj_r_league3 の頁（more・next_after）。v 無しは今のまま全部。
create or replace function public.mj_read(p_room_id uuid, p_what text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_me uuid; v_role text; r record; v_since jsonb; v_rules jsonb; v_st jsonb; v_lg jsonb; v_lid uuid; v_days jsonb;
  v_v3 boolean := false; v_req uuid[] := '{}'; v_load uuid[]; v_abs jsonb; v_e jsonb; v_ns jsonb;
  v_lv3 boolean := false; v_as uuid; v_at uuid; v_pg jsonb; v_out jsonb; v_cnt boolean := true;
  v_uk text; v_seat int; v_got boolean := false; v_t0 timestamptz; v_ms int;
  v_min timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  v_me := mahjong_private.mj_me_read();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;
  if p_room_id is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_id'); end if;
  if p_what is null or p_what not in ('room', 'league') then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'what'); end if;
  if p_args is not null and pg_catalog.jsonb_typeof(p_args) not in ('object', 'null') then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'args');
  end if;
  -- D2 §1：'league'＝p_args.league_id（uuid の字）・形が違えば bad what league_id（部屋の門の前＝行を読まない）
  if p_what = 'league' then
    if pg_catalog.jsonb_typeof(p_args) is distinct from 'object' or pg_catalog.jsonb_typeof(p_args -> 'league_id') is distinct from 'string'
       or (p_args ->> 'league_id') !~* c_uuid then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'league_id');
    end if;
    v_lid := (p_args ->> 'league_id')::uuid;
    -- P2 §1.2：v 3＝頁の読み。after＝前の頁の next_after（形の誤り＝bad what after）
    if (p_args -> 'v') = '3'::jsonb then
      v_lv3 := true;
      if (p_args -> 'after') is not null and (p_args -> 'after') <> 'null'::jsonb then
        if pg_catalog.jsonb_typeof(p_args -> 'after') <> 'object'
           or pg_catalog.jsonb_typeof(p_args #> '{after,session_id}') is distinct from 'string' or (p_args #>> '{after,session_id}') !~* c_uuid
           or ((p_args #> '{after,table_id}') is not null and (p_args #> '{after,table_id}') <> 'null'::jsonb
               and (pg_catalog.jsonb_typeof(p_args #> '{after,table_id}') <> 'string' or (p_args #>> '{after,table_id}') !~* c_uuid)) then
          return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'after');
        end if;
        v_as := (p_args #>> '{after,session_id}')::uuid;
        v_at := case when pg_catalog.jsonb_typeof(p_args #> '{after,table_id}') = 'string' then (p_args #>> '{after,table_id}')::uuid end;
      end if;
    end if;
  end if;
  -- P5 §2（p5_sadame v1.3）：分けた読みは p_args.v = 3 の 'room' の時だけ（無い・3 でない＝今の v2 の全部の読み＝古い端末はそのまま読める）
  --   sessions＝開催 id の配列（任意・v 3 の時だけ見る）。形の誤り（配列でない・uuid の字でない・50 超え）だけ bad what sessions
  if p_what = 'room' and pg_catalog.jsonb_typeof(p_args) = 'object' and (p_args -> 'v') = '3'::jsonb then
    v_v3 := true;
    if (p_args -> 'sessions') is not null and (p_args -> 'sessions') <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_args -> 'sessions') <> 'array' or pg_catalog.jsonb_array_length(p_args -> 'sessions') > 50 then
        return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'sessions');
      end if;
      for v_e in select e.value from pg_catalog.jsonb_array_elements(p_args -> 'sessions') e loop
        if pg_catalog.jsonb_typeof(v_e) <> 'string' or (v_e #>> '{}') !~* c_uuid then
          return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'sessions');
        end if;
        v_req := v_req || (v_e #>> '{}')::uuid;
      end loop;
    end if;
  end if;
  v_since := case when pg_catalog.jsonb_typeof(p_args) = 'object' then p_args -> 'since' end;
  if v_since = 'null'::jsonb then v_since := null; end if;
  if v_since is not null and (pg_catalog.jsonb_typeof(v_since) <> 'number' or (v_since::text)::numeric % 1 <> 0 or (v_since::text)::numeric < 0) then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'since');
  end if;

  -- P2 §2.1 門（v 無しも v3 も・今の分と前の分の和）
  v_uk := v_me::text;
  if (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l
       where l.kind = 'read:u1m' and l.key = v_uk and l.window_start >= v_min - interval '1 minute') > 80000 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read');
  end if;
  -- P2 §2.3 同時の読みの席（人ごとに4本）
  for v_seat in 0 .. 3 loop
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('mj_read:' || v_uk), v_seat) then v_got := true; exit; end if;
  end loop;
  if not v_got then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read_one'); end if;
  v_t0 := pg_catalog.clock_timestamp();

  <<body>>
  begin
    select x.id, x.owner_user_id, x.deleted_at, x.kind, x.name, x.closed_at, x.read_ver, x.ns_ver, x.rule_set_id, x.rule_version, x.channel_key into r
      from mahjong.rooms x where x.id = p_room_id;
    if not found or r.deleted_at is not null then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); v_cnt := false; exit body; end if;
    if r.owner_user_id = v_me then
      v_role := 'owner';
    else
      select a.role into v_role from mahjong.room_accounts a where a.room_id = p_room_id and a.user_id = v_me;
      if v_role is not null and exists (select 1 from mahjong.room_bans b where b.room_id = p_room_id and b.user_id = v_me) then v_role := null; end if;
    end if;
    if v_role is null then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); v_cnt := false; exit body; end if;
    -- D2 §1：リーグが無い・他の部屋＝bad what league_id（取り消したリーグは読める）＝部屋の門の後（入でない人には在るかを見せない）
    if v_lid is not null and not exists (select 1 from mahjong.leagues l where l.id = v_lid and l.room_id = p_room_id) then
      v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'league_id'); v_cnt := false; exit body;
    end if;
    update mahjong.room_accounts a set last_seen = pg_catalog.now()
     where a.room_id = p_room_id and a.user_id = v_me and a.last_seen < pg_catalog.now() - interval '1 hour';

    if v_since is not null and (v_since::text)::numeric = r.read_ver then
      v_out := pg_catalog.jsonb_build_object('ok', true, 'same', true, 'read_ver', r.read_ver); exit body;
    end if;

    select x.rules into v_rules from mahjong.rule_sets x where x.id = r.rule_set_id and x.version = r.rule_version;

    -- D1 §2（d1_sadame v2.1）：その部屋のリーグ（取り消した物も・並び created_at, id）。★st の外の段★（st は写しと同じ形のまま）
    --   l＝自分が L か（owner_user_id が自分／L のアカウントが無く自分が部屋の持ち主＝書きの時に倉庫が継ぐ）。owner_user_id そのものは返さない
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('league_id', l.id, 'name', l.name,
             'date_from', pg_catalog.to_char(l.date_from, 'YYYY-MM-DD'), 'date_to', pg_catalog.to_char(l.date_to, 'YYYY-MM-DD'),
             'rank_by', l.rank_by, 'min_games', l.min_games, 'players_main', l.players_main,
             'rules', (select q.rules from mahjong.rule_sets q where q.id = l.rule_set_id and q.version = l.rule_version),
             'rules_alt', (select q.rules from mahjong.rule_sets q where l.rule_set_id_alt is not null and q.id = l.rule_set_id_alt and q.version = l.rule_version_alt),
             'version', l.version,
             'created_at', pg_catalog.to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),   -- A24（11-27）：同じ名のリーグを作った日時で見分ける（画面は端末の時刻で出す・Z＝UTC・小数なしで WebKit も読める）
             'l', l.owner_user_id = v_me or (v_role = 'owner' and not exists (select 1 from auth.users u where u.id = l.owner_user_id)))
             || case when l.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
             order by l.created_at, l.id), '[]'::jsonb)
      into v_lg from mahjong.leagues l where l.room_id = p_room_id and (v_lid is null or l.id = v_lid);

    -- P2 §1.2：リーグの v3＝頁（read_ver・days・中身は mj_r_league3 の1つの写真）
    if v_lv3 then
      v_pg := mahjong_private.mj_r_league3(p_room_id, v_lid, (v_since::text)::bigint, v_as, v_at, v_me);
      if v_pg ? 'bad' then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'after'); v_cnt := false; exit body; end if;
      v_out := pg_catalog.jsonb_build_object('ok', true, 'read_ver', v_pg -> 'read_ver',
        'room', pg_catalog.jsonb_build_object('kind', r.kind, 'role', v_role, 'owner', v_role = 'owner', 'closed', r.closed_at is not null, 'rules', v_rules,
                                              'channel_key', r.channel_key)
                || case when r.kind = 'shared' then pg_catalog.jsonb_build_object('name', r.name) else '{}'::jsonb end,
        'league', v_lg -> 0, 'days', v_pg -> 'days', 'st', v_pg -> 'st', 'more', v_pg -> 'more')
        || case when v_pg ? 'next_after' then pg_catalog.jsonb_build_object('next_after', v_pg -> 'next_after') else '{}'::jsonb end;
      exit body;
    end if;

    if v_v3 then
      -- P5 §2：中身を返す開催＝(a) (created_at, id) の最後の3つ（取り消しも）(b) 取り消していない最後（pickSession・開催の重なりの門と同じ並び）
      --   (c) sessions に在るこの部屋の league null の開催。それ以外の id（まだ無い・他の部屋・リーグの日）は absent（読みは失敗しない）
      select coalesce(pg_catalog.array_agg(x.id order by x.created_at, x.id), '{}') into v_load
        from mahjong.sessions x
       where x.room_id = p_room_id and x.league_id is null
         and (x.id in (select y.id from mahjong.sessions y where y.room_id = p_room_id and y.league_id is null order by y.created_at desc, y.id desc limit 3)
              or x.id = (select y.id from mahjong.sessions y where y.room_id = p_room_id and y.league_id is null and not y.voided order by y.created_at desc, y.id desc limit 1)
              or x.id = any(v_req));
      select coalesce(pg_catalog.jsonb_agg(d.id::text order by d.o), '[]'::jsonb) into v_abs
        from (select q.id, pg_catalog.min(q.o) as o from pg_catalog.unnest(v_req) with ordinality as q(id, o)
               where not exists (select 1 from mahjong.sessions x where x.id = q.id and x.room_id = p_room_id and x.league_id is null)
               group by q.id) d;
      -- members の n（取り消していない半荘に座った数）と last（その開催の日の最大）＝league null の全開催を数える（画面の memberStats と同じ数え）
      -- P2 §1.6：数えは room_ns の控え（ver＝読み始めの ns_ver 以上なら使う）。違えば★待つ鍵★を取ってから読み直し、まだ違えば数え直して ver＝読み始めの ns_ver で控える
      select n.cache into v_ns from mahjong.room_ns n where n.room_id = p_room_id and n.ver >= r.ns_ver;
      if not found then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mj_room_ns:' || p_room_id::text, 0));
        select n.cache into v_ns from mahjong.room_ns n where n.room_id = p_room_id and n.ver >= r.ns_ver;
        if not found then
          select coalesce(pg_catalog.jsonb_object_agg(q.mid, pg_catalog.jsonb_build_object('n', q.n, 'last', q.last)), '{}'::jsonb) into v_ns
            from (select e2.value as mid, pg_catalog.count(*)::int as n, pg_catalog.to_char(pg_catalog.max(s2.date), 'YYYY-MM-DD') as last
                    from mahjong.hanchans h2 join mahjong.tables t2 on t2.id = h2.table_id join mahjong.sessions s2 on s2.id = t2.session_id
                         cross join lateral pg_catalog.jsonb_each_text(h2.seats) e2
                   where h2.room_id = p_room_id and s2.room_id = p_room_id and s2.league_id is null and not h2.voided
                   group by e2.value) q;
          insert into mahjong.room_ns (room_id, ver, cache) values (p_room_id, r.ns_ver, v_ns)
            on conflict (room_id) do update set ver = excluded.ver, cache = excluded.cache where mahjong.room_ns.ver < excluded.ver;
        end if;
      end if;
    end if;

    with ss as (
      select x.* from mahjong.sessions x where x.room_id = p_room_id and x.league_id is not distinct from v_lid   -- room＝リーグでない日・league＝そのリーグの日（全部）
    ), sl as (
      select ss.* from ss where not v_v3 or ss.id = any(v_load)   -- P5：中身を返す開催（v2 は全部）
    ), tt as (
      select y.* from mahjong.tables y join sl on sl.id = y.session_id
    ), hh as (
      select z.*, pg_catalog.row_number() over (partition by z.table_id order by z.created_at, z.id) as no
        from mahjong.hanchans z join tt on tt.id = z.table_id
    )
    select pg_catalog.jsonb_build_object('v', case when v_v3 then 3 else 2 end,
      'members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member_id', m.id, 'name', m.name, 'name_key', m.name_key, 'active', m.active)
                             -- C2-0 §1a：me＝呼んだ人がつないだ人・taken＝他の人がつないだ人（user_id は返さない・無い鍵＝false）
                             || case when m.user_id = v_me then '{"me": true}'::jsonb when m.user_id is not null then '{"taken": true}'::jsonb else '{}'::jsonb end
                             -- C2-1 §1a：left＝抜けた人の名（user_id が在り・room_accounts に行が無く・持ち主でない）
                             || case when m.user_id is not null and m.user_id is distinct from r.owner_user_id and not exists (select 1 from mahjong.room_accounts a where a.room_id = m.room_id and a.user_id = m.user_id) then '{"left": true}'::jsonb else '{}'::jsonb end
                             -- P5 §2：v3 は n と last（上の v_ns・座っていない人は 0 と null）
                             || case when v_v3 then coalesce(v_ns -> m.id::text, '{"n": 0, "last": null}'::jsonb) else '{}'::jsonb end
                             order by m.created_at, m.id) from mahjong.members m where m.room_id = p_room_id), '[]'::jsonb),
      'sessions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', ss.id, 'date', pg_catalog.to_char(ss.date, 'YYYY-MM-DD'), 'rate', ss.rate)
                             || case when ss.place is not null and ss.place <> '' then pg_catalog.jsonb_build_object('place', ss.place) else '{}'::jsonb end
                             || case when ss.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
                             order by ss.created_at, ss.id) from ss), '[]'::jsonb),
      'tables', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table_id', tt.id, 'session_id', tt.session_id, 'label', tt.label,
                             'rules', (select q.rules from mahjong.rule_sets q where q.id = tt.rule_set_id and q.version = tt.rule_version), 'seats', tt.seats,
                             'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', tt.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                             || case when tt.rate_mode <> 'session' then pg_catalog.jsonb_build_object('rate_mode', tt.rate_mode) else '{}'::jsonb end
                             || case when tt.rate_mode = 'num' then pg_catalog.jsonb_build_object('rate', tt.rate) else '{}'::jsonb end
                             || case when tt.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
                             -- C4 §3（N1）区切った卓だけ：続きの卓と、鍵が同じだったか（null＝lib は「鍵が違う」側に読む）
                             || case when tt.next_table_id is not null then pg_catalog.jsonb_build_object('next_table_id', tt.next_table_id, 'split_same', tt.split_same) else '{}'::jsonb end
                             order by tt.created_at, tt.id) from tt), '[]'::jsonb),
      'hanchans', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('hanchan_id', hh.id, 'table_id', hh.table_id, 'no', hh.no,
                             'seats', (select pg_catalog.jsonb_agg(e.value order by e.key::int) from pg_catalog.jsonb_each(hh.seats) e),
                             'cells', (select pg_catalog.jsonb_agg(c.value order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s),
                             'cell_ver', (select pg_catalog.jsonb_agg(c.version order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c on c.hanchan_id = hh.id and c.seat = g.s),
                             'ton_order', hh.ton_order, 'order_version', hh.order_version, 'lost', hh.lost_kyotaku, 'version', hh.version,
                             'tobi_to', hh.tobi_to, 'tobi_version', hh.tobi_version, 'voided', hh.voided, 'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', hh.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                             || case when hh.order_cells is not null then pg_catalog.jsonb_build_object('order_cells', pg_catalog.to_jsonb(hh.order_cells)) else '{}'::jsonb end   -- A13 §6：null でない時だけ
                             order by hh.created_at, hh.id) from hh), '[]'::jsonb),
      'extras', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table_id', e.table_id, 'member_id', e.member_id, 'kind', e.kind, 'value', e.value, 'version', e.version)
                             order by e.table_id::text collate "C", e.kind collate "C", e.member_id::text collate "C") from mahjong.extras e join tt on tt.id = e.table_id), '[]'::jsonb),
      'settles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', z.session_id, 'rev', z.rev,
                             'at', pg_catalog.to_char(z.made_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'content', z.content, 'used', z.used, 'missing', z.missing)
                             order by z.made_at, z.session_id, z.rev) from mahjong.settle_snaps z join sl on sl.id = z.session_id), '[]'::jsonb))
      into v_st;
    if v_v3 then
      v_st := v_st || pg_catalog.jsonb_build_object('loaded', (select coalesce(pg_catalog.jsonb_agg(u.id::text order by u.o), '[]'::jsonb) from pg_catalog.unnest(v_load) with ordinality as u(id, o)),
                                                    'absent', v_abs);
    end if;

    if v_lid is not null then
      -- D2 §1：days＝その日の版（開催日に写した主と alt・league_save の後も前の日は前の版）・並び (created_at, id)
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', x.id,
               'rules', (select q.rules from mahjong.rule_sets q where q.id = x.rule_set_id and q.version = x.rule_version),
               'rules_alt', (select q.rules from mahjong.rule_sets q where x.rule_set_id_alt is not null and q.id = x.rule_set_id_alt and q.version = x.rule_version_alt))
               order by x.created_at, x.id), '[]'::jsonb)
        into v_days from mahjong.sessions x where x.room_id = p_room_id and x.league_id = v_lid;
      v_out := pg_catalog.jsonb_build_object('ok', true, 'read_ver', r.read_ver,
        'room', pg_catalog.jsonb_build_object('kind', r.kind, 'role', v_role, 'owner', v_role = 'owner', 'closed', r.closed_at is not null, 'rules', v_rules,
                                              'channel_key', r.channel_key)
                || case when r.kind = 'shared' then pg_catalog.jsonb_build_object('name', r.name) else '{}'::jsonb end,
        'league', v_lg -> 0, 'days', v_days, 'st', v_st);
      exit body;
    end if;

    v_out := pg_catalog.jsonb_build_object('ok', true, 'read_ver', r.read_ver,
      'room', pg_catalog.jsonb_build_object('kind', r.kind, 'role', v_role, 'owner', v_role = 'owner', 'closed', r.closed_at is not null, 'rules', v_rules,
                                            'channel_key', r.channel_key)   -- 2c-2f §1：room_secret の後に新しい名を知る道
              || case when r.kind = 'shared' then pg_catalog.jsonb_build_object('name', r.name) else '{}'::jsonb end,
      'st', v_st, 'leagues', v_lg);
  exception when query_canceled then
    v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read_slow');   -- P2 §2.2（塊の中の書き＝last_seen・room_ns は戻る）
  end;

  -- P2 §2.2 数え（終わりと時間切れの両方・gone・bad は数えない）。(kind,key) の行は人ごと＝古い窓は同じ取引で消す
  if v_cnt then
    v_ms := greatest(1, pg_catalog.ceil(extract(epoch from pg_catalog.clock_timestamp() - v_t0) * 1000)::int);
    delete from mahjong.limits l where l.kind = 'read:u1m' and l.key = v_uk and l.window_start < v_min - interval '1 minute';
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', v_uk, v_min, v_ms)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + excluded.count;
  end if;
  return v_out;
end $fn$;
revoke all on function public.mj_read(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mj_read(uuid, text, jsonb) to authenticated;

-- ── C2-1 §1b（c2_db.md §1b）自分の戦績の読み public.mj_account('my_stats', {v:1, after?, at?}) ─────────────────
--   部屋＝消していない・自分につないだ名が1つ以上・room_bans に無い。side in＝持ち主か room_accounts に行が在る（st は mj_read('room') v2 と同じ組み立て・開催は全部＝リーグの日も league_id 付き）
--   side out＝自分で出た部屋＝自分の名が半荘の席に居るか0でない枚の行を持つ卓 T だけ（T の半荘・枚は全部）。他の人の member は頁×部屋の中だけの仮の id o1・o2…（members・settles は返さない）
--   al＝out の T のうち、抜けた後（history.id > room_leaves.left_hist_id）に T・T の半荘・点・枚・開催を触った行が在る物（t）と、その中で今取り消されておらず自分が座る半荘（h）。数は変えない（lib が決める）
--   門＝mj_read と同じ read:u1m（80,000ms）・同じ4本の席・read_slow。頁＝after {room_id, created_at, session_id[, table_id]}・半荘 2000 か cells 8000 で切る（開催ごと・1つの開催が越える時だけ鎖の切れ目）
create or replace function public.mj_account(p_what text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_me uuid; v_uk text; v_seat int; v_got boolean := false; v_t0 timestamptz; v_ms int; v_cnt boolean := true;
  v_min timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_ts constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$';
  c_mh constant int := 2000; c_mc constant int := 8000;
  v_at timestamptz; v_ar uuid; v_acr timestamptz; v_as uuid; v_atid uuid; v_akcr timestamptz; v_akid uuid;
  r record; c record; v_side text; v_mm uuid[]; v_left bigint; v_sids uuid[]; v_tids uuid[]; v_cur uuid; v_chain boolean;
  v_nh bigint := 0; v_nc bigint := 0; v_any boolean := false; v_stop boolean := false; v_more boolean := false; v_next jsonb;
  v_lr uuid; v_lcr timestamptz; v_ls uuid; v_ltid uuid; v_lchain boolean := false; v_room_any boolean;
  v_rows jsonb := '[]'::jsonb; v_st jsonb; v_map jsonb; v_al jsonb; v_lg jsonb; v_out jsonb; v_unl jsonb;
begin
  v_me := mahjong_private.mj_me_read();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;
  if p_what is null or p_what <> 'my_stats' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'what'); end if;
  if pg_catalog.jsonb_typeof(p_args) is distinct from 'object' or (p_args -> 'v') is distinct from '1'::jsonb then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'v');
  end if;
  -- at＝1頁目の読み始め（2頁目から渡す）・after＝前の頁の next_after（at が無い after は bad）
  if (p_args -> 'at') is not null and (p_args -> 'at') <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_args -> 'at') <> 'string' or (p_args ->> 'at') !~ c_ts then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'at');
    end if;
    v_at := (p_args ->> 'at')::timestamptz;
  end if;
  if (p_args -> 'after') is not null and (p_args -> 'after') <> 'null'::jsonb then
    if v_at is null or pg_catalog.jsonb_typeof(p_args -> 'after') <> 'object'
       or pg_catalog.jsonb_typeof(p_args #> '{after,room_id}') is distinct from 'string' or (p_args #>> '{after,room_id}') !~* c_uuid
       or pg_catalog.jsonb_typeof(p_args #> '{after,session_id}') is distinct from 'string' or (p_args #>> '{after,session_id}') !~* c_uuid
       or pg_catalog.jsonb_typeof(p_args #> '{after,created_at}') is distinct from 'string' or (p_args #>> '{after,created_at}') !~ c_ts
       or ((p_args #> '{after,table_id}') is not null and (p_args #> '{after,table_id}') <> 'null'::jsonb
           and (pg_catalog.jsonb_typeof(p_args #> '{after,table_id}') <> 'string' or (p_args #>> '{after,table_id}') !~* c_uuid)) then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'after');
    end if;
    v_ar := (p_args #>> '{after,room_id}')::uuid;
    v_as := (p_args #>> '{after,session_id}')::uuid;
    v_acr := (p_args #>> '{after,created_at}')::timestamptz;
    v_atid := case when pg_catalog.jsonb_typeof(p_args #> '{after,table_id}') = 'string' then (p_args #>> '{after,table_id}')::uuid end;
  end if;

  -- 門（mj_read と同じ鍵・同じ席）
  v_uk := v_me::text;
  if (select coalesce(pg_catalog.sum(l.count), 0) from mahjong.limits l
       where l.kind = 'read:u1m' and l.key = v_uk and l.window_start >= v_min - interval '1 minute') > 80000 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read');
  end if;
  for v_seat in 0 .. 3 loop
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('mj_read:' || v_uk), v_seat) then v_got := true; exit; end if;
  end loop;
  if not v_got then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read_one'); end if;
  v_t0 := pg_catalog.clock_timestamp();

  <<body>>
  begin
    if v_at is null then v_at := pg_catalog.now(); end if;
    -- after.table_id＝前の頁の最後の卓＝その鎖の並びの鍵（その開催の卓でなければ bad）
    if v_atid is not null then
      select hd.created_at, hd.id into v_akcr, v_akid
        from mahjong.tables t join mahjong.tables hd on hd.id = coalesce(t.chain_head, t.id)
       where t.id = v_atid and t.session_id = v_as;
      if not found then v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'after'); v_cnt := false; exit body; end if;
    end if;

    <<rooms>>
    for r in select x.id, x.kind, x.name, x.owner_user_id from mahjong.rooms x
              where x.deleted_at is null and x.created_at <= v_at
                and (v_ar is null or x.id >= v_ar)
                and exists (select 1 from mahjong.members m where m.room_id = x.id and m.user_id = v_me)
                and not exists (select 1 from mahjong.room_bans b where b.room_id = x.id and b.user_id = v_me)
              order by x.id loop
      v_side := case when r.owner_user_id = v_me or exists (select 1 from mahjong.room_accounts a where a.room_id = r.id and a.user_id = v_me) then 'in' else 'out' end;
      select pg_catalog.array_agg(m.id order by m.id) into v_mm from mahjong.members m where m.room_id = r.id and m.user_id = v_me;
      v_sids := '{}'; v_tids := '{}'; v_cur := null; v_chain := false; v_room_any := false;
      -- 鎖ごとの行（開催 (created_at, id)・鎖の頭 (created_at, id)）。in＝開催の卓全部（卓の無い開催も1行）・out＝自分の卓 T だけ
      for c in
        with tc as (
          select s.id as sid, s.created_at as scr, t.id as tid, t.chain_no, t.created_at as tcr, hd.created_at as hcr, hd.id as hid,
                 (select pg_catalog.count(*) from mahjong.hanchans z where z.table_id = t.id) as nh,
                 (select pg_catalog.count(*) from mahjong.cells e join mahjong.hanchans z on z.id = e.hanchan_id where z.table_id = t.id) as nc
            from mahjong.sessions s
            left join mahjong.tables t on t.session_id = s.id
                 and (v_side = 'in'
                      or exists (select 1 from mahjong.hanchans z, pg_catalog.jsonb_each_text(z.seats) q where z.table_id = t.id and q.value::uuid = any (v_mm))
                      or exists (select 1 from mahjong.extras e where e.table_id = t.id and e.member_id = any (v_mm) and e.value <> 0))
            left join mahjong.tables hd on hd.id = coalesce(t.chain_head, t.id)
           where s.room_id = r.id and s.created_at <= v_at
             and (r.id <> v_ar or v_ar is null or (s.created_at, s.id) > (v_acr, v_as) or (v_atid is not null and s.id = v_as))
        ), ch as (
          select tc.sid, tc.scr, tc.hcr, tc.hid,
                 pg_catalog.array_agg(tc.tid order by tc.chain_no, tc.tcr, tc.tid) filter (where tc.tid is not null) as tids,
                 coalesce(pg_catalog.sum(tc.nh), 0) as nh, coalesce(pg_catalog.sum(tc.nc), 0) as nc
            from tc
           where v_side = 'in' or tc.tid is not null
           group by tc.sid, tc.scr, tc.hcr, tc.hid
        )
        select ch.*, pg_catalog.sum(ch.nh) over w as rh, pg_catalog.sum(ch.nc) over w as rc
          from ch
         where not (v_atid is not null and r.id = v_ar and ch.sid = v_as and (ch.hcr, ch.hid) <= (v_akcr, v_akid))
        window w as (partition by ch.sid order by ch.hcr nulls first, ch.hid nulls first rows between current row and unbounded following)
         order by ch.scr, ch.sid, ch.hcr nulls first, ch.hid nulls first
      loop
        if c.sid is distinct from v_cur then
          v_cur := c.sid;
          if v_nh + c.rh > c_mh or v_nc + c.rc > c_mc then
            if v_any then v_stop := true; exit; end if;
            v_chain := true;
          else
            v_chain := false;
          end if;
        end if;
        if v_chain and v_any and (v_nh + c.nh > c_mh or v_nc + c.nc > c_mc) then v_stop := true; exit; end if;
        if not (c.sid = any (v_sids)) then v_sids := v_sids || c.sid; end if;
        if c.tids is not null then v_tids := v_tids || c.tids; v_ltid := c.tids[pg_catalog.array_length(c.tids, 1)]; end if;
        v_nh := v_nh + c.nh; v_nc := v_nc + c.nc; v_any := true; v_room_any := true;
        v_lr := r.id; v_lcr := c.scr; v_ls := c.sid; v_lchain := v_chain;
      end loop;

      if not v_stop or v_room_any then
        -- その頁の開催のリーグ（名・日・取り消し）
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('league_id', l.id, 'name', l.name,
                 'date_from', pg_catalog.to_char(l.date_from, 'YYYY-MM-DD'), 'date_to', pg_catalog.to_char(l.date_to, 'YYYY-MM-DD'))
                 || case when l.voided then '{"voided": true}'::jsonb else '{}'::jsonb end order by l.created_at, l.id), '[]'::jsonb)
          into v_lg from mahjong.leagues l
         where l.room_id = r.id and exists (select 1 from mahjong.sessions s where s.id = any (v_sids) and s.league_id = l.id);
        -- 仮の id（out だけ）＝この頁×部屋の T に出る他の人の member を字順に o1, o2…
        v_map := '{}'::jsonb;
        if v_side = 'out' then
          select coalesce(pg_catalog.jsonb_object_agg(p.m, 'o' || p.n), '{}'::jsonb) into v_map
            from (select u.m, pg_catalog.row_number() over (order by u.m collate "C") as n
                    from (select q.value as m from mahjong.hanchans z, pg_catalog.jsonb_each_text(z.seats) q where z.table_id = any (v_tids)
                          union select q.value from mahjong.hanchans z, pg_catalog.jsonb_array_elements_text(coalesce(z.ton_order, '[]'::jsonb)) q where z.table_id = any (v_tids)
                          union select q.value from mahjong.tables t, pg_catalog.jsonb_array_elements_text(t.seats) q where t.id = any (v_tids)
                          union select e.member_id::text from mahjong.extras e where e.table_id = any (v_tids)) u
                   where u.m is not null and not (u.m = any (v_mm::text[]))) p;
        end if;
        with ss as (
          select x.* from mahjong.sessions x where x.id = any (v_sids)
        ), tt as (
          select y.* from mahjong.tables y where y.id = any (v_tids)
        ), hh as (
          select z.*, pg_catalog.row_number() over (partition by z.table_id order by z.created_at, z.id) as no
            from mahjong.hanchans z join tt on tt.id = z.table_id
        )
        select pg_catalog.jsonb_build_object('v', 2,
          'sessions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', ss.id, 'date', pg_catalog.to_char(ss.date, 'YYYY-MM-DD'), 'rate', ss.rate)
                                 || case when ss.place is not null and ss.place <> '' then pg_catalog.jsonb_build_object('place', ss.place) else '{}'::jsonb end
                                 || case when ss.league_id is not null then pg_catalog.jsonb_build_object('league_id', ss.league_id) else '{}'::jsonb end
                                 || case when ss.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
                                 order by ss.created_at, ss.id) from ss), '[]'::jsonb),
          'tables', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table_id', tt.id, 'session_id', tt.session_id, 'label', tt.label,
                                 'rules', (select q.rules from mahjong.rule_sets q where q.id = tt.rule_set_id and q.version = tt.rule_version),
                                 'seats', coalesce((select pg_catalog.jsonb_agg(coalesce(v_map -> e.value, pg_catalog.to_jsonb(e.value)) order by e.o)
                                                      from pg_catalog.jsonb_array_elements_text(tt.seats) with ordinality as e(value, o)), '[]'::jsonb),
                                 'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', tt.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                                 || case when tt.rate_mode <> 'session' then pg_catalog.jsonb_build_object('rate_mode', tt.rate_mode) else '{}'::jsonb end
                                 || case when tt.rate_mode = 'num' then pg_catalog.jsonb_build_object('rate', tt.rate) else '{}'::jsonb end
                                 || case when tt.voided then '{"voided": true}'::jsonb else '{}'::jsonb end
                                 || case when tt.next_table_id is not null then pg_catalog.jsonb_build_object('next_table_id', tt.next_table_id, 'split_same', tt.split_same) else '{}'::jsonb end
                                 order by tt.created_at, tt.id) from tt), '[]'::jsonb),
          'hanchans', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('hanchan_id', hh.id, 'table_id', hh.table_id, 'no', hh.no,
                                 'seats', (select pg_catalog.jsonb_agg(coalesce(v_map -> (e.value #>> '{}'), e.value) order by e.key::int) from pg_catalog.jsonb_each(hh.seats) e),
                                 'cells', (select pg_catalog.jsonb_agg(c2.value order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c2 on c2.hanchan_id = hh.id and c2.seat = g.s),
                                 'cell_ver', (select pg_catalog.jsonb_agg(c2.version order by g.s) from pg_catalog.generate_series(0, hh.players - 1) g(s) left join mahjong.cells c2 on c2.hanchan_id = hh.id and c2.seat = g.s),
                                 'ton_order', case when hh.ton_order is null then null else
                                   (select pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(e.value) = 'string' then coalesce(v_map -> (e.value #>> '{}'), e.value) else e.value end order by e.o)
                                      from pg_catalog.jsonb_array_elements(hh.ton_order) with ordinality as e(value, o)) end,
                                 'order_version', hh.order_version, 'lost', hh.lost_kyotaku, 'version', hh.version,
                                 'tobi_to', hh.tobi_to, 'tobi_version', hh.tobi_version, 'voided', hh.voided, 'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', hh.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                                 || case when hh.order_cells is not null then pg_catalog.jsonb_build_object('order_cells', pg_catalog.to_jsonb(hh.order_cells)) else '{}'::jsonb end
                                 order by hh.created_at, hh.id) from hh), '[]'::jsonb),
          'extras', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table_id', e.table_id, 'member_id', coalesce(v_map -> e.member_id::text, pg_catalog.to_jsonb(e.member_id)),
                                 'kind', e.kind, 'value', e.value, 'version', e.version)
                                 order by e.table_id::text collate "C", e.kind collate "C", e.member_id::text collate "C") from mahjong.extras e join tt on tt.id = e.table_id), '[]'::jsonb))
          into v_st;
        if v_side = 'in' then
          v_st := v_st || pg_catalog.jsonb_build_object(
            'members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member_id', m.id, 'name', m.name, 'name_key', m.name_key, 'active', m.active)
                                   || case when m.user_id = v_me then '{"me": true}'::jsonb when m.user_id is not null then '{"taken": true}'::jsonb else '{}'::jsonb end
                                   || case when m.user_id is not null and m.user_id is distinct from r.owner_user_id and not exists (select 1 from mahjong.room_accounts a where a.room_id = m.room_id and a.user_id = m.user_id) then '{"left": true}'::jsonb else '{}'::jsonb end
                                   order by m.created_at, m.id) from mahjong.members m where m.room_id = r.id), '[]'::jsonb),
            'settles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('session_id', z.session_id, 'rev', z.rev,
                                   'at', pg_catalog.to_char(z.made_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'content', z.content, 'used', z.used, 'missing', z.missing)
                                   order by z.made_at, z.session_id, z.rev) from mahjong.settle_snaps z where z.session_id = any (v_sids)), '[]'::jsonb));
          v_al := null;
        else
          -- al：抜けた後の history（索引 history_room の id > left_hist_id だけ）で T・T の半荘・点・枚・開催に当たる行
          select x.left_hist_id into v_left from mahjong.room_leaves x where x.room_id = r.id and x.user_id = v_me;
          if v_left is null then
            v_al := '{"t": [], "h": []}'::jsonb;
          else
            with hit as (
              select h.tbl, case when h.tbl = 'cells' then h.row_key ->> 'hanchan_id' when h.tbl = 'extras' then h.row_key ->> 'table_id' else h.row_key ->> 'id' end as k
                from mahjong.history h
               where h.room_id = r.id and h.id > v_left and h.kind = 'row' and h.tbl in ('tables', 'hanchans', 'cells', 'extras', 'sessions')
               group by 1, 2
            ), at_t as (
              select t.id, t.session_id, t.voided,
                     exists (select 1 from hit where (hit.tbl in ('tables', 'extras') and hit.k = t.id::text) or (hit.tbl = 'sessions' and hit.k = t.session_id::text)) as whole
                from mahjong.tables t where t.id = any (v_tids)
            ), hz as (
              select z.id, z.table_id, z.voided, z.seats, z.created_at,
                     exists (select 1 from hit where hit.tbl in ('hanchans', 'cells') and hit.k = z.id::text) as hit
                from mahjong.hanchans z where z.table_id = any (v_tids)
            )
            select pg_catalog.jsonb_build_object(
              't', coalesce((select pg_catalog.jsonb_agg(a.id order by a.id) from at_t a
                              where a.whole or exists (select 1 from hz where hz.table_id = a.id and hz.hit)), '[]'::jsonb),
              'h', coalesce((select pg_catalog.jsonb_agg(hz.id order by hz.created_at, hz.id) from hz join at_t a on a.id = hz.table_id
                                join mahjong.sessions s on s.id = a.session_id
                              where (a.whole and exists (select 1 from hit where hit.tbl in ('tables', 'sessions') and hit.k in (a.id::text, a.session_id::text)) or hz.hit)
                                and not hz.voided and not a.voided and not s.voided
                                and exists (select 1 from pg_catalog.jsonb_each_text(hz.seats) q where q.value::uuid = any (v_mm))), '[]'::jsonb))
              into v_al;
          end if;
        end if;
        v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('room_id', r.id, 'kind', r.kind, 'side', v_side,
                    'me', pg_catalog.to_jsonb(v_mm), 'leagues', v_lg, 'st', v_st)
                    || case when r.kind = 'shared' then pg_catalog.jsonb_build_object('name', r.name) else '{}'::jsonb end
                    || case when v_al is not null then pg_catalog.jsonb_build_object('al', v_al) else '{}'::jsonb end);
      end if;
      if v_stop then
        v_more := true;
        v_next := pg_catalog.jsonb_build_object('room_id', v_lr, 'session_id', v_ls,
                    'created_at', pg_catalog.to_char(pg_catalog.timezone('UTC', v_lcr), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                  || case when v_lchain and v_ltid is not null then pg_catalog.jsonb_build_object('table_id', v_ltid) else '{}'::jsonb end;
        exit rooms;
      end if;
    end loop;

    v_out := pg_catalog.jsonb_build_object('ok', true, 'rows', v_rows, 'more', v_more,
               'at', pg_catalog.to_char(pg_catalog.timezone('UTC', v_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
             || case when v_next is not null then pg_catalog.jsonb_build_object('next_after', v_next) else '{}'::jsonb end;
    -- 1頁目だけ：入っている（持ち主か行が在る）のにつないだ名が0の部屋の数（kind ごと）
    if v_ar is null then
      select coalesce(pg_catalog.jsonb_object_agg(u.kind, u.n), '{}'::jsonb) into v_unl
        from (select x.kind, pg_catalog.count(*)::int as n from mahjong.rooms x
               where x.deleted_at is null and x.created_at <= v_at
                 and (x.owner_user_id = v_me or exists (select 1 from mahjong.room_accounts a where a.room_id = x.id and a.user_id = v_me))
                 and not exists (select 1 from mahjong.members m where m.room_id = x.id and m.user_id = v_me)
                 and not exists (select 1 from mahjong.room_bans b where b.room_id = x.id and b.user_id = v_me)
               group by x.kind) u;
      v_out := v_out || pg_catalog.jsonb_build_object('unlinked', v_unl);
    end if;
  exception when query_canceled then
    v_out := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'read_slow');
  end;

  if v_cnt then
    v_ms := greatest(1, pg_catalog.ceil(extract(epoch from pg_catalog.clock_timestamp() - v_t0) * 1000)::int);
    delete from mahjong.limits l where l.kind = 'read:u1m' and l.key = v_uk and l.window_start < v_min - interval '1 minute';
    insert into mahjong.limits (kind, key, window_start, count) values ('read:u1m', v_uk, v_min, v_ms)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + excluded.count;
  end if;
  return v_out;
end $fn$;
revoke all on function public.mj_account(text, jsonb) from public, anon, authenticated;
grant execute on function public.mj_account(text, jsonb) to authenticated;




-- ── 権限：部屋は誰にも開けない（RLS も入・決まり書き0本） ─────────────────
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'mahjong' and c.relkind = 'r' loop
    execute format('alter table mahjong.%I enable row level security', t.relname);
  end loop;
end $$;
revoke all on all tables in schema mahjong from public, anon, authenticated;
revoke all on all sequences in schema mahjong from public, anon, authenticated;
revoke all on all functions in schema mahjong from public, anon, authenticated;
revoke all on all functions in schema mahjong_private from public, anon, authenticated;
alter default privileges in schema mahjong revoke all on tables from public, anon, authenticated;
alter default privileges in schema mahjong revoke all on sequences from public, anon, authenticated;
alter default privileges in schema mahjong revoke all on functions from public, anon, authenticated;
alter default privileges in schema mahjong_private revoke all on functions from public, anon, authenticated;
