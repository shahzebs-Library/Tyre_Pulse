import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Box, Camera, CheckCircle2, CircleDot, ClipboardCheck, CloudUpload, FileSignature,
  Fuel, Gauge, ShieldCheck, Truck, Wrench, ClipboardList, PenLine, Settings, FileCheck2,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CtaBand } from "@/components/CtaBand";
import { Tabs } from "@/components/Tabs";
import { HeroCarousel, type HeroSlide } from "@/components/HeroCarousel";
import { Photo } from "@/components/art/Photos";
import {
  ApprovalCard, AssetRecord, AssetStats, SignOffCard, CompleteCard, FleetCostPanel, NewInspectionCard, OfflineInspectionPhone,
  OpsOverview, PartsCard,
} from "@/components/mock/Screens";
import { alternatesFor } from "./schema";
import { OG_IMAGES } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Tyre Pulse | Complete control of your PMV operations" },
  description:
    "Connect plant, machinery and vehicles with your workshop, field teams and stores. Work orders, inspections, tyres, parts, costs and approvals in one place.",
  alternates: alternatesFor("/"),
  openGraph: { images: OG_IMAGES,
    title: "Tyre Pulse | Complete control of your PMV operations",
    description: "Assets, workshop, field teams and stores in one operational workspace.",
    url: "/",
    type: "website",
  },
};

function TabCopy({ title, text, points, href }: { title: string; text: string; points: string[]; href: string }) {
  return (
    <div className="tab-copy">
      <h3>{title}</h3>
      <p>{text}</p>
      <ul className="tick-list">
        {points.map((p) => <li key={p}><CheckCircle2 size={18} aria-hidden="true" />{p}</li>)}
      </ul>
      <Link className="btn-text" href={href}>See how it works <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  );
}

const STEPS = [
  { icon: ClipboardList, title: "Report and inspect", text: "Log issues, capture photos and record inspection results in the field.", card: <NewInspectionCard /> },
  { icon: FileCheck2, title: "Review and approve", text: "Technically review, add work details and approve the job.", card: <ApprovalCard /> },
  { icon: Wrench, title: "Repair and issue parts", text: "Complete the repair, issue parts from stores and record labour and costs.", card: <PartsCard /> },
  { icon: FileSignature, title: "Verify and release", text: "Confirm work is complete, update records and return the asset to service.", card: <CompleteCard /> },
];

const MODULES = [
  { icon: Truck, title: "Fleet and asset lifecycle", text: "Track plant, machinery and vehicles from acquisition to disposal.", href: "/platform/fleet-assets" },
  { icon: Wrench, title: "Preventive maintenance", text: "Plan and manage maintenance to keep assets working and compliant.", href: "/platform/maintenance" },
  { icon: Settings, title: "Workshop and job cards", text: "Manage jobs, labour, parts and third-party services.", href: "/platform/maintenance" },
  { icon: CircleDot, title: "Tyre lifecycle", text: "Track tyre inspections, fitments, rotations and cost per kilometre or hour.", href: "/platform/inspections#tyres" },
  { icon: ShieldCheck, title: "Accidents and insurance", text: "Record incidents, manage claims and track insurance details.", href: "/contact" },
  { icon: Box, title: "Stores and procurement", text: "Control inventory, purchases and suppliers across all sites.", href: "/platform/inventory" },
  { icon: Fuel, title: "Fuel and operating costs", text: "See operating costs by asset, site or project.", href: "/contact" },
  { icon: BarChart3, title: "Approvals and reporting", text: "Route work orders and purchases to the right approver, with the history kept.", href: "/contact" },
];

const FAQ = [
  ["Our sites have weak signal.", "Inspections, photos, meter readings and signatures save on the phone and sync when the connection returns."],
  ["Our data is in the ERP and in Excel.", "Job cards, expenses, tyre records and asset lists import from the files you already export, with duplicates checked before they land."],
  ["We run more than one country.", "Each country and site sees only its own records, in its own currency, enforced in the database. Arabic and English are both supported."],
] as const;

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "ops", tab: "Operations", kicker: "PMV: plant, machinery and vehicles",
    title: "Know which machines are down, why, and what they cost.",
    lead: "Your workshop, field teams and stores work from one record per machine, so nothing is retyped.",
    link: { href: "/platform", label: "Explore the platform" },
    visual: <OpsOverview />,
  },
  {
    id: "assets", tab: "Fleet and assets", kicker: "Fleet and asset lifecycle",
    title: "Every machine, one complete record.",
    lead: "Meters, tyres, documents, costs and history for each asset, from purchase to disposal.",
    link: { href: "/platform/fleet-assets", label: "See fleet and assets" },
    visual: <div className="hc-photo hc-zoom"><Photo name="fleetLineup" position="50% 60%" sizes="(max-width: 900px) 110vw, 720px" /><div className="hc-float hc-float-wide"><AssetStats /></div></div>,
  },
  {
    id: "workshop", tab: "Workshop", kicker: "Maintenance and workshop",
    title: "Breakdowns back on site, sooner.",
    lead: "Job cards, technicians, parts and outside repairs in one queue your workshop runs from.",
    link: { href: "/platform/maintenance", label: "See maintenance" },
    visual: <div className="hc-photo"><Photo name="technicianGenerator" position="45% 40%" sizes="(max-width: 900px) 100vw, 640px" /><div className="hc-float"><PartsCard /></div></div>,
  },
  {
    id: "inspections", tab: "Inspections", kicker: "Field inspections and safety",
    title: "Inspect in the field, even without signal.",
    lead: "Checklists, photos, meter readings and signatures on the phone. It syncs when the connection returns.",
    link: { href: "/platform/inspections", label: "See inspections" },
    visual: <div className="hc-photo"><Photo name="engineer" position="50% 35%" sizes="(max-width: 900px) 100vw, 640px" /><div className="hc-float"><SignOffCard /></div></div>,
  },
  {
    id: "costs", tab: "Costs", kicker: "Costs and reporting",
    title: "Know what every machine costs to run.",
    lead: "Maintenance, tyres, parts and fuel roll up by asset, site and project from the records your teams enter.",
    link: { href: "/platform/inventory", label: "See costs and reporting" },
    visual: <div className="hc-panel"><FleetCostPanel /></div>,
  },
];

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <HeroCarousel slides={HERO_SLIDES} />

        <section className="section-pad" aria-labelledby="one-asset">
          <div className="site-shell">
            <h2 className="sec-h" id="one-asset">Workshop, field and stores share one record per machine.</h2>
            <Tabs
              label="Platform areas"
              items={[
                { id: "fleet", label: "Fleet and assets", icon: <Truck size={20} aria-hidden="true" />, panel: <AssetRecord /> },
                {
                  id: "maint", label: "Maintenance and workshop", icon: <Wrench size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><Photo name="technicianGenerator" position="45% 40%" /><TabCopy title="Every job, planned and tracked." text="Preventive schedules and breakdowns land in one work order queue your workshop can run from." points={["Preventive plans by hours, kilometres or date", "Job cards with labour, parts and outside services", "Technician allocation and workload"]} href="/platform/maintenance" /></div>,
                },
                {
                  id: "insp", label: "Inspections and safety", icon: <ShieldCheck size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><TabCopy title="Daily checks on the phone, even without signal." text="Field teams run checklists on the phone, with photos, readings and a signature, even without signal." points={["Configurable checklists by asset type", "Defects raise actions and work orders", "Offline capture that syncs later"]} href="/platform/inspections" /><div className="tab-media"><NewInspectionCard /></div></div>,
                },
                {
                  id: "inv", label: "Inventory and procurement", icon: <Box size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><Photo name="loaderSite" /><TabCopy title="The right part, on the right site." text="Stores issue parts straight to job cards, and purchase requests go through approval before an order is placed." points={["Stock by site with reorder levels", "Parts issued against the job and asset", "Purchase requests with approval"]} href="/platform/inventory" /></div>,
                },
                {
                  id: "cost", label: "Costs and reporting", icon: <BarChart3 size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><TabCopy title="Know what every asset costs." text="Maintenance, tyres, parts and fuel roll up by asset, site and category, from the same records your teams entered." points={["Cost by asset, site and category", "Availability and utilisation", "Scheduled reports and exports"]} href="/platform/inventory" /><div className="tab-media"><FleetCostPanel /></div></div>,
                },
              ]}
            />
          </div>
        </section>

        <section className="dark-band" aria-labelledby="field-to-closed">
          <div className="site-shell">
            <h2 className="sec-h" id="field-to-closed">From a field issue to a closed job.</h2>
            <ol className="flow">
              {STEPS.map(({ icon: Icon, title, text, card }, i) => (
                <li key={title}>
                  <div className="flow-step">
                    <span className="flow-n" aria-hidden="true">{i + 1}</span>
                    <Icon size={26} aria-hidden="true" />
                    <div><h3>{title}</h3><p>{text}</p></div>
                  </div>
                  {card}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section-pad" aria-labelledby="people">
          <div className="site-shell">
            <h2 className="sec-h" id="people">Each role sees the work it owns.</h2>
            <div className="people">
              <div className="people-art">
                <Photo name="technicianPhone" position="40% 30%" />
                <OfflineInspectionPhone />
              </div>
              <Tabs
                label="Roles"
                className="role-tabs"
                items={[
                  { id: "tech", label: "Technician", panel: <RoleCopy title="Tools that work where you work." text="Capture inspections offline, add photos, take meter readings, record work and get signatures, even without a network connection." /> },
                  { id: "store", label: "Storekeeper", panel: <RoleCopy title="Issue parts without the paperwork." text="See what each job needs, issue stock against the job card and keep reorder levels honest across every store." /> },
                  { id: "sup", label: "Supervisor", panel: <RoleCopy title="See the day before it starts." text="Review defects, approve work, allocate technicians and follow every open job from one queue." /> },
                  { id: "pmv", label: "PMV Manager", panel: <RoleCopy title="Availability and cost, asset by asset." text="Track availability, preventive compliance and spend across sites, and decide which assets to repair, replace or move." /> },
                ]}
              />
              <div className="sig-standalone"><Photo name="signature" /></div>
            </div>
          </div>
        </section>

        <section className="section-pad tight" aria-labelledby="full-picture">
          <div className="site-shell">
            <h2 className="sec-h" id="full-picture">Everything a PMV department runs on.</h2>
            <ul className="module-grid">
              {MODULES.map(({ icon: Icon, title, text, href }) => (
                <li key={title}>
                  <Icon size={32} strokeWidth={1.6} aria-hidden="true" />
                  <div><h3>{title}</h3><p>{text}</p><Link href={href} aria-label={href === "/contact" ? `Ask about ${title.toLowerCase()} in a demo` : `Learn more about ${title.toLowerCase()}`}>{href === "/contact" ? "Ask in a demo" : "Learn more"} <ArrowRight size={14} aria-hidden="true" /></Link></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section-pad tight" aria-labelledby="questions">
          <div className="site-shell">
            <h2 className="sec-h" id="questions">What fleet teams ask before a demo.</h2>
            <dl className="faq-list">
              {FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
            </dl>
          </div>
        </section>

        <CtaBand title="See your cost per km, asset by asset." text="Send one month of job cards and tyre records. We walk through them with you, on your own data." button="Book a demo on your data" />
      </main>
      <Footer />
    </>
  );
}

function RoleCopy({ title, text }: { title: string; text: string }) {
  const caps: [React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>, string][] = [
    [Camera, "Photos"], [Gauge, "Readings"], [PenLine, "Signatures"], [CloudUpload, "Offline sync"],
  ];
  return (
    <div className="role-copy">
      <h3>{title}</h3>
      <p>{text}</p>
      <ul className="caps">
        {caps.map(([Icon, l]) => <li key={l}><Icon size={22} aria-hidden={true} />{l}</li>)}
      </ul>
      <p className="muted-sm" style={{ marginTop: 16 }}><ClipboardCheck size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Works on Android phones and tablets, and in any modern browser.</p>
    </div>
  );
}
