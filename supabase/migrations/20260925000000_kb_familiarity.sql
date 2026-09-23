-- KB framework v1.1: familiarity / trust signal per profile.
-- An operational trust signal, not ground truth about what Jev "knows":
--   name_conf  — Jev's mean confidence on the name-only probe (title+year+type only)
--   full_conf  — mean confidence on the full-evidence profile
--   agreement  — how closely the name-only probe matches the full profile on the
--                probe dimensions (100 = identical, 0 = as different as unrelated titles)
--   familiarity — agreement, damped when Jev itself admits low confidence
-- Null for v1.0 profiles (no probe was run).
alter table kb_title_profiles
  add column if not exists familiarity smallint,
  add column if not exists agreement   smallint,
  add column if not exists name_conf   smallint,
  add column if not exists full_conf   smallint;
