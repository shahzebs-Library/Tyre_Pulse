/**
 * ConsoleDelivery - super-admin "Delivery & Notifications" console page.
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate).
 * Shows how reliably the platform reaches people over its two delivery channels:
 *   - Email  (report_send_log): scheduled-report emails, sent vs failed.
 *   - Push   (workflow_notifications): queued / delivered / failed device pushes.
 *   - Reach  (profiles.push_token): how many devices could receive a push.
 *
 * Six KPI tiles, a small email-vs-push trend chart (react-chartjs-2, colours
 * from reportColors so it follows the report theme), and a combined recent-
 * failures table with Excel export. Date-range filter. Super-admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Send, RefreshCw, AlertTriangle, ShieldAlert, Mail, Bell, Users,
  Info, Download,
} from 'lucide-react'
import {
  Chart as ChartJS, LineElement, PointElement, BarElement,
  CategoryScale, LinearScale, Tooltip as ChartTooltip, Legend, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listEmailLog, listPushLog, pushReach, emailStats, pushStats, mergeTrend,
} from '../../lib/api/deliveryHealth'
import { colorAt, withAlpha } from '../../lib/reportColors'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

ChartJS.register(
  LineElement, PointElement, BarElement, CategoryScale, LinearScale,
  ChartTooltip, Legend, Filler,
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

const pctStr = (r) => `${Math.round((Number(r) || 0) * 1000) / 10}%`

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

const DAY_MS = 86_400_000

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleDelivery() {
  const { admin } = useConsoleAuth()

  const [emailRows, setEmailRows] = useState([])
  const [pushRows, setPushRows] = useState([])
  const [reach, setReach] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  // Date range (defaults to the last 30 days).
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    // End date is inclusive: extend "to" to end-of-day.
    const toEnd = to ? `${to}T23:59:59.999Z` : undefined
    const [eRes, pRes, rRes] = await Promise.allSettled([
      listEmailLog({ from, to: toEnd }),
      listPushLog({ from, to: toEnd }),
      pushReach(),
    ])
    if (eRes.status === 'fulfilled') setEmailRows(eRes.value)
    else setError(toUserMessage(eRes.reason))
    if (pRes.status === 'fulfilled') setPushRows(pRes.value)
    if (rRes.status === 'fulfilled') setReach(rRes.value)
    setRefreshing(false)
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  const email = useMemo(() => emailStats(emailRows), [emailRows])
  const push = useMemo(() => pushStats(pushRows), [pushRows])
  const trend = useMemo(() => mergeTrend(email, push), [email, push])

  const chart = useMemo(() => buildChart(trend), [trend])

  const failures = useMemo(() => {
    const rows = [...(email.recentFailures || []), ...(push.recentFailures || [])]
    return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  }, [email, push])

  const handleExport = useCallback(async () => {
    if (failures.length === 0) return
    const rows = failures.map((r) => ({
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
  }, [failures, from, to])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-xl border border-red-800/40 bg-red-950/20 p-8 text-center">
        <ShieldAlert size={22} className="text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-white">Restricted</h1>
        <p className="text-sm text-gray-400 mt-1">Delivery &amp; Notifications is reserved for system administrators.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Send size={20} className="text-orange-400" /> Delivery &amp; Notifications
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            How reliably reports and notifications reach people, by email and push.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <button
            onClick={load}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-800/40 bg-red-900/15 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-300" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
          <button onClick={load} className="text-xs text-red-300 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Tile label="Emails sent" value={email.sent} tone="green" icon={Mail} />
        <Tile label="Emails failed" value={email.failed} tone="red" icon={Mail}
          hint="Report emails whose delivery status was not 'sent'." />
        <Tile label="Email failure rate" value={pctStr(email.failureRate)} tone={email.failureRate > 0.1 ? 'red' : 'amber'} icon={Mail} />
        <Tile label="Push delivered" value={push.delivered} tone="green" icon={Bell} />
        <Tile label="Push failed" value={push.failed} tone="red" icon={Bell}
          hint="Notifications whose status was failed or error." />
        <Tile label="Push reach" value={reach} tone="blue" icon={Users}
          hint="Devices with a registered push token that could receive a notification." />
      </div>

      {/* Trend chart */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center">
          Delivery trend
          <InfoDot text="Emails and pushes delivered vs failed per day across the selected range." />
        </h3>
        {loading ? (
          <p className="text-xs text-gray-600 py-8 text-center">Loading...</p>
        ) : trend.length === 0 ? (
          <p className="text-xs text-gray-600 py-8 text-center">No delivery activity in this range.</p>
        ) : (
          <div style={{ height: 240 }}>
            <Line data={chart.data} options={chart.options} />
          </div>
        )}
      </div>

      {/* Recent failures */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white flex items-center">
            Recent failures
            <InfoDot text="The most recent failed email and push deliveries, newest first." />
          </h3>
          <button
            onClick={handleExport}
            disabled={failures.length === 0}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 text-xs border border-orange-700/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={12} /> Export
          </button>
        </div>
        {loading ? (
          <p className="p-6 text-xs text-gray-600 text-center">Loading...</p>
        ) : failures.length === 0 ? (
          <p className="p-8 text-sm text-gray-500 text-center">No delivery failures in this range. Everything is getting through.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">Channel</th>
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Error</th>
                  <th className="px-4 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((r) => (
                  <tr key={`${r.channel}-${r.id}`} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${
                        r.channel === 'email'
                          ? 'text-blue-300 bg-blue-900/30 border-blue-700/40'
                          : 'text-violet-300 bg-violet-900/30 border-violet-700/40'
                      }`}>
                        {r.channel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-300 max-w-[220px]">
                      <span className="line-clamp-2" title={r.name}>{r.name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-red-300 whitespace-nowrap capitalize">{r.status}</td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 max-w-md">
                      <span className="line-clamp-2" title={r.error || ''}>{r.error || 'No detail'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500 whitespace-nowrap" title={fmtDateTime(r.at)}>
                      {fmtDateTime(r.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components + chart builder ────────────────────────────────────────────

function Tile({ label, value, tone, icon: Icon, hint }) {
  const ring = {
    green: 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300',
    amber: 'border-amber-800/40 bg-amber-900/10 text-amber-300',
    red: 'border-red-800/40 bg-red-900/10 text-red-300',
    blue: 'border-blue-800/40 bg-blue-900/10 text-blue-300',
  }[tone] || 'border-gray-800 bg-gray-900/40 text-gray-300'
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <Icon size={16} className="mb-1.5 opacity-80" />
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-[11px] font-semibold mt-0.5 flex items-center">
        {label}{hint && <InfoDot text={hint} />}
      </p>
    </div>
  )
}

function DateInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 focus:outline-none focus:border-orange-600"
      />
    </label>
  )
}

function buildChart(trend) {
  const labels = trend.map((r) => String(r.date).slice(5))
  const cEmail = colorAt(0)
  const cEmailFail = colorAt(3)
  const cPush = colorAt(1)
  const cPushFail = colorAt(4)
  const mk = (label, key, color, dashed) => ({
    label,
    data: trend.map((r) => Number(r[key]) || 0),
    borderColor: color,
    backgroundColor: withAlpha(color, 0.12),
    pointBackgroundColor: color,
    borderWidth: 2,
    borderDash: dashed ? [4, 3] : undefined,
    tension: 0.35,
    fill: false,
  })
  return {
    data: {
      labels,
      datasets: [
        mk('Emails sent', 'emailSent', cEmail, false),
        mk('Emails failed', 'emailFailed', cEmailFail, true),
        mk('Push delivered', 'pushDelivered', cPush, false),
        mk('Push failed', 'pushFailed', cPushFail, true),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } },
        tooltip: { intersect: false, mode: 'index' },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: 'var(--panel-2)' },
          ticks: { color: '#9ca3af', font: { size: 10 }, precision: 0 },
        },
      },
    },
  }
}
