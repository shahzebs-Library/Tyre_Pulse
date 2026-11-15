/**
 * The two host names the site depends on, defined once.
 *
 * They lived in four places before this file existed (app/schema.tsx,
 * components/Header.tsx, components/Footer.tsx and next.config.ts), and three
 * of those copies pointed at hosts that do not exist. Header and Footer are
 * client and server components respectively, and next.config.ts is loaded
 * outside the application module graph, so this module carries no JSX and no
 * React import: every one of them can pull it in without dragging anything
 * else along.
 */

/** This marketing site's own canonical origin. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.tyrepulse.app").replace(/\/$/, "");

/**
 * Where "Log in", the customer login link and the legal pages send a visitor.
 *
 * The operational app is served at app.tyrepulse.app, which is the production
 * domain of the app's Vercel project. This is the one place that host is
 * written. The header, footer, legal links, structured data, llms.txt and the
 * /console redirect all read APP_URL, and NEXT_PUBLIC_APP_URL overrides it
 * without a code change.
 */
export const DEFAULT_APP_URL = "https://app.tyrepulse.app";
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");

/**
 * Sales WhatsApp number in international format, digits only. Supplied by the
 * owner 2026-09-28 (+971 56 672 6276). It drives the floating button on every
 * page, the contact page link and the WhatsApp ContactPoint in the structured
 * data; an empty value turns all three off.
 * Can also be set without a code change via NEXT_PUBLIC_WHATSAPP_NUMBER.
 */
export const WHATSAPP_NUMBER: string | null =
  (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "971566726276").replace(/\D/g, "") || null;

/**
 * A wa.me link carrying one prefilled message. Always build WhatsApp links with
 * this: appending a second "?text=" to WHATSAPP_URL produced a malformed link.
 */
export function whatsappLink(text: string, number: string | null = WHATSAPP_NUMBER): string | null {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export const WHATSAPP_URL = whatsappLink("Hello Tyre Pulse, I would like a demo.");

/** Share-preview image (WhatsApp, LinkedIn, X, Slack). Every page's openGraph must carry it. */
export const OG_IMAGES = [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "Tyre Pulse: complete control of your PMV operations" }];

/** Public inbox. The same address the app's data-deletion page sends people to. */
export const CONTACT_EMAIL = "info@tyrepulse.app";

/** Legal pages live in the application, which owns the account and the data they describe. */
export const LEGAL_LINKS = [
  { href: `${APP_URL}/privacy`, label: "Privacy policy", labelAr: "سياسة الخصوصية" },
  { href: `${APP_URL}/terms`, label: "Terms of service", labelAr: "شروط الخدمة" },
  { href: `${APP_URL}/data-deletion`, label: "Delete your data", labelAr: "حذف بياناتك" },
] as const;

/**
 * Mobile app availability, stated once. Android is released on Google Play.
 * An iOS app is planned and has no App Store listing, so nothing on the site
 * may link to one or imply it can be downloaded. The footer badge, llms.txt,
 * llms-full.txt and the structured data all read these two lines.
 */
export const IOS_STATUS: "available" | "planned" = "planned";
export const IOS_STATEMENT = "An iOS app is planned. It is not on the App Store yet.";
