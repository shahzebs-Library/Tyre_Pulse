import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const api = vi.hoisted(() => ({ look: null, versions: [], throwNotProvisioned: false }))
vi.mock('../lib/api/pdfCache', () => ({
  isPdfCacheNotProvisioned: (e) => e?.code === 'PDF_CACHE_NOT_PROVISIONED',
  lookupPdf: vi.fn(async () => {
    if (api.throwNotProvisioned) { const e = new Error('x'); e.code = 'PDF_CACHE_NOT_PROVISIONED'; throw e }
    return api.look
  }),
  listPdfVersions: vi.fn(async () => api.versions),
  signedPdfUrl: vi.fn(async () => 'https://signed.example/x.pdf'),
  recordPdfDownload: vi.fn(async () => null),
}))

import StoredPdfPanel from '../components/pdf/StoredPdfPanel'
import * as pdfApi from '../lib/api/pdfCache'

const req = () => Promise.resolve({ type: 'tyre_inspection', sourceId: 's1', brandingRev: 'b-1', clientRev: '' })
const file = { id: 'f1', path: 'o/t/s/k.pdf', file_name: 'Tyre Insp X.pdf', bytes: 300000, sha256: 'a'.repeat(64), completed_at: '2026-11-15T09:00:00Z', immutable: true }

beforeEach(() => { api.look = null; api.versions = []; api.throwNotProvisioned = false; vi.clearAllMocks() })

describe('StoredPdfPanel', () => {
  it('renders nothing before the database migration is applied', async () => {
    api.throwNotProvisioned = true
    const { container } = render(<StoredPdfPanel buildRequest={req} refreshKey="a" />)
    await waitFor(() => expect(pdfApi.lookupPdf).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('Ready: shows the stored copy, View PDF and that an approved revision is locked', async () => {
    api.look = { ok: true, state: 'ready', file, previous: null }
    api.versions = [{ id: 'f1', storage_path: file.path, completed_at: file.completed_at, immutable: true }]
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<StoredPdfPanel buildRequest={req} refreshKey="a" canRegenerate isAdmin={false} onRegenerate={vi.fn()} />)
    expect(await screen.findByText('Ready')).toBeTruthy()
    expect(screen.getByText('Approved revision, locked')).toBeTruthy()
    // a manager is not offered Regenerate on an approved revision
    expect(screen.queryByRole('button', { name: /Regenerate latest/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /View PDF/ }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/x.pdf', '_blank', 'noopener,noreferrer'))
    expect(screen.queryByText(/Previous stored versions/)).toBeNull()
    open.mockRestore()
  })

  it('Update available: the older copy is listed as previous and never called current', async () => {
    api.look = { ok: true, state: 'missing', file: null, previous: { id: 'old' } }
    api.versions = [{ id: 'old', storage_path: 'o/t/s/old.pdf', completed_at: '2026-11-10T09:00:00Z', immutable: false, bytes: 200000 }]
    render(<StoredPdfPanel buildRequest={req} refreshKey="a" />)
    expect(await screen.findByText('Update available')).toBeTruthy()
    expect(screen.getByText(/Previous stored versions \(1\), not current/)).toBeTruthy()
    expect(screen.queryByText('Ready')).toBeNull()
    expect(screen.queryByRole('button', { name: /View PDF/ })).toBeNull()
  })

  it('an administrator must give a reason to replace an approved copy', async () => {
    api.look = { ok: true, state: 'ready', file, previous: null }
    const onRegenerate = vi.fn(async () => {})
    render(<StoredPdfPanel buildRequest={req} refreshKey="a" canRegenerate isAdmin onRegenerate={onRegenerate} />)
    fireEvent.click(await screen.findByRole('button', { name: /Regenerate latest/ }))
    const replace = screen.getByRole('button', { name: 'Regenerate' })
    expect(replace.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Reason for regenerating/), { target: { value: 'Logo was missing' } })
    fireEvent.click(replace)
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith({ reason: 'Logo was missing' }))
  })

  it('a manager is offered Regenerate on an approved report only when the server says he is authorised', async () => {
    api.look = { ok: true, state: 'ready', file, previous: null, can_regenerate: true, can_regenerate_approved: false }
    const { unmount } = render(<StoredPdfPanel buildRequest={req} refreshKey="a" canRegenerate isAdmin={false} onRegenerate={vi.fn()} />)
    expect(await screen.findByText('Ready')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Regenerate latest/ })).toBeNull()
    unmount()
    api.look = { ...api.look, can_regenerate_approved: true }
    const onRegenerate = vi.fn(async () => {})
    render(<StoredPdfPanel buildRequest={req} refreshKey="b" canRegenerate isAdmin={false} onRegenerate={onRegenerate} />)
    fireEvent.click(await screen.findByRole('button', { name: /Regenerate latest/ }))
    // never without a reason, and the wording says the original is kept
    expect(onRegenerate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/the approved original is kept/)).toBeTruthy()
  })

  it('a regenerated approved revision is listed with its reason beside the original', async () => {
    api.look = { ok: true, state: 'ready', file: { ...file, id: 'f2', regenerated_from: 'f1' }, previous: null, can_regenerate_approved: false }
    api.versions = [
      { id: 'f2', storage_path: 'o/t/s/k.g2.pdf', completed_at: '2026-11-15T10:00:00Z', immutable: true, regenerated_from: 'f1', regenerate_reason: 'Customer asked for a fresh print' },
      { id: 'f1', storage_path: file.path, completed_at: file.completed_at, immutable: true },
    ]
    render(<StoredPdfPanel buildRequest={req} refreshKey="a" />)
    expect(await screen.findByText('Approved revision (regenerated), locked')).toBeTruthy()
    expect(screen.getByText(/Previous stored versions \(1\), not current/)).toBeTruthy()
    expect(screen.getByText(/approved revision/)).toBeTruthy()
  })

  it('re-reads only when refreshKey changes, not on every render', async () => {
    api.look = { ok: true, state: 'failed', file: null, previous: null }
    const { rerender } = render(<StoredPdfPanel buildRequest={() => req()} refreshKey="a" />)
    expect(await screen.findByText('Failed')).toBeTruthy()
    rerender(<StoredPdfPanel buildRequest={() => req()} refreshKey="a" />)
    rerender(<StoredPdfPanel buildRequest={() => req()} refreshKey="a" />)
    expect(pdfApi.lookupPdf).toHaveBeenCalledTimes(1)
    rerender(<StoredPdfPanel buildRequest={() => req()} refreshKey="b" />)
    await waitFor(() => expect(pdfApi.lookupPdf).toHaveBeenCalledTimes(2))
  })
})
