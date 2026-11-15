import type { Metadata } from "next";
import { Activity, CircleDot, Gauge, Radio, ScanLine, Search, ShieldCheck, Sparkles, TrendingDown } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop, SubNav } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { TourBand } from "@/components/TourBand";
import { WheelBoard } from "@/components/product/WheelBoard";
import { StoryScreen } from "@/components/product/StoryScreens";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { CapabilityList, FaqList, Section } from "@/components/ui/Section";
import { StatusLegend } from "@/components/ui/StatusBadge";
import { JsonLd, alternatesFor, breadcrumbSchema, faqSchema } from "../../schema";
import type { Faq } from "@/lib/faqs";
import { OG_IMAGES } from "@/lib/site";

const PATH = "/platform/tyre-lifecycle";
const TITLE = "Tyre lifecycle and serial tracking";
const DESCRIPTION = "Track every tyre by serial and wheel position from fitment to removal, with cost per km or engine hour, tyre life, warranty and root cause on one record.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const TRACK: CardProps[] = [
  { icon: ScanLine, title: "Serial tracking", text: "Each tyre has one record by serial number. Scan or type the serial to open its history across vehicles and positions.", status: "available" },
  { icon: CircleDot, title: "Fitment to removal", text: "Fitted and removed by wheel position with the odometer or hour meter, the removal reason and who recorded it. One active tyre per wheel.", status: "available" },
  { icon: Gauge, title: "Cost per km or engine hour", text: "The price paid over the distance the tyre ran, by brand and size. Plant that works by the hour is measured per engine hour.", status: "available" },
  { icon: TrendingDown, title: "Tyre life and forecast", text: "Kilometres or hours run against the expected life for that tyre size and vehicle type, with the tyres due next listed first.", status: "available" },
  { icon: ShieldCheck, title: "Warranty claims", text: "Early failures become a warranty claim with the supplier, tracked from submission to credit.", status: "available" },
  { icon: Search, title: "Root cause analysis", text: "A failure is recorded with its cause and a corrective action assigned to a person.", status: "available" },
];

const MORE = [
  ["Scrap register", "Scrapped tyres with the reason, who marked them and when, and an undo for administrators.", "available"],
  ["Tyre data import", "Serials, fitment dates and kilometres from your Excel or ERP export, checked for duplicates.", "available"],
  ["Live TPMS pressure", "Pressure readings received through your telematics connection.", "on-request"],
  ["RFID reads", "Tag reads as a faster way to open a tyre record. Serials work without tags.", "on-request"],
] as const;

const FAQ: ReadonlyArray<Faq> = [
  ["What does the forecast use?", "The kilometres or engine hours a tyre has run, against the expected life for that size and vehicle type. Expected life comes from your own removed tyres, or from a target you set."],
  ["Do we need RFID tags or TPMS sensors?", "No. Tyres are tracked by serial number and wheel position. TPMS pressure through telematics and RFID reads are set up on request."],
  ["What if we do not know what a tyre cost?", "It stays marked as cost pending. Cost per km is reported only for tyres with a known price, and the report says how many that covers."],
];

export default function TyreLifecyclePage() {
  return (
    <PageFrame>
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Platform", path: "/platform" }, { name: "Tyre lifecycle", path: PATH }])} />
      <JsonLd data={faqSchema(FAQ, PATH)} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: "Tyre lifecycle" }]}
        title="Every tyre, from fitment to removal, on one record."
        lead="Tyres are tracked by serial and wheel position, so you know how far each one ran, why it came off and what it cost per kilometre."
        visual={<WheelBoard />}
      />
      <Section id="track-h" title="What the tyre record holds.">
        <SubNav items={[["#track-h", "Tracking"], ["#cost", "Cost and life"], ["#ai", "AI-assisted inspection"], ["#more", "More capabilities"]]} />
        <CardGrid cols={3}>{TRACK.map((c) => <Card key={c.title} {...c} />)}</CardGrid>
        <StatusLegend />
      </Section>
      <Section id="cost" tone="soft" title="Cost per km that names its basis.">
        <div className="tp-feature">
          <div>
            <h3>A figure that shows its working.</h3>
            <p>Cost per km is the price paid for the tyre divided by the kilometres it ran between fitment and removal. Each tyre carries one price, and the report states how many tyres had a known price.</p>
            <ul className="tick-list">
              <li><Activity size={18} aria-hidden="true" />Per km for road vehicles, per engine hour for plant</li>
              <li><Activity size={18} aria-hidden="true" />By brand, size, vehicle type and site</li>
              <li><Activity size={18} aria-hidden="true" />Each country in its own currency, never blended</li>
            </ul>
          </div>
          <div className="tp-feature-media"><StoryScreen step={5} /></div>
        </div>
      </Section>
      <Section id="ai" title="AI-assisted inspection.">
        <div className="tp-feature is-flip">
          <div>
            <h3><Sparkles size={20} aria-hidden="true" /> A second look at every tyre photo.</h3>
            <p>Photos taken during a tyre inspection are analysed for visible defects such as cuts, bulges and uneven wear. The result is there for your team to review alongside the inspector&apos;s own finding.</p>
            <p>It supports the inspection. The inspector&apos;s reading and the supervisor&apos;s approval remain the record.</p>
          </div>
          <div className="tp-feature-media"><StoryScreen step={1} /></div>
        </div>
      </Section>
      <Section id="more" tone="soft" title="More in the tyre module.">
        <div className="tp-two">
          <CapabilityList items={MORE} />
          <div className="tp-prose">
            <p><Radio size={16} aria-hidden="true" /> Live TPMS pressure reaches Tyre Pulse through your telematics provider, so it depends on the sensors and the connection you already run.</p>
            <p>Without it, pressure is recorded at each inspection and compared with the other tyres on the same vehicle.</p>
          </div>
        </div>
      </Section>
      <TourBand id="tyre-tour" title="See a tyre inspection, step by step." only={["inspection", "tyres"]} />
      <Section id="tyre-faq" title="Questions tyre teams ask.">
        <FaqList items={FAQ} />
      </Section>
      <CtaBand title="Find your most expensive tyre per kilometre." text="Send your tyre records and a month of odometer readings. We show cost per km by brand on your own fleet." button="Book a tyre data review" />
    </PageFrame>
  );
}
