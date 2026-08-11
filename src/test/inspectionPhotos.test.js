import { describe, it, expect } from 'vitest'
import {
  toRefList, collectPhotoRefs, groupPhotos, gallerySummary, galleryState,
  galleryNotice, signatureView, prettyApproval, GROUP_POSITION, GROUP_GENERAL,
} from '../components/inspection/InspectionPhotos'

const REF = 'tp-storage://tyre-photos/a/b.jpg'

describe('toRefList', () => {
  it('reads a single ref', () => {
    expect(toRefList(REF)).toEqual([REF])
  })

  it('reads a JSON array, because photo_data has held one', () => {
    expect(toRefList(JSON.stringify(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('keeps a value that starts with [ but is not JSON, rather than losing a photo', () => {
    expect(toRefList('[not json')).toEqual(['[not json'])
  })

  it('treats absent and blank as no photo', () => {
    expect(toRefList(null)).toEqual([])
    expect(toRefList('')).toEqual([])
    expect(toRefList('   ')).toEqual([])
    expect(toRefList(undefined)).toEqual([])
  })

  it('drops blanks inside an array', () => {
    expect(toRefList(['a', '', null, ' b '])).toEqual(['a', 'b'])
  })
})

describe('collectPhotoRefs', () => {
  it('labels a position photo with the position it belongs to', () => {
    const out = collectPhotoRefs({
      tyre_conditions: { LHF1: { condition: 'Damage', photo_url: REF } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('LHF1')
    expect(out[0].group).toBe(GROUP_POSITION)
    expect(out[0].detail).toBe('Damage')
    expect(out[0].ref).toBe(REF)
  })

  it('prefers the recorded label over the raw position key', () => {
    const out = collectPhotoRefs({
      tyre_conditions: [{ position: 'p1', label: 'Left front', photo_uri: REF }],
    })
    expect(out[0].label).toBe('Left front')
  })

  it('keeps a photo on a position with no other reading, which the readings table drops', () => {
    // A wheel somebody only photographed still recorded something.
    const out = collectPhotoRefs({ tyre_conditions: { RHR2: { photo_url: REF } } })
    expect(out.map((p) => p.label)).toEqual(['RHR2'])
  })

  it('labels the row level photo as a general inspection photo', () => {
    const out = collectPhotoRefs({ photo_data: REF })
    expect(out[0].group).toBe(GROUP_GENERAL)
    expect(out[0].label).toBe('Inspection photo')
  })

  it('numbers general photos only when there is more than one', () => {
    const out = collectPhotoRefs({ photo_data: JSON.stringify(['a', 'b']) })
    expect(out.map((p) => p.label)).toEqual(['Inspection photo 1 of 2', 'Inspection photo 2 of 2'])
  })

  it('does not count the same ref twice when photo_data repeats custom_data', () => {
    const out = collectPhotoRefs({ photo_data: 'a', custom_data: { photos: ['a', 'b'] } })
    expect(out.map((p) => p.ref)).toEqual(['a', 'b'])
    expect(out.map((p) => p.label)).toEqual(['Inspection photo 1 of 2', 'Inspection photo 2 of 2'])
  })

  it('returns nothing for a row that carries no photo, and for no row at all', () => {
    expect(collectPhotoRefs({ tyre_conditions: { LHF1: { condition: 'Good' } } })).toEqual([])
    expect(collectPhotoRefs(null)).toEqual([])
  })

  it('gives every photo a distinct key so tiles cannot collide', () => {
    const out = collectPhotoRefs({
      tyre_conditions: { LHF1: { photo_url: 'a' }, RHF1: { photo_url: 'b' } },
      photo_data: JSON.stringify(['c', 'd']),
    })
    expect(new Set(out.map((p) => p.key)).size).toBe(4)
  })
})

describe('groupPhotos', () => {
  it('leads with position evidence and omits an empty group', () => {
    const out = groupPhotos(collectPhotoRefs({
      tyre_conditions: { LHF1: { photo_url: 'a' } },
      photo_data: 'b',
    }))
    expect(out.map((g) => g.key)).toEqual([GROUP_POSITION, GROUP_GENERAL])

    const generalOnly = groupPhotos(collectPhotoRefs({ photo_data: 'b' }))
    expect(generalOnly.map((g) => g.key)).toEqual([GROUP_GENERAL])
  })

  it('survives junk input', () => {
    expect(groupPhotos(null)).toEqual([])
  })
})

describe('gallerySummary', () => {
  it('counts ready, failed and still-signing separately', () => {
    const s = gallerySummary([
      { status: 'ready' }, { status: 'failed' }, { status: 'loading' }, { status: 'ready' },
    ])
    expect(s).toEqual({ total: 4, ready: 2, failed: 1, pending: 1 })
  })
})

describe('galleryState and galleryNotice', () => {
  it('separates "we could not look" from "nothing was taken"', () => {
    expect(galleryState(null, [])).toBe('unknown')
    expect(galleryState({}, [])).toBe('none')
    expect(galleryState({}, [{ ref: 'a' }])).toBe('photos')
  })

  it('says plainly that no photo was taken', () => {
    expect(galleryNotice('none', gallerySummary([]))).toBe(
      'No photos were taken on this inspection.',
    )
  })

  it('never lets an unloaded record read as an inspection without photos', () => {
    expect(galleryNotice('unknown', gallerySummary([]))).toMatch(/has not loaded/)
  })

  it('stays silent when every photo loaded', () => {
    expect(galleryNotice('photos', gallerySummary([{ status: 'ready' }]))).toBeNull()
  })

  it('states that the photos exist when none of them resolve', () => {
    const notice = galleryNotice('photos', gallerySummary([{ status: 'failed' }, { status: 'failed' }]))
    expect(notice).toContain('None of the 2 photos could be loaded')
    expect(notice).toContain('They were taken')
  })

  it('reports a partial failure with both counts', () => {
    expect(galleryNotice('photos', gallerySummary([{ status: 'failed' }, { status: 'ready' }])))
      .toBe('1 of 2 photos could not be loaded. The rest are shown below.')
  })
})

describe('signatureView', () => {
  it('renders a mobile SVG signature as an inert image data URL', () => {
    const v = signatureView('<svg viewBox="0 0 300 120"><path d="M0 0"/></svg>')
    expect(v.kind).toBe('image')
    expect(v.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('renders the web pad PNG data URL', () => {
    const v = signatureView('data:image/png;base64,AAAA')
    expect(v).toEqual({ kind: 'image', src: 'data:image/png;base64,AAAA' })
  })

  it('shows a legacy typed name as text, not a broken image', () => {
    expect(signatureView('A KHAN')).toEqual({ kind: 'typed', text: 'A KHAN' })
  })

  it('refuses a poisoned value outright', () => {
    // safeImageSrc rejects the scheme; a rejected value must not fall through
    // to the typed branch either, or the payload would render as text.
    expect(signatureView('data:text/html,<script>alert(1)</script>').kind).toBe('none')
    expect(signatureView('javascript:alert(1)').kind).toBe('none')
  })

  it('treats absent and blank as unsigned', () => {
    expect(signatureView(null).kind).toBe('none')
    expect(signatureView('   ').kind).toBe('none')
    expect(signatureView(42).kind).toBe('none')
  })
})

describe('prettyApproval', () => {
  it('turns a database token into a sentence', () => {
    expect(prettyApproval('pending_approval')).toBe('Pending approval')
    expect(prettyApproval('approved')).toBe('Approved')
  })

  it('returns null when there is no status', () => {
    expect(prettyApproval(null)).toBeNull()
    expect(prettyApproval('')).toBeNull()
  })
})
