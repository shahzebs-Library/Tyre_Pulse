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

Work order costs and closure (owner, final, 2026-11-15)
- A genuinely additional part increases the job card total (imported 1,775.82 + verified 20.00 = 1,795.82),
  but the imported ERP baseline is never replaced or overwritten.
- Four separate things: imported cost, additional costs, approved adjustments, calculated total.
- Every cost entry has source, currency, amount, approval status, who, when and why.
- An unapproved cost is not approved expenditure and does not enter approved totals, CPK or cost reports.
- If the schema cannot tell whether a new part is already inside the imported amount, the entry stays
  PENDING RECONCILIATION. No guessing. Reports never count the same part twice.
- Technicians and Tyre Men mark assigned work "Work Completed / Submitted for Review". That is not final
  closure. A Supervisor, Manager or Tyre Engineer with company and site rights approves final closure.
  The two are separate events with timestamps, evidence and responsible users.
- Data Monitor Officer: no unrestricted closure. Monitoring, verification, reconciliation, reporting only.
- A generic Access Control grant never bypasses mandatory financial approval or closure controls.
- Tyre Data Collector: draft costs and supporting information on assigned work only. No cost approval,
  no change to locked approved records, no final posting.
- RELEASE RULE: the cost ledger must be reliable before #528 and the work order permissions (#519) are
  released. They go out together, not #528 alone. #519 now contains #528 and must merge after it.

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
2. #528 and #519 together, only after the work order cost ledger (in progress on #519) is built and tested and the round 3 browser regression is green. Order: merge #528, merge #519, deploy web, then apply `20261113130000`, `20261115140000`, `140500`, `141000`, `141500` and the ledger drafts (`1420xx`).
3. #520: web build first (works without drafts), then `20261116100000`, `101000`, `102000`.
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
- 2026-11-15. #528 hardened (`2efd49d8`): edit sends only changed fields (`jobCardEditPatch` in `src/lib/jobCard.js`); browser proof for imported and approved-cost cards as Admin and Manager; 115 related tests pass. Production counts: 7,099 job cards have a parts cost and no lines; 0 have lines. Open owner question: adding a line to an imported card ADDS to the stored cost (not replaces). The protection is client side only; the database rule is in #519 drafts.
- 2026-11-15. #519 (`6375c939`): drafts renumbered to `20261115140000 / 140500 / 141000`, new `141500` (collector removed from cost approvers); new `/my-jobs` screen for technicians; new `close` right (managers, supervisors, tyre engineers); Tyre Data Collector limited. Staging matrix 238 of 238; 941 related tests pass. Not tested in a browser yet. Write-up: `docs/commercial-readiness/audit/WORKORDER_ROUND2.md` on that branch.
- 2026-11-15. #520 (`7a0298be`): exception is now request + independent decision (`corrective_action_request_exception`, `corrective_action_decide_exception`); "Acknowledged, Action Required" everywhere; new `closure` dictionary en + ar (140 keys); staging 75 of 75; 1,077 related tests pass. Phone apps do not yet know `exception_requested` or `acknowledged`. Write-up: `docs/commercial-readiness/audit/CLOSURE_ROUND2.md` on that branch.
- 2026-11-15. Browser regression for #519, #520, #528 started on the #525 branch; results will be `docs/commercial-readiness/audit/ROUND3_BROWSER_TESTS.md` there, including the merge conflicts met when the three branches are combined.
- Open owner questions added this round: supervisor always closes a job (built that way)? Data Monitor Officer same limits as the collector? Collector may enter costs on a job with no approval? Workshop Supervisor a final checklist signer by default? Bar the person who raised an action from deciding its exception? Switch off direct closing once phones are updated?
- 2026-11-15. Owner's final work order decisions recorded (section 5). Work order agent resumed on #519: cost ledger first, then technician completion vs final closure, Data Monitor Officer limits, collector draft costs. ERP lock re-verified active: migration `20261115120856` still latest, ACL `{postgres,service_role}` on all three functions, hashes unchanged, 0 links, `single_tenant_mode` true.

## 13. Merge round, 2026-11-15 12:20 to 13:00 UTC (owner authorised merging completed, verified PRs)

### Merged to main
| PR | Squash commit | What | Checks |
|---|---|---|---|
| #518 | `f11e18f26e021e14a9f918994b709f4b14e07442` | Recall Tracker sends ONE country (the profile's country list was refused by the database). Tenancy and leak drafts TEN-6 to TEN-13 added to `supabase/pending_migrations/` only. | All 7 CI jobs green on head `8f5eddc9` (web lint + tests + database tests + build, mobile, marketing, report engine, analytics, CodeQL js + python). Staging: 30 of 30 drafts applied, 0 of 191 current-company facts changed, 180 of 180 tests; isolation 35 of 35. |

Nothing else was merged. After the owner's later instruction ("prepare merge-ready reports, do not merge
automatically") no further PR is merged without a fresh owner decision.

### Deployed
- Vercel production workflow run `43714327126` deployed `f11e18f2` (success). Web only.
- The Recall Tracker module is still switched off in production, so no user sees the fix until it is turned on.

### Production database after the merge (verified read-only)
- Latest migration still `20261115120856 observation_erp_confirm_interim_lock`; 1,091 migrations (unchanged).
- ERP lock active: `observation_erp_decide`, `confirm_observation_erp_link`, `reject_observation_erp_link`
  ACL `{postgres,service_role}`, hashes unchanged; 0 links; `single_tenant_mode` = true.
- Evidence that a merge cannot apply migrations: repo files such as `20261115120000` and
  `20261112198000` have been on main for days and their versions are not in
  `supabase_migrations.schema_migrations` (production records MCP-applied timestamps only). No workflow runs
  `supabase db push`; `deploy-edge-functions.yml` is manual.

### PRs updated this round (still open, not merged)
| PR | New head | State | Why not merged |
|---|---|---|---|
| #519 | `1427a801` | Contains #528. Cost ledger finished: imported `parts_cost` never changed by a form; added parts become ledger entries (draft, reconciliation, independent approval, immutable, refunds only of approved costs). Without draft `20261115142000` the ledger says "not available" and writes nothing. Staging: all 6 work order drafts applied, 305 of 305 cases, stored work orders md5 unchanged. Web: 307 related tests, lint, build clean. Conflict-free with main. | Behaviour change for current users (closure rights, My Jobs, ledger) needs the owner's go; the owner rule is #528 and #519 together and only after the round 3 browser regression, which did not finish. Not browser-tested. |
| #528 | `2efd49d8` | Green CI, conflict-free. | Owner rule: release together with #519. #519 already contains it; merging #519 merges #528. |
| #520 | `b29f2572` | Merged main twice (conflicts resolved). New `closureSafeDegrade.test.js` (28 cases) proves screens work with drafts unapplied. 626 of 627 related tests (the one failure is `checklistIcons`, needs `mobile/node_modules`, passes in CI). Lint 0 errors, build clean. Conflict-free with main. | Not browser-tested this round; owner questions open (section 12). Wait for CI on `b29f2572`. |
| #524 | `6562f42b` | Conflicts with main in drafts README and `vercel.json`. | Readiness check interrupted (usage limit). |
| #526 | `094f2c1b` | Clean vs main. | ERP actions 2 to 4 not approved; completion work interrupted. |
| #527 | `015bafdd` | Clean vs main. | Real-storage test not done; round 2 interrupted. |
| #523, #507 | unchanged | Flutter. | Real-device pass not done; no store step without the owner. |
| #525 | `9375c338` | Evidence branch; conflicts with main. | Round 3 browser regression interrupted. |
| #504 | this branch | Parked; conflicts with main in drafts README only. | Readiness check interrupted; not browser-tested. |
| #505, #506, #508 to #511, #513, #517 | unchanged | Based on the #504 branch. | Need retargeting to main one at a time. |

### Unfinished agent work saved (UNVERIFIED, do not merge as-is)
All background agents stopped on a model usage limit. Their uncommitted changes were committed and pushed so
nothing is lost. Each is a work-in-progress commit on top of the PR head; review, test and fold into the PR.
| Branch | Head | Contents |
|---|---|---|
| `claude/wip-526-erp-7rxp2t` | `ed3efe24` | Moves the applied lock file to `supabase/migrations/20261115120856_...` with an APPLIED header; evidence panel and position service edits; drafts 091000 edits. |
| `claude/wip-527-pdf-7rxp2t` | `73bf40da` | Real-storage browser harness `e2e/pdf-storage/` (not run). |
| `claude/wip-525-browser-tests-7rxp2t` | `25cb432d` | Round 3 browser specs (closure), setup edits; 11 unpushed commits included. |
| `claude/wip-523-ios-7rxp2t` | `fb1f61c2` | Small-phone cases in two Flutter tests. |
| `claude/wip-519-work-orders-7rxp2t`, `claude/wip-520-closure-7rxp2t` | | Superseded: their content is now in #519 and #520. Can be deleted. |

### Pending database migrations (none applied this round)
Order unchanged from section 6, plus `20261115142000_wo_cost_entries_ledger.sql` (after `141500`) and the
TEN-10 to TEN-13 drafts now on main (`20261115164000` to `167000`, HOLD `169000` last). The only shared number
across all branches is the deliberate pair `20261116091000` (apply file and its ROLLBACK file).

### Exact remaining tasks for Codex, in order
1. Wait for CI on #519 `1427a801` and #520 `b29f2572`; fix anything red.
2. Run the round 3 browser regression (`claude/wip-525-browser-tests-7rxp2t` specs) for #519 (contains #528)
   and #520: Admin, Manager, Workshop Supervisor, technician, Tyre Data Collector, Data Monitor Officer;
   imported card with stored parts cost; add a part; self-approval refused; Arabic.
3. Bring the results to the owner with a merge-ready report. Release order if approved: merge #519 (carries
   #528), deploy web, then apply `20261113130000`, `20261115140000`, `140500`, `141000`, `141500`,
   `142000` one at a time with rolled-back verification. Then #520, then its three drafts.
4. #524: merge main (README, `vercel.json`), finish the readiness review, prove safe without drafts.
5. #527: run `e2e/pdf-storage` against hosted staging storage; keep the client fallback.
6. #526: fold `claude/wip-526-erp-7rxp2t` in; keep the lock; actions 2 to 4 only on owner approval.
7. Retarget #505, #506, #508 to #511, #513, #517 to main one at a time; #510 keeps its marketing copy.
8. Flutter #507 and #523 real-device pass; no store step without the owner.

## 14. Round 3 completion, 2026-11-15 13:00 to 14:10 UTC (nothing merged, nothing deployed, no production change)

Production re-checked read-only at 14:08 UTC: latest migration `20261115120856`, 1,091 migrations, ERP lock ACL
`{postgres,service_role}` on all three functions, 0 links, `single_tenant_mode` true.

### Merge-ready decisions (owner approval required for every merge; no migration is applied by a merge)
| PR | Head | Decision | Evidence | Remaining risk | Deploy dependency |
|---|---|---|---|---|---|
| #519 (contains #528 and #511) | `d7f12edb` | READY for owner review | Browser round 3: 17 of 17 ledger/closure cases; round 2 work orders 9 roles 28 Verified Fixed, 1 Verified Failed (D3, now fixed in `d7f12edb`). Staging 305 of 305. 237 related web tests. CI green on `1427a801`. | Changes rights for current users once its drafts are applied; before that the ledger says "not available" and the form never changes `parts_cost`. Cost approvers are Admin and Manager; Workshop Supervisor closes jobs but does not approve costs (as drafted). | Merge, deploy web, then apply `20261113130000`, `20261115140000`, `140500`, `141000`, `141500`, `142000` in order. Close #528 and #511 as superseded when #519 merges. |
| #520 | `21fb8a1a` | READY for owner review after CI | D1 fixed (exception never offered on a never-submitted action) with regression case A03b; staging 76 of 76; browser actions 23 + checklists 12 Verified Fixed; safe-degrade test 28 cases. | D4 wording: closing while an exception is pending says "This record changed since you opened it" (database correctly refuses). Approve-exception path not browser-tested (was blocked by D1). | Merge AFTER #519; resolve `src/lib/checklistAccess.js` exactly as in `claude/round3-integration-7rxp2t` (one list of module-gated paths). Then apply `20261116100000`, `101000`, `102000`. |
| #524 | `f34ed341` | READY | 6 defects Verified Fixed with tests; 347 tests; CI green. Safe before its two drafts. | Arabic screens not browser-checked. | Text conflicts only with #519 (drafts README, `vercel.json`). |
| #526 web part | `6e9584fc` | READY (web only) | Lock file now byte-identical to production (md5 `01d5a77f60aac04bf505831078d0bab8`, read-only check); vitest 208, staging 312 + 840 permission checks, PGlite 315; CI green. | Panel not browser-tested; PostgREST HTTP not tested. | ERP actions 2 to 4 stay unapplied until the owner approves the approval pack. |
| #527 | `89a88986` | READY | No-draft gate: 26 tests + 16 browser checks. With drafts on a local copy: 157 SQL, 64 storage API, 20 browser checks. Repeat download 0.16 to 0.28 s vs first 1.3 to 2.7 s (local). CI green. | Observation PDF browser path and mobile not tested. | Drafts `20261117090000`, `091000` after owner approval; no paid service. |
| #523 | `e58b8014` | READY (code) | 12 new small-phone tests en/ar/ur; analyze clean; CI green. | One Linux-only golden noise (1.48%). | Real-device pass before any store step. |
| #507 | `claude/flutter-fixes-main-7rxp2t` `829ee103` | READY (code) | Rebuilt on main; 3,665 Flutter tests pass; 18 goldens are font noise (identical with the change removed). | Two drift tests need `mobile/` (CI runs them). | Real-device pass. Open a PR from the rebuilt branch, close #507. |
| #505 | `claude/console-main-7rxp2t` `875d5d1e` | READY for review | 380 console tests, lint, build. | | Open PR from rebuilt branch. |
| #506 | `claude/tenancy-main-7rxp2t` `f805b168` | READY for review (tests + doc only) | PGlite 372; its 13 drafts are byte-identical to main. | | |
| #508 | `claude/staging-main-7rxp2t` `239a59ad` | READY for review (tooling) | Syntax only; stack needs PostgreSQL 16. | | |
| #509 | `claude/prodb-main-7rxp2t` `db2ae914` | READY for review | Lint, build, 55 vitest, 32 ops tests. | Changes the `send-scheduled-reports` edge function source (deploy is manual). | Full `test:database` not run. |
| #510 | `claude/commercial-main-7rxp2t` `27fa89d8` | NEEDS OWNER | Lint, build, marketing 45 tests, commercial PGlite 22. | Marketing says "An iOS app is planned" although iOS is in review: wording decision. | |
| #511 | | SUPERSEDED by #519 | #519 contains its commit. | | Close when #519 merges. |
| #513 | | LEAVE FOR CODEX | Depends on #504's page refactors (`urlTab.js`, compliance and CPK pages). | | Decide #504 first. |
| #517 | `claude/workflow-main-7rxp2t` `9d5dc112` | READY for review (tests only) | Syntax only. | | |
| #504 | | NEEDS OWNER / REVIEW | Not browser-tested; carries this handover. | | |

### Defects still open (from browser round 3, `docs/commercial-readiness/audit/ROUND3_BROWSER_TESTS.md` on `claude/round3-integration-7rxp2t`)
- D2 (P3, already on main): `src/hooks/useRealtimeAlerts.js:295` two components open the same channel name `tp-db-notifications`; the second throws a page error. Fix: unique channel name per subscriber.
- D4 (P3, #520): wrong wording when closing with a pending exception.
- D5 (P3, accessibility): "Draw a new signature" link in `SignatureField.jsx` is 16 px tall at 390 px.
- Not tested: exception approval and "compliant by exception" in a browser; checklist viewer drawer label; Audit Pack tile with an author role; responsive reviewer panel.

### Recommended release order (each step needs the owner's go)
1. #524, #527 (web only), #526 web part: independent, safe without drafts.
2. #519 (closes #528 and #511), deploy, then its six drafts one at a time with rolled-back verification.
3. #520 with the `checklistAccess.js` resolution, then its three drafts.
4. #505, #506, #508, #509, #517 from their rebuilt branches.
5. #523 and #507 after a real-device pass. #510 after the wording decision. #513 after #504.
