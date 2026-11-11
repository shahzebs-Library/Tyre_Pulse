-- STATUS: APPLIED 2026-11-11. Verified live: view is security_invoker=on, carries the 4
-- resolved columns, returns exactly the inspection set (2589 == inspections, RLS applies
-- per caller), 2390/2589 have an approver_name resolved (rest unapproved or deleted-signer
-- -> honest null). Backend half only; the client wiring below (point the inspection read at
-- this view / add the 4 columns) is the remaining follow-up - the view is additive and safe
-- without it. Applied as CREATE OR REPLACE VIEW (already DROP-free; the drop is rollback-only).
--
-- WHY: the inspection PDF and the on-screen sign-off printed a raw LOGIN EMAIL
-- (inspections.approver_email) or a raw user UUID (inspections.approved_by) for
-- the signer, because the inspection row carries no resolved name. The web
-- surfaces are fixed in client code (signerDisplay + a profiles lookup in the PDF
-- caller and the viewer). This view is the SINGLE-SOURCE option so that the web
-- viewer, the Flutter app and the public API can all read the signer's
-- full_name + employee_id from ONE place instead of each resolving it (or each
-- re-leaking the email).
--
-- SAFETY:
--   * DROP-free. `create or replace view` only; replacing a view body does not
--     drop or lock the base table.
--   * `security_invoker = on` so the view runs with the CALLER'S privileges: the
--     RLS on `inspections` (org + country isolation) and on `profiles` both
--     apply exactly as they do today. This adds NO new unscoped read -
--     `profiles_select` already admits every authenticated member, which is how
--     the app resolves names everywhere.
--   * The join is a LEFT JOIN, so an inspection whose signer profile cannot be
--     read (deleted account) still returns the row with null resolved fields;
--     the client then renders the honest fallback through signerDisplay.
--   * Country isolation is inherited from `inspections` (the view selects it
--     straight through); the view introduces no cross-country path.
--
-- WIRING (client, after this is applied + verified):
--   * Point the inspection detail read (getInspectionForPage / getInspection) at
--     v_inspection_signoff instead of `inspections`, OR add the four resolved
--     columns to the inspection read. The client fields already consumed by
--     signerDisplay are: approver_name, approver_employee_id, inspector_name,
--     inspector_employee_id. Once the row carries them, the PDF caller no longer
--     needs its own profiles lookup and the viewer no longer resolves in-effect.

create or replace view public.v_inspection_signoff with (security_invoker = on) as
select
  i.*,
  ap.full_name    as approver_name,
  ap.employee_id  as approver_employee_id,
  ins.full_name   as inspector_name,
  ins.employee_id as inspector_employee_id
from public.inspections i
left join public.profiles ap  on ap.id  = i.approved_by
left join public.profiles ins on ins.id = i.created_by;

comment on view public.v_inspection_signoff is
  'Inspections with the sign-off identities (approver = approved_by, inspector = created_by) resolved to full_name + employee_id. security_invoker, so inspections + profiles RLS both apply. Single source for the PDF, the web viewer, Flutter and the public API so none prints a login email or a raw user id.';

grant select on public.v_inspection_signoff to authenticated;

-- VERIFY (run as a real approved inspector, rolled back):
--   set local role authenticated;
--   select request.jwt.claims ...;  -- impersonate a KSA inspector
--   -- the view must return the SAME inspection rows as `inspections` (no wider
--   -- or narrower set) and must never return an inspection the caller cannot
--   -- see in `inspections` for their own country:
--   select count(*) from public.v_inspection_signoff;        -- == select count(*) from public.inspections
--   -- resolved names appear only where the profile is readable:
--   select approver_name, approver_employee_id from public.v_inspection_signoff
--     where approved_by is not null limit 5;
--
-- ROLLBACK: drop view public.v_inspection_signoff;
