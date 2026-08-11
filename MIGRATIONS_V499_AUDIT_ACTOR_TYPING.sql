-- MIGRATIONS_V499_AUDIT_ACTOR_TYPING.sql
-- STATUS: APPLIED LIVE 2026-08-10, both paths verified (rolled back).
--
-- WHY
-- The audit module exists to answer "who did this", and for 97% of its rows it
-- could not. MEASURED: 485,231 of 499,217 rows carry user_id IS NULL, and the
-- bulk is one table - work_orders, 440,257 of 441,632 - written by ERP imports,
-- cron jobs and other service-role paths where auth.uid() is NULL.
--
-- THE REAL DEFECT IS NOT THE MISSING HUMAN. Many of those writes legitimately
-- have none. It is that the trail stored "an automated import changed this" and
-- "an unknown person changed this" IDENTICALLY, as a blank. Those are opposite
-- statements to anyone investigating an incident, and collapsing them is what
-- made the module unable to answer its own question - a genuinely suspicious
-- write was buried among 440,000 routine import rows that looked the same.
--
-- So the trigger now records WHAT acted when there is no WHO:
--   'user'    - a real signed-in account (auth.uid() present); unchanged
--   'service' - service-role / superuser connection: an import, a cron job, a
--               migration. Named as a machine, with the connection role and any
--               label the caller set via `set_config('app.actor_label', ...)`.
--   'unknown' - an authenticated connection with no resolvable identity. THIS is
--               the row that should worry someone, and it is now visible.
-- `user_email` is also filled with that label, because it is what the audit
-- viewer prints - a blank there reads as a missing person.
--
-- NO BACKFILL, DELIBERATELY, FOR TWO REASONS:
--   1. Stamping 485,231 rows rewrites a 546 MB table for no new information.
--   2. More importantly it would ASSERT a provenance nobody measured. Those rows
--      genuinely do not record whether a person or a job wrote them. A NULL
--      actor_type therefore means "written before attribution existed", and the
--      reader renders exactly that ("Not recorded (before audit attribution)").
--      Inventing an actor is the dishonesty this migration exists to remove.
--
-- The client half is `auditActor()` in src/lib/api/auditTrail.js, which turns
-- each case into plain English for the console viewer.
--
-- VERIFIED LIVE (rolled back):
--   service path -> actor_type 'service', actor_detail 'postgres / ERP import',
--                   user_email 'ERP import'
--   user path    -> actor_type 'user', user_email 'zebkhan311@gmail.com'
--
-- The trigger keeps its EXCEPTION-swallowing tail on purpose: auditing must
-- never block the business write it is recording.
--
-- ROLLBACK: restore the previous body of trg_audit_row_change (identical minus
-- the actor block and the two extra INSERT columns); the added columns are
-- additive and can stay.

alter table public.audit_log_v2
  add column if not exists actor_type   text,
  add column if not exists actor_detail text;

create index if not exists idx_audit_log_v2_actor_type
  on public.audit_log_v2 (actor_type) where actor_type is not null;

create or replace function public.trg_audit_row_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    -- No signed-in identity. Say which kind of no-identity this is.
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

  v_org := NULLIF(COALESCE(v_new ->> 'organisation_id', v_old ->> 'organisation_id'), '')::uuid;
  v_rid := COALESCE(v_new ->> 'id', v_old ->> 'id');

  INSERT INTO public.audit_log_v2
    (user_id, user_email, user_role, org_id, action, table_name, record_id,
     old_values, new_values, actor_type, actor_detail)
  VALUES
    (v_uid, v_email, v_role, v_org,
     'db.' || lower(TG_OP), TG_TABLE_NAME, v_rid, v_diff_old, v_diff_new,
     v_actor, v_detail);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Auditing must never block the business write it is recording.
  RETURN NULL;
END;
$function$;

-- HOW TO NAME AN IMPORT: any server-side path may label itself with
--   select set_config('app.actor_label', 'ERP import', true);
-- before its writes, and every audit row in that transaction is then stamped
-- "System (postgres / ERP import)" instead of a bare connection role.
--
-- STILL OPEN: the audit trigger covers 16 of 351 tables. Widening it is a
-- separate decision - it is 71% of the insert cost on work_orders already, so
-- adding tables trades write throughput for coverage and needs the owner's call.
