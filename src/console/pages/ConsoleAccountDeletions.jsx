/**
 * ConsoleAccountDeletions - admin queue for account & data deletion requests
 * (V317 table `account_deletion_requests`).
 *
 * Users file a self-service "Delete my account" request from the app; an
 * Admin / super-admin works the queue here: filter by status, review the
 * requester email + reason + when it was raised, and advance each request
 * pending -> processing -> completed / rejected.
 *
 * IMPORTANT: this RECORDS the resolution status only. It does NOT itself delete
 * auth/user/business data - actual deletion stays a verified, human-driven
 * back-office process. RLS (V317) restricts every read/update to Admin/super
 * within their own organisation. No raw Supabase errors reach the UI; no
 * em/en dashes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  UserX, RefreshCw, AlertTriangle, Loader2, Mail, Clock, Filter,
  Play, CheckCircle2, XCircle, Inbox,
} from 'lucide-react'
import {
  listDeletionRequests, setDeletionRequestStatus, DELETION_STATUSES,
} from '../../lib/api/accountDeletion'
import { toUserMessage } from '../../lib/safeError'

const STATUS_META = {
  pending:    { label: 'Pending',    cls: 'text-amber-300 border-amber-800/50 bg-amber-900/20' },
  processing: { label: 'Processing', cls: 'text-sky-300 border-sky-800/50 bg-sky-900/20' },
  completed:  { label: 'Completed',  cls: 'text-green-300 border-green-800/50 bg-green-900/20' },
  rejected:   { label: 'Rejected',   cls: 'text-red-300 border-red-800/50 bg-red-900/20' },
}

const FILTERS = ['all', ...DELETION_STATUSES]

const fmtDateTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || { label: status || 'N/A', cls: 'text-gray-400 border-gray-700 bg-gray-800/50' }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${meta.cls}`}>
      {meta.label.toUpperCase()}
    </span>
  )
}

export default function ConsoleAccountDeletions() {
  const [rows, setRows]         = useState([])
  const [filter, setFilter]     = useState('all')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [busyId, setBusyId]     = useState(null)   // row being advanced
  const [confirm, setConfirm]   = useState(null)   // { id, status, email }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listDeletionRequests(
        filter === 'all' ? {} : { status: filter },
      )
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load deletion requests.'))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // KPI counts are computed over the current result set. When a status filter
  // is active we still show that slice honestly rather than faking totals.
  const counts = useMemo(() => {
    const c = { total: rows.length, pending: 0, processing: 0, completed: 0, rejected: 0 }
    rows.forEach((r) => { if (c[r.status] != null) c[r.status] += 1 })
    return c
  }, [rows])

  async function advance(id, status) {
    setBusyId(id); setError('')
    try {
      const updated = await setDeletionRequestStatus(id, status)
      // Reflect the change in place; drop it if it no longer matches the filter.
      setRows((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, ...updated } : r))
        return filter === 'all' ? next : next.filter((r) => r.status === filter)
      })
    } catch (e) {
      setError(toUserMessage(e, 'Could not update the request.'))
    } finally {
      setBusyId(null); setConfirm(null)
    }
  }

  const KPIS = [
    { key: 'total',      label: 'Total',      value: counts.total,      cls: 'text-white' },
    { key: 'pending',    label: 'Pending',    value: counts.pending,    cls: 'text-amber-300' },
    { key: 'processing', label: 'Processing', value: counts.processing, cls: 'text-sky-300' },
    { key: 'completed',  label: 'Completed',  value: counts.completed,  cls: 'text-green-300' },
    { key: 'rejected',   label: 'Rejected',   value: counts.rejected,   cls: 'text-red-300' },
  ]

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <UserX size={18} className="text-orange-400" /> Account Deletions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Work the account and data deletion request queue for your organisation.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
        <AlertTriangle size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-200">Advancing a request records its resolution status only. Actual account and data deletion remains a verified, manual back-office step.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {KPIS.map((k) => (
          <div key={k.key} className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-600">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.cls}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] text-gray-500 mr-1">
          <Filter size={12} /> Status
        </span>
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-lg text-[11px] border capitalize ${
              filter === f
                ? 'bg-orange-600 border-orange-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center gap-2">
          <Inbox size={13} className="text-gray-500" /> Requests
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-14">
            {filter === 'all' ? 'No deletion requests.' : `No ${filter} requests.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800/60">
                  <th className="px-4 py-2 font-semibold">Requester</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                  <th className="px-4 py-2 font-semibold">Requested</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {rows.map((r) => {
                  const rowBusy = busyId === r.id
                  return (
                    <tr key={r.id} className="hover:bg-black/20 align-top">
                      <td className="px-4 py-2.5 text-gray-200 font-medium">
                        <span className="flex items-center gap-1.5">
                          <Mail size={11} className="text-gray-500 flex-shrink-0" />
                          {r.email || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 max-w-[240px] truncate" title={r.reason || ''}>
                        {r.reason || 'N/A'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {fmtDateTime(r.requested_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {rowBusy ? (
                            <Loader2 size={13} className="animate-spin text-orange-400" />
                          ) : (
                            <>
                              {(r.status === 'pending') && (
                                <button onClick={() => setConfirm({ id: r.id, status: 'processing', email: r.email })}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-sky-200 bg-sky-900/30 border border-sky-800/50 hover:bg-sky-900/50">
                                  <Play size={10} /> Start
                                </button>
                              )}
                              {(r.status === 'pending' || r.status === 'processing') && (
                                <>
                                  <button onClick={() => setConfirm({ id: r.id, status: 'completed', email: r.email })}
                                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-green-200 bg-green-900/30 border border-green-800/50 hover:bg-green-900/50">
                                    <CheckCircle2 size={10} /> Complete
                                  </button>
                                  <button onClick={() => setConfirm({ id: r.id, status: 'rejected', email: r.email })}
                                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-red-200 bg-red-900/30 border border-red-800/50 hover:bg-red-900/50">
                                    <XCircle size={10} /> Reject
                                  </button>
                                </>
                              )}
                              {(r.status === 'completed' || r.status === 'rejected') && (
                                <span className="text-[10px] text-gray-600">Resolved {fmtDateTime(r.processed_at)}</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => busyId ? null : setConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle size={15} className="text-orange-400" />
              {confirm.status === 'processing' && 'Start processing?'}
              {confirm.status === 'completed' && 'Mark completed?'}
              {confirm.status === 'rejected' && 'Reject request?'}
            </h3>
            <p className="text-xs text-gray-400 mt-2">
              Set the request from <span className="text-gray-200 font-medium">{confirm.email || 'this user'}</span> to
              {' '}<span className="text-gray-200 font-semibold capitalize">{confirm.status}</span>.
              {confirm.status === 'completed' && ' Confirm the account and its data have been deleted per your process.'}
              {confirm.status === 'rejected' && ' The requester will remain active.'}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfirm(null)} disabled={busyId != null}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 disabled:opacity-40">
                Cancel
              </button>
              <button onClick={() => advance(confirm.id, confirm.status)} disabled={busyId != null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {busyId != null ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
