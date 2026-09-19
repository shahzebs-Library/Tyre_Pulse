/**
 * Pure asset-scan-code extraction — the web mirror of
 * `mobile/lib/assetLookup.ts`'s `extractScanCode`. Kept byte-identical in
 * intent (not literally shared, since the two apps do not share a module
 * graph) so a QR/barcode label produced for one app resolves the same way on
 * the other. Change the two together.
 *
 * Printed asset labels vary in the wild:
 *   - a bare code           -> "TRK-001"
 *   - a URL wrapper         -> "https://app/asset/TRK-001" or "...?asset=TRK-001"
 *   - a JSON payload        -> '{"asset_no":"TRK-001"}'
 *   - casing / whitespace   -> " trk-001 " vs stored "TRK-001"
 * so extraction here is deliberately forgiving; the caller still resolves the
 * extracted code case-insensitively (see lookupScannedAsset in
 * src/lib/api/assetScan.js).
 */

/** PostgREST filters break on commas/parens - strip them and cap length. */
function sanitize(code) {
  return String(code ?? '').trim().replace(/[(),]/g, '').slice(0, 64)
}

/**
 * Pull the most likely asset code out of a raw scan payload. Handles URL and
 * JSON wrappers, falling back to the trimmed raw string. Never throws.
 * @param {string} raw
 * @returns {string}
 */
export function extractScanCode(raw) {
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
