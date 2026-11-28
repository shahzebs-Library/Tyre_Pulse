-- Wash records: supervisor verification + next wash due.
--
-- STATUS: APPLIED LIVE 2026-11-27 (owner OK) as wash_supervisor_verification.
--         Verified: not_required 264 / pending 11; anon cannot execute
--         verify_wash_record; rolled-back tests: driver refused, driver direct
--         update changed nothing, Fleet Supervisor verified a driver's wash.
--
-- Owner rules
--   * Admin, Manager, Director, Fleet Supervisor, Maintenance Supervisor and
--     Workshop Supervisor may verify a wash.
--   * The person who logged a wash can never verify it.
--   * When one of those roles logs the wash themselves it needs no
--     verification: verification_status = 'not_required', verified_by =
--     the creator, verified_at = now(), note 'auto (supervisor entry)'. It is
--     never left waiting.
--   * The next wash is due one week after the wash (existing 7-day interval):
--     next_wash_due = wash_date + 7, a stored generated column.
--
-- Design
--   * Verification is set ONLY by the trigger on INSERT (pending or
--     not_required, from the creator's own profile role, never from the
--     client) and by the SECURITY DEFINER RPC verify_wash_record. A guard
--     trigger refuses any other change to the four verification columns, so
--     neither a driver nor a direct table UPDATE can forge it.
--   * The RPC stamps the verifier and server time itself, checks role, org,
--     site and country scope, refuses the creator (four eyes), refuses an
--     already-decided record, and needs before AND after photo evidence when
--     the record carries photo_evidence (records saved before the evidence
--     rule have none and are judged on what they have).
--   * The trigger is named zz_ so it runs after wash_attribution, which is
--     what fixes created_by to the signed-in user.
--   * next_wash_due is excluded from audit_wash_changes (it lists its keys
--     explicitly), and the offline queue never sends it.
--   * Backfill: existing rows logged by a supervisor role -> not_required,
--     the rest -> pending (measured live 2026-11-27: 275 rows; created by
--     Fleet Supervisor 259 + Manager 5 -> 264 not_required, Driver 11 ->
--     pending).

alter table public.wash_records
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text,
  add column if not exists next_wash_due date
    generated always as (wash_date + 7) stored;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'wash_records_verification_status_check') then
    alter table public.wash_records
      add constraint wash_records_verification_status_check
      check (verification_status in ('pending', 'verified', 'not_required'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'wash_records_verification_note_check') then
    alter table public.wash_records
      add constraint wash_records_verification_note_check
      check (verification_note is null or length(verification_note) <= 500);
  end if;
end
$$;

create index if not exists wash_records_pending_verification_idx
  on public.wash_records (organisation_id, wash_date desc)
  where verification_status = 'pending';

-- Roles that may verify (and whose own entries need no verification).
create or replace function public.wash_verifier_role(p_role text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(btrim(coalesce(p_role, ''))) in (
    'admin', 'manager', 'director', 'fleet supervisor',
    'maintenance supervisor', 'workshop supervisor'
  )
$$;

-- INSERT: decide pending / not_required from the creator's profile role.
-- UPDATE: refuse any change to the verification columns outside the RPC.
create or replace function public.guard_wash_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  if tg_op = 'INSERT' then
    select p.role into v_role from public.profiles p where p.id = new.created_by;
    if new.created_by is not null and public.wash_verifier_role(v_role) then
      new.verification_status := 'not_required';
      new.verified_by := new.created_by;
      new.verified_at := now();
      new.verification_note := 'auto (supervisor entry)';
    else
      new.verification_status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_note := null;
    end if;
    return new;
  end if;

  if (new.verification_status is distinct from old.verification_status
      or new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at
      or new.verification_note is distinct from old.verification_note)
     and coalesce(current_setting('app.wash_verify', true), '') <> 'on' then
    raise exception 'Use verify_wash_record to verify a wash'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.guard_wash_verification() from public, anon, authenticated;

-- (No DROP here on purpose: this trigger is new. Re-running needs the
-- rollback block below first.)
create trigger zz_wash_verification
  before insert or update on public.wash_records
  for each row execute function public.guard_wash_verification();

-- The only way to verify a wash.
create or replace function public.verify_wash_record(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.wash_records;
  v_ev jsonb;
begin
  if auth.uid() is null or not public.wash_verifier_role(public.get_my_role()) then
    raise exception 'You are not allowed to verify washes' using errcode = '42501';
  end if;

  select * into r from public.wash_records
   where id = p_id and organisation_id = public.app_current_org()
   for update;
  if not found then
    raise exception 'Wash record not found' using errcode = 'P0002';
  end if;

  if not (r.country is null or public.is_super_admin() or public.app_sees_all_countries()
          or lower(btrim(r.country)) = any(coalesce(public.app_country_scope(), '{}'::text[]))) then
    raise exception 'This wash is outside your country' using errcode = '42501';
  end if;
  if not (r.site is null or btrim(r.site) = '' or public.app_sees_all_sites()
          or upper(btrim(r.site)) = any(coalesce(public.app_site_scope(), '{}'::text[]))) then
    raise exception 'This wash is outside your site' using errcode = '42501';
  end if;

  if r.created_by = auth.uid() then
    raise exception 'You cannot verify a wash you logged' using errcode = '42501';
  end if;
  if r.verification_status <> 'pending' then
    raise exception 'This wash is already %', replace(r.verification_status, '_', ' ')
      using errcode = 'PT409';
  end if;

  v_ev := r.wash_details -> 'photo_evidence';
  if jsonb_typeof(v_ev) = 'array' and (
       not exists (select 1 from jsonb_array_elements(v_ev) e where e->>'stage' = 'before')
    or not exists (select 1 from jsonb_array_elements(v_ev) e where e->>'stage' = 'after')) then
    raise exception 'Before and after photos are required' using errcode = '22023';
  end if;

  perform set_config('app.wash_verify', 'on', true);
  update public.wash_records
     set verification_status = 'verified',
         verified_by = auth.uid(),
         verified_at = now(),
         verification_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  perform set_config('app.wash_verify', '', true);

  return jsonb_build_object('ok', true, 'id', p_id, 'verified_at', now());
end
$$;

revoke all on function public.verify_wash_record(uuid, text) from public, anon;
grant execute on function public.verify_wash_record(uuid, text) to authenticated;
revoke all on function public.wash_verifier_role(text) from public, anon;
grant execute on function public.wash_verifier_role(text) to authenticated;

-- Backfill existing rows (guard bypassed for this statement only).
select set_config('app.wash_verify', 'on', true);
update public.wash_records w
   set verification_status = 'not_required',
       verified_by = w.created_by,
       verified_at = w.created_at,
       verification_note = 'auto (supervisor entry)'
  from public.profiles p
 where p.id = w.created_by
   and public.wash_verifier_role(p.role)
   and w.verification_status = 'pending';
select set_config('app.wash_verify', '', true);

-- VERIFY (run after apply):
--   select verification_status, count(*) from wash_records group by 1;
--     -> expect not_required 264, pending 11 at apply time
--   select has_function_privilege('anon','public.verify_wash_record(uuid,text)','execute');  -- f
--   Rolled-back impersonation tests to run after applying (NOT yet run):
--     driver who logged a wash -> 42501 'You cannot verify a wash you logged'
--     a Fleet Supervisor on that wash -> ok, status verified
--     a supervisor's own new insert -> not_required, verified_by = creator
--     direct UPDATE of verification_status -> 42501
--
-- ROLLBACK:
--   drop trigger if exists zz_wash_verification on public.wash_records;
--   drop function if exists public.verify_wash_record(uuid, text);
--   drop function if exists public.guard_wash_verification();
--   drop function if exists public.wash_verifier_role(text);
--   drop index if exists public.wash_records_pending_verification_idx;
--   alter table public.wash_records
--     drop column if exists next_wash_due,
--     drop column if exists verification_note,
--     drop column if exists verified_at,
--     drop column if exists verified_by,
--     drop column if exists verification_status;
