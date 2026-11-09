-- =====================================================================
-- 20261109090000  Tyre replacement reconciliation + refit price correction
-- =====================================================================
-- STATUS: see the session memory entry. Every part below is guarded and
-- reversible; nothing deletes a row.
--
-- WHY (measured live 2026-11-09, project jhssdmeruxtrlqnwfksc):
--
-- 1. A monthly ERP tyre file carries the NEW tyre on a wheel but not the old
--    serial. process_stg_monthly_tyres inserted the new tyre as Active and never
--    closed the tyre already on that wheel. guard_tyre_active_fitment returns
--    early when auth.uid() is null (every staging / Table Editor load), so the
--    staging path could leave TWO active tyres on one wheel. 0 such wheels exist
--    today, so this is LATENT, not live damage. The in-app ERP intake runs as a
--    signed-in user, so the guard refused the new tyre (23505) and the row was
--    reported "failed" while the old tyre stayed Active forever.
--    FIX: one shared function _tyre_close_replaced() closes the previous fitment
--    ONLY when the evidence is unambiguous (exactly one active tyre on that wheel,
--    a different serial, an earlier dated fitment, and no later history on the
--    wheel). Anything else is reported for review, never guessed. Every closure
--    is logged with the old values in tyre_replacement_log and can be undone per
--    batch. The removed tyre is NEVER marked scrapped.
--
-- 2. tyre_records_master_process nulled km_at_fitment = 0 on EVERY update. 0 at
--    fitment is the owner-approved "fitted new on a new machine" value
--    (src/lib/tyreKm.js 'factory'), so any later update of such a tyre - including
--    closing it on replacement - silently destroyed it. INSERT behaviour is kept
--    exactly (a blank imported as 0 still becomes null); on UPDATE a stored 0 that
--    did not change is now preserved.
--
-- 3. tyre_price_backfill gave a REFITTED tyre a second, estimated ('comparable')
--    purchase price although the same tyre already carried a price on an earlier
--    fitment. Measured: 90 KSA rows, SAR 79,950 of invented purchase cost
--    (Egypt/UAE 0). The 'comparable' rung now skips a tyre whose serial is already
--    priced on another row; 'own_jobcard' (a real ERP charge on that job card)
--    and 'warranty' are unchanged. The 90 rows are reverted to the value the
--    backfill log recorded before the fill (NULL), logged in tyre_cost_corrections
--    and reversible with tyre_cost_correction_undo().
--
-- ROLLBACK (whole migration):
--   select public.tyre_cost_correction_undo('<batch id printed below>');
--   select public.tyre_replacement_undo(batch_id) for each batch in tyre_replacement_log;
--   restore process_stg_monthly_tyres / tyre_price_backfill / tyre_records_master_process
--   from _bak.fn_defs_20261109 (create or replace with the saved definition text).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Save the current definitions so the previous behaviour can be restored.
-- ---------------------------------------------------------------------
create schema if not exists _bak;
create table if not exists _bak.fn_defs_20261109 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
insert into _bak.fn_defs_20261109 (fn, def)
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('process_stg_monthly_tyres', 'tyre_price_backfill', 'tyre_records_master_process')
on conflict (fn) do nothing;

-- ---------------------------------------------------------------------
-- 1. Preserve a stored factory 0 on update.
-- ---------------------------------------------------------------------
create or replace function public.tyre_records_master_process()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.country is null or trim(new.country) = '' then
    new.country := public.normalize_country(new.region);
  else
    new.country := public.normalize_country(new.country);
  end if;

  if new.qty is null or new.qty < 1 then
    new.qty := 1;
  end if;

  -- NO default cost: keep the actual per-row price; leave blank when the source had none.

  -- A 0 arriving on INSERT is an import blank (unchanged behaviour). On UPDATE a
  -- stored 0 that is not being changed is the owner-approved factory fitment
  -- value and must survive (20261109090000).
  if new.km_at_fitment = 0
     and (tg_op = 'INSERT' or old.km_at_fitment is distinct from 0) then
    new.km_at_fitment := null;
  end if;
  if new.km_at_removal = 0
     and (tg_op = 'INSERT' or old.km_at_removal is distinct from 0) then
    new.km_at_removal := null;
  end if;

  if new.km_at_fitment is not null
  and new.km_at_removal is not null
  and new.km_at_fitment > new.km_at_removal then
    declare tmp numeric;
    begin
      tmp := new.km_at_fitment;
      new.km_at_fitment := new.km_at_removal;
      new.km_at_removal := tmp;
    end;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Replacement log (audit + rollback source).
-- ---------------------------------------------------------------------
create table if not exists public.tyre_replacement_log (
  id            bigserial primary key,
  organisation_id uuid,
  batch_id      uuid not null,
  tyre_id       uuid not null,
  country       text,
  asset_no      text,
  position      text,
  old_serial    text,
  new_serial    text,
  replaced_on   date not null,
  old_values    jsonb not null,
  new_values    jsonb not null,
  source        text not null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  undone_at     timestamptz
);
create index if not exists tyre_replacement_log_batch_idx
  on public.tyre_replacement_log (organisation_id, batch_id);
create index if not exists tyre_replacement_log_tyre_idx
  on public.tyre_replacement_log (tyre_id);

alter table public.tyre_replacement_log enable row level security;
drop policy if exists tyre_replacement_log_org on public.tyre_replacement_log;
create policy tyre_replacement_log_org on public.tyre_replacement_log
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists tyre_replacement_log_read on public.tyre_replacement_log;
create policy tyre_replacement_log_read on public.tyre_replacement_log
  for select to authenticated using ((select public.app_is_elevated()));
revoke all on public.tyre_replacement_log from anon;
revoke insert, update, delete, truncate on public.tyre_replacement_log from authenticated;
grant select on public.tyre_replacement_log to authenticated;

-- ---------------------------------------------------------------------
-- 3. The one rule: close the tyre an incoming fitment replaced.
-- ---------------------------------------------------------------------
create or replace function public._tyre_close_replaced(
  p_org uuid, p_country text, p_asset text, p_position text, p_serial text,
  p_fit_date date, p_fit_km numeric, p_fit_hrs numeric,
  p_source text, p_batch uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_asset  text := nullif(upper(regexp_replace(coalesce(p_asset, ''), '\s+', '', 'g')), '');
  v_pos    text := nullif(upper(btrim(coalesce(p_position, ''))), '');
  v_serial text := nullif(upper(btrim(coalesce(p_serial, ''))), '');
  v_cnt int;
  v_prev public.tyre_records%rowtype;
  v_prev_date date;
  v_later int;
  v_rem_km numeric;
  v_rem_hrs numeric;
  v_total_km numeric;
  v_total_hrs numeric;
  v_new jsonb;
begin
  if p_fit_date is null or v_asset is null or v_pos is null or v_pos = '0' then
    return jsonb_build_object('status', 'not_applicable');
  end if;

  select count(*) into v_cnt
  from public.tyre_records t
  where t.organisation_id is not distinct from p_org
    and coalesce(t.country, '') = coalesce(p_country, '')
    and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
    and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
    and public.tyre_status_is_active(t.status);

  if v_cnt = 0 then return jsonb_build_object('status', 'no_previous'); end if;
  if v_cnt > 1 then return jsonb_build_object('status', 'ambiguous_multiple_active'); end if;

  select t.* into v_prev
  from public.tyre_records t
  where t.organisation_id is not distinct from p_org
    and coalesce(t.country, '') = coalesce(p_country, '')
    and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
    and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
    and public.tyre_status_is_active(t.status)
  for update;

  if v_serial is not null and upper(btrim(coalesce(v_prev.serial_no, ''))) = v_serial then
    return jsonb_build_object('status', 'same_tyre', 'tyre_id', v_prev.id);
  end if;

  v_prev_date := coalesce(v_prev.issue_date, v_prev.fitment_date);
  if v_prev_date is null then
    return jsonb_build_object('status', 'ambiguous_previous_undated', 'tyre_id', v_prev.id);
  end if;
  if v_prev_date >= p_fit_date then
    return jsonb_build_object('status', 'ambiguous_not_later', 'tyre_id', v_prev.id);
  end if;

  -- A later fitment already recorded on this wheel means the incoming row is a
  -- backdated import: closing the active tyre would rewrite history. Review it.
  select count(*) into v_later
  from public.tyre_records t
  where t.organisation_id is not distinct from p_org
    and coalesce(t.country, '') = coalesce(p_country, '')
    and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
    and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
    and t.id <> v_prev.id
    and coalesce(t.issue_date, t.fitment_date) > p_fit_date;
  if v_later > 0 then
    return jsonb_build_object('status', 'ambiguous_backdated', 'tyre_id', v_prev.id);
  end if;

  -- The new tyre's fitting odometer is the old tyre's removal odometer, but only
  -- when it is a real reading (not blank, not the "1" placeholder) and not below
  -- the old fitting reading. Otherwise it stays unknown, never zero.
  if p_fit_km is not null and p_fit_km > 1
     and (v_prev.km_at_fitment is null or p_fit_km >= v_prev.km_at_fitment) then
    v_rem_km := p_fit_km;
  end if;
  if p_fit_hrs is not null and p_fit_hrs > 0
     and (v_prev.hrs_at_fitment is null or p_fit_hrs >= v_prev.hrs_at_fitment) then
    v_rem_hrs := p_fit_hrs;
  end if;
  -- Same km rule as everywhere else (placeholder -> null, over class cap -> null).
  v_total_km := public.tyre_km_life(v_prev.km_at_fitment, v_rem_km, null, v_prev.vehicle_type);
  if v_rem_hrs is not null and v_prev.hrs_at_fitment is not null then
    v_total_hrs := v_rem_hrs - v_prev.hrs_at_fitment;
  end if;

  v_new := jsonb_strip_nulls(jsonb_build_object(
    'removal_date', p_fit_date, 'km_at_removal', v_rem_km, 'hrs_at_removal', v_rem_hrs,
    'total_km', v_total_km, 'total_hrs', v_total_hrs, 'status', 'Removed'));

  if p_dry_run then
    return jsonb_build_object('status', 'would_close', 'tyre_id', v_prev.id,
      'old_serial', v_prev.serial_no, 'removal', v_new);
  end if;

  insert into public.tyre_replacement_log
    (organisation_id, batch_id, tyre_id, country, asset_no, position, old_serial, new_serial,
     replaced_on, old_values, new_values, source)
  values (p_org, p_batch, v_prev.id, v_prev.country, v_prev.asset_no, v_pos, v_prev.serial_no,
     p_serial, p_fit_date,
     jsonb_build_object('removal_date', v_prev.removal_date, 'km_at_removal', v_prev.km_at_removal,
       'hrs_at_removal', v_prev.hrs_at_removal, 'total_km', v_prev.total_km,
       'total_hrs', v_prev.total_hrs, 'status', v_prev.status, 'extra_fields', v_prev.extra_fields),
     v_new, p_source);

  update public.tyre_records t set
    removal_date   = p_fit_date,
    km_at_removal  = coalesce(v_rem_km, t.km_at_removal),
    hrs_at_removal = coalesce(v_rem_hrs, t.hrs_at_removal),
    total_km       = coalesce(t.total_km, v_total_km),
    total_hrs      = coalesce(t.total_hrs, v_total_hrs),
    status         = 'Removed',
    extra_fields   = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object(
                       'replaced_by_serial', p_serial, 'replaced_on', p_fit_date,
                       'replacement_source', p_source, 'replacement_batch', p_batch)
  where t.id = v_prev.id;

  return jsonb_build_object('status', 'closed', 'tyre_id', v_prev.id, 'old_serial', v_prev.serial_no);
end;
$function$;

revoke all on function public._tyre_close_replaced(uuid, text, text, text, text, date, numeric, numeric, text, uuid, boolean) from public;
revoke all on function public._tyre_close_replaced(uuid, text, text, text, text, date, numeric, numeric, text, uuid, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. In-app ERP intake entry point (signed-in, elevated, own org only).
--    p_rows: [{asset_no, tyre_position|position, serial_no, issue_date,
--              km_at_fitment, hrs_at_fitment, removal_date}]
--    Only rows describing a CURRENT fitment (no removal_date) can replace.
-- ---------------------------------------------------------------------
create or replace function public.tyre_import_reconcile(
  p_rows jsonb, p_country text default null, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_org uuid := public.app_current_org();
  v_batch uuid := gen_random_uuid();
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  r jsonb;
  v_res jsonb;
  v_status text;
  v_counts jsonb := '{}'::jsonb;
  v_review jsonb := '[]'::jsonb;
begin
  if v_org is null then raise exception 'No organisation in session' using errcode = '42501'; end if;
  if not public.app_is_elevated() then
    raise exception 'You do not have permission to reconcile tyre replacements' using errcode = '42501';
  end if;
  if v_country is not null and lower(v_country) = 'all' then v_country := null; end if;
  if v_country is null then
    return jsonb_build_object('ok', false, 'reason', 'country_required');
  end if;
  if not public.app_can_see_country(v_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows_must_be_array');
  end if;

  for r in
    select e from jsonb_array_elements(p_rows) e
    where nullif(btrim(coalesce(e->>'removal_date', '')), '') is null
    order by (e->>'issue_date') nulls last
  loop
    begin
      v_res := public._tyre_close_replaced(
        v_org, v_country, r->>'asset_no', coalesce(r->>'tyre_position', r->>'position'),
        r->>'serial_no', nullif(r->>'issue_date', '')::date,
        public._to_num(r->>'km_at_fitment'), public._to_num(r->>'hrs_at_fitment'),
        'erp_intake', v_batch, p_dry_run);
    exception when others then
      v_res := jsonb_build_object('status', 'error', 'message', sqlerrm);
    end;
    v_status := v_res->>'status';
    v_counts := jsonb_set(v_counts, array[v_status],
                  to_jsonb(coalesce((v_counts->>v_status)::int, 0) + 1));
    if v_status like 'ambiguous%' or v_status in ('error', 'same_tyre') then
      if jsonb_array_length(v_review) < 100 then
        v_review := v_review || jsonb_build_array(jsonb_build_object(
          'asset_no', r->>'asset_no', 'position', coalesce(r->>'tyre_position', r->>'position'),
          'serial_no', r->>'serial_no', 'issue_date', r->>'issue_date', 'status', v_status));
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run,
    'batch_id', case when p_dry_run then null else v_batch end,
    'counts', v_counts, 'review', v_review);
end;
$function$;

revoke all on function public.tyre_import_reconcile(jsonb, text, boolean) from public;
revoke all on function public.tyre_import_reconcile(jsonb, text, boolean) from anon;
grant execute on function public.tyre_import_reconcile(jsonb, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Undo one replacement batch. Restores the old values only on rows still
--    exactly as this batch left them, and never re-activates a tyre whose wheel
--    has since received another active tyre (that would double-fit the wheel).
-- ---------------------------------------------------------------------
create or replace function public.tyre_replacement_undo(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_org uuid := public.app_current_org();
  l record;
  v_done int := 0;
  v_skipped int := 0;
begin
  if not (public.is_super_admin() or (v_org is not null and public.app_is_elevated())) then
    raise exception 'You do not have permission to undo tyre replacements' using errcode = '42501';
  end if;
  for l in
    select * from public.tyre_replacement_log
    where batch_id = p_batch and undone_at is null
      and (public.is_super_admin() or organisation_id = v_org)
    order by id desc
  loop
    if exists (
      select 1 from public.tyre_records t
      where t.id <> l.tyre_id
        and t.organisation_id is not distinct from l.organisation_id
        and coalesce(t.country, '') = coalesce(l.country, '')
        and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g'))
            = upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g'))
        and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = l.position
        and public.tyre_status_is_active(t.status))
      or not exists (
      select 1 from public.tyre_records t
      where t.id = l.tyre_id and t.status = 'Removed'
        and t.removal_date is not distinct from l.replaced_on)
    then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update public.tyre_records t set
      removal_date   = (l.old_values->>'removal_date')::date,
      km_at_removal  = (l.old_values->>'km_at_removal')::numeric,
      hrs_at_removal = (l.old_values->>'hrs_at_removal')::numeric,
      total_km       = (l.old_values->>'total_km')::numeric,
      total_hrs      = (l.old_values->>'total_hrs')::numeric,
      status         = l.old_values->>'status',
      extra_fields   = case when l.old_values ? 'extra_fields' and jsonb_typeof(l.old_values->'extra_fields') <> 'null'
                            then l.old_values->'extra_fields' else null end
    where t.id = l.tyre_id;
    update public.tyre_replacement_log set undone_at = now() where id = l.id;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'restored', v_done, 'skipped', v_skipped);
end;
$function$;

revoke all on function public.tyre_replacement_undo(uuid) from public;
revoke all on function public.tyre_replacement_undo(uuid) from anon;
grant execute on function public.tyre_replacement_undo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Staging pipe: close the replaced tyre before inserting a new active one.
--    A new active tyre that cannot be reconciled is NOT inserted (that would
--    double-fit the wheel); its full payload is kept in the audit table with the
--    reason, so nothing is lost.
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_anchor text := E'  insert into public.tyre_records\n    (country, serial_no, asset_no, job_card,';
  v_add text := E'  -- 20261109090000: an incoming CURRENT fitment replaces the tyre on that\n'
    || E'  -- wheel. Close it when the evidence is clear; otherwise hold for review.\n'
    || E'  if rd is null then\n'
    || E'    v_close := public._tyre_close_replaced(\n'
    || E'      coalesce(new.organisation_id, ''00000000-0000-0000-0000-000000000001''::uuid),\n'
    || E'      public.normalize_country(new.country), new.veh_no, new.tyre_position, new.tyre_no,\n'
    || E'      fd, fkm, fhr, ''stg_monthly_tyres'', gen_random_uuid(), false);\n'
    || E'    if coalesce(v_close->>''status'', '''') not in (''closed'', ''no_previous'', ''not_applicable'') then\n'
    || E'      insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload, tyre_record_id)\n'
    || E'      values (new.country, new.organisation_id, ''rejected'',\n'
    || E'              ''replacement_needs_review:'' || coalesce(v_close->>''status'', ''unknown''),\n'
    || E'              v_payload, nullif(v_close->>''tyre_id'', '''')::uuid);\n'
    || E'      return null;\n'
    || E'    end if;\n'
    || E'  end if;\n\n';
begin
  select pg_get_functiondef('public.process_stg_monthly_tyres'::regproc) into v_def;
  if position('_tyre_close_replaced' in v_def) > 0 then return; end if;  -- already applied
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'process_stg_monthly_tyres: insert anchor not found exactly once';
  end if;
  if position('v_close jsonb;' in v_def) = 0 then
    v_def := replace(v_def, E'  v_patch jsonb;\n', E'  v_patch jsonb;\n  v_close jsonb;\n');
  end if;
  if position('v_close jsonb;' in v_def) = 0 then
    raise exception 'process_stg_monthly_tyres: declare anchor not found';
  end if;
  v_def := replace(v_def, v_anchor, v_add || v_anchor);
  execute v_def;
end
$do$;

-- ---------------------------------------------------------------------
-- 7. Price backfill: no estimated second purchase price for a refit.
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  a1 text := E'           t.cost_per_tyre as old_cost\n    from public.tyre_records t';
  r1 text := E'           t.cost_per_tyre as old_cost,\n'
    || E'           -- 20261109090000: this physical tyre is already priced on another\n'
    || E'           -- fitment row, so an estimate here would charge its purchase twice.\n'
    || E'           (coalesce(btrim(t.serial_no), '''') <> '''' and exists (\n'
    || E'              select 1 from public.tyre_records e\n'
    || E'              where e.organisation_id = v_org and e.id <> t.id\n'
    || E'                and e.country is not distinct from t.country\n'
    || E'                and upper(btrim(e.serial_no)) = upper(btrim(t.serial_no))\n'
    || E'                and e.cost_per_tyre > 0)) as refit_of_priced\n'
    || E'    from public.tyre_records t';
  a2 text := E'     or (c.price is not null and c.price > 0);';
  r2 text := E'     or (c.price is not null and c.price > 0 and not n.refit_of_priced);';
  a3 text := E'           else c.price\n';
  a4 text := E'           else ''comparable''\n';
begin
  select pg_get_functiondef('public.tyre_price_backfill'::regproc) into v_def;
  if position('refit_of_priced' in v_def) > 0 then return; end if;  -- already applied
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1
     or (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1
     or (length(v_def) - length(replace(v_def, a4, ''))) / length(a4) <> 1 then
    raise exception 'tyre_price_backfill: anchors not found exactly once';
  end if;
  v_def := replace(v_def, a1, r1);
  v_def := replace(v_def, a2, r2);
  execute v_def;
end
$do$;

-- ---------------------------------------------------------------------
-- 8. Revert the estimated refit prices already written (logged, reversible).
-- ---------------------------------------------------------------------
create table if not exists public.tyre_cost_corrections (
  id          bigserial primary key,
  organisation_id uuid,
  batch_id    uuid not null,
  tyre_id     uuid not null,
  country     text,
  serial_no   text,
  old_cost    numeric,
  new_cost    numeric,
  reason      text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  undone_at   timestamptz
);
create index if not exists tyre_cost_corrections_batch_idx on public.tyre_cost_corrections (batch_id);
alter table public.tyre_cost_corrections enable row level security;
drop policy if exists tyre_cost_corrections_org on public.tyre_cost_corrections;
create policy tyre_cost_corrections_org on public.tyre_cost_corrections
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists tyre_cost_corrections_read on public.tyre_cost_corrections;
create policy tyre_cost_corrections_read on public.tyre_cost_corrections
  for select to authenticated using ((select public.app_is_elevated()));
revoke all on public.tyre_cost_corrections from anon;
revoke insert, update, delete, truncate on public.tyre_cost_corrections from authenticated;
grant select on public.tyre_cost_corrections to authenticated;

create or replace function public.tyre_cost_correction_undo(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can undo a cost correction' using errcode = '42501';
  end if;
  update public.tyre_records t set cost_per_tyre = c.old_cost
  from public.tyre_cost_corrections c
  where c.batch_id = p_batch and c.undone_at is null and t.id = c.tyre_id
    and t.cost_per_tyre is not distinct from c.new_cost;
  get diagnostics v_n = row_count;
  update public.tyre_cost_corrections set undone_at = now()
  where batch_id = p_batch and undone_at is null;
  return jsonb_build_object('ok', true, 'restored', v_n);
end;
$function$;
revoke all on function public.tyre_cost_correction_undo(uuid) from public;
revoke all on function public.tyre_cost_correction_undo(uuid) from anon;
grant execute on function public.tyre_cost_correction_undo(uuid) to authenticated, service_role;

do $do$
declare v_batch uuid := gen_random_uuid(); v_n int;
begin
  if exists (select 1 from public.tyre_cost_corrections
             where reason = 'refit_estimated_purchase_price_removed') then return; end if;  -- already applied
  create temp table _refit_fill on commit drop as
  with fills as (
    select distinct on (l.tyre_id) l.tyre_id, l.old_cost, l.new_cost, l.source
    from public.tyre_price_backfill_log l
    order by l.tyre_id, l.created_at desc
  )
  select t.id, t.organisation_id, t.country, t.serial_no, t.cost_per_tyre, f.old_cost
  from public.tyre_records t
  join fills f on f.tyre_id = t.id
  where f.source = 'comparable'
    and t.cost_per_tyre = f.new_cost
    and coalesce(btrim(t.serial_no), '') <> ''
    and exists (
      select 1 from public.tyre_records e
      where e.organisation_id = t.organisation_id and e.id <> t.id
        and e.country is not distinct from t.country
        and upper(btrim(e.serial_no)) = upper(btrim(t.serial_no))
        and e.cost_per_tyre > 0
        and (coalesce(e.issue_date, e.fitment_date) < coalesce(t.issue_date, t.fitment_date)
             or (coalesce(e.issue_date, e.fitment_date) is not distinct from coalesce(t.issue_date, t.fitment_date)
                 and e.id < t.id)));

  insert into public.tyre_cost_corrections
    (organisation_id, batch_id, tyre_id, country, serial_no, old_cost, new_cost, reason)
  select organisation_id, v_batch, id, country, serial_no, cost_per_tyre, old_cost,
         'refit_estimated_purchase_price_removed'
  from _refit_fill;

  update public.tyre_records t set cost_per_tyre = f.old_cost
  from _refit_fill f where t.id = f.id;
  get diagnostics v_n = row_count;
  raise notice 'tyre_cost_corrections batch % reverted % refit estimates', v_batch, v_n;
end
$do$;
