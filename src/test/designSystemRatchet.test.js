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

/**
 * Current, measured debt. LOWER these as pages migrate. Never raise them.
 *
 * rawOverlay 130 -> 128 -> 125 -> 121 -> 115 -> 110 -> 103 on 2026-09-21. Wave 1 moved
 * StockManagement and PmPrograms; wave 2 Combinations, HeatIntelligence and
 * SerialTracker; wave 3 FleetRenewal, TechnicianScorecard, FitmentValidation and
 * DtcDiagnostics; wave 4 DriverSafety, EngineHours, HoldingCompany, RfidRegistry,
 * DailyOps and VehicleWashing; wave 5 TyreSpecifications, OrgHierarchy,
 * SpeedLimiter and ColdChain; wave 6 PartsCatalog, BayScheduling, UploadData,
 * Budgets, Certifications, AssetBreakdowns and TyreServiceEvents.
 *
 * A THIRD FILE NOW CONVERTS OVERLAYS AND CORRECTLY STAYS ON THIS LIST.
 * RotationSchedule moved its ScheduleModal but keeps two `tp-drawer-panel`
 * rails, widened by a DIRECT-CHILD selector in index.css that
 * `dialogFit.test.jsx` pins. Modal portals its own centred panel, so the
 * selector would stop matching and a full-height rail would become a box.
 *
 * 103 is the MEASURED count after main (111 -> 110) and wave 6 (111 -> 104)
 * merged. The two waves touched disjoint pages so the removals add up, but
 * the number was COUNTED on the merged tree rather than inferred - a ratchet
 * that guesses its own baseline is not a ratchet.
 *
 * LOWER THIS IN THE SAME COMMIT AS THE MIGRATION, NOT AFTERWARDS. Wave 4 shipped
 * its overlay conversions and left the baseline at 121 against a real 116, which
 * turned this ratchet RED on main. A guard failing for a GOOD reason still reads
 * as a broken build, and the next person's instinct is to raise the number back
 * rather than read why - which would silently re-admit the debt this exists to
 * hold out.
 *
 * THIS NUMBER IS FOR THE COMMITTED TREE, WHICH IS NOT ALWAYS THE WORKING TREE.
 * While parallel migrations are in flight the working tree reads LOWER than what
 * is committed. Taking the working-tree number would make a fresh checkout count
 * MORE overlays than the baseline and fail with "a page started hand-rolling an
 * overlay" - a phantom regression pointing the next person at nothing. Count
 * against what you are actually committing.
 *
 * TWO FILES CONVERTED OVERLAYS AND STILL SIT ON THIS LIST, WHICH IS CORRECT.
 * WorkOrders converted 3 of 4 and RepairRequests 3 of 4; the one each keeps is
 * a right-hand DRAWER on the `tp-drawer-panel` contract that
 * `dialogFit.test.jsx` pins. Modal has no drawer size - its panel is a centred
 * box capped at 92dvh - so converting would turn a full-height rail into a
 * dialog. That is a layout change, not a migration. The count is of FILES, not
 * occurrences, so six converted overlays moved this number by zero.
 *
 * rawTable stays 194: all 19 tables examined across both waves were correctly
 * REFUSED. They carry composite cells, server-driven sorting, or their own
 * usePagedRows + TablePagination + export pipeline, and EnterpriseTable would
 * bring a second search box and a competing export. A refusal is the right
 * outcome here, not an outstanding task - do not read this number as debt.
 *
 * 194 -> 191 (2026-09-26): RecallDetail, SanyDelayPenalty and CostScenarioPlanner
 * moved onto EnterpriseTable when they were deepened.
 */
const BASELINE = {
  rawTable: 191,
  rawOverlay: 103,
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

  it('a Card is never given a style utility that cannot win', () => {
    // THIS TRAP HAS BITTEN THREE TIMES, so it is pinned rather than remembered.
    //
    // A plain Tailwind class is a normal declaration and loses to an inline one,
    // so `<Card className="py-12">` is DEAD - and it fails SILENTLY: the element
    // still renders, it just quietly collapses to --pad-card. The victims are
    // always empty states and alert banners, which is where the roominess or the
    // tint was the whole point. One instance was a fitment PASS/FAIL verdict
    // card whose green-or-red edge would simply have vanished.
    //
    // `!`-prefixed classes are exempt because !important in a stylesheet DOES
    // beat a normal inline declaration - that is why CardHeader's `!mb-0` is
    // correct. CardHeader/CardBody/CardFooter set no inline padding, so their
    // px-*/py-* are fine; the `[\s>]` is what keeps them out of this rule.
    //
    // The fix is never to add `!`: put the spacing on an inner element, or use
    // the `pad`/`tone` props. `!important` on a layout utility is a fight you
    // win once and lose the next time someone nests something.
    //
    // Card sets padding, background, border and box-shadow inline, so a
    // class for ANY of those is dead. The first version of this rule policed
    // only padding and border, and a later migration found live dead `bg-*` on
    // a Card that it had waved through.
    //
    // A VARIANT PREFIX DOES NOT SAVE THE CLASS: `hover:border-blue-600` is just
    // as dead as `border-blue-600`, and that exact form shipped on a clickable
    // tile. Strip the variant chain before testing.
    //
    // `text-` needs care: only the COLOUR utilities are dead. `text-sm` and
    // `text-center` are size and alignment, which Card does not set, so they
    // work and must not be flagged.
    const TEXT_NOT_COLOUR = new Set([
      'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
      'left', 'center', 'right', 'justify', 'start', 'end',
      'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
    ])
    const stripVariants = (t) => t.replace(/^(?:[A-Za-z0-9_-]+:)+/, '')
    const isDead = (raw) => {
      const t = stripVariants(raw)
      if (raw.startsWith('!') || t.startsWith('!')) return false   // !important does win
      if (/^p[xytblrse]?-/.test(t)) return true                     // padding
      if (/^bg-/.test(t)) return true                               // background
      if (/^(?:border|shadow)(?:$|-)/.test(t)) return true          // border, box-shadow
      // NOTE: `text-*` is deliberately NOT here. Card used to set `color`
      // inline, which killed every text colour class an author wrote; the fix
      // was to move the default into .tp-card so those classes work, rather
      // than to police ~20 of them across the app. TEXT_NOT_COLOUR is kept
      // because the distinction is the reason, and it will matter again if
      // colour is ever pulled back inline.
      return false
    }
    const offenders = []
    for (const p of PAGES) {
      if (!/from '[^']*components\/ui\/Card'/.test(p.src)) continue
      // Attributes of one <Card ...> tag: stop at the first '>' that is not
      // inside a brace expression, which is enough for real-world JSX here.
      for (const m of p.src.matchAll(/<Card[\s]([^>]*?)\/?>/g)) {
        // SKIP A MATCH INSIDE A STRING LITERAL. This scans raw source, so it
        // cannot tell a JSX element from a string that looks like one - and the
        // design-system page documents this very anti-pattern in a <code>
        // block, so it tripped its own guard. Exempting that FILE was the wrong
        // fix: it would blind the rule to a real dead utility on the one page
        // whose job is to model the kit correctly. A quote immediately before
        // `<Card` means the text is quoted, not rendered.
        const before = p.src[m.index - 1]
        if (before === "'" || before === '"' || before === '`') continue
        const attrs = m[1]
        const cls = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
        if (!cls) continue
        const tokens = (cls[1] || cls[2] || '')
          .split(/\s+/)
          .filter(Boolean)
          .filter(isDead)
        if (tokens.length) offenders.push(`${p.file}: ${tokens.join(' ')}`)
      }
    }
    expect(
      offenders,
      `These utilities are dead - Card sets padding/border inline and wins.\n` +
        `Move the spacing to an inner element (or use the pad prop):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
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
