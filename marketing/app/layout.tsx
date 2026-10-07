import type { Metadata } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import "./pmv.css";
import "./motion.css";

/*
 * Both families ship as variable fonts, so listing fewer weights does not shrink the download:
 * Archivo 700 and 800 resolve to the SAME woff2 file, and Inter is one variable file that covers
 * every body weight in use (400 to 850). Measured on the build output, 2026-10-07.
 */
const display = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { LocaleSync } from "@/components/LocaleSync";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { BRAND_COLOR, JsonLd, SITE_URL, alternatesFor, siteSchemaGraph } from "./schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Tyre Pulse | PMV assets, workshop, inspections and stores",
    template: "%s | Tyre Pulse",
  },
  description:
    "Tyre Pulse connects plant, machinery and vehicle assets with the workshop, field teams and stores in one operational workspace. Available on web and Android.",
  applicationName: "Tyre Pulse",
  keywords: [
    "PMV management software",
    "plant and machinery management",
    "fleet management software Saudi Arabia",
    "tyre management software",
    "fleet maintenance software",
    "workshop management system",
    "fleet inspection app",
    "tyre cost per kilometre",
    "construction fleet software",
  ],
  authors: [{ name: "Tyre Pulse", url: SITE_URL }],
  creator: "Tyre Pulse",
  publisher: "Tyre Pulse",
  alternates: alternatesFor("/"),
  openGraph: { images: OG_IMAGES,
    siteName: "Tyre Pulse",
    title: "Tyre Pulse | Complete control of your PMV operations",
    description:
      "Assets, workshop, inspections and stores for plant, machinery and vehicles in one workspace.",
    type: "website",
    url: SITE_URL,
    locale: "en_US",
    alternateLocale: "ar_SA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tyre Pulse | Complete control of your PMV operations",
    description:
      "Assets, workshop, inspections and stores for plant, machinery and vehicles in one workspace.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  category: "business software",
};

export const viewport = {
  themeColor: BRAND_COLOR,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <JsonLd data={siteSchemaGraph()} />
        <LocaleSync />
        {children}
        <WhatsAppButton />
        <MotionRoot />
      </body>
    </html>
  );
}
