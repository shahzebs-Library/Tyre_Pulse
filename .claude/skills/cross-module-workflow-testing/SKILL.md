---
name: cross-module-workflow-testing
description: Trace a Tyre Pulse business workflow end to end across web UI, service layer, RPC/RLS, triggers, mobile (Flutter) and reports, and prove each hop with evidence - imports (ERP intake), tyre fitment to removal to cost, inspection to corrective action to work order, accident case to claim to closure, workforce assignment to evidence to verify. Use for "does the whole flow work", "trace this workflow", "end to end", "why does the number differ between screens", or before merging a change that touches more than one module.
---

# Cross-module workflow testing

A workflow passes only when every hop is shown, not inferred: UI control -> service fn -> RPC/table -> trigger ->
downstream reader (dashboard / PDF / mobile).

## Procedure per workflow
1. **Map the hops** in a table: screen + handler (file:line), service (src/lib/api/*), RPC or table (migration file
   + live signature via `pg_proc`), triggers on that table (`pg_trigger`), readers (grep the table/RPC name).
2. **Signature check**: client arg names == RPC parameter names; selected columns exist (PostgREST fails the whole
   request on an unknown column, and many services then render an EMPTY list).
3. **Permission check**: who may call each hop (RLS + in-body gate) equals what the UI offers that role
   (rbac-testing). A button a role cannot complete is a defect.
4. **Error path**: every hop surfaces failure through `safeError.toUserMessage` with Retry; a failed read must never
   render as "no records" or 0.
5. **Data agreement**: the same fact on two screens must come from one engine (CLAUDE.md single-source rule);
   list every place the fact is derived and name the authoritative one.
6. **Mobile parity**: for flows the Flutter app also performs, compare the Dart rule with the JS + SQL
   (status transitions, position codes, bands) - see src/test/*parity* and flutter drift tests.
7. **Prove it** in a rolled-back transaction as a REAL non-admin user (impersonation pattern in
   database-migration-safety) or with the existing PGlite tests; record exact inputs and outputs.

## Workflows to keep on file (update when one changes)
ERP intake -> parts_consumption (classify trigger, re-upload guard) -> expense grid -> CPK;
monthly tyres -> `_tyre_close_replaced` -> tyre_records -> running life -> tyre cost audit;
inspection -> flags -> corrective_actions -> work_orders -> workshop live;
accident -> workstreams -> claim -> closure review -> emails (gated);
workforce assignment -> qualification gate -> transition RPC -> evidence -> verify -> analytics.

## Deliverable
Hop table with PASS / FAIL / NOT VERIFIED per hop, the evidence for each, and the single root cause of any
disagreement between screens.
