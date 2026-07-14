/**
 * WidgetRenderer — renders one dashboard-builder widget from its catalog id
 * plus a fetched data slice, and owns the per-widget data loading contract.
 *
 * Data loading: createWidgetDataLoader() returns loadWidgetData(widgetId) —
 * one call per widget, deduplicated per underlying source within a batch so
 * three fleet widgets share one vehicle_fleet query. The page runs the calls
 * through Promise.allSettled (same per-widget failure isolation pattern as
 * DisplayDashboard.jsx): one failing query renders one error tile, never a
 * blank board.
 *
 * Queries mirror the reads already used by DisplayDashboard.jsx /
 * GlobalSearch.jsx — only tables/columns visible in existing page code.
 */
import { useMemo } from 'react'
import {
  Truck, CircleDot, AlertTriangle, DollarSign, ClipboardList,
  Inbox, Bell, ShieldCheck,
} from 'lucide-react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend, ArcElement, LineElement, PointElement, Filler,
} from 'chart.js'
import { supabase } from '../../lib/supabase'
import { fetchAllPages } from '../../lib/fetchAll'
import { applyCountry } from '../../lib/countryFilter'
import StatTile from '../ui/StatTile'
import Gauge from '../ui/Gauge'
import {
  computeFleetAvailability, groupVehiclesBySite, computeTyreAttention,
  computeMonthlyTyreCost, countTodaysInspections, summariseAlerts,
  formatCompactMoney,
} from '../../lib/displayBoard'
import {
  WIDGET_BY_ID, computeCostTrend, groupWorkOrdersByStatus,
} from '../../lib/dashboardBuilder'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
  ArcElement, LineElement, PointElement, Filler,
)

// Canvas can't read CSS vars — theme-neutral slate ticks/grid read cleanly on
// both light and dark grounds (same convention as Dashboard.jsx).
const GRID   = { color: 'rgba(148,163,184,0.18)', drawBorder: false }
const TICK   = { color: '#64748b', font: { size: 11 } }
const LEGEND = { labels: { color: '#64748b', boxWidth: 10, boxHeight: 10, font: { size: 11 }, usePointStyle: true } }
const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID } },
}
const DONUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { ...LEGEND, position: 'right' } },
}

const SEVERITY_COLORS = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Info: '#38bdf8',
}
const STATUS_PALETTE = ['#3b82f6', '#f59e0b', '#22c55e', '#8b5cf6', '#06b6d4', '#ef4444', '#ec4899', '#64748b']

// ── Data loading ──────────────────────────────────────────────────────────────
// Global dashboard filters (resolveDashboardFilters output) are threaded into
// every fetcher: `site`/`country` are applied only to tables that carry those
// columns (vehicle_fleet, tyre_records, inspections), and the date window is
// applied only to genuinely time-bounded reads (alerts / work_orders on
// created_at). Snapshot widgets (tyres in service, this-month cost, 6-month
// trend, today's inspections, pending imports) keep their intrinsic window and
// simply ignore an incompatible filter — no crash, no error tile.

/** Apply an equality site filter when a specific site is selected. */
const withSite = (q, site) => (site ? q.eq('site', site) : q)

/** Apply a created_at date window (inclusive) when bounds are present. */
const withCreatedRange = (q, from, to) => {
  let out = q
  if (from) out = out.gte('created_at', from)
  if (to) out = out.lte('created_at', `${to}T23:59:59.999Z`)
  return out
}

/** Raw source fetchers keyed by WIDGET_CATALOG data.source. */
const SOURCE_FETCHERS = {
  fleet: async ({ site, country } = {}) => {
    let q = supabase.from('vehicle_fleet').select('asset_no,site,status')
    q = withSite(q, site)
    q = applyCountry(q, country)
    const { data, error } = await q
    if (error) throw error
    return data ?? []
  },
  tyresActive: async ({ site, country } = {}) => {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('tyre_records').select('asset_no,risk_level').is('removal_date', null)
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  monthTyres: async ({ site, country } = {}) => {
    const monthStart = new Date()
    monthStart.setDate(1)
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('tyre_records').select('cost_per_tyre,qty,issue_date')
        .gte('issue_date', monthStart.toISOString().slice(0, 10))
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  costTrend: async ({ site, country } = {}) => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('tyre_records').select('cost_per_tyre,qty,issue_date')
        .gte('issue_date', start.toISOString().slice(0, 10))
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  inspections: async ({ site, country } = {}) => {
    const todayStr = new Date().toISOString().slice(0, 10)
    let q = supabase.from('inspections').select('scheduled_date,status')
      .gte('scheduled_date', todayStr)
    q = withSite(q, site)
    q = applyCountry(q, country)
    const { data, error } = await q.limit(2000)
    if (error) throw error
    return data ?? []
  },
  alerts: async ({ from, to } = {}) => {
    let q = supabase.from('alerts')
      .select('severity,message,asset_no,created_at,is_active')
      .eq('is_active', true)
    q = withCreatedRange(q, from, to)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    return data ?? []
  },
  pendingImports: async () => {
    const { data, error } = await supabase
      .from('import_batches')
      .select('id,approval_status')
      .eq('approval_status', 'pending_approval')
      .limit(500)
    if (error) throw error
    return data ?? []
  },
  workOrders: async ({ from, to } = {}) => {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('work_orders').select('id,status')
      q = withCreatedRange(q, from, to)
      return q.range(lo, hi)
    }, { max: 10000 })
    if (error) throw error
    return data ?? []
  },
}

/**
 * Build a per-batch loader. loadWidgetData(widgetId) → Promise<rows>.
 * Sources are memoised for the lifetime of the loader, so widgets that share
 * a source (e.g. three fleet widgets) trigger exactly one query per refresh.
 * @param {{from?:string|null, to?:string|null, site?:string|null, country?:string|null}} [params]
 *        resolved global dashboard filters (see resolveDashboardFilters).
 */
export function createWidgetDataLoader(params = {}) {
  const cache = new Map()
  return function loadWidgetData(widgetId) {
    const def = WIDGET_BY_ID[widgetId]
    if (!def) return Promise.reject(new Error(`Unknown widget: ${widgetId}`))
    const source = def.data.source
    if (!cache.has(source)) {
      const fetcher = SOURCE_FETCHERS[source]
      if (!fetcher) return Promise.reject(new Error(`Unknown data source: ${source}`))
      cache.set(source, fetcher(params))
    }
    return cache.get(source)
  }
}

// ── Presentational shells ─────────────────────────────────────────────────────
function WidgetSkeleton({ lines = 3 }) {
  return (
    <div className="card h-full animate-pulse space-y-3 !p-4">
      <div className="h-3 w-1/3 rounded bg-[var(--hairline,rgba(148,163,184,0.18))]" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-5 rounded bg-[var(--hairline,rgba(148,163,184,0.14))]"
          style={{ width: `${85 - i * 18}%` }} />
      ))}
    </div>
  )
}

function WidgetErrorTile({ label, message }) {
  return (
    <div className="card h-full flex flex-col items-center justify-center gap-2 text-center !p-4">
      <AlertTriangle size={22} className="text-amber-500" />
      <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
      <p className="text-xs text-[var(--text-muted)] max-w-[220px] truncate" title={message}>
        {message || 'Data unavailable'}
      </p>
      <p className="text-[11px] text-[var(--text-dim)]">Retries on next refresh</p>
    </div>
  )
}

function ChartShell({ title, icon: Icon, children }) {
  return (
    <div className="card h-full flex flex-col !p-4 min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        {Icon && <Icon size={14} className="text-[var(--text-muted)]" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">
          {title}
        </span>
      </div>
      <div className="flex-1 min-h-0 relative">{children}</div>
    </div>
  )
}

function EmptyNote({ text }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-xs text-[var(--text-muted)]">{text}</p>
    </div>
  )
}

// ── Per-widget visuals ────────────────────────────────────────────────────────
function FleetAvailabilityWidget({ rows }) {
  const a = computeFleetAvailability(rows)
  return (
    <ChartShell title="Fleet Availability" icon={Truck}>
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <Gauge value={a.pct} max={100} unit="%" size={140} label="Available" />
        <p className="text-xs text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text-primary)] tabular-nums">{a.available}</span>
          {' of '}
          <span className="font-bold text-[var(--text-primary)] tabular-nums">{a.total}</span>
          {' in service'}
        </p>
      </div>
    </ChartShell>
  )
}

function AlertsBySeverityWidget({ rows }) {
  const summary = summariseAlerts(rows)
  const levels = Object.keys(summary.bySeverity).filter(k => summary.bySeverity[k] > 0)
  if (!levels.length) {
    return (
      <ChartShell title="Alerts by Severity" icon={Bell}>
        <EmptyNote text="No active alerts, all clear" />
      </ChartShell>
    )
  }
  const data = {
    labels: levels,
    datasets: [{
      data: levels.map(l => summary.bySeverity[l]),
      backgroundColor: levels.map(l => SEVERITY_COLORS[l]),
      borderWidth: 0, hoverOffset: 6,
    }],
  }
  return (
    <ChartShell title={`Alerts by Severity · ${summary.total}`} icon={Bell}>
      <Doughnut data={data} options={DONUT_OPTS} />
    </ChartShell>
  )
}

function VehiclesBySiteWidget({ rows }) {
  const sites = groupVehiclesBySite(rows, 8)
  if (!sites.length) {
    return (
      <ChartShell title="Vehicles by Site" icon={Truck}>
        <EmptyNote text="No vehicles recorded" />
      </ChartShell>
    )
  }
  const data = {
    labels: sites.map(s => s.site),
    datasets: [{
      data: sites.map(s => s.count),
      backgroundColor: 'rgba(22,163,74,0.7)',
      borderRadius: 5, borderSkipped: false,
    }],
  }
  return (
    <ChartShell title="Vehicles by Site" icon={Truck}>
      <Bar data={data} options={{ ...BASE_OPTS, indexAxis: 'y' }} />
    </ChartShell>
  )
}

function CostTrendWidget({ rows, currency }) {
  const trend = computeCostTrend(rows)
  if (!trend.some(b => b.cost > 0)) {
    return (
      <ChartShell title="Tyre Cost Trend" icon={DollarSign}>
        <EmptyNote text="No tyre cost recorded in the last 6 months" />
      </ChartShell>
    )
  }
  const data = {
    labels: trend.map(b => b.label),
    datasets: [{
      label: `Cost (${currency || ''})`.trim(),
      data: trend.map(b => b.cost),
      borderColor: '#22c55e',
      backgroundColor: 'rgba(22,163,74,0.08)',
      fill: true, tension: 0.4, pointRadius: 3,
      pointBackgroundColor: '#22c55e', borderWidth: 2,
    }],
  }
  const opts = {
    ...BASE_OPTS,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => `${currency ? `${currency} ` : ''}${Math.round(Number(ctx.raw) || 0).toLocaleString()}`,
        },
      },
    },
  }
  return (
    <ChartShell title="Tyre Cost Trend · 6 Months" icon={DollarSign}>
      <Line data={data} options={opts} />
    </ChartShell>
  )
}

function WorkOrdersByStatusWidget({ rows }) {
  const groups = groupWorkOrdersByStatus(rows)
  if (!groups.length) {
    return (
      <ChartShell title="Work Orders by Status" icon={ClipboardList}>
        <EmptyNote text="No work orders recorded" />
      </ChartShell>
    )
  }
  const data = {
    labels: groups.map(g => g.status),
    datasets: [{
      data: groups.map(g => g.count),
      backgroundColor: groups.map((_, i) => STATUS_PALETTE[i % STATUS_PALETTE.length]),
      borderWidth: 0, hoverOffset: 6,
    }],
  }
  return (
    <ChartShell title={`Work Orders · ${rows.length}`} icon={ClipboardList}>
      <Doughnut data={data} options={DONUT_OPTS} />
    </ChartShell>
  )
}

function RecentAlertsWidget({ rows }) {
  const items = (rows || []).slice(0, 8)
  return (
    <ChartShell title="Recent Alerts" icon={Bell}>
      {items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-2">
          <ShieldCheck size={28} className="text-green-500/80" />
          <p className="text-sm text-[var(--text-muted)]">All clear, no active alerts</p>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto h-full pr-1">
          {items.map((a, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2"
              style={{ border: '1px solid var(--hairline, rgba(148,163,184,0.14))' }}>
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                style={{
                  color: SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.Info,
                  backgroundColor: `${SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.Info}1f`,
                }}>
                {a.severity ?? 'Info'}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-primary)] leading-snug line-clamp-2">{a.message ?? 'Alert'}</p>
                <p className="text-[10px] text-[var(--text-dim)] mt-0.5 font-mono">
                  {a.asset_no ?? ''}{a.asset_no && a.created_at ? ' · ' : ''}
                  {a.created_at ? new Date(a.created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartShell>
  )
}

// ── Main renderer ─────────────────────────────────────────────────────────────
/**
 * @param {{ widgetId:string, slice:{rows:any[], error:string|null, loaded:boolean}, currency?:string }} props
 */
export default function WidgetRenderer({ widgetId, slice, currency }) {
  const def = WIDGET_BY_ID[widgetId]

  // Derived stats memoised so re-renders in edit mode stay cheap.
  const derived = useMemo(() => {
    if (!def || !slice?.loaded || slice.error) return null
    const rows = slice.rows || []
    switch (widgetId) {
      case 'total-vehicles':    return { value: rows.length.toLocaleString() }
      case 'tyres-in-service': {
        const a = computeTyreAttention(rows)
        return { value: a.total.toLocaleString(), sub: 'Currently fitted' }
      }
      case 'critical-tyres': {
        const a = computeTyreAttention(rows)
        return {
          value: a.critical.toLocaleString(),
          sub: `${a.high} high risk alongside`,
          tone: a.critical > 0 ? 'crit' : 'accent',
        }
      }
      case 'monthly-tyre-cost': {
        const c = computeMonthlyTyreCost(rows)
        return {
          value: formatCompactMoney(c.cost),
          unit: currency,
          sub: `${c.tyreCount.toLocaleString()} tyres issued this month`,
        }
      }
      case 'inspections-today': {
        const t = countTodaysInspections(rows, new Date().toISOString().slice(0, 10))
        return {
          value: t.total.toLocaleString(),
          sub: `${t.done} done · ${t.pending} pending · ${t.overdue} overdue`,
          tone: t.overdue > 0 ? 'warn' : 'accent',
        }
      }
      case 'pending-approvals':
        return {
          value: rows.length.toLocaleString(),
          sub: 'Imports awaiting review',
          tone: rows.length > 0 ? 'warn' : 'accent',
        }
      default: return null
    }
  }, [def, slice, widgetId, currency])

  if (!def) return <WidgetErrorTile label="Unknown widget" message={widgetId} />
  if (!slice || (!slice.loaded && !slice.error)) {
    return <WidgetSkeleton lines={def.kind === 'stat' ? 2 : 4} />
  }
  if (slice.error) return <WidgetErrorTile label={def.label} message={slice.error} />

  const rows = slice.rows || []

  switch (widgetId) {
    case 'fleet-availability':    return <FleetAvailabilityWidget rows={rows} />
    case 'alerts-by-severity':    return <AlertsBySeverityWidget rows={rows} />
    case 'vehicles-by-site':      return <VehiclesBySiteWidget rows={rows} />
    case 'tyre-cost-trend':       return <CostTrendWidget rows={rows} currency={currency} />
    case 'work-orders-by-status': return <WorkOrdersByStatusWidget rows={rows} />
    case 'recent-alerts':         return <RecentAlertsWidget rows={rows} />
    case 'total-vehicles':
      return <StatTile label={def.label} value={derived.value} icon={Truck} tone="info" sub="Registered fleet assets" />
    case 'tyres-in-service':
      return <StatTile label={def.label} value={derived.value} icon={CircleDot} tone="accent" sub={derived.sub} />
    case 'critical-tyres':
      return <StatTile label={def.label} value={derived.value} icon={AlertTriangle} tone={derived.tone} sub={derived.sub} />
    case 'monthly-tyre-cost':
      return <StatTile label={def.label} value={derived.value} unit={derived.unit} icon={DollarSign} tone="accent" sub={derived.sub} />
    case 'inspections-today':
      return <StatTile label={def.label} value={derived.value} icon={ClipboardList} tone={derived.tone} sub={derived.sub} />
    case 'pending-approvals':
      return <StatTile label={def.label} value={derived.value} icon={Inbox} tone={derived.tone} sub={derived.sub} />
    default:
      return <WidgetErrorTile label={def.label} message="No renderer for this widget" />
  }
}
