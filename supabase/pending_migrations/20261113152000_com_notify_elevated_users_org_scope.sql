-- COM-2 (audit MODB-5): notify_elevated_users notifies the managers of ONE organisation.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions of
--         notify_elevated_users and notify_workshop_parts (pg_get_functiondef, project
--         jhssdmeruxtrlqnwfksc, SELECT only). Not applied to any database. Tested on PGlite only
--         (supabase/tests/commercial_notifications.test.mjs).
--
-- ROOT CAUSE
--   public.notify_elevated_users(type, title, body, entity_type, entity_id) inserts one
--   notification for every profile whose role is Admin, Manager or Director. It has no
--   organisation argument and no organisation filter. Its one live caller is the trigger
--   notify_workshop_parts on public.parts_requests, so a new parts request in any company
--   puts "Parts requested for <asset>" in the bell of every other company's managers.
--   (dispatch_accident_notifications also calls it but is not attached to any trigger today.)
--   Verified live 2026-11-12: 5 elevated profiles, 1 of them outside the current company.
--
-- WHAT THIS CHANGES
--   1. New public.notify_elevated_users_in_org(org, type, title, body, entity_type, entity_id):
--      the same insert with one more predicate, the recipient's organisation. A null
--      organisation notifies nobody.
--   2. The existing five-argument function keeps its signature (no caller breaks, no second
--      overload that would make calls ambiguous) and now resolves the organisation itself:
--      the caller's own organisation, else the organisation of the named accident or parts
--      request row. If it cannot resolve one it notifies nobody. It never falls back to
--      "everyone".
--   3. notify_workshop_parts passes the row's own organisation_id explicitly (one swap in the
--      live text, guarded to match exactly once).
--
-- RISK TO THE CURRENT COMPANY: NONE EXPECTED.
--   Managers of the current company receive exactly the notifications they receive today for
--   the current company's rows. The one elevated profile in another organisation stops
--   receiving the current company's parts request notices, which is the fix. parts_requests
--   holds 0 rows and its module is switched off, so nothing observable changes on day one.
--   Neither function is executable by anon or authenticated today and that is kept.
--
-- VERIFY (after applying; read only)
--   select position('notify_elevated_users_in_org' in pg_get_functiondef('public.notify_workshop_parts()'::regprocedure)) > 0;  -- t
--   select has_function_privilege('authenticated','public.notify_elevated_users_in_org(uuid,text,text,text,text,uuid)','EXECUTE'); -- f
--   select has_function_privilege('authenticated','public.notify_elevated_users(text,text,text,text,uuid)','EXECUTE');            -- f
--
-- ROLLBACK
--   Re-create notify_elevated_users and notify_workshop_parts from
--   supabase/tests/fixtures/commercial_live_functions.sql, then remove
--   public.notify_elevated_users_in_org(uuid,text,text,text,text,uuid).

do $guard$
declare
  v text;
begin
  select md5(prosrc) into v from pg_proc
   where oid = 'public.notify_elevated_users(text,text,text,text,uuid)'::regprocedure;
  if v is distinct from '514bde7dd566ff5319e19efadce78b38' then
    raise exception 'COM-2: notify_elevated_users has changed since this draft was written (md5 %). Re-author against the live body.', v;
  end if;
end
$guard$;

create or replace function public.notify_elevated_users_in_org(
  p_org uuid, p_type text, p_title text, p_body text,
  p_entity_type text default 'accident'::text, p_entity_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF p_org IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
    FROM public.profiles
   WHERE role IN ('Admin', 'Manager', 'Director')
     AND locked  = false
     AND (approved IS NULL OR approved = true)
     AND (organisation_id = p_org OR org_id = p_org);
END;
$function$;

create or replace function public.notify_elevated_users(p_type text, p_title text, p_body text, p_entity_type text default 'accident'::text, p_entity_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_org uuid := public.app_current_org();
BEGIN
  -- COM-2: resolve ONE organisation. Never notify every organisation.
  IF v_org IS NULL AND p_entity_id IS NOT NULL THEN
    IF p_entity_type = 'accident' THEN
      SELECT a.organisation_id INTO v_org FROM public.accidents a WHERE a.id = p_entity_id;
    ELSIF p_entity_type = 'parts_request' THEN
      SELECT r.organisation_id INTO v_org FROM public.parts_requests r WHERE r.id = p_entity_id;
    END IF;
  END IF;
  PERFORM public.notify_elevated_users_in_org(v_org, p_type, p_title, p_body, p_entity_type, p_entity_id);
END;
$function$;

revoke all on function public.notify_elevated_users_in_org(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.notify_elevated_users(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.notify_elevated_users_in_org(uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.notify_elevated_users(text, text, text, text, uuid) to service_role;

do $migration$
declare
  c_md5 constant text := 'c82bbccaef962719057295edae48240d';
  c_old constant text := $a$perform public.notify_elevated_users(
        'parts_request', 'New parts request',$a$;
  c_new constant text := $b$perform public.notify_elevated_users_in_org(
        new.organisation_id, 'parts_request', 'New parts request',$b$;
  v_def text;
  v_md5 text;
  v_n   int;
begin
  select md5(p.prosrc), pg_get_functiondef(p.oid) into v_md5, v_def
    from pg_proc p where p.oid = 'public.notify_workshop_parts()'::regprocedure;
  if v_md5 is distinct from c_md5 then
    raise exception 'COM-2: notify_workshop_parts has changed since this draft was written (md5 %). Re-author against the live body.', v_md5;
  end if;
  v_n := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
  if v_n <> 1 then
    raise exception 'COM-2: expected exactly one notify_elevated_users call in notify_workshop_parts, found %', v_n;
  end if;
  execute replace(v_def, c_old, c_new);
end
$migration$;
