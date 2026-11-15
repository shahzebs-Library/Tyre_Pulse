# Tyre Pulse: final handover, 2026-11-15

Written for Codex or any developer continuing this work. Everything marked "verified" was read from
GitHub or from the production database (read only) on 2026-11-15. Statuses: Verified Fixed,
Verified Failed, Not Tested, Blocked.

Section 12 at the end is a running log. If the session that wrote this file ended early, the newest
state of each stream is the last commit on its branch, and section 12 says how far each one got.

## 1. Rules that never change without the owner's explicit approval

1. No production database change, migration, module switch, deployment, paid service or destructive
   change. A subscription ending or a deadline is not approval.
2. No merge of any PR. Draft PRs only.
3. Draft SQL lives in `supabase/pending_migrations/` and moves to `supabase/migrations/` only when
   it has actually been applied.
4. Do not apply ERP actions 2 to 4 (PR #526). Only the interim lock (action 1) was approved and applied.
5. Do not turn off single-tenant mode or switch on subscription or entitlement enforcement in
   production. The current company keeps an unrestricted internal entitlement.
6. Do not bulk-close the open corrective actions (180 total, 178 open) or pending approvals.
7. Historical financial values, approval records, ERP source data, tyre prices, lifetime CPK and
   approved inspection records are not rewritten.
8. No App Store or Play submission. No mobile build unless the owner asks.
9. No paid server PDF rendering.
10. The three unidentified failures of the first full test run stay Unverified.
11. Never place credentials or customer data in logs, issues, prompts or public artifacts.

## 2. Current production state (verified, read only)

| Item | Value |
|---|---|
| Supabase project | `jhssdmeruxtrlqnwfksc` |
| Latest migration | `20261115120856 observation_erp_confirm_interim_lock` (applied 2026-11-15 on the owner's approval) |
| Previous | `20261115090615 observation_erp_reconciliation_20261115`, `20261112082058`, `20261112080832`, `20261112080820` |
| `single_tenant_mode` | `true` |
| Corrective actions | 180 total, 178 open |
| `observation_erp_links` / `_link_events` | 0 rows / 0 rows |
| Position service functions | 0 (the #521 follow-up migrations are not applied) |
| Web production (Vercel `tyre-pulse`) | main `d1d58f66` at last check |

Live function hashes (`md5(pg_get_functiondef)`):

| Function | md5 |
|---|---|
| `observation_erp_decide(uuid,uuid,text,text)` | `272f785a2a32256bfe2b83b99d131c1b` |
| `confirm_observation_erp_link(uuid,uuid,text)` | `479f5400cf932e246c748909733be801` |
| `reject_observation_erp_link(uuid,uuid,text)` | `f3109e20f4628824f4ecd90bd836e289` |
| `app_user_can(text,text)` | `895423d15fce76a9c4b7f1515ea4f9c6` |
| `app_current_org()` | `fe910f8c5e4dd20015c43486b3bb97d7` |
| `app_can_see_country(text)` | `2e30a2fd6212be399e8160cdcb015b3f` |
| `app_can_see_site(text)` | `189b7ade92ef31858fedcf65cdb4cb4b` |
| `decide_checklist_approval(uuid,text,text,text)` | `2a969c4a47d4e4a24c07db62564d44a2` |
| `decide_inspection_approval(uuid,text,text,text)` | `02b6a63ac2fa8c0eabff2040fe52a83f` |
| `get_tyre_running_life(text,int,int,text,bool)` | `9ae17c2e6a019930580a829169ab12c4` |
| `get_fleet_cpk(text,date,date,text)` | `a94b6042000fe17f23bae5a299d3ccde` |
| `get_cost_per_m3(text,date,date)` | `ba68de8b28b8785628604a7e7fddc3e6` |
| `classify_parts_consumption()` | `e35628d91f33ecf85de23653e25a8a13` |
| `scrap_tyre_by_serial(text,text,text)` | `7c6d8feaa1c254221c1f8da4d4494e67` |

## 3. Pull requests #504 to #528 (verified on GitHub)

Merged: #512, #514 (Codex), #515, #516, #521, #522 (Codex).

Open, all draft:

| PR | Branch | Base | Content |
|---|---|---|---|
| #504 | `claude/tyrepulse-inspector-build-7rxp2t` | main | Audit documents, parked page consolidation. Base of #505 to #511, #513, #517. Holds this file |
| #505 | `claude/console-fixes-7rxp2t` | #504 branch | Console fixes |
| #506 | `claude/tenant-security-drafts-7rxp2t` | #504 branch | Tenancy drafts TEN-1 to TEN-9 |
| #507 | `claude/flutter-fixes-7rxp2t` | #504 branch | Flutter fixes |
| #508 | `claude/staging-environment-7rxp2t` | #504 branch | Local staging (PostgreSQL 16, synthetic Alpha, Beta, Gamma) |
| #509 | `claude/current-prod-fixes-b-7rxp2t` | #504 branch | Report currency, webhooks, privacy, backup status |
| #510 | `claude/commercial-fixes-7rxp2t` | #504 branch | Tenant leak drafts, settings, marketing claims, AI plan |
| #511 | `claude/current-prod-fixes-a-7rxp2t` | #504 branch | Manager work orders, KPI targets, budgets, sites. Its work order part is carried inside #519 |
| #513 | `claude/engineering-accuracy-7rxp2t` | #504 branch | Named cost-per-km metrics, tyre life baseline, downtime |
| #517 | `claude/module-workflow-tests-7rxp2t` | #504 branch | Browser evidence for 31 modules |
| #518 | `claude/commercial-blockers-7rxp2t` | main | Recall Tracker fix, TEN-6 to TEN-9 drafts, sequence runner |
| #519 | `claude/work-order-permissions-7rxp2t` | main | Work order and Live Control permissions |
| #520 | `claude/closure-workflow-7rxp2t` | main | Corrective action review, checklist acknowledge |
| #523 | `claude/ios-review-fixes-7rxp2t` | main | iPhone review fixes |
| #524 | `claude/at-risk-module-fixes-7rxp2t` | main | At-risk module fixes |
| #525 | `claude/round2-browser-tests-7rxp2t` | main | Browser evidence for #518 to #520. Never merge: it contains merges of those branches |
| #526 | `claude/erp-followup-v2-7rxp2t` | main | ERP interim lock and corrected confirmation |
| #527 | `claude/pdf-cache-service-7rxp2t` | main | Stored report PDFs |
| #528 | `claude/job-card-parts-cost-fix-7rxp2t` | main | Job card save no longer zeroes a stored parts cost |

Not ours: #503 (dependabot).

## 4. ERP interim lock: APPLIED 2026-11-15 on the owner's explicit approval

Exact SQL (draft `20261116084000_observation_erp_confirm_interim_lock.sql`, PR #526):

```sql
revoke execute on function public.observation_erp_decide(uuid, uuid, text, text) from authenticated;
revoke execute on function public.confirm_observation_erp_link(uuid, uuid, text) from authenticated;
revoke execute on function public.reject_observation_erp_link(uuid, uuid, text) from authenticated;
```

Rollback:

```sql
grant execute on function public.observation_erp_decide(uuid, uuid, text, text) to authenticated;
grant execute on function public.confirm_observation_erp_link(uuid, uuid, text) to authenticated;
grant execute on function public.reject_observation_erp_link(uuid, uuid, text) to authenticated;
```

Applied as migration `20261115120856 observation_erp_confirm_interim_lock`: a guard block (aborts
unless the three function hashes, the ACL, the caller list and the 0 row counts match the reviewed
baseline) followed by exactly the three REVOKE statements. Verified after apply:

| Check | Result |
|---|---|
| ACL on all three functions | `{postgres=X/postgres,service_role=X/postgres}` |
| Roles able to execute the decide function | postgres, service_role, supabase_admin |
| Decide, Confirm, Reject as a real approved Manager | each Refused 42501 |
| Reads as that Manager (links, history, corrective actions, job cards, tyres, inspections) | Work |
| Function hashes | Unchanged (`272f785a...`, `479f5400...`, `f3109e20...`) |
| Links / history / corrective actions / work orders / tyre records | 0 / 0 / 180 / 97,242 / 11,267, same as before apply |
| Policies on the two ERP tables | 6, unchanged |
| Position service functions | 0 (actions 2 to 4 NOT applied) |

The draft file should move from `supabase/pending_migrations/` to `supabase/migrations/` on PR #526
with its header changed to APPLIED. Action 4 (`091000`) grants EXECUTE again on purpose.
Until action 4 is applied, nobody can record an ERP decision through the app. That is intended.

Pre-apply evidence (production, inside one DO block ended by a deliberate exception, so rolled back; state
re-read afterwards and unchanged):

| Check | Result |
|---|---|
| Decide function as a real approved Manager | Refused 42501 |
| Confirm wrapper | Refused 42501 |
| Reject wrapper | Refused 42501 |
| Direct insert into `observation_erp_links` | Refused 42501 (signed-in users only hold SELECT) |
| `anon` | No EXECUTE before or after |
| `service_role` | Keeps EXECUTE |
| Read links, history, corrective actions, job cards, tyre records under the lock | Works |
| Revoke then grant | Same grants as today (stored ACL order differs, no effect) |
| Other callers | None: no cron job, no trigger, no other function, no edge function, no phone app. Only `src/lib/api/observationErpEvidence.js` |

Not tested: the refusal through PostgREST itself (observed in SQL as the API role).
Affected: the 5 accounts that pass the live gate today (2 Admin, 3 Manager). 0 decisions recorded so far.

Why it matters: the live function checks company, country and role but not site, and matches wheels
from a fixed text table. A signed-in Admin or Manager can call it directly even though the screen
shows no Confirm button.

## 5. Owner decisions already recorded (do not ask again)

Work orders
- Managers create, assign, update and manage within their company and sites.
- Workshop Supervisors create and manage, assign technicians, record progress, use Live Control within sites.
- Tyre Engineers: tyre-related work orders.
- Technicians and Tyre Men work their ASSIGNED jobs on web and mobile, update tasks, submit evidence.
- Deleting historical work orders, altering approved costs and overriding closed records stay restricted.
- Enforced in frontend, backend, RLS and RPCs.

Corrective actions and checklists
- Worker submits, an independent reviewer approves or returns. Reviewer roles configurable per company.
- The submitter may REQUEST an exception but never approve or close their own.
- Tyre Data Collector: create, update, document, assigned quality checks. No unrestricted cost approval,
  no record deletion, no final closure.
- Workshop Supervisors review corrective actions and acknowledge checklists within their sites.
- An acknowledged checklist with an unresolved fault shows "Acknowledged, Action Required". The fault
  and its linked corrective action are preserved.

ERP
- Layout-based matching only. No text substitution. Ambiguous stays pending. Pump layouts need a
  verified mapping; none is assumed.
- A serial alone never confirms. An unresolved wheel needs a separately authorised, documented,
  independently approved exception.
- Never auto-confirm, change tyre costs, alter ERP records or close a corrective action.
- Layout versions so history is not reinterpreted. Reporting bot policies on new tables.
- Keep #522's focused loading and review panel.

PDF
- Continue #527. Approved versions immutable. Managers regenerate only with explicit authorisation;
  original version, audit trail and signatures preserved.
- Bulk limit configurable, initially 50. Tyre Men download only authorised reports.
- No paid rendering service. Retention configurable, 90 days minimum.

Engineering
- Tyre purchase cost counted once per tyre lifetime, separate from tubes, flaps, spares, oil, maintenance.
- Zero-cost tyres: exclude warranty; match a missing price only on same item code, same month,
  with evidence. Otherwise flag for review.

General
- One PR per coherent module. No merging several PRs together without an integration plan.
- Do not hide a useful module because its table is empty. Do not market TPMS, GPS, RFID, predictive
  AI or integrations as live unless they work.

## 6. Pending migrations and their order

All in `supabase/pending_migrations/` on the named branch. None applied. Each file header carries its
own verify and rollback.

| Order | File(s) | Branch / PR | Notes |
|---|---|---|---|
| 1 | `20261116084000` interim ERP lock | #526 | APPLIED as `20261115120856`. Section 4 |
| 2 | Tenancy `20261112100000` to `115000` | #506 | TEN-1 to TEN-5 Verified Fixed on staging. TEN-1b held |
| 3 | Engineering `20261113120000` to `125000` | #513 | Tell users first: the CPK headline changes |
| 4 | Current fixes `20261113130000`, `130500` | #511 | Superseded for work orders by #519 |
| 5 | Commercial `20261114150000` to `156000` | #510 | `154500` ships only with the client line in `src/lib/api/tyreExchange.js` |
| 6 | Work orders: `20261115160000`, `160500`, `161000` being renumbered to `20261115140000`, `140500`, `141000` | #519 | Apply only after the #528 web fix is live |
| 7 | Multi-company `20261115160000` to `169000` | #518 | `169000` is a HOLD draft. Enforcement switches stay off |
| 8 | Closure `20261116100000`, `101000`, `102000` | #520 | `101000` has a constraint swap, so the confirm prompt appears |
| 9 | ERP `20261116085000`, `090000`, `091000` (+ `091000 ... ROLLBACK`) | #526 | Not approved. Together, after action 1 |
| 10 | PDF `20261117090000`, `091000` | #527 | First has `drop policy if exists` guards: owner present or SQL editor |
| 11 | At-risk `20261117100000`, `101000` | #524 | |

Known conflict: #518 and #519 both used `20261115160000` and `161000`. The #519 files are the ones
being renumbered. Check `git ls-tree -r --name-only origin/<branch> supabase/pending_migrations`
on every open branch before adding a draft number.

Supabase MCP gotchas: a migration whose text contains `drop` or `delete` (even in a comment) waits
for a human confirmation and times out in a cloud session. Never `RAISE` with errcode 40001 (PostgREST
retries forever); use `PT409`. Revoke EXECUTE from PUBLIC and then from anon. A new table ends with
`select anum_integration.apply_reader_policies();`.

## 7. Staging

- Local PostgreSQL 16 at `127.0.0.1:54329`, built by `supabase/staging/` on PR #508. Synthetic
  companies Alpha and Beta with data, Gamma empty. No production data or credentials.
- Each stream uses its own database copy (names like `tp_position`, `tp_eng`, `tp_pdf`).
- Browser harness: `e2e/staging/` on PR #525 (`README.md`, `round2_setup.sh`, specs). Sign-in uses a
  local stand-in for the auth service. Storage, email and push are not available there.
- Hosted staging is Blocked: the owner needs to create a free Supabase organisation.
- Real Supabase Storage has not been exercised by any test.

## 8. Unresolved defects (see `audit/ROUND2_BROWSER_TESTS.md` on #525 for file and line)

| Id | Severity | Defect | Owner PR |
|---|---|---|---|
| W1 to W3 | High | Job card save zeroes stored parts cost | #528 (first fix pushed, hardening in progress) |
| C1 | High | Workshop Supervisor cannot reach `/actions` | #520 (fixed, draft `102000`) |
| C2 | Medium | Submitter closes own action through the exception link | #520 (in progress) |
| W4 | Medium | Technicians have no web screen for assigned jobs | #519 (in progress) |
| K1 | Medium | Acknowledged checklist shows "Pending approval" | #520 (in progress) |
| A1 | Medium | New panels English only in Arabic | #520 (in progress) |
| W5 to W9, C3 to C6, K2 to K4, A2 | Low | Listed in the report | #519, #520, #528 |

Other open items
- iPhone (#523) and Flutter (#507): no real device test. Push has never delivered (no FCM tokens).
- PDF (#527): phone approvals are not prepared until a web visit; bulk ZIP covers the inspections
  register only; corrective action and job card reports not wired.
- AI: accuracy is Not Tested. No accuracy claim may be made. Validation plan is on #510.
- Backups: the nightly snapshot covers 7 small tables; the platform backup plan is unconfirmed.
- 12 failed webhook deliveries were test subscriptions pointing at the product site; guard is on #509.

## 9. Production risks

1. ERP confirmation direct-call hole: CLOSED by the interim lock (section 4). Decisions stay unavailable until action 4.
2. Job card form zeroes parts cost on main today (#528). Production audit log, last 120 days: 0 job
   cards affected so far.
3. Recovery beyond row snapshots is unconfirmed.
4. All fixes are drafts: nothing off-production is a fix in production until applied and re-checked.

## 10. Rollback

- Code: revert the merge commit of the PR. Vercel redeploys main.
- SQL: each draft header holds its rollback. ERP action 4 has a separate rollback file that restores
  md5 `272f785a2a32256bfe2b83b99d131c1b` with rows byte identical (verified on staging).
- Interim lock: the three GRANT statements in section 4.

## 11. Recommended next steps, in order

1. Done: interim ERP lock applied and verified (section 4).
2. Release review of #528 once its hardening and browser regression are green. It fixes a live bug and needs no SQL.
3. #520 and #519 after their defects above are closed and the renumbering is done. Apply their drafts only after #528 is live.
4. #526 actions 2 to 4 after the owner's approval of the approval pack.
5. #527 after a test against real storage (needs hosted staging).
6. Retarget #505 to #511, #513 and #517 from the #504 branch to main, one at a time.
7. Commercial: #506, #518, #510 in that order, enforcement switches off, current company grandfathered.
8. Real device pass for #507 and #523 before any store step.

## 12. Running log

- 2026-11-15, first version. Seven agents running: work orders (#519), closure and checklists (#520),
  PDF (#527), parts cost hardening (#528), ERP completion (#526), Flutter and iPhone (#507, #523),
  tenancy (#518). Interim lock evidence complete (section 4). Draft `20261116102000` added to #520.
- 2026-11-15 12:08 UTC. Interim ERP lock applied to production on the owner's explicit approval and verified. No other production change.
