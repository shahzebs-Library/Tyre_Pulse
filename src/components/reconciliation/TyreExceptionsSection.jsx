import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListChecks, RefreshCw, Download, AlertTriangle, Lock } from 'lucide-react'
import { getTyreExceptionsV2, getAllTyreExceptionsV2, setTyreExceptionReview } from '../../lib/api/tyreExceptions'
import {
  EXCEPTION_KINDS, KIND_BY_ID, REVIEW_STATUSES, REVIEW_STATUS_LABEL, EXPORT_COLUMNS,
  shapeCounts, countTotals, shapeRows, impactLabel, canReviewExceptions, rowReviewable, exportRows,
} from '../../lib/tyreExceptionsV2'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { useAuth } from '../../contexts/AuthContext'
import { useSettings } from '../../contexts/SettingsContext'
import EnterpriseTable from '../ui/EnterpriseTable'
import Modal from '../ui/Modal'

const PAGE_SIZE = 100
const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const GROUPS = ['Identity', 'Readings', 'Cost']
const STATUS_TONE = {
  open: 'var(--text-secondary)', accepted: '#22c55e', rejected: '#ef4444', deferred: '#f59e0b',
}

const fmt = (n) => (n == null ? 'N/A' : Number(n).toLocaleString('en-US'))
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '')

/**
 * Tyre exceptions: every outstanding tyre data problem (identity, readings,
 * cost) with the records behind it, why it is a problem, a PROPOSED correction
 * and its expected impact. A reviewer records accepted / rejected / deferred
 * with a note; that writes only the review tables. Nothing in the tyre
 * register or the expense grid is changed from here. Protected items (the 20
 * unclear tyre changes and K507B403860) stay open until the owner decides.
 */
export default function TyreExceptionsSection() {
  const { profile, isSuperAdmin } = useAuth() || {}
  const { activeCountry } = useSettings() || {}
  const canReview = canReviewExceptions({ role: profile?.role, isSuperAdmin })

  const [country, setCountry] = useState(activeCountry && activeCountry !== 'All' ? activeCountry : '')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [counts, setCounts] = useState(null)
  const [countsError, setCountsError] = useState(null)
  const [rotationAvailable, setRotationAvailable] = useState(true)
  const [page, setPage] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState(null)

  // Counts: every kind for the chosen country (the slow, full read; once per country).
  const loadCounts = useCallback(async () => {
    setCountsError(null)
    try {
      const res = await getTyreExceptionsV2({ country, limit: 1, offset: 0 })
      setCounts(shapeCounts(res.counts))
      setRotationAvailable(res.rotation_available !== false)
    } catch (e) {
      setCounts(null)
      setCountsError(toUserMessage(e))
    }
  }, [country])

  const loadPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getTyreExceptionsV2({ country, kind, status, limit: PAGE_SIZE, offset })
      setPage({ rows: shapeRows(res.rows), total: Number(res.total ?? 0) })
    } catch (e) {
      setPage({ rows: [], total: 0 })
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [country, kind, status, offset])

  useEffect(() => { loadCounts() }, [loadCounts])
  useEffect(() => { loadPage() }, [loadPage])

  const totals = useMemo(() => countTotals(counts), [counts])
  const refresh = () => { loadCounts(); loadPage() }
  const pick = (setter) => (value) => { setter(value); setOffset(0) }

  const runExport = async () => {
    setExporting(true)
    setNotice(null)
    try {
      const { rows, truncated, total } = await getAllTyreExceptionsV2({ country, kind, status })
      const shaped = exportRows(shapeRows(rows))
      await exportToExcel(shaped, EXPORT_COLUMNS.map((c) => c[0]), EXPORT_COLUMNS.map((c) => c[1]),
        reportFileName('Tyre exceptions', country || 'All countries'))
      if (truncated) setNotice(`Exported the first ${fmt(shaped.length)} of ${fmt(total)} exceptions. Narrow the filter for the rest.`)
    } catch (e) {
      setNotice(toUserMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo(() => {
    const cols = [
      { id: 'kind', header: 'Exception', accessorFn: (r) => r.kindLabel, size: 190,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1">
            {row.original.protected && <Lock className="w-3.5 h-3.5 text-amber-400" aria-label="Protected" />}
            {row.original.kindLabel}
          </span>
        ) },
      { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 80 },
      { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset || 'N/A', size: 110 },
      { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial || 'N/A', size: 140 },
      { id: 'position', header: 'Position', accessorFn: (r) => r.position || '', size: 80 },
      { id: 'reason', header: 'Reason', accessorFn: (r) => r.reason, size: 280 },
      { id: 'proposed', header: 'Proposed correction (not applied)', accessorFn: (r) => r.proposed, size: 280 },
      { id: 'impact', header: 'Expected impact', accessorFn: (r) => impactLabel(r), size: 130 },
      { id: 'status', header: 'Review', accessorFn: (r) => r.statusLabel, size: 170,
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="text-xs">
              <span style={{ color: STATUS_TONE[r.status] }} className="font-medium">{r.statusLabel}</span>
              {r.protected && <div className="text-amber-400">Owner decision needed</div>}
              {r.reviewedBy && <div style={{ color: 'var(--text-dim)' }}>{r.reviewedBy} {fmtDate(r.reviewedAt)}</div>}
              {r.note && <div style={{ color: 'var(--text-secondary)' }} title={r.note}>{r.note.length > 60 ? `${r.note.slice(0, 60)}...` : r.note}</div>}
            </div>
          )
        } },
    ]
    if (canReview) {
      cols.push({ id: 'actions', header: '', size: 90, enableSorting: false,
        cell: ({ row }) => (rowReviewable(row.original, { role: profile?.role, isSuperAdmin })
          ? <button type="button" className="btn-secondary min-h-[36px] text-xs" onClick={() => setReviewing(row.original)}>Review</button>
          : null) })
    }
    return cols
  }, [canReview, profile?.role, isSuperAdmin])

  return (
    <div className="card p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3">
          <ListChecks className="w-5 h-5 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Tyre exceptions</h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Every outstanding tyre data problem with the records behind it, a proposed correction and its expected impact.
              Reviews are recorded here; nothing in the tyre register or the expense grid is changed from this page.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refresh} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button type="button" onClick={runExport} disabled={exporting || !page.total}
            className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> {exporting ? 'Preparing...' : 'Excel'}
          </button>
        </div>
      </div>

      {/* Counts per kind */}
      {countsError ? (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 mb-3 flex items-center gap-2 border border-red-800/50 bg-red-950/20">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="flex-1 text-[var(--text-primary)]">Counts could not be read: {countsError}</span>
          <button type="button" onClick={loadCounts} className="btn-secondary min-h-[44px] text-xs">Retry</button>
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {totals ? `${fmt(totals.total)} exceptions, ${fmt(totals.open)} open, ${fmt(totals.accepted)} accepted, ${fmt(totals.rejected)} rejected, ${fmt(totals.deferred)} deferred, ${fmt(totals.protected)} protected.` : 'Counting exceptions...'}
          </div>
          {GROUPS.map((g) => (
            <div key={g} className="flex flex-wrap gap-2 items-center">
              <span className="text-xs w-16 shrink-0" style={{ color: 'var(--text-dim)' }}>{g}</span>
              {EXCEPTION_KINDS.filter((k) => k.group === g).map((k) => {
                const c = counts?.[k.kind]
                const by = c ? Object.entries(c.byCountry).map(([ct, n]) => `${ct} ${n}`).join(', ') : ''
                return (
                  <button key={k.kind} type="button" onClick={() => pick(setKind)(kind === k.kind ? '' : k.kind)}
                    aria-pressed={kind === k.kind} title={`${k.rule}${by ? ` (${by})` : ''}`}
                    className={`text-xs rounded-full px-3 py-1 min-h-[32px] ${kind === k.kind ? 'ring-1 ring-[var(--accent)]' : ''}`}
                    style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
                    {k.label}: {c ? `${fmt(c.total)} (${fmt(c.open)} open)` : '...'}
                  </button>
                )
              })}
            </div>
          ))}
          {!rotationAvailable && (
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              Rotations not closed: the rotation closer dry run needs a manager, director or admin, so that list is not shown to you.
            </p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select aria-label="Country" value={country} onChange={(e) => pick(setCountry)(e.target.value)} className="input text-sm min-h-[44px]">
          <option value="">All countries</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Exception kind" value={kind} onChange={(e) => pick(setKind)(e.target.value)} className="input text-sm min-h-[44px]">
          <option value="">All kinds</option>
          {EXCEPTION_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <select aria-label="Review status" value={status} onChange={(e) => pick(setStatus)(e.target.value)} className="input text-sm min-h-[44px]">
          <option value="">Any review status</option>
          {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{REVIEW_STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {kind && KIND_BY_ID[kind] && (
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>Rule: {KIND_BY_ID[kind].rule}</p>
      )}
      {notice && (
        <div role="status" className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>{notice}</div>
      )}

      {error && (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 mb-3 flex items-center gap-2 border border-red-800/50 bg-red-950/20">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="flex-1 text-[var(--text-primary)]">{error}</span>
          <button type="button" onClick={loadPage} className="btn-secondary min-h-[44px] text-xs">Retry</button>
        </div>
      )}

      {loading ? (
        <div role="status" className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Checking tyre records...</div>
      ) : error ? null : !page.rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          {kind || status || country ? 'No exception matches these filters.' : 'No tyre exceptions in this scope.'}
        </div>
      ) : (
        <>
          <EnterpriseTable columns={columns} data={page.rows} getRowId={(r) => r.key}
            enableKeyboard={false} emptyMessage="No exception matches that filter."
            manualPagination pageIndex={Math.floor(offset / PAGE_SIZE)} pageCount={Math.max(1, Math.ceil(page.total / PAGE_SIZE))}
            totalRows={page.total} pageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE]}
            onPageChange={(i) => setOffset(Math.max(0, i) * PAGE_SIZE)}
            exportFileName={reportFileName('Tyre exceptions page')} reportMeta={{ title: 'Tyre exceptions' }} />
        </>
      )}

      {reviewing && (
        <ReviewModal row={reviewing} onClose={() => setReviewing(null)}
          onSaved={() => { setReviewing(null); refresh() }} />
      )}
    </div>
  )
}

function ReviewModal({ row, onClose, onSaved }) {
  const [status, setStatus] = useState(row.status === 'open' ? 'accepted' : row.status)
  const [note, setNote] = useState(row.note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await setTyreExceptionReview({ key: row.key, kind: row.kind, country: row.country, status, note })
      onSaved()
    } catch (e) {
      setErr(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Review tyre exception" subtitle={`${row.kindLabel}: ${row.asset || row.serial || row.key}`} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary min-h-[44px]">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary min-h-[44px]">{busy ? 'Saving...' : 'Save review'}</button>
        </div>
      )}>
      <div className="space-y-3 text-sm">
        <p style={{ color: 'var(--text-secondary)' }}>{row.reason}</p>
        <p style={{ color: 'var(--text-secondary)' }}><strong>Proposed:</strong> {row.proposed}</p>
        <p style={{ color: 'var(--text-dim)' }}>Expected impact: {impactLabel(row)}. Saving records your decision only; the correction itself is made by a person in the tyre register.</p>
        <fieldset>
          <legend className="text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Decision</legend>
          <div className="flex flex-wrap gap-3">
            {REVIEW_STATUSES.map((s) => (
              <label key={s} className="inline-flex items-center gap-1 min-h-[44px]">
                <input type="radio" name="review-status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                {REVIEW_STATUS_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className="input w-full mt-1" />
        </label>
        {err && <div role="alert" className="text-red-400">{err}</div>}
      </div>
    </Modal>
  )
}
