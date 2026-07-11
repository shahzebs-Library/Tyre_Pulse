/**
 * StatusBadge — a reusable, theme-aware status indicator built on the brand
 * `badge/*` illustrations. Normalises an arbitrary status string to one of the
 * six semantic states and renders the matching badge art with a coloured label
 * pill. Use it in detail headers, summary cards, and drawers.
 *
 *   <StatusBadge status="Approved" />
 *   <StatusBadge status={wo.status} size={40} />
 *   <StatusBadge state="critical" label="Overdue" />
 */
import { Illustration } from '../illustrations'

// Semantic state → { badge illustration, label pill colour token }.
const STATES = {
  active:   { art: 'badge/status-active',   color: 'var(--brand-bright, #22c55e)' },
  verified: { art: 'badge/verified',        color: 'var(--brand-bright, #22c55e)' },
  warning:  { art: 'badge/status-warning',  color: 'var(--warning, #f59e0b)' },
  pending:  { art: 'badge/pending',         color: 'var(--warning, #f59e0b)' },
  critical: { art: 'badge/status-critical', color: 'var(--danger, #ef4444)' },
  offline:  { art: 'badge/status-offline',  color: 'var(--text-muted, #667085)' },
}

// Keyword rules (most specific first) mapping a raw status → semantic state.
const RULES = [
  [/(verified|passed|compliant|signed|paid)/i,                       'verified'],
  [/(active|approved|complete|completed|done|closed|ok|healthy|in service|resolved|success|available|online|live)/i, 'active'],
  [/(pending|await|await(ing)?|queued|in progress|processing|review|scheduled|draft|new)/i, 'pending'],
  [/(warn|due|expiring|low|at risk|attention|hold|partial|overdue soon)/i, 'warning'],
  [/(critical|fail|failed|rejected|overdue|breach|error|blocked|scrap|danger|expired|out of service|down)/i, 'critical'],
  [/(offline|inactive|disabled|archived|retired|cancelled|canceled|unknown|n\/a|idle)/i, 'offline'],
]

export function statusState(status) {
  const s = String(status ?? '').trim()
  if (!s) return 'offline'
  for (const [re, state] of RULES) if (re.test(s)) return state
  return 'active'
}

export default function StatusBadge({
  status,
  state: forced,
  label,
  size = 34,
  showLabel = true,
  className = '',
}) {
  const state = forced && STATES[forced] ? forced : statusState(status)
  const meta = STATES[state] || STATES.offline
  const text = label ?? (status ? String(status) : state)

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Illustration name={meta.art} size={size} title={`${text} status`} />
      {showLabel && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize"
          style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${meta.color} 32%, transparent)` }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
