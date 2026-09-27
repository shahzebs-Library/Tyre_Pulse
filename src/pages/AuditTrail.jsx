/**
 * AuditTrail (route /audit): full history of uploads and user activity.
 *
 * Two server-paged registers (audit log + upload history) on the shared
 * EnterpriseTable, a KPI strip with honest "Unavailable" statistics when a read
 * fails, filters (date, action, user, page search), a change-detail dialog with
 * a field-level old/new diff, full-filter Excel/PDF exports, and the Admin-only
 * reversible upload batch reversal (server RPC `reverse_legacy_upload`, typed
 * confirmation + reason). Presentation logic lives in the pure
 * `src/lib/auditTrailAnalytics.js` engine.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import useLatestRequest from '../lib/useLatestRequest'
import { fetchAllPages } from '../lib/fetchAll'

import { auditQuery, uploadHistoryQuery, readAuditExport, matchesAuditSearch } from '../lib/api/auditTrail'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime, formatDate } from '../lib/formatters'
import {
  FileSpreadsheet, FileText, ClipboardList, RefreshCw, Search, Eye, Activity, Upload, Users, Database, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useReportMeta } from '../hooks/useReportMeta'
import {
  hasExpandable, changeDiff, actionMix, pageRangeLabel, pageCountFor, actorName,
  auditExportRows, uploadExportRows, auditFileName, AUDIT_ACTIONS,
  AUDIT_EXPORT_COLS, AUDIT_EXPORT_HEADERS, UPLOAD_EXPORT_COLS, UPLOAD_EXPORT_HEADERS,
} from '../lib/auditTrailAnalytics'

const PAGE_SIZE = 50

// Semantic action tints; the action word is always printed too.
const ACTION_BADGE = {
  UPLOAD: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  CREATE: 'bg-green-500/15 text-green-500 border-green-500/30',
  UPDATE: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  DELETE: 'bg-red-500/15 text-red-500 border-red-500/30',
  EDIT:   'bg-amber-500/15 text-amber-500 border-amber-500/30',
  EXPORT: 'bg-green-500/15 text-green-500 border-green-500/30',
}
const NEUTRAL_BADGE = 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'

/** Field-level old/new diff rendered as a responsive definition list. */
function AuditChangeDetail({ row }) {
  const { fields, meta, details } = changeDiff(row)
  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <dl className="divide-y divide-[var(--input-border)] rounded-lg border border-[var(--input-border)]">
          <div className="hidden sm:grid grid-cols-3 gap-3 px-3 py-2 text-xs font-medium text-[var(--text-muted)]">
            <span>Field</span><span>Old value</span><span>New value</span>
          </div>
          {fields.map((f) => (
            <div key={f.field} className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 px-3 py-2 text-xs">
              <dt className="font-medium text-[var(--text-secondary)] break-all">{f.field}{f.changed ? '' : ' (unchanged)'}</dt>
              <dd className="text-[var(--text-muted)] break-all"><span className="sm:hidden font-medium">Old: </span>{f.oldValue}</dd>
              <dd className={`break-all ${f.changed ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'}`}><span className="sm:hidden font-medium">New: </span>{f.newValue}</dd>
            </div>
          ))}
        </dl>
      )}
      {meta && (
        <pre className="text-xs text-[var(--text-secondary)] bg-[var(--input-bg)] rounded p-3 overflow-auto max-h-40">{JSON.stringify(meta, null, 2)}</pre>
      )}
      {details && (
        <pre className="text-xs text-[var(--text-secondary)] bg-[var(--input-bg)] rounded p-3 overflow-auto max-h-40">{JSON.stringify(details, null, 2)}</pre>
      )}
      {fields.length === 0 && !meta && !details && (
        <p className="text-xs text-[var(--text-muted)]">No change detail recorded.</p>
      )}
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, tone, loading, note }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      {loading ? (
        <div className="animate-pulse bg-[var(--input-bg)] rounded h-8 w-24 mt-1" />
      ) : (
        <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${tone}`}>{value ?? 'Unavailable'}</p>
      )}
      {!loading && note ? <p className="text-[11px] mt-0.5 text-[var(--text-muted)]">{note}</p> : null}
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

  async function exportAuditLog(kind = 'xlsx') {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const data = await readAuditExport({ filters: { dateFrom, dateTo, action: actionFilter, user: userFilter }, search: auditSearch })
      const rows = auditExportRows(data ?? [], formatDateTime)
      if (kind === 'pdf') {
        await exportToPdf(rows, AUDIT_EXPORT_COLS.slice(0, 5).map((key, i) => ({ key, header: AUDIT_EXPORT_HEADERS[i] })), 'Audit Log', auditFileName('audit'), 'landscape')
      } else {
        await exportToExcel(rows, AUDIT_EXPORT_COLS, AUDIT_EXPORT_HEADERS, auditFileName('audit'), 'Audit Log')
      }
    } catch (error) { setExportError(toUserMessage(error, 'Audit export failed.')) }
    finally { setExporting(false) }
  }

  async function exportUploadHistory(kind = 'xlsx') {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const data = await readAuditExport({ upload: true, filters: { dateFrom, dateTo } })
      const rows = uploadExportRows(data ?? [], formatDateTime)
      if (kind === 'pdf') {
        await exportToPdf(rows, UPLOAD_EXPORT_COLS.map((key, i) => ({ key, header: UPLOAD_EXPORT_HEADERS[i] })), 'Upload History', auditFileName('upload'), 'landscape')
      } else {
        await exportToExcel(rows, UPLOAD_EXPORT_COLS, UPLOAD_EXPORT_HEADERS, auditFileName('upload'), 'Upload History')
      }
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

  const auditPages  = pageCountFor(auditTotal, PAGE_SIZE)
  const uploadPages = pageCountFor(uploadTotal, PAGE_SIZE)

  const visibleAuditRows = auditRows.filter(row => matchesAuditSearch(row, auditSearch))
  const pageMix = useMemo(() => actionMix(visibleAuditRows), [visibleAuditRows])

  const closeDelete = () => { if (!deleting) { setDeleteTarget(null); setDeleteConfirm(''); setDeleteError('') } }

  // EnterpriseTable columns for audit log
  const auditColumns = useMemo(() => [
    {
      id: 'created_at',
      header: 'Timestamp',
      accessorFn: r => r.created_at || '',
      size: 160,
      cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">{row.original.created_at ? formatDateTime(row.original.created_at) : 'N/A'}</span>,
    },
    {
      id: 'user',
      header: 'User',
      accessorFn: r => actorName(r),
      size: 140,
      cell: ({ getValue, row }) => row.original.profiles?.full_name || row.original.profiles?.username
        ? <span className="text-[var(--text-primary)]">{getValue()}</span>
        : <span className="text-[var(--text-muted)]">{getValue()}</span>,
    },
    {
      id: 'action',
      header: 'Action',
      accessorFn: r => r.action ?? 'N/A',
      size: 100,
      cell: ({ getValue }) => {
        const val = getValue()
        return val !== 'N/A' ? (
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${ACTION_BADGE[val] ?? NEUTRAL_BADGE}`}>{val}</span>
        ) : 'N/A'
      },
    },
    { id: 'table_name', header: 'Table', accessorFn: r => r.table_name ?? 'N/A', size: 120 },
    {
      id: 'record_count',
      header: 'Records',
      accessorFn: r => (r.record_count == null ? -1 : Number(r.record_count)),
      size: 80,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.record_count ?? 'N/A'}</span>,
    },
    {
      id: 'details',
      header: 'Details',
      accessorFn: r => (hasExpandable(r) ? 'yes' : ''),
      size: 110,
      enableSorting: false,
      meta: { export: false },
      cell: ({ row }) => hasExpandable(row.original) ? (
        <button
          type="button"
          onClick={() => setExpandedRow(row.original)}
          className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-blue-500 hover:underline"
          aria-label={`View change detail for ${row.original.action || 'event'} on ${row.original.table_name || 'record'}`}
        >
          <Eye size={13} aria-hidden="true" /> View
        </button>
      ) : <span className="text-[var(--text-dim)]">None</span>,
    },
  ], [])

  // EnterpriseTable columns for upload history
  const uploadColumns = useMemo(() => {
    const cols = [
      {
        id: 'file_names',
        header: 'File Names',
        accessorFn: r => Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? 'N/A'),
        size: 200,
        cell: ({ getValue }) => <span className="text-[var(--text-primary)] max-w-xs truncate block" title={getValue()}>{getValue()}</span>,
      },
      {
        id: 'records_added',
        header: 'Records Added',
        accessorFn: r => r.records_added ?? 0,
        size: 100,
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="text-green-500 font-medium tabular-nums">{getValue().toLocaleString()}</span>,
      },
      {
        id: 'records_skipped',
        header: 'Records Skipped',
        accessorFn: r => r.records_skipped ?? 0,
        size: 100,
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="text-amber-500 tabular-nums">{getValue().toLocaleString()}</span>,
      },
      {
        id: 'uploaded_by',
        header: 'Uploaded By',
        accessorFn: r => actorName(r, 'uploaded_by'),
        size: 140,
      },
      {
        id: 'uploaded_at',
        header: 'Uploaded At',
        accessorFn: r => r.uploaded_at || '',
        size: 160,
        cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">{row.original.uploaded_at ? formatDateTime(row.original.uploaded_at) : 'N/A'}</span>,
      },
      { id: 'region', header: 'Region', accessorFn: r => r.region ?? 'N/A', size: 100 },
    ]
    if (profile?.role === 'Admin') {
      cols.push({
        id: 'delete',
        header: 'Reverse Batch',
        accessorFn: r => r.batch_id ?? '',
        size: 140,
        enableSorting: false,
        meta: { export: false },
        cell: ({ row }) => row.original.reversed_at ? <span className="text-xs text-[var(--text-muted)]">Reversed</span> : row.original.batch_id ? (
          <button
            type="button"
            onClick={() => { setDeleteReason(''); setDeleteTarget({ batchId: row.original.batch_id, count: row.original.records_added, date: row.original.uploaded_at }) }}
            className="text-xs min-h-[44px] text-red-500 border border-red-500/40 hover:bg-red-500/10 px-3 rounded-lg transition-colors"
          >
            Delete Batch
          </button>
        ) : <span className="text-[var(--text-dim)] text-xs">N/A</span>,
      })
    }
    return cols
  }, [profile?.role])

  const TABS = [
    { id: 'audit',  label: 'Audit Log' },
    { id: 'upload', label: 'Upload History' },
  ]

  return (
    <div className="space-y-4">
      {[readError, auditError, uploadError, exportError].filter(Boolean).map((message, index) => (
        <div key={index} role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{message}</div>
      ))}
      <PageHeader
        title="Audit Trail"
        subtitle="Full history of uploads and user activity"
        icon={ClipboardList}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Events"             value={stats.totalEvents?.toLocaleString()}  icon={Activity} tone="text-blue-500"   loading={statsLoading} />
        <SummaryCard label="Uploads This Month"       value={stats.uploadsMonth?.toLocaleString()} icon={Upload}   tone="text-green-500"  loading={statsLoading} />
        <SummaryCard label="Records Added This Month" value={stats.recordsMonth?.toLocaleString()} icon={Database} tone="text-violet-500" loading={statsLoading} note={stats.recordsCapped ? 'At least this many (capped)' : undefined} />
        <SummaryCard label="Active Users (30 days)"   value={stats.activeUsers?.toLocaleString()}  icon={Users}    tone="text-amber-500"  loading={statsLoading} note={stats.activeCapped ? 'At least this many (capped)' : undefined} />
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Audit views" className="flex gap-1 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`min-h-[44px] px-4 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === id
                ? 'border-blue-500 text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Audit Log tab ─────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-3" role="tabpanel" aria-label="Audit Log">
          <div className="card">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="label" htmlFor="at-from">Date From</label>
                <input id="at-from" type="date" className="input w-full min-h-[44px]" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setAuditPage(0) }} />
              </div>
              <div>
                <label className="label" htmlFor="at-to">Date To</label>
                <input id="at-to" type="date" className="input w-full min-h-[44px]" value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setAuditPage(0) }} />
              </div>
              <div>
                <label className="label" htmlFor="at-action">Action</label>
                <select id="at-action" className="input w-full min-h-[44px]" value={actionFilter}
                  onChange={e => { setActionFilter(e.target.value); setAuditPage(0) }}>
                  <option value="">All Actions</option>
                  {AUDIT_ACTIONS.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="at-user">User</label>
                <select id="at-user" className="input w-full min-h-[44px]" value={userFilter}
                  onChange={e => { setUserFilter(e.target.value); setAuditPage(0) }}>
                  <option value="">All Users</option>
                  {userOptions.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name ?? u.username ?? u.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="at-search">Search this page</label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input
                    id="at-search"
                    type="text"
                    className="input pl-8 w-full min-h-[44px]"
                    placeholder="User, action, table"
                    value={auditSearch}
                    onChange={e => setAuditSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {(dateFrom || dateTo || actionFilter || userFilter || auditSearch) && (
                <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); setActionFilter(''); setUserFilter(''); setAuditSearch(''); setAuditPage(0) }} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <X size={14} aria-hidden="true" /> Clear filters
                </button>
              )}
              <button type="button" onClick={loadAudit} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              <div className="flex flex-wrap gap-2 ml-auto">
                <button type="button" onClick={() => exportAuditLog('xlsx')} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <FileSpreadsheet size={14} aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export to Excel'}
                </button>
                <button type="button" onClick={() => exportAuditLog('pdf')} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <FileText size={14} aria-hidden="true" /> PDF
                </button>
              </div>
            </div>
            {pageMix.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] mt-3" aria-live="polite">
                On this page: {pageMix.map((m) => `${m.count} ${m.action}`).join(', ')}
              </p>
            )}
          </div>

          <EnterpriseTable
            viewKey="audit-trail"
            reportMeta={reportMeta}
            columns={auditColumns}
            data={visibleAuditRows}
            getRowId={(row) => String(row.id)}
            loading={auditLoading && !auditRows.length}
            enableGlobalFilter={false}
            enableSorting={true}
            enableExport={false}
            enableColumnVisibility={false}
            manualPagination
            pageIndex={auditPage}
            pageCount={auditPages}
            totalRows={auditTotal}
            pageSize={PAGE_SIZE}
            pageSizeOptions={[PAGE_SIZE]}
            onPageChange={(p) => setAuditPage(Math.max(0, Math.min(auditPages - 1, p)))}
            paginationLabel={() => pageRangeLabel(auditPage, PAGE_SIZE, auditTotal)}
            emptyMessage={auditError ? 'Audit events could not be loaded' : auditLoading ? 'Loading...' : 'No audit events found'}
          />
        </div>
      )}

      {/* ── Upload History tab ─────────────────────────────────────────────── */}
      {activeTab === 'upload' && (
        <div className="space-y-3" role="tabpanel" aria-label="Upload History">
          <div className="card">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="up-from">From</label>
                <input id="up-from" type="date" className="input min-h-[44px]" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setUploadPage(0); setAuditPage(0) }} />
              </div>
              <div>
                <label className="label" htmlFor="up-to">To</label>
                <input id="up-to" type="date" className="input min-h-[44px]" value={dateTo} onChange={e => { setDateTo(e.target.value); setUploadPage(0); setAuditPage(0) }} />
              </div>
              <button type="button" onClick={loadUploadHistory} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              <div className="flex flex-wrap gap-2 ml-auto">
                <button type="button" onClick={() => exportUploadHistory('xlsx')} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <FileSpreadsheet size={14} aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export to Excel'}
                </button>
                <button type="button" onClick={() => exportUploadHistory('pdf')} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <FileText size={14} aria-hidden="true" /> PDF
                </button>
              </div>
            </div>
          </div>

          <EnterpriseTable
            viewKey="audit-upload-history"
            reportMeta={reportMeta}
            columns={uploadColumns}
            data={uploadRows}
            getRowId={(row) => String(row.id)}
            loading={uploadLoading && !uploadRows.length}
            enableGlobalFilter={false}
            enableSorting={true}
            enableExport={false}
            enableColumnVisibility={false}
            manualPagination
            pageIndex={uploadPage}
            pageCount={uploadPages}
            totalRows={uploadTotal}
            pageSize={PAGE_SIZE}
            pageSizeOptions={[PAGE_SIZE]}
            onPageChange={(p) => setUploadPage(Math.max(0, Math.min(uploadPages - 1, p)))}
            paginationLabel={() => pageRangeLabel(uploadPage, PAGE_SIZE, uploadTotal)}
            emptyMessage={uploadError ? 'Upload history could not be loaded' : uploadLoading ? 'Loading...' : 'No upload history found'}
          />
        </div>
      )}

      {/* ── Change detail dialog ──────────────────────────────────────────── */}
      <Modal
        open={Boolean(expandedRow)}
        onClose={() => setExpandedRow(null)}
        size="lg"
        title="Change detail"
        subtitle={expandedRow ? `${expandedRow.action || 'Event'} on ${expandedRow.table_name || 'record'} by ${actorName(expandedRow)}, ${expandedRow.created_at ? formatDateTime(expandedRow.created_at) : 'N/A'}` : null}
      >
        {expandedRow && <AuditChangeDetail row={expandedRow} />}
      </Modal>

      {/* ── Batch reversal confirmation ───────────────────────────────────── */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={closeDelete}
        size="sm"
        closeOnBackdrop={!deleting}
        title="Reverse Upload Batch"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeDelete} className="btn-secondary min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={handleDeleteBatch} disabled={deleteConfirm !== 'DELETE' || deleteReason.trim().length < 3 || deleting}
              className="btn-danger min-h-[44px] disabled:opacity-40">
              {deleting ? 'Reversing...' : 'Reverse Batch'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <div className="space-y-3">
            <p className="text-[var(--text-secondary)] text-sm">
              This removes the surviving records from the batch uploaded on {formatDate(deleteTarget.date)}. The original upload contained {deleteTarget.count} records. History and a recovery archive are retained; batches with cleaning or disposal activity cannot be reversed here.
            </p>
            <div>
              <label className="label" htmlFor="rv-reason">Reason for reversal</label>
              <textarea id="rv-reason" className="input w-full" value={deleteReason} maxLength={2000} onChange={e => setDeleteReason(e.target.value)} aria-describedby="rv-reason-help" />
              <p id="rv-reason-help" className="text-[11px] text-[var(--text-muted)] mt-1">At least 3 characters. Recorded against the reversal.</p>
            </div>
            <div>
              <label className="label" htmlFor="rv-confirm">Type <span className="font-mono text-red-500">DELETE</span> to confirm</label>
              <input id="rv-confirm" className="input w-full" placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} autoComplete="off" />
            </div>
            {deleteError && (
              <p role="alert" className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">{deleteError}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
