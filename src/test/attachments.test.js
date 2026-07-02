import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  extractZip,
  matchAttachment,
  buildMatchRows,
  normaliseId,
  extOf,
  MAX_FILE_BYTES,
} from '../lib/import/attachments'

/** Build a staged accident row in the wizard's annotated shape. */
function row(transformed) {
  return { transformed }
}

describe('attachments - normaliseId', () => {
  it('strips separators, case, and folds Arabic-Indic digits', () => {
    expect(normaliseId('CLM-2024/00123')).toBe('clm202400123')
    expect(normaliseId('clm_2024 00123')).toBe('clm202400123')
    expect(normaliseId('CLM-2024/00123')).toBe(normaliseId('clm 2024 00123'))
    expect(normaliseId('١٢٣')).toBe('123') // Arabic-Indic
    expect(normaliseId(null)).toBe('')
  })
})

describe('attachments - extOf', () => {
  it('returns lower-case extension without dot', () => {
    expect(extOf('photo.JPG')).toBe('jpg')
    expect(extOf('a/b/report.PDF')).toBe('pdf')
    expect(extOf('noext')).toBe('')
    expect(extOf('.dotfile')).toBe('')
    expect(extOf('trailing.')).toBe('')
  })
})

describe('attachments - matchAttachment priority & normalisation', () => {
  const rows = [
    row({ insurance_claim_no: 'CLM-2024/00123', police_report_no: 'PR-9001', asset_no: 'A-12' }),
    row({ insurance_claim_no: 'CLM-2024/00999', police_report_no: 'PR-7777', asset_no: 'TRK-500' }),
  ]

  it('matches by claim no (separator/case insensitive)', () => {
    const m = matchAttachment('clm_2024_00123_front.jpg', rows)
    expect(m).toMatchObject({ rowIndex: 0, matchedBy: 'claim_no' })
  })

  it('prefers claim no over police report no when both could match', () => {
    // filename contains both row 0 claim and row 0 police report tokens
    const m = matchAttachment('CLM202400123-PR9001.pdf', rows)
    expect(m.matchedBy).toBe('claim_no')
    expect(m.rowIndex).toBe(0)
  })

  it('falls back to police report no when no claim matches', () => {
    const m = matchAttachment('police-report-PR7777.pdf', rows)
    expect(m).toMatchObject({ rowIndex: 1, matchedBy: 'police_report_no' })
  })

  it('falls back to asset no as lowest priority', () => {
    const m = matchAttachment('damage_TRK500_rear.png', rows)
    expect(m).toMatchObject({ rowIndex: 1, matchedBy: 'asset_no' })
  })

  it('returns null when nothing matches', () => {
    expect(matchAttachment('random_image.jpg', rows)).toBeNull()
    expect(matchAttachment('', rows)).toBeNull()
  })

  it('longer identifier wins at equal priority (specificity)', () => {
    const ambiguous = [
      row({ insurance_claim_no: '123' }),
      row({ insurance_claim_no: '12345' }),
    ]
    const m = matchAttachment('claim_12345.jpg', ambiguous)
    expect(m.rowIndex).toBe(1)
  })

  it('reads from mapped/top-level when transformed layer is absent', () => {
    const mapped = [{ mapped: { insurance_claim_no: 'CLM-1' } }]
    expect(matchAttachment('clm1.jpg', mapped)).toMatchObject({ rowIndex: 0, matchedBy: 'claim_no' })
    const top = [{ asset_no: 'ZZ-9' }]
    expect(matchAttachment('zz9.png', top)).toMatchObject({ rowIndex: 0, matchedBy: 'asset_no' })
  })
})

describe('attachments - buildMatchRows (unmatched is kept)', () => {
  const rows = [row({ insurance_claim_no: 'CLM-1', police_report_no: 'PR-1' })]

  it('records matched files with entity + matched status', () => {
    const items = [
      { file: { name: 'clm1.jpg' }, match: { rowIndex: 0, matchedBy: 'claim_no', matchValue: 'clm1' }, fileId: 'f1' },
    ]
    const out = buildMatchRows({ batchId: 'b1', items, rows })
    expect(out[0]).toMatchObject({
      batchId: 'b1', fileId: 'f1', matchKind: 'claim_no',
      matchedEntityType: 'accident', matchedEntityId: 'CLM-1', status: 'matched',
    })
    expect(out[0].matchKey).toBe('clm1jpg') // normalised full filename
  })

  it('keeps unmatched files with status unmatched and no entity', () => {
    const items = [{ file: { name: 'random.pdf' }, match: null, fileId: 'f2' }]
    const out = buildMatchRows({ batchId: 'b1', items, rows })
    expect(out[0]).toMatchObject({
      status: 'unmatched', matchKind: 'source_doc',
      matchedEntityType: null, matchedEntityId: null, fileId: 'f2',
    })
  })
})

describe('attachments - extractZip filtering', () => {
  async function makeZip(builder) {
    const zip = new JSZip()
    builder(zip)
    return zip.generateAsync({ type: 'blob' })
  }

  it('keeps allowed files, skips junk, dotfiles, and disallowed extensions', async () => {
    const blob = await makeZip((zip) => {
      zip.file('photos/front.jpg', 'JPGDATA')
      zip.file('report.pdf', 'PDFDATA')
      zip.file('quote.xlsx', 'XLSXDATA')
      zip.file('__MACOSX/._front.jpg', 'JUNK')
      zip.file('.DS_Store', 'JUNK')
      zip.file('notes.exe', 'BAD')
      zip.file('script.sh', 'BAD')
      zip.file('nested.zip', 'ZIPBYTES')
      zip.file('noext', 'NOEXT')
    })
    const { files, warnings } = await extractZip(blob)
    const names = files.map((f) => f.name).sort()
    expect(names).toEqual(['front.jpg', 'quote.xlsx', 'report.pdf'])
    // junk/dotfiles are silently skipped (no warning), disallowed extensions warn
    expect(warnings.some((w) => w.includes('notes.exe'))).toBe(true)
    expect(warnings.some((w) => w.includes('script.sh'))).toBe(true)
    expect(warnings.some((w) => w.includes('nested.zip'))).toBe(true)
    expect(warnings.some((w) => w.includes('noext'))).toBe(true)
  })

  it('assigns extension and a non-zero size to extracted files', async () => {
    const blob = await makeZip((zip) => zip.file('a.png', 'PNGDATA'))
    const { files } = await extractZip(blob)
    expect(files).toHaveLength(1)
    expect(files[0].ext).toBe('png')
    expect(files[0].sizeBytes).toBeGreaterThan(0)
    expect(files[0].blob).toBeInstanceOf(Blob)
  })

  it('exposes a sane per-file size cap', () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024)
  })
})
