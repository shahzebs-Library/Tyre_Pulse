-- V391: remember the FULL column list a mapping profile was built on.
--
-- A profile already stores a header FINGERPRINT, which answers "is this the
-- same file?" but not "what changed?". The mapping RULES only cover headers
-- that were mapped, so a column the user deliberately left unmapped is
-- invisible to them, and a genuinely new column cannot be told apart from one
-- that was always there and simply never mapped.
--
-- Storing the columns the profile was built on is what makes the difference
-- reportable. Nullable on purpose: profiles saved before this migration keep a
-- NULL and the UI falls back to the rule headers, stating that narrower scope
-- rather than pretending it knows the whole file.
--
-- Consumed by src/lib/import/headerDiff.js profileHeaders(), which returns
-- `complete: false` for the fallback so the dialog can say so out loud.
--
-- APPLIED LIVE 2026-07-27 as v391_profile_header_columns.
alter table public.import_mapping_profiles
  add column if not exists header_columns jsonb;

comment on column public.import_mapping_profiles.header_columns is
  'Full ordered column list of the file this profile was built on. NULL for profiles saved before V391 - callers must fall back to the mapping rule headers and say so.';
