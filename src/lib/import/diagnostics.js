/**
 * Import Center - pure diagnostics engine.
 *
 * A dependency-free analysis layer that turns the wizard's annotated rows, the
 * commit RPC result, and a persisted batch row into operator-facing diagnostics:
 * grouped failure reasons, an action plan, health checks, and a downloadable
 * plain-text report. No React, no Supabase, no network - every function is a
 * pure transform of its input and NEVER throws on null/undefined/empty input.
 *
 * Consumed by the Data Intake Center wizard and Intake History to answer the
 * operator's core question: "what is wrong with this batch and how do I fix it?"
 *
 * @module import/diagnostics
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Issue code catalogue
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Map of validation/commit issue codes → { label, hint }.
 *   label - short human title for the reason.
 *   hint  - one actionable sentence describing how to fix it.
 * Covers every code emitted by the validator (validate.js) and the commit path
 * (import_commit_batch RPC), plus duplicate/conflict/country-scope annotations.
 * @type {Record<string, { label: string, hint: string }>}
 */
export const ISSUE_CODE_LABELS = {
  REQUIRED_MISSING: {
    label: 'Required field missing',
    hint: 'Fill in the mandatory field in the source file (e.g. the asset or serial identifier) and re-import.',
  },
  DATE_INVALID: {
    label: 'Unrecognisable date',
    hint: 'Reformat the date to an unambiguous form such as YYYY-MM-DD so it can be parsed.',
  },
  DATE_AMBIGUOUS: {
    label: 'Ambiguous / out-of-range date',
    hint: 'Confirm the day/month order and that the year is realistic, then correct the source value.',
  },
  NEGATIVE_VALUE: {
    label: 'Negative numeric value',
    hint: 'A quantity, cost, distance or pressure is below zero - fix the sign or the reading in the source file.',
  },
  ENUM_INVALID: {
    label: 'Value outside allowed set',
    hint: 'Map the value to one of the accepted options, or leave it - it is preserved in custom data, not the constrained column.',
  },
  REMOVAL_BEFORE_FITMENT: {
    label: 'Removal precedes fitment',
    hint: 'Removal KM/date is earlier than fitment - swap the fitment and removal readings or correct the odometer.',
  },
  CURRENCY_MISSING: {
    label: 'Currency not captured',
    hint: 'Add a currency column or set the import default currency so the cost is stored in a known unit.',
  },
  RECOVERY_GT_CLAIM: {
    label: 'Recovery exceeds claim',
    hint: 'Recovered amount is larger than the claim - verify the insurance figures and correct the source row.',
  },
  TOTAL_LT_COMPONENTS: {
    label: 'Total below its components',
    hint: 'Total cost is less than labour + parts - re-check the cost breakdown or the total in the source file.',
  },
  COUNTRY_MISMATCH: {
    label: 'Country outside import scope',
    hint: 'The row\'s own country differs from the import country - move it to the correct country batch or fix the value.',
  },
  COMMIT_FAILED: {
    label: 'Database rejected the row',
    hint: 'Open the failed row to read the database error, correct the offending value in the source file, then re-import just those rows.',
  },
  DUPLICATE: {
    label: 'Duplicate row',
    hint: 'An identical record already exists in this batch or the live table - it is skipped; remove it from the source if unintended.',
  },
  CONFLICT: {
    label: 'Conflicting record',
    hint: 'A row shares a key with a different record - resolve which values are correct before committing.',
  },
}

/** Fallback descriptor for an unknown/unmapped issue code. */
export function issueCodeLabel(code) {
  if (code && Object.prototype.hasOwnProperty.call(ISSUE_CODE_LABELS, code)) {
    return ISSUE_CODE_LABELS[code]
  }
  const safe = code == null || code === '' ? 'UNKNOWN' : String(code)
  return {
    label: safe.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: 'Review the affected rows and the underlying message to determine the corrective action.',
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Small pure helpers
 * ────────────────────────────────────────────────────────────────────────── */

const toArray = (v) => (Array.isArray(v) ? v : [])
const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const nonEmpty = (v) => v != null && String(v).trim() !== ''

/** Locale-grouped integer, e.g. 1240 → "1,240". Never throws. */
function fmtInt(n) {
  const v = Math.round(toNum(n))
  try {
    return v.toLocaleString('en-US')
  } catch {
    return String(v)
  }
}

/**
 * Collapse a raw error/issue message into a stable grouping key: strip row-
 * specific numbers, quoted values and ids so "row 12: value 'X'" and
 * "row 99: value 'Y'" group together by their shared shape.
 */
function normalizeMessage(msg) {
  if (msg == null) return 'Unspecified error'
  let s = String(msg).trim()
  if (s === '') return 'Unspecified error'
  s = s
    .replace(/["'`].*?["'`]/g, '"…"') // quoted literals
    .replace(/\(\s*-?\d[\d,.]*\s*\)/g, '(…)') // parenthesised numbers
    .replace(/\b-?\d[\d,.]*\b/g, '#') // bare numbers
    .replace(/\s+/g, ' ')
    .trim()
  return s || 'Unspecified error'
}

/**
 * Group a list of issue objects by code into ranked buckets.
 * @param {Array<{field?:string, code?:string, severity?:string}>} issues
 * @param {number[]} rowNos   Parallel array of the source row number per issue.
 * @returns {Array<{code,label,hint,field,count,sampleRows:number[]}>}
 */
function groupIssues(pairs) {
  const map = new Map()
  for (const { issue, rowNo } of pairs) {
    const code = issue && issue.code ? String(issue.code) : 'UNKNOWN'
    if (!map.has(code)) {
      const meta = issueCodeLabel(code)
      map.set(code, {
        code,
        label: meta.label,
        hint: meta.hint,
        field: issue && issue.field ? String(issue.field) : '',
        fields: new Set(),
        count: 0,
        sampleRows: [],
      })
    }
    const b = map.get(code)
    b.count += 1
    if (issue && nonEmpty(issue.field)) b.fields.add(String(issue.field))
    if (typeof rowNo === 'number' && Number.isFinite(rowNo) && b.sampleRows.length < 5 && !b.sampleRows.includes(rowNo)) {
      b.sampleRows.push(rowNo)
    }
  }
  return Array.from(map.values())
    .map((b) => ({
      code: b.code,
      label: b.label,
      hint: b.hint,
      // Prefer a single field name; if the code spans multiple fields, show that.
      field: b.fields.size === 1 ? Array.from(b.fields)[0] : b.fields.size > 1 ? 'multiple' : b.field,
      count: b.count,
      sampleRows: b.sampleRows,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

/** Default row action when the caller supplies no actionOf resolver. */
function defaultAction(row) {
  if (!row || typeof row !== 'object') return 'insert'
  if (row.validationStatus === 'error') return 'reject'
  if (row.liveDuplicate) return 'skip'
  if (row.dupStatus === 'duplicate') return 'skip'
  if (row.dupStatus === 'conflict') return 'review'
  if (row.countryConflict) return 'review'
  return 'insert'
}

/* ────────────────────────────────────────────────────────────────────────────
 * Validation summary
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Summarise the wizard's annotated rows into counts, an action plan, grouped
 * blocking errors + warnings, per-field rollups and health checks.
 *
 * @param {Array<Object>} rows  Annotated rows: { sourceRowNo, validationStatus,
 *   issues:[{field,severity,code,message}], dupStatus, liveDuplicate, countryConflict }
 * @param {{ module?:string, actionOf?:(row)=>string, overriddenCount?:number }} [opts]
 */
export function summarizeValidation(rows, opts = {}) {
  const list = toArray(rows)
  const options = opts && typeof opts === 'object' ? opts : {}
  const actionOf = typeof options.actionOf === 'function' ? options.actionOf : defaultAction

  const counts = {
    ready: 0,
    warning: 0,
    error: 0,
    duplicate: 0,
    conflict: 0,
    liveDuplicate: 0,
    countryConflict: 0,
  }
  const plan = { insert: 0, update: 0, skip: 0, reject: 0, review: 0, overridden: toNum(options.overriddenCount), total: 0 }
  const errorPairs = []
  const warnPairs = []
  const fieldStats = new Map()
  let forcedThrough = 0

  for (const row of list) {
    const r = row && typeof row === 'object' ? row : {}
    const status = r.validationStatus
    if (status === 'ready') counts.ready += 1
    else if (status === 'warning') counts.warning += 1
    else if (status === 'error') counts.error += 1

    if (r.dupStatus === 'duplicate') counts.duplicate += 1
    else if (r.dupStatus === 'conflict') counts.conflict += 1
    if (r.liveDuplicate) counts.liveDuplicate += 1
    if (r.countryConflict) counts.countryConflict += 1

    // Action plan.
    let action = 'insert'
    try {
      action = actionOf(r) || 'insert'
    } catch {
      action = defaultAction(r)
    }
    if (Object.prototype.hasOwnProperty.call(plan, action)) plan[action] += 1
    else plan.insert += 1
    plan.total += 1

    if (status === 'error' && (action === 'insert' || action === 'update')) forcedThrough += 1

    // Issue grouping + per-field rollup.
    const rowNo = typeof r.sourceRowNo === 'number' ? r.sourceRowNo : undefined
    for (const issue of toArray(r.issues)) {
      if (!issue || typeof issue !== 'object') continue
      const field = nonEmpty(issue.field) ? String(issue.field) : '(row)'
      if (!fieldStats.has(field)) fieldStats.set(field, { field, errors: 0, warnings: 0 })
      const fs = fieldStats.get(field)
      if (issue.severity === 'error') {
        fs.errors += 1
        errorPairs.push({ issue, rowNo })
      } else if (issue.severity === 'warning') {
        fs.warnings += 1
        warnPairs.push({ issue, rowNo })
      }
    }
  }

  const blocking = groupIssues(errorPairs)
  const warnings = groupIssues(warnPairs)
  const byField = Array.from(fieldStats.values()).sort(
    (a, b) => b.errors + b.warnings - (a.errors + a.warnings) || a.field.localeCompare(b.field)
  )

  const health = buildValidationHealth({ total: list.length, counts, plan, forcedThrough, blocking, module: options.module })

  return { total: list.length, counts, plan, forcedThrough, blocking, warnings, byField, health }
}

/** Health checks derived from a validation summary. */
function buildValidationHealth({ total, counts, plan, forcedThrough, blocking, module }) {
  const checks = []
  const mod = module ? `${module} ` : ''
  if (total === 0) {
    checks.push({
      id: 'no-rows',
      level: 'error',
      title: 'No rows to validate',
      detail: `The ${mod}batch has no parsed rows.`,
      hint: 'Re-upload the source file - it may have failed to parse or was empty.',
    })
    return checks
  }
  if (counts.error > 0) {
    const top = blocking[0]
    checks.push({
      id: 'blocking-errors',
      level: 'error',
      title: `${fmtInt(counts.error)} row(s) blocked by errors`,
      detail: top
        ? `Leading cause: ${top.label} (${fmtInt(top.count)} occurrence(s) on ${top.field}).`
        : 'These rows cannot be committed until their errors are resolved.',
      hint: top ? top.hint : 'Open the error rows to see and fix each issue.',
    })
  }
  if (forcedThrough > 0) {
    checks.push({
      id: 'forced-through',
      level: 'warn',
      title: `${fmtInt(forcedThrough)} error row(s) forced into the commit`,
      detail: 'Rows that failed validation are set to insert/update and may be rejected by the database.',
      hint: 'Review the overrides - forcing invalid rows through risks partial commits and dirty data.',
    })
  }
  if (counts.conflict > 0) {
    checks.push({
      id: 'conflicts',
      level: 'warn',
      title: `${fmtInt(counts.conflict)} conflicting row(s)`,
      detail: 'Rows share a natural key with a different record in this batch.',
      hint: 'Resolve which values are correct before committing to avoid overwriting good data.',
    })
  }
  if (counts.liveDuplicate > 0) {
    checks.push({
      id: 'live-duplicates',
      level: 'warn',
      title: `${fmtInt(counts.liveDuplicate)} row(s) already in the live table`,
      detail: 'These match existing records and will be skipped by default.',
      hint: 'Switch matching rows to update if you intend to refresh existing records.',
    })
  }
  if (counts.countryConflict > 0) {
    checks.push({
      id: 'country-scope',
      level: 'warn',
      title: `${fmtInt(counts.countryConflict)} row(s) outside the import country`,
      detail: 'The row\'s own country value disagrees with the import scope.',
      hint: 'Move these rows to the correct country batch or correct the country value.',
    })
  }
  if (checks.length === 0) {
    checks.push({
      id: 'ready',
      level: 'ok',
      title: 'All rows ready',
      detail: `${fmtInt(plan.insert + plan.update)} row(s) will be written with no blocking issues.`,
    })
  }
  return checks
}

/* ────────────────────────────────────────────────────────────────────────────
 * Commit result summary
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Summarise a commitBatch() result into a graded, operator-facing outcome with a
 * headline, grouped errors and actionable hints.
 *
 * @param {Object} result  { status, inserted, skipped, failed, merged, remaining,
 *   errors:[{row,message}], target, enriched?, enrichError? }
 */
export function summarizeCommitResult(result) {
  const r = result && typeof result === 'object' ? result : {}
  const status = r.status || 'failed'
  const inserted = toNum(r.inserted)
  const skipped = toNum(r.skipped)
  const failed = toNum(r.failed)
  const merged = toNum(r.merged)
  const enriched = toNum(r.enriched)
  const remaining = toNum(r.remaining)
  const errors = toArray(r.errors).filter((e) => e && typeof e === 'object')

  const totalProcessed = inserted + skipped + failed + merged
  const successBase = inserted + failed
  const successRate = successBase > 0 ? Math.round((inserted / successBase) * 100) : inserted > 0 ? 100 : 0

  const partial = status === 'partial'
  const stalled = status !== 'committed' && remaining > 0

  let level = 'ok'
  if (status === 'failed' || failed > 0) level = 'error'
  else if (partial || stalled || status === 'already_committed') level = 'warn'
  if (status === 'committed' && failed === 0) level = 'ok'

  // Headline: the numbers that matter, in priority order.
  const parts = []
  if (inserted > 0 || (failed === 0 && merged === 0 && skipped === 0)) parts.push(`${fmtInt(inserted)} inserted`)
  if (merged > 0) parts.push(`${fmtInt(merged)} merged`)
  if (skipped > 0) parts.push(`${fmtInt(skipped)} skipped`)
  if (failed > 0) parts.push(`${fmtInt(failed)} failed`)
  if (enriched > 0) parts.push(`${fmtInt(enriched)} enriched`)
  let headline = parts.join(', ')
  if (status === 'already_committed') headline = headline ? `Already committed (${headline})` : 'Already committed'

  // Group errors by normalised message.
  const groupMap = new Map()
  for (const e of errors) {
    const key = normalizeMessage(e.message)
    if (!groupMap.has(key)) groupMap.set(key, { message: key, count: 0, rows: [] })
    const g = groupMap.get(key)
    g.count += 1
    const rowNo = typeof e.row === 'number' ? e.row : Number(e.row)
    if (Number.isFinite(rowNo) && g.rows.length < 10 && !g.rows.includes(rowNo)) g.rows.push(rowNo)
  }
  const errorGroups = Array.from(groupMap.values()).sort(
    (a, b) => b.count - a.count || a.message.localeCompare(b.message)
  )

  const hints = []
  if (failed > 0) {
    hints.push(
      `${fmtInt(failed)} row(s) failed to commit - open the failed rows to see the database error and fix the source data, then re-import just those.`
    )
  }
  if (stalled) {
    hints.push(
      `Commit did not finish - ${fmtInt(remaining)} row(s) still pending. Re-open the batch from Intake History and retry the commit.`
    )
  }
  if (partial && !stalled) {
    hints.push('The commit completed only partially - re-run it to process the remaining rows.')
  }
  if (status === 'already_committed') {
    hints.push('This batch was already committed - no rows were written again. Reverse it first if you need to re-import.')
  }
  if (r.enrichError) {
    hints.push(`Cross-file enrichment reported an error: ${String(r.enrichError)}. The core commit is unaffected; re-run enrichment.`)
  }
  if (level === 'ok' && hints.length === 0) {
    hints.push('Commit completed cleanly - no action required.')
  }

  return {
    status,
    level,
    headline,
    inserted,
    skipped,
    failed,
    merged,
    enriched,
    totalProcessed,
    successRate,
    errors,
    errorGroups,
    stalled,
    partial,
    hints,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Batch health (persisted batch row + optional issues)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Diagnose a persisted import batch row (import_batches) plus optional issue
 * rows into a list of health checks.
 *
 * @param {{ batch?:Object, rows?:Array, issues?:Array }} input
 * @returns {Array<{id,level,title,detail,hint?}>}
 */
export function diagnoseBatchHealth(input) {
  const src = input && typeof input === 'object' ? input : {}
  const batch = src.batch && typeof src.batch === 'object' ? src.batch : {}
  const issues = toArray(src.issues)

  const total = toNum(batch.total_rows)
  const ready = toNum(batch.ready_rows)
  const warning = toNum(batch.warning_rows)
  const error = toNum(batch.error_rows)
  const conflict = toNum(batch.conflict_rows)
  const imported = toNum(batch.imported_rows)
  const status = batch.import_status || ''

  const checks = []

  // Staging stall - nothing landed in staging.
  if (total === 0) {
    checks.push({
      id: 'staging-stall',
      level: 'error',
      title: 'No rows were staged',
      detail: 'The batch has zero staged rows, so there is nothing to validate or commit.',
      hint: 'The file may have failed to upload in chunks - delete this batch and re-stage the source file.',
    })
  }

  // Import marked failed.
  if (status === 'failed') {
    checks.push({
      id: 'import-failed',
      level: 'error',
      title: 'Import failed',
      detail: 'The batch is in a failed state and did not complete.',
      hint: 'Open the batch to review the failure, correct the source data, and re-run the import.',
    })
  }

  // Commit failures recorded as issues.
  const commitFailures = issues.filter((i) => i && i.issue_code === 'COMMIT_FAILED')
  if (commitFailures.length > 0) {
    checks.push({
      id: 'commit-failures',
      level: 'error',
      title: `${fmtInt(commitFailures.length)} row(s) rejected by the database`,
      detail: 'The database refused these rows during commit (constraint, type or check violation).',
      hint: issueCodeLabel('COMMIT_FAILED').hint,
    })
  }

  // Dropped rows - committed but fewer imported than were valid.
  const committable = ready + warning
  if (status === 'committed' && total > 0 && imported < committable) {
    checks.push({
      id: 'dropped-rows',
      level: 'warn',
      title: `${fmtInt(committable - imported)} valid row(s) did not import`,
      detail: `${fmtInt(imported)} of ${fmtInt(committable)} ready/warning row(s) reached the live table.`,
      hint: 'Some rows were skipped or rejected during commit - open the batch to see which and why.',
    })
  }

  // Error rows present.
  if (error > 0) {
    checks.push({
      id: 'error-rows',
      level: 'warn',
      title: `${fmtInt(error)} row(s) have blocking errors`,
      detail: 'These rows failed validation and will not import until fixed.',
      hint: 'Correct the flagged fields in the source file and re-stage, or exclude these rows.',
    })
  }

  // Unresolved conflicts.
  if (conflict > 0) {
    checks.push({
      id: 'conflicts',
      level: 'warn',
      title: `${fmtInt(conflict)} unresolved conflict(s)`,
      detail: 'Rows share a key with a different record and need a resolution decision.',
      hint: 'Resolve each conflict (keep, overwrite or merge) before committing.',
    })
  }

  // Clean import - only when nothing above fired.
  if (checks.length === 0 && status === 'committed') {
    checks.push({
      id: 'clean',
      level: 'ok',
      title: 'Clean import',
      detail: `${fmtInt(imported)} row(s) imported with no errors, conflicts or dropped rows.`,
    })
  }

  return checks
}

/* ────────────────────────────────────────────────────────────────────────────
 * Human-readable report (downloadable .txt)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Render a full diagnostics report as a single multi-line string, suitable for
 * download as a .txt file. Accepts any subset of { meta, validation, commit,
 * batchHealth } and NEVER throws on partial or empty input.
 *
 * @param {{ meta?:Object, validation?:Object, commit?:Object, batchHealth?:Array }} report
 * @returns {string}
 */
export function formatDiagnosticsReport(report) {
  const r = report && typeof report === 'object' ? report : {}
  const meta = r.meta && typeof r.meta === 'object' ? r.meta : {}
  const L = []
  const rule = '='.repeat(64)
  const thin = '-'.repeat(64)

  L.push(rule)
  L.push('TYRE PULSE - DATA INTAKE DIAGNOSTICS REPORT')
  L.push(rule)
  if (nonEmpty(meta.module)) L.push(`Module    : ${meta.module}`)
  if (nonEmpty(meta.country)) L.push(`Country   : ${meta.country}`)
  if (nonEmpty(meta.batchId)) L.push(`Batch ID  : ${meta.batchId}`)
  if (nonEmpty(meta.createdAt)) L.push(`Created   : ${meta.createdAt}`)
  L.push(`Generated : ${new Date().toISOString()}`)
  L.push('')

  const renderChecks = (title, checks) => {
    L.push(thin)
    L.push(title)
    L.push(thin)
    const arr = toArray(checks)
    if (arr.length === 0) {
      L.push('  (no checks)')
    } else {
      for (const c of arr) {
        const level = (c && c.level ? String(c.level) : 'ok').toUpperCase()
        L.push(`  [${level}] ${c && c.title ? c.title : ''}`)
        if (c && nonEmpty(c.detail)) L.push(`         ${c.detail}`)
        if (c && nonEmpty(c.hint)) L.push(`         Fix: ${c.hint}`)
      }
    }
    L.push('')
  }

  const v = r.validation && typeof r.validation === 'object' ? r.validation : null
  if (v) {
    renderChecks('HEALTH CHECKS (VALIDATION)', v.health)

    L.push(thin)
    L.push('ROW SUMMARY')
    L.push(thin)
    const c = v.counts || {}
    L.push(`  Total rows      : ${fmtInt(v.total)}`)
    L.push(`  Ready           : ${fmtInt(c.ready)}`)
    L.push(`  Warning         : ${fmtInt(c.warning)}`)
    L.push(`  Error           : ${fmtInt(c.error)}`)
    L.push(`  Duplicate       : ${fmtInt(c.duplicate)}`)
    L.push(`  Conflict        : ${fmtInt(c.conflict)}`)
    L.push(`  Live duplicate  : ${fmtInt(c.liveDuplicate)}`)
    L.push(`  Country mismatch: ${fmtInt(c.countryConflict)}`)
    L.push('')

    const p = v.plan || {}
    L.push(thin)
    L.push('ACTION PLAN')
    L.push(thin)
    L.push(`  Insert   : ${fmtInt(p.insert)}`)
    L.push(`  Update   : ${fmtInt(p.update)}`)
    L.push(`  Skip     : ${fmtInt(p.skip)}`)
    L.push(`  Reject   : ${fmtInt(p.reject)}`)
    L.push(`  Review   : ${fmtInt(p.review)}`)
    L.push(`  Overridden: ${fmtInt(p.overridden)}`)
    if (toNum(v.forcedThrough) > 0) L.push(`  ! ${fmtInt(v.forcedThrough)} error row(s) forced into the commit`)
    L.push('')

    const renderBreakdown = (title, groups) => {
      const arr = toArray(groups)
      if (arr.length === 0) return
      L.push(thin)
      L.push(title)
      L.push(thin)
      for (const g of arr) {
        L.push(`  ${g.code} - ${g.label} · ${g.field || '-'} · ${fmtInt(g.count)}`)
        if (nonEmpty(g.hint)) L.push(`      Fix: ${g.hint}`)
        if (toArray(g.sampleRows).length) L.push(`      Rows: ${g.sampleRows.join(', ')}`)
      }
      L.push('')
    }
    renderBreakdown('BLOCKING ERROR REASONS', v.blocking)
    renderBreakdown('WARNING REASONS', v.warnings)
  }

  const commit = r.commit && typeof r.commit === 'object' ? r.commit : null
  if (commit) {
    L.push(thin)
    L.push('COMMIT OUTCOME')
    L.push(thin)
    L.push(`  Status      : ${commit.status || 'unknown'} (${(commit.level || 'ok').toUpperCase()})`)
    if (nonEmpty(commit.headline)) L.push(`  Result      : ${commit.headline}`)
    L.push(`  Inserted    : ${fmtInt(commit.inserted)}`)
    L.push(`  Merged      : ${fmtInt(commit.merged)}`)
    L.push(`  Skipped     : ${fmtInt(commit.skipped)}`)
    L.push(`  Failed      : ${fmtInt(commit.failed)}`)
    L.push(`  Enriched    : ${fmtInt(commit.enriched)}`)
    L.push(`  Success rate: ${fmtInt(commit.successRate)}%`)
    L.push('')
    const eg = toArray(commit.errorGroups)
    if (eg.length) {
      L.push('  Failure reasons:')
      for (const g of eg) {
        L.push(`    - ${g.message} (${fmtInt(g.count)})`)
        if (toArray(g.rows).length) L.push(`      Rows: ${g.rows.join(', ')}`)
      }
      L.push('')
    }
    const hints = toArray(commit.hints)
    if (hints.length) {
      L.push('  Recommended actions:')
      for (const h of hints) L.push(`    - ${h}`)
      L.push('')
    }
  }

  if (Array.isArray(r.batchHealth)) {
    renderChecks('BATCH HEALTH', r.batchHealth)
  }

  L.push(rule)
  L.push('End of report')
  L.push(rule)

  return L.join('\n')
}

export default {
  ISSUE_CODE_LABELS,
  issueCodeLabel,
  summarizeValidation,
  summarizeCommitResult,
  diagnoseBatchHealth,
  formatDiagnosticsReport,
}
