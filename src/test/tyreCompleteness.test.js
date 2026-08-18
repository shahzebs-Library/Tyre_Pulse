import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  tyreCompleteness, classifyEntry, readTyreEntries, layoutIsKnown,
  pendingCodes, slotStateMap, isPendingPosition,
  TYRE_SLOT_STATES, PENDING_STATES, BLOCKING_DEFAULTS, EVIDENCE_FIELDS,
  SEEDED_CONDITION, PENDING_REASONS,
} from '../lib/tyreCompleteness'

// A Tri-mixer carries 12 wheels: 4 steer (F1L/F1R/F2L/F2R) + 8 dual drive.
const MIXER_SLOTS = ['F1L', 'F1R', 'F2L', 'F2R',
  'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro']

/** A wheel the inspector genuinely filled in. */
const filled = (extra = {}) => ({ condition: 'Good', pressure_psi: '110', ...extra })
/** The untouched seed BOTH capture forms write before anybody taps a thing. */
const seeded = () => ({
  position: '', serial_number: '', pressure_psi: '', tread_depth_mm: '',
  condition: 'Good', photo_uri: null, photo_url: null, notes: '',
})

const mixer = (tc, opts) => tyreCompleteness('TR-MIXER', 'TM123', tc, opts)

describe('what counts as a filled wheel', () => {
  it('an entry with a pressure is complete', () => {
    expect(classifyEntry(filled()).state).toBe('complete')
  })

  it('the seeded default is blank, NOT recorded', () => {
    // This is the load bearing rule. Both forms seed condition Good with every
    // other field empty, so treating "has a condition" as recorded would pass
    // every untouched wheel and the gate would catch nothing.
    expect(classifyEntry(seeded()).state).toBe('blank')
    expect(classifyEntry({ condition: 'Good' }).state).toBe('blank')
    expect(classifyEntry({}).state).toBe('blank')
    expect(classifyEntry({ condition: '  good  ' }).state).toBe('blank')
  })

  it('a condition the inspector had to choose IS evidence', () => {
    for (const c of ['Worn', 'Damaged', 'Puncture', 'Flat', 'Missing']) {
      expect(classifyEntry({ condition: c }).state).toBe('incomplete')
    }
  })

  it('a photo, a note or a serial alone counts as visited', () => {
    expect(classifyEntry({ condition: 'Good', photo_url: 'x' }).state).toBe('incomplete')
    expect(classifyEntry({ condition: 'Good', notes: 'wall scuffed' }).state).toBe('incomplete')
    expect(classifyEntry({ condition: 'Good', serial_number: 'ABC' }).state).toBe('incomplete')
  })

  it('tread depth and serial are never demanded', () => {
    // Measured live: tread_depth_mm on 0 of 4,778 entries, serial_number on 7.
    // Requiring either would make every inspection in this fleet unsubmittable.
    const res = mixer(Object.fromEntries(MIXER_SLOTS.map(s => [s, filled()])))
    expect(res.ok).toBe(true)
    expect(res.pending).toEqual([])
    expect(res.summary).toBe('All 12 tyres have details recorded.')
  })

  it('reads a pressure of 0 as a real reading, not as a blank', () => {
    // A flat tyre reads 0 psi. Number(0) is falsy, so the obvious
    // `if (!pressure)` would have thrown that reading away and asked the
    // inspector to go and record the wheel they had just recorded.
    expect(classifyEntry({ pressure_psi: 0 }).state).toBe('complete')
    expect(classifyEntry({ pressure_psi: 110 }).state).toBe('complete')
    expect(classifyEntry({ pressure: '95' }).state).toBe('complete')
    // An empty string is NOT a reading.
    expect(classifyEntry({ pressure_psi: '' }).state).toBe('blank')
    expect(classifyEntry({ pressure_psi: '   ' }).state).toBe('blank')
  })
})

describe('missing wheels are found and named', () => {
  it('two wheels with no entry at all block the close', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.slice(0, 10).map(s => [s, filled()]))
    const res = mixer(tc)
    expect(res.expected).toBe(12)
    expect(res.recorded).toBe(10)
    expect(res.missing.map(m => m.slot)).toEqual(['R2Ri', 'R2Ro'])
    expect(res.ok).toBe(false)
    expect(res.blocked).toHaveLength(2)
    expect(res.summary).toBe('2 of 12 tyres still need details.')
    // The man on the floor gets the wheel NAMES, not just a count.
    expect(pendingCodes(res)).toEqual(['RHRI', 'RHRO'])
    expect(res.missing[0].reason).toBe(PENDING_REASONS.missing)
  })

  it('an untouched but seeded wheel is REPORTED by default and blocks on request', () => {
    // Measured on the live data before choosing this default: 711 of 4,782 tyre
    // entries carry no evidence at all, spread across 97 of 401 inspections. So
    // blocking on `blank` out of the box would refuse ONE INSPECTION IN FOUR
    // that submits today. That is a change to what the fleet is required to
    // record, not a bug being caught, so it is opt-in and the owner decides.
    const tc = Object.fromEntries(MIXER_SLOTS.map((s, i) => [s, i < 11 ? filled() : seeded()]))
    expect(mixer(tc).ok).toBe(true)
    // ...but it is never hidden: it is still reported as outstanding.
    expect(mixer(tc).blank).toHaveLength(1)
    expect(mixer(tc).pending).toHaveLength(1)
    // And it blocks the moment somebody asks for it.
    expect(mixer(tc, { requireEvidence: true }).ok).toBe(false)
  })

  it('a missing pressure is advisory by default, blocking on request', () => {
    // pressure_psi is captured 83.7% of the time, so blocking on it by default
    // would reject roughly one inspection in six that works today.
    const tc = Object.fromEntries(MIXER_SLOTS.map((s, i) => [s, i < 11 ? filled() : { condition: 'Worn' }]))
    const soft = mixer(tc)
    expect(soft.ok).toBe(true)
    expect(soft.incomplete).toHaveLength(1)
    expect(soft.incomplete[0].reason).toBe(PENDING_REASONS.incomplete)
    expect(mixer(tc, { requirePressure: true }).ok).toBe(false)
  })

  it('an entirely empty inspection reports every wheel, not a pass', () => {
    const res = mixer({})
    expect(res.missing).toHaveLength(12)
    expect(res.ok).toBe(false)
  })
})

describe('positions are matched however they were stored', () => {
  it('accepts the canonical GCC codes as well as the slot ids', () => {
    const codes = ['LHF1', 'RHF1', 'LHF2', 'RHF2',
      'LHCO', 'LHCI', 'RHCI', 'RHCO', 'LHRO', 'LHRI', 'RHRI', 'RHRO']
    const res = mixer(Object.fromEntries(codes.map(c => [c, filled()])))
    expect(res.ok).toBe(true)
    expect(res.extra).toEqual([])
  })

  it('ignores case and punctuation in a stored key', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.map(s => [` ${s.toLowerCase()} `, filled()]))
    expect(mixer(tc).ok).toBe(true)
  })

  it('reads the array shape and a JSON string', () => {
    const rows = MIXER_SLOTS.map(s => ({ position: s, ...filled() }))
    expect(mixer(rows).ok).toBe(true)
    expect(mixer(JSON.stringify(rows)).ok).toBe(true)
    expect(mixer('not json').missing).toHaveLength(12)
  })

  it('a bare condition string value is read as the condition', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.map(s => [s, 'Damaged']))
    const res = mixer(tc)
    expect(res.missing).toEqual([])
    expect(res.incomplete).toHaveLength(12)
    expect(res.ok).toBe(true)
  })

  it('reads the web checklist row shape verbatim', () => {
    // src/pages/Inspections.jsx seeds clPositions as
    // { position, label, pressure: '', condition: 'Good', treadDepth: '' }
    // and names the reading `pressure`, not `pressure_psi`.
    const seedRow = (pos) => ({ position: pos, label: pos, pressure: '', condition: 'Good', treadDepth: '' })
    const untouched = MIXER_SLOTS.map(seedRow)
    expect(mixer(untouched).blank).toHaveLength(12)
    // Reported, not blocked, by default - see the note on the seeded-wheel test.
    expect(mixer(untouched).ok).toBe(true)
    expect(mixer(untouched, { requireEvidence: true }).ok).toBe(false)

    const done = MIXER_SLOTS.map((p) => ({ ...seedRow(p), pressure: '115' }))
    expect(mixer(done).ok).toBe(true)
  })

  it('a duplicate key cannot un-record a wheel', () => {
    const entries = MIXER_SLOTS.map(s => ({ position: s, ...filled() }))
    entries.push({ position: 'F1L', ...seeded() })
    expect(mixer(entries).ok).toBe(true)
  })
})

describe('nothing is invented for a machine we cannot read', () => {
  it('tyreless equipment is not applicable, never 0 of 0', () => {
    for (const vt of ['STATIONARY PUMP', 'GENERATOR', 'BT-PLANT', 'PLACING BOOM']) {
      const res = tyreCompleteness(vt, null, {})
      expect(res.applicable).toBe(false)
      expect(res.ok).toBe(true)
      expect(res.pending).toEqual([])
      expect(res.summary).toBe('No tyres to inspect on this equipment.')
    }
  })

  it('an unrecognised vehicle type blocks nothing and says so', () => {
    // resolveLayoutKey silently answers "Pickup" for anything it cannot place.
    // Blocking a real inspection against 4 guessed wheels would be worse than
    // the bug this module fixes.
    const res = tyreCompleteness('SOMETHING NOBODY CATALOGUED', null, {})
    expect(res.known).toBe(false)
    expect(res.expected).toBeNull()
    expect(res.ok).toBe(true)
    expect(res.summary).toContain('not known')
    expect(tyreCompleteness('', '', {}).known).toBe(false)
  })

  it('a real pickup is still known', () => {
    expect(layoutIsKnown('PICKUP', null)).toBe(true)
    expect(layoutIsKnown('Pick-up', null)).toBe(true)
    expect(layoutIsKnown(null, 'PL077')).toBe(true)
    expect(layoutIsKnown('TR-MIXER', null)).toBe(true)
    expect(layoutIsKnown('HEAVY EQP', 'TM640')).toBe(true)
    expect(layoutIsKnown('HEAVY EQP', null)).toBe(false)
    const res = tyreCompleteness('PICKUP', null, { FL: filled(), FR: filled() })
    expect(res.expected).toBe(4)
    expect(res.missing.map(m => m.slot)).toEqual(['RL', 'RR'])
  })

  it('works on the other vehicle families, not just the mixer', () => {
    // A concrete pump carries 14 wheels (3 steer axles + 2 dual drive axles),
    // a wheel loader 4. Getting the count from the layout catalogue is what
    // makes this engine right for every machine rather than for one of them.
    const pumpSlots = ['F1L', 'F1R', 'F2L', 'F2R', 'F3L', 'F3R',
      'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li']
    const pump = tyreCompleteness('MP CONCRETE PUMP', 'MP093',
      Object.fromEntries(pumpSlots.map(s => [s, filled()])))
    expect(pump.expected).toBe(14)
    expect(pendingCodes(pump)).toEqual(['RHR2-I', 'RHR2-O'])
    expect(pump.ok).toBe(false)

    const loader = tyreCompleteness('WHEEL LOADER', 'WL010', {})
    expect(loader.expected).toBe(4)
    expect(loader.summary).toBe('4 of 4 tyres still need details.')
  })

  it('a null or absent tyre_conditions is every wheel outstanding, not a pass', () => {
    expect(tyreCompleteness('TR-MIXER', 'TM1', null).missing).toHaveLength(12)
    expect(tyreCompleteness('TR-MIXER', 'TM1', undefined).ok).toBe(false)
    // the whole inspection row is accepted as well as its tyre_conditions
    expect(tyreCompleteness('TR-MIXER', 'TM1', { tyre_conditions: {} }).expected).toBe(12)
  })

  it('a recorded spare is extra, never a wheel somebody must inspect', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.map(s => [s, filled()]))
    tc.SP = filled()
    const res = mixer(tc)
    expect(res.expected).toBe(12)
    expect(res.extra).toEqual(['SP'])
    expect(res.ok).toBe(true)
  })

  it('readings in a vocabulary we cannot place are reported, not called empty', () => {
    const res = mixer({ WHEEL_ALPHA: filled(), WHEEL_BETA: filled() })
    expect(res.matched).toBe(false)
    expect(res.ok).toBe(true)
    expect(res.missing).toEqual([])
    expect(res.extra).toEqual(['WHEEL_ALPHA', 'WHEEL_BETA'])
    expect(res.summary).toContain('could not be matched')
  })

  it('readTyreEntries never throws on junk', () => {
    expect(readTyreEntries(null)).toEqual([])
    expect(readTyreEntries(42)).toEqual([])
    expect(readTyreEntries('{bad')).toEqual([])
    expect(readTyreEntries({ tyre_conditions: null })).toEqual([])
  })
})

describe('helpers the diagram uses', () => {
  const tc = Object.fromEntries(MIXER_SLOTS.slice(0, 11).map(s => [s, filled()]))
  const res = mixer(tc)

  it('slotStateMap answers under the slot id AND the canonical code', () => {
    const map = slotStateMap(res)
    expect(map.R2Ro).toBe('missing')
    expect(map.RHRO).toBe('missing')
    expect(map.F1L).toBe('complete')
    expect(map.LHF1).toBe('complete')
  })

  it('isPendingPosition is false for an unknown position, not true', () => {
    expect(isPendingPosition(res, 'R2Ro')).toBe(true)
    expect(isPendingPosition(res, 'F1L')).toBe(false)
    expect(isPendingPosition(res, 'NOT_A_WHEEL')).toBe(false)
    expect(isPendingPosition(null, 'F1L')).toBe(false)
  })
})

/**
 * DRIFT GUARD.
 *
 * The engine is hand mirrored into mobile/lib/tyreCompleteness.ts, and a one
 * sided edit is invisible: the phone would gate on a different definition of
 * "filled" from the web, which is exactly the class of split this repo has been
 * bitten by before. Every behavioural constant is marked "#mirror:" in BOTH
 * files and compared here. A whole file text compare is impossible (JS against
 * TypeScript), so what is compared is the part that decides behaviour.
 */
describe('an inspector can say "I checked it and it is fine"', () => {
  // Without this there was NO way to record a wheel as attended to except by
  // leaving a pressure, a photo or a note. Every wheel is seeded the moment a
  // vehicle is chosen and the seed's condition is 'Good', so tapping Good was
  // byte identical to not tapping anything. That made the gate demand a reading
  // from somebody who has genuinely checked the tyre and has no gauge - a
  // requirement they cannot satisfy, which is how a safety gate turns into a
  // reason to fake a number.
  it('a deliberately checked wheel is not blank, even with nothing else on it', () => {
    expect(classifyEntry({ condition: 'Good', checked: true }).state).not.toBe('blank')
    expect(classifyEntry({ condition: 'Good' }).state).toBe('blank')
  })

  it('the seeded false does NOT count - only an explicit true', () => {
    // emptyTyrePosition writes checked: false, so a seeded wheel must stay blank.
    expect(classifyEntry({ condition: 'Good', checked: false }).state).toBe('blank')
    expect(classifyEntry({ condition: 'Good', checked: 'yes' }).state).toBe('blank')
  })

  it('a checked wheel with no pressure is still ADVISORY, not complete', () => {
    // It counts as attended to, which is what stops it blocking. It does not
    // pretend a reading was taken.
    expect(classifyEntry({ condition: 'Good', checked: true }).state).toBe('incomplete')
  })
})

describe('mirror does not drift from mobile/lib/tyreCompleteness.ts', () => {
  const webSrc = readFileSync(resolve(__dirname, '../lib/tyreCompleteness.js'), 'utf8')
  const mobSrc = readFileSync(resolve(__dirname, '../../mobile/lib/tyreCompleteness.ts'), 'utf8')

  /** Pull each "// #mirror: NAME" block (marker to the next blank line). */
  function mirrorBlocks(src) {
    const out = {}
    const re = /\/\/ #mirror: ([A-Z_]+)\n([\s\S]*?)(?=\n\s*\n|\n\/\/ #mirror:)/g
    let m
    while ((m = re.exec(src)) !== null) {
      out[m[1]] = m[2]
        .replace(/^export /gm, '')
        .replace(/\s+/g, '')
        .replace(/,\}/g, '}')
        .replace(/,\]/g, ']')
    }
    return out
  }

  const web = mirrorBlocks(webSrc)
  const mob = mirrorBlocks(mobSrc)

  it('found the marked blocks on both sides', () => {
    // Without this, a marker rename would silently yield {} on both sides and
    // every comparison below would vacuously pass.
    const expected = ['STATES', 'PENDING_STATES', 'BLOCKING_DEFAULTS', 'EVIDENCE_FIELDS', 'SEEDED_CONDITION', 'REASONS']
    expect(Object.keys(web).sort()).toEqual([...expected].sort())
    expect(Object.keys(mob).sort()).toEqual([...expected].sort())
    expect(web.EVIDENCE_FIELDS).toContain('pressure_psi')
  })

  it('every behavioural constant is identical on both sides', () => {
    const drift = []
    for (const name of Object.keys(web)) {
      if (web[name] !== mob[name]) drift.push(`${name}: web ${web[name]} vs mobile ${mob[name]}`)
    }
    expect(drift).toEqual([])
  })

  it('the classifier applies its rules in the same order on both sides', () => {
    const rules = (src) => {
      const body = src.slice(src.indexOf('export function classifyEntry'))
      return [...body.slice(0, body.indexOf('\n}')).matchAll(/state: '([a-z]+)'/g)].map(x => x[1])
    }
    expect(rules(webSrc)).toEqual(['blank', 'incomplete', 'complete'])
    expect(rules(mobSrc)).toEqual(rules(webSrc))
  })

  it('both sides export the same public surface', () => {
    const names = (src) => [...src.matchAll(/export (?:function|const) ([A-Za-z_]+)/g)]
      .map(m => m[1]).sort()
    expect(names(mobSrc)).toEqual(names(webSrc))
  })

  it('the constants the module runs on match the exported values', () => {
    // The blocks above are text. Prove the module actually evaluates to them,
    // so a comment shaped like a mirror block can never stand in for the code.
    expect(TYRE_SLOT_STATES).toEqual(['missing', 'blank', 'incomplete', 'complete'])
    expect(PENDING_STATES).toEqual(['missing', 'blank', 'incomplete'])
    expect(BLOCKING_DEFAULTS).toEqual({ missing: true, blank: false, incomplete: false })
    expect(SEEDED_CONDITION).toBe('good')
    expect(EVIDENCE_FIELDS.pressure).toContain('pressure_psi')
    expect(Object.keys(PENDING_REASONS).sort()).toEqual(['blank', 'incomplete', 'missing'])
  })
})
