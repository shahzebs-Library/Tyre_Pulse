import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, WifiOff } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { ConditionCard, DefectCard, MeterCard, OfflineInspectionPhone, SignOffCard } from "@/components/mock/Screens";
import { Photo } from "@/components/art/Photos";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Field inspections and safety",
  description: "Digitise inspections on the phone: configurable checklists, photos and defects, meter readings, actions and work orders, offline mode and digital signatures.",
  alternates: alternatesFor("/platform/inspections"),
  openGraph: { images: OG_IMAGES, title: "Field inspections and safety | Tyre Pulse", description: "Inspect anything, anywhere, even offline.", url: "/platform/inspections", type: "website" },
};

export default function InspectionsPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Field inspections and safety", "/platform/inspections")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Inspections and safety" }]}
        title="Field inspections and safety"
        lead="Digitise your inspections, capture defects, add photos and track actions. Keep your assets and people safe and compliant."
      />
      <section className="section-pad" style={{ paddingTop: 0 }}>
        <div className="site-shell">
          <SubNav items={[["#daily", "Daily inspections"], ["#forms", "Safety forms"], ["#defects", "Defect management"], ["#actions", "Actions and approvals"], ["#history", "Inspection history"]]} />
          <div id="daily" className="anchor-sec insp-hero">
            <OfflineInspectionPhone withConditions />
            <div id="forms" className="anchor-sec">
              <h2 className="sec-h">Inspect anything. Anywhere.</h2>
              <p style={{ color: "#3b3b35", marginTop: 0 }}>Use the mobile app to complete inspections offline, capture photos, record meter readings and conditions, and raise actions, even without a network connection.</p>
              <ul className="tick-list">
                {["Configurable inspection templates", "Capture photos and defect details", "Record meter readings and condition", "Create actions and work orders", "Offline mode with automatic sync", "Digital signatures"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
              </ul>
              <Link className="btn-text" href="/contact">Book a demo <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <div className="art-box">
              <Photo name="engineer" position="35% 15%" />
              <span className="badge-float"><WifiOff size={14} aria-hidden="true" />Works offline</span>
            </div>
          </div>
          <div className="grid-4p">
            <div id="defects" className="anchor-sec"><DefectCard /></div>
            <MeterCard />
            <div id="actions" className="anchor-sec"><ConditionCard /></div>
            <div id="history" className="anchor-sec"><SignOffCard /></div>
          </div>
        </div>
      </section>
      <CtaBand title="Improve safety and asset availability." text="Digitise your inspections with Tyre Pulse." />
    </PageFrame>
  );
}
