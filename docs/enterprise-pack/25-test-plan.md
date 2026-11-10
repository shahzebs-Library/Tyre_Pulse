# 25. Test Plan

| Field | Value |
|---|---|
| Deliverable | 25 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Strong unit and guard-test coverage on the web app (1,193 files in `src/test`), PGlite database tests (42 files) in CI, Flutter analyze/format/test/goldens/builds in CI, mobile jest, marketing, report engine and analytics service tests. Weak or missing: real-database RLS tests in CI, automated end-to-end tests in CI, approval-routing scenarios per country/site, Arabic UI rendering checks, performance budgets, edge-function tests, migration-apply tests and report-vs-screen reconciliation. |
| Evidence | Verified in repo: `.github/workflows/ci.yml`, `flutter-ci.yml`, `package.json` scripts, `src/test/`, `supabase/tests/`, `tests/*.sql`, `mobile/__tests__/`, `tyre_pulse_flutter/test/` (355 `*_test.dart`), `services/analytics/tests`, `services/report-engine`, `scripts/e2e-production.mjs`. CodeQL js+py status from PROJECT_MEMORY (GitHub default setup; no workflow file in the repo). Test totals (e.g. 8,721 web tests on 2026-08-24) are from project memory; this document did not run any suite. |
| Related docs | [23 Migration plan](23-migration-plan.md), [24 Rollback plan](24-rollback-plan.md), [17 Security audit](17-security-audit.md), `docs/TEST_AND_RELEASE_PLAN.md`, `docs/AUTHENTICATED_E2E.md`, `docs/IMPORT_CENTER_TEST_CASES.md` |

## 1. Current test assets

| Suite | Location | Runner | In CI | Notes |
|---|---|---|---|---|
| Web unit / engine / render | `src/test/` (1,193 files, 87 render tests) | Vitest via `scripts/run-vitest.mjs` | Yes (`npm run test:run`) | Pure engines + API services with mocked Supabase |
| Web lint | `eslint.config.js` (no-undef, react/jsx-no-undef, rules-of-hooks) | ESLint | Yes | Added after a ReferenceError shipped past build and tests |
| Web build | `vite build` | Vite | Yes | |
| Database (PGlite) | `supabase/tests/*.test.mjs` (42) | `node --test` (`npm run test:database`) | Yes | Real SQL in an embedded Postgres: workforce, workshop status, approvals, washing, stock quick entry, tenant config, driver access, imports |
| Database (SQL scripts) | `tests/rls_org_isolation.sql`, `rpc_*.sql` (7 files) | manual psql | No | |
| Expo app | `mobile/__tests__/` (50) + `tsc` | Jest + TypeScript | Yes | Includes release config (R8) pins |
| Flutter app | `tyre_pulse_flutter/test/` (355) | `flutter analyze --fatal-infos`, `dart format` check, `flutter test --coverage`, goldens, generated-source staleness | Yes (`flutter-ci.yml`), plus Android and iOS build jobs | Goldens are Windows-generated; Linux runs show small diffs |
| Marketing | `marketing/` | lint, tests, Next build | Yes | Contact API guards mutation-tested |
| Report engine | `services/report-engine` | npm test | Yes | |
| Analytics service | `services/analytics/tests` | pytest | Yes | |
| Production E2E | `scripts/e2e-production.mjs` (Playwright) | `npm run test:e2e[:required]` | No | Needs a dedicated approved test user + asset |
| Static security | CodeQL js-ts + python | GitHub default setup | Yes (per memory) | |
| AI accuracy | `src/lib/aiTyreAccuracy.js`, `npm run ai:adjudicate` | Node | No | Synthetic fixtures |

### Guard tests worth knowing (they scan source, not behaviour)

| Guard | Protects |
|---|---|
| `rowCapGuard.test.js` | No unbounded read on a table over the 1,000-row cap (web + mobile, limit argument resolved) |
| `navRouteAccessParity.test.js`, `navTreeParity.test.js` | Every visible nav item has a matching route guard, both directions |
| `consoleModuleCoverage.test.js`, `consolePagesSmoke.render.test.jsx` | Every routed page is in the console catalog; every console page mounts on empty and error data |
| `commandSearchCoverage.test.js` | Search palette lists every sidebar item; search visibility equals nav visibility |
| `webI18nKeyCoverage.test.js`, `shellI18nKeys.test.js`, `checklistI18n.test.js`, `workforceLocaleParity.test.js` | Every literal `t('ns.key')` resolves in en and ar |
| `honestReadGuards.test.js` | A failed read never renders as an empty list or zero |
| `consoleSurfaceGuard.test.js` | No console entry in the main app; console session isolation |
| `kpiFilterAwareness.test.js` | KPI tiles follow the page filters (mutation-tested) |
| `pdfEngine.test.js` | Uses the REAL jsPDF + autotable (a mocked library hid a peer-range break that broke 30 PDF exports) |
| `chartCapture.test.js` | Printed point size of chart text |
| `domainEventDatabaseGuard.test.js` | Domain event shape |
| Mirror tests | JS engine vs SQL twin (e.g. `tyreKm` vs `tyre_km_life`, `workOrderStatus` vs `wo_status_canonical`, approval matrix, tyre brand canonical) |

## 2. Spec test types: coverage matrix

| Spec requirement | Covered by | Gap | Proposed test | Phase | Effort |
|---|---|---|---|---|---|
| Unit | Vitest engines, Flutter, pytest | Edge functions have none | `deno test` for `_shared/auth.ts`, budget, cost, escaping; `deno check` all functions | 1 | S |
| Integration | API service tests with mocked client; PGlite DB tests | No test hits PostgREST + real RLS together | Supabase branch or local stack in CI running a smoke set of RPCs as 3 seeded users | 3 | L |
| RLS | PGlite tests cover selected modules; isolation proven by impersonation in rolled-back transactions on live (V545-V578) | No CI suite that impersonates each role on each country/site table | Catalog-driven test: for every table with org/country/site policy, seed 2 orgs x 2 countries x 2 sites and assert read/write matrix | 1 | M |
| Permission (RBAC) | `accessResolver`, `permissionsEngine`, `mobilePermissions`, nav parity, capability tests | Flutter module registry vs DB matrix only partly tested; custom roles | Table-driven test over `module_permissions` x roles x surfaces (web/Expo/Flutter) | 2 | M |
| Approval routing | `approvalMatrix`, `checklistApproval`, `inspectionApproval`, workforce PGlite tests | Per-country/site route resolution end to end; delegation + escalation timing | `resolve_approvers` scenarios per country/site/role in PGlite; escalate-workflows clock test | 3 | M |
| Arabic / English | i18n key coverage guards (web), ARB parity (Flutter), locale parity | RTL rendering, mirrored icons, number/date/currency formatting are not asserted; `mobile/RTL_QA_CHECKLIST.md` has never been executed (memory) | Playwright screenshot set in `ar` at 390 and 1440 px for 20 key screens; Flutter golden in `ar` for key screens | 4 | M |
| Mobile / PWA / Web | Flutter widget + golden tests; Expo jest; web render tests | No device tests; PWA update prompt and offline queue untested end to end | Flutter integration_test on emulator for capture to offline to sync; Playwright PWA update-prompt test | 4 | L |
| Performance | Measurements done by hand (EXPLAIN, pg_stat_statements) | No budgets in CI | Bundle-size budget on eager graph; `EXPLAIN` buffer budget on top 10 RPCs against a seeded DB; Lighthouse CI on login and dashboard | 4 | M |
| Security | CodeQL, `owasp`/supabase reviews, security posture scan weekly | No CI check for anon-executable DEFINER fns, unpinned search_path, ERRCODE 40001, RLS-off tables | Catalog guard SQL run in the DB test job; fails on any new finding | 1 | S |
| Migration | Rolled-back verification on live by hand | No apply-from-scratch test; repo and live history diverge | Apply all `supabase/migrations` in order to PGlite in CI; reconciliation report vs live by name | 1 | M |
| Report comparison (reports match on-screen data) | Shared engines feed screen + PDF + PPTX (accident report, board overview); `pdfEngine`, `accidentReportPptx` tests | No automated check that a report total equals the screen total for the same filters | For each report pair, call the same engine twice (screen path, export path) with fixed data and assert equal totals; snapshot PDF text | 4 | M |
| PDF / PPTX validation | Real-library PDF test, PPTX renderer tests | Arabic text in PDFs; large data pagination | PDF text extraction tests (pdfjs) for en/ar on 3 reports | 4 | S |
| Data migration verified | Snapshot + per-country totals unchanged checks in migration headers | Not automated | Store the "before" totals and assert "after" in the migration itself (pattern already used, make it mandatory) | 1 | S |
| Existing workflows preserved | Large regression suite | No E2E in CI | Run `test:e2e:required` nightly against production with a dedicated read-mostly test user | 2 | S |
| Monitoring active | none | Alerts are not tested | Synthetic critical `system_logs` row weekly and assert a notification is created | 5 | S |
| Rollback available | `admin_run_restore_test` exists | Not scheduled | Monthly restore drill + PITR rehearsal (see [24](24-rollback-plan.md)) | 1 | M |

## 3. Known test-environment hazards

| Hazard | Mitigation already in place |
|---|---|
| Node 20+ shadows jsdom `localStorage` | Shim in `src/test/setup.js` only when missing |
| CRLF checkout breaks source-scanning tests on Windows | `.gitattributes eol=lf` + CRLF-normalising reads |
| Full suite under load produces `waitFor` timeouts | Re-run the file alone before diagnosing |
| `src/test/reportCorrections.test.js` rewrites `audit/checklist-report-review/*.pdf` | Revert those files after a full run |
| Flutter goldens differ Linux vs Windows | Regenerate via `flutter-ci.yml` `update_goldens` input on Windows |
| Flutter sqlite3 build hook downloads can return a GitHub error page | Prefetch step with retries in `flutter-ci.yml` |
| A mocked library cannot see a peer-dependency break | Keep at least one real-library test per export format |

## 4. Release test gates (proposed, maps to spec "Completion requires")

| Gate | Evidence required |
|---|---|
| Data migration verified | Before/after totals in the migration header, snapshot table named |
| Existing workflows preserved | CI green + nightly E2E green |
| Permission tests passed | RBAC matrix test green |
| RLS tests passed | Catalog-driven RLS suite green |
| Approval routing verified | Approval scenario suite green |
| Reports match on-screen data | Report parity tests green |
| PDF and PPTX validated | Real-library export tests green (en + ar) |
| Duplicate modules retired | Nav/route parity + redirect tests |
| Admin Console connected | Console smoke render test |
| All roles tested | RBAC matrix includes every role in `custom_roles` + built-ins |
| Arabic and English tested | i18n guards + ar screenshot set |
| Mobile, PWA, Web tested | Flutter CI + device smoke (manual until integration_test exists) |
| Monitoring active | Synthetic alert test |
| Rollback available | Previous deployment id + rollback SQL recorded |

## Open decisions for the owner

- Provide a dedicated approved test user per role (and a test asset) so authenticated E2E can run nightly against production, or fund a staging project instead.
- Approve CI minutes for a Supabase local stack job.

## Next actions

1. Phase 1 (S): catalog guard SQL (anon DEFINER allowlist, search_path, ERRCODE 40001, RLS-off) added to the PGlite/DB test job. It would have caught the live `save_stock_entry` 40001 regression.
2. Phase 1 (S): `deno check` + small `deno test` set for edge functions.
3. Phase 1 (M): catalog-driven RLS matrix suite in PGlite.
4. Phase 1 (M): apply-all-migrations test in CI.
5. Phase 4 (M): report-vs-screen parity tests and Arabic screenshot set.
