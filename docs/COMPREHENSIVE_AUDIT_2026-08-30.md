# TyrePulse Comprehensive Web, Module, Data and AI Audit

Date: 2026-08-30

## Verdict

TyrePulse is broad and technically substantial, but it is not product-complete. The main risk is not a lack of modules; it is that 249 page files and 312 routes have grown faster than shared interaction standards, server-side paging, end-to-end verification, and a single canonical AI/data architecture.

The strongest parts are authentication hardening, organisation-scoped Supabase patterns, security headers, explicit service modules, build-time route splitting, workflow/approval foundations, and honest empty/not-configured states in several newer modules.

The highest-priority work is to consolidate the two AI paths, introduce a reusable server-paged enterprise table/filter framework, make date/site/country scope consistent, reduce navigation and module duplication, verify every write path against RLS/RPC rules, and add authenticated end-to-end coverage for the critical operational journeys.

## Remediation status (updated 2026-08-30)

| Status | Item | Result / remaining work |
|---|---|---|
| Fixed and locally verified | Canonical AI runtime | AI Command Center now uses the authenticated server orchestrator, durable conversations and soft archive; browser-side bulk fleet loading was removed; 10 focused tests and targeted lint pass. |
| Fixed and statically verified | AI control failures | Budget, rate-limit and configuration query failures now fail closed in both AI Edge Functions. Live deployment verification is still required. |
| Fixed and statically verified | Edge authorization and CORS | Approval requires explicit `true`; permissive wildcard preview/localhost origin trust was removed. Deployment environment must provide the exact allowed origins. |
| Fixed | Test harness defects | Added a Node 26-safe Vitest launcher plus deterministic storage, Canvas and ResizeObserver shims; targeted reporting tests pass 32/32. |
| Fixed | React warnings | Repository-wide ESLint now passes with `--max-warnings 0` (down from 126 warnings). Hook dependencies were corrected across operational, admin, analytics, tyre/cost, accident, inspection, workshop, checklist and approval surfaces without hook suppressions. |
| Fixed and Playwright-verified | Public login accuracy/accessibility | Unsupported public statistics were replaced with capability statements; login fields and password visibility control now have accessible names; desktop/mobile have no console errors or horizontal overflow. |
| Foundation added | Shared filtering | `FilterBar` now supports accessible search/selects, result count and clear-all; Data Intake History now has search plus module/status filters. Rollout to the remaining applicable list pages is pending. |
| Foundation corrected | Shared calendar | `DateField` positioning dependencies were corrected and focused calendar tests pass. Migration of the remaining native date inputs is pending. |
| Inventory ready; live check pending | Supabase security | Added `scripts/security/supabase-security-inventory.sql`. It must be run against each deployed environment; no live database was changed during this pass. |
| Pending | Authenticated end-to-end coverage | Requires a dedicated approved test account and seeded tenant/site data. Public Playwright checks pass, but protected operational journeys are not certified. |
| Vendor-neutral foundation complete; provisioning pending | ERP connector | Added credential references, endpoint validation, idempotency, retry/dead-letter/freshness/reconciliation helpers and a durable tenant-scoped schema. Actual adapter, credentials, mappings, schedules and ownership remain vendor-dependent. |
| Pending | Universal paging/filter/date rollout | The audit candidate inventory is available, but 249 pages cannot honestly be certified from foundation changes alone. Each large list must be classified and remediated. |
| Fixed | Bundle reduction | Modular lazy ECharts runtime reduced the chunk from roughly 1.13 MB to 800.86 kB (268 kB gzip), below the 900 kB warning threshold; production build passes. |
| Locally green; authenticated gate pending | Release tests | Full Vitest release suite passes: 589 files and 9,010/9,010 tests. The run exposed and verified fixes for an inspection export guard and pre-register working-context preservation. The fail-closed authenticated Playwright gate still needs dedicated CI credentials and seeded tenant data. |
| Improved | AI governance | Added deny-by-default tool policy, approval requirement for future consequential tools, provenance/citation contract, request cost telemetry and policy tests. Live provider evaluation and document-level source links remain pending. |
| Improved | Shared list UX | Four shared Cost/M3 ledgers now provide search, contextual status filters, accurate counts, clear-all, pagination and keyboard-operable rows. The wider page inventory still needs classified rollout. |

## Evidence and limits

- Production build: passed on 2026-08-30.
- ESLint: passed with 0 errors and 126 warnings, primarily unstable or incomplete React Hook dependencies.
- Full Vitest run: did not reach a clean terminal result in the audit window and was stopped after sustained `localStorage` environment warnings and repeated unimplemented Canvas `getContext` errors. The suite/harness itself needs stabilisation before it can be a trustworthy release gate.
- Static inventory: 249 page files, 312 route elements, 294 lazy imports, 194 table-bearing pages.
- Fresh Playwright evidence: desktop and mobile login screens captured in `audit/web-2026-08-30/`.
- Authenticated browser flows could not be entered because no audit user credentials are stored locally. No finding below pretends an authenticated action was visually verified.
- Database conclusions are code/migration conclusions, not a live production-data certification. A production RLS/advisor audit remains required.

## Module health matrix

| Area | Health | What exists | What is missing or risky |
|---|---|---|---|
| Authentication and account lifecycle | Amber | Login, signup, SSO surface, lock/approval checks, console auth, reset and deletion flows | Authenticated E2E suite; deterministic loading/redirect behavior; session revocation verification; accessibility test of all auth states |
| Fleet and asset master | Amber | Fleet master, asset detail/360/history, groups, hierarchy, combinations and check-in/out | Canonical asset identity and cross-module timeline; consistent site/country inheritance; duplicate/conflict UI; fewer overlapping detail pages |
| Tyre lifecycle | Amber/Green | Records, fitment, exchange, scrap, pool, passport, specifications, inspections and running-life logic | One canonical lifecycle state machine; transaction boundary for multi-step changes; consistent history links; server paging across every large list |
| Workshop and maintenance | Amber | Work orders, job cards, live workshop, PM, bays, repair requests, parts, downtime and QA workflows | Evidence-gated closure everywhere; resource calendar; technician/shift capacity; dependency-aware scheduling; stronger linkage among job, parts, tyre and cost events |
| Safety, accidents and compliance | Amber | Accident case engine, claims, approvals, inspections, corrective actions, policy and compliance surfaces | Unified case timeline; SLA/escalation engine; consistent evidence requirements; portal-access lifecycle; verified PII minimisation and retention |
| Procurement, stock and suppliers | Amber | Stock, replenishment, requisitions, goods receipt, material issue, vendors, marketplace and contracts | Three-way match; approval limits; landed cost; lead-time/reorder simulation; immutable movement ledger validation; stronger supplier-to-performance traceability |
| Operations and telematics | Amber | Trips, GPS, route planning, dispatch, HOS, cold chain, fuel, tolls, video, charging and reservations | Real connector health and freshness indicators; map/event correlation; alert deduplication; replay consistency; explicit offline and late-data behavior |
| Cost, budget and finance | Amber | Cost center, Cost/M3 ledgers, budgets, TCO/ROI, expenses and scenarios | Canonical currency/rate source; close/lock periods; reconciliation status; drill-through lineage from KPI to transaction; consistent regional/site dimensions |
| Reporting and analytics | Amber | Reports, scheduled reports, executive views, builders, exports and sharing | Metric catalogue enforcement; one global period/scope model; saved views across all major pages; report lineage/freshness; export parity tests |
| Imports and data quality | Amber | Intake center, history, mapping, reconciliation, cleaning, classification and duplicate controls | End-to-end batch state machine; rollback and idempotency proof; row-level remediation ownership; consistent filter/search on intake history and reconciliation |
| Workflow and approvals | Amber | Definitions, builder, steps, notifications, delegations and multiple decision panels | One workflow engine contract used by every module; versioned definitions; timeout/escalation; substitution/delegation audit; simulation before publishing |
| Administration and platform | Amber | Users, roles, permissions, module control, system health, audit, backups and data browser | Reduce parallel admin consoles; capability matrix tests; restore drills; operational SLOs; immutable canonical audit event across all writes |
| AI and automation | Red/Amber | Client agents, router, synthesis, server tool-calling orchestrator, RAG, budgets, models, prompts, feedback and usage logs | One canonical runtime; durable chat UI integration; tool schemas and authorization policy; evaluation suite; provenance/citations; prompt/version rollback; human approval for consequential actions |
| ERP and external integrations | Red/Amber | ERP configuration surface, webhooks, public API and an honest manual intake fallback | No complete provisioned ERP connector; credential-vault lifecycle; connector scheduler; retry/DLQ; reconciliation dashboard; freshness and ownership indicators |
| Mobile/offline | Amber | Separate mobile implementations and offline queues | Atomic commands, conflict resolution, queue observability, parity matrix with web, secure media retry and authenticated E2E sync testing |

## Critical and high findings

### P0/P1 — architecture and correctness

1. **The visible AI Command Center does not use the durable server orchestrator.** `AiCommandCenter.jsx` calls the client-side `runOrchestration`, while `aiOrchestratorClient.js` and the `ai-orchestrator` Edge Function are only used by tests. Users therefore do not receive the durable conversation memory, server tool loop, server-enforced role boundary, or tool audit trail described by the server implementation.

2. **Two AI orchestration systems can diverge.** Routing, model identifiers, prompts, agent definitions, cost tables and failure behavior exist in several client and server files. This will produce inconsistent answers, budgets and permissions over time.

3. **The AI Command Center downloads operational datasets into the browser before answering.** It loads tyre, inspection, corrective-action, accident and asset rows, then runs agents locally. This creates scale, freshness and least-data problems. Queries should be server-side, scoped and aggregated; raw records should be fetched only for explicit drill-down.

4. **AI budget and rate-limit checks fail open.** The server logs configuration, budget and rate-limit read failures and continues. For a consequential enterprise AI feature, budget and authorization-adjacent controls should fail closed or enter a clearly labelled degraded mode.

5. **The product has route and module sprawl.** 312 route elements and 294 lazy imports make discoverability, permission consistency and regression testing difficult. Similar surfaces—asset detail/360/history, reporting variants, admin/console pages, AI pages, workshop pages—need canonical ownership and redirects.

6. **Paging is not a shared guarantee.** Static inspection found 194 table-bearing pages and 153 without an obvious local paging/range contract. This is a candidate list, not proof that every one is broken, because some child services may page. Each page must be classified as server-paged, intentionally bounded, virtualised, or unsafe.

7. **Filter coverage is uneven.** Data Intake History, Data Reconciliation, Expense Import and Maintenance Cost Board contain tables without an obvious search/multi-filter layer. Enterprise list pages should consistently support search, country/site, status, ownership, date range, saved view, clear-all and filter chips when those dimensions apply.

8. **Date input is fragmented.** Ninety-nine page files contain native date inputs while only 23 page files reference the shared `DateField`. This causes inconsistent formatting, min/max rules, timezone handling, RTL behavior and calendar UX.

9. **React Hook warnings are operational risks, not cosmetic lint.** The 126 warnings include missing dependencies in search, camera/RFID, realtime, stock, settings, accident, console and other data-loading flows. These can cause stale state, duplicate requests or skipped refreshes.

10. **Large bundles remain.** The build warns about chunks over 900 kB; ECharts is about 1.13 MB minified before gzip, and several PDF/export libraries are large. Heavy visualisation and document-generation packages should be loaded only when their feature opens.

11. **The full test command is not currently a dependable release gate.** It emits large volumes of Node localStorage warnings, React `act(...)` warnings, duplicate-key warnings and jsdom Canvas failures. Split pure/unit, DOM, browser/chart and export suites; provide deterministic Canvas/localStorage setup; enforce time budgets; and make the machine-readable report complete reliably.

### P1 — data, tenancy and security

12. **Direct Supabase access remains in page components.** Fourteen pages contain direct Supabase calls. Move these behind typed domain services/query keys so country, site, organisation, error mapping, cancellation and paging cannot be applied differently by each screen.

13. **Live RLS coverage is not certified by repository migrations alone.** The migration history contains extensive hardening, but hundreds of incremental migrations make drift possible. Run live advisors, enumerate exposed tables/views/functions, confirm RLS and grants, and test user/org/country/site boundary cases.

14. **`SECURITY DEFINER` surface requires a generated inventory.** The project uses many deliberately self-gating privileged RPCs. Produce a CI artifact listing owner, schema, grants, search path, auth checks and tenant predicates for every definer function; fail CI when a public function is executable by unintended roles.

15. **Canonical audit history is still fragmented.** Existing project documentation identifies multiple audit tables and optional client-originated audit events. All consequential writes should emit one immutable server-generated event envelope with actor, organisation, country/site, resource, before/after reference, request/correlation ID and source.

16. **Server-side validation is not uniformly proven.** Client forms are extensive, but every import, offline replay and direct API write needs DB constraints or a validated RPC. UI validation must not be the business-rule boundary.

17. **Security headers are comparatively strong.** CSP, HSTS, frame denial, MIME sniff protection, referrer and permissions policies exist. Keep CSP regression tests and remove obsolete `X-XSS-Protection` when browser support policy permits; it is not a substitute for output encoding.

18. **AI output HTML is currently escaped before formatting.** The `dangerouslySetInnerHTML` uses flagged by search are not confirmed XSS defects because both inspected renderers escape HTML first. Preserve this invariant with malicious-output tests or replace it with a non-HTML markdown renderer.

## UX and frontend findings

1. **Login desktop:** visually clear, strong hierarchy and obvious primary action. The two-tab form, password recovery and SSO are discoverable.
2. **Login mobile:** usable at 390 px, but the identifier placeholder truncates. Use a shorter example and retain the full requirement in helper text.
3. **Login trust claims:** “10K+”, “99.9%” and “3s” appear as factual operational claims. Connect them to real telemetry or replace them with qualitative product benefits.
4. **Login accessibility:** the visible uppercase labels are helpful, but automated semantic/keyboard/name/contrast testing still needs to run. Do not infer WCAG compliance from screenshots.
5. **Navigation:** module count exceeds what a static sidebar can comfortably expose. Use role-based workspaces, favourites, recent items, command search and task-based landing pages; hide disabled/licence-only modules rather than presenting dead ends.
6. **Tables:** establish one `EnterpriseDataGrid` contract with server paging, sorting, column visibility, sticky headers, density, selection, bulk actions, export of filtered rows, saved views, URL state and mobile card fallback.
7. **Filters:** establish a `FilterBar` schema. Applicable pages should use dependent dropdowns (country → region → site → asset), searchable multi-select, active chips, result count, clear-all, URL persistence and saved views.
8. **Calendars:** use date range for reports/history, month picker for accounting/production periods, date-time with timezone for events, and resource calendar for bays/shifts/reservations/maintenance. Native free-form text should not represent a date.
9. **Dropdowns:** replace text entry with reference-data selectors for site, region, asset, tyre position, supplier, currency, reason, status and role when a governed master exists. Allow “create new” only when authorized.
10. **Empty states:** distinguish no records, no results for current filters, permission-restricted data, not configured, stale connector and failed load. Each needs a specific next action.
11. **Thin pages:** short wrapper pages such as Cost/M3 ledgers are not automatically thin because shared components provide the experience. `ErpSync` is genuinely capability-thin because it openly lacks a connector. `RoiCalculator` and similar calculators need evidence of persistence, scenario comparison and drill-through before being treated as operational modules.

## Missing shared product capabilities

- Global working context with organisation, country, region, site, period and asset propagated consistently to URL, queries, reports and AI.
- Saved filters/views and shareable URLs across all major list/report pages.
- Universal entity timeline connecting asset, tyre, inspection, work order, accident, cost, document and approval events.
- Cross-module task inbox with ownership, due date, SLA, escalation and bulk decisions.
- Data freshness and source lineage badge on every KPI/report.
- Notification center with preference, acknowledgement, deduplication and deep links.
- Global attachment/document service with type validation, retention, virus scanning and access expiry.
- Feature/module lifecycle states: hidden, preview, configured, degraded, active and retired.
- Consistent import preview, validation, commit, rollback and reconciliation pattern for every domain.
- Audit-friendly “why did this change?” and “why is this KPI this value?” drill-through.
- Searchable reference-data management for reasons, statuses, locations, asset types, tyre sizes and suppliers.
- Accessibility CI: axe, keyboard journeys, focus order, reduced motion, 200% zoom and RTL visual snapshots.
- Production SLO dashboard: API latency/error, queue lag, connector freshness, failed jobs, notification delivery and AI tool failure rate.

## AI target architecture

Use one server-owned orchestrator:

1. UI sends conversation, scoped working context and user intent.
2. Server authenticates user and resolves organisation/country/site permissions.
3. Policy layer chooses allowed agents and read-only tools.
4. Planner creates a bounded plan; tool calls return typed results with source IDs and freshness.
5. Validator checks tenant scope, numerical consistency, missing data and unsafe recommendations.
6. Synthesiser produces the response with citations to internal records/metrics.
7. Human confirmation is required before creating work orders, approving requests, changing budgets or sending messages.
8. Store prompt version, model, tool inputs/outputs hashes, costs, latency, feedback and evaluation result.

Required AI evaluation packs: tenant isolation, prompt injection from uploaded documents, hallucinated numbers, stale data, empty data, conflicting specialists, tool timeout, budget exhaustion, Arabic prompts, numerical reconciliation and consequential-action approval.

## Delivery plan

### Phase 0 — truth and containment (1–2 weeks)

- Freeze new top-level modules.
- Create an owner/status/data-source/route/permission matrix for all 312 routes.
- Connect the UI to the server AI orchestrator or hide the unused server claims.
- Resolve the 126 lint warnings in data/auth/search/realtime paths first.
- Run live Supabase advisors and generate RLS/definer/grant inventories.
- Add authenticated Playwright accounts for admin, manager, inspector, tyre technician and read-only reporter.

### Phase 1 — shared UX/data foundations (2–5 weeks)

- Ship `EnterpriseDataGrid`, `FilterBar`, `DateField/DateRange`, reference selectors and unified async states.
- Convert the four confirmed table pages lacking obvious filters.
- Classify and remediate the 153 paging candidates.
- Introduce canonical working-context and URL state.
- Consolidate navigation and overlapping routes.

### Phase 2 — workflow and integration completion (4–8 weeks)

- Standardise evidence-gated workflow transitions and audit events.
- Finish ERP connector lifecycle, scheduler, retry/DLQ, reconciliation and freshness UI.
- Add universal entity timeline and cross-module task inbox.
- Complete offline conflict and atomic replay behavior.

### Phase 3 — intelligence and scale (6–12 weeks)

- Move all AI data access behind authorised typed tools.
- Add AI evaluations, provenance, prompt/model versioning and human approvals.
- Add metric catalogue enforcement, report lineage and data freshness.
- Lazy-load heavy chart/PDF/export stacks and establish performance budgets.

## Definition of complete

A module is complete only when its primary happy path and failure path are authenticated-browser tested; reads and writes are tenant/country/site scoped; lists are bounded and filterable; loading/error/empty/offline states are explicit; dates and reference fields use shared controls; actions create immutable audit events; permissions are server-enforced; exports match filtered UI data; mobile/RTL/keyboard behavior is verified; telemetry and ownership exist; and documentation reflects the deployed behavior.

By that definition, the platform is not yet complete.

## Remediation checkpoint — 2026-08-30

- Repository gates: ESLint passes with zero warnings; production/PWA build passes (4,343 modules); the full Vitest run completed 9,061/9,063 under heavy load, and both failures passed immediately in isolation (5/5). The full aggregate is therefore not recorded as fully green for this checkpoint.
- Filtering: the source inventory now reports zero table pages without a filter/search affordance. Data Reconciliation, Expense Import and Maintenance Cost Board gained URL-backed filters, honest counts/empty states and shared paging without narrowing import/export datasets.
- Paging: the deterministic 153-candidate ledger now records 2 server-paged, 122 shared/client-paged, 8 source-certified bounded and 21 unresolved operational/detail pages. Unsafe candidates fell from 68 to 21. The remaining entries must not be represented as production-safe.
- Module depth: the source-aware classifier has zero unresolved thin/state candidates. Alerts fail closed; Daily Ops and Cost/M3 disclose partial sources; CPK supports strict failures; Gate Pass has independent states, retry, shared dates and drill-down.
- Performance: the modular ECharts vendor chunk is 800.86 kB (268.00 kB gzip), below the 900 kB warning budget but still a material download.
- External certification remains blocking: deployed RLS/grants/definer functions and tenant isolation, authenticated seeded Playwright journeys, real ERP credentials/mappings/schedules/reconciliation, and deployed AI evaluation/cost/provenance policy evidence.

Production verdict: **not production-certified**. Source-level readiness improved materially, but the 21 paging entries and external certification gates above remain open.

## Final source-remediation ledger (supersedes the checkpoint above)

| Audited gap | Status | Current evidence / release condition |
| --- | --- | --- |
| Thin modules | Repository-complete | Source-aware classifier: 6 remediated, 7 composed/not-thin, 8 verified custom states, 8 not applicable, 0 unresolved. |
| Enterprise list UX | Repository-complete | Zero table pages without filter/search. Frozen 153-candidate ledger: 4 server-paged, 141 shared/client-paged, 8 source-certified bounded, 0 unsafe. RFID and Upload Approvals no longer silently truncate. |
| Authenticated E2E | Blocked externally | Public Playwright login smoke passes. Required-auth gate fails closed because dedicated credentials are absent; a seeded tenant and asset are also required. |
| Live Supabase security | Blocked externally | Read-only 15-query inventory is ready. The CLI reports `Access token not provided`; live advisors, RLS/grants/definer inventory and cross-tenant tests remain mandatory. |
| ERP connectors | Foundation complete; provisioning blocked | Credential references, endpoint validation, idempotency, retry/DLQ, freshness and reconciliation foundations exist. No approved vendor credentials, mappings or live schedules are available. |
| Failing/slow tests | Repository-complete | Full release run: 594 files and 9,082/9,082 tests passed. Asset Detail tab race was fixed; load-sensitive waits are bounded. ESLint passes with zero warnings. |
| Oversized bundles | Budget-complete | Production/PWA build passes (4,343 modules). Modular ECharts is 800.86 kB / 268.00 kB gzip, below the 900 kB warning budget. |
| AI governance/evaluation | Governance complete; deployed evaluation blocked | Server orchestrator, deny-by-default tool policy, consequential-action approval, provenance contract and cost telemetry exist. Provider keys and deployed evaluation evidence are absent. |
| Overlapping routes/modules | Repository-complete | Canonical ownership and query/hash-preserving legacy redirects are implemented and regression-tested; the duplicate Smart Analytics command was removed. |

Repository release gates: paging verifier passes all 153 candidates; module-depth verifier reports zero unresolved; focused remediation suite passes 86/86; full Vitest passes 9,082/9,082; ESLint has zero warnings; production/PWA build passes; public Playwright smoke passes.

Production verdict: **not production-certified**. All currently actionable source-level gaps in the nine-item audit are closed, but authenticated seeded E2E, live Supabase security/tenant isolation, a provisioned ERP adapter, and deployed AI evaluation require approved external credentials and environments.

### Password-recovery addition

Repository implementation is complete for verified email and mobile recovery: user enrollment in Settings, hashed/rate-limited one-use codes, enumeration-safe public requests, recovery-session generation, global session revocation after password change, migration, Edge Function, deployment runbook, and regression tests. Live status remains **blocked on provisioning** until the migration and `account-recovery` function are deployed and Resend/Twilio plus HMAC/app URL secrets are configured. See `docs/PASSWORD_RECOVERY.md`.
