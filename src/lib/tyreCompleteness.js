/**
 * tyreCompleteness - "are all this machine's wheels actually filled in?"
 *
 * WHY THIS EXISTS
 * Nothing checked it. Measured live across 4,778 recorded tyre entries on 400
 * inspections: TR-MIXER inspections carry 10 to 13 positions where the layout
 * says 12, and 39 of them were submitted with wheels simply missing. Nobody was
 * stopped and nobody was told which wheel was outstanding.
 *
 * WHAT "FILLED" CAN AND CANNOT MEAN HERE - this is the whole design, read it
 * before changing a rule:
 *
 *  - condition is present on 100% of entries, so it looks like the obvious
 *    test. It is useless as one. BOTH capture forms pre-seed every position
 *    with condition 'Good' before the inspector touches anything (mobile
 *    emptyTyrePosition in mobile/lib/types.ts, and the web checklist seeding in
 *    src/pages/Inspections.jsx). A seeded 'Good' and a deliberate 'Good' are
 *    byte identical. So "has a condition" would pass every untouched wheel.
 *  - pressure_psi is captured 83.7% of the time. Real, but not universal, so it
 *    must not be the only thing that counts as filled and it must not block by
 *    default (opts.requirePressure exists for an owner who decides otherwise).
 *  - tread_depth_mm is recorded on ZERO of 4,778 entries and serial_number on
 *    7. Requiring either would make every inspection in this fleet
 *    unsubmittable. They are never required and never reported as a gap.
 *
 *
 * MEASURED BEFORE CHOOSING THE DEFAULT, and it changed the answer. Running the
 * `blank` rule over the live data: 711 of 4,782 tyre entries (14.9%) carry no
 * evidence at all, and they are spread across 97 of 401 inspections - so
 * blocking on `blank` would refuse ONE INSPECTION IN FOUR that submits today,
 * all of them in the last 90 days. That is not a bug being caught, it is a
 * change to what the fleet is required to record, and it is the owner's call.
 * So `blank` REPORTS by default and blocks only when asked
 * (opts.requireEvidence). `missing` blocks out of the box, because a wheel with
 * no entry at all is unambiguous and is exactly the 39 transit-mixer
 * inspections that were submitted with wheels simply absent.
 *
 * The honest limit of the `blank` rule, which is why it is not on: an inspector
 * who checks a wheel, finds it fine and has no pressure gauge has no way to say
 * so. Pressure is the practical escape hatch. A persisted "checked" flag is the
 * real fix and needs a schema change.
 * So a wheel counts as filled when the inspector left EVIDENCE on it: a
 * pressure, a tread depth, a serial, a note, a photo, or a condition they had
 * to choose deliberately (anything other than the seeded 'Good'). That is the
 * same signal the mobile inspection screen already uses for its own progress
 * counter, deliberately reused rather than invented a second time.
 *
 * HONESTY RULES BAKED IN
 *  - Tyreless equipment reports "not applicable", never "0 of 0 done".
 *  - A vehicle type whose layout we do not recognise reports known:false and
 *    blocks NOTHING. resolveLayoutKey falls back to a 4 wheel Pickup for an
 *    unrecognised machine, and blocking a real inspection against a guessed
 *    wheel count would be worse than the bug this module fixes.
 *  - A recorded position the layout has no slot for (a spare, a foreign
 *    vocabulary) is reported as `extra` and can never block. The layouts carry
 *    no spare slot, so a spare is never "missing" either: nobody is sent to
 *    inspect a spare that may not be fitted.
 *  - If readings exist but NONE of them line up with this machine's wheels, we
 *    say so (matched:false) and block nothing, rather than declaring every
 *    wheel missing on the strength of a vocabulary we failed to read.
 *
 * MIRROR: mobile/lib/tyreCompleteness.ts. Change both together. The behavioural
 * constants below are marked "#mirror:" and src/test/tyreCompleteness.test.js
 * compares them across the two files, so a one sided edit fails the suite.
 *
 * Pure. No I/O, no clock, safe in render.
 */

import { layoutSlotsFor, resolveLayoutKey, isTyrelessEquipment } from './vehicleTyreLayout'
import { legacyPositionCode } from './tyrePositions'

// #mirror: STATES
export const TYRE_SLOT_STATES = ['missing', 'blank', 'incomplete', 'complete']
// #mirror: PENDING_STATES
export const PENDING_STATES = ['missing', 'blank', 'incomplete']
// #mirror: BLOCKING_DEFAULTS
export const BLOCKING_DEFAULTS = { missing: true, blank: false, incomplete: false }
// #mirror: EVIDENCE_FIELDS
export const EVIDENCE_FIELDS = {
  pressure: ['pressure_psi', 'pressure', 'psi'],
  tread: ['tread_depth_mm', 'tread_depth', 'treadDepth', 'tread'],
  serial: ['serial_number', 'serial_no', 'serial'],
  notes: ['notes', 'note'],
  photo: ['photo_url', 'photo_uri', 'photo'],
}
// #mirror: SEEDED_CONDITION
export const SEEDED_CONDITION = 'good'
// #mirror: REASONS
export const PENDING_REASONS = {
  missing: 'Not recorded at all',
  blank: 'No details recorded',
  incomplete: 'Pressure not recorded',
}

/** Position key comparison form: case and punctuation insensitive. */
function keyOf(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Text present means a non empty trimmed string. 0 is a real reading, '' is not. */
function hasText(v) {
  if (v == null) return false
  if (typeof v === 'number') return Number.isFinite(v)
  return String(v).trim() !== ''
}

function pick(entry, names) {
  for (const n of names) {
    if (entry && Object.prototype.hasOwnProperty.call(entry, n) && hasText(entry[n])) return entry[n]
  }
  return null
}

/**
 * Read tyre_conditions in every shape the app has ever written: an object keyed
 * by position, an array of { position, ... }, a JSON string of either, and
 * values that are bare condition strings rather than objects. Returns a plain
 * list of { key, entry } and never throws.
 */
export function readTyreEntries(source) {
  let tc = source && typeof source === 'object' && !Array.isArray(source) && 'tyre_conditions' in source
    ? source.tyre_conditions
    : source
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return [] }
  }
  if (!tc || typeof tc !== 'object') return []

  const pairs = Array.isArray(tc)
    ? tc.map((d, i) => [d && typeof d === 'object' && hasText(d.position) ? String(d.position) : String(i), d])
    : Object.entries(tc)

  const out = []
  for (const [key, value] of pairs) {
    const entry = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { condition: value == null ? null : String(value) }
    out.push({ key: String(key), entry })
  }
  return out
}

/**
 * Classify ONE recorded entry.
 *
 * The rule ORDER is the contract and the test pins it:
 *   1. any evidence field filled            -> recorded
 *   2. a condition the inspector had to choose (not the seeded 'Good') -> recorded
 *   3. otherwise                            -> blank, indistinguishable from the seed
 * A recorded entry is 'incomplete' only when the soft reading (pressure) is
 * absent. Tread and serial are never tested: 0 of 4,778 and 7 of 4,778.
 */
export function classifyEntry(entry) {
  const pressure = pick(entry, EVIDENCE_FIELDS.pressure)
  const tread = pick(entry, EVIDENCE_FIELDS.tread)
  const serial = pick(entry, EVIDENCE_FIELDS.serial)
  const notes = pick(entry, EVIDENCE_FIELDS.notes)
  const photo = pick(entry, EVIDENCE_FIELDS.photo)
  const conditionRaw = entry && hasText(entry.condition) ? String(entry.condition).trim() : ''
  const deliberateCondition = conditionRaw !== '' && keyOf(conditionRaw) !== keyOf(SEEDED_CONDITION)

  // Compare against null, never truthiness: a pressure of 0 is a real reading
  // on a flat tyre and `if (!pressure)` would silently discard it.
  const evidence = pressure !== null || tread !== null || serial !== null ||
    notes !== null || photo !== null || deliberateCondition
  if (!evidence) return { state: 'blank', pressure: null, condition: conditionRaw || null }
  if (pressure === null) return { state: 'incomplete', pressure: null, condition: conditionRaw || null }
  return { state: 'complete', pressure, condition: conditionRaw || null }
}

/**
 * Do we actually know this machine's wheel arrangement?
 *
 * resolveLayoutKey NEVER returns null - an unrecognised type silently becomes a
 * 4 wheel Pickup. That fallback is right for drawing something, and completely
 * wrong for telling somebody a wheel is missing, so it is detected here.
 */
export function layoutIsKnown(vehicleType, assetNo) {
  const vt = String(vehicleType == null ? '' : vehicleType).trim()
  const an = String(assetNo == null ? '' : assetNo).trim()
  if (!vt && !an) return false
  if (resolveLayoutKey(vt, an) !== 'Pickup') return true
  // Pickup is also a real answer, but only when something actually said so.
  return /pickup|pick[\s-]?up/i.test(vt) || /^PL\s*\d/i.test(vt) || /^PL\s*\d/i.test(an)
}

/**
 * @param {string} vehicleType
 * @param {string} [assetNo]        used only when the type identifies nothing
 * @param {*} tyreConditions        the row, or its tyre_conditions, any shape
 * @param {{requireEvidence?:boolean, requirePressure?:boolean}} [opts]
 * @returns {object} see the fields assembled below
 */
export function tyreCompleteness(vehicleType, assetNo, tyreConditions, opts = {}) {
  const requireEvidence = opts.requireEvidence === true
  const requirePressure = opts.requirePressure === true
  const blocking = {
    missing: BLOCKING_DEFAULTS.missing,
    blank: requireEvidence,
    incomplete: requirePressure,
  }

  const entries = readTyreEntries(tyreConditions)

  // Tyreless equipment: nothing is outstanding because there is nothing to fill.
  if (isTyrelessEquipment(vehicleType)) {
    return result({
      applicable: false, known: true, matched: true, layoutKey: null,
      expected: 0, slots: [], extra: entries.map((e) => e.key), blocking,
      summary: 'No tyres to inspect on this equipment.',
    })
  }

  const known = layoutIsKnown(vehicleType, assetNo)
  const layoutKey = resolveLayoutKey(vehicleType, assetNo)
  const slotIds = known ? layoutSlotsFor(vehicleType, assetNo) : []

  if (!known) {
    return result({
      applicable: true, known: false, matched: false, layoutKey: null,
      expected: null, slots: [], extra: entries.map((e) => e.key), blocking,
      summary: 'Wheel layout not known for this machine, so tyre details were not checked.',
    })
  }

  // slot -> every name a recorded key might use for it: the slot id itself and
  // the canonical GCC code the diagram labels it with (LHF1, LHCO, RHR1-O).
  const aliasToSlot = {}
  const codeOf = {}
  for (const slot of slotIds) {
    const code = legacyPositionCode(layoutKey, slot)
    codeOf[slot] = code
    aliasToSlot[keyOf(slot)] = slot
    if (code) aliasToSlot[keyOf(code)] = slot
  }

  const bySlot = {}
  const extra = []
  for (const { key, entry } of entries) {
    const slot = aliasToSlot[keyOf(key)]
    if (!slot) { extra.push(key); continue }
    // First reading for a slot wins; a duplicate key cannot un-record it.
    if (!bySlot[slot]) bySlot[slot] = entry
  }

  // Readings exist but not one of them names a wheel this machine has. We have
  // failed to read the vocabulary, not proved the wheels are empty.
  const matched = entries.length === 0 || Object.keys(bySlot).length > 0
  if (!matched) {
    return result({
      applicable: true, known: true, matched: false, layoutKey,
      expected: slotIds.length, slots: [], extra, blocking,
      summary: 'Recorded tyre readings could not be matched to this machine, so they were not checked.',
    })
  }

  const slots = slotIds.map((slot) => {
    const entry = bySlot[slot]
    const c = entry ? classifyEntry(entry) : { state: 'missing', pressure: null, condition: null }
    return {
      slot,
      code: codeOf[slot] || slot,
      state: c.state,
      reason: c.state === 'complete' ? null : PENDING_REASONS[c.state],
      blocking: c.state !== 'complete' && !!blocking[c.state],
    }
  })

  return result({
    applicable: true, known: true, matched: true, layoutKey,
    expected: slotIds.length, slots, extra, blocking, summary: null,
  })
}

/** Assemble the public shape once, so every early return has the same fields. */
function result({ applicable, known, matched, layoutKey, expected, slots, extra, blocking, summary }) {
  const byState = {}
  for (const s of TYRE_SLOT_STATES) byState[s] = slots.filter((x) => x.state === s)
  const pending = slots.filter((x) => x.state !== 'complete')
  const blocked = pending.filter((x) => x.blocking)
  const recorded = slots.length - byState.missing.length

  let text = summary
  if (!text) {
    if (pending.length === 0) {
      text = expected === 1
        ? 'The 1 tyre has details recorded.'
        : `All ${expected} tyres have details recorded.`
    } else {
      text = `${pending.length} of ${expected} tyres still need details.`
    }
  }

  return {
    applicable,
    known,
    matched,
    layoutKey,
    expected,
    recorded,
    complete: byState.complete.length,
    slots,
    pending,
    missing: byState.missing,
    blank: byState.blank,
    incomplete: byState.incomplete,
    blocked,
    extra,
    blocking,
    ok: blocked.length === 0,
    summary: text,
  }
}

/** Position codes still needing attention, in wheel order, for a message. */
export function pendingCodes(res) {
  return (res && res.pending ? res.pending : []).map((p) => p.code)
}

/**
 * Per slot state for the diagram, keyed by BOTH the slot id and its canonical
 * code so a caller can look up with whichever vocabulary it holds.
 */
export function slotStateMap(res) {
  const out = {}
  for (const s of (res && res.slots ? res.slots : [])) {
    out[s.slot] = s.state
    if (s.code) out[s.code] = s.state
  }
  return out
}

/** True when this position still needs details. Accepts a slot id or a code. */
export function isPendingPosition(res, position) {
  const state = slotStateMap(res)[position]
  return state !== undefined && state !== 'complete'
}

export default tyreCompleteness
