# TyrePulse Inspector - React Native Mobile App

Tyre Man workflow: Login → Inspect → Submit → Sync.
Same Supabase backend as the web app.

## Setup (one time)

```bash
# 1. Install Node deps
cd mobile
npm install

# 2. Create .env (copy from example, paste your Supabase values)
cp .env.example .env
# Edit .env and fill in:
#   EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 3. Install EAS CLI (cloud build - no Android Studio needed)
npm install -g eas-cli

# 4. Log in to Expo
eas login
```

## Build Android APK (no Android Studio needed)

```bash
# Preview APK - downloads a .apk you can install directly
eas build --platform android --profile preview

# Production AAB - for Play Store upload
eas build --platform android --profile production
```

EAS builds in the cloud (~8-12 min). You get a download link when done.

## Run locally (needs Android device/emulator)

```bash
npx expo start
# Press 'a' for Android emulator, scan QR with Expo Go app on device
```

## Features

- Login: email / username / employee ID (same as web app)
- Home: daily count, pending sync badge, recent inspections
- New Inspection: site picker → vehicle picker → tyre positions (pressure, tread, condition, photo)
- Offline: inspections queued to device when no internet, auto-syncs on reconnect
- History: all submitted inspections with sync status
- Profile: user info, manual sync, sign out

## Assets

Branded placeholders are committed in `assets/` so the build works out of the box. Replace before Play Store submission:
- `assets/icon.png` - 1024×1024px app icon
- `assets/splash.png` - 1284×2778px splash screen
- `assets/adaptive-icon.png` - 1024×1024px Android adaptive icon foreground
