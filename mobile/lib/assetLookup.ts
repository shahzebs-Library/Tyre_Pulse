/**
 * Shared asset / vehicle lookup for scanned or typed codes.
 *
 * Used by the QR scanner and the inspection header so an asset code resolves to
 * the same canonical vehicle_fleet row no matter how it was captured. Resolution
 * is deliberately forgiving because printed QR/barcode labels vary in the wild:
 *   • a bare code           → "TRK-001"
 *   • a URL wrapper         → "https://app/asset/TRK-001" or "…?asset=TRK-001"
 *   • a JSON payload        → '{"asset_no":"TRK-001"}'
 *   • casing / whitespace   → " trk-001 "  vs stored "TRK-001"
 * and a mistyped exact match should still fall back to fleet_number.
 *
 * Org + country isolation is enforced server-side (RLS, V114) — these queries
 * never widen what the user is allowed to see; they only make matching robust.
 */
import { supabase } from './supabase'

export interface AssetLookupRecord {
  id: string
  asset_no: string
  site: string
  vehicle_type: string
  make?: string | null
  model?: string | null
  fleet_number?: string | null
}

const ASSET_COLS = 'id, site, asset_no, vehicle_type, make, model, fleet_number'

/** PostgREST filters break on commas/parens — strip them and cap length. */
function sanitize(code: string): string {
  return code.trim().replace(/[(),]/g, '').slice(0, 64)
}

/**
 * Pull the most likely asset code out of a raw scan payload. Handles URL and
 * JSON wrappers, falling back to the trimmed raw string. Never throws.
 */
export function extractScanCode(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''

  // JSON payload: prefer common code keys.
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const obj = JSON.parse(s)
      const v =
        obj.asset_no ?? obj.assetNo ?? obj.asset ??
        obj.fleet_number ?? obj.fleetNumber ??
        obj.serial_number ?? obj.serial ?? obj.code ?? obj.id
      if (v != null && String(v).trim()) return sanitize(String(v))
    } catch { /* fall through to raw */ }
  }

  // URL payload: last non-empty path segment, or a known query param.
  if (/^https?:\/\//i.test(s) || s.includes('?')) {
    try {
      const url = new URL(s.includes('://') ? s : `https://x/${s}`)
      const qp =
        url.searchParams.get('asset') ?? url.searchParams.get('asset_no') ??
        url.searchParams.get('code') ?? url.searchParams.get('serial')
      if (qp && qp.trim()) return sanitize(qp)
      const segs = url.pathname.split('/').filter(Boolean)
      if (segs.length) return sanitize(decodeURIComponent(segs[segs.length - 1]))
    } catch { /* fall through to raw */ }
  }

  return sanitize(s)
}

/**
 * Resolve an asset code to a vehicle_fleet row. Tries, in order:
 *   1. exact asset_no
 *   2. case-insensitive asset_no (ilike, escaped)
 *   3. case-insensitive fleet_number
 * Returns null when nothing (visible to this user) matches.
 */
export async function lookupAssetByCode(raw: string): Promise<AssetLookupRecord | null> {
  const code = extractScanCode(raw)
  if (!code) return null

  // 1) exact
  const exact = await supabase.from('vehicle_fleet').select(ASSET_COLS).eq('asset_no', code).limit(1)
  if (exact.data && exact.data.length) return exact.data[0] as AssetLookupRecord

  // ilike needs %/_ escaped so a code containing them stays a literal match.
  const literal = code.replace(/[%_]/g, (m) => `\\${m}`)

  // 2) case-insensitive asset_no
  const ci = await supabase.from('vehicle_fleet').select(ASSET_COLS).ilike('asset_no', literal).limit(1)
  if (ci.data && ci.data.length) return ci.data[0] as AssetLookupRecord

  // 3) fleet_number fallback
  const fleet = await supabase.from('vehicle_fleet').select(ASSET_COLS).ilike('fleet_number', literal).limit(1)
  if (fleet.data && fleet.data.length) return fleet.data[0] as AssetLookupRecord

  return null
}
