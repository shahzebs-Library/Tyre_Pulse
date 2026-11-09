import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../lib/api/tyreEvidenceAudit', () => ({
  getTyreEvidenceAudit: vi.fn().mockResolvedValue({
    classes: { KSA: { VERIFIED: 3061, PROVISIONAL: 1997 } },
    flags: { KSA: { price_missing: 2170 } },
    legacy_active: [{ id: 'c89', country: 'KSA', asset_no: 'TM415', position: 'LHCI', serial_no: 'YMN50625', fit_date: '2024-09-08',
      finding: 'serial_refitted_later', proposed_action: 'close_fitment_on_or_before_next_fit_date', serial_next_asset: 'TM635', serial_next_position: 'RHF2', serial_next_fit_date: '2025-10-01' }],
    monthly: [{ country: 'KSA', month: '2025-09-01', new_physical: 1326, unidentified: 462, grid_issued_qty: 208 }],
  }),
  listEvidenceRows: vi.fn(),
}))

import TyreEvidenceAuditSection from '../components/reconciliation/TyreEvidenceAuditSection'

describe('TyreEvidenceAuditSection', () => {
  it('shows classes, the legacy proposal (not applied) and the over-recorded month', async () => {
    render(<TyreEvidenceAuditSection />)
    expect(await screen.findByText('3,061')).toBeTruthy()
    expect(screen.getByText(/Same serial fitted elsewhere later/)).toBeTruthy()
    expect(screen.getByText(/Propose: close this fitment/)).toBeTruthy()
    expect(screen.getByText('More fitments than issues')).toBeTruthy()
    expect(screen.getByText(/No record is changed from here/)).toBeTruthy()
  })
})
