import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A repo-wide guard against silent scale regressions, so this session's fixes
 * (bounding hot-page reads with { max } and swapping totals to server RPCs)
 * can never quietly come undone.
 *
 * TWO regression classes are policed, both invisible in code review because the
 * defective line looks exactly like the correct one:
 *
 *  1. SILENT 1000-ROW TRUNCATION. PostgREST returns at most 1000 rows. A bare
 *     `.from(<large table>).select(...)` with no `.range()`, `.limit()` or
 *     `fetchAllPages` stops at 1000 with no error and no visible difference from
 *     a genuinely short result. That is what made the asset picker offer 1,000 of
 *     1,523 assets, the downtime page compute KPIs from 1.2% of work orders, and
 *     the data-quality scans inspect the first 13% of tyre records and report the
 *     fleet as cleaner than it is.
 *
 *  2. UNCAPPED FULL-TABLE PULL. `fetchAllPages` reads EVERY page, which is correct
 *     for a small table but pulls hundreds of thousands of rows into the browser
 *     for a genuinely massive one. This session capped the hot ones with
 *     `{ max }`; removing that cap is a silent regression. Policed only for the
 *     truly massive tables (work_orders, work_order_line_items, audit_log_v2,
 *     parts_consumption) - a complete read of a 1.5k-row table is fine, so
 *     flagging it would only add noise.
 *
 * WHEN THIS TEST FAILS, the fix is almost always `fetchAllPages` with an
 * `.order(<unique column>)` tiebreak plus a `{ max }` ceiling on a massive table
 * - NOT adding the file to the allowlist. A paged read ordered on a non-unique
 * key (asset_no is unique per country, not globally) can still drop or repeat
 * rows at a page boundary.
 *
 * This is a heuristic string scan, not a parser: it errs toward flagging.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Only the user-facing read surfaces are scanned - pages and the service layer.
const SCAN_DIRS = ['src/pages', 'src/lib/api']

// Tables measured over 1000 rows on the live database. A table below the cap
// cannot be truncated, so it is not worth guarding for the bare-select rule.
const LARGE_TABLES = [
  'parts_consumption',      // 217,083
  'work_orders',            //  86,539
  'work_order_line_items',  // 184,025
  'tyre_records',           //   7,508
  'audit_log_v2',           // 317,477
  'inspections',
  'accidents',
  'vehicle_fleet',          //   1,523
  'production_logs',        //   5,699
  'fleet_master',
  'engine_hours_logs',
]

// The genuinely massive tables where an uncapped `fetchAllPages` full read is a
// real hazard (hundreds of thousands of rows into the browser). A `fetchAllPages`
// with no `max` against one of these must be justified. The smaller tables above
// (tyre_records, vehicle_fleet, production_logs, ...) are cheap to read whole, so
// their complete reads are deliberately NOT policed here.
const MASSIVE_TABLES = [
  'parts_consumption',
  'work_orders',
  'work_order_line_items',
  'audit_log_v2',
]

/**
 * Reads that a scanner flags but that are bounded by something other than paging,
 * OR deliberate full reads, with the reason. Each entry must name WHY it is
 * tolerated - "it is probably fine" is how the original defects survived review.
 * Keyed by file (a heuristic guard cannot key by line without churning on every
 * edit). Keep this list SMALL: prefer fixing the read over exempting the file.
 */
const ALLOWED = [
  // --- Bounded by an equality on a single entity (one tyre / one asset). ---
  { file: 'src/lib/api/analyticsReads.js', why: "eq('asset_no') - one asset's tyres" },
  { file: 'src/pages/SerialTracker.jsx', why: "eq('serial_no') - one tyre's history" },
  { file: 'src/pages/TyreLifecycle.jsx', why: "eq('serial_no') - one tyre's history" },
  // --- Bounded by a caller-supplied chunk (in(...) over a short slice). ---
  { file: 'src/pages/Accidents.jsx', why: "in('id', ids.slice) - case-track columns fetched in 500s" },
  { file: 'src/lib/api/uploads.js', why: "in('serial_no', serials) - caller batches" },
  { file: 'src/lib/api/combinations.js', why: "in('asset_no', slice) - chunked 100" },
  { file: 'src/lib/api/pmPrograms.js', why: "in('asset_no'/'engine_hours', chunk) - caller-chunked km/hours lookup" },
  { file: 'src/lib/api/fleetRenewal.js', why: "in('asset_no', assetNos) from a short plan list" },
  // --- Deliberate complete work_orders reads in the service layer. Each is
  //     country-scoped and consumed by an aggregator; the hot-page callers were
  //     bounded with { max } this session, these service readers are the raw
  //     path behind them. If any gains a { max } later, drop its entry (test 2
  //     will fail otherwise). ---
  { file: 'src/lib/api/assetManagement.js', why: 'listAssetWorkOrders - full work_orders read feeding asset registry cost/health columns' },
  { file: 'src/lib/api/costSummary.js', why: 'work_orders maintenance-cost read; server RPC get_maint_tyre_split is the primary path, this is the country+site-scoped fallback' },
  { file: 'src/lib/api/opsIntelligence.js', why: 'listWorkOrdersForOps - country-scoped complete work_orders read for ops exceptions' },
  { file: 'src/lib/api/technicianScorecard.js', why: 'listWorkOrdersForScorecard - country-scoped complete work_orders read' },
  // --- KNOWN UNBOUNDED, not yet fixed (a real read, not a bounded one). The
  //     vehicle_fleet enrichment read on this page is a bare .select() with no
  //     paging (~1,523 rows > 1000), so under the "All" country scope ~523 assets
  //     silently lack fleet-master enrichment. The lookup is graceful (missing
  //     rows just skip enrichment, it does not break a KPI total), so it is
  //     tolerated pending a fetchAllPages wrap. Remove this entry when the page
  //     is fixed - test 2 will then require it. ---
]

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

function sourceFiles() {
  return SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'))
}

const FROM_LARGE = new RegExp(`\\.from\\(\\s*['"](${LARGE_TABLES.join('|')})['"]`)
const ANY_FROM = /\.from\(\s*['"]([a-z_0-9]+)['"]/

/**
 * From the index of `fetchAllPages(`, return the full call text by matching
 * parentheses, so the `{ max }` option and the builder's `.from(...)` are read
 * from THIS call and never from the next block. Bounded so an unbalanced paren
 * cannot run away.
 */
function callText(src, openIdx) {
  let depth = 0
  const end = Math.min(src.length, openIdx + 4000)
  for (let k = openIdx; k < end; k++) {
    if (src[k] === '(') depth++
    else if (src[k] === ')') { depth--; if (depth === 0) return src.slice(openIdx, k + 1) }
  }
  return src.slice(openIdx, end)
}

/** Unbounded multi-row reads against a big table, as {file, line, table, kind}. */
function findOffenders() {
  const hits = []
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    const lines = src.split('\n')

    // Rule 1 - bare .from(large).select() with no paging.
    lines.forEach((line, i) => {
      const m = FROM_LARGE.exec(line)
      if (!m) return
      const chunk = lines.slice(Math.max(0, i - 8), i + 16).join('\n')
      if (!/\.select\(/.test(chunk)) return                          // not a read
      if (/\.(insert|update|upsert|delete)\(/.test(chunk)) return    // a write
      if (/\.(maybeSingle|single)\(/.test(chunk)) return             // one row
      if (/count:\s*'exact'|head:\s*true/.test(chunk)) return        // a count
      if (/range\(|fetchAllPages|pageAll\(|\.limit\(/.test(chunk)) return // already bounded
      if (/\.eq\(\s*['"]id['"]/.test(chunk)) return                  // one row by id
      hits.push({ file, line: i + 1, table: m[1], kind: 'bare-select' })
    })

    // Rule 2 - fetchAllPages against a MASSIVE table with no { max } ceiling.
    const re = /fetchAllPages\s*\(/g
    let fm
    while ((fm = re.exec(src))) {
      const call = callText(src, fm.index)
      const table = (ANY_FROM.exec(call) || [])[1]
      if (!table || !MASSIVE_TABLES.includes(table)) continue
      if (/\bmax\b/.test(call)) continue // has a ceiling
      const line = src.slice(0, fm.index).split('\n').length
      hits.push({ file, line, table, kind: 'fetchAllPages-no-max' })
    }
  }
  return hits
}

describe('row cap guard', () => {
  it('has no unbounded read against a table that can exceed 1000 rows', () => {
    const allowedFiles = new Set(ALLOWED.map((a) => a.file))
    const offenders = findOffenders().filter((h) => !allowedFiles.has(h.file))
    const detail = offenders
      .map((o) => `${o.file}:${o.line} reads ${o.table} (${o.kind}) without a bound`)
      .join('\n')
    expect(
      offenders,
      `\n${detail}\n\nUse fetchAllPages with an .order(<unique column>) tiebreak, and a { max } ceiling on a massive table.`,
    ).toEqual([])
  })

  it('keeps the allowlist honest - every entry must still match a real read', () => {
    // An allowlist entry that no longer corresponds to a real flagged read is a
    // stale exemption, and a stale exemption is how a fixed bug quietly comes
    // back. When a page is genuinely fixed, its entry MUST be removed.
    const found = new Set(findOffenders().map((h) => h.file))
    for (const entry of ALLOWED) {
      expect(
        found.has(entry.file),
        `${entry.file} is allowlisted (${entry.why}) but has no flagged read - remove the stale entry`,
      ).toBe(true)
    }
  })

  it('detects an unbounded read when one is introduced', () => {
    // Proves both detectors actually fire, so a passing suite means something.
    const bareSelect = [
      'const q = supabase',
      "  .from('work_orders')",
      "  .select('id,asset_no')",
      "  .order('created_at', { ascending: false })",
    ].join('\n')
    expect(FROM_LARGE.test(bareSelect)).toBe(true)
    expect(/range\(|fetchAllPages|pageAll\(|\.limit\(/.test(bareSelect)).toBe(false)

    const uncappedPage = "fetchAllPages((from, to) => supabase.from('audit_log_v2').select('*').range(from, to))"
    const idx = uncappedPage.indexOf('fetchAllPages(')
    const call = callText(uncappedPage, idx)
    const table = (ANY_FROM.exec(call) || [])[1]
    expect(MASSIVE_TABLES.includes(table)).toBe(true)
    expect(/\bmax\b/.test(call)).toBe(false)

    // ...and does NOT fire once the ceiling is present.
    const capped = "fetchAllPages((from, to) => supabase.from('audit_log_v2').select('*').range(from, to), { max: 50000 })"
    expect(/\bmax\b/.test(callText(capped, capped.indexOf('fetchAllPages(')))).toBe(true)
  })
})
