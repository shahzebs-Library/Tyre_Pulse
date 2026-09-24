# Web, Flutter and marketing review — 24 September 2026

## Scope and confidence

This is a source-based review and phased improvement plan, with a first set of verified local fixes. It is **not a completed deep audit of every workflow or a production readiness certificate**. Inventory covers 256 web page components, 28 Flutter feature directories and 7 marketing pages. Detailed review concentrated on register completeness, unavailable states, route planning, Flutter calendar/PM/management/stock reads, marketing claims and contact delivery. Other modules remain scheduled for workflow review.

Captured from local commit `6b3597d3` on `feature/accident-case-web-redesign`, including the existing dirty worktree. The branch was preserved: switching a worktree with ongoing washing, inspection, routing and accident changes to main would mix or displace work. This is not a review of pristine main. Existing unrelated edits were not changed by this review. No deployment, live database mutation or real customer email was performed.

Use [the per-page checklist](platform-inventory.csv) to track every web page and [the source inventory](platform-inventory.json) for direct imports, Flutter source paths and marketing routes. Source signals are candidates, not defects: short wrappers can delegate complete workflows; a limit can be appropriate for a recent-activity feed. The inventory does not award maturity scores from file size or keyword counts.

## Confirmed findings and disposition

| ID | Priority | Evidence and consequence | Disposition / acceptance |
|---|---|---|---|
| W1 | P1 | `src/lib/api/routePlans.js` fetched only 500 rows; `src/pages/RouteOptimization.jsx` computed KPIs and exports from that subset despite client pagination. | Fixed locally: ordered range pagination, country filter on every page, ID tie-break, explicit failure at the safety ceiling. Regression reads 1,251 rows. |
| W2 | P1 | Route service converted missing-table failures into `[]`, preventing the page's unavailable state. Failed reads also displayed zero KPIs and a create-first prompt. | Fixed locally: preserve service errors; unavailable KPIs display N/A; export remains disabled. Missing table and denied-read API tests plus failure-state component tests pass. |
| W3 | P1 | Route screen allowed an earlier country request to overwrite a newer country's results. | Fixed locally: request generation guard and cleanup; clear rows/timestamp during reload. Component test resolves the old request last. This protects UI scope; it does not replace backend RLS. |
| W4 | P2 | Route page described saved fuel/tyre wear, while its form accepts manually entered baseline and planned distance; this screen does not execute a route solver or verify completed journey savings. | Corrected subtitle to identify entered plans and estimated savings. Advanced optimization needs waypoint, routing-provider and completed-trip evidence before stronger claims. |
| W5 | P1 | Reservation reads stopped at 500 rows and hid missing-table failures; counts and conflict indicators used that subset. | Fixed locally: complete ordered/scoped pagination with an explicit ceiling error, unavailable KPIs, stale-response protection and efficient per-asset overlap comparison. Tests cover a conflicting booking at row 1,002, denied/missing/later-page failures, nested/adjacent windows and country changes. This is conflict detection, not a transactional prevention guarantee. |
| W6 | P2 | Route savings can differ between derived summary values and stored `savings_km`; `updateRoutePlan` can update one distance without recalculating the stored value. Missing optimized distances also enter the average denominator. | Display/export fixed locally: derive from source distances consistently and exclude missing optimized distances from the average. Tests cover stale stored savings and an incomplete pair. Stored historical values are unchanged. Atomic backend derivation and a broader unknown-value display convention remain open. |
| F1 | P1 | `calendar/data/calendar_repository.dart` catches errors per source but only throws when all three sources fail. A partial result carries no source-failure metadata. Each source also stops at 200 rows. | Open: return source availability/completeness alongside schedule items; show partial-data warning and retry. Test one source failing and more than 200 scheduled items. |
| F2 | P1 | PM repository stopped at 300 active plans with no completeness marker. | Implemented locally, verification blocked: reuse existing range-pagination helper, preserve active/country filters, add ID tie-break and fail on incomplete reads. Added loopback repository tests for 1,001 plans and a later-page denial. Flutter SDK/analyzer/tests/Android/iOS gates remain required; not merge-ready. |
| F3 | P1 | `stock_count/data/stock_count_repository.dart` stops at 1,000 records; `management/data/management_repository.dart` caps team members at 1,000. | Open: determine full-register versus recent-list intent; prove every in-scope item can be reached. Preserve queued stock-count writes. |
| F4 | P2 | Accident workflow preview contains synthetic monetary defaults; current import search found production-library references in preview widgets and test references, with no production-screen importer of those widgets. | Maintenance candidate, not a proven live fabricated-data incident. Keep previews excluded from production registration; consider moving fixtures under tests after import/build verification. |
| M1 | P2 | Contact API classified malformed JSON as a server failure and rejected otherwise valid email addresses with outer whitespace. | Fixed locally: malformed JSON returns 400 before delivery; trim email before validation. Removed unreachable honeypot-success branch; existing honeypot rejection is retained. |
| M2 | P1 review | Public contact handler has a honeypot but no application-level rate limit. Deployment-level protection was not inspected. | Open verification: inspect deployed WAF/rate limits and provider quotas. Add a durable limiter only if required; test burst/retry behavior without sending customer emails. Do not claim an exploitable deployment from source absence alone. |
| M3 | P1 review | Product/security/pricing and JSON-LD describe broad controls and capabilities; source existence does not prove they are configured or included for every customer. | Open: tie each claim to backend enforcement, tenant configuration and commercial scope; use configuration-qualified wording where needed. No certification or universal security guarantee established here. |
| M4 | P2 | `/ar` renders Arabic body content but uses shared English Header/Footer. | Open: localize navigation, CTA and footer together, retain explicit language switching, verify keyboard and RTL layout. Root `lang=en` is overridden on the Arabic subtree; do not misreport the whole Arabic body as untagged. |

The refreshed inventory flags 93 web pages importing services with bounded-read signals and no detected range helper, and 85 importing services that suppress missing-relation errors. These sets overlap and are **not confirmed defect counts**. Inspect each caller and any RPC/forwarded helper before remediation. The corrected route and reservation modules are not evidence that all such modules are fixed.

## Implementation sequence

1. **P1 correctness and visibility.** Complete register/aggregate/export contracts first. Route fixes in this review establish the pattern; next inspect reservations, Flutter calendar, PM and stock. Distinguish empty, denied, offline cached, unavailable and partial results. Acceptance: a failing source never produces a healthy/zero conclusion; all intended records remain reachable.
2. **P1 workflow closure and authorization.** For each module, exercise create → validate → persist → reopen → permitted transition → audit/history → report. Verify denied roles, wrong tenant/site/country, concurrent decisions and duplicate submissions. Use existing backend objects and migrations. Do not enable operational policies or invent tenant setup data just to populate screens.
3. **P2 useful module depth.** Add only capabilities supported by the verified workflow: record drill-down, validation, source provenance, action ownership, status history, useful filters, full filtered export and retry. An attractive summary without its working next action is insufficient; a short component backed by a complete shared engine is sufficient.
4. **P2 field and cross-platform acceptance.** Verify offline queue durability, photo lifecycle, duplicate prevention, permissions changing mid-session, back navigation, Arabic/Urdu, RTL, dark mode and large data. Complete Flutter analyzer/tests/platform gates before merging meaningful Flutter changes.
5. **P2 marketing truth and conversion.** Reconcile capability copy, screenshots, store listing/build identity, plan inclusion, security configuration and login/PWA destinations. Verify public mobile/desktop and Arabic journeys from landing to contact outcome.
6. **Release.** Review the final diff against current main without losing ongoing work; add English web release notes when preparing a user-facing release. Run required gates, authenticated acceptance and deployment checks for the exact released commit. A local build is not a verified deployment.

## Web workspaces: improvement contracts

Every page has its own source/import entry and acceptance checks in the CSV. The following contracts determine module depth; they are planned acceptance work unless explicitly fixed above.

| Workspace/module family | Improvement and completion evidence |
|---|---|
| Home, dashboard, daily operations, alerts | Permission-scoped sources, qualified partial totals, current as-of time, actionable drill-down; no false all-clear on source failure. |
| Fleet, assets, ownership, groups, history | Stable identity and scope, complete register, real vehicle images, applicable km/hours, history and permitted lifecycle transitions. |
| Tyre records, lifecycle, exchange, retread, warranty, scrap | Position/serial integrity, fitment/removal sequence, stock effects, warranty evidence, auditable corrections and CPK denominator provenance. |
| Inspections, checklists, planner, RCA, corrective actions | Assignment → field capture → photos/signatures → review → corrective closure; recorded-date history, template version, immutable signed evidence. |
| Workshop, work orders, bays, PM, shifts | Vehicle-specific calendar plus applicable meter scheduling, job/parts/labour links, completion evidence, downtime provenance and role-safe decisions. |
| Washing and meters | Verify ongoing work separately: applicable readings, activity/evidence, corrections/review, queue compatibility and filtered exports. Preserve current uncommitted implementation. |
| Accidents, claims, insurance, portals | Evidence → responsibility → review → repair → release/recovery; monetary provenance, role transitions, expiry/revocation on public links. Preserve current redesign and actual artwork. |
| Inventory, materials, requisitions, procurement, suppliers | Count/issue/return/transfer consistency, approval authority, receipts and purchasing traceability; no stock mutation from an unapproved UI state. |
| Drivers, trips, dispatch, reservations, delivery | Assignment/availability/conflicts across the intended date range; actual delivery evidence and retry; no conflict assurance from a truncated register. |
| Telematics, TPMS, RFID, geofences, video, diagnostics | Distinguish manually entered registers from connected feeds; connection status, telemetry age, ingestion failures, provenance and permitted actions. |
| Finance, costs, budgets, production, forecasts | Currency/time/scope correctness, measured versus estimated values, complete denominators and reconciliation to line-item evidence. |
| Analytics, reports, scheduled delivery, sharing, TV | Same scope between cards/charts/export, complete history, source failures visible, scheduled delivery receipt, token/expiry behavior. |
| AI, automation and integrations | Configured provider, bounded permissions, input provenance, job lifecycle/cost, retry/idempotency and operator decision; no synthetic operational findings. |
| Users, permissions, approval matrix, tenancy, security | Server enforcement, privilege boundaries, grant expiry, delegation/collision tests, session changes and auditability. No inference of safety from hidden buttons. |
| Imports, cleaning, ERP, custom intake | Preview → mapping → row validation → idempotent import → reconciled result; explicit rejected rows and auditable corrections. |
| Public/auth/settings/system pages | Correct legal/support/login destinations, recovery/error flows, accessibility, configured options and meaningful status; static pages need no artificial dashboards. |

## Flutter: every feature's next acceptance task

These are pending acceptance/review tasks, not claims of defects in every feature. Source paths are under `tyre_pulse_flutter/lib/features/`; reuse the existing migration artifacts rather than treating their historical “not started” labels as current implementation status.

| Feature | Next acceptance task |
|---|---|
| accidents | Production versus preview separation; repair/claim/release transitions, evidence and currency provenance. |
| alerts | Bound completeness, source failure states and actual record/action destination. |
| approvals | Scope and delegation, pending-page completeness, concurrent decisions and explicit online requirement. |
| assets | Large scoped fleet, offline cache freshness, detail history and actual artwork. |
| auth | Session restore, MFA/biometric fallback, disabled user and lost permission behavior. |
| calendar | F1: partial-source metadata, pagination, date-window boundaries and source drill-down. |
| checklists | Template versions, drafts, photos/signatures, queued replay and recorded-date history. |
| driver_workspace | Real assigned asset/tasks, limited permissions, offline boundary and recovery. |
| home | Permitted destinations and country changes; inspect ongoing local edits separately. |
| inspections | Planned versus ad-hoc flow, required positions/readings, queued submission and assignment notifications. |
| management | F3 team completeness, analytics/report RPC contract, currency and unavailable states. |
| meter_logs | Applicable km/hours, lower-reading review, idempotent queue and audit trail. |
| notifications | Recipient scope, unread accuracy, deep-link authorization and deleted targets. |
| preventive_maintenance | F2 active-plan completeness; service history, meter/calendar due rules and explicit online behavior. |
| profile | Profile edits, language/theme persistence, reauthentication and logout cache handling. |
| rca | Evidence, ownership, status transitions, bounded history and corrective-action closure. |
| records | Full serial/tyre history, fitment context, null values and data provenance. |
| report_issue | Persisted issue, evidence upload/retry, ownership and follow-up destination. |
| scanning | Permissions, cancellation, unknown/ambiguous codes, offline lookup and real asset selection. |
| search | Scope, indexing freshness, no-result/error separation and authorized destinations. |
| stock_count | F3 record reachability; queued count durability, duplicate/conflicting counts and reconciliation. |
| tasks | Intended window/paging, source availability, assignment and completion persistence. |
| tyres | Registered destinations, true data sources and consistency with records/diagram. |
| tyre_diagram | Preserve real artwork and position IDs; topology, selection, RTL and accessibility tests. |
| tyre_exchange | Fitment legality, stock/serial lineage, attachments and idempotent offline replay. |
| washing | Verify ongoing evidence/activity implementation, old records, photos and offline replay. |
| workshop | Job, technician, parts and inspection links; authorization and failed writes. |
| work_orders | Board-window versus full-history intent, assignments, permitted transitions and reopen/history. |

Flutter routing and sync wiring remain protected by [Flutter AGENTS.md](../../tyre_pulse_flutter/AGENTS.md). None of those files was edited by this review. Flutter SDK and Dart were not found on PATH, and this Windows environment cannot perform the required iOS build. The PM implementation and tests are prepared locally; no Flutter verification pass is claimed. Calendar partial-source status remains open because rejecting every partial result would also hide permitted sources from users denied another source.

## Marketing: every page's next acceptance task

| Page | Next improvement/check |
|---|---|
| `/` | Demonstrable capability claims, real screenshots, download identity and responsive landing-to-contact journey. |
| `/product` | Map each capability group to implemented and configured behavior; distinguish field-mobile functionality from web administration. |
| `/industries` | Match industry use cases to actual available fields/workflows; avoid implied integrations without evidence. |
| `/pricing` | Confirm plan inclusions, deployment-dependent SSO/API options and sales handoff; no unverified savings or prices. |
| `/security` | Evidence for each enforcement claim; explicitly distinguish configurable controls from enforced defaults. |
| `/contact` | Eight local tests pass; verify deployment configuration, anti-abuse control and real provider receipt in an authorized acceptance test. |
| `/ar` | Complete shared navigation/footer language, RTL, keyboard and localized contact handoff. |

Also verify JSON-LD/llms feeds against the same claim evidence, sitemap/canonicals against deployed hosts, and the `source=pwa` redirect against the configured application origin. Source defaults alone do not prove deployed host correctness or a redirect loop.

## Verification

- Latest fix batch: 39 focused tests passed across reservation API/domain/screen and route domain/screen. One initial reservation screen test used an ambiguous text selector; corrected to handle the asset appearing in both its filter and row, then its file passed. The later route display/export regression also passed.
- Prior unchanged route API tests: 6 passed, including 1,251-row retrieval and page failures.
- Marketing contact: 8 tests passed; requests use a mocked provider and send no email.
- Production web build: passed locally after the reservation and route-savings fixes (52.56 seconds).
- Marketing production build and TypeScript: passed locally.
- Full web lint from the first batch passed with zero errors and the existing `DriverWorkspace.jsx:91` warning. All 10 JavaScript/JSX files in the new fix batch passed focused lint. Both screens now reuse `useLatestRequest`; the previous route-screen lint suppression was removed.
- Inventory script syntax check: passed; generated coverage is 256 web pages, 28 Flutter feature directories and 7 marketing pages.
- Not performed: full web suite, live schema/RLS verification, authenticated role journeys, browser/screenshot accessibility review, Flutter analyzer/tests/Android/iOS builds, deployed marketing delivery and deployment acceptance.

Pagination implementation follows the existing project helper and Supabase's [ordered, inclusive range contract](https://supabase.com/docs/reference/javascript/using-modifiers-range). This does not provide snapshot isolation against concurrent inserts; large exports may ultimately need a backend snapshot/cursor design.
