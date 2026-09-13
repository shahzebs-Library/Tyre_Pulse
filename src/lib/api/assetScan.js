/**
 * Resolve a scanned QR/barcode payload to a fleet-master row — the web port of
 * mobile's `lookupAssetByCode` (mobile/lib/assetLookup.ts), used by the
 * "Report Accident - Identify Asset" step's scanner. Extraction is
 * `extractScanCode` (src/lib/assetScan.js, pure); resolution tries, in order:
 *   1. exact asset_no
 *   2. case-insensitive asset_no
 *   3. case-insensitive fleet_number
 * Country-scoped via the same null-safe `applyCountry` every other assets.js
 * read uses, so a scan never silently substitutes another country's machine
 * for the one actually being reported (V376) — with no country match it
 * returns null rather than a wrong vehicle.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { extractScanCode } from '../assetScan'

const SCAN_COLS = 'id,asset_no,fleet_number,make,model,vehicle_type,registration_no,site,country'

async function firstMatch(build, country) {
  const rows = unwrap(await applyCountry(build(), country).order('country').order('id').limit(5)) || []
  return rows[0] || null
}

/**
 * @param {string} raw scanned/typed payload
 * @param {string} [country] active country to scope the match to
 * @returns {Promise<object|null>} the matched vehicle_fleet row, or null
 */
export async function lookupScannedAsset(raw, country) {
  const code = extractScanCode(raw)
  if (!code) return null

  const exact = await firstMatch(
    () => supabase.from('vehicle_fleet').select(SCAN_COLS).eq('asset_no', code),
    country,
  )
  if (exact) return exact

  // ilike needs %/_ escaped so a code containing them stays a literal match.
  const literal = code.replace(/[%_]/g, (m) => `\\${m}`)

  const ciAsset = await firstMatch(
    () => supabase.from('vehicle_fleet').select(SCAN_COLS).ilike('asset_no', literal),
    country,
  )
  if (ciAsset) return ciAsset

  return firstMatch(
    () => supabase.from('vehicle_fleet').select(SCAN_COLS).ilike('fleet_number', literal),
    country,
  )
}
