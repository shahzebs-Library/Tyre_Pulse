/**
 * accidentTeams.js — distribute a case's WORK and its INPUT FILES to the teams.
 *
 * THE JOB. When an accident is filed, its inputs (the incident facts, the
 * insurer/claim details, the damage/repair details, the settlement figures) and
 * its uploaded files (photos, police report, driving licence, Najm/Taqdeer, etc.)
 * each BELONG to a specific department. So does each workstream (the actual work).
 * This pure module groups both, per team, so a distribution tab can show every
 * team exactly what it owns and what input it already has vs still needs.
 *
 * DESIGN CONTRACT (same as the sibling engines): pure and deterministic (no I/O,
 * no React, no clock read); honest nulls — a coverage figure with nothing in scope
 * is null, never a flattering 100. It REUSES the case brain (accidentCase.js) for
 * the workstream list, the route, and each workstream's status — it does not fork
 * that logic. The ten workstreams roll up to five top-level teams here; the
 * fine-grained per-workstream team label still lives on WORKSTREAMS.
 */

import {
  WORKSTREAMS, requiredWorkstreams, workstreamStatus, buildCaseRoute,
} from './accidentCase'

const str = (v) => (v == null ? '' : String(v).trim())
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const TRUTHY = new Set(['true', 't', 'yes', 'y', '1'])
const truthy = (v) => v === true || v === 1 || TRUTHY.has(str(v).toLowerCase())

/** A field is PRESENT when it carries a real value (non-blank string, finite
 *  number, or an explicit yes). A blank / null / 0-length value is "not yet
 *  provided" — never counted as present, so coverage is honest. */
function fieldPresent(v) {
  if (v == null) return false
  if (typeof v === 'number') return Number.isFinite(v)
  const s = str(v)
  return s !== '' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'n/a'
}

// ── the five top-level teams, in the order work flows through a case ──────────
// icon is a lucide name resolved by the component (this file stays pure/no JSX).
export const TEAM_DEFS = Object.freeze([
  {
    key: 'fleet', label: 'Fleet', icon: 'Truck',
    blurb: 'Captures the incident, validates the record, and takes the vehicle back into service.',
    workstreams: ['incident_evidence', 'fleet_validation', 'handover'],
    docCategories: ['accident_photo', 'police_report', 'driving_license', 'resident_id', 'registration'],
    inputs: [
      { key: 'incident_date', label: 'Incident date', get: (r) => r.incident_date },
      { key: 'location', label: 'Location', get: (r) => r.location },
      { key: 'asset_no', label: 'Asset / vehicle', get: (r) => r.asset_no || r.plate_number },
      { key: 'driver_name', label: 'Driver', get: (r) => r.driver_name },
      { key: 'police_report_no', label: 'Police report no', get: (r) => r.police_report_no },
      { key: 'damage_description', label: 'Damage description', get: (r) => r.damage_description || r.description },
    ],
  },
  {
    key: 'hse', label: 'HSE / Safety', icon: 'ShieldAlert',
    blurb: 'Decides fault and liability and drives corrective and preventive actions.',
    workstreams: ['liability', 'corrective'],
    docCategories: ['investigation_report'],
    inputs: [
      { key: 'severity', label: 'Severity', get: (r) => r.severity },
      { key: 'injuries', label: 'Injuries', get: (r) => (truthy(r.injuries) || num(r.injury_count) > 0 ? (num(r.injury_count) ? `${num(r.injury_count)} injured` : 'Yes') : '') },
      { key: 'fault_status', label: 'Fault', get: (r) => r.fault_status },
      { key: 'liable_party', label: 'Liable party', get: (r) => r.liable_party || r.responsible_party },
      { key: 'root_cause', label: 'Root cause', get: (r) => r.root_cause },
      { key: 'corrective_action', label: 'Corrective action', get: (r) => r.corrective_action },
      { key: 'preventive_action', label: 'Preventive action', get: (r) => r.preventive_action },
    ],
  },
  {
    key: 'insurance', label: 'Insurance', icon: 'FileCheck',
    blurb: 'Registers and pursues the claim with the insurer, Najm and Taqdeer.',
    workstreams: ['insurance'],
    docCategories: ['najm_report', 'taqdeer_estimation', 'insurance_document'],
    inputs: [
      { key: 'insurer', label: 'Insurer', get: (r) => r.insurer },
      { key: 'policy_no', label: 'Policy no', get: (r) => r.policy_no },
      { key: 'claim_status', label: 'Claim status', get: (r) => r.claim_status },
      { key: 'claim_amount', label: 'Claim amount', get: (r) => r.claim_amount, money: true },
      { key: 'najm_status', label: 'Najm', get: (r) => r.najm_status },
      { key: 'taqdeer_status', label: 'Taqdeer', get: (r) => r.taqdeer_status || r.taqdeer_no },
      { key: 'gcc_liability_ratio', label: 'GCC liability ratio', get: (r) => r.gcc_liability_ratio },
    ],
  },
  {
    key: 'workshop', label: 'Workshop', icon: 'Wrench',
    blurb: 'Assesses the damage, carries out the repair, and signs off quality.',
    workstreams: ['assessment', 'repair', 'workshop_qc'],
    docCategories: ['repair_photo', 'quotation'],
    inputs: [
      { key: 'damage_class', label: 'Damage class', get: (r) => r.damage_class },
      { key: 'repair_type', label: 'Repair type', get: (r) => r.repair_type },
      { key: 'workshop_name', label: 'Workshop', get: (r) => r.workshop_name },
      { key: 'estimated_damage_cost', label: 'Estimated damage', get: (r) => r.estimated_damage_cost, money: true },
      { key: 'approved_repair_amount', label: 'Approved repair', get: (r) => r.approved_repair_amount, money: true },
      { key: 'repair_cost', label: 'Repair cost', get: (r) => r.repair_cost, money: true },
    ],
  },
  {
    key: 'finance', label: 'Finance', icon: 'Wallet',
    blurb: 'Settles the claim, recovers cost, and closes the case financially.',
    workstreams: ['finance'],
    docCategories: ['invoice', 'settlement'],
    inputs: [
      { key: 'final_amount', label: 'Final amount', get: (r) => r.final_amount, money: true },
      { key: 'amount_transfer', label: 'Amount transferred', get: (r) => r.amount_transfer, money: true },
      { key: 'deductible', label: 'Deductible', get: (r) => r.deductible, money: true },
      { key: 'recovered_amount', label: 'Recovered', get: (r) => r.recovered_amount, money: true },
      { key: 'recovery_source', label: 'Recovery source', get: (r) => r.recovery_source },
      { key: 'parts_cost', label: 'Parts cost', get: (r) => r.parts_cost, money: true },
    ],
  },
])

export const TEAM_KEYS = TEAM_DEFS.map((t) => t.key)
const WS_BY_KEY = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w]))

/** One uploaded file's category, whatever shape it takes (string or object). */
function fileCategory(f) {
  if (f == null) return ''
  if (typeof f === 'string') return ''
  return str(f.category || f.type || f.kind || f.doc_type || f.slot)
}
/** One uploaded file's display name. */
function fileName(f) {
  if (f == null) return 'File'
  if (typeof f === 'string') return f.split('/').pop() || f
  return str(f.name || f.label || f.filename || f.title) || str(f.category || f.type) || 'File'
}
/** A file's storage reference / url (resolved to a real URL by the component). */
function fileRef(f) {
  if (f == null) return ''
  if (typeof f === 'string') return f
  return str(f.url || f.ref || f.path || f.storage_ref || f.src || f.key)
}

/**
 * The files that belong to a team: every entry in `documents` / `videos` whose
 * category matches one the team owns, plus (for Fleet) the accident `photos`.
 * Returns [{ name, ref, category }]. Robust to string or object entries; an entry
 * with no recognised category is left for the incident-capture team so nothing is
 * silently dropped.
 */
export function filesForTeam(record, teamKey) {
  const team = TEAM_DEFS.find((t) => t.key === teamKey)
  if (!team) return []
  const cats = new Set(team.docCategories)
  const out = []
  const scan = (list, fallbackCat) => {
    for (const f of arr(list)) {
      const ref = fileRef(f)
      if (!ref) continue
      const cat = fileCategory(f) || fallbackCat
      const belongs = cats.has(cat) || (fallbackCat === 'accident_photo' && teamKey === 'fleet' && !fileCategory(f))
      if (belongs) out.push({ name: fileName(f), ref, category: cat })
    }
  }
  scan(record?.documents, '')
  scan(record?.videos, '')
  if (teamKey === 'fleet') scan(record?.photos, 'accident_photo')
  return out
}

/**
 * Distribute a case to its teams. For each of the five teams returns:
 *   - workstreams it owns, each { key, name, required, status, ownerId, ownerRole,
 *     team } — status/owner sourced from the explicit workstream rows when present,
 *     else derived from the record (via the case brain).
 *   - inputs it is responsible for, each { key, label, present, value } — the
 *     structured "files of input" that team must provide.
 *   - files (uploaded documents/photos) routed to it.
 *   - coverage counts: required workstreams, satisfied inputs, total inputs.
 *
 * @param {object} record accidents row
 * @param {object[]} wsRows explicit accident_case_workstreams rows (optional)
 * @param {object|string} [route] route def / key / buildCaseRoute result;
 *   defaults to the case's own derived route.
 */
export function buildTeamDistribution(record, wsRows = [], route) {
  const rec = record || {}
  const rows = arr(wsRows)
  const rte = route || buildCaseRoute(rec, [])
  const required = requiredWorkstreams(rte, rec)
  const rowByKey = new Map()
  for (const r of rows) {
    const k = r.workstream || r.workstream_key || r.key
    if (k) rowByKey.set(k, r)
  }

  return TEAM_DEFS.map((team) => {
    const workstreams = team.workstreams
      .filter((k) => WS_BY_KEY[k])
      .map((k) => {
        const row = rowByKey.get(k) || null
        return {
          key: k,
          name: WS_BY_KEY[k].name,
          team: WS_BY_KEY[k].team,
          required: required.has(k),
          status: workstreamStatus(rec, k, rows),
          ownerId: row?.owner_id || null,
          ownerRole: row?.owner_role || row?.team || null,
          na: row?.not_applicable === true || row?.status === 'not_required',
          // Audit timestamps (V429) — surfaced for the trail.
          assignedAt: row?.assigned_at || null,
          startedAt: row?.started_at || null,
          completedAt: row?.completed_at || null,
          updatedAt: row?.updated_at || null,
          updatedBy: row?.updated_by || null,
        }
      })

    const inputs = team.inputs.map((f) => {
      const raw = f.get(rec)
      const present = f.money ? num(raw) != null && num(raw) !== 0 : fieldPresent(raw)
      return { key: f.key, label: f.label, present, value: present ? str(raw) : '', money: !!f.money }
    })

    const files = filesForTeam(rec, team.key)
    const requiredCount = workstreams.filter((w) => w.required).length
    const doneCount = workstreams.filter((w) => w.required &&
      (w.status === 'completed' || w.status === 'not_required')).length
    const inputsPresent = inputs.filter((i) => i.present).length

    return {
      key: team.key, label: team.label, icon: team.icon, blurb: team.blurb,
      workstreams, inputs, files,
      requiredCount, doneCount,
      inputsPresent, inputsTotal: inputs.length,
      // Honest null: a team with nothing required for THIS route has no % to show.
      workPct: requiredCount === 0 ? null : Math.round((100 * doneCount) / requiredCount),
      inputPct: inputs.length === 0 ? null : Math.round((100 * inputsPresent) / inputs.length),
    }
  })
}

/** Which team owns a given workstream key (top-level roll-up). */
export function teamForWorkstream(workstreamKey) {
  const k = str(workstreamKey)
  return TEAM_DEFS.find((t) => t.workstreams.includes(k))?.key || null
}
