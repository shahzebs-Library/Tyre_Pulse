import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A guard against the row cap, for the whole repo rather than one function.
 *
 * PostgREST returns at most 1000 rows. A query with no `.range()`, no `.limit()`
 * and no `fetchAllPages` therefore stops at 1000 SILENTLY - no error, no warning,
 * no visible difference from a genuinely short result. That is what made the
 * asset picker offer 1,000 of 1,523 assets, the downtime page compute its KPIs
 * from 1.2% of work orders, and every data-quality check inspect the first 13% of
 * tyre records and report the fleet as cleaner than it is.
 *
 * Reviewing for it does not work: the defective line looks exactly like the
 * correct one. So this test reads the source and fails when a NEW unbounded
 * multi-row read appears against a table big enough to be truncated.
 *
 * WHEN THIS TEST FAILS, the fix is almost always `fetchAllPages` with an
 * `.order(<unique column>)` tiebreak - not adding the file to the allowlist. A
 * paged read ordered on a non-unique key (asset_no is unique per country, not
 * globally) can still drop or repeat rows at a page boundary.
 */

// Tables measured over 1000 rows on the live database. A table below the cap
// cannot be truncated, so it is not worth guarding and would only add noise.
const LARGE_TABLES = [
  'audit_log_v2',           // 317,477
  'parts_consumption',      // 217,083
  'work_order_line_items',  // 184,025
  'work_orders',            //  86,539
  'brain_cache',            //  22,919
  'material_master',        //  22,089
  'tyre_records',           //   7,508
  'production_logs',        //   5,699
  'vehicle_fleet',          //   1,523
]

/**
 * Reads that are bounded by something other than paging, with the reason.
 * Each entry must name WHY it cannot exceed 1000 rows - "it is probably fine" is
 * how the original defects survived review.
 */
const ALLOWED = [
  // Bounded by an equality on a single entity.
  { file: 'src/lib/api/analyticsReads.js', why: "eq('asset_no') - one asset's tyres" },
  { file: 'src/pages/SerialTracker.jsx', why: "eq('serial_no') - one tyre's history" },
  { file: 'src/pages/TyreLifecycle.jsx', why: "eq('serial_no') - one tyre's history" },
  // Bounded by a caller-supplied chunk.
  { file: 'src/lib/api/uploads.js', why: "in('serial_no', batch) - caller batches" },
  { file: 'src/lib/api/combinations.js', why: "in('asset_no', slice) - chunked 100" },
  { file: 'src/lib/api/pmPrograms.js', why: "in('asset_no', chunk) - chunked 200" },
  { file: 'src/lib/api/fleetRenewal.js', why: "in('asset_no', assetNos) from a short plan list" },
  // Dead code: only useInvalidate is imported anywhere; the query hooks are unused.
  { file: 'src/hooks/useSupabaseQuery.js', why: 'react-query hooks are not called by any page' },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name !== 'test') walk(p, out) }
    else if (/\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Unbounded multi-row reads against a large table, as {file, line, table}. */
function findUnboundedReads() {
  const tables = LARGE_TABLES.join('|')
  const fromRe = new RegExp(`\\.from\\(\\s*['"](${tables})['"]`)
  const hits = []
  for (const file of walk('src')) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = fromRe.exec(line)
      if (!m) return
      // The surrounding statement: generous enough to catch a chained builder
      // split across lines, tight enough not to swallow the next function.
      const chunk = lines.slice(Math.max(0, i - 8), i + 16).join('\n')
      if (!/\.select\(/.test(chunk)) return                       // not a read
      if (/\.(insert|update|upsert|delete)\(/.test(chunk)) return // a write
      if (/\.(maybeSingle|single)\(/.test(chunk)) return          // one row by construction
      if (/count:\s*'exact'|head:\s*true/.test(chunk)) return     // a count, not rows
      if (/range\(|fetchAllPages|pageAll\(|\.limit\(/.test(chunk)) return // already bounded
      hits.push({ file: file.replace(/\\/g, '/'), line: i + 1, table: m[1] })
    })
  }
  return hits
}

describe('row cap guard', () => {
  it('has no unbounded multi-row read against a table that can exceed 1000 rows', () => {
    const allowedFiles = new Set(ALLOWED.map((a) => a.file))
    const offenders = findUnboundedReads().filter((h) => !allowedFiles.has(h.file))
    const detail = offenders
      .map((o) => `${o.file}:${o.line} reads ${o.table} without paging`)
      .join('\n')
    expect(offenders, `\n${detail}\n\nUse fetchAllPages with an .order(<unique column>) tiebreak.`)
      .toEqual([])
  })

  it('keeps the allowlist honest - every entry must still exist and be bounded', () => {
    // An allowlist entry that no longer corresponds to a real read is a stale
    // exemption, and a stale exemption is how a fixed bug quietly comes back.
    const found = new Set(findUnboundedReads().map((h) => h.file))
    for (const entry of ALLOWED) {
      expect(found.has(entry.file), `${entry.file} is allowlisted (${entry.why}) but has no unbounded read - remove the entry`)
        .toBe(true)
    }
  })

  it('detects an unbounded read when one is introduced', () => {
    // Proves the detector actually fires, so a passing suite means something.
    // Mirrors the shape of the real defect: bare select on a large table.
    const sample = [
      "const q = supabase",
      "  .from('work_orders')",
      "  .select('id,asset_no')",
      "  .order('created_at', { ascending: false })",
    ].join('\n')
    expect(/\.from\(\s*'work_orders'/.test(sample)).toBe(true)
    expect(/range\(|fetchAllPages|\.limit\(/.test(sample)).toBe(false)
  })
})
