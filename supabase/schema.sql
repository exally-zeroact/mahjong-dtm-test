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
  check (coalesce(rules->>'kyotaku_end', 'top') in ('top', 'kieru')),
  -- ★数に換えるのは数の時だけ（AND の並びは倉庫が守らない＝case で分ける）
  check (case when rules->'rate' is null or jsonb_typeof(rules->'rate') = 'null' then true
              when jsonb_typeof(rules->'rate') = 'number'
                then (rules->>'rate')::numeric between 10 and 100000 and (rules->>'rate')::numeric % 10 = 0
              else false end)
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

-- ── 開催日 ─────────────────────────────────────────────────────────────
create table if not exists mahjong.sessions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references mahjong.rooms(id) on delete cascade,
  league_id    uuid references mahjong.leagues(id) on delete cascade,
  date         date not null,
  place        text check (place is null or char_length(place) <= 40),
  voided       boolean not null default false,
  rate         int check (rate is null or (rate between 10 and 100000 and rate % 10 = 0)),
  rule_set_id  uuid not null,
  rule_version int  not null,
  version      int not null default 1 check (version >= 1),
  created_at   timestamptz not null default now(),
  foreign key (rule_set_id, rule_version) references mahjong.rule_sets(id, version)
);
create index if not exists sessions_room on mahjong.sessions(room_id, date);

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
  rate         int check (rate is null or (rate between 10 and 100000 and rate % 10 = 0)),
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
  -- 消えた供託（ルールが「消える」の時だけ非0・写しに鍵が無い半荘は非0が入らない・S4）
  check (lost_kyotaku between 0 and 20000 and lost_kyotaku % 1000 = 0
         and (lost_kyotaku = 0 or coalesce(rules_snapshot->>'kyotaku_end', '') = 'kieru')),
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
  value             int not null check (value between -200000 and 200000),
  version           int not null default 1 check (version >= 1),
  updated_by_device uuid,
  updated_at        timestamptz not null default now(),
  primary key (hanchan_id, seat)
);
alter table mahjong.cells add column if not exists updated_by_user uuid;
alter table mahjong.cells drop constraint if exists cells_no_device;
alter table mahjong.cells add constraint cells_no_device check (updated_by_device is null);

-- ── 卓のチップ・祝儀の枚（卓ごと・人ごと） ─────────────────────────────────
create table if not exists mahjong.extras (
  table_id          uuid not null references mahjong.tables(id) on delete cascade,
  member_id         uuid not null references mahjong.members(id) on delete cascade,
  kind              text not null check (kind in ('chip', 'shugi')),
  value             int not null check (value between -999 and 999),
  version           int not null default 1 check (version >= 1),
  updated_by_device uuid,
  updated_at        timestamptz not null default now(),
  primary key (table_id, member_id, kind)
);
alter table mahjong.extras add column if not exists updated_by_user uuid;
alter table mahjong.extras drop constraint if exists extras_no_device;
alter table mahjong.extras add constraint extras_no_device check (updated_by_device is null);

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
  joined_via   text not null check (joined_via in ('pass', 'url', 'create', 'import')),
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

-- ── 部屋から出した人の印（案 room_join v1.1 N4）＝account_remove（2c）が足す・room_secret（2c・必ずパスと URL を全部変える）が部屋の分を全部消す ──
--   mj_room_join は当たった後にここを見て removed（数えない）。上限＝mj_caps room_bans/room（満ちたら account_remove を止めて警告）
create table if not exists mahjong.room_bans (
  room_id uuid not null references mahjong.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (room_id, user_id)
);

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
  rooms_all int not null default 0 check (rooms_all >= 0)   -- 消した取り消し待ちも入れた物理の部屋の数（≦R）
);
insert into mahjong.totals (id, rooms_all) values (1, 0) on conflict (id) do nothing;

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
  ('hanchan_void',     'nyu',          'nyu',             false, true,  'unvoid',        false, 'no'),
  ('hanchan_unvoid',   'nyu',          'nyu',             false, true,  'void',          false, 'no'),
  ('cell_set',         'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('tobi_set',         'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('kyotaku_set',      'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('hanchan_order',    'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('extra_set',        'nyu',          'nyu',             false, true,  'prev',          true,  'no'),
  ('extra_add',        'nyu',          'nyu',             false, true,  'neg',           false, 'no'),
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
--   '*' の room＝P（履歴・room_accounts・room_bans 以外の全部の行＝room_bans は自分の上限 200 で数える）・history の room＝F（要約の行も数える）
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
  ('*',             'room',    30000),   -- P
  ('history',       'room',    10000),   -- F
  ('members',       'room',    300),
  ('sessions',      'room',    3000),
  ('tables',        'session', 10),
  ('hanchans',      'table',   60),
  ('leagues',       'room',    50),
  ('rule_sets',     'room',    500),
  ('room_accounts', 'room',    200),     -- 1部屋の人（人×部屋の行）
  ('admins',        'room',    5),       -- 管の人（持ち主も数える）
  ('room_bans',     'room',    200),     -- 出した人の印（満ちたら account_remove を止める）
  ('op_results',    'room',    10000),
  ('rooms',         'all',     200)      -- R（消した取り消し待ちも数える）
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

-- ── ルールの鍵の表（★正本★・種は下の rk 札で囲んだ jsonb の字1本＝lib/rules.mjs の RULE_KEYS と同じ・tests/rules-keys.test.mjs が CI で比べる）──
-- ★鍵を後から足す日は、新しい鍵の既定を「足す前の振る舞い」と同じ値に限る（古い rules_snapshot の pt を変えない）★
create table if not exists mahjong.mj_rule_keys (
  key      text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  kind     text not null check (kind in ('int', 'enum', 'bool', 'uma')),
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
  {"key":"hakoshita","kind":"bool","min":null,"max":null,"step":null,"vals":null,"nullable":false,"def4":false,"def3":false,"need":false},
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
  {"key":"rate","kind":"int","min":10,"max":100000,"step":10,"vals":null,"nullable":true,"def4":null,"def3":null,"need":false},
  {"key":"renpu_fu","kind":"enum","min":null,"max":null,"step":null,"vals":[2,4],"nullable":false,"def4":4,"def3":4,"need":false},
  {"key":"return_pts","kind":"int","min":1000,"max":200000,"step":100,"vals":null,"nullable":false,"def4":30000,"def3":40000,"need":false},
  {"key":"round","kind":"enum","min":null,"max":null,"step":null,"vals":["gosha","shisha","kirisute","none"],"nullable":false,"def4":"gosha","def3":"gosha","need":false},
  {"key":"shugi_pt10","kind":"int","min":1,"max":9999,"step":1,"vals":null,"nullable":true,"def4":null,"def3":null,"need":false},
  {"key":"start_pts","kind":"int","min":1000,"max":200000,"step":100,"vals":null,"nullable":false,"def4":25000,"def3":35000,"need":false},
  {"key":"tenpai_ryo","kind":"int","min":0,"max":30000,"step":1000,"vals":null,"nullable":false,"def4":3000,"def3":3000,"need":false},
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
  {"key":"yakitori_pt","kind":"int","min":0,"max":999,"step":1,"vals":null,"nullable":false,"def4":0,"def3":0,"need":false}
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
create or replace function mahjong_private.mj_needs_order(p_rules jsonb, p_cells jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $fn$
declare
  n int; hako boolean; e jsonb; x numeric; seen numeric[] := '{}';
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
    if x = any(seen) then return '["tie"]'::jsonb; end if;
    seen := seen || x;
  end loop;
  return '[]'::jsonb;
end $fn$;
revoke all on function mahjong_private.mj_needs_order(jsonb, jsonb) from public, anon, authenticated;

-- ── パスのそろえた字（lib/common-pass.mjs の passKey と同じ手順・版1）─────────────────────
--   ① NFKC（全角の数字・英字を半角に＝日本語の打ち方で「１２３４」と打っても同じパス）② 英字 A〜Z だけ小文字
--   （lower() は場所の設定で変わるので使わない・カナや空白は変えない＝mj_name_key は借りない）
--   ★bf にかけるのもこのそろえた字★（端末ごとの打ち方の違いで入れなくならない・mj_room_join も同じ物を通す）
create or replace function mahjong_private.mj_pass_key(p_pass text) returns text
language sql immutable strict parallel safe set search_path = '' as $fn$
  select pg_catalog.translate(pg_catalog.normalize(p_pass, 'NFKC'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$fn$;
revoke all on function mahjong_private.mj_pass_key(text) from public, anon, authenticated;

-- ── よくあるパスの名簿（★正本は下の cp 札で囲んだ jsonb の字1本＝lib/common-pass.mjs の COMMON_PASS と同じ・
--    tests/common-pass.test.mjs が CI で比べる）・字はそろえた後の形で持つ・種に無い行は消す ──────────────
create table if not exists mahjong.mj_common_pass (
  key text primary key check (char_length(key) between 1 and 64)
);
do $cpdo$
declare seed jsonb := $cp$["0000","000000","0123","01234","012345","1004","1111","111111","1122","1212","1234","12345","123456","1234567","12345678","123456789","1234567890","1313","1357","1990","1q2w3e4r","1qaz2wsx","2000","2010","2020","2021","2022","2023","2024","2025","2026","2222","222222","2468","2580","3333","333333","4321","4444","444444","4649","54321","5555","555555","654321","6666","666666","6969","7777","777777","7890","8888","888888","987654321","9999","999999","aaaa","aaaaaa","abc123","abcd","abcd1234","abcdef","admin","admin123","asdf","asdfgh","asdfghjkl","dothemath","dragon","guest","iloveyou","letmein","login","maajan","mahjong","mahjong1","majan","master","monkey","pass","pass1234","passw0rd","password","password1","qazwsx","qwerty","qwerty123","qwertyuiop","riichi","root","sunshine","test","test1234","tsumo","user","welcome","zxcv","zxcvbnm","まーじゃん","マージャン"]$cp$;
begin
  insert into mahjong.mj_common_pass (key)
    select e #>> '{}' from pg_catalog.jsonb_array_elements(seed) e
    on conflict (key) do nothing;
  delete from mahjong.mj_common_pass c
   where c.key not in (select e #>> '{}' from pg_catalog.jsonb_array_elements(seed) e);
end $cpdo$;

-- ── 呼んだ人（v18 C・K-10）＝全部の入口の頭で呼ぶ・null＝弾く（{ok:false, err:'mj_session'}） ─────────────
--   auth.uid() の人が auth.users に在り（匿名でない・止められていない・消されていない）、かつ jwt の session_id が
--   auth.sessions に在る（signOut 済みの古い access token を最大1時間生かさない・not_after 切れも弾く）時だけ uid を返す。
--   uuid に直せない字・claim が無い時も null（閉じる側）。初めての人は accounts を作る・last_seen は1分に1回だけ書く。
--   ★関数の持ち主（postgres）は auth.users・auth.sessions を読める＝I-7①（khaw 11-20 測り）★
create or replace function mahjong_private.mj_me() returns uuid
language plpgsql volatile set search_path = '' as $fn$
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
  insert into mahjong.accounts as a (user_id) values (v_uid)
    on conflict (user_id) do update set last_seen = pg_catalog.now()
    where a.last_seen < pg_catalog.now() - interval '1 minute';
  return v_uid;
end $fn$;
revoke all on function mahjong_private.mj_me() from public, anon, authenticated;

-- ── ついでの掃除（段2b-2・案 mahjong_tataki_2026-11-20/sweep_sekkei.md v1.2＝設計前 taiketsu 止め3→叩き直し 止め1→止め0）──
-- 呼ぶのは入口（mj_room_create・mj_room_join）の ok:true を返す直前だけ（外側も begin … exception で包む＝掃除が落ちても入口の返しは変わらない）。
-- ★待たない★＝取る行は全部 for update skip locked・関数に lock_timeout 50ms（取れない待ちは 55P03 でその手順の塊だけ戻る）。
-- 手順（各々が別の塊・別の枠 p_max＝試験で切れ目を動かす・入口からは既定の 100）。順は本体の押さえる順（rooms→totals→limits）を崩さない：
--   1 部屋の物理の消し（いちばん古い1部屋）＝ⓐ 消して7日 ｜ ⓑ 空の部屋（7日誰も書かず・誰も来ず・半荘0）
--     1-a 子の行の合計（cells・tobi・rule_sets も入れる）が p_max 以下＝totals を skip locked で取れたら hanchans→tables→sessions→room_accounts→devices を明に消してから rooms（残りは cascade）・rooms_all −1
--         （sessions・tables・hanchans の rule_sets への外部キーは NO ACTION＝rooms の cascade に任せると順で落ちる＝v1.2）
--     1-b 大きい部屋＝ⓑ は deleted_at を付けるだけ（以後 gone・7日の間は戻せる）／ⓐ は子を決まった順に枠の数だけ消す（hanchans は cells・tobi が付く＝残り÷9・rule_sets は sessions の後で rooms が指す1行と開催日・卓・半荘が指す版を除く＝S1・1回の掃除は手順ごとに p_max 行まで＝設計図 §3.2）
--     塊が落ちた部屋は limits ('sweep:bad', 部屋, 今日) の印＝その日は飛ばす
--   4 totals の数え直し（1日1回・印 sweep:recount）  2 入の room_accounts 180日（持ち主とその部屋のリーグの L は残す・members.user_id は残す）
--   3 古い行＝op_results 7日・creates 2日・limits（kind の終わり 1m＝10分・1h＝2時間・1d／u1d／sweep:*＝2日・★他の kind は消さず log★）
create or replace function mahjong_private.mj_sweep(p_max int default 100) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '50ms' as $fn$
declare
  v_max  int := greatest(coalesce(p_max, 100), 1);
  v_room uuid; v_del timestamptz; v_rs uuid; v_rv int; v_n bigint; v_left bigint; v_d bigint; v_all int; v_real bigint;
  v_day  timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
begin
  -- ── 1 部屋の物理の消し ──
  begin
    select x.id, x.deleted_at, x.rule_set_id, x.rule_version into v_room, v_del, v_rs, v_rv from mahjong.rooms x
     where (x.deleted_at < pg_catalog.now() - interval '7 days'
            or (x.deleted_at is null and x.created_at < pg_catalog.now() - interval '7 days'
                and (x.last_write_at is null or x.last_write_at < pg_catalog.now() - interval '7 days')
                and not exists (select 1 from mahjong.hanchans h where h.room_id = x.id)
                and not exists (select 1 from mahjong.room_accounts a where a.room_id = x.id and a.last_seen >= pg_catalog.now() - interval '7 days')))
       and not exists (select 1 from mahjong.limits l where l.kind = 'sweep:bad' and l.key = x.id::text and l.window_start = v_day)
     order by coalesce(x.deleted_at, x.created_at), x.id
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
          delete from mahjong.devices z where z.room_id = v_room;
          delete from mahjong.rooms x where x.id = v_room;
          update mahjong.totals set rooms_all = greatest(rooms_all - 1, 0) where id = 1;
        end if;
      elsif v_del is null then
        -- 1-b ⓑ 大きい空の部屋＝消した印だけ（入口は gone・7日の間は持ち主が戻せる）
        update mahjong.rooms x set deleted_at = pg_catalog.now() where x.id = v_room;
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

  -- ── 4 totals の数え直し（1日1回） ──
  begin
    select t.rooms_all into v_all from mahjong.totals t where t.id = 1 for update skip locked;
    if found then
      insert into mahjong.limits (kind, key, window_start, count) values ('sweep:recount', '*', v_day, 1)
        on conflict (kind, key, window_start) do nothing;
      get diagnostics v_d = row_count;
      if v_d = 1 then
        select pg_catalog.count(*) into v_real from mahjong.rooms;
        if v_real <> v_all then
          raise log 'mj_sweep recount % -> %', v_all, v_real;
          update mahjong.totals set rooms_all = v_real where id = 1;
        end if;
      end if;
    end if;
  exception when others then
    raise log 'mj_sweep recount %', sqlstate;
  end;

  -- ── 2 入の room_accounts 180日（持ち主・その部屋のリーグの L は残す） ──
  begin
    delete from mahjong.room_accounts z where z.ctid = any(array(
      select a.ctid from mahjong.room_accounts a join mahjong.rooms x on x.id = a.room_id
       where a.role = 'nyu' and a.last_seen < pg_catalog.now() - interval '180 days'
         and a.user_id is distinct from x.owner_user_id
         and not exists (select 1 from mahjong.leagues g where g.room_id = a.room_id and g.owner_user_id = a.user_id)
       limit v_max for update of a skip locked));
  exception when others then
    raise log 'mj_sweep nyu %', sqlstate;
  end;

  -- ── 3 古い行 ──
  begin
    delete from mahjong.op_results z where z.ctid = any(array(
      select y.ctid from mahjong.op_results y where y.at < pg_catalog.now() - interval '7 days' limit v_max for update skip locked));
  exception when others then
    raise log 'mj_sweep op_results %', sqlstate;
  end;
  begin
    delete from mahjong.creates z where z.ctid = any(array(
      select y.ctid from mahjong.creates y where y.at < pg_catalog.now() - interval '2 days' limit v_max for update skip locked));
  exception when others then
    raise log 'mj_sweep creates %', sqlstate;
  end;
  begin
    delete from mahjong.limits z where z.ctid = any(array(
      select y.ctid from mahjong.limits y
       where (y.kind like '%1m' and y.window_start < pg_catalog.now() - interval '10 minutes')
          or (y.kind like '%1h' and y.window_start < pg_catalog.now() - interval '2 hours')
          or ((y.kind like '%1d' or y.kind like 'sweep:%') and y.window_start < pg_catalog.now() - interval '2 days')
       limit v_max for update skip locked));
    if exists (select 1 from mahjong.limits y where not (y.kind like '%1m' or y.kind like '%1h' or y.kind like '%1d' or y.kind like 'sweep:%')) then
      raise log 'mj_sweep limits: kind に窓が無い行がある（消さない）';
    end if;
  exception when others then
    raise log 'mj_sweep limits %', sqlstate;
  end;
end $fn$;
revoke all on function mahjong_private.mj_sweep(int) from public, anon, authenticated;

-- ── 入口1本目：部屋を作る（設計図 §2・§3.0・§3.1・§3.2・案 v18_login_sekkei.md G＋前の叩き room_create_tome.txt 止め2直し5）──
-- ⓪ 呼んだ人＝mj_me（null なら {ok:false, err:'mj_session'}＝画面は「ログインが切れました」・K-10）。作った人が持ち主で管。
-- p_secrets＝{url_token_hash} の1つだけ（128bit 乱数の sha256＝小文字 hex 64字）。channel_key は倉庫が作る（16 byte の乱数の hex）。
-- 返し：{ok:true, room_id, room_no, channel_key} ／ {ok:false, err:'mj_session'｜'mj_op_other_user'｜'bad', what｜'range', key｜
--   'common'｜'gone'｜'mismatch'｜'dup', what｜'full'｜'busy', what(all｜user｜room_no)}。
--   ★ok でない返しは creates・limits・totals・部屋に何も残さない★（S1・N2）＝残るのは mj_me の accounts の行だけ（人の印・数えではない）
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
  v_me    uuid; v_name text; v_key text; v_rules jsonb; v_url text;
  v_all   int; v_cap int; v_room uuid; v_cuser uuid; v_rs uuid; v_no text; v_ch text;
  v_n     bigint; v_i int; v_m1 int; v_d1 int; v_u1 int; v_err text; v_cons text;
  v_min   timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_hour  timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  r       record;
begin
  -- ⓪ 人（K-10）
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;

  -- ① 形（数えに入れない）
  if p_op_id is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'op_id'); end if;
  v_name := pg_catalog.btrim(coalesce(p_name, ''), c_trim);
  if pg_catalog.char_length(v_name) not between 1 and 40 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'name');
  end if;
  if p_pass is null or pg_catalog.char_length(p_pass) not between 4 and 64 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
  end if;
  v_key := mahjong_private.mj_pass_key(p_pass);
  if pg_catalog.octet_length(v_key) > 72 or pg_catalog.char_length(v_key) not between 4 and 64 then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass');
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

  -- ③ よくあるパス
  if exists (select 1 from mahjong.mj_common_pass c where c.key = v_key) then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'common');
  end if;

  -- ④ 作るを全体で1列に並べる
  select t.rooms_all into v_all from mahjong.totals t where t.id = 1 for update;

  -- ⑤ 送り直し（N1）＝同じ op_id は作らずに同じ返し（数えに入れない）・別の人の op_id は返さない（K-7）
  select c.room_id, c.user_id into v_room, v_cuser from mahjong.creates c where c.op_id = p_op_id;
  if found then
    if v_cuser is distinct from v_me then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_op_other_user'); end if;
    select x.id, x.room_no, x.channel_key, x.url_token_hash, x.deleted_at into r from mahjong.rooms x where x.id = v_room;
    if not found or r.deleted_at is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    if r.url_token_hash <> v_url then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mismatch'); end if;
    begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
    return pg_catalog.jsonb_build_object('ok', true, 'room_id', r.id, 'room_no', r.room_no, 'channel_key', r.channel_key);
  end if;

  -- ⑥ 一意の当たりを bf の前に（S1）
  if exists (select 1 from mahjong.rooms x where x.url_token_hash = v_url) then
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'what', 'url_token_hash');
  end if;

  -- ⑦ 物理の部屋の数が R−20 に達したら作らない
  select m.cap into v_cap from mahjong.mj_caps m where m.tbl = 'rooms' and m.scope = 'all';
  if v_cap is null or v_all >= v_cap - 20 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'full'); end if;

  -- ⑧ 作るの数え（足す前に見る＝busy の時は何も足さない・N2）＝全体 → 人ごと（v18 G）
  select coalesce(pg_catalog.sum(l.count), 0) into v_m1 from mahjong.limits l
   where l.kind = 'create:1m' and l.key = 'all' and l.window_start = v_min;
  select coalesce(pg_catalog.sum(l.count), 0) into v_d1 from mahjong.limits l
   where l.kind = 'create:1d' and l.key = 'all' and l.window_start > pg_catalog.now() - interval '24 hours';
  if v_m1 + 1 > 20 or v_d1 + 1 > 200 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'all'); end if;
  select coalesce(pg_catalog.sum(l.count), 0) into v_u1 from mahjong.limits l
   where l.kind = 'create:u1d' and l.key = v_me::text and l.window_start > pg_catalog.now() - interval '24 hours';
  if v_u1 + 1 > 5 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user'); end if;

  -- ⑨ 部屋番号＝4 byte の乱数（4,200,000,000 以上は引き直し＝偏りなし）の 1e8 の余りを8桁前0・最大8回
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
                               rule_set_id, rule_version, row_count)
    values (v_room, v_name, v_no, extensions.crypt(v_key, extensions.gen_salt('bf', 10)), v_url, v_me, v_ch, v_rs, 1, 1);
    insert into mahjong.rule_sets (id, version, room_id, rules) values (v_rs, 1, v_room, v_rules);
    insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (v_room, v_me, 'kan', 'create');
    insert into mahjong.creates (op_id, room_id, user_id) values (p_op_id, v_room, v_me);
    update mahjong.totals set rooms_all = rooms_all + 1 where id = 1;
    delete from mahjong.limits l where l.kind = 'create:1m' and l.key = 'all' and l.window_start < v_min;
    delete from mahjong.limits l where l.kind = 'create:1d' and l.key = 'all' and l.window_start <= pg_catalog.now() - interval '24 hours';
    delete from mahjong.limits l where l.kind = 'create:u1d' and l.key = v_me::text and l.window_start <= pg_catalog.now() - interval '24 hours';
    insert into mahjong.limits (kind, key, window_start, count) values ('create:1m', 'all', v_min, 1)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
    insert into mahjong.limits (kind, key, window_start, count) values ('create:1d', 'all', v_hour, 1)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
    insert into mahjong.limits (kind, key, window_start, count) values ('create:u1d', v_me::text, v_hour, 1)
      on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'dup', 'what',
      case v_cons when 'rooms_url_token_hash_key' then 'url_token_hash'
                  when 'rooms_room_no_key' then 'room_no' when 'rooms_channel_key_key' then 'channel_key'
                  when 'creates_pkey' then 'op_id' else 'other' end);
  end;
  begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
  return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'channel_key', v_ch);
end $fn$;
revoke all on function public.mj_room_create(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mj_room_create(uuid, text, text, jsonb, jsonb) to authenticated;

-- ── 入口2本目：部屋に入る（案 tataki/room_join_sekkei.md v1.2＝設計前 taiketsu 止め2直し6・叩き直し 止め1直し2 → 止め0）──
-- ⓪ 人＝mj_me。way＝'pass'（部屋番号8桁＋パス）｜'url'（URL の token の平文＝小文字 hex 32字＝lib/url-token.mjs・倉庫が sha256 にして比べる）。
-- 送り直しは op_id でなく一意 (room_id, user_id)＝同じ人は同じ行（again）。join は履歴を書かない（K-1 に join の op は無い）。
-- 返し：{ok:true, room_id, room_no, name, channel_key, role, again} ／ {ok:false, err:'mj_session'｜'bad', what｜'wrong'｜'locked', until｜
--   'busy', what(all｜user｜room)｜'gone'｜'full'｜'removed'}。★数えを残す ok でない返しは wrong だけ★（外れの数え）。
-- 走る順：⓪ 人 → ① 形 → ② 部屋を押さえずに引く → ⑤ 入っている人は数えも bf も見ずに again（rooms を押さえない）
--   → ③ 人ごとの外れ 1分10 → ④ pass だけ全体の外れ 1分100 → 無い部屋（pass はふりの bf 1回）→ ⑥ 消した部屋 → ⑦ locked
--   → ⑧ bf（★押さえの外★）→ 部屋を for no key update で押さえて引き直す（変わっていれば wrong で数えない・行が無ければ gone）
--   → 外れ＝fail_count と limits → ⑨ もう一度入っているか → bans → 200人 → 1時間60 → 書く。
-- 押さえる順（§3.2）＝accounts（mj_me）→ rooms（その1部屋）→ limits（(kind,key) の字の順＝join:fail1m → join:ok1h → join:ufail1m）。
-- 残余：⑤は rooms を押さえない＝同時に account_remove・room_delete が通ると1回だけ again が返る（次の呼びで removed／gone）。
-- ★平文のパス・token は どの表にも・raise の字にも入れない★
create or replace function public.mj_room_join(p_way text, p_room_no text, p_key text, p_pass text)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c_dummy constant text := '$2a$10$' || 'mjdummysaltmjdummysalt';   -- ふりの bf の塩（cost 10＝本物と同じ重さ・22字）
  v_me   uuid; v_pk text; v_uh text; v_found boolean; v_ok boolean := false; v_role text;
  v_room uuid; v_no text; v_name text; v_ch text; v_hash text; v_url text; v_del timestamptz; v_lock timestamptz;
  v_n    bigint; v_cap int;
  v_min  timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_5m   timestamptz := pg_catalog.date_bin('5 minutes', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');
  r      record;
begin
  -- ⓪ 人（K-10）
  v_me := mahjong_private.mj_me();
  if v_me is null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'mj_session'); end if;

  -- ① 形（数えに入れない・何も残さない）＝使わない方の引数が在っても bad（取り違えを黙って通さない）
  if p_way is null or p_way not in ('pass', 'url') then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'way'); end if;
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
    select x.id, x.room_no, x.name, x.channel_key, x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until
      into v_room, v_no, v_name, v_ch, v_hash, v_url, v_del, v_lock
      from mahjong.rooms x where x.room_no = p_room_no;
  else
    if p_room_no is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'room_no'); end if;
    if p_pass is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'pass'); end if;
    if p_key is null or p_key !~ '^[0-9a-f]{32}$' then return pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'what', 'key'); end if;
    v_uh := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex');
    select x.id, x.room_no, x.name, x.channel_key, x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until
      into v_room, v_no, v_name, v_ch, v_hash, v_url, v_del, v_lock
      from mahjong.rooms x where x.url_token_hash = v_uh;
  end if;
  v_found := found;

  -- ⑤ 入っている人＝数えも bf も locked も見ない（S1）・fail_count は触らない（N3）・rooms は押さえない
  if v_found then
    select a.role into v_role from mahjong.room_accounts a where a.room_id = v_room and a.user_id = v_me;
    if found then
      if v_del is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
      update mahjong.room_accounts a set last_seen = pg_catalog.now() where a.room_id = v_room and a.user_id = v_me;
      begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
      return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
        'channel_key', v_ch, 'role', v_role, 'again', true);
    end if;
  end if;

  -- ③ 人ごとの外れ 1分10（pass・url とも・bf の前）
  select coalesce(pg_catalog.sum(l.count), 0) into v_n from mahjong.limits l
   where l.kind = 'join:ufail1m' and l.key = v_me::text and l.window_start = v_min;
  if v_n >= 10 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'user'); end if;
  -- ④ pass だけ：全体の外れ 1分100（URL は止めない）
  if p_way = 'pass' then
    select coalesce(pg_catalog.sum(l.count), 0) into v_n from mahjong.limits l
     where l.kind = 'join:fail1m' and l.key = 'all' and l.window_start = v_min;
    if v_n >= 100 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'all'); end if;
  end if;

  if v_found then
    -- ⑥ 消した部屋（bf の前＝消した部屋のパスは試せない・在り無しは見える＝残余）
    if v_del is not null then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    -- ⑦ pass だけ：止めている部屋（bf をしない・数えない）
    if p_way = 'pass' and v_lock is not null and v_lock > pg_catalog.now() then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', v_lock);
    end if;
    -- ⑧ 比べ（★押さえの外★＝bf の間、同じ部屋の again・書き込みを待たせない）
    if p_way = 'pass' then
      v_ok := extensions.crypt(v_pk, v_hash) = v_hash;
    else
      v_ok := true;
    end if;
    -- 押さえて引き直す（v1.1 直し1・v1.2 直し1）
    select x.pass_hash, x.url_token_hash, x.deleted_at, x.locked_until, x.fail_count into r
      from mahjong.rooms x where x.id = v_room for no key update;
    if not found then return pg_catalog.jsonb_build_object('ok', false, 'err', 'gone'); end if;
    if r.pass_hash <> v_hash or r.url_token_hash <> v_url or r.deleted_at is distinct from v_del then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'wrong');            -- 間に room_secret・room_delete が通った＝数えない
    end if;
    if p_way = 'pass' and r.locked_until is not null and r.locked_until > pg_catalog.now() then
      return pg_catalog.jsonb_build_object('ok', false, 'err', 'locked', 'until', r.locked_until);
    end if;
  elsif p_way = 'pass' then
    perform extensions.crypt(v_pk, c_dummy);                                          -- 無い番号もふりの bf 1回（時間をそろえる）
  end if;

  -- 外れ＝数えを残す（この返しだけ）。rooms → limits の順・limits は (kind,key) の字の順
  if not v_ok then
    if v_found then
      update mahjong.rooms x set
        fail_count   = case when x.fail_count + 1 >= 5 then 0 else x.fail_count + 1 end,
        locked_until = case when x.fail_count + 1 >= 5 then pg_catalog.now() + interval '15 minutes' else x.locked_until end
       where x.id = v_room;
    end if;
    if p_way = 'pass' then
      delete from mahjong.limits l where l.kind = 'join:fail1m' and l.key = 'all' and l.window_start < v_min;
      insert into mahjong.limits (kind, key, window_start, count) values ('join:fail1m', 'all', v_min, 1)
        on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
    end if;
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
  select m.cap into v_cap from mahjong.mj_caps m where m.tbl = 'room_accounts' and m.scope = 'room';
  select pg_catalog.count(*) into v_n from mahjong.room_accounts a where a.room_id = v_room;
  if v_cap is null or v_n >= v_cap then return pg_catalog.jsonb_build_object('ok', false, 'err', 'full'); end if;
  select coalesce(pg_catalog.sum(l.count), 0) into v_n from mahjong.limits l
   where l.kind = 'join:ok1h' and l.key = v_room::text and l.window_start > pg_catalog.now() - interval '1 hour';
  if v_n >= 60 then return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'room'); end if;

  insert into mahjong.room_accounts (room_id, user_id, role, joined_via) values (v_room, v_me, 'nyu', p_way);
  if p_way = 'pass' then update mahjong.rooms x set fail_count = 0 where x.id = v_room and x.fail_count <> 0; end if;
  delete from mahjong.limits l where l.kind = 'join:ok1h' and l.key = v_room::text and l.window_start <= pg_catalog.now() - interval '1 hour';
  insert into mahjong.limits (kind, key, window_start, count) values ('join:ok1h', v_room::text, v_5m, 1)
    on conflict (kind, key, window_start) do update set count = mahjong.limits.count + 1;
  -- ⑩ ついでの掃除＝返しを決めた後・return の直前（§3.2・2b-2）
  begin perform mahjong_private.mj_sweep(); exception when others then raise log 'mj_sweep %', sqlstate; end;   -- 2b-2 ついでの掃除（ok の返しの直前だけ）
  return pg_catalog.jsonb_build_object('ok', true, 'room_id', v_room, 'room_no', v_no, 'name', v_name,
    'channel_key', v_ch, 'role', 'nyu', 'again', false);
end $fn$;
revoke all on function public.mj_room_join(text, text, text, text) from public, anon, authenticated;
grant execute on function public.mj_room_join(text, text, text, text) to authenticated;

-- ══ 段2c-1：書く入口 public.mj_write（案 mahjong_tataki_2026-11-20/write_sekkei.md v5.2）══════════════
-- op は画面が今送る12個だけ（member_add・session_add・table_add・hanchan_start・hanchan_order・cell_set・tobi_set・
--   kyotaku_set・extra_add・settle_snap・hanchan_void・hanchan_unvoid）。残り22個は not_yet（2c-2）。
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
-- チップ・祝儀は種ごとの state（unused＝ルールで使わない）。extra_state は「使う種が全部 ok なら ok・どれか ng なら ng」
alter table mahjong.tables add column if not exists chip_state text not null default 'unused';
alter table mahjong.tables add column if not exists shugi_state text not null default 'unused';
alter table mahjong.tables drop constraint if exists tables_chip_state_ok;
alter table mahjong.tables add constraint tables_chip_state_ok check (chip_state in ('ok', 'ng', 'unused'));
alter table mahjong.tables drop constraint if exists tables_shugi_state_ok;
alter table mahjong.tables add constraint tables_shugi_state_ok check (shugi_state in ('ok', 'ng', 'unused'));
-- 表 mahjong.tobi は使わない（書く関数が無い・飛び賞は hanchans.tobi_to）。2c-2 で行0を数えてから消す
--   （その時 tests/db-checks.live.mjs:66-67・tests/sweep.live.mjs:79・mj_sweep の tobi の数えも一緒に直す）。

-- 飛び賞の形（CHECK と mj_write が同じ物を呼ぶ）：object・鍵は '0'〜players−1・値は鍵と違う 0〜players−1 の整数か "all"
create or replace function mahjong_private.mj_tobi_ok(p jsonb, p_players smallint) returns boolean
language plpgsql immutable set search_path = '' as $fn$
declare
  e record; k int; x numeric;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then return false; end if;
  if p_players is null or p_players not in (3, 4) then return false; end if;
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

-- 卓を引いて押さえる（違う部屋・無い → bad／リーグの日 → not_yet＝who_league は 2c-2）
create or replace function mahjong_private.mj_w_t(p_room uuid, p_tid uuid, p_i int) returns mahjong.tables
language plpgsql set search_path = '' as $fn$
declare t mahjong.tables;
begin
  select x.* into t from mahjong.tables x where x.id = p_tid and x.room_id = p_room for update;
  if not found then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
  if exists (select 1 from mahjong.sessions s where s.id = t.session_id and s.league_id is not null) then
    perform mahjong_private.mj_w_bad(p_i, 'league', 'not_yet');
  end if;
  return t;
end $fn$;
revoke all on function mahjong_private.mj_w_t(uuid, uuid, int) from public, anon, authenticated;

-- 半荘を引いて押さえる（同じ決め）
create or replace function mahjong_private.mj_w_h(p_room uuid, p_hid uuid, p_i int) returns mahjong.hanchans
language plpgsql set search_path = '' as $fn$
declare h mahjong.hanchans;
begin
  select x.* into h from mahjong.hanchans x where x.id = p_hid and x.room_id = p_room for update;
  if not found then perform mahjong_private.mj_w_bad(p_i, 'hanchan_id'); end if;
  if exists (select 1 from mahjong.tables t join mahjong.sessions s on s.id = t.session_id
              where t.id = h.table_id and s.league_id is not null) then
    perform mahjong_private.mj_w_bad(p_i, 'league', 'not_yet');
  end if;
  return h;
end $fn$;
revoke all on function mahjong_private.mj_w_h(uuid, uuid, int) from public, anon, authenticated;

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
  elsif mahjong_private.mj_needs_order(rs, v_cells) ? 'tie' and h.ton_order is null then
    v_st := 'input'; v_why := 'order';
  elsif exists (select 1 from pg_catalog.jsonb_array_elements(mahjong_private.mj_w_busted(p_hid)) t(v) where not (h.tobi_to ? (t.v::text))) then
    v_st := 'input'; v_why := 'tobi';
  else
    v_st := 'ok'; v_why := null;
  end if;
  update mahjong.hanchans x set state = v_st, state_reason = v_why,
    first_complete_at = case when v_st = 'ok' and x.first_complete_at is null then pg_catalog.now() else x.first_complete_at end
   where x.id = p_hid
     and (x.state is distinct from v_st or x.state_reason is distinct from v_why or (v_st = 'ok' and x.first_complete_at is null));
end $fn$;
revoke all on function mahjong_private.mj_w_hstate(uuid) from public, anon, authenticated;

-- 卓のチップ・祝儀（種ごと）：使う＝ルールの *_pt10 が JSON の null でない（鍵が無い・数でない値も使う側＝倉庫だけの守り）
--   使う種は extras のその種の合計が0なら ok・でなければ ng（行が無い＝0）。extra_state＝使う種が全部 ok なら ok
create or replace function mahjong_private.mj_w_tstate(p_tid uuid) returns void
language plpgsql set search_path = '' as $fn$
declare rs jsonb; v_c bigint; v_s bigint; v_cs text; v_ss text; v_es text;
begin
  select r.rules into rs from mahjong.tables t join mahjong.rule_sets r on r.id = t.rule_set_id and r.version = t.rule_version
   where t.id = p_tid for update of t;
  if not found then return; end if;
  select coalesce(pg_catalog.sum(e.value) filter (where e.kind = 'chip'), 0), coalesce(pg_catalog.sum(e.value) filter (where e.kind = 'shugi'), 0)
    into v_c, v_s from mahjong.extras e where e.table_id = p_tid;
  v_cs := case when rs -> 'chip_pt10' = 'null'::jsonb then 'unused' when v_c = 0 then 'ok' else 'ng' end;
  v_ss := case when rs -> 'shugi_pt10' = 'null'::jsonb then 'unused' when v_s = 0 then 'ok' else 'ng' end;
  v_es := case when v_cs = 'ng' or v_ss = 'ng' then 'ng' else 'ok' end;
  update mahjong.tables t set chip_state = v_cs, shugi_state = v_ss, extra_state = v_es, extra_reason = null
   where t.id = p_tid and (t.chip_state, t.shugi_state, t.extra_state, t.extra_reason) is distinct from (v_cs, v_ss, v_es, null::text);
end $fn$;
revoke all on function mahjong_private.mj_w_tstate(uuid) from public, anon, authenticated;

-- そろった後に変えた印（ok になった事のある半荘を変えた時）
create or replace function mahjong_private.mj_w_changed(p_hid uuid, p_me uuid) returns void
language plpgsql set search_path = '' as $fn$
begin
  update mahjong.hanchans x set changed_after_complete_at = pg_catalog.now(), changed_by_user = p_me
   where x.id = p_hid and x.first_complete_at is not null;
end $fn$;
revoke all on function mahjong_private.mj_w_changed(uuid, uuid) from public, anon, authenticated;

-- 書き込みの数え（§5）：分の窓＝全員 ur1m・u1m・all1m＋入だけ rn1m（max(1,n)）／24時間（時の窓24本）＝入 rn1d・管と持ち主 uk1d・rk1d・全員 all1d（n だけ）
--   p_room が null＝段①②の弾き＝u1m だけに1。古い窓は同じ取引で消す。(kind, key) の字の順に upsert
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
      ('write:all1d', 'all',      true,  case when p_room is null then 0 else v_d end),
      ('write:all1m', 'all',      false, case when p_room is null then 0 else v_m end),
      ('write:rk1d',  v_rk,       true,  case when p_room is null or not v_kan then 0 else v_d end),
      ('write:rn1d',  v_rk,       true,  case when p_room is null or not v_nyu then 0 else v_d end),
      ('write:rn1m',  v_rk,       false, case when p_room is null or not v_nyu then 0 else v_m end),
      ('write:u1m',   p_me::text, false, 1 * case when p_room is null then 1 else v_m end),
      ('write:uk1d',  v_ru,       true,  case when p_room is null or not v_kan then 0 else v_d end),
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
      ('write:all1d', 'all',      true,  p_d, 300000),
      ('write:all1m', 'all',      false, p_m, 3000),
      ('write:rk1d',  v_rk,       true,  case when v_kan then p_d else 0 end, 3000),
      ('write:rn1d',  v_rk,       true,  case when v_nyu then p_d else 0 end, 3000),
      ('write:rn1m',  v_rk,       false, case when v_nyu then p_m else 0 end, 600),
      ('write:u1m',   p_me::text, false, p_m, 300),
      ('write:uk1d',  v_ru,       true,  case when v_kan then p_d else 0 end, 600),
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

-- 1つの op を当てる（§3）。返し＝{r:{i, v?}, made, hist, h?, t?, fresh?, cap?:{tbl, id}}
create or replace function mahjong_private.mj_w_op(p_room uuid, p_me uuid, p_role text, p_gid uuid, p_i int, p_o jsonb) returns jsonb
language plpgsql set search_path = '' as $fn$
declare
  c_trim constant text := ' ' || chr(9) || chr(10) || chr(13) || chr(12288);
  v_op text := p_o ->> 'op';
  v_id uuid; v_id2 uuid; v_r uuid; v_s text; v_key text; v_n int; v_x int; v_bv int; v_rc int; k int;
  v_j jsonb; v_j2 jsonb; v_j3 jsonb; v_rules jsonb; v_d date; v_rate int;
  t mahjong.tables; h mahjong.hanchans; s record; c record;
begin
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
    insert into mahjong.members (id, room_id, name, name_key) values (v_id, p_room, v_s, v_key);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'members', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('name', v_s), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1,
      'cap', pg_catalog.jsonb_build_object('tbl', 'members', 'id', p_room));

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
      if v_rate not between 10 and 100000 or v_rate % 10 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'rate', 'range'); end if;
    end if;
    v_s := null;
    if p_o -> 'place' is not null and p_o -> 'place' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_o -> 'place') <> 'string' or pg_catalog.char_length(p_o ->> 'place') > 40 then
        perform mahjong_private.mj_w_bad(p_i, 'place');
      end if;
      v_s := p_o ->> 'place';
    end if;
    select x.rule_set_id, x.rule_version into s from mahjong.rooms x where x.id = p_room;
    if s.rule_set_id is null then perform mahjong_private.mj_w_bad(p_i, 'rules'); end if;
    insert into mahjong.sessions (id, room_id, date, place, rate, rule_set_id, rule_version)
      values (v_id, p_room, v_d, v_s, v_rate, s.rule_set_id, s.rule_version);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'sessions', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('date', v_d, 'rate', v_rate, 'place', v_s), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1,
      'cap', pg_catalog.jsonb_build_object('tbl', 'sessions', 'id', p_room));

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
    if s.league_id is not null then perform mahjong_private.mj_w_bad(p_i, 'league', 'not_yet'); end if;
    if pg_catalog.jsonb_typeof(p_o -> 'label') is distinct from 'string' then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
    v_s := pg_catalog.btrim(p_o ->> 'label', c_trim);
    if pg_catalog.char_length(v_s) not between 1 and 20 then perform mahjong_private.mj_w_bad(p_i, 'label'); end if;
    select r.rules into v_rules from mahjong.rule_sets r where r.id = s.rule_set_id and r.version = s.rule_version;
    insert into mahjong.tables (id, room_id, session_id, label, players, rule_set_id, rule_version, extra_state, chip_state, shugi_state)
      values (v_id, p_room, v_id2, v_s, (v_rules ->> 'players')::smallint, s.rule_set_id, s.rule_version, 'ok', 'unused', 'unused');
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'tables', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('session_id', v_id2, 'label', v_s), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 't', v_id,
      'cap', pg_catalog.jsonb_build_object('tbl', 'tables', 'id', v_id2));

  elsif v_op = 'hanchan_start' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i);
    select x.room_id into v_r from mahjong.hanchans x where x.id = v_id;
    if found then
      if v_r <> p_room then perform mahjong_private.mj_w_bad(p_i, 'hanchan_id'); end if;
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 0, 'hist', 0);
    end if;
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i);
    if t.voided then perform mahjong_private.mj_w_bad(p_i, 'table_id'); end if;
    select r.rules into v_rules from mahjong.rule_sets r where r.id = t.rule_set_id and r.version = t.rule_version;
    v_n := t.players;
    v_j := mahjong_private.mj_w_people(p_room, p_o -> 'seats', v_n, p_i, 'seats');            -- 席の member_id（小文字）
    v_j2 := (select pg_catalog.jsonb_object_agg((t2.o - 1)::text, t2.v) from pg_catalog.jsonb_array_elements(v_j) with ordinality t2(v, o));
    if pg_catalog.jsonb_typeof(p_o -> 'cells') is distinct from 'array' or pg_catalog.jsonb_array_length(p_o -> 'cells') <> v_n then
      perform mahjong_private.mj_w_bad(p_i, 'cells');
    end if;
    for k in 0 .. v_n - 1 loop
      if pg_catalog.jsonb_typeof(p_o -> 'cells' -> k) <> 'number' or ((p_o -> 'cells' -> k)::numeric) % 1 <> 0 then
        perform mahjong_private.mj_w_bad(p_i, 'cells');
      end if;
      if ((p_o -> 'cells' -> k)::numeric) not between -200000 and 200000 or ((p_o -> 'cells' -> k)::numeric) % 100 <> 0 then
        perform mahjong_private.mj_w_bad(p_i, 'cells', 'range');
      end if;
    end loop;
    v_j3 := null;
    if p_o -> 'ton_order' is not null and p_o -> 'ton_order' <> 'null'::jsonb then
      v_j3 := mahjong_private.mj_w_people(p_room, p_o -> 'ton_order', v_n, p_i, 'ton_order', v_j2);
    end if;
    v_x := 0;
    if p_o -> 'lost' is not null and p_o -> 'lost' <> 'null'::jsonb then
      v_x := mahjong_private.mj_w_int(p_o, 'lost', p_i);
      if v_x not between 0 and 20000 or v_x % 1000 <> 0 or (v_x <> 0 and coalesce(v_rules ->> 'kyotaku_end', '') <> 'kieru') then
        perform mahjong_private.mj_w_bad(p_i, 'lost', 'range');
      end if;
    end if;
    v_rules := coalesce(v_rules, '{}'::jsonb);
    if p_o -> 'tobi_to' is not null and p_o -> 'tobi_to' <> 'null'::jsonb
       and not mahjong_private.mj_tobi_ok(p_o -> 'tobi_to', v_n::smallint) then
      perform mahjong_private.mj_w_bad(p_i, 'tobi_to');
    end if;
    insert into mahjong.hanchans (id, room_id, table_id, players, seats, ton_order, rule_set_id, rule_version, rules_snapshot,
                                  lost_kyotaku, tobi_to, created_by_user)
      values (v_id, p_room, t.id, v_n, v_j2, v_j3, t.rule_set_id, t.rule_version, v_rules, v_x,
              case when p_o -> 'tobi_to' is null or p_o -> 'tobi_to' = 'null'::jsonb then '{}'::jsonb else p_o -> 'tobi_to' end, p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', v_id), null, null,
      pg_catalog.jsonb_build_object('table_id', t.id, 'seats', v_j2, 'ton_order', v_j3, 'lost', v_x,
        'tobi_to', (select x.tobi_to from mahjong.hanchans x where x.id = v_id)), 1);
    for k in 0 .. v_n - 1 loop
      insert into mahjong.cells (hanchan_id, seat, value, updated_by_user) values (v_id, k, ((p_o -> 'cells' -> k)::numeric)::int, p_me);
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'cells', pg_catalog.jsonb_build_object('hanchan_id', v_id, 'seat', k),
        'value', null, p_o -> 'cells' -> k, 1);
    end loop;
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1 + v_n, 'hist', 1 + v_n,
      'h', v_id, 'fresh', true, 't', t.id, 'cap', pg_catalog.jsonb_build_object('tbl', 'hanchans', 'id', t.id));

  -- ── 版つきの op ──
  elsif v_op = 'cell_set' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i);
    k := mahjong_private.mj_w_int(p_o, 'seat', p_i);
    if k < 0 or k >= h.players then perform mahjong_private.mj_w_bad(p_i, 'seat'); end if;
    v_x := mahjong_private.mj_w_int(p_o, 'value', p_i);
    if v_x not between -200000 and 200000 or v_x % 100 <> 0 then perform mahjong_private.mj_w_bad(p_i, 'value', 'range'); end if;
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    select x.value, x.version into c from mahjong.cells x where x.hanchan_id = h.id and x.seat = k for update;
    if not found then raise exception 'mj_write: cells の行が無い'; end if;
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
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i);
    v_j := mahjong_private.mj_w_people(p_room, p_o -> 'ton_order', h.players, p_i, 'ton_order', h.seats);
    v_bv := mahjong_private.mj_w_int(p_o, 'base_version', p_i);
    if h.ton_order is not distinct from v_j then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.order_version), 'made', 0, 'hist', 0, 'h', h.id);
    end if;
    if v_bv <> h.order_version then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'conflict', 'i', p_i,
        'at', pg_catalog.jsonb_build_object('hanchan_id', h.id, 'what', 'order'),
        'cur', pg_catalog.jsonb_build_object('value', h.ton_order, 'version', h.order_version)));
    end if;
    update mahjong.hanchans x set ton_order = v_j, order_version = x.order_version + 1 where x.id = h.id;
    get diagnostics v_rc = row_count;
    if v_rc <> 1 then raise exception 'mj_write: hanchan_order の更新が % 行', v_rc; end if;
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'hanchans', pg_catalog.jsonb_build_object('id', h.id),
      'ton_order', h.ton_order, v_j, h.order_version + 1);
    perform mahjong_private.mj_w_changed(h.id, p_me);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.order_version + 1), 'made', 0, 'hist', 1, 'h', h.id);

  elsif v_op = 'kyotaku_set' then
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i);
    v_x := mahjong_private.mj_w_int(p_o, 'value', p_i);
    if v_x not between 0 and 20000 or v_x % 1000 <> 0 or (v_x <> 0 and coalesce(h.rules_snapshot ->> 'kyotaku_end', '') <> 'kieru') then
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
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i);
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
    h := mahjong_private.mj_w_h(p_room, mahjong_private.mj_w_uuid(p_o, 'hanchan_id', p_i), p_i);
    if h.voided = (v_op = 'hanchan_void') then
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', h.version), 'made', 0, 'hist', 0, 'h', h.id, 't', h.table_id);
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
    t := mahjong_private.mj_w_t(p_room, mahjong_private.mj_w_uuid(p_o, 'table_id', p_i), p_i);
    v_id := mahjong_private.mj_w_uuid(p_o, 'member_id', p_i);
    if not exists (select 1 from mahjong.members m where m.id = v_id and m.room_id = p_room) then
      perform mahjong_private.mj_w_bad(p_i, 'member_id');
    end if;
    if not exists (select 1 from mahjong.hanchans x where x.table_id = t.id and not x.voided
                     and exists (select 1 from pg_catalog.jsonb_each_text(x.seats) e where e.value::uuid = v_id))
       and not exists (select 1 from mahjong.extras e where e.table_id = t.id and e.member_id = v_id) then
      perform mahjong_private.mj_w_bad(p_i, 'member_id');
    end if;
    if pg_catalog.jsonb_typeof(p_o -> 'kind') is distinct from 'string' or (p_o ->> 'kind') not in ('chip', 'shugi') then
      perform mahjong_private.mj_w_bad(p_i, 'kind');
    end if;
    v_x := mahjong_private.mj_w_int(p_o, 'add', p_i);
    if v_x = 0 then perform mahjong_private.mj_w_bad(p_i, 'add'); end if;
    if v_x not between -999 and 999 then perform mahjong_private.mj_w_bad(p_i, 'add', 'range'); end if;
    select e.value, e.version into c from mahjong.extras e where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind') for update;
    if found then
      if c.value + v_x not between -999 and 999 then perform mahjong_private.mj_w_bad(p_i, 'add', 'range'); end if;
      update mahjong.extras e set value = e.value + v_x, version = e.version + 1, updated_by_user = p_me, updated_at = pg_catalog.now()
       where e.table_id = t.id and e.member_id = v_id and e.kind = (p_o ->> 'kind');
      get diagnostics v_rc = row_count;
      if v_rc <> 1 then raise exception 'mj_write: extra_add の更新が % 行', v_rc; end if;
      perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
        pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value',
        pg_catalog.to_jsonb(c.value), pg_catalog.to_jsonb(c.value + v_x), c.version + 1);
      return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', c.version + 1), 'made', 0, 'hist', 1, 't', t.id);
    end if;
    insert into mahjong.extras (table_id, member_id, kind, value, updated_by_user) values (t.id, v_id, p_o ->> 'kind', v_x, p_me);
    perform mahjong_private.mj_w_hist(p_room, p_gid, v_op, p_me, p_role, 'extras',
      pg_catalog.jsonb_build_object('table_id', t.id, 'member_id', v_id, 'kind', p_o ->> 'kind'), 'value', null, pg_catalog.to_jsonb(v_x), 1);
    return pg_catalog.jsonb_build_object('r', pg_catalog.jsonb_build_object('i', p_i, 'v', 1), 'made', 1, 'hist', 1, 't', t.id);

  elsif v_op = 'settle_snap' then
    v_id := mahjong_private.mj_w_uuid(p_o, 'session_id', p_i);
    select x.* into s from mahjong.sessions x where x.id = v_id and x.room_id = p_room for update;
    if not found then perform mahjong_private.mj_w_bad(p_i, 'session_id'); end if;
    if s.league_id is not null then perform mahjong_private.mj_w_bad(p_i, 'league', 'not_yet'); end if;
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
  end if;
  raise exception 'mj_write: 当て方の無い op %', v_op;
end $fn$;
revoke all on function mahjong_private.mj_w_op(uuid, uuid, text, uuid, int, jsonb) from public, anon, authenticated;

-- ── 入口3本目：書く ──
-- 返し：{ok:true, results:[{i, v?}]} ／ {ok:false, err:'mj_session'｜'bad'｜'too_many'｜'not_yet'｜'gone'｜'mj_op_other_user'｜
--   'busy'（what＝越えた窓・lock）｜'conflict'（i・at・cur）｜'range'｜'dup'｜'full'（what＝表）｜'internal', …}
create or replace function public.mj_write(p_room_id uuid, p_op_id uuid, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c_keys constant jsonb := '{
    "member_add": ["member_id", "name"],
    "session_add": ["session_id", "date", "rate", "place"],
    "table_add": ["table_id", "session_id", "label"],
    "hanchan_start": ["hanchan_id", "table_id", "seats", "cells", "ton_order", "lost", "tobi_to"],
    "hanchan_order": ["hanchan_id", "ton_order", "base_version"],
    "cell_set": ["hanchan_id", "seat", "value", "base_version"],
    "tobi_set": ["hanchan_id", "tobi_to", "base_version"],
    "kyotaku_set": ["hanchan_id", "value", "base_version"],
    "extra_add": ["table_id", "member_id", "kind", "add"],
    "settle_snap": ["session_id", "rev", "content", "used", "missing"],
    "hanchan_void": ["hanchan_id"],
    "hanchan_unvoid": ["hanchan_id"]}'::jsonb;
  v_me uuid; v_role text; v_ret jsonb; v_o jsonb; v_x jsonb; v_name text; v_k text; v_uid uuid; v_i int; v_len int;
  v_n int := 0; v_made int := 0; v_items jsonb := '[]'::jsonb; v_gid uuid := pg_catalog.gen_random_uuid();
  v_b0 jsonb := '{}'::jsonb; v_hs jsonb := '{}'::jsonb; v_fresh jsonb := '{}'::jsonb; v_ts jsonb := '{}'::jsonb; v_caps jsonb := '{}'::jsonb;
  v_cap int; v_c bigint; v_rid uuid; v_tbl text; v_hid text;
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
      select t.k into v_k from pg_catalog.jsonb_object_keys(v_o) t(k) where t.k <> 'op' and not ((c_keys -> v_name) ? t.k) order by t.k limit 1;
      if v_k is not null then v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'bad', 'i', v_i, 'at', v_k); exit; end if;
    end loop;
  end if;
  if v_ret is not null then perform mahjong_private.mj_w_count(null, v_me, null, 0); return v_ret; end if;

  -- ② 部屋（同じ文で押さえる＝同じ部屋の書き込みは1列に並ぶ）
  select x.id, x.owner_user_id, x.deleted_at, x.row_count, x.history_count into r
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
    return v_x;
  end if;

  -- ④ 先見（越えるなら何も書かない）
  v_k := mahjong_private.mj_w_over(p_room_id, v_me, v_role, 1, 1);
  if v_k is not null then
    perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, 0);
    return pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', v_k);
  end if;

  -- ⑤ 塊（副取引）
  begin
    for v_i in 0 .. v_len - 1 loop
      v_o := p_ops -> v_i;
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
      if v_x ? 'cap' then v_caps := v_caps || pg_catalog.jsonb_build_object((v_x -> 'cap' ->> 'tbl') || '|' || (v_x -> 'cap' ->> 'id'), true); end if;
    end loop;

    -- 組の終わりの出し直し（§4）：飛びの古い受け取り → 半荘のそろった → 卓のチップ・祝儀
    for v_k in select t.k from pg_catalog.jsonb_object_keys(v_hs) t(k) order by t.k loop
      if not (v_fresh ? v_k) and v_b0 ? v_k then
        v_n := v_n + mahjong_private.mj_w_tobi_fix(p_room_id, v_gid, v_me, v_role, v_k::uuid, v_b0 -> v_k);
      end if;
      perform mahjong_private.mj_w_hstate(v_k::uuid);
    end loop;
    for v_k in select t.k from pg_catalog.jsonb_object_keys(v_ts) t(k) order by t.k loop
      perform mahjong_private.mj_w_tstate(v_k::uuid);
    end loop;

    -- 上限（実際に足した後の行・cap の行が無い＝full）
    if v_made > 0 then
      select m.cap into v_cap from mahjong.mj_caps m where m.tbl = '*' and m.scope = 'room';
      if v_cap is null or r.row_count + v_made > v_cap then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', '*'));
      end if;
    end if;
    if v_n > 0 then
      select m.cap into v_cap from mahjong.mj_caps m where m.tbl = 'history' and m.scope = 'room';
      if v_cap is null or r.history_count + v_n > v_cap then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', 'history'));
      end if;
    end if;
    for v_k in select t.k from pg_catalog.jsonb_object_keys(v_caps) t(k) order by t.k loop
      v_tbl := pg_catalog.split_part(v_k, '|', 1); v_rid := pg_catalog.split_part(v_k, '|', 2)::uuid;
      select m.cap into v_cap from mahjong.mj_caps m
       where m.tbl = v_tbl and m.scope = case v_tbl when 'tables' then 'session' when 'hanchans' then 'table' else 'room' end;
      v_c := case v_tbl
        when 'members'  then (select pg_catalog.count(*) from mahjong.members x where x.room_id = v_rid)
        when 'sessions' then (select pg_catalog.count(*) from mahjong.sessions x where x.room_id = v_rid)
        when 'tables'   then (select pg_catalog.count(*) from mahjong.tables x where x.session_id = v_rid)
        when 'hanchans' then (select pg_catalog.count(*) from mahjong.hanchans x where x.table_id = v_rid) end;
      if v_cap is null or v_c > v_cap then
        perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'full', 'what', v_tbl));
      end if;
    end loop;

    -- 部屋の数え
    if v_n > 0 then
      update mahjong.rooms x set row_count = x.row_count + v_made, history_count = x.history_count + v_n, last_write_at = pg_catalog.now()
       where x.id = p_room_id;
    end if;

    -- 後見（実の履歴の行で）
    v_k := mahjong_private.mj_w_over(p_room_id, v_me, v_role, greatest(1, v_n), v_n);
    if v_k is not null then
      perform mahjong_private.mj_w_err(pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', v_k));
    end if;

    v_ret := pg_catalog.jsonb_build_object('ok', true, 'results', v_items);
    -- 送り直しの答え（履歴の行を書いた組だけ・部屋で cap を越えたら古い物から消す＝full にしない）
    if v_n > 0 then
      insert into mahjong.op_results (room_id, op_id, result, user_id) values (p_room_id, p_op_id, v_ret, v_me);
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
      v_ret := sqlerrm::jsonb; v_n := 0;
    when deadlock_detected or lock_not_available or serialization_failure then
      v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'busy', 'what', 'lock'); v_n := 0;
    when others then
      raise log 'mj_write internal % %', sqlstate, sqlerrm;
      v_ret := pg_catalog.jsonb_build_object('ok', false, 'err', 'internal'); v_n := 0;
  end;

  -- ⑥ 数え（塊の外＝戻らない・limits は一番最後）
  perform mahjong_private.mj_w_count(p_room_id, v_me, v_role, v_n);
  return v_ret;
end $fn$;
revoke all on function public.mj_write(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mj_write(uuid, uuid, jsonb) to authenticated;


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
