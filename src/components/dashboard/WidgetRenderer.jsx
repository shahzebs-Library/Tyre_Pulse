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
import { useMemo, useState } from 'react'
import {
  Truck, CircleDot, AlertTriangle, DollarSign, ClipboardList,
  Inbox, Bell, ShieldCheck, Wrench, ListChecks,
  MapPin, Activity, BarChart3, ClipboardCheck, TrendingUp, BadgeCheck,
  Flame, History, StickyNote, Image as ImageIcon, Siren, Map as MapIcon,
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
import {
  closedWoStatusTokens, openWorkOrderCount, recentMonths, stackWorkshopJobs,
  utilisationTrend, inspectionProgress, rollingWindows, trendChange,
  FRESHNESS_FEEDS, freshnessStatus, heatmapSiteWeekday, mergeTimeline,
} from '../../lib/dashboardWidgets'
import { getLatestActivity } from '../../lib/api/latestActivity'
import { safeImageSrc } from '../../lib/safeUrl'

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
    // Page past the 1000-row PostgREST cap: this feeds the total-vehicles COUNT
    // (rows.length) and the fleet-availability / vehicles-by-site breakdowns, all
    // of which under-report on a fleet over 1000 rows without paging.
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('vehicle_fleet').select('asset_no,site,status')
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.range(lo, hi)
    }, { max: 20000 })
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
  // Tyre lifecycle rows (status + failure reason) for the Active/Removed + failure widgets.
  tyreLifecycle: async ({ site, country } = {}) => {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('tyre_records').select('status,removal_reason')
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  // Server-aggregated maintenance snapshot (work_orders + line items, org-scoped).
  maintenanceSnapshot: async ({ site, country } = {}) => {
    const { data, error } = await supabase.rpc('get_maintenance_snapshot', {
      p_site: site || null, p_country: country || null, p_from: null, p_to: null,
    })
    if (error) throw error
    return data && data.ok ? data : { ok: false }
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
    // Paged, matching the sibling fetcher above: `.limit(2000)` was never a
    // bound (the server caps at 1000), so the widget's own count would go
    // silently wrong the moment the schedule passed a thousand rows.
    const { data, error } = await fetchAllPages((from, to) => {
      let q = supabase.from('inspections').select('scheduled_date,status')
        .gte('scheduled_date', todayStr)
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.order('scheduled_date').order('id').range(from, to)
    }, { max: 20000 })
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
    // work_orders is a millions-row table. The row pull for the status breakdown
    // is bounded at 10000, so its length is NOT a safe total. Take the displayed
    // count from an exact server count over the same window instead.
    const { data, error, truncated } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('work_orders').select('id,status')
      q = withCreatedRange(q, from, to)
      return q.range(lo, hi)
    }, { max: 10000 })
    if (error) throw error
    let cq = supabase.from('work_orders').select('id', { count: 'exact', head: true })
    cq = withCreatedRange(cq, from, to)
    const { count } = await cq
    const rows = data ?? []
    // Carry the exact total + truncation alongside the rows the breakdown reads.
    rows.total = count ?? rows.length
    rows.truncated = truncated
    return rows
  },
  // ── Widgets added for the builder mockup ──
  // Open job cards = exact total minus exact closed count (live state, so the
  // date window does not apply). NULL / blank status stays counted as open.
  workOrdersOpen: async ({ site, country } = {}) => {
    const base = () => {
      let q = supabase.from('work_orders').select('id', { count: 'exact', head: true })
      q = withSite(q, site)
      return applyCountry(q, country)
    }
    const [all, closed] = await Promise.all([
      base(),
      base().in('status', closedWoStatusTokens()),
    ])
    if (all.error) throw all.error
    if (closed.error) throw closed.error
    return openWorkOrderCount(all.count, closed.count)
  },
  // Telematics snapshots (asset_utilization). An unprovisioned table reads as
  // no data, which the widget states honestly.
  utilisation: async ({ country } = {}) => {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('asset_utilization').select('id,captured_at,utilization_pct')
      q = applyCountry(q, country)
      return q.order('id').range(lo, hi)
    }, { max: 20000 })
    if (error) {
      const code = String(error.code || '')
      if (code === '42P01' || code === 'PGRST205') return []
      throw error
    }
    return data ?? []
  },
  // Six server aggregates (get_work_order_stats folds statuses to the canonical
  // vocabulary). Site is not a parameter of that RPC, so this widget is
  // country scoped only. A failed month reads as unmeasured, never as zero.
  workshopMonths: async ({ country } = {}) => {
    const months = recentMonths(new Date(), 6)
    const settled = await Promise.allSettled(months.map(m => supabase.rpc('get_work_order_stats', {
      p_country: country || null, p_from: m.from, p_to: m.to,
    })))
    let failures = 0
    const out = months.map((m, i) => {
      const r = settled[i]
      if (r.status !== 'fulfilled' || r.value?.error) { failures += 1; return { ...m, by_status: null } }
      return { ...m, by_status: Array.isArray(r.value.data?.by_status) ? r.value.data.by_status : [] }
    })
    if (failures === months.length) {
      const first = settled.find(r => r.status === 'fulfilled')?.value?.error || settled[0]?.reason
      throw first || new Error('Workshop jobs could not be read')
    }
    return out
  },
  inspectionsMonth: async ({ site, country } = {}) => {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
    const to = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('inspections').select('id,scheduled_date,status,completed_date')
        .gte('scheduled_date', from).lte('scheduled_date', to)
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.order('id').range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  // Job cards opened in the last 30 days vs the 30 days before (opened_at,
  // both windows bounded at today so future-dated rows never count).
  workOrdersTrend: async ({ site, country } = {}) => {
    const w = rollingWindows(new Date(), 30)
    const count = (from, to) => {
      let q = supabase.from('work_orders').select('id', { count: 'exact', head: true })
        .gte('opened_at', from).lte('opened_at', `${to}T23:59:59.999Z`)
      q = withSite(q, site)
      return applyCountry(q, country)
    }
    const [cur, prev] = await Promise.all([count(w.from, w.to), count(w.prevFrom, w.prevTo)])
    if (cur.error) throw cur.error
    return { ...trendChange(cur.count, prev.error ? null : prev.count), window: w }
  },
  // Newest upload (created_at) per feed. Unreadable feeds come back null.
  freshness: async ({ country } = {}) => {
    const dates = await Promise.all(FRESHNESS_FEEDS.map(f =>
      getLatestActivity(f.table, { country, dateColumn: 'created_at' })))
    const latest = {}
    FRESHNESS_FEEDS.forEach((f, i) => { latest[f.table] = dates[i] })
    return freshnessStatus(latest, new Date())
  },
  inspectionsHeat: async ({ site, country } = {}) => {
    const since = new Date()
    since.setDate(since.getDate() - 89)
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('inspections').select('id,site,inspection_date')
        .gte('inspection_date', since.toISOString().slice(0, 10))
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.order('id').range(lo, hi)
    }, { max: 20000 })
    if (error) throw error
    return data ?? []
  },
  // Latest records from three registers. One failing register leaves the
  // other two; all three failing is an error tile.
  timeline: async ({ site, country } = {}) => {
    const recent = (table, cols) => {
      let q = supabase.from(table).select(cols)
      q = withSite(q, site)
      q = applyCountry(q, country)
      return q.order('created_at', { ascending: false }).limit(12)
    }
    const settled = await Promise.allSettled([
      recent('work_orders', 'id,work_order_no,asset_no,status,created_at'),
      recent('accidents', 'id,reference_no,asset_no,severity,site,created_at'),
      recent('inspections', 'id,asset_no,status,site,created_at'),
    ])
    const ok = settled.map(r => (r.status === 'fulfilled' && !r.value?.error ? (r.value.data || []) : null))
    if (ok.every(v => v == null)) {
      throw settled[0].status === 'fulfilled' ? settled[0].value.error : settled[0].reason
    }
    const events = mergeTimeline({ workOrders: ok[0] || [], accidents: ok[1] || [], inspections: ok[2] || [] }, 12)
    events.partial = ok.some(v => v == null)
    return events
  },
  // Note / Image widgets read nothing; their content lives in the layout.
  static: async () => [],
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
    <ChartShell title={`Alerts by Severity | ${summary.total}`} icon={Bell}>
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
    <ChartShell title="Tyre Cost Trend, 6 Months" icon={DollarSign}>
      <Line data={data} options={opts} />
    </ChartShell>
  )
}

function WorkOrdersByStatusWidget({ rows }) {
  const groups = groupWorkOrdersByStatus(rows)
  const total = Number.isFinite(rows?.total) ? rows.total : (rows?.length ?? 0)
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
    <ChartShell title={`Work Orders | ${total.toLocaleString()}`} icon={ClipboardList}>
      <Doughnut data={data} options={DONUT_OPTS} />
      {rows?.truncated ? (
        <p className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-[var(--text-dim)]">
          Breakdown based on most recent 10,000
        </p>
      ) : null}
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
                  {a.asset_no ?? ''}{a.asset_no && a.created_at ? ' | ' : ''}
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
function TyreStatusWidget({ rows }) {
  const list = Array.isArray(rows) ? rows : []
  const active = list.filter(r => (r.status || '') === 'Active').length
  const removed = list.filter(r => (r.status || '') === 'Removed').length
  if (!active && !removed) return <ChartShell title="Tyre Status" icon={CircleDot}><EmptyNote text="No tyre records" /></ChartShell>
  const data = { labels: ['Active', 'Removed'], datasets: [{ data: [active, removed], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0, hoverOffset: 6 }] }
  return <ChartShell title={`Tyre Status | ${active + removed}`} icon={CircleDot}><Doughnut data={data} options={DONUT_OPTS} /></ChartShell>
}

function TyreFailureWidget({ rows }) {
  const list = Array.isArray(rows) ? rows : []
  const counts = {}
  list.forEach(r => { if ((r.status || '') === 'Removed' && r.removal_reason) counts[r.removal_reason] = (counts[r.removal_reason] || 0) + 1 })
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (!entries.length) return <ChartShell title="Tyre Failure Reasons" icon={AlertTriangle}><EmptyNote text="No removed tyres" /></ChartShell>
  const data = { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => STATUS_PALETTE[i % STATUS_PALETTE.length]), borderWidth: 0, hoverOffset: 6 }] }
  return <ChartShell title="Tyre Failure Reasons" icon={AlertTriangle}><Doughnut data={data} options={DONUT_OPTS} /></ChartShell>
}

function MaintenanceByTypeWidget({ rows }) {
  const snap = rows && rows.ok ? rows : null
  const list = snap?.by_work_type || []
  if (!list.length) return <ChartShell title="Maintenance Spend by Type" icon={Wrench}><EmptyNote text="No maintenance data" /></ChartShell>
  const data = { labels: list.map(x => x.label), datasets: [{ data: list.map(x => Number(x.spend) || 0), backgroundColor: 'rgba(99,102,241,0.75)', borderRadius: 4 }] }
  return <ChartShell title="Maintenance Spend by Type" icon={Wrench}><Bar data={data} options={BASE_OPTS} /></ChartShell>
}

function TopTasksWidget({ rows }) {
  const snap = rows && rows.ok ? rows : null
  const list = (snap?.top_tasks || []).slice(0, 8)
  if (!list.length) return <ChartShell title="Top Maintenance Tasks" icon={ListChecks}><EmptyNote text="No task data" /></ChartShell>
  const data = { labels: list.map(x => x.label), datasets: [{ data: list.map(x => Number(x.n) || 0), backgroundColor: 'rgba(6,182,212,0.75)', borderRadius: 4 }] }
  return <ChartShell title="Top Maintenance Tasks" icon={ListChecks}><Bar data={data} options={{ ...BASE_OPTS, indexAxis: 'y' }} /></ChartShell>
}

// ── Widgets added for the builder mockup ──────────────────────────────────────
const WO_STATUS_COLORS = {
  Completed: '#22c55e', 'In Progress': '#3b82f6', New: '#f59e0b', Assigned: '#8b5cf6',
  'Waiting for Parts': '#f97316', 'Waiting for Approval': '#eab308', 'Quality Inspection': '#06b6d4',
  Cancelled: '#94a3b8', 'On Hold': '#64748b', Other: '#cbd5e1',
}
const FRESH_TONE = {
  fresh:   { label: 'Up to date', color: '#16a34a' },
  stale:   { label: 'Getting stale', color: '#d97706' },
  old:     { label: 'Out of date', color: '#dc2626' },
  unknown: { label: 'Not readable', color: '#64748b' },
}

function FleetLocationWidget({ rows }) {
  const sites = groupVehiclesBySite(rows, 24)
  const total = (rows || []).length
  return (
    <ChartShell title={`Fleet Location | ${sites.length} sites`} icon={MapPin}>
      <div className="h-full flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]"
          style={{ border: '1px dashed var(--hairline, rgba(148,163,184,0.35))' }}>
          <MapIcon size={13} aria-hidden="true" />
          <span>Map view not connected yet. Sites are listed with their registered vehicles.</span>
        </div>
        {sites.length === 0 ? (
          <EmptyNote text="No vehicles recorded" />
        ) : (
          <div className="grid gap-1.5 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {sites.map(s => (
              <div key={s.site} className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                style={{ border: '1px solid var(--hairline, rgba(148,163,184,0.18))' }}>
                <MapPin size={14} className="text-green-600 flex-shrink-0" aria-hidden="true" />
                <span className="text-xs text-[var(--text-primary)] truncate flex-1" title={s.site}>{s.site}</span>
                <span className="text-xs font-bold tabular-nums text-[var(--text-primary)]">{s.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {total > 0 && sites.length === 24 && (
          <p className="text-[10px] text-[var(--text-dim)]">Showing the 24 sites with the most vehicles.</p>
        )}
      </div>
    </ChartShell>
  )
}

function UtilisationTrendWidget({ rows }) {
  const trend = utilisationTrend(rows)
  if (!trend.length) {
    return (
      <ChartShell title="Fleet Utilisation Trend" icon={Activity}>
        <EmptyNote text="No telematics utilisation captured yet" />
      </ChartShell>
    )
  }
  const data = {
    labels: trend.map(t => t.date),
    datasets: [{
      label: 'Average utilisation',
      data: trend.map(t => t.avg),
      borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.10)',
      fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: '#16a34a', borderWidth: 2,
    }],
  }
  const opts = {
    ...BASE_OPTS,
    scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: { ...TICK, callback: v => `${v}%` }, grid: GRID, suggestedMin: 0, suggestedMax: 100 } },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.raw}% average over ${trend[ctx.dataIndex]?.assets ?? 0} assets` } },
    },
  }
  return (
    <ChartShell title="Fleet Utilisation Trend" icon={Activity}>
      <Line data={data} options={opts} />
      {trend.length === 1 && (
        <p className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-[var(--text-dim)]">
          One capture date so far, a trend needs at least two
        </p>
      )}
    </ChartShell>
  )
}

function WorkshopJobsWidget({ rows }) {
  const stack = stackWorkshopJobs(Array.isArray(rows) ? rows : [])
  if (!stack.total) {
    return (
      <ChartShell title="Workshop Jobs, 6 Months" icon={BarChart3}>
        <EmptyNote text="No job cards opened in the last 6 months" />
      </ChartShell>
    )
  }
  const data = {
    labels: stack.labels,
    datasets: stack.series.map((s, i) => ({
      label: s.status,
      data: s.data,
      backgroundColor: WO_STATUS_COLORS[s.status] || STATUS_PALETTE[i % STATUS_PALETTE.length],
      borderRadius: 3, stack: 'jobs',
    })),
  }
  const opts = {
    ...BASE_OPTS,
    plugins: { legend: { ...LEGEND, display: true, position: 'top' } },
    scales: { x: { ticks: TICK, grid: GRID, stacked: true }, y: { ticks: TICK, grid: GRID, stacked: true } },
  }
  const gaps = stack.series[0]?.data.some(v => v == null)
  return (
    <ChartShell title={`Workshop Jobs, 6 Months | ${stack.total.toLocaleString()}`} icon={BarChart3}>
      <Bar data={data} options={opts} />
      {gaps && (
        <p className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-[var(--text-dim)]">
          Some months could not be read and are left blank
        </p>
      )}
    </ChartShell>
  )
}

function InspectionProgressWidget({ rows }) {
  const p = inspectionProgress(rows, new Date())
  const pct = p.pct
  const color = pct == null ? '#94a3b8' : pct >= 90 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626'
  return (
    <div className="card h-full flex flex-col gap-2 !p-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck size={14} className="text-[var(--text-muted)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">Inspection Progress</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{pct == null ? 'N/A' : `${pct}%`}</div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--hairline, rgba(148,163,184,0.2))' }}
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Inspections completed">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: color }} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {p.planned === 0
          ? `No inspections scheduled in ${p.month}`
          : `${p.done.toLocaleString()} of ${p.planned.toLocaleString()} scheduled done, ${p.month}`}
      </p>
    </div>
  )
}

function DataFreshnessWidget({ rows }) {
  const items = Array.isArray(rows?.items) ? rows.items : []
  const overall = FRESH_TONE[rows?.overall] || FRESH_TONE.unknown
  return (
    <div className="card h-full flex flex-col gap-2 !p-4 min-h-0">
      <div className="flex items-center gap-2">
        <BadgeCheck size={14} className="text-[var(--text-muted)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">Data Freshness</span>
      </div>
      <span className="self-start inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
        style={{ color: overall.color, backgroundColor: `${overall.color}1f` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: overall.color }} aria-hidden="true" />
        {overall.label}
      </span>
      <div className="space-y-1 overflow-y-auto min-h-0">
        {items.map(i => {
          const tone = FRESH_TONE[i.status] || FRESH_TONE.unknown
          return (
            <div key={i.table} className="flex items-center gap-2 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tone.color }} aria-hidden="true" />
              <span className="text-[var(--text-primary)] truncate flex-1">{i.label}</span>
              <span className="text-[var(--text-muted)] tabular-nums">
                {i.days == null ? 'N/A' : i.days === 0 ? 'today' : `${i.days}d ago`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InspectionHeatmapWidget({ rows }) {
  const hm = heatmapSiteWeekday(rows, 'inspection_date', 8)
  if (!hm.sites.length) {
    return (
      <ChartShell title="Inspections Heat Map, 90 Days" icon={Flame}>
        <EmptyNote text="No inspections with a site in the last 90 days" />
      </ChartShell>
    )
  }
  const cellBg = n => (n === 0 || hm.max === 0 ? 'rgba(148,163,184,0.10)' : `rgba(22,163,74,${(0.18 + 0.72 * (n / hm.max)).toFixed(2)})`)
  return (
    <ChartShell title={`Inspections Heat Map, 90 Days | ${hm.total.toLocaleString()}`} icon={Flame}>
      <div className="h-full overflow-auto">
        <div className="grid gap-1 text-[10px]" style={{ gridTemplateColumns: 'minmax(70px, 1.4fr) repeat(7, minmax(26px, 1fr))' }}
          role="grid" aria-label="Inspections by site and weekday">
          <span />
          {hm.days.map(d => <span key={d} className="text-center text-[var(--text-muted)] font-semibold">{d}</span>)}
          {hm.sites.map((site, r) => (
            <div key={site} className="contents" role="row">
              <span className="truncate text-[var(--text-primary)] self-center" title={site}>{site}</span>
              {hm.cells[r].map((n, c) => (
                <span key={c} role="gridcell" title={`${site}, ${hm.days[c]}: ${n}`}
                  className="text-center rounded py-1 tabular-nums"
                  style={{ background: cellBg(n), color: n / (hm.max || 1) > 0.55 ? '#fff' : 'var(--text-primary)' }}>
                  {n}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ChartShell>
  )
}

const TIMELINE_ICON = { work_order: Wrench, accident: Siren, inspection: ClipboardCheck }
const TIMELINE_COLOR = { work_order: '#3b82f6', accident: '#dc2626', inspection: '#16a34a' }

function TimelineWidget({ rows }) {
  const events = Array.isArray(rows) ? rows : []
  return (
    <ChartShell title="Activity Timeline" icon={History}>
      {events.length === 0 ? (
        <EmptyNote text="No recent job cards, accidents or inspections" />
      ) : (
        <div className="h-full overflow-y-auto pr-1">
          <ol className="relative space-y-2.5" style={{ borderInlineStart: '1px solid var(--hairline, rgba(148,163,184,0.25))' }}>
            {events.map((e, i) => {
              const Icon = TIMELINE_ICON[e.type] || History
              const color = TIMELINE_COLOR[e.type] || '#64748b'
              return (
                <li key={`${e.type}-${e.at}-${i}`} className="flex items-start gap-2 ps-3">
                  <span className="rounded-full p-1 flex-shrink-0 -ms-[22px]" style={{ background: `${color}1f`, color }}>
                    <Icon size={12} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-primary)] truncate">{e.title}</p>
                    <p className="text-[10px] text-[var(--text-dim)] truncate">
                      {[e.sub, new Date(e.at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' | ')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {rows?.partial && (
            <p className="text-[10px] text-[var(--text-dim)] mt-2">One register could not be read, the rest are shown.</p>
          )}
        </div>
      )}
    </ChartShell>
  )
}

function NoteWidget({ config }) {
  const title = config?.title || 'Note'
  const text = config?.text || ''
  return (
    <ChartShell title={title} icon={StickyNote}>
      {text.trim() ? (
        <div className="h-full overflow-y-auto text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{text}</div>
      ) : (
        <EmptyNote text="Empty note. Edit the layout and press Edit content to add text." />
      )}
    </ChartShell>
  )
}

function ImageWidget({ config }) {
  const [broken, setBroken] = useState(false)
  const src = safeImageSrc(config?.url)
  const caption = config?.caption || ''
  return (
    <ChartShell title={caption || 'Image'} icon={ImageIcon}>
      {!src ? (
        <EmptyNote text="No image yet. Edit the layout and press Edit content to add an image address." />
      ) : broken ? (
        <EmptyNote text="The image could not be loaded from this address." />
      ) : (
        <div className="h-full flex items-center justify-center">
          <img src={src} alt={caption || 'Dashboard image'} className="max-h-full max-w-full object-contain"
            loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        </div>
      )}
    </ChartShell>
  )
}

/**
 * @param {{ widgetId:string, slice:{rows:any[], error:string|null, loaded:boolean}, currency?:string, config?:object }} props
 *        `config` is the per-instance content of Note / Image widgets.
 */
export default function WidgetRenderer({ widgetId, slice, currency, config }) {
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
          sub: `${t.done} done | ${t.pending} pending | ${t.overdue} overdue`,
          tone: t.overdue > 0 ? 'warn' : 'accent',
        }
      }
      case 'pending-approvals':
        return {
          value: rows.length.toLocaleString(),
          sub: 'Imports awaiting review',
          tone: rows.length > 0 ? 'warn' : 'accent',
        }
      case 'maintenance-spend': {
        const snap = rows && rows.ok ? rows : null
        const v = snap?.kpis?.total_spend
        return {
          value: v != null ? formatCompactMoney(Number(v)) : 'N/A',
          unit: currency,
          sub: snap?.kpis?.job_cards != null ? `${Number(snap.kpis.job_cards).toLocaleString()} job cards` : '',
        }
      }
      case 'open-work-orders': {
        const open = rows?.open
        return {
          value: open == null ? 'N/A' : open.toLocaleString(),
          sub: rows?.total != null ? `of ${Number(rows.total).toLocaleString()} job cards on record` : 'Count unavailable',
          tone: open > 0 ? 'warn' : 'accent',
        }
      }
      case 'work-orders-trend': {
        const t = rows || {}
        const hasPrev = t.previous != null
        return {
          value: t.current == null ? 'N/A' : Number(t.current).toLocaleString(),
          delta: t.pct,
          sub: !hasPrev
            ? 'Earlier 30 days could not be read'
            : t.pct == null
              ? `No job cards in the 30 days before, so no change is shown`
              : `vs ${Number(t.previous).toLocaleString()} in the 30 days before`,
        }
      }
      default: return null
    }
  }, [def, slice, widgetId, currency])

  if (!def) return <WidgetErrorTile label="Unknown widget" message={widgetId} />
  // Text & media widgets render their saved content and read no data.
  if (def.kind === 'note') return <NoteWidget config={config} />
  if (def.kind === 'image') return <ImageWidget key={config?.url || 'empty'} config={config} />
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
    case 'tyre-status-split':     return <TyreStatusWidget rows={rows} />
    case 'tyre-failure-reasons':  return <TyreFailureWidget rows={rows} />
    case 'maintenance-by-type':   return <MaintenanceByTypeWidget rows={rows} />
    case 'top-maintenance-tasks': return <TopTasksWidget rows={rows} />
    case 'open-work-orders':
      return <StatTile label={def.label} value={derived.value} icon={Wrench} tone={derived.tone} sub={derived.sub} />
    case 'work-orders-trend':
      return <StatTile label={def.label} value={derived.value} icon={TrendingUp} tone="info" sub={derived.sub} delta={derived.delta ?? undefined} />
    case 'fleet-location':        return <FleetLocationWidget rows={rows} />
    case 'utilisation-trend':     return <UtilisationTrendWidget rows={rows} />
    case 'workshop-jobs':         return <WorkshopJobsWidget rows={rows} />
    case 'inspection-progress':   return <InspectionProgressWidget rows={rows} />
    case 'data-freshness':        return <DataFreshnessWidget rows={rows} />
    case 'inspection-heatmap':    return <InspectionHeatmapWidget rows={rows} />
    case 'activity-timeline':     return <TimelineWidget rows={rows} />
    case 'maintenance-spend':
      return <StatTile label={def.label} value={derived.value} unit={derived.unit} icon={Wrench} tone="accent" sub={derived.sub} />
    default:
      return <WidgetErrorTile label={def.label} message="No renderer for this widget" />
  }
}
