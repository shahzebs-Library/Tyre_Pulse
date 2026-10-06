import type { Metadata } from "next";
import { Database, Fingerprint, KeyRound, LockKeyhole, ScrollText, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
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
  [ShieldCheck, "Tenant separation", "A KSA site manager sees KSA rows only. The database enforces it, not a hidden button."],
  [KeyRound, "Role and location control", "Users receive exact permissions by organization, location, role, duration and approval authority."],
  [Fingerprint, "Privileged access", "Platform and company administration stay separate, with MFA, session controls and protected changes."],
  [Database, "Data protection", "Row-level security, safe file policies, controlled exports, backups and recovery planning protect operational data."],
  [ScrollText, "Auditability", "Access, approvals, configuration, support sessions and high-risk actions are recorded for review."],
  [LockKeyhole, "Safe integrations", "API keys, webhooks and external services use scoped access, rate limits, rotation and failure monitoring."],
];

export default function SecurityPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Security", "/security")} />
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Security" }]} title="Control access without slowing down operations." lead="Platform ownership, company administration, locations, roles, financial visibility and approval authority are kept separate, and the database enforces it." />
    <section className="section-pad tight"><div className="site-shell">
      <ul className="sec-list">
        {items.map(([Icon, title, text]) => { const C = Icon as typeof ShieldCheck; return <li key={String(title)}><C size={28} strokeWidth={1.6} aria-hidden="true" /><div><h2>{String(title)}</h2><p>{String(text)}</p></div></li>; })}
      </ul>
    </div></section>
    <CTA />
  </PageFrame>;
}
