/**
 * What we moved, what we kept.
 *
 * The behaviour worth pinning is the flagging rule. If it fires on every moved
 * line it buries the real problems under 1,300 correct ones; if it never fires
 * the panel is just a list. The tests below are mostly about which decisions
 * are and are NOT worth interrupting someone for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  needsAttention, attentionReason, movementSentence, summariseCountries,
  bucketLabel, reasonLabel, categoryBucket, overrideMovesMoney, decisionKey,
  OVERRIDE_CATEGORIES, sortDecisions, SORTS,
} from '../lib/classificationDecisions'

const row = (o = {}) => ({
  country: 'KSA', item_code: 'X-1', item_name: 'Thing',
  erp_said: 'spare', we_said: 'tyre', movement: 'moved',
  decided_by: 'code-range', confidence: 0.95, rows: 3, value: 100,
  currency: 'SAR', reviewed: false, ...o,
})

describe('needsAttention', () => {
  it('flags a line nothing identified', () => {
    expect(needsAttention(row({ decided_by: 'default', confidence: 0.3 }))).toBe(true)
    expect(attentionReason(row({ decided_by: 'default', confidence: 0.3 })))
      .toContain('Nothing identified')
  })

  it('does NOT flag a strong move', () => {
    // the item code saying "tyre" is the strongest signal there is; flagging
    // every one of those would drown the genuine problems
    expect(needsAttention(row({ decided_by: 'code-range', confidence: 0.95 }))).toBe(false)
  })

  it('flags a move made on weaker than usual evidence', () => {
    expect(needsAttention(row({ decided_by: 'job-card', confidence: 0.7 }))).toBe(true)
  })

  it('does not flag a weak decision that AGREED with the file', () => {
    // agreeing with the file is not a change, so there is nothing to review
    expect(needsAttention(row({ movement: 'kept', decided_by: 'job-card', confidence: 0.7 }))).toBe(false)
  })

  it('never flags something a person already reviewed', () => {
    expect(needsAttention(row({ reviewed: true, decided_by: 'default', confidence: 0.3 }))).toBe(false)
    expect(attentionReason(row({ reviewed: true, decided_by: 'default', confidence: 0.3 }))).toBe('')
  })

  it('tolerates junk', () => {
    expect(needsAttention(null)).toBe(false)
    expect(needsAttention({})).toBe(true)   // no confidence reads as unidentified
  })
})

describe('movementSentence', () => {
  it('says what the file said and what we did', () => {
    expect(movementSentence(row())).toBe('Your file said spare parts. We filed it as tyres.')
  })

  it('does not claim the file said spare when it said nothing', () => {
    const s = movementSentence(row({ movement: 'unlabelled', erp_said: 'not stated' }))
    expect(s).toContain('left this blank')
    expect(s).not.toContain('spare')
  })

  it('reports agreement plainly', () => {
    expect(movementSentence(row({ movement: 'kept', we_said: 'spare' }))).toContain('We agreed')
  })
})

describe('summariseCountries', () => {
  it('computes a share per country and never a combined total', () => {
    const out = summariseCountries([
      { country: 'KSA', currency: 'SAR', total_rows: 100, moved_rows: 10, unlabelled_rows: 20 },
      { country: 'UAE', currency: 'AED', total_rows: 50, moved_rows: 5, unlabelled_rows: 0 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].moved_share).toBeCloseTo(0.1)
    expect(out[1].unlabelled_share).toBe(0)
    // each keeps its own currency; nothing here adds SAR to AED
    expect(out.map((c) => c.currency)).toEqual(['SAR', 'AED'])
  })

  it('returns a null share rather than 0 when there is nothing to divide by', () => {
    // 0% moved would read as "we checked and nothing moved"; null reads as
    // "there was nothing to check"
    expect(summariseCountries([{ country: 'KSA', total_rows: 0, moved_rows: 0 }])[0].moved_share).toBeNull()
  })

  it('drops junk rows', () => {
    expect(summariseCountries([null, {}, { country: 'KSA', total_rows: 1 }])).toHaveLength(1)
    expect(summariseCountries(null)).toEqual([])
  })
})

describe('override helpers', () => {
  it('maps every category to a real cost bucket', () => {
    for (const c of OVERRIDE_CATEGORIES) {
      expect(['tyre', 'oil', 'spare']).toContain(categoryBucket(c.value))
    }
  })

  it('knows when an override changes no total', () => {
    // correcting a gearbox to "filter" is a better record but the same money
    expect(overrideMovesMoney(row({ we_said: 'spare' }), 'filter')).toBe(false)
    expect(overrideMovesMoney(row({ we_said: 'spare' }), 'tyre')).toBe(true)
    expect(overrideMovesMoney(null, 'tyre')).toBe(false)
  })

  it('keys a row by its movement too, since one code can appear twice', () => {
    const a = decisionKey(row({ erp_said: 'spare', we_said: 'tyre' }))
    const b = decisionKey(row({ erp_said: 'tyre', we_said: 'tyre' }))
    expect(a).not.toBe(b)
  })
})

describe('sortDecisions', () => {
  const rows = [
    row({ item_code: 'B', value: 10, rows: 9, confidence: 0.95 }),
    row({ item_code: 'A', value: 500, rows: 1, confidence: 0.3 }),
    row({ item_code: 'C', value: -900, rows: 5, confidence: 0.9 }),
  ]

  it('puts the biggest money first, credit notes included', () => {
    // a -900 correction matters as much as a +900 charge
    expect(sortDecisions(rows, 'value').map((r) => r.item_code)).toEqual(['C', 'A', 'B'])
  })

  it('sorts least certain first, and an unreadable confidence leads', () => {
    // the row we know least about must not hide at the bottom
    const withUnknown = [...rows, row({ item_code: 'Z', confidence: undefined })]
    expect(sortDecisions(withUnknown, 'confidence')[0].item_code).toBe('Z')
  })

  it('supports lines and code', () => {
    expect(sortDecisions(rows, 'lines')[0].item_code).toBe('B')
    expect(sortDecisions(rows, 'code').map((r) => r.item_code)).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate the input and tolerates junk', () => {
    const src = [...rows]
    sortDecisions(src, 'value')
    expect(src.map((r) => r.item_code)).toEqual(['B', 'A', 'C'])
    expect(sortDecisions(null)).toEqual([])
    expect(sortDecisions(rows, 'nonsense')[0].item_code).toBe('C')  // falls back to value
  })

  it('offers every sort key it advertises', () => {
    for (const s of SORTS) expect(sortDecisions(rows, s.key)).toHaveLength(3)
  })
})

describe('labels', () => {
  it('never renders a raw code name to the user', () => {
    expect(reasonLabel('default')).toBe('Nothing identified it')
    expect(reasonLabel('reviewed-master')).toBe('You decided this')
    expect(bucketLabel('not stated')).toBe('Not stated in the file')
  })

  it('passes an unknown value through rather than hiding it', () => {
    expect(reasonLabel('something-new')).toBe('something-new')
    expect(bucketLabel(null)).toBe('N/A')
  })
})

// ── service boundary ─────────────────────────────────────────────────────────
const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const api = await import('../lib/api/classificationDecisions')

beforeEach(() => rpc.mockReset())

describe('getClassificationDecisions', () => {
  it('drops the All-countries token and passes the window', async () => {
    rpc.mockResolvedValue({ data: { ok: true, countries: [], items: [] }, error: null })
    await api.getClassificationDecisions({ country: 'All', view: 'kept', from: '2026-01-01' })
    expect(rpc).toHaveBeenCalledWith('get_classification_decisions', expect.objectContaining({
      p_country: null, p_view: 'kept', p_from: '2026-01-01', p_to: null,
    }))
  })

  it('degrades quietly on a backend without the view', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await expect(api.getClassificationDecisions({})).resolves.toMatchObject({ ok: false, items: [] })
  })

  it('still throws on a real failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(api.getClassificationDecisions({})).rejects.toBeTruthy()
  })

  it('never returns non-array items', async () => {
    rpc.mockResolvedValue({ data: { ok: true, countries: null, items: undefined }, error: null })
    const out = await api.getClassificationDecisions({})
    expect(out.items).toEqual([])
    expect(out.countries).toEqual([])
  })
})

describe('applyReviewedDecisions', () => {
  it('defaults to a DRY RUN, because this is the only path that moves loaded money', async () => {
    rpc.mockResolvedValue({ data: { rows_that_change: 3 }, error: null })
    await api.applyReviewedDecisions()
    expect(rpc).toHaveBeenCalledWith('reclassify_from_master', { p_dry_run: true })
  })

  it('applies for real only when explicitly told to', async () => {
    rpc.mockResolvedValue({ data: { rows_updated: 3 }, error: null })
    await api.applyReviewedDecisions(false)
    expect(rpc).toHaveBeenCalledWith('reclassify_from_master', { p_dry_run: false })
  })
})

describe('revertDecisionBatch', () => {
  it('refuses without a batch rather than calling the server', async () => {
    await expect(api.revertDecisionBatch(null)).rejects.toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })
})
