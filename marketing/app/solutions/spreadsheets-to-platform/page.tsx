import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { PageTop } from "@/components/PageTop";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd, alternatesFor, breadcrumbSchema } from "../../schema";
import { OG_IMAGES } from "@/lib/site";
import { FaqBlock, Modules, Problem, StartList, Steps, type Faq } from "../SolutionParts";

const PATH = "/solutions/spreadsheets-to-platform";
const TITLE = "Fleet spreadsheets vs maintenance software vs Tyre Pulse";
const DESCRIPTION = "A factual comparison of running a fleet on spreadsheets, on a generic maintenance tool, or on Tyre Pulse, and how to move your files across.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor(PATH),
  openGraph: { images: OG_IMAGES, title: `${TITLE} | Tyre Pulse`, description: DESCRIPTION, url: PATH, type: "website" },
};

const PAINS = [
  ["Several copies of the truth", "The site in Dammam keeps its own tyre sheet, the workshop keeps another, and month end is spent reconciling them."],
  ["No trail behind a number", "When a cell changes, the file rarely records who changed it, when, or what it said before."],
  ["The field cannot reach it", "A tyre man on a remote site with no signal cannot update a shared file, so readings arrive days late or not at all."],
] as const;

/* Each row is a capability a fleet manager asks about. Cells describe the typical case and say so where it varies. */
const ROWS = [
  ["Tyre history by serial and wheel position", "Possible with discipline, one row per fitment, kept by hand.", "Varies by product. Tyres are often held as stock parts without a wheel position.", "Built in: fitment, removal and scrap by serial, position and odometer."],
  ["Cost per km by tyre brand and size", "Needs formulas joining purchases to odometer readings, maintained by hand.", "Usually needs custom reports or an export to a spreadsheet.", "Reported directly, per km for vehicles and per engine hour for plant."],
  ["Field capture with no signal", "No. Shared files need a connection to update.", "Varies by product. Many mobile apps need a connection.", "The Android app works offline and syncs when the signal returns."],
  ["Defect to job card", "Manual: someone copies the defect into the workshop sheet.", "Often supported where inspections and work orders are in the same product.", "A defect on an inspection raises a tracked action or work order."],
  ["Several countries and currencies", "Separate files or tabs, with totals mixed by hand.", "Varies by product.", "Each country reports in its own currency, and totals are never blended."],
  ["Who can see what", "File sharing settings, usually all or nothing per file.", "Role-based access is common. Site-level limits vary.", "Access by company, country, site and role, enforced in the database."],
  ["Change history", "Limited to the file's version history, if enabled.", "Usually an audit log on records.", "Sign-ins, approvals, access changes and exports are written to an audit trail."],
  ["Setup effort", "Lowest. Anyone can start a sheet today.", "Moderate. Configuration and data loading are needed.", "Moderate. We import your asset list, job cards and tyre files during onboarding."],
] as const;

const STEPS = [
  ["Send us your files as they are.", "Asset lists, tyre sheets, job card and expense exports. Columns do not need renaming first."],
  ["We map and check them.", "Columns are matched to the right fields, duplicates are flagged before import, and every upload is logged."],
  ["Your teams work in one place.", "The field captures on the phone, the office works on the web, and the spreadsheets become exports instead of the record."],
] as const;

const MODULES = [
  { href: "/platform", label: "Platform overview", text: "Every module the spreadsheets are replacing, in one connected system." },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Phone checklists that replace the paper form and the end-of-day typing." },
  { href: "/platform/inventory", label: "Inventory and reporting", text: "Stock, purchasing and the reports you currently build by hand." },
] as const;

const START = [
  { need: true, label: "Your current spreadsheets", text: "Whatever you track today. Messy files are normal and expected." },
  { need: true, label: "A list of users and sites", text: "Who works where, so access can be set by site and role from day one." },
  { need: false, label: "ERP exports", text: "Job cards and expense lines, if your ERP holds them." },
  { need: false, label: "One owner per country", text: "A person who confirms the imported records match reality before go-live." },
] as const;

const FAQ: Faq = [
  ["When is a spreadsheet still the right tool?", "When one person owns the fleet record, the fleet is small, and nobody in the field needs to update it. Once several sites, roles or countries edit the same data, the copies start to disagree."],
  ["Will we lose our historical data?", "No. Historical tyre, job card and expense records are imported, and duplicates are checked before anything is saved. Your original files stay with you."],
  ["Can we still export to Excel?", "Yes. Every register exports to Excel and PDF, so existing reports and habits can carry on."],
] as const;

export default function SpreadsheetsToPlatformPage() {
  return (
    <PageFrame>
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Solutions", path: "/solutions" }, { name: "Spreadsheets to platform", path: PATH }])} />
      <PageTop
        crumbs={[{ href: "/", label: "Home" }, { href: "/solutions", label: "Solutions" }, { label: "Spreadsheets to platform" }]}
        title="Move your fleet off spreadsheets without losing a row."
        lead="A factual comparison of spreadsheets, generic maintenance software and Tyre Pulse, and what moving your files across involves."
      />
      <Problem id="sp-problem" title="Spreadsheets break when more people need the same fleet record." text="A spreadsheet is fast to start and flexible. The cost appears when sites, workshops and finance each keep their own copy and the field cannot update it from where the work happens." pains={PAINS} />
      <section className="section-pad soft-bg" aria-labelledby="sp-compare">
        <div className="site-shell">
          <h2 className="sec-h" id="sp-compare">How the three approaches compare.</h2>
          <p className="panel-text">Generic maintenance tools differ widely, so that column describes the typical case. Check any specific product against your own list.</p>
          <div className="sol-table-wrap" role="region" aria-labelledby="sp-compare" tabIndex={0}>
            <table className="sol-table">
              <caption>Capability by approach for a multi-site PMV fleet</caption>
              <thead>
                <tr><th scope="col">Capability</th><th scope="col">Spreadsheets</th><th scope="col">Generic maintenance tool</th><th scope="col">Tyre Pulse</th></tr>
              </thead>
              <tbody>
                {ROWS.map(([cap, sheet, generic, us]) => (
                  <tr key={cap}><th scope="row">{cap}</th><td>{sheet}</td><td>{generic}</td><td className="sol-us">{us}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <Steps id="sp-how" title="How the move works." lead="Most of the work is ours: you send the files, we map them, your team checks the result." steps={STEPS} />
      <Modules id="sp-modules" title="Where your spreadsheets end up." items={MODULES} />
      <StartList id="sp-start" title="What you need to start." lead="Bring the files you already have. Nothing needs cleaning first." items={START} />
      <FaqBlock id="sp-faq" title="Questions before leaving spreadsheets." faq={FAQ} />
      <CtaBand title="See your own spreadsheets as one fleet record." text="Send one site's tyre and job card files. We show them imported and checked in a demo." button="Book an import demo" />
    </PageFrame>
  );
}
