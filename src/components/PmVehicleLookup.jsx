import { useCallback, useEffect, useRef, useState } from 'react'
import { getAssetMatches } from '../lib/api/assets'
import { toUserMessage } from '../lib/safeError'

export default function PmVehicleLookup({ value, country, onChange, onSelect }) {
  const request = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invalidate = useCallback(() => { request.current++ }, [])
  useEffect(() => { invalidate(); setBusy(false); setError(''); return invalidate }, [value, country, invalidate])
  async function find() {
    const token = ++request.current
    setBusy(true); setError('')
    try {
      const result = await getAssetMatches(value.trim(), country)
      if (token !== request.current) return
      const matches = result.rows.filter(row => !country || country === 'All' || row.country === country)
      if (matches.length !== 1) {
        setError(matches.length ? 'This asset number has multiple matches. Select its country or correct the fleet record first.' : 'Vehicle not found in the selected country.')
        return
      }
      onSelect(matches[0])
    } catch (err) { if (token === request.current) setError(toUserMessage(err, 'Could not find this vehicle. Try again.')) }
    finally { if (token === request.current) setBusy(false) }
  }
  return <div>
    <label className="label" htmlFor="pm-vehicle-number">Vehicle / asset number</label>
    <div className="flex gap-2">
      <input id="pm-vehicle-number" className="input w-full" placeholder="Enter asset number" value={value} maxLength={120} onChange={e => onChange(e.target.value)} />
      <button type="button" className="btn-secondary whitespace-nowrap" disabled={busy || !value.trim()} onClick={find}>{busy ? 'Finding…' : 'Find vehicle'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
  </div>
}
