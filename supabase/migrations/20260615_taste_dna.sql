-- NextUp: Taste DNA + AI persistence tables
-- Run this migration in the Supabase SQL editor.

-- Taste DNA — cross-device personalisation (one row per user)
create table if not exists taste_dna (
  user_id         uuid references auth.users on delete cascade primary key,
  taste_profile   text,
  taste_mode      text,
  rows            jsonb     not null default '[]'::jsonb,
  fingerprint     text,
  genre_affinity  jsonb     not null default '{}'::jsonb,
  generated_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table taste_dna enable row level security;
create policy "Users can manage own DNA"
  on taste_dna for all using (auth.uid() = user_id);

-- Shown row history — prevents the same row themes repeating cross-device
create table if not exists shown_rows (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users on delete cascade,
  row_title  text        not null,
  shown_at   timestamptz not null default now()
);
alter table shown_rows enable row level security;
create policy "Users can manage own shown rows"
  on shown_rows for all using (auth.uid() = user_id);
create index if not exists shown_rows_user_shown
  on shown_rows (user_id, shown_at desc);

-- AI conversation summaries — cross-session concierge memory
create table if not exists ai_conversations (
  id               uuid        default gen_random_uuid() primary key,
  user_id          uuid        references auth.users on delete cascade,
  summary          text        not null,
  titles_mentioned text[]      not null default '{}',
  session_at       timestamptz not null default now()
);
alter table ai_conversations enable row level security;
create policy "Users can manage own AI conversations"
  on ai_conversations for all using (auth.uid() = user_id);
create index if not exists ai_conversations_user_session
  on ai_conversations (user_id, session_at desc);
