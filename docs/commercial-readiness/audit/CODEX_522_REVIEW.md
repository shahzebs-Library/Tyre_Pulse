# Review of what was applied with PR #514 and PR #522 (ERP observation reconciliation)

Date: 2026-11-15. Written for the owner, and for the author of #514 and #522 to answer point by point.
Everything marked "verified" was read from the production database (read only) or reproduced on a
synthetic staging copy that first applies the exact migration that is live.

## 1. What is live now (verified on production, read only)

| Item | State |
|---|---|
| Migration | `20261115090615 observation_erp_reconciliation_20261115` |
| Tables | `observation_erp_links`, `observation_erp_link_events`: row security on, 3 policies each, 0 rows, signed-in users read only, no anonymous access |
| Functions | `observation_erp_decide(uuid, uuid, text, text)`: runs with owner rights, empty search path, not callable anonymously. `observation_erp_events_immutable()` |
| Reporting bot policies | Missing on both tables (0 `anum_reader` policies) |

## 2. What was done well

1. Focused loading: only tyre movements on or after the inspection date, the job cards on those
   movements, then later tyre related job cards. No whole vehicle history scan.
2. Unrelated job cards are hidden; missing ERP records go to a separate section.
3. The panel is clearer: review, evidence and exception states, inspection photo first, no raw ids on
   the main cards.
4. Nothing is confirmed automatically. A decision needs an authorised reviewer and a reason.
5. History rows cannot be edited. No anonymous access. The function pins its search path.
6. The confirmation does not change a tyre cost, an ERP record or the status of a corrective action.

## 3. Problems, each with evidence

### P1. Wheel positions are matched with a fixed text table
The live function contains a `CASE` list: one list when the inspection's vehicle type text contains
"MIXER", one list for every other vehicle. The owner's ruling was: resolve through the vehicle's actual
axle and wheel layout, no text substitution, ambiguous stays pending.

Consequences reproduced on staging (the staged function has the same hash as production):

| Case | Live result | Should be |
|---|---|---|
| Mixer inspection where the vehicle type was not recorded on the inspection | Uses the non mixer list, so the wheel never matches | Use the asset register's type |
| Canter, bus, tanker slots | Not in either list, compared as raw text, never match | Resolve on that layout |
| Pump rear wheels | Assumed "R1 is rear axle 1"; ERP uses three spellings (`LHRCO`, `LHCO`, `RHR1-O`) | Pending manual review until the layout rule is confirmed |
| A slot that does not exist on that vehicle's build (front axle 3 on a 4 axle pump) | Accepted if the text happens to match | Refused, inconsistent |
| Inspection vehicle type contradicts the asset register | Accepted | Pending manual review |
| Unknown or tyreless vehicle type | Raw text compare | Pending manual review |

### P2. Serial is used as a filter, not as evidence
Live requires the ERP row to carry the observed serial. A replacement tyre never carries the old
serial, so a genuine replacement cannot be confirmed when the action has a serial. A strong observed
serial leaving on that job card should support the match; the same serial on a different wheel should
block it.

### P3. No site check
The function checks company and country but not whether the reviewer may see the site of the action,
the inspection and the job card. Site scoping is select only on those tables, and a function with
owner rights bypasses it.

### P4. Reporting bot policies missing
Project rule: any migration that creates a table ends with
`select anum_integration.apply_reader_policies();`. Without it the two new tables are outside the
read only reporting role's guard set.

### P5. Process
1. #514 was merged at 11:37 and its database part was not applied until after #522 at about 12:05.
   For that period the live panel pointed at tables that did not exist.
2. The owner's instruction for #514 was: do not merge yet, fix and test on synthetic staging first,
   with tenant, country, role, position, serial and historical record tests. The applied version was
   checked by a transactional dry run on production and one smoke test. That proves the SQL compiles,
   not that the rules are right (the author's own note says the same).
3. The migration file is named `20261115120000` in the repository and recorded as `20261115090615` in
   the database. Harmless, but the two numbers must not be confused later.
4. The security advisor warnings mentioned in the release note are still open.

## 4. What is NOT wrong (so it is not argued twice)
1. No data was changed. Both tables are empty; no corrective action, cost or ERP row was touched.
2. No access was widened to anonymous users.
3. The loading and screen changes are kept as they are.

## 5. What can be done (proposed, PR #521)
1. Keep #522's loading and panel.
2. One shared tyre position service (web and database, tested to give the same answer on 6,624
   generated cases) used by the matcher, the tyre bay, rotation and layout screens.
3. Follow up database change, no table created or altered:
   `create or replace` of `observation_erp_decide` with the same name, arguments and result, using the
   position service, serial as evidence, a site check, a read only `observation_erp_evaluate`, and the
   reporting bot policies. A rollback file holds the exact live function.
4. Tested on staging by applying the live migration first, then the follow up: 125 of 125, existing
   link and history rows byte identical.

## 6. Questions for the author of #522 to answer

1. P1: is there any vehicle type in the current fleet where the fixed table gives a different, and
   correct, answer that the layout based service would get wrong? Name the vehicle type and slot.
2. P1: why key the layout on the inspection's vehicle type text rather than the asset register?
3. P2: was requiring the observed serial on the ERP row intended? How would a replacement be confirmed?
4. P3: was the missing site check a decision or an omission?
5. P4: any objection to adding the reporting bot policies?
6. P5: which roles and which tenants were exercised in the production smoke test, and what exactly was
   rolled back?
7. Is there anything in the follow up (section 5) that would break the #522 screen or its tests?
   The #522 matcher tests pass unchanged on PR #521.

## 7. Owner decisions still open on this feature
1. On pumps, is "rear centre" the first rear axle and "rear rear" the second? Yes would let 3 pending
   actions be offered for review.
2. May a strong serial alone allow Confirm when the wheel cannot be read?
3. Should a layout history table exist before admins edit layouts?
