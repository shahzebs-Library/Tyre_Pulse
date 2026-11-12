import type { Metadata } from "next";
import { CalendarClock, FileSpreadsheet, LayoutDashboard, MonitorPlay, PieChart, Presentation } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { TourBand } from "@/components/TourBand";
import { FleetCostPanel } from "@/components/mock/Screens";
import { StoryScreen } from "@/components/product/StoryScreens";
import { Card, CardGrid, type CardProps } from "@/components/ui/Card";
import { CapabilityList, Section } from "@/components/ui/Section";
import { StatusLegend } from "@/components/ui/StatusBadge";
import { JsonLd, alternatesFor, breadcrumbSchema } from "../../schema";
import { OG_IMAGES } from "@/lib/site";

const PATH = "/platform/reports";
const TITLE = "Reports and dashboards";
const DESCRIPTION = "Fleet dashboards, scheduled email reports and shareable boards for a workshop screen, built from the records your teams already enter.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const AREAS: CardProps[] = [
  { icon: LayoutDashboard, title: "Dashboards", text: "Availability, open jobs, tyres due, inspections and cost on one screen, filtered by country, site and period.", status: "available" },
  { icon: CalendarClock, title: "Scheduled reports", text: "A report emailed daily, weekly or monthly to the people you choose, without anyone building it by hand.", status: "available" },
  { icon: MonitorPlay, title: "Shareable boards", text: "A read-only board link for a workshop TV or a manager, with an optional password and expiry date.", status: "available" },
  { icon: PieChart, title: "Tyre and cost KPIs", text: "Cost per km or engine hour, tyre life, removal reasons and spend by tyres, parts and oil.", status: "available" },
  { icon: FileSpreadsheet, title: "Excel and PDF exports", text: "Registers export to Excel and PDF, so a list on screen becomes a file you can send.", status: "available" },
  { icon: Presentation, title: "Management reports", text: "A board report with charts and findings, exported to PDF or PowerPoint.", status: "available" },
];

const MORE = [
  ["Custom report layouts", "Choose the sections, charts and columns a report carries, and save the layout.", "available"],
  ["Per-country currency", "Money is reported in each country's own currency and is never added across currencies.", "available"],
  ["Reports built for your process", "A layout or KPI specific to your company, scoped with you.", "on-request"],
  ["Data feeds to your BI tool", "An export or API feed into the reporting tool you already use.", "on-request"],
] as const;

export default function ReportsPage() {
  return (
    <PageFrame>
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Platform", path: "/platform" }, { name: TITLE, path: PATH }])} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/platform", label: "Platform" }, { label: TITLE }]}
        title="Reports your managers read, from records your teams already keep."
        lead="Dashboards, scheduled reports and shareable boards are built from the same inspections, job cards and expense lines. Nobody retypes a number."
        visual={<div className="hc-panel"><FleetCostPanel /></div>}
      />
      <Section id="areas-h" title="Three ways to see the numbers.">
        <CardGrid cols={3}>{AREAS.map((c) => <Card key={c.title} {...c} />)}</CardGrid>
        <StatusLegend />
      </Section>
      <Section id="sched" tone="soft" title="The monthly report sends itself.">
        <div className="tp-feature">
          <div>
            <h3>Set it once.</h3>
            <p>Pick the report, how often it goes and who receives it. It arrives as an email summary, with the full report one click away in the app.</p>
            <CapabilityList items={MORE} />
          </div>
          <div className="tp-feature-media"><StoryScreen step={6} /></div>
        </div>
      </Section>
      <TourBand id="report-tour" title="From an expense line to cost per machine." only={["cost"]} />
      <CtaBand title="See your own month as a report." text="Send a month of job cards and expense lines. We build the report in the demo." button="Book a demo on your data" />
    </PageFrame>
  );
}
