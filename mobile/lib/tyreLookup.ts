/**
 * Shared tyre-serial lookup.
 *
 * Used by the scanner and the inspection detail popup so a serial — whether
 * scanned or typed — resolves to the same canonical tyre record. Serials live
 * across several imported columns, hence the multi-column OR match.
 */

import { supabase } from './supabase'

export interface TyreLookupRecord {
  id: string
  brand: string | null
  size: string | null
  position: string | null
  tyre_position: string | null
  asset_no: string | null
  site: string | null
  tread_depth: string | number | null
  pressure_reading: string | number | null
}

/** PostgREST or() filters break on commas/parens — keep only safe serial chars. */
export function sanitizeSerial(code: string): string {
  return code.trim().replace(/[(),]/g, '').slice(0, 64)
}

/** Resolve a tyre by serial across the known serial columns. Returns null if none. */
export async function lookupTyreBySerial(raw: string): Promise<TyreLookupRecord | null> {
  const code = sanitizeSerial(raw)
  if (!code) return null
  const { data, error } = await supabase
    .from('tyre_records')
    .select('id, brand, size, position, tyre_position, asset_no, site, tread_depth, pressure_reading')
    .or(`serial_no.eq.${code},serial_number.eq.${code},tyre_serial.eq.${code}`)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0] as TyreLookupRecord
}
