-- V596 - LOCK DOWN THE V594/V595 FUNCTIONS. Found by auditing my own work.
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc 2026-08-18 and verified.
--
-- Supabase grants EXECUTE to PUBLIC at CREATE time, so a new function arrives
-- anon-executable unless something says otherwise. All six V594/V595 functions
-- did. Five of them leaked nothing (a role helper returns false with no JWT; a
-- trigger function refuses a direct call), but one was a genuine hole:
--
--   next_checklist_document_no IS SECURITY DEFINER AND TAKES p_org.
--   Any signed-in user could call it with ANOTHER organisation's uuid and
--   increment that tenant's document counter. No business data moves, but it is
--   a cross-org WRITE, and it is the exact V378 shape this project has already
--   been bitten by: a DEFINER helper that accepts an org id must never be
--   executable by `authenticated`.
--
-- Nothing legitimate calls it directly. Its only caller is
-- stamp_checklist_document_no, a DEFINER trigger owned by postgres, which
-- reaches it through OWNERSHIP rather than through a grant - which is why
-- revoking it from authenticated does not break minting. That was measured, not
-- assumed (see the footer).

revoke all on function public.next_checklist_document_no(uuid, text, text, integer) from public, anon, authenticated;

-- Trigger functions need no EXECUTE grant to fire, and a direct call fails with
-- "can only be called as a trigger" anyway.
revoke all on function public.stamp_checklist_document_no() from public, anon, authenticated;
revoke all on function public.guard_checklist_approval_stages() from public, anon, authenticated;

-- ORDER IS LOAD-BEARING (the V500 lesson, twice over):
--   a REVOKE from anon is a NO-OP against a PUBLIC grant, and
--   a REVOKE from PUBLIC also strips `authenticated`, which reaches these
--   THROUGH public and has no grant of its own.
-- So: grant first, then revoke public, then revoke anon by name.
grant execute on function public.checklist_is_supervisor() to authenticated, service_role;
grant execute on function public.checklist_is_area_manager() to authenticated, service_role;
grant execute on function public.checklist_last_submission(uuid, text) to authenticated, service_role;
revoke all on function public.checklist_is_supervisor() from public;
revoke all on function public.checklist_is_area_manager() from public;
revoke all on function public.checklist_last_submission(uuid, text) from public;
revoke all on function public.checklist_is_supervisor() from anon;
revoke all on function public.checklist_is_area_manager() from anon;
revoke all on function public.checklist_last_submission(uuid, text) from anon;

-- VERIFIED AFTER APPLY:
--   anon EXECUTE now FALSE on all six (was true on five).
--   authenticated EXECUTE on next_checklist_document_no now FALSE.
--   THE THING THAT COULD HAVE BROKEN: as the real KSA Manager, inserting a
--   submission still minted WDC-TM999-2026-0001, so the trigger does reach the
--   minting function through ownership. checklist_is_supervisor() still returns
--   true for that Manager. Probe rows deleted afterwards.
--
-- ROLLBACK (not recommended - it re-opens the cross-org write):
--   grant execute on function public.next_checklist_document_no(uuid,text,text,integer) to public;
--   grant execute on function public.checklist_is_supervisor() to public;
--   grant execute on function public.checklist_is_area_manager() to public;
--   grant execute on function public.checklist_last_submission(uuid,text) to public;
--   grant execute on function public.stamp_checklist_document_no() to public;
--   grant execute on function public.guard_checklist_approval_stages() to public;
