# Offline assignment updates and duration estimates

Status (updated 2026-11-09): merged to main (offline queue via #448; team operations core via #478/#479/#480). The database side is applied live. The Flutter side is written and unit-tested in `test/features/my_work/`; not yet run on a device.

## Database (applied live)
- `supabase/migrations/20261023091000_workforce_transitions_and_estimation.sql`: the first version of the audited transition, the append-only `workforce_assignment_events` ledger, the `workforce_assignment_durations` view and `workforce_duration_estimate(...)`.
  - `workforce_assignment_transition(...)`: one audited, idempotent status change. Replaying an idempotency key is success; reusing a key for a different action is refused; a stale transition is refused with the current status. Block, return and cancel require a note.
  - The client clock is clamped server-side (`effective_at`).
  - Estimates: median and quartiles of ACTIVE minutes (time in progress) from completed assignments, tiered task+vehicle+role, task+vehicle, task+role, task. Minimum 5 samples, otherwise "not enough history". Nothing is invented.
  - Two security gaps fixed in the same migration: the assignment create policy had an unqualified column that allowed a cross-organisation assignment; the evidence storage read policy was Admin only.
- `supabase/migrations/20261109160000_workforce_operations_core.sql` changes the contract the phone relies on:
  - Current signature: `workforce_assignment_transition(p_assignment_id uuid, p_action text, p_idempotency_key text, p_note text default null, p_client_at timestamptz default null, p_reason_code text default null)`. The old 5-argument version is renamed `workforce_assignment_transition_v1_retired` and revoked, so PostgREST sees one function. Named-argument callers (the phone) are unaffected.
  - `p_reason_code` is the blocker cause: `waiting_stock`, `waiting_equipment`, `vehicle_unavailable`, `safety_hold`, `waiting_approval`, `waiting_manpower`, `other`. NULL is accepted and reported as "not recorded".
  - Gates: `complete` needs evidence when the task type requires it (`evidence_required`); `verify` needs the linked operational record (`record_required`) and a review note when technical review is required (`review_note_required`). Link refusals: `record_not_found`, `asset_mismatch`, `record_already_linked`, `record_type_mismatch`. A reviewer cannot review their own work (`self_review`).
  - **Direct status UPDATE is refused for everyone.** Trigger `workforce_assignment_guard` accepts a status change only from inside the transition function (transaction GUC `workforce.via`), else 42501.
  - New table `workforce_assignment_evidence` (append-only; assignee inserts only while `acknowledged`, `in_progress` or `blocked`; JPG, PNG or PDF, 1 byte to 10 MB) with storage policies on the private bucket `workforce-evidence`, path `<organisation_id>/assignments/<assignment_id>/<file>`.
  - Qualification-gated assignment, `workforce_reassign`, `workforce_link_operational_record`, `workforce_board_summary`. Time accounting and team analytics follow in `20261109170000` and `20261109180000`.
- `supabase/migrations/20261109190000_workforce_reassign_notify.sql`: a reassignment now notifies the new assignee (push) and the previous one (in-app).
- Tests: `node --test supabase/tests/workforce_*.test.mjs` (PGlite), plus `src/test/workforceEstimate.test.js`, `workforceTransitions.test.js` (SQL, web and Dart vocabulary parity), `workforceAssignmentsUi.test.jsx`.

## Web
- Assignment form shows the estimate (median, confidence, sample size, which tier) and never fills the field by itself. Status buttons go through the RPC; the legacy direct-update fallback was removed with `20261109160000`.

## Flutter (Tasks screen, workforce lane)
- Files: `tyre_pulse_flutter/lib/features/my_work/{domain,data}/workforce_*`, `data/queued_workforce_transition.dart`, `workforce_sync_providers.dart`, `lib/app/workforce/workforce_sync_binding.dart`, `presentation/workforce_assignments_panel.dart`, `presentation/workforce_copy.dart`; tests under `test/features/my_work/`.
- Durable per-user queue (one atomic file per update, partitioned by user id), idempotency key per update reused on every retry, ordering by sequence, de-duplication, optimistic "Pending sync" status, refused updates kept visible with the reason until dismissed or retried (nothing is silently dropped). Later updates for an assignment with a refused update are held, not sent blind.
- Sync triggers: sign-in, app resume, connectivity regained, and the tap itself (single-flight per user).
- **Block needs a cause and a note.** The dialog offers the seven causes above and requires a details note. The cause is stored on the queue entry as `reasonCode` and sent as `p_reason_code`.
- **Backward compatibility.** A queue entry written by an older build has no `reasonCode`; it still replays, with `p_reason_code` left out of the call (not sent as null), and the server records the cause as not recorded. The panel labels such an entry "not recorded". An unknown cause value is read as no cause rather than making the entry unreadable.
- **Refusals** are shown in English, Arabic and Urdu: `invalid_transition`, `not_found`, `forbidden`, `note_required`, `key_reuse`, `self_review`, `evidence_required`, `record_required`, `review_note_required`, `record_not_found`, `asset_mismatch`, `record_already_linked`, `record_type_mismatch`. Only `invalid_transition`, `not_found`, `forbidden`, `self_review` and `key_reuse` are terminal; after `evidence_required` the fix is to attach evidence and retry.
- **Cards** show `asset_no`, `tyre_serial`, `tyre_position` and the required operational record (needed or linked) when the server carries them; an older server without those columns falls back to the base columns. The evidence count reads "unavailable" when it cannot be read, never 0.
- **The old direct status update is removed.** The repository's `advance()` (a plain `update({'status': ...})`) no longer exists; the queue is the only status write path.
- **Evidence upload is online only, never queued.** Photo (camera or gallery, compressed by the shared resize ladder) or PDF, uploaded to `workforce-evidence` and then recorded in `workforce_assignment_evidence`. The button is disabled while the lane shows offline data. Queuing evidence would need a durable photo store with upload confirmation and edits to the shared sync wiring, which this feature may not touch.

## Needs a device or live system
- Real offline to online replay, airplane mode, app kill and restart, two-device conflict.
- Evidence upload from a real camera, gallery and PDF picker against the live bucket.
- Push delivery of the reassignment notice on a device.

## Known limits
- The custom "supervisor" role has employee-level access only. Review (verify, return, cancel) belongs to Manager, Director and Admin, and is never queued on a phone. Giving supervisors review rights is a product decision.
- Assignments changed by the old direct update have no events and are excluded from estimates.
- Estimates are advisory median effort of active time, not a performance target.
- `features/my_work/` names its tables, RPC and bucket by string literal; they are not yet in `SupabaseTables` / `SupabaseRpcs`.
