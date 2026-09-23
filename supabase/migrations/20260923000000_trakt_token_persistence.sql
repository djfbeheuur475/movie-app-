-- NextUp: keep Trakt connected, and keep watch history even when it isn't.
--
-- Trakt access tokens expire after 24h. The cloud copy only ever held the
-- access token, so restoring on a new sign-in/reinstall brought back a token
-- that was already dead with no way to refresh it. Store the refresh token and
-- expiry alongside it.
alter table user_settings
  add column if not exists trakt_refresh_token text,
  add column if not exists trakt_token_expires_at timestamptz;

-- Last-known Trakt watch history (slimmed). Lets recommendations, watched
-- ticks and "Recently watched" keep working from real history while Trakt is
-- disconnected, and survives reinstalls / new devices.
create table if not exists trakt_history_cache (
  user_id    uuid        primary key references auth.users on delete cascade,
  movies     jsonb       not null default '[]'::jsonb,
  shows      jsonb       not null default '[]'::jsonb,
  signature  text        not null default '',
  updated_at timestamptz not null default now()
);
alter table trakt_history_cache enable row level security;
drop policy if exists "Users can manage own trakt history cache" on trakt_history_cache;
create policy "Users can manage own trakt history cache"
  on trakt_history_cache for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
