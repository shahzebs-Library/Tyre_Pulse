import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, '../../', p), 'utf8')

/**
 * Pins the server-side CPK repoint to the T7 km rule (F-E-01 / F-E-02), the way
 * tyreRunningLifeBands pins the running-life bands: if either migration is
 * rewritten to divide by raw total_km again, this fails. The maths lives in SQL;
 * this guards that the maths was actually applied.
 */
describe('CPK repoint migrations use the T7 lifetime layer, not raw km', () => {
  const fleetKm = read('supabase/migrations/20261110142000_fleet_tyre_km_rule_t7.sql')
  const brandCpk = read('supabase/migrations/20261110143000_brand_size_cpk_lifetime.sql')

  it('fleet_tyre_km_by_asset sums tyre_km_life, not sum(total_km)', () => {
    const ddl = fleetKm.replace(/--.*$/gm, '') // drop comments (rollback snippet references the old body)
    expect(ddl).toMatch(/create or replace function public\.fleet_tyre_km_by_asset/i)
    expect(ddl).toContain('sum(public.tyre_km_life(')
    expect(ddl).toContain('coalesce(nullif(btrim(t.vehicle_type)') // fleet-type fallback (F-E-04)
    expect(ddl).not.toMatch(/sum\(t\.total_km\)/) // the raw denominator must be gone from the live body
    expect(ddl).not.toMatch(/\berrcode\s+'?40001/i) // never RAISE 40001 (PostgREST retry loop)
  })

  it('get_brand_size_cpk is weighted from v_tyre_lifetime, not avg per row', () => {
    const ddl = brandCpk.replace(/--.*$/gm, '')
    expect(ddl).toMatch(/create or replace function public\.get_brand_size_cpk/i)
    expect(ddl).toContain('from public.v_tyre_lifetime')
    expect(ddl).toContain('sum(purchase_cost * qty)')
    expect(ddl).toContain('sum(km_known      * qty)')
    // the old per-row avg(cost)/avg(life) formula must be gone
    expect(ddl).not.toMatch(/avg_price \/ avg_life_km/)
  })
})
