-- NextUp: Add missing columns to profiles + fix RLS
-- Run this in the Supabase SQL editor.

-- Add any columns that may not exist yet
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists trakt_connected boolean not null default false;
alter table profiles add column if not exists trakt_username text;
alter table profiles add column if not exists trakt_client_id text;
alter table profiles add column if not exists trakt_access_token text;
alter table profiles add column if not exists trakt_refresh_token text;
alter table profiles add column if not exists tmdb_api_key text;
alter table profiles add column if not exists gemini_api_key text;
alter table profiles add column if not exists setup_done boolean not null default false;

-- Ensure RLS is enabled
alter table profiles enable row level security;

-- Recreate RLS policies (idempotent)
drop policy if exists "Users can view own profile" on profiles;
drop policy if exists "Users can insert own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);
