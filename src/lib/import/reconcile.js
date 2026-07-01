/**
 * Import Center — post-commit reconciliation.
 *
 * After a batch is committed via the import_commit_batch RPC (V46), an operator
 * must be able to confirm that the import "balanced": that every staged row was
 * accounted for as imported, skipped, or rejected (error/duplicate), and that a
 * committed batch actually produced records.
 *
 * reconcileBatch() is a PURE function over an import_batches row. It performs no
 * I/O and is fully unit-tested. The UI (DataIntakeHistory) renders a green
 * "balanced" / amber "review" indicator from its output.
 *
 * Row accounting model (V45/V46):
 *   total_rows      — rows staged from the source file.
 *   ready_rows      — passed validation (status 'ready').
 *   warning_rows    — committed with warnings.
 *   error_rows      — rejected by validation (never inserted).
 *   duplicate_rows  — flagged as duplicate/conflict against the natural key.
 *   imported_rows   — rows actually inserted into the destination table.
 *   skipped_rows    — rows intentionally skipped at commit (e.g. dedupe choice).
 *
 * Balance identity (committed batches):
 *   imported_rows + skipped_rows + error_rows === total_rows
 *
 * Duplicates are NOT a separate disposition bucket: a duplicate row is still
 * either imported (as a lifecycle event) or skipped, so it is already counted in
 * imported/skipped. They are surfaced for visibility, not added to the identity.
 *
 * @module import/reconcile
 */

/**
 * @typedef {Object} ImportBatchRow
 * @property {number} [total_rows]
 * @property {number} [ready_rows]
 * @property {number} [warning_rows]
 * @property {number} [error_rows]
 * @property {number} [duplicate_rows]
 * @property {number} [imported_rows]
 * @property {number} [skipped_rows]
 * @property {string} [import_status]   staged|validating|ready|committing|committed|reversed|failed
 */

/**
 * @typedef {Object} ReconciliationSummary
 * @property {number} expected      Rows staged from source (total_rows).
 * @property {number} imported      Rows inserted into the destination table.
 * @property {number} skipped       Rows intentionally skipped at commit.
 * @property {number} errors        Rows rejected by validation.
 * @property {number} duplicates    Rows flagged duplicate/conflict (informational).
 * @property {number} accountedFor  imported + skipped + errors.
 * @property {number} variance      expected - accountedFor (0 when balanced).
 * @property {boolean} balanced     True when the batch fully reconciles.
 * @property {'committed'|'reversed'|'pending'|'unknown'} state  Coarse lifecycle state.
 * @property {'balanced'|'review'|'pending'} indicator  UI indicator key.
 * @property {string[]} discrepancies  Human-readable reasons it does not balance.
 */

/** Coerce a possibly-null count to a non-negative finite integer. */
function count(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

/**
 * Reconcile a committed import_batches row into an operator-facing summary.
 *
 * Pure: derives everything from the persisted batch counters; performs no I/O.
 * For non-committed batches it returns a 'pending' indicator without raising
 * spurious discrepancies (counters are only authoritative once committed).
 *
 * @param {ImportBatchRow} batch
 * @returns {ReconciliationSummary}
 */
export function reconcileBatch(batch) {
  const b = batch || {}
  const status = String(b.import_status || '').toLowerCase()

  const expected = count(b.total_rows)
  const imported = count(b.imported_rows)
  const skipped = count(b.skipped_rows)
  const errors = count(b.error_rows)
  const duplicates = count(b.duplicate_rows)

  const accountedFor = imported + skipped + errors
  const variance = expected - accountedFor

  const state =
    status === 'committed' ? 'committed'
      : status === 'reversed' ? 'reversed'
        : status === '' || status === 'failed' ? 'unknown'
          : 'pending'

  /** @type {string[]} */
  const discrepancies = []

  // Only a committed batch is expected to satisfy the balance identity; the
  // counters for in-flight/staged batches are not yet authoritative.
  if (state === 'committed') {
    if (expected === 0) {
      discrepancies.push('Batch is committed but reports zero source rows.')
    }
    if (imported === 0) {
      discrepancies.push('Batch is committed but no rows were imported.')
    }
    if (variance !== 0) {
      const sign = variance > 0 ? 'unaccounted' : 'over-counted'
      discrepancies.push(
        `Row count does not balance: expected ${expected}, accounted for ${accountedFor} ` +
          `(imported ${imported} + skipped ${skipped} + errors ${errors}) — ${Math.abs(variance)} ${sign}.`,
      )
    }
    if (errors > expected) {
      discrepancies.push(`Error rows (${errors}) exceed total source rows (${expected}).`)
    }
    if (duplicates > expected) {
      discrepancies.push(`Duplicate rows (${duplicates}) exceed total source rows (${expected}).`)
    }
  } else if (state === 'reversed') {
    if (imported !== 0) {
      discrepancies.push(`Batch is reversed but still reports ${imported} imported rows.`)
    }
  }

  const balanced = state === 'committed' && discrepancies.length === 0
  const indicator =
    state === 'committed' ? (balanced ? 'balanced' : 'review')
      : state === 'reversed' ? (discrepancies.length === 0 ? 'balanced' : 'review')
        : 'pending'

  return {
    expected,
    imported,
    skipped,
    errors,
    duplicates,
    accountedFor,
    variance,
    balanced,
    state,
    indicator,
    discrepancies,
  }
}

export default reconcileBatch
