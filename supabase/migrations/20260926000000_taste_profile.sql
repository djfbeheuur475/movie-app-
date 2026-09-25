-- NextUp: explicit taste signals + a readable taste profile.
-- Watch history says what someone watched, not what they liked; these ratings
-- (onboarding rater + thumbs on recommendations) are the missing signal, and
-- the profile is the plain-English read of them that drives "For You" rows.

create table if not exists title_ratings (
  user_id     uuid        references auth.users on delete cascade not null,
  tmdb_id     integer     not null,
  media_type  text        not null check (media_type in ('movie', 'tv')),
  title       text        not null,
  year        smallint,
  poster_path text,
  -- 2 loved · 1 liked · 0 meh · -1 disliked · null = haven't seen (kept so it isn't asked again)
  rating      smallint    check (rating between -1 and 2),
  source      text        not null default 'rater' check (source in ('rater', 'recommendation', 'detail')),
  rated_at    timestamptz not null default now(),
  primary key (user_id, tmdb_id, media_type)
);
alter table title_ratings enable row level security;
create policy "Users can manage own ratings"
  on title_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists taste_profiles (
  user_id           uuid        references auth.users on delete cascade primary key,
  -- { summary, loves[], avoids[], acclaim, moods[] } written by the model
  profile           jsonb,
  -- the person's own corrections ("I actually love musicals") — fed back in on every rebuild
  user_notes        text,
  ratings_count     integer     not null default 0,
  profile_model     text,
  profile_built_at  timestamptz,
  -- cached "For You" rows; regenerated daily or when the profile changes
  rows              jsonb,
  rows_built_at     timestamptz,
  updated_at        timestamptz not null default now()
);
alter table taste_profiles enable row level security;
create policy "Users can read own taste profile"
  on taste_profiles for select using (auth.uid() = user_id);
create policy "Users can edit own taste notes"
  on taste_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can create own taste profile"
  on taste_profiles for insert with check (auth.uid() = user_id);
