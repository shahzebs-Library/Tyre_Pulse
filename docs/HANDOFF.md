# TyrePulse — Session Handoff

_Last updated: 2026-07-01 · branch `main` @ `aec3f68` (clean, fully pushed)_

## TL;DR
The Expo/Vite/Supabase stack is being **hardened in place** (no Go/Kotlin/Next.js/DB migration on this track). The **Multi-Country Data Intake Center** (+ its 4 follow-on gaps) and most of the `Current issues fixing.md` program (Phases 0–3, plus Phase 5 KPI registry + nav regroup) are built, **tested, and on `main`**. The Go backend and native Android app stay **off `main`** on their own branches (frozen, not abandoned).

## Stack
- **Web:** Vite + React 19 (`src/`) · **Mobile:** Expo React Native (`mobile/`)
- **Backend:** Supabase — Postgres + Auth + Storage + Edge Functions. Project `jhssdmeruxtrlqnwfksc`.

## Working rules (do not violate)
- **Merge-to-main scope:** only current-setup work. **Never** merge the Go backend (`backend/`) or the Android app to `main`.
- **Verify columns/constraints against the live schema** before writing any query/RPC — the multi-agent design passes repeatedly got schema details wrong (generated columns, CHECK constraints, status enums). Every applied migration here was proven by a self-asserting `BEGIN…ROLLBACK` SQL test first.
- Backward-compatible only; no table drops without migration + reconciliation + rollback.
- **No fabricated values** — actual data only; missing cost/metric → 0 or "—", never a settings default.
- Gate after every change: `npm run test:run` · `npx vite build` · `cd mobile && npm run typecheck`. Currently **563 web tests green**; mobile typecheck clean except pre-existing `notifications.ts` (missing `expo-notifications` types).
- Country isolation is sacred; files stay private (signed URLs); no service-role/AI/storage keys in web or mobile.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + the `Claude-Session:` line. Push `git push -u origin main`. No PR unless asked. Chat-only model id: `claude-opus-4-8` (never in commits/code).

## DONE and on `main`

### Data Intake Center (`Data correction.md`) — complete
Controlled pipeline Upload→Map→Validate→Approve→Commit, country-scoped, private files, server-side RPC commit, preserves every original row/file.
- **DB:** V45 (10 `import_*` tables + private bucket + RLS), V46 (`import_commit_batch`/reverse/reprocess, column-intersection, custom_data carry), V47 (work-order cost buckets + generic custom_data), V48 (`import_master_aliases`), V49 (`currency_rates`).
- **Engine** `src/lib/import/*` — parse (xlsx/csv, header detect, Excel serial dates), synonyms (EN+Arabic, 10 modules), mapping (confidence bands), transform (tyre spend qty×cost; currency conversion trail), validate (+ `classifyDuplicates`, `countryConflict`), aliases.
- **Service** `src/lib/api/imports.js` (the only import_* boundary) · **UI** `DataIntakeCenter.jsx` wizard + `DataIntakeHistory.jsx` (Imports / Data Quality / Mapping Profiles / Custom Fields / **Aliases** / **FX Rates**).
- All 10 modules (fleet/tyre/stock/accident/inspection/workorder/warranty/gatepass/supplier/driver) map to real tables and commit.
- **4 gaps done:** country-scope conflict guard (rule #1); rich Import Control Dashboard; post-import automation (tyre-risk alerts + corrective actions); master-data alias control; approval-gated currency conversion (never silent — converts only with an approved `currency_rates` row).

### Hardening (`Current issues fixing.md`)
- **Phase 0** — 8 audit docs in `docs/`.
- **Phase 1** — org-scope RLS (V42/V43) + isolation test, `file_metadata` (V44), PWA hardening + logout cache clear + auth-remount fix, secret guard, service-layer foundation.
- **Phase 2 (data integrity)** — **V50** `apply_tyre_change` + `record_audit_event` (atomic tyre change → close removed + fit + one canonical audit; `fitment_date` is generated, omitted); **V52** `post_stock_movement` ledger (atomic, row-locked, negative-guarded, audited; extended `movement_type` CHECK; `current_stock_balance` + `v_stock_balance_reconcile`). Both wired into UI. Self-asserting SQL tests passed.
- **Phase 1 #1 service layer** — `assets/tyres/stock/workOrders/inspections/accidents/gatePasses` modules + tests (additive; pages not migrated yet).
- **Phase 3** — **V53** `gate_pass_blockers` + `gatePasses` service + GatePass UI (blocks release with open High CA / Critical tyre / Critical inspection; inspection status is Done/Cancelled); supplier scorecard (`src/lib/analytics/supplierScorecard.js` + SupplierManagement "Scorecard" tab).
- **Phase 5** — central KPI registry (`src/lib/kpi/registry.js`, 12 KPIs, compute names verified against engines); **sidebar regrouped into Overview + 8 workspaces** (every route preserved, access carried down per item; verified old/new route sets identical).
- Earlier: fabricated-metric removal (actual cost only, no `1200` default); mobile **typed offline commands** (`recordQueue` no longer writes arbitrary tables — `COMMANDS` allow-list + idempotency/backoff).

## OFF `main` (frozen — do NOT merge)
- `claude/mobile-kotlin-app` — native Kotlin app (PR #15).
- Go backend `claude/backend-step2-assets` (`backend/`) — Go API (PR #16). Targets `Roadmap_latest.Md`, parked.

## Migrations reference (live + repo `MIGRATIONS_V*.sql`, all with rollback headers)
V42/43 org scope · V44 file_metadata · V45 import center · V46 import commit · V47 work-order costs · V48 aliases · V49 currency_rates · V50 tyre-change+audit · V52 stock ledger · V53 gate-pass blockers. Self-asserting tests in `tests/rpc_*.sql`.

## Still PENDING (larger, deliberate work)
1. **Phase 4 mobile** — Expo SQLite offline store + conflict handling (mobile rearchitecture; can't runtime-test in this env).
2. **Phase 6 UX** — light/dark consistency, RTL/Arabic layout, universal chart drill-downs.
3. **Service-layer page migration** — move the ~276 web + ~86 mobile direct `supabase.from()` call sites onto the new services, module by module.
4. **Phase 5 follow-on (optional, low-risk)** — 8 workspace landing/hub pages summarising each section.

## Working method that's been effective
Multi-agent **design** fan-out (Workflow tool) → **integrate sequentially in the main loop** → **verify every spec against the live schema** (agents get schema details wrong) → gate → commit → push. RPCs proven by rolled-back live SQL tests before trusting them.

## Environment notes
- Supabase MCP (`mcp__70b40dfe…` / `mcp__Supabase__*`) + GitHub MCP available via ToolSearch; intermittently flaky — merges done via plain `git` when GitHub MCP needs re-auth.
- Two MCP servers (`02dd48c6…`, `048416f8…`) need OAuth; unavailable in this non-interactive session.
- Failed agent spawns / infra hiccups cost ≈0 tokens (Anthropic-side, not the user's usage).
