import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  scopeInspections, inspectionMatchesFilters, registerWindowDate, inspectionOverview,
  focusMatches,
} from '../lib/inspectionTyreFlags'

/**
 * THE DEFECT THIS FILE EXISTS TO STOP COMING BACK.
 *
 * The Inspections register showed "195 of 407 shown" under a region filter while the two
 * summary cards directly above it still read the FULL 407. The tiles were computed over
 * the whole loaded list with only the date window applied; every other filter was
 * ignored. Two numbers answering different questions in one viewport.
 *
 * So the contract pinned here is not "the maths is right" - it always was - it is that
 * the tiles are handed the SAME rows the table draws. These tests compose the page's
 * layering (base filters -> status -> tile drill-down) exactly as Inspections.jsx does.
 */

const regionMap = { NHC: 'CENTRAL', DIRIYAH: 'CENTRAL', JED: 'WESTERN' }
const regionOf = (site) => regionMap[site] || ''

const rows = [
  { id: 1, site: 'NHC',     inspector: 'Ali',   status: 'Done',        approval_status: 'approved',
    asset_no: 'TM001', scheduled_date: '2026-03-01', title: 'Weekly check' },
  { id: 2, site: 'NHC',     inspector: 'Sara',  status: 'In Progress', approval_status: 'pending_approval',
    asset_no: 'TM002', scheduled_date: '2026-03-05', title: 'Tyre round' },
  { id: 3, site: 'JED',     inspector: 'Ali',   status: 'Done',        approval_status: 'approved',
    asset_no: 'TM003', scheduled_date: '2026-03-10', title: 'Weekly check' },
  { id: 4, site: 'DIRIYAH', inspector: 'Omar',  status: 'Overdue',     approval_status: 'pending_approval',
    asset_no: 'TM004', scheduled_date: '2026-04-02', title: 'Gate audit' },
  // No usable date at all: excluded the moment a range is active, never swept in.
  { id: 5, site: 'NHC',     inspector: 'Ali',   status: 'Scheduled',   approval_status: null,
    asset_no: 'TM005', title: 'Undated' },
  // Site the register does not place in any region.
  { id: 6, site: 'UNPLACED', inspector: 'Sara', status: 'Done',        approval_status: 'approved',
    asset_no: 'TM006', scheduled_date: '2026-03-11', title: 'Yard sweep' },
]

const ALL = { site: 'all', region: 'all', inspector: 'all', from: '', to: '', search: '' }

describe('registerWindowDate', () => {
  it('prefers scheduled, then completed, then created', () => {
    expect(registerWindowDate({ scheduled_date: '2026-01-01', completed_date: '2026-02-02' })).toBe('2026-01-01')
    expect(registerWindowDate({ completed_date: '2026-02-02', created_at: '2026-03-03T10:00:00Z' })).toBe('2026-02-02')
    expect(registerWindowDate({ created_at: '2026-03-03T10:00:00Z' })).toBe('2026-03-03')
  })

  it('returns an empty string when the row carries no date at all', () => {
    expect(registerWindowDate({})).toBe('')
    expect(registerWindowDate(null)).toBe('')
  })
})

describe('inspectionMatchesFilters', () => {
  it('passes everything when no filter is set', () => {
    expect(scopeInspections(rows, ALL, { regionOf })).toHaveLength(rows.length)
  })

  it('narrows by site, inspector and search independently', () => {
    expect(scopeInspections(rows, { ...ALL, site: 'NHC' }, { regionOf }).map(r => r.id)).toEqual([1, 2, 5])
    expect(scopeInspections(rows, { ...ALL, inspector: 'Ali' }, { regionOf }).map(r => r.id)).toEqual([1, 3, 5])
    expect(scopeInspections(rows, { ...ALL, search: 'weekly' }, { regionOf }).map(r => r.id)).toEqual([1, 3])
  })

  it('combines filters rather than replacing them', () => {
    const out = scopeInspections(rows, { ...ALL, site: 'NHC', inspector: 'Ali' }, { regionOf })
    expect(out.map(r => r.id)).toEqual([1, 5])
  })

  it('EXCLUDES a site the register cannot place, rather than sweeping it into the chosen region', () => {
    const out = scopeInspections(rows, { ...ALL, region: 'CENTRAL' }, { regionOf })
    expect(out.map(r => r.id)).toEqual([1, 2, 4, 5])
    expect(out.some(r => r.site === 'UNPLACED')).toBe(false)
  })

  it('matches NOTHING when a region is asked for and no resolver is supplied', () => {
    // Guessing here would silently claim every unplaced site belongs to the region.
    expect(scopeInspections(rows, { ...ALL, region: 'CENTRAL' })).toHaveLength(0)
  })

  it('compares dates as strings and drops undated rows while a range is active', () => {
    const out = scopeInspections(rows, { ...ALL, from: '2026-03-01', to: '2026-03-31' }, { regionOf })
    expect(out.map(r => r.id)).toEqual([1, 2, 3, 6])
    // Undated row is back the moment the range is cleared.
    expect(scopeInspections(rows, ALL, { regionOf }).map(r => r.id)).toContain(5)
  })

  it('reads a filter that matches nothing as EMPTY, never as the unfiltered list', () => {
    expect(scopeInspections(rows, { ...ALL, site: 'NOWHERE' }, { regionOf })).toEqual([])
    expect(scopeInspections(rows, { ...ALL, search: 'zzzz' }, { regionOf })).toEqual([])
  })

  it('is null-tolerant', () => {
    expect(scopeInspections(null, ALL, { regionOf })).toEqual([])
    expect(inspectionMatchesFilters(null, ALL)).toBe(false)
    expect(inspectionMatchesFilters({ site: 'NHC' }, null)).toBe(true)
  })
})

/**
 * The layering the page composes. `scoped` is what the tiles count; `filtered` is what
 * the table draws. They differ only by the tile drill-down, deliberately.
 */
const scopeOf = (filters) => scopeInspections(rows, filters, { regionOf })
const withStatus = (list, status) => (status === 'all' ? list : list.filter(r => r.status === status))

describe('the overview tiles follow the register filters', () => {
  it('counts the FILTERED set, not the whole register', () => {
    const all = inspectionOverview(rows, {})
    expect(all.inspectionsDone).toBe(6)

    const central = inspectionOverview(scopeOf({ ...ALL, region: 'CENTRAL' }), {})
    expect(central.inspectionsDone).toBe(4)
    // The regression: the tile used to keep reading 6 here.
    expect(central.inspectionsDone).not.toBe(all.inspectionsDone)
  })

  it('agrees with the row count the table reports for that same scope', () => {
    for (const filters of [
      { ...ALL, site: 'NHC' },
      { ...ALL, inspector: 'Ali' },
      { ...ALL, region: 'CENTRAL' },
      { ...ALL, from: '2026-03-01', to: '2026-03-31' },
      { ...ALL, search: 'weekly' },
    ]) {
      const scoped = scopeOf(filters)
      expect(inspectionOverview(scoped, {}).inspectionsDone).toBe(scoped.length)
    }
  })

  it('follows the status pills too', () => {
    const done = withStatus(scopeOf(ALL), 'Done')
    const ov = inspectionOverview(done, {})
    expect(ov.inspectionsDone).toBe(3)
    expect(ov.approved).toBe(3)
    expect(ov.pendingApproval).toBe(0)
  })

  it('reports zero for a filter that matches nothing', () => {
    const ov = inspectionOverview(scopeOf({ ...ALL, site: 'NOWHERE' }), {})
    expect(ov.inspectionsDone).toBe(0)
    expect(ov.vehiclesInspected).toBe(0)
    expect(ov.approved).toBe(0)
    expect(ov.pendingApproval).toBe(0)
  })

  it('narrows the tyre-change flag figures to the vehicles the filtered inspections cover', () => {
    const flagMap = {
      TM001: { count: 2, overdue: [{}, {}], dueSoon: [] },
      TM003: { count: 1, overdue: [], dueSoon: [{}] },
    }
    const all = inspectionOverview(rows, flagMap)
    expect(all.vehiclesWithTyresDue).toBe(2)
    expect(all.tyresOverdue).toBe(2)
    expect(all.tyresDueSoon).toBe(1)

    // JED holds only TM003, so its overdue tyres drop out with its vehicle.
    const jed = inspectionOverview(scopeOf({ ...ALL, site: 'JED' }), flagMap)
    expect(jed.vehiclesWithTyresDue).toBe(1)
    expect(jed.tyresOverdue).toBe(0)
    expect(jed.tyresDueSoon).toBe(1)
  })
})

describe('the status pills hold their own dimension out', () => {
  // Each pill must state how many rows CLICKING IT would show. Counting them over the
  // already-status-filtered list printed (0) on every unselected pill.
  const pillCounts = (base) => {
    const c = { all: base.length, Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
    base.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }

  it('keeps every pill actionable while one status is selected', () => {
    const base = scopeOf(ALL)           // status deliberately NOT applied
    const counts = pillCounts(base)
    expect(counts.Done).toBe(3)
    expect(counts['In Progress']).toBe(1)
    expect(counts.Overdue).toBe(1)
    // Each count equals the rows that status actually yields.
    for (const status of ['Done', 'In Progress', 'Overdue', 'Scheduled']) {
      expect(withStatus(base, status)).toHaveLength(counts[status])
    }
  })

  it('still narrows with the other filters', () => {
    const counts = pillCounts(scopeOf({ ...ALL, site: 'NHC' }))
    expect(counts.all).toBe(3)
    expect(counts.Done).toBe(1)
  })
})

describe('the tile drill-down narrows the table without zeroing the tiles', () => {
  it('leaves the tiles reading the scope, and the table reading the drill-down', () => {
    const scoped = scopeOf(ALL)
    const ov = inspectionOverview(scoped, {})
    expect(ov.approved).toBe(3)
    expect(ov.pendingApproval).toBe(2)

    // Drilling into "Approved" must not make "Pending approval" read 0.
    const table = scoped.filter(r => focusMatches(r, 'approved', {}))
    expect(table).toHaveLength(3)
    expect(inspectionOverview(scoped, {}).pendingApproval).toBe(2)
  })

  it('composes with the other filters rather than replacing them', () => {
    const scoped = scopeOf({ ...ALL, site: 'NHC' })
    const table = scoped.filter(r => focusMatches(r, 'approved', {}))
    expect(table.map(r => r.id)).toEqual([1])
  })
})

/**
 * THE WIRING GUARD.
 *
 * The tests above prove the maths narrows correctly, but the bug was never in the maths -
 * it was in WHICH rows the page handed the engine. That is a property of how
 * Inspections.jsx is wired, and a regression there looks exactly like working code in
 * review, so it is read from source (the same approach as rowCapGuard / consoleSurfaceGuard).
 */
describe('Inspections.jsx wires the tiles to the filtered rows', () => {
  const src = readFileSync(join(process.cwd(), 'src/pages/Inspections.jsx'), 'utf8')

  it('feeds inspectionOverview the scoped rows, never the unfiltered tab list', () => {
    const call = src.match(/inspectionOverview\(([^)]*)\)/)
    expect(call, 'inspectionOverview should still be called').toBeTruthy()
    expect(call[1].trim()).toMatch(/^scoped\b/)
    expect(src).not.toMatch(/inspectionOverview\(\s*tabFiltered/)
    expect(src).not.toMatch(/inspectionOverview\(\s*rows\b/)
  })

  it('holds the tile drill-down OUT of the tiles, so a focused tile cannot zero its siblings', () => {
    // `scoped` is defined without focusMatches; only `filtered` applies it.
    const scoped = src.match(/const scoped = useMemo\([\s\S]*?\n  \)/)
    expect(scoped, 'scoped memo should exist').toBeTruthy()
    expect(scoped[0]).not.toMatch(/focusMatches/)
  })

  it('holds the status filter OUT of the status pill counts', () => {
    const counts = src.match(/const statusCounts = useMemo\([\s\S]*?\n  \}, \[[^\]]*\]\)/)
    expect(counts, 'statusCounts memo should exist').toBeTruthy()
    // Counting over `filtered` (or `scoped`) is what printed (0) on every unselected pill.
    expect(counts[0]).toMatch(/filteredBase/)
    expect(counts[0]).not.toMatch(/\bfiltered\b(?!Base)/)
    expect(counts[0]).not.toMatch(/\bscoped\b/)
  })

  it('says what the tiles cover instead of leaving a scoped number looking unscoped', () => {
    expect(src).toMatch(/scopeActive/)
    expect(src).toMatch(/caption=\{scopeCaption\}/)
  })

  it('refuses to state a count while the read has failed', () => {
    // "We could not look" and "there is nothing" are opposite facts.
    expect(src).toMatch(/const unreadable = !!loadError/)
    expect(src).toMatch(/const num = \(v\) => \(unreadable \? null : v\)/)
    expect(src).toMatch(/setLoadError/)
  })
})

/**
 * Inspection sign-off. The pad and the required-signature guard were already there; the
 * gate and the read-only signed-off view were not.
 */
describe('Inspections.jsx sign-off', () => {
  const src = readFileSync(join(process.cwd(), 'src/pages/Inspections.jsx'), 'utf8')

  it('offers the sign-off controls only to someone allowed to sign', () => {
    expect(src).toMatch(/const canApproveInspection = Boolean\(/)
    // Reuses the app's existing approver role set rather than a new hardcoded list.
    expect(src).toMatch(/const APPROVER_ROLES = \[\.\.\.ANALYTICS_ROLES, 'Maintenance Supervisor'\]/)
    expect(src).toMatch(/APPROVER_ROLES\.includes\(profile\?\.role\)/)
    expect(src).toMatch(/hasCapability\?\.\('inspections', 'approve'\)/)
    // Both decisions, and the pad itself, sit behind it.
    expect(src).toMatch(/approval_status !== 'approved' && canApproveInspection &&/)
    expect(src).toMatch(/showApproverPad && canApproveInspection &&/)
  })

  it('still requires a drawn signature before an approval can be written', () => {
    expect(src).toMatch(/if \(!approverSig\) \{ setApproveMsg/)
    expect(src).toMatch(/signature: approverSig/)
    expect(src).toMatch(/disabled=\{approveSubmitting \|\| !approverSig\}/)
  })

  it('writes the decision through the guarded RPC, never a direct table update', () => {
    // A direct update cannot check that the row is still undecided, cannot derive the
    // approver from the session, and is governed by a policy that admits inspectors and
    // excludes directors. Both decisions must go through decideInspectionApproval.
    expect(src).toMatch(/inspectionsApi\.decideInspectionApproval\(approveTarget\.id, \{\s*\n\s*approved: true/)
    expect(src).toMatch(/inspectionsApi\.decideInspectionApproval\(approveTarget\.id, \{\s*\n\s*approved: false/)
    // The old direct writes are gone.
    expect(src).not.toMatch(/patchInspection\(approveTarget\.id, \{\s*\n\s*approval_status:/)
    // And the client no longer claims to know who signed or when.
    expect(src).not.toMatch(/approved_by: profile\?\.id/)
  })

  it('shows the signing account read-only rather than an editable name box', () => {
    expect(src).toMatch(/Signing as <strong/)
  })

  it('re-reads the decided row instead of echoing what it hoped was written', () => {
    expect(src).toMatch(/const refreshApproveTarget = useCallback/)
    expect(src).toMatch(/await refreshApproveTarget\(/)
    expect(src).toMatch(/err\?\.alreadyDecided/)
  })

  it('clears the signature and the note when a different record is opened', () => {
    // Carrying either across would attach one person's signature to another inspection.
    const eff = src.match(/useEffect\(\(\) => \{\s*\n\s*setApproveNote\(''\)[\s\S]*?\}, \[approveTarget\?\.id\]\)/)
    expect(eff).toBeTruthy()
    expect(eff[0]).toMatch(/setApproverSig\(null\)/)
  })

  it('requires a reason before an inspection is returned', () => {
    expect(src).toMatch(/disabled=\{approveSubmitting \|\| !approveNote\.trim\(\)\}/)
  })

  it('never reports the best-effort reason echo as a failed decision', () => {
    // The decision is already committed by the time the echo runs.
    const echo = src.match(/Returned for rework[\s\S]{0,200}/)
    expect(echo).toBeTruthy()
    expect(src).toMatch(/\}\)\.catch\(\(\) => \{\}\)/)
  })

  it('shows the stored signature on an approved record instead of offering the pad again', () => {
    expect(src).toMatch(/approveTarget\.approval_status === 'approved' \? \(/)
    expect(src).toMatch(/src=\{approveTarget\.approver_signature\}/)
    expect(src).toMatch(/Signed off on \$\{formatDate\(approveTarget\.approved_at\)\}/)
  })

  it('reports a failed decision instead of announcing success', () => {
    // The write used to be wrapped in `catch { }` and then always claimed it worked.
    expect(src).not.toMatch(/catch \{ \/\* mirror prior fire-and-forget: surface result regardless \*\/ \}/)
    expect(src).toMatch(/Could not save the approval\. The inspection is unchanged\./)
    expect(src).toMatch(/Could not record the rejection\. Nothing was saved\./)
  })
})

describe('inspections service: decideInspectionApproval', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/api/inspections.js'), 'utf8')

  it('calls the RPC with the signature and lets the server own the rest', () => {
    expect(src).toMatch(/supabase\.rpc\('decide_inspection_approval'/)
    expect(src).toMatch(/p_signature: signature \|\| null/)
    // The trigger locks the record on the transition the RPC performs.
    expect(src).not.toMatch(/locked: true/)
  })

  it('never echoes the database refusal verbatim', () => {
    // It reads the raw message only to CHOOSE one of our own fixed strings.
    expect(src).toMatch(/e\.alreadyDecided = true/)
    expect(src).toMatch(/This inspection was already decided by someone else\./)
    expect(src).not.toMatch(/message: raw/)
  })
})
