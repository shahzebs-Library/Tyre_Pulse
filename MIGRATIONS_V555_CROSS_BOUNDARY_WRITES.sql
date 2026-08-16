-- V555  FOUR CROSS-BOUNDARY WRITE PRIMITIVES, EACH REPRODUCED BEFORE IT WAS TOUCHED
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- Same mechanism as V542 / V543 / V548 / V550, one more time: a SECURITY DEFINER
-- function runs as its OWNER, no public table sets FORCE ROW LEVEL SECURITY, so
-- RLS never applies inside one. Each such function has to re-ask org, country and
-- site itself. These four did not.
--
-- EVERY FIGURE BELOW IS FROM A ROLLED-BACK TRANSACTION AGAINST LIVE DATA, and
-- every count of a cross-boundary write was taken as a PRIVILEGED reader after
-- `reset role` - counting from inside the impersonated session returns 0 and
-- looks exactly like a refusal (the V501 / V542 trap).
--
--   1 import_reverse_batch   KSA-only Manager 34793423, batch stamped country UAE:
--                            {"status":"reversed","deleted":1} and the UAE
--                            tyre_records row was GONE on privileged recount
--                            (1 -> 0). Restored by the rollback and re-verified.
--   2 unscrap_tyre_by_serial KSA-only principal promoted to plain org Admin (also
--                            in a rolled-back transaction): UAE tyre went
--                            Scrapped -> Removed, {"updated":1}.
--   3 brain_classify_cached  Egypt Director a4fd5401 (org e340fa7a) inserted a
--                            row into Company A's brain_cache with an
--                            attacker-chosen item_code and item_desc (0 -> 1).
--   4 tyre_learn_confirm     KSA-only Manager: matched=0, filled=0 (V550's
--                            immediate-update fix held) but the FACT ROW landed
--                            with country NULL, and a later legitimate UAE insert
--                            of that serial came out branded 'ZZPOISON'.
--
-- ----------------------------------------------------------------------------
-- THE PREDICATE, AND WHY IT IS NOT app_can_see_country()
--
-- V550 scoped scrap_tyre_by_serial with app_can_see_country(). Finding 2 shows
-- that predicate does not close this class, and the probe measured it directly:
-- for the country-scoped plain Admin, app_can_see_country('UAE') returned TRUE.
-- app_can_see_country bypasses for app_is_org_admin() = is_super_admin() OR
-- role='admin', so any plain org Admin passes it for every country.
--
-- V498 already settled the principle - "country scoping is a DATA-VISIBILITY
-- boundary so its only legitimate bypass is the platform owner" - and rewrote the
-- 50 country-isolation POLICIES to is_super_admin(). The helper was left behind.
-- So the definer write path and the RLS write path disagree, and the definer path
-- is the looser of the two.
--
-- NEW public.app_write_country_ok(text) is the V542 write-policy expression
-- VERBATIM, copied from the live pg_get_expr of tyre_records_country_write:
--   country IS NULL OR is_super_admin() OR app_sees_all_countries()
--   OR lower(btrim(country)) = ANY (COALESCE(app_country_scope(), '{}'))
-- so a definer write is now judged by exactly the rule the table itself enforces
-- for an ordinary writer. Nothing is invented and the two cannot drift.
--
-- BLAST RADIUS MEASURED FIRST - it is IDENTICAL to app_can_see_country for every
-- live user, so no legitimate write is refused:
--   * 38 approved users: 2 super admins (pass via is_super_admin), 0 plain
--     Admins, 0 non-supers with no country scope, 0 holding the 'All' sentinel.
--   * the only country values anywhere are KSA, UAE and Egypt.
--   * `country IS NULL` still passes, the standing convention.
-- The two predicates differ ONLY for a plain org Admin and for a non-super with
-- no country array. Neither exists today, which is exactly why this is the moment
-- to close it.
--
-- scrap_tyre_by_serial is moved onto the same helper in the same pass. Leaving
-- it on app_can_see_country would close undo while leaving scrap - the action
-- with physical consequences - open to the same principal.
--
-- ----------------------------------------------------------------------------
-- 1  import_reverse_batch - CROSS-COUNTRY DELETE OF MASTER RECORDS
--
-- It checked org and app_is_elevated() - which a plain Manager passes - and had
-- NO country check at all, then ran `DELETE FROM <target> WHERE id::text = $1`
-- with no org and no country predicate either. Reachable targets are the ten
-- modules in import_target_table: vehicle_fleet, tyre_records, stock_records,
-- accidents, inspections, work_orders, warranty_claims, gate_passes, suppliers,
-- drivers. All ten carry both `country` and `organisation_id`, verified against
-- information_schema, so one uniform predicate is safe.
--
-- CORRECTION TO THE RECORD, worth stating because it reverses a standing claim:
-- the import gap is NOT bounded to staging. import_commit_batch does refuse a
-- cross-country commit (import_user_can_commit_country) - its reversal sibling
-- never learned the same lesson, and reversal DELETES master rows rather than
-- inserting them. parts_consumption is NOT reachable this way; it has no entry in
-- import_target_table.
--
-- FIXED IN TWO PLACES, because either alone is insufficient:
--   * the batch gate refuses a batch whose country the caller cannot write.
--   * the DELETE itself carries organisation_id AND the country predicate, so a
--     MIXED batch - rows whose target moved country after import - cannot reach
--     past the caller's scope even though the batch header passed.
-- Rows that the DELETE cannot reach are counted as `skipped`, keep their
-- target_record_id, and are reported in the return payload and the audit event.
-- A reversal that silently reported rows as deleted when they were not is how
-- this stayed invisible; `deleted` is now GET DIAGNOSTICS, not an optimistic
-- counter.
--
-- 2  unscrap_tyre_by_serial - the serial-keyed sibling V550 did not reach.
-- Scoped exactly as V550 scoped scrap: both tyre_records UPDATE branches, plus
-- the mark read and the mark delete, so a mark the caller cannot write is neither
-- consumed nor destroyed.
--
-- 3  brain_classify_cached - CROSS-TENANT WRITE, and the fix is deliberately NOT
-- a revoke. It is called by the NON-definer trigger classify_parts_consumption,
-- which runs as the inserting user and therefore needs its `authenticated` grant;
-- revoking would break every expense insert. It is also NOT a blind
-- `p_org := app_current_org()`: during a service_role bulk import auth.uid() is
-- NULL, so app_current_org() is NULL, and forcing it would key the cache on NULL
-- and break every import.
-- So the ARGUMENT IS REJECTED WHEN IT CONTRADICTS THE CALLER, and permitted when
-- there is no caller identity to contradict. That is exactly consistent with the
-- trigger, which passes coalesce(NEW.organisation_id, app_current_org()): for an
-- authenticated writer parts_consumption's own RESTRICTIVE org policy already
-- forces NEW.organisation_id = app_current_org(), so the guard can never fire on
-- a legitimate insert. 0 profiles have a null org_id, so no authenticated user
-- reaches the permissive branch today.
--
-- 4  tyre_learn_confirm - V550 fixed the immediate update and left the rule.
-- A learned fact is applied on every later write by the SECURITY DEFINER trigger
-- apply_tyre_learned_facts, which matched on organisation_id and serial ONLY and
-- never looked at the fact's country. So even a country-STAMPED fact would still
-- have rebranded another country's tyres. Both halves are therefore closed:
--   (a) the FACT ROW is stamped. A caller who does not see all countries cannot
--       author a global rule: with a single-country scope the fact is stamped
--       with that country (case preserved from profiles, not the lowercased
--       app_country_scope), with an ambiguous multi-country scope it is refused
--       'country_required' rather than guessed at. Supers and 'All' holders keep
--       the existing NULL = global behaviour. The client sends p_country NULL
--       from the All-countries view, so auto-stamping is what keeps the feature
--       working for the 35 single-country users; the 1 multi-country user must
--       now name a country, which is the honest outcome.
--   (b) the TRIGGER honours it: a fact with a country applies only to rows of
--       that country; a NULL-country fact stays global.
-- MEASURED BEFORE CHANGING THE TRIGGER: 22 facts, 21 stamped KSA and 1 NULL, and
-- the 21 stamped facts match ZERO rows outside their own country today. So the
-- trigger change moves nothing that exists and only constrains what comes next.
--
-- ----------------------------------------------------------------------------
-- import_batches / import_files GAIN THE MISSING WRITE HALF; import_rows DOES NOT
--
-- V542 excluded the three import tables on the grounds that staging writes are
-- the point of those tables. Finding 1 forces that to be re-judged, because the
-- cross-country DRAFT BATCH is the launch pad: import_batches_country_isolation
-- is polcmd='r', SELECT-only, so the attacker simply INSERTed a batch stamped
-- 'UAE' and handed it to the reversal.
--
-- The exclusion is NO LONGER DEFENSIBLE for import_batches and import_files. They
-- are one row per upload (44 and 11 rows live), their country is a column the
-- user chooses rather than something derived later, and there is no legitimate
-- reason to author a header for a country you are not assigned to. Each gains
-- <t>_country_write: RESTRICTIVE FOR ALL, carrying that table's OWN existing
-- expression in both USING and WITH CHECK, read from pg_get_expr - the V542
-- method, so the write rule cannot disagree with the read rule.
--
-- It REMAINS DEFENSIBLE for import_rows, deliberately. Its country is not its
-- own - the policy reads import_user_can_commit_country(import_batch_country(
-- batch_id)), a per-row function call plus a lookup on the one hot bulk path in
-- the system (the browser importer stages up to 100k rows per file). Once the
-- batch header cannot be cross-country, the rows inherit that boundary, and both
-- ends that consume them - commit and now reverse - gate on the batch country
-- independently. Paying a per-row subquery on every staged row to re-state a
-- boundary already enforced one level up is cost without a boundary.
-- Residual, stated rather than implied: import_rows still has no INSERT check, so
-- rows can be attached to a foreign-country batch inside the same org. They
-- cannot be read back (the SELECT policy holds), cannot be committed and cannot
-- be reversed by that user. That is noise, not a breach.
--
-- NAMED RESIDUAL, deliberately not changed here: import_user_can_commit_country
-- still carries the app_is_org_admin() bypass, so a plain org Admin can commit -
-- and now author a header - for any country. There are 0 plain Admins. Removing
-- that bypass touches three RLS policies plus import_commit_batch and belongs in
-- its own pass over the import path, not bolted onto this one.
--
-- ROLLBACK: re-create the five functions from _bak.rpc_defs_v555; drop
-- import_batches_country_write, import_files_country_write and
-- public.app_write_country_ok(text).

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v555;
create table _bak.rpc_defs_v555 (proname text, def text, saved_at timestamptz default now());

insert into _bak.rpc_defs_v555 (proname, def)
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('import_reverse_batch','unscrap_tyre_by_serial','scrap_tyre_by_serial',
                    'brain_classify_cached','tyre_learn_confirm','apply_tyre_learned_facts');

do $chk$
declare n int;
begin
  select count(*) into n from _bak.rpc_defs_v555;
  if n <> 6 then raise exception 'V555: expected 6 prior definitions, saved %', n; end if;
end $chk$;

-- ---------------------------------------------------------------- the predicate
create or replace function public.app_write_country_ok(p_country text)
returns boolean
language sql
stable parallel safe security definer
set search_path to 'public'
as $function$
  -- Byte-for-byte the V542 <t>_country_write policy expression. A SECURITY
  -- DEFINER write is judged by exactly the rule the table enforces on an
  -- ordinary writer. Unlike app_can_see_country this has NO app_is_org_admin()
  -- bypass: only the platform owner crosses a country boundary (V498).
  select p_country is null
      or public.is_super_admin()
      or public.app_sees_all_countries()
      or lower(btrim(p_country)) = any (coalesce(public.app_country_scope(), '{}'::text[]));
$function$;

grant execute on function public.app_write_country_ok(text) to authenticated, service_role;
revoke execute on function public.app_write_country_ok(text) from public;
revoke execute on function public.app_write_country_ok(text) from anon;

-- ------------------------------------------------------- 1  import_reverse_batch
do $mig$
declare
  def text;
  n   int;
  a_decl  constant text := 'v_org uuid := public.app_current_org(); v_target text; v_deleted int := 0;';
  a_org   constant text := E'RAISE EXCEPTION ''Cross-organisation reversal denied.'' USING errcode=''42501''; END IF;';
  a_del   constant text := E'EXECUTE format(''DELETE FROM public.%I WHERE id::text = $1'', v_target) USING r.target_record_id;';
  a_ret   constant text := E'RETURN jsonb_build_object(''status'',''reversed'',''deleted'',v_deleted);';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'import_reverse_batch';
  if def is null then raise exception 'V555: import_reverse_batch not found'; end if;

  -- guard: the LIVE body must be the one analysed, in every part being changed
  n := (length(def) - length(replace(def, a_decl, ''))) / length(a_decl);
  if n <> 1 then raise exception 'V555: reverse DECLARE anchor matched % times', n; end if;
  n := (length(def) - length(replace(def, a_org, ''))) / length(a_org);
  if n <> 1 then raise exception 'V555: reverse org-gate anchor matched % times', n; end if;
  n := (length(def) - length(replace(def, a_del, ''))) / length(a_del);
  if n <> 1 then raise exception 'V555: reverse DELETE anchor matched % times', n; end if;
  n := (length(def) - length(replace(def, a_ret, ''))) / length(a_ret);
  if n <> 1 then raise exception 'V555: reverse RETURN anchor matched % times', n; end if;
  if position('public.app_write_country_ok' in def) > 0 then
    raise exception 'V555: import_reverse_batch already scoped - refusing to re-apply';
  end if;
end $mig$;

CREATE OR REPLACE FUNCTION public.import_reverse_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE b public.import_batches%ROWTYPE; r public.import_rows%ROWTYPE;
  v_org uuid := public.app_current_org(); v_target text; v_deleted int := 0;
  v_skipped int := 0; v_hit int := 0;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Reversal requires an elevated role.' USING errcode='42501'; END IF;
  SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;
  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation reversal denied.' USING errcode='42501'; END IF;
  -- V555: reversal DELETES master records. A batch whose country the caller may
  -- not write is refused outright, not silently reversed row by row.
  IF NOT public.app_write_country_ok(b.country) THEN
    RAISE EXCEPTION 'Cross-country reversal denied: you are not assigned to country %.', b.country
      USING errcode='42501'; END IF;
  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN RAISE EXCEPTION 'No target table for module "%".', b.module; END IF;
  FOR r IN SELECT * FROM public.import_rows WHERE batch_id=p_batch_id AND target_record_id IS NOT NULL LOOP
    -- V555: the DELETE carries the boundary itself, so a MIXED batch cannot
    -- reach a row outside the caller's org or country. All ten reachable target
    -- tables carry both columns.
    EXECUTE format(
      'DELETE FROM public.%I WHERE id::text = $1 AND organisation_id = $2'
      || ' AND (country IS NULL OR public.app_write_country_ok(country))', v_target)
      USING r.target_record_id, v_org;
    GET DIAGNOSTICS v_hit = ROW_COUNT;
    IF v_hit > 0 THEN
      UPDATE public.import_rows SET target_record_id=NULL, processed_at=NULL WHERE id=r.id;
      v_deleted := v_deleted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;
  UPDATE public.import_batches SET import_status='reversed', imported_rows=0, completed_at=now() WHERE id=p_batch_id;
  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, auth.uid(), 'reverse',
            jsonb_build_object('deleted',v_deleted,'skipped',v_skipped,'target',v_target));
  RETURN jsonb_build_object('status','reversed','deleted',v_deleted,'skipped',v_skipped);
END $function$;

-- --------------------------------------------------- 2  unscrap_tyre_by_serial
do $mig$
declare
  def text; newdef text; n int;
  a_mark constant text := E'and mark_type = ''scrap'' and organisation_id = v_org;';
  a_upd1 constant text := E'       and t.status = ''Scrapped''\n       and v_prior ? t.id::text;';
  a_upd2 constant text := E'       and organisation_id = v_org\n       and status = ''Scrapped'';';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'unscrap_tyre_by_serial';
  if def is null then raise exception 'V555: unscrap_tyre_by_serial not found'; end if;
  if position('app_write_country_ok' in def) > 0 then
    raise exception 'V555: unscrap already scoped - refusing to re-apply'; end if;

  -- the mark read AND the mark delete share this line; both must be scoped.
  -- the anchor carries the terminating ';' so the predicate lands INSIDE the
  -- statement rather than after it.
  n := (length(def) - length(replace(def, a_mark, ''))) / length(a_mark);
  if n <> 2 then raise exception 'V555: unscrap mark anchor matched % times, expected 2', n; end if;
  newdef := replace(def, a_mark,
    E'and mark_type = ''scrap'' and organisation_id = v_org\n     and (country is null or public.app_write_country_ok(country));');

  n := (length(newdef) - length(replace(newdef, a_upd1, ''))) / length(a_upd1);
  if n <> 1 then raise exception 'V555: unscrap restore-update anchor matched % times', n; end if;
  newdef := replace(newdef, a_upd1,
    E'       and t.status = ''Scrapped''\n       and (t.country is null or public.app_write_country_ok(t.country))\n       and v_prior ? t.id::text;');

  n := (length(newdef) - length(replace(newdef, a_upd2, ''))) / length(a_upd2);
  if n <> 1 then raise exception 'V555: unscrap fallback-update anchor matched % times', n; end if;
  newdef := replace(newdef, a_upd2,
    E'       and organisation_id = v_org\n       and (country is null or public.app_write_country_ok(country))\n       and status = ''Scrapped'';');

  execute newdef;
end $mig$;

-- --------------------- 2b  scrap_tyre_by_serial onto the same predicate as undo
do $mig$
declare def text; newdef text; n int;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'scrap_tyre_by_serial';
  if def is null then raise exception 'V555: scrap_tyre_by_serial not found'; end if;

  n := (length(def) - length(replace(def, 'public.app_can_see_country(', ''))) / length('public.app_can_see_country(');
  if n <> 3 then raise exception 'V555: scrap app_can_see_country matched % times, expected 3', n; end if;
  newdef := replace(def, 'public.app_can_see_country(', 'public.app_write_country_ok(');
  execute newdef;
end $mig$;

-- ---------------------------------------------------- 3  brain_classify_cached
do $mig$
declare
  def text; newdef text; n int;
  a_decl constant text := E'  v_ver  int := public.brain_rules_version();\nbegin\n';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'brain_classify_cached';
  if def is null then raise exception 'V555: brain_classify_cached not found'; end if;
  if position('Cross-organisation classification denied' in def) > 0 then
    raise exception 'V555: brain_classify_cached already guarded - refusing to re-apply'; end if;

  n := (length(def) - length(replace(def, a_decl, ''))) / length(a_decl);
  if n <> 1 then raise exception 'V555: brain declare/begin anchor matched % times', n; end if;

  newdef := replace(def, a_decl,
    E'  v_ver  int := public.brain_rules_version();\n'
 || E'  v_caller uuid := public.app_current_org();\n'
 || E'begin\n'
 || E'  -- V555: p_org was inserted unchecked, so any authenticated caller could\n'
 || E'  -- write a cache row into ANOTHER tenant. Reject an argument that\n'
 || E'  -- contradicts the caller; permit it when there is no caller identity to\n'
 || E'  -- contradict (service_role bulk import: auth.uid() and therefore\n'
 || E'  -- app_current_org() are NULL). NOT a revoke - the non-definer trigger\n'
 || E'  -- classify_parts_consumption needs the authenticated grant.\n'
 || E'  if v_caller is not null and p_org is distinct from v_caller\n'
 || E'     and not public.is_super_admin() then\n'
 || E'    raise exception ''Cross-organisation classification denied.'' using errcode = ''42501'';\n'
 || E'  end if;\n');
  execute newdef;
end $mig$;

-- ------------------------------------------------------- 4a  tyre_learn_confirm
do $mig$
declare
  def text; newdef text; n int;
  a_decl constant text := '  v_pred text; v_mv text := btrim(p_match_value); v_tv text := btrim(p_target_value);';
  a_dry  constant text := E'  if p_dry_run then\n    return json_build_object(''ok'',true,''dry_run'',true,''matched'',v_matched,''filled'',0);\n  end if;';
  a_ins  constant text := '  values (v_org,p_country,p_match_type,v_mv,p_target_field,v_tv,coalesce(p_source,''manual''))';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'tyre_learn_confirm';
  if def is null then raise exception 'V555: tyre_learn_confirm not found'; end if;
  if position('v_fact_country' in def) > 0 then
    raise exception 'V555: tyre_learn_confirm already stamped - refusing to re-apply'; end if;

  -- same predicate swap as scrap: guard + count predicate + CTE predicate
  n := (length(def) - length(replace(def, 'public.app_can_see_country(', ''))) / length('public.app_can_see_country(');
  if n <> 3 then raise exception 'V555: learn_confirm app_can_see_country matched % times, expected 3', n; end if;
  newdef := replace(def, 'public.app_can_see_country(', 'public.app_write_country_ok(');

  n := (length(newdef) - length(replace(newdef, a_decl, ''))) / length(a_decl);
  if n <> 1 then raise exception 'V555: learn_confirm declare anchor matched % times', n; end if;
  newdef := replace(newdef, a_decl, a_decl || E'\n  v_fact_country text := p_country;\n  v_scope text[];');

  n := (length(newdef) - length(replace(newdef, a_dry, ''))) / length(a_dry);
  if n <> 1 then raise exception 'V555: learn_confirm dry-run anchor matched % times', n; end if;
  newdef := replace(newdef, a_dry, a_dry || E'\n'
 || E'\n  -- V555: the immediate update was scoped by V550, the RULE was not. A fact'
 || E'\n  -- row is replayed on every later write by apply_tyre_learned_facts, so a'
 || E'\n  -- country-less rule authored by a country-scoped user brands another'
 || E'\n  -- country''s tyres days later. Stamp it, or refuse rather than guess.'
 || E'\n  if v_fact_country is null'
 || E'\n     and not (public.is_super_admin() or public.app_sees_all_countries()) then'
 || E'\n    select array_agg(x) into v_scope'
 || E'\n      from public.profiles pr, unnest(pr.country) x'
 || E'\n     where pr.id = auth.uid() and x is not null and btrim(x) <> '''';'
 || E'\n    if v_scope is null or cardinality(v_scope) = 0 then'
 || E'\n      return json_build_object(''ok'',false,''reason'',''forbidden'');'
 || E'\n    elsif cardinality(v_scope) = 1 then'
 || E'\n      v_fact_country := v_scope[1];'
 || E'\n    else'
 || E'\n      return json_build_object(''ok'',false,''reason'',''country_required'');'
 || E'\n    end if;'
 || E'\n  end if;');

  n := (length(newdef) - length(replace(newdef, a_ins, ''))) / length(a_ins);
  if n <> 1 then raise exception 'V555: learn_confirm insert anchor matched % times', n; end if;
  newdef := replace(newdef, a_ins,
    '  values (v_org,v_fact_country,p_match_type,v_mv,p_target_field,v_tv,coalesce(p_source,''manual''))');

  execute newdef;
end $mig$;

-- --------------------------------------------- 4b  the trigger honours country
do $mig$
declare
  def text; newdef text; n int;
  a constant text := 'and organisation_id=NEW.organisation_id';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'apply_tyre_learned_facts';
  if def is null then raise exception 'V555: apply_tyre_learned_facts not found'; end if;
  if position('lower(btrim(country))' in def) > 0 then
    raise exception 'V555: learned-fact trigger already country-aware - refusing to re-apply'; end if;

  -- six lookups: brand/size/removal_reason x serial/alias
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 6 then raise exception 'V555: learned-fact trigger org anchor matched % times, expected 6', n; end if;
  newdef := replace(def, a,
    a || ' and (country is null or lower(btrim(country))=lower(btrim(NEW.country)))');
  execute newdef;
end $mig$;

-- ------------------- import_batches / import_files gain the missing write half
do $mig$
declare r record; expr text; n int := 0;
begin
  for r in
    select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) as q,
           coalesce((select string_agg(quote_ident(rolname), ', ' order by rolname)
                     from pg_roles where oid = any(p.polroles)), 'public') as roles
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname in ('import_batches','import_files')
      and p.polname like '%\_country\_isolation'
      and p.polcmd = 'r' and not p.polpermissive
  loop
    expr := r.q;
    if expr is null or position('import_user_can_commit_country' in expr) = 0 then
      raise exception 'V555: unexpected country expression on % : %', r.relname, coalesce(expr,'<null>');
    end if;
    if exists (select 1 from pg_policy p2 join pg_class c2 on c2.oid = p2.polrelid
               where c2.relname = r.relname and p2.polname = r.relname || '_country_write') then
      continue;
    end if;
    -- V542's method: copy the table's OWN expression into BOTH halves so the
    -- write rule can never disagree with the read rule. The ROLES are copied
    -- too - these two policies target `authenticated`, not public, and a
    -- restrictive policy widened to public would apply to roles the read rule
    -- never touched.
    execute format(
      'create policy %I on public.%I as restrictive for all to %s using (%s) with check (%s)',
      r.relname || '_country_write', r.relname, r.roles, expr, expr);
    n := n + 1;
  end loop;
  if n <> 2 then raise exception 'V555: expected 2 import write policies, created %', n; end if;
end $mig$;

-- ---------------------------------------------------------------- verification
do $chk$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('import_reverse_batch','unscrap_tyre_by_serial','scrap_tyre_by_serial','tyre_learn_confirm')
    and pg_get_functiondef(p.oid) not like '%app_write_country_ok%';
  if bad is not null then raise exception 'V555: write scope missing on %', bad; end if;

  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='brain_classify_cached')
     not like '%Cross-organisation classification denied%' then
    raise exception 'V555: brain_classify_cached guard missing';
  end if;

  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='apply_tyre_learned_facts')
     not like '%lower(btrim(country))%' then
    raise exception 'V555: learned-fact trigger still ignores country';
  end if;

  -- every touched function keeps DEFINER and a pinned search_path
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('import_reverse_batch','unscrap_tyre_by_serial','scrap_tyre_by_serial',
                      'brain_classify_cached','tyre_learn_confirm','apply_tyre_learned_facts')
    and (not p.prosecdef or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if bad is not null then raise exception 'V555: DEFINER/search_path lost on %', bad; end if;

  -- anon must not reach any of them, and authenticated must still reach them
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('import_reverse_batch','unscrap_tyre_by_serial','scrap_tyre_by_serial',
                      'brain_classify_cached','tyre_learn_confirm','app_write_country_ok')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if bad is not null then raise exception 'V555: grant regression on %', bad; end if;
end $chk$;
