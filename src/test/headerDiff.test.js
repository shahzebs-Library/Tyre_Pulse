/**
 * Column-change decisions.
 *
 * The point of this engine is that a change in the daily file is never applied
 * silently. The tests below are mostly about restraint: it must not invent a
 * rename between unrelated columns, must not map a column that is gone, and
 * must not treat cosmetic whitespace as a change worth interrupting someone for.
 */
import { describe, it, expect } from 'vitest'
import {
  normHeader, similarity, diffHeaders, defaultDecisions, applyHeaderDecisions,
  summariseDiff, DECISION, profileHeaders, overlapRatio, pickComparableProfile,
} from '../lib/import/headerDiff'

describe('normHeader', () => {
  it('treats case, padding and doubled spaces as the same header', () => {
    expect(normHeader('  Job  Card   No ')).toBe('job card no')
    expect(normHeader('JOB CARD NO')).toBe(normHeader('job card no'))
  })

  it('folds the non-breaking space Excel leaves behind', () => {
    // this is the exact character that blocked the job card import
    expect(normHeader('Job Card No')).toBe('job card no')
  })

  it('survives junk', () => {
    expect(normHeader(null)).toBe('')
    expect(normHeader(undefined)).toBe('')
  })
})

describe('diffHeaders', () => {
  it('reports no changes when only spacing and case differ', () => {
    const d = diffHeaders(['Job Card No', 'Asset Code'], ['JOB  CARD  NO', ' asset code '])
    expect(d.hasChanges).toBe(false)
    expect(d.unchanged).toHaveLength(2)
  })

  it('spots a genuine rename and pairs it', () => {
    const d = diffHeaders(['Job Card No'], ['Job Card Number'])
    expect(d.renames).toHaveLength(1)
    expect(d.renames[0]).toMatchObject({ from: 'Job Card No', to: 'Job Card Number' })
    expect(d.added).toHaveLength(0)
    expect(d.removed).toHaveLength(0)
  })

  it('does NOT invent a rename between unrelated columns', () => {
    // a wrong rename silently maps the wrong data into a field, which is worse
    // than asking about an added and a removed column separately
    const d = diffHeaders(['Asset Code'], ['Total Repair Cost'])
    expect(d.renames).toHaveLength(0)
    expect(d.added).toEqual(['Total Repair Cost'])
    expect(d.removed).toEqual(['Asset Code'])
  })

  it('never reuses a column on both sides of two suggestions', () => {
    const d = diffHeaders(['Total Cost'], ['Total Repair Cost', 'Total Parts Cost'])
    const tos = d.renames.map((r) => r.to)
    expect(new Set(tos).size).toBe(tos.length)
    expect(d.renames.length).toBeLessThanOrEqual(1)
  })

  it('separates plain additions from plain removals', () => {
    const d = diffHeaders(['A', 'B'], ['A', 'Waiting Part Hrs'])
    expect(d.added).toEqual(['Waiting Part Hrs'])
    expect(d.removed).toEqual(['B'])
    expect(d.hasChanges).toBe(true)
  })

  it('tolerates empty and junk input', () => {
    expect(diffHeaders([], []).hasChanges).toBe(false)
    expect(diffHeaders(null, null).hasChanges).toBe(false)
    expect(diffHeaders(['A', '', '  '], ['A']).hasChanges).toBe(false)
  })
})

describe('defaultDecisions', () => {
  it('defaults a rename to KEEP and a removal to CHANGE', () => {
    // keeping a rename carries the mapping across, which is nearly always the
    // intent; keeping a removed column would map something that is not there
    const d = diffHeaders(['Job Card No', 'Gone'], ['Job Card Number'])
    const dec = defaultDecisions(d)
    expect(dec['rename:Job Card No']).toBe(DECISION.KEEP)
    expect(dec['removed:Gone']).toBe(DECISION.CHANGE)
  })
})

describe('applyHeaderDecisions', () => {
  const saved = [
    { sourceHeader: 'Job Card No', target: 'work_order_no' },
    { sourceHeader: 'Asset Code', target: 'asset_no' },
  ]

  it('carries the old target onto the new column name when KEEP is chosen', () => {
    const d = diffHeaders(['Job Card No', 'Asset Code'], ['Job Card Number', 'Asset Code'])
    const out = applyHeaderDecisions(saved, d, { 'rename:Job Card No': DECISION.KEEP })
    const moved = out.find((r) => r.target === 'work_order_no')
    expect(moved.sourceHeader).toBe('Job Card Number')
    expect(moved.carriedFrom).toBe('Job Card No')
  })

  it('leaves the new column unmapped when CHANGE is chosen', () => {
    const d = diffHeaders(['Job Card No', 'Asset Code'], ['Job Card Number', 'Asset Code'])
    const out = applyHeaderDecisions(saved, d, { 'rename:Job Card No': DECISION.CHANGE })
    // the old rule is dropped rather than pointed at a column that no longer exists
    expect(out.find((r) => r.target === 'work_order_no')).toBeUndefined()
  })

  it('never maps a column that is gone from the file', () => {
    const d = diffHeaders(['Job Card No', 'Asset Code'], ['Job Card No'])
    const out = applyHeaderDecisions(saved, d, defaultDecisions(d))
    expect(out.map((r) => r.sourceHeader)).toEqual(['Job Card No'])
  })

  it('keeps every untouched rule exactly as it was', () => {
    const d = diffHeaders(['Job Card No', 'Asset Code'], ['Job Card No', 'Asset Code', 'New Col'])
    const out = applyHeaderDecisions(saved, d, defaultDecisions(d))
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.target).sort()).toEqual(['asset_no', 'work_order_no'])
  })

  it('tolerates junk rules', () => {
    expect(applyHeaderDecisions(null, diffHeaders([], []), {})).toEqual([])
    expect(applyHeaderDecisions([null, {}], diffHeaders([], []), {})).toEqual([])
  })
})

describe('profileHeaders', () => {
  it('uses the stored full column list and says it is complete', () => {
    const p = { header_columns: ['A', 'B', 'C'], rules: [{ source_header: 'A' }] }
    expect(profileHeaders(p)).toEqual({ headers: ['A', 'B', 'C'], complete: true })
  })

  it('falls back to the mapped headers on a pre-V391 profile and says it is partial', () => {
    // this flag is what stops the dialog claiming "1 new column" when the column
    // was always there and simply never mapped
    const p = { header_columns: null, rules: [{ source_header: 'A' }, { source_header: 'B' }] }
    expect(profileHeaders(p)).toEqual({ headers: ['A', 'B'], complete: false })
  })

  it('survives a profile with neither', () => {
    expect(profileHeaders({}).headers).toEqual([])
    expect(profileHeaders(null).headers).toEqual([])
  })
})

describe('overlapRatio', () => {
  it('measures how much of the old format is still present', () => {
    expect(overlapRatio(['A', 'B', 'C', 'D'], ['A', 'B', 'X'])).toBe(0.5)
    expect(overlapRatio(['A'], ['a'])).toBe(1)
    expect(overlapRatio([], ['A'])).toBe(0)
  })
})

describe('pickComparableProfile', () => {
  const daily = { id: 'daily', header_columns: ['Job Card No', 'Asset Code', 'Site', 'Cost'] }
  const other = { id: 'other', header_columns: ['Serial No', 'Brand', 'Size', 'Position'] }

  it('picks the profile the file is actually a version of', () => {
    const cur = ['Job Card Number', 'Asset Code', 'Site', 'Cost']
    expect(pickComparableProfile(cur, [other, daily]).profile.id).toBe('daily')
  })

  it('stays silent when the file is a DIFFERENT report, not a changed one', () => {
    // inventing renames between two unrelated formats would be worse than
    // saying nothing, so nothing below MIN_OVERLAP is offered
    expect(pickComparableProfile(['Serial No', 'Brand', 'Size', 'Position'], [daily])).toBeNull()
  })

  it('tolerates empty inputs', () => {
    expect(pickComparableProfile([], [])).toBeNull()
    expect(pickComparableProfile(['A'], null)).toBeNull()
  })
})

describe('summariseDiff', () => {
  it('says plainly when nothing changed', () => {
    expect(summariseDiff(diffHeaders(['A'], ['A']))).toContain('matches the format')
  })

  it('counts each kind of change', () => {
    const s = summariseDiff(diffHeaders(['A', 'Job Card No'], ['A', 'Job Card Number', 'New']))
    expect(s).toContain('renamed')
    expect(s).toContain('1 new')
  })
})
