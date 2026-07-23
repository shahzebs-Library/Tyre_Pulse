import { describe, it, expect } from 'vitest'
import { parseDate, detectReport, isFooterRow, intakeSheet, REPORT_TYPES } from '../lib/erpIntake'

describe('parseDate', () => {
  it('handles the Ramco date formats', () => {
    expect(parseDate('2026-07-01')).toBe('2026-07-01')
    expect(parseDate('02-07-2026')).toBe('2026-07-02')   // DD-MM-YYYY
    expect(parseDate('02/07/2026')).toBe('2026-07-02')
    expect(parseDate('02-Jul-26')).toBe('2026-07-02')    // DD-Mon-YY
    expect(parseDate('30-Jun-26')).toBe('2026-06-30')
    expect(parseDate('')).toBe('')
    expect(parseDate('not a date')).toBe('')
  })
})

describe('isFooterRow', () => {
  it('flags totals, print stamps, filter notes, bare employee ids, blanks', () => {
    expect(isFooterRow(['GRAND TOTAL ', '', '', '1816412.00'])).toBe(true)
    expect(isFooterRow(['', 'Printed By', '10014067'])).toBe(true)
    expect(isFooterRow(['Printed By', '10014067', '', 'Printed Date'])).toBe(true)
    expect(isFooterRow(['Applied filters:\nrfr_category is not GENERATOR'])).toBe(true)
    expect(isFooterRow(['10014067'])).toBe(true)          // bare employee id
    expect(isFooterRow(['', '', ''])).toBe(true)
    expect(isFooterRow(['TM556', '02-07-2026', 'TR-MIXER'])).toBe(false)
  })
})

const TYRE_AOA = [
  ['', '', '', '', '', 'MONTHLY TYRES ', '', ''],
  ['', 'DATE FROM', ': 02 July 2026', '', '', '', '', ''],
  ['Job Card No.', 'Job Card Date', 'VEH.NO', 'VEH TYPE/CATEGORY', 'ITEM/TYRE', 'TYRE POSITION', 'TYRE No.', 'TYRE FIX DATE', 'FIXED KM', 'FIXED HRS', 'TYRE REMOVED DATE', 'REMOVED KM', 'REMOVED HRS', 'REASON', 'TOTAL KM', 'TOTAL HRS'],
  ['GCKR/JC/0131/0726  ', '02-07-2026', 'TM556', 'TR-MIXER ', '315/80 R 22.5', 'RHF1 ', 'K507B403553  ', '02-07-2026', '143067.00', '13193.00', '08-06-2026', '138233.00', '12819.00', 'MISUSE ', '4834', '374'],
  ['Printed By', '10014067', '', '', '', '', '', '', '', '', '', '', '', 'Printed Date'],
]

const COMPLAINTS_AOA = [
  ['', '', '', '', '', '', '', '', 'Vehicle Com'],
  ['Date From', '', '2026-07-02'],
  ['Veh No.', 'Driver Name', 'Tracking Category', 'Location', 'Workshop Location', 'Make', 'Capacity', 'JC No.', 'KM/HR', 'Complaints', 'QC Remarks', 'Job Done Description', 'Std Hrs', 'Manpow Hrs', 'Vehicle In Date', 'Vehicle Out Date'],
  ['MP076', 'Sukhdev', 'Active', 'NHC ', 'DIRIYAH-ST2 ', 'Sany', ', 56MTR', 'GCKR/JC/0153/0726', '132283.0', 'Tyre Puncture', 'TIRE PUNCTURE', 'REPLACED TEMPORARY', '2.0', '0.0', '2026-07-01', '2026-07-02'],
  ['GRAND TOTAL ', '', '', '', '', '', '', '', '1816412.00'],
  ['', 'Printed By', '10014067'],
]

describe('detectReport', () => {
  it('detects the monthly tyres report with header on row 3', () => {
    const d = detectReport(TYRE_AOA)
    expect(d.type).toBe(REPORT_TYPES.MONTHLY_TYRES)
    expect(d.target).toBe('tyre_records')
    expect(d.headerIndex).toBe(2)
  })
  it('detects the complaints report', () => {
    expect(detectReport(COMPLAINTS_AOA).target).toBe('work_orders')
  })
  it('detects the grid + open-wo reports', () => {
    expect(detectReport([['#', 'Issue Number', 'Work Order Number', 'Transaction Type', 'Asset Code', 'x', 'y', 'z', 'w', 'Itemcode', 'Qty', 'Item Description', 'Values', 'Spare Parts']]).type).toBe(REPORT_TYPES.GRID)
    expect(detectReport([['Location', 'Job Card Type', 'Job Card No', 'J C Status', 'Job Card Date', 'JC Open Time', 'Asset Type', 'Asset No', 'No of Days JC Open', 'Complaint']]).target).toBe('open_work_orders')
  })
  it('detects the asset master (equipment grid) as vehicle_fleet', () => {
    const d = detectReport([['#', 'Asset No.', 'Asset Desc.', 'Plate No.', 'Chassis No.', 'Serial No', 'Asset Type', 'Asset Location', 'Asset Status', 'KM', 'Brand']])
    expect(d.type).toBe(REPORT_TYPES.ASSETS)
    expect(d.target).toBe('vehicle_fleet')
  })
  it('returns null for an unknown sheet', () => {
    expect(detectReport([['foo', 'bar', 'baz']])).toBeNull()
  })
})

describe('intakeSheet - assets', () => {
  it('maps the asset master to vehicle_fleet with only the used fields', () => {
    const aoa = [
      ['#', 'Asset No.', 'Asset Desc.', 'Plate No.', 'Chassis No.', 'Serial No', 'Asset Type', 'Asset Location', 'Arabic Location', 'Asset Status', 'Asset Shift', 'Location Change Date', 'KM', 'Brand'],
      ['1', 'FL001', 'FORKLIFT 3T', 'ABC-123', 'CH999', 'SER1', 'Forklift', 'AMAALA', 'x', 'Active', 'Double Shift', '2025-09-07', '12000', 'Toyota'],
    ]
    const res = intakeSheet(aoa, { country: 'KSA' })
    expect(res.target).toBe('vehicle_fleet')
    const r = res.rows[0]
    expect(r.asset_no).toBe('FL001')
    expect(r.vehicle_type).toBe('Forklift')
    expect(r.registration_no).toBe('ABC-123')
    expect(r.chassis_no).toBe('CH999')
    expect(r.site).toBe('AMAALA')
    expect(r.status).toBe('Active')
    expect(r.current_km).toBe('12000')
    expect(r.serial_no).toBe('SER1')            // now a real vehicle_fleet column
    expect(r.asset_extra['Asset No.']).toBe('FL001') // full raw row kept
  })
})

describe('intakeSheet', () => {
  it('maps monthly tyres to tyre_records, dropping the band + footer', () => {
    const res = intakeSheet(TYRE_AOA, { country: 'KSA' })
    expect(res.target).toBe('tyre_records')
    expect(res.rows).toHaveLength(1)
    expect(res.dropped).toBe(1)
    const r = res.rows[0]
    expect(r.serial_no).toBe('K507B403553')
    expect(r.asset_no).toBe('TM556')
    expect(r.issue_date).toBe('2026-07-02')
    expect(r.removal_date).toBe('2026-06-08')
    expect(r.status).toBe('Removed')
    expect(r.removal_reason).toBe('MISUSE')
    expect(r.km_at_fitment).toBe('143067.00')
    expect(r.country).toBe('KSA')
  })
  it('maps complaints to work_orders with NO cost fields, dropping totals + stamp', () => {
    const res = intakeSheet(COMPLAINTS_AOA, { country: 'KSA' })
    expect(res.target).toBe('work_orders')
    expect(res.rows).toHaveLength(1)
    expect(res.dropped).toBe(2) // GRAND TOTAL + Printed By
    const r = res.rows[0]
    expect(r.work_order_no).toBe('GCKR/JC/0153/0726')
    expect(r.asset_no).toBe('MP076')
    expect(r.status).toBe('Completed')
    expect(r.priority).toBe('Medium')
    expect(r.vor).toBe('false')
    expect(r.opened_at).toBe('2026-07-01')
    expect(r.completed_at).toBe('2026-07-02')
    // no cost keys emitted
    expect('parts_cost' in r).toBe(false)
    expect('labour_cost' in r).toBe(false)
  })
  it('detects + maps a COMBINED job-card + tyre export to work orders and tyres', () => {
    const header = ['Asset Location', 'Category', 'Job Card No', 'Job Card In Date', 'Job Card Out Date',
      'Asset No', 'Kilometer', 'complaints', 'qc_remarks', 'work_done_desc', 'Workshop Location', 'JC Remarks',
      'tire_pos', 'srno', 'tire_size', 'fix_date', 'fix_km', 'fix_hm', 'remove_date', 'remove_km', 'remove_hm', 'total_km', 'tyre_brand']
    const row = ['DUBAI', 'Running Repair', 'RM/JC/1', '2026-02-01', '2026-02-01', 'TM536', '214554',
      'Brake Light', 'ok', 'replaced light', 'GC_JEB', 'note', 'RHF1', 'ZZ123', '315/80 R22.5',
      '2026-01-01', '1000', '', '2026-02-01', '5000', '', '4000', 'Double Coin']
    const aoa = [header, row]
    expect(detectReport(aoa).type).toBe(REPORT_TYPES.COMBINED)
    const res = intakeSheet(aoa, { country: 'UAE' })
    expect(res.target).toBe('work_orders')
    expect(res.rows).toHaveLength(1)
    expect(res.tyreRows).toHaveLength(1)
    expect(res.rows[0].work_order_no).toBe('RM/JC/1')
    expect(res.rows[0].asset_no).toBe('TM536')
    expect(res.rows[0].status).toBe('Completed')
    expect(res.rows[0].work_type).toBe('Repair')
    expect(res.rows[0].site).toBe('DUBAI')
    expect(res.tyreRows[0].serial_no).toBe('ZZ123')
    expect(res.tyreRows[0].position).toBe('RHF1')
    expect(res.tyreRows[0].issue_date).toBe('2026-01-01')
    expect(res.tyreRows[0].removal_date).toBe('2026-02-01')
    expect(res.tyreRows[0].status).toBe('Removed')
    expect(res.tyreRows[0].brand).toBe('Double Coin')
    expect(res.tyreRows[0].country).toBe('UAE')
  })
  it('accounts for every body row so nothing slips (read = mapped + noKey; body = read + footer + blank)', () => {
    const res = intakeSheet(COMPLAINTS_AOA, { country: 'KSA' })
    // body below the header row = 3 (data + GRAND TOTAL + Printed By)
    expect(res.read + res.footerRows + res.blankRows).toBe(3)
    expect(res.read).toBe(res.rows.length + res.noKey) // every content row mapped or flagged
    expect(res.footerRows).toBe(2)
    expect(res.blankRows).toBe(0)
    expect(res.noKey).toBe(0)
  })
})
