/**
 * WorkshopAnalytics (route /workshop-analytics) - workshop PRODUCTIVITY history &
 * trends. Where Workshop Live Control shows the shop right now, this page answers
 * "how did we perform over a date range": daily productive / blocked / unassigned
 * hours, a utilization trend, delay cost by root cause, a technician leaderboard,
 * first-time-fix rate and target-vs-actual timing.
 *
 * All KPI maths live in the pure, unit-tested `workshopAnalytics` engine, which
 * REUSES the live `workshopLive` engine (rollupTechnician / delayBreakdown) so the
 * numbers match the live board. This page is presentation + orchestration only.
 *
 * HONEST states: loading skeleton, empty ("No workshop activity in this range"),
 * error + Retry (toUserMessage). Nothing is fabricated - a metric with no source
 * data renders 'N/A'. Read-only, self-gated to Admin / Manager / Director + super
 * admin. Light + dark via var(--*) tokens; charts follow the report palette.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  TrendingUp, Filter, X, Gauge, Timer, Users, AlertTriangle, ShieldAlert,
  FileSpreadsheet, FileText, Activity, Percent, Target, Wrench, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DateField from '../components/ui/DateField'
import EChart from '../components/charts/EChart'
import { getEchartsTheme } from '../components/charts/echartsTheme'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { loadWorkshopHistory, distinctSites } from '../lib/api/workshopAnalytics'
import { computeWorkshopAnalytics } from '../lib/workshopAnalytics'
import {
  defaultFilters, quickRanges, activeQuickRange, activeFilterCount,
  fmtNum, fmtPct, fmtMin, labelReason, buildKpis,
  leaderboardRows, delayRows as buildDelayRows, delayTotals,
  LEADERBOARD_EXPORT, leaderboardExportRows,
} from '../lib/workshopAnalyticsView'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { isMissingRelation } from '../lib/api/_client'

// exportUtils pulls the PDF/Excel engines; load it on first click only.
const loadExportUtils = () => import('../lib/exportUtils')

const VIEW_ROLES = new Set(['Admin', 'Manager', 'Director'])
const KPI_ICON = { util: Percent, prod: Activity, blocked: Timer, unassigned: Clock, jobs: Wrench, ftf: Gauge, task: Timer, delay: AlertTriangle }

// Priority keeps a semantic tint, but the WORD is always printed too.
const PRIORITY_TONE = {
  high: 'bg-red-500/15 text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-dim)]',
}

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] disabled:opacity-50 disabled:cursor-not-allowed'

export default function WorkshopAnalytics() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const { isDark } = useTheme()
  const canView = isSuperAdmin === true || VIEW_ROLES.has(profile?.role)

  const [data, setData] = useState({ events: [], jobs: [], shifts: [], technicians: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState(() => defaultFilters())
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const resetFilters = () => setFilters(defaultFilters())

  // Changing the date range or site refetches without waiting for the load
  // already in flight; the guard stops a slower earlier answer from painting the
  // PREVIOUS window's productivity under the new filters.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setRefreshing(true)
    setError('')
    try {
      const res = await loadWorkshopHistory({
        from: filters.from || undefined,
        to: filters.to || undefined,
        site: filters.site,
        country: activeCountry,
      })
      if (stale()) return
      setData(res)
      setMissing(false)
      setUpdatedAt(new Date())
    } catch (err) {
      if (stale()) return
      if (isMissingRelation(err)) { setMissing(true); setData({ events: [], jobs: [], shifts: [], technicians: [] }) }
      else setError(toUserMessage(err, 'Could not load workshop analytics.'))
    } finally {
      if (!stale()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [filters.from, filters.to, filters.site, activeCountry, latestLoad])

  useEffect(() => { setLoading(true); load() }, [load])

  const analytics = useMemo(
    () => computeWorkshopAnalytics({
      events: data.events,
      jobs: data.jobs,
      shifts: data.shifts,
      technicians: data.technicians,
      from: filters.from || undefined,
      to: filters.to || undefined,
      now: Date.now(),
    }),
    [data, filters.from, filters.to],
  )

  const siteOptions = useMemo(() => distinctSites(data.events, data.jobs, data.shifts), [data])
  const hasActivity = analytics.dailyTrend.length > 0 || analytics.technicianLeaderboard.length > 0
  const lbRows = useMemo(() => leaderboardRows(analytics.technicianLeaderboard), [analytics.technicianLeaderboard])
  const dRows = useMemo(() => buildDelayRows(analytics.delayByReason), [analytics.delayByReason])
  const dTotals = useMemo(() => delayTotals(dRows), [dRows])
  const ranges = useMemo(() => quickRanges(), [])
  const activeRange = activeQuickRange(filters)
  const filterCount = activeFilterCount(filters)

  // ── ECharts options. ECharts draws on a canvas and cannot read CSS vars, so
  // the theme tokens are resolved here and every option rebuilds on a theme flip.
  const th = useMemo(() => getEchartsTheme(isDark), [isDark])
  const trend = analytics.dailyTrend
  const dayLabels = useMemo(() => trend.map((d) => d.date.slice(5)), [trend])
  const axis = useMemo(() => ({
    axisLabel: { color: th.muted, fontSize: 10 },
    nameTextStyle: { color: th.muted },
    axisLine: { lineStyle: { color: th.axisLine } },
    splitLine: { lineStyle: { color: th.splitLine } },
  }), [th])
  const tooltipBase = useMemo(() => ({ backgroundColor: th.tooltipBg, borderColor: th.axisLine, textStyle: { color: th.text } }), [th])

  const utilizationOption = useMemo(() => ({
    grid: { left: 8, right: 16, top: 24, bottom: 24, containLabel: true },
    tooltip: { ...tooltipBase, trigger: 'axis', valueFormatter: (v) => (v == null ? 'N/A' : `${v}%`) },
    xAxis: { type: 'category', data: dayLabels, ...axis },
    yAxis: { type: 'value', min: 0, max: 100, name: 'Utilization %', ...axis, axisLabel: { color: th.muted, formatter: '{value}%' } },
    series: [{
      type: 'line', smooth: true, connectNulls: false,
      data: trend.map((d) => d.utilization),
      itemStyle: { color: colorAt(0) },
      lineStyle: { color: colorAt(0), width: 2 },
      areaStyle: { color: withAlpha(colorAt(0), 0.15) },
      symbolSize: 6,
    }],
  }), [trend, dayLabels, axis, th, tooltipBase])

  const timeStackOption = useMemo(() => {
    const mk = (name, key, ci, fill) => ({
      name, type: 'line', stack: 'time', areaStyle: { color: withAlpha(colorAt(ci), fill) },
      lineStyle: { color: colorAt(ci), width: 1 }, itemStyle: { color: colorAt(ci) }, smooth: true, symbol: 'none',
      data: trend.map((d) => d[key]),
    })
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 24, containLabel: true },
      tooltip: { ...tooltipBase, trigger: 'axis', valueFormatter: (v) => (v == null ? 'N/A' : `${v} h`) },
      legend: { top: 0, textStyle: { color: th.subText, fontSize: 11 } },
      xAxis: { type: 'category', data: dayLabels, ...axis },
      yAxis: { type: 'value', name: 'Hours', ...axis },
      series: [
        mk('Productive', 'productiveHours', 0, 0.5),
        mk('Blocked', 'blockedHours', 3, 0.4),
        mk('Unassigned', 'unassignedHours', 5, 0.35),
      ],
    }
  }, [trend, dayLabels, axis, th, tooltipBase])

  const delayCostRows = analytics.delayCostTrend
  const delayCostOption = useMemo(() => {
    const rows = [...delayCostRows].reverse() // hbar renders bottom-up
    return {
      grid: { left: 8, right: 56, top: 10, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const d = rows[p[0].dataIndex]
          return `${labelReason(d.reason)}<br/>Cost impact: <b>${fmtNum(d.costImpact)} ${activeCurrency || ''}</b>`
        },
      },
      xAxis: { type: 'value', name: `Cost (${activeCurrency || 'value'})`, ...axis },
      yAxis: { type: 'category', data: rows.map((d) => labelReason(d.reason)), axisLabel: { color: th.subText }, axisLine: { lineStyle: { color: th.axisLine } } },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: rows.map((d, i) => ({ value: d.costImpact, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: th.subText, formatter: (p) => fmtNum(p.value) },
      }],
    }
  }, [delayCostRows, activeCurrency, axis, th, tooltipBase])

  const ftf = analytics.firstTimeFix
  const ftfGaugeOption = useMemo(() => {
    const pct = ftf.rate == null ? null : Math.round(ftf.rate * 100)
    return {
      series: [{
        type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
        radius: '92%', center: ['50%', '58%'],
        progress: { show: true, width: 14, itemStyle: { color: colorAt(0) } },
        axisLine: { lineStyle: { width: 14, color: [[1, th.splitLine]] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: th.muted, fontSize: 9, distance: 14 },
        pointer: { show: pct != null, width: 4, itemStyle: { color: colorAt(0) } },
        anchor: { show: false },
        detail: {
          valueAnimation: true, offsetCenter: [0, '2%'], fontSize: 26, fontWeight: 700,
          color: th.text, formatter: () => (pct == null ? 'N/A' : `${pct}%`),
        },
        data: [{ value: pct == null ? 0 : pct }],
      }],
    }
  }, [ftf, th])

  const tva = analytics.targetVsActual
  const tvaOption = useMemo(() => {
    if (!tva) return null
    const rows = tva.rows.slice(0, 12)
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 40, containLabel: true },
      tooltip: { ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (v == null ? 'N/A' : `${v} min`) },
      legend: { top: 0, textStyle: { color: th.subText, fontSize: 11 } },
      xAxis: { type: 'category', data: rows.map((r) => String(r.jobNo)), ...axis, axisLabel: { color: th.muted, fontSize: 9, rotate: 30 } },
      yAxis: { type: 'value', name: 'Minutes', ...axis },
      series: [
        { name: 'Target', type: 'bar', barMaxWidth: 16, data: rows.map((r) => r.targetMin), itemStyle: { color: withAlpha(colorAt(1), 0.85) } },
        { name: 'Actual', type: 'bar', barMaxWidth: 16, data: rows.map((r) => r.actualMin), itemStyle: { color: withAlpha(colorAt(3), 0.85) } },
      ],
    }
  }, [tva, axis, th, tooltipBase])

  const kpis = buildKpis(analytics.summary, ftf, activeCurrency)

  // ── Tables ──────────────────────────────────────────────────────────────
  const lbColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: (r) => r.rank, size: 60, meta: { align: 'right' } },
    { id: 'name', header: 'Technician', accessorFn: (r) => r.name, size: 200,
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.name}</span> },
    { id: 'productiveHours', header: 'Productive (h)', accessorFn: (r) => r.productiveHours, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.productiveHours)}</span> },
    { id: 'utilization', header: 'Utilization', accessorFn: (r) => r.utilization, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPct(row.original.utilization)}</span> },
    { id: 'jobsCompleted', header: 'Jobs', accessorFn: (r) => r.jobsCompleted, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.jobsCompleted)}</span> },
    { id: 'blockedHours', header: 'Blocked (h)', accessorFn: (r) => r.blockedHours, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.blockedHours)}</span> },
  ], [])

  const delayColumns = useMemo(() => [
    { id: 'cause', header: 'Cause', accessorFn: (r) => r.cause, size: 130, meta: { filterVariant: 'select' },
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.cause}</span> },
    { id: 'hoursLost', header: 'Hours lost', accessorFn: (r) => r.hoursLost, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.hoursLost)}</span> },
    { id: 'costImpact', header: `Cost impact${activeCurrency ? ` (${activeCurrency})` : ''}`, accessorFn: (r) => r.costImpact, size: 140, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.costImpact)}</span> },
    { id: 'responsibleDept', header: 'Responsible', accessorFn: (r) => r.responsibleDept, size: 150, meta: { filterVariant: 'select' } },
    { id: 'suggestedAction', header: 'Suggested action', accessorFn: (r) => r.suggestedAction, size: 260,
      cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-normal">{row.original.suggestedAction}</span> },
    { id: 'priority', header: 'Priority', accessorFn: (r) => r.priorityRank, size: 110,
      meta: { exportValue: (r) => r.priorityLabel },
      cell: ({ row }) => (
        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${PRIORITY_TONE[row.original.priority] || PRIORITY_TONE.low}`}>
          {row.original.priorityLabel}
        </span>
      ) },
  ], [activeCurrency])

  async function exportLeaderboard(kind) {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
      const rows = leaderboardExportRows(lbRows)
      const keys = LEADERBOARD_EXPORT.map(([k]) => k)
      const heads = LEADERBOARD_EXPORT.map(([, h]) => h)
      const file = reportFileName('Workshop Productivity', reportDateLabel())
      if (kind === 'excel') await exportToExcel(rows, keys, heads, file, 'Leaderboard', { title: 'Workshop Productivity', currency: activeCurrency })
      else await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: heads[i] })), 'Workshop Productivity Report', file, 'landscape', '', { currency: activeCurrency })
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const inputCls = 'w-full min-h-[44px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)]'

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workshop Analytics" subtitle="Workshop productivity history and trends." icon={TrendingUp} />
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <ShieldAlert size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">You do not have access to workshop analytics.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">This view is limited to Admin, Manager and Director roles.</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshop Analytics"
        subtitle="Productivity history and trends: daily productive, blocked and unassigned hours, utilization, delay cost by cause, technician leaderboard, first-time-fix and target vs actual. Reuses the live workshop engine."
        icon={TrendingUp}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => exportLeaderboard('excel')} disabled={!lbRows.length} className={BTN}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => exportLeaderboard('pdf')} disabled={!lbRows.length} className={BTN}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        )}
      />

      {missing && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Workshop activity tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              The <span className="font-mono text-[var(--text-primary)]">tech_activity_events</span> and <span className="font-mono text-[var(--text-primary)]">work_orders</span> tables must exist, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Workshop analytics could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button type="button" onClick={load} className={`${BTN} mt-2`}>Retry</button>
          </div>
        </Card>
      )}

      {exportError && (
        <Card tone="crit" role="alert" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={16} className="text-red-500 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-primary)]">{exportError}</p>
        </Card>
      )}

      {/* Filters. Not `clip`: this card holds a native select and DateField pickers. */}
      <Card>
        <CardHeader title={filterCount ? `Filters (${filterCount})` : 'Filters'} level={2} icon={Filter} />
        <div role="group" aria-label="Quick date ranges" className="flex flex-wrap gap-1.5" style={{ marginBottom: 'var(--space-3)' }}>
          {ranges.map((q) => (
            <button
              key={q.id}
              type="button"
              aria-pressed={activeRange === q.id}
              onClick={() => setFilters((f) => ({ ...f, from: q.from, to: q.to }))}
              className={`min-h-[40px] text-xs px-3 rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] ${activeRange === q.id
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[var(--gap-grid)]">
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span id="wa-from">From</span>
            <DateField className="text-sm" value={filters.from} onChange={(v) => setFilter('from', v)} placeholder="From date" ariaLabel="From date" />
          </div>
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span id="wa-to">To</span>
            <DateField className="text-sm" value={filters.to} onChange={(v) => setFilter('to', v)} placeholder="To date" ariaLabel="To date" min={filters.from || undefined} />
          </div>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">All sites</option>
              {siteOptions.map((si) => <option key={si} value={si}>{si}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={resetFilters} disabled={!filterCount} className={BTN}>
              <X size={14} aria-hidden="true" /> Reset filters
            </button>
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-[var(--gap-grid)]" aria-busy={loading}>
        {kpis.map((k) => {
          const Icon = KPI_ICON[k.id] || Activity
          return (
            <Card key={k.id}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{loading ? '...' : (error ? 'N/A' : k.value)}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>
            </Card>
          )
        })}
      </div>

      {loading ? (
        <Card aria-busy="true"><CardBody className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</CardBody></Card>
      ) : error ? (
        <Card>
          <CardBody className="text-center text-[var(--text-muted)]" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
            <p className="text-sm">No figures are shown because the workshop history could not be read.</p>
          </CardBody>
        </Card>
      ) : !hasActivity ? (
        <Card>
          <CardBody className="text-center text-[var(--text-muted)]" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
            <TrendingUp size={30} className="mx-auto mb-2 opacity-50" aria-hidden="true" />
            <p className="text-sm">No workshop activity in this range.</p>
            <p className="text-xs mt-1">Technicians logging jobs and blockers (Workshop Live Control) populate this report.</p>
            {filterCount > 0 && <button type="button" onClick={resetFilters} className={`${BTN} mt-3`}>Reset filters</button>}
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Trend charts. No `clip` on chart cards so tooltips are not cut off. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
            <Card>
              <CardHeader title="Utilization trend" icon={TrendingUp} level={2} />
              <CardBody className="h-[260px]">
                {trend.length ? <EChart option={utilizationOption} ariaLabel="Daily utilization trend" /> : <EmptyChart />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Productive vs blocked vs unassigned" icon={Activity} level={2} />
              <CardBody className="h-[260px]">
                {trend.length ? <EChart option={timeStackOption} ariaLabel="Daily hours by classification" /> : <EmptyChart />}
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
            <Card className="lg:col-span-2">
              <CardHeader title="Delay cost by root cause" icon={AlertTriangle} level={2} />
              <CardBody style={{ height: Math.max(180, delayCostRows.length * 42) }}>
                {delayCostRows.length ? <EChart option={delayCostOption} ariaLabel="Delay cost by cause" /> : <EmptyChart hint="No blocked time recorded in this range." />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="First time fix" icon={Gauge} level={2} />
              <CardBody className="h-[220px]">
                <EChart option={ftfGaugeOption} ariaLabel={`First time fix rate ${ftf.rate == null ? 'not measurable' : `${Math.round(ftf.rate * 100)} percent`}`} />
              </CardBody>
              <p className="text-center text-xs text-[var(--text-muted)] -mt-2">
                {ftf.rate == null ? 'No completed jobs to measure.' : `${fmtNum(ftf.firstTime)} of ${fmtNum(ftf.completed)} completed jobs with no rework.`}
              </p>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Target vs actual completion time"
              icon={Target}
              level={2}
              description={tva ? (
                <>
                  avg target {fmtMin(tva.avgTargetMin)} | avg actual {fmtMin(tva.avgActualMin)}
                  {tva.variancePct != null ? ` | variance ${tva.variancePct > 0 ? '+' : ''}${tva.variancePct}%` : ''}
                </>
              ) : undefined}
            />
            <CardBody className="h-[260px]">
              {tvaOption ? <EChart option={tvaOption} ariaLabel="Target vs actual completion time" /> : <EmptyChart hint="No jobs with a target (standard hours or estimated minutes) and a recorded duration." />}
            </CardBody>
          </Card>

          {/* Technician leaderboard: EnterpriseTable pages and sorts the WHOLE set. */}
          <Card>
            <CardHeader title="Technician leaderboard" icon={Users} level={2} description={`${lbRows.length} with activity`} />
            <EnterpriseTable
              columns={lbColumns}
              data={lbRows}
              getRowId={(r) => r.id}
              initialPageSize={25}
              searchPlaceholder="Search technicians"
              emptyMessage="No technician activity in this range."
              exportFileName="Workshop Technician Leaderboard"
              reportMeta={{ title: 'Workshop Technician Leaderboard', currency: activeCurrency }}
            />
          </Card>

          {dRows.length > 0 && (
            <Card>
              <CardHeader
                title="Delay accountability"
                icon={Timer}
                level={2}
                description={`${fmtNum(dTotals.hours)} h lost | ${fmtNum(dTotals.cost)} ${activeCurrency || ''} impact | ${dTotals.highPriority} high priority`}
              />
              <EnterpriseTable
                columns={delayColumns}
                data={dRows}
                getRowId={(r) => r.id}
                initialPageSize={25}
                searchPlaceholder="Search causes, departments or actions"
                emptyMessage="No delays match."
                exportFileName="Workshop Delay Accountability"
                reportMeta={{ title: 'Workshop Delay Accountability', currency: activeCurrency }}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function EmptyChart({ hint = 'No data for the selected filters.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <TrendingUp size={26} className="opacity-40 mb-2" aria-hidden="true" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
