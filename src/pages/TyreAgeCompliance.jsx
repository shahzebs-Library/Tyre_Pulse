/**
 * TyreAgeCompliance (route /tyre-age-compliance) - flags tyres that are too OLD
 * by CALENDAR age, regardless of remaining tread. Rubber degrades with age and
 * in GCC heat an under-worn but aged tyre is a real blow-out / insurance risk.
 *
 * Age is measured from the best available birth date (DOT / manufacture date if
 * present, else issue date, else fitment date) to now, and classified into a
 * tunable policy ladder: OK, Watch, Replace, Overdue, plus an honest
 * "Date unknown" bucket for tyres with no birth date on record.
 *
 * Runs on the existing `tyre_records` table (no new data). All banding + KPI
 * maths live in the pure engine `src/lib/tyreAgeCompliance.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CalendarClock, CheckCircle2, Search,
  X, Filter, FileSpreadsheet, FileText, Info, Database, Gauge, ArrowUp, ArrowDown,
  CalendarX,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listTyresForAgeScan } from '../lib/api/tyreAgeCompliance'
import {
  assessFleet, AGE_BAND_META, AGE_BANDS, DEFAULT_AGE_POLICY, DATE_SOURCE_META,
  serialOf, positionOf,
} from '../lib/tyreAgeCompliance'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const BAND_STYLES = {
  ok: 'bg-green-900/40 text-green-300 border border-green-700/50',
  watch: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  replace: 'bg-orange-900/40 text-orange-300 border border-orange-700/50',
  overdue: 'bg-red-900/40 text-red-300 border border-red-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const BAND_HEX = { ok: '#22c55e', watch: '#f59e0b', replace: '#fb923c', overdue: '#ef4444', unknown: '#64748b' }

const fmtAge = (y) => (y == null ? 'N/A' : `${y} yr`)
const dash = (v) => (v == null || v === '' ? 'N/A' : v)

export default function TyreAgeCompliance() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fittedOnly, setFittedOnly] = useState(true)
  const [breakdownDim, setBreakdownDim] = useState('site') // site | brand
  const [sortDir, setSortDir] = useState('desc') // by age

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listTyresForAgeScan({ country: activeCountry, fittedOnly })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load tyre records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, fittedOnly])

  useEffect(() => { load() }, [load])

  // Enrich + summarize against the reference clock (engine is pure).
  const { rows: enriched, counts, kpis, distribution, bySite, byBrand } = useMemo(
    () => assessFleet(rows || [], Date.now(), DEFAULT_AGE_POLICY),
    [rows],
  )

  const siteOptions = useMemo(
    () => [...new Set((enriched || []).map((r) => r.site).filter(Boolean))].sort(),
    [enriched],
  )
  const brandOptions = useMemo(
    () => [...new Set((enriched || []).map((r) => r.brand).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = (enriched || []).filter((r) => {
      if (bandFilter !== 'all' && r.ageBand !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (brandFilter && r.brand !== brandFilter) return false
      if (q) {
        const hay = `${serialOf(r) || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return out.sort((a, b) => {
      const av = a.ageYears == null ? -Infinity : a.ageYears
      const bv = b.ageYears == null ? -Infinity : b.ageYears
      if (av === bv) return 0
      return av < bv ? -dir : dir
    })
  }, [enriched, bandFilter, siteFilter, brandFilter, search, sortDir])

  const chartText = (typeof document !== 'undefined'
    && getComputedStyle(document.documentElement).getPropertyValue('--text-muted')) || '#9ca3af'

  const donutData = {
    labels: distribution.map((d) => d.label),
    datasets: [{
      data: distribution.map((d) => d.count),
      backgroundColor: AGE_BANDS.map((b) => BAND_HEX[b]),
      borderWidth: 0,
    }],
  }

  const breakdown = breakdownDim === 'site' ? bySite : byBrand
  const barData = {
    labels: breakdown.map((g) => g.name),
    datasets: [{
      label: 'Average age (yrs)',
      data: breakdown.map((g) => g.avgAge),
      backgroundColor: breakdown.map((g) => (g.nonCompliant > 0 ? '#fb923c' : '#3b82f6')),
      borderRadius: 4,
    }],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
    },
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, padding: 12 } } },
  }

  const EXPORT_COLS = ['serial', 'asset_no', 'brand', 'size', 'position', 'site', 'ageYears', 'band', 'birthDate', 'dateSource']
  const EXPORT_HEADERS = ['Serial', 'Asset', 'Brand', 'Size', 'Position', 'Site', 'Age (yrs)', 'Status', 'Birth date', 'Date source']
  const exportRows = filtered.map((r) => ({
    serial: serialOf(r) || 'N/A',
    asset_no: r.asset_no || 'N/A',
    brand: r.brand || 'N/A',
    size: r.size || 'N/A',
    position: positionOf(r) || 'N/A',
    site: r.site || 'N/A',
    ageYears: r.ageYears ?? 'N/A',
    band: AGE_BAND_META[r.ageBand]?.label || r.ageBand,
    birthDate: r.birthDate || 'N/A',
    dateSource: DATE_SOURCE_META[r.dateSource]?.label || 'N/A',
  }))

  const kpiTiles = [
    { label: 'Tyres assessed', value: kpis.totalAssessed, icon: ShieldCheck, tone: 'text-[var(--text-primary)]',
      sub: kpis.withDate != null ? `${kpis.withDate} with a birth date` : null },
    { label: 'Compliance rate', value: kpis.compliancePct == null ? 'N/A' : `${kpis.compliancePct}%`,
      icon: CheckCircle2, tone: 'text-green-400', sub: 'Under 5 years old' },
    { label: 'Non-compliant', value: kpis.nonCompliantCount, icon: ShieldAlert, tone: 'text-orange-400',
      sub: '5 years or older' },
    { label: 'Overdue', value: kpis.overdueCount, icon: AlertTriangle, tone: 'text-red-400',
      sub: 'Over 7 years, remove now' },
    { label: 'Average fleet age', value: kpis.avgAgeYears == null ? 'N/A' : `${kpis.avgAgeYears} yr`,
      icon: Gauge, tone: 'text-[var(--text-primary)]', sub: 'Across dated tyres' },
    { label: 'Unknown birth date', value: kpis.unknownDate, icon: CalendarX, tone: 'text-slate-400',
      sub: kpis.unknownDatePct == null ? 'Data quality' : `${kpis.unknownDatePct}% of fleet` },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setBrandFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || brandFilter || search
  const noData = rows !== null && rows.length === 0 && !error
  const oldest = kpis.oldest

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Age Compliance"
        subtitle="Calendar age scan across the fleet. Old tyres are flagged regardless of tread, because rubber degrades with age in GCC heat."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" checked={fittedOnly} onChange={(e) => setFittedOnly(e.target.checked)} />
              Fitted only
            </label>
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tyre_age_compliance')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre Age Compliance', 'tyre_age_compliance', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load tyre records.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm" disabled={refreshing}>Retry</button>
        </div>
      )}

      {/* Policy note */}
      <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-muted)] py-3">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]"><Info size={13} /> Age policy</span>
        <span className="inline-flex items-center gap-1.5"><Dot hex={BAND_HEX.ok} /> OK under {DEFAULT_AGE_POLICY.watchYears} yr</span>
        <span className="inline-flex items-center gap-1.5"><Dot hex={BAND_HEX.watch} /> Watch {DEFAULT_AGE_POLICY.watchYears} to {DEFAULT_AGE_POLICY.replaceYears} yr</span>
        <span className="inline-flex items-center gap-1.5"><Dot hex={BAND_HEX.replace} /> Replace {DEFAULT_AGE_POLICY.replaceYears} to {DEFAULT_AGE_POLICY.overdueYears} yr</span>
        <span className="inline-flex items-center gap-1.5"><Dot hex={BAND_HEX.overdue} /> Overdue over {DEFAULT_AGE_POLICY.overdueYears} yr</span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiTiles.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-dim)] mt-1">{k.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Oldest tyre callout */}
      {oldest && (
        <div className="card border border-red-800/40 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="inline-flex items-center gap-2 text-red-300 font-medium">
            <CalendarClock size={16} /> Oldest tyre on the fleet
          </div>
          <Fact label="Age" value={fmtAge(oldest.ageYears)} strong />
          <Fact label="Serial" value={dash(oldest.serial)} mono />
          <Fact label="Asset" value={dash(oldest.asset_no)} />
          <Fact label="Site" value={dash(oldest.site)} />
          <Fact label="Brand" value={dash(oldest.brand)} />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Age band distribution</h3>
          <div className="h-64">{rows && rows.length ? <Doughnut data={donutData} options={donutOpts} /> : <EmptyChart loading={rows === null} />}</div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Average age by {breakdownDim} (top 10)</h3>
            <div className="inline-flex rounded-md border border-[var(--input-border)] overflow-hidden text-xs">
              {['site', 'brand'].map((d) => (
                <button key={d} onClick={() => setBreakdownDim(d)}
                  className={`px-2.5 py-1 capitalize ${breakdownDim === d ? 'bg-[var(--input-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64">{breakdown.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={rows === null} empty="No dated tyres to break down." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search serial, asset, brand, size" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {AGE_BANDS.map((b) => <option key={b} value={b}>{AGE_BAND_META[b].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} aria-label="Brand">
            <option value="">All brands</option>
            {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {counts.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Serial', 'Asset', 'Brand / Size', 'Position', 'Site'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                <th className="px-4 py-3 font-semibold whitespace-nowrap">
                  <button onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--text-secondary)]">
                    Age {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Source</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : noData ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><Database size={22} className="mx-auto mb-2 opacity-60" />No tyre records found for this scope.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No tyres match these filters.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{dash(serialOf(r))}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dash(r.asset_no)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dash(r.brand)}{r.size ? ` / ${r.size}` : ''}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dash(positionOf(r))}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dash(r.site)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtAge(r.ageYears)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-dim)] text-xs whitespace-nowrap">
                      {r.dateEstimated && r.dateSource !== 'unknown' ? 'Est. ' : ''}{DATE_SOURCE_META[r.dateSource]?.label?.replace(' (estimated)', '') || 'N/A'}
                    </td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.ageBand]}`}>{AGE_BAND_META[r.ageBand]?.label}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>
    </div>
  )
}

function Dot({ hex }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: hex }} />
}

function Fact({ label, value, mono, strong }) {
  return (
    <div className="text-sm">
      <span className="text-[var(--text-muted)] text-xs">{label}: </span>
      <span className={`${strong ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
