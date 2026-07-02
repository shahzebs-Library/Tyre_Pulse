# TyrePulse — Missing Features & Gap Analysis

**Last Updated:** 2026-07-02 (evening — supersedes the morning draft)
**Repository:** shahzebs-Library/Tyre_Pulse · branch `main`
**Verified against:** the live Supabase project (`jhssdmeruxtrlqnwfksc`), the
current `main` code, and the test suite (701 web tests green · web build green ·
mobile typecheck clean).

> ⚠️ The previous version of this document described the old PR-based plan
> (PRs #17–#24) as pending. That work was **completed, merged to `main`, and
> live-verified** — this revision reflects the actual state so tracking stays
> truthful. The deep findings live in `docs/PROJECT_AUDIT_2026-07.md`;
> this file is the running scoreboard.

---

## ✅ DONE and live (previously listed as "missing")

| Area | Status | Evidence |
|---|---|---|
| **Multi-org isolation** | ✅ DONE | `organisation_id` on all business tables (V42) + RESTRICTIVE RLS org policies (V43); held under a real anon probe (0 rows leaked). |
| **Service layer `src/lib/api/`** | ✅ LARGELY DONE | assets/tyres/stock/workOrders/inspections/accidents/gatePasses/imports/budgets/analyticsReads/aiAnalytics/dailyOps + tests. Remainder: ~16 pages still call Supabase inline (tracked below). |
| **File authority** | ✅ DONE | `file_metadata` (V44); private buckets + signed URLs everywhere; storage hardened (V59 — anon accident-photo read leak closed, bucket size/mime limits). |
| **PWA cache + logout clear** | ✅ DONE | No authed-endpoint caching; logout clears user-scoped caches (web) and offline queues + push token (mobile). |
| **Data Import & Staging** | ✅ DONE (was "0%") | Full Data Intake Center: V45 staging schema (10 `import_*` tables, RLS), V46/V54/V60 commit RPC (transactional, idempotent, org-scoped, **per-row error isolation with recorded reasons**), mapping profiles **with fingerprint auto-apply**, validation engine, duplicate/country guards, audit events, batch **reversal**, post-import automation, alias control, approval-gated FX. |
| **Company formats** | ✅ DONE | The 5 real report formats in `docs/imports/` parse (incl. XML Spreadsheet 2003 + Ramco HTML grids), auto-map via seeded profiles, enforce the cost-of-record rule, and aggregate line items. 8 regression tests run on CI. |
| **Security hardening** | ✅ P1 DONE | V57 (work_orders/PO write policies approval-gated, definer views → invoker, fn search_path pinned), V58 (delete-blocking FKs fixed), V59 (storage). Advisors: 0 ERROR-level. |
| **Import audit trail** | ✅ DONE | `import_audit_events` append-only + `record_audit_event` canonical audit RPC (V50). |
| **Stock ledger / tyre-change atomicity** | ✅ DONE | `post_stock_movement` (V52) + `apply_tyre_change` (V50), self-asserting SQL tests. |
| **Web CI** | ✅ DONE | `.github/workflows/ci.yml` — tests + build + mobile typecheck on every push/PR (plus existing Android build workflows). |
| **Exports** | ✅ DONE | PDF/Excel/PPTX live; `EXPORT_GUIDE.md` + `EXPORT_QUICK_REFERENCE.md` match the real `exportUtils` API. |
| **Export libs lazy-loaded** | ✅ DONE | xlsx/jspdf/pptxgenjs are async chunks loading on first export click — no page ships them in its initial load (31 pages + exportUtils/parseWorkbook/emailService converted). |
| **Scheduled report delivery** | ✅ DONE (needs 1 secret) | pg_cron → `send-scheduled-reports` edge fn every 15 min; live KPI digest email per schedule; `report_send_log` tracks every send/failure; verified end-to-end. **Owner must set `RESEND_API_KEY`** (Edge Function secret) for mail to actually leave. |

## 🔴 Genuinely open gaps (the real backlog)

### P2 — Product correctness — ✅ CLOSED 2026-07-02
| Gap | Resolution |
|---|---|
| Currency/date formatter sweep | 33 pages now format via `formatters` + `activeCurrency` (incl. KpiCommandCenter's Rand → active currency, U4); user-visible dates via `formatDate`/`formatMonthYear`. |
| Confirm dialogs on destructive deletes | InspectionPlanner schedules, CustomData synonyms, SupplierManagement contracts — confirm + verified delete + surfaced error. |
| localStorage business data → DB | V62: tyre_disposals + tyre_status_marks tables; Procurement budget → settings; Settings scheduled reports → report_schedules (feeds real delivery). Alert thresholds were already DB-backed. |
| Online inspection photo re-upload | Online submit re-uploads pending position photos; no dead file:// URIs reach the DB. Record queue also prunes synced entries (M4). |

### P3 — Platform debt
| Gap | Where | Notes |
|---|---|---|
| Finish service-layer page migration | ~16 pages / ~120 inline calls (top: DataCleaning, UploadData, Dashboard) | Pattern established; migrate in batches. |
| RLS perf consolidation | live DB | 207 multiple-permissive-policy warnings, 82 initplan, 56 unindexed FKs — matters as data grows. |
| Mobile offline update commands | stock adjust, WO/CA status updates | Direct writes today — lost when offline. |
| Cross-file merge on import | intake | Same JC enriched from Complaints History + Work Order Details (today: duplicate-skip; cost file should win — see `docs/imports/README.md`). |

### P4 — Bigger product investments
| Gap | Notes |
|---|---|
| Web i18n + RTL (Arabic) | Mobile ships ar/ur; web is hardcoded English — the biggest UX gap for Gulf users. |
| Chart drill-down | 0 of 54 chart pages click through to source records (stated directive requirement). |
| Light theme via CSS vars | ~80 pages use literal dark classes. |
| Dev/staging Supabase project | All builds point at production today (H6). |
| GPS/Telematics + generic ERP import adapters | New intake modules. |
| Go backend + native Android | Frozen on their own branches by decision — **not** merged to `main`. |

### One-click items awaiting the owner
- Enable **leaked-password protection** (Supabase Dashboard → Auth → Settings).
- Move the anon key to **EAS Secrets** (`eas secret:create`) — hygiene, not a leak.

---

## Scoreboard

- **Migrations applied & live-verified:** V40 → V60 (every one proven with a rolled-back self-asserting SQL test).
- **Gate:** 701 web tests · build green · mobile typecheck clean (0 errors).
- **Security advisors:** 0 ERROR-level findings.
- **Intake:** all 10 modules commit end-to-end; 5 company formats auto-recognised.

_Update this file whenever a gap closes — it is the tracking record the
audit (`PROJECT_AUDIT_2026-07.md`) and handoff (`HANDOFF.md`) point to._
