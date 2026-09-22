-- STATUS: AUTHORED, NOT YET APPLIED (no database access in the authoring
-- session - neither the Supabase MCP nor the CLI held a token). Apply with
-- `supabase db query --linked --project-ref jhssdmeruxtrlqnwfksc --file <this>`
-- or the MCP apply tool, then run the VERIFY block below.
--
-- WHY: 20260921085115_washing_activity_and_evidence.sql added the CHECK
-- `wash_details_valid` over `valid_wash_details(wash_details)`, whose third
-- guard is:
--
--     jsonb_typeof(d->'checklist') is distinct from 'array' then return false
--
-- `d->'checklist'` on an object with no such key returns SQL NULL, and
-- `jsonb_typeof(NULL)` is NULL, which IS distinct from 'array' - so the guard
-- fires and the row is refused with Postgres 23514, mapped by
-- src/lib/safeError.js to the generic "Some values are not valid."
--
-- No client has ever written a `checklist` key: `emptyWashDetails()` in
-- src/lib/washDetails.js returns {version, chemical_status, chemicals} and the
-- web wash form attaches it to EVERY new log, so every save failed. The
-- migration's own header claims "Existing records and installed clients remain
-- valid"; this restores that promise - it was the only part of the shape the
-- clients did not already satisfy.
--
-- FIX: `checklist` becomes OPTIONAL. Absent means nothing was recorded and is
-- read as an empty list; present but not an array is still refused, and every
-- per-item rule (length, result vocabulary, a failed item needing a note) is
-- unchanged. This only ever ACCEPTS MORE than before, so no stored row can be
-- invalidated - Postgres does not re-validate existing rows when a CHECK's
-- function body is replaced, and widening cannot break one in any case.
--
-- The client is fixed in the same change (it now always sends `checklist: []`),
-- so this migration is what covers a browser tab still running the previous
-- bundle - the app is a prompt-mode PWA (skipWaiting:false), so an open tab
-- keeps its old build until the update prompt is accepted.
--
-- Idempotent: CREATE OR REPLACE only. Safe to re-run.

create or replace function public.valid_wash_details(d jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare item jsonb; field text; checklist jsonb;
begin
  if d is null then return true; end if;
  if jsonb_typeof(d) <> 'object' or octet_length(d::text) > 40000
    or d->>'version' is distinct from '1'
    or coalesce(d->>'chemical_status','') not in ('not_recorded','none','used')
    or jsonb_typeof(d->'chemicals') is distinct from 'array' then return false; end if;
  -- OPTIONAL: a missing `checklist` means nothing was recorded and is read as
  -- an empty list. Present but not an array is still rejected.
  if d ? 'checklist' and jsonb_typeof(d->'checklist') is distinct from 'array' then return false; end if;
  checklist := coalesce(d->'checklist', '[]'::jsonb);
  if jsonb_array_length(d->'chemicals') > 10 or jsonb_array_length(checklist) > 30
    or (d->>'chemical_status' <> 'used' and jsonb_array_length(d->'chemicals') <> 0)
    or (d->>'chemical_status' = 'used' and jsonb_array_length(d->'chemicals') = 0)
    then return false; end if;
  for item in select value from jsonb_array_elements(d->'chemicals') loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'name')),0) not between 1 and 160
      or coalesce(length(item->>'manufacturer'),0) > 160
      or coalesce(length(item->>'dilution'),0) > 120
      or coalesce(length(item->>'quantity'),0) > 40
      or coalesce(length(item->>'unit'),0) > 20
      or coalesce(length(item->>'sds_url'),0) > 1000
      or (coalesce(item->>'sds_url','') <> '' and item->>'sds_url' !~ '^https://[^[:space:]]+$')
      then return false; end if;
    foreach field in array array['name','manufacturer','quantity','unit','dilution','sds_url'] loop
      if item ? field and jsonb_typeof(item->field) <> 'string' then return false; end if;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(checklist) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'label')),0) not between 1 and 200
      or coalesce(item->>'result','') not in ('not_checked','pass','fail','na')
      or coalesce(length(item->>'note'),0) > 1000
      or (item->>'result' = 'fail' and coalesce(length(btrim(item->>'note')),0) = 0)
      then return false; end if;
    foreach field in array array['label','result','note'] loop
      if item ? field and jsonb_typeof(item->field) <> 'string' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- VERIFY (expect t,t,t,f,f,f):
--   select
--     public.valid_wash_details('{"version":1,"chemical_status":"not_recorded","chemicals":[]}'::jsonb),      -- the shape every save sent: was FALSE, now TRUE
--     public.valid_wash_details('{"version":1,"chemical_status":"not_recorded","chemicals":[],"checklist":[]}'::jsonb),
--     public.valid_wash_details(null),
--     public.valid_wash_details('{"version":1,"chemical_status":"not_recorded","chemicals":[],"checklist":{}}'::jsonb),   -- present but not an array
--     public.valid_wash_details('{"version":1,"chemical_status":"used","chemicals":[]}'::jsonb),                          -- "used" with no product
--     public.valid_wash_details('{"version":1,"chemical_status":"none","chemicals":[],"checklist":[{"label":"Rinse","result":"fail"}]}'::jsonb); -- failed item, no note
--
-- ROLLBACK: re-apply the function body from
-- supabase/migrations/20260921085115_washing_activity_and_evidence.sql
-- (identical except that `checklist` is mandatory). Note this reinstates the
-- defect for any client that omits the key.
