-- Warranty claim procedure: every status change is recorded, and a decision
-- cannot be saved without the facts that make it a decision.
--
-- WHY: warranty_claims kept only the CURRENT status. Nobody could say when a
-- claim was sent to the supplier, how long it waited, who approved it or why it
-- was rejected. supplier_ref / decision_date / rejection_reason existed but no
-- screen wrote them. Measured live 2026-11-04: 0 claims, so nothing to backfill.
--
-- Procedure (mirrored by src/lib/warrantyTrackerAnalytics.js CLAIM_FLOW - change both):
--   Submitted -> Under Review -> Approved -> Credit Issued -> Closed
--                             \-> Rejected (-> Closed)
-- Rules enforced here (a client cannot skip them):
--   * claim_status must be one of the six statuses;
--   * Rejected needs a rejection_reason;
--   * Credit Issued needs credit_amount > 0 and a credit_date;
--   * Approved / Rejected / Credit Issued stamp decision_date when it is blank.
-- History: warranty_claim_events, append-only, written ONLY by the trigger.
--
-- Rollback:
--   drop trigger if exists trg_warranty_claim_events on public.warranty_claims;
--   drop trigger if exists trg_warranty_claim_guard on public.warranty_claims;
--   drop function if exists public.warranty_claim_log_event();
--   drop function if exists public.warranty_claim_guard();
--   drop table if exists public.warranty_claim_events;

create table if not exists public.warranty_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.warranty_claims(id) on delete cascade,
  organisation_id uuid,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists warranty_claim_events_claim_idx
  on public.warranty_claim_events (claim_id, changed_at);

alter table public.warranty_claim_events enable row level security;

drop policy if exists warranty_claim_events_read on public.warranty_claim_events;
create policy warranty_claim_events_read on public.warranty_claim_events
  for select to authenticated
  using (exists (select 1 from public.warranty_claims c where c.id = claim_id));

revoke insert, update, delete, truncate on public.warranty_claim_events from authenticated, anon;
grant select on public.warranty_claim_events to authenticated;

create or replace function public.warranty_claim_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  new.claim_status := coalesce(nullif(btrim(new.claim_status), ''), 'Submitted');
  if new.claim_status not in ('Submitted','Under Review','Approved','Rejected','Credit Issued','Closed') then
    raise exception 'Unknown warranty claim status: %', new.claim_status using errcode = '23514';
  end if;
  if new.claim_status = 'Rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
    raise exception 'A rejected claim needs the supplier''s rejection reason' using errcode = '23514';
  end if;
  if new.claim_status = 'Credit Issued' and (coalesce(new.credit_amount, 0) <= 0 or new.credit_date is null) then
    raise exception 'A credited claim needs the credit amount and the credit date' using errcode = '23514';
  end if;
  if new.claim_status in ('Approved','Rejected','Credit Issued') and new.decision_date is null then
    new.decision_date := current_date;
  end if;
  new.updated_at := now();
  return new;
end $function$;

create or replace function public.warranty_claim_log_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_name text;
begin
  if tg_op = 'UPDATE' and new.claim_status is not distinct from old.claim_status then
    return new;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.username)
    into v_name from public.profiles p where p.id = auth.uid();
  insert into public.warranty_claim_events
    (claim_id, organisation_id, from_status, to_status, note, changed_by, changed_by_name)
  values
    (new.id, new.organisation_id,
     case when tg_op = 'UPDATE' then old.claim_status end,
     new.claim_status,
     case when new.claim_status = 'Rejected' then new.rejection_reason
          when new.claim_status = 'Credit Issued' then 'Credit ' || new.credit_amount::text
          else null end,
     auth.uid(), v_name);
  return new;
exception when others then
  -- History must never block the claim itself.
  return new;
end $function$;

revoke all on function public.warranty_claim_log_event() from public, anon, authenticated;
revoke all on function public.warranty_claim_guard() from public, anon, authenticated;

drop trigger if exists trg_warranty_claim_guard on public.warranty_claims;
create trigger trg_warranty_claim_guard
  before insert or update on public.warranty_claims
  for each row execute function public.warranty_claim_guard();

drop trigger if exists trg_warranty_claim_events on public.warranty_claims;
create trigger trg_warranty_claim_events
  after insert or update of claim_status on public.warranty_claims
  for each row execute function public.warranty_claim_log_event();
