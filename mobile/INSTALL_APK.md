# Installing the APK directly (sideload) — fixing "App not installed"

The Play Store flow ships an **AAB** (`build:android:production`), which **cannot
be installed by tapping it** — Android only installs `.apk` files. To hand a
tester a file they can install directly, build an **APK**.

## 1. Build an installable APK

From `mobile/`:

```bash
# release-signed, production OTA channel (recommended for real installs)
npm run build:android:apk        # eas build -p android --profile production-apk

# or a quick internal test build
npm run build:android:preview
```

Both produce a **standalone, release-signed `.apk`** (not an app-bundle, not a
dev-client). When the build finishes, EAS prints a URL — download the `.apk`
from there (or `eas build:list` → open the build → **Download**). Send that
`.apk` to the device.

> Local build (no EAS quota) needs the Android SDK:
> `eas build -p android --profile production-apk --local`

## 2. Install it on the phone — and why "App not installed" happens

Work through these in order; the **first two fix the vast majority of cases**:

1. **Uninstall any existing "TyrePulse Inspector" first.**
   This is the #1 cause. Android refuses to install an APK over an app that has
   the **same package** (`com.shahzebrahman.tyrepulseinspector`) but was signed
   with a **different key** — e.g. a previous EAS build, a dev-client build, or a
   Play Store copy. Uninstall the old one, then install the new APK.

2. **Make sure it's the `.apk`, not the `.aab`.**
   An `.aab` (from the `production` profile) will always fail to install. Use the
   file from `production-apk` / `preview`.

3. **Allow install from unknown sources** for whatever app opens the file
   (Chrome, Files, Drive): Android **Settings → Apps → Special access → Install
   unknown apps** → enable for that app. On older Android: **Settings → Security
   → Unknown sources**.

4. **Re-download if the transfer was truncated.** A partial/corrupted APK reports
   "App not installed." Prefer a direct download over chat-app compression;
   verify the file size matches the EAS build page.

5. **Don't install an older build over a newer one.** `versionCode`
   auto-increments on every build, and Android blocks downgrades. If you
   reinstall an older APK, uninstall the newer one first (step 1).

6. **Check the device meets the minimum OS.** `minSdkVersion` is **24**
   (Android 7.0). Older devices can't install it.

7. **Enough free storage** on the device.

## 3. Keeping sideloaded testers updated

An APK built on the `production` channel receives **EAS Update (OTA)** JS/UI
changes automatically on next launch (`npm run update`). Only **native** changes
(new permission/module, Expo SDK bump, or an `app.json` `version` bump) require a
new APK build and re-install.
