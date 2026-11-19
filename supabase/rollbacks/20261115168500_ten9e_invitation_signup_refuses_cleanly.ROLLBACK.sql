-- ROLLBACK for 20261115168500_ten9e_invitation_signup_refuses_cleanly.sql
-- Restores _signup_context and get_public_config exactly as production stands before
-- TEN-9e (md5 of pg_get_functiondef, read 2026-11-18 from production):
--   _signup_context    06a34ba4879154d25431487b1ba0dd0e
--   get_public_config  4b5a4cb2281caa9673d78acb8f600695
-- No data is touched.
begin;
CREATE OR REPLACE FUNCTION public._signup_context(p_user_id uuid, p_meta jsonb, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- A company code alone is not an invitation. Never a default company.
    return jsonb_build_object('org', null, 'role', null, 'approved', false, 'refused', 'code_without_invitation');
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex')
   for update;
  if found and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
     and (inv.email is null or inv.email = v_email)
     and public._org_active(inv.organisation_id) then
    if v_code is not null and public._org_by_code(v_code) is distinct from inv.organisation_id then
      return jsonb_build_object('org', null, 'role', null, 'approved', false, 'refused', 'code_does_not_match_invitation');
    end if;
    update public.org_invitations set accepted_at = now(), accepted_by = p_user_id where id = inv.id;
    return jsonb_build_object('org', inv.organisation_id, 'role', inv.role, 'approved', true, 'invitation', inv.id);
  end if;
  return jsonb_build_object('org', null, 'role', null, 'approved', false);
end $function$

;
CREATE OR REPLACE FUNCTION public.get_public_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero',
    'auth_google_enabled','auth_microsoft_enabled','qr_login_enabled'
  ]);
$function$

;
revoke execute on function public._signup_context(uuid, jsonb, text) from public, anon, authenticated;
commit;
