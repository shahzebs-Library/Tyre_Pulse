# Tyre Pulse (Flutter) - Closed testing checklist

App: **Tyre Pulse**, package **`com.shahzebrahman.tyrepulse`**. This is the Flutter app's OWN listing,
separate from the live Expo app (`com.shahzebrahman.tyrepulseinspector`). Nothing filled in on the Expo
listing carries over - every item below must be completed on THIS app in Play Console.

Play Console -> select **Tyre Pulse (com.shahzebrahman.tyrepulse)** -> left menu. Items marked
**Required** block Closed testing until done.

---

## 1. App content (Policy -> App content) - Required

### 1.1 Privacy policy
- URL: `https://tyrepulse.app/privacy`

### 1.2 App access
- Choose: **All or some functionality is restricted**.
- Add instructions (create a real test account first - do NOT use a personal or admin account):
  - Name: `Reviewer test account`
  - Username: `<create one, e.g. play.reviewer>`
  - Password: `<its password>`
  - Instructions (paste):
    > Tyre Pulse is an internal tool for fleet staff. Sign in on the login screen with the username and
    > password above. The account is an approved Inspector in the KSA region, so it can open inspections,
    > the tyre records, checklists, accidents and the scanner. Accounts are created and approved by the
    > company administrator; there is no public sign-up.
- The account must be **approved and unlocked**, role **Inspector**, country **KSA**, sites **All**
  (set in Console -> Users). Keep it active for the whole review.

### 1.3 Ads
- **No, my app does not contain ads.**

### 1.4 Content rating
- Start questionnaire -> category **Utility, Productivity, Communication or Other**.
- Answer **No** to every violence, sexual, language, drugs, gambling and user-to-user questions.
- "Does the app share the user's current location with other users?" -> **No**.
- Expected result: **Everyone / PEGI 3**.

### 1.5 Target audience and content
- Age groups: **18 and over** only.
- "Could the app unintentionally appeal to children?" -> **No**.

### 1.6 News app -> **No**.
### 1.7 Government app -> **No**.
### 1.8 Financial features -> **My app doesn't provide any financial features**.
### 1.9 Health apps -> **My app doesn't have any health features**.
### 1.10 Advertising ID -> **No** (the app does not use the Android advertising ID).

### 1.11 Data safety - Required
Overview answers:
- Does your app collect or share any of the required user data types? -> **Yes**
- Is all of the user data collected by your app encrypted in transit? -> **Yes**
- Do you provide a way for users to request that their data is deleted? -> **Yes**, URL
  `https://tyrepulse.app/data-deletion`

Data types - tick exactly these:

| Category | Data type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|---|
| Location | **Precise location** | Yes | No | Optional (inspection works without it) | App functionality |
| Personal info | **Name** | Yes | No | Required | App functionality, Account management |
| Personal info | **User IDs** (username, employee id) | Yes | No | Required | App functionality, Account management |
| Personal info | **Email address** | Yes | No | Required | Account management |
| Photos and videos | **Photos** | Yes | No | Optional | App functionality |
| App activity | **Other user-generated content** (inspections, checklists, accident reports, signatures, meter readings) | Yes | No | Required | App functionality |
| App info and performance | **Crash logs** | Yes | Yes (Sentry) | Required | Analytics |
| App info and performance | **Diagnostics** | Yes | Yes (Sentry) | Required | Analytics |

For every row: "processed ephemerally" -> **No**. Do NOT tick: Financial info, Health, Messages,
Audio, Files and docs, Calendar, Contacts, Web browsing, Device or other IDs, Approximate location.

Notes behind these answers (so they can be defended if Google asks):
- Location: `geolocator`, foreground only, attached to an inspection or report. No background location.
- Camera: photos of tyres, gauges and damage (`image_picker`), and live QR/barcode scanning
  (`mobile_scanner`) which is processed on the device and not stored.
- Email: sign-in uses an address minted from the username (`name@users.tyrepulse.app`). It is still
  declared because the account record carries it.
- Crash logs/diagnostics: `sentry_flutter` is in the app. Declared now so turning crash reporting on
  later needs no new declaration.
- No ads SDK, no analytics SDK, no advertising ID, no data sold.

---

## 2. Store listing (Grow -> Store presence -> Main store listing) - Required

- App name: `Tyre Pulse`
- Short description (max 80):
  `Fleet tyre inspections, checklists and accident reports for field teams.`
- Full description (paste):

```
Tyre Pulse is the field app for fleet teams. It turns everyday tyre, inspection
and maintenance work into records your managers can act on.

INSPECTIONS AND FIELD WORK
- Tyre inspections on a real vehicle diagram, with photos, pressure and notes
- Works offline and syncs automatically when you are back online
- QR and barcode asset scanning
- Daily meter and engine-hour logging
- Checklists with sign-off and saved signatures
- Vehicle washing logs

ACCIDENTS AND APPROVALS
- Report an accident step by step with damage marking and photos
- Follow each case through workshop, insurance and release
- Approve or return inspections and checklists with your signature

FOR MANAGERS
- Fleet list and a 360 view of each vehicle with its timeline and costs
- My tasks and today's field plan
- English, Arabic and Urdu

Tyre Pulse is for staff of organisations that use the Tyre Pulse platform.
Accounts are created by your company administrator.

Smarter Wheels. Stronger Fleet.
```

- App icon: `store-assets/play_store_icon_512.png`
- Feature graphic: `store-assets/feature_graphic_1024x500.png`
- Phone screenshots: **at least 2** (recommended 4 to 8), PNG/JPG, 16:9 or 9:16, 320 to 3840 px.
  Take them on a phone running version 4: login, home, tyre inspection, accident report, approvals.
- Category: **Business**
- Contact email: `info@tyrepulse.app`
- Website: `https://tyrepulse.app`

---

## 3. Closed testing track (Test and release -> Testing -> Closed testing)

1. Open the **Alpha** track (a Draft with version 4 already exists).
2. **Testers** tab -> create an email list (e.g. "Tyre Pulse field testers") -> add the testers'
   Google account emails -> Save. Copy the **opt-in link** and send it to them.
3. **Countries/regions** -> add Saudi Arabia, United Arab Emirates, Egypt.
4. Open the Draft release -> release name `0.1.0 (4)` -> release notes:
   ```
   <en-US>
   First closed test of the new Tyre Pulse app: faster inspections, offline sync,
   accident reporting, approvals and Arabic/Urdu support.
   </en-US>
   ```
5. **Review release** -> fix anything it lists -> **Start roll-out to Closed testing**.
6. Google reviews the first closed release. This usually takes 1 to 3 days (sometimes up to 7).

Your developer account already has a production app (the Expo app), so the "12 testers for
14 days" rule for new personal accounts does not block closed testing.

---

## 4. Things that are NOT changed by this

- The live Expo app and its listing stay exactly as they are.
- The GitHub workflow still uploads only to **Internal testing**. To put a newer build on Closed
  testing: run the workflow (after bumping the version), then in Play Console promote that internal
  release to Closed testing. No rebuild needed.
- Next build must use version **0.1.0+5** in `tyre_pulse_flutter/pubspec.yaml`.
