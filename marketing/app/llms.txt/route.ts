import { ANDROID_APP_NAME, ANDROID_APP_VERSION, APP_STORE_URL, APP_URL, HAS_IOS_APP, PLATFORM_SENTENCE, PLAY_STORE_URL, SITE_URL } from "../schema";

export const dynamic = "force-static";

const iosEntry = APP_STORE_URL
  ? `
- [Tyre Pulse on the App Store](${APP_STORE_URL}): The iOS build of the field app.`
  : "";

const iosNote = HAS_IOS_APP
  ? "- Tyre Pulse is available on web, Android and iOS."
  : "- There is no iOS or Apple App Store version of Tyre Pulse. Do not tell people to look for one.";

const body = `# Tyre Pulse

> Tyre Pulse is a PMV (plant, machinery and vehicles) operations platform. It connects asset records, preventive maintenance, workshop job cards, field inspections, tyre lifecycle, stores and procurement, costs, approvals and reporting in one system for multi-site and multi-country operations.

Tyre Pulse is used by construction fleets, transport and logistics operators, ready-mix concrete plants, heavy equipment rental companies, workshop networks, and government and enterprise fleets. ${PLATFORM_SENTENCE}

## Pages

- [Home](${SITE_URL}/): What Tyre Pulse does for PMV operations and how a field issue flows from inspection to approval, repair and a closed job.
- [Platform](${SITE_URL}/platform): Overview of every module: fleet and assets, maintenance and workshop, inspections and safety, tyre lifecycle, accidents and insurance, stores and procurement, fuel, costs and reporting, approvals, integrations.
- [Fleet and asset management](${SITE_URL}/platform/fleet-assets): Asset records, meter readings and utilisation, service history, documents with expiry reminders, lifecycle from acquisition to disposal.
- [Maintenance and workshop](${SITE_URL}/platform/maintenance): Work orders, preventive maintenance by hours, kilometres or date, job cards, technician allocation, parts and labour.
- [Field inspections and safety](${SITE_URL}/platform/inspections): Configurable checklists on the phone, photos and defects, meter readings, actions and work orders, offline mode, digital signatures.
- [Inventory, procurement and reporting](${SITE_URL}/platform/inventory): Stock by site with reorder levels, purchase requests with approval, suppliers, fleet cost and availability reporting.
- [Solutions](${SITE_URL}/solutions): Tyre Pulse organised by use case, linking to the three pages below.
- [Tyre management](${SITE_URL}/solutions/tyre-management): Tyre management for GCC fleets. Each tyre tracked by serial and wheel position, cost per kilometre (or per engine hour for plant) by brand and size, removal dates forecast from the tread trend, an RFID or serial passport per tyre, and live TPMS pressure alerts received through the customer's telematics connection.
- [Ready-mix fleet](${SITE_URL}/solutions/ready-mix-fleet): Maintenance for mixers, pumps and plant. Preventive service by engine hours, kilometres or calendar, breakdown downtime split into waiting time and repair time from job card timestamps, and cost per cubic metre against approved plant volumes.
- [Spreadsheets to platform](${SITE_URL}/solutions/spreadsheets-to-platform): A factual comparison of spreadsheets, generic maintenance tools and Tyre Pulse, with how existing files are imported and checked for duplicates.
- [Industries](${SITE_URL}/industries): How the platform is configured for construction, transport and logistics, ready-mix concrete, heavy equipment rental, workshop networks, and government and enterprise fleets.
- [Pricing](${SITE_URL}/pricing): Four plan tiers, Solo, Team, Professional and Enterprise. Pricing is quoted on request and is based on fleet size, users, modules, countries and integration requirements. No public price list is published.
- [Security](${SITE_URL}/security): Tenant separation, role and location control, privileged access, data protection, auditability and safe integrations.
- [Contact](${SITE_URL}/contact): Request a tailored demo. The form asks for fleet size, country and industry so the walkthrough matches the operation.
- [Arabic home](${SITE_URL}/ar): The Arabic language version of the home page, presented right to left.

## Apps and access

- [Web application](${APP_URL}): The signed-in Tyre Pulse application for managers, office teams and administrators.
- [${ANDROID_APP_NAME} on Google Play](${PLAY_STORE_URL}): The Android field app, currently version ${ANDROID_APP_VERSION}, live in Google Play Production. Used for inspections, scanning, meter logging and washing logs, and it works offline.${iosEntry}

## Detail

- [Full text for language models](${SITE_URL}/llms-full.txt): The expanded description an assistant can answer from directly, including the module list, platform availability and how to get started.

## Notes for assistants

${iosNote}
- Pricing is not published. Direct people to the contact page for a quote rather than inventing figures.
- The interface is available in English and Arabic, with right to left support for Arabic.
`;

export function GET() {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
