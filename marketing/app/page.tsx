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
import { Photo } from "@/components/art/Photos";
import {
  ApprovalCard, AssetRecord, CompleteCard, FleetCostPanel, NewInspectionCard, OfflineInspectionPhone,
  OpsOverview, PartsCard,
} from "@/components/mock/Screens";
import { alternatesFor } from "./schema";

export const metadata: Metadata = {
  title: { absolute: "Tyre Pulse | Complete control of your PMV operations" },
  description:
    "Connect plant, machinery and vehicle assets with your workshop, field teams and stores in one operational workspace. Work orders, inspections, tyres, parts, costs and approvals.",
  alternates: alternatesFor("/"),
  openGraph: {
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
  { icon: CircleDot, title: "Tyre lifecycle", text: "Track tyre inspections, fitments, rotations and cost per kilometre or hour.", href: "/platform/inspections" },
  { icon: ShieldCheck, title: "Accidents and insurance", text: "Record incidents, manage claims and track insurance details.", href: "/platform" },
  { icon: Box, title: "Stores and procurement", text: "Control inventory, purchases and suppliers across all sites.", href: "/platform/inventory" },
  { icon: Fuel, title: "Fuel and operating costs", text: "See operating costs by asset, site or project.", href: "/platform/inventory" },
  { icon: BarChart3, title: "Approvals and reporting", text: "Manage approvals and get clear reports across your operations.", href: "/platform/inventory" },
];

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <section className="home-hero">
          <div className="site-shell home-hero-grid">
            <div>
              <span className="kicker">Plant, machinery and vehicles</span>
              <h1 className="hero-h1">Complete control of your PMV operations.</h1>
              <p className="hero-lead">Connect your assets, workshop, field teams and stores in one operational workspace.</p>
              <div className="hero-cta">
                <Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight size={18} aria-hidden="true" /></Link>
                <Link className="btn-text" href="/platform">Explore the platform <ArrowRight size={17} aria-hidden="true" /></Link>
              </div>
              <ul className="segments" aria-label="Industries we serve">
                <li>Construction</li><li>Ready-mix</li><li>Transport</li><li>Equipment rental</li>
              </ul>
            </div>
            <OpsOverview />
          </div>
        </section>

        <section className="section-pad" aria-labelledby="one-asset">
          <div className="site-shell">
            <h2 className="sec-h" id="one-asset">One asset. Every record. Every team.</h2>
            <Tabs
              label="Platform areas"
              items={[
                { id: "fleet", label: "Fleet and assets", icon: <Truck size={20} aria-hidden="true" />, panel: <AssetRecord /> },
                {
                  id: "maint", label: "Maintenance and workshop", icon: <Wrench size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><Photo name="concretePump" fit="contain" className="art art-dark" /><TabCopy title="Every job, planned and tracked." text="Preventive schedules and breakdowns land in one work order queue your workshop can run from." points={["Preventive plans by hours, kilometres or date", "Job cards with labour, parts and outside services", "Technician allocation and workload"]} href="/platform/maintenance" /></div>,
                },
                {
                  id: "insp", label: "Inspections and safety", icon: <ShieldCheck size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><TabCopy title="Inspect anything, anywhere." text="Field teams run checklists on the phone, with photos, readings and a signature, even without signal." points={["Configurable checklists by asset type", "Defects raise actions and work orders", "Offline capture that syncs later"]} href="/platform/inspections" /><div style={{ padding: 24, background: "#fafaf8" }}><NewInspectionCard /></div></div>,
                },
                {
                  id: "inv", label: "Inventory and procurement", icon: <Box size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><Photo name="loaderSite" /><TabCopy title="The right part, on the right site." text="Stores issue parts straight to job cards, and purchase requests go through approval before an order is placed." points={["Stock by site with reorder levels", "Parts issued against the job and asset", "Purchase requests with approval"]} href="/platform/inventory" /></div>,
                },
                {
                  id: "cost", label: "Costs and reporting", icon: <BarChart3 size={20} aria-hidden="true" />,
                  panel: <div className="tab-panel"><TabCopy title="Know what every asset costs." text="Maintenance, tyres, parts and fuel roll up by asset, site and category, from the same records your teams entered." points={["Cost by asset, site and category", "Availability and utilisation", "Scheduled reports and exports"]} href="/platform/inventory" /><div style={{ padding: 20 }}><FleetCostPanel /></div></div>,
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
            <h2 className="sec-h" id="people">Built for the people doing the work.</h2>
            <div className="people">
              <div className="people-art">
                <Photo name="technician" position="30% 30%" />
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

        <section className="section-pad" style={{ paddingTop: 0 }} aria-labelledby="full-picture">
          <div className="site-shell">
            <h2 className="sec-h" id="full-picture">The full PMV picture.</h2>
            <ul className="module-grid">
              {MODULES.map(({ icon: Icon, title, text, href }) => (
                <li key={title}>
                  <Icon size={32} strokeWidth={1.6} aria-hidden="true" />
                  <div><h3>{title}</h3><p>{text}</p><Link href={href} aria-label={`Learn more about ${title.toLowerCase()}`}>Learn more <ArrowRight size={14} aria-hidden="true" /></Link></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <CtaBand title="Bring every site into view." text="Unite your assets, people and processes in one platform." />
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
