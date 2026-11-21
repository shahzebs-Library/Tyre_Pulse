# 99 - Tyre custody conflicts for owner approval

Production project `jhssdmeruxtrlqnwfksc`. Found by the first complete tyre custody synchronization on
2026-11-21 (07:23 UTC, after `20261121110000_inv_tyre_sync_perf` was applied; doc 96 section 11).

**Nothing below has been changed.** Each conflict is stored as an `open` row in `tyre_custody_conflicts`
and the tyre is shown as custody state `unknown` (basis `conflict`) in `tyre_items` until a person decides.
`tyre_records` and `tyre_status_marks` were not touched by the synchronization (fingerprints equal, doc 96
section 10). A conflict is closed only through the Tyre custody screen (`inv_tyre_conflict_decide`, or the investigate / propose / close path) with an
evidence-based note; correcting the underlying record is a separate, approved action.

## Summary

| # | Country | Serial | Conflict | Active record | Scrap mark | Pattern |
|---|---|---|---|---|---|---|
| 1 | KSA | L52043311 | scrapped_but_active | MP078 RHF1, fitted 2026-06-16, created 2026-08-02 | 2026-07-29 | A |
| 2 | KSA | YMM18886 | scrapped_but_active | TM589 RHRO, fitted 2026-07-03, created 2026-08-02 | 2026-07-28 | A |
| 3 | KSA | YMM22455 | scrapped_but_active | TM643 RHCI, fitted 2026-02-28, created 2026-08-02 | 2026-07-28 | A |
| 4 | KSA | YMM68731 | scrapped_but_active | TM619 LHRI, fitted 2026-02-23, created 2026-08-02 | 2026-07-27 | A |
| 5 | KSA | YMU41519 | scrapped_but_active | TM411 LHCI, fitted 2026-03-03, created 2026-08-02 | 2026-07-27 | B |
| 6 | KSA | YMY44573 | scrapped_but_active | TM635 RHCI, fitted 2026-02-14, created 2026-08-02 | 2026-07-28 | A |
| 7 | UAE | YMA44467 | scrapped_but_active | TM204 RHF1, fitted 2025-10-01, created 2026-07-22 | 2026-09-14 (stamped KSA) | C |

No duplicate conflicts: each (country, serial, type) has exactly one open row.

## Patterns

**A - scrap mark entered before a bulk upload re-created the tyre as Active (5 tyres).** In each case a
Tyre Data Collector marked the serial as scrap on 27-29 July 2026. On 2026-08-02 09:35 UTC one bulk upload
(all five rows carry the same `created_at` to the microsecond, `data_source = upload`) inserted a record for
the same serial with status `Active` and no removal date, with a fitment date that is EARLIER than the scrap
mark (Feb to Jul 2026). So the upload describes the fitment that existed before the tyre was scrapped, and it
arrived after the scrap mark without a removal. Evidence: `createdAfterScrapMark = true` on every row.

**B - same as A, with an earlier scrapped record of the same serial on another asset (1 tyre).**

**C - one serial recorded in two countries (1 tyre).**

## Per conflict

### 1. KSA L52043311 (conflict `10c15603-b28d-4a1b-914c-4a094909d848`)
- Record `3b89c678-a405-44c4-a513-da5155c39a37`: MP078 RHF1, Active, fitted 2026-06-16 at 56,176 km,
  job card GCKR/JC/1574/0626, cost 990.00 SAR, created 2026-08-02 (upload).
- Scrap mark 2026-07-29 07:12 UTC, no reason, by a Tyre Data Collector.
- Recommended action: confirm with the MP078 site whether the tyre is still fitted. If it was scrapped, record
  its removal on the active record (removal date on or after the last fitment, km at removal) through the
  normal tyre change path, then close the conflict as `resolved`. If it is still fitted, the scrap mark is
  wrong: an administrator undoes the scrap mark, then close as `dismissed`.

### 2. KSA YMM18886 (conflict `af7540ca-239e-4efc-987f-3cc6e4fdd140`)
- Record `534dee9f-4709-4e05-b6b7-48eea0aff9c7`: TM589 RHRO, Active, fitted 2026-07-03 at 145,800 km,
  GCKR/JC/0222/0726, 728.08 SAR, created 2026-08-02 (upload).
- Scrap mark 2026-07-28 10:24 UTC, no reason.
- Recommended action: as #1, checking TM589 RHRO.

### 3. KSA YMM22455 (conflict `cf9e53a6-c059-4fbf-bfea-36b70cbd2a18`)
- Record `314b5f57-3647-40a2-aa49-e51d94b32eca`: TM643 RHCI, Active, fitted 2026-02-28 at 77,805 km,
  GCKR/JC/2083/0226, 900.00 SAR, created 2026-08-02 (upload).
- Scrap mark 2026-07-28 10:13 UTC, no reason.
- Recommended action: as #1, checking TM643 RHCI.

### 4. KSA YMM68731 (conflict `d8de0316-19f6-4c0b-ab92-45a3583bbd32`)
- Record `cc851974-92d4-4148-acea-d0387abdb8ae`: TM619 LHRI, Active, fitted 2026-02-23 at 105,184 km,
  GCKR/JC/1824/0226, 900.00 SAR, created 2026-08-02 (upload).
- Scrap mark 2026-07-27 11:39 UTC, no reason.
- Recommended action: as #1, checking TM619 LHRI.

### 5. KSA YMU41519 (conflict `b160535b-2995-45b5-b4c8-4da9ad4902db`)
- Active record `f0884a69-53c0-4a30-aeb8-c829f021d710`: TM411 LHCI, fitted 2026-03-03 at 54,097 km,
  GCKR/JC/0006/0326, 900.00 SAR, created 2026-08-02 (upload).
- Earlier record of the same serial: TM543 RHF1, status Scrapped, fitted 2025-11-02 at 145,000 km, removed
  2026-03-01 at 181,803 km, GCKR/JC/1304/1125, no price, created 2026-07-22.
- Scrap mark 2026-07-27 09:09 UTC, reason "Needs to check in the system.", by a super administrator.
- Reading: the tyre came off TM543 on 2026-03-01 as scrap, yet a fitment to TM411 two days later
  (2026-03-03) carries the same serial. Either the TM411 serial is mistyped (a different tyre), or the
  TM543 removal was not a scrap and the tyre was refitted.
- Recommended action: physically read the serial on TM411 LHCI. If it differs, correct the serial on record
  `f0884a69...` (approved correction) and close as `dismissed`. If it matches, the TM543 removal was not a
  scrap: correct that record's status and undo the scrap mark, then close as `resolved`.

### 6. KSA YMY44573 (conflict `fad5d175-00e6-47d5-bfc9-4843355a5a52`)
- Record `48ff9661-7745-491b-ab6f-b43ebe6f57ae`: TM635 RHCI, Active, fitted 2026-02-14 at 68,485 km,
  GCKR/JC/1183/0226, 900.00 SAR, created 2026-08-02 (upload).
- Scrap mark 2026-07-28 10:12 UTC, no reason.
- Recommended action: as #1, checking TM635 RHCI.

### 7. UAE YMA44467 (conflict `e8f42d83-739c-452e-887b-4fbda2b699d9`)
- UAE record `89932b1d-02b2-4bc1-814b-2f9f9d2da75a`: TM204 RHF1, Active, fitted 2025-10-01 at 60,000 km,
  job card RM/RMJC/0039/0326, 700.00 AED, created 2026-07-22, `data_source = manual`.
- KSA record of the same serial: TM642 RHF1, status Scrapped, fitted 2025-10-01 at 60,000 km, removed
  2026-08-20 at 143,723 km, GCKR/JC/2513/0826, 1,800.00 SAR, created 2026-07-22 (upload).
- Scrap mark 2026-09-14 09:23 UTC, stamped KSA, no reason. A scrap mark is keyed by serial, so it applies to
  both countries' records.
- Reading: both records have the same fitment date, position and fitment km, which points to one physical
  tyre entered twice, once per country, rather than two tyres. The KSA side has a full lifecycle ending in
  scrap; the UAE side is a manual entry whose job card is dated March 2026.
- Recommended action: confirm with the UAE workshop whether TM204 RHF1 carries serial YMA44467. If not, the
  UAE record's serial is wrong (approved serial correction on `89932b1d...`), close as `dismissed`. If it does,
  two different tyres share a serial: record that on the conflict and close as `resolved` only after the
  scrap mark is scoped to the KSA tyre.

## Owner decision needed

For each row: approve the recommended action (or give another), and name who confirms the physical serial
on the vehicle. No record is corrected until that approval is recorded.
