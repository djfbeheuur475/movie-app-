-- AI rate limiting: one row per (user, calendar day)
create table if not exists ai_rate_limits (
  user_id  uuid  not null references auth.users on delete cascade,
  date     date  not null default current_date,
  count    int   not null default 0,
  primary key (user_id, date)
);
alter table ai_rate_limits enable row level security;
-- Only the edge function (service role) touches this table
create policy "Service role only" on ai_rate_limits
  using (false);

-- AI request log: one row per call, for cost monitoring and abuse detection
create table if not exists ai_requests (
  id                uuid        default gen_random_uuid() primary key,
  user_id           uuid        not null references auth.users on delete cascade,
  model             text        not null,
  prompt_tokens     int,
  completion_tokens int,
  latency_ms        int,
  success           boolean     not null default true,
  error             text,
  created_at        timestamptz not null default now()
);
alter table ai_requests enable row level security;
create policy "Users can view own requests" on ai_requests
  for select using (auth.uid() = user_id);
create index if not exists ai_requests_user_created
  on ai_requests (user_id, created_at desc);

-- Atomic rate limit check + increment.
-- Returns true if the request is allowed, false if the daily limit is reached.
-- Uses INSERT ... ON CONFLICT to make the increment atomic.
create or replace function check_ai_rate_limit(p_user_id uuid, p_limit int default 100)
returns boolean
language plpgsql security definer
as $$
declare
  v_count int;
begin
  insert into ai_rate_limits (user_id, date, count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, date)
  do update set count = ai_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;
