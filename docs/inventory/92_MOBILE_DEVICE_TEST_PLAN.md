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
3. Signing: this APK is signed with the UPLOAD key (SHA-256 `1B:31:EE:57:...:E5:3E`). If Play App Signing is
   on for `com.shahzebrahman.tyrepulse` (Play Console > Test and release > App integrity; it is mandatory for
   apps created since 2021), phones that installed from Play carry Google's app-signing key, and this APK will
   NOT install over them (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). In that case either install the release
   through Play Closed testing, or uninstall first (this deletes the offline queue). For D19 (upgrade over an
   old queue) install a self-built previous APK (`0.1.1+7` from run 44875779894) first, then this one on top.
4. Sign in ONLY with dedicated test accounts (P2: the Store Keeper test account and the account without
   `stock`). Never use a live employee account: this build points at the PRODUCTION Supabase project, so
   every count, transfer and photo it sends is real data.

Every case below stays Not Tested until someone runs it on a phone from this build and records evidence.

## Release candidate build 0.1.2+8 (AAB, not uploaded)

Built by `.github/workflows/flutter-release-play.yml` with `upload_to_play=false` (owner decision 2026-11-21:
no Play upload until physical-device acceptance below passes). The AAB is a GitHub Actions artifact only.
Build details (run, commit, artifact link, signing fingerprint) are in the PR that introduced this section.
Play's last uploaded build is `0.1.1+7` (run 40346435257); `+8` is above it. Note: that Play build was made by
the old workflow, which overwrote the committed `MainActivity`, so it shipped WITHOUT biometric unlock and
the `alerts` push channel. `0.1.2+8` keeps the committed `MainActivity` (CI-guarded).

## Test accounts and data isolation

**No test receipt, issue, count or transfer may be made against real stock.** The app points at the
production Supabase project. All acceptance data lives in the separate company **Tyre Pulse Demo Fleet**
(organisation `a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7`). Never test with a Default Organisation account
(`testuser123` and every staff account are the REAL company).

### Fixture (applied on production 2026-11-21 16:42 UTC)

Scripts in `supabase/fixtures/`. Applied by the pg_net fetch + sha256 runner (`_bak.inv_release_run`) from
commit `13bf6ca2` (`demo_fleet_inventory_acceptance.sql`, sha256 `67ed50a9...d5de17`). Recovery point
taken first: LSN `1A8/4000060` at 16:42:33 UTC. Every stock write goes through the app's own inventory RPCs
signed in as `demo.manager`, so the company always comes from the session, and a final guard rolls the run
back if the transaction wrote any row outside the Demo company (proved to fire on a planted row).

| What | Value | Used by |
|---|---|---|
| Site | `DEMO YARD` (KSA) | all |
| Locations | `DEMO-WH-A` (Store A), `DEMO-WH-B` (Store B), `DEMO-WH-C` (Store C), `IN-TRANSIT` (auto). Labels `TP:LOC:<id>` (print from the web Locations page) | P5 |
| Quantity items | `DEMO-Q-001` Valve cap, `DEMO-Q-002` Tyre repair patch kit (barcode = item code) | D04-D09, D11, D12, D15 |
| Serial tyre item | `DEMO-T-001` 315/80R22.5 (serial tracked); serials `DEMOST0001`-`DEMOST0004` in custody `new_stock` at `DEMO-WH-A` | D13 |
| Unexpected-item label | `DEMO-X-001` Wheel nut: held only at `DEMO-WH-B`, so scanning it at `DEMO-WH-A` is unexpected | D14 |
| Opening stock (one GRN `DEMO-GRN-R1`) | WH-A: Q-001 17 (20 received, 3 in transit), Q-002 10. WH-B: Q-001 8, Q-002 6, X-001 2. WH-C: Q-002 4 | D04-D12 |
| Open transfer | `TRF-20261121-0BC7C4A7` WH-A -> WH-B, 3 x Q-001, status in transit | D16 (receive 1 full / partial) |
| Audit A | `AUD-20261121-88637EDA`, partial, blind, WH-A + WH-B | D04-D09, D11, D12, D14 |
| Audit B | `AUD-20261121-9A0CE05B`, tyre_serial, WH-A, 4 serials | D13 |
| Audit C | `AUD-20261121-9A0A91F0`, partial, WH-C; cancel it on the web during D10 | D10 |
| demo.manager | Manager; fixture grants stock receive/issue/transfer/count/audit_create/recount (Demo only) | web operator for D10, D12 |

The audits are created in `draft` with `demo.manager` as reviewer. They become `in_progress`, with Store
Keeper A as the blind counter, when the accounts script below runs (a counter is needed to start an audit).

### Test accounts (owner step - no safe way exists to create sign-ins from SQL)

There is no RPC or edge function that creates a sign-in in a chosen company (`org_invite_member` invites
into the caller's own company, and the Demo company has no Admin). So:

1. Supabase dashboard > Authentication > Users > **Add user > Create new user**, tick **Auto Confirm User**,
   for each email below, with a password you choose (keep it out of chat, docs and the repo):
   * `demo.storekeeper.a@users.tyrepulse.app`
   * `demo.storekeeper.b@users.tyrepulse.app`
   * `demo.nostock@users.tyrepulse.app`
   Each lands as a pending (not approved) Reporter in the default company, so it can see nothing yet.
2. Run `supabase/fixtures/demo_fleet_inventory_accounts.sql` (SQL editor, or ask the agent to apply it
   with the runner). It refuses unless all three exist and are fresh pending sign-ups, then:
   moves them to Tyre Pulse Demo Fleet, approves them, country KSA, sites `DEMO YARD` + `DEMO PLANT`;
   adds a Demo-company `Store Keeper` role and its web + phone module rows; grants both Store Keepers
   stock receive/issue/transfer/count; explicitly revokes stock (web and phone) for `demo.nostock`;
   assigns Store Keeper A to audits A/B/C and starts them. Re-running changes nothing.
3. Sign in on the phone with the **username** (`demo.storekeeper.a`, `demo.storekeeper.b`,
   `demo.nostock`). To change a password later use Console > Users > reset (admin flow).

| Username | Role | Stock | Used by |
|---|---|---|---|
| `demo.storekeeper.a` | Store Keeper | receive, issue, transfer, count; counter of audits A, B, C | D01, D03-D15, D17-D21 |
| `demo.storekeeper.b` | Store Keeper | receive, issue, transfer, count | D16 (receiving Store Keeper), D21 (other user) |
| `demo.nostock` | Reporter | none (explicit revoke) | D02 |
| `demo.manager` | Manager | as above | web operator (D10 cancel audit C, D12 recount) |

Rehearsed in a rolled-back transaction on production before applying: Store Keeper A gets
view/count/receive/transfer (not audit_create) on web and phone, sees 0 rows of any other company;
Store Keeper B can receive the open transfer; the no-stock account has no stock access.

### Isolation proof (2026-11-21, after the apply)

* Default Organisation fingerprint (stock_records, stock_movements, material_master, inventory_locations,
  inventory_audits, count lines, transfers, goods receipts, tyre_items, store holdings, tyre_records,
  profiles, user_access_grants) md5 `be21853ec45f4e5d1d7176d2b524c737` before AND after: identical.
* Impersonation, rolled back: `demo.manager` reads only Demo stock (14 rows) and 0 locations, movements,
  audits, items or tyre items of any other company; a real Store Keeper and a real Manager of the Default
  Organisation read 0 Demo stock, locations, movements, audits, items and transfers.
* Re-check any time with `supabase/fixtures/demo_fleet_inventory_verify.sql` (read only).

### Reset / teardown

The stock ledger is append-only, so fixture history is never deleted. `demo_fleet_inventory_teardown.sql`
cancels every open fixture audit, returns any open fixture transfer to its source, removes the fixture
grants and sets the three test sign-ins back to not approved. For a fresh round: run the teardown, change
`c_run` from `r1` to `r2` in both the fixture and the accounts script, apply the fixture, then the accounts
script (new GRN, transfer and audits; locations and items are reused).

## Classification of the 21 cases

| Type | Cases | Status |
|---|---|---|
| Automated (logic covered by `flutter test` in `flutter-ci.yml`, green on main `fd85a466`) | D02, D03 (`inventory_routes*_test`), D07, D08 (`inventory_count_background_sync_test`, `inventory_count_line_sync_test`: duplicate = done, one row), D09 logic (failed photo upload keeps the line queued), D10 logic (refusal stored, never resent), D13, D14 (`count_session_test`), D19, D20 logic (retired `STOCK_ADJUST` failed with the fixed message; `command_registry` test), D21 logic (`sync_engine_test` user scoping) | Pass in CI; still repeat on a phone where a physical row exists below |
| Physical phone only | D01, D04, D05, D06 (OS background task), D09 (real network drop), D11, D17 (RTL rendering), D18 (2 GB phone), D19 (install over old build) | Not Tested |
| Staff participation (web operator or a second Store Keeper) | D10 (close audit on web), D12 (raise recount on web), D15/D16 (dispatching + receiving Store Keeper), P3/P4 setup | Not Tested |

## Physical-phone checklist (run in this order)

1. [ ] Fixture applied (done 2026-11-21). Owner created the three sign-ins and the accounts script ran (audits A/B/C show `in_progress`). Confirm the signed-in user's company is Tyre Pulse Demo Fleet before any count.
2. [ ] Install: Play Closed track, or uninstall then side-load (see Signing note). Record versionName/versionCode from Settings > Apps.
3. [ ] Biometric unlock prompt appears when enabled (proves the committed `MainActivity` is in the build).
4. [ ] D01, D02, D03.
5. [ ] D04, D05, D06 (swipe the app away, wait up to 15 min), D07, D08.
6. [ ] D09 (toggle network mid-upload), D10 with the web operator.
7. [ ] D11, D12 with the web operator.
8. [ ] D13, D14.
9. [ ] D15 and D16 with a second Store Keeper (both in Demo Fleet).
10. [ ] D17 in Arabic, quick pass in Urdu.
11. [ ] D18 on the 2 GB phone with "Don't keep activities".
12. [ ] D19 (install `0.1.1+7` APK, queue a STOCK_ADJUST offline, install `0.1.2+8` over it), D20, D21.
13. [ ] Record Pass/Fail + evidence in the table below. Only when the exit criteria pass may the owner order the Play upload (`upload_to_play=true`).

## Preconditions

| # | Precondition |
|---|---|
| P1 | A release or debug build of this branch installed on (a) one mid-range Android phone and (b) one low-memory phone (2 GB RAM class, Android 13+). |
| P2 | A Store Keeper test account in the test company, with the `stock` module enabled and a KSA scope. A second account WITHOUT the `stock` module. Provided: `demo.storekeeper.a` / `demo.nostock` (see Test accounts). |
| P3 | On the web: one inventory audit in `in_progress`, assigned to the Store Keeper, with at least two locations; one serial-tracked tyre item and one quantity item in scope. One open stock transfer between two locations the Store Keeper can see. Provided: audits A/B/C and `TRF-20261121-0BC7C4A7` (see Fixture). |
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
