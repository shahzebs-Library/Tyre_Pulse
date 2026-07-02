import { useState, useMemo } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import {
  GitCompare, Download, FileText, TrendingUp, TrendingDown, Minus,
  ArrowUpRight, ArrowDownRight, BarChart2, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const now    = new Date()
const YEARS  = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 10, padding: 12 } },
    tooltip: { backgroundColor: 'var(--panel-2)', titlecolor:'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1, padding: 10 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#374151' } },
  },
}

const DIMENSION_OPTS = [
  { value: 'overall',  label: 'Overall'    },
  { value: 'site',     label: 'By Site'    },
  { value: 'brand',    label: 'By Brand'   },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function pctDiff(a, b) {
  if (a === 0) return b > 0 ? 100 : 0
  return Math.round(((b - a) / a) * 100)
}

function DeltaBadge({ diff, pct, isGoodWhenDown = true }) {
  if (diff === 0) return <span className="text-gray-500 font-medium">-</span>
  const improve = isGoodWhenDown ? diff < 0 : diff > 0
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold text-xs ${improve ? 'text-green-400' : 'text-red-400'}`}>
      <Icon size={12} />
      {diff > 0 ? '+' : ''}{pct}%
    </span>
  )
}

function PeriodSummaryCard({ label, total, metric, currency, colorClass }) {
  const formatted = metric === 'cost' ? formatCurrencyCompact(total, currency) : total.toLocaleString()
  return (
    <div className={`flex-1 min-w-[150px] p-4 rounded-xl border ${colorClass} card`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-0.5">{formatted}</p>
      <p className="text-xs text-gray-500 mt-0.5">{metric === 'cost' ? 'total cost' : 'replacements'}</p>
    </div>
  )
}

// ── Period Picker ──────────────────────────────────────────────────────────────
function PeriodPicker({ label, period, setPeriod, accentBg, accentText, accentBorder }) {
  function toggleMonth(m) {
    setPeriod(p => ({
      ...p,
      months: p.months.includes(m)
        ? p.months.filter(x => x !== m)
        : [...p.months, m].sort((a, b) => a - b),
    }))
  }

  return (
    <div className={`card border ${accentBorder}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`font-semibold text-sm ${accentText}`}>{label}</span>
        <select
          className="input w-24 text-sm py-1"
          value={period.year}
          onChange={e => setPeriod(p => ({ ...p, year: parseInt(e.target.value) }))}
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {MONTHS.map((m, i) => (
          <button key={m}
            onClick={() => toggleMonth(i)}
            className={`py-1.5 rounded-md text-xs font-medium border transition-all ${
              period.months.includes(i)
                ? `${accentBg} ${accentText} ${accentBorder}`
                : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
            }`}
          >{m}</button>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-500">
          {period.months.length > 0
            ? period.months.map(m => MONTHS[m]).join(', ') + ' ' + period.year
            : 'No months selected'}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setPeriod(p => ({ ...p, months: [0,1,2,3,4,5,6,7,8,9,10,11] }))}
            className="text-xs text-gray-500 hover:text-white transition-colors">All</button>
          <button onClick={() => setPeriod(p => ({ ...p, months: [] }))}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors">Clear</button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Comparison() {
  const { activeCurrency } = useSettings()

  const [periodA, setPeriodA] = useState({ months: [0,1,2,3,4,5,6,7,8,9,10,11], year: now.getFullYear() - 1 })
  const [periodB, setPeriodB] = useState({ months: [0,1,2,3,4,5,6,7,8,9,10,11], year: now.getFullYear() })
  const [metric, setMetric]   = useState('count')
  const [dimension, setDimension] = useState('overall')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [ran, setRan]         = useState(false)

  async function runComparison() {
    if (periodA.months.length === 0 || periodB.months.length === 0) return
    setLoading(true)
    const minYear = Math.min(periodA.year, periodB.year)
    const maxYear = Math.max(periodA.year, periodB.year)
    const { data } = await fetchAllPages((from, to) => supabase
      .from('tyre_records')
      .select('issue_date, cost:cost_per_tyre, site, brand')
      .gte('issue_date', `${minYear}-01-01`)
      .lte('issue_date', `${maxYear}-12-31`)
      .range(from, to))
    setRecords(data ?? [])
    setRan(true)
    setLoading(false)
  }

  // ── Computed ───────────────────────────────────────────────────────────────────
  const { chartData, tableRows, totals, insight } = useMemo(() => {
    if (!ran) return { chartData: null, tableRows: [], totals: null, insight: '' }

    const getVal = (obj) => metric === 'cost' ? Math.round(obj.cost) : obj.count

    const makeEmpty = (keys) => Object.fromEntries(keys.map(k => [k, { count: 0, cost: 0 }]))

    if (dimension === 'overall') {
      const allMonths = [...new Set([...periodA.months, ...periodB.months])].sort((a, b) => a - b)
      const bktA = makeEmpty(allMonths)
      const bktB = makeEmpty(allMonths)

      records.forEach(r => {
        if (!r.issue_date) return
        const d = new Date(r.issue_date)
        const yr = d.getFullYear(), mo = d.getMonth()
        const val = parseFloat(r.cost) || 0
        if (yr === periodA.year && bktA[mo] !== undefined) { bktA[mo].count++; bktA[mo].cost += val }
        if (yr === periodB.year && bktB[mo] !== undefined) { bktB[mo].count++; bktB[mo].cost += val }
      })

      const aVals = allMonths.map(m => getVal(bktA[m]))
      const bVals = allMonths.map(m => getVal(bktB[m]))

      const totalA = aVals.reduce((s, v) => s + v, 0)
      const totalB = bVals.reduce((s, v) => s + v, 0)
      const diff   = totalB - totalA
      const pct    = pctDiff(totalA, totalB)
      const label  = metric === 'count' ? 'replacements' : 'spend'
      const insight = totalA > 0
        ? `Period B has ${Math.abs(pct)}% ${diff >= 0 ? 'more' : 'less'} ${label} vs Period A (${diff >= 0 ? '+' : ''}${metric === 'cost' ? formatCurrencyCompact(diff, activeCurrency) : diff.toLocaleString()} ${diff >= 0 ? '▲' : '▼'})`
        : ''

      const tableRows = allMonths.map((m, i) => ({
        label: MONTHS[m],
        a: aVals[i], b: bVals[i],
        diff: bVals[i] - aVals[i],
        pct: pctDiff(aVals[i], bVals[i]),
      }))

      // Totals row
      const costA = allMonths.reduce((s, m) => s + bktA[m].cost, 0)
      const costB = allMonths.reduce((s, m) => s + bktB[m].cost, 0)

      const chartData = {
        labels: allMonths.map(m => MONTHS[m]),
        datasets: [
          { label: `Period A - ${periodA.year}`, data: aVals, backgroundColor: 'rgba(22,163,74,0.65)', borderColor: '#16a34a', borderWidth: 1, borderRadius: 4 },
          { label: `Period B - ${periodB.year}`, data: bVals, backgroundColor: 'rgba(59,130,246,0.65)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4 },
        ],
      }

      return {
        chartData,
        tableRows,
        totals: { a: totalA, b: totalB, diff, pct, costA, costB },
        insight,
      }
    }

    // By Site or By Brand
    const dimKey = dimension === 'site' ? 'site' : 'brand'
    const dimSet = new Set()
    records.forEach(r => { if (r[dimKey]) dimSet.add(r[dimKey]) })
    const dims = [...dimSet].sort()

    const bktA = makeEmpty(dims)
    const bktB = makeEmpty(dims)

    records.forEach(r => {
      if (!r.issue_date) return
      const d = new Date(r.issue_date)
      const yr = d.getFullYear(), mo = d.getMonth()
      const dim = r[dimKey] ?? '(unknown)'
      const val = parseFloat(r.cost) || 0
      if (yr === periodA.year && periodA.months.includes(mo) && bktA[dim] !== undefined) { bktA[dim].count++; bktA[dim].cost += val }
      if (yr === periodB.year && periodB.months.includes(mo) && bktB[dim] !== undefined) { bktB[dim].count++; bktB[dim].cost += val }
    })

    const aVals = dims.map(d => getVal(bktA[d]))
    const bVals = dims.map(d => getVal(bktB[d]))

    const tableRows = dims.map((d, i) => ({
      label: d,
      a: aVals[i], b: bVals[i],
      diff: bVals[i] - aVals[i],
      pct: pctDiff(aVals[i], bVals[i]),
    })).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))

    const totalA = aVals.reduce((s, v) => s + v, 0)
    const totalB = bVals.reduce((s, v) => s + v, 0)
    const diff   = totalB - totalA
    const pct    = pctDiff(totalA, totalB)

    const chartData = {
      labels: dims.slice(0, 12),
      datasets: [
        { label: `Period A - ${periodA.year}`, data: aVals.slice(0, 12), backgroundColor: 'rgba(22,163,74,0.65)', borderColor: '#16a34a', borderWidth: 1, borderRadius: 4 },
        { label: `Period B - ${periodB.year}`, data: bVals.slice(0, 12), backgroundColor: 'rgba(59,130,246,0.65)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4 },
      ],
    }

    return {
      chartData,
      tableRows,
      totals: { a: totalA, b: totalB, diff, pct },
      insight: totalA > 0 ? `Across ${dims.length} ${dimKey}s, Period B shows ${Math.abs(pct)}% ${diff >= 0 ? 'increase' : 'decrease'} overall` : '',
    }
  }, [ran, records, periodA, periodB, metric, dimension, activeCurrency])

  // ── Exports ────────────────────────────────────────────────────────────────────
  function doExcelExport() {
    exportToExcel(
      tableRows.map(r => ({ label: r.label, period_a: r.a, period_b: r.b, difference: r.diff, pct_change: `${r.pct > 0 ? '+' : ''}${r.pct}%` })),
      ['label','period_a','period_b','difference','pct_change'],
      ['Month / Dimension','Period A','Period B','Difference','% Change'],
      'TyrePulse_Comparison'
    )
  }

  function doPdfExport() {
    exportToPdf(
      tableRows.map(r => ({ label: r.label, period_a: r.a, period_b: r.b, difference: `${r.diff > 0 ? '+' : ''}${r.diff}`, pct_change: `${r.pct > 0 ? '+' : ''}${r.pct}%` })),
      [
        { key: 'label',      header: dimension === 'overall' ? 'Month' : dimension === 'site' ? 'Site' : 'Brand' },
        { key: 'period_a',   header: `Period A (${periodA.year})` },
        { key: 'period_b',   header: `Period B (${periodB.year})` },
        { key: 'difference', header: 'Difference' },
        { key: 'pct_change', header: '% Change' },
      ],
      'Period Comparison Report',
      'TyrePulse_Comparison',
      'landscape'
    )
  }

  const canRun = periodA.months.length > 0 && periodB.months.length > 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Period Comparison"
        subtitle="Compare tyre replacements or costs across two time periods"
        icon={GitCompare}
      />

      {/* Period selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PeriodPicker
          label="Period A"
          period={periodA} setPeriod={setPeriodA}
          accentBg="bg-green-900/40" accentText="text-green-300" accentBorder="border-green-700/50"
        />
        <PeriodPicker
          label="Period B"
          period={periodB} setPeriod={setPeriodB}
          accentBg="bg-blue-900/40" accentText="text-blue-300" accentBorder="border-blue-700/50"
        />
      </div>

      {/* Options + run */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Metric */}
        <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
          {[['count','Replacements'],['cost',`Cost (${activeCurrency})`]].map(([val, lbl]) => (
            <button key={val} onClick={() => setMetric(val)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                metric === val ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
            >{lbl}</button>
          ))}
        </div>

        {/* Dimension */}
        <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
          {DIMENSION_OPTS.map(({ value, label }) => (
            <button key={value} onClick={() => setDimension(value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                dimension === value ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
            >{label}</button>
          ))}
        </div>

        <button
          onClick={runComparison}
          disabled={loading || !canRun}
          className="btn-primary px-6 flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Running...' : ran ? 'Re-run' : 'Run Comparison'}
        </button>

        {!canRun && (
          <p className="text-xs text-amber-500">Select at least one month in each period</p>
        )}
      </div>

      {/* Results */}
      {ran && chartData && tableRows.length > 0 && (
        <>
          {/* Summary KPIs */}
          {totals && (
            <div className="flex gap-3 flex-wrap">
              <PeriodSummaryCard
                label={`Period A - ${periodA.year}`}
                total={totals.a} metric={metric} currency={activeCurrency}
                colorClass="border-green-700/40"
              />
              <PeriodSummaryCard
                label={`Period B - ${periodB.year}`}
                total={totals.b} metric={metric} currency={activeCurrency}
                colorClass="border-blue-700/40"
              />
              <div className="flex-1 min-w-[150px] p-4 rounded-xl border card">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Change</p>
                <p className={`text-2xl font-bold mt-0.5 ${totals.diff === 0 ? 'text-gray-500' : totals.diff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {totals.diff > 0 ? '+' : ''}{metric === 'cost' ? formatCurrencyCompact(totals.diff, activeCurrency) : totals.diff.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{Math.abs(totals.pct)}% {totals.diff >= 0 ? 'increase' : 'decrease'}</p>
              </div>
            </div>
          )}

          {/* Trend insight */}
          {insight && (
            <div className="card bg-gray-800/40 py-3 px-4 flex items-center gap-3">
              {totals?.diff < 0 ? <TrendingDown size={16} className="text-green-400 flex-shrink-0" /> : <TrendingUp size={16} className="text-red-400 flex-shrink-0" />}
              <p className="text-sm text-gray-300">{insight}</p>
            </div>
          )}

          {/* Bar chart */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 size={15} className="text-blue-400" />
              <h3 className="text-base font-semibold text-white">
                {metric === 'count' ? 'Replacements' : `Cost (${activeCurrency})`}
                {dimension !== 'overall' ? ` by ${dimension === 'site' ? 'Site' : 'Brand'}` : ' by Month'}
              </h3>
            </div>
            <div style={{ height: 300 }}>
              <Bar data={chartData} options={CHART_OPTS} />
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">
                {dimension === 'overall' ? 'Monthly Breakdown' : dimension === 'site' ? 'Site Breakdown' : 'Brand Breakdown'}
                <span className="text-gray-500 font-normal ml-2">{tableRows.length} rows</span>
              </h3>
              <div className="flex gap-2">
                <button onClick={doExcelExport} className="btn-secondary flex items-center gap-1.5 text-xs px-2.5 py-1.5">
                  <Download size={12} /> Excel
                </button>
                <button onClick={doPdfExport} className="btn-secondary flex items-center gap-1.5 text-xs px-2.5 py-1.5">
                  <FileText size={12} /> PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50">
                  <tr className="text-left text-gray-400 text-xs">
                    <th className="px-4 py-2.5">{dimension === 'overall' ? 'Month' : dimension === 'site' ? 'Site' : 'Brand'}</th>
                    <th className="px-3 py-2.5 text-green-400">Period A ({periodA.year})</th>
                    <th className="px-3 py-2.5 text-blue-400">Period B ({periodB.year})</th>
                    <th className="px-3 py-2.5">Difference</th>
                    <th className="px-3 py-2.5">% Change</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, idx) => (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-2 text-white font-medium">{r.label}</td>
                      <td className="px-3 py-2 text-gray-300">
                        {metric === 'cost' ? formatCurrencyCompact(r.a, activeCurrency) : r.a.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-300">
                        {metric === 'cost' ? formatCurrencyCompact(r.b, activeCurrency) : r.b.toLocaleString()}
                      </td>
                      <td className={`px-3 py-2 font-semibold ${r.diff > 0 ? 'text-red-400' : r.diff < 0 ? 'text-green-400' : 'text-gray-500'}`}>
                        {r.diff > 0 ? '+' : ''}{metric === 'cost' ? formatCurrencyCompact(r.diff, activeCurrency) : r.diff.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <DeltaBadge diff={r.diff} pct={Math.abs(r.pct)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-gray-800/60 font-semibold text-sm border-t border-gray-700">
                    <tr>
                      <td className="px-4 py-2.5 text-white">Total</td>
                      <td className="px-3 py-2.5 text-green-300">
                        {metric === 'cost' ? formatCurrencyCompact(totals.a, activeCurrency) : totals.a.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-blue-300">
                        {metric === 'cost' ? formatCurrencyCompact(totals.b, activeCurrency) : totals.b.toLocaleString()}
                      </td>
                      <td className={`px-3 py-2.5 ${totals.diff > 0 ? 'text-red-400' : totals.diff < 0 ? 'text-green-400' : 'text-gray-500'}`}>
                        {totals.diff > 0 ? '+' : ''}{metric === 'cost' ? formatCurrencyCompact(totals.diff, activeCurrency) : totals.diff.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5">
                        <DeltaBadge diff={totals.diff} pct={Math.abs(totals.pct)} />
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {ran && (!chartData || tableRows.length === 0) && (
        <div className="card text-center py-14">
          <GitCompare size={36} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No data found for the selected periods</p>
          <p className="text-gray-600 text-sm mt-1">Try selecting different years or months</p>
        </div>
      )}

      {!ran && (
        <div className="card text-center py-14 bg-gray-800/20">
          <GitCompare size={36} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Configure periods above and run the comparison</p>
          <p className="text-gray-600 text-sm mt-1">Select months for Period A and Period B, then click Run</p>
        </div>
      )}
    </div>
  )
}
