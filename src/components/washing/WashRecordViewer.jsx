import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { listWashCorrections } from '../../lib/api/washRecords'
import { entryPerson } from '../../lib/washDetails'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'

export default function WashRecordViewer({ row, onClose }) {
  const [history, setHistory] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState([])
  useEffect(() => {
    let live = true
    setHistory([]); setError(''); setLoading(true); setPhotos([])
    if (!row) return () => { live = false }
    listWashCorrections(row.id).then(data => { if(live) setHistory(data) }).catch(() => { if(live) setError('Correction history could not be loaded.') }).finally(() => { if(live) setLoading(false) })
    Promise.all((row.photos || []).map(async ref => { try { return safeImageSrc(await resolveStorageUrl(ref)) } catch { return null } })).then(p => { if(live) setPhotos(p) })
    return () => { live = false }
  }, [row])
  if (!row) return null
  const details = row.wash_details
  return <Modal open onClose={onClose} title={`Wash record · ${row.asset_no}`} subtitle={`${row.wash_date || ''} · ${row.status || 'Not recorded'}`} size="lg">
    <div className="space-y-5">
      <dl className="grid sm:grid-cols-2 gap-3">{Object.entries({ 'Entered by': entryPerson(row), Username: row.entry_username, 'Received at': row.created_at, 'Captured at': row.captured_at, 'Washed by': row.washed_by, 'Wash type': row.wash_type, Site: row.site, Area: row.area, Bay: row.bay, 'Completed at': row.completed_at, 'Completion user ID': row.completed_by }).map(([label,value]) => <div key={label}><dt className="text-xs text-[var(--text-muted)]">{label}</dt><dd className="text-sm break-words">{value || 'Not recorded'}</dd></div>)}</dl>
      <section><h3 className="font-semibold mb-2">Chemicals used</h3>
        <p>{details?.chemical_status === 'none' ? 'No chemical used' : details?.chemical_status === 'used' ? '' : 'Not recorded'}</p>
        {(details?.chemicals || []).map((c,i) => <div key={i} className="border-b border-[var(--input-border)] py-2"><strong>{c.name}</strong><p className="text-sm">{[c.manufacturer, [c.quantity,c.unit].filter(Boolean).join(' '), c.dilution && `Dilution used: ${c.dilution}`].filter(Boolean).join(' · ')}</p>{/^https:\/\/\S+$/.test(c.sds_url || '') && <a className="text-blue-400 underline" href={c.sds_url} target="_blank" rel="noreferrer">Safety data sheet</a>}</div>)}
      </section>
      <section><h3 className="font-semibold mb-2">Photos</h3>{!row.photos?.length && <p>No photos recorded.</p>}<div className="grid sm:grid-cols-2 gap-3">{photos.map((url,i) => url ? <a key={i} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Wash attachment ${i+1}`} className="w-full rounded object-contain max-h-72" /></a> : <p key={i}>Photo {i+1} unavailable</p>)}</div></section>
      {row.notes && <section><h3 className="font-semibold">Notes</h3><p className="whitespace-pre-wrap">{row.notes}</p></section>}
      <section><h3 className="font-semibold mb-2">Correction history</h3>{loading ? <p>Loading history…</p> : error ? <p role="alert">{error}</p> : !history.length ? <p>No corrections recorded.</p> : history.map(h => <div key={h.id} className="py-2 border-b border-[var(--input-border)] text-sm break-words"><p>{h.field}: {h.old_value || '(blank)'} → {h.new_value || '(blank)'}</p><p>{h.reason} · {h.corrected_at} · {h.corrected_by}</p></div>)}</section>
    </div>
  </Modal>
}
