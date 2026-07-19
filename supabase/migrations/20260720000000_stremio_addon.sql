-- NextUp: Stremio addon support — lets a user install a personal Stremio
-- addon that lists their NextUp watchlist, always pulled live.

-- Opaque per-user token used in the addon's public URL. Not the raw user_id,
-- so the URL can be shared/rotated without exposing the account identifier.
alter table user_settings
  add column if not exists stremio_token text unique;

-- TMDB -> IMDb id cache. Stremio's ecosystem (Cinemeta, stream addons) keys
-- everything by IMDb id, not TMDB id, so the addon needs to convert. A given
-- title's IMDb id never changes, so this is safe to cache indefinitely —
-- unlike the watchlist contents themselves, which the addon always reads live.
create table if not exists tmdb_external_ids_cache (
  tmdb_id    integer not null,
  media_type text    not null check (media_type in ('movie', 'tv')),
  imdb_id    text,
  cached_at  timestamptz not null default now(),
  primary key (tmdb_id, media_type)
);
-- Service-role only (the edge function). No client-facing policies needed.
alter table tmdb_external_ids_cache enable row level security;
