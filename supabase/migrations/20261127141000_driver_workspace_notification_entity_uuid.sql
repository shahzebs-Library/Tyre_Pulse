-- Every driver workspace action (assign_team, create_fine, respond_fine,
-- review/correct/reassign fine, every charge_* action) and the fine reminder
-- job fail with 42804 because their inbox notification passes the entity id
-- as TEXT while public.notifications.entity_id is UUID.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's yes. Apply this
-- BEFORE or together with 20261127140000_fleet_supervisor_driver_management:
-- without it a supervisor gets access but every fine and charge still fails.
--
-- PROOF (live, 2026-11-27, rolled back): a Fleet Supervisor with an open team
-- assignment ('supervisor' access) and a driver site set:
--   charge_issue -> 42804 column "entity_id" is of type uuid but expression is of type text
--   create_fine  -> 42804 the same
-- There is no assignment cast from text to uuid, so INSERT ... SELECT/VALUES of
-- `<id>::text` into a uuid column is refused at plan time, every call, whether
-- or not a recipient row exists. driver_workspace_events holds 0 rows: no
-- driver workspace action has ever succeeded on this database.
--
-- FIX: in the four functions below, drop the `::text` cast on the id passed
-- as the notification entity_id. Each body is read from the LIVE definition,
-- changed only at that spot (anchored, counted) and re-created. The migration
-- ABORTS if a function does not contain the pattern or if any instance is left.
--   private.driver_workspace_command(text, jsonb, uuid)        1 instance
--   private.driver_fine_enterprise_command(text, jsonb, uuid)  2 instances
--   private.driver_fine_dispatch_reminders(date)               1 instance
--   private.driver_charge_command(text, jsonb, uuid)           2 instances
-- DRY RUN 2026-11-27 (rolled back): all four rewritten, then as a Fleet
-- Supervisor charge_issue -> OK and create_fine -> OK.
--
-- VERIFY (rolled back, as a Fleet Supervisor who supervises driver <d> whose
-- site is set):
--   select public.driver_workspace_command('create_fine', jsonb_build_object(
--     'driver_id',<d>,'vehicle_id',<v>,'authority','Muroor','notice_reference','N-1',
--     'amount',300,'currency','SAR','incident_at',now()-interval '1 day',
--     'description','Speeding','assignment_reason','On roster'), gen_random_uuid());
--   -- returns {driver_id, id, action}; no 42804.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'private' and p.prokind = 'f'
--      and pg_get_functiondef(p.oid) ~ '''driver_workspace'',\s*[a-z_]+\.[a-z_]+::text'; -- 0
--
-- ROLLBACK: not useful (the old bodies cannot run); if needed, restore each
-- function from the migration that last defined it.

begin;

do $$
declare
  fn regprocedure;
  def text;
  fixed text;
  hits integer;
  pat constant text := '(''driver_workspace'',\s*[a-z_]+\.[a-z_]+)::text';
begin
  foreach fn in array array[
    'private.driver_workspace_command(text,jsonb,uuid)'::regprocedure,
    'private.driver_fine_enterprise_command(text,jsonb,uuid)'::regprocedure,
    'private.driver_fine_dispatch_reminders(date)'::regprocedure,
    'private.driver_charge_command(text,jsonb,uuid)'::regprocedure]
  loop
    def := pg_get_functiondef(fn);
    select count(*) into hits from regexp_matches(def, pat, 'g');
    if hits < 1 then
      raise exception 'Expected the text-cast notification id in %, found none; the live body changed, review before applying', fn;
    end if;
    fixed := regexp_replace(def, pat, '\1', 'g');
    if fixed ~ pat then
      raise exception 'A text-cast notification id is still present in %', fn;
    end if;
    execute fixed;
    raise notice 'Fixed % (% instance(s))', fn, hits;
  end loop;
end $$;

commit;
