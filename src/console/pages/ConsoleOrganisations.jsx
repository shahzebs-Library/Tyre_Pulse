import { Fragment, useEffect, useMemo, useState, useCallback } from 'react'
import {
  Building2, Plus, Edit2, Lock, Unlock, Trash2, Globe,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Save, RefreshCw,
  Users, Database, Eye, FileSpreadsheet, FileText,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import {
  Badge, Btn, ErrorState, LoadingState, EmptyState, Modal, SearchInput, Select, Toolbar,
  StatTile, Table, THead, Th, Tr, Td,
} from '../components/ui'
import { exportConsoleRows, sortRows, useTableSort } from '../../lib/consoleTable'
import { orgStatus, summarizeOrgs } from '../../lib/consoleOrganisations'
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
  const [confirmLock, setConfirmLock] = useState(null)
  const [lockError, setLockError] = useState(null)
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const { sort, onSort } = useTableSort({ key: 'name', dir: 'asc' })

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
    // Both counts are scoped to this organisation (tyre_records carries
    // organisation_id since V290). A failed count reads N/A, never 0.
    try {
      const [{ count: users, error: uErr }, { count: tyres, error: tErr }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId),
        supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId),
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
    setBusyId(org.id); setLockError(null)
    try {
      const { error: err } = await supabase.from('organisations').update({ locked }).eq('id', org.id)
      if (err) throw err
      await logAction(locked ? 'lock_org' : 'unlock_org', org.id, 'organisation', { name: org.name })
      setConfirmLock(null)
      await load()
    } catch (e) {
      setLockError(toUserMessage(e, 'Could not change the organisation lock.'))
    } finally {
      setBusyId(null)
    }
  }

  async function runExport(format) {
    setExporting(format); setExportError('')
    try {
      await exportConsoleRows({
        rows: sorted,
        title: 'Organisations',
        format,
        columns: [
          { key: 'name', header: 'Organisation' },
          { key: 'slug', header: 'Slug' },
          { key: 'plan', header: 'Plan' },
          { key: 'status', header: 'Status', value: r => orgStatus(r) },
          { key: 'country', header: 'Primary country' },
          { key: 'countries', header: 'Countries', value: r => (r.countries ?? []).join(', ') },
          { key: 'contact_email', header: 'Contact email' },
          { key: 'created_at', header: 'Created', value: r => fmtDate(r.created_at) },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
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

  const summary = useMemo(() => summarizeOrgs(orgs), [orgs])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orgs.filter(o => {
      const matchSearch = !q || [o.name, o.slug, o.contact_email, o.country, ...(o.countries ?? [])]
        .some(v => String(v ?? '').toLowerCase().includes(q))
      const matchPlan   = !filterPlan   || o.plan === filterPlan
      const matchStatus = !filterStatus || orgStatus(o).toLowerCase() === filterStatus
      return matchSearch && matchPlan && matchStatus
    })
  }, [orgs, search, filterPlan, filterStatus])
  const sorted = useMemo(() => sortRows(filtered, sort, { status: orgStatus }), [filtered, sort])
  const statusTile = (key) => setFilterStatus(s => (s === key ? '' : key))

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
          <h1 className="text-xl font-bold text-gray-100">Organisations</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Companies on the platform, their plan, countries and access state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={loading || !!loadError || sorted.length === 0}>Excel</Btn>
          <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={loading || !!loadError || sorted.length === 0}>PDF</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn variant="primary" icon={Plus} onClick={openCreate}>New Organisation</Btn>
        </div>
      </div>

      {exportError && <ErrorState message={exportError} />}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Organisations" icon={Building2} value={loading || loadError ? 'N/A' : summary.total}
          sub={loading ? 'Loading' : loadError ? 'Could not load' : 'All plans'} onClick={() => setFilterStatus('')} active={!filterStatus} />
        <StatTile label="Active" tone="good" value={loading || loadError ? 'N/A' : summary.active}
          sub="Open for sign-in" onClick={() => statusTile('active')} active={filterStatus === 'active'} />
        <StatTile label="Locked" tone={summary.locked ? 'danger' : 'default'} value={loading || loadError ? 'N/A' : summary.locked}
          sub="Access blocked" onClick={() => statusTile('locked')} active={filterStatus === 'locked'} />
        <StatTile label="Inactive" tone="muted" value={loading || loadError ? 'N/A' : summary.inactive}
          sub="Switched off" onClick={() => statusTile('inactive')} active={filterStatus === 'inactive'} />
        <StatTile label="Enterprise plan" tone="accent" value={loading || loadError ? 'N/A' : (summary.byPlan.enterprise ?? 0)}
          sub={loading || loadError ? '' : `${summary.countries} countries covered`} />
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
        <Table className="min-w-0">
          <THead>
            <Th sortKey="name" sort={sort} onSort={onSort}>Organisation</Th>
            <Th sortKey="plan" sort={sort} onSort={onSort}>Plan</Th>
            <Th>Countries</Th>
            <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
            <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
            <Th align="right"><span className="sr-only">Actions</span></Th>
          </THead>
          <tbody>
            {sorted.map(org => {
              const open = expanded === org.id
              const countries = org.countries ?? []
              return (
                <Fragment key={org.id}>
                  <Tr onClick={() => toggleExpand(org)}>
                    <Td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-orange-900/30 border border-orange-800/40 flex items-center justify-center flex-shrink-0">
                          <Building2 size={14} className="text-orange-400" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-100 truncate max-w-[220px]" title={org.name}>{org.name}</p>
                          <p className="text-gray-400 truncate max-w-[220px]" title={org.slug || ''}>{org.slug || 'No slug'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><PlanBadge plan={org.plan} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {countries.slice(0, 3).map(c => <Badge key={c}>{c}</Badge>)}
                        {countries.length > 3 && <Badge title={countries.slice(3).join(', ')}>+{countries.length - 3}</Badge>}
                        {countries.length === 0 && (org.country ? <Badge>{org.country}</Badge> : <span className="text-gray-400">None set</span>)}
                      </div>
                    </Td>
                    <Td nowrap>
                      {org.locked
                        ? <Badge tone="danger" icon={Lock}>Locked</Badge>
                        : org.active
                          ? <Badge tone="good" icon={CheckCircle}>Active</Badge>
                          : <Badge icon={XCircle}>Inactive</Badge>}
                    </Td>
                    <Td nowrap className="text-gray-400">{fmtDate(org.created_at)}</Td>
                    <Td align="right">
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        <Btn size="xs" variant="quiet" icon={Edit2} title="Edit" ariaLabel={`Edit ${org.name}`} onClick={() => openEdit(org)} />
                        <Btn size="xs" variant="quiet" icon={org.locked ? Unlock : Lock} title={org.locked ? 'Unlock' : 'Lock'}
                          ariaLabel={`${org.locked ? 'Unlock' : 'Lock'} ${org.name}`} busy={busyId === org.id}
                          onClick={() => { setLockError(null); setConfirmLock(org) }} />
                        <Btn size="xs" variant="quiet" icon={Trash2} title="Delete" ariaLabel={`Delete ${org.name}`} disabled={busyId === org.id}
                          onClick={() => { setDeleteError(null); setConfirmDelete(org) }} />
                        <Btn size="xs" variant="quiet" icon={open ? ChevronUp : ChevronDown} title={open ? 'Hide details' : 'Show details'}
                          ariaLabel={`${open ? 'Hide' : 'Show'} details for ${org.name}`} aria-expanded={open} onClick={() => toggleExpand(org)} />
                      </div>
                    </Td>
                  </Tr>
                  {open && (
                    <tr className="border-t border-gray-800/40 bg-gray-900/30">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                          <Stat label="Users" value={orgStats[org.id]?.users ?? 'Loading...'} icon={Users} />
                          <Stat label="Tyre records" value={orgStats[org.id]?.tyres ?? 'Loading...'} icon={Database} />
                          <Stat label="Contact" value={org.contact_email ?? 'N/A'} icon={Globe} />
                          <Stat label="Plan" value={org.plan ?? 'N/A'} icon={Eye} />
                        </div>
                        {countries.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">All countries</p>
                            <div className="flex flex-wrap gap-1.5">
                              {countries.map(c => <Badge key={c}>{c}</Badge>)}
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
        </Table>
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
          {error && <ErrorState message={error} />}
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

      {/* Lock / unlock confirm */}
      <Modal
        open={!!confirmLock}
        title={confirmLock?.locked ? 'Unlock organisation?' : 'Lock organisation?'}
        subtitle={confirmLock?.name}
        onClose={() => { if (!busyId) setConfirmLock(null) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmLock(null)} disabled={!!busyId}>Cancel</Btn>
            <Btn variant={confirmLock?.locked ? 'primary' : 'danger'} icon={confirmLock?.locked ? Unlock : Lock}
              onClick={() => toggleLock(confirmLock)} busy={!!busyId}>
              {confirmLock?.locked ? 'Unlock' : 'Lock'}
            </Btn>
          </>
        )}
      >
        {lockError && <div className="mb-3"><ErrorState message={lockError} /></div>}
        <p className="text-sm text-gray-300 break-words">
          {confirmLock?.locked
            ? 'Members of this organisation will be able to sign in and use the app again.'
            : 'Every member of this organisation will be blocked from the app until it is unlocked. The action is recorded in the audit trail.'}
        </p>
      </Modal>
    </div>
  )
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function PlanBadge({ plan }) {
  const tone = { trial: 'default', starter: 'info', professional: 'good', enterprise: 'accent' }
  return <Badge tone={tone[plan] || 'default'}>{plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'N/A'}</Badge>
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon size={14} className="shrink-0 text-orange-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-100 break-all">{value}</p>
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
