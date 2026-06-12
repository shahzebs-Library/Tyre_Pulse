import { useState, useMemo } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { GitCompare, Download, FileText } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const now = new Date()
const YEARS = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

const defaultA = { months: [0, 1, 2], year: now.getFullYear() - 1 }
const defaultB = { months: [0, 1, 2], year: now.getFullYear() }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 10 } },
    tooltip: { backgroundColor: '#1f2937', titleColor: '#fff', bodyColor: '#9ca3af', borderColor: '#374151', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
  },
}

export default function Comparison() {
  const { activeCurrency } = useSettings()
  const [periodA, setPeriodA] = useState(defaultA)
  const [periodB, setPeriodB] = useState(defaultB)
  const [metric, setMetric]   = useState('count')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [ran, setRan]         = useState(false)

  function toggleMonth(period, setPeriod, m) {
    setPeriod(p => ({
      ...p,
      months: p.months.includes(m)
        ? p.months.filter(x => x !== m)
        : [...p.months, m].sort((a, b) => a - b),
    }))
  }

  async function runComparison() {
    setLoading(true)
    const minYear = Math.min(periodA.year, periodB.year)
    const maxYear = Math.max(periodA.year, periodB.year)
    const { data } = await supabase
      .from('tyre_records')
      .select('issue_date, cost')
      .gte('issue_date', `${minYear}-01-01`)
      .lte('issue_date', `${maxYear}-12-31`)
    setRecords(data || [])
    setRan(true)
    setLoading(false)
  }

  const { chartData, tableData, trendText } = useMemo(() => {
    if (!ran) return { chartData: null, tableData: [], trendText: '' }

    const bucketA = {}, bucketB = {}
    periodA.months.forEach(m => { bucketA[m] = { count: 0, cost: 0 } })
    periodB.months.forEach(m => { bucketB[m] = { count: 0, cost: 0 } })

    records.forEach(r => {
      if (!r.issue_date) return
      const d = new Date(r.issue_date)
      const yr = d.getFullYear(), mo = d.getMonth()
      if (yr === periodA.year && bucketA[mo] !== undefined) {
        bucketA[mo].count++; bucketA[mo].cost += parseFloat(r.cost) || 0
      }
      if (yr === periodB.year && bucketB[mo] !== undefined) {
        bucketB[mo].count++; bucketB[mo].cost += parseFloat(r.cost) || 0
      }
    })

    const allMonths = [...new Set([...periodA.months, ...periodB.months])].sort((a, b) => a - b)

    const getVal = (bucket, m) => metric === 'count' ? (bucket[m]?.count || 0) : Math.round(bucket[m]?.cost || 0)

    const labels = allMonths.map(m => MONTHS[m])
    const aVals  = allMonths.map(m => getVal(bucketA, m))
    const bVals  = allMonths.map(m => getVal(bucketB, m))

    const chartData = {
      labels,
      datasets: [
        { label: `Period A (${periodA.year})`, data: aVals, backgroundColor: 'rgba(22,163,74,0.7)', borderColor: '#16a34a', borderWidth: 1, borderRadius: 3 },
        { label: `Period B (${periodB.year})`, data: bVals, backgroundColor: 'rgba(59,130,246,0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3 },
      ],
    }

    const tableData = allMonths.map((m, i) => {
      const a = aVals[i], b = bVals[i]
      const diff = b - a
      const pct = a > 0 ? Math.round((diff / a) * 100) : (b > 0 ? 100 : 0)
      return { month: MONTHS[m], a, b, diff, pct }
    })

    const totalA = aVals.reduce((s, v) => s + v, 0)
    const totalB = bVals.reduce((s, v) => s + v, 0)
    let trendText = ''
    if (totalA > 0) {
      const overall = Math.round(((totalB - totalA) / totalA) * 100)
      const label = metric === 'count' ? 'replacements' : 'cost'
      trendText = `Period B shows ${Math.abs(overall)}% ${overall >= 0 ? 'more' : 'fewer'} ${label} than Period A`
    }

    return { chartData, tableData, trendText }
  }, [ran, records, periodA, periodB, metric])

  function exportResultsExcel() {
    const rows = tableData.map(r => ({
      month: r.month, period_a: r.a, period_b: r.b,
      difference: r.diff, pct_change: `${r.pct > 0 ? '+' : ''}${r.pct}%`,
    }))
    exportToExcel(rows,
      ['month','period_a','period_b','difference','pct_change'],
      ['Month','Period A','Period B','Difference','% Change'],
      'TyrePulse_Comparison')
  }

  function exportResultsPdf() {
    const rows = tableData.map(r => ({
      month: r.month, period_a: r.a, period_b: r.b,
      difference: `${r.diff > 0 ? '+' : ''}${r.diff}`,
      pct_change: `${r.pct > 0 ? '+' : ''}${r.pct}%`,
    }))
    exportToPdf(rows, [
      { key: 'month', header: 'Month' },
      { key: 'period_a', header: `Period A (${periodA.year})` },
      { key: 'period_b', header: `Period B (${periodB.year})` },
      { key: 'difference', header: 'Difference' },
      { key: 'pct_change', header: '% Change' },
    ], 'Period Comparison', 'TyrePulse_Comparison', 'portrait')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Period Comparison"
        subtitle="Compare tyre replacements or costs across two time periods"
        icon={GitCompare}
      />

      {/* Period selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: 'Period A', period: periodA, setPeriod: setPeriodA, borderCls: 'border-green-600/40' },
          { label: 'Period B', period: periodB, setPeriod: setPeriodB, borderCls: 'border-blue-600/40' },
        ].map(({ label, period, setPeriod, borderCls }) => (
          <div key={label} className={`card border ${borderCls}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-white">{label}</span>
              <select className="input w-24 text-sm py-1"
                value={period.year}
                onChange={e => setPeriod(p => ({ ...p, year: parseInt(e.target.value) }))}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((m, i) => (
                <button key={m}
                  onClick={() => toggleMonth(period, setPeriod, i)}
                  className={`py-1.5 rounded-md text-xs font-medium border transition-all ${
                    period.months.includes(i)
                      ? label === 'Period A'
                        ? 'bg-green-900/40 text-green-300 border-green-700/60'
                        : 'bg-blue-900/40 text-blue-300 border-blue-700/60'
                      : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {period.months.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {period.months.map(m => MONTHS[m]).join(', ')} {period.year}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Metric toggle + run button */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
          {[['count','Replacements'],['cost',`Cost (${activeCurrency})`]].map(([val, lbl]) => (
            <button key={val} onClick={() => setMetric(val)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                metric === val ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}>
              {lbl}
            </button>
          ))}
        </div>
        <button onClick={runComparison}
          disabled={loading || periodA.months.length === 0 || periodB.months.length === 0}
          className="btn-primary px-6 disabled:opacity-50">
          {loading ? 'Running...' : 'Run Comparison'}
        </button>
      </div>

      {/* Results */}
      {ran && chartData && tableData.length > 0 && (
        <>
          {trendText && (
            <div className="card bg-gray-800/60 py-3">
              <p className="text-gray-300 text-sm">{trendText}</p>
            </div>
          )}

          {/* Bar chart */}
          <div className="card">
            <h3 className="text-base font-semibold text-white mb-4">
              {metric === 'count' ? 'Replacements' : `Cost (${activeCurrency})`} by Month
            </h3>
            <div style={{ height: 280 }}>
              <Bar data={chartData} options={CHART_OPTS} />
            </div>
          </div>

          {/* Summary table */}
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-base font-semibold text-white">Summary</h3>
              <div className="flex gap-2">
                <button onClick={exportResultsExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                  <Download size={14} /> Excel
                </button>
                <button onClick={exportResultsPdf} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-800">
                    <th className="pb-2 pr-4">Month</th>
                    <th className="pb-2 pr-4 text-green-400">Period A ({periodA.year})</th>
                    <th className="pb-2 pr-4 text-blue-400">Period B ({periodB.year})</th>
                    <th className="pb-2 pr-4">Difference</th>
                    <th className="pb-2">% Change</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map(r => (
                    <tr key={r.month} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="py-2 pr-4 text-white font-medium">{r.month}</td>
                      <td className="py-2 pr-4 text-gray-300">{r.a.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-gray-300">{r.b.toLocaleString()}</td>
                      <td className={`py-2 pr-4 font-semibold ${r.diff > 0 ? 'text-red-400' : r.diff < 0 ? 'text-green-400' : 'text-gray-400'}`}>
                        {r.diff > 0 ? '+' : ''}{r.diff.toLocaleString()}
                      </td>
                      <td className={`py-2 font-semibold ${r.pct > 0 ? 'text-red-400' : r.pct < 0 ? 'text-green-400' : 'text-gray-400'}`}>
                        {r.pct > 0 ? '+' : ''}{r.pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {ran && (!chartData || tableData.length === 0) && (
        <div className="card text-center py-10">
          <GitCompare size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No data found for the selected periods</p>
        </div>
      )}
    </div>
  )
}
