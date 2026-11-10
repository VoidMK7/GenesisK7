-- NovaTrade migration 3 of 4: memecoin copy-trading, teachable AI, wallets, social, chat, communities.
--
-- STATUS: PROPOSED. NOT APPLIED to any database. Apply 0001 and 0002 first, review this, then apply it yourself.
--
-- Same conventions as 0001/0002: nova_ prefix, RLS on every table, server-only writes for anything that
-- records a trade or touches trust (trade log, positions, balances, proposals).  The browser can write only
-- its own profile, posts, likes, follows, messages, rules and settings.
--
-- Wallets are READ-ONLY records: an address and balance snapshots the server reads from a public RPC.
-- No private key, seed phrase, signature or spending approval is ever stored.

-- ---------------------------------------------------------------------------
-- Profiles (editable by the owner: picture + a 5-10 second banner)
-- ---------------------------------------------------------------------------
create table public.nova_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio text check (char_length(bio) <= 280),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 600),
  banner_url text check (banner_url is null or char_length(banner_url) <= 600),
  banner_kind text check (banner_kind in ('image', 'video')),
  banner_seconds numeric check (banner_seconds is null or (banner_seconds >= 1 and banner_seconds <= 10)),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((banner_url is null) = (banner_kind is null))
);
create unique index nova_profiles_handle_idx on public.nova_profiles (lower(handle));
create trigger nova_profiles_touch before update on public.nova_profiles for each row execute function public.nova_touch_updated_at();
alter table public.nova_profiles enable row level security;
create policy "profiles: public read" on public.nova_profiles for select to authenticated using (is_public or user_id = auth.uid());
create policy "profiles: owner insert" on public.nova_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles: owner update" on public.nova_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles: owner delete" on public.nova_profiles for delete to authenticated using (user_id = auth.uid());
revoke all on public.nova_profiles from anon;

-- ---------------------------------------------------------------------------
-- Social graph, posts, likes
-- ---------------------------------------------------------------------------
create table public.nova_social_follows (
  follower uuid not null references auth.users(id) on delete cascade,
  followee uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index nova_social_follows_followee_idx on public.nova_social_follows (followee);
alter table public.nova_social_follows enable row level security;
create policy "social follows: read" on public.nova_social_follows for select to authenticated using (true);
create policy "social follows: follow as self" on public.nova_social_follows for insert to authenticated with check (follower = auth.uid());
create policy "social follows: unfollow as self" on public.nova_social_follows for delete to authenticated using (follower = auth.uid());
revoke all on public.nova_social_follows from anon;

create table public.nova_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  media_url text check (media_url is null or char_length(media_url) <= 600),
  token_address text check (token_address is null or char_length(token_address) <= 80),
  token_symbol text check (token_symbol is null or char_length(token_symbol) <= 24),
  trade_id uuid,                                   -- optional: share one of your own logged trades (verified server-side)
  hidden boolean not null default false,           -- moderation
  created_at timestamptz not null default now()
);
create index nova_posts_created_idx on public.nova_posts (created_at desc);
create index nova_posts_author_idx on public.nova_posts (author, created_at desc);
alter table public.nova_posts enable row level security;
create policy "posts: read visible" on public.nova_posts for select to authenticated using (not hidden or author = auth.uid() or public.nova_is_admin());
create policy "posts: write as self" on public.nova_posts for insert to authenticated with check (author = auth.uid() and not hidden and trade_id is null);
create policy "posts: delete own" on public.nova_posts for delete to authenticated using (author = auth.uid() or public.nova_is_admin());
revoke all on public.nova_posts from anon;
revoke update on public.nova_posts from authenticated;
grant update (hidden) on public.nova_posts to authenticated;
create policy "posts: admin moderate" on public.nova_posts for update to authenticated using (public.nova_is_admin()) with check (public.nova_is_admin());

create table public.nova_post_likes (
  post_id uuid not null references public.nova_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index nova_post_likes_user_idx on public.nova_post_likes (user_id);
alter table public.nova_post_likes enable row level security;
create policy "likes: read" on public.nova_post_likes for select to authenticated using (true);
create policy "likes: like as self" on public.nova_post_likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes: unlike as self" on public.nova_post_likes for delete to authenticated using (user_id = auth.uid());
revoke all on public.nova_post_likes from anon;

create table public.nova_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.nova_posts(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index nova_post_comments_post_idx on public.nova_post_comments (post_id, created_at);
alter table public.nova_post_comments enable row level security;
create policy "comments: read" on public.nova_post_comments for select to authenticated using (true);
create policy "comments: write as self" on public.nova_post_comments for insert to authenticated with check (author = auth.uid());
create policy "comments: delete own" on public.nova_post_comments for delete to authenticated using (author = auth.uid() or public.nova_is_admin());
revoke all on public.nova_post_comments from anon;

-- ---------------------------------------------------------------------------
-- Chat rooms: communities (public or private) and direct messages
-- ---------------------------------------------------------------------------
create table public.nova_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('community', 'dm')),
  slug text check (slug ~ '^[a-z0-9-]{3,32}$'),
  name text check (char_length(name) between 3 and 48),
  description text check (char_length(description) <= 300),
  is_public boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'community' and slug is not null and name is not null) or (kind = 'dm'))
);
create unique index nova_rooms_slug_idx on public.nova_rooms (lower(slug)) where slug is not null;

create table public.nova_room_members (
  room_id uuid not null references public.nova_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'mod', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index nova_room_members_user_idx on public.nova_room_members (user_id);

create or replace function public.nova_is_room_member(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nova_room_members m where m.room_id = r and m.user_id = auth.uid());
$$;
revoke all on function public.nova_is_room_member(uuid) from public, anon;
grant execute on function public.nova_is_room_member(uuid) to authenticated;

create or replace function public.nova_room_is_public(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nova_rooms x where x.id = r and x.kind = 'community' and x.is_public);
$$;
revoke all on function public.nova_room_is_public(uuid) from public, anon;
grant execute on function public.nova_room_is_public(uuid) to authenticated;

alter table public.nova_rooms enable row level security;
create policy "rooms: read public or member" on public.nova_rooms for select to authenticated using ((kind = 'community' and is_public) or public.nova_is_room_member(id));
revoke insert, update, delete on public.nova_rooms from authenticated;   -- created by the server so the creator becomes owner atomically
revoke all on public.nova_rooms from anon;

alter table public.nova_room_members enable row level security;
create policy "members: read in my rooms or public rooms" on public.nova_room_members for select to authenticated
  using (user_id = auth.uid() or public.nova_is_room_member(room_id) or public.nova_room_is_public(room_id));
create policy "members: leave" on public.nova_room_members for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.nova_room_members from authenticated;    -- joins go through the server (checks public/private, DM pairing)
revoke all on public.nova_room_members from anon;

create table public.nova_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.nova_rooms(id) on delete cascade,
  sender uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index nova_messages_room_idx on public.nova_messages (room_id, id desc);
alter table public.nova_messages enable row level security;
create policy "messages: read in my rooms or public rooms" on public.nova_messages for select to authenticated
  using ((not hidden and (public.nova_is_room_member(room_id) or public.nova_room_is_public(room_id))) or sender = auth.uid() or public.nova_is_admin());
create policy "messages: send as self in my rooms" on public.nova_messages for insert to authenticated
  with check (sender = auth.uid() and public.nova_is_room_member(room_id) and not hidden);
create policy "messages: delete own" on public.nova_messages for delete to authenticated using (sender = auth.uid() or public.nova_is_admin());
revoke update on public.nova_messages from authenticated;
revoke all on public.nova_messages from anon;

-- ---------------------------------------------------------------------------
-- Wallets (READ-ONLY): an address, an optional ownership proof, balance snapshots
-- ---------------------------------------------------------------------------
create table public.nova_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null check (chain in ('solana', 'ethereum', 'base', 'bsc')),
  address text not null check (char_length(address) between 26 and 64),
  label text check (char_length(label) <= 40),
  kind text not null default 'own' check (kind in ('own', 'tracked')),   -- own = the user's wallet; tracked = someone else's, to watch/copy
  created_at timestamptz not null default now(),
  unique (user_id, chain, address)
);
alter table public.nova_wallets enable row level security;
create policy "wallets: owner read" on public.nova_wallets for select to authenticated using (user_id = auth.uid());
create policy "wallets: owner delete" on public.nova_wallets for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.nova_wallets from authenticated;         -- validated and inserted by the server
revoke all on public.nova_wallets from anon;

create table public.nova_wallet_snapshots (
  id bigint generated always as identity primary key,
  wallet_id uuid not null references public.nova_wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  native_symbol text not null,
  native_balance numeric not null,
  total_usd numeric,                               -- null when tokens could not be priced
  tokens jsonb not null default '[]'::jsonb,       -- [{mint, symbol, amount, usd|null}]
  unpriced integer not null default 0,
  source text not null,                            -- the RPC / price provider that answered
  taken_at timestamptz not null default now()
);
create index nova_wallet_snapshots_idx on public.nova_wallet_snapshots (wallet_id, taken_at desc);
alter table public.nova_wallet_snapshots enable row level security;
create policy "snapshots: owner read" on public.nova_wallet_snapshots for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_wallet_snapshots from authenticated;
revoke all on public.nova_wallet_snapshots from anon;

-- How much of a wallet the AI may use. Applies to paper and (approval-gated) live proposals.
create table public.nova_allocations (
  wallet_id uuid primary key references public.nova_wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'percent' check (mode in ('percent', 'fixed')),
  amount_usd numeric check (amount_usd is null or amount_usd >= 0),
  percent numeric check (percent is null or (percent >= 0 and percent <= 100)),
  max_per_trade_usd numeric check (max_per_trade_usd is null or max_per_trade_usd > 0),
  max_open_positions integer not null default 5 check (max_open_positions between 1 and 50),
  copy_buy_usd numeric check (copy_buy_usd is null or copy_buy_usd > 0),       -- tracked wallets: dollars per mirrored buy
  copy_sells boolean not null default true,                                    -- tracked wallets: mirror sells too
  updated_at timestamptz not null default now()
);
create trigger nova_allocations_touch before update on public.nova_allocations for each row execute function public.nova_touch_updated_at();
alter table public.nova_allocations enable row level security;
create policy "allocations: owner read" on public.nova_allocations for select to authenticated using (user_id = auth.uid());
create policy "allocations: owner write" on public.nova_allocations for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.nova_wallets w where w.id = wallet_id and w.user_id = auth.uid()));
create policy "allocations: owner update" on public.nova_allocations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.nova_allocations from anon;

-- ---------------------------------------------------------------------------
-- Memecoin strategy (the plain-English prompt + the numbers it is compiled to)
-- ---------------------------------------------------------------------------
create table public.nova_meme_strategy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prompt text not null default '' check (char_length(prompt) <= 2000),
  enabled boolean not null default false,
  mode text not null default 'paper' check (mode in ('analysis', 'paper', 'live_approval')),
  chains text[] not null default array['solana'],
  min_liquidity_usd numeric not null default 20000 check (min_liquidity_usd >= 0),
  min_volume_24h_usd numeric not null default 50000 check (min_volume_24h_usd >= 0),
  min_age_minutes integer not null default 30 check (min_age_minutes >= 0),
  max_age_hours integer not null default 72 check (max_age_hours >= 1),
  max_fdv_usd numeric check (max_fdv_usd is null or max_fdv_usd > 0),
  min_buy_sell_ratio numeric not null default 1.0 check (min_buy_sell_ratio >= 0),
  min_rug_score integer not null default 60 check (min_rug_score between 0 and 100),   -- 100 = cleanest; see core/memecoin/score.ts
  position_usd numeric not null default 50 check (position_usd > 0),
  max_open_positions integer not null default 5 check (max_open_positions between 1 and 50),
  take_profit_pct numeric not null default 100 check (take_profit_pct > 0),
  stop_loss_pct numeric not null default 25 check (stop_loss_pct > 0 and stop_loss_pct < 100),
  trailing_stop_pct numeric not null default 20 check (trailing_stop_pct > 0 and trailing_stop_pct < 100),
  slippage_bps integer not null default 300 check (slippage_bps between 0 and 5000),
  daily_loss_limit_usd numeric check (daily_loss_limit_usd is null or daily_loss_limit_usd > 0),
  last_cycle_at timestamptz,                         -- set by the server so cron can work through users fairly
  updated_at timestamptz not null default now()
);
create trigger nova_meme_strategy_touch before update on public.nova_meme_strategy for each row execute function public.nova_touch_updated_at();
alter table public.nova_meme_strategy enable row level security;
create policy "meme strategy: owner read" on public.nova_meme_strategy for select to authenticated using (user_id = auth.uid());
create policy "meme strategy: owner insert" on public.nova_meme_strategy for insert to authenticated with check (user_id = auth.uid() and mode in ('analysis', 'paper'));
create policy "meme strategy: owner update" on public.nova_meme_strategy for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and mode in ('analysis', 'paper'));
revoke update on public.nova_meme_strategy from authenticated;
grant update (prompt, enabled, mode, chains, min_liquidity_usd, min_volume_24h_usd, min_age_minutes, max_age_hours, max_fdv_usd, min_buy_sell_ratio, min_rug_score, position_usd, max_open_positions, take_profit_pct, stop_loss_pct, trailing_stop_pct, slippage_bps, daily_loss_limit_usd) on public.nova_meme_strategy to authenticated;
revoke all on public.nova_meme_strategy from anon;

-- ---------------------------------------------------------------------------
-- Trade log (append-only) and positions: written ONLY by the server
-- ---------------------------------------------------------------------------
create table public.nova_meme_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.nova_wallets(id) on delete set null,
  mode text not null check (mode in ('paper', 'live')),
  chain text not null,
  token_address text not null,
  symbol text not null,
  name text,
  image_url text,
  entry_price numeric not null check (entry_price > 0),
  qty numeric not null check (qty > 0),
  cost_usd numeric not null,
  peak_price numeric not null,
  stop_loss_pct numeric not null,
  trailing_stop_pct numeric not null,
  take_profit_pct numeric not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  exit_price numeric,
  exit_reason text check (exit_reason in ('take_profit', 'stop_loss', 'trailing_stop', 'manual', 'copy_exit', 'risk')),
  pnl_usd numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index nova_meme_positions_user_idx on public.nova_meme_positions (user_id, status, opened_at desc);
alter table public.nova_meme_positions enable row level security;
create policy "positions: owner read" on public.nova_meme_positions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_meme_positions from authenticated;
revoke all on public.nova_meme_positions from anon;

create table public.nova_trade_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid references public.nova_meme_positions(id) on delete set null,
  mode text not null check (mode in ('analysis', 'paper', 'live')),
  agent text not null check (agent in ('scanner', 'analyst', 'executor', 'risk', 'copy', 'user')),
  side text not null check (side in ('buy', 'sell', 'skip')),
  chain text not null,
  token_address text not null,
  symbol text not null,
  image_url text,
  price numeric,
  qty numeric,
  usd numeric,
  status text not null check (status in ('simulated_fill', 'awaiting_approval', 'rejected', 'skipped', 'confirmed', 'failed')),
  reason text not null,                              -- the plain-language "why", built from the real metrics below
  evidence jsonb not null default '{}'::jsonb,       -- the numbers the decision used
  rules_applied jsonb not null default '[]'::jsonb,  -- taught rules that influenced it
  source_wallet text,                                -- for copy trades: the tracked address that triggered it
  tx_signature text,                                 -- live only; set only when the chain confirms
  simulated boolean not null default true,
  created_at timestamptz not null default now(),
  check (not (status = 'confirmed' and (tx_signature is null or simulated)))
);
create index nova_trade_log_user_idx on public.nova_trade_log (user_id, created_at desc);
create index nova_trade_log_token_idx on public.nova_trade_log (user_id, token_address, created_at desc);
alter table public.nova_trade_log enable row level security;
create policy "trade log: owner read" on public.nova_trade_log for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_trade_log from authenticated;
revoke all on public.nova_trade_log from anon;

-- Append-only even for the service role.
create or replace function public.nova_trade_log_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('nova.allow_log_delete', true) = 'on' then return old; end if;   -- account deletion cascade only
  if tg_op = 'UPDATE' and old.status = 'awaiting_approval' and new.status in ('rejected', 'confirmed', 'failed')
     and (new.user_id, new.token_address, new.side, new.reason) is not distinct from (old.user_id, old.token_address, old.side, old.reason) then
    return new;                                    -- the only allowed change: resolving a pending approval
  end if;
  raise exception 'nova_trade_log is append-only';
end;
$$;
create trigger nova_trade_log_no_edit before update or delete on public.nova_trade_log for each row execute function public.nova_trade_log_immutable();

create table public.nova_agent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('scanner', 'analyst', 'executor', 'risk', 'system')),
  kind text not null,
  message text not null check (char_length(message) <= 600),
  token_address text,
  symbol text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index nova_agent_events_user_idx on public.nova_agent_events (user_id, id desc);
alter table public.nova_agent_events enable row level security;
create policy "agent events: owner read" on public.nova_agent_events for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_agent_events from authenticated;
revoke all on public.nova_agent_events from anon;

-- ---------------------------------------------------------------------------
-- Teaching the AI: rules, preferences, and thumbs on individual trades
-- ---------------------------------------------------------------------------
create table public.nova_ai_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('prefer', 'avoid', 'limit', 'note')),
  text text not null check (char_length(text) between 3 and 400),
  source text not null default 'user' check (source in ('user', 'chat', 'feedback')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index nova_ai_rules_user_idx on public.nova_ai_rules (user_id, active);
alter table public.nova_ai_rules enable row level security;
create policy "rules: owner all" on public.nova_ai_rules for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.nova_ai_rules from anon;

create table public.nova_trade_feedback (
  trade_id uuid not null references public.nova_trade_log(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (trade_id, user_id)
);
alter table public.nova_trade_feedback enable row level security;
create policy "feedback: owner all" on public.nova_trade_feedback for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.nova_trade_log t where t.id = trade_id and t.user_id = auth.uid()));
revoke all on public.nova_trade_feedback from anon;

-- Chat with the user's own AI ("tell the AI what you want")
create table public.nova_ai_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (char_length(body) between 1 and 8000),
  suggested_rules jsonb not null default '[]'::jsonb,   -- rules the assistant proposed; saved only if the user taps "Teach"
  provider text,
  created_at timestamptz not null default now()
);
create index nova_ai_messages_user_idx on public.nova_ai_messages (user_id, id desc);
alter table public.nova_ai_messages enable row level security;
create policy "ai messages: owner read" on public.nova_ai_messages for select to authenticated using (user_id = auth.uid());
create policy "ai messages: owner delete" on public.nova_ai_messages for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.nova_ai_messages from authenticated;
revoke all on public.nova_ai_messages from anon;

-- ---------------------------------------------------------------------------
-- Top traders from other apps. Rows exist ONLY if a configured feed (or the user) put them there.
-- ---------------------------------------------------------------------------
create table public.nova_external_traders (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform ~ '^[a-z0-9_-]{2,24}$'),        -- e.g. fomo, pumpfun, gmgn, kolscan: whatever the feed names
  handle text not null check (char_length(handle) between 1 and 60),
  chain text not null,
  wallet_address text,
  avatar_url text,
  profile_url text,
  stats jsonb not null default '{}'::jsonb,                              -- as published by the source: {pnl_usd, win_rate_pct, trades, period}
  source text not null,                                                  -- the feed that supplied it
  fetched_at timestamptz not null default now(),
  unique (platform, handle)
);
alter table public.nova_external_traders enable row level security;
create policy "external traders: read" on public.nova_external_traders for select to authenticated using (true);
revoke insert, update, delete on public.nova_external_traders from authenticated;
revoke all on public.nova_external_traders from anon;

-- ---------------------------------------------------------------------------
-- Counts without exposing raw rows
-- ---------------------------------------------------------------------------
create or replace view public.nova_profile_counts with (security_invoker = true) as
select p.user_id,
  (select count(*) from public.nova_social_follows f where f.followee = p.user_id) as followers,
  (select count(*) from public.nova_social_follows f where f.follower = p.user_id) as following,
  (select count(*) from public.nova_posts x where x.author = p.user_id and not x.hidden) as posts
from public.nova_profiles p;
grant select on public.nova_profile_counts to authenticated;
revoke all on public.nova_profile_counts from anon;

create or replace view public.nova_post_stats with (security_invoker = true) as
select x.id as post_id,
  (select count(*) from public.nova_post_likes l where l.post_id = x.id) as likes,
  (select count(*) from public.nova_post_comments c where c.post_id = x.id) as comments
from public.nova_posts x;
grant select on public.nova_post_stats to authenticated;
revoke all on public.nova_post_stats from anon;
