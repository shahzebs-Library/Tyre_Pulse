-- =====================================================================
-- V534 / V534b / V534c  VEHICLE WASHING: CORRECTION, SCHEDULE, STATUS
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--   v534_wash_corrections_and_schedule
--   v534b_correct_wash_record_rpc
--   v534c_wash_status_widen_in_progress
-- =====================================================================
--
-- WHAT THE OWNER ASKED FOR, MONTHS AGO
-- ------------------------------------
-- "add a log doenalod able for washing edit and corextion needs little more
-- advancedmwn in washing in web sections" plus "We should schedule it also for
-- later". Four things: a downloadable log, EDIT, CORRECTION, and SCHEDULING.
-- It was written into the project memory as scope and never built. The owner
-- noticed. This is that work.
--
-- CORRECTION IS THE PRIMITIVE, NOT EDIT
-- -------------------------------------
-- The open question was whether "correction" means editing the record in place
-- or recording a correction against it so the original stays visible. Both
-- readings are satisfied by making the correction the primitive: every change
-- writes what the field held before, what it holds now, who changed it and why,
-- and updates the record in the SAME transaction. An edit IS a correction with
-- a reason attached, and a wash that is ever disputed still shows its original.
--
-- Split across two client calls, a failure between them would leave a changed
-- record with no trace of the change - worse than offering no corrections at
-- all. So `correct_wash_record` does both or neither. It locks the row (two
-- supervisors correcting the same record cannot each log a change against a
-- value the other already replaced), ignores any field not on its allowlist
-- (id and organisation_id can never be touched, so a row can be neither
-- re-keyed nor moved to another tenant), and skips no-op writes - a history
-- full of "changed X to X" buries the corrections that matter.
--
-- wash_date is deliberately CORRECTABLE. The mobile app locks it to today so a
-- driver cannot backdate; a supervisor fixing a record entered on the wrong day
-- is exactly what this is for, and it leaves a trace naming them.
--
-- V534c: I BROKE THE MOBILE SAVE AND THIS IS THE FIX
-- --------------------------------------------------
-- V534 narrowed the status CHECK to a vocabulary I invented - Completed,
-- Scheduled, Missed, Cancelled - without reading what the writers send. The
-- mobile app has always written 'In Progress'. Every driver wash would have
-- failed the insert.
--
-- That is the V294 defect repeated exactly, and this file records it so it is
-- not repeated a third time: A STATUS LIST AND ITS CHECK ARE A PAIR. Narrowing
-- the CHECK without reading every writer ships a feature that renders correctly
-- and cannot save, which is invisible until somebody in the field cannot work.
-- Widening is the safe direction; narrowing needs every writer checked first.
--
-- 'In Progress' earns its own value rather than being folded into either
-- neighbour: the machine is in the bay, so the wash has started and has not
-- finished. It is NOT counted as work done - counting it would report work as
-- done while it is still being done, and a fleet that reads itself as washed
-- does not go and wash anything.
--
-- ONLY 'Completed' IS COMPLIANCE. Every count, rate and trend excludes the
-- rest. The client engine mirrors this in NON_WORK_STATUSES; change both.
--
-- COST
-- ----
-- The owner answered: "Cost will be zero coat" - washing is done in house and
-- carries no charge. So the column stays (a vendor wash may happen later and
-- must be recordable), 0 is a deliberate fact rendered as "No charge", and NULL
-- means nobody entered a figure and renders as "Not recorded". The two are
-- never collapsed. Washing is reported on COMPLIANCE and appears in no cost
-- report: a zero line in a cost report reads as a measurement failure.
--
-- MEASURED AT APPLY TIME: wash_records held ZERO rows. The module is a complete
-- interface over an empty table, so every surface carries NotInUseNotice and
-- tiles of 0 read as "nothing recorded yet" rather than "no washes happened".
--
-- ROLLBACK
--   drop function if exists public.correct_wash_record(uuid, jsonb, text);
--   drop table if exists public.wash_record_corrections;
--   alter table public.wash_records drop constraint wash_records_status_check;
-- =====================================================================

create table if not exists public.wash_record_corrections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  wash_id uuid not null references public.wash_records(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  reason text,
  corrected_by uuid default auth.uid(),
  corrected_at timestamptz not null default now()
);

create index if not exists wash_record_corrections_wash_idx
  on public.wash_record_corrections (wash_id, corrected_at desc);

alter table public.wash_record_corrections enable row level security;

drop policy if exists wash_record_corrections_org_isolation on public.wash_record_corrections;
create policy wash_record_corrections_org_isolation on public.wash_record_corrections
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists wash_record_corrections_read on public.wash_record_corrections;
create policy wash_record_corrections_read on public.wash_record_corrections
  for select to authenticated
  using ((select public.app_is_active()));

revoke all on public.wash_record_corrections from anon;

-- The final status vocabulary (V534c). Widening only.
alter table public.wash_records drop constraint if exists wash_records_status_check;
alter table public.wash_records
  add constraint wash_records_status_check
  check (status in ('Completed', 'In Progress', 'Scheduled', 'Missed', 'Cancelled'));

-- The RPC body is in the applied migration v534b_correct_wash_record_rpc.
-- See the header above for why it does both writes or neither.
