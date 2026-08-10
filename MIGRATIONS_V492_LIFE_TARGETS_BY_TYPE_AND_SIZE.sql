-- V492 - TYRE LIFE TARGETS BY SIZE, VEHICLE TYPE, OR BOTH (most specific wins)
-- STATUS: APPLIED LIVE 2026-08-10 (project jhssdmeruxtrlqnwfksc) via apply_migration
-- (v492_life_targets_by_type_and_size) + a follow-up size-key rewrite of the RPC.
--
-- OWNER ASK: "we should be able to set it based on not only size but also vehicle
-- type and both for same vehicle, whichever comes first" + "one tyre is having
-- different numbers".
--
-- TWO REAL DEFECTS FIXED:
-- 1. A target REQUIRED a size (NOT NULL + the matcher's `t.size = a.size`), so a
--    vehicle-type-only target could never exist or match.
-- 2. tyre_records stores the SAME size under several spellings ("315/80 R 22.5",
--    "315/80R22.5", "315 /80R22.5") and the owner's own 12 targets carried three
--    of them - identical tyres matched different targets/baselines = "one tyre
--    having different numbers".
--
-- WHAT:
-- * tyre_life_targets.size is now NULLABLE + CHECK (size OR vehicle_type set);
--   unique index rebuilt as (org, coalesce(country,'~'), coalesce(size,'~'),
--   coalesce(vehicle_type,'~')).
-- * NEW public.tyre_size_key(text) IMMUTABLE = upper + strip ALL whitespace -
--   THE size comparator. get_tyre_running_life now compares sizes through it for
--   the manual-target match AND the measured base_size/base_type baselines, so
--   every spelling of a size resolves to ONE expected life.
-- * Target precedence (the lateral join's ORDER BY): specificity COUNT of pinned
--   dimensions first (size+type=2 beats any 1), then vehicle_type over size at a
--   tie, then country-pinned over country-blank. Same rule as V477 approval
--   matrix: a COUNT, never a hand-ranked list.
--
-- CLIENT (same commit): saveTyreLifeTarget accepts size OR vehicle_type (at least
-- one); the Life targets modal offers "All sizes" and enables save with either.
--
-- VERIFIED LIVE (rolled back): with a type-only TR-MIXER 50,000 target inserted,
-- a 315/80R22.5 TR-MIXER tyre still reads 60,000 (size+type wins), a 385/65R22.5
-- TR-MIXER reads 50,000 (type-only beats the size-only 35,000); after the size-key
-- rewrite ALL 2,501 TR-MIXER 315/80R22.5 tyres (every spelling) read one number.
--
-- ROLLBACK: restore the V489 function body, drop the CHECK, set size NOT NULL
-- (after deleting size-null rows), rebuild the old unique index.

-- See v492_life_targets_by_type_and_size in supabase_migrations for the applied
-- DDL; the final get_tyre_running_life body (with tyre_size_key) is the live one.

create or replace function public.tyre_size_key(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p,''),'\s+','','g')),'') $$;

alter table public.tyre_life_targets alter column size drop not null;
alter table public.tyre_life_targets drop constraint if exists tyre_life_targets_dimension_chk;
alter table public.tyre_life_targets add constraint tyre_life_targets_dimension_chk
  check (size is not null or vehicle_type is not null);

drop index if exists tyre_life_targets_uidx;
create unique index tyre_life_targets_uidx on public.tyre_life_targets
  (organisation_id, coalesce(country, '~'), coalesce(size, '~'), coalesce(vehicle_type, '~'));

-- get_tyre_running_life: target lateral join now
--   where (t.size is null or tyre_size_key(t.size) = tyre_size_key(a.size))
--     and (t.vehicle_type is null or t.vehicle_type = a.vehicle_type)
--     and (t.country is null or t.country = a.country)
--   order by ((t.size is not null)::int + (t.vehicle_type is not null)::int) desc,
--            (t.vehicle_type is not null) desc, (t.country is not null) desc
--   limit 1
-- and base_size/base_type group + join on tyre_size_key(size).
