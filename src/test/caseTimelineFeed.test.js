import { describe, it, expect } from 'vitest'
import {
  buildTimelineFeed, buildParticipants, durationLabel, FILTERS,
  groupMemberCounts, recipientsLabel, deliveryStatusLabel, evidenceVerification, relatedTabFor, channelLabel,
} from '../lib/caseTimelineFeed'
import { TIMELINE_FILTERS } from '../lib/accidentCaseVocab'

const ACC = {
  id: 'acc-1', incident_date: '2026-08-28T09:12:00Z', created_at: '2026-08-28T09:12:00Z',
  driver_name: 'Ibrahim Noor', latitude: 24.7, longitude: 46.6, photos: ['p1', 'p2', 'p3'],
}

describe('FILTERS', () => {
  it('is All plus the four categories the timeline entries carry', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(['all', 'actions', 'documents', 'sla', 'emails'])
  })
  it('mirrors the shared TIMELINE_FILTERS vocabulary exactly (web and Flutter cannot drift)', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(TIMELINE_FILTERS)
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

// ── M1 parity: SLA met badge, honest delivery labels, group counts ──────────
describe('SLA met + related tab + chips', () => {
  it('flags a met SLA row with slaMet=true and status completed; a running one is not met', () => {
    const past = new Date(Date.now() - 3600000).toISOString()
    const feed = buildTimelineFeed({
      slaInstances: [
        { id: 's1', name: 'Vendor receipt', due_at: past, state: 'met', workstream_key: 'handover' },
        { id: 's2', name: 'Assessment', due_at: past, state: 'running', team: 'Workshop' },
      ],
    })
    const met = feed.find((e) => e.id === 'sla-s1')
    const running = feed.find((e) => e.id === 'sla-s2')
    expect(met.slaMet).toBe(true)
    expect(met.detail).toBe('SLA met')
    expect(met.status).toBe('completed')
    expect(met.relatedTab).toBe('handover')
    expect(running.slaMet).toBe(false)
    expect(running.status).toBe('pending')
  })

  it('maps every entry to a real case-detail tab and carries its actor', () => {
    const usersById = new Map([['u1', { full_name: 'Mr. Ajay' }]])
    const feed = buildTimelineFeed({
      acc: ACC,
      usersById,
      workstreamEvents: [{ id: 'w1', at: '2026-08-28T09:34:00Z', workstream_key: 'insurance', action: 'status_changed', to_status: 'completed', actor_id: 'u1' }],
      communications: [{ id: 'c1', occurred_at: '2026-08-28T10:05:00Z', channel: 'email_out', direction: 'outbound', author_name: 'Ms. Fatima' }],
      handovers: [{ id: 'h1', inspected_at: '2026-08-28T11:00:00Z', decision: 'accepted', inspector_name: 'Eng. Vinay' }],
      claim: { id: 'cl1', claim_registered_date: '2026-08-28T12:00:00Z', insurer: 'Gulf' },
    })
    const byId = Object.fromEntries(feed.map((e) => [e.id, e]))
    expect(byId['genesis-acc-1'].relatedTab).toBe('overview')
    expect(byId['genesis-acc-1'].actor).toBe('Ibrahim Noor')
    expect(byId['ws-w1'].relatedTab).toBe('insurance_claim')
    expect(byId['ws-w1'].actor).toBe('Mr. Ajay')
    expect(byId['comm-c1'].relatedTab).toBe('log')
    expect(byId['comm-c1'].actor).toBe('Ms. Fatima')
    expect(byId['handover-h1'].relatedTab).toBe('handover')
    expect(byId['claim-cl1'].relatedTab).toBe('insurance_claim')
    expect(relatedTabFor('nonsense')).toBe('workstreams')
  })

  it('adds a "Verified n/n" chip only where evidence rows exist for that workstream', () => {
    const evidence = [
      { id: 'e1', workstream_key: 'liability', verification_status: 'verified' },
      { id: 'e2', workstream_key: 'liability', verification_status: 'pending' },
      { id: 'e3', workstream_key: 'assessment', verification_status: 'verified' },
    ]
    const feed = buildTimelineFeed({
      acc: ACC,
      evidence,
      workstreamEvents: [
        { id: 'w1', at: '2026-08-28T09:34:00Z', workstream_key: 'liability', action: 'status_changed', to_status: 'completed' },
        { id: 'w2', at: '2026-08-28T09:44:00Z', workstream_key: 'handover', action: 'status_changed', to_status: 'completed' },
      ],
    })
    expect(feed.find((e) => e.id === 'ws-w1').chips).toEqual(['Verified 1/2'])
    expect(feed.find((e) => e.id === 'ws-w2').chips).toEqual([])            // no evidence -> no chip, never "0/0"
    expect(feed.find((e) => e.id === 'genesis-acc-1').chips).toEqual(['Verified 2/3'])
    expect(evidenceVerification([])).toEqual({ verified: 0, total: 0 })
  })

  it('adds an "N recipients" chip only when the group count is derivable', () => {
    const counts = new Map([['insurance', 3]])
    const feed = buildTimelineFeed({
      groupCounts: counts,
      communications: [
        { id: 'c1', occurred_at: '2026-08-28T10:05:00Z', channel: 'email_out', direction: 'outbound', to_party: 'Insurance' },
        { id: 'c2', occurred_at: '2026-08-28T10:06:00Z', channel: 'email_out', direction: 'outbound', to_party: 'Ms. Fatima' },
      ],
    })
    expect(feed.find((e) => e.id === 'comm-c1').chips).toEqual(['3 recipients'])
    expect(feed.find((e) => e.id === 'comm-c2').chips).toEqual([])
  })
})

describe('groupMemberCounts', () => {
  it('counts approved, unlocked profiles per NOTIFY_ROLES group by role name (case-insensitive)', () => {
    const counts = groupMemberCounts([
      { id: '1', role: 'Insurance Officer', approved: true },
      { id: '2', role: 'insurance officer', approved: true },
      { id: '3', role: 'Insurance Officer', approved: false },      // pending - not a recipient
      { id: '4', role: 'Fleet Supervisor', locked: true },          // locked - not a recipient
      { id: '5', role: 'Manager' },
      { id: '6', role: 'PMV Manager' },
    ])
    expect(counts.get('insurance')).toBe(2)
    expect(counts.get('fleet')).toBe(1)
    expect(counts.get('pmv_manager')).toBe(1)
    expect(counts.get('workshop')).toBe(0)
  })
})

describe('recipientsLabel', () => {
  const counts = new Map([['insurance', 3], ['workshop', 0]])
  it('prints "<group> · <count>" when the party is a known group and the count is derivable', () => {
    expect(recipientsLabel({ to_party: 'Insurance' }, counts)).toMatchObject({ label: 'Insurance · 3', count: 3 })
    expect(recipientsLabel({ to_party: 'insurance' }, counts).label).toBe('Insurance · 3')
    expect(recipientsLabel({ to_party: 'Workshop' }, counts).label).toBe('Workshop · 0')
  })
  it('prints the group name alone when no count is derivable - never a fake count', () => {
    expect(recipientsLabel({ to_party: 'Insurance' }, null)).toMatchObject({ label: 'Insurance', count: null })
    expect(recipientsLabel({ to_party: 'Fleet' }, counts).label).toBe('Fleet')   // group known, count absent
  })
  it('passes a named person through and reads a blank as Not set', () => {
    expect(recipientsLabel({ to_party: 'Ms. Fatima' }, counts).label).toBe('Ms. Fatima')
    expect(recipientsLabel({ from_party: 'Vendor manager' }, counts).label).toBe('Vendor manager')
    expect(recipientsLabel({}, counts).label).toBe('Not set')
  })
})

describe('deliveryStatusLabel', () => {
  const now = Date.parse('2026-08-28T10:00:00Z')
  it('says "Delivered n/n" ONLY when per-recipient delivery is recorded on the row', () => {
    expect(deliveryStatusLabel({ direction: 'outbound', occurred_at: '2026-08-28T09:00:00Z', delivery: { delivered: 2, total: 3 } }, now)).toBe('Delivered 2/3')
    // No delivery record -> the honest verb, never an invented n/n.
    expect(deliveryStatusLabel({ direction: 'outbound', occurred_at: '2026-08-28T09:00:00Z' }, now)).toBe('Sent')
    expect(deliveryStatusLabel({ direction: 'outbound', occurred_at: '2026-08-28T09:00:00Z', delivery: { delivered: 0, total: 0 } }, now)).toBe('Sent')
  })
  it('labels inbound as Received and internal notes as Logged', () => {
    expect(deliveryStatusLabel({ direction: 'inbound', occurred_at: '2026-08-28T09:00:00Z' }, now)).toBe('Received')
    expect(deliveryStatusLabel({ direction: 'internal', occurred_at: '2026-08-28T09:00:00Z' }, now)).toBe('Logged')
    expect(deliveryStatusLabel({}, now)).toBe('Logged')
  })
  it('labels a future occurred_at as "Scheduled in <x>"', () => {
    expect(deliveryStatusLabel({ direction: 'outbound', occurred_at: '2026-08-28T10:52:00Z' }, now)).toBe('Scheduled in 52m')
  })
})

describe('channelLabel', () => {
  it('maps the CHECK tokens to plain words and reads a blank as Not set', () => {
    expect(channelLabel('email_out')).toBe('Email')
    expect(channelLabel('in_app')).toBe('In-app')
    expect(channelLabel('external_portal')).toBe('Portal')
    expect(channelLabel('')).toBe('Not set')
  })
})
