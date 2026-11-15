/**
 * tyrePositionService - THE one place that answers "which wheel is this?".
 *
 * Two vocabularies name wheels in Tyre Pulse and both are right where they are
 * written: the inspection capture apps store the diagram SLOT id (R1Ro, F2L,
 * RR) and the ERP / tyre records store a GCC position CODE (LHCO, RHF2, RHR1).
 * The same slot id means a different wheel on a different machine (R1Ro is the
 * centre axle on a transit mixer and rear axle 1 on a trailer), so the two can
 * only be compared through the machine's ACTUAL wheel layout.
 *
 * This module resolves either vocabulary, on a given layout, to one canonical
 * wheel and says explicitly how sure it is:
 *
 *   { canonical, slot, status, reason }
 *     status  'resolved'      exactly one wheel on this machine
 *             'ambiguous'     more than one wheel fits (no axle number, no
 *                             inner/outer, a different numbering scheme, or the
 *                             layout changed after the record was made)
 *             'unknown'       no layout (unknown type, tyreless equipment) or
 *                             the token names nothing we can read
 *             'inconsistent'  the token contradicts the layout (a slot that does
 *                             not exist on this machine, an inner/outer code on a
 *                             single wheel, two readings that disagree)
 *
 * Anything other than 'resolved' is NOT a match and NOT a mismatch. Callers
 * must leave it pending manual review. Nothing here substitutes text or assumes
 * a code means the same on every vehicle type.
 *
 * It is built over the existing sources of truth and adds no second mapping:
 *   vehicleTyreLayout  which layout a machine has (type, asset prefix, axles)
 *   tyrePositions      the code grammar and the slot -> code table
 *   vehicleDiagram     admin designed layouts (vehicle_diagram_configs)
 *
 * SQL MIRROR: supabase/pending_migrations/20261115130000_tyre_position_service.sql
 * (tyre_layout_for / tyre_position_resolve). Both read ONE fixture,
 * src/test/fixtures/tyrePositionCases.json. CHANGE BOTH TOGETHER.
 *
 * Pure. No I/O. Safe in render and in Node.
 */
import { parsePosition, canonicalCode, legacyPositionCode } from './tyrePositions'
import {
  LAYOUT_SLOTS, resolveLayoutKeyStrict, isTyrelessEquipment, layoutForAsset,
} from './vehicleTyreLayout'
import { positionsFromConfig } from './vehicleDiagram'

/**
 * The version of the wheel-matching rules this client runs. The database reports its own
 * (observation_erp_rules / observation_erp_evaluate). A decision is offered only when the two
 * are the same: a client and a database on different rules can disagree about which wheel a
 * job card touched. CHANGE BOTH TOGETHER (pinned by observationErpEvidence.api.test.js).
 */
export const ERP_RULES_VERSION = 'position-service-3'

export const POSITION_STATUS = Object.freeze({
  RESOLVED: 'resolved', AMBIGUOUS: 'ambiguous', UNKNOWN: 'unknown', INCONSISTENT: 'inconsistent',
})

const up = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
const canonType = (vt) => String(vt ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
const dayOf = (v) => (v ? String(v).slice(0, 10) : '')

// A diagram slot id: F1L, R2Ri, FL, RRo, R1R. Group, optional axle number, side,
// optional inner/outer. This is the capture apps' own id grammar.
const SLOT_RE = /^(F|R)(\d?)(L|R)(O|I)?$/
const SPARE_RE = /^(SP|SPARE)(\d?)$/

/** Structure of one slot id, or null when the text is not slot shaped. */
function slotShape(slot) {
  const u = up(slot)
  const sp = u.match(SPARE_RE)
  if (sp) return { group: 'S', ordinal: sp[2] ? +sp[2] : 1, side: null, io: null }
  const m = u.match(SLOT_RE)
  if (!m) return null
  return { group: m[1], ordinal: m[2] ? +m[2] : 1, side: m[3], io: m[4] || null }
}

function buildWheels(pairs) {
  const wheels = []
  for (const { slot, label } of pairs) {
    const shape = slotShape(slot)
    if (!shape) continue
    const code = shape.group === 'S' ? up(slot) : up(canonicalCode(label) || label)
    wheels.push({ slot, code, ...shape })
  }
  return wheels
}

const unresolvedLayout = (reason, extra = {}) => ({
  status: POSITION_STATUS.UNKNOWN, reason, key: null, source: null, wheels: [], basis: 'current', ...extra,
})

/**
 * The wheel layout of ONE machine.
 *
 * @param {object} a
 * @param {string} [a.vehicleType]  the machine's recorded type
 * @param {string} [a.assetNo]      used when the type says nothing (class prefix) and for the axle build
 * @param {string} [a.country]      the same asset code abroad is a different machine
 * @param {number} [a.axleCount]    the machine's recorded axle count; else the registered one
 * @param {object} [a.customLayouts] map of canonical vehicle type -> admin layout
 *        (positionsFromConfig result or a raw config, optionally with updatedAt)
 * @param {Array}  [a.layoutHistory] the stored versions of admin layouts
 *        (vehicle_diagram_config_versions): [{ vehicleType, validFrom, validTo, basis, active, config }].
 *        With `asOf`, the version IN FORCE ON THAT DAY is used, so an old inspection is never
 *        re-read on a later edit. A version marked basis 'backfill' only says what was in force
 *        from its start: an earlier record is reported as changed since record, never resolved.
 *        A layout changed on the very day of the record is also reported, not guessed.
 * @param {Array}  [a.positionMappings] verified per-layout ERP spellings
 *        (tyre_layout_position_mappings): [{ layout_key, erp_code, slot }]. Empty by default.
 *        There is NO built-in guess for a spelling the layout cannot place.
 * @param {string} [a.asOf]         the date of the record being read (YYYY-MM-DD)
 */
export function resolveLayout(a = {}) {
  return withMappings(resolveLayoutBase(a), a.positionMappings)
}

function withMappings(layout, rows) {
  if (layout.status !== POSITION_STATUS.RESOLVED || !Array.isArray(rows) || !rows.length) return layout
  const mappings = rows
    .filter((r) => r && r.active !== false && String(r.layout_key ?? r.layoutKey ?? '') === layout.key)
    .map((r) => ({ code: up(r.erp_code ?? r.erpCode), slot: String(r.slot ?? '') }))
    .filter((m) => m.code && m.slot)
  return mappings.length ? { ...layout, mappings } : layout
}

function resolveLayoutBase(a) {
  const vt = String(a.vehicleType ?? '').trim()
  const asset = String(a.assetNo ?? '').trim()
  const asOf = dayOf(a.asOf)
  const customKey = canonType(vt)

  // 1. Stored layout versions decide a dated record.
  const versions = customKey && Array.isArray(a.layoutHistory)
    ? a.layoutHistory.filter((h) => h && canonType(h.vehicleType) === customKey && dayOf(h.validFrom))
      .sort((x, y) => String(x.validFrom).localeCompare(String(y.validFrom)))
    : []
  let custom = null
  let versionChecked = false
  if (versions.length && asOf) {
    versionChecked = true
    const inForce = versions.filter((h) => dayOf(h.validFrom) <= asOf && (!h.validTo || dayOf(h.validTo) > asOf)).pop()
    const editedThatDay = versions.some((h) => h.validTo && dayOf(h.validTo) === asOf)
    if (inForce) {
      if (inForce.active !== false) {
        const lay = customLayout(inForce, customKey)
        if (lay) {
          return { ...lay, basis: 'historical', version: dayOf(inForce.validFrom), ...(editedThatDay ? { changedAfterRecord: true } : {}) }
        }
      }
    } else if (versions[0].basis === 'backfill') {
      // Nothing is recorded about the layout before this version began.
      const lay = versions[0].active !== false ? customLayout(versions[0], customKey) : null
      if (lay) return { ...lay, basis: 'current', changedAfterRecord: true, version: dayOf(versions[0].validFrom) }
    }
    // Otherwise the admin layout did not exist yet on that day: the built-in layout applies.
  }

  // 2. A layout an admin designed for this exact type is an explicit statement
  //    about the machine and wins, as it does on the diagram.
  if (!versionChecked) custom = customKey && a.customLayouts ? a.customLayouts[customKey] : null
  if (custom) {
    const lay = customLayout(custom, customKey)
    if (lay) {
      const changed = dayOf(custom.updatedAt || custom.updated_at)
      // No stored versions were supplied: an edit after the record cannot be ruled out.
      if (asOf && changed && changed > asOf) {
        return { ...lay, basis: 'current', changedAfterRecord: true, version: changed }
      }
      return { ...lay, basis: 'current', version: changed || null }
    }
  }

  if (!vt && !asset) return unresolvedLayout('no_vehicle_type')
  if (isTyrelessEquipment(vt)) return unresolvedLayout('tyreless_equipment')
  const base = resolveLayoutKeyStrict(vt, asset)
  if (!base) return unresolvedLayout('unknown_vehicle_type')
  const n = Number(a.axleCount)
  const key = Number.isFinite(n) && a.axleCount != null && a.axleCount !== ''
    ? (AXLE_VARIANTS[base]?.[n] || base)
    : layoutForAsset(base, asset, a.country)
  const slots = LAYOUT_SLOTS[key]
  if (!slots) return unresolvedLayout('unknown_vehicle_type')
  return {
    status: POSITION_STATUS.RESOLVED, reason: 'builtin_layout', key, source: 'builtin', basis: 'current',
    version: null,
    wheels: buildWheels(slots.map((slot) => ({ slot, label: legacyPositionCode(key, slot) }))),
  }
}

// Mirrors vehicleTyreLayout's AXLE_VARIANTS for an explicitly supplied count.
const AXLE_VARIANTS = { 'Concrete pump': { 4: 'Concrete pump 4-axle' } }

function customLayout(raw, customKey) {
  if (!raw || typeof raw !== 'object') return null
  const tyres = Array.isArray(raw.tyres) ? raw.tyres : positionsFromConfig(raw.config || raw).tyres
  const wheels = buildWheels((tyres || []).map((t) => ({ slot: t.id, label: t.label })))
  if (!wheels.length) return null
  return {
    status: POSITION_STATUS.RESOLVED, reason: 'custom_layout', key: `custom:${customKey}`,
    source: 'custom', wheels,
  }
}

const out = (status, reason, wheel = null) => ({
  canonical: wheel ? wheel.code : null, slot: wheel ? wheel.slot : null, status, reason,
})

// The ERP's dual-rear spelling: LHRCO / RHRCI ("rear centre"), LHRRO / RHRRI ("rear rear").
// Which axle that is depends on the machine and has NOT been verified for any layout, so
// there is no built-in reading of it. It resolves only through a verified mapping recorded
// for that layout (tyre_layout_position_mappings); until then it is pending.
const DUAL_REAR_RE = /^(L|R)HR([CR])([IO])$/

// Concrete pumps: the ERP names the rear wheels of ONE machine three ways at once (numbered
// "R1", "rear centre" and "rear rear"), so its "R1" is not known to be the first rear axle of
// the drawing. Until a mapping is verified for the pump layout, NO rear ERP code is read on it,
// not even one that is spelled exactly like a wheel of the layout. Front codes are unaffected.
const PUMP_LAYOUT_KEYS = new Set(['Concrete pump', 'Concrete pump 4-axle'])
const REAR_CODE_RE = /^(L|R)H?[RC]/

/** How a position CODE reads on this layout. */
function readCode(layout, token, kind) {
  const mapped = (layout.mappings || []).find((m) => m.code === up(token))
  if (mapped) {
    const wheel = layout.wheels.find((w) => w.slot === mapped.slot)
    if (wheel) return out(POSITION_STATUS.RESOLVED, 'verified_mapping', wheel)
  }
  if (DUAL_REAR_RE.test(up(token))) return out(POSITION_STATUS.AMBIGUOUS, 'erp_spelling_not_verified')
  if (kind === 'erp' && PUMP_LAYOUT_KEYS.has(layout.key) && REAR_CODE_RE.test(up(token))) {
    return out(POSITION_STATUS.AMBIGUOUS, 'erp_spelling_not_verified')
  }
  const parsed = parsePosition(token)
  if (!parsed) return null
  if (parsed.side === null) return out(POSITION_STATUS.UNKNOWN, 'axle_group_not_on_layout')
  const wheels = layout.wheels
  const target = up(canonicalCode(token))
  const exact = wheels.filter((w) => w.code === target)
  if (exact.length === 1) return out(POSITION_STATUS.RESOLVED, 'code', exact[0])

  const group = parsed.axle === 'F' ? 'F' : 'R'
  const inGroup = wheels.filter((w) => w.group === group)
  const axles = new Set(inGroup.map((w) => w.ordinal)).size
  // A centre-axle code that this layout does not itself use: the machine may
  // number its rear axles instead, and guessing which one is "centre" is the
  // mistake this service exists to stop.
  if (parsed.axle === 'C') {
    return axles >= 2
      ? out(POSITION_STATUS.AMBIGUOUS, 'numbering_scheme_differs')
      : out(POSITION_STATUS.UNKNOWN, 'position_not_on_layout')
  }
  const onAxle = inGroup.filter((w) => w.side === parsed.side
    && (parsed.axleNo == null || w.ordinal === parsed.axleNo))
  if (!onAxle.length) return out(POSITION_STATUS.UNKNOWN, 'position_not_on_layout')
  const fits = onAxle.filter((w) => (parsed.io ? w.io === parsed.io : true))
  if (!fits.length) return out(POSITION_STATUS.INCONSISTENT, 'dual_code_on_single_wheel')
  if (fits.length > 1) {
    return out(POSITION_STATUS.AMBIGUOUS,
      parsed.axleNo == null && axles > 1 ? 'axle_not_specified' : 'inner_outer_not_specified')
  }
  const wheel = fits[0]
  // One wheel fits by structure. Trust it only when the token and the layout
  // count axles the same way: a numbered code on a layout that names its rear
  // axles centre/rear (or the reverse) is a different scheme, not a match.
  const layoutNumbered = (parsePosition(wheel.code)?.axleNo ?? null) != null
  if (axles > 1 && layoutNumbered !== (parsed.axleNo != null)) {
    return out(POSITION_STATUS.AMBIGUOUS, 'numbering_scheme_differs')
  }
  return out(POSITION_STATUS.RESOLVED, 'structure', wheel)
}

/** How a SLOT id reads on this layout. Null when the text is not a slot of it. */
function readSlot(layout, token) {
  const u = up(token)
  const hit = layout.wheels.find((w) => up(w.slot) === u)
  if (hit) return out(POSITION_STATUS.RESOLVED, 'slot', hit)
  if (SPARE_RE.test(u)) {
    const spares = layout.wheels.filter((w) => w.group === 'S')
    if (!spares.length) return out(POSITION_STATUS.UNKNOWN, 'spare_not_on_layout')
    const m = u.match(SPARE_RE)
    if (m[2]) return out(POSITION_STATUS.UNKNOWN, 'spare_not_on_layout')
    if (spares.length === 1) return out(POSITION_STATUS.RESOLVED, 'slot', spares[0])
    return out(POSITION_STATUS.AMBIGUOUS, 'spare_not_specified')
  }
  return null
}

/**
 * Resolve one stored position on one layout.
 *
 * @param {object} layout  a resolveLayout() result
 * @param {string} token   the position exactly as stored
 * @param {{kind?: 'slot'|'erp'|'any'}} [opts]
 *        'slot' the value came from an inspection (a slot id is expected),
 *        'erp'  it came from the ERP / tyre records (a code is expected),
 *        'any'  unknown origin: both readings are tried and must agree.
 */
export function resolveWheel(layout, token, { kind = 'any' } = {}) {
  if (!layout || layout.status !== POSITION_STATUS.RESOLVED) {
    return out(POSITION_STATUS.UNKNOWN, layout?.reason || 'no_layout')
  }
  const text = String(token ?? '').trim()
  if (!text || up(text) === 'UNKNOWNPOSITION') return out(POSITION_STATUS.UNKNOWN, 'missing_position')
  if (layout.changedAfterRecord) return out(POSITION_STATUS.AMBIGUOUS, 'layout_changed_since_record')

  const asSlot = readSlot(layout, text)
  const asCode = readCode(layout, text, kind)
  const slotOk = asSlot?.status === POSITION_STATUS.RESOLVED
  const codeOk = asCode?.status === POSITION_STATUS.RESOLVED

  if (slotOk && codeOk && asSlot.slot !== asCode.slot) {
    // The text is both a slot of this machine and a code of it, for two
    // different wheels. The declared origin decides; with none, nobody can.
    if (kind === 'slot') return asSlot
    if (kind === 'erp') return asCode
    return out(POSITION_STATUS.INCONSISTENT, 'slot_and_code_disagree')
  }
  if (kind === 'erp') {
    if (codeOk) return asCode
    if (slotOk) return { ...asSlot, reason: 'slot_id_in_code_field' }
    return asCode || asSlot || out(POSITION_STATUS.UNKNOWN, 'unreadable_position')
  }
  if (slotOk) return asSlot
  if (codeOk) return { ...asCode, reason: kind === 'slot' ? 'code_in_slot_field' : asCode.reason }
  // Slot shaped, but not a slot of THIS machine: the record was captured on a
  // different wheel layout than the asset has.
  if (!asSlot && slotShape(text) && !asCode) {
    return out(POSITION_STATUS.INCONSISTENT, 'slot_not_on_layout')
  }
  if (kind === 'slot' && !asSlot && slotShape(text)) {
    return out(POSITION_STATUS.INCONSISTENT, 'slot_not_on_layout')
  }
  return asSlot || asCode || out(POSITION_STATUS.UNKNOWN, 'unreadable_position')
}

/** resolveLayout + resolveWheel in one call. `asset` is resolveLayout's input. */
export function resolvePosition(asset, token, opts) {
  const layout = asset && Array.isArray(asset.wheels) ? asset : resolveLayout(asset)
  return { ...resolveWheel(layout, token, opts), layoutKey: layout.key || null, layoutBasis: layout.basis || 'current' }
}

/**
 * Do an inspection slot and an ERP code name the same wheel on this machine?
 *
 *   match  true   both resolved to the same wheel
 *          false  both resolved to different wheels
 *          null   at least one side could not be resolved: PENDING MANUAL REVIEW
 *
 * `recordedVehicleType` is the type written on the inspection. When it resolves
 * to a different layout than the asset's own, the slot was captured against
 * another wheel plan and nothing is concluded.
 */
export function comparePositions(asset, slotToken, erpToken, { recordedVehicleType = '' } = {}) {
  const layout = asset && Array.isArray(asset.wheels) ? asset : resolveLayout(asset)
  const a = resolveWheel(layout, slotToken, { kind: 'slot' })
  const b = resolveWheel(layout, erpToken, { kind: 'erp' })
  const base = { observation: a, erp: b, layoutKey: layout.key || null }
  if (layout.status === POSITION_STATUS.RESOLVED && recordedVehicleType && !Array.isArray(asset?.wheels)) {
    const rec = resolveLayout({ ...asset, vehicleType: recordedVehicleType })
    if (rec.status === POSITION_STATUS.RESOLVED && rec.key !== layout.key) {
      return { ...base, match: null, status: POSITION_STATUS.INCONSISTENT, reason: 'inspection_layout_differs_from_asset', canonical: null }
    }
  }
  if (a.status !== POSITION_STATUS.RESOLVED) return { ...base, match: null, status: a.status, reason: a.reason, canonical: null }
  if (b.status !== POSITION_STATUS.RESOLVED) return { ...base, match: null, status: b.status, reason: b.reason, canonical: null }
  const same = a.slot === b.slot
  return { ...base, match: same, status: POSITION_STATUS.RESOLVED, reason: same ? 'same_wheel' : 'different_wheel', canonical: same ? a.canonical : null }
}

/** The position inside a corrective action's source_detail (damage:R1Ro, overdue:R2Li:SERIAL, RR). */
export function positionFromSourceDetail(detail) {
  const s = String(detail ?? '').trim()
  if (!s) return ''
  const first = s.indexOf(':')
  if (first < 0) return s
  const rest = s.slice(first + 1)
  const cut = rest.indexOf(':')
  const pos = (cut < 0 ? rest : rest.slice(0, cut)).trim()
  return pos === 'unknown position' ? '' : pos
}

/** The canonical code one slot of a built-in layout displays (LHF1, LHCO, RHR1-O ...). */
export function slotCode(layoutKey, slot) {
  return canonicalCode(legacyPositionCode(layoutKey, slot)) || slot
}

/**
 * Display helpers for the existing consumers (tyre bay, diagram, PDF labels).
 * They keep the long-standing display contract: built-in layouts only, and a
 * position we cannot place keeps its stored text.
 */
export function slotForPosition(layoutKey, positionCode) {
  const slots = LAYOUT_SLOTS[layoutKey]
  if (!slots || !positionCode) return null
  // Display has never renamed the ERP dual-rear spelling (LHRCO): it stays as stored.
  if (DUAL_REAR_RE.test(up(positionCode))) return null
  const layout = {
    status: POSITION_STATUS.RESOLVED, key: layoutKey, source: 'builtin',
    wheels: buildWheels(slots.map((slot) => ({ slot, label: legacyPositionCode(layoutKey, slot) }))),
  }
  const r = resolveWheel(layout, positionCode, { kind: 'any' })
  // Display keeps its older, narrower rule: an exact slot or an exact code.
  return r.status === POSITION_STATUS.RESOLVED && (r.reason === 'slot' || r.reason === 'code') ? r.slot : null
}

export default resolvePosition
