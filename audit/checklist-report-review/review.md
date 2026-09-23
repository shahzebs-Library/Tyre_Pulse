# Inspection, checklist and anomaly review — 10 September 2026

Reviewed the three supplied PDFs visually and by extracted text. Source changes target the React web app and are not deployed. Original files and stored submissions have not been overwritten.

| Evidence in the supplied report | Correction |
| --- | --- |
| WL036: all four tyres shown as approaching end of life at 34% used, with 5,865 km remaining against an 8,883-km expected life. | Cap the fixed early-warning distance/hours at 10% of a known expected life; retain overdue and >=90%-used alerts. |
| WL036: remaining days printed as 0 without a usable days baseline. | Preserve an unknown days estimate as N/A; retain a genuine zero when a positive baseline exists. |
| WL036: summary says all positions are Good, but the diagram has a grey wheel. | Summarize mapped wheel readings, count unrecorded diagram positions, and explicitly list unmapped recorded positions. Stored positions are not guessed or rewritten. |
| WL036: inspection meter 17,214 km versus tyre-life table 15,363 km. | Identify the tyre-life table as separately retrieved fleet estimates rather than the inspection snapshot. The source meter discrepancy still requires reconciliation. |
| Inspection approver displayed as a UUID. | Print a recorded approver name/email when available; otherwise show the name as unrecorded. Do not treat an internal ID as a human name. |
| BH006: hour meter -3; signatures heading stranded on the previous page. | Warn on the historical invalid meter, reject negative/nonfinite meter entry in the web form, and reserve space for the heading plus signature row. |
| TM660: safety guards marked Not OK / Broken, while certification says fit for operation: Yes. | Flag the contradictory historical answers; prevent a new web submission certifying fitness while a Not OK answer remains. |
| Checklist attachments show other asset numbers, including TM556. | Preserve attachments and add an explicit evidence-verification note. Actual replacements require the correct photos and confirmation from the record owner. |
| Footer spelling: confidinetial. | Correct that spelling in rendered PDF footers without changing unrelated configured footer text. |
| Reports could imply all checks passed when answers were blank. | State that the checklist is incomplete; retain the unanswered count. |
| Inspection PDF download could remain busy after a missing record or hide generation errors. | Clear the busy state and show a recoverable error; require the full inspection record before export. |

Anomaly Intelligence corrections: separate same-number assets and cost baselines by country; display source currencies; coerce numeric cost strings before statistical calculations; avoid duplicate vehicle row IDs across countries; report failed workshop reads as incomplete; clear old results when rescanning; compute peak visit windows with a linear scan.

Operational follow-up: confirm the actual BH006 engine hours and the unusually low checklist kilometre readings; replace or confirm wrong-vehicle attachments; review the TM660 fitness certification and wheel-position mappings through the normal audited process. The software cannot infer corrected historical measurements or certify that a photographed check was performed. Web validation does not retrofit the installed mobile clients or replace database validation.

Validation examples are synthetic test fixtures, not replacement signed reports. The PDFs under `audit/checklist-report-review/validation-*.pdf` were generated and visually checked. Focused report/model tests passed (177), added report/entry tests passed (31), and the failed-workshop-source rendering test passed. Final package-gate results are recorded with the completion response.

Final verification: full lint and production build passed. Full web suite: 9,248 passed, four failures across navigation favourites, asset-history UI and checklist-builder targeting. All three affected files passed when rerun with one worker (25 tests); the full suite was not repeated. The added failed-source test passed (1), submission regression tests passed (10), report regression tests passed (9), and final focused lint passed. Later changes after the package build were limited to export error handling, page-space guards and release metadata; their focused checks passed. The installed production app and historical records were not changed.
