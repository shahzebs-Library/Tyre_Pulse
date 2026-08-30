import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const page = fs.readFileSync(`${process.cwd()}/src/pages/DailyOps.jsx`, 'utf8')
const api = fs.readFileSync(`${process.cwd()}/src/lib/api/actionCenter.js`, 'utf8')

describe('Daily Operations advanced workflow contract', () => {
  it('provides ownership, site, shift, SLA and realtime controls', () => {
    expect(page).toContain('My work')
    expect(page).toContain('Filter operational work by site')
    expect(page).toContain('Filter operational work by shift')
    expect(page).toContain('sla_due_at')
    expect(page).toContain('subscribeToActionItems')
  })

  it('uses audited lifecycle transitions and exposes history', () => {
    expect(api).toContain("rpc('transition_action_item'")
    expect(api).toContain("from('action_item_history')")
    expect(page).toContain('Block work')
    expect(page).toContain('Escalate work')
    expect(page).toContain('Approve work')
  })

  it('supports accountable shift handover', () => {
    expect(page).toContain('Submit handover')
    expect(page).toContain('Accept handover')
    expect(page).toContain('open items included')
  })
})
