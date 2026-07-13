-- ─── ai_rate_limits v2 ───────────────────────────────────────────────────────
-- Extend rate limiting to be action-scoped.
-- Previously keyed (user_id, date); now keyed (user_id, date, action).
-- This lets chat and homepage have independent daily quotas.

-- Add action column (default 'chat' so existing rows remain valid)
alter table ai_rate_limits
  add column if not exists action text not null default 'chat';

-- Drop old PK and replace with composite that includes action
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'ai_rate_limits'::regclass
      and contype = 'p'
  ) then
    alter table ai_rate_limits drop constraint ai_rate_limits_pkey;
  end if;
end $$;

alter table ai_rate_limits
  add primary key (user_id, date, action);

-- Replace the RPC with the action-aware version.
-- Callers that omit p_action get the 'chat' bucket (backwards compatible).
create or replace function check_ai_rate_limit(
  p_user_id uuid,
  p_action  text default 'chat',
  p_limit   int  default 100
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  insert into ai_rate_limits (user_id, date, action, count)
  values (p_user_id, current_date, p_action, 1)
  on conflict (user_id, date, action)
  do update set count = ai_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;
