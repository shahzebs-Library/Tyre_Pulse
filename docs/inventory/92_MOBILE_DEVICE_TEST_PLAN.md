# 92 - Mobile device test plan (Flutter, inventory release)

App: Flutter field app `tyre_pulse_flutter/` (package `com.shahzebrahman.tyrepulse`).
Branch: `claude/inventory-upgrade-7rxp2t`, after the reserved-file patch was applied
(owner authorisation 2026-11-20).

**Device run status: NOT TESTED.** No Android SDK and no device are available to the agent that
prepared this plan, and the standing owner rule is no mobile build unless the owner asks. Every case
below is therefore marked Not Tested. A person runs it on a real phone from a build the owner orders.

## What changed and must be proven on a phone

* Deep links `/stock/counts`, `/stock/counts/<audit uuid>`, `/stock/transfers`, guarded by the
  `stock` module.
* Background delivery of blind count lines: command `INVENTORY_COUNT_LINE` ->
  `inv_count_submit(p_payload {audit_id, device_id, lines})`. Photos are uploaded first (object
  path `tyre-photos/inventory_count/<audit>/<client_uuid>/<file>`, upserted), then the line. A
  duplicate answer counts as done; a refusal is kept with the server's reason and is never sent
  again.
* `STOCK_ADJUST` retired: an old queued row is failed with "This offline stock change was made
  before counts were audited and was not sent. Count the item again." and never reaches the server.
* The manual Send button stays as "send now"; the note under the lines no longer says background
  sending is a later update.

## Internal test build (2026-11-21)

Not a Play release. Built by `.github/workflows/flutter-internal-apk.yml` (workflow_dispatch only, no Play
upload step), signed with the same release key as the Play Closed testing build.

| Field | Value |
|---|---|
| Workflow run | 44875779894 (https://github.com/shahzebs-Library/Tyre_Pulse/actions/runs/44875779894) |
| Artifact | `tyre-pulse-internal-apk` (ID 14696240812), https://github.com/shahzebs-Library/Tyre_Pulse/actions/runs/44875779894/artifacts/14696240812 |
| Artifact expires | 2026-12-05 (14-day retention); re-run the workflow on main for a fresh one |
| File | `tyre-pulse-internal-0.1.1-7.apk`, universal release APK, 191.2 MB (zip 126 MB) |
| Version | versionName 0.1.1, versionCode 7 (pubspec `0.1.1+7`), `APP_ENV=production`, Flutter 3.47.2 |
| App code | identical to main `8ef9ca4` (the branch only pinned the workflow's Flutter version) |
| Crash reporting | OFF in this build: the `FLUTTER_SENTRY_DSN` secret is not set |

How to install:
1. Download the artifact from the link above while signed in to GitHub, then unzip it.
2. Phone: Settings > Apps > Special access > Install unknown apps > allow the browser or file manager
   you will open the APK with. Or from a computer, with USB debugging on: `adb install -r tyre-pulse-internal-0.1.1-7.apk`.
3. Because it carries the same package (`com.shahzebrahman.tyrepulse`) and the same signing key as the Play
   Closed testing build, it installs over that build. To test the D19 upgrade case, install the previous
   Play build first, then this APK on top. Uninstall first only if you want a clean-install run (D01).
4. Sign in ONLY with dedicated test accounts (P2: the Store Keeper test account and the account without
   `stock`). Never use a live employee account: this build points at the PRODUCTION Supabase project, so
   every count, transfer and photo it sends is real data.

Every case below stays Not Tested until someone runs it on a phone from this build and records evidence.

## Preconditions

| # | Precondition |
|---|---|
| P1 | A release or debug build of this branch installed on (a) one mid-range Android phone and (b) one low-memory phone (2 GB RAM class, Android 13+). |
| P2 | A Store Keeper test account in the test company, with the `stock` module enabled and a KSA scope. A second account WITHOUT the `stock` module. |
| P3 | On the web: one inventory audit in `in_progress`, assigned to the Store Keeper, with at least two locations; one serial-tracked tyre item and one quantity item in scope. One open stock transfer between two locations the Store Keeper can see. |
| P4 | Access to the web audit screen (or SQL read) to confirm what the server received: `inventory_count_lines` rows, their `photos`, `counted_at`, `round`. |
| P5 | Location and item labels printed, plus one label for an item NOT in a location's list (for the unexpected-item case). |
| P6 | Airplane mode can be switched on and off. Developer options available to force "Don't keep activities" for the memory case. |

## Test cases

Result column: Pass / Fail / Not Tested. Fill "Evidence" with a screenshot name or the server row id.

| ID | Case | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| D01 | Sign in as Store Keeper | Fresh install. Sign in with the Store Keeper account. Open Stock. | Sign-in succeeds. Stock shows the entry points for counts and transfers. No raw key or English placeholder in Arabic/Urdu. | Not Tested | |
| D02 | Route guard: no stock module | Sign in with the account without `stock`. Open the deep link `/stock/counts`. | "You do not have access to this module" state. No audit list, no spinner, no crash. Same for `/stock/transfers` and `/stock/counts/<uuid>`. | Not Tested | |
| D03 | Deep link with a bad audit id | As Store Keeper open `/stock/counts/not-a-uuid`. | The audit list opens (never a count screen for a bogus id). | Not Tested | |
| D04 | Blind count online | Open the assigned audit. Scan a location, scan the quantity item, enter 3, Save. Tap Send. | "1 lines sent." The line shows Sent. The server has one row with `counted_qty = 3`, `round = 1`. No expected quantity was ever shown on the phone. | Not Tested | |
| D05 | Blind count offline, then reconnect | Airplane mode ON. Count two more lines (one with a photo, one without). Tap Send. | Snack: "No connection. 2 counted lines will be sent automatically when the connection returns." Lines stay On phone. Nothing is lost if the app is closed now. | Not Tested | |
| D06 | Background sync | After D05, close the app fully (swipe away). Airplane mode OFF. Wait up to 2 minutes (connectivity one-off task), or at most 15 minutes (periodic task). | Without opening the app, both lines reach the server: the photo object exists under `inventory_count/<audit>/<line uuid>/` and the line's `photos` holds its `tp-storage://` reference. `counted_at` is the counting time, not the reconnect time. | Not Tested | |
| D07 | Manual Send after background sync | Reopen the app on the audit from D06. Tap Send. | Lines move to Sent (server answers duplicates). No second row on the server for either line. | Not Tested | |
| D08 | Send pressed twice offline | Airplane mode ON. Count one line. Tap Send twice. Airplane mode OFF and wait for D06's sync. | No crash on the second tap. Exactly one server row for that line. | Not Tested | |
| D09 | Photo upload fails mid-way | Count a line with two photos offline, Send. Turn the network on, then off again after a few seconds (before both uploads finish); later turn it on for good. | The line is never stored on the server without both photos. Once stable, both photos and the line arrive; at most one object per photo. | Not Tested | |
| D10 | Refusal is not retried | On the web, close or cancel the audit. On the phone, offline, count one more line and Send; then reconnect. | The line is refused with the server's reason (e.g. audit not open). It is not sent again on later syncs (server logs show one call for that line). The draft still holds it, marked Not accepted. | Not Tested | |
| D11 | Finish counting | With every line sent, tap Finish counting and confirm. | Audit moves to Counting completed. With unsent lines, Finish is refused with the unsent-lines message. Offline, Finish says it needs a connection. | Not Tested | |
| D12 | Recount | On the web, raise a recount (round 2) for one location. On the phone, refresh the audit and recount that location. | The phone counts round 2; the new line arrives with `round = 2`; round 1 lines are untouched. | Not Tested | |
| D13 | Duplicate scans | In a serial-tracked count, scan the same tyre serial twice. Scan a location label while not in the audit. | Second serial scan: "That serial is already counted in this audit." No second line. Out-of-scope location: "That location is not part of this audit." | Not Tested | |
| D14 | Unexpected item | Scan an item that is not in the location's list and count it. | Line is marked Unexpected item, sent with `unexpected = true`. | Not Tested | |
| D15 | Transfer dispatch | Open `/stock/transfers`, Dispatch: scan FROM, scan TO, scan two items, quantities, confirm. | A transfer is created with status Dispatched; stock leaves FROM. Retrying the confirm after a network blip creates no second transfer. | Not Tested | |
| D16 | Transfer receive | As the receiving Store Keeper, open the dispatched transfer, receive one line in full and one partially, add a condition. | Status Partly received; received quantities and condition stored; the remaining quantity stays open. | Not Tested | |
| D17 | Arabic RTL | Switch app language to Arabic. Repeat D04, D05 and D15 briefly. | Layout mirrored, back arrow points the right way, numbers readable, the new strings (queued note, manual send note) are Arabic, no overflow or clipped text. Repeat a quick check in Urdu. | Not Tested | |
| D18 | Low-memory photo capture | On the 2 GB phone with "Don't keep activities" ON, count a line and take three photos in a row, then Send offline and reconnect. | No crash or blank screen when returning from the camera; draft and photos survive; all three photos upload in the background. | Not Tested | |
| D19 | STOCK_ADJUST migration on an old queue | Install the PREVIOUS Play build. Offline, change a stock quantity in Stock Count (+/-) so a STOCK_ADJUST is queued. Without reconnecting, install this build over it. Reconnect. | The old row never reaches the server (stock quantity unchanged on the web). The sync failures list shows "This offline stock change was made before counts were audited and was not sent. Count the item again." The app does not crash on the old row. | Not Tested | |
| D20 | Offline +/- in this build | In this build, offline, try a Stock Count +/-. | The phone reports the change could not be saved offline (it no longer queues STOCK_ADJUST). | Not Tested | |
| D21 | Sign-out with queued lines | Queue a count line offline, sign out, sign in as a different user, reconnect. | The other user's session does not send the first user's line; signing back in as the Store Keeper sends it. | Not Tested | |

## Exit criteria

* D01-D11, D15, D16, D19 Pass on the mid-range phone; D17 and D18 Pass on their target device.
* Any Fail on D06, D09, D10 or D19 blocks release: those are the data-integrity cases.
