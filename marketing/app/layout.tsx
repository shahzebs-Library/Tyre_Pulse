import type { Metadata } from "next";
import "./globals.css";
import { BRAND_COLOR, JsonLd, SITE_URL, alternatesFor, siteSchemaGraph } from "./schema";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Tyre Pulse | Tyre, Fleet and Workshop Intelligence",
    template: "%s | Tyre Pulse",
  },
  description:
    "Tyre Pulse helps fleet, tyre and workshop teams control costs, inspections, maintenance, approvals and executive reporting from one platform. Available on web and Android.",
  applicationName: "Tyre Pulse",
  keywords: [
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
  icons: {
    icon: "/brand/icon.png",
    apple: "/brand/icon.png",
  },
  openGraph: {
    siteName: "Tyre Pulse",
    title: "Tyre Pulse | Smarter Wheels. Stronger Fleet.",
    description:
      "A commercial tyre, fleet, inspection and workshop intelligence platform for modern operations.",
    type: "website",
    url: SITE_URL,
    locale: "en_US",
    alternateLocale: "ar_SA",
    images: [
      {
        url: "/screenshots/executive-report.png",
        width: 1600,
        height: 900,
        alt: "Tyre Pulse executive intelligence report",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tyre Pulse | Smarter Wheels. Stronger Fleet.",
    description:
      "Tyre lifecycle, fleet maintenance, workshop control, inspections, approvals and executive reporting in one platform.",
    images: ["/screenshots/executive-report.png"],
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
    <html lang="en">
      <body>
        <JsonLd data={siteSchemaGraph()} />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
