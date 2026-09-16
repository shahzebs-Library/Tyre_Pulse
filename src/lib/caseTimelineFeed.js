/**
 * caseTimelineFeed.js — pure composer behind the "Case timeline & notifications"
 * page (mockup: a dedicated screen with 4 SLA chips, a Timeline / Notifications /
 * Participants tab strip, filterable timeline entries, and a notification
 * delivery log). No I/O - the service layer (api/caseTimelineFeed.js) loads the
 * real rows and this module merges them into one chronological feed.
 *
 * WHY MULTIPLE REAL SOURCES, NOT ONE TABLE: no single table carries every entry
 * the mockup shows (a report, a workstream milestone, a sent document, a claim
 * registration, a handover inspection, an SLA due date all being genuinely
 * different facts recorded in different places) - so this composes them from
 * the tables that actually hold them, verified live before this file was
 * written:
 *   - the accidents row itself       -> the genesis "reported" entry
 *   - accident_case_workstream_events -> workstream milestones (V429 audit ledger)
 *   - accident_case_communications    -> sent/received notices
 *   - accident_handover_inspections   -> dispatch/receipt inspections
 *   - accident_sla_instances          -> SLA due/breach entries
 *   - accident_insurance_claims       -> the claim-registered entry
 *
 * HONESTY RULE: every title/subtitle/detail below is DERIVED from a real
 * column, never invented. Where the mockup's wording implies data this app does
 * not capture (a photo GPS pin's exact coordinates as a caption, per-recipient
 * delivery percentages, a named "vendor manager") the entry states only what is
 * actually known (a GPS reading is present or it is not; a recipient is named
 * when the row names one, otherwise it is left out rather than guessed).
 */

import { NOTIFY_ROLES } from './accidentCaseVocab'

const CATEGORY = { ACTIONS: 'actions', DOCUMENTS: 'documents', SLA: 'sla', EMAILS: 'emails' }

// Which case-detail tab an entry "belongs" to (the drawer's "Open related tab"
// link). Keys are AccidentDetailModal's TABS keys.
const WORKSTREAM_TAB = {
  fleet_validation: 'fleet_validation', assessment: 'assessment', insurance: 'insurance_claim',
  liability: 'liability', damage_map: 'damage_map', handover: 'handover',
}
export const relatedTabFor = (workstreamKey, fallback = 'workstreams') => WORKSTREAM_TAB[workstreamKey] || fallback

export const CHANNEL_LABEL = {
  in_app: 'In-app', email_out: 'Email', email_in: 'Email', comment: 'Comment', call: 'Call', external_portal: 'Portal',
}
export const channelLabel = (channel) => CHANNEL_LABEL[channel] || (channel ? String(channel).replace(/_/g, ' ') : 'Not set')

/**
 * Members per NOTIFY_ROLES group from the org's profiles - the ONLY honest
 * source for a "<group> · <count>" recipients cell. Counts approved, unlocked
 * profiles whose role is one of the group's roles. Returns Map(groupKey ->
 * count); a group with no members is present with 0 (0 is a fact, not a gap).
 */
export function groupMemberCounts(profiles = []) {
  const counts = new Map(NOTIFY_ROLES.map((g) => [g.key, 0]))
  for (const p of profiles || []) {
    if (!p || p.approved === false || p.locked === true) continue
    const role = String(p.role || '').trim().toLowerCase()
    if (!role) continue
    for (const g of NOTIFY_ROLES) {
      if (g.roles.some((r) => r.toLowerCase() === role)) counts.set(g.key, (counts.get(g.key) || 0) + 1)
    }
  }
  return counts
}

/** The NOTIFY_ROLES group a to_party string names (by key or label), or null. */
export function groupForParty(party) {
  const k = String(party || '').trim().toLowerCase()
  if (!k) return null
  return NOTIFY_ROLES.find((g) => g.key === k || g.label.toLowerCase() === k || `${g.label.toLowerCase()} group` === k) || null
}

/**
 * Recipients cell: "<group> · <count>" when to_party is a known group AND the
 * count is derivable; the group name alone when it is not; the raw party
 * (a named person) otherwise; 'Not set' for a blank. Never a fake count.
 * @returns {{label:string, count:number|null, group:object|null}}
 */
export function recipientsLabel(comm, groupCounts = null) {
  const party = comm?.to_party || comm?.from_party || ''
  if (!party) return { label: 'Not set', count: null, group: null }
  const group = groupForParty(party)
  if (!group) return { label: party, count: null, group: null }
  const n = groupCounts?.get?.(group.key)
  const count = Number.isFinite(n) ? n : null
  return { label: count != null ? `${group.label} · ${count}` : group.label, count, group }
}

/**
 * Status cell. "Delivered n/n" ONLY when per-recipient delivery is recorded on
 * the row (a `delivery` object {delivered,total} the delivery pipeline may
 * stamp; this app records none today), otherwise the honest verbs: a future
 * occurred_at is "Scheduled in <x>", an outbound row "Sent", an inbound row
 * "Received", an internal note "Logged".
 */
export function deliveryStatusLabel(comm, now = Date.now()) {
  const d = comm?.delivery
  if (d && Number.isFinite(Number(d.delivered)) && Number.isFinite(Number(d.total)) && Number(d.total) > 0) {
    return `Delivered ${Number(d.delivered)}/${Number(d.total)}`
  }
  const at = comm?.occurred_at ? new Date(comm.occurred_at).getTime() : NaN
  if (Number.isFinite(at) && at > now + 60000) return `Scheduled in ${durationLabel(at - now)}`
  if (comm?.direction === 'outbound') return 'Sent'
  if (comm?.direction === 'inbound') return 'Received'
  return 'Logged'
}

/** verified/total evidence rows, optionally for one workstream. */
export function evidenceVerification(evidence = [], workstreamKey = null) {
  const rows = (evidence || []).filter((e) => e && (!workstreamKey || e.workstream_key === workstreamKey))
  const verified = rows.filter((e) => e.verification_status === 'verified').length
  return { verified, total: rows.length }
}

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: CATEGORY.ACTIONS, label: 'Actions' },
  { key: CATEGORY.DOCUMENTS, label: 'Documents' },
  { key: CATEGORY.SLA, label: 'SLA' },
  { key: CATEGORY.EMAILS, label: 'Emails' },
]

function nameOf(usersById, id) {
  if (!id) return null
  const u = usersById?.get?.(id)
  return u?.full_name || u?.name || u?.email || null
}

function compact(parts) {
  return parts.filter((p) => p != null && String(p).trim() !== '')
}

// action/to_status -> a plain, honest verb. Never invents an emotive word
// ("accepted") the data itself does not assert - "completed" is what the
// status token actually says.
function workstreamVerb(action, toStatus) {
  if (action === 'na_marked') return 'marked not applicable'
  if (action === 'reopened') return 'reopened'
  if (action === 'assigned') return 'assigned'
  if (toStatus === 'completed') return 'completed'
  if (toStatus === 'in_progress') return 'started'
  if (toStatus === 'rejected') return 'rejected'
  if (toStatus === 'cancelled') return 'cancelled'
  if (['waiting_info', 'waiting_approval', 'waiting_external', 'on_hold'].includes(toStatus)) return 'waiting'
  return toStatus ? toStatus.replace(/_/g, ' ') : 'updated'
}

const HANDOVER_LABEL = {
  accepted: 'Handover inspection accepted',
  rejected: 'Handover inspection rejected',
  rectification_required: 'Handover inspection - rectification required',
}

/**
 * @param {object} p
 * @param {object} p.acc - the accidents row
 * @param {object[]} [p.workstreamEvents] - listWorkstreamEvents rows
 * @param {object[]} [p.communications] - listCommunications rows
 * @param {object[]} [p.handovers] - listHandoverInspections rows
 * @param {object[]} [p.slaInstances] - listSlaInstances rows
 * @param {object|null} [p.claim] - getInsuranceClaim result
 * @param {Map} [p.usersById] - uuid -> profile, for actor-name resolution
 * @returns {{id:string, at:string, category:string, title:string, subtitle:string,
 *   detail:string, status:'completed'|'in_progress'|'pending', durationMs:number|null}[]}
 *   sorted oldest first, each carrying the elapsed time since the PRIOR entry.
 */
export function buildTimelineFeed({
  acc, workstreamEvents = [], communications = [], handovers = [], slaInstances = [], claim = null, usersById = new Map(),
  evidence = [], groupCounts = null,
} = {}) {
  const raw = []

  if (acc) {
    const photos = Array.isArray(acc.photos) ? acc.photos.filter(Boolean) : []
    const hasGps = acc.latitude != null && acc.latitude !== '' && acc.longitude != null && acc.longitude !== ''
    raw.push({
      id: `genesis-${acc.id}`,
      at: acc.incident_date || acc.created_at,
      category: CATEGORY.ACTIONS,
      title: 'Accident reported',
      subtitle: acc.driver_name ? `by ${acc.driver_name}` : (acc.inspector ? `by ${acc.inspector}` : ''),
      detail: compact([
        hasGps ? 'GPS' : null,
        photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} attached` : null,
      ]).join(' · '),
      status: 'completed',
      iconKey: 'report',
      actor: acc.driver_name || acc.inspector || null,
      relatedTab: 'overview',
      chips: (() => {
        const v = evidenceVerification(evidence)
        return v.total ? [`Verified ${v.verified}/${v.total}`] : []
      })(),
    })
  }

  for (const e of workstreamEvents) {
    if (!e?.at) continue
    const wsName = e.workstream_key ? e.workstream_key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Workstream'
    raw.push({
      id: `ws-${e.id}`,
      at: e.at,
      category: CATEGORY.ACTIONS,
      title: `${wsName} ${workstreamVerb(e.action, e.to_status)}`,
      subtitle: nameOf(usersById, e.actor_id) ? `by ${nameOf(usersById, e.actor_id)}` : '',
      detail: e.note || '',
      status: e.to_status === 'completed' ? 'completed' : (e.to_status === 'in_progress' ? 'in_progress' : 'completed'),
      iconKey: 'workstream',
      actor: nameOf(usersById, e.actor_id),
      relatedTab: relatedTabFor(e.workstream_key),
      chips: (() => {
        const v = evidenceVerification(evidence, e.workstream_key)
        return v.total ? [`Verified ${v.verified}/${v.total}`] : []
      })(),
    })
  }

  for (const c of communications) {
    if (!c?.occurred_at) continue
    const commChannel = { in_app: 'In-app notice', email_out: 'Email', email_in: 'Email', comment: 'Comment', call: 'Call', external_portal: 'Portal message' }[c.channel] || c.channel
    raw.push({
      id: `comm-${c.id}`,
      at: c.occurred_at,
      category: (c.channel === 'email_out' || c.channel === 'email_in') ? CATEGORY.EMAILS : CATEGORY.ACTIONS,
      title: c.subject || commChannel,
      subtitle: c.direction === 'outbound'
        ? compact([c.to_party ? `to ${c.to_party}` : null]).join(' ')
        : c.direction === 'inbound'
          ? compact([c.from_party ? `from ${c.from_party}` : null]).join(' ')
          : compact([c.author_name ? `by ${c.author_name}` : null]).join(' '),
      detail: commChannel,
      status: 'completed',
      iconKey: 'mail',
      actor: c.author_name || c.from_party || null,
      relatedTab: c.workstream_key ? relatedTabFor(c.workstream_key, 'log') : 'log',
      chips: (() => {
        const r = recipientsLabel(c, groupCounts)
        return r.count != null ? [`${r.count} recipient${r.count === 1 ? '' : 's'}`] : []
      })(),
    })
  }

  for (const h of handovers) {
    if (!h?.inspected_at) continue
    raw.push({
      id: `handover-${h.id}`,
      at: h.inspected_at,
      category: CATEGORY.ACTIONS,
      title: HANDOVER_LABEL[h.decision] || 'Handover inspection recorded',
      subtitle: h.inspector_name ? `by ${h.inspector_name}` : '',
      detail: h.rejection_reason || h.remarks || '',
      status: 'completed',
      iconKey: 'handover',
      actor: h.inspector_name || null,
      relatedTab: 'handover',
      chips: [],
    })
  }

  if (claim?.claim_registered_date) {
    raw.push({
      id: `claim-${claim.id}`,
      at: claim.claim_registered_date,
      category: CATEGORY.DOCUMENTS,
      title: 'Claim registered',
      subtitle: compact([claim.insurer, claim.claim_no ? `Claim no. ${claim.claim_no}` : null]).join(' · '),
      detail: '',
      status: 'completed',
      iconKey: 'document',
      actor: null,
      relatedTab: 'insurance_claim',
      chips: [],
    })
  }

  for (const s of slaInstances) {
    if (!s?.due_at) continue
    const overdue = s.state === 'running' && new Date(s.due_at) < new Date()
    raw.push({
      id: `sla-${s.id}`,
      at: s.due_at,
      category: CATEGORY.SLA,
      title: s.name || 'SLA due',
      subtitle: '',
      detail: s.breached ? 'Breached' : (s.state === 'met' ? 'SLA met' : (overdue ? `${(s.team || s.workstream_key || 'Owner')} SLA not started` : 'Due')),
      status: s.state === 'met' ? 'completed' : 'pending',
      iconKey: 'sla',
      slaMet: s.state === 'met',
      actor: null,
      relatedTab: relatedTabFor(s.workstream_key),
      chips: [],
    })
  }

  const sorted = raw
    .filter((e) => e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at))

  return sorted.map((e, i) => ({
    ...e,
    durationMs: i === 0 ? null : new Date(e.at) - new Date(sorted[i - 1].at),
  }))
}

/** Whole-unit "Xh Ym" / "Xd Yh" duration label, or null for the first entry. */
export function durationLabel(ms) {
  if (ms == null) return null
  const abs = Math.max(0, ms)
  const minutes = Math.round(abs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMin = minutes % 60
  if (hours < 24) return restMin ? `${hours}h ${restMin}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** Distinct people named across the feed's sources - the "Participants" tab.
 *  Honest by construction: a department/team is shown as a group when no named
 *  person is on record for it, never fabricated into a person. */
export function buildParticipants({ workstreamRows = [], communications = [], handovers = [], usersById = new Map() } = {}) {
  const people = new Map() // name -> {name, roles:Set}
  const add = (name, role) => {
    const key = String(name || '').trim()
    if (!key) return
    if (!people.has(key)) people.set(key, { name: key, roles: new Set() })
    if (role) people.get(key).roles.add(role)
  }

  for (const w of workstreamRows) {
    const owner = nameOf(usersById, w.owner_id)
    if (owner) add(owner, w.team || w.owner_role || null)
    else if (w.team) add(w.team, 'Team')
  }
  for (const c of communications) {
    if (c.author_name) add(c.author_name, 'Logged by')
    if (c.to_party) add(c.to_party, 'Recipient')
    if (c.from_party) add(c.from_party, 'Sender')
  }
  for (const h of handovers) {
    if (h.inspector_name) add(h.inspector_name, 'Inspector')
  }

  return [...people.values()]
    .map((p) => ({ name: p.name, roles: [...p.roles] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
