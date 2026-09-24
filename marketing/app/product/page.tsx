import type { Metadata } from "next";
import Image from "next/image";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Activity, BarChart3, Boxes, ClipboardCheck, Gauge, ShieldCheck, Truck, Workflow, Wrench } from "lucide-react";
import { PageFrame } from "@/components/PageFrame";
import { JsonLd, alternatesFor, pageBreadcrumb } from "../schema";
import { CTA } from "@/components/CTA";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Explore the eight Tyre Pulse capability groups: tyre and fleet lifecycle, maintenance and workshop, digital inspections, inventory and procurement, approvals, reporting, tenant control and AI automation.",
  alternates: alternatesFor("/product"),
  openGraph: {
    title: "Product | Tyre Pulse",
    description: "One system for tyre, fleet and workshop control, from field capture through approval to executive reporting.",
    url: "/product",
    type: "website",
  },
};

const groups = [
  [Truck, "Tyre and fleet lifecycle", "tyre-lifecycle", "Manage assets, tyre identity, fitment, pressure, tread, damage, repair, warranty, transfer, replacement and disposal with complete history."],
  [Wrench, "Maintenance and workshop", "workshop", "Plan preventive work, control job cards, record labour and parts, monitor downtime, technician workload, bay utilization and repair quality."],
  [ClipboardCheck, "Digital inspections", "inspections", "Create role-based inspection flows with photos, readings, defects, drafts, signatures, offline work, approval and corrective action."],
  [Boxes, "Inventory and procurement", "inventory", "Connect tyre and spare-parts stock with issues, returns, transfers, requests, quotation comparison, purchasing and vendor performance."],
  [Workflow, "Approvals and organization", "approvals", "Resolve approvers by company, country, site, department, role, risk and financial authority with delegation and audit history."],
  [BarChart3, "Reports and executive intelligence", "executive-report", "Build KPI dashboards, scheduled reports, live TV displays, secure links and white-layout PDF, PPTX and Excel outputs."],
  [ShieldCheck, "Access and tenant control", "access-control", "Separate organizations and restrict users by role, location, record, field, device and approval authority."],
  [Activity, "AI and automation", "ai-automation", "Generate concise data-backed findings, root causes and recommended actions while tracking models, cost, tokens and background jobs."],
];

/**
 * Extra screenshots for a capability group, beyond the one named after its own
 * slug. `scheduled-reports.png` was captured and then shipped unreferenced: it
 * sat in public/ and no page rendered it. It belongs to the reporting group.
 */
const EXTRA_SHOTS: Record<string, readonly string[]> = {
  "executive-report": ["scheduled-reports"],
};

/**
 * A capability group shows the real screenshots that exist for it, and shows
 * nothing when there are none. Capture them with
 * `node scripts/capture-marketing-screenshots.mjs`, which writes the slugs
 * used above into public/screenshots/.
 *
 * Resolved at build time rather than guessed, because a missing file would
 * otherwise ship a broken image to a page whose whole job is to look credible.
 * Every page here is statically prerendered, so this runs once at build.
 */
function shotsFor(slug: string): string[] {
  return [slug, ...(EXTRA_SHOTS[slug] ?? [])]
    .map((name) => `/screenshots/${name}.png`)
    .filter((rel) => existsSync(join(process.cwd(), "public", rel)));
}

export default function ProductPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Product", "/product")} />
    <section className="page-hero" id="main-content" tabIndex={-1}><div className="site-shell"><span className="eyebrow">Product platform</span><h1 className="display">One system for tyre, fleet and workshop control.</h1><p className="lead">Move from scattered files and disconnected workflows to one structured operating system for field teams and management.</p></div></section>
    <section className="page-content"><div className="site-shell feature-list">
      {groups.map(([Icon, title, slug, text]) => {
        const C = Icon as typeof Gauge;
        const shots = shotsFor(String(slug));
        return <article className="card feature-row" key={String(title)}>
          <div className="icon-box"><C /></div>
          <div>
            <h2 className="h3">{String(title)}</h2>
            <p className="muted">{String(text)}</p>
            {shots.map((shot, i) => <div className="product-window feature-shot" key={shot}><Image src={shot} alt={i === 0 ? `Tyre Pulse ${String(title).toLowerCase()} screen` : `A second Tyre Pulse ${String(title).toLowerCase()} screen`} width={1600} height={900} loading="lazy" sizes="(max-width: 900px) 100vw, 640px" /></div>)}
          </div>
        </article>;
      })}
    </div></section>
    <CTA />
  </PageFrame>;
}
