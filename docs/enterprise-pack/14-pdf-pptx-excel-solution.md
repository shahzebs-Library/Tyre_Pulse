# 14 - PDF, PPTX and Excel Solution

| Field | Value |
|---|---|
| Deliverable | 14 of 29 (spec section 10 export requirements; "Completion requires: Reports match on-screen data; PDF and PPTX exports validated") |
| Date | 2026-11-10 |
| Status | Partly built. A client-side export stack works across the app with a central policy gate, export audit, clean file names, paper-rendered charts and three table export modes. An optional server PDF engine exists. Not built: Arabic-capable client PDFs, background generation and storage for large reports, and an automated "export equals screen" validation suite. |
| Evidence | Verified in code (2026-11-10): `src/lib/exportUtils.js` (3,884 lines) function list, `src/lib/pdfEngine.js`, `src/lib/chartCapture.js`, `src/lib/exportCapability.js`, `src/lib/report/tableReport.js`, `src/components/ui/ExportMenu.jsx`, `services/report-engine/`, package versions in `package.json`, test file names in `src/test/`. Counts by grep: 266 page/component/console files call `exportToPdf` or `exportToExcel`; 187 pages/console files render `EnterpriseTable` (which carries `ExportMenu`). From PROJECT_MEMORY: the jspdf-autotable incident and chart-legend sizing history. |
| Related docs | `docs/EXPORT_GUIDE.md`, `docs/EXPORT_QUICK_REFERENCE.md`, `docs/BRANDING_AND_REPORT_SETTINGS.md`, `services/report-engine/README.md`, doc 13 (reporting architecture) |

## 1. Export stack

| Layer | File | Responsibility |
|---|---|---|
| Libraries | `package.json`: `jspdf ^4.2.1`, `jspdf-autotable ^3.8.1`, `pptxgenjs ^3.12.0`, `xlsx` (npm alias `@e965/xlsx ^0.20.3`) | All loaded lazily on first export (`ensureXlsx`, `ensurePdf`, `ensurePptx` in exportUtils) so they never ship in a page's first chunk |
| PDF engine resolution | `src/lib/pdfEngine.js` (`loadAutoTable`, `loadPdf`) | Picks a callable jsPDF binding and an autotable function that works with jsPDF 4 |
| Core exporters | `src/lib/exportUtils.js`: `exportToExcel`, `exportSheetsToExcel`, `exportToPdf`, `exportDocumentPdf`, `exportToPptx`, `buildPptxDeck`, `exportInspectionDetailPdf`, `exportAccidentCasePdf`, `exportChecklistSubmissionPdf`, `exportDailyOpsBriefingPdf`, `exportDailyExecutivePdf`, `pdfHeader`, `pdfFooter`, `PDF_COLORS`, `pdfTableTheme` | Branded A4 layouts, table theme, headers/footers, empty-state panels |
| Policy gate | `guardExport` / `applyExportPolicy` in exportUtils; `src/lib/exportCapability.js` (`assertExportAllowed`, `canExportFrom`, `currentExportModule`) | `system_config.export_enabled`, `max_export_rows`, and the per-module `export` capability (per-user revoke). Fail-safe: unreadable config keeps exports on and uncapped |
| Export audit | `recordExport` in exportUtils to `src/lib/auditLogger.js` (`audit.export`) | One EXPORT row per download in `audit_log_v2`, refusals written as "<name> (denied)"; server stamps IP and device (20261005160000); visible in Console Audit Trail "Exports" tab |
| File names | `reportFileName(...parts)`, `reportDateLabel()` | ASCII, space-joined, no underscores or dashes (owner preference), e.g. "TyrePulse Accident Report 14 Jul 2026.pdf" |
| Cell safety | `sanitizeCell` | Neutralises CSV/Excel formula injection (`=`, `+`, `-`, `@` prefixes); pinned by `src/test/exportSanitize.test.js` |
| Charts on paper | `src/lib/chartCapture.js` (`captureChartOnPaper`, `paperChartOptions`, `toPaperOptions`, `PAPER_FONT_PT`, `PRINT_SCALE = 3`, `WHITE_BG_PLUGIN`) | Re-renders a dark on-screen Chart.js chart onto a white canvas at print scale with fonts declared in points, so a legend prints at the stated size whatever the cell width |
| Images | `src/lib/pdfImage.js` (`shrinkImageForPdf`, `PDF_PHOTO_MAX_PX = 600`) | Bounded photo size; transparent WebP flattened to avoid black boxes |
| Table export modes | `src/lib/report/tableReport.js` (`EXPORT_MODES` current / filtered / selected, `buildReportDefinition`, `runTableExport`) + `src/components/ui/ExportMenu.jsx` | Exports the live TanStack table state: visible columns, order, sort, filters, selection |
| Server PDF (optional) | `src/lib/report/serverReport.js` + `services/report-engine/` (Node, Playwright Chromium, zod schema `reportSchema.js`, `templates/reportTemplate.js` with `dir="rtl"` when `locale === 'ar'`) | Used when `VITE_REPORT_SERVICE_URL` is set; falls back to the client engine on any error |
| Specialised renderers | `src/lib/accidentReportPdf.js`, `src/lib/accidentReportPptx.js`, `src/lib/accidentAnalyticsPptx.js`, `src/lib/tyreLifeReportPdf.js`, `src/lib/checklistAuditPackPdf.js`, `src/lib/assetDisposalDeckRender.js`, `src/components/present/PresentationStudio.jsx` | Block-based reports and decks; the accident builder's PDF and PPTX share one engine (`src/lib/accidentReport.js`) |
| Theme | `src/lib/reportColors.js` (8 presets + custom, `system_config.report_palette`), `report_diagram_bg`, company logo from `system_config.company_logo` | Set by super admin in `/console/appearance` (`ConsoleReportAppearance.jsx`) |

## 2. Known pitfalls (each one has bitten production)

| ID | Pitfall | What happened (per project memory unless noted) | Guard in place |
|---|---|---|---|
| X1 | jspdf-autotable 3.x declares peer `jspdf ^2.5.1`; under jsPDF 4 its ESM default export is an OBJECT | Every PDF that drew a table threw "autoTable is not a function" on 30 surfaces (2026-08-06); 6,500 green tests mocked jspdf and missed it | `loadAutoTable()` resolves a callable or falls back to `jsPDF.prototype.autoTable`; `src/test/pdfEngine.test.js` uses the REAL libraries. Rule: never `import('jspdf-autotable')` directly |
| X2 | Mocked exporters hide constructor and peer-range breaks | Arrow-function mocks for `new jsPDF()` / `new pptxgen()` broke under vitest 4 | At least one real-library test per format (`pdfEngine.test.js`, `pptxIntegrity.test.js`) |
| X3 | Chart legends printed at about 4.6 pt | Fixed 1000 px canvas placed in a 135 mm cell | Point-based font sizes scaled by the same factor as the canvas; `chartCapture.test.js` pins the arithmetic |
| X4 | Value-label plugin summed a trend line into a stacked bar total | Printed 1,029 for bars totalling 30 | Datasets flagged `_isTrend` skipped; trend datasets use their own stack group |
| X5 | Dark charts exported black or transparent | Dark theme canvas captured as is | `WHITE_BG_PLUGIN`, `captureChartOnPaper` |
| X6 | Board/accident PDFs labelled AED and EGP figures as SAR | `money()` dropped the currency argument | `governedCost.formatMoney` carries the currency; per-country blocks |
| X7 | Export from a 20-row page passed off as a full export | Work Orders paging (V587) | `getAllWorkOrdersMatching` pages the RPC; truncation past 50k reported, not clipped |
| X8 | `max_export_rows` caps silently | Cap applied in `guardExport` | Callers that pass `opts.title` add a note; not every caller does (gap E5) |
| X9 | Arabic text in jsPDF | jsPDF standard fonts have no Arabic glyphs and no shaping. `grep` 2026-11-10: no `addFont` / Arabic font registration anywhere in `src/` | Not guarded: client PDFs are English-only. The server engine renders Arabic via Chromium but uses system fonts (Helvetica/Arial/Segoe stack) and its deployment is unverified |
| X10 | Large files exhaust the browser | Photo-heavy inspection PDFs; very large Excel | `shrinkImageForPdf`; no background generation (gap E4) |
| X11 | Em/en dashes and curly quotes in output | Owner rule: ASCII report output | `asciiSafe` in the scheduled-report edge function; `reportFileName`; reviewed by hand elsewhere |

## 3. Spec section 10 requirements vs current state

| Requirement | Status | Note |
|---|---|---|
| Same data, filters, date range, sort, grouping, visible columns | Built for EnterpriseTable exports (`buildReportDefinition` reads the live table); page-specific PDFs rebuild from page state | Grouping is not carried by the table exporter |
| Same KPI calculations | Built where the page's KPIs come from a shared engine (doc 13 section 3) | Page-local KPI code in some exports |
| Same charts | Built: charts captured from the live canvas (`captureChartOnPaper`), WYSIWYG in the accident builder | ECharts pages export via their own instance, not all have a PDF |
| Same branding | Built: logo, palette, diagram background, company name | |
| Same language | Not built for PDF (X9); Excel/PPTX carry Unicode text but no RTL layout | |
| Same user scope | Built: exports read through RLS-scoped reads; no server bypass | |
| Three modes: Current View / Full Filtered / Executive | Current, filtered and selected built; "Executive" is a separate report per area (Executive Report, Board Overview PDF, accident packs) | |
| Playwright HTML templates for PDF | Optional service built (`services/report-engine`), unverified deployment | |
| PptxGenJS | Built | |
| ExcelJS / openpyxl | Decided: SheetJS (`xlsx` fork) instead; multi-sheet via `exportSheetsToExcel` | Styling is limited compared to ExcelJS |
| Background workers + object storage | Not built | Tenant export (`tenant-export` edge fn, private bucket `tenant-exports`) is the only server-generated file today and shows the pattern |

## 4. Validation plan: exports must match the screen

Completion requires "Reports match on-screen data" and "PDF and PPTX exports validated". Proposed plan:

1. **Definition parity test (unit, per table page).** For a fixture table state, assert that
   `buildReportDefinition` returns exactly the visible columns in order, the filtered row count, the sort key
   and the filter summary. One shared test helper, run over the 187 EnterpriseTable pages by a source scan that
   fails when a page builds its own export bypassing `ExportMenu`. Phase 2, M.
2. **Number parity test (per KPI).** For each registered metric (`metric_registry`), compute the value through
   the canonical service and through the exporter's data payload and assert equality. Start with the 12
   registered KPIs. Phase 3, M.
3. **Real-library smoke per format.** Generate one PDF, one PPTX and one XLSX with the real libraries in CI and
   assert: file opens (PDF magic bytes and page count via pdf.js; PPTX zip contains `ppt/slides/slide1.xml`;
   XLSX parses back with the same row count). Extends `pdfEngine.test.js` and `pptxIntegrity.test.js`.
   Phase 2, S.
4. **Visual check of PDFs.** Render page 1 of key PDFs (inspection report, accident case, executive report,
   board overview) to PNG with pdf.js in Playwright and compare to a stored baseline at a tolerance. Phase 3, M.
5. **Arabic check.** Once an Arabic font is embedded, assert that an Arabic string round-trips through the PDF
   text layer and that shaping is correct in the visual baseline. Phase 4, M.
6. **Cap disclosure check.** When `max_export_rows` truncates, the file must say so (test every exporter path
   that calls `guardExport`). Phase 2, S.

## 5. Format specifics

Excel:
- `exportToExcel(rows, columns, headers, filename, sheetName, opts)` and `exportSheetsToExcel(sheets, ...)` for
  multi-tab workbooks (inspection reports put a summary tab first; ERP upload workbook in Duplicate Control
  writes one sheet per destination table).
- Every string cell passes `sanitizeCell` (prefixes `'` before `= + - @`, tab, CR).
- Money columns carry the currency in the header (for example "Cost (SAR)"); the All-countries scope exports
  per-country rows, never a blended total.
- Estimated values carry a basis column (expense export "Cost basis": From ERP / Estimated from item code).

PowerPoint:
- `exportToPptx` / `buildPptxDeck` (exportUtils), `accidentReportPptx.js` (block-based, 16:9, live-canvas chart
  images with a native chart fallback), `accidentAnalyticsPptx.js` (one chart per slide), disposal decks
  (`assetDisposalDeckRender.js`, `brandDeckTheme.js`), Presentation Studio.
- `src/test/pptxIntegrity.test.js` and `accidentReportPptx.test.js` check deck structure.

PDF:
- A4, portrait or landscape, branded header (`pdfHeader`, logo from tenant branding else
  `system_config.company_logo`) and footer with page x of y.
- Long tables paginate with a continuation header guarded by page number, so the header never paints over the
  first page's document number.
- Inspection report embeds the actual app tyre-map SVG (selected by `svg[data-tyre-map]`), not a redraw.

## 6. Error handling for exports (spec "Enterprise Error Handling")

- Disabled exports and capability refusals throw a user-safe message ("Exports are disabled by your
  administrator.") and are audited as denied.
- Failures inside renderers surface through `toUserMessage` (`src/lib/safeError.js`); the raw error goes to
  Sentry via `captureError` with a reference id.
- The server engine falls back silently to the client engine on any error, so an outage never blocks the user.
- Gap: there is no "report is being generated, you will be notified" flow, because nothing is generated in the
  background (E4).

## 7. Gaps and recommendations

| ID | Gap | Recommendation | Phase | Effort |
|---|---|---|---|---|
| E1 | Client PDFs cannot render Arabic (X9) | Route PDF exports through the report engine when locale is Arabic, with an embedded Arabic-capable font (for example Noto Naskh Arabic, licence OFL) bundled in the service; or embed the font in jsPDF with a shaping step | 4 | L |
| E2 | Report engine deployment unknown | Decide hosting (container), set `VITE_REPORT_SERVICE_URL` and `REPORT_LOGO_ORIGINS`, add a health check to Console System Health | 4 | M |
| E3 | jspdf-autotable has no release supporting jsPDF 4 | Keep `loadAutoTable`; track upstream; consider pinning jsPDF 3 only if a security fix requires it | 2 | S |
| E4 | No background generation or storage for big reports | Reuse the tenant-export pattern: job row, edge function or worker, private bucket, signed link, notification when ready ("The report is being generated...") | 4 | L |
| E5 | Truncation by `max_export_rows` not always disclosed | Return a `truncated` flag from `guardExport` and print a note in every format | 2 | S |
| E6 | Exports outside `exportUtils` (some page-built decks) may skip the policy gate | Source-scan test: any `import('jspdf')` / `pptxgenjs` outside the approved renderers must call `applyExportPolicy` | 2 | S |
| E7 | Executive export mode is not a mode | Add an "Executive" option to `ExportMenu` that renders KPI tiles + top N rows + charts using `metric_registry` ids | 4 | M |

## Open decisions for the owner

1. Approve hosting the Playwright report engine (cost and an extra service to operate) to unlock Arabic PDFs,
   print-grade layout and attached scheduled reports.
2. Keep SheetJS or move to ExcelJS for styled workbooks.

## Next actions

| Action | Phase | Effort |
|---|---|---|
| E3, E5, E6 and validation steps 3 and 6 | 2 | S each |
| Validation steps 1, 2, 4 | 2-3 | M |
| Deploy report engine (E2), then Arabic PDFs (E1) | 4 | M + L |
| Background generation and storage (E4) | 4 | L |
