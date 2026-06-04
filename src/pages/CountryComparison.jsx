import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { computeCountryMetrics, sum } from '../lib/analyticsEngine'
import { Globe, TrendingUp, AlertTriangle, DollarSign, Truck, Activity } from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const COUNTRY_COLORS = { KSA: '#3b82f6', UAE: '#10b981', Egypt: '#f59e0b' }
const COUNTRY_CURRENCY_MAP = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280' } },
    y: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280' } },
  },
}

function fmt(n, currency) {
  if (n == null) return 'N/A'
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${currency} ${(n / 1_000).toFixed(0)}K`
  return `${currency} ${n.toLocaleString()}`
}

function pct(n) { return n == null ? 'N/A' : `${n.toFixed(1)}%` }
function cpk(n) { return n == null ? 'N/A' : n.toFixed(3) }

const KPI_ROWS = [
  { key: 'count',          label: 'Fleet Records',        fmt: (v)  => v.toLocaleString(),                     icon: Truck },
  { key: 'totalCost',      label: 'Total Cost',           fmt: (v, c) => fmt(v, COUNTRY_CURRENCY_MAP[c] || 'SAR'), icon: DollarSign },
  { key: 'avgCostPerTyre', label: 'Avg Cost / Tyre',      fmt: (v, c) => fmt(v, COUNTRY_CURRENCY_MAP[c] || 'SAR'), icon: DollarSign },
  { key: 'avgCpk',         label: 'Avg CPK',              fmt: (v)  => cpk(v),                                 icon: Activity },
  { key: 'highRiskPct',    label: 'High Risk %',          fmt: (v)  => pct(v),                                 icon: AlertTriangle },
  { key: 'openActions',    label: 'Open Actions',         fmt: (v)  => v.toLocaleString(),                     icon: TrendingUp },
  { key: 'overdueActions', label: 'Overdue Actions',      fmt: (v)  => v.toLocaleString(),                     icon: AlertTriangle },
  { key: 'siteCount',      label: 'Sites',                fmt: (v)  => v.toLocaleString(),                     icon: Globe },
  { key: 'brandCount',     label: 'Brands Used',          fmt: (v)  => v.toLocaleString(),                     icon: Globe },
]

function riskColor(pct) {
  if (pct == null) return 'text-gray-500'
  if (pct >= 30) return 'text-red-400'
  if (pct >= 15) return 'text-yellow-400'
  return 'text-green-400'
}

function overdueColor(n) {
  if (n == null) return 'text-gray-500'
  if (n >= 5) return 'text-red-400'
  if (n >= 1) return 'text-yellow-400'
  return 'text-green-400'
}

export default function CountryComparison() {
  const { appSettings } = useSettings()
  const [records, setRecords]   = useState([])
  const [actions, setActions]   = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const [tRes, aRes] = await Promise.all([
        supabase.from('tyre_records').select(
          'id,country,site,brand,category,risk_level,cost_per_tyre,qty,issue_date,km_at_fitment,km_at_removal'
        ),
        supabase.from('corrective_actions').select('id,country,status,due_date,priority'),
      ])
      setRecords(tRes.data ?? [])
      setActions(aRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const metrics = useMemo(
    () => computeCountryMetrics(records, actions, appSettings.cost_per_tyre),
    [records, actions, appSettings.cost_per_tyre]
  )

  const countries = metrics.map(m => m.country)

  const costChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.totalCost),
      backgroundColor: countries.map(c => COUNTRY_COLORS[c] ?? '#6b7280'),
      borderRadius: 4,
    }],
  }

  const riskChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.highRiskPct),
      backgroundColor: countries.map(m => '#ef4444'),
      borderRadius: 4,
    }],
  }

  const cpkChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.avgCpk ?? 0),
      backgroundColor: countries.map(c => COUNTRY_COLORS[c] ?? '#6b7280'),
      borderRadius: 4,
    }],
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-7 w-7 rounded-full border-2 border-gray-700 border-t-blue-500" />
    </div>
  )

  if (metrics.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <Globe size={36} className="text-gray-700" />
      <p className="text-gray-500 text-sm">No country data yet.</p>
      <p className="text-gray-600 text-xs">Upload tyre records and set the country field to see comparisons.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="page-title flex items-center gap-2"><Globe size={20} className="text-blue-400" /> Country Comparison</h1>
        <p className="text-gray-500 text-sm mt-0.5">KPI breakdown across KSA, UAE and Egypt</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {metrics.map(m => {
          const currency = COUNTRY_CURRENCY_MAP[m.country] || 'SAR'
          const color    = COUNTRY_COLORS[m.country] || '#6b7280'
          return (
            <div key={m.country} className="card" style={{ borderTop: `2px solid ${color}` }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white text-base">{m.country}</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${color}20`, color }}>
                  {currency}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">Fleet</p>
                  <p className="text-lg font-bold text-white">{m.count.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">Total Cost</p>
                  <p className="text-lg font-bold text-white">{fmt(m.totalCost, currency)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">High Risk</p>
                  <p className={`text-lg font-bold ${riskColor(m.highRiskPct)}`}>{pct(m.highRiskPct)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">Avg CPK</p>
                  <p className="text-lg font-bold text-white">{cpk(m.avgCpk)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* KPI comparison table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Full KPI Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header rounded-tl-md w-48">Metric</th>
                {metrics.map(m => (
                  <th key={m.country} className="table-header text-center" style={{ color: COUNTRY_COLORS[m.country] || '#6b7280' }}>
                    {m.country}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KPI_ROWS.map(({ key, label, fmt: fmtFn, icon: Icon }) => (
                <tr key={key} className="hover:bg-white/2 transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <Icon size={13} className="text-gray-600 flex-shrink-0" />
                      <span className="text-gray-400">{label}</span>
                    </div>
                  </td>
                  {metrics.map(m => {
                    const val = m[key]
                    const display = fmtFn(val, m.country)
                    let colorClass = 'text-gray-200'
                    if (key === 'highRiskPct')    colorClass = riskColor(val)
                    if (key === 'overdueActions') colorClass = overdueColor(val)
                    return (
                      <td key={m.country} className="table-cell text-center">
                        <span className={`font-semibold ${colorClass}`}>{display}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Total Cost by Country</p>
          <div style={{ height: 160 }}>
            <Bar data={costChartData} options={BAR_OPTS} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">High Risk % by Country</p>
          <div style={{ height: 160 }}>
            <Bar data={riskChartData} options={{ ...BAR_OPTS, scales: { ...BAR_OPTS.scales, y: { ...BAR_OPTS.scales.y, max: 100 } } }} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Avg CPK by Country</p>
          <div style={{ height: 160 }}>
            <Bar data={cpkChartData} options={BAR_OPTS} />
          </div>
        </div>
      </div>
    </div>
  )
}
