/**
 * Honest write results.
 *
 * Under row level security an UPDATE or DELETE that the caller is not allowed
 * to make does not raise an error: it matches zero rows and PostgREST answers
 * with success. A service that does not ask for the changed rows back therefore
 * reports "saved" for a change that never happened. Every write that must not
 * fail silently goes through `expectRows`: the query asks for the changed ids
 * (`.select('id')`) and an empty answer is turned into a refusal the page shows.
 *
 * The refusal carries NO database code on purpose. `toUserMessage` replaces the
 * text of any coded error with a generic fallback, and this message has to
 * reach the user as written.
 */
import { ServiceError, unwrap } from './_client'

export const WRITE_REFUSED_MESSAGE =
  'This change was not saved. You do not have permission to change this record, or it no longer exists.'

/** Thrown when a write affected no rows. `refused` lets callers tell it apart. */
export class WriteRefusedError extends ServiceError {
  constructor(message = WRITE_REFUSED_MESSAGE) {
    super(message)
    this.name = 'WriteRefusedError'
    this.refused = true
  }
}

export const isWriteRefused = (err) => Boolean(err && err.refused === true)

/**
 * Unwrap a write that selected its changed rows. Throws the sanitised
 * ServiceError on a database error and a WriteRefusedError when nothing
 * changed. Returns the changed rows.
 * @param {{data:any,error:any}} result  result of `.update(...).select('id')`
 * @param {string} [message]
 */
export function expectRows(result, message) {
  const data = unwrap(result)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  if (rows.length === 0) throw new WriteRefusedError(message)
  return rows
}

/**
 * Non-throwing form for services that return `{ data, error }` to their page:
 * a zero-row write comes back as `{ data: [], error: WriteRefusedError }`.
 */
export function refuseEmpty(result, message) {
  if (!result || result.error) return result
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
  if (rows.length === 0) return { ...result, data: [], error: new WriteRefusedError(message) }
  return result
}
