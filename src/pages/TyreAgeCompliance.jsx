/**
 * TyreAgeCompliance (route /tyre-age-compliance) — ported from tyre_saas and
 * wired to Tyre Pulse data. Scans every fitted tyre's age (from fitment/issue
 * date) against GCC/RTA limits, surfacing non-compliant and aging tyres with a
 * distribution chart, filters, search, and export. Runs entirely on the existing
 * `tyre_records` table — no new data required.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, Clock, CheckCircle2, Search, X, Filter,
  FileSpreadsheet, FileText, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listTyresForAgeScan } from '../lib/api/tyreAgeCompliance'
import {
  summarizeTyreAges, AGE_BAND_META, DEFAULT_AGE_THRESHOLDS,
} from '../lib/tyreAge'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const BAND_STYLES = {
  non_compliant: 'bg-red-900/40 text-red-300 border border-red-700/50',
  advisory: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  compliant: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const serialOf = (r) => r.serial_no || r.serial_number || r.tyre_serial || '—'
const positionOf = (r) => r.position || r.tyre_position || '—'

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

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listTyresForAgeScan({ country: activeCountry, fittedOnly })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load tyre records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, fittedOnly])

  useEffect(() => { load() }, [load])

  // Enrich + summarize against the reference clock (passed in — tyreAge is pure).
  const { rows: enriched, counts, compliancePct, avgAge } = useMemo(
    () => summarizeTyreAges(rows || [], Date.now(), DEFAULT_AGE_THRESHOLDS),
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
    return (enriched || []).filter((r) => {
      if (bandFilter !== 'all' && r.ageBand !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (brandFilter && r.brand !== brandFilter) return false
      if (q) {
        const hay = `${serialOf(r)} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, bandFilter, siteFilter, brandFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: ['Non-compliant', 'Advisory', 'Compliant', 'No date'],
    datasets: [{
      data: [counts.non_compliant, counts.advisory, counts.compliant, counts.unknown],
      backgroundColor: ['#ef4444', '#f59e0b', '#22c55e', '#64748b'],
      borderWidth: 0,
    }],
  }
  const bySiteRisk = useMemo(() => {
    const m = new Map()
    for (const r of enriched) {
      if (r.ageBand !== 'non_compliant' && r.ageBand !== 'advisory') continue
      const k = r.site || 'Unassigned'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [enriched])
  const barData = {
    labels: bySiteRisk.map(([s]) => s),
    datasets: [{ label: 'At-risk tyres', data: bySiteRisk.map(([, n]) => n), backgroundColor: '#f59e0b', borderRadius: 4 }],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: { x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } }, y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } } },
  }

  const EXPORT_COLS = ['serial', 'asset_no', 'brand', 'size', 'position', 'site', 'ageYears', 'ageBand', 'fitment_date']
  const exportRows = filtered.map((r) => ({
    serial: serialOf(r), asset_no: r.asset_no || '', brand: r.brand || '', size: r.size || '',
    position: positionOf(r), site: r.site || '', ageYears: r.ageYears ?? '',
    ageBand: AGE_BAND_META[r.ageBand]?.label || r.ageBand, fitment_date: r.fitment_date || r.issue_date || '',
  }))
  const EXPORT_HEADERS = ['Serial', 'Asset', 'Brand', 'Size', 'Position', 'Site', 'Age (yrs)', 'Status', 'Fitment date']

  const kpis = [
    { label: 'Tyres scanned', value: counts.total, icon: ShieldCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Non-compliant', value: counts.non_compliant, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Advisory (aging)', value: counts.advisory, icon: Clock, tone: 'text-amber-400' },
    { label: 'Compliance rate', value: compliancePct == null ? '—' : `${compliancePct}%`, icon: CheckCircle2, tone: 'text-green-400' },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setBrandFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || brandFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Age Compliance"
        subtitle="GCC/RTA age-limit scan across the fleet — from fitment date, with aging & non-compliant tyres flagged."
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
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS, 'Tyre Age Compliance', 'tyre_age_compliance', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load tyre records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Age distribution</h3>
          <div className="h-64">{rows && rows.length ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={rows === null} />}</div>
          {avgAge != null && <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5"><Info size={12} /> Average tyre age: <span className="font-semibold text-[var(--text-secondary)]">{avgAge} yrs</span></p>}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">At-risk tyres by site (top 10)</h3>
          <div className="h-64">{bySiteRisk.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={rows === null} empty="No aging or non-compliant tyres." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search serial, asset, brand, size…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="non_compliant">Non-compliant</option>
            <option value="advisory">Advisory</option>
            <option value="compliant">Compliant</option>
            <option value="unknown">No date</option>
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
                {['Serial', 'Asset', 'Brand / Size', 'Position', 'Site', 'Age', 'Status'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No tyres match these filters.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{serialOf(r)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.brand || '—'}{r.size ? ` · ${r.size}` : ''}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{positionOf(r)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.ageYears == null ? '—' : `${r.ageYears} yr`}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.ageBand]}`}>{AGE_BAND_META[r.ageBand]?.label}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>
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
