/**
 * trustAlertOps.js - pure helpers for the Data Trust Alerts desk.
 *
 * Time to acknowledge and time to resolve (medians, never a fake 0), the
 * plain-English impact of a decision, and which decisions are allowed from a
 * given state. No I/O.
 */

const ts = (v) => {
  const t = new Date(v || '').getTime()
  return Number.isFinite(t) ? t : null
}

function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median hours from raised to acknowledged / resolved. null when unmeasurable. */
export function responseTimes(rows) {
  const ack = []
  const res = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const c = ts(r.created_at)
    if (c == null) continue
    const a = ts(r.acked_at)
    const z = ts(r.resolved_at)
    if (a != null && a >= c) ack.push((a - c) / 3600000)
    if (r.status === 'resolved' && z != null && z >= c) res.push((z - c) / 3600000)
  }
  return { mtta: median(ack), mttr: median(res), ackSample: ack.length, resolveSample: res.length }
}

/** 0.4 -> '24 min', 5 -> '5.0 h', 50 -> '2.1 days'. null -> 'N/A'. */
export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return 'N/A'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} days`
}

/** Decisions allowed from a status. */
export function allowedDecisions(status) {
  if (status === 'open') return ['ack', 'resolved']
  if (status === 'ack') return ['resolved', 'open']
  if (status === 'resolved') return ['open']
  return []
}

export const DECISION_LABEL = { ack: 'Acknowledge', resolved: 'Resolve', open: 'Reopen' }

/** ImpactBox props for a decision on `count` alerts. */
export function decisionImpact(next, count = 1) {
  const n = count === 1 ? 'this alert' : `these ${count} alerts`
  if (next === 'ack') {
    return {
      what: `Acknowledge ${n}`,
      change: 'The status moves to Acknowledged and you are recorded as the owner.',
      who: 'Admins watching this desk see the alert is owned. Nothing in the data changes.',
      undo: 'Yes. Reopen it at any time; the timeline keeps both steps.',
      tone: 'info',
    }
  }
  if (next === 'resolved') {
    return {
      what: `Resolve ${n}`,
      change: 'The status moves to Resolved with your reason. It stops counting as open in the tiles and the Overview.',
      who: 'Everyone who reads this desk. The next scan raises a new alert if the breach is still there.',
      undo: 'Yes. Reopen it; the timeline keeps the reason you gave.',
      tone: 'warning',
    }
  }
  return {
    what: `Reopen ${n}`,
    change: 'The status goes back to Open and the resolution is cleared.',
    who: 'It counts as open again on this desk and on the Overview.',
    undo: 'Yes. Acknowledge or resolve it again.',
    tone: 'warning',
  }
}
