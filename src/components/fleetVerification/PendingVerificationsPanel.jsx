import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { canApprove } from '../../lib/fleetVerification'
import {
  decideFleetVerification, listPendingFleetVerifications, verificationPhotoUrl,
} from '../../lib/api/fleetVerification'

function Photo({ path, label }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    verificationPhotoUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  if (!url) return <div className="w-24 h-24 rounded flex items-center justify-center text-xs" style={{ background: 'var(--panel-2)', color: 'var(--text-dim)' }}>{label}</div>
  return <img src={url} alt="" className="w-24 h-24 rounded object-cover" />
}

/** Manager review queue for on-site verifications. Self-gates to Admin/Manager. */
export default function PendingVerificationsPanel({ country, onChanged }) {
  const { t } = useLanguage()
  // t may change identity every render; reading it through a ref keeps the
  // load callback stable so a re-render never triggers another fetch.
  const tRef = useRef(t)
  tRef.current = t
  const { profile, isSuperAdmin } = useAuth()
  const allowed = canApprove({ role: profile?.role, isSuperAdmin })
  const [state, setState] = useState({ loading: true, rows: [], notSetUp: false, error: null })
  const [notes, setNotes] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({})

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await listPendingFleetVerifications(country)
      setState({ loading: false, rows: r.rows, notSetUp: r.notSetUp, error: null })
    } catch (e) {
      setState({ loading: false, rows: [], notSetUp: false, error: toUserMessage(e, tRef.current('fleetVerification.loadError')) })
    }
  }, [country])

  useEffect(() => { if (allowed) load() }, [allowed, load])
  if (!allowed) return null

  async function decide(row, approve) {
    setBusyId(row.id); setRowError((m) => ({ ...m, [row.id]: null }))
    try {
      const res = await decideFleetVerification(row.id, approve, notes[row.id])
      if (res?.notSetUp) throw new Error(t('fleetVerification.notSetUp'))
      setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== row.id) }))
      onChanged?.(res)
    } catch (e) {
      setRowError((m) => ({ ...m, [row.id]: toUserMessage(e, t('fleetVerification.loadError')) }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card p-4" aria-labelledby="fv-pending-h">
      <h2 id="fv-pending-h" className="text-base font-semibold mb-3">{t('fleetVerification.pending.title')}</h2>
      {state.loading && <p className="text-sm" aria-busy="true">...</p>}
      {!state.loading && state.notSetUp && <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.notSetUp')}</p>}
      {!state.loading && state.error && (
        <p role="alert" className="text-sm">{state.error} <button type="button" className="underline" onClick={load}>{t('fleetVerification.action.retry')}</button></p>
      )}
      {!state.loading && !state.error && !state.notSetUp && state.rows.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.pending.empty')}</p>
      )}
      <ul className="space-y-3">
        {state.rows.map((r) => {
          const own = r.submitted_by === profile?.id
          return (
            <li key={r.id} className="border rounded p-3 flex flex-wrap gap-3" style={{ borderColor: 'var(--border)' }}>
              <Photo path={r.photo_path} label={t('fleetVerification.pending.noPhoto')} />
              <div className="flex-1 min-w-[220px] text-sm space-y-1">
                <div className="font-medium">{r.asset_no} <span style={{ color: 'var(--text-dim)' }}>{[r.vehicle_type, r.site, r.country].filter(Boolean).join(' / ')}</span></div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t('fleetVerification.pending.by', { name: r.submitted_by_name || '-', date: new Date(r.submitted_at).toLocaleString() })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(r.flags || []).map((f) => (
                    <span key={f} className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--panel-2)' }}>{t(`fleetVerification.flags.${f}`)}</span>
                  ))}
                </div>
                {r.outcome === 'present' && (
                  <table className="text-xs mt-1"><tbody>
                    <tr><td className="pe-3" /><td className="pe-3 font-medium">{t('fleetVerification.pending.old')}</td><td className="font-medium">{t('fleetVerification.pending.new')}</td></tr>
                    <tr><td className="pe-3">{t('fleetVerification.modal.plate')}</td><td className="pe-3">{r.previous_plate || '-'}</td><td>{r.observed_plate || '-'}</td></tr>
                    <tr><td className="pe-3">{t('fleetVerification.modal.chassis')}</td><td className="pe-3">{r.previous_chassis || '-'}</td><td>{r.observed_chassis || '-'}</td></tr>
                  </tbody></table>
                )}
                {r.outcome === 'other_country' && <div className="text-xs">{r.other_country}</div>}
                {r.note && <div className="text-xs italic">{r.note}</div>}
                {r.lat != null && r.lng != null && (
                  <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.pending.gps', { lat: r.lat.toFixed(5), lng: r.lng.toFixed(5) })}</div>
                )}
              </div>
              <div className="w-full sm:w-64 space-y-2">
                {own ? (
                  <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.pending.ownSubmission')}</p>
                ) : (
                  <>
                    <input className="input w-full text-sm" placeholder={t('fleetVerification.pending.reasonPrompt')}
                      aria-label={t('fleetVerification.pending.reasonPrompt')}
                      value={notes[r.id] || ''} onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))} />
                    <div className="flex gap-2">
                      <button type="button" className="btn-primary flex-1" disabled={busyId === r.id} onClick={() => decide(r, true)}>{t('fleetVerification.action.approve')}</button>
                      <button type="button" className="btn-secondary flex-1" disabled={busyId === r.id || !(notes[r.id] || '').trim()} onClick={() => decide(r, false)}>{t('fleetVerification.action.reject')}</button>
                    </div>
                  </>
                )}
                {rowError[r.id] && <p role="alert" className="text-xs" style={{ color: 'var(--danger, #b91c1c)' }}>{rowError[r.id]}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
