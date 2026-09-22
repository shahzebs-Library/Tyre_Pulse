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
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import DateField from '../components/ui/DateField'
import EChart from '../components/charts/EChart'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { loadWorkshopHistory, distinctSites } from '../lib/api/workshopAnalytics'
import { computeWorkshopAnalytics } from '../lib/workshopAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { isMissingRelation } from '../lib/api/_client'

const VIEW_ROLES = new Set(['Admin', 'Manager', 'Director'])

const AXIS_LABEL = '#9ca3af'
const AXIS_STRONG = '#64748b'

const REASON_LABEL = {
  parts: 'Parts', tools: 'Tools', approval: 'Approval',
  vehicle: 'Vehicle', vendor: 'Vendor', support: 'Support',
}
const labelReason = (r) => REASON_LABEL[r] || (r ? String(r).replace(/_/g, ' ') : 'Other')
const PRIORITY_TONE = {
  high: 'bg-red-500/15 text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

const todayISO = () => new Date().toISOString().slice(0, 10)
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtHours(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString()} h` : 'N/A'
}
function fmtPct(v) {
  return v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Math.round(Number(v))}%`
}
function fmtMin(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${Math.round(n)} min` : 'N/A'
}

export default function WorkshopAnalytics() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canView = isSuperAdmin === true || VIEW_ROLES.has(profile?.role)

  const [data, setData] = useState({ events: [], jobs: [], shifts: [], technicians: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState({ from: daysAgo(14), to: todayISO(), site: 'All' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const resetFilters = () => setFilters({ from: daysAgo(14), to: todayISO(), site: 'All' })

  // Changing the date range or site refetches without waiting for the load
  // already in flight. If the earlier one finishes last it shows the PREVIOUS
  // window's productivity under the new filters - wrong hours, no error, and a
  // refresh appears to fix it.
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
      // A superseded load must not raise a banner over data that loaded fine.
      if (stale()) return
      if (isMissingRelation(err)) { setMissing(true); setData({ events: [], jobs: [], shifts: [], technicians: [] }) }
      else setError(toUserMessage(err, 'Could not load workshop analytics.'))
    } finally {
      // Clearing these from a stale load would make the newer one look finished.
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
  const techniciansPager = usePagedRows(analytics.technicianLeaderboard)
  const delaysPager = usePagedRows(analytics.delayByReason)

  // ── ECharts options ─────────────────────────────────────────────────────────
  const trend = analytics.dailyTrend
  const dayLabels = trend.map((d) => d.date.slice(5))

  const utilizationOption = useMemo(() => ({
    grid: { left: 8, right: 16, top: 24, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'N/A' : `${v}%`) },
    xAxis: { type: 'category', data: dayLabels, axisLabel: { color: AXIS_LABEL, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, name: 'Utilization %', nameTextStyle: { color: AXIS_LABEL }, axisLabel: { color: AXIS_LABEL, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
    series: [{
      type: 'line', smooth: true, connectNulls: false,
      data: trend.map((d) => d.utilization),
      itemStyle: { color: colorAt(0) },
      lineStyle: { color: colorAt(0), width: 2 },
      areaStyle: { color: withAlpha(colorAt(0), 0.15) },
      symbolSize: 6,
    }],
  }), [trend, dayLabels])

  const timeStackOption = useMemo(() => {
    const mk = (name, key, ci, fill) => ({
      name, type: 'line', stack: 'time', areaStyle: { color: withAlpha(colorAt(ci), fill) },
      lineStyle: { color: colorAt(ci), width: 1 }, itemStyle: { color: colorAt(ci) }, smooth: true, symbol: 'none',
      data: trend.map((d) => d[key]),
    })
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 24, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? 'N/A' : `${v} h`) },
      legend: { top: 0, textStyle: { color: AXIS_STRONG, fontSize: 11 } },
      xAxis: { type: 'category', data: dayLabels, axisLabel: { color: AXIS_LABEL, fontSize: 10 } },
      yAxis: { type: 'value', name: 'Hours', nameTextStyle: { color: AXIS_LABEL }, axisLabel: { color: AXIS_LABEL }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      series: [
        mk('Productive', 'productiveHours', 0, 0.5),
        mk('Blocked', 'blockedHours', 3, 0.4),
        mk('Unassigned', 'unassignedHours', 5, 0.35),
      ],
    }
  }, [trend, dayLabels])

  const delayRows = analytics.delayCostTrend
  const delayCostOption = useMemo(() => {
    const rows = [...delayRows].reverse() // hbar renders bottom-up
    return {
      grid: { left: 8, right: 56, top: 10, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const d = rows[p[0].dataIndex]
          return `${labelReason(d.reason)}<br/>Cost impact: <b>${fmtNum(d.costImpact)} ${activeCurrency || ''}</b>`
        },
      },
      xAxis: { type: 'value', name: `Cost (${activeCurrency || 'value'})`, nameTextStyle: { color: AXIS_LABEL }, axisLabel: { color: AXIS_LABEL }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      yAxis: { type: 'category', data: rows.map((d) => labelReason(d.reason)), axisLabel: { color: AXIS_STRONG } },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: rows.map((d, i) => ({ value: d.costImpact, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: AXIS_STRONG, formatter: (p) => fmtNum(p.value) },
      }],
    }
  }, [delayRows, activeCurrency])

  const ftf = analytics.firstTimeFix
  const ftfGaugeOption = useMemo(() => {
    const pct = ftf.rate == null ? null : Math.round(ftf.rate * 100)
    return {
      series: [{
        type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
        radius: '92%', center: ['50%', '58%'],
        progress: { show: true, width: 14, itemStyle: { color: colorAt(0) } },
        axisLine: { lineStyle: { width: 14, color: [[1, 'var(--panel-2)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: AXIS_LABEL, fontSize: 9, distance: 14 },
        pointer: { show: pct != null, width: 4, itemStyle: { color: colorAt(0) } },
        anchor: { show: false },
        detail: {
          valueAnimation: true, offsetCenter: [0, '2%'], fontSize: 26, fontWeight: 700,
          color: 'var(--text-primary)', formatter: () => (pct == null ? 'N/A' : `${pct}%`),
        },
        data: [{ value: pct == null ? 0 : pct }],
      }],
    }
  }, [ftf])

  const tva = analytics.targetVsActual
  const tvaOption = useMemo(() => {
    if (!tva) return null
    const rows = tva.rows.slice(0, 12)
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 40, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (v == null ? 'N/A' : `${v} min`) },
      legend: { top: 0, textStyle: { color: AXIS_STRONG, fontSize: 11 } },
      xAxis: { type: 'category', data: rows.map((r) => String(r.jobNo)), axisLabel: { color: AXIS_LABEL, fontSize: 9, rotate: 30 } },
      yAxis: { type: 'value', name: 'Minutes', nameTextStyle: { color: AXIS_LABEL }, axisLabel: { color: AXIS_LABEL }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      series: [
        { name: 'Target', type: 'bar', barMaxWidth: 16, data: rows.map((r) => r.targetMin), itemStyle: { color: withAlpha(colorAt(1), 0.85) } },
        { name: 'Actual', type: 'bar', barMaxWidth: 16, data: rows.map((r) => r.actualMin), itemStyle: { color: withAlpha(colorAt(3), 0.85) } },
      ],
    }
  }, [tva])

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const s = analytics.summary
  const kpis = [
    { label: 'Avg Utilization', value: fmtPct(s.avgUtilization), sub: 'productive / on-duty', icon: Percent },
    { label: 'Productive Hours', value: fmtHours(s.totalProductiveHours), sub: 'total in range', icon: Activity },
    { label: 'Blocked Hours', value: fmtHours(s.totalBlockedHours), sub: 'waiting on a blocker', icon: Timer },
    { label: 'Unassigned Hours', value: fmtHours(s.totalUnassignedHours), sub: 'on-duty, no job', icon: Clock },
    { label: 'Jobs Completed', value: fmtNum(s.jobsCompleted), sub: 'work orders closed', icon: Wrench },
    { label: 'First Time Fix', value: fmtPct(s.firstTimeFixRate == null ? null : s.firstTimeFixRate * 100), sub: `${fmtNum(ftf.firstTime)} of ${fmtNum(ftf.completed)}`, icon: Gauge },
    { label: 'Avg Task Time', value: fmtMin(s.avgTaskDurationMin), sub: 'completed job duration', icon: Timer },
    { label: 'Delay Cost', value: fmtNum(s.totalDelayCost), sub: `${activeCurrency || 'value'} lost to blockers`, icon: AlertTriangle },
  ]

  // ── Exports (technician leaderboard) ────────────────────────────────────────
  const LB_COLS = ['rank', 'name', 'productiveHours', 'utilization', 'jobsCompleted', 'blockedHours']
  const LB_HEADERS = ['Rank', 'Technician', 'Productive (h)', 'Utilization %', 'Jobs Completed', 'Blocked (h)']
  const exportRows = () => analytics.technicianLeaderboard.map((t) => ({
    rank: t.rank,
    name: t.name,
    productiveHours: t.productiveHours,
    utilization: t.utilization == null ? 'N/A' : t.utilization,
    jobsCompleted: t.jobsCompleted,
    blockedHours: t.blockedHours,
  }))
  const exportExcel = () => {
    exportToExcel(exportRows(), LB_COLS, LB_HEADERS, reportFileName('Workshop Productivity', reportDateLabel()), 'Leaderboard', { title: 'Workshop Productivity', currency: activeCurrency })
  }
  const exportPdf = () => {
    exportToPdf(
      exportRows(),
      LB_COLS.map((k, i) => ({ key: k, header: LB_HEADERS[i] })),
      'Workshop Productivity Report',
      reportFileName('Workshop Productivity', reportDateLabel()),
      'landscape',
      '',
      { currency: activeCurrency },
    )
  }

  const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'
  const quickRanges = [
    { id: '7', label: 'Last 7 days', from: daysAgo(7), to: todayISO() },
    { id: '14', label: 'Last 14 days', from: daysAgo(14), to: todayISO() },
    { id: '30', label: 'Last 30 days', from: daysAgo(30), to: todayISO() },
    { id: 'month', label: 'This month', from: firstOfMonth(), to: todayISO() },
  ]

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workshop Analytics" subtitle="Workshop productivity history and trends." icon={TrendingUp} />
        {/* Card is `flex flex-col` and Tailwind emits .flex-col after .flex-row,
            so a `flex-row` class would silently lose. The direction goes in
            `style`, which Card spreads last. The old `border-amber-800/50` is
            dropped rather than kept: Card sets `border` inline, so a border
            utility on it is dead - the amber edge comes from tone="warn". */}
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">You do not have access to workshop analytics.</p>
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
      />

      {missing && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Workshop activity tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              The <span className="font-mono text-[var(--text-primary)]">tech_activity_events</span> and <span className="font-mono text-[var(--text-primary)]">work_orders</span> tables must exist, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-blue-400 hover:text-blue-300">Retry</button>
          </div>
        </Card>
      )}

      {/* Filters. Deliberately NOT `clip`: this card holds a native <select> and
          two DateField pickers, and overflow:hidden on the surface is the exact
          clipping bug Card exists to end. */}
      <Card>
        {/* The quick ranges sit on their own wrapping row rather than in
            CardHeader's `actions`: that slot is `flex-shrink-0`, so four
            buttons in it would refuse to wrap and push a phone-width card into
            horizontal scroll. */}
        <CardHeader title="Filters" level={2} icon={Filter} />
        <div className="flex flex-wrap justify-end gap-1.5" style={{ marginBottom: 'var(--space-3)' }}>
          {quickRanges.map((q) => (
            <button
              key={q.id}
              onClick={() => setFilters((f) => ({ ...f, from: q.from, to: q.to }))}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-blue-600/50 text-[var(--text-secondary)]"
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[var(--gap-grid)]">
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span>From</span>
            <DateField className="text-sm" value={filters.from} onChange={(v) => setFilter('from', v)} placeholder="From date" ariaLabel="From date" />
          </div>
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span>To</span>
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
            <button onClick={resetFilters} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <X size={14} /> Reset
            </button>
          </div>
        </div>
      </Card>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[var(--gap-grid)]">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className="text-[var(--text-muted)]" />
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{loading ? '-' : k.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>
            </Card>
          )
        })}
      </div>

      {loading ? (
        <Card><CardBody className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</CardBody></Card>
      ) : !hasActivity ? (
        <Card>
          {/* `py-12` on a Card would be dead - Card sets padding inline and inline
              beats a class - so the extra breathing room moves onto the body. */}
          <CardBody
            className="text-center text-[var(--text-muted)]"
            style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}
          >
            <TrendingUp size={30} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No workshop activity in this range.</p>
            <p className="text-xs mt-1">Technicians logging jobs and blockers (Workshop Live Control) populate this report.</p>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Trend charts. No `clip` on any chart card: an ECharts tooltip that
              overflows its well must not be cut off. */}
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

          {/* Delay cost + first-time-fix */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
            <Card className="lg:col-span-2">
              <CardHeader title="Delay cost by root cause" icon={AlertTriangle} level={2} />
              <CardBody style={{ height: Math.max(180, delayRows.length * 42) }}>
                {delayRows.length ? <EChart option={delayCostOption} ariaLabel="Delay cost by cause" /> : <EmptyChart hint="No blocked time recorded in this range." />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="First time fix" icon={Gauge} level={2} />
              <CardBody className="h-[220px]">
                <EChart option={ftfGaugeOption} ariaLabel="First time fix rate" />
              </CardBody>
              <p className="text-center text-[11px] text-[var(--text-muted)] -mt-2">
                {ftf.rate == null ? 'No completed jobs to measure.' : `${fmtNum(ftf.firstTime)} of ${fmtNum(ftf.completed)} completed jobs with no rework.`}
              </p>
            </Card>
          </div>

          {/* Target vs actual */}
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

          {/* Technician leaderboard. The raw table markup is DELIBERATELY kept
              rather than moved to EnterpriseTable: it already pages through the
              shared usePagedRows/TablePagination primitive, and EnterpriseTable
              would bring a second pager and its own search box and export. */}
          <Card>
            <CardHeader
              title="Technician leaderboard"
              icon={Users}
              level={2}
              description={`${analytics.technicianLeaderboard.length} with activity`}
              actions={(
                <>
                  <button onClick={exportExcel} disabled={!analytics.technicianLeaderboard.length} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                  <button onClick={exportPdf} disabled={!analytics.technicianLeaderboard.length} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                    <FileText size={14} /> PDF
                  </button>
                </>
              )}
            />
            {analytics.technicianLeaderboard.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">No technician activity in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">Technician</th>
                      <th className="py-2 pr-3 font-medium text-right">Productive (h)</th>
                      <th className="py-2 pr-3 font-medium text-right">Utilization</th>
                      <th className="py-2 pr-3 font-medium text-right">Jobs</th>
                      <th className="py-2 font-medium text-right">Blocked (h)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {techniciansPager.pageRows.map((t) => (
                      <tr key={t.userId} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                        <td className="py-2 pr-3 text-[var(--text-muted)]">{t.rank}</td>
                        <td className="py-2 pr-3 text-[var(--text-primary)]">{t.name}</td>
                        <td className="py-2 pr-3 text-right text-emerald-300">{fmtNum(t.productiveHours)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtPct(t.utilization)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(t.jobsCompleted)}</td>
                        <td className="py-2 text-right text-amber-300">{fmtNum(t.blockedHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination {...techniciansPager} />
              </div>
            )}
          </Card>

          {/* Delay accountability. Raw table markup kept for the same reason as
              the leaderboard, plus a composite priority-pill cell that
              EnterpriseTable would have to re-express. */}
          {delayRows.length > 0 && (
            <Card>
              <CardHeader title="Delay accountability" icon={Timer} level={2} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">Cause</th>
                      <th className="py-2 pr-3 font-medium text-right">Hours lost</th>
                      <th className="py-2 pr-3 font-medium text-right">Cost impact</th>
                      <th className="py-2 pr-3 font-medium">Responsible</th>
                      <th className="py-2 pr-3 font-medium">Suggested action</th>
                      <th className="py-2 font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {delaysPager.pageRows.map((d) => (
                      <tr key={d.reason} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                        <td className="py-2 pr-3 text-[var(--text-primary)]">{labelReason(d.reason)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(d.hoursLost)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(d.costImpact)}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{d.responsibleDept}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{d.suggestedAction}</td>
                        <td className="py-2">
                          <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${PRIORITY_TONE[d.priority] || PRIORITY_TONE.low}`}>
                            {d.priority}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination {...delaysPager} />
              </div>
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
      <TrendingUp size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
