-- Atomic open-job-card snapshot replace for the in-app ERP Data Intake (/erp-intake).
--
-- STATUS: AUTHORED, NOT APPLIED (Supabase MCP was down when this was drafted).
--         A DB-authorised session must apply it and run the VERIFY block below,
--         then flip this header to "APPLIED LIVE <date>". The client
--         (src/lib/api/erpIntake.js replaceOpenWorkOrders) already calls this RPC
--         and falls back to a client-side delete+insert while it is unprovisioned,
--         so the import keeps working before and after apply.
--
-- WHY. The open-job-card list is a SNAPSHOT: re-uploading the Open Job Cards
-- export must replace this country's rows. The client used to do it in two steps
-- (delete this country's rows, then chunked insert). If the insert failed partway
-- (a network drop, a constraint), the delete had already committed and the open
-- list was left empty. This RPC does the delete and the insert in ONE transaction
-- so a failure rolls both back - the previous snapshot survives.
--
-- SECURITY. SECURITY DEFINER, pinned search_path. Gated by app_is_elevated() AND
-- app_can_see_country(p_country): a country-scoped user can only replace a list for
-- a country they can see. The function is DEFINER (RLS does not run inside it), so
-- BOTH the delete and the insert are scoped to the CALLER's organisation
-- (app_current_org()); a caller can never delete or replace another tenant's open
-- list, even one in a country they can see. Each row's country is FORCED to
-- p_country and its organisation to the caller's org server-side, so a mislabelled
-- row cannot cross either boundary; identity/timestamp columns are stripped from the
-- payload so the table's own defaults apply. jsonb_populate_recordset coerces each
-- cell to the real column type, so this stays correct whatever the declared types
-- of job_card_date / days_open are.
--
-- NEVER 40001. A conflict (unique or serialization) is raised as PT409 (HTTP 409,
-- which PostgREST does NOT auto-retry); 40001 would make PostgREST retry forever.
-- The whole function is one transaction, so the PT409 rolls the delete+insert back.
--
-- DROP-FREE: CREATE OR REPLACE only, so no destructive statement needs the MCP
-- confirmation prompt.
-- ---------------------------------------------------------------------------

create or replace function public.replace_open_work_orders(p_country text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_country  text := nullif(btrim(p_country), '');
  v_org      uuid := public.app_current_org();
  v_rows     jsonb;
  v_deleted  integer := 0;
  v_inserted integer := 0;
begin
  if not coalesce(public.app_is_elevated(), false) then
    raise exception 'Not permitted to replace the open job card list' using errcode = '42501';
  end if;
  if v_country is null then
    raise exception 'A country is required to replace the open job card list' using errcode = '22023';
  end if;
  if v_org is null then
    -- No tenant in context (e.g. a service_role call with no profile). A tenant-scoped
    -- replace is impossible without one, so refuse rather than touch every org's rows.
    raise exception 'No organisation in context to replace the open job card list' using errcode = '42501';
  end if;
  if public.app_can_see_country(v_country) is not true then
    raise exception 'Not permitted for country %', v_country using errcode = '42501';
  end if;

  -- Force the country onto every row and drop the auto-managed columns so the
  -- table defaults / stamp-org trigger apply (a jsonb null would override them).
  v_rows := (
    select coalesce(jsonb_agg(
             (elem - 'id' - 'created_at' - 'updated_at' - 'organisation_id')
             || jsonb_build_object('country', v_country)
           ), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) elem
    where jsonb_typeof(elem) = 'object'
  );

  -- Atomic snapshot replace for THIS tenant's rows in THIS country only. DEFINER
  -- bypasses RLS, so the organisation predicate is what keeps the delete inside the
  -- caller's tenant; other orgs' and null-country rows are untouched.
  delete from public.open_work_orders where organisation_id = v_org and country = v_country;
  get diagnostics v_deleted = row_count;

  insert into public.open_work_orders
    (organisation_id, job_card_no, location, job_card_type, jc_status, job_card_date,
     open_time, asset_type, asset_no, days_open, complaint, country)
  select v_org, r.job_card_no, r.location, r.job_card_type, r.jc_status, r.job_card_date,
         r.open_time, r.asset_type, r.asset_no, r.days_open, r.complaint, v_country
  from jsonb_populate_recordset(null::public.open_work_orders, v_rows) r
  where coalesce(btrim(r.job_card_no), '') <> '';
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'inserted', v_inserted);
exception
  when unique_violation or serialization_failure then
    -- Never 40001: PostgREST retries it forever. PT409 -> a clean HTTP 409 and
    -- the whole transaction (delete + insert) rolls back, keeping the old list.
    raise exception 'The open job card list changed while saving; upload it again'
      using errcode = 'PT409';
end $fn$;

comment on function public.replace_open_work_orders(text, jsonb) is
  'Atomic country-scoped replace of the open_work_orders snapshot for /erp-intake. '
  'Elevated + app_can_see_country gated; forces country per row; PT409 on conflict.';

-- Grant order mirrors the V500 anon-lockdown rule: grant the real callers, then
-- strip PUBLIC and anon so an unauthenticated caller can never execute it.
grant execute on function public.replace_open_work_orders(text, jsonb) to authenticated, service_role;
revoke execute on function public.replace_open_work_orders(text, jsonb) from public;
revoke execute on function public.replace_open_work_orders(text, jsonb) from anon;

-- ---------------------------------------------------------------------------
-- VERIFY (each in its own call; the write tests inside a ROLLED-BACK transaction).
--   1. Shape + security flags:
--      select proname, prosecdef, proconfig
--        from pg_proc where proname = 'replace_open_work_orders';
--      -- expect prosecdef = true and proconfig contains search_path=public
--   2. Anon cannot execute:
--      select has_function_privilege('anon',
--        'public.replace_open_work_orders(text,jsonb)', 'execute');  -- expect false
--   3. As a real elevated user (set request.jwt.claims + set local role authenticated),
--      rolled back:
--        begin;
--        select public.replace_open_work_orders('KSA',
--          '[{"job_card_no":"ZZ-VERIFY-1","asset_no":"TM000","jc_status":"Open",
--             "days_open":"5","job_card_date":"2026-11-01"}]'::jsonb);
--        -- expect { ok:true, deleted:<n>, inserted:1 }; row carries country='KSA'
--        select count(*) from public.open_work_orders
--          where job_card_no = 'ZZ-VERIFY-1' and country = 'KSA';  -- expect 1
--        rollback;
--   4. A country the caller cannot see is refused:
--        select public.replace_open_work_orders('UAE', '[]'::jsonb);  -- expect 42501
--        -- (as a KSA-only elevated user)
--
-- ROLLBACK:
--   drop function if exists public.replace_open_work_orders(text, jsonb);
--   -- The client then uses its built-in delete+insert fallback automatically.
-- ---------------------------------------------------------------------------
