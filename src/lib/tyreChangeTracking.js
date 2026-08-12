/**
 * tyreChangeTracking - pure engine behind "Tyre change tracking".
 *
 * ONE question: a tyre was flagged for change - did it actually get changed?
 *
 * WHERE A FLAG COMES FROM, and why both sources are kept apart rather than
 * merged into a single count:
 *   - RAISED BY THE SYSTEM - the running-life rule found the tyre past its
 *     expected life or close to it. The judgement is bandFor (tyreRunningLife),
 *     never re-derived here, so the flag on this report and the badge on
 *     Running & Remaining can never disagree.
 *   - RAISED BY A USER - an inspector recorded damage or a puncture on a
 *     position (damagedPositions), or someone turned a finding into a tracked
 *     corrective action (V496).
 * A manager acts on those differently: one is planned replacement, the other is
 * a vehicle that may not be safe to run today.
 *
 * HOW "REPLACED" IS DECIDED. It is DERIVED from the monthly consumption that is
 * already uploaded (tyre_records), never ticked by hand: a flagged tyre counts
 * as replaced when a DIFFERENT tyre was fitted on the SAME asset at the SAME
 * position AFTER the flag. Nobody maintains a second list, so the tracking
 * cannot drift from what was actually fitted.
 *
 * THE FOUR STATES ARE NEVER COLLAPSED. "We could not tell" and "not replaced"
 * are opposite statements: reporting a tyre as still fitted when the truth is
 * that its position was never recorded would send a fitter to a wheel nobody
 * can identify, and would make this whole report worthless. Anything that
 * cannot be matched says so.
 *
 * Deterministic and I/O free: `now` is injected, so tests pin real dates.
 */
import { canonicalCode } from './tyrePositions'
import { bandFor } from './tyreRunningLife'
import { damagedPositions } from './inspectionTyreFlags'
import { isRemovedOrScrapped } from './tyrePool'

const txt = (v) => (v == null ? '' : String(v).trim())
const day = (v) => (v ? String(v).slice(0, 10) : '')

/**
 * Comparable position key. Positions arrive in more than one vocabulary
 * (LHF1 / LHR1-O from the ERP, LHST1-style free text from mechanics), so the
 * shared canonicalCode does the folding - the same helper the diagram and the
 * tyre bay already use. An unparseable token keeps its own upper-cased text
 * rather than being coerced into a wheel it may not be.
 */
export function positionKey(raw) {
  const s = txt(raw)
  if (!s) return ''
  const canon = canonicalCode(s)
  return String(canon || s).toUpperCase().replace(/\s+/g, '')
}

/**
 * Identity of a wheel. Country is part of it because the SAME asset code exists
 * in more than one country and is usually a DIFFERENT machine (V376) - matching
 * on the code alone would replace a KSA tyre with a UAE fitment.
 */
export function wheelKey(country, asset, position) {
  return [txt(country).toUpperCase(), txt(asset).toUpperCase(), positionKey(position)].join('|')
}

const serialKey = (v) => txt(v).toUpperCase()

/** Whole days between two YYYY-MM-DD strings; null when either is missing. */
export function daysBetween(fromDate, toDate) {
  const a = day(fromDate); const b = day(toDate)
  if (!a || !b) return null
  const t1 = Date.parse(`${a}T00:00:00Z`); const t2 = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null
  return Math.round((t2 - t1) / 86400000)
}

/** The four states, each with the plain-English sentence the UI prints. */
export const TRACK_STATE_META = {
  on_vehicle: {
    label: 'Still on the vehicle',
    tone: 'danger',
    note: 'Flagged and not replaced yet - the same tyre is still fitted.',
  },
  replaced: {
    label: 'Replaced',
    tone: 'good',
    note: 'A different tyre was fitted at this position after the flag.',
  },
  removed_not_replaced: {
    label: 'Removed, nothing fitted',
    tone: 'warning',
    note: 'The tyre came off and no replacement has been recorded at this position.',
  },
  unknown: {
    label: 'Could not tell',
    tone: 'quiet',
    note: 'Not enough recorded to match this flag to a fitment.',
  },
}

export const TRACK_STATES = Object.keys(TRACK_STATE_META)

export const SOURCE_META = {
  system: { label: 'Raised by system', note: 'Past expected life or due soon.' },
  user: { label: 'Raised by user', note: 'Damage or a puncture recorded by a person.' },
}

/** Normalise one tyre_records row to the few fields the matcher needs. */
export function shapeTyreRecord(r = {}) {
  const fitted = day(r.fitment_date) || day(r.issue_date)
  return {
    serial: txt(r.serial_no || r.serial_number || r.tyre_serial),
    asset: txt(r.asset_no),
    position: txt(r.position || r.tyre_position),
    country: txt(r.country),
    brand: txt(r.brand),
    size: txt(r.size),
    site: txt(r.site),
    fittedOn: fitted || '',
    removedOn: day(r.removal_date) || '',
    // The removal test is the shared one (tyrePool), so "off the vehicle" means
    // the same thing here as it does in the pool and lifecycle views.
    removed: isRemovedOrScrapped(r),
    status: txt(r.status),
  }
}

/** Group shaped fitment records by wheel, oldest fitment first. */
export function indexFitments(records = []) {
  const map = new Map()
  for (const raw of Array.isArray(records) ? records : []) {
    const r = raw && raw.__shaped ? raw : shapeTyreRecord(raw || {})
    if (!r.asset || !r.position) continue
    const key = wheelKey(r.country, r.asset, r.position)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.fittedOn || '').localeCompare(b.fittedOn || ''))
  }
  return map
}

/* ------------------------------------------------------------------ flags */

function baseFlag(f) {
  return {
    source: f.source,
    kind: f.kind,
    country: txt(f.country),
    asset: txt(f.asset),
    position: txt(f.position),
    serial: txt(f.serial),
    site: txt(f.site),
    brand: txt(f.brand),
    size: txt(f.size),
    detail: txt(f.detail),
    // May be '' - see flagsFromDueRows.
    flaggedOn: day(f.flaggedOn),
    fittedOn: day(f.fittedOn),
    origin: f.origin || '',
  }
}

/**
 * Flags from the running-life due set (shaped rows - see tyreRunningLife).
 *
 * `flaggedOn` is deliberately EMPTY. The feed says a tyre is due AS OF NOW; it
 * carries no record of the day it crossed the threshold, and inventing that
 * date would put a fabricated age on every row. The matcher therefore falls
 * back to the tyre's own fitment date, which is real - see resolveFlag.
 */
export function flagsFromDueRows(rows = []) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.asset) continue
    const band = bandFor(r)
    if (band !== 'overdue' && band !== 'due-soon') continue
    out.push(baseFlag({
      source: 'system',
      kind: band === 'overdue' ? 'Past expected life' : 'Due soon',
      country: r.country,
      asset: r.asset,
      position: r.position,
      serial: r.serial,
      site: r.site,
      brand: r.brand,
      size: r.size,
      flaggedOn: '',
      fittedOn: r.fittedOn,
      origin: 'Running life',
    }))
  }
  return out
}

/** Flags from inspections that recorded damage or a puncture on a position. */
export function flagsFromInspections(inspections = []) {
  const out = []
  for (const insp of Array.isArray(inspections) ? inspections : []) {
    if (!insp || !insp.asset_no) continue
    const when = day(insp.inspection_date || insp.completed_date || insp.scheduled_date || insp.created_at)
    for (const d of damagedPositions(insp)) {
      out.push(baseFlag({
        source: 'user',
        kind: txt(d.condition) || 'Damage',
        country: insp.country,
        asset: insp.asset_no,
        position: d.position,
        serial: '',
        site: insp.site,
        flaggedOn: when,
        detail: `Inspection recorded "${txt(d.condition) || 'damage'}"`,
        origin: 'Inspection',
      }))
    }
  }
  return out
}

/**
 * Parse a corrective action's source_detail key (see
 * inspectionTyreFlags.defectsForAction) back into position + serial + source.
 * Returns null for anything that is not one of those keys, so an unrelated
 * corrective action is never read as a tyre flag.
 */
export function parseActionKey(key) {
  const s = txt(key)
  if (!s) return null
  const idx = s.indexOf(':')
  if (idx < 0) return null
  const kind = s.slice(0, idx)
  const rest = s.slice(idx + 1)
  if (kind === 'damage') return { source: 'user', kind: 'Damage', position: rest, serial: '' }
  if (kind === 'overdue' || kind === 'duesoon') {
    const cut = rest.indexOf(':')
    const position = cut < 0 ? rest : rest.slice(0, cut)
    const serial = cut < 0 ? '' : rest.slice(cut + 1)
    return {
      source: 'system',
      kind: kind === 'overdue' ? 'Past expected life' : 'Due soon',
      position,
      serial,
    }
  }
  return null
}

/**
 * Flags from corrective actions raised off an inspection. These are the only
 * flags that carry a real RAISED-ON date for a system rule, because a person
 * pressed the button on a day we recorded.
 */
export function flagsFromActions(actions = []) {
  const out = []
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a) continue
    const parsed = parseActionKey(a.source_detail)
    if (!parsed) continue
    out.push(baseFlag({
      source: parsed.source,
      kind: parsed.kind,
      country: a.country,
      asset: a.asset_no,
      position: parsed.position === 'unknown position' ? '' : parsed.position,
      serial: parsed.serial || a.tyre_serial,
      site: a.site,
      flaggedOn: day(a.created_at),
      detail: txt(a.title),
      origin: 'Corrective action',
    }))
  }
  return out
}

/**
 * Fold flags that describe the SAME wheel into one row.
 *
 * Two rows for one wheel (a corrective action AND the live due list) would
 * double every count and send two fitters to the same tyre. The earliest real
 * flag date wins, and both origins are kept, so nothing about where the flag
 * came from is lost by merging.
 */
export function mergeFlags(lists = []) {
  const map = new Map()
  for (const list of lists) {
    for (const f of Array.isArray(list) ? list : []) {
      if (!f || !f.asset) continue
      const key = `${wheelKey(f.country, f.asset, f.position)}|${serialKey(f.serial)}`
      const prev = map.get(key)
      if (!prev) { map.set(key, { ...f, origins: [f.origin].filter(Boolean) }); continue }
      // A dated flag always beats an undated one: it is the only one that can
      // say how long this has been outstanding.
      if (f.flaggedOn && (!prev.flaggedOn || f.flaggedOn < prev.flaggedOn)) {
        prev.flaggedOn = f.flaggedOn
        prev.kind = f.kind
        prev.detail = f.detail || prev.detail
      }
      if (!prev.serial && f.serial) prev.serial = f.serial
      if (!prev.position && f.position) prev.position = f.position
      if (!prev.fittedOn && f.fittedOn) prev.fittedOn = f.fittedOn
      if (!prev.site && f.site) prev.site = f.site
      if (!prev.brand && f.brand) prev.brand = f.brand
      if (!prev.size && f.size) prev.size = f.size
      // "Raised by a person" outranks "raised by a rule" on the merged row: a
      // recorded puncture is not planning work.
      if (f.source === 'user') prev.source = 'user'
      if (f.origin && !prev.origins.includes(f.origin)) prev.origins.push(f.origin)
    }
  }
  return [...map.values()]
}

/* --------------------------------------------------------------- matching */

/**
 * Decide one flag's state against the uploaded fitment history.
 *
 * `since` is the flag date when there is one, otherwise the flagged tyre's own
 * fitment date. Falling back is what lets the live due list be tracked at all
 * (it carries no flag date), and it is still a REAL date: "a different tyre was
 * fitted at this position after this tyre went on" is a sound replacement
 * signal. `daysFlagged` stays null in that case - the duration is genuinely
 * unknown and is not guessed.
 */
export function resolveFlag(flag, index, { now = new Date() } = {}) {
  const today = day(now instanceof Date ? now.toISOString() : now)
  const unknown = (reason) => ({
    state: 'unknown', reason, replacement: null, daysFlagged: null, daysToReplace: null, removedOn: '',
  })
  if (!flag || !flag.asset) return unknown('No asset was recorded on this flag.')
  const pos = positionKey(flag.position)
  if (!pos) {
    return unknown('No tyre position was recorded, so the flag cannot be matched to a fitment record.')
  }
  const since = flag.flaggedOn || flag.fittedOn || ''
  if (!since) {
    return unknown('No flag date and no fitment date, so there is nothing to measure a replacement against.')
  }
  const daysFlagged = flag.flaggedOn ? daysBetween(flag.flaggedOn, today) : null
  // The exact country, PLUS fitment rows whose country was never recorded.
  // Those blanks are safe to consider because the read that produced them was
  // already country-scoped; a row TAGGED with another country is still refused,
  // so a UAE fitment can never be read as replacing a KSA tyre (V376).
  const exact = (index && index.get(wheelKey(flag.country, flag.asset, flag.position))) || []
  const untagged = txt(flag.country)
    ? (index && index.get(wheelKey('', flag.asset, flag.position))) || []
    : []
  const list = untagged.length
    ? [...exact, ...untagged].sort((a, b) => (a.fittedOn || '').localeCompare(b.fittedOn || ''))
    : exact
  if (!list.length) {
    return {
      ...unknown('No fitment record was uploaded for this asset and position, so the change cannot be confirmed.'),
      daysFlagged,
    }
  }
  const flagged = serialKey(flag.serial)

  // The flagged tyre's own record: by serial when the flag names one, else the
  // tyre that occupied the position on the flag date.
  let own = flagged ? list.find((r) => serialKey(r.serial) === flagged) : null
  if (!own) {
    const before = list.filter((r) => r.fittedOn && r.fittedOn <= since)
    own = before.length ? before[before.length - 1] : null
  }

  // A replacement is a DIFFERENT tyre fitted at this wheel after the flag.
  const later = list.filter((r) => {
    if (!r.fittedOn || r.fittedOn <= since) return false
    if (own && r === own) return false
    if (flagged && serialKey(r.serial) === flagged) return false
    return true
  })
  if (later.length) {
    const rep = later[0]
    return {
      state: 'replaced',
      reason: '',
      replacement: {
        serial: rep.serial || '', brand: rep.brand || '', size: rep.size || '', fittedOn: rep.fittedOn,
      },
      daysFlagged,
      daysToReplace: daysBetween(since, rep.fittedOn),
      removedOn: own ? own.removedOn : '',
    }
  }
  if (own && (own.removed || own.removedOn)) {
    return {
      state: 'removed_not_replaced',
      reason: '',
      replacement: null,
      daysFlagged,
      daysToReplace: null,
      removedOn: own.removedOn,
    }
  }
  if (own) {
    return { state: 'on_vehicle', reason: '', replacement: null, daysFlagged, daysToReplace: null, removedOn: '' }
  }
  return {
    ...unknown('No fitment record covers the flag date at this position, so it is not clear which tyre was flagged.'),
    daysFlagged,
  }
}

/**
 * The whole report: flags from every source, merged, resolved against the
 * uploaded fitments.
 * @returns {{rows:Array, summary:object}}
 */
export function trackTyreChanges({
  dueRows = [], inspections = [], actions = [], tyreRecords = [], now = new Date(),
} = {}) {
  const index = indexFitments(tyreRecords)
  const flags = mergeFlags([
    flagsFromActions(actions),
    flagsFromInspections(inspections),
    flagsFromDueRows(dueRows),
  ])
  const rows = flags.map((f) => {
    const res = resolveFlag(f, index, { now })
    return {
      ...f,
      origins: f.origins || [],
      state: res.state,
      reason: res.reason,
      replacement: res.replacement,
      daysFlagged: res.daysFlagged,
      daysToReplace: res.daysToReplace,
      removedOn: res.removedOn || '',
    }
  })
  rows.sort((a, b) => {
    const rank = { on_vehicle: 0, removed_not_replaced: 1, unknown: 2, replaced: 3 }
    const d = (rank[a.state] ?? 9) - (rank[b.state] ?? 9)
    if (d) return d
    const da = a.daysFlagged == null ? -1 : a.daysFlagged
    const db = b.daysFlagged == null ? -1 : b.daysFlagged
    if (db !== da) return db - da
    return (a.asset || '').localeCompare(b.asset || '')
  })
  return { rows, summary: trackingSummary(rows) }
}

/** Counts per state and per source. Every figure is a count of real rows. */
export function trackingSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = {
    total: list.length,
    onVehicle: 0,
    replaced: 0,
    removedNotReplaced: 0,
    unknown: 0,
    bySystem: 0,
    byUser: 0,
    assets: 0,
    avgDaysToReplace: null,
  }
  const assets = new Set()
  const spans = []
  for (const r of list) {
    if (r.state === 'on_vehicle') out.onVehicle += 1
    else if (r.state === 'replaced') out.replaced += 1
    else if (r.state === 'removed_not_replaced') out.removedNotReplaced += 1
    else out.unknown += 1
    if (r.source === 'user') out.byUser += 1
    else out.bySystem += 1
    if (r.asset) assets.add(`${txt(r.country).toUpperCase()}|${txt(r.asset).toUpperCase()}`)
    if (r.state === 'replaced' && r.daysToReplace != null) spans.push(r.daysToReplace)
  }
  out.assets = assets.size
  // Null, never 0: "nothing has been replaced yet" is not "replaced the same day".
  out.avgDaysToReplace = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null
  return out
}

/** Search + state + source filter over tracking rows. */
export function filterTracking(rows = [], { search = '', state = 'all', source = 'all' } = {}) {
  const q = txt(search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (state !== 'all' && r.state !== state) return false
    if (source !== 'all' && r.source !== source) return false
    if (!q) return true
    return [r.asset, r.serial, r.position, r.site, r.brand, r.kind, r.replacement?.serial]
      .some((v) => txt(v).toLowerCase().includes(q))
  })
}

/**
 * What a report actually covers, named first in every export. An export headed
 * "tyre change tracking" that in fact holds one asset's three flags is a false
 * statement that outlives the screen it came from.
 */
export function trackingScopeLabel({ country = '', asset = '', state = 'all', source = 'all', search = '' } = {}) {
  const parts = ['Flagged tyres tracked to replacement']
  parts.push(country && country !== 'All' ? country : 'all countries')
  if (asset) parts.push(`asset ${asset}`)
  if (state !== 'all') parts.push(`state: ${TRACK_STATE_META[state] ? TRACK_STATE_META[state].label : state}`)
  if (source !== 'all') parts.push(`source: ${SOURCE_META[source] ? SOURCE_META[source].label : source}`)
  const q = txt(search)
  if (q) parts.push(`search "${q}"`)
  return parts.join(', ')
}

/** DOM id of the tracking section, so other screens can link straight to it. */
export const TRACKING_ANCHOR = 'tyre-change-tracking'

/**
 * Link from a flag to the tracked tyres, optionally focused on one vehicle -
 * the same gesture as clicking an inspection to open that inspection.
 *
 * The country is NOT in the link: it is the app-wide active country, so
 * carrying a second copy in the URL could put the link and the page in
 * disagreement about which country is on screen.
 */
export function trackingLink({ asset = '' } = {}) {
  const a = txt(asset)
  return `/tyre-lifecycle${a ? `?trackAsset=${encodeURIComponent(a)}` : ''}#${TRACKING_ANCHOR}`
}

/**
 * Per-site tyre-change roll-up for the shareable inspection summary: one row
 * per site with the flag states, so the shared summary carries the tyre work as
 * well as the inspections. Rows with no site are grouped under "No site" rather
 * than dropped - a flag nobody can place is still outstanding work.
 */
export function trackingBySite(rows = []) {
  const bySite = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = txt(r.site) || 'No site'
    if (!bySite[key]) {
      bySite[key] = { site: key, flagged: 0, system: 0, user: 0, onVehicle: 0, replaced: 0, removed: 0, unknown: 0 }
    }
    const b = bySite[key]
    b.flagged += 1
    if (r.source === 'user') b.user += 1; else b.system += 1
    if (r.state === 'on_vehicle') b.onVehicle += 1
    else if (r.state === 'replaced') b.replaced += 1
    else if (r.state === 'removed_not_replaced') b.removed += 1
    else b.unknown += 1
  }
  const rowsOut = Object.values(bySite).sort((a, b) => b.flagged - a.flagged || a.site.localeCompare(b.site))
  const totals = rowsOut.reduce((t, r) => ({
    site: 'Total',
    flagged: t.flagged + r.flagged,
    system: t.system + r.system,
    user: t.user + r.user,
    onVehicle: t.onVehicle + r.onVehicle,
    replaced: t.replaced + r.replaced,
    removed: t.removed + r.removed,
    unknown: t.unknown + r.unknown,
  }), { site: 'Total', flagged: 0, system: 0, user: 0, onVehicle: 0, replaced: 0, removed: 0, unknown: 0 })
  return { rows: rowsOut, totals }
}
