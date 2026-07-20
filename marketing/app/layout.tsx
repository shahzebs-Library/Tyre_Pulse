import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.tyrepulse.app"),
  title: {
    default: "Tyre Pulse | Tyre, Fleet and Workshop Intelligence",
    template: "%s | Tyre Pulse",
  },
  description: "Tyre Pulse helps fleet, tyre and workshop teams control costs, inspections, maintenance, approvals and executive reporting from one platform.",
  keywords: [
    "tyre management software",
    "fleet maintenance software",
    "workshop management system",
    "fleet inspection app",
    "tyre cost per kilometre",
    "construction fleet software",
  ],
  openGraph: {
    title: "Tyre Pulse | Smarter Wheels. Stronger Fleet.",
    description: "A commercial tyre, fleet, inspection and workshop intelligence platform for modern operations.",
    type: "website",
    locale: "en_US",
    alternateLocale: "ar_SA",
    images: [{ url: "/screenshots/executive-report.png", width: 1600, height: 900 }],
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Tyre Pulse",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Android",
    description: "Tyre, fleet, inspection, maintenance and workshop intelligence platform.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Pricing available on request" },
  };

  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
        {children}
      </body>
    </html>
  );
}
