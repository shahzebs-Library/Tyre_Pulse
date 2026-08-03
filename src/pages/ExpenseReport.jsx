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
  BarChart3, Search, Image as ImageIcon, Copy, Plus, Presentation, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import { useSettings, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency } from '../lib/formatters'
import { getPartsExpenseSnapshot, getExpenseByCountry, getCostCpkOverview } from '../lib/api/partsConsumption'
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
import { stylize, ACCENTS, PRESETS, PRESET_KEYS, PRESET_LABELS } from '../lib/reportColors'
import { makeValueLabelsPlugin } from '../lib/accidentReport'
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
  ['builder', 'Chart Builder', BarChart3],
  ['fleetcpk', 'Fleet CPK', Gauge],
  ['evidence', 'Certainty', ShieldCheck],
]
const SECTION_DEFAULTS = {
  kpis: true, compare: true, cpk: true, why: true, movers: true, categories: true, sites: true,
  bysite: true, assets: true, items: true, trend: true, builder: true, fleetcpk: true, evidence: true,
}

/* ── Chart Builder config: dimensions the snapshot already carries ─────────── */
const BUILDER_DIMS = [
  { key: 'by_asset', label: 'Asset', flat: true },
  { key: 'by_store', label: 'Site / store', flat: true },
  { key: 'by_category', label: 'Category', flat: true },
  { key: 'top_items', label: 'Item', flat: true },
  { key: 'monthly', label: 'Month', flat: false },
]
const BUILDER_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'hbar', label: 'Horizontal bar' },
  { key: 'line', label: 'Line' },
  { key: 'doughnut', label: 'Doughnut' },
]
const BUILDER_MEASURES = [
  { key: 'total', label: 'Total spend' },
  { key: 'tyre', label: 'Tyres' },
  { key: 'spare', label: 'Spare parts' },
  { key: 'oil', label: 'Oil' },
  { key: 'split', label: 'Split (tyre / spare / oil)' },
]
const BUILDER_TOPN = [10, 15, 20, 30, 50]
const BUILDER_SORTS = [
  { key: 'desc', label: 'High to low' },
  { key: 'asc', label: 'Low to high' },
  { key: 'none', label: 'As loaded' },
]
/** Inline value-label plugin (per-instance so it never touches the other charts). */
const BUILDER_LABEL_PLUGIN = makeValueLabelsPlugin('#94a3b8')
/** Theme-aware label colour so numbers read on both light and dark app themes. */
function themeInk() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()
    return v || '#e5e7eb'
  } catch { return '#e5e7eb' }
}
/** n colours cycled from a named preset (independent of the global palette). */
function paletteColors(n, presetKey) {
  const p = PRESETS[presetKey] || PRESETS.vivid
  return Array.from({ length: Math.max(0, n | 0) }, (_, i) => p[i % p.length])
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

/** Labelled control wrapper for the Chart Builder toolbar. */
function BuilderField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  )
}

/** Themed select for the Chart Builder toolbar. */
function BuilderSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)]"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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

  // ── Chart Builder: pick your own dimension / measure / type / top-N ──────────
  const [bld, setBld] = useState({
    dim: 'by_asset', type: 'bar', topN: 15, measure: 'total', labels: true, legend: false,
    search: '', sort: 'desc', pct: false, palette: 'vivid', title: '',
  })
  const setBldField = (patch) => setBld((s) => ({ ...s, ...patch }))
  const builderRef = useRef(null)
  const [deck, setDeck] = useState([])      // collected slides: { title, subtitle, img, rows }
  const [deckBusy, setDeckBusy] = useState(false)
  const [deckMsg, setDeckMsg] = useState('')

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

  // ── Chart Builder data (built live from the same snapshot) ───────────────────
  const isMonthlyDim = bld.dim === 'monthly'
  const isSplit = isMonthlyDim && bld.measure === 'split'
  const dimLabel = (BUILDER_DIMS.find((d) => d.key === bld.dim) || {}).label || 'chart'
  const measureLabel = (BUILDER_MEASURES.find((m) => m.key === bld.measure) || {}).label || 'Spend'
  const autoTitle = isMonthlyDim
    ? `Monthly ${isSplit ? 'spend split' : measureLabel.toLowerCase()}`
    : `Spend by ${dimLabel.toLowerCase()}${bld.pct ? ' (share %)' : ''}`
  const builderTitle = bld.title.trim() || autoTitle

  const builderChart = useMemo(() => {
    if (!snap?.ok) return { labels: [], datasets: [] }
    if (isMonthlyDim) {
      const rows = snap.monthly || []
      const labels = rows.map((r) => monthLabel(r.m))
      if (bld.measure === 'split') {
        return {
          labels,
          datasets: [
            { label: 'Tyres', data: rows.map((r) => Number(r.tyre) || 0) },
            { label: 'Spare Parts', data: rows.map((r) => Number(r.spare) || 0) },
            { label: 'Oil', data: rows.map((r) => Number(r.oil) || 0) },
          ],
        }
      }
      const pick = (r) => Number(r[bld.measure === 'total' ? 'total' : bld.measure]) || 0
      return { labels, datasets: [{ label: measureLabel, data: rows.map(pick) }] }
    }
    // Flat dimension: label + spend rows -> filter -> sort -> top-N -> optional %.
    const all = snap[bld.dim] || []
    const q = bld.search.trim().toLowerCase()
    let rows = (q ? all.filter((r) => String(r.label || '').toLowerCase().includes(q)) : all.slice())
      .map((r) => ({ label: r.label, v: Number(r.spend) || 0 }))
    if (bld.sort === 'desc') rows.sort((a, b) => b.v - a.v)
    else if (bld.sort === 'asc') rows.sort((a, b) => a.v - b.v)
    rows = rows.slice(0, bld.topN)
    if (bld.pct) {
      const total = rows.reduce((s, r) => s + r.v, 0) || 1
      rows = rows.map((r) => ({ label: r.label, v: Math.round((r.v / total) * 1000) / 10 }))
    }
    return { labels: rows.map((r) => r.label), datasets: [{ label: bld.pct ? 'Share %' : 'Spend', data: rows.map((r) => r.v) }] }
  }, [snap, bld.dim, bld.measure, bld.topN, bld.search, bld.sort, bld.pct, isMonthlyDim, measureLabel])

  const builderData = useMemo(() => {
    const labels = builderChart.labels || []
    if (isSplit) {
      const cols = paletteColors(3, bld.palette)
      return {
        labels,
        datasets: (builderChart.datasets || []).map((ds, i) => ({
          ...ds, backgroundColor: cols[i], borderColor: cols[i], fill: false,
        })),
      }
    }
    const ds = builderChart.datasets?.[0] || { data: [] }
    if (bld.type === 'line') {
      const c = paletteColors(1, bld.palette)[0]
      return { labels, datasets: [{ ...ds, borderColor: c, backgroundColor: c, pointRadius: 3, tension: 0.25, fill: false }] }
    }
    const cols = paletteColors(labels.length, bld.palette)
    return { labels, datasets: [{ ...ds, backgroundColor: cols, borderColor: cols, borderWidth: bld.type === 'doughnut' ? 0 : 1 }] }
  }, [builderChart, isSplit, bld.type, bld.palette])

  const builderOptions = useMemo(() => {
    const stacked = isSplit && (bld.type === 'bar' || bld.type === 'hbar')
    const showLabels = bld.labels && bld.type !== 'doughnut'
    const showLegend = bld.legend || isSplit || bld.type === 'doughnut'
    return {
      ...chartBase(showLegend),
      indexAxis: bld.type === 'hbar' ? 'y' : 'x',
      scales: bld.type === 'doughnut' ? {} : {
        x: { stacked, ticks: { autoSkip: bld.type !== 'hbar', maxRotation: 60 } },
        y: { stacked, beginAtZero: true },
      },
      plugins: {
        legend: { display: showLegend },
        tooltip: { enabled: true },
        valueLabels: { enabled: showLabels, color: themeInk(), size: 10 },
      },
    }
  }, [bld.type, bld.labels, bld.legend, isSplit])

  const BuilderChartComp = bld.type === 'doughnut' ? Doughnut : (bld.type === 'line' ? Line : Bar)
  const builderHasData = (builderChart.datasets || []).some((d) => (d.data || []).some((v) => Number(v)))

  /** Data-table rows behind the current chart (drives the on-screen table + slide). */
  const builderTableRows = useMemo(() => {
    const labels = builderChart.labels || []
    if (isSplit) {
      const [t, s, o] = builderChart.datasets || []
      return labels.map((lb, i) => ({ label: lb, cells: [Number(t?.data?.[i]) || 0, Number(s?.data?.[i]) || 0, Number(o?.data?.[i]) || 0] }))
    }
    const ds = builderChart.datasets?.[0]
    return labels.map((lb, i) => ({ label: lb, cells: [Number(ds?.data?.[i]) || 0] }))
  }, [builderChart, isSplit])
  const builderValueHeaders = isSplit ? ['Tyres', 'Spare', 'Oil'] : [bld.pct ? 'Share %' : 'Spend']
  const fmtCellVal = (v) => (bld.pct ? `${Number(v).toFixed(1)}%` : money(v))

  /** Rasterise the current chart onto white paper (presentation-ready PNG). */
  async function builderPng() {
    const canvas = builderRef.current?.querySelector?.('canvas')
    if (!canvas) return null
    try {
      const { captureChartOnPaper } = await import('../lib/chartCapture')
      return captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
    } catch { return canvas.toDataURL('image/png', 1) }
  }

  async function downloadBuilderPng() {
    const img = await builderPng()
    if (!img) return
    const a = document.createElement('a')
    a.href = img
    a.download = `${reportFileName('Expense', dimLabel, activeCountry || 'All')}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }

  async function copyBuilderPng() {
    setDeckMsg('')
    try {
      const canvas = builderRef.current?.querySelector?.('canvas')
      if (!canvas || !navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
        setDeckMsg('Copy is not supported in this browser. Use Download PNG instead.'); return
      }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png', 1))
      if (!blob) { setDeckMsg('Could not read the chart image.'); return }
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      setDeckMsg('Chart copied. Paste it into your slide.')
    } catch { setDeckMsg('Copy failed. Use Download PNG instead.') }
  }

  function currentSlide(img) {
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    return { title: builderTitle, subtitle: `${scope}  |  ${activeCurrency}`, img, rows: builderTableRows, headers: builderValueHeaders, pct: bld.pct }
  }

  async function addSlideToDeck() {
    setDeckMsg('')
    const img = await builderPng()
    if (!img) { setDeckMsg('Nothing to add yet.'); return }
    setDeck((d) => [...d, currentSlide(img)])
    setDeckMsg('Added to deck.')
  }

  async function downloadDeckPptx() {
    let slides = deck
    if (!slides.length) {
      const img = builderHasData ? await builderPng() : null
      slides = img ? [currentSlide(img)] : []
    }
    if (!slides.length || slides.some((s) => !s.img)) { setDeckMsg('No chart to export yet.'); return }
    setDeckBusy(true); setDeckMsg('')
    try {
      const { default: PptxGen } = await import('pptxgenjs')
      const pptx = new PptxGen()
      pptx.defineLayout({ name: 'TP16x9', width: 13.33, height: 7.5 })
      pptx.layout = 'TP16x9'
      const company = appSettings?.company_name || 'TyrePulse'
      for (const s of slides) {
        const slide = pptx.addSlide()
        slide.background = { color: 'FFFFFF' }
        slide.addText(String(s.title || 'Chart'), { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: '0F172A' })
        slide.addText(`${company}  |  ${s.subtitle}`, { x: 0.5, y: 0.95, w: 12.3, h: 0.35, fontSize: 12, color: '64748B' })
        slide.addImage({ data: s.img, x: 0.5, y: 1.4, w: 8.2, h: 5.6 })
        const head = [{ text: 'Item', options: { bold: true, fill: 'F1F5F9' } },
          ...s.headers.map((h) => ({ text: h, options: { bold: true, fill: 'F1F5F9', align: 'right' } }))]
        const body = s.rows.slice(0, 12).map((r) => ([
          { text: String(r.label ?? 'N/A'), options: { align: 'left' } },
          ...r.cells.map((c) => ({ text: s.pct ? `${Number(c).toFixed(1)}%` : Number(c).toLocaleString('en-US'), options: { align: 'right' } })),
        ]))
        slide.addTable([head, ...body], {
          x: 9.0, y: 1.4, w: 3.8, fontSize: 9, color: '0F172A',
          border: { type: 'solid', color: 'E2E8F0', pt: 0.5 }, valign: 'middle',
        })
      }
      await pptx.writeFile({ fileName: `${reportFileName('Expense Presentation', activeCountry || 'All')}.pptx` })
      setDeckMsg(`PowerPoint exported (${slides.length} slide${slides.length === 1 ? '' : 's'}).`)
    } catch {
      setDeckMsg('Could not build the PowerPoint file.')
    } finally { setDeckBusy(false) }
  }

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
              <p className="text-sm font-semibold text-[var(--text-primary)]">Charts are shown per country</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                KSA (SAR), UAE (AED) and Egypt (EGP) use different currencies, so spend cannot be summed into one
                chart or one total. Pick a single country in the country selector to see spend by category, store,
                asset, item and month. The per-country totals above and the spend by site below are each shown in
                their own currency.
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

          {/* Chart Builder - present your own data as a chart. All client-side over
              the same snapshot: pick a dimension, measure, type, top-N; toggle data
              labels; download a PNG for a presentation. Single-country only (the
              snapshot dimensions are per country). */}
          {sections.builder && !isAll && (
            <section className="space-y-3">
              <div className="flex items-start gap-2">
                <BarChart3 size={15} className="text-[var(--accent)] mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">Chart builder</h2>
                  <p className="text-xs text-[var(--text-tertiary)]">Present your own data. Pick what to chart, style it, then copy, download a PNG, or export a PowerPoint deck. Values in {activeCurrency}.</p>
                </div>
              </div>

              <div className="card space-y-4">
                {/* title */}
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Slide title</span>
                  <input
                    value={bld.title}
                    onChange={(e) => setBldField({ title: e.target.value })}
                    placeholder={autoTitle}
                    className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]"
                  />
                </div>

                {/* controls */}
                <div className="flex flex-wrap items-end gap-3">
                  <BuilderField label="Chart">
                    <BuilderSelect value={bld.dim} onChange={(v) => setBldField({ dim: v })}
                      options={BUILDER_DIMS.map((d) => ({ value: d.key, label: d.label }))} />
                  </BuilderField>

                  {isMonthlyDim && (
                    <BuilderField label="Measure">
                      <BuilderSelect value={bld.measure} onChange={(v) => setBldField({ measure: v })}
                        options={BUILDER_MEASURES.map((m) => ({ value: m.key, label: m.label }))} />
                    </BuilderField>
                  )}

                  <BuilderField label="Type">
                    <BuilderSelect value={bld.type} onChange={(v) => setBldField({ type: v })}
                      options={BUILDER_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
                  </BuilderField>

                  <BuilderField label="Colours">
                    <BuilderSelect value={bld.palette} onChange={(v) => setBldField({ palette: v })}
                      options={PRESET_KEYS.map((k2) => ({ value: k2, label: PRESET_LABELS[k2] || k2 }))} />
                  </BuilderField>

                  {!isMonthlyDim && (
                    <BuilderField label="Sort">
                      <BuilderSelect value={bld.sort} onChange={(v) => setBldField({ sort: v })}
                        options={BUILDER_SORTS.map((s) => ({ value: s.key, label: s.label }))} />
                    </BuilderField>
                  )}

                  {!isMonthlyDim && (
                    <BuilderField label="Show top">
                      <BuilderSelect value={String(bld.topN)} onChange={(v) => setBldField({ topN: Number(v) })}
                        options={BUILDER_TOPN.map((n) => ({ value: String(n), label: String(n) }))} />
                    </BuilderField>
                  )}

                  {!isMonthlyDim && (
                    <BuilderField label="Filter">
                      <div className="relative">
                        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                          value={bld.search}
                          onChange={(e) => setBldField({ search: e.target.value })}
                          placeholder="name contains..."
                          className="w-44 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] pl-7 pr-2.5 py-1.5 text-sm text-[var(--text-primary)]"
                        />
                      </div>
                    </BuilderField>
                  )}
                </div>

                {/* toggles */}
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
                    <input type="checkbox" checked={bld.labels} onChange={(e) => setBldField({ labels: e.target.checked })} className="accent-[var(--accent)]" />
                    Data labels
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
                    <input type="checkbox" checked={bld.legend} onChange={(e) => setBldField({ legend: e.target.checked })} className="accent-[var(--accent)]" />
                    Legend
                  </label>
                  {!isMonthlyDim && (
                    <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
                      <input type="checkbox" checked={bld.pct} onChange={(e) => setBldField({ pct: e.target.checked })} className="accent-[var(--accent)]" />
                      Show as % share
                    </label>
                  )}
                </div>

                {/* chart */}
                <div className="rounded-lg border border-[var(--hairline)] p-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{builderTitle}</p>
                  <div ref={builderRef} style={{ height: 360 }}>
                    {builderHasData ? (
                      <BuilderChartComp data={builderData} options={builderOptions} plugins={[BUILDER_LABEL_PLUGIN]} />
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                        No data for this selection. Try a different chart, widen the period, or clear the filter.
                      </div>
                    )}
                  </div>
                </div>

                {/* presentation actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={downloadBuilderPng} disabled={!builderHasData}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40">
                    <ImageIcon size={14} /> Download PNG
                  </button>
                  <button type="button" onClick={copyBuilderPng} disabled={!builderHasData}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40">
                    <Copy size={14} /> Copy chart
                  </button>
                  <button type="button" onClick={addSlideToDeck} disabled={!builderHasData}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40">
                    <Plus size={14} /> Add to deck{deck.length ? ` (${deck.length})` : ''}
                  </button>
                  <button type="button" onClick={downloadDeckPptx} disabled={deckBusy || (!builderHasData && !deck.length)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
                    <Presentation size={14} /> {deckBusy ? 'Building...' : (deck.length ? `Download PowerPoint (${deck.length})` : 'Download PowerPoint')}
                  </button>
                  {deck.length > 0 && (
                    <button type="button" onClick={() => { setDeck([]); setDeckMsg('Deck cleared.') }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
                      <Trash2 size={14} /> Clear deck
                    </button>
                  )}
                  {deckMsg && <span className="text-xs text-[var(--text-tertiary)]">{deckMsg}</span>}
                </div>

                {/* data table behind the chart */}
                {builderHasData && (
                  <details className="rounded-lg border border-[var(--hairline)]">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]">Show the numbers</summary>
                    <div className="max-h-72 overflow-auto px-3 pb-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                            <th className="py-1.5 pr-3 font-semibold">{isMonthlyDim ? 'Month' : dimLabel}</th>
                            {builderValueHeaders.map((h) => <th key={h} className="py-1.5 px-3 font-semibold text-right">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {builderTableRows.map((r, i) => (
                            <tr key={`${r.label}-${i}`} className="border-b border-[var(--hairline)]/40">
                              <td className="py-1.5 pr-3 text-[var(--text-primary)]">{r.label ?? 'N/A'}</td>
                              {r.cells.map((c, ci) => <td key={ci} className="py-1.5 px-3 text-right text-[var(--text-secondary)] tabular-nums">{fmtCellVal(c)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            </section>
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
