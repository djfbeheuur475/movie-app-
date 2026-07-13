-- ─── ai_cache ────────────────────────────────────────────────────────────────
-- Generalised cache for all AI orchestrator actions.
-- One row per (user, action). Upserted on every regeneration.
-- Cache validity is checked by the edge function via fingerprint comparison;
-- the DB itself does not enforce expiry.

create table if not exists ai_cache (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users on delete cascade,
  action                text        not null,

  -- The full AI-generated payload for this action
  payload               jsonb       not null,

  -- Fingerprints of the inputs that produced this payload.
  -- If any fingerprint differs from the current value, the cache is stale.
  dna_fingerprint       text        not null default '',
  history_fingerprint   text        not null default '',
  watchlist_fingerprint text        not null default '',

  -- Provenance metadata — never overwritten, only set at generation time
  model_used            text        not null default '',
  engine_version        text        not null default 'v1',
  cache_version         int         not null default 1,
  generated_at          timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '24 hours'),

  -- One cache row per user per action
  unique (user_id, action)
);

alter table ai_cache enable row level security;

-- Users can read their own cache (client may inspect cacheMetadata)
create policy "Users can view own cache"
  on ai_cache for select
  using (auth.uid() = user_id);

-- All writes go through the service-role edge function
create policy "Service role only for writes"
  on ai_cache for all
  using (false);

create index if not exists ai_cache_user_action
  on ai_cache (user_id, action);

create index if not exists ai_cache_expires
  on ai_cache (expires_at);  -- used by cleanup jobs scanning stale rows
