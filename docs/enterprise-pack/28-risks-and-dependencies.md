# 28 - Risks and Dependencies

- Deliverable 28 of 29
- Date: 2026-11-10
- Status: Risk register written for this pack. Several mitigations are Built (cited); the rest map to roadmap ids.
- Evidence: incidents and measurements are from `PROJECT_MEMORY.md` (dated per row). Live read-only checks on
  2026-11-10: `audit_log_v2` 654 MB vs 256 MB `shared_buffers`; 0 rows in `approval_matrix`, `org_units`,
  `org_subscriptions`; accident emails ON; deployed `send-scheduled-reports` v28 is behind the repo; two duplicate
  migration timestamps in `supabase/migrations/` (verified with `ls`).
- Related docs: 26-priority-roadmap.md, 27-cost-and-complexity-estimate.md, 29-change-register.md,
  `docs/SECURITY_RISK_REGISTER.md` (older, partly superseded by this register).

Scale: Likelihood L / M / H. Impact L / M / H / C (critical). Owner: ENG, OWN (owner decision), OPS (account
setting), CUS (customer data).

## 1. Data integrity

| # | Risk | L | I | Mitigation in place | Remaining action | Owner |
|---|---|---|---|---|---|---|
| D1 | Re-importing a file without the ERP `#` line number duplicates money | H | C | `import_uid` + unique index (V363/V365) for keyed files; sha256 file fingerprint warning in Data Intake, ERP Intake, Smart Import; Duplicate Control console with archive + undo (V362) | UAE/Egypt files still unkeyed (R-033); history: 8,248 duplicates (memory 2026-07-26), UAE re-upload duplicated again 2026-08-10 | CUS |
| D2 | Date parsing reads DD-MM as MM-DD or 2-digit year as year 0026 | M | H | Day-first JS `coerceDate`; V381b/V388/V388b SQL fixes; `master_parse_date` | 574 swap-class + ~11,000 year 0022-24 job cards remain (R-030); rule: never cast dd-mm text with bare `::timestamptz` | CUS |
| D3 | Currency blending (SAR + AED + EGP summed) | M | H | `governedCost.js` Money type throws on mismatch; per-country panels; FX inert with 0 approved rates | ~121 inline cost sites still to migrate (R-053); FX rates need approval (R-032) | ENG / OWN |
| D4 | Country stamped wrong on import (Egypt file loaded as UAE) | M | H | V491 / `trg_aa_expense_country_guard` job-card prefix check; V405 repair | Keep guard name order (`aa_`) | ENG |
| D5 | Tyre cost from `cost_per_tyre` vs expense grid diverge | M | M | Rule: totals from grid (`loadCostSplit`, `get_tyre_cost_by_asset`) | Lifetime CPK not end to end (R-054) | ENG |
| D6 | Classification of spend moves money between buckets on any UPDATE | M | M | Trigger is BEFORE INSERT OR UPDATE by design; snapshots `_bucket_snapshot_*` | Engineers must know this before updating `parts_consumption` | ENG |
| D7 | Row-cap truncation (PostgREST 1000) silently understates totals | M | H | `fetchAllPages`, identity pager for RPCs, `src/test/rowCapGuard.test.js` in CI | New tables must be added to the guard's counts | ENG |
| D8 | Customer data gaps presented as measurements | M | M | Honest N/A rule; `NotInUseNotice`; trust scores (V473-V475) | Expiry file, SANY PDF, insurance schedule outstanding (R-031, R-038, R-039) | CUS |

## 2. Security and tenant isolation

| # | Risk | L | I | Mitigation in place | Remaining action | Owner |
|---|---|---|---|---|---|---|
| S1 | SECURITY DEFINER functions bypass RLS (owner has BYPASSRLS) | M | C | Guards added V545-V578; rule recorded; advisors sweep | Every new definer fn must re-check org/country/site (review gate) | ENG |
| S2 | Client can forge `audit_log_v2` rows under own name | M | M | Tamper and erase refused; foreign country refused (V578, V581) | R-002 move INSERT behind RPC | ENG |
| S3 | `send-email` usable as a brand-domain relay by an insider | L | M | Role gate `requireApprovedRole` | R-003 allowlist + rate limit | ENG |
| S4 | Share links expose more pages than chosen | M | M | Token, expiry, bcrypt password (V251/V252) | R-005 server-side page filter | ENG |
| S5 | Super-admin account compromise | L | C | Console tab-local session, idle 10 min, absolute 8 h, new-device alerts, break-glass notifications | R-023 2FA enrolment + username rename | OPS |
| S6 | Unrestricted Firebase Android key reused against other Google APIs | M | M | Key is publishable by design | R-022 restrict key | OPS |
| S7 | `is_admin_or_above()` "fixed" by a future engineer | L | C | Decision recorded; dependent policies retargeted to `is_super_admin()` | Keep this row in onboarding | ENG |
| S8 | Second tenant onboarded before org hierarchy and billing are real | M | H | V306-V318 tenant hardening; plan-limit trigger inert until subscription exists | R-070, R-074, R-110 before a second paying tenant | OWN |
| S9 | Storage photo UPDATE without org check | L | M | Path convention `<org>/<COUNTRY>/<ASSET>` | R-006 | ENG |
| S10 | Accident emails now ON in production; wrong routing sends case data to wrong people | M | M | Recipients resolved by role + site + country from `profiles` (V304) | R-095 confirm recipients and intent | OWN |

## 3. People and process

| # | Risk | L | I | Mitigation | Remaining action | Owner |
|---|---|---|---|---|---|---|
| P1 | Single-person dependency: one owner holds every vendor account, decisions and data files | H | H | PROJECT_MEMORY.md + this pack | Second administrator on Supabase, Vercel, Play, Firebase, Sentry; written runbooks | OWN |
| P2 | Only one person holds an area-manager role; final checklist rung would jam on leave | M | M | Director/Admin kept on final rung (V600 guard aborts if removed) | R-072/R-073 delegation | OWN |
| P3 | Parallel Claude sessions on one branch overwrite or stash each other's work | H | H | git-safety skill; commit by pathspec; `git merge-tree` check before merge; never stash on shared tree | Keep one session per area (app vs marketing rule from 2026-10-06) | ENG |
| P4 | Commit signing broken in the agent environment | H | L | Commits authored correctly, unsigned | R-010 adjacent: fix signing key or accept | ENG |
| P5 | Repo and database drift (migrations applied with no file, duplicate timestamps) | H | M | Migration headers carry verify + rollback | R-008, R-009 | ENG |
| P6 | No staging environment; changes verified only in rolled-back live transactions | H | H | Rolled-back verification discipline | R-117 | OWN |

## 4. Mobile build and rollback

| # | Risk | L | I | Mitigation | Remaining action | Owner |
|---|---|---|---|---|---|---|
| M1 | Merged mobile code is not on any phone (no builds without owner ask) | H | M | Rule recorded; report as "merged, awaiting build" | Owner schedules releases | OWN |
| M2 | Expo SecureStorage format not rollback-safe (staged-write chunks) | L | H | Documented: halt rollout and ship forward | Applies only if Expo is ever rebuilt | ENG |
| M3 | Forced-update gate locks every phone out if minimum is set above a released build | L | C | Interlock in Console Mobile App (`gateRisk`), separate `flutter_min_version` | Live `flutter_min_version` is NULL; set only after release (R-121) | OPS |
| M4 | R8 shrinking breaks something only visible on device | M | M | Keep rules + no resource shrinking | Smoke test each release before promotion | ENG |
| M5 | Flutter iOS entitlement lost at signing | M | M | Entitlements file + plist script | Confirm on first TestFlight build (R-119) | OPS |
| M6 | Turnstile enabled before mobile sends a token locks out every phone login | L | C | Warning recorded | R-025 depends on mobile support | OPS |

## 5. Scale ceilings

| # | Risk | L | I | Mitigation | Remaining action | Owner |
|---|---|---|---|---|---|---|
| C1 | Database is I/O bound: largest table is 2.5x cache | H | M | V582 realtime trim, V583 vacuum, V584 index cleanup | R-020 compute tier, R-021 audit growth | OPS |
| C2 | Browser import path tops out near 100k rows | M | M | Chunked + retry `saveImportRows`, staging tables with triggers | R-093 server COPY pipeline | ENG |
| C3 | Generic plan caching slows nullable-filter RPCs | M | M | `plan_cache_mode = force_custom_plan` on 74 RPCs (memory 2026-10-11) | Rule for new read RPCs | ENG |
| C4 | Vercel free plan: 100 deployments/day | M | H | Preview suppression in `vercel.json`, `ignoreCommand`, one merge per session | Paid plan or keep discipline | OWN |
| C5 | Org-leading composite indexes unusable under OR-shaped RLS | M | M | Lead indexes with country (memory 2026-10-11) | Index review per new table | ENG |

## 6. Third-party dependencies

| # | Dependency | Risk | Mitigation |
|---|---|---|---|
| T1 | Supabase (DB, Auth, Storage, Edge) | Single vendor for the whole backend; MCP flaps | Nightly logical snapshot of core tables (V495); restore tested on 2026-08-10 for row recovery only |
| T2 | Vercel | Build quota, region | Static SPA; could move hosts |
| T3 | Anthropic API | Price or outage | Budget cap fail-closed; Gemini fallback optional |
| T4 | Resend | Rate limit 2 req/s | Paced sends (650 ms) |
| T5 | Google Play / Apple | Policy deadlines (API-36 met 2026-07-26) | Track yearly target SDK |
| T6 | Firebase FCM / APNs | Push silently undelivered | `push_delivery_receipts` (accepted only, not displayed) |
| T7 | npm ecosystem | 3 known prod advisories (pptxgenjs chain) deliberately unforced | Dependency audit skill before upgrades |

## 7. Regulatory and policy

| # | Risk | L | I | Mitigation | Remaining |
|---|---|---|---|---|---|
| G1 | Privacy: driver national IDs and names in insurance claim register | M | H | Elevated-only read; nationality never queried or charted | Data protection statement per country (R-116) |
| G2 | Play Data Safety accuracy | L | M | `/data-deletion` page; in-app deletion request (V317) | Re-check after each new SDK |
| G3 | Data residency (KSA, UAE, Egypt) | M | H | None documented | R-116 statement of where data is hosted |
| G4 | Audit-log retention and immutability (ISO) | L | M | `prevent_audit_mutation`; logs-only purge at 365 days | R-021 decision |
| G5 | Consent tracking not built | M | M | None | Spec 19 item, part of R-116 |

## 8. Dependency graph between roadmap items

| Item | Depends on | Why |
|---|---|---|
| R-070 hierarchy | R-058 | RLS helpers read the org column; unify first |
| R-071 directory | R-070 | Employees attach to units |
| R-072 approval engine | R-070 | Routing resolves by unit/site |
| R-073 delegation | R-072 | Delegates approval steps |
| R-077 master-data approval | R-072 | Uses the same engine |
| R-094 notifications | R-071 | Contacts come from the directory |
| R-050 permission engine | R-051 | Server enforcement must exist first |
| R-052 sub-module caps | R-050 | Same resolver |
| R-097 API platform | R-050 | API keys carry scoped permissions |
| R-098 connectors | R-097 | Built on the versioned API |
| R-053 governed cost | R-032 | Combined totals need approved FX |
| R-054 lifetime CPK | R-034 | Tyre data proposals change inputs |
| R-090 export modes | R-053 | Exports must use governed numbers |
| R-091 share layouts | R-005 | Page filter first |
| R-092 digest periods | R-001 | Deploy current function first |
| R-110 billing | R-075 | Suspension is the enforcement lever |
| R-111 usage metering | R-110 | Plans define limits |
| R-118 test programme | R-117 | Needs staging |
| R-116 DR plan | R-020 | PITR availability depends on tier |
| R-121 Play production | R-120 | Release hygiene first |
| R-064 iOS completion | R-119, R-121 | Push and release path |
| R-025 Turnstile | Flutter token support | Avoid phone lockout |
| R-060 asset master merge | R-042 | Needs country-qualified asset key |
| R-007 parts_consumption site policy | R-030 | Verify site values after re-upload |

Critical path for an enterprise sale: R-023, R-002, R-005 (security) then R-070 to R-072 (hierarchy and approvals),
R-050/R-051 (permissions), R-117/R-118 (staging and tests). Everything else can run in parallel.

## Open decisions for the owner

- Name a second administrator for every vendor account (P1).
- Staging environment budget (P6, R-117).
- Whether a second paying tenant may be onboarded before R-070/R-074/R-110 (S8).
- Confirm accident emails being ON is intended (S10).

## Next actions

- Phase 1, S: R-023 and R-022 account settings this week.
- Phase 1, S: R-008 duplicate migration timestamps before any `supabase db push`.
- Phase 3, XL: approval engine pilot (R-072) on one site chain once R-070 has a seeded hierarchy for KSA.
