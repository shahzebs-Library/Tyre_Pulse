import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, WifiOff } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { ConditionCard, DefectCard, MeterCard, OfflineInspectionPhone, SignOffCard } from "@/components/mock/Screens";
import { Photo } from "@/components/art/Photos";
import { Walkthrough } from "@/components/motion/walkthrough/Walkthrough";
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
      <PageTop photo="technicianPhone" photoPosition="50% 30%"
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Inspections and safety" }]}
        title="Field inspections and safety"
        lead="Catch tyre and safety defects on the daily walk-round, and turn each one into a tracked action."
      />
      <section className="section-pad tight">
        <div className="site-shell">
          <SubNav items={[["#daily", "Daily checks"], ["#tyres", "Tyres"], ["#defects", "Defects"], ["#actions", "Conditions"], ["#history", "Sign-off"]]} />
          <div id="daily" className="anchor-sec insp-hero">
            <OfflineInspectionPhone withConditions />
            <div id="forms" className="anchor-sec">
              <h2 className="sec-h">Daily walk-round checks on the phone, offline.</h2>
              <p className="panel-text">Photos, meter readings and conditions save on the phone and sync when the signal returns.</p>
              <ul className="tick-list">
                {["Checklists configured by asset type", "Defects raise actions and work orders", "Signed off by the supervisor on the phone"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
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
      <section className="bright-band" aria-labelledby="demo-h">
        <div className="site-shell">
          <h2 className="sec-h" id="demo-h">Watch an inspection and a tyre alert become work orders.</h2>
          <Walkthrough only={["inspection", "tyres"]} />
        </div>
      </section>
      <section className="section-pad soft-bg anchor-sec" id="tyres" aria-labelledby="tyres-h">
        <div className="site-shell split">
          <div>
            <h2 className="sec-h" id="tyres-h">Every tyre, from fitment to scrap.</h2>
            <ul className="tick-list">
              {["Fitment by serial, wheel position and odometer", "Removals and scraps with the reason and who recorded it", "Cost per kilometre or per engine hour, by brand and size"].map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
          <Photo name="fleetLineup" className="art art-frame" fit="contain" />
        </div>
      </section>
      <CtaBand title="Put your tyre men's checklist on their phone." text="We set up your vehicle types and wheel positions before the demo." button="Book a demo on your data" />
    </PageFrame>
  );
}
