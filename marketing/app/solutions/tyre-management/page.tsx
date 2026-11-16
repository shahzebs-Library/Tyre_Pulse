import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { TourBand } from "@/components/TourBand";
import { JsonLd, alternatesFor, breadcrumbSchema } from "../../schema";
import { OG_IMAGES } from "@/lib/site";
import { FaqBlock, Modules, Problem, StartList, Steps, type Faq } from "../SolutionParts";

const PATH = "/solutions/tyre-management";
const TITLE = "Tyre management software for GCC fleets";
const DESCRIPTION = "Track every tyre by serial and wheel position, see cost per km by brand and size, forecast tyre life and check pressure at every inspection.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const PAINS = [
  ["Tyre spend with no owner", "Purchases sit in the ERP while fitments sit in a notebook, so nobody can say what a tyre cost per kilometre."],
  ["Failures found at the roadside", "A slow leak on a mixer in Riyadh heat is a blowout waiting to happen, and the walk-round only sees it once a day."],
  ["Brands bought on price", "Without life and cost per km by brand, the cheapest quote wins even when it scraps twice as fast."],
] as const;

const STEPS = [
  ["Record each tyre once.", "Fit by serial, wheel position and odometer from the phone. A scanned or typed serial opens the tyre's history. RFID reads are set up on request."],
  ["Watch it while it runs.", "Inspections log condition and pressure on every walk-round, and a tyre reading low against the others on the same vehicle is flagged in the inspection report. Live TPMS alerts are planned."],
  ["Decide with the numbers.", "Tyre life is forecast from the kilometres and hours each tyre has run, and cost per km by brand and size shows which tyre is worth buying again."],
] as const;

const MODULES = [
  { href: "/platform/tyre-lifecycle", label: "Tyre lifecycle", text: "Fitment, removal and scrap by serial and wheel position, with the reason and who recorded it." },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Daily tyre checks on the phone, offline, with photos, condition and pressure." },
  { href: "/platform/fleet-assets", label: "Fleet and assets", text: "Odometer and engine-hour readings that every tyre's kilometres are measured against." },
  { href: "/platform/maintenance", label: "Maintenance and workshop", text: "A tyre defect becomes a job card the workshop can see and close." },
  { href: "/platform/inventory", label: "Inventory and reporting", text: "Tyre stock by site, store issues and cost per km reports by brand and size." },
  { href: "/security", label: "Access by country and site", text: "A site tyre team sees its own vehicles, and each country reports in its own currency.", cta: "See security" },
] as const;

const START = [
  { need: true, label: "Your asset list", text: "Vehicle and machine codes, types and sites. An Excel export is enough." },
  { need: true, label: "Wheel layouts per vehicle type", text: "We set up axles and positions for your mixers, pumps and trucks before go-live." },
  { need: false, label: "Existing tyre records", text: "Serials, fitment dates and kilometres from a spreadsheet or ERP export, if you have them." },
  { need: false, label: "Odometer readings", text: "Drivers log meters with a photo, or we load a file exported from your telematics system. A direct telematics connection is planned." },
  { need: false, label: "RFID tags", text: "Useful when serials wear off. Typed or scanned serials work without tags." },
  { need: false, label: "Tyre purchase lines", text: "Your ERP expense export turns kilometres into cost per km by brand and size." },
] as const;

const FAQ: Faq = [
  ["Do we need RFID tags to start?", "No. Each tyre is tracked by its serial number and wheel position. RFID makes the read faster where serials are hard to see, and you can add tags later."],
  ["Does Tyre Pulse read live TPMS pressure?", "Not today. Live TPMS is planned. Pressure is recorded at each inspection, and a tyre reading low against the others on the same vehicle is flagged in the inspection report."],
  ["How is cost per kilometre calculated?", "Tyre cost divided by the kilometres the tyre ran between fitment and removal, from your odometer readings. Plant measured in hours uses cost per engine hour instead."],
] as const;

export default function TyreManagementPage() {
  return (
    <PageFrame>
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Solutions", path: "/solutions" }, { name: "Tyre management", path: PATH }])} />
      <PageTop photo="loader" photoPosition="30% 60%"
        crumbs={[{ href: "/", label: "Home" }, { href: "/solutions", label: "Solutions" }, { label: "Tyre management" }]}
        title="Know what every tyre costs per kilometre."
        lead="Tyre management for GCC fleets: each tyre tracked by serial and wheel position, tyre life forecast from kilometres and hours run, and pressure checked at every inspection."
      />
      <Problem id="tm-problem" title="Tyres are a top running cost with the least data behind them." text="In heat, heavy loads and off-road site access, tyres wear fast and fail without much warning. Most fleets know what they spent on tyres last year, but not which tyre, on which wheel, ran how far." pains={PAINS} />
      <Steps id="tm-how" title="How tyre management works in Tyre Pulse." lead="The tyre man, the workshop and the fleet manager read and write the same tyre record." steps={STEPS} />
      <TourBand id="tm-tour" title="Follow a tyre from the first scan to the brand decision." only={["tyres", "inspection"]} />
      <Modules id="tm-modules" title="The modules behind it." items={MODULES} />
      <StartList id="tm-start" title="What you need to start." lead="Tyre tracking runs on your asset list and wheel layouts. Everything else adds detail when you have it." items={START} />
      <FaqBlock id="tm-faq" title="Questions tyre teams ask." faq={FAQ} />
      <CtaBand title="Find your most expensive tyre per kilometre." text="Send your tyre records and a month of odometer readings. We show cost per km by brand on your own fleet." button="Book a tyre data review" />
    </PageFrame>
  );
}
