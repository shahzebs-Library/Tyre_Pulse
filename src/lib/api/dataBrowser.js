/**
 * dataBrowser.js  (service layer)
 *
 * Thin, read-only wrappers over the V260 super-admin database-browser RPCs.
 * These power the console No-code Data Browser (Module 3). Every RPC is
 * SECURITY DEFINER + super-admin gated + read-only on the server; this layer
 * only unwraps the result and degrades to a safe empty value on any error so a
 * transient failure never crashes the console.
 *
 *   admin_db_tables()                     -> [{ table_name, row_count }]
 *   admin_db_columns(p_table)             -> [{ column_name, data_type }]
 *   admin_db_query(p_table, p_column,
 *                  p_op, p_value, p_limit) -> [ row, ... ]  (whitelisted ops)
 *
 * V364 added single-row editing on top of the same safelist:
 *
 *   admin_db_update_row(p_table, p_id, p_patch)  -> {ok, before, after}
 *   admin_db_delete_row(p_table, p_id)           -> {ok, deleted, before}
 *   admin_db_revert_change(p_change_id)          -> {ok, action, tbl}
 *
 * Those three DO throw, deliberately: a write that silently fails is worse than an
 * error message, so unlike the read helpers below they surface the reason instead of
 * degrading to an empty value. Every change records the full before/after row in
 * `admin_row_changes` and can be reverted, and the server refuses to touch identity,
 * tenancy or generated columns.
 */
import { supabase, unwrap } from './_client'
import { toUserMessage } from '../safeError'

/**
 * List the safelisted operational tables with their row counts.
 * @returns {Promise<Array<{table_name:string,row_count:number}>>} [] on error.
 */
export async function listTables() {
  try {
    const data = await unwrap(await supabase.rpc('admin_db_tables'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * List the columns (name + data type) of a safelisted table.
 * @param {string} table
 * @returns {Promise<Array<{column_name:string,data_type:string}>>} [] on error.
 */
export async function listColumns(table) {
  try {
    const data = await unwrap(await supabase.rpc('admin_db_columns', { p_table: table }))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Run a single-predicate read-only query against a safelisted table.
 * The server whitelists table/column/op and binds the value as a parameter,
 * so nothing here is interpolated into SQL. An absent column/op/value returns
 * the first `limit` rows unfiltered.
 *
 * @param {object}  args
 * @param {string}  args.table
 * @param {string}  [args.column]
 * @param {string}  [args.op]      one of eq|neq|gt|gte|lt|lte|ilike
 * @param {*}       [args.value]
 * @param {number}  [args.limit=100]
 * @returns {Promise<Array<object>>} rows, or [] on error.
 */
export async function queryTable({ table, column, op, value, limit = 100 } = {}) {
  try {
    const data = await unwrap(
      await supabase.rpc('admin_db_query', {
        p_table: table,
        p_column: column || null,
        p_op: op || null,
        p_value: value ?? null,
        p_limit: limit,
      }),
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Columns the server will refuse to change. Mirrors _admin_editable_cols. */
export const LOCKED_COLUMNS = Object.freeze(['id', 'organisation_id', 'created_at', 'created_by'])

/**
 * Pure: can this column be hand-edited? Identity and tenancy columns are locked so
 * a row can never be moved to another company or have its key rewritten, and
 * generated columns are computed by the database.
 * @param {string} column
 * @param {Array<{column_name:string,is_generated?:string}>} [columns]
 * @returns {boolean}
 */
export function isEditableColumn(column, columns = []) {
  if (!column || LOCKED_COLUMNS.includes(column)) return false
  const meta = columns.find((c) => c?.column_name === column)
  if (meta && meta.is_generated && meta.is_generated !== 'NEVER') return false
  return true
}

/**
 * Apply a patch to one row. Records before/after for revert.
 * @param {string} table
 * @param {string} id row uuid
 * @param {Record<string, *>} patch only editable columns
 */
export async function updateRow(table, id, patch) {
  const { data, error } = await supabase.rpc('admin_db_update_row', {
    p_table: table,
    p_id: id,
    p_patch: patch,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not save that change.'))
  return data || { ok: false }
}

/** Delete one row. The full row is archived first, so it can be brought back. */
export async function deleteRow(table, id) {
  const { data, error } = await supabase.rpc('admin_db_delete_row', {
    p_table: table,
    p_id: id,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not delete that row.'))
  return data || { ok: false }
}

/** Undo an edit, or bring a deleted row back exactly as it was. */
export async function revertChange(changeId) {
  const { data, error } = await supabase.rpc('admin_db_revert_change', {
    p_change_id: changeId,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not undo that change.'))
  return data || { ok: false }
}

/** Recent edits and deletes, newest first, for the undo list. */
export async function listRowChanges(limit = 50) {
  try {
    const { data, error } = await supabase
      .from('admin_row_changes')
      .select('id, tbl, row_id, action, changed_by, created_at, reverted_at')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 50, 500)))
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
