import { describe, expect, it } from 'vitest'
import { submissionTarget } from '../lib/checklistMonthly'

const fields = [
  { id: 'f_asset', type: 'asset' },
  { id: 'f_site', type: 'site' },
]

describe('submissionTarget', () => {
  it('recovers asset and site from legacy checklist answers', () => {
    expect(submissionTarget({ answers: { f_asset: 'MP123', f_site: 'NHC' } }, fields))
      .toEqual({ assetNo: 'MP123', site: 'NHC' })
  })

  it('keeps explicit submission metadata when both forms exist', () => {
    expect(submissionTarget({
      asset_no: 'TM548', site: 'DIRIYAH-G1',
      answers: { f_asset: 'OLD', f_site: 'OLD SITE' },
    }, fields)).toEqual({ assetNo: 'TM548', site: 'DIRIYAH-G1' })
  })
})
