import { useEffect, useState, useCallback } from 'react'
import { Megaphone, Plus, Edit2, Trash2, RefreshCw, Save, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import { Btn, ErrorState, LoadingState, EmptyState, Modal } from '../components/ui'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Reporter', 'Driver']
const TYPES = ['info', 'warning', 'success', 'critical']

const TYPE_STYLE = {
  info:     'text-blue-400 bg-blue-900/20 border-blue-700/40',
  warning:  'text-amber-400 bg-amber-900/20 border-amber-700/40',
  success:  'text-green-400 bg-green-900/20 border-green-700/40',
  critical: 'text-red-400 bg-red-900/20 border-red-700/40',
}

const EMPTY = {
  title: '', message: '', type: 'info', target_roles: [],
  target_org_id: null, active: true, show_until: '',
}

export default function ConsoleAnnouncements() {
  const { logAction, activeOrg } = useConsoleAuth()
  const [list, setList]     = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [orgs, setOrgs]     = useState([])
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
      // An unread error used to render as an empty list, so "we could not look"
      // and "there are none" looked identical.
      if (error) throw error
      setList(data ?? [])
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load announcements.'))
      setList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm({ ...EMPTY, target_org_id: activeOrg?.id ?? null })
    setError(null); setModal('create')
  }
  function openEdit(ann) {
    setForm({
      title: ann.title ?? '', message: ann.body ?? '', type: ann.type ?? 'info',
      target_roles: ann.target_roles ?? [], target_org_id: ann.target_org_id ?? null,
      active: ann.active ?? true, show_until: ann.show_until ? ann.show_until.slice(0, 10) : '',
    })
    setError(null); setModal({ type: 'edit', id: ann.id })
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.message.trim()) { setError('Message is required.'); return }
    setSaving(true); setError(null)
    try {
    const payload = {
      title: form.title.trim(), body: form.message.trim(), type: form.type,
      target_roles: form.target_roles.length ? form.target_roles : null,
      target_org_id: form.target_org_id || null,
      active: form.active,
      show_until: form.show_until ? new Date(form.show_until + 'T23:59:59Z').toISOString() : null,
    }
    if (modal === 'create') {
      const { data, error: err } = await supabase.from('announcements').insert(payload).select().single()
      if (err) { setError(toUserMessage(err, 'Could not save the announcement.')); setSaving(false); return }
      await logAction('create_announcement', data.id, 'announcement', { title: data.title })
    } else {
      const { error: err } = await supabase.from('announcements').update(payload).eq('id', modal.id)
      if (err) { setError(toUserMessage(err, 'Could not save the announcement.')); setSaving(false); return }
      await logAction('update_announcement', modal.id, 'announcement', { title: payload.title })
    }
    setSaving(false); setModal(null); load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the announcement.')); setSaving(false)
    }
  }

  async function toggleActive(ann) {
    setBusyId(ann.id); setLoadError('')
    try {
      const { error: err } = await supabase.from('announcements').update({ active: !ann.active }).eq('id', ann.id)
      if (err) throw err
      await load()
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not change the announcement.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(ann) {
    setDeleting(true); setDeleteError(null)
    try {
      const { error: err } = await supabase.from('announcements').delete().eq('id', ann.id)
      if (err) throw err
      await logAction('delete_announcement', ann.id, 'announcement', { title: ann.title })
      setConfirmDel(null); load()
    } catch (e) {
      setDeleteError(toUserMessage(e, 'Could not delete the announcement.'))
    } finally {
      setDeleting(false)
    }
  }

  const toggleRole = (r) =>
    setForm(f => ({ ...f, target_roles: f.target_roles.includes(r) ? f.target_roles.filter(x => x !== r) : [...f.target_roles, r] }))

  const active = list.filter(a => a.active)
  const inactive = list.filter(a => !a.active)

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Announcements</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading || loadError ? 'N/A' : `${active.length} active | ${inactive.length} inactive`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn variant="primary" icon={Plus} onClick={openCreate}>New Announcement</Btn>
        </div>
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : loading ? (
        <LoadingState label="Loading announcements" rows={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements yet"
          reason="Nothing has been published to users. Create one to show a banner in the app."
          action={<Btn variant="primary" icon={Plus} onClick={openCreate}>Create the first one</Btn>} />
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Active ({active.length})</p>
              <div className="space-y-2">
                {active.map(ann => <AnnCard key={ann.id} ann={ann} orgs={orgs} busy={busyId === ann.id} onEdit={openEdit} onToggle={toggleActive} onDelete={() => { setDeleteError(null); setConfirmDel(ann) }} />)}
              </div>
            </div>
          )}
          {inactive.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Inactive ({inactive.length})</p>
              <div className="space-y-2 opacity-75">
                {inactive.map(ann => <AnnCard key={ann.id} ann={ann} orgs={orgs} busy={busyId === ann.id} onEdit={openEdit} onToggle={toggleActive} onDelete={() => { setDeleteError(null); setConfirmDel(ann) }} />)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / edit */}
      <Modal
        open={!!modal}
        title={modal === 'create' ? 'New Announcement' : 'Edit Announcement'}
        onClose={() => { if (!saving) setModal(null) }}
        width="max-w-xl"
        footer={(
          <>
            <Btn onClick={() => setModal(null)} disabled={saving}>Cancel</Btn>
            <Btn variant="primary" icon={Save} onClick={handleSave} busy={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
          </>
        )}
      >
        <div className="space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300 break-words">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="ann-title" className="field-label">Title *</label>
              <input id="ann-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="input-dark" placeholder="System maintenance on Saturday..." />
            </div>
            <div>
              <label htmlFor="ann-type" className="field-label">Type</label>
              <select id="ann-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="input-dark">
                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-org" className="field-label">Organisation</label>
              <select id="ann-org" value={form.target_org_id ?? ''} onChange={e => setForm(f => ({ ...f, target_org_id: e.target.value || null }))}
                className="input-dark">
                <option value="">All Organisations</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-expires" className="field-label">Expires</label>
              <input id="ann-expires" type="date" value={form.show_until} onChange={e => setForm(f => ({ ...f, show_until: e.target.value }))}
                className="input-dark" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500" />
                <span className="text-xs text-gray-300">Active (visible to users)</span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ann-message" className="field-label">Message *</label>
              <textarea id="ann-message" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                rows={4} placeholder="Write your announcement message here..."
                className="input-dark resize-none" />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="field-label">Target Roles (leave empty = all roles)</legend>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLES.map(r => {
                  const on = form.target_roles.includes(r)
                  return (
                    <button key={r} type="button" onClick={() => toggleRole(r)} aria-pressed={on}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        on
                          ? 'bg-orange-900/40 text-orange-300 border-orange-700/40'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                      }`}>{r}</button>
                  )
                })}
              </div>
            </fieldset>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDel}
        title="Delete Announcement?"
        subtitle="This cannot be undone."
        onClose={() => { if (!deleting) setConfirmDel(null) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmDel(null)} disabled={deleting}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} onClick={() => handleDelete(confirmDel)} busy={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Btn>
          </>
        )}
      >
        {deleteError && <div className="mb-3"><ErrorState message={deleteError} /></div>}
        <p className="text-sm text-gray-300 break-words">
          The announcement <span className="text-gray-100 font-medium">{confirmDel?.title}</span> will be permanently deleted.
        </p>
      </Modal>
    </div>
  )
}

function AnnCard({ ann, orgs, busy, onEdit, onToggle, onDelete }) {
  const orgName = orgs.find(o => o.id === ann.target_org_id)?.name
  const expired = ann.show_until && new Date(ann.show_until) < new Date()
  return (
    <div className={`rounded-xl border p-4 ${TYPE_STYLE[ann.type] ?? TYPE_STYLE.info}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${TYPE_STYLE[ann.type]}`}>{ann.type}</span>
            {orgName && <span className="text-[10px] text-gray-400">to {orgName}</span>}
            {expired && <span className="text-[10px] font-semibold text-red-400">EXPIRED</span>}
            {ann.show_until && !expired && (
              <span className="text-[10px] text-gray-400">
                Expires {new Date(ann.show_until).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white break-words">{ann.title}</p>
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 break-words" title={ann.body || ''}>{ann.body}</p>
          {ann.target_roles && ann.target_roles.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {ann.target_roles.map(r => (
                <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-400 border border-gray-700">{r}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => onToggle(ann)} disabled={busy}
            aria-label={ann.active ? `Deactivate ${ann.title}` : `Activate ${ann.title}`}
            className="p-1.5 rounded hover:bg-black/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50" title={ann.active ? 'Deactivate' : 'Activate'}>
            {ann.active ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button type="button" onClick={() => onEdit(ann)} aria-label={`Edit ${ann.title}`}
            className="p-1.5 rounded hover:bg-black/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50" title="Edit">
            <Edit2 size={13} />
          </button>
          <button type="button" onClick={onDelete} disabled={busy} aria-label={`Delete ${ann.title}`}
            className="p-1.5 rounded hover:bg-black/20 transition-colors text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
