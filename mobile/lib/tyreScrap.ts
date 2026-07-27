/**
 * Tyre scrap service - mobile mirror of the web `src/lib/api/tyreExchange.js`.
 * A field user searches a serial and marks the tyre scrapped with a reason.
 *
 * BOTH WRITES GO THROUGH ONE RPC (V382), and they have to. Scrapping touches
 * two tables with different RLS: any approved user may write the mark in
 * `tyre_status_marks`, but stamping `tyre_records.status` needs admin or
 * manager. Doing them as two client calls means a tyre collector writes the
 * mark, is refused the stamp, and leaves a PARTIAL SCRAP - the tyre reads
 * Scrapped in one place and Active in the pool. `scrap_tyre_by_serial` does
 * both or neither, and self-gates on the server so the button and the
 * permission cannot drift apart.
 *
 * Online-only by design (transactional, no offline queue).
 */
import { supabase } from './supabase'

export interface ScrapMark {
  serial: string
  reason: string | null
  created_at: string | null
}

/**
 * Scrap a tyre by serial. Idempotent (re-scrapping is a no-op upsert). Returns
 * how many lifecycle rows were flagged. Byte-mirrors the web logic.
 */
export async function scrapTyreBySerial(
  serial: string,
  reason: string | null = null,
  country: string | null = null,
): Promise<{ updated: number }> {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { data, error } = await supabase.rpc('scrap_tyre_by_serial', {
    p_serial: s,
    p_reason: reason ? String(reason).trim() : null,
    p_country: country || null,
  })
  if (error) throw error
  return { updated: Number((data as { updated?: number } | null)?.updated ?? 0) }
}

/**
 * Undo a scrap: remove the mark and put each row back to the status it held
 * BEFORE the scrap, which the mark recorded (V382b).
 *
 * The old client code set every row to 'Active', which was wrong twice: a tyre
 * that was 'Removed' before scrapping came back Active and rejoined the
 * allocatable pool, and if its position had since been refilled the update was
 * refused outright by guard_tyre_active_fitment, so Undo just errored.
 */
export async function unscrapTyreBySerial(serial: string): Promise<{ ok: boolean }> {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { error } = await supabase.rpc('unscrap_tyre_by_serial', { p_serial: s })
  if (error) throw error
  return { ok: true }
}

/** The 'scrap' mark for a serial ({serial, reason, created_at}) or null. */
export async function getScrapMark(serial: string): Promise<ScrapMark | null> {
  const s = String(serial || '').trim()
  if (!s) return null
  const { data, error } = await supabase
    .from('tyre_status_marks')
    .select('serial,reason,created_at')
    .eq('serial', s)
    .eq('mark_type', 'scrap')
    .maybeSingle()
  if (error && (error as { code?: string }).code !== 'PGRST116') throw error
  return (data as ScrapMark) ?? null
}

/**
 * May THIS user scrap a tyre? Answered by the server, not guessed on the phone.
 *
 * The button used to be gated on `isAdmin(profile.role)`, which is wrong in both
 * directions here. normaliseRole collapses any role it does not know to
 * 'reporter', so a Tyre Data Collector looked like a reporter on the phone while
 * the server saw tyre_data_collector and would have allowed the write; and a
 * per-user capability grant was invisible to the client entirely. Asking the
 * same function the RPC enforces means what the user sees is exactly what they
 * are allowed to do.
 */
export async function canScrapTyre(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('tyre_scrap_allowed')
    if (error) return false
    return data === true
  } catch {
    return false  // never show an action we cannot confirm
  }
}

/**
 * May THIS user UNDO a scrap? A separate and narrower right (V383): marking a
 * scrap is a field observation, reversing one is a correction to the record and
 * belongs to an administrator. Asking separately means a Tyre Data Collector
 * gets the Scrap button without the Undo button, instead of both or neither.
 */
export async function canUnscrapTyre(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('tyre_unscrap_allowed')
    if (error) return false
    return data === true
  } catch {
    return false
  }
}
