import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A repo-wide guard against silent scale regressions.
 *
 * THE RULE IT ENFORCES: PostgREST returns at most `db-max-rows` (1,000 here) per
 * response, on a table read AND on a set-returning `supabase.rpc(...)` alike. A
 * `.limit(2000)` / `.limit(3000)` / `.limit(5000)` therefore returns 1,000 - the
 * number in the source is a claim the server never honours. Only `.range()`
 * paging gets past the cap.
 *
 * THREE regression classes are policed, all invisible in code review because the
 * defective line looks exactly like the correct one:
 *
 *  1. SILENT 1000-ROW TRUNCATION. A `.from(<large table>).select(...)` with no
 *     paging stops at 1,000 with no error and no visible difference from a
 *     genuinely short result.
 *
 *  2. UNCAPPED FULL-TABLE PULL. `fetchAllPages` reads EVERY page, correct for a
 *     small table but hundreds of thousands of rows into the browser for a
 *     massive one. Policed only for the truly massive tables.
 *
 *  3. AN UNPAGED SET-RETURNING RPC. Same 1,000-row cap, and much easier to miss
 *     because the call carries a `p_limit` argument that reads like a bound.
 *
 * WHY THE PREVIOUS REVISION CAUGHT NONE OF THE ABOVE, and what changed:
 *
 *  a. It exempted any chunk containing `.limit(`. Treating a bare `.limit(` as a
 *     bound is the single reason this whole defect class survived CI - it is
 *     what a truncating read looks like. A `.limit(N)` is a real bound ONLY when
 *     N is provably below the cap; at or above it, it is not a bound at all.
 *  b. It scanned `src/` only, and its file filter was `/\.(js|jsx)$/`, so mobile
 *     `.ts`/`.tsx` was out of reach twice over.
 *  c. It ignored `supabase.rpc(...)` entirely.
 *  d. Its +-8/16-line window bled into the NEIGHBOURING statement, so a
 *     `count:'exact'` or a `.limit(` belonging to a DIFFERENT query exempted an
 *     unbounded read (demonstrated live at dataCleaning.js listUncleanedSites and
 *     vehicleHistory.js getVehicleFleet). The window is now statement-scoped:
 *     forward-only from the `.from(`, stopping at the next `.from(`, at a
 *     column-0 `}`, or after MAX_BODY_LINES.
 *
 * WHEN THIS TEST FAILS, the fix is almost always `fetchAllPages` / `fetchAllRows`
 * (or `fetchAllRpcPages` / `fetchAllRpcRows` for an RPC) with an
 * `.order(<unique column>)` tiebreak plus a `{ max }` ceiling - NOT adding the
 * file to the allowlist. A paged read ordered on a non-unique key (asset_no is
 * unique per COUNTRY, not globally) can still drop or repeat rows at a page
 * boundary.
 *
 * This is a heuristic string scan, not a parser: it errs toward flagging.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The server's per-response row cap (PostgREST db-max-rows on this project). */
const ROW_CAP = 1000

/** How far a statement body may run before the scanner gives up on it. */
const MAX_BODY_LINES = 20

// Read surfaces scanned by this guard. MOBILE IS INCLUDED: it talks to the same
// PostgREST with the same cap, and three of the truncations this revision fixed
// were mobile-only (the admin sites fleet count, the add-stock location picker,
// the tyre-records site chips).
const SCAN_DIRS = [
  'src/pages', 'src/lib/api', 'src/components', 'src/console', 'src/lib',
  'mobile/app', 'mobile/lib', 'mobile/components', 'mobile/contexts', 'mobile/hooks',
]

// Tables measured over 1000 rows on the live database. A table below the cap
// cannot be truncated, so it is not worth guarding for the bare-select rule.
//
// COUNTS ARE FROM 2026-08-18 AND MUST BE REFRESHED, because a stale count here
// is not a documentation nit - it silently decides which reads get policed. An
// earlier revision recorded production_logs at 5,699 and exempted it as "cheap
// to read whole"; it was already ~297k rows, and an unbounded read of it passed
// CI the whole time.
const LARGE_TABLES = [
  'audit_log_v2',           // ~503,000
  'production_logs',        // ~297,000  (was recorded as 5,699 - 52x out of date)
  'parts_consumption',      // ~216,792
  'work_order_line_items',  // ~184,025
  'work_orders',            //  ~89,913
  'brain_cache',            //  ~28,284
  'material_master',        //  ~22,162
  'tyre_records',           //  ~11,132
  'engine_hours_logs',      //   ~4,379
  'vehicle_fleet',          //    1,617  (KSA 1,030 / UAE 452 / Egypt 135; 1,377 distinct asset_no)
  'inspections',            //      241  - kept: grows per inspection
  'accidents',              //       38  - kept: grows per incident
  'fleet_master',
]

// DELIBERATELY ABSENT, recorded so the next person does not have to re-measure
// to find out why: `sites` (~62 rows) and `profiles` (~38 rows). Both sit far
// below the cap, so a bare select of either cannot truncate and policing them
// would only add noise. ADD THEM THE MOMENT EITHER APPROACHES 1,000 - a
// multi-tenant profiles table gets there fast.
const BELOW_CAP_NOT_POLICED = { sites: 62, profiles: 38 }

// The genuinely massive tables where an uncapped `fetchAllPages` full read is a
// real hazard (hundreds of thousands of rows into the browser). A `fetchAllPages`
// with no `max` against one of these must be justified. The smaller tables above
// (tyre_records, vehicle_fleet, ...) are cheap to read whole, so their complete
// reads are deliberately NOT policed here.
const MASSIVE_TABLES = [
  'audit_log_v2',
  'production_logs',
  'parts_consumption',
  'work_order_line_items',
  'work_orders',
]

// SET-RETURNING RPCs that can return more than ROW_CAP rows, so a call to one
// MUST be paged. Derived by intersecting `RETURNS TABLE|SETOF` in the migration
// files with the RPC names called from the client, then keeping the ones whose
// result set is bounded by something bigger than the cap:
//   get_asset_master        one row per distinct asset_no  (~1,377)
//   reference_asset_options one row per asset in scope     (1,033 measured for a KSA-only Manager)
//   import_existing_keys    one row per existing key       (8,432 measured for the tyre module)
//   get_tyre_cost_by_asset  one row per asset with tyre spend (bounded by ~1,377 assets)
// The other 22 client-called set-returning RPCs are bounded well below the cap
// by their own arguments (recon_* and admin_dup_scan take a p_limit under 1,000;
// the match_* vector searches take a match_count; the reference/report ones
// aggregate to tens of rows).
const LARGE_RPCS = [
  'get_asset_master',
  'reference_asset_options',
  'import_existing_keys',
  'get_tyre_cost_by_asset',
]

// An `.eq(` on one of these columns identifies ONE entity, so the row count is
// bounded by that entity's own history (a vehicle's tyres, a user's open jobs) -
// orders of magnitude below the cap. This is a RULE rather than a per-file
// exemption precisely so it cannot rot: it used to be four separate allowlist
// entries each saying "eq('asset_no') - one asset's tyres".
const BOUNDED_EQ_KEYS = [
  'id', 'asset_no', 'asset_code', 'serial_no', 'serial_number', 'work_order_no',
  'assigned_owner_id', 'user_id', 'accident_id', 'inspection_id', 'template_id',
  'job_id', 'submission_id', 'batch_id',
]

/**
 * Reads that a scanner flags but that are bounded by something other than paging,
 * OR deliberate full reads, with the reason. Each entry must name WHY it is
 * tolerated - "it is probably fine" is how the original defects survived review.
 * Keyed by file (a heuristic guard cannot key by line without churning on every
 * edit). Keep this list SMALL: prefer fixing the read over exempting the file.
 */
const ALLOWED = [
  // --- Bounded by a caller-supplied chunk (in(...) over a short slice). ---
  { file: 'src/pages/Accidents.jsx', why: "in('id', ids.slice) - case-track columns fetched in 500s" },
  { file: 'src/lib/api/uploads.js', why: "in('serial_no', serials) - caller batches" },
  { file: 'src/lib/api/combinations.js', why: "in('asset_no', slice) - chunked 100" },
  { file: 'src/lib/api/pmPrograms.js', why: "in('asset_no', chunk) - caller-chunked km/hours lookup" },
  { file: 'src/lib/api/fleetRenewal.js', why: "in('asset_no', assetNos) from a short plan list" },

  // --- Deliberate complete work_orders reads in the service layer. Each is
  //     country-scoped and consumed by an aggregator; the hot-page callers were
  //     bounded with { max }, these service readers are the raw path behind
  //     them. If any gains a { max } later, drop its entry (test 2 will fail
  //     otherwise). ---
  { file: 'src/lib/api/assetManagement.js', why: 'listAssetWorkOrders - full work_orders read feeding asset registry cost/health columns' },
  { file: 'src/lib/api/costSummary.js', why: 'work_orders maintenance-cost read; server RPC get_maint_tyre_split is the primary path, this is the country+site-scoped fallback' },
  { file: 'src/lib/api/technicianScorecard.js', why: 'listWorkOrdersForScorecard - country-scoped complete work_orders read' },

  // --- KNOWN TRUNCATION, MEASURED, NOT FIXED IN THIS PASS. These are real
  //     defects, listed rather than hidden, so the guard can go green while the
  //     debt stays visible and can only shrink (test 2 fails on a stale entry).
  //     Each names the measured impact so nobody has to re-derive it. ---
  { file: 'src/lib/api/materialMaster.js', why: 'KNOWN: listMaterials clamps to Math.min(limit, 2000) over ~22,162 material_master rows - a caller asking for more than 1,000 truncates. Default is 200, so no live surface hits it today' },
  { file: 'mobile/app/(app)/admin/index.tsx', why: 'KNOWN: bare select of accidents (38 rows today) for the admin severity rollup - below the cap now, truncates once the register passes 1,000' },
]

const EXT = /\.(js|jsx|ts|tsx)$/
const IS_TEST = /\.(test|spec)\.(js|jsx|ts|tsx)$/

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name) && !IS_TEST.test(name)) out.push(p)
  }
  return out
}

function sourceFiles() {
  return SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'))
}

const FROM_LARGE = new RegExp(`\\.from\\(\\s*['"](${LARGE_TABLES.join('|')})['"]`)
const ANY_FROM = /\.from\(\s*['"]([a-z_0-9]+)['"]/
const RPC_LARGE = new RegExp(`\\.rpc\\(\\s*['"](${LARGE_RPCS.join('|')})['"]`)
const BOUNDED_EQ = new RegExp(`\\.eq\\(\\s*['"](${BOUNDED_EQ_KEYS.join('|')})['"]`)
const PAGING = /fetchAllPages\s*\(|fetchAllRows\s*\(|fetchAllRpcPages\s*\(|fetchAllRpcRows\s*\(|pageAll\s*\(/

/**
 * The statement that starts at `startLine`, forward-only. Stops at the next
 * `.from(` (a different query), at a column-0 `}` (end of the enclosing
 * function), or after MAX_BODY_LINES. This is what stops a neighbouring
 * statement's `count:'exact'` or `.limit(` from exempting an unbounded read.
 */
function statementBody(lines, startLine) {
  const body = [lines[startLine]]
  for (let k = startLine + 1; k < Math.min(lines.length, startLine + MAX_BODY_LINES); k++) {
    if (/\.from\(\s*['"]/.test(lines[k])) break
    if (/^\}/.test(lines[k])) break
    body.push(lines[k])
  }
  return body.join('\n')
}

/**
 * A SMALL backward window, used ONLY to spot a paging wrapper that opens on an
 * earlier line (`fetchAllPages((from, to) =>\n  supabase.from(...)`). It is
 * deliberately not consulted for `.limit(`, `count:'exact'` or `single()` -
 * those are exactly the markers that used to bleed in from the query above.
 */
function pagingHead(lines, startLine) {
  return lines.slice(Math.max(0, startLine - 6), startLine + 1).join('\n')
}

/** Balanced-paren argument of the first `.limit(...)` in `text`, or null. */
function limitArg(text) {
  const at = text.indexOf('.limit(')
  if (at < 0) return null
  let depth = 0
  for (let k = at + 6; k < text.length; k++) {
    if (text[k] === '(') depth++
    else if (text[k] === ')') {
      depth--
      if (depth === 0) return text.slice(at + 7, k).trim()
    }
  }
  return null
}

/**
 * Resolve a `.limit(...)` argument to a number, or null when it cannot be
 * proved. Follows at most ONE identifier hop backward from the read (the
 * NEAREST preceding assignment, not the file-wide maximum - taking the max read
 * `limit = 500` in one function as `limit = 5000` from another).
 */
function resolveLimit(arg, src, beforeIdx) {
  if (arg == null) return null
  if (/^\d+$/.test(arg)) return Number(arg)
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return null // an expression: cannot prove it
  const head = src.slice(0, beforeIdx)
  const re = new RegExp(`\\b${arg}\\s*=\\s*(\\d+|[A-Za-z_$][\\w$]*)`, 'g')
  let m, last = null
  while ((m = re.exec(head))) last = m[1]
  if (last == null) return null
  if (/^\d+$/.test(last)) return Number(last)
  // one hop through a named constant (limit = LOGIN_HISTORY_LIMIT = 200)
  const hop = new RegExp(`\\b${last}\\s*=\\s*(\\d+)`).exec(src)
  return hop ? Number(hop[1]) : null
}

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
    const lineStart = []
    { let acc = 0; for (const l of lines) { lineStart.push(acc); acc += l.length + 1 } }

    // Rule 1 - .from(large).select() with no bound the server will honour.
    lines.forEach((line, i) => {
      const m = FROM_LARGE.exec(line)
      if (!m) return
      const body = statementBody(lines, i)
      if (!/\.select\(/.test(body)) return                          // not a read
      if (/\.(insert|update|upsert|delete)\(/.test(body)) return    // a write
      if (/\.(maybeSingle|single)\(/.test(body)) return             // one row
      if (/count:\s*'exact'|head:\s*true/.test(body)) return        // a count
      if (/\.range\(/.test(body)) return                            // paged here
      if (PAGING.test(pagingHead(lines, i) + '\n' + body)) return   // paged by a wrapper
      if (BOUNDED_EQ.test(body)) return                             // one entity
      const arg = limitArg(body)
      if (arg != null) {
        const n = resolveLimit(arg, src, lineStart[i])
        if (n != null && n < ROW_CAP) return                        // a real bound
        hits.push({
          file, line: i + 1, table: m[1],
          kind: `limit(${arg})${n == null ? '' : ` = ${n}`} is not a bound - the server caps at ${ROW_CAP}`,
        })
        return
      }
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

    // Rule 3 - a set-returning RPC that can exceed the cap, called unpaged.
    lines.forEach((line, i) => {
      const m = RPC_LARGE.exec(line)
      if (!m) return
      const body = statementBody(lines, i)
      if (/\.range\(/.test(body)) return
      if (PAGING.test(pagingHead(lines, i) + '\n' + body)) return
      hits.push({
        file, line: i + 1, table: `rpc:${m[1]}`,
        kind: `set-returning RPC read unpaged - capped at ${ROW_CAP} rows like any table read`,
      })
    })
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
      `\n${detail}\n\nUse fetchAllPages / fetchAllRows with an .order(<unique column>) tiebreak, and a { max } ceiling on a massive table.`,
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

  it('scans mobile as well as web, and reads .ts/.tsx', () => {
    // The previous revision scanned src/ only and filtered on /\.(js|jsx)$/, so
    // mobile was invisible twice over - and three of the truncations fixed with
    // this revision were mobile-only.
    const files = sourceFiles()
    expect(files.some((f) => f.startsWith('mobile/') && f.endsWith('.tsx'))).toBe(true)
    expect(files.some((f) => f.startsWith('mobile/') && f.endsWith('.ts'))).toBe(true)
    expect(files.some((f) => f.startsWith('src/') && f.endsWith('.jsx'))).toBe(true)
  })

  it('treats a .limit() at or above the server cap as NOT a bound', () => {
    // The exact hole that let this class survive: the old rule exempted any
    // chunk containing `.limit(`.
    expect(resolveLimit('3000', 'x', 0)).toBe(3000)
    expect(resolveLimit('1000', 'x', 0)).toBe(ROW_CAP)
    expect(resolveLimit('200', 'x', 0)).toBe(200)
    expect(3000 < ROW_CAP).toBe(false)
    expect(200 < ROW_CAP).toBe(true)

    // A limit argument that cannot be proved below the cap is treated as no
    // bound at all, rather than being trusted.
    expect(resolveLimit('someExpr(2)', 'x', 0)).toBeNull()
    expect(limitArg(".select('*').limit(Math.min(n, 2000))")).toBe('Math.min(n, 2000)')
  })

  it('resolves a limit identifier from the NEAREST preceding assignment', () => {
    // Taking the file-wide maximum reads `limit = 500` in one function as the
    // `limit = 5000` of another, and silently exempts a truncating read.
    const src = 'function a({ limit = 5000 }) {}\nfunction b({ limit = 500 }) { q.limit(limit) }'
    expect(resolveLimit('limit', src, src.indexOf('q.limit'))).toBe(500)
    // ...and follows exactly one hop through a named constant.
    const hop = 'const CAP = 200\nfunction b({ limit = CAP }) { q.limit(limit) }'
    expect(resolveLimit('limit', hop, hop.indexOf('q.limit'))).toBe(200)
  })

  it('keeps a statement window from bleeding into the neighbouring query', () => {
    // The live shape that hid two unbounded reads: a counting query directly
    // above an unbounded one, whose count:'exact' fell inside the old +-8 line
    // window and exempted it.
    const lines = [
      "export function countRows() {",
      "  return supabase.from('tyre_records').select('id', { count: 'exact', head: true })",
      "}",
      "",
      "export function listSites() {",
      "  return supabase.from('tyre_records').select('site')",
      "}",
    ]
    const body = statementBody(lines, 5)
    expect(/count:\s*'exact'/.test(body)).toBe(false)
    expect(body).toContain(".select('site')")
  })

  it('detects an unbounded read when one is introduced', () => {
    // Proves all three detectors actually fire, so a passing suite means something.
    const bareSelect = [
      'const q = supabase',
      "  .from('work_orders')",
      "  .select('id,asset_no')",
      "  .order('created_at', { ascending: false })",
    ].join('\n')
    expect(FROM_LARGE.test(bareSelect)).toBe(true)
    expect(/\.range\(/.test(bareSelect)).toBe(false)
    expect(limitArg(bareSelect)).toBeNull()

    const uncappedPage = "fetchAllPages((from, to) => supabase.from('audit_log_v2').select('*').range(from, to))"
    const idx = uncappedPage.indexOf('fetchAllPages(')
    const call = callText(uncappedPage, idx)
    const table = (ANY_FROM.exec(call) || [])[1]
    expect(MASSIVE_TABLES.includes(table)).toBe(true)
    expect(/\bmax\b/.test(call)).toBe(false)

    // ...and does NOT fire once the ceiling is present.
    const capped = "fetchAllPages((from, to) => supabase.from('audit_log_v2').select('*').range(from, to), { max: 50000 })"
    expect(/\bmax\b/.test(callText(capped, capped.indexOf('fetchAllPages(')))).toBe(true)

    // Rule 3: a set-returning RPC is capped exactly like a table read.
    expect(RPC_LARGE.test("await supabase.rpc('get_asset_master', { p_limit: 2000 })")).toBe(true)
  })

  it('records the tables deliberately left unpoliced, with their counts', () => {
    // PROJECT_MEMORY: "the counts in that file are not documentation - they
    // decide what gets policed." The same is true of the omissions.
    for (const [table, count] of Object.entries(BELOW_CAP_NOT_POLICED)) {
      expect(count).toBeLessThan(ROW_CAP)
      expect(LARGE_TABLES).not.toContain(table)
    }
  })
})
