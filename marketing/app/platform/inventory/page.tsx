import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
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
        lead="Control your inventory, manage procurement and get clear visibility of costs and performance across your fleet."
      />
      <section className="section-pad" style={{ paddingTop: 0 }}>
        <div className="site-shell">
          <SubNav items={[["#inventory", "Inventory and parts"], ["#purchasing", "Purchase requests"], ["#suppliers", "Suppliers"], ["#costs", "Costs and reporting"], ["#dashboards", "Dashboards"]]} />
          <div id="inventory" className="anchor-sec"><InventoryTable /></div>
          <div className="split" style={{ marginTop: 16, alignItems: "start", gap: 16 }}>
            <div id="purchasing" className="anchor-sec">
              <PurchaseRequest />
              <div id="suppliers" className="anchor-sec panel" style={{ marginTop: 16 }}>
                <div className="panel-head"><strong>Suppliers</strong></div>
                <p style={{ margin: 0, color: "#3b3b35" }}>Keep supplier details, price history and delivery performance next to every purchase, so the next request goes to the supplier that actually delivered.</p>
              </div>
            </div>
            <div id="costs" className="anchor-sec"><div id="dashboards" className="anchor-sec"><FleetCostPanel /></div></div>
          </div>
        </div>
      </section>
      <CtaBand title="Control costs. Keep your fleet moving." text="See how Tyre Pulse can help you manage inventory and procurement." />
    </PageFrame>
  );
}
