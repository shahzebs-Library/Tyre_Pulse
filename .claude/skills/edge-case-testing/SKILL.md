---
name: edge-case-testing
description: Systematic edge-case testing for Tyre Pulse screens, services and imports - empty/one/many/10k+ records, long and Arabic text, emoji, missing data, broken images, network failures, every HTTP error class, duplicate submits, back/forward/refresh, expired sessions, concurrent edits, bad uploads. Use for "test edge cases", "what breaks this", "harden this screen", "stress the import".
---

# Edge-case testing

Pick the rows that apply to the feature under test and record expected vs actual for each.

## Data volume
- 0 records -> honest empty state that says why ("no data", "not provisioned", "could not load" are different).
- 1 record, many records, and more than the **1000-row PostgREST cap** -> totals come from a server count or
  paged read (`fetchAllPages`), never `.length` of a bare select. `src/test/rowCapGuard.test.js` polices this.
- 10k+ rows where realistic (tyre_records ~11k, work_orders ~90k, parts_consumption ~200k): paging, virtualised
  tables, no browser freeze.

## Content
- Long names / emails / asset descriptions: wrap or ellipsis, never overflow the card.
- Arabic, Urdu, mixed Arabic+codes, emoji, leading/trailing whitespace, tabs (the ERP pads with tabs), NBSP in
  headers, lower-case asset codes.
- Missing optional fields render `N/A`, never `0` for an unmeasured metric; null money never summed as 0.
- Numbers: 0 is a real reading (odometer 0, pressure 0); `Number(null)` is 0 - guard before converting.
- Images: missing, broken URL, huge photo (mobile resizes before upload), unsupported type.

## Network and server
- Offline, slow 3G, request timeout (mobile reads abort at 12 s), connection drop mid-upload.
- HTTP 400, 401 (session expired -> sign-in), 403 (permission -> clear message), 404, 409 (PT409 concurrency ->
  "refresh and try again"), 422, 429, 500, 503. Messages never leak SQL or internals.
- Retry only idempotent operations; offline queue replays exactly once (`client_uuid`).

## Interaction
- Double click / rapid taps on submit -> one write.
- Refresh mid-form, browser Back/Forward, deep link straight to a detail page, stale tab after a deploy
  (chunk-load recovery reloads once).
- Expired session while editing; role downgraded while on the page; record deleted by someone else;
  two users editing the same record (optimistic concurrency, approvals "already decided").
- Date edges: timezone near midnight, month boundaries, day-first vs month-first input, future dates, 2-digit years.

## Files and imports
- Empty file, header-only file, wrong sheet, title rows above the header, footer/total rows, duplicate rows,
  re-upload of the same file (must not duplicate), unsupported extension, renamed extension, oversize file,
  mixed countries in one file (country guard skips mismatches).

## Method
Unit tests for pure engines (vitest), Playwright for UI flows with `page.route` to simulate failures, SQL in a
rolled-back transaction for database behaviour. Never test against production data outside a rollback.

## Pass / fail
PASS: each applicable row has evidence and the behaviour is safe (no crash, no data loss, no wrong number, clear
message). A crash, silent data loss, blended currency or a misleading 0 is a FAIL of at least HIGH.
