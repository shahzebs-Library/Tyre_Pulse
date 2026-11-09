import { describe, it, expect } from 'vitest'
import { fitWithin, shrinkImageForPdf, PDF_PHOTO_MAX_PX } from '../lib/pdfImage'

describe('pdf photo shrinking', () => {
  it('fits the long edge to the limit and keeps the aspect', () => {
    expect(fitWithin(1600, 1200)).toEqual({ width: PDF_PHOTO_MAX_PX, height: 450 })
    expect(fitWithin(1200, 1600)).toEqual({ width: 450, height: PDF_PHOTO_MAX_PX })
  })
  it('never upscales and rejects bad sizes', () => {
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(0, 100)).toBeNull()
    expect(fitWithin(null, 100)).toBeNull()
  })
  it('returns the original image when it cannot be re-encoded', async () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    await expect(shrinkImageForPdf(src, 'PNG', { timeoutMs: 50 })).resolves.toEqual({ dataUrl: src, fmt: 'PNG' })
    await expect(shrinkImageForPdf(null)).resolves.toEqual({ dataUrl: null, fmt: 'JPEG' })
  })
})
