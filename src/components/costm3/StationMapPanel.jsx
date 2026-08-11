import { useCallback, useEffect, useMemo, useState } from 'react'
import { Factory, Check, RefreshCcw, AlertTriangle } from 'lucide-react'
import { useSettings, COUNTRIES } from '../../contexts/SettingsContext'
import {
  getProductionStations, setProductionStation, applyProductionStationMap, listSites,
} from '../../lib/api/costPerM3'
import { toUserMessage } from '../../lib/safeError'
import CostM3Table from './CostM3Table'

/**
 * Tell the system which batching plant stands at which site.
 *
 * The production file identifies a plant by number - 39, 40, 81 - and that
 * number lands in the site column, so every per-site production figure reads as
 * a number nobody can place, and production can never be set against parts
 * spend, which uses real site names.
 *
 * The plant CANNOT be worked out from the data. Stations 39, 40, 81 and 23 all
 * serve the same projects and the same customers, because a plant supplies
 * whatever is near it. Only the owner knows, so they say it once here and every
 * future upload lands in the right place by itself.
 *
 * The site list comes from the site register, the same names parts resolves to,
 * so the two sides cannot drift into separate vocabularies.
 */
export default function StationMapPanel() {
  const { activeCountry } = useSettings()
  const initial = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initial)
  const [stations, setStations] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState('')
  const [draft, setDraft] = useState({})

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true); setError(''); setNotice('')
    Promise.all([
      getProductionStations({ country }),
      listSites({ country }).catch(() => []),
    ])
      .then(([st, si]) => {
        if (cancelled) return
        setStations(Array.isArray(st) ? st : [])
        setSites(Array.isArray(si) ? si : [])
      })
      .catch((e) => { if (!cancelled) setError(toUserMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country])

  useEffect(() => load(), [load])

  // The register IS the list. A free-text box here would let a typo invent a
  // 39th site that nothing else knows about, which is how production and parts
  // grew separate vocabularies in the first place.
  const siteOptions = useMemo(
    () => sites
      .map((s) => ({ name: String(s?.name ?? '').trim(), region: String(s?.region ?? '').trim() }))
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [sites],
  )

  // Region is NOT stored here and there is no field for it: it belongs to the
  // site, so it is read back from Site Management. Set it there once and every
  // plant standing at that site reports under it.
  const regionOf = useMemo(() => {
    const m = new Map()
    for (const s of siteOptions) m.set(s.name.toUpperCase(), s.region)
    return (name) => m.get(String(name ?? '').trim().toUpperCase()) ?? null
  }, [siteOptions])

  const unmapped = stations.filter((s) => !s.mapped)
  // Only plant NUMBERS are the problem. A row that already names a real site
  // needs no mapping and should not be listed as work outstanding.
  const unmappedNumeric = unmapped.filter((s) => /^\d+$/.test(String(s.station || '')))

  async function save(station) {
    const site = String(draft[station] ?? '').trim()
    if (!site) return
    setSaving(station); setError(''); setNotice('')
    try {
      await setProductionStation({ country, station, site })
      // The trigger only resolves rows as they are written, so the loads
      // already stored have to be re-resolved or the map would apply to future
      // uploads only.
      const res = await applyProductionStationMap({ country, dryRun: false })
      setNotice(
        res?.ok
          ? `Station ${station} is now ${site}. ${Number(res.rows || 0).toLocaleString()} recorded loads moved with it.`
          : `Station ${station} is now ${site}. Existing loads could not be moved - press Re-apply.`,
      )
      setDraft((d) => ({ ...d, [station]: '' }))
      load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving('')
    }
  }

  async function reapply() {
    setSaving('all'); setError(''); setNotice('')
    try {
      const res = await applyProductionStationMap({ country, dryRun: false })
      setNotice(res?.ok
        ? `${Number(res.rows || 0).toLocaleString()} loads re-checked against the map.`
        : 'Could not re-apply the map.')
      load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving('')
    }
  }

  const columns = [
    {
      key: 'station',
      header: 'Station',
      render: (r) => (
        <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{r.station}</span>
      ),
    },
    { key: 'loads', header: 'Loads', align: 'right', render: (r) => Number(r.loads || 0).toLocaleString() },
    { key: 'm3', header: 'Approved M3', align: 'right', render: (r) => Math.round(Number(r.m3) || 0).toLocaleString() },
    {
      key: 'period',
      header: 'Producing',
      cellClass: 'whitespace-nowrap',
      render: (r) => `${String(r.first_day || '').slice(0, 10)} to ${String(r.last_day || '').slice(0, 10)}`,
    },
    {
      key: 'site',
      header: 'Site',
      render: (r) => (r.mapped ? (
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          <Check size={13} /> {r.site}
        </span>
      ) : /^\d+$/.test(String(r.station || '')) ? (
        <span style={{ color: 'var(--text-dim)' }}>Not set</span>
      ) : (
        // Already a real name: nothing to map, and saying "not set" would send
        // someone to fix a row that is fine.
        <span style={{ color: 'var(--text-secondary)' }}>{r.site}</span>
      )),
    },
    {
      key: 'region',
      header: 'Region',
      render: (r) => {
        const reg = regionOf(r.site)
        if (reg) return <span style={{ color: 'var(--text-primary)' }}>{reg}</span>
        if (!r.mapped) return <span style={{ color: 'var(--text-dim)' }}>-</span>
        // The site is known but carries no region. That is a Site Management
        // job, not a field to add here, so say where to go instead of
        // offering a second place to record the same fact.
        return <span style={{ color: 'var(--text-dim)' }}>Set in Site Management</span>
      },
    },
    {
      key: 'set',
      header: 'Set site',
      render: (r) => (
        <div className="flex items-center gap-2">
          <select
            value={draft[r.station] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [r.station]: e.target.value }))}
            disabled={!siteOptions.length}
            className="min-w-[170px] rounded-md border border-[var(--border-subtle)] px-2 py-1 text-sm"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">{r.mapped ? 'Change site...' : 'Pick a site...'}</option>
            {siteOptions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.region ? `${s.name} (${s.region})` : s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => save(r.station)}
            disabled={!String(draft[r.station] ?? '').trim() || saving === r.station}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {saving === r.station ? 'Saving...' : 'Save'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <section className="card mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2"
              style={{ color: 'var(--text-secondary)' }}>
            <Factory size={15} /> Which plant is at which site
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            The production file names a batching plant by number. Say once where each plant
            stands and every figure, past and future, is reported against the real site - the
            same site names used for parts and expenses. The list below is your Site Management
            register, and the region comes with the site, so there is nothing to set twice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-sm"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={reapply} disabled={saving === 'all'} className="btn-secondary text-xs inline-flex items-center gap-1">
            <RefreshCcw size={13} /> {saving === 'all' ? 'Working...' : 'Re-apply map'}
          </button>
        </div>
      </div>

      {!loading && !siteOptions.length && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
           style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--text-primary)' }}>
          <AlertTriangle size={14} />
          No sites are registered for {country}. Add them in Site Management first - that is
          where the site list and its region come from.
        </p>
      )}

      {error && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
           style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)', color: 'var(--text-primary)' }}>
          {notice}
        </p>
      )}
      {!loading && unmappedNumeric.length > 0 && (
        <p className="mb-3 text-xs" style={{ color: 'var(--text-dim)' }}>
          {unmappedNumeric.length} plant {unmappedNumeric.length === 1 ? 'number is' : 'numbers are'} still
          reported as a number. Production for {unmappedNumeric.length === 1 ? 'it' : 'them'} cannot be set
          against site cost until the site is named.
        </p>
      )}

      <CostM3Table
        columns={columns}
        rows={stations}
        rowKey="station"
        loading={loading}
        empty={`No production recorded for ${country} yet.`}
      />
    </section>
  )
}
