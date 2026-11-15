# By-number join audit (job card numbers are per company)

Date: 2026-11-15. Status: audit complete, fixes are DRAFTS (nothing applied to production).

## Why this exists

TEN-1b (`supabase/pending_migrations/20261113100500_ten1b_work_orders_per_org_key.sql`,
now applied) made `work_orders` unique per `(organisation_id, work_order_no)`. A job card
number is no longer a global identity. Anything that joins or looks up a job card by number
only (`parts_consumption.work_order_no`, `work_order_line_items.work_order_no`,
`tyre_records.job_card`, staging pipes, client merges) must also match the company, or, once a
second company imports an overlapping number, one company's cost, asset, site or tyre data
attaches to the other company's job card.

Today one company holds data, so no figure is wrong yet. This audit finds every place that
would go wrong and drafts the fix.

## Method

- Production read only (`SELECT` on `pg_proc` / `pg_views` through the Supabase MCP).
  70 `public` functions and 10 views mention `work_order_no` or `job_card`; every one was read.
  Other schemas and materialised views: none.
- The local mirror (`tp_mirror2`, PostgreSQL 16, synthetic companies Alpha / Beta / Gamma) was
  confirmed byte-identical to production for all 70 functions (md5 of `pg_get_functiondef`),
  for `v_tyre_fitment_evidence` and for `_resolve_import_org`, so the local test exercises the
  exact production text.
- Client: `src/` and `tyre_pulse_flutter/lib` searched for `.eq/.in/.ilike/.or` on
  `work_order_no` / `job_card`, and for in-memory maps keyed by number.

## Database: affected (9 objects, fixed in the draft)

| # | Object | Kind | What was wrong | Effect with a second company |
|---|---|---|---|---|
| 1 | `classify_parts_consumption` | trigger | Tyre-job-card signal looked for a tyre with the number in the same **country**, any company | An expense line could be bucketed as tyre spend because another company fitted a tyre on that number |
| 2 | `get_site_operating_cost` | RPC (definer) | `parts_consumption -> work_orders` joined on number only; `vehicle_fleet` joined on asset code only | A's expense line duplicated or attributed to B's asset and site; A's site totals inflated |
| 3 | `get_asset_disposal_register` | RPC (definer) | Spend per asset summed `parts_consumption` lines of any company whose number matched A's job card | B's cost appears in A's disposal register |
| 4 | `process_stg_complaints` | staging trigger | Duplicate check matched the number in any company (same country) | B's complaints import silently skipped because A has the number |
| 5 | `process_stg_monthly_tyres` | staging trigger | Existing-row lookup (serial + country + date + job card + position) had no company | B's monthly tyre file **patched A's tyre record** |
| 6 | `convert_repair_request_to_job_card` | RPC (definer) | "Is this number taken" looked across companies | Refused with "belongs to another organisation", now wrong (numbers are per company) |
| 7 | `owner_data_audit` | RPC (super admin) | Orphan line-item check matched a job card in any company | Orphan count understated |
| 8 | `tyre_cost_audit_classify` | SQL (invoker) | Tyre <-> own job card lines and the same-month price index ignored company | Safe for ordinary users (RLS); for a super admin or a service caller companies mixed, and `tyre_cost_audit_scan` persisted the mix |
| 9 | `v_tyre_fitment_evidence` | view (invoker) | `job_card_found` true when any company had the number | Evidence class too generous for a super admin |

Notes:
- #2 also carried an asset-code-only join to `vehicle_fleet`; same leak class, fixed in the same
  function.
- #4 now dedupes by company across all of that company's countries (the key is per company, so
  a same-company card in another country would otherwise hit the unique key and abort the
  batch), and names the company explicitly on insert, resolved the same way as
  `process_stg_wo_lines` (`app_current_org()` then `_resolve_import_org()`).
- #5 now looks up only within the importing company (row org, then session org, then
  `_resolve_import_org()`); an org-less session in multi-company mode now refuses (PT409)
  instead of patching any company's row.

## Database: checked and already company-scoped (no change)

`backfill_tyre_prices_from_grid`, `tyre_price_backfill`, `work_order_cost_reconcile`,
`process_stg_wo_lines`, `process_stg_job_cards` (conflict target already
`(organisation_id, work_order_no)`), `get_asset_disposal_fleet_baseline`,
`get_asset_disposal_reliability`, `list_scrapped_tyres`, `observation_erp_evaluate`,
`import_existing_keys` (scoped by `$1 = org`; the work-order key ignores country, correct),
`promote_erp_tyre_expense`, `extract_tyre_freetext_candidates` (self-join within staging).

Mention the number but join nothing by it: `get_maintenance_snapshot`,
`get_parts_expense_snapshot`, `get_report_snapshot`, `get_report_tyre_maintenance`,
`get_workshop_snapshot`, `get_daily_job_cards`, `get_work_orders_page`,
`get_work_order_insights`, `get_sany_delay_candidates`, `get_material_issue_summary`,
`recon_jobcard_mismatches`, `expense_*` guards, `replace_open_work_orders`,
`_tyre_exception_rows`, `get_cpk_km_source*`, `stock_entry_resolve` and the remaining
pdf-cache / notification helpers. Views `v_jobcard_date_mismatch` (row-local),
`v_work_order_cost_totals` (joins by id), `v_tyre_cost_status` (serial, not number).

## Client: affected (fixed in this branch)

| File | Problem | Fix |
|---|---|---|
| `src/lib/api/erpIntake.js` `insertWorkOrders` | Merge read existing job cards by number across all companies visible to the caller. For a super admin that meant an import could **update another company's job card**. | Existence set and overlap fetch are filtered to the caller's company (`app_current_org` RPC). Unreadable company keeps the previous RLS-only behaviour. Test: `src/test/erpIntakeOrgScope.test.js`. |
| `src/lib/api/observationErpEvidence.js` | Evidence reads (tyres, job cards, expense lines, fleet) by asset + number with no company. A super admin reviewing an inspection could be offered another company's job card. | Every read pinned to the inspection's own company (row value, else read once by id; a failed read is an error, never a wider search). Tests added to `src/test/observationErpEvidence.api.test.js`. |

## Client: RLS-bounded, follow-up only (not changed)

Ordinary users are limited to their own company by the restrictive `organisation_id`
policies, so these only matter for a super admin, whose reads span companies:

- `src/pages/WorkshopJobDetail.jsx` opens a job by number (`.eq('work_order_no', id).limit(1)`)
  when the URL holds a number, not an id. Two companies with the same number: a super admin
  sees one of them. Links inside the app use the id.
- `src/lib/assetHistory.js documentChain` groups expense lines and line items under job cards
  by number, after reads keyed by asset code. A super admin viewing an asset code that two
  companies share would see them merged.
- Flutter: `global_search_repository.dart` (ilike search, read only) and the asset financials
  / timeline readers (by asset code). Same note.
- `erpIntake.js` merges for `vehicle_fleet` and `tyre_records` key on asset / serial rather than
  number and share the same super-admin caveat; worth the same company filter in a later pass.

## Drafts

- `supabase/pending_migrations/20261117110000_by_number_org_joins.sql` - re-creates the 9
  objects from their live definitions (anchored replace, each anchor must occur exactly once
  or the migration aborts; marker `/* by-number-org */` makes a re-run a no-op; original
  definitions saved to `_bak.by_number_org_joins_defs`). Contains no destructive keyword, so
  the MCP apply path will not stop on its confirm prompt.
- `supabase/pending_migrations/20261117110000_by_number_org_joins_ROLLBACK.sql` - re-executes
  the saved definitions.
- `supabase/pending_migrations/20261117111000_drop_tyre_status_marks_bridge.sql` - removes the
  temporary unique index `tyre_status_marks_serial_mark_type_bridge (serial, mark_type)`.
  Owner approval only, after confirming the production web build carries #541. Production
  check 2026-11-15: no database function upserts on `(serial, mark_type)` alone
  (`scrap_tyre_by_serial` uses the company key); the company key
  `(organisation_id, serial, mark_type)` exists.

## Local test (copy of `tp_mirror2`, 2026-11-15)

1. Draft applied cleanly; re-run skipped all 9 objects (idempotent).
2. Parity with no overlapping numbers: outputs byte-identical before and after for
   `get_site_operating_cost`, `get_asset_disposal_register`, `tyre_cost_audit_classify`
   (company user and super admin), `v_tyre_fitment_evidence` (company user and super admin),
   `owner_data_audit`.
3. Overlap scenario (company B given one of company A's job card numbers, a B expense line on
   it, a B complaints row and a B monthly tyre row matching an A tyre):

   | Check | Before | After |
   |---|---|---|
   | A's site operating cost unchanged | false (leak) | true |
   | A's disposal register unchanged | false (leak) | true |
   | B's complaint row created (not skipped) | false | true |
   | A's tyre record untouched by B's import | false (patched) | true |

4. Rollback restored all 9 definitions byte-identical to the original (md5), then the draft
   re-applied cleanly.
5. Bridge draft: index removed; the documented rollback re-created it.

Found while testing, not changed: `process_stg_complaints` still aborts a batch when a row has
no Vehicle In Date (`work_orders.opened_at` is NOT NULL). Pre-existing, same class as the
`process_stg_job_cards` fallback fixed earlier.
