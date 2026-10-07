import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { ProofStrip } from "@/components/ProofStrip";
import { TourBand } from "@/components/TourBand";
import { JsonLd, alternatesFor, breadcrumbSchema } from "../../schema";
import { OG_IMAGES } from "@/lib/site";
import { FaqBlock, Modules, Problem, StartList, Steps, type Faq } from "../SolutionParts";

const PATH = "/solutions/ready-mix-fleet";
const TITLE = "Ready-mix fleet maintenance software";
const DESCRIPTION = "Preventive maintenance by engine hours, breakdown downtime split into waiting and repair time, and cost per m3 for mixers, pumps and plant.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const PAINS = [
  ["A mixer down means a pour at risk", "When MX-214 stops at a site in Jeddah, the load behind it waits too, and the customer hears about it first."],
  ["Downtime with no breakdown of why", "A machine out for four days could have waited three days for parts or three days for a bay. Each needs a different fix."],
  ["Cost that never meets volume", "Maintenance sits in the ERP and cubic metres sit in the batching system, so cost per m3 is worked out by hand, if at all."],
] as const;

const STEPS = [
  ["Plan service on the meter.", "Mixers, pumps, loaders and generators get service plans by engine hours, kilometres or calendar. Overdue work shows before it turns into a breakdown."],
  ["Time every breakdown.", "Job cards record when the machine left production, entered and left the workshop, and returned. Waiting time and repair time are reported separately."],
  ["Divide cost by concrete.", "Workshop, tyre and service-contract cost is divided by the approved cubic metres your plants delivered, by region and month."],
] as const;

const MODULES = [
  { href: "/platform/maintenance", label: "Maintenance and workshop", text: "Preventive plans, job cards, technicians and parts for every machine type." },
  { href: "/platform/fleet-assets", label: "Fleet and assets", text: "One record per mixer, pump and plant item, with hours, kilometres and site." },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Daily walk-round checks on the phone, with defects raised as job cards." },
  { href: "/platform/inspections#tyres", label: "Tyre lifecycle", text: "Tyre life and cost per km or per engine hour for mixers and pumps." },
  { href: "/platform/inventory", label: "Inventory and reporting", text: "Spare parts by store, purchase approval and cost per machine and per m3." },
  { href: "/industries", label: "Industries", text: "How the same platform is configured for ready-mix and other operations.", cta: "See industries" },
] as const;

const START = [
  { need: true, label: "Your asset list", text: "Mixers, pumps, loaders, generators and plant with their codes and sites." },
  { need: true, label: "Job card export", text: "Your ERP or workshop job cards. We import them as they are, including the production and workshop times." },
  { need: false, label: "Service intervals", text: "Your current PM schedule by hours or kilometres. We can start from manufacturer intervals if none is written down." },
  { need: false, label: "Daily production volumes", text: "Approved cubic metres per plant per day, needed for cost per m3." },
  { need: false, label: "Expense lines", text: "Parts, oil and tyre issues from your ERP, classified so cost per machine is complete." },
  { need: false, label: "Telematics or meter photos", text: "Engine hours from telematics, or drivers log the meter with a photo each day." },
] as const;

const FAQ: Faq = [
  ["Can it handle mixers, pumps and batching plant together?", "Yes. Each machine type gets its own checklist, service plan and meter, hours for plant and pumps or kilometres for trucks, in the same register."],
  ["How is cost per m3 calculated?", "Maintenance, tyre and service-contract cost for the period, divided by the approved cubic metres your plants delivered in that period. It is reported by region and month."],
  ["Does it replace our ERP?", "No. Tyre Pulse imports job cards and expense lines from your ERP exports and adds the field, workshop and cost views the ERP does not give you."],
] as const;

export default function ReadyMixFleetPage() {
  return (
    <PageFrame>
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Solutions", path: "/solutions" }, { name: "Ready-mix fleet", path: PATH }])} />
      <PageTop photo="fleetLineup"
        crumbs={[{ href: "/", label: "Home" }, { href: "/solutions", label: "Solutions" }, { label: "Ready-mix fleet" }]}
        title="Keep mixers and pumps on the pour."
        lead="Maintenance software for ready-mix fleets: service by engine hours, breakdowns timed from production out to production in, and cost per cubic metre."
      />
      <Problem id="rm-problem" title="In ready-mix, a breakdown also costs the delivery behind it." text="Mixers, pumps and plant work long shifts on rough site roads, and a missed pour cannot be rescheduled the way a parcel can. Knowing why machines stop, and what each cubic metre costs to deliver, decides the margin on each load." pains={PAINS} />
      <ProofStrip id="rm-proof" title="Built inside a ready-mix operation." text="These are the records Tyre Pulse runs on today across Saudi Arabia, the UAE and Egypt." />
      <Steps id="rm-how" title="How it works for a ready-mix fleet." lead="Plant engineers, the workshop and finance work from the same machine record." steps={STEPS} />
      <TourBand id="rm-tour" title="Watch a breakdown and a service run to sign-off." only={["workshop", "maintenance", "cost"]} />
      <Modules id="rm-modules" title="The modules behind it." items={MODULES} />
      <StartList id="rm-start" title="What you need to start." lead="Your asset list and job cards are enough for the first view. Production volumes unlock cost per m3." items={START} />
      <FaqBlock id="rm-faq" title="Questions plant managers ask." faq={FAQ} />
      <CtaBand title="See what your fleet costs per cubic metre." text="Send a month of job cards and plant volumes. We split breakdowns from planned work, machine by machine." button="Book a demo on your data" />
    </PageFrame>
  );
}
