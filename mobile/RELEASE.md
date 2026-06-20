# Release Guide — TyrePulse Inspector (Android, Google Play Internal Testing)

Distribution model: **Google Play Internal Testing + EAS Update (OTA)**.
Build & upload to Play **once**; ship most future changes over-the-air.

- App package: `com.shahzebrahman.tyrepulseinspector`
- EAS project: `3ed4e62f-e91f-4c78-b1eb-9b7310c08255`
- OTA branch: `production` (runtimeVersion policy: `appVersion`)

---

## One-time setup

1. **Google Play Console** ($25 once) → create the app with the package above.
2. **Service account key** (Play Console → Setup → API access): create a service
   account with *Release* permission, download the JSON, save as
   `mobile/google-service-account.json`. **Never commit it** (it's a secret;
   keep it git-ignored).
3. `npm i -g eas-cli && eas login`

---

## First release to Internal Testing (one command)

From `mobile/`:

```bash
npm run release:android      # builds the .aab and auto-submits to Play (internal track)
```

(or run the two steps separately: `npm run build:android:production` then `npm run submit:android`.)

Then in Play Console → **Testing → Internal testing**: add testers and share the
opt-in link. Testers install once from Google Play.

---

## Day-to-day updates — NO Play upload needed

For JS / UI / logic / styling changes (the vast majority):

```bash
npm run update              # eas update --branch production
```

Installed apps fetch it on next launch. That's the auto-update.

### When you DO need a new build + submit
Only for **native** changes:
- new permission, new native module, Expo SDK upgrade, or
- a `version` bump in `app.json` (e.g. 1.1.0 → 1.2.0).

Then:
```bash
# bump "version" in app.json for native changes (versionCode auto-increments)
npm run release:android
```

---

## Notes
- `eas.json` → `submit.production.android.track` is already `internal`.
- `versionCode` auto-increments on each production build (`autoIncrement: true`).
- Free-plan EAS build quota: if `eas build` reports you're out of builds, wait
  for the monthly reset, upgrade the plan, or build locally with
  `eas build --local` (requires Android SDK).
- Promote to a wider audience later by moving the release from the **Internal
  testing** track to **Closed/Open testing** or **Production** in Play Console.
