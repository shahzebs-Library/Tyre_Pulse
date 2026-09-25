import { Fragment, useEffect, useState, useCallback } from 'react'
import {
  Building2, Plus, Edit2, Lock, Unlock, Trash2, Globe,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Save, RefreshCw,
  Users, Database, AlertTriangle, Eye,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import { Btn, ErrorState, LoadingState, EmptyState, Modal, SearchInput, Select, Toolbar } from '../components/ui'
import { useConsoleAuth } from '../ConsoleAuthContext'

const PLANS = ['trial', 'starter', 'professional', 'enterprise']
const ALL_COUNTRIES = [
  'South Africa','Nigeria','Kenya','Ghana','Tanzania','Uganda','Ethiopia','Egypt',
  'Morocco','Algeria','Tunisia','Senegal','Côte d\'Ivoire','Cameroon','Zimbabwe',
  'Zambia','Botswana','Namibia','Rwanda','Mozambique','Angola','UAE','Saudi Arabia',
  'Qatar','Kuwait','Bahrain','Oman','Jordan','Pakistan','India','Bangladesh',
  'United Kingdom','United States','Canada','Australia','Germany','France','Netherlands',
]

const EMPTY_FORM = {
  name: '', slug: '', country: '', countries: [], plan: 'starter',
  contact_email: '', active: true, locked: false,
}

export default function ConsoleOrganisations() {
  const { logAction } = useConsoleAuth()
  const [orgs, setOrgs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]       = useState('')
  const [filterPlan, setFilterPlan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expanded, setExpanded]   = useState(null)
  const [modal, setModal]         = useState(null)   // null | 'create' | 'edit'
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [orgStats, setOrgStats]   = useState({})     // orgId -> { users, tyres }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [countrySearch, setCountrySearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const { data, error } = await supabase
        .from('organisations')
        .select('*')
        .order('name')
      if (error) throw error
      setOrgs(data ?? [])
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load organisations.'))
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function loadOrgStats(orgId) {
    if (orgStats[orgId]) return
    // tyre_records is country-scoped, not organisation-scoped, so a per-org tyre
    // count isn't available from the data model - report the platform total.
    try {
      const [{ count: users, error: uErr }, { count: tyres, error: tErr }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId),
        supabase.from('tyre_records').select('id', { count: 'exact', head: true }),
      ])
      setOrgStats(prev => ({ ...prev, [orgId]: { users: uErr ? 'N/A' : (users ?? 0), tyres: tErr ? 'N/A' : (tyres ?? 0) } }))
    } catch {
      setOrgStats(prev => ({ ...prev, [orgId]: { users: 'N/A', tyres: 'N/A' } }))
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM); setError(null); setModal('create')
  }
  function openEdit(org) {
    setForm({
      name: org.name ?? '', slug: org.slug ?? '',
      country: org.country ?? '', countries: org.countries ?? [],
      plan: org.plan ?? 'starter', contact_email: org.contact_email ?? '',
      active: org.active ?? true, locked: org.locked ?? false,
    })
    setError(null); setModal({ type: 'edit', id: org.id })
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Organisation name is required.'); return }
    setSaving(true); setError(null)
    try {
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || form.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      country: form.country,
      countries: form.countries,
      plan: form.plan,
      contact_email: form.contact_email.trim() || null,
      active: form.active,
      locked: form.locked,
    }
    if (modal === 'create') {
      const { data, error: err } = await supabase.from('organisations').insert(payload).select().single()
      if (err) { setError(toUserMessage(err, 'Could not save the organisation.')); setSaving(false); return }
      await logAction('create_org', data.id, 'organisation', { name: data.name })
    } else {
      const { error: err } = await supabase.from('organisations').update(payload).eq('id', modal.id)
      if (err) { setError(toUserMessage(err, 'Could not save the organisation.')); setSaving(false); return }
      await logAction('update_org', modal.id, 'organisation', { name: payload.name })
    }
    setSaving(false); setModal(null); load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the organisation.')); setSaving(false)
    }
  }

  async function toggleLock(org) {
    const locked = !org.locked
    setBusyId(org.id); setLoadError('')
    try {
      const { error: err } = await supabase.from('organisations').update({ locked }).eq('id', org.id)
      if (err) throw err
      await logAction(locked ? 'lock_org' : 'unlock_org', org.id, 'organisation', { name: org.name })
      await load()
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not change the organisation lock.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(org) {
    setDeleting(true); setDeleteError(null)
    try {
      const { error: err } = await supabase.from('organisations').delete().eq('id', org.id)
      if (err) throw err
      await logAction('delete_org', org.id, 'organisation', { name: org.name })
      setConfirmDelete(null); load()
    } catch (e) {
      setDeleteError(toUserMessage(e, 'Could not delete the organisation.'))
    } finally {
      setDeleting(false)
    }
  }

  function toggleExpand(org) {
    setExpanded(expanded === org.id ? null : org.id)
    loadOrgStats(org.id)
  }

  const filtered = orgs.filter(o => {
    const matchSearch = !search || o.name.toLowerCase().includes(search.toLowerCase()) ||
      (o.slug ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (o.contact_email ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPlan   = !filterPlan   || o.plan === filterPlan
    const matchStatus = !filterStatus ||
      (filterStatus === 'active' && o.active && !o.locked) ||
      (filterStatus === 'locked' && o.locked) ||
      (filterStatus === 'inactive' && !o.active)
    return matchSearch && matchPlan && matchStatus
  })

  const toggleCountry = (c) =>
    setForm(f => ({
      ...f,
      countries: f.countries.includes(c) ? f.countries.filter(x => x !== c) : [...f.countries, c],
    }))

  const filteredCountries = ALL_COUNTRIES.filter(c =>
    c.toLowerCase().includes(countrySearch.toLowerCase())
  )

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Organisations</h1>
          <p className="text-sm text-gray-400 mt-0.5">{loading || loadError ? 'N/A' : `${orgs.length} total organisations`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn variant="primary" icon={Plus} onClick={openCreate}>New Organisation</Btn>
        </div>
      </div>

      {/* Filters */}
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, slug, email..." className="flex-1 min-w-48" />
        <Select value={filterPlan} onChange={setFilterPlan} ariaLabel="Filter by plan" className="w-36"
          options={[{ value: '', label: 'All Plans' }, ...PLANS.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))]} />
        <Select value={filterStatus} onChange={setFilterStatus} ariaLabel="Filter by status" className="w-36"
          options={[{ value: '', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'locked', label: 'Locked' }, { value: 'inactive', label: 'Inactive' }]} />
      </Toolbar>

      {/* Table */}
      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : loading ? (
        <LoadingState label="Loading organisations" />
      ) : orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organisations yet" reason="Create the first organisation to onboard a company."
          action={<Btn variant="primary" icon={Plus} onClick={openCreate}>New Organisation</Btn>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No organisations match" reason="Nothing matches this search, plan and status. Clear the filters to see every organisation." />
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th scope="col" className="text-left px-4 py-3 text-gray-400 font-semibold uppercase tracking-wider">Organisation</th>
                <th scope="col" className="text-left px-4 py-3 text-gray-400 font-semibold uppercase tracking-wider">Plan</th>
                <th scope="col" className="text-left px-4 py-3 text-gray-400 font-semibold uppercase tracking-wider">Countries</th>
                <th scope="col" className="text-left px-4 py-3 text-gray-400 font-semibold uppercase tracking-wider">Status</th>
                <th scope="col" className="text-left px-4 py-3 text-gray-400 font-semibold uppercase tracking-wider">Created</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(org => {
                const open = expanded === org.id
                return (
                <Fragment key={org.id}>
                  <tr
                    className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleExpand(org)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleExpand(org) } }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-orange-900/30 border border-orange-800/40 flex items-center justify-center flex-shrink-0">
                          <Building2 size={14} className="text-orange-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate max-w-[220px]" title={org.name}>{org.name}</p>
                          <p className="text-gray-400 truncate max-w-[220px]" title={org.slug || ''}>{org.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={org.plan} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(org.countries ?? []).slice(0, 3).map(c => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{c}</span>
                        ))}
                        {(org.countries ?? []).length > 3 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">+{org.countries.length - 3}</span>
                        )}
                        {(!org.countries || org.countries.length === 0) && org.country && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{org.country}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {org.locked
                        ? <span className="flex items-center gap-1 text-red-400"><Lock size={11} /> Locked</span>
                        : org.active
                          ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={11} /> Active</span>
                          : <span className="flex items-center gap-1 text-gray-400"><XCircle size={11} /> Inactive</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {org.created_at ? new Date(org.created_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        <button type="button" onClick={() => openEdit(org)} aria-label={`Edit ${org.name}`}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 hover:text-blue-400" title="Edit">
                          <Edit2 size={13} />
                        </button>
                        <button type="button" onClick={() => toggleLock(org)} disabled={busyId === org.id}
                          aria-label={`${org.locked ? 'Unlock' : 'Lock'} ${org.name}`}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 hover:text-amber-400" title={org.locked ? 'Unlock' : 'Lock'}>
                          {org.locked ? <Unlock size={13} /> : <Lock size={13} />}
                        </button>
                        <button type="button" onClick={() => { setDeleteError(null); setConfirmDelete(org) }} disabled={busyId === org.id}
                          aria-label={`Delete ${org.name}`}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 hover:text-red-400" title="Delete">
                          <Trash2 size={13} />
                        </button>
                        <button type="button" onClick={() => toggleExpand(org)} aria-expanded={open}
                          aria-label={`${open ? 'Hide' : 'Show'} details for ${org.name}`}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 hover:text-gray-200" title={open ? 'Hide details' : 'Show details'}>
                          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-gray-800/40 bg-gray-900/30">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                          <Stat label="Users" value={orgStats[org.id]?.users ?? '...'} icon={Users} color="blue" />
                          <Stat label="Tyre Records (platform total)" value={orgStats[org.id]?.tyres ?? '...'} icon={Database} color="orange" />
                          <Stat label="Contact" value={org.contact_email ?? 'N/A'} icon={Globe} color="purple" />
                          <Stat label="Plan" value={org.plan ?? 'N/A'} icon={Eye} color="green" />
                        </div>
                        {org.countries && org.countries.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">All Countries</p>
                            <div className="flex flex-wrap gap-1.5">
                              {org.countries.map(c => (
                                <span key={c} className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">{c}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={!!modal}
        title={modal === 'create' ? 'New Organisation' : 'Edit Organisation'}
        onClose={() => { if (!saving) setModal(null) }}
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
            <Field label="Organisation Name *" htmlFor="org-name">
              <input id="org-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input-dark" placeholder="Acme Fleet Co." />
            </Field>
            <Field label="Slug" htmlFor="org-slug">
              <input id="org-slug" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                className="input-dark" placeholder="acme-fleet (auto-generated)" />
            </Field>
            <Field label="Primary Country" htmlFor="org-country">
              <select id="org-country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                className="input-dark">
                <option value="">Select country...</option>
                {ALL_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Plan" htmlFor="org-plan">
              <select id="org-plan" value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="input-dark">
                {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Contact Email" htmlFor="org-email">
              <input id="org-email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                type="email" className="input-dark" placeholder="contact@example.com" />
            </Field>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500" />
                <span className="text-xs text-gray-300">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.locked} onChange={e => setForm(f => ({ ...f, locked: e.target.checked }))}
                  className="w-4 h-4 accent-red-500" />
                <span className="text-xs text-gray-300">Locked</span>
              </label>
            </div>
          </div>

          {/* Multi-country selector */}
          <fieldset>
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assigned Countries</legend>
            <input value={countrySearch} onChange={e => setCountrySearch(e.target.value)}
              aria-label="Search countries"
              placeholder="Search countries..."
              className="w-full h-8 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 mb-2" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
              {filteredCountries.map(c => (
                <label key={c} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                  form.countries.includes(c) ? 'bg-orange-900/40 text-orange-300 border border-orange-700/40' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'
                }`}>
                  <input type="checkbox" checked={form.countries.includes(c)} onChange={() => toggleCountry(c)}
                    className="w-3 h-3 accent-orange-500 flex-shrink-0" />
                  <span className="truncate" title={c}>{c}</span>
                </label>
              ))}
            </div>
            {form.countries.length > 0 && (
              <p className="text-[10px] text-orange-400 mt-1.5">{form.countries.length} countries selected</p>
            )}
          </fieldset>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        title="Delete Organisation?"
        subtitle="This action is irreversible"
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} onClick={() => handleDelete(confirmDelete)} busy={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Btn>
          </>
        )}
      >
        {deleteError && <div className="mb-3"><ErrorState message={deleteError} /></div>}
        <p className="text-sm text-gray-300 break-words">
          Are you sure you want to delete <strong className="text-white">{confirmDelete?.name}</strong>?
          All associated data may be affected.
        </p>
      </Modal>
    </div>
  )
}

function PlanBadge({ plan }) {
  const c = {
    trial: 'text-gray-400 bg-gray-800 border-gray-700',
    starter: 'text-blue-400 bg-blue-900/20 border-blue-800/40',
    professional: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
    enterprise: 'text-orange-400 bg-orange-900/20 border-orange-800/40',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${c[plan] ?? c.trial}`}>{plan ?? 'N/A'}</span>
  )
}

function Stat({ label, value, icon: Icon, color }) {
  const c = { blue: 'text-blue-400', orange: 'text-orange-400', purple: 'text-purple-400', green: 'text-green-400' }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon size={14} className={`shrink-0 ${c[color]}`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white break-all">{value}</p>
        <p className="text-[10px] text-gray-400">{label}</p>
      </div>
    </div>
  )
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
