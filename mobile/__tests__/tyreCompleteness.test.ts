/**
 * Behaviour proof for the MOBILE half of the tyre completeness mirror.
 *
 * src/test/tyreCompleteness.test.js compares the two files' behavioural
 * constants and rule order as TEXT, which catches a one sided edit but cannot
 * prove the TypeScript actually runs the same way. This suite executes it. The
 * cases are deliberately the same ones the web suite asserts, so a divergence
 * in behaviour shows up as a failure here rather than as a phone that gates on
 * a different definition of "filled" from the web.
 */
import {
  tyreCompleteness, classifyEntry, layoutIsKnown, pendingCodes,
  slotStateMap, isPendingPosition, BLOCKING_DEFAULTS, SEEDED_CONDITION,
} from '../lib/tyreCompleteness'

const MIXER_SLOTS = ['F1L', 'F1R', 'F2L', 'F2R',
  'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro']

const filled = () => ({ condition: 'Good', pressure_psi: '110' })
/** The untouched seed emptyTyrePosition() writes for every wheel. */
const seeded = () => ({
  position: '', serial_number: '', pressure_psi: '', tread_depth_mm: '',
  condition: 'Good', photo_uri: null, photo_url: null, notes: '',
})
const mixer = (tc: unknown, opts = {}) => tyreCompleteness('TR-MIXER', 'TM123', tc, opts)

describe('mobile tyreCompleteness behaves like the web engine', () => {
  it('treats the seeded default as blank, not as recorded', () => {
    expect(classifyEntry(seeded()).state).toBe('blank')
    expect(classifyEntry({ condition: 'Good' }).state).toBe('blank')
    expect(classifyEntry({ condition: 'Damaged' }).state).toBe('incomplete')
    expect(classifyEntry(filled()).state).toBe('complete')
    expect(SEEDED_CONDITION).toBe('good')
  })

  it('reads a pressure of 0 as a real reading', () => {
    expect(classifyEntry({ pressure_psi: 0 }).state).toBe('complete')
    expect(classifyEntry({ pressure_psi: '' }).state).toBe('blank')
  })

  it('finds the wheels with no entry and names them', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.slice(0, 10).map(s => [s, filled()]))
    const res = mixer(tc)
    expect(res.expected).toBe(12)
    expect(res.ok).toBe(false)
    expect(res.missing.map(m => m.slot)).toEqual(['R2Ri', 'R2Ro'])
    expect(pendingCodes(res)).toEqual(['RHRI', 'RHRO'])
    expect(res.summary).toBe('2 of 12 tyres still need details.')
  })

  it('REPORTS a seeded but untouched wheel by default, and blocks on request', () => {
    // Measured on the live data before choosing this default: 711 of 4,782 tyre
    // entries carry no evidence at all, spread across 97 of 401 inspections. So
    // blocking on `blank` out of the box would refuse ONE INSPECTION IN FOUR
    // that submits today - a change to what the fleet must record, not a bug
    // being caught, and therefore the owner's call rather than ours.
    const tc = Object.fromEntries(MIXER_SLOTS.map((s, i) => [s, i < 11 ? filled() : seeded()]))
    expect(BLOCKING_DEFAULTS.blank).toBe(false)
    expect(mixer(tc).ok).toBe(true)
    // Never hidden, though: it is still reported as outstanding.
    expect(mixer(tc).pending).toHaveLength(1)
    expect(mixer(tc, { requireEvidence: true }).ok).toBe(false)
  })

  it('keeps a missing pressure advisory unless asked otherwise', () => {
    const tc = Object.fromEntries(MIXER_SLOTS.map((s, i) => [s, i < 11 ? filled() : { condition: 'Worn' }]))
    expect(mixer(tc).ok).toBe(true)
    expect(mixer(tc).incomplete).toHaveLength(1)
    expect(mixer(tc, { requirePressure: true }).ok).toBe(false)
  })

  it('never invents a wheel count it does not know', () => {
    const unknown = tyreCompleteness('SOMETHING NOBODY CATALOGUED', null, {})
    expect(unknown.known).toBe(false)
    expect(unknown.expected).toBeNull()
    expect(unknown.ok).toBe(true)
    const tyreless = tyreCompleteness('STATIONARY PUMP', null, {})
    expect(tyreless.applicable).toBe(false)
    expect(tyreless.ok).toBe(true)
    expect(tyreless.pending).toEqual([])
    expect(layoutIsKnown('HEAVY EQP', 'TM640')).toBe(true)
    expect(layoutIsKnown('HEAVY EQP', null)).toBe(false)
  })

  it('a spare is extra, and a foreign vocabulary is reported not called empty', () => {
    const tc: Record<string, unknown> = Object.fromEntries(MIXER_SLOTS.map(s => [s, filled()]))
    tc.SP = filled()
    expect(mixer(tc).extra).toEqual(['SP'])
    expect(mixer(tc).ok).toBe(true)
    const foreign = mixer({ WHEEL_ALPHA: filled() })
    expect(foreign.matched).toBe(false)
    expect(foreign.ok).toBe(true)
    expect(foreign.missing).toEqual([])
  })

  it('matches canonical codes and the diagram helpers answer both vocabularies', () => {
    const codes = ['LHF1', 'RHF1', 'LHF2', 'RHF2',
      'LHCO', 'LHCI', 'RHCI', 'RHCO', 'LHRO', 'LHRI', 'RHRI', 'RHRO']
    expect(mixer(Object.fromEntries(codes.map(c => [c, filled()]))).ok).toBe(true)
    const res = mixer(Object.fromEntries(MIXER_SLOTS.slice(0, 11).map(s => [s, filled()])))
    expect(slotStateMap(res).R2Ro).toBe('missing')
    expect(slotStateMap(res).RHRO).toBe('missing')
    expect(isPendingPosition(res, 'F1L')).toBe(false)
    expect(isPendingPosition(res, 'NOT_A_WHEEL')).toBe(false)
  })
})
