/**
 * Per-user override reconciliation - exactly ONE effective grant row per module.
 *
 * `user_access_grants` is UNIQUE (user_id, module_key, capability, effect) and
 * `set_user_access_grant` upserts on that SAME four-column key (V225), so the
 * effect is part of the conflict target: writing a 'grant' does NOT overwrite an
 * existing 'revoke', it inserts a SECOND row beside it. Every reader resolves
 * such a pair as revoke (get_my_access_grants / user_has_capability in V225,
 * admin_get_effective_access in V230, resolveAccess step 2), so a leftover
 * revoke silently wins and an Allow looks like it did nothing.
 *
 * These tests pin the planner that the Preview and Override screen uses to keep
 * the ledger authoritative:
 *   - Deny -> Allow removes the stale revoke (the user really is allowed)
 *   - Clear removes EVERY matching row, not just the first one
 */
import { describe, it, expect } from 'vitest'
import { planUserOverrideWrite, mobileGrantKey } from '../lib/api/accessGrants'
import { resolveAccess } from '../lib/accessResolver'

const USER = 'u-1'

/* ---- Minimal model of the V225 ledger + its RPCs (upsert on 4-col key) ---- */

function makeLedger(rows = []) {
  return rows.map((r, i) => ({
    id: r.id || `g${i + 1}`,
    user_id: r.user_id || USER,
    module_key: r.module_key,
    capability: r.capability || 'view',
    effect: r.effect,
  }))
}

/** Mirrors set_user_access_grant: ON CONFLICT (user_id, module_key, capability, effect). */
function setGrant(ledger, { moduleKey, capability = 'view', effect }) {
  const hit = ledger.find(
    (r) => r.user_id === USER && r.module_key === moduleKey &&
      r.capability === capability && r.effect === effect,
  )
  if (hit) return hit.id // DO UPDATE: same row, no new row
  const row = { id: `n${ledger.length + 1}`, user_id: USER, module_key: moduleKey, capability, effect }
  ledger.push(row)
  return row.id
}

/** Mirrors revoke_user_access_grant(p_id): delete by id. */
function deleteGrant(ledger, id) {
  const i = ledger.findIndex((r) => r.id === id)
  if (i >= 0) ledger.splice(i, 1)
}

/** Mirrors get_my_access_grants: DISTINCT ON (module_key) ORDER BY effect='revoke' DESC. */
function effectiveOverride(ledger, moduleKey) {
  const rows = ledger.filter(
    (r) => r.user_id === USER && r.module_key === moduleKey && r.capability === 'view',
  )
  if (rows.some((r) => r.effect === 'revoke')) return 'revoke'
  if (rows.some((r) => r.effect === 'grant')) return 'grant'
  return undefined
}

/** Replays exactly what the page does for one override click. */
function applyOverride(ledger, moduleKey, action) {
  const { effect, deleteIds } = planUserOverrideWrite(ledger, moduleKey, { capability: 'view', action })
  if (effect) setGrant(ledger, { moduleKey, effect })   // write first (fails closed)
  for (const id of deleteIds) deleteGrant(ledger, id)
  return { effect, deleteIds }
}

const rowsFor = (ledger, key) => ledger.filter((r) => r.module_key === key)

/* -------------------------------- planner -------------------------------- */

describe('planUserOverrideWrite', () => {
  it('Allow deletes an existing revoke and writes a grant', () => {
    const ledger = makeLedger([{ id: 'r1', module_key: 'analytics', effect: 'revoke' }])
    expect(planUserOverrideWrite(ledger, 'analytics', { action: 'grant' }))
      .toEqual({ effect: 'grant', deleteIds: ['r1'] })
  })

  it('Deny deletes an existing grant and writes a revoke', () => {
    const ledger = makeLedger([{ id: 'g1', module_key: 'analytics', effect: 'grant' }])
    expect(planUserOverrideWrite(ledger, 'analytics', { action: 'revoke' }))
      .toEqual({ effect: 'revoke', deleteIds: ['g1'] })
  })

  it('Clear deletes EVERY matching row, not just the first', () => {
    const ledger = makeLedger([
      { id: 'g1', module_key: 'analytics', effect: 'grant' },
      { id: 'r1', module_key: 'analytics', effect: 'revoke' },
    ])
    const plan = planUserOverrideWrite(ledger, 'analytics', { action: 'clear' })
    expect(plan.effect).toBeNull()
    expect(plan.deleteIds).toEqual(['g1', 'r1']) // grant first: a partial failure fails closed
  })

  it('plans no deletes when the module has no override yet', () => {
    expect(planUserOverrideWrite([], 'analytics', { action: 'grant' }))
      .toEqual({ effect: 'grant', deleteIds: [] })
  })

  it('re-applying the same effect deletes nothing (the upsert handles it)', () => {
    const ledger = makeLedger([{ id: 'g1', module_key: 'analytics', effect: 'grant' }])
    expect(planUserOverrideWrite(ledger, 'analytics', { action: 'grant' }).deleteIds).toEqual([])
  })

  it('never touches another module, another capability, or the mobile surface', () => {
    const ledger = makeLedger([
      { id: 'other', module_key: 'reports', effect: 'revoke' },
      { id: 'cap', module_key: 'analytics', capability: 'edit', effect: 'revoke' },
      { id: 'mob', module_key: mobileGrantKey('analytics'), effect: 'revoke' },
      { id: 'r1', module_key: 'analytics', effect: 'revoke' },
    ])
    expect(planUserOverrideWrite(ledger, 'analytics', { action: 'grant' }).deleteIds).toEqual(['r1'])
    expect(planUserOverrideWrite(ledger, 'analytics', { action: 'clear' }).deleteIds).toEqual(['r1'])
  })

  it('degrades safely on malformed input', () => {
    expect(planUserOverrideWrite(null, 'analytics', { action: 'grant' }))
      .toEqual({ effect: 'grant', deleteIds: [] })
    expect(planUserOverrideWrite([null, { module_key: 'analytics', effect: 'revoke' }], 'analytics', { action: 'grant' }))
      .toEqual({ effect: 'grant', deleteIds: [] }) // no id -> nothing to delete
    expect(planUserOverrideWrite([], 'analytics', { action: 'bogus' }))
      .toEqual({ effect: null, deleteIds: [] })
  })
})

/* ------------------- end to end against the real resolver ------------------ */

describe('override flips leave exactly one effective row', () => {
  it('Deny then Allow really allows the user (stale revoke is gone)', () => {
    const ledger = makeLedger()
    applyOverride(ledger, 'analytics', 'revoke')
    expect(effectiveOverride(ledger, 'analytics')).toBe('revoke')

    applyOverride(ledger, 'analytics', 'grant')

    expect(rowsFor(ledger, 'analytics')).toHaveLength(1)
    expect(effectiveOverride(ledger, 'analytics')).toBe('grant')
    // The real engine, with the role denying it: only the grant can allow.
    expect(resolveAccess({
      role: 'Reporter', roleAllows: false, grant: true, revoke: false,
    }).allowed).toBe(true)
  })

  it('Allow then Deny really denies the user', () => {
    const ledger = makeLedger()
    applyOverride(ledger, 'analytics', 'grant')
    applyOverride(ledger, 'analytics', 'revoke')

    expect(rowsFor(ledger, 'analytics')).toHaveLength(1)
    expect(effectiveOverride(ledger, 'analytics')).toBe('revoke')
    // Role allows it, but the revoke must still win.
    expect(resolveAccess({
      role: 'Manager', roleAllows: true, grant: false, revoke: true,
    }).allowed).toBe(false)
  })

  it('Clear after a Deny then Allow leaves no override at all in ONE click', () => {
    const ledger = makeLedger([
      { id: 'g1', module_key: 'analytics', effect: 'grant' },
      { id: 'r1', module_key: 'analytics', effect: 'revoke' },
    ])
    applyOverride(ledger, 'analytics', 'clear')

    expect(rowsFor(ledger, 'analytics')).toHaveLength(0)
    expect(effectiveOverride(ledger, 'analytics')).toBeUndefined()
    // Falls back to the role.
    expect(resolveAccess({
      role: 'Manager', roleAllows: true, grant: false, revoke: false,
    }).reason).toBe('role')
  })

  it('flipping repeatedly never accumulates rows', () => {
    const ledger = makeLedger()
    for (const a of ['grant', 'revoke', 'grant', 'revoke', 'grant']) {
      applyOverride(ledger, 'analytics', a)
      expect(rowsFor(ledger, 'analytics')).toHaveLength(1)
    }
    expect(effectiveOverride(ledger, 'analytics')).toBe('grant')
  })
})
