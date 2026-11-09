# PR #470 follow-up - verification against the live database (2026-11-09)

Project `jhssdmeruxtrlqnwfksc`. Every figure below was read from the live database in
this session. "Rollback test" = the undo was executed inside a transaction that was then
aborted (`raise exception`), so the test proves the undo works and leaves nothing behind.

## 1. Corrections from PR #470 - re-verified

| Correction | Backup / log | Rows | Live check | Money before = now | Rollback test |
|---|---|---|---|---|---|
| KSA old-tyre serial fix (20261109120000) | `_bak.ksa_old_tyre_fix_20261109` | 1,599 | 1,599/1,599 old rows carry the real old serial (18 named, rest NULL); 0 still priced; km unchanged 1,599/1,599 | SAR 1,820,562.12 = 1,820,562.12 | PASS: 1,599/1,599 restored exactly |
| UAE old-tyre fix (20261109130000) | `_bak.ue_old_tyre_fix_20261109` | 453 | 453/453 (416 named) ; km unchanged | AED 254,411.62 = 254,411.62 | PASS (UAE+Egypt 542/542) |
| Egypt old-tyre fix | same | 89 | 89/89 (85 named); km unchanged | EGP 1,317,834.08 = 1,317,834.08 | PASS |
| KSA repeat purchase prices cleared | `tyre_cost_corrections` batch `0ad0b895-0c8d-4568-b40b-1edf75eaacbb` | 124 / SAR 135,583.00 | 119 still cleared; **5 now carry the price moved there by the old-tyre fix** (K507B406198 TM706, YME84080 MP129, YMM40125 TM635, YMM59137 TM631, YMY39815 TM518) - correct, they are the real new tyre | n/a | PASS: undo restored 119, skipped the 5 (guarded) |
| Refit estimated prices removed | batch `69f4fdce-1af4-4596-a25c-80c84e3ab28f` | 90 / SAR 79,950.00 | 90/90 still cleared | n/a | PASS: 90 restored |
| KSA serials on two vehicles closed | `tyre_replacement_log` batch `79095899-0969-4d69-9504-8c0d2dd26678` | 28 | strong serials active on 2 vehicles now: **0** | n/a | PASS: 28 restored, 0 skipped |
| UAE/Egypt serials on two vehicles | batch `34b68cac-35ba-471d-b5c7-4289dc6cfa84` | 28 (18+10) | 0 | n/a | PASS: 28 restored |
| Latest upload wins, 3 KSA serials | `_bak.ksa_two_price_latest_wins_20261109` | 3 (11019981 SL012 780, HNA4922 BH029 540, K601B501563 TM459 766) | older rows now unpriced | n/a | restore = copy cost_per_tyre back from the backup (not executed) |
| KSA exact expense copies removed | `_bak.ksa_expense_copies_20261109` | 843 removed of 1,682 archived | 0 of the 843 still live | SAR 132,686.09 removed | restore = re-insert from archive (not executed) |
| Expense import_uid backfill | `_bak.expense_uid_backfill_20261109` | UAE 8,248 / Egypt 649 / KSA 12,238 | UAE 8,248, Egypt 649 match; KSA 11,393 match = 12,238 - 843 removed copies - **2 rows whose uid changed since** | n/a | n/a (key only) |

Double-active wheels: **0**. Serials priced twice: **1** (K507B403860, protected).

## 2. New this session (migration `20261109150000`, applied live)
Dry-run first (whole migration + tests in one aborted transaction), then applied. Results of the dry run, confirmed after apply:
- Same-day stale guard on wheel KSA BH010/LHRO (active since 2026-07-26 @ 97,825 km):
  re-upload of the removed serial 23B0213712 same day -> `ambiguous_same_day_stale`;
  new serial with km 97,325 -> held (`meter_below_current_fitment`);
  new serial with km 98,325 -> `would_close` (latest upload still wins).
- Serial rule: FEB-62, 195 R 15, "YMA30018, YLZ08348", 111111, 123456 -> not real; 24R1321500, YMM36599, K507B403860, 26C0004819 -> real.
  28 KSA rows (18 values, SAR 3,625) stop being treated as one physical tyre; no data changed.
- Exceptions (all countries): rotation not closed 11, same-day double entry 6, priced twice 1,
  weak serial on active fitments 77, serial with remark 47, open import reviews 0.
- Rotation closer DRY RUN: 14 earlier fitments would close. **Not applied** (owner decision).
- Cost status: purchase_price 4,169 / unpriced 4,030 / estimated_comparable 1,885 /
  from_job_card 579 / refit_no_new_purchase 538 / cleared (repeat) 119 / cleared (estimate) 90.
- Grants: anon cannot execute `get_tyre_exceptions`, `tyre_close_rotations`, nor read `v_tyre_cost_status`.
- Old definitions saved: `_bak.fn_defs_20261109d` (4 functions).

**OPEN:** the post-apply rollback test of 20261109150000 (restore the 4 saved definitions, drop
the 3 new objects, inside an aborted transaction) did not run: the database tool stopped to ask
for approval of the DROP statements and timed out. Rollback SQL is in the migration header.
