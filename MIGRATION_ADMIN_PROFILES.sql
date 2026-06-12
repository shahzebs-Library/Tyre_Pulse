-- ============================================================
-- MIGRATION: Admin Profile Update Policy + RPC
-- TyrePulse — Run in Supabase SQL Editor
-- Fixes: Admin users unable to update other users' profiles
-- ============================================================

-- Fix: Allow Admins to update any profile row
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles for update
  using (public.get_my_role() = 'Admin');

-- Also add a security-definer RPC function as a reliable fallback for admin profile edits
-- This bypasses RLS entirely when called, ensuring updates always go through for Admins
create or replace function public.admin_update_profile(
  p_user_id   uuid,
  p_full_name  text default null,
  p_username   text default null,
  p_employee_id text default null,
  p_role       text default null,
  p_country    text[] default null,
  p_region     text default null,
  p_approved   boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only Admins may call this
  if (select get_my_role()) <> 'Admin' then
    raise exception 'Permission denied: Admin role required';
  end if;

  update profiles set
    full_name    = coalesce(p_full_name,   full_name),
    username     = coalesce(p_username,    username),
    employee_id  = coalesce(p_employee_id, employee_id),
    role         = coalesce(p_role,        role),
    country      = case when p_country is not null then p_country else country end,
    region       = coalesce(p_region,      region),
    approved     = coalesce(p_approved,    approved),
    updated_at   = now()
  where id = p_user_id;
end;
$$;

grant execute on function public.admin_update_profile to authenticated;
