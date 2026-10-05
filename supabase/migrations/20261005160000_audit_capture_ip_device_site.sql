-- Audit Trail: record IP, device and site on every audit row from now on.
--
-- Measured before writing: audit_log_v2 already HAS ip_address, user_agent and
-- site columns, and 0 of 547,184 rows carry any of them. Nothing ever filled
-- them, which is why the Audit Trail could not show the IP / Device column the
-- owner's mockup asks for.
--
-- 1. BEFORE INSERT trigger on audit_log_v2 stamps ip_address + user_agent from
--    the PostgREST request headers when the writer left them blank. One place,
--    so every writer is covered: the row-change trigger, the client logger
--    (LOGIN / LOGOUT / EXPORT) and DEFINER RPCs. Bulk imports run without
--    request headers, so they stay NULL (honest: there is no browser).
-- 2. trg_audit_row_change now also records the business row's site (from the
--    FULL row, not the diff, so an update that did not change site still names
--    it). Country is DELIBERATELY NOT stamped: audit_log_v2 carries a country
--    isolation policy, and stamping country hides history from country-scoped
--    admins. That is the open V579 owner decision; this migration does not take it.
--    There is no site isolation policy on audit_log_v2, so stamping site hides
--    nothing.
-- Both are fail-open: any error leaves the field NULL and never blocks a write.
--
-- Rollback: drop trigger trg_audit_stamp_request on audit_log_v2; drop function
-- audit_stamp_request(); re-create trg_audit_row_change without the site column.

create or replace function public.audit_stamp_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare h json;
begin
  begin
    if new.ip_address is null then
      new.ip_address := public._request_client_ip();
    end if;
    if new.user_agent is null then
      h := nullif(current_setting('request.headers', true), '')::json;
      if h is not null then
        new.user_agent := left(nullif(btrim(h->>'user-agent'), ''), 400);
      end if;
    end if;
  exception when others then
    null; -- never block an audit write over request metadata
  end;
  return new;
end $$;

revoke all on function public.audit_stamp_request() from public, anon, authenticated;

-- (no drop: the trigger is new; a DROP statement waits on MCP approval and times out)
create trigger trg_audit_stamp_request
  before insert on public.audit_log_v2
  for each row execute function public.audit_stamp_request();

CREATE OR REPLACE FUNCTION public.trg_audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old   jsonb;
  v_new   jsonb;
  v_diff_old jsonb;
  v_diff_new jsonb;
  v_email text;
  v_role  text;
  v_org   uuid;
  v_rid   text;
  v_uid   uuid;
  v_actor text;
  v_detail text;
  v_label text;
  v_site  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(o.key, o.value), '{}'::jsonb),
           COALESCE(jsonb_object_agg(o.key, v_new -> o.key), '{}'::jsonb)
      INTO v_diff_old, v_diff_new
      FROM jsonb_each(v_old) o
     WHERE v_new -> o.key IS DISTINCT FROM o.value;
    IF v_diff_old = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    v_diff_old := v_old;
    v_diff_new := v_new;
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT email, role INTO v_email, v_role FROM public.profiles WHERE id = v_uid;
    v_actor  := 'user';
    v_detail := NULL;
  ELSE
    v_label := NULLIF(btrim(coalesce(current_setting('app.actor_label', true), '')), '');
    IF current_user IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
      v_actor := 'service';
    ELSE
      v_actor := 'unknown';
    END IF;
    v_detail := current_user || coalesce(' / ' || v_label, '');
    v_email := coalesce(v_label, v_actor || ':' || current_user);
    v_role  := NULL;
  END IF;

  v_org  := NULLIF(COALESCE(v_new ->> 'organisation_id', v_old ->> 'organisation_id'), '')::uuid;
  v_rid  := COALESCE(v_new ->> 'id', v_old ->> 'id');
  v_site := NULLIF(btrim(COALESCE(v_new ->> 'site', v_old ->> 'site', '')), '');

  INSERT INTO public.audit_log_v2
    (user_id, user_email, user_role, org_id, action, table_name, record_id,
     old_values, new_values, actor_type, actor_detail, site)
  VALUES
    (v_uid, v_email, v_role, v_org,
     'db.' || lower(TG_OP), TG_TABLE_NAME, v_rid, v_diff_old, v_diff_new,
     v_actor, v_detail, v_site);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
