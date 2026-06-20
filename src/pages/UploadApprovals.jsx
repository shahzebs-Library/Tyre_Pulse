import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import {
  ClipboardCheck, CheckCircle, XCircle, Clock, FileSpreadsheet,
  User, Globe, Search, AlertTriangle, Eye, Package,
} from 'lucide-react'

const TYPE_META = {
  tyres: { label: 'Tyre Records', icon: FileSpreadsheet, color: '#16a34a' },
  stock: { label: 'Stock',        icon: Package,         color: '#0891b2' },
}

const BATCH = 500

export default function UploadApprovals() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [pending, setPending]   = useState([])
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState(null)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [previewing, setPreviewing] = useState(null) // pending row being previewed
  const [tab, setTab]           = useState('pending')

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('pending_uploads')
      .select('id, batch_id, uploaded_by, uploader_name, country, upload_type, target_table, file_name, row_count, rows, status, reviewed_at, review_note, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
    if (err) setError(err.message)
    setPending((data ?? []).filter(p => p.status === 'pending'))
    setHistory((data ?? []).filter(p => p.status !== 'pending'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Live-refresh when uploads are submitted/reviewed.
  useEffect(() => {
    if (!isAdmin) return
    const ch = supabase
      .channel('realtime:pending_uploads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_uploads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [isAdmin, load])

  async function approve(p) {
    if (acting) return
    setActing(p.id); setError('')
    const rows = Array.isArray(p.rows) ? p.rows : []
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const { error: insErr } = await supabase.from(p.target_table).insert(chunk)
      if (insErr) { setError(`Insert failed for "${p.file_name}": ${insErr.message}`); setActing(null); return }
      inserted += chunk.length
    }
    const { error: updErr } = await supabase.from('pending_uploads')
      .update({ status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq('id', p.id)
    setActing(null)
    if (updErr) { setError(updErr.message); return }
    await load()
  }

  async function reject(p) {
    if (acting) return
    const note = window.prompt(`Reject "${p.file_name}" (${p.row_count} rows)? Optional reason:`, '')
    if (note === null) return
    setActing(p.id); setError('')
    const { error: err } = await supabase.from('pending_uploads')
      .update({ status: 'rejected', reviewed_by: profile?.id, reviewed_at: new Date().toISOString(), review_note: note || null })
      .eq('id', p.id)
    setActing(null)
    if (err) { setError(err.message); return }
    await load()
  }

  const list = tab === 'pending' ? pending : history
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(p =>
      (p.file_name ?? '').toLowerCase().includes(q) ||
      (p.uploader_name ?? '').toLowerCase().includes(q) ||
      (p.country ?? '').toLowerCase().includes(q)
    )
  }, [list, search])

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title="Upload Approvals" subtitle="Admin only" icon={ClipboardCheck} />
        <div className="card py-16 flex flex-col items-center gap-3">
          <AlertTriangle size={40} className="text-gray-700" />
          <p className="text-gray-400 font-medium">Administrators only</p>
          <p className="text-gray-600 text-sm">Only an admin can review and approve uploaded data.</p>
        </div>
      </div>
    )
  }

  const pendingRows = pending.reduce((a, p) => a + (p.row_count || 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Upload Approvals"
        subtitle={`${pending.length} batch${pending.length === 1 ? '' : 'es'} awaiting review · ${pendingRows.toLocaleString()} rows`}
        icon={ClipboardCheck}
      />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Tabs + search */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-gray-800/40 rounded-lg p-1">
          {[['pending', `Pending (${pending.length})`], ['history', 'History']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === k ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-gray-800/40 rounded-lg px-3 py-1.5 w-72 max-w-full">
          <Search size={15} className="text-gray-500" />
          <input
            className="bg-transparent text-sm text-white placeholder-gray-500 outline-none flex-1"
            placeholder="Search file, uploader, country…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3">{[...Array(3)].map((_, i) => <div key={i} className="card animate-pulse h-28 bg-gray-800/40" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card py-16 flex flex-col items-center gap-3">
          <CheckCircle size={40} className="text-gray-700" />
          <p className="text-gray-400 font-medium">{tab === 'pending' ? 'Nothing awaiting approval' : 'No history yet'}</p>
          <p className="text-gray-600 text-sm">{tab === 'pending' ? 'Uploads submitted by non-admins will appear here for review.' : 'Approved and rejected uploads will be listed here.'}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => {
            const meta = TYPE_META[p.upload_type] ?? TYPE_META.tyres
            const Icon = meta.icon
            const busy = acting === p.id
            return (
              <div key={p.id} className="card" style={{ borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}1a` }}>
                      <Icon size={18} style={{ color: meta.color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-semibold truncate">{p.file_name || 'Untitled upload'}</p>
                      <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Package size={11} />{(p.row_count || 0).toLocaleString()} rows · {meta.label}</span>
                        <span className="flex items-center gap-1"><User size={11} />{p.uploader_name || 'Unknown'}</span>
                        <span className="flex items-center gap-1"><Globe size={11} />{p.country || '—'}</span>
                        <span className="flex items-center gap-1"><Clock size={11} />{new Date(p.created_at).toLocaleString()}</span>
                      </div>
                      {p.status === 'rejected' && p.review_note && (
                        <p className="text-xs text-red-400 mt-1.5">Rejected: {p.review_note}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setPreviewing(p)} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <Eye size={14} /> Preview
                    </button>
                    {p.status === 'pending' ? (
                      <>
                        <button onClick={() => reject(p)} disabled={busy}
                          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-700/50 text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                          <XCircle size={14} /> Reject
                        </button>
                        <button onClick={() => approve(p)} disabled={busy}
                          className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
                          <CheckCircle size={14} /> {busy ? 'Approving…' : 'Approve'}
                        </button>
                      </>
                    ) : (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded ${p.status === 'approved' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                        {p.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Preview modal — first 20 rows */}
      {previewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewing(null)}>
          <div className="bg-[var(--panel,#0f1623)] border border-gray-700 rounded-xl max-w-5xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
              <h3 className="text-white font-semibold">{previewing.file_name} · first 20 rows</h3>
              <button onClick={() => setPreviewing(null)} className="text-gray-400 hover:text-white"><XCircle size={20} /></button>
            </div>
            <div className="overflow-auto p-4">
              <PreviewTable rows={previewing.rows} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewTable({ rows }) {
  const data = (Array.isArray(rows) ? rows : []).slice(0, 20)
  if (!data.length) return <p className="text-gray-500 text-sm">No rows.</p>
  // Show a useful, compact subset of columns if present, else all keys.
  const preferred = ['issue_date', 'asset_no', 'brand', 'serial_no', 'site', 'country', 'category', 'risk_level', 'cost_per_tyre', 'qty', 'description', 'item_code']
  const keys = preferred.filter(k => k in data[0])
  const cols = keys.length ? keys : Object.keys(data[0]).slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>{cols.map(c => <th key={c} className="text-left px-2 py-1.5 text-gray-500 font-semibold uppercase tracking-wider border-b border-gray-800">{c}</th>)}</tr>
      </thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i} className="border-b border-gray-800/50">
            {cols.map(c => <td key={c} className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{r[c] == null ? '—' : String(r[c])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
