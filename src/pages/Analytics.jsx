import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { computeBrandMetrics, computeSiteMetrics } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { BarChart2, TrendingUp, AlertTriangle, Activity } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue } from '../components/ui/PeriodFilter'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

export default function Analytics() {
  const reportMeta = useReportMeta('Fleet Analytics')
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState({ mode: 'all' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: e } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty')
          .order('issue_date')
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (e) throw new Error(e.message || e)
      setRecords(data || [])
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load data.'))
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() =>
    filterByPeriodValue(records, period, 'issue_date'),
    [records, period]
  )

  const totalCost = filtered.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0) * (r.qty || 1), 0)
  const avgCost = filtered.length > 0 ? totalCost / filtered.length : 0
  const highRiskCount = filtered.filter(r => ['High', 'Critical'].includes(r.risk_level)).length

  const siteMetrics = useMemo(() => computeSiteMetrics(filtered), [filtered])
  const brandMetrics = useMemo(() => computeBrandMetrics(filtered), [filtered])

  // Monthly trend chart
  const monthlyData = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      if (!r.issue_date) return
      const m = r.issue_date.slice(0, 7)
      if (!map[m]) map[m] = { month: m, count: 0, cost: 0 }
      map[m].count++
      map[m].cost += parseFloat(r.cost_per_tyre) || 0
    })
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [filtered])

  const chartData = useMemo(() => ({
    labels: monthlyData.map(d => d.month),
    datasets: [
      { label: 'Records', data: monthlyData.map(d => d.count), backgroundColor: withAlpha(colorAt(0), 0.6), borderColor: colorAt(0), yAxisID: 'y', borderRadius: 4 },
      { label: 'Cost', data: monthlyData.map(d => d.cost), backgroundColor: withAlpha(colorAt(3), 0.6), borderColor: colorAt(3), yAxisID: 'y1', borderRadius: 4 },
    ],
  }), [monthlyData])

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
      y1: { position: 'right', grid: { display: false }, ticks: { color: '#6b7280' } },
    },
  }

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: r => r.site, size: 140 },
    { id: 'count', header: 'Records', accessorFn: r => r.count, size: 80, meta: { align: 'right' } },
    {
      id: 'totalCost', header: 'Total Cost', accessorFn: r => r.totalCost, size: 110, meta: { align: 'right' },
      cell: ({ getValue }) => <span>{formatCurrencyCompact(getValue(), activeCurrency)}</span>,
    },
    {
      id: 'avgCost', header: 'Avg Cost', accessorFn: r => r.avgCost, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => <span>{formatCurrencyCompact(getValue(), activeCurrency)}</span>,
    },
    {
      id: 'highRiskPct', header: 'High Risk %', accessorFn: r => r.highRiskPct, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => {
        const val = getValue()
        return <span className={`text-xs px-2 py-0.5 rounded-full ${val > 30 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-400'}`}>{val.toFixed(1)}%</span>
      },
    },
    { id: 'topCategory', header: 'Top Category', accessorFn: r => r.topCategory ?? '-', size: 120 },
  ], [activeCurrency])

  const brandColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand, size: 140 },
    { id: 'count', header: 'Records', accessorFn: r => r.count, size: 80, meta: { align: 'right' } },
    {
      id: 'totalCost', header: 'Total Cost', accessorFn: r => r.totalCost, size: 110, meta: { align: 'right' },
      cell: ({ getValue }) => <span>{formatCurrencyCompact(getValue(), activeCurrency)}</span>,
    },
    {
      id: 'avgCost', header: 'Avg Cost', accessorFn: r => r.avgCost, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => <span>{formatCurrencyCompact(getValue(), activeCurrency)}</span>,
    },
    {
      id: 'failureRate', header: 'Failure Rate', accessorFn: r => r.failureRate, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => {
        const val = getValue()
        return <span className={`text-xs px-2 py-0.5 rounded-full ${val > 30 ? 'bg-red-900/40 text-red-400' : val > 15 ? 'bg-yellow-900/40 text-yellow-400' : 'bg-green-900/40 text-green-400'}`}>{val.toFixed(1)}%</span>
      },
    },
    { id: 'topCategory', header: 'Top Category', accessorFn: r => r.topCategory ?? '-', size: 120 },
  ], [activeCurrency])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        icon={BarChart2}
      />

      <PeriodFilter records={records} value={period} onChange={setPeriod} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-white">{filtered.length.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.totalTyres')}</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-400">{formatCurrencyCompact(totalCost, activeCurrency)}</p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.totalCost')}</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-emerald-400">{formatCurrencyCompact(avgCost, activeCurrency)}</p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.avgCost')}</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-400">{highRiskCount}</p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.highRisk')}</p>
        </div>
      </div>

      {error && !loading && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-6">
          <div className="card animate-pulse h-64" />
          <div className="card animate-pulse h-64" />
        </div>
      ) : filtered.length > 0 ? (
        <>
          {/* Monthly trend chart */}
          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={15} className="text-blue-400" /> Monthly Trend
            </h3>
            <div style={{ height: 300 }}>
              <Bar data={chartData} options={chartOpts} />
            </div>
          </div>

          {/* Site Metrics */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-dim)]">
              <h3 className="text-sm font-semibold text-white">{t('analytics.site.title')}</h3>
            </div>
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={siteColumns}
              data={siteMetrics}
              getRowId={(row) => row.site}
              enableGlobalFilter={true}
              searchPlaceholder="Search sites..."
              enableSorting={true}
              enableExport={true}
              exportFileName="site_analytics"
              initialPageSize={25}
              pageSizeOptions={[10, 25, 50]}
              emptyMessage="No site data"
            />
          </div>

          {/* Brand Metrics */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-dim)]">
              <h3 className="text-sm font-semibold text-white">{t('analytics.brand.title')}</h3>
            </div>
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={brandColumns}
              data={brandMetrics}
              getRowId={(row) => row.brand}
              enableGlobalFilter={true}
              searchPlaceholder="Search brands..."
              enableSorting={true}
              enableExport={true}
              exportFileName="brand_analytics"
              initialPageSize={25}
              pageSizeOptions={[10, 25, 50]}
              emptyMessage="No brand data"
            />
          </div>
        </>
      ) : (
        <div className="card text-center py-14">
          <Activity size={36} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No data available</p>
          <p className="text-gray-600 text-sm mt-1">Adjust your filters or import tyre records.</p>
        </div>
      )}
    </div>
  )
}