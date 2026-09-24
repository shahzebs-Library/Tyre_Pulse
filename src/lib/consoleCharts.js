/**
 * Pure shapers for console charts. Kept separate from the chart components so
 * the arithmetic is testable without a canvas.
 */

function dayKey(d) {
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
  return x.toISOString().slice(0, 10)
}

/**
 * A continuous daily series ending today. Days with no rows are 0, never
 * missing: a gap in a bar chart reads as "no data", while a zero reads as
 * "nothing happened", and for a count of events the second is the truth.
 *
 * @param rows     array of records
 * @param dateOf   (row) => date value
 * @param days     window length including today
 * @param valueOf  (row) => number to add (default 1 = count)
 */
export function dailySeries(rows = [], dateOf, days = 14, valueOf = () => 1, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const keys = []
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  const sums = Object.fromEntries(keys.map((k) => [k, 0]))
  for (const r of rows || []) {
    const k = dayKey(dateOf(r))
    if (k && k in sums) sums[k] += Number(valueOf(r)) || 0
  }
  return {
    keys,
    labels: keys.map((k) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })),
    values: keys.map((k) => sums[k]),
    total: keys.reduce((a, k) => a + sums[k], 0),
  }
}

/**
 * The largest `n` categories and one "Other" bucket for the rest, so a
 * share chart never has more slices than a reader can tell apart.
 */
export function topShare(rows = [], keyOf, n = 5, otherLabel = 'Other') {
  const counts = new Map()
  for (const r of rows || []) {
    const k = keyOf(r) || 'Not set'
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  const head = sorted.slice(0, n).map(([label, value]) => ({ label, value }))
  const rest = sorted.slice(n).reduce((a, [, v]) => a + v, 0)
  if (rest > 0) head.push({ label: otherLabel, value: rest })
  return head
}
