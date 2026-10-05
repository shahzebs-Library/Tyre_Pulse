import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ error: { message: 'permission denied', code: '42501' }, role: 'Admin' }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const q = { then: (resolve, reject) => Promise.resolve({ data: null, count: null, error: state.error }).then(resolve, reject) }
  for (const m of ['select', 'order', 'range', 'gte', 'lt', 'eq', 'in']) q[m] = () => q
  return q
}, rpc: vi.fn() } }))
vi.mock('../lib/api/auditTrail', () => ({
  auditQuery: () => ({ range: async () => ({ data: null, error: state.error }) }),
  uploadHistoryQuery: () => ({ range: async () => ({ data: null, error: state.error }) }),
  readAuditExport: vi.fn(), matchesAuditSearch: () => true, listAccessAudit: vi.fn(async () => []),
}))
vi.mock('../lib/api/auditTrailOverview', () => ({
  loadAuditCounts: async () => ({ events: null, security: null, changes: null, deletes: null, uploads: null, batches: null, error: 'Some audit figures could not be read.' }),
  listImportBatches: async () => [],
  loadReviews: async () => ({ provisioned: false, open: null, byAudit: {} }),
  flagAuditEvent: vi.fn(), setReviewStatus: vi.fn(),
}))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: async () => ({ data: [], error: null }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: state.role }, isSuperAdmin: false }) }))
vi.mock('../components/ui/EnterpriseTable', () => ({ default: ({ error, emptyMessage }) => <div>{error || emptyMessage}</div> }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }))
import AuditTrail from '../pages/AuditTrail'
import { toUserMessage } from '../lib/safeError'

it('failed reads show errors and N/A figures, never an empty log or zero', async () => {
  render(<AuditTrail />)
  expect(await screen.findByText('Some audit figures could not be read.')).toBeInTheDocument()
  expect(await screen.findByText(toUserMessage(state.error, 'Audit events could not be loaded.'))).toBeInTheDocument()
  expect(screen.queryByText('No audit events in this period.')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(4))
  expect(screen.getByText('High severity (rule based). Review flags not set up yet')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Exports/ })).toBeInTheDocument()
})

it('a role the audit RLS refuses is told so instead of seeing an empty log', async () => {
  state.role = 'Reporter'
  render(<AuditTrail />)
  expect(await screen.findByText('Your role cannot read the audit log.')).toBeInTheDocument()
  expect(screen.queryByText('No audit events in this period.')).not.toBeInTheDocument()
  state.role = 'Admin'
})
