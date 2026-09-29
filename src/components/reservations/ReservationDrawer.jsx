/**
 * Reservation detail drawer: vehicle, people, times, trip, approvals, history
 * and linked gate passes and handovers, with the workflow actions the signed
 * in person may take. Every figure is read from the record; anything not
 * recorded says so.
 */
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, XCircle, LogOut, LogIn, Pencil, Trash2, Loader2,
  History, ShieldCheck, Milestone as RouteIcon, User, Briefcase, Link2,
} from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { VehicleThumb, fmtInt } from '../commandCenter/kit'
import {
  approveReservation, rejectReservation, checkOutReservation, returnReservation, updateVehicleReservation,
  listReservationEvents, listReservationLinks,
} from '../../lib/api/vehicleReservations'
import {
  deriveStatus, VIEW_STATUS_META, workflowActions, describeEvent, tripFacts, lateText, isRejected,
} from '../../lib/vehicleReservationsView'
import { RESERVATION_STATUS_LABEL } from '../../lib/vehicleReservationsAnalytics'
import { durationHours } from '../../lib/vehicleReservations'
import { toUserMessage } from '../../lib/safeError'

function fmtDT(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtHours(h) {
  if (h == null) return null
  return h < 24 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} d`
}
const NA = <span className="cc-na">Not recorded</span>
const val = (v) => (v == null || v === '' ? NA : v)

function Section({ icon: Icon, title, children }) {
  return (
    <section className="vr-d-sec">
      <h3><Icon size={14} aria-hidden="true" /> {title}</h3>
      {children}
    </section>
  )
}

function useLoader(fn, deps) {
  const [st, setSt] = useState({ loading: true, data: null, error: null })
  const run = useCallback(() => {
    let live = true
    setSt({ loading: true, data: null, error: null })
    Promise.resolve().then(fn).then(
      (data) => { if (live) setSt({ loading: false, data, error: null }) },
      (e) => { if (live) setSt({ loading: false, data: null, error: toUserMessage(e, 'Could not load this section.') }) },
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => run(), [run])
  return { ...st, retry: run }
}

function Loaded({ st, children }) {
  if (st.loading) return <div className="cc-skel" style={{ height: 40 }} />
  if (st.error) return <p className="vr-bad" role="alert">{st.error} <button type="button" className="cc-link cc-link-btn" onClick={st.retry}>Retry</button></p>
  return children(st.data)
}

export default function ReservationDrawer({ row, fleet, now, elevated, conflicted, onClose, onEdit, onDelete, onChanged }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [odoOut, setOdoOut] = useState('')
  const [odoIn, setOdoIn] = useState('')
  const [mode, setMode] = useState(null)
  const id = row?.id

  useEffect(() => { setErr(''); setReason(''); setMode(null); setOdoOut(row?.odometer_out ?? ''); setOdoIn(row?.odometer_in ?? '') }, [row])

  const events = useLoader(() => (id ? listReservationEvents(id) : []), [id, row?.updated_at])
  const links = useLoader(() => (row ? listReservationLinks(row) : { gatePasses: [], handovers: [] }), [id, row?.asset_no, row?.start_at, row?.end_at])

  if (!row) return null
  const st = deriveStatus(row, { now })
  const meta = VIEW_STATUS_META[st]
  const trip = tripFacts(row)
  const actions = workflowActions(row, { elevated })
  const rejected = isRejected(row)

  const act = async (key, fn) => {
    setBusy(key); setErr('')
    try {
      const updated = await fn()
      setMode(null); setReason('')
      await onChanged?.(updated)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not update the reservation.'))
    } finally {
      setBusy('')
    }
  }

  const footer = (
    <div className="cc vr-d-foot">
      <button type="button" className="cc-btn-ghost vr-danger" onClick={() => onDelete(row)} disabled={!!busy}><Trash2 size={14} aria-hidden="true" /> Delete</button>
      <button type="button" className="cc-btn-ghost" onClick={() => onEdit(row)} disabled={!!busy}><Pencil size={14} aria-hidden="true" /> Edit</button>
      {actions.includes('reject') && <button type="button" className="cc-btn-ghost vr-danger" onClick={() => setMode('reject')} disabled={!!busy}><XCircle size={14} aria-hidden="true" /> Reject</button>}
      {actions.includes('approve') && (
        <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={() => act('approve', () => approveReservation(id))}>
          {busy === 'approve' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} Approve
        </button>
      )}
      {actions.includes('checkout') && <button type="button" className="cc-btn-primary" onClick={() => setMode('checkout')} disabled={!!busy}><LogOut size={14} aria-hidden="true" /> Check out</button>}
      {actions.includes('return') && <button type="button" className="cc-btn-primary" onClick={() => setMode('return')} disabled={!!busy}><LogIn size={14} aria-hidden="true" /> Return</button>}
    </div>
  )

  return (
    <SideDrawer
      open={!!row}
      onClose={onClose}
      busy={!!busy}
      size="lg"
      title={`Reservation ${row.reference || row.asset_no || ''}`}
      subtitle={`${meta.label}, workflow ${RESERVATION_STATUS_LABEL[String(row.status || '').toLowerCase()] || row.status || 'not recorded'}${rejected ? ', rejected' : ''}`}
      footer={footer}
    >
      <div className="cc vr-drawer">
        <div className="vr-d-vehicle">
          <VehicleThumb row={fleet || { asset_no: row.asset_no }} size="lg" />
          <div>
            <b>{row.asset_no || 'Vehicle not recorded'}</b>
            <span>{[fleet?.vehicle_type, fleet?.make, fleet?.model].filter(Boolean).join(', ') || 'Not in the fleet register for this country'}</span>
            <span>Plate {fleet?.registration_no || 'not recorded'}{fleet?.site ? `, based at ${fleet.site}` : ''}</span>
            {fleet?.asset_no && <Link className="cc-link" to={`/asset-management/${encodeURIComponent(fleet.asset_no)}`}>Open asset</Link>}
          </div>
          <span className={`cc-pill ${meta.tone}`}>{meta.label}</span>
        </div>

        {conflicted && <p className="vr-d-alert"><AlertTriangle size={14} aria-hidden="true" /> Double-booked: another reservation holds this vehicle over overlapping times.</p>}
        {rejected && <p className="vr-d-alert"><XCircle size={14} aria-hidden="true" /> Rejected {fmtDT(row.rejected_at) || ''}. Reason: {row.rejected_reason || 'not recorded'}</p>}
        {err && <p className="vr-d-alert" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</p>}

        {mode === 'reject' && (
          <div className="vr-d-action">
            <label className="vr-lbl"><span>Reason for rejecting <em>*</em></span>
              <textarea className="vr-input" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="For example: no driver free on these dates" /></label>
            <div className="vr-form-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
              <button type="button" className="cc-btn-primary vr-btn-danger" disabled={!!busy || !reason.trim()} onClick={() => act('reject', () => rejectReservation(id, reason))}>
                {busy === 'reject' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Reject reservation
              </button>
            </div>
          </div>
        )}
        {mode === 'checkout' && (
          <div className="vr-d-action">
            <label className="vr-lbl"><span>Odometer at pickup (km)</span>
              <input className="vr-input" type="number" min="0" step="1" inputMode="numeric" value={odoOut} onChange={(e) => setOdoOut(e.target.value)} placeholder="Leave empty if not read" /></label>
            <div className="vr-form-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
              <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={() => act('checkout', () => checkOutReservation(id, { odometerOut: odoOut }))}>
                {busy === 'checkout' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Confirm check out
              </button>
            </div>
          </div>
        )}
        {mode === 'return' && (
          <div className="vr-d-action">
            <label className="vr-lbl"><span>Odometer at return (km){row.odometer_out != null ? `, pickup read ${fmtInt(row.odometer_out)}` : ''}</span>
              <input className="vr-input" type="number" min={row.odometer_out ?? 0} step="1" inputMode="numeric" value={odoIn} onChange={(e) => setOdoIn(e.target.value)} placeholder="Leave empty if not read" /></label>
            <div className="vr-form-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
              <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={() => act('return', () => returnReservation(id, { odometerIn: odoIn, odometerOut: row.odometer_out }))}>
                {busy === 'return' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Confirm return
              </button>
            </div>
          </div>
        )}

        <div className="vr-d-grid">
          <Section icon={User} title="People">
            <dl className="vr-dl">
              <dt>Requester</dt><dd>{val(row.requester_name)}</dd>
              <dt>Department</dt><dd>{val(row.department)}</dd>
              <dt>Driver</dt><dd>{val(row.driver_name)}</dd>
            </dl>
          </Section>
          <Section icon={Briefcase} title="Purpose and charging">
            <dl className="vr-dl">
              <dt>Purpose</dt><dd>{val(row.purpose)}</dd>
              <dt>Project</dt><dd>{val(row.project)}</dd>
              <dt>Cost centre</dt><dd>{val(row.cost_centre)}</dd>
              <dt>Reference</dt><dd>{val(row.reference)}</dd>
            </dl>
          </Section>
          <Section icon={RouteIcon} title="Times and trip">
            <dl className="vr-dl">
              <dt>Planned pickup</dt><dd>{fmtDT(row.start_at) || NA}{row.pickup_location ? `, ${row.pickup_location}` : ''}</dd>
              <dt>Planned return</dt><dd>{fmtDT(row.end_at) || NA}{row.return_location ? `, ${row.return_location}` : ''}</dd>
              <dt>Booked for</dt><dd>{fmtHours(durationHours(row)) || NA}</dd>
              <dt>Actual pickup</dt><dd>{fmtDT(row.actual_pickup_at) || NA}{trip.pickupLateMin != null && ` (${lateText(trip.pickupLateMin)})`}</dd>
              <dt>Actual return</dt><dd>{fmtDT(row.actual_return_at) || NA}{trip.returnLateMin != null && ` (${lateText(trip.returnLateMin)})`}</dd>
              <dt>Odometer out / in</dt><dd>{row.odometer_out != null ? `${fmtInt(row.odometer_out)} km` : 'Not read'} / {row.odometer_in != null ? `${fmtInt(row.odometer_in)} km` : 'Not read'}</dd>
              <dt>Distance driven</dt><dd>{trip.distance != null ? `${fmtInt(trip.distance)} km` : NA}{trip.variancePct != null && ` (${trip.variancePct > 0 ? '+' : ''}${trip.variancePct}% against ${fmtInt(trip.expected)} km expected)`}</dd>
              {trip.distance == null && <><dt>Expected distance</dt><dd>{trip.expected != null ? `${fmtInt(trip.expected)} km` : NA}</dd></>}
            </dl>
          </Section>
          <Section icon={ShieldCheck} title="Approval">
            <dl className="vr-dl">
              <dt>Approved by</dt><dd>{val(row.approved_by)}</dd>
              <dt>Approved at</dt><dd>{fmtDT(row.approved_at) || NA}</dd>
              <dt>Notes</dt><dd className="vr-pre">{val(row.notes)}</dd>
            </dl>
          </Section>
        </div>

        <Section icon={Link2} title="Gate passes and handovers for this vehicle around the booking">
          <Loaded st={links}>
            {(d) => (d.gatePasses.length + d.handovers.length === 0
              ? <p className="cc-na">No gate pass or handover recorded for {row.asset_no} within a day of this booking.</p>
              : (
                <ul className="vr-d-links">
                  {d.gatePasses.map((g) => (
                    <li key={`g${g.id}`}>
                      <Link className="cc-link" to="/gate-pass">Gate pass</Link>
                      <span>{g.pass_date || 'Date not recorded'}{g.site ? `, ${g.site}` : ''}</span>
                      <span className="cc-pill muted">{g.status || 'Status not recorded'}</span>
                      {row.gate_pass_id === g.id
                        ? <b className="vr-linked">Linked</b>
                        : <button type="button" className="cc-btn" disabled={!!busy} onClick={() => act('link', () => updateVehicleReservation(id, { gate_pass_id: g.id }))}>Link</button>}
                    </li>
                  ))}
                  {d.handovers.map((h) => (
                    <li key={`h${h.id}`}>
                      <Link className="cc-link" to="/handovers">Handover {h.report_no || ''}</Link>
                      <span>{fmtDT(h.handover_at) || 'Time not recorded'}{h.handover_type ? `, ${h.handover_type}` : ''}{h.odometer_km != null ? `, ${fmtInt(h.odometer_km)} km` : ''}</span>
                      <span>{[h.from_driver, h.to_driver].filter(Boolean).join(' to ') || 'Drivers not recorded'}</span>
                      {row.handover_id === h.id
                        ? <b className="vr-linked">Linked</b>
                        : <button type="button" className="cc-btn" disabled={!!busy} onClick={() => act('link', () => updateVehicleReservation(id, { handover_id: h.id }))}>Link</button>}
                    </li>
                  ))}
                </ul>
              ))}
          </Loaded>
        </Section>

        <Section icon={History} title="Status history">
          <Loaded st={events}>
            {(list) => (list.length === 0
              ? <p className="cc-na">No history recorded. History starts from 29 Sep 2026; older changes were not logged.</p>
              : (
                <ol className="vr-d-hist">
                  {list.map((ev) => {
                    const d = describeEvent(ev)
                    return (
                      <li key={ev.id}>
                        <i className={`ev-${ev.event_type}`} aria-hidden="true" />
                        <div>
                          <b>{d.label}</b>
                          <span>{fmtDT(ev.at)}{ev.actor_name ? `, by ${ev.actor_name}` : ''}</span>
                          {d.text && <small>{d.text}</small>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ))}
          </Loaded>
        </Section>
      </div>
    </SideDrawer>
  )
}
