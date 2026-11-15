-- ROLLBACK for 20261113130000_cur_work_orders_manager_director_default.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a schema and data fingerprint equal to the one taken
--         before the apply. See docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 1.
-- ORDER:  run only after 20261115140000 has been rolled back (or was never applied).
-- CAUTION: step 1 restores organisations.settings from the backup taken at apply time. If an Admin
--         changed Access Control between the apply and this rollback, that later change is lost
--         for the organisations in the backup. Check before running:
--           select o.id, o.settings is not distinct from b.settings as unchanged_since_backup
--             from public.organisations o join _bak.cur1_org_settings_20261113 b on b.id = o.id;
--         and compare against the settings the apply wrote. The backup table itself is kept.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation. Owner present,
--         or run it in the SQL editor.

begin;

-- 1. Organisation matrices back to what they were before the apply.
update public.organisations o
   set settings = b.settings
  from _bak.cur1_org_settings_20261113 b
 where b.id = o.id;

-- 2. app_user_can(): the exact reverse of the anchored replacement in the apply file.
do $do$
declare
  v_def  text := pg_get_functiondef('public.app_user_can(text,text)'::regprocedure);
  v_old  text := 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);';
  v_new  text := 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, public.app_role_capability_default(v_role, p_key, v_cap));';
  v_hits integer;
begin
  if position('app_role_capability_default' in v_def) = 0 then
    raise notice 'app_user_can already uses the hard-coded fallback; nothing to change.';
    return;
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);
  if v_hits <> 1 then
    raise exception 'Rollback aborted: expected the CUR-1 expression once in app_user_can, found %.', v_hits;
  end if;
  execute replace(v_def, v_new, v_old);
end
$do$;

-- 3. The default function is no longer referenced.
drop function if exists public.app_role_capability_default(text, text, text);

commit;
