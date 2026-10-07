import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import en from '../locales/en/workshopStatus.json'
import common from '../locales/en/common.json'

// Workshop Status -> Daily upload (Loop 5). The real parser (sheet level), the
// real comparison engine and the real kit render; only file reading, the
// workshop API and the permission RPC are mocked.

const DICT = { workshopStatus: en, common }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))

const perms = vi.hoisted(() => ({ value: { upload: true, confirm: true } }))
vi.mock('../lib/api/workshopStatusPermissions', () => ({
  loadMyWorkshopPermissions: vi.fn(async () => ({ permissions: perms.value, error: null })),
  getMyWorkshopPermissions: vi.fn(async () => perms.value),
}))

vi.mock('../lib/workshopStatus/excelParser', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, parseWorkshopFile: vi.fn() }
})

vi.mock('../lib/api/workshopStatus', () => ({
  listActiveRecords: vi.fn(),
  findPreviousUploadByHash: vi.fn(),
  stageUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cancelUpload: vi.fn(async () => ({})),
  buildStagedRows: vi.fn(() => [{ staged: 'row' }]),
}))

import WorkshopStatus from '../pages/WorkshopStatus'
import { parseWorkshopFile, parseWorkshopSheet } from '../lib/workshopStatus/excelParser'
import * as api from '../lib/api/workshopStatus'

const HEADER = ['SR.NO', 'ASSET NO.', 'REG. NO.', 'JOB CARD NO.', 'LOCATION', 'PRODUCTION / FLEET COMPLIANT', 'DIAGNOSTICS', 'BREAKDOWN DATE', 'DOWN DAYS', 'REMARKS']
const AOA = [
  ['GREEN CONCRETE COMPANY CJSC'],
  ['JOB CARD ENTRY'],
  ['07-10-2026'],
  ['TRANSIT MIXER'],
  HEADER,
  ['1', 'TM100', '1234 ABC', 'JC/1', 'NHC', 'Brake noise', 'Pads worn', '01-10-2026', '6', 'WAITING FOR PARTS'],
  ['2', 'TM200', '', 'JC/2', 'NHC', 'Engine', '', '02-10-2026', '5', ''],
  ['3', '', '', 'JC/3', 'NHC', 'No asset', '', '03-10-2026', '4', ''],
  ['4', 'TM100', '', 'JC/9', 'NHC', 'Repeat', '', '03-10-2026', '4', ''],
  ['JOB CARD CLOSED DETAILS'],
  HEADER,
  ['1', 'TM300', '', 'JC/5', 'NHC', 'Done', '', '01-10-2026', '', ''],
  ['2', 'TM400', '', 'JC/6', 'NHC', 'Done', '', '01-10-2026', '', ''],
]
const RECORDS = [
  { id: 'r2', asset_no: 'TM200', country: 'KSA', current_active: true, complaint: 'Old complaint', job_card_ref: 'JC/2', site: 'NHC', ooc_since: '2026-10-02', excel_down_days: 5, vehicle_category: 'TRANSIT MIXER' },
  { id: 'r3', asset_no: 'TM300', country: 'KSA', current_active: true, site: 'NHC', vehicle_category: 'TRANSIT MIXER' },
  { id: 'r5', asset_no: 'TM500', country: 'KSA', current_active: true, site: 'NHC', vehicle_category: 'TRANSIT MIXER' },
]

function setup() {
  render(<MemoryRouter initialEntries={['/daily-ops/workshop?tab=upload']}><WorkshopStatus /></MemoryRouter>)
}

async function uploadFile() {
  setup()
  const input = await screen.findByLabelText('Daily workshop file')
  const file = new File(['x'], 'daily.xlsx', { type: 'application/vnd.ms-excel' })
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText('Upload preview')
}

const tab = (re) => screen.getByRole('tab', { name: re })

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  perms.value = { upload: true, confirm: true }
  const preview = parseWorkshopSheet(AOA, { sheetName: 'October CR (7)' })
  parseWorkshopFile.mockResolvedValue({ preview, fileHash: 'hash1', fileName: 'daily.xlsx', fileSize: 100 })
  api.listActiveRecords.mockResolvedValue(RECORDS)
  api.findPreviousUploadByHash.mockResolvedValue(null)
  api.stageUpload.mockResolvedValue({ uploadId: 'up1', uploadNo: 'WS-KSA-0001', duplicateOf: null })
  api.confirmUpload.mockResolvedValue({ new: 1, updated: 1, unchanged: 0, removed: 2, closed: 1, invalid: 1, duplicate: 1, previous_active: 3, active_after: 2 })
})

describe('Workshop Status daily upload', () => {
  it('shows the empty state and nothing changes until a file is chosen', async () => {
    setup()
    expect(await screen.findByText('No file yet')).toBeTruthy()
    expect(screen.getByText(/Nothing changes until you press Confirm upload/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Daily upload' })).toBeTruthy()
    expect(api.listActiveRecords).not.toHaveBeenCalled()
  })

  it('parses a file and shows the counts and review tabs', async () => {
    await uploadFile()
    expect(api.listActiveRecords).toHaveBeenCalledWith({ country: 'KSA' })
    expect(tab(/^New\s*1$/)).toBeTruthy()
    expect(tab(/^Changed\s*1$/)).toBeTruthy()
    expect(tab(/^Released\s*2$/)).toBeTruthy()
    expect(tab(/^Closed\s*1$/)).toBeTruthy()
    expect(tab(/^Invalid\s*1$/)).toBeTruthy()
    expect(tab(/^Duplicate\s*1$/)).toBeTruthy()
    expect(screen.getByText('07 Oct 2026')).toBeTruthy()
    expect(screen.getByText('October CR (7)')).toBeTruthy()

    fireEvent.click(tab(/^Changed/))
    expect(screen.getAllByText('Complaint: Old complaint -> Engine').length).toBeGreaterThan(0)
    fireEvent.click(tab(/^Invalid/))
    expect(screen.getAllByText(/Missing vehicle number/).length).toBeGreaterThan(0)
  })

  it('shows why each released vehicle leaves the active list', async () => {
    await uploadFile()
    fireEvent.click(tab(/^Released/))
    const panel = screen.getByTestId('wks-review-removed')
    expect(within(panel).getAllByText('Released (listed under closed details)').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText("Released (not in today's file)").length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('TM300').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('TM500').length).toBeGreaterThan(0)
  })

  it('denies upload without the upload permission', async () => {
    perms.value = { upload: false, confirm: false }
    setup()
    expect(await screen.findByText('You cannot upload the daily workshop file')).toBeTruthy()
    expect(screen.queryByLabelText('Daily workshop file')).toBeNull()
  })

  it('disables Confirm without the confirm permission', async () => {
    perms.value = { upload: true, confirm: false }
    await uploadFile()
    expect(screen.getByRole('button', { name: /Confirm upload/ }).disabled).toBe(true)
    expect(screen.getByText(/applying it needs the Confirm upload permission/)).toBeTruthy()
  })

  it('stages then confirms the staged rows and shows the server summary', async () => {
    await uploadFile()
    fireEvent.click(screen.getByRole('button', { name: /Confirm upload/ }))
    expect(await screen.findByText('Confirm this upload?')).toBeTruthy()
    expect(screen.getByText('Release 2 vehicles from the active list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm upload' }))
    await screen.findByText('Upload confirmed')
    expect(api.buildStagedRows).toHaveBeenCalled()
    expect(api.stageUpload).toHaveBeenCalledWith(expect.objectContaining({
      country: 'KSA', fileName: 'daily.xlsx', fileHash: 'hash1', reportDate: '2026-10-07', rows: [{ staged: 'row' }],
    }))
    expect(api.confirmUpload).toHaveBeenCalledWith('up1', { acknowledgeDuplicate: false })
    expect(api.stageUpload.mock.invocationCallOrder[0]).toBeLessThan(api.confirmUpload.mock.invocationCallOrder[0])
    expect(screen.getByText(/Upload WS-KSA-0001 was applied for KSA/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Upload another file/ })).toBeTruthy()
  })

  it('requires acknowledgement for a file uploaded before', async () => {
    api.findPreviousUploadByHash.mockResolvedValue({ id: 'u0', upload_no: 'WS-1', uploaded_at: '2026-10-06T08:00:00Z', uploaded_by_name: 'Ali', status: 'confirmed' })
    await uploadFile()
    expect(screen.getByText('This file appears to have already been uploaded on 06 Oct 2026 by Ali.')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: /Confirm upload/ })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Continue anyway/ }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, confirm upload' }))
    await screen.findByText('Upload confirmed')
    expect(api.confirmUpload).toHaveBeenCalledWith('up1', { acknowledgeDuplicate: true })
  })

  it('re-runs the comparison when the preview went stale', async () => {
    api.confirmUpload.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'stale_preview' }))
    await uploadFile()
    fireEvent.click(screen.getByRole('button', { name: /Confirm upload/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, confirm upload' }))
    expect(await screen.findByText(/Another upload was confirmed while you were reviewing/)).toBeTruthy()
    await waitFor(() => expect(api.listActiveRecords).toHaveBeenCalledTimes(2))
    expect(api.cancelUpload).toHaveBeenCalledWith('up1')
    expect(screen.getByText('Upload preview')).toBeTruthy()
  })

  it('keeps the preview on a generic failure', async () => {
    api.confirmUpload.mockRejectedValueOnce({ code: 'PGRST500', message: 'relation workshop_status_records does not exist' })
    await uploadFile()
    fireEvent.click(screen.getByRole('button', { name: /Confirm upload/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, confirm upload' }))
    expect(await screen.findByText('The upload was not applied')).toBeTruthy()
    expect(screen.getByText(/Nothing was changed on the server/)).toBeTruthy()
    expect(screen.queryByText(/does not exist/)).toBeNull()
    expect(screen.getByText('Upload preview')).toBeTruthy()
    expect(screen.queryByText('Upload confirmed')).toBeNull()
  })

  it('shows the parser message for an unusable file', async () => {
    parseWorkshopFile.mockRejectedValueOnce(new Error('The file has no vehicle number column. Expected a header such as ASSET NO. or Vehicle No. with the other workshop columns.'))
    setup()
    const input = await screen.findByLabelText('Daily workshop file')
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.xlsx')] } })
    expect(await screen.findByText('This file could not be used')).toBeTruthy()
    expect(screen.getByText(/no vehicle number column/)).toBeTruthy()
  })
})
