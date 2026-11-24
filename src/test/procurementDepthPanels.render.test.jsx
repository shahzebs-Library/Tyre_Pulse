import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const state = { mode: 'empty' }
const answer = () => {
  if (state.mode === 'not_set_up') return Promise.resolve({ status: 'not_provisioned', rows: [] })
  if (state.mode === 'error') return Promise.reject(new Error('boom'))
  return Promise.resolve({ status: 'ok', rows: [] })
}

vi.mock('../lib/api/procurementDepth', () => ({
  NOT_SET_UP: 'This part of procurement is not switched on yet.',
  newIdempotencyKey: () => 'k',
  listSuppliersForApproval: () => answer(),
  setSupplierApproval: vi.fn(),
  listRfqs: () => answer(),
  createRfq: vi.fn(), recordQuote: vi.fn(), awardRfq: vi.fn(), cancelRfq: vi.fn(),
  listBackorders: () => answer(),
  listEmergencyPurchases: () => answer(),
  approveEmergencyPurchase: vi.fn(),
  listReturnableReceipts: () => answer(),
  listSupplierReturns: () => answer(),
  postSupplierReturn: vi.fn(),
  listSupplierInvoices: () => answer(),
  createSupplierInvoice: vi.fn(), matchSupplierInvoice: vi.fn(),
  listPoLinesForInvoice: () => answer(),
  listInvoiceablePurchaseOrders: () => answer(),
  listSupplierPerformance: () => answer(),
}))
vi.mock('../components/procurement/ProcurementChainPanels', () => ({ MaterialPicker: () => null }))

import {
  SupplierApprovalPanel, RfqPanel, BackorderPanel, SupplierReturnsPanel, ThreeWayMatchPanel, SupplierPerformancePanel, EmergencyPurchasesPanel,
} from '../components/procurement/ProcurementDepthPanels'

const PANELS = [
  ['SupplierApprovalPanel', SupplierApprovalPanel, /No suppliers yet/],
  ['RfqPanel', RfqPanel, /No open quotation requests/],
  ['BackorderPanel', BackorderPanel, /Nothing is outstanding/],
  ['SupplierReturnsPanel', SupplierReturnsPanel, /No supplier returns yet/],
  ['ThreeWayMatchPanel', ThreeWayMatchPanel, /No supplier invoices recorded yet/],
  ['SupplierPerformancePanel', SupplierPerformancePanel, /nothing can be measured/],
  ['EmergencyPurchasesPanel', EmergencyPurchasesPanel, /No emergency purchases/],
]
const props = { scope: { country: 'KSA', site: null }, can: () => true, userId: 'u1', onNavigate: () => {} }

describe('procurement depth panels', () => {
  beforeEach(() => { state.mode = 'empty' })

  it.each(PANELS)('%s shows its empty state', async (_name, Panel, text) => {
    render(<Panel {...props} />)
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0))
  })

  it.each(PANELS)('%s says when the database update is not applied', async (_name, Panel) => {
    state.mode = 'not_set_up'
    render(<Panel {...props} />)
    await waitFor(() => expect(screen.getAllByText(/not switched on yet/).length).toBeGreaterThan(0))
  })

  it.each(PANELS)('%s offers a retry when loading fails', async (_name, Panel) => {
    state.mode = 'error'
    render(<Panel {...props} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0))
  })
})
