import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Gauge, Globe2, Layers3,
  ShieldCheck, Smartphone, Sparkles, Truck, Wrench, Workflow, CircleDollarSign
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Hero3D } from "@/components/Hero3D";
import { SectionTitle } from "@/components/SectionTitle";
import { CTA } from "@/components/CTA";

const features = [
  { icon: Truck, title: "Tyre lifecycle control", text: "Track fitment, removal, pressure, tread, repairs, warranty, scrap and cost per kilometre from one history." },
  { icon: Wrench, title: "Workshop intelligence", text: "Control open job cards, downtime, technician workload, blocked hours, parts delays and completion quality." },
  { icon: ClipboardCheck, title: "Field inspections", text: "Give inspectors and tyre teams mobile workflows with photos, signatures, drafts, approvals and offline continuity." },
  { icon: BarChart3, title: "Executive reporting", text: "Turn operational records into KPI scorecards, white-label reports, PPTX exports and live display dashboards." },
  { icon: Workflow, title: "Approval workflows", text: "Route work by country, site, department, role, risk and financial limit without hardcoding employee names." },
  { icon: ShieldCheck, title: "Enterprise access", text: "Keep organizations isolated while controlling roles, locations, sensitive fields, exports and approval authority." },
];

const checks = [
  "One data source for dashboards, PDF, PPTX and Excel",
  "Country, site and role-aware access and approvals",
  "Arabic RTL, English LTR and multi-country structure",
  "Web, Android, PWA and executive TV experiences",
];

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <section className="hero">
          <div className="site-shell hero-grid">
            <div className="hero-copy">
              <span className="eyebrow"><Sparkles size={15} /> Fleet intelligence built around real operations</span>
              <h1 className="display">Control every tyre. Understand every cost.</h1>
              <p className="lead">Tyre Pulse connects tyre lifecycle, fleet maintenance, workshop control, inspections, approvals and executive reporting in one commercial platform.</p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href="/contact">Book a tailored demo <ArrowRight size={18} /></Link>
                <Link className="btn btn-secondary" href="/product">Explore the platform</Link>
              </div>
              <div className="hero-proof">
                <span><CheckCircle2 size={17} color="#0b9b6c" /> Multi-company and multi-country</span>
                <span><CheckCircle2 size={17} color="#0b9b6c" /> Built for field and management teams</span>
                <span><CheckCircle2 size={17} color="#0b9b6c" /> English and Arabic</span>
              </div>
            </div>
            <div className="hero-stage">
              <Hero3D />
              <div className="floating-panel panel-one"><span className="muted">Fleet availability</span><strong>Live KPI</strong><span style={{ color: "var(--success)" }}>Target, trend and variance</span></div>
              <div className="floating-panel panel-two"><span className="muted">Tyre cost control</span><strong>CPK + lifecycle</strong><span>From purchase to final disposal</span></div>
            </div>
          </div>
        </section>

        <section className="section-tight">
          <div className="site-shell">
            <p className="muted" style={{ textAlign: "center", marginBottom: 18 }}>Designed for operations that cannot rely on scattered spreadsheets</p>
            <div className="logo-strip">
              {["Construction Fleets", "Transport & Logistics", "Ready-Mix Operations", "Heavy Equipment", "Workshop Networks"].map(x => <div className="logo-chip" key={x}>{x}</div>)}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="site-shell">
            <SectionTitle eyebrow="One operational platform" title="Built around the work your teams actually perform." text="Tyre Pulse keeps field activity, approvals, inventory, maintenance and management reporting connected instead of creating another disconnected dashboard." />
            <div className="grid-3">
              {features.map(({ icon: Icon, title, text }) => <article className="card feature-card" key={title}><div className="icon-box"><Icon /></div><h3 className="h3">{title}</h3><p>{text}</p></article>)}
            </div>
          </div>
        </section>

        <section className="section" style={{ background: "rgba(255,255,255,.58)" }}>
          <div className="site-shell product-showcase">
            <div>
              <span className="eyebrow">Executive clarity</span>
              <h2 className="h2">Less reporting work. Better management decisions.</h2>
              <p className="lead">Build reports from the same approved data users see on screen. Keep the focus on targets, variance, cost, root cause and the next action.</p>
              <div className="check-list">
                {checks.map(c => <div className="check-item" key={c}><CheckCircle2 size={20} /><span>{c}</span></div>)}
              </div>
              <div className="hero-actions"><Link className="btn btn-dark" href="/product">See reporting capabilities <ArrowRight size={17} /></Link></div>
            </div>
            <div className="product-window"><Image src="/screenshots/executive-report.png" alt="Tyre Pulse executive intelligence report" width={1600} height={900} /></div>
          </div>
        </section>

        <section className="section dark-section">
          <div className="site-shell">
            <SectionTitle eyebrow="Connected execution" title="From field action to executive visibility." text="Each workflow keeps responsibility, evidence, time, cost and approval history connected." />
            <div className="workflow">
              {[
                ["01", "Capture", "Inspection, job card, tyre event, accident or request."],
                ["02", "Route", "Assign the right person by location, role and authority."],
                ["03", "Control", "Track progress, blockers, cost, SLA and approval."],
                ["04", "Understand", "Convert results into KPIs, risks and actions."],
              ].map(([n,t,d]) => <div className="workflow-step" key={n}><span className="n">{n}</span><h3 className="h3">{t}</h3><p className="muted">{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="site-shell">
            <SectionTitle eyebrow="Management intelligence" title="Numbers first. Root cause next. Action always." text="Dashboards and AI insights are designed to help managers act, not read long generic summaries." />
            <div className="insight-grid">
              <div className="card insight-large">
                <div><div className="icon-box"><Gauge /></div><h3 className="h3">Performance at a glance</h3><p className="muted">Compare current value, target, prior period and variance across tyre, maintenance and workshop KPIs.</p></div>
                <div className="spark" aria-label="Illustrative KPI trend"><span style={{ height: "35%" }} /><span style={{ height: "48%" }} /><span style={{ height: "44%" }} /><span style={{ height: "61%" }} /><span style={{ height: "72%" }} /><span style={{ height: "66%" }} /><span style={{ height: "84%" }} /></div>
              </div>
              <div className="insight-side">
                <div className="card insight-mini"><div className="icon-box"><CircleDollarSign /></div><h3 className="h3">Cost control</h3><p className="muted">CPK, downtime, repair, warranty and vendor performance by asset, site and country.</p></div>
                <div className="card insight-mini"><div className="icon-box"><Layers3 /></div><h3 className="h3">One source of truth</h3><p className="muted">The same controlled calculations power screens, reports, exports and executive displays.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section-tight">
          <div className="site-shell grid-4">
            {[
              [Smartphone, "Field-ready", "Mobile and PWA workflows"],
              [Globe2, "Multi-country", "Location-aware operations"],
              [ShieldCheck, "Controlled access", "Roles, scope and approvals"],
              [Sparkles, "AI-ready", "Data-backed recommendations"],
            ].map(([Icon, value, label]) => {
              const C = Icon as typeof Smartphone;
              return <div className="card metric" key={String(value)}><C color="#1368e8" /><div className="value">{String(value)}</div><div className="label">{String(label)}</div></div>;
            })}
          </div>
        </section>

        <CTA />
      </main>
      <Footer />
    </>
  );
}
