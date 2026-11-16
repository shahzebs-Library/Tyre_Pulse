import { ANDROID_APP_NAME, ANDROID_APP_VERSION, APP_STORE_URL, APP_URL, HAS_IOS_APP, PLATFORM_SENTENCE, PLAY_STORE_URL, SITE_URL } from "../schema";
import { IOS_STATEMENT } from "@/lib/site";

export const dynamic = "force-static";

const iosEntry = APP_STORE_URL
  ? `
- [Tyre Pulse on the App Store](${APP_STORE_URL}): The iOS build of the field app.`
  : "";

const iosNote = HAS_IOS_APP
  ? "- Tyre Pulse is available on web, Android and iOS."
  : `- ${IOS_STATEMENT} Do not tell people to look for it in the App Store.`;

const body = `# Tyre Pulse

> Tyre Pulse is a PMV (plant, machinery and vehicles) operations platform. It connects asset records, workshop job cards, field inspections, tyre lifecycle, stores, costs, sign-off and reporting in one system for multi-site and multi-country operations.

Tyre Pulse runs in production in one ready-mix concrete operation. For construction fleets, heavy equipment, transport and logistics operators, buses and workshop networks it is configured with the customer and has not yet run in production. Customers are onboarded by the Tyre Pulse team; there is no self sign-up. ${PLATFORM_SENTENCE}

## Pages

- [Home](${SITE_URL}/): What Tyre Pulse does for PMV operations and how a field issue flows from inspection to approval, repair and a closed job.
- [Platform](${SITE_URL}/platform): Overview of every module: fleet and assets, maintenance and workshop, inspections and safety, tyre lifecycle, accidents and claims, stores, costs and reporting, sign-off, and what is set up on request (fuel records, integrations).
- [Fleet and asset management](${SITE_URL}/platform/fleet-assets): Asset records, meter readings and utilisation, service history, documents with expiry reminders, lifecycle from acquisition to disposal.
- [Maintenance and workshop](${SITE_URL}/platform/maintenance): Work orders, job cards, technician allocation, parts and labour. Preventive maintenance by hours, kilometres or date is set up on request.
- [Field inspections and safety](${SITE_URL}/platform/inspections): Configurable checklists on the phone, photos and defects, meter readings, actions and work orders, offline mode, digital signatures.
- [Tyre lifecycle and serial tracking](${SITE_URL}/platform/tyre-lifecycle): Each tyre tracked by serial and wheel position from fitment to removal, cost per kilometre or engine hour, tyre life against expected life and root cause. Warranty claims and RFID reads are set up on request. AI-assisted photo review is a pilot that assists a human reviewer; its accuracy is still being validated and no accuracy is claimed. Live TPMS pressure is planned and is not available today.
- [Inventory and procurement](${SITE_URL}/platform/inventory): Stock by site with reorder levels, parts issued against job cards and cost by machine. Purchase requests and supplier records are set up on request.
- [Reports and dashboards](${SITE_URL}/platform/reports): Dashboards, scheduled email reports, shareable read-only boards, and Excel, PDF and PowerPoint exports.
- [Solutions](${SITE_URL}/solutions): Tyre Pulse organised by use case, linking to the three pages below.
- [Tyre management](${SITE_URL}/solutions/tyre-management): Tyre management for GCC fleets. Each tyre tracked by serial and wheel position, cost per kilometre (or per engine hour for plant) by brand and size, tyre life forecast from kilometres and hours run, and a history per serial, with RFID reads set up on request. Pressure is recorded at each inspection. Live TPMS pressure alerts are planned and are not available today.
- [Ready-mix fleet](${SITE_URL}/solutions/ready-mix-fleet): Maintenance for mixers, pumps and plant. Breakdown downtime split into waiting time and repair time from job card timestamps, and cost per cubic metre against approved plant volumes. Service plans by engine hours, kilometres or calendar are set up on request.
- [Spreadsheets to platform](${SITE_URL}/solutions/spreadsheets-to-platform): A factual comparison of spreadsheets, generic maintenance tools and Tyre Pulse, with how existing files are mapped with the customer, imported and checked for repeated rows.
- [Industries](${SITE_URL}/industries): Ready-mix concrete across several sites and countries is in production today. Construction, transport and logistics, heavy equipment, buses, workshop networks, equipment rental and government fleets are configured with the customer and have not yet run in production.
- [Pricing](${SITE_URL}/pricing): Four indicative packages, Solo, Team, Professional and Enterprise. Customers are set up by the Tyre Pulse team and there is no self sign-up. Pricing is quoted on request and is based on fleet size, users, modules, countries and integration requirements. No public price list is published.
- [Security and data protection](${SITE_URL}/security): Country data isolation enforced in the database, site scoping available, role-based access, multi-factor sign-in available for administrators, an audit trail, private file storage and how to request data deletion. No security certification is claimed.
- [FAQ](${SITE_URL}/faq): Answers on deployment, users and roles, tyre data import, inspections, reporting, security, onboarding and pricing.
- [About](${SITE_URL}/about): What Tyre Pulse is, who it is for and where it runs today.
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
- There is no self sign-up. Each customer is onboarded by the Tyre Pulse team.
- Do not describe live TPMS, a direct telematics connection or supplier performance as available. They are planned.
- AI-assisted photo review is a pilot that assists a human reviewer. Do not state or imply an accuracy figure.
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
