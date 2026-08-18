/**
 * inspectionTyreFlags - pure helpers linking inspections to tyre running-life
 * flags (single-calc rule: the band judgement is bandFor from tyreRunningLife,
 * never re-derived here). No I/O; everything injectable and null-tolerant.
 */
import { bandFor } from './tyreRunningLife'
import { displayPositionCode, inspectionTypeHint } from './tyreBay'

/**
 * What a defect says when the inspection recorded no position at all. Kept as a
 * constant because it is written into the corrective-action KEY, so it must
 * never drift: an action already in the database was raised under this exact
 * text and is matched back by it.
 */
export const UNKNOWN_POSITION = 'unknown position'

/**
 * Group shaped running-life rows by asset.
 * Returns a plain object keyed by asset_no:
 *   { overdue: [rows], dueSoon: [rows], count }
 * Only assets that actually carry an overdue or due-soon tyre appear.
 */
export function buildAssetFlagMap(lifeRows = []) {
  const map = {}
  for (const row of Array.isArray(lifeRows) ? lifeRows : []) {
    if (!row || !row.asset) continue
    const band = bandFor(row)
    if (band !== 'overdue' && band !== 'due-soon') continue
    if (!map[row.asset]) map[row.asset] = { overdue: [], dueSoon: [], count: 0 }
    if (band === 'overdue') map[row.asset].overdue.push(row)
    else map[row.asset].dueSoon.push(row)
    map[row.asset].count += 1
  }
  return map
}

/**
 * WHAT COUNTS AS A FAULT AN INSPECTOR RECORDED.
 *
 * This used to be /damage|puncture/ and that quietly threw away most of what
 * inspectors actually report. The recorded vocabulary is exactly six words, and
 * these are every one of them, counted live:
 *
 *   Good     3,279   correctly not a fault
 *   Worn       326   <- never flagged
 *   Flat        60   <- never flagged
 *   Damaged     21       flagged
 *   Puncture     8       flagged
 *   Wear         4   <- never flagged (the web form's word for the same thing)
 *
 * So 390 of the 419 faults on record - 93% - never reached the system. A worn
 * tyre never entered the tracking table, no corrective action was ever raised
 * for it, and because the flag never existed its REPLACEMENT could never be
 * matched either: the fitter changed the tyre, the monthly consumption file
 * recorded the new one, and the report still showed nothing.
 *
 * Note the two vocabularies. The web form writes Good/Wear/Damage/Puncture; the
 * field app writes Good/Worn/Flat/Damaged/Puncture. Matching on stems rather
 * than on either word list is what keeps both surfaces working, and is why
 * "damage" also catches "Damaged".
 *
 * Worn and flat are exactly the conditions a tyre gets replaced FOR, so leaving
 * them out made the tracking blind to its own main case.
 *
 * Kept deliberately tight: it must never match "Good", which is 88% of every
 * condition ever recorded and the one word that means nothing is wrong.
 */
const FAULT_RE = /damage|puncture|worn|wear|flat|burst|blast|\bcut\b|bulge|separat/i

/**
 * The subset that stops a vehicle rather than schedules work. A flat, a cut
 * casing or a blowout is a road-safety item; a worn tyre is planned
 * replacement. Both are tracked, and they are not the same urgency - raising
 * everything as High would make High mean nothing.
 *
 * `flat` is in here deliberately: 60 of the recorded faults are flats, and a
 * flat tyre is the one condition on the list where the vehicle cannot be driven
 * at all.
 */
const SEVERE_RE = /damage|puncture|flat|burst|blast|\bcut\b|bulge|separat/i

function conditionOf(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (typeof value.condition === 'string') return value.condition
  }
  return ''
}

/**
 * Extract the damaged/punctured positions from one inspection's
 * tyre_conditions. Tolerates: an array of {position, condition}, an object
 * keyed by position (value = string or {condition}), or a JSON string of
 * either. Returns [] on anything unparseable.
 */
export function damagedPositions(inspection) {
  let tc = inspection ? inspection.tyre_conditions : null
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return [] }
  }
  if (!tc || typeof tc !== 'object') return []
  const out = []
  if (Array.isArray(tc)) {
    for (const entry of tc) {
      if (!entry || typeof entry !== 'object') continue
      const cond = conditionOf(entry)
      if (FAULT_RE.test(cond)) out.push({ position: entry.position || '', condition: cond })
    }
    return out
  }
  for (const [pos, val] of Object.entries(tc)) {
    const cond = conditionOf(val)
    if (FAULT_RE.test(cond)) out.push({ position: pos, condition: cond })
  }
  return out
}

/** True for a fault that should stop the vehicle rather than be scheduled. */
export function isSevereCondition(condition) {
  return SEVERE_RE.test(condition == null ? '' : String(condition))
}

/**
 * The stop-the-vehicle subset of damagedPositions.
 *
 * The tyre map burns a wheel RED off this, not off the full fault list: wear is
 * a fault and is tracked, but the app's own risk ladder puts it at warning, and
 * painting 326 worn tyres the same red as a blowout would make red mean
 * nothing. Both lists come from one place so the map and the flag can never
 * disagree about what was recorded - only about how urgent it is.
 */
export function severePositions(inspection) {
  return damagedPositions(inspection).filter((d) => isSevereCondition(d.condition))
}

function windowDate(r) {
  const raw = r.scheduled_date || r.inspection_date || r.completed_date || r.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

function inWindow(r, from, to) {
  if (!from && !to) return true
  const d = windowDate(r)
  if (!d) return false
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

/**
 * The "slide" numbers over the loaded inspections (optionally windowed by
 * from/to, YYYY-MM-DD string-prefix compare - same rule as the page filter).
 * Honest zeros; flagMap-derived figures are 0 when flagMap is empty.
 */
const WEAR_RE = /wear|worn/i
const GOOD_RE = /good|ok/i

/**
 * Count one inspection's tyre conditions into good / wear / damage / other.
 * Same shape tolerance as damagedPositions; zeros on anything unparseable.
 */
export function conditionCounts(inspection) {
  let tc = inspection ? inspection.tyre_conditions : null
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return { good: 0, wear: 0, damage: 0, other: 0 } }
  }
  const out = { good: 0, wear: 0, damage: 0, other: 0 }
  if (!tc || typeof tc !== 'object') return out
  const values = Array.isArray(tc) ? tc : Object.values(tc)
  for (const v of values) {
    const cond = conditionOf(v)
    if (!cond) continue
    // Wear is tested FIRST so a worn tyre is counted as wear rather than as
    // damage - this breakdown exists to keep the two apart. Everything else the
    // fault test recognises (flat, burst, cut) is damage; before this a burst
    // tyre fell into "other", which is a category nobody looks at.
    if (WEAR_RE.test(cond)) out.wear += 1
    else if (FAULT_RE.test(cond)) out.damage += 1
    else if (GOOD_RE.test(cond)) out.good += 1
    else out.other += 1
  }
  return out
}

/**
 * Shareable per-site summary: one row per site (Site, Inspections, Vehicles,
 * Good, Wear, Damage, Tyres due) + a totals row, over the given date window
 * and optional single-site filter. Tyres due = flagged tyres (overdue +
 * due soon) on the site's INSPECTED assets only - honest zeros when the
 * running-life feed is unavailable.
 */
export function siteSummary(inspections = [], flagMap = {}, { from = '', to = '', site = '' } = {}) {
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const list = (Array.isArray(inspections) ? inspections : []).filter((r) => {
    if (!r || !inWindow(r, from, to)) return false
    if (site && String(r.site || '') !== site) return false
    return true
  })
  const bySite = {}
  for (const r of list) {
    const key = String(r.site || '') || 'No site'
    if (!bySite[key]) bySite[key] = { site: key, inspections: 0, assets: new Set(), good: 0, wear: 0, damage: 0 }
    const b = bySite[key]
    b.inspections += 1
    if (r.asset_no) b.assets.add(r.asset_no)
    const c = conditionCounts(r)
    b.good += c.good; b.wear += c.wear; b.damage += c.damage
  }
  const rows = Object.values(bySite).map((b) => {
    let tyresDue = 0
    for (const asset of b.assets) {
      const entry = fm[asset]
      if (entry && entry.count) tyresDue += entry.count
    }
    return {
      site: b.site,
      inspections: b.inspections,
      vehicles: b.assets.size,
      good: b.good,
      wear: b.wear,
      damage: b.damage,
      tyresDue,
    }
  }).sort((a, b) => b.inspections - a.inspections || a.site.localeCompare(b.site))
  const totals = rows.reduce((t, r) => ({
    site: 'Total',
    inspections: t.inspections + r.inspections,
    vehicles: t.vehicles + r.vehicles,
    good: t.good + r.good,
    wear: t.wear + r.wear,
    damage: t.damage + r.damage,
    tyresDue: t.tyresDue + r.tyresDue,
  }), { site: 'Total', inspections: 0, vehicles: 0, good: 0, wear: 0, damage: 0, tyresDue: 0 })
  return { rows, totals }
}

/**
 * The defects on ONE inspection that warrant a tracked corrective action.
 *
 * Two independent sources, both already computed elsewhere and reused here so a
 * single judgement governs the flag, the badge and the action:
 *   - damagedPositions(inspection) - a tyre recorded as damaged or punctured
 *   - flagMap[asset] (from bandFor) - a tyre overdue or due soon on its life target
 *
 * `key` is the stable identity of the defect. It is what stops the same
 * inspection raising a second open action for the same tyre, and it is stored
 * as corrective_actions.source_detail, so it must stay stable for a given
 * defect: position first, because a position is what a fitter is sent to.
 *
 * THE KEY KEEPS THE STORED POSITION; only the SENTENCE is relabelled. The key
 * is already in the database on every action raised so far and is parsed back
 * out by tyreChangeTracking.parseActionKey - rewriting it would orphan every
 * open action and let the same defect be raised a second time. `positionLabel`
 * carries the canonical name (RHRI for a stored R2Ri) so what the fitter reads
 * matches the tyre records and the diagram.
 *
 * @returns {Array<{key,kind,position,positionLabel,condition,serial,title,priority,description}>}
 */
export function defectsForAction(inspection, flagMap = {}) {
  if (!inspection) return []
  const asset = inspection.asset_no || ''
  const typeHint = inspectionTypeHint(inspection)
  const out = []
  const seen = new Set()
  const push = (d) => { if (!seen.has(d.key)) { seen.add(d.key); out.push(d) } }
  // A position we cannot place keeps its own text, so no sentence ever names a
  // wheel we are not sure of.
  const label = (pos) => (pos === UNKNOWN_POSITION ? pos : displayPositionCode(typeHint, pos) || pos)

  for (const d of damagedPositions(inspection)) {
    const pos = d.position || UNKNOWN_POSITION
    const shown = label(pos)
    push({
      key: `damage:${pos}`,
      kind: 'damage',
      position: pos,
      positionLabel: shown,
      condition: d.condition,
      serial: '',
      title: `Tyre ${d.condition} at ${shown} on ${asset || 'asset'}`,
      // A cut casing or a blowout stops the vehicle; a worn tyre is planned
      // replacement. Raising both as High would make High mean nothing.
      priority: SEVERE_RE.test(d.condition) ? 'High' : 'Medium',
      description: SEVERE_RE.test(d.condition)
        ? `Inspection recorded "${d.condition}" at position ${shown}. Inspect and replace or repair the tyre before the vehicle returns to service.`
        : `Inspection recorded "${d.condition}" at position ${shown}. Plan a replacement for this tyre.`,
    })
  }

  const entry = asset ? flagMap[asset] : null
  if (entry) {
    // These come from the running-life feed, which already speaks the canonical
    // vocabulary, so relabelling them is a round trip that leaves them alone -
    // it is applied anyway so every defect on the list is named one way.
    for (const row of entry.overdue || []) {
      const pos = row.position || UNKNOWN_POSITION
      const shown = label(pos)
      push({
        key: `overdue:${pos}:${row.serial || ''}`,
        kind: 'overdue',
        position: pos,
        positionLabel: shown,
        condition: 'Past expected life',
        serial: row.serial || '',
        title: `Tyre past expected life at ${shown} on ${asset}`,
        priority: 'High',
        description: `The tyre at position ${shown}${row.serial ? ` (serial ${row.serial})` : ''} has passed its expected life. Schedule replacement.`,
      })
    }
    for (const row of entry.dueSoon || []) {
      const pos = row.position || UNKNOWN_POSITION
      const shown = label(pos)
      push({
        key: `duesoon:${pos}:${row.serial || ''}`,
        kind: 'due_soon',
        position: pos,
        positionLabel: shown,
        condition: 'Due soon',
        serial: row.serial || '',
        title: `Tyre due for change at ${shown} on ${asset}`,
        // Due soon is planning work, not a stop-the-vehicle item.
        priority: 'Medium',
        description: `The tyre at position ${shown}${row.serial ? ` (serial ${row.serial})` : ''} is approaching its expected life. Plan a replacement.`,
      })
    }
  }
  return out
}

/**
 * Build the corrective_actions rows for an inspection's defects. Pure - the
 * caller does the insert, so this stays testable and has no I/O.
 * `existingKeys` are the source_detail values already raised and still open;
 * they are skipped so pressing the button twice cannot duplicate an action.
 */
export function actionRowsForInspection(inspection, defects = [], { existingKeys = [] } = {}) {
  const skip = new Set(existingKeys)
  return (defects || [])
    .filter((d) => d && !skip.has(d.key))
    .map((d) => ({
      title: d.title.slice(0, 300),
      description: d.description,
      priority: d.priority,
      status: 'Open',
      asset_no: inspection?.asset_no || null,
      tyre_serial: d.serial || null,
      site: inspection?.site || null,
      country: inspection?.country || null,
      source_type: 'inspection',
      source_id: inspection?.id || null,
      source_detail: d.key,
    }))
}

export function inspectionOverview(inspections = [], flagMap = {}, { from = '', to = '' } = {}) {
  const list = (Array.isArray(inspections) ? inspections : []).filter((r) => r && inWindow(r, from, to))
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const assets = new Set()
  let approved = 0
  let pendingApproval = 0
  let damagedFound = 0
  for (const r of list) {
    if (r.asset_no) assets.add(r.asset_no)
    if (r.approval_status === 'approved') approved += 1
    else if (r.approval_status === 'pending_approval' || r.approval_status === 'pending') pendingApproval += 1
    damagedFound += damagedPositions(r).length
  }
  let vehiclesWithTyresDue = 0
  let tyresOverdue = 0
  let tyresDueSoon = 0
  for (const asset of assets) {
    const entry = fm[asset]
    if (!entry || !entry.count) continue
    vehiclesWithTyresDue += 1
    tyresOverdue += (entry.overdue || []).length
    tyresDueSoon += (entry.dueSoon || []).length
  }
  return {
    inspectionsDone: list.length,
    vehiclesInspected: assets.size,
    approved,
    pendingApproval,
    vehiclesWithTyresDue,
    tyresOverdue,
    tyresDueSoon,
    damagedFound,
  }
}

/**
 * The overview tiles are drill-downs, and these are the predicates behind them.
 *
 * THE POINT OF PUTTING THEM HERE: `inspectionOverview` above counts the tiles, and the
 * register filters the table. If those two used separate rules they would drift, and a
 * tile reading 7 that filters to 5 rows is worse than a tile you cannot click. Both sides
 * now read the SAME predicate.
 *
 * `measures` is load-bearing and is NOT decoration. Three of these tiles count TYRES or
 * VEHICLES, not inspection rows:
 *
 *   approved / pending      count INSPECTIONS  -> tile number == filtered row count
 *   tyres_due               counts VEHICLES    -> one vehicle can hold several inspections
 *   overdue / due_soon      count TYRES        -> one inspection can carry several
 *   damaged                 counts POSITIONS   -> likewise
 *
 * So for the last four the filtered row count is legitimately SMALLER than the tile, and
 * the screen has to say so rather than let the reader assume the filter lost rows.
 */
export const OVERVIEW_FOCUS = {
  approved:  { label: 'Approved',                 measures: 'inspections' },
  pending:   { label: 'Pending approval',         measures: 'inspections' },
  tyres_due: { label: 'Vehicles with tyres due',  measures: 'vehicles' },
  overdue:   { label: 'Tyres past life',          measures: 'tyres' },
  due_soon:  { label: 'Tyres due soon',           measures: 'tyres' },
  damaged:   { label: 'Damaged found',            measures: 'tyres' },
}

export const FOCUS_KEYS = Object.keys(OVERVIEW_FOCUS)

/**
 * Does this inspection contribute to that tile?
 *
 * An unknown key matches EVERYTHING rather than nothing - a stale URL carrying a focus
 * this build no longer has must show the full register, never an empty one that reads as
 * "there are no inspections".
 */
export function focusMatches(inspection, key, flagMap = {}) {
  if (!key || key === 'all' || !OVERVIEW_FOCUS[key]) return true
  const r = inspection || {}
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const entry = r.asset_no ? fm[r.asset_no] : null
  switch (key) {
    // Mirrors inspectionOverview's own test, including the legacy 'pending' token.
    case 'approved':  return r.approval_status === 'approved'
    case 'pending':   return r.approval_status === 'pending_approval' || r.approval_status === 'pending'
    case 'tyres_due': return !!(entry && entry.count)
    case 'overdue':   return !!(entry && (entry.overdue || []).length)
    case 'due_soon':  return !!(entry && (entry.dueSoon || []).length)
    case 'damaged':   return damagedPositions(r).length > 0
    default:          return true
  }
}

/**
 * What the focused view is actually showing, in the tile's own unit.
 *
 * Returns `{ key, label, measures, rows, units }` where `rows` is how many inspections
 * are on screen and `units` is how many of the thing the tile counts they cover - so the
 * screen can say "5 inspections covering 12 tyres past life" instead of leaving the
 * reader to wonder why 12 became 5. `units` is null when the tile already counts
 * inspections, because repeating the same number twice explains nothing.
 */
export function focusSummary(inspections = [], key, flagMap = {}) {
  const meta = OVERVIEW_FOCUS[key]
  if (!meta) return null
  const list = (Array.isArray(inspections) ? inspections : []).filter(Boolean)
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const rows = list.length
  if (meta.measures === 'inspections') return { key, ...meta, rows, units: null }

  if (meta.measures === 'vehicles') {
    const assets = new Set()
    for (const r of list) if (r.asset_no) assets.add(r.asset_no)
    return { key, ...meta, rows, units: assets.size }
  }
  // tyres: count per DISTINCT vehicle for the flag-derived tiles, or per inspection for
  // damage, exactly as inspectionOverview does - two inspections on one vehicle must not
  // double-count the same overdue tyre.
  if (key === 'damaged') {
    let units = 0
    for (const r of list) units += damagedPositions(r).length
    return { key, ...meta, rows, units }
  }
  const seen = new Set()
  let units = 0
  for (const r of list) {
    if (!r.asset_no || seen.has(r.asset_no)) continue
    seen.add(r.asset_no)
    const entry = fm[r.asset_no]
    if (!entry) continue
    units += ((key === 'overdue' ? entry.overdue : entry.dueSoon) || []).length
  }
  return { key, ...meta, rows, units }
}
