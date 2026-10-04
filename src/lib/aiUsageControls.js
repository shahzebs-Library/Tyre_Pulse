/**
 * Pure helpers for the console AI Usage page controls (budget, kill switch,
 * rate limit, month-end projection, latency). No I/O.
 *
 * Honesty rules: an unknown input gives null (rendered "N/A" with a reason),
 * never a fabricated 0.
 */

/** Parse a system_config value that may be stored bare or JSON-quoted. */
export function parseConfigNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  let v = raw
  try { v = JSON.parse(raw) } catch { /* stored bare */ }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 'true'/'false' (or JSON) to boolean; unknown gives null. */
export function parseConfigBool(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const s = String(raw).replace(/"/g, '').trim().toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return null
}

/**
 * Straight-line month-end projection from month-to-date spend.
 * @param {number|null} mtdSpend spend since the 1st (UTC)
 * @param {Date} [now]
 * @returns {{projected:number|null, dayOfMonth:number, daysInMonth:number}}
 */
export function projectMonthEnd(mtdSpend, now = new Date()) {
  const day = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  if (mtdSpend === null || mtdSpend === undefined || !Number.isFinite(Number(mtdSpend))) {
    return { projected: null, dayOfMonth: day, daysInMonth }
  }
  // Day 1 has too little history to project from honestly.
  if (day < 2) return { projected: null, dayOfMonth: day, daysInMonth }
  return { projected: (Number(mtdSpend) / day) * daysInMonth, dayOfMonth: day, daysInMonth }
}

/** Nearest-rank percentile over finite numbers; null when there are none. */
export function percentile(values = [], p = 50) {
  const list = (values || [])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (!list.length) return null
  const rank = Math.min(list.length, Math.max(1, Math.ceil((p / 100) * list.length)))
  return list[rank - 1]
}

/**
 * Validate a budget or rate-limit input. 0 means "no cap".
 * @returns {string|null} a plain-English problem, or null when valid
 */
export function validateCap(raw, { max = 1_000_000, integer = false } = {}) {
  if (raw === '' || raw === null || raw === undefined) return 'Enter a number. Use 0 for no cap.'
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 'Enter zero or a positive number.'
  if (integer && !Number.isInteger(n)) return 'Enter a whole number.'
  if (n > max) return `Enter a number no larger than ${max.toLocaleString('en-US')}.`
  return null
}

/** Plain-English impact for each AI control. */
export function aiControlImpact(kind, { budget, rateLimit, next } = {}) {
  if (kind === 'pause') {
    return {
      what: 'Turn off every AI feature for everyone.', tone: 'danger',
      change: 'The AI copilot and AI jobs refuse new requests straight away. Nothing already answered is lost.',
      who: 'Every user in every organisation who uses an AI feature.',
      undo: 'Yes. Resume AI here; it works again on the next request.',
    }
  }
  if (kind === 'resume') {
    return {
      what: 'Turn AI features back on.', tone: 'info',
      change: 'AI requests are accepted again, within the budget and rate limit.',
      who: 'Every user who uses an AI feature.', undo: 'Yes. Pause again here.',
    }
  }
  if (kind === 'budget') {
    return {
      what: 'Change the monthly AI spend cap.', tone: 'warning',
      change: `From ${budget ? `$${budget}` : 'no cap'} to ${Number(next) > 0 ? `$${next}` : 'no cap'} a month. When month-to-date spend reaches the cap, AI requests are refused until the 1st.`,
      who: 'Every user of AI features once the cap is reached.', undo: 'Yes. Change it again here.',
    }
  }
  return {
    what: 'Change how many AI requests one person may make a minute.', tone: 'warning',
    change: `From ${rateLimit ? `${rateLimit} a minute` : 'no limit'} to ${Number(next) > 0 ? `${next} a minute` : 'no limit'}. Requests over the limit are refused and logged as rate limited.`,
    who: 'Each person using AI features.', undo: 'Yes. Change it again here.',
  }
}
