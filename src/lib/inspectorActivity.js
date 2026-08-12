/**
 * Who inspected what, and which vehicles nobody has been to.
 *
 * Two questions the Inspection Intelligence page could not answer before:
 *   1. what has each tyre man actually been doing (their own board), and
 *   2. for every vehicle in the fleet, has it been inspected or not.
 *
 * Both are pure functions over rows the page already loads. Nothing here
 * fetches, and nothing here invents a date: a vehicle that has never been
 * inspected keeps a null last-inspection date and reports "Never", which is a
 * different statement from "inspected a long time ago".
 */

/** A vehicle is treated as due again this many days after its last inspection. */
export const COVERAGE_STALE_DAYS = 7

const txt = (v) => String(v ?? '').trim()

function dayOf(row) {
  return row?.completed_date || row?.scheduled_date || row?.created_at?.slice(0, 10) || ''
}

function daysBetween(dateStr, now) {
  if (!dateStr) return null
  const t = new Date(dateStr).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((now - t) / 86400000)
}

/**
 * Per-inspector activity board.
 *
 * `completed` counts a record the inspector actually closed. An inspection
 * still open is NOT counted as work not done - it is counted as open, because
 * an inspection raised today is not a failure.
 */
export function inspectorActivity(inspections, { now = Date.now() } = {}) {
  const rows = Array.isArray(inspections) ? inspections : []
  const map = new Map()

  for (const r of rows) {
    const name = txt(r?.inspector)
    if (!name) continue
    let a = map.get(name)
    if (!a) {
      a = {
        inspector: name,
        total: 0,
        completed: 0,
        open: 0,
        withFindings: 0,
        sites: new Set(),
        assets: new Set(),
        lastActive: null,
      }
      map.set(name, a)
    }
    a.total += 1
    if (r?.completed_date || r?.status === 'Done') a.completed += 1
    else a.open += 1
    if (txt(r?.findings)) a.withFindings += 1
    if (txt(r?.site)) a.sites.add(txt(r.site))
    if (txt(r?.asset_no)) a.assets.add(txt(r.asset_no))
    const d = dayOf(r)
    if (d && (!a.lastActive || d > a.lastActive)) a.lastActive = d
  }

  return [...map.values()]
    .map((a) => ({
      inspector: a.inspector,
      total: a.total,
      completed: a.completed,
      open: a.open,
      withFindings: a.withFindings,
      sites: [...a.sites].sort(),
      vehicles: a.assets.size,
      lastActive: a.lastActive,
      daysSinceActive: daysBetween(a.lastActive, now),
      // null, not 0, when there is nothing to rate - an inspector with no
      // records has no completion rate, and printing 0% would read as failure.
      completionPct: a.total ? (a.completed / a.total) * 100 : null,
      findingsPct: a.total ? (a.withFindings / a.total) * 100 : null,
    }))
    .sort((x, y) => y.total - x.total || x.inspector.localeCompare(y.inspector))
}

/** Headline numbers for the activity board. */
export function activityTotals(activity) {
  const rows = Array.isArray(activity) ? activity : []
  const total = rows.reduce((s, r) => s + r.total, 0)
  const completed = rows.reduce((s, r) => s + r.completed, 0)
  const activeWeek = rows.filter((r) => r.daysSinceActive != null && r.daysSinceActive <= 7).length
  return {
    inspectors: rows.length,
    inspections: total,
    completed,
    open: total - completed,
    activeThisWeek: activeWeek,
    completionPct: total ? (completed / total) * 100 : null,
  }
}

/**
 * One row per FLEET vehicle: when it was last inspected and by whom.
 *
 * Built from every inspection, never from the page's date window - a vehicle
 * last inspected 200 days ago must still show that date rather than "Never".
 */
export function coverageRows(fleet, inspections, { now = Date.now(), staleDays = COVERAGE_STALE_DAYS } = {}) {
  const insp = Array.isArray(inspections) ? inspections : []
  const latest = new Map()

  for (const r of insp) {
    const asset = txt(r?.asset_no)
    if (!asset) continue
    const d = dayOf(r)
    const prev = latest.get(asset)
    if (!prev || (d && d > prev.date)) {
      latest.set(asset, { date: d, site: txt(r?.site), inspector: txt(r?.inspector), status: txt(r?.status) })
    }
  }

  return (Array.isArray(fleet) ? fleet : [])
    .map((v) => {
      const asset = txt(v?.asset_no)
      const last = latest.get(asset)
      const days = daysBetween(last?.date, now)
      const done = days != null && days <= staleDays
      return {
        asset_no: asset,
        site: txt(v?.site) || last?.site || 'Unknown',
        lastInspectionDate: last?.date || null,
        inspector: last?.inspector || null,
        daysSince: days,
        done,
        // Never inspected is its own state; it is not "overdue by Infinity".
        severity: done ? 'ok' : days == null ? 'never' : days > 30 ? 'critical' : days > 14 ? 'high' : 'medium',
      }
    })
    .filter((r) => r.asset_no)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const ad = a.daysSince == null ? Number.POSITIVE_INFINITY : a.daysSince
      const bd = b.daysSince == null ? Number.POSITIVE_INFINITY : b.daysSince
      return bd - ad || a.asset_no.localeCompare(b.asset_no)
    })
}

/** status: 'all' | 'done' | 'not_done' */
export function filterCoverage(rows, { site = '', status = 'all', search = '' } = {}) {
  const q = txt(search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (site && r.site !== site) return false
    if (status === 'done' && !r.done) return false
    if (status === 'not_done' && r.done) return false
    if (q) {
      const hay = `${r.asset_no} ${r.site} ${r.inspector || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function coverageTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const done = list.filter((r) => r.done).length
  const never = list.filter((r) => r.severity === 'never').length
  return {
    vehicles: list.length,
    done,
    notDone: list.length - done,
    never,
    coveragePct: list.length ? (done / list.length) * 100 : null,
  }
}
