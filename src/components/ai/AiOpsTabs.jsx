/**
 * Admin Console → AI "Operations" and "Delivery & Jobs" tabs.
 *
 * Read-only operational visibility over data that already existed but was never
 * surfaced: real token usage / spend / model + feature breakdown / FAILED AI
 * requests (ai_token_logs, V236) and scheduled-report / background-job delivery
 * history + failures (report_send_log, V237). All numbers come from the single
 * aiOps service; pricing is the single ai_models source. Honest empty states.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Coins, Cpu, RefreshCw, Send, XCircle, CheckCircle2,
  Zap, TrendingUp, Clock,
} from 'lucide-react'
import { aiOps } from '../../lib/api'
import { toUserMessage } from '../../lib/safeError'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

const fmtUSD = (n) => `$${Number(n || 0).toFixed(Number(n) >= 1 ? 2 : 4)}`
const fmtTokens = (n) => {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}
const fmtDateTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Kpi({ label, value, sub, Icon, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        {Icon && <Icon size={16} className={tone} />}
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function Bar({ label, value, max, right, color = 'var(--brand-bright, #16a34a)' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-[var(--text-secondary)] font-medium truncate max-w-[60%]">{label}</span>
        <span className="text-[var(--text-muted)] text-xs">{right}</span>
      </div>
      <div className="w-full bg-[var(--input-bg,#0002)] rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function RangeToolbar({ days, setDays, onRefresh, loading }) {
  return (
    <div className="flex items-center gap-2">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => setDays(r.days)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            days === r.days
              ? 'bg-green-600 text-white'
              : 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--input-border)] hover:text-[var(--text-primary)]'
          }`}
        >
          {r.label}
        </button>
      ))}
      <button
        onClick={onRefresh}
        className="ml-auto p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        title="Refresh"
      >
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}

function EmptyState({ Icon, title, hint }) {
  return (
    <div className="card text-center py-14">
      <Icon size={34} className="mx-auto mb-3 text-[var(--text-muted)] opacity-40" />
      <p className="font-medium text-[var(--text-secondary)]">{title}</p>
      {hint && <p className="text-sm text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

/* ── Operations tab ─────────────────────────────────────────────────────────── */

export function AiOperationsTab({ country }) {
  const [days, setDays] = useState(30)
  const [state, setState] = useState({ loading: true, error: '', summary: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const { summary } = await aiOps.getUsageOverview({ days, country })
      setState({ loading: false, error: '', summary })
    } catch (err) {
      setState({ loading: false, error: toUserMessage(err), summary: null })
    }
  }, [days, country])

  useEffect(() => { load() }, [load])

  const s = state.summary
  const maxModel = useMemo(() => Math.max(1, ...(s?.byModel || []).map((m) => m.cost)), [s])
  const maxFeature = useMemo(() => Math.max(1, ...(s?.byFeature || []).map((f) => f.cost)), [s])
  const maxDay = useMemo(() => Math.max(1, ...(s?.byDay || []).map((d) => d.tokens)), [s])

  return (
    <div className="space-y-5">
      <RangeToolbar days={days} setDays={setDays} onRefresh={load} loading={state.loading} />

      {state.error && (
        <div className="card border border-red-800/50 flex items-center gap-2 text-red-300 text-sm">
          <AlertTriangle size={16} /> {state.error}
        </div>
      )}

      {state.loading && !s ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)}
        </div>
      ) : !s || (s.totalCalls === 0 && s.failedCalls === 0) ? (
        <EmptyState Icon={Activity} title="No AI activity in this window"
          hint="Token usage, spend and failures appear here once the AI copilot is used." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Total spend" value={fmtUSD(s.totalCost)} sub={`${s.totalCalls.toLocaleString()} successful calls`} Icon={Coins} tone="text-green-400" />
            <Kpi label="Total tokens" value={fmtTokens(s.totalTokens)} sub={`${fmtTokens(s.promptTokens)} in / ${fmtTokens(s.completionTokens)} out`} Icon={Zap} tone="text-blue-400" />
            <Kpi label="Avg cost / call" value={fmtUSD(s.avgCostPerCall)} sub="successful calls" Icon={TrendingUp} tone="text-purple-400" />
            <Kpi label="Failed requests" value={s.failedCalls.toLocaleString()}
              sub={`${(s.failureRate * 100).toFixed(1)}% failure rate`} Icon={XCircle}
              tone={s.failedCalls > 0 ? 'text-red-400' : 'text-[var(--text-primary)]'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><Cpu size={16} /> Spend by model</h3>
              <div className="space-y-3">
                {s.byModel.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data.</p> :
                  s.byModel.map((m) => (
                    <Bar key={m.model} label={m.model} value={m.cost} max={maxModel}
                      right={`${fmtTokens(m.tokens)} · ${fmtUSD(m.cost)}`} />
                  ))}
              </div>
            </div>
            <div className="card">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity size={16} /> Spend by feature</h3>
              <div className="space-y-3">
                {s.byFeature.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No data.</p> :
                  s.byFeature.map((f) => (
                    <Bar key={f.feature} label={f.feature} value={f.cost} max={maxFeature} color="#3b82f6"
                      right={`${f.calls} calls · ${fmtUSD(f.cost)}`} />
                  ))}
              </div>
            </div>
          </div>

          {s.byDay.length > 1 && (
            <div className="card">
              <h3 className="font-semibold mb-4">Daily token usage</h3>
              <div className="flex items-end gap-1 h-28">
                {s.byDay.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col justify-end group relative" title={`${d.date}: ${fmtTokens(d.tokens)} tokens, ${d.calls} calls, ${d.failures} failed`}>
                    {d.failures > 0 && <div className="w-full bg-red-500/70 rounded-t" style={{ height: `${Math.min(100, (d.failures / Math.max(1, d.calls + d.failures)) * 30)}%` }} />}
                    <div className="w-full bg-green-500/70 rounded-t" style={{ height: `${(d.tokens / maxDay) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[var(--text-muted)] text-xs mt-2">
                <span>{s.byDay[0]?.date}</span>
                <span>{s.byDay[s.byDay.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {s.failedCalls > 0 && (
            <div className="card border border-red-900/40">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-red-300">
                <XCircle size={16} /> Recent failed requests
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                  {Object.entries(s.failureBreakdown).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Model</th>
                      <th className="py-2 pr-3 font-medium">Feature</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recentFailures.map((r) => (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50">
                        <td className="py-2 pr-3 whitespace-nowrap text-[var(--text-muted)]">{fmtDateTime(r.created_at)}</td>
                        <td className="py-2 pr-3">{r.model || 'N/A'}</td>
                        <td className="py-2 pr-3">{r.feature || 'N/A'}</td>
                        <td className="py-2 pr-3">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/15 text-red-300">{r.status}{r.http_status ? ` (${r.http_status})` : ''}</span>
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-muted)] max-w-md truncate" title={r.error || ''}>{r.error || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Delivery & Jobs tab ────────────────────────────────────────────────────── */

const jobStatusPill = (status) => {
  const ok = status === 'sent'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      ok ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
    }`}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{status || 'unknown'}
    </span>
  )
}

export function AiDeliveryJobsTab() {
  const [days, setDays] = useState(30)
  const [state, setState] = useState({ loading: true, error: '', jobs: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const rows = await aiOps.listJobRuns({ days })
      setState({ loading: false, error: '', jobs: aiOps.summarizeJobs(rows) })
    } catch (err) {
      setState({ loading: false, error: toUserMessage(err), jobs: null })
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const j = state.jobs

  return (
    <div className="space-y-5">
      <RangeToolbar days={days} setDays={setDays} onRefresh={load} loading={state.loading} />

      {state.error && (
        <div className="card border border-red-800/50 flex items-center gap-2 text-red-300 text-sm">
          <AlertTriangle size={16} /> {state.error}
        </div>
      )}

      {state.loading && !j ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)}
        </div>
      ) : !j || j.total === 0 ? (
        <EmptyState Icon={Send} title="No scheduled-report deliveries in this window"
          hint="Delivery attempts for scheduled reports and background digests appear here." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Total runs" value={j.total.toLocaleString()} Icon={Send} />
            <Kpi label="Delivered" value={j.sent.toLocaleString()} Icon={CheckCircle2} tone="text-green-400" />
            <Kpi label="Failed" value={j.failed.toLocaleString()} Icon={XCircle} tone={j.failed > 0 ? 'text-red-400' : 'text-[var(--text-primary)]'} />
            <Kpi label="Success rate" value={`${(j.successRate * 100).toFixed(0)}%`} Icon={TrendingUp} tone="text-blue-400" />
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock size={16} /> Schedule health</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="py-2 pr-3 font-medium">Schedule</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Last run</th>
                    <th className="py-2 pr-3 font-medium">Last status</th>
                    <th className="py-2 pr-3 font-medium text-right">Runs</th>
                    <th className="py-2 pr-3 font-medium text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {j.bySchedule.map((row) => (
                    <tr key={row.schedule_id || row.name} className="border-b border-[var(--input-border)]/50">
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      <td className="py-2 pr-3 text-[var(--text-muted)]">{row.report_type || 'N/A'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-[var(--text-muted)]">{fmtDateTime(row.lastRun)}</td>
                      <td className="py-2 pr-3">{jobStatusPill(row.lastStatus)}</td>
                      <td className="py-2 pr-3 text-right">{row.total}</td>
                      <td className={`py-2 pr-3 text-right ${row.failed > 0 ? 'text-red-400 font-medium' : ''}`}>{row.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {j.recentFailures.length > 0 && (
            <div className="card border border-red-900/40">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-red-300"><XCircle size={16} /> Recent delivery failures</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Schedule</th>
                      <th className="py-2 pr-3 font-medium">Recipients</th>
                      <th className="py-2 pr-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {j.recentFailures.map((r) => (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50">
                        <td className="py-2 pr-3 whitespace-nowrap text-[var(--text-muted)]">{fmtDateTime(r.sent_at)}</td>
                        <td className="py-2 pr-3">{r.schedule_name || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-muted)]">{Array.isArray(r.recipients) ? r.recipients.length : 0}</td>
                        <td className="py-2 pr-3 text-[var(--text-muted)] max-w-md truncate" title={r.error || ''}>{r.error || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
