-- =============================================================================
-- 20261124131000_wms_workshop_job_materials.sql
--
-- STATUS: NOT APPLIED. Authored 2026-11-24. Apply only on the owner's yes, in one
-- transaction, AFTER WP4 (20261124090000) and WP5 (20261124091000). It refuses to
-- run if WP5 is not applied (it patches the WP5 slip function by anchored
-- replacement).
--
-- WHAT IT DOES (workshop <-> warehouse)
--   1. A slip line can consume the job card's reservation.
--      material_issue_lines.reservation_id (chosen by the client, checked by the
--      server). _inv_issue_slip (WP5) is patched by anchored replacement: a line with
--      a reservation must point at an ACTIVE stock_reservations row of the SAME stock
--      line, with source_doc_type 'job_card' and source_doc_id = the slip's job card,
--      and only on an MIS slip. The reservation is passed to _inv_issue, so the issue
--      consumes it (otherwise reserved stock could not be issued: free = on hand
--      minus reserved). A posted line's reservation can no longer change.
--   2. Installation confirmation. New table job_material_installations (one row per
--      confirmation: the issue movement, job card, work order, asset, stock line,
--      item, qty, who, when, optional photo path, optional drawn signature, note).
--      Written ONLY by inv_confirm_installation (SECURITY DEFINER), which re-checks:
--      approved and unlocked user; the movement is an un-reversed 'issue' posted
--      against a job card in the caller's organisation; the movement's country and
--      site are in the caller's scope (_inv_scope_ok); the caller holds stock 'issue'
--      OR work_orders 'edit' OR is elevated; the caller is NOT the person who posted
--      the issue (no self-certification); qty is bounded per job card and stock line
--      by issued - returned - already installed, and per movement by its quantity.
--      Idempotent on (organisation, idempotency_key): the same key with the same
--      movement and qty returns the original row; anything else is refused.
--   3. Returns cannot take back installed parts. A BEFORE INSERT trigger on
--      stock_movements bounds an issue_return / return against a job card by
--      issued - returned - installed (the WP5 bound ignores installations), and
--      refuses the reversal of an issue movement that has confirmed installations.
--      The trigger and the confirmation take the same advisory lock per
--      (organisation, job card, stock line), so they cannot race.
--   4. requisitions.job_card_no (nullable): a shortage requisition names the job
--      card it is for, so the job card screen lists its open purchase demand.
--
-- RECONCILIATION RULE (what the screens show)
--   unreconciled = issued - returned - installed, per job card and stock line.
--   It can never go below zero (both writers are bounded under one lock).
--
-- SECURITY
--   job_material_installations: RLS on; RESTRICTIVE org (all commands), RESTRICTIVE
--   country and site (select); permissive read for active users; NO insert, update or
--   delete grant to anon or authenticated (the table is append-only through the RPC).
--   inv_confirm_installation: revoked from PUBLIC and anon, granted to authenticated.
--   job_material_return_guard(): trigger function, revoked from PUBLIC, anon,
--   authenticated. Identity (installed_by) comes from auth.uid(), never the payload.
--
-- PROOF (rolled back on the live database, 2026-11-24): see RESULT at the bottom of
-- this header and docs/warehouse/11_WORKSHOP_STOCK_DB_CHANGES.md.
--
-- VERIFY (expect: t, t, f, f, t, f, t, t)
--   select to_regclass('public.job_material_installations') is not null,
--          to_regprocedure('public.inv_confirm_installation(jsonb)') is not null,
--          has_function_privilege('anon','public.inv_confirm_installation(jsonb)','EXECUTE'),
--          has_table_privilege('authenticated','public.job_material_installations','INSERT'),
--          has_function_privilege('authenticated','public.inv_confirm_installation(jsonb)','EXECUTE'),
--          has_function_privilege('authenticated','public.job_material_return_guard()','EXECUTE'),
--          exists (select 1 from pg_trigger where tgname = 'trg_zzy_job_material_return_guard'),
--          exists (select 1 from information_schema.columns where table_name = 'requisitions'
--                    and column_name = 'job_card_no');
--
-- UNDO (one transaction)
--   begin;
--   drop trigger if exists trg_zzy_job_material_return_guard on public.stock_movements;
--   drop function if exists public.job_material_return_guard();
--   drop function if exists public.inv_confirm_installation(jsonb);
--   drop table if exists public.job_material_installations;
--   do $u$ declare r record; begin
--     for r in select distinct on (fn) def from _bak.wms_jobmat_fn_backup_20261124 order by fn, id desc loop
--       execute r.def; end loop;
--   end $u$;   -- restores the WP5 _inv_issue_slip and material_issue_line_post_guard bodies (newest copy)
--   alter table public.material_issue_lines drop column if exists reservation_id;
--   alter table public.requisitions drop column if exists job_card_no;
--   commit;
--
-- RESULT (rolled-back proof, 2026-11-24). One transaction: the WP5 slip pieces (B1 slip
-- columns and grants, B2 post guards, B3 _inv_issue_slip / inv_issue_slip, B4 write
-- policies, D4 return bound and return valuation in _inv_post, D6 _inv_issue retry
-- answer) + this file, then a test block ending in raise exception. WP4 and the WP5
-- transfer / D3 / D7 sections were left out of the run to fit one request (they do not
-- touch these objects). Stock line DEMO-Q-002 at DEMO YARD (on hand 10, cost 45), job
-- card DEMO-JC-WS1. Users: Demo Store Keeper B (DEMO YARD, DEMO PLANT), Demo Manager,
-- Demo Store Keeper A narrowed to DEMO OTHER inside the transaction, Demo Reporter.
--    1  B reserves 3 for the job card                     reserved 3
--    2  B raises an MIS slip (line names the reservation) and posts it
--                                                          posted 1; on hand 7; reserved 0; reservation consumed
--    3  same slip posted again                            posted 0, already 1; on hand 7; ONE movement on the key
--    4  slip line naming another job card's reservation   refused 22023
--    5  B (the issuer) confirms installation              refused 42501 (no self-certification)
--    6  Manager confirms 2 installed                      ok, unreconciled 1
--    7  same key, same qty                                replayed
--    8  same key, other qty                               refused 23505
--    9  install 2 more (only 1 left)                      refused 23514
--   10  B returns 2 unused (WP5 alone would allow 3)      refused 23514 "Only 1 ... not confirmed installed"
--   11  B returns 1 unused                                on hand 8; valued at the issued cost 45.0000
--   12  install 1 more after the return                  refused 23514 (issued 3 = installed 2 + returned 1)
--   13  installed total                                   2
--   14  B reverses the installed issue                    refused 42501 (B lacks adjustment_approve; the
--                                                         reversal guard in this file was not reached)
--   15  ledger: start 10 + movements -2 = 8 = balance 8 = last qty_after 8
--   16  Keeper A (DEMO OTHER): reserve / confirm install  refused 42501 / 42501; post slip refused P0002
--   17  Reporter confirms installation                    refused 42501
--   18  Reporter inserts into job_material_installations directly   refused 42501
--   19  B raises a shortage requisition with job_card_no  ok (1 row)
-- Afterwards: no new table, function or column existed; Keeper A's sites and the
-- balance (10 / reserved 0) unchanged. Change made AFTER the run, not re-run: the
-- signature column is signature_image and also accepts a PNG data URL (the web pad
-- produces PNG); the run used an SVG string.
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   Changes here: backup table fn is TEXT and versioned, patches skip when already applied (A14); installation
--   takes the per-key lock before the key lookup (A17, checked: lock precedes the lookup in the body) and re-checks
--   the job card through _inv_job_card_resolve (A10). The slip / installation cases above were not re-run in round 2.
-- ROUND 3 (2026-11-24, same rolled-back full-chain run, every earlier case re-run unchanged; script
-- scratchpad review_round3_proof.sql):
--   item 3: inv_confirm_installation stores and returns the resolver's canonical job card (v_jc) and looks the work
--   order up by it.  R3.6 issue typed 'gckr/jc/1332/0526', installation confirmed by a Manager -> stored
--   GCKR/JC/1332/0526, returned GCKR/JC/1332/0526.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public._inv_issue_slip(jsonb)') is null
     or to_regprocedure('public.material_issue_line_post_guard()') is null then
    raise exception 'Apply WP5 (20261124091000) first: _inv_issue_slip is missing.';
  end if;
end $pre$;

create schema if not exists _bak;
-- Versioned rollback copies (review A14): fn is TEXT (a regprocedure column would break once the function is
-- dropped); one row per apply, written only while the body is still UNPATCHED, so the newest row per function is the
-- body that was live just before the latest real apply. The undo restores the newest row per function.
create table if not exists _bak.wms_jobmat_fn_backup_20261124 (
  id bigserial primary key, fn text not null, def text not null, saved_at timestamptz not null default now()
);
insert into _bak.wms_jobmat_fn_backup_20261124(fn, def)
select f::text, pg_get_functiondef(f)
  from unnest(array['public._inv_issue_slip(jsonb)'::regprocedure,
                    'public.material_issue_line_post_guard()'::regprocedure]) f
 where position('reservation_id' in pg_get_functiondef(f)) = 0;
revoke all on _bak.wms_jobmat_fn_backup_20261124 from public, anon, authenticated;

-- =====================================================================
-- 1. Slip lines can consume the job card's reservation.
-- =====================================================================
alter table public.material_issue_lines
  add column if not exists reservation_id uuid references public.stock_reservations(id);
create index if not exists material_issue_lines_reservation_idx
  on public.material_issue_lines(reservation_id) where reservation_id is not null;
grant insert (reservation_id), update (reservation_id) on public.material_issue_lines to authenticated;

do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_issue_slip(jsonb)'::regprocedure);
  if position('reservation_id' in v_def) > 0 then raise notice '131000: _inv_issue_slip already patched'; return; end if;

  v_old := '    if v_h.doc_type = ''MIS'' then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_issue_slip MIS anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '    if ln.reservation_id is not null then' || chr(10)
    || '      if v_h.doc_type <> ''MIS'' then' || chr(10)
    || '        raise exception ''Line %: a return line cannot name a reservation.'', v_lno using errcode = ''22023'';' || chr(10)
    || '      end if;' || chr(10)
    || '      perform 1 from public.stock_reservations r' || chr(10)
    || '       where r.id = ln.reservation_id and r.organisation_id = v_org and r.stock_id = ln.stock_id' || chr(10)
    || '         and r.status = ''active'' and r.source_doc_type = ''job_card''' || chr(10)
    || '         and upper(btrim(r.source_doc_id)) = upper(btrim(coalesce(v_h.work_order_no, '''')));' || chr(10)
    || '      if not found then' || chr(10)
    || '        raise exception ''Line %: the reservation is not an open reservation of this job card on this stock line.'', v_lno using errcode = ''22023'';' || chr(10)
    || '      end if;' || chr(10)
    || '    end if;' || chr(10) || v_old);

  v_old := '''stock_id'', ln.stock_id, ''qty'', ln.qty, ''reference_no'', v_h.issue_number,';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_issue_slip payload anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    '''stock_id'', ln.stock_id, ''qty'', ln.qty, ''reservation_id'', ln.reservation_id, ''reference_no'', v_h.issue_number,');
  execute v_def;
end $mig$;
revoke all on function public._inv_issue_slip(jsonb) from public, anon, authenticated;

do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public.material_issue_line_post_guard()'::regprocedure);
  if position('reservation_id' in v_def) > 0 then raise notice '131000: post guard already patched'; return; end if;
  v_old := 'or new.doc_type is distinct from old.doc_type or new.item_code is distinct from old.item_code then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'material_issue_line_post_guard anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    'or new.doc_type is distinct from old.doc_type or new.item_code is distinct from old.item_code'
    || ' or new.reservation_id is distinct from old.reservation_id then');
  execute v_def;
end $mig$;
revoke all on function public.material_issue_line_post_guard() from public, anon, authenticated;

-- =====================================================================
-- 2. Installation confirmations.
-- =====================================================================
create table if not exists public.job_material_installations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  country text,
  site text,
  job_card_no text not null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  asset_no text,
  movement_id uuid not null references public.stock_movements(id),
  stock_id uuid not null references public.stock_records(id),
  item_id uuid,
  qty numeric not null check (qty > 0),
  installed_by uuid not null,
  installed_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 400),
  photo_path text check (photo_path is null or (length(photo_path) <= 400 and photo_path !~ '\.\.')),
  signature_image text check (signature_image is null or length(signature_image) <= 200000),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);
create index if not exists job_material_installations_job_idx
  on public.job_material_installations (organisation_id, job_card_no, stock_id);
create index if not exists job_material_installations_movement_idx
  on public.job_material_installations (movement_id);
create index if not exists job_material_installations_asset_idx
  on public.job_material_installations (organisation_id, asset_no);

alter table public.job_material_installations enable row level security;
revoke all on public.job_material_installations from public, anon, authenticated;
grant select on public.job_material_installations to authenticated;

drop policy if exists jmi_org on public.job_material_installations;
create policy jmi_org on public.job_material_installations as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));
drop policy if exists jmi_country on public.job_material_installations;
create policy jmi_country on public.job_material_installations as restrictive for select to authenticated
  using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists jmi_site on public.job_material_installations;
create policy jmi_site on public.job_material_installations as restrictive for select to authenticated
  using (site is null or btrim(site) = '' or (select public.app_sees_all_sites())
         or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])));
drop policy if exists jmi_read on public.job_material_installations;
create policy jmi_read on public.job_material_installations for select to authenticated
  using ((select public.app_is_active()) is true);

-- Shared counter: issued, returned, installed for one job card and stock line.
-- Reversed movements are excluded, exactly as the WP5 return bound does.
create or replace function public._job_material_counts(p_org uuid, p_job_card text, p_stock uuid,
  out issued numeric, out returned numeric, out installed numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select
    coalesce((select sum(case when m.movement_type = 'issue' then -m.qty_change else 0 end)
                from public.stock_movements m
               where m.organisation_id = p_org and m.stock_id = p_stock
                 and m.movement_type = 'issue' and m.source_doc_type = 'job_card' and m.source_doc_id = p_job_card
                 and not exists (select 1 from public.stock_movements x where x.reverses_movement_id = m.id)), 0),
    coalesce((select sum(m.qty_change)
                from public.stock_movements m
               where m.organisation_id = p_org and m.stock_id = p_stock
                 and m.movement_type in ('issue_return', 'return') and m.source_doc_type = 'job_card'
                 and m.source_doc_id = p_job_card
                 and not exists (select 1 from public.stock_movements x where x.reverses_movement_id = m.id)), 0),
    coalesce((select sum(i.qty) from public.job_material_installations i
               where i.organisation_id = p_org and i.stock_id = p_stock and i.job_card_no = p_job_card), 0)
$fn$;
revoke all on function public._job_material_counts(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._job_material_lock(p_org uuid, p_job_card text, p_stock uuid)
returns void language sql volatile security definer set search_path = public, pg_temp as $fn$
  select pg_advisory_xact_lock(hashtextextended(p_org::text || ':jobmat:' || coalesce(p_job_card, '') || ':' || p_stock::text, 0))
$fn$;
revoke all on function public._job_material_lock(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.inv_confirm_installation(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_key text; v_qty numeric; v_mid uuid; v_m public.stock_movements%rowtype;
  v_prev public.job_material_installations%rowtype; v_c record; v_on_move numeric;
  v_wo_id uuid; v_asset text; v_id uuid; v_photo text; v_sig text; v_note text; v_left numeric; v_jc text;
begin
  if v_uid is null or v_org is null or not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'p_payload must be a JSON object.' using errcode = '22023';
  end if;
  v_key := nullif(btrim(p_payload->>'idempotency_key'), '');
  if v_key is null or length(v_key) > 160 then
    raise exception 'An idempotency_key is required.' using errcode = '22023';
  end if;
  begin
    v_qty := (p_payload->>'qty')::numeric;
    v_mid := nullif(btrim(p_payload->>'movement_id'), '')::uuid;
  exception when others then
    raise exception 'movement_id must be an issue id and qty a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'Enter an installed quantity above zero.' using errcode = '22023';
  end if;

  -- (review A17) serialise the same key BEFORE looking it up, so two concurrent retries cannot both insert.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':jmi:' || v_key, 0));
  -- A retry answers from the first confirmation; the same key cannot mean something else.
  select * into v_prev from public.job_material_installations
   where organisation_id = v_org and idempotency_key = v_key;
  if found then
    if v_prev.movement_id is distinct from v_mid or v_prev.qty <> v_qty then
      raise exception 'This idempotency_key was already used for a different confirmation.' using errcode = '23505';
    end if;
    return jsonb_build_object('id', v_prev.id, 'replayed', true, 'job_card_no', v_prev.job_card_no,
      'stock_id', v_prev.stock_id, 'qty', v_prev.qty);
  end if;

  select * into v_m from public.stock_movements where id = v_mid and organisation_id = v_org;
  if v_m.id is null or v_m.movement_type <> 'issue' or v_m.source_doc_type is distinct from 'job_card'
     or nullif(btrim(v_m.source_doc_id), '') is null or v_m.stock_id is null then
    raise exception 'Choose an issue posted against a job card.' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements x where x.reverses_movement_id = v_m.id) then
    raise exception 'That issue was reversed; there is nothing to install from it.' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_m.country, v_m.site) then
    raise exception 'This issue is outside your country or site scope.' using errcode = '42501';
  end if;
  if not (public.inv_can('issue') or public.app_user_can('work_orders', 'edit') or public.app_is_elevated()) then
    raise exception 'Confirming an installation needs the work order edit or stock issue permission.' using errcode = '42501';
  end if;
  if v_m.actor_id = v_uid or (v_m.actor_id is null and v_m.created_by = v_uid) then
    raise exception 'The person who issued the parts cannot confirm their installation.' using errcode = '42501';
  end if;

  perform public._job_material_lock(v_org, v_m.source_doc_id, v_m.stock_id);
  select * into v_c from public._job_material_counts(v_org, v_m.source_doc_id, v_m.stock_id);
  v_left := v_c.issued - v_c.returned - v_c.installed;
  if v_qty > v_left then
    raise exception 'Only % unit(s) issued from this stock line against % are still to account for.',
      greatest(v_left, 0), v_m.source_doc_id using errcode = '23514';
  end if;
  select coalesce(sum(i.qty), 0) into v_on_move from public.job_material_installations i where i.movement_id = v_m.id;
  if v_on_move + v_qty > -v_m.qty_change then
    raise exception 'Only % unit(s) of this issue are not yet confirmed installed.',
      greatest(-v_m.qty_change - v_on_move, 0) using errcode = '23514';
  end if;

  v_photo := nullif(btrim(p_payload->>'photo_path'), '');
  v_sig := nullif(btrim(p_payload->>'signature_image'), '');
  v_note := left(nullif(btrim(p_payload->>'note'), ''), 400);
  if v_photo is not null and (length(v_photo) > 400 or v_photo ~ '\.\.' or v_photo ~ '^[a-z]+:') then
    raise exception 'The photo reference is not a storage path.' using errcode = '22023';
  end if;
  if v_sig is not null and (length(v_sig) > 200000
       or not (v_sig ~* '^<svg' or v_sig ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')) then
    raise exception 'The signature must be a drawn signature image.' using errcode = '22023';
  end if;

  -- (review A10) the job card must still be a real one of this company in the caller's scope (canonical number)
  v_jc := public._inv_job_card_resolve(v_org, v_m.source_doc_id, v_m.country);   -- (round 3, item 3) canonical
  select w.id, w.asset_no into v_wo_id, v_asset from public.work_orders w
   where w.organisation_id = v_org and w.work_order_no = v_jc
   order by w.id limit 1;

  insert into public.job_material_installations(organisation_id, country, site, job_card_no, work_order_id, asset_no,
    movement_id, stock_id, item_id, qty, installed_by, note, photo_path, signature_image, idempotency_key)
  values (v_org, v_m.country, v_m.site, v_jc, v_wo_id, v_asset,
    v_m.id, v_m.stock_id, v_m.item_id, v_qty, v_uid, v_note, v_photo, v_sig, v_key)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'replayed', false, 'job_card_no', v_jc,
    'stock_id', v_m.stock_id, 'qty', v_qty, 'unreconciled', v_left - v_qty);
end $fn$;
revoke all on function public.inv_confirm_installation(jsonb) from public;
revoke all on function public.inv_confirm_installation(jsonb) from anon;
grant execute on function public.inv_confirm_installation(jsonb) to authenticated, service_role;

-- =====================================================================
-- 3. A return cannot take back installed parts; an issue with installations
--    cannot be reversed.
-- =====================================================================
create or replace function public.job_material_return_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_c record; v_left numeric;
begin
  if new.reverses_movement_id is not null
     and exists (select 1 from public.job_material_installations i where i.movement_id = new.reverses_movement_id) then
    raise exception 'Parts from that issue are confirmed installed, so it cannot be reversed. Return the unused quantity instead.'
      using errcode = '23514';
  end if;
  if new.movement_type in ('issue_return', 'return') and new.source_doc_type = 'job_card'
     and new.stock_id is not null and coalesce(new.qty_change, 0) > 0 and new.reverses_movement_id is null then
    perform public._job_material_lock(new.organisation_id, new.source_doc_id, new.stock_id);
    select * into v_c from public._job_material_counts(new.organisation_id, new.source_doc_id, new.stock_id);
    if v_c.installed > 0 then
      v_left := v_c.issued - v_c.returned - v_c.installed;
      if new.qty_change > v_left then
        raise exception 'Only % unit(s) issued against % are not confirmed installed; a return cannot exceed that.',
          greatest(v_left, 0), new.source_doc_id using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $fn$;
revoke all on function public.job_material_return_guard() from public, anon, authenticated;
drop trigger if exists trg_zzy_job_material_return_guard on public.stock_movements;
create trigger trg_zzy_job_material_return_guard
  before insert on public.stock_movements
  for each row execute function public.job_material_return_guard();

-- =====================================================================
-- 4. A shortage requisition names its job card.
-- =====================================================================
alter table public.requisitions
  add column if not exists job_card_no text check (job_card_no is null or length(btrim(job_card_no)) between 1 and 80);
create index if not exists requisitions_job_card_idx
  on public.requisitions (organisation_id, job_card_no) where job_card_no is not null;
comment on column public.requisitions.job_card_no is 'Job card this requisition covers a stock shortage for (workshop demand).';

commit;
