import { meterToday, meterSource, readingDate, receivedDate } from '../../lib/vehicleMeters'

const number = value => value == null ? 'No reading' : Number(value).toLocaleString()

export default function MeterRow({ vehicle, draft, status, onChange, onSave, onHistory, canSave = false }) {
  const row = vehicle
  const mode = row.supportsKm && row.supportsHours ? 'both' : row.supportsKm ? 'km' : row.supportsHours ? 'hours' : ''
  const value = draft || { km: '', hours: '', date: meterToday(row.country), notes: '' }
  const saving = status?.saving
  const change = (field, input) => onChange(row, field, input)
  function meterCell(kind, label, current, last) {
    const enabled = mode === kind || mode === 'both'
    const matchesCurrent = last && Number(last[kind === 'km' ? 'odometer_km' : 'engine_hours']) === current
    return <td className="px-4 py-3 align-top min-w-[180px]">
      <div className="font-semibold tabular-nums text-[var(--text-primary)]">{number(current)} {current == null ? '' : label}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{matchesCurrent ? readingDate(last.reading_date) : 'Measurement date not recorded'}</div>
      {matchesCurrent && <div className="text-xs text-[var(--text-muted)]" title={`Received ${receivedDate(last.created_at, row.country)}`}>{meterSource(last.source)}</div>}
      {enabled ? <input className="input w-full mt-2" aria-label={`${row.asset_no} new ${label}`} type="number" min="0" step={kind === 'km' ? '1' : '0.1'} inputMode="decimal"
        placeholder={`New ${label}`} value={value[kind]} disabled={saving || !canSave} onChange={e => change(kind, e.target.value)} />
        : <div className="text-xs text-[var(--text-muted)] mt-3">Not applicable</div>}
      {enabled && value[kind] !== '' && current != null && Number(value[kind]) < current && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Below the last reading. This will be saved for Admin review.</p>}
    </td>
  }
  return <>
    <tr className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)]/40">
      <td className="px-4 py-3 align-top min-w-[190px]">
        <button className="font-semibold text-[var(--text-primary)] underline decoration-dotted underline-offset-4" onClick={() => onHistory(row)}>{row.asset_no}</button>
        <div className="text-xs text-[var(--text-muted)] mt-1">{row.registration_no || row.fleet_number || 'No registration'} · {row.vehicle_type || 'Type not recorded'}</div>
        <div className="text-xs text-[var(--text-muted)] mt-2">{mode === 'both' ? 'Kilometres + hours' : mode === 'km' ? 'Kilometres' : mode === 'hours' ? 'Engine hours' : 'Vehicle meter type not established'}</div>
      </td>
      <td className="px-4 py-3 align-top text-sm"><div>{row.region || 'Region not recorded'}</div><div className="text-xs text-[var(--text-muted)] mt-1">{row.site || 'Site not recorded'}</div></td>
      {meterCell('km', 'km', row.km, row.kmLog)}
      {meterCell('hours', 'hours', row.engineHours, row.hoursLog)}
      <td className="px-4 py-3 align-top min-w-[180px]">
        <input className="input w-full" aria-label={`${row.asset_no} reading date`} type="date" max={meterToday(row.country)} value={value.date} disabled={saving || !canSave} onChange={e => change('date', e.target.value)} />
        <input className="input w-full mt-2" aria-label={`${row.asset_no} notes`} placeholder="Optional note" maxLength={4000} value={value.notes} disabled={saving || !canSave} onChange={e => change('notes', e.target.value)} />
      </td>
      <td className="px-4 py-3 align-top min-w-[155px]">
        <button className="btn-primary w-full disabled:opacity-50" aria-label={`Save ${row.asset_no}`} disabled={!canSave || saving || !mode || row.duplicate || (value.km === '' && value.hours === '')} onClick={() => onSave(row)}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn-secondary w-full mt-2 text-xs" onClick={() => onHistory(row)}>History</button>
        {row.duplicate && <p className="text-xs text-amber-600 mt-2">Duplicate fleet identity; saving disabled.</p>}
        {status?.message && <p role={status.error ? 'alert' : 'status'} className={`text-xs mt-2 ${status.error ? 'text-red-600 dark:text-red-300' : 'text-[var(--text-secondary)]'}`}>{status.message}</p>}
      </td>
    </tr>
  </>
}
