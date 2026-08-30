import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve('supabase/migrations/20260830190620_allow_domain_event_processing_state.sql'),
  'utf8',
)

describe('domain event database guard', () => {
  it('allows dispatcher state updates while preserving immutable event fields', () => {
    for (const column of [
      'id', 'event_type', 'entity_type', 'entity_id',
      'organisation_id', 'actor_id', 'payload', 'created_at',
    ]) {
      expect(sql).toContain(`new.${column} is distinct from old.${column}`)
    }
    for (const mutableColumn of ['status', 'attempts', 'last_error', 'processed_at']) {
      expect(sql).not.toContain(`new.${mutableColumn} is distinct from old.${mutableColumn}`)
    }
  })

  it('keeps deletes blocked and exposes no callable RPC', () => {
    expect(sql).toMatch(/if tg_op = 'DELETE' then/i)
    expect(sql).toContain('security invoker')
    expect(sql).toMatch(/revoke all on function public\.guard_domain_event_mutation\(\) from public, anon, authenticated/i)
  })
})
