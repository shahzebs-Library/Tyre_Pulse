/**
 * ConsoleDelivery - super-admin "Delivery & Notifications" console page.
 *
 * Shows how reliably the platform reaches people over its two channels:
 *   - Email  (report_send_log): scheduled-report emails, sent vs failed.
 *   - Push   (workflow_notifications): queued / delivered / failed device pushes.
 *   - Reach  (profiles.push_token): how many devices could receive a push.
 *
 * Structured as tabs (the active one lives in ?tab=) so it is not a wall:
 *   Overview      - the latest failures and the most-failing names, then one
 *                   trend chart per channel over the chosen range.
 *   Failures      - every recent failure: channel filter, search, sortable,
 *                   paged, Excel/PDF export, a row opens its full error.
 *   Report types  - email reliability per report type.
 * Super-admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Send, ShieldAlert, Mail, Bell, Users, Info, XCircle, BarChart3, ExternalLink } from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listEmailLog, listPushLog, pushReach, emailStats, pushStats, DELIVERY_LOG_MAX,
} from '../../lib/api/deliveryHealth'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { TrendChart, STATUS, SERIES, useChartTheme } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import PageHeader, { fmtDateTime } from './ops/PageHeader'
import TabBar from './ops/TabBar'
import useUrlTab from './ops/useUrlTab'
import usePaged from './ops/usePaged'
import Pager from './ops/Pager'
import SideDrawer, { Field } from './ops/SideDrawer'

// ── Helpers ───────────────────────────────────────────────────────────────────

const pctStr = (r) => `${Math.round((Number(r) || 0) * 1000) / 10}%`

const DAY_MS = 86_400_000
/** Longest range drawn day by day; wider ranges would make the axis unreadable. */
const MAX_TREND_DAYS = 370
const TABS = ['overview', 'failures', 'types']

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

const FAILURE_EXPORT_COLUMNS = [
  { key: 'channel', header: 'Channel' },
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
  { key: 'error', header: 'Error' },
  { key: 'at', header: 'Time', value: (r) => fmtDateTime(r.at) },
]
const TYPE_EXPORT_COLUMNS = [
  { key: 'type', header: 'Report type' },
  { key: 'total', header: 'Attempts' },
  { key: 'sent', header: 'Sent' },
  { key: 'failed', header: 'Failed' },
  { key: 'rate', header: 'Failure rate', value: (t) => pctStr(t.rate) },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleDelivery() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()

  const [emailRows, setEmailRows] = useState([])
  const [pushRows, setPushRows] = useState([])
  const [emailTruncated, setEmailTruncated] = useState(false)
  const [pushTruncated, setPushTruncated] = useState(false)
  const [reach, setReach] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [pushError, setPushError] = useState(null)
  const [emailError, setEmailError] = useState(null)
  const [readAt, setReadAt] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'overview')
  const [channel, setChannel] = useState('all')
  const [search, setSearch] = useState('')
  const [openFailure, setOpenFailure] = useState(null)

  // Date range (defaults to the last 30 days).
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    setEmailError(null)
    setPushError(null)
    // End date is inclusive: extend "to" to end-of-day.
    const toEnd = to ? `${to}T23:59:59.999Z` : undefined
    const [eRes, pRes, rRes] = await Promise.allSettled([
      listEmailLog({ from, to: toEnd }),
      listPushLog({ from, to: toEnd }),
      pushReach(),
    ])
    if (eRes.status === 'fulfilled') {
      setEmailRows(eRes.value.rows)
      setEmailTruncated(!!eRes.value.truncated)
    } else {
      setEmailRows([])
      setEmailTruncated(false)
      setEmailError(toUserMessage(eRes.reason, 'Could not read report emails.'))
    }
    // A failed push read used to leave the previous range's rows on screen
    // with no warning. It is now cleared and stated.
    if (pRes.status === 'fulfilled') {
      setPushRows(pRes.value.rows)
      setPushTruncated(!!pRes.value.truncated)
    } else {
      setPushRows([])
      setPushTruncated(false)
      setPushError(toUserMessage(pRes.reason, 'Could not read push notifications.'))
    }
    setReach(rRes.status === 'fulfilled' ? rRes.value : null)
    setReadAt(Date.now())
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

  // Names that fail most often, so a single broken schedule stands out from noise.
  const offenders = useMemo(() => {
    const m = new Map()
    for (const f of failures) {
      const k = `${f.channel}|${f.name}`
      const e = m.get(k) || { key: k, channel: f.channel, name: f.name, count: 0, last: null }
      e.count += 1
      if (!e.last || String(f.at || '') > String(e.last)) e.last = f.at
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 5)
  }, [failures])

  const typeRows = useMemo(() => (email.byType || []).map((t) => ({ ...t, rate: t.total ? t.failed / t.total : 0 })), [email])

  const { sort, onSort } = useTableSort(null)
  const { sort: typeSort, onSort: onTypeSort } = useTableSort({ key: 'failed', dir: 'desc' })
  const visibleFailures = useMemo(() => {
    const byChannel = failures.filter((r) => channel === 'all' || r.channel === channel)
    return sortRows(searchRows(byChannel, search, ['name', 'status', 'error']), sort)
  }, [failures, channel, search, sort])
  const failPaged = usePaged(visibleFailures)
  const sortedTypes = useMemo(() => sortRows(typeRows, typeSort), [typeRows, typeSort])

  const capped = emailTruncated || pushTruncated
  const rangeInvalid = days.length === 0

  const openFailures = useCallback((ch) => { setChannel(ch); setSearch(''); setTab('failures') }, [setTab])

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
  const both = emailError && pushError
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'failures', label: 'Failures', count: both ? undefined : failures.length },
    { key: 'types', label: 'Report types', count: emailError ? undefined : typeRows.length },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Send} title="Delivery & Notifications"
        purpose="How reliably reports and notifications reach people, by email and push."
        refreshedAt={readAt} onRefresh={load} refreshing={refreshing}
        actions={(
          <>
            <DateInput label="From" value={from} onChange={setFrom} />
            <DateInput label="To" value={to} onChange={setTo} />
          </>
        )} />

      <ErrorState message={emailError || error} onRetry={load} />
      {rangeInvalid && (
        <Note icon={Info} tone="warning">The From date is after the To date, so there is nothing to show. Pick a valid range.</Note>
      )}
      {capped && (
        <Note icon={Info} tone="warning">
          This range holds more than {DELIVERY_LOG_MAX.toLocaleString()} deliveries on at least one channel, so the figures
          cover the newest {DELIVERY_LOG_MAX.toLocaleString()} per channel only. Narrow the date range for exact totals.
        </Note>
      )}

      {/* KPI tiles: failure rates ride on the failed tiles; each opens its failures */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Emails sent" value={loading || emailError ? 'N/A' : email.sent} tone="good" icon={Mail}
          sub={emailError ? undefined : email.total ? `of ${email.total} attempts` : 'No attempts'} />
        <StatTile label="Emails failed" value={loading || emailError ? 'N/A' : email.failed}
          tone={email.failureRate > 0.1 ? 'danger' : email.failed > 0 ? 'warning' : 'default'} icon={Mail}
          sub={loading || emailError ? undefined : `${emailRate} failure rate`}
          onClick={() => openFailures('email')} active={tab === 'failures' && channel === 'email'} />
        <StatTile label="Push delivered" value={loading || pushError ? 'N/A' : push.delivered} tone="good" icon={Bell}
          sub={pushError ? undefined : `${push.queued} still queued`} />
        <StatTile label="Push failed" value={loading || pushError ? 'N/A' : push.failed}
          tone={push.failureRate > 0.1 ? 'danger' : push.failed > 0 ? 'warning' : 'default'} icon={Bell}
          sub={loading || pushError ? undefined : pushSettled ? `${pushRate} of ${pushSettled} settled` : 'Nothing settled'}
          onClick={() => openFailures('push')} active={tab === 'failures' && channel === 'push'} />
        <StatTile label="Push reach" value={reach == null ? 'N/A' : reach} tone="accent" icon={Users} sub="Devices with a token" />
      </div>

      <TabBar tabs={tabs} value={tab} onChange={setTab} label="Delivery sections" />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={XCircle} title="Latest failures" tone={failures.length ? 'danger' : 'default'}
                subtitle="The five newest failed deliveries in this range."
                actions={failures.length > 5 ? <button type="button" onClick={() => openFailures('all')}
                  className="text-xs text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                  See all {failures.length}</button> : null} />
              {loading ? <LoadingState label="Loading failures" rows={3} /> : both ? (
                <EmptyState icon={XCircle} title="Failures are unknown" reason="Neither email nor push deliveries could be read." />
              ) : failures.length === 0 ? (
                <EmptyState icon={Send} title="No delivery failures in this range"
                  reason={pushError ? 'Email deliveries all succeeded. Push could not be read, so push failures are unknown.'
                    : emailError ? 'Push deliveries all succeeded. Email could not be read, so email failures are unknown.'
                    : 'Everything is getting through.'} />
              ) : (
                <ul className="space-y-2">
                  {failures.slice(0, 5).map((f) => (
                    <li key={`${f.channel}-${f.id}`}>
                      <button type="button" onClick={() => setOpenFailure(f)}
                        className="w-full flex items-start gap-2.5 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-left hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                        <Badge tone={f.channel === 'email' ? 'info' : 'accent'} icon={f.channel === 'email' ? Mail : Bell}>
                          <span className="capitalize">{f.channel}</span>
                        </Badge>
                        <span className="flex-1 min-w-0 text-xs">
                          <span className="block text-gray-200 truncate">{f.name}</span>
                          <span className="block text-gray-500 line-clamp-2 break-words">{f.error || 'No detail'}</span>
                        </span>
                        <span className="text-[11px] text-gray-500 whitespace-nowrap">{fmtDateTime(f.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel>
              <PanelHeader icon={BarChart3} title="Failing most often"
                subtitle="Schedules and notification types with the most failures in this range." />
              {loading ? <LoadingState label="Loading" rows={3} /> : both ? (
                <EmptyState icon={XCircle} title="Unknown" reason="Neither channel could be read." />
              ) : offenders.length === 0 ? (
                <EmptyState icon={Send} title="Nothing is failing repeatedly" reason="No delivery failed in this range." />
              ) : (
                <ol className="divide-y divide-gray-800/70">
                  {offenders.map((o) => (
                    <li key={o.key} className="flex items-center gap-3 py-2 text-xs">
                      <Badge tone={o.channel === 'email' ? 'info' : 'accent'}><span className="capitalize">{o.channel}</span></Badge>
                      <span className="flex-1 min-w-0 truncate text-gray-200" title={o.name}>{o.name}</span>
                      <span className="tabular-nums text-red-300">{o.count} failed</span>
                      <button type="button" onClick={() => { setChannel(o.channel); setSearch(o.name); setTab('failures') }}
                        className="text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                        View</button>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          {/* Trend charts: one per channel, never a second axis */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={Mail} title="Report emails per day" subtitle="Sent and failed, across the selected range." />
              {loading ? <LoadingState label="Loading email deliveries" rows={3} /> : emailError ? (
                <EmptyState icon={XCircle} title="Report emails could not be read" reason={emailError} />
              ) : (
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
          <p className="text-[11px] text-gray-500">
            Schedules that keep failing are listed on <a href="/console/automation?tab=schedules" className="text-orange-300 hover:text-orange-200 inline-flex items-center gap-0.5">Automation Health <ExternalLink size={11} aria-hidden="true" /></a>.
          </p>
        </div>
      )}

      {tab === 'failures' && (
        <Panel>
          <PanelHeader
            icon={XCircle}
            title="Recent failures"
            subtitle="The most recent failed email and push deliveries, newest first (up to 50 per channel). Select one for the full error."
          />
          <Toolbar className="mb-3">
            <Segmented
              value={channel}
              onChange={setChannel}
              ariaLabel="Filter by channel"
              role="group"
              options={[
                { key: 'all', label: 'All', count: failures.length },
                { key: 'email', label: 'Email', count: email.recentFailures?.length || 0 },
                { key: 'push', label: 'Push', count: push.recentFailures?.length || 0 },
              ]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, status or error" className="w-full sm:w-64" />
            <div className="ml-auto flex gap-2">
              <ExportButtons rows={visibleFailures} columns={FAILURE_EXPORT_COLUMNS} title={`TyrePulse Delivery Failures ${from} to ${to}`} />
            </div>
          </Toolbar>
          {loading ? (
            <LoadingState label="Loading failures" />
          ) : both ? (
            <ErrorState message="Neither email nor push deliveries could be read, so failures are unknown." onRetry={load} />
          ) : failures.length === 0 ? (
            <EmptyState icon={Send} title="No delivery failures in this range"
              reason={pushError ? 'Email deliveries all succeeded. Push could not be read, so push failures are unknown.'
                : emailError ? 'Push deliveries all succeeded. Email could not be read, so email failures are unknown.'
                : 'Everything is getting through.'} />
          ) : visibleFailures.length === 0 ? (
            <EmptyState icon={Send} title="No failures match" reason="Nothing matches this channel and search. Clear the filters to see every failure." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="channel" sort={sort} onSort={onSort}>Channel</Th>
                  <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
                  <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                  <Th sortKey="error" sort={sort} onSort={onSort}>Error</Th>
                  <Th sortKey="at" sort={sort} onSort={onSort}>When</Th>
                </THead>
                <tbody>
                  {failPaged.rows.map((r) => (
                    <Tr key={`${r.channel}-${r.id}`} onClick={() => setOpenFailure(r)} ariaLabel={`Open failure ${r.name}`}>
                      <Td>
                        <Badge tone={r.channel === 'email' ? 'info' : 'accent'} icon={r.channel === 'email' ? Mail : Bell}>
                          <span className="capitalize">{r.channel}</span>
                        </Badge>
                      </Td>
                      <Td className="max-w-[240px]"><span className="line-clamp-2 text-gray-300" title={r.name}>{r.name}</span></Td>
                      <Td nowrap><Badge tone="danger"><span className="capitalize">{r.status}</span></Badge></Td>
                      <Td className="max-w-md"><span className="line-clamp-2 break-words text-gray-400" title={r.error || ''}>{r.error || 'No detail'}</span></Td>
                      <Td nowrap><span className="text-gray-500">{fmtDateTime(r.at)}</span></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager paged={failPaged} label="failures" />
            </>
          )}
        </Panel>
      )}

      {tab === 'types' && (
        <Panel>
          <PanelHeader icon={Mail} title="Email reliability by report type"
            subtitle="Every report email attempt in the range, grouped by report type."
            actions={<ExportButtons rows={sortedTypes} columns={TYPE_EXPORT_COLUMNS} title={`TyrePulse Email Reliability ${from} to ${to}`} />} />
          {loading ? <LoadingState label="Loading report types" /> : emailError ? (
            <ErrorState message={emailError} onRetry={load} />
          ) : sortedTypes.length === 0 ? (
            <EmptyState icon={Mail} title="No report emails in this range" reason="Nothing was sent between these dates." />
          ) : (
            <Table>
              <THead>
                <Th sortKey="type" sort={typeSort} onSort={onTypeSort}>Report type</Th>
                <Th sortKey="total" sort={typeSort} onSort={onTypeSort} align="right">Attempts</Th>
                <Th sortKey="sent" sort={typeSort} onSort={onTypeSort} align="right">Sent</Th>
                <Th sortKey="failed" sort={typeSort} onSort={onTypeSort} align="right">Failed</Th>
                <Th sortKey="rate" sort={typeSort} onSort={onTypeSort} align="right">Failure rate</Th>
              </THead>
              <tbody>
                {sortedTypes.map((t) => (
                  <Tr key={t.type}>
                    <Td><span className="text-gray-200">{t.type}</span></Td>
                    <Td align="right" className="tabular-nums">{t.total}</Td>
                    <Td align="right" className="tabular-nums text-emerald-300">{t.sent}</Td>
                    <Td align="right" className={`tabular-nums ${t.failed ? 'text-red-300' : 'text-gray-500'}`}>{t.failed}</Td>
                    <Td align="right" className="tabular-nums">{pctStr(t.rate)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      <SideDrawer open={!!openFailure} onClose={() => setOpenFailure(null)} title={openFailure?.name || 'Failure'}
        subtitle={openFailure ? `${openFailure.channel === 'email' ? 'Report email' : 'Push notification'} delivery failure` : ''}>
        {openFailure && (
          <>
            <Note icon={XCircle} tone="danger">
              <p className="font-medium">Error</p>
              <p className="mt-0.5 break-words whitespace-pre-wrap">{openFailure.error || 'No detail was recorded.'}</p>
            </Note>
            <dl>
              <Field label="Channel"><span className="capitalize">{openFailure.channel}</span></Field>
              <Field label="Status"><span className="capitalize">{openFailure.status}</span></Field>
              <Field label="When">{fmtDateTime(openFailure.at)}</Field>
              {openFailure.attempts != null && <Field label="Attempts">{openFailure.attempts}</Field>}
            </dl>
          </>
        )}
      </SideDrawer>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DateInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      />
    </label>
  )
}
