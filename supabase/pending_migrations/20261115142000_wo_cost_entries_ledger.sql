-- WO-5: work order cost ledger (additional costs, adjustments and refunds as append-only entries).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15. Applied only to a private copy of the local
--         staging database (tp_wo3, synthetic companies) by
--         supabase/tests/staging_work_order_permissions.sh. NEEDS THE OWNER'S YES.
--
-- DEPENDS ON: 20261115140000 (resolver: actions cost and cost_approve) and 20261115140500 (the
--   guard that keeps work_orders.parts_cost as imported). Apply after 20261115141500.
--
-- OWNER DECISION (2026-11-15, round 4)
--   A genuine extra part increases the job card total (imported 1,775.82 + verified 20.00 =
--   1,795.82), but the imported figure is never replaced, an unapproved cost is never approved
--   spend, and the same part must not be counted twice.
--
-- WHAT WAS FOUND ON PRODUCTION (read only, counts)
--   7,099 work orders carry parts_cost > 0 with no parts lines typed in the app; 0 carry lines.
--   So the stored parts_cost is, in practice, always the ERP figure. The ERP's line detail is
--   parts_consumption (job card number + item code + line cost).
--
-- THE MODEL
--   work_orders.parts_cost (and the other stored cost columns)   IMPORTED BASELINE. Not written by
--       the form any more; only an Admin can correct it (20261115140500).
--   work_order_cost_entries                                      one row per added cost:
--       entry_kind  additional | adjustment | refund
--       status      draft -> pending_approval | pending_reconciliation -> approved | rejected
--                   approved -> reversed
--       who (created_by, decided_by, reversed_by), when, why (reason), source, source_ref,
--       currency, amount, reconciliation result.
--   v_work_order_cost_totals                                     the four figures, per work order:
--       imported_total, additional_approved, adjustments_approved, refunds_approved,
--       calculated_total = imported + approved additional + approved adjustments - approved refunds
--       and, separately, unapproved_amount / unapproved_count (NOT part of any total).
--
--   Duplicate protection. When an entry is added and again when it is submitted, the database
--   checks the ERP line detail of that job card (parts_consumption, same company, same job card
--   number):
--       not_in_import       the job card has line detail that accounts for its stored parts cost
--                           and this item code is not in it, or the work order has no imported cost
--       possible_duplicate  the item code IS in the ERP lines of this job card
--       cannot_tell         the imported cost has no line detail (or the entry has no item code)
--   Only not_in_import goes straight to pending_approval. The other two wait in
--   pending_reconciliation: an approver has to write how it was checked before approving. Nothing
--   is guessed.
--
--   Who. Entering a draft needs the cost right on that work order (Tyre Data Collector: assigned
--   work only). Approving, rejecting and reversing need cost_approve. Nobody decides an entry they
--   entered themselves. None of these rights can come from the generic Access Control switches.
--   Money: the entry's currency is the work order country's currency (currency_for_country); a
--   work order with no country cannot take an entry. Nothing is converted or blended.
--
--   Reports. The governed cost totals (expense grid, src/lib/api/costSummary.js) do not read this
--   table, so an added cost cannot be counted twice there. v_work_order_cost_totals is the only
--   place the calculated total is formed, and it counts APPROVED entries only.
--
-- APPEND ONLY. No row is ever removed (the trigger refuses a signed-in user's removal and the role
--   has no such grant). Amount, currency, kind, work order and author never change after insert.
--   The words "delete" and "drop" appear in this file only in this header and in the guard that
--   refuses a removal.
--
-- STORED ROWS CHANGED: none. No work order, cost or approval is rewritten.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select count(*) from pg_policies where tablename = 'work_order_cost_entries';            -- 4
--   select has_table_privilege('authenticated', 'public.work_order_cost_entries', 'INSERT'); -- f
--   select has_function_privilege('anon', 'public.work_order_cost_add(uuid,text,text,text,text,numeric,numeric,numeric,text,text,text,uuid,uuid)', 'EXECUTE'); -- f
--   rollback;
--
-- ROLLBACK
--   The table, view and functions are additive. To switch the feature off without removing
--   anything: revoke execute on the five work_order_cost_* functions from authenticated. The web
--   form then says adding costs is not available. Removing the objects is left to a person.

begin;

create table if not exists public.work_order_cost_entries (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id),
  country             text,
  site                text,
  work_order_id       uuid not null references public.work_orders(id),
  entry_kind          text not null default 'additional',
  category            text not null default 'parts',
  item_code           text,
  description         text not null,
  quantity            numeric,
  unit_cost           numeric,
  amount              numeric not null,
  currency            text not null,
  source              text not null,
  source_ref          text,
  reason              text not null,
  status              text not null default 'draft',
  reconciliation      text not null default 'cannot_tell',
  reconciliation_note text,
  reverses_entry_id   uuid references public.work_order_cost_entries(id),
  client_uuid         uuid,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  submitted_by        uuid,
  submitted_at        timestamptz,
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  reversed_by         uuid,
  reversed_at         timestamptz,
  reversal_reason     text,
  constraint wo_cost_kind_chk check (entry_kind in ('additional', 'adjustment', 'refund')),
  constraint wo_cost_category_chk check (category in ('parts', 'labour', 'tyre', 'lubricant', 'outside_repair', 'other')),
  constraint wo_cost_status_chk check (status in ('draft', 'pending_reconciliation', 'pending_approval', 'approved', 'rejected', 'reversed')),
  constraint wo_cost_recon_chk check (reconciliation in ('not_in_import', 'possible_duplicate', 'cannot_tell')),
  constraint wo_cost_source_chk check (source in ('manual', 'store_issue', 'supplier_invoice', 'erp_follow_up', 'other')),
  constraint wo_cost_amount_chk check (amount <> 0 and (entry_kind = 'adjustment' or amount > 0)),
  constraint wo_cost_text_chk check (btrim(description) <> '' and btrim(reason) <> '' and btrim(currency) <> ''),
  constraint wo_cost_decider_chk check (decided_by is null or decided_by <> created_by)
);

create index if not exists wo_cost_entries_wo_idx on public.work_order_cost_entries (work_order_id, created_at);
create index if not exists wo_cost_entries_org_status_idx on public.work_order_cost_entries (organisation_id, country, status);
create unique index if not exists wo_cost_entries_client_uidx on public.work_order_cost_entries (client_uuid) where client_uuid is not null;

comment on table public.work_order_cost_entries is
  'WO-5: append-only cost ledger of a work order. work_orders.parts_cost stays the imported baseline; '
  'only APPROVED entries count in v_work_order_cost_totals. Written only by the work_order_cost_* functions.';

create table if not exists public.work_order_cost_entry_events (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  entry_id        uuid not null references public.work_order_cost_entries(id),
  event           text not null,
  from_status     text,
  to_status       text,
  actor_id        uuid,
  note            text,
  at              timestamptz not null default now()
);
create index if not exists wo_cost_entry_events_entry_idx on public.work_order_cost_entry_events (entry_id, at);

alter table public.work_order_cost_entries enable row level security;
alter table public.work_order_cost_entry_events enable row level security;

create policy wo_cost_entries_org_isolation on public.work_order_cost_entries
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy wo_cost_entries_country_isolation on public.work_order_cost_entries
  as restrictive for all to authenticated
  using (country is null or public.app_can_see_country(country))
  with check (country is null or public.app_can_see_country(country));
create policy wo_cost_entries_site_isolation on public.work_order_cost_entries
  as restrictive for all to authenticated
  using (case when coalesce(btrim(site), '') = '' then (select public.app_sees_all_sites()) else public.app_can_see_site(site) end)
  with check (case when coalesce(btrim(site), '') = '' then (select public.app_sees_all_sites()) else public.app_can_see_site(site) end);
create policy wo_cost_entries_read on public.work_order_cost_entries
  for select to authenticated using ((select public.app_is_active()));

create policy wo_cost_entry_events_org_isolation on public.work_order_cost_entry_events
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy wo_cost_entry_events_read on public.work_order_cost_entry_events
  for select to authenticated
  using ((select public.app_is_active())
         and exists (select 1 from public.work_order_cost_entries e where e.id = entry_id));

revoke all on public.work_order_cost_entries from public, anon, authenticated;
revoke all on public.work_order_cost_entry_events from public, anon, authenticated;
grant select on public.work_order_cost_entries to authenticated;
grant select on public.work_order_cost_entry_events to authenticated;

-- Append only, whoever writes: the facts of an entry never change and a signed-in user removes nothing.
create or replace function public.wo_cost_entry_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'A cost entry is never removed. Reject or reverse it instead.' using errcode = '42501';
    end if;
    return OLD;
  end if;
  if (NEW.id, NEW.organisation_id, NEW.work_order_id, NEW.entry_kind, NEW.amount, NEW.currency, NEW.created_by, NEW.created_at)
     is distinct from
     (OLD.id, OLD.organisation_id, OLD.work_order_id, OLD.entry_kind, OLD.amount, OLD.currency, OLD.created_by, OLD.created_at) then
    raise exception 'The amount, currency and author of a cost entry cannot be changed. Reverse it and enter a new one.'
      using errcode = '42501';
  end if;
  if OLD.status in ('rejected', 'reversed') and NEW.status is distinct from OLD.status then
    raise exception 'This cost entry is finished and cannot change again.' using errcode = '42501';
  end if;
  return NEW;
end;
$function$;
revoke all on function public.wo_cost_entry_immutable() from public;
revoke all on function public.wo_cost_entry_immutable() from anon;
revoke all on function public.wo_cost_entry_immutable() from authenticated;

create or replace trigger wo_cost_entry_immutable
  before update or delete on public.work_order_cost_entries
  for each row execute function public.wo_cost_entry_immutable();

-- Is this item already inside the imported ERP amount of the job card? Never a guess.
create or replace function public.work_order_cost_reconcile(p_job_id uuid, p_item_code text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  w record; v_lines int; v_sum numeric; v_match boolean;
  v_code text := upper(btrim(coalesce(p_item_code, '')));
begin
  select id, organisation_id, country, work_order_no, coalesce(parts_cost, 0) as parts_cost
    into w from public.work_orders where id = p_job_id;
  if not found then return 'cannot_tell'; end if;
  if auth.uid() is not null and not public.is_super_admin()
     and w.organisation_id is distinct from public.app_current_org() then
    return 'cannot_tell';
  end if;
  select count(*), coalesce(sum(pc.line_cost), 0),
         coalesce(bool_or(v_code <> '' and upper(btrim(pc.item_code)) = v_code), false)
    into v_lines, v_sum, v_match
    from public.parts_consumption pc
   where pc.organisation_id = w.organisation_id
     and (pc.country is null or w.country is null or pc.country = w.country)
     and btrim(pc.work_order_no) = btrim(w.work_order_no::text);
  if v_match then return 'possible_duplicate'; end if;
  if v_lines = 0 then
    return case when w.parts_cost > 0 then 'cannot_tell' else 'not_in_import' end;
  end if;
  if v_code = '' then return 'cannot_tell'; end if;
  -- Line detail exists and does not name this item. Trust it only when it accounts for the stored cost.
  if w.parts_cost > v_sum + 0.01 then return 'cannot_tell'; end if;
  return 'not_in_import';
end;
$function$;

create or replace function public.wo_cost_log(p_entry uuid, p_org uuid, p_event text, p_from text, p_to text, p_note text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.work_order_cost_entry_events (organisation_id, entry_id, event, from_status, to_status, actor_id, note)
  values (p_org, p_entry, p_event, p_from, p_to, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''));
$function$;

-- Enter a DRAFT cost. Returns the entry.
create or replace function public.work_order_cost_add(
  p_job_id uuid, p_kind text, p_category text, p_item_code text, p_description text,
  p_quantity numeric, p_unit_cost numeric, p_amount numeric, p_source text, p_source_ref text,
  p_reason text, p_reverses uuid default null, p_client_uuid uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); w record; v_amount numeric; v_cur text; v_row public.work_order_cost_entries;
  v_kind text := lower(btrim(coalesce(p_kind, 'additional')));
begin
  if v_uid is null then raise exception 'Sign in to add a cost.' using errcode = '42501'; end if;
  if p_client_uuid is not null then
    select * into v_row from public.work_order_cost_entries where client_uuid = p_client_uuid and created_by = v_uid;
    if found then return to_jsonb(v_row); end if;
  end if;
  select id, organisation_id, country, site into w from public.work_orders where id = p_job_id;
  if not found or not public.work_order_can_job('cost', p_job_id) then
    raise exception 'You are not allowed to add a cost to this work order.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_description), '') = '' or coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say what the cost is and why it is added.' using errcode = '22023';
  end if;
  v_amount := round(coalesce(p_amount, p_quantity * p_unit_cost), 2);
  if v_amount is null or v_amount = 0 or (v_kind <> 'adjustment' and v_amount < 0) then
    raise exception 'Enter an amount above zero.' using errcode = '22023';
  end if;
  v_cur := public.currency_for_country(w.country);
  if w.country is null or v_cur is null then
    raise exception 'This work order has no country, so its currency is not known. Set the country first.' using errcode = '22023';
  end if;
  if v_kind = 'refund' and p_reverses is not null and not exists (
       select 1 from public.work_order_cost_entries e
        where e.id = p_reverses and e.work_order_id = p_job_id and e.status = 'approved') then
    raise exception 'A refund can only refer to an approved cost of the same work order.' using errcode = '22023';
  end if;
  insert into public.work_order_cost_entries (
    organisation_id, country, site, work_order_id, entry_kind, category, item_code, description,
    quantity, unit_cost, amount, currency, source, source_ref, reason, status, reconciliation,
    reverses_entry_id, client_uuid, created_by)
  values (
    w.organisation_id, w.country, w.site, w.id, v_kind, lower(btrim(coalesce(p_category, 'parts'))),
    nullif(btrim(coalesce(p_item_code, '')), ''), btrim(p_description), p_quantity, p_unit_cost, v_amount, v_cur,
    lower(btrim(coalesce(p_source, 'manual'))), nullif(btrim(coalesce(p_source_ref, '')), ''), btrim(p_reason), 'draft',
    case when v_kind = 'additional' then public.work_order_cost_reconcile(w.id, p_item_code) else 'not_in_import' end,
    p_reverses, p_client_uuid, v_uid)
  returning * into v_row;
  perform public.wo_cost_log(v_row.id, v_row.organisation_id, 'entered', null, 'draft', p_reason);
  return to_jsonb(v_row);
end;
$function$;

-- Send a draft for approval. The duplicate check is run again; anything not proven new waits for reconciliation.
create or replace function public.work_order_cost_submit(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); e public.work_order_cost_entries; v_recon text; v_to text;
begin
  select * into e from public.work_order_cost_entries where id = p_entry_id for update;
  if v_uid is null or not found or not (e.created_by = v_uid or public.work_order_can_job('cost_approve', e.work_order_id))
     or not public.work_order_can_job('cost', e.work_order_id) then
    raise exception 'You are not allowed to submit this cost.' using errcode = '42501';
  end if;
  if e.status <> 'draft' then
    raise exception 'This cost was already submitted or decided.' using errcode = 'PT409';
  end if;
  v_recon := case when e.entry_kind = 'additional' then public.work_order_cost_reconcile(e.work_order_id, e.item_code) else 'not_in_import' end;
  v_to := case when v_recon = 'not_in_import' then 'pending_approval' else 'pending_reconciliation' end;
  update public.work_order_cost_entries
     set status = v_to, reconciliation = v_recon, submitted_by = v_uid, submitted_at = now()
   where id = e.id returning * into e;
  perform public.wo_cost_log(e.id, e.organisation_id, 'submitted', 'draft', v_to, null);
  return to_jsonb(e);
end;
$function$;

-- Approve or reject. Needs cost_approve on the work order; never the person who entered it.
create or replace function public.work_order_cost_decide(p_entry_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); e public.work_order_cost_entries; v_from text;
  v_dec text := lower(btrim(coalesce(p_decision, '')));
begin
  select * into e from public.work_order_cost_entries where id = p_entry_id for update;
  if v_uid is null or not found or not public.work_order_can_job('cost_approve', e.work_order_id) then
    raise exception 'You are not allowed to approve costs on this work order.' using errcode = '42501';
  end if;
  if v_dec not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  if e.created_by = v_uid then
    raise exception 'You entered this cost, so another person has to decide it.' using errcode = '42501';
  end if;
  if e.status not in ('pending_approval', 'pending_reconciliation') then
    raise exception 'This cost is not waiting for a decision.' using errcode = 'PT409';
  end if;
  if coalesce(btrim(p_note), '') = '' and (v_dec = 'rejected' or e.status = 'pending_reconciliation') then
    raise exception 'Write how this cost was checked against the imported amount, or why it is rejected.' using errcode = '22023';
  end if;
  v_from := e.status;
  update public.work_order_cost_entries
     set status = v_dec, decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         reconciliation_note = case when v_from = 'pending_reconciliation' then btrim(p_note) else reconciliation_note end
   where id = e.id returning * into e;
  perform public.wo_cost_log(e.id, e.organisation_id, v_dec, v_from, v_dec, p_note);
  return to_jsonb(e);
end;
$function$;

-- The person who entered a cost takes it back before it is decided. The row stays, as rejected.
create or replace function public.work_order_cost_withdraw(p_entry_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); e public.work_order_cost_entries; v_from text;
begin
  select * into e from public.work_order_cost_entries where id = p_entry_id for update;
  if v_uid is null or not found or e.created_by <> v_uid
     or (not public.is_super_admin() and e.organisation_id is distinct from public.app_current_org()) then
    raise exception 'Only the person who entered a cost can withdraw it.' using errcode = '42501';
  end if;
  if e.status not in ('draft', 'pending_approval', 'pending_reconciliation') then
    raise exception 'This cost was already decided.' using errcode = 'PT409';
  end if;
  v_from := e.status;
  update public.work_order_cost_entries
     set status = 'rejected', decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Withdrawn by the person who entered it')
   where id = e.id returning * into e;
  perform public.wo_cost_log(e.id, e.organisation_id, 'withdrawn', v_from, 'rejected', p_note);
  return to_jsonb(e);
end;
$function$;

-- Reverse an approved cost (entered in error, or fully refunded). The row and its approval stay on record.
create or replace function public.work_order_cost_reverse(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); e public.work_order_cost_entries;
begin
  select * into e from public.work_order_cost_entries where id = p_entry_id for update;
  if v_uid is null or not found or not public.work_order_can_job('cost_approve', e.work_order_id) then
    raise exception 'You are not allowed to approve costs on this work order.' using errcode = '42501';
  end if;
  if e.status <> 'approved' then
    raise exception 'Only an approved cost can be reversed.' using errcode = 'PT409';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this cost is reversed.' using errcode = '22023';
  end if;
  update public.work_order_cost_entries
     set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = btrim(p_reason)
   where id = e.id returning * into e;
  perform public.wo_cost_log(e.id, e.organisation_id, 'reversed', 'approved', 'reversed', p_reason);
  return to_jsonb(e);
end;
$function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'public.work_order_cost_reconcile(uuid,text)',
    'public.work_order_cost_add(uuid,text,text,text,text,numeric,numeric,numeric,text,text,text,uuid,uuid)',
    'public.work_order_cost_submit(uuid)',
    'public.work_order_cost_decide(uuid,text,text)',
    'public.work_order_cost_withdraw(uuid,text)',
    'public.work_order_cost_reverse(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.wo_cost_log(uuid,uuid,text,text,text,text) from public';
  execute 'revoke all on function public.wo_cost_log(uuid,uuid,text,text,text,text) from anon';
  execute 'revoke all on function public.wo_cost_log(uuid,uuid,text,text,text,text) from authenticated';
end
$do$;

-- The four figures, per work order. security_invoker: the reader's own row rules apply.
create or replace view public.v_work_order_cost_totals
with (security_invoker = on) as
select w.id as work_order_id, w.organisation_id, w.country, w.site, w.work_order_no,
       public.currency_for_country(w.country) as currency,
       coalesce(w.parts_cost, 0)  as imported_parts_cost,
       coalesce(w.total_cost, 0)  as imported_total,
       coalesce(e.additional_approved, 0)  as additional_approved,
       coalesce(e.adjustments_approved, 0) as adjustments_approved,
       coalesce(e.refunds_approved, 0)     as refunds_approved,
       coalesce(w.total_cost, 0) + coalesce(e.additional_approved, 0) + coalesce(e.adjustments_approved, 0)
         - coalesce(e.refunds_approved, 0) as calculated_total,
       coalesce(e.unapproved_amount, 0) as unapproved_amount,
       coalesce(e.unapproved_count, 0)  as unapproved_count
  from public.work_orders w
  left join lateral (
    select sum(c.amount) filter (where c.status = 'approved' and c.entry_kind = 'additional') as additional_approved,
           sum(c.amount) filter (where c.status = 'approved' and c.entry_kind = 'adjustment') as adjustments_approved,
           sum(c.amount) filter (where c.status = 'approved' and c.entry_kind = 'refund')     as refunds_approved,
           sum(c.amount) filter (where c.status in ('draft', 'pending_reconciliation', 'pending_approval')) as unapproved_amount,
           count(*) filter (where c.status in ('draft', 'pending_reconciliation', 'pending_approval'))      as unapproved_count
      from public.work_order_cost_entries c where c.work_order_id = w.id) e on true;

revoke all on public.v_work_order_cost_totals from public, anon;
grant select on public.v_work_order_cost_totals to authenticated;

select anum_integration.apply_reader_policies();

commit;
