import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../lib/api/customData', () => ({
  getExtraFieldStats: async () => { throw Object.assign(new Error('denied'), { code: '42501' }) },
  listRecordsWithExtraFields: async () => ({ data: [], count: 0 }),
  listFieldSynonyms: async () => [],
  createFieldSynonym: vi.fn(), listTyreRecordsForBackfill: vi.fn(), listTyreRecordsForExport: vi.fn(), updateTyreRecordFields: vi.fn(),
}))
vi.mock('../lib/api/imports', () => ({ listAllProfiles: async () => [], setProfileActive: vi.fn() }))
vi.mock('../lib/api/auditTrailOverview', () => ({ listImportBatches: async () => [{ id: 'b1', import_status: 'committed', total_rows: 4, imported_rows: 4, conflict_rows: 3, country: null }] }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin', id: 'u1' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }))
vi.mock('../components/ui/EnterpriseTable', () => ({ default: ({ error, emptyMessage, data }) => <div>{error || (data?.length ? `rows:${data.length}` : emptyMessage)}</div> }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), reportFileName: () => 'x', reportDateLabel: () => 'y' }))
import CustomData from '../pages/CustomData'

it('a failed field read shows an error and N/A, not zero fields', async () => {
  render(<MemoryRouter><CustomData /></MemoryRouter>)
  expect(await screen.findAllByText('Could not be read')).not.toHaveLength(0)
  expect(screen.queryByText(/No custom fields yet/)).not.toBeInTheDocument()
  expect(await screen.findByText('3')).toBeInTheDocument() // conflict rows from the batch
  expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2)
})
