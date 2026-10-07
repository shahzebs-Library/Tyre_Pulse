/**
 * Product screens drawn in HTML for the marketing pages.
 *
 * They are built from markup rather than screenshots so they stay sharp,
 * translate with the page, stay readable by assistive technology and carry no
 * image-rights question. Every one shows illustrative sample data and says so.
 */
import {
  Bell, Box, CheckCircle2, ChevronDown, CircleAlert, ClipboardCheck, Droplets, Fuel,
  Gauge, LayoutDashboard, PenLine, Plus, Search, ShieldAlert, ShoppingCart, Truck,
  Wrench, FileBarChart, Package, CircleDot, XCircle, TriangleAlert, WifiOff,
} from "lucide-react";
import {
  ASSETS, ASSET_HISTORY, INVENTORY, PARTS, PRIORITY_WORK, SPEND, STATUS_TONE, TECHNICIANS, WORK_ORDERS,
} from "@/lib/sample";
import { Photo } from "@/components/art/Photos";

export function Pill({ label, tone }: { label: string; tone?: string }) {
  return <span className={`pill pill-${tone ?? STATUS_TONE[label] ?? "grey"}`}>{label}</span>;
}

export function SampleTag() {
  return <span className="sample-tag">Sample data</span>;
}

/** Scroll container for wide tables: keyboard focusable and named. */
/**
 * `adapt` turns the wrapper into a size container so a wide sample table drops its
 * least important columns (see `.mt-adapt` in pmv.css) instead of clipping a word or
 * forcing a sideways scroll inside a small frame such as the home hero.
 */
function TableScroll({ label, children, adapt = false }: { label: string; children: React.ReactNode; adapt?: boolean }) {
  return (
    <div className={adapt ? "table-scroll table-adapt" : "table-scroll"} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

const APP_NAV = [
  ["Overview", LayoutDashboard], ["Assets", Truck], ["Maintenance", Wrench], ["Workshop", Wrench],
  ["Inspections", ClipboardCheck], ["Tyres", CircleDot], ["Inventory", Package], ["Procurement", ShoppingCart],
  ["Accidents", ShieldAlert], ["Fuel", Fuel], ["Reports", FileBarChart],
] as const;

/** The application frame: dark sidebar, top bar with site filters and search. */
export function AppWindow({ active, label, children }: { active: string; label: string; children: React.ReactNode }) {
  return (
    <figure className="app-window" aria-label={label}>
      <div className="app-chrome" aria-hidden="true"><i /><i /><i /></div>
      <div className="app-body">
        <aside className="app-side" aria-hidden="true">
          <div className="app-brand"><span className="app-brand-mark" />Tyre Pulse</div>
          {APP_NAV.map(([name, Icon]) => (
            <span key={name} className={name === active ? "on" : undefined}><Icon size={13} />{name}</span>
          ))}
        </aside>
        <div className="app-main">
          <div className="app-top" aria-hidden="true">
            <span className="app-select">Riyadh <ChevronDown size={11} /></span>
            <span className="app-select">All sites <ChevronDown size={11} /></span>
            <span className="app-search"><Search size={11} /> Search assets, work orders or people</span>
            <Bell size={14} />
            <span className="app-avatar">AA</span>
          </div>
          {children}
        </div>
      </div>
    </figure>
  );
}

export function OpsOverview() {
  const kpis = [
    ["Available assets", "142", "of 168 total assets", Truck],
    ["Open work orders", "28", "12 high priority", Wrench],
    ["PM due", "12", "in next 7 days", Gauge],
    ["Awaiting approval", "6", "purchase and costs", ClipboardCheck],
  ] as const;
  return (
    <AppWindow active="Overview" label="Sample operations overview screen">
      <div className="app-head"><strong>Operations overview</strong><SampleTag /></div>
      <div className="kpi-row">
        {kpis.map(([t, v, s, Icon]) => (
          <div className="kpi" key={t}>
            <span className="kpi-t">{t}</span>
            <span className="kpi-v">{v}</span>
            <span className="kpi-s">{s}</span>
            <Icon size={16} className="kpi-i" aria-hidden="true" />
          </div>
        ))}
      </div>
      <div className="mini-panel">
        <div className="mini-head"><strong>Priority work</strong><span className="link-sm">View all work orders</span></div>
        <div className="chips" aria-hidden="true"><b>All (28)</b><span>Overdue (8)</span><span>Due today (6)</span><span>Upcoming (14)</span></div>
        <TableScroll label="Sample priority work" adapt>
          <table className="mt mt-adapt">
            <thead><tr><th>Asset</th><th>Description</th><th className="c-cat">Category</th><th className="c-status">Status</th><th className="c-pri">Priority</th><th className="c-who">Assigned to</th><th className="c-site">Site</th><th className="c-due">Due date</th></tr></thead>
            <tbody>
              {PRIORITY_WORK.map((r) => (
                <tr key={r.asset}><td>{r.asset}</td><td>{r.desc}</td><td className="c-cat">{r.cat}</td><td className="c-status"><Pill label={r.status} /></td><td className="c-pri"><span className={`pri pri-${r.pri}`}>{r.pri}</span></td><td className="c-who">{r.who}</td><td className="c-site">{r.site}</td><td className="c-due">{r.due}</td></tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </AppWindow>
  );
}

export function AssetsWindow() {
  return (
    <AppWindow active="Assets" label="Sample assets register screen">
      <div className="app-head"><strong>Assets</strong><SampleTag /></div>
      <div className="chips" aria-hidden="true"><b>All assets</b><span>Plant</span><span>Vehicles</span><span>Attachments</span></div>
      <TableScroll label="Sample assets register">
        <table className="mt">
          <thead><tr><th>Asset</th><th>Make / model</th><th>Type</th><th>Status</th><th>Site</th><th>Hours</th></tr></thead>
          <tbody>
            {ASSETS.map((a) => <tr key={a.asset}><td>{a.asset}</td><td>{a.model}</td><td>{a.type}</td><td><Pill label={a.status} /></td><td>{a.site}</td><td>{a.hours}</td></tr>)}
          </tbody>
        </table>
      </TableScroll>
    </AppWindow>
  );
}

const KEY_INFO = [
  ["Asset type", "Wheel loader"], ["Make / model", "966-class loader"], ["Year", "2019"],
  ["Serial number", "SN-966-6Z01234"], ["Registration", "Not registered"], ["Cost centre", "CC-2010"],
  ["Department", "Operations"], ["Ownership", "Owned"], ["Current site", "Site 2"],
];

/** The single asset record, used on the home page and the fleet page. */
export function AssetRecord({ wide = false }: { wide?: boolean }) {
  const tabs = ["Overview", "History", "Work orders", "Service history", "Tyres", "Documents", "Costs"];
  return (
    <figure className={`asset-record ${wide ? "wide" : ""}`} aria-label="Sample asset record for WL-018">
      <div className="ar-head">
        <div>
          <div className="ar-title"><strong>WL-018</strong><Pill label="Active" /><SampleTag /></div>
          <span className="muted-sm">Wheel loader, 966-class, 2019, Site 2</span>
        </div>
        <span className="ghost-btn" aria-hidden="true">Actions <ChevronDown size={12} /></span>
      </div>
      <div className="ar-tabs" aria-hidden="true">{tabs.map((t, i) => <span key={t} className={i === 0 ? "on" : undefined}>{t}</span>)}</div>
      <div className="ar-body">
        <div className="ar-meta">
          <span className="muted-sm">Meter reading</span>
          <span className="ar-big">6,240 h</span>
          <span className="muted-xs">Last updated 12 Mar 2026</span>
          <span className="muted-sm" style={{ marginTop: 10 }}>Status</span>
          <Pill label="In service" />
          <span className="muted-sm" style={{ marginTop: 10 }}>Site</span>
          <span className="ar-strong">Site 2</span>
          <span className="muted-sm" style={{ marginTop: 10 }}>Ownership</span>
          <span className="ar-strong">Owned</span>
        </div>
        <div className="ar-media">
          <Photo name="loader" className="ar-photo" priority sizes="(max-width: 720px) 100vw, 560px" />
          <div className="ar-thumbs">
            <Photo name="loaderSite" className="thumb" sizes="120px" />
            <Photo name="loaderCab" className="thumb" sizes="120px" />
            <Photo name="loaderTyre" className="thumb" sizes="120px" />
            <span className="thumb more">+3</span>
            <Photo name="loaderBucket" className="thumb hide-sm" sizes="120px" />
          </div>
        </div>
        <div className="ar-info">
          <div className="ar-info-h">Key information</div>
          <dl className="ar-info-list">
            {KEY_INFO.slice(0, wide ? 9 : 7).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      </div>
    </figure>
  );
}

export function AssetStats() {
  const s = [
    ["Meter reading", "6,240 h", "Last updated 12 Mar 2026"],
    ["Status", "In service", ""],
    ["Condition", "Good", ""],
    ["Next service", "250 h", "or 15 Apr 2026"],
  ];
  return (
    <div className="asset-stats">
      {s.map(([t, v, sub]) => (
        <div key={t}>
          <span className="muted-sm">{t}</span>
          {t === "Status" || t === "Condition" ? <Pill label={v} /> : <span className="ar-big">{v}</span>}
          {sub && <span className="muted-xs">{sub}</span>}
        </div>
      ))}
    </div>
  );
}

export function AssetHistoryTable() {
  const icon: Record<string, React.ReactNode> = {
    "Meter reading": <Gauge size={13} />, Inspection: <ClipboardCheck size={13} />,
    "Work order": <Wrench size={13} />, Tyre: <CircleDot size={13} />,
  };
  return (
    <TableScroll label="Sample asset history">
      <table className="mt mt-roomy">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Hours</th><th>By</th></tr></thead>
        <tbody>
          {ASSET_HISTORY.map((r) => (
            <tr key={r.date}><td>{r.date}</td><td><span className="type-cell">{icon[r.type]}{r.type}</span></td><td>{r.desc}</td><td>{r.value}</td><td>{r.by}</td></tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/* ---------- From a field issue to a closed job ---------- */

export function NewInspectionCard() {
  return (
    <div className="flow-card" aria-label="Sample new inspection form">
      <div className="fc-head"><strong>New inspection <span className="muted-xs">WL-018</span></strong><Pill label="In progress" /></div>
      <span className="muted-xs">Inspection type</span>
      <span className="fake-input">Daily walkaround <ChevronDown size={12} /></span>
      <span className="muted-xs">Condition</span>
      <div className="cond-row"><span className="cond good on"><CheckCircle2 size={12} />Good</span><span className="cond issue"><TriangleAlert size={12} />Issue</span><span className="cond bad"><XCircle size={12} />Not safe</span></div>
      <span className="muted-xs">Comments</span>
      <span className="fake-input">Hydraulic leak at front left cylinder.</span>
      <div className="photo-row"><Photo name="loaderTyre" className="ph" sizes="120px" /><Photo name="loaderCab" className="ph" sizes="120px" /><span className="ph add"><Plus size={14} /></span></div>
    </div>
  );
}

export function ApprovalCard() {
  return (
    <div className="flow-card" aria-label="Sample work order awaiting approval">
      <div className="fc-head"><strong>Work order WO-4582</strong><Pill label="Pending approval" /></div>
      <span className="muted-xs">Asset</span><span className="fc-v">WL-018 <span className="tag">Wheel loader</span></span>
      <span className="muted-xs">Problem</span><span className="fc-v">Hydraulic leak, front left cylinder</span>
      <div className="fc-split">
        <div><span className="muted-xs">Priority</span><Pill label="High" tone="red" /></div>
        <div><span className="muted-xs">Estimated cost</span><span className="fc-v">SAR 3,250.00</span></div>
      </div>
      <span className="muted-xs">Requested by</span><span className="fc-v"><span className="avatar-sm">JT</span>J. Thompson, 12 Mar 2026</span>
      <div className="fc-actions"><span className="ghost-btn">Reject</span><span className="yellow-btn">Approve</span></div>
    </div>
  );
}

export function PartsCard() {
  return (
    <div className="flow-card" aria-label="Sample job card with parts issued">
      <div className="fc-head"><strong>Job card WO-4582</strong><Pill label="In progress" /></div>
      <div className="mini-tabs" aria-hidden="true"><span>Labour</span><span className="on">Parts</span><span>Costs</span></div>
      <span className="fake-input"><Search size={11} /> Search inventory</span>
      {PARTS.map((p) => (
        <div className="part-row" key={p.no}>
          <span className="part-ico"><Droplets size={13} /></span>
          <span><b>{p.name}</b><span className="muted-xs">Part no. {p.no}</span></span>
          <span className="qty">{p.qty}</span>
          <PenLine size={12} className="edit" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

export function CompleteCard() {
  return (
    <div className="flow-card" aria-label="Sample completed job ready to close">
      <div className="fc-head"><strong>Complete job</strong><Pill label="Ready to close" /></div>
      <span className="muted-xs">Work completed</span>
      <span className="fc-v">Hydraulic hose replaced and leak fixed. System tested, no further leaks.</span>
      <span className="muted-xs">Completion photos</span>
      <div className="photo-row"><Photo name="loaderSite" className="ph" sizes="120px" /><Photo name="loaderTyre" className="ph" sizes="120px" /><span className="ph add"><Plus size={14} /></span></div>
      <div className="fc-split">
        <div><span className="muted-xs">Meter reading</span><span className="fc-v">6,248 h</span></div>
        <div><span className="muted-xs">Date</span><span className="fc-v">12 Mar 2026</span></div>
      </div>
      <div className="fc-foot"><span className="fc-v"><span className="avatar-sm">MK</span>M. Khan</span><span className="yellow-btn">Close job</span></div>
    </div>
  );
}

/* ---------- Phones ---------- */

export function Phone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="phone" aria-label={label}>
      <div className="phone-status" aria-hidden="true"><span>10:24</span><span className="notch" /><span>5G</span></div>
      <div className="phone-screen">{children}</div>
    </figure>
  );
}

const CHECKS = [
  ["Tyres", "Check condition and damage"], ["Hydraulics", "Check for leaks"],
  ["Engine", "Check oil level and condition"], ["Lights", "Check all lights working"], ["General", "Any other issues"],
];

export function OfflineInspectionPhone({ withConditions = false }: { withConditions?: boolean }) {
  return (
    <Phone label="Sample offline inspection on the mobile app">
      <div className="ph-head"><strong>Offline inspection</strong><span className="offline"><WifiOff size={10} />Offline mode</span></div>
      {withConditions && (
        <>
          <span className="muted-xs">WL-018, daily inspection</span>
          <span className="muted-xs" style={{ marginTop: 6 }}>Meter reading</span>
          <span className="fake-input"><b>6,240 h</b></span>
        </>
      )}
      <ul className="ph-list">
        {CHECKS.slice(0, withConditions ? 3 : 5).map(([t, d], i) => (
          <li key={t}>
            <CheckCircle2 size={13} className={i < 2 ? "done" : "todo"} aria-hidden="true" />
            <span><b>{t}</b><span className="muted-xs">{d}</span>
              {withConditions && <span className="cond-row sm"><span className="cond good on">Good</span><span className="cond issue">Issue</span><span className="cond na">N/A</span></span>}
            </span>
          </li>
        ))}
      </ul>
    </Phone>
  );
}

export function Signature({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 60" aria-hidden="true">
      <path d="M8 44 C 20 10, 30 10, 28 40 S 44 58, 52 24 S 66 8, 70 38 C 72 50, 82 50, 90 30 C 96 18, 104 22, 104 34 C 104 44, 118 40, 150 30" fill="none" stroke="#161616" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Maintenance ---------- */

export function WorkOrdersTable() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Work orders</strong><SampleTag /></div>
      <div className="filter-row" aria-hidden="true">
        <span className="fake-input"><Search size={11} /> Search work orders</span>
        <span className="fake-input">All sites <ChevronDown size={11} /></span>
        <span className="fake-input">All statuses <ChevronDown size={11} /></span>
        <span className="fake-input">All priorities <ChevronDown size={11} /></span>
        <span className="yellow-btn">New work order</span>
      </div>
      <TableScroll label="Sample work orders">
        <table className="mt mt-roomy">
          <thead><tr><th>WO no.</th><th>Asset</th><th>Description</th><th>Type</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Due date</th></tr></thead>
          <tbody>
            {WORK_ORDERS.map((w) => (
              <tr key={w.wo}><td className="linkish">{w.wo}</td><td>{w.asset}</td><td>{w.desc}</td><td>{w.type}</td><td><span className={`pri pri-${w.pri}`}>{w.pri}</span></td><td><Pill label={w.status} /></td><td>{w.who}</td><td>{w.due}</td></tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

export function WorkOrderDetails() {
  const rows = [["Asset", "WL-018, wheel loader"], ["Type", "Corrective"], ["Description", "Hydraulic leak, front left cylinder"], ["Reported by", "J. Thompson, 12 Mar 2026"], ["Site", "Site 2"]];
  return (
    <div className="panel">
      <div className="panel-head"><strong>Work order details</strong><Pill label="Pending approval" /></div>
      <span className="muted-sm">WO-4582</span>
      <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        <div><dt>Priority</dt><dd><Pill label="High" tone="red" /></dd></div>
      </dl>
      <div className="kv-total"><span>Estimated cost</span><b>SAR 3,250.00</b></div>
    </div>
  );
}

export function TechAllocation() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Technician allocation</strong></div>
      <span className="fake-input">Assign technician <ChevronDown size={11} /></span>
      <ul className="tech-list">
        {TECHNICIANS.map((t) => (
          <li key={t.name}><span className="avatar-sm">{t.name.replace(/[^A-Z]/g, "")}</span><span><b>{t.name}</b><span className="muted-xs">{t.role}</span></span><Pill label={t.status} /></li>
        ))}
      </ul>
    </div>
  );
}

export function PartsLabour() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Parts and labour</strong></div>
      <div className="mini-tabs" aria-hidden="true"><span className="on">Parts (3)</span><span>Labour (1)</span></div>
      {PARTS.map((p) => (
        <div className="part-row" key={p.no}><span className="part-ico"><Box size={13} /></span><span><b>{p.name}</b><span className="muted-xs">Part no. {p.no}</span></span><span className="qty">{p.qty}</span><PenLine size={12} className="edit" aria-hidden="true" /></div>
      ))}
      <span className="link-sm"><Plus size={11} /> Add part</span>
      <div className="kv-total"><span>Estimated cost</span><b>SAR 3,250.00</b></div>
    </div>
  );
}

/* ---------- Inspections ---------- */

export function DefectCard() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Capture defects</strong></div>
      <div className="photo-row big"><Photo name="loaderTyre" className="ph" sizes="140px" /><Photo name="loaderCab" className="ph" sizes="140px" /><Photo name="loaderBucket" className="ph" sizes="140px" /></div>
      <span className="fc-v">Hydraulic leak at front left cylinder.</span>
    </div>
  );
}

export function MeterCard() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Add meter readings</strong></div>
      <span className="muted-xs">Meter reading</span>
      <span className="fake-input big"><b>6,240 h</b></span>
      <span className="muted-xs">Last: 6,226 h on 10 Mar 2026</span>
    </div>
  );
}

export function ConditionCard() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Record condition</strong></div>
      <div className="cond-row"><span className="cond good on"><CheckCircle2 size={12} />Good</span><span className="cond issue"><CircleAlert size={12} />Issue</span><span className="cond bad"><XCircle size={12} />Not safe</span></div>
    </div>
  );
}

export function SignOffCard() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Sign off</strong></div>
      <span className="muted-xs">Inspector signature</span>
      <div className="sig-pad"><Signature className="sig" /><span className="clear">Clear</span></div>
    </div>
  );
}

/* ---------- Inventory and reporting ---------- */

export function InventoryTable() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Inventory and parts</strong><SampleTag /></div>
      <div className="filter-row" aria-hidden="true">
        <span className="fake-input"><Search size={11} /> Search parts</span>
        <span className="fake-input">All categories <ChevronDown size={11} /></span>
        <span className="fake-input">All locations <ChevronDown size={11} /></span>
        <span className="fake-input">Stock level <ChevronDown size={11} /></span>
        <span className="yellow-btn">Add part</span>
      </div>
      <TableScroll label="Sample inventory">
        <table className="mt mt-roomy">
          <thead><tr><th>Part number</th><th>Description</th><th>Category</th><th>Current stock</th><th>Reorder level</th><th>Location</th><th>Unit cost</th></tr></thead>
          <tbody>
            {INVENTORY.map((r) => <tr key={r.part}><td>{r.part}</td><td>{r.desc}</td><td>{r.cat}</td><td>{r.stock}</td><td>{r.reorder}</td><td>{r.loc}</td><td>{r.cost}</td></tr>)}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

export function PurchaseRequest() {
  return (
    <div className="panel">
      <div className="panel-head"><strong>Purchase request</strong><Pill label="Pending approval" /></div>
      <dl className="kv"><div><dt>Requested by</dt><dd>A. Patel, 12 Mar 2026</dd></div><div><dt>Request for</dt><dd>Hydraulic hose and filters</dd></div></dl>
      <TableScroll label="Sample purchase request lines">
        <table className="mt">
          <thead><tr><th>Item</th><th>Qty</th><th>Estimated cost</th></tr></thead>
          <tbody>
            <tr><td>Hydraulic hose (123-4567)</td><td>4</td><td>SAR 1,800.00</td></tr>
            <tr><td>Engine air filter (FLTR-001)</td><td>2</td><td>SAR 640.00</td></tr>
          </tbody>
        </table>
      </TableScroll>
      <div className="kv-total"><span>Total</span><b>SAR 2,440.00</b></div>
      <div className="fc-actions"><span className="ghost-btn">Reject</span><span className="yellow-btn">Approve</span></div>
    </div>
  );
}

const SERIES = [
  ["tyres", "Tyres", "#FFC629"], ["preventive", "Preventive", "#161616"],
  ["corrective", "Corrective", "#8A8A82"], ["parts", "Parts", "#D6D3C4"],
] as const;

/** Stacked bars of illustrative monthly maintenance spend. */
export function SpendChart() {
  const max = 180;
  const H = 140;
  return (
    <figure className="spend-chart" aria-label="Sample maintenance spend by category, January to June">
      <svg viewBox="0 0 320 170" aria-hidden="true">
        {[0, 60, 120, 180].map((v) => (
          <g key={v}>
            <line x1="30" x2="316" y1={H - (v / max) * H + 10} y2={H - (v / max) * H + 10} stroke="#E3E3DD" />
            <text x="24" y={H - (v / max) * H + 13} textAnchor="end" fontSize="8" fill="#56564f">{v}k</text>
          </g>
        ))}
        {SPEND.map((m, i) => {
          let y = H + 10;
          const x = 44 + i * 46;
          return (
            <g key={m.m}>
              {SERIES.map(([k, , c]) => {
                const h = (m[k] / max) * H;
                y -= h;
                return <rect key={k} x={x} y={y} width="24" height={Math.max(h - 1, 0)} fill={c} />;
              })}
              <text x={x + 12} y={H + 22} textAnchor="middle" fontSize="8" fill="#56564f">{m.m}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">{SERIES.map(([, n, c]) => <span key={n}><i style={{ background: c }} />{n}</span>)}</figcaption>
    </figure>
  );
}

export function FleetCostPanel() {
  const tiles = [["Total operating cost", "SAR 425,600"], ["Maintenance spend", "SAR 138,200"], ["Fleet availability", "92%"], ["Active assets", "142 of 168"]];
  return (
    <div className="panel">
      <div className="panel-head"><strong>Fleet cost and availability</strong><span className="fake-input sm">Mar 2026 <ChevronDown size={11} /></span></div>
      <div className="cost-tiles">{tiles.map(([t, v]) => <div key={t}><span className="muted-xs">{t}</span><b>{v}</b></div>)}</div>
      <span className="muted-sm">Maintenance spend by category</span>
      <SpendChart />
    </div>
  );
}
