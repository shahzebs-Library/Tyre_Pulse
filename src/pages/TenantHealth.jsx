import { useState, useEffect, useCallback } from 'react'
import {
  Building2, Users, Activity, Database, DollarSign, RefreshCw,
  AlertCircle, ShieldAlert, Lock, UserPlus, Layers, Clock, Zap,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import { runTenantReport, WINDOW_DAYS } from '../lib/tenantHealth'

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString()
}

function formatUSD(n) {
  if (n === null || n === undefined) return '$0.000'
  return `$${Number(n).toFixed(n >= 100 ? 2 : 4)}`
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n ?? 0)
}

function formatStamp(iso) {
  if (!iso) return '—'
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
          <span>{slice.error}</span>
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TenantHealth() {
  const { profile } = useAuth()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await runTenantReport())
    } finally {
      setLoading(false)
    }
  }, [])

  const isAdmin = profile?.role === 'Admin'

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

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

  const totalRecords = growth?.status === 'ok' ? growth.data.totalRecords : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tenant Health"
        subtitle={`Platform usage, adoption, and cost — last ${WINDOW_DAYS} days`}
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

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={users?.status === 'ok' ? formatNumber(users.data.total) : '—'}
          sub={users?.status === 'ok' ? `${users.data.locked} locked` : null}
          badge={users?.status === 'ok' ? users.data.pending : null}
          icon={Users}
        />
        <StatCard
          label={`Active Users (${WINDOW_DAYS}d)`}
          value={activity?.status === 'ok' ? formatNumber(activity.data.activeUsers) : '—'}
          sub={activity?.status === 'ok' ? `${formatNumber(activity.data.totalEvents)} events` : null}
          icon={Activity}
        />
        <StatCard
          label="Total Records"
          value={totalRecords != null ? formatNumber(totalRecords) : '—'}
          sub="across core tables"
          icon={Database}
        />
        <StatCard
          label={`AI Spend (${WINDOW_DAYS}d)`}
          value={ai?.status === 'ok' ? formatUSD(ai.data.totalCost) : '—'}
          sub={ai?.status === 'ok' ? `${formatTokens(ai.data.totalTokens)} tokens · ${formatNumber(ai.data.totalCalls)} calls` : null}
          icon={DollarSign}
        />
      </div>

      {/* Activity trend */}
      <Section
        title={`Activity — events per day (${WINDOW_DAYS}d)`}
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
          <div className="grid grid-cols-2 gap-3">
            {(growth?.data?.tables ?? []).map((t) => (
              <div
                key={t.table}
                className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] px-3 py-2.5"
              >
                <p className="text-lg font-bold text-[var(--text-primary)] leading-tight">
                  {t.error ? '—' : formatNumber(t.count)}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.label}</p>
                {t.error && <p className="text-xs text-red-400 mt-0.5 truncate" title={t.error}>unavailable</p>}
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
            ? 'No AI usage logged yet — ai_token_logs is empty. Spend will appear here once AI features start writing token logs.'
            : null}
        >
          <DayBars data={ai?.data?.costPerDay} dataKey="cost" height={64} />
          <div>
            <p className="text-label mb-3">Spend by Feature</p>
            <BarList
              items={(ai?.data?.byFeature ?? []).map((f) => ({
                label: f.feature,
                value: f.cost,
                display: `${formatUSD(f.cost)} · ${formatTokens(f.tokens)} tok`,
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
            ? 'No module activity in this window — adoption is derived from audit log activity.'
            : null}
        >
          <BarList
            items={(adoption?.data ?? []).map((m) => ({
              label: m.module,
              value: m.events,
              display: `${formatNumber(m.events)} · ${m.share}%`,
            }))}
          />
        </Section>
      </div>
    </div>
  )
}
