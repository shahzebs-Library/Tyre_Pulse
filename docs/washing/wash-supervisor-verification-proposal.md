# Proposal: supervisor verification of wash records (needs owner approval)

Status: APPROVED by the owner on 2026-11-27 with two additions (a supervisor's
own entry is `not_required`, and `next_wash_due` = wash date + 7). The final
SQL is `supabase/migrations/20261127190000_wash_supervisor_verification.sql`,
which supersedes the draft below. It is not applied yet: the apply call was
refused by the session's permission check.

## Why a migration is needed

Checked against the live database on 2026-11-27:

- `wash_records` has no verification columns. The only "who/when" columns are
  `created_by`, `created_at`, `captured_at`, `entry_name`, `entry_username`,
  `completed_by`, `completed_at`.
- `UPDATE` is allowed to Admin, Manager and Director only
  (`wash_records_update`), and every change is captured by the
  `wash_changes_audit` trigger.
- Storing a "verified" flag inside `wash_details` would be accepted by the
  CHECK, but it is not real evidence: nothing would stop the person who
  logged the wash from also writing the flag, and there would be no
  server-stamped verifier. So it was **not built**.

## Proposed migration

```sql
-- 1. Columns (nullable; existing rows read as "not verified").
alter table public.wash_records
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text
    check (verification_note is null or length(verification_note) <= 500);

create index if not exists wash_records_unverified_idx
  on public.wash_records (organisation_id, wash_date desc)
  where verified_at is null;

-- 2. The only way to verify: a definer RPC that stamps the verifier and the
--    server time itself, so neither can be supplied by the client.
create or replace function public.verify_wash_record(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.wash_records;
begin
  if lower(coalesce(public.get_my_role(), '')) not in
     ('admin','manager','director','fleet supervisor',
      'maintenance supervisor','workshop supervisor') then
    raise exception 'Not allowed to verify washes' using errcode = '42501';
  end if;

  select * into r from public.wash_records
   where id = p_id
     and organisation_id = public.app_current_org()
   for update;
  if not found then
    raise exception 'Wash record not found' using errcode = 'P0002';
  end if;
  -- Site/country scope: same rules as the read policies.
  if not (r.site is null or btrim(r.site) = '' or public.app_sees_all_sites()
          or upper(btrim(r.site)) = any(coalesce(public.app_site_scope(), '{}'))) then
    raise exception 'Outside your site scope' using errcode = '42501';
  end if;
  -- Four eyes: nobody verifies their own wash.
  if r.created_by = auth.uid() then
    raise exception 'You cannot verify a wash you logged' using errcode = '42501';
  end if;
  if r.verified_at is not null then
    raise exception 'Already verified' using errcode = 'PT409';
  end if;
  -- Evidence must be complete: at least one before and one after photo.
  if not exists (select 1 from jsonb_array_elements(coalesce(r.wash_details->'photo_evidence','[]')) e
                  where e->>'stage' = 'before')
     or not exists (select 1 from jsonb_array_elements(coalesce(r.wash_details->'photo_evidence','[]')) e
                  where e->>'stage' = 'after') then
    raise exception 'Before and after photos are required' using errcode = '22023';
  end if;

  perform set_config('app.wash_verify', 'on', true);
  update public.wash_records
     set verified_by = auth.uid(),
         verified_at = now(),
         verification_note = nullif(btrim(p_note), '')
   where id = p_id;
end $$;

revoke all on function public.verify_wash_record(uuid, text) from public, anon;
grant execute on function public.verify_wash_record(uuid, text) to authenticated;

-- 3. Clients may never write the verification columns directly.
create or replace function public.guard_wash_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.verified_by is distinct from old.verified_by
          or new.verified_at is distinct from old.verified_at
          or new.verification_note is distinct from old.verification_note)
     and coalesce(current_setting('app.wash_verify', true), '') <> 'on' then
    raise exception 'Use verify_wash_record' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_wash_verification
  before update on public.wash_records
  for each row execute function public.guard_wash_verification();
```

## Roles that may verify

Admin, Manager, Director, Fleet Supervisor, Maintenance Supervisor, Workshop
Supervisor - never the person who logged the wash. Owner to confirm the list.

## App work after approval

- Flutter: a "Verify" action on the record view for those roles, calling the
  RPC; the record view shows "Verified by X at T" or "Not verified yet".
- History filter "Not verified".
