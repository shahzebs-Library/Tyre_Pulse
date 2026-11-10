# Tyre Cost Audit: findings and proposed corrections (2026-11-10)

Read-only audit of the live database (`jhssdmeruxtrlqnwfksc`). **No data was changed.**
The classifier was compiled and run inside a transaction that was rolled back.
Rules live in `src/lib/tyreCostAudit.js`; the SQL mirror is in
`supabase/migrations/20261112106000_tyre_cost_audit.sql` (authored, not applied).

## Scope

- **Records checked:** 10,998 tyre records dated 2025-01-01 to 2026-10-27, 3 countries.
- **Price source:** ERP store-issue lines in `parts_consumption`.
  - There is no invoice, GRN or PO data: `goods_receipts`, `purchase_orders` and `invoices` hold 0 rows.
  - "Verified source" therefore means the tyre's own issue line, or the same item code in the same month.
- **Warranty evidence:** `warranty_claims` holds 0 rows, and no warranty wording exists on any tyre line.
  - So 0 tyres are proven warranty.
  - Zero-value lines are NOT assumed to be warranty. They go to review (`zero_line_uncertain`).

## Results by class

| Class | KSA (SAR) | UAE (AED) | Egypt (EGP) |
|---|---|---|---|
| Checked | 8,184 | 2,341 | 473 |
| Verified, matches its own transaction | 2,098 | 547 | 237 |
| Warranty excluded (proven) | 0 | 0 | 0 |
| **Recoverable, exact same-month own line** | **138 = 109,192.96** | **2 = 1,400.00** | **4 = 55,952.94** |
| Recoverable, same item code same month | 3 = 2,580.00 | 0 | 0 |
| Conflicting prices (review) | 78 | 14 | 0 |
| Own line only in another month (not used) | 1,793 | 226 | 28 |
| Zero-value line, warranty not proven | 12 | 0 | 0 |
| Size or brand differs from source line | 12 | 2 | 2 |
| No reliable price (Cost Pending Verification) | 547 | 1,529 | 70 |
| **Priced by an estimate, not a transaction** | **1,885 = 1,775,663.00** | 0 | 0 |
| Priced, differs from its own line | 991 | 21 | 119 |
| Priced, no transaction to confirm | 625 | 0 | 13 |
| Same tyre priced twice | 2 | 0 | 0 |

**Totals:**
- Zero or missing-cost non-warranty tyres: KSA 2,585, UAE 1,773, Egypt 104.
- Safely recoverable: KSA 141, UAE 2, Egypt 4.
- Proposed adjustment: SAR 111,772.96, AED 1,400.00, EGP 55,952.94. Each currency is kept separate.

## The two big findings

1. **1,885 KSA tyre prices (SAR 1,775,663) were filled by the July backfill.**
   - They took the median price of other tyres of the same brand and size in earlier months.
   - That is a cross-month estimate, which the new rule forbids.
   - Proposed: revert them to Cost Pending Verification. This needs approval and is undoable.
   - Effect on KSA lifetime CPK (2025 onward, weighted): **0.02603 rises to 0.02871 SAR/km (+10.3%)**.
     - It is now measured on 1,565 tyres instead of 2,560.
     - The higher figure is the honest one; the estimates were pulling CPK down.
2. **1,793 KSA tyres have their own job-card tyre line in a different month.**
   - The gap runs from 1 to 18 months (spread: 110 at 1 month, 223 at 7 to 8 months, 51 at 12 months).
   - These are different issue transactions, not a date typo. Most likely the job card number was reused, or the tyre came from the Aug to Nov 2025 opening-baseline load.
   - **Not priced**, by rule.
   - Owner decision: accept a one-month gap as the same transaction? It would add up to 110 KSA tyres. It is not enabled.

## Tyre vs spare-part separation (2025 onward)

- Tube, flap and valve lines are already booked as spare parts:
  - KSA tubes: 125 lines, SAR 28,220.32.
  - KSA valves: SAR 9,420.76.
  - UAE valves: AED 22,623.22.
- **Only 1 KSA tube line (SAR 62) sits in the tyre bucket.** It is never used as a tyre price.
- No mixed tyre and tube line was found on any tyre's own job card.

## What does not change

- **Monthly tyre consumption, MIS spend and the expense dashboards** read the expense grid (`loadCostSplit`), not `cost_per_tyre`. Price corrections do not move them.
- **Kilometres:** `tyre_cost_audit_apply` aborts if any kilometre field changes during a price correction.

## Approval and apply flow

- **Scan:**
  - `tyre_cost_audit_scan(country, from, to, dry_run)`. Dry run is the default and saves nothing.
  - With `dry_run = false` it records findings; running it again is idempotent.
- **Decide:**
  - `tyre_cost_audit_decide(ids, 'approved'|'rejected', note)`: Admin, Manager or Director.
  - Only the exact match, same-month item match and estimate-revert classes can be approved.
  - A rejection needs a reason.
- **Apply:**
  - `tyre_cost_audit_apply(ids)`: Admin or super admin only, one transaction.
  - It writes only approved findings, and only if the stored value is still what the audit saw.
  - It logs to `tyre_cost_corrections`. Undo with `tyre_cost_correction_undo(batch)`.

## Owner decisions

1. **DONE 2026-11-10:** migration `20261112106000` applied live.
2. **DONE 2026-11-10:** the 147 recoverable prices were approved and applied as batch
   `0e4ab851-9fa6-4818-9df2-e0b497a126d1`.
   - KSA: 141 tyres, SAR 111,772.96.
   - UAE: 2 tyres, AED 1,400.00.
   - Egypt: 4 tyres, EGP 55,952.94.
   - No existing price was overwritten, and every tyre now holds exactly its source line's price.
   - Undo: `select public.tyre_cost_correction_undo('0e4ab851-9fa6-4818-9df2-e0b497a126d1')`.
3. **OPEN:** revert the 1,885 estimated KSA prices, or keep them labelled as estimates. They sit in the findings table as proposed and are not approved.
4. **OPEN:** whether a one-month gap between the tyre date and its own issue line counts as the same transaction.
5. **OPEN:** load invoice or GRN data if verification beyond ERP issue lines is wanted.

## End-to-end proof (rolled back, live database, 2026-11-10)

Run inside one transaction that was rolled back. Nothing was kept.

| Check | Result |
|---|---|
| Real KSA-only Manager runs and saves the audit | 8,166 tyres checked, 5,461 findings saved |
| Same Manager audits UAE | 0 rows (country scope holds) |
| Tyre Man runs the audit | refused (42501) |
| Second scan | 0 new findings (idempotent) |
| Approve + apply 5 exact matches (super admin) | 5 applied, kilometres unchanged |
| Hand-inserted finding with an invented price (99,999) | approved but **not applied** (evidence check) |
| Undo the batch | 5 restored, 0 skipped |

## Where it lives

- Dashboard: Data Reconciliation, "Tyre Cost Audit" tab (shows "not installed" until the migration is applied).
- Import preview: ERP Intake (expense grid and monthly tyres), Data Intake Center (tyre, advisory).
  - Uploaded price, proposed price, source, result and action are shown for every row.
  - Returns and reversals still import, with a warning.
- Cost display: Tyre Records, Tyre Passport and Serial Tracker show "Cost Pending Verification" for an unknown price.
- AI: "Tyre Cost Audit" agent in the AI Command Center (dry-run scan only; proposes, never applies).
