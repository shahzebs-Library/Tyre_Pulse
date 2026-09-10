import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import useLatestRequest from '../lib/useLatestRequest'
import { fetchAllPages } from '../lib/fetchAll'

import { auditQuery, uploadHistoryQuery, readAuditExport, matchesAuditSearch } from '../lib/api/auditTrail'
import { exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
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
  return nonEmpty(row.details) || nonEmpty(row.old_values) || nonEmpty(row.new_values) || nonEmpty(row.old_data) || nonEmpty(row.new_data)
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return String(v) } }
  return String(v)
}

function AuditChangeDetail({ row }) {
  const oldV = nonEmpty(row.old_values) ? row.old_values : nonEmpty(row.old_data) ? row.old_data : null
  const newRaw = nonEmpty(row.new_values) ? row.new_values : nonEmpty(row.new_data) ? row.new_data : null
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

function SummaryCard({ label, value, color, loading, note }) {
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
        <p className={`text-3xl font-bold ${colors[color].split(' ')[0]}`}>{value ?? 'Unavailable'}</p>
      )}
      <p className="text-sm mt-1 text-gray-400">{label}</p>
      {!loading && note ? <p className="text-[11px] mt-0.5 text-gray-500">{note}</p> : null}
    </div>
  )
}

export default function AuditTrail() {
  const reportMeta = useReportMeta('Audit Trail')
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('audit')

  const [stats, setStats] = useState({ totalEvents: 0, uploadsMonth: 0, recordsMonth: 0, activeUsers: 0, recordsCapped: false, activeCapped: false })
  const [statsLoading, setStatsLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [auditError, setAuditError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)

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
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    async function loadStats() {
      setStatsLoading(true)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        // Bound: a plain select silently caps at 1000 rows, which would undercount
        // the derived totals below. Page past the cap for the sums / distinct set,
        // and take the upload count straight from an exact server count.
        const STAT_MAX = 100000
        const [totalRes, uploadsCountRes, monthPaged, activePaged] = await Promise.all([
          supabase.from('audit_log_v2').select('id', { count: 'exact', head: true }),
          supabase.from('audit_log_v2').select('id', { count: 'exact', head: true }).eq('action', 'UPLOAD').gte('created_at', monthStart),
          fetchAllPages((lo, hi) => supabase
            .from('audit_log_v2').select('record_count')
            .eq('action', 'UPLOAD').gte('created_at', monthStart)
            .order('id', { ascending: true }).range(lo, hi), { max: STAT_MAX }),
          fetchAllPages((lo, hi) => supabase
            .from('audit_log_v2').select('user_id')
            .gte('created_at', thirtyDaysAgo)
            .order('id', { ascending: true }).range(lo, hi), { max: STAT_MAX }),
        ])

        for (const result of [totalRes, uploadsCountRes, monthPaged, activePaged]) {
          if (result.error) throw result.error
        }
        const uploadsMonth  = uploadsCountRes.count ?? (monthPaged.data ?? []).length
        const recordsMonth  = (monthPaged.data ?? []).reduce((s, r) => s + (r.record_count ?? 0), 0)
        const activeUsers   = new Set((activePaged.data ?? []).map(r => r.user_id).filter(Boolean)).size

        setStats({
          totalEvents: totalRes.count ?? 0,
          uploadsMonth,
          recordsMonth,
          activeUsers,
          recordsCapped: monthPaged.truncated,
          activeCapped: activePaged.truncated,
        })
      } catch (error) {
        setStats({ totalEvents: null, uploadsMonth: null, recordsMonth: null, activeUsers: null })
        setReadError(toUserMessage(error, 'Could not read audit statistics.'))
      }
      setStatsLoading(false)
    }
    loadStats()
  }, [])

  useEffect(() => {
    async function loadUsers() {
      try {
        const { data, error, truncated } = await fetchAllPages((from, to) => supabase.from('profiles')
          .select('id, full_name, username').order('id').range(from, to), { max: 10000 })
        if (error) throw error
        if (truncated) throw new Error('The user filter list exceeds its limit. Use another filter.')
        setUserOptions(data ?? [])
      } catch (error) { setReadError(toUserMessage(error, 'Could not load audit user filters.')) }

    }
    loadUsers()
  }, [])

  // Five filters plus paging drive this read, so changing any of them twice
  // quickly leaves two in flight and the slower one can paint the previous
  // filter's entries under the new ones.
  const latestAudit = useLatestRequest()

  const loadAudit = useCallback(async () => {
    const stale = latestAudit.begin()
    setAuditLoading(true)
    try {
      const { data, count, error } = await auditQuery({ dateFrom, dateTo, action: actionFilter, user: userFilter })
        .range(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE - 1)
      if (error) throw error
      if (stale()) return
      setAuditError('')
      setAuditRows(data ?? [])
      setAuditTotal(count ?? 0)
    } catch (error) {
      if (!stale()) { setAuditRows([]); setAuditTotal(0); setAuditError(toUserMessage(error, 'Could not load audit events.')) }
    }
    if (!stale()) setAuditLoading(false)
  }, [auditPage, dateFrom, dateTo, actionFilter, userFilter, latestAudit])

  useEffect(() => { if (activeTab === 'audit') loadAudit() }, [loadAudit, activeTab])

  const latestUpload = useLatestRequest()
  const loadUploadHistory = useCallback(async () => {
    const stale = latestUpload.begin()
    setUploadLoading(true)
    try {
      const { data, count, error } = await uploadHistoryQuery({ dateFrom, dateTo })
        .range(uploadPage * PAGE_SIZE, (uploadPage + 1) * PAGE_SIZE - 1)
      if (error) throw error
      if (stale()) return
      setUploadError('')
      setUploadRows(data ?? [])
      setUploadTotal(count ?? 0)
    } catch (error) { if (!stale()) { setUploadRows([]); setUploadTotal(0); setUploadError(toUserMessage(error, 'Could not load upload history.')) } }
    if (!stale()) setUploadLoading(false)
  }, [uploadPage, latestUpload, dateFrom, dateTo])

  useEffect(() => { if (activeTab === 'upload') loadUploadHistory() }, [loadUploadHistory, activeTab])

  async function exportAuditLog() {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
    const data = await readAuditExport({ filters: { dateFrom, dateTo, action: actionFilter, user: userFilter }, search: auditSearch })
    const rows = (data ?? []).map(r => ({
      timestamp:  r.created_at ? formatDateTime(r.created_at) : '',
      user:       r.profiles?.full_name ?? r.profiles?.username ?? r.user_id ?? '',
      action:     r.action ?? '',
      table_name: r.table_name ?? '',
      records:    r.record_count ?? '',
      details:    r.details ? JSON.stringify(r.details) : '',
      old_values: JSON.stringify(r.old_values ?? r.old_data ?? null),
      new_values: JSON.stringify(r.new_values ?? r.new_data ?? null),
    }))

    exportToExcel(
      rows,
      ['timestamp', 'user', 'action', 'table_name', 'records', 'details', 'old_values', 'new_values'],
      ['Timestamp', 'User', 'Action', 'Table', 'Records', 'Details', 'Old Values', 'New Values'],
      `TyrePulse_AuditLog_${new Date().toISOString().slice(0, 10)}`,
      'Audit Log'
    )
    } catch (error) { setExportError(toUserMessage(error, 'Audit export failed.')) }
    finally { setExporting(false) }
  }

  async function exportUploadHistory() {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
    const data = await readAuditExport({ upload: true, filters: { dateFrom, dateTo } })
    const rows = (data ?? []).map(r => ({
      file_names:      Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? ''),
      records_added:   r.records_added ?? 0,
      records_skipped: r.records_skipped ?? 0,
      uploaded_by:     r.profiles?.full_name ?? r.profiles?.username ?? r.uploaded_by ?? '',
      uploaded_at:     r.uploaded_at ? formatDateTime(r.uploaded_at) : '',
      region:          r.region ?? '',
      reversed_at:     r.reversed_at ? formatDateTime(r.reversed_at) : '',
      reversed_count:  r.reversed_count ?? '',
    }))

    exportToExcel(
      rows,
      ['file_names', 'records_added', 'records_skipped', 'uploaded_by', 'uploaded_at', 'region', 'reversed_at', 'reversed_count'],
      ['File Names', 'Records Added', 'Records Skipped', 'Uploaded By', 'Uploaded At', 'Region', 'Reversed At', 'Reversed Records'],
      `TyrePulse_UploadHistory_${new Date().toISOString().slice(0, 10)}`,
      'Upload History'
    )
    } catch (error) { setExportError(toUserMessage(error, 'Upload history export failed.')) }
    finally { setExporting(false) }
  }

  async function handleDeleteBatch() {
    if (deleteConfirm !== 'DELETE' || deleteReason.trim().length < 3) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { data, error } = await supabase.rpc('reverse_legacy_upload', { p_batch_id: deleteTarget.batchId, p_reason: deleteReason.trim() })
      if (error) throw error
      if (data?.ok !== true || !Number.isInteger(data.removed)) throw new Error('The server did not confirm the reversal. Refresh before retrying.')
      setDeleteTarget(null)
      setDeleteConfirm('')
      setDeleteReason('')
      loadUploadHistory()
    } catch (e) {
      setDeleteError(e?.code === '23503'
        ? 'This batch has dependent records. Resolve its cleaning or disposal activity before reversal.'
        : toUserMessage(e, 'Reversal failed. Please try again.'))
    } finally {
      setDeleting(false)
    }
  }

  const auditPages  = Math.ceil(auditTotal  / PAGE_SIZE)
  const uploadPages = Math.ceil(uploadTotal / PAGE_SIZE)

  const visibleAuditRows = auditRows.filter(row => matchesAuditSearch(row, auditSearch))

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
        cell: ({ row }) => row.original.reversed_at ? <span className="text-xs text-gray-400">Reversed</span> : row.original.batch_id ? (
          <button
            onClick={() => { setDeleteReason(''); setDeleteTarget({ batchId: row.original.batch_id, count: row.original.records_added, date: row.original.uploaded_at }) }}
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
      {[readError, auditError, uploadError, exportError].filter(Boolean).map((message, index) => (
        <div key={index} role="alert" className="rounded border border-red-800 bg-red-900/20 p-3 text-sm text-red-300">{message}</div>
      ))}
      <PageHeader
        title="Audit Trail"
        subtitle="Full history of uploads and user activity"
        icon={ClipboardList}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Events"             value={stats.totalEvents?.toLocaleString()}  color="blue"   loading={statsLoading} />
        <SummaryCard label="Uploads This Month"       value={stats.uploadsMonth?.toLocaleString()}  color="green"  loading={statsLoading} />
        <SummaryCard label="Records Added This Month" value={stats.recordsMonth?.toLocaleString()}  color="purple" loading={statsLoading} note={stats.recordsCapped ? 'At least this many (capped)' : undefined} />
        <SummaryCard label="Active Users (30 days)"   value={stats.activeUsers?.toLocaleString()}   color="amber"  loading={statsLoading} note={stats.activeCapped ? 'At least this many (capped)' : undefined} />
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
                    placeholder="Search this page..."
                    value={auditSearch}
                    onChange={e => setAuditSearch(e.target.value)}
                  />
                </div>
              </div>
              <button onClick={loadAudit} className="btn-secondary flex items-center gap-2 text-sm">
                <RefreshCw size={14} /> Refresh
              </button>
              <button onClick={exportAuditLog} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm ml-auto">
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
              emptyMessage={auditError ? 'Audit events could not be loaded' : auditLoading ? 'Loading...' : 'No audit events found'}
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
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">From
              <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setUploadPage(0); setAuditPage(0) }} />
            </label>
            <label className="text-sm">To
              <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setUploadPage(0); setAuditPage(0) }} />
            </label>
            <button onClick={exportUploadHistory} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm">
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
              emptyMessage={uploadError ? 'Upload history could not be loaded' : uploadLoading ? 'Loading...' : 'No upload history found'}
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
            <h2 className="text-lg font-semibold text-white mb-3">Reverse Upload Batch</h2>
            <p className="text-gray-400 text-sm mb-4">
              This removes the surviving records from the batch uploaded on {formatDate(deleteTarget.date)}. The original upload contained {deleteTarget.count} records. History and a recovery archive are retained; batches with cleaning or disposal activity cannot be reversed here.
            </p>
            <label className="block text-sm text-gray-400 mb-2">Reason for reversal
              <textarea className="input mt-1" value={deleteReason} maxLength={2000} onChange={e => setDeleteReason(e.target.value)} />
            </label>
            <p className="text-sm text-gray-400 mb-2">Type <span className="font-mono text-red-400">DELETE</span> to confirm:</p>
            <input className="input mb-4" placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} />
            {deleteError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={handleDeleteBatch} disabled={deleteConfirm !== 'DELETE' || deleteReason.trim().length < 3 || deleting}
                className="btn-primary bg-red-700 hover:bg-red-600 disabled:opacity-40 flex-1">
                {deleting ? 'Reversing...' : 'Reverse Batch'}
              </button>
              <button onClick={() => { setDeleteTarget(null); setDeleteConfirm(''); setDeleteError('') }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
