import { describe, it, expect } from 'vitest'
import { defectsForAction, actionRowsForInspection, damagedPositions } from '../lib/inspectionTyreFlags'

/**
 * The failure-to-action chain.
 *
 * Before this existed, an inspector could record a damaged or punctured tyre and
 * NOTHING downstream was created - measured on the live system, 13 inspections
 * found damage across 12 assets while the whole database held 3 corrective
 * actions. These tests pin the two properties that make the chain trustworthy:
 *   - the defects that raise an action are the SAME ones the register flags
 *   - pressing the button twice cannot raise the same action twice
 */

const inspection = (over = {}) => ({
  id: 'insp-1',
  asset_no: 'TM101',
  site: 'NHC',
  country: 'KSA',
  tyre_conditions: {
    LHF1: { position: 'LHF1', condition: 'Damage' },
    RHF1: { position: 'RHF1', condition: 'Good' },
    LHR1: { position: 'LHR1', condition: 'Puncture' },
  },
  ...over,
})

describe('defectsForAction', () => {
  it('raises one defect per damaged or punctured position, and none for good tyres', () => {
    const d = defectsForAction(inspection())
    expect(d).toHaveLength(2)
    expect(d.map(x => x.position).sort()).toEqual(['LHF1', 'LHR1'])
    expect(d.every(x => x.kind === 'damage')).toBe(true)
    // damage is a road-safety item, never quietly filed as routine
    expect(d.every(x => x.priority === 'High')).toBe(true)
  })

  it('separates a stop-the-vehicle fault from planned replacement', () => {
    // Every fault an inspector can record is now actioned, but they are not all
    // the same urgency: a flat or a cut casing means the vehicle should not
    // move, a worn tyre means book the change. Raising all of them as High
    // would make High mean nothing, which is how a real puncture gets lost in
    // a list of routine wear.
    const d = defectsForAction(inspection({ tyre_conditions: {
      LHF1: { condition: 'Worn' },
      RHF1: { condition: 'Flat' },
      LHR1: { condition: 'Damaged' },
      RHR1: { condition: 'Good' },
    } }))
    const by = Object.fromEntries(d.map((x) => [x.position, x.priority]))
    expect(by).toEqual({ LHF1: 'Medium', RHF1: 'High', LHR1: 'High' })
    // and the wording follows the urgency, so the two do not contradict
    expect(d.find((x) => x.position === 'LHF1').description).toMatch(/plan a replacement/i)
    expect(d.find((x) => x.position === 'RHF1').description).toMatch(/before the vehicle returns to service/i)
  })

  it('uses the SAME damage detection the register flags with', () => {
    const insp = inspection()
    const flagged = damagedPositions(insp).map(p => p.position).sort()
    const actioned = defectsForAction(insp).map(d => d.position).sort()
    expect(actioned).toEqual(flagged)
  })

  it('also raises tyres the life engine flags, at the right priority', () => {
    const flagMap = {
      TM101: {
        overdue: [{ position: 'RHR1', serial: 'S1' }],
        dueSoon: [{ position: 'RHR2', serial: 'S2' }],
        count: 2,
      },
    }
    const d = defectsForAction(inspection(), flagMap)
    const overdue = d.find(x => x.kind === 'overdue')
    const soon    = d.find(x => x.kind === 'due_soon')
    expect(overdue.priority).toBe('High')
    // due soon is planning work, not a stop-the-vehicle item
    expect(soon.priority).toBe('Medium')
    expect(d).toHaveLength(4)
  })

  it('never emits the same defect twice, and tolerates junk', () => {
    const flagMap = { TM101: { overdue: [{ position: 'LHF1' }, { position: 'LHF1' }], dueSoon: [], count: 2 } }
    const keys = defectsForAction(inspection(), flagMap).map(d => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(defectsForAction(null)).toEqual([])
    expect(defectsForAction({ tyre_conditions: 'not json' })).toEqual([])
  })
})

describe('actionRowsForInspection', () => {
  it('carries the inspection context onto every row', () => {
    const insp = inspection()
    const rows = actionRowsForInspection(insp, defectsForAction(insp))
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.asset_no).toBe('TM101')
      expect(r.site).toBe('NHC')
      expect(r.country).toBe('KSA')
      expect(r.source_type).toBe('inspection')
      expect(r.source_id).toBe('insp-1')
      expect(r.status).toBe('Open')
      expect(r.source_detail).toBeTruthy()   // the identity the DB guard uses
    }
  })

  it('skips defects that already have an open action - the button is idempotent', () => {
    const insp = inspection()
    const defects = defectsForAction(insp)
    const firstRun = actionRowsForInspection(insp, defects)
    const openKeys = firstRun.map(r => r.source_detail)

    // second press with everything already open
    expect(actionRowsForInspection(insp, defects, { existingKeys: openKeys })).toEqual([])
    // one closed and re-detected: the same position genuinely can fail again
    expect(actionRowsForInspection(insp, defects, { existingKeys: [openKeys[0]] })).toHaveLength(1)
  })

  it('does not overflow the title column', () => {
    const long = inspection({
      asset_no: 'A'.repeat(400),
      tyre_conditions: { P1: { position: 'P1', condition: 'Damage' } },
    })
    const [row] = actionRowsForInspection(long, defectsForAction(long))
    expect(row.title.length).toBeLessThanOrEqual(300)
  })
})
