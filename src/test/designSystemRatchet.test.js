import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * DESIGN-SYSTEM RATCHET
 *
 * A measured audit of src/pages found the real reason the web app reads as
 * inconsistent: the shared kit exists but is barely adopted.
 *
 *   PageHeader      211 / 255 pages
 *   EnterpriseTable  13 / 255   <- while 194 pages hand-roll a raw <table>
 *   Modal             5 / 255   <- while 130 pages hand-roll a fixed inset-0 panel
 *
 * Migrating 194 pages at once is not safe, and an allowlist of 194 filenames
 * goes stale the moment a file is renamed. So this is a RATCHET instead: it
 * records the counts as they are today and fails only when a NEW page adds to
 * the debt. The numbers may go DOWN freely (a migration is always allowed and
 * the test tells you to lower the baseline); they may never go UP.
 *
 * WHY THIS MATTERS BEYOND LOOKS. Each hand-rolled overlay re-implements focus
 * trapping, escape-to-close, scroll locking and the height cap by hand, and
 * most of them skip at least one. `Modal` + `useDialogBehavior` already solve
 * that once. Each hand-rolled table re-implements sorting, empty state and
 * the header contract that `EnterpriseTable` already owns.
 *
 * CRLF NOTE: core.autocrlf=true gives this repo a CRLF checkout on Windows, so
 * every read is normalised before matching. A `$`-anchored regex silently
 * matches nothing against a trailing \r - this repo has been bitten by that.
 */

const PAGES_DIR = resolve(process.cwd(), 'src/pages')

/** Current, measured debt. LOWER these as pages migrate. Never raise them. */
const BASELINE = {
  rawTable: 194,
  rawOverlay: 130,
}

function readAllPages() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.jsx?$/.test(entry)) continue
      out.push({
        file: full.slice(resolve(process.cwd()).length + 1).replace(/\\/g, '/'),
        src: readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
      })
    }
  }
  walk(PAGES_DIR)
  return out
}

const PAGES = readAllPages()

function filesMatching(re) {
  return PAGES.filter((p) => re.test(p.src)).map((p) => p.file).sort()
}

describe('design-system ratchet', () => {
  it('the scan actually found the pages (guards against a vacuous pass)', () => {
    // If a path change made PAGES empty, every count below would be 0 and the
    // ratchet would "pass" while policing nothing.
    expect(PAGES.length).toBeGreaterThan(200)
  })

  it('no NEW page hand-rolls a raw <table> instead of EnterpriseTable', () => {
    const offenders = filesMatching(/<table[\s>]/)
    expect(
      offenders.length,
      offenders.length > BASELINE.rawTable
        ? `A page started hand-rolling a <table>. Use src/components/ui/EnterpriseTable.jsx.\n` +
          `It already owns sorting, the header contract, empty state and pagination.\n` +
          `Count went ${BASELINE.rawTable} -> ${offenders.length}.`
        : `Debt reduced to ${offenders.length}. Lower BASELINE.rawTable to ${offenders.length} in this file.`,
    ).toBe(BASELINE.rawTable)
  })

  it('no NEW page hand-rolls a fixed inset-0 overlay instead of Modal', () => {
    const offenders = filesMatching(/fixed inset-0/)
    expect(
      offenders.length,
      offenders.length > BASELINE.rawOverlay
        ? `A page started hand-rolling an overlay. Use src/components/ui/Modal.jsx.\n` +
          `It already owns focus return, escape-to-close, the scroll lock, the\n` +
          `viewport height cap and portalling out of .card's overflow:hidden.\n` +
          `Count went ${BASELINE.rawOverlay} -> ${offenders.length}.`
        : `Debt reduced to ${offenders.length}. Lower BASELINE.rawOverlay to ${offenders.length} in this file.`,
    ).toBe(BASELINE.rawOverlay)
  })

  it('the Card primitive is never given the legacy .card class as well', () => {
    // Both together would re-apply overflow:hidden and the backdrop-filter that
    // Card exists to avoid, silently reintroducing the clipping bug.
    //
    // SCOPED TO FILES THAT IMPORT THE KIT CARD ON PURPOSE. A bare `<Card` match
    // is a false positive: WorkshopTv.jsx declares its own local Card component,
    // which this rule has nothing to say about. Checked before trusting it.
    const bad = PAGES
      .filter((p) => /from '[^']*components\/ui\/Card'/.test(p.src))
      .filter((p) => /<Card[\s>][^>]*className="[^"]*\bcard\b/.test(p.src))
      .map((p) => p.file)
    expect(bad, `Card must not also carry the legacy .card class: ${bad.join(', ')}`).toEqual([])
  })
})
