import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Box, CircleDot, ClipboardCheck, ClipboardList, Droplets, GitBranch, IdCard, PackageCheck, Radio, ShieldAlert, Siren, Sparkles, Truck, Wrench } from "lucide-react";
import { DemoVideo } from "@/components/DemoVideo";
import { RoiCalculator } from "@/components/RoiCalculator";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CtaBand } from "@/components/CtaBand";
import { CountUp } from "@/components/motion/CountUp";
import { ProductScene } from "@/components/product/ProductScene";
import { ProductStory } from "@/components/product/ProductStory";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { StatusLegend } from "@/components/ui/StatusBadge";
import { alternatesFor } from "./schema";
import { OG_IMAGES } from "@/lib/site";
import { PROOF } from "@/lib/proof";

export const metadata: Metadata = {
  title: { absolute: "Tyre Pulse | Tyre, fleet and workshop operations in one record" },
  description:
    "Tyre Pulse tracks every tyre, machine, inspection, job card and cost in one record for multi-site fleets. On the web and on Android, in English and Arabic.",
  alternates: alternatesFor("/"),
  openGraph: { images: OG_IMAGES,
    title: "Tyre Pulse | Tyre, fleet and workshop operations in one record",
    description: "Tyres, assets, inspections, workshop jobs, stores and costs for plant, machinery and vehicles.",
    url: "/",
    type: "website",
  },
};

/*
 * Sixteen capability areas: a full 4 by 4 grid on desktop, 2 by 8 on tablets and phones.
 * Each card says only what the app does today; "set up on request" says so.
 * Link text names the destination ("See tyre lifecycle"), never a bare "Learn more".
 */
const MODULES: CardProps[] = [
  { icon: CircleDot, title: "Tyre lifecycle", text: "Every tyre by serial and wheel position, from fitment to removal, with cost per km or engine hour.", href: "/platform/tyre-lifecycle", linkLabel: "See tyre lifecycle", status: "available", photo: { name: "loaderTyre", position: "50% 40%" } },
  { icon: ClipboardCheck, title: "Inspections", text: "Checklists, photos, readings and signatures on the Android app, with or without signal.", href: "/platform/inspections", linkLabel: "See inspections", status: "available" },
  { icon: Truck, title: "Fleet and assets", text: "One record per machine: meters, documents, history and cost.", href: "/platform/fleet-assets", linkLabel: "See fleet and assets", status: "available" },
  { icon: Wrench, title: "Workshop and maintenance", text: "Job cards, technicians and parts in one queue. Preventive plans are set up on request.", href: "/platform/maintenance", linkLabel: "See maintenance", status: "available", variant: "dark" },
  { icon: Activity, title: "Workshop Live", text: "A live job board: what each technician is working on, what is waiting and why, and jobs assigned from the board.", href: "/platform/maintenance", linkLabel: "See the workshop board", status: "available" },
  { icon: Box, title: "Stores and parts", text: "Stock by site and parts issued against the job card. Purchase requests are set up on request.", href: "/platform/inventory", linkLabel: "See stores and parts", status: "available" },
  { icon: PackageCheck, title: "Store keeper stock count", text: "Store keepers add items and post counts from the phone. Minimum and reorder levels stay with the administrator.", href: "/platform/inventory", linkLabel: "See stock control", status: "available" },
  { icon: ClipboardList, title: "Plant daily checklists", text: "Daily sheets for ice plants, chillers, air compressors, batching plants and generators, one per asset per day.", href: "/platform/inspections", linkLabel: "See checklists", status: "available" },
  { icon: Siren, title: "Breakdown register", text: "Every machine that is down, from the day it stopped until it is back at work, with days down and the parts awaited.", href: "/platform/maintenance", linkLabel: "See breakdowns", status: "available" },
  { icon: ShieldAlert, title: "Accidents and claims", text: "Accident cases with photos, damage, root cause and claim documents.", href: "/contact", linkLabel: "Ask about accidents in a demo", status: "available" },
  { icon: GitBranch, title: "Approval matrix", text: "Decide who signs what, by named person, by site or by role. The most specific rule wins.", href: "/security", linkLabel: "See roles and access", status: "available" },
  { icon: IdCard, title: "Driver management", text: "Driver records, documents and training in one place, kept up to date by the fleet supervisor.", href: "/contact", linkLabel: "Ask about drivers in a demo", status: "available" },
  { icon: Droplets, title: "Vehicle washing", text: "A wash log per vehicle with photos from the phone, and the list of vehicles due for a wash.", href: "/contact", linkLabel: "Ask about washing in a demo", status: "available" },
  { icon: Radio, title: "Devices and telematics", text: "A register of telematics devices and when each last reported, gauge photos for meter readings, and QR labels to print and scan.", href: "/platform/fleet-assets", linkLabel: "See asset records", status: "available" },
  { icon: BarChart3, title: "Reports and dashboards", text: "Dashboards, scheduled reports and shareable boards for a screen or a manager.", href: "/platform/reports", linkLabel: "See reports", status: "available" },
  { icon: Sparkles, title: "AI-assisted photo review (pilot)", text: "Suggests possible tyre defects from inspection photos to assist a human reviewer. Accuracy is still being validated.", href: "/platform/tyre-lifecycle#ai", linkLabel: "Read about the pilot", status: "on-request" },
];

/* Built in ready-mix; everything else is configured with the customer and is not yet in production. */
const OTHER_FLEETS = ["Construction", "Logistics", "Oil and gas", "Mining", "Buses", "Equipment rental", "Waste collection"];

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <section className="home-hero" aria-labelledby="hero-h">
          <div className="site-shell hc-grid">
            <div className="hc-copy">
              <span className="kicker">Tyres, plant, machinery and vehicles</span>
              <h1 className="hero-h1" id="hero-h">Know which tyres and machines cost you most, and why.</h1>
              <p className="hero-lead">Tyre Pulse is one record for every tyre, machine, inspection, job card and cost across your sites. Field teams work on the phone, the office on the web.</p>
              <div className="hero-cta">
                <Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight className="cta-arrow" size={18} aria-hidden="true" /></Link>
                <Link className="btn-text" href="/platform">Explore the platform <ArrowRight size={17} aria-hidden="true" /></Link>
              </div>
              <ul className="tp-chips" aria-label="Where it runs">
                <li>Web and Android</li>
                <li>Android app works offline</li>
                <li>English and Arabic</li>
              </ul>
            </div>
            <ProductScene />
          </div>
        </section>

        <section className="proof" aria-labelledby="proof-h">
          <div className="site-shell">
            <div className="proof-head">
              <h2 id="proof-h">Built inside a working ready-mix operation.</h2>
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
        </section>

        <Section id="story-h" tone="dark" title="Follow one tyre from the yard to the management report." lead="Each of the seven steps is done by the person who owns it, on the device they use.">
          <ProductStory />
        </Section>

        <Section id="modules-h" title="What is in the platform." lead="Each area works on the same asset record, so nothing is typed twice.">
          <CardGrid cols={4} className="tp-grid--compact">
            {MODULES.map((m) => <Card key={m.title} {...m} />)}
          </CardGrid>
          <StatusLegend />
        </Section>

        <Section id="fleets-h" tone="soft" title="Built in ready-mix concrete, configurable for any fleet." lead="Tyre Pulse runs a ready-mix fleet in production today. For other fleets the checklists, asset types, approvals and reports are set up with you before you go live.">
          <ul className="tp-fleets" aria-label="Other fleets, configured with you">
            <li className="is-live"><b>Ready-mix concrete</b><span>In production today</span></li>
            {OTHER_FLEETS.map((f) => <li key={f}><b>{f}</b><span>Configured with you</span></li>)}
          </ul>
          <p className="tp-more"><Link className="btn-text" href="/industries">See how each industry is set up <ArrowRight size={16} aria-hidden="true" /></Link></p>
        </Section>

        <Section id="video-h" title="See it in fifteen seconds.">
          <DemoVideo />
        </Section>

        <Section id="roi-h" tone="soft" title="Estimate what longer tyre life is worth." lead="An estimate on your own numbers. It assumes tyres last 10% longer once every tyre is tracked by serial, position and pressure, which is an assumption, not a measured result.">
          <RoiCalculator />
        </Section>

        <Section id="rollout" title="Start from the files you already keep.">
          <ol className="next-steps tp-steps-row">
            <li><b>Send what you already export.</b><span>An asset list, a month of job cards and your tyre records, as your ERP and Excel produce them.</span></li>
            <li><b>We load and check it with you.</b><span>Columns are mapped with you, repeated rows are checked and each row is tied to a machine, a site and a country.</span></li>
            <li><b>Teams work on their own records.</b><span>Tyre fitters inspect on the phone, the workshop runs its queue and managers read cost per machine.</span></li>
          </ol>
          <p className="tp-more"><Link className="btn-text" href="/faq">Read the questions fleet teams ask <ArrowRight size={16} aria-hidden="true" /></Link></p>
        </Section>

        <CtaBand title="See your cost per km, tyre by tyre." text="Send one month of job cards and tyre records. We walk through them with you, on your own data." button="Book a demo on your data" />
      </main>
      <Footer />
    </>
  );
}
