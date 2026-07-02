import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import {
  ClipboardCheck, CheckCircle, XCircle, Clock, FileSpreadsheet,
  User, Globe, Search, AlertTriangle, Pencil, Package, Save, Trash2, Wand2,
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
                        <span className="flex items-center gap-1"><Globe size={11} />{p.country || '-'}</span>
                        <span className="flex items-center gap-1"><Clock size={11} />{new Date(p.created_at).toLocaleString()}</span>
                      </div>
                      {p.status === 'rejected' && p.review_note && (
                        <p className="text-xs text-red-400 mt-1.5">Rejected: {p.review_note}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setPreviewing(p)} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <Pencil size={14} /> {p.status === 'pending' ? 'View / Edit' : 'View'}
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

      {/* Correction modal - view & edit the staged rows before approving */}
      {previewing && (
        <EditBatchModal
          batch={previewing}
          editable={previewing.status === 'pending'}
          onClose={() => setPreviewing(null)}
          onSaved={async () => { await load(); setPreviewing(null) }}
        />
      )}
    </div>
  )
}

const PREFERRED_COLS = ['issue_date', 'asset_no', 'brand', 'serial_no', 'site', 'country', 'category', 'risk_level', 'cost_per_tyre', 'qty', 'description', 'item_code', 'unit_cost']
const MAX_VISIBLE = 300

function EditBatchModal({ batch, editable, onClose, onSaved }) {
  const [rows, setRows]     = useState(() => (Array.isArray(batch.rows) ? batch.rows.map(r => ({ ...r })) : []))
  const [search, setSearch] = useState('')
  const [bulkCol, setBulkCol] = useState('')
  const [bulkVal, setBulkVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)
  const [err, setErr]       = useState('')

  const cols = useMemo(() => {
    if (!rows.length) return []
    const present = PREFERRED_COLS.filter(k => k in rows[0])
    return present.length ? present : Object.keys(rows[0]).slice(0, 12)
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const withIdx = rows.map((r, idx) => ({ r, idx }))
    const matched = q
      ? withIdx.filter(({ r }) => cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)))
      : withIdx
    return { list: matched.slice(0, MAX_VISIBLE), total: matched.length }
  }, [rows, search, cols])

  function setCell(idx, col, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [col]: val } : r)); setDirty(true)
  }
  function deleteRow(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx)); setDirty(true)
  }
  function applyBulk() {
    if (!bulkCol) return
    setRows(prev => prev.map(r => ({ ...r, [bulkCol]: bulkVal }))); setDirty(true)
  }

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('pending_uploads')
      .update({ rows, row_count: rows.length })
      .eq('id', batch.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[var(--panel,#0f1623)] border border-gray-700 rounded-xl max-w-6xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold">{batch.file_name || 'Upload'} · {rows.length.toLocaleString()} rows</h3>
            <p className="text-xs text-gray-500">{editable ? 'Edit any cell, fix a whole column, or remove rows - then Save.' : 'Read-only (already reviewed).'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><XCircle size={20} /></button>
        </div>

        {editable && (
          <div className="px-5 py-3 border-b border-gray-800 flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 bg-gray-800/40 rounded-lg px-3 py-1.5 flex-1 min-w-[180px]">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent text-sm text-white placeholder-gray-500 outline-none flex-1"
                placeholder="Filter rows…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Fix whole column</label>
                <select className="input text-sm py-1.5" value={bulkCol} onChange={e => setBulkCol(e.target.value)}>
                  <option value="">Column…</option>
                  {cols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <input className="input text-sm py-1.5 w-40" placeholder="Set value" value={bulkVal} onChange={e => setBulkVal(e.target.value)} />
              <button onClick={applyBulk} disabled={!bulkCol} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40">
                <Wand2 size={14} /> Apply to all
              </button>
            </div>
          </div>
        )}

        {err && <div className="px-5 py-2 text-red-400 text-sm">{err}</div>}

        <div className="overflow-auto p-4 flex-1">
          {rows.length === 0 ? (
            <p className="text-gray-500 text-sm">No rows.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {cols.map(c => <th key={c} className="text-left px-2 py-1.5 text-gray-500 font-semibold uppercase tracking-wider border-b border-gray-800 whitespace-nowrap">{c}</th>)}
                  {editable && <th className="px-2 py-1.5 border-b border-gray-800" />}
                </tr>
              </thead>
              <tbody>
                {visible.list.map(({ r, idx }) => (
                  <tr key={idx} className="border-b border-gray-800/50">
                    {cols.map(c => (
                      <td key={c} className="px-1 py-1 whitespace-nowrap">
                        {editable ? (
                          <input
                            className="bg-transparent text-gray-200 px-1.5 py-1 rounded hover:bg-white/5 focus:bg-white/10 outline-none w-full min-w-[90px]"
                            value={r[c] == null ? '' : String(r[c])}
                            onChange={e => setCell(idx, c, e.target.value)}
                          />
                        ) : (
                          <span className="text-gray-300 px-1.5">{r[c] == null ? '-' : String(r[c])}</span>
                        )}
                      </td>
                    ))}
                    {editable && (
                      <td className="px-2 py-1">
                        <button onClick={() => deleteRow(idx)} className="text-gray-600 hover:text-red-400" title="Remove row">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {visible.total > MAX_VISIBLE && (
            <p className="text-xs text-gray-500 mt-3">Showing {MAX_VISIBLE} of {visible.total.toLocaleString()} matching rows. Use the filter to find specific rows; “Apply to all” affects every row in the batch.</p>
          )}
        </div>

        {editable && (
          <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-500">{dirty ? 'Unsaved corrections' : 'No changes'}</span>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">Close</button>
              <button onClick={save} disabled={saving || !dirty} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40">
                <Save size={14} /> {saving ? 'Saving…' : 'Save corrections'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
