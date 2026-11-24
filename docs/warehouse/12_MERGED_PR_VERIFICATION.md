# Merged PR verification in production (2026-11-24, read-only)

Everything here was READ only. No commit, push, deploy or database write. No login was attempted.

## How it was checked

- PR list: `gh pr list --state merged --limit 30` (PRs #578 to #609, merged 21-24 Nov 2026).
- Deploy: Vercel project `tyre-pulse` (web app, prj_5csYUyBoIN8RFDnHLX8sdO46uZYT). The newest production
  deployment `dpl_3DRr6zZBou5Gbvrb4mLBb1fQcXwy` is **READY on `5d59ac7c` (#609)**, which is also the tip of
  `origin/main`. Each PR's merge commit was checked with `git merge-base --is-ancestor <sha> 5d59ac7c`.
- `tyre-pulse-eezl` (marketing): the Vercel API returns 403 for this account, so its deployments could not be
  read. No PR in this window touched `marketing/` (git log since 17 Nov is empty), and www.tyrepulse.app returns
  200 with no console errors.
- Migrations: `supabase_migrations.schema_migrations` plus `pg_proc` / `information_schema` / `pg_constraint`.
- Runtime: Vercel `get_runtime_errors` (7 days); Supabase unified logs (last 24 h), postgres + edge.
- Smoke test (Playwright, no login): app.tyrepulse.app/login, www.tyrepulse.app, an invalid /report token.

CANCELED production builds in the window (#607, #605, #599, #591, #588, #578, #523, #503) were all superseded
duplicates. Each of those commits is contained in a later READY build, so none is missing from production.

## Per PR

| PR | Title (short) | Merge sha | In live deploy? | Migration | Runtime errors seen | Verdict |
|---|---|---|---|---|---|---|
| 609 | Report Sharing hardening | 5d59ac7c | Yes (READY, current) | `20261124093000` recorded as `20261124074559 report_sharing_hardening_20261124`; `report_shares.allowed_country/allowed_site`, `create_report_share_scoped`, new `get_report_snapshot` / `get_report_tyre_maintenance` / `get_workshop_snapshot` exist | One `get_report_snapshot` 500 (8 s timeout) at 07:18, 27 min BEFORE this migration; none since. 2 shares, both active, 0 active-but-expired. Invalid token page shows "This report link is not available", 0 console errors | WORKING (speed of a real board after the change not measurable without a token) |
| 607 | Flutter grey canvas | 33d813f0 | Yes | none | - | WORKING for web deploy; Flutter is a mobile build, not on phones until a build is released (not verifiable here) |
| 606 | Inventory & Procurement layouts, Material Master, saved themes | 9cf851a2 | Yes | `20261123150000_profiles_ui_preferences` and `20261123160000_inv_owner_override` are **NOT recorded** in schema_migrations, but every object exists (`profiles.ui_preferences` + `profiles_ui_preferences_shape`, `_inv_owner_override_on`, `inv_owner_override_post`, `inv_gate_opening_approve`). Applied by hand (execute_sql). 1 profile has saved preferences | Stock pages: `v_inv_valuation` 500 at offsets 3000/4000 (4 timeouts) and `v_inv_erp_reconciliation` 500 (2) | PROBLEM (see P1, P2) |
| 605 | Memory: branch audit | d1f3ed6a | Yes | none | - | WORKING (docs only) |
| 604 | Inventory menu into app sidebar | bc6f9fca | Yes | none | - | WORKING (build READY; page behind login, not clicked) |
| 603 | Approve proposed materials 500 at a time | 71983e4f | Yes | `20261123085513 inv_material_bulk_decide`, `inv_material_canonical_decide_bulk` exists | none | WORKING: all 3,508 canonical materials are `active`, 0 duplicate SKUs, 0 items linked twice, 0 orphan links |
| 602 | Flutter fresh mint | 1f34f52f | Merged into `claude/ui-spacing-polish`, not main. All 30 of its files are byte-identical in the #600 squash (2841065), so it reached main via #600; mint then replaced by #607 on owner request | none | - | WORKING / superseded |
| 601 | Web audit fixes (Board Overview etc.) | 7b10925b | Yes | none | none for Board Overview | WORKING (page behind login, not clicked) |
| 600 | Flutter spacing polish | 28410654 | Yes | none | - | Web deploy OK; mobile not verifiable |
| 599 | Flutter navy focus | b3716410 | Yes | none | - | Web deploy OK; mobile not verifiable |
| 598 | Inventory web mockup look, Material Master, 3D store | 01813941 | Yes | none | see #606 stock timeouts | PROBLEM shared with #606 (P1) |
| 597 | Flutter physical inventory capture | 9cc051d0 | Yes | none | - | Mobile, not verifiable |
| 595 | Flutter text overflow | b28fe548 | Yes | none | - | Mobile, not verifiable |
| 594 | Flutter approvals signature + bulk | dd05be30 | Yes | none | - | Mobile, not verifiable |
| 593 | Flutter design system / Widgetbook | 5c9fc659 | Yes | none | - | Mobile/dev tooling, not verifiable |
| 592 | Flutter Widgetbook | 5e666085 | Yes | none | - | Mobile/dev tooling, not verifiable |
| 591 | Flutter tyre map | 6c4ffec0 | Yes | none | - | Mobile, not verifiable |
| 590 | OEM catalog selectable parts | a90c506d | Yes | none | none | WORKING (build READY; not clicked) |
| 589 | iOS manual signing | 14ca393c | Yes | none | - | CI only, not verifiable here |
| 588 | iOS TestFlight preflight | 1f474483 | Yes | none | - | CI only, not verifiable here |
| 587 | Physical inventory release | d185b7fa | Yes | `20261122100000 inv_physical_inventory_master`, `20261122110000 inv_transfer_return_remaining_fix`, `20261122120000 inv_location_setup` all recorded; `_inv_transfer_move`, `_inv_transfer_return_remaining`, `inv_location_bulk_create` exist | none | WORKING |
| 586 | Memory record | e2252e9a | Yes | none | - | WORKING (docs) |
| 585 | Physical inventory registration (draft migration) | 9e17a1a7 | Yes | draft in `pending_migrations/`; later applied by #587 (above) | none | WORKING |
| 584 | Inventory KPI catalogue, ABC/FSN/VED | a42321df | Yes | none | none | WORKING (not clicked) |
| 583 | Demo Fleet acceptance fixtures | 26d81870 | Yes | none | - | WORKING (test data) |
| 582 | report-pdf-retention job | aa21fab9 | Yes | `20261121120000` recorded; `pdf_cache_retention_preview` exists | cron `report-pdf-retention` ran and **succeeded** 22, 23, 24 Nov 01:23 UTC | WORKING (proven) |
| 581 | Flutter analyze imports | abfdc95b | Yes | none | - | CI fix, not verifiable here |
| 580 | Inventory closure screens | 5ea711b3 | Yes | none | none | WORKING (not clicked) |
| 579 | Flutter Android release action | 7e173ea6 | Yes | none | - | CI only, not verifiable here |
| 578 | Team Operations navigation | 1136fbf2 | Yes (READY via later build) | none | none | WORKING (not clicked) |

## Runtime health

- Vercel `tyre-pulse` runtime errors, last 7 days: **none**.
- Supabase edge 5xx (last 24 h), all from real browsers, all 8-second statement timeouts:
  - `v_inv_valuation` (stock valuation, KSA, pages at offset 3000 and 4000): 4
  - `work_orders` list: 3 (one is a `%stock%` text search)
  - `v_inv_erp_reconciliation`: 2
  - `get_asset_master`: 1, `get_report_snapshot`: 1 (before the #609 migration), `inv_opening_batch_approve`: 1
  - 520/503 bursts on 23 Nov ~10:04-10:05 match a database restart ("database system is starting up", 5 FATAL).
- Postgres ERROR rows: 14 statement timeouts (above); the rest are developer/agent probe queries
  (`ROLLBACK-REPORT`, `RESULT ...`, typos like `column l.item_code does not exist`), not app traffic.
- Expected business refusals also logged (not bugs): opening-batch approval required (42501), "Possible
  duplicates exist" (22023), duplicate SKU on `material_canonical_sku_uq` (23505).

## Data integrity (SELECT only, compared with 06_ACCEPTANCE_TEST_2026-11-24.md)

| Check | Now | Acceptance doc | Same? |
|---|---|---|---|
| stock_records | 5,583 | 5,583 | yes |
| stock_movements | 5,619 | 5,619 | yes |
| total qty on hand | 129,673.55 | 129,673.55 | yes |
| lines whose ledger sum differs from qty_on_hand | 0 | - | clean |
| lines with qty but no ledger rows | 7 (all outside Company A, demo org) | 7 | yes (known) |
| stock_qty different from qty_on_hand | 33 | 33 | yes (known) |
| negative qty / reserved > on hand / orphan movements | 0 / 0 / 0 | - | clean |
| suppliers / requisitions / POs / GRNs / issues / transfers | 0 / 0 / 0 / 1 / 0 / 1 | same | yes |
| material_canonical (active) / duplicate SKUs / items linked twice / orphan links | 3,508 / 0 / 0 / 0 | - | clean |

No count changed since the acceptance test, so nothing recent damaged the stock data.

## Problems found

- **P1 (real users affected):** KSA stock valuation does not load past row 3,000. The browser pages
  `v_inv_valuation` 1,000 rows at a time, two pages in parallel; each page re-runs two correlated sub-queries on
  `inventory_cost_reconciliations` per row (~1 ms/row). Measured read-only, without row security, one page at
  offset 3000 takes 4.0 s; with row security and two pages at once it passes the 8 s limit and returns 500.
  Same class: `v_inv_erp_reconciliation`, `work_orders` text search, `get_asset_master`. Needs a query fix
  (pre-aggregate the open reconciliations once, or an index on `(stock_id, status, kind)`), not data changes.
- **P2 (record-keeping):** two #606 migrations are live but missing from `schema_migrations`, so a future
  `supabase db push` may try to re-apply them. Their objects exist; only the history row is missing.
- **P3 (not verifiable):** all Flutter PRs (#579, #581, #591-#600, #602, #607) and iOS CI PRs only reach users
  through a mobile build; their effect cannot be seen in web production.
- **P4 (not verifiable):** marketing project `tyre-pulse-eezl` deployments are 403 to this account; the site
  itself is up.
- Login and pages behind login were not exercised (no credentials entered by design), so screen behaviour of
  #598/#601/#604/#606 is confirmed only as "built, deployed, no runtime errors", except where logs show P1.
