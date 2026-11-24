# Tyre Pulse WMS: final status report (2026-11-24)

For the owner to cross-check (e.g. with ChatGPT/Codex). Every claim below is backed by a commit, a test run or a live
read-only query from this session. "Proven rolled back" means the migration was run on the live database inside a
transaction that was then undone, and a follow-up query confirmed nothing persisted.

## 1. Where the code is

| Item | Value |
|---|---|
| GitHub `main` | `5d59ac7c` (#609) |
| PR #608 branch `claude/wms-wp0-register` | tip after the independent-review fix rounds (see section 11); merged to main on owner instruction 2026-11-24 |
| PR #608 merge | Owner said merge (2026-11-24). Migrations below are still NOT applied |
| Vercel previews for this branch | switched off in `vercel.json` (pushes cost no build) |

## 2. Test evidence (full run on the branch tip)

| Check | Result |
|---|---|
| ESLint (whole `src/`) | 0 errors, 1 warning (after review fixes) |
| Vitest | 1,441 files: 16,957 passed, 1 failed, 14 skipped (after review fixes) |
| The 1 failure | `checklistIcons.test.js` reads `mobile/node_modules/...Ionicons.json`, not installed in this checkout (known environmental; passes in CI) |
| Production build (`vite build`) | passes |
| Flutter (`flutter analyze`, stock_count + inventory tests) | clean; 131 passed, 4 skipped after review fixes. NOT run on a real device |

## 3. Live database: applied vs pending

Applied live this session (owner approved):
- `20261123185906` WP1: 3,508 KSA catalogue-to-ERP links, OEM number normalisation, 2 brand aliases.
- `20261124080435` 22 brand spelling aliases (owner: "approve brand merge to production"). brand_aliases 38 -> 60.

Written, proven rolled back, NOT applied (each needs the owner's yes; order matters):

| Order | Migration | What it does |
|---|---|---|
| 1 | `20261124090000` WP4 | No self-approval of requisitions/POs (incl. super admin); receipts only against approved/ordered POs and their lines; PO delivery status only from receipts; approver stamped server-side |
| 2 | `20261124091000` WP5 | Issue slips post exactly one ledger movement; Store Keeper transfer scope; count differences need `adjustment_approve` (also `set_stock_count`); bounded returns to the issued line at issued cost; quick-entry receipts without GRN still allowed |
| 3 | `20261124130000` Procurement | RFQs + quotes, approved supplier list, PO approval limits (admin screen), emergency PO with full justification form, supplier returns, backorder + delivery-performance views (needs WP4 first) |
| 4 | `20261124131000` Workshop | Reservation-aware issue slips, installation confirmation by a second person, return cannot undo confirmed installs (needs WP5 first) |
| 5 | `20261124132000` OEM / matching | Two-person item link queue, country and duplicate guards on OEM links |
| 6 | `20261124133000` Special classes | Location types/capacity/vans, tool custody + calibration, lubricant dispensing, repairable unit history, two-person scrap |
| 7 | `20261124120000` Fleet priority | Stores maintenance priority + per-machine override (page already works without it) |
| 8 | `20261124135000` Read timeouts | 2 partial indexes + identical faster ERP view + one-pass RPC (apply in a quiet window: work_orders index build blocks writes) |

Ledger gap found: PR #606's `profiles_ui_preferences` and `inv_owner_override` are live but not recorded in
`supabase_migrations` (applied by hand). Recording them needs the owner's OK.

## 4. Reconciliation counts (live, read-only)

| Measure | Count |
|---|---|
| Stock lines / movements / qty on hand | 5,583 / 5,619 / 129,673.55 (unchanged vs acceptance test) |
| Stock lines linked to the catalogue | 5,533 |
| Stock lines with no item | 43 = 28 KSA with an exact code match (in approval queue), 8 tyres with no code (owner: later), 7 demo |
| Stock lines with item but no catalogue link | 7 (all demo) |
| Catalogue links | 3,508, all KSA; 0 duplicates, 0 cross-country |
| ERP items with no catalogue link | UAE 9,321, KSA 7,047, Egypt 3,398 (catalogue is KSA-only today) |
| OEM references | 0 approved (1,652 manual rows parsed) |
| Suppliers / requisitions / POs / material issues | 0 / 0 / 0 / 0 (built, never used yet); goods receipts 1 |

## 5. Work package status

| Work package | Previously | Newly completed | Remaining | Evidence | Live | Status |
|---|---|---|---|---|---|---|
| WP0 Register detail | Register shows Material Master + ERP usage | Country-keyed usage, capped reads refused | none | tests, CI | yes (after merge) | CODE COMPLETE, NOT LIVE |
| WP1 Linking | Applied | Counts re-verified | UAE/Egypt have no catalogue (owner data) | live queries | yes | COMPLETE AND VERIFIED (KSA) |
| WP2 OEM | Review queues | Link queue + approved OEM parts with stock, guards | 0 links approved yet; compatibility by model needs `vehicle_fleet.model` | rolled back proof, 19 tests | no | CODE COMPLETE, NOT LIVE |
| WP3 Reorder | Suggestions | Owner confirmed: system suggests, person approves | lead times/supplier data (none yet) | tests | after merge | CODE COMPLETE, NOT LIVE |
| WP4 Procurement | UI | RFQ, limits, emergency form, returns, backorders, match | apply + first real purchase run | rolled back proof, 80 tests | no | CODE COMPLETE, NOT LIVE |
| WP5 Issues/transfers | UI | Approval for count differences, phone count records for approval | apply; phone release | rolled back proof | no | CODE COMPLETE, NOT LIVE |
| Workshop integration | none | Job card materials end to end, cost per asset | install photo upload; handover screen reads installs | rolled back proof, 135 tests | no | CODE COMPLETE, NOT LIVE |
| Locations / tools / lubricants / repairables / scrap | panels | DB + screens | owner setup of repair locations; lubricant units | rolled back proof, 122 tests | no | CODE COMPLETE, NOT LIVE |
| Auditing / counting | existed | verified only | none | live function bodies read | yes | COMPLETE AND VERIFIED |
| Tyre custody vs fitment | existed | verified only | 7 open conflicts for review | live | yes | COMPLETE AND VERIFIED |
| Flutter warehouse ops | lookup, scan, counts, transfers | count for approval, issue/return to job card, Add stock fixed | PO receiving, pick lists, signatures; device test; release | 401 Flutter tests | no | PARTIALLY COMPLETE |
| Fleet maintenance priority | none | Matrix P1-P6, filter, KPI, export | stored override needs migration 7 | 64 tests | after merge | CODE COMPLETE, NOT LIVE |
| Performance | none | Timeouts fixed, fewer round trips | region decision | measured before/after | no | CODE COMPLETE, NOT LIVE |
| Permissions | DB-enforced | No self-approval, server-stamped approvers, site scope | owner assigns Store Keeper locations in Console | proofs | partly | PARTIALLY COMPLETE |
| Arabic for new panels | deferred by owner | location types, section names | panel text | i18n tests | no | PARTIALLY COMPLETE |

## 6. Documents produced
- `docs/architecture/` (11 diagrams, Mermaid + editable draw.io; statuses from the live schema).
- `docs/performance/REGION_LATENCY_AUDIT.md` (measured from Riyadh; Tokyo cold p50 589 ms / p95 1,038 ms; DB ~10 ms; Frankfurt estimate only).
- `docs/warehouse/12_MERGED_PR_VERIFICATION.md` (30 merged PRs: all live; data intact).

## 7. Owner decisions recorded
1-2 done; 3 OK (suggest + approve); 4 brand merges approved and applied; 5 tyre codes later; 6 genuine/aftermarket at
audits; 7 Store Keeper sites unchanged (Console later); PO limit amounts later via the admin screen; emergency purchases
allowed only with the full justification form; installation confirmed by a supervisor/manager, never the issuer.
2026-11-24 (after review): no Expo changes or OTA ever, Flutter only; count differences posted only by an Admin or
the super admin; plain Admins may still post a bare stock movement (kept, pending revisit); stock can only be issued
to a job card already loaded from the ERP Excel.

## 8. Open questions for the owner
- Emergency purchase: should "customer commitment" be allowed without an asset/job card?
- Emergency attachment is a typed path; add a file upload?
- Region: Frankfurt read replica vs full migration vs stay (no change without approval).

## 9. Exact approvals requested
1. "apply WP4 and WP5" (then 130000, 131000, 132000, 133000, 120000 in that order, and 135000 in a quiet window).
2. "record 606 migrations".
3. "merge 608" (one production build).
4. Flutter release to Play closed testing (phone changes reach users only after a build).
5. Region decision (see the performance report).

## 10. Not verified
Real devices; screens behind login in production; Frankfurt latency; costs of a region move; behaviour after the
pending migrations are applied for real (only rolled-back proofs so far).

## 11. Independent review rounds (2026-11-24)

Two reviewers on a different model read the code (not our summary). Every agreed finding was fixed and re-checked.

| Area | Commits | Proof |
|---|---|---|
| Database (8 unapplied migrations) | `6103617b`, `3d113149` | One rolled-back run of all 8 files in apply order as real users: 95 of 95 cases as expected; live DB re-checked unchanged (movements 5,619, stock lines 5,583, no new objects) |
| Web | `25df4040`, `2ccedc94`, `0f0078d1`, `7f354648` | Lint 0 errors, 16,957 tests passed, production build passes |
| Flutter | `3c874903` | Analyze clean, 131 tests passed |

What the migrations change once applied (all need the owner's "apply WP4 and WP5" first):
- Receipts, transfers, supplier returns and scrap only through their own documents; the generic movement form issues only.
- Count differences only by an Admin or the super admin; others record counts for them.
- A PO needs an approved, active supplier from the supplier list to be submitted or approved; once approved its
  supplier, currency, site and totals are frozen; whoever created it, last edited it or added a line cannot approve it.
- A requisition is decided only after it is submitted, and its content is frozen once submitted.
- Emergency purchases: no invoice, match or close until approved after the fact; more than 10% over the estimate needs a reason.
- Job cards are matched to the loaded work orders (case and spaces ignored) and must be in the user's country.

Known gaps left honest: usage figures miss about 69 ERP lines with mixed-case item codes (mostly Egypt); stock lines with
no country get no catalogue details; Add stock double-tap guard checked by analyze only (no widget test harness).
