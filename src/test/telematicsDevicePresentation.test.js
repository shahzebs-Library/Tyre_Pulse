import { describe, it, expect } from 'vitest'
import {
  connectivityState, lastSeenLabel, activeShareLabel, deviceExportRows,
  DEVICE_EXPORT_COLS, DEVICE_EXPORT_HEADERS, analyzeTelematics,
} from '../lib/telematicsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z').getTime()
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString()

describe('telematics presentation helpers', () => {
  it('classifies connectivity with an honest never state', () => {
    expect(connectivityState({}, NOW, 24)).toBe('never')
    expect(connectivityState({ last_seen_at: hoursAgo(2) }, NOW, 24)).toBe('online')
    expect(connectivityState({ last_seen_at: hoursAgo(30) }, NOW, 24)).toBe('offline')
  })
  it('labels last seen age', () => {
    expect(lastSeenLabel({}, NOW)).toBe('Never')
    expect(lastSeenLabel({ last_seen_at: hoursAgo(0.5) }, NOW)).toBe('under 1 h ago')
    expect(lastSeenLabel({ last_seen_at: hoursAgo(5) }, NOW)).toBe('5 h ago')
    expect(lastSeenLabel({ last_seen_at: hoursAgo(72) }, NOW)).toBe('3 d ago')
  })
  it('renders the active share as N/A for an empty registry', () => {
    expect(activeShareLabel(analyzeTelematics([], { now: NOW }).kpis)).toBe('N/A')
    const k = analyzeTelematics([{ status: 'active' }, { status: 'offline' }], { now: NOW }).kpis
    expect(activeShareLabel(k)).toBe('50%')
  })
  it('builds export rows aligned to headers', () => {
    const out = deviceExportRows([{ device_id: 'A1', status: 'active', last_seen_at: hoursAgo(1) }, { device_id: 'B2' }], NOW, 24)
    expect(Object.keys(out[0])).toEqual(DEVICE_EXPORT_COLS)
    expect(DEVICE_EXPORT_HEADERS).toHaveLength(DEVICE_EXPORT_COLS.length)
    expect(out[0].connectivity).toBe('Online')
    expect(out[0].status).toBe('Active')
    expect(out[1].connectivity).toBe('Never')
  })
})
