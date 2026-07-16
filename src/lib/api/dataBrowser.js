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
 * No writes are exposed here by design: this phase is read + export only.
 */
import { supabase, unwrap } from './_client'

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
