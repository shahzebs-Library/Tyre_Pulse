# 07 · PostgreSQL entity relationships (split by domain)

Only foreign keys that exist in the live database (`pg_constraint`, 2026-11-24) are drawn. Relationship labels are the real constraint names. Every table has an `organisation_id` FK to `organisations`; those edges are omitted for readability.

## 07a · Inventory ledger, material and OEM

```mermaid
erDiagram
  material_master ||--o{ stock_records : "stock_records_item_id_fkey"
  inventory_locations ||--o{ stock_records : "stock_records_location_fk"
  inventory_locations ||--o{ inventory_locations : "parent_id_fkey"
  stock_records ||--o{ stock_movements : "stock_movements_stock_id_fkey"
  material_master ||--o{ stock_movements : "stock_movements_item_id_fkey"
  stock_movements ||--o{ stock_movements : "reverses_movement_id_fkey"
  stock_records ||--o{ stock_reservations : "stock_reservations_stock_id_fkey"
  stock_transfers ||--o{ stock_transfer_lines : "transfer_id_fkey"
  stock_records ||--o{ stock_transfer_lines : "from_stock_id_fkey"
  inventory_audits ||--o{ inventory_count_lines : "audit_id_fkey"
  inventory_audits ||--o{ inventory_discrepancies : "audit_id_fkey"
  inventory_discrepancies ||--o{ inventory_adjustments : "discrepancy_id_fkey"
  stock_movements ||--o{ inventory_adjustments : "movement_id_fkey"
  opening_balance_batches ||--o{ opening_balance_lines : "batch_id_fkey"
  stock_movements ||--o{ opening_balance_lines : "posted_movement_id_fkey"
  inventory_audits ||--o{ physical_inventory_sessions : "audit_id_fkey"
  material_master ||--o{ tyre_items : "tyre_items_item_id_fkey"
  tyre_items ||--o{ tyre_item_events : "tyre_item_id_fkey"
  material_canonical ||--o{ material_canonical_items : "canonical_id_fkey"
  material_master ||--o{ material_canonical_items : "item_id_fkey"
  material_canonical ||--o{ material_variants : "canonical_id_fkey"
  material_canonical ||--o{ material_aliases : "canonical_id_fkey"
  material_master ||--o{ oem_part_references : "item_id_fkey"
  oem_parts_manuals ||--o{ oem_parts_entries : "manual_id_fkey"
```

Editable: `diagrams/07a-erd-inventory/07a-erd-inventory.drawio`.

## 07b · Procurement and workshop

```mermaid
erDiagram
  suppliers ||--o{ purchase_orders : "purchase_orders_supplier_id_fkey"
  purchase_orders ||--o{ purchase_order_lines : "po_id_fkey"
  material_master ||--o{ purchase_order_lines : "item_id_fkey"
  purchase_orders ||--o{ goods_receipts : "goods_receipts_po_id_fkey"
  goods_receipts ||--o{ goods_receipt_lines : "grn_id_fkey"
  purchase_order_lines ||--o{ goods_receipt_lines : "po_line_id_fkey"
  stock_movements ||--o{ goods_receipt_lines : "movement_id_fkey"
  purchase_orders ||--o{ supplier_invoices : "supplier_invoices_po_id_fkey"
  suppliers ||--o{ supplier_agreements : "supplier_id_fkey"
  material_issues ||--o{ material_issue_lines : "issue_id_fkey"
  work_orders ||--o{ wo_tasks : "wo_tasks_job_id_fkey"
  work_orders ||--o{ wo_assignments : "wo_assignments_job_id_fkey"
  wo_tasks ||--o{ wo_assignments : "task_id_fkey"
  work_orders ||--o{ tech_activity_events : "job_id_fkey"
  work_orders ||--o{ work_order_stock_reservations : "work_order_id_fkey"
  work_orders ||--o{ approval_execution_requests : "work_order_id_fkey"
  vehicle_fleet ||--o{ approval_execution_requests : "vehicle_id_fkey"
  work_orders ||--o{ parts_requests : "parts_requests_job_id_fkey"
  parts_catalog ||--o{ parts_requests : "parts_requests_part_id_fkey"
  pm_programs ||--o{ pm_service_records : "pm_program_id_fkey"
```

Editable: `diagrams/07b-erd-procurement-workshop/07b-erd-procurement-workshop.drawio`.

## Important relationships that are NOT foreign keys (text joins)

| From | To | Join column | Risk |
|---|---|---|---|
| `parts_consumption` (219,918) | `material_master` | `item_code` text | A code typo silently drops a line from material views |
| `parts_consumption`, `work_order_line_items` | `work_orders` | `work_order_no` text | |
| `work_orders`, `tyre_records`, `inspections` | `vehicle_fleet` | `asset_no` text (+ country) | Same code exists in several countries |
| `material_issues` | `work_orders` | job card number text | |
| `requisitions` | anything | no FKs at all | |

## Proposed tables (not in the live schema)
`procurement_rfqs`, `procurement_rfq_lines`, `procurement_rfq_invites`, `procurement_quotes`, `procurement_quote_lines`, `supplier_returns`, `supplier_return_lines` (`20261124130000`); `job_material_installations` (`20261124131000`); `material_link_proposals` (`20261124132000`); `inventory_scrap_requests`, `inventory_lubricant_dispenses`, `inventory_unit_events`, `equipment_calibrations`, `equipment_custody` (`20261124133000`). Not drawn as live entities.
