# TyrePulse — Session Handoff

_Last updated: 2026-06-30 · branch `main` @ `9efaba6`_

## TL;DR
The current Expo/Vite/Supabase stack is being **hardened in place** (no Go/Kotlin/Next.js/DB migration on this track). Security hardening + the **Multi-Country Data Intake Center** are built, tested, and **merged to `main`**. The Go backend and native Android app stay **off `main`** on their own branches (frozen, not abandoned). Last action: reusable column-mapping profiles landed on `main`.

## Stack
- **Web:** Vite + React 19 (`src/`)
- **Mobile:** Expo React Native (`mobile/`)
- **Backend:** Supabase — Postgres + Auth (GoTrue) + Storage + Edge Functions (Deno). Project `jhssdmeruxtrlqnwfksc`.

## Working rules (do not violate)
- **Merge-to-main scope:** only current-setup work (hardening + data-intake + app). **Never** merge the Go backend (`backend/`) or the Android app to `main`.
- One task → own branch → PR/merge. Never disturb the user's working branch `claude/mobile-app-ui-features-tdfxy0` or the running apps. Backward-compatible only; no table drops without migration + reconciliation + rollback.
- **Verify columns against the live schema** (Supabase MCP `execute_sql`) before writing any query — a past audit falsely claimed real columns were "phantom."
- Gate after every change: `npm run test:run` · `npx vite build` · `cd mobile && npm run typecheck`. Currently **389 tests green**.
- Country isolation is sacred: never mix one country's records into another. Imports are country-scoped and commit only via server-side RPC. Files stay private (signed URLs). No service-role/AI/storage keys in web or mobile.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + the `Claude-Session:` line. Push with `git push -u origin <branch>` (retry w/ backoff on network errors). **No PR unless the user asks.**
- Model identity for chat only: `claude-opus-4-8`. Never put it in commits/PRs/code.

## What's DONE and on `main`
### Security hardening (Phase 0–1 of `Current issues fixing.md`)
- 7 Phase-0 audit docs (`docs/CURRENT_SYSTEM_AUDIT.md`, `SECURITY_HARDENING_PLAN.md`, etc.).
- PWA cache hardening + logout cache clear + secret startup guard (`vite.config.js`, `src/contexts/AuthContext.jsx`).
- Service layer `src/lib/api/` (`_client.js`, `assets.js`, `tyres.js`, `imports.js`, `index.js`) + `src/test/api.test.js`.
- **Org-scope multi-tenant foundation + enforcement** (live + repo SQL):
  - `MIGRATIONS_V42_ORG_SCOPE_FOUNDATION.sql` — default org, `organisation_id` on 23 tables, memberships, `app_current_org()`.
  - `MIGRATIONS_V43_ORG_SCOPE_ENFORCE.sql` — RESTRICTIVE `*_org_isolation` RLS per table. Test `tests/rls_org_isolation.sql` PASSED.
  - `MIGRATIONS_V44_FILE_METADATA.sql` — org-scoped `file_metadata`.

### Multi-Country Data Intake Center (`Data correction.md`)
Controlled pipeline: **Upload → Map → Validate → Approve → Commit**, preserves every original row/file, country-scoped, private files, server-side RPC commit.
- **DB (live + repo SQL):**
  - `MIGRATIONS_V45_IMPORT_CENTER.sql` — 10 `import_*` tables + `custom_field_catalog` + private `import-files` bucket + 30 RLS policies.
  - `MIGRATIONS_V46_IMPORT_COMMIT.sql` — `import_commit_batch`, `import_reverse_batch`, `import_reprocess_row`, `import_target_table` (SECURITY DEFINER, idempotent, atomic, column-intersection insert). Test `tests/rpc_import_commit.sql` PASSED.
- **Engine** `src/lib/import/` — `parseWorkbook` (xlsx/csv, multi-sheet, header detection, Excel serial dates), `synonyms.js` (EN+Arabic, modules fleet/tyre/stock), `mapping.js` (confidence: <60 review / 60–89 suggest / ≥90 auto / unmatched→preserve_custom), `transform.js`, `validate.js` (+`classifyDuplicates`, natural keys), `index.js` barrel. Tests: `src/test/import.test.js` (11).
- **Service** `src/lib/api/imports.js` — the only UI↔import_* boundary. Incl. `getProfileRules`/`touchProfile` (mapping profiles).
- **UI:** `src/pages/DataIntakeCenter.jsx` (4-step wizard, country-mandatory, role-gated approve, **save/apply reusable mapping profiles**), `src/pages/DataIntakeHistory.jsx` (`/data-intake/history`: Imports / Data Quality / Mapping Profiles / Custom Fields). Routes lazy-loaded in `src/App.jsx` (`/data-intake`, `/data-intake/history`).
- **Docs** under `docs/`: IMPORT_CENTER_{DATA_MODEL,COMMIT_FRAMEWORK,MULTICOUNTRY_AUDIT,SECURITY_PLAN,MIGRATION_PLAN,TEST_CASES}.md.

## OFF `main` (frozen — do NOT merge to main)
- `claude/mobile-kotlin-app` — native Kotlin Android app (PR #15).
- `claude/backend-step2-assets` + Go backend (`backend/`) — Go API (PR #16, step 2 assets). Targets `Roadmap_latest.Md`, parked.

## Current state
- On `main`, clean working tree, pushed to `origin/main` @ `9efaba6`.
- 389 vitest tests green; web build green; no pending migrations.

## Suggested next steps (pick up here)
1. **Wire existing module pages to the service layer** (`src/lib/api/`) incrementally — start with one module's pages; add tests. (Phase 1 item #1, only partially adopted.)
2. **Phase 2 data-model integrity** (`Current issues fixing.md`) — the drafted plan: `apply_tyre_change` + `record_audit_event` transactional RPCs (atomic tyre change, one audit format) with a self-asserting atomicity SQL test. Highest integrity value, fully additive. (See plan in session notes.)
3. **Import adapters beyond fleet/tyre/stock** — accident (+ZIP attachment matching), inspections, work orders, etc. **Blocked on:** extend `src/lib/import/synonyms.js` MODULE_FIELDS only after **verifying each target column against the live schema** via Supabase MCP.
4. **Housekeeping (offered, not approved):** close redundant PRs #17–#24 (content already on `main` via #25); keep #15/#16 open.

## Environment notes
- Supabase MCP (`mcp__70b40dfe…`) and GitHub MCP available via ToolSearch; both have been intermittently flaky — GitHub MCP may need re-auth (merges have been done via plain `git` as fallback).
- Two MCP servers (`02dd48c6…`, `048416f8…`) require OAuth and are unavailable in this non-interactive session.
- Failed agent spawns / infra hiccups cost ≈0 tokens — they are Anthropic-side, not the user's usage.
