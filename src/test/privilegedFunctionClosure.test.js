import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve('supabase/migrations/20260830190948_restrict_trigger_function_execution.sql'),
  'utf8',
)

describe('privileged function execution closure', () => {
  it('removes direct client execution from every public trigger function', () => {
    expect(sql).toContain("p.prorettype = 'pg_catalog.trigger'::regtype")
    expect(sql).toMatch(/revoke execute on function %s from public, anon, authenticated/i)
  })

  it('keeps identifier login explicit without granting every database role', () => {
    expect(sql).toContain('revoke execute on function public.get_email_by_identifier(text) from public')
    expect(sql).toContain('grant execute on function public.get_email_by_identifier(text) to anon, authenticated')
  })
})
