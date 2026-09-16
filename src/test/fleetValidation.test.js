import { describe, it, expect } from 'vitest'
import {
  buildValidationChecklist, deriveChecklist, mergeChecklist, validationSummary, countLabel, toggleState,
  resolveRecipient, authorityWarning, missingAuthorityDocs, injuriesLabel, thirdPartyLabel, photoCount,
  VALIDATION_ITEMS, FLEET_VALIDATION_ITEMS, MIN_REQUIRED_PHOTOS, ITEM_TAB,
} from '../lib/fleetValidation'

const byKey = (items, k) => items.find((i) => i.key === k)

describe('the six mock M6 items', () => {
  it('are exactly the vocabulary items, in mock order, and VALIDATION_ITEMS is the back-compat alias', () => {
    expect(VALIDATION_ITEMS).toBe(FLEET_VALIDATION_ITEMS)
    expect(deriveChecklist({}).map((i) => i.key)).toEqual([
      'asset_driver_confirmed', 'incident_facts_confirmed', 'damage_map_reviewed',
      'required_photographs', 'police_najm_documents', 'workshop_assessment_requested',
    ])
    expect(Object.keys(ITEM_TAB)).toEqual(FLEET_VALIDATION_ITEMS.map((i) => i.key))
  })

  it('suggests pending for every item when the incident carries nothing (no fabricated ticks)', () => {
    const items = deriveChecklist({})
    expect(items.every((i) => i.suggested === 'pending')).toBe(true)
  })
})

describe('derived states', () => {
  it('asset + driver: done only with a real fleet match AND a driver; attention when the asset is not registered', () => {
    expect(byKey(deriveChecklist({ acc: { asset_no: 'TM514', driver_name: 'A' }, asset: { asset_no: 'TM514' } }), 'asset_driver_confirmed').suggested).toBe('done')
    expect(byKey(deriveChecklist({ acc: { asset_no: 'TM514', driver_name: 'A' }, asset: null }), 'asset_driver_confirmed').suggested).toBe('attention')
    expect(byKey(deriveChecklist({ acc: { asset_no: 'TM514' }, asset: { asset_no: 'TM514' } }), 'asset_driver_confirmed').suggested).toBe('attention')
  })

  it('incident facts: done needs date, site, type and description; a missing fact is attention', () => {
    const full = { incident_date: '2026-01-01', site: 'NHC', accident_type: 'collision', description: 'Reversing' }
    expect(byKey(deriveChecklist({ acc: full }), 'incident_facts_confirmed').suggested).toBe('done')
    expect(byKey(deriveChecklist({ acc: { ...full, site: '' } }), 'incident_facts_confirmed').suggested).toBe('attention')
  })

  it('damage map: done when areas are marked; attention when an assessment exists with none', () => {
    expect(byKey(deriveChecklist({ damageAssessment: { damage_areas: [{ view: 'left', region_key: 'door' }] } }), 'damage_map_reviewed').suggested).toBe('done')
    expect(byKey(deriveChecklist({ damageAssessment: { damage_areas: [] } }), 'damage_map_reviewed').suggested).toBe('attention')
    expect(byKey(deriveChecklist({}), 'damage_map_reviewed').suggested).toBe('pending')
  })

  it('photographs: required = max(MIN_REQUIRED_PHOTOS, marked areas); prints "N of N" when met and "N missing" when not', () => {
    const photos7 = { photos: Array.from({ length: 7 }, (_, i) => `p${i}`) }
    const seven = deriveChecklist({ acc: photos7, damageAssessment: { damage_areas: Array.from({ length: 7 }, (_, i) => ({ region_key: `r${i}` })) } })
    const it7 = mergeChecklist(seven)[3]
    expect(it7.suggested).toBe('done')
    expect(countLabel(it7)).toBe('7 of 7')

    const three = mergeChecklist(deriveChecklist({ acc: { photos: ['a', 'b', 'c'] } }))[3]
    expect(three.countRequired).toBe(MIN_REQUIRED_PHOTOS)
    expect(three.state).toBe('attention')
    expect(countLabel(three)).toBe(`${MIN_REQUIRED_PHOTOS - 3} missing`)
  })

  it('photoCount reads both jsonb shapes (array and keyed object)', () => {
    expect(photoCount({ photos: ['a', null, 'b'] })).toBe(2)
    expect(photoCount({ photos: { front: ['a'], rear: ['b', 'c'] } })).toBe(3)
    expect(photoCount({})).toBe(0)
  })

  it('police / najm: counts only report_status=available; "1 missing" when Najm is absent', () => {
    const items = mergeChecklist(deriveChecklist({ authorityReports: [{ authority_type: 'police', report_status: 'available' }] }))
    const docs = byKey(items, 'police_najm_documents')
    expect(docs.state).toBe('attention')
    expect(countLabel(docs)).toBe('1 missing')
    expect(missingAuthorityDocs([{ authority_type: 'police', report_status: 'available' }]).map((d) => d.key)).toEqual(['najm'])
    expect(authorityWarning([{ authority_type: 'police', report_status: 'available' }])).toBe('Najm report is missing. Claim registration cannot start.')
    expect(authorityWarning([
      { authority_type: 'police', report_status: 'available' }, { authority_type: 'najm', report_status: 'available' },
    ])).toBe('')
    expect(countLabel(byKey(mergeChecklist(deriveChecklist({ authorityReports: [
      { authority_type: 'police', report_status: 'available' }, { authority_type: 'najm', report_status: 'available' },
    ] })), 'police_najm_documents'))).toBe('2 of 2')
  })

  it('workshop assessment requested: from the assessment workstream status or a recorded assessment', () => {
    expect(byKey(deriveChecklist({ workstreams: [{ workstream_key: 'assessment', status: 'assigned' }] }), 'workshop_assessment_requested').suggested).toBe('done')
    expect(byKey(deriveChecklist({ workstreams: [{ workstream_key: 'assessment', status: 'not_started' }] }), 'workshop_assessment_requested').suggested).toBe('pending')
    expect(byKey(deriveChecklist({ damageAssessment: { damage_areas: [] } }), 'workshop_assessment_requested').suggested).toBe('done')
    expect(countLabel(mergeChecklist(deriveChecklist({}))[5])).toBe('Pending')
  })
})

describe('mergeChecklist - a saved decision outranks the suggestion', () => {
  it('saved state, note, who and when win; a saved count_required overrides the derived one; count_done stays live', () => {
    const derived = deriveChecklist({ acc: { photos: ['a'] } })
    const merged = mergeChecklist(derived, [
      { item_key: 'required_photographs', state: 'not_applicable', count_required: 9, note: 'Night shot', checked_by_name: 'Sara', checked_at: '2026-09-16T10:00:00Z' },
      { item_key: 'damage_map_reviewed', state: 'done' },
    ])
    const photos = byKey(merged, 'required_photographs')
    expect(photos.state).toBe('not_applicable')
    expect(photos.countRequired).toBe(9)
    expect(photos.countDone).toBe(1)
    expect(photos.note).toBe('Night shot')
    expect(photos.checkedByName).toBe('Sara')
    expect(photos.passed).toBe(true)
    expect(countLabel(photos)).toBe('N/A')
    expect(byKey(merged, 'damage_map_reviewed').state).toBe('done')
    expect(byKey(merged, 'asset_driver_confirmed').saved).toBe(false)
  })

  it('ignores a saved row carrying an unknown state', () => {
    const merged = mergeChecklist(deriveChecklist({}), [{ item_key: 'damage_map_reviewed', state: 'bogus' }])
    expect(byKey(merged, 'damage_map_reviewed').state).toBe('pending')
  })

  it('buildValidationChecklist is derive + merge with passed on each item', () => {
    const items = buildValidationChecklist({ acc: {}, savedRows: [{ item_key: 'incident_facts_confirmed', state: 'done' }] })
    expect(items).toHaveLength(6)
    expect(byKey(items, 'incident_facts_confirmed').passed).toBe(true)
    expect(byKey(items, 'asset_driver_confirmed').passed).toBe(false)
  })
})

describe('validationSummary + toggleState', () => {
  it('never divides by zero and is complete only when every item is done or N/A', () => {
    expect(validationSummary([])).toEqual({ total: 0, passed: 0, missing: 0, attention: 0, complete: false })
    const s = validationSummary([{ state: 'done' }, { state: 'attention' }, { state: 'not_applicable' }])
    expect(s).toEqual({ total: 3, passed: 2, missing: 1, attention: 1, complete: false })
    expect(validationSummary([{ state: 'done' }, { state: 'not_applicable' }]).complete).toBe(true)
  })

  it('toggles done <-> pending and lifts attention / N/A to done', () => {
    expect(toggleState('done')).toBe('pending')
    expect(toggleState('pending')).toBe('done')
    expect(toggleState('attention')).toBe('done')
    expect(toggleState('not_applicable')).toBe('done')
  })
})

describe('summary labels', () => {
  it('injuries and third party render honest labels and Not set for blanks', () => {
    expect(injuriesLabel({ injury_count: 2 })).toBe('2 injured')
    expect(injuriesLabel({ injuries: false })).toBe('No injuries')
    expect(injuriesLabel({ injuries: 'none' })).toBe('No injuries')
    expect(injuriesLabel({})).toBe('Not set')
    expect(thirdPartyLabel({ third_party_involved: true })).toBe('Third party involved')
    expect(thirdPartyLabel({ third_party_involved: 'no' })).toBe('No third party')
    expect(thirdPartyLabel({})).toBe('Not set')
  })
})

describe('resolveRecipient - a role, never a hardcoded person', () => {
  const profiles = [
    { id: 'u1', full_name: 'Fatima Al', role: 'Insurance Officer', approved: true },
    { id: 'u2', full_name: 'Mai Noor', role: 'Data Monitor Officer', approved: true },
  ]
  it('prefers the workstream owner_id, then owner_role, then a holder of the notify role, then the role label', () => {
    expect(resolveRecipient({ workstreams: [{ workstream_key: 'insurance', owner_id: 'u1' }], profiles, workstreamKey: 'insurance', roleKey: 'insurance' }).label).toBe('Fatima Al')
    expect(resolveRecipient({ workstreams: [{ workstream_key: 'insurance', owner_role: 'Claims desk' }], profiles: [], workstreamKey: 'insurance', roleKey: 'insurance' }).label).toBe('Claims desk')
    expect(resolveRecipient({ workstreams: [], profiles, roleKey: 'command_center' })).toEqual({ name: 'Mai Noor', role: 'Data Monitor Officer', label: 'Mai Noor' })
    expect(resolveRecipient({ workstreams: [], profiles: [], workstreamKey: 'insurance', roleKey: 'insurance' })).toEqual({ name: null, role: 'Insurance', label: 'Insurance' })
    expect(resolveRecipient({}).label).toBe('Not set')
  })
})
