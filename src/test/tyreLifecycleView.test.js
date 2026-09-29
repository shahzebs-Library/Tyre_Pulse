import { describe, it, expect } from 'vitest'
import {
  rlKey, indexRunningLife, lifeStatus, buildRows, viewKpis, tabRows, filterViewRows,
  positionCorner, lifeProgression, removalReasons, topBrandsByLife, viewExportRows, VIEW_EXPORT_COLS,
} from '../lib/tyreLifecycleView'

const rl = (o) => ({ serial: 'S1', asset: 'TM1', position: 'LHF1', unit: 'km', remainingKm: 30000, lifeUsedPct: 50, kmRun: 30000, currentKm: 120000, ...o })

describe('tyreLifecycleView', () => {
  it('keys ignore case and padding', () => {
    expect(rlKey(' s1', 'tm1 ', 'lhf1')).toBe(rlKey('S1', 'TM1', 'LHF1'))
  })

  it('maps stage and band to a status', () => {
    expect(lifeStatus('Removed', 'overdue')).toBe('Removed')
    expect(lifeStatus('In Service', 'due-soon')).toBe('Near End')
    expect(lifeStatus('In Service', 'overdue')).toBe('Near End')
    expect(lifeStatus('In Service', 'healthy')).toBe('Normal')
    expect(lifeStatus('In Service', null)).toBe('In Service')
  })

  it('joins running life for active tyres only and never invents life', () => {
    const idx = indexRunningLife([rl(), rl({ serial: 'S2', remainingKm: 2000, lifeUsedPct: 95 })])
    const rows = buildRows([
      { id: 1, serial_number: 'S1', asset_no: 'TM1', position: 'LHF1' },
      { id: 2, serial_number: 'S2', asset_no: 'TM1', position: 'LHF1' },
      { id: 3, serial_number: 'S3', asset_no: 'TM1', position: 'RHF1' },
      { id: 4, serial_number: 'S1', asset_no: 'TM1', position: 'LHF1', km_at_fitment: 10, km_at_removal: 40010, removal_date: '2026-01-01' },
    ], idx)
    expect(rows[0]._status).toBe('Normal')
    expect(rows[0]._lifePct).toBe(50)
    expect(rows[0]._currentKm).toBe(120000)
    expect(rows[1]._status).toBe('Near End')
    expect(rows[2]._status).toBe('In Service')
    expect(rows[2]._lifePct).toBeNull()
    expect(rows[3]._stage).toBe('Removed')
    expect(rows[3]._rl).toBeNull()
    const k = viewKpis(rows)
    expect(k).toEqual({ total: 4, active: 3, nearEnd: 1, inService: 2, removed: 1 })
    expect(tabRows(rows, 'removed')).toHaveLength(1)
    expect(tabRows(rows, 'inService')).toHaveLength(3)
  })

  it('filters by status, position and fitment date', () => {
    const rows = [
      { serial_number: 'A', position: 'LHF1', issue_date: '2026-03-01', _status: 'Normal', _category: 'New' },
      { serial_number: 'B', position: 'RHR1-O', issue_date: '2025-01-01', _status: 'Near End', _category: 'New' },
      { serial_number: 'C', position: 'LHF1', issue_date: null, _status: 'Normal', _category: 'New' },
    ]
    expect(filterViewRows(rows, { status: 'Near End' }).map((r) => r.serial_number)).toEqual(['B'])
    expect(filterViewRows(rows, { position: 'lhf1' })).toHaveLength(2)
    expect(filterViewRows(rows, { from: '2026-01-01' }).map((r) => r.serial_number)).toEqual(['A'])
    expect(filterViewRows(rows, { status: 'All' })).toHaveLength(3)
  })

  it('reads the wheel corner from a position code', () => {
    expect(positionCorner('LHF1')).toBe('FL')
    expect(positionCorner('RHF2')).toBe('FR')
    expect(positionCorner('LHR1-O')).toBe('RL')
    expect(positionCorner('RHC1-I')).toBe('RR')
    expect(positionCorner('SPARE')).toBeNull()
  })

  it('averages life used per distance bucket and corner', () => {
    const rows = [
      { position: 'LHF1', _rl: rl({ kmRun: 5000, lifeUsedPct: 10 }) },
      { position: 'LHF1', _rl: rl({ kmRun: 15000, lifeUsedPct: 20 }) },
      { position: 'RHR1', _rl: rl({ kmRun: 130000, lifeUsedPct: 120 }) },
      { position: 'LHF1', _rl: rl({ kmRun: null }) },
    ]
    const p = lifeProgression(rows)
    expect(p.sample).toBe(3)
    expect(p.series.find((s) => s.corner === 'FL').points).toEqual([{ x: 0, y: 15, n: 2 }])
    expect(p.series.find((s) => s.corner === 'RR').points[0].x).toBe(120000)
  })

  it('skips brands leaked into removal reason', () => {
    const rows = [
      { _stage: 'Removed', removal_reason: 'Worn out' },
      { _stage: 'Removed', removal_reason: 'WORN OUT' },
      { _stage: 'Removed', removal_reason: 'ROADX' },
      { _stage: 'Scrapped', removal_reason: 'Puncture' },
      { _stage: 'In Service', removal_reason: 'Puncture' },
    ]
    const r = removalReasons(rows)
    expect(r.removed).toBe(4)
    expect(r.unrecorded).toBe(1)
    expect(r.segments[0]).toEqual({ label: 'WORN OUT', count: 2 })
    expect(r.segments.some((s) => s.label === 'ROADX')).toBe(false)
  })

  it('ranks brands by measured life with a minimum sample', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ brand: 'A', _km: 50000 })),
      ...Array.from({ length: 5 }, () => ({ brand: 'B', _km: 70000 })),
      { brand: 'C', _km: 999999 },
    ]
    expect(topBrandsByLife(rows).map((b) => b.brand)).toEqual(['B', 'A'])
  })

  it('adds status and life used to the export', () => {
    const rows = buildRows([{ id: 1, serial_number: 'X', brand: 'A' }], new Map())
    const out = viewExportRows(rows)
    expect(VIEW_EXPORT_COLS).toContain('status')
    expect(out[0].status).toBe('In Service')
    expect(out[0].life_used).toBe('N/A')
  })
})
