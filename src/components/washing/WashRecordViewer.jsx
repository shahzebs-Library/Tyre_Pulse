import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { listWashCorrections, verifyWashRecord } from '../../lib/api/washRecords'
import { canVerifyWash, nextWashDueOf, verificationLine } from '../../lib/washVerification'
import { entryPerson } from '../../lib/washDetails'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'

const AREA_LABELS = { exterior: 'Exterior body', engine_bay: 'Engine bay', undercarriage: 'Undercarriage', cabin: 'Cabin interior', tyres_rims: 'Tyres and rims', drum_hopper: 'Mixer drum and hopper', steam: 'Steam degrease' }
const VIEW_LABELS = { front: 'Front', left: 'Left', rear: 'Rear', right: 'Right', top: 'Top' }

/** "2026-11-27 09:01 · 24.71360, 46.67530" for one photo_evidence entry. */
function photoStamp(e) {
  if (!e) return 'No stamp recorded'
  const t = String(e.taken_at || '').replace('T', ' ').slice(0, 16)
  const gps = Number.isFinite(e.lat) && Number.isFinite(e.lng) ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : 'No GPS'
  return `${e.stage === 'after' ? 'After' : 'Before'} · ${t} · ${gps}`
}

/**
 * Read-only wash record for auditors. The one action is a supervisor's
 * verification (verify_wash_record RPC): never by the person who logged the
 * wash, and a supervisor's own entry needs none. Mirrors the phone viewer.
 */
export default function WashRecordViewer({ row, onClose, profile = null, isSuperAdmin = false, verifierName = null, onVerified }) {
  const [note, setNote] = useState(''), [verifying, setVerifying] = useState(false), [verifyError, setVerifyError] = useState(''), [verifiedHere, setVerifiedHere] = useState(false)
  const [history, setHistory] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState([])
  useEffect(() => {
    let live = true
    setHistory([]); setError(''); setLoading(true); setPhotos([]); setNote(''); setVerifyError(''); setVerifiedHere(false)
    if (!row) return () => { live = false }
    listWashCorrections(row.id).then(data => { if(live) setHistory(data) }).catch(() => { if(live) setError('Correction history could not be loaded.') }).finally(() => { if(live) setLoading(false) })
    Promise.all((row.photos || []).map(async ref => { try { return safeImageSrc(await resolveStorageUrl(ref)) } catch { return null } })).then(p => { if(live) setPhotos(p) })
    return () => { live = false }
  }, [row])
  if (!row) return null
  const details = row.wash_details
  const evidence = Array.isArray(details?.photo_evidence) ? details.photo_evidence : []
  const nextDue = nextWashDueOf(row)
  const status = verifiedHere ? 'verified' : row.verification_status
  const mayVerify = !verifiedHere && canVerifyWash(row, profile, isSuperAdmin)
  const ownPending = row.verification_status === 'pending' && profile?.id && row.created_by === profile.id
  async function verify() {
    setVerifying(true); setVerifyError('')
    try { await verifyWashRecord(row.id, note); setVerifiedHere(true); onVerified?.() }
    catch (e) { setVerifyError(e?.message || 'Could not verify this wash. Try again.') }
    finally { setVerifying(false) }
  }
  return <Modal open onClose={onClose} title={`Wash record · ${row.asset_no}`} subtitle={`${row.wash_date || ''} · ${row.status || 'Not recorded'}`} size="lg">
    <div className="space-y-5">
      <p className="text-xs rounded border border-[var(--input-border)] p-2">This record cannot be changed by the person who logged it. Corrections are made here by an administrator, and every change is kept in the correction history below.</p>
      <section aria-label="Supervisor check" className={`rounded border p-3 ${status === 'pending' ? 'border-amber-500' : status ? 'border-emerald-500' : 'border-[var(--input-border)]'}`}>
        <h3 className="font-semibold">Supervisor check</h3>
        <p className="text-sm" data-testid="wash-verification">{verifiedHere ? 'Wash verified' : verificationLine(row, verifierName)}</p>
        {status === 'verified' && !verifiedHere && row.verification_note && <p className="text-xs">{row.verification_note}</p>}
        {ownPending && <p className="text-xs text-[var(--text-muted)]">You logged this wash, so another supervisor must verify it.</p>}
        {mayVerify && <div className="mt-2 flex flex-wrap gap-2 items-end">
          <label className="text-xs flex-1 min-w-[12rem]">Note (optional)<input className="input w-full" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button className="btn-primary" disabled={verifying} onClick={verify}>{verifying ? 'Verifying…' : 'Verify this wash'}</button>
        </div>}
        {verifyError && <p role="alert" className="text-sm text-red-500">{verifyError}</p>}
      </section>
      {nextDue && <p className="text-sm font-semibold" data-testid="wash-next-due">Next wash due {nextDue}</p>}
      <dl className="grid sm:grid-cols-2 gap-3">{Object.entries({ 'Record ID': row.id, 'Entered by': entryPerson(row), Username: row.entry_username, 'Received at': row.created_at, 'Captured at': row.captured_at, 'Washed by': row.washed_by, 'Wash type': row.wash_type, Site: row.site, Area: row.area, Bay: row.bay, 'Completed at': row.completed_at, 'Completion user ID': row.completed_by, 'Sides washed': (details?.views || []).map(v => VIEW_LABELS[v] || v).join(', '), 'Washed areas': (details?.areas || []).map(a => AREA_LABELS[a] || a).join(', '), Cost: 'No charge · washed in-house' }).map(([label,value]) => <div key={label}><dt className="text-xs text-[var(--text-muted)]">{label}</dt><dd className="text-sm break-words">{value || 'Not recorded'}</dd></div>)}</dl>
      <section><h3 className="font-semibold mb-2">Chemicals used</h3>
        <p>{details?.chemical_status === 'none' ? 'No chemical used' : details?.chemical_status === 'used' ? '' : 'Not recorded'}</p>
        {(details?.chemicals || []).map((c,i) => <div key={i} className="border-b border-[var(--input-border)] py-2"><strong>{c.name}</strong><p className="text-sm">{[c.manufacturer, [c.quantity,c.unit].filter(Boolean).join(' '), c.dilution && `Dilution used: ${c.dilution}`].filter(Boolean).join(' · ')}</p>{/^https:\/\/\S+$/.test(c.sds_url || '') && <a className="text-blue-400 underline" href={c.sds_url} target="_blank" rel="noreferrer">Safety data sheet</a>}</div>)}
      </section>
      <section><h3 className="font-semibold mb-2">Photos</h3>{!row.photos?.length && <p>No photos recorded.</p>}<div className="grid sm:grid-cols-2 gap-3">{photos.map((url,i) => <figure key={i}>{url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Wash attachment ${i+1}`} className="w-full rounded object-contain max-h-72" /></a> : <p>Photo {i+1} unavailable</p>}{evidence.length > 0 && <figcaption className="text-xs text-[var(--text-muted)]">{photoStamp(evidence.find(e => e.index === i))}</figcaption>}</figure>)}</div></section>
      {row.notes && <section><h3 className="font-semibold">Notes</h3><p className="whitespace-pre-wrap">{row.notes}</p></section>}
      <section><h3 className="font-semibold mb-2">Correction history</h3>{loading ? <p>Loading history…</p> : error ? <p role="alert">{error}</p> : !history.length ? <p>No corrections recorded.</p> : history.map(h => <div key={h.id} className="py-2 border-b border-[var(--input-border)] text-sm break-words"><p>{h.field}: {h.old_value || '(blank)'} → {h.new_value || '(blank)'}</p><p>{h.reason} · {h.corrected_at} · {h.corrected_by}</p></div>)}</section>
    </div>
  </Modal>
}
