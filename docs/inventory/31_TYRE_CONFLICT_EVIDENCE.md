# 31 - The seven scrapped-but-active tyres: evidence pack

Owner decision 2 (2026-11-20). Read-only evidence from production (`jhssdmeruxtrlqnwfksc`), measured
2026-11-20 with catalog / SELECT reads only. **Nothing was corrected.** People appear only as roles.
Workflow: `20261120114000_inv_tyre_conflict_investigation.sql` (assign to a Tyre / PMV Engineering
user -> findings -> proposed correction -> independent PMV Manager approval -> close as a decision).
Every conflict stays open until it is resolved individually; the tyre team applies any approved
correction in tyre records itself.

## How the evidence was gathered

* Scrap mark: `tyre_status_marks` (mark_type `scrap`): when, reason, the role of the person who marked
  it, and `prior_status` (the tyre record ids and statuses the scrap action saw).
* Fitment history: every `tyre_records` row for the serial (asset, wheel position, fit / removal dates
  and km, job card, created_at, source). The rows named in `prior_status` were also read: they still
  exist but **no longer carry the serial** (serial NULL), consistent with the 2026-11-09 "old tyre"
  repair that moved a mis-stamped new serial off the removed tyre's row.
* Inspections: every inspection of the asset since the fitment period, at the wheel slot. Slot mapping
  used (inference, stated): `RHF1 = F1R`, `LHCI = R1Li`, `RHCI = R1Ri`, `LHRI = R2Li`, `RHRO = R2Ro`
  (C = first rear axle, R = second rear axle). Inspections record condition, not the serial.

## Summary

| # | Serial | Country | Active row (asset / position, fitted) | Scrap mark | Pattern |
|---|---|---|---|---|---|
| 1 | L52043311 | KSA | MP078 RHF1, 2026-06-16 @ 56,176 km | 2026-07-29, Tyre Data Collector, no reason | A |
| 2 | YMM18886 | KSA | TM589 RHRO, 2026-07-03 @ 145,800 km | 2026-07-28, Tyre Data Collector, no reason | A |
| 3 | YMM22455 | KSA | TM643 RHCI, 2026-02-28 @ 77,805 km | 2026-07-28, Tyre Data Collector, no reason | A |
| 4 | YMM68731 | KSA | TM619 LHRI, 2026-02-23 @ 105,184 km | 2026-07-27, Tyre Data Collector, no reason | A |
| 5 | YMY44573 | KSA | TM635 RHCI, 2026-02-14 @ 68,485 km | 2026-07-28, Tyre Data Collector, no reason | A |
| 6 | YMU41519 | KSA | TM411 LHCI, 2026-03-03 @ 54,097 km | 2026-07-27, Admin, "Needs to check in the system." | B |
| 7 | YMA44467 | UAE (mark recorded under KSA) | TM204 RHF1 (UAE), 2025-10-01 @ 60,000 km | 2026-09-14, Tyre Data Collector, no reason | C |

**Pattern A (5 tyres).** At the time of the scrap action the serial sat on the REMOVED tyre's row of the
same wheel (the `prior_status` row). That row's removal date and removal km are exactly the Active
row's fitment date and fitment km, on the same job card. That is the signature of the ERP load that
stamped the new tyre's serial on the removed tyre's row. Today the removed row is `Scrapped` with no
serial; the serial lives only on the Active (new) tyre's row, created 2026-08-02 by a re-upload.
*What the evidence suggests:* the person scrapped the **removed** tyre, but under the serial that
belonged to the new one; the scrap mark is attached to the wrong serial. Candidate correction:
`clear_scrap_mark` (or re-key the mark to the removed tyre), decided by the PMV Manager.

**Pattern B (1 tyre).** The same serial was removed from TM543 RHF1 on 2026-03-01 (Scrapped, 145,000 ->
181,803 km) and appears Active on TM411 LHCI from 2026-03-03. The scrap mark itself says the data needs
checking. *Suggests:* either the tyre was not scrapped and was refitted two days later on another
mixer, or one of the two rows carries a mistyped serial. Needs a physical check of TM411 LHCI.

**Pattern C (1 tyre).** KSA TM642 RHF1 and UAE TM204 RHF1 both record this serial fitted on 2025-10-01 at
exactly 60,000 km. The KSA row is Scrapped (removed 2026-08-20, 143,723 km); the UAE row is Active,
entered manually 2026-07-22 with a UAE job card. Identical date and km on two machines in two
countries is not physically possible for one tyre. *Suggests:* the UAE row is a copy or a mistyped
serial. Note the scrap mark is recorded under KSA, so the UAE conflict exists only because the serial
matches; the correction may be `correct_serial` on the UAE row.

## Per tyre

### 1. L52043311 (KSA)
* Scrap mark: 2026-07-29 07:12 UTC, Tyre Data Collector, no reason; prior status: the then-Active row of MP078 RHF1.
* Fitment history:
  * Row created 2026-07-22 (now serial NULL): MP078 RHF1, fitted 2025-11-10 @ 33,000 km, removed 2026-06-16 @ 56,176 km, job card GCKR/JC/1574/0626, Scrapped.
  * Row created 2026-08-02 (upload): MP078 RHF1, fitted 2026-06-16 @ 56,176 km, Active, same job card.
* Inspections of MP078 F1R: one, 2026-11-12, condition Good, serial not recorded.
* Timeline: fitted 2025-11 -> replaced 2026-06-16 -> scrap marked 2026-07-29 -> new fitment row loaded 2026-08-02.
* Evidence suggests: pattern A.

### 2. YMM18886 (KSA)
* Scrap mark: 2026-07-28 10:24 UTC, Tyre Data Collector, no reason.
* Fitment history: removed row TM589 RHRO 2025-09-08 @ 80,000 -> 2026-07-03 @ 145,800 (Scrapped, serial now NULL);
  Active row TM589 RHRO from 2026-07-03 @ 145,800, job card GCKR/JC/0222/0726, created 2026-08-02.
* Inspections of TM589 R2Ro: nine, 2026-09-07 to 2026-11-04, all Good, serial not recorded.
* Evidence suggests: pattern A; a tyre is fitted and in good condition at that wheel.

### 3. YMM22455 (KSA)
* Scrap mark: 2026-07-28 10:13 UTC, Tyre Data Collector, no reason.
* Fitment history: removed row TM643 RHCI 2025-11-04 @ 40,000 -> 2026-02-28 @ 77,805 (Scrapped, serial NULL);
  Active row TM643 RHCI from 2026-02-28 @ 77,805, job card GCKR/JC/2083/0226, created 2026-08-02.
* Inspections of TM643 R1Ri: five, 2026-08-13 to 2026-11-05, all Good.
* Evidence suggests: pattern A.

### 4. YMM68731 (KSA)
* Scrap mark: 2026-07-27 11:39 UTC, Tyre Data Collector, no reason.
* Fitment history: removed row TM619 LHRI 2025-10-01 @ 55,000 -> 2026-02-23 @ 105,184 (Scrapped, serial NULL);
  Active row TM619 LHRI from 2026-02-23 @ 105,184, job card GCKR/JC/1824/0226, created 2026-08-02.
* Inspections of TM619 R2Li: five, 2026-07-29 to 2026-10-17, all Good.
* Evidence suggests: pattern A.

### 5. YMY44573 (KSA)
* Scrap mark: 2026-07-28 10:12 UTC, Tyre Data Collector, no reason.
* Fitment history: removed row TM635 RHCI 2025-10-01 @ 20,000 -> 2026-02-14 @ 68,485 (Scrapped, serial NULL);
  Active row TM635 RHCI from 2026-02-14 @ 68,485, job card GCKR/JC/1183/0226, created 2026-08-02.
* Inspections of TM635 R1Ri: five, 2026-08-18 to 2026-10-26, all Good.
* Evidence suggests: pattern A.

### 6. YMU41519 (KSA)
* Scrap mark: 2026-07-27 09:09 UTC, Admin, reason "Needs to check in the system."; no prior status recorded.
* Fitment history: TM543 RHF1 2025-11-02 @ 145,000 -> 2026-03-01 @ 181,803 (Scrapped, job card GCKR/JC/1304/1125, created 2026-07-22);
  TM411 LHCI from 2026-03-03 @ 54,097 (Active, job card GCKR/JC/0006/0326, created 2026-08-02).
* Inspections: TM543 F1R three (2026-09-15 to 2026-11-08), TM411 R1Li nine (2026-08-17 to 2026-11-01), all Good, serial not recorded.
* Evidence suggests: pattern B; physical check of the serial on TM411 LHCI decides it.

### 7. YMA44467 (UAE active, KSA scrapped)
* Scrap mark: 2026-09-14 09:23 UTC, Tyre Data Collector, no reason, country KSA; prior status: the KSA row (then Removed).
* Fitment history: KSA TM642 RHF1 2025-10-01 @ 60,000 -> 2026-08-20 @ 143,723 (Scrapped, job card GCKR/JC/2513/0826, upload 2026-07-22);
  UAE TM204 RHF1 2025-10-01 @ 60,000, Active (job card RM/RMJC/0039/0326, manual entry 2026-07-22).
* Inspections: TM642 F1R five (2026-08-06 to 2026-11-07, Good); TM204 none.
* Evidence suggests: pattern C.

## What is NOT claimed
* No inspection records a serial at these wheels, so inspections prove a tyre is fitted and in good
  condition, never which serial it is.
* The slot mapping above is an inference from the position codes; the investigator confirms it.
* Nothing in this pack changes a record. The decisions belong to the PMV Manager through the workflow.
