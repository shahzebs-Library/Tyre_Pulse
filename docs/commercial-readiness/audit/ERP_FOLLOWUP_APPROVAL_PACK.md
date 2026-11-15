# ERP job card confirmation: approval pack

Date: 2026-11-15. Branch `claude/erp-followup-v2-7rxp2t` (from main `d1d58f66`). Draft only.

**Nothing in this pack has been applied to production.** No `apply_migration` was called and no
production write was committed at any point. Production was read with SELECT statements, and two
dry runs were executed inside a transaction that ends in a deliberate error, so every statement
was rolled back. Evidence, read after the last dry run:

| Check on production | Value |
|---|---|
| Latest migration | `20261115090615` (unchanged) |
| `observation_erp_decide` md5 | `272f785a2a32256bfe2b83b99d131c1b` (unchanged) |
| EXECUTE on decide and both wrappers | owner, `authenticated`, `service_role` (unchanged) |
| Position service functions | 0 |
| New tables | 0 |
| Columns on `observation_erp_links` | 11 (unchanged) |
| Policies on the two ERP tables | 6 (unchanged) |
| Links / history rows | 0 / 0 |
| Corrective actions | 180 |

Statuses used below: Verified Fixed, Verified Failed, Not Tested, Blocked.

## Production actions, in order. Each needs the owner's decision.

| # | Action | File | Reversible by |
|---|---|---|---|
| 1 | Interim restriction: nobody can record a decision through the API | APPLIED to production 2026-11-15 as `supabase/migrations/20261115120856_observation_erp_confirm_interim_lock.sql` | owner approval only; action 4 re-grants with the corrected rules |
| 2 | Layout history and per-layout mapping tables | `20261116085000_tyre_layout_versions_and_position_mappings.sql` | header ROLLBACK (only while the tables hold nothing worth keeping) |
| 3 | Position service (functions only) | `20261116090000_tyre_position_service.sql` | header ROLLBACK |
| 4 | Corrected decide function, permissions, exception, deliberate re-grant | `20261116091000_observation_erp_decide_on_position_service.sql` | `20261116091000_observation_erp_decide_ROLLBACK.sql` |
| 5 | Deploy the web client from this branch | (code) | redeploy main |

Action 1 can be approved alone and today. Actions 2 to 4 belong together. Action 5 is safe before
or after 2 to 4: the client offers no decision until the database reports the same rules version.

## Action 1. Interim restriction

**Why.** The live function checks company, country and role but not site, and matches wheels from a
fixed table that is wrong for some vehicles. Hiding Confirm in the web client does not stop a
direct, signed-in API call.

**What was read on production.** `observation_erp_decide` is SECURITY DEFINER. Both wrappers
(`confirm_observation_erp_link`, `reject_observation_erp_link`) are SECURITY INVOKER, so they need
the caller's EXECUTE on the decide function. All three have the same ACL:
`{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. `anon` and PUBLIC have
none. No other function in `public` calls them.

**What it does.** One statement group: three `REVOKE EXECUTE ... FROM authenticated`. No function
body change, no table change, no row change, nothing removed.

**Who loses what.** Every signed-in user loses the ability to record a Confirm or a Reject (Reject
goes through the same function). In practice that is the accounts that pass the live function's
own gate today: 5 approved, unlocked accounts (2 Admin, 3 Manager; 0 Director). The 2 super admins
are among the Admins. The other 763 approved accounts could not record a decision before either.
`service_role` and the owner keep EXECUTE.

**What still works.** Reading. Proven on staging for an elevated user under the lock: the lookup
reads (work orders, tyre records, corrective actions, fleet, inspections) and SELECT on both ERP
tables return the same counts as before.

**What the client shows.** PostgreSQL answers `42501 permission denied for function ...`;
PostgREST passes the SQLSTATE through (HTTP 403). The client maps that, and a missing function
(`PGRST202` / `42883`), to the agreed message below, never a raw error. In practice the client
never gets that far: it offers no decision because `observation_erp_rules()` does not exist yet.
PostgREST itself was not run on staging; the 42501 was observed in SQL as the `authenticated` role.

**Rollback.** The three GRANT statements in the file header. They restore the same ACL entries
(PostgreSQL lists a re-granted entry last, so the text order differs; the privileges are the same).

**Later.** Action 4 grants EXECUTE again on all three, on purpose, in the same transaction that
installs the corrected rules.

**Staging result (37 checks, all pass):** ACL before equals production; after, only owner and
`service_role`; all 4 paths (decide confirm, decide reject, both wrappers) refused with 42501 for
Manager, Director, Admin, super admin, Tyre Man and another company's Admin (24 checks) and for
`anon`; `service_role` keeps EXECUTE; function md5s unchanged; link, history and business rows
byte-identical; rollback restores the ACL; lock followed by action 4 ends with the production ACL
and a working Confirm. Status: **Verified Fixed on staging. Not applied.**

## Actions 2 to 4. What each file does

**`20261116085000` (tables).**
- `vehicle_diagram_config_versions`: every state of an admin-designed layout with `valid_from` /
  `valid_to`. A trigger on `vehicle_diagram_configs` closes the open version and opens a new one
  on every edit. History is append-only (a trigger refuses any other change). Existing layouts
  (0 in production) would get one opening version marked `backfill`.
- `tyre_layout_position_mappings`: per layout, "this ERP spelling means this wheel", with who
  verified it and written evidence. **Ships empty.** Admin may add or switch off; never rewrite.
- Policies: company wall on both, read for active users, insert/update on mappings for Admin.
- Ends with the reporting bot's policies (`anum_integration.apply_reader_policies()`).

**`20261116090000` (position service).** 13 functions, no table. Resolves an inspection slot or
an ERP code on the vehicle's layout **as of a date**. No universal "rear centre / rear rear"
reading: `LHRCO`-type spellings are pending on every layout. On concrete pump layouts **no rear
ERP code at all** is read without a verified mapping (see Pump layouts). The two helpers that take
a company id are closed to signed-in users.

**`20261116091000` (decide).**
- `observation_erp_evaluate`: read-only verdict. Confirm is offered only when the same wheel moved
  on that job card on or after the inspection. A matching serial alone is reported as support,
  never as eligibility.
- Two nullable columns on each ERP table (`position_evidence`, `exception_basis`).
- `observation_erp_decide`: same signature and same five-key result as live. Checks inside the
  function: signed in, company, approved and unlocked, reviewer role, country, site (action,
  inspection and job card), job card number, dates.
- `observation_erp_rules()`: read-only; returns the rules version and what the caller may do.
- `request_` / `approve_` / `close_observation_erp_serial_exception` and table
  `observation_erp_exception_requests`: the documented serial exception, always two different
  people (request, then independent approval or refusal).
- Grants: deliberate re-grant on decide and both wrappers; reader policies.

## Function md5 as each would be installed (from staging)

| Function | md5 |
|---|---|
| `observation_erp_decide(uuid,uuid,text,text)` | `10ce51c4b5d0ad96444976bbfca74a79` |
| `observation_erp_decide_core(uuid,uuid,text,text,text,uuid,text)` | `9f8493a9b0f1614cec650e34e6f9670c` |
| `observation_erp_evaluate(uuid,uuid)` | `3149ce2d86aa9648656e50ae16ebd120` |
| `observation_erp_rules()` | `fbd7aa5c668817191f9186c3823cf235` |
| `request_observation_erp_serial_exception(uuid,uuid,text)` | `099e6dc0dd39b48d849e07d699f331d0` |
| `approve_observation_erp_serial_exception(uuid,text)` | `8f6d8f0eb7cf8d2142f4cca3abd76406` |
| `close_observation_erp_serial_exception(uuid,text,text)` | `b32fae1395e84e64c755b95445d05f50` |
| `observation_erp_exception_requests_guard()` | `2e9f8c6a4c82281a25ad730259e4abc1` |
| `confirm_observation_erp_link(uuid,uuid,text)` (untouched) | `479f5400cf932e246c748909733be801` |
| `reject_observation_erp_link(uuid,uuid,text)` (untouched) | `f3109e20f4628824f4ecd90bd836e289` |
| `tyre_asset_layout(uuid,text,text,text,date)` | `21d7980c703e4cb3baca5b10c0b05f3a` |
| `tyre_type_layout(uuid,text,text,integer,date)` | `7690de2473385d5fd7009d65cf9eb4fe` |
| `tyre_layout_for(text,text,integer,jsonb,date,date)` | `97d14b2b93cca41c67a05aa264a9e735` |
| `tyre_layout_builtin_wheels(text)` | `d2eab94a82679cc78a473cd7143ac7cb` |
| `tyre_layout_custom_wheels(jsonb)` | `e3fcb3343446b388297e9557cc350c3c` |
| `tyre_layout_key(text,text,integer)` | `bfa56c08389fc31834255181e861eab7` |
| `tyre_layout_key_one(text)` | `82ca779bc7612f5195fcd6707c325968` |
| `tyre_position_resolve(jsonb,text,text)` | `03b837646ce9febef61bd08e25638295` |
| `tyre_position_compare(jsonb,text,text)` | `79cfc19d46e8038bad7f5feba716747d` |
| `tyre_position_parse(text)` | `c16a6f8dbd760376f93e92bca4de6fc7` |
| `tyre_position_canonical_code(text)` | `af630133bf04f203825debfafadfe00b` |
| `tyre_position_token(text)` | `5a79aacfba09faf46d4bc945e0100c79` |
| `tyre_type_is_tyreless(text)` | `465a65e9c79a118593490a03408c5027` |
| `vehicle_diagram_config_versioning()` | `461c77e3cef912af18d503517c6d2d08` |
| `vehicle_diagram_config_versions_guard()` | `8f400b33a54a2d1230bb7d3a91f75a45` |
| `tyre_layout_position_mappings_guard()` | `2487d97967249ede00aa94b93835e1b4` |

After the rollback file: `observation_erp_decide` = `272f785a2a32256bfe2b83b99d131c1b` and ACL
`{postgres=X/postgres,service_role=X/postgres}` (the interim lock stays). Values above re-measured
on a staging copy on 2026-11-15 (rules version `position-service-3`).

## Staging tests

`supabase/tests/staging/observation_erp_position_tests.py`, local database only, synthetic data,
one transaction, always rolled back. **312 checks, 312 pass** (re-run 2026-11-15 on rules version
`position-service-3`), plus the permission probes counted inside the matrix checks.

| Section | Checks |
|---|---|
| Position by layout type, serial, rules version | 53 |
| Confirm refused unless offered | 27 |
| Company, country, site, role, grants | 44 |
| Confirm, reject, history | 16 |
| Documented serial exception (two people) | 65 |
| Permission matrix | 7 |
| Layout versions | 17 |
| Per-layout mappings | 13 |
| History not rewritten | 3 |
| Follow-up on top of the live function | 19 |
| Rollback file end to end | 10 |
| Interim lock | 38 |

Other tests: SQL and JavaScript mirror on one fixture (10 vitest, 4 PGlite); 272 vitest tests in
the 13 related files, including the client availability cases.

## Permission matrix (staging)

2 companies x 7 roles x own/other country x own/other site x active/locked/unapproved = 168
cells, each tried with evaluate, confirm, reject, request exception and approve exception = **840
probes: 19 allowed, 821 refused, 0 wrong** (re-run 2026-11-15). Allowed: own company, Admin / Manager / Director, active, own country, and own site
(an Admin sees every site of the company by design; countries follow the profile for everyone).
Also verified: a reviewer switched off in Access Control (corrective_actions / approve) is
refused; not signed in is refused; a super admin may review.

**Role source.** The reviewer set is the existing elevated set (Admin, Manager, Director) minus
anyone switched off in Access Control. The existing engine can take a reviewer away per company or
person; it cannot add a non-elevated role as a reviewer, so that is not offered.

## Documented serial exception

A matching serial never confirms. When the wheel cannot be placed and the observed strong serial
is on the job card with a dated movement, a documented exception is possible, and it always takes
**two different people**. A reviewer requests it with a reason of at least 20 characters; that
links nothing. A different person who holds the capability `corrective_actions /
erp_serial_exception` (by default only Admin and super admin; grantable per company in Access
Control) approves or refuses it. The requester can never approve or refuse their own request,
whatever their role (checked in the functions, in the one writer and by a table constraint); the
requester may withdraw it. The evidence is evaluated again at approval for the approver's own
company, country and site. Request, approval, refusal and withdrawal keep who, when and why in
`observation_erp_exception_requests`; an approved link and its history row store
`exception_basis = 'serial_only'` and the request id. Staging: 65 checks, including the same
person refused as approver for every role tested (Admin, super admin, granted Manager) and an
approver outside the action's site refused.

## Reporting bot

`apply_reader_policies()` runs at the end of files 085000 and 091000. Staging: 4 reader policies
on each of the 4 tables (16), the 6 live policies unchanged. Production has none on the two live
tables today.

## Rollback verification (staging)

live migration, then synthetic link and history rows written by the live function, then the
follow-up, then the rollback file: function md5 equals production
(`272f785a2a32256bfe2b83b99d131c1b`), both wrappers byte-identical throughout, link and history
rows byte-identical at every step, business rows unchanged. 8 checks pass.

## The seven possible ERP matches (production, rolled back)

20 open inspection damage actions; 7 have a later tyre movement on a job card that exists (9
action and job card pairs). The whole draft (actions 1 to 4, without the reader-policy call) was
created inside one transaction and each pair was evaluated as a KSA Manager of that company. The
transaction ended in a deliberate error and rolled back. All 24 function md5 prefixes equalled a
staging run of the same text, so what ran is what is in the files.

| Outcome (7 actions) | Dry run | With the final pump rule |
|---|---|---|
| Offered for review | 1 | 0 |
| Pending manual review | 3 | 4 |
| Different wheel | 3 | 3 |
| No evidence | 0 | 0 |

Nothing written: links 0 before and 0 after, history 0 and 0, md5 over all corrective actions and
over all tyre records identical before and after.

The right-hand column: after the dry run, the pump check below showed that the one offered match
is a 5-axle pump whose ERP row uses a numbered rear code. The rule was tightened so that case is
pending. The tightened rule is **Verified on staging; Not Tested on production** (the dry run was
not repeated). A read-only query confirmed that exactly 1 of the 7 is a pump with a numbered rear
ERP code, so 0 / 4 / 3 is the expected result.

One observation from the first dry run: a super admin with no country on the profile was refused
on country scope in a plain SQL session (`is_super_admin()` returned false there). Worth a check
with a real super admin sign-in after action 4.

## Pump layouts (production, read-only, counts only)

Fleet: 144 pumps (50 with 5 axles, 10 with 4, 84 with no axle count), 5 line pumps, 20 spider
pumps, 11 stationary or placing. Admin-designed layouts: 0.

ERP rear spellings on tyre rows of 5-axle pumps (47 assets with rows):

| Spelling | Assets | Rows |
|---|---|---|
| rear centre (`xHRCO` / `xHRCI`) | 44 / 43 | 160 / 149 |
| rear rear (`xHRRO` / `xHRRI`) | 39 / 38 | 161 / 142 |
| numbered `xHR1-I` / `xHR1-O` | 36 / 15 | 115 / 43 |
| mixer style `xHCO` `xHCI` `xHRO` `xHRI` | 5 to 7 each | 15 to 22 each |
| front `xHF1` / `xHF2` | 47 / 47 | 199 / 174 |

33 of the 47 carry exactly 10 different rear codes. 4-axle pumps (10 assets) mostly use the mixer
style spellings; 3 of them use numbered and rear centre together. No pump row uses a third front
axle code.

**What this shows.** On the same 5-axle machine the ERP uses "R1", "rear centre" and "rear rear"
side by side, and never a third front axle. So the ERP's "R1" is very likely not the first rear
axle of the app drawing (which has three front axles and two rear). **What cannot be verified
from data:** which physical axle each spelling is. That needs the axle diagram and a few known
replacements checked by someone at the workshop. No mapping is assumed in code or SQL; rear ERP
codes on pump layouts stay pending until an Admin records a verified mapping for that layout.

## Client message

Shown when the database does not report the client's rules version (function missing, version
mismatch, or the check failed), and when a decision call is refused because the function is
withheld:

> ERP confirmation is not available yet. Evidence can be reviewed, but a decision cannot be recorded until the database update is approved.

Evidence lookup stays. No Confirm or Reject is offered. Tests cover: old database, new database
same version, version mismatch (either side ahead), unknown failure, still checking.

## Remaining risks

1. The tightened pump rule was not re-run on production (above).
2. PostgREST was not run on staging; the refusal code under the lock is from SQL as the API role.
3. Pump rear wheels cannot be confirmed at all until someone verifies a mapping per pump layout.
4. 84 pumps have no axle count; they are read as the 5-axle drawing.
5. Layout history starts at action 2. A layout that existed before it has no earlier history; a
   record older than its first known version is pending, not guessed.
6. The exception relies on Access Control data being right for the company.
7. `apply_reader_policies()` re-creates policies on every table and takes a short lock on each;
   run actions 2 and 4 at a quiet time.
8. Until action 1 is applied, a signed-in Admin or Manager can still record a decision with the
   live function by calling the API directly.
