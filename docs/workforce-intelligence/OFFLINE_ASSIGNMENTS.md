# Offline assignment updates and duration estimates

Status: code complete on branch `feature/workforce-offline-estimation-20261023`. Not applied, not run on a device.

## Code done and tested (web + database)
- Migration `supabase/migrations/20261023090000_workforce_transitions_and_estimation.sql` (NOT applied).
  - `workforce_assignment_transition(...)`: one audited, idempotent status change. Replaying an idempotency key is success; reusing a key for a different action is refused; a stale transition is refused with the current status. Block, return and cancel require a note.
  - Append-only `workforce_assignment_events` ledger. The client clock is clamped server-side (`effective_at`).
  - `workforce_assignment_durations` view and `workforce_duration_estimate(...)`: median and quartiles of ACTIVE minutes (time in progress) from completed assignments, tiered task+vehicle+role, task+vehicle, task+role, task. Minimum 5 samples, otherwise "not enough history". Nothing is invented.
  - Two existing security gaps fixed in the same migration: the assignment create policy had an unqualified column that allowed a cross-organisation assignment; the evidence storage read policy was Admin only.
- Web: assignment form shows the estimate (median, confidence, sample size, which tier) and never fills the field by itself. Status buttons go through the RPC. Falls back cleanly if the migration is not installed.
- Tests: `node --test supabase/tests/workforce_*.test.mjs` (23 pass, PGlite: employee, supervisor role, manager, other organisation; full workflow assigned to supervisor review; estimation). `src/test/workforceEstimate.test.js`, `workforceTransitions.test.js` (SQL, web and Dart vocabulary parity), `workforceAssignmentsUi.test.jsx`.

## Code written, NOT verified (no Flutter SDK, no device)
- Durable per-user queue (one atomic file per update), idempotency key per update, ordering by sequence, de-duplication, optimistic "Pending sync" status, refused updates kept visible with the reason until dismissed (nothing is silently dropped).
- Sync triggers: sign-in, app resume, connectivity regained, and the tap itself.
- Files: `tyre_pulse_flutter/lib/features/my_work/{domain,data}/workforce_*`, `workforce_sync_providers.dart`, `lib/app/workforce/workforce_sync_binding.dart`, `presentation/workforce_assignments_panel.dart`; tests under `test/features/my_work/`.
- Run `flutter analyze` and `flutter test` first. Expect small compile or lint fixes.

## Needs a device or live system
- Real offline to online replay, airplane mode, app kill and restart, two-device conflict.
- Migration applied to a staging database, then the web estimate and RPC path checked there.
- Push delivery (unchanged, still uncertified).

## Known limits
- The custom "supervisor" role has employee-level access only. Review (verify, return, cancel) belongs to Manager, Director and Admin. Giving supervisors review rights is a product decision.
- Assignments changed by the old direct update have no events and are excluded from estimates.
- Estimates are advisory median effort of active time, not a performance target.
