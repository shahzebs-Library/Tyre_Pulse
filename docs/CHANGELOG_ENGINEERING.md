# Engineering Changelog

Per-phase engineering record for the in-place hardening program
(`Current issues fixing.md`). Each phase lands as its own reviewed PR and is
gated by `npm run test:run` · `npm run build` · `cd mobile && npm run typecheck`.

## Phase 0 - Audit (docs only; no code/schema changes)
**Branch:** `claude/harden-phase0-audit`

Added the seven audit/planning documents that baseline the current
Vite/React + Expo + Supabase system and define the remediation program:

- `CURRENT_SYSTEM_AUDIT.md` - as-built: 46 tables, direct-call inventory by
  module, edge functions, private buckets, RLS helpers + risks, mobile offline
  flow + failure scenarios, dashboard duplication map.
- `PRODUCT_GAP_REGISTER.md` - gaps grouped by severity (Critical/High/Medium/UX),
  already-mitigated items marked RESOLVED.
- `SECURITY_HARDENING_PLAN.md` - directive rules + 10 issues → reality; S-01...
  remediation table; Phase-1 exit criteria.
- `DATA_MODEL_CONSOLIDATION_PLAN.md` - canonical sources, backward-compatible
  cutover pattern, stock movement ledger, unified audit, transactional
  tyre-change RPC, structured inspections.
- `MODULE_ROADMAP.md` - module inventory (current vs target) mapped to Phases 1-6.
- `UX_NAVIGATION_PLAN.md` - 8-workspace navigation + UX requirements.
- `TEST_AND_RELEASE_PLAN.md` - release gate + 10-suite test matrix + per-phase
  exit criteria.

**DB changes:** none. **Tests:** n/a (docs). **Risks remaining:** the open
items tracked in the gap register / security plan. **Next phase:** Phase 1 -
security & platform foundation (service layer, RLS org/site scope + isolation
tests, private storage + file-metadata + signed-URL tests, PWA cache hardening +
logout clear, secret checks).

## 2026-07-02 - Reliability, security & real-format intake (main, pushed)

**DB migrations (all applied to live + proven with rolled-back self-asserting tests):**
- **V56/V56b** - defaults on NOT-NULL columns the intake can't always map
  (drivers.driver_id, accidents.site, warranty claim_no, work_type,
  inspections title/scheduled_date/site) → all 10 modules commit (10/10 probe).
- **V57** - security: dropped blanket `ALL true` policies on
  work_orders/purchase_orders (UPDATE now `is_approved_and_unlocked()`);
  3 SECURITY DEFINER views → `security_invoker`; `search_path` pinned on 4
  functions; authenticated SELECT on the 3 deny-all cache tables.
  Advisors: 0 ERROR-level remain.
- **V58** - tyre-record delete was blocked for everyone by
  `cleaning_log` FK (NO ACTION) → CASCADE; rca_records/gate_passes parent FKs →
  SET NULL. Admin delete verified live; non-admin blocked by RLS.
- **V59** - storage: **closed anon read of accident photos** (real leak),
  removed lock-bypassing insert policies, bucket size/mime limits aligned.
- **V60/V60b** - `import_commit_batch` per-row sub-transactions: one bad value
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

**Data Intake - real company formats (`docs/imports/`):** parser now reads
XML Spreadsheet 2003 + Ramco HTML-grid .xls; report footers (GRAND TOTAL /
Printed By / Applied filters / stamps) stripped; padded cells trimmed;
header detection fixed for wide sparse grids; multi-file upload queue;
`.xlsm/.xlsb/.ods` accepted. Header-fingerprint **auto-apply of mapping
profiles** (5 seeded incl. the cost-of-record rule: tyre cost ONLY from Work
Order Details' `Trye`, summed per WO via new line-item aggregation with full
line audit in custom_data). Date-headed columns can never mis-map to non-date
fields. 8 regression tests parse the real files on CI.

**Platform:** `.github/workflows/ci.yml` (web tests+build, mobile typecheck);
mobile deps synced - typecheck now fully clean.

**Gate:** 701/701 web tests · build green · mobile typecheck 0 errors.

## 2026-07-02 (later) - Export work: lazy loading + scheduled delivery

- **Lazy export libs:** xlsx (~420 KB), jspdf (~400 KB), pptxgenjs (~385 KB)
  converted to dynamic import-on-use in exportUtils, parseWorkbook,
  emailService and all 31 pages that imported them directly; manualChunks
  unpinned so each lib is a natural async chunk. Verified in dist/: zero page
  chunks statically link them; they download on the first export/parse click.
- **Scheduled report delivery (V61 + edge fn):** pg_cron + pg_net enabled;
  cron every 15 min POSTs to `send-scheduled-reports` gated by a
  service-role-only secret (cron_config). The function processes due ACTIVE
  report_schedules, emails a live KPI digest (counts only - no fabrication;
  dash when unreadable), advances next_run_at (Riyadh time), backs off 1h on
  failure, and records every outcome in the new `report_send_log`.
  Proven end-to-end live (cron fired on its own; failure honestly logged as
  "RESEND_API_KEY not configured" - the one owner action remaining).
- Gate: 701/701 tests · build green.

## 2026-07-02 (night) - P2 closed via multi-agent wave

- **Currency/date sweep (33 pages, 3 parallel agents):** every hardcoded 'SAR'
  default, `SAR ${x}` template, Rand prefix and en-GB/en-US/en-SA display
  locale replaced with formatters + activeCurrency / formatDate. KPI target
  labels currency-neutral; KpiCommandCenter benchmarks relabeled "static
  industry reference" (U4). No query/ISO/date-input strings touched.
- **Confirm dialogs:** InspectionPlanner schedules, CustomData synonyms,
  SupplierManagement contracts - confirm modal + .select-verified delete +
  error surfaced in-dialog.
- **localStorage → DB (V62):** tyre_disposals + tyre_status_marks tables
  (org RLS, approval-gated writes); TyreExchange marks, scrap disposal
  statuses, Procurement budget (settings key) and Settings scheduled reports
  (→ report_schedules) all shared/team-wide now, optimistic UI with rollback.
- **Mobile:** online inspection submit re-uploads pending photos (H8);
  typed record queue prunes synced entries (M4).
- Gate: 701/701 tests · build green · mobile typecheck clean.

## 2026-07-02 (late) — Multi-org onboarding completion (V63–V67)
- V63 custom_data columns on all import targets; V64 set_module_permissions RPC +
  editable Access Control matrix; V65 super-admin cross-org; V66 3 country orgs
  (KSA/UAE/Egypt) + user→org assignment UI; **V67**: Admin role ALSO sees all
  orgs (app_is_org_admin helper on the 38 org-isolation policies) and assigning
  a user's country auto-sets their organisation (admin_update_profile). Old
  12-arg overload dropped. All rolled-back-verified.
- Read docs/"Master Build…Instruction.md" (owner directive: tenant branding,
  Report Center, PDF/PPTX quality, docs discipline) — folded into the backlog.

## 2026-07-03 — Master Build Phase C + Phase A (main, pushed)
**Phase C — resilient exports (fixes owner's "PowerPoint download not working"):**
- Root cause: the Dashboard export handlers had no try/catch or loading feedback,
  so a lazy-lib load, pop-up block, or empty dataset left a silent dead button.
  PPTX generation itself was verified sound (valid .pptx produced for empty and
  full datasets in a Node harness).
- All four handlers (Excel/PDF/PPTX/Daily) now run through a shared `runExport()`
  wrapper: disables the button, shows an in-flight spinner ("Exporting…"/
  "Building…"), and surfaces success/error via a toast. Concurrent clicks blocked.

**Phase A — tenant branding foundation (V68):**
- **V68** RPCs `get_org_branding` / `set_org_branding` (+ `_is_hex_color` helper).
  Branding lives in `organisations.settings->'branding'` (legal name, brand name,
  primary/secondary/accent colours, logo URL, report theme, footer, disclaimer,
  contact block). Writes gated to `app_is_org_admin()` (super OR Admin) via
  SECURITY DEFINER with server-side hex/theme validation + audit event; reads
  scoped so a non-admin only sees their own org (`IS DISTINCT FROM` guard closes
  the null-org/anon hole). `anon` EXECUTE revoked explicitly. Rolled-back
  self-asserting test proves store/merge/validation/whitelist.
- Frontend: `src/lib/api/branding.js` (+5 unit tests), `contexts/TenantContext.jsx`
  (app-wide branding, publishes `--brand-primary`/`--brand-accent` CSS vars,
  never blocks on failure), `components/OrgBrandingPanel.jsx` (admin editor with
  org selector, colour pickers, live report-cover preview) mounted as a new
  **Branding** tab in User Management. Dashboard reports now use the tenant legal/
  brand name for the report `company` field (Excel/PDF/PPTX/Daily).
- Gate: 714 tests green (709 + 5 branding), web build clean, advisors clean
  (only the pre-existing generic SECURITY DEFINER / graphql-exposure warnings).

## 2026-07-03 (later) — Master Build Phase B: branded report engine (main, pushed)
- `exportUtils.js` now consumes the tenant branding object on the executive
  reports: **PowerPoint deck** and **Daily Executive PDF** derive their primary/
  secondary accent from `branding.primary_color`/`accent_color`, stamp the tenant
  **logo** on the cover (best-effort — a missing/blocked/oversized image silently
  falls back, never breaks the file), and use `branding.footer_text` /
  `branding.disclaimer` in the footer and cover.
- New safe helpers: `brandHex` (→ 6-hex), `hexToRgb` (→ jsPDF RGB),
  `fetchImageDataUri` (URL → base64 data URI, ≤2 MB, CORS/format guarded, null on
  any failure). Dashboard threads `branding` (from TenantContext) into the PPTX
  and Daily-PDF data objects.
- Proven: Node harness generates a valid 324 KB .pptx with the tenant accent
  `0F766E` embedded 4× in the cover slide XML; zip structure intact. Gate: 714
  tests green, build clean.

## 2026-07-03 (later) — Master Build Phase D (Report Center) + Phase F doc (main, pushed)
- **Report Center** — new page `src/pages/ReportCenter.jsx` at `/report-center`
  (nav: Reports & Executive → Report Center). On-demand branded generation of the
  Executive PowerPoint, Daily Executive PDF, and Tyre Records Excel/PDF (date
  filters + global country scope + tenant branding via TenantContext), each with
  spinner + success/error toast. Branding banner (shortcut to the editor),
  scheduling shortcut, and a Delivery History table over `report_send_log`
  (loading/error/empty states). New page — does NOT touch the i18n session's
  Reports.jsx. Route + lazy import in App.jsx; nav entry in Layout.jsx.
- **Docs (Phase F)** — `docs/BRANDING_AND_REPORT_SETTINGS.md`: full reference for
  the V68 branding model, RPCs, frontend wiring, branded export engine, Report
  Center, operator guide, and security notes.
- Gate: 714 tests green, web build clean (Report Center lazy-split).

## 2026-07-03 (later) — Merge web-i18n + Master Build Phase E (design system) (main, pushed)
- **Merge**: 3-way merged the parallel i18n workstream (Arabic/RTL foundation,
  onboarding wizard, theme-safe mobile nav) into `main` (`34eb1be`). Resolved two
  conflicts keeping BOTH sides: Dashboard export buttons (my loading/toast logic
  + their i18n labels; added `dashboard.export.exporting`/`building` keys en+ar),
  and Inspections table header (my admin multi-delete checkbox + their i18n
  headers). Fast-forwarded the feature branch to main. Gate: 729 tests, build,
  mobile typecheck all green.
- **Phase E (design system)**: the light/dark token system + ThemeContext + the
  ~280-line `html.light` override layer already existed and is mature (most of
  Phase E). Added the **tenant-accent token layer**: `--accent` / `--accent-ring`
  / `--accent-strong` (hard-default to product green) + `.text-accent`/
  `.bg-accent`/`.border-accent`/`.ring-accent` utilities; the global
  `:focus-visible` ring now uses `--accent-ring`. `TenantContext` tints these
  from the org's V68 branding **only when a custom colour is set** (≠ `#16a34a`),
  so default/unbranded orgs render byte-identical to before. Hand-tuned green
  component gradients left untouched by design. Documented in `DESIGN_SYSTEM.md`.
- **Master Build program A–F now complete.** Gap analysis + handoff updated.

## 2026-07-03 (later) — Report quality: brand + empty-states on every PDF (main, pushed)
- **User cleanup**: removed the 3 non-admin accounts (kept only the super-admin);
  cleared their NO-ACTION audit refs first so the cascade delete was clean.
- **V69**: unified login by email / username / employee code (case-insensitive
  resolver + unique indexes) with a single login field.
- **Shared branded-PDF engine**: `exportToPdf` (backs ~40 pages) now brands with
  the tenant logo + accent + footer and renders a professional empty-state panel
  instead of a bare table when there are no rows. New `_pdfBrand`/`_emptyStatePanel`/
  `_tableTheme` internals + exported API (`resolvePdfBrand`/`pdfHeader`/`pdfFooter`/
  `pdfEmptyState`/`pdfTableTheme`). New centralized `exportDailyOpsBriefingPdf`.
- **Page-local sweep (5 parallel agents)**: all 24 bespoke jsPDF document
  generators (Executive Report, Work-Order job card, Purchase Order, compliance
  certificate, budget/KPI/recall/warranty/retread/rotation/scrap/transfer/
  pressure/downtime/fuel/benchmark reports, etc.) migrated to the shared branded
  header/footer/table-theme + empty-states. Non-report layouts correctly left
  intact (QR label sheet, formal warranty-claim letter). Net −166 lines.
- Gate: 730 web tests green · web build clean · mobile typecheck clean.

## 2026-07-03 (later) — UI/UX audit round 1 (docs/"ui ux.md") (main, pushed)
- **#1 (highest priority) empty space**: desktop content wrapper widened from
  max-w-screen-2xl (1536px) → 1800px with responsive padding (px-4→2xl:px-10),
  so the app fills large displays instead of floating centred.
- **Design-system primitives**: StatCard inline SVG sparklines + custom trend
  label (#5); PageHeader "Updated <relative>" chip (#3); new SegmentedControl
  sliding toggle (#9); new Skeleton set — Skeleton/SkeletonCards/SkeletonTable/
  SkeletonChart + shimmer-x keyframe (#15). Typography scale (#7) already existed.
- **Dashboard reference**: granularity → SegmentedControl; full-page spinner →
  skeleton cards + charts.
- **SegmentedControl sweep (2 agents)**: 7 pages converted (Executive Report, KPI
  Command Center, Downtime, Site Comparison ×2, Comparison ×2, Continuous
  Improvement, Scheduled Reports). Dropdown/step-wizard pages correctly skipped.
- Already present (no work): Command Palette ⌘K, Global Search, Notification
  Center (#20); EmptyState + CTA (#14); tokens + light/dark (#6, #17).
- Remaining review items (#2 sidebar, #4 cards, #10 table features, #11–13
  layout/charts, #18 flows) are subjective per-page design work — to be done
  deliberately, not a blind mass rewrite. Gate: 730 tests green, build clean.

## 2026-07-03 (later) — UI/UX audit round 2: fit, contrast, responsiveness (main, pushed)
- **Fit (#1)**: Scheduled Reports + 14 pages wrapped their own content in a
  redundant `min-h-screen bg-gray-950 p-6` root and/or an inner
  `max-w-screen-2xl/6xl` cap narrower than the app shell — so they floated
  centred with big margins. Removed the self-wrappers; raised inner caps to the
  global 1800px. Centered loading/error wrappers left intact.
- **Contrast / legibility (dark bg, light fonts)**: lifted the muted/dim text
  tokens (`--text-dim` was `#3a4840` ≈ 1.8:1 — invisible) and Tailwind
  `text-gray-600/700` in dark mode (unlayered rules beat Tailwind's layered
  utility; `html.light !important` keeps light mode). Also lifts the sidebar's
  dim inactive labels (#2).
- **Responsive grids (#16)**: 40 fixed `grid-cols-3/4/5` across 24 pages had no
  mobile base → cramped/clipped on phones. Added `grid-cols-1/2` base with the
  count preserved from `sm:` up — **desktop byte-identical**, only <640px reflows.
- Repo auto-deploys to Vercel on push to `main`, so these land live. Gate: 730
  tests green, web build clean throughout.

## 2026-07-04 — Security: profiles org isolation + Daily Ops XSS (main, pushed)
- **V70 `profiles_org_isolation`** (HIGH, cross-tenant PII): the only SELECT
  policy on `public.profiles` was `USING (auth.role() = 'authenticated')`, so any
  signed-in user could read every profile in every organisation. Added a
  RESTRICTIVE org-isolation gate (`id = auth.uid()` OR `app_is_org_admin()` OR
  `org_id = app_current_org()`), mirroring the 23 business tables. Helpers are
  SECURITY DEFINER (pinned `search_path`) → no RLS recursion; `app_current_org()`
  reads `profiles.org_id`, so the column matches. Proven with a rolled-back
  two-tenant probe (org-A user sees only self: 1 row, no org-B/admin leak).
  `get_advisors(security)`: 0 ERROR-level findings.
- **Daily Ops print XSS**: `printBriefing()` interpolated DB fields
  (severity/type/asset/description/date) straight into `document.write` HTML.
  All values now HTML-escaped; severity CSS class whitelisted.
- **useRealtimeAlerts double-RPC**: `markAllRead` dispatched `mark_notification_read`
  RPCs inside the state updater (StrictMode double-invokes → double fire). Moved
  the RPC dispatch outside the pure updater.

## 2026-07-04 (later) — Security: scheduled-report cross-tenant scoping (main, pushed)
- **send-scheduled-reports digest was tenant-blind** (MEDIUM): `buildDigest()`
  counted tyre_records / work_orders / corrective_actions / accidents and summed
  spend across EVERY organisation with the service role, so a schedule owned by
  org A emailed org B's numbers. `report_schedules` already stores `org_id`
  (set from the creator's profile), so the digest now scopes every count by
  `organisation_id = schedule.org_id` (null → unassigned rows only).
- **V71 `report_org_tyre_spend(p_org, p_from)`**: new org-scoped spend aggregate
  (SECURITY DEFINER, pinned search_path) replaces the country-only
  `report_tyre_summary` call for the spend tile. EXECUTE revoked from
  anon/authenticated, granted to service_role (matches V40 hardening).
  Edge function redeployed (v2, verify_jwt preserved).

## 2026-07-04 (later) — Branch consolidation & cleanup (main)
- Consolidated all feature/session branches onto `main` and removed 24 stale
  remote branches. Verified each carried **no unmerged work**: 16 were already
  merged into `main`; 5 merged as 0-change no-ops (superseded); 3 (old i18n /
  animated-login / mobile EAS) were superseded and would have regressed
  production, so deleted without merging (owner-approved).
- **Kept** (never merged to main by policy): `claude/backend-step2-assets` (Go
  backend), `claude/mobile-kotlin-app` (Kotlin app), plus the active dev branch
  `claude/mobile-app-ui-features-tdfxy0`.
- Full record with recovery SHAs: `docs/BRANCH_CONSOLIDATION_2026-07-04.md`.

## 2026-07-04 (later) — Import Center country-scope gate (V76) + full-tree merge (main)
- **Merged the concurrent service-layer migration to main** (owner-authorised):
  14 pages routed through `src/lib/api/*` modules (+14 api test suites), plus
  V72 (cross-file merge RPC), V73 (inspection GPS), V74 (FK covering indexes +
  drop duplicate index), V75 (RLS initplan wrapping — file). Gate: 875 tests +
  build green. V72/V73/V74 confirmed applied live; V75 (perf-only,
  behaviour-preserving, includes the V70 policy) left for the other session to
  apply.
- **V76 `import_commit_batch` country gate** — the commit RPC enforced org +
  approval but not country, so a same-org user could commit another country's
  batch to live tables. Added `import_user_can_commit_country()` and a
  fail-closed gate after the cross-org check. Preserves today's admin
  (unassigned country = all). The *read* RLS on `import_*` stays org-only
  (Phase 2). Docs: `IMPORT_CENTER_SECURITY_PLAN.md` §3.

## 2026-07-04 (later) — Import Center read-path country isolation (V77)
- **V77** closes the Phase-2 read gap: RESTRICTIVE country SELECT policies on
  `import_batches`/`import_files`/`import_rows` (via `import_user_can_commit_country`
  + the SECURITY DEFINER `import_batch_country`), ANDing on the org isolation.
  Same-org cross-country users can no longer see each other's staged
  batches/files/rows. Verified: same-org UAE user sees 0 KSA batches/rows;
  NULL-country admin still sees all (3 batches / 18 rows). `get_advisors`
  (security): 0 ERROR-level findings. Import Center country isolation is now
  closed on BOTH commit (V76) and read (V77).

## 2026-07-04 (later) — Multi-agent audit fixes (5 agents: security/data/react/service-layer/mobile)
Ran 5 parallel read-only audit agents; every finding was verified against the live
schema before acting (several "critical" column-existence findings were FALSE
POSITIVES — budgets.country, tyre_records.serial_number/tyre_serial/supplier/
findings/asset_number/driver_id, vehicle_fleet.country all exist — and were left
untouched). Confirmed fixes landed:
- **Search-filter injection (MED)** — `sanitizeSearchTerm` strips `,()*\` from user
  search terms before PostgREST `.or()/.ilike()` interpolation (9 sites);
  `applyCountry` strips the same from the country value.
- **corrective_actions.source (HIGH)** — Inspection-Intelligence "Raise Alert" wrote a
  non-existent column → every insert 400'd while reporting success. Dropped `source`,
  added `title`, made the insert throw on error.
- **V78 fabricated tyre cost** — dropped `tyre_records.cost_per_tyre` DEFAULT 1200.
- **Country isolation** — FleetIntelligence / WorkshopManagement / VendorIntelligence
  now scope by the active country (were reading all countries).
- **Numeric guards** — analyticsEngine.linearRegression ÷0 guard; FuelEfficiency
  Infinity guards on the fuel-consumption / fuel-cost divisions.

### Tracked backlog (verified-real, medium/low — next wave)
- Fetch-race cancellation guards on ~8 loaders (DowntimeTracker, FleetHealthBoard,
  DriverManagement, EngineeringKpi, FleetAnalytics, FuelEfficiency, VehicleHistory ×2,
  TyreRecords/TyreExchange loaders lack try/finally too).
- Standardise `.eq('country')` → null-safe `applyCountry` on the remaining analytics reads.
- kpi_targets: redundant `UNIQUE(metric)` vs `onConflict(metric,year,month,site)` breaks
  save at year rollover.
- React: memoize Auth/Settings/Tenant context values; move `localStorage.setItem` out of
  the state updaters in Alerts (×3) and Anomalies (×1).
- Mobile (EAS, lower urgency): arbitrary-table write in `admin/approvals.tsx`; offline-queue
  idempotency (client_uuid + unique constraint + save-per-item + global sync lock);
  history.tsx missing error state; alerts ack offline fallback.

## 2026-07-04 (later) — Import Center: staging fix, Saved Mappings manager, auto-remember, force-upload
- **"Stage & continue → failed to fetch" fixed** — `stageRows` POSTed 500 rows ×
  4 JSONB blobs in one request; a wide/large file exceeded the gateway body limit
  and the fetch was dropped, leaving the batch `staged` with 0 rows (4 such
  zero-row batches were live). Now size-bounded chunks (≤100 rows AND ≤~1.2 MB
  serialized) + retry on transient network failure + a clear "request too large /
  connection dropped" message.
- **Saved Mappings manager** (`components/intake/MappingProfilesManager.jsx`) —
  on the Upload step: every saved column-mapping profile, grouped by module,
  expandable to its source→target column rules, with Rename / Activate-Deactivate
  / Delete / Apply. Closes the gap where saved mappings were only reachable as a
  nameless mid-upload dropdown and their columns were never viewable. New
  `imports.js`: `listAllProfiles` (with rule_count), `renameProfile`,
  `setProfileActive`, `deleteProfile`.
- **Auto-remember format** — staging a new file whose mapping did not come from a
  saved profile auto-saves it (keyed by header fingerprint), so the next upload of
  the same file auto-maps with zero clicks (fingerprint recognition already
  existed). Best-effort; never blocks staging.
- **Force-include** (elevated) — Validate-step toggle stages validation-error rows
  as warning/insert so the operator can commit rows they judge acceptable;
  genuinely un-insertable rows still fail safely per-row in the commit RPC.
- **Open (owner-requested, deeper):** data-level cross-file enrichment — filling
  an EXISTING live record from a later file (upsert-merge by natural key). In-batch
  cross-file merge exists (V72, cost modules); enriching existing live records is a
  new `import_commit_batch` mode = the recommended next server-side build (migration
  + rolled-back test).

## 2026-07-04 (later) — Intake: resilient staging, auto-remember, force-upload, cross-file enrichment
- **"Failed to fetch" on Stage & continue (fixed)** — staging POSTed 500 rows (four
  JSONB blobs each) in one request; large tyre/workorder files exceeded the gateway
  body limit and were dropped, leaving batches staged with 0 rows. Now size-bounded
  chunks (~1.2 MB / ≤100 rows) with retry+backoff.
- **Auto-remember format** — staging a new file auto-saves its column mapping
  (fingerprint-keyed), so the next file of that type maps itself.
- **Saved Mappings manager** — browse every saved mapping, expand to its source→target
  columns, rename / activate / delete.
- **Force-include (elevated)** — commit validation-error rows anyway; per-row failures
  stay isolated in the commit RPC.
- **V79 cross-file enrichment** — "Enrich existing records" (elevated) fills the BLANK
  fields of an already-existing record from a later file instead of skipping it.
  `import_natural_key` (all modules) matches the live record; `import_enrich_batch`
  fills only-empty columns via `jsonb_populate_record`, never overwrites, audited.
  Sandbox-verified (fill model, preserve make/site). Off by default.

## 2026-07-04 (final) — audit-backlog completion, auth, CSP, mobile idempotency
- **Audit backlog closed:** search-filter injection sanitizer (9 sites + country);
  `corrective_actions.source` broken insert; ÷0/Infinity guards; **8 loader
  fetch-race guards**; localStorage-in-updater → effects (Alerts/Anomalies);
  country isolation on FleetIntelligence/WorkshopManagement/VendorIntelligence.
- **V80** — dropped redundant `kpi_targets` UNIQUE(metric) (save broke at year rollover).
- **React perf** — memoized Auth/Settings/Tenant context values + callbacks.
- **V81 mobile idempotency** — `client_uuid` + UNIQUE index on the 5 offline-insert
  tables; both queues upsert-on-conflict-ignore + save-per-item + global sync
  mutex; online inspection path shares the client id. Kills duplicate records on
  crash / lost response / overlapping sync.
- **Mobile** — approvals arbitrary-table write → allow-list; history error state.
- **V82 no-email signup** — username + Employee ID + password only. Synthetic
  `<slug>@users.tyrepulse.app` + `auto_confirm_synthetic_email` trigger +
  `handle_new_user` employee_id/email + unique indexes on username/employee_id.
  `approved=false` retained. `Login.jsx` drops the email field.
- **CSP** added to `vercel.json` (non-breaking; connect-src → self+supabase,
  object-src none, frame-ancestors none). Other security headers already present.
- Gate: 875 web tests · build · mobile typecheck 0 errors. Live DB → **V82**
  (only V75 perf file unapplied).

## 2026-07-04 — Fix: large imports (2k+ rows) couldn't commit (V83)
- The `authenticated` role's statement_timeout is 8s, and a batch commits in one
  row-by-row RPC (import_commit_batch), so 2k+ rows exceeded 8s and were killed.
  V83 raises statement_timeout to 120s on import_commit_batch / import_enrich_batch
  / import_reverse_batch (SECURITY DEFINER → applies for their duration only).
  Staging was already size-chunked (earlier fix); no client-side row cap exists
  (stripFooterRows only prunes sparse footer rows). Very large files (50k+) may
  still want a future chunked commit.

## 2026-07-05 — Deeper executive scheduled-report digest (V86)
- Extended `report_exec_digest` (additive to V85) with 7 new sections: 6-month
  cost trend, projected annual spend (run-rate) vs annual budget, highest-cost
  assets, removals by tyre position, spend by category (new/retread), spend by
  country, and brand reliability (High/Critical risk % per brand). Org-scoped;
  no schema change. Email renderer (`send-scheduled-reports`) gained the matching
  sections + a spend-bar trend + brand-reliability list + 2 new recommendations
  (budget overrun, worst-reliability brand). Takes effect on edge-function
  redeploy. Live DB → V86.
