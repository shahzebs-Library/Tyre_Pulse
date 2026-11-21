# 98 - Operational setup: Store Keepers and NHC stock lines

Measured read-only on production (`jhssdmeruxtrlqnwfksc`) on 2026-11-21.
Nothing was changed: no grant, profile, site, stock line or item was written.
Workbook with the same tables: `docs/inventory/98_operational_setup.xlsx`.

## A. Store Keeper setup

### What they can do today

- The prerequisites are in place: `inv_can` exists and all 16 migrations
  `20261120100000..115000` are applied, so `store_keeper_capabilities.sql` can now run.
- Role rows (`module_permissions`, role `Store Keeper`, global): `stock`, `stock_replenishment`,
  `mobile:stock`, `mobile:stockManage` all enabled.
- Company A has no `permission_overrides` entry for Store Keeper.
- Per-person `user_access_grants` on `stock`: **none** for any of the 7.
- Measured with `app_user_can('stock', cap)` as Wasim khan. The other 6 have the same role and no grants, so the result is the same.
  - **true:** `view`, `create`
  - **false:** `receive`, `issue`, `transfer`, `count`, `edit`, `adjustment_approve`, `view_value`
- **Required** (from `94_prepared/store_keeper_capabilities.sql`): `receive`, `issue`, `transfer`, `count`.
  All four are missing for all 7 people. The prepared SQL adds 28 grant rows (7 people x 4 capabilities).

### People, scope and site evidence

All 7 are in the Default Organisation, country KSA, sites `{ALL}`, approved and not locked.

The evidence for each person comes from their own records in these tables:
- `stock_movements`, `stock_records`, `inspections`, `work_orders`, `checklist_submissions`;
- odometer, engine-hours and wash logs;
- `audit_log_v2`.

| Name | Username | Site evidence | Proposed site |
|---|---|---|---|
| MD JAHID | 10011207 | DIRIYAH: 47 movements, 11 lines (last 2026-11-09). RIY-MET: 3 + 2 (2026-10-28). NHC: 1 + 1 (2026-10-28). Last sign-in 2026-11-18. | **DIRIYAH** (to confirm) |
| SOMANATH NAYAK | SmNayak | NHC: 17 movements, 16 lines (last 2026-10-19, the NHC stocktake). Last sign-in 2026-10-24. | **NHC** (to confirm) |
| Wasim khan | Wkhan | RIY-MET: 4 movements, 2 lines (last 2026-10-29). QIDDIYA-LOWER PLATEAU: 3 + 3 (2026-10-25). Last sign-in 2026-10-25. | **RIY-MET + QIDDIYA-LOWER PLATEAU** (to confirm) |
| Hosham Homeda | Hhomeda | No records. 2 audit rows with no table or site (2026-09-28). Last sign-in 2026-09-28. | None, owner to name |
| Mohammad Ansari | Mansari | No records, no audit rows. One sign-in (2026-09-24). | None, owner to name |
| Mohd Asad | Masad | No records, no audit rows. One sign-in (2026-09-24). | None, owner to name |
| MUHAMMAD NASIR HUSSAIN | muhammadnasir | No records, no audit rows. One sign-in (2026-07-20). | None, owner to name |

Notes:
- Narrowing `profiles.sites` is optional block 3 of the prepared SQL. It is the narrowest
  scope the release can enforce, because there is no per-warehouse user table.
- Four of the seven have never recorded anything, so there is no evidence to suggest a site
  for them. The owner has to name one.
- MD JAHID also touched NHC and RIY-MET once each. If his site is narrowed to DIRIYAH only,
  he would lose those.

## B. NHC stock lines with no item link

There are 18 `stock_records` lines at NHC with `item_id` null. On every one, unit cost and
average cost are blank and the valued value is 0. `item_id` references `material_master`.

| Confidence | Lines | Evidence |
|---|---|---|
| High | 17 | The line stores the ERP code and catalogue id that the stock entry screen picked (`custom_data.stock_item`). The KSA master row with that id has the same code and the same name, and is reviewed tyre. |
| Medium | 1 | Size and brand match only |
| None | 0 | |

None of the 18 candidate items is already linked to another NHC line, so linking them would not
create a duplicate balance.

| Stock line | Description | Qty | Last update / by | Candidate | Confidence |
|---|---|---|---|---|---|
| 5a55a635 | 315/80R22.5 Double coin | 35 | 2026-08-08 shahzeb Rahman (Initial, +/- adjustments, net +35) | 223707-O TIRE 315/80 R22.5 - RR99 DOUBLECOIN | Medium: the only Double Coin 315/80R22.5 in the KSA master. No code on the line, pattern unconfirmed. |
| cf51b624 | TIRE 10-16.5 | 8 | 2026-10-19 SOMANATH NAYAK (stocktake) | 221622-O | High |
| 944991ff | TIRE 10-16.5/10 SKS-1 allainz | 2 | 2026-10-19 SOMANATH NAYAK | 221564-O | High |
| 87e7b5b1 | TIRE 11R22.5 TL 16PR | 7 | 2026-10-19 SOMANATH NAYAK | 310612-O | High |
| b5ed4037 | TIRE 195 R 15C-6PR NEW MODEL 2007 TOYOTA | 1 | 2026-10-19 SOMANATH NAYAK | 140082-O | High |
| c776f54a | TIRE 195R15 6PR | 3 | 2026-10-19 SOMANATH NAYAK | 221743-O | High |
| 1f3469e1 | TIRE 205/85 R16 | 1 | 2026-10-19 SOMANATH NAYAK | 223068-O | High |
| bc55afe2 | TIRE 205R16 /689 | 3 | 2026-10-19 SOMANATH NAYAK | 310204-O | High |
| 2d4bc095 | TIRE 215/70 R 16 | 3 | 2026-10-19 SOMANATH NAYAK | 223143-O | High |
| 03b8e670 | TIRE 23.5 R25 20PR TL RADIAL | 0 | 2026-10-19 SOMANATH NAYAK | 310026-O | High |
| b8f3c417 | TIRE 235-70R16 TL ROA | 6 | 2026-10-19 SOMANATH NAYAK | 221620-O | High |
| 33a8e9e8 | TIRE 235-75R17.5 TL 16PR | 8 | 2026-10-19 SOMANATH NAYAK | 221685-O | High |
| 36eb2a20 | TIRE 235/70R16 HANKOOK | 2 | 2026-10-19 SOMANATH NAYAK | 310633-O | High |
| d9a552b6 | TIRE 265/70R16 | 1 | 2026-10-19 SOMANATH NAYAK | 140142-O | High |
| 69053488 | TIRE 315/80 R22.5 TECHKING | 73 | 2026-10-19 SOMANATH NAYAK | 223758-O | High |
| 44cb8336 | TIRE 385-65R22.5 | 22 | 2026-10-28 MD JAHID (stocktake + adjustment_up) | 221855-O | High |
| 09ea1836 | TIRE 7.00 R16 10PR R 230TT BRIDGESTONE | 6 | 2026-10-19 SOMANATH NAYAK | 310296-O | High |
| 1d191731 | TIRE 9.00R20 HANK | 5 | 2026-10-19 SOMANATH NAYAK | 310388-O | High |

Full line ids and catalogue ids are in the workbook. Do not link anything automatically: each
link needs owner confirmation, and the Medium line needs a physical check of the tread pattern.
