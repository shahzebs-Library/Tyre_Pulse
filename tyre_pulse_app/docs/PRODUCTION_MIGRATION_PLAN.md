# Production Migration Plan

This document outlines the strategy for replacing the existing Tyre Pulse Android application with the new native client.

## 1. Application Identity
- **Package ID**: The production app must use the original package name (to be confirmed, currently using `com.example.tyre_pulse_app` for development).
- **Signing**: The new APK/AAB must be signed with the existing production Keystore to allow an over-the-air update.

## 2. Versioning
- The new application's `versionCode` must be higher than the current production version.
- `versionName` should follow semantic versioning (e.g., 2.0.0).

## 3. Data Migration
- **Local Persistence**: Since the new app uses a new Room structure, existing local data (if any) will not be automatically migrated. Users should ensure all inspections are submitted before updating.
- **Authentication**: Existing sessions will be cleared. Users will need to log in again with their credentials.

## 4. Rollout Strategy
1. **Internal Testing**: Distribute to internal Tyremen and Supervisors via Firebase App Distribution.
2. **Staged Rollout**: Release to 5% -> 20% -> 50% -> 100% via Google Play Console.
3. **Monitoring**: Closely monitor Sentry/Crashlytics for any regression or unexpected device-specific issues.

## 5. Rollback Plan
- If a critical failure is detected during the 5% rollout, the update will be halted.
- The previous version (if available) can be re-released if a fix cannot be deployed within 4 hours.
