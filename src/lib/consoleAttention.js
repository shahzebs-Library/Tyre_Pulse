/**
 * "Anything waiting on me?" - pure shaping for the console dashboard's
 * attention panel. Turns raw counts and feed dates into a short, plain-English
 * list of items that actually need the owner, each with where to go.
 *
 * Honesty rules: a count we could not read is UNKNOWN, never zero (a zero says
 * "all clear" and an unreadable count says no such thing); a feed with no data
 * at all is reported as such, not as "stale since 1970".
 */

/** Days between an ISO date and now; null when the date is missing/invalid. */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86400000))
}

/**
 * Band a feed's freshness. Event-driven business feeds are judged loosely -
 * a weekend of silence is normal, a fortnight is not.
 */
export function freshnessBand(days) {
  if (days == null) return 'unknown'
  if (days <= 3) return 'fresh'
  if (days <= 10) return 'aging'
  return 'stale'
}

/**
 * Build the attention list. Every input is optional; an item only appears
 * when there is genuinely something to act on (or when we must admit we
 * could not check). Order = severity, worst first.
 *
 * @param {{
 *   pendingUsers?: number|null, lockedUsers?: number|null,
 *   unresolvedErrors?: number|null, openTrustAlerts?: number|null,
 *   feeds?: Array<{label:string, latest:string|null}>,
 *   now?: number,
 * }} x
 * @returns {Array<{key:string, tone:'danger'|'warning'|'info', text:string, to:string}>}
 */
export function buildAttention(x = {}) {
  const now = x.now ?? Date.now()
  const items = []
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const errs = num(x.unresolvedErrors)
  if (errs === null) {
    items.push({ key: 'errors', tone: 'warning', text: 'Could not check the error log - open it to be sure.', to: '/console/health' })
  } else if (errs > 0) {
    items.push({ key: 'errors', tone: 'danger', text: `${errs} unresolved app error${errs === 1 ? '' : 's'} in the last 7 days.`, to: '/console/health' })
  }

  const alerts = num(x.openTrustAlerts)
  if (alerts != null && alerts > 0) {
    items.push({ key: 'trust', tone: 'warning', text: `${alerts} open data-trust alert${alerts === 1 ? '' : 's'} from the quality checks.`, to: '/console/trust-alerts' })
  }

  const pending = num(x.pendingUsers)
  if (pending != null && pending > 0) {
    items.push({ key: 'pending', tone: 'warning', text: `${pending} user${pending === 1 ? '' : 's'} waiting for your approval.`, to: '/console/users' })
  }

  const locked = num(x.lockedUsers)
  if (locked != null && locked > 0) {
    items.push({ key: 'locked', tone: 'info', text: `${locked} account${locked === 1 ? ' is' : 's are'} locked.`, to: '/console/users' })
  }

  ;(x.feeds || []).forEach((f) => {
    const d = daysSince(f.latest, now)
    const band = freshnessBand(d)
    if (band === 'stale') {
      items.push({ key: `feed:${f.label}`, tone: 'warning', text: `${f.label}: no new data for ${d} days.`, to: '/console/import-history' })
    } else if (band === 'unknown') {
      items.push({ key: `feed:${f.label}`, tone: 'info', text: `${f.label}: no data recorded yet.`, to: '/console/import-history' })
    }
  })

  const rank = { danger: 0, warning: 1, info: 2 }
  return items.sort((a, b) => rank[a.tone] - rank[b.tone])
}
