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
 * Headline tiles. Every value is a real count or N/A:
 *   signals     : active alerts (critical + all)
 *   usage       : summarizeUsage() of ai_token_logs for the window, or null
 *   conversations: saved, non-archived conversations, or null when unread
 */
export function aiKpis({ signals, signalsReady, usage, usageReady, conversations, conversationsReady, days = 30 }) {
  const counts = signalCounts(signals || [])
  const calls = usage ? usage.totalCalls : null
  const failed = usage ? usage.failedCalls : null
  const totalReq = calls != null && failed != null ? calls + failed : null
  const successPct = totalReq ? Math.round((calls / totalReq) * 100) : null
  return [
    {
      key: 'critical', label: 'Critical Signals', tone: 't-red',
      value: signalsReady ? counts.Critical : null,
      sub: signalsReady ? 'Active critical alerts' : 'Alerts not loaded',
      danger: signalsReady && counts.Critical > 0,
    },
    {
      key: 'open', label: 'Open Signals', tone: 't-green',
      value: signalsReady ? counts.all : null,
      sub: signalsReady ? 'Active alerts ready for an agent' : 'Alerts not loaded',
    },
    {
      key: 'requests', label: 'AI Requests', tone: 't-amber',
      value: usageReady ? (totalReq ?? 0) : null,
      sub: usageReady ? `Last ${days} days${failed ? `, ${failed} failed` : ''}` : 'Usage not loaded',
    },
    {
      key: 'spend', label: 'AI Spend', tone: 't-blue',
      display: usageReady && usage ? `USD ${usage.totalCost.toFixed(2)}` : null,
      sub: usageReady ? `Model cost, last ${days} days` : 'Usage not loaded',
    },
    {
      key: 'success', label: 'Answer Success', tone: 't-purple',
      display: usageReady ? (successPct == null ? 'N/A' : `${successPct}%`) : null,
      sub: usageReady
        ? (successPct == null ? 'No AI requests in the window' : 'Requests answered without error')
        : 'Usage not loaded',
    },
    {
      key: 'conversations', label: 'Conversations', tone: 't-green',
      value: conversationsReady ? (conversations?.length ?? 0) : null,
      sub: conversationsReady ? 'Saved, not archived' : 'History not loaded',
    },
  ]
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
