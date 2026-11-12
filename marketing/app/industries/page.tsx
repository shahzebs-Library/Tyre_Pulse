import type { Metadata } from "next";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { CTA } from "@/components/CTA";
import { ProofStrip } from "@/components/ProofStrip";
import { TourBand } from "@/components/TourBand";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Industries: ready-mix, construction and transport",
  description:
    "Tyre Pulse for ready-mix concrete, construction, heavy equipment, transport and logistics, buses, workshop networks and multi-site operations.",
  alternates: alternatesFor("/industries"),
  openGraph: { images: OG_IMAGES,
    title: "Industries | Tyre Pulse",
    description: "One core platform, configured to the locations, asset types, approvals, KPIs and reports each business model needs.",
    url: "/industries",
    type: "website",
  },
};

/*
 * Ready-mix first: it is the operation Tyre Pulse runs in production today.
 * Every photo is our own and each is used once on this page; entries without a
 * photo of their own are plain cards rather than repeating one.
 */
const INDUSTRIES: CardProps[] = [
  { photo: { name: "mixer" }, title: "Ready-mix concrete", text: "Transit mixers, pumps and batching plants, where load, site access, downtime and tyre failure decide the day.", note: "In production today", href: "/solutions/ready-mix-fleet", linkLabel: "Read the use case" },
  { photo: { name: "loaderSite" }, title: "Construction fleets", text: "Heavy vehicles and equipment across projects and remote sites, measured by engine hour where there is no odometer." },
  { photo: { name: "loader", position: "30% 60%" }, title: "Heavy equipment", text: "Loaders, excavators and generators with service by hours, off-road tyre sizes and their own inspection checklists." },
  { title: "Workshop networks", text: "Open jobs, technicians, parts delays and repair quality across more than one workshop." },
  { title: "Transport and logistics", text: "High-mileage trucks and trailers: tyre life, cost per km, inspections and availability by depot." },
  { title: "Buses and commercial vehicles", text: "Daily pre-trip checks, tyre condition by wheel position and service by kilometres or date.", note: "Configured on request" },
  { title: "Multi-site and multi-country operations", text: "Each site and country sees its own records in its own currency, and the head office sees them all." },
  { title: "Heavy equipment rental", text: "Customer assignments, operating hours and handover inspections.", note: "Configured on request" },
  { title: "Government and enterprise fleets", text: "Strict access by location, approval limits and a full audit history.", note: "Configured on request" },
];

export default function IndustriesPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Industries", "/industries")} />
    <PageTop photo="fleetLineup" crumbs={[{ href: "/", label: "Home" }, { label: "Industries" }]} title="Configured for the way your operation works." lead="Built inside a ready-mix concrete operation running mixers, pumps and batching plants across Saudi Arabia, the UAE and Egypt. The same platform is configured for each model below." />
    <section className="section-pad tight" aria-label="Industries"><div className="site-shell">
      <CardGrid cols={3}>
        {INDUSTRIES.map((c) => <Card key={c.title} titleAs="h2" {...c} />)}
      </CardGrid>
      <p className="ar-en-note">&quot;Configured on request&quot; means the platform is set up for that model with you. It is not running there today.</p>
    </div></section>
    <ProofStrip id="ind-proof" title="Proven first in ready-mix concrete." text="Mixers, pumps and batching plants across three countries run on Tyre Pulse every day." />
    <TourBand id="ind-tours" title="The workflows every model shares." only={["inspection", "workshop", "cost"]} />
    <CTA />
  </PageFrame>;
}
