/**
 * Focused tests for the checklist submission photo pipeline (lib/checklists.ts).
 *
 * REGRESSION GUARD: a checklist submits `photos` as Record<fieldId, string[]>,
 * but the record queue's photo pipeline (persistPayloadPhotos /
 * resolveCommandPhotos) both start with `Array.isArray(photos)` and therefore
 * SKIP a keyed map. Before submitChecklist resolved the map itself, a photo that
 * PhotoCapture could not upload at capture time (offline) was written into
 * checklist_submissions.photos as a raw device-local file:// path and never
 * uploaded - the submit reported success while the evidence was unreachable.
 *
 * checklists.ts imports native-backed modules (supabase, record queue, photo
 * upload, durable photo storage). Every one is mocked below so this stays inside
 * the pure Node + ts-jest project (no jest-expo, no native module ever loads)
 * per the note in jest.config.js.
 */

// ---- native-backed module mocks ----------------------------------------------
const saveCommand = jest.fn(
  async (_type: string, _payload: Record<string, any>, _key?: string) => ({ ok: true, offline: false }),
)
const uploadModulePhoto = jest.fn(
  async (_uri: string, _module: string, _i: number): Promise<string | null> => null,
)
const persistPhotoForQueue = jest.fn(
  async (_uri: string): Promise<{ localPath: string } | null> => null,
)

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }))
jest.mock('../lib/recordQueue', () => ({ saveCommand: (...a: any[]) => (saveCommand as any)(...a) }))
jest.mock('../lib/photoUpload', () => ({
  uploadModulePhoto: (...a: any[]) => (uploadModulePhoto as any)(...a),
}))
jest.mock('../lib/durablePhotos', () => ({
  persistPhotoForQueue: (...a: any[]) => (persistPhotoForQueue as any)(...a),
}))
jest.mock('../lib/ids', () => ({ safeUuid: () => 'sub-1111' }))

import { submitChecklist } from '../lib/checklists'
import type { ChecklistTemplate } from '../lib/checklists'

const template = {
  id: 'tpl-1', name: 'Daily Walkaround', status: 'published', version: 2,
  require_signature: false, require_approval: false, fields: [], country: 'KSA',
} as unknown as ChecklistTemplate

/** The payload the queue command actually received. */
function submittedPayload(): any {
  return saveCommand.mock.calls[0][1]
}

beforeEach(() => {
  saveCommand.mockClear()
  uploadModulePhoto.mockReset()
  persistPhotoForQueue.mockReset()
  uploadModulePhoto.mockResolvedValue(null)
  persistPhotoForQueue.mockResolvedValue(null)
})

describe('submitChecklist photo resolution', () => {
  it('uploads a pending local photo and submits the permanent ref, keyed by field', async () => {
    uploadModulePhoto.mockResolvedValue('tp-storage://tyre-photos/modules/checklist/u/1_0_ab.jpg')

    await submitChecklist({
      template,
      answers: { f1: 'ok' },
      photos: { f1: ['file:///cache/ImagePicker/shot.jpg'] },
    })

    // The photo must actually be uploaded, not handed to the queue as file://.
    expect(uploadModulePhoto).toHaveBeenCalledWith('file:///cache/ImagePicker/shot.jpg', 'checklist', 0)
    expect(submittedPayload().photos).toEqual({
      f1: ['tp-storage://tyre-photos/modules/checklist/u/1_0_ab.jpg'],
    })
  })

  it('keeps the local path when the upload fails, and never copies it into durable storage', async () => {
    // Still offline at submit: the upload cannot succeed. The answer must not be
    // dropped, so the local path is kept and the residual gap is honest.
    //
    // It must NOT be routed through persistPhotoForQueue: sweepOrphanQueuedPhotos
    // (recordQueue.ts, run after EVERY sync) builds its active set with the same
    // Array.isArray guard that causes this gap, so a keyed map never marks its
    // durable files as referenced and the sweep would delete them as orphans -
    // turning a likely loss into a guaranteed one. Closing this properly means
    // teaching recordQueue to walk Record<string, string[]>.
    await submitChecklist({
      template,
      answers: {},
      photos: { engine: ['file:///cache/ImagePicker/shot.jpg'] },
    })

    expect(uploadModulePhoto).toHaveBeenCalledWith('file:///cache/ImagePicker/shot.jpg', 'checklist', 0)
    expect(persistPhotoForQueue).not.toHaveBeenCalled()
    expect(submittedPayload().photos).toEqual({ engine: ['file:///cache/ImagePicker/shot.jpg'] })
  })

  it('passes already-permanent refs through untouched and never re-uploads them', async () => {
    await submitChecklist({
      template,
      answers: {},
      photos: { f1: ['tp-storage://tyre-photos/modules/checklist/u/a.jpg', 'https://cdn.example/b.jpg'] },
    })

    expect(uploadModulePhoto).not.toHaveBeenCalled()
    expect(persistPhotoForQueue).not.toHaveBeenCalled()
    expect(submittedPayload().photos).toEqual({
      f1: ['tp-storage://tyre-photos/modules/checklist/u/a.jpg', 'https://cdn.example/b.jpg'],
    })
  })

  it('resolves every field in the map and preserves the keyed shape the approval screen reads', async () => {
    uploadModulePhoto
      .mockResolvedValueOnce('tp-storage://a')
      .mockResolvedValueOnce('tp-storage://b')
      .mockResolvedValueOnce('tp-storage://c')

    await submitChecklist({
      template,
      answers: {},
      photos: {
        tyres: ['file:///cache/1.jpg', 'file:///cache/2.jpg'],
        lights: ['file:///cache/3.jpg'],
        empty: [],
      },
    })

    expect(submittedPayload().photos).toEqual({
      tyres: ['tp-storage://a', 'tp-storage://b'],
      lights: ['tp-storage://c'],
    })
    // Index feeds the storage filename, so it must advance across fields.
    expect(uploadModulePhoto.mock.calls.map(c => c[2])).toEqual([0, 1, 2])
  })

  it('submits an empty map (never undefined) when no photos were taken', async () => {
    await submitChecklist({ template, answers: {}, photos: {} })
    expect(submittedPayload().photos).toEqual({})
    expect(uploadModulePhoto).not.toHaveBeenCalled()
  })

  it('keeps the rest of the submission intact', async () => {
    uploadModulePhoto.mockResolvedValue('tp-storage://a')
    const res = await submitChecklist({
      template,
      answers: { f1: 'yes' },
      photos: { f1: ['file:///cache/1.jpg'] },
      site: 'NHC',
      asset_no: 'A-100',
      country: 'KSA',
    })

    expect(res).toEqual({ id: 'sub-1111', offline: false })
    const p = submittedPayload()
    expect(p.id).toBe('sub-1111')
    expect(p.template_id).toBe('tpl-1')
    expect(p.site).toBe('NHC')
    expect(p.asset_no).toBe('A-100')
    expect(p.answers).toEqual({ f1: 'yes' })
    expect(p.approval_status).toBe('not_required')
  })
})
