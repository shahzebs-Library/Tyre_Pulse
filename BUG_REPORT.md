# TyrePulse - Bug Report & Status Tracker
**Originally created:** 2026-06-12 (72 pages, Playwright + manual audit)
**Last verified / updated:** 2026-07-02 - re-ran the upload/import flow end-to-end in a real browser; fixed two data-integrity bugs in the column mapper (see 034).

> Keep this file updated: when a bug is fixed, set its status to ✅ with a one-line note. Re-run a full audit after major releases.

## Status summary (2026-07-02)

| Severity | Total | ✅ Resolved | ◑ Partial / cosmetic | ⚠️ Re-verify on device |
|----------|-------|-------------|----------------------|------------------------|
| Critical | 9 | 9 | 0 | 0 |
| High | 11 | 7 | 0 | 4 |
| Medium | 10 | 5 | 5 | 0 |
| Low | 5 | 2 | 3 | 0 |
| **Total** | **35** | **23** | **8** | **4** |

No **error-level** issues remain. Remaining items are cosmetic/UX or need a manual device pass (offline/exports/PDF).

## Full status table

| Bug | Title | Status | Note (2026-06-14) |
|-----|-------|--------|-------------------|
| 001 | Benchmark `toFixed` crash | ✅ Resolved | Fixed earlier; kpiEngine consumers use `cpk.fleetAvgCpk` |
| 002 | Audit Trail empty | ✅ Resolved | Reads `audit_log_v2` |
| 003 | QR Labels empty | ✅ Resolved | `serial_no ?? asset_no ?? id` fallback |
| 004 | Health Matrix blank | ✅ Resolved | `active !== false` |
| 005 | FuelEfficiency currency "R" | ✅ Resolved | uses `activeCurrency` |
| 006 | Procurement currency "R" | ✅ Resolved | uses `activeCurrency` |
| 007 | Work Orders table missing | ✅ Resolved | `work_orders` table live (5 RLS policies, verified in DB) |
| 008 | Accidents table not provisioned | ✅ Resolved | `accidents` + claims module live (V19/V20/V21) |
| 009 | Inspections bulk actions | ⚠️ Re-verify | Inspections rewritten since; test on device |
| 010 | Inspections CSV empty | ⚠️ Re-verify | export utils reworked; confirm with data loaded |
| 011 | Tyre Records edit blank | ✅ Resolved | `openEdit()` populates form (TyreRecords.jsx:136) |
| 012 | Dashboard CPK NaN | ✅ Resolved | kpiEngine returns guarded scalars |
| 013 | Reports PDF silent fail | ⚠️ Re-verify | `autoTable` registered; live-SVG capture added (Inspections) |
| 014 | Tyre-changes date filter | ⚠️ Re-verify | confirm gte/lte applied |
| 015 | Driver Behavior no data | ✅ Resolved | groups by `driver_name` with `'Unassigned'` fallback (DriverManagement.jsx:110) - null-safe |
| 016 | Predictive spinner stuck | ✅ Resolved | `catch { setLoading(false) }` present |
| 017 | Inventory double-count | ◑ Re-verify | confirm distinct/status filter on stock |
| 018 | Cost-analysis ÷0 | ✅ Resolved | `_isValidRecord` guarantees `remKm > fitKm` |
| 019 | Workshop save duplicates | ◑ Re-verify | confirm single submit path |
| 020 | Country change no refresh | ◑ Partial | `applyCountry()` helper + Dashboard focus-refresh; most pages have `activeCountry` in deps |
| 021 | Active filter null | ✅ Resolved | `active !== false` |
| 022 | Medium risk badge color | ✅ Resolved | all Medium badges now pass contrast (amber-100/700, amber-400-on-dark, white-on-yellow-700) |
| 023 | Upload progress bar | ✅ Resolved | `setProgress` updates per batch |
| 024 | Notifications stale count | ✅ Resolved | realtime channel + focus refresh (useRealtimeAlerts) |
| 025 | Map pins overlap | ◑ N/A | no live map feature / needs lat-lng seeding |
| 026 | QR print layout | ◑ Cosmetic | add `@media print` grid rules |
| 027 | Compliance ÷0 | ✅ Resolved | `length > 0 ? … : 0` guards |
| 028 | Radar all-zeros first load | ◑ Cosmetic | add loading skeleton |
| 029 | Date locale inconsistency | ◑ Cosmetic | standardise on shared `formatDate()` |
| 030 | Generic empty states | ◑ Cosmetic | per-page messages |
| 031 | Sidebar active route | ✅ Resolved | `NavLink` `isActive` (prefix match) |
| 032 | Mobile table overflow | ⚠️ Re-verify | audit `overflow-x-auto` on remaining tables |
| 033 | Favicon / title | ✅ Resolved | `index.html` has TyrePulse title + favicon set |
| 034 | Upload column mapper corrupted data | ✅ Resolved | Optional "SR No." field was stealing the Date/Serial columns, so issue dates landed on junk values like `0770-01-01`. Mapper now assigns the strongest match first and rejects impossible dates (UploadData.jsx). 8 regression tests added. |
| 035 | Country resets to "All" on upload page reload | ◑ Partial | Admin's country choice is not persisted, so the Upload button starts disabled after any hard reload until they re-pick a country. Persist the selection (localStorage or profile). |

## Remaining work (prioritised)

**Functional - verify on a real device/login (can't be done headless):**
- 009 bulk actions, 010 CSV export, 013 PDF generation, 014 date filter, 017 inventory counts, 019 workshop submit, 032 mobile tables.

**Code - small, safe follow-ups:**
- 020 Country refresh: extend the `applyCountry()` + focus-refresh pattern to any remaining list pages.
- 035 Persist the country selection so the upload page keeps it across reloads.
- Decide whether admin uploads should also route through the approval queue (today only non-admin uploads are staged for approval; admin uploads write live immediately).

**Cosmetic / design:**
- 026 print CSS, 028 radar skeleton, 029 date locale, 030 empty states.

## Architecture / design debt (still valid)
1. `kpiEngine.js` returns objects not scalars - consumers must destructure (guards now in place).
2. Consolidate `audit_log` → `audit_log_v2` (canonical).
3. Centralise currency in one `useCurrency()` hook (most pages already use `activeCurrency`).
4. `fleet_master.active` nullable - consider `SET DEFAULT true`.
5. Add React Error Boundaries per page (a single crash shouldn't white-screen the app).
6. **Theme**: still a mixed dark/light identity (Work Orders + Engineering KPI use dark cards; analytics pages light). Pick one (light-content SaaS recommended) and align.

## Security posture (2026-06-14)
Tracked in migrations V19-V24. Supabase advisor: **0 errors**; anon can read 0 sensitive rows; functions hardened (pinned search_path, anon EXECUTE revoked). Only outstanding toggle is **Leaked Password Protection** - Supabase **Pro-plan only**, so accepted as plan-limited on Free.
