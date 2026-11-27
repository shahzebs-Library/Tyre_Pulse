import type { Metadata } from "next";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { PricingModels } from "@/components/PricingContent";
import { QUOTE_TURNAROUND } from "@/lib/pricing";
import { JsonLd, alternatesFor, faqSchema, pageBreadcrumb } from "../schema";
import { PRICING_FAQ as PRICE_FAQ } from "@/lib/faqs";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing: per vehicle, per user or per module bundle",
  description:
    "Tyre Pulse is priced per vehicle, per user or per module bundle. See what affects the price and get a quote on your fleet within one working day.",
  alternates: alternatesFor("/pricing"),
  openGraph: { images: OG_IMAGES,
    title: "Pricing | Tyre Pulse",
    description: "Priced per vehicle, per user or per module bundle, quoted on your fleet within one working day.",
    url: "/pricing",
    type: "website",
  },
};

const plans = [
  ["Solo", "For an owner managing a small fleet", ["Core asset and tyre records", "Inspections", "Basic dashboards", "Standard exports"]],
  ["Team", "For growing site and workshop teams", ["Multiple users and sites", "Approvals", "Maintenance and inventory", "PDF and Excel reports"]],
  ["Professional", "For established fleet operations", ["Advanced analytics", "Scheduled reports", "TV dashboards", "API access, on request"]],
  ["Enterprise", "For large and multi-country groups", ["Custom users and assets", "Single sign-on, on request", "Data migration and integrations", "Support terms agreed on request"]],
];

const INCLUDED = [
  "Android app for the field that works offline",
  "Arabic and English, each country in its own currency",
  "Import from your ERP exports and Excel files",
  "Access by role and country, with site scoping available",
  "Excel and PDF exports on every register",
  "Onboarding on your own asset list",
];

export default function PricingPage() {
  return <PageFrame>
    <JsonLd data={faqSchema(PRICE_FAQ, "/pricing")} />
    <JsonLd data={pageBreadcrumb("Pricing", "/pricing")} />
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Pricing" }]} title="Priced per vehicle, per user or per module bundle." lead={`Pick the model that fits how your fleet is run, or combine them. Send your fleet size and you get a quote within ${QUOTE_TURNAROUND.en}. Our team sets up each customer. There is no self sign-up.`} cta={false} />
    <PricingModels locale="en" />
    <section className="section-pad tight" aria-labelledby="pkg-h"><div className="site-shell">
      <h2 className="sec-h" id="pkg-h">Typical packages.</h2>
      <p className="panel-text">What each size of operation usually starts with. Every package is priced with one of the models above.</p>
      <div className="price-grid">
        {plans.map(([name, text, features], i) => (
          <article className={`price-card tp-priced ${i === 2 ? "featured" : ""}`} key={String(name)} aria-label={i === 2 ? `${name}, most flexible` : String(name)}>
            {i === 2 && <span className="eyebrow">Most flexible</span>}
            <h3 className="h2 price-name">{String(name)}</h3>
            <p className="muted price-for">{String(text)}</p>
            <ul>{(features as string[]).map(f => <li key={f}><Check className="price-check" size={17} strokeWidth={2.4} aria-hidden="true" />{f}</li>)}</ul>
            <Link className={`btn ${i === 2 ? "btn-primary" : "btn-secondary"}`} href="#quote">Get a quote<span className="sr-only"> for the {String(name)} package</span></Link>
          </article>
        ))}
      </div>
    </div></section>
    <section className="section-pad soft-bg" aria-labelledby="incl-h"><div className="site-shell split split-top">
      <div>
        <h2 className="sec-h" id="incl-h">Included in every package.</h2>
        <p className="panel-text">The parts a fleet cannot run without are never an add-on.</p>
      </div>
      <ul className="tick-list incl-list">{INCLUDED.map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}</ul>
    </div></section>
    <section className="section-pad tight" aria-labelledby="price-faq"><div className="site-shell">
      <h2 className="sec-h" id="price-faq">Questions before a quote.</h2>
      <dl className="faq-list">{PRICE_FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
    </div></section>
  </PageFrame>;
}
