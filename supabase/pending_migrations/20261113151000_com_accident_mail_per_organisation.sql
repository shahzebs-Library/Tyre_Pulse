-- COM-1 (audit MODC-01): accident e-mail routing is per organisation.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions of
--         consume_event_accident_notify and consume_event_accident_case_notify
--         (pg_get_functiondef, project jhssdmeruxtrlqnwfksc, SELECT only). Not applied to any
--         database. Tested on PGlite only (supabase/tests/commercial_notifications.test.mjs).
--         REQUIRES 20261113150000_com_organisation_settings_foundation.sql first.
--
-- ROOT CAUSE
--   Both accident event consumers read four GLOBAL rows of public.system_config
--   (accident_emails_enabled, accident_email_to, accident_email_cc,
--   accident_email_subject_prefix). system_config has no organisation column, so an accident
--   filed by ANY organisation is e-mailed to the one mailbox list the current company entered.
--   Verified live 2026-11-12: accident_emails_enabled is on, accident_email_to holds a value,
--   and 2 of 44 accident rows already belong to another organisation.
--   Second defect in the case consumer: when the event carries no organisation it notified the
--   Admin, Manager and Director users of EVERY organisation in the app
--   ("v_org IS NULL OR ..."). Live today every accident event carries an organisation
--   (82 of 82), so this arm is latent.
--
-- WHAT THIS CHANGES
--   1. New internal reader public.accident_mail_config(org) with three outcomes:
--        organisation  : the company has its own 'accident_mail' row in organisation_settings
--                        ({"enabled": true, "to": "...", "cc": "...", "subject_prefix": "..."});
--        legacy_global : the company is the one named in
--                        system_config.legacy_settings_owner_org; the four global rows are
--                        returned UNCHANGED, raw, exactly as the consumers read them today;
--        none          : any other company. E-mail is off and there are no recipients.
--   2. The two consumers are rewritten IN PLACE from their live text: only the four
--      system_config reads are swapped for the reader, the case consumer takes the organisation
--      from the accident when the event has none, and its "no organisation means everyone" arm
--      is removed. Every swap must match the live text exactly once or the migration aborts and
--      nothing changes. The md5 of each live body is checked first, so a body that has moved on
--      since 2026-11-12 is refused instead of being overwritten.
--
-- RISK TO THE CURRENT COMPANY: LOW, and none expected in delivery.
--   The current company is the legacy owner, so it keeps reading the same four global rows the
--   Accident Workflow "Email Delivery" tab writes today: same switch, same To and CC, same
--   prefix, same parsing (the consumers' own parsing code is untouched). The PGlite test proves
--   the queued e-mail payload for the current company is identical before and after.
--   What changes for it: accidents of OTHER organisations stop arriving in its mailbox (today
--   2 such accident rows exist). In-app notifications are unchanged for events that carry an
--   organisation (all of them today).
--   Follow-up needed in the web app (not in this migration): the Email Delivery tab should
--   read and write the company's own 'accident_mail' setting; until then a second company
--   cannot turn accident e-mail on from the screen (it is off for them, which is the safe side).
--
-- VERIFY (after applying; read only)
--   select * from public.accident_mail_config('00000000-0000-0000-0000-000000000001');
--     -- source = legacy_global, the four values equal the system_config rows
--   select source, emails_enabled from public.accident_mail_config(gen_random_uuid());
--     -- none, false
--   select position('system_config' in pg_get_functiondef('public.consume_event_accident_notify(domain_events)'::regprocedure)) = 0;
--   select position('system_config' in pg_get_functiondef('public.consume_event_accident_case_notify(domain_events)'::regprocedure)) = 0;
--     -- both true
--   select has_function_privilege('authenticated','public.accident_mail_config(uuid)','EXECUTE'); -- f
--
-- ROLLBACK
--   Re-create the two consumers from supabase/tests/fixtures/commercial_live_functions.sql
--   (faithful copies of the bodies this migration starts from, md5 checked by the test), then
--   remove public.accident_mail_config(uuid).

create or replace function public.accident_mail_config(p_org uuid)
returns table (source text, emails_enabled text, email_to text, email_cc text, subject_prefix text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if p_org is null then
    return query select 'none'::text, 'false'::text, null::text, null::text, null::text;
    return;
  end if;

  v := public.org_setting(p_org, 'accident_mail');
  if v is not null and jsonb_typeof(v) = 'object' then
    return query select 'organisation'::text,
                        coalesce(v ->> 'enabled', 'false'),
                        v ->> 'to', v ->> 'cc', v ->> 'subject_prefix';
    return;
  end if;

  if p_org = public.legacy_settings_owner_org() then
    -- The raw global rows, exactly as the consumers read them before this migration.
    return query select 'legacy_global'::text,
      (select value from public.system_config where key = 'accident_emails_enabled'),
      (select value from public.system_config where key = 'accident_email_to'),
      (select value from public.system_config where key = 'accident_email_cc'),
      (select value from public.system_config where key = 'accident_email_subject_prefix');
    return;
  end if;

  return query select 'none'::text, 'false'::text, null::text, null::text, null::text;
end
$function$;

revoke all on function public.accident_mail_config(uuid) from public, anon, authenticated;
grant execute on function public.accident_mail_config(uuid) to service_role;

do $migration$
declare
  -- md5(prosrc) of the live bodies this draft was written against (2026-11-12).
  c_md5_notify constant text := '96ddb24abd8a2dec2865abeecd14997a';
  c_md5_case   constant text := '918402c927bebf8b100eb3413625b259';
  v_def  text;
  v_md5  text;
  v_pair text[];
  v_n    int;
  v_notify text[][] := array[
    array[$a$(SELECT value FROM public.system_config WHERE key='accident_emails_enabled')$a$,
          $b$(SELECT m.emails_enabled FROM public.accident_mail_config(acc.organisation_id) m)$b$],
    array[$a$(SELECT value FROM public.system_config WHERE key='accident_email_to')$a$,
          $b$(SELECT m.email_to FROM public.accident_mail_config(acc.organisation_id) m)$b$],
    array[$a$(SELECT value FROM public.system_config WHERE key='accident_email_cc')$a$,
          $b$(SELECT m.email_cc FROM public.accident_mail_config(acc.organisation_id) m)$b$],
    array[$a$(SELECT value FROM public.system_config WHERE key='accident_email_subject_prefix')$a$,
          $b$(SELECT m.subject_prefix FROM public.accident_mail_config(acc.organisation_id) m)$b$]
  ];
  v_case text[][] := array[
    array[$a$BEGIN
  IF v_accident IS NOT NULL THEN
    SELECT COALESCE(NULLIF(a.reference_no, ''), NULLIF(a.case_no, ''), 'Case'),$a$,
          $b$BEGIN
  -- COM-1: an event without an organisation takes it from its accident.
  IF v_org IS NULL AND v_accident IS NOT NULL THEN
    SELECT a.organisation_id INTO v_org FROM public.accidents a WHERE a.id = v_accident;
  END IF;
  IF v_accident IS NOT NULL THEN
    SELECT COALESCE(NULLIF(a.reference_no, ''), NULLIF(a.case_no, ''), 'Case'),$b$],
    array[$a$AND (v_org IS NULL OR p.organisation_id = v_org OR p.org_id = v_org)$a$,
          $b$AND (p.organisation_id = v_org OR p.org_id = v_org)$b$],
    array[$a$SELECT value INTO v_gate FROM public.system_config WHERE key = 'accident_emails_enabled';$a$,
          $b$SELECT m.emails_enabled INTO v_gate FROM public.accident_mail_config(v_org) m;$b$],
    array[$a$SELECT value INTO v_to_raw     FROM public.system_config WHERE key = 'accident_email_to';$a$,
          $b$SELECT m.email_to INTO v_to_raw FROM public.accident_mail_config(v_org) m;$b$],
    array[$a$SELECT value INTO v_cc_raw     FROM public.system_config WHERE key = 'accident_email_cc';$a$,
          $b$SELECT m.email_cc INTO v_cc_raw FROM public.accident_mail_config(v_org) m;$b$],
    array[$a$SELECT value INTO v_prefix     FROM public.system_config WHERE key = 'accident_email_subject_prefix';$a$,
          $b$SELECT m.subject_prefix INTO v_prefix FROM public.accident_mail_config(v_org) m;$b$]
  ];
begin
  -- ── consume_event_accident_notify ────────────────────────────────────────
  select md5(p.prosrc), pg_get_functiondef(p.oid) into v_md5, v_def
    from pg_proc p
   where p.oid = 'public.consume_event_accident_notify(public.domain_events)'::regprocedure;
  if v_md5 is distinct from c_md5_notify then
    raise exception 'COM-1: consume_event_accident_notify has changed since this draft was written (md5 %). Re-author against the live body.', v_md5;
  end if;
  foreach v_pair slice 1 in array v_notify loop
    v_n := (length(v_def) - length(replace(v_def, v_pair[1], ''))) / length(v_pair[1]);
    if v_n <> 1 then
      raise exception 'COM-1: expected exactly one match in consume_event_accident_notify for [%], found %', v_pair[1], v_n;
    end if;
    v_def := replace(v_def, v_pair[1], v_pair[2]);
  end loop;
  if position('system_config' in v_def) > 0 then
    raise exception 'COM-1: consume_event_accident_notify still reads system_config after the rewrite';
  end if;
  execute v_def;

  -- ── consume_event_accident_case_notify ───────────────────────────────────
  select md5(p.prosrc), pg_get_functiondef(p.oid) into v_md5, v_def
    from pg_proc p
   where p.oid = 'public.consume_event_accident_case_notify(public.domain_events)'::regprocedure;
  if v_md5 is distinct from c_md5_case then
    raise exception 'COM-1: consume_event_accident_case_notify has changed since this draft was written (md5 %). Re-author against the live body.', v_md5;
  end if;
  foreach v_pair slice 1 in array v_case loop
    v_n := (length(v_def) - length(replace(v_def, v_pair[1], ''))) / length(v_pair[1]);
    if v_n <> 1 then
      raise exception 'COM-1: expected exactly one match in consume_event_accident_case_notify for [%], found %', v_pair[1], v_n;
    end if;
    v_def := replace(v_def, v_pair[1], v_pair[2]);
  end loop;
  if position('system_config' in v_def) > 0 then
    raise exception 'COM-1: consume_event_accident_case_notify still reads system_config after the rewrite';
  end if;
  execute v_def;
end
$migration$;
