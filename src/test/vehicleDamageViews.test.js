import { describe, it, expect } from 'vitest'
import {
  familyForVehicleType, FAMILY_VIEWS, viewsForFamily, layoutFor, groupMarksByKey, markKey, viewLabel,
  canonicalView, numberMarks, normalizeMark, parsePhoneMarks, mergeMarks, markPhotoCount, clampNote,
  regionLabel, severityLabel, damageTypeLabel, MARK_SEVERITIES, UNPLACED_VIEW,
} from '../lib/vehicleDamageViews'
import { FAMILY_VIEW_ORDER, VIEW_LABELS, DAMAGE_NOTE_MAX } from '../lib/accidentCaseVocab'

describe('familyForVehicleType', () => {
  it('matches bus, concrete pump and pickup by keyword, case-insensitively', () => {
    expect(familyForVehicleType('BUS')).toBe('bus')
    expect(familyForVehicleType('Minibus')).toBe('bus')
    expect(familyForVehicleType('Concrete Pump')).toBe('concrete_pump')
    expect(familyForVehicleType('pick-up')).toBe('pickup')
    expect(familyForVehicleType('Pickup Truck')).toBe('pickup')
  })

  it('falls back to generic for an unknown or blank type', () => {
    expect(familyForVehicleType('TR-MIXER')).toBe('generic')
    expect(familyForVehicleType('')).toBe('generic')
    expect(familyForVehicleType(null)).toBe('generic')
    expect(familyForVehicleType(undefined)).toBe('generic')
  })

  it('a PLACING BOOM is tyreless mast-mounted gear, not the truck-mounted pump - the generic grid, never the chassis+outrigger pump layout', () => {
    expect(familyForVehicleType('PLACING BOOM')).toBe('generic')
    expect(familyForVehicleType('STATIONARY PUMP')).toBe('generic')
  })

  it('matches a real fleet type the old bespoke keyword list did not know (wheel loader, tanker, trailer)', () => {
    expect(familyForVehicleType('Wheel Loader')).toBe('generic')
    expect(familyForVehicleType('Water Tanker')).toBe('generic')
    expect(familyForVehicleType('Line Pump')).toBe('concrete_pump')
  })

  it('falls back to the ASSET NUMBER when vehicle_type is blank/junk', () => {
    expect(familyForVehicleType(null, 'MP093')).toBe('concrete_pump')
    expect(familyForVehicleType('', 'TM514')).toBe('generic') // a transit mixer, not a pump
    expect(familyForVehicleType(undefined, 'PL077')).toBe('pickup')
  })
})

describe('FAMILY_VIEWS follows the mock order (accidentCaseVocab.FAMILY_VIEW_ORDER)', () => {
  it('bus: Left, Front-left, Front, Right, Rear, Top', () => {
    expect(FAMILY_VIEWS.bus).toEqual(['left', 'front_left', 'front', 'right', 'rear', 'top'])
  })
  it('concrete pump: Top, Left, Right, Front, Rear (no more single overview)', () => {
    expect(FAMILY_VIEWS.concrete_pump).toEqual(['top', 'left', 'right', 'front', 'rear'])
    expect(FAMILY_VIEWS.concrete_pump).not.toContain('overview')
  })
  it('pickup and generic: Left, Right, Front, Rear, Top', () => {
    expect(FAMILY_VIEWS.pickup).toEqual(['left', 'right', 'front', 'rear', 'top'])
    expect(FAMILY_VIEWS.generic).toEqual(['left', 'right', 'front', 'rear', 'top'])
  })
  it('is a byte-for-byte mirror of the shared vocabulary, so the two cannot drift', () => {
    for (const f of Object.keys(FAMILY_VIEW_ORDER)) expect([...FAMILY_VIEWS[f]]).toEqual(FAMILY_VIEW_ORDER[f])
  })
  it('viewsForFamily degrades an unknown family to generic', () => {
    expect(viewsForFamily('spaceship')).toEqual(FAMILY_VIEWS.generic)
  })
})

describe('layoutFor', () => {
  it('returns a layout with cols/rows and a non-empty region list for every family+view combo', () => {
    for (const family of Object.keys(FAMILY_VIEWS)) {
      for (const view of FAMILY_VIEWS[family]) {
        const layout = layoutFor(family, view)
        expect(layout.cols).toBeGreaterThan(0)
        expect(layout.rows).toBeGreaterThan(0)
        expect(Array.isArray(layout.regions)).toBe(true)
        expect(layout.regions.length).toBeGreaterThan(0)
      }
    }
  })

  it('every region key is unique within its own layout and every region fits inside the grid', () => {
    for (const family of Object.keys(FAMILY_VIEWS)) {
      for (const view of FAMILY_VIEWS[family]) {
        const { cols, rows, regions } = layoutFor(family, view)
        const keys = regions.map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
        for (const r of regions) {
          expect(r.col[0]).toBeGreaterThanOrEqual(1)
          expect(r.col[1]).toBeLessThanOrEqual(cols + 1)
          expect(r.row[0]).toBeGreaterThanOrEqual(1)
          expect(r.row[1]).toBeLessThanOrEqual(rows + 1)
          expect(r.col[1]).toBeGreaterThan(r.col[0])
          expect(r.row[1]).toBeGreaterThan(r.row[0])
        }
      }
    }
  })

  it('bus front_left is a real 3/4 view: front parts AND left-side parts, with the mock\'s hatched corner', () => {
    const keys = layoutFor('bus', 'front_left').regions.map((r) => r.key)
    expect(keys).toContain('windshield')
    expect(keys).toContain('left_headlight')
    expect(keys).toContain('front_door')
    expect(keys).toContain('front_left_bumper_corner')
    expect(regionLabel('bus', 'front_left', 'front_left_bumper_corner')).toBe('Front-left bumper corner')
  })

  it('top views exist for bus, pickup and generic and are roof/bonnet plans, not side panels', () => {
    expect(layoutFor('bus', 'top').regions.map((r) => r.key)).toContain('roof_hatch')
    expect(layoutFor('pickup', 'top').regions.map((r) => r.key)).toContain('bonnet')
    expect(layoutFor('generic', 'top').regions.map((r) => r.key)).toContain('load_bed')
    expect(layoutFor('pickup', 'top').regions.map((r) => r.key)).not.toContain('front_door')
  })

  it('the pump layouts are named components (Boom section 1..n, outriggers, hopper), not body-panel regions', () => {
    const top = layoutFor('concrete_pump', 'top').regions.map((r) => r.key)
    expect(top).toContain('boom_section_1')
    expect(top).toContain('boom_section_3')
    expect(top).toContain('outrigger_front_left')
    expect(top).toContain('hopper')
    expect(top).not.toContain('windshield')
    expect(regionLabel('concrete_pump', 'top', 'boom_section_3')).toBe('Boom section 3')
    expect(layoutFor('concrete_pump', 'left').regions.map((r) => r.key)).toContain('outrigger_front')
    expect(layoutFor('concrete_pump', 'rear').regions.map((r) => r.key)).toContain('hopper')
  })

  it("the pump's legacy 'overview' is an alias of 'top' so old marks still render", () => {
    expect(layoutFor('concrete_pump', 'overview')).toBe(layoutFor('concrete_pump', 'top'))
    expect(canonicalView('overview')).toBe('top')
    expect(canonicalView('left')).toBe('left')
  })

  it('degrades to the generic layout for an unrecognised family/view rather than throwing', () => {
    expect(layoutFor('spaceship', 'front').regions.length).toBeGreaterThan(0)
    expect(layoutFor('generic', 'underneath').regions.length).toBeGreaterThan(0)
  })

  it('regionLabel returns an empty string, never an invented label, for a region the layout does not have', () => {
    expect(regionLabel('bus', 'front', 'no_such_part')).toBe('')
  })
})

describe('viewLabel / severityLabel / damageTypeLabel', () => {
  it('labels come from the shared VIEW_LABELS, with overview reading as Top', () => {
    expect(viewLabel('front')).toBe(VIEW_LABELS.front)
    expect(viewLabel('front_left')).toBe('Front-left')
    expect(viewLabel('overview')).toBe('Top')
    expect(viewLabel('mystery')).toBe('mystery')
    expect(viewLabel(UNPLACED_VIEW)).toBe('Position not recorded')
  })
  it("severe is labelled Major; MARK_SEVERITIES mirrors DAMAGE_LEVELS", () => {
    expect(severityLabel('severe')).toBe('Major')
    expect(severityLabel('minor')).toBe('Minor')
    expect(MARK_SEVERITIES.map((s) => s.value)).toEqual(['minor', 'moderate', 'severe'])
  })
  it('damageTypeLabel canonicalises legacy stored values', () => {
    expect(damageTypeLabel('crack')).toBe('Cracked')
    expect(damageTypeLabel('Dented')).toBe('Dent')
    expect(damageTypeLabel('Structural')).toBe('Other')
    expect(damageTypeLabel('')).toBe('')
  })
})

describe('markKey / groupMarksByKey / numberMarks', () => {
  it('builds the same identity key markKey and groupMarksByKey both use, canonicalising the view', () => {
    expect(markKey('front', 'grille')).toBe('front::grille')
    expect(markKey('overview', 'hopper')).toBe('top::hopper')
  })

  it('groups marks by view+region_key and ignores malformed entries', () => {
    const areas = [
      { view: 'front', region_key: 'grille', damage_type: 'dent' },
      { view: 'left', region_key: 'front_door', damage_type: 'scratch' },
      null,
      { view: 'rear' },
      { region_key: 'front_bumper' },
    ]
    const map = groupMarksByKey(areas)
    expect(map.size).toBe(2)
    expect(map.get('front::grille').damage_type).toBe('dent')
  })

  it('an old pump mark stored under overview is found under the Top view key', () => {
    const map = groupMarksByKey([{ view: 'overview', region_key: 'hopper' }])
    expect(map.get(markKey('top', 'hopper'))).toBeTruthy()
  })

  it('returns an empty map for non-array input', () => {
    expect(groupMarksByKey(null).size).toBe(0)
    expect(groupMarksByKey(undefined).size).toBe(0)
  })

  it('numbers marks 1..N in recorded order and never numbers a malformed entry', () => {
    const n = numberMarks([
      { view: 'left', region_key: 'front_door' },
      null,
      { view: 'front', region_key: 'grille' },
      { view: 'rear' },
    ])
    expect(n.get('left::front_door')).toBe(1)
    expect(n.get('front::grille')).toBe(2)
    expect(n.size).toBe(2)
  })
})

describe('normalizeMark / parsePhoneMarks / mergeMarks (the phone fallback source)', () => {
  const phoneJson = JSON.stringify({
    version: 2,
    marks: [
      { zone_id: 'front_door', view: 'left', area: 'Front door', damage_type: 'scratch', severity: 'minor', note: 'long scuff', photo_references: ['p1.jpg', 'p2.jpg'] },
      { zone_id: 'bonnet', damage_type: 'dent', severity: 'severe' }, // no view recorded on the phone
      { view: 'front' }, // no zone - not a mark
    ],
  })

  it("parses the Flutter v2 payload's own keys (zone_id/area/photo_references) into the damage_areas shape", () => {
    const marks = parsePhoneMarks(phoneJson)
    expect(marks).toHaveLength(2)
    expect(marks[0]).toMatchObject({
      view: 'left', region_key: 'front_door', region_label: 'Front door', component_label: 'Front door',
      damage_type: 'scratch', severity: 'minor', note: 'long scuff', photo_refs: ['p1.jpg', 'p2.jpg'], source: 'mobile',
    })
    expect(marks[0].photo_references).toBeUndefined()
    expect(markPhotoCount(marks[0])).toBe(2)
  })

  it('a phone mark with no view is kept under the honest unplaced view, never dropped and never placed on a face', () => {
    const marks = parsePhoneMarks(phoneJson)
    expect(marks[1].view).toBe(UNPLACED_VIEW)
    expect(marks[1].region_key).toBe('bonnet')
  })

  it('free text, malformed JSON, another version and null all yield no marks (the column is also a description field)', () => {
    expect(parsePhoneMarks('Front bumper and left door')).toEqual([])
    expect(parsePhoneMarks('{not json')).toEqual([])
    expect(parsePhoneMarks(JSON.stringify({ version: 1, marks: [{ zone_id: 'x', view: 'left' }] }))).toEqual([])
    expect(parsePhoneMarks(JSON.stringify({ version: 2 }))).toEqual([])
    expect(parsePhoneMarks(null)).toEqual([])
    expect(parsePhoneMarks({ version: 2, marks: [{ zone_id: 'a', view: 'rear' }] })).toHaveLength(1)
  })

  it('normalizeMark canonicalises the type, keeps a stored-but-unknown level rather than inventing minor, and clamps the note', () => {
    const m = normalizeMark({ view: 'front', region_key: 'grille', damage_type: 'Crack', level: 'moderate', note: 'x'.repeat(250) })
    expect(m.damage_type).toBe('cracked')
    expect(m.severity).toBe('moderate')
    expect(m.note).toHaveLength(DAMAGE_NOTE_MAX)
    expect(normalizeMark({ view: 'front', region_key: 'g', severity: 'catastrophic' }).severity).toBe('catastrophic')
    expect(normalizeMark({ view: 'front' })).toBeNull()
    expect(normalizeMark({ region_key: 'g' })).toBeNull() // web source with no view is not a mark
    expect(normalizeMark(null)).toBeNull()
  })

  it('mergeMarks: the assessment wins on a shared identity, phone-only marks are appended with source mobile', () => {
    const merged = mergeMarks(
      [{ view: 'left', region_key: 'front_door', damage_type: 'dent', severity: 'severe', photo_refs: [] }],
      parsePhoneMarks(phoneJson),
    )
    // 1 assessment mark + 2 phone marks, but the phone's front_door shares the
    // assessment's identity and is shadowed - so 2, never a duplicate row.
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ region_key: 'front_door', damage_type: 'dent', source: 'assessment' })
    expect(merged.filter((m) => m.source === 'mobile').map((m) => m.region_key)).toEqual(['bonnet'])
  })

  it('clampNote enforces the 200-character limit and tolerates null', () => {
    expect(clampNote(null)).toBe('')
    expect(clampNote('ok')).toBe('ok')
    expect(clampNote('a'.repeat(300))).toHaveLength(200)
  })
})
