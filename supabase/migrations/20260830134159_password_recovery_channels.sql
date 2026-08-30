-- Verified, out-of-band recovery contacts for accounts whose Supabase Auth
-- email is intentionally synthetic. These values are never exposed pre-auth.
alter table public.profiles
  add column if not exists recovery_email text,
  add column if not exists recovery_email_verified_at timestamptz,
  add column if not exists recovery_phone text,
  add column if not exists recovery_phone_verified_at timestamptz;

create unique index if not exists profiles_recovery_email_lower_uidx
  on public.profiles (lower(recovery_email))
  where recovery_email is not null and btrim(recovery_email) <> '';

create unique index if not exists profiles_recovery_phone_uidx
  on public.profiles (recovery_phone)
  where recovery_phone is not null and btrim(recovery_phone) <> '';

create table if not exists public.password_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('password_recovery', 'contact_verification')),
  channel text not null check (channel in ('email', 'sms')),
  destination_hash text not null,
  code_hash text not null,
  requester_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_recovery_challenges_requester_created_idx
  on public.password_recovery_challenges (requester_hash, created_at desc);
create index if not exists password_recovery_challenges_user_created_idx
  on public.password_recovery_challenges (user_id, created_at desc);

alter table public.password_recovery_challenges enable row level security;
alter table public.password_recovery_challenges force row level security;

-- The browser never reads or writes challenges. Edge Functions use the
-- service role and the table has no anon/authenticated policies.
revoke all on table public.password_recovery_challenges from public, anon, authenticated;
grant all on table public.password_recovery_challenges to service_role;

comment on table public.password_recovery_challenges is
  'Short-lived hashed email/SMS recovery codes; service-role Edge access only.';
comment on column public.profiles.recovery_email is
  'User-verified recovery mailbox, distinct from a possibly synthetic auth email.';
comment on column public.profiles.recovery_phone is
  'User-verified E.164 recovery mobile number.';

-- Existing profile self-update policies predate these columns. Without a
-- column guard, a signed-in user could call PostgREST directly and forge the
-- `*_verified_at` timestamp. Only a service-role request (the recovery Edge
-- Function after validating the code) may change recovery contacts. Direct SQL
-- administration has no request JWT and remains possible for break-glass work.
create or replace function public.guard_recovery_contact_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
begin
  if request_role is not null
     and request_role <> 'service_role'
     and (
       new.recovery_email is distinct from old.recovery_email
       or new.recovery_email_verified_at is distinct from old.recovery_email_verified_at
       or new.recovery_phone is distinct from old.recovery_phone
       or new.recovery_phone_verified_at is distinct from old.recovery_phone_verified_at
     ) then
    raise exception 'recovery contacts must be changed through the verification service'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_recovery_contact_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_recovery_contact_columns on public.profiles;
create trigger trg_guard_recovery_contact_columns
before update on public.profiles
for each row execute function public.guard_recovery_contact_columns();
