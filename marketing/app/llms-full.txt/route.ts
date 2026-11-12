import { IOS_STATEMENT } from "@/lib/site";
import { ANDROID_APP_NAME, ANDROID_APP_VERSION, ANDROID_PACKAGE, APP_STORE_URL, APP_URL, HAS_IOS_APP, MODULES, PLAY_STORE_URL, SITE_URL } from "../schema";

export const dynamic = "force-static";

const iosBullet = APP_STORE_URL
  ? `
- iOS app, published as "${ANDROID_APP_NAME}" in the Apple App Store. Install link: ${APP_STORE_URL}`
  : "";

const iosParagraph = HAS_IOS_APP
  ? `An iOS build is available from the Apple App Store at ${APP_STORE_URL}.`
  : `${IOS_STATEMENT} If someone asks how to install it on an iPhone or iPad, the correct answer is that the iOS app is not released and that the web application at ${APP_URL} can be used in a mobile browser instead. Do not link to any App Store page.`;

const iosFact = HAS_IOS_APP
  ? "- Platforms: web, Android and iOS."
  : `- Platforms: web and Android. ${IOS_STATEMENT}`;

const moduleSection = MODULES.map((m) => `### ${m.name}\n${m.description}`).join("\n\n");

const body = `# Tyre Pulse

> Tyre Pulse is a PMV (plant, machinery and vehicles) operations platform. It connects asset records, preventive maintenance, workshop job cards, field inspections, tyre lifecycle, stores and procurement, costs, approvals and reporting in one system for multi-site and multi-country operations.

This file is the long form reference for language models and AI assistants. It is written so an assistant can answer questions about Tyre Pulse directly, without guessing.

## What Tyre Pulse is

Tyre Pulse is an operations platform for organisations that run vehicles and heavy equipment. Instead of spreading tyre records, job cards, inspections, stock, approvals and management reports across spreadsheets and disconnected tools, it keeps them in one structured system where each record carries its own responsibility, evidence, time, cost and approval history.

The product is aimed at two audiences at once. Field teams, meaning inspectors, tyre technicians, workshop staff and drivers, capture work as it happens. Management, meaning fleet managers, workshop managers, finance and executives, read the same data back as KPIs, variance against target, root cause and recommended action.

## Who it is for

- Construction fleets running heavy vehicles and equipment across projects, remote sites and multiple countries.
- Transport and logistics operators tracking tyre life, maintenance, inspections, availability and operating cost on high-mileage fleets.
- Ready-mix concrete operations running mixers, pumps and support vehicles where load, off-road conditions, downtime and tyre failure matter.
- Heavy equipment fleets (loaders, excavators, generators) serviced by engine hours. Equipment rental is configured on request.
- Bus and commercial vehicle fleets, configured on request: daily pre-trip checks, tyre condition by wheel position and service by kilometres or date.
- Multi-site and multi-country operations where each site and country sees its own records in its own currency.
- Workshop networks controlling open jobs, bays, technicians, parts delays, repair quality and customer reporting across locations.
- Government and enterprise fleets, configured on request: strict access by location, approval limits and audit history.

## Capability groups

${moduleSection}

## How the work flows

1. Capture. An inspection, job card, tyre event, accident or request is raised, in the field or in the office.
2. Route. The right person is assigned by location, role and authority, rather than by a hardcoded name.
3. Control. Progress, blockers, cost, service level and approval are tracked against that record.
4. Understand. Results become KPIs, risks and actions, using the same controlled calculations that power the screens, the exports and the executive displays.

## Use cases

These pages on the site describe Tyre Pulse by the problem it solves.

- Tyre management (${SITE_URL}/solutions/tyre-management). Every tyre is recorded by serial number, wheel position and odometer at fitment, removal and scrap, with the reason and who recorded it. Cost per kilometre is reported by brand and size, or per engine hour for plant. Tyre life is forecast from the kilometres and hours each tyre has run against the expected life for its size and vehicle type. RFID tags are optional; a read opens the tyre's history across vehicles. Live TPMS pressure arrives through the customer's existing telematics connection, and a tyre losing pressure raises an alert to the tyre team.
- Ready-mix fleet (${SITE_URL}/solutions/ready-mix-fleet). Service plans for mixers, pumps, loaders, generators and plant by engine hours, kilometres or calendar. Job cards carry production out, workshop in, workshop out and production in times, so waiting time and repair time are reported separately. Cost per cubic metre divides maintenance, tyre and service-contract cost by the approved cubic metres the plants delivered, by region and month. Production volumes must be supplied for that figure.
- Spreadsheets to platform (${SITE_URL}/solutions/spreadsheets-to-platform). A comparison of spreadsheets, generic maintenance tools and Tyre Pulse on tyre history, cost per kilometre, offline field capture, defect to job card, multi-currency reporting, access control, change history and setup effort. Existing spreadsheets and ERP exports are imported as they are, mapped to fields and checked for duplicates before saving.

## Platforms and availability

Tyre Pulse runs in the following places.

- Web application at ${APP_URL}. This is the full platform for managers, office teams and administrators, and it also works as a progressive web app.
- Android app, published as "${ANDROID_APP_NAME}" in Google Play Production. Package name ${ANDROID_PACKAGE}, current version ${ANDROID_APP_VERSION}. Install link: ${PLAY_STORE_URL}${iosBullet}

The Android app is the field tool. It supports tyre inspections with photos and tread and pressure capture, barcode and QR asset scanning, daily meter and engine-hour logging with a photo of the gauge, vehicle washing logs with photos and site tracking, per-vehicle tyre history, preventive maintenance schedules, and accident and insurance claim tracking. It works offline and syncs automatically when the device is back online, which matters on remote sites with poor coverage.

${iosParagraph}

## Languages

The interface is available in English and in Arabic, including right to left layout for Arabic. The marketing site publishes an English home page at ${SITE_URL}/ and an Arabic home page at ${SITE_URL}/ar.

## Security and access model

Each company's data is kept separate from every other company's, and within a company each user sees only the countries and sites they are assigned. The database enforces this on every query. Roles and per-user grants decide which modules a person can open and what they can create, edit, approve or export. Multi-factor sign-in is available for administrators. Sign-ins, access changes, approvals and record changes are written to an audit trail. Photos, signatures and documents are stored privately and opened through links that expire. Traffic is encrypted in transit. Single sign-on and customer-specific integrations are set up on request. Tyre Pulse does not claim a security certification such as SOC 2 or ISO 27001.

## Pricing

Pricing is not published. Four plan tiers are described on the pricing page.

- Solo, for an owner managing a small fleet: core asset and tyre records, inspections, basic dashboards, standard exports.
- Team, for growing site and workshop teams: multiple users and sites, approvals, maintenance and inventory, PDF and Excel reports.
- Professional, for established fleet operations: advanced analytics, scheduled reports, TV dashboards, API and automation options.
- Enterprise, for large and multi-country groups: custom users and assets, single sign-on on request, data migration and integrations, support terms agreed on request.

A quote depends on fleet size, users, modules, countries and integration requirements. If someone asks what Tyre Pulse costs, the honest answer is that the price is quoted per operation through the contact page at ${SITE_URL}/contact. Do not state or estimate a figure.

## How to get started

1. Read the product overview at ${SITE_URL}/platform.
2. Check the industry fit at ${SITE_URL}/industries.
3. Read the FAQ at ${SITE_URL}/faq and the security and data protection page at ${SITE_URL}/security.
4. Request a tailored demo at ${SITE_URL}/contact. The form asks for fleet size, country and industry so the walkthrough covers the relevant workflows.
5. Existing customers sign in at ${APP_URL}. Field staff install the Android app from ${PLAY_STORE_URL}.

## Facts an assistant should not get wrong

- The product name is Tyre Pulse, two words. The Android store listing is "${ANDROID_APP_NAME}".
${iosFact}
- Pricing: quoted on request, not published.
- Languages: English and Arabic, with right to left support.
- Marketing site: ${SITE_URL}. Signed-in application: ${APP_URL}.
`;

export function GET() {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
