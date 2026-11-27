-- =============================================================================
-- DATA ONLY: close the stuck legacy accident cases (owner decision 2026-11-27).
--
-- STATUS: APPLIED LIVE 2026-11-28 on owner OK (apply all five). Result: byte-exact; exactly 20 cases legacy_closed (33 total), 0 stage-event rows written, 5 triggers re-enabled, ACC-2026-0041/0043 still open.
--         (was: AUTHORED, NOT APPLIED.) Independent of the other accident migrations;
-- apply it BEFORE the first daily scan that includes the stalled check
-- (20261127190400), otherwise each of these cases raises a stalled notice.
--
-- WHAT IT DOES
--   * Open cases older than 30 days that sit at status 'reported', plus the 1 case
--     already at stage 'closed' with no closure review (ACC-2026-0038, 44958d9f,
--     kept in the set on purpose: it is closed in every sense except the review), are
--     marked closure_level = 'legacy_closed', case_status = 'closed', stage
--     'closed', case_flags.closure_basis = 'backfilled' - the same path the 13
--     earlier legacy cases use. No closure review is invented.
--   * Only rows older than 30 days are touched, so a fresh report is never closed.
--     Measured 2026-11-27: 20 rows selected (19 'reported' + ACC-2026-0038).
--     EXCLUDED because they are under 30 days old (they stay open and get owners):
--       ACC-2026-0043  fcfb2299-04e4-4ab5-93af-c9f71cd7cca9  created 2026-11-23
--       ACC-2026-0041  604eaf24-e8ed-4079-996b-80ead4d56a9b  created 2026-10-29
--   * Snapshot first into _bak.accident_legacy_close_20261127 (reversible).
--   * Switched off for this one statement and back on in the same transaction (then
--     checked): the closure gate and status-capability triggers (a legacy close has
--     no review by definition), the event trigger (no "your case is closed" notices
--     for old cases) and both stage-log triggers (no invented "skipped stage" rows in
--     accident_stage_events / waivers for stages these cases never went through).
--
-- VERIFY (run live 2026-11-27, rolled back): 20 rows closed (19 reported + 1),
--   the 2 recent cases still open, 0 new stage-event rows, 33 legacy_closed in total,
--   all five triggers enabled again.
--
-- UNDO:
--   alter table public.accidents disable trigger trg_enforce_accident_closure;
--   update public.accidents a set status = b.status, workflow_stage = b.workflow_stage,
--          case_status = b.case_status, closure_level = b.closure_level, case_flags = b.case_flags
--     from _bak.accident_legacy_close_20261127 b where b.id = a.id;
--   alter table public.accidents enable trigger trg_enforce_accident_closure;
-- =============================================================================

begin;

create schema if not exists _bak;

create table if not exists _bak.accident_legacy_close_20261127 as
select id, status, workflow_stage, case_status, closure_level, case_flags, updated_at, now() as snapshot_at
  from public.accidents
 where created_at < now() - interval '30 days'
   and coalesce(closure_level, 'open') = 'open'
   and (status = 'reported' or workflow_stage = 'closed');

do $$
declare n int;
begin
  select count(*) into n from _bak.accident_legacy_close_20261127;
  if n > 25 then
    raise exception 'legacy close: % rows selected, expected about 20 - stopping', n;
  end if;
end $$;

alter table public.accidents disable trigger trg_enforce_accident_closure;
alter table public.accidents disable trigger trg_status_cap_accidents;
alter table public.accidents disable trigger trg_emit_accident_events;
alter table public.accidents disable trigger trg_accident_log_stage_event;
alter table public.accidents disable trigger trg_accident_log_stage_waiver;

update public.accidents a
   set status = 'closed',
       workflow_stage = 'closed',
       case_status = 'closed',
       closure_level = 'legacy_closed',
       case_flags = coalesce(a.case_flags, '{}'::jsonb)
                    || jsonb_build_object('closure_basis', 'backfilled',
                                          'legacy_closed_on', '2026-11-27',
                                          'legacy_reason', 'Owner decision: old case never progressed past ' || coalesce(b.workflow_stage, 'reported'))
  from _bak.accident_legacy_close_20261127 b
 where b.id = a.id;

alter table public.accidents enable trigger trg_enforce_accident_closure;
alter table public.accidents enable trigger trg_status_cap_accidents;
alter table public.accidents enable trigger trg_emit_accident_events;
alter table public.accidents enable trigger trg_accident_log_stage_event;
alter table public.accidents enable trigger trg_accident_log_stage_waiver;

do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.accidents'::regclass
                and tgname in ('trg_enforce_accident_closure','trg_status_cap_accidents','trg_emit_accident_events',
                               'trg_accident_log_stage_event','trg_accident_log_stage_waiver')
                and tgenabled <> 'O') then
    raise exception 'legacy close: a trigger was not re-enabled';
  end if;
end $$;

commit;
