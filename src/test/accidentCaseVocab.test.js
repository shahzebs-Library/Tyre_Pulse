import { describe, it, expect } from 'vitest'
import {
  REPORT_WIZARD_STEPS, CASE_FLOW, caseFlowLabel, caseFlowStep,
  FAULT_TILES, faultStatusFor, PAYER_TILES, recoveryRequiredFor, payerLabel,
  RESPONSIBILITY_DOCS, CLAIM_PACKAGE_DOCS, FLEET_VALIDATION_ITEMS,
  REPAIR_ROUTE_TILES, DISPATCH_STEPPER, RECEIPT_REQUIRED,
  DAMAGE_TYPES, canonDamageType, DAMAGE_LEVELS, DAMAGE_NOTE_MAX, FAMILY_VIEW_ORDER, VIEW_LABELS,
} from '../lib/accidentCaseVocab'
import { WORKSTREAMS } from '../lib/accidentCase'

describe('accidentCaseVocab - transcribed from the owner mock screens', () => {
  it('report wizard has the 7 steps the Identify-asset mock numbers', () => {
    expect(REPORT_WIZARD_STEPS).toHaveLength(7)
    expect(REPORT_WIZARD_STEPS[0]).toMatchObject({ n: 1, label: 'Identify asset' })
    expect(REPORT_WIZARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('case flow numbers 7 workstreams and every key that maps to a workstream exists in accidentCase', () => {
    expect(CASE_FLOW).toHaveLength(7)
    const wsKeys = new Set(WORKSTREAMS.map((w) => w.key))
    for (const step of CASE_FLOW) {
      if (['damage_map', 'timeline'].includes(step.key)) continue
      expect(wsKeys.has(step.key)).toBe(true)
    }
    expect(caseFlowLabel('insurance')).toBe('Workstream 3 of 7')
    expect(caseFlowLabel('fleet_validation')).toBe('Workstream 1 of 7')
    expect(caseFlowLabel('nope')).toBe('')
    expect(caseFlowStep('handover').n).toBe(6)
  })

  it('fault tiles use the LIVE liability_type CHECK tokens and derive the mock fault status', () => {
    const live = ['our_driver_full', 'our_driver_partial', 'third_party_full', 'shared', 'under_investigation', 'disputed', 'hit_and_run', 'no_third_party', 'not_applicable']
    for (const t of FAULT_TILES) expect(live).toContain(t.key)
    expect(FAULT_TILES.map((t) => t.label)).toEqual(['Our driver / GCC', 'Other party', 'Shared fault', 'Under investigation', 'Not applicable'])
    expect(faultStatusFor('third_party_full', 0)).toBe('Non-faulty')
    expect(faultStatusFor('our_driver_full', 100)).toBe('Faulty')
    expect(faultStatusFor('shared', 50)).toBe('Faulty')
    expect(faultStatusFor('under_investigation', null)).toBe('Under review')
    expect(faultStatusFor('shared', null)).toBe('')
  })

  it('payer tiles are the 6 mock options and recovery is required when someone else pays', () => {
    expect(PAYER_TILES.map((p) => p.label)).toEqual(['Other party insurance', 'Our insurance', 'GCC / company', 'Driver recovery', 'Warranty', 'Pending decision'])
    expect(recoveryRequiredFor('other_party_insurance')).toBe(true)
    expect(recoveryRequiredFor('company')).toBe(false)
    expect(recoveryRequiredFor('pending')).toBe(false)
    expect(payerLabel('warranty')).toBe('Warranty')
    expect(payerLabel('unknown')).toBe('')
  })

  it('document sets match the mock counts (7 responsibility, 6 required; 8 claim package)', () => {
    expect(RESPONSIBILITY_DOCS).toHaveLength(7)
    expect(RESPONSIBILITY_DOCS.filter((d) => d.required)).toHaveLength(6)
    expect(RESPONSIBILITY_DOCS.at(-1)).toMatchObject({ label: 'Company Letter / Undertaking', required: false })
    expect(CLAIM_PACKAGE_DOCS).toHaveLength(8)
    expect(CLAIM_PACKAGE_DOCS.every((d) => d.required)).toBe(true)
    expect(FLEET_VALIDATION_ITEMS).toHaveLength(6)
  })

  it('repair route tiles and dispatch stepper follow the mock', () => {
    expect(REPAIR_ROUTE_TILES.map((r) => r.key)).toEqual(['internal', 'external', 'on_site'])
    expect(DISPATCH_STEPPER.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(RECEIPT_REQUIRED).toContain('custody_accepted')
    expect(RECEIPT_REQUIRED).toContain('receiver_signature')
  })

  it('damage vocabulary: 7 types, Major keeps the stored severe token, 200-char note, per-family view order', () => {
    expect(DAMAGE_TYPES.map((d) => d.label)).toEqual(['Dent', 'Scratch', 'Cracked', 'Broken', 'Missing', 'Bent', 'Other'])
    expect(canonDamageType('Crack')).toBe('cracked')
    expect(canonDamageType('BENT')).toBe('bent')
    expect(canonDamageType('panel/body')).toBe('other')
    expect(canonDamageType('')).toBe('')
    expect(DAMAGE_LEVELS.find((l) => l.key === 'severe').label).toBe('Major')
    expect(DAMAGE_NOTE_MAX).toBe(200)
    expect(FAMILY_VIEW_ORDER.bus).toEqual(['left', 'front_left', 'front', 'right', 'rear', 'top'])
    expect(FAMILY_VIEW_ORDER.concrete_pump[0]).toBe('top')
    expect(FAMILY_VIEW_ORDER.pickup).toEqual(['left', 'right', 'front', 'rear', 'top'])
    for (const views of Object.values(FAMILY_VIEW_ORDER)) for (const v of views) expect(VIEW_LABELS[v]).toBeTruthy()
  })

  it('carries no em or en dashes in any label (report/export rule)', () => {
    const all = JSON.stringify({ REPORT_WIZARD_STEPS, CASE_FLOW, FAULT_TILES, PAYER_TILES, RESPONSIBILITY_DOCS, CLAIM_PACKAGE_DOCS, FLEET_VALIDATION_ITEMS, DISPATCH_STEPPER, DAMAGE_TYPES, VIEW_LABELS })
    expect(all).not.toMatch(/[–—]/)
  })
})
