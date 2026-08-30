# Module-depth remediation ledger — 2026-08-30

This ledger records only work verified in the current production-readiness pass. It does not mark the whole SaaS production-ready.

## Completed in this workstream

| Area | Before | Delivered | Verification |
|---|---|---|---|
| Shared Cost/M3 ledgers | Sites, SCO, SANY, and Production exposed loaded rows as an unfiltered, unpaged table | Their shared `LedgerPage` now provides column-wide search, an honest result count, clear-all, and shared pagination with 25/50/100/200 page sizes | `ledgerRows.test.js` and `tablePagination.test.jsx`: 13/13 passing; targeted ESLint: clean |
| Contextual state filtering | Operational state could not be narrowed on the two ledgers where it matters most | Sites can filter Active/Inactive; Production can filter Approved/Rejected, including normalized legacy boolean/string values | Pure state-filter tests cover active defaults and legacy rejection values |
| Empty-state truthfulness | A filtered empty set used the same copy as an empty server result | Filtered-empty copy now tells the operator to clear filters; true-empty copy still prompts add/import | Pure combined filter tests and code-path review |
| Table accessibility | Clickable ledger rows required a pointer | Clickable rows now receive focus and activate with Enter or Space; destructive row controls stop propagation and have an accessible name | Targeted ESLint and code review |
| Route consolidation | Several old URLs overlapped canonical owners | Existing canonical redirects were verified for AI, users/admin, access/security, organisation hierarchy, privacy, and deletion surfaces (12 redirect routes in `App.jsx`) | Static route inspection |

## Operational state-depth pass

The old inventory used keyword and line-count signals. It was useful for finding
candidates, but it could not distinguish a page from the shared engine it renders
or a list from a singleton/configuration workflow. The source-aware classifier at
`audit/module-depth-classification-2026-08-30.json` now records that distinction.

| Result | Count | Meaning |
|---|---:|---|
| Remediated operational paths | 6 | Accident portal, Alerts, CPK Intelligence, Cost/M3, Daily Operations, and Gate Pass now expose truthful unavailable/partial states and recovery rather than converting failures to empty success. |
| Composition wrappers, not thin | 7 | Short route files inherit substantial engines; Production, SANY, SCO, Sites, ERP Sync, Report Sharing, and Master Access Control are assessed at rendered-workflow level. |
| Valid custom state machines | 8 | These pages already use sentinel/phase-specific loading, error/retry, and empty handling that the old keywords missed. |
| State not applicable | 8 | Static documents, authentication forms, and client-only calculators do not have a remote collection to load or empty. |
| Separate owner | 1 | Expense Import remains owned by the enterprise paging/filter stream and was not modified here. |
| Unclassified legacy candidates | 0 | Every old thin/data-state candidate has an explicit machine-readable disposition. |

### Safety and workflow improvements

- The alert engine now rejects any failed safety source. The Alerts page shows an
  unavailable state with retry and never claims the fleet is all clear from a
  partial scan.
- Daily Operations distinguishes total failure from a partial five-source load.
  A total failure blocks operational conclusions; a partial load names omitted
  sources and qualifies its totals.
- Cost/M3 distinguishes failure of the authoritative headline RPC from missing
  supporting trend, rejection, or row-count analysis.
- CPK Intelligence exposes core-load failure and advanced-tab partial failures.
- Gate Pass has separate today/history/site/clearance states, retry controls, a
  shared date control, and supported vehicle-record drill-down links.
- The public accident portal catches transport failures, emits only generic copy
  (no token/database internals), and offers retry.

Regenerate the classification after relevant page changes with:

```powershell
node scripts/audit-module-depth.mjs
```
| Data Reconciliation | Three operational tables had no reachability controls or scoped search | Added URL-backed search, country and movement-date filters, per-section result totals, distinct true-empty/filtered-empty states, and independent shared pagination for orphan, duplicate and movement rows | Targeted ESLint clean; production build passed |
| Expense Import preview | Only the first 20 parsed rows were visible, making later source rows impossible to review | Replaced the sample cap with a complete search/category/date-filterable preview and shared pagination. Import still consumes the original, unfiltered full row set, so display filters cannot silently reduce the import | `partsExpense.test.js`: 20/20 passing in focused run; targeted ESLint clean; production build passed |
| Maintenance Cost Board details | Top tasks were an unfiltered static table and site aggregates had no tabular review path | Added bookmarkable search, type, site and date scope, a combined task/site detail register, honest result counts/empty states, and pagination. Excel/PDF exports continue to derive from the full server snapshot rather than visible page rows | `maintenanceBoard.test.js`: 12/12 passing in focused run; targeted ESLint clean; production build passed |

## Important audit correction

The inventory's line-count heuristic labels `SitesIntake`, `ScoCosts`, `SanyInvoices`, and `ProductionM3` as “thin” because those page files are short. They are configuration wrappers over the substantial shared `LedgerPage` engine, not placeholder pages. Page length alone must not be used as a production-readiness verdict. The correct unit of review is the rendered workflow plus its service contract.

Current static foundation signals (not certification): 203 page files contain a table signal; 103 page files use `EnterpriseTable`, `TablePagination`, or `usePagedRows`; 52 call sites use the full `EnterpriseTable` foundation. The filter audit now reports zero table pages without an obvious filter contract. The fail-closed paging classifier still identifies 68 unsafe/unbounded frozen candidates, so migration remains incomplete.

## Still pending — do not call complete

1. Review the remaining table surfaces by actual row cardinality. Client paging is sufficient only for bounded reads; high-volume sources need server paging and a true server total.
2. Migrate remaining hand-written tables to `EnterpriseTable` or the shared paging hook, prioritizing safety-critical and high-volume modules rather than applying a blind mechanical rewrite.
3. Add organisation-backed saved views for reusable filter/sort/column layouts. Local-only saved state is not sufficient for a multi-device SaaS.
4. Replace native date controls where timezone, range, or locale semantics matter; certify inclusive/exclusive boundaries against each API contract.
5. Add canonical detail links and return-state restoration to registers that still have rows without a supported drill-down journey.
6. Validate every apparent “thin module” as a workflow: create/edit, validation, approval, audit history, failure recovery, and downstream reconciliation. Wrapper pages must be credited for shared-engine behavior; true placeholders must be closed or removed from navigation.
7. Exercise the above as authenticated browser journeys with seeded tenant data. Static inspection and unit tests cannot certify navigation permissions or live data behavior.

## Definition of done for this ledger

A module is complete only when its primary job can be completed with authorized tenant data, errors are recoverable, totals are honest, long datasets remain reachable, consequential actions are auditable, and the list-to-detail-to-list journey preserves the operator's working context.
