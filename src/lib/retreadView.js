/**
 * Pure shaping for the Retread Management page's casing register (the
 * retread_jobs table, migration 20261005101000). The tyre-record analysis
 * (retread CPK, savings, cycles) stays in retreadManagementAnalytics.js; this
 * file covers what only the jobs register can answer: where each casing is in
 * the pipeline, vendor turnaround and success, and the lifecycle of one casing.
 *
 * Honest rules: a value that cannot be measured is null (rendered N/A), never 0;
 * money is never added across currencies; turnaround needs both dates.
 */

export const JOB_STATUS = Object.freeze({
  eligible: { label: 'Eligible', tone: 'good' },
  at_vendor: { label: 'At vendor', tone: 'info' },
  qa: { label: 'QA / return', tone: 'purple' },
  returned: { label: 'Returned', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
})

export const OUTCOME = Object.freeze({
  pending: { label: 'Pending', tone: 'muted' },
  pass: { label: 'Pass', tone: 'good' },
  fail: { label: 'Fail', tone: 'bad' },
})

const DAY = 86400000
const toDay = (v) => {
  if (!v) return null
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Days from sent to returned. Null unless both dates exist and are ordered. */
export function turnaroundDays(job) {
  const s = toDay(job?.sent_at); const r = toDay(job?.returned_at)
  if (!s || !r || r < s) return null
  return Math.round((r - s) / DAY)
}

/** Days a casing has been at the vendor so far (open jobs only). */
export function daysAtVendor(job, now = new Date()) {
  if (!job || job.returned_at || !['at_vendor', 'qa'].includes(job.status)) return null
  const s = toDay(job.sent_at)
  if (!s) return null
  const today = toDay(now.toISOString())
  return Math.max(0, Math.round((today - s) / DAY))
}

/** Retread cost per km on the retread's own life. */
export function jobCpk(job) {
  const c = num(job?.cost); const km = num(job?.life_km)
  return c != null && km != null && km > 0 ? c / km : null
}

/**
 * Pipeline stages, in the order a casing moves. "Awaiting inspection" is an
 * eligible casing with no inspection date yet.
 */
export function pipelineCounts(jobs = []) {
  const live = jobs.filter((j) => j.status !== 'cancelled')
  const stages = [
    { key: 'awaiting', label: 'Awaiting inspection', tone: 'warn', test: (j) => j.status === 'eligible' && !j.inspected_at },
    { key: 'eligible', label: 'Inspected, eligible', tone: 'good', test: (j) => j.status === 'eligible' && !!j.inspected_at },
    { key: 'at_vendor', label: 'At vendor', tone: 'info', test: (j) => j.status === 'at_vendor' },
    { key: 'qa', label: 'QA / return', tone: 'purple', test: (j) => j.status === 'qa' },
    { key: 'returned', label: 'Returned to service', tone: 'good', test: (j) => j.status === 'returned' },
    { key: 'rejected', label: 'Rejected', tone: 'bad', test: (j) => j.status === 'rejected' },
  ]
  const counts = stages.map((s) => ({ key: s.key, label: s.label, tone: s.tone, count: live.filter(s.test).length }))
  const max = Math.max(0, ...counts.map((c) => c.count))
  return counts.map((c) => ({ ...c, pct: max > 0 ? Math.round((c.count / max) * 100) : 0 }))
}

/** Single currency of a set of jobs that carry a cost, or null when mixed / none. */
export function singleCurrency(jobs = []) {
  const set = new Set(jobs.filter((j) => num(j.cost) != null).map((j) => j.currency).filter(Boolean))
  return set.size === 1 ? [...set][0] : null
}

/**
 * Vendor scorecard from the jobs register. Success = passed / decided (pass or
 * fail). CPK and average cost only when every costed job is in one currency.
 */
export function vendorPerformance(jobs = []) {
  const map = new Map()
  for (const j of jobs) {
    if (j.status === 'cancelled') continue
    const name = (j.vendor_name || '').trim()
    if (!name) continue
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(j)
  }
  const out = []
  for (const [vendor, list] of map) {
    const decided = list.filter((j) => j.outcome === 'pass' || j.outcome === 'fail')
    const passed = decided.filter((j) => j.outcome === 'pass').length
    const tats = list.map(turnaroundDays).filter((v) => v != null)
    const currency = singleCurrency(list)
    const costs = list.map((j) => num(j.cost)).filter((v) => v != null)
    const cpks = list.map(jobCpk).filter((v) => v != null)
    out.push({
      vendor,
      jobs: list.length,
      decided: decided.length,
      successRate: decided.length ? (passed / decided.length) * 100 : null,
      avgTat: mean(tats),
      tatSample: tats.length,
      currency,
      avgCost: currency ? mean(costs) : null,
      cpk: currency ? mean(cpks) : null,
    })
  }
  return out.sort((a, b) => b.jobs - a.jobs || a.vendor.localeCompare(b.vendor))
}

/** Jobs without a vendor are not in the scorecard; count them so the gap is visible. */
export const jobsWithoutVendor = (jobs = []) => jobs.filter((j) => j.status !== 'cancelled' && !(j.vendor_name || '').trim()).length

export function filterJobs(jobs = [], { search = '', site = 'All', vendor = 'All', status = 'All', grade = 'All' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return jobs.filter((j) => {
    if (site !== 'All' && j.site !== site) return false
    if (vendor !== 'All' && (j.vendor_name || '') !== vendor) return false
    if (status !== 'All' && j.status !== status) return false
    if (grade !== 'All' && (j.grade || '') !== grade) return false
    if (!q) return true
    return [j.casing_serial, j.brand, j.size, j.last_asset_no, j.vendor_name, j.site]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

export const optionsOf = (jobs = [], key) => [...new Set(jobs.map((j) => j[key]).filter(Boolean))].sort()

/** Headline numbers for the register, each null when not measurable. */
export function jobSummary(jobs = []) {
  const live = jobs.filter((j) => j.status !== 'cancelled')
  const open = live.filter((j) => ['eligible', 'at_vendor', 'qa'].includes(j.status)).length
  const decided = live.filter((j) => j.outcome === 'pass' || j.outcome === 'fail')
  const passed = decided.filter((j) => j.outcome === 'pass').length
  const tats = live.map(turnaroundDays).filter((v) => v != null)
  return {
    total: live.length,
    open,
    successRate: decided.length ? (passed / decided.length) * 100 : null,
    avgTat: mean(tats),
  }
}

/**
 * The selected casing's story, oldest step first. Each step only appears when
 * the date or value behind it is recorded.
 */
export function lifecycleSteps(job, fmtDate = (d) => d) {
  if (!job) return []
  const steps = []
  if (job.first_life_km != null) steps.push(`${Number(job.first_life_km).toLocaleString('en-US')} km first life`)
  if (job.last_asset_no) steps.push(`Removed from ${job.last_asset_no}`)
  if (job.inspected_at) steps.push(`Casing inspection ${fmtDate(job.inspected_at)}${job.grade ? `, grade ${job.grade}` : ''}`)
  else if (job.grade) steps.push(`Casing grade ${job.grade}`)
  if (job.sent_at) steps.push(`Sent to ${job.vendor_name || 'vendor'} ${fmtDate(job.sent_at)}`)
  if (job.returned_at) steps.push(`Returned ${fmtDate(job.returned_at)}`)
  if (job.outcome && job.outcome !== 'pending') steps.push(job.outcome === 'pass' ? 'Passed QA' : 'Failed QA')
  return steps
}
