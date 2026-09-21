/**
 * Shared JSON-LD builders for the Tyre Pulse marketing site.
 *
 * Every fact in this file is verified against the product itself:
 *  - the Android app is live in Google Play Production (Tyre Pulse Inspector)
 *  - iOS is off behind APP_STORE_URL, which is null until a real listing URL exists
 *  - no aggregateRating or review is emitted, because no real rating data exists
 *  - no sameAs is emitted, because no verified social profile exists
 *  - no SearchAction is emitted, because the site has no search endpoint
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.tyrepulse.app").replace(/\/$/, "");
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.tyrepulse.app").replace(/\/$/, "");

export const ANDROID_PACKAGE = "com.shahzebrahman.tyrepulseinspector";
export const ANDROID_APP_NAME = "Tyre Pulse Inspector";
export const ANDROID_APP_VERSION = "1.6.0";
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * iOS switch. Setting this to the real apps.apple.com listing URL is the ONLY
 * edit required to turn iOS on everywhere: the SoftwareApplication
 * operatingSystem, a MobileApplication entry for the iOS app, and the platform
 * wording in llms.txt and llms-full.txt all branch on it.
 *
 * It stays null until that URL is supplied. There is no iOS submit config, no
 * iOS workflow and no App Store reference anywhere in this repository, so
 * claiming an iOS app today would be a fabrication.
 */
export const APP_STORE_URL: string | null = null;
export const IOS_APP_NAME = "Tyre Pulse Inspector";

export const HAS_IOS_APP = APP_STORE_URL !== null;

/** "Web, Android" today, "Web, Android, iOS" the moment APP_STORE_URL is set. */
export const OPERATING_SYSTEMS = HAS_IOS_APP ? "Web, Android, iOS" : "Web, Android";

/** Prose form of the same fact, for the plain-text files. */
export const PLATFORM_SENTENCE = HAS_IOS_APP
  ? "It is available as a web application, an Android app and an iOS app."
  : "It is available as a web application and as an Android app. There is no iOS app.";

export const BRAND_NAME = "Tyre Pulse";
export const BRAND_TAGLINE = "Smarter Wheels. Stronger Fleet.";
export const BRAND_COLOR = "#16a34a";

export const PRODUCT_DESCRIPTION =
  "Tyre Pulse is a commercial tyre, fleet, inspection and workshop intelligence platform. It connects tyre lifecycle, fleet maintenance, workshop control, field inspections, approvals and executive reporting in one system for multi-site and multi-country operations.";

/** The eight capability groups the product page describes. */
export const MODULES: ReadonlyArray<{ name: string; description: string }> = [
  { name: "Tyre and fleet lifecycle", description: "Assets, tyre identity, fitment, pressure, tread, damage, repair, warranty, transfer, replacement and disposal with complete history." },
  { name: "Maintenance and workshop", description: "Preventive plans, job cards, labour and parts, downtime, technician workload, bay utilization and repair quality." },
  { name: "Digital inspections", description: "Role-based inspection flows with photos, readings, defects, drafts, signatures, offline work, approval and corrective action." },
  { name: "Inventory and procurement", description: "Tyre and spare-parts stock with issues, returns, transfers, requests, quotation comparison, purchasing and vendor performance." },
  { name: "Approvals and organization", description: "Approvers resolved by company, country, site, department, role, risk and financial authority, with delegation and audit history." },
  { name: "Reports and executive intelligence", description: "KPI dashboards, scheduled reports, live TV displays, secure links and white-layout PDF, PPTX and Excel outputs." },
  { name: "Access and tenant control", description: "Organizations kept separate, with users restricted by role, location, record, field, device and approval authority." },
  { name: "AI and automation", description: "Concise data-backed findings, root causes and recommended actions, with model, cost, token and background job tracking." },
];

type Json = Record<string, unknown>;

/** JSON-LD is injected as raw text, so the closing angle bracket must never survive verbatim. */
function serialize(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: Json | Json[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialize(data) }} />;
}

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND_NAME,
    alternateName: "TyrePulse",
    slogan: BRAND_TAGLINE,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo.png`,
      width: 360,
      height: 116,
    },
    description: PRODUCT_DESCRIPTION,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        url: `${SITE_URL}/contact`,
        availableLanguage: ["English", "Arabic"],
      },
    ],
  };
}

export function websiteSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BRAND_NAME,
    url: SITE_URL,
    description: PRODUCT_DESCRIPTION,
    inLanguage: ["en", "ar"],
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function softwareApplicationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: BRAND_NAME,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Fleet and tyre management software",
    operatingSystem: OPERATING_SYSTEMS,
    url: APP_URL,
    description: PRODUCT_DESCRIPTION,
    featureList: MODULES.map((m) => m.name),
    inLanguage: ["en", "ar"],
    isAccessibleForFree: false,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function mobileApplicationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": `${SITE_URL}/#android-app`,
    name: ANDROID_APP_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Android",
    softwareVersion: ANDROID_APP_VERSION,
    installUrl: PLAY_STORE_URL,
    downloadUrl: PLAY_STORE_URL,
    url: PLAY_STORE_URL,
    description:
      "The Tyre Pulse field app for Android. Tyre inspections with photos, tread and pressure capture, barcode and QR asset scanning, meter and engine-hour logging, vehicle washing logs, and offline work that syncs when the device is back online.",
    isAccessibleForFree: false,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/**
 * Emitted only when APP_STORE_URL is set. Until then this returns null and the
 * layout drops it, so no iOS claim reaches a crawler.
 */
export function iosApplicationSchema(): Json | null {
  if (!APP_STORE_URL) return null;
  return {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": `${SITE_URL}/#ios-app`,
    name: IOS_APP_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "iOS",
    installUrl: APP_STORE_URL,
    downloadUrl: APP_STORE_URL,
    url: APP_STORE_URL,
    description:
      "The Tyre Pulse field app for iOS. Tyre inspections with photos, tread and pressure capture, asset scanning, meter logging and offline work that syncs when the device is back online.",
    isAccessibleForFree: false,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** The full entity graph for the site, with iOS included only when it is real. */
export function siteSchemaGraph(): Json[] {
  return [
    organizationSchema(),
    websiteSchema(),
    softwareApplicationSchema(),
    mobileApplicationSchema(),
    iosApplicationSchema(),
  ].filter((node): node is Json => node !== null);
}

export function breadcrumbSchema(items: ReadonlyArray<{ name: string; path: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

/** Breadcrumb trail for an inner page: Home then the page itself. */
export function pageBreadcrumb(name: string, path: string): Json {
  return breadcrumbSchema([
    { name: "Home", path: "/" },
    { name, path },
  ]);
}

/**
 * Canonical for every page, plus the en/ar hreflang pair for the two pages that
 * genuinely are translations of each other. Only the home page has an Arabic
 * counterpart, so inner pages deliberately declare no language alternates:
 * pointing /pricing at /ar would claim a translation that does not exist and the
 * pair would not be reciprocal.
 */
export function alternatesFor(path: string) {
  const isHome = path === "/" || path === "/ar";
  return {
    canonical: path || "/",
    ...(isHome
      ? { languages: { en: "/", ar: "/ar", "x-default": "/" } }
      : {}),
  };
}
