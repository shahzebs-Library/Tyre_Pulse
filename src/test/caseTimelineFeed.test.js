import { describe, it, expect } from 'vitest'
import { buildTimelineFeed, buildParticipants, durationLabel, FILTERS } from '../lib/caseTimelineFeed'

const ACC = {
  id: 'acc-1', incident_date: '2026-08-28T09:12:00Z', created_at: '2026-08-28T09:12:00Z',
  driver_name: 'Ibrahim Noor', latitude: 24.7, longitude: 46.6, photos: ['p1', 'p2', 'p3'],
}

describe('FILTERS', () => {
  it('is All plus the four categories the timeline entries carry', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(['all', 'actions', 'documents', 'sla', 'emails'])
  })
})

describe('buildTimelineFeed', () => {
  it('returns the genesis "Accident reported" entry from the accidents row alone', () => {
    const feed = buildTimelineFeed({ acc: ACC })
    expect(feed).toHaveLength(1)
    expect(feed[0].title).toBe('Accident reported')
    expect(feed[0].subtitle).toBe('by Ibrahim Noor')
    expect(feed[0].detail).toBe('GPS · 3 photos attached')
    expect(feed[0].status).toBe('completed')
    expect(feed[0].durationMs).toBeNull()
  })

  it('omits GPS/photo mentions when neither is present, never fabricating them', () => {
    const feed = buildTimelineFeed({ acc: { id: 'a2', incident_date: '2026-01-01', driver_name: 'X' } })
    expect(feed[0].detail).toBe('')
  })

  it('sorts every source into one chronological feed and computes elapsed time between entries', () => {
    const feed = buildTimelineFeed({
      acc: ACC,
      workstreamEvents: [
        { id: 'w1', at: '2026-08-28T09:34:00Z', workstream_key: 'fleet_validation', action: 'status_changed', to_status: 'completed', actor_id: 'u1' },
      ],
      communications: [
        { id: 'c1', occurred_at: '2026-08-28T10:05:00Z', channel: 'email_out', subject: 'Documents package sent', direction: 'outbound', to_party: 'Ms. Fatima / Insurance group' },
      ],
    })
    expect(feed.map((e) => e.title)).toEqual([
      'Accident reported', 'Fleet Validation completed', 'Documents package sent',
    ])
    // 09:12 -> 09:34 = 22 minutes; 09:34 -> 10:05 = 31 minutes.
    expect(feed[1].durationMs).toBe(22 * 60000)
    expect(feed[2].durationMs).toBe(31 * 60000)
  })

  it('never invents a workstream verb the status token does not say - uses the real token, humanised', () => {
    const feed = buildTimelineFeed({
      workstreamEvents: [
        { id: 'w1', at: '2026-08-28T12:10:00Z', workstream_key: 'assessment', action: 'status_changed', to_status: 'in_progress' },
      ],
    })
    expect(feed[0].title).toBe('Assessment started')
  })

  it('categorises a communication as emails only for the email channels', () => {
    const feed = buildTimelineFeed({
      communications: [
        { id: 'c1', occurred_at: '2026-08-28T10:00:00Z', channel: 'email_out', direction: 'outbound' },
        { id: 'c2', occurred_at: '2026-08-28T10:01:00Z', channel: 'call', direction: 'outbound' },
      ],
    })
    expect(feed.find((e) => e.id === 'comm-c1').category).toBe('emails')
    expect(feed.find((e) => e.id === 'comm-c2').category).toBe('actions')
  })

  it('adds a claim-registered entry only when the claim has a registered date', () => {
    const withDate = buildTimelineFeed({ claim: { id: 'cl1', claim_registered_date: '2026-08-28', insurer: 'Gulf', claim_no: 'CLM-1' } })
    expect(withDate).toHaveLength(1)
    expect(withDate[0].title).toBe('Claim registered')
    expect(withDate[0].subtitle).toBe('Gulf · Claim no. CLM-1')

    const withoutDate = buildTimelineFeed({ claim: { id: 'cl1' } })
    expect(withoutDate).toHaveLength(0)
  })

  it('marks a running, overdue SLA instance pending with an honest "not started" detail', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    const feed = buildTimelineFeed({
      slaInstances: [{ id: 's1', name: 'Vendor receipt', due_at: past, state: 'running', team: 'Vendor', breached: false }],
    })
    expect(feed[0].status).toBe('pending')
    expect(feed[0].detail).toBe('Vendor SLA not started')
  })

  it('never fabricates an entry for a source with no timestamp', () => {
    const feed = buildTimelineFeed({
      workstreamEvents: [{ id: 'w1', workstream_key: 'repair', action: 'assigned' }], // no `at`
      handovers: [{ id: 'h1', decision: 'accepted' }], // no `inspected_at`
    })
    expect(feed).toHaveLength(0)
  })
})

describe('durationLabel', () => {
  it('returns null for a null/undefined duration (the first entry)', () => {
    expect(durationLabel(null)).toBeNull()
    expect(durationLabel(undefined)).toBeNull()
  })
  it('formats minutes, hours+minutes, and days+hours', () => {
    expect(durationLabel(22 * 60000)).toBe('22m')
    expect(durationLabel(75 * 60000)).toBe('1h 15m')
    expect(durationLabel(60 * 60000)).toBe('1h')
    expect(durationLabel(30 * 3600000)).toBe('1d 6h')
  })
})

describe('buildParticipants', () => {
  it('names a real workstream owner, and falls back to the team when no owner is on record', () => {
    const usersById = new Map([['u1', { full_name: 'Mr. Ajay' }]])
    const participants = buildParticipants({
      workstreamRows: [
        { owner_id: 'u1', team: 'Fleet' },
        { owner_id: null, team: 'Insurance' },
      ],
      usersById,
    })
    expect(participants.map((p) => p.name)).toEqual(['Insurance', 'Mr. Ajay'])
  })

  it('collects communication authors/recipients and handover inspectors, deduped by name', () => {
    const participants = buildParticipants({
      communications: [
        { author_name: 'Ms. Fatima', to_party: 'Ms. Fatima' }, // same person, two roles - one entry
        { from_party: 'Vendor manager' },
      ],
      handovers: [{ inspector_name: 'Eng. Vinay' }],
    })
    const names = participants.map((p) => p.name)
    expect(names).toContain('Ms. Fatima')
    expect(names).toContain('Vendor manager')
    expect(names).toContain('Eng. Vinay')
    expect(new Set(names).size).toBe(names.length)
  })

  it('never invents a person from nothing', () => {
    expect(buildParticipants({})).toEqual([])
  })
})
