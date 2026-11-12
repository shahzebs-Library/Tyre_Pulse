-- COM-5 (audit MODA-2): warranty claim numbers are unique per organisation and minted server side.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the live catalog (pg_constraint,
--         pg_indexes, pg_trigger on public.warranty_claims; project jhssdmeruxtrlqnwfksc,
--         SELECT only). Not applied to any database. Tested on PGlite only
--         (supabase/tests/commercial_tyre_keys.test.mjs).
--         NOTE FOR WHOEVER APPLIES IT: the text removes a constraint, and the Supabase MCP asks
--         a person to confirm such statements. Apply when the owner can approve the prompt.
--
-- ROOT CAUSE
--   1. Constraint warranty_claim_no_country_uniq UNIQUE (claim_no, country) has no organisation
--      column. WAR-2026-00001 in a country can exist once for the whole platform.
--   2. The number is built in the BROWSER from the rows the user can see
--      (src/lib/warrantyTrackerAnalytics.js generateClaimNo: highest WAR-<year>-<n> in the
--      loaded list, plus one). Row security hides other companies, other countries and other
--      sites, so every company's first claim of the year is WAR-<year>-00001. The second
--      company's first claim in the same country fails with 23505. Inside one company two
--      users saving at the same moment, or a user scoped to one site, hit the same error.
--   Live today: warranty_claims holds 0 rows and the module is switched off.
--
-- WHAT THIS CHANGES
--   1. The unique key becomes (organisation_id, claim_no, country). Same semantics as today
--      inside one company (a null country is still not policed, as today).
--   2. public.next_warranty_claim_no(country): returns the next WAR-<year>-<5 digits> for the
--      caller's organisation and that country. It reads past row security (the V108 accident
--      reference lesson: a scoped user must not mint a number that already exists in a country
--      or site they cannot see) and serialises per organisation, country and year.
--   3. A BEFORE INSERT trigger mints the number when the client sent none, and RE-MINTS it when
--      the number the browser sent is already taken in that organisation and country. A browser
--      number that is free is kept exactly as sent, so today's client keeps working unchanged.
--
-- RISK TO THE CURRENT COMPANY: NONE. The table is empty. A claim saved by today's web page gets
--   the number the page computed, as it does now; only a number that would have failed with a
--   duplicate error is replaced by the next free one.
--   Web follow-up (not required for this to work): src/pages/WarrantyTracker.jsx:459 should stop
--   computing the number and show the one the insert returns.
--
-- VERIFY (after applying; read only)
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.warranty_claims'::regclass and contype = 'u';
--     -- UNIQUE (organisation_id, claim_no, country)
--   select tgname from pg_trigger where tgrelid = 'public.warranty_claims'::regclass
--      and tgname = 'trg_warranty_claim_no_assign';                                  -- 1 row
--   select has_function_privilege('anon','public.next_warranty_claim_no(text)','EXECUTE'); -- f
--
-- ROLLBACK (only while no two organisations hold the same number in the same country)
--   remove trigger trg_warranty_claim_no_assign and functions warranty_claim_no_assign(),
--   next_warranty_claim_no(text), _next_warranty_claim_no(uuid,text,date);
--   alter table public.warranty_claims add constraint warranty_claim_no_country_uniq unique (claim_no, country);
--   remove constraint warranty_claim_no_org_country_uniq.

do $migration$
begin
  if exists (select 1 from public.warranty_claims
              group by organisation_id, claim_no, country having count(*) > 1) then
    raise exception 'COM-5: duplicate (organisation_id, claim_no, country) rows exist.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.warranty_claims'::regclass
                    and conname = 'warranty_claim_no_org_country_uniq') then
    alter table public.warranty_claims
      add constraint warranty_claim_no_org_country_uniq unique (organisation_id, claim_no, country);
  end if;
  if exists (select 1 from pg_constraint
              where conrelid = 'public.warranty_claims'::regclass
                and conname = 'warranty_claim_no_country_uniq') then
    alter table public.warranty_claims drop constraint warranty_claim_no_country_uniq;
  end if;
end
$migration$;

-- Internal: takes an organisation id, so it is not executable by anon or authenticated.
create or replace function public._next_warranty_claim_no(p_org uuid, p_country text, p_on date)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year   text := to_char(coalesce(p_on, current_date), 'YYYY');
  v_prefix text := 'WAR-' || to_char(coalesce(p_on, current_date), 'YYYY') || '-';
  v_next   int;
begin
  if p_org is null then
    raise exception 'A warranty claim needs an organisation' using errcode = '22023';
  end if;
  -- One minter at a time per organisation, country and year.
  perform pg_advisory_xact_lock(hashtextextended(
    'warranty_claim_no|' || p_org::text || '|' || lower(coalesce(btrim(p_country), '')) || '|' || v_year, 0));
  select coalesce(max(substring(w.claim_no from length(v_prefix) + 1)::int), 0) + 1
    into v_next
    from public.warranty_claims w
   where w.organisation_id = p_org
     and w.country is not distinct from p_country
     and w.claim_no ~ ('^WAR-' || v_year || '-[0-9]{1,9}$');
  return v_prefix || lpad(v_next::text, 5, '0');
end
$function$;

create or replace function public.next_warranty_claim_no(p_country text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.app_current_org();
begin
  if v_org is null or not public.app_is_active() then
    raise exception 'You do not have permission to create a warranty claim' using errcode = '42501';
  end if;
  return public._next_warranty_claim_no(v_org, nullif(btrim(coalesce(p_country, '')), ''), current_date);
end
$function$;

create or replace function public.warranty_claim_no_assign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.organisation_id is null then
    return new;   -- the organisation wall refuses the row; nothing to number
  end if;
  if nullif(btrim(coalesce(new.claim_no, '')), '') is null
     or exists (select 1 from public.warranty_claims w
                 where w.organisation_id = new.organisation_id
                   and w.claim_no = new.claim_no
                   and w.country is not distinct from new.country) then
    new.claim_no := public._next_warranty_claim_no(new.organisation_id, new.country, current_date);
  end if;
  return new;
end
$function$;

revoke all on function public._next_warranty_claim_no(uuid, text, date) from public, anon, authenticated;
revoke all on function public.next_warranty_claim_no(text) from public, anon;
revoke all on function public.warranty_claim_no_assign() from public, anon, authenticated;
grant execute on function public._next_warranty_claim_no(uuid, text, date) to service_role;
grant execute on function public.next_warranty_claim_no(text) to authenticated, service_role;

-- Named to sort after trg_stamp_import_default_org (triggers fire in name order), so an
-- imported row already carries its organisation when the number is checked.
do $trigger$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.warranty_claims'::regclass
                    and tgname = 'trg_warranty_claim_no_assign') then
    create trigger trg_warranty_claim_no_assign
      before insert on public.warranty_claims
      for each row execute function public.warranty_claim_no_assign();
  end if;
end
$trigger$;
