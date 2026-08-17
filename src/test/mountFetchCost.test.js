import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shortcutRange, DEFAULT_SHORTCUT } from '../pages/Dashboard'

/**
 * What a page costs ON MOUNT, pinned.
 *
 * There is no query cache in this app - 231 pages and exactly two files call
 * `useQuery`, one of which is imported nowhere - so every page refetches
 * everything on every mount, and `refetchOnWindowFocus:false` protects nothing
 * because nothing was cached to begin with. That makes each individual mount read
 * the whole budget, and the instance has 256 MB of shared_buffers, so a needless
 * refetch does not merely slow the user who triggered it: it evicts everyone
 * else's cached pages.
 *
 * Three specific wastes were measured and fixed. Each is invisible once
 * reintroduced - a duplicate fetch looks exactly like a correct one in review and
 * in every existing test - which is why they are pinned here rather than trusted
 * to care.
 *
 * Source is read rather than imported on purpose: "which effect fires on mount"
 * is a fact about the page file, and importing these pages drags in the app.
 */

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8')

/** Source with `//` line comments stripped - the comments discuss these very
 *  patterns by name, so a naive grep matches the explanation, not the code. */
const code = (p) =>
  read(p)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

describe('Dashboard opens on one load, not two', () => {
  /**
   * `dateFrom`/`dateTo` started as '' and a mount effect set them to the year.
   * The loader depends on both, and `listDashboardTyres` applies a bound only
   * `if (from)` - so the first load ran with NO date filter and paged the entire
   * tyre history (KSA 8,147 rows over 9 round trips, All 11,193 over 13), which
   * is exactly what the year default exists to prevent. Then the dates landed,
   * the dependency array changed, and all six reads fired again.
   */
  it('sets the opening window synchronously, not from a mount effect', () => {
    const src = code('src/pages/Dashboard.jsx')
    // No effect with an empty dep array may assign the date window.
    const mountEffects = src.match(/useEffect\([^]*?\}, \[\]\)/g) || []
    const offenders = mountEffects.filter((e) => /setDateFrom|setDateTo|applyShortcut\s*\(/.test(e))
    expect(offenders, `a mount effect sets the date window again: ${offenders.join(' | ')}`).toEqual([])
  })

  it('initialises dateFrom and dateTo from shortcutRange', () => {
    const src = code('src/pages/Dashboard.jsx')
    expect(src).toMatch(/const \[dateFrom, setDateFrom\][^\n]*useState\(\(\) => shortcutRange\(/)
    expect(src).toMatch(/const \[dateTo, setDateTo\][^\n]*useState\(\(\) => shortcutRange\(/)
  })

  it('the default window is a real bounded range, never open-ended', () => {
    // An undefined bound is the whole defect: the service skips the filter and
    // reads all of history. A blank default must never pass as "the year".
    const { from, to } = shortcutRange(DEFAULT_SHORTCUT, new Date('2026-08-17T00:00:00'))
    expect(from).toBe('2026-01-01')
    expect(to).toBe('2026-08-17')
  })

  it('shortcutRange still produces each label byte-identically', () => {
    // Extracted from the old applyShortcut. These are the exact strings it built,
    // so moving the computation cannot have moved any window - and with it, any
    // number on the page.
    const now = new Date('2026-08-17T00:00:00') // a Monday
    expect(shortcutRange('Today', now)).toEqual({ from: '2026-08-17', to: '2026-08-17' })
    expect(shortcutRange('Yesterday', now)).toEqual({ from: '2026-08-16', to: '2026-08-16' })
    expect(shortcutRange('This Week', now)).toEqual({ from: '2026-08-16', to: '2026-08-17' })
    expect(shortcutRange('This Month', now)).toEqual({ from: '2026-08-01', to: '2026-08-17' })
    expect(shortcutRange('Last Month', now)).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(shortcutRange('This Year', now)).toEqual({ from: '2026-01-01', to: '2026-08-17' })
  })

  it('Custom leaves the window alone rather than blanking it', () => {
    // Returning bounds here would overwrite the dates the user just typed.
    expect(shortcutRange('Custom', new Date('2026-08-17T00:00:00')))
      .toEqual({ from: undefined, to: undefined })
  })
})

describe('TyreRecords does not query on every keystroke', () => {
  /**
   * `search` sat directly in the load effect's dependency array, so each
   * character fired a `select('*', {count:'exact'})` carrying a four-column
   * unanchored ILIKE plus an exact count over 11,193 rows - none of which an
   * index can serve. An 8-character serial cost 8 sequential scans.
   */
  it('the load effect depends on the debounced term, not the raw box', () => {
    const src = code('src/pages/TyreRecords.jsx')
    const loadEffect = src.match(/useEffect\(\(\) => \{ loadRecords\(\) \}, \[([^\]]*)\]\)/)
    expect(loadEffect, 'the loadRecords effect moved - re-point this guard').toBeTruthy()
    const deps = loadEffect[1]
    expect(deps).toContain('debouncedSearch')
    // `debouncedSearch` contains the substring `Search`, not a bare `search`.
    expect(deps).not.toMatch(/(^|[^a-zA-Z])search([^a-zA-Z]|$)/)
  })

  it('a debounce timer stands between the box and the term', () => {
    const src = code('src/pages/TyreRecords.jsx')
    expect(src).toMatch(/setTimeout\(\(\) => \{ setDebouncedSearch\(search\); setPage\(0\) \}/)
    expect(src).toMatch(/clearTimeout\(/)
  })

  it('the query and the export both read the debounced term', () => {
    const src = code('src/pages/TyreRecords.jsx')
    // Passing the raw term to either one re-opens the per-keystroke read, and for
    // the export it would also mean exporting a set the grid never showed.
    expect(src).toMatch(/listRecords\(\{\s*\n?\s*page, pageSize: PAGE_SIZE, search: debouncedSearch/)
    expect(src).toMatch(/listAllRecords\(\{\s*\n?\s*search: debouncedSearch/)
  })
})

describe('Accidents does not page the fleet for a picker that is closed', () => {
  /**
   * The register pulled every fleet row on mount - 1,617 records over 5 paged
   * round trips - to fill the asset combobox INSIDE the incident form, which is
   * not rendered until the user opens it. The one thing that genuinely needed the
   * fleet on every visit was the "N / 100 vehicles" denominator, and that needs a
   * number, not rows. Inspections already carries this exact fix for the same
   * picker; this keeps the two from drifting apart again.
   */
  it('the fleet ROWS load is gated on the form being open', () => {
    const src = code('src/pages/Accidents.jsx')
    const effects = src.match(/useEffect\([^]*?\}, \[[^\]]*\]\)/g) || []
    const fleetEffect = effects.find((e) => /listAccidentFleet\s*\(/.test(e))
    expect(fleetEffect, 'the listAccidentFleet effect moved - re-point this guard').toBeTruthy()
    expect(fleetEffect, 'the fleet rows load again on mount, unconditionally')
      .toMatch(/if \(!showForm\) return/)
    expect(fleetEffect).toMatch(/\[showForm, activeCountry\]/)
  })

  it('the per-100-vehicles denominator is an exact server count, not rows', () => {
    const src = code('src/pages/Accidents.jsx')
    expect(src).toMatch(/countAccidentFleet\s*\(/)
    // Taking the length of the paged rows is what made the rows look required.
    expect(src).not.toMatch(/fleetSize\s*=\s*fleetAssets\.length/)
    expect(src).toMatch(/const fleetSize = fleetCount \?\? 0/)
  })

  it('the count read returns no rows and is country-scoped like the paged read', () => {
    const src = code('src/lib/api/accidents.js')
    const fn = src.slice(src.indexOf('export async function countAccidentFleet'))
    expect(fn).toMatch(/count: 'exact', head: true/)
    expect(fn).toMatch(/applyCountry\(/)
    // Null, never 0: an unreadable fleet must not render as a measured empty one.
    expect(fn).toMatch(/return null/)
  })
})

describe('governedCost cache', () => {
  /**
   * `get_cost_cpk_overview('KSA', ...)` was measured live, warm, three
   * consecutive runs: 1,237 / 1,445 / 1,428 ms of server time for a 13.6 kB
   * answer. Ten pages call it on mount, so walking four of them re-computed the
   * identical answer four times.
   *
   * The two properties that make the cache safe rather than merely fast are that
   * the key carries every filter, and that opting in is the caller's choice.
   */
  let governed
  let rpcCalls

  beforeEach(async () => {
    vi.resetModules()
    rpcCalls = []
    vi.doMock('../lib/api/_client', () => ({
      supabase: {
        rpc: (name, args) => {
          rpcCalls.push({ name, args })
          const data = name === 'get_expense_by_country'
            ? [{ country: 'KSA', tyre: 1, spare: 1, oil: 1, total: 3, lines: 1 }]
            : { ok: true, totals: { current: { tyre: 10, spare: 5, oil: 5, total: 20 } }, monthly: [] }
          return Promise.resolve({ data, error: null })
        },
      },
      applyCountry: (q) => q,
    }))
    governed = await import('../lib/api/governedCost')
    governed.clearGovernedCostCache()
  })

  const overviewCalls = () => rpcCalls.filter((c) => c.name === 'get_cost_cpk_overview').length

  it('shares an in-flight request instead of issuing a second identical one', async () => {
    // Always correct: it is the same request, already on the wire.
    const [a, b] = await Promise.all([
      governed.loadGovernedCostSplit({ country: 'KSA' }),
      governed.loadGovernedCostSplit({ country: 'KSA' }),
    ])
    expect(overviewCalls()).toBe(1)
    expect(a).toEqual(b)
  })

  it('re-reads by default, so a Refresh control never serves a remembered answer', async () => {
    await governed.loadGovernedCostSplit({ country: 'KSA' })
    await governed.loadGovernedCostSplit({ country: 'KSA' })
    expect(overviewCalls()).toBe(2)
  })

  it('serves a recent payload only when the caller opts in', async () => {
    await governed.loadGovernedCostSplit({ country: 'KSA', maxAgeMs: 60_000 })
    await governed.loadGovernedCostSplit({ country: 'KSA', maxAgeMs: 60_000 })
    expect(overviewCalls()).toBe(1)
  })

  it('the key carries every filter that changes the answer', async () => {
    // Keyed on country alone, a site-scoped or narrower-window payload would be
    // handed to a caller that asked for the whole scope, and the difference would
    // read as a real change in the money rather than a bug.
    const ttl = { maxAgeMs: 60_000 }
    await governed.loadGovernedCostSplit({ country: 'KSA', ...ttl })
    await governed.loadGovernedCostSplit({ country: 'UAE', ...ttl })
    await governed.loadGovernedCostSplit({ country: 'KSA', site: 'NHC', ...ttl })
    await governed.loadGovernedCostSplit({ country: 'KSA', from: '2026-01-01', to: '2026-06-30', ...ttl })
    expect(overviewCalls()).toBe(4)
  })

  it('a window that has rolled into a new month is not served the old answer', async () => {
    const ttl = { maxAgeMs: 60_000 }
    await governed.loadGovernedCostSplit({ country: 'KSA', now: new Date('2026-08-17'), ...ttl })
    await governed.loadGovernedCostSplit({ country: 'KSA', now: new Date('2026-09-01'), ...ttl })
    expect(overviewCalls()).toBe(2)
  })

  it('does not cache a failure, so "we could not look" cannot become sticky', async () => {
    vi.resetModules()
    let n = 0
    vi.doMock('../lib/api/_client', () => ({
      supabase: {
        rpc: (name) => {
          if (name === 'get_cost_cpk_overview') { n++; return Promise.resolve({ data: null, error: true }) }
          return Promise.resolve({ data: [], error: null })
        },
      },
      applyCountry: (q) => q,
    }))
    const g = await import('../lib/api/governedCost')
    g.clearGovernedCostCache()
    await g.loadGovernedCost({ country: 'KSA', maxAgeMs: 60_000 })
    await g.loadGovernedCost({ country: 'KSA', maxAgeMs: 60_000 })
    expect(n).toBe(2)
  })
})

describe('cost-split TTL is opted into only where a refresh cannot be broken', () => {
  /**
   * A surface with its own Refresh control must re-read when the user presses it,
   * so it deliberately does NOT pass the TTL. PmPrograms loads the split inside a
   * `load()` that its Refresh button calls.
   */
  it('PmPrograms does not opt in', () => {
    const src = code('src/pages/PmPrograms.jsx')
    const call = src.match(/loadGovernedCostSplit\(\{[^}]*\}/)
    expect(call, 'the PmPrograms call moved - re-point this guard').toBeTruthy()
    expect(call[0]).not.toMatch(/maxAgeMs/)
  })

  it('every opt-in uses the shared constant rather than its own number', () => {
    // A second literal would be a second policy, drifting quietly.
    for (const f of [
      'src/pages/Dashboard.jsx', 'src/pages/Analytics.jsx', 'src/pages/CostCenter.jsx',
      'src/pages/BrandPerformance.jsx', 'src/pages/ExecutiveReport.jsx',
      'src/pages/VehicleHistory.jsx', 'src/pages/EngineeringKpi.jsx',
    ]) {
      const src = code(f)
      expect(src, `${f} opts in without the shared TTL`).toMatch(/maxAgeMs: COST_SPLIT_TTL_MS/)
      expect(src, `${f} hardcodes its own TTL`).not.toMatch(/maxAgeMs: \d/)
    }
  })
})
