import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ rows: [], lifecycle: true, approve: null, auth: null }))

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => null }))
vi.mock('../components/ui/TableNotInUse', () => ({ default: () => null }))
vi.mock('../lib/api/knowledgeDocuments', () => ({
  listKnowledgeDocuments: async () => {
    const list = h.rows.slice()
    Object.defineProperty(list, 'lifecycle', { value: h.lifecycle, enumerable: false })
    Object.defineProperty(list, 'truncated', { value: false, enumerable: false })
    return list
  },
  deleteKnowledgeDocument: async () => null,
}))
vi.mock('../lib/api/knowledgeIngestion', () => ({
  extractDocument: vi.fn(),
  ingestDocument: vi.fn(),
  approveKnowledgeDocument: (...a) => h.approve(...a),
  withdrawKnowledgeDocument: vi.fn(async () => ({ ok: true })),
}))

const { default: KnowledgeBase } = await import('../pages/KnowledgeBase')

const parent = (extra = {}) => ({
  id: 'P1', chunk_of: null, chunk_count: 1, title: 'Tyre Pressure SOP', doc_type: 'sop', status: 'draft',
  version: 1, created_by: 'uploader', content: 'preview', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  embedding: null, ...extra,
})
const chunk = { id: 'C1', chunk_of: 'P1', chunk_index: 1, chunk_count: 0, title: 'Tyre Pressure SOP (part 1)', doc_type: 'sop', status: 'draft', page_from: 2, page_to: 2, created_at: new Date().toISOString(), embedding: null }

const renderPage = () => render(<MemoryRouter><KnowledgeBase /></MemoryRouter>)

beforeEach(() => {
  h.rows = [parent(), chunk]
  h.lifecycle = true
  h.approve = vi.fn(async () => ({ ok: true }))
  h.auth = { profile: { id: 'boss', role: 'Manager' }, user: { id: 'boss' }, isSuperAdmin: false }
})

describe('Knowledge Base lifecycle UI', () => {
  it('shows status and version, and lets another approver approve a draft', async () => {
    renderPage()
    expect((await screen.findAllByText('Tyre Pressure SOP')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    expect(screen.getAllByText('v1').length).toBeGreaterThan(0)
    const btn = screen.getByRole('button', { name: /^Approve$/ })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith('P1'))
  })

  it('blocks the uploader from approving their own document', async () => {
    h.auth = { profile: { id: 'uploader', role: 'Admin' }, user: { id: 'uploader' }, isSuperAdmin: false }
    renderPage()
    const btn = await screen.findByRole('button', { name: /^Approve$/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/cannot approve it\. Ask another approver/)).toBeInTheDocument()
  })

  it('warns when a review is overdue and offers a new version for approved documents', async () => {
    h.rows = [parent({ status: 'approved', review_due: '2020-01-01', approved_at: '2026-01-01T00:00:00Z' }), { ...chunk, embedding: true }]
    renderPage()
    expect((await screen.findAllByText(/Review overdue by/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/past the review date/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload new version/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Withdraw/ })).toBeInTheDocument()
  })

  it('says embeddings are not configured when chunks stay unindexed', async () => {
    h.rows = [parent(), { ...chunk, created_at: '2026-01-01T00:00:00Z' }]
    renderPage()
    expect(await screen.findByText(/Embeddings are not configured/)).toBeInTheDocument()
  })

  it('says the lifecycle is not installed on an older database', async () => {
    h.lifecycle = false
    h.rows = [{ id: 'L1', title: 'Old manual', doc_type: 'manual', created_at: '2026-11-01T00:00:00Z', embedding: true }]
    renderPage()
    expect(await screen.findByText(/not installed on the database yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add document/ })).toBeDisabled()
  })
})
