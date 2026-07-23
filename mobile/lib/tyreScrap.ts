/**
 * Tyre scrap service - mobile mirror of the web `src/lib/api/tyreExchange.js`
 * scrap workflow. An Admin / super-admin searches a serial and marks the tyre as
 * scrap with a reason: an authoritative 'scrap' row is upserted into
 * `tyre_status_marks` (mark_type 'scrap', reason, acting user) AND every
 * `tyre_records` row for that serial is flagged status='Scrapped' so pool /
 * analytics logic treats it as out of service. Undo removes the mark and reverts
 * any still-flagged row back to 'Active'.
 *
 * Reads/writes go direct to Supabase; org isolation + approval RLS are enforced
 * server-side. Online-only by design (transactional, no offline queue).
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
  let userId: string | null = null
  try {
    userId = (await supabase.auth.getUser()).data?.user?.id ?? null
  } catch {
    /* best effort - RLS still gates the write */
  }
  const { error: markErr } = await supabase.from('tyre_status_marks').upsert(
    {
      serial: s,
      mark_type: 'scrap',
      reason: reason ? String(reason).trim() : null,
      country: country || null,
      created_by: userId,
    },
    { onConflict: 'serial,mark_type' },
  )
  if (markErr) throw markErr
  const { data, error } = await supabase
    .from('tyre_records')
    .update({ status: 'Scrapped' })
    .eq('serial_no', s)
    .select('id')
  if (error) throw error
  return { updated: (data ?? []).length }
}

/**
 * Undo a scrap: remove the 'scrap' mark and revert any row still flagged
 * 'Scrapped' back to 'Active' (lifecycle removal signals untouched).
 */
export async function unscrapTyreBySerial(serial: string): Promise<{ ok: boolean }> {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { error: delErr } = await supabase
    .from('tyre_status_marks')
    .delete()
    .eq('serial', s)
    .eq('mark_type', 'scrap')
  if (delErr) throw delErr
  const { error } = await supabase
    .from('tyre_records')
    .update({ status: 'Active' })
    .eq('serial_no', s)
    .eq('status', 'Scrapped')
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
