import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { PartsLabour, TechAllocation, WorkOrderDetails, WorkOrdersTable } from "@/components/mock/Screens";
import { TipperScene } from "@/components/art/Machines";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../../schema";

export const metadata: Metadata = {
  title: "Maintenance and workshop",
  description: "Plan, schedule and manage all maintenance: work orders, preventive maintenance, job cards, technician allocation, service history and parts and labour.",
  alternates: alternatesFor("/platform/maintenance"),
  openGraph: { title: "Maintenance and workshop | Tyre Pulse", description: "Keep your workshop, teams and spare parts in sync.", url: "/platform/maintenance", type: "website" },
};

export default function MaintenancePage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Maintenance and workshop", "/platform/maintenance")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Maintenance and workshop" }]}
        title="Maintenance and workshop"
        lead="Plan, schedule and manage all maintenance activities. Keep your workshop, teams and spare parts in sync."
      />
      <section className="section-pad" style={{ paddingTop: 0 }}>
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
              {["Service plans by engine hours, kilometres or calendar", "Due and overdue work surfaced before it becomes a breakdown", "Recording a service advances the next due date automatically", "Compliance by site, asset type and plan"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
          <TipperScene className="art" />
        </div>
      </section>
      <CtaBand title="Streamline your maintenance operations." text="See how Tyre Pulse can support your workshop and field teams." />
    </PageFrame>
  );
}
