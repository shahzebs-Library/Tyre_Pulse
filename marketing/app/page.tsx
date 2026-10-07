import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Box, CheckCircle2, CircleDot, FileSignature,
  Fuel, ShieldCheck, Truck, Wrench, ClipboardList, Settings, FileCheck2, Users,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CtaBand } from "@/components/CtaBand";
import { Tabs } from "@/components/Tabs";
import { HeroCarousel, type HeroSlide } from "@/components/HeroCarousel";
import { Photo, type PhotoKey } from "@/components/art/Photos";
import { CountUp } from "@/components/motion/CountUp";
import { Walkthrough } from "@/components/motion/walkthrough/Walkthrough";
import { Donut, Heatmap } from "@/components/motion/walkthrough/charts";
import { AssetCycle, LiveFeed, type LiveEvent } from "@/components/motion/HeroLive";
import { Spotlight } from "@/components/motion/Spotlight";
import {
  AssetRecord, FleetCostPanel, NewInspectionCard, OpsOverview,
} from "@/components/mock/Screens";
import { JsonLd, alternatesFor, faqSchema } from "./schema";
import { HOME_FAQ } from "@/lib/faqs";
import { OG_IMAGES } from "@/lib/site";
import { RolesShowcase, type Role } from "@/components/RolesShowcase";
import { PROOF } from "@/lib/proof";
import { FLEET, FleetVehicle } from "@/components/art/FleetVehicles";

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

/* What can open a job: every signal lands in the same queue. */
const SIGNALS = [
  "Driver reports a problem", "Inspection finds a defect", "Live TPMS pressure alert", "Preventive service due",
  "Anomaly flagged in the data", "Accident reported",
];

/* Sample downtime heatmap for the home page (hours, 8 weeks). */
const DOWN_CITIES = ["Riyadh", "Jeddah", "Dammam", "Dubai", "Cairo"];
const DOWN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOWN_HOURS = [
  [41, 28, 22, 19, 24, 6, 9],
  [33, 21, 18, 16, 20, 4, 7],
  [18, 14, 11, 12, 15, 3, 5],
  [12, 16, 10, 9, 13, 8, 4],
  [15, 11, 9, 10, 8, 2, 6],
];

/* One job, start to finish: who owns each stage and what the platform does on its own. */
const PIPELINE = [
  { icon: ClipboardList, stage: "Detect", owner: "Driver or inspector", text: "Reported from the phone with photos, GPS and the meter reading, even offline.", auto: "Asset, site and history filled in from the QR or RFID tag", stat: "07:42", statLabel: "reported" },
  { icon: FileCheck2, stage: "Triage and approve", owner: "Supervisor", text: "Severity set, defect confirmed, job raised and approved in one queue.", auto: "Priority from severity, machine stopped or not, and site", stat: "08:05", statLabel: "approved" },
  { icon: Users, stage: "Assign", owner: "Workshop foreman", text: "The right technician picked by skill, who is free, workload and site.", auto: "Ranked suggestions, push notification to the technician", stat: "08:12", statLabel: "on the job" },
  { icon: Box, stage: "Parts", owner: "Storekeeper", text: "Parts issued against the job card, or a purchase request sent for approval.", auto: "Stock by site, reorder level, job paused as waiting for parts", stat: "1 h 20", statLabel: "parts wait" },
  { icon: Wrench, stage: "Repair", owner: "Technician", text: "Start, pause and finish on the phone. Labour, parts and outside work recorded.", auto: "Waiting time kept apart from repair time, cost rolls up", stat: "2 h 10", statLabel: "repair" },
  { icon: FileSignature, stage: "Verify and learn", owner: "Supervisor and PMV manager", text: "Quality check, sign-off and release. The record feeds cost per km and root cause.", auto: "Repeat failures, tyre life and cost per km updated for the asset", stat: "14:40", statLabel: "back in service" },
];

type Module = {
  icon: typeof Truck; title: string; text: string; href: string;
  photo?: { name: PhotoKey; position?: string }; tone?: "dark" | "brand";
};

/* Eight modules, eight bento cells: two photo tiles, one dark, one yellow, four plain. */
const MODULES: Module[] = [
  { icon: Truck, title: "Fleet and asset lifecycle", text: "Track plant, machinery and vehicles from acquisition to disposal, with meters, documents and cost on one record.", href: "/platform/fleet-assets", photo: { name: "fleetLineup", position: "50% 60%" } },
  { icon: CircleDot, title: "Tyre lifecycle", text: "Inspections, RFID passports, live TPMS pressure via telematics, removal forecasts and cost per km by brand.", href: "/platform/inspections#tyres", photo: { name: "riyadh", position: "30% 88%" } },
  { icon: Settings, title: "Workshop and job cards", text: "Jobs, labour, parts and outside services in one queue.", href: "/platform/maintenance", tone: "dark" },
  { icon: Wrench, title: "Preventive maintenance", text: "Plans by hours, kilometres or date that keep assets compliant.", href: "/platform/maintenance" },
  { icon: Box, title: "Stores and procurement", text: "Inventory, purchases and suppliers across every site.", href: "/platform/inventory" },
  { icon: ShieldCheck, title: "Accidents and insurance", text: "Incidents, claims and policy details per machine.", href: "/contact" },
  { icon: Fuel, title: "Fuel and operating costs", text: "Operating cost by asset, site or project.", href: "/contact" },
  { icon: BarChart3, title: "Approvals and reporting", text: "Work orders and purchases routed to the right approver.", href: "/contact", tone: "brand" },
];


const FAQ = HOME_FAQ;

/* What the hero cards play through, one event at a time (sample data). */
const OPS_EVENTS: LiveEvent[] = [
  { icon: "inspect", text: "MX-214 inspected in Riyadh", meta: "Ahmed K. · 07:42" },
  { icon: "tyre", text: "LHR1 sidewall cut flagged", meta: "Photo attached", tone: "bad" },
  { icon: "wrench", text: "WO-2026-0418 raised", meta: "Assigned to tyre bay", tone: "warn" },
  { icon: "check", text: "Purchase approved", meta: "SAR 1,240 · Fleet manager" },
  { icon: "tyre", text: "New tyre fitted on LHR1", meta: "Serial DX-4471-208 · 38 min" },
  { icon: "truck", text: "MX-214 back in service", meta: "Down 1 h 12 min" },
];
const WORKSHOP_EVENTS: LiveEvent[] = [
  { icon: "truck", text: "GN-305 breakdown reported", meta: "Jeddah · 06:10", tone: "bad" },
  { icon: "wrench", text: "Job card opened", meta: "Technician: R. Ali", tone: "warn" },
  { icon: "gauge", text: "Parts issued from store", meta: "Fuel filter x2 · SAR 340" },
  { icon: "wrench", text: "Repair completed", meta: "Labour 2.5 h" },
  { icon: "check", text: "Supervisor signed off", meta: "Released to site" },
];
const INSPECTION_EVENTS: LiveEvent[] = [
  { icon: "inspect", text: "Checklist started offline", meta: "WL-207 · no signal" },
  { icon: "gauge", text: "Meter read: 9,105 h", meta: "Saved on the phone" },
  { icon: "camera", text: "2 photos captured", meta: "Bucket teeth worn", tone: "warn" },
  { icon: "pen", text: "Inspector signed", meta: "S. Omar · 09:18" },
  { icon: "check", text: "Synced when back in signal", meta: "Manager notified" },
];

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "ops", tab: "Operations", kicker: "PMV: plant, machinery and vehicles",
    title: "Know which machines are down, why, and what they cost.",
    lead: "Your workshop, field teams and stores work from one record per machine, so nothing is retyped.",
    link: { href: "/platform", label: "Explore the platform" },
    visual: <div className="hc-live"><OpsOverview /><div className="hc-float"><LiveFeed title="Live activity" events={OPS_EVENTS} rows={1} /></div></div>,
  },
  {
    id: "assets", tab: "Fleet and assets", kicker: "Fleet and asset lifecycle",
    title: "Every machine, one complete record.",
    lead: "Meters, tyres, documents, costs and history for each asset, from purchase to disposal.",
    link: { href: "/platform/fleet-assets", label: "See fleet and assets" },
    visual: <div className="hc-photo hc-zoom"><Photo name="fleetLineup" position="50% 60%" sizes="(max-width: 900px) 110vw, 720px" /><div className="hc-float hc-float-wide"><AssetCycle /></div></div>,
  },
  {
    id: "workshop", tab: "Workshop", kicker: "Maintenance and workshop",
    title: "Breakdowns back on site, sooner.",
    lead: "Job cards, technicians, parts and outside repairs in one queue your workshop runs from.",
    link: { href: "/platform/maintenance", label: "See maintenance" },
    visual: <div className="hc-photo"><Photo name="technicianGenerator" position="45% 40%" sizes="(max-width: 900px) 100vw, 640px" /><div className="hc-float"><LiveFeed title="Workshop today" events={WORKSHOP_EVENTS} /></div></div>,
  },
  {
    id: "inspections", tab: "Inspections", kicker: "Field inspections and safety",
    title: "Inspect in the field, even without signal.",
    lead: "Checklists, photos, meter readings and signatures on the phone. It syncs when the connection returns.",
    link: { href: "/platform/inspections", label: "See inspections" },
    visual: <div className="hc-photo"><Photo name="engineer" position="50% 35%" sizes="(max-width: 900px) 100vw, 640px" /><div className="hc-float"><LiveFeed title="Field inspection" events={INSPECTION_EVENTS} /></div></div>,
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

        <section className="proof" aria-labelledby="proof-h">
          <div className="site-shell">
            <div className="proof-head">
              <h2 id="proof-h">Built inside a working ready-mix operation, not a demo account.</h2>
              <p>Tyre Pulse runs the daily work of a concrete fleet across three countries. These are its own numbers.</p>
            </div>
            <dl className="proof-stats">
              {PROOF.map((p) => (
                <div key={p.label}>
                  <dt>{p.label}</dt>
                  <dd><b><CountUp value={p.value} suffix={p.suffix} /></b><span>{p.text}</span></dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="marquee">
            <div className="site-shell marquee-viewport">
              <div className="marquee-track">
                <ul aria-label="Asset types tracked">{FLEET.map(({ name, src, w, h }) => <li key={name}><FleetVehicle src={src} w={w} h={h} /><span>{name}</span></li>)}</ul>
                <ul aria-hidden="true">{FLEET.map(({ name, src, w, h }) => <li key={name}><FleetVehicle src={src} w={w} h={h} /><span>{name}</span></li>)}</ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section-pad" aria-labelledby="one-asset">
          <div className="site-shell">
            <h2 className="sec-h" id="one-asset">Workshop, field and stores share one record per machine.</h2>
            <Tabs
              label="Platform areas"
              autoplay={6000}
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

        <section className="dark-band fx-live" aria-labelledby="field-to-closed">
          <div className="site-shell">
            <h2 className="sec-h" id="field-to-closed">From a field issue to a closed job.</h2>
            <p className="dark-lead">Six kinds of signal open a job. Each stage has one owner, and the platform does the routine work in between, so a machine is back on site the same day.</p>
            <div className="fx-signals" aria-label="What can open a job">
              <span className="fx-signals-h">Opens a job</span>
              <ul>{SIGNALS.map((x, i) => <li key={x} style={{ ["--i" as string]: i }}>{x}</li>)}</ul>
            </div>
            <div className="fx-rail" aria-hidden="true"><i /></div>
            <ol className="fx-pipe">
              {PIPELINE.map(({ icon: Icon, stage, owner, text, auto, stat, statLabel }, i) => (
                <li key={stage} style={{ ["--i" as string]: i }}>
                  <div className="fx-top"><span className="flow-n" aria-hidden="true">{i + 1}</span><Icon size={22} aria-hidden="true" /><b className="fx-stat">{stat}<small>{statLabel}</small></b></div>
                  <h3>{stage}</h3>
                  <span className="fx-owner">{owner}</span>
                  <p>{text}</p>
                  <p className="fx-auto"><Settings size={13} aria-hidden="true" /> {auto}</p>
                </li>
              ))}
            </ol>
            <figure className="fx-job" aria-label="Sample job on transit mixer MX-214, down 6 h 58 min from report to back in service: waiting to start 2 h 38, repair 2 h 10, waiting for parts 1 h 20, approve and assign 30 min, quality check 20 min">
              <figcaption><span>One sample job · MX-214 · Riyadh</span><b>Down 6 h 58 min</b><em>Sample data</em></figcaption>
              <div className="fx-charts">
                <Donut size={132} center="6 h 58" sub="down" label="Where the downtime went, 6 h 58 min in total: waiting to start 2 h 38, repair 2 h 10, parts 1 h 20, approve and assign 30 min, quality check 20 min"
                  slices={[
                    { name: "Waiting to start", v: 158, tone: "ink2", label: "2 h 38" },
                    { name: "Repair", v: 130, tone: "brand", label: "2 h 10" },
                    { name: "Waiting for parts", v: 80, tone: "ink3", label: "1 h 20" },
                    { name: "Approve and assign", v: 30, tone: "ink4", label: "30 min" },
                    { name: "Quality check", v: 20, tone: "ink", label: "20 min" },
                  ]} />
                <div>
                  <small className="fx-cap">Fleet downtime hours by city and weekday, last 8 weeks</small>
                  <Heatmap rows={DOWN_CITIES} cols={DOWN_DAYS} data={DOWN_HOURS} unit=" h"
                    label="Fleet downtime hours by city and weekday over 8 weeks. Highest: Riyadh on Sunday, 41 hours, and Jeddah on Sunday, 33 hours." />
                </div>
              </div>
              <div className="fx-kpis">
                <div><small>Repair share of downtime</small><b>31%</b></div>
                <div><small>Biggest delay</small><b>Waiting to start</b></div>
                <div><small>Cost booked to the asset</small><b>SAR 1,980</b></div>
                <div><small>Fixed first time</small><b>Yes</b></div>
              </div>
            </figure>
          </div>
        </section>

        <section className="section-pad" aria-labelledby="people">
          <div className="site-shell">
            <h2 className="sec-h" id="people">Each role sees the work it owns.</h2>
            <p className="sec-lead">Seven roles, one record. Each person opens the app to their own queue, on the device they actually use, and nobody sees data from another country or site unless they are allowed to.</p>
            <RolesShowcase roles={ROLES} />
          </div>
        </section>

        <section className="bright-band" aria-labelledby="demo-walkround">
          <div className="site-shell">
            <h2 className="sec-h" id="demo-walkround">See it work: the phone in the field, the web in the office.</h2>
            <Walkthrough />
          </div>
        </section>

        <section className="section-pad" aria-labelledby="full-picture">
          <div className="site-shell">
            <h2 className="sec-h" id="full-picture">Everything a PMV department runs on.</h2>
            <Spotlight>
              <ul className="bento">
                {MODULES.map(({ icon: Icon, title, text, href, photo, tone }) => {
                  const demo = href === "/contact";
                  return (
                    <li key={title} className={`bento-cell${tone ? ` is-${tone}` : ""}${photo ? " has-photo" : ""}`}>
                      {photo && <div className="bento-media"><Photo name={photo.name} position={photo.position} sizes="(max-width: 720px) 100vw, 560px" /></div>}
                      <div className="bento-body">
                        <Icon size={26} strokeWidth={1.7} aria-hidden="true" />
                        <h3>{title}</h3>
                        <p>{text}</p>
                        <Link href={href} className="bento-link" aria-label={demo ? `Ask about ${title.toLowerCase()} in a demo` : `Learn more about ${title.toLowerCase()}`}>
                          {demo ? "Ask in a demo" : "Learn more"} <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Spotlight>
          </div>
        </section>

        <section className="section-pad soft-bg" aria-labelledby="rollout">
          <div className="site-shell split split-top">
            <div>
              <h2 className="sec-h" id="rollout">From your spreadsheets to the phone in three steps.</h2>
              <p className="panel-text">No blank system to fill by hand. You start from the records you already keep.</p>
            </div>
            <ol className="next-steps">
              <li><b>Send what you already export.</b><span>An asset list, a month of job cards and your tyre records, in the formats your ERP and Excel produce.</span></li>
              <li><b>We load and check it.</b><span>Columns are mapped, duplicates are caught and every row is tied to a machine, a site and a country.</span></li>
              <li><b>Teams work on their own records.</b><span>Tyre men inspect on the phone, the workshop runs its queue and managers read cost per machine.</span></li>
            </ol>
          </div>
        </section>

        <section className="section-pad tight" aria-labelledby="questions">
          <div className="site-shell">
            <h2 className="sec-h" id="questions">What fleet teams ask before a demo.</h2>
            <dl className="faq-list">
              {FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
            </dl>
            <JsonLd data={faqSchema(FAQ, "/")} />
          </div>
        </section>

        <CtaBand title="See your cost per km, asset by asset." text="Send one month of job cards and tyre records. We walk through them with you, on your own data." button="Book a demo on your data" />
      </main>
      <Footer />
    </>
  );
}

const ROLES: Role[] = [
  { id: "driver", label: "Driver", title: "Report it before the next trip.", text: "Daily checks, meter readings and problems reported from the phone in a minute, in Arabic or English, with or without signal.",
    screen: ["Pre-trip checklist for this vehicle", "Report a problem with a photo", "Odometer or hour meter with a photo", "Accident report with GPS and damage marks"],
    kpis: [["Checks done today", "1 of 1"], ["Open problems on my vehicle", "0"]], devices: ["phone"] },
  { id: "tech", label: "Technician", title: "Your jobs, in order, on the phone.", text: "See the jobs assigned to you, start and pause them with a reason, record parts and labour, and close with photos and a signature.",
    screen: ["My jobs by priority", "Start, pause for parts, finish", "Tyre fitment by wheel position", "Inspection photos and signature"],
    kpis: [["Jobs today", "4"], ["Productive time", "6 h 10"]], devices: ["phone"] },
  { id: "tyre", label: "Tyre man", title: "Every wheel, every reading, every serial.", text: "Walk round with the tyre map, read RFID tags, record tread and pressure per wheel, and see which tyres the forecast says come off next.",
    screen: ["Tyre map per vehicle type", "RFID read opens the tyre passport", "Live TPMS pressure alerts via telematics", "Tyres due in the next 30 days"],
    kpis: [["Tyres due in 30 days", "46"], ["Pressure compliance", "96%"]], devices: ["phone", "web"] },
  { id: "store", label: "Storekeeper", title: "Issue parts without the paperwork.", text: "See what each job needs, issue stock against the job card, and raise a purchase request when the reorder level is reached.",
    screen: ["Parts requested by open jobs", "Issue against the job card", "Stock and reorder level by site", "Purchase requests waiting approval"],
    kpis: [["Requests waiting", "3"], ["Below reorder level", "7 items"]], devices: ["web", "phone"] },
  { id: "sup", label: "Supervisor", title: "See the day before it starts.", text: "Approve inspections and jobs, assign the right technician, and follow every open job and every machine that is down.",
    screen: ["Approvals with signature", "Live workshop board", "Machines out of production", "Smart technician assignment"],
    kpis: [["Waiting your approval", "5"], ["Machines down now", "4"]], devices: ["web", "phone", "tv"] },
  { id: "claims", label: "HSE and insurance", title: "One case, every document ready.", text: "Accident cases with photos, damage, root cause and the full claim package, so the insurer has nothing to send back.",
    screen: ["Accident register by severity", "Root cause and actions", "Claim documents checklist", "Claimed, approved and recovered"],
    kpis: [["Open cases", "6"], ["Recovered this year", "SAR 184k"]], devices: ["web"] },
  { id: "pmv", label: "PMV manager", title: "Availability and cost, asset by asset.", text: "Availability, preventive compliance, cost per km or hour and anomalies across every site and country, each in its own currency.",
    screen: ["Fleet availability and downtime causes", "Cost per km by asset and brand", "Anomalies and data checks", "Repair, replace or move decisions"],
    kpis: [["Fleet availability", "93%"], ["Cost per km", "SAR 0.93"]], devices: ["web", "tv"] },
];

