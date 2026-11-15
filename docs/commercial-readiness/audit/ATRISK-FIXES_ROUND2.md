# At-risk module fixes, round 2 (stream ATRISK-FIXES)

Date: 2026-11-15. Branch `claude/at-risk-module-fixes-7rxp2t` (from main at 500fd8f6). Not pushed, no pull request.
Production was read only (catalog and counts). Nothing was applied, deployed or switched.

Source: class (c) "Defect found" in the at-risk modules review (18 entries). Each was re-checked against
`origin/main`, the open draft pull requests and the production catalog before any change.

## Result per defect

| # | Defect | Real on main? | Outcome |
|---|---|---|---|
| 17 | Heat Intelligence reads `current_status`, absent from `tyre_records`; the error is read as "no table", so fleet risk shows no tyres | Yes | Fixed. Column removed; a wrong column (42703) now raises and the page's existing error card with Retry shows it |
| 40 | Stock Replenishment reads `stock` (0 rows); the Stock module writes `stock_records` (43 rows) | Yes | Fixed in the service: reads `stock_records`, maps `tyre_size` to size and `stock_qty` to quantity, paged. Module switch left off |
| 51 | Carbon Tracker saves a blank cost, tree count, provider and project as invented values | Yes | Fixed in the client (a blank is not sent). Draft ATR-2 makes the two numeric columns nullable |
| 34 (2) | Alert Thresholds offers "Cost Per KM", which the hourly job never evaluates | Yes | Fixed: not offered for new rules |
| 34 (1) | A Tread Depth rule makes the hourly job read a missing column and stops the whole run | Yes | Client: the tread metric and its one-click preset are not offered for new rules. SQL: covered by draft `20261113153000_com_alert_thresholds_org_scope` (PR #510 / #518); no second draft written |
| 34 (3) | Four job branches have no organisation filter | Yes | Covered by the same draft (PR #510 / #518) |
| 19 | Tyre Pool route has no role guard; the write policy admits Admin, Manager, Director | Yes | Fixed: route guard; menu and search entries match |
| 29 | Workshop Analytics delay cost is priced at a hard-coded 120 per hour with no note | Yes (`workshop_config` has 0 rows) | Fixed: the page states it is an estimate at the default rate when no rate is set |
| 26 | Live Control: same default rate; write refusal for Manager and Director | Yes | The engine now reports the rate source (`labourRateBasis`). The Live Control screen files are edited by PR #511 / #519, so the label there is left to those. Write refusal: covered by PR #511 / #519 |
| n/a | `user_view_prefs` missing in production (a 404 from every register) | Yes | Client stops asking after the first definite "no such table" answer. Draft ATR-1 creates the table |
| 30 | Corrective Actions update returns no row | Yes on main | Covered by PR #511 (and #519): same function, same fix. Not touched here, to avoid a conflict |
| 1 | Site Management edit sends `updated_by`; Director is shown the controls | Yes on main | Covered: the edit fix is in PR #504 (base of every draft); `SiteManagement.jsx` is changed in PR #511 |
| 25 | Work Orders write controls and job card numbering | Yes | Covered by PR #511 / #519 and draft `ten1b` (PR #506 / #518) |
| 50 | KPI Center targets cannot be saved twice | Yes | Covered by PR #511 / #519 |
| 46, 47 | Budgets key without organisation; editor shown to roles that cannot save | Yes | Covered by PR #511 |
| 22 (2) | Warranty claim number unique without organisation | Yes | Covered by draft `com_warranty_claim_no_per_org` (PR #510 / #518) |
| 22 (1, 3, 4) | Warranty route guard, country picker, assumed recovery figure | Yes | Left. The write policy admits every approved user, so which roles the route admits is an owner decision; the assumed figure needs design |
| 52, 55 | Scheduled email currency; webhook delivery | Yes | Covered by PR #509 |
| 43, 48 | Supplier master; TCO benchmarks | Yes | Left: needs design |
| 54, 55 | Role guards on Automation Rules and API and Webhooks | Yes | Left: nothing says which roles; asked below |

## Files changed

Code: `src/lib/api/heatIntelligence.js`, `src/lib/api/carbon.js`, `src/lib/api/purchaseOrders.js`,
`src/lib/api/registerViews.js`, `src/lib/alertThresholdMetrics.js` (new), `src/pages/AlertThresholds.jsx`,
`src/lib/workshopLive.js`, `src/lib/workshopAnalytics.js`, `src/pages/WorkshopAnalytics.jsx`, `src/App.jsx`
(one route), `src/components/Layout.jsx`, `src/components/LegacyLayout.jsx`, `src/lib/commandSearch.js`
(one entry each).

Tests: `src/test/atRiskFixesRound2.test.js` (new), `src/test/purchaseOrders.api.test.js`,
`src/test/registerViews.api.test.js`.

Drafts (not applied): `supabase/pending_migrations/20261117100000_atr_user_view_prefs.sql` (ATR-1),
`supabase/pending_migrations/20261117101000_atr_carbon_offsets_blank_is_null.sql` (ATR-2), README entry.

## Tests

- The new and changed tests were run against the code before the fixes: 23 failed. After: all pass.
- 26 test files, 338 tests passed (the three above plus the directly related heat, carbon, stock replenishment,
  workshop, saved view, menu and route parity, search coverage and row cap suites).
- eslint on the changed files: 0 errors. One `vite build`: clean. The full suite was not run.

## Proven on synthetic staging only (local database `tp_atrisk`; companies Alpha, Beta, Gamma; all rolled back)

Verified Fixed:
- ATR-1 applies cleanly and a second run changes nothing. The owner reads and writes own rows. A second default
  view is refused (23505). A row stamped with another company is refused. A row for another user is refused. The
  upsert the client sends updates in place. Another company reads 0 and updates 0. A colleague in the same company
  reads 0. Anon is denied. The trigger function is not executable by anon. Reader policies are present.
- ATR-2: before, a blank cost and tree count are stored as 0 and 0; after, as NULL and NULL. An entered cost is kept.

Not Tested: no browser run of any page; the stock replenishment read against real PostgREST; Arabic; phone widths.

## Impact

Current company: Heat Intelligence fleet risk lists tyres for the first time (the read failed for everyone). Tyre
Pool is no longer offered to roles that could not save there. A carbon offset no longer records values nobody
typed. Tread and cost per km alert rules cannot be created (there are 0 rules today, so nothing existing changes).
Workshop Analytics says when its cost figure rests on the default rate. No number on any other screen moves.

Commercial: removes a section that looked empty for every customer, an invented-data defect, and a one-click
way to stop every alert rule of every company.

## Order and dependencies

The code is safe before either draft. ATR-1 and ATR-2 are independent of each other and of every other draft.
When `20261113153000_com_alert_thresholds_org_scope` is applied, remove `tread_depth` from
`UNAVAILABLE_METRICS` in `src/lib/alertThresholdMetrics.js`.

## Rollback

Code: revert the commit. ATR-1: remove the table and its trigger function (it holds layouts only). ATR-2: restore
the defaults and NOT NULL (statements are in the draft header).

## Remaining risks

- Until ATR-2 is applied a blank carbon cost is stored as 0 (the column default) and counts in the cost per
  tonne tile. The module is switched off today and the table holds 0 rows.
- Stock Replenishment depends on brand and tyre size being filled on stock records: 12 and 16 of 43 rows carry
  them today, so most lines will show stock without usage until the rest are filled.
- The saved-views client remembers "table missing" until the page is reloaded, so a tab open while ATR-1 is
  applied needs one refresh.
- The older file `supabase/migrations/20260921090000_user_view_prefs.sql` is still in the migrations folder,
  unapplied. Remove it when ATR-1 is approved so only one of the two can run.
- Small merge overlap with the pull requests based on #504: one line each in `App.jsx`, `Layout.jsx`,
  `LegacyLayout.jsx`, `commandSearch.js`, and the pending README.

## Questions for the owner

1. Apply ATR-1 (saved views) and ATR-2 (carbon blanks)?
2. Which roles should open Warranty, Automation Rules and API and Webhooks?
3. Should Tyre Pool stay visible, read only, to Tyre Man and Inspector? It is now limited to Admin, Manager, Director.
4. Tread depth alerts stay hidden until the alert job draft is applied. Agreed?
