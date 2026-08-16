-- V542 - COUNTRY AND SITE SCOPING NOW GOVERNS WRITES, NOT ONLY READS
--
-- THE HOLE, REPRODUCED BEFORE IT WAS FIXED. Country isolation was added as a
-- SELECT-only RESTRICTIVE policy (83 tables) and site isolation likewise (30).
-- A restrictive SELECT policy has a USING clause and no WITH CHECK, so it says
-- nothing about a row being WRITTEN. Impersonating a real approved KSA-only
-- Manager (adnan, role Manager, country {KSA}) inside a rolled-back transaction:
--
--   insert into tyre_records (serial_no, asset_no, country, tyre_position, status)
--   values ('ZZ-CROSSCOUNTRY-PROBE','ZZTEST','UAE','LHF1','Active');
--   -- reset role; select count(*) ... where serial_no = 'ZZ-CROSSCOUNTRY-PROBE'
--   -- => 1 row, country UAE
--
-- The row landed in UAE. The writer could not read it back afterwards, which is
-- exactly why this was invisible: counting from inside the session returns 0 and
-- looks like a refusal. Count as a privileged reader in the same transaction, or
-- the measurement flatters itself (the V501 trap, hit again here).
--
-- WHAT IS AND IS NOT AT RISK. This is a blind WRITE, never a read: nothing about
-- another country becomes visible. The damage is injection - a row appearing in
-- another country's registers, cost reports and exports, attributed to a user who
-- has no business there and who cannot even see what they created to undo it.
--
-- UPDATE was already refused in practice: moving a KSA row to country 'UAE' fails
-- on the SELECT policy because Postgres re-checks the new row. That is a side
-- effect of how UPDATE reads rows, not a rule anyone wrote down, so it is now
-- stated explicitly rather than depended on.
--
-- THE FIX COPIES EACH TABLE'S OWN EXPRESSION, it does not retype it. For every
-- table carrying a restrictive SELECT-only `<t>_country_isolation` (and the same
-- for `<t>_site_isolation`) this adds `<t>_country_write` / `<t>_site_write`:
-- RESTRICTIVE, FOR ALL, with that table's existing USING expression placed in
-- BOTH USING and WITH CHECK. Reading pg_get_expr and re-using it verbatim means
-- the write rule can never disagree with the read rule, and a table with a
-- variant expression keeps its own.
--
-- FOR ALL therefore changes nothing for SELECT (the same predicate ANDed with
-- itself) and adds the missing halves: INSERT gets a WITH CHECK, UPDATE gets an
-- explicit one, DELETE gets a USING so a blind delete by id cannot reach another
-- country's row.
--
-- BLAST RADIUS MEASURED FIRST, and it is zero for every legitimate write:
--   * 38 approved users: 2 super admins, 0 plain Admins, 35 single-country,
--     1 multi-country, and ZERO with no country scope - so nobody is blacked out.
--   * the only country values that exist anywhere are KSA, UAE and Egypt - no
--     nulls, no 'Saudi Arabia' variant - so the check cannot reject a spelling.
--   * `country IS NULL` still passes, so a writer that does not stamp a country
--     is unaffected (that is the existing convention: a null-country row is
--     visible to everyone).
--   * all 36 non-super users hold sites = {ALL}, so the site half is a no-op
--     today. It is included so the hole does not reappear the first time someone
--     assigns a real site scope.
--   * SECURITY DEFINER RPCs run as the table owner and imports run as
--     service_role, so neither is affected.
--
-- TWO POLICY SHAPES EXIST AND BOTH ARE LEGITIMATE: 46 tables use the V396
-- InitPlan form (`lower(btrim(country)) = ANY (app_country_scope())`) and 32 the
-- older row-argument helper (`app_can_see_country(country)`); site is 30 and 25.
-- Both are accepted and copied as-is. Anything else aborts rather than being
-- guessed at.
--
-- DELIBERATELY EXCLUDED: import_batches, import_files and import_rows. Their read
-- rule is `import_user_can_commit_country(...)`, a purpose-built gate for the
-- staging surface rather than the ordinary country scope, and staging writes are
-- the entire point of those tables - forcing that predicate onto every write
-- could refuse a row written before its batch carries a country. Their org
-- isolation still applies. Left for a deliberate pass over the import path.
--
-- ROLLBACK: drop every policy named like '%\_country\_write' or '%\_site\_write'.
-- The originals are untouched; this migration only ADDS policies.

do $$
declare
  r record;
  n_country int := 0;
  n_site    int := 0;
  expr text;
begin
  ---------------------------------------------------------------- country
  for r in
    select c.oid as reloid, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as using_expr
    from pg_policy p
    join pg_class c      on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where p.polname = c.relname || '_country_isolation'
      and p.polpermissive = false
      and p.polcmd = 'r'            -- SELECT-only is precisely the gap
    order by c.relname
  loop
    expr := r.using_expr;
    -- The import staging surface has its own gate; see the header.
    if expr like '%import_user_can_commit_country%' then
      continue;
    end if;
    -- A policy that consults neither scope reader is not one this migration
    -- understands; copying it blindly could widen access.
    if expr is null or (position('app_country_scope' in expr) = 0
                        and position('app_can_see_country' in expr) = 0) then
      raise exception 'V542: unexpected country policy shape on %: %', r.relname, expr;
    end if;

    execute format('drop policy if exists %I on public.%I',
                   r.relname || '_country_write', r.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to public using (%s) with check (%s)',
      r.relname || '_country_write', r.relname, expr, expr);
    n_country := n_country + 1;
  end loop;

  ------------------------------------------------------------------- site
  for r in
    select c.oid as reloid, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as using_expr
    from pg_policy p
    join pg_class c      on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    where p.polname = c.relname || '_site_isolation'
      and p.polpermissive = false
      and p.polcmd = 'r'
    order by c.relname
  loop
    expr := r.using_expr;
    if expr is null or (position('app_site_scope' in expr) = 0
                        and position('app_can_see_site' in expr) = 0) then
      raise exception 'V542: unexpected site policy shape on %: %', r.relname, expr;
    end if;

    execute format('drop policy if exists %I on public.%I',
                   r.relname || '_site_write', r.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to public using (%s) with check (%s)',
      r.relname || '_site_write', r.relname, expr, expr);
    n_site := n_site + 1;
  end loop;

  raise notice 'V542: country write policies %, site write policies %', n_country, n_site;

  -- Guards. A silent partial run is the failure mode that matters here: half a
  -- boundary reads as a closed one (the V396 lesson).
  -- Measured counts at authoring time: 78 country (81 policies less the 3 import
  -- staging tables) and 55 site.
  if n_country <> 78 then
    raise exception 'V542: expected 78 country tables, got %', n_country;
  end if;
  if n_site <> 55 then
    raise exception 'V542: expected 55 site tables, got %', n_site;
  end if;
end $$;
