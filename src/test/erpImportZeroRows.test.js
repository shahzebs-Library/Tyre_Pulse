import { describe, it, expect } from 'vitest'
import { rowHasKey, sheetMatchQuality, isEmptyMappedRow, DATASETS } from '../lib/erpImport'
import { intakeSheet } from '../lib/erpIntake'
import { summarizeCommitResult } from '../lib/import/diagnostics'

// These pin the defects behind "the import always comes back zero". Each case is
// the real shape that was measured on the live database, not an invented one.

describe('a row without its identifying value is not a row', () => {
  it('rejects the exact shape that saved 18 empty rows as a success', () => {
    // Measured live: erp_tyre_change_import held 18 rows where asset_no,
    // serial_no, tire_pos, fix_date, job_card and tyre_brand were ALL null and
    // only `site` was populated, because the word "location" happened to match
    // the site alias. The user was told "Saved 18 of 18 rows" with a tick.
    const ghost = { site: 'NHC', country: 'KSA' }
    expect(isEmptyMappedRow('change', ghost)).toBe(false)   // the old test passed it
    expect(rowHasKey('change', ghost)).toBe(false)          // the new one does not
  })

  it('keeps a row that carries its key', () => {
    expect(rowHasKey('change', { serial_no: 'EP060420711', site: 'NHC' })).toBe(true)
    expect(rowHasKey('asset', { asset_no: 'TM330' })).toBe(true)
  })

  it('treats a blank or whitespace key as absent', () => {
    expect(rowHasKey('asset', { asset_no: '' })).toBe(false)
    expect(rowHasKey('asset', { asset_no: '   ' })).toBe(false)
    expect(rowHasKey('asset', { asset_no: null })).toBe(false)
  })

  it('is safe on nothing', () => {
    expect(rowHasKey('change', null)).toBe(false)
    expect(rowHasKey('nosuchdataset', { serial_no: 'X' })).toBe(false)
  })

  it('every dataset declares the key this test depends on', () => {
    // If a dataset ever loses its keyField the guard silently weakens back to
    // "not every column is null", which is what let the empty rows through.
    Object.values(DATASETS).forEach((ds) => {
      expect(ds.keyField, `${ds.key} has no keyField`).toBeTruthy()
    })
  })
})

describe('sheetMatchQuality tells the user they picked the wrong tab', () => {
  it('calls a sheet unusable when rows mapped but none is identifiable', () => {
    const rows = [
      { site: 'NHC', country: 'KSA' },
      { site: 'RUMAH', country: 'KSA' },
    ]
    const q = sheetMatchQuality('change', rows)
    expect(q.read).toBe(2)
    expect(q.nonEmpty).toBe(2)
    expect(q.keyed).toBe(0)
    expect(q.unusable).toBe(true)
    expect(q.keyField).toBe('serial_no')
  })

  it('is NOT unusable when the sheet is simply empty', () => {
    // An empty sheet and a mismatched sheet are different problems and must not
    // produce the same message.
    const q = sheetMatchQuality('change', [])
    expect(q.unusable).toBe(false)
  })

  it('is NOT unusable when rows carry their key', () => {
    const q = sheetMatchQuality('change', [{ serial_no: 'A1' }, { serial_no: 'A2' }])
    expect(q.keyed).toBe(2)
    expect(q.unusable).toBe(false)
  })
})

describe('a blank date must not abort the whole batch', () => {
  // work_orders.opened_at is NOT NULL with a now() default, and a column default
  // does NOT apply when the client sends an explicit null. One blank "Vehicle In
  // Date" anywhere in an ERP file used to kill the entire import at zero rows,
  // with a sanitized message that never named the column.
  // Headers match the real COMPLAINTS signature the detector requires:
  // complaints + job done description + vehicle in date.
  const COMPLAINTS = [
    ['Veh No.', 'Driver Name', 'Location', 'JC No.', 'Complaints',
     'Job Done Description', 'QC Remarks', 'Vehicle In Date', 'Vehicle Out Date'],
    ['TM100', 'A. Khan', 'NHC', 'JC-1', 'Brake noise', 'Pads replaced', 'OK', '01-02-2026', '03-02-2026'],
    ['TM101', 'R. Ali', 'NHC', 'JC-2', 'Tyre wear', 'Rotated', 'OK', '', ''],
  ]

  it('omits opened_at entirely when the date is blank', () => {
    const res = intakeSheet(COMPLAINTS, 'KSA')
    const wos = res.workOrders || res.rows || []
    const blank = wos.find((w) => w.work_order_no === 'JC-2')
    expect(blank).toBeTruthy()
    // The key must be ABSENT, not present-and-null. Present-and-null is what
    // defeats the column default.
    expect(Object.prototype.hasOwnProperty.call(blank, 'opened_at')).toBe(false)
  })

  it('still sends opened_at when the date is there', () => {
    const res = intakeSheet(COMPLAINTS, 'KSA')
    const wos = res.workOrders || res.rows || []
    const dated = wos.find((w) => w.work_order_no === 'JC-1')
    expect(dated?.opened_at).toBeTruthy()
  })

  it('never sends an explicit null opened_at for any row', () => {
    const res = intakeSheet(COMPLAINTS, 'KSA')
    const wos = res.workOrders || res.rows || []
    expect(wos.length).toBeGreaterThan(0)
    wos.forEach((w) => {
      if (Object.prototype.hasOwnProperty.call(w, 'opened_at')) {
        expect(w.opened_at).toBeTruthy()
      }
    })
  })
})

describe('a zero-row commit is never reported as a success', () => {
  // The server used to return 'committed' when it inserted nothing, so the page
  // drew a green tick reading "Committed - 0 row(s) inserted". Confirmed in the
  // production audit log: warranty_claims on 2026-07-12 reported inserted 0 /
  // failed 0 as a success, right after the same batch honestly reported 22
  // failures.
  it('grades nothing_to_commit as a warning, not ok', () => {
    const res = summarizeCommitResult({
      status: 'nothing_to_commit', inserted: 0, failed: 0, remaining: 0,
      not_eligible: { 'insert/error': 101 },
    })
    expect(res.level).toBe('warn')
    expect(res.headline.toLowerCase()).toContain('nothing was imported')
  })

  it('still warns when an older backend calls a zero-row run committed', () => {
    const res = summarizeCommitResult({ status: 'committed', inserted: 0, failed: 0, remaining: 0 })
    expect(res.level).toBe('warn')
  })

  it('names the earlier-failure cause so the user knows to start a new batch', () => {
    const res = summarizeCommitResult({
      status: 'nothing_to_commit', inserted: 0, failed: 0,
      not_eligible: { 'insert/error': 101 },
    })
    expect(res.hints.join(' ')).toMatch(/earlier attempt/i)
    expect(res.hints.join(' ')).toMatch(/new batch/i)
  })

  it('names the already-in-the-system cause differently', () => {
    // Opposite problem, opposite fix. These two must never read the same.
    const res = summarizeCommitResult({
      status: 'nothing_to_commit', inserted: 0, failed: 0,
      not_eligible: { 'skip/ready': 94 },
    })
    expect(res.hints.join(' ')).toMatch(/already exist/i)
    expect(res.hints.join(' ')).not.toMatch(/earlier attempt/i)
  })

  it('does NOT claim nothing was imported for an already-committed batch', () => {
    // That batch DID import its rows, on an earlier run.
    const res = summarizeCommitResult({ status: 'already_committed', inserted: 0 })
    expect(res.headline.toLowerCase()).toContain('already committed')
    expect(res.headline.toLowerCase()).not.toContain('nothing was imported')
  })

  it('still grades a real import as ok', () => {
    const res = summarizeCommitResult({ status: 'committed', inserted: 602, failed: 0, remaining: 0 })
    expect(res.level).toBe('ok')
  })
})
