-- =============================================================================
-- 麻雀〜do the math〜 倉庫の設計図（部屋 mahjong・mahjong_private）
-- 正本＝設計図 v15.8 §3・§3.1・§3.2（project_mahjong_sekkeizu_2026-11-20.md）
--
-- ★何度当てても同じ結果になる書き方だけ★（if not exists・on conflict・add column if not exists）
-- ★消す系は書かない★（scripts/sql-guard.mjs が止める）
-- ★客（anon・authenticated）は部屋に1歩も入れない★＝外から呼べるのは public.mj_* の5本だけ（段2で足す）
--   表・補助には USAGE も権限も付けない。RLS も全部の表で入にする（決まり書きは0本＝誰も読めない）。
-- 段1（この版）＝表・表の CHECK・決まりの表（mj_ops 28行・mj_caps）・totals の1行・権限。
--   関数（mj_room_create／mj_room_join／mj_room_import／mj_read／mj_write と補助）は段2で足す。
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
  admin_secret_hash text not null,                       -- sha256（合言葉は端末の乱数16字）
  channel_key       text not null unique,                -- 合図の名前（入った端末にだけ渡す）
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
alter table mahjong.rule_sets add constraint rule_sets_players_ok check (coalesce(rules->>'players', '') in ('3', '4'));

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

-- ── 飛び賞の受け取り（receiver＝席 0〜3・−1＝全員から） ────────────────────
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

-- ── 送り直しの答え（部屋ごと7日・10,000件まで・4KB まで・行を書いた組だけ） ──
create table if not exists mahjong.op_results (
  room_id uuid not null references mahjong.rooms(id) on delete cascade,
  op_id   uuid not null,
  result  jsonb not null check (octet_length(result::text) <= 4096),
  at      timestamptz not null default now(),
  primary key (room_id, op_id)
);
create index if not exists op_results_at on mahjong.op_results(room_id, at);

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
  device_id     uuid,
  actor         text check (actor in ('nyu', 'kan')),  -- 押した時の端末の役（入／管）
  member_name   text,
  fold          jsonb,                                 -- 要約の中身（kind=fold の時だけ）
  at            timestamptz not null default now(),
  check ((kind = 'fold') = (fold is not null)),
  check (kind = 'fold' or actor is not null)
);
create index if not exists history_room on mahjong.history(room_id, id);
create index if not exists history_group on mahjong.history(group_id);
create index if not exists history_actor_at on mahjong.history(room_id, actor, at) where kind = 'row';
create index if not exists history_device_at on mahjong.history(device_id, at) where kind = 'row';

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

-- ── 操作の表（★正本★・mj_write はここに無い名を弾く・試験もここから引く） ──
create table if not exists mahjong.mj_ops (
  name           text primary key check (name ~ '^[a-z_]+$'),
  kan            boolean not null,          -- 管が押せる
  nyu            boolean not null,          -- 入が押せる
  on_deleted     boolean not null default false,  -- 消した部屋で通る
  needs_secret   boolean not null default false,  -- 合言葉の打ち直し
  writes_history boolean not null default true,   -- 履歴と op_results に残す（× は書き込みの数にも入らない）
  revert         text not null check (revert in ('prev', 'void', 'unvoid', 'inactive', 'rules_version', 'none')),
  versioned      boolean not null default false   -- base_version つき
);
insert into mahjong.mj_ops (name, kan, nyu, on_deleted, needs_secret, writes_history, revert, versioned) values
  ('device_leave',   true, true,  true,  false, false, 'none',          false),
  ('member_pick',    true, true,  false, false, true,  'prev',          false),
  ('member_add',     true, true,  false, false, true,  'inactive',      false),
  ('member_rename',  true, true,  false, false, true,  'prev',          false),
  ('member_active',  true, true,  false, false, true,  'prev',          false),
  ('session_add',    true, true,  false, false, true,  'void',          false),
  ('session_edit',   true, true,  false, false, true,  'prev',          false),
  ('table_add',      true, true,  false, false, true,  'void',          false),
  ('table_edit',     true, true,  false, false, true,  'prev',          false),
  ('hanchan_start',  true, true,  false, false, true,  'void',          false),
  ('hanchan_seats',  true, true,  false, false, true,  'prev',          false),
  ('hanchan_void',   true, true,  false, false, true,  'unvoid',        false),
  ('hanchan_unvoid', true, true,  false, false, true,  'void',          false),
  ('cell_set',       true, true,  false, false, true,  'prev',          true),
  ('tobi_set',       true, true,  false, false, true,  'prev',          true),
  ('kyotaku_set',    true, true,  false, false, true,  'prev',          true),
  ('hanchan_order',  true, true,  false, false, true,  'prev',          true),
  ('extra_set',      true, true,  false, false, true,  'prev',          true),
  ('extra_add',      true, true,  false, false, true,  'prev',          false),
  ('history_revert', true, true,  false, false, true,  'prev',          false),
  ('settle_snap',    true, true,  false, false, true,  'none',          false),
  ('league_save',    true, false, false, false, true,  'rules_version', false),
  ('room_export',    true, true,  true,  false, false, 'none',          false),
  ('rules_save',     true, false, false, false, true,  'rules_version', false),
  ('rerev_ok',       true, false, false, false, true,  'none',          false),
  ('room_secret',    true, false, false, true,  true,  'none',          false),
  ('room_delete',    true, false, false, true,  true,  'none',          false),
  ('room_undelete',  true, false, true,  false, true,  'none',          false)
on conflict (name) do update set
  kan = excluded.kan, nyu = excluded.nyu, on_deleted = excluded.on_deleted,
  needs_secret = excluded.needs_secret, writes_history = excluded.writes_history,
  revert = excluded.revert, versioned = excluded.versioned;

-- ── 表ごとの行の上限（段6＝当てた後に実の数で見る・§3.2） ──────────────────
--   scope: room＝部屋ごと／session＝開催日ごと／table＝卓ごと
--   '*' の room＝P（履歴と端末以外の全部の行）・history の room＝F（要約の行も数える）
create table if not exists mahjong.mj_caps (
  tbl   text not null,
  scope text not null check (scope in ('room', 'session', 'table', 'all')),
  cap   int  not null check (cap > 0),
  primary key (tbl, scope)
);
insert into mahjong.mj_caps (tbl, scope, cap) values
  ('*',         'room',    30000),   -- P
  ('history',   'room',    10000),   -- F
  ('members',   'room',    300),
  ('sessions',  'room',    3000),
  ('tables',    'session', 10),
  ('hanchans',  'table',   60),
  ('leagues',   'room',    50),
  ('rule_sets', 'room',    500),
  ('devices',   'room',    200),     -- 1部屋の端末（admin は超えても入り、管でない1台を出す）
  ('admins',    'room',    5),       -- 管の端末
  ('op_results','room',    10000),
  ('rooms',     'all',     200)      -- R（消した取り消し待ちも数える）
on conflict (tbl, scope) do update set cap = excluded.cap;

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
