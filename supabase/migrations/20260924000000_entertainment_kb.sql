-- NextUp Entertainment Knowledge Base (Phase 1).
--
-- Lean by design (Supabase Free, 500MB): structured intelligence only, no raw
-- API responses. A title profile is two small arrays whose positions are
-- defined per framework version in kb_dimensions — so the framework can evolve
-- without schema changes, and 250k profiles stay ~100MB.
--
-- Written only by the kb/ batch pipeline with the service role. RLS is on with
-- no policies (service role bypasses RLS); read policies for the app come later.

create table if not exists kb_frameworks (
  id              smallint generated always as identity primary key,
  version         text not null unique,          -- '1.0'
  definition_hash text not null,                 -- sha256 of the framework file; guards against silent edits
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists kb_dimensions (
  id           smallint generated always as identity primary key,
  framework_id smallint not null references kb_frameworks on delete cascade,
  key          text not null,
  category     text not null,
  qtype        text not null check (qtype in ('score', 'noul', 'choice')),
  applies_to   text not null default 'all' check (applies_to in ('all', 'movie', 'tv')),
  ordinal      smallint not null,                -- 1-based index into kb_title_profiles.conf
  slot_start   smallint not null,                -- 1-based index into kb_title_profiles.vals
  slot_count   smallint not null,                -- 1, or number of options for a choice
  instructions text not null,
  criteria     jsonb not null,                   -- few hundred rows total; fine as jsonb
  unique (framework_id, key),
  unique (framework_id, ordinal)
);

create table if not exists kb_keywords (
  id   integer primary key,                      -- TMDB keyword id
  name text not null
);

create table if not exists kb_titles (
  id             integer generated always as identity primary key,
  tmdb_id        integer not null,
  is_tv          boolean not null,
  imdb_num       integer,                        -- tt0113277 → 113277
  title          text not null,
  original_title text,                           -- null when identical to title
  year           smallint,
  runtime        smallint,                       -- minutes (TV: typical episode)
  seasons        smallint,                       -- TV only
  overview       text,
  genre_ids      smallint[],                     -- TMDB genre ids
  creators       text[],                         -- directors (film) / creators (TV), max 2
  cast_names     text[],                         -- top 5 billed
  keyword_ids    integer[],                      -- → kb_keywords, max 15
  lang           text,                           -- original language (ISO 639-1)
  countries      text[],                         -- ISO 3166-1, max 3
  cert           text,                           -- US (fallback GB) certification
  popularity     real,
  vote_avg       smallint,                       -- TMDB rating × 10
  vote_count     integer,
  poster_path    text,
  meta_version   smallint not null default 1,    -- ingest schema version
  fetched_at     date not null default current_date,
  unique (tmdb_id, is_tv)
);

-- Named title sets: the QC test set now, evaluation sets later.
create table if not exists kb_sets (
  name     text not null,
  title_id integer not null references kb_titles on delete cascade,
  label    text,                                 -- e.g. 'arthouse', 'sitcom'
  primary key (name, title_id)
);

create table if not exists kb_models (
  id   smallint generated always as identity primary key,
  name text not null unique                      -- concrete version, e.g. typesafe/jev-1.13-20260917
);

create table if not exists kb_title_profiles (
  title_id      integer  not null references kb_titles on delete cascade,
  framework_id  smallint not null references kb_frameworks,
  model_id      smallint not null references kb_models,
  vals          smallint[] not null,             -- 0–100 per slot (score = expected level, noul = P(true), choice = P(option))
  conf          smallint[] not null,             -- 0–100 per dimension; null for dimensions not applicable (e.g. TV-only)
  meta_version  smallint not null,
  classified_at timestamptz not null default now(),
  primary key (title_id, framework_id)
);

-- Work queue + checkpoint + cost ledger in one: one row per (title, framework).
create table if not exists kb_classification_runs (
  title_id      integer  not null references kb_titles on delete cascade,
  framework_id  smallint not null references kb_frameworks,
  status        text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts      smallint not null default 0,
  last_error    text,
  input_tokens  integer,
  cost_usd      real,                            -- billed amount ('consumed') from the Jev response
  duration_ms   integer,
  batch_id      integer,
  updated_at    timestamptz not null default now(),
  processed_at  timestamptz,
  primary key (title_id, framework_id)
);
create index if not exists kb_runs_status on kb_classification_runs (framework_id, status);

create table if not exists kb_batches (
  id           integer generated always as identity primary key,
  framework_id smallint references kb_frameworks,
  mode         text not null,                    -- 'profile', 'profile --failed', 'retest', 'probe'
  host         text,
  requested    integer,
  succeeded    integer not null default 0,
  failed       integer not null default 0,
  retries      integer not null default 0,
  input_tokens bigint not null default 0,
  cost_usd     real not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table kb_frameworks          enable row level security;
alter table kb_dimensions          enable row level security;
alter table kb_keywords            enable row level security;
alter table kb_titles              enable row level security;
alter table kb_sets                enable row level security;
alter table kb_models              enable row level security;
alter table kb_title_profiles      enable row level security;
alter table kb_classification_runs enable row level security;
alter table kb_batches             enable row level security;

-- Queue: add a pending run for every title in scope (a named set, or all
-- titles when p_set is null) that has no run yet for this framework version.
create or replace function kb_enqueue(p_framework smallint, p_set text default null)
returns integer language sql as $$
  with ins as (
    insert into kb_classification_runs (title_id, framework_id)
    select t.id, p_framework
    from kb_titles t
    where (p_set is null or exists (select 1 from kb_sets s where s.name = p_set and s.title_id = t.id))
    on conflict (title_id, framework_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

-- Queue: atomically claim up to p_limit runs. Pending first; stale
-- 'processing' rows (worker died mid-batch) are reclaimed after 15 minutes;
-- failed rows only when p_include_failed and under p_max_attempts.
create or replace function kb_claim_runs(
  p_framework smallint, p_limit integer, p_include_failed boolean, p_max_attempts integer,
  p_batch integer, p_set text default null
) returns setof integer language sql as $$
  update kb_classification_runs r
  set status = 'processing', updated_at = now(), batch_id = p_batch
  where (r.title_id, r.framework_id) in (
    select c.title_id, c.framework_id
    from kb_classification_runs c
    where c.framework_id = p_framework
      and (p_set is null or exists (select 1 from kb_sets s where s.name = p_set and s.title_id = c.title_id))
      and (
        c.status = 'pending'
        or (c.status = 'processing' and c.updated_at < now() - interval '15 minutes')
        or (p_include_failed and c.status = 'failed' and c.attempts < p_max_attempts)
      )
    order by c.status = 'pending' desc, c.title_id
    limit p_limit
    for update skip locked
  )
  returning r.title_id;
$$;

revoke execute on function kb_enqueue(smallint, text) from public, anon, authenticated;
revoke execute on function kb_claim_runs(smallint, integer, boolean, integer, integer, text) from public, anon, authenticated;
