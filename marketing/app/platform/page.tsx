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
import { AssetsWindow, ConditionCard, FleetCostPanel, InventoryTable, OfflineInspectionPhone, WorkOrdersTable } from "@/components/mock/Screens";
import { Tabs } from "@/components/Tabs";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: "PMV management platform",
  description:
    "PMV management platform: fleet and assets, maintenance, inspections, tyres, accidents, stores, fuel, costs and approvals in one connected system.",
  alternates: alternatesFor("/platform"),
  openGraph: { images: OG_IMAGES, title: "Platform | Tyre Pulse", description: "One record per machine, shared by the field, workshop, stores and finance.", url: "/platform", type: "website" },
};

/* Each area opens in place, with the screen that belongs to it. */
const AREAS = [
  { id: "fleet", icon: Truck, label: "Fleet and assets", title: "Fleet and asset management", text: "Track all your plant, machinery and vehicles. Keep asset data, history, documents and costs in one place.",
    points: ["Meter readings and utilisation, kept current", "Service history, costs and documents per machine", "Site, ownership and cost centre on every record"], href: "/platform/fleet-assets", cta: "Explore fleet and assets", screen: <AssetsWindow /> },
  { id: "maint", icon: Wrench, label: "Maintenance and workshop", title: "Maintenance and workshop", text: "Breakdowns and preventive work land in one queue, with technicians, parts and outside repairs on each job card.",
    points: ["Work orders by priority, site and status", "Preventive plans by hours, kilometres or date", "Labour, parts and outside services on the job"], href: "/platform/maintenance", cta: "Explore maintenance", screen: <WorkOrdersTable /> },
  { id: "insp", icon: ClipboardCheck, label: "Inspections and safety", title: "Inspections and safety", text: "Daily walk-round checks on the phone, offline, with photos, meter readings and a supervisor signature.",
    points: ["Checklists configured by asset type", "Defects raise actions and work orders", "Signed off on the phone"], href: "/platform/inspections", cta: "Explore inspections", screen: <OfflineInspectionPhone withConditions /> },
  { id: "tyres", icon: CircleDot, label: "Tyre lifecycle", title: "Tyre lifecycle", text: "Every tyre from fitment to scrap, by serial and wheel position, with its cost per kilometre or engine hour.",
    points: ["Fitment and removal by serial and position", "Scrap reasons recorded with who and when", "Cost per km or hour by brand and size"], href: "/platform/inspections#tyres", cta: "Explore tyres", screen: <ConditionCard /> },
  { id: "stores", icon: Box, label: "Stores and procurement", title: "Stores and procurement", text: "Parts are issued against the job card and the machine, and purchase requests are approved before an order is placed.",
    points: ["Stock and reorder level by site", "Parts issued against the job and asset", "Purchase requests with approval"], href: "/platform/inventory", cta: "Explore stores", screen: <InventoryTable /> },
  { id: "costs", icon: BarChart3, label: "Costs and reporting", title: "Costs and reporting", text: "Tyres, parts, oil and repairs roll up by machine, site and month, each country in its own currency.",
    points: ["Cost by asset, site and category", "Availability and downtime", "Scheduled reports and exports"], href: "/platform/inventory#costs", cta: "Explore costs", screen: <FleetCostPanel /> },
];

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
      <PageTop photo="fleetLineup"
        crumbs={[{ href: "/", label: "Home" }, { label: "Platform" }]}
        title="A complete PMV management platform."
        lead="Mixers, pumps, loaders and generators: one record per machine, shared by the field, workshop, stores and finance."
      />
      {/* The tab panels carry h3 titles, so this section needs an h2 between them and the page h1.
          It is visually hidden so the layout stays exactly as designed. */}
      <section className="section-pad tight-sm" aria-labelledby="platform-areas">
        <div className="site-shell">
          <h2 className="sr-only" id="platform-areas">Platform areas</h2>
          <Tabs
            label="Platform areas"
            className="ov-nav"
            wrapClass="overview overview-tabs"
            autoplay={6500}
            items={AREAS.map(({ id, icon: Icon, label, title, text, points, href, cta, screen }) => ({
              id, label, icon: <Icon size={18} aria-hidden="true" />,
              panel: (
                <div className="ov-main">
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                    <ul className="tick-list">{points.map((t) => <li key={t}><CheckCircle2 size={18} aria-hidden="true" />{t}</li>)}</ul>
                    <Link className="btn-text" href={href}>{cta} <ArrowRight size={16} aria-hidden="true" /></Link>
                  </div>
                  {screen}
                </div>
              ),
            }))}
          />
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
