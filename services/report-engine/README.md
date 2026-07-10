# Tyre Pulse — Report Engine (server-side PDF)

Pixel-perfect, branded, RTL-aware PDF reports rendered with **Playwright (Chromium) HTML→PDF**. It consumes the **same report-definition payload** the in-app client engine builds from the live table state (`src/lib/report/tableReport.js` → `buildReportDefinition`), so the server reproduces exactly what the user saw on screen — same columns, order, rows, KPIs and charts — with no re-query.

This service is **optional**. The app ships a fully working client-side exporter (PDF/Excel/CSV) with zero infra. Deploy this only when you want print-grade PDF layout and/or centralized/scheduled report generation. When the client env var `VITE_REPORT_SERVICE_URL` is set, the app's PDF exports route here automatically and **fall back to the client engine on any error**.

## Endpoints

| Method | Path           | Body                     | Response          |
|--------|----------------|--------------------------|-------------------|
| GET    | `/health`      | —                        | `{status:"ok"}`   |
| POST   | `/reports/pdf` | `ReportDefinition` JSON  | `application/pdf` |

`ReportDefinition` is validated by `src/reportSchema.js` (zod). Shape:

```jsonc
{
  "title": "Fleet Master — Tyre Register",
  "company": "Readymix Concrete Company",
  "locale": "en",                 // "ar" → RTL
  "currency": "SAR",
  "dateRange": "2026-01-01 to 2026-01-31",
  "exportMode": "filtered",       // current | filtered | selected
  "filtersSummary": { "Site": "Riyadh", "Sorted by": "cpk ↓" },
  "columns": [{ "key": "asset_no", "header": "Asset No" },
              { "key": "cpk", "header": "CPK", "align": "right" }],
  "rows": [{ "asset_no": "RMX-1187", "cpk": 0.42 }],
  "kpis":  [{ "label": "Avg CPK", "value": "SAR 0.40" }],
  "charts": [{ "title": "CPK by site", "image": "data:image/png;base64,..." }],
  "branding": { "primary_color": "#16a34a", "logo_url": "https://…/logo.png",
                "footer_text": "Confidential" },
  "orientation": "landscape",
  "fileName": "TyrePulse_FleetMaster"
}
```

Charts are captured on the client (`canvas.toDataURL('image/png')`) so the PDF shows the **exact** on-screen chart.

## Run locally

```bash
cd services/report-engine
npm install            # postinstall downloads Chromium
npm start              # listens on :8080

# smoke test
curl -s localhost:8080/health
curl -s -X POST localhost:8080/reports/pdf \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo","columns":[{"key":"a","header":"A"}],"rows":[{"a":1}]}' \
  -o demo.pdf
```

Run the Playwright-free unit tests (template + schema):

```bash
npm test
```

## Docker

```bash
docker build -t tyrepulse-report-engine services/report-engine
docker run -p 8080:8080 tyrepulse-report-engine
```

## Deploy (Render / Fly.io / Railway / any container host)

1. Deploy this directory as a container (the `Dockerfile` uses the official Playwright image — Chromium is preinstalled).
2. Set env vars:
   - `PORT` (default 8080)
   - `REPORT_API_KEY` — if set, callers must send header `X-Report-Key: <key>`
   - `ALLOWED_ORIGIN` — CORS allow-list, comma-separated (e.g. `https://tyrepulse.app`); `*` by default
   - `REPORT_MAX_CONCURRENCY` — bounded Chromium concurrency (default 3)
3. Point the frontend at it:
   - `VITE_REPORT_SERVICE_URL=https://reports.yourhost.com`
   - `VITE_REPORT_API_KEY=<same as REPORT_API_KEY>` (optional)
   - Redeploy the Vercel app. PDF exports now render server-side, falling back to the client engine if the service is unreachable.

## Scaling / scheduling (future)

For high volume or scheduled delivery, put a queue in front (BullMQ + Redis): enqueue `ReportDefinition`s, have workers call `renderPdf`, and store the result in Supabase Storage / S3, returning a signed download link. The renderer already reuses one Chromium instance with bounded concurrency, so it is queue-worker friendly as-is.
