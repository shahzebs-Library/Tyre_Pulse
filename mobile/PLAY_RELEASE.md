# Google Play Internal Testing - Auto Updates

Distribute the inspector app to your team with **automatic Play Store updates**:
upload once, then every release CI builds + submits a new AAB and testers update
automatically. No APK sharing, no manual installs.

## How releases work (after one-time setup)
1. Push a tag `mobile-v1.x.x` (or run **Actions → Release to Google Play (Internal) → Run workflow**).
2. CI builds a production **AAB** on EAS (versionCode auto-increments) and submits it
   to the Play **internal testing** track.
3. Testers get the update automatically from the Play Store.

---

## One-time setup (requires your Google + Expo accounts)

### 1. Expo token (for CI)
- expo.dev → Account → **Access tokens** → create one.
- GitHub repo → Settings → Secrets and variables → Actions → add secret **`EXPO_TOKEN`**.

### 2. Google Play Console
- Create a Play Console account ($25 one-time) and **create the app**
  (package name **`com.shahzebrahman.tyrepulseinspector`**).
- Complete the required declarations (content rating, data safety, privacy policy, etc.).
- **Testing → Internal testing**: create the track, add tester emails (or a Google Group),
  and copy the **opt-in link** to share with your team.

### 3. First AAB upload
- The very first build usually must be uploaded **manually** once so the app
  "exists" on the track:
  - Run the **Release to Google Play (Internal)** workflow (with no service-account
    secret yet it just builds), download the `.aab` from the EAS build page, and
    upload it under Internal testing → Create new release.

### 4. Service account (enables automatic submits)
- Google Cloud Console (project linked to Play) → enable **Google Play Android Developer API**.
- Create a **service account** + **JSON key**.
- Play Console → **Users and permissions** → invite the service account email →
  grant **Release to testing tracks** (and **Admin (all permissions)** is simplest for setup).
- GitHub → add secret **`GOOGLE_SERVICE_ACCOUNT_KEY`** = the full JSON key contents.

### 5. Done
- From now on, every tag push / workflow run builds **and** submits automatically →
  testers auto-update. Bump the user-facing version in `app.json` (`expo.version`)
  when you want a new version name; the Android `versionCode` is auto-incremented by EAS.

## Notes
- `eas.json` → `submit.production.android.track = "internal"`. Change to `production`
  later for a public release.
- `google-service-account.json` is git-ignored; it only ever exists in CI from the secret.
- For instant JS-only fixes without a store update, EAS Update (OTA) can be added later
  as a complement - but store builds are still required for native changes.
