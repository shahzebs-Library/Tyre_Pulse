# TyrePulse - Developer Handoff
**Last updated:** 4 July 2026
**Branch:** `main` (all work merged; auto-deploys to Vercel)
**Web build status:** ✅ Clean - builds, **730/730 tests passing**, auto-deploys to Vercel
**Mobile build status:** ✅ EAS Android build green - Expo SDK 53, auto-builds on push to `main`
**DB migrations applied to live Supabase:** through **V71** (project `jhssdmeruxtrlqnwfksc`)
**Live URL under test:** tyre-pulse-peach.vercel.app
**Active branches:** `main` · dev `claude/mobile-app-ui-features-tdfxy0` · frozen `claude/backend-step2-assets` (Go) · frozen `claude/mobile-kotlin-app` (Kotlin). All other feature branches consolidated into `main` (see `docs/BRANCH_CONSOLIDATION_2026-07-04.md`).

---

## Session 7 (4 July 2026) — Security hardening, data-race fixes, branch consolidation

**Theme:** an in-depth security/data/React audit → fix the confirmed-safe findings, then consolidate the branch clutter onto `main`.

### Security (all live, gated: 730 tests + build green)
- **V70 `profiles_org_isolation`** — the only SELECT policy on `profiles` was `auth.role()='authenticated'`, so any signed-in user could read **every** org's profiles (names, roles, org, emp codes). Added a RESTRICTIVE gate (`id=auth.uid()` OR `app_is_org_admin()` OR `org_id=app_current_org()`). Helpers are SECURITY DEFINER (no RLS recursion); `app_current_org()` reads `profiles.org_id` (verified). Proven with a rolled-back two-tenant probe (org-A user sees only self; no org-B/admin leak).
- **V71 `report_org_tyre_spend` + `send-scheduled-reports` scoping** — the cron digest counted tyre_records/work_orders/corrective_actions/accidents and summed spend across **all** organisations with the service role → org A emailed org B's numbers. Now scoped by `schedule.org_id`; edge function redeployed **v2** (verify_jwt preserved).
- **Daily Ops print XSS** — `printBriefing()` interpolated DB fields into `document.write` HTML → now HTML-escaped + severity class whitelisted.
- **`useRealtimeAlerts.markAllRead`** — RPCs were fired inside the state updater (StrictMode double-fires) → moved outside.
- **Verified safe:** impersonating `anon`, all sensitive tables return **0 rows** (RLS holds despite default table grants). `get_advisors(security)` → **0 errors**.

### Data-race hardening
- **`StockManagement.load()`** — a thrown fetch left the spinner stuck forever with no message → wrapped in try/catch/finally (surfaces via the existing error banner).
- **`FleetMaster.loadRecords()`** — fired a query per search keystroke with no ordering guarantee → added a 300ms debounced search term + a monotonic request-id guard (only the newest response applies) + `setLoading` in finally.

### Branch consolidation
- Verified (dry-run merges + `--merged`) that **all** feature/session branches' work is already in `main`; documented in `docs/BRANCH_CONSOLIDATION_2026-07-04.md` with recovery SHAs. Local branches pruned to the 4 protected.
- ⚠️ **Remote branch deletion is still pending** — this session's git credential returns **403** on `git push --delete` (can push commits, cannot delete refs; no GitHub MCP delete tool). **Next dev / owner:** delete the 24 listed branches via the GitHub UI (Branches page) or an authenticated terminal — command is in `docs/BRANCH_CONSOLIDATION_2026-07-04.md`.

### Still open / needs the owner
- Set the **`RESEND_API_KEY`** edge-function secret so scheduled digests actually send.
- Fill each org's branding in **User Management → Branding**.
- **Deferred (need a decision):** `get_email_by_identifier` login enumeration (inherent to email/username login UX); a strict **CSP header** in `vercel.json` (risky to add blind against the live app); ~30 low-value unmount cancellation guards (cosmetic warnings, not correctness bugs).

---

## Session 6 - Fixing the data/AI section: production schema drift, CORS, approvals, UI crashes

**Root theme:** most "X is not working" reports traced to the **live Supabase/edge state having drifted from the code**, not client bugs. Always verify the live DB/edge config (information_schema, pg_policies, pg_proc, edge logs), not just the migration files.

### Knowledge Base / RAG - was never provisioned in prod (FIXED)
- Live `knowledge_documents` had drifted: **no pgvector, no embedding column, old `source_type` schema, no `match_knowledge_documents()`** → every KB upload 400'd, table stayed empty.
- **`MIGRATIONS_V51_KNOWLEDGE_BASE_RAG.sql` (applied live):** enable pgvector, rebuild `knowledge_documents` to the code contract (`doc_type` CHECK sop/manual/policy/inspection/rca/vendor/other, `asset_no`, `tags text[]`, `embedding vector(1536)`, org/created_by defaults), ivfflat cosine index, RLS (select=true / write Admin+Manager), and the `match_knowledge_documents(query_embedding, match_count, filter_doc_type, filter_site)` RPC. Table was empty → non-destructive.

### Edge CORS - blocked ALL AI on the vercel.app site (FIXED)
- `supabase/functions/_shared/auth.ts` only allowed `tyrepulse.app` + localhost. The app is tested on `tyre-pulse-peach.vercel.app`, so the browser CORS-blocked every `chat-ai` / `generate-embedding` POST after preflight (edge logs: OPTIONS 200, no POST). This - not a missing OpenAI key - kept KB un-indexed, the chatbot dead, and `ai_token_logs` empty.
- Fix: allow any `^https://[a-z0-9-]+\.vercel\.app$` origin (prod alias + rotating previews) plus the existing list; `ALLOWED_ORIGINS` env override still wins. Safe because functions still require a valid approved-user JWT.
- **Redeployed live: `chat-ai` v5 (verify_jwt=false), `generate-embedding` v4 (verify_jwt=true).**

### Upload/Approvals - unified the two disconnected pipelines
- There were **two pipelines** that didn't share data: Data Intake (`import_batches`/`import_rows`) and legacy Upload (`pending_uploads`). Each history/approval view read only one → the other always looked empty (the "not linked" symptom).
- **`UploadApprovals.jsx`** now defaults to a **"Data Intake" tab** over `import_batches WHERE approval_status='pending_approval'`: **Approve & Commit** via the secure `import_commit_batch` RPC (fixes non-admin orphaned submissions **and** the client-side insert 400 on generated cols/CHECK enums), **Reject**, and a read-only staged-rows preview. Legacy `pending_uploads` kept as a secondary tab + added **Delete** action + console error logging (errors no longer swallowed into empty lists).
- **`DataIntakeCenter.jsx` Recent imports** now has an Actions column: **Open** (→ history), **Delete** (staged/abandoned - cascades to rows/sheets/attachments), **Reverse** (committed - removes the live rows too).
- New service fns in `src/lib/api/imports.js`: `listForApproval()`, `rejectBatch()`, `deleteBatch()`.

### UI crash + swallowed-error fixes
- **React error #130 crash** on KnowledgeBase and AiCostMonitor: both passed a JSX *element* to `PageHeader icon=` (which renders `<Icon/>`). Fixed to component reference (`icon={BookOpen}` / `icon={DollarSign}`). Every other page already used the component-ref form.
- **Legacy "Preview" did nothing:** `UploadData.buildPreview()` had no try/catch and only advanced the step on its last line - any failure killed the click silently. Now wrapped, surfaces the error.

### Still open / needs the user
- **OPENAI_API_KEY / ANTHROPIC_API_KEY**: user says OpenAI key already set; verify with `supabase secrets list --project-ref jhssdmeruxtrlqnwfksc`. With CORS fixed, KB indexing + chat + AI Cost Monitor population should now work after a hard-refresh.
- **Data Intake staging stall** (`total_rows=0`): proven NOT a schema/RLS/CHECK block - the wizard's `stageRows` was never completed for the two abandoned batches. Needs a live upload with a real file to capture the exact failing step (Console now logs; watch the `import_rows` POST in Network). The two stuck `staged 0/0` batches can now be removed with the new Delete button.
- Untracked, intentionally not committed: `QA_DATA_INTAKE_REPORT.md`, `QA_REPORT.md`, `mobile/ui_screenshot.png`.

---

## Session 5 - RAG/AI tooling, AI cost logging, and the complete Multi-Country Data Intake Center

### Web - new modules (all wired into router + nav, build-clean)
- **Knowledge Base** (`/knowledge-base`, `src/pages/KnowledgeBase.jsx`) - RAG document ingestion: drag-drop upload, 1500/200 chunking, per-chunk embedding via the `generate-embedding` edge function, `knowledge_documents` storage, status/search/filter/re-index, RBAC-gated writes.
- **AI Cost Monitor** (`/ai-cost-monitor`, `src/pages/AiCostMonitor.jsx`) - reads `ai_token_logs`; KPI cards, daily SVG sparkline, feature/site spend breakdown, raw log table, date/feature/model filters. Uses inline SVG/CSS (no chart lib - project has no recharts).
- **Scheduled Reports** - `report_schedules` table created (V44) to back the pre-existing `ScheduledReports.jsx`.

### Edge functions - AI token logging (deployed live)
- `chat-ai` (v4, verify_jwt=false / custom auth) and `generate-embedding` (v3) now fire-and-forget insert into `ai_token_logs` with computed `cost_usd`, fully isolated from the response path. Model logged as base id (`claude-haiku-4-5`) to match the dashboard rate table.

### DB migrations (V42-V50, all applied live)
- **V42** vehicle_fleet RLS split · **V43** `profiles.push_token` (+index) · **V44** `report_schedules` + `ai_token_logs` (trigger fn auto-detect: this DB uses `set_updated_at()`, NOT `update_updated_at_column()`) · **V45/V46** import staging schema + commit/reverse/reprocess RPCs (prior session) · **V47** live-dedup `import_existing_keys` · **V48** accident dedup branch · **V49** inspection/workorder/warranty/gatepass branches · **V50** `suppliers` + `drivers` master tables + supplier/driver dedup branches.

### Mobile - push notifications
- `lib/notifications.ts` (channels, permission, Expo push-token registration to `profiles.push_token`, sync success/failure + daily inspection reminder), wired into `_layout.tsx` boot + `profile.tsx` settings + `offlineQueue.ts` sync. `app.json` plugin + permissions added.

### Mobile - Play Store prep
- `mobile/PLAY_STORE_SUBMISSION.md` runbook; `eas.json` `serviceAccountKeyPath` fixed; secrets gitignored. **Exact-alarm policy declaration** flagged as a likely Play rejection cause.

### Data Intake Center - `Data correction.md` COMPLETE for all live-target modules
Built across phases (see `docs/IMPORT_CENTER_MIGRATION_PLAN.md`). The shared engine (`src/lib/import/*`: parseWorkbook, mapping, transform, validate, synonyms, attachments, reconcile) + `src/pages/DataIntakeCenter.jsx` wizard now handle **10 modules**, each: upload → map (EN/Arabic) → transform → validate → in-batch **+ live-table** dedup → approve → audited commit (`import_commit_batch`) → reconcile / reverse.
- **Phase 2** - Fleet / Tyre / Stock + live-table dedup (V47) + reconciliation report.
- **Phase 3** - Accidents/Insurance: financial-integrity validation, ZIP **evidence-package ingestion** (`attachments.js`, jszip → private `import-files` bucket → `import_attachment_matches`, matched by claim/police/asset).
- **Phase 4** - Inspections / Work Orders / Warranty / Gate Pass (V49).
- **Master tables (V50)** - `suppliers` + `drivers` created (org/country-scoped, RLS like vehicle_fleet) and wired as live adapters.
- Each legacy uploader (FleetMaster, UploadData, StockManagement, Accidents, Inspections, WorkOrders, WarrantyTracker, GatePass, SupplierManagement, DriverManagement) now opens the engine via `/data-intake?module=<key>`.
- **Module → table:** fleet→vehicle_fleet, tyre→tyre_records, stock→stock_records, accident→accidents, inspection→inspections, workorder→work_orders, warranty→warranty_claims, gatepass→gate_passes, supplier→suppliers, driver→drivers.
- **Natural keys** (mirror client `validate.js` keyParts → server `import_existing_keys`, joined with `chr(1)`): fleet=country+asset_no; tyre=country+serial_no; stock=country+site+description; accident=country+claim_no/police_report_no; inspection=country+asset_no+type+date+inspector; workorder=country+work_order_no; warranty=country+serial_number+claim_no; gatepass=country+asset_no+pass_date; supplier=country+code/name; driver=country+driver_id.
- **Staging-only by design:** GPS/ERP + custom (source-defined / preserved in custom_data + Custom Field Catalogue - no fixed target table).

### Known gaps / not done
- **Mobile Play Store submission** needs external artifacts only you can supply: Firebase `google-services.json`, Play service-account key, `notification-icon.png`, store-listing copy + screenshots.
- **No real-device mobile QA** pass run this session.
- **Go-backend migration** (`Roadmap_latest.Md`) deliberately untouched.
- Minor: overlapping `vehicle_fleet` RLS policies (old `vf_*` + new V42) worth consolidating; `package.json`/`app.json` mobile version drift (cosmetic, EAS-managed).

---

## Session 4 - Photo Upload Fix, Secure Storage & RLS Hardening

### Mobile - Photo upload bug fixed (photos were silently failing)
- **Root cause:** `TyreEditor.tsx` used `fetch(localUri).blob()` to read captured photos before uploading. In React Native / Expo, `fetch().blob()` on a `file://` URI yields an **empty blob** - photos appeared to upload but Supabase received 0 bytes.
- Fixed: switched to `FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })` → decode to `Uint8Array` → upload bytes directly. This matches the approach already in `photoUpload.ts` (offline queue path) which was working correctly.
- Both the **immediate upload** path (TyreEditor, online inspection) and the **offline queue** path (`offlineQueue.ts` → `uploadAllPositionPhotos`) now use the same reliable FileSystem base64 method.

### Mobile - Photo bucket alignment
- `photoUpload.ts:uploadInspectionPhoto` was targeting bucket `inspection-photos` which **does not exist** in the Supabase storage setup (only `tyre-photos` is provisioned in MASTER_MIGRATION.sql).
- Fixed: changed to `tyre-photos` with organized path prefix `inspections/{id}/{pos}_{ts}.{ext}` - consistent with TyreEditor's `photos/` prefix and accident photos' `accidents/` prefix, all in the same public bucket.

### Mobile - Chunked SecureStore adapter
- `mobile/lib/secureStorage.ts`: new chunked adapter for `expo-secure-store` handling auth tokens that exceed the **2 KB iOS Keychain item limit**. Supabase access+refresh token pairs routinely exceed 2 KB on accounts with large metadata. The adapter transparently splits values into 1800-char chunks with a metadata key.
- Wired into `supabase.ts` as the `auth.storage` provider - replaces the old bare `SecureStore` adapter.

### DB - vehicle_fleet RLS hardened (MIGRATIONS_V42)
- `MIGRATIONS_V42_VEHICLE_FLEET_RLS.sql` + updated `MASTER_MIGRATION.sql`:
  - Extended SELECT policy to `anon` role (required for registration/site-lookup flows that run before auth completes).
  - Split the old catch-all `vehicle_fleet_write` policy into three explicit `vehicle_fleet_insert / _update / _delete` policies with `auth.uid() IS NOT NULL` guards.

### Storage policy note
The `tyre-photos` bucket is **public** (set in MASTER_MIGRATION.sql). All tyre, inspection, and accident photos are served via public URLs - no signed-URL round-trip required on read. The `storageRefs.ts` `resolveStorageUrl` function handles both the `tp-storage://` internal reference format (→ signed URL) and bare `https://` public URLs transparently.

---

## Session 3 - Stabilization, Scanner & Whole-Project Audit

### Mobile - EAS build fixed (was failing "Gradle build failed with unknown error")
- **Root cause:** `expo` was pinned to `~54.0.0` while the entire tree was Expo **SDK 53** (RN 0.79, React 19.0.0). SDK 54 needs RN 0.81 - a binary mismatch. Earlier New-Arch/NDK/Kotlin commits were treating symptoms.
- Pinned `expo` to `~53.0.0` (53.0.27) and aligned every native module to its SDK 53 canonical version (RN 0.79.6, react-native-screens ~4.11.1, react-native-safe-area-context 5.4.0, gesture-handler ~2.24.0, expo-build-properties ~0.14.8, expo-router ~5.1.11, ...).
- Added explicit **`expo-asset`** dependency - it was nested under `node_modules/expo/` and Metro couldn't resolve it, breaking the JS bundle phase.
- CI now uses `npm ci` (was `npm install --legacy-peer-deps`, which masked the mismatch) + npm caching.
- **Result:** full EAS Android build goes green end-to-end and auto-triggers on merge to `main`.

### Mobile - functional fixes
- **Sign-in routing:** login only navigated after an unrelated re-render (e.g. language change). Added a reactive guard in `(auth)/_layout.tsx` → redirects to `/(app)` the moment the user is authenticated.
- **Inspection flow aligned to the REAL DB schema** (was silently broken): vehicle list was empty because the app queried `asset_number` (real column is **`asset_no`**); submit/history used `inspector_name`/`inspector_id`/`odometer`/`status:'submitted'`/`inspection_type:'Daily Checklist'` which don't exist / violate check constraints. Now uses `asset_no`, `inspector`, `created_by`, `scheduled_date` (NOT NULL), `status:'Done'`, `inspection_type:'Routine'`, odometer folded into `notes`. History/home filter on `created_by`.
- **RLS:** the `inspections` INSERT policy only allowed Reporter/Manager/Admin - the `Tyre Man` (inspector) role was blocked. Added `Tyre Man`, `Inspector`, `Director`.
- **Startup hang fixed:** auth no longer blocks on the profile query (resolves from local session, profile loads in background); font gate has a 3 s timeout fallback.
- **Icons fixed:** Ionicons font preloaded in RootLayout (glyphs were rendering blank).
- **Role badge** now localizes (snake_case key normalization).

### Mobile - new feature: Tyre/Asset Scanner
- `mobile/app/(app)/scanner.tsx` - `expo-camera` `CameraView` reads tyre serial barcodes / asset QR; resolves a code to a **vehicle** (→ start inspection with site+asset preselected) or a **tyre record** (brand/size/position/asset details); torch, permission, rescan states; full EN/AR/UR.
- Home screen has a **"Scan Tyre / Asset"** entry; registered as a hidden route (no extra tab).

### Mobile - History completed to product standard
- Live search (title/asset/site), status filter chips with counts, distinct empty vs no-results states.

### Web - Inspections/Checklist crash + data linkage
- **Crash fixed:** the Checklist page threw a temporal-dead-zone `ReferenceError` (a `useEffect` referenced `masterSites` in its deps before the `useState` was declared). A full TDZ scan of `src/` found no others.
- **Broken data sources linked (no demo data):** created DB **views** `public.vehicles → vehicle_fleet` and `public.tyre_changes → tyre_records` (`security_invoker`), and a real **`public.alerts`** table (indexes + RLS). Fixed `inspections` queries that used non-existent columns (`inspector_name`/`tread_depth`/`pressure_reading` → `inspector` + `tyre_conditions`); removed a non-existent `status` column from the global tyre search.
- **Performance:** added indexes on `tyre_records` (asset_no, issue_date, site, serial_number), `vehicle_fleet` (site, asset_no), `inspections` (created_by, inspection_date, site).

### Audit summary
Mobile: tsc clean, bundle clean, i18n parity en/ar/ur (0 gaps), all routes/buttons/queries valid, RLS + login RPC verified. Web: build + 369/369 tests pass, all referenced tables/columns now resolve against the live DB.

---


## Session 1 - Web Platform (Previously Documented)

### What Was Done
1. Multi-Identifier Login (Email / Username / Employee ID)
2. RBAC tightened - Intelligence (Admin only), Analytics (Admin + Manager + Director)
3. 30-minute session timeout with touch event tracking
4. Admin approval gate (`approved: false` on signup)
5. Inspection Checklist full overhaul - dropdown inputs, auto-title, SVG PDF
6. Vehicle Diagram - case-insensitive, position IDs consistent
7. PageHeader applied to all 73 pages
8. Build errors fixed (orphan divs, missing icons)

Full detail in the previous HANDOFF section below ↓

---

## Session 2 - Mobile App (React Native + Expo SDK 54)

### What Was Built

A complete React Native mobile inspector app - **TyrePulse Inspector** - targeting the Tyre Man / Inspector role workflow. Built with Expo SDK 54 + React Native 0.79.2.

#### Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/(auth)/login` | Supabase auth, language selector (EN/AR/UR), error states |
| Home | `/(app)/index` | Greeting, pending sync count, quick-start inspection, **Scan Tyre/Asset**, recent history |
| New Inspection | `/(app)/inspection/new` | Multi-step: vehicle details → tyre position cards → submit (accepts `?asset=` deep-link from scanner) |
| Scanner | `/(app)/scanner` | Camera barcode/QR scanner → vehicle or tyre lookup (hidden route) |
| History | `/(app)/history` | Inspections with search + status filters + sync badges (synced/pending/failed) |
| Profile | `/(app)/profile` | User info, language toggle, offline queue stats, sign out |

#### Core Features

**Authentication**
- Supabase JWT stored in `expo-secure-store` (not AsyncStorage)
- Profile fetched from `profiles` table on login
- AuthContext wraps entire app via `app/_layout.tsx`

**Offline-First Inspection Queue**
- File: `mobile/lib/offlineQueue.ts`
- Storage key: `tp_inspection_queue_v1` (AsyncStorage)
- Each queued item: `{ id, payload, sync_status, created_at, retry_count }`
- `sync_status`: `'pending' | 'synced' | 'failed'`
- `syncQueue()` - pushes pending items to Supabase `inspections` table
- `retryFailed()` - re-queues failed items
- `getPendingCount()` - returns count for SyncBanner

**Tyre Position Cards**
- Component: `mobile/components/TyrePositionCard.tsx`
- Supports all vehicle positions: FL, FR, RL, RR, RLO, RLI, RRO, RRI + numbered variants
- Position badge shows code + translated label (e.g. `FL` + `أمامي أيسر`)
- Fields per tyre: serial number, pressure (bar), tread depth (mm), condition, photo, notes
- Condition: Good / Worn / Damaged / Flat / Missing
- Photo: `expo-camera` + `expo-image-picker`

**Network Monitoring**
- `SyncBanner` uses `addNetworkStateListener` from `expo-network` (NOT `@react-native-community/netinfo` - removed due to Gradle incompatibility with AGP 8.x)
- Banner shows: offline status | pending count + sync button | hidden when online + synced

**i18n - Arabic + Urdu + English**
- Context: `mobile/contexts/LanguageContext.tsx`
- Locales: `mobile/locales/en.json`, `ar.json`, `ur.json` (~130 strings each)
- `t('namespace.key')` - dot-notation resolver
- `isRTL` flag - controls text alignment and flex direction
- Language switch → `I18nManager.forceRTL()` → `Updates.reloadAsync()` (full app reload to apply RTL)
- Persisted in AsyncStorage under `tp_language`
- Language selector: Login screen (before auth) + Profile screen (after auth)

---

### Mobile File Structure

```
mobile/
├── app/
│   ├── _layout.tsx              - Root layout: SafeAreaProvider > LanguageProvider > AuthProvider
│   ├── (auth)/
│   │   └── login.tsx            - Login screen with language toggle
│   └── (app)/
│       ├── _layout.tsx          - Tab navigator (Home / Inspect / History / Profile)
│       ├── index.tsx            - Home screen
│       ├── history.tsx          - Inspection history
│       ├── profile.tsx          - Profile + language + sign out
│       └── inspection/
│           └── new.tsx          - New inspection multi-step form
├── components/
│   ├── TyrePositionCard.tsx     - Per-tyre data entry card
│   └── SyncBanner.tsx           - Offline/sync status banner
├── contexts/
│   ├── AuthContext.tsx          - Supabase auth state
│   └── LanguageContext.tsx      - i18n + RTL
├── lib/
│   ├── supabase.ts              - Supabase client (expo-secure-store adapter)
│   └── offlineQueue.ts          - AsyncStorage inspection queue
├── locales/
│   ├── en.json                  - English strings
│   ├── ar.json                  - Arabic strings (MSA, RTL)
│   └── ur.json                  - Urdu strings (RTL)
├── app.json                     - Expo config + EAS project ID
├── eas.json                     - EAS build profiles (dev/preview/production)
└── package.json                 - Dependencies
```

---

### Mobile Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.79.6 |
| Expo SDK | 53.0.27 |
| Router | expo-router v5 |
| Auth storage | expo-secure-store |
| Offline queue | AsyncStorage (`@react-native-async-storage/async-storage` 2.1.2) |
| Network | expo-network 7.1.5 (`addNetworkStateListener`) |
| Camera | expo-camera 16.1 + expo-image-picker 16.1 |
| Icons | @expo/vector-icons (Ionicons) |
| i18n | Custom LanguageContext (no external library) |
| Build | EAS Build (cloud) via GitHub Actions |
| CI/CD | `.github/workflows/build-android.yml` |

---

### EAS Build Configuration

**`mobile/eas.json`** - Supabase env vars baked into all profiles:
```json
{
  "preview": {
    "distribution": "internal",
    "android": { "buildType": "apk" },
    "env": {
      "EXPO_PUBLIC_SUPABASE_URL": "https://jhssdmeruxtrlqnwfksc.supabase.co",
      "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ..."
    }
  }
}
```

**GitHub Actions** - `.github/workflows/build-android.yml`
- Triggers on push to `main` (paths: `mobile/**`) or `workflow_dispatch`
- Uses `EXPO_TOKEN` secret (already added to repo)
- Runs `eas build --platform android --profile preview --non-interactive`
- APK available at expo.dev after successful build

---

### Build Troubleshooting History

The EAS Gradle build has been failing. All fixes applied in order:

| # | Commit | Fix | Root Cause |
|---|--------|-----|-----------|
| 1 | `4e92755` | `expo-build-properties` added to package.json | Was in app.json plugins but missing from dependencies - broke `expo config` |
| 2 | `6b79a34` | Kotlin → `2.0.21` (was `1.9.25`) | RN 0.79.2 requires Kotlin 2.0.x |
| 3 | `4ddcf1a` | TypeScript fix in LanguageContext | `reduce` return type + expo-updates missing locally |
| 4 | `1f3a46e` | Replace `@react-native-community/netinfo` with `expo-network`; add SDK 35 config | netinfo's `build.gradle` uses old `compileOptions` incompatible with AGP 8.x; compileSdkVersion/targetSdkVersion/buildToolsVersion needed |
| 5 | `ea24776` | `"newArchEnabled": false`; `ndkVersion: "27.1.12297006"` | RN 0.79 defaults New Architecture ON - requires NDK 27 C++ compilation that fails silently on EAS workers |

| 6 | (Session 3) | Pin `expo` to `~53.0.0`; align whole native tree to SDK 53; add explicit `expo-asset`; `npm ci` in CI | **Real root cause** - `expo` was on SDK 54 while everything else was SDK 53 (binary mismatch). Fixes #1-5 were symptom-patches. |

**Current status:** ✅ **Resolved.** Full EAS Android build is green end-to-end and auto-builds on push to `main`. The New-Arch/NDK/Kotlin tweaks (#2,#5) remain as valid SDK 53 defaults.

---

### Supabase Tables Used by Mobile

| Table | Usage |
|-------|-------|
| `auth.users` | Login / sign out via `supabase.auth.signInWithPassword` |
| `profiles` | `id`, `username`, `full_name`, `employee_id`, `role`, `site`, `country`, `approved` |
| `vehicle_fleet` | Site/vehicle pickers + scanner lookup - columns `asset_no`, `site`, `vehicle_type`, `make`, `model` |
| `inspections` | Write inspection records - `title`, `site`, **`asset_no`**, `vehicle_type`, **`inspector`** (text), **`created_by`** (uuid), `inspection_date`, **`scheduled_date`** (NOT NULL), `inspection_type` ('Routine'), `tyre_conditions` JSONB, `notes`, `status` ('Done'). No `odometer` column - folded into `notes`. |
| `tyre_records` | Scanner tyre lookup by serial - `serial_no`/`serial_number`/`tyre_serial`, `brand`, `size`, `position`, `asset_no`, `tread_depth`, `pressure_reading` |
| RPC `get_email_by_identifier` | Resolves username / Employee ID → email pre-auth (SECURITY DEFINER, anon-executable) |

**RLS note:** Mobile uses the anon key. The `inspections` INSERT policy allows roles `Reporter, Manager, Admin, Director, Tyre Man, Inspector` (the inspector role was added in Session 3). `vehicle_fleet`, `tyre_records`, and `profiles` SELECT are open to any authenticated user.

---

## Previous Session - Web Platform Detail

### 1. Multi-Identifier Login
- Login accepts Email, Username, or Employee ID
- `AuthContext.signIn()` resolves username/employee_id → email via `profiles` table + `get_user_email_by_id` RPC

### 2. RBAC
- Intelligence (40+ pages) - Admin only
- Analytics (7 pages) - Admin + Manager + Director
- `shouldShowGroup()` in `Layout.jsx` hides nav group; `<RoleRoute>` guards routes

### 3. 30-Minute Session Timeout
- 30-min idle timeout, 30-s check interval
- Touch events tracked (`touchstart`)

### 4. Admin Approval Gate
- New signups: `approved: false`
- `ProtectedRoute` blocks unapproved profiles

### 5-9. Checklist, Vehicle Diagram, PageHeader, Build Fixes
See ROADMAP.md for full status.

---

## Required Supabase SQL (Run Once)

> **Note (Session 3):** The live `inspections` schema uses `asset_no`, `inspector` (text), `created_by` (uuid), `scheduled_date` (NOT NULL) and check constraints on `status` / `inspection_type` - the mobile app and web Checklist write to these. Username login uses the `get_email_by_identifier` RPC. Session-3 also added: views `vehicles`/`tyre_changes`, the `alerts` table, performance indexes, and the inspector INSERT policy (already applied to the live DB). The block below is the original Session-1/2 reference.


```sql
-- Inspection columns
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS tyre_conditions jsonb;
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON inspections USING gin(tyre_conditions);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS vehicle_type text;
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type ON inspections (vehicle_type);

-- Multi-identifier login
CREATE OR REPLACE FUNCTION get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = user_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;
CREATE INDEX IF NOT EXISTS profiles_employee_id_idx ON profiles (employee_id);
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);

-- RLS for mobile inspection insert
CREATE POLICY IF NOT EXISTS "Inspector can insert own inspections"
ON inspections FOR INSERT
TO authenticated
WITH CHECK (inspector_id = auth.uid());
```

---

## Architecture Reference

### Auth & RBAC (Web)

| Role | Intelligence | Analytics | Operations | Admin |
|------|-------------|-----------|------------|-------|
| Admin | ✅ | ✅ | ✅ | ✅ |
| Manager | ❌ | ✅ | ✅ | ❌ |
| Director | ❌ | ✅ | ✅ | ❌ |
| Tyre Man | ❌ | ❌ | ✅ | ❌ |
| Inspector | ❌ | ❌ | Inspections + Settings only | ❌ |
| Reporter | ❌ | ❌ | ✅ | ❌ |

### Session (Web)
```
Idle timeout:    30 minutes
Check interval:  30 seconds
Events tracked:  mousemove, keydown, click, touchstart
Storage key:     tp_last_activity (localStorage)
```

---

## Key Libraries

| File | Purpose |
|------|---------|
| `mobile/lib/offlineQueue.ts` | AsyncStorage inspection queue + sync |
| `mobile/lib/supabase.ts` | Supabase client with SecureStore session |
| `mobile/contexts/LanguageContext.tsx` | i18n + RTL management |
| `mobile/contexts/AuthContext.tsx` | Supabase auth + profile state |
| `src/lib/kpiEngine.js` | 18 KPI computations (web) |
| `src/lib/ragService.js` | RAG retrieval + 5-min cache (web) |
| `src/lib/aiRouter.js` | Query classification → agent routing (web) |

---

## Supabase Edge Functions

| Function | Input | Purpose |
|----------|-------|---------|
| `chat-ai` | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | `{ to, subject, body }` | Resend API email |

Env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

---

## Next Session Priorities

### Mobile (Immediate)
1. ✅ EAS build green (SDK 53) - install the latest `main` APK from expo.dev (`@ws123na/tyrepulse-inspector` → Builds)
2. Device test - login, inspection submit, scanner, offline sync (all wired to live schema)

### Mobile (Next Sprint)
3. ✅ Photo uploads to Supabase Storage - fixed in Session 4 (FileSystem base64 path, correct bucket)
4. ✅ Barcode/QR scanner - delivered (`app/(app)/scanner.tsx`)
5. ✅ Push notifications - delivered in Session 5 (`lib/notifications.ts`, profile settings, daily reminders)
6. Play Store submission prep - `eas.json` production profile ready; need `google-services.json` + signing key + store listing assets

### Web (Done)
7. ✅ RAG document ingestion - `KnowledgeBase.jsx` at `/knowledge-base` (file upload + chunking + embedding)
8. ✅ AI cost monitor - `AiCostMonitor.jsx` at `/ai-cost-monitor` (token logs + spend breakdown)
9. ✅ Scheduled reports DB - `MIGRATIONS_V44` adds `report_schedules` table backing `ScheduledReports.jsx`

### Web / Data Intake Center (Done - Session 5)
10. ✅ Multi-Country Data Intake Center complete for all 10 live-target modules (`Data correction.md`) - see Session 5 above + `docs/IMPORT_CENTER_MIGRATION_PLAN.md`
11. ✅ AI token logging deployed to `chat-ai` (v4) + `generate-embedding` (v3) edge functions
12. ✅ All migrations V42-V50 applied to live Supabase

### Remaining
- **Play Store submission:** Add `google-services.json` (Firebase console, for push) + signing key (EAS managed credentials), submit the **exact-alarm policy declaration** in Play Console (see `mobile/PLAY_STORE_SUBMISSION.md`), then `eas build`/`eas submit -p android --profile production` from `mobile/`. Needs your Expo/Play credentials.
- **Mobile device QA:** run a real-device pass - login, inspection submit, scanner, offline sync, push.
- **GPS/ERP + custom import adapters:** staging-only by design (no fixed target table). Promote only if/when a target schema is defined.
- **Go-backend migration** (`Roadmap_latest.Md`): not started - deliberately out of scope.
- Minor: consolidate overlapping `vehicle_fleet` RLS policies; align mobile `package.json`/`app.json` version.

---

*TyrePulse v6.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
