import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { TourBand } from "@/components/TourBand";
import { FleetCostPanel, InventoryTable, PurchaseRequest } from "@/components/mock/Screens";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Inventory, procurement and reporting",
  description: "Control inventory, manage purchase requests and suppliers, and get clear visibility of costs, availability and performance across your fleet.",
  alternates: alternatesFor("/platform/inventory"),
  openGraph: { images: OG_IMAGES, title: "Inventory, procurement and reporting | Tyre Pulse", description: "Control costs. Keep your fleet moving.", url: "/platform/inventory", type: "website" },
};

export default function InventoryPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Inventory, procurement and reporting", "/platform/inventory")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Inventory, procurement and reports" }]}
        title="Inventory, procurement and reporting"
        lead="See which parts each job consumed and what every machine costs to run, by site and by month."
      />
      <section className="section-pad tight">
        <div className="site-shell">
          <SubNav items={[["#inventory", "Inventory and parts"], ["#purchasing", "Purchase requests"], ["#suppliers", "Suppliers"], ["#costs", "Costs and reporting"], ["#dashboards", "Dashboards"]]} />
          <div id="inventory" className="anchor-sec"><InventoryTable /></div>
          <div className="split split-top">
            <div id="purchasing" className="anchor-sec">
              <PurchaseRequest />
              <div id="suppliers" className="anchor-sec panel stack-gap">
                <div className="panel-head"><strong>Suppliers</strong></div>
                <p className="panel-text">Keep supplier details, price history and delivery performance next to every purchase, so the next request goes to the supplier that actually delivered.</p>
              </div>
            </div>
            <div id="costs" className="anchor-sec"><div id="dashboards" className="anchor-sec"><FleetCostPanel /></div></div>
          </div>
        </div>
      </section>
      <TourBand id="cost-tour" title="From store issue to cost per machine." lead="Watch spend split into tyres, spare parts and oil, then traced to the machines and sites behind it. Sample data." only={["cost"]} />
      <CtaBand title="See which parts each job actually consumed." text="Send a month of store issues. We tie them to job cards and machines in the demo." button="Book a demo on your data" />
    </PageFrame>
  );
}
