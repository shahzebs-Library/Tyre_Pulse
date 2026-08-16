/**
 * BoardOverview (route /board-overview) - the single management report.
 *
 * ONE colourful, trend-led report that consolidates every module: headline
 * KPIs first, then 12-month TRENDS, then breakdown CHARTS, then honest
 * RECOMMENDATIONS. Each section has an on/off toggle (persisted). All numbers
 * come from the shared engines (kpiEngine, claimsAnalytics) via boardOverview.js
 * - nothing is fabricated; an empty module renders an honest "N/A" / empty state.
 * Colours use the single shared palette (reportColors) so it reads as one system.
 *
 * REPORTING SCOPE (not the working context). A board report legitimately spans
 * countries, so this page reports on the set of countries chosen in the
 * ReportingScopeBar rather than on the one operational country in the top bar.
 * `activeCountry` is deliberately NOT read here, and nothing on this page writes
 * the working context: a cross-country report must not re-point the operational
 * selection of every other screen.
 *
 * The scope drives the QUERIES, not just the display. Every read is passed the
 * resolved country list (`countries`), which the service layer turns into ONE
 * bounded `country in (...)` read per table - not one read per country, which
 * would multiply each read's row ceiling behind the page's back. The countries
 * come from `scopeRequestCountries`, which drops anything the profile may not
 * aggregate over, so the scope can never widen access. A scope that resolves to
 * nothing issues ZERO requests and says so; it never falls back to "All".
 *
 * CURRENCY IS THE HARD RULE. KSA=SAR, UAE=AED, Egypt=EGP, and this page never
 * adds them - a blended SAR+AED+EGP total was a real shipped defect here. When
 * the scope spans one currency every money figure reads exactly as it always
 * did. When it spans more, every money figure is reported PER COUNTRY (tiles,
 * trend series, cost panel, PDF) and a scalar that cannot be split reads "N/A"
 * with the reason. Counts, rates and percentages carry no currency, so those
 * still aggregate across the whole scope. The split lives in the pure
 * `src/lib/boardScope.js` engine.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  LayoutDashboard, TrendingUp, PieChart, Lightbulb, Download, RefreshCw, Eye, EyeOff, Wallet, BarChart3,
  Gauge, Clock, Layers, AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import ReportingScopeBar from '../components/shell/ReportingScopeBar'
import YearlyTrendPanel from '../components/expense/YearlyTrendPanel'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import {
  listKpiTyreRecords, listKpiInspections, listKpiCorrectiveActions, listKpiFleet,
} from '../lib/api/engineeringKpi'
import { listAllAccidentsForPage } from '../lib/api/accidents'
import { listWorkOrdersForPage } from '../lib/api/workOrders'
import { listStockRecords } from '../lib/api/stock'
import {
  buildBoardKpis, buildTrends, buildBreakdowns, buildBoardRecommendations,
} from '../lib/boardOverview'
import { COST_MODES, pickCost, pickMonthly, splitTotals, costModeLabel } from '../lib/costSources'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import CostValue from '../components/cost/CostValue'
import { getFleetCpk } from '../lib/api/fleetCpk'
import {
  fmtCpkValue, fmtDistance, fmtCoverage, unitSuffix, sortByTypeWorstFirst, fleetTiles,
} from '../lib/fleetCpkView'
import { scopeLabel } from '../lib/reportingScope'
import { scopeRequestCountries, scopeQueryKey } from '../lib/reportingScopeQuery'
import {
  scopeCurrency, isMixedCurrencyScope, currencyScopeNote, splitRowsByCountry,
  perCountryMoney, perCountryMonthlySeries, mergeCostSplits, mergeFleetCpk,
  formatPerCountryMoney,
} from '../lib/boardScope'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel } from '../lib/exportUtils'
import EmailPdfButton from '../components/EmailPdfButton'
import PresentationStudio from '../components/present/PresentationStudio'
import StudioBoundary from '../components/present/StudioBoundary'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

// Hard row ceilings for the bounded client reads behind the board KPIs/charts.
// The event tables (tyre_records / inspections / corrective_actions) can grow to
// millions of rows, so the reads that feed the client-side engines are capped and
// a truncated read is surfaced as an honest "capped view" note. The fleet register
// read uses a tighter ceiling.
const ROW_CAP = 50000
const FLEET_CAP = 20000

const LS_KEY = 'boardOverview.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', LayoutDashboard],
  ['trends', 'Trends', TrendingUp],
  ['yearlyTrend', 'Yearly Expense', TrendingUp],
  ['charts', 'Charts', PieChart],
  ['costSplit', 'Tyres vs Maintenance', Wallet],
  ['fleetCpk', 'Fleet CPK', Gauge],
  ['builder', 'Chart Builder', BarChart3],
  ['recommendations', 'Recommendations', Lightbulb],
]
const SECTION_DEFAULTS = { kpis: true, trends: true, yearlyTrend: true, charts: true, costSplit: true, fleetCpk: true, builder: true, recommendations: true }

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

/**
 * String-safe 'YYYY-MM-DD' prefix range test (never `new Date(string)` - the
 * timezone trap). With NO range active every row passes (existing behavior);
 * with a range active a row with no usable date is EXCLUDED, never a crash.
 */
const inDateRange = (d, from, to) => {
  const s = d ? String(d).slice(0, 10) : ''
  if (!s) return !(from || to)
  if (from && s < from) return false
  if (to && s > to) return false
  return true
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
// Takes the ACTIVE currency: the fleet spans countries with different currencies
// (KSA SAR, UAE AED, Egypt EGP), so omitting it silently labelled every figure SAR.
const money = (v, currency) => (
  v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), currency)
)
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v)}%`)

const chartBase = (legend = false) => ({
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 8 } },
  plugins: {
    legend: { display: legend, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' } },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
  },
})
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

/** Colourful KPI tile. */
function Kpi({ label, value, accent = ACCENTS.primary, sub }) {
  return (
    <div className="card" style={{ borderTop: `3px solid ${accent}` }}>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
      {sub ? <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p> : null}
    </div>
  )
}

function ChartCard({ title, children, refCb }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div style={{ height: 240 }} ref={refCb}>{children}</div>
    </div>
  )
}

/**
 * A money figure under the reporting scope.
 *
 * One currency in scope: exactly the single figure this page always rendered.
 * More than one: one line per country in its own currency, because that IS the
 * answer - there is no single number to show. Never a blend, and 'N/A' when
 * nothing in scope reported a usable figure (which is a different statement from
 * a country reporting zero).
 */
function ScopeMoney({ mixed, value, currency, entries, pick }) {
  if (!mixed) return <>{value == null || !Number.isFinite(Number(value)) ? 'N/A' : formatCurrency(Number(value), currency)}</>
  const rows = perCountryMoney(entries, pick).filter((r) => r.value != null)
  if (!rows.length) return <>N/A</>
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((r) => (
        <span key={r.country} style={{ whiteSpace: 'nowrap', fontSize: '0.62em', lineHeight: 1.35 }}>
          <span style={{ opacity: 0.65, marginRight: 6 }}>{r.country}</span>
          {formatCurrency(r.value, r.currency)}
        </span>
      ))}
    </span>
  )
}

export default function BoardOverview() {
  // REPORTING SCOPE, not the working context: this report aggregates the set of
  // countries the reader picked. `activeCountry` / `activeCurrency` are
  // deliberately NOT read - the currency of this report follows its scope.
  const { appSettings, reportingScope, allowedScopeCountries } = useSettings()

  // Every country this page will request. Permission-filtered by
  // `scopeRequestCountries`, so a persisted or stale scope can never ask for a
  // country this profile may not aggregate over. Resolved through a stable
  // string key so an equal-but-newly-built array cannot retrigger the fetches.
  const scopeKey = useMemo(
    () => scopeQueryKey(scopeRequestCountries(reportingScope, allowedScopeCountries)),
    [reportingScope, allowedScopeCountries],
  )
  const scopeCountryList = useMemo(() => (scopeKey ? scopeKey.split('|') : []), [scopeKey])
  const scopeTitle = scopeLabel(reportingScope, allowedScopeCountries)
  const hasScope = scopeCountryList.length > 0
  // The single currency this report is denominated in, or null when the scope
  // spans several - which is the signal to report every money figure per country.
  const scopeCur = useMemo(() => scopeCurrency(scopeCountryList), [scopeCountryList])
  const mixedCurrency = useMemo(() => isMixedCurrencyScope(scopeCountryList), [scopeCountryList])
  const currencyNote = useMemo(() => currencyScopeNote(scopeCountryList), [scopeCountryList])

  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  // Client-side date range (calendar from/to). Empty = existing behavior.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [truncated, setTruncated] = useState(false)

  const [sections, setSections] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      return { ...SECTION_DEFAULTS, ...(raw || {}) }
    } catch { return { ...SECTION_DEFAULTS } }
  })
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(sections)) } catch { /* ignore */ } }, [sections])
  const toggle = (key) => setSections((s) => ({ ...s, [key]: !s[key] }))

  const chartRefs = useRef({})
  const setRef = (key) => (el) => { chartRefs.current[key] = el }

  const load = useCallback(async () => {
    // A scope that resolves to no country reports on nothing, and asks the
    // server for nothing. Falling back to an unscoped read here would silently
    // report on every country the reader did not select.
    if (!hasScope) {
      setRaw(null); setTruncated(false); setError('')
      setLoading(false); setRefreshing(false)
      return
    }
    setRefreshing(true); setError('')
    try {
      // `countries` is the reporting scope. Each service turns it into ONE
      // bounded `country in (...)` read, so the row ceilings below still cap the
      // whole read rather than being applied once per country.
      const countries = scopeCountryList
      const [tyresRes, inspRes, actionsQ, fleetQ, accRes, workOrders, stock] = await Promise.all([
        fetchAllPages((from, to) => listKpiTyreRecords({ countries, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiInspections({ countries, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiCorrectiveActions({ countries, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiFleet({ countries, from, to }), { max: FLEET_CAP }),
        listAllAccidentsForPage({ countries }),
        // `lean` drops custom_data / notes / parts_used from the select. The
        // board reads the whole table on purpose - its KPIs are all-time - but
        // it only ever counts statuses and dates, so shipping the raw ERP jsonb
        // for every job card was the expensive half of that and bought nothing.
        // The window stays unbounded deliberately; narrowing it would change
        // what the executive KPIs mean, which is the owner's call, not a
        // performance fix.
        listWorkOrdersForPage({ countries, lean: true }).catch(() => []),
        listStockRecords({ countries }).catch(() => []),
      ])
      const tyres = tyresRes.data ?? []
      const inspections = inspRes.data ?? []
      const actions = actionsQ?.data ?? []
      const fleetSize = (fleetQ?.data ?? []).length
      const accidents = accRes?.data ?? []
      setTruncated(Boolean(tyresRes.truncated || inspRes.truncated || actionsQ.truncated || fleetQ.truncated))
      setRaw({
        tyres, inspections, actions, fleetSize, accidents,
        workOrders: workOrders || [], stock: stock || [],
      })
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the board overview.'))
      setTruncated(false)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [hasScope, scopeCountryList])

  useEffect(() => { load() }, [load])

  // Recompute the board from the loaded rows with the client-side date range
  // applied to tyres (issue_date), accidents (incident_date), inspections
  // (completed_date, falling back to scheduled_date) and work orders
  // (completed_at, falling back to created_at). Empty range = the raw arrays
  // pass through untouched, so the output is identical to the unfiltered board.
  const rangeActive = Boolean(fromDate || toDate)
  const data = useMemo(() => {
    if (!raw) return null
    const tyres = rangeActive ? raw.tyres.filter((r) => inDateRange(r.issue_date, fromDate, toDate)) : raw.tyres
    const accidents = rangeActive ? raw.accidents.filter((r) => inDateRange(r.incident_date, fromDate, toDate)) : raw.accidents
    const inspections = rangeActive ? raw.inspections.filter((r) => inDateRange(r.completed_date || r.scheduled_date, fromDate, toDate)) : raw.inspections
    const workOrders = rangeActive ? raw.workOrders.filter((r) => inDateRange(r.completed_at || r.created_at, fromDate, toDate)) : raw.workOrders
    const now = new Date()
    return {
      rows: { tyres, inspections, accidents, workOrders },
      kpis: buildBoardKpis({ tyres, inspections, actions: raw.actions, fleetSize: raw.fleetSize, accidents, workOrders, stock: raw.stock, now }),
      trends: buildTrends({ tyres, accidents, inspections, now }),
      breakdowns: buildBreakdowns({ accidents, tyres }),
    }
  }, [raw, rangeActive, fromDate, toDate])

  /**
   * The same board, computed once PER COUNTRY. Only built when the scope spans
   * currencies, because that is the only case where a blended money figure would
   * be wrong; a single-currency scope keeps using the whole-scope numbers above
   * and pays nothing for this.
   *
   * No extra I/O: every row is already loaded and simply partitioned. Counts are
   * NOT read from here - a count carries no currency, so aggregating it over the
   * whole scope is honest and is what the tiles keep doing.
   */
  const perCountry = useMemo(() => {
    if (!mixedCurrency || !data || !raw) return []
    const now = new Date()
    const tyresBy = splitRowsByCountry(data.rows.tyres, scopeCountryList)
    const inspBy = splitRowsByCountry(data.rows.inspections, scopeCountryList)
    const accBy = splitRowsByCountry(data.rows.accidents, scopeCountryList)
    const woBy = splitRowsByCountry(data.rows.workOrders, scopeCountryList)
    const actBy = splitRowsByCountry(raw.actions, scopeCountryList)
    return scopeCountryList.map((country, i) => ({
      country,
      currency: tyresBy[i].currency,
      kpis: buildBoardKpis({
        tyres: tyresBy[i].rows,
        inspections: inspBy[i].rows,
        actions: actBy[i].rows,
        // The fleet roster is a count, not money, and this page does not hold a
        // per-country roster split - so it is left out of the per-country KPI
        // set rather than guessed. Only the money fields below are read from it.
        fleetSize: 0,
        accidents: accBy[i].rows,
        workOrders: woBy[i].rows,
        stock: [],
        now,
      }),
      trends: buildTrends({ tyres: tyresBy[i].rows, accidents: accBy[i].rows, inspections: inspBy[i].rows, now }),
    }))
  }, [mixedCurrency, data, raw, scopeCountryList])

  /**
   * Recommendations. On a mixed scope they are derived PER COUNTRY and named,
   * because the recovery-rate line divides claimed by recovered - a ratio of two
   * sums that would each be a blend of currencies, and therefore meaningless.
   */
  const recs = useMemo(() => {
    if (!mixedCurrency) return buildBoardRecommendations(data?.kpis)
    return perCountry
      .flatMap((pc) => buildBoardRecommendations(pc.kpis).map((r) => ({ ...r, text: `${pc.country}: ${r.text}` })))
      .slice(0, 8)
  }, [mixedCurrency, data, perCountry])

  // ── Tyres vs Maintenance cost split (own tri-state + cancel guard) ──────────
  const [cost, setCost] = useState(null)      // { tyre, maintenance, byMonth } | null
  const [costLoading, setCostLoading] = useState(true)
  const [costError, setCostError] = useState('')
  const [costMode, setCostMode] = useState('combined')

  useEffect(() => {
    let cancelled = false
    if (!hasScope) { setCost(null); setCostError(''); setCostLoading(false); return undefined }
    setCostLoading(true); setCostError('')
    // ONE governed split per country, merged by the pure engine. Per country and
    // not one blended call, because each country's spend has to stay in its own
    // currency - `loadGovernedCostSplit` is the only reader that knows how to
    // denominate a total, and it can only do that for a single country.
    Promise.all(
      scopeCountryList.map((country) =>
        loadGovernedCostSplit({ country }).then((split) => ({ country, split })),
      ),
    )
      .then((res) => { if (!cancelled) setCost(mergeCostSplits(res)) })
      .catch((e) => { if (!cancelled) setCostError(toUserMessage(e, 'Could not load the cost split.')) })
      .finally(() => { if (!cancelled) setCostLoading(false) })
    return () => { cancelled = true }
  }, [hasScope, scopeCountryList])

  // True when the cost panel spans currencies, so it must report per country.
  const costMixed = Boolean(cost?.blended)
  const costPerCountry = useMemo(() => cost?.perCountry || [], [cost])
  const costTotals = useMemo(() => splitTotals(cost?.byMonth || []), [cost])
  const costHeadline = useMemo(() => pickCost(costMode, costTotals), [costMode, costTotals])
  // Is there any spend at all in scope? On a mixed scope `costTotals` is 0 by
  // construction (the merge refuses to add currencies), so asking it would
  // render "no spend recorded" over real money.
  const costHasSpend = costMixed
    ? costPerCountry.some((p) => Number(p.combined) > 0)
    : costTotals.combined > 0

  // ── Unit-aware Fleet CPK (cost per km / hour) ───────────────────────────────
  // Server aggregate get_fleet_cpk chooses km for road assets and engine-hours for
  // plant, and keeps each country in its own currency. Windowed to the last 365
  // days (this page has no date-range control).
  const [fleetCpk, setFleetCpk] = useState({ perVehicle: [], byType: [], fleet: [] })
  const [fleetCpkLoading, setFleetCpkLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    if (!hasScope) {
      setFleetCpk({ perVehicle: [], byType: [], fleet: [] }); setFleetCpkLoading(false)
      return undefined
    }
    setFleetCpkLoading(true)
    const p = (n) => String(n).padStart(2, '0')
    const today = new Date()
    const start = new Date(); start.setDate(start.getDate() - 365)
    const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    // One aggregate RPC per country in scope. This one is safe to fan out: it
    // returns a handful of pre-aggregated rows, each already carrying its own
    // country and currency, and the page renders one tile per row rather than
    // adding them - so merging is concatenation, not arithmetic.
    Promise.all(
      scopeCountryList.map((country) => getFleetCpk({ country, from: iso(start), to: iso(today) })),
    )
      .then((res) => { if (!cancelled) setFleetCpk(mergeFleetCpk(res)) })
      .catch(() => { if (!cancelled) setFleetCpk({ perVehicle: [], byType: [], fleet: [] }) })
      .finally(() => { if (!cancelled) setFleetCpkLoading(false) })
    return () => { cancelled = true }
  }, [hasScope, scopeCountryList])

  const cpkFleetTiles = useMemo(() => fleetTiles(fleetCpk.fleet), [fleetCpk])
  // Top worst asset-types (highest CPK first). Cap at 6 for a board summary.
  const cpkTopTypes = useMemo(() => sortByTypeWorstFirst(fleetCpk.byType).slice(0, 6), [fleetCpk])
  const cpkHasData = cpkFleetTiles.length > 0 || cpkTopTypes.length > 0

  // AUTHORITATIVE tyre spend = the classified expense grid (loadCostSplit),
  // never a sum of tyre_records.cost_per_tyre: a large share of tyre rows carry
  // no price, so that sum understates real tyre spend several-fold. This page
  // already renders the grid figure in its Tyres-vs-Maintenance panel, so using
  // the engine's cost_per_tyre fallback for the headline KPI put two different
  // numbers for the SAME fact on one screen. Falls back to the engine value only
  // when the grid has nothing for this scope.
  const tyreSpendValue = useMemo(
    () => (costTotals.tyre > 0 ? costTotals.tyre : (data?.kpis?.tyreSpend ?? null)),
    [costTotals, data],
  )
  /**
   * Per-country tyre spend for a mixed scope. Prefers the authoritative expense
   * grid and falls back to the country's own tyre-record total, so each country
   * is measured the same way the single-country headline is.
   */
  const tyreSpendPerCountry = useMemo(() => {
    if (!mixedCurrency) return []
    const grid = new Map(costPerCountry.map((p) => [p.country, p.tyre]))
    return perCountry.map((pc) => ({
      country: pc.country,
      value: Number(grid.get(pc.country)) > 0 ? grid.get(pc.country) : pc.kpis?.tyreSpend ?? null,
    }))
  }, [mixedCurrency, costPerCountry, perCountry])

  const costChart = useMemo(() => {
    // Mixed scope: one series PER COUNTRY, each labelled with its own currency,
    // never one blended line. The caption below the chart says the axis mixes
    // currencies, which a shared y-axis cannot say for itself.
    if (costMixed) {
      const s = perCountryMonthlySeries(costPerCountry, (m) => pickCost(costMode, m))
      return { labels: s.labels.map(monthLabel), datasets: s.datasets }
    }
    const rows = cost?.byMonth || []
    return {
      labels: rows.map((r) => monthLabel(r.month)),
      datasets: [{ label: `${costModeLabel(costMode)} spend`, data: pickMonthly(costMode, rows).map((m) => m.value) }],
    }
  }, [cost, costMode, costMixed, costPerCountry])

  /**
   * The two MONEY trend charts under a mixed scope: one series per country in
   * its own currency instead of a single blended line. The count trends
   * (accidents, inspections) are untouched - they carry no currency.
   */
  const tyreSpendTrend = useMemo(() => {
    if (!mixedCurrency || !data?.trends) return data?.trends?.tyreSpend
    return {
      labels: data.trends.labels,
      datasets: perCountry.map((pc) => ({
        label: pc.currency ? `${pc.country} (${pc.currency})` : pc.country,
        data: pc.trends.tyreSpend.datasets[0].data,
      })),
    }
  }, [mixedCurrency, data, perCountry])

  const claimsTrend = useMemo(() => {
    if (!mixedCurrency || !data?.trends) return data?.trends?.claims
    return {
      labels: data.trends.labels,
      datasets: perCountry.flatMap((pc) => pc.trends.claims.datasets.map((ds) => ({
        ...ds,
        label: pc.currency ? `${pc.country} ${ds.label} (${pc.currency})` : `${pc.country} ${ds.label}`,
      }))),
    }
  }, [mixedCurrency, data, perCountry])

  // Chart Builder catalog: the board's own breakdowns + trends, ready to present.
  const studioCatalog = useMemo(() => {
    const b = data?.breakdowns
    const t = data?.trends
    const flat = (key, label, chart, valueKind) => {
      const labels = chart?.labels || []
      const d = chart?.datasets?.[0]?.data || []
      return { key, label, kind: 'flat', valueKind, rows: labels.map((l, i) => ({ label: l, value: Number(d[i]) || 0 })) }
    }
    const series = (key, label, chart, valueKind, allowTotal = false) => ({
      key, label, kind: 'series', valueKind, allowTotal,
      labels: chart?.labels || [],
      series: (chart?.datasets || []).map((ds) => ({ name: ds.label || 'Value', data: ds.data || [] })),
    })
    const out = []
    if (b) {
      out.push(flat('acc_site', 'Accidents by site', b.accidentsBySite, 'count'))
      out.push(flat('tyre_site', 'Tyres by site', b.tyresBySite, 'count'))
      out.push(flat('acc_sev', 'Accident severity', b.accidentSeverity, 'count'))
      out.push(flat('claim_status', 'Claim status', b.claimStatus, 'count'))
    }
    if (t) {
      // The money series come from the scope-aware versions, so a deck built
      // from a multi-country scope carries one series per country rather than a
      // blended line. `allowTotal` stays off for them: totalling across
      // currencies is exactly what must not happen.
      out.push(series('m_tyre', 'Monthly tyre spend', tyreSpendTrend, 'money'))
      out.push(series('m_acc', 'Monthly accidents', t.accidents, 'count'))
      out.push(series('m_insp', 'Monthly inspections', t.inspections, 'count'))
      out.push(series('m_claims', 'Monthly claims (claimed vs recovered)', claimsTrend, 'money', !mixedCurrency))
    }
    if ((costChart.labels || []).length) out.push(series('m_cost', `Monthly ${costModeLabel(costMode).toLowerCase()} cost`, costChart, 'money'))
    return out.filter((s) => (s.kind === 'series' ? (s.labels || []).length : (s.rows || []).length))
  }, [data, costChart, costMode, tyreSpendTrend, claimsTrend, mixedCurrency])

  // Build the Board Overview PDF doc. Shared by Download + Email so the emailed
  // report is identical to the downloaded one. Returns { doc, company } or null.
  async function buildBoardDoc() {
    if (!data) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const M = 12
      const company = appSettings?.company_name || 'TyrePulse'
      const scope = scopeCountryList.join(', ') || scopeTitle
      doc.setFontSize(16); doc.setTextColor(15, 23, 42)
      doc.text(`${company} - Board Overview`, M, 16)
      doc.setFontSize(9); doc.setTextColor(100, 116, 139)
      doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

      const k = data.kpis
      // A PDF cell can only hold a string, so on a mixed scope each money figure
      // is written out per country on one line. The printed copy must never say
      // something the screen refuses to.
      const perCountryFmt = (pick) => formatPerCountryMoney(
        perCountryMoney(perCountry, pick),
        (v, cur) => formatCurrency(v, cur),
      )
      const scopeMoney = (value, pick) => (
        mixedCurrency ? perCountryFmt(pick) : money(value, scopeCur)
      )
      const tiles = [
        ['Fleet vehicles', num(k.fleetSize)], ['Tyres tracked', num(k.tyresTracked)],
        ['Fleet avg CPK', scopeMoney(k.fleetAvgCpk, (e) => e.kpis?.fleetAvgCpk)],
        ['Tyre spend', mixedCurrency
          ? formatPerCountryMoney(
            perCountryMoney(tyreSpendPerCountry, (e) => e.value),
            (v, cur) => formatCurrency(v, cur),
          )
          : money(tyreSpendValue, scopeCur)],
        ['Accidents', num(k.accidents)], ['Open accidents', num(k.openAccidents)],
        ['Claims value', scopeMoney(k.claimed, (e) => e.kpis?.claimed)],
        ['Recovered', scopeMoney(k.recovered, (e) => e.kpis?.recovered)],
        ['Inspections', num(k.inspections)], ['Work orders open', num(k.workOrdersOpen)],
      ]
      let y = 30
      doc.setFontSize(8)
      tiles.forEach((t, i) => {
        const col = i % 5, row = Math.floor(i / 5)
        const x = M + col * ((W - 2 * M) / 5)
        const yy = y + row * 16
        doc.setTextColor(15, 23, 42)
        // A per-country money string is far longer than a single figure, so it
        // is set smaller and wrapped inside its column instead of running over
        // the neighbouring tile.
        const value = String(t[1])
        const wide = value.length > 22
        doc.setFontSize(wide ? 7 : 11)
        doc.text(doc.splitTextToSize(value, (W - 2 * M) / 5 - 4).slice(0, 3), x, yy + (wide ? 4 : 6))
        doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(t[0]), x, yy + 12)
      })
      y += 34
      if (currencyNote) {
        doc.setTextColor(100, 116, 139); doc.setFontSize(7)
        doc.text(doc.splitTextToSize(currencyNote, W - 2 * M), M, y)
        y += 8
      }

      // Fleet CPK summary (text): one line per country tile, each in its own
      // currency. Straightforward text, so it travels with the board PDF.
      if (cpkFleetTiles.length > 0) {
        doc.setTextColor(15, 23, 42); doc.setFontSize(10)
        doc.text('Fleet CPK (cost per km / hour, last 365 days)', M, y)
        y += 6
        doc.setFontSize(8)
        cpkFleetTiles.forEach((tile) => {
          const unitLabel = tile.unit === 'engine_hours' ? 'per hour' : 'per km'
          doc.setTextColor(71, 85, 105)
          doc.text(
            `${tile.country || 'Fleet'} (${unitLabel}): Total ${fmtCpkValue(tile.cpkTotal, tile.currency, tile.unit)}`
              + `  |  Tyre ${fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit)}  |  Coverage ${fmtCoverage(tile.coveragePct)}`,
            M, y,
          )
          y += 5
        })
        y += 4
      }

      const order = ['trendSpend', 'trendAccidents', 'trendClaims', 'trendInspections', 'costSplit', 'sev', 'claimStatus', 'accSite', 'tyreSite']
      let placed = 0
      for (const key of order) {
        const el = chartRefs.current[key]
        const canvas = el?.querySelector?.('canvas')
        if (!canvas) continue
        const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
        if (!img) continue
        const cw = (W - 2 * M - 8) / 2
        const ch = 55
        const col = placed % 2, rowY = y + Math.floor(placed / 2) * (ch + 6)
        if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
        const x = M + col * (cw + 8)
        const yy = y + Math.floor(placed / 2) * (ch + 6)
        doc.addImage(img, 'PNG', x, yy, cw, ch)
        placed += 1
      }
      return { doc, company }
  }

  async function exportPdf() {
    if (!data) return
    setExporting(true)
    try {
      const built = await buildBoardDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Board Overview', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  const k = data?.kpis
  const t = data?.trends
  const b = data?.breakdowns
  const hasAny = k && (k.tyresTracked || k.accidents || k.inspections || k.fleetSize)

  return (
    <div className="space-y-5">
      <PageHeader title="Board Overview" subtitle="One report: KPIs, trends and charts across every module" icon={LayoutDashboard} />

      {/* Reporting scope: which countries this report aggregates. Separate from
          the working context in the top bar, and it drives every query below. */}
      <div className="card p-3 space-y-2">
        <ReportingScopeBar />
        {currencyNote && <p className="text-[11px] text-[var(--text-muted)]">{currencyNote}</p>}
      </div>

      {/* Section toggles + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}
            >
              <Icon size={13} /> {label} {sections[key] ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <DateField className="text-sm w-40" value={fromDate} onChange={setFromDate} placeholder="From date" ariaLabel="From date" />
            <DateField className="text-sm w-40" value={toDate} onChange={setToDate} placeholder="To date" ariaLabel="To date" min={fromDate || undefined} />
            {rangeActive && (
              <button
                onClick={() => { setFromDate(''); setToDate('') }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
          <EmailPdfButton
            disabled={!hasAny}
            className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
            getPdf={async () => {
              const built = await buildBoardDoc()
              if (!built) throw new Error('No data to send.')
              return {
                base64: built.doc.output('datauristring').split(',')[1],
                filename: `${reportFileName(built.company, 'Board Overview', reportDateLabel())}.pdf`,
                subject: `${built.company} - Board Overview`,
                bodyHtml: `<p>Attached is the ${built.company} Board Overview report.</p>`,
              }
            }}
          />
        </div>
      </div>

      {rangeActive && (
        <p className="text-[11px] text-[var(--text-muted)]">
          Date range applies to tyres, accidents, inspections and work orders. The fleet register count, Fleet CPK (last 365 days) and the expense-grid cost panels keep their own windows.
        </p>
      )}

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {!hasScope ? (
        <div className="card text-center text-[var(--text-muted)] py-10">
          No countries are selected in the reporting scope, so there is nothing to report on.
        </div>
      ) : loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the board overview...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">No data yet for {scopeTitle}. Records will appear here as they are captured.</div>
      ) : (
        <>
          {truncated && (
            <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
              <AlertTriangle size={13} />
              Showing a capped view of up to {ROW_CAP.toLocaleString('en-US')} records for {scopeTitle}. KPIs, trends and charts reflect this capped set. Select fewer countries in the reporting scope for full detail.
            </div>
          )}

          {/* KPIs */}
          {sections.kpis && k && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* Counts and rates carry no currency, so they aggregate across
                    the whole scope. Every MONEY tile goes through ScopeMoney,
                    which reports per country the moment the scope spans more
                    than one currency. */}
                <Kpi label="Fleet vehicles" value={num(k.fleetSize)} accent={ACCENTS.primary} />
                <Kpi label="Tyres tracked" value={num(k.tyresTracked)} accent={ACCENTS.info} />
                <Kpi label="Fleet avg CPK" accent={ACCENTS.good}
                  value={<ScopeMoney mixed={mixedCurrency} value={k.fleetAvgCpk} currency={scopeCur}
                    entries={perCountry} pick={(e) => e.kpis?.fleetAvgCpk} />} />
                {/* GOVERNED: renders one figure per currency when the scope
                    spans countries, instead of labelling a blend as SAR. */}
                <Kpi label="Tyre spend"
                  value={costHasSpend && (costMixed || costTotals.tyre > 0)
                    ? <CostValue split={cost} mode="tyres" />
                    : <ScopeMoney mixed={mixedCurrency} value={tyreSpendValue} currency={scopeCur}
                      entries={tyreSpendPerCountry} pick={(e) => e.value} />}
                  accent={ACCENTS.watch}
                  sub={costHasSpend && (costMixed || costTotals.tyre > 0) ? 'expense grid, last 12 mo' : 'from tyre records'} />
                <Kpi label="Failure rate" value={pct(k.failureRatePct)} accent={ACCENTS.risk} />
                <Kpi label="Accidents" value={num(k.accidents)} accent={ACCENTS.risk} sub={`${num(k.openAccidents)} open`} />
                <Kpi label="Claims value" accent={ACCENTS.primary}
                  value={<ScopeMoney mixed={mixedCurrency} value={k.claimed} currency={scopeCur}
                    entries={perCountry} pick={(e) => e.kpis?.claimed} />}
                  sub={mixedCurrency
                    ? `${formatPerCountryMoney(perCountryMoney(perCountry, (e) => e.kpis?.recovered), (v, cur) => formatCurrency(v, cur))} recovered`
                    : `${money(k.recovered, scopeCur)} recovered`} />
                <Kpi label="Net exposure" accent={ACCENTS.watch}
                  value={<ScopeMoney mixed={mixedCurrency} value={k.netExposure} currency={scopeCur}
                    entries={perCountry} pick={(e) => e.kpis?.netExposure} />} />
                <Kpi label="Inspections" value={num(k.inspections)} accent={ACCENTS.info} sub={k.inspectionCompliancePct != null ? `${pct(k.inspectionCompliancePct)} compliant` : undefined} />
                <Kpi label="Work orders open" value={num(k.workOrdersOpen)} accent={ACCENTS.good} sub={`${num(k.workOrdersOverdue)} overdue`} />
              </div>
            </section>
          )}

          {/* Trends */}
          {sections.trends && t && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Trends, last 12 months</h2>
              {mixedCurrency && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  The two spend charts carry one line per country in its own currency. They share an axis but are never added together; compare each country against itself.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Tyre spend" refCb={setRef('trendSpend')}><Line data={stylize(tyreSpendTrend, mixedCurrency ? 'line' : 'area')} options={chartBase(mixedCurrency)} /></ChartCard>
                <ChartCard title="Accidents" refCb={setRef('trendAccidents')}><Line data={stylize(t.accidents, 'area')} options={chartBase(false)} /></ChartCard>
                <ChartCard title="Claims: claimed vs recovered" refCb={setRef('trendClaims')}><Line data={stylize(claimsTrend, 'line')} options={chartBase(true)} /></ChartCard>
                <ChartCard title="Inspections" refCb={setRef('trendInspections')}><Line data={stylize(t.inspections, 'area')} options={chartBase(false)} /></ChartCard>
              </div>
            </section>
          )}

          {/* Yearly expense trend + forecast */}
          {sections.yearlyTrend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Yearly expense trend &amp; forecast</h2>
              <YearlyTrendPanel title="Expense by year (tyres / spare / lubricant) + forecast" />
            </section>
          )}

          {/* Charts */}
          {sections.charts && b && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Breakdowns</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Accidents by severity" refCb={setRef('sev')}><Doughnut data={stylize(b.accidentSeverity, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
                <ChartCard title="Claim status" refCb={setRef('claimStatus')}><Doughnut data={stylize(b.claimStatus, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
                <ChartCard title="Accidents by site" refCb={setRef('accSite')}><Bar data={stylize(b.accidentsBySite, 'bar')} options={chartBase(false)} /></ChartCard>
                <ChartCard title="Tyres by site" refCb={setRef('tyreSite')}><Bar data={stylize(b.tyresBySite, 'bar')} options={chartBase(false)} /></ChartCard>
              </div>
            </section>
          )}

          {/* Tyres vs Maintenance cost split */}
          {sections.costSplit && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Wallet size={15} /> Tyres vs Maintenance</h2>
              <div className="card">
                {costLoading ? (
                  <div className="text-center text-[var(--text-muted)] py-8">Loading the cost split...</div>
                ) : costError ? (
                  <div className="text-sm text-red-300">{costError}</div>
                ) : !costHasSpend ? (
                  <div className="text-center text-[var(--text-muted)] py-8">No tyre or maintenance spend recorded in the last 12 months for {scopeTitle}.</div>
                ) : (
                  <>
                    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                      <div>
                        {/* A mixed scope has no single headline: the figure would
                            be a blend. It reads N/A and every country reports its
                            own three totals underneath. */}
                        <p className="text-3xl font-bold" style={{ color: ACCENTS.primary }}>
                          {costMixed ? 'N/A' : formatCurrency(costHeadline, scopeCur, 0)}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">{costModeLabel(costMode)} spend, last 12 months</p>
                        {costMixed ? (
                          <div className="mt-2 space-y-1 text-[11px] text-[var(--text-dim)]">
                            {costPerCountry.map((p) => (
                              <div key={p.country} className="flex items-center gap-3 flex-wrap">
                                <span className="text-[var(--text-secondary)] font-medium">{p.country}</span>
                                <span>Tyres: {formatCurrency(p.tyre, p.currency, 0)}</span>
                                <span>Maintenance: {formatCurrency(p.maintenance, p.currency, 0)}</span>
                                <span>Combined: {formatCurrency(p.combined, p.currency, 0)}</span>
                              </div>
                            ))}
                            <p className="text-[var(--text-muted)]">
                              Shown per country because the scope spans more than one currency. These figures are never added together.
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--text-dim)]">
                            <span>Tyres: {formatCurrency(costTotals.tyre, scopeCur, 0)}</span>
                            <span>Maintenance: {formatCurrency(costTotals.maintenance, scopeCur, 0)}</span>
                            <span>Combined: {formatCurrency(costTotals.combined, scopeCur, 0)}</span>
                          </div>
                        )}
                      </div>
                      <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden self-start">
                        {COST_MODES.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => setCostMode(m.key)}
                            className={`text-xs font-semibold px-3 py-1.5 transition-colors ${costMode === m.key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ height: 240 }} ref={setRef('costSplit')}>
                      <Bar data={stylize(costChart, 'bar')} options={chartBase(costMixed)} />
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Fleet CPK (cost per km / hour). Currency-safe per country. */}
          {sections.fleetCpk && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
                <Gauge size={15} /> Fleet CPK (cost per km / hour)
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Km for road assets, engine-hours for plant. Currency stays per country. Window: last 365 days.
              </p>
              {fleetCpkLoading ? (
                <div className="card text-center text-[var(--text-muted)] py-8">Computing unit-aware CPK...</div>
              ) : !cpkHasData ? (
                <div className="card text-center text-[var(--text-muted)] py-8">
                  No CPK data for the selected scope. CPK needs measured distance (odometer) or engine-hours plus expense data.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cpkFleetTiles.map((tile, i) => {
                      const isHours = tile.unit === 'engine_hours'
                      return (
                        <div key={`${tile.country}-${tile.unit}-${i}`} className="card border border-[var(--input-border)] flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isHours ? <Clock size={14} className="text-amber-400 shrink-0" /> : <Gauge size={14} className="text-[var(--accent)] shrink-0" />}
                              <span className="text-xs text-[var(--text-secondary)] font-medium truncate">
                                {tile.country || 'Fleet'} - {isHours ? 'per hour' : 'per km'}
                              </span>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] uppercase">{tile.currency}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Total CPK</p>
                              <p className="text-base font-bold text-[var(--text-primary)] leading-tight">{fmtCpkValue(tile.cpkTotal, tile.currency, tile.unit)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Tyre CPK</p>
                              <p className="text-base font-bold text-[var(--text-secondary)] leading-tight">{fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit)}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {fmtDistance(tile.distance, tile.unit)} measured | Coverage {fmtCoverage(tile.coveragePct)}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {cpkTopTypes.length > 0 && (
                    <div className="card overflow-x-auto">
                      <div className="flex items-center gap-2 mb-3">
                        <Layers size={15} className="text-[var(--text-muted)]" />
                        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Worst asset types by CPK</h3>
                        <span className="text-xs text-[var(--text-muted)] ml-auto">top {cpkTopTypes.length}</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left border-b border-[var(--input-border)]">
                            <th className="table-header pb-2 pr-3">Asset Type</th>
                            <th className="table-header pb-2 pr-3">Unit</th>
                            <th className="table-header pb-2 pr-3 text-right">Distance / Hours</th>
                            <th className="table-header pb-2 text-right">CPK Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpkTopTypes.map((r, i) => {
                            const cur = r.currency || r.country || ''
                            return (
                              <tr key={`${r.country}-${r.vehicle_type}-${r.unit}-${i}`} className="border-b border-[var(--input-border)]/50">
                                <td className="table-cell py-2 pr-3 text-[var(--text-secondary)] font-medium">
                                  {r.vehicle_type}
                                  {r.country ? <span className="text-[var(--text-muted)]"> - {r.country}</span> : null}
                                </td>
                                <td className="table-cell py-2 pr-3 text-[var(--text-muted)]">{unitSuffix(r.unit).replace('/', '')}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtDistance(r.distance_or_hours, r.unit)}</td>
                                <td className="table-cell py-2 text-right">
                                  <span className={r.cpk_total == null ? 'text-[var(--text-muted)]' : 'font-medium text-[var(--text-primary)]'}>
                                    {fmtCpkValue(r.cpk_total, cur, r.unit)}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Chart Builder - present any of the board's data as a chart / PowerPoint */}
          {sections.builder && data && studioCatalog.length > 0 && (
            <StudioBoundary>
              <PresentationStudio
                catalog={studioCatalog}
                // The studio labels its own money axis. On a mixed scope there is
                // no single currency to label it with, so it is left unset and
                // each series carries its country and currency in its name.
                currency={mixedCurrency ? undefined : scopeCur}
                money={(v) => (mixedCurrency ? num(v) : money(v, scopeCur))}
                scope={scopeCountryList.join(', ') || scopeTitle}
                company={appSettings?.company_name || 'TyrePulse'}
                filePrefix="Board"
                note={mixedCurrency
                  ? 'Present any board figure as a chart, then copy, download a PNG, or export a PowerPoint deck. Spend series are per country in their own currency and are never added together.'
                  : 'Present any board figure as a chart, then copy, download a PNG, or export a PowerPoint deck.'}
              />
            </StudioBoundary>
          )}

          {/* Recommendations */}
          {sections.recommendations && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Lightbulb size={15} /> Recommendations</h2>
              {recs.length === 0 ? (
                <div className="card text-sm text-[var(--text-muted)]">No critical issues stand out this period. Maintain inspection cadence and monitor the trends above.</div>
              ) : (
                <div className="space-y-2">
                  {recs.map((r, i) => {
                    const c = r.level === 'high' ? ACCENTS.risk : r.level === 'medium' ? ACCENTS.watch : ACCENTS.good
                    return (
                      <div key={i} className="card flex items-start gap-3" style={{ borderLeft: `3px solid ${c}` }}>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${c}22`, color: c }}>{r.level}</span>
                        <p className="text-sm text-[var(--text-secondary)]">{r.text}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
