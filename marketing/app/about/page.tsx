import type { Metadata } from "next";
import { Building2, Globe2, Smartphone, Truck } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { ProofStrip } from "@/components/ProofStrip";
import { RolesShowcase } from "@/components/RolesShowcase";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { CapabilityList, Section } from "@/components/ui/Section";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { ROLES } from "@/lib/roles";
import { IOS_STATEMENT, OG_IMAGES } from "@/lib/site";

const PATH = "/about";
const DESCRIPTION = "Tyre Pulse is an operations platform for tyres, plant, machinery and vehicles. What it is, who it is for and where it runs today.";

export const metadata: Metadata = {
  title: { absolute: "About Tyre Pulse: one record for tyres and fleets" },
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: "About Tyre Pulse", description: DESCRIPTION, url: PATH, type: "website" },
};

const WHO: CardProps[] = [
  { icon: Truck, title: "Fleets that run on tyres and uptime", text: "Transit mixers, pumps, loaders, trucks and buses, where a tyre failure or a late service stops production." },
  { icon: Building2, title: "Operations with more than one site", text: "Each site sees its own machines and stores, and the head office sees every site without merging spreadsheets." },
  { icon: Globe2, title: "Groups working across countries", text: "Each country reports in its own currency and sees its own records. English and Arabic are both supported." },
  { icon: Smartphone, title: "Teams that work away from a desk", text: "Drivers, tyre fitters and technicians record their work on the phone, with or without signal." },
];

const WHERE = [
  ["Web application", "For managers, supervisors, stores and the office.", "available"],
  ["Android app", "The field app, on Google Play.", "available"],
  ["iOS app", IOS_STATEMENT, "planned"],
] as const;

export default function AboutPage() {
  return (
    <PageFrame>
      <JsonLd data={pageBreadcrumb("About", PATH)} />
      <PageTop photo="riyadh" photoPosition="30% 90%"
        crumbs={[{ href: "/", label: "Home" }, { label: "About" }]}
        title="An operating record for tyres, plant, machinery and vehicles."
        lead="Tyre Pulse connects the people who inspect, repair, supply and manage a fleet, so each machine and each tyre has one history that everyone works from."
      />
      <Section id="what-h" title="What Tyre Pulse is.">
        <div className="tp-two">
          <div className="tp-prose">
            <p>It is a hosted platform with a web application and a field app. It holds the asset register, tyre records, inspections, workshop job cards, stores and costs of a fleet in one place.</p>
            <p>It was built inside a working ready-mix concrete operation that runs mixers, pumps and batching plants in Saudi Arabia, the UAE and Egypt, and it carries that operation&apos;s daily work today.</p>
            <p>The same platform is configured for other fleets by asset type, site structure, roles and approval steps.</p>
          </div>
          <CapabilityList items={WHERE} />
        </div>
      </Section>
      <Section id="who-h" tone="soft" title="Who it is for.">
        <CardGrid cols={4}>{WHO.map((c) => <Card key={c.title} {...c} />)}</CardGrid>
      </Section>
      <Section id="roles-h" title="Each role opens the app to its own work." lead="Seven roles work on the same record, and nobody sees another country or site unless they are allowed to.">
        <RolesShowcase roles={ROLES} />
      </Section>
      <ProofStrip id="about-proof" title="In daily use, on real machines." text="These figures come from the operation Tyre Pulse runs in today." />
      <CtaBand title="See whether it fits your fleet." text="Tell us your asset types, sites and countries. The demo is built around them." />
    </PageFrame>
  );
}
