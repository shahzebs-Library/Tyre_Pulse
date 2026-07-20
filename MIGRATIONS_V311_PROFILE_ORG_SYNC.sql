-- V311 (Phase-1 SaaS security) — profiles.org_id <-> organisation_id keep-in-sync
--
-- STATUS: NOT YET APPLIED. This file is additive / non-destructive and is meant
-- to be reviewed, then applied live by the parent via Supabase MCP
-- (apply_migration). It creates NO table, drops NO column, and rewrites NO data
-- beyond filling a NULL org column at write time. Next free migration after this
-- is V312.
--
-- WHY:
-- public.profiles carries BOTH `org_id` and `organisation_id`. Today every row
-- has them identical, but they are two independent columns, so any future code
-- path (a signup handler, an admin RPC, a dashboard CSV import, a manual UPDATE)
-- that populates only ONE of them silently diverges the two. That is dangerous
-- because the app reads them from DIFFERENT places:
--   * public.app_current_org()      reads  profiles.org_id      (RLS org boundary)
--   * data tables + billing scope   use    organisation_id
-- A row where one is set and the other is NULL would therefore be visible under
-- one boundary and invisible under the other. This trigger removes that class of
-- bug at the source by guaranteeing the two columns can never disagree after a
-- write.
--
-- WHAT (BEFORE INSERT OR UPDATE trigger on public.profiles):
--   1. If exactly one of (org_id, organisation_id) is NULL and the other is set,
--      copy the set value into the NULL one (coalesce, both directions).
--   2. If BOTH are set but they DIFFER, prefer `org_id` and overwrite
--      organisation_id := org_id.
--      RATIONALE for preferring org_id: app_current_org() — the function that
--      actually enforces the RLS org boundary — reads org_id. Making org_id the
--      winner means the persisted value always matches the boundary the whole
--      app is filtered by, so a mismatch can never open a data-visibility hole.
--   3. If both are NULL, leave both NULL (nothing to derive; downstream defaults
--      / handle_new_user still apply). Non-destructive.
--
-- ORDERING vs the existing guard `trg_guard_profile_privileged` (BEFORE UPDATE,
-- V202/V307): Postgres fires multiple BEFORE row-triggers of the same event in
-- ASCENDING TRIGGER-NAME order. This trigger is named `tr_sync_profile_org`,
-- which sorts BEFORE `trg_guard_profile_privileged` because at the 3rd character
-- '_' (0x5F) < 'g' (0x67). Verified: 'tr_sync_profile_org' < 'trg_guard_profile_privileged'.
-- So the sync runs FIRST and the guard evaluates the already-reconciled NEW row.
--
-- WHY IT DOES NOT FIGHT THE PRIVILEGED-COLUMN GUARD:
-- The guard blocks a non-super Admin from changing org_id/organisation_id. This
-- sync only WRITES an org column when it arrives NULL (case 1) or when the two
-- disagree (case 2). On real data today BOTH columns are always set and equal,
-- so on every real UPDATE this trigger is a no-op and NEW.org_id / NEW.organisation_id
-- are left exactly as the caller supplied — the guard's org-change check is not
-- provoked. (Case 2 could in theory alter organisation_id and be blocked by the
-- guard for a non-super Admin; that only occurs for an already-divergent row,
-- which does not exist in production — and blocking such an edit is the safe
-- outcome.) The guard remains the authority on WHO may change org membership;
-- this trigger only keeps the two mirror columns internally consistent.

create or replace function public.sync_profile_org_columns()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- Case 1: fill a NULL org column from its set counterpart (both directions).
  if NEW.org_id is null and NEW.organisation_id is not null then
    NEW.org_id := NEW.organisation_id;
  elsif NEW.organisation_id is null and NEW.org_id is not null then
    NEW.organisation_id := NEW.org_id;

  -- Case 2: both set but differ -> prefer org_id (the RLS boundary column).
  elsif NEW.org_id is not null
        and NEW.organisation_id is not null
        and NEW.org_id is distinct from NEW.organisation_id then
    NEW.organisation_id := NEW.org_id;
  end if;

  -- Case 3 (both NULL): leave as-is. Nothing to derive.
  return NEW;
end;
$function$;

drop trigger if exists tr_sync_profile_org on public.profiles;
create trigger tr_sync_profile_org
  before insert or update on public.profiles
  for each row execute function public.sync_profile_org_columns();
