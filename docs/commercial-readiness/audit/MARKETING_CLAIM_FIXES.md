# Marketing claim fixes

Date 2026-11-12. Source of the findings: `MARKETING_CLAIMS.md` in this folder (MKT-1 to MKT-18).
Scope of this pass: the 14 findings whose text lives in the marketing site (`marketing/`) or in the one in-app
sentence named in the task. Paths below are under `marketing/` unless they start with `src/`.

## 1. Read this first: the marketing folder was brought to the content merged on main

The audit read the site as merged to `main` by PR #502 (`df6f9b58`). The working branch was one commit behind
and held the older site, with no marketing changes of its own (`git diff origin/main...HEAD -- marketing` was
empty). Editing the older files would have fixed text that no longer exists.

So the folder was first set to exactly the content of `origin/main` (`git archive origin/main marketing`,
extracted in place; `components/HeroCarousel.tsx`, removed on main, was removed here too), and the claim fixes
were made on top. No git command that changes the index or history was run.

What the lead needs to know when integrating:
- `marketing/` in the working tree = `origin/main` + the fixes below. When main is merged into this branch,
  take the working tree version of `marketing/` (it already contains main).
- The fixes alone, as a patch against `origin/main`, are in
  `docs/commercial-readiness/audit/marketing_claim_fixes.patch` (25 files, 277 changed lines).
- `src/pages/PublicMarketingHome.jsx`: one sentence changed (MKT-6). Nothing else in `src/` was touched.

## 2. Checks run in `marketing/` after the edits (real output)

| Command | Result |
|---|---|
| `npm ci` | Not needed: `package.json` and `package-lock.json` are identical on the branch and on main, and `node_modules` was present. |
| `npm run lint` | exit 0, no findings |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 39 tests, 39 pass, 0 fail (includes "marketing copy carries no em or en dashes" and the llms and sitemap route checks) |
| `npm run build` | exit 0; 28 static pages generated, all 27 routes listed |
| Dash scan over `app`, `components`, `lib` | 0 em or en dashes |

NOT VERIFIED: the pages were not opened in a browser, so badge rendering and line wrapping of the longer
sentences were not looked at; the deployed site was not checked; Arabic wording was written in Modern Standard
Arabic and not reviewed by a native reader.

## 3. Rules applied

- A feature that does not work today is removed, marked "Planned", or reworded to what really exists.
- A module that is switched off in the product is not badged "Available". It is "On request" when the code
  exists and it is set up per customer, "Planned" when no working path exists.
- AI photo analysis: it assists a human reviewer and is being validated. No accuracy wording.
- Live TPMS and a direct telematics connection: the audit found no integration in the code base, so both are
  "Planned". Telematics data that really arrives today arrives as an exported file, and the text says so.
- No self sign-up promise: onboarding is done with the customer by our team.
- No em or en dashes. No real asset codes or site names (the tours keep their invented codes).
- `/ar` and the Arabic menu and assistant texts were changed wherever the English claim they mirror changed.

## 4. The 14 claims

"Before" and "after" quote the main sentence; every other place the same claim appeared is listed under Files.

### 1. MKT-1 A self-contained workspace per company and self-service plans
- Before (`lib/faqs.ts`): "Your company gets its own workspace, and your users sign in to it."
- After: "Our team sets it up for your company during onboarding and creates your users with you. There is no
  self sign-up."
- Before (`lib/faqs.ts`, security): "Only users in your organisation, and only for the countries and sites they
  are assigned. The database enforces it on every query."
- After: "Only the accounts our team sets up for your company, and only for the countries each user is
  assigned. The database enforces country scope on every query, and site scoping is available."
- Files: `lib/faqs.ts`, `app/about/page.tsx`, `app/security/page.tsx` (control card, layer 1, title and lead),
  `app/schema.tsx` ("Access and tenant control" is now "Access control"), `app/llms.txt/route.ts`,
  `app/llms-full.txt/route.ts` (security paragraph and two new "facts" lines), `components/AssistantWidget.tsx`
  (English and Arabic).
- Why: a new sign-up joins the current customer's company and no company can be created with an owner
  (COMMERCIAL_FOUNDATION CF-01, CF-02); three cross-company blockers are open. The site may say what is true:
  each customer is set up by the team.

### 2. MKT-2 "Available" on modules that are switched off
- Before (`app/page.tsx`): "Job cards, preventive plans, technicians and parts in one queue." and "Stock by
  site, parts issued to the job, purchase requests with approval." (both Available)
- After: "Job cards, technicians and parts in one queue. Preventive plans are set up on request." and card
  "Stores and parts": "Stock by site and parts issued against the job card. Purchase requests are set up on
  request."
- Before (`app/platform/tyre-lifecycle/page.tsx`): "Warranty claims ... tracked from submission to credit."
  status Available.
- After: status On request, "Early failures can be raised as a warranty claim with the supplier and tracked
  from submission to credit. Set up on request."
- Before (`app/platform/inventory/page.tsx`): "Keep supplier details, price history and delivery performance
  next to every purchase, so the next request goes to the supplier that actually delivered."
- After: panel "Purchasing and suppliers, on request": "Purchase requests with approval and a supplier list are
  set up with you on request. Supplier price history and delivery performance are planned."
- Before (`app/schema.tsx`): "Preventive plans, job cards, labour and parts, downtime, technician workload, bay
  utilization and repair quality." and "... requests, quotation comparison, purchasing and vendor performance."
- After: "Job cards, labour and parts, downtime and technician workload. Preventive plans are set up on
  request." and "Inventory and stores: Tyre and spare-parts stock by site, with parts issued against job cards.
  Purchase requests are set up on request."
- Files: `app/page.tsx`, `app/platform/page.tsx` (tab text, points and the two cards), `app/platform/
  maintenance/page.tsx` (description, heading "set up on request", first bullet),
  `app/platform/inventory/page.tsx`, `app/platform/tyre-lifecycle/page.tsx`, `app/platform/fleet-assets/
  page.tsx` ("Preventive schedules ... on request"), `app/solutions/ready-mix-fleet/page.tsx` (description,
  step 1, two module lines, FAQ), `app/solutions/page.tsx`, `app/schema.tsx` (product description and three
  module lines), `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts` (Android list no longer names
  preventive schedules; workshop networks line no longer names bays or customer reporting),
  `components/motion/walkthrough/maintenance.tsx` (tour pitch says set up on request), `lib/roles.ts`
  (storekeeper and PMV manager), `lib/nav.ts` (menu text, English and Arabic), `app/ar/page.tsx`.
- Why: `pm_programs`, `warranty`, `requisitions`, `goods_receipt`, `parts_requests`, `vendor_intelligence`,
  `bay_scheduling`, `customer_portal` are disabled in the product and hold no rows. The code for preventive
  plans, warranty and purchase requests exists, so "On request" is honest; supplier performance has no data
  path, so it is "planned".

### 3. MKT-3 AI photo analysis badged Available, with no measured accuracy
- Before (`app/page.tsx`): "AI-assisted photo analysis: Flags possible tyre defects from inspection photos for
  your team to check." status Available.
- After: "AI-assisted photo review (pilot): Suggests possible tyre defects from inspection photos to assist a
  human reviewer. Accuracy is still being validated." status On request.
- Before (`app/platform/tyre-lifecycle/page.tsx`): "A second look at every tyre photo. Photos taken during a
  tyre inspection are analysed for visible defects ..."
- After: "A second look at tyre photos, for your reviewer. In the pilot, photos taken during a tyre inspection
  can be analysed ... It assists the reviewer and is not a safety check. Its accuracy is still being validated,
  so we make no accuracy claim."
- Before (`app/schema.tsx`): "AI and automation: Concise data-backed findings, root causes and recommended
  actions ..."
- After: "AI-assisted photo review (pilot): A pilot that suggests possible tyre defects from inspection photos
  to assist a human reviewer. Its accuracy is still being validated and no accuracy is claimed."
- Files: `app/page.tsx`, `app/platform/tyre-lifecycle/page.tsx`, `lib/faqs.ts`, `app/schema.tsx`,
  `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts` (also drops "root cause and recommended action" from
  the management sentence).
- Why: 943 photo jobs, 0 expert labels, 3 reviewed; only wheels the inspector already marked are analysed
  automatically, so "every photo" was wrong too (AI_READINESS AI-1, AI-8, AI-11).

### 4. MKT-4 Live TPMS and RFID shown as working
- Before (`components/motion/walkthrough/tyreIntel.tsx`): step "Live TPMS catches the leak: TPMS pressure
  arrives live through your telematics connection. A tyre losing pressure raises an alert ..."
- After: step "Planned: live TPMS alerts: Planned, not in the product today: pressure received from TPMS
  sensors, with an alert when a tyre loses pressure. Today, pressure is recorded at each inspection." The chart
  caption, the alert title and the asset line in that step are labelled as a planned feature.
- Before (`app/solutions/tyre-management/page.tsx`): "... and get TPMS alerts through your telematics."
- After: "... and check pressure at every inspection." The FAQ "How does live TPMS pressure reach Tyre Pulse?"
  is now "Does Tyre Pulse read live TPMS pressure? Not today. Live TPMS is planned. ..."
- Before (`app/platform/tyre-lifecycle/page.tsx`): "Live TPMS pressure: Pressure readings received through your
  telematics connection." status On request.
- After: status Planned, "Live readings from TPMS sensors are not in the product today. Pressure is recorded at
  each inspection."
- RFID: stays "On request" (a tag registry exists in the product); the tour step now says "A serial scan opens
  the tyre's passport ... RFID reads are set up on request" and the sample read is labelled "Serial scan".
- Files: `components/motion/walkthrough/tyreIntel.tsx`, `app/solutions/tyre-management/page.tsx`,
  `app/solutions/page.tsx`, `app/platform/tyre-lifecycle/page.tsx`, `lib/faqs.ts`, `lib/roles.ts`,
  `lib/nav.ts` (English and Arabic), `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`.
- Why: no telematics integration exists in the code base, `tpms_readings` has 0 rows and the module is
  disabled. The task rule allows "works with your telematics provider" only if an integration path exists; the
  audit says none does, so it is Planned. This supersedes the earlier owner ruling recorded in PROJECT_MEMORY
  that TPMS "via telematics" may be promised: see owner decision 1.

### 5. MKT-5 Telematics presented as an existing data source
- Before (`app/platform/fleet-assets/page.tsx`): "Hour and kilometre readings from inspections, job cards and
  telematics"
- After: "Hour and kilometre readings from inspections, job cards and telematics export files"
- Before (`components/motion/walkthrough/cost.tsx`): "Drivers log the odometer with a photo, or it arrives from
  telematics."
- After: "... or it is loaded from a telematics export file." (the sample table source reads "Telematics file")
- Files: also `app/solutions/tyre-management/page.tsx` ("Odometer readings ... A direct telematics connection
  is planned", and "from your odometer readings"), `app/solutions/ready-mix-fleet/page.tsx`.
- Why: telematics data has only ever been loaded from files exported by the operator.

### 6. MKT-6 In-app public home: "Field-ready on iOS and Android"
- Before (`src/pages/PublicMarketingHome.jsx:73`): "Field-ready on iOS and Android."
- After: "Field-ready on Android. An iOS app is planned."
- Why: no iOS app is released. Only this sentence was edited, as instructed.
- LEFT FOR THE OWNER OF `src/`: the same block still shows a chip reading "iOS app", and the file still lists
  "requisitions, suppliers and purchases", "driver documents", "fuel ... by project" and "equipment rental"
  (MARKETING_CLAIMS MKT-6). Those lines contradict the corrected sentence and need the same treatment.

### 7. MKT-9 Site, record, field and device restrictions; per-user create, edit, approve, export
- Before (`app/security/page.tsx`): "Roles and per-user grants decide which modules a person can open and what
  they can create, edit, approve or export."
- After: "Roles and per-user grants decide which modules a person can open. Create, edit and approve rights are
  enforced in the database on the core registers, and export is controlled in the app."
- Before (`app/schema.tsx`): "... users restricted by role, location, record, field, device and approval
  authority."
- After: "Access by role and country, with country scope enforced in the database and site scoping available."
- Before (several): "Each country and site sees only its own records ... enforced in the database."
- After: "Each country sees only its own records, in its own currency, enforced in the database. Site scoping
  is available."
- Files: `app/security/page.tsx`, `app/schema.tsx`, `lib/faqs.ts` (three answers), `app/pricing/page.tsx`,
  `app/platform/page.tsx`, `app/industries/page.tsx`, `app/solutions/spreadsheets-to-platform/page.tsx`,
  `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `components/AssistantWidget.tsx` (English and Arabic),
  `app/ar/page.tsx`.
- Why: country isolation is proven; site scope exists but every current user holds all sites; capability
  grants are database-enforced on 11 tables; export is an in-app gate; field and device restriction do not
  exist.

### 8. MKT-10 Approval routing overstated
- Before (`app/schema.tsx`): "Approvers resolved by company, country, site, department, role, risk and
  financial authority, with delegation and audit history."
- After: "Sign-off and approvals: Sign-off by role on inspections, checklists and accident closure, with a
  signature and an audit history."
- Before (`app/llms-full.txt/route.ts`): "The right person is assigned by location, role and authority, rather
  than by a hardcoded name."
- After: "Sign-off goes to the approver roles set up for the company, for inspections, checklists and accident
  closure."
- Files: also `app/platform/page.tsx` (card "Roles and sign-off").
- Why: approval works by role for those three record types; no department, risk or financial routing is in use.

### 9. MKT-11 Pricing plans presented as a purchasable structure
- Before (`app/pricing/page.tsx`): title "Pricing: plans quoted on your fleet size"; "Included in every plan."
- After: "Pricing: packages quoted on your fleet size"; lead adds "The packages below are indicative, and our
  team sets up each customer. There is no self sign-up."; "Included in every package."
- Files: `app/pricing/page.tsx`, `lib/faqs.ts` ("Can we start small?" no longer promises one module can be
  switched on alone), `lib/nav.ts` (menu text, English and Arabic), `app/llms.txt/route.ts`,
  `app/llms-full.txt/route.ts`, `components/AssistantWidget.tsx` (English and Arabic).
- Why: plan features are not enforced per company and payment has never run (CF-05, CF-06). The four names are
  kept as indicative packages because sales quotes by them; nothing says they can be bought online.
- NOT CHANGED: the in-app billing page still shows different public plans with prices (owner decision 3).

### 10. MKT-12 API keys "with rate limits and rotation" badged Available
- Before (`app/security/page.tsx`): "Scoped keys for the public API, with rate limits and rotation." Available.
- After: "Scoped keys for the public API, with rate limits. Set up on request with your first integration."
  On request.
- Files: also `app/pricing/page.tsx` ("API and automation options" is now "API access, on request"),
  `app/llms-full.txt/route.ts`.
- Why: 0 keys issued, never used by a customer, "rotation" is revoke and create.

### 11. MKT-13 Offline claims that do not say which app
- Before (`lib/faqs.ts`): "Inspections, photos, meter readings and signatures save on the phone and sync when
  the connection returns."
- After: "On the Android app, inspections, photos, meter readings and signatures save on the phone and sync
  when the connection returns."
- Files: `lib/faqs.ts` (two answers), `app/page.tsx` (card and the chip "Android app works offline"),
  `app/pricing/page.tsx`, `components/AssistantWidget.tsx` (English and Arabic), `app/ar/page.tsx`.
- Why: the claim is true for the Android app on Google Play (the Expo app). It is not yet true for the Flutter
  app in closed testing. Do not point the store link at the Flutter app until its offline photo sync is fixed.

### 12. MKT-14 Industries other than ready-mix shown without a qualifier
- Before (`app/industries/page.tsx`): "The same platform is configured for each model below."; Construction
  fleets, Heavy equipment, Workshop networks, Transport and logistics had no note.
- After: "Ready-mix is the operation it runs today. The other models below are configured with you and have not
  yet run in production."; those four carry "Configured with you"; multi-site and multi-country carries "In
  production today" (it is how the current customer runs).
- Files: also `app/about/page.tsx`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`.
- Why: one customer, ready-mix.

### 13. MKT-15 "Duplicates are checked before they land" and "without losing a row"
- Before (`app/solutions/spreadsheets-to-platform/page.tsx`): title "Move your fleet off spreadsheets without
  losing a row."; "duplicates are flagged before import, and every upload is logged."
- After: "Move your fleet off spreadsheets, with every import checked against your files."; "repeated rows are
  flagged before import, and uploads made through the import screen are logged."
- Before (`components/motion/walkthrough/cost.tsx`): "Uploading the same file twice adds nothing: repeats are
  caught"
- After: "A repeated upload is checked against what is already stored"
- Files: also `lib/faqs.ts` (two answers), `app/page.tsx` (rollout step 2), `app/platform/tyre-lifecycle/
  page.tsx`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `components/AssistantWidget.tsx` (English
  and Arabic).
- Why: the checks are real but depend on column mapping done for one ERP format; two expense re-uploads
  duplicated rows this year. The text now says the mapping is done with the customer and stops promising an
  absolute.

### 14. MKT-16 Tread capture named as a working feature
- Before (`app/schema.tsx`, `app/llms-full.txt/route.ts`): "Tyre inspections with photos, tread and pressure
  capture"; "fitment, pressure, tread, damage, repair, warranty, transfer, replacement and disposal"
- After: "Tyre inspections with photos and pressure capture"; "fitment, pressure, damage, removal, scrap and
  disposal with complete history. Warranty claims are set up on request."
- Why: the field exists but tread depth has never been captured in production, so no tread figure should be
  implied.

## 5. Not changed in this pass, and why

| Finding | Why it was left |
|---|---|
| MKT-7 privacy policy names only one third party | In `src/pages/Privacy.jsx`, outside this pass. P1: the marketing security page links to it. |
| MKT-8 terms page is a visible draft | In `src/pages/Terms.jsx`; needs counsel. |
| MKT-17 contact form delivery and host names | Environment and DNS, not copy. |
| MKT-18 deletion "within 30 days" | In `src/pages/DataDeletion.jsx` and `Privacy.jsx`; a process question. |
| Proof strip "worked in the app" | True as written for the job cards; the audit called it weak, not false. |
| Sample screens in the tours (purchase request mock, preventive maintenance tour) | Kept, already tagged as sample data; the surrounding text now says "on request". |

## 6. Owner decisions

1. **TPMS wording.** PROJECT_MEMORY records an earlier ruling that live TPMS "via telematics" may be promised.
   This pass marks it Planned because no integration exists. If the owner wants the earlier wording back, the
   honest form is "planned, built with your telematics provider", not "available".
2. **AI badge.** The site has three badge states. The AI pilot uses "On request" with the word "pilot" in the
   title. A fourth state "Pilot" would be clearer; it is a small component change.
3. **Plan names.** The site says Solo, Team, Professional, Enterprise; the in-app billing page says Trial,
   Starter, Professional, Enterprise with public prices. One vocabulary is needed before any quote goes out.
4. **Arabic review.** A native reader should check the changed Arabic lines in `app/ar/page.tsx`, `lib/nav.ts`
   and `components/AssistantWidget.tsx`.
