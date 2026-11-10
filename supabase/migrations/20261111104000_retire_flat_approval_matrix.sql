-- 20261111104000_retire_flat_approval_matrix
-- Two approval rule engines existed. Owner, 2026-11-11: keep the enterprise one.
-- KEPT: approval_policies (governed, versioned, published snapshots, approval_policy_events
--   audit, approval_private permits/decisions/stage_deliveries, region routing, pre-execution
--   gates, simulate). Used by src/pages/ApprovalMatrix.jsx, mobile governedApprovals.ts and
--   the Flutter inspection signer path.
-- RETIRED: approval_matrix + resolve_approvers (V477). 0 rows, no caller left in web, mobile
--   or Flutter (client CRUD and the pure mirror were removed in the same change). Other
--   functions that mention 'approval_matrix' only use it as a context flag of the KEPT engine.
-- Not dropped (reversible): writes revoked and the function made uncallable.
-- Rollback: grant select,insert,update,delete on public.approval_matrix to authenticated;
--           grant execute on function public.resolve_approvers(text,text,text,text,uuid) to authenticated.
revoke insert, update, delete on public.approval_matrix from authenticated, anon;
revoke execute on function public.resolve_approvers(text,text,text,text,uuid) from public, anon, authenticated;
comment on table public.approval_matrix is
  'RETIRED 2026-11-11: superseded by approval_policies (governed engine). Kept read-only for rollback; 0 rows.';
comment on function public.resolve_approvers(text,text,text,text,uuid) is
  'RETIRED 2026-11-11 with approval_matrix. Use approval_policy_simulate.';
