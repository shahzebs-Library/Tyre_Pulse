/**
 * ConsoleDelivery - super-admin "Delivery & Notifications" console page.
 *
 * A pure console page (useConsoleAuth for the admin gate). Shows how reliably
 * the platform reaches people over its two delivery channels:
 *   - Email  (report_send_log): scheduled-report emails, sent vs failed.
 *   - Push   (workflow_notifications): queued / delivered / failed device pushes.
 *   - Reach  (profiles.push_token): how many devices could receive a push.
 *
 * KPI tiles, one trend chart per channel (sent and failed per day over the
 * chosen range), and a combined recent-failures table with Excel export.
 * Super-admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Send, RefreshCw, ShieldAlert, Mail, Bell, Users, Info, Download, XCircle,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listEmailLog, listPushLog, pushReach, emailStats, pushStats,
} from '../../lib/api/deliveryHealth'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { TrendChart, STATUS, SERIES, useChartTheme } from '../components/ui/charts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const pctStr = (r) => `${Math.round((Number(r) || 0) * 1000) / 10}%`

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

const DAY_MS = 86_400_000
/** The service reads cap at this many rows per channel (its own `limit`). */
const SERVICE_ROW_CAP = 1000
/** Longest range drawn day by day; wider ranges would make the axis unreadable. */
const MAX_TREND_DAYS = 370

/**
 * Every calendar day from `from` to `to` inclusive (YYYY-MM-DD, UTC). A day
 * with no deliveries must show as 0, not vanish from the axis: a missing day
 * reads as "no data" when the truth is "nothing was sent".
 */
function dayRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const out = []
  for (let t = start; t <= end && out.length < MAX_TREND_DAYS; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function dayLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleDelivery() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()

  const [emailRows, setEmailRows] = useState([])
  const [pushRows, setPushRows] = useState([])
  const [reach, setReach] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [pushError, setPushError] = useState(null)
  const [channel, setChannel] = useState('all')
  const [search, setSearch] = useState('')

  // Date range (defaults to the last 30 days).
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    setPushError(null)
    // End date is inclusive: extend "to" to end-of-day.
    const toEnd = to ? `${to}T23:59:59.999Z` : undefined
    const [eRes, pRes, rRes] = await Promise.allSettled([
      listEmailLog({ from, to: toEnd }),
      listPushLog({ from, to: toEnd }),
      pushReach(),
    ])
    if (eRes.status === 'fulfilled') setEmailRows(eRes.value)
    else setError(toUserMessage(eRes.reason))
    // A failed push read used to leave the previous range's rows on screen
    // with no warning. It is now cleared and stated.
    if (pRes.status === 'fulfilled') setPushRows(pRes.value)
    else { setPushRows([]); setPushError(toUserMessage(pRes.reason, 'Could not read push notifications.')) }
    setReach(rRes.status === 'fulfilled' ? rRes.value : null)
    setRefreshing(false)
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  const email = useMemo(() => emailStats(emailRows), [emailRows])
  const push = useMemo(() => pushStats(pushRows), [pushRows])

  const days = useMemo(() => dayRange(from, to), [from, to])
  const colors = STATUS[theme]
  const series = SERIES[theme]

  const emailTrend = useMemo(() => {
    const byDay = Object.fromEntries((email.byDay || []).map((d) => [d.date, d]))
    return [
      { label: 'Sent', values: days.map((k) => byDay[k]?.sent || 0), color: series[1] },
      { label: 'Failed', values: days.map((k) => byDay[k]?.failed || 0), color: colors.critical },
    ]
  }, [email, days, series, colors])

  const pushTrend = useMemo(() => {
    const byDay = Object.fromEntries((push.byDay || []).map((d) => [d.date, d]))
    return [
      { label: 'Delivered', values: days.map((k) => byDay[k]?.delivered || 0), color: series[2] },
      { label: 'Failed', values: days.map((k) => byDay[k]?.failed || 0), color: colors.critical },
    ]
  }, [push, days, series, colors])

  const labels = useMemo(() => days.map(dayLabel), [days])

  const failures = useMemo(() => {
    const rows = [...(email.recentFailures || []), ...(push.recentFailures || [])]
    return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  }, [email, push])

  const visibleFailures = useMemo(() => {
    const q = search.trim().toLowerCase()
    return failures.filter((r) => {
      if (channel !== 'all' && r.channel !== channel) return false
      if (!q) return true
      return [r.name, r.status, r.error].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [failures, channel, search])

  const capped = emailRows.length >= SERVICE_ROW_CAP || pushRows.length >= SERVICE_ROW_CAP
  const rangeInvalid = days.length === 0

  const handleExport = useCallback(async () => {
    if (visibleFailures.length === 0) return
    const rows = visibleFailures.map((r) => ({
      channel: r.channel,
      name: r.name,
      status: r.status,
      error: r.error || '',
      at: fmtDateTime(r.at),
    }))
    try {
      await exportToExcel(
        rows,
        ['channel', 'name', 'status', 'error', 'at'],
        ['Channel', 'Name', 'Status', 'Error', 'Time'],
        reportFileName('TyrePulse Delivery Failures', from, to),
        'Delivery failures',
        { title: 'Delivery failures', dateRange: `${from} to ${to}` },
      )
    } catch (err) {
      setError(toUserMessage(err))
    }
  }, [visibleFailures, from, to])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted" reason="Delivery and Notifications is reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  const emailRate = email.total ? pctStr(email.failureRate) : 'N/A'
  const pushSettled = push.delivered + push.failed
  const pushRate = pushSettled ? pctStr(push.failureRate) : 'N/A'

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <Send size={18} className="text-orange-400" /> Delivery &amp; Notifications
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            How reliably reports and notifications reach people, by email and push.
          </p>
        </div>
        <Toolbar>
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <Btn icon={RefreshCw} onClick={load} busy={refreshing}>Refresh</Btn>
        </Toolbar>
      </header>

      <ErrorState message={error} onRetry={load} />
      {rangeInvalid && (
        <Note icon={Info} tone="warning">The From date is after the To date, so there is nothing to show. Pick a valid range.</Note>
      )}
      {capped && (
        <Note icon={Info} tone="warning">
          This range holds more than {SERVICE_ROW_CAP.toLocaleString()} deliveries on at least one channel, so the figures
          cover the newest {SERVICE_ROW_CAP.toLocaleString()} per channel only. Narrow the date range for exact totals.
        </Note>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatTile label="Emails sent" value={loading ? 'N/A' : email.sent} tone="good" icon={Mail} />
        <div title="Report emails whose delivery status was not 'sent'.">
          <StatTile label="Emails failed" value={loading ? 'N/A' : email.failed} tone={email.failed > 0 ? 'danger' : 'default'} icon={Mail} />
        </div>
        <StatTile label="Email failure rate" value={loading ? 'N/A' : emailRate}
          tone={email.failureRate > 0.1 ? 'danger' : email.failureRate > 0 ? 'warning' : 'default'} icon={Mail}
          sub={email.total ? `of ${email.total} attempts` : 'No attempts'} />
        <StatTile label="Push delivered" value={loading || pushError ? 'N/A' : push.delivered} tone="good" icon={Bell}
          sub={pushError ? undefined : `${push.queued} still queued`} />
        <div title="Notifications whose status was failed or error.">
          <StatTile label="Push failed" value={loading || pushError ? 'N/A' : push.failed} tone={push.failed > 0 ? 'danger' : 'default'} icon={Bell} />
        </div>
        <StatTile label="Push failure rate" value={loading || pushError ? 'N/A' : pushRate}
          tone={push.failureRate > 0.1 ? 'danger' : push.failureRate > 0 ? 'warning' : 'default'} icon={Bell}
          sub={pushSettled ? `of ${pushSettled} settled` : 'Nothing settled'} />
        <div title="Devices with a registered push token that could receive a notification.">
          <StatTile label="Push reach" value={reach == null ? 'N/A' : reach} tone="accent" icon={Users} sub="Devices with a token" />
        </div>
      </div>

      {/* Trend charts: one per channel, never a second axis */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Mail} title="Report emails per day" subtitle="Sent and failed, across the selected range." />
          {loading ? <LoadingState label="Loading email deliveries" rows={3} /> : (
            <TrendChart
              labels={labels}
              series={email.total ? emailTrend : []}
              yLabel="Emails"
              summary={`${email.sent} emails sent and ${email.failed} failed between ${from} and ${to}.`}
              emptyText="No report emails in this range."
            />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={Bell} title="Push notifications per day" subtitle="Delivered and failed, across the selected range. Queued items are not drawn." />
          {loading ? <LoadingState label="Loading push notifications" rows={3} /> : pushError ? (
            <EmptyState icon={XCircle} title="Push notifications could not be read" reason={pushError} />
          ) : (
            <TrendChart
              labels={labels}
              series={pushSettled ? pushTrend : []}
              yLabel="Notifications"
              summary={`${push.delivered} pushes delivered and ${push.failed} failed between ${from} and ${to}.`}
              emptyText="No delivered or failed pushes in this range."
            />
          )}
        </Panel>
      </div>

      {/* Recent failures */}
      <Panel>
        <PanelHeader
          icon={XCircle}
          title="Recent failures"
          subtitle="The most recent failed email and push deliveries, newest first (up to 50 per channel)."
          actions={(
            <Btn icon={Download} onClick={handleExport} disabled={visibleFailures.length === 0}>Export</Btn>
          )}
        />
        <Toolbar className="mb-3">
          <Segmented
            value={channel}
            onChange={setChannel}
            options={[
              { key: 'all', label: 'All', count: failures.length },
              { key: 'email', label: 'Email', count: email.recentFailures?.length || 0 },
              { key: 'push', label: 'Push', count: push.recentFailures?.length || 0 },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, status or error" className="w-64" />
        </Toolbar>
        {loading ? (
          <LoadingState label="Loading failures" />
        ) : failures.length === 0 ? (
          <EmptyState icon={Send} title="No delivery failures in this range"
            reason={pushError ? 'Email deliveries all succeeded. Push could not be read, so push failures are unknown.' : 'Everything is getting through.'} />
        ) : visibleFailures.length === 0 ? (
          <EmptyState icon={Send} title="No failures match" reason="Nothing matches this channel and search. Clear the filters to see every failure." />
        ) : (
          <Table>
            <THead>
              <Th>Channel</Th>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Error</Th>
              <Th>When</Th>
            </THead>
            <tbody>
              {visibleFailures.map((r) => (
                <Tr key={`${r.channel}-${r.id}`}>
                  <Td>
                    <Badge tone={r.channel === 'email' ? 'info' : 'accent'} icon={r.channel === 'email' ? Mail : Bell}>
                      <span className="capitalize">{r.channel}</span>
                    </Badge>
                  </Td>
                  <Td className="max-w-[240px]"><span className="line-clamp-2 text-gray-300" title={r.name}>{r.name}</span></Td>
                  <Td nowrap><Badge tone="danger"><span className="capitalize">{r.status}</span></Badge></Td>
                  <Td className="max-w-md"><span className="line-clamp-2 text-gray-500" title={r.error || ''}>{r.error || 'No detail'}</span></Td>
                  <Td nowrap><span className="text-gray-500">{fmtDateTime(r.at)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DateInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none"
      />
    </label>
  )
}
