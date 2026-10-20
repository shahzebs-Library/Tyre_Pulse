import { describe, it, expect, vi } from 'vitest'
import { parseWorkshopSheet } from '../lib/workshopStatus/excelParser.js'
import {
  compareWorkshopUpload, isManualNewer, localDay, countryTimeZone, normaliseResolution, resolutionSummary,
  CONFLICT_MANUAL_NEWER, DEFAULT_RESOLUTION,
} from '../lib/workshopStatus/compareUpload.js'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
const api = await import('../lib/api/workshopStatus.js')

// Loop 16 - a stale daily Excel must not overwrite a newer manual update.
// Mirror of workshop_status_manual_newer() in migration 20261011140000.

const HEADER = ['SR.NO', 'ASSET NO.', 'REG. NO.', 'JOB CARD NO.', 'LOCATION', 'PRODUCTION / FLEET COMPLIANT',
  'DIAGNOSTICS', 'BREAKDOWN DATE', 'DOWN DAYS', 'REMARKS']
const sheet = (rows, reportDate = '07-10-2026') => parseWorkshopSheet(
  [['GREEN CONCRETE COMPANY CJSC'], ['JOB CARD ENTRY'], [reportDate], ['TRANSIT MIXER'], HEADER, ...rows],
  { sheetName: 'S' })
const line = (sr, asset, complaint) => [String(sr), asset, 'REG', `JC/${asset}`, 'NHC', complaint, '', '01-10-2026', '6', '']
const rec = (id, asset, complaint, manualAt) => ({
  id, asset_no: asset, country: 'KSA', current_active: true, vehicle_category: 'TRANSIT MIXER', reg_no: 'REG', job_card_ref: `JC/${asset}`, site: 'NHC',
  complaint, diagnostics: null, ooc_since: '2026-10-01', excel_down_days: 6, source_remarks: null,
  current_stage: 'Repair in Progress', remarks: 'Engine opened', last_manual_update_at: manualAt,
  last_updated_by_name: 'Super Visor',
})

describe('isManualNewer / localDay', () => {
  it('reads the local calendar day of the country', () => {
    expect(countryTimeZone('KSA')).toBe('Asia/Riyadh')
    expect(countryTimeZone('uae')).toBe('Asia/Dubai')
    expect(countryTimeZone('Egypt')).toBe('Africa/Cairo')
    expect(countryTimeZone('Mars')).toBe('UTC')
    // 22:30 UTC on the 7th is already the 8th in Riyadh.
    expect(localDay('2026-10-07T22:30:00Z', 'KSA')).toBe('2026-10-08')
    expect(localDay('2026-10-07T22:30:00Z', null)).toBe('2026-10-07')
    expect(localDay('nope', 'KSA')).toBe(null)
    expect(localDay(null, 'KSA')).toBe(null)
  })

  it('same day or later is newer; earlier is not; no report date never conflicts', () => {
    expect(isManualNewer('2026-10-07T05:00:00Z', '2026-10-07', 'KSA')).toBe(true)
    expect(isManualNewer('2026-10-09T05:00:00Z', '2026-10-07', 'KSA')).toBe(true)
    expect(isManualNewer('2026-10-06T05:00:00Z', '2026-10-07', 'KSA')).toBe(false)
    expect(isManualNewer('2026-10-07T22:30:00Z', '2026-10-08', 'KSA')).toBe(true)
    expect(isManualNewer('2026-10-07T20:00:00Z', '2026-10-08', 'KSA')).toBe(false)
    expect(isManualNewer('2026-10-07T05:00:00Z', null, 'KSA')).toBe(false)
    expect(isManualNewer(null, '2026-10-07', 'KSA')).toBe(false)
  })

  it('normaliseResolution defaults to keeping TyrePulse', () => {
    expect(DEFAULT_RESOLUTION).toBe('keep_manual')
    expect(normaliseResolution('take_file')).toBe('take_file')
    expect(normaliseResolution('keep_manual')).toBe('keep_manual')
    expect(normaliseResolution('nonsense')).toBe('keep_manual')
    expect(normaliseResolution(undefined)).toBe('keep_manual')
  })
})

describe('compareWorkshopUpload conflicts', () => {
  const preview = sheet([line(1, 'TM1', 'Stale complaint'), line(2, 'TM3', 'Complaint TM3'), line(3, 'TM4', 'Changed')])
  const current = [
    rec('r1', 'TM1', 'Engine', '2026-10-07T08:00:00Z'), // newer manual, changed -> conflict
    rec('r2', 'TM2', 'Gearbox', '2026-10-07T09:00:00Z'), // newer manual, missing -> release conflict
    rec('r3', 'TM3', 'Complaint TM3', '2026-10-08T09:00:00Z'), // newer but unchanged -> no conflict
    rec('r4', 'TM4', 'Old', '2026-10-05T09:00:00Z'), // older manual -> overwritten normally
    rec('r5', 'TM5', 'Gone', null), // never updated by hand -> released normally
  ]
  const cmp = compareWorkshopUpload(preview, current, { country: 'KSA' })

  it('flags newer manual updates on changed and released vehicles only', () => {
    expect(preview.reportDate).toBe('2026-10-07')
    expect(cmp.summary.conflict).toBe(2)
    expect(cmp.conflictRecords.map((c) => [c.asset_no, c.kind])).toEqual([['TM1', 'changed'], ['TM2', 'removed']])
    const tm1 = cmp.changedRecords.find((c) => c.asset_no === 'TM1')
    expect(tm1.conflict).toBe(CONFLICT_MANUAL_NEWER)
    expect(tm1.record.last_updated_by_name).toBe('Super Visor')
    expect(tm1.record.current_stage).toBe('Repair in Progress')
    expect(tm1.changes.complaint).toEqual({ from: 'Engine', to: 'Stale complaint' })
    expect(cmp.changedRecords.find((c) => c.asset_no === 'TM4').conflict).toBeUndefined()
    expect(cmp.removedRecords.find((c) => c.asset_no === 'TM5').conflict).toBeUndefined()
    expect(cmp.removedRecords.find((c) => c.asset_no === 'TM2').conflict).toBe(CONFLICT_MANUAL_NEWER)
  })

  it('an explicit report date option overrides the preview date', () => {
    const later = compareWorkshopUpload(preview, current, { country: 'KSA', reportDate: '2026-10-09' })
    expect(later.summary.conflict).toBe(0)
  })

  it('resolutionSummary counts keep vs take (missing = keep)', () => {
    expect(resolutionSummary(cmp, {})).toEqual({ total: 2, keep: 2, take: 0 })
    expect(resolutionSummary(cmp, { TM2: 'take_file' })).toEqual({ total: 2, keep: 1, take: 1 })
    expect(resolutionSummary(cmp, new Map([['TM1', 'take_file'], ['TM2', 'take_file']]))).toEqual({ total: 2, keep: 0, take: 2 })
    expect(resolutionSummary(null)).toEqual({ total: 0, keep: 0, take: 0 })
  })

  it('buildStagedRows sends a resolution only on conflicting rows (default keep)', () => {
    const rows = api.buildStagedRows(cmp, preview, { resolutions: { TM2: 'take_file' } })
    const by = (a, o) => rows.find((r) => r.asset_no === a && r.outcome === o)
    expect(by('TM1', 'changed').resolution).toBe('keep_manual')
    expect(by('TM2', 'removed').resolution).toBe('take_file')
    expect(by('TM4', 'changed')).not.toHaveProperty('resolution')
    expect(by('TM5', 'removed')).not.toHaveProperty('resolution')
    expect(by('TM3', 'unchanged')).not.toHaveProperty('resolution')
    const plain = api.buildStagedRows(cmp, preview)
    expect(plain.find((r) => r.asset_no === 'TM1').resolution).toBe('keep_manual')
  })
})
