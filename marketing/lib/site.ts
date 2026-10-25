/** The live application host (marketing and application are separate Vercel projects). */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.tyrepulse.app").replace(/\/$/, "");

/**
 * Sales WhatsApp number in international format, digits only. Supplied by the
 * owner 2026-09-28 (+971 56 672 6276). It drives the floating button on every
 * page, the contact page link and the WhatsApp ContactPoint in the structured
 * data; an empty value turns all three off.
 * Can also be set without a code change via NEXT_PUBLIC_WHATSAPP_NUMBER.
 */
export const WHATSAPP_NUMBER: string | null =
  (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "971566726276").replace(/\D/g, "") || null;

export const WHATSAPP_URL = WHATSAPP_NUMBER
  ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hello Tyre Pulse, I would like a demo.")}`
  : null;

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
