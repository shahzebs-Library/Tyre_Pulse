/**
 * Scan decision + routing helper.
 *
 * One place that turns a raw QR / barcode payload into (a) a classified result
 * and (b) the exact screen + prefilled params the field user should land on, so
 * a scan never dead-ends and the user never retypes what was just scanned.
 *
 * The DB matching itself stays in the lookup libs (assetLookup / tyreLookup);
 * this module only unwraps the payload, orders the lookups, and builds the
 * navigation targets. Keeping it pure of any UI makes the scanner screen thin
 * and lets the same routing be reused by manual-search / deep-link entry points.
 */
import { lookupAssetByCode, extractScanCode, AssetLookupRecord } from './assetLookup'
import { lookupTyreBySerial, sanitizeSerial, TyreLookupRecord } from './tyreLookup'

/** What a scanned code resolved to, plus the codes needed to act on it. */
export type ScanResolution =
  | { kind: 'vehicle'; code: string; raw: string; vehicle: AssetLookupRecord }
  | { kind: 'tyre'; code: string; raw: string; tyre: TyreLookupRecord }
  | { kind: 'none'; code: string; raw: string }

/** An expo-router navigation target (pathname + string params). */
export interface RouteTarget {
  pathname: string
  params: Record<string, string>
}

/**
 * Resolve a raw scan payload to a classified result. Order matters: an asset /
 * vehicle QR is the common case and takes priority; a bare serial then falls
 * through to the tyre resolver. Never throws - a lookup failure returns 'none'
 * so the caller can offer a friendly fallback rather than a raw error.
 */
export async function resolveScan(raw: string): Promise<ScanResolution> {
  const code = extractScanCode(raw)
  if (!code) return { kind: 'none', code: '', raw }

  try {
    // 1) Asset / vehicle (forgiving: exact -> ilike asset_no -> fleet_number).
    const vehicle = await lookupAssetByCode(raw)
    if (vehicle) return { kind: 'vehicle', code: vehicle.asset_no || code, raw, vehicle }

    // 2) Tyre serial (serials span several imported columns).
    const tyre = await lookupTyreBySerial(code)
    if (tyre) return { kind: 'tyre', code: sanitizeSerial(code), raw, tyre }
  } catch {
    return { kind: 'none', code, raw }
  }

  return { kind: 'none', code, raw }
}

// -- Navigation targets -------------------------------------------------------
// Each builder prefills everything already known so the user skips re-entry.

/** Start a fresh inspection for a scanned vehicle (site + asset prefilled). */
export function inspectionForVehicle(v: AssetLookupRecord): RouteTarget {
  return {
    pathname: '/(app)/inspection/new',
    params: { site: v.site ?? '', asset: v.asset_no ?? '' },
  }
}

/** Log a tyre change on a scanned vehicle (site + asset prefilled). */
export function tyreChangeForVehicle(v: AssetLookupRecord): RouteTarget {
  return {
    pathname: '/(app)/tyre-change',
    params: { site: v.site ?? '', asset: v.asset_no ?? '' },
  }
}

/** Open the fleet list focused on the scanned asset (q prefill for search). */
export function viewAssetRoute(v: AssetLookupRecord): RouteTarget {
  return {
    pathname: '/(app)/vehicles',
    params: { q: v.asset_no ?? '' },
  }
}

/**
 * Inspect a scanned tyre: jump into the inspection for its fitted vehicle with
 * the matching position's serial preselected. Only meaningful when the tyre is
 * fitted to an asset (asset_no present).
 */
export function inspectionForTyre(t: TyreLookupRecord, code: string): RouteTarget {
  return {
    pathname: '/(app)/inspection/new',
    params: {
      site: t.site ?? '',
      asset: t.asset_no ?? '',
      tyreSerial: code,
      tyrePosition: t.tyre_position ?? t.position ?? '',
    },
  }
}

/** Log a tyre change for a scanned tyre's vehicle (position + site prefilled). */
export function tyreChangeForTyre(t: TyreLookupRecord): RouteTarget {
  return {
    pathname: '/(app)/tyre-change',
    params: {
      site: t.site ?? '',
      asset: t.asset_no ?? '',
      position: t.tyre_position ?? t.position ?? '',
    },
  }
}

/** Hand an unresolved code to the manual serial search, prefilled + ready. */
export function manualSearchRoute(code: string): RouteTarget {
  return {
    pathname: '/(app)/serial-search',
    params: { q: code },
  }
}
