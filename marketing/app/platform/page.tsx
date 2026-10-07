import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Box, CheckCircle2, CircleDot, ClipboardCheck, FileCheck2, Fuel, Plug, ShieldAlert, Truck, Wrench,
} from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { ProofStrip } from "@/components/ProofStrip";
import { TourBand } from "@/components/TourBand";
import { AssetsWindow } from "@/components/mock/Screens";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "PMV management platform",
  description:
    "PMV management platform: fleet and assets, maintenance, inspections, tyres, accidents, stores, fuel, costs and approvals in one connected system.",
  alternates: alternatesFor("/platform"),
  openGraph: { images: OG_IMAGES, title: "Platform | Tyre Pulse", description: "One record per machine, shared by the field, workshop, stores and finance.", url: "/platform", type: "website" },
};

const SIDE = [
  [Truck, "Fleet and assets", "/platform/fleet-assets"],
  [Wrench, "Maintenance and workshop", "/platform/maintenance"],
  [ClipboardCheck, "Inspections and safety", "/platform/inspections"],
  [CircleDot, "Tyre lifecycle", "/platform/inspections#tyres"],
  [Box, "Stores and procurement", "/platform/inventory"],
  [BarChart3, "Costs and reporting", "/platform/inventory"],
] as const;

const ECO = [
  [Truck, "Fleet and assets", "Complete asset records, lifecycle, meters and utilisation.", "/platform/fleet-assets"],
  [Wrench, "Maintenance and workshop", "Plan, schedule and manage maintenance and repairs.", "/platform/maintenance"],
  [ClipboardCheck, "Inspections and safety", "Digitise inspections, capture defects and track actions.", "/platform/inspections"],
  [CircleDot, "Tyre lifecycle", "Track tyre inspections, fitments, rotations and costs.", "/platform/inspections#tyres"],
  [ShieldAlert, "Accidents and insurance", "Record incidents, manage claims and track recoveries.", null],
  [Box, "Stores and procurement", "Control inventory, purchases and suppliers.", "/platform/inventory"],
  [Fuel, "Fuel", "Monitor fuel use, efficiency and refuelling activity.", null],
  [BarChart3, "Costs and reporting", "Track operating costs and analyse performance.", "/platform/inventory"],
  [FileCheck2, "Approvals", "Route purchases, costs and work orders for approval.", null],
  [Plug, "Integrations and API", "Connect with your ERP and existing systems.", null],
] as const;

export default function PlatformPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("Platform", "/platform")} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { label: "Platform" }]}
        title="A complete PMV management platform."
        lead="Mixers, pumps, loaders and generators: one record per machine, shared by the field, workshop, stores and finance."
      />
      <section className="section-pad tight-sm">
        <div className="site-shell overview">
          <ul className="ov-nav" aria-label="Platform areas">
            {SIDE.map(([Icon, label, href], i) => (
              <li key={label}><Link href={href} className={i === 0 ? "on" : undefined}><Icon size={18} aria-hidden="true" />{label}</Link></li>
            ))}
          </ul>
          <div className="ov-main">
            <div>
              <h2>Fleet and asset management</h2>
              <p>Track all your plant, machinery and vehicles. Keep asset data, history, documents and costs in one place.</p>
              <ul className="tick-list">
                {["Meter readings and utilisation, kept current", "Service history, costs and documents per machine", "Site, ownership and cost centre on every record"].map((t) => (
                  <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>
                ))}
              </ul>
              <Link className="btn-text" href="/platform/fleet-assets">Explore fleet and assets <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <AssetsWindow />
          </div>
        </div>
      </section>
      <section className="section-pad tight-sm" aria-labelledby="eco">
        <div className="site-shell">
          <h2 className="sec-h" id="eco">Every area, on the same asset record.</h2>
          <ul className="eco-grid">
            {ECO.map(([Icon, t, d, href]) => (
              <li key={t}>
                <Icon size={30} strokeWidth={1.6} aria-hidden="true" />
                <h3>{t}</h3>
                <p>{d}</p>
                {href
                  ? <Link href={href} aria-label={`Learn more about ${t.toLowerCase()}`}>Learn more <ArrowRight size={14} aria-hidden="true" /></Link>
                  : <Link href="/contact" aria-label={`Ask about ${t.toLowerCase()} in a demo`}>Ask in a demo <ArrowRight size={14} aria-hidden="true" /></Link>}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <TourBand id="tours" title="Six workflows, played step by step." />
      <ProofStrip id="platform-proof" title="Running a concrete fleet in production today." text="The same platform, the same modules, on one operation across three countries." />
      <CtaBand title="See your own fleet in Tyre Pulse." text="Bring an asset list and a month of job cards. We load them before the call." button="Book a demo on your data" />
    </PageFrame>
  );
}
