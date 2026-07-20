import type { Metadata } from "next";
import { Database, Fingerprint, KeyRound, LockKeyhole, ScrollText, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { CTA } from "@/components/CTA";

export const metadata: Metadata = { title: "Security", description: "Tyre Pulse access, tenant isolation, audit, authentication and data protection controls." };

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
    <section className="page-hero"><div className="site-shell"><span className="eyebrow">Security by design</span><h1 className="display">Control access without slowing down operations.</h1><p className="lead">Tyre Pulse is designed to separate platform ownership, company administration, locations, roles, financial visibility and approval authority.</p></div></section>
    <section className="page-content"><div className="site-shell grid-3">
      {items.map(([Icon, title, text]) => { const C = Icon as typeof ShieldCheck; return <article className="card feature-card" key={String(title)}><div className="icon-box"><C /></div><h2 className="h3">{String(title)}</h2><p>{String(text)}</p></article>; })}
    </div></section>
    <CTA />
  </PageFrame>;
}
