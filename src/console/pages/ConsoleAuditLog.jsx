import { useEffect, useState, useCallback } from 'react'
import { ClipboardList, Search, RefreshCw, Filter, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ACTION_COLORS = {
  login:          'bg-green-900/30 text-green-400 border-green-700/30',
  logout:         'bg-gray-800 text-gray-400 border-gray-700',
  lock_user:      'bg-red-900/30 text-red-400 border-red-700/30',
  unlock_user:    'bg-blue-900/30 text-blue-400 border-blue-700/30',
  approve_user:   'bg-green-900/30 text-green-400 border-green-700/30',
  unapprove_user: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
  update_user:    'bg-blue-900/30 text-blue-400 border-blue-700/30',
  reset_password: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
  create_org:     'bg-orange-900/30 text-orange-400 border-orange-700/30',
  update_org:     'bg-blue-900/30 text-blue-400 border-blue-700/30',
  lock_org:       'bg-red-900/30 text-red-400 border-red-700/30',
  unlock_org:     'bg-blue-900/30 text-blue-400 border-blue-700/30',
  delete_org:     'bg-red-900/50 text-red-300 border-red-700/40',
  update_permissions: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
  update_config:  'bg-orange-900/30 text-orange-400 border-orange-700/30',
  create_announcement: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
}

const ACTION_TYPES = [
  'login','logout','lock_user','unlock_user','approve_user','unapprove_user',
  'update_user','reset_password','create_org','update_org','lock_org','unlock_org',
  'delete_org','update_permissions','update_config','create_announcement',
]

export default function ConsoleAuditLog() {
  const { activeOrg } = useConsoleAuth()
  const [logs, setLogs]     = useState([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterType, setFilterType]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [page, setPage]     = useState(0)
  const [expanded, setExpanded] = useState(null)
  const PAGE_SIZE = 50

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('console_sessions')
      .select('id, admin_id, action, target_id, target_type, details, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filterAction) q = q.eq('action', filterAction)
    if (filterType)   q = q.eq('target_type', filterType)
    if (dateFrom)     q = q.gte('created_at', dateFrom)
    if (dateTo)       q = q.lte('created_at', dateTo + 'T23:59:59Z')

    const { data, count } = await q
    setLogs(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [filterAction, filterType, dateFrom, dateTo, page])

  useEffect(() => { load() }, [load])

  // Admin profiles cache
  const [adminCache, setAdminCache] = useState({})
  useEffect(() => {
    const ids = [...new Set(logs.map(l => l.admin_id).filter(Boolean))]
    const missing = ids.filter(id => !adminCache[id])
    if (missing.length === 0) return
    supabase.from('profiles').select('id, full_name, email').in('id', missing)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach(p => { map[p.id] = p })
        setAdminCache(prev => ({ ...prev, ...map }))
      })
  }, [logs])

  async function exportCsv() {
    const rows = logs.map(l => [
      new Date(l.created_at).toISOString(),
      adminCache[l.admin_id]?.email ?? l.admin_id,
      l.action,
      l.target_type,
      l.target_id ?? '',
      JSON.stringify(l.details ?? {}),
    ])
    const header = 'Timestamp,Admin,Action,Target Type,Target ID,Details'
    const csv = [header, ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `console_audit_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const filteredLogs = search
    ? logs.filter(l =>
        (l.action ?? '').includes(search.toLowerCase()) ||
        (l.target_type ?? '').includes(search.toLowerCase()) ||
        JSON.stringify(l.details ?? {}).toLowerCase().includes(search.toLowerCase()) ||
        (adminCache[l.admin_id]?.email ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : logs

  const uniqueTypes = [...new Set(logs.map(l => l.target_type).filter(Boolean))]

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} total console events</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-40 transition-colors">
            <Download size={12} /> Export CSV
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search action, type, details, admin..."
            className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
        </div>
        <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0) }}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Actions</option>
          {ACTION_TYPES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0) }}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Types</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500" />
          <span className="text-gray-600 text-xs">to</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500" />
        </div>
        {(filterAction || filterType || dateFrom || dateTo || search) && (
          <button onClick={() => { setFilterAction(''); setFilterType(''); setDateFrom(''); setDateTo(''); setSearch(''); setPage(0) }}
            className="h-9 px-3 rounded-lg text-xs text-gray-500 hover:text-white bg-gray-800 border border-gray-700 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Log table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600">
          <ClipboardList size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No audit events found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Admin</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Action</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Target</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => (
                <>
                  <tr key={log.id}
                    className="border-b border-gray-800/60 hover:bg-gray-800/20 transition-colors cursor-pointer"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div>
                        <p className="text-white text-[11px]">{adminCache[log.admin_id]?.full_name ?? '-'}</p>
                        <p className="text-gray-600 text-[10px]">{adminCache[log.admin_id]?.email ?? log.admin_id?.slice(0, 8) + '...'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">
                      <span className="capitalize">{log.target_type ?? '-'}</span>
                      {log.target_id && <span className="text-gray-700 text-[10px] ml-1">#{log.target_id.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">
                      {log.details ? Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-exp`} className="border-b border-gray-800/40 bg-gray-900/30">
                      <td colSpan={5} className="px-6 py-3">
                        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Full Details</p>
                        <pre className="text-xs text-gray-300 bg-gray-800 rounded-lg p-3 overflow-x-auto">
                          {JSON.stringify(log.details ?? {}, null, 2)}
                        </pre>
                        <p className="text-[10px] text-gray-700 mt-1.5">Event ID: {log.id}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/30">
              <p className="text-xs text-gray-500">
                {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 border border-gray-700">← Prev</button>
                <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
                  className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 border border-gray-700">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBadge({ action }) {
  const cls = ACTION_COLORS[action] ?? 'bg-gray-800 text-gray-400 border-gray-700'
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded border font-semibold capitalize whitespace-nowrap ${cls}`}>
      {(action ?? '-').replace(/_/g, ' ')}
    </span>
  )
}
