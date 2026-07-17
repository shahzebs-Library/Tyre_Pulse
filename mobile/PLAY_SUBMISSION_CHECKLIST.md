# TyrePulse Inspector - Play Store Pre-Submission Checklist

One tickable list tying the CODE state (already done) to the PLAY CONSOLE steps
(you do). Companion docs: `PLAY_DATA_SAFETY.md` (copy-paste Data safety answers),
`PLAY_STORE_SUBMISSION.md` (full runbook), `PRIVACY_POLICY.md`, `PLAY_RELEASE.md`.

Status legend: [x] done in code (this repo) · [ ] action needed by you.

---

## A. Code / app config - DONE (verified `npx tsc --noEmit` = 0 errors)
- [x] Package id `com.shahzebrahman.tyrepulseinspector`, version `1.2.0`, target SDK 35, minSdk 24.
- [x] Permissions minimised: camera, location (when-in-use), notifications, network, boot-completed. **Exact-alarm permissions removed** (only inexact daily reminders) - no exact-alarm declaration form needed.
- [x] Every permission has a plain-English rationale string (camera / photos / location plugin config).
- [x] Crash capture: ErrorBoundary + Sentry global handlers wrap the app; DSN wired via EAS env.
- [x] EAS `production` profile: app-bundle (.aab), `autoIncrement` on (versionCode never collides).
- [x] Real data only (Supabase) - no mock/placeholder data; publishable anon key only (no secrets shipped).
- [x] Crash-safety pass: data loads / RPC / storage / status / delete wrapped with error + Retry states; scanner degrades on camera error.
- [x] Performance: long lists on FlatList with render-window tuning; `__DEV__`-gated logs.
- [x] Access control: role gating + super-admin per-user Access Console (mobile-namespaced grants, separate from web).

## B. Assets you must add locally / as CI secrets (build blockers)
- [ ] `mobile/assets/notification-icon.png` - white, transparent PNG (referenced by the notifications plugin).
- [ ] `mobile/google-services.json` - Firebase (FCM) config for push.
- [ ] `mobile/google-service-account.json` - Play service-account key (enables `eas submit`).
- [ ] Confirm adaptive icon / splash render correctly (already in `assets/`).

## C. Build + upload
- [ ] `cd mobile && npm ci`
- [ ] `eas login` (Expo account) and set `EXPO_TOKEN` for CI if using the release workflow.
- [ ] `npm run build:android:production` (production `.aab`, autoIncrement) - enroll in **Play App Signing** when prompted.
- [ ] Create the app in Play Console; upload the `.aab` to the **Internal testing** track first (not straight to production).
- [ ] `npm run submit:android` (or `release:android` for build+submit) once the service account is set.

## D. Play Console - App content (required before review)
- [ ] **Data safety** - copy from `PLAY_DATA_SAFETY.md`. Summary of what to declare COLLECTED (Shared = No, all encrypted in transit, deletion supported):
  - Personal info: Name, Email, User IDs (account/username/employee id) - Required.
  - Location: **Precise** - **Optional** (inspection still saves if denied).
  - Photos - tyre/accident/gauge photos + signatures.
  - App activity: user-generated records (inspections, checklists, accidents, meter/stock).
  - App info & performance: Crash logs + Diagnostics (Sentry).
  - Device IDs: push token + Sentry install id.
  - NOT collected: financial, health, contacts, messages, browsing, ads/marketing id (no ads SDK).
- [ ] **Privacy policy URL** (must load without login) - host `PRIVACY_POLICY.md` (e.g. GitHub Pages) and paste into Store settings + Data safety.
- [ ] **Account/data deletion URL** - paste into Data safety deletion field.
- [ ] **App access** - choose "All functionality is restricted", provide the demo login (Inspector account) so reviewers can sign in.
- [ ] **Content rating** questionnaire - Business/Productivity, 18+ workforce tool, no ads.
- [ ] **Target audience** - 18+ (do NOT target children).
- [ ] **Ads** - Contains ads = No.
- [ ] **Government / financial / health** declarations - No.

## E. Store listing
- [ ] App name, short + full description, category = Business.
- [ ] Graphics: 512x512 icon, 1024x500 feature graphic, >= 2 phone screenshots (see runbook §5).
- [ ] Contact email + website.

## F. On-device QA (cannot be done in this repo - needs a real build)
Runtime crash/perf/smoothness must be checked on an installed build (an
emulator or a device via `npm run build:android:preview` or the internal track).
Smoke-test each role and the core flows:
- [ ] Sign in (username / employee id / email) + biometric/secure-store persists.
- [ ] New Inspection: tap-a-tyre SVG -> record condition -> photo -> save (online AND airplane-mode -> offline queue -> reconnect syncs).
- [ ] Checklists: tap-to-record tiles -> submit -> approval flow.
- [ ] Scan: QR/barcode -> routes to the right prefilled action; deny camera -> friendly fallback (no crash).
- [ ] Accident report: 3 steps -> photos -> submit -> PDF export/share.
- [ ] Meter log: photo + km/hours -> save.
- [ ] Records / History / Vehicles: long lists scroll smoothly (FlatList), pull-to-refresh, error + Retry on a forced network drop.
- [ ] Access: sign in as director / inspector / tyre_man and confirm the removed modules are hidden; super-admin Access Console grant/revoke updates the target user's tabs on their next refresh.
- [ ] Notifications: permission prompt, a daily reminder fires, tapping opens the app.
- [ ] Kill/relaunch, background/foreground, rotate (portrait-locked), low battery - no crash; Sentry shows no new fatal issues.

## G. First release order
1. Add the B assets/secrets. 2. Build production `.aab`. 3. Internal testing upload +
complete D + E. 4. Invite testers, run the F smoke tests. 5. Promote internal ->
closed/open -> production for review.
