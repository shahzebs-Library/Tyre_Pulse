-- =============================================================================
-- DATA ONLY: close the stuck legacy accident cases (owner decision 2026-11-27).
--
-- STATUS: AUTHORED, NOT APPLIED. Independent of the other accident migrations;
-- apply it BEFORE the first daily scan that includes the stalled check
-- (20261127190400), otherwise each of these cases raises a stalled notice.
--
-- WHAT IT DOES
--   * The 21 cases sitting at status 'reported' (oldest 2026-02-13, 16 older than
--     90 days) and the 1 case already at stage 'closed' without a closure review
--     are marked closure_level = 'legacy_closed', case_status = 'closed', stage
--     'closed', case_flags.closure_basis = 'backfilled' - the same path the 13
--     earlier legacy cases use. No closure review is invented.
--   * Only rows created before this migration was written (created_at < 2026-11-28)
--     are touched, so a genuine new report can never be closed by it.
--   * Snapshot first into _bak.accident_legacy_close_20261127 (reversible).
--   * The closure gate and status-capability triggers are switched off for this one
--     statement (a legacy close has no review by definition) and the event trigger
--     too, so 22 "your case is closed" notices are not sent for old cases. All three
--     are switched back on in the same transaction and checked.
--
-- VERIFY (run live 2026-11-27, rolled back): 22 rows closed (21 reported + 1),
--   0 open 'reported' cases left from before 2026-11-28, 35 legacy_closed in total,
--   all three triggers enabled again.
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
 where created_at < '2026-11-28'
   and coalesce(closure_level, 'open') = 'open'
   and (status = 'reported' or workflow_stage = 'closed');

do $$
declare n int;
begin
  select count(*) into n from _bak.accident_legacy_close_20261127;
  if n > 40 then
    raise exception 'legacy close: % rows selected, expected about 22 - stopping', n;
  end if;
end $$;

alter table public.accidents disable trigger trg_enforce_accident_closure;
alter table public.accidents disable trigger trg_status_cap_accidents;
alter table public.accidents disable trigger trg_emit_accident_events;

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

do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.accidents'::regclass
                and tgname in ('trg_enforce_accident_closure','trg_status_cap_accidents','trg_emit_accident_events')
                and tgenabled <> 'O') then
    raise exception 'legacy close: a trigger was not re-enabled';
  end if;
end $$;

commit;
