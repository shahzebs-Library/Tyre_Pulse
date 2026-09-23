import { useEffect, useState } from 'react'
import { TablePagination, usePagedRows } from '../ui/TablePagination'
import { correctVehicleMeter, meterCorrectionHistory } from '../../lib/api/vehicleMeters'
import { meterSource, meterToday, readingDate, receivedDate } from '../../lib/vehicleMeters'
import { toUserMessage } from '../../lib/safeError'

function Correction({ row, onSaved, onCancel }) {
  const [value, setValue] = useState(String(row.value))
  const [date, setDate] = useState(row.reading_date || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')
  useEffect(() => {
    let active = true
    meterCorrectionHistory(row).then(data => { if (active) setHistory(data) }).catch(() => { if (active) setHistoryError('Correction history could not be loaded.') })
    return () => { active = false }
  }, [row])
  async function submit(e) {
    e.preventDefault()
    if (value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || !date || date > meterToday(row.country) || reason.trim().length < 3) {
      setError('Enter a valid reading, date, and correction reason.'); return
    }
    setBusy(true); setError('')
    try { const result = await correctVehicleMeter(row, { value, date, reason }); onSaved(result, row.kind) }
    catch (err) { setError(toUserMessage(err, 'Could not correct this reading.')) }
    finally { setBusy(false) }
  }
  return <tr><td colSpan={8} className="p-4 bg-[var(--input-bg)]">
    <form onSubmit={submit} className="space-y-3" aria-label={`Correct ${row.asset_no} reading`}>
      <p className="text-sm font-medium">Correct {row.asset_no}: {Number(row.value).toLocaleString()} {row.kind} on {readingDate(row.reading_date)}</p>
      <p className="text-xs text-[var(--text-muted)]">Original source is retained. For a flagged reading, saving records your Admin review; keep the reading unchanged to accept it. The old value, new value, your identity, and reason are recorded. A lower correction may not lower the fleet’s current meter.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">Corrected reading<input className="input block" aria-label="Corrected reading" type="number" min="0" step="any" value={value} disabled={busy} onChange={e => setValue(e.target.value)} /></label>
        <label className="text-sm">Reading date<input className="input block" aria-label="Corrected reading date" type="date" max={meterToday(row.country)} value={date} disabled={busy} onChange={e => setDate(e.target.value)} /></label>
        <label className="text-sm flex-1">Reason<input className="input block w-full" aria-label="Correction reason" value={reason} maxLength={4000} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
    </form>
    <div className="mt-3 text-xs text-[var(--text-secondary)]">
      {historyError || (history === null ? 'Loading correction history…' : history.length === 0 ? 'No recorded corrections.' : history.map(item => <p key={item.id}>
        {receivedDate(item.changed_at, row.country)} · Web correction · {item.old_data?.[row.kind === 'km' ? 'odometer_km' : 'engine_hours']} → {item.new_data?.[row.kind === 'km' ? 'odometer_km' : 'engine_hours']} · {item.details?.reason || 'Reason not recorded'} · User {item.changed_by || 'not recorded'}
      </p>))}
    </div>
  </td></tr>
}

export default function MeterHistory({ rows, onSaved, resetKey, canCorrect = false, canReview = false }) {
  const [editing, setEditing] = useState(null)
  const pager = usePagedRows(rows)
  const { setPage } = pager
  useEffect(() => { setPage(0); setEditing(null) }, [resetKey, setPage])
  return <div className="card !p-0 overflow-hidden">
    <div className="overflow-x-auto"><table className="w-full text-sm text-start">
      <thead><tr className="border-b border-[var(--input-border)] text-[var(--text-muted)]">{['Vehicle', 'Region / site', 'Reading', 'Reading date', 'Received at', 'Source', 'Last edited', 'Action'].map(h => <th key={h} scope="col" className="px-4 py-3 text-start whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{pager.pageRows.map(row => <HistoryRow key={`${row.kind}:${row.id}`} row={row} canCorrect={canCorrect} canReview={canReview} editing={editing} setEditing={setEditing} onSaved={(result, kind) => { onSaved(result, kind); setEditing(null) }} />)}
        {rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">No readings match these filters.</td></tr>}
      </tbody>
    </table></div><TablePagination {...pager} />
  </div>
}
function HistoryRow({ row, editing, setEditing, onSaved, canCorrect, canReview }) {
  const key = `${row.kind}:${row.id}`
  const canEdit = row.flagged ? canReview : canCorrect
  const edited = row.updated_at && row.created_at && row.updated_at !== row.created_at
  return <>
    <tr className="border-b border-[var(--input-border)]">
      <td className="px-4 py-3 font-medium">{row.asset_no}<div className="text-xs text-[var(--text-muted)]">{row.registration_no || row.vehicle_type || 'Registration not recorded'}</div></td>
      <td className="px-4 py-3">{row.region || 'Not recorded'}<div className="text-xs text-[var(--text-muted)]">{row.site || 'Site not recorded'}</div></td>
      <td className="px-4 py-3 whitespace-nowrap font-semibold">{row.value == null ? 'Not recorded' : Number(row.value).toLocaleString()} {row.kind}{row.flagged && <div className="text-xs text-amber-600" title={row.flag_reason}>{row.reviewed ? 'Reviewed by Admin' : 'Awaiting Admin review'}</div>}</td>
      <td className="px-4 py-3 whitespace-nowrap">{readingDate(row.reading_date)}</td>
      <td className="px-4 py-3 whitespace-nowrap text-xs">{receivedDate(row.created_at, row.country)}</td>
      <td className="px-4 py-3">{meterSource(row.source)}</td>
      <td className="px-4 py-3 text-xs">{edited ? receivedDate(row.updated_at, row.country) : 'Not edited'}</td>
      <td className="px-4 py-3">{canEdit ? <button className="btn-secondary text-xs" aria-expanded={editing === key} onClick={() => setEditing(editing === key ? null : key)}>{row.flagged ? 'Review / correct' : 'Correct / audit'}</button> : <span className="text-xs text-[var(--text-muted)]">{row.flagged ? 'Admin review only' : 'Correction unavailable'}</span>}</td>
    </tr>
    {canEdit && editing === key && <Correction row={row} onSaved={onSaved} onCancel={() => setEditing(null)} />}
  </>
}
