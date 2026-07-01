import { useState, useEffect, useMemo, useCallback } from 'react'
import * as kpiTargets from '../lib/api/kpiTargets'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  bucketByMonth, forecastMonthly, linearRegression,
  computeMonthlyKpiActuals, sum,
} from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { Download, FileText, AlertTriangle, ToggleLeft, ToggleRight, Target } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
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
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]         = useState([])
  const [actions, setActions]         = useState([])
  const [targets, setTargets]         = useState(DEFAULT_TARGETS)
  const [dbTargets, setDbTargets]     = useState([])
  const [editing, setEditing]         = useState(false)
  const [draftTargets, setDraftTargets] = useState(DEFAULT_TARGETS)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [yearFilter, setYearFilter]   = useState(new Date().getFullYear())
  const [countryChip, setCountryChip] = useState('All')
  const [showYoY, setShowYoY]         = useState(false)
  const [yoyRecords, setYoyRecords]   = useState([])
  const [yoyLoading, setYoyLoading]   = useState(false)
  const [activeMainTab, setActiveMainTab] = useState('overview')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [r, a, t] = await Promise.all([
        kpiTargets.listKpiTyreRecords({ country: activeCountry }),
        kpiTargets.listOpenCorrectiveActions({ country: activeCountry }),
        kpiTargets.listKpiTargets({ year: yearFilter }),
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

  // Same 12-month window one year prior
  const yoyMonths = useMemo(() => months.map(m => {
    const [y, mo] = m.split('-')
    return `${Number(y) - 1}-${mo}`
  }), [months])

  const filteredRecords = useMemo(() =>
    countryChip === 'All' ? records : records.filter(r => r.country === countryChip),
    [records, countryChip]
  )

  const filteredActions = useMemo(() =>
    countryChip === 'All' ? actions : actions.filter(a => a.country === countryChip),
    [actions, countryChip]
  )

  const actuals = useMemo(() =>
    months.map(m => computeMonthlyKpiActuals(filteredRecords, filteredActions, m)),
    [filteredRecords, filteredActions, months]
  )

  // YoY fetch
  useEffect(() => {
    if (!showYoY) return
    async function fetchYoY() {
      setYoyLoading(true)
      const yoyStart = yoyMonths[0] + '-01'
      const lastYoyMonth = yoyMonths[yoyMonths.length - 1]
      const [y, mo] = lastYoyMonth.split('-')
      const lastDay = new Date(Number(y), Number(mo), 0).getDate()
      const yoyEnd = `${lastYoyMonth}-${lastDay}`
      const { data } = await kpiTargets.listKpiTyreRecordsInRange({
        start: yoyStart, end: yoyEnd, country: activeCountry,
      })
      setYoyRecords(data || [])
      setYoyLoading(false)
    }
    fetchYoY()
  }, [showYoY, yoyMonths, activeCountry])

  const filteredYoyRecords = useMemo(() =>
    countryChip === 'All' ? yoyRecords : yoyRecords.filter(r => r.country === countryChip),
    [yoyRecords, countryChip]
  )

  // YoY actuals keyed by current-year month for easy lookup
  const yoyActualsMap = useMemo(() => {
    if (!showYoY) return {}
    const map = {}
    yoyMonths.forEach((yoyM, idx) => {
      const curM = months[idx]
      map[curM] = computeMonthlyKpiActuals(filteredYoyRecords, filteredActions, yoyM)
    })
    return map
  }, [showYoY, filteredYoyRecords, filteredActions, yoyMonths, months])

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
        showYoY && {
          label: 'LY Cost',
          data: months.map(m => yoyActualsMap[m]?.totalCost ?? null),
          borderColor: 'rgba(139,92,246,0.7)',
          borderDash: [3, 3], fill: false, tension: 0.4, spanGaps: true,
        },
      ].filter(Boolean),
    }
  }, [actuals, targets, costTrend, showYoY, yoyActualsMap, months])

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

  const chartOpts = () => ({
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
    const year = new Date().getFullYear()
    const upserts = Object.entries(draftTargets).map(([metric, target_value]) => ({
      metric, target_value, year, region: 'KSA',
      created_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }))
    await kpiTargets.upsertKpiTargets(upserts)
    setTargets(draftTargets)
    setEditing(false)
    setSaving(false)
  }

  const currentMonth = actuals[actuals.length - 1]
  const prevMonth    = actuals[actuals.length - 2]
  const currentMonthStr = months[months.length - 1]

  // Performance alerts: current-month metrics that exceed target by >20%
  const performanceAlerts = useMemo(() => {
    if (!currentMonth) return []
    const alerts = []
    const check = (key, actual, target, invert, label, fmt) => {
      if (!invert) return // only "higher is bad" metrics
      if (target <= 0) return
      const overage = (actual - target) / target
      if (overage > 0.20) {
        alerts.push({ key, label, overage, actual, target, fmt })
      }
    }
    const fmtCost  = v => `${activeCurrency} ${v.toLocaleString('en-SA', { maximumFractionDigits: 0 })}`
    const fmtPct   = v => `${v.toFixed(1)}%`
    const fmtNum   = v => v.toString()

    check('max_monthly_cost',    currentMonth.totalCost,     targets.max_monthly_cost,    true, 'Monthly Cost',    fmtCost)
    check('max_high_risk_pct',   currentMonth.highRiskPct,   targets.max_high_risk_pct,   true, 'High Risk %',     fmtPct)
    check('max_overdue_actions', currentMonth.overdueActions, targets.max_overdue_actions, true, 'Overdue Actions', fmtNum)
    const avgCost = currentMonth.count ? Math.round(currentMonth.totalCost / currentMonth.count) : 0
    check('max_avg_cost_tyre',   avgCost,                    targets.max_avg_cost_tyre,   true, 'Avg Cost/Tyre',   fmtCost)
    return alerts
  }, [currentMonth, targets, activeCurrency])

  // Site breakdown for current month
  const siteBreakdown = useMemo(() => {
    const siteMap = {}
    filteredRecords.forEach(r => {
      const site = r.site || 'Unknown'
      if (!siteMap[site]) siteMap[site] = []
      siteMap[site].push(r)
    })
    const overdueCount = filteredActions.filter(a => {
      if (!a.due_date || a.status === 'Closed') return false
      return new Date(a.due_date) < new Date()
    }).length

    return Object.entries(siteMap).map(([site, siteRecs]) => {
      const monthRecs = siteRecs.filter(r => r.issue_date && r.issue_date.startsWith(currentMonthStr))
      const totalCost = monthRecs.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)
      const count = monthRecs.length
      const highRisk = monthRecs.filter(r => r.risk_level === 'High').length
      const highRiskPct = count ? (highRisk / count) * 100 : 0
      const avgCostPerTyre = count ? totalCost / count : 0
      return { site, totalCost, count, highRiskPct, overdueActions: overdueCount, avgCostPerTyre }
    }).sort((a, b) => b.totalCost - a.totalCost)
  }, [filteredRecords, filteredActions, currentMonthStr])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading KPI data…</div>

  const KPI_COLS = [
    { key: 'month', header: 'Month' },
    { key: 'count', header: 'Records' },
    { key: 'totalCost', header: 'Total Cost' },
    { key: 'highRiskPct', header: 'High Risk %' },
    { key: 'overdueActions', header: 'Overdue Actions' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader
          title="KPI Scorecard"
          subtitle="Monthly targets vs actuals with regression forecasting"
          icon={Target}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* YoY toggle */}
          <button
            onClick={() => setShowYoY(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              showYoY
                ? 'bg-purple-900/40 border-purple-600 text-purple-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {showYoY ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            YoY Compare
            {yoyLoading && <span className="text-xs text-gray-500 ml-1">…</span>}
          </button>

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

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-800">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'sites',    label: 'By Site' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveMainTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeMainTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Performance alerts banner */}
      {performanceAlerts.length > 0 && (
        <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 sticky top-0 z-10 backdrop-blur-sm ${
          performanceAlerts.some(a => a.overage > 0.50)
            ? 'bg-red-950/80 border-red-700/60'
            : 'bg-amber-950/80 border-amber-700/60'
        }`}>
          <AlertTriangle
            size={18}
            className={performanceAlerts.some(a => a.overage > 0.50) ? 'text-red-400 mt-0.5 shrink-0' : 'text-amber-400 mt-0.5 shrink-0'}
          />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${performanceAlerts.some(a => a.overage > 0.50) ? 'text-red-300' : 'text-amber-300'}`}>
              {performanceAlerts.length} KPI metric{performanceAlerts.length > 1 ? 's' : ''} exceeding target by &gt;20% this month
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {performanceAlerts.map(alert => (
                <span key={alert.key} className="text-xs text-gray-300">
                  <span className={alert.overage > 0.50 ? 'text-red-400 font-medium' : 'text-amber-400 font-medium'}>
                    {alert.label}
                  </span>
                  {' '}— {alert.fmt(alert.actual)} vs target {alert.fmt(alert.target)}
                  {' '}
                  <span className={alert.overage > 0.50 ? 'text-red-400' : 'text-amber-400'}>
                    (+{(alert.overage * 100).toFixed(0)}% over)
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {/* ── OVERVIEW TAB ── */}
      {activeMainTab === 'overview' && (
        <>
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
                yoyValue={showYoY ? yoyActualsMap[currentMonthStr]?.totalCost : undefined}
                yoyFormat={v => `${activeCurrency} ${v.toLocaleString('en-SA', { maximumFractionDigits: 0 })}`}
              />
              <KpiCard
                label="High Risk %"
                actual={parseFloat(currentMonth.highRiskPct.toFixed(1))}
                target={targets.max_high_risk_pct}
                format={v => `${v.toFixed(1)}%`}
                invert higherIsBad
                prev={prevMonth ? parseFloat(prevMonth.highRiskPct.toFixed(1)) : undefined}
                yoyValue={showYoY ? (yoyActualsMap[currentMonthStr] ? parseFloat(yoyActualsMap[currentMonthStr].highRiskPct.toFixed(1)) : undefined) : undefined}
                yoyFormat={v => `${v.toFixed(1)}%`}
              />
              <KpiCard
                label="Record Count"
                actual={currentMonth.count}
                target={targets.min_records_month}
                format={v => v.toString()}
                invert={false}
                prev={prevMonth?.count}
                yoyValue={showYoY ? yoyActualsMap[currentMonthStr]?.count : undefined}
                yoyFormat={v => v.toString()}
              />
              <KpiCard
                label="Overdue Actions"
                actual={currentMonth.overdueActions}
                target={targets.max_overdue_actions}
                format={v => v.toString()}
                invert higherIsBad
                prev={prevMonth?.overdueActions}
                yoyValue={showYoY ? yoyActualsMap[currentMonthStr]?.overdueActions : undefined}
                yoyFormat={v => v.toString()}
              />
              <KpiCard
                label="Avg Cost / Tyre"
                actual={currentMonth.count ? Math.round(currentMonth.totalCost / currentMonth.count) : 0}
                target={targets.max_avg_cost_tyre}
                format={v => `${activeCurrency} ${v.toLocaleString()}`}
                invert higherIsBad
                prev={prevMonth && prevMonth.count ? Math.round(prevMonth.totalCost / prevMonth.count) : undefined}
                yoyValue={showYoY && yoyActualsMap[currentMonthStr]?.count
                  ? Math.round(yoyActualsMap[currentMonthStr].totalCost / yoyActualsMap[currentMonthStr].count)
                  : undefined}
                yoyFormat={v => `${activeCurrency} ${v.toLocaleString()}`}
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
              <h3 className="text-sm font-medium text-gray-400 mb-4">
                Monthly Cost vs Target + Forecast{showYoY ? ' · LY overlay' : ''}
              </h3>
              <div style={{ height: 320 }}>
                <Line data={costChartData} options={chartOpts()} />
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-gray-400 mb-4">High-Risk % vs Target</h3>
              <div style={{ height: 260 }}>
                <Line data={highRiskChartData} options={chartOpts()} />
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
                  {showYoY && <th className="pb-2 pr-4 text-right text-purple-400">LY Cost</th>}
                  <th className="pb-2 pr-4 text-right">vs Target</th>
                  <th className="pb-2 pr-4 text-right">High Risk %</th>
                  <th className="pb-2 text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {actuals.map(a => {
                  const overBudget = a.totalCost > targets.max_monthly_cost
                  const overRisk   = a.highRiskPct > targets.max_high_risk_pct
                  const lyData     = showYoY ? yoyActualsMap[a.month] : null
                  return (
                    <tr key={a.month} className="border-b border-gray-800/50">
                      <td className="py-2 pr-4 text-gray-300">{a.month}</td>
                      <td className="py-2 pr-4 text-gray-300 text-right">{a.count}</td>
                      <td className="py-2 pr-4 text-right">
                        <span className={overBudget ? 'text-red-400 font-medium' : 'text-gray-300'}>
                          {activeCurrency} {a.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      {showYoY && (
                        <td className="py-2 pr-4 text-right">
                          {lyData
                            ? (
                              <span className="text-gray-500 text-xs">
                                {activeCurrency} {lyData.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                                {lyData.totalCost > 0 && a.totalCost > 0 && (
                                  <span className={`ml-1 ${a.totalCost > lyData.totalCost ? 'text-red-400' : 'text-green-400'}`}>
                                    {a.totalCost > lyData.totalCost ? '▲' : '▼'}
                                    {Math.abs(((a.totalCost - lyData.totalCost) / lyData.totalCost) * 100).toFixed(0)}%
                                  </span>
                                )}
                              </span>
                            )
                            : <span className="text-gray-600 text-xs">—</span>
                          }
                        </td>
                      )}
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
        </>
      )}

      {/* ── BY SITE TAB ── */}
      {activeMainTab === 'sites' && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">
              Site Performance — {currentMonthStr} (sorted by total cost)
            </h3>
            <p className="text-xs text-gray-500">{siteBreakdown.length} site{siteBreakdown.length !== 1 ? 's' : ''}</p>
          </div>
          {siteBreakdown.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">No site data for {currentMonthStr}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="pb-2 pr-4">Site</th>
                  <th className="pb-2 pr-4 text-right">Monthly Cost</th>
                  <th className="pb-2 pr-4 text-right">High Risk %</th>
                  <th className="pb-2 pr-4 text-right">Records</th>
                  <th className="pb-2 pr-4 text-right">Overdue Actions</th>
                  <th className="pb-2 text-right">Avg Cost / Tyre</th>
                </tr>
              </thead>
              <tbody>
                {siteBreakdown.map(s => {
                  const costFail    = s.totalCost > targets.max_monthly_cost
                  const riskFail    = s.highRiskPct > targets.max_high_risk_pct
                  const countFail   = s.count < targets.min_records_month
                  const overdFail   = s.overdueActions > targets.max_overdue_actions
                  const avgFail     = s.avgCostPerTyre > targets.max_avg_cost_tyre

                  const cellCls = (fail) => fail
                    ? 'bg-red-900/20 text-red-400'
                    : 'bg-green-900/20 text-green-400'

                  return (
                    <tr key={s.site} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="py-2.5 pr-4 text-gray-200 font-medium">{s.site}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={`text-xs px-2 py-1 rounded ${cellCls(costFail)}`}>
                          {activeCurrency} {s.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={`text-xs px-2 py-1 rounded ${s.count > 0 ? cellCls(riskFail) : 'text-gray-500'}`}>
                          {s.count > 0 ? `${s.highRiskPct.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={`text-xs px-2 py-1 rounded ${cellCls(countFail)}`}>
                          {s.count}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={`text-xs px-2 py-1 rounded ${cellCls(overdFail)}`}>
                          {s.overdueActions}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={`text-xs px-2 py-1 rounded ${s.count > 0 ? cellCls(avgFail) : 'text-gray-500'}`}>
                          {s.count > 0
                            ? `${activeCurrency} ${Math.round(s.avgCostPerTyre).toLocaleString()}`
                            : '—'
                          }
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 text-gray-400 text-xs">
                  <td className="pt-2 pr-4 font-medium">Total</td>
                  <td className="pt-2 pr-4 text-right font-medium text-gray-300">
                    {activeCurrency} {siteBreakdown.reduce((s, r) => s + r.totalCost, 0).toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="pt-2 pr-4 text-right">—</td>
                  <td className="pt-2 pr-4 text-right font-medium text-gray-300">
                    {siteBreakdown.reduce((s, r) => s + r.count, 0)}
                  </td>
                  <td className="pt-2 pr-4 text-right">—</td>
                  <td className="pt-2 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, actual, target, format, invert, higherIsBad, prev, yoyValue, yoyFormat }) {
  const passing = invert ? actual <= target : actual >= target
  const delta   = prev !== undefined ? actual - prev : null

  const yoyDelta = yoyValue !== undefined ? actual - yoyValue : null
  const yoyPct   = yoyValue !== undefined && yoyValue !== 0
    ? ((actual - yoyValue) / Math.abs(yoyValue)) * 100
    : null

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
      {yoyDelta !== null && yoyPct !== null && (
        <p className="text-xs mt-0.5 text-gray-500">
          {yoyDelta > 0 ? '▲' : yoyDelta < 0 ? '▼' : '—'}{' '}
          {(yoyFormat || format)(Math.abs(yoyDelta))}
          {' '}
          <span className={`${(higherIsBad ? yoyDelta > 0 : yoyDelta < 0) ? 'text-red-400/70' : 'text-green-400/70'}`}>
            ({yoyPct > 0 ? '+' : ''}{yoyPct.toFixed(1)}%) vs LY
          </span>
        </p>
      )}
    </div>
  )
}
