import type { Metadata } from "next";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import { CTA } from "@/components/CTA";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Tyre Pulse plans for solo owners, teams, professional operators and enterprises. Quoted on request by fleet size, users, modules, countries and integrations.",
  alternates: alternatesFor("/pricing"),
  openGraph: { images: OG_IMAGES,
    title: "Pricing | Tyre Pulse",
    description: "Start with the control you need and expand when you are ready. Pricing is quoted per operation, never a published one-size-fits-all figure.",
    url: "/pricing",
    type: "website",
  },
};

const plans = [
  ["Solo", "For an owner managing a small fleet", ["Core asset and tyre records", "Inspections", "Basic dashboards", "Standard exports"]],
  ["Team", "For growing site and workshop teams", ["Multiple users and sites", "Approvals", "Maintenance and inventory", "PDF and Excel reports"]],
  ["Professional", "For established fleet operations", ["Advanced analytics", "Scheduled reports", "TV dashboards", "API and automation options"]],
  ["Enterprise", "For large and multi-country groups", ["Custom users and assets", "SSO and security controls", "Data migration and integrations", "SLA and priority support"]],
];

const INCLUDED = [
  "Phone app for the field that works offline",
  "Arabic and English, each country in its own currency",
  "Import from your ERP exports and Excel files",
  "Access by company, country, site and role",
  "Excel and PDF exports on every register",
  "Onboarding on your own asset list",
];

const PRICE_FAQ = [
  ["Why is there no published price?", "Fleets differ by machine count, sites, countries and integrations. A quote on your numbers is cheaper than a list price padded to cover everyone."],
  ["Can we start small?", "Yes. Start with one site or one module, such as tyres or inspections, and add the rest when it earns its place."],
  ["What do you need from us to quote?", "Fleet size, number of users, the countries you run in and the systems you want connected. A short message is enough."],
] as const;

export default function PricingPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Pricing", "/pricing")} />
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Pricing" }]} title="Start with the control you need. Expand when you are ready." lead="Pricing is based on fleet size, users, modules, countries and integrations. Send your fleet size and we reply with a figure." cta={false} />
    <section className="section-pad tight"><div className="site-shell">
      <div className="price-grid">
        {plans.map(([name, text, features], i) => (
          <article className={`card price-card ${i === 2 ? "featured" : ""}`} key={String(name)} aria-label={i === 2 ? `${name}, most flexible` : String(name)}>
            {i === 2 && <span className="eyebrow">Most flexible</span>}
            <h2 className="h2 price-name">{String(name)}</h2>
            <p className="muted price-for">{String(text)}</p>
            <ul>{(features as string[]).map(f => <li key={f}><Check className="price-check" size={17} strokeWidth={2.4} aria-hidden="true" />{f}</li>)}</ul>
            <Link className={`btn ${i === 2 ? "btn-primary" : "btn-secondary"}`} href="/contact">Request pricing</Link>
          </article>
        ))}
      </div>
    </div></section>
    <section className="section-pad soft-bg" aria-labelledby="incl-h"><div className="site-shell split split-top">
      <div>
        <h2 className="sec-h" id="incl-h">Included in every plan.</h2>
        <p className="panel-text">The parts a fleet cannot run without are never an add-on.</p>
      </div>
      <ul className="tick-list incl-list">{INCLUDED.map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}</ul>
    </div></section>
    <section className="section-pad tight" aria-labelledby="price-faq"><div className="site-shell">
      <h2 className="sec-h" id="price-faq">Questions before a quote.</h2>
      <dl className="faq-list">{PRICE_FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
    </div></section>
    <CTA />
  </PageFrame>;
}
