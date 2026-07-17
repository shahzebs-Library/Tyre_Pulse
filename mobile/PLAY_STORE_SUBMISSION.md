# TyrePulse Inspector - Google Play Store Submission Runbook

This is the end-to-end runbook for shipping the Android app to the Google Play
Store. All commands run from the `mobile/` directory. No build or submit command
here has been executed - they require EAS credentials and cost build minutes.

App identity (from `app.json` / `eas.json`):

| Field | Value |
|---|---|
| App name | TyrePulse Inspector |
| Android package | `com.shahzebrahman.tyrepulseinspector` |
| Current `version` (semver) | `1.2.0` |
| Current `versionCode` | `2` (note: `appVersionSource: remote` - EAS manages the authoritative value) |
| EAS project ID | `3ed4e62f-e91f-4c78-b1eb-9b7310c08255` |
| Production build type | `app-bundle` (AAB) ✅ required by Play |
| Submit track | `internal` |

---

## 1. Prerequisites checklist

- [ ] **Google Play Console account** (one-time US$25 registration), with the
      app **created** under package `com.shahzebrahman.tyrepulseinspector`.
- [ ] **Firebase project** for FCM push notifications. Add an **Android app** to
      it with the exact package name above, then download `google-services.json`.
- [ ] **Google Play service account JSON** with **Google Play Android Developer
      API** access:
  1. Google Play Console → *Setup → API access* → link a Google Cloud project.
  2. Create a service account in Google Cloud IAM, grant it the
     *Service Account User* role.
  3. In Play Console → *Users and permissions*, invite the service-account email
     and grant **Release** permissions (Release to production, internal testing,
     manage testing tracks).
  4. Create a JSON key for the service account and download it.
- [ ] **EAS / Expo account** with access to project `tyrepulse-inspector` and an
      `EXPO_TOKEN` for CI.
- [ ] **Android signing keystore** - managed by EAS (`eas credentials`). On the
      first production build EAS generates and stores the upload keystore; do not
      create one manually. Enroll the app in **Play App Signing** when prompted.
- [ ] **Privacy policy URL** published and reachable (required for any app that
      collects personal data - this one does; see §6).

---

## 2. Required local files & where they go

| File | Location | Source | Committed? |
|---|---|---|---|
| `google-services.json` | `mobile/google-services.json` | Firebase Console → Android app | **No - gitignored** |
| `google-service-account.json` | `mobile/google-service-account.json` | Play Console service account key | **No - gitignored** |
| `notification-icon.png` | `mobile/assets/notification-icon.png` | designer (see §2.1) | Yes (asset) |

Both secret JSON files are now in `mobile/.gitignore`. **Never commit them.**
In CI they are injected from GitHub secrets (`GOOGLE_SERVICE_ACCOUNT_KEY`,
and a Firebase secret if you choose to wire one) - see
`.github/workflows/submit-android.yml`.

### 2.1 Missing notification icon (build blocker)

`app.json` declares the `expo-notifications` plugin with
`"icon": "./assets/notification-icon.png"`, but that file does **not exist** in
`mobile/assets/`. The Android notification icon must be a **white, transparent,
single-color PNG** (Android tints it). It is **not** the same as the launcher
icon. Recommended: **96×96 px** (mdpi baseline; Expo scales it), pure white
silhouette on full transparency.

Action: have design export a monochrome variant of the TyrePulse mark to
`mobile/assets/notification-icon.png`. Do not reuse the colored `icon.png` -
Android will render it as a solid white square. Until this file exists, a
production build referencing the plugin will fail asset resolution.

---

## 3. Build & submit commands (require EAS credentials)

```bash
# from mobile/
eas login                                            # authenticate (or set EXPO_TOKEN)

# Production AAB build (Play-ready app bundle, autoIncrement on)
eas build --platform android --profile production

# Submit the latest completed build to the Play internal track
eas submit --platform android --profile production --latest

# One-shot build + submit (defined in package.json as "release:android")
eas build --platform android --profile production --auto-submit
```

OTA JS-only updates (no store review) for the production channel:

```bash
eas update --branch production
```

> These commands consume EAS build minutes and require valid Expo + Play
> credentials. Do not run them as part of prep.

CI alternative (no local credentials): trigger the
**"Submit Android to Google Play (Internal)"** workflow
(`.github/workflows/submit-android.yml`) via *workflow_dispatch*. It writes
`google-service-account.json` from the `GOOGLE_SERVICE_ACCOUNT_KEY` secret and
runs `eas submit ... --latest --non-interactive`.

---

## 4. Store listing metadata template

| Field | Value |
|---|---|
| **App name** (max 30) | TyrePulse Inspector |
| **Short description** (max 80) | `Fleet tyre inspections, wear tracking & cost analytics - right from your phone.` (78 chars) |
| **Category** | Business (alt: Productivity) |
| **Content rating** | Everyone (complete the IARC questionnaire; no objectionable content) |
| **Privacy policy URL** | `https://<YOUR-DOMAIN>/privacy` *(placeholder - must be live before review)* |
| **Contact email** | `<support@yourdomain>` |
| **Website** | `https://tyre-pulse-peach.vercel.app` |

**Full description** (max 4000 chars):

```
TyrePulse Inspector is the field companion for fleet tyre management. Built for
inspectors, workshop technicians, and fleet managers, it turns every tyre check
into structured, auditable data - and turns that data into cost and reliability
intelligence.

KEY FEATURES
• Guided tyre inspections - capture tread depth, pressure, and condition by axle
  position (steer, drive, trailer, lift, tag) with photo evidence.
• On-vehicle scanning - log tyres against vehicles and positions in seconds.
• Photo documentation - attach images of wear patterns, damage, and serials
  directly to each inspection.
• Offline-tolerant capture - record inspections in the yard and sync when back
  online.
• Wear & pressure tracking - monitor tread loss and pressure compliance over time.
• Cost intelligence - surface cost-per-kilometre (CPK), tyre life, and
  replacement forecasts for the fleet.
• Push notifications - get alerted to due inspections and flagged tyres.
• Secure, role-based access - your fleet data stays protected.

WHY TYREPULSE
Tyres are one of the largest controllable costs in any fleet. TyrePulse converts
raw inspection data into root-cause analysis, predictive replacement planning,
and vendor performance comparison - helping you cut cost-per-kilometre, reduce
roadside failures, and extend tyre life.

Part of the TyrePulse fleet intelligence platform. Requires a TyrePulse account.
```

---

## 5. Required graphic assets & dimensions

| Asset | Dimensions | Format | Notes |
|---|---|---|---|
| App icon (store) | **512 × 512** | 32-bit PNG | No alpha rounding needed; Play applies the mask. |
| Feature graphic | **1024 × 500** | PNG/JPG | Shown at top of listing; no critical text near edges. |
| Phone screenshots | **min 2, up to 8** | PNG/JPG | 16:9 or 9:16; 320-3840 px per side. App uses portrait → 9:16. |
| (Optional) 7" / 10" tablet shots | per Play spec | - | App is phone-only (`supportsTablet: false`); skip. |

**Screenshots can be generated automatically.** The repo includes
`.github/workflows/screenshots.yml` ("Take Play Store Screenshots"). Trigger it
via *workflow_dispatch* with an app login email/password. It uses Playwright at a
**1080 × 1920 (9:16 portrait)** viewport against the web build
(`https://tyre-pulse-peach.vercel.app`) to capture login, dashboard, and a
records screen, then uploads them as the `play-store-screenshots` artifact.
Download that artifact and upload the PNGs directly to the Play listing.

---

## 6. Data safety form guidance

Based on the **actual** Android permissions and SDKs declared in `app.json`,
declare the following in Play Console → *App content → Data safety*:

Permissions declared: `CAMERA`, `INTERNET`, `ACCESS_NETWORK_STATE`,
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`,
`USE_EXACT_ALARM`. **No location permission is declared** - do not claim location
collection.

| Data type | Collected? | Purpose | Notes |
|---|---|---|---|
| **Email address / account** | Yes | App functionality, account management | Supabase auth login. |
| **Photos** | Yes | App functionality | Inspection photos via camera / image picker. |
| **App activity / inspection data** | Yes | App functionality, analytics | Tyre readings, vehicle records. |
| **Device / push identifiers** | Yes | App functionality (push) | Expo/FCM push token for notifications. |
| **Precise/approximate location** | **No** | - | No location permission requested. |
| **Financial / contacts / messages** | No | - | Not collected. |

Also declare:
- **Data encrypted in transit:** Yes (HTTPS to Supabase / Expo).
- **Users can request deletion:** Yes - link the account-deletion path / support
  email in the data-safety and account-deletion sections (Play requires an
  account-deletion route for apps with sign-in).
- The **camera** permission is justified by inspection photo capture
  (`expo-camera` + `expo-image-picker`, with in-app permission rationale strings).

---

## 7. Exact-alarm policy — RESOLVED (no declaration needed)

**Done (2026-07-17):** `SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` have been
**removed** from `app.json`. The app schedules only **inexact** reminders
(`expo-notifications` `SchedulableTriggerInputTypes.DAILY`), so the restricted
exact-alarm permissions are unnecessary. This is the lower-risk path: you do NOT
need to complete the Play Console *Exact alarm permission declaration* form, and
you avoid that common rejection cause entirely.

Do NOT re-add those permissions unless a future feature needs precisely-timed,
Doze-exempt alarms (in which case you must submit the declaration with a
justification).

`RECEIVE_BOOT_COMPLETED` (re-arming daily reminders after reboot) and
`POST_NOTIFICATIONS` are standard for notification apps and do not require a
declaration form. Location (`ACCESS_FINE_LOCATION`) is used only foreground /
when-in-use to geo-tag an inspection and degrades gracefully if denied —
declare it under Data safety (§6) but no separate permission form is required.

---

## 8. Versioning

- `eas.json` sets `cli.appVersionSource: "remote"`, so **EAS owns the
  authoritative `versionCode`**; the `2` in `app.json` is informational.
- Production and preview profiles set **`autoIncrement: true`** → EAS bumps
  `versionCode` by 1 on every build automatically. No manual edit needed per
  submission.
- Bump the human-facing **`version`** (`app.json` → `expo.version`, currently
  `1.2.0`) manually using semver when shipping a meaningful release.
  `package.json` version is now aligned to `1.2.0` (done 2026-07-17).
- Play rejects an upload whose `versionCode` is ≤ a previously uploaded one;
  `autoIncrement` prevents this.

---

## 9. First-submission order of operations

1. Add `mobile/google-services.json` (Firebase) and
   `mobile/google-service-account.json` (Play SA key) locally / as CI secrets.
2. Add `mobile/assets/notification-icon.png` (white transparent PNG).
3. Exact-alarm decision is already resolved (§7 - permissions removed, no form).
4. `eas build --platform android --profile production` → enroll in Play App
   Signing when prompted.
5. In Play Console: create the internal-testing release, complete store listing
   (§4), upload graphics (§5), complete Data safety (§6) and exact-alarm
   declaration (§7), set content rating.
6. `eas submit --platform android --profile production --latest` (or run the
   CI submit workflow).
7. Promote internal → closed/open testing → production once validated.
