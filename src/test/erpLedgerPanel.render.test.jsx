import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import * as XLSX from 'xlsx'

const auth = { isSuperAdmin: true }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

const api = vi.hoisted(() => ({
  listLocations: vi.fn(),
  loadMasterForLedger: vi.fn(),
  loadStockAtLocation: vi.fn(),
  listErpLedgerUploads: vi.fn(),
  findErpLedgerUpload: vi.fn(),
  beginErpLedger: vi.fn(),
  runErpLedger: vi.fn(),
  cancelErpLedger: vi.fn(),
  countMovementsAfter: vi.fn(),
}))
vi.mock('../lib/api/inventory', async (orig) => ({ ...(await orig()), ...api }))

import ErpLedgerPanel from '../components/inventory/ErpLedgerPanel'
import { LanguageProvider } from '../contexts/LanguageContext'

// A Stores Ledger file in the exact Ramco layout (written as a real .xls workbook).
function ledgerFile(name, rows) {
  const aoa = [
    ['BU name    :', 'Green Concrete CJSC - BU', 'Stores Ledger', '', '', '', '', '', '', ''],
    ['OU name    :', 'Green Concrete ', '', '', '', '', '', 'Report ID  :', 'CSOL-IMS-013-1', ''],
    [],
    ['Currency    :', 'SAR'],
    ['', '', 'Date from :', '31/12/2015', '', '26/11/2026'],
    ['Item code ', 'Item description', '', 'Warehouse', 'Zone', 'Bin', 'CB Qty', 'Rate', '', 'Value'],
    ...rows,
    ['TOTAL', '', '', '', '', '', String(rows.reduce((a, r) => a + Number(r[6]), 0)), '', '', '1'],
    ['<End Of Report>'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'sheet1')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'biff8' })
  const file = new File([bytes], name, { type: 'application/vnd.ms-excel' })
  if (!file.arrayBuffer) file.arrayBuffer = () => Promise.resolve(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer)
  return file
}

const LOCS = [{ id: 'loc-q', code: 'QIDDIYA-ST', site: 'QIDDIYA', country: 'KSA', active: true }]
const MASTER = [
  { id: 'm1', item_code: '450052-O', item_name: 'RADIATOR COOLANT', category: 'lubricant', reviewed: true },
  { id: 'm2', item_code: '222580-O', item_name: 'O RING', category: 'unclassified', reviewed: false },
]
const STOCK = [
  { id: 's1', item_id: 'm1', item_code: '450052-O', qty_on_hand: 153, qty_reserved: 0 },
  { id: 's9', item_id: 'm9', item_code: 'OLD-1', description: 'OLD PART', qty_on_hand: 4, qty_reserved: 0 },
]

const renderPanel = () => render(<LanguageProvider><ErpLedgerPanel scope={{ country: 'KSA', site: 'all' }} /></LanguageProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  auth.isSuperAdmin = true
  api.listLocations.mockResolvedValue({ status: 'ok', rows: LOCS, truncated: false })
  api.loadMasterForLedger.mockResolvedValue({ rows: MASTER, truncated: false })
  api.loadStockAtLocation.mockResolvedValue({ rows: STOCK, truncated: false })
  api.listErpLedgerUploads.mockResolvedValue({ status: 'ok', rows: [], total: 0 })
  api.findErpLedgerUpload.mockResolvedValue(null)
  api.beginErpLedger.mockResolvedValue({ upload_id: 'up-1', pending: 3 })
  api.runErpLedger.mockResolvedValue({ done: true, quantities_changed: 2, set_to_zero: 0, items_added: 2, names_updated: 1, categories_set: 1, held_back: [{ code: '450003-O', reason: 'negative_qty' }] })
  api.cancelErpLedger.mockResolvedValue({ status: 'cancelled' })
  api.countMovementsAfter.mockResolvedValue(0)
})

async function upload(file) {
  const input = document.querySelector('input[type=file]')
  await waitFor(() => expect(input.disabled).toBe(false))
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ERP stores ledger panel', () => {
  it('reads a Ramco file, matches the store and shows every change before posting', async () => {
    renderPanel()
    await upload(ledgerFile('Qiddya_St.xls', [
      ['450052-O', 'RADIATOR COOLANT', '', 'QIDDIYA-ST', 'null', 'null', '160.00', '12.50', '', '2000'],
      ['222580-O', 'O RING FOR ZX M/F FLANGE', '', 'QIDDIYA-ST', 'null', 'null', '5', '', '', ''],
      ['224447-O', 'BRAKE FRICTION PAD-SANY TM', '', 'QIDDIYA-ST', 'null', 'null', '2', '80', '', '160'],
      ['450003-O', 'HYDRAULIC OIL 68', '', 'QIDDIYA-ST', 'null', 'null', '-2', '', '', ''],
    ]))
    await screen.findByText('Qiddya_St.xls')
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy())
    expect(screen.getByText('QIDDIYA-ST (QIDDIYA)')).toBeTruthy()
    fireEvent.click(screen.getByText('Qiddya_St.xls'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Quantities (3)')).toBeTruthy()
    expect(within(dialog).getByText('+7')).toBeTruthy()
    fireEvent.click(within(dialog).getByText('New items (2)'))
    expect(within(dialog).getByText('BRAKE FRICTION PAD-SANY TM')).toBeTruthy()
    fireEvent.click(within(dialog).getByText('Held back (1)'))
    expect(within(dialog).getByText(/Negative quantity in the ERP/)).toBeTruthy()
    fireEvent.click(within(dialog).getByText('Not in file (1)'))
    expect(within(dialog).getByText('OLD PART')).toBeTruthy()

    fireEvent.click(within(dialog).getByText('Review and post'))
    const confirm = await screen.findByText('Post this ledger?')
    expect(confirm).toBeTruthy()
    expect(screen.getByText(/items not in the file left as they are/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(api.runErpLedger).toHaveBeenCalledWith('up-1', expect.any(Object)))
    const [payload, key] = api.beginErpLedger.mock.calls[0]
    expect(payload).toMatchObject({ location_id: 'loc-q', country: 'KSA', currency: 'SAR', period_to: '2026-11-26', zero_missing: false, report_id: 'CSOL-IMS-013-1' })
    expect(payload.file_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.lines).toHaveLength(4)
    expect(payload.new_items.map((n) => n.code)).toEqual(['224447-O', '450003-O'])
    expect(payload.reclassify.map((n) => n.code)).toEqual(['222580-O'])
    expect(key).toBe(payload.idempotency_key)
    expect(payload.lines.every((l) => l.warehouse === 'QIDDIYA-ST')).toBe(true)
    expect(await screen.findByText(/Posted: 2 quantities changed/)).toBeTruthy()
    expect(screen.getByText(/1 negative/)).toBeTruthy()
  })

  it('offers to continue an upload that stopped part way', async () => {
    api.findErpLedgerUpload.mockResolvedValue({ id: 'up-9', status: 'open', created_at: '2026-11-26T10:00:00Z', filename: 'Qiddya_St.xls' })
    renderPanel()
    await upload(ledgerFile('Qiddya_St.xls', [['450052-O', 'RADIATOR COOLANT', '', 'QIDDIYA-ST', 'null', 'null', '160', '', '', '']]))
    expect(await screen.findByText('Not finished')).toBeTruthy()
    fireEvent.click(screen.getByText('Qiddya_St.xls'))
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }))
    await waitFor(() => expect(api.runErpLedger).toHaveBeenCalledWith('up-9', expect.any(Object)))
    expect(api.beginErpLedger).not.toHaveBeenCalled()
  })

  it('will not post a file with an unreadable row', async () => {
    renderPanel()
    await upload(ledgerFile('Bad.xls', [
      ['450052-O', 'RADIATOR COOLANT', '', 'QIDDIYA-ST', 'null', 'null', '160', '', '', ''],
      ['222580-O', 'O RING', '', 'QIDDIYA-ST', 'null', 'null', 'abc', '', '', ''],
    ]))
    expect(await screen.findByText('Cannot post')).toBeTruthy()
    fireEvent.click(screen.getByText('Bad.xls'))
    expect(await screen.findByText('This file cannot be posted')).toBeTruthy()
    expect(screen.queryByText('Review and post')).toBeNull()
  })

  it('refuses a file that is not a stores ledger and a store it cannot find', async () => {
    renderPanel()
    await upload(ledgerFile('Unknown.xls', [['X-1', 'PART', '', 'NOWHERE-ST', 'null', 'null', '1', '', '', '']]))
    expect(await screen.findByText('Store not found')).toBeTruthy()
  })

  it('marks a file that was already posted', async () => {
    api.findErpLedgerUpload.mockResolvedValue({ id: 'u1', posted_at: '2026-11-26T10:00:00Z', filename: 'Qiddya_St.xls' })
    renderPanel()
    await upload(ledgerFile('Qiddya_St.xls', [['450052-O', 'RADIATOR COOLANT', '', 'QIDDIYA-ST', 'null', 'null', '160', '', '', '']]))
    expect(await screen.findByText('Already posted')).toBeTruthy()
  })

  it('shows no upload control to anyone but the owner', async () => {
    auth.isSuperAdmin = false
    renderPanel()
    expect(await screen.findByText(/Only the owner can post an ERP stores ledger/)).toBeTruthy()
    expect(document.querySelector('input[type=file]')).toBeNull()
  })
})
