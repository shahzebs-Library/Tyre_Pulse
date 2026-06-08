import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { exportToExcel } from '../lib/exportUtils'
import { useAuth } from '../contexts/AuthContext'
import { logAuditEvent } from '../lib/auditLogger'
import {
  FileSpreadsheet, ChevronLeft, ChevronRight, ClipboardList, RefreshCw,
} from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'

const PAGE_SIZE = 50

const ACTION_BADGE = {
  UPLOAD: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  DELETE: 'bg-red-900/50 text-red-300 border-red-700/50',
  EDIT:   'bg-amber-900/50 text-amber-300 border-amber-700/50',
  EXPORT: 'bg-green-900/50 text-green-300 border-green-700/50',
}

function SummaryCard({ label, value, color }) {
  const colors = {
    blue:   'text-blue-400 border-blue-800 bg-blue-900/20',
    green:  'text-green-400 border-green-800 bg-green-900/20',
    purple: 'text-purple-400 border-purple-800 bg-purple-900/20',
    amber:  'text-amber-400 border-amber-800 bg-amber-900/20',
  }
  return (
    <div className={`card border ${colors[color]}`}>
      <p className={`text-3xl font-bold ${colors[color].split(' ')[0]}`}>{value ?? 0}</p>
      <p className="text-sm mt-1 text-gray-400">{label}</p>
    </div>
  )
}

export default function AuditTrail() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('audit')

  // ── Summary stats ──────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ totalEvents: 0, uploadsMonth: 0, recordsMonth: 0, activeUsers: 0 })
  const [statsLoading, setStatsLoading] = useState(true)

  // ── Audit Log tab ──────────────────────────────────────────────────────────
  const [auditRows, setAuditRows]   = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage]   = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [expandedRow, setExpandedRow]   = useState(null)

  // Filters
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter]     = useState('')
  const [userOptions, setUserOptions]   = useState([])

  // ── Upload History tab ─────────────────────────────────────────────────────
  const [uploadRows, setUploadRows]   = useState([])
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadPage, setUploadPage]   = useState(0)
  const [uploadLoading, setUploadLoading] = useState(false)

  // ── Batch delete state ─────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  // ── Load summary stats ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadStats() {
      setStatsLoading(true)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        const [totalRes, monthRes, activeRes] = await Promise.all([
          supabase.from('audit_log').select('id', { count: 'exact', head: true }),
          supabase.from('audit_log').select('record_count').eq('action', 'UPLOAD').gte('created_at', monthStart),
          supabase.from('audit_log').select('user_id').gte('created_at', thirtyDaysAgo),
        ])

        const uploadsMonth  = (monthRes.data ?? []).length
        const recordsMonth  = (monthRes.data ?? []).reduce((s, r) => s + (r.record_count ?? 0), 0)
        const activeUsers   = new Set((activeRes.data ?? []).map(r => r.user_id).filter(Boolean)).size

        setStats({
          totalEvents: totalRes.count ?? 0,
          uploadsMonth,
          recordsMonth,
          activeUsers,
        })
      } catch { /* ignore */ }
      setStatsLoading(false)
    }
    loadStats()
  }, [])

  // ── Load user options for filter dropdown ──────────────────────────────────
  useEffect(() => {
    async function loadUsers() {
      const { data } = await supabase.from('profiles').select('id, full_name, username')
      setUserOptions(data ?? [])
    }
    loadUsers()
  }, [])

  // ── Load audit log ─────────────────────────────────────────────────────────
  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      let q = supabase
        .from('audit_log')
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

  // ── Load upload history ────────────────────────────────────────────────────
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

  // ── Export handlers ────────────────────────────────────────────────────────
  async function exportAuditLog() {
    const { data } = await supabase
      .from('audit_log')
      .select('*, profiles(full_name, username)')
      .order('created_at', { ascending: false })
      .limit(5000)

    const rows = (data ?? []).map(r => ({
      timestamp:  r.created_at ? new Date(r.created_at).toLocaleString() : '',
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
      uploaded_at:     r.uploaded_at ? new Date(r.uploaded_at).toLocaleString() : '',
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
    await supabase.from('tyre_records').delete().eq('upload_batch_id', deleteTarget.batchId)
    await logAuditEvent({ action: 'batch_delete', table_name: 'tyre_records', record_count: deleteTarget.count, details: { batch_id: deleteTarget.batchId } })
    setDeleteTarget(null)
    setDeleteConfirm('')
    setDeleting(false)
    loadUploadHistory()
  }

  const auditPages  = Math.ceil(auditTotal  / PAGE_SIZE)
  const uploadPages = Math.ceil(uploadTotal / PAGE_SIZE)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Trail"
        subtitle="Full history of uploads and user activity"
        icon={ClipboardList}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Events"           value={statsLoading ? '…' : stats.totalEvents.toLocaleString()} color="blue" />
        <SummaryCard label="Uploads This Month"     value={statsLoading ? '…' : stats.uploadsMonth.toLocaleString()} color="green" />
        <SummaryCard label="Records Added This Month" value={statsLoading ? '…' : stats.recordsMonth.toLocaleString()} color="purple" />
        <SummaryCard label="Active Users (30 days)" value={statsLoading ? '…' : stats.activeUsers.toLocaleString()} color="amber" />
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
              <button onClick={loadAudit} className="btn-secondary flex items-center gap-2 text-sm">
                <RefreshCw size={14} /> Refresh
              </button>
              <button onClick={exportAuditLog} className="btn-secondary flex items-center gap-2 text-sm ml-auto">
                <FileSpreadsheet size={14} className="text-green-400" /> Export to Excel
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Timestamp', 'User', 'Action', 'Table', 'Records', 'Details'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-500">Loading…</td></tr>
                  ) : auditRows.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-500">No audit events found</td></tr>
                  ) : auditRows.map(row => (
                    <>
                      <tr key={row.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="table-cell text-gray-400 text-xs whitespace-nowrap">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="table-cell text-gray-200">
                          {row.profiles?.full_name ?? row.profiles?.username ?? <span className="text-gray-600">Unknown</span>}
                        </td>
                        <td className="table-cell">
                          {row.action ? (
                            <span className={`badge border ${ACTION_BADGE[row.action] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                              {row.action}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="table-cell text-gray-400">{row.table_name ?? '—'}</td>
                        <td className="table-cell text-gray-200 text-right">{row.record_count ?? '—'}</td>
                        <td className="table-cell">
                          {row.details && Object.keys(row.details).length > 0 ? (
                            <button
                              onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              {expandedRow === row.id ? 'Hide' : 'Show'}
                            </button>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                      </tr>
                      {expandedRow === row.id && (
                        <tr key={`${row.id}-detail`} className="bg-gray-900/50">
                          <td colSpan={6} className="px-4 pb-3 pt-0">
                            <pre className="text-xs text-gray-400 bg-gray-800/60 rounded p-3 overflow-auto max-h-40">
                              {JSON.stringify(row.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {auditPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <p className="text-sm text-gray-400">
                  Showing {auditPage * PAGE_SIZE + 1}–{Math.min((auditPage + 1) * PAGE_SIZE, auditTotal)} of {auditTotal.toLocaleString()}
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['File Names', 'Records Added', 'Records Skipped', 'Uploaded By', 'Uploaded At', 'Region', ...(profile?.role === 'Admin' ? ['Delete Batch'] : [])].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadLoading ? (
                    <tr><td colSpan={profile?.role === 'Admin' ? 7 : 6} className="text-center py-12 text-gray-500">Loading…</td></tr>
                  ) : uploadRows.length === 0 ? (
                    <tr><td colSpan={profile?.role === 'Admin' ? 7 : 6} className="text-center py-12 text-gray-500">No upload history found</td></tr>
                  ) : uploadRows.map(row => (
                    <tr key={row.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="table-cell text-gray-200 max-w-xs truncate">
                        {Array.isArray(row.file_names)
                          ? row.file_names.join(', ')
                          : (row.file_names ?? '—')}
                      </td>
                      <td className="table-cell text-green-400 text-right font-medium">
                        {(row.records_added ?? 0).toLocaleString()}
                      </td>
                      <td className="table-cell text-amber-400 text-right">
                        {(row.records_skipped ?? 0).toLocaleString()}
                      </td>
                      <td className="table-cell text-gray-200">
                        {row.profiles?.full_name ?? row.profiles?.username ?? <span className="text-gray-600">Unknown</span>}
                      </td>
                      <td className="table-cell text-gray-400 text-xs whitespace-nowrap">
                        {row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : '—'}
                      </td>
                      <td className="table-cell text-gray-400">{row.region ?? '—'}</td>
                      {profile?.role === 'Admin' && (
                        <td className="table-cell">
                          {row.batch_id ? (
                            <button onClick={() => setDeleteTarget({ batchId: row.batch_id, count: row.records_added, date: row.uploaded_at })}
                              className="text-xs text-red-400 border border-red-800/50 hover:bg-red-900/20 px-2 py-1 rounded transition-colors">
                              Delete Batch
                            </button>
                          ) : <span className="text-gray-700 text-xs">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {uploadPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <p className="text-sm text-gray-400">
                  Showing {uploadPage * PAGE_SIZE + 1}–{Math.min((uploadPage + 1) * PAGE_SIZE, uploadTotal)} of {uploadTotal.toLocaleString()}
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
        </div>
      )}

      {/* ── Batch delete confirmation modal ───────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setDeleteTarget(null); setDeleteConfirm('') }}>
          <div className="bg-gray-900 border border-red-800/50 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-3">Delete Upload Batch</h2>
            <p className="text-gray-400 text-sm mb-4">
              This will permanently delete <strong className="text-white">{deleteTarget.count} records</strong> uploaded on {new Date(deleteTarget.date).toLocaleDateString()}. This cannot be undone.
            </p>
            <p className="text-sm text-gray-400 mb-2">Type <span className="font-mono text-red-400">DELETE</span> to confirm:</p>
            <input className="input mb-4" placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={handleDeleteBatch} disabled={deleteConfirm !== 'DELETE' || deleting}
                className="btn-primary bg-red-700 hover:bg-red-600 disabled:opacity-40 flex-1">
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
              <button onClick={() => { setDeleteTarget(null); setDeleteConfirm('') }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
