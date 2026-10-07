# Workshop Status - existing-system map (Loop 0)

Audit of the existing TyrePulse system before building Daily Ops -> Workshop Status.
Spec: `TyrePulse_Daily_Ops_Workshop_Status_Claude_Spec.md`. Process: `TyrePulse_Workshop_Status_Claude_Execution_Loop.md`.

## Existing system

| Concern | Existing implementation |
|---|---|
| Daily Ops route | `/daily-ops`, `src/App.jsx` (`ModuleRoute moduleKey="daily_ops"`), nav in `src/components/Layout.jsx` ("Live" group), command search in `src/lib/commandSearch.js` |
| Daily Ops overview | `src/pages/DailyOps.jsx` + `src/lib/api/dailyOps.js` + pure `dailyOpsView.js` / `dailyOpsAnalytics.js` / `dailyOpsPriority.js`; action items (`action_items`) and shift handovers (`shift_handovers`) |
| Vehicle master | `vehicle_fleet`, unique per `(organisation_id, country, asset_no)`; `asset_no` stored upper-case with no whitespace (trigger enforced) |
| Users | `profiles` (`full_name`, Title Case `role`, `sites[]` with `ALL` sentinel, `country[]`, `is_super_admin`) |
| Permissions | `module_permissions` role x module matrix, `user_access_grants` per user, server check `app_user_can(module, cap)`; sub-module keys `parent:child`; editor = Console -> Access Control |
| Row security | RESTRICTIVE org isolation `organisation_id = app_current_org()`, country `app_can_see_country`, site `app_can_see_site`, permissive read/write gates |
| Notifications | `notifications` (`user_id, type, title, body, entity_type, entity_id, read`), own-row read/update, server-side insert; UI `src/components/NotificationCenter.jsx`; push via `workflow_notifications` |
| Audit | `audit_log_v2` row trigger (16 tables), `access_audit`, `action_item_history`; exports write an EXPORT audit row |
| Storage | private buckets (`tyre-photos`, `import-files`, ...), `<org>/...` paths, signed URLs |
| Excel import | SheetJS (`xlsx`), `src/lib/import/parseWorkbook.js`, `headerDiff.js`, `synonyms.js`, `imports.js` (file sha256) |
| Export | `src/lib/exportUtils.js` (`exportToExcel`, `exportSheetsToExcel`, `exportToPdf`, `reportFileName`), `pdfEngine.js` |
| UI kit | `Modal`, `SideDrawer`, `EnterpriseTable`, Command Center kit (`PageHero`, `Kpi`, `Card`, `Tabs`, `KitTable`), `MultiSelectFilter`, `DateField`, `safeError.toUserMessage` |
| DB tests | PGlite harness in `supabase/tests/*.test.mjs` (`npm run test:database`) |

## Canonical vehicle identifier

`(organisation_id, country, asset_no)`. The same `asset_no` in two countries is usually a
different machine (239 codes span countries), so a workshop row is never matched on the code alone.

## Decisions

- Workshop Status is a new lazy page at `/daily-ops/workshop` (tab via `?tab=`), guarded by
  sub-module `daily_ops:workshop`. DailyOps.jsx only gains summary cards.
- New tables are workshop-specific (upload batches, upload rows, status records, append-only
  events, attachments, config). No duplicate vehicle master, no Job Card tables.
- `asset_breakdowns` (manual breakdown register, `/asset-breakdowns`) is left untouched; it is a
  different source. Linking can be added later without schema change.
- `open_work_orders` / `work_orders` are Job Card data and are NOT used.
- Upload confirmation is a single SECURITY DEFINER function (one transaction).
- Migrations are written and tested in PGlite; they are NOT applied to production without an
  explicit go-ahead.

## Open inputs

- A sample of the real daily workshop Excel is needed to finalise header mapping (Loop 3).
