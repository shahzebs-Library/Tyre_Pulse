import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import * as kpiTargets from '../lib/api/kpiTargets'
import { loadPmDashboard } from '../lib/api/pmPrograms'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { summarizePmCompliance } from '../lib/pmSchedule'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import EmailPdfButton from '../components/EmailPdfButton'
import { toUserMessage } from '../lib/safeError'
import { formatCurrency as _fmtCurrencyBase } from '../lib/formatters'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  DEFAULT_TARGETS, KPI_META, monthWindow, priorYearMonths, monthsToDateRange, gridCostByMonth,
  monthlyActuals, overdueActionCount, passes, costRegression, performanceAlerts, siteRows,
  deltaOf, actualsExportRows, isMeasured,
} from '../lib/kpiScorecardAnalytics'
import {
  Download, FileText, AlertTriangle, ToggleLeft, ToggleRight, Target, RefreshCw,
  Wrench, CalendarClock, ClipboardCheck, ArrowRight, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import DateField from '../components/ui/DateField'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SectionTabs, { KPI_TABS } from '../components/ui/SectionTabs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Title, Tooltip, Legend)

const TOUCH = 'min-h-[44px]'

function chartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: 'var(--text-secondary)', font: { size: 11 } } },
      title: { display: false },
      tooltip: { backgroundColor: 'var(--panel)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)', borderColor: 'var(--hairline)', borderWidth: 1 },
    },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' } },
    },
  }
}

function sortNullLast(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

function Verdict({ pass }) {
  const { t } = useLanguage()
  if (pass == null) return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-muted)]">Not measured</span>
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${pass ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
      {pass ? t('kpiscorecard.cards.pass') : t('kpiscorecard.cards.fail')}
    </span>
  )
}

export default function KpiScorecard() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const fmtCurrency = useCallback((v) => (isMeasured(v) ? _fmtCurrencyBase(v, activeCurrency, 0) : 'N/A'), [activeCurrency])
  const [records, setRecords]         = useState([])
  const [actions, setActions]         = useState([])
  const [targets, setTargets]         = useState(DEFAULT_TARGETS)
  const [editing, setEditing]         = useState(false)
  const [draftTargets, setDraftTargets] = useState(DEFAULT_TARGETS)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [truncated, setTruncated]     = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [exportError, setExportError] = useState('')
  const [yearFilter, setYearFilter]   = useState(new Date().getFullYear())
  const [countryChip, setCountryChip] = useState('All')
  // Custom calendar range. With BOTH dates set the month axis is derived from
  // the range (clamped to the most recent 24 months); else the rolling 12 months.
  const [rangeFrom, setRangeFrom]     = useState('')
  const [rangeTo, setRangeTo]         = useState('')
  const [showYoY, setShowYoY]         = useState(false)
  const [yoyRecords, setYoyRecords]   = useState([])
  const [yoyLoading, setYoyLoading]   = useState(false)
  const [yoySplit, setYoySplit]       = useState(null)
  const [activeMainTab, setActiveMainTab] = useState('overview')
  const [costSplit, setCostSplit]     = useState(null)
  const [costLoading, setCostLoading] = useState(true)

  const { months, clamped: monthsClamped, custom: customRange } = useMemo(
    () => monthWindow({ rangeFrom, rangeTo, now: new Date() }),
    [rangeFrom, rangeTo],
  )
  const window_ = useMemo(() => monthsToDateRange(months), [months])
  const effectiveCountry = countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : undefined)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Tyre fitments inside the window only (server-side date bound).
      const [r, a, tg] = await Promise.all([
        kpiTargets.listKpiTyreRecords({ country: activeCountry, from: window_.from, to: window_.to }),
        kpiTargets.listOpenCorrectiveActions({ country: activeCountry }),
        kpiTargets.listKpiTargets({ year: yearFilter }),
      ])
      for (const res of [r, a, tg]) if (res?.error) throw res.error
      setRecords(r.data || [])
      setTruncated(Boolean(r.truncated))
      setActions(a.data || [])
      const merged = { ...DEFAULT_TARGETS }
      ;(tg.data || []).forEach(row => {
        if (merged[row.metric] !== undefined) merged[row.metric] = row.target_value
      })
      setTargets(merged)
      setDraftTargets(merged)
    } catch (e) {
      setError(toUserMessage(e, t('kpiscorecard.states.errorDefault')))
    } finally {
      setLoading(false)
    }
  }, [activeCountry, yearFilter, window_.from, window_.to, t])

  useEffect(() => { load() }, [load])

  // Monthly tyre spend from the governed expense grid (never cost_per_tyre).
  useEffect(() => {
    let cancelled = false
    setCostLoading(true)
    loadGovernedCostSplit({ country: effectiveCountry, from: window_.from, to: window_.to, maxAgeMs: COST_SPLIT_TTL_MS })
      .then(res => { if (!cancelled) setCostSplit(res) })
      .catch(() => { if (!cancelled) setCostSplit(null) })
      .finally(() => { if (!cancelled) setCostLoading(false) })
    return () => { cancelled = true }
  }, [effectiveCountry, window_.from, window_.to])

  // ── Preventive Maintenance KPI group (independent load, own tri-state) ──
  const [pmState, setPmState] = useState({ loading: true, error: null, data: null })
  useEffect(() => {
    let cancelled = false
    setPmState({ loading: true, error: null, data: null })
    loadPmDashboard({ country: activeCountry })
      .then(res => { if (!cancelled) setPmState({ loading: false, error: null, data: res }) })
      .catch(e => { if (!cancelled) setPmState({ loading: false, error: e?.message || 'load_failed', data: null }) })
    return () => { cancelled = true }
  }, [activeCountry])

  const pmSummary = useMemo(() => {
    const data = pmState.data
    if (!data) return null
    return summarizePmCompliance(data.plans, { now: Date.now(), kmByAsset: data.kmByAsset, hoursByAsset: data.hoursByAsset })
  }, [pmState.data])

  // YoY stays meaningful only while the window is 12 months or less.
  const yoyAvailable = !customRange || months.length <= 12
  useEffect(() => { if (!yoyAvailable && showYoY) setShowYoY(false) }, [yoyAvailable, showYoY])
  const yoyMonths = useMemo(() => priorYearMonths(months), [months])

  const filteredRecords = useMemo(() =>
    countryChip === 'All' ? records : records.filter(r => r.country === countryChip), [records, countryChip])
  const filteredActions = useMemo(() =>
    countryChip === 'All' ? actions : actions.filter(a => a.country === countryChip), [actions, countryChip])

  const costMap = useMemo(() => gridCostByMonth(costSplit), [costSplit])
  const costBlended = Boolean(costSplit?.blended)
  const actuals = useMemo(() => monthlyActuals(filteredRecords, months, costMap), [filteredRecords, months, costMap])
  const overdueNow = useMemo(() => overdueActionCount(filteredActions, new Date()), [filteredActions])

  // YoY fetch (records + grid spend for the same months a year earlier)
  useEffect(() => {
    if (!showYoY) return
    let cancelled = false
    ;(async () => {
      setYoyLoading(true)
      const range = monthsToDateRange(yoyMonths)
      try {
        const [recs, split] = await Promise.all([
          kpiTargets.listKpiTyreRecordsInRange({ start: range.from, end: range.to, country: activeCountry }),
          loadGovernedCostSplit({ country: effectiveCountry, from: range.from, to: range.to, maxAgeMs: COST_SPLIT_TTL_MS }).catch(() => null),
        ])
        if (cancelled) return
        setYoyRecords(recs?.data || [])
        setYoySplit(split)
      } finally {
        if (!cancelled) setYoyLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [showYoY, yoyMonths, activeCountry, effectiveCountry])

  const yoyActualsMap = useMemo(() => {
    if (!showYoY) return {}
    const recs = countryChip === 'All' ? yoyRecords : yoyRecords.filter(r => r.country === countryChip)
    const ly = monthlyActuals(recs, yoyMonths, gridCostByMonth(yoySplit))
    return Object.fromEntries(months.map((m, i) => [m, ly[i]]))
  }, [showYoY, yoyRecords, yoyMonths, yoySplit, months, countryChip])

  const reg = useMemo(() => costRegression(actuals), [actuals])
  const forecast = useMemo(() => (reg ? [1, 2, 3].map(f => Math.max(0, Math.round(reg.predict(actuals.length - 1 + f)))) : []), [reg, actuals.length])

  const costChartData = useMemo(() => {
    const labels = [...months, ...forecast.map((_, i) => `F+${i + 1}`)]
    const actualColor = colorAt(0)
    return {
      labels,
      datasets: [
        { label: t('kpiscorecard.charts.series.actualCost'), data: [...actuals.map(a => a.totalCost), ...forecast.map(() => null)],
          borderColor: actualColor, backgroundColor: withAlpha(actualColor, 0.1), fill: true, tension: 0.35, spanGaps: true },
        { label: t('kpiscorecard.charts.series.targetCeiling'), data: labels.map(() => targets.max_monthly_cost),
          borderColor: 'rgba(239,68,68,0.6)', borderDash: [6, 3], fill: false, pointRadius: 0 },
        forecast.length > 0 && { label: t('kpiscorecard.charts.series.forecast'), data: [...months.map(() => null), ...forecast],
          borderColor: colorAt(2), borderDash: [4, 2], fill: false, tension: 0.35, spanGaps: true },
        reg && { label: t('kpiscorecard.charts.series.trendLine'), data: months.map((_, i) => Math.max(0, Math.round(reg.predict(i)))),
          borderColor: withAlpha(colorAt(5), 0.5), borderDash: [2, 4], fill: false, pointRadius: 0 },
        showYoY && { label: t('kpiscorecard.charts.series.lyCost'), data: months.map(m => yoyActualsMap[m]?.totalCost ?? null),
          borderColor: withAlpha(colorAt(4), 0.8), borderDash: [3, 3], fill: false, tension: 0.35, spanGaps: true },
      ].filter(Boolean),
    }
  }, [months, actuals, forecast, reg, targets, showYoY, yoyActualsMap, t])

  const highRiskChartData = useMemo(() => ({
    labels: months,
    datasets: [
      { label: t('kpiscorecard.charts.series.highRiskPct'), data: actuals.map(a => (a.highRiskPct == null ? null : Number(a.highRiskPct.toFixed(1)))),
        borderColor: 'rgba(239,68,68,1)', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.35, spanGaps: true },
      { label: t('kpiscorecard.charts.series.targetMaxPct'), data: months.map(() => targets.max_high_risk_pct),
        borderColor: 'rgba(245,158,11,0.6)', borderDash: [6, 3], fill: false, pointRadius: 0 },
    ],
  }), [actuals, months, targets, t])
  const anyRated = actuals.some(a => a.rated > 0)
  const anyCost = actuals.some(a => a.totalCost != null)

  async function saveTargets() {
    setSaving(true)
    const year = new Date().getFullYear()
    const upserts = Object.entries(draftTargets).map(([metric, target_value]) => ({
      metric, target_value, year, region: 'KSA',
      created_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }))
    // Under RLS a blocked UPDATE affects zero rows silently, so a refusal must be
    // shown rather than the new values presented as saved.
    const { error: saveErr } = await kpiTargets.upsertKpiTargets(upserts) || {}
    if (saveErr) {
      setSaveError(toUserMessage(saveErr, 'Could not save the targets.'))
      setSaving(false)
      return
    }
    setTargets(draftTargets)
    setEditing(false)
    setSaveError('')
    setSaving(false)
  }

  const currentMonth = actuals[actuals.length - 1]
  const prevMonth    = actuals[actuals.length - 2]
  const currentMonthStr = months[months.length - 1]
  const lyCurrent = showYoY ? yoyActualsMap[currentMonthStr] : null

  const alerts = useMemo(() => performanceAlerts(currentMonth, targets, overdueNow), [currentMonth, targets, overdueNow])
  const sites = useMemo(() => siteRows(filteredRecords, currentMonthStr, targets), [filteredRecords, currentMonthStr, targets])

  const scopeLabel = `${effectiveCountry || 'All countries'} ${months[0] || ''} to ${currentMonthStr || ''}`
  const EXPORT_COLS = [
    { key: 'month', header: 'Month' },
    { key: 'count', header: 'Tyre records' },
    { key: 'rated', header: 'Rated tyres' },
    { key: 'totalCost', header: `Tyre spend (grid, ${activeCurrency})` },
    { key: 'costVsTarget', header: 'Spend vs target' },
    { key: 'highRiskPct', header: 'High risk % (rated)' },
    { key: 'avgCostPerTyre', header: `Avg spend per tyre (${activeCurrency})` },
  ]
  const exportRows = useMemo(() => actualsExportRows(actuals, targets), [actuals, targets])

  async function doExport(kind) {
    setExportError('')
    try {
      const file = reportFileName('TyrePulse KPI Scorecard', scopeLabel)
      if (kind === 'excel') await exportToExcel(exportRows, EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), file)
      else await exportToPdf(exportRows, EXPORT_COLS, `KPI Scorecard: Monthly Actuals (${scopeLabel})`, file, 'landscape')
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Tables ──────────────────────────────────────────────────────────────────
  const monthColumns = useMemo(() => [
    { id: 'month', header: t('kpiscorecard.table.columns.month'), accessorFn: r => r.month, size: 100 },
    { id: 'count', header: t('kpiscorecard.table.columns.records'), accessorFn: r => r.count, size: 100, meta: { align: 'right' } },
    { id: 'rated', header: 'Rated', accessorFn: r => r.rated, size: 80, meta: { align: 'right' } },
    { id: 'totalCost', header: `${t('kpiscorecard.table.columns.totalCost')} (grid)`, accessorFn: r => r.totalCost ?? undefined, sortUndefined: 'last', size: 150,
      meta: { align: 'right', exportValue: r => (r.totalCost == null ? 'N/A' : Math.round(r.totalCost)) },
      cell: ({ row }) => {
        const r = row.original
        const pass = passes(r.totalCost, targets.max_monthly_cost, true)
        return <span className={`tabular-nums ${pass === false ? 'text-red-400 font-medium' : 'text-[var(--text-primary)]'}`}>{fmtCurrency(r.totalCost)}</span>
      } },
    ...(showYoY ? [{
      id: 'lyCost', header: t('kpiscorecard.table.columns.lyCost'), accessorFn: r => yoyActualsMap[r.month]?.totalCost ?? undefined, sortUndefined: 'last', size: 150,
      meta: { align: 'right', exportValue: r => yoyActualsMap[r.month]?.totalCost ?? 'N/A' },
      cell: ({ row }) => {
        const ly = yoyActualsMap[row.original.month]?.totalCost
        const cur = row.original.totalCost
        const d = isMeasured(ly) && ly > 0 && isMeasured(cur) ? ((cur - ly) / ly) * 100 : null
        return (
          <span className="tabular-nums text-xs text-[var(--text-secondary)]">
            {fmtCurrency(ly)}
            {d != null && <span className={`ml-1 ${d > 0 ? 'text-red-400' : 'text-green-400'}`}>{d > 0 ? 'up' : 'down'} {Math.abs(d).toFixed(0)}%</span>}
          </span>
        )
      },
    }] : []),
    { id: 'vsTarget', header: t('kpiscorecard.table.columns.vsTarget'), accessorFn: r => passes(r.totalCost, targets.max_monthly_cost, true), size: 140,
      meta: { align: 'right', exportValue: r => { const p = passes(r.totalCost, targets.max_monthly_cost, true); return p == null ? 'N/A' : p ? 'On target' : 'Over target' } },
      cell: ({ row }) => {
        const r = row.original
        const pass = passes(r.totalCost, targets.max_monthly_cost, true)
        if (pass == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full ${pass ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
            {pass ? t('kpiscorecard.table.onTarget') : `Over by ${fmtCurrency(r.totalCost - targets.max_monthly_cost)}`}
          </span>
        )
      } },
    { id: 'highRiskPct', header: `${t('kpiscorecard.table.columns.highRiskPct')} (rated)`, accessorFn: r => r.highRiskPct ?? undefined, sortUndefined: 'last', size: 140,
      meta: { align: 'right', exportValue: r => (r.highRiskPct == null ? 'N/A' : r.highRiskPct.toFixed(1)) },
      cell: ({ row }) => {
        const v = row.original.highRiskPct
        const pass = passes(v, targets.max_high_risk_pct, true)
        return <span className={`tabular-nums ${pass === false ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{v == null ? 'N/A' : `${v.toFixed(1)}%`}</span>
      } },
    { id: 'avgCostPerTyre', header: 'Avg spend / tyre', accessorFn: r => r.avgCostPerTyre ?? undefined, sortUndefined: 'last', size: 140,
      meta: { align: 'right', exportValue: r => (r.avgCostPerTyre == null ? 'N/A' : Math.round(r.avgCostPerTyre)) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{fmtCurrency(row.original.avgCostPerTyre)}</span> },
  ], [t, targets, fmtCurrency, showYoY, yoyActualsMap])

  const siteColumns = useMemo(() => [
    { id: 'site', header: t('kpiscorecard.sites.columns.site'), accessorFn: r => r.site, size: 160, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.site}</span> },
    { id: 'count', header: `${t('kpiscorecard.sites.columns.records')} (${currentMonthStr})`, accessorFn: r => r.count, size: 150, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.count} <Verdict pass={row.original.recordsPass} /></span> },
    { id: 'rated', header: 'Rated', accessorFn: r => r.rated, size: 80, meta: { align: 'right' } },
    { id: 'highRiskPct', header: `${t('kpiscorecard.sites.columns.highRiskPct')} (rated)`, accessorFn: r => r.highRiskPct ?? undefined, sortUndefined: 'last', size: 170,
      meta: { align: 'right', exportValue: r => (r.highRiskPct == null ? 'N/A' : r.highRiskPct.toFixed(1)) },
      cell: ({ row }) => <span className="tabular-nums">{row.original.highRiskPct == null ? 'N/A' : `${row.original.highRiskPct.toFixed(1)}%`} <Verdict pass={row.original.riskPass} /></span> },
    { id: 'windowCount', header: 'Records in window', accessorFn: r => r.windowCount, size: 150, meta: { align: 'right' } },
  ], [t, currentMonthStr])

  return (
    <div className="space-y-6">
      <SectionTabs tabs={KPI_TABS} />
      <PageHeader
        title={t('kpiscorecard.title')}
        subtitle={t('kpiscorecard.subtitle')}
        icon={Target}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh KPI scorecard"
              className={`btn-secondary flex items-center justify-center px-3 ${TOUCH} disabled:opacity-40`}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setShowYoY(v => !v)}
              disabled={!yoyAvailable}
              aria-pressed={showYoY}
              title={yoyAvailable ? undefined : 'YoY comparison is unavailable for ranges longer than 12 months'}
              className={`flex items-center gap-1.5 text-sm px-3 ${TOUCH} rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                showYoY ? 'bg-purple-900/40 border-purple-600 text-purple-300' : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)]'
              }`}
            >
              {showYoY ? <ToggleRight size={16} aria-hidden="true" /> : <ToggleLeft size={16} aria-hidden="true" />}
              {t('kpiscorecard.actions.yoyCompare')}
              {yoyLoading && <span className="text-xs ml-1">...</span>}
            </button>
            <button type="button" onClick={() => doExport('excel')} disabled={!actuals.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH}`}>
              <Download size={14} aria-hidden="true" /> {t('kpiscorecard.actions.excel')}
            </button>
            <button type="button" onClick={() => doExport('pdf')} disabled={!actuals.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH}`}>
              <FileText size={14} aria-hidden="true" /> {t('kpiscorecard.actions.pdf')}
            </button>
            <EmailPdfButton
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH}`}
              getPdf={async () => ({
                filename: `${reportFileName('TyrePulse KPI Scorecard', scopeLabel)}.pdf`,
                base64: await exportToPdf(exportRows, EXPORT_COLS, `KPI Scorecard: Monthly Actuals (${scopeLabel})`, reportFileName('TyrePulse KPI Scorecard', scopeLabel), 'landscape', '', { returnBase64: true }),
                subject: 'KPI Scorecard',
                bodyHtml: '<p>Attached is the KPI Scorecard (monthly actuals).</p>',
              })}
            />
            {!editing
              ? <button type="button" onClick={() => setEditing(true)} className={`btn-secondary text-sm px-3 ${TOUCH}`}>{t('kpiscorecard.actions.editTargets')}</button>
              : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setEditing(false); setDraftTargets(targets); setSaveError('') }} className={`btn-secondary text-sm px-3 ${TOUCH}`}>{t('kpiscorecard.actions.cancel')}</button>
                  <button type="button" onClick={saveTargets} disabled={saving} className={`btn-primary text-sm px-3 ${TOUCH} disabled:opacity-50`}>
                    {saving ? t('kpiscorecard.actions.saving') : t('kpiscorecard.actions.saveTargets')}
                  </button>
                </div>
              )}
          </div>
        }
      />

      {/* A refused save must be visible: under RLS a blocked UPDATE affects zero
          rows silently rather than raising. */}
      {saveError && <p className="text-sm rounded-lg px-3 py-2 text-red-400 bg-red-950/20" role="alert">{saveError}</p>}
      {exportError && <p className="text-sm text-red-400" role="alert">{exportError}</p>}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <section aria-label="Filters" className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="kpisc-year" className="label text-xs">Target year</label>
            <select id="kpisc-year" className={`input w-28 text-sm ${TOUCH}`} value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label text-xs">From</span>
            <DateField className="text-sm w-40" value={rangeFrom} onChange={setRangeFrom} placeholder="From date" ariaLabel="From date" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="label text-xs">To</span>
            <DateField className="text-sm w-40" value={rangeTo} onChange={setRangeTo} placeholder="To date" ariaLabel="To date" min={rangeFrom || undefined} />
          </div>
          {(rangeFrom || rangeTo) && (
            <button type="button" onClick={() => { setRangeFrom(''); setRangeTo('') }}
              className={`text-xs px-3 ${TOUCH} rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-[var(--text-secondary)]`}>
              Clear dates
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Country">
          {['All', ...COUNTRIES].map(c => (
            <button key={c} type="button" aria-pressed={countryChip === c} onClick={() => setCountryChip(c)}
              className={`px-3 ${TOUCH} rounded-full text-xs font-medium border transition-colors ${
                countryChip === c ? 'bg-blue-600 text-white border-blue-500' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
              }`}>
              {c === 'All' ? t('kpiscorecard.filters.allCountries') : c}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          {(rangeFrom || rangeTo) && !customRange
            ? 'Set both From and To dates to apply the range; the rolling last 12 months are shown until then.'
            : `Showing ${months.length} month${months.length !== 1 ? 's' : ''}: ${months[0]} to ${currentMonthStr}.`}
          {customRange && monthsClamped ? ' Range is longer than 24 months, so the last 24 months of it are shown.' : ''}
          {customRange && !yoyAvailable ? ' YoY comparison is hidden for ranges longer than 12 months.' : ''}
        </p>
      </section>

      {costBlended && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2" role="status">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-amber-300">
            All countries are in scope, and each reports tyre spend in its own currency. Cost figures read N/A rather than add SAR, AED and EGP together. Pick a country for a single-currency cost view.
          </p>
        </div>
      )}
      {truncated && (
        <p role="status" className="text-xs text-amber-400">Capped view: the tyre record read reached its 200,000-row ceiling. Narrow the date range for exact counts.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-bright)]" role="tablist" aria-label="Scorecard view">
        {['overview', 'sites'].map(id => (
          <button key={id} type="button" role="tab" aria-selected={activeMainTab === id} onClick={() => setActiveMainTab(id)}
            className={`px-4 ${TOUCH} text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeMainTab === id ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}>
            {t(`kpiscorecard.tabs.${id}`)}
          </button>
        ))}
      </div>

      {loading && (
        <div aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card h-28 animate-pulse" />)}
        </div>
      )}

      {!loading && error && (
        <Card tone="crit">
          <div className="flex flex-col items-center gap-3 text-center" role="alert" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
            <AlertTriangle size={36} className="text-red-400" aria-hidden="true" />
            <p className="text-red-300 font-medium">{t('kpiscorecard.states.errorTitle')}</p>
            <p className="text-[var(--text-muted)] text-sm">{error}</p>
            <button type="button" onClick={load} className={`btn-primary inline-flex items-center gap-2 px-4 ${TOUCH}`}>
              <RefreshCw size={16} aria-hidden="true" /> {t('kpiscorecard.states.retry')}
            </button>
          </div>
        </Card>
      )}

      {!loading && !error && alerts.length > 0 && (
        <div role="status" className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${
          alerts.some(a => a.overage > 0.5) ? 'bg-red-950/40 border-red-700/60' : 'bg-amber-950/40 border-amber-700/60'
        }`}>
          <AlertTriangle size={18} className={alerts.some(a => a.overage > 0.5) ? 'text-red-400 mt-0.5 shrink-0' : 'text-amber-400 mt-0.5 shrink-0'} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t('kpiscorecard.alerts.banner', { count: alerts.length, plural: alerts.length > 1 ? 's' : '' })}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {alerts.map(a => {
                const f = KPI_META[a.key].unit === 'currency' ? fmtCurrency : KPI_META[a.key].unit === '%' ? (v => `${v.toFixed(1)}%`) : (v => String(v))
                return (
                  <span key={a.key} className="text-xs text-[var(--text-secondary)]">
                    <span className={a.overage > 0.5 ? 'text-red-400 font-medium' : 'text-amber-400 font-medium'}>{t(`kpiscorecard.kpiLabels.${a.key}`)}</span>
                    {': '}{f(a.actual)} {t('kpiscorecard.alerts.vsTarget')} {f(a.target)} (+{(a.overage * 100).toFixed(0)}% {t('kpiscorecard.alerts.overSuffix')})
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Card tone="warn">
          <p className="text-sm font-medium text-yellow-400 mb-4">{t('kpiscorecard.targetEditor.title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(KPI_META).map(([key, { unit }]) => (
              <div key={key}>
                <label htmlFor={`tgt-${key}`} className="label text-xs">
                  {t(`kpiscorecard.kpiLabels.${key}`)} {unit && `(${unit === 'currency' ? activeCurrency : unit})`}
                </label>
                <input id={`tgt-${key}`} type="number" inputMode="decimal" className={`input ${TOUCH}`} value={draftTargets[key] ?? ''}
                  onChange={e => setDraftTargets(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── OVERVIEW TAB ── */}
      {!loading && !error && activeMainTab === 'overview' && (
        <>
          {currentMonth && (
            <section aria-label={`Scorecard for ${currentMonthStr}`} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard label={`${t('kpiscorecard.cards.monthlyCost')} (${currentMonthStr})`} actual={currentMonth.totalCost}
                target={targets.max_monthly_cost} format={fmtCurrency} invert
                prev={prevMonth?.totalCost} ly={lyCurrent?.totalCost}
                note={costLoading ? 'Loading spend' : currentMonth.totalCost == null ? (costBlended ? 'Mixed currencies' : 'No grid spend available') : 'Expense grid tyre spend'} />
              <KpiCard label={t('kpiscorecard.cards.highRiskPct')} actual={currentMonth.highRiskPct}
                target={targets.max_high_risk_pct} format={v => `${v.toFixed(1)}%`} invert
                prev={prevMonth?.highRiskPct} ly={lyCurrent?.highRiskPct}
                note={currentMonth.rated ? `${currentMonth.rated} of ${currentMonth.count} tyres rated` : 'No tyre rated this month'} />
              <KpiCard label={t('kpiscorecard.cards.recordCount')} actual={currentMonth.count}
                target={targets.min_records_month} format={v => String(v)} invert={false}
                prev={prevMonth?.count} ly={lyCurrent?.count} note="Tyre records issued this month" />
              <KpiCard label={t('kpiscorecard.cards.overdueActions')} actual={overdueNow}
                target={targets.max_overdue_actions} format={v => String(v)} invert
                note="Open corrective actions past due today" />
              <KpiCard label={t('kpiscorecard.cards.avgCostPerTyre')} actual={currentMonth.avgCostPerTyre}
                target={targets.max_avg_cost_tyre} format={fmtCurrency} invert
                prev={prevMonth?.avgCostPerTyre} ly={lyCurrent?.avgCostPerTyre}
                note="Grid tyre spend divided by tyre records" />
              <Card>
                <p className="text-xs text-[var(--text-secondary)] mb-1">{t('kpiscorecard.cards.forecastNextMonth')}</p>
                <p className="text-xl font-bold text-yellow-400 tabular-nums">{reg ? fmtCurrency(Math.max(0, Math.round(reg.predict(months.length)))) : 'N/A'}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {reg
                    ? t('kpiscorecard.cards.rSquaredSlope', { r2: reg.r2.toFixed(2), sign: reg.slope > 0 ? '+' : '', slope: Math.round(reg.slope).toLocaleString() })
                    : 'Needs at least two months of single-currency grid spend'}
                </p>
              </Card>
            </section>
          )}

          <PmKpiGroup state={pmState} summary={pmSummary} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">
                {t('kpiscorecard.charts.monthlyCostVsTarget')}{showYoY ? t('kpiscorecard.charts.lyOverlaySuffix') : ''}
              </h3>
              {anyCost ? (
                <div style={{ height: 300 }}>
                  <Line data={costChartData} options={chartOpts()} role="img" aria-label="Line chart of monthly tyre spend against the target ceiling with a three-month forecast" />
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] py-16 text-center">
                  {costBlended ? 'Pick one country to chart single-currency spend.' : 'No grid tyre spend for this window.'}
                </p>
              )}
            </Card>
            <Card>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">{t('kpiscorecard.charts.highRiskVsTarget')}</h3>
              {anyRated ? (
                <div style={{ height: 300 }}>
                  <Line data={highRiskChartData} options={chartOpts()} role="img" aria-label="Line chart of monthly high-risk percentage of rated tyres against the target" />
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] py-16 text-center flex items-center justify-center gap-2">
                  <Info size={14} aria-hidden="true" /> Not measured: no tyre in this window carries a risk level.
                </p>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">{t('kpiscorecard.table.monthlyActualsTitle')}</h3>
            <EnterpriseTable
              columns={monthColumns}
              data={actuals}
              getRowId={r => r.month}
              enableColumnFilters={false}
              searchPlaceholder="Search month"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse KPI Monthly Actuals', scopeLabel)}
              reportMeta={{ title: 'KPI monthly actuals', currency: activeCurrency }}
              emptyMessage="No months in this window."
            />
          </Card>
        </>
      )}

      {/* ── BY SITE TAB ── */}
      {!loading && !error && activeMainTab === 'sites' && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-medium text-[var(--text-secondary)]">Site performance, {currentMonthStr}</h3>
            <p className="text-xs text-[var(--text-muted)]">{t('kpiscorecard.sites.siteCount', { count: sites.length, plural: sites.length !== 1 ? 's' : '' })}</p>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Site tyre spend is not shown here: the expense grid books spend to the issuing store, not the site the vehicle works at.
            See <Link to="/expense-report" className="underline">Expenses and CPK</Link> for spend by site.
          </p>
          <EnterpriseTable
            columns={siteColumns}
            data={sites}
            getRowId={r => r.site}
            enableColumnFilters={false}
            searchPlaceholder="Search site"
            initialPageSize={25}
            exportFileName={reportFileName('TyrePulse KPI Sites', scopeLabel)}
            reportMeta={{ title: `Site performance ${currentMonthStr}` }}
            emptyMessage={t('kpiscorecard.sites.noData', { month: currentMonthStr })}
          />
        </Card>
      )}
    </div>
  )
}

/**
 * Preventive Maintenance KPI group. Honest states: loading card, error card
 * (never blocks the page), and nothing at all when no plan is on file.
 */
function PmKpiGroup({ state, summary }) {
  if (state?.loading) {
    return (
      <Card className="items-center gap-2 text-sm text-[var(--text-secondary)]" style={{ flexDirection: 'row' }}>
        <Wrench size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
        Loading preventive maintenance KPIs...
      </Card>
    )
  }
  if (state?.error) {
    return (
      <Card tone="crit" className="items-center gap-2 text-sm text-red-300" style={{ flexDirection: 'row' }}>
        <AlertTriangle size={16} className="text-red-400" aria-hidden="true" />
        Preventive maintenance KPIs are unavailable right now.
      </Card>
    )
  }
  if (!summary || summary.total === 0) return null

  const compliancePassing = summary.compliantPct == null || summary.compliantPct >= 80
  const complianceLabel = summary.compliantPct == null ? 'N/A' : `${summary.compliantPct}%`
  return (
    <section aria-label="Preventive maintenance" className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
          <Wrench size={15} className="text-blue-400" aria-hidden="true" />
          Preventive Maintenance
        </h3>
        <Link to="/pm-programs" className={`inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 ${TOUCH}`}>
          PM Programs <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card tone={compliancePassing ? 'good' : 'crit'}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">PM Compliance</p>
            <ClipboardCheck size={15} className={compliancePassing ? 'text-green-400' : 'text-red-400'} aria-hidden="true" />
          </div>
          <p className={`text-xl font-bold mt-1 tabular-nums ${compliancePassing ? 'text-green-400' : 'text-red-400'}`}>{complianceLabel}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {summary.compliantPct == null ? 'No active plans to measure' : `${summary.active - summary.overdue} of ${summary.active} on schedule`}
          </p>
        </Card>
        <Card tone={summary.overdue > 0 ? 'crit' : 'default'}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">PM Overdue</p>
            <AlertTriangle size={15} className={summary.overdue > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'} aria-hidden="true" />
          </div>
          <p className={`text-xl font-bold mt-1 tabular-nums ${summary.overdue > 0 ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{summary.overdue}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Active plans past due</p>
        </Card>
        <Card tone={summary.dueSoon > 0 ? 'warn' : 'default'}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">PM Due Soon</p>
            <CalendarClock size={15} className={summary.dueSoon > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'} aria-hidden="true" />
          </div>
          <p className={`text-xl font-bold mt-1 tabular-nums ${summary.dueSoon > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>{summary.dueSoon}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Approaching next service</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">Active PM Plans</p>
            <Wrench size={15} className="text-blue-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold mt-1 tabular-nums text-[var(--text-primary)]">{summary.active}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{summary.total > summary.active ? `${summary.total} total on file` : 'All plans active'}</p>
        </Card>
      </div>
    </section>
  )
}

function KpiCard({ label, actual, target, format, invert, prev, ly, note }) {
  const { t } = useLanguage()
  const measured = isMeasured(actual)
  const pass = passes(actual, target, invert)
  const delta = deltaOf(actual, prev)
  const lyDelta = deltaOf(actual, ly)
  const lyPct = lyDelta != null && isMeasured(ly) && Number(ly) !== 0 ? (lyDelta / Math.abs(ly)) * 100 : null
  const worse = (d) => (invert ? d > 0 : d < 0)
  return (
    // The pass/fail edge is `tone`; a border-* class on a Card renders nothing.
    <Card tone={pass == null ? 'default' : pass ? 'good' : 'crit'}>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${pass == null ? 'text-[var(--text-primary)]' : pass ? 'text-green-400' : 'text-red-400'}`}>
        {measured ? format(actual) : 'N/A'}
      </p>
      <div className="flex items-center justify-between mt-2 gap-2">
        <p className="text-xs text-[var(--text-muted)]">{t('kpiscorecard.cards.target')} {format(target)}</p>
        <Verdict pass={pass} />
      </div>
      {delta != null && (
        <p className={`text-xs mt-1 ${delta === 0 ? 'text-[var(--text-muted)]' : worse(delta) ? 'text-red-400' : 'text-green-400'}`}>
          {delta > 0 ? 'Up' : delta < 0 ? 'Down' : 'Flat'} {format(Math.abs(delta))} {t('kpiscorecard.cards.vsPrevMonth')}
        </p>
      )}
      {lyPct != null && (
        <p className={`text-xs mt-0.5 ${worse(lyDelta) ? 'text-red-400/80' : 'text-green-400/80'}`}>
          {lyPct > 0 ? '+' : ''}{lyPct.toFixed(1)}% {t('kpiscorecard.cards.vsLastYear')}
        </p>
      )}
      {note && <p className="text-[11px] text-[var(--text-muted)] mt-1">{note}</p>}
    </Card>
  )
}
