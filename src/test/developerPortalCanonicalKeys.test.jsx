import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { shapeCanonicalKey } from '../lib/developerPortal'

// ---- a thenable PostgREST builder recording every table touched ------------
const tables = []
let listRows = []
const rpc = vi.fn()
function builder(table) {
  tables.push(table)
  const b = {
    select: () => b, order: () => b, limit: () => b, eq: () => b, maybeSingle: () => b,
    then: (res, rej) => Promise.resolve({ data: table === 'api_keys' ? listRows : [], error: null }).then(res, rej),
  }
  return b
}
vi.mock('../lib/api/_client', () => ({
  supabase: { from: (t) => builder(t), rpc: (...a) => rpc(...a) },
  unwrap: (r) => { if (r.error) throw r.error; return r.data },
  applyCountry: (q) => q,
  isMissingRelation: () => false,
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title, actions }) => <div><h1>{title}</h1>{actions}</div> }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }))

import { listApiKeys, createApiKey, updateApiKey, deleteApiKey, API_KEY_COLS } from '../lib/api/developerPortal'
import DeveloperPortal from '../pages/DeveloperPortal'

const ROW = { id: 'k1', name: 'ERP sync', key_prefix: 'tp_ab12cd3', scopes: ['read'], active: true, rate_per_minute: 60, created_at: '2026-09-01T00:00:00Z', last_used_at: null, expires_at: null }

beforeEach(() => { tables.length = 0; rpc.mockReset(); listRows = [] })

describe('shapeCanonicalKey', () => {
  it('maps the canonical api_keys row onto the portal shape honestly', () => {
    expect(shapeCanonicalKey(ROW)).toMatchObject({
      id: 'k1', key_name: 'ERP sync', key_prefix: 'tp_ab12cd3', scopes: 'read',
      environment: 'production', status: 'active', rate_limit: 60, created_label: null,
    })
    expect(shapeCanonicalKey({ ...ROW, active: false }).status).toBe('revoked')
    expect(shapeCanonicalKey({ ...ROW, revoked_at: '2026-09-02T00:00:00Z' }).status).toBe('revoked')
    expect(shapeCanonicalKey(null).id).toBeNull()
  })
})

describe('developerPortal keys service (one key system)', () => {
  it('reads the canonical api_keys table, never developer_api_keys, and never key_hash', async () => {
    listRows = [ROW]
    const rows = await listApiKeys()
    expect(tables).toEqual(['api_keys'])
    expect(API_KEY_COLS).not.toMatch(/key_hash/)
    expect(rows[0].key_name).toBe('ERP sync')
  })

  it('mints through create_api_key with the read scope', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'k2', key: 'tp_secret', prefix: 'tp_secret' }, error: null })
    const r = await createApiKey({ key_name: '  Payroll  ', expires_at: '' })
    expect(rpc).toHaveBeenCalledWith('create_api_key', { p_name: 'Payroll', p_scopes: ['read'], p_expires_at: null })
    expect(r.key).toBe('tp_secret')
    await expect(createApiKey({ key_name: '' })).rejects.toThrow(/name is required/)
    await expect(createApiKey({ key_name: 'x', expires_at: '2000-01-01' })).rejects.toThrow(/future/)
  })

  it('revokes instead of deleting and refuses edits', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await deleteApiKey('k1')
    expect(rpc).toHaveBeenCalledWith('revoke_api_key', { p_id: 'k1' })
    await expect(updateApiKey('k1', { key_name: 'new' })).rejects.toThrow(/cannot be edited/)
    await updateApiKey('k1', { status: 'revoked' })
    expect(rpc).toHaveBeenLastCalledWith('revoke_api_key', { p_id: 'k1' })
    expect(tables).not.toContain('developer_api_keys')
  })
})

describe('DeveloperPortal page', () => {
  it('issues a key and shows the plaintext once', async () => {
    listRows = [ROW]
    rpc.mockResolvedValueOnce({ data: { id: 'k2', key: 'tp_0123456789abcdef', prefix: 'tp_0123456' }, error: null })
    render(<DeveloperPortal />)
    expect(await screen.findByText('ERP sync')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Issue API key/ }))
    fireEvent.change(screen.getByPlaceholderText(/ERP sync \(read-only\)/), { target: { value: 'Payroll' } })
    fireEvent.submit(screen.getByPlaceholderText(/ERP sync \(read-only\)/).closest('form'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_api_key', expect.objectContaining({ p_name: 'Payroll' })))
    expect((await screen.findByTestId('new-api-key')).textContent).toBe('tp_0123456789abcdef')
    fireEvent.click(screen.getByRole('button', { name: /I have copied it/ }))
    await waitFor(() => expect(screen.queryByTestId('new-api-key')).toBeNull())
    expect(tables).not.toContain('developer_api_keys')
  })
})
