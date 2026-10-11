import { describe, it, expect } from 'vitest'
import { makeEnglishT, toAscii } from '../lib/workshopStatus/pdfText'
import enWs from '../locales/en/workshopStatus.json'
import enRm from '../locales/en/workshopStatusRemoved.json'

describe('pdfText', () => {
  it('folds typographic punctuation to ASCII', () => {
    expect(toAscii('A — B – C “q” …')).toBe('A - B - C "q" ...')
    expect(toAscii(5)).toBe(5)
  })

  it('reads English keys with placeholders and shows a missing key', () => {
    const t = makeEnglishT({ a: { days: '{n} days', title: 'X — Y' } }, 'a')
    expect(t('days', { n: 4 })).toBe('4 days')
    expect(t('title')).toBe('X - Y')
    expect(t('missing')).toBe('missing')
  })

  it('every label the PDF exports use exists in English and is ASCII', () => {
    const a = makeEnglishT(enWs, 'active')
    const r = makeEnglishT(enRm)
    const keys = [
      [a, ['exportTitle', 'summaryTitle', 'summaryCol.section', 'summaryCol.item', 'summaryCol.count', 'summaryCol.share',
        'summaryEmpty', 'summaryTruncated', 'na', 'notAssigned', 'unknownPerson', 'systemUser',
        'col.asset', 'col.country', 'col.site', 'col.daysDown', 'col.stage', 'col.delayReason', 'col.partsStatus',
        'col.responsible', 'col.expectedRelease', 'col.lastUpdated']],
      [r, ['exportTitle', 'na', 'upload', 'noDisposition', 'truncated', 'status.released', 'status.archived',
        'col.asset_no', 'col.removed_at', 'col.disposition']],
    ]
    for (const [t, list] of keys) {
      for (const k of list) {
        const v = t(k)
        expect(v, k).not.toBe(k)
        expect(v, k).toMatch(/^[\x00-\x7F]*$/)
      }
    }
  })
})
