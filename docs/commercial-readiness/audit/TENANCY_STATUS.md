# Tenancy status (TEN-1 to TEN-13)

Date 2026-11-15. Branch `claude/commercial-blockers-7rxp2t`, draft PR #518.
**Nothing was applied to production. Production was not written to. Single-company mode stays on and plan
enforcement stays off everywhere except the local staging copy.**

Every "Verified Fixed" below means: verified on a local PostgreSQL 16 copy with three synthetic companies
(Alpha stands in for the current company, Beta is a second company, Gamma is an empty third). It does not
mean verified on production (PostgreSQL 17.6), on a hosted Supabase project, through PostgREST or in a client.

## Run of 2026-11-15 (after merging main into the branch)

`/usr/bin/python3 supabase/tests/multi_company_sequence/run_sequence.py --db tp_saas2`

| Check | Result |
|---|---|
| Drafts applied in order | 30 of 30 (29 sequence steps and the HOLD step) |
| Steps that changed any of the 191 current-company facts | 0 |
| Round 2 draft tests (TEN-6b, 7c, 8b, 9b, 9c) | 87 of 87 pass |
| Company isolation tests, sections ISO-a to ISO-g (new) | 85 of 85 pass |
| First use of the empty company (new) | 8 of 8 pass |
| Total in the runner | 180 of 180 pass |
| Staging isolation suite (`supabase/staging/tests/run_tests.py`, PR #508) on the final database | 35 of 35 pass |

Before the four new drafts were added the same runner gave 26 of 26 applied and 87 of 87 tests, as recorded
in `MULTI_COMPANY_MIGRATION_SEQUENCE.md`.

## Findings

| Id | Finding | Status | Evidence | Draft file(s) | Owner decision needed |
|---|---|---|---|---|---|
| TEN-1 | A job card import could overwrite another company's work order; work order number unique across all companies | Verified Fixed (staging) | staging suite: not reproduced | `20261113100000`, `20261113100500` | none |
| TEN-2 | Raw upload tables readable across companies | Verified Fixed (staging) | staging suite: not reproduced | `20261113101000` | none |
| TEN-3 | Platform tables writable by a company Admin | Verified Fixed (staging) | staging suite: not reproduced; ISO-e (plan catalogue and switch unchanged after 12 attempts) | `20261113102000` | none |
| TEN-4 | Admin functions acted on other companies' users | Verified Fixed (staging) | staging suite: not reproduced; ISO-d (10 tests: cannot read, change, pull or move employees across companies) | `20261113103000`, `20261113114000` | none |
| TEN-5 | A customer Admin could change the own plan and limits | Verified Fixed (staging) | ISO-e: 6 of 6. Subscription row, organisation plan columns, plan catalogue and enforcement switch identical after 12 write attempts; ordinary company fields still editable | `20261113104000`, `20261113114500` | none |
| TEN-6 | Plan limits not enforced | Verified Fixed on staging with the switch ON; ships OFF | TEN-6b tests (21). Current company on the `internal` plan, no limits, above the trial caps, refused nothing with the switch on | `20261113110000`, `20261115160000` | When to turn enforcement on. The guarded function refuses while the current company would be limited |
| TEN-7 | Second company shaped by global configuration (role matrix, mailbox keys, aliases) | Verified Fixed (staging), one part open by design | TEN-7c tests (16); ISO-b. Built-in role defaults stay shared on purpose | `20261113111000`, `20261113115000`, `20261115161000`, COM `150000` to `156000` | D1: does a new company inherit the built-in defaults live, or start from a copy (`admin_seed_org_role_matrix`) |
| TEN-8 | Sign-ups and service loads fall back into the first company | Verified Fixed on staging with single-company mode OFF; ships ON | TEN-8b tests (27). With the mode on, a sign-up with no invitation still lands in the current company, as today | `20261113112000`, `20261115162000` | When to turn single-company mode off (needs the invitation fields in the web and Flutter sign-up forms first) |
| TEN-9 | No company lifecycle: invitations, provisioning, suspension, sign-in that tells companies apart | Invitations, provisioning, sign-in resolver: Verified Fixed (staging). Per-company usernames: **Blocked** (HOLD) | TEN-9b tests (13), TEN-9c tests (10), ISO-d | `20261113113000`, `20261115163000`; HOLD `20261115169000` | Approve the HOLD file only after sign-in on web and Flutter is tested on a hosted staging project. It is the point of no easy return |
| TEN-10 (new) | A user of one company could create a file under another company's folder (name squatting; reads were already walled) | Verified Fixed (staging) | ISO-a: 19 of 19. Reproduced without the draft (foreign-folder upload accepted), refused with it | `20261115164000` | none |
| TEN-11 (new) | One AI month budget and one spend figure for all companies: one company could use up another's AI | Orchestrator path: Verified Fixed (staging). chat-ai, tyre photo worker: **Not Tested, not fixed** (edge function code) | ISO-c: 16 of 16. Current company never gets a company cap | `20261115165000` | AI allowance per plan (`subscription_plans.features.ai_monthly_budget_usd`) or one platform default |
| TEN-12 (new) | Administrative actions carried no company and were readable by a super admin only | Verified Fixed (staging) | ISO-g: 9 of 9 | `20261115166000` | none |
| TEN-13 (new) | A company could not export its own data without the platform owner | Read-only export: Verified Fixed (staging). Purge: **Blocked** (HOLD) | ISO-f: 17 of 17. Purge is not callable from the application; dry run removes nothing; the current company is refused | `20261115167000`; purge function is part of `20261113113000` | Whether and when a company's data may be removed, and the retention period before it |

## What the new tests cover

- **ISO-a files and photos (19).** Own-folder upload works; a foreign company folder is refused in vehicle,
  tyre, inspection and accident photos, import files and workforce evidence; paths the apps write today still
  upload; other companies and an anonymous caller read nothing; another company's Admin cannot rename or remove.
- **ISO-b accident notifications (8).** A second-company accident notifies second-company users only; no queued
  mail or push carries the current company's mailbox; the second company has no mailbox until it sets one; the
  current company keeps its mailbox; the third company receives nothing.
- **ISO-c AI (16).** Usage rows and budget notes are read per company; spend is counted per company; one company's
  spend does not use up another's budget; the current company has no company cap; a plan allowance caps only
  that company; a company Admin cannot raise the own allowance.
- **ISO-d invitations and identity (10).** Own invitations only; cannot revoke or move another company's
  invitation; token stored hashed; no cross-company employee read, change, pull or self-move; no self-promotion
  to platform super admin.
- **ISO-e plan and limits (6).** See TEN-5.
- **ISO-f export and offboarding (17).** See TEN-13.
- **ISO-g administration record (9).** Invitation, role matrix change, role change, export and plan change are
  recorded with actor and company; no token and no e-mail in the record; it cannot be edited, removed or forged;
  a Manager and another company's Admin read none of it.
- **GAMMA first use (8 checks covering 29 tables and 28 functions).** The Admin of the empty company reads 29
  core tables (0 rows, no error) and calls 28 screen functions (no error, no other company named), sees one
  employee and one company, and its first site and vehicle land in its own company, unseen by the others.
  This is proof at SQL level through row security, not a rendered screen.

## Blocked on owner decisions

1. HOLD `20261115169000` per-company usernames (TEN-9). Global username and employee id keys are NOT removed.
2. Plan enforcement switch (TEN-6) and single-company mode (TEN-8): both stay as shipped.
3. Company purge (TEN-13): not exercised beyond a dry run.
4. D1 role matrix inheritance (TEN-7).
5. AI allowance per plan (TEN-11).

## Not Tested

- Anything on production, a hosted Supabase project, PostgREST, real Auth, real Storage or the edge functions.
  The storage test writes rows into `storage.objects` under row security; no file was uploaded through the
  Storage API.
- chat-ai and ai-tyre-inspection month budget (computed in the edge function across all companies) and the
  tyre photo daily budget table (one row per day for the platform). Not changed.
- File paths with no company prefix (`accidents/<id>/...`): reads are walled by owner, the name can still be
  taken by another company that knows the record id.
- Web, Flutter and Expo clients against the after-state. No client calls `org_export_page`,
  `get_org_admin_audit`, or sends `invite_token` or `company_code` yet.
- Mail actually leaving the platform: the test reads the queue, it does not deliver.
- Timing on production-sized tables (the storage folder rule adds one function call per object row read).
