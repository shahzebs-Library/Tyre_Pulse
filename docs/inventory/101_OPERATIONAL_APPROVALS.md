# 101 - Inventory operational approvals (owner decision pack)

Prepared 2026-11-21 from read-only production queries (`jhssdmeruxtrlqnwfksc`). **Nothing in this
document has been applied.** Every change below waits for the owner. Prepared SQL is in
`docs/inventory/101_prepared/` and must not be run until approved. The same tables are in
`101_OPERATIONAL_APPROVALS.xlsx`.

No email addresses or phone numbers are recorded here. People are named by display name and username.

---

## 1. Store Keepers (7) - site access and capabilities

All seven: company **Default Organisation (Company A)**, country **KSA**, role Store Keeper, approved,
not locked, current site access **ALL**, current stock capabilities **view only** (0 capability grants).

Proposed capabilities for an evidenced person: **receive, issue, transfer, count**. Never: any
approval, adjustment_approve, discrepancy_review, financial_post, scrap_approve, view_value
(unit cost), recount, audit_create. The database also refuses a Store Keeper as an approver by role
(`_inv_approval_extra_block`, 20261120113000), whatever is granted.

| Name | Username | Current sites | Proposed sites | Evidence | Proposed capabilities | Decision |
|---|---|---|---|---|---|---|
| MD JAHID | 10011207 | ALL | DIRIYAH | Stock entry request at DIRIYAH-ST2 (the DIRIYAH spare-parts store); audit rows on DIRIYAH | receive, issue, transfer, count | Owner to approve |
| SOMANATH NAYAK | SmNayak | ALL | NHC | 3 stock entry requests at NHC | receive, issue, transfer, count | Owner to approve |
| Wasim khan | Wkhan | ALL | RIY-MET, QIDDIYA-LOWER PLATEAU | Audit rows on RIY-MET and QIDDIYA-LOWER PLATEAU | receive, issue, transfer, count | Owner to approve |
| Hosham Homeda | Hhomeda | ALL | **Owner to name** | No site evidence (no stock request, no site in audit rows, no workforce record) | none until sites are named | Owner to name site |
| Mohammad Ansari | Mansari | ALL | **Owner to name** | No site evidence | none until sites are named | Owner to name site |
| Mohd Asad | Masad | ALL | **Owner to name** | No site evidence | none until sites are named | Owner to name site |
| MUHAMMAD NASIR HUSSAIN | muhammadnasir | ALL | **Owner to name** | No site evidence (was Tyre Data Collector until 2026-09-24) | none until sites are named | Owner to name site |

Prepared: `101_prepared/01_store_keeper_sites_and_caps.sql` - narrows the three evidenced people to
their sites FIRST (through `admin_set_user_sites`, audited), refuses to continue if any of them still
has all-site scope, then writes 12 grants. Exact rollback included. It replaces the all-seven,
all-site grant in `94_prepared/store_keeper_capabilities.sql`, which should **not** be run.

Note: a warehouse is an `inventory_location` under a site; there is no per-warehouse user table, so
the site is the narrowest enforceable scope.

---

## 2. 18 unmapped NHC stock lines

All 18 sit at site **NHC**, `item_id` null, `location_id` null (no bin), no unit cost.
**No inventory location exists for NHC yet** (`inventory_locations` has 0 NHC rows), so none of these
can be mapped until a location is created.

Path once approved (no SQL bypass; preparer and approver must be different people):
1. Create the NHC store location in Inventory -> Locations.
2. Inventory -> Controls -> Opening balance: create a batch for KSA / NHC (it collects these lines).
3. Map each line to the proposed material code below (`inv_opening_line_map`), submit.
4. An independent approver (not the preparer) decides (`inv_opening_batch_decide` refuses the preparer).

Match evidence "source link" = the line's own `custom_data.stock_item.source.source_id` already points
at that KSA material master row (reviewed, active, tyre category, not linked to any other line).

| # | Line | Original description | Qty | Location | Proposed code | Reviewed master description | Brand | Size / spec | Match evidence | Confidence | Approval status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | cf51b624 | TIRE 10-16.5 | 8 | NHC (no bin) | 221622-O | TIRE 10-16.5 | not stated | 10-16.5 | source link + exact text | High | Pending owner |
| 2 | 944991ff | TIRE 10-16.5/10 SKS-1 allainz | 2 | NHC (no bin) | 221564-O | TIRE 10-16.5/10 SKS-1 allainz | "allainz" as written (not normalised) | 10-16.5, 10PR, SKS-1 | source link + exact text | High | Pending owner |
| 3 | 87e7b5b1 | TIRE 11R22.5 TL 16PR | 7 | NHC (no bin) | 310612-O | TIRE 11R22.5 TL 16PR | not stated | 11R22.5 TL 16PR | source link + exact text | High | Pending owner |
| 4 | b5ed4037 | TIRE 195 R 15C-6PR NEW MODEL 2007 TOYOTA | 1 | NHC (no bin) | 140082-O | TIRE 195 R 15C-6PR NEW MODEL 2007 TOYOTA | not stated | 195R15C 6PR | source link + exact text | High | Pending owner |
| 5 | c776f54a | TIRE 195R15 6PR | 3 | NHC (no bin) | 221743-O | TIRE 195R15 6PR | not stated | 195R15 6PR | source link + exact text | High | Pending owner |
| 6 | 1f3469e1 | TIRE 205/85 R16 | 1 | NHC (no bin) | 223068-O | TIRE 205/85 R16 | not stated | 205/85R16 | source link + exact text | High | Pending owner |
| 7 | bc55afe2 | TIRE 205R16 /689 | 3 | NHC (no bin) | 310204-O | TIRE 205R16 /689 | not stated | 205R16 | source link + exact text | High | Pending owner |
| 8 | 2d4bc095 | TIRE 215/70 R 16 | 3 | NHC (no bin) | 223143-O | TIRE 215/70 R 16 | not stated | 215/70R16 | source link + exact text | High | Pending owner |
| 9 | 03b8e670 | TIRE 23.5 R25 20PR TL RADIAL | 0 | NHC (no bin) | 310026-O | TIRE 23.5 R25 20PR TL RADIAL | not stated | 23.5R25 20PR TL | source link + exact text | High (qty 0) | Pending owner |
| 10 | b8f3c417 | TIRE 235-70R16 TL ROA | 6 | NHC (no bin) | 221620-O | TIRE 235-70R16 TL ROA | not stated ("ROA" unexplained) | 235/70R16 TL | source link + exact text | High | Pending owner |
| 11 | 33a8e9e8 | TIRE 235-75R17.5 TL 16PR | 8 | NHC (no bin) | 221685-O | TIRE 235-75R17.5 TL 16PR | not stated | 235/75R17.5 TL 16PR | source link + exact text | High | Pending owner |
| 12 | 36eb2a20 | TIRE 235/70R16 HANKOOK | 2 | NHC (no bin) | 310633-O | TIRE 235/70R16 HANKOOK | Hankook | 235/70R16 | source link + exact text + brand on master | High | Pending owner |
| 13 | d9a552b6 | TIRE 265/70R16 | 1 | NHC (no bin) | 140142-O | TIRE 265/70R16 | not stated | 265/70R16 | source link + exact text | High | Pending owner |
| 14 | 69053488 | TIRE 315/80 R22.5 TECHKING | 73 | NHC (no bin) | 223758-O | TIRE 315/80 R22.5 TECHKING | Techking | 315/80R22.5 | source link + exact text + brand on master | High | Pending owner |
| 15 | 44cb8336 | TIRE 385-65R22.5 | 22 | NHC (no bin) | 221855-O | TIRE 385-65R22.5 | not stated | 385/65R22.5 | source link + exact text | High | Pending owner |
| 16 | 09ea1836 | TIRE 7.00 R16 10PR R 230TT BRIDGESTONE | 6 | NHC (no bin) | 310296-O | TIRE 7.00 R16 10PR R 230TT BRIDGESTONE | Bridgestone | 7.00R16 10PR TT, pattern R230 | source link + exact text + brand on master | High | Pending owner |
| 17 | 1d191731 | TIRE 9.00R20 HANK | 5 | NHC (no bin) | 310388-O | TIRE 9.00R20 HANK | not stated ("HANK" probably Hankook, not confirmed) | 9.00R20 | source link + exact text | High | Pending owner |
| 18 | 5a55a635 | 315/80R22.5 Double coin | 35 | NHC (no bin) | 223707-O (candidate) | TIRE 315/80 R22.5 - RR99 DOUBLECOIN | Double Coin | 315/80R22.5, pattern RR99 on master only | **No source link**; size + brand match only; the line does not state the RR99 pattern | Medium | **Keep pending - physical tread verification required** before mapping |

Brand is left "not stated" wherever neither the line nor the master states it; nothing was inferred
into the record.

---

## 3. 7 conflicting tyre serials

Production holds **7** open conflicts, all `scrapped_but_active`, investigation status `open`,
investigator not assigned. The evidence and proposed decisions are produced by another lane in
**`docs/inventory/99_TYRE_CONFLICTS_FOR_APPROVAL.md`** (not yet in the repository at the time of
writing). This section is a placeholder that points there.

How a decision is made (enforced in the database, 20261120114000): an Admin, Manager, Director or
PMV Manager assigns an investigator from `inv_tyre_investigator_roles()` (Tire Planning Engineer,
Tyre Engineer, Tyre/PMV Engineer, PMV Engineer); the investigator records at least one finding and
proposes a correction; an **independent PMV Manager** with `scrap_approve` approves it (the
investigator and the proposer are refused by user id); then it is closed. Approval also needs stock `scrap_approve`. The web screen for these
steps is new in this branch (Inventory -> Tyres -> conflict drawer). **There is no PMV Manager in KSA
today** (the only PMV Manager, Abdallah Marwan, is UAE-scoped), so none of the 7 can be approved
until one is named (section 4).

---

## 4. Approval roles

### 4.1 What exists today (measured)

| Item | Production state |
|---|---|
| `module_permissions` for `stock` | Global rows enable the module for PMV Manager, Workshop Maintenance Area Manager, Manager, Tire Planning Engineer, Store Keeper. No row for Inventory Controller or Finance Manager (custom roles: deny by default) |
| `user_access_grants` on `stock` | 1 row (a `view` grant to a Tyre Data Collector) |
| Resolved capabilities (impersonated, read-only) | adnan mohammad alhaj ali (Manager, KSA) and VINAY KUMAR T (Workshop Maintenance Area Manager, KSA): `view` only, every other stock capability false |
| `approval_policies` | 3, all `draft` (tyre inspection routing, not inventory) |
| `inventory_approval_limits` | 0 (a valued approval with no limit for the role is refused) |
| `Inventory Controller` / `Finance Manager` roles | Exist (113000) in every company; 0 holders |
| Who can approve inventory today | Only the two Admin / super-admin accounts |

### 4.2 Recommended structure (reuse existing roles, no new accounts)

| Function | Reuse | Capabilities | May approve | Candidate (evidence only) |
|---|---|---|---|---|
| Store Keeper | Store Keeper (7 people) | receive, issue, transfer, count | nothing (refused by role) | Section 1 |
| Inventory Counter | No separate role: a counter is assigned per audit (`counter_id`) | count | nothing | Any evidenced Store Keeper at their own site |
| Independent Recount Officer | No separate role: assigned per audit; must not have counted it | count | nothing | Owner to name; a Store Keeper from another site is acceptable because the database refuses anyone who counted the audit |
| Inventory Controller | Manager or Workshop Maintenance Area Manager (both already eligible in `inv_approver_roles`), or assign the existing `Inventory Controller` role to a person whose current role carries nothing else they need | view, audit_create, recount, discrepancy_review, adjustment_approve, audit_history, export | stock adjustments, recount assignments, opening balances | No person has inventory-control evidence. Eligible by role today: adnan mohammad alhaj ali (Manager, KSA), VINAY KUMAR T (Workshop Maintenance Area Manager, KSA). **Owner to choose** |
| Finance Manager | `Finance Manager` role (exists, 0 holders) | view, view_value, financial_post, audit_history, export | cost reconciliations, opening-balance values | **Owner to name.** No profile shows finance responsibility. Financial approval must not be given without the owner's written authorisation |
| PMV Manager (KSA) | PMV Manager | view, discrepancy_review, adjustment_approve, scrap_approve, audit_history | tyre conflict corrections (only role allowed), stock adjustments | **Owner to name for KSA.** Abdallah Marwan is UAE-scoped and cannot act on the 7 KSA conflicts |
| Site Manager | No "Site Manager" role exists. Use Workshop Maintenance Area Manager for site sign-off | as Inventory Controller, limited by site scope | stock adjustments, recounts at their sites | VINAY KUMAR T (KSA, Workshop Maintenance Area Manager) is eligible by role |
| Engineering Reviewer | Tire Planning Engineer (in `inv_tyre_investigator_roles`) | view | nothing (investigates and proposes only) | shahzeb Rahman (Tire Planning Engineer profile, KSA/UAE/Egypt) is the only holder |

Prepared: `101_prepared/02_approver_capabilities_template.sql` - per-named-person grants with
placeholders; refuses a person whose role is not eligible, refuses a Store Keeper as approver,
refuses stacking two approver bundles on one account, requires the PMV Manager to be KSA-scoped.
Role changes themselves use `94_prepared/approver_roles_template.sql` (snapshots the old role).

### 4.3 Proof that nobody can approve their own count or adjustment

The refusals are in the database, run inside every approval decision, and are not affected by any
capability grant:

| Rule | Where | Test |
|---|---|---|
| The requester can never decide their own approval request | `_inv_approval_block_reason` -> `'segregation_of_duties: requester'` (20261120108000); also a table CHECK requester <> decider | `supabase/tests/inventory_controls.test.mjs` (`/requester/` rejected; direct `decided_by = requested_by` update refused by `self_chk`) |
| The audit creator, every counter on the audit, and the recounter cannot approve the adjustment | `_inv_approval_block_reason` builds `conflicts` from `created_by`, `counter_id`, `recount_counter_id` and every `inventory_count_lines.counter_id` -> `'segregation_of_duties: creator, preparer, counter or recounter'` | `inventory_audits.test.mjs` (counter refused at `inv_approval_decide` / `inv_adjustment_approve`), `inventory_controls_completion.test.mjs` (`/segregation_of_/`) |
| The proposed recounter cannot approve the recount assignment | same function -> `'segregation_of_duties: proposed recounter'` | `inventory_audits.test.mjs` (recount request by the counter refused) |
| A recount must be done by someone who has not counted this audit | `inv_recount_assign` (20261120102000 / 107000): "A recount must be done by a different person who has not counted this audit" | `inventory_audits.test.mjs` |
| The preparer of an opening balance cannot approve it, even if later promoted to Admin | `inv_opening_batch_decide`: "The preparer cannot approve their own opening balance"; `conflicts` = `prepared_by` | `inventory_controls_completion.test.mjs` ("the same person promoted to Admin is still the preparer") |
| One person cannot decide two stages of the same request | `'segregation_of_duties: already decided an earlier stage'` | No dedicated PGlite assertion for this branch (code path only); multi-stage routing is covered in `inventory_controls.test.mjs` (`not_stage_approver`) |
| A Store Keeper can never approve | `_inv_approval_extra_block` -> `store_keeper_cannot_approve` (20261120113000) | `inventory_controls_completion.test.mjs` (`/store_keeper_cann/`) |
| Tyre investigator and proposer cannot approve the correction | tyre_conflict_correction `conflicts` = `investigator_id`, `proposed_by` (20261120114000) | `inventory_controls_completion.test.mjs` ("investigator refused, Admin refused"; "PMV Manager who investigated can never approve") |

**Limitation the owner should know:** separation is by **user id**. The same human with two accounts
is two ids. The Engineering Reviewer candidate (shahzeb Rahman) also has a separate Admin
super-admin account; that Admin account could approve a correction the Tire Planning Engineer account
proposed. Rule to adopt: the platform-owner Admin accounts do not approve inventory decisions while a
named approver exists.

---

## Decisions requested

1. Approve section 1 grants for MD JAHID, SOMANATH NAYAK, Wasim khan (script 01); name sites for the other four.
2. Create the NHC location, then approve the 17 High mappings; keep line 18 (35 Double Coin) pending until the tread is checked.
3. Name a KSA PMV Manager so the 7 tyre conflicts (doc 99) can be decided.
4. Choose the Inventory Controller (adnan mohammad alhaj ali or VINAY KUMAR T, or another person), name a Finance Manager with written financial authority, and set approval value limits.
