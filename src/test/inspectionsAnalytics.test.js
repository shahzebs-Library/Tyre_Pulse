import { describe, it, expect } from 'vitest'
import {
  toList, fromList, isoDay, deriveRegisterRows, tabCounts, rowsForTab, registerKpis,
  dbInspectionType, resolveRecordType, inferVehicleTypeFromAsset, checklistReadingStats,
  pressureDeviationLabel, checklistProgress, checklistConditionTally, actionPriority, conditionBucket,
} from '../lib/inspectionsAnalytics'
import { buildApprovalEmailHtml } from '../lib/inspectionApprovalEmail'

describe('URL list encoding', () => {
  it('decodes the sentinel and blanks to an empty list', () => {
    expect(toList('all')).toEqual([])
    expect(toList('')).toEqual([])
    expect(toList(null)).toEqual([])
  })
  it('splits a comma list into real values, never one joined value', () => {
    expect(toList('TR-MIXER, PUMPS')).toEqual(['TR-MIXER', 'PUMPS'])
    expect(toList(['A', '', 'B'])).toEqual(['A', 'B'])
  })
  it('an empty selection round-trips to the all sentinel', () => {
    expect(fromList([])).toBe('all')
    expect(fromList(['NHC', 'JED'])).toBe('NHC,JED')
    expect(toList(fromList(['NHC', 'JED']))).toEqual(['NHC', 'JED'])
  })
})

describe('register rows', () => {
  const now = new Date(2026, 2, 10, 23, 30) // local 10 March, late evening

  it('uses the LOCAL calendar day', () => {
    expect(isoDay(now)).toBe('2026-03-10')
  })

  it('marks an open record past its day Overdue, and never a done or cancelled one', () => {
    const out = deriveRegisterRows([
      { id: 1, status: 'Scheduled', scheduled_date: '2026-03-09' },
      { id: 2, status: 'Done', scheduled_date: '2026-03-01' },
      { id: 3, status: 'Cancelled', scheduled_date: '2026-03-01' },
      { id: 4, status: 'In Progress', scheduled_date: '2026-03-10' },
      { id: 5, status: 'Scheduled', scheduled_date: null },
    ], now)
    expect(out.map((r) => r.status)).toEqual(['Overdue', 'Done', 'Cancelled', 'In Progress', 'Scheduled'])
  })

  it('restores the display type from custom_data', () => {
    const [r] = deriveRegisterRows([{ inspection_type: 'Routine', custom_data: { record_type: 'Safety Training' } }], now)
    expect(r.inspection_type).toBe('Safety Training')
    expect(resolveRecordType({ inspection_type: 'Visual', custom_data: { record_type: 'junk' } })).toBe('Visual')
  })

  it('stores only a CHECK-valid type', () => {
    expect(dbInspectionType('Site Observation')).toBe('Routine')
    expect(dbInspectionType('Pressure')).toBe('Pressure')
  })

  it('counts and filters each tab', () => {
    const rows = [
      { inspection_type: 'Routine' }, { inspection_type: 'Full' },
      { inspection_type: 'Site Observation' }, { inspection_type: 'Training Session' },
      { inspection_type: 'Unknown' },
    ]
    expect(tabCounts(rows)).toEqual({ all: 5, inspections: 2, observations: 1, training: 1 })
    expect(rowsForTab(rows, 'observations')).toHaveLength(1)
    expect(rowsForTab(rows, 'checklist')).toHaveLength(5)
  })
})

describe('registerKpis', () => {
  it('rates are N/A, never 0%, when there is nothing to divide by', () => {
    const k = registerKpis([])
    expect(k.total).toBe(0)
    expect(k.completionRate).toBeNull()
    expect(k.overdueRate).toBeNull()
  })
  it('excludes cancelled records from the completion base', () => {
    const k = registerKpis([
      { status: 'Done', severity: 'High' },
      { status: 'Overdue', severity: 'Low', linked_action_id: 'x' },
      { status: 'Cancelled', severity: 'Critical' },
    ])
    expect(k.completionRate).toBe(50)
    expect(k.overdueRate).toBe(50)
    expect(k.open).toBe(1)
    expect(k.highSeverity).toBe(2)
    expect(k.withAction).toBe(1)
  })
})

describe('checklist readings', () => {
  it('buckets conditions by band, including the field app vocabulary', () => {
    expect(conditionBucket('Good')).toBe('Good')
    expect(conditionBucket('Worn')).toBe('Wear')
    expect(conditionBucket('Flat')).toBe('Damage')
    expect(conditionBucket(null)).toBe('No data')
  })

  it('averages only recorded readings and says N/A when there are none', () => {
    const empty = checklistReadingStats([{ position: 'LHF1', condition: 'Good', pressure: '' }])
    expect(empty.avgPsi).toBeNull()
    expect(empty.avgTread).toBeNull()
    expect(empty.lowestTread).toBeNull()
    expect(empty.flagPressure).toBe(false)

    const s = checklistReadingStats([
      { position: 'A', condition: 'Good', pressure: '100', treadDepth: '8' },
      { position: 'B', condition: 'Wear', pressure: '110', treadDepth: '5' },
      { position: 'C', condition: 'Damage', pressure: '120' },
      { position: 'D', condition: 'Good', pressure: '130' },
    ])
    expect(s.avgPsi).toBe(115)
    expect(s.medianPsi).toBe(115)
    expect(s.lowestTread).toEqual({ pos: 'B', value: 5 })
    expect(s.counts).toEqual({ Good: 2, Wear: 1, Damage: 1, 'No data': 0 })
    expect(s.flagPressure).toBe(true)
  })

  it('flags a pressure more than 15% off the median', () => {
    expect(pressureDeviationLabel('100', 100)).toBe('OK')
    expect(pressureDeviationLabel('120', 100)).toBe('Check +20%')
    expect(pressureDeviationLabel('80', 100)).toBe('Check -20%')
    expect(pressureDeviationLabel('', 100)).toBe('N/A')
  })

  it('reports progress and tallies', () => {
    const ps = [{ pressure: '100', condition: 'Good' }, { pressure: '', condition: 'Puncture' }]
    expect(checklistProgress(ps)).toEqual({ total: 2, filled: 1, unfilled: 1, allFilled: false })
    expect(checklistConditionTally(ps)).toEqual({ good: 1, wear: 0, critical: 1 })
  })
})

describe('small rules', () => {
  it('infers a vehicle type from the asset prefix, else null', () => {
    expect(inferVehicleTypeFromAsset('TM514')).toBe('Tri-mixer')
    expect(inferVehicleTypeFromAsset('ZZ1')).toBeNull()
  })
  it('maps severity to an action priority', () => {
    expect(actionPriority('Critical')).toBe('Critical')
    expect(actionPriority('Low')).toBe('Medium')
  })
})

describe('approval e-mail', () => {
  it('escapes free text so a note cannot inject markup', () => {
    const html = buildApprovalEmailHtml({
      assetNo: 'TM1', notes: '<script>x</script>', approvalLink: 'https://x/y?a=1&b=2',
      signature: 'javascript:alert(1)',
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a=1&amp;b=2')
    expect(html).not.toContain('javascript:alert')
    expect(html).toContain('No digital signature captured')
  })
})
