import { describe, it, expect } from 'vitest'
import {
  SOURCE_FEEDS, targetForSource, tablesFor, tableForCountry, howToFill,
  reimportWarning, uploadableSources,
} from '../lib/coverageSources'
import { IMPORT_TARGETS } from '../lib/importTargets'

describe('every coverage source is tied to something real', () => {
  it('names the four sources the coverage view actually reports', () => {
    // Measured from get_upload_coverage_detail on the live database.
    expect(Object.keys(SOURCE_FEEDS).sort())
      .toEqual(['expenses', 'job_cards', 'production_m3', 'tyre_records'])
  })

  it('resolves each file-backed source to a registered import target', () => {
    expect(targetForSource('expenses')?.feeds).toBe('parts_consumption')
    expect(targetForSource('job_cards')?.feeds).toBe('work_orders')
    expect(targetForSource('tyre_records')?.feeds).toBe('tyre_records')
  })

  it('returns null for production, which genuinely has no upload file', () => {
    // production_logs has no staging table. Inventing one here would send
    // someone hunting for an export that does not exist.
    expect(targetForSource('production_m3')).toBeNull()
  })

  it('returns null for a source it has never heard of', () => {
    expect(targetForSource('something_new')).toBeNull()
    expect(targetForSource(undefined)).toBeNull()
  })

  it('derives from IMPORT_TARGETS, so the two cannot drift', () => {
    // Every feeds value we claim must exist in the registry, or the panel would
    // silently show nothing for a real gap.
    const registryFeeds = new Set(IMPORT_TARGETS.map((t) => t.feeds))
    const claimed = Object.values(SOURCE_FEEDS).filter((f) => f !== 'production_logs')
    claimed.forEach((f) => expect(registryFeeds.has(f)).toBe(true))
  })
})

describe('picking the right table for a country', () => {
  const target = targetForSource('expenses')

  it('splits the combined label into real table names', () => {
    expect(tablesFor(target)).toEqual(['expenses_ksa', 'expenses_uae', 'expenses_egypt'])
  })

  it('matches on the suffix, not on position', () => {
    // A positional guess breaks the moment a country is added out of order.
    expect(tableForCountry(target, 'Egypt')).toBe('expenses_egypt')
    expect(tableForCountry(target, 'KSA')).toBe('expenses_ksa')
    expect(tableForCountry(target, 'UAE')).toBe('expenses_uae')
  })

  it('is case insensitive about the country', () => {
    expect(tableForCountry(target, 'egypt')).toBe('expenses_egypt')
  })

  it('returns null for a country with no table rather than guessing one', () => {
    expect(tableForCountry(target, 'Oman')).toBeNull()
    expect(tableForCountry(target, '')).toBeNull()
  })

  it('returns the single table when a target is not split by country', () => {
    const single = IMPORT_TARGETS.find((t) => !String(t.table).includes('/'))
    if (single) expect(tableForCountry(single, 'KSA')).toBe(single.table.trim())
  })
})

describe('howToFill answers the question the gap raises', () => {
  it('gives the file, the table and the headers for a real gap', () => {
    const h = howToFill('expenses', 'KSA')
    expect(h.available).toBe(true)
    expect(h.intoTable).toBe('expenses_ksa')
    expect(h.sourceFile).toMatch(/grid/i)
    expect(h.columns.length).toBeGreaterThan(0)
    // the misspelling is deliberate and must survive - the importer matches the
    // header literally
    expect(h.columns).toContain('Trye')
  })

  it('explains rather than shrugs when there is no file', () => {
    const h = howToFill('production_m3', 'KSA')
    expect(h.available).toBe(false)
    expect(h.reason).toMatch(/entered in the app/i)
  })

  it('distinguishes no-file from unknown-source', () => {
    // Two different answers that must not render the same way.
    expect(howToFill('production_m3').reason).not.toBe(howToFill('mystery').reason)
  })
})

describe('the re-import warning names the consequence', () => {
  it('says a needs-key file duplicates spend without its line number', () => {
    const w = reimportWarning('needs-key')
    expect(w.tone).toBe('danger')
    expect(w.text).toMatch(/line-number/i)
    expect(w.text).toMatch(/second time|goes up/i)
  })

  it('says a safe file refreshes in place', () => {
    expect(reimportWarning('safe').tone).toBe('good')
  })

  it('does not claim safety for an unknown setting', () => {
    // Silence here would read as "go ahead".
    expect(reimportWarning(undefined).tone).toBe('default')
    expect(reimportWarning('whatever').tone).toBe('default')
  })

  it('accepts a target object as well as the bare value', () => {
    expect(reimportWarning({ reimportSafe: 'safe' }).tone).toBe('good')
  })
})

describe('uploadableSources', () => {
  it('lists only the sources a file can actually close', () => {
    const list = uploadableSources()
    expect(list).toContain('expenses')
    expect(list).not.toContain('production_m3')
  })
})
