# TyrePulse Mobile - Architecture & Roadmap
**React Native 0.79.6 + Expo SDK 53 · Shahzeb Rahman © 2026**
**Last updated:** June 2026 · **EAS Android build: ✅ green (auto-builds on push to `main`)**

---

## Architecture Decision: Why React Native + Expo

After evaluating Capacitor, React Native, Flutter, and Native Android Kotlin, **React Native + Expo (managed workflow)** was chosen for TyrePulse Inspector.

### Comparison Matrix

| Criterion | Capacitor | React Native + Expo | Flutter | Native Kotlin |
|-----------|-----------|---------------------|---------|---------------|
| Code reuse from web | ✅ High (same React) | ✅ High (same TS/logic) | ❌ None | ❌ None |
| Camera + photo | 🔄 WebView camera | ✅ Native expo-camera | ✅ Native | ✅ Native |
| Offline reliability | ⚠️ WebView storage limits | ✅ SQLite / AsyncStorage | ✅ SQLite | ✅ SQLite |
| Build without local toolchain | ❌ Need Android Studio | ✅ EAS cloud build | ✅ Shorebird | ❌ Need Android Studio |
| RTL (Arabic/Urdu) | ⚠️ CSS only | ✅ I18nManager native | ✅ Native | ✅ Native |
| Development speed | Medium | High | Medium | Low |
| New hire onboarding | React devs only | React devs | Dart only | Kotlin only |
| Long-term maintenance | Medium | High | Medium | High |
| Play Store path | Easy | Easy (EAS Submit) | Medium | Medium |

**Decision:** React Native + Expo wins on development speed, build tooling (EAS), shared codebase knowledge, and Supabase SDK compatibility.

---

## Current App State

### Delivered (v1.0)

```
TyrePulse Inspector
├── Authentication
│   ├── Supabase JWT (expo-secure-store)
│   ├── Language selector (EN / AR / UR) on login
│   └── Profile auto-loaded on sign-in
│
├── Home Screen
│   ├── Time-aware greeting
│   ├── Pending sync count badge
│   ├── Quick-start inspection button
│   └── Scan Tyre / Asset (camera barcode + QR)
│
├── Scanner (expo-camera CameraView)
│   ├── Reads tyre serial barcodes + asset QR codes
│   ├── Vehicle match → start inspection (site + asset preselected)
│   ├── Tyre match → brand / size / position / asset details
│   └── Torch, permission states, rescan
│
├── New Inspection
│   ├── Step 1: Vehicle details (site, asset, date, odometer→notes, notes)
│   ├── Step 2: Tyre position cards
│   │   ├── Supports all position types (FL/FR/RL/RR + dual + triple axle)
│   │   ├── Serial number, pressure (bar), tread depth (mm)
│   │   ├── Condition: Good / Worn / Damaged / Flat / Missing
│   │   └── Photo capture (expo-camera + expo-image-picker)
│   └── Submit (asset_no/inspector/created_by/scheduled_date/status='Done') → offline queue → Supabase sync
│
├── History
│   ├── All inspections (offline + synced) - search + status filters
│   └── Sync status badges (synced / pending / failed)
│
└── Profile
    ├── Inspector details (name, employee ID, site, country)
    ├── Language toggle (EN / AR / UR with RTL restart)
    ├── Offline queue stats + sync now
    └── Sign out
```

### i18n Coverage

All 130+ strings translated into English, Arabic (MSA), and Urdu across:
- `common`, `login`, `tabs`, `home`, `inspection`, `history`, `profile`, `tyre`, `sync`, `language`, `positions`, `scanner`
- Parity verified: 0 missing/extra keys across en/ar/ur; all `t()` keys resolve.

Tyre positions show both code and translated label:
- `FL` - `أمامي أيسر` (AR) / `آگے بائیں` (UR)

---

## Technical Architecture

### Offline-First Data Flow

```
Inspector creates inspection
         │
         ▼
offlineQueue.addToQueue(payload)
         │
         ▼
AsyncStorage (tp_inspection_queue_v1)
  {
    id: uuid,
    payload: { title, site, asset_number, tyre_conditions, ... },
    sync_status: 'pending',
    retry_count: 0,
    created_at: ISO timestamp
  }
         │
    Network returns online
         │
         ▼
addNetworkStateListener (expo-network) fires
         │
         ▼
syncQueue()
  ├─ for each pending item → supabase.from('inspections').insert(payload)
  │     ├─ success → sync_status = 'synced'
  │     └─ failure → sync_status = 'failed', retry_count++
  └─ retryFailed() → reset failed items to pending
         │
         ▼
History screen shows updated sync badges
```

### Authentication Flow

```
Login screen
  └─ supabase.auth.signInWithPassword({ email, password })
        └─ session stored in expo-secure-store (encrypted, not AsyncStorage)
        └─ profile fetched: profiles WHERE id = auth.uid()
        └─ AuthContext updates: { session, profile, loading }
        └─ expo-router redirects to /(app)/

App restart
  └─ supabase.auth.getSession() → reads from SecureStore
  └─ if valid → go to app; if expired → go to login
```

### Language / RTL Flow

```
User selects Arabic or Urdu
  └─ Alert: "App will restart to apply Arabic"
  └─ AsyncStorage.setItem('tp_language', 'ar')
  └─ I18nManager.forceRTL(true)
  └─ Updates.reloadAsync()  ← full JS bundle reload

App restarts
  └─ LanguageProvider reads tp_language from AsyncStorage
  └─ Loads ar.json translations
  └─ isRTL = true → all text alignment and flex direction flips
  └─ React Native mirror-flips all flex layouts automatically
```

---

## EAS Build Pipeline

### How It Works

```
git push origin main (mobile/** files changed)
         │
         ▼
GitHub Actions: .github/workflows/build-android.yml
  1. Checkout + Node 22
  2. npm install --legacy-peer-deps
  3. expo-github-action (eas-version: latest)
  4. eas build --platform android --profile preview --non-interactive
         │
         ▼
EAS Cloud Build (expo.dev)
  1. npm install
  2. Generate native Android project (expo prebuild)
  3. Gradle build → APK
         │
         ▼
APK available at expo.dev/accounts/ws123na/projects/tyrepulse-inspector
```

### Key Build Config

**`app.json` - critical settings:**
```json
{
  "newArchEnabled": false,
  "plugins": [
    ["expo-build-properties", {
      "android": {
        "kotlinVersion": "2.0.21",
        "compileSdkVersion": 35,
        "targetSdkVersion": 35,
        "buildToolsVersion": "35.0.0",
        "minSdkVersion": 24,
        "ndkVersion": "27.1.12297006"
      }
    }]
  ]
}
```

Why each setting:
- `newArchEnabled: false` - RN 0.79's New Architecture needs NDK C++ compilation that fails on EAS workers silently
- `kotlinVersion: "2.0.21"` - RN 0.79.2 requires Kotlin 2.0.x (1.9.x fails)
- `compileSdkVersion/targetSdkVersion: 35` - required by RN 0.79.2
- `ndkVersion: "27.1.12297006"` - exact NDK required by RN 0.79's `ReactAndroid/gradle.properties`

---

## Play Store Submission Path

When EAS build succeeds:

### Step 1 - Test APK
1. Download APK from expo.dev
2. Install on Android device (Enable "Unknown sources")
3. Test all flows: login → inspection → offline → sync → history

### Step 2 - Play Store Account
1. Create Google Play Developer Account (one-time $25 fee)
2. Go to `play.google.com/console`
3. Create new app: "TyrePulse Inspector"
4. App category: Business / Productivity

### Step 3 - Production Build
Switch `eas.json` production profile from `apk` to `aab` (Android App Bundle - required by Play Store):
```json
"production": {
  "android": { "buildType": "app-bundle" }
}
```

Run: `eas build --platform android --profile production`

### Step 4 - Signing
EAS manages signing keys automatically. For Play Store:
- EAS generates and stores the keystore on expo.dev
- Use "Google Play signing" for maximum security

### Step 5 - Store Listing
Required:
- App icon (512×512 PNG) - already in `mobile/assets/icon.png`
- Feature graphic (1024×500 PNG) - create
- Screenshots (minimum 2, phone size)
- Short description (80 chars)
- Full description
- Privacy policy URL

### Step 6 - Submit
```bash
eas submit --platform android --latest
```
Or upload AAB manually via Play Console.

---

## Next Features (Prioritised)

### P0 - Required for v1.0 Launch
| Feature | Effort | Notes |
|---------|--------|-------|
| Working APK build | S | Gradle fix in progress |
| Photo upload to Supabase Storage | M | `supabase.storage.from('inspection-photos').upload()` |
| Device testing on Samsung M10 | S | Login → inspection → sync |

### P1 - v1.1
| Feature | Effort | Notes |
|---------|--------|-------|
| Barcode/QR scanner (tyre serial) | M | `expo-barcode-scanner` or `expo-camera` built-in |
| Push notifications | M | `expo-notifications` + Supabase realtime triggers |
| OTA updates | S | `expo-updates` already installed - configure update URL |
| Play Store listing + submission | M | Need screenshots, policy URL |

### P2 - v1.2
| Feature | Effort | Notes |
|---------|--------|-------|
| GPS location on inspections | M | `expo-location` |
| PDF report generation on device | L | `expo-print` or `react-native-pdf-lib` |
| Inspection photo gallery (view previous) | M | Supabase Storage + FlatList |
| Offline photo queue | L | Store base64 in AsyncStorage until sync |

### P3 - v2.0
| Feature | Effort | Notes |
|---------|--------|-------|
| AI tyre wear analysis | L | Camera → Anthropic vision API |
| OCR serial number reading | L | Camera → Anthropic vision API |
| Voice inspection input | L | `expo-speech` + transcription |
| Driver mobile app (separate bundle) | XL | Different role/flow |
| iOS build | S | Add iOS profile to eas.json + Apple Dev Account |

---

## Known Issues & Workarounds

| Issue | Status | Workaround |
|-------|--------|-----------|
| EAS Gradle build failing with "unknown error" | 🔄 Fixing | `newArchEnabled: false` + NDK pin applied in ea24776 |
| `@react-native-community/netinfo` AGP incompatibility | ✅ Fixed | Replaced with `expo-network` |
| `expo-updates` missing from local node_modules | ✅ Fixed | Added to package.json, now installed |
| React peer dep conflict (React 18 lockfile vs React 19) | ✅ Fixed | Deleted old package-lock.json |
| Kotlin 1.9.25 incompatible with RN 0.79.2 | ✅ Fixed | Upgraded to 2.0.21 |

---

## Environment Variables

The anon key and Supabase URL are baked into `eas.json` build profiles - no `.env` file needed for EAS builds.

For local development with Expo Go or dev client, create `mobile/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=https://jhssdmeruxtrlqnwfksc.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

*TyrePulse Mobile v1.0 · Shahzeb Rahman © 2026*
