-- 20260930180500_access_change_reason.sql
-- STATUS: applied live 30 Sep 2026 (Control Center, Trust area).
--
-- Why: access_audit.reason exists but 0 of 1,821 access changes in the last 30
-- days carry one, because no writer passes a reason. Every access writer now
-- takes an optional p_reason text DEFAULT NULL as its LAST argument and puts it
-- in a transaction-local setting (app.access_reason). The two access_audit
-- trigger functions read that setting into access_audit.reason, so the audit
-- row written by the trigger carries the reason with no second write.
--
-- Pre-flight:
--   Data loss: none. No table is altered, no row touched.
--   Signature change: the old signature is DROPPED and recreated with the extra
--     defaulted argument, so there is exactly one function per name (a defaulted
--     overload beside the old one would make PostgREST refuse every call, 42725).
--     Every existing caller (web, console, Expo, Flutter, SQL) passes a subset of
--     the old named arguments, which still resolves. Bodies are the LIVE bodies
--     read with pg_get_functiondef; only the header and one line after BEGIN are
--     changed, guarded to abort unless each anchor occurs exactly once.
--   Grants: recreated as before (authenticated + service_role), revoked from
--     PUBLIC then anon.
--   set_user_access_grant: the grant's own note is used as the reason when no
--     p_reason is given (the note is the admin's written why).
--   Locks / duration: catalog only, milliseconds.
-- Rollback: re-run this block's loop with the header replacement reversed
--   (drop the p_reason argument and the set_config line), and restore the two
--   trigger functions without the reason column (bodies are in
--   MIGRATIONS_V228 access_audit).

-- 1. Triggers read the reason.
create or replace function public.log_access_audit_generic()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_entity text; v_target uuid; v_before jsonb; v_after jsonb;
  v_reason text := nullif(btrim(coalesce(current_setting('app.access_reason', true), '')), '');
BEGIN
  IF TG_TABLE_NAME = 'user_access_grants' THEN
    v_entity := 'grant'; v_target := COALESCE(NEW.user_id, OLD.user_id);
  ELSIF TG_TABLE_NAME = 'module_permissions' THEN
    v_entity := 'module_perm'; v_target := NULL;
  ELSIF TG_TABLE_NAME = 'custom_roles' THEN
    v_entity := 'custom_role'; v_target := NULL;
  ELSE
    v_entity := TG_TABLE_NAME; v_target := NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD); v_after := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL; v_after := to_jsonb(NEW);
  ELSE
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
  END IF;
  INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
  VALUES (auth.uid(), public.access_audit_actor_email(), TG_OP, v_target, v_entity, v_before, v_after, left(v_reason, 500));
  RETURN NULL;
END $function$;

create or replace function public.log_access_audit_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_email text := public.access_audit_actor_email(); v_actor uuid := auth.uid();
  v_reason text := left(nullif(btrim(coalesce(current_setting('app.access_reason', true), '')), ''), 500);
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'role', jsonb_build_object('role', OLD.role), jsonb_build_object('role', NEW.role), v_reason);
  END IF;
  IF OLD.country IS DISTINCT FROM NEW.country THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'country', jsonb_build_object('country', to_jsonb(OLD.country)), jsonb_build_object('country', to_jsonb(NEW.country)), v_reason);
  END IF;
  IF OLD.locked IS DISTINCT FROM NEW.locked THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'lock', jsonb_build_object('locked', OLD.locked), jsonb_build_object('locked', NEW.locked), v_reason);
  END IF;
  IF OLD.approved IS DISTINCT FROM NEW.approved THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'approve', jsonb_build_object('approved', OLD.approved), jsonb_build_object('approved', NEW.approved), v_reason);
  END IF;
  IF OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'super_admin', jsonb_build_object('is_super_admin', OLD.is_super_admin), jsonb_build_object('is_super_admin', NEW.is_super_admin), v_reason);
  END IF;
  RETURN NULL;
END $function$;

-- 2. Every writer takes p_reason and publishes it for the triggers.
do $mig$
declare
  r record;
  v_def text;
  v_new text;
  v_head_old text;
  v_head_new text;
  v_line text;
  v_has boolean;
begin
  for r in
    select p.oid, p.proname, p.oid::regprocedure::text as sig, pg_get_function_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname in ('set_module_permissions','set_user_access_grant','revoke_user_access_grant',
                         'admin_bulk_set_role','admin_bulk_set_grant','admin_update_profile',
                         'admin_set_user_country','admin_set_user_sites','save_access_control_matrix')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_has := r.args like '%p_reason text%';
    v_line := case when r.proname = 'set_user_access_grant'
      then E'  perform set_config(''app.access_reason'', coalesce(nullif(btrim(coalesce(p_reason, p_note, '''')), ''''), ''''), true);\n'
      else E'  perform set_config(''app.access_reason'', coalesce(nullif(btrim(coalesce(p_reason, '''')), ''''), ''''), true);\n' end;

    if (select count(*) from regexp_matches(v_def, E'\\n[ \\t]*begin[ \\t]*\\n', 'gi')) <> 1 then
      raise exception 'anchor BEGIN not unique in %', r.sig;
    end if;
    if position('app.access_reason' in v_def) > 0 then
      raise exception 'already patched: %', r.sig;
    end if;
    v_new := regexp_replace(v_def, E'(\\n[ \\t]*begin[ \\t]*\\n)', E'\\1' || replace(v_line, '\', '\\'), 'i');

    if not v_has then
      v_head_old := 'public.' || r.proname || '(' || r.args || ')';
      v_head_new := 'public.' || r.proname || '(' || r.args || ', p_reason text DEFAULT NULL::text)';
      if (length(v_new) - length(replace(v_new, v_head_old, ''))) / length(v_head_old) <> 1 then
        raise exception 'anchor header not unique in %', r.sig;
      end if;
      v_new := replace(v_new, v_head_old, v_head_new);
      execute 'drop function public.' || r.sig;
    end if;
    execute v_new;
    execute format('revoke all on function public.%I(%s) from public', r.proname,
      (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.proname));
    execute format('revoke all on function public.%I(%s) from anon', r.proname,
      (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.proname));
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname,
      (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.proname));
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.proname in ('set_module_permissions','set_user_access_grant','revoke_user_access_grant',
                           'admin_bulk_set_role','admin_bulk_set_grant','admin_update_profile',
                           'admin_set_user_country','admin_set_user_sites','save_access_control_matrix')
         and pg_get_function_arguments(p.oid) like '%p_reason text%'
         and position('app.access_reason' in pg_get_functiondef(p.oid)) > 0) <> 9 then
    raise exception 'not every access writer carries p_reason';
  end if;
end
$mig$;
