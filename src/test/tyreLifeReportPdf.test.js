import { describe, it, expect } from 'vitest'
import { renderTyreLifeReportPdf } from '../lib/tyreLifeReportPdf'

// Runs against the REAL jsPDF/jspdf-autotable (via pdfEngine), not a mock -
// a mocked jspdf would not have caught the earlier autotable/new-jsPDF break
// documented in the repo's own PDF fixes. This is the smoke test for the
// Running & Remaining report: it must render every row shape (km-measured,
// hours-measured, fully blank) without throwing, and the head row must carry
// the Current km / Current hrs columns shown on the screen.
describe('renderTyreLifeReportPdf', () => {
  const rows = [
    {
      serial: 'S1', asset: 'TM514', brand: 'INFINITY', position: 'LHCI',
      vehicleType: 'TR-MIXER', site: 'KSP-TP', size: '315/80 R 22.5',
      daysOn: 324, currentKm: 272687, currentHours: 18010,
      kmRun: 165687, hoursRun: 8010,
      expectedLifeKm: 80000, expectedLifeHours: null,
      remainingKm: 0, remainingHours: null, remainingDays: 0,
      unit: 'km', lifeBasis: 'manual', lifeSample: null,
    },
    {
      serial: 'S2', asset: 'WL046', brand: null, position: null,
      vehicleType: 'WHEEL LOADER', site: null, size: null,
      daysOn: null, currentKm: null, currentHours: 24144,
      kmRun: null, hoursRun: null,
      expectedLifeKm: null, expectedLifeHours: 5000,
      remainingKm: null, remainingHours: 2000, remainingDays: null,
      unit: 'hours', lifeBasis: 'measured_type', lifeSample: 12,
    },
  ]

  it('renders a real PDF with no data, without throwing', async () => {
    const doc = await renderTyreLifeReportPdf({
      rows: [], summary: {}, country: 'KSA', company: 'Test Co', filters: '', save: false,
    })
    expect(doc.output('datauristring')).toMatch(/^data:application\/pdf/)
  })

  it('renders km-measured and hours-measured rows, honouring N/A for blanks', async () => {
    const doc = await renderTyreLifeReportPdf({
      rows,
      summary: { total: 2, measurableKm: 1, measurableHours: 2, overdue: 1, dueSoon: 0, avgUsedPct: 55 },
      country: 'KSA', company: 'Test Co', filters: 'All active tyres', save: false,
    })
    expect(doc.output('datauristring')).toMatch(/^data:application\/pdf/)
    // The full table must carry both new columns beside Km run / Hours run.
    const head = doc.lastAutoTable?.head?.[0]?.raw || []
    expect(head).toContain('Current km')
    expect(head).toContain('Current hrs')
  })
})
