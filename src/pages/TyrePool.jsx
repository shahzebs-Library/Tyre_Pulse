/**
 * TyrePool (route /tyre-pool) — ported from tyre_saas and wired to Tyre Pulse
 * data. A view of the unfitted / available tyre pool (spare & stock inventory
 * that can still be allocated to a vehicle), grouped by brand, size and site
 * with counts and total value. Runs entirely on the existing `tyre_records`
 * table — no new data required. The pool DEFINITION lives in the pure,
 * unit-tested `src/lib/tyrePool.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  PackageCheck, Boxes, Wallet, Tags, Ruler, Search, X, Filter,
  FileSpreadsheet, FileText, AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listPoolCandidates } from '../lib/api/tyrePool'
import { summarizePool, poolSerialOf } from '../lib/tyrePool'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

// Deterministic categorical palette (shared look with the rest of the app).
const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#14b8a6', '#ec4899', '#eab308', '#6366f1', '#64748b',
]

const positionOf = (r) => r.position || r.tyre_position || '—'

export default function TyrePool() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [brandFilter, setBrandFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listPoolCandidates({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load tyre records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Narrow to actual pool tyres + summary breakdowns (pure lib).
  const summary = useMemo(() => summarizePool(rows || []), [rows])
  const { pool, totalTyres, totalValue, distinctBrands, distinctSizes, byBrand, bySize } = summary

  const brandOptions = useMemo(
    () => [...new Set(pool.map((r) => r.brand).filter(Boolean))].sort(),
    [pool],
  )
  const sizeOptions = useMemo(
    () => [...new Set(pool.map((r) => r.size).filter(Boolean))].sort(),
    [pool],
  )
  const siteOptions = useMemo(
    () => [...new Set(pool.map((r) => r.site).filter(Boolean))].sort(),
    [pool],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pool.filter((r) => {
      if (brandFilter && r.brand !== brandFilter) return false
      if (sizeFilter && r.size !== sizeFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${poolSerialOf(r) || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [pool, brandFilter, sizeFilter, siteFilter, search])

  const filteredValue = useMemo(
    () => filtered.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0),
    [filtered],
  )

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donut = (groups) => ({
    labels: groups.slice(0, 10).map((g) => g.key),
    datasets: [{
      data: groups.slice(0, 10).map((g) => g.count),
      backgroundColor: CHART_COLORS,
      borderWidth: 0,
    }],
  })
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { color: chartText, boxWidth: 12, font: { size: 11 } } } },
  }

  const EXPORT_COLS = ['serial', 'brand', 'size', 'site', 'position', 'tread_depth', 'status', 'cost']
  const EXPORT_HEADERS = ['Serial', 'Brand', 'Size', 'Site', 'Position', 'Tread (mm)', 'Status', `Cost (${activeCurrency})`]
  const exportRows = filtered.map((r) => ({
    serial: poolSerialOf(r) || '',
    brand: r.brand || '',
    size: r.size || '',
    site: r.site || '',
    position: positionOf(r),
    tread_depth: r.tread_depth ?? '',
    status: r.status || '',
    cost: r.cost_per_tyre ?? '',
  }))

  const kpis = [
    { label: 'Pool tyres', value: totalTyres, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Pool value', value: formatCurrencyCompact(totalValue, activeCurrency), icon: Wallet, tone: 'text-green-400' },
    { label: 'Distinct brands', value: distinctBrands, icon: Tags, tone: 'text-blue-400' },
    { label: 'Distinct sizes', value: distinctSizes, icon: Ruler, tone: 'text-purple-400' },
  ]

  const clearFilters = () => { setBrandFilter(''); setSizeFilter(''); setSiteFilter(''); setSearch('') }
  const hasFilters = brandFilter || sizeFilter || siteFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Pool"
        subtitle="Unfitted spare & stock tyres available for allocation — grouped by brand, size and site with counts and value."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tyre_pool')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre Pool', 'tyre_pool', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by brand</h3>
          <div className="h-64">{pool.length ? <Doughnut data={donut(byBrand)} options={donutOpts} /> : <EmptyChart loading={rows === null} empty="No pool tyres." />}</div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by size</h3>
          <div className="h-64">{pool.length ? <Doughnut data={donut(bySize)} options={donutOpts} /> : <EmptyChart loading={rows === null} empty="No pool tyres." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search serial, brand, size, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} aria-label="Brand">
            <option value="">All brands</option>
            {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="input" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} aria-label="Size">
            <option value="">All sizes</option>
            {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {filtered.length} of {totalTyres} · {formatCurrencyCompact(filteredValue, activeCurrency)}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Serial', 'Brand / Size', 'Site', 'Position', 'Tread', 'Status', 'Cost'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <PackageCheck size={22} className="mx-auto mb-2 opacity-60" />
                  {totalTyres === 0 ? 'No unfitted or spare tyres in the pool.' : 'No pool tyres match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{poolSerialOf(r) || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.brand || '—'}{r.size ? ` · ${r.size}` : ''}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{positionOf(r)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.tread_depth == null || r.tread_depth === '' ? '—' : `${r.tread_depth} mm`}</td>
                    <td className="px-4 py-2.5">
                      <span className="badge text-[11px] px-2 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/50">
                        {r.status || 'Available'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.cost_per_tyre == null || r.cost_per_tyre === '' ? '—' : formatCurrencyCompact(r.cost_per_tyre, activeCurrency)}</td>
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
