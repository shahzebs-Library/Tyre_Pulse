import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";

export const metadata: Metadata = { title: "Pricing", description: "Tyre Pulse plans for solo fleet owners, teams, professional operators and enterprises." };

const plans = [
  ["Solo", "For an owner managing a small fleet", ["Core asset and tyre records", "Inspections", "Basic dashboards", "Standard exports"]],
  ["Team", "For growing site and workshop teams", ["Multiple users and sites", "Approvals", "Maintenance and inventory", "PDF and Excel reports"]],
  ["Professional", "For established fleet operations", ["Advanced analytics", "Scheduled reports", "TV dashboards", "API and automation options"]],
  ["Enterprise", "For large and multi-country groups", ["Custom users and assets", "SSO and security controls", "Data migration and integrations", "SLA and priority support"]],
];

export default function PricingPage() {
  return <PageFrame>
    <section className="page-hero"><div className="site-shell"><span className="eyebrow">Commercial plans</span><h1 className="display">Start with the control you need. Expand when you are ready.</h1><p className="lead">Pricing is based on fleet size, users, modules, countries and integration requirements. We do not publish invented one-size-fits-all savings.</p></div></section>
    <section className="page-content"><div className="site-shell price-grid">
      {plans.map(([name, text, features], i) => <article className={`card price-card ${i === 2 ? "featured" : ""}`} key={String(name)}><span className="eyebrow">{i === 2 ? "Most flexible" : "Plan"}</span><h2 className="h2" style={{ fontSize: "2rem" }}>{String(name)}</h2><p className="muted">{String(text)}</p><ul>{(features as string[]).map(f => <li key={f}><CheckCircle2 size={17} color="#0b9b6c" style={{ verticalAlign: "middle", marginRight: 8 }} />{f}</li>)}</ul><Link className={`btn ${i === 2 ? "btn-primary" : "btn-secondary"}`} href="/contact">Request pricing</Link></article>)}
    </div></section>
  </PageFrame>;
}
