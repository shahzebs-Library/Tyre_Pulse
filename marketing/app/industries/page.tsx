import type { Metadata } from "next";
import { Photo } from "@/components/art/Photos";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { CTA } from "@/components/CTA";
import { ProofStrip } from "@/components/ProofStrip";
import { TourBand } from "@/components/TourBand";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Industries",
  description:
    "Tyre Pulse for construction, transport and logistics, ready-mix concrete, equipment rental, workshop networks, and government and enterprise fleets.",
  alternates: alternatesFor("/industries"),
  openGraph: { images: OG_IMAGES,
    title: "Industries | Tyre Pulse",
    description: "One core platform, configured to the locations, asset types, approvals, KPIs and reports each business model needs.",
    url: "/industries",
    type: "website",
  },
};

/* Ready-mix first: it is the operation Tyre Pulse runs in production today. Each photo is our own, not stock. */
const industries = [
  ["mixer", "Ready-mix concrete", "Monitor mixers, pumps and support vehicles where load, off-road conditions, downtime and tyre failure matter."],
  ["loaderSite", "Construction fleets", "Control heavy vehicles and equipment across projects, remote sites, workshops and country operations."],
  ["fleetLineup", "Transport and logistics", "Track tyre life, maintenance, inspections, availability and operational cost across high-mileage fleets."],
  ["riyadh", "Heavy equipment rental", "Configured on request: customer assignments, operating hours and handover inspections."],
  ["technicianGenerator", "Workshop networks", "Control open jobs, bays, technicians, parts delays, repair quality and customer reporting across locations."],
  ["engineer", "Government and enterprise", "Configured on request: strict access by location, approval limits and full audit history."],
] as const;

export default function IndustriesPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Industries", "/industries")} />
    <PageTop crumbs={[{ href: "/", label: "Home" }, { label: "Industries" }]} title="Configured for the way your operation works." lead="Built inside a ready-mix concrete operation running mixers, pumps and batching plants across Saudi Arabia, the UAE and Egypt. The same platform is configured for each model below." />
    <section className="section-pad tight"><div className="site-shell">
      <ul className="ind-list">
        {industries.map(([photo, title, text]) => <li key={title}><div className="ind-media"><Photo name={photo} position={photo === "riyadh" ? "30% 92%" : undefined} sizes="(max-width: 760px) 100vw, 600px" /></div><h2>{title}</h2><p>{text}</p></li>)}
      </ul>
    </div></section>
    <ProofStrip id="ind-proof" title="Proven first in ready-mix concrete." text="Mixers, pumps and batching plants across three countries run on Tyre Pulse every day." />
    <TourBand id="ind-tours" title="The workflows every model shares." only={["inspection", "workshop", "cost"]} />
    <CTA />
  </PageFrame>;
}
