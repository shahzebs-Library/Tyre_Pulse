import type { Metadata } from "next";
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
  [Truck, "Tyre and fleet lifecycle", "Manage assets, tyre identity, fitment, pressure, tread, damage, repair, warranty, transfer, replacement and disposal with complete history."],
  [Wrench, "Maintenance and workshop", "Plan preventive work, control job cards, record labour and parts, monitor downtime, technician workload, bay utilization and repair quality."],
  [ClipboardCheck, "Digital inspections", "Create role-based inspection flows with photos, readings, defects, drafts, signatures, offline work, approval and corrective action."],
  [Boxes, "Inventory and procurement", "Connect tyre and spare-parts stock with issues, returns, transfers, requests, quotation comparison, purchasing and vendor performance."],
  [Workflow, "Approvals and organization", "Resolve approvers by company, country, site, department, role, risk and financial authority with delegation and audit history."],
  [BarChart3, "Reports and executive intelligence", "Build KPI dashboards, scheduled reports, live TV displays, secure links and white-layout PDF, PPTX and Excel outputs."],
  [ShieldCheck, "Access and tenant control", "Separate organizations and restrict users by role, location, record, field, device and approval authority."],
  [Activity, "AI and automation", "Generate concise data-backed findings, root causes and recommended actions while tracking models, cost, tokens and background jobs."],
];

export default function ProductPage() {
  return <PageFrame>
    <JsonLd data={pageBreadcrumb("Product", "/product")} />
    <section className="page-hero" id="main-content" tabIndex={-1}><div className="site-shell"><span className="eyebrow">Product platform</span><h1 className="display">One system for tyre, fleet and workshop control.</h1><p className="lead">Move from scattered files and disconnected workflows to one structured operating system for field teams and management.</p></div></section>
    <section className="page-content"><div className="site-shell feature-list">
      {groups.map(([Icon, title, text]) => { const C = Icon as typeof Gauge; return <article className="card feature-row" key={String(title)}><div className="icon-box"><C /></div><div><h2 className="h3">{String(title)}</h2><p className="muted">{String(text)}</p></div></article>; })}
    </div></section>
    <CTA />
  </PageFrame>;
}
