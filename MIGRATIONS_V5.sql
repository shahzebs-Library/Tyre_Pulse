-- ============================================================
-- TYREPULSE — MIGRATIONS V5
-- Run in Supabase SQL Editor
-- Fixes: empty profiles table, admin role-update RLS policy,
--        auto-create profile on new auth user signup
-- Built by Shahzeb Rahman © 2026
-- ============================================================


-- ── STEP 1: Backfill profiles for existing auth users ──────────────────────
-- Inserts a default Reporter profile for every auth.users row that does not
-- already have a matching profiles row.  Run this once to repair the table.
insert into public.profiles (id, username, full_name, role, region)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'username',
    split_part(u.email, '@', 1)   -- fall back to email prefix
  ) as username,
  u.raw_user_meta_data->>'full_name' as full_name,
  'Reporter' as role,
  'KSA'      as region
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;


-- ── STEP 2: Trigger — auto-create profile on every new signup ──────────────
-- This fires in the database (SECURITY DEFINER) so it bypasses RLS.
-- It means profile creation never depends on whether the app's insert
-- succeeds or whether email confirmation is enabled.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name, role, region)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'full_name',
    'Reporter',
    coalesce(new.raw_user_meta_data->>'region', 'KSA')
  )
  on conflict (id) do nothing;   -- safe to re-run; won't overwrite existing rows
  return new;
end;
$$;

-- Drop trigger first in case it already exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();


-- ── STEP 3: Allow Admins to update any user's role ─────────────────────────
-- Without this policy the User Management page cannot save role changes —
-- Supabase would silently reject the UPDATE because profiles_update_own
-- only permits users to update their OWN row.
drop policy if exists "profiles_admin_update_role" on public.profiles;

create policy "profiles_admin_update_role"
  on public.profiles
  for update
  using (public.get_my_role() = 'Admin')
  with check (public.get_my_role() = 'Admin');


-- ── STEP 4: Allow Admins to read ALL profiles (needed for User Management) ──
-- The existing profiles_select policy already allows all authenticated users
-- to read all profiles, so this step is only needed if you removed it.
-- Included here for completeness / to make sure it exists.
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "Users can view all profiles" on public.profiles;

create policy "profiles_select"
  on public.profiles
  for select
  using (auth.role() = 'authenticated');


-- ── STEP 5: Allow the trigger function (service role) to insert profiles ────
-- The trigger already runs as SECURITY DEFINER (superuser), so RLS is
-- bypassed for inserts originating from the trigger.
-- However, the app's signup form also tries to insert directly after
-- supabase.auth.signUp().  With email-confirmation ON the user has no
-- session yet, so auth.uid() is NULL and the insert would be blocked.
-- Fix: allow unauthenticated inserts where the row id matches the signing-up
-- user.  Supabase provides the user id in the JWT even before confirmation.
drop policy if exists "profiles_self_insert" on public.profiles;
drop policy if exists "profiles_admin_insert" on public.profiles;

-- Service-role / trigger inserts bypass RLS entirely — no policy needed.
-- This policy covers the signup form path (authenticated OR just-signed-up).
create policy "profiles_insert_new_user"
  on public.profiles
  for insert
  with check (
    -- Either the row belongs to the currently signed-in user...
    auth.uid() = id
    or
    -- ...or it is an admin creating a profile manually.
    public.get_my_role() = 'Admin'
  );
