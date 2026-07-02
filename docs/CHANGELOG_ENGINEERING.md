# Engineering Changelog

Per-phase engineering record for the in-place hardening program
(`Current issues fixing.md`). Each phase lands as its own reviewed PR and is
gated by `npm run test:run` · `npm run build` · `cd mobile && npm run typecheck`.

## Phase 0 — Audit (docs only; no code/schema changes)
**Branch:** `claude/harden-phase0-audit`

Added the seven audit/planning documents that baseline the current
Vite/React + Expo + Supabase system and define the remediation program:

- `CURRENT_SYSTEM_AUDIT.md` — as-built: 46 tables, direct-call inventory by
  module, edge functions, private buckets, RLS helpers + risks, mobile offline
  flow + failure scenarios, dashboard duplication map.
- `PRODUCT_GAP_REGISTER.md` — gaps grouped by severity (Critical/High/Medium/UX),
  already-mitigated items marked RESOLVED.
- `SECURITY_HARDENING_PLAN.md` — directive rules + 10 issues → reality; S-01…
  remediation table; Phase-1 exit criteria.
- `DATA_MODEL_CONSOLIDATION_PLAN.md` — canonical sources, backward-compatible
  cutover pattern, stock movement ledger, unified audit, transactional
  tyre-change RPC, structured inspections.
- `MODULE_ROADMAP.md` — module inventory (current vs target) mapped to Phases 1–6.
- `UX_NAVIGATION_PLAN.md` — 8-workspace navigation + UX requirements.
- `TEST_AND_RELEASE_PLAN.md` — release gate + 10-suite test matrix + per-phase
  exit criteria.

**DB changes:** none. **Tests:** n/a (docs). **Risks remaining:** the open
items tracked in the gap register / security plan. **Next phase:** Phase 1 —
security & platform foundation (service layer, RLS org/site scope + isolation
tests, private storage + file-metadata + signed-URL tests, PWA cache hardening +
logout clear, secret checks).

## 2026-07-02 — Reliability, security & real-format intake (main, pushed)

**DB migrations (all applied to live + proven with rolled-back self-asserting tests):**
- **V56/V56b** — defaults on NOT-NULL columns the intake can't always map
  (drivers.driver_id, accidents.site, warranty claim_no, work_type,
  inspections title/scheduled_date/site) → all 10 modules commit (10/10 probe).
- **V57** — security: dropped blanket `ALL true` policies on
  work_orders/purchase_orders (UPDATE now `is_approved_and_unlocked()`);
  3 SECURITY DEFINER views → `security_invoker`; `search_path` pinned on 4
  functions; authenticated SELECT on the 3 deny-all cache tables.
  Advisors: 0 ERROR-level remain.
- **V58** — tyre-record delete was blocked for everyone by
  `cleaning_log` FK (NO ACTION) → CASCADE; rca_records/gate_passes parent FKs →
  SET NULL. Admin delete verified live; non-admin blocked by RLS.
- **V59** — storage: **closed anon read of accident photos** (real leak),
  removed lock-bypassing insert policies, bucket size/mime limits aligned.
- **V60/V60b** — `import_commit_batch` per-row sub-transactions: one bad value
  no longer kills the whole batch; every failed row records its actual DB
  reason (`COMMIT_FAILED` issue) and the RPC returns
  `{inserted, skipped, failed, errors[]}`. stock site + work_order_no defaults.

**Mobile P0:** accident submit gate accepts tp-storage:// refs (was permanently
disabled); offline photo capture never loses images (kept local, re-uploaded by
the typed queue); sync banner + Sync Now cover BOTH queues; logout clears
queues + push token (shared-device isolation).

**Web P0:** error+retry states on 7 core pages (Dashboard, Analytics,
Fleet/Site/Brand/Country/KPI); AssetManagement localStorage save-masking
removed; ErpSync rewritten honest (was fabricated); silent-fail deletes
surfaced (TyreRecords, AuditTrail batch, FleetMaster, DataCleaning);
work-order delete added (Admin-only, verified).

**Data Intake — real company formats (`docs/imports/`):** parser now reads
XML Spreadsheet 2003 + Ramco HTML-grid .xls; report footers (GRAND TOTAL /
Printed By / Applied filters / stamps) stripped; padded cells trimmed;
header detection fixed for wide sparse grids; multi-file upload queue;
`.xlsm/.xlsb/.ods` accepted. Header-fingerprint **auto-apply of mapping
profiles** (5 seeded incl. the cost-of-record rule: tyre cost ONLY from Work
Order Details' `Trye`, summed per WO via new line-item aggregation with full
line audit in custom_data). Date-headed columns can never mis-map to non-date
fields. 8 regression tests parse the real files on CI.

**Platform:** `.github/workflows/ci.yml` (web tests+build, mobile typecheck);
mobile deps synced — typecheck now fully clean.

**Gate:** 701/701 web tests · build green · mobile typecheck 0 errors.
