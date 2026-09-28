import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { AssetHistoryTable, AssetRecord, AssetStats, SampleTag } from "@/components/mock/Screens";
import { Photo } from "@/components/art/Photos";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Fleet and asset management",
  description: "Keep complete records for all your plant, machinery and vehicles: meter readings, utilisation, service history, documents, costs and lifecycle in one place.",
  alternates: alternatesFor("/platform/fleet-assets"),
  openGraph: { images: OG_IMAGES, title: "Fleet and asset management | Tyre Pulse", description: "One record per asset, shared by every team.", url: "/platform/fleet-assets", type: "website" },
};

export default function FleetPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Fleet and asset management", "/platform/fleet-assets")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Fleet and assets" }]}
        title="Fleet and asset management"
        lead="Keep complete records for all your plant, machinery and vehicles. Track utilisation, service history, costs and documents in one place."
      />
      <section className="section-pad" style={{ paddingTop: 0 }}>
        <div className="site-shell">
          <SubNav items={[["#records", "Asset records"], ["#utilisation", "Utilisation"], ["#history", "Service history"], ["#documents", "Documents"], ["#lifecycle", "Lifecycle"]]} />
          <div id="records" className="anchor-sec">
            <AssetRecord wide />
            <AssetStats />
          </div>
          <div id="history" className="anchor-sec panel" style={{ marginTop: 20 }}>
            <div className="panel-head"><strong>Asset history</strong><SampleTag /></div>
            <AssetHistoryTable />
          </div>
        </div>
      </section>
      <section className="section-pad soft-bg" id="utilisation" aria-labelledby="util-h">
        <div className="site-shell split">
          <div>
            <h2 className="sec-h" id="util-h">Meters that keep themselves current.</h2>
            <ul className="tick-list">
              {["Hour and kilometre readings from inspections, job cards and telematics", "Readings that go backwards are flagged, never silently accepted", "Utilisation by asset, site and asset type", "Preventive schedules driven by the real meter"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
          <Photo name="fleetLineup" className="art art-frame" fit="contain" />
        </div>
      </section>
      <section className="section-pad anchor-sec" id="documents" aria-labelledby="docs-h">
        <div className="site-shell split">
          <Photo name="mixer" className="art art-dark" fit="contain" />
          <div id="lifecycle" className="anchor-sec">
            <h2 className="sec-h" id="docs-h">Documents and lifecycle in the same record.</h2>
            <ul className="tick-list">
              {["Registration, insurance and operating permits with expiry reminders", "Ownership, cost centre, department and current site", "Transfers between sites and countries with full history", "Acquisition, depreciation and disposal decisions"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>
      <CtaBand title="Keep your assets working harder." text="Get complete visibility across your fleet, on every site." />
    </PageFrame>
  );
}
