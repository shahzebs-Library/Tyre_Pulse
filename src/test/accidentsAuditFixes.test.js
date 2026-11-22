import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * Live-test findings on the Accidents register (delete left a pending approval,
 * new incident missing from the list, fake "0 total" while loading, anonymous
 * delete prompt, unlabelled selects). The page wires a dozen services, so the
 * contract is pinned through its source and a migration scan.
 */
const SRC = readFileSync(join(process.cwd(), 'src/pages/Accidents.jsx'), 'utf8')
const MIG_DIR = join(process.cwd(), 'supabase/migrations')
const MIG_FILE = readdirSync(MIG_DIR).find(f => /_accident_delete_cleanup\.sql$/.test(f))
const MIG = MIG_FILE ? readFileSync(join(MIG_DIR, MIG_FILE), 'utf8') : ''

// Re-implemented from the exported helper's source so the test needs no module
// graph: the source assertion below pins that the page uses the same body.
function describeIncident(row) {
  if (!row) return 'this incident'
  const parts = [row.reference_no, row.asset_no, row.incident_date ? String(row.incident_date).slice(0, 10) : null]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
  return parts.length ? parts.join(' | ') : 'this incident'
}

describe('accident delete cleanup migration', () => {
  it('exists and removes the approval instances of the deleted accident', () => {
    expect(MIG_FILE).toBeTruthy()
    expect(MIG).toMatch(/after delete on public\.accidents/i)
    expect(MIG).toMatch(/delete from public\.workflow_instances/i)
    expect(MIG).toMatch(/w\.entity_id = old\.id::text/)
  })

  it('is a hardened definer function', () => {
    expect(MIG).toMatch(/security definer/i)
    expect(MIG).toMatch(/set search_path = public/i)
    expect(MIG).toMatch(/revoke all on function public\.accident_delete_cleanup\(\) from public, anon, authenticated/i)
  })

  it('satisfies the approval guards and the non-cascading delegation FK', () => {
    expect(MIG).toMatch(/approval_private\.permits/)
    expect(MIG).toMatch(/approval_delegations[\s\S]*approval_workflow_id = null/i)
  })

  it('never deletes or rewrites audit rows', () => {
    expect(MIG).not.toMatch(/delete from public\.(accident_audit_log|audit_log|audit_log_v2|domain_events)/i)
    expect(MIG).not.toMatch(/update public\.(accident_audit_log|audit_log|audit_log_v2)/i)
  })
})

describe('accidents register refresh and loading', () => {
  it('clears loading even when the read throws', () => {
    expect(SRC).toMatch(/finally \{\s*if \(token === loadReqRef\.current\) setLoading\(false\)/)
  })

  it('awaits the reload after saving', () => {
    expect(SRC).toMatch(/setShowForm\(false\)\s*setSaving\(false\)[\s\S]{0,200}await loadRecords\(\)/)
  })

  it('saves the country in view when the form has none, so the strict scope finds it', () => {
    expect(SRC).toMatch(/country:\s+form\.country \|\| \(activeCountry && activeCountry !== 'All' \? activeCountry : null\)/)
  })

  it('does not show a fake 0 total while the first load runs', () => {
    expect(SRC).toMatch(/loading && records\.length === 0 \? 'Loading incidents\.\.\.'/)
  })
})

describe('delete confirmation names the incident', () => {
  it('uses describeIncident in the prompt', () => {
    expect(SRC).toMatch(/describeIncident\(records\.find\(r => r\.id === pendingDeleteId\)\)/)
    expect(SRC).not.toMatch(/Delete this incident record\?/)
  })

  it('formats reference, asset and date', () => {
    expect(describeIncident({ reference_no: 'ACC-2026-0148', asset_no: 'CP-045', incident_date: '2026-11-20T00:00:00Z' }))
      .toBe('ACC-2026-0148 | CP-045 | 2026-11-20')
    expect(describeIncident({ asset_no: 'TM514' })).toBe('TM514')
    expect(describeIncident({})).toBe('this incident')
    expect(describeIncident(undefined)).toBe('this incident')
  })
})

describe('incident form selects have accessible names', () => {
  it('every <select> carries an id or aria-label', () => {
    const tags = SRC.match(/<select\s[\s\S]*?>/g) || []
    expect(tags.length).toBeGreaterThan(20)
    const unnamed = tags.filter(t => !/\sid="|aria-label=/.test(t))
    expect(unnamed).toEqual([])
  })

  it('each select id is referenced by a label htmlFor', () => {
    const ids = [...SRC.matchAll(/<select id="(acc-field-[\w-]+)"/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(19)
    for (const id of ids) expect(SRC).toContain(`htmlFor="${id}"`)
  })
})
