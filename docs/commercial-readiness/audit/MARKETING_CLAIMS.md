# Marketing claims audit

Date 2026-11-12. Read-only. Source read: the marketing site as merged to `main` by PR #502 (commit `df6f9b58`,
read with `git archive origin/main marketing`; the working branch holds the older site). Paths below are under
`marketing/` unless they start with `src/`. Each claim was checked against code, the live database (SELECT
only) and the other audit files in this folder (COMMERCIAL_FOUNDATION.md, TENANCY_SECURITY.md,
AI_READINESS.md, RELIABILITY_OPERATIONS.md, MODULE_RESTORE_LIST.md).

Verdict words: TRUE TODAY · TRUE ONLY FOR THE CURRENT COMPANY · NOT YET TRUE · UNVERIFIABLE.

## 1. The two verdicts

| Verdict | Result | Why |
|---|---|---|
| Internal (is the site honest about what the current company runs) | MOSTLY READY | The site is careful: sample data is labelled, no certification is claimed, no price is invented, iOS is marked planned, AI wording says the inspector decides. The proof numbers match the database. |
| Commercial (can a new buyer rely on every claim) | NOT READY. 14 claims must change before selling | The site sells a multi-company product ("your company gets its own workspace", plans from "Solo" up) that the application cannot yet deliver, shows "Available" on modules that were disabled in the product today, shows live TPMS and RFID in the product tour with no integration built, marks unmeasured AI as Available, and the in-app privacy page is wrong about third parties. |

Counts by severity: P0 0, P1 7, P2 9, P3 5.

Live facts used (VERIFIED by SQL today): `modules` 122 live and 75 disabled. Disabled keys relevant to the
site: `pm_programs`, `warranty`, `requisitions`, `goods_receipt`, `parts_requests`, `repair_requests`,
`vendor_intelligence`, `tpms`, `retread`, `rotation`, `bay_scheduling`, `customer_portal`,
`driver_documents`, `insurance_claims`, `fuel_efficiency`, `telematics_devices`, `gps_tracking`. Row counts:
vehicle_fleet 1,622 · work_orders 96,944 · parts_consumption 218,776 · tyre_records 11,260 · stock_records 36 ·
purchase_orders 0 · suppliers 0 · requisitions 0 · warranty_claims 0 · pm_programs 0 · tpms_readings 0 ·
rfid_tags 1 · fuel_transactions 0 · api_keys 0 · sso_connections 0 · org_subscriptions 0 · rca_records 1 ·
vehicles with any expiry date 0 · public storage buckets 0 · users with verified MFA 2 · active report
schedules 1 · AI photo expert labels 0.

## 2. Findings that need action

### MKT-1 The site sells a multi-company service the application cannot onboard
- Severity P1. Confidence VERIFIED.
- Claims: "Your company gets its own workspace, and your users sign in to it" (`lib/faqs.ts:39`); "Only users
  in your organisation" (`lib/faqs.ts:28`); "Each company's data is kept separate from every other company's"
  (`app/llms-full.txt/route.ts:80`); "Organizations kept separate" (`app/schema.tsx:63`); four plans from
  "Solo, for an owner managing a small fleet" (`app/pricing/page.tsx:25`).
- Reality: every new sign-up joins the current customer's company and there is no working way to create a
  company with an owner (COMMERCIAL_FOUNDATION.md CF-01, CF-02); three P0 cross-tenant items are open
  (TENANCY_SECURITY.md TEN-1 to TEN-3); `single_tenant_mode` is `true`; 0 subscriptions exist.
- Verdict: NOT YET TRUE. Internal: not affected. Commercial: Class 4.
- Fix: until onboarding exists, say "deployed for your company by our team" and present plans as indicative
  packages. Risk to current company: none (copy only).
- Acceptance test: no page promises a self-contained workspace before CF-01, CF-02 and TEN-1 to TEN-3 close.

### MKT-2 "Available" badges on modules that are disabled in the product
- Severity P1. Confidence VERIFIED.

| Claim | Where | Product state |
|---|---|---|
| "Preventive plans", "Preventive maintenance that follows the meter", "Service plans by engine hours, kilometres or calendar" | `app/page.tsx:35`, `app/platform/page.tsx:44`, `app/platform/maintenance/page.tsx:42-44`, `app/solutions/ready-mix-fleet/page.tsx:29` | Module `pm_programs` disabled today; 0 plans. Code exists (PROJECT_MEMORY V253). |
| "Warranty claims ... tracked from submission to credit" (Available) | `app/platform/tyre-lifecycle/page.tsx:32` | Module `warranty` disabled; 0 claims |
| "purchase requests with approval" (Available) | `app/page.tsx:36`, `app/platform/page.tsx:36,47` | `requisitions`, `goods_receipt`, `parts_requests` disabled; 0 purchase orders, 0 requisitions |
| "supplier details, price history and delivery performance next to every purchase" | `app/platform/inventory/page.tsx:35` | 0 suppliers; `vendor_intelligence` disabled |
| "quotation comparison, purchasing and vendor performance" | `app/schema.tsx:60` (also feeds llms-full) | Same |
| "bay utilization" | `app/schema.tsx:58` | `bay_scheduling` disabled |
| Android app "preventive maintenance schedules" | `app/llms-full.txt/route.ts:70` | `pm_programs` disabled |
| "customer reporting across locations" for workshop networks | `app/llms-full.txt/route.ts:41` | `customer_portal` disabled |

- Verdict: NOT YET TRUE as "Available" (the features are Class 2 or Class 4 in MODULE_RESTORE_LIST.md; they
  were switched off because they hold no data or are unfinished).
- Fix: mark these "On request" or remove until the module is switched on and exercised; keep stock by site
  and issues to job cards (those have data). Risk: none.

### MKT-3 AI photo analysis is badged "Available" with no measured accuracy
- Severity P1. Confidence VERIFIED.
- Claims: "AI-assisted photo analysis: Flags possible tyre defects from inspection photos for your team to
  check" status available (`app/page.tsx:39`); "Photos taken during a tyre inspection are analysed for visible
  defects such as cuts, bulges and uneven wear" (`app/platform/tyre-lifecycle/page.tsx:83-84`); FAQ
  (`lib/faqs.ts:56`); "AI and automation: Concise data-backed findings, root causes and recommended actions"
  (`app/schema.tsx:64`).
- Reality (AI_READINESS.md): 943 photo jobs, 0 expert labels, 3 reviewed, accuracy never measured; only
  photos on wheels the inspector already marked as defective are analysed automatically; the deployed prompt
  is one version behind the repo; the AI budget is one global USD 20 a month for all companies; "root causes"
  from AI are hypothesis lists.
- Verdict: TRUE ONLY FOR THE CURRENT COMPANY as an experiment. The careful wording is good; the badge is not.
- Fix: badge "Experimental" or "On request (pilot)"; add "not a safety check; accuracy not yet measured";
  drop "root causes" from the schema text. Risk: none.

### MKT-4 Live TPMS and RFID are shown working in the product tour
- Severity P1. Confidence VERIFIED.
- Claims: tour panes "Live TPMS catches the leak", "MX-214 live TPMS, via telematics, every wheel", RFID
  passport (`components/motion/walkthrough/tyreIntel.tsx:13,38-39,71-72,169-175`); "get TPMS alerts through
  your telematics" in the page description and lead with no "on request" (`app/solutions/tyre-management/
  page.tsx:12,29,53,64`); llms text (`app/llms.txt/route.ts:32`, `app/llms-full.txt/route.ts:59`).
- Reality: no telematics integration exists in the code base (meter and utilisation data arrived as files);
  `tpms_readings` 0 rows; module `tpms` disabled; `rfid_tags` 1 row. The platform pages do badge both "On
  request" (`app/platform/tyre-lifecycle/page.tsx:39-40`), which is the honest position. PROJECT_MEMORY records
  an owner ruling that TPMS "via telematics" may be promised; that is a sales decision, not a product fact.
- Verdict: NOT YET TRUE. Fix: label the two tour steps "On request, needs your telematics provider" and add
  the qualifier to the solutions page description. Risk: none.

### MKT-5 Telematics presented as an existing data source
- Severity P2. Confidence VERIFIED.
- "Hour and kilometre readings from inspections, job cards and telematics" (`app/platform/fleet-assets/
  page.tsx:46`); "or it arrives from telematics" (`components/motion/walkthrough/cost.tsx:59,115`); "from your
  odometer or telematics readings" (`app/solutions/tyre-management/page.tsx:54`).
- Reality: telematics data has only ever been loaded from exported files by the operator. `gps_tracking` and
  `telematics_devices` are disabled.
- Verdict: TRUE ONLY FOR THE CURRENT COMPANY (as file loads). Fix: "from a telematics export; direct
  connection on request".

### MKT-6 In-app public home says "Field-ready on iOS and Android" and lists disabled modules
- Severity P1. Confidence VERIFIED.
- `src/pages/PublicMarketingHome.jsx:73` "Field-ready on iOS and Android." The marketing site and
  `lib/site.ts:142-143` say iOS is planned and not on the App Store.
- Same file: "requisitions, suppliers and purchases" (`:13`), "driver documents" (`:14`), "fuel ... by asset,
  site and project" (`:15`, 0 fuel rows, no project data), "equipment rental" as a served industry (`:46`,
  the marketing site says configured on request).
- Verdict: NOT YET TRUE. This page is what an unsigned visitor sees at the app host (`src/App.jsx:402`).
- Fix: align with the marketing site's wording, or redirect to it. Risk: none.

### MKT-7 Privacy policy is wrong about third parties
- Severity P1. Confidence VERIFIED.
- `src/pages/Privacy.jsx:62-65`: "The only data shared with a third party is crash and performance
  diagnostics, sent to our error-monitoring provider (Sentry)."
- Reality: inspection photos are sent to Anthropic and on fallback Google; chat and fleet figures to
  Anthropic; knowledge text to OpenAI (AI_READINESS.md AI-7); email content to the email provider; push
  messages through Expo and Firebase; the web app loads PostHog when its key is set. Hosting providers are
  named only as "Supabase".
- Also: "users only see data for their organisation, country and assigned sites" (`:72-73`) is correct for
  the current company with the limits in MKT-9.
- Verdict: NOT YET TRUE. Fix: list sub-processors and what each receives. The marketing security page links
  to this policy (`app/security/page.tsx:68`), so the error is part of the sales material.

### MKT-8 Terms page is visibly a draft
- Severity P2. Confidence VERIFIED.
- `src/pages/Terms.jsx:28` ends with "These terms should be reviewed with your organisation's final
  commercial agreement and applicable law before public launch." No company name, governing law, liability or
  payment terms. Footer of the marketing site links to it (`lib/site.ts:130-134`).
- Verdict: UNVERIFIABLE as terms of service. Fix: real terms from counsel before selling.

### MKT-9 Site-level isolation and "per-user grants for create, edit, approve, export" are stated without limits
- Severity P2. Confidence VERIFIED from earlier audits, not re-probed.
- Claims: "Country and site scope are applied in the database, so a direct request returns nothing outside
  the user's scope" (`lib/faqs.ts:29,45`); "Roles and per-user grants decide which modules a person can open
  and what they can create, edit, approve or export" (`app/security/page.tsx:31`); "restricted by role,
  location, record, field, device and approval authority" (`app/schema.tsx:63`).
- Reality: country isolation is enforced and was proven by impersonation. Site scope exists on reads and
  writes of the scoped tables, but every current user holds all sites, the expense ledger has no site policy,
  and the all-sites path inside several server functions is open (PROJECT_MEMORY V553, V554 note).
  Create, edit and delete grants are database-enforced on 11 tables only; export is an in-app gate.
  Field-level and device-level restriction do not exist.
- Verdict: country TRUE TODAY; site TRUE ONLY FOR THE CURRENT COMPANY and untested in real use; capability
  grants partly true; "record, field, device" NOT YET TRUE.
- Fix: remove "record, field, device"; say "country enforced in the database; site scoping available".

### MKT-10 Approval routing is overstated in structured data
- Severity P2. Confidence VERIFIED.
- "Approvers resolved by company, country, site, department, role, risk and financial authority, with
  delegation and audit history" (`app/schema.tsx:61`); "The right person is assigned by location, role and
  authority" (`app/llms-full.txt/route.ts:51`).
- Reality: approval works by role and area manager for inspections, checklists and accident closure. The
  policy engine has three unpublished draft policies; the role matrix is shared by all companies
  (COMMERCIAL_FOUNDATION.md CF-13). No department, risk or financial authority routing is in use.
- Verdict: NOT YET TRUE as written.

### MKT-11 Pricing page and the plan table disagree
- Severity P2. Confidence VERIFIED (also COMMERCIAL_FOUNDATION.md CF-19).
- Site: Solo, Team, Professional, Enterprise, "no published price" (`app/pricing/page.tsx:24-29`,
  `lib/faqs.ts:21`, `app/llms.txt/route.ts:36`). Database `subscription_plans`: Trial, Starter (USD 49 a
  month), Professional (USD 199), Enterprise, all `is_public` true, shown on the in-app billing page.
- Plan features on the site ("Approvals" from Team, "TV dashboards", "API and automation options" on
  Professional) are not enforced per company (CF-05); payment has never run (CF-06).
- "Included in every plan: Phone app for the field that works offline" (`app/pricing/page.tsx:32`).
- Verdict: plan tiers NOT YET TRUE as a purchasable structure; "quoted on request" TRUE TODAY as a statement
  of how sales works. Fix: one plan vocabulary; hide the in-app public prices or publish them.

### MKT-12 API keys "with rate limits and rotation" badged Available
- Severity P2. Confidence VERIFIED (state), PLAUSIBLE (defects from earlier notes).
- `app/security/page.tsx:45`; "API and automation options" (`app/pricing/page.tsx:27`).
- Reality: 0 keys issued; the public API function has not been redeployed since it was first created;
  PROJECT_MEMORY records two of its endpoints selecting columns that do not exist; "rotation" is revoke and
  create. Never used by any customer.
- Verdict: UNVERIFIABLE. Fix: "On request" until one integration has run end to end.

### MKT-13 Offline claims do not say which app
- Severity P2. Confidence VERIFIED (code notes), NOT VERIFIED (devices).
- "save on the phone and sync when the connection returns" (`lib/faqs.ts:14,54`, `app/page.tsx:33`,
  `app/pricing/page.tsx:32`, `app/solutions/spreadsheets-to-platform/page.tsx:30`).
- Reality: the Play Production app named on the site is the Expo app ("Tyre Pulse Inspector" 1.6.0,
  `app/schema.tsx:21-23`), which queues inspections, photos, meters and washing offline. The Flutter app that
  is replacing it (closed testing) writes local photo paths on sync and its evidence upload is online only
  (PROJECT_MEMORY, held items F-H-01 and F-H-02). Checklists photos had a queue defect that is recorded as
  fixed.
- Verdict: TRUE TODAY for the Expo app; NOT YET TRUE for the Flutter app. Do not move the store link to the
  Flutter app until its offline photo sync is fixed.

### MKT-14 Industry coverage beyond ready-mix is unproven
- Severity P3. Confidence VERIFIED.
- `app/industries/page.tsx:31-36` lists construction fleets, heavy equipment, workshop networks, transport
  and logistics, multi-country operations with no "on request" note; `app/llms.txt/route.ts:19` "is configured
  for construction fleets, heavy equipment, transport and logistics operators, buses and workshop networks".
- Reality: one customer, ready-mix. The page is honest that ready-mix is "In production today" and marks
  three others "Configured on request". Vehicle types, tyre layouts, life caps, ERP import mappers, cost
  classifier rules and country list are built around this customer (COMMERCIAL_FOUNDATION.md CF-10, CF-11).
- Verdict: UNVERIFIABLE for the unmarked industries. Fix: mark every industry except ready-mix "configured
  with you".

### MKT-15 "Duplicates are checked before they land" and "we lose no row"
- Severity P3. Confidence VERIFIED (PROJECT_MEMORY).
- `lib/faqs.ts:15,49`, `app/solutions/spreadsheets-to-platform/page.tsx:40,59,69`,
  `components/motion/walkthrough/cost.tsx:74` ("Uploading the same file twice adds nothing").
- Reality: true for tyres, job cards, fleet and for expense files when the line number column is mapped or
  through the content hash guard added in November. Two expense re-uploads duplicated rows this year when the
  column was not mapped. The import mappers are specific to one ERP export format (CF-10).
- Verdict: TRUE ONLY FOR THE CURRENT COMPANY (its file formats). A new customer's files need mapping work.

### MKT-16 Tread capture
- Severity P3. `app/schema.tsx:57,149` and `app/llms-full.txt/route.ts:70` say the app captures "tread and
  pressure". The field exists; PROJECT_MEMORY records that tread depth has never been captured in production
  (0 of 4,782 wheel entries). Verdict: TRUE TODAY as a capability, unused; do not show tread-based KPIs in a
  demo on live data.

### MKT-17 Contact form delivery and host names
- Severity P2. Confidence NOT VERIFIED.
- The contact form needs email provider variables on the marketing Vercel project; PROJECT_MEMORY records
  them as unset (form falls back to WhatsApp or email). "We confirm a time. A reply to your work email"
  (`app/contact/page.tsx:94`) depends on it. `APP_URL` defaults to `https://app.tyrepulse.app`
  (`lib/site.ts:100`); whether that host serves the app is open in the security audit (WEB-2).
- The rate limit on the form is in memory per instance (RELIABILITY_OPERATIONS.md REL-18).

### MKT-18 Data deletion and data export statements
- Severity P3. Confidence VERIFIED (code) / NOT VERIFIED (process).
- "Our team handles each request by email" (`lib/faqs.ts:65`), "Verified requests are completed within 30
  days" (`src/pages/DataDeletion.jsx:95`, `src/pages/Privacy.jsx:84`). The in-app request is a logged intent;
  completion is manual (CF-16). No evidence a request has ever been processed.
- "Registers export to Excel and PDF, so you can take a copy of your data out at any time"
  (`app/security/page.tsx:67`): true per register; a whole-company export is operator only.
- Verdict: UNVERIFIABLE (30 days); TRUE TODAY (register exports).

## 3. Full claim register

### 3.1 Home (`app/page.tsx`)

| Line | Claim | Verdict | Basis |
|---|---|---|---|
| 20 | One record for multi-site fleets, web and Android, English and Arabic | TRUE ONLY FOR THE CURRENT COMPANY | Works for one tenant; Arabic coverage on web is partial and RTL on devices is unchecked (PROJECT_MEMORY) |
| 32 | Tyre lifecycle by serial and wheel position, cost per km or engine hour (Available) | TRUE TODAY | 11,260 tyre records; CPK engine; half of tyres have no real price, the report says so |
| 33 | Inspections on the phone with or without signal (Available) | TRUE TODAY (Expo app) | MKT-13 |
| 34 | One record per machine (Available) | TRUE TODAY | Asset register; identity fields thin outside KSA |
| 35 | Job cards, preventive plans, technicians and parts in one queue (Available) | Job cards TRUE ONLY FOR THE CURRENT COMPANY (ERP import); preventive plans NOT YET TRUE | MKT-2 |
| 36 | Stock by site, parts issued to the job, purchase requests with approval (Available) | Stock and issues TRUE TODAY (thin: 36 stock rows); purchase requests NOT YET TRUE | MKT-2 |
| 37 | Dashboards, scheduled reports, shareable boards (Available) | TRUE TODAY | 1 active schedule, 2 share links |
| 38 | Accident cases with photos, damage, root cause, claim documents (Available) | TRUE TODAY | 43 accidents; workflow live since September |
| 39 | AI photo analysis (Available) | Experimental | MKT-3 |
| 70-71 | "Built inside a working ready-mix operation ... across three countries. These are its own numbers." | TRUE TODAY | SQL |
| 97-99 | Three-step rollout from exported files | TRUE ONLY FOR THE CURRENT COMPANY | Operator-led; mappers fit one ERP |
| 104 | "See your cost per km, tyre by tyre" on your data in a demo | UNVERIFIABLE | Needs a demo tenant; none suitable exists (CF-17) |

### 3.2 Proof strip (`lib/proof.ts:2-5`)

| Claim | Database | Verdict |
|---|---|---|
| 1600+ machines on record | 1,622 fleet rows (about 1,377 distinct codes; 415 KSA rows are historical, not in the current fleet) | TRUE TODAY as rows; "machines on record" is fair, "in service" would not be |
| 89000+ job cards | 96,944 | TRUE TODAY |
| 216000+ expense lines "classified into tyres, spare parts and oil" | 218,776 | TRUE TODAY (most are classified by the default rule; see AI_READINESS.md AI-13) |
| 3 countries, each in its own currency | KSA, UAE, Egypt | TRUE TODAY |
| "Imported from the ERP and worked in the app" (job cards) | Almost all imported; in-app workshop statuses were unusable until V497 | Imported TRUE; "worked in the app" weak |

### 3.3 Platform pages

| Page:line | Claim | Verdict | Basis |
|---|---|---|---|
| `platform/page.tsx:43` | Fleet and assets (Available) | TRUE TODAY | |
| `:44` | Work orders, preventive plans, technicians, parts (Available) | Mixed | MKT-2 |
| `:45` | Inspections and safety (Available) | TRUE TODAY | |
| `:46` | Tyre lifecycle (Available) | TRUE TODAY | |
| `:47` | Stores and procurement (Available) | Stores TRUE TODAY, procurement NOT YET TRUE | MKT-2 |
| `:48` | Reports and dashboards (Available) | TRUE TODAY | |
| `:49` | Accidents and claims (Available) | TRUE TODAY | The separate insurance claims ledger is disabled; accident-embedded claims are live |
| `:50` | Roles and approvals (Available) | TRUE ONLY FOR THE CURRENT COMPANY | Role matrix global (CF-13) |
| `:51` | Fuel records (On request) | Honest | 0 rows |
| `:52` | Integrations and API (On request); "ERP file imports are built in" | Honest; imports TRUE ONLY FOR THE CURRENT COMPANY | CF-10 |
| `:101` | "Running a concrete fleet in production today" | TRUE TODAY | |
| `tyre-lifecycle/page.tsx:28` | Serial tracking, scan or type (Available) | TRUE TODAY | Serials are sometimes batch codes or blank in the data |
| `:29` | Fitment to removal, one active tyre per wheel (Available) | TRUE TODAY | Guard trigger; 1 known exception |
| `:30` | Cost per km or engine hour (Available) | TRUE TODAY | States its basis |
| `:31` | Tyre life and forecast (Available) | TRUE ONLY FOR THE CURRENT COMPANY | Life caps and targets are this fleet's (mixer 80k, pump 56k) |
| `:32` | Warranty claims (Available) | NOT YET TRUE | MKT-2 |
| `:33` | Root cause analysis (Available) | TRUE TODAY, barely used | 1 record |
| `:37` | Scrap register with undo (Available) | TRUE TODAY | |
| `:38` | Tyre data import, duplicates checked (Available) | TRUE ONLY FOR THE CURRENT COMPANY | MKT-15 |
| `:39-40` | Live TPMS, RFID reads (On request) | Honest | |
| `:44-46` | Forecast basis; cost pending | TRUE TODAY | |
| `:69-73` | "A figure that shows its working ... never blended" | TRUE TODAY | |
| `:83-84` | AI section | Experimental | MKT-3 |
| `:94` | Pressure compared with other tyres on the same vehicle | TRUE TODAY | Median rule |
| `inspections/page.tsx:37-40` | Offline checks; checklists by asset type; defects raise actions and work orders; supervisor sign-off on the phone | TRUE TODAY | Checklist templates and two-stage approval live; "work orders" is one click by a person, not automatic |
| `maintenance/page.tsx:26` | Job cards, technicians, parts, outside repairs in one queue | TRUE ONLY FOR THE CURRENT COMPANY | Job cards are ERP imports; technician assignment almost unused |
| `:42-44` | Preventive maintenance | NOT YET TRUE | MKT-2 |
| `inventory/page.tsx:24` | Which parts each job consumed, cost per machine by site and month | TRUE ONLY FOR THE CURRENT COMPANY | From ERP expense lines |
| `:35` | Supplier performance | NOT YET TRUE | MKT-2 |
| `fleet-assets/page.tsx:46` | Meters from inspections, job cards and telematics; backwards readings flagged; PM driven by the meter | Mixed | MKT-5; flagging TRUE; PM disabled |
| `:58` | Registration, insurance and permits with expiry reminders | TRUE TODAY as a capability; needs data | 0 vehicles carry a date; alert engine live |
| `:58` | Transfers between sites and countries with full history | TRUE ONLY FOR THE CURRENT COMPANY, partly inferred | Movement is inferred from record sites |
| `:58` | Disposal decisions backed by downtime and repair cost | TRUE TODAY | |
| `reports/page.tsx:27-32` | Dashboards, scheduled reports, shareable boards, KPIs, exports, management reports (Available) | TRUE TODAY | Scheduled email depends on the email provider; both live share links have no password or expiry |
| `:36-37` | Custom layouts; per-country currency (Available) | TRUE TODAY | |
| `:38-39` | Reports for your process; BI feed (On request) | Honest | |

### 3.4 Solutions and industries

| Page:line | Claim | Verdict |
|---|---|---|
| `solutions/tyre-management/page.tsx:12,29,53,64` | TPMS alerts through telematics | NOT YET TRUE (MKT-4) |
| `:28` | RFID read or typed serial opens history | Serial TRUE TODAY; RFID on request |
| `:44` | "We set up axles and positions ... before go-live" | TRUE TODAY (vehicle designer exists; operator work) |
| `solutions/ready-mix-fleet/page.tsx:29` | Service plans by hours, km or calendar | NOT YET TRUE (MKT-2) |
| `:30` | Waiting time and repair time reported separately | TRUE ONLY FOR THE CURRENT COMPANY (needs the four ERP timestamps; many job card dates are known to be wrong) |
| `:31,54` | Cost per cubic metre by region and month | TRUE ONLY FOR THE CURRENT COMPANY (KSA only, needs plant volumes and region mapping) |
| `:55` | Does not replace the ERP | TRUE TODAY |
| `solutions/spreadsheets-to-platform/page.tsx:28-34` | Comparison table | Mostly TRUE TODAY; offline row see MKT-13; access row see MKT-9 |
| `:40` | "duplicates are flagged before import, and every upload is logged" | Partly: operator table loads write no upload record |
| `industries/page.tsx:30` | Ready-mix "In production today" | TRUE TODAY |
| `:31-36` | Other industries | UNVERIFIABLE (MKT-14) |
| `:35,37,38` | Buses, rental, government "Configured on request" | Honest |

### 3.5 Security page (`app/security/page.tsx`)

| Line | Claim | Verdict | Basis |
|---|---|---|---|
| 30 | Company and country isolation enforced by the database (Available) | Country TRUE TODAY; company TRUE ONLY FOR THE CURRENT COMPANY | TEN-1 to TEN-3 open for a second tenant |
| 31 | Role-based access and per-user grants (Available) | Partly | MKT-9 |
| 32 | MFA for administrator accounts (Available) | TRUE TODAY | 2 users enrolled |
| 33 | Audit trail of sign-ins, access changes, approvals, record changes (Available) | TRUE TODAY, limited | Row audit on 16 tables; most rows are system imports |
| 34 | Private storage, expiring links (Available) | TRUE TODAY | 0 public buckets |
| 35 | HTTPS only (Available) | TRUE TODAY | |
| 45 | API keys with rate limits and rotation (Available) | UNVERIFIABLE | MKT-12 |
| 46 | Shared links with optional password and expiry (Available) | TRUE TODAY | Optional means the live ones have neither |
| 47-49 | SSO, integrations, support terms (On request) | Honest | 0 identity providers |
| 28 | "Nothing here is a certification" | Honest | |
| `lib/faqs.ts:30` | MFA available; SSO on request | TRUE TODAY | |

### 3.6 Pricing, FAQ, about, llms, schema

| Where | Claim | Verdict |
|---|---|---|
| `pricing/page.tsx:25-28` | Four plans and their features | NOT YET TRUE as enforceable plans (MKT-11) |
| `:32-37` | Included in every plan | Offline app TRUE (Expo); languages TRUE; import TRUE ONLY FOR THE CURRENT COMPANY; access by company NOT YET TRUE; exports TRUE; onboarding is operator work |
| `lib/faqs.ts:22` | Start with one site or one module | UNVERIFIABLE (module switches are platform-wide, CF-05) |
| `:39` | Hosted, own workspace | NOT YET TRUE (MKT-1) |
| `:44` | Built-in roles; custom roles per company | TRUE ONLY FOR THE CURRENT COMPANY (matrix shared) |
| `:46` | English and Arabic, right to left | TRUE TODAY with gaps (not device-checked) |
| `:50` | No RFID or TPMS needed | TRUE TODAY |
| `:51` | Cost per km definition | TRUE TODAY |
| `:55` | Build your own checklists; failed item raises an action or work order | TRUE TODAY |
| `:59-61` | Formats, scheduling, TV board | TRUE TODAY |
| `about/page.tsx:32-34` | Web available, Android on Google Play, iOS planned | TRUE TODAY (Play state NOT VERIFIED from here) |
| `about/page.tsx:50` | Carries the operation's daily work today | TRUE TODAY |
| `:51` | "The same platform is configured for other fleets" | UNVERIFIABLE (never done) |
| `llms.txt/route.ts:46` | Android 1.6.0 live in Play Production, works offline | TRUE per PROJECT_MEMORY; NOT VERIFIED in Play Console |
| `llms-full.txt/route.ts:53` | "the same controlled calculations that power the screens, the exports and the executive displays" | Mostly TRUE; about 40 helpers still compute CPK per row (PROJECT_MEMORY) |
| `schema.tsx:57-64` | Module descriptions | Several NOT YET TRUE (MKT-2, MKT-9, MKT-10, MKT-3) |
| `schema.tsx:7` | No rating or review emitted | Honest |
| `components/AssistantWidget.tsx:38` | Scripted guide, says it is not a live person | Honest |
| Tours | Labelled sample data with invented codes | Honest, except TPMS and RFID steps (MKT-4) |

### 3.7 In-app public pages

| Page | Finding | Verdict |
|---|---|---|
| `src/pages/PublicMarketingHome.jsx` | iOS claim, disabled modules, fuel by project | NOT YET TRUE (MKT-6) |
| `src/pages/Privacy.jsx` | Third-party statement wrong; data list omits AI processing; effective date 18 July 2026 predates AI photo analysis | NOT YET TRUE (MKT-7) |
| `src/pages/Terms.jsx` | Draft note visible; no legal entity | UNVERIFIABLE (MKT-8) |
| `src/pages/DataDeletion.jsx` | 30 day completion; "no third-party advertising"; mentions only crash diagnostics | Deletion process UNVERIFIABLE; same third-party gap as MKT-7 |
| `src/pages/PublicStatus.jsx` | "No automated service-health claim is shown until monitoring is connected" | Honest; confirms no status monitoring (RELIABILITY_OPERATIONS.md REL-10) |

## 4. What must not be marketed today

1. A self-contained workspace per company, self sign-up or plan purchase (MKT-1, MKT-11).
2. Preventive maintenance, warranty claims, purchase requests, supplier performance, bay utilisation as
   "Available" (MKT-2).
3. AI photo analysis as a proven detector, or AI "root causes" (MKT-3).
4. Live TPMS, RFID passports or telematics connections as existing features (MKT-4, MKT-5).
5. iOS (MKT-6).
6. "Only Sentry receives data" (MKT-7).
7. Field, device or record level restrictions; department, risk or financial approval routing (MKT-9, MKT-10).
8. A working public API (MKT-12).
9. Any uptime, response time or recovery figure (none exists; the site correctly makes none).

## 5. What the site does well (keep)

No certification claimed, no invented prices or ratings, sample data labelled and anonymised, the "On request"
and "Planned" badges exist and are used, the assistant says it is scripted, proof numbers are real and
rounded down, the cost per km text names its basis.

## 6. Not verified

- The deployed marketing site content (only the repository at `df6f9b58` was read), its environment variables
  and which host serves it.
- Google Play listing state and version.
- Whether the contact form delivers email.
- Whether a deletion request has ever been completed.
- Arabic page `app/ar/page.tsx` was not read line by line; its claims mirror the English home and need the
  same edits.
- Rendering of badges in a browser.
