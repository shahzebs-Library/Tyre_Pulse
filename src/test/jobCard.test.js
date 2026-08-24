import { describe, it, expect } from 'vitest'
import {
  JOB_CARD_FIELDS,
  JOB_CARD_STAGES,
  JOB_CARD_SECTIONS,
  JOB_CARD_EXPORT_COLUMN_COUNT,
  jobCardField,
  fieldsForSection,
  editableFields,
  payloadColumns,
  readField,
  erpReportedCost,
  erpLineItems,
  jobCardStage,
  stageChronologyIssues,
  jobCardDurations,
  waitingSplit,
  validateJobCard,
  toPayload,
  jobCardCompleteness,
} from '../lib/jobCard'

// A fixed clock. The engine takes `now` explicitly BECAUSE a test on the real
// clock is a bug: a "running" gap would grow between runs.
const NOW = Date.parse('2026-08-24T12:00:00Z')
const at = s => new Date(s).toISOString()

describe('catalog integrity', () => {
  it('every field belongs to a declared section', () => {
    const sections = new Set(JOB_CARD_SECTIONS.map(s => s.key))
    for (const f of JOB_CARD_FIELDS) expect(sections.has(f.section)).toBe(true)
  })

  it('every field key is unique', () => {
    const keys = JOB_CARD_FIELDS.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('maps the ERP export columns', () => {
    // The export carries 34 mapped data columns. If this drops, a field lost its
    // header and the importer and the form have stopped describing one card.
    expect(JOB_CARD_EXPORT_COLUMN_COUNT).toBeGreaterThanOrEqual(30)
  })

  it('every section holds at least one field', () => {
    for (const s of JOB_CARD_SECTIONS) expect(fieldsForSection(s.key).length).toBeGreaterThan(0)
  })

  it('jobCardField returns null for an unknown key', () => {
    expect(jobCardField('no_such_field')).toBeNull()
  })

  it('payloadColumns excludes computed and custom_data-only fields', () => {
    const cols = payloadColumns()
    // total_cost is a GENERATED column: Postgres rejects a write to it.
    expect(cols).not.toContain('total_cost')
    // These still live in custom_data and are provenance, not input.
    expect(cols).not.toContain('raised_by')
    expect(cols).not.toContain('card_by')
    // A promoted typed column IS writable.
    expect(cols).toContain('asset_description')
    expect(cols).toContain('mr_no')
  })

  it('editableFields never includes a computed field', () => {
    expect(editableFields().some(f => f.computed)).toBe(false)
  })
})

describe('readField', () => {
  it('prefers the typed column over the custom_data fallback', () => {
    const row = { asset_description: 'TYPED', custom_data: { asset_description: 'JSONB' } }
    expect(readField(row, 'asset_description')).toBe('TYPED')
  })

  it('falls back to custom_data when the typed column is empty', () => {
    // A card loaded before the V605 promotion must still read correctly.
    const row = { asset_description: null, custom_data: { asset_description: 'JSONB' } }
    expect(readField(row, 'asset_description')).toBe('JSONB')
  })

  it('returns null, not undefined or empty string, for an absent value', () => {
    expect(readField({}, 'mr_no')).toBeNull()
    expect(readField({ mr_no: '' }, 'mr_no')).toBeNull()
    expect(readField(null, 'mr_no')).toBeNull()
  })

  it('returns null for a key that is not in the catalog', () => {
    expect(readField({ whatever: 1 }, 'whatever')).toBeNull()
  })
})

describe('erp payload readers', () => {
  it('returns null when no ERP cost was reported', () => {
    expect(erpReportedCost({ custom_data: { erp_reported_cost: {} } })).toBeNull()
    expect(erpReportedCost({})).toBeNull()
  })

  it('reads the reported cost block and nulls unparseable entries', () => {
    const c = erpReportedCost({ custom_data: { erp_reported_cost: { spare_parts: '120.5', tyre: '', oil: 'abc' } } })
    expect(c.spareParts).toBe(120.5)
    expect(c.tyre).toBeNull()
    expect(c.oil).toBeNull()
  })

  it('returns an empty array when there are no ERP task lines', () => {
    expect(erpLineItems({})).toEqual([])
    expect(erpLineItems({ custom_data: { line_items: 'nope' } })).toEqual([])
  })
})

describe('jobCardStage', () => {
  it('reports not-started when no timestamp exists, rather than stage 1', () => {
    const s = jobCardStage({ status: 'New' })
    expect(s.index).toBe(-1)
    expect(s.key).toBeNull()
    expect(s.label).toBe('Not started')
  })

  it('reports the furthest PROVEN stage and never infers a skipped one', () => {
    // Production Out and Workshop Out exist, Workshop In does not. The furthest
    // proven stage is workshop_out; workshop_in must NOT appear as reached.
    const row = {
      status: 'In Progress',
      production_out_at: at('2026-08-20T06:00:00Z'),
      completed_at: at('2026-08-21T10:00:00Z'),
    }
    const s = jobCardStage(row)
    expect(s.key).toBe('workshop_out')
    expect(s.reached).toContain('production_out')
    expect(s.reached).not.toContain('workshop_in')
  })

  it('marks a closed card closed', () => {
    expect(jobCardStage({ status: 'Completed' }).closed).toBe(true)
    expect(jobCardStage({ status: 'In Progress' }).closed).toBe(false)
  })

  it('every stage field is a real catalog field or a custom_data path', () => {
    for (const s of JOB_CARD_STAGES) expect(jobCardField(s.field)).not.toBeNull()
  })
})

describe('jobCardDurations', () => {
  const full = {
    status: 'Completed',
    production_out_at: at('2026-08-20T06:00:00Z'),
    started_at: at('2026-08-20T10:00:00Z'),
    completed_at: at('2026-08-21T10:00:00Z'),
    production_in_at: at('2026-08-21T12:00:00Z'),
  }

  it('measures the three gaps and the total', () => {
    const d = jobCardDurations(full, NOW)
    expect(d.awaitingWorkshop.hours).toBe(4)
    expect(d.inWorkshop.hours).toBe(24)
    expect(d.awaitingRelease.hours).toBe(2)
    expect(d.totalDown.hours).toBe(30)
  })

  it('returns null, NOT zero, when the start timestamp was never recorded', () => {
    // This is the whole point: an unmeasurable gap is not a zero-hour gap, and
    // reporting 0 would flatter every downtime average.
    const d = jobCardDurations({ status: 'Completed', completed_at: at('2026-08-21T10:00:00Z') }, NOW)
    expect(d.awaitingWorkshop).toBeNull()
    expect(d.inWorkshop).toBeNull()
    expect(d.awaitingWorkshop).not.toBe(0)
  })

  it('runs an open gap to now and flags it', () => {
    const row = { status: 'In Progress', production_out_at: at('2026-08-24T06:00:00Z') }
    const d = jobCardDurations(row, NOW)
    expect(d.awaitingWorkshop.running).toBe(true)
    expect(d.awaitingWorkshop.hours).toBe(6)
  })

  it('does not run a gap forward on a CLOSED card', () => {
    // A closed card whose end timestamp is missing is unmeasurable, not still
    // accumulating: counting it to today is exactly the ERP bug V385 avoided.
    const row = { status: 'Completed', production_out_at: at('2026-08-24T06:00:00Z') }
    expect(jobCardDurations(row, NOW).awaitingWorkshop).toBeNull()
  })

  it('reports a reversed pair as a data error, not a negative duration', () => {
    const row = {
      status: 'Completed',
      started_at: at('2026-08-21T10:00:00Z'),
      completed_at: at('2026-08-20T10:00:00Z'),
    }
    const d = jobCardDurations(row, NOW)
    expect(d.inWorkshop.reversed).toBe(true)
    expect(d.inWorkshop.hours).toBeNull()
  })
})

describe('stageChronologyIssues', () => {
  it('finds nothing on a well-ordered card', () => {
    expect(stageChronologyIssues({
      production_out_at: at('2026-08-20T06:00:00Z'),
      started_at: at('2026-08-20T10:00:00Z'),
      completed_at: at('2026-08-21T10:00:00Z'),
      production_in_at: at('2026-08-21T12:00:00Z'),
    })).toEqual([])
  })

  it('flags an out-of-order pair', () => {
    const issues = stageChronologyIssues({
      production_out_at: at('2026-08-20T10:00:00Z'),
      started_at: at('2026-08-20T06:00:00Z'),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/before Production Out/)
  })
})

describe('waitingSplit', () => {
  const base = {
    status: 'Completed',
    production_out_at: at('2026-08-20T06:00:00Z'),
    started_at: at('2026-08-20T16:00:00Z'),   // a 10 hour wait
  }

  it('splits the wait by cause and reports what is unaccounted', () => {
    const w = waitingSplit({ ...base, waiting_parts_hours: 6, waiting_manpower_hours: 2 }, NOW)
    expect(w.parts).toBe(6)
    expect(w.manpower).toBe(2)
    expect(w.gapHours).toBe(10)
    expect(w.accounted).toBe(8)
    expect(w.unexplained).toBe(2)
    expect(w.recorded).toBe(true)
  })

  it('floors unexplained at zero when the waiting columns exceed the gap', () => {
    const w = waitingSplit({ ...base, waiting_parts_hours: 20 }, NOW)
    expect(w.unexplained).toBe(0)
  })

  it('says nothing was recorded rather than showing three zeros', () => {
    const w = waitingSplit(base, NOW)
    expect(w.recorded).toBe(false)
    expect(w.parts).toBeNull()
    expect(w.manpower).toBeNull()
    expect(w.accounted).toBeNull()
  })

  it('reports an unmeasurable gap as null, so unexplained cannot be invented', () => {
    const w = waitingSplit({ status: 'Completed', waiting_parts_hours: 3 }, NOW)
    expect(w.gapHours).toBeNull()
    expect(w.unexplained).toBeNull()
    expect(w.recorded).toBe(true)
  })
})

describe('validateJobCard', () => {
  const ok = { asset_no: 'TM100', status: 'New', priority: 'Medium', work_type: 'Repair', opened_at: at('2026-08-20T06:00:00Z') }

  it('accepts a complete card', () => {
    const r = validateJobCard(ok)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual({})
  })

  it('errors on a missing required field', () => {
    const r = validateJobCard({ ...ok, asset_no: '' })
    expect(r.ok).toBe(false)
    expect(r.errors.asset_no).toMatch(/required/i)
  })

  it('does NOT require the job card number on the form', () => {
    // The app generates one when the user does not supply the real ERP number.
    expect(validateJobCard(ok).errors.work_order_no).toBeUndefined()
  })

  it('treats a chronology problem as a warning that does not block the save', () => {
    const r = validateJobCard({
      ...ok,
      production_out_at: at('2026-08-20T10:00:00Z'),
      started_at: at('2026-08-20T06:00:00Z'),
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('warns when a closed card cannot have its repair time measured', () => {
    const r = validateJobCard({ ...ok, status: 'Completed' })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/Workshop Out/)
  })
})

describe('toPayload', () => {
  it('never emits total_cost', () => {
    // GENERATED column: Postgres rejects any value sent to it.
    expect(toPayload({ total_cost: 999 })).not.toHaveProperty('total_cost')
  })

  it('never emits a custom_data-only field', () => {
    expect(toPayload({ raised_by: 'someone' })).not.toHaveProperty('raised_by')
  })

  it('turns blanks into null rather than empty strings or zero', () => {
    const p = toPayload({ mr_no: '', waiting_parts_hours: '   ' })
    expect(p.mr_no).toBeNull()
    expect(p.waiting_parts_hours).toBeNull()
  })

  it('coerces numbers and keeps a real zero', () => {
    // 0 hours recorded is a MEASUREMENT and must survive; only a blank is null.
    expect(toPayload({ waiting_parts_hours: '0' }).waiting_parts_hours).toBe(0)
    expect(toPayload({ standard_hours: '4.5' }).standard_hours).toBe(4.5)
  })

  it('converts a datetime to ISO and normalises status', () => {
    expect(toPayload({ opened_at: '2026-08-20T06:00' }).opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(toPayload({ status: 'in_progress' }).status).toBe('In Progress')
  })

  it('omits a key the caller never supplied', () => {
    expect(toPayload({ asset_no: 'TM1' })).not.toHaveProperty('mr_no')
  })
})

describe('jobCardCompleteness', () => {
  it('counts only fields that carry a value', () => {
    const c = jobCardCompleteness({ asset_no: 'TM1', status: 'New' })
    expect(c.filled).toBe(2)
    expect(c.total).toBeGreaterThan(2)
    expect(c.missing).toContain('mr_no')
  })

  it('never counts the computed total_cost', () => {
    expect(jobCardCompleteness({ total_cost: 100 }).filled).toBe(0)
  })
})
