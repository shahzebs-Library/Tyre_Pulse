import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(path.resolve('supabase/migrations/20260830184652_production_security_closure.sql'), 'utf8')

describe('production Supabase security closure', () => {
  it('removes authenticated access from internal migration artefacts', () => {
    for (const table of [
      '_anon_execute_revoked_v500', '_bak_tyre_size_backfill_v476',
      '_current_km_snapshot_v407', '_rls_policy_backup_v498',
      '_workshop_snapshot_v399',
    ]) {
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`)
    }
  })

  it('enforces tenant-scoped idempotency only for automatic actions', () => {
    expect(sql).toMatch(/unique index[^;]+\(organisation_id, source\)[^;]+source like 'auto:%'/s)
  })

  it('does not disable RLS or grant public access', () => {
    expect(sql).not.toMatch(/disable row level security/i)
    expect(sql).not.toMatch(/grant\s+.+\s+to\s+(public|anon)/i)
  })
})


