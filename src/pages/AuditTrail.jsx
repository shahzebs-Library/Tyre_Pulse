import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { exportToExcel } from '../lib/exportUtils'
import { useAuth } from '../contexts/AuthContext'
import { logAuditEvent } from '../lib/auditLogger'
import { formatDateTime, formatDate } from '../lib/formatters'
import {
  FileSpreadsheet, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search,
} from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'

const PAGE_SIZE = 50

const ACTION_BADGE = {
  UPLOAD: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  CREATE: 'bg-green-900/50 text-green-300 border-green-700/50',
  UPDATE: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  DELETE: 'bg-red-900/50 text-red-300 border-red-700/50',
  EDIT:   'bg-amber-900/50 text-amber-300 border-amber-700/50',
  EXPORT: 'bg-green-900/50 text-green-300 border-green-700/50',
}

function nonEmpty(obj) {
  return obj && typeof obj === 'object' && Object.keys(obj).length > 0
}

function hasExpandable(row) {
  return nonEmpty(row.details) || nonEmpty(row.old_values) || nonEmpty(row.new_values)
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return String(v) } }
  return String(v)
}

function AuditChangeDetail({ row }) {
  const oldV = nonEmpty(row.old_values) ? row.old_values : null
  const newRaw = nonEmpty(row.new_values) ? row.new_values : null
  const meta = newRaw?._meta
  const newV = newRaw
    ? Object.fromEntries(Object.entries(newRaw).filter(([k]) => k !== '_meta'))
    : null
  const fields = [...new Set([...Object.keys(oldV || {}), ...Object.keys(newV || {})])]

  return (
    <div className="space-y-2">
      {fields.length > 0 && (
        <table className="text-xs w-full max-w-3xl">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-medium py-1 pr-4">Field</th>
              <th className="text-left font-medium py-1 pr-4">Old value</th>
              <th className="text-left font-medium py-1">New value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <tr key={f} className="border-t border-gray-800">
                <td className="py-1 pr-4 text-gray-400 font-medium whitespace-nowrap">{f}</td>
                <td className="py-1 pr-4 text-red-300/80 break-all">{fmtVal(oldV?.[f])}</td>
                <td className="py-1 text-green-300/80 break-all">{fmtVal(newV?.[f])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nonEmpty(meta) && (
        <pre className="text-xs text-gray-400 bg-gray-800/60 rounded p-3 overflow-auto max-h-40">
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
      {nonEmpty(row.details) && (
        <pre className="text-xs text-gray-400 bg-gray-800/60 rounded p-3 overflow-auto max-h-40">
          {JSON.stringify(row.details, null, 2)}
        </pre>
      )}
      {fields.length === 0 && !nonEmpty(meta) && !nonEmpty(row.details) && (
        <p className="text-xs text-gray-500">No change detail recorded.</p>
      )}
    </div>
  )
}

function SummarySkeleton() {
  return <div className="animate-pulse bg-gray-800/40 rounded h-8 w-24" />
}

function SummaryCard({ label, value, color, loading }) {
  const colors = {
    blue:   'text-blue-400 border-blue-800 bg-blue-900/20',
    green:  'text-green-400 border-green-800 bg-green-900/20',
    purple: 'text-purple-400 border-purple-800 bg-purple-900/20',
    amber:  'text-amber-400 border-amber-800 bg-amber-900/20',
  }
  return (
    <div className={`card border ${colors[color]}`}>
      {loading ? (
        <SummarySkeleton />
      ) : (
        <p className={`text-3xl font-bold ${colors[color].split(' ')[0]}`}>{value ?? 0}</p>
      )}
      <p className="text-sm mt-1 text-gray-400">{label}</p>
    </div>
  )
}

export default function AuditTrail() {
  const reportMeta = useReportMeta('Audit Trail')
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('audit')

  const [stats, setStats] = useState({ totalEvents: 0, uploadsMonth: 0, recordsMonth: 0, activeUsers: 0 })
  const [statsLoading, setStatsLoading] = useState(true)

  const [auditRows, setAuditRows]   = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage]   = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [expandedRow, setExpandedRow]   = useState(null)
  const [auditSearch, setAuditSearch]   = useState('')

  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter]     = useState('')
  const [userOptions, setUserOptions]   = useState([])

  const [uploadRows, setUploadRows]   = useState([])
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadPage, setUploadPage]   = useState(0)
  const [uploadLoading, setUploadLoading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    async function loadStats() {
      setStatsLoading(true)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        const [totalRes, monthRes, activeRes] = await Promise.all([
          supabase.from('audit_log_v2').select('id', { count: 'exact', head: true }),
          supabase.from('audit_log_v2').select('record_count').eq('action', 'UPLOAD').gte('created_at', monthStart),
          supabase.from('audit_log_v2').select('user_id').gte('created_at', thirtyDaysAgo),
        ])

        const uploadsMonth  = (monthRes.data ?? []).length
        const recordsMonth  = (monthRes.data ?? []).reduce((s, r) => s + (r.record_count ?? 0), 0)
        const activeUsers   = new Set((activeRes.data ?? []).map(r => r.user_id).filter(Boolean)).size

        setStats({ totalEvents: totalRes.count ?? 0, uploadsMonth, recordsMonth, activeUsers })
      } catch { /* ignore */ }
      setStatsLoading(false)
    }
    loadStats()
  }, [])

  useEffect(() => {
    async function loadUsers() {
      const { data } = await supabase.from('profiles').select('id, full_name, username')
      setUserOptions(data ?? [])
    }
    loadUsers()
  }, [])

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      let q = supabase
        .from('audit_log_v2')
        .select('*, profiles(full_name, username)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE - 1)

      if (dateFrom)      q = q.gte('created_at', dateFrom)
      if (dateTo)        q = q.lte('created_at', dateTo + 'T23:59:59')
      if (actionFilter)  q = q.eq('action', actionFilter)
      if (userFilter)    q = q.eq('user_id', userFilter)

      const { data, count } = await q
      setAuditRows(data ?? [])
      setAuditTotal(count ?? 0)
    } catch { /* ignore */ }
    setAuditLoading(false)
  }, [auditPage, dateFrom, dateTo, actionFilter, userFilter])

  useEffect(() => { if (activeTab === 'audit') loadAudit() }, [loadAudit, activeTab])

  const loadUploadHistory = useCallback(async () => {
    setUploadLoading(true)
    try {
      const { data, count } = await supabase
        .from('upload_history')
        .select('*, profiles(full_name, username)', { count: 'exact' })
        .order('uploaded_at', { ascending: false })
        .range(uploadPage * PAGE_SIZE, (uploadPage + 1) * PAGE_SIZE - 1)

      setUploadRows(data ?? [])
      setUploadTotal(count ?? 0)
    } catch { /* ignore */ }
    setUploadLoading(false)
  }, [uploadPage])

  useEffect(() => { if (activeTab === 'upload') loadUploadHistory() }, [loadUploadHistory, activeTab])

  async function exportAuditLog() {
    const { data } = await supabase
      .from('audit_log_v2')
      .select('*, profiles(full_name, username)')
      .order('created_at', { ascending: false })
      .limit(5000)

    const rows = (data ?? []).map(r => ({
      timestamp:  r.created_at ? formatDateTime(r.created_at) : '',
      user:       r.profiles?.full_name ?? r.profiles?.username ?? r.user_id ?? '',
      action:     r.action ?? '',
      table_name: r.table_name ?? '',
      records:    r.record_count ?? '',
      details:    r.details ? JSON.stringify(r.details) : '',
    }))

    exportToExcel(
      rows,
      ['timestamp', 'user', 'action', 'table_name', 'records', 'details'],
      ['Timestamp', 'User', 'Action', 'Table', 'Records', 'Details'],
      `TyrePulse_AuditLog_${new Date().toISOString().slice(0, 10)}`,
      'Audit Log'
    )
  }

  async function exportUploadHistory() {
    const { data } = await supabase
      .from('upload_history')
      .select('*, profiles(full_name, username)')
      .order('uploaded_at', { ascending: false })
      .limit(5000)

    const rows = (data ?? []).map(r => ({
      file_names:      Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? ''),
      records_added:   r.records_added ?? 0,
      records_skipped: r.records_skipped ?? 0,
      uploaded_by:     r.profiles?.full_name ?? r.profiles?.username ?? r.uploaded_by ?? '',
      uploaded_at:     r.uploaded_at ? formatDateTime(r.uploaded_at) : '',
      region:          r.region ?? '',
    }))

    exportToExcel(
      rows,
      ['file_names', 'records_added', 'records_skipped', 'uploaded_by', 'uploaded_at', 'region'],
      ['File Names', 'Records Added', 'Records Skipped', 'Uploaded By', 'Uploaded At', 'Region'],
      `TyrePulse_UploadHistory_${new Date().toISOString().slice(0, 10)}`,
      'Upload History'
    )
  }

  async function handleDeleteBatch() {
    if (deleteConfirm !== 'DELETE') return
    setDeleting(true)
    setDeleteError('')
    try {
      const { data: delRows, error: recErr } = await supabase
        .from('tyre_records').delete().eq('upload_batch_id', deleteTarget.batchId).select('id')
      if (recErr) throw recErr
      const removed = delRows?.length ?? 0

      const { data: histRows, error: histErr } = await supabase
        .from('upload_history').delete().eq('batch_id', deleteTarget.batchId).select('id')
      if (histErr) throw histErr
      if ((histRows?.length ?? 0) === 0 && removed === 0) {
        throw new Error('Nothing to delete: this batch has no records and no history entry (it may already be removed).')
      }

      await logAuditEvent({ action: 'batch_delete', table_name: 'tyre_records', record_count: removed, details: { batch_id: deleteTarget.batchId } })
      setDeleteTarget(null)
      setDeleteConfirm('')
      loadUploadHistory()
    } catch (e) {
      setDeleteError(e.message || 'Delete failed. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const auditPages  = Math.ceil(auditTotal  / PAGE_SIZE)
  const uploadPages = Math.ceil(uploadTotal / PAGE_SIZE)

  const searchTerm = auditSearch.trim().toLowerCase()
  const visibleAuditRows = searchTerm
    ? auditRows.filter(row => {
        const userName = (row.profiles?.full_name ?? row.profiles?.username ?? '').toLowerCase()
        const action   = (row.action ?? '').toLowerCase()
        const table    = (row.table_name ?? '').toLowerCase()
        return userName.includes(searchTerm) || action.includes(searchTerm) || table.includes(searchTerm)
      })
    : auditRows

  // EnterpriseTable columns for audit log
  const auditColumns = useMemo(() => [
    {
      id: 'created_at',
      header: 'Timestamp',
      accessorFn: r => r.created_at ? formatDateTime(r.created_at) : '-',
      size: 160,
      cell: ({ getValue }) => <span className="text-gray-400 text-xs whitespace-nowrap">{getValue()}</span>,
    },
    {
      id: 'user',
      header: 'User',
      accessorFn: r => r.profiles?.full_name ?? r.profiles?.username ?? 'Unknown',
      size: 140,
      cell: ({ getValue, row }) => row.original.profiles?.full_name || row.original.profiles?.username
        ? <span className="text-gray-200">{getValue()}</span>
        : <span className="text-gray-600">Unknown</span>,
    },
    {
      id: 'action',
      header: 'Action',
      accessorFn: r => r.action ?? '-',
      size: 100,
      cell: ({ getValue }) => {
        const val = getValue()
        return val !== '-' ? (
          <span className={`badge border ${ACTION_BADGE[val] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>{val}</span>
        ) : '-'
      },
    },
    { id: 'table_name', header: 'Table', accessorFn: r => r.table_name ?? '-', size: 120 },
    {
      id: 'record_count',
      header: 'Records',
      accessorFn: r => r.record_count ?? '-',
      size: 80,
      meta: { align: 'right' },
    },
    {
      id: 'details',
      header: 'Details',
      accessorFn: r => hasExpandable(r) ? 'expand' : '-',
      size: 80,
      enableSorting: false,
      meta: { export: false },
      cell: ({ row }) => hasExpandable(row.original) ? (
        <button
          onClick={() => setExpandedRow(expandedRow === row.original.id ? null : row.original.id)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {expandedRow === row.original.id ? 'Hide' : 'Show'}
        </button>
      ) : <span className="text-gray-700">-</span>,
    },
  ], [expandedRow])

  // EnterpriseTable columns for upload history
  const uploadColumns = useMemo(() => {
    const cols = [
      {
        id: 'file_names',
        header: 'File Names',
        accessorFn: r => Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? '-'),
        size: 200,
        cell: ({ getValue }) => <span className="text-gray-200 max-w-xs truncate block">{getValue()}</span>,
      },
      {
        id: 'records_added',
        header: 'Records Added',
        accessorFn: r => r.records_added ?? 0,
        size: 100,
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="text-green-400 font-medium">{getValue().toLocaleString()}</span>,
      },
      {
        id: 'records_skipped',
        header: 'Records Skipped',
        accessorFn: r => r.records_skipped ?? 0,
        size: 100,
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="text-amber-400">{getValue().toLocaleString()}</span>,
      },
      {
        id: 'uploaded_by',
        header: 'Uploaded By',
        accessorFn: r => r.profiles?.full_name ?? r.profiles?.username ?? 'Unknown',
        size: 140,
      },
      {
        id: 'uploaded_at',
        header: 'Uploaded At',
        accessorFn: r => r.uploaded_at ? formatDateTime(r.uploaded_at) : '-',
        size: 160,
        cell: ({ getValue }) => <span className="text-gray-400 text-xs whitespace-nowrap">{getValue()}</span>,
      },
      { id: 'region', header: 'Region', accessorFn: r => r.region ?? '-', size: 100 },
    ]
    if (profile?.role === 'Admin') {
      cols.push({
        id: 'delete',
        header: 'Delete Batch',
        accessorFn: r => r.batch_id ?? '',
        size: 120,
        enableSorting: false,
        meta: { export: false },
        cell: ({ row }) => row.original.batch_id ? (
          <button
            onClick={() => setDeleteTarget({ batchId: row.original.batch_id, count: row.original.records_added, date: row.original.uploaded_at })}
            className="text-xs text-red-400 border border-red-800/50 hover:bg-red-900/20 px-2 py-1 rounded transition-colors"
          >
            Delete Batch
          </button>
        ) : <span className="text-gray-700 text-xs">-</span>,
      })
    }
    return cols
  }, [profile?.role])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Trail"
        subtitle="Full history of uploads and user activity"
        icon={ClipboardList}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Events"             value={stats.totalEvents.toLocaleString()}  color="blue"   loading={statsLoading} />
        <SummaryCard label="Uploads This Month"       value={stats.uploadsMonth.toLocaleString()}  color="green"  loading={statsLoading} />
        <SummaryCard label="Records Added This Month" value={stats.recordsMonth.toLocaleString()}  color="purple" loading={statsLoading} />
        <SummaryCard label="Active Users (30 days)"   value={stats.activeUsers.toLocaleString()}   color="amber"  loading={statsLoading} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {[
          { id: 'audit',  label: 'Audit Log' },
          { id: 'upload', label: 'Upload History' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Audit Log tab ─────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="card">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="label">Date From</label>
                <input type="date" className="input" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setAuditPage(0) }} />
              </div>
              <div>
                <label className="label">Date To</label>
                <input type="date" className="input" value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setAuditPage(0) }} />
              </div>
              <div>
                <label className="label">Action</label>
                <select className="input w-40" value={actionFilter}
                  onChange={e => { setActionFilter(e.target.value); setAuditPage(0) }}>
                  <option value="">All Actions</option>
                  {['UPLOAD', 'DELETE', 'EDIT', 'EXPORT'].map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">User</label>
                <select className="input w-48" value={userFilter}
                  onChange={e => { setUserFilter(e.target.value); setAuditPage(0) }}>
                  <option value="">All Users</option>
                  {userOptions.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name ?? u.username ?? u.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Search</label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    className="input pl-8 w-48"
                    placeholder="Action, table, user..."
                    value={auditSearch}
                    onChange={e => setAuditSearch(e.target.value)}
                  />
                </div>
              </div>
              <button onClick={loadAudit} className="btn-secondary flex items-center gap-2 text-sm">
                <RefreshCw size={14} /> Refresh
              </button>
              <button onClick={exportAuditLog} className="btn-secondary flex items-center gap-2 text-sm ml-auto">
                <FileSpreadsheet size={14} className="text-green-400" /> Export to Excel
              </button>
            </div>
          </div>

          {/* Expanded row detail rendering */}
          {visibleAuditRows.map(row => expandedRow === row.id && (
            <div key={`detail-${row.id}`} className="card bg-gray-900/50">
              <AuditChangeDetail row={row} />
            </div>
          ))}

          {/* EnterpriseTable */}
          <div className="card p-0 overflow-hidden">
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={auditColumns}
              data={visibleAuditRows}
              getRowId={(row) => String(row.id)}
              enableGlobalFilter={false}
              enableSorting={true}
              enableExport={false}
              enableColumnVisibility={false}
              initialPageSize={50}
              pageSizeOptions={[50]}
              emptyMessage={auditLoading ? 'Loading...' : 'No audit events found'}
            />
          </div>

          {auditPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm text-gray-400">
                Showing {auditPage * PAGE_SIZE + 1}-{Math.min((auditPage + 1) * PAGE_SIZE, auditTotal)} of {auditTotal.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setAuditPage(p => Math.max(0, p - 1))} disabled={auditPage === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-400">Page {auditPage + 1} of {auditPages}</span>
                <button onClick={() => setAuditPage(p => Math.min(auditPages - 1, p + 1))} disabled={auditPage >= auditPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Upload History tab ─────────────────────────────────────────────── */}
      {activeTab === 'upload' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={exportUploadHistory} className="btn-secondary flex items-center gap-2 text-sm">
              <FileSpreadsheet size={14} className="text-green-400" /> Export to Excel
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={uploadColumns}
              data={uploadRows}
              getRowId={(row) => String(row.id)}
              enableGlobalFilter={false}
              enableSorting={true}
              enableExport={false}
              enableColumnVisibility={false}
              initialPageSize={50}
              pageSizeOptions={[50]}
              emptyMessage={uploadLoading ? 'Loading...' : 'No upload history found'}
            />
          </div>

          {uploadPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm text-gray-400">
                Showing {uploadPage * PAGE_SIZE + 1}-{Math.min((uploadPage + 1) * PAGE_SIZE, uploadTotal)} of {uploadTotal.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setUploadPage(p => Math.max(0, p - 1))} disabled={uploadPage === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-400">Page {uploadPage + 1} of {uploadPages}</span>
                <button onClick={() => setUploadPage(p => Math.min(uploadPages - 1, p + 1))} disabled={uploadPage >= uploadPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Batch delete confirmation modal ───────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setDeleteTarget(null); setDeleteConfirm(''); setDeleteError('') }}>
          <div className="bg-gray-900 border border-red-800/50 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-3">Delete Upload Batch</h2>
            <p className="text-gray-400 text-sm mb-4">
              This will permanently delete <strong className="text-white">{deleteTarget.count} records</strong> uploaded on {formatDate(deleteTarget.date)}. This cannot be undone.
            </p>
            <p className="text-sm text-gray-400 mb-2">Type <span className="font-mono text-red-400">DELETE</span> to confirm:</p>
            <input className="input mb-4" placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} />
            {deleteError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={handleDeleteBatch} disabled={deleteConfirm !== 'DELETE' || deleting}
                className="btn-primary bg-red-700 hover:bg-red-600 disabled:opacity-40 flex-1">
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
              <button onClick={() => { setDeleteTarget(null); setDeleteConfirm(''); setDeleteError('') }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}