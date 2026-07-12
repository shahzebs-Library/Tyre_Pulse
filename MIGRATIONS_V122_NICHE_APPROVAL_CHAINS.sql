-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V122 — Approval chains for the three remaining niche modules
-- ─────────────────────────────────────────────────────────────────────────────
-- Seeds default (organisation_id = NULL → applies to every tenant until a tenant
-- customises its own) approval chains for the intake flows that were built but
-- never given a workflow definition, so the Universal Approval Engine's
-- EntityApprovalPanel had nothing to start:
--
--   * goods_receipt  — GRN: goods received against a purchase order.
--   * tyre_return    — a tyre / stock return posted back into inventory.
--   * tyre_transfer  — an inter-site stock/tyre transfer.
--
-- (Vehicle handover is already covered by the live `gate_pass` chain — GatePass
--  is the "Vehicle handover / gate release" surface — so it is intentionally not
--  re-seeded here.)
--
-- Step schema follows V116/V117 (validate_workflow_steps): each step is
-- {name, approver_role, sla_hours?, require_*?, condition?{field,op,value}}.
-- Conditional last steps auto-skip when the guarded value is below threshold
-- (server-side, V117), so low-value receipts / small returns clear in one step.
--
-- Idempotent: re-running does nothing (guarded by NOT EXISTS on org-NULL + name).
-- Reversible:
--   DELETE FROM public.workflow_definitions
--    WHERE organisation_id IS NULL
--      AND entity_type IN ('goods_receipt','tyre_return','tyre_transfer');
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.workflow_definitions (organisation_id, name, description, entity_type, steps, active)
SELECT NULL, v.name, v.description, v.entity_type, v.steps::jsonb, true
FROM (VALUES
  (
    'Goods Receipt Verification',
    'GRN approval: store verification, procurement check, and finance sign-off on high-value receipts.',
    'goods_receipt',
    '[
      {"name":"Store Verification","approver_role":"store_keeper","sla_hours":24,"require_photo":true},
      {"name":"Procurement Approval","approver_role":"procurement","sla_hours":48,"allow_return":true},
      {"name":"Finance Sign-off","approver_role":"finance","sla_hours":72,"condition":{"field":"value","op":">=","value":10000}}
    ]'
  ),
  (
    'Tyre Return Authorization',
    'Authorise a tyre / stock return back into inventory: workshop review then store confirmation.',
    'tyre_return',
    '[
      {"name":"Workshop Review","approver_role":"workshop_manager","sla_hours":24,"allow_return":true},
      {"name":"Store Confirmation","approver_role":"store_keeper","sla_hours":24,"require_comment_on_return":true}
    ]'
  ),
  (
    'Inter-site Transfer Approval',
    'Approve an inter-site stock/tyre transfer: origin sign-off then destination confirmation.',
    'tyre_transfer',
    '[
      {"name":"Origin Approval","approver_role":"manager","sla_hours":24,"require_signature":true},
      {"name":"Destination Confirmation","approver_role":"manager","sla_hours":24,"condition":{"field":"qty","op":">=","value":10}}
    ]'
  )
) AS v(name, description, entity_type, steps)
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions d
  WHERE d.organisation_id IS NULL
    AND d.entity_type = v.entity_type
    AND d.name = v.name
);
