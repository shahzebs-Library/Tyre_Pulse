import { describe, it, expect } from 'vitest'
import { buildDamageRows, groupByDecision, decisionOf, attachPhotoLinks } from '../lib/aiDamageReport'

const insp = [{ id: 'i1', asset_no: 'TM1', site: 'NHC', inspection_date: '2026-10-01' }]
const job = (o) => ({ status: 'completed', tyre_position: 'LHF1', photo_ref: 'tp-storage://a', analysis: { defects: [{ type: 'cut', description: 'deep', severity: 'high' }] }, ...o })

describe('aiDamageReport', () => {
  it('segregates by supervisor decision and skips clean/incomplete jobs', () => {
    const jobs = { i1: [job({ review_status: 'accepted' }), job({ review_status: 'rejected' }), job({}), job({ review_status: 'corrected' }),
      job({ analysis: { defects: [] } }), job({ status: 'failed' })] }
    const g = groupByDecision(buildDamageRows(insp, jobs))
    expect(g.accepted).toHaveLength(1); expect(g.rejected).toHaveLength(1)
    expect(g.corrected).toHaveLength(1); expect(g.unreviewed).toHaveLength(1)
  })
  it('unknown review status counts as awaiting review', () => { expect(decisionOf({ review_status: 'weird' })).toBe('unreviewed') })
  it('photo links resolve once per ref and tolerate failures', async () => {
    let calls = 0
    const rows = await attachPhotoLinks([{ photo_ref: 'a' }, { photo_ref: 'a' }, { photo_ref: 'b' }],
      async (r) => { calls++; if (r === 'b') throw new Error('x'); return 'https://u/' + r })
    expect(calls).toBe(2); expect(rows[0].photo_link).toBe('https://u/a'); expect(rows[2].photo_link).toBe('Not available')
  })
})
