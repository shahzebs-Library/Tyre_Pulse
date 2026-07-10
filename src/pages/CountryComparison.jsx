import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { GitCompare, BarChart2, Globe, AlertTriangle, ChevronDown } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const KPI_ROWS = [
  { key: 'tyres', label: 'Total Tyres', icon: '🛞', lowerIsBetter: false },
  { key: 'avgCost', label: 'Avg Cost / Tyre', icon: '💰', lowerIsBetter: true },
  { key: 'totalCost', label: 'Total Fleet Cost', icon: '💵', lowerIsBetter: false },
  { key: 'failureRate', label: 'Failure Rate', icon: '⚠️', lowerIsBetter: true },
  { key: 'highRiskPct', label: 'High Risk %', icon: '🔴', lowerIsBetter: true },
  { key: 'brandCount', label: 'Brands Used', icon: '🏷️', lowerIsBetter: false },
]

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af' } } },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
  },
}

export default function CountryComparison() {
  const reportMeta = useReportMeta('Country Comparison')
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [countries, setCountries] = useState([])
  const [allCountries, setAllCountries] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch all countries available
  useEffect(() => {
    supabase.from('tyre_records')
      .select('country')
      .not('country', 'is', null)
      .then(({ data }) => {
        if (data) {
          const c = [...new Set(data.map(r => r.country))].filter(Boolean).sort()
          setAllCountries(c)
          setCountries(c.slice(0, 3))
        }
      })
  }, [])

  const load = useCallback(async () => {
    if (countries.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await fetchAllPages((from, to) =>
        supabase.from('tyre_records')
          .select('country, brand, cost_per_tyre, risk_level, site')
          .in('country', countries)
          .range(from, to)
      )
      if (e) throw e
      setRecords(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [countries])

  useEffect(() => { if (countries.length > 0) load() }, [load, countries.length])

  // Compute per-country metrics
  const metrics = useMemo(() => {
    const map = {}
    countries.forEach(c => {
      const rows = records.filter(r => r.country === c)
      const totalCost = rows.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0)
      const failureRows = rows.filter(r => (r.risk_level || '').toLowerCase() === 'high' || (r.risk_level || '').toLowerCase() === 'critical')
      map[c] = {
        country: c,
        tyres: rows.length,
        totalCost,
        avgCost: rows.length > 0 ? totalCost / rows.length : 0,
        failureRate: rows.length > 0 ? (failureRows.length / rows.length) * 100 : 0,
        highRiskPct: rows.length > 0 ? (failureRows.length / rows.length) * 100 : 0,
        brandCount: new Set(rows.map(r => r.brand).filter(Boolean)).size,
        siteCount: new Set(rows.map(r => r.site).filter(Boolean)).size,
      }
    })
    return Object.values(map)
  }, [records, countries])

  // Build table data
  const tableData = useMemo(() => {
    if (countries.length === 0 || metrics.length === 0) return []
    return KPI_ROWS.map(kpi => {
      const row = { key: kpi.key, label: kpi.label, icon: kpi.icon, lowerIsBetter: kpi.lowerIsBetter }
      countries.forEach(c => {
        const m = metrics.find(m => m.country === c)
        row[c] = m ? m[kpi.key] : 0
      })
      return row
    })
  }, [metrics, countries])

  // Build table columns dynamically
  const tableColumns = useMemo(() => {
    if (countries.length === 0) return []
    const cols = [
      { id: 'metric', header: 'Metric', accessorFn: r => r.label, size: 180, enableSorting: false,
        cell: ({ row }) => <span className="font-medium text-white flex items-center gap-2"><span>{row.original.icon}</span>{row.original.label}</span>,
      },
    ]
    countries.forEach(c => {
      const vals = metrics.map(m => m[c] || 0)
      const best = KPI_ROWS.some(k => k.lowerIsBetter) ? Math.min(...vals) : Math.max(...vals)
      cols.push({
        id: c,
        header: c,
        accessorFn: r => r[c],
        size: 120,
        meta: { align: 'center' },
        cell: ({ getValue, row }) => {
          const val = getValue()
          const formatted = row.original.key === 'tyres' || row.original.key === 'brandCount' || row.original.key === 'siteCount'
            ? val.toLocaleString()
            : row.original.key === 'failureRate' || row.original.key === 'highRiskPct'
              ? val.toFixed(1) + '%'
              : formatCurrencyCompact(val, activeCurrency)
          return <span className="text-gray-300">{formatted}</span>
        },
      })
    })
    return cols
  }, [countries, metrics, activeCurrency])

  // Chart data
  const chartData = useMemo(() => {
    const labels = metrics.map(m => m.country)
    return {
      labels,
      datasets: [
        { label: 'Total Tyres', data: metrics.map(m => m.tyres), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
        { label: 'Avg Cost', data: metrics.map(m => m.avgCost), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, yAxisID: 'y1' },
      ],
    }
  }, [metrics])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('countrycomparison.title')}
        subtitle={t('countrycomparison.subtitle')}
        icon={GitCompare}
      />

      {/* Country selector */}
      <div className="card">
        <label className="label mb-2 flex items-center gap-2">
          <Globe size={14} className="text-blue-400" /> Select Countries to Compare
        </label>
        <div className="flex flex-wrap gap-2">
          {allCountries.map(c => {
            const active = countries.includes(c)
            return (
              <button
                key={c}
                onClick={() => {
                  if (active) setCountries(prev => prev.filter(x => x !== c))
                  else setCountries(prev => [...prev, c].sort())
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  active ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="card animate-pulse h-24" />)}
        </div>
      ) : metrics.length > 0 && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {KPI_ROWS.slice(0, 6).map(kpi => {
              const vals = metrics.map(m => m[kpi.key])
              const total = kpi.key === 'tyres' || kpi.key === 'brandCount'
                ? vals.reduce((s, v) => s + v, 0)
                : vals.reduce((s, v) => s + v, 0) / vals.length
              return (
                <div key={kpi.key} className="card text-center">
                  <p className="text-xs text-gray-500">{kpi.label}</p>
                  <p className="text-lg font-bold text-white mt-1">
                    {kpi.key === 'failureRate' || kpi.key === 'highRiskPct'
                      ? total.toFixed(1) + '%'
                      : kpi.key === 'tyres' || kpi.key === 'brandCount'
                        ? total.toLocaleString()
                        : formatCurrencyCompact(total, activeCurrency)}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Chart */}
          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <BarChart2 size={15} className="text-blue-400" /> Country Comparison
            </h3>
            <div style={{ height: 300 }}>
              <Bar data={chartData} options={{
                ...CHART_OPTS,
                scales: { ...CHART_OPTS.scales, y1: { position: 'right', grid: { display: false }, ticks: { color: '#6b7280' } } },
              }} />
            </div>
          </div>

          {/* EnterpriseTable */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-dim)]">
              <h3 className="text-sm font-semibold text-white">Detailed Metrics</h3>
            </div>
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={tableColumns}
              data={tableData}
              getRowId={(row) => row.key}
              enableGlobalFilter={false}
              enableSorting={false}
              enableColumnFilters={false}
              enableColumnVisibility={false}
              enableExport={false}
              emptyMessage="No data for selected countries"
            />
          </div>
        </>
      )}

      {!loading && metrics.length === 0 && countries.length > 0 && (
        <div className="card text-center py-14">
          <BarChart2 size={36} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No data available</p>
          <p className="text-gray-600 text-sm mt-1">Try selecting different countries.</p>
        </div>
      )}
    </div>
  )
}