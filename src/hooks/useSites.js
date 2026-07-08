/**
 * useSites — shared access to the Sites master (V109) for any page that needs a
 * consistent, selectable site list. Loads the org's sites once per country
 * scope and exposes both the raw rows and a ready-to-render option list. This is
 * the single source every filter/form should use so "site" is the same
 * everywhere and selectable.
 *
 *   const { options, sites, loading, reload } = useSites(activeCountry)
 *   <select>{options.map(s => <option key={s}>{s}</option>)}</select>
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { listSites, siteOptionsForCountry } from '../lib/api/sites'

export function useSites(country, { activeOnly = true } = {}) {
  const [sites, setSites]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Load the whole org list once; filtering by country is done in-memory so a
      // country switch never re-hits the network.
      setSites(await listSites({}))
    } catch (e) {
      setError(e?.message || 'Could not load sites.')
      setSites([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const options = useMemo(
    () => siteOptionsForCountry(sites, country && country !== 'All' ? country : '', { activeOnly }),
    [sites, country, activeOnly],
  )

  return { sites, options, loading, error, reload }
}
