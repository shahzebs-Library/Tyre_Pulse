/**
 * FitmentValidation (route /fitment-validation) — validates that each fleet
 * asset's fitted tyre size matches the size specified for the vehicle, flagging
 * assets running the wrong size. Joins `vehicle_fleet.tyre_size` (the spec)
 * against the size(s) of currently-fitted tyres (`tyre_records`, in service)
 * entirely in the browser. Real data only — honest empty states when the fleet
 * has no spec sizes or no fitted tyres. Classification logic lives in
 * `src/lib/fitmentValidation.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Search, X,
  Filter, FileSpreadsheet, FileText, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { loadFitmentData } from '../lib/api/fitmentValidation'
import { summarizeFitments, FITMENT_BAND_META } from '../lib/fitmentValidation'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const BAND_STYLES = {
  mismatch: 'bg-red-900/40 text-red-300 border border-red-700/50',
  match: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

export default function FitmentValidation() {
  const { activeCountry } = useSettings()
  const [data, setData] = useState(null) // { vehicles, tyres }
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const res = await loadFitmentData({ country: activeCountry })
      setData(res)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load fleet or tyre data.')
      setData({ vehicles: [], tyres: [] })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const { rows: enriched, counts, compliancePct } = useMemo(
    () => summarizeFitments(data?.vehicles || [], data?.tyres || []),
    [data],
  )

  const siteOptions = useMemo(
    () => [...new Set((enriched || []).map((r) => r.site).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (enriched || []).filter((r) => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.asset_no} ${r.make} ${r.model} ${r.vehicle_type} ${r.spec} ${r.fittedSizes.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, bandFilter, siteFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const loaded = data !== null
  const hasAny = loaded && (data.vehicles.length > 0)

  const donutData = {
    labels: ['Wrong size', 'Correct size', 'No data'],
    datasets: [{
      data: [counts.mismatch, counts.match, counts.unknown],
      backgroundColor: ['#ef4444', '#22c55e', '#64748b'],
      borderWidth: 0,
    }],
  }
  const bySiteMismatch = useMemo(() => {
    const m = new Map()
    for (const r of enriched) {
      if (r.band !== 'mismatch') continue
      const k = r.site || 'Unassigned'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [enriched])
  const barData = {
    labels: bySiteMismatch.map(([s]) => s),
    datasets: [{ label: 'Wrong-size assets', data: bySiteMismatch.map(([, n]) => n), backgroundColor: '#ef4444', borderRadius: 4 }],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: { x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } }, y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } } },
  }

  const EXPORT_COLS = ['asset_no', 'vehicle', 'site', 'spec', 'fitted', 'mismatch', 'fittedCount', 'status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    vehicle: [r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '',
    site: r.site || '',
    spec: r.spec || '',
    fitted: r.fittedSizes.join(', '),
    mismatch: FITMENT_BAND_META[r.band]?.label || r.band,
    fittedCount: r.fittedCount,
    status: r.status || '',
  }))
  const EXPORT_HEADERS = ['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Result', 'Fitted tyres', 'Status']

  const kpis = [
    { label: 'Assets checked', value: counts.total, icon: ShieldCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Correct size', value: counts.match, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Wrong size', value: counts.mismatch, icon: XCircle, tone: 'text-red-400' },
    { label: 'No data', value: counts.unknown, icon: HelpCircle, tone: 'text-[var(--text-muted)]' },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fitment Validation"
        subtitle="Validates each asset's fitted tyre size against its specified size — flagging vehicles running the wrong size."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fitment_validation')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fitment Validation', 'fitment_validation', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fitment data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{!loaded ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Fitment breakdown</h3>
          <div className="h-64">{hasAny ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={!loaded} empty="No fleet assets in scope." />}</div>
          {compliancePct != null && <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5"><Info size={12} /> Correct-size rate (of checkable assets): <span className="font-semibold text-[var(--text-secondary)]">{compliancePct}%</span></p>}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Wrong-size assets by site (top 10)</h3>
          <div className="h-64">{bySiteMismatch.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={!loaded} empty="No wrong-size fitments found." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, make/model, size…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Result">
            <option value="all">All results</option>
            <option value="mismatch">Wrong size</option>
            <option value="match">Correct size</option>
            <option value="unknown">No data</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
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
                {['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Tyres', 'Result'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{hasAny ? 'No assets match these filters.' : 'No fleet assets found for this country.'}</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.asset_no || Math.random()} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{[r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.spec || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {r.fittedSizes.length ? (
                        <span className={r.band === 'mismatch' ? 'text-red-300' : 'text-[var(--text-secondary)]'}>{r.fittedSizes.join(', ')}</span>
                      ) : <span className="text-[var(--text-muted)]">—</span>}
                      {r.band === 'mismatch' && r.mismatchSizes.length > 0 && (
                        <span className="block text-[10px] text-red-400/80 mt-0.5">≠ spec: {r.mismatchSizes.join(', ')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.fittedCount || 0}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.band]}`}>{FITMENT_BAND_META[r.band]?.label}</span></td>
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
