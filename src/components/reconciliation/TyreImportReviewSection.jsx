import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, RefreshCw, Undo2, AlertTriangle } from 'lucide-react'
import {
  listTyreImportReviews, resolveTyreImportReview, listTyreReplacementBatches,
  undoTyreReplacementBatch, reviewReason, REVIEW_ACTIONS,
} from '../../lib/api/tyreImportReview'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Tyre import review (admin).
 *
 * An ERP upload closes the old tyre on a wheel automatically only when the
 * evidence is clear. Anything else is HELD here instead of being guessed: the
 * uploaded tyre is shown beside the one already on the wheel and an admin picks
 *   - Fit uploaded tyre: the upload is the latest information; the old tyre is
 *     closed and the uploaded one fitted.
 *   - Record as past fitment: it really is older; it is stored as history that
 *     ended when the next recorded tyre went on.
 *   - Dismiss: a bad line.
 * The lower table lists every automatic replacement batch with an Undo.
 */
export default function TyreImportReviewSection({ activeCountry } = {}) {
  const [rows, setRows] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, b] = await Promise.all([
        listTyreImportReviews({ country: activeCountry }),
        listTyreReplacementBatches().catch(() => []),
      ])
      setRows(r)
      setBatches(b)
    } catch (e) {
      setError(toUserMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const act = useCallback(async (row, action) => {
    if (action !== 'dismiss' && !window.confirm(`${REVIEW_ACTIONS[action]} for ${row.asset_no} ${row.position}?`)) return
    setBusy(row.id)
    setMessage(null)
    try {
      await resolveTyreImportReview(row.id, action)
      setMessage({ tone: 'good', text: `${row.asset_no} ${row.position}: ${REVIEW_ACTIONS[action]}.` })
      await load()
    } catch (e) {
      setMessage({ tone: 'warn', text: toUserMessage(e) })
    } finally {
      setBusy(null)
    }
  }, [load])

  const undo = useCallback(async (b) => {
    if (!window.confirm(`Undo ${b.rows_closed} automatic tyre closure(s) from ${formatDate(b.last_at)}?`)) return
    setBusy(b.batch_id)
    try {
      const res = await undoTyreReplacementBatch(b.batch_id)
      setMessage({ tone: 'good', text: `Restored ${res?.restored ?? 0}. Skipped ${res?.skipped ?? 0} because the wheel has since received another tyre.` })
      await load()
    } catch (e) {
      setMessage({ tone: 'warn', text: toUserMessage(e) })
    } finally {
      setBusy(null)
    }
  }, [load])

  const columns = useMemo(() => [
    { id: 'wheel', header: 'Wheel', accessorFn: (r) => `${r.asset_no || ''} ${r.position || ''}`, size: 140,
      cell: ({ row: { original: r } }) => <span className="font-medium text-[var(--text-primary)]">{r.asset_no || 'N/A'} <span className="text-[var(--text-muted)]">{r.position || ''}</span></span> },
    { id: 'uploaded', header: 'Uploaded tyre', accessorFn: (r) => r.serial_no || '', size: 200,
      cell: ({ row: { original: r } }) => (
        <span className="text-[var(--text-secondary)]">{r.serial_no || 'No serial'}
          <span className="ml-2 text-xs text-[var(--text-muted)]">fitted {r.fitment_date || 'N/A'}{r.fitment_km ? `, ${Number(r.fitment_km).toLocaleString()} km` : ''}</span>
        </span>
      ) },
    { id: 'current', header: 'Tyre on the wheel now', accessorFn: (r) => r.current_serial || '', size: 200,
      cell: ({ row: { original: r } }) => (
        <span className="text-[var(--text-secondary)]">{r.current_serial || 'Not linked'}
          {r.current_fitment_date ? <span className="ml-2 text-xs text-[var(--text-muted)]">fitted {formatDate(r.current_fitment_date)}</span> : null}
        </span>
      ) },
    { id: 'reason', header: 'Why it is held', accessorFn: (r) => reviewReason(r.reason), size: 240, meta: { filterVariant: 'select' } },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 80, meta: { filterVariant: 'select' } },
    { id: 'actions', header: '', enableSorting: false, size: 300,
      cell: ({ row: { original: r } }) => (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(REVIEW_ACTIONS).map(([key, label]) => (
            <button key={key} type="button" disabled={busy === r.id}
              onClick={() => act(r, key)}
              className="px-2 py-1 text-[11px] rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 min-h-[32px]">
              {label}
            </button>
          ))}
        </div>
      ) },
  ], [act, busy])

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 text-[var(--text-primary)]">
            <ClipboardCheck size={17} /> Tyre uploads waiting for a decision
          </h3>
          <p className="text-xs mt-1 text-[var(--text-secondary)] max-w-3xl">
            An upload replaces the tyre on a wheel automatically when the dates are clear. These rows were not clear,
            so they were held instead of guessed. Nothing below has changed the tyre records yet.
          </p>
        </div>
        <button type="button" onClick={load}
          className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5 border border-[var(--border-bright)] text-[var(--text-secondary)]">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {message ? (
        <p className={`text-xs mb-3 ${message.tone === 'warn' ? 'text-amber-500' : 'text-emerald-500'}`}>{message.text}</p>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 text-sm text-amber-500 py-4">
          <AlertTriangle size={15} /> {error}
          <button type="button" onClick={load} className="underline min-h-[44px]">Try again</button>
        </div>
      ) : loading ? (
        <p className="text-sm py-6 text-center text-[var(--text-dim)]">Loading held tyre uploads...</p>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={rows}
          getRowId={(r) => String(r.id)}
          searchPlaceholder="Search asset or serial..."
          initialPageSize={25}
          exportFileName="Tyre uploads waiting for a decision"
          emptyMessage="Nothing is waiting. Every uploaded tyre was placed automatically."
        />
      )}

      {batches.length ? (
        <div className="mt-6">
          <h4 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">Automatic replacements (undo available)</h4>
          <div className="overflow-x-auto">
            <EnterpriseTable
              columns={[
                { id: 'when', header: 'When', accessorFn: (b) => b.last_at, cell: ({ row: { original: b } }) => formatDate(b.last_at) },
                { id: 'source', header: 'Source', accessorFn: (b) => b.source },
                { id: 'country', header: 'Country', accessorFn: (b) => b.country || 'N/A' },
                { id: 'rows', header: 'Old tyres closed', accessorFn: (b) => b.rows_closed, meta: { align: 'right' } },
                { id: 'undone', header: 'Undone', accessorFn: (b) => b.rows_undone, meta: { align: 'right' } },
                { id: 'undo', header: '', enableSorting: false,
                  cell: ({ row: { original: b } }) => (
                    <button type="button" disabled={busy === b.batch_id || b.rows_undone >= b.rows_closed}
                      onClick={() => undo(b)}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] flex items-center gap-1 disabled:opacity-40 min-h-[32px]">
                      <Undo2 size={12} /> Undo
                    </button>
                  ) },
              ]}
              data={batches}
              getRowId={(b) => `${b.batch_id}|${b.source}`}
              enableColumnFilters={false}
              initialPageSize={10}
              exportFileName="Automatic tyre replacements"
              emptyMessage="No automatic replacements yet."
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
