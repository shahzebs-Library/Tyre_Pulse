# FCM push failures - diagnosis (read-only, 2026-11-28)

Project jhssdmeruxtrlqnwfksc. Only SELECTs were run. No secret value was read or printed.

## What fails
- `push_delivery_receipts` (all time): Expo accepted 4,684; FCM accepted 980; FCM failed `THIRD_PARTY_AUTH_ERROR` 956; FCM `UNREGISTERED` 2.
- `workflow_notifications` last 7 days: 572 rows, all marked `delivered`; 214 of them carry a `THIRD_PARTY_AUTH_ERROR` inside `result`; 11 carry a Resend 429. So "delivered" does not mean delivered (fixed by P0b).

## Which devices
All 15 FCM devices in `user_devices` say platform `android`. None is iOS, so this is **not** an APNs-key problem.

Per token over the last 14 days the split is clean:

| App version reported | Devices | Accepted | THIRD_PARTY_AUTH_ERROR | device_id sent |
|---|---|---|---|---|
| 0.1.1 / 0.1.2 / 999.0.0 (Flutter app, `com.shahzebrahman.tyrepulse`) | 10 | 389 | 0 | yes |
| 1.0.0 | 5 | 0 | 370 | no |

Every token registered by a "1.0.0" build fails and every Flutter token succeeds, using the same
`FIREBASE_SERVICE_ACCOUNT` in the same call. So the service account and project are correct
for the Flutter app. The "1.0.0" tokens were minted by a different app or Firebase sender
(the build sends no device_id and reports 1.0.0, which no current Flutter or Expo build does).
The most likely source is an early or side-loaded native/test build registered under another
Firebase project or another Android app id, e.g. the native Kotlin app
`com.shahzebrahman.tyrepulse.native` (`tyre_pulse_app/`), which has no google-services.json in the
repo and is not registered in Firebase project `tyrepulse-32127`.

## Config checked
- `tyre_pulse_flutter/android/app/google-services.json`: project `tyrepulse-32127`
  (number 131829592510), apps `com.shahzebrahman.tyrepulse` and `com.shahzebrahman.tyrepulseinspector`.
- `mobile/google-services.json` (Expo): same project.
- workflow-notify reads secret `FIREBASE_SERVICE_ACCOUNT` (name only). Flutter tokens succeed with it,
  so it belongs to `tyrepulse-32127`.

## Second finding
`user_devices.fail_count` is 0 on all 15 FCM rows despite 956 auth failures. The repo function
counts these and revokes after 5; the deployed function evidently does not (older deploy). Once
the current workflow-notify is deployed the five "1.0.0" devices revoke themselves after 5 more
failures and stop inflating the error count.

## What the owner must do
1. Nothing in Firebase for the Flutter app: it works. Do **not** paste a new service account.
2. Ask the five affected users (or check who owns the five 1.0.0 devices in Console -> Sessions &
   Devices) to install the Play Closed-testing Flutter build and sign in once. The new token replaces
   the bad one.
3. Optional clean-up: revoke the five `app_version = '1.0.0'` devices in Console -> Sessions & Devices.
4. Redeploy `workflow-notify` (it carries the fail-count + P0b fixes) when you approve.
5. iOS later: when the iOS Flutter app ships, upload an APNs auth key (.p8) in Firebase ->
   Project settings -> Cloud Messaging -> Apple app configuration. Not needed today (0 iOS devices).
