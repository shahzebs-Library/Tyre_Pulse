import type { Metadata } from "next";
import { Database, Fingerprint, KeyRound, LockKeyhole, ScrollText, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
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
  [ShieldCheck, "Tenant separation", "Each organization is scoped across database access, APIs, reports, files, background jobs and shared links."],
  [KeyRound, "Role and location control", "Users receive exact permissions by organization, location, role, duration and approval authority."],
  [Fingerprint, "Privileged access", "Platform and company administration stay separate, with MFA, session controls and protected changes."],
  [Database, "Data protection", "Row-level security, safe file policies, controlled exports, backups and recovery planning protect operational data."],
  [ScrollText, "Auditability", "Access, approvals, configuration, support sessions and high-risk actions are recorded for review."],
  [LockKeyhole, "Safe integrations", "API keys, webhooks and external services use scoped access, rate limits, rotation and failure monitoring."],
];

export default function SecurityPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Security", "/security")} />
    <section className="page-hero"><div className="site-shell"><span className="eyebrow">Security by design</span><h1 className="display">Control access without slowing down operations.</h1><p className="lead">Tyre Pulse is designed to separate platform ownership, company administration, locations, roles, financial visibility and approval authority.</p></div></section>
    <section className="page-content"><div className="site-shell">
      <ul className="sec-list">
        {items.map(([Icon, title, text]) => { const C = Icon as typeof ShieldCheck; return <li key={String(title)}><C size={28} strokeWidth={1.6} aria-hidden="true" /><div><h2>{String(title)}</h2><p>{String(text)}</p></div></li>; })}
      </ul>
    </div></section>
    <CTA />
  </PageFrame>;
}
