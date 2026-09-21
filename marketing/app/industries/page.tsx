import type { Metadata } from "next";
import { Building2, Bus, Factory, HardHat, Truck, Wrench } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { CTA } from "@/components/CTA";

export const metadata: Metadata = {
  title: "Industries",
  description:
    "Tyre Pulse for construction fleets, transport and logistics, ready-mix concrete, heavy equipment rental, workshop networks, and government and enterprise fleets.",
  alternates: alternatesFor("/industries"),
  openGraph: {
    title: "Industries | Tyre Pulse",
    description: "One core platform, configured to the locations, asset types, approvals, KPIs and reports each business model needs.",
    url: "/industries",
    type: "website",
  },
};

const industries = [
  [HardHat, "Construction fleets", "Control heavy vehicles and equipment across projects, remote sites, workshops and country operations."],
  [Truck, "Transport and logistics", "Track tyre life, maintenance, inspections, availability and operational cost across high-mileage fleets."],
  [Factory, "Ready-mix concrete", "Monitor mixers, pumps and support vehicles where load, off-road conditions, downtime and tyre failure matter."],
  [Building2, "Heavy equipment rental", "Manage customer assignments, operating hours, inspections, transfers, repair responsibility and asset readiness."],
  [Wrench, "Workshop networks", "Control open jobs, bays, technicians, parts delays, repair quality and customer reporting across locations."],
  [Bus, "Government and enterprise", "Apply strict access, approvals, audit history, multi-country structure, reports and integration controls."],
];

export default function IndustriesPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Industries", "/industries")} />
    <section className="page-hero" id="main-content" tabIndex={-1}><div className="site-shell"><span className="eyebrow">Industry workflows</span><h1 className="display">Configured for the way your operation works.</h1><p className="lead">Use one core platform while adapting locations, asset types, approvals, KPIs and reports to each business model.</p></div></section>
    <section className="page-content"><div className="site-shell grid-3">
      {industries.map(([Icon, title, text]) => { const C = Icon as typeof Truck; return <article className="card feature-card" key={String(title)}><div className="icon-box"><C /></div><h2 className="h3">{String(title)}</h2><p>{String(text)}</p></article>; })}
    </div></section>
    <CTA />
  </PageFrame>;
}
