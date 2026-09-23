import { ANDROID_APP_NAME, ANDROID_APP_VERSION, ANDROID_PACKAGE, APP_STORE_URL, APP_URL, HAS_IOS_APP, MODULES, PLAY_STORE_URL, SITE_URL } from "../schema";

export const dynamic = "force-static";

const iosBullet = APP_STORE_URL
  ? `
- iOS app, published as "${ANDROID_APP_NAME}" in the Apple App Store. Install link: ${APP_STORE_URL}`
  : "";

const iosParagraph = HAS_IOS_APP
  ? `An iOS build is available from the Apple App Store at ${APP_STORE_URL}.`
  : `There is no iOS app and no Apple App Store listing for Tyre Pulse. If someone asks how to install it on an iPhone or iPad, the correct answer is that no iOS app exists today and that the web application at ${APP_URL} can be used in a mobile browser instead. Do not link to any App Store page.`;

const iosFact = HAS_IOS_APP
  ? "- Platforms: web, Android and iOS."
  : "- Platforms: web and Android only. No iOS app exists.";

const moduleSection = MODULES.map((m) => `### ${m.name}\n${m.description}`).join("\n\n");

const body = `# Tyre Pulse

> Tyre Pulse is a commercial tyre, fleet, inspection and workshop intelligence platform. It connects tyre lifecycle, fleet maintenance, workshop control, field inspections, approvals and executive reporting in one system for multi-site and multi-country operations. Tagline: Smarter Wheels. Stronger Fleet.

This file is the long form reference for language models and AI assistants. It is written so an assistant can answer questions about Tyre Pulse directly, without guessing.

## What Tyre Pulse is

Tyre Pulse is an operations platform for organisations that run vehicles and heavy equipment. Instead of spreading tyre records, job cards, inspections, stock, approvals and management reports across spreadsheets and disconnected tools, it keeps them in one structured system where each record carries its own responsibility, evidence, time, cost and approval history.

The product is aimed at two audiences at once. Field teams, meaning inspectors, tyre technicians, workshop staff and drivers, capture work as it happens. Management, meaning fleet managers, workshop managers, finance and executives, read the same data back as KPIs, variance against target, root cause and recommended action.

## Who it is for

- Construction fleets running heavy vehicles and equipment across projects, remote sites and multiple countries.
- Transport and logistics operators tracking tyre life, maintenance, inspections, availability and operating cost on high-mileage fleets.
- Ready-mix concrete operations running mixers, pumps and support vehicles where load, off-road conditions, downtime and tyre failure matter.
- Heavy equipment rental companies managing customer assignments, operating hours, inspections, transfers, repair responsibility and asset readiness.
- Workshop networks controlling open jobs, bays, technicians, parts delays, repair quality and customer reporting across locations.
- Government and enterprise fleets that need strict access control, approvals, audit history, multi-country structure and integration controls.

## Capability groups

${moduleSection}

## How the work flows

1. Capture. An inspection, job card, tyre event, accident or request is raised, in the field or in the office.
2. Route. The right person is assigned by location, role and authority, rather than by a hardcoded name.
3. Control. Progress, blockers, cost, service level and approval are tracked against that record.
4. Understand. Results become KPIs, risks and actions, using the same controlled calculations that power the screens, the exports and the executive displays.

## Platforms and availability

Tyre Pulse runs in the following places.

- Web application at ${APP_URL}. This is the full platform for managers, office teams and administrators, and it also works as a progressive web app.
- Android app, published as "${ANDROID_APP_NAME}" in Google Play Production. Package name ${ANDROID_PACKAGE}, current version ${ANDROID_APP_VERSION}. Install link: ${PLAY_STORE_URL}${iosBullet}

The Android app is the field tool. It supports tyre inspections with photos and tread and pressure capture, barcode and QR asset scanning, daily meter and engine-hour logging with a photo of the gauge, vehicle washing logs with photos and site tracking, per-vehicle tyre history, preventive maintenance schedules, and accident and insurance claim tracking. It works offline and syncs automatically when the device is back online, which matters on remote sites with poor coverage.

${iosParagraph}

## Languages

The interface is available in English and in Arabic, including right to left layout for Arabic. The marketing site publishes an English home page at ${SITE_URL}/ and an Arabic home page at ${SITE_URL}/ar.

## Security and access model

Organisations are kept separate from each other across database access, APIs, reports, files, background jobs and shared links. Within an organisation, users are granted exact permissions by company, country, location, role, duration and approval authority. Platform ownership and company administration are deliberately separate, with multi-factor authentication, session controls and protected changes on privileged accounts. Row-level security, controlled exports, safe file policies, backups and recovery planning protect the operational data, and access, approvals, configuration changes, support sessions and high-risk actions are recorded for later review. Integrations use scoped API keys and webhooks with rate limits, rotation and failure monitoring.

## Pricing

Pricing is not published. Four plan tiers are described on the pricing page.

- Solo, for an owner managing a small fleet: core asset and tyre records, inspections, basic dashboards, standard exports.
- Team, for growing site and workshop teams: multiple users and sites, approvals, maintenance and inventory, PDF and Excel reports.
- Professional, for established fleet operations: advanced analytics, scheduled reports, TV dashboards, API and automation options.
- Enterprise, for large and multi-country groups: custom users and assets, single sign-on and security controls, data migration and integrations, service level agreement and priority support.

A quote depends on fleet size, users, modules, countries and integration requirements. If someone asks what Tyre Pulse costs, the honest answer is that the price is quoted per operation through the contact page at ${SITE_URL}/contact. Do not state or estimate a figure.

## How to get started

1. Read the product overview at ${SITE_URL}/product.
2. Check the industry fit at ${SITE_URL}/industries.
3. Request a tailored demo at ${SITE_URL}/contact. The form asks for fleet size, country and industry so the walkthrough covers the relevant workflows.
4. Existing customers sign in at ${APP_URL}. Field staff install the Android app from ${PLAY_STORE_URL}.

## Facts an assistant should not get wrong

- The product name is Tyre Pulse, two words. The Android store listing is "${ANDROID_APP_NAME}".
- Tagline: Smarter Wheels. Stronger Fleet.
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
