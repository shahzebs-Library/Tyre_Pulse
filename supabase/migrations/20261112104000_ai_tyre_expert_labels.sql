-- 20261112104000_ai_tyre_expert_labels
-- STATUS: APPLIED LIVE 2026-11-10 (owner go-ahead) via Supabase MCP apply_migration.
--
-- WHY: the 500-photo accuracy benchmark (src/lib/aiTyreAccuracy.js, scripts/ai-accuracy.mjs) needs
-- EXPERT ground truth per photograph. Today review is accept/reject of a whole AI job through the
-- edge function (880 of 883 jobs unreviewed), which cannot say WHICH defect was right, what the AI
-- missed, or whether the photo was assessable at all. This table holds per-photo expert labels.
--
-- WHAT:
--   * public.ai_tyre_expert_labels: one row per (job, reviewer). Two reviewers may label the same
--     photograph independently (unique job_id + reviewer_id), so inter-reviewer agreement can be
--     measured. Holds the per-AI-defect verdict (correct / wrong / wrong type + corrected type),
--     defects the AI missed, the resulting expected defect list, assessable yes/no, the inspector's
--     own recorded condition for that position (snapshot) and the tyre serial.
--   * inspection_id, photo_ref, tyre_position, model_version, prompt_version, organisation_id are
--     COPIED FROM THE JOB by a trigger; the browser cannot point a label at another photo/tenant.
--   * split (train / validation / holdout) is assigned DETERMINISTICALLY from the group key:
--     the tyre serial (upper/trimmed) when known, else 'insp:'||inspection_id. One physical tyre
--     (or one inspection when the serial is blank) therefore never crosses splits. FNV-1a 32-bit
--     over the UTF-8 key, bucket = hash % 100: <60 train, <80 validation, else holdout.
--     Parity checked read-only against live Postgres 2026-11-10 (ABC123 -> 1166364645, 45, train).
--     JS MIRROR: src/lib/aiTyreExpertLabels.js (splitForGroup / groupKeyFor). Change BOTH; the test
--     pins known values.
--   * The original photograph is never touched; no tread depth is stored or derived here.
--   * Labels are EVALUATION DATA only. Nothing here changes ai_tyre_inspection_jobs.review_status
--     and nothing trains or tunes a model.
--
-- SECURITY: RLS on. RESTRICTIVE org isolation. Read + write limited to the AI review roles
-- (MIRROR of AI_REVIEW_ROLES in src/lib/aiTyreInspectionRoles.js: admin, manager, director,
-- maintenance supervisor) or super admin. A reviewer may only insert/update/delete their OWN row
-- (reviewer_id = auth.uid(), stamped by the trigger). No anon access.
--
-- VERIFY (after apply, read-only):
--   select count(*) from public.ai_tyre_expert_labels;                                   -- 0
--   select public.ai_tyre_split_for('ABC123'), public.ai_tyre_split_for('insp:00000000-0000-0000-0000-000000000001');
--     -- must equal splitForGroup('ABC123') / splitForGroup('insp:0000...0001') in the JS test
--   select relrowsecurity from pg_class where oid='public.ai_tyre_expert_labels'::regclass; -- t
--   select has_table_privilege('anon','public.ai_tyre_expert_labels','select');           -- f
--   Rolled-back insert as a real Manager on a real completed job: row lands with the job's
--   photo_ref/inspection_id/org, reviewer_id = the Manager, split filled. As a Tyre Man: refused.
--
-- ROLLBACK:
--   drop table if exists public.ai_tyre_expert_labels;
--   drop function if exists public.ai_tyre_expert_label_stamp();
--   drop function if exists public.ai_tyre_split_for(text);
--   drop function if exists public.ai_tyre_fnv1a(text);

begin;

-- FNV-1a 32-bit over the UTF-8 bytes. Pure and immutable so a split never changes.
create or replace function public.ai_tyre_fnv1a(p text)
returns bigint language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  b bytea := convert_to(p, 'UTF8');
  h bigint := 2166136261;
  i int;
begin
  for i in 0 .. length(b) - 1 loop
    h := (h # get_byte(b, i)) & 4294967295;
    h := (h * 16777619) & 4294967295;
  end loop;
  return h;
end $$;

create or replace function public.ai_tyre_split_for(p_group text)
returns text language sql immutable strict
set search_path = pg_catalog, public
as $$
  select case when public.ai_tyre_fnv1a(p_group) % 100 < 60 then 'train'
              when public.ai_tyre_fnv1a(p_group) % 100 < 80 then 'validation'
              else 'holdout' end
$$;

create table if not exists public.ai_tyre_expert_labels (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  job_id uuid not null references public.ai_tyre_inspection_jobs(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  tyre_position text not null check (length(tyre_position) between 1 and 80),
  photo_ref text not null check (length(photo_ref) between 1 and 2048),
  model_version text,
  prompt_version text,
  reviewer_id uuid not null,
  assessable boolean not null,
  -- [{index:int, type:text, verdict:'correct'|'wrong'|'wrong_type', corrected_type:text|null}]
  ai_defect_verdicts jsonb not null default '[]'::jsonb check (jsonb_typeof(ai_defect_verdicts) = 'array'),
  missed_defects text[] not null default '{}',
  expected_defects text[] not null default '{}',
  inspector_condition text check (inspector_condition is null or length(inspector_condition) <= 80),
  tyre_serial text check (tyre_serial is null or length(tyre_serial) <= 80),
  group_key text not null,
  split text not null check (split in ('train', 'validation', 'holdout')),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_tyre_expert_labels_types_ok check (
    expected_defects <@ array['uneven_wear','shoulder_wear','center_wear','tread_wear','sidewall_cut',
      'tread_cut','cracking','bulge','exposed_cord','suspected_separation','embedded_object',
      'puncture_evidence','other_visible_damage','uncertain']::text[]
    and missed_defects <@ array['uneven_wear','shoulder_wear','center_wear','tread_wear','sidewall_cut',
      'tread_cut','cracking','bulge','exposed_cord','suspected_separation','embedded_object',
      'puncture_evidence','other_visible_damage','uncertain']::text[]),
  -- An unassessable photo carries no expected defects (the accuracy engine ignores them anyway).
  constraint ai_tyre_expert_labels_unassessable_empty check (assessable or cardinality(expected_defects) = 0),
  constraint ai_tyre_expert_labels_one_per_reviewer unique (job_id, reviewer_id)
);
create index if not exists ai_tyre_expert_labels_org_idx on public.ai_tyre_expert_labels (organisation_id, created_at desc);
create index if not exists ai_tyre_expert_labels_job_idx on public.ai_tyre_expert_labels (job_id);
create index if not exists ai_tyre_expert_labels_inspection_idx on public.ai_tyre_expert_labels (inspection_id);

-- Copies every provenance field from the job, stamps the reviewer, derives group key + split.
create or replace function public.ai_tyre_expert_label_stamp()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare j record; v_serial text;
begin
  select organisation_id, inspection_id, tyre_position, photo_ref, model_version, prompt_version, status
    into j from public.ai_tyre_inspection_jobs where id = new.job_id;
  if not found then raise exception 'AI job not found' using errcode = '23503'; end if;
  if j.status <> 'completed' then raise exception 'Only completed AI analyses can be labelled' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    raise exception 'A label cannot be moved to another photograph' using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.reviewer_id := auth.uid();
    elsif new.reviewer_id is distinct from old.reviewer_id then
      raise exception 'The reviewer of a label cannot be changed' using errcode = '42501';
    end if;
    if not public.is_super_admin() and j.organisation_id is distinct from public.app_current_org() then
      raise exception 'AI job belongs to another organisation' using errcode = '42501';
    end if;
  end if;
  new.organisation_id := j.organisation_id;
  new.inspection_id := j.inspection_id;
  new.tyre_position := j.tyre_position;
  new.photo_ref := j.photo_ref;
  new.model_version := j.model_version;
  new.prompt_version := j.prompt_version;
  v_serial := nullif(upper(btrim(coalesce(new.tyre_serial, ''), E' \t\r\n')), '');
  new.tyre_serial := v_serial;
  new.group_key := coalesce(v_serial, 'insp:' || j.inspection_id::text);
  new.split := public.ai_tyre_split_for(new.group_key);
  if not new.assessable then new.expected_defects := '{}'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.ai_tyre_expert_label_stamp() from public, anon, authenticated;

drop trigger if exists ai_tyre_expert_label_stamp on public.ai_tyre_expert_labels;
create trigger ai_tyre_expert_label_stamp before insert or update on public.ai_tyre_expert_labels
  for each row execute function public.ai_tyre_expert_label_stamp();

alter table public.ai_tyre_expert_labels enable row level security;
revoke all on public.ai_tyre_expert_labels from public, anon, authenticated;
grant select, insert, update, delete on public.ai_tyre_expert_labels to authenticated;

drop policy if exists ai_tyre_expert_labels_org_isolation on public.ai_tyre_expert_labels;
create policy ai_tyre_expert_labels_org_isolation on public.ai_tyre_expert_labels
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists ai_tyre_expert_labels_reviewer_read on public.ai_tyre_expert_labels;
create policy ai_tyre_expert_labels_reviewer_read on public.ai_tyre_expert_labels
  for select to authenticated
  using ((select public.is_super_admin())
    or ((select public.app_is_active())
        and lower(coalesce((select public.get_my_role()), '')) in ('admin','manager','director','maintenance supervisor')));

drop policy if exists ai_tyre_expert_labels_reviewer_insert on public.ai_tyre_expert_labels;
create policy ai_tyre_expert_labels_reviewer_insert on public.ai_tyre_expert_labels
  for insert to authenticated
  with check (reviewer_id = (select auth.uid())
    and ((select public.is_super_admin())
      or ((select public.app_is_active())
          and lower(coalesce((select public.get_my_role()), '')) in ('admin','manager','director','maintenance supervisor'))));

drop policy if exists ai_tyre_expert_labels_own_update on public.ai_tyre_expert_labels;
create policy ai_tyre_expert_labels_own_update on public.ai_tyre_expert_labels
  for update to authenticated
  using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid())
    and ((select public.is_super_admin())
      or ((select public.app_is_active())
          and lower(coalesce((select public.get_my_role()), '')) in ('admin','manager','director','maintenance supervisor'))));

drop policy if exists ai_tyre_expert_labels_own_delete on public.ai_tyre_expert_labels;
create policy ai_tyre_expert_labels_own_delete on public.ai_tyre_expert_labels
  for delete to authenticated
  using (reviewer_id = (select auth.uid()) or (select public.is_super_admin()));

commit;

-- RULE (20261111102000): any migration that creates a table ends with the reader-policy refresh.
-- Guarded: a database built from this repository does not have the anum_integration schema.
do $$
begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;
