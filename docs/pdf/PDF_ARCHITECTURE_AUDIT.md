# PDF architecture audit and the stored-PDF service

Date: 2026-11-15. Branch `claude/pdf-cache-service-7rxp2t`. Production was read only (catalog and counts).
Nothing in this document was applied to production. Every test figure comes from synthetic data.

Status words used here: Verified (measured or tested in this work), Not Tested, Blocked.

## 1. What exists today (before this work)

### 1.1 Where PDFs are made

| Surface | Engine | Where it runs | Stored | Regenerated on every download |
|---|---|---|---|---|
| Vehicle Tyres Inspection Report (`exportInspectionDetailPdf`, `src/lib/exportUtils.js`) | jsPDF 4.2 + autotable, redraws the on-screen tyre map and Vehicle Overview board from the rendered page | Browser | No | Yes |
| Tyre Observation Report (`src/lib/observationReportPdf.js`) | jsPDF | Browser | No | Yes |
| Daily Tyre Inspection (checklist) report (`inspectionChecklistReport.js`) | jsPDF + autotable | Browser | No | Yes |
| About 50 other files (accident case, checklist, handover, wash, board, executive, table exports through `exportToPdf` used by 213 files) | jsPDF, loaded through `pdfEngine.js` or `ensurePdf` | Browser | No | Yes |
| Scheduled report emails (`send-scheduled-reports`) | HTML email, no PDF | Edge function | No | n/a |
| Emailed report attachment (`emailService.js` to `send-email`) | PDF made in the browser, sent as base64 (7 MB cap) | Browser, relayed | No | Yes |
| `services/report-engine` | Playwright HTML to PDF for table reports | Optional Node service, not deployed (`VITE_REPORT_SERVICE_URL` unset) | No | Yes |
| Expo app (`mobile/lib/inspectionReportPdf.ts`, `accidentPdf.ts`, reports, driver workspace) | `expo-print` HTML to PDF on the phone | Phone | No (shared from a temp file) | Yes |
| Flutter app (accident case, handover, vehicle 360, records) | `pdf` / `printing` packages | Phone | No | Yes |

So: every PDF in the product is generated on the device that asks for it, every time. No PDF is stored anywhere.

### 1.2 Storage and jobs in production (read only, counts only)

- 9 private buckets. None holds a PDF (0 objects ending in .pdf). `tyre-photos` holds 27,806 objects, 5.86 GB,
  average 0.21 MB. No bucket is suitable to reuse: the photo buckets accept images only, `import-files` is for
  uploads, `tenant-exports` is readable by the platform owner only. A new private bucket is the right answer.
- No table records a generated report. `report_shares`, `report_schedules`, `report_send_log` are about links and
  emails. `tenant_export_jobs` and `ai_tyre_inspection_jobs` are the existing job tables; the AI worker's pattern
  (status, attempts, retry bound, cron kick) is the model used here for leases and retries.
- 27 cron jobs, none for PDFs.
- Inspections: 2,673 rows, 2,390 approved, 776 created in the last 30 days.
- `observation_erp_links` exists in production, so the observation key can read ERP confirmation state.

### 1.3 Why the inspection report cannot simply move to a server

The approved layout is drawn from the page: `captureTyreBoard()` reads the wheel cards, leader lines and photo
geometry of the rendered `TyreBoard`, and the tyre map is the live SVG. A server has no rendered page. Moving the
drawing to a server means either a headless browser that signs in and opens the app, or rewriting the report in a
second engine, which would change the approved layout. Both are outside "do not modify the approved inspection PDF
layout". So this work keeps the drawing where it is and stores the result.

## 2. Measured generation time (Verified, synthetic)

Harness: `e2e/pdf/` builds the real generator, the real renderer hook and the real diagram components, swaps only
the Supabase client for an in-memory stand-in, and drives them in headless Chromium (`node e2e/pdf/run.mjs`).
Synthetic inspections with 4, 12 and 14 tyre photos, synthetic photos of 1280 px and 252 KB average (production
average object is 0.21 MB), two signatures, vehicle picture, tyre map, overview board, QR code.

Photos are served from the same machine, so a network profile (Chromium throttling) stands in for a real connection.

### 2.1 Where the time goes (12 photos)

| Step | Local, no network cost | Office wifi 20 Mbps / 40 ms | Site 4G 9 Mbps / 170 ms | Weak 3G 1.6 Mbps / 300 ms |
|---|---|---|---|---|
| Photo download (12 files, 3.1 MB) | 49 ms | 1,809 ms | 4,859 ms | 19,157 ms |
| Photo decode and resize to 600 px | 163 ms | about the same | about the same | about the same |
| Everything else: SVG capture, board capture, vehicle picture, signatures, tables, QR, save | about 170 ms | about 500 ms | about 800 ms | about 1,000 ms |
| Total | 386 ms | 2,498 ms | 5,821 ms | 20,392 ms |
| Share of the total spent downloading photos | 13% | 72% | 83% | 94% |

Other figures:

- Library load (jsPDF, autotable, QR), first use in a page: 40 ms from local disk cache; one extra download of
  about 400 KB on a cold browser. Not a bottleneck.
- 4 photos: 271 ms local. 14 photos: 350 ms local (the report prints at most 12 photos, so 14 behaves like 12).
- First generation in a fresh page (libraries not loaded yet): 591 ms / 779 ms / 758 ms for 4 / 12 / 14 photos.
- Same 12-photo report on a processor four times slower (a tablet or an old laptop), office wifi: 4,613 ms.
- sha256 of the finished file: 1 ms. File size: 0.30 MB (4 photos), 0.83 MB (12 photos).
- Observation report with 4 findings and photos: 594 ms local, 0.28 MB.

Conclusion: the bottleneck is downloading the evidence photos again for every download, then decoding them. The PDF
library is not the problem. A person on a site connection waits 6 to 20 seconds for a report that has not changed.

### 2.2 Before and after (Verified on the harness, simulated round trips)

First download = look up, claim, generate, upload, complete. Repeat download = look up, sign a link.

| Case | Before (every download) | After, first download | After, repeat download |
|---|---|---|---|
| 4 photos, office wifi (80 ms round trip) | not measured on this profile (0.27 s with no network cost) | 2.05 s | 0.16 s |
| 12 photos, office wifi | 2.5 s | 3.45 s | 0.16 s |
| 14 photos, office wifi | as 12 photos (the report prints at most 12) | 3.46 s | 0.16 s |
| 12 photos, site 4G (340 ms round trip) | 5.8 s | 9.9 s | 0.68 s |

The repeat download is two round trips and no generation: inside the 1 to 2 second target on every profile tested.
The first download is slower than before by the upload and three extra calls (about 1 s on wifi, about 4 s on 4G,
most of it uploading 0.8 MB at 3 Mbps). That cost is paid once per revision, by one person.

The repeat figure is the time until the browser has the signed link. The browser then downloads the file itself
(0.3 to 0.8 MB). Not Tested against the hosted project: real round-trip times to Supabase.

Other harness results:

- Two people pressing Download for the same inspection at the same time: 1 generation, 1 stored row; the second
  person received the first person's file.
- Bulk ZIP: 20 stored reports in 1.3 s (6.0 MB), 50 stored reports in 3.3 s (14.9 MB), 20 reports of which 10 had
  to be generated first in 5.8 s.
- The documents are unchanged by this work: the inspection report (3 pages, 17 images, 3,017 characters) is identical
  page by page (text, image count, drawing operations) with and without the new option; the observation report
  (5 pages, 5 images) saved through the original path is identical to the bytes the cache stores.

## 3. The stored-PDF service

### 3.1 Design in one paragraph

The browser draws the PDF exactly as today. Before drawing, it asks the database whether the current revision of
that document is already stored. If yes, it gets a short-lived link and the download starts. If no, exactly one
browser becomes the generator (a lease), draws the PDF with the existing generator, uploads the bytes to a private
bucket and marks the job complete. Everyone else waits for that file instead of drawing their own. Failures are
recorded and retried a bounded number of times.

### 3.2 Database draft (`supabase/pending_migrations/20261117090000_report_pdf_cache.sql`, not applied)

- Bucket `report-pdfs`: private, `application/pdf` only, 25 MB per file.
  Path `<organisation>/<report type>/<source id>/<cache key>.pdf` (regenerations add `.g2`, `.g3`).
- `report_pdf_files`: organisation, country, site, report type, source id, cache key, source hash, evidence
  revision, template version, branding revision, client revision, generation, path, file name, bytes, sha256,
  status (queued, processing, ready, failed, retry_scheduled), lease owner and expiry, attempts, next retry,
  approved and immutable flags, superseded markers, created by, timestamps. One current row per organisation and key.
- `report_pdf_events`: append-only audit (claimed, generated, failed, retry_scheduled, lease_recovered, superseded,
  regenerate_requested, downloaded, manual_retry, released), each with its actor.
- Functions: `pdf_cache_lookup`, `pdf_cache_claim`, `pdf_cache_heartbeat`, `pdf_cache_complete`, `pdf_cache_fail`,
  `pdf_cache_regenerate`, `pdf_cache_record_download`. All re-check organisation, country, site and active account
  themselves; none is executable by anon; the helpers that bypass caller scope are not executable by signed-in users.
- Row level security: organisation (restrictive), country and site (restrictive, same expressions as
  `inspections`), plus "the caller can still read the source record" through the source table's own policies.
  No insert, update or removal policy: writes only through the functions.
- A trigger freezes a ready row: bytes, sha256, path and key can never change. A row made from an approved source is
  immutable and cannot be removed. Regenerate creates a new generation and keeps the old one.

### 3.3 The cache key

Computed by the SERVER from the live source row, so a client cannot call an old file current.
sha256 of: key version, organisation id, report type, source id, source hash, evidence revision, template version,
branding revision, client revision. A file name is never part of the key.

| Part | Inspection report | Observation report |
|---|---|---|
| Source hash (canonical JSON of printed fields, including approval state and signatures) | 29 inspection fields | 15 inspection fields + the corrective actions raised from it + their ERP confirmation links |
| Evidence revision | every photo reference with the stored object's revision, plus completed AI findings | every photo reference with the stored object's revision |
| Template version | `ins-2026.11.1` | `obs-1.0` |
| Branding revision | logo (path, not the signed link), accent, footer, company name, diagram background | console logo |
| Client revision | none | each finding's wording, readings and whether the tyre was since replaced |
| ERP link or confirmation state | NOT included | included |

So confirming an ERP job card makes a new observation revision and leaves the inspection PDF untouched (tested).
`src/lib/pdfCache/cacheKey.js` mirrors the SQL; both are replayed over one fixture
(`src/test/fixtures/pdfCacheKeyCases.json`). `src/test/pdfTemplateVersionPin.test.js` fails when a generator's
source changes without a template version bump.

Deliberately NOT in the inspection key (stated so nobody is surprised): the expected tyre life panel, the inspection
ordinal and the signer display names are read live when the report is drawn. The stored copy shows them as they
were on the day it was generated, which is printed in its header. A manager can press Regenerate latest.

### 3.4 Signed link: storage policy, not a function (decision)

The link is made by the browser with `createSignedUrl`. The storage policy on the bucket only lets a caller read an
object whose `report_pdf_files` row that caller can read (organisation, country, site, source record). So the
storage service itself performs the authorisation, on the server, with the caller's own identity, and there is no
service-role code path to get wrong. An RPC cannot mint a storage link from SQL, and an edge function would need a
deployment and a service key; neither adds safety here. The download is audited by a separate call that does not
delay the download. Limit: that audit call is made by the client, so it records honest clients; Supabase storage
logs remain the independent record.

### 3.5 Client (`src/lib/pdfCache/*`, `src/lib/api/pdfCache.js`)

- `getOrCreatePdf({ type, sourceId, brandingRev, clientRev, fileName, generate })`: look up, serve the stored
  file, or claim, generate with the existing generator, upload, complete. Waits (bounded, 90 s) when somebody else is
  generating. Plain messages through `safeError`, with Retry.
- A copy with missing evidence (a photo that would not load, ERP evidence unreadable) is handed to the person but
  never stored. Otherwise a bad copy would be served for ever.
- Before the migration is applied, or if the cache cannot be reached, it generates directly as before. Merging the
  code first is safe.
- A stored download skips the generator, so the export switch and the export audit are applied explicitly.
- Screens: Download PDF, View PDF, Regenerate latest (manager, director, administrator; an approved revision needs an
  administrator and a reason), previous stored versions, and the states Ready, Preparing, Update available, Failed.
  An older copy is always labelled previous and never current.
- Generators changed minimally: the inspection generator already had `save: false`; it gained a caller-side list
  of evidence that could not be embedded (no drawing change). The observation generator gained `save: false` and the
  same list. File names are unchanged.

### 3.6 Security notes and residual risk

- A browser draws the PDF, so an authorised user who can read the inspection could in principle upload different
  bytes for it. Mitigations: only a user who may read the source can generate; the row records who generated it
  and the sha256; ready rows are frozen; approved revisions cannot be replaced without an administrator and a
  reason. Removing this risk needs a server renderer (section 5).
- The server cannot read file bytes from SQL. `pdf_cache_complete` checks the stored object exists, its size and
  type against what the client reports, and records the sha256. The client re-checks the sha256 when it reads the
  bytes (bulk ZIP). A single download goes straight from storage to the browser and is not re-hashed.
- A logo replaced under the same storage path does not change the branding revision.

## 4. Automatic generation and bulk export

### 4.1 Automatic generation (what is built, and its honest limit)

- On approval in the web app, the approver's browser prepares and stores the report in the background, after the
  approval has been saved. It cannot block or fail the approval.
- Draft `20261117091000_report_pdf_autoqueue.sql`: a trigger on `inspections` records "a PDF is wanted" when a
  record becomes completed or approved anywhere (phone, import). It only reads the row and can never stop a save.
  The next authorised person who opens the inspections page serves up to three open requests in the background
  (skipped on a data-saver connection or a hidden tab), with the same lease and bounded retries.
- Limit: until somebody opens the web inspections page, a report approved on the phone is not prepared. Fully
  unattended generation needs a headless renderer.

### 4.2 Bulk ZIP (built, in the browser)

- Inspections register: select rows (now available to every reader, removal stays administrator only), then
  Download N PDFs. Limit 10, 50 or 100 from `system_config.pdf_bulk_limit` (default 50).
- Stored PDFs are zipped as they are after a sha256 check; missing ones are generated two at a time and stored.
- `manifest.csv` and `manifest.json` list every selected record: included (file name, revision, generation,
  approved revision, sha256, bytes, origin) or missing with the reason. Nothing is dropped silently.
- The task lives outside the page component and shows in a tray, so it continues when the person opens another page
  of the app. Reports that still needed drawing at that moment are listed as missing (the drawing needs the
  inspections page). A browser reload ends the task. This is a background task in the page, not a server job.
- JSZip was already a dependency (`jszip` 3.10) and is loaded only when a bulk download starts.
- Observations list bulk download: Not built (next step: an off-screen renderer for the observation report like
  the inspection one).

### 4.3 Server job design for large exports (draft only)

`20261117092000_report_export_jobs_DESIGN.sql` holds the table a later edge-function worker would use: the request
(report type, up to 1,000 source ids), status, lease, manifest, ZIP path in `tenant-exports`, expiry. The worker
would zip STORED PDFs only and list the rest as "not generated". It is not applied and no code uses it.

## 5. A headless renderer for unattended generation (estimate, not built)

What it would be: a small container (the existing `services/report-engine` already runs Playwright) that signs in
as a service account restricted to reading inspections, opens a print route of the web app for one inspection,
runs the same generator and uploads the result. It would serve the queue from 4.1 and remove the residual risk in 3.6.

Assumptions: 800 inspections a month (776 in the last 30 days), 2 revisions each on average, 6 s of browser time
per report, 1 vCPU / 2 GB container.

- Compute: 1,600 reports x 6 s = 2.7 hours a month. On a pay-per-use container host that is well under 5 USD a month;
  an always-on small instance is 7 to 25 USD a month depending on the host.
- Build effort: about 1 to 2 weeks including the print route, service account, queue worker, monitoring and tests.
- It was not built here: it needs a paid resource, a new deployed service and a service credential, all of which
  need the owner's approval.

## 6. Storage and compute cost of what IS built (estimate)

Assumptions: 800 inspections a month, average stored PDF 0.6 MB (measured 0.30 MB at 4 photos, 0.83 MB at 12),
2 stored revisions per inspection, observation reports for a quarter of them at 0.3 MB.

- Storage growth: 800 x 2 x 0.6 MB + 200 x 0.3 MB = about 1.0 GB a month, 12 GB a year. The photo bucket already
  holds 5.9 GB. At the published Supabase rate of about 0.021 USD per GB-month beyond the plan's included storage,
  12 GB costs about 0.25 USD a month if it is all overage.
- Download traffic: a stored download is 0.3 to 0.8 MB. It replaces 1 to 3 MB of photo downloads per report, so
  total egress goes DOWN for every repeat download.
- Database: one indexed lookup per download (27 ms average with 30 sessions at once on the local machine).
- Compute: none on the server. The first download costs the generating browser one upload.
- Retention rule (drafted, not automated): keep every approved revision; superseded working copies and failed jobs
  may be purged after 90 days by a service job. With that rule the 12 GB a year figure roughly halves.

## 7. Mobile (audit only, nothing changed)

- Expo: `mobile/lib/inspectionReportPdf.ts` builds an HTML report with `expo-print` on the phone, a different layout
  from the approved web report. Flutter builds its own with the `pdf` package.
- What would change to use the stored copy: the phone calls `pdf_cache_lookup` for `tyre_inspection`; when the
  state is ready it downloads the stored file through a signed link and shares it (the approved layout, no
  generation, works on weak connections). When it is not ready the phone keeps its own report as today and the
  trigger queue (4.1) asks a web browser to prepare it. The phone must never claim a job, because it cannot draw the
  approved layout.
- Needs: one small service function per app, a build of each app (the owner decides builds), and for Flutter the
  reserved wiring files stay untouched.

## 8. What was not done

- Corrective-action report and maintenance job-card report on this service. The database draft already accepts both
  report types (lookup tested); no client is wired. Steps: add each generator's `save: false` path, a request
  builder, a template version and pin, and mount `StoredPdfPanel`.
- A Playwright test of the real web UI against the local stack. The existing e2e harness answers storage calls with
  501, so it cannot exercise upload and signed links without a storage stand-in. The UI wiring is covered by unit and
  render tests and by the harness that drives the real renderer hook, not by a signed-in browser session.
- A 50-session concurrency run. The local cluster allows 40 connections; 30 sessions were used.
