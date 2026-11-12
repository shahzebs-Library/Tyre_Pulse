-- Vehicle Handover: two-stage, auditor-ready sign-off (DB foundation).
--
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12 (every statement
-- below EXCEPT the clearly marked "OWNER TO PASTE" block at the very end, which
-- contains the delete keyword that hangs the Supabase MCP confirm gate in a
-- cloud session). Verified by rolled-back impersonation (footer).
--
-- WHY. handover_reports (V181) is a FLAT record: a driver captures a checkout /
-- checkin with their own field signature and that is the end of it. There is no
-- sign-off model, so a condition record used for damage attribution and cost
-- recovery is never reviewed. The owner's upgrade is a TWO-STAGE ladder modelled
-- on the checklist ladder (V594): the field record is captured and signed by the
-- driver, a FLEET SUPERVISOR signs it off, and only then the FLEET INCHARGE
-- closes it. The driver's own signature (signature_url) is untouched - it is the
-- field evidence, not a sign-off.
--
-- SHIPS ADDITIVE / DROP-FREE. Every ALTER is ADD COLUMN IF NOT EXISTS; every
-- function is CREATE OR REPLACE. approval_status defaults to 'pending_supervisor'
-- (the task contract): a freshly captured handover enters the supervisor queue,
-- and any pre-existing row virtually reads 'pending_supervisor' - i.e.
-- "captured, not yet signed off", the honest statement for a record that never
-- had a sign-off model. A constant DEFAULT is a catalog-only change: no table
-- rewrite, no ACCESS EXCLUSIVE lock. (At apply time the table held 0 rows - a
-- parallel session had just removed the one demo row - so the document_no
-- back-fill was a no-op.)
--
-- THE SQL decide_handover_approval AND src/lib/handoverApproval.js ARE A PAIR.
-- The role sets, the ladder transitions and the closes-in-one-sign rule are
-- mirrored in that JS module (pinned by src/test/handoverApproval.test.js) and
-- must change together, exactly as checklistApproval.js mirrors
-- decide_checklist_approval.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. Additive only. No DROP/DELETE/TRUNCATE is APPLIED (the one
--   delete-bearing statement is the OWNER-TO-PASTE immutability policy, left for
--   the SQL editor). The 1 existing handover row is preserved (document_no
--   back-filled only).
-- Rename / removal: none. signature_url, photo_url, report_no all KEPT.
-- Type change: none.
-- CHECK: new named CHECK on the NEW approval_status column only; its one value
--   today ('pending_supervisor', the default) is in the allow-list, so it cannot
--   invalidate the existing row.
-- Locks: constant DEFAULT + ADD COLUMN = catalog only (no rewrite). The inline
--   FK on supervisor_by/incharge_by takes a brief SHARE ROW EXCLUSIVE lock on a
--   1-row table (instant).
-- FK impact: supervisor_by / incharge_by reference profiles(id) ON DELETE NO
--   ACTION, so a profile that signed a handover cannot be hard-deleted (audit
--   preservation, mirrors checklist_submissions.supervisor_by). Indexed to keep
--   the performance advisor clean.
-- Triggers: BEFORE INSERT stamp (document_no) + BEFORE UPDATE guard (stage
--   integrity). The guard early-returns when approval_status is unchanged, so
--   ordinary field edits (odometer, notes, damages) are untouched. The
--   document_no back-fill UPDATE changes only document_no, so the guard
--   early-returns on it.
-- RLS: handover_reports already has RESTRICTIVE org isolation + permissive
--   per-command policies. We KEEP them: a member may still edit field data. The
--   BEFORE UPDATE guard is the forgery protection - a non-signer who tries to
--   change approval_status via a direct PostgREST UPDATE is refused 42501, so the
--   RPC is the server-stamped sign-off path.
-- SECURITY DEFINER: search_path pinned to public; the RPC re-checks org +
--   country in the body (handover has no site column); it takes NO org id, so it
--   is safe to grant to authenticated. Trigger/helper functions revoke
--   public/anon.
-- PostgREST: all raises use 42501 / 22023 / plain - never 40001.
-- Duration: 1 row touched. No batching needed.
-- Rollback: at the foot of this file.

-- ------------------------------------------------------------------- COLUMNS
alter table public.handover_reports
  add column if not exists approval_status      text    default 'pending_supervisor',
  add column if not exists supervisor_name      text,
  add column if not exists supervisor_signature text,
  add column if not exists supervisor_at        timestamptz,
  add column if not exists supervisor_by        uuid references public.profiles(id),
  add column if not exists incharge_name        text,
  add column if not exists incharge_signature   text,
  add column if not exists incharge_at          timestamptz,
  add column if not exists incharge_by          uuid references public.profiles(id),
  add column if not exists review_note          text,
  add column if not exists document_no          text,
  add column if not exists photos               jsonb   default '[]'::jsonb;

comment on column public.handover_reports.approval_status is
  'Two-stage ladder: draft -> pending_supervisor -> pending_incharge -> approved (or rejected). Default pending_supervisor.';
comment on column public.handover_reports.supervisor_name is
  'Fleet Supervisor who signed the first rung (server-stamped by decide_handover_approval).';
comment on column public.handover_reports.incharge_name is
  'Fleet Incharge who gave final approval (server-stamped). The driver''s own field signature stays in signature_url.';
comment on column public.handover_reports.review_note is
  'Reason recorded when a handover is sent back (rejected).';
comment on column public.handover_reports.document_no is
  'Auto-minted HND-<8 hex of id> at INSERT, mirroring inspections.document_no (INS-).';
comment on column public.handover_reports.photos is
  'General handover evidence photos as tp-storage://bucket/path refs (array). Per-marker damage photos stay inside damages jsonb; the single pasted photo_url is kept.';

-- Named CHECK on the new column (idempotent, no DROP token).
do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'handover_reports_approval_status_chk'
      and conrelid = 'public.handover_reports'::regclass
  ) then
    alter table public.handover_reports
      add constraint handover_reports_approval_status_chk
      check (approval_status in ('draft','pending_supervisor','pending_incharge','approved','rejected'));
  end if;
end
$chk$;

create index if not exists idx_handover_reports_approval_status on public.handover_reports (approval_status);
create index if not exists idx_handover_reports_supervisor_by   on public.handover_reports (supervisor_by);
create index if not exists idx_handover_reports_incharge_by     on public.handover_reports (incharge_by);

-- ----------------------------------------------------------- WHO SIGNS WHAT
-- Supervisor rung: a Fleet Supervisor, any elevated role (Admin/Manager/
-- Director), a Fleet Incharge (a higher rung can act on a lower one - this is
-- what lets an incharge close in one sign), or a super admin.
create or replace function public.handover_can_sign_supervisor()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_super_admin()
      or public.app_is_elevated()
      or public.get_my_role() = any (array['Fleet Supervisor','Fleet Incharge']);
$fn$;

-- Incharge rung (final close): the Fleet Incharge, Admin (break-glass - exactly
-- one person holds Fleet Incharge and a queue only they can clear jams on leave,
-- same reasoning as Director on the checklist area-manager rung), or a super
-- admin. Deliberately NOT Manager/Director: they sign the supervisor rung only.
create or replace function public.handover_can_sign_incharge()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_super_admin()
      or public.get_my_role() = any (array['Admin','Fleet Incharge']);
$fn$;

revoke all on function public.handover_can_sign_supervisor() from public, anon;
revoke all on function public.handover_can_sign_incharge()   from public, anon;
grant execute on function public.handover_can_sign_supervisor() to authenticated;
grant execute on function public.handover_can_sign_incharge()   to authenticated;

-- --------------------------------------------------- document-number minting
-- HND-<first 8 hex of id, uppercase>, mirroring stamp_inspection_document_no
-- (INS-). BEFORE INSERT so the number exists the moment the row lands, including
-- a row replayed from the phone's offline queue days later. Column defaults
-- (id = gen_random_uuid()) are computed before BEFORE-INSERT triggers, so new.id
-- is already populated.
create or replace function public.stamp_handover_document_no()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.document_no is null and new.id is not null then
    new.document_no := 'HND-' || upper(left(replace(new.id::text, '-', ''), 8));
  end if;
  return new;
end
$fn$;
revoke all on function public.stamp_handover_document_no() from public, anon, authenticated;

create trigger trg_aa_stamp_handover_document_no
  before insert on public.handover_reports
  for each row execute function public.stamp_handover_document_no();

-- ------------------------------------------------------ the stage-gate itself
-- "The RPC is the only sign-off path": a direct PostgREST UPDATE cannot forge a
-- stage change. The guard POLICES only the sign-off transitions (into
-- pending_incharge / approved / rejected); moving among the pre-sign-off states
-- (draft <-> pending_supervisor) is a normal creator action and is left open, as
-- is a field-only edit (approval_status unchanged -> early return).
create or replace function public.guard_handover_approval_stages()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;

  -- Pre-sign-off states: save-draft / submit-for-sign-off. Forges nothing.
  if new.approval_status in ('draft','pending_supervisor') then
    return new;
  end if;

  if new.approval_status = 'rejected' then
    if not public.handover_can_sign_supervisor() then
      raise exception 'You do not have permission to send this handover back.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approval_status = 'pending_incharge' then
    if not public.handover_can_sign_supervisor() then
      raise exception 'Only a fleet supervisor can sign off this handover.' using errcode = '42501';
    end if;
    if coalesce(btrim(new.supervisor_signature), '') = '' then
      raise exception 'A supervisor signature is required.' using errcode = '22023';
    end if;
    new.supervisor_by := coalesce(new.supervisor_by, auth.uid());
    new.supervisor_at := coalesce(new.supervisor_at, now());
    return new;
  end if;

  if new.approval_status = 'approved' then
    -- Reached from pending_incharge normally, or from pending_supervisor when an
    -- incharge-signer closes in one sign. Both require incharge authority AND a
    -- completed supervisor rung.
    if not public.handover_can_sign_incharge() then
      raise exception 'Only the fleet incharge can give final approval on this handover.' using errcode = '42501';
    end if;
    if coalesce(btrim(coalesce(new.supervisor_signature, old.supervisor_signature)), '') = '' then
      raise exception 'A supervisor must sign off before the fleet incharge can approve.' using errcode = '22023';
    end if;
    if coalesce(btrim(coalesce(new.incharge_signature, old.incharge_signature)), '') = '' then
      raise exception 'A fleet incharge signature is required.' using errcode = '22023';
    end if;
    new.incharge_by := coalesce(new.incharge_by, auth.uid());
    new.incharge_at := coalesce(new.incharge_at, now());
    return new;
  end if;

  raise exception 'That is not a valid handover sign-off transition.' using errcode = '22023';
end
$fn$;
revoke all on function public.guard_handover_approval_stages() from public, anon, authenticated;

create trigger trg_guard_handover_approval_stages
  before update on public.handover_reports
  for each row execute function public.guard_handover_approval_stages();

-- ---------------------------------------------------------------- the writer
-- The server-stamped sign-off path. Mirrors decide_checklist_approval. Takes NO
-- org id, so it is safe to grant to authenticated. closesInOneSign: at
-- pending_supervisor an incharge-signer (Admin / super / Fleet Incharge) closes
-- both rungs with one signature, written to BOTH slots.
create or replace function public.decide_handover_approval(
  p_id uuid, p_approved boolean, p_signature text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_org     uuid;
  v_name    text;
  v_status  text;
  v_country text;
  v_target  text;
  v_both    boolean := false;
  v_prev    text;
begin
  -- cap-guard: an explicit per-user revoke of handover approve blocks everyone.
  if public.app_cap_revoked('handover', 'approve') then
    raise exception 'You are not permitted to approve or decide this handover.' using errcode = '42501';
  end if;

  if not (public.handover_can_sign_supervisor()
          or public.handover_can_sign_incharge()
          or public.app_cap_granted('handover', 'approve')) then
    raise exception 'Only an approver can sign off a vehicle handover.' using errcode = '42501';
  end if;

  v_org := public.app_current_org();

  select hr.approval_status, hr.country
    into v_status, v_country
    from public.handover_reports hr
   where hr.id = p_id
     and (hr.organisation_id = v_org or public.is_super_admin())
     -- Country boundary (handover has no site column).
     and public.app_write_country_ok(hr.country);

  if v_status is null then
    raise exception 'That handover no longer exists.' using errcode = '22023';
  end if;

  if v_status = 'draft' then
    raise exception 'This handover has not been submitted for sign-off yet.' using errcode = '22023';
  end if;

  if v_status not in ('pending_supervisor','pending_incharge') then
    select coalesce(pr.full_name, pr.username, 'another approver')
      into v_prev
      from public.handover_reports hr
      left join public.profiles pr on pr.id = coalesce(hr.incharge_by, hr.supervisor_by)
     where hr.id = p_id;
    raise exception 'This handover was already % by %.', v_status, coalesce(v_prev, 'another approver');
  end if;

  select coalesce(full_name, username, 'Approver')
    into v_name from public.profiles where id = auth.uid();

  -- ---- rejection (send back) ----
  if not p_approved then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'A reason is required to send a handover back.' using errcode = '22023';
    end if;
    if not public.handover_can_sign_supervisor() then
      raise exception 'You do not have permission to send this handover back.' using errcode = '42501';
    end if;
    update public.handover_reports
       set approval_status = 'rejected', review_note = p_note
     where id = p_id and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
    if not found then
      raise exception 'This handover was decided by someone else while you were looking at it.';
    end if;
    return jsonb_build_object('ok', true, 'decision', 'rejected', 'status', 'rejected', 'both_steps', false);
  end if;

  -- ---- approval ----
  if coalesce(btrim(p_signature), '') = '' then
    raise exception 'A signature is required to sign off this handover.' using errcode = '22023';
  end if;

  if v_status = 'pending_supervisor' then
    if not public.handover_can_sign_supervisor() then
      raise exception 'Only a fleet supervisor can sign off this handover.' using errcode = '42501';
    end if;
    -- An incharge-signer (Admin / super / Fleet Incharge) closes both rungs now.
    if public.handover_can_sign_incharge() then
      v_target := 'approved';
      v_both   := true;
    else
      v_target := 'pending_incharge';
    end if;
  else  -- pending_incharge
    if not public.handover_can_sign_incharge() then
      raise exception 'Only the fleet incharge can give final approval on this handover.' using errcode = '42501';
    end if;
    v_target := 'approved';
  end if;

  if v_target = 'pending_incharge' then
    update public.handover_reports
       set approval_status      = 'pending_incharge',
           supervisor_by        = auth.uid(),
           supervisor_name      = v_name,
           supervisor_signature = p_signature,
           supervisor_at        = now(),
           review_note          = p_note
     where id = p_id and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  else
    update public.handover_reports
       set approval_status      = 'approved',
           supervisor_by        = case when v_both then auth.uid()  else supervisor_by        end,
           supervisor_name      = case when v_both then v_name      else supervisor_name      end,
           supervisor_signature = case when v_both then p_signature else supervisor_signature end,
           supervisor_at        = case when v_both then now()       else supervisor_at        end,
           incharge_by          = auth.uid(),
           incharge_name        = v_name,
           incharge_signature   = p_signature,
           incharge_at          = now(),
           review_note          = p_note
     where id = p_id and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  end if;

  if not found then
    raise exception 'This handover was decided by someone else while you were looking at it.';
  end if;

  return jsonb_build_object('ok', true, 'decision', 'approved', 'status', v_target, 'both_steps', v_both);
end
$fn$;
revoke all on function public.decide_handover_approval(uuid, boolean, text, text) from public, anon;
grant execute on function public.decide_handover_approval(uuid, boolean, text, text) to authenticated;

-- ------------------------------------------------- back-fill the one row's doc no
update public.handover_reports
   set document_no = 'HND-' || upper(left(replace(id::text, '-', ''), 8))
 where document_no is null;

-- ------------------------------------------------------------ seed the new role
-- Fleet Incharge is a first-class custom role, mirroring the Fleet Supervisor
-- row (V282 lets it be assigned without a schema change). organisation_id is set
-- EXPLICITLY - its default app_current_org() is NULL outside a user session and
-- a NULL-org role is invisible to everyone (the V395 trap).
insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001'::uuid,
       'Fleet Incharge',
       'Gives final approval on a two-stage vehicle handover sign-off (the second rung above Fleet Supervisor).',
       true
where not exists (
  select 1 from public.custom_roles
  where name = 'Fleet Incharge'
    and organisation_id = '00000000-0000-0000-0000-000000000001'::uuid
);


-- ============================================================================
-- OWNER TO PASTE IN THE SUPABASE SQL EDITOR (NOT applied here - the `delete`
-- keyword in a DELETE policy hangs the Supabase MCP human-confirm gate in a
-- cloud session). This makes an APPROVED handover an immutable record: nobody
-- but a super admin may delete it. Run it once in the SQL editor.
--
--   drop policy if exists handover_reports_delete on public.handover_reports;
--   create policy handover_reports_delete on public.handover_reports for delete
--     using (
--       auth.uid() is not null
--       and (approval_status is distinct from 'approved' or public.is_super_admin())
--     );
-- ============================================================================


-- ============================================================================
-- VERIFY (impersonation, each in its own rolled-back transaction) - results in
-- the migration-session report. Real Company A users used:
--   Fleet Supervisor  8e4269b1-a0a5-46f3-b3f7-8b7964b87994
--   super admin/Admin  d2d43a5f-0906-4f7a-9577-e36d89164914
--   Reporter          33e40d9c-e1e7-4ccd-972e-d88e1bfcb11a (plain non-signer)
--   Tyre Man          1cd74900-64fe-4f3a-913c-b9060f088ff3 (plain non-signer)
-- Fleet Incharge: no user holds the role yet, so the proof temporarily sets a
-- test profile's role to 'Fleet Incharge' inside the same rolled-back txn.
-- ============================================================================
-- ROLLBACK:
--   drop trigger trg_guard_handover_approval_stages on public.handover_reports;
--   drop trigger trg_aa_stamp_handover_document_no on public.handover_reports;
--   drop function public.decide_handover_approval(uuid, boolean, text, text);
--   drop function public.guard_handover_approval_stages();
--   drop function public.stamp_handover_document_no();
--   drop function public.handover_can_sign_incharge();
--   drop function public.handover_can_sign_supervisor();
--   delete from public.custom_roles
--     where name='Fleet Incharge' and organisation_id='00000000-0000-0000-0000-000000000001';
--   alter table public.handover_reports
--     drop constraint if exists handover_reports_approval_status_chk,
--     drop column approval_status, drop column supervisor_name,
--     drop column supervisor_signature, drop column supervisor_at, drop column supervisor_by,
--     drop column incharge_name, drop column incharge_signature, drop column incharge_at,
--     drop column incharge_by, drop column review_note, drop column document_no, drop column photos;
--   -- (document_no back-fill reverts with the column drop)
