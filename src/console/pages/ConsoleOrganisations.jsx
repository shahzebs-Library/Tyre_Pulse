import { useEffect, useState, useCallback } from 'react'
import {
  Building2, Plus, Search, Edit2, Lock, Unlock, Trash2, Globe,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Save, X, RefreshCw,
  Users, Database, AlertTriangle, Eye,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
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

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('organisations')
      .select('*')
      .order('name')
    setOrgs(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function loadOrgStats(orgId) {
    if (orgStats[orgId]) return
    // tyre_records is country-scoped, not organisation-scoped, so a per-org tyre
    // count isn't available from the data model - report the platform total.
    const [{ count: users }, { count: tyres }] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId),
      supabase.from('tyre_records').select('id', { count: 'exact', head: true }),
    ])
    setOrgStats(prev => ({ ...prev, [orgId]: { users: users ?? 0, tyres: tyres ?? 0 } }))
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
  }

  async function toggleLock(org) {
    const locked = !org.locked
    await supabase.from('organisations').update({ locked }).eq('id', org.id)
    await logAction(locked ? 'lock_org' : 'unlock_org', org.id, 'organisation', { name: org.name })
    load()
  }

  async function handleDelete(org) {
    await supabase.from('organisations').delete().eq('id', org.id)
    await logAction('delete_org', org.id, 'organisation', { name: org.name })
    setConfirmDelete(null); load()
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Organisations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{orgs.length} total organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)', color: '#fff' }}>
            <Plus size={14} /> New Organisation
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, slug, email..."
            className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
        </div>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Plans</option>
          {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600">
          <Building2 size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No organisations found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Organisation</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Countries</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(org => (
                <>
                  <tr key={org.id}
                    className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors cursor-pointer"
                    onClick={() => {
                      setExpanded(expanded === org.id ? null : org.id)
                      loadOrgStats(org.id)
                    }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-orange-900/30 border border-orange-800/40 flex items-center justify-center flex-shrink-0">
                          <Building2 size={14} className="text-orange-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{org.name}</p>
                          <p className="text-gray-600">{org.slug}</p>
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
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">+{org.countries.length - 3}</span>
                        )}
                        {(!org.countries || org.countries.length === 0) && org.country && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{org.country}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {org.locked
                        ? <span className="flex items-center gap-1 text-red-400"><Lock size={11} /> Locked</span>
                        : org.active
                          ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={11} /> Active</span>
                          : <span className="flex items-center gap-1 text-gray-500"><XCircle size={11} /> Inactive</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {org.created_at ? new Date(org.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(org)}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-blue-400 transition-colors" title="Edit">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => toggleLock(org)}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-yellow-400 transition-colors" title={org.locked ? 'Unlock' : 'Lock'}>
                          {org.locked ? <Unlock size={13} /> : <Lock size={13} />}
                        </button>
                        <button onClick={() => setConfirmDelete(org)}
                          className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors" title="Delete">
                          <Trash2 size={13} />
                        </button>
                        <button className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors">
                          {expanded === org.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === org.id && (
                    <tr key={`${org.id}-exp`} className="border-b border-gray-800/40 bg-gray-900/30">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <Stat label="Users" value={orgStats[org.id]?.users ?? '...'} icon={Users} color="blue" />
                          <Stat label="Tyre Records" value={orgStats[org.id]?.tyres ?? '...'} icon={Database} color="orange" />
                          <Stat label="Contact" value={org.contact_email ?? '-'} icon={Globe} color="purple" />
                          <Stat label="Plan" value={org.plan ?? '-'} icon={Eye} color="green" />
                        </div>
                        {org.countries && org.countries.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">All Countries</p>
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
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-sm font-bold text-white">
                {modal === 'create' ? 'New Organisation' : 'Edit Organisation'}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
                  <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Organisation Name *">
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input-dark" placeholder="Acme Fleet Co." />
                </Field>
                <Field label="Slug">
                  <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                    className="input-dark" placeholder="acme-fleet (auto-generated)" />
                </Field>
                <Field label="Primary Country">
                  <select value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    className="input-dark">
                    <option value="">Select country...</option>
                    {ALL_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Plan">
                  <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                    className="input-dark">
                    {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="Contact Email">
                  <input value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
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
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assigned Countries</p>
                <input value={countrySearch} onChange={e => setCountrySearch(e.target.value)}
                  placeholder="Search countries..."
                  className="w-full h-8 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 mb-2" />
                <div className="grid grid-cols-3 gap-1 max-h-40 overflow-y-auto">
                  {filteredCountries.map(c => (
                    <label key={c} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                      form.countries.includes(c) ? 'bg-orange-900/40 text-orange-300 border border-orange-700/40' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'
                    }`}>
                      <input type="checkbox" checked={form.countries.includes(c)} onChange={() => toggleCountry(c)}
                        className="w-3 h-3 accent-orange-500 flex-shrink-0" />
                      <span className="truncate">{c}</span>
                    </label>
                  ))}
                </div>
                {form.countries.length > 0 && (
                  <p className="text-[10px] text-orange-400 mt-1.5">{form.countries.length} countries selected</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {saving ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : <><Save size={13} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-red-800/50 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Delete Organisation?</p>
                <p className="text-xs text-gray-500 mt-0.5">This action is irreversible</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Are you sure you want to delete <strong className="text-white">{confirmDelete.name}</strong>?
              All associated data may be affected.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)}
                className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-700 hover:bg-red-600 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
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
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${c[plan] ?? c.trial}`}>{plan ?? '-'}</span>
  )
}

function Stat({ label, value, icon: Icon, color }) {
  const c = { blue: 'text-blue-400', orange: 'text-orange-400', purple: 'text-purple-400', green: 'text-green-400' }
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className={c[color]} />
      <div>
        <p className="text-xs font-semibold text-white">{value}</p>
        <p className="text-[10px] text-gray-600">{label}</p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
