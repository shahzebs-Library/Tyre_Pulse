-- =====================================================================
-- V601  A SAVED SIGNATURE, OWNED BY THE PERSON WHO DREW IT
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc + VERIFIED (see below)
-- =====================================================================
--
-- REPRODUCTION (what was wrong)
-- -----------------------------
-- Every approval on this system asks the approver to draw their signature from
-- scratch, every single time. Measured before writing anything:
--
--   * NO saved signature exists anywhere. `profiles` carries 29 columns and not
--     one of them holds a signature (checked against information_schema, 0 rows
--     matching '%sign%'), and no other table did either.
--   * 31 inspections are waiting for a sign-off right now, 379 have already been
--     approved, and every one of those 379 signatures was hand-drawn on the spot.
--   * 42 profiles, 38 of them active, are potential signers.
--
-- WHY THIS IS ITS OWN TABLE AND NOT A COLUMN ON `profiles`
-- --------------------------------------------------------
-- A column on `profiles` was the obvious home and it is the WRONG one, for a
-- reason that is visible in pg_policies rather than in the schema:
--
--     profiles_select : PERMISSIVE, SELECT, using (auth.role() = 'authenticated')
--     profiles_org_isolation : RESTRICTIVE, SELECT, same organisation
--
-- i.e. EVERY authenticated colleague in the organisation can read EVERY other
-- profile row. Storing a signature image there would hand all 38 active users a
-- pixel-perfect copy of everyone else's handwritten signature - a forgery kit,
-- created by a convenience feature. A signature is the one field on a person
-- that must not be readable by their colleagues.
--
-- So the signature lives in its own table whose ONLY policy is "this row is
-- mine": a user can read, write and delete their own signature and cannot see
-- that anyone else has one. No org column, deliberately - an org-scoped
-- predicate adds nothing to a row keyed on auth.uid() and would hide a person's
-- own signature from them the moment they were moved between organisations.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not sign anything. The approval RPCs (decide_checklist_approval,
-- decide_inspection_approval) are untouched: they still take p_signature from
-- the caller and still derive the approver identity, the timestamp and the lock
-- server-side. This table only spares a person from redrawing the same mark;
-- pressing Approve is still the act of approving.
--
-- VERIFICATION (run live, in a ROLLED BACK transaction, as two real users)
-- -----------------------------------------------------------------------
-- A = 9a3e487b (Tyre Data Collector), B = e864b410 (Tire Planning Engineer),
-- both real approved accounts, every probe inside a transaction that was rolled
-- back:
--
--   A inserts own row                    -> 1 row
--   A reads own row                      -> 1 row   <- the CONTROL. Without it a
--                                                      zero below would prove
--                                                      nothing but a dead probe.
--   B reads A's row                      -> 0 rows
--   B updates A's row                    -> 0 rows
--   B deletes A's row                    -> 0 rows
--   A inserts a row FOR B                -> REFUSED, 42501 row-level security
--
--   has_table_privilege('anon', ..., 'SELECT')          -> false
--   has_table_privilege('anon', ..., 'INSERT')          -> false
--   has_table_privilege('authenticated', ..., 'SELECT') -> true
--
-- ROLLBACK
-- --------
--   drop table if exists public.user_signatures;
-- =====================================================================

create table if not exists public.user_signatures (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- The stored mark. Either self-contained <svg> markup (what SignatureCapture
  -- and the field app emit) or a data: URL (what the canvas SignaturePad emits).
  -- Both are already rendered by signatureSrc() in SignatureView, so the column
  -- deliberately does not pick a side.
  signature  text not null,
  updated_at timestamptz not null default now(),
  constraint user_signatures_len_chk check (length(signature) between 1 and 200000)
);

comment on table public.user_signatures is
  'A person''s own saved signature, pre-filled into approval screens so they do '
  'not redraw it every time. Readable ONLY by its owner - see V601 for why this '
  'is not a column on profiles.';

alter table public.user_signatures enable row level security;

drop policy if exists user_signatures_select_own on public.user_signatures;
create policy user_signatures_select_own on public.user_signatures
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_signatures_insert_own on public.user_signatures;
create policy user_signatures_insert_own on public.user_signatures
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_signatures_update_own on public.user_signatures;
create policy user_signatures_update_own on public.user_signatures
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_signatures_delete_own on public.user_signatures;
create policy user_signatures_delete_own on public.user_signatures
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_signatures to authenticated;
-- V281 revoked anon across the schema and set default privileges; stated here
-- so a future reader does not have to go and check.
revoke all on public.user_signatures from anon;
