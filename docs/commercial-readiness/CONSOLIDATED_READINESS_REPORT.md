# Tyre Pulse: consolidated readiness report

Date: 2026-11-15. Scope: everything the eight work streams produced. Nothing in this report has been
merged to main, deployed or applied to production, with one exception approved by the owner on
2026-11-15: PR #516 (legal page redirects on the marketing site).

Status labels used throughout: **Verified Fixed** (or Verified Passed for a test), **Verified Failed**,
**Not Tested**, **Blocked** (mechanism proven, waiting on an owner decision or on production apply).
"Confirmed" means reproduced by SQL, test or browser. "Inferred" means read from code only.

## 1. The two verdicts

| Question | Verdict | Basis |
|---|---|---|
| Internal Production Readiness (the current company) | **Usable, at risk.** | Daily work runs. Known faults for the current team have fixes prepared and tested off production, but none is applied yet. Disaster recovery beyond row snapshots is unconfirmed. |
| Commercial SaaS Readiness (a second, unrelated company) | **Not ready.** | Tenancy drafts close five of nine findings on staging; four stay open on owner decisions. Cross-company leaks, per-company settings, engineering metric names, marketing claims and operations (recovery objectives, status page, per-company export) are prepared or planned, not live. |

Why not higher for the current company: the fixes are drafts. A draft that passes on a synthetic database
is not a fix in production until it is applied and re-checked there.

## 2. Module register

227 register entries (218 modules plus sub-entries), in `audit/modules_A.json`, `modules_B.json`,
`modules_C.json`.

| Internal status | Entries |
|---|---|
| Ready | 168 |
| At risk (mostly switched off or no production rows, so never proven) | 58 |
| Broken | 1 |

| Commercial class | Entries |
|---|---|
| 1 (highest) | 1 |
| 2 Works after customer setup or data | 87 |
| 3 Needs repair | 62 |
| 4 Incomplete | 45 |
| 5 Duplicate | 21 |
| 6 (lowest; definitions in the module files) | 11 |

Existing data was never taken as proof that a module works, and an empty table was never taken as a reason
to hide one.

## 3. Final restore recommendation (31 proposed core modules)

Tested in a real browser against the synthetic staging copy (two companies with data, one empty company).
Evidence: PR #517, `audit/MODULE_WORKFLOW_TESTS.md`.

| Status | Count | Modules |
|---|---|---|
| Verified Passed, recommend restore | 29 | Battery Lifecycle, Bay Scheduling, Breakdown Callouts, Certifications, Combinations, Driver Documents, Driver Training, DVIR Reports, Tool and Equipment, Fleet Groups, Goods Receipt, Insurance Claims, Materials, Parts Catalog, Parts Requests, Preventive Maintenance, Policy Management, Repair Requests, Requisitions, Vehicle Reservations, Retread Management, Retread Claims, Rotation Schedule, Service Requests, Shift Scheduling, Tyre Pool, Tyre Service Events, Vehicle Check In/Out, Warranty Tracker |
| Verified Failed, do not restore yet | 1 | Recall Tracker: an Admin cannot save a recall (the page sends a country list into a single-value column) |
| Not Tested | 1 | Absence and Attendance: opens correctly but has nothing to create or update on the page |

Limits of this test: sign-in used a local stand-in for the auth service; file upload, email, push, live
updates, MFA, deletes, exports, Arabic and phone widths were not exercised. 19 of the 31 routes are Admin
only, so restoring them gives Managers nothing on those pages.

Unchanged: 17 optional modules stay hidden, 6 misleading modules stay disabled, 21 unsupported stay hidden.
**No production module setting was changed. Restore waits for the owner's approval of this list.**

## 4. Security findings and fixes (tenancy)

Tested with two independent synthetic companies and one empty company on PostgreSQL 16 staging, all 13
tenancy drafts applied, 0 failed. Evidence: PR #506 and #508, `supabase/staging/reports/RESULTS.md`.

| Finding | Status | Evidence or reason |
|---|---|---|
| TEN-1 shared asset and job card keys | Verified Fixed | Second company can hold the same job card number |
| TEN-2 cross-company read | Verified Fixed | Other company's admin sees 0 rows, own admin sees 1 |
| TEN-3 global tables readable | Verified Fixed | 0 rows to the other company |
| TEN-4 permissions answered for another user | Verified Fixed | Foreign id returns nothing; own and same-company still work |
| TEN-5 Admin can change own plan and limits | Verified Fixed | Refused with a plain message |
| TEN-6 plan limits not enforced | Blocked | Closed only with the enforcement switch on; shipped off on purpose |
| TEN-7 global role matrix and mailbox keys | Blocked | Mailbox keys closed; 538 global role rows still readable by design |
| TEN-8 sign-up lands in the current company | Blocked | Closed only with single-tenant mode off; shipped on |
| TEN-9 global usernames | Blocked | Invitation and purge functions exist; three global username keys remain a design hold |

Tests: 57 of 57 on PGlite, 35 of 35 isolation checks on staging. No finding is Verified Failed.
Not Tested: production itself (PostgreSQL 17.6), and the web and mobile apps against the after-state.

Cross-company leaks outside the nine (PR #510, 22 of 22 tests): accident mailbox, elevated notifications,
alert thresholds, scrap marks, warranty claim numbers. All Verified Fixed on synthetic data, Not Tested on
production.

**Staging contains no production data or credentials: Verified.** Scan of the staging branch found 0 token
or key patterns; the production project reference appears only in guards that refuse to run against it;
every e-mail address is on a non-routable test domain. Hosted staging is Blocked: it needs the owner to
create a free Supabase organisation.

## 5. Engineering errors and corrected expectations

Evidence: PR #513, `audit/ENGINEERING_FIXES.md`.

- **The 12.6x cost-per-km difference (confirmed).** Four different sums shared one name. KSA 0.0235 was
  tyres, spares and oil divided by tyre km; 0.296 was the same spend divided by vehicle km. Both were
  arithmetically right. The first measures nothing and is now withheld.
- **Named metrics.** Tyre CPK (lifetime) is the headline: KSA 0.0287 SAR, UAE 0.0160 AED, Egypt 0.4022 EGP.
  Tyre cost and maintenance cost per vehicle km are separate figures.
- **Tyre life baseline.** Mean removed-tyre life after the single km rule: KSA 42,631 to 37,085 km, UAE
  42,147 to 30,647, Egypt 68,532 to 34,580. More tyres read as due (KSA 358 to 399).
- **Downtime.** Measured hours come only from job card timestamps. Assumed downtime is labelled as assumed
  and never shown as measured. The default 850 rate is removed.
- **Historical records are untouched.**

| Case | Status |
|---|---|
| C26, C28b, C30b, C30c, C31b, C24c | Verified Fixed |
| C20b, C23b, C29 | Verified Fixed off production; Blocked on production until their drafts are applied |
| C22 (not run in the audit) | Verified Fixed off production; Not Tested on production |
| SQL side of the metric rename (draft 120000) | Not Tested, never executed |

Effect on the current company if deployed: the CPK headline number changes (KSA 0.0168 to 0.0287); users
should be told first.

## 6. Current-company operational problems

| Problem | Status | Where |
|---|---|---|
| Manager refused on work orders and Live Control | Verified Fixed off production; Blocked: the draft reverses the 2026-09-30 Admin-only decision | PR #511 |
| KPI targets fail to save | Verified Fixed off production; Not Tested on production | PR #511 |
| Budgets and sites fail without a reason | Verified Fixed (tests) | PR #511 |
| Scheduled report mixes currencies ("SAR 10,646,335") | Verified Fixed (tests) | PR #509 |
| 12 failed webhook deliveries | Confirmed cause: test subscriptions pointing at the product site (HTTP 405); guard added | PR #509 |
| Privacy page omits outside processors | Verified Fixed (tests); Blocked on legal review of the wording | PR #509 |
| Backups | Confirmed: nightly snapshot covers 7 small tables only; platform backup plan not confirmed | PR #509 runbook |
| 159 open corrective actions, 90 pending approvals | Investigated, no record changed. 144 of 159 come from one batch; 58 of 90 cannot be approved by anyone | PR #511 |
| Cross-company accident mail | Verified Fixed off production | PR #510 |
| Tenant branding and settings | Design and resolvers drafted, nothing calls them yet | PR #510 |
| AI accuracy | Not Tested. Validation plan written; no accuracy claim until measured | PR #510 |
| 14 marketing claims | Verified Fixed in the marketing source; Not Tested in a browser | PR #510 |

## 7. Console and Flutter

| Item | Status |
|---|---|
| Console fixes, automated checks | Verified Fixed (PR #505, CI clean) |
| Flutter: analyze clean, 3,678 tests pass, Android and iOS builds succeed | Verified Fixed (PR #507, CI green) |
| Flutter: 18 golden image differences | Linux-only rendering differences, not regressions |
| Real device: login, real data, role permissions, small screens, accessibility | **Not Tested.** No device was available |
| Next Flutter build closes PM Programs and Repair Requests on phones for non-admins | Confirmed in code; owner should know before the build |

## 8. Test suite

- New full suite: runs in CI on every draft PR. Latest full web run: 15,195 passed, 1 failed (fixed in
  PR #509, then green). Reports are preserved on each PR's checks and under `supabase/staging/reports/`.
- **The three unidentified failures from the original run remain Unverified.** They were not reproduced and
  are not claimed as resolved.
- Main is currently red on one test since PR #512 (inspection observations grouping). The feature works;
  the old assertion is stale. Fix: PR #515 (test only).

## 9. Draft pull requests and CI

| PR | Content | CI |
|---|---|---|
| #504 | Audit documents (base for the others) | Red only because of the stale test on main; cleared by #515 |
| #505 | Console fixes | Clean |
| #506 | Tenancy security drafts | Clean |
| #507 | Flutter fixes | Green |
| #508 | Staging environment | Clean |
| #509 | Current production fixes B | Green |
| #510 | Commercial fixes | Green; conflicts with main in `marketing/` only (keep the branch copy) |
| #511 | Current production fixes A | Green |
| #513 | Engineering accuracy | Clean |
| #515 | Stale test fix for main | Running |
| #517 | Browser workflow evidence | Running |
| #516 | Legal page redirects | **Merged 2026-11-15 on the owner's instruction** |

Each draft PR body carries its test evidence, risks to the current company and rollback.

## 10. Implementation order

1. Merge #515 so main is green again.
2. Operational fixes with no database change: #509, then the client part of #511.
3. Owner decisions (section 11), then apply the matching drafts one at a time on production, each with a
   rolled-back check first.
4. Tenancy drafts TEN-1 to TEN-5 (#506). Keep TEN-1b held.
5. Engineering (#513), after telling users the headline number changes.
6. Restore the 29 passed modules; fix Recall Tracker first, then restore it.
7. Cross-company leak drafts and per-company settings (#510). Ship draft 154500 only together with its
   client line.
8. Console (#505) and Flutter (#507) after a real-device pass.
9. Hosted staging, then the commercial roadmap (`audit/SAAS_IMPLEMENTATION_ROADMAP.md` on #506).

## 11. Decisions needed from the owner

1. Approve the restore list in section 3.
2. Reverse the Admin-only job card rule for Managers and Directors, or keep it.
3. Who closes the 159 corrective actions; how a checklist with a recorded fault gets closed.
4. TEN-5 stops the Billing "downgrade to trial" button for company Admins. Accept or redesign.
5. Entitlement enforcement and single-tenant mode switches: when to turn them.
6. Company code at sign-in, and the purge policy for a departing company.
7. Legal review of the privacy wording.
8. Confirm the Supabase backup plan in the dashboard.
9. Create the free Supabase organisation for hosted staging.
10. TPMS wording on the site: "Planned" reverses the earlier "via telematics" ruling.
11. AI pass marks and the two reviewers.

## 12. What was not done

- No production data, setting, policy or module switch was changed.
- No paid resource was created.
- No mobile build was made.
- Nothing was verified on a real phone or against the hosted production API after the fixes.
