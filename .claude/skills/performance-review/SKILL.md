---
name: performance-review
description: Measure-first performance review for Tyre Pulse - web Core Web Vitals and bundle, API waterfalls and PostgREST paging, Supabase query plans under RLS, and Flutter rebuild/startup/memory. Use for "the app is slow", "performance audit", "page takes long", "optimize", "bundle size", "query is slow".
---

# Performance review

Measure before changing anything, and re-measure after. Quote numbers (ms, KB gzip, buffers), not adjectives.

## Web app (Vite, `src/`)
- **Bundle**: `npx vite build` and read the chunk report. Eager graph (what `index.html` modulepreloads) must stay
  free of chart.js, xlsx, jspdf, pptxgenjs, echarts, html2canvas. Check what a vendor chunk *exports* when it
  appears on the login page. Budget: note the current eager gzip total and never grow it without reason.
- **Core Web Vitals**: Playwright + `PerformanceObserver` for LCP/CLS, or Lighthouse CLI if available, on `/login`
  and one heavy page (dashboard) at 390x844 and 1440x900.
- **Request waterfall**: count requests on mount per page (Playwright `page.on('request')`). `fetchAllPages` pages
  1000 rows; a table of 90k rows is 90 requests - use a server aggregate RPC for totals and server paging for tables.
- **Rerenders**: a context value object recreated each render, effects depending on objects, a loader depending on
  state a mount effect fills in (runs twice: seed state in the `useState` initializer).
- **Search inputs**: debounce (~300 ms) before querying.
- **Images/fonts**: sized, lazy below the fold, modern formats; fonts via next/font (marketing) or preloaded.
- **Realtime**: every `postgres_changes` subscription costs WAL decode on the database; subscribe only where a
  consumer acts on the payload (V582).

## Marketing (`marketing/`)
`next build` route sizes; LCP image `priority` only on the first hero image; no layout shift from fonts (next/font
`display: swap`); no client JS on static sections beyond the carousel.

## Supabase
- EXPLAIN (ANALYZE, BUFFERS) **as `authenticated` with a real user's claims** - the MCP role bypasses RLS and
  reports misleadingly fast plans.
- Timing flat with page size -> per-row policy/function cost (wrap zero-arg helpers as `(select fn())` InitPlans;
  materialise small lookup tables in LATERALs).
- Only same-transaction, warm-up-discarded, order-reversed comparisons are meaningful on this instance (5-7x
  call-to-call variance). `shared_buffers` is 256 MB; `audit_log_v2` is larger - the compute tier is the
  remaining lever for cache pressure.
- Check `relallvisible/relpages` (visibility map) before blaming a query; plain VACUUM can fix it.
- Indexes: add only when the planner uses them for a real query shape; ANALYZE after creating an expression index.

## Flutter (`tyre_pulse_flutter/`)
- Rebuild scope: `const` constructors, Riverpod `select`, no provider watching a whole list for one field.
- Heavy work in `build()` (sorting, parsing, date formatting of big lists) moved out.
- Lists: `ListView.builder` / slivers, never a `Column` of hundreds of children.
- Images: `cacheWidth`/`cacheHeight`, resize before upload (field phones have 2 GB RAM).
- Startup: work before first frame (prefs load, access load) bounded by timeouts; no blocking isolate work
  (`compute` for parsing).
- Network: cache last good data for offline starts; bounded concurrency for uploads.
- APK size: `flutter build apk --analyze-size` when an SDK is available.

## Output
Before/after table per metric, the change made, and evidence. A change that does not move a measured number is
reverted or reported as neutral.
