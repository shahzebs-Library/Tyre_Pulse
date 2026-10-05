import { describe, it, expect } from 'vitest'
import {
  signalFeed, signalCounts, filterSignals, aiKpis, traceRows, clampQuestion, MAX_QUESTION, agentTone, agoText,
  dailyCounts, signalPicture,
} from '../lib/aiCommandCenterView'
import { AGENT_TYPES } from '../lib/aiRouter'

const NOW = new Date('2026-10-05T12:00:00Z')

describe('aiCommandCenterView', () => {
  const alerts = [
    { id: 1, severity: 'Medium', alert_type: 'tyre_risk', message: 'Low tread on LHF1', asset_no: 'TM1', created_at: '2026-10-05T11:00:00Z' },
    { id: 2, severity: 'Critical', alert_type: 'accident', message: 'Collision reported', asset_no: 'TM2', created_at: '2026-10-05T09:00:00Z' },
    { id: 3, severity: null, message: null, created_at: null },
  ]

  it('signalFeed orders worst first, routes to an agent and builds a question', () => {
    const feed = signalFeed(alerts, NOW)
    expect(feed.map((s) => s.id)).toEqual([2, 1, 3])
    expect(feed[0].agent).toBe(AGENT_TYPES.SAFETY)
    expect(feed[0].question).toContain('TM2')
    expect(feed[1].title).toBe('Tyre risk')
    expect(feed[2]).toMatchObject({ severity: 'Info', title: 'Fleet alert', message: 'Fleet alert' })
  })

  it('counts and filters by severity', () => {
    const feed = signalFeed(alerts, NOW)
    const c = signalCounts(feed)
    expect(c).toMatchObject({ all: 3, Critical: 1, Medium: 1, Info: 1 })
    expect(filterSignals(feed, 'Critical')).toHaveLength(1)
    expect(filterSignals(feed, 'all')).toHaveLength(3)
  })

  it('aiKpis shows null when a source did not load, never a fake 0', () => {
    const k = aiKpis({ signals: [], signalsReady: false, usage: null, usageReady: false, conversations: [], conversationsReady: false })
    expect(k.filter((t) => t.key !== 'savings').every((t) => (t.value ?? null) === null && (t.display ?? null) === null)).toBe(true)
    expect(k.usageLine).toEqual({ requests: null, failed: null, spend: null, conversations: null })
  })

  it('aiKpis measures usage from summarizeUsage output', () => {
    const k = aiKpis({
      signals: signalFeed(alerts, NOW), signalsReady: true,
      usage: { totalCalls: 9, failedCalls: 1, totalCost: 1.234 }, usageReady: true,
      conversations: [{}, {}], conversationsReady: true,
    })
    const by = Object.fromEntries(k.map((t) => [t.key, t]))
    expect(by.critical.value).toBe(1)
    expect(by.open.value).toBe(2)
    expect(by.savings.display).toBe('Not recorded')
    expect(by.success.display).toBe('90%')
    expect(k.usageLine).toEqual({ requests: 10, failed: 1, spend: 'USD 1.23', conversations: 2 })
  })

  it('aiKpis gives N/A success when nothing was asked', () => {
    const k = aiKpis({ signals: [], signalsReady: true, usage: { totalCalls: 0, failedCalls: 0, totalCost: 0 }, usageReady: true, conversations: [], conversationsReady: true })
    expect(k.find((t) => t.key === 'success').display).toBe('N/A')
  })

  it('traceRows orders newest first and labels agents', () => {
    const rows = traceRows([
      { id: 'a', title: '', agent: null, updated_at: '2026-10-01' },
      { id: 'b', title: 'CPK', agent: AGENT_TYPES.ANALYST, updated_at: '2026-10-04' },
    ])
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows[0]).toMatchObject({ n: 1, agentLabel: 'Analyst' })
    expect(rows[1]).toMatchObject({ title: 'Untitled conversation', agentLabel: 'Auto' })
  })

  it('clamps the question and gives every agent a tone', () => {
    expect(clampQuestion('x'.repeat(500))).toHaveLength(MAX_QUESTION)
    expect(clampQuestion(null)).toBe('')
    Object.values(AGENT_TYPES).forEach((t) => expect(agentTone(t).icon).toMatch(/^t-/))
    expect(agoText('2026-10-05T11:59:50Z', NOW)).toBe('Just now')
  })
})

describe('aiCommandCenterView fix round', () => {
  it('forecast risk reads the PM count only once loaded', () => {
    const base = { signals: [], signalsReady: true, usage: null, usageReady: false, conversations: [], conversationsReady: true }
    expect(aiKpis({ ...base, forecast: 4, forecastReady: false }).find((t) => t.key === 'forecast').value).toBeNull()
    expect(aiKpis({ ...base, forecast: 4, forecastReady: true }).find((t) => t.key === 'forecast').value).toBe(4)
  })
  it('dailyCounts zero-fills the window on local days', () => {
    const now = new Date(2026, 9, 5, 12)
    const s = dailyCounts([
      { created_at: new Date(2026, 9, 5, 8).toISOString() },
      { created_at: new Date(2026, 9, 3, 8).toISOString() },
      { created_at: new Date(2026, 8, 1).toISOString() },
      { created_at: null },
    ], now, 5)
    expect(s).toEqual([0, 0, 1, 0, 1])
  })
  it('signalPicture picks a topic picture', () => {
    expect(signalPicture({ title: 'Fuel anomaly' })).toContain('fuel')
    expect(signalPicture({ message: 'Odometer record conflict' })).toContain('data')
    expect(signalPicture({ title: 'Breakdown overdue' })).toContain('workshop')
    expect(signalPicture({ title: 'Tyre risk' })).toContain('tyre')
  })
})
