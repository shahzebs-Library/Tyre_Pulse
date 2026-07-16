import { describe, it, expect } from 'vitest'
import {
  SEVERITIES, STATUSES, ACCIDENT_TYPE_OPTS, DAMAGE_CLASS_OPTS, FAULT_STATUS_OPTS,
  NAJM_STATUS_OPTS, NAJM_FAULT_OPTS, TAQDEER_STATUS_OPTS, LIABILITY_RATIO_OPTS,
  REPAIR_TYPE_OPTS, CLAIM_STATUS_OPTS, CLAIM_STATUS_LABELS,
  RECOVERY_SOURCE_OPTS, RECOVERY_SOURCE_LABELS, RECOVERY_STATUS_OPTS, RECOVERY_STATUS_LABELS,
  CASE_STAGE_OPTS, DAMAGE_CONDITION_OPTS, WORKFLOW_STAGE_OPTS, TERMINAL_STAGES,
  STAGE_TO_CLAIM_STATUS, ACCIDENT_TYPE_LABEL,
  canonSeverity, canonStatus, canonAccidentType, toDbSeverity, toDbStatus, toDbAccidentType,
  accidentSeverityPill, accidentStatusPill,
  canonFaultStatus, canonNajmStatus, canonRepairType,
  LIABLE_PARTY_OPTS, PAYER_OPTS, RECOVERY_DECISION_OPTS,
  canonLiableParty, canonPayer, canonDamageCondition,
  najmHasReport, taqdeerHasReport, recoveryIsYes, repairIsInternal, computeRecovered,
} from '../lib/accidentVocab'

// DB CHECK-constraint vocabularies (accidents.severity/status/accident_type, V222).
const DB_ACCIDENT_TYPES = [
  'collision', 'rollover', 'rear_end', 'side_swipe', 'reversing', 'fire', 'vandalism',
  'weather', 'tyre_failure', 'mechanical', 'near_miss', 'property_damage', 'other',
]
const DB_SEVERITIES = ['minor', 'moderate', 'severe', 'fatal']
const DB_STATUSES = [
  'reported', 'under_review', 'repair_in_progress', 'awaiting_parts',
  'awaiting_approval', 'insurance_claim', 'closed',
]

describe('accidentVocab — single source of truth', () => {
  it('toDbAccidentType maps every UI option (and junk) into the CHECK vocabulary', () => {
    for (const label of ACCIDENT_TYPE_OPTS) {
      expect(DB_ACCIDENT_TYPES, label).toContain(toDbAccidentType(label))
    }
    // already-canonical tokens pass through; junk falls back to 'other'; empty is null
    expect(toDbAccidentType('rear_end')).toBe('rear_end')
    expect(toDbAccidentType('Something Weird')).toBe('other')
    expect(toDbAccidentType('')).toBeNull()
    expect(toDbAccidentType(null)).toBeNull()
  })

  it('toDbSeverity maps every UI severity (and aliases) into the CHECK vocabulary', () => {
    for (const label of SEVERITIES) {
      expect(DB_SEVERITIES, label).toContain(toDbSeverity(label))
    }
    for (const raw of ['minor', 'moderate', 'severe', 'fatal', 'Total Loss', 'MAJOR', '', undefined, 'garbage']) {
      expect(DB_SEVERITIES, String(raw)).toContain(toDbSeverity(raw))
    }
  })

  it('toDbStatus maps every UI status (and aliases) into the CHECK vocabulary', () => {
    for (const label of STATUSES) {
      expect(DB_STATUSES, label).toContain(toDbStatus(label))
    }
    for (const raw of ['under_investigation', 'Under Review', 'closed', '', undefined, 'garbage']) {
      expect(DB_STATUSES, String(raw)).toContain(toDbStatus(raw))
    }
  })

  it('canonSeverity round-trips every severity option through the DB token', () => {
    for (const label of SEVERITIES) {
      expect(canonSeverity(toDbSeverity(label)), label).toBe(label)
    }
  })

  it('canonStatus round-trips every status option through the DB token', () => {
    for (const label of STATUSES) {
      expect(canonStatus(toDbStatus(label)), label).toBe(label)
    }
  })

  it('canonAccidentType round-trips every accident-type option through the DB token', () => {
    for (const label of ACCIDENT_TYPE_OPTS) {
      expect(canonAccidentType(toDbAccidentType(label)), label).toBe(label)
    }
    // and every DB token has a display label
    for (const token of DB_ACCIDENT_TYPES) {
      expect(ACCIDENT_TYPE_LABEL[token], token).toBeTruthy()
    }
  })

  it('every option list is non-empty with no duplicates and no empty entries', () => {
    const lists = {
      SEVERITIES, STATUSES, ACCIDENT_TYPE_OPTS, DAMAGE_CLASS_OPTS, FAULT_STATUS_OPTS,
      NAJM_STATUS_OPTS, NAJM_FAULT_OPTS, TAQDEER_STATUS_OPTS, LIABILITY_RATIO_OPTS,
      REPAIR_TYPE_OPTS, CLAIM_STATUS_OPTS, RECOVERY_SOURCE_OPTS, RECOVERY_STATUS_OPTS,
      CASE_STAGE_OPTS, DAMAGE_CONDITION_OPTS, WORKFLOW_STAGE_OPTS, TERMINAL_STAGES,
    }
    for (const [name, list] of Object.entries(lists)) {
      expect(list.length, name).toBeGreaterThan(0)
      expect(new Set(list.map(v => String(v).toLowerCase())).size, `${name} has duplicates`).toBe(list.length)
      for (const v of list) expect(String(v).trim() !== '' && v != null, `${name} has an empty entry`).toBe(true)
    }
  })

  it('workflow stage list is the reconciled union (no In repair/Under Repair duplicate)', () => {
    const lower = WORKFLOW_STAGE_OPTS.map(s => s.toLowerCase())
    expect(lower).toContain('under repair')
    expect(lower).not.toContain('in repair')
    // the terminal stages exist in the canonical list
    for (const t of TERMINAL_STAGES) expect(lower).toContain(t)
  })

  it('stage-to-claim lockstep map keys are canonical stages and values are claim statuses', () => {
    const lowerStages = WORKFLOW_STAGE_OPTS.map(s => s.toLowerCase())
    for (const [stage, claim] of Object.entries(STAGE_TO_CLAIM_STATUS)) {
      expect(lowerStages, stage).toContain(stage)
      expect(CLAIM_STATUS_OPTS, claim).toContain(claim)
    }
  })

  it('every lowercase enum option has a display label', () => {
    for (const s of CLAIM_STATUS_OPTS) expect(CLAIM_STATUS_LABELS[s], s).toBeTruthy()
    for (const s of RECOVERY_SOURCE_OPTS) expect(RECOVERY_SOURCE_LABELS[s], s).toBeTruthy()
    for (const s of RECOVERY_STATUS_OPTS) expect(RECOVERY_STATUS_LABELS[s], s).toBeTruthy()
  })
})

describe('accidentVocab — presentation pills (shared list + detail source)', () => {
  it('accidentSeverityPill maps damage severity onto consistent colours', () => {
    const minor = accidentSeverityPill('Minor')
    expect(minor.label).toBe('Minor')
    expect(minor.className).toContain('green')

    const major = accidentSeverityPill('Major')
    expect(major.label).toBe('Major')
    expect(major.className).toContain('orange')

    // legacy 'Total Loss' now folds onto the top Major band
    const total = accidentSeverityPill('Total Loss')
    expect(total.label).toBe('Major')
    expect(total.className).toContain('orange')
  })

  it('accidentSeverityPill canonicalises aliases and yields an empty pill for blanks', () => {
    expect(accidentSeverityPill('minor').label).toBe('Minor')   // mobile lowercase
    expect(accidentSeverityPill('severe').label).toBe('Major')
    expect(accidentSeverityPill('').label).toBe('')
    expect(accidentSeverityPill(null).className).toBe('')
  })

  it('accidentStatusPill gives every status a non-empty colour and a fallback for unknowns', () => {
    for (const s of STATUSES) {
      const pill = accidentStatusPill(s)
      expect(pill.label, s).toBe(s)
      expect(pill.className, s).toBeTruthy()
    }
    expect(accidentStatusPill('closed').label).toBe('Closed')      // alias canon
    expect(accidentStatusPill('Closed').className).toContain('green')
    // unknown but non-empty -> passes through canonStatus, uses the neutral fallback
    const unknown = accidentStatusPill('Something Bespoke')
    expect(unknown.label).toBe('Something Bespoke')
    expect(unknown.className).toContain('--input-bg')
    // blank -> empty pill
    expect(accidentStatusPill('').label).toBe('')
  })

  it('incident-report dropdowns are defined and canonicalise stray case', () => {
    expect(LIABLE_PARTY_OPTS).toEqual(['GCC', 'Other Party'])
    expect(PAYER_OPTS).toEqual(['GCC', 'Insurance', 'Recovery Claim'])
    expect(RECOVERY_DECISION_OPTS).toEqual(['Yes', 'No', 'N/A'])
    expect(canonLiableParty('gcc')).toBe('GCC')
    expect(canonPayer('recovery claim')).toBe('Recovery Claim')
    // legacy damage-condition values fold onto the new ladder; unknown passes through
    expect(canonDamageCondition('Major Repair')).toBe('Major')
    expect(canonDamageCondition('Total Loss')).toBe('Major')
    expect(canonDamageCondition('cosmetic')).toBe('Minor')
    expect(canonDamageCondition('moderate')).toBe('Moderate')
    expect(canonDamageCondition('')).toBe('')
  })

  it('report-existence + recovery + repair gates behave correctly', () => {
    expect(najmHasReport('Najm report')).toBe(true)
    expect(najmHasReport('No Najm')).toBe(false)
    expect(najmHasReport('')).toBe(false)
    expect(taqdeerHasReport('Taqdeer report')).toBe(true)
    expect(taqdeerHasReport('No Taqdeer')).toBe(false)
    expect(recoveryIsYes('Yes')).toBe(true)
    expect(recoveryIsYes('No')).toBe(false)
    expect(recoveryIsYes('N/A')).toBe(false)
    expect(repairIsInternal('internal')).toBe(true)
    expect(repairIsInternal('External')).toBe(false)
  })

  it('computeRecovered = max(0, claim - approved - deductible)', () => {
    expect(computeRecovered(1000, 700, 100)).toBe(200)
    expect(computeRecovered(500, 500, 100)).toBe(0)   // floored at 0, never negative
    expect(computeRecovered('', '', '')).toBe(0)
    expect(computeRecovered('1000', '250', '50')).toBe(700)
  })

  it('case-field canon helpers fold stray-case values back onto the option label', () => {
    expect(canonFaultStatus('faulty')).toBe('Faulty')
    expect(canonFaultStatus('NON-FAULTY')).toBe('Non-faulty')
    expect(canonNajmStatus('najm report')).toBe('Najm report')
    expect(canonRepairType('internal')).toBe('Internal')
    // unknown passes through unchanged; blank -> ''
    expect(canonFaultStatus('Bespoke')).toBe('Bespoke')
    expect(canonRepairType('')).toBe('')
  })
})
