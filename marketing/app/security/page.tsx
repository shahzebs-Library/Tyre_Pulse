import type { Metadata } from "next";
import { Database, FileLock2, Fingerprint, KeyRound, LockKeyhole, ScrollText } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { JsonLd, alternatesFor, faqSchema, pageBreadcrumb } from "../schema";
import { SECURITY_FAQ as SEC_FAQ } from "@/lib/faqs";
import { CTA } from "@/components/CTA";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { CapabilityList, FaqList, Section } from "@/components/ui/Section";
import { StatusLegend } from "@/components/ui/StatusBadge";
import { CONTACT_EMAIL, LEGAL_LINKS, OG_IMAGES } from "@/lib/site";

const TITLE = "Security and data protection";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "How Tyre Pulse protects fleet data: country isolation enforced in the database, role-based access, an audit trail and private file storage.",
  alternates: alternatesFor("/security"),
  openGraph: { images: OG_IMAGES,
    title: `${TITLE} | Tyre Pulse`,
    description: "Country data isolation enforced in the database, role-based access, an audit trail and private file storage.",
    url: "/security",
    type: "website",
  },
};

/* Only controls that exist in the product today. Nothing here is a certification. */
const CONTROLS: CardProps[] = [
  { icon: Database, title: "Country isolation in the database", text: "Each user is limited to the countries they are assigned. The database enforces it, so a hidden button is never the only guard. Site scoping is available, and each customer is set up by our team as its own company.", status: "available" },
  { icon: KeyRound, title: "Role-based access", text: "Roles and per-user grants decide which modules a person can open. Create, edit and approve rights are enforced in the database on the core registers, and export is controlled in the app.", status: "available" },
  { icon: Fingerprint, title: "Multi-factor sign-in", text: "A second sign-in factor is available for administrator accounts.", status: "available" },
  { icon: ScrollText, title: "Audit trail", text: "Sign-ins, access changes, approvals and record changes are written to a log that administrators can review.", status: "available" },
  { icon: FileLock2, title: "Private file storage", text: "Inspection photos, signatures and documents are stored privately and opened through links that expire.", status: "available" },
  { icon: LockKeyhole, title: "Encrypted in transit", text: "The web application, the field app and the API are served over HTTPS only.", status: "available" },
];

const LAYERS = [
  ["The database checks every read.", "Row-level rules limit each query to your company and the countries you are assigned. Site scoping is available."],
  ["The app checks every action.", "Roles and per-user grants decide which modules a person can open and who can approve, and money stays in each country's own currency."],
  ["The log keeps the evidence.", "Sign-ins, access changes and approvals are written to an audit trail administrators can review."],
] as const;

const MORE = [
  ["API keys", "Scoped keys for the public API, with rate limits. Set up on request with your first integration.", "on-request"],
  ["Shared report links", "Read-only board links with an optional password and expiry date.", "available"],
  ["Single sign-on", "Connected to your identity provider when you ask for it.", "on-request"],
  ["Customer-specific integrations", "ERP or telematics connections scoped with you before they are built.", "on-request"],
  ["Support and service terms", "Response times and service levels agreed in your contract.", "on-request"],
] as const;

export default function SecurityPage() {
  const privacy = LEGAL_LINKS[0], deletion = LEGAL_LINKS[2];
  return <PageFrame>
    <JsonLd data={faqSchema(SEC_FAQ, "/security")} />
    <JsonLd data={pageBreadcrumb(TITLE, "/security")} />
    <PageTop photo="engineer" photoPosition="35% 20%" crumbs={[{ href: "/", label: "Home" }, { label: TITLE }]} title="Your fleet data stays inside your company and country." lead="Access is decided by role and country, and the database enforces country scope on every query. Site scoping is available. This page lists the controls that are in the product today." />
    <Section id="controls-h" title="Controls in the product today.">
      <CardGrid cols={3}>{CONTROLS.map((c) => <Card key={c.title} {...c} />)}</CardGrid>
    </Section>
    <Section id="layers-h" tone="soft" title="Three checks on every record." lead="A field report, a job card or a claim passes the same three checks, whoever opens it.">
      <ol className="next-steps">{LAYERS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
    </Section>
    <Section id="data-h" title="Your data and how to remove it.">
      <div className="tp-two">
        <div className="tp-prose">
          <p>Your company&apos;s records belong to your company. Registers export to Excel and PDF, so you can take a copy of your data out at any time.</p>
          <p>A user can ask for their account to be deleted from inside the app, or through the <a className="linkish" href={deletion.href}>data deletion page</a>. The <a className="linkish" href={privacy.href}>privacy policy</a> describes what is collected and why.</p>
          <p>For a security questionnaire or a question this page does not answer, write to <a className="linkish" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </div>
        <div>
          <CapabilityList items={MORE} />
          <StatusLegend />
        </div>
      </div>
    </Section>
    <Section id="sec-faq" tone="soft" title="What security teams ask.">
      <FaqList items={SEC_FAQ} />
    </Section>
    <CTA />
  </PageFrame>;
}
