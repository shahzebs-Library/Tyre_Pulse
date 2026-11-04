/**
 * useAssetPositionCodes - the wheel positions of ONE asset, as the canonical GCC
 * codes the tyre map and tyre_records use (LHF1, RHCO, LHR1-O ...).
 *
 * For forms that only know an asset number typed by the user (service events,
 * temperature readings, spare deployment). It looks the machine up once the
 * number settles, resolves its layout through the shared vehicleTyreLayout /
 * tyrePositions helpers (via tyreBay.layoutPositionsFor) and returns the codes
 * for a <datalist>. The input stays free text, so a value already stored in a
 * different spelling still saves; the list only stops a user from inventing a
 * name the vehicle does not have.
 *
 * Never throws: an unknown asset or a failed read yields an empty list.
 */
import { useEffect, useState } from 'react'
import { getAssetByNo } from '../lib/api/assets'
import { layoutPositionsFor, vehicleTypeIsKnown } from '../lib/tyreBay'

export default function useAssetPositionCodes(assetNo, country, { delayMs = 350 } = {}) {
  const [codes, setCodes] = useState([])
  const key = String(assetNo ?? '').trim().toUpperCase()

  useEffect(() => {
    if (!key) { setCodes([]); return undefined }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const row = await getAssetByNo(key, country)
        if (cancelled) return
        // An unclassified machine would resolve to a pickup's four wheels; offer
        // nothing rather than a layout we do not know.
        if (!row || !(vehicleTypeIsKnown(row.vehicle_type) || vehicleTypeIsKnown(row.asset_no || key))) {
          setCodes([]); return
        }
        const list = layoutPositionsFor(row.vehicle_type, row.asset_no || key, row.country || country)
        setCodes([...new Set(list.map((p) => p.code))])
      } catch {
        if (!cancelled) setCodes([])
      }
    }, delayMs)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [key, country, delayMs])

  return codes
}
