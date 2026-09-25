-- ─── AI rate limiting: fix + hardening ───────────────────────────────────────
-- 1. v2 added check_ai_rate_limit(uuid, text, int) but left v1 (uuid, int) in
--    place. ai-chat's call (p_user_id, p_limit) matched both, PostgREST refused
--    it as ambiguous, and ai-chat treated the error as "allowed" — so the chat
--    limit never applied. Drop v1.
-- 2. A global daily ceiling across all users (circuit breaker against many
--    accounts each using their full quota).
-- 3. Blocked calls no longer count, so hammering past a limit can't inflate
--    the global total and lock everyone else out.
-- 4. Only the service role (edge functions) may call it. It is SECURITY
--    DEFINER, and by default any client — even anon — could run it against
--    any user id.

drop function if exists check_ai_rate_limit(uuid, int);

create or replace function check_ai_rate_limit(
  p_user_id uuid,
  p_action  text default 'chat',
  p_limit   int  default 100
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c_global_daily_limit constant int := 5000;
  v_total int;
  v_count int;
begin
  select coalesce(sum(count), 0) into v_total
  from ai_rate_limits
  where date = current_date;

  if v_total >= c_global_daily_limit then
    return false;
  end if;

  insert into ai_rate_limits (user_id, date, action, count)
  values (p_user_id, current_date, p_action, 1)
  on conflict (user_id, date, action)
  do update set count = ai_rate_limits.count + 1
    where ai_rate_limits.count < p_limit
  returning count into v_count;

  -- No row returned = already at the limit (the update's WHERE didn't match).
  return v_count is not null and v_count <= p_limit;
end;
$$;

revoke all on function check_ai_rate_limit(uuid, text, int) from public, anon, authenticated;
grant execute on function check_ai_rate_limit(uuid, text, int) to service_role;
