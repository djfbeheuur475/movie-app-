-- NextUp: manually-marked watched titles — for content Trakt has no record of
-- (watched somewhere that doesn't scrobble to Trakt, watched before the
-- account was connected, etc). Mirrors the watchlist table's shape/policy.

create table if not exists manual_watched (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users on delete cascade not null,
  tmdb_id     integer     not null,
  media_type  text        not null check (media_type in ('movie', 'tv')),
  title       text        not null,
  poster_path text,
  watched_at  timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);
alter table manual_watched enable row level security;
create policy "Users can manage own manual watched"
  on manual_watched for all using (auth.uid() = user_id);
create index if not exists manual_watched_user
  on manual_watched (user_id);
