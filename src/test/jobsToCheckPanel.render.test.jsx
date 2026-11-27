import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../contexts/LanguageContext'

const api = vi.hoisted(() => ({
  listJobCompletions: vi.fn(),
  decideJobCompletion: vi.fn(),
  getCompletionSignature: vi.fn(),
}))
vi.mock('../lib/api/jobCompletions', async () => {
  const real = await vi.importActual('../lib/api/jobCompletions')
  return { ...real, listJobCompletions: api.listJobCompletions, decideJobCompletion: api.decideJobCompletion, getCompletionSignature: api.getCompletionSignature }
})
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrlMap: vi.fn(async () => ({})) }))
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import JobsToCheckPanel from '../components/workshop/JobsToCheckPanel'
import { parseDecision } from '../lib/api/jobCompletions'

const waiting = {
  id: 'c-1', job_id: 'wo-1', status: 'submitted', kind: 'primary',
  work_order_no: 'GCKR/JC/1001/1126', asset_no: 'TM514', site: 'NHC',
  technician_name: 'SHARIF KHAN', completed_at: '2026-11-27T06:40:00Z',
  work_done: 'Replaced the brake pads', parts_used: [{ name: 'Brake pad set', qty: 2 }],
  after_photos: ['tp-storage://tyre-photos/a/b.jpg'], before_photos: [], km: 68420, engine_hours: null,
}

const mount = () => render(<LanguageProvider><JobsToCheckPanel /></LanguageProvider>)

describe('JobsToCheckPanel', () => {
  beforeEach(() => {
    api.listJobCompletions.mockReset()
    api.decideJobCompletion.mockReset()
    api.getCompletionSignature.mockReset()
    api.getCompletionSignature.mockResolvedValue(null)
  })

  it('reads the signature only when a completion is opened', async () => {
    api.listJobCompletions.mockResolvedValue({ rows: [waiting], provisioned: true })
    api.getCompletionSignature.mockResolvedValue('data:image/png;base64,AAAA')
    mount()
    const row = await screen.findByText('GCKR/JC/1001/1126')
    expect(api.getCompletionSignature).not.toHaveBeenCalled()
    fireEvent.click(row)
    await waitFor(() => expect(api.getCompletionSignature).toHaveBeenCalledWith('c-1'))
    expect(await screen.findByText("Technician's signature")).toBeTruthy()
  })

  it('a partial completion cannot be passed and says why; a held meter is shown', async () => {
    api.listJobCompletions.mockResolvedValue({ rows: [{ ...waiting, kind: 'partial', meter_held: { km: 'Odometer looks wrong.' } }], provisioned: true })
    mount()
    fireEvent.click(await screen.findByText('GCKR/JC/1001/1126'))
    expect(await screen.findByText(/other tasks of the job are still open/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pass and close' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Return' })).toBeTruthy()
    expect(screen.getByText(/Meter reading held for review/)).toBeTruthy()
  })

  it('lists a waiting completion and passes it through the RPC', async () => {
    api.listJobCompletions.mockResolvedValue({ rows: [waiting], provisioned: true })
    api.decideJobCompletion.mockResolvedValue({ ok: true, reason: null, status: 'approved' })
    mount()
    const row = await screen.findByText('GCKR/JC/1001/1126')
    fireEvent.click(row)
    expect(await screen.findByText('Brake pad set x2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pass and close' }))
    await waitFor(() => expect(api.decideJobCompletion).toHaveBeenCalledWith('c-1', 'pass', undefined))
    expect(await screen.findByText('Job passed and closed.')).toBeTruthy()
  })

  it('a return needs a reason; the server refusal is shown as is', async () => {
    api.listJobCompletions.mockResolvedValue({ rows: [waiting], provisioned: true })
    api.decideJobCompletion.mockResolvedValue({ ok: false, reason: 'Already passed by Mahmoud.', status: null })
    mount()
    fireEvent.click(await screen.findByText('GCKR/JC/1001/1126'))
    fireEvent.click(screen.getByRole('button', { name: 'Return' }))
    const send = screen.getByRole('button', { name: 'Return the job' })
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Why is it returned?'), { target: { value: 'Seal still leaks' } })
    fireEvent.click(send)
    await waitFor(() => expect(api.decideJobCompletion).toHaveBeenCalledWith('c-1', 'return', 'Seal still leaks'))
    expect(await screen.findByText('Already passed by Mahmoud.')).toBeTruthy()
  })

  it('says when the feature is not switched on yet', async () => {
    api.listJobCompletions.mockResolvedValue({ rows: [], provisioned: false })
    mount()
    expect(await screen.findByText('Job completion is not switched on yet.')).toBeTruthy()
  })
})

describe('jobCompletions service', () => {
  it('parses the RPC answer defensively', () => {
    expect(parseDecision(null).ok).toBe(false)
    expect(parseDecision({ ok: true, status: 'approved' })).toEqual({ ok: true, reason: null, status: 'approved' })
    expect(parseDecision({ ok: false, reason: '  Nope.  ' }).reason).toBe('Nope.')
  })

  it('the list query does not carry the signature', async () => {
    const src = (await import('node:fs')).readFileSync('src/lib/api/jobCompletions.js', 'utf8')
    const cols = src.match(/const COLS =([\s\S]*?)\n\/\//)[1]
    expect(cols).not.toMatch(/signature/)
  })

  it('refuses a return with no reason before calling the server', async () => {
    const real = await vi.importActual('../lib/api/jobCompletions')
    const answer = await real.decideJobCompletion('c-1', 'return', '  ')
    expect(answer.ok).toBe(false)
  })
})
