# TyrePulse — Developer Handoff
**Last updated:** June 2026
**Branch:** `main` (all work merged)
**Web build status:** ✅ Clean — builds, 369/369 tests passing, auto-deploys to Vercel
**Mobile build status:** ✅ EAS Android build green — Expo SDK 53, auto-builds on push to `main`

---

## Session 3 — Stabilization, Scanner & Whole-Project Audit

### Mobile — EAS build fixed (was failing "Gradle build failed with unknown error")
- **Root cause:** `expo` was pinned to `~54.0.0` while the entire tree was Expo **SDK 53** (RN 0.79, React 19.0.0). SDK 54 needs RN 0.81 — a binary mismatch. Earlier New-Arch/NDK/Kotlin commits were treating symptoms.
- Pinned `expo` to `~53.0.0` (53.0.27) and aligned every native module to its SDK 53 canonical version (RN 0.79.6, react-native-screens ~4.11.1, react-native-safe-area-context 5.4.0, gesture-handler ~2.24.0, expo-build-properties ~0.14.8, expo-router ~5.1.11, …).
- Added explicit **`expo-asset`** dependency — it was nested under `node_modules/expo/` and Metro couldn't resolve it, breaking the JS bundle phase.
- CI now uses `npm ci` (was `npm install --legacy-peer-deps`, which masked the mismatch) + npm caching.
- **Result:** full EAS Android build goes green end-to-end and auto-triggers on merge to `main`.

### Mobile — functional fixes
- **Sign-in routing:** login only navigated after an unrelated re-render (e.g. language change). Added a reactive guard in `(auth)/_layout.tsx` → redirects to `/(app)` the moment the user is authenticated.
- **Inspection flow aligned to the REAL DB schema** (was silently broken): vehicle list was empty because the app queried `asset_number` (real column is **`asset_no`**); submit/history used `inspector_name`/`inspector_id`/`odometer`/`status:'submitted'`/`inspection_type:'Daily Checklist'` which don't exist / violate check constraints. Now uses `asset_no`, `inspector`, `created_by`, `scheduled_date` (NOT NULL), `status:'Done'`, `inspection_type:'Routine'`, odometer folded into `notes`. History/home filter on `created_by`.
- **RLS:** the `inspections` INSERT policy only allowed Reporter/Manager/Admin — the `Tyre Man` (inspector) role was blocked. Added `Tyre Man`, `Inspector`, `Director`.
- **Startup hang fixed:** auth no longer blocks on the profile query (resolves from local session, profile loads in background); font gate has a 3 s timeout fallback.
- **Icons fixed:** Ionicons font preloaded in RootLayout (glyphs were rendering blank).
- **Role badge** now localizes (snake_case key normalization).

### Mobile — new feature: Tyre/Asset Scanner
- `mobile/app/(app)/scanner.tsx` — `expo-camera` `CameraView` reads tyre serial barcodes / asset QR; resolves a code to a **vehicle** (→ start inspection with site+asset preselected) or a **tyre record** (brand/size/position/asset details); torch, permission, rescan states; full EN/AR/UR.
- Home screen has a **"Scan Tyre / Asset"** entry; registered as a hidden route (no extra tab).

### Mobile — History completed to product standard
- Live search (title/asset/site), status filter chips with counts, distinct empty vs no-results states.

### Web — Inspections/Checklist crash + data linkage
- **Crash fixed:** the Checklist page threw a temporal-dead-zone `ReferenceError` (a `useEffect` referenced `masterSites` in its deps before the `useState` was declared). A full TDZ scan of `src/` found no others.
- **Broken data sources linked (no demo data):** created DB **views** `public.vehicles → vehicle_fleet` and `public.tyre_changes → tyre_records` (`security_invoker`), and a real **`public.alerts`** table (indexes + RLS). Fixed `inspections` queries that used non-existent columns (`inspector_name`/`tread_depth`/`pressure_reading` → `inspector` + `tyre_conditions`); removed a non-existent `status` column from the global tyre search.
- **Performance:** added indexes on `tyre_records` (asset_no, issue_date, site, serial_number), `vehicle_fleet` (site, asset_no), `inspections` (created_by, inspection_date, site).

### Audit summary
Mobile: tsc clean, bundle clean, i18n parity en/ar/ur (0 gaps), all routes/buttons/queries valid, RLS + login RPC verified. Web: build + 369/369 tests pass, all referenced tables/columns now resolve against the live DB.

---


## Session 1 — Web Platform (Previously Documented)

### What Was Done
1. Multi-Identifier Login (Email / Username / Employee ID)
2. RBAC tightened — Intelligence (Admin only), Analytics (Admin + Manager + Director)
3. 30-minute session timeout with touch event tracking
4. Admin approval gate (`approved: false` on signup)
5. Inspection Checklist full overhaul — dropdown inputs, auto-title, SVG PDF
6. Vehicle Diagram — case-insensitive, position IDs consistent
7. PageHeader applied to all 73 pages
8. Build errors fixed (orphan divs, missing icons)

Full detail in the previous HANDOFF section below ↓

---

## Session 2 — Mobile App (React Native + Expo SDK 54)

### What Was Built

A complete React Native mobile inspector app — **TyrePulse Inspector** — targeting the Tyre Man / Inspector role workflow. Built with Expo SDK 54 + React Native 0.79.2.

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
- `syncQueue()` — pushes pending items to Supabase `inspections` table
- `retryFailed()` — re-queues failed items
- `getPendingCount()` — returns count for SyncBanner

**Tyre Position Cards**
- Component: `mobile/components/TyrePositionCard.tsx`
- Supports all vehicle positions: FL, FR, RL, RR, RLO, RLI, RRO, RRI + numbered variants
- Position badge shows code + translated label (e.g. `FL` + `أمامي أيسر`)
- Fields per tyre: serial number, pressure (bar), tread depth (mm), condition, photo, notes
- Condition: Good / Worn / Damaged / Flat / Missing
- Photo: `expo-camera` + `expo-image-picker`

**Network Monitoring**
- `SyncBanner` uses `addNetworkStateListener` from `expo-network` (NOT `@react-native-community/netinfo` — removed due to Gradle incompatibility with AGP 8.x)
- Banner shows: offline status | pending count + sync button | hidden when online + synced

**i18n — Arabic + Urdu + English**
- Context: `mobile/contexts/LanguageContext.tsx`
- Locales: `mobile/locales/en.json`, `ar.json`, `ur.json` (~130 strings each)
- `t('namespace.key')` — dot-notation resolver
- `isRTL` flag — controls text alignment and flex direction
- Language switch → `I18nManager.forceRTL()` → `Updates.reloadAsync()` (full app reload to apply RTL)
- Persisted in AsyncStorage under `tp_language`
- Language selector: Login screen (before auth) + Profile screen (after auth)

---

### Mobile File Structure

```
mobile/
├── app/
│   ├── _layout.tsx              — Root layout: SafeAreaProvider > LanguageProvider > AuthProvider
│   ├── (auth)/
│   │   └── login.tsx            — Login screen with language toggle
│   └── (app)/
│       ├── _layout.tsx          — Tab navigator (Home / Inspect / History / Profile)
│       ├── index.tsx            — Home screen
│       ├── history.tsx          — Inspection history
│       ├── profile.tsx          — Profile + language + sign out
│       └── inspection/
│           └── new.tsx          — New inspection multi-step form
├── components/
│   ├── TyrePositionCard.tsx     — Per-tyre data entry card
│   └── SyncBanner.tsx           — Offline/sync status banner
├── contexts/
│   ├── AuthContext.tsx          — Supabase auth state
│   └── LanguageContext.tsx      — i18n + RTL
├── lib/
│   ├── supabase.ts              — Supabase client (expo-secure-store adapter)
│   └── offlineQueue.ts          — AsyncStorage inspection queue
├── locales/
│   ├── en.json                  — English strings
│   ├── ar.json                  — Arabic strings (MSA, RTL)
│   └── ur.json                  — Urdu strings (RTL)
├── app.json                     — Expo config + EAS project ID
├── eas.json                     — EAS build profiles (dev/preview/production)
└── package.json                 — Dependencies
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

**`mobile/eas.json`** — Supabase env vars baked into all profiles:
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

**GitHub Actions** — `.github/workflows/build-android.yml`
- Triggers on push to `main` (paths: `mobile/**`) or `workflow_dispatch`
- Uses `EXPO_TOKEN` secret (already added to repo)
- Runs `eas build --platform android --profile preview --non-interactive`
- APK available at expo.dev after successful build

---

### Build Troubleshooting History

The EAS Gradle build has been failing. All fixes applied in order:

| # | Commit | Fix | Root Cause |
|---|--------|-----|-----------|
| 1 | `4e92755` | `expo-build-properties` added to package.json | Was in app.json plugins but missing from dependencies — broke `expo config` |
| 2 | `6b79a34` | Kotlin → `2.0.21` (was `1.9.25`) | RN 0.79.2 requires Kotlin 2.0.x |
| 3 | `4ddcf1a` | TypeScript fix in LanguageContext | `reduce` return type + expo-updates missing locally |
| 4 | `1f3a46e` | Replace `@react-native-community/netinfo` with `expo-network`; add SDK 35 config | netinfo's `build.gradle` uses old `compileOptions` incompatible with AGP 8.x; compileSdkVersion/targetSdkVersion/buildToolsVersion needed |
| 5 | `ea24776` | `"newArchEnabled": false`; `ndkVersion: "27.1.12297006"` | RN 0.79 defaults New Architecture ON — requires NDK 27 C++ compilation that fails silently on EAS workers |

| 6 | (Session 3) | Pin `expo` to `~53.0.0`; align whole native tree to SDK 53; add explicit `expo-asset`; `npm ci` in CI | **Real root cause** — `expo` was on SDK 54 while everything else was SDK 53 (binary mismatch). Fixes #1–5 were symptom-patches. |

**Current status:** ✅ **Resolved.** Full EAS Android build is green end-to-end and auto-builds on push to `main`. The New-Arch/NDK/Kotlin tweaks (#2,#5) remain as valid SDK 53 defaults.

---

### Supabase Tables Used by Mobile

| Table | Usage |
|-------|-------|
| `auth.users` | Login / sign out via `supabase.auth.signInWithPassword` |
| `profiles` | `id`, `username`, `full_name`, `employee_id`, `role`, `site`, `country`, `approved` |
| `vehicle_fleet` | Site/vehicle pickers + scanner lookup — columns `asset_no`, `site`, `vehicle_type`, `make`, `model` |
| `inspections` | Write inspection records — `title`, `site`, **`asset_no`**, `vehicle_type`, **`inspector`** (text), **`created_by`** (uuid), `inspection_date`, **`scheduled_date`** (NOT NULL), `inspection_type` ('Routine'), `tyre_conditions` JSONB, `notes`, `status` ('Done'). No `odometer` column — folded into `notes`. |
| `tyre_records` | Scanner tyre lookup by serial — `serial_no`/`serial_number`/`tyre_serial`, `brand`, `size`, `position`, `asset_no`, `tread_depth`, `pressure_reading` |
| RPC `get_email_by_identifier` | Resolves username / Employee ID → email pre-auth (SECURITY DEFINER, anon-executable) |

**RLS note:** Mobile uses the anon key. The `inspections` INSERT policy allows roles `Reporter, Manager, Admin, Director, Tyre Man, Inspector` (the inspector role was added in Session 3). `vehicle_fleet`, `tyre_records`, and `profiles` SELECT are open to any authenticated user.

---

## Previous Session — Web Platform Detail

### 1. Multi-Identifier Login
- Login accepts Email, Username, or Employee ID
- `AuthContext.signIn()` resolves username/employee_id → email via `profiles` table + `get_user_email_by_id` RPC

### 2. RBAC
- Intelligence (40+ pages) — Admin only
- Analytics (7 pages) — Admin + Manager + Director
- `shouldShowGroup()` in `Layout.jsx` hides nav group; `<RoleRoute>` guards routes

### 3. 30-Minute Session Timeout
- 30-min idle timeout, 30-s check interval
- Touch events tracked (`touchstart`)

### 4. Admin Approval Gate
- New signups: `approved: false`
- `ProtectedRoute` blocks unapproved profiles

### 5–9. Checklist, Vehicle Diagram, PageHeader, Build Fixes
See ROADMAP.md for full status.

---

## Required Supabase SQL (Run Once)

> **Note (Session 3):** The live `inspections` schema uses `asset_no`, `inspector` (text), `created_by` (uuid), `scheduled_date` (NOT NULL) and check constraints on `status` / `inspection_type` — the mobile app and web Checklist write to these. Username login uses the `get_email_by_identifier` RPC. Session-3 also added: views `vehicles`/`tyre_changes`, the `alerts` table, performance indexes, and the inspector INSERT policy (already applied to the live DB). The block below is the original Session-1/2 reference.


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
1. ✅ EAS build green (SDK 53) — install the latest `main` APK from expo.dev (`@ws123na/tyrepulse-inspector` → Builds)
2. Device test — login, inspection submit, scanner, offline sync (all wired to live schema)

### Mobile (Next Sprint)
3. Photo uploads to Supabase Storage from inspection (currently captured as local URIs)
4. ✅ ~~Barcode/QR scanner~~ — delivered (`app/(app)/scanner.tsx`)
5. Push notifications for sync failures and inspection reminders
6. Play Store submission prep (signing keys, store listing, screenshots)

### Web (Next Sprint)
8. RAG document ingestion — SOP/policy PDF upload pipeline
9. AI cost monitor — token usage dashboard
10. Scheduled reports — monthly email of executive PDF

---

*TyrePulse v6.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
