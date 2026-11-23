# Live web app audit — 22 Nov 2026

Checked in Chrome on https://app.tyrepulse.app, signed in as an Admin. Console errors, network
requests, page load time, accessibility and number accuracy were inspected page by page. Security
was checked against the live database.

## Scope
- 31 pages at desktop width: Command Center, Fleet Master, Tyre Records, Tyre Lifecycle,
  Inspections, Checklists, Approvals, Accidents, Accident Cases, Work Orders, Workshop Live,
  Daily Ops Workshop, Expenses, Expense Trends, CPK Intelligence, Cost per M3, Stock, Inventory,
  Reports, Board Overview, Settings, Data Intake, Scheduled Reports, Report Sharing, plus the
  sign-in page.
- Phone width: the sign-in page, then Home, Accidents, Work Orders, Stock and Expenses.
  The Chrome window then stayed maximized, so the phone results after the sign-in page are not
  reliable (NOT RUN properly). They need a Playwright pass.

## What passed
- **Security:**
  - Every public table has row security on.
  - Logged-out visitors cannot read any table.
  - No public storage buckets.
  - Every privileged function pins its search path.
  - 15 functions are callable without signing in, all sign-in or share-link functions:
    - Added since the last audit: `get_invitation_preview` and `request_password_reset`.
    - Removed since the last audit: `reset_login_attempts`.
- **Headers:** CSP (no unsafe-eval), HSTS, X-Frame-Options DENY, nosniff, referrer policy and
  permissions policy are all present.
- **Errors:** no console errors on any page, and no raw database text on screen.
- **Numbers:** these match the database exactly:
  - Fleet: 1,623 total and 1,208 active.
  - Accidents: 44 total and 30 open.
  - Accident cost: SAR 15,566.
  - Claims: 26 = filed + approved + settled.

## Issues found

| # | Severity | Where | Issue | Status |
|---|---|---|---|---|
| 1 | HIGH | Board Overview | Never finishes loading (still "Loading" after 30 s). It downloads every job card ever recorded (97,479 rows, about 98 requests of 1,000) only to count the 49 open ones. | **Fixed.** Reads open job cards only and still re-checks each status. Zero open shows 0, not N/A. |
| 2 | HIGH | All money tiles (Accidents, reports, PDFs) | Currency shows as `"SAR"` with quote marks. The company name is stored quoted too, so it prints quoted on reports. Cause: Settings saved text values wrapped in JSON quotes, and the stored value has two layers. | **Fixed in code:** values are read with every quote layer removed, and saved as plain text. The stored data is untouched; it reads correctly now and is rewritten clean on the next Settings save. |
| 3 | HIGH | Every page (infrastructure) | Each request takes about 0.8 s even when the database answers in 10 ms. The database is in Tokyo (`ap-northeast-1`) and the users are in KSA, UAE and Egypt. Pages making 40 to 60 requests take 4 to 8 s. | **Owner decision.** Moving the project to a Middle East or Frankfurt region is the largest single speed gain. |
| 4 | MEDIUM | Inspections | Takes 8.3 s. It downloads all 2,807 inspections in 3 pages before showing anything. | Open. Needs server-side paging (a larger change). |
| 5 | MEDIUM | Expenses | Takes 8.4 s, with 45 requests. The heaviest are `get_cost_cpk_overview_multi` (4.2 s) and `get_cost_variance_multi` (4.1 s). | Open. Mostly item 3. |
| 6 | MEDIUM | Sign-in page | Downloads code for the whole app before sign-in: the app frame, the console frame, analytics, the alert engine and breadcrumbs. | **Fixed.** The app and console frames load after sign-in. Preloaded files went from 71 to 46. |
| 7 | MEDIUM | Command Center | The "↑ 0.1%" trend labels overlap the KPI numbers (Total and Active Vehicles). | **Fixed.** The number moves down to make room; the label follows the reading direction in Arabic. |
| 8 | MEDIUM | Welcome tour | The Escape key does not close it, so a keyboard user is stuck (WCAG 2.1.2). | **Fixed.** |
| 9 | LOW | Expenses chart builder | 7 controls (Chart, Type, Colours, Sort, Show top, Saved reports, Trend line) have visible names that screen readers don't hear. | **Fixed.** Each name is now linked to its control. |
| 10 | LOW | Sign-in page | The theme button is a 28 px target (minimum 44 px). | **Fixed.** Now 44 px. |
| 11 | LOW | Approvals | A request to `user_view_prefs` fails because that table's migration was never applied. The page works without it. | Owner decision: apply `20260921090000_user_view_prefs.sql` or leave as is. |
| 12 | LOW | Tyre Records, Inspections, Inventory | No page heading (h1) for screen readers. | Open. |
| 13 | LOW | Sign-in page | The illustration library (165 kB) still loads eagerly, because the crash screen uses it. | Open. Low value. |
| 14 | INFO | Sign-in | `get_email_by_identifier` still returns a real email address to someone not signed in. This is already known. | Unchanged. Moving sign-in to an edge function is the fix. |
| 15 | INFO | Sign-in page | The HTML response sends `Access-Control-Allow-Origin: *`. This is harmless for a static page. | Unchanged. |

## Load times (full page load, signed in, desktop)

| Page | Ready | Requests |
|---|---|---|
| Tyre Records | 1.0 s | 10 |
| CPK Intelligence | 1.3 s | 12 |
| Fleet Master | 1.3 s | 9 |
| Command Center | 2.1 s | 10 |
| Work Orders | 2.5 s | 9 |
| Accidents | 3.5 s | 19 |
| Inspections | 8.3 s | 34 |
| Expenses | 8.4 s | 45 |
| Board Overview | over 30 s (never) | about 98+ |

## Not run
- **Proper phone and tablet sweep at 320, 390, 768 and 1024 px:** the Chrome window could not be
  resized after the first check.
- **Arabic right-to-left pass.**
- **Role tests with a non-admin account:** no test account was available.
- **The Console** (`/console`), which needs its own sign-in.

## Full page sweep (all 210 pages, desktop, scrolled top to bottom)

Every route was opened in Chrome and scrolled to the bottom. Each page was checked for: error screen,
spinner that never ends, raw text or i18n keys on screen, sideways scroll, overlapping or clipped text,
missing page heading, failed requests and load time. Overlap flags were then re-checked with a stricter
test that ignores text a table has scrolled out of view; 12 of 14 were false alarms of that kind.

| # | Severity | Where | Issue | Status |
|---|---|---|---|---|
| 16 | HIGH | Technician Scorecard | Never finished loading (still spinning after 40 s). It read all 97,479 job cards; only 9,370 name a technician, and the other 88,109 were ranked as if "Unassigned" were a person. | **Fixed.** Reads only job cards with a technician; the page states how many have none. |
| 17 | HIGH | Cost Center, Cost per unit | "m³ produced" was summed in the browser from at most 20,000 of ~300,000 production rows, so cost per m³ was wrong for any wide window, and the 20 page reads took ~20 s. | **Fixed.** Summed on the server (`get_production_monthly`, row security still applies). |
| 18 | HIGH | Fuel Theft | At laptop width the investigation panel and risk legend wrapped one letter per line and overlapped. | **Fixed.** Panels size to the space available, not the screen width. Checked in the live page. |
| 19 | MEDIUM | Live Fleet | Long vehicle codes ran under the health score, the card footer was cramped, and the grid left half the width empty. | **Fixed.** |
| 20 | MEDIUM | Rotation Schedule | The page scrolled sideways (2,610 px wide): a hidden file input was stretched to the full screen width. | **Fixed.** |
| 21 | MEDIUM | Advanced Analytics | The Refresh button spun forever on the Overview tab and did nothing there; the tyre-cost tile cut numbers off ("EGP 4,378,0..."). | **Fixed.** Refresh reloads the overview; the tile sizes its text to fit. |
| 22 | MEDIUM | Anomalies | Took 17 s: scanned all history (40,000 job cards, hitting its own cap). | **Fixed.** Opens on this year; "All dates" is one click. |
| 23 | MEDIUM | Inspections | An inspection's odometer and hour meter never reached the vehicle. | **Fixed in the database, not yet applied:** `supabase/migrations/20261122210000_inspection_meter_to_logs.sql`. Tested on live data in a rolled-back transaction (vehicle km 404,050 to 404,100 to 404,200, one log row each). Needs the owner's approval to apply. |
| 24 | LOW | Downtime Tracker | The period filter showed the raw key `downtime.periods.This month`. | **Fixed** (English and Arabic). |
| 25 | LOW | Suppliers | No page heading while loading or on error. | **Fixed.** |
| 26 | MEDIUM | Data Reconciliation, Expense Trends, Work Orders, Expenses | Server answers time out (8 s limit) under load: `get_tyre_evidence_audit`, `get_asset_ownership`, `get_data_trust_overview`, `get_site_operating_cost_multi`, `get_cost_cpk_overview`. | Open. Needs database tuning per function. |
| 27 | INFO | 30+ pages | Currency shows as `"SAR"` with quotes. | Fixed by item 2; shows correctly once deployed. |
| 28 | INFO | System Health | Calls to edge functions `account-recovery`, `billing-checkout`, `send-email` fail from the browser health check. | Open. Check whether these are deployed. |

Pages confirmed slow but working (8 to 14 s): Expenses, Executive, Benchmark, Site Comparison,
Fleet Intelligence, Ops Intelligence, Tenant Health, Maintenance Calendar, Inspection Intelligence.
The main cause is item 3 (database in Tokyo).
