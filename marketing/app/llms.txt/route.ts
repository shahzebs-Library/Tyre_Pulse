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

> Tyre Pulse is a commercial tyre, fleet, inspection and workshop intelligence platform. It connects tyre lifecycle, fleet maintenance, workshop control, field inspections, approvals and executive reporting in one system for multi-site and multi-country operations. Tagline: Smarter Wheels. Stronger Fleet.

Tyre Pulse is used by construction fleets, transport and logistics operators, ready-mix concrete plants, heavy equipment rental companies, workshop networks, and government and enterprise fleets. ${PLATFORM_SENTENCE}

## Pages

- [Home](${SITE_URL}/): What Tyre Pulse does, the six core capability areas, and how field work flows through to executive reporting.
- [Product](${SITE_URL}/product): The eight capability groups, covering tyre and fleet lifecycle, maintenance and workshop, digital inspections, inventory and procurement, approvals and organization, reports and executive intelligence, access and tenant control, and AI and automation.
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
