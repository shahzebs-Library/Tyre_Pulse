/**
 * Which five-view board a saved handover is drawn on.
 *
 * New handovers record the board (`stem`) on every marker, so this returns it
 * straight away. Older handovers do not, so the asset is looked up once in the
 * fleet register; an asset number that exists in more than one country on the
 * All-countries view is never resolved by guess (no picture, honest outline).
 */
import { useEffect, useState } from 'react'
import { getAssetMatches } from '../../lib/api/assets'
import { handoverStemFor, handoverViewsFor } from '../../lib/vehicleHandoverMarks'

export default function useHandoverArtwork(assetNo, storedStem, country) {
  const code = String(assetNo || '').trim().toUpperCase()
  const [state, setState] = useState({ stem: storedStem || null, views: handoverViewsFor({ asset_no: code }) })

  useEffect(() => {
    let alive = true
    if (storedStem || !code) {
      setState({ stem: storedStem || null, views: handoverViewsFor({ asset_no: code }) })
      return () => { alive = false }
    }
    getAssetMatches(code, country)
      .then((m) => {
        if (!alive) return
        const ambiguous = (!country || country === 'All') && (m?.countries?.length || 0) > 1
        const row = ambiguous ? null : m?.row || null
        setState({ stem: handoverStemFor(row), views: handoverViewsFor(row || { asset_no: code }) })
      })
      .catch(() => { if (alive) setState({ stem: null, views: handoverViewsFor({ asset_no: code }) }) })
    return () => { alive = false }
  }, [code, storedStem, country])

  return state
}
