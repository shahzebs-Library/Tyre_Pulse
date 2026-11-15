-- =============================================================================
-- TEN-8b: sign-up lands in a company only by invitation; the company code is a check,
-- never a way in.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHERE TEN-8 AND TEN-9 LEFT IT
--   TEN-8 moved the sign-up decision into _signup_context(); TEN-9 made a valid
--   invitation token decide the company, role and approval. Open points:
--     a. the sign-up screen cannot show WHICH company an invitation is for before the
--        person creates an account (the token is opaque);
--     b. a company has no short code a person can type or be told over the phone;
--     c. nothing ties a typed company code to the invitation, so a person holding an
--        invitation for company B and typing company C gets no warning.
--
-- WHAT IT ADDS
--   1. organisations.sign_in_code (short, unique without regard to case, optional) and
--      admin_set_org_sign_in_code(org, code)  super admin. TEN-9b uses the same code
--      for sign-in. _org_by_code(code) resolves a code or a slug to a company.
--   2. get_invitation_preview(token)  callable before sign-in (anon). Returns the
--      company name, the role, whether the invitation is tied to an e-mail address, and
--      the expiry, or {ok:false, reason}. It needs the full secret token, so it cannot
--      be used to list companies or invitations. It never marks the invitation used.
--   3. _signup_context() (replaces the TEN-9 body, same signature):
--        no token, no code      -> exactly as TEN-9: the legacy company while
--                                  single_tenant_mode is true, otherwise no company.
--        valid token, no code   -> the invitation decides (as TEN-9).
--        valid token + code     -> the code must name the invitation's company;
--                                  otherwise NO company and the invitation stays unused.
--        code without a token   -> NO company, not approved, in BOTH modes. A code is
--                                  public knowledge; it never grants membership and
--                                  never falls back to the legacy company.
--        unusable token         -> NO company (as TEN-9).
--
-- SINGLE-TENANT MODE ON (today): a sign-up that sends neither invite_token nor
--   company_code takes the same branch and returns the same value as before. No client
--   sends either field today (checked: src/pages/Login.jsx, the Flutter
--   self_registration_repository, mobile register), so nothing changes.
--
-- NOT DONE HERE (stated)
--   * No client sends invite_token or company_code yet. The web and Flutter sign-up
--     forms need an invitation link handler (?invite=<token>) that calls
--     get_invitation_preview and passes the token in the sign-up metadata.
--   * An invitation tied to an e-mail address can only be redeemed by a sign-up with
--     that address. The web sign-up form creates a made-up address from the username,
--     so today only an invitation with NO e-mail (org_invite_member(null, role)) can be
--     redeemed through it. admin_provision_organisation always ties the OWNER invitation
--     to the owner e-mail: the owner needs a real e-mail sign-up form, or the owner
--     decides that owner invitations may be untied (owner decision D2).
--   * A person who already has an account with no company cannot redeem an invitation
--     afterwards: moving a profile into a company is refused by the privileged-column
--     guard for anyone but a super admin, and this draft does not weaken that guard.
--   * get_invitation_preview joins the reviewed list of functions callable before
--     sign-in (it would be the 11th). The privilegedFunctionClosure test must list it.
--
-- RISK TO THE CURRENT COMPANY: none while no sign-up sends the two new fields.
--
-- APPLY ORDER: after 20261113113000 (TEN-9).
--
-- VERIFY (begin; ... rollback;)
--   select public._signup_context(gen_random_uuid(), '{}'::jsonb, 'x@users.tyrepulse.app');
--     -- single_tenant_mode true: org = legacy company, role null, approved null
--   select public.get_invitation_preview('not-a-token');   -- {ok:false, reason:invalid}
--
-- ROLLBACK
--   Re-run the _signup_context body from 20261113113000 (TEN-9). Revoke execute on
--   get_invitation_preview from anon. The column and helpers are then unused.
-- =============================================================================

do $$ begin
  if to_regclass('public.org_invitations') is null or to_regprocedure('public._org_active(uuid)') is null then
    raise exception 'TEN-8b needs TEN-9 applied first. Nothing applied.';
  end if;
end $$;

alter table public.organisations add column if not exists sign_in_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organisations_sign_in_code_format') then
    alter table public.organisations add constraint organisations_sign_in_code_format
      check (sign_in_code is null or sign_in_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{1,23}$');
  end if;
end $$;
create unique index if not exists organisations_sign_in_code_lower_uidx
  on public.organisations (lower(sign_in_code)) where sign_in_code is not null;

-- The code is platform-managed: a company Admin cannot set it (it could otherwise take
-- another company's code or slug and capture its sign-ins).
create or replace function public._guard_org_sign_in_code()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and new.sign_in_code is not distinct from old.sign_in_code then return new; end if;
  if new.sign_in_code is null then return new; end if;
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) then
    raise exception 'The company code is managed by the platform.' using errcode = '42501';
  end if;
  if exists (select 1 from public.organisations o where o.id <> new.id and lower(o.slug) = lower(new.sign_in_code)) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  return new;
end $fn$;
revoke execute on function public._guard_org_sign_in_code() from public;
revoke execute on function public._guard_org_sign_in_code() from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_org_sign_in_code' and tgrelid = 'public.organisations'::regclass) then
    create trigger trg_guard_org_sign_in_code before insert or update on public.organisations
      for each row execute function public._guard_org_sign_in_code();
  end if;
end $$;

create or replace function public._org_by_code(p_code text)
returns uuid language sql stable security definer set search_path = public as $fn$
  select o.id from public.organisations o
   where nullif(btrim(coalesce(p_code, '')), '') is not null
     and (lower(o.sign_in_code) = lower(btrim(p_code)) or lower(o.slug) = lower(btrim(p_code)))
   order by (lower(o.sign_in_code) = lower(btrim(p_code))) desc nulls last
   limit 1
$fn$;
revoke execute on function public._org_by_code(text) from public;
revoke execute on function public._org_by_code(text) from anon, authenticated;

create or replace function public.admin_set_org_sign_in_code(p_org uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_code text := nullif(btrim(coalesce(p_code, '')), '');
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can set a company code.' using errcode = '42501';
  end if;
  if v_code is not null and v_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{1,23}$' then
    raise exception 'A company code is 2 to 24 letters, digits or hyphens.' using errcode = '22023';
  end if;
  if v_code is not null and exists (select 1 from public.organisations o
       where o.id <> p_org and (lower(o.sign_in_code) = lower(v_code) or lower(o.slug) = lower(v_code))) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  update public.organisations set sign_in_code = v_code where id = p_org;
  if not found then raise exception 'Unknown organisation.' using errcode = '22023'; end if;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'set_org_sign_in_code', p_org, 'organisation', jsonb_build_object('set', v_code is not null));
  return jsonb_build_object('ok', true, 'organisation_id', p_org, 'sign_in_code', v_code);
end $fn$;
revoke execute on function public.admin_set_org_sign_in_code(uuid, text) from public;
revoke execute on function public.admin_set_org_sign_in_code(uuid, text) from anon;
grant execute on function public.admin_set_org_sign_in_code(uuid, text) to authenticated, service_role;

create or replace function public.get_invitation_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_token text := nullif(btrim(coalesce(p_token, '')), ''); inv public.org_invitations%rowtype; v_name text; v_code text;
begin
  if v_token is null or length(v_token) < 32 or length(v_token) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if inv.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if inv.accepted_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not public._org_active(inv.organisation_id) then return jsonb_build_object('ok', false, 'reason', 'unavailable'); end if;
  select o.name, coalesce(o.sign_in_code, o.slug) into v_name, v_code from public.organisations o where o.id = inv.organisation_id;
  return jsonb_build_object('ok', true, 'organisation_name', v_name, 'company_code', v_code, 'role', inv.role,
                            'email_required', inv.email is not null, 'expires_at', inv.expires_at);
end $fn$;
revoke execute on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated, service_role;

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
end $fn$;
revoke execute on function public._signup_context(uuid, jsonb, text) from public;
revoke execute on function public._signup_context(uuid, jsonb, text) from anon, authenticated;
