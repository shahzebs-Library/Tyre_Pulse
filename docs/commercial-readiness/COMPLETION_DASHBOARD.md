# Tyre Pulse completion dashboard (authoritative, 2026-11-16)

This is the single list of what remains. It replaces `PENDING_APPROVALS_20261116.md`.

Rules:
- An item is added only if it is a confirmed defect or a required launch step.
- A module marked Verified is reopened only for a reproducible regression.
- Statuses: Not Started, In Progress, Blocked, Ready for Release, Released, Verified.

Production baseline (checked read-only on 2026-11-16):
- Single-company mode is on. CAPTCHA is off. Entitlement enforcement is off.
- The last applied migration is `20261116063833 ten9f_login_lockout_per_account`.
- There have been no business-data writes since 2026-11-15 05:46.
- Counts: work orders 97,242; parts cost 8,648,017.06; expense lines 219,109 / 139,277,110.42; tyre records 11,267; replacement log 56; Tyre Exchange marks 846.

---

## PHASE 1: CURRENT COMPANY PRODUCTION COMPLETION

### 1a. Open confirmed P0/P1 defects (current company)
| ID | Defect | Affected users | Root cause | Exact fix | PR | Acceptance test | Production dependency | Status |
|---|---|---|---|---|---|---|---|---|
| P1-01 | A Tyre Data Collector cannot raise a corrective action from an inspection. 7 refused saves were seen live on 2026-11-16, 08:00-08:03 UTC. | 7 Tyre Data Collectors | Company A's permission overrides never granted `create` on `corrective_actions` to this role. RLS refuses the insert. | Data migration `20261117114000_tyre_data_collector_create_corrective_actions.sql` (+ROLLBACK) grants `create` only, never edit, approve or close. Closing stays with reviewer roles (`corrective_action_review_guard`). Site and country scope is still enforced by the RESTRICTIVE write policies. Client `aa6b3017`: the button asks the database and explains when a role really lacks the right. | #549 | Staging `staging_tdc_corrective_actions_check.sql` passes. Before: create false, insert refused. After: create true, edit false, approve false; own-site insert OK; other-site insert refused 42501; re-run no-op; rollback exact. In production after applying: a rolled-back check as a real collector gives create = true. | Owner approval to apply. Merge #549 for the client change. | Ready for Release |
| P1-02 | One blank or unreadable "Vehicle In Date" makes the whole Vehicle Complaints History upload fail. | Anyone importing complaints | `process_stg_complaints` inserts NULL into the required `opened_at` | `20261117112000_complaints_missing_in_date_reject.sql` (+ROLLBACK) skips that row with a recorded reason; the other rows land; re-uploading the same file does not duplicate rejects | #549 | `staging_complaints_in_date.sh` ALL OK (8/8 PASS, re-run no-op, rollback exact; re-run 2026-11-16) | Owner approval. Apply after `20261117110000`. | Ready for Release |

No other confirmed P0/P1 current-company defect is open:
- Production logs for 2026-11-15/16 show no other user-facing error.
- The job-card parts-cost loss (#528) is already fixed on main by #519, so #528 is closed.
- The Recall Tracker save fix is Released (#547).
- The five older draft PRs were compared file by file with main. None carries an unreleased current-company fix: #511 is closed as superseded; #504, #510 and #525 hold only documents and tests.

### 1b. Release candidate for the current company
1. Approve and apply `20261117110000_by_number_org_joins.sql`. It is a prerequisite for P1-02 and has no effect with one company (staging: Company A outputs identical; 10 leak cases closed).
2. Approve and apply `20261117112000_complaints_missing_in_date_reject.sql` (P1-02).
3. Approve and apply `20261117114000_tyre_data_collector_create_corrective_actions.sql` (P1-01).
4. Merge #549. This carries the client change `aa6b3017`, the staging tests and this dashboard.
5. Owner acceptance run (section 1c), one pass on production.

When steps 1-5 are done, the current-company version is complete.

### 1c. Module acceptance checklist (one pass, production, real roles)
Detailed browser scripts are in `docs/commercial-readiness/` (#535 workflow tests). A module becomes Verified when every line passes; a failure becomes a new P0/P1 row in 1a.

| Module | Acceptance (must pass) | Status |
|---|---|---|
| Sign-in and access | Username sign-in works for each role. A wrong password 5 times locks for 15 min. An admin unlock needs a reason. Each role sees only its menu. | Released |
| Inspections (web and phone) | Create with photos, submit, approve and sign. The PDF shows the tyre map and photos. Tyres due show on the banner. | Released |
| Corrective actions | Create (including a Tyre Data Collector after P1-01), assign, submit completion, reviewer closes. A collector cannot close. | Ready for Release (P1-01) |
| Work orders and job cards | Create and edit. An edit keeps the imported parts cost. Supervisor rights work. The cost ledger works. Closure works. | Released |
| Workshop Live | Assign, record events, close a job. Today's KPIs are shown. | Released |
| Tyre records, lifecycle and running life | Register filters, running life bands, replacement log, scrap and undo (undo by admin only) | Released |
| Tyre Exchange | Save, edit reason, scrap and undo marks | Released |
| ERP / data intake | Expense grid, job cards, monthly tyres and complaints upload. A re-upload does not duplicate. | Ready for Release (P1-02) |
| Expenses, CPK and cost per m3 | Totals per country in its own currency, no blended totals. CPK per vehicle and fleet. | Released |
| Checklists | Fill, two-stage sign-off, blocking marks prevent closing | Released |
| Accidents and claims | Report, workstreams, closure gate, claim fields, PDF | Released |
| Stock | Add and count, low and critical levels (admin only) | Released |
| Recall Tracker | Save a recall for an allowed country | Released |
| Reports and sharing | Scheduled reports send. A share link opens read-only. | Released |
| Flutter field app (Android) | Sign-in, inspection, tyre change, checklists, offline sync | Released |

### 1d. Not required for the current-company release (deferred, recorded)
| Item | Why deferred | Status |
|---|---|---|
| AI reads tyre serials from photos and flags mismatches | New feature, not a defect. About 2-3 days; needs prompt redeploy and migration approval. | Not Started |
| MFA enforced in the database for super admins (+ Flutter MFA screen) | Hardening; super admins can already enrol 2FA | Not Started |
| Hide phone, email and push token from non-admin colleagues | Hardening; names stay visible | Not Started |
| Login page text still says "iPhone app is in App Store review" (`PublicMarketingHome.jsx`) | Wording only | Not Started |
| eng1-6 cost-per-km drafts, KPI targets key, ops webhook/backup/exec-money, user view prefs, carbon offsets, replace-open-work-orders RPC | They change displayed numbers or are improvements, not defects | Not Started |
| Leftover tests and docs on #504, #510, #525 | Evidence only, not code | Not Started |

---

## PHASE 2: COMMERCIAL MULTI-COMPANY RELEASE
Single-company mode stays ON until every item below is Verified.

| ID | Item | Exact remaining work | PR | Acceptance test | Production dependency | Status |
|---|---|---|---|---|---|---|
| C-01 | TEN-1..13 tenancy foundation (plus TEN-1b, 4b, 5b, 6b, 7b, 7c, 8b, 9b, COM-1..8) | Done. Applied in the 2026-11-15 rollout. | merged | rollout verification | none | Released |
| C-02 | TEN-9c per-company usernames | Design decision; hard to reverse | none | staging suite | owner decision | Blocked |
| C-03 | TEN-9d company-code guard (a company Admin cannot clear or reuse a code), TEN-9e invitation sign-up refusal, TEN-9g "/" username | Drafts done and fixed | #546 | `run_staging.sh` 205/205 | owner approval | Ready for Release |
| C-04 | By-number job-card joins per company | Draft | #549 | `staging_by_number_org_joins.sh` ALL OK | owner approval (also in 1b) | Ready for Release |
| C-05 | Recall number unique per company | Draft (re-runnable) | #549 | `staging_recalls_unique_per_org.sh` ALL OK | owner approval; needs the owner present for the confirmation prompt | Ready for Release |
| C-06 | Company-pinned per-asset and per-serial database readers (`report_asset_overview`, `report_asset_metrics`, `check_duplicate_serials`, `get_unplanned_assets`, `asset_site_at`) | Draft | #546 | `staging_company_pinned_lookups.sh` (5 FAIL before, 6 PASS after) | owner approval | Ready for Release |
| C-07 | Web screens stay in one company for super admins (vehicle page incl. photo/GPS save, asset detail, Digital Twin, insurance, history, Ctrl+K and old search) | Done in code | #546 | `companyPinnedLookups.test.js` 16/16; 556 related tests | merge #546 | Ready for Release |
| C-08 | Flutter work-order search and serial lookup stay in one company | Not done (no Flutter toolchain in the last session) | #546 | Flutter unit test plus device check | Flutter build | Not Started |
| C-09 | Company-code sign-in, invitation page, invite panel (web and Flutter) | Code done | #546 | staging plus device | sign-in function deploy, company codes set | In Progress |
| C-10 | Sign-in function: fail-closed, timeouts, trusted IP only | Done | #550 (merge #550's version before #546's) | local 32/32 | owner approval to deploy | Ready for Release |
| C-11 | CAPTCHA on all clients (web, Flutter, Expo bridge) | Real-device and real-Cloudflare tests | #550, branch `ota/mobile-1.6.0-captcha` | `docs/commercial-readiness/auth/HANDOVER.md` section 4 | hosted staging (free org), Turnstile widget | Blocked |
| C-12 | Remove the temporary Tyre Exchange index | After 2026-11-22 and before a 2nd company records marks | pending file `20261117111000` | staging drop and recreate | owner approval | Not Started |
| C-13 | Subscription / entitlement enforcement switch | Preflight (TEN-6b) applied; switch off | none | entitlement tests | owner decision, billing | Not Started |
| C-14 | Onboarding a new company (codes, admin, import org `tp.import_org`) | Runbook step | none | staging end to end | C-03, C-09 | Not Started |
| C-15 | iPhone App Store release (logos, privacy manifest, wording, store link) | Rebase (1 test conflict), build, submit | #523 | Apple review | Apple account | Blocked |
| C-16 | Commercial PGlite tests for COM changes | Port onto main | #510 | tests pass | none | Not Started |
| C-17 | Hosted staging project (separate free Supabase organisation) | Create; run all staging suites | none | suites green on hosted | owner action | Not Started |
| C-18 | Final commercial acceptance and switch off single-company mode | After C-02..C-17 | none | two-company end-to-end | everything above | Not Started |

## Open PRs (consolidated)
| PR | Phase | Holds | Action |
|---|---|---|---|
| #549 | 1 (plus C-04, C-05) | Migrations 110000, 112000, 102000, 114000; client fix; staging tests; this dashboard | Approve the migrations, then merge |
| #546 | 2 | TEN-9d/9e/9g, company-pinned readers, client isolation, sign-in UI | Keep draft |
| #550 | 2 | Auth hardening (closed round) | Keep draft |
| #548 | done | TEN-9f (applied) | Close after #549 merges |
| #523 | 2 | iOS release | Keep draft |
| #504, #510, #525 | none | docs and tests only | Close or harvest later |
| #528, #511, #551 | closed | superseded / Expo OTA branch kept | none |
