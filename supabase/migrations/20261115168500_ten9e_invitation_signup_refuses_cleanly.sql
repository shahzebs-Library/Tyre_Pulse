-- =============================================================================
-- TEN-9e  an invitation sign-up that the server refuses creates NO account, and the
--         public config tells the sign-in screens whether multi-company mode is on.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, checks 8a-8h).
--
-- DEFECT (PR #546 test matrix, checks 4l / 4q / 4s / 4u / 4x / 4z)
--   _signup_context refused a used / cancelled / expired / wrong-email / wrong-code
--   invitation by returning org = NULL, approved = false. handle_new_user then STILL
--   inserted the profile, so the sign-up "succeeded":
--     * the /invite page told the person "account created, sign in as CODE/name";
--     * the account sat in no company, unapproved, visible to nobody (no Admin can
--       approve it: it belongs to no company);
--     * its username (globally unique until ten9c) and its made-up address were
--       burned, so the person could not simply retry with the right link.
--   The whole point of the token is that the account lands in that company; when it
--   cannot, nothing should be created.
--
-- FIX
--   1. _signup_context raises (errcode 22023, "invitation_not_valid") when an
--      invite_token or a company_code was sent and the invitation does not hold. The
--      raise aborts the auth.users insert, so GoTrue returns an error, no account, no
--      profile, and the invitation is NOT consumed (same transaction). A sign-up with
--      neither key is unchanged (single-company default / NULL company).
--      The /invite page re-reads the invitation after an error to tell the person why.
--   2. get_public_config also returns single_tenant_mode (not sensitive) so the web and
--      Flutter sign-in screens show the "company code / username" hint only once
--      multi-company mode is on. Missing key = hint hidden (today's behaviour).
--
-- EXISTING DATA: none touched.
-- ROLLBACK: re-create _signup_context and get_public_config from their previous bodies
--   (recorded in docs: the returns below replaced by the old 'org', null branches).
-- =============================================================================

create or replace function public._signup_context(p_user_id uuid, p_meta jsonb, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_meta ->> 'invite_token', '')), '');
  v_code  text := nullif(btrim(coalesce(p_meta ->> 'company_code', '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv public.org_invitations%rowtype;
begin
  if v_token is null and v_code is null then
    return jsonb_build_object('org', public._single_tenant_org(), 'role', null, 'approved', null);
  end if;
  if v_token is null then
    -- A company code alone is not an invitation. Never a default company, never an account.
    raise exception 'invitation_not_valid: code_without_invitation' using errcode = '22023';
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex')
   for update;
  if found and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
     and (inv.email is null or inv.email = v_email)
     and public._org_active(inv.organisation_id) then
    if v_code is not null and public._org_by_code(v_code) is distinct from inv.organisation_id then
      raise exception 'invitation_not_valid: code_does_not_match_invitation' using errcode = '22023';
    end if;
    update public.org_invitations set accepted_at = now(), accepted_by = p_user_id where id = inv.id;
    return jsonb_build_object('org', inv.organisation_id, 'role', inv.role, 'approved', true, 'invitation', inv.id);
  end if;
  raise exception 'invitation_not_valid' using errcode = '22023';
end $fn$;
revoke execute on function public._signup_context(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.get_public_config()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero',
    'auth_google_enabled','auth_microsoft_enabled','qr_login_enabled',
    'single_tenant_mode'
  ]);
$fn$;
