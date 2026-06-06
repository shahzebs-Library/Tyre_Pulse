import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  bucketByMonth, forecastMonthly, linearRegression,
  computeMonthlyKpiActuals, sum,
} from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { Download, FileText } from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Title, Tooltip, Legend)

const DEFAULT_TARGETS = {
  max_monthly_cost:   150000,
  max_high_risk_pct:  20,
  min_records_month:  10,
  max_overdue_actions: 5,
  max_avg_cost_tyre:   2000,
}

const KPI_LABELS = {
  max_monthly_cost:   { label: 'Max Monthly Cost (SAR)', unit: 'SAR', invert: true },
  max_high_risk_pct:  { label: 'Max High-Risk %',        unit: '%',   invert: true },
  min_records_month:  { label: 'Min Records / Month',    unit: '',    invert: false },
  max_overdue_actions:{ label: 'Max Overdue Actions',    unit: '',    invert: true },
  max_avg_cost_tyre:  { label: 'Max Avg Cost / Tyre',   unit: 'SAR', invert: true },
}

export default function KpiScorecard() {
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]   = useState([])
  const [actions, setActions]   = useState([])
  const [targets, setTargets]   = useState(DEFAULT_TARGETS)
  const [dbTargets, setDbTargets] = useState([])
  const [editing, setEditing]   = useState(false)
  const [draftTargets, setDraftTargets] = useState(DEFAULT_TARGETS)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [countryChip, setCountryChip] = useState('All')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const cf = activeCountry !== 'All' ? activeCountry : null
      const flt = q => cf ? q.eq('country', cf) : q
      const [r, a, t] = await Promise.all([
        flt(supabase.from('tyre_records').select('id,issue_date,risk_level,cost_per_tyre,qty,created_at,country').order('issue_date')),
        flt(supabase.from('corrective_actions').select('id,due_date,status,country').neq('status', 'Closed')),
        supabase.from('kpi_targets').select('*').eq('year', yearFilter),
      ])
      setRecords(r.data || [])
      setActions(a.data || [])

      const merged = { ...DEFAULT_TARGETS }
      ;(t.data || []).forEach(row => {
        if (merged[row.metric] !== undefined) merged[row.metric] = row.target_value
      })
      setTargets(merged)
      setDraftTargets(merged)
      setDbTargets(t.data || [])
      setLoading(false)
    }
    load()
  }, [activeCountry, yearFilter])

  // Build last 12 months axis
  const months = useMemo(() => {
    const result = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return result
  }, [])

  const filteredRecords = useMemo(() =>
    countryChip === 'All' ? records : records.filter(r => r.country === countryChip),
    [records, countryChip]
  )

  const filteredActions = useMemo(() =>
    countryChip === 'All' ? actions : actions.filter(a => a.country === countryChip),
    [actions, countryChip]
  )

  const actuals = useMemo(() =>
    months.map(m => computeMonthlyKpiActuals(filteredRecords, filteredActions, m, appSettings.cost_per_tyre)),
    [filteredRecords, filteredActions, months, appSettings.cost_per_tyre]
  )

  // Cost trend with forecasts
  const costTrend = useMemo(() => {
    const pts = actuals.map((a, i) => [i, a.totalCost])
    const reg = pts.length >= 2 ? linearRegression(pts) : null
    const future3 = reg
      ? [1, 2, 3].map(f => ({ month: 'F+' + f, value: Math.max(0, Math.round(reg.predict(pts.length - 1 + f))), isForecast: true }))
      : []
    return { reg, future3 }
  }, [actuals])

  const costChartData = useMemo(() => {
    const all = [...actuals.map(a => ({ month: a.month, value: a.totalCost, isForecast: false })), ...costTrend.future3]
    return {
      labels: all.map(d => d.month),
      datasets: [
        {
          label: 'Actual Cost',
          data: all.map(d => d.isForecast ? null : d.value),
          borderColor: 'rgba(59,130,246,1)',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true, tension: 0.4, spanGaps: true,
        },
        {
          label: 'Target Ceiling',
          data: all.map(() => targets.max_monthly_cost),
          borderColor: 'rgba(239,68,68,0.6)',
          borderDash: [6, 3], fill: false, pointRadius: 0,
        },
        {
          label: 'Forecast',
          data: all.map(d => d.isForecast ? d.value : null),
          borderColor: 'rgba(245,158,11,1)',
          borderDash: [4, 2], fill: false, tension: 0.4, spanGaps: true,
        },
        costTrend.reg && {
          label: 'Trend Line',
          data: actuals.map((_, i) => Math.max(0, Math.round(costTrend.reg.predict(i)))),
          borderColor: 'rgba(107,114,128,0.4)',
          borderDash: [2, 4], fill: false, pointRadius: 0,
        },
      ].filter(Boolean),
    }
  }, [actuals, targets, costTrend])

  const highRiskChartData = useMemo(() => ({
    labels: months,
    datasets: [
      {
        label: 'High Risk %',
        data: actuals.map(a => parseFloat(a.highRiskPct.toFixed(1))),
        borderColor: 'rgba(239,68,68,1)',
        backgroundColor: 'rgba(239,68,68,0.1)',
        fill: true, tension: 0.4,
      },
      {
        label: 'Target Max %',
        data: months.map(() => targets.max_high_risk_pct),
        borderColor: 'rgba(245,158,11,0.6)',
        borderDash: [6, 3], fill: false, pointRadius: 0,
      },
    ],
  }), [actuals, months, targets])

  const chartOpts = (title) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
      title: { display: false },
    },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  })

  async function saveTargets() {
    setSaving(true)
    const year  = new Date().getFullYear()
    const upserts = Object.entries(draftTargets).map(([metric, target_value]) => ({
      metric, target_value, year, region: 'KSA',
      created_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }))
    await supabase.from('kpi_targets').upsert(upserts, { onConflict: 'metric,year,month,site' })
    setTargets(draftTargets)
    setEditing(false)
    setSaving(false)
  }

  const currentMonth = actuals[actuals.length - 1]
  const prevMonth    = actuals[actuals.length - 2]

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading KPI data…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">KPI Scorecard</h1>
          <p className="text-gray-400 text-sm mt-1">Monthly targets vs actuals with regression forecasting</p>
        </div>
        <div className="flex gap-2">
          {(() => {
            const KPI_COLS = [
              { key: 'month', header: 'Month' },
              { key: 'count', header: 'Records' },
              { key: 'totalCost', header: 'Total Cost' },
              { key: 'highRiskPct', header: 'High Risk %' },
              { key: 'overdueActions', header: 'Overdue Actions' },
            ]
            return (
              <>
                <button
                  onClick={() => exportToExcel(actuals, KPI_COLS.map(c => c.key), KPI_COLS.map(c => c.header), 'TyrePulse_KpiScorecard')}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  <Download size={14} /> Excel
                </button>
                <button
                  onClick={() => exportToPdf(actuals, KPI_COLS, 'KPI Scorecard · Monthly Actuals', 'TyrePulse_KpiScorecard', 'landscape')}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  <FileText size={14} /> PDF
                </button>
              </>
            )
          })()}
          {!editing
          ? <button onClick={() => setEditing(true)} className="btn-secondary text-sm">Edit Targets</button>
          : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setDraftTargets(targets) }} className="btn-secondary text-sm">Cancel</button>
              <button onClick={saveTargets} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Targets'}
              </button>
            </div>
          )
        }
        </div>
      </div>

      {/* Filter row: year + country chips */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Year:</span>
          <select
            className="input w-28 text-sm"
            value={yearFilter}
            onChange={e => setYearFilter(Number(e.target.value))}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {['All', ...COUNTRIES].map(c => (
            <button
              key={c}
              onClick={() => setCountryChip(c)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                countryChip === c
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Target editor */}
      {editing && (
        <div className="card border border-yellow-700/50">
          <p className="text-sm font-medium text-yellow-400 mb-4">Configure KPI Targets</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(KPI_LABELS).map(([key, { label, unit }]) => (
              <div key={key}>
                <label className="label text-xs">{label} {unit && `(${unit})`}</label>
                <input
                  type="number"
                  className="input"
                  value={draftTargets[key] ?? ''}
                  onChange={e => setDraftTargets(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current month scorecard */}
      {currentMonth && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard
            label="Monthly Cost"
            actual={currentMonth.totalCost}
            target={targets.max_monthly_cost}
            format={v => `${activeCurrency} ${v.toLocaleString('en-SA', { maximumFractionDigits: 0 })}`}
            invert higherIsBad
            prev={prevMonth?.totalCost}
          />
          <KpiCard
            label="High Risk %"
            actual={parseFloat(currentMonth.highRiskPct.toFixed(1))}
            target={targets.max_high_risk_pct}
            format={v => `${v.toFixed(1)}%`}
            invert higherIsBad
            prev={prevMonth ? parseFloat(prevMonth.highRiskPct.toFixed(1)) : undefined}
          />
          <KpiCard
            label="Record Count"
            actual={currentMonth.count}
            target={targets.min_records_month}
            format={v => v.toString()}
            invert={false}
            prev={prevMonth?.count}
          />
          <KpiCard
            label="Overdue Actions"
            actual={currentMonth.overdueActions}
            target={targets.max_overdue_actions}
            format={v => v.toString()}
            invert higherIsBad
            prev={prevMonth?.overdueActions}
          />
          <KpiCard
            label="Avg Cost / Tyre"
            actual={currentMonth.count ? Math.round(currentMonth.totalCost / currentMonth.count) : 0}
            target={targets.max_avg_cost_tyre}
            format={v => `${activeCurrency} ${v.toLocaleString()}`}
            invert higherIsBad
            prev={prevMonth && prevMonth.count ? Math.round(prevMonth.totalCost / prevMonth.count) : undefined}
          />
          {costTrend.reg && (
            <div className="card">
              <p className="text-xs text-gray-400 mb-1">Forecast (next month)</p>
              <p className="text-xl font-bold text-yellow-400">
                {activeCurrency} {Math.max(0, Math.round(costTrend.reg.predict(months.length))).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                R² = {costTrend.reg.r2.toFixed(2)} · slope {costTrend.reg.slope > 0 ? '+' : ''}{Math.round(costTrend.reg.slope).toLocaleString()}/mo
              </p>
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="space-y-6">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Monthly Cost vs Target + Forecast</h3>
          <div style={{ height: 320 }}>
            <Line data={costChartData} options={chartOpts('Cost')} />
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">High-Risk % vs Target</h3>
          <div style={{ height: 260 }}>
            <Line data={highRiskChartData} options={chartOpts('Risk')} />
          </div>
        </div>
      </div>

      {/* Monthly table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Monthly Actuals vs Targets</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Month</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">vs Target</th>
              <th className="pb-2 pr-4 text-right">High Risk %</th>
              <th className="pb-2 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {actuals.map(a => {
              const overBudget = a.totalCost > targets.max_monthly_cost
              const overRisk   = a.highRiskPct > targets.max_high_risk_pct
              return (
                <tr key={a.month} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4 text-gray-300">{a.month}</td>
                  <td className="py-2 pr-4 text-gray-300 text-right">{a.count}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className={overBudget ? 'text-red-400 font-medium' : 'text-gray-300'}>
                      {activeCurrency} {a.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {a.count === 0
                      ? <span className="text-gray-600">—</span>
                      : <span className={`text-xs px-2 py-0.5 rounded-full ${overBudget ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
                          {overBudget ? `+${activeCurrency} ${(a.totalCost - targets.max_monthly_cost).toLocaleString('en-SA', { maximumFractionDigits: 0 })}` : 'On target'}
                        </span>
                    }
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className={overRisk && a.count > 0 ? 'text-red-400' : 'text-gray-300'}>
                      {a.count > 0 ? `${a.highRiskPct.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {a.overdueActions > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-900/40 text-orange-400">{a.overdueActions}</span>
                      : <span className="text-gray-600">0</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KpiCard({ label, actual, target, format, invert, higherIsBad, prev }) {
  const passing = invert ? actual <= target : actual >= target
  const delta   = prev !== undefined ? actual - prev : null

  return (
    <div className={`card border ${passing ? 'border-green-700/40' : 'border-red-700/50'}`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-xl font-bold mt-1 ${passing ? 'text-green-400' : 'text-red-400'}`}>
        {format(actual)}
      </p>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-500">
          Target: {format(target)}
        </p>
        <span className={`text-xs px-1.5 py-0.5 rounded ${passing ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
          {passing ? 'PASS' : 'FAIL'}
        </span>
      </div>
      {delta !== null && (
        <p className={`text-xs mt-1 ${delta === 0 ? 'text-gray-500' : (higherIsBad ? delta > 0 : delta < 0) ? 'text-red-400' : 'text-green-400'}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {format(Math.abs(delta))} vs prev month
        </p>
      )}
    </div>
  )
}
