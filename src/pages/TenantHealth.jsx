import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Building2, Users, Activity, Database, DollarSign, RefreshCw,
  AlertCircle, ShieldAlert, Lock, UserPlus, Layers, Clock, Zap,
  FileSpreadsheet, FileText, Search, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Info, UserCheck, Gauge,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { runTenantReport, WINDOW_DAYS } from '../lib/tenantHealth'
import {
  tenantKpis, healthSignals, registerRows, searchRows, exportRowsFor, REGISTER_SECTIONS,
} from '../lib/tenantHealthAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n === null || n === undefined) return 'N/A'
  return Number(n).toLocaleString()
}

function formatUSD(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'N/A'
  return `$${Number(n).toFixed(n >= 100 ? 2 : 4)}`
}

function formatPct(rate) {
  if (rate === null || rate === undefined) return 'N/A'
  return `${Math.round(rate * 100)}%`
}

function formatTokens(n) {
  if (n === null || n === undefined) return 'N/A'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n ?? 0)
}

function formatStamp(iso) {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Small presentational pieces ───────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, badge }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-[var(--accent)]/10">
        <Icon className="w-5 h-5 text-[var(--accent)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{value}</p>
          {badge != null && badge > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">
              {badge} pending
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
        {sub && <p className="text-xs text-[var(--text-dim)] mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

/** Section wrapper with isolated error/empty handling per report slice. */
function Section({ title, icon: Icon, slice, loading, emptyText, children }) {
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-[var(--text-muted)]" />}
        <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 rounded bg-[var(--panel-2)] w-3/4" />
          <div className="h-4 rounded bg-[var(--panel-2)] w-1/2" />
          <div className="h-4 rounded bg-[var(--panel-2)] w-2/3" />
        </div>
      ) : slice?.status === 'error' ? (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{toUserMessage(slice.error, 'This section could not be loaded.')}</span>
        </div>
      ) : emptyText ? (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  )
}

/** Horizontal ratio bar list (used for roles, features, modules, actions). */
function BarList({ items, valueLabel }) {
  if (!items?.length) return null
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-[var(--text-secondary)] text-xs font-medium truncate max-w-48">{item.label}</span>
            <span className="text-[var(--text-primary)] text-xs font-semibold">
              {item.display ?? formatNumber(item.value)}{valueLabel ? ` ${valueLabel}` : ''}
            </span>
          </div>
          <div className="w-full rounded-full h-2 bg-[var(--panel-2)]">
            <div
              className="h-2 rounded-full bg-[var(--accent)] transition-all"
              style={{ width: `${((item.value / max) * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inline SVG bar chart for a zero-filled per-day series. */
function DayBars({ data, dataKey, height = 90 }) {
  if (!data?.length) return null
  const vals = data.map((d) => d[dataKey] ?? 0)
  const max = Math.max(...vals, 1)
  const w = 600
  const gap = 2
  const barW = (w - gap * (vals.length - 1)) / vals.length
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {vals.map((v, i) => {
          const h = Math.max((v / max) * (height - 6), v > 0 ? 3 : 1)
          return (
            <rect
              key={data[i].date}
              x={i * (barW + gap)}
              y={height - h}
              width={barW}
              height={h}
              rx={1.5}
              fill="var(--accent)"
              opacity={v > 0 ? 0.9 : 0.18}
            />
          )
        })}
      </svg>
      <div className="flex justify-between text-[var(--text-dim)] text-xs mt-1 px-0.5">
        <span>{data[0]?.date?.slice(5)}</span>
        <span>{data[Math.floor(data.length / 2)]?.date?.slice(5)}</span>
        <span>{data[data.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  )
}

const SIGNAL_TONE = {
  critical: { cls: 'text-red-400 bg-red-400/10 border-red-400/20', Icon: AlertTriangle },
  warning: { cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20', Icon: AlertCircle },
  info: { cls: 'text-sky-400 bg-sky-400/10 border-sky-400/20', Icon: Info },
}

function TrendBadge({ trend }) {
  if (!trend || trend.direction == null) return <span className="text-xs text-[var(--text-dim)]">Trend N/A</span>
  const Icon = trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus
  const cls = trend.direction === 'up' ? 'text-emerald-400' : trend.direction === 'down' ? 'text-red-400' : 'text-[var(--text-muted)]'
  const label = trend.change == null
    ? (trend.direction === 'up' ? 'New activity' : 'Flat')
    : `${trend.change > 0 ? '+' : ''}${trend.change}% second half vs first`
  return <span className={`text-xs flex items-center gap-1 ${cls}`}><Icon className="w-3.5 h-3.5" />{label}</span>
}

/** TanStack column defs per register section. */
function columnsFor(section) {
  const num = (key, header, fmt = formatNumber) => ({
    accessorKey: key,
    header,
    meta: { align: 'right' },
    cell: ({ getValue }) => fmt(getValue()),
  })
  const text = (key, header) => ({ accessorKey: key, header, cell: ({ getValue }) => getValue() ?? 'N/A' })
  switch (section) {
    case 'modules':
      return [text('module', 'Module'), num('events', 'Events'), num('share', 'Share', (v) => (v == null ? 'N/A' : `${v}%`))]
    case 'roles':
      return [text('role', 'Role'), num('users', 'Users'), num('share', 'Share', (v) => (v == null ? 'N/A' : `${v}%`))]
    case 'tables':
      return [text('label', 'Dataset'), text('table', 'Table'), num('count', 'Records'), text('state', 'State')]
    case 'features':
      return [text('feature', 'Feature'), num('calls', 'Calls'), num('tokens', 'Tokens', formatTokens), num('cost', 'Cost (USD)', formatUSD), num('costPerCall', 'Cost per call (USD)', formatUSD)]
    case 'pending':
      return [text('name', 'Name'), text('role', 'Role'), text('requested', 'Requested'), num('waitingDays', 'Waiting (days)')]
    default:
      return []
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TenantHealth() {
  const { profile } = useAuth()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [section, setSection] = useState('modules')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setReport(await runTenantReport())
    } catch (err) {
      setLoadError(toUserMessage(err, 'The tenant report could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const isAdmin = profile?.role === 'Admin'

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  const kpis = useMemo(() => (report ? tenantKpis(report) : null), [report])
  const signals = useMemo(() => (report ? healthSignals(report, { now: Date.now() }) : []), [report])
  const register = useMemo(
    () => (report ? registerRows(report, section, { now: Date.now() }) : { available: false, rows: [] }),
    [report, section],
  )
  const shownRows = useMemo(() => searchRows(register.rows, search), [register, search])
  const columns = useMemo(() => columnsFor(section), [section])

  const runExport = async (kind) => {
    const spec = REGISTER_SECTIONS[section]
    if (!spec || shownRows.length === 0) return
    setExporting(true)
    setExportError('')
    try {
      const rows = exportRowsFor(section, shownRows)
      const name = reportFileName('Tenant Health', spec.label, new Date().toISOString().slice(0, 10))
      if (kind === 'excel') {
        await exportToExcel(rows, spec.cols, spec.headers, name, spec.label.slice(0, 30))
      } else {
        await exportToPdf(rows, spec.cols.map((k, i) => ({ key: k, header: spec.headers[i] })), `Tenant Health: ${spec.label}`, name, 'landscape')
      }
    } catch (err) {
      setExportError(toUserMessage(err, 'The export could not be created.'))
    } finally {
      setExporting(false)
    }
  }

  // ── Admin guard ──────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tenant Health" subtitle="Platform usage and adoption" icon={Building2} />
        <div className="card p-10 text-center max-w-xl mx-auto w-full">
          <ShieldAlert className="w-10 h-10 mx-auto mb-4 text-[var(--text-dim)]" />
          <h3 className="font-semibold text-[var(--text-primary)] mb-1">Admin access required</h3>
          <p className="text-sm text-[var(--text-muted)]">
            The Tenant Health dashboard shows platform-wide usage, user, and cost data
            and is restricted to administrators. Ask an Admin if you need this view.
          </p>
        </div>
      </div>
    )
  }

  const users    = report?.users
  const activity = report?.activity
  const ai       = report?.ai
  const growth   = report?.growth
  const adoption = report?.adoption

  if (loadError && !report) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tenant Health" subtitle="Platform usage and adoption" icon={Building2} />
        <div className="card p-8 text-center space-y-3" role="alert">
          <p className="text-sm text-red-400 flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" /> {loadError}
          </p>
          <button type="button" onClick={load} className="btn-primary inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    )
  }

  const sectionSpec = REGISTER_SECTIONS[section]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tenant Health"
        subtitle={`Platform usage, adoption, and cost, last ${WINDOW_DAYS} days`}
        icon={Building2}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Last updated: {formatStamp(report?.generatedAt)}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto btn-secondary px-3 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loadError && report && (
        <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
          <AlertCircle className="w-3.5 h-3.5" /> {loadError} Showing the last loaded figures.
        </p>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={formatNumber(kpis?.totalUsers)}
          sub={kpis?.locked != null ? `${kpis.locked} locked` : null}
          badge={kpis?.pending}
          icon={Users}
        />
        <StatCard
          label={`Active Users (${WINDOW_DAYS}d)`}
          value={formatNumber(kpis?.activeUsers)}
          sub={kpis?.totalEvents != null ? `${formatNumber(kpis.totalEvents)} recorded audit events` : null}
          icon={Activity}
        />
        <StatCard
          label="Total Records"
          value={formatNumber(kpis?.totalRecords)}
          sub={growth?.status === 'ok' && growth.data.complete === false ? 'some tables could not be counted' : 'across core tables'}
          icon={Database}
        />
        <StatCard
          label={`AI Spend (${WINDOW_DAYS}d, USD)`}
          value={formatUSD(kpis?.aiCost)}
          sub={kpis?.aiCalls != null ? `${formatTokens(kpis.aiTokens)} tokens, ${formatNumber(kpis.aiCalls)} calls` : null}
          icon={DollarSign}
        />
        <StatCard
          label="Activation rate"
          value={formatPct(kpis?.activationRate)}
          sub="active users out of approved users"
          icon={UserCheck}
        />
        <StatCard
          label="Approval rate"
          value={formatPct(kpis?.approvalRate)}
          sub={kpis?.approved != null ? `${formatNumber(kpis.approved)} approved` : null}
          icon={CheckCircle2}
        />
        <StatCard
          label="Events per active user"
          value={kpis?.eventsPerActiveUser != null ? String(kpis.eventsPerActiveUser) : 'N/A'}
          sub={`over ${WINDOW_DAYS} days`}
          icon={Gauge}
        />
        <StatCard
          label="AI cost per call (USD)"
          value={formatUSD(kpis?.aiCostPerCall)}
          sub={kpis?.modulesInUse != null ? `${kpis.modulesInUse} modules in use` : null}
          icon={Zap}
        />
      </div>

      {/* Health signals */}
      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Health signals</h3>
          <span className="ml-auto"><TrendBadge trend={kpis?.activityTrend} /></span>
        </div>
        {loading && !report ? (
          <div className="h-4 rounded bg-[var(--panel-2)] w-1/2 animate-pulse" />
        ) : signals.length === 0 ? (
          <p className="text-sm text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Nothing needs attention in this window.
          </p>
        ) : (
          <ul className="space-y-2">
            {signals.map((sig) => {
              const tone = SIGNAL_TONE[sig.severity] || SIGNAL_TONE.info
              return (
                <li key={sig.key} className={`flex items-start gap-2 text-sm border rounded-lg px-3 py-2 ${tone.cls}`}>
                  <tone.Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{sig.title}</p>
                    <p className="text-xs text-[var(--text-muted)]">{sig.detail}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Activity trend */}
      <Section
        title={`Activity: events per day (${WINDOW_DAYS}d)`}
        icon={Activity}
        slice={activity}
        loading={loading}
        emptyText={activity?.status === 'ok' && activity.data.totalEvents === 0
          ? 'No audit activity recorded in this window.'
          : null}
      >
        <DayBars data={activity?.data?.eventsPerDay} dataKey="events" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          <div>
            <p className="text-label mb-3">Top Actions</p>
            <BarList items={(activity?.data?.topActions ?? []).map((a) => ({ label: a.key, value: a.count }))} />
          </div>
          <div>
            <p className="text-label mb-3">Top Tables</p>
            <BarList items={(activity?.data?.topTables ?? []).map((t) => ({ label: t.key, value: t.count }))} />
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Users */}
        <Section
          title="Users"
          icon={Users}
          slice={users}
          loading={loading}
          emptyText={users?.status === 'ok' && users.data.total === 0 ? 'No user profiles found.' : null}
        >
          <BarList
            items={Object.entries(users?.data?.byRole ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([role, count]) => ({ label: role, value: count }))}
          />
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] pt-1">
            <span className="flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />{users?.data?.newLast30 ?? 0} new in {WINDOW_DAYS}d
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />{users?.data?.locked ?? 0} locked
            </span>
          </div>
          {(users?.data?.pendingUsers?.length ?? 0) > 0 && (
            <div className="border-t border-[var(--input-border)] pt-3">
              <p className="text-label mb-2">Pending Approval</p>
              <ul className="space-y-1.5">
                {users.data.pendingUsers.slice(0, 6).map((u) => (
                  <li key={u.id} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-secondary)] truncate">{u.name}</span>
                    <span className="text-[var(--text-dim)] text-xs">{u.role}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--text-dim)] mt-2">
                Approve users in User Management (/users).
              </p>
            </div>
          )}
        </Section>

        {/* Data growth */}
        <Section title="Data Growth" icon={Database} slice={growth} loading={loading}>
          {growth?.data?.complete === false && <p className="text-sm text-amber-400 mb-3">Some table counts failed. The combined total is unavailable.</p>}
          <div className="grid grid-cols-2 gap-3">
            {(growth?.data?.tables ?? []).map((t) => (
              <div
                key={t.table}
                className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] px-3 py-2.5"
              >
                <p className="text-lg font-bold text-[var(--text-primary)] leading-tight">
                  {t.error ? 'N/A' : formatNumber(t.count)}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.label}</p>
                {t.error && <p className="text-xs text-red-400 mt-0.5 truncate">unavailable</p>}
              </div>
            ))}
          </div>
        </Section>

        {/* AI usage */}
        <Section
          title={`AI Usage (${WINDOW_DAYS}d)`}
          icon={Zap}
          slice={ai}
          loading={loading}
          emptyText={ai?.status === 'ok' && ai.data.totalCalls === 0
            ? 'No AI usage logged yet. ai_token_logs is empty. Spend will appear here once AI features start writing token logs.'
            : null}
        >
          <DayBars data={ai?.data?.costPerDay} dataKey="cost" height={64} />
          <div>
            <p className="text-label mb-3">Spend by Feature</p>
            <BarList
              items={(ai?.data?.byFeature ?? []).map((f) => ({
                label: f.feature,
                value: f.cost,
                display: `${formatUSD(f.cost)}, ${formatTokens(f.tokens)} tok`,
              }))}
            />
          </div>
        </Section>

        {/* Module adoption */}
        <Section
          title={`Module Adoption (${WINDOW_DAYS}d)`}
          icon={Layers}
          slice={adoption}
          loading={loading}
          emptyText={adoption?.status === 'ok' && adoption.data.length === 0
            ? 'No module activity in this window. Adoption is derived from audit log activity.'
            : null}
        >
          <BarList
            items={(adoption?.data ?? []).map((m) => ({
              label: m.module,
              value: m.events,
              display: `${formatNumber(m.events)}, ${m.share}%`,
            }))}
          />
        </Section>
      </div>

      {/* Register: searchable, exportable detail behind the charts */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-[var(--text-primary)]">Detail register</h3>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Register section">
            {Object.entries(REGISTER_SECTIONS).map(([key, spec]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={section === key}
                onClick={() => { setSection(key); setSearch('') }}
                className={`px-2.5 py-1 rounded-lg text-xs border ${section === key
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${sectionSpec.label.toLowerCase()}`}
              aria-label="Search register"
              className="input w-full pl-8 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => runExport('excel')}
            disabled={exporting || shownRows.length === 0}
            className="btn-secondary px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button
            type="button"
            onClick={() => runExport('pdf')}
            disabled={exporting || shownRows.length === 0}
            className="btn-secondary px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
        {exportError && <p className="text-xs text-red-400" role="alert">{exportError}</p>}
        <p className="text-[11px] text-[var(--text-dim)]">
          {shownRows.length} of {register.rows.length} rows shown. Exports include only the rows shown.
        </p>
        <EnterpriseTable
          columns={columns}
          data={shownRows}
          getRowId={(r) => String(r.id)}
          loading={loading && !report}
          error={report && !register.available ? 'This section could not be read in the last report.' : null}
          onRetry={load}
          enableGlobalFilter={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={search ? 'No rows match this search' : 'Nothing recorded for this section in the window'}
        />
      </div>
    </div>
  )
}
