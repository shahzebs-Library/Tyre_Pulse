import { Link } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Boxes, ClipboardCheck, Fuel, Gauge, HardHat,
  ShieldCheck, Truck, Wrench,
} from 'lucide-react'
import TpLogo from '../assets/logo.svg'

const capabilities = [
  { icon: Truck, title: 'Fleet and assets', text: 'Keep equipment, vehicles, sites, meters, documents and lifecycle events together.' },
  { icon: Gauge, title: 'Tyre lifecycle', text: 'Track fitments, removals, size, position, cost per kilometre and tyre condition.' },
  { icon: Wrench, title: 'Workshop and maintenance', text: 'Connect breakdowns, preventive maintenance, work orders, labour and parts.' },
  { icon: ClipboardCheck, title: 'Inspections and safety', text: 'Capture inspections, defects, evidence, approvals and accountable close-out.' },
  { icon: Boxes, title: 'Stores and procurement', text: 'Manage tyre stock by site, material issues, requisitions, suppliers and purchases.' },
  { icon: ShieldCheck, title: 'Incidents and compliance', text: 'Keep accidents, claims, insurance, driver documents and compliance records linked.' },
  { icon: Fuel, title: 'Operating costs', text: 'Understand fuel, tyres, maintenance and operating spend by asset, site and project.' },
  { icon: BarChart3, title: 'Budgets and reporting', text: 'Give teams and managers a shared view of performance, approvals and cost trends.' },
]

export default function PublicMarketingHome() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#151617]">
      <header className="border-b border-black/10 bg-[#111315] text-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8" aria-label="Main navigation">
          <Link to="/" className="flex items-center gap-3" aria-label="Tyre Pulse home">
            <img src={TpLogo} alt="" className="h-9 w-9" />
            <span className="text-lg font-extrabold tracking-tight">Tyre Pulse</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <a href="#platform" className="hidden text-sm text-white/75 hover:text-white sm:inline">Platform</a>
            <a href="#field-apps" className="hidden text-sm text-white/75 hover:text-white sm:inline">Field apps</a>
            <Link to="/contact" className="text-sm text-white/75 hover:text-white">Contact</Link>
            <Link to="/login" className="rounded-lg bg-[#f3d431] px-4 py-2.5 text-sm font-bold text-black hover:bg-[#ffe34b]">Sign in</Link>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:px-8 lg:py-24">
        <div>
          <p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-[#8a7500]">PMV fleet operations</p>
          <h1 className="max-w-2xl text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">Run every asset, team and site with a clearer picture.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#50545a]">Tyre Pulse connects fleet, workshop, maintenance, stores, inspections, safety and cost control in one operational workspace for plant, machinery and vehicles.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/contact" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-[#f3d431] px-5 font-bold text-black hover:bg-[#ffe34b]">Book a demo <ArrowRight size={18} /></Link>
            <a href="#platform" className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-black/15 px-5 font-semibold hover:bg-white">Explore the platform <ArrowRight size={17} /></a>
          </div>
          <p className="mt-6 text-sm text-[#666a70]">For construction, ready-mix, transport, equipment rental and multi-site operations.</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-[0_24px_80px_rgba(20,25,30,.12)] sm:p-6">
          <div className="flex items-center justify-between border-b border-black/10 pb-4">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-[#777b80]">Operations overview</p><h2 className="mt-1 text-xl font-extrabold">One view across the operation</h2></div>
            <span className="rounded-full bg-[#f3d431]/30 px-3 py-1 text-xs font-bold">PMV</span>
          </div>
          <div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
            {[['Assets', 'Fleet'], ['Tyres', 'Lifecycle'], ['Workshop', 'Work orders'], ['Stores', 'Stock']].map(([k, v]) => <div key={k} className="rounded-xl bg-[#f6f6f3] p-3"><p className="text-xs text-[#777b80]">{k}</p><p className="mt-2 text-sm font-bold">{v}</p><div className="mt-3 h-1.5 rounded-full bg-[#e7e7e2]"><div className="h-full w-2/3 rounded-full bg-[#e2c521]" /></div></div>)}
          </div>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-[#f6f6f3] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#777b80]"><span>Operational work</span><span>Status</span><span>Owner</span></div>
            {[["Preventive service", "Scheduled", "Workshop"], ["Tyre inspection", "Review", "Field team"], ["Parts request", "Approval", "Store"]].map(([a, b, c]) => <div key={a} className="grid grid-cols-[1.2fr_1fr_1fr] border-t border-black/5 px-3 py-3 text-xs sm:text-sm"><span className="font-semibold">{a}</span><span className="text-[#555a60]">{b}</span><span className="text-[#555a60]">{c}</span></div>)}
          </div>
        </div>
      </section>

      <section id="platform" className="border-y border-black/10 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[.2em] text-[#8a7500]">The complete PMV picture</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">One operational record from field issue to management view.</h2><p className="mt-4 leading-7 text-[#5b6066]">Bring people, assets and decisions together. Each module works on its own and connects to the records around it.</p></div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-xl border border-black/10 bg-[#fbfbf9] p-5"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#f3d431]/35"><Icon size={20} /></span><h3 className="mt-4 font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#61666c]">{text}</p></article>)}
          </div>
        </div>
      </section>

      <section id="field-apps" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:px-8">
        <div className="rounded-2xl bg-[#17191b] p-7 text-white sm:p-9"><HardHat className="text-[#f3d431]" size={28} /><p className="mt-5 text-xs font-bold uppercase tracking-[.2em] text-[#f3d431]">For the people doing the work</p><h2 className="mt-3 text-3xl font-black">Field-ready on iOS and Android.</h2><p className="mt-4 leading-7 text-white/70">Technicians and supervisors can record inspections, capture photos and readings, sign work and keep tasks moving from site. Offline work can sync when the connection returns.</p><div className="mt-6 flex flex-wrap gap-2"><span className="rounded-md border border-white/20 px-3 py-2 text-sm">iOS app</span><span className="rounded-md border border-white/20 px-3 py-2 text-sm">Android app</span><span className="rounded-md border border-white/20 px-3 py-2 text-sm">Offline-ready workflows</span></div></div>
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#8a7500]">Connected operations</p><h2 className="mt-3 text-3xl font-black tracking-tight">A useful record for every role.</h2><p className="mt-4 leading-7 text-[#5b6066]">Storekeepers, technicians, fleet managers and approvers work from the same asset and job history, with permissions suited to their role.</p><ul className="mt-6 space-y-3 text-sm text-[#454a50]">{['Asset, tyre and meter history stays connected', 'Work orders link inspections, labour and parts', 'Stock can be viewed by store and tyre size', 'Costs and reports roll up by asset, site and project'].map(x => <li key={x} className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#c4aa16]" />{x}</li>)}</ul></div>
      </section>

      <section className="bg-[#f3d431] px-5 py-10 sm:py-12"><div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between lg:px-8"><div><h2 className="text-2xl font-black">Bring every site into view.</h2><p className="mt-1 text-sm text-black/70">See how Tyre Pulse fits your fleet, workshop and operating model.</p></div><Link to="/contact" className="inline-flex min-h-12 items-center justify-center gap-3 self-start rounded-lg bg-[#17191b] px-5 font-bold text-white hover:bg-black sm:self-auto">Book a demo <ArrowRight size={18} /></Link></div></section>
      <footer className="bg-[#111315] px-5 py-6 text-sm text-white/65"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 lg:px-8"><span>© {new Date().getFullYear()} Tyre Pulse</span><div className="flex flex-wrap gap-5"><Link to="/contact" className="hover:text-white">Support & contact</Link><Link to="/privacy" className="hover:text-white">Privacy</Link><Link to="/terms" className="hover:text-white">Terms</Link><Link to="/login" className="hover:text-white">Sign in</Link></div></div></footer>
    </main>
  )
}
