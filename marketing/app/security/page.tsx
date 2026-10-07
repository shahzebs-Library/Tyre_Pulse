import type { Metadata } from "next";
import { Database, Fingerprint, KeyRound, LockKeyhole, ScrollText, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { JsonLd, alternatesFor, faqSchema, pageBreadcrumb } from "../schema";
import { SECURITY_FAQ as SEC_FAQ } from "@/lib/faqs";
import { CTA } from "@/components/CTA";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Tyre Pulse tenant separation, role and location control, privileged access, data protection, auditability and safe integration controls.",
  alternates: alternatesFor("/security"),
  openGraph: { images: OG_IMAGES,
    title: "Security | Tyre Pulse",
    description: "Control access without slowing operations, with platform ownership, company administration, locations, roles and approval authority kept separate.",
    url: "/security",
    type: "website",
  },
};

const items = [
  [ShieldCheck, "Tenant separation", "A KSA site manager sees KSA rows only. The database enforces it, not a hidden button."],
  [KeyRound, "Role and location control", "Users receive exact permissions by organization, location, role, duration and approval authority."],
  [Fingerprint, "Privileged access", "Platform and company administration stay separate, with MFA, session controls and protected changes."],
  [Database, "Data protection", "Row-level security, safe file policies, controlled exports, backups and recovery planning protect operational data."],
  [ScrollText, "Auditability", "Access, approvals, configuration, support sessions and high-risk actions are recorded for review."],
  [LockKeyhole, "Safe integrations", "API keys, webhooks and external services use scoped access, rate limits, rotation and failure monitoring."],
];

const LAYERS = [
  ["The database checks every read.", "Row-level security limits each query to your company, then your country and sites. A hidden screen is never the only guard."],
  ["The app checks every action.", "Roles and per-user grants decide who can create, edit, approve or export, and money stays in each country's own currency."],
  ["The log keeps the evidence.", "Sign-ins, access changes, approvals and exports are written to an audit trail administrators can review."],
] as const;

export default function SecurityPage() {
  return <PageFrame>
    <JsonLd data={faqSchema(SEC_FAQ, "/security")} />
    <JsonLd data={pageBreadcrumb("Security", "/security")} />
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Security" }]} title="Control access without slowing down operations." lead="Platform ownership, company administration, locations, roles, financial visibility and approval authority are kept separate, and the database enforces it." />
    <section className="section-pad tight"><div className="site-shell">
      <ul className="sec-list">
        {items.map(([Icon, title, text]) => { const C = Icon as typeof ShieldCheck; return <li key={String(title)}><C size={28} strokeWidth={1.6} aria-hidden="true" /><div><h2>{String(title)}</h2><p>{String(text)}</p></div></li>; })}
      </ul>
    </div></section>
    <section className="section-pad soft-bg" aria-labelledby="layers-h"><div className="site-shell split split-top">
      <div>
        <h2 className="sec-h" id="layers-h">Three checks on every record.</h2>
        <p className="panel-text">A field report, a job card or a claim passes the same three checks, whoever opens it and from wherever.</p>
      </div>
      <ol className="next-steps">{LAYERS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
    </div></section>
    <section className="section-pad tight" aria-labelledby="sec-faq"><div className="site-shell">
      <h2 className="sec-h" id="sec-faq">What security teams ask.</h2>
      <dl className="faq-list">{SEC_FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
    </div></section>
    <CTA />
  </PageFrame>;
}
