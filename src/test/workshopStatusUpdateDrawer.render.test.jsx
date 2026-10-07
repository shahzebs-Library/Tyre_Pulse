import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import en from '../locales/en/workshopStatusUpdate.json'

// Vehicle Update Drawer (Workshop Status, Loop 8). The real drawer shell, form
// helpers and vocabulary render; only the service is mocked.

const DICT = { workshopStatusUpdate: en }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', isRTL: false }) }))

const api = vi.hoisted(() => ({
  updateWorkshopRecord: vi.fn(),
  listAssignableUsers: vi.fn(),
}))
vi.mock('../lib/api/workshopStatusUpdate', () => api)

import VehicleUpdateDrawer from '../components/workshopStatus/VehicleUpdateDrawer'
import { ServiceError } from '../lib/api/_client'

const RECORD = {
  id: 'rec-1',
  asset_no: 'TM599',
  site: 'NHC',
  country: 'KSA',
  current_stage: 'Waiting for Diagnosis',
  delay_reason: null,
  detailed_reason: null,
  remarks: null,
  responsible_user_id: null,
  supporting_user_id: null,
  updated_at: '2026-10-07T09:42:00.123456+00:00',
  last_updated_by_name: 'Sajid Kamboh',
}
const ALL = { update: true, assign: true }

function renderDrawer (props = {}) {
  const onSaved = vi.fn(); const onClose = vi.fn()
  render(<VehicleUpdateDrawer record={RECORD} open onClose={onClose} onSaved={onSaved} permissions={ALL} {...props} />)
  return { onSaved, onClose }
}

beforeEach(() => {
  api.updateWorkshopRecord.mockReset()
  api.listAssignableUsers.mockReset().mockResolvedValue([
    { id: 'u-1', name: 'Ahmed Khan', role: 'Mechanic' },
    { id: 'u-2', name: 'Helper Tech', role: 'Electrician' },
  ])
})
afterEach(() => cleanup())

describe('VehicleUpdateDrawer', () => {
  it('renders every spec field, the read-only last update, and no Updated By input', async () => {
    renderDrawer()
    for (const label of ['Current stage', 'Delay / hold reason', 'Detailed reason', 'Work done / latest update',
      'Action taken', 'Next action', 'Parts status', 'MR number', 'PO number', 'Expected part date',
      'Responsible person', 'Supporting person', 'Expected release', 'Blocker / escalation', 'Remarks']) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByLabelText('Current stage').value).toBe('Waiting for Diagnosis')
    expect(screen.getByTestId('wks-upd-last-updated').textContent).toContain('Last updated by Sajid Kamboh at')
    expect(screen.queryByLabelText(/updated by/i)).toBeNull()
    const stageOptions = [...screen.getByLabelText('Current stage').querySelectorAll('option')].map(o => o.value)
    expect(stageOptions).not.toContain('Removed From Current Report')
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Ahmed Khan' }).length).toBe(2))
  })

  it('requires a detailed reason when the delay reason is Other and does not call the service', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText('Delay / hold reason'), { target: { value: 'Other' } })
    expect(screen.getByLabelText('Detailed reason (required for Other)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Save update/ }))
    expect(await screen.findByText(en.errors.detailRequired)).toBeTruthy()
    expect(screen.getByText(en.drawer.fixErrors)).toBeTruthy()
    expect(api.updateWorkshopRecord).not.toHaveBeenCalled()
  })

  it('disables the people selectors without assign permission', async () => {
    renderDrawer({ permissions: { update: true, assign: false } })
    expect(screen.getByLabelText('Responsible person').disabled).toBe(true)
    expect(screen.getByLabelText('Supporting person').disabled).toBe(true)
    expect(screen.getByLabelText('Remarks').disabled).toBe(false)
    expect(screen.getByText(en.drawer.noAssign)).toBeTruthy()
  })

  it('makes everything read-only without update permission', () => {
    renderDrawer({ permissions: { update: false, assign: false } })
    expect(screen.getByLabelText('Remarks').disabled).toBe(true)
    expect(screen.getByLabelText('Current stage').disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Save update/ }).disabled).toBe(true)
    expect(screen.getByText(en.drawer.noPermission)).toBeTruthy()
  })

  it('saves only the changed fields with the record version and hands back the saved row', async () => {
    const saved = { ...RECORD, remarks: 'Checked', current_stage: 'Testing', responsible_user_id: 'u-1', last_updated_by_name: 'Me' }
    api.updateWorkshopRecord.mockResolvedValue({ ok: true, changed: 3, fields: [], record: saved })
    const { onSaved } = renderDrawer()
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Ahmed Khan' }).length).toBe(2))
    fireEvent.change(screen.getByLabelText('Current stage'), { target: { value: 'Testing' } })
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: '  Checked  ' } })
    fireEvent.change(screen.getByLabelText('Responsible person'), { target: { value: 'u-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save update/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(api.updateWorkshopRecord).toHaveBeenCalledTimes(1)
    expect(api.updateWorkshopRecord).toHaveBeenCalledWith('rec-1',
      { current_stage: 'Testing', remarks: 'Checked', responsible_user_id: 'u-1' },
      { expectedUpdatedAt: RECORD.updated_at })
  })

  it('says nothing changed instead of saving an empty update', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: /Save update/ }))
    expect(await screen.findByText(en.drawer.nothingChanged)).toBeTruthy()
    expect(api.updateWorkshopRecord).not.toHaveBeenCalled()
  })

  it('shows the stale-record message when someone else saved first', async () => {
    api.updateWorkshopRecord.mockRejectedValue(new ServiceError('stale', 'record_changed'))
    const onReload = vi.fn()
    const { onSaved } = renderDrawer({ onReload })
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Save update/ }))
    expect(await screen.findByText(en.drawer.stale)).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Reload vehicle/ }))
    expect(onReload).toHaveBeenCalled()
  })

  it('shows a safe message for other failures, never the raw database text', async () => {
    api.updateWorkshopRecord.mockRejectedValue({ code: '42501', message: 'permission denied for table workshop_status_records' })
    renderDrawer()
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Save update/ }))
    expect(await screen.findByText('You do not have permission to do that.')).toBeTruthy()
    expect(screen.queryByText(/workshop_status_records/)).toBeNull()
  })
})
