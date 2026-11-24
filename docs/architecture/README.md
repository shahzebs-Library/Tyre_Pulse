# Tyre Pulse architecture diagrams

Generated 2026-11-24 from worktree branch `claude/wms-wp0-register` (tip `89cf96c3`) and read-only queries on the live
database `jhssdmeruxtrlqnwfksc` (`supabase_migrations.schema_migrations`, `information_schema`, `pg_proc`,
`pg_constraint`, `pg_trigger`, exact `count(*)`). Nothing in the app, database or deployments was changed.

## Legend (used in every diagram)

| Colour | Status | Meaning |
|---|---|---|
| green | IMPLEMENTED | Exists in the live database and is wired in code |
| yellow | PARTIAL | Built but unused (0 rows), lightly used, or the UI degrades to "not provisioned"; or fixed only on an unmerged branch |
| red | BROKEN | Fails or points at nothing in production; evidence in the diagram's page |
| purple, dashed | PROPOSED | Only in a migration file marked `STATUS: NOT APPLIED`; absent from `schema_migrations` |
| dashed arrow | — | Text join with no foreign key, or a proposed link |

Proposed migrations (verified NOT in `schema_migrations`; latest applied is `20261124074559 report_sharing_hardening_20261124`):
`20261124090000` WP4 procurement controls · `20261124091000` WP5 transfer scope + issue slip · `20261124120000` fleet
maintenance priority · `20261124130000` procurement RFQ / limits / returns · `20261124131000` workshop job materials ·
`20261124132000` OEM ↔ material link reconcile · `20261124133000` special classes and locations.

## Diagrams

| # | Page | Editable draw.io | One line |
|---|---|---|---|
| 1 | [01-system-context-container.md](01-system-context-container.md) | `diagrams/01-system-container/` | C4 context + container view: web, console, Flutter, retired Expo, marketing, edge functions, Postgres, storage |
| 2 | [02-material-master-oem.md](02-material-master-oem.md) | `diagrams/02-material-oem/` | ERP item master, governed catalogue, aliases, OEM manuals and the empty OEM / parts-catalog links |
| 3 | [03-warehouse-procurement.md](03-warehouse-procurement.md) | `diagrams/03-warehouse-procurement/` | Requisition → PO → GRN → ledger, plus counts, transfers, issues and the single guarded balance writer |
| 4 | [04-workshop-asset-maintenance.md](04-workshop-asset-maintenance.md) | `diagrams/04-workshop-maintenance/` | Job cards, tasks, technician events, PM, reservations, issues and their FK vs text joins |
| 5 | [05-tyre-lifecycle.md](05-tyre-lifecycle.md) | `diagrams/05-tyre-lifecycle/` | Tyre load, inspection, service, scrap, warehouse tyre items, custody conflicts and CPK |
| 6 | [06-analytics-reporting.md](06-analytics-reporting.md) | `diagrams/06-analytics-reporting/` | Source tables → server aggregate RPCs → pages, shared boards and scheduled email |
| 7 | [07-database-entity-relationships.md](07-database-entity-relationships.md) | `diagrams/07a-erd-inventory/`, `diagrams/07b-erd-procurement-workshop/` | Live foreign keys by domain with real constraint names; text joins listed separately |
| 8 | [08-flutter-mobile-offline-sync.md](08-flutter-mobile-offline-sync.md) | `diagrams/08-flutter-offline-sync/` | Drift queue, SyncEngine, pushers, physical-count outbox and the broken "Add stock" path |
| 9 | [09-rbac-approvals.md](09-rbac-approvals.md) | `diagrams/09-rbac-approvals/` | RLS helpers, module capabilities, `inv_can`, inventory and document approval flows |
| 10 | [10-current-vs-proposed-architecture.md](10-current-vs-proposed-architecture.md) | `diagrams/10-current-vs-proposed/` | What is live, what is broken, and what each unapplied migration would add |

Each `diagrams/<slug>/` folder holds the `.mmd` spec (edit and rebuild with the code-to-diagram skill:
`python3 <skill>/scripts/c2d.py build diagrams/<slug>/<slug>.mmd`) and the generated `.drawio`.
**PNG files were not produced:** the renderer needs draw.io desktop, which is not installed on this machine. Open the
`.drawio` in draw.io, or install draw.io desktop and rebuild to get verified PNGs. The Mermaid in each page renders on GitHub.

## Known broken items (verified)

| Item | Evidence |
|---|---|
| Flutter Stock Count "Add stock" on `origin/main` | `stock_count_repository.dart` `create()` inserts `stock_records` with `stock_qty` > 0; live trigger `trg_zz_inv_balance_guard` → `inv_balance_guard()` raises 42501. Fixed only on this branch (`89cf96c3`, not pushed, no build) |
| `parts_requests.part_id` → `parts_catalog` | FK `parts_requests_part_id_fkey`; `parts_catalog` 0 rows; both `parts_requests` rows have `part_id` null |
| Procurement built, unused | `suppliers` 0, `requisitions` 0, `purchase_orders` 0, `purchase_order_lines` 0, `supplier_invoices` 0, `goods_receipts` 1 |
| `oem_part_references` empty | 0 rows against 1,652 `oem_parts_entries` |

## Not verified
- Live configuration of external services (Resend keys, FCM, Stripe, Sentry) and edge-function deployed versions.
- Runtime behaviour in a browser or on a device; statuses come from schema, row counts and source reading.
- Whether `origin/main` already contains the branch's web services that call proposed RPCs (analysis was on the branch).
