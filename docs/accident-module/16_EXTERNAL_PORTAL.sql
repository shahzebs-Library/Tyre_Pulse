-- =============================================================================
-- ACCIDENT CASE MODEL - EXTERNAL INSURER / AUTHORITY READ-ONLY PORTAL (Phase 10)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row. Do
-- not apply it until it has been reviewed and the tables/helpers it depends on are
-- live.
--
-- RUN ORDER: this script RUNS AFTER V417 (02_DATA_MODEL.sql - the case model
-- tables, columns, RLS and the closure-enforcement guard) AND AFTER
-- 10_WORKSTREAM_RPCS.sql (which creates the shared context helper
-- public._accident_rpc_context(uuid) this file reuses on the mint path). It reads
-- the V417 tables accidents / accident_case_workstreams / accident_insurance_claims
-- and creates ONE new table (accident_portal_shares) plus three RPCs. Nothing here
-- alters an existing table, column, policy or function.
-- RE-CONFIRM THE NEXT-FREE MIGRATION NUMBER AT APPLY TIME: V417 and V418 are the
-- accident model / engine-mirror artifacts (02_DATA_MODEL.sql / 08_ENGINE_SQL_MIRROR
-- .sql); this later portal artifact takes the next free number after the accident
-- batch and the standing V419-V422 batch (PROJECT_MEMORY part 13) have landed.
-- Renumber at apply time. Nothing here depends on its own number.
--
-- WHY IT EXISTS
--   An insurer or a traffic / claims authority sometimes needs to SEE the state of
--   ONE accident case (is the claim registered, what is the severity, which teams
--   are still open) without being given a login, a role, or any reach into the
--   tenant's data. This is the exact anon-token share pattern the repo already ships
--   for TV / report boards (report_shares + get_report_snapshot, V251/V252, itself
--   modelled on V103 display_tokens): a token row carries the organisation, an
--   external party reads a curated snapshot ONLY through a SECURITY DEFINER RPC
--   gated by that high-entropy token, and NO base table is ever granted to anon.
--   The portal is READ-ONLY: it exposes a status view, never a write path.
--
-- SAFETY MODEL (three layers, identical in spirit to report_shares)
--   1. NO TABLE REACHES anon. accident_portal_shares revokes anon and has a
--      RESTRICTIVE org-isolation policy; the only anon-executable object is the
--      snapshot RPC, which is SECURITY DEFINER and derives the org FROM THE TOKEN
--      ROW, so a token can only ever surface its own tenant's single case.
--   2. THE TOKEN IS THE CREDENTIAL. It is high-entropy ('acp_' + 18 random bytes),
--      may carry a bcrypt password, may expire, and can be revoked (active=false).
--      A revoked / expired / bad-password token returns an honest {ok:false,reason}
--      and never any case data.
--   3. THE SNAPSHOT IS PII-LEAN BY CONSTRUCTION. It returns reference_no / case_no,
--      incident_date, the case status vocabulary, severity, a per-workstream status
--      map, and a claim STATUS summary (decision token + claim number + insurer +
--      applicability). It DELIBERATELY OMITS driver / third-party PII, internal
--      notes, liability findings, and every money figure (deductible, approved
--      amount, settlements). "Financials beyond claim status" never leave the RPC.
--
-- SECURITY (mint / revoke path - house pattern V416 / V398 / V229)
--   accident_portal_create / accident_portal_revoke are SECURITY DEFINER. Because a
--   DEFINER function bypasses RLS, each RE-CHECKS org + country + site scope in its
--   own body: create via public._accident_rpc_context(accident_id) (org =
--   app_current_org() OR super, plus app_can_see_country / app_can_see_site on the
--   case), revoke via the share row's own organisation_id. Both then require
--   app_is_elevated() (Admin / Manager / Director) OR app_user_can('accidents',
--   'edit') - the same capability that owns the accident record - so a KSA-scoped
--   user cannot mint a portal link for an Egypt case, and a view-only role cannot
--   mint one at all. anon EXECUTE is revoked on the two mint / revoke functions;
--   authenticated is granted; the in-body self-gate is the real boundary.
--
--   accident_portal_create AND get_accident_portal_snapshot pin
--   search_path = 'public','extensions' because pgcrypto (gen_random_bytes /
--   gen_salt / crypt) lives in the extensions schema on this project (V259 lesson:
--   a token-minting DEFINER fn that omits 'extensions' throws on gen_random_bytes).
--   accident_portal_revoke touches no pgcrypto and pins 'public' only.
--
-- MIRROR DISCIPLINE
--   No case MATHS live here. The workstream-status token set and the claim-decision
--   token set surfaced by the snapshot are read verbatim from the live V417 rows;
--   this file introduces no vocabulary of its own to keep in step.
--
-- VERIFY (after apply, in ONE rolled-back transaction, impersonating a real
-- elevated user - app_current_org() is NULL in a bare MCP session, so the mint
-- path needs a session org):
--   1. accident_portal_create(<a real accident id>) -> {ok:true, token:'acp_...'}
--      and exactly one accident_portal_shares row for that case.
--   2. get_accident_portal_snapshot(<that token>) -> {ok:true, reference_no, ...,
--      workstreams{...}, claim{...}} with NO amount / PII keys present; view_count
--      becomes 1.
--   3. get_accident_portal_snapshot('acp_bogus') -> {ok:false, reason:'invalid'}.
--   4. accident_portal_revoke(<share id>) then re-run step 2 ->
--      {ok:false, reason:'revoked'}.
--   5. Mint with a password, then snapshot with no / wrong password ->
--      {ok:false, reason:'password'}; with the right password -> {ok:true, ...}.
--   6. Mint with p_expires in the past, then snapshot -> {ok:false, reason:'expired'}.
--   7. As a KSA-scoped non-elevated user without 'edit', accident_portal_create on
--      an Egypt case -> raises 42501. Roll the whole transaction back; confirm 0
--      rows persist.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists public.get_accident_portal_snapshot(text,text);
--   drop function if exists public.accident_portal_revoke(uuid);
--   drop function if exists public.accident_portal_create(uuid,text,timestamptz);
--   drop table if exists public.accident_portal_shares;
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. TABLE - accident_portal_shares
--   One row = one external read-only link to ONE accident case. Org is stamped
--   from app_current_org() and is the ONLY thing the snapshot trusts to scope
--   reads. No case data is duplicated here; the snapshot reads the live case.
-- -----------------------------------------------------------------------------
create table if not exists public.accident_portal_shares (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  token            text not null unique
                     default ('acp_' || encode(extensions.gen_random_bytes(18), 'hex')),
  password_hash    text,
  expires_at       timestamptz,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  last_viewed_at   timestamptz,
  view_count       integer not null default 0
);

create index if not exists accident_portal_shares_accident_idx
  on public.accident_portal_shares (accident_id);
create index if not exists accident_portal_shares_org_idx
  on public.accident_portal_shares (organisation_id);

-- RLS: RESTRICTIVE org-isolation FOR ALL, plus a permissive elevated-own-org policy
-- for SELECT / UPDATE / DELETE so admins can list and revoke their own links. There
-- is DELIBERATELY NO INSERT policy: a share can only be minted through the DEFINER
-- accident_portal_create RPC (a permissive INSERT policy would let a raw PostgREST
-- write bypass the capability gate). anon is revoked outright.
alter table public.accident_portal_shares enable row level security;

drop policy if exists accident_portal_shares_org_isolation on public.accident_portal_shares;
create policy accident_portal_shares_org_isolation on public.accident_portal_shares
  as restrictive for all to authenticated
  using  ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists accident_portal_shares_select on public.accident_portal_shares;
create policy accident_portal_shares_select on public.accident_portal_shares
  for select to authenticated
  using ((select public.app_is_elevated())
         or (select public.app_user_can('accidents', 'edit')));

drop policy if exists accident_portal_shares_update on public.accident_portal_shares;
create policy accident_portal_shares_update on public.accident_portal_shares
  for update to authenticated
  using ((select public.app_is_elevated())
         or (select public.app_user_can('accidents', 'edit')))
  with check ((select public.app_is_elevated())
              or (select public.app_user_can('accidents', 'edit')));

drop policy if exists accident_portal_shares_delete on public.accident_portal_shares;
create policy accident_portal_shares_delete on public.accident_portal_shares
  for delete to authenticated
  using ((select public.app_is_elevated())
         or (select public.app_user_can('accidents', 'edit')));

revoke all on public.accident_portal_shares from anon;
grant select, update, delete on public.accident_portal_shares to authenticated;

-- -----------------------------------------------------------------------------
-- 2. accident_portal_create - mint a read-only external link for one case.
--   Elevated OR the accident-owning capability. Re-asserts org + country + site
--   scope via _accident_rpc_context. Returns {ok, token}.
-- -----------------------------------------------------------------------------
create or replace function public.accident_portal_create(
  p_accident_id uuid,
  p_password    text default null,
  p_expires     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_token   text;
  v_row     public.accident_portal_shares%rowtype;
begin
  -- org + country + site scope re-check on the target case (raises if out of scope).
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  -- Capability gate: elevated OR the accident-owning capability.
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit')) then
    raise exception 'Not permitted to create an external portal link.' using errcode = '42501';
  end if;

  v_token := 'acp_' || encode(gen_random_bytes(18), 'hex');

  insert into public.accident_portal_shares
    (organisation_id, accident_id, token, password_hash, expires_at,
     active, created_by, created_at, view_count)
  values
    (v_org, p_accident_id, v_token,
     case
       when p_password is not null and btrim(p_password) <> ''
         then crypt(p_password, gen_salt('bf'))
       else null
     end,
     p_expires, true, auth.uid(), now(), 0)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'token', v_token);
end
$$;

-- -----------------------------------------------------------------------------
-- 3. accident_portal_revoke - deactivate a link. Elevated OR accident capability,
--   scoped to the share's own organisation. A revoked link's snapshot returns
--   {ok:false, reason:'revoked'}.
-- -----------------------------------------------------------------------------
create or replace function public.accident_portal_revoke(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_share public.accident_portal_shares%rowtype;
begin
  if p_id is null then
    raise exception 'A portal link id is required.' using errcode = '22023';
  end if;

  select * into v_share
    from public.accident_portal_shares
   where id = p_id;

  if v_share.id is null then
    raise exception 'Portal link % not found.', p_id using errcode = 'P0002';
  end if;

  -- org scope re-check (DEFINER bypasses RLS).
  if not ((v_share.organisation_id = public.app_current_org()) or public.is_super_admin()) then
    raise exception 'Not permitted for this organisation.' using errcode = '42501';
  end if;

  -- Capability gate: elevated OR the accident-owning capability.
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit')) then
    raise exception 'Not permitted to revoke an external portal link.' using errcode = '42501';
  end if;

  update public.accident_portal_shares
     set active = false
   where id = p_id
  returning * into v_share;

  return jsonb_build_object('ok', true, 'id', v_share.id, 'active', v_share.active);
end
$$;

-- -----------------------------------------------------------------------------
-- 4. get_accident_portal_snapshot - the anon read.
--   Validates the token (active / expiry / bcrypt password), derives the org FROM
--   THE TOKEN ROW (no cross-org leak), bumps the view counters best-effort, and
--   returns a PII-lean case snapshot. Honest {ok:false, reason:...} on every
--   failure path. GRANT anon + authenticated; REVOKE PUBLIC.
-- -----------------------------------------------------------------------------
create or replace function public.get_accident_portal_snapshot(
  p_token    text,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_share       public.accident_portal_shares%rowtype;
  v_acc         public.accidents%rowtype;
  v_workstreams jsonb;
  v_claim       jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_share
    from public.accident_portal_shares
   where token = p_token;

  -- Unknown token = invalid; explicitly deactivated = revoked; past expiry = expired.
  if v_share.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not v_share.active then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_share.expires_at is not null and v_share.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Password gate (bcrypt), only when the link carries one.
  if v_share.password_hash is not null then
    if p_password is null or btrim(p_password) = ''
       or crypt(p_password, v_share.password_hash) <> v_share.password_hash then
      return jsonb_build_object('ok', false, 'reason', 'password');
    end if;
  end if;

  -- The case, scoped ONLY by the org carried on the token row.
  select * into v_acc
    from public.accidents a
   where a.id = v_share.accident_id
     and a.organisation_id = v_share.organisation_id;

  if v_acc.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  -- Record the view (best-effort, never blocks the snapshot).
  begin
    update public.accident_portal_shares
       set last_viewed_at = now(), view_count = view_count + 1
     where id = v_share.id;
  exception when others then null;
  end;

  -- Per-workstream status map: {workstream_key: status}. No owners, notes or PII.
  select coalesce(
           jsonb_object_agg(w.workstream_key, w.status)
             filter (where w.workstream_key is not null),
           '{}'::jsonb)
    into v_workstreams
    from public.accident_case_workstreams w
   where w.accident_id = v_share.accident_id;

  -- Claim STATUS summary only (latest claim). Decision token + reference identifiers.
  -- DELIBERATELY no deductible / approved_amount / settlement figures.
  select jsonb_build_object(
           'decision',             c.decision,
           'claim_no',             c.claim_no,
           'insurer',              c.insurer,
           'insurance_applicable', c.insurance_applicable,
           'claim_registered_date', c.claim_registered_date)
    into v_claim
    from public.accident_insurance_claims c
   where c.accident_id = v_share.accident_id
   order by c.created_at desc, c.id desc
   limit 1;

  return jsonb_build_object(
    'ok',             true,
    'reference_no',   v_acc.reference_no,
    'case_no',        v_acc.case_no,
    'incident_date',  v_acc.incident_date,
    'status',         v_acc.status,
    'workflow_stage', v_acc.workflow_stage,
    'case_status',    v_acc.case_status,
    'severity',       v_acc.severity,
    'workstreams',    v_workstreams,
    'claim',          coalesce(v_claim, jsonb_build_object('decision', 'not_required')),
    'generated_at',   now()
  );
end
$$;

-- -----------------------------------------------------------------------------
-- GRANTS
--   Mint / revoke: anon revoked, authenticated granted (in-body self-gate is the
--   boundary). Snapshot: anon + authenticated granted, PUBLIC revoked - it is the
--   only object an external party can reach, and only ever via a valid token.
-- -----------------------------------------------------------------------------
revoke all on function public.accident_portal_create(uuid,text,timestamptz) from anon;
revoke all on function public.accident_portal_revoke(uuid) from anon;

grant execute on function public.accident_portal_create(uuid,text,timestamptz) to authenticated;
grant execute on function public.accident_portal_revoke(uuid) to authenticated;

revoke all on function public.get_accident_portal_snapshot(text,text) from public;
grant execute on function public.get_accident_portal_snapshot(text,text) to anon, authenticated;

commit;
-- =============================================================================
