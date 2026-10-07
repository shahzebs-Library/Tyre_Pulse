import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import wsr from '../locales/en/workshopStatusRemoved.json'
import common from '../locales/en/common.json'

// Workshop Status -> Released (Loop 11). The real view engine, kit and Modal
// render; only the service, settings and language are mocked.

const DICT = { workshopStatusRemoved: wsr, common }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../lib/api/workshopStatusRemoved', () => ({ loadRemovedRecords: vi.fn(), runRecordAction: vi.fn() }))

import RemovedRecordsPanel from '../components/workshopStatus/RemovedRecordsPanel'
import { loadRemovedRecords, runRecordAction } from '../lib/api/workshopStatusRemoved'

const ROWS = [
  { id: 'r1', asset_no: 'TM599', site: 'NHC', current_active: false, removed_at: '2026-10-06T08:00:00Z', removed_reason: 'missing_from_upload',
    removed_by_upload: { upload_no: 126 }, previous_current_stage: 'Waiting for Parts', previous_responsible_name: 'Sajid', updated_at: '2026-10-06 08:00:00.123456+00' },
  { id: 'r2', asset_no: 'TM421', site: 'JED', current_active: false, removed_at: '2026-10-05T08:00:00Z', archived_at: '2026-10-07T08:00:00Z',
    final_disposition: 'repair_completed', final_disposition_by_name: 'Vinay', final_disposition_at: '2026-10-06T09:00:00Z', updated_at: 'x' },
]
const SUPERVISOR = { view: true, view_removed: true, disposition: true, restore: true, export: true }

beforeEach(() => {
  cleanup()
  vi.mocked(loadRemovedRecords).mockReset().mockResolvedValue({ rows: ROWS, truncated: false })
  vi.mocked(runRecordAction).mockReset().mockResolvedValue({ ok: true, changed: 1 })
})

describe('RemovedRecordsPanel', () => {
  it('refuses without view_removed and never loads', () => {
    render(<RemovedRecordsPanel permissions={{ view: true }} />)
    expect(screen.getByText(wsr.deniedTitle)).toBeTruthy()
    expect(loadRemovedRecords).not.toHaveBeenCalled()
  })

  it('lists released vehicles with removal facts and permission-gated actions', async () => {
    render(<RemovedRecordsPanel permissions={SUPERVISOR} onHistory={() => {}} />)
    const table = await screen.findByRole('table')
    const row = within(table).getByText('TM599').closest('tr')
    expect(within(row).getByText(wsr.removedReason.missing_from_upload)).toBeTruthy()
    expect(within(row).getByText('Upload #126')).toBeTruthy()
    expect(within(row).getByText('Sajid')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Restore: TM599' })).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Archive: TM599' })).toBeNull()
    const archivedRow = within(table).getByText('TM421').closest('tr')
    expect(within(archivedRow).queryByRole('button', { name: 'Restore: TM421' })).toBeNull()
    expect(within(archivedRow).getByText('Repair completed')).toBeTruthy()
  })

  it('restore needs a reason, then calls the writer with the read updated_at', async () => {
    const onChanged = vi.fn()
    render(<RemovedRecordsPanel permissions={SUPERVISOR} onChanged={onChanged} />)
    const table = await screen.findByRole('table')
    fireEvent.click(within(table).getByRole('button', { name: 'Restore: TM599' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: wsr.confirm.restore }))
    expect(await within(dialog).findByText('Write a reason of at least 5 characters.')).toBeTruthy()
    expect(runRecordAction).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText(wsr.reason), { target: { value: 'Vehicle was omitted from Excel by mistake.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: wsr.confirm.restore }))
    await waitFor(() => expect(runRecordAction).toHaveBeenCalledWith('r1', 'restore', expect.objectContaining({
      reason: 'Vehicle was omitted from Excel by mistake.', expectedUpdatedAt: '2026-10-06 08:00:00.123456+00',
    })))
    expect(await screen.findByText(wsr.done.restore)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the translated message when the vehicle is already active', async () => {
    const err = Object.assign(new Error('x'), { code: 'already_active' })
    vi.mocked(runRecordAction).mockRejectedValueOnce(err)
    render(<RemovedRecordsPanel permissions={SUPERVISOR} />)
    const table = await screen.findByRole('table')
    fireEvent.click(within(table).getByRole('button', { name: 'Restore: TM599' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(wsr.reason), { target: { value: 'Omitted by mistake' } })
    fireEvent.click(within(dialog).getByRole('button', { name: wsr.confirm.restore }))
    expect(await within(dialog).findByText(wsr.errors.already_active)).toBeTruthy()
  })

  it('disposition Other requires remarks', async () => {
    render(<RemovedRecordsPanel permissions={SUPERVISOR} />)
    const table = await screen.findByRole('table')
    fireEvent.click(within(table).getByRole('button', { name: 'Disposition: TM599' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(wsr.col.disposition), { target: { value: 'other' } })
    fireEvent.click(within(dialog).getByRole('button', { name: wsr.confirm.disposition }))
    expect(await within(dialog).findByText(wsr.errors.remarksRequired)).toBeTruthy()
    expect(runRecordAction).not.toHaveBeenCalled()
  })
})
