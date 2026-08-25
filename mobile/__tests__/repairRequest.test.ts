/**
 * Pure-logic tests for lib/repairRequest.ts (driver-raised RFR).
 *
 * Deterministic: `now` and the client uuid are always injected, so the payload
 * assertion is exact rather than "shaped roughly right".
 *
 * The three rules worth guarding, all of which have a real cost if they break:
 *   1. A blank meter box must NOT become a reading of 0 (`Number('')` is 0 and
 *      0 IS finite - the trap this repo has hit before).
 *   2. A meter BELOW the last reading is a WARNING, never an error. Blocking it
 *      would refuse a fault report from a machine whose cluster was replaced.
 *   3. The payload must never carry an `rfr_no`. The number is minted
 *      server-side; a client-invented one would reference nothing in the ERP.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  RFR_FAULT_CATEGORIES,
  RFR_FAULT_TOKENS,
  RFR_PRIORITIES,
  RFR_PRIORITY_KIND,
  RFR_DEFAULT_PRIORITY,
  RFR_STATUS_SUBMITTED,
  RFR_MIN_DESCRIPTION,
  parseMeterInput,
  validateRepairRequest,
  buildRepairRequestPayload,
  assetDescriptionFrom,
  RepairRequestDraft,
  RepairRequestReporter,
} from '../lib/repairRequest'

const NOW = '2026-08-24T09:15:00.000Z'
const CUID = 'rfr_test_0001'

const reporter: RepairRequestReporter = {
  id: 'user-1',
  fullName: 'Ahmed Driver',
  username: 'ahmed',
  country: 'KSA',
  site: 'NHC',
}

/** A minimal draft that PASSES, so each test can break exactly one thing. */
function draft(over: Partial<RepairRequestDraft> = {}): RepairRequestDraft {
  return {
    assetNo: 'TM514',
    description: 'Gearbox whining under load',
    ...over,
  }
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

describe('vocabulary', () => {
  it('matches the web / DB priority ladder exactly', () => {
    // A fifth value, a rename or a case change here silently fails the DB CHECK
    // on insert - offline, hours after the driver walked away.
    expect(RFR_PRIORITIES).toEqual(['Low', 'Medium', 'High', 'Critical'])
    expect(RFR_DEFAULT_PRIORITY).toBe('Medium')
  })

  it('spends colour only on the priority ladder, and spends it in order', () => {
    // Low is deliberately NEUTRAL: a colour on every rung would make the red one
    // mean nothing (the Home-screen confetti defect).
    expect(RFR_PRIORITY_KIND.Low).toBe('neutral')
    expect(RFR_PRIORITY_KIND.Medium).toBe('info')
    expect(RFR_PRIORITY_KIND.High).toBe('warning')
    expect(RFR_PRIORITY_KIND.Critical).toBe('danger')
    expect(Object.keys(RFR_PRIORITY_KIND).sort()).toEqual([...RFR_PRIORITIES].sort())
  })

  it('has one entry per fault token and no duplicates', () => {
    expect(RFR_FAULT_TOKENS.length).toBe(RFR_FAULT_CATEGORIES.length)
    expect(new Set(RFR_FAULT_TOKENS).size).toBe(RFR_FAULT_TOKENS.length)
    expect(RFR_FAULT_TOKENS).toContain('Engine')
    expect(RFR_FAULT_TOKENS).toContain('Other')
  })

  it('gives every fault category a non-empty icon name', () => {
    // The glyph names themselves are verified against the installed Ionicons
    // map by markIconsAreRealGlyphs.test.ts style checks; here we only pin that
    // none is blank, which would render nothing at all.
    for (const c of RFR_FAULT_CATEGORIES) {
      expect(typeof c.icon).toBe('string')
      expect(c.icon.length).toBeGreaterThan(3)
    }
  })
})

// ── Meter parsing ────────────────────────────────────────────────────────────

describe('parseMeterInput', () => {
  it('keeps blank, invalid and a real value strictly apart', () => {
    // THE TRAP: Number('') === 0 and Number.isFinite(0) === true. Folding blank
    // into a value writes "0 km" onto an asset nobody measured.
    expect(parseMeterInput('')).toEqual({ state: 'blank' })
    expect(parseMeterInput('   ')).toEqual({ state: 'blank' })
    expect(parseMeterInput(null)).toEqual({ state: 'blank' })
    expect(parseMeterInput(undefined)).toEqual({ state: 'blank' })
    expect(parseMeterInput('abc')).toEqual({ state: 'invalid' })
    expect(parseMeterInput('12km')).toEqual({ state: 'invalid' })
    expect(parseMeterInput('0')).toEqual({ state: 'value', value: 0 })
  })

  it('accepts thousands separators, decimals and surrounding space', () => {
    expect(parseMeterInput(' 128,450 ')).toEqual({ state: 'value', value: 128450 })
    expect(parseMeterInput('4210.5')).toEqual({ state: 'value', value: 4210.5 })
  })

  it('reads a negative as a real (negative) value, not as invalid', () => {
    // Validation decides that -1 is wrong; the parser only reports what was typed.
    expect(parseMeterInput('-1')).toEqual({ state: 'value', value: -1 })
  })
})

// ── Validation ───────────────────────────────────────────────────────────────

describe('validateRepairRequest', () => {
  it('passes a minimal complete draft', () => {
    const v = validateRepairRequest(draft())
    expect(v).toEqual({ ok: true, errors: [], warnings: [] })
  })

  it('requires an asset', () => {
    const v = validateRepairRequest(draft({ assetNo: '   ' }))
    expect(v.ok).toBe(false)
    expect(v.errors).toContain('asset_required')
  })

  it('requires a description of the fault', () => {
    expect(validateRepairRequest(draft({ description: '' })).errors)
      .toContain('description_required')
    expect(validateRepairRequest(draft({ description: 'ok' })).errors)
      .toContain('description_required')
    expect(RFR_MIN_DESCRIPTION).toBe(3)
    expect(validateRepairRequest(draft({ description: 'hot' })).ok).toBe(true)
  })

  it('does NOT require a fault category or a priority', () => {
    // A driver beside a stopped machine must never be blocked by a field the
    // workshop can classify itself.
    const v = validateRepairRequest(draft({ faultCategory: '', priority: undefined }))
    expect(v.ok).toBe(true)
  })

  it('rejects a negative or unreadable meter reading', () => {
    expect(validateRepairRequest(draft({ odometer: '-5' })).errors)
      .toContain('odometer_negative')
    expect(validateRepairRequest(draft({ odometer: 'lots' })).errors)
      .toContain('odometer_invalid')
    expect(validateRepairRequest(draft({ engineHours: '-2' })).errors)
      .toContain('engine_hours_negative')
    expect(validateRepairRequest(draft({ engineHours: 'many' })).errors)
      .toContain('engine_hours_invalid')
  })

  it('treats a blank meter as absent, not as zero', () => {
    const v = validateRepairRequest(draft({ odometer: '', engineHours: '' }))
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual([])
  })

  // -- the rule that matters most ---------------------------------------------
  it('WARNS on a reading below the last one and still allows submit', () => {
    const v = validateRepairRequest(draft({ odometer: '90000' }), { odometer: 128450 })
    expect(v.ok).toBe(true)                      // never blocked
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual(['odometer_below_last'])
  })

  it('warns on engine hours below the last reading, same rule', () => {
    const v = validateRepairRequest(draft({ engineHours: '10' }), { engineHours: 4210 })
    expect(v.ok).toBe(true)
    expect(v.warnings).toEqual(['engine_hours_below_last'])
  })

  it('does not warn when equal to, or above, the last reading', () => {
    expect(validateRepairRequest(draft({ odometer: '128450' }), { odometer: 128450 }).warnings)
      .toEqual([])
    expect(validateRepairRequest(draft({ odometer: '128451' }), { odometer: 128450 }).warnings)
      .toEqual([])
  })

  it('invents no warning when the register carries no last reading', () => {
    // vehicle_fleet.current_km is populated on only a fraction of the fleet, and
    // there is NO engine-hours column at all, so absence must stay silent.
    expect(validateRepairRequest(draft({ odometer: '5' }), {}).warnings).toEqual([])
    expect(validateRepairRequest(draft({ odometer: '5' }), { odometer: null }).warnings).toEqual([])
    expect(validateRepairRequest(draft({ engineHours: '5' }), {}).warnings).toEqual([])
  })

  it('does not warn about a reading it has already rejected', () => {
    const v = validateRepairRequest(draft({ odometer: '-5' }), { odometer: 100 })
    expect(v.errors).toContain('odometer_negative')
    expect(v.warnings).toEqual([])
  })
})

// ── Asset description ────────────────────────────────────────────────────────

describe('assetDescriptionFrom', () => {
  it('composes type / make / model with an ASCII separator', () => {
    expect(assetDescriptionFrom({ vehicle_type: 'TR-MIXER', make: 'Sany', model: 'SY308' }))
      .toBe('TR-MIXER / Sany / SY308')
  })

  it('skips what the register does not carry', () => {
    expect(assetDescriptionFrom({ vehicle_type: 'PUMPS', make: null, model: '  ' }))
      .toBe('PUMPS')
  })

  it('returns null rather than an empty string when nothing is known', () => {
    // Null keeps the column honestly blank; '' reads as "someone cleared it".
    expect(assetDescriptionFrom({})).toBeNull()
    expect(assetDescriptionFrom(null)).toBeNull()
    expect(assetDescriptionFrom(undefined)).toBeNull()
  })
})

// ── Payload ──────────────────────────────────────────────────────────────────

describe('buildRepairRequestPayload', () => {
  it('produces the exact queue payload', () => {
    const payload = buildRepairRequestPayload(
      draft({
        plateNo: '1234 ABC',
        assetDescription: 'TR-MIXER / Sany',
        site: 'DIRIYAH-G1',
        odometer: '128,450',
        engineHours: '4210',
        faultCategory: 'Transmission',
        priority: 'High',
        photos: ['tp-storage://a.jpg', '', 'file:///b.jpg'],
        signature: '<svg/>',
      }),
      reporter,
      CUID,
      NOW,
    )

    expect(payload).toEqual({
      asset_no: 'TM514',
      plate_no: '1234 ABC',
      asset_description: 'TR-MIXER / Sany',
      site: 'DIRIYAH-G1',
      country: 'KSA',
      odometer: 128450,
      engine_hours: 4210,
      fault_category: 'Transmission',
      description: 'Gearbox whining under load',
      priority: 'High',
      status: 'submitted',
      reported_by: 'user-1',
      reported_by_name: 'Ahmed Driver',
      reported_at: NOW,
      photos: ['tp-storage://a.jpg', 'file:///b.jpg'],
      signature: '<svg/>',
      client_uuid: CUID,
    })
  })

  it('never carries an RFR number - the office mints it', () => {
    const payload = buildRepairRequestPayload(draft(), reporter, CUID, NOW)
    expect('rfr_no' in payload).toBe(false)
    // Nor any workshop-side transition column.
    for (const k of ['work_order_no', 'converted_at', 'converted_by', 'rejected_reason']) {
      expect(k in payload).toBe(false)
    }
  })

  it('writes null, never 0, for a meter the driver left blank', () => {
    const payload = buildRepairRequestPayload(draft(), reporter, CUID, NOW)
    expect(payload.odometer).toBeNull()
    expect(payload.engine_hours).toBeNull()
  })

  it('drops a negative meter rather than storing it', () => {
    // Submit is blocked by validate() first; this is the belt-and-braces half so
    // a caller that skipped validation cannot write a negative odometer.
    const payload = buildRepairRequestPayload(
      draft({ odometer: '-5', engineHours: '-1' }), reporter, CUID, NOW,
    )
    expect(payload.odometer).toBeNull()
    expect(payload.engine_hours).toBeNull()
  })

  it('falls back to the reporter site, and to their username for a name', () => {
    // The draft carries no site (the register did not supply one), so the
    // person's own site is used - never a guess about where the machine is.
    const payload = buildRepairRequestPayload(
      draft(), { ...reporter, fullName: null }, CUID, NOW,
    )
    expect(payload.site).toBe('NHC')            // reporter.site
    expect(payload.reported_by_name).toBe('ahmed')
  })

  it('prefers the site the register gave for the machine over the reporter site', () => {
    const payload = buildRepairRequestPayload(
      draft({ site: 'DIRIYAH-G1' }), reporter, CUID, NOW,
    )
    expect(payload.site).toBe('DIRIYAH-G1')
  })

  it('survives a missing profile without throwing', () => {
    const payload = buildRepairRequestPayload(draft(), null, CUID, NOW)
    expect(payload.country).toBeNull()
    expect(payload.reported_by).toBeNull()
    expect(payload.reported_by_name).toBeNull()
    expect(payload.site).toBeNull()
  })

  it('always sends a valid status and a valid priority', () => {
    const bad = buildRepairRequestPayload(
      // A priority that is not on the ladder must not reach the DB CHECK.
      draft({ priority: 'Urgent' as never }), reporter, CUID, NOW,
    )
    expect(bad.priority).toBe(RFR_DEFAULT_PRIORITY)
    expect(bad.status).toBe(RFR_STATUS_SUBMITTED)
  })

  it('sends null, not an empty array, when there are no photos', () => {
    const payload = buildRepairRequestPayload(draft({ photos: ['', '  '] }), reporter, CUID, NOW)
    expect(payload.photos).toBeNull()
  })
})

// ── The queue allow-list ─────────────────────────────────────────────────────

/**
 * THE HIGHEST-VALUE GUARD IN THIS FILE.
 *
 * `sanitize()` in lib/recordQueue.ts keeps ONLY the keys named in a command's
 * `fields` array and silently DROPS the rest. A field missing from that list is
 * not an error and not a failed insert - it is a column that arrives empty,
 * discovered weeks later by somebody wondering why no repair request has a
 * priority. Exactly that shipped twice before: the checklist `signatures` /
 * `notes` columns and V594's supervisor signature were both real columns the
 * payload carried and the allow-list threw away.
 *
 * So this compares the REAL allow-list, read out of the recordQueue source, to
 * the keys `buildRepairRequestPayload` actually produces.
 *
 * SOURCE SCAN, deliberately: importing lib/recordQueue.ts would pull in
 * supabase and react-native, which this pure ts-jest project cannot load.
 *
 * IT IS RED UNTIL THE COMMAND IS WIRED IN, AND THAT IS THE POINT - the failure
 * message lists precisely the fields the registry entry must name.
 */
function commandFields(command: string): string[] | null {
  const src = readFileSync(join(__dirname, '..', 'lib', 'recordQueue.ts'), 'utf8')
  const at = src.indexOf(`\n  ${command}: {`)
  if (at < 0) return null
  const open = src.indexOf('fields: [', at)
  const close = src.indexOf(']', open)
  if (open < 0 || close < 0) return null
  return [...src.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('the REPAIR_REQUEST queue allow-list carries every payload field', () => {
  it('can read an allow-list at all (a broken parse would pass vacuously)', () => {
    // Control: a command that has existed for many releases. If this returns
    // null the extractor is broken and every assertion below is meaningless.
    const wash = commandFields('WASH_RECORD')
    expect(wash).not.toBeNull()
    expect(wash).toContain('asset_no')
    expect(wash).toContain('photos')
  })

  it('names every key the payload produces', () => {
    const payloadKeys = Object.keys(
      buildRepairRequestPayload(draft(), reporter, CUID, NOW),
    ).sort()
    const allowed = commandFields('REPAIR_REQUEST')
    const missing = allowed === null
      ? payloadKeys
      : payloadKeys.filter((k) => !allowed.includes(k))
    const why = allowed === null
      ? 'COMMANDS.REPAIR_REQUEST does not exist in lib/recordQueue.ts yet; it must allow-list'
      : 'COMMANDS.REPAIR_REQUEST is missing'
    expect(`${why}: ${missing.join(', ')}`).toBe(`${why}: `)
  })

  it('does not allow-list a field the client never sends', () => {
    // An unused entry is how `rfr_no` would creep into a client write.
    const allowed = commandFields('REPAIR_REQUEST')
    if (allowed === null) return          // covered by the assertion above
    const payloadKeys = Object.keys(buildRepairRequestPayload(draft(), reporter, CUID, NOW))
    const extra = allowed.filter((k) => !payloadKeys.includes(k))
    expect(`unused allow-list fields: ${extra.join(', ')}`).toBe('unused allow-list fields: ')
  })
})
