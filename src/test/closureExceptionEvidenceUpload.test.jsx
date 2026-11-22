/**
 * The exception evidence photograph could not be exercised in the browser test run
 * (the local e2e stack has no storage), so this pins the same path end to end in
 * jsdom: pick a photograph in the request form, the browser shrinks it to a data
 * URL, and the request reaches the database function with the call shape
 * corrective_action_request_exception(p_id uuid, p_reason text, p_evidence jsonb).
 *
 * Only the reads are stubbed. requestException is the real service function, so a
 * change to the argument names or the evidence array would fail here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc, from: vi.fn() } }))
vi.mock('../lib/api/closureReview', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    getActionReviewAccess: vi.fn(),
    getActionReview: vi.fn(async () => ({ provisioned: true, review: null })),
    listActionReviewEvents: vi.fn(async () => []),
  }
})
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' }),
}))

import ClosureReviewPanel from '../components/correctiveActions/ClosureReviewPanel'
import { getActionReviewAccess } from '../lib/api/closureReview'
import { accessFromServer } from '../lib/closureWorkflow'

const ACTION_ID = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHRUNK = 'data:image/jpeg;base64,SHRUNK'

let realImage, realCreate, realRevoke, getCtx, toUrl

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { ok: true }, error: null })
  getActionReviewAccess.mockResolvedValue({
    provisioned: true,
    ...accessFromServer({ ok: true, is_reviewer: true, can_request_exception: true, waiting_on: 'worker' }),
  })
  // jsdom never decodes images or paints a canvas; stand in for the browser so the
  // real shrinkPhoto runs (object URL, Image load, canvas resize, JPEG data URL).
  realImage = globalThis.Image
  realCreate = URL.createObjectURL
  realRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:local/photo')
  URL.revokeObjectURL = vi.fn()
  globalThis.Image = class {
    constructor() { this.width = 4000; this.height = 3000 }
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()) }
    get src() { return this._src }
  }
  getCtx = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  toUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(SHRUNK)
})

afterEach(() => {
  globalThis.Image = realImage
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  getCtx.mockRestore()
  toUrl.mockRestore()
})

async function openForm() {
  render(<ClosureReviewPanel action={{ id: ACTION_ID, status: 'In Progress', review_status: null }} />)
  fireEvent.click(await screen.findByText('closure.review.requestLink'))
  fireEvent.change(screen.getByLabelText('closure.review.requestReasonLabel'), {
    target: { value: 'Tyre held for supplier warranty check' },
  })
}

describe('exception request with an evidence photograph', () => {
  it('uploads the photograph and sends (uuid, text, jsonb) to the database function', async () => {
    await openForm()
    const file = new File(['jpeg-bytes'], 'tread.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('exception-evidence-input'), { target: { files: [file] } })
    // The shrunk photograph is shown in the form before it is sent.
    await waitFor(() => expect(document.querySelector(`img[src="${SHRUNK}"]`)).toBeTruthy())
    expect(toUrl).toHaveBeenCalledWith('image/jpeg', 0.6)

    fireEvent.click(screen.getByText('closure.review.requestBtn'))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))

    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('corrective_action_request_exception')
    expect(Object.keys(args).sort()).toEqual(['p_evidence', 'p_id', 'p_reason'])
    expect(args.p_id).toMatch(UUID)
    expect(typeof args.p_reason).toBe('string')
    expect(args.p_reason).toBe('Tyre held for supplier warranty check')
    // jsonb: a JSON array of strings that survives a round trip unchanged.
    expect(Array.isArray(args.p_evidence)).toBe(true)
    expect(args.p_evidence).toEqual([SHRUNK])
    expect(JSON.parse(JSON.stringify(args.p_evidence))).toEqual([SHRUNK])
  })

  it('sends an empty jsonb array when no photograph is attached', async () => {
    await openForm()
    fireEvent.click(screen.getByText('closure.review.requestBtn'))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc.mock.calls[0][1]).toEqual({
      p_id: ACTION_ID, p_reason: 'Tyre held for supplier warranty check', p_evidence: [],
    })
  })

  it('keeps at most 6 photographs whatever is picked', async () => {
    await openForm()
    const files = Array.from({ length: 8 }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }))
    fireEvent.change(screen.getByTestId('exception-evidence-input'), { target: { files } })
    await waitFor(() => expect(toUrl).toHaveBeenCalledTimes(6))
    fireEvent.click(screen.getByText('closure.review.requestBtn'))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc.mock.calls[0][1].p_evidence).toHaveLength(6)
  })
})
