# Import Formats - how each company file is handled

The five files in this folder are the real report formats the business uploads.
Each one has a **saved mapping profile** in the database keyed by its header
fingerprint: when the same format is uploaded to the Data Intake Center, the
mapping is recognised and applied **automatically** (a blue banner shows which
profile was used). Regression tests in `src/test/realFormats.test.js` parse
these exact files on every CI run.

| File | Module | Profile | Notes |
|---|---|---|---|
| `MONTHLY TYRES CONSUMPTION REPORT.xls` | Tyre | GC Monthly Tyres Consumption | Header on row 3; `Printed By/Date` footer stripped automatically. Fix/removal dates, KM+HRS at fitment/removal, total KM/HRS all map to real columns. |
| `VEHICLE COMPLAINTS HISTORY.xls` | Work Orders | GC Vehicle Complaints History | Header on row 3; `GRAND TOTAL` + printed-by footers stripped. **No cost columns are imported from this file** (see cost rule). `Tracking Category` ("Active") is vehicle state, not WO status → kept as custom. |
| `Work Order Details.xls` (XML Spreadsheet 2003) | Work Orders | GC Work Order Details (Cost of Record) | **The only cost source across the app.** The `Trye` column is the pre-calculated tyre amount (qty already applied) → `tyre_cost`. Line items are **aggregated per Work Order Number** (costs summed, every source line preserved in `custom_data.line_items`). `Transaction Type` carries the issue date → `opened_at`. |
| `aeqp_grid1 ... .xls` (Ramco HTML grid) | Fleet | Ramco Assets List | 48-column asset master. Asset No/Desc/Plate/Type/Location/Status/KM/Brand/Model Year/Remarks map to real columns; licences, insurance, MVIP, depreciation etc. are preserved as custom fields. Date-titled columns can never mis-map to name fields (guard in the mapping engine). |
| `data.xlsx` (open JC follow-up) | Work Orders | GC Open Job Cards Follow-up | Transient follow-up list; `Applied filters:` trailer stripped. JC No/Status/Date/Asset/Complaint map; delete the batch when followed up (work-order delete is Admin-only). |

## Cost rule (from NOTES.md - enforced by the profiles)

Tyre cost is taken **only** from *Work Order Details* (`Trye` column, already
qty-calculated, summed per work order). The cost columns in *Vehicle
Complaints History* (`Tyres`, `Spare Parts`, `Lubricants`, `Outside Rep Cost`,
`Total Spare Cost`) are **not** written to cost fields - they are preserved
verbatim in `custom_data` for reference so no data is lost, but they never
enter CPK/spend analytics.

## Format support

The parser accepts: `.xlsx`, `.xls` (binary), **XML Spreadsheet 2003**,
**HTML-grid exports saved as .xls** (Ramco), `.xlsm`, `.xlsb`, `.ods`, CSV/TSV.
Header rows are auto-detected anywhere in the first 25 rows; report footers
(`Printed By/Date`, `GRAND TOTAL`, `Applied filters:`, page stamps, trailing
note lines) are stripped automatically; padded cells are trimmed.

## Same-period files & duplicates

Files covering the same period share JC numbers. Within one file, line items
are aggregated by the profile (no duplicate flags). Across files, a JC that
already exists live is classified as a duplicate and **skipped** (never
double-inserted). Full field-level cross-file merge (enriching one work order
from both Complaints History and Work Order Details) is the next planned
increment - until then, import *Work Order Details* **after** Complaints
History if you want the cost record to win, or keep them as separate
skip-on-duplicate imports.

## Updating a format

If a report gains/loses a column its fingerprint changes and it will fall back
to suggestion mapping. Fix the mapping once in the wizard, then **Save as
profile** - the new fingerprint is stored and future uploads auto-apply again.
