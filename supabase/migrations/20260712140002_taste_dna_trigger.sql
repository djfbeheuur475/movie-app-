-- ─── taste_dna updated_at trigger ────────────────────────────────────────────
-- taste_dna.updated_at already exists but is not auto-maintained.
-- This trigger ensures it reflects the true last-modified time,
-- which is used as the DNA fingerprint component for cache invalidation.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Idempotent: drop before recreating
drop trigger if exists taste_dna_set_updated_at on taste_dna;

create trigger taste_dna_set_updated_at
  before update on taste_dna
  for each row
  execute function set_updated_at();

