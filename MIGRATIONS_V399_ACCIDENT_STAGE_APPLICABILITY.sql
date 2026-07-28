-- =============================================================================
-- V399 / V399b — WHICH STAGES APPLY, and one workshop with one name
-- =============================================================================
-- APPLIED LIVE 2026-07-28 (project jhssdmeruxtrlqnwfksc), verified by rolled-back
-- live tests.
--
-- V399 — accidents.stage_waivers
--   Not every incident needs every team. A car park scratch needs no HSE
--   investigation, and forcing one leaves the case permanently showing an
--   outstanding stage nobody will ever fill - which is what made the ladder feel
--   like paperwork instead of a workflow.
--
--   Shape: { "hse_investigation": {"required": false, "remark": "...",
--                                  "by": "<uuid>", "at": "<ts>"} }
--   An ABSENT KEY MEANS THE STAGE APPLIES, so every existing case is unchanged
--   and nothing is waived by default.
--
--   WAIVED STAGES ARE HIDDEN FROM THE CASE, which is the customer's explicit
--   choice: they leave the ladder, stop counting as missing fields and stop
--   counting as skipped. But THE WAIVER ITSELF IS STORED with who and why.
--   Hiding a stage from the working view is a display decision; forgetting who
--   decided a team was not needed would make the audit trail lie. The reason
--   shows where the switch is set, and every flip writes a `stage_waived` /
--   `stage_reinstated` row into accident_audit_log.
--
--   Verified live (rolled back): waiving HSE wrote stage_waived; reinstating it
--   wrote stage_reinstated.
--
-- V399b — workshop_name cleanup
--   The column was free text and ONE workshop was recorded four ways:
--   'GCC Workshop' (4), 'GCC workshop' (3), 'GCC  Workshop' (1, double space)
--   and 'GCC ' (1). That is four rows in any by-workshop report and four options
--   in any filter built from the column. The form now writes from a controlled
--   list, so this is the one-off cleanup of what free text already collected.
--   DELIBERATELY CONSERVATIVE: only the GCC variants are folded, because those
--   are the ones proven to be the same workshop. Any other name is untouched.
--   Result: GCC Workshop 9, Vision Workshop 12 (unchanged), rest null.
--
-- MIRRORS IN JS - change together:
--   stage_waivers      <-> stageApplies / applicableStages (src/lib/accidentStages.js)
--   workshop folding   <-> canonWorkshop (src/lib/accidentVocab.js)
--
-- ROLLBACK
--   update public.accidents a set workshop_name = s.workshop_name
--     from public._workshop_snapshot_v399 s where s.id = a.id;
--   drop trigger if exists trg_accident_log_stage_waiver on public.accidents;
--   drop function if exists public.accident_log_stage_waiver();
--   alter table public.accidents drop column if exists stage_waivers;
-- =============================================================================

alter table public.accidents
  add column if not exists stage_waivers jsonb not null default '{}'::jsonb;

comment on column public.accidents.stage_waivers is
  'Stages that do not apply to this case: {stage: {required:false, remark, by, at}}. An absent key means the stage applies. Waived stages are hidden from the ladder but the waiver is retained for audit.';

-- A malformed value here would silently disable a stage, so it is rejected at
-- the boundary rather than defended against in five places in the UI.
alter table public.accidents drop constraint if exists chk_stage_waivers_object;
alter table public.accidents
  add constraint chk_stage_waivers_object
  check (jsonb_typeof(stage_waivers) = 'object');

create or replace function public.accident_log_stage_waiver()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  k text; was boolean; now_ boolean;
begin
  if NEW.stage_waivers is not distinct from OLD.stage_waivers then return null; end if;
  for k in select jsonb_object_keys(coalesce(NEW.stage_waivers, '{}'::jsonb))
                  union
                  select jsonb_object_keys(coalesce(OLD.stage_waivers, '{}'::jsonb))
  loop
    was  := coalesce((OLD.stage_waivers -> k ->> 'required')::boolean, true);
    now_ := coalesce((NEW.stage_waivers -> k ->> 'required')::boolean, true);
    if was is distinct from now_ then
      insert into public.accident_audit_log (accident_id, action, old_values, new_values, changed_by)
      values (NEW.id,
              case when now_ then 'stage_reinstated' else 'stage_waived' end,
              jsonb_build_object('stage', k, 'required', was),
              jsonb_build_object('stage', k, 'required', now_,
                                 'remark', NEW.stage_waivers -> k ->> 'remark'),
              auth.uid());
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_accident_log_stage_waiver on public.accidents;
create trigger trg_accident_log_stage_waiver
  after update on public.accidents
  for each row execute function public.accident_log_stage_waiver();

-- ── V399b ────────────────────────────────────────────────────────────────────
create table if not exists public._workshop_snapshot_v399 as
  select id, workshop_name from public.accidents where workshop_name is not null;

update public.accidents
   set workshop_name = 'GCC Workshop'
 where workshop_name is not null
   and lower(regexp_replace(btrim(workshop_name), '\s+', ' ', 'g')) in ('gcc', 'gcc workshop');

comment on table public._workshop_snapshot_v399 is
  'Pre-V399b workshop_name values. Undo: update accidents a set workshop_name = s.workshop_name from _workshop_snapshot_v399 s where s.id = a.id;';
