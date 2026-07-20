# Google Play — Data Safety answers (TyrePulse Inspector)

Copy these into **Play Console → App content → Data safety**. Answers are based
on what the app actually does (auth, GPS-tagged inspections, photos, push
notifications, Sentry crash reporting). No ads SDK, no third-party analytics.

> Contact and hosted URLs are filled in below. Reviewer sign-in credentials are
> NOT stored in this file; supply them via Play Console "App access" (see section 4).

---

## 1. Overview answers

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS to Supabase, Sentry, Expo) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — via request (see Privacy Policy "Data deletion"). Accounts are created/removed by the fleet administrator; users can also email `info@tyrepulse.app`. |

**Data collection is required** to use the app (it is an internal, account-based
fleet tool — there is no anonymous/guest mode).

---

## 2. Data types — declare COLLECTED (not "shared")

"Shared" in Play = transferred to a third party for *their own* use. TyrePulse
only sends data to **service providers/processors** (Supabase = backend,
Sentry = crash reporting, Expo/Google FCM = push delivery) acting on your
behalf, so mark each type **Collected = Yes**, **Shared = No**, unless your
legal team decides otherwise.

For every item below: **Processed ephemerally? No. Users can request deletion? Yes.**

### Personal info
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Name | Yes | App functionality, Account management | Required |
| Email address | Yes | App functionality, Account management | Required |
| User IDs (username, employee ID, account ID) | Yes | App functionality, Account management | Required |

*(No phone number is collected by the app. Sign-in is invite-only with no
registration form, and no screen captures or uploads a phone number. The team
directory may display an administrator-entered teammate phone number for
tap-to-call, but the app does not itself capture, create, or transmit phone
numbers, so this is not "collection" under Play's definition. Address, race,
political views, and other personal info are not collected.)*

### Location
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Precise location | Yes | App functionality (geo-tag the site where a tyre inspection was performed) | **Optional** — the inspection still saves if location is unavailable/denied |

*(Approximate location: not collected.)*

### Photos and videos
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Photos | Yes | App functionality (tyre / accident / odometer-gauge photos, drawn signatures) | Required for flows that mandate a photo (e.g. accident report); otherwise optional |

### App activity
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Other user-generated content (inspection records, checklists, accident reports, meter/stock entries, notes, signatures) | Yes | App functionality | Required |

### App info and performance
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Crash logs | Yes | App functionality, Analytics (Sentry crash reporting) | Required |
| Diagnostics (performance) | Yes | App functionality, Analytics (Sentry) | Required |

### Device or other IDs
| Data type | Collected | Purpose | Optional/Required |
|---|---|---|---|
| Device or other IDs (push notification token; Sentry install/device identifier) | Yes | App functionality (deliver push notifications), Analytics (crash attribution) | Required |

### NOT collected (leave unchecked)
Financial info · Health & fitness · Messages · Audio files · Music · Calendar ·
Contacts · Web browsing history · Files & docs (other than the photos above) ·
Search history · Installed apps · Ads / marketing IDs (no advertising).

---

## 3. Security practices (Data safety → Security section)
- **Data is encrypted in transit:** Yes (TLS 1.2+).
- **Users can request data deletion:** Yes — admin-managed + `info@tyrepulse.app`.
- **Committed to Play Families Policy:** No (not a children's app; workforce tool, 18+).
- **Independent security review:** optional — leave unless you have one.

---

## 4. App access (App content → "App access")
This app **requires sign-in**. It is **invite-only**: there is no public sign-up,
and accounts are created for users by the fleet administrator. Google's review
team needs working credentials:

- **All or some functionality is restricted:** choose "All functionality is restricted."
- **Reviewer login:** `<provided separately to Google review via Play Console "App access", NOT stored in source>`
  - Provide a low-privilege Inspector account (username or employee ID + password)
    directly in the Play Console "App access" fields.
  - Instructions: "Enter the username and password on the login screen. The Home
    screen exposes New Inspection, Scan Asset, Checklists, Meter Log, Tyre
    Records and Accident reporting."

> Reviewer credentials are supplied through Play Console "App access" only. They are
> rotated periodically and are never committed to source control.

---

## 5. Content rating & category (related, while you're in there)
- **Category:** Business (or Productivity).
- **Target audience:** 18+ (workforce tool). Do not target children.
- **Ads:** Contains ads = **No**.
- Complete the **Content rating** questionnaire (no violence/sexual/gambling → likely "Everyone"/PEGI 3, but answer truthfully).

---

## 6. Privacy policy & data-deletion URLs (required)
Hosted via GitHub Pages from `/docs` on `main`. Enable once:
**Settings → Pages → Deploy from a branch → `main` / `/docs`**. Then:
- Privacy Policy: `https://shahzebs-library.github.io/tyre_pulse/privacy.html`
- Account & Data Deletion: `https://shahzebs-library.github.io/tyre_pulse/delete-account.html`

Paste the privacy URL into **Store settings → Privacy Policy** and the Data
safety form; put the deletion URL in Data safety's "data deletion" field. Both
must be reachable without login.
