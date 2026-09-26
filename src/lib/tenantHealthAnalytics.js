/**
 * tenantHealthAnalytics - pure presentation engine for the Tenant Health page.
 *
 * src/lib/tenantHealth.js fetches and shapes the five report slices (users,
 * activity, ai, growth, adoption). This module turns that report into the
 * decision layer the page shows: headline KPIs, ratios, a trend read, health
 * signals and the rows behind each register table and export.
 *
 * DESIGN CONTRACT
 *   - Pure and deterministic. No I/O, no supabase, no React. The clock is
 *     injected as `now` wherever a staleness or age test needs it.
 *   - Honest nulls. A failed slice, an empty denominator or a count that could
 *     not be read is null, never 0. "We could not measure this" and "the value
 *     is zero" are opposite statements and stay distinct.
 *   - One currency. AI spend is recorded in USD only (ai_token_logs.cost_usd or
 *     the token price table, which is USD), so no conversion or blending occurs.
 */

const DAY_MS = 86400000
const round1 = (n) => Math.round(n * 10) / 10

/** Minutes after which a report on screen is flagged as stale. */
export const STALE_MINUTES = 60
/** Activation below this share of approved users raises a signal. */
export const LOW_ACTIVATION = 0.3

const ok = (slice) => slice?.status === 'ok' && slice.data != null
const data = (slice) => (ok(slice) ? slice.data : null)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ratio = (n, d) => {
  const a = finite(n)
  const b = finite(d)
  if (a == null || b == null || b <= 0) return null
  return a / b
}
const toMs = (v) => {
  if (v == null || v === '') return null
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Percent change prev -> current (1dp). null when prev is 0 or input unusable. */
function change(current, prev) {
  const c = finite(current)
  const p = finite(prev)
  if (c == null || p == null || p === 0) return null
  return round1(((c - p) / p) * 100)
}

// ── Activity trend ────────────────────────────────────────────────────────────

/**
 * Read a zero-filled per-day series. Compares the first half of the window with
 * the second half, finds the peak day and counts the days with any activity.
 * Returns null fields when the series is empty (nothing to read).
 *
 * @param {Array<{date:string}>} series
 * @param {string} key numeric field to read (for example 'events' or 'cost')
 */
export function seriesTrend(series, key = 'events') {
  const list = Array.isArray(series) ? series.filter((d) => d && typeof d.date === 'string') : []
  if (list.length === 0) {
    return { firstHalf: null, secondHalf: null, change: null, direction: null, peak: null, activeDays: null, days: 0 }
  }
  const vals = list.map((d) => finite(d[key]) ?? 0)
  const mid = Math.floor(vals.length / 2)
  const firstHalf = vals.slice(0, mid).reduce((a, b) => a + b, 0)
  const secondHalf = vals.slice(mid).reduce((a, b) => a + b, 0)
  const pct = mid > 0 ? change(secondHalf, firstHalf) : null
  let peakIdx = -1
  vals.forEach((v, i) => { if (v > 0 && (peakIdx < 0 || v > vals[peakIdx])) peakIdx = i })
  let direction = null
  if (mid > 0) {
    if (firstHalf === 0 && secondHalf === 0) direction = 'flat'
    else if (pct == null) direction = secondHalf > 0 ? 'up' : 'flat'
    else if (pct > 5) direction = 'up'
    else if (pct < -5) direction = 'down'
    else direction = 'flat'
  }
  return {
    firstHalf,
    secondHalf,
    change: pct,
    direction,
    peak: peakIdx >= 0 ? { date: list[peakIdx].date, value: vals[peakIdx] } : null,
    activeDays: vals.filter((v) => v > 0).length,
    days: vals.length,
  }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

/**
 * Headline KPIs over a runTenantReport() result. Every value is null when its
 * slice failed or its denominator is empty.
 */
export function tenantKpis(report) {
  const users = data(report?.users)
  const activity = data(report?.activity)
  const ai = data(report?.ai)
  const growth = data(report?.growth)
  const adoption = data(report?.adoption)

  const totalUsers = users ? users.total : null
  const approved = users ? users.approved : null
  const activeUsers = activity ? activity.activeUsers : null
  const totalEvents = activity ? activity.totalEvents : null
  const aiCalls = ai ? ai.totalCalls : null

  return {
    totalUsers,
    approved,
    pending: users ? users.pending : null,
    locked: users ? users.locked : null,
    newUsers: users ? users.newLast30 : null,
    approvalRate: users ? ratio(approved, totalUsers) : null,
    activeUsers,
    activationRate: users && activity ? ratio(activeUsers, approved) : null,
    totalEvents,
    eventsPerActiveUser: activity && ratio(totalEvents, activeUsers) != null ? round1(totalEvents / activeUsers) : null,
    totalRecords: growth && growth.complete ? finite(growth.totalRecords) : null,
    aiCost: ai ? finite(ai.totalCost) : null,
    aiTokens: ai ? finite(ai.totalTokens) : null,
    aiCalls,
    aiCostPerCall: ai ? ratio(ai.totalCost, aiCalls) : null,
    modulesInUse: adoption ? adoption.length : null,
    activityTrend: activity ? seriesTrend(activity.eventsPerDay, 'events') : null,
    aiTrend: ai ? seriesTrend(ai.costPerDay, 'cost') : null,
  }
}

// ── Health signals ────────────────────────────────────────────────────────────

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 }

/**
 * Plain-English findings a platform owner should act on, most severe first.
 * Never invents a problem from missing data: a failed slice is reported as a
 * failed slice, not as a zero reading.
 *
 * @param {object} report runTenantReport() result
 * @param {{ now?: Date|number|string }} [opts]
 * @returns {Array<{ key:string, severity:'critical'|'warning'|'info', title:string, detail:string }>}
 */
export function healthSignals(report, { now = Date.now() } = {}) {
  const out = []
  if (!report) return out
  const k = tenantKpis(report)

  const failed = ['users', 'activity', 'ai', 'growth', 'adoption'].filter((s) => report[s]?.status === 'error')
  if (failed.length) {
    out.push({
      key: 'failed-slices',
      severity: 'warning',
      title: `${failed.length} report section${failed.length === 1 ? '' : 's'} could not be read`,
      detail: `Unavailable: ${failed.join(', ')}. Those figures show N/A rather than zero.`,
    })
  }

  const growth = data(report.growth)
  if (growth && growth.complete === false) {
    out.push({
      key: 'growth-incomplete',
      severity: 'info',
      title: 'Some table counts failed',
      detail: 'The combined record total is withheld because at least one table could not be counted.',
    })
  }

  if (k.pending != null && k.pending > 0) {
    out.push({
      key: 'pending',
      severity: 'warning',
      title: `${k.pending} user${k.pending === 1 ? '' : 's'} awaiting approval`,
      detail: 'Pending users cannot use the platform until an administrator approves them.',
    })
  }

  if (k.locked != null && k.locked > 0) {
    out.push({
      key: 'locked',
      severity: 'info',
      title: `${k.locked} locked account${k.locked === 1 ? '' : 's'}`,
      detail: 'Review whether these accounts should be unlocked or removed.',
    })
  }

  if (k.activationRate != null && k.activationRate < LOW_ACTIVATION) {
    out.push({
      key: 'low-activation',
      severity: 'warning',
      title: `Only ${Math.round(k.activationRate * 100)}% of approved users were active`,
      detail: `Fewer than ${Math.round(LOW_ACTIVATION * 100)}% of approved users recorded any activity in the window.`,
    })
  }

  const act = data(report.activity)
  if (act && Array.isArray(act.eventsPerDay) && act.eventsPerDay.length >= 7) {
    const last7 = act.eventsPerDay.slice(-7).reduce((a, d) => a + (finite(d.events) ?? 0), 0)
    if (last7 === 0) {
      out.push({
        key: 'quiet-week',
        severity: 'critical',
        title: 'No recorded activity in the last 7 days',
        detail: 'The audit log holds no events for the past week. Check whether the tenant is still using the platform.',
      })
    }
  }

  if (k.activityTrend?.direction === 'down' && k.activityTrend.change != null) {
    out.push({
      key: 'activity-down',
      severity: 'warning',
      title: `Activity fell ${Math.abs(k.activityTrend.change)}% across the window`,
      detail: 'The second half of the window recorded fewer events than the first half.',
    })
  }

  const genMs = toMs(report.generatedAt)
  const nowMs = toMs(now)
  if (genMs != null && nowMs != null && nowMs - genMs > STALE_MINUTES * 60000) {
    out.push({
      key: 'stale',
      severity: 'info',
      title: 'These figures are more than an hour old',
      detail: 'Refresh to read the latest activity.',
    })
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.key.localeCompare(b.key))
}

// ── Register sections (rows behind the table and the exports) ─────────────────

/** Column contract per register section: keys + headers for table and export. */
export const REGISTER_SECTIONS = Object.freeze({
  modules: {
    label: 'Module adoption',
    cols: ['module', 'events', 'share'],
    headers: ['Module', 'Events', 'Share (%)'],
  },
  roles: {
    label: 'Users by role',
    cols: ['role', 'users', 'share'],
    headers: ['Role', 'Users', 'Share (%)'],
  },
  tables: {
    label: 'Data growth',
    cols: ['label', 'table', 'count', 'state'],
    headers: ['Dataset', 'Table', 'Records', 'State'],
  },
  features: {
    label: 'AI spend by feature (USD)',
    cols: ['feature', 'calls', 'tokens', 'cost', 'costPerCall'],
    headers: ['Feature', 'Calls', 'Tokens', 'Cost (USD)', 'Cost per call (USD)'],
  },
  pending: {
    label: 'Pending approvals',
    cols: ['name', 'role', 'requested', 'waitingDays'],
    headers: ['Name', 'Role', 'Requested', 'Waiting (days)'],
  },
})

/**
 * Rows for one register section. Returns { rows, available } where available is
 * false when the backing slice failed, so the page can say "could not be read"
 * instead of showing an empty table that reads as "nothing exists".
 */
export function registerRows(report, section, { now = Date.now() } = {}) {
  switch (section) {
    case 'modules': {
      const d = data(report?.adoption)
      return {
        available: d != null,
        rows: (d || []).map((m) => ({ id: m.module, module: m.module, events: m.events, share: m.share })),
      }
    }
    case 'roles': {
      const d = data(report?.users)
      const total = d?.total ?? 0
      return {
        available: d != null,
        rows: Object.entries(d?.byRole || {})
          .map(([role, users]) => ({
            id: role,
            role,
            users,
            share: total > 0 ? round1((users / total) * 100) : null,
          }))
          .sort((a, b) => b.users - a.users || a.role.localeCompare(b.role)),
      }
    }
    case 'tables': {
      const d = data(report?.growth)
      return {
        available: d != null,
        rows: (d?.tables || []).map((t) => ({
          id: t.table,
          label: t.label,
          table: t.table,
          count: t.error ? null : finite(t.count),
          state: t.error ? 'Unavailable' : 'Counted',
        })),
      }
    }
    case 'features': {
      const d = data(report?.ai)
      return {
        available: d != null,
        rows: (d?.byFeature || []).map((f) => ({
          id: f.feature,
          feature: f.feature,
          calls: f.calls,
          tokens: f.tokens,
          cost: finite(f.cost),
          costPerCall: ratio(f.cost, f.calls),
        })),
      }
    }
    case 'pending': {
      const d = data(report?.users)
      const nowMs = toMs(now)
      return {
        available: d != null,
        rows: (d?.pendingUsers || []).map((u, i) => {
          const created = toMs(u.createdAt)
          const waitingDays = created != null && nowMs != null && nowMs >= created
            ? Math.floor((nowMs - created) / DAY_MS)
            : null
          return {
            id: u.id ?? `pending-${i}`,
            name: u.name,
            role: u.role,
            requested: u.createdAt ? String(u.createdAt).slice(0, 10) : null,
            waitingDays,
          }
        }).sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || String(a.name).localeCompare(String(b.name))),
      }
    }
    default:
      return { available: false, rows: [] }
  }
}

/** Case-insensitive search across every string/number field of a row. */
export function searchRows(rows, search) {
  const q = String(search ?? '').trim().toLowerCase()
  const list = Array.isArray(rows) ? rows : []
  if (!q) return list
  return list.filter((r) => Object.entries(r).some(([k, v]) =>
    k !== 'id' && v != null && String(v).toLowerCase().includes(q)))
}

/** Export matrix for a section: nulls print as N/A, never as 0. */
export function exportRowsFor(section, rows) {
  const spec = REGISTER_SECTIONS[section]
  if (!spec) return []
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const out = {}
    for (const c of spec.cols) {
      const v = r[c]
      if (v == null) out[c] = 'N/A'
      else if ((c === 'cost' || c === 'costPerCall') && typeof v === 'number') out[c] = v.toFixed(4)
      else out[c] = v
    }
    return out
  })
}
