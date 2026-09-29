import { useEffect, useMemo, useState } from 'react'
import { correctVehicleMeter, meterCorrectionHistory } from '../../lib/api/vehicleMeters'
import { meterSource, meterToday, readingDate, receivedDate } from '../../lib/vehicleMeters'
import { toUserMessage } from '../../lib/safeError'
import { compareValues, isBlank } from '../../lib/consoleTable'
import EnterpriseTable from '../ui/EnterpriseTable'
import Modal from '../ui/Modal'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const rowKey = (row) => `${row.kind}:${row.id}`
const isEdited = (row) => !!(row.updated_at && row.created_at && row.updated_at !== row.created_at)

/**
 * The correction / review form. It used to open as an extra table row under
 * the reading; it is now the shared dialog so it keeps its full width on a
 * phone and its focus is trapped while it is open.
 */
export function Correction({ row, onSaved, onCancel }) {
  const [value, setValue] = useState(String(row.value))
  const [date, setDate] = useState(row.reading_date || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const [historyNonce, setHistoryNonce] = useState(0)
  useEffect(() => {
    let active = true
    setHistory(null); setHistoryError('')
    meterCorrectionHistory(row)
      .then(data => { if (active) setHistory(data) })
      .catch(() => { if (active) setHistoryError('Correction history could not be loaded.') })
    return () => { active = false }
  }, [row, historyNonce])
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
  const field = row.kind === 'km' ? 'odometer_km' : 'engine_hours'
  return (
    <Modal open onClose={busy ? undefined : onCancel} size="lg" closeOnBackdrop={!busy}
      title={`Correct ${row.asset_no} reading`}
      subtitle={`${Number(row.value).toLocaleString()} ${row.kind} on ${readingDate(row.reading_date)}`}>
      <form onSubmit={submit} className="space-y-3" aria-label={`Correct ${row.asset_no} reading`}>
        <p className="text-xs text-[var(--text-muted)]">Original source is retained. For a flagged reading, saving records your Admin review; keep the reading unchanged to accept it. The old value, new value, your identity, and reason are recorded. A lower correction may not lower the fleet current meter.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-[var(--text-secondary)]">Corrected reading
            <input className="input block w-full min-h-[44px]" aria-label="Corrected reading" type="number" min="0" step="any" value={value} disabled={busy} onChange={e => setValue(e.target.value)} />
          </label>
          <label className="text-sm text-[var(--text-secondary)]">Reading date
            <input className="input block w-full min-h-[44px]" aria-label="Corrected reading date" type="date" max={meterToday(row.country)} value={date} disabled={busy} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="text-sm text-[var(--text-secondary)] sm:col-span-2">Reason
            <input className="input block w-full min-h-[44px]" aria-label="Correction reason" value={reason} maxLength={4000} disabled={busy} onChange={e => setReason(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className="btn-secondary min-h-[44px]" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn-primary min-h-[44px]" disabled={busy}>{busy ? 'Saving...' : 'Save correction'}</button>
        </div>
      </form>
      <section className="mt-4 border-t border-[var(--input-border)] pt-3 text-xs text-[var(--text-secondary)]" aria-label="Correction history">
        <h3 className="font-medium text-[var(--text-primary)] mb-1">Correction history</h3>
        {historyError ? (
          <p role="alert" className="flex flex-wrap items-center gap-2">
            {historyError}
            <button type="button" className="btn-secondary text-xs min-h-[36px]" onClick={() => setHistoryNonce(n => n + 1)}>Retry</button>
          </p>
        ) : history === null ? <p>Loading correction history...</p>
          : history.length === 0 ? <p>No recorded corrections.</p>
          : history.map(item => (
            <p key={item.id} className="py-1">
              {receivedDate(item.changed_at, row.country)} | Web correction | {item.old_data?.[field] ?? 'N/A'} to {item.new_data?.[field] ?? 'N/A'} | {item.details?.reason || 'Reason not recorded'} | User {item.changed_by || 'not recorded'}
            </p>
          ))}
      </section>
    </Modal>
  )
}

export default function MeterHistory({ rows, onSaved, resetKey, canCorrect = false, canReview = false }) {
  const [editing, setEditing] = useState(null)
  useEffect(() => { setEditing(null) }, [resetKey])
  const editingRow = useMemo(() => (editing ? rows.find(r => rowKey(r) === editing) || null : null), [rows, editing])

  const columns = useMemo(() => [
    {
      id: 'vehicle', header: 'Vehicle', accessorFn: (r) => blank(r.asset_no), ...sortable,
      meta: { exportValue: (r) => r.asset_no || 'N/A' },
      cell: ({ row: { original: r } }) => (
        <div>
          <span className="font-medium text-[var(--text-primary)]">{r.asset_no}</span>
          <div className="text-xs text-[var(--text-muted)]">{r.registration_no || r.vehicle_type || 'Registration not recorded'}</div>
        </div>
      ),
    },
    {
      id: 'region', header: 'Region / site', accessorFn: (r) => blank(r.region), ...sortable,
      meta: { exportValue: (r) => `${r.region || 'Not recorded'} / ${r.site || 'Not recorded'}` },
      cell: ({ row: { original: r } }) => (
        <div>{r.region || 'Not recorded'}<div className="text-xs text-[var(--text-muted)]">{r.site || 'Site not recorded'}</div></div>
      ),
    },
    {
      id: 'value', header: 'Reading', accessorFn: (r) => (r.value == null ? undefined : Number(r.value)), ...sortable,
      meta: { align: 'right', exportValue: (r) => (r.value == null ? 'Not recorded' : `${Number(r.value)} ${r.kind}`) },
      cell: ({ row: { original: r } }) => (
        <div className="whitespace-nowrap">
          <span className="font-semibold tabular-nums">{r.value == null ? 'Not recorded' : Number(r.value).toLocaleString()} {r.kind}</span>
          {r.flagged && <div className="text-xs text-amber-600" title={r.flag_reason}>{r.reviewed ? 'Reviewed by Admin' : 'Awaiting Admin review'}</div>}
        </div>
      ),
    },
    {
      id: 'reading_date', header: 'Reading date', accessorFn: (r) => blank(r.reading_date), ...sortable,
      meta: { exportValue: (r) => readingDate(r.reading_date) },
      cell: ({ row: { original: r } }) => <span className="whitespace-nowrap">{readingDate(r.reading_date)}</span>,
    },
    {
      id: 'created_at', header: 'Received at', accessorFn: (r) => blank(r.created_at), ...sortable,
      meta: { exportValue: (r) => receivedDate(r.created_at, r.country) },
      cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-xs">{receivedDate(r.created_at, r.country)}</span>,
    },
    {
      id: 'source', header: 'Source', accessorFn: (r) => meterSource(r.source), ...sortable,
    },
    {
      id: 'edited', header: 'Last edited', accessorFn: (r) => (isEdited(r) ? r.updated_at : undefined), ...sortable,
      meta: { exportValue: (r) => (isEdited(r) ? receivedDate(r.updated_at, r.country) : 'Not edited') },
      cell: ({ row: { original: r } }) => <span className="text-xs">{isEdited(r) ? receivedDate(r.updated_at, r.country) : 'Not edited'}</span>,
    },
    {
      id: 'action', header: 'Action', enableSorting: false,
      meta: { export: false },
      cell: ({ row: { original: r } }) => {
        const canEdit = r.flagged ? canReview : canCorrect
        const key = rowKey(r)
        return canEdit
          ? <button type="button" className="btn-secondary text-xs min-h-[36px]" aria-expanded={editing === key}
              onClick={(e) => { e.stopPropagation(); setEditing(editing === key ? null : key) }}>{r.flagged ? 'Review / correct' : 'Correct / audit'}</button>
          : <span className="text-xs text-[var(--text-muted)]">{r.flagged ? 'Admin review only' : 'Correction unavailable'}</span>
      },
    },
  ], [canCorrect, canReview, editing])

  return (
    <div className="card !p-0 overflow-hidden">
      <EnterpriseTable
        columns={columns}
        data={rows}
        getRowId={rowKey}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        resetPageKey={resetKey}
        exportFileName="Meter readings"
        emptyMessage="No readings match these filters."
      />
      {editingRow && (
        <Correction row={editingRow} onCancel={() => setEditing(null)}
          onSaved={(result, kind) => { onSaved(result, kind); setEditing(null) }} />
      )}
    </div>
  )
}
