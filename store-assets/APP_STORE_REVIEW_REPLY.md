# Tyre Pulse (iOS) - Reply to App Review, Guideline 2.1 Information Needed

Prepared 2026-11-15 from the code in `tyre_pulse_flutter/` and read-only counts on the live database.
App: **Tyre Pulse**. iOS bundle id: **com.shahzebrahman.tyrepulseinspector** (this is what the Xcode project
and the release workflow use. It is NOT `com.shahzebrahman.tyrepulse`, which is the Android package).

How to use this file:
1. Do the "Fix before you reply" list (Part A).
2. Record the video with the shot list (Part B).
3. Paste the reply (Part C) into App Store Connect, Resolution Center, and attach the video.
4. Put the demo sign-in into App Store Connect, App Review Information (Part D).

Never type the demo password into this file, an email or a chat. It goes only into App Store Connect.

---

## Part A. Fix before you reply (owner checklist)

### Must do (review will fail or stall without these)

- [ ] **Test the demo account on a real iPhone.** Account `demo.manager` exists, is approved, not locked,
      role Manager, country KSA, all sites, company "Tyre Pulse Demo Fleet", no 2-step code needed.
      It last signed in 18 days ago. Sign in once yourself to be sure the password you give Apple works.
- [ ] **Enter the demo username and password in App Store Connect** (App Review Information, "Sign-in required").
- [ ] **Add checklists to the demo company.** The demo company has 0 checklist forms (all 9 published forms
      belong to the real customer company). The Checklists screen will be empty for the reviewer.
      Publish at least 1 or 2 forms in the demo company, or leave Checklists out of the video and the reply.
- [ ] **Add a little more demo data.** Today the demo company has: 4 vehicles (2 transit mixers, 1 pump,
      1 pickup), 18 fitted tyres, 3 inspections, 2 accidents, 3 work orders, 2 sites. It has 0 stock items,
      0 maintenance plans, 0 meter readings, 0 wash records, 0 corrective actions. Enough to review the main
      flow, thin for Stock, Maintenance and Tasks. Add a few rows or do not show those screens.
- [ ] **Remove other companies' logos from the app pictures (Guideline 5.2, intellectual property).**
      Checked and confirmed: `assets/vehicle_photos/concrete_pump_red_fleet.jpeg` shows the SANY logo and name,
      `skid_loader_fleet.jpeg` shows the CAT logo, `mitsubishi_double_cab_front.jpeg` shows the Mitsubishi badge.
      File names also name Tata, Toyota Hiace, Ashok Leyland, Snowkey. These look like manufacturer catalogue
      photos. Replace them with your own photos or logo-free pictures before the next build, or be ready to
      show permission. Not all files were opened, so check every picture in `assets/vehicle_photos`,
      `assets/vehicle_multiview`, `assets/vehicle_multiview_views` and `assets/login`.
- [ ] **Decide what to do with open sign-up.** The app has a "Create an account" screen (reached from the
      sign-in help). Registration is switched ON today. A new sign-up becomes a pending account inside the
      real customer company and cannot sign in until an admin approves it. A reviewer may try it and get stuck.
      Either keep it and explain it (the reply below does), or switch `registration_open` off in
      Console, System Configuration, so the screen shows "Accounts are created by your administrator".
      If you switch it off, edit point 1 and point 3 of the reply to match.

### Should do (known weak points in the current build)

- [ ] **Forced update button opens Google Play.** If you ever set `flutter_min_version`, the "Update required"
      screen opens the Google Play listing, also on iPhone. Apple rejects apps that point to another store.
      It is not set today, so the reviewer will not see it. Do not set it until the iOS link is fixed.
- [ ] **Push notifications.** The app has the push entitlement (`aps-environment` production) and background
      mode. Push only works if the `GOOGLE_SERVICE_INFO_PLIST` secret was present when the build was made and
      an APNs key is uploaded in Firebase. This could not be checked from here. Push not working does not
      fail review, but do not promise push in the reply unless you have seen one arrive on an iPhone.
- [ ] **Crash reporting.** Sentry is only on if the `FLUTTER_SENTRY_DSN` secret was set at build time. Could
      not be checked from here. The reply says "if enabled" on purpose.
- [ ] **Privacy manifest.** There is no `ios/Runner/PrivacyInfo.xcprivacy` file for the app itself. The
      plugins ship their own, so this normally passes, but if Apple sends an email about "missing API
      declaration" this is the fix.
- [ ] **Privacy labels in App Store Connect** must match: name, user id, email, photos, precise location
      (only when filing an inspection), crash data. No tracking, no ads.
- [ ] **Wording on the sign-in screen.** It says "Authorized PMV personnel only" and "Need access? Contact
      your administrator". This tells Apple the app is for one group of companies (see Guideline 3.2 in Part E).
- [ ] **Version.** `pubspec.yaml` says 0.1.1 but the iOS workflow builds with the version you type
      (default 1.0.0). Make sure it equals the version on the App Store Connect page.

### Already fine (checked)

- App icon is the real Tyre Pulse icon (green tyre with pulse line), not the default Flutter icon.
- App name on the phone is "Tyre Pulse".
- `ITSAppUsesNonExemptEncryption` is set to NO (only standard HTTPS), so no export paperwork.
- Permission texts exist for Camera, Photo Library, Location (when in use) and Face ID.
  There is no microphone, contacts, tracking or background location use.
- The build is made with APP_ENV = production.
- No in-app purchase, no StoreKit, no RevenueCat, no ads, no analytics SDK in `pubspec.yaml`.
- Account deletion request is inside the app (Profile).
- No "Sign in with Google/Facebook" in the app, so "Sign in with Apple" is not required.
- iPhone and iPad are both supported (Apple will also open it on an iPad).
- Screenshots in `store-assets/app_store/real/` are real app screens. Use those. The framed ones with big
  marketing headlines are riskier because Apple wants screenshots that show the app in use.

---

## Part B. Screen recording (you must record this, it cannot be made for you)

Rules from Apple: a real iPhone (not a simulator), latest iOS, start from the app icon, show sign-in,
show the main features, show account deletion.

How to record: Settings, Control Centre, add "Screen Recording". Swipe down, press record, do the steps,
stop. Keep it 2 to 3 minutes. Turn on Do Not Disturb first. Use the demo account only, so no real company
data is on screen. Allow camera and location when asked (the reviewer wants to see those prompts).

| # | Time | What to do on the phone |
|---|------|-------------------------|
| 1 | 0:00 | Home screen of the iPhone. Tap the Tyre Pulse icon. App opens on the sign-in screen. |
| 2 | 0:10 | Tap the language switch once (English, Arabic, Urdu) and switch back to English. |
| 3 | 0:20 | Open the sign-in help and show "Create an account". Open it, show the form (username, employee ID, password) and the text that an administrator approves the account. Go back. Do not submit. |
| 4 | 0:35 | Type the demo username and password. Tap Sign in. Home screen appears. |
| 5 | 0:45 | On Home, slowly show: New inspection button, Accident card, Today's work. |
| 6 | 0:55 | Open the vehicle list. Search one demo vehicle. Open it and show its page (details, tyres, timeline). |
| 7 | 1:10 | Go back. Open Scan. Allow Camera when asked. Show the camera scanner, then use manual entry to type a demo asset code. |
| 8 | 1:25 | Tap New inspection. Pick a transit mixer. Allow Location when asked. On the tyre diagram tap one wheel, set condition and pressure, tap the camera and take one photo of anything. Go to review, sign with your finger, submit. Show the success message. |
| 9 | 2:00 | (Only if you added demo checklists.) Open Checklists, open one form, tick two items, go back. |
| 10 | 2:10 | Open Accidents. Show the list with the 2 demo cases. Open one. Then open "Report an accident" and show the first step. Go back without saving. |
| 11 | 2:25 | Open Profile. Show name, role, site, language and theme. |
| 12 | 2:35 | Scroll down in Profile. Tap "Delete my account". Show the text. Type DELETE. **Stop here and tap Cancel.** Say in the reply that the button was not pressed so the demo account stays usable. |
| 13 | 2:50 | Tap Sign out. Sign-in screen appears. Stop recording. |

Important for step 12: if you press "Submit deletion request" a real request is recorded for the demo
account. That is safe (nothing is deleted on the phone), but then tell your admin to ignore that request.

---

## Part C. The reply (paste into Resolution Center)

Hello App Review team,

Thank you for your message. Here is the information you asked for. A screen recording from a physical
iPhone on the latest iOS is attached.

**1. Screen recording**

The attached video starts from the app icon and shows: sign in with the demo account, the home screen,
vehicle search and QR/barcode scan, a new tyre inspection with a photo and a signature, the accident
list and the accident report form, the profile, and the account deletion request.

Account registration: the sign-in help has "Create an account". A person enters a username, an employee
ID and a password. The account is then pending. It cannot sign in until an administrator of the company
approves it and sets the role and site. Most accounts are created by the company administrator.

Account deletion: Profile, "Delete my account". The user types DELETE and submits. This records a
deletion request with our administrators. Access is removed and personal profile data is deleted within
about 30 days. Some fleet records made for the employer (for example an inspection of a company vehicle)
may be kept as business records without the personal profile. The same request can be made on the web at
https://app.tyrepulse.app/data-deletion. In the video we open this screen and cancel at the last step so
the demo account stays usable for you.

The app has no public user-generated content. Users cannot see or contact people outside their own
company. The app has no paid content, no subscriptions, no in-app purchases and no ads.

**2. Purpose and audience**

Tyre Pulse is a work tool for companies that run vehicle and equipment fleets (for example concrete,
construction and transport fleets). Field staff use it to inspect tyres on a vehicle diagram, take
photos, record pressure and condition, fill checklists, log meter readings, report accidents and follow
maintenance tasks. It works offline and syncs later. Problem solved: tyre and vehicle checks are no
longer on paper, and managers see problems the same day.

Users are adult employees: tyre technicians, inspectors, drivers, workshop staff, supervisors and fleet
managers. It is a business app. It is not for children and not for the general public.

**3. How to access and review the app**

- Open the app. On the sign-in screen enter the demo username and password given in App Review
  Information in App Store Connect.
- No 2-step code, no VPN, no special hardware and no other setup is needed. Internet is needed to sign in.
- The demo account is a Manager in a demo company named "Tyre Pulse Demo Fleet" with sample data only:
  4 vehicles, 18 tyres, 3 inspections, 2 accident cases, 3 work orders, 2 sites.
- You can: search or scan a vehicle (type the asset code if you have no QR code), start "New inspection",
  pick a vehicle, tap a wheel, add a reading and a photo, sign and submit; open Accidents and file a report;
  open Profile to change language, see the account and request account deletion.
- Camera, Photos and Location permissions are optional. An inspection can be saved without location.
- Face ID is optional and only used to confirm the user on the sign-in screen.

**4. External services**

- Supabase: sign in, database and file storage for the app data and photos. All traffic uses HTTPS.
- Firebase Cloud Messaging with Apple Push Notification service: work notifications (for example a task
  assigned or an approval needed).
- Sentry: crash and error reports, if enabled in this build. No advertising or tracking.
- AI: tyre photos taken in an inspection may be checked on our server by an AI model (Anthropic Claude,
  with Google Gemini as a fallback) to flag tyre damage for the company's reviewers. A text AI assistant
  exists for company administrators only and is not available to the demo account. No AI runs on the device.
- On the device: the camera reads QR codes and barcodes locally; location is read only when the app is
  open, to tag an inspection.
- There is no payment processor, no social login and no third-party analytics or ads SDK.

**5. Regional differences**

The app works the same in all regions. It is available in English, Arabic (right to left) and Urdu.
The only difference is the data: each account sees only its own company, and inside the company only
the country and sites the administrator assigned. The sign-in picture can differ by country.

**6. Regulated industry and third-party material**

The app is not in a highly regulated industry. It does not give medical, financial, legal, gambling or
insurance services. Accident screens only record internal company cases. Vehicle and tyre data shown in
the app belongs to the customer company. [EDIT THIS LINE AFTER PART A: either "All pictures in the app
are our own" once the manufacturer photos are replaced, or name the pictures you have permission for.]

Please tell us if you need anything else. Thank you.

---

## Part D. App Review Information (App Store Connect fields)

- Sign-in required: Yes
- Username: `demo.manager`
- Password: `<enter in App Store Connect>`
- Contact: your name, phone, email (your own, typed there only)
- Notes (paste):

  > Business app for fleet staff. Sign in with the demo account above. No 2-step code. The demo company
  > "Tyre Pulse Demo Fleet" has sample vehicles, tyres, inspections and accident cases. Main flow: Home,
  > New inspection, pick a vehicle, tap a wheel, add reading and photo, sign, submit. Account deletion
  > request: Profile, Delete my account. New accounts need approval by a company administrator, so please
  > use the demo account. No in-app purchases.

Keep the demo account approved and unlocked, and do not change its password, until the app is approved.

---

## Part E. Apple's "common issues" list, honest answers

**Guideline 3.2 (app for specific businesses). This is the biggest risk.**
The public App Store is for apps anyone can use. Tyre Pulse needs a company account, and the sign-in
screen says "Authorized PMV personnel only". Apple may say it must not be on the public store. Options:

1. **Public App Store (current path).** Works only if Apple accepts that any fleet company can become a
   customer. Helps: the demo account, the "Create an account" request, a public website where a company
   can ask to join, and softer wording on the sign-in screen. Risk: can still be refused under 3.2.
2. **Unlisted App Distribution.** The app is on the App Store but not in search. Staff install it from a
   link. Same review, same build. You ask Apple for it with a short form. Good fit for "many customer
   companies, staff get a link".
3. **Apple Business Manager custom app.** Private to named companies. Each customer needs an Apple
   Business Manager account. Most paperwork, good only for a few large customers.

Recommendation: reply now on the public path with the text above. If Apple answers with Guideline 3.2,
do not argue, request **Unlisted App Distribution**. It needs no code change and suits this app best.

**Other points**

| Apple point | Status |
|---|---|
| Demo account in App Store Connect | Account exists and is approved. You must enter and test the password. |
| Screenshots show the app in use | Use the real ones in `store-assets/app_store/real/`. |
| Account deletion in the app | Present (request, done by an admin in about 30 days). Apple usually accepts a request flow when the wait is stated, which the screen does. If they push back, the next step is automatic deletion. |
| In-app purchase | None. Company billing is handled outside the app and is not shown in the app. |
| Sign in with Apple | Not needed, the app only has its own company sign-in. |
| Links to other stores | Only on the forced update screen, which is off today. Keep it off on iOS. |
| Third-party logos in pictures | Present (SANY, CAT, Mitsubishi seen). Fix before the next build. |
| Permission texts | Present for camera, photos, location, Face ID. |
| Export compliance | Answered in the app (no non-exempt encryption). |
