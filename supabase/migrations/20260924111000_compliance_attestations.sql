-- =============================================================================
-- Compliance Center: manual control attestations (SOC 2 CC1-CC9 / ISO 27001
-- Annex A controls that SQL cannot measure, e.g. leaked-password protection,
-- vendor reviews, security awareness training).
--
-- STATUS: APPLIED LIVE 2026-09-24 via Supabase MCP (migration name
--         compliance_attestations), project jhssdmeruxtrlqnwfksc.
--
-- WHAT: compliance_attestations holds one row per attestation a super admin
-- makes for a control id from the client catalogue (src/lib/complianceControls.js).
-- An attestation carries who, when, a required note (the evidence reference)
-- and a required expiry, so a manual control goes back to "manual" when its
-- attestation lapses instead of staying green forever. Withdrawing keeps the
-- row (withdrawn_at / withdrawn_by) so the history stays auditable.
-- Every attest / withdraw writes a console_sessions audit row.
--
-- SECURITY: RLS on, super-admin SELECT only, no client INSERT/UPDATE/DELETE
-- (writes only via SECURITY DEFINER RPCs that raise 42501 for anyone who is not
-- is_super_admin()). Grant order: revoke PUBLIC, revoke anon by name, grant
-- authenticated (V500 lesson). Platform-level table (no organisation_id): the
-- controls describe the platform, and only super admins can read it.
--
-- VERIFIED LIVE 2026-09-24 (one transaction, rolled back): as super admin
-- d2d43a5f-...: attest -> 1 row visible, withdraw -> true, past expiry refused
-- 22023, 2 console_sessions audit rows written. As Manager 34793423-...:
-- attest 42501, withdraw 42501, SELECT returned 0 rows. anon EXECUTE false,
-- anon SELECT false. After rollback: 0 attestations, 0 compliance_* audit rows.
--
-- VERIFY (each in a rolled-back transaction):
--   1. as super admin d2d43a5f-0906-4f7a-9577-e36d89164914:
--      select public.admin_attest_control('A1-LEAKED-PW','note',now()+interval '90 days');
--        -> returns id; select count(*) from compliance_attestations -> 1
--   2. as a non super admin: the same call raises SQLSTATE 42501;
--      select count(*) from compliance_attestations -> 0 (RLS)
--   3. has_function_privilege('anon', 'public.admin_attest_control(text,text,timestamptz)', 'EXECUTE') -> false
--
-- ROLLBACK:
--   drop function if exists public.admin_withdraw_attestation(uuid, text);
--   drop function if exists public.admin_attest_control(text, text, timestamptz);
--   drop table if exists public.compliance_attestations;
-- =============================================================================

create table if not exists public.compliance_attestations (
  id                 uuid primary key default gen_random_uuid(),
  control_id         text not null check (control_id ~ '^[A-Z0-9][A-Z0-9_.-]{1,63}$'),
  note               text not null check (char_length(btrim(note)) between 3 and 2000),
  attested_by        uuid not null,
  attested_by_email  text,
  attested_at        timestamptz not null default now(),
  expires_at         timestamptz not null,
  withdrawn_at       timestamptz,
  withdrawn_by       uuid,
  withdraw_reason    text,
  check (expires_at > attested_at)
);

create index if not exists compliance_attestations_control_idx
  on public.compliance_attestations (control_id, attested_at desc);

alter table public.compliance_attestations enable row level security;

drop policy if exists compliance_attestations_select on public.compliance_attestations;
create policy compliance_attestations_select on public.compliance_attestations
  for select to authenticated using ((select public.is_super_admin()));

revoke all on public.compliance_attestations from public;
revoke all on public.compliance_attestations from anon;
revoke insert, update, delete, truncate, trigger, references on public.compliance_attestations from authenticated;
grant select on public.compliance_attestations to authenticated;

create or replace function public.admin_attest_control(
  p_control_id text, p_note text, p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
  v_ctrl  text := upper(btrim(coalesce(p_control_id, '')));
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can attest a control' using errcode = '42501';
  end if;
  if v_ctrl !~ '^[A-Z0-9][A-Z0-9_.-]{1,63}$' then
    raise exception 'A valid control id is required' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'An attestation needs a note (at least 3 characters)' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'An attestation needs an expiry date in the future' using errcode = '22023';
  end if;
  if p_expires_at > now() + interval '400 days' then
    raise exception 'An attestation cannot last longer than 400 days' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.compliance_attestations (control_id, note, attested_by, attested_by_email, expires_at)
  values (v_ctrl, btrim(p_note), v_uid, v_email, p_expires_at)
  returning id into v_id;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'compliance_attest', v_id, 'compliance_attestation',
          jsonb_build_object('control_id', v_ctrl, 'expires_at', p_expires_at));

  return v_id;
end $$;

create or replace function public.admin_withdraw_attestation(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ctrl text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can withdraw an attestation' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A withdrawal needs a reason (at least 3 characters)' using errcode = '22023';
  end if;
  update public.compliance_attestations
     set withdrawn_at = now(), withdrawn_by = v_uid, withdraw_reason = btrim(p_reason)
   where id = p_id and withdrawn_at is null
  returning control_id into v_ctrl;
  if v_ctrl is null then
    return false;
  end if;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'compliance_withdraw', p_id, 'compliance_attestation',
          jsonb_build_object('control_id', v_ctrl, 'reason', btrim(p_reason)));
  return true;
end $$;

revoke all on function public.admin_attest_control(text, text, timestamptz) from public;
revoke all on function public.admin_attest_control(text, text, timestamptz) from anon;
grant execute on function public.admin_attest_control(text, text, timestamptz) to authenticated;

revoke all on function public.admin_withdraw_attestation(uuid, text) from public;
revoke all on function public.admin_withdraw_attestation(uuid, text) from anon;
grant execute on function public.admin_withdraw_attestation(uuid, text) to authenticated;
