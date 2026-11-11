/**
 * spendSourceScan - a source guard that a SPEND / COST TOTAL is never built by
 * summing tyre_records.cost_per_tyre (Loop 11, findings F-A-03, F-F-01, F-F-02).
 *
 * WHY
 *   About half of tyre_records carry no price, and for UAE and Egypt that column
 *   is empty outright, so a cost_per_tyre total silently reports a fraction of
 *   real tyre spend - and, summed across countries, it blends SAR + AED + EGP
 *   into a meaningless SAR-labelled number. The authoritative spend source is the
 *   classified expense grid (governedCost.js / costSummary.js). cost_per_tyre is
 *   legitimate ONLY for a per-tyre CPK, a per-stint figure, or a priced-records
 *   valuation that is collapsed to one price per physical tyre (withOnePricePerTyre)
 *   and labelled as such on screen.
 *
 * WHAT IT CATCHES
 *   An ACCUMULATION whose added operand is cost_per_tyre (a spend sum):
 *   `+= num(r.cost_per_tyre)`, `acc + (num(r?.cost_per_tyre) ...)`,
 *   `s + (Number(r.cost_per_tyre) ...)`, `si + (r.cost_per_tyre ...)`, etc.
 *   It deliberately does NOT flag a per-tyre helper (`(r.cost_per_tyre||0)*qty`
 *   returned from a function), a counter (`priced += 1 if (cost_per_tyre > 0)`),
 *   a column list, or an SQL/comment mention.
 *
 * THE ALLOWLIST
 *   Every file below keeps a cost_per_tyre accumulation on purpose, for the reason
 *   given. Each one either collapses refits to one price (withOnePricePerTyre) and
 *   is labelled a "priced tyre records" figure on its screen, or is a legitimate
 *   per-tyre CPK engine. The allowlist is kept HONEST: a second test fails if an
 *   allowlisted file no longer contains such an accumulation (remove it then).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const ROOTS = ['lib', 'pages', 'components'].map((d) => join(SRC, d))

/** The two sanctioned homes for cost_per_tyre arithmetic (the rule's own files). */
const SANCTIONED = new Set([
  'lib/tyreLifetime.js',   // withOnePricePerTyre + the lifetime CPK layer live here
  'lib/governedCost.js',   // the definition of what a cost total means
])

/**
 * Files that keep a cost_per_tyre accumulation deliberately. path -> reason.
 * KEEP THIS HONEST: every entry must still be flagged by the scan (see the
 * second test). When a file stops summing cost_per_tyre, delete its entry.
 */
const ALLOWLIST = {
  // Canonical per-tyre KPI engine: computeCostTrend collapses refits with
  // withOnePricePerTyre, and the other cost_per_tyre uses are per-tyre CPK /
  // scrap valuations, never a governed spend total.
  'lib/kpiEngine.js': 'per-tyre CPK engine; computeCostTrend uses one price per physical tyre',
  // Fallback tyre-spend trend/KPI: the page (BoardOverview.jsx) prefers the grid
  // and only drops to this engine when the grid holds nothing for the scope.
  // Refits collapsed; single-currency (called per country scope).
  'lib/boardOverview.js': 'grid-first; this is the labelled priced-records fallback, refits collapsed',
  // TV board / dashboard-builder monthly tyre cost: priced tyre records, refits
  // collapsed, labelled "priced tyres" on the board; country-scoped.
  'lib/displayBoard.js': 'priced tyre records monthly spend (one price per tyre), labelled on the board',
  // Per-asset visit-cost anomaly: priced records over a withOnePricePerTyre set,
  // labelled cost_basis=priced_records; the call is narrowed to one country.
  'lib/anomalyEngine.js': 'per-asset priced-records cost (refits collapsed), single-country, labelled',
  // Per-asset monthly budget-breach flag: priced records, refits collapsed, the
  // flag text says "priced tyre spend"; single asset so single currency.
  'lib/vehicleHistoryAnalytics.js': 'per-asset priced-records budget flag (one price per tyre), labelled',
  // Ops financial card: prefers the GOVERNED grid (opts.gridTyreSpend); this is
  // the priced-records fallback (one price per tyre) used only when the grid is
  // unavailable, and shown N/A on the mixed-currency All scope.
  'lib/opsIntelligence.js': 'grid-first YTD spend; priced-records fallback (one price per tyre), labelled',
  // Continuous-improvement metric: priced records over withOnePricePerTyre, a
  // per-stint improvement figure, not a governed total.
  'lib/continuousImprovementAnalytics.js': 'priced-records improvement metric (one price per tyre)',
  // RAG context sample: priced records over withOnePricePerTyre, explicitly
  // labelled in the prompt "NOT the expense-grid spend total - do not quote".
  'lib/ragService.js': 'priced-records SAMPLE for the model, one price per tyre, disclaimed in the prompt',
  // Tyre Pool stock valuation: the purchase cost of unfitted spares - a per-row
  // inventory figure, not a spend total. The headline totalValue is currency-safe
  // (null when the priced pool spans currencies); the page shows per-country.
  'lib/tyrePool.js': 'stock valuation of unfitted spares (per-row inventory), headline currency-safe',
}

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...listFiles(p))
    else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name) && !p.includes(`${join('src', 'test')}`)) out.push(p)
  }
  return out
}

/** Strip block + line comments so a documented example never trips the scan. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

// cost_per_tyre as the OPERAND being accumulated (a spend sum). Not a counter
// (`+= 1`), not a condition (`if (cost_per_tyre > 0)`), not a returned helper.
const ACCUMULATES_COST_PER_TYRE =
  /(?:\+=|\b(?:acc|s|si|sum|total\w*|spend\w*|value)\b\s*\+)\s*\(?\s*(?:num|Number|n)?\s*\(?\s*[\w.?![\]]*cost_per_tyre/

function relPath(abs) {
  return abs.slice(SRC.length + 1).replace(/\\/g, '/') // path under src/, e.g. "lib/foo.js"
}

function flaggedFiles() {
  const flagged = []
  for (const root of ROOTS) {
    for (const abs of listFiles(root)) {
      const collapsed = stripComments(readFileSync(abs, 'utf8')).replace(/\s+/g, ' ')
      if (ACCUMULATES_COST_PER_TYRE.test(collapsed)) flagged.push(relPath(abs))
    }
  }
  return flagged
}

describe('spendSourceScan', () => {
  it('no spend total is a sum of tyre_records.cost_per_tyre outside the sanctioned + allowlisted files', () => {
    const offenders = flaggedFiles().filter((f) => !SANCTIONED.has(f) && !(f in ALLOWLIST))
    expect(offenders, `A cost total is being summed from cost_per_tyre in: ${offenders.join(', ')}. ` +
      `Read from the governed expense grid (loadGovernedCostSplit / get_cost_cpk_overview.by_site). ` +
      `If it is a legitimate per-tyre CPK or a labelled priced-records figure (collapsed with ` +
      `withOnePricePerTyre), add it to the ALLOWLIST in this file with a reason.`).toEqual([])
  })

  it('every allowlisted file still contains a cost_per_tyre accumulation (no stale entries)', () => {
    const flagged = new Set(flaggedFiles())
    const stale = Object.keys(ALLOWLIST).filter((f) => !flagged.has(f))
    expect(stale, `These files no longer sum cost_per_tyre; remove them from the ALLOWLIST: ${stale.join(', ')}`).toEqual([])
  })
})
