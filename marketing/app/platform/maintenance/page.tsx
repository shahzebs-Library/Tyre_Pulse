import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { TourBand } from "@/components/TourBand";
import { PartsLabour, TechAllocation, WorkOrderDetails, WorkOrdersTable } from "@/components/mock/Screens";
import { Photo } from "@/components/art/Photos";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Maintenance and workshop",
  description: "Plan, schedule and manage all maintenance: work orders, preventive maintenance, job cards, technician allocation, service history and parts and labour.",
  alternates: alternatesFor("/platform/maintenance"),
  openGraph: { images: OG_IMAGES, title: "Maintenance and workshop | Tyre Pulse", description: "Keep your workshop, teams and spare parts in sync.", url: "/platform/maintenance", type: "website" },
};

export default function MaintenancePage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Maintenance and workshop", "/platform/maintenance")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Maintenance and workshop" }]}
        title="Maintenance and workshop"
        lead="Get breakdowns back on site sooner. Job cards, technicians, parts and outside repairs run from one queue."
      />
      <section className="section-pad tight">
        <div className="site-shell">
          <SubNav items={[["#work-orders", "Work orders"], ["#preventive", "Preventive maintenance"], ["#job-cards", "Job cards"], ["#technicians", "Technicians"], ["#parts", "Parts and labour"]]} />
          <div id="work-orders" className="anchor-sec"><WorkOrdersTable /></div>
          <div className="grid-3p">
            <div id="job-cards" className="anchor-sec"><WorkOrderDetails /></div>
            <div id="technicians" className="anchor-sec"><TechAllocation /></div>
            <div id="parts" className="anchor-sec"><PartsLabour /></div>
          </div>
        </div>
      </section>
      <section className="section-pad soft-bg anchor-sec" id="preventive" aria-labelledby="pm-h">
        <div className="site-shell split">
          <div>
            <h2 className="sec-h" id="pm-h">Preventive maintenance that follows the meter.</h2>
            <ul className="tick-list">
              {["Service plans by engine hours, kilometres or calendar", "Overdue work surfaced before it becomes a breakdown", "Recording a service sets the next due date automatically"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
          <Photo name="technicianGenerator" position="45% 40%" />
        </div>
      </section>
      <TourBand id="workshop-tours" title="A breakdown and a service, from request to sign-off." only={["workshop", "maintenance"]} />
      <CtaBand title="Find the breakdowns your PM plan should have caught." text="Send a month of job cards. We split planned work from breakdowns, machine by machine." button="Book a demo on your data" />
    </PageFrame>
  );
}
