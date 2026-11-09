# Tyre data accuracy from 1 January 2025 onward - dry-run audit (2026-11-09)

Status: **READ ONLY. No production record was changed.** Every correction below is a proposal waiting for
owner approval. Source of truth for the numbers: `public.get_tyre_evidence_audit(country, from, to)` and
`public.v_tyre_fitment_evidence` (migration `20261111090000`, read-only objects, applied). Live screen:
`/data-reconciliation` -> Integrity -> **Tyre data accuracy from 2025-01-01** (click any class count to download
the records with their reasons).

Boundary (rule T20): legacy = fitted before 2025-01-01, kept as is; trusted period = 2025-01-01 to today, strict.

## 1. Baseline (re-checked, matches the brief)

| Country | Legacy fitments | Legacy active | Fitments from Jan 2025 | Undated | Blank serial | Serial not verified (T6) | No fitment km | Removed, no removal km |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| KSA | 14 | 8 | 8,181 | 169 | 1,578 | 1,765 | 205 | 438 |
| UAE | 0 | 0 | 2,455 | 0 | 37 | 44 | 0 | 333 |
| Egypt | 99 | 44 | 491 | 1 | 4 | 6 | 0 | 15 |
| **Total** | **113** | **52** | **11,127** | **170** | **1,619** | **1,815** | **205** | **786** |

Not in the brief: **170 fitments have no date at all** (169 KSA). They are outside both periods and are listed as UNDATED.

## 2. Evidence classification of the 11,127 fitments

| Country | Verified | Partially verified | Provisional | Missing evidence | Conflicting | Duplicate copy | Verified share |
|---|---:|---:|---:|---:|---:|---:|---:|
| KSA | 3,061 | 2,467 | 1,997 | 14 | 589 | 53 | 37.4% |
| UAE | 552 | 1,534 | 82 | 6 | 156 | 125 | 22.5% |
| Egypt | 336 | 82 | 7 | 1 | 32 | 33 | 68.4% |

Rules (first match wins): DUPLICATE > CONFLICTING > MISSING_EVIDENCE > PROVISIONAL > PARTIALLY_VERIFIED > VERIFIED.
See the migration header for each definition.

Reasons behind the gaps (a record can carry several):

| Reason | KSA | UAE | Egypt |
|---|---:|---:|---:|
| Purchase price missing (whole tyre) | 2,170 | 1,761 | 69 |
| Purchase price estimated | 2,016 | 0 | 0 |
| Serial not verified | 1,765 | 44 | 6 |
| Completed, life not measurable | 742 | 352 | 34 |
| Fitment odometer placeholder 1 | 540 | 94 | 7 |
| Removed, no removal km | 438 | 333 | 15 |
| Job card not found in job card register | 429 | 995 (all blank) | 24 |
| Life above the vehicle-class cap | 339 | 68 | 23 |
| Overlapping fitment (T18) | 313 | 175 | 45 |
| No fitment km | 205 | 0 | 0 |
| Identical copy of an earlier row | 53 | 125 | 33 |
| Reversed dates/km, future dates | 0 | 0 | 0 |
| Two active tyres on one wheel / serial active on two vehicles | 0 | 0 | 0 |

**Serials:** of the 1,619 blank serials only **21** lack BOTH a serial and a job card that exists (MISSING_EVIDENCE).
The other 1,598 are real installations backed by a job card; they stay counted as installations with
"Serial Not Verified" and are never merged with another tyre (each weak serial is its own tyre key, T6).
No serial was invented.

## 3. Legacy tyres still marked active (52)

| Finding | KSA | Egypt | Proposal (NOT applied) |
|---|---:|---:|---|
| Same serial fitted on another vehicle later | 1 | 0 | Close the legacy fitment on or before the later fit date |
| A later tyre fitted on the same wheel | 0 | 0 | - |
| No later evidence | 7 | 44 | Keep the record; current occupancy UNVERIFIED |

- **Record `c89bfaaf-a034-4227-8ea5-1fbcf42260b9`**: YMN50625, KSA TM415 LHCI, fitted 2024-09-08, SAR 3,600, still Active.
  The same serial was fitted on TM635 RHF2 on 2025-10-01 (that row is itself Removed with no removal date).
  Proposal: close the TM415 fitment with removal date <= 2025-10-01, removal km unknown (left null, never guessed).
  This follows T5; the purchase price stays on the original row (T1).
- The other 7 KSA (WL037 x3, TM415 x4) were fitted 2024-08-15 / 2024-09-08 with odometer placeholder 1; their vehicles
  were inspected in 2025 but inspections do not record serials. The 44 Egypt rows have no later evidence at all.
  None is marked removed or scrapped because of its age; their lifetime km before 2025 is kept.

## 4. Monthly consumption: installations recorded vs tyres the ERP issued

Installs = new physical tyres + fitments with an unverified serial - identical copies. Compared with the quantity on
tyre lines of the expense grid (T9). Refits are a reused tyre and are not compared.

| Country | Pattern | Evidence |
|---|---|---|
| KSA Jan-Jul 2025 | **Fitments missing** | 1-208 fitments a month vs 118-272 issued (e.g. Jan 2025: 2 vs 150) |
| KSA Aug-Nov 2025 | **Opening-baseline load** | 864 / 1,895 / 1,664 / 816 fitments vs 278 / 208 / 295 / 304 issued; 3,352 wheels appear for the first time in these 4 months |
| KSA Jan-Jul 2026 | **Reconciled** | 233 vs 237, 258 vs 240, 218 vs 234, 294 vs 293, 347 vs 328, 330 vs 334, 385 vs 399 |
| KSA Aug-Oct 2026 | **Fitments missing** | 180 vs 442, 47 vs 300, 22 vs 500 - the monthly tyre file for these months is not loaded yet |
| UAE Jan-Jul 2025 | Fitments missing | 0-56 vs 52-524 issued |
| UAE Aug-Dec 2025 | Over-recorded (baseline) | 176-246 vs 97-157 |
| UAE Feb-Jul 2026 | Mostly reconciled | e.g. 209 vs 214, 154 vs 154, 216 vs 210 |
| Egypt | Mixed, low volume | 2025 months 0-47 fitments vs 2-59 issued |

Consequence: **monthly tyre consumption for KSA before December 2025 and for UAE before 2026 cannot be read from
fitment records**. For those months the ERP issue quantity (expense grid) is the reliable consumption figure; the
fitment rows in Aug-Nov 2025 are largely tyres already on the vehicles when tracking started, not purchases.
The screen states the coverage status of every month so no one reads an unreliable month as a fact.

## 5. Production accuracy table (Jan 2025 onward, read only)

"Verified" = the fitment (or every fitment of the tyre) is VERIFIED. Each country in its own currency (T10).

| Metric | KSA existing | KSA verified | UAE existing | UAE verified | Egypt existing | Egypt verified |
|---|---:|---:|---:|---:|---:|---:|
| Fitments | 8,181 | 3,061 | 2,455 | 552 | 491 | 336 |
| Disputed (conflicting + duplicate + missing evidence) | 656 | - | 287 | - | 66 | - |
| Physical tyres touched | 7,765 | 2,841 | 2,133 | 455 | 437 | 311 |
| Active fitments | 2,588 | 1,582 | 1,370 | 401 | 374 | 309 |
| Removed fitments | 5,593 | 1,479 | 1,085 | 151 | 117 | 27 |
| Tyre-km (no overlaps, no copies) | 156.6M | 52.9M | 26.9M | 4.8M | 1.14M | 0.86M |
| Purchase-only lifetime CPK (per tyre-km) | 0.0254 SAR | **0.0291 SAR** (1,312 tyres) | 0.0158 AED | **0.0162 AED** (63 tyres) | 0.389 EGP | 0.406 EGP (7 tyres - too few) |
| Full lifetime CPK | = purchase-only (repair / retread / recovery tables are empty) | | | | | |
| ERP tyre expense (grid, T9) | 5,379,561 SAR | ACTUAL | 2,713,756 AED | ACTUAL | 8,708,039 EGP | ACTUAL |
| Scrapped fitments | 810 | 233 | 0 | 0 | 0 | 0 |
| Refits | 529 | 101 | 322 | 57 | 57 | 5 |

Verified CPK uses only tyres whose every fitment is VERIFIED, price ACTUAL and km coverage complete.
**KSA verified CPK is 15% above the reported figure**: estimated prices (2,016 fitments, median-of-comparable
backfill) and partially measured km pull the reported CPK down. The reported figure must be shown as PROVISIONAL
until the estimates are replaced by actual prices or excluded.

Nothing in this table is 100% verified; coverage is stated per row.

## 6. Proposed corrections (NOT applied - each needs approval, backup and a tested undo per T16)

| # | Proposal | Records | Impact | Undo |
|---|---|---:|---|---|
| P1 | Close legacy fitment c89bfaaf (YMN50625) on or before 2025-10-01 | 1 | One fewer active tyre on TM415 LHCI | restore status/removal_date from backup |
| P2 | Remove identical duplicate copies, keeping the first-loaded row; where the copy carries the only price, move the price to the kept row first | 211 (KSA 53, UAE 125, Egypt 33); 57 copies carry a price (sum 235,564 in their own currencies) | Fitment counts and km stop double counting | archive table + re-insert |
| P3 | Close the earlier fitment of each overlapping pair when the job card dates the change | 533 | km already excluded (T18); removes the conflict | `tyre_replacement_undo(batch)` |
| P4 | Report KSA Aug-Nov 2025 and UAE Aug-Dec 2025 consumption from the ERP issue quantity, mark fitment-based consumption for those months "baseline load" | reporting only | KSA 2025: ~5,500 recorded installs vs ~2,700 tyres issued by the ERP | n/a (code) |
| P5 | Load the KSA monthly tyre file for Aug-Oct 2026 | data load | closes the 2026 under-recording | n/a |
| P6 | Replace or exclude ESTIMATED prices in CPK headline figures | 2,016 KSA fitments | KSA CPK 0.0254 -> 0.0291 SAR/km on verified tyres | n/a (reporting) |

Record ids: download from the screen (Duplicate copy / Conflicting / Missing evidence counts), or regenerate with
`select id, evidence_class, reasons from v_tyre_fitment_evidence where era = 'modern' and evidence_class = '<CLASS>'`.

## 7. Outstanding exceptions needing a person

- 21 fitments with no serial and no job card (MISSING_EVIDENCE).
- 51 legacy active fitments with no later evidence (current occupancy unverified).
- 170 undated fitments.
- 995 UAE fitments with a blank job card.
- 430 life-above-cap fitments (KSA 339, UAE 68, Egypt 23): real reading needed.
- Unchanged and still protected: the 20 unclear tyre changes, K507B403860, the rotation closer (dry run only).

## Verification
- Dry-run query and the applied function return identical class counts.
- KSA-only Manager (impersonated, RLS): only the KSA block is returned, 3.5 s.
- anon: no execute on the function, no select on the view.
- No business table written; the migration creates one view and one function only.
