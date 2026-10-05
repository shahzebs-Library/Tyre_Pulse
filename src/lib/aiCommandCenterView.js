/**
 * Pure shaping for Smart Analytics (AI), the AI Command Center page
 * (/ai-command-center). No I/O and no clock reads: callers pass `now`.
 *
 * The page never invents an "insight". The feed is the fleet's real active
 * alerts, each routed to the agent best placed to explain it (the same
 * classifier the chat uses). The headline tiles come from real counts: active
 * alerts, AI requests and spend from ai_token_logs, and saved conversations.
 */
import { classifyQuery, AGENT_TYPES, AGENT_LABELS } from './aiRouter'

export const MAX_QUESTION = 400

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low']
const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 }
const SEV_TONE = { Critical: 'bad', High: 'orange', Medium: 'warn', Low: 'info', Info: 'muted' }

/** Kit tone class per agent (t-* for icons, pill tone for chips). */
export const AGENT_TONE = {
  [AGENT_TYPES.ANALYST]:       { icon: 't-blue',   pill: 'info' },
  [AGENT_TYPES.TYRE_ENGINEER]: { icon: 't-orange', pill: 'orange' },
  [AGENT_TYPES.QA_DATA]:       { icon: 't-purple', pill: 'muted' },
  [AGENT_TYPES.PLANNER]:       { icon: 't-green',  pill: 'good' },
  [AGENT_TYPES.SAFETY]:        { icon: 't-red',    pill: 'bad' },
  [AGENT_TYPES.PROCUREMENT]:   { icon: 't-amber',  pill: 'warn' },
}

export function agentTone(type) {
  return AGENT_TONE[type] || { icon: 't-blue', pill: 'info' }
}

/** "12 min ago" style relative time; '' when unknown. */
export function agoText(when, now) {
  if (!when || !now) return ''
  const t = new Date(when).getTime()
  const n = (now instanceof Date ? now : new Date(now)).getTime()
  if (!Number.isFinite(t) || !Number.isFinite(n)) return ''
  const mins = Math.max(0, Math.round((n - t) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

const humanType = (t) => String(t || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Real fleet signals for the insight feed: active alerts, normalised, routed to
 * an agent, worst and newest first. Each carries a ready-made question the
 * operator can send to that agent with one click.
 */
export function signalFeed(alerts = [], now) {
  return alerts
    .map((a, i) => {
      const severity = SEV_ORDER[a?.severity] != null ? a.severity : 'Info'
      const type = humanType(a?.alert_type)
      const message = (a?.message && String(a.message).trim()) || (type ? `${type} alert` : 'Fleet alert')
      const title = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Fleet alert'
      const asset = a?.asset_no || ''
      const question = `Explain this ${severity.toLowerCase()} alert${asset ? ` on asset ${asset}` : ''}: "${message}". What is the likely root cause, the risk, and what should we do first?`
      const agent = classifyQuery(`${type} ${message}`)
      return {
        id: a?.id ?? `sig-${i}`,
        severity,
        tone: SEV_TONE[severity],
        title,
        message,
        asset,
        country: a?.country || '',
        ago: agoText(a?.created_at, now),
        at: a?.created_at ? new Date(a.created_at).getTime() : 0,
        agent,
        agentLabel: AGENT_LABELS[agent] || 'Analyst',
        question,
      }
    })
    .sort((x, y) => (SEV_ORDER[x.severity] - SEV_ORDER[y.severity]) || (y.at - x.at))
}

/** Counts per severity for the feed filter chips. */
export function signalCounts(items = []) {
  const c = { all: items.length, Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 }
  for (const it of items) c[it.severity] = (c[it.severity] || 0) + 1
  return c
}

export function filterSignals(items = [], severity = 'all') {
  if (!severity || severity === 'all') return items
  return items.filter((it) => it.severity === severity)
}

/**
 * Headline tiles, in the mockup's order: Critical Insights, Opportunities,
 * Forecast Risk, Potential Savings, Confidence. Every value is a real count or
 * N/A with the reason:
 *   Critical Insights : active critical alerts
 *   Opportunities     : the other active alerts an agent can explain
 *   Forecast Risk     : active PM plans due within the next 30 days
 *   Potential Savings : not stored per answer, so "Not recorded"
 *   Confidence        : share of AI requests answered without error
 * The AI usage numbers (requests, spend, conversations) are returned apart in
 * `usageLine` so the page can still show them.
 */
export function aiKpis({
  signals, signalsReady, usage, usageReady, conversations, conversationsReady,
  forecast, forecastReady, days = 30,
}) {
  const counts = signalCounts(signals || [])
  const calls = usage ? usage.totalCalls : null
  const failed = usage ? usage.failedCalls : null
  const totalReq = calls != null && failed != null ? calls + failed : null
  const successPct = totalReq ? Math.round((calls / totalReq) * 100) : null
  const tiles = [
    {
      key: 'critical', label: 'Critical Insights', tone: 't-red',
      value: signalsReady ? counts.Critical : null,
      sub: signalsReady ? 'Active critical alerts' : 'Alerts not loaded',
      danger: signalsReady && counts.Critical > 0,
    },
    {
      key: 'open', label: 'Opportunities', tone: 't-green',
      value: signalsReady ? counts.all - counts.Critical : null,
      sub: signalsReady ? 'Other active alerts for an agent' : 'Alerts not loaded',
    },
    {
      key: 'forecast', label: 'Forecast Risk', tone: 't-amber',
      value: forecastReady ? (forecast ?? 0) : null,
      sub: forecastReady ? 'PM plans due in next 30 days' : 'PM schedule not loaded',
    },
    {
      key: 'savings', label: 'Potential Savings', tone: 't-blue',
      display: 'Not recorded',
      sub: 'Savings are not stored per answer',
    },
    {
      key: 'success', label: 'Confidence', tone: 't-purple',
      display: usageReady ? (successPct == null ? 'N/A' : `${successPct}%`) : null,
      sub: usageReady
        ? (successPct == null ? `No AI requests in ${days} days` : 'AI requests answered without error')
        : 'Usage not loaded',
    },
  ]
  const usageLine = {
    requests: usageReady ? (totalReq ?? 0) : null,
    failed: usageReady ? (failed ?? 0) : null,
    spend: usageReady && usage ? `USD ${usage.totalCost.toFixed(2)}` : null,
    conversations: conversationsReady ? (conversations?.length ?? 0) : null,
  }
  return Object.assign(tiles, { usageLine })
}

/**
 * Daily counts (zero-filled, oldest first) over the last `days` days, for the
 * tile mini charts. `dateOf(row)` returns an ISO date/time or null.
 */
export function dailyCounts(rows = [], now, days = 14, dateOf = (r) => r?.created_at, valueOf = () => 1) {
  const n = now instanceof Date ? now : new Date(now)
  const keys = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() - i)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]))
  const out = keys.map(() => 0)
  for (const r of rows) {
    const v = dateOf(r)
    if (!v) continue
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) continue
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (idx[k] == null) continue
    const val = valueOf(r)
    if (val == null || !Number.isFinite(val)) continue
    out[idx[k]] += val
  }
  return out
}

/**
 * Picture for an insight row, chosen from what the alert is about. The images
 * are generic (no asset photo), so they only illustrate the topic.
 */
export function signalPicture(item) {
  const t = `${item?.title || ''} ${item?.message || ''}`.toLowerCase()
  if (/fuel|diesel|litre|liter/.test(t)) return '/dashboard/ai-signal-fuel.webp'
  if (/data|quality|odometer|record|duplicate|missing|import/.test(t)) return '/dashboard/ai-signal-data.webp'
  if (/workshop|job|parts|repair|breakdown|maintenance|pm /.test(t)) return '/dashboard/ai-signal-workshop.webp'
  if (/replace|due|forecast|plan|schedule|window/.test(t)) return '/dashboard/ai-signal-replace.webp'
  return '/dashboard/ai-signal-tyre.webp'
}

/** Rows for the conversation trace table, newest first. */
export function traceRows(conversations = []) {
  return [...conversations]
    .sort((a, b) => String(b?.updated_at || '').localeCompare(String(a?.updated_at || '')))
    .map((c, i) => ({
      n: i + 1,
      id: c?.id,
      title: (c?.title && String(c.title).trim()) || 'Untitled conversation',
      agent: c?.agent || null,
      agentLabel: AGENT_LABELS[c?.agent] || (c?.agent ? humanType(c.agent) : 'Auto'),
      created: c?.created_at || null,
      updated: c?.updated_at || c?.created_at || null,
    }))
}

/** Clamp a typed question to the input limit. */
export function clampQuestion(text) {
  return String(text ?? '').slice(0, MAX_QUESTION)
}
