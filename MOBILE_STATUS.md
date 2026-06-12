# TyrePulse Mobile — Status Audit (June 2026)

## Build Configuration

| Item | Value |
|------|-------|
| Framework | React Native 0.79.6 + Expo SDK 53 |
| Router | expo-router ~5.1.11 (file-based, typed routes) |
| EAS Project ID | 3ed4e62f-e91f-4c78-b1eb-9b7310c08255 |
| Android target SDK | 35, minSDK 24 |
| New Architecture | Disabled (stability) |
| Supabase JS | ^2.45.4 |
| Auth storage | expo-secure-store (hardware-backed) |
| i18n | EN / AR / UR (RTL supported) |

---

## Screens Implemented

### (auth)/
| File | Status | Notes |
|------|--------|-------|
| login.tsx | Done | Email or username/employeeID via `get_email_by_identifier` RPC |
| register.tsx | Done | Self-registration flow |

### (app)/
| File | Status | Notes |
|------|--------|-------|
| index.tsx | Done | Home — greeting, sync badge, quick start, scanner shortcut |
| scanner.tsx | Done | expo-camera CameraView, barcode + QR, torch, rescan |
| history.tsx | Done | Offline + synced inspections, search, status filter badges |
| profile.tsx | Done | Inspector info, language toggle, offline queue stats, sign-out |
| inspection/new.tsx | Done | 2-step form: vehicle details → tyre position cards (all axle types), photo capture, offline submit |
| accident/[id].tsx | Stub | Dynamic route exists; scope not clear |
| accident/dashboard.tsx | Stub | Exists in filesystem; not described in roadmap |
| accident/report.tsx | Stub | Exists in filesystem; not described in roadmap |
| admin/index.tsx | Stub | Admin tab exists |
| admin/ai-chat.tsx | Stub | Wired up but not in roadmap for v1 |
| admin/users.tsx | Stub | User management screen, scope TBD |

### Components
| File | Purpose |
|------|---------|
| TyrePositionCard.tsx | Position form card (FL/FR/RL/RR + dual/triple axle) |
| VehicleTyreDiagram.tsx | SVG tyre diagram |
| AccidentPhotoGrid.tsx | Photo grid for accident module |
| SyncBanner.tsx | Offline sync status banner |

---

## What Is Working

- Auth: session persisted in SecureStore, auto-refresh, username/employeeID login via RPC, role normalisation
- Offline queue: AsyncStorage-backed, enqueue → sync on network return, retry-failed, clear-synced
- i18n: 130+ strings across EN/AR/UR, RTL via I18nManager + Updates.reloadAsync(), parity verified
- Scanner: barcode + QR, vehicle/tyre lookup, torch control
- Inspection: full 2-step flow, all tyre positions, photo capture (local URI), offline-first submit
- History: list with search, sync status badges (synced/pending/failed)
- EAS CI: GitHub Actions auto-build on push to main (preview APK)

---

## What Is Missing / Incomplete

| Gap | Impact |
|-----|--------|
| Photo upload to Supabase Storage | Photos saved as local URI only — lost on reinstall, never synced to server |
| Offline photo queue | No base64/storage-ref queuing; photos cannot be deferred with inspection |
| Accident module | 3 screens exist with no documented scope or working implementation |
| Admin screens (ai-chat, users) | Exist but not integrated with backend or RBAC |
| Push notifications | Not implemented (expo-notifications not in package.json) |
| GPS on inspections | Not implemented (expo-location not in package.json) |
| OTA update URL | expo-updates installed but update URL not configured in app.json |
| network listener | syncQueue is not auto-triggered; no expo-network listener wired in the app layout |
| No SQLite | All offline data in AsyncStorage — no query capability, size limits apply at scale |
| iOS build profile | eas.json has no iOS profile; no Apple Dev Account setup |

---

## Critical Code Issues

1. **No auto-sync trigger** — `offlineQueue.ts` implements `syncQueue()` but nothing in the app layout or any context subscribes to `expo-network` state changes to call it automatically. Sync only happens when the user manually taps "Sync Now" in Profile.

2. **Supabase anon key in eas.json** — key is committed in plaintext across all three build profiles (development, preview, production). Should be moved to EAS environment secrets (`eas secret:create`).

3. **Photos are local-only** — `TyrePositionData.photo_url` field exists in the type but is never populated. `photo_uri` is a local file path that becomes invalid after app reinstall or on a different device.

4. **No RBAC enforcement on screens** — `admin/` routes are accessible without checking `isAdminOrAbove()`. The `_layout.tsx` for `(app)` should gate admin routes against the profile role.

5. **AsyncStorage size limit** — at scale (hundreds of inspections per inspector), AsyncStorage JSON blobs will degrade. SQLite (`expo-sqlite`) should replace AsyncStorage for the queue.

6. **`user: any` in AuthContext** — `user` is typed `any` instead of `User` from `@supabase/supabase-js`, losing type safety across the app.

---

## Roadmap Summary (from Mobile App Roadmap.md)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 | Working APK build | Done (Gradle fix applied) |
| P0 | Photo upload to Supabase Storage | Missing |
| P0 | Device testing | Not confirmed |
| P1 | Barcode/QR scanner | Done (already shipped in v1) |
| P1 | Push notifications | Missing |
| P1 | OTA updates (configure URL) | Missing |
| P1 | Play Store submission | Not started |
| P2 | GPS on inspections | Missing |
| P2 | PDF report on device | Missing |
| P2 | Inspection photo gallery | Missing |
| P2 | Offline photo queue | Missing |
| P3 | AI tyre wear analysis (camera → Anthropic) | Not started |
| P3 | OCR serial number reading | Not started |
| P3 | Voice inspection input | Not started |
| P3 | Driver mobile app (separate bundle) | Not started |
| P3 | iOS build | Not started |

---

## Recommended Next Development Priorities

**1. Photo upload to Supabase Storage + offline photo queue**
Inspections without photos have reduced evidentiary value. Implement base64 photo storage in the offline queue, upload to `inspection-photos` bucket on sync, populate `photo_url` in the payload. This unblocks real-world field use.

**2. Auto-sync on network reconnect**
Wire `expo-network` `addNetworkStateListener` in the root `_layout.tsx` so `syncQueue()` fires automatically when connectivity returns. Currently sync is manual-only — inspectors will forget.

**3. RBAC enforcement on admin routes**
Gate `app/(app)/admin/*` behind `isAdminOrAbove(profile.role)` in `(app)/_layout.tsx`. Without this, any authenticated user can access admin screens.

**4. Replace AsyncStorage queue with expo-sqlite**
Migrate `offlineQueue.ts` to SQLite for queryable, scalable offline storage. Required before fleet-scale deployment where inspectors may accumulate 100+ queued records.

**5. OTA update configuration + Play Store submission**
Configure `expo-updates` channel URL in `app.json` to enable silent OTA patches without APK redistribution. Then complete Play Store listing (screenshots, privacy policy, feature graphic) and run `eas submit`.

---

*Audited: 2026-06-12*
