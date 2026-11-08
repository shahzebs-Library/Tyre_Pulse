-- ISO 9001 7.5 / 10.2 controls for checklists (owner request 2026-11-08:
-- "internal audit and external, any type should be able to make it and provide it").
--
-- 1. Document control on every checklist form: control number, revision,
--    effective date, owner, review cycle (12 months, owner choice), who approved
--    the published version and when, who last reviewed it.
--    The form approval is stamped by the server whenever a version is published,
--    so it cannot be typed in by hand.
-- 2. The three paper-controlled forms take their numbers from their own
--    description text (F-KSA-PPM-005/007/008). The other six get system numbers
--    TP-<prefix> (owner choice), editable later.
-- 3. Predictive Maintenance Checklist gets prefix PMC, and its 3 records get the
--    document numbers they never had.
-- 4. Three test drafts ("a", "Maint", "PMD", no records) are ARCHIVED, not deleted.
-- 5. A "Not OK" (any blocking legend mark) on a checklist raises a corrective
--    action (ISO 10.2). Existing faults are backfilled (owner choice "raise all
--    now"); new faults raise automatically. One action per sheet + item, never
--    re-raised once it exists (even if closed). Switch: system_config
--    'checklist_auto_corrective_actions' = 'false' turns the automatic part off.
--
-- Rollback: drop the trigger trg_checklist_fault_corrective_actions and the
-- trg_zz_stamp_checklist_form_approval trigger; corrective actions raised here
-- carry source_type 'checklist' and created_at today; archived drafts can be set
-- back to status 'draft'. The new columns are nullable and unread by older code.

-- ── 1. Document-control columns ──────────────────────────────────────────────
alter table public.checklist_templates
  add column if not exists form_ref text,
  add column if not exists form_revision text,
  add column if not exists form_effective_date date,
  add column if not exists form_owner text,
  add column if not exists review_interval_months integer not null default 12,
  add column if not exists form_approved_by uuid,
  add column if not exists form_approved_name text,
  add column if not exists form_approved_at timestamptz,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists last_reviewed_by uuid,
  add column if not exists last_reviewed_name text;

do $$ begin
  alter table public.checklist_templates
    add constraint checklist_templates_review_interval_chk check (review_interval_months between 1 and 60);
exception when duplicate_object then null; end $$;

-- Every published version is an approval of the form; the server records who.
create or replace function public.stamp_checklist_form_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.version is distinct from old.version) then
    select coalesce(nullif(btrim(full_name), ''), username, email) into v_name from public.profiles where id = auth.uid();
    if auth.uid() is not null then
      new.form_approved_by := auth.uid();
      new.form_approved_name := v_name;
      new.last_reviewed_by := auth.uid();
      new.last_reviewed_name := v_name;
    end if;
    new.form_approved_at := now();
    new.last_reviewed_at := now();
    new.form_effective_date := current_date;
    -- A system revision label follows the version; a paper label ("Rev 05") is kept.
    if new.form_revision is null or new.form_revision ~ '^v[0-9]+$' then
      new.form_revision := 'v' || new.version;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.stamp_checklist_form_approval() from public;
revoke all on function public.stamp_checklist_form_approval() from anon, authenticated;

create or replace trigger trg_zz_stamp_checklist_form_approval
  before insert or update on public.checklist_templates
  for each row execute function public.stamp_checklist_form_approval();

-- Record a periodic review that changed nothing (ISO: review AND approve).
create or replace function public.mark_checklist_form_reviewed(p_template_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_row public.checklist_templates;
begin
  if not (public.get_my_role() = any (array['Admin','Manager','Director','Maintenance Supervisor']) or public.is_super_admin()) then
    raise exception 'You do not have permission to review checklist forms' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(full_name), ''), username, email) into v_name from public.profiles where id = auth.uid();
  update public.checklist_templates
     set last_reviewed_at = now(), last_reviewed_by = auth.uid(), last_reviewed_name = v_name
   where id = p_template_id and organisation_id is not distinct from public.app_current_org()
  returning * into v_row;
  if not found then raise exception 'Checklist form not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'last_reviewed_at', v_row.last_reviewed_at, 'last_reviewed_name', v_row.last_reviewed_name);
end $$;
revoke all on function public.mark_checklist_form_reviewed(uuid) from public;
revoke all on function public.mark_checklist_form_reviewed(uuid) from anon;
grant execute on function public.mark_checklist_form_reviewed(uuid) to authenticated, service_role;

-- The immutable form snapshot (checklist_template_snapshot) is deliberately NOT
-- extended: adding keys makes every published version read as changed and the
-- revision guard refuses it. A record links to its exact template version, and
-- the form register carries that version's control number.

-- ── 2. Backfill the form register ────────────────────────────────────────────
-- Run as the migration role: auth.uid() is null, so the stamp trigger leaves the
-- approver alone and the backfill below supplies it from the revision history.
update public.checklist_templates t
   set form_ref = coalesce(t.form_ref,
         substring(t.description from 'F-[A-Z]{2,4}-[A-Z]{2,5}-[0-9]{3}'),
         case when t.doc_prefix is not null then 'TP-' || t.doc_prefix end),
       form_revision = coalesce(t.form_revision,
         substring(t.description from 'Rev [0-9]+'),
         'v' || t.version),
       form_owner = coalesce(t.form_owner, 'Maintenance Department'),
       form_effective_date = coalesce(t.form_effective_date, r.captured_at::date, t.updated_at::date),
       form_approved_by = coalesce(t.form_approved_by, r.captured_by),
       form_approved_name = coalesce(t.form_approved_name, p.nm),
       form_approved_at = coalesce(t.form_approved_at, r.captured_at),
       last_reviewed_at = coalesce(t.last_reviewed_at, r.captured_at),
       last_reviewed_by = coalesce(t.last_reviewed_by, r.captured_by),
       last_reviewed_name = coalesce(t.last_reviewed_name, p.nm)
  from public.checklist_templates t0
  left join lateral (
    select rr.captured_at, rr.captured_by from public.checklist_template_revisions rr
     where rr.template_id = t0.id order by rr.version desc limit 1) r on true
  left join lateral (
    select coalesce(nullif(btrim(pp.full_name), ''), pp.username, pp.email) nm
      from public.profiles pp where pp.id = r.captured_by) p on true
 where t.id = t0.id and t.status = 'published';

-- ── 3. Predictive Maintenance: prefix + document numbers ─────────────────────
update public.checklist_templates set doc_prefix = 'PMC'
 where name = 'Predictive Maintenance Checklist' and status = 'published' and doc_prefix is null;
update public.checklist_templates set form_ref = 'TP-PMC'
 where name = 'Predictive Maintenance Checklist' and status = 'published' and form_ref is null;

do $$
declare r record;
begin
  for r in
    select s.id, s.organisation_id, s.asset_no, s.submitted_at
      from public.checklist_submissions s
      join public.checklist_templates t on t.id = s.template_id
     where t.doc_prefix = 'PMC' and coalesce(btrim(s.document_no), '') = ''
     order by coalesce(s.submitted_at, s.created_at), s.id
  loop
    update public.checklist_submissions
       set document_no = public.next_checklist_document_no(
             r.organisation_id, 'PMC', r.asset_no, extract(year from coalesce(r.submitted_at, now()))::int)
     where id = r.id;
  end loop;
end $$;

-- ── 4. Archive the test drafts (no records, nothing deleted) ─────────────────
update public.checklist_templates t set status = 'archived'
 where t.status = 'draft' and t.name in ('a', 'Maint', 'PMD')
   and not exists (select 1 from public.checklist_submissions s where s.template_id = t.id);

-- ── 5. Faults raise corrective actions ───────────────────────────────────────
create or replace function public.checklist_field_label(p_fields jsonb, p_key text)
returns text language sql immutable set search_path to '' as $$
  select coalesce(
    (select nullif(btrim(f->>'label'), '') from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) f
      where f->>'id' = p_key limit 1),
    p_key);
$$;

-- Raises one action per blocking answer that has none yet. Returns the count.
create or replace function public._raise_checklist_corrective_actions(p_submission_id uuid, p_dry_run boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.checklist_submissions;
  v_blocking jsonb; v_fields jsonb; v_tname text;
  a record; v_label text; v_n integer := 0;
begin
  select * into s from public.checklist_submissions where id = p_submission_id;
  if not found then return 0; end if;
  select t.option_sets #> '{legend,blocking}', coalesce(s.template_snapshot->'fields', t.fields), t.name
    into v_blocking, v_fields, v_tname
    from public.checklist_templates t where t.id = s.template_id;
  if v_blocking is null or jsonb_typeof(v_blocking) <> 'array' then return 0; end if;

  for a in select key, value from jsonb_each_text(coalesce(s.answers, '{}'::jsonb))
            where jsonb_exists(v_blocking, value) loop
    v_label := public.checklist_field_label(v_fields, a.key);
    continue when exists (
      select 1 from public.corrective_actions c
       where c.source_type = 'checklist' and c.source_id = s.id and c.source_detail = v_label);
    v_n := v_n + 1;
    if not p_dry_run then
      insert into public.corrective_actions
        (organisation_id, title, description, priority, status, site, asset_no, country, region,
         source_type, source_id, source_detail, created_by)
      values
        (s.organisation_id,
         left('Checklist fault: ' || v_label || ' (' || coalesce(s.document_no, v_tname, 'checklist') || ')', 240),
         'Recorded "' || a.value || '" on ' || coalesce(v_tname, 'a checklist')
           || coalesce(' ' || s.document_no, '')
           || coalesce(' for asset ' || s.asset_no, '')
           || ' on ' || to_char(coalesce(s.submitted_at, s.created_at), 'YYYY-MM-DD') || '.',
         'High', 'Open', s.site, s.asset_no, coalesce(s.country, 'KSA'), coalesce(s.country, 'KSA'),
         'checklist', s.id, v_label, s.submitted_by);
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public._raise_checklist_corrective_actions(uuid, boolean) from public;
revoke all on function public._raise_checklist_corrective_actions(uuid, boolean) from anon, authenticated;

-- Public entry point (audit pack button). Org-scoped; dry run by default.
create or replace function public.raise_checklist_corrective_actions(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0; v_sheets integer := 0; v_k integer;
begin
  if not (public.app_is_elevated() or public.checklist_is_supervisor()) then
    raise exception 'You do not have permission to raise corrective actions' using errcode = '42501';
  end if;
  for r in select s.id from public.checklist_submissions s
            where s.organisation_id is not distinct from public.app_current_org()
              and (s.country is null or public.app_can_see_country(s.country) is not false)
  loop
    v_k := public._raise_checklist_corrective_actions(r.id, p_dry_run);
    if v_k > 0 then v_n := v_n + v_k; v_sheets := v_sheets + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'actions', v_n, 'checklists', v_sheets);
end $$;
revoke all on function public.raise_checklist_corrective_actions(boolean) from public;
revoke all on function public.raise_checklist_corrective_actions(boolean) from anon;
grant execute on function public.raise_checklist_corrective_actions(boolean) to authenticated, service_role;

-- Automatic for new faults. Never blocks the submission.
create or replace function public.checklist_fault_corrective_actions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select value::text from public.system_config where key = 'checklist_auto_corrective_actions'), 'true')
     ilike '%false%' then
    return null;
  end if;
  begin
    perform public._raise_checklist_corrective_actions(new.id, false);
  exception when others then
    insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
    values (new.organisation_id, 'checklists', 'error', 'checklist_fault_corrective_actions',
            'Could not raise corrective actions for a checklist fault', jsonb_build_object('submission_id', new.id, 'error', sqlerrm));
  end;
  return null;
end $$;
revoke all on function public.checklist_fault_corrective_actions() from public;
revoke all on function public.checklist_fault_corrective_actions() from anon, authenticated;

create or replace trigger trg_checklist_fault_corrective_actions
  after insert or update of answers on public.checklist_submissions
  for each row execute function public.checklist_fault_corrective_actions();

-- Backfill: every existing fault gets its action (owner choice "raise all now").
do $$
declare r record;
begin
  for r in select id from public.checklist_submissions loop
    perform public._raise_checklist_corrective_actions(r.id, false);
  end loop;
end $$;
