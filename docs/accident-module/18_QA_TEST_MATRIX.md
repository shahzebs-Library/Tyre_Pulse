# 18 - ACCIDENT MODULE QA TEST MATRIX (rolled-back live verification)

Object-by-object verification matrix for activation. Every RPC, trigger and policy
enumerated below is grounded in what the SQL in `02_DATA_MODEL.sql` and files
`10`-`17` ACTUALLY defines (grepped, not invented). Each row gives the object, the
file it lives in, a concrete rolled-back live test (a real user, exact inputs, the
expected `{ok,...}` result AND the expected refusal for a wrong-org / non-elevated /
missing-capability caller), and the honest-null cases to assert.

Coverage: this matrix covers 48 objects - the closure guard trigger + function, the
RLS policy families and the Part-A backfill in `02`; the 35 RPCs/functions across
files 10-17; the 5 emit triggers + 1 consumer in `11`; and the 4 policies on
`accident_portal_shares` in `16`.

## Parity (change both, together)
- `src/lib/accidentCase.js` <-> `08_ENGINE_SQL_MIRROR.sql`. The workstream keys, the
  twelve workstream-status tokens, the NON_WAIVABLE spine (`incident_evidence` /
  `liability` / `finance`), the three closure levels and the closure gate
  (`canFullyClose` <-> `accident_can_fully_close`) are one contract with two copies.
  Files 10-15 inline the SAME token lists verbatim; change the engine, the mirror and
  the RPC token arrays in one commit.
- `src/lib/accidentCaseAnalytics.js` <-> `17_REPORTING_RPCS.sql`. `caseStatusBreakdown`
  / `byWorkstreamBottleneck` / `avgTimeToClose` / `slaBreachRate` / `reopenRate` are
  the JS spec the three reporting RPCs mirror 1:1; the closed / open / reopened
  predicates (`isGenuinelyClosed` / `isOpenCase` / `wasReopened`) are copied verbatim.
  If a shape diverges, change both.

---

## How to run every test (harness + discipline)

- ALL tests run inside ONE transaction and are ROLLED BACK. Nothing persists.
  ```sql
  begin;
  -- impersonate a real user (see the roster), call the object, assert, then:
  rollback;
  ```
- IMPERSONATE a real user, never the bare MCP / service role. `app_current_org()` is
  NULL for the service role, so org scoping never engages and a scoping bug is masked.
  Set the request context to a real profile before each call:
  ```sql
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<profile-uuid>","role":"authenticated"}';
  -- (or use the project's impersonation helper that stamps auth.uid())
  ```
- USER ROSTER (from PROJECT_MEMORY; all data lives in Company A
  `00000000-0000-0000-0000-000000000001`):
  - SUPER: `zebkhan311@gmail.com` (id `d2d43a5f-0906-4f7a-9577-e36d89164914`),
    `is_super_admin=true`, country NULL = all countries. Passes every gate.
  - ELEVATED KSA: a KSA-scoped Manager/Director (`app_is_elevated()` true, country
    `['KSA']`). Can act on any KSA case, refused on an Egypt case by country scope.
  - ELEVATED EGYPT: an Egypt-scoped Director. Can act on Egypt cases only.
  - CAP-ONLY INSURANCE: a non-elevated custom role granted `accidents:edit_insurance`
    ONLY, scoped to KSA. Drives the claim/document chain, refused on repair/finance.
  - CAP-ONLY WORKSHOP: non-elevated, granted `accidents:execute_repair` only.
  - CAP-ONLY FINANCE: non-elevated, granted `accidents:post_cost` only.
  - REPORTER: an approved user with NO accident capability. Refused on every write RPC;
    may read what RLS allows.
- SAMPLE CASES: pick one live KSA accident id and one live Egypt accident id. The
  cross-org / cross-country refusal test uses the Egypt case against a KSA-scoped user.
- ROLLED-BACK CLOSURE TESTS: because file 10's `accident_decide_closure` and the file
  02 guard both read `accident_closure_reviews`, a full closure test seeds a workstream
  set + an approved review INSIDE the same transaction, asserts, then rolls back.

---

## Security assertions checklist (every DEFINER RPC MUST pass)

Run this checklist against each SECURITY DEFINER function in files 02 + 10-16 (the
reporting RPCs in 17 are SECURITY INVOKER - see their own note). A row that fails any
line is a GO blocker.

1. anon is REVOKED. `select has_function_privilege('anon', '<fn>(<sig>)', 'execute')`
   returns false. (Files 10/12/13/14/15/16 all carry the `revoke all ... from anon`;
   verify it took.)
2. search_path is PINNED. `select proconfig from pg_proc` for the fn contains
   `search_path=public` (or `public, extensions` for `accident_portal_create` /
   `get_accident_portal_snapshot`, which need pgcrypto per the V259 lesson). No DEFINER
   fn runs with a mutable search_path.
3. `prosecdef = true` for every mutating RPC (DEFINER); `false` (INVOKER) only for the
   three reporting RPCs in 17 and (by design) nothing else.
4. ORG re-checked in-body. Impersonate a KSA-scoped user and call with an Egypt case
   id: expect `42501` "Not permitted for this organisation." (raised inside
   `_accident_rpc_context`, or the fn's own org check for `accident_portal_revoke` /
   `accident_claim_decision` / the SLA fns).
5. COUNTRY + SITE re-checked in-body. A user whose scope excludes the case country/site
   is refused with `42501` even though they are in the same org. `_accident_rpc_context`
   asserts `app_can_see_country()` AND `app_can_see_site()`; the SLA fns assert org via
   the accident lookup.
6. CAPABILITY-gated. A REPORTER (no cap) is refused `42501`; a cap-only user is allowed
   for THEIR workstream and refused `42501` for a different workstream's action
   (segregation of duties). Elevated always passes.
7. authenticated is GRANTED execute (the in-body self-gate is the real boundary, not the
   grant).
8. The anon SNAPSHOT exception: `get_accident_portal_snapshot` is the ONLY object granted
   to anon; it derives the org FROM THE TOKEN ROW and returns PII-lean data only. Assert
   it exposes NO amount / deductible / settlement / driver keys.

---

## Phase: DATA MODEL (`02_DATA_MODEL.sql`, V417)

### enforce_accident_closure() + trigger trg_enforce_accident_closure
- File: 02_DATA_MODEL.sql (function ~L1461, trigger ~L1503). SECURITY DEFINER, no admin
  bypass by design.
- Test (blocked path): as an ELEVATED KSA user, on a case with NO approved fully_closed
  review, `update public.accidents set closure_level='fully_closed' where id=<ksa>`.
  Expect refusal `42501` "no approved fully_closed closure review on record". Same for
  `set case_status='closed'`.
- Test (allowed path): seed an `accident_closure_reviews` row (level `fully_closed`,
  decision `approved`) for the case in the same txn, then the same update SUCCEEDS.
- Refusal shape: even a super-admin is gated (the guard has no admin bypass) - assert the
  super also cannot flip to `fully_closed` without the approved review.
- Honest-null / legacy: the guard fires ONLY on a transition INTO closed (is-distinct-from
  guarded), so a legacy status/register write that does not touch `closure_level` /
  `case_status` is untouched - assert an unrelated `update accidents set severity=...`
  still succeeds.

### Part-A backfill (case_no + closure_level)
- File: 02_DATA_MODEL.sql PART A (~L154-L306).
- Test: after V417, `select count(*) filter (where case_no is null)` = 0 and
  `count(*) filter (where closure_level is null)` = 0 over all live accidents.
- Honest-null / honesty: a legacy CLOSED row reads `closure_level='legacy_closed'`, NEVER
  `fully_closed`, and carries `case_flags->>'closure_basis' = 'backfilled'`. Assert
  `select count(*) where closure_level='fully_closed' and case_flags->>'closure_basis'='backfilled'`
  = 0 (no legacy row was falsely upgraded to a verified full closure). `case_no` is
  derived from `reference_no` (numbers agree) - `where case_no is null` guards re-runs, so
  a second apply touches 0 rows.

### CHECK constraints chk_accident_closure_level / chk_accident_case_status
- File: 02_DATA_MODEL.sql (~L193 and its case_status sibling).
- Test: a raw `update accidents set closure_level='done'` is rejected `23514`. Valid
  tokens: `open` / `operationally_completed` / `financially_open` / `fully_closed` /
  `legacy_closed` (NULL allowed).

### RLS write policy family - Group A operational tables (`<t>_write`)
- File: 02_DATA_MODEL.sql PART E (~L1235-L1247), generated over the 25 group_a tables.
- Test (capability): as CAP-ONLY INSURANCE (has `edit_insurance`), a direct PostgREST
  INSERT into `accident_insurance_claims` for a KSA case SUCCEEDS; the SAME insert into
  `accident_repair_orders` (owning cap `approve_repair`) is refused by RLS (0 rows /
  policy violation). REPORTER refused on both.
- Test (country/site in WITH CHECK): a KSA-scoped user inserting a row whose `country`
  is `Egypt` is refused even for a table they own the cap on (the WITH CHECK asserts
  `app_can_see_country(country) AND app_can_see_site(site)`), proving the money/liability
  write cannot cross scope.
- Test (scope isolation, SELECT): the `_country_isolation` / `_site_isolation`
  RESTRICTIVE SELECT policies hide an Egypt case's child rows from a KSA-scoped user -
  assert a KSA user's select over `accident_evidence` returns 0 Egypt rows.

### RLS policy family - Group B config tables (`<t>_write`)
- File: 02_DATA_MODEL.sql PART E (~L1258-L1280), over the 5 group_b config tables
  (`accident_evidence_requirements`, `accident_sla_definitions`, `accident_route_profiles`,
  `accident_type_profiles`, `accident_country_rule_profiles`). Org-shared, no country/site
  scoping (config is org-wide).
- Test: config write requires `app_is_elevated()` - a REPORTER or a cap-only user is
  refused an INSERT into `accident_sla_definitions`; an ELEVATED user succeeds. Read is
  `app_is_active()` for any approved user in the org. Cross-org isolation: a user in
  another org sees 0 of Company A's config rows.

---

## Phase: WORKSTREAM RPCs (`10_WORKSTREAM_RPCS.sql`)

### _accident_ws_cap(text) [internal helper, IMMUTABLE]
- Test: `select public._accident_ws_cap('liability')` = `approve_liability`;
  `('insurance')` = `edit_insurance`; `('unknown')` = NULL (caller decides how to gate).
- Security: revoked from PUBLIC; reads only its argument (no I/O), IMMUTABLE.

### _accident_rpc_context(uuid) [internal helper, DEFINER]
- Test (resolve): returns `(org, country, site)` for a real accident id.
- Refusal: NULL id -> `22023`; unknown id -> `P0002`; a KSA-scoped caller on an Egypt
  case -> `42501` "Not permitted for this organisation." (org check) or "...country/site
  scope." (scope check). This is the shared re-assertion every RPC in 10/13/14/15/16 calls
  first - if it passes here, the org/country/site line of the security checklist is proven
  for all of them.

### accident_ws_set_status(uuid,text,text,text)
- Test (ok): ELEVATED KSA, `('<ksa>','liability','in_progress')` -> `{ok:true,workstream:{...}}`;
  upsert is idempotent on `(accident_id, workstream_key)` and stamps `started_at` on
  `in_progress`, `completed_at` on `completed`.
- Refusal (validation): a status typo `'in_progres'` -> `22023` "Invalid workstream
  status"; an unknown key `'liabilty'` -> `22023` "Unknown workstream".
- Refusal (cap): CAP-ONLY WORKSHOP (has `execute_repair`, not `validate`) calling on the
  `liability` workstream -> `42501` "Not permitted to update this workstream" (gate is
  elevated OR owning cap OR `validate`). REPORTER -> `42501`.
- Refusal (scope): KSA user on the Egypt case -> `42501`.

### accident_ws_mark_na(uuid,text,text,uuid)
- Test (ok): ELEVATED, `('<ksa>','assessment','No damage', <approver-uuid>)` ->
  `{ok:true}`; writes `status=not_required`, `not_applicable=true`, `na_reason/na_by/na_at`,
  AND an `accident_case_approvals` row (`approval_type='na_waiver'`, decision `approved`).
- Refusal (NON_WAIVABLE spine): key `'incident_evidence'` / `'liability'` / `'finance'`
  -> `42501` "mandatory and cannot be marked not applicable" - refused no matter who
  approves.
- Refusal (approval mandatory): a valid waivable key with `p_approved_by = NULL` ->
  `42501` "An approver is required" (a bare switch-off does NOT satisfy the closure gate).
  Blank reason -> `22023`.
- Refusal (cap/scope): REPORTER -> `42501`; KSA user on Egypt case -> `42501`.

### accident_ws_assign(uuid,text,uuid,text,text)
- Test (ok): promotes a fresh (`not_started`/null) workstream to `assigned`; leaves an
  already `in_progress` one on its status; upserts owner/role/team + `assigned_at`.
- Refusal: unknown key -> `22023`; non-owning-cap non-elevated non-`validate` user ->
  `42501`; KSA user on Egypt case -> `42501`.

### accident_task_create(uuid,text,text,uuid,text,text,text,timestamptz,text)
- Test (ok): `('<ksa>','Photograph damage', 'incident_evidence', ...)` -> `{ok:true,task}`
  with status `assigned` when an assignee is given, else `open`.
- Refusal (validation): blank title -> `22023`; priority `'urgent'` -> `22023` (allowed:
  low/medium/high/critical); unknown workstream key -> `22023`.
- Refusal (cap/scope): REPORTER (no `submit`/`validate`/owning cap) -> `42501`; KSA user
  on Egypt case -> `42501`.

### accident_task_complete(uuid,text)
- Test (ok): the task's ASSIGNEE completes their own task -> `{ok:true}`, stamps
  `completed_at/by`; a note appends to description.
- Test (idempotent): completing an already `completed`/`cancelled` task -> `{ok:true,
  unchanged:true}` (no error).
- Refusal: NULL/unknown task id -> `22023`/`P0002`; a non-assignee non-elevated user
  without the workstream cap -> `42501`; scope re-asserted via the task's parent case.

### accident_request_closure(uuid,text,text,uuid)
- Test (ok): ELEVATED or `close_case`, `('<ksa>','fully_closed','ready')` -> `{ok:true,
  review}` with decision `returned` (= submitted / awaiting decision), blockers `[]`.
- Refusal (validation): level `'done'` -> `22023` (valid: operationally_completed /
  financially_open / fully_closed).
- Refusal (cap): a `fully_closed` request needs elevated OR `close_case`; a `submit`-only
  user requesting `fully_closed` -> `42501`. Interim levels also allow `submit`.
- Refusal (scope): KSA user on Egypt case -> `42501`.

### accident_decide_closure(uuid,text,text,uuid,text,jsonb)
- Test (ok, non-full): ELEVATED or `close_case`, decide an interim level `approved` ->
  `{ok:true,review}` with `reviewed_at` set.
- Test (CLOSURE GATE, the critical one): an APPROVED `fully_closed` decision on a case
  with OPEN blockers must be refused `42501` "Closure gate not satisfied: [...blockers]"
  - the RPC delegates to `accident_can_fully_close(...)` (V418 mirror) BEFORE writing the
  approved review, precisely so the file 02 guard cannot then be satisfied by a review
  minted without the gate check. Seed a satisfied workstream set in the same txn and the
  approved `fully_closed` decision SUCCEEDS.
- Refusal (validation): bad decision token -> `22023`; bad level -> `22023`; non-array
  blockers -> `22023`.
- Refusal (cap): only elevated OR `close_case` decides; a `submit`-only user -> `42501`.
- Note: this RPC records the reviewed decision on the ledger ONLY; it never flips
  `accidents.closure_level` itself (that is the later derive/close action, still gated by
  the file 02 trigger). Assert `accidents.closure_level` is UNCHANGED after the call.
- Gate-absent fallback: when the V418 mirror is not present (`to_regprocedure` NULL) the
  review is still recorded and the V417 trigger remains the closure floor - assert the
  file 02 guard still blocks the subsequent `accidents` update.

---

## Phase: NOTIFICATIONS (`11_NOTIFICATIONS.sql`)

Emit is via the generic V96 `trg_emit_domain_event` (swallows its own exceptions, so an
event can never break the case write). Delivery reuses the live domain-event bus +
`workflow_notifications` pipeline. Ships INERT for email (gated by
`system_config.accident_emails_enabled`, seeded false); in-app notifications always fire.

### Emit triggers (5): trg_ws_assigned_ins / trg_ws_assigned_upd / trg_appr_requested_ins / trg_closure_requested_ins / trg_closure_decided_upd
- File: 11_NOTIFICATIONS.sql PART 1.
- Test (workstream): assign a workstream owner -> exactly ONE `domain_events` row
  `accident.workstream_assigned` (INSERT trigger fires only WHEN `owner_id IS NOT NULL`;
  UPDATE fires only when `owner_id` is DISTINCT). Assert a reassign (release then new
  assign) notifies once per change, not per unrelated column update.
- Test (approval): insert an `accident_case_approvals` row with `decision='pending'` ->
  one `accident.approval_requested` event; a non-pending row emits nothing.
- Test (closure): insert a closure review with `reviewed_at IS NULL` ->
  `accident.closure_requested`; UPDATE that sets `reviewed_at` (from NULL) ->
  `accident.closure_decided`.
- Honest-null: `accident_id` is whitelisted on every payload so the consumer can link the
  in-app notification to the case; a payload key not present on the row is simply omitted
  (schema drift can never raise).

### consume_event_accident_case_notify(domain_events) [DEFINER, cron-only]
- File: 11_NOTIFICATIONS.sql PART 2 + registration in PART 3.
- Security: EXECUTE REVOKED from PUBLIC/anon/authenticated (only the pg_cron dispatcher
  calls it) - assert `has_function_privilege('authenticated', ...)` = false.
- Test (in-app always): after a workstream assignment, exactly one `notifications` row is
  written to the assigned owner (entity_type `accident`, entity_id = the case). For
  approvals / closures the elevated approver pool (Admin/Manager/Director) scoped to org
  + payload country receives it.
- Test (email gate): with `accident_emails_enabled` false (default) the consumer returns
  after the in-app insert - assert `workflow_notifications` gets 0 rows. Flip it to
  `true`, repeat -> one `workflow_notifications` row enqueued.
- Honest-null (0 recipients): when the resolved recipient set is empty, the enqueued
  `workflow_notifications` row is status `'skipped'`, NEVER a phantom `pending` send.
  Assert `recipient_count = 0` maps to `status='skipped'`.
- Country scoping: a KSA-payload event never targets an Egypt-only profile (a same-code
  case in another country is not notified).

---

## Phase: SLA ENGINE (`12_SLA_ENGINE.sql`)

Additive columns first: `warned_at` / `warned_notified` / `breached_at` /
`breached_notified` (the V305 once-only dedupe analogue) + a partial scan index.

### accident_sla_start(uuid,text)
- Test (ok): ELEVATED KSA, `('<ksa>','fleet_validation')` -> integer count of timers
  created (one per active matching `accident_sla_definitions` row). Re-run -> 0 created
  (idempotent: skips a definition that already has a running/paused timer, so re-entering
  a workstream never double-counts the clock).
- Refusal: non-elevated user -> `42501` (this engine is elevated-only, V346 convention);
  NULL id or blank key -> `22023`; a case not in the caller org (and not super) ->
  `P0002` "Accident not found in your organisation."
- Honest math: `due_at`/`warning_at`/`escalation_at` are computed from `target_minutes`
  and `warning_pct`/`escalation_pct` at start; assert they are wall-clock targets, not 0.

### accident_sla_pause(uuid,text,timestamptz,text)
- Test (ok): pause a `running` timer with a reason + expected_resume_at -> writes an
  `accident_sla_pause_events` row and flips the timer to `paused`.
- Refusal (mandatory resume date): `p_expected_resume_at = NULL` -> `22023` "A pause
  requires an expected resume date" (brief 10: cannot pause without a follow-up date).
- Refusal (state): pausing a non-running timer -> `22023`; non-elevated -> `42501`; a
  timer in another org -> `P0002`.

### accident_sla_resume(uuid,text)
- Test (ok): resume a `paused` timer -> state `running`; `due_at`/`warning_at`/
  `escalation_at` shifted FORWARD by the paused duration (a paused clock accrues no
  elapsed time); `total_paused_minutes` accumulates; the open pause event's `resumed_at`
  is closed.
- Refusal (state): resuming a non-paused timer -> `22023`; non-elevated -> `42501`;
  other-org timer -> `P0002`.
- Edge: if no open pause window exists, resume anyway (adds 0 minutes) rather than
  trapping the timer paused - assert it still flips to running.

### accident_sla_scan() [cron-only]
- File: 12_SLA_ENGINE.sql section 4. SECURITY DEFINER, REVOKED from
  public/anon/authenticated (cron/service role only).
- Test (breach): with a running, unpaused timer whose `due_at < now()`, one scan flips it
  to `breached` (sets `breached_at`, `breach_minutes`) and emits ONE `accident.sla_breach`
  domain event; a second scan emits 0 (structural dedupe via `breached_notified`).
- Test (warning): a running timer past `warning_at` but not due emits one
  `accident.sla_warning` (deduped via `warned_notified`); it does NOT change the `running`
  state.
- Honest scope: paused / met / breached / cancelled timers are left alone - a paused
  clock never warns or breaches, and a breached clock is not re-fired. Assert a paused
  overdue timer is untouched. `warning_at` NULL (business_hours=false defs) is guarded -
  no warning fires and no error.
- Return: `{scanned_at, warned:<int>, breached:<int>}`.

---

## Phase: EVIDENCE (`13_EVIDENCE.sql`)

Owning caps: `accident_evidence` -> `submit`; `accident_claim_documents` ->
`edit_insurance`. All reuse `_accident_rpc_context`.

### accident_evidence_add(uuid,text,text,text,text,text)
- Test (ok): `('<ksa>','photo','storage/path.jpg','Front damage','incident_evidence',
  'req_scene_photos')` -> `{ok:true,evidence}`. Records only the STORAGE REFERENCE, never
  a binary.
- Refusal (validation): kind `'phota'` -> `22023` "Invalid evidence kind" (allowed:
  photo/video/document); blank storage ref -> `22023`.
- Refusal (cap): CAP-ONLY INSURANCE (has `edit_insurance`, not `submit`) -> `42501`;
  REPORTER -> `42501`. Elevated passes. KSA user on Egypt case -> `42501`.

### accident_document_add(uuid,text,text,text)
- Test (ok, received): with a storage ref -> row `received=true`, `received_at=now()`.
  Without a storage ref -> a required-but-outstanding placeholder (`received=false`). A
  passed `p_reference_no` is preserved in `notes` as `Reference: <no>` (the table has no
  reference_no column, so it is not dropped).
- Refusal (validation): blank `doc_type` -> `22023` (NOT NULL column).
- Refusal (cap): only elevated OR `edit_insurance`; CAP-ONLY WORKSHOP -> `42501`;
  REPORTER -> `42501`. KSA user on Egypt case -> `42501`.

### accident_evidence_checklist(uuid) [read-only]
- Test (ok): returns required-vs-received per requirement matched on the case route_key +
  accident_type (a NULL route/type requirement is global; a scoped one applies only on a
  match), scoped to the case country. `received` is true ONLY when >=1 evidence row
  carries that `requirement_key`.
- HONEST-NULL / honesty: a requirement with NO matching evidence is reported `received:
  false`, NEVER "received". `summary.complete` is true only when `mandatory_missing = 0`.
  Over a case with NO requirements matched, `items` is `[]` and totals are genuine 0s
  (a real "nothing required" state, not an error).
- Security: read-only, requires only that `_accident_rpc_context` passes (RLS SELECT is
  `app_is_active()`); a scope-excluded user is refused `42501` inside the context helper.

### accident_evidence_verify(uuid,uuid,text,text)
- Test (ok): decision `verified`/`rejected` stamps `verified_by`/`verified_at`;
  `unverified` clears both to NULL. The evidence row must belong to the case (checked in
  WHERE) - a foreign evidence id -> `P0002`.
- Refusal (validation): decision typo -> `22023` (allowed: verified/rejected/unverified).
- Refusal (cap): elevated OR `submit`; REPORTER -> `42501`; KSA user on Egypt case ->
  `42501`.

### accident_document_mark_received(uuid,uuid,text)
- Test (ok): flips `received=true`, `received_at=coalesce(existing,now())`, attaches an
  optional storage ref. Document must belong to the case -> else `P0002`.
- Refusal (cap): elevated OR `edit_insurance`; CAP-ONLY WORKSHOP -> `42501`; scope
  re-asserted.

---

## Phase: INSURANCE (`14_INSURANCE.sql`)

Owning cap: `edit_insurance` throughout. Tokens copied verbatim from the V417 CHECKs.

### accident_claim_register(uuid,text,text,text,numeric,numeric)
- Test (ok): opens (or updates the latest) `accident_insurance_claims` row, sets decision
  to `registered` ONLY from an early state (not_required/under_review/documents_incomplete),
  writes the CLAIMED amount to `accidents.claim_amount` (its only real home - the child
  table has no claim_amount column), and moves the `insurance` workstream to `in_progress`
  in the SAME transaction. Assert the workstream advanced.
- Refusal (money): negative `p_claim_amount` or `p_deductible` -> `22023` "cannot be
  negative".
- Refusal (cap): elevated OR `edit_insurance`; CAP-ONLY WORKSHOP -> `42501`; REPORTER ->
  `42501`. KSA user on Egypt case -> `42501`.
- Honesty: re-registering never regresses a claim the insurer has already decided
  (decision only advances from an early state).

### accident_claim_decision(uuid,text,numeric,text)
- Test (ok): records a row on `accident_insurance_decisions` and maps the token onto the
  parent claim status; `fully_approved`/`partially_approved` set `approved_amount`,
  `rejected` sets `rejection_reason`. Case context derived from the claim.
- Refusal (approve-needs-amount): `fully_approved`/`partially_approved` with
  `p_approved_amount = NULL` -> `22023` "An approved amount is required" (a claim is never
  marked approved without a value).
- Refusal (validation): bad decision token -> `22023`; negative approved amount ->
  `22023`; NULL claim id -> `22023`; unknown claim -> `P0002`.
- Refusal (cap/scope): non-`edit_insurance` non-elevated -> `42501`; KSA user on an Egypt
  claim (via the claim's parent case) -> `42501`.

### accident_claim_settlement(uuid,numeric,date,text)
- Test (ok): writes `accident_insurance_settlements` (type `claim_payment`) and advances
  the parent claim to `settled` (money moved).
- Refusal (validation): NULL/negative amount -> `22023`; NULL settlement date -> `22023`;
  unknown claim -> `P0002`.
- Refusal (cap/scope): non-`edit_insurance` -> `42501`; cross-country -> `42501`.

---

## Phase: REPAIR + FINANCE (`15_REPAIR_FINANCE.sql`)

Owning caps: repair chain / downtime -> `execute_repair` (downtime also `validate`);
QC -> `qc_repair`; finance / recovery -> `post_cost`. Tokens verbatim from V417 CHECKs.

### accident_repair_order_upsert(uuid,text,text,text,numeric,date)
- Test (ok): updates the latest OPEN order (status not completed/cancelled) or inserts a
  fresh `planned` one. Leaves status/approval untouched.
- Refusal (validation): bad `repair_route` or `workshop_type` token -> `22023`; negative
  quotation -> `22023`.
- Refusal (cap/scope): elevated OR `execute_repair`; CAP-ONLY FINANCE -> `42501`;
  REPORTER -> `42501`; KSA user on Egypt case -> `42501`.

### accident_repair_task_add(uuid,text,text,numeric,uuid,text)
- Test (ok): derives the case from the repair order (caller cannot mis-scope), inserts a
  task (`assigned` if an assignee is given, else `open`).
- Refusal: NULL/unknown repair order id -> `22023`/`P0002`; blank title -> `22023`;
  negative estimated hours -> `22023`; non-`execute_repair` non-elevated -> `42501`.

### accident_repair_task_complete(uuid,numeric,text)
- Test (ok): the ASSIGNEE, or elevated, or `execute_repair` completes the task; a note
  appends. Idempotent: an already terminal task -> `{ok:true,unchanged:true}`.
- Refusal: negative actual hours -> `22023`; a non-assignee non-elevated non-cap user ->
  `42501`; unknown task -> `P0002`.

### accident_repair_qc(uuid,text,text)
- Test (ok): records an `accident_repair_quality_checks` row (inspector = caller,
  inspected_at = now) and reflects the outcome onto the order status: `pass`->qc_passed,
  `fail`->qc_failed, `conditional`->qc_pending. Returns `passed:(result='pass')`.
- Refusal (SoD): gated on `qc_repair` (segregated from `execute_repair`), so the technician
  who did the work cannot sign off their own QC unless elevated - a CAP-ONLY WORKSHOP
  (`execute_repair` only) -> `42501`.
- Refusal (validation): bad result token -> `22023` (allowed: pass/fail/conditional);
  unknown order -> `P0002`.

### accident_repair_complete(uuid,date,numeric)
- Test (QC gate - critical): a repair CANNOT be marked complete while a REQUIRED quality
  check has not passed. If the `workshop_qc` workstream is NOT switched off, a passing QC
  row for THIS order is mandatory - with none, expect `42501` "a passing quality check is
  required". Seed a `pass` QC and the completion SUCCEEDS.
- Test (waiver honesty): when the `workshop_qc` workstream row is `not_required` /
  `not_applicable`, QC is waived and completion succeeds with no QC row. `coalesce(...,
  true)` means "no workstream row recorded" defaults to QC REQUIRED (assert it does not
  silently waive).
- Refusal: NULL order / NULL completion date -> `22023`; negative approved amount ->
  `22023`; a cancelled order -> `42501`; an already completed order ->
  `{ok:true,unchanged:true}`. Non-`execute_repair` non-elevated -> `42501`.

### accident_finance_txn_add(uuid,text,text,numeric,text)
- Test (ok): posts one ledger line, stamps posted_by/posted_at.
- Refusal (validation): bad `txn_type` token -> `22023` (15 allowed values); bad
  `direction` -> `22023` (cost/recovery/neutral); NULL amount -> `22023`; NEGATIVE amount
  -> `22023` (the direction column, not the sign, says cost vs recovery).
- Refusal (cap/scope): elevated OR `post_cost`; CAP-ONLY WORKSHOP -> `42501`; REPORTER ->
  `42501`; KSA user on Egypt case -> `42501`.

### accident_recovery_record(uuid,text,numeric,text,date)
- Test (ok): records a recovery line.
- Refusal (evidence): status `recovered` with `p_recovered_at = NULL` -> `22023` "A
  recovered date is required" (a recovery is only marked recovered against dated evidence).
- Refusal (validation): bad source token -> `22023` (insurer/third_party/driver/other);
  bad status -> `22023`; negative amount -> `22023`.
- Refusal (cap): elevated OR `post_cost`; else `42501`.

### accident_downtime_set(uuid,text,date,date)
- Test (ok): updates the latest downtime row or inserts one (one per case).
- Refusal (validation): bad `vehicle_status` token -> `22023` (11 allowed values).
- Refusal (cap): elevated OR `execute_repair` OR `validate` (Fleet owns the off-road
  status); a REPORTER -> `42501`; KSA user on Egypt case -> `42501`.

---

## Phase: EXTERNAL PORTAL (`16_EXTERNAL_PORTAL.sql`)

Anon-token read-only share (report_shares pattern). NO base table reaches anon; the org
is derived from the token row.

### accident_portal_shares policies (org_isolation / select / update / delete)
- Test: RESTRICTIVE `_org_isolation` FOR ALL bounds every access to the caller org (or
  super). SELECT/UPDATE/DELETE require elevated OR `accidents:edit`. There is DELIBERATELY
  NO INSERT policy - assert a raw PostgREST INSERT into `accident_portal_shares` is
  rejected (a share is mintable ONLY through the DEFINER RPC, so the capability gate cannot
  be bypassed). anon has 0 access to the table.

### accident_portal_create(uuid,text,timestamptz) [DEFINER, search_path public+extensions]
- Test (ok): ELEVATED KSA or `accidents:edit`, `('<ksa>', null, null)` ->
  `{ok:true, id, token:'acp_...'}` and exactly one share row for the case. Optional bcrypt
  password + expiry are stored.
- Security: search_path MUST include `extensions` (pgcrypto `gen_random_bytes`/`gen_salt`/
  `crypt`); assert `proconfig` carries `public, extensions` (V259 lesson).
- Refusal (cap/scope): a KSA-scoped non-elevated user WITHOUT `edit` on an Egypt case ->
  `42501` (both the org/country scope in `_accident_rpc_context` AND the capability gate).
  REPORTER -> `42501`.

### accident_portal_revoke(uuid) [DEFINER]
- Test (ok): sets `active=false` on the share -> `{ok:true, active:false}`; a subsequent
  snapshot returns `{ok:false, reason:'revoked'}`.
- Refusal: NULL id -> `22023`; unknown id -> `P0002`; a share in another org -> `42501`
  (own org check); non-`edit` non-elevated -> `42501`.

### get_accident_portal_snapshot(text,text) [DEFINER, anon-granted]
- Test (ok): a valid token -> `{ok:true, reference_no, case_no, incident_date, status,
  workflow_stage, case_status, severity, workstreams:{key:status}, claim:{decision,...}}`
  and `view_count` bumps to 1.
- PII-LEAN assertion (security-critical): the returned JSON contains NO `amount` /
  `deductible` / `approved_amount` / settlement / driver / third-party / liability / notes
  keys. Only claim STATUS (decision token + claim_no + insurer + applicability +
  registered date) is surfaced. Assert those money/PII keys are ABSENT.
- Refusal shapes (honest, never any case data): blank/NULL token -> `{ok:false,
  reason:'invalid'}`; unknown token -> `invalid`; revoked -> `revoked`; past expiry ->
  `expired`; password-protected token with no/wrong password -> `password`; the case row
  missing under the token's org -> `unavailable`.
- Security: this is the ONLY anon-granted object; it derives the org from the token row so
  a token can surface only its own tenant's single case (no cross-org leak). PUBLIC is
  revoked; anon + authenticated granted.

---

## Phase: REPORTING (`17_REPORTING_RPCS.sql`)

SECURITY INVOKER (not DEFINER): a plain read that inherits the caller's V417 RLS org /
country / site isolation. No org argument is taken or trusted. Run these AS A REAL
AUTHENTICATED USER (not the service role, which has NULL org and would mask a scoping
bug). `p_country` NARROWS within the caller's already-scoped visibility; it never widens.

### get_accident_case_status_breakdown(text)
- Test (ok): `(null)` returns `{rows:[{token,value}], by_stage:[{stage,value}], total,
  distinct, unrecorded, top}`; `('KSA')` narrows to KSA. Cross-check counts 1:1 against
  `accidentCaseAnalytics.caseStatusBreakdown` over the same rows (parity).
- HONEST-NULL: a case with NO recorded `case_status` is counted as `unrecorded` (its own
  count), NOT invented into a status bucket. `top` is NULL when there are no status rows.
  `by_stage` folds a blank `workflow_stage` to `'unrecorded'`.
- Security: an Egypt-scoped user's `(null)` call returns ONLY Egypt rows (RLS inherited) -
  assert a KSA case does not appear.

### get_accident_workstream_bottleneck(text)
- Test (ok): returns `{rows:[{key,cases}], measured, stalled_cases, top}`. A workstream
  STALLS a case when its status is not in the satisfied set (completed / not_required /
  cancelled - WORKSTREAM_SATISFIED). Counted per DISTINCT case, so two blocking rows on
  one workstream in one case is one stall. Cross-check vs `byWorkstreamBottleneck`.
- HONEST-NULL: `measured` is FALSE only when there are NO workstream rows at all in scope
  (with nothing recorded there is genuinely no bottleneck to attribute), matching the JS
  `rows.length===0 -> measured:false` short-circuit; `top` NULL when nothing stalls. A
  blank status is NOT counted (it is "no row set", not a stall).

### get_accident_case_kpis(text,date,date)
- Test (ok): `(null,null,null)` returns `{total, open, closed, reopened,
  avg_time_to_close, median_time_to_close, longest_time_to_close, time_to_close_measured,
  sla_tracked, sla_breached, sla_breach_rate, reopen_rate}`. Cross-check every figure
  against `accidentCaseAnalytics` (avgTimeToClose + slaBreachRate + reopenRate + open/
  closed counts) over the same window.
- HONEST-NULL (the point of the whole file - assert each):
  - `avg_time_to_close` / `median_time_to_close` / `longest_time_to_close` are NULL when
    `timed` has zero rows (nothing timeable closed) - NOT 0. `time_to_close_measured` is
    the honest gap vs `closed`. Time is measured only over genuinely closed cases with a
    valid start and a not-earlier close stamp (an approved fully_closed review's
    reviewed_at, else release_date).
  - `sla_breach_rate` is NULL when `sla_tracked = 0` (no case in scope carries a tracked
    SLA) - NOT "0% - fine". Un-tracked instances (no due date) are excluded entirely.
  - `reopen_rate` is NULL when `total = 0` (no cases in scope) - NOT 0.
  - Counts (`total`/`open`/`closed`/`reopened`/`sla_tracked`/`sla_breached`) are GENUINE
    zeros and stay 0.
- Date window: `p_from`/`p_to` (inclusive, NULL=all) apply to each case's business date
  `coalesce(incident_date, created_at::date)`; the SLA breach rate is measured over the
  SLA instances of the cases IN that window, so the whole result is one coherent slice.
- Security: SECURITY INVOKER - assert an Egypt-scoped user's `(null,...)` returns only
  Egypt-scoped totals (RLS inherited, no cross-tenant leak).

---

## GO / NO-GO summary

- Every DEFINER RPC passes the 8-line security checklist above (anon revoked, search_path
  pinned, org+country+site re-checked, capability-gated).
- The file 02 closure guard cannot be bypassed (no approved review -> `42501`, no admin
  bypass), and `accident_decide_closure` enforces `accident_can_fully_close` BEFORE
  minting an approved review.
- The NON_WAIVABLE spine (incident_evidence / liability / finance) cannot be marked NA;
  an NA on a waivable workstream is refused without an approver.
- The repair QC gate holds (no passing QC -> completion refused unless workshop_qc is
  explicitly switched off).
- Every honest-null case asserts NULL, not a flattering 0/100.
- Reporting RPC numbers agree 1:1 with `accidentCaseAnalytics.js`; the SQL twins agree
  with `accidentCase.js`. All tests roll back; 0 rows persist.
