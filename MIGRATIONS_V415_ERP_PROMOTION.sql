-- ============================================================================
-- V415 - ERP IMPORT PROMOTION (the missing step behind /erp-import)
-- ============================================================================
-- The /erp-import page stages uploads into three REVIEW tables
--   erp_asset_import / erp_tyre_change_import / erp_tyre_expense_import
-- but there was NO code, trigger or RPC that moved those staged rows into the
-- master tables (vehicle_fleet / tyre_records / parts_consumption). They were the
-- only staging family in the schema with no pipe, so asset/tyre/cost uploads on
-- that page could never reach the system.
--
-- This migration builds that promotion as a set of SECURITY DEFINER RPCs:
--   * promote_erp_assets(p_batch, p_dry_run)         -> vehicle_fleet
--   * promote_erp_tyre_changes(p_batch, p_dry_run)   -> tyre_records
--   * promote_erp_tyre_expense(p_batch, p_dry_run)   -> parts_consumption
--   * promote_erp_undo(p_dataset, p_batch)           -> reverse a promoted batch
--   * erp_batch_promotion_status(p_dataset, p_batch) -> per-batch status
--
-- Guarantees:
--   * IDEMPOTENT - re-running a promotion inserts nothing new (candidate rows are
--     the staging rows that carry no promotion-log entry yet, AND master-level
--     dedupe on the natural key / import_uid is a second backstop).
--   * DRY RUN by default (p_dry_run default true) - reports the exact per-country
--     / per-bucket counts and money that WOULD move, and writes nothing.
--   * SNAPSHOTTED + REVERSIBLE - every inserted master id is recorded in
--     erp_promote_bak.promotion_log; promote_erp_undo deletes exactly those rows
--     (never rows it did not create) and clears the staging promoted flag.
--   * Elevated-only (super-admin or Admin/Manager/Director), org-scoped, pinned
--     search_path.
-- ============================================================================

-- ── 1. staging: promotion flag columns (idempotent) ─────────────────────────
alter table public.erp_asset_import        add column if not exists promoted_at timestamptz;
alter table public.erp_asset_import        add column if not exists promoted_by uuid;
alter table public.erp_tyre_change_import   add column if not exists promoted_at timestamptz;
alter table public.erp_tyre_change_import   add column if not exists promoted_by uuid;
alter table public.erp_tyre_expense_import  add column if not exists promoted_at timestamptz;
alter table public.erp_tyre_expense_import  add column if not exists promoted_by uuid;

-- ── 2. snapshot / undo ledger ───────────────────────────────────────────────
-- One row per master row this promotion created (action='insert') or found
-- already present (action='exists'). action='insert' rows are what undo removes.
create schema if not exists erp_promote_bak;
revoke all on schema erp_promote_bak from anon, authenticated;

create table if not exists erp_promote_bak.promotion_log (
  id                uuid primary key default gen_random_uuid(),
  dataset           text not null,             -- 'asset' | 'change' | 'expense'
  batch_id          uuid not null,
  organisation_id   uuid not null,
  master_table      text not null,
  master_id         uuid,                      -- null for action='exists' when unknown
  source_staging_id uuid not null,
  action            text not null,             -- 'insert' | 'exists'
  detail            jsonb,
  promoted_at       timestamptz not null default now(),
  promoted_by       uuid default auth.uid()
);
create index if not exists promotion_log_batch_idx
  on erp_promote_bak.promotion_log (dataset, batch_id);
create unique index if not exists promotion_log_staging_uidx
  on erp_promote_bak.promotion_log (source_staging_id);
revoke all on erp_promote_bak.promotion_log from anon, authenticated;

-- ── 3. prefix -> country helper ─────────────────────────────────────────────
-- Job-card / asset prefixes: AFKR & GCKR = KSA, RM = UAE, EG = Egypt.
create or replace function public._erp_country_from_prefix(p_code text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_code is null or btrim(p_code) = '' then null
    when upper(btrim(p_code)) like 'AFKR%' then 'KSA'
    when upper(btrim(p_code)) like 'GCKR%' then 'KSA'
    when upper(btrim(p_code)) like 'RM%'   then 'UAE'
    when upper(btrim(p_code)) like 'EG%'   then 'Egypt'
    else null
  end;
$$;

-- ── 4. shared guard ─────────────────────────────────────────────────────────
create or replace function public._erp_promote_guard()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_org uuid;
begin
  if not (public.is_super_admin() or public.app_is_elevated()) then
    raise exception 'Only an Admin, Manager, Director or super admin can promote imports.'
      using errcode = '42501';
  end if;
  v_org := public.app_current_org();
  if v_org is null then
    raise exception 'No active organisation in this session.' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- ── 5. promote assets -> vehicle_fleet ──────────────────────────────────────
-- INSERT MISSING ONLY (dedupe on org+country+asset_no). Never overwrites an
-- existing vehicle (a re-key or a null-backfill of a live row is deliberately
-- out of scope so undo stays trivially clean and no good data is ever touched).
create or replace function public.promote_erp_assets(
  p_batch uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org       uuid := public._erp_promote_guard();
  r           record;
  v_country   text;
  v_asset     text;
  v_exists    boolean;
  v_new_id    uuid;
  v_ins       jsonb := '{}'::jsonb;   -- country -> to_insert count
  v_exist     jsonb := '{}'::jsonb;   -- country -> already-present count
  v_skip      int := 0;               -- no asset_no
  v_ins_tot   int := 0;
begin
  for r in
    select s.* from public.erp_asset_import s
    where s.batch_id = p_batch
      and s.organisation_id = v_org
      and not exists (select 1 from erp_promote_bak.promotion_log l
                      where l.source_staging_id = s.id)
    order by s.source_row
  loop
    v_asset := nullif(upper(btrim(coalesce(r.asset_no, ''))), '');
    if v_asset is null then v_skip := v_skip + 1; continue; end if;

    v_country := coalesce(
      public.normalize_country(r.country),
      public._erp_country_from_prefix(v_asset),
      'KSA');

    select exists (
      select 1 from public.vehicle_fleet f
      where f.organisation_id = v_org
        and coalesce(f.country, '') = coalesce(v_country, '')
        and upper(btrim(f.asset_no)) = v_asset
    ) into v_exists;

    if v_exists then
      v_exist := jsonb_set(v_exist, array[v_country],
                   to_jsonb(coalesce((v_exist->>v_country)::int, 0) + 1), true);
      if not p_dry_run then
        insert into erp_promote_bak.promotion_log
          (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
          values ('asset', p_batch, v_org, 'vehicle_fleet', null, r.id, 'exists');
        update public.erp_asset_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
      end if;
      continue;
    end if;

    v_ins := jsonb_set(v_ins, array[v_country],
               to_jsonb(coalesce((v_ins->>v_country)::int, 0) + 1), true);
    v_ins_tot := v_ins_tot + 1;

    if not p_dry_run then
      insert into public.vehicle_fleet (
        organisation_id, asset_no, country, region, site, make, vehicle_type,
        model_year, current_km, current_hours, status,
        operator_name, insurance_type, insurance_name, insurance_start, insurance_expiry,
        operating_card_no, operating_card_issue, operating_card_expiry,
        driver_licence_issue, driver_licence_expiry, purchase_value, net_book_value,
        monthly_depreciation, operation_start_date, fa_asset_number, asset_remarks,
        registration_no, asset_extra
      ) values (
        v_org, v_asset, v_country, v_country, r.site, r.make, r.asset_type,
        r.model_year, r.current_km, r.hour_meter,
        case when r.status ~* 'inactive|retire|dispos' then 'Inactive' else 'Active' end,
        r.operator, r.insurance_type, r.insurance_name, r.insurance_start, r.insurance_end,
        r.operating_card_no, r.card_issue_date, r.card_expiry_date,
        r.licence_issue, r.licence_expiry, r.purchase_value, r.net_book_value,
        r.monthly_dep, r.opr_start_date, r.finance_asset_no, r.remarks,
        r.plate_no,
        jsonb_strip_nulls(jsonb_build_object(
          'import','erp_asset','erp_batch',p_batch::text,'source_row',r.source_row,
          'capacity',r.capacity,'shift',r.shift,'second_user',r.second_user,
          'age_of_asset',r.age_of_asset,'org_ou',r.org_ou))
      )
      returning id into v_new_id;

      insert into erp_promote_bak.promotion_log
        (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
        values ('asset', p_batch, v_org, 'vehicle_fleet', v_new_id, r.id, 'insert');
      update public.erp_asset_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
    end if;
  end loop;

  return jsonb_build_object(
    'dataset','asset', 'batch_id', p_batch, 'dry_run', p_dry_run,
    'to_insert_total', v_ins_tot,
    'to_insert_by_country', v_ins,
    'already_present_by_country', v_exist,
    'skipped_no_asset_no', v_skip
  );
end;
$$;

-- ── 6. promote tyre changes -> tyre_records ─────────────────────────────────
-- Active/old rule: within (asset_no, tire_pos), the latest fix_date is the
-- current tyre. Dedupe on the fitment key (serial + asset + position + fix_date).
-- status = Active only for the current fitment that has no removal date and no
-- pre-existing active tyre on that asset+position; everything else is Removed
-- history. The fitment guard is a final backstop: on a 23505 the row is inserted
-- as Removed instead so nothing is lost.
create or replace function public.promote_erp_tyre_changes(
  p_batch uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r           record;
  v_org       uuid := public._erp_promote_guard();
  v_country   text;
  v_asset     text;
  v_pos       text;
  v_status    text;
  v_removal   date;
  v_exists    boolean;
  v_active_conflict boolean;
  v_new_id    uuid;
  v_ins_active int := 0;
  v_ins_old    int := 0;
  v_existing   int := 0;
  v_skip_key   int := 0;
  v_conflicts  int := 0;
  v_by_country jsonb := '{}'::jsonb;
begin
  for r in
    with cand as (
      select s.*,
        nullif(lower(btrim(coalesce(s.asset_no,''))),'') as g_asset,
        nullif(lower(btrim(coalesce(s.tire_pos,''))),'') as g_pos
      from public.erp_tyre_change_import s
      where s.batch_id = p_batch
        and s.organisation_id = v_org
        and not exists (select 1 from erp_promote_bak.promotion_log l
                        where l.source_staging_id = s.id)
    )
    select c.*,
      row_number() over (
        partition by c.g_asset, c.g_pos
        order by (c.fix_date is null) desc, c.fix_date asc, c.source_row asc
      ) as rn,
      count(*) over (partition by c.g_asset, c.g_pos) as grp_n
    from cand c
    order by c.source_row
  loop
    -- Need a fitment key: serial + asset.
    if nullif(btrim(coalesce(r.serial_no,'')),'') is null
       or nullif(btrim(coalesce(r.asset_no,'')),'') is null then
      v_skip_key := v_skip_key + 1; continue;
    end if;

    v_asset := upper(btrim(r.asset_no));
    v_pos   := nullif(upper(btrim(coalesce(r.tire_pos,''))),'');
    v_country := coalesce(
      public.normalize_country(r.country),
      public._erp_country_from_prefix(coalesce(v_asset, r.job_card)),
      'KSA');

    -- Fitment-key dedupe (case-insensitive serial + asset + position + issue date).
    select exists (
      select 1 from public.tyre_records t
      where t.organisation_id = v_org
        and coalesce(t.country,'') = coalesce(v_country,'')
        and lower(btrim(coalesce(t.serial_no,''))) = lower(btrim(r.serial_no))
        and upper(btrim(coalesce(t.asset_no, t.asset_number,''))) = v_asset
        and coalesce(nullif(upper(btrim(coalesce(t.tyre_position, t.position,''))),''),'') = coalesce(v_pos,'')
        and t.issue_date is not distinct from r.fix_date
    ) into v_exists;

    if v_exists then
      v_existing := v_existing + 1;
      if not p_dry_run then
        insert into erp_promote_bak.promotion_log
          (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
          values ('change', p_batch, v_org, 'tyre_records', null, r.id, 'exists');
        update public.erp_tyre_change_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
      end if;
      continue;
    end if;

    -- guard fix <= remove: only keep a removal date that is on/after the fitment.
    v_removal := case
      when r.remove_date is null then null
      when r.fix_date is null then r.remove_date
      when r.remove_date >= r.fix_date then r.remove_date
      else null
    end;

    -- Is there already an active tyre on this asset+position in the master?
    v_active_conflict := false;
    if v_pos is not null and v_pos <> '0' then
      select exists (
        select 1 from public.tyre_records t
        where t.organisation_id = v_org
          and coalesce(t.country,'') = coalesce(v_country,'')
          and upper(btrim(coalesce(t.asset_no, t.asset_number,''))) = v_asset
          and coalesce(nullif(upper(btrim(coalesce(t.tyre_position, t.position,''))),''),'') = v_pos
          and public.tyre_status_is_active(t.status)
      ) into v_active_conflict;
    end if;

    v_status := case
      when r.rn = r.grp_n and v_removal is null and not v_active_conflict then 'Active'
      else 'Removed'
    end;

    if v_status = 'Active' then v_ins_active := v_ins_active + 1;
    else v_ins_old := v_ins_old + 1; end if;
    if v_active_conflict and v_removal is null and r.rn = r.grp_n then
      v_conflicts := v_conflicts + 1;
    end if;

    v_by_country := jsonb_set(v_by_country, array[v_country],
      to_jsonb(coalesce((v_by_country->>v_country)::int,0) + 1), true);

    if not p_dry_run then
      begin
        insert into public.tyre_records (
          organisation_id, country, region, serial_no, asset_no, tyre_position, position,
          brand, size, job_card, site, issue_date, removal_date,
          km_at_fitment, km_at_removal, hrs_at_fitment, hrs_at_removal, total_km,
          status, data_source, upload_batch_id, qty, extra_fields
        ) values (
          v_org, v_country, v_country, r.serial_no, v_asset, r.tire_pos, r.tire_pos,
          r.tyre_brand, r.tyre_size, r.job_card, r.site, r.fix_date, v_removal,
          r.fix_km, r.remove_km, r.fix_hour, r.remove_hour, r.total_km,
          v_status, 'upload', p_batch, 1,
          jsonb_strip_nulls(jsonb_build_object(
            'import','erp_tyre_change','erp_batch',p_batch::text,'source_row',r.source_row,
            'old_serial_no',r.old_serial_no,'old_tyre_brand',r.old_tyre_brand,'version',r.version))
        )
        returning id into v_new_id;
      exception when unique_violation then
        -- fitment guard: an active tyre already holds this asset+position. Land
        -- the row as removed history rather than aborting the whole batch.
        insert into public.tyre_records (
          organisation_id, country, region, serial_no, asset_no, tyre_position, position,
          brand, size, job_card, site, issue_date, removal_date,
          km_at_fitment, km_at_removal, hrs_at_fitment, hrs_at_removal, total_km,
          status, data_source, upload_batch_id, qty, extra_fields
        ) values (
          v_org, v_country, v_country, r.serial_no, v_asset, r.tire_pos, r.tire_pos,
          r.tyre_brand, r.tyre_size, r.job_card, r.site, r.fix_date, v_removal,
          r.fix_km, r.remove_km, r.fix_hour, r.remove_hour, r.total_km,
          'Removed', 'upload', p_batch, 1,
          jsonb_strip_nulls(jsonb_build_object(
            'import','erp_tyre_change','erp_batch',p_batch::text,'source_row',r.source_row,
            'old_serial_no',r.old_serial_no,'old_tyre_brand',r.old_tyre_brand,'version',r.version,
            'downgraded','active fitment already present'))
        )
        returning id into v_new_id;
        v_conflicts := v_conflicts + 1;
      end;

      insert into erp_promote_bak.promotion_log
        (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
        values ('change', p_batch, v_org, 'tyre_records', v_new_id, r.id, 'insert');
      update public.erp_tyre_change_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
    end if;
  end loop;

  return jsonb_build_object(
    'dataset','change', 'batch_id', p_batch, 'dry_run', p_dry_run,
    'to_insert_active', v_ins_active,
    'to_insert_old', v_ins_old,
    'to_insert_total', v_ins_active + v_ins_old,
    'to_insert_by_country', v_by_country,
    'already_present', v_existing,
    'skipped_no_key', v_skip_key,
    'active_position_conflicts', v_conflicts
  );
end;
$$;

-- ── 7. promote tyre expense -> parts_consumption ────────────────────────────
-- Each staged purchase becomes one parts_consumption line whose description
-- carries the tyre brand/size + the word TYRE, so the classify trigger buckets
-- it as a tyre cost and fills currency. import_uid is computed the same way
-- parts_import_uid does (with a stable per-row fallback so it is never null),
-- and ON CONFLICT DO NOTHING makes a re-promote idempotent.
create or replace function public.promote_erp_tyre_expense(
  p_batch uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r           record;
  v_org       uuid := public._erp_promote_guard();
  v_country   text;
  v_asset     text;
  v_qty       numeric;
  v_value     numeric;
  v_desc      text;
  v_code      text;
  v_uid       text;
  v_new_id    uuid;
  v_ins_tot   int := 0;
  v_existing  int := 0;
  v_skip      int := 0;
  v_by_country jsonb := '{}'::jsonb;   -- country -> {count, value, currency}
begin
  for r in
    select s.* from public.erp_tyre_expense_import s
    where s.batch_id = p_batch
      and s.organisation_id = v_org
      and not exists (select 1 from erp_promote_bak.promotion_log l
                      where l.source_staging_id = s.id)
    order by s.source_row
  loop
    v_qty := coalesce(r.quantity, 1);
    if v_qty is null or v_qty <= 0 then v_qty := 1; end if;
    v_value := case when r.unit_cost is null then null else round(r.unit_cost * v_qty, 4) end;

    -- A cost line with no cost is not promotable.
    if v_value is null or v_value = 0 then v_skip := v_skip + 1; continue; end if;

    v_asset := nullif(upper(btrim(coalesce(r.asset_no,''))),'');
    v_country := coalesce(
      public.normalize_country(r.country),
      public._erp_country_from_prefix(coalesce(v_asset, r.job_card)),
      'KSA');

    v_desc := nullif(btrim(concat_ws(' ', r.tyre_brand, r.tyre_size, 'TYRE')), '');
    if v_desc is null then v_desc := 'TYRE PURCHASE'; end if;
    v_code := coalesce(nullif(btrim(r.po_no),''), nullif(btrim(r.invoice_no),''),
                       'TYRE-' || coalesce(nullif(btrim(r.serial_no),''), r.source_row::text));

    v_uid := coalesce(
      public.parts_import_uid(
        v_country, r.source_row::text, coalesce(r.invoice_no,''), coalesce(r.job_card,''),
        v_code, v_desc, v_qty::text, v_value::text,
        coalesce(r.purchase_date::text,''), coalesce(v_asset,''), null, null),
      md5('erp_tyre_expense|' || r.id::text));

    -- dedupe preview: already in parts_consumption under this uid?
    if p_dry_run then
      if exists (select 1 from public.parts_consumption p
                 where p.organisation_id = v_org and p.import_uid = v_uid) then
        v_existing := v_existing + 1;
        continue;
      end if;
    end if;

    if not p_dry_run then
      insert into public.parts_consumption (
        organisation_id, country, txn_date, event_date, work_order_no, asset_code,
        item_code, item_description, qty, value_amount, unit_cost, currency,
        supplier, source_row, import_uid, source_system, store_code, cost_center
      ) values (
        v_org, v_country, r.purchase_date::text, r.purchase_date, r.job_card, v_asset,
        v_code, v_desc, v_qty::text, v_value::text, r.unit_cost, r.currency,
        r.supplier, r.source_row::text, v_uid, 'ERP tyre expense import', null, null
      )
      on conflict (organisation_id, import_uid) where import_uid is not null
      do nothing
      returning id into v_new_id;

      if v_new_id is null then
        v_existing := v_existing + 1;
        insert into erp_promote_bak.promotion_log
          (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
          values ('expense', p_batch, v_org, 'parts_consumption', null, r.id, 'exists');
        update public.erp_tyre_expense_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
        continue;
      end if;

      insert into erp_promote_bak.promotion_log
        (dataset, batch_id, organisation_id, master_table, master_id, source_staging_id, action)
        values ('expense', p_batch, v_org, 'parts_consumption', v_new_id, r.id, 'insert');
      update public.erp_tyre_expense_import set promoted_at = now(), promoted_by = auth.uid() where id = r.id;
    end if;

    v_ins_tot := v_ins_tot + 1;
    v_by_country := jsonb_set(v_by_country, array[v_country], jsonb_build_object(
      'count',    coalesce((v_by_country#>>array[v_country,'count'])::int,0) + 1,
      'value',    round(coalesce((v_by_country#>>array[v_country,'value'])::numeric,0) + v_value, 2),
      'currency', coalesce(r.currency, public.currency_for_country(v_country))
    ), true);
  end loop;

  return jsonb_build_object(
    'dataset','expense', 'batch_id', p_batch, 'dry_run', p_dry_run,
    'to_insert_total', v_ins_tot,
    'by_country', v_by_country,
    'already_present', v_existing,
    'skipped_no_cost', v_skip
  );
end;
$$;

-- ── 8. undo a promoted batch ────────────────────────────────────────────────
-- Deletes exactly the master rows THIS process inserted (action='insert'),
-- clears the staging promoted flag, and drops the log rows so the batch can be
-- promoted again cleanly. Never touches rows it did not create.
create or replace function public.promote_erp_undo(
  p_dataset text,
  p_batch uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid := public._erp_promote_guard();
  v_deleted int := 0;
  v_staging text := case p_dataset
                      when 'asset' then 'erp_asset_import'
                      when 'change' then 'erp_tyre_change_import'
                      when 'expense' then 'erp_tyre_expense_import'
                      else null end;
begin
  if v_staging is null then
    raise exception 'Unknown dataset %', p_dataset using errcode = '22023';
  end if;

  if p_dataset = 'asset' then
    delete from public.vehicle_fleet f
    using erp_promote_bak.promotion_log l
    where l.dataset='asset' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='vehicle_fleet' and f.id=l.master_id;
    get diagnostics v_deleted = row_count;
  elsif p_dataset = 'change' then
    delete from public.tyre_records t
    using erp_promote_bak.promotion_log l
    where l.dataset='change' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='tyre_records' and t.id=l.master_id;
    get diagnostics v_deleted = row_count;
  elsif p_dataset = 'expense' then
    delete from public.parts_consumption p
    using erp_promote_bak.promotion_log l
    where l.dataset='expense' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='parts_consumption' and p.id=l.master_id;
    get diagnostics v_deleted = row_count;
  end if;

  -- Clear the staging promoted flag for every logged row of this batch.
  execute format(
    'update public.%I s set promoted_at=null, promoted_by=null
       from erp_promote_bak.promotion_log l
      where l.dataset=$1 and l.batch_id=$2 and l.organisation_id=$3
        and l.source_staging_id = s.id', v_staging)
    using p_dataset, p_batch, v_org;

  delete from erp_promote_bak.promotion_log l
   where l.dataset=p_dataset and l.batch_id=p_batch and l.organisation_id=v_org;

  return jsonb_build_object('dataset', p_dataset, 'batch_id', p_batch, 'deleted', v_deleted);
end;
$$;

-- ── 9. per-batch promotion status (for the review grid) ─────────────────────
create or replace function public.erp_batch_promotion_status(
  p_dataset text,
  p_batch uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('inserted',0,'existing',0,'promoted',false); end if;
  return (
    select jsonb_build_object(
      'inserted',  coalesce(sum((action='insert')::int),0),
      'existing',  coalesce(sum((action='exists')::int),0),
      'total',     count(*),
      'promoted',  count(*) > 0,
      'promoted_at', max(promoted_at)
    )
    from erp_promote_bak.promotion_log
    where dataset=p_dataset and batch_id=p_batch and organisation_id=v_org
  );
end;
$$;

-- ── 10. grants ──────────────────────────────────────────────────────────────
revoke all on function public.promote_erp_assets(uuid, boolean)        from public, anon;
revoke all on function public.promote_erp_tyre_changes(uuid, boolean)  from public, anon;
revoke all on function public.promote_erp_tyre_expense(uuid, boolean)  from public, anon;
revoke all on function public.promote_erp_undo(text, uuid)             from public, anon;
revoke all on function public.erp_batch_promotion_status(text, uuid)   from public, anon;
revoke all on function public._erp_promote_guard()                     from public, anon;
grant execute on function public.promote_erp_assets(uuid, boolean)       to authenticated;
grant execute on function public.promote_erp_tyre_changes(uuid, boolean) to authenticated;
grant execute on function public.promote_erp_tyre_expense(uuid, boolean) to authenticated;
grant execute on function public.promote_erp_undo(text, uuid)            to authenticated;
grant execute on function public.erp_batch_promotion_status(text, uuid)  to authenticated;
