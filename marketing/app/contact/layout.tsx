import type { Metadata } from "next";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";

/**
 * The contact page itself is a client component, so its metadata lives here.
 */
export const metadata: Metadata = {
  title: "Contact",
  description:
    "Book a tailored Tyre Pulse demo. Tell us how many assets, countries, sites and users you manage and the walkthrough will cover the workflows and controls that matter to your operation.",
  alternates: alternatesFor("/contact"),
  openGraph: {
    title: "Contact | Tyre Pulse",
    description: "Book a demo built around your real operation, not a generic product tour.",
    url: "/contact",
    type: "website",
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={pageBreadcrumb("Contact", "/contact")} />
      {children}
    </>
  );
}
