import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import { toUserMessage } from '../../lib/safeError'
import { listTeam, assignmentHistory, teamCommand, searchTeamVehicles, isTeamDenied } from '../../lib/api/fleetSupervisor'

/**
 * The Fleet Supervisor's team on the web, the same capability as the Flutter
 * "My drivers" screen: take a driver onto the team, give or change the vehicle,
 * take it back, remove the driver, and read the full assignment history.
 * Charges and traffic fines are issued from the driver's workspace page (the
 * existing "Issue charge" and "Issue traffic fine" actions), which this panel
 * opens. Every change is a new assignment row on the server; nothing is
 * rewritten. An account that is not a supervisor here sees nothing (42501).
 */

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function day(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function km(v) {
  return v == null ? null : Math.round(Number(v)).toLocaleString('en-US')
}

function offlineMessage(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'No connection. Nothing was saved. Try again when you are online.'
  return toUserMessage(err, 'The change could not be saved.')
}

function DriverCard({ d, onTeam, busy, onTake, onAssign, onUnassign, onRelease, onOpen, onHistory }) {
  return (
    <div className="rounded-xl border border-[var(--input-border)] p-4 flex flex-col gap-2" data-testid={`team-driver-${d.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <strong>{d.driver_name}</strong>
          <p className="text-xs text-[var(--text-muted)]">{d.driver_id}{d.site ? ` · ${d.site}` : ''}{d.login_linked ? '' : ' · Login not linked'}</p>
        </div>
        <span className={`text-xs rounded-full px-2 py-1 border ${d.asset_no ? 'border-sky-500 text-sky-600' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
          {d.asset_no || 'No vehicle'}
        </span>
      </div>
      <p className="text-sm">
        Open charges: {d.open_charges || 0} · Open fines: {d.open_fines || 0}
        {d.asset_no && <> · {d.last_km != null ? `Last km ${km(d.last_km)}${d.last_km_date ? ` on ${day(d.last_km_date)}` : ''}` : 'No odometer reading yet'}</>}
      </p>
      <div className="flex flex-wrap gap-2">
        {!onTeam && <button type="button" className="btn-primary" disabled={busy} onClick={() => onTake(d)}>Add to my team</button>}
        {onTeam && <>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => onAssign(d)}>{d.asset_no ? 'Change vehicle' : 'Assign vehicle'}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onOpen(d)}>Charges and fines</button>
          {d.asset_no && <button type="button" className="btn-secondary" disabled={busy} onClick={() => onUnassign(d)}>Take vehicle back</button>}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onRelease(d)}>Remove from my team</button>
        </>}
        <button type="button" className="btn-secondary" onClick={() => onHistory(d)}>Assignment history</button>
      </div>
    </div>
  )
}

export default function SupervisorTeamPanel({ onOpenDriver }) {
  const [view, setView] = useState('mine')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState(null) // { kind, driver }
  const [reason, setReason] = useState('')
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [vehicles, setVehicles] = useState(null)
  const [vehicle, setVehicle] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [history, setHistory] = useState(null) // { driver, rows, error }
  const generation = useRef(0)

  const load = useCallback(async (more = false) => {
    const gen = more ? generation.current : ++generation.current
    if (!more) { setLoading(true); setError('') }
    try {
      const page = await listTeam(view, search, more ? rows.length : 0)
      if (gen !== generation.current) return
      setRows(prev => (more ? [...prev, ...page.rows] : page.rows))
      setHasMore(page.hasMore)
      setDenied(false)
    } catch (err) {
      if (gen !== generation.current) return
      if (isTeamDenied(err)) setDenied(true)
      else setError(offlineMessage(err))
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [view, search, rows.length])

  // Reload when the tab or the (debounced) search changes.
  useEffect(() => {
    const t = setTimeout(() => { load(false) }, search ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search])

  useEffect(() => {
    if (action?.kind !== 'assign') return undefined
    let alive = true
    const t = setTimeout(async () => {
      try {
        const list = await searchTeamVehicles(action.driver.country, vehicleQuery)
        if (alive) setVehicles(list)
      } catch (err) {
        if (alive) setVehicles({ error: offlineMessage(err) })
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [action, vehicleQuery])

  // Never show one tab's rows under the other tab's actions while it loads.
  function switchView(next) {
    if (next === view) return
    generation.current += 1
    setRows([])
    setLoading(true)
    setView(next)
  }

  function open(kind, driver) {
    setAction({ kind, driver })
    setReason('')
    setVehicle(null)
    setVehicleQuery('')
    setVehicles(null)
    setConflict(null)
    setNotice('')
  }

  async function submit(moveFrom = null) {
    if (!action) return
    if (reason.trim().length < 3) { setNotice('Write a reason of at least 3 characters.'); return }
    if (action.kind === 'assign' && !vehicle) { setNotice('Choose a vehicle.'); return }
    const actionName = { take: 'take_driver', assign: 'assign_vehicle', unassign: 'unassign_vehicle', release: 'release_driver' }[action.kind]
    const payload = { driver_id: action.driver.id, reason: reason.trim() }
    if (action.kind === 'assign') payload.vehicle_id = vehicle.id
    if (moveFrom) payload.move_from_driver = moveFrom
    setBusy(true)
    setNotice('')
    try {
      const res = await teamCommand(actionName, payload, newId())
      if (!res.ok) { setConflict(res.conflict); return }
      setAction(null)
      setConflict(null)
      setNotice('Saved.')
      if (action.kind === 'take') { switchView('mine'); return }
      await load(false)
    } catch (err) {
      setNotice(offlineMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function showHistory(driver) {
    setHistory({ driver, rows: null, error: '' })
    try {
      const list = await assignmentHistory(driver.id)
      setHistory({ driver, rows: list, error: '' })
    } catch (err) {
      setHistory({ driver, rows: [], error: offlineMessage(err) })
    }
  }

  if (denied) return null

  const title = action && {
    take: `Add ${action.driver.driver_name} to your team`,
    assign: `${action.driver.asset_no ? 'Change vehicle' : 'Assign vehicle'} for ${action.driver.driver_name}`,
    unassign: `Take ${action.driver.asset_no} back from ${action.driver.driver_name}`,
    release: `Remove ${action.driver.driver_name} from your team`,
  }[action.kind]

  return (
    <section className="rounded-2xl border border-[var(--input-border)] p-4 flex flex-col gap-3" data-testid="supervisor-team-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">My drivers</h3>
        <div role="tablist" aria-label="Team view" className="flex gap-1">
          {[['mine', 'My team'], ['available', 'Add drivers']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'btn-primary' : 'btn-secondary'} onClick={() => switchView(k)}>{label}</button>
          ))}
        </div>
      </div>
      <input className="input" aria-label="Search drivers on the team" placeholder="Search name, ID or vehicle" value={search} onChange={e => setSearch(e.target.value)} />
      {notice && !action && <p role="status" className="text-sm">{notice}</p>}
      {loading && <p role="status">Loading drivers...</p>}
      {!loading && error && <div role="alert" className="text-sm text-red-500">{error} <button type="button" className="btn-secondary" onClick={() => load(false)}>Retry</button></div>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          {search ? 'No driver matches this search.' : view === 'mine' ? 'No drivers on your team yet. Open Add drivers and take the drivers you supervise onto your team.' : 'Every active driver in your area already has a supervisor.'}
        </p>
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {rows.map(d => (
            <DriverCard key={d.id} d={d} onTeam={view === 'mine'} busy={busy}
              onTake={x => open('take', x)} onAssign={x => open('assign', x)} onUnassign={x => open('unassign', x)}
              onRelease={x => open('release', x)} onOpen={x => onOpenDriver?.(x.id)} onHistory={showHistory} />
          ))}
        </div>
      )}
      {!loading && hasMore && <button type="button" className="btn-secondary" onClick={() => load(true)}>Load more</button>}

      <Modal open={!!action} onClose={() => !busy && setAction(null)} title={title}
        footer={<div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button>
          <button type="button" className={action?.kind === 'release' || action?.kind === 'unassign' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={() => submit()}>{busy ? 'Saving...' : 'Save'}</button>
        </div>}>
        <div className="flex flex-col gap-3">
          {action?.kind === 'release' && <p className="text-sm">The driver keeps the vehicle. You can no longer issue charges to them.</p>}
          {action?.kind === 'assign' && <>
            <input className="input" aria-label="Search vehicles" placeholder="Search asset or plate" value={vehicleQuery} onChange={e => setVehicleQuery(e.target.value)} />
            {vehicles === null && <p role="status">Loading vehicles...</p>}
            {vehicles?.error && <p role="alert" className="text-sm text-red-500">{vehicles.error}</p>}
            {Array.isArray(vehicles) && vehicles.length === 0 && <p className="text-sm">No vehicle matches this search.</p>}
            {Array.isArray(vehicles) && vehicles.length > 0 && (
              <div className="max-h-56 overflow-auto flex flex-col gap-1" role="listbox" aria-label="Vehicles">
                {vehicles.map(v => (
                  <button key={v.id} type="button" role="option" aria-selected={vehicle?.id === v.id}
                    className={`text-start rounded border p-2 ${vehicle?.id === v.id ? 'border-emerald-500' : 'border-[var(--input-border)]'}`}
                    onClick={() => setVehicle(v)}>
                    <strong>{v.asset_no}</strong> <span className="text-xs text-[var(--text-muted)]">{[v.registration_no, v.vehicle_type, v.site].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </>}
          <label className="flex flex-col gap-1">
            <span className="label">Reason</span>
            <input className="input" aria-label="Reason" placeholder="For example: joins my site team" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          {conflict && (
            <div role="alert" className="rounded border border-amber-500 p-3 text-sm flex flex-col gap-2">
              <p>{conflict.asset_no} is with {conflict.driver_name}. Move it to this driver? {conflict.driver_name} will have no vehicle.</p>
              <button type="button" className="btn-primary self-start" disabled={busy} onClick={() => submit(conflict.driver_id)}>Move vehicle</button>
            </div>
          )}
          {notice && <p role="alert" className="text-sm text-red-500">{notice}</p>}
        </div>
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `Assignment history: ${history.driver.driver_name}` : ''}>
        {history?.rows === null && <p role="status">Loading history...</p>}
        {history?.error && <p role="alert" className="text-sm text-red-500">{history.error}</p>}
        {history?.rows?.length === 0 && !history.error && <p>No assignment recorded yet.</p>}
        <div className="flex flex-col gap-2">
          {(history?.rows || []).map(a => (
            <div key={a.id} className="rounded border border-[var(--input-border)] p-3 text-sm">
              <p><strong>{a.ends_at ? 'Previous' : 'Current'}</strong> · {a.asset_no || 'No vehicle'}</p>
              <p>{a.ends_at ? `${day(a.starts_at)} to ${day(a.ends_at)}` : `Since ${day(a.starts_at)}`}</p>
              {a.supervisor_name && <p>Supervisor: {a.supervisor_name}</p>}
              {a.reason && <p>{a.reason}</p>}
              {a.assigned_by_name && <p className="text-[var(--text-muted)]">By {a.assigned_by_name}</p>}
            </div>
          ))}
        </div>
      </Modal>
    </section>
  )
}
