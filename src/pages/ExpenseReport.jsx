/**
 * ExpenseReport (route /expense-report) - customizable maintenance & parts expense report.
 *
 * Sourced ONLY from the maintenance/parts expense grid (parts_consumption) via the
 * authoritative get_parts_expense_snapshot RPC (tyre/spare/oil split, by asset, store,
 * item and month). Mirrors BoardOverview: headline KPIs, breakdown charts and a 12-month
 * trend, each behind a persisted on/off section toggle. Nothing is fabricated - when the
 * backend has no data the page shows an honest empty state linking to Expense Import.
 * Colours use the single shared palette (reportColors) so it reads as one system.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Wallet, TrendingUp, PieChart, Download, RefreshCw, Eye, EyeOff, Boxes, Building2, Truck,
  Package, MapPin, Save, ArrowRight, Gauge, ShieldCheck, Sparkles, Clock, Layers,
  BarChart3,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import { useSettings, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency } from '../lib/formatters'
import { getPartsExpenseSnapshot, getExpenseByCountry, getCostCpkOverview, listExpenseRows } from '../lib/api/partsConsumption'
import { listTcoActualRecords } from '../lib/api/tyreRecords'
import { getExpenseYearlyTrend } from '../lib/api/expenseTrends'
import { forecastTyreDemand } from '../lib/tyreDemandForecast'
import TyreForecastSection from '../components/tyre/TyreForecastSection'
import { fetchAllPages } from '../lib/fetchAll'
import { periodWindow, buildCostCpkExport } from '../lib/costCpk'
import {
  PeriodBar, ComparisonStrip, CpkPanel, MoversPanel, EvidencePanel,
} from '../components/expense/CostCpkPanels'
import CostVariancePanel from '../components/expense/CostVariancePanel'
import { getCostVariance } from '../lib/api/costVariance'
import { getExpenseBySite, setStoreSiteMap, listSites } from '../lib/api/storeSiteExpense'
import { getFleetCpk } from '../lib/api/fleetCpk'
import {
  fmtCpkValue, fmtDistance, fmtMoney as fmtCpkMoney, fmtCoverage, unitSuffix,
  sortByTypeWorstFirst, fleetTiles,
} from '../lib/fleetCpkView'
import { stylize, ACCENTS } from '../lib/reportColors'
import PresentationStudio from '../components/present/PresentationStudio'
import StudioBoundary from '../components/present/StudioBoundary'
import { reportFileName, reportDateLabel, exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const LS_KEY = 'expenseReport.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', Wallet],
  ['compare', 'vs Last Period', ArrowRight],
  ['cpk', 'Cost per km', Gauge],
  ['why', 'Why It Changed', Sparkles],
  ['movers', 'What Moved', TrendingUp],
  ['categories', 'Categories', PieChart],
  ['sites', 'Stores', Building2],
  ['bysite', 'By Site', MapPin],
  ['assets', 'Assets', Truck],
  ['items', 'Top Items', Package],
  ['trend', 'Trend', TrendingUp],
  ['forecast', 'Tyre Forecast', Sparkles],
  ['builder', 'Chart Builder', BarChart3],
  ['fleetcpk', 'Fleet CPK', Gauge],
  ['evidence', 'Certainty', ShieldCheck],
]
const SECTION_DEFAULTS = {
  kpis: true, compare: true, cpk: true, why: true, movers: true, categories: true, sites: true,
  bysite: true, assets: true, items: true, trend: true, forecast: true, builder: true, fleetcpk: true, evidence: true,
}

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))

/**
 * Aggregate tyre records for the Chart Builder: quantity by site / size / brand /
 * month and cost-per-km by site (sum cost / sum km, per site). Scoped client-side
 * to [from,to] on issue_date when given. Pure; honest zeros/N-A downstream.
 */
export function aggregateTyres(rows = [], fromISO = '', toISO = '') {
  const inRange = (d) => {
    if (!d) return !fromISO && !toISO
    const s = String(d).slice(0, 10)
    if (fromISO && s < fromISO) return false
    if (toISO && s > toISO) return false
    return true
  }
  const site = new Map(); const size = new Map(); const brand = new Map(); const month = new Map()
  const siteCost = new Map(); const siteKm = new Map()
  const remSite = new Map(); const remMonth = new Map()
  // Per-brand: total qty, cost (+ qty priced) for an average cost, km (+ count) for an average life.
  const brandCost = new Map(); const brandCostQty = new Map()
  const brandKm = new Map(); const brandKmN = new Map()
  let total = 0; let removed = 0
  for (const r of rows) {
    const s = String(r.site || 'Unspecified')
    // Removals: counted on removal_date (a tyre taken off in the window).
    if (r.removal_date && inRange(r.removal_date)) {
      const q = Number(r.qty) > 0 ? Number(r.qty) : 1
      removed += q
      remSite.set(s, (remSite.get(s) || 0) + q)
      const rmk = String(r.removal_date).slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(rmk)) remMonth.set(rmk, (remMonth.get(rmk) || 0) + q)
    }
    if (!inRange(r.issue_date)) continue
    const qty = Number(r.qty) > 0 ? Number(r.qty) : 1
    total += qty
    const z = String(r.size || 'Unknown')
    const b = String(r.brand || 'Unknown')
    site.set(s, (site.get(s) || 0) + qty)
    size.set(z, (size.get(z) || 0) + qty)
    brand.set(b, (brand.get(b) || 0) + qty)
    const mk = String(r.issue_date || '').slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(mk)) month.set(mk, (month.get(mk) || 0) + qty)
    const unitCost = Number(r.cost_per_tyre) || 0
    const cost = unitCost * qty
    const km = Number(r.total_km) || 0
    if (km > 0 && cost > 0) {
      siteCost.set(s, (siteCost.get(s) || 0) + cost)
      siteKm.set(s, (siteKm.get(s) || 0) + km)
    }
    if (unitCost > 0) {
      brandCost.set(b, (brandCost.get(b) || 0) + cost)
      brandCostQty.set(b, (brandCostQty.get(b) || 0) + qty)
    }
    if (km > 0) {
      brandKm.set(b, (brandKm.get(b) || 0) + km)
      brandKmN.set(b, (brandKmN.get(b) || 0) + 1)
    }
  }
  const rowsOf = (m) => [...m.entries()].map(([label, value]) => ({ label, value }))
  const cpkSite = [...siteKm.entries()]
    .map(([s, km]) => ({ label: s, value: km > 0 ? (siteCost.get(s) || 0) / km : 0 }))
    .filter((r) => r.value > 0)
  const months = [...month.keys()].sort()
  const remMonths = [...remMonth.keys()].sort()
  const avgCostByBrand = [...brandCostQty.entries()]
    .map(([b, q]) => ({ label: b, value: q > 0 ? (brandCost.get(b) || 0) / q : 0 }))
    .filter((r) => r.value > 0)
  const avgKmByBrand = [...brandKmN.entries()]
    .map(([b, n2]) => ({ label: b, value: n2 > 0 ? (brandKm.get(b) || 0) / n2 : 0 }))
    .filter((r) => r.value > 0)
  return {
    total,
    removed,
    bySite: rowsOf(site),
    bySize: rowsOf(size),
    byBrand: rowsOf(brand),
    avgCostByBrand,
    avgKmByBrand,
    cpkSite,
    removalBySite: rowsOf(remSite),
    monthLabels: months.map((mk) => monthLabel(mk)),
    monthQty: months.map((mk) => month.get(mk) || 0),
    remMonthLabels: remMonths.map((mk) => monthLabel(mk)),
    remMonthQty: remMonths.map((mk) => remMonth.get(mk) || 0),
  }
}

/**
 * Currency for one country (KSA=SAR, UAE=AED, Egypt=EGP), falling back to the
 * app currency for anything unmapped. Single source: COUNTRY_CURRENCY.
 */
export function currencyForCountry(country, fallback = 'SAR') {
  return COUNTRY_CURRENCY[country] || fallback
}

/** Currency-aware money formatter; a missing or non-numeric value renders "N/A". */
export const moneyIn = (currency) => (v) => (
  v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), currency, 0)
)

/**
 * Rows + columns for the Excel export.
 *
 * Single country: the legacy Store / Top Item / Month rows with one Spend column,
 * in that country's currency (unchanged).
 * All countries: per-country rows only (country total, category split and the
 * per-site spend), with ONE COLUMN PER CURRENCY, so SAR, AED and EGP never land
 * in the same column and can never be added into one meaningless total.
 *
 * @param {{isAll:boolean, currency?:string, snap?:Object|null,
 *          byCountry?:Array<Object>, siteGroups?:Array<Object>}} args
 * @returns {{rows:Array<Object>, columns:string[], headers:string[]}}
 */
export function buildExpenseExport({ isAll, currency = 'SAR', snap = null, byCountry = [], siteGroups = [] } = {}) {
  if (!isAll) {
    const s = snap && snap.ok ? snap : null
    const rows = []
    ;(s?.by_store || []).forEach((r) => rows.push({ section: 'Store', name: r.label, spend: Number(r.spend) || 0, count: '' }))
    ;(s?.top_items || []).forEach((r) => rows.push({ section: 'Top Item', name: r.label, spend: Number(r.spend) || 0, count: Number(r.n) || '' }))
    ;(s?.monthly || []).forEach((r) => rows.push({ section: 'Month', name: monthLabel(r.m), spend: Number(r.total) || 0, count: '' }))
    return { rows, columns: ['section', 'name', 'spend', 'count'], headers: ['Section', 'Name', 'Spend', 'Count'] }
  }

  const currencies = []
  const trackCurrency = (cur) => { if (cur && !currencies.includes(cur)) currencies.push(cur); return cur }
  const rows = []
  const push = (country, cur, section, name, amount, lines) => rows.push({
    country: country || 'N/A',
    section,
    name: name == null || name === '' ? 'N/A' : name,
    [cur]: Number(amount) || 0,
    count: lines == null || lines === '' ? '' : Number(lines) || 0,
  })

  ;(byCountry || []).forEach((c) => {
    const cur = trackCurrency(currencyForCountry(c.country, currency))
    push(c.country, cur, 'Country total', c.country, c.total, c.lines)
    push(c.country, cur, 'Category', 'Tyres', c.tyre, '')
    push(c.country, cur, 'Category', 'Spare parts', c.spare, '')
    push(c.country, cur, 'Category', 'Oil', c.oil, '')
  })
  ;(siteGroups || []).forEach((g) => {
    const cur = trackCurrency(g.currency || currencyForCountry(g.country, currency))
    ;(g.rows || []).forEach((r) => push(g.country, cur, 'Site', r.site, r.total, r.lines))
  })

  return {
    rows,
    columns: ['country', 'section', 'name', ...currencies, 'count'],
    headers: ['Country', 'Section', 'Name', ...currencies, 'Count'],
  }
}

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
const H_BAR_OPTS = { ...chartBase(false), indexAxis: 'y' }
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



/** One country's (or the single active scope's) per-site expense table. */
function SiteTable({ group, canMap, onSave }) {
  const money = moneyIn(group.currency)
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
            <th className="py-2 pr-3 font-semibold">Site</th>
            <th className="py-2 px-3 font-semibold text-right">Tyre</th>
            <th className="py-2 px-3 font-semibold text-right">Spare</th>
            <th className="py-2 px-3 font-semibold text-right">Oil</th>
            <th className="py-2 px-3 font-semibold text-right">Total</th>
            <th className="py-2 pl-3 font-semibold text-right">Lines</th>
          </tr>
        </thead>
        <tbody>
          {(group.rows || []).map((r, i) => {
            const site = String(r.site || '')
            const unmapped = site.startsWith('Unmapped: ')
            const storeCode = unmapped ? site.slice('Unmapped: '.length) : null
            return (
              <tr key={`${site}-${i}`} className="border-b border-[var(--hairline)]/60">
                <td className="py-2 pr-3">
                  {unmapped ? (
                    <UnmappedCell
                      storeCode={storeCode}
                      country={group.country}
                      canMap={canMap}
                      siteOptions={group.siteOptions}
                      onSave={onSave}
                    />
                  ) : (
                    <span className="text-[var(--text-primary)] font-medium">{site}</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.tyre)}</td>
                <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.spare)}</td>
                <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.oil)}</td>
                <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)]">{money(r.total)}</td>
                <td className="py-2 pl-3 text-right text-[var(--text-muted)]">{num(r.lines)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Per-site expense. One table per scope group: a single country scope has one
 * group, the "All countries" scope has one group PER COUNTRY, each in its own
 * currency, because SAR, AED and EGP cannot be summed into one column.
 * Rows whose site starts with "Unmapped: " expose an inline site picker + Save
 * (elevated users) so an admin can map the store_code to a governed site; the
 * total then rolls up under that site on refresh.
 */
function BySitePanel({ groups, canMap, onSave, error }) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => (g?.rows || []).length > 0)
  const multi = list.length > 1
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <MapPin size={15} /> Spend by site
      </h2>
      <p className="text-xs text-[var(--text-tertiary)]">
        Store codes from the expense grid are mapped to sites. Rows marked "Unmapped" are store codes without a site mapping yet
        {canMap ? '; pick a site and Save to map them.' : '.'}
        {multi ? ' Each country is listed separately in its own currency and is never summed with another country.' : ''}
      </p>
      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {list.length === 0 ? (
        <div className="card text-center text-[var(--text-muted)] py-8">No per-site expense for the selected filters.</div>
      ) : (
        list.map((g) => (
          <div key={g.country || 'scope'} className="space-y-2">
            {multi && (
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                {g.country || 'N/A'}
                <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--surface-2,#1e293b)] text-[var(--text-tertiary)]">{g.currency}</span>
              </h3>
            )}
            <SiteTable group={g} canMap={canMap} onSave={onSave} />
          </div>
        ))
      )}
    </section>
  )
}

/** Inline "Unmapped: <store_code>" cell with a site picker + Save (elevated only). */
function UnmappedCell({ storeCode, country, canMap, siteOptions, onSave }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const listId = `sites-${country || 'all'}-${storeCode}`
  const save = async () => {
    if (!value.trim()) return
    setSaving(true)
    try { await onSave(storeCode, value.trim(), country) } finally { setSaving(false) }
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">Unmapped</span>
      <span className="text-[var(--text-secondary)]">{storeCode}</span>
      {canMap && (
        <>
          <input
            list={listId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Map to site"
            className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs px-2 py-1 text-[var(--text-secondary)] w-40"
            aria-label={`Map ${storeCode} to a site`}
          />
          <datalist id={listId}>
            {(siteOptions || []).map((s) => <option key={s} value={s} />)}
          </datalist>
          <button
            onClick={save}
            disabled={saving || !value.trim()}
            className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Save size={12} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </div>
  )
}

export default function ExpenseReport() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canMap = isSuperAdmin === true || ['Admin', 'Manager', 'Director'].includes(profile?.role)
  const [snap, setSnap] = useState(null)
  const [siteGroups, setSiteGroups] = useState([])
  const [bySiteErr, setBySiteErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [byCountry, setByCountry] = useState([])
  const isAll = !activeCountry || activeCountry === 'All'

  // Period comparison + cost per km. The period picker drives BOTH this and the
  // date inputs below, so the whole page always describes one window.
  const [period, setPeriod] = useState('last_12')
  const [overview, setOverview] = useState(null)
  const [moverDim, setMoverDim] = useState('by_asset')
  // The variance decomposition: what the change is made of, and a plain-language
  // account of it. Its own state so a backend without V378 leaves the section
  // out rather than failing the page.
  const [variance, setVariance] = useState(null)

  // Unit-aware Fleet CPK (cost per km for road assets / cost per engine-hour for
  // plant). Server aggregate get_fleet_cpk chooses the unit per asset type and keeps
  // each country in its own currency. Uses the page date range when set, else the
  // last 365 days (the rest of the page can default to all-time).
  const [fleetCpk, setFleetCpk] = useState({ perVehicle: [], byType: [], fleet: [] })
  const [fleetCpkLoading, setFleetCpkLoading] = useState(true)
  // Tyre-quantity + tyre-CPK-by-site aggregation and multi-year expenses, for the
  // Chart Builder. Best-effort: null when unavailable so nothing else breaks.
  const [tyreAgg, setTyreAgg] = useState(null)
  const [yearly, setYearly] = useState(null)
  // Tyre demand forecast by size (from the full country history, not the window).
  const [tyreForecast, setTyreForecast] = useState(null)

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

  const money = useMemo(() => moneyIn(activeCurrency), [activeCurrency])

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
      const [res, ov] = await Promise.all([
        getPartsExpenseSnapshot({ country: scopedCountry, from: from || undefined, to: to || undefined }),
        // Comparison + cost per km. Its own try/catch so a backend that predates
        // V374 leaves those sections empty instead of failing the whole page.
        getCostCpkOverview({ country: scopedCountry, from: from || undefined, to: to || undefined })
          .catch(() => ({ ok: false })),
      ])
      getCostVariance({
        country: scopedCountry, from: from || undefined, to: to || undefined, limit: 25,
      }).then((v) => setVariance(v && v.ok ? v : null)).catch(() => setVariance(null))
      setSnap(res && res.ok ? res : { ok: false })
      setOverview(ov && ov.ok ? ov : null)
      // On the "All countries" view, also load each country's total in its OWN
      // currency (SAR / AED / EGP) so they are shown side by side, never blended.
      let countries = []
      if (isAll) {
        const rows = await getExpenseByCountry({ from: from || undefined, to: to || undefined }).catch(() => [])
        setByCountry(rows)
        countries = rows.map((r) => r.country).filter(Boolean)
      } else {
        setByCountry([])
      }
      // Per-site expense (store_code -> site map). Never throws -> [].
      // On the All view this is loaded ONCE PER COUNTRY so each table carries its
      // own currency; a single un-scoped call would sum SAR + AED + EGP per site.
      setBySiteErr('')
      const scopes = isAll
        ? countries.map((c) => ({ country: c, currency: currencyForCountry(c, activeCurrency) }))
        : [{ country: activeCountry, currency: activeCurrency }]
      const groups = await Promise.all(scopes.map(async (s) => {
        const scoped = s.country && s.country !== 'All' ? s.country : undefined
        const [rows, opts] = await Promise.all([
          getExpenseBySite({ country: scoped, from: from || undefined, to: to || undefined }),
          listSites({ country: scoped }).catch(() => []),
        ])
        return { ...s, rows, siteOptions: opts }
      }))
      setSiteGroups(groups)

      // Tyre quantity + tyre CPK aggregation (single country only; the studio is
      // hidden on the All view). Best-effort, capped, never blocks the page.
      if (!isAll) {
        fetchAllPages(
          (f, t) => listTcoActualRecords({ country: activeCountry, from: f, to: t }),
          { max: 50000 },
        ).then((r) => {
          const rows = r?.data || []
          setTyreAgg(aggregateTyres(rows, from || '', to || ''))
          // Forecast is built from the FULL history (12-month window), independent
          // of the page date range, so the projection has enough signal.
          setTyreForecast(forecastTyreDemand(rows, { window: 12, ahead: 3 }))
        }).catch(() => { setTyreAgg(null); setTyreForecast(null) })
        getExpenseYearlyTrend({ country: activeCountry })
          .then((rows) => setYearly(Array.isArray(rows) ? rows : null))
          .catch(() => setYearly(null))
      } else {
        setTyreAgg(null); setYearly(null); setTyreForecast(null)
      }
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the expense report.'))
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [activeCountry, activeCurrency, from, to])

  useEffect(() => { load() }, [load])

  // Fleet CPK load. Uses the page date range when set, else the last 365 days, so
  // the tiles always have a sensible window even when the rest of the page is all-time.
  const cpkFrom = from || (() => {
    const d = new Date(); d.setDate(d.getDate() - 365)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()
  const cpkTo = to || (() => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()

  useEffect(() => {
    let cancelled = false
    setFleetCpkLoading(true)
    const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
    getFleetCpk({ country: scopedCountry, from: cpkFrom, to: cpkTo })
      .then((res) => { if (!cancelled) setFleetCpk(res || { perVehicle: [], byType: [], fleet: [] }) })
      .catch(() => { if (!cancelled) setFleetCpk({ perVehicle: [], byType: [], fleet: [] }) })
      .finally(() => { if (!cancelled) setFleetCpkLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry, cpkFrom, cpkTo])

  const cpkFleetTiles = useMemo(() => fleetTiles(fleetCpk.fleet), [fleetCpk])
  const cpkByType = useMemo(() => sortByTypeWorstFirst(fleetCpk.byType), [fleetCpk])
  const cpkHasData = cpkFleetTiles.length > 0 || cpkByType.length > 0

  /** One period control drives the whole page, so every panel describes one window. */
  const applyPeriod = useCallback((key) => {
    setPeriod(key)
    const w = periodWindow(key, new Date())
    setFrom(w.from)
    setTo(w.to)
  }, [])

  const k = snap?.ok ? snap.kpis : null

  // ── Chart data (built from the snapshot, styled with the shared palette) ─────
  const categoryChart = useMemo(() => {
    const rows = snap?.ok ? (snap.by_category || []) : []
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const storeChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.by_store || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const assetChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.by_asset || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const itemChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.top_items || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const trendChart = useMemo(() => {
    const rows = snap?.ok ? (snap.monthly || []) : []
    return {
      labels: rows.map((r) => monthLabel(r.m)),
      datasets: [
        { label: 'Tyres', data: rows.map((r) => Number(r.tyre) || 0) },
        { label: 'Spare Parts', data: rows.map((r) => Number(r.spare) || 0) },
        { label: 'Oil', data: rows.map((r) => Number(r.oil) || 0) },
      ],
    }
  }, [snap])

  // ── Chart Builder catalog (the shared Presentation Studio renders it) ────────
  const studioCatalog = useMemo(() => {
    if (!snap?.ok) return []
    const flat = (key, label) => ({
      key, label, kind: 'flat', valueKind: 'money',
      rows: (snap[key] || []).map((r) => ({ label: r.label, value: Number(r.spend) || 0 })),
    })
    const out = [
      flat('by_asset', 'Asset'),
      flat('by_store', 'Site / store'),
      flat('by_category', 'Category'),
      flat('top_items', 'Item'),
    ]
    const m = snap.monthly || []
    if (m.length) {
      out.push({
        key: 'monthly', label: 'Month', kind: 'series', valueKind: 'money', allowTotal: true,
        labels: m.map((r) => monthLabel(r.m)),
        series: [
          { name: 'Tyres', data: m.map((r) => Number(r.tyre) || 0) },
          { name: 'Spare Parts', data: m.map((r) => Number(r.spare) || 0) },
          { name: 'Oil', data: m.map((r) => Number(r.oil) || 0) },
        ],
      })
    }
    // Cost mix as a percentage (tyres / spare / oil share of total spend).
    const kp = snap.kpis || {}
    const mixTotal = (Number(kp.tyre_expense) || 0) + (Number(kp.spare_expense) || 0) + (Number(kp.oil_expense) || 0)
    if (mixTotal > 0) {
      const pct = (v) => Math.round(((Number(v) || 0) / mixTotal) * 1000) / 10
      out.push({
        key: 'cost_mix_pct', label: 'Cost mix (%)', kind: 'flat', valueKind: 'percent',
        rows: [
          { label: 'Tyres', value: pct(kp.tyre_expense) },
          { label: 'Spare Parts', value: pct(kp.spare_expense) },
          { label: 'Oil', value: pct(kp.oil_expense) },
        ],
      })
    }
    // Fleet CPK (cost per km / per engine-hour) by vehicle type - split by unit so
    // a km-rate and an hour-rate never share one axis. Rates keep their decimals.
    const byType = Array.isArray(fleetCpk?.byType) ? fleetCpk.byType : []
    const kmRows = byType.filter((r) => r.unit === 'km' && r.cpk_total != null)
      .map((r) => ({ label: r.vehicle_type || 'N/A', value: Number(r.cpk_total) || 0 }))
    const hrRows = byType.filter((r) => r.unit === 'engine_hours' && r.cpk_total != null)
      .map((r) => ({ label: r.vehicle_type || 'N/A', value: Number(r.cpk_total) || 0 }))
    if (kmRows.length) out.push({ key: 'cpk_km', label: 'CPK per km by type', kind: 'flat', valueKind: 'rate', unitLabel: `${activeCurrency}/km`, format: (v) => `${activeCurrency} ${Number(v).toFixed(3)}/km`, rows: kmRows })
    if (hrRows.length) out.push({ key: 'cpk_hr', label: 'Cost per hour by type', kind: 'flat', valueKind: 'rate', unitLabel: `${activeCurrency}/hr`, format: (v) => `${activeCurrency} ${Number(v).toFixed(3)}/hr`, rows: hrRows })

    // Overall fleet CPK (one bar per unit) from the fleet-level tiles.
    const tiles = fleetTiles(fleetCpk?.fleet)
    const cpkOverall = tiles
      .filter((t) => t.cpkTotal != null)
      .map((t) => ({ label: t.unit === 'engine_hours' ? 'Cost per engine-hour' : 'Cost per km', value: Number(t.cpkTotal) || 0 }))
    if (cpkOverall.length) out.push({ key: 'cpk_overall', label: 'Overall CPK', kind: 'flat', valueKind: 'rate', unitLabel: activeCurrency, format: (v) => `${activeCurrency} ${Number(v).toFixed(3)}`, rows: cpkOverall })

    // Tyre quantity + tyre CPK by site (from the loaded tyre records).
    if (tyreAgg) {
      if (tyreAgg.bySite.length) out.push({ key: 'tyre_qty_site', label: 'Tyres used by site', kind: 'flat', valueKind: 'count', rows: tyreAgg.bySite })
      if (tyreAgg.bySize.length) out.push({ key: 'tyre_qty_size', label: 'Tyres used by size', kind: 'flat', valueKind: 'count', rows: tyreAgg.bySize })
      if (tyreAgg.byBrand.length) out.push({ key: 'tyre_qty_brand', label: 'Tyres used by brand', kind: 'flat', valueKind: 'count', rows: tyreAgg.byBrand })
      if (tyreAgg.avgCostByBrand.length) out.push({ key: 'tyre_avgcost_brand', label: 'Average cost per tyre by brand', kind: 'flat', valueKind: 'money', rows: tyreAgg.avgCostByBrand })
      if (tyreAgg.avgKmByBrand.length) out.push({ key: 'tyre_avgkm_brand', label: 'Average km per tyre by brand', kind: 'flat', valueKind: 'count', unitLabel: 'km', format: (v) => `${Math.round(v).toLocaleString('en-US')} km`, rows: tyreAgg.avgKmByBrand })
      if (tyreAgg.cpkSite.length) out.push({ key: 'tyre_cpk_site', label: 'Tyre cost per km by site', kind: 'flat', valueKind: 'rate', unitLabel: `${activeCurrency}/km`, format: (v) => `${activeCurrency} ${Number(v).toFixed(3)}/km`, rows: tyreAgg.cpkSite })
      if (tyreAgg.monthLabels.length) out.push({ key: 'tyre_qty_month', label: 'Tyres used by month', kind: 'series', valueKind: 'count', labels: tyreAgg.monthLabels, series: [{ name: 'Tyres', data: tyreAgg.monthQty }] })
      if (tyreAgg.removalBySite.length) out.push({ key: 'tyre_rem_site', label: 'Tyre removals by site', kind: 'flat', valueKind: 'count', rows: tyreAgg.removalBySite })
      if (tyreAgg.remMonthLabels.length) out.push({ key: 'tyre_rem_month', label: 'Tyre removals by month', kind: 'series', valueKind: 'count', labels: tyreAgg.remMonthLabels, series: [{ name: 'Removals', data: tyreAgg.remMonthQty }] })
    }

    // Tyre demand FORECAST by size (next 3 months) from the fitment history.
    if (tyreForecast && tyreForecast.sizes.length) {
      const fcSizes = tyreForecast.sizes.filter((s) => s.forecastTotal > 0 || s.total > 0)
      if (fcSizes.length) {
        out.push({
          key: 'tyre_forecast_size', label: 'Tyre forecast by size (next 3 months)', kind: 'flat', valueKind: 'count',
          unitLabel: 'tyres', rows: fcSizes.map((s) => ({ label: s.size, value: s.forecastTotal })),
        })
        // History + forecast on one monthly axis (actual, then the projected months).
        const labels = [...tyreForecast.monthLabels, ...tyreForecast.forecastLabels]
        const hist = tyreForecast.totals.history
        const fc = tyreForecast.totals.forecast
        out.push({
          key: 'tyre_forecast_month', label: 'Tyre demand: actual + forecast', kind: 'series', valueKind: 'count',
          // No trend line here, for two reasons. The forecast months are ALREADY
          // a fitted projection, so a trend across them regresses on a
          // regression while looking like independent evidence. And each series
          // is zero-padded over the months it does not cover, so picking one
          // series alone would fit a line through those zeros as if they were
          // real readings of nothing.
          ordered: false,
          labels,
          series: [
            { name: 'Actual', data: [...hist, ...fc.map(() => 0)] },
            { name: 'Forecast', data: [...hist.map(() => 0), ...fc] },
          ],
        })
      }
    }

    // Yearly expenses (compare years) from the per-year trend.
    const yr = Array.isArray(yearly) ? [...yearly].sort((a, b) => String(a.year ?? a.period).localeCompare(String(b.year ?? b.period))) : []
    if (yr.length) {
      out.push({
        key: 'yearly', label: 'Year', kind: 'series', valueKind: 'money', allowTotal: true,
        labels: yr.map((r) => String(r.year ?? r.period)),
        series: [
          { name: 'Tyres', data: yr.map((r) => Number(r.tyre) || 0) },
          { name: 'Spare Parts', data: yr.map((r) => Number(r.spare) || 0) },
          { name: 'Oil', data: yr.map((r) => Number(r.lubricant ?? r.oil) || 0) },
        ],
      })
    }
    return out.filter((s) => (s.kind === 'series' ? (s.labels || []).length : (s.rows || []).length))
  }, [snap, fleetCpk, activeCurrency, tyreAgg, yearly, tyreForecast])

  // Any expense to show/export at all: a country-scoped snapshot with a value, or
  // (All view) at least one country total. Drives the empty state + export buttons.
  const hasAny = !!(k && (Number(k.total_expense) || Number(k.lines))) || (isAll && byCountry.length > 0)

  // Build the Expense Report PDF doc (mirrors BoardOverview.buildBoardDoc).
  async function buildExpenseDoc() {
    if (!snap?.ok && !(isAll && byCountry.length)) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 12
    const company = appSettings?.company_name || 'TyrePulse'
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    doc.setFontSize(16); doc.setTextColor(15, 23, 42)
    doc.text(`${company} - Expense Report`, M, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

    let y = 30
    if (isAll) {
      // Never print one blended total: KSA (SAR), UAE (AED) and Egypt (EGP) are
      // listed separately, each in its own currency.
      doc.setFontSize(8); doc.setTextColor(100, 116, 139)
      doc.text('Each country is shown in its own currency. Different currencies are not summed.', M, y)
      y += 7
      if (byCountry.length === 0) {
        doc.setFontSize(9); doc.setTextColor(15, 23, 42)
        doc.text('Per-country totals are not available for the selected filters.', M, y)
        y += 8
      }
      byCountry.forEach((c) => {
        const fmt = moneyIn(currencyForCountry(c.country, activeCurrency))
        doc.setTextColor(15, 23, 42); doc.setFontSize(11)
        doc.text(`${c.country || 'N/A'}: ${fmt(c.total)}`, M, y)
        doc.setTextColor(100, 116, 139); doc.setFontSize(7.5)
        doc.text(`Tyres ${fmt(c.tyre)}  |  Spare ${fmt(c.spare)}  |  Oil ${fmt(c.oil)}  |  ${num(c.lines)} lines`, M, y + 5)
        y += 13
      })
      y += 3
    } else if (k) {
      const tiles = [
        ['Total expense', money(k.total_expense)], ['Tyres', money(k.tyre_expense)],
        ['Spare parts', money(k.spare_expense)], ['Oil', money(k.oil_expense)],
        ['Lines', num(k.lines)], ['Tyres issued', num(k.tyres_issued)],
      ]
      tiles.forEach((tl, i) => {
        const col = i % 6
        const x = M + col * ((W - 2 * M) / 6)
        doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(tl[1]), x, y + 6)
        doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(tl[0]), x, y + 11)
      })
      y += 20
    }

    const order = ['category', 'store', 'asset', 'item', 'trend']
    let placed = 0
    for (const key of order) {
      const el = chartRefs.current[key]
      const canvas = el?.querySelector?.('canvas')
      if (!canvas) continue
      const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
      if (!img) continue
      const cw = (W - 2 * M - 8) / 2
      const ch = 55
      const col = placed % 2
      const rowY = y + Math.floor(placed / 2) * (ch + 6)
      if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
      const x = M + col * (cw + 8)
      const yy = y + Math.floor(placed / 2) * (ch + 6)
      doc.addImage(img, 'PNG', x, yy, cw, ch)
      placed += 1
    }
    return { doc, company }
  }

  async function exportPdf() {
    if (!hasAny) return
    setExporting(true)
    try {
      const built = await buildExpenseDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Expense Report', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  async function exportExcel() {
    if (!hasAny) return
    setExporting(true)
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      // On the All view the export carries a Country column and one amount column
      // per currency, so SAR / AED / EGP are never added into a single total.
      const base = buildExpenseExport({
        isAll, currency: activeCurrency, snap, byCountry, siteGroups,
      })
      // On a single country the export also carries the comparison, the cost per
      // km with its coverage, and the movements - the same figures on screen, so
      // the file can be read without the app. buildCostCpkExport names its money
      // columns after the currency, so a blended scope cannot imply one.
      const extra = !isAll && overview ? buildCostCpkExport(overview) : null
      const { rows, columns, headers } = extra
        ? {
          rows: [...extra.rows, ...base.rows.map((r) => ({ ...r, section: r.section }))],
          columns: [...new Set([...extra.columns, ...base.columns])],
          headers: [...extra.headers, ...base.headers.filter((h) => !extra.headers.includes(h))],
        }
        : base
      await exportToExcel(
        rows,
        columns,
        headers,
        reportFileName(company, 'Expense Report', reportDateLabel()),
        'Expenses',
        {
          currency: activeCurrency,
          company,
          title: `${company} Expense Report`,
          // Single-country export is unchanged; the All view states its scope.
          ...(isAll ? { meta: { Scope: 'All countries - each country in its own currency, not summed' } } : {}),
        },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  // Download the REAL expense rows (not aggregates) for the current country +
  // period as Excel - every line exactly as stored, category derived by the
  // same rule the totals use. Bounded at 100k rows with an honest note.
  async function exportRowsExcel() {
    setExporting(true)
    setError('')
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
      const { rows: raw, truncated } = await listExpenseRows({
        country: scopedCountry, from: from || undefined, to: to || undefined,
      })
      if (!raw.length) { setError('No expense rows in this period.'); return }
      const data = raw.map((r) => ({
        event_date: r.event_date || '',
        work_order_no: r.work_order_no || '',
        item_code: r.item_code || '',
        item_description: r.item_description || '',
        qty: r.qty,
        unit_cost: r.unit_cost,
        line_cost: r.line_cost,
        category: Number(r.tyre_cost) > 0 ? 'Tyre' : Number(r.oil_cost) > 0 ? 'Oil' : 'Spare',
        site: r.site || '',
        store_code: r.store_code || '',
        currency: r.currency || '',
        country: r.country || '',
      }))
      await exportToExcel(
        data,
        ['event_date', 'work_order_no', 'item_code', 'item_description', 'qty', 'unit_cost', 'line_cost', 'category', 'site', 'store_code', 'currency', 'country'],
        ['Date', 'Job card', 'Item code', 'Description', 'Qty', 'Unit cost', 'Value', 'Category', 'Site', 'Store', 'Currency', 'Country'],
        reportFileName(company, 'Expense Rows', reportDateLabel()),
        'Expense rows',
        {
          company,
          title: `${company} Expense Rows`,
          meta: {
            Scope: scopedCountry || 'All countries - each row carries its own currency',
            Rows: String(data.length) + (truncated ? ' (capped at 100,000 - narrow the date range for the rest)' : ''),
          },
        },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  // Save one store_code -> site mapping then refresh the by-site panel. The
  // country comes from the row's own group so an All-view mapping is still
  // stored against the right country (store_site_map is keyed per country).
  const saveMapping = useCallback(async (storeCode, site, country) => {
    if (!site) return
    setBySiteErr('')
    try {
      const scope = country || activeCountry
      await setStoreSiteMap({
        country: scope && scope !== 'All' ? scope : undefined,
        store_code: storeCode,
        site,
      })
      await load()
    } catch (e) {
      setBySiteErr(toUserMessage(e, 'Could not save the site mapping.'))
    }
  }, [activeCountry, load])

  return (
    <div className="space-y-5">
      <PageHeader title="Expense Report" subtitle="Maintenance and parts expense: tyres, spare parts and oil" icon={Wallet} />

      {/* One period control for the whole page. Every panel below describes the
          same window, so nothing on screen is comparing different spans. */}
      <PeriodBar value={period} onChange={applyPeriod} windows={overview?.windows} />

      {/* Section toggles + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* On the All view only the per-site section renders (see the note
              below), so the chart/KPI toggles would be dead controls. */}
          {SECTIONS.filter(([key]) => !isAll || key === 'bysite' || key === 'fleetcpk').map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}
            >
              <Icon size={13} /> {label} {sections[key] ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateField
            className="text-xs w-40"
            value={from}
            onChange={(v) => { setFrom(v); setPeriod('') }}
            placeholder="From date"
            ariaLabel="From date"
          />
          <DateField
            className="text-xs w-40"
            value={to}
            onChange={(v) => { setTo(v); setPeriod('') }}
            placeholder="To date"
            ariaLabel="To date"
          />
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
          <button onClick={exportExcel} disabled={exporting || !hasAny} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Boxes size={14} /> Export Excel
          </button>
          <button onClick={exportRowsExcel} disabled={exporting || !hasAny} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50" title="Every stored expense line for this country and period">
            <Download size={14} /> Download rows (Excel)
          </button>
        </div>
      </div>

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the expense report...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">
          <p>No expense data yet. Import your grid file from <Link to="/expense-import" className="text-[var(--accent)] font-semibold hover:underline">Expense Import</Link>.</p>
        </div>
      ) : (
        <>
          {/* KPIs - hidden on the All-countries view (the per-country panel below
              shows each currency separately instead of a blended total). */}
          {sections.kpis && k && !isAll && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Total expense" value={money(k.total_expense)} accent={ACCENTS.primary} />
                <Kpi label="Tyres" value={money(k.tyre_expense)} accent={ACCENTS.info} />
                <Kpi label="Spare parts" value={money(k.spare_expense)} accent={ACCENTS.watch} />
                <Kpi label="Oil" value={money(k.oil_expense)} accent={ACCENTS.good} />
                <Kpi label="Lines" value={num(k.lines)} accent={ACCENTS.neutral} />
                <Kpi label="Tyres issued" value={num(k.tyres_issued)} accent={ACCENTS.risk} sub={`${num(k.reassigned_tyres)} reassigned`} />
              </div>
            </section>
          )}

          {/* Per-country totals in each own currency (All-countries view only, so
              SAR / AED / EGP are never blended into one meaningless sum). */}
          {isAll && byCountry.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
                <Wallet size={15} /> By country (own currency)
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Each country is shown in its own currency and is not summed together (SAR, AED and EGP are different currencies).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {byCountry.map((c) => {
                  const cur = currencyForCountry(c.country, activeCurrency)
                  const fmt = (v) => formatCurrency(Number(v) || 0, cur, 0)
                  return (
                    <div key={c.country} className="card p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{c.country}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-2,#1e293b)] text-[var(--text-secondary)]">{cur}</span>
                      </div>
                      <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{fmt(c.total)}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--text-secondary)]">
                        <div><span className="block text-[var(--text-tertiary)]">Tyres</span>{fmt(c.tyre)}</div>
                        <div><span className="block text-[var(--text-tertiary)]">Spare</span>{fmt(c.spare)}</div>
                        <div><span className="block text-[var(--text-tertiary)]">Oil</span>{fmt(c.oil)}</div>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-tertiary)]">{num(c.lines)} lines</p>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Why the charts are not drawn on the All-countries view. Every chart
              below sums line_cost across countries, which would put SAR, AED and
              EGP on one axis - so they are shown per country instead. */}
          {isAll && (
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Charts, Chart Builder and Tyre Forecast show per country</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                KSA (SAR), UAE (AED) and Egypt (EGP) use different currencies, so spend cannot be summed into one
                chart or one total. <span className="text-[var(--text-secondary)] font-medium">Pick a single country in the country selector at the top</span> to
                see spend by category, store, asset, item and month, the <span className="text-[var(--text-secondary)] font-medium">Chart Builder</span>, and the
                <span className="text-[var(--text-secondary)] font-medium"> Tyre demand forecast by size</span>. The per-country totals above and the spend by
                site below are each shown in their own currency.
              </p>
            </div>
          )}

          {/* This period against last, and against the same period a year ago */}
          {sections.compare && overview && (
            <ComparisonStrip snap={overview} money={money} />
          )}

          {/* Cost per kilometre, with the coverage that makes it readable */}
          {sections.cpk && overview && !isAll && (
            <CpkPanel snap={overview} money={money} />
          )}

          {/* Why the total changed: price against volume, what started, what stopped */}
          {sections.why && variance && !isAll && (
            <CostVariancePanel variance={variance} snapshot={overview} loading={refreshing} />
          )}

          {/* What moved, which is the answer to why the total changed */}
          {sections.movers && overview && !isAll && (
            <MoversPanel snap={overview} money={money} dim={moverDim} onDim={setMoverDim} />
          )}

          {/* Categories */}
          {sections.categories && !isAll && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Spend by category</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Tyres vs Spare Parts vs Oil" refCb={setRef('category')}><Doughnut data={stylize(categoryChart, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
              </div>
            </section>
          )}

          {/* Stores + Assets */}
          {(sections.sites || sections.assets) && !isAll && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Building2 size={15} /> Spend by store and asset</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sections.sites && <ChartCard title="Top stores by spend" refCb={setRef('store')}><Bar data={stylize(storeChart, 'bar')} options={chartBase(false)} /></ChartCard>}
                {sections.assets && <ChartCard title="Top assets by spend" refCb={setRef('asset')}><Bar data={stylize(assetChart, 'bar')} options={chartBase(false)} /></ChartCard>}
              </div>
            </section>
          )}

          {/* By site (store_code -> site map). One table per country on the All view. */}
          {sections.bysite && (
            <BySitePanel
              groups={siteGroups}
              canMap={canMap}
              onSave={saveMapping}
              error={bySiteErr}
            />
          )}

          {/* Top Items */}
          {sections.items && !isAll && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Package size={15} /> Top items</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Top items by spend" refCb={setRef('item')}><Bar data={stylize(itemChart, 'bar')} options={H_BAR_OPTS} /></ChartCard>
              </div>
            </section>
          )}

          {/* Trend */}
          {sections.trend && !isAll && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Monthly expense trend</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Tyres, spare parts and oil by month" refCb={setRef('trend')}><Line data={stylize(trendChart, 'line')} options={chartBase(true)} /></ChartCard>
              </div>
            </section>
          )}

          {/* Tyre demand forecast by size - exact projected tyre counts. */}
          {sections.forecast && !isAll && tyreForecast && (
            <TyreForecastSection forecast={tyreForecast} country={activeCountry} currency={activeCurrency} money={money} filePrefix="Expense" />
          )}

          {/* Chart Builder - the shared Presentation Studio over this snapshot.
              Single-country only (the snapshot dimensions are per country). */}
          {sections.builder && !isAll && studioCatalog.length > 0 && (
            <StudioBoundary>
              <PresentationStudio
                catalog={studioCatalog}
                currency={activeCurrency}
                money={money}
                scope={activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'}
                company={appSettings?.company_name || 'TyrePulse'}
                filePrefix="Expense"
                showInsights
                note={`Present your own data - spend, cost mix % and CPK - then copy, download a PNG, or export a PowerPoint deck with talking points. Values in ${activeCurrency}.`}
              />
            </StudioBoundary>
          )}

          {/* Fleet CPK (cost per km for road assets, cost per hour for plant).
              Currency-safe per country, so it renders on the All view too. */}
          {sections.fleetcpk && (
            <section className="space-y-3">
              <div className="flex items-start gap-2">
                <Gauge size={15} className="text-[var(--accent)] mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">Fleet CPK (cost per km / hour)</h2>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Km for road assets, engine-hours for plant (generators, pumps, loaders). Currency stays per country.
                    {' '}Window: {cpkFrom} to {cpkTo}{!from && !to ? ' (last 365 days)' : ''}
                  </p>
                </div>
              </div>

              {fleetCpkLoading ? (
                <div className="card flex items-center justify-center py-8 text-[var(--text-muted)] text-sm gap-3">
                  <div className="w-4 h-4 rounded-full border-2 border-[var(--input-border)] border-t-[var(--accent)] animate-spin" />
                  Computing unit-aware CPK...
                </div>
              ) : !cpkHasData ? (
                <div className="card flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <Gauge size={26} className="text-[var(--text-muted)]" />
                  <p className="text-[var(--text-secondary)] text-sm font-medium">No CPK data for the selected filters</p>
                  <p className="text-[var(--text-tertiary)] text-xs max-w-md">
                    CPK needs measured distance (odometer) or engine-hours plus expense data in this window.
                  </p>
                </div>
              ) : (
                <>
                  {/* Fleet summary tiles per country (km side + hour side) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cpkFleetTiles.map((t, i) => {
                      const isHours = t.unit === 'engine_hours'
                      return (
                        <div key={`${t.country}-${t.unit}-${i}`} className="card border border-[var(--input-border)] flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isHours ? <Clock size={14} className="text-amber-400 shrink-0" /> : <Gauge size={14} className="text-[var(--accent)] shrink-0" />}
                              <span className="text-xs text-[var(--text-secondary)] font-medium truncate">
                                {t.country || 'Fleet'} - {isHours ? 'per hour' : 'per km'}
                              </span>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] uppercase">{t.currency}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Total CPK</p>
                              <p className="text-base font-bold text-[var(--text-primary)] leading-tight">
                                {fmtCpkValue(t.cpkTotal, t.currency, t.unit)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Tyre CPK</p>
                              <p className="text-base font-bold text-[var(--text-secondary)] leading-tight">
                                {fmtCpkValue(t.cpkTyre, t.currency, t.unit)}
                              </p>
                            </div>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {fmtDistance(t.distance, t.unit)} measured | Coverage {fmtCoverage(t.coveragePct)}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {/* Unregistered-spend note per country */}
                  {(fleetCpk.fleet || []).some((f) => Number(f?.unregistered_cost) > 0) && (
                    <div className="text-xs text-[var(--text-muted)] space-y-1">
                      {(fleetCpk.fleet || []).filter((f) => Number(f?.unregistered_cost) > 0).map((f, i) => (
                        <p key={i}>
                          {f.country}: {fmtCpkMoney(f.unregistered_cost, f.currency || f.country)} of spend sits on assets not in the fleet register, so it is excluded from per-asset CPK.
                        </p>
                      ))}
                    </div>
                  )}

                  {/* By asset type (worst CPK first) */}
                  <div className="card overflow-x-auto">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers size={15} className="text-[var(--text-muted)]" />
                      <h3 className="text-sm font-medium text-[var(--text-secondary)]">CPK by asset type</h3>
                      <span className="text-xs text-[var(--text-muted)] ml-auto">{cpkByType.length} types | worst CPK first</span>
                    </div>
                    {cpkByType.length === 0 ? (
                      <p className="text-[var(--text-muted)] text-sm py-6 text-center">No asset-type data</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left border-b border-[var(--input-border)]">
                            <th className="table-header pb-2 pr-3">Asset Type</th>
                            <th className="table-header pb-2 pr-3">Unit</th>
                            <th className="table-header pb-2 pr-3 text-right">Distance / Hours</th>
                            <th className="table-header pb-2 pr-3 text-right">Tyre Cost</th>
                            <th className="table-header pb-2 pr-3 text-right">Total Cost</th>
                            <th className="table-header pb-2 pr-3 text-right">CPK Tyre</th>
                            <th className="table-header pb-2 text-right">CPK Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpkByType.map((r, i) => {
                            const cur = r.currency || r.country || ''
                            return (
                              <tr key={`${r.country}-${r.vehicle_type}-${r.unit}-${i}`} className="border-b border-[var(--input-border)]/50">
                                <td className="table-cell py-2 pr-3 text-[var(--text-secondary)] font-medium">
                                  {r.vehicle_type}
                                  {r.country ? <span className="text-[var(--text-muted)]"> - {r.country}</span> : null}
                                </td>
                                <td className="table-cell py-2 pr-3 text-[var(--text-muted)]">{unitSuffix(r.unit).replace('/', '')}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtDistance(r.distance_or_hours, r.unit)}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtCpkMoney(r.tyre_cost, cur)}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtCpkMoney(r.total_cost, cur)}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtCpkValue(r.cpk_tyre, cur, r.unit)}</td>
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
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* How much of the split is a decision rather than a guess */}
          {sections.evidence && overview && !isAll && (
            <EvidencePanel snap={overview} money={money} />
          )}
        </>
      )}
    </div>
  )
}
