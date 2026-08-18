/**
 * The record queue's photo pipeline must handle BOTH photo shapes.
 *
 * WHY THIS EXISTS. A command payload's `photos` is either a flat `string[]`
 * (tyre change, RCA, report issue, wash, accident) or a keyed
 * `Record<fieldId, string[]>` - the shape a CHECKLIST submits, because that is
 * what checklist_submissions.photos stores and what the approval screen reads.
 *
 * All three photo steps used to begin with `Array.isArray(photos)`, so a keyed
 * map fell through every one of them:
 *
 *   1. persistPayloadPhotos never copied the photo out of the OS cache into
 *      durable document storage, so Android was free to purge the bytes before
 *      the queued upload ever ran.
 *   2. resolveCommandPhotos never uploaded it, so the row was inserted with a
 *      dead device-local file:// path. The submit reported success while the
 *      evidence was unreachable for everyone.
 *   3. sweepOrphanQueuedPhotos, which runs after EVERY sync, never marked the
 *      map's files as referenced - so had (1) ever been "helpfully" fixed on its
 *      own, the sweep would have deleted them as orphans and turned a likely
 *      loss into a certain one.
 *
 * That is a checklist filled in offline - the exact case a field app exists for.
 * None of it is visible to tsc or to a render test: every shape compiles, and
 * the array path works perfectly, so the bug only appears on the branch nobody
 * exercised. Hence these tests drive the real functions with the native-backed
 * modules mocked, per the note in jest.config.js.
 */

// ---- native-backed module mocks ----------------------------------------------
const store: Record<string, string> = {}
const uploadModulePhoto = jest.fn(async (_uri: string, _m: string, _i: number): Promise<string | null> => null)
const persistPhotoForQueue = jest.fn(async (uri: string): Promise<{ localPath: string; size: number; mimeType: string; checksum: string; createdAt: number } | null> => ({
  localPath: `file:///docs/queued-photos/q_${uri.split('/').pop()}`,
  size: 10, mimeType: 'image/jpeg', checksum: 'c', createdAt: 1,
}))
const cleanupOrphanDurablePhotos = jest.fn((_active: Iterable<string>) => {})
const deleteDurablePhoto = jest.fn((_uri: string | null | undefined) => {})

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }))
jest.mock('../lib/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => (k in store ? store[k] : null),
    setItem: async (k: string, v: string) => { store[k] = v },
    removeItem: async (k: string) => { delete store[k] },
  },
}))
jest.mock('../lib/photoUpload', () => ({
  uploadModulePhoto: (...a: any[]) => (uploadModulePhoto as any)(...a),
}))
jest.mock('../lib/durablePhotos', () => ({
  persistPhotoForQueue: (...a: any[]) => (persistPhotoForQueue as any)(...a),
  resolveDurablePath: (u: string) => u,
  deleteDurablePhoto: (...a: any[]) => (deleteDurablePhoto as any)(...a),
  cleanupOrphanDurablePhotos: (...a: any[]) => (cleanupOrphanDurablePhotos as any)(...a),
  isDurablePhotoPath: (u: string | null | undefined) => !!u && u.includes('/queued-photos/'),
}))

import {
  enqueueCommand, getRecordQueue, sweepOrphanQueuedPhotos,
  readPhotoBag, writePhotoBag,
} from '../lib/recordQueue'

const CACHE = 'file:///cache/ImagePicker/shot.jpg'
const DURABLE = 'file:///docs/queued-photos/q_shot.jpg'

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  uploadModulePhoto.mockClear()
  persistPhotoForQueue.mockClear()
  cleanupOrphanDurablePhotos.mockClear()
  deleteDurablePhoto.mockClear()
})

describe('readPhotoBag / writePhotoBag', () => {
  it('reads a flat array and rebuilds a flat array', () => {
    const bag = readPhotoBag(['a', 'b'])!
    expect(bag.flat).toEqual(['a', 'b'])
    expect(writePhotoBag(bag, ['x', 'y'])).toEqual(['x', 'y'])
  })

  it('reads a keyed map and rebuilds the SAME keyed shape', () => {
    const bag = readPhotoBag({ tyres: ['a', 'b'], lights: ['c'] })!
    // Flattened in key order so a positional transform stays aligned.
    expect(bag.flat).toEqual(['a', 'b', 'c'])
    expect(writePhotoBag(bag, ['A', 'B', 'C'])).toEqual({ tyres: ['A', 'B'], lights: ['C'] })
  })

  it('drops only the entries the transform returned null for, keeping alignment', () => {
    const bag = readPhotoBag({ tyres: ['a', 'b'], lights: ['c'] })!
    expect(writePhotoBag(bag, ['A', null, 'C'])).toEqual({ tyres: ['A'], lights: ['C'] })
    // A field left with nothing must not survive as an empty array.
    expect(writePhotoBag(bag, [null, null, 'C'])).toEqual({ lights: ['C'] })
    // Nothing left at all is null, matching what the flat path has always done.
    expect(writePhotoBag(bag, [null, null, null])).toBeNull()
  })

  it('treats empty and non-photo values as "no photos" rather than rewriting them', () => {
    expect(readPhotoBag(null)).toBeNull()
    expect(readPhotoBag(undefined)).toBeNull()
    expect(readPhotoBag([])).toBeNull()
    expect(readPhotoBag({})).toBeNull()
    expect(readPhotoBag({ f1: [] })).toBeNull()
    expect(readPhotoBag('not-a-bag')).toBeNull()
    // An unknown value type is ignored, never guessed at.
    expect(readPhotoBag({ f1: 'oops' })).toBeNull()
  })
})

describe('enqueue persists photos durably in BOTH shapes', () => {
  it('copies a keyed checklist map out of the OS cache', async () => {
    await enqueueCommand('CHECKLIST_SUBMISSION', {
      id: 's1', template_id: 't1', answers: {},
      photos: { engine: [CACHE] },
    }, 'k1')

    expect(persistPhotoForQueue).toHaveBeenCalledWith(CACHE)
    const q = await getRecordQueue()
    // Still keyed - the approval screen reads this shape - but now durable.
    expect(q[0].payload.photos).toEqual({ engine: [DURABLE] })
    expect(q[0].photos_meta).toHaveLength(1)
  })

  it('still copies a flat array exactly as before', async () => {
    await enqueueCommand('REPORT_ISSUE', { id: 'r1', photos: [CACHE] }, 'k2')
    expect(persistPhotoForQueue).toHaveBeenCalledWith(CACHE)
    const q = await getRecordQueue()
    expect(q[0].payload.photos).toEqual([DURABLE])
  })

  it('keeps the record when a photo cannot be persisted, dropping only that photo', async () => {
    persistPhotoForQueue.mockResolvedValueOnce(null)
    await enqueueCommand('CHECKLIST_SUBMISSION', {
      id: 's2', template_id: 't1', answers: { a: 1 }, photos: { engine: [CACHE] },
    }, 'k3')
    const q = await getRecordQueue()
    expect(q).toHaveLength(1)
    expect(q[0].payload.answers).toEqual({ a: 1 })
    expect(q[0].payload.photos).toBeNull()
  })

  it('leaves an already-permanent ref untouched and never re-copies it', async () => {
    await enqueueCommand('CHECKLIST_SUBMISSION', {
      id: 's3', template_id: 't1', answers: {},
      photos: { engine: ['tp-storage://tyre-photos/modules/checklist/u/a.jpg'] },
    }, 'k4')
    expect(persistPhotoForQueue).not.toHaveBeenCalled()
    const q = await getRecordQueue()
    expect(q[0].payload.photos).toEqual({ engine: ['tp-storage://tyre-photos/modules/checklist/u/a.jpg'] })
  })
})

describe('the orphan sweep sees photos in BOTH shapes', () => {
  it('marks a pending keyed map as still referenced', async () => {
    await sweepOrphanQueuedPhotos([
      { sync_status: 'pending', payload: { photos: { engine: [DURABLE] } } } as any,
    ])
    // If this set is empty the sweep deletes the file while the record is still
    // queued - a guaranteed loss of the inspector's evidence.
    expect([...cleanupOrphanDurablePhotos.mock.calls[0][0]]).toEqual([DURABLE])
  })

  it('marks a pending flat array as still referenced', async () => {
    await sweepOrphanQueuedPhotos([
      { sync_status: 'pending', payload: { photos: [DURABLE] } } as any,
    ])
    expect([...cleanupOrphanDurablePhotos.mock.calls[0][0]]).toEqual([DURABLE])
  })

  it('does NOT protect a record that already synced', async () => {
    await sweepOrphanQueuedPhotos([
      { sync_status: 'synced', payload: { photos: { engine: [DURABLE] } } } as any,
    ])
    expect([...cleanupOrphanDurablePhotos.mock.calls[0][0]]).toEqual([])
  })
})
