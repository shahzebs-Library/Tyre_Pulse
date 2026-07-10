/**
 * Unit tests for the pure client-side workflow engine helpers:
 *   - evaluateCondition (all operators + numeric/string + missing field)
 *   - runnableStepIndices (conditional auto-skip preview)
 *   - stepRequirements / missingRequirements / canAct
 *
 * These mirror the server-side V117 logic (workflow_step_condition_passes and
 * the require_* enforcement in workflow_act). No DB / network — pure functions.
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateCondition,
  runnableStepIndices,
  CONDITION_OPS,
} from '../lib/workflow/conditions'
import {
  stepRequirements,
  missingRequirements,
  canAct,
} from '../lib/workflow/stepRequirements'

describe('evaluateCondition', () => {
  const ctx = { replacement_cost: 6000, downtime: 48, severity: 'major', ok: true }

  it('returns true when condition is null/undefined/non-object (step always runs)', () => {
    expect(evaluateCondition(null, ctx)).toBe(true)
    expect(evaluateCondition(undefined, ctx)).toBe(true)
    expect(evaluateCondition('nope', ctx)).toBe(true)
    expect(evaluateCondition(42, ctx)).toBe(true)
  })

  it('returns false when the referenced field is missing from context', () => {
    expect(evaluateCondition({ field: 'not_here', op: '>', value: 1 }, ctx)).toBe(false)
  })

  it('returns false when the referenced field is null/undefined in context', () => {
    expect(evaluateCondition({ field: 'x', op: '=', value: 1 }, { x: null })).toBe(false)
    expect(evaluateCondition({ field: 'x', op: '=', value: 1 }, { x: undefined })).toBe(false)
  })

  it('returns true for malformed condition (missing field or unsupported op)', () => {
    expect(evaluateCondition({ op: '>', value: 1 }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'replacement_cost', value: 1 }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'replacement_cost', op: '~', value: 1 }, ctx)).toBe(true)
  })

  it('exposes exactly the supported operator set', () => {
    expect(CONDITION_OPS).toEqual(['=', '!=', '>', '>=', '<', '<='])
  })

  describe('numeric comparisons', () => {
    const c = (op, value) => evaluateCondition({ field: 'replacement_cost', op, value }, ctx)
    it('= ', () => {
      expect(c('=', 6000)).toBe(true)
      expect(c('=', 5000)).toBe(false)
    })
    it('!=', () => {
      expect(c('!=', 5000)).toBe(true)
      expect(c('!=', 6000)).toBe(false)
    })
    it('> ', () => {
      expect(c('>', 5000)).toBe(true)
      expect(c('>', 6000)).toBe(false)
      expect(c('>', 7000)).toBe(false)
    })
    it('>=', () => {
      expect(c('>=', 6000)).toBe(true)
      expect(c('>=', 6001)).toBe(false)
    })
    it('< ', () => {
      expect(c('<', 7000)).toBe(true)
      expect(c('<', 6000)).toBe(false)
    })
    it('<=', () => {
      expect(c('<=', 6000)).toBe(true)
      expect(c('<=', 5999)).toBe(false)
    })
    it('coerces numeric strings on either side', () => {
      expect(evaluateCondition({ field: 'downtime', op: '>', value: '24' }, ctx)).toBe(true)
      expect(evaluateCondition({ field: 'downtime', op: '>', value: '24' }, { downtime: '48' })).toBe(
        true
      )
    })
  })

  describe('string comparisons', () => {
    it('equality / inequality on strings', () => {
      expect(evaluateCondition({ field: 'severity', op: '=', value: 'major' }, ctx)).toBe(true)
      expect(evaluateCondition({ field: 'severity', op: '=', value: 'minor' }, ctx)).toBe(false)
      expect(evaluateCondition({ field: 'severity', op: '!=', value: 'minor' }, ctx)).toBe(true)
    })
    it('lexicographic ordering on non-numeric strings', () => {
      expect(evaluateCondition({ field: 'severity', op: '>', value: 'a' }, ctx)).toBe(true)
      expect(evaluateCondition({ field: 'severity', op: '<', value: 'z' }, ctx)).toBe(true)
    })
  })

  it('handles the spec smart-rule example (cost > 5000 → GM step)', () => {
    const cond = { field: 'replacement_cost', op: '>', value: 5000 }
    expect(evaluateCondition(cond, { replacement_cost: 6000 })).toBe(true)
    expect(evaluateCondition(cond, { replacement_cost: 4000 })).toBe(false)
    expect(evaluateCondition(cond, {})).toBe(false)
  })
})

describe('runnableStepIndices', () => {
  const steps = [
    { name: 'Tyre Man', approver_role: 'tyre_man' },
    { name: 'Supervisor', approver_role: 'fleet_supervisor' },
    {
      name: 'GM',
      approver_role: 'gm',
      condition: { field: 'replacement_cost', op: '>', value: 5000 },
    },
    { name: 'Finance', approver_role: 'finance' },
  ]

  it('includes conditional step when its condition passes', () => {
    expect(runnableStepIndices(steps, { replacement_cost: 6000 })).toEqual([0, 1, 2, 3])
  })

  it('skips conditional step when its condition fails', () => {
    expect(runnableStepIndices(steps, { replacement_cost: 1000 })).toEqual([0, 1, 3])
  })

  it('skips conditional step when the field is missing', () => {
    expect(runnableStepIndices(steps, {})).toEqual([0, 1, 3])
  })

  it('returns [] for a non-array input', () => {
    expect(runnableStepIndices(null)).toEqual([])
  })
})

describe('stepRequirements', () => {
  it('defaults all flags false except allowReturn (true)', () => {
    expect(stepRequirements({})).toEqual({
      requireSignature: false,
      requirePhoto: false,
      requireGps: false,
      requireCommentOnReturn: false,
      allowReturn: true,
      optional: false,
    })
  })

  it('normalizes truthy jsonb flags', () => {
    const r = stepRequirements({
      require_signature: true,
      require_photo: 'true',
      require_gps: 1,
      require_comment_on_return: true,
      allow_return: false,
      optional: true,
    })
    expect(r).toEqual({
      requireSignature: true,
      requirePhoto: true,
      requireGps: true,
      requireCommentOnReturn: true,
      allowReturn: false,
      optional: true,
    })
  })

  it('is null-safe', () => {
    expect(stepRequirements(null).allowReturn).toBe(true)
    expect(stepRequirements(undefined).requireSignature).toBe(false)
  })
})

describe('missingRequirements', () => {
  const fullStep = {
    name: 'Inspector Review',
    require_signature: true,
    require_photo: true,
    require_gps: true,
  }

  it('reports every missing capture for an empty approve payload', () => {
    expect(missingRequirements(fullStep, {}, 'approve').sort()).toEqual(
      ['gps', 'photo', 'signature'].sort()
    )
  })

  it('returns [] when all required captures are present', () => {
    const payload = {
      signature: 'data:image/png;base64,AAAA',
      photos: ['https://cdn/x.jpg'],
      gps: { lat: 24.7, lng: 46.6, accuracy: 5 },
    }
    expect(missingRequirements(fullStep, payload, 'approve')).toEqual([])
    expect(canAct(fullStep, payload, 'approve')).toBe(true)
  })

  it('accepts the alternate payload key names (signatureData / photoUrls)', () => {
    const payload = {
      signatureData: 'data:image/png;base64,BBBB',
      photoUrls: ['https://cdn/y.jpg'],
      gps: { lat: 1, lng: 2 },
    }
    expect(missingRequirements(fullStep, payload, 'approve')).toEqual([])
  })

  it('treats an empty/whitespace signature as missing', () => {
    expect(missingRequirements({ require_signature: true }, { signature: '   ' }, 'approve')).toEqual([
      'signature',
    ])
  })

  it('treats an empty photo array as missing', () => {
    expect(missingRequirements({ require_photo: true }, { photos: [] }, 'approve')).toEqual(['photo'])
  })

  it('treats a partial GPS fix (no lng) as missing', () => {
    expect(missingRequirements({ require_gps: true }, { gps: { lat: 1 } }, 'approve')).toEqual(['gps'])
  })

  it('requires nothing when the step has no requirement flags', () => {
    expect(missingRequirements({ name: 'Manager' }, {}, 'approve')).toEqual([])
    expect(canAct({ name: 'Manager' }, {}, 'approve')).toBe(true)
  })

  it('return action always requires a comment', () => {
    expect(missingRequirements(fullStep, {}, 'return')).toEqual(['comment'])
    expect(missingRequirements(fullStep, { comment: 'please fix pressure' }, 'return')).toEqual([])
  })

  it('reject action has no mandatory captures', () => {
    expect(missingRequirements(fullStep, {}, 'reject')).toEqual([])
  })
})
