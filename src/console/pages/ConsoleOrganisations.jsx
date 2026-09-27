import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, Plus, Edit2, Lock, Unlock, Trash2, Globe,
  CheckCircle, XCircle, Save,
  Users, Database, Eye, FileSpreadsheet, FileText, BarChart3, ArrowUpRight,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import {
  Badge, Btn, ErrorState, LoadingState, EmptyState, Modal, SearchInput, Select, Toolbar,
  StatTile, Table, THead, Th, Tr, Td, Panel, PanelHeader, Segmented,
} from '../components/ui'
import { BarsChart, TrendChart } from '../components/ui/charts'
import { topShare } from '../../lib/consoleCharts'
import { PageHeader, useUrlTab, useUrlParam, useRefreshStamp, usePaged, Pager, Drawer, AttentionList } from './shared/pageKit'
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

const TABS = ['register', 'insights']

/** Organisations created per month for the last 12 months, oldest first. */
function monthlyCreated(orgs, months = 12) {
  const now = new Date()
  const labels = []; const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${d.getMonth()}`)
    labels.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))
  }
  const counts = new Map(keys.map((k) => [k, 0]))
  for (const o of orgs) {
    const d = new Date(o.created_at)
    if (Number.isNaN(d.getTime())) continue
    const k = `${d.getFullYear()}-${d.getMonth()}`
    if (counts.has(k)) counts.set(k, counts.get(k) + 1)
  }
  const values = keys.map((k) => counts.get(k))
  return { labels, values, total: values.reduce((a, b) => a + b, 0) }
}

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
  const [expanded, setExpanded]   = useUrlParam('org')
  const [tab, setTab] = useUrlTab(TABS, 'register')
  const { refreshedAt, stamp } = useRefreshStamp()
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
      stamp()
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load organisations.'))
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [stamp])

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

  // A deep link (?org=<id>) opens the drawer, so its counts load too.
  useEffect(() => { if (expanded) loadOrgStats(expanded) }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const statusTile = (key) => { setFilterStatus(s => (s === key ? '' : key)); setTab('register') }
  const paged = usePaged(sorted, 20, `${search}|${filterPlan}|${filterStatus}|${sort?.key}|${sort?.dir}`)
  const openOrg = expanded ? orgs.find(o => o.id === expanded) : null
  const planBars = useMemo(() => PLANS.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: summary.byPlan[p] || 0 })), [summary])
  const countryShare = useMemo(() => {
    const rows = []
    for (const o of orgs) {
      const cs = (o.countries ?? []).length ? o.countries : (o.country ? [o.country] : [])
      for (const c of cs) rows.push({ c })
    }
    return topShare(rows, r => r.c, 8)
  }, [orgs])
  const created = useMemo(() => monthlyCreated(orgs), [orgs])
  const noContact = useMemo(() => orgs.filter(o => !o.contact_email).length, [orgs])
  const noCountry = useMemo(() => orgs.filter(o => !(o.countries ?? []).length && !o.country).length, [orgs])
  const ready = !loading && !loadError
  const attention = []
  if (ready && summary.locked) attention.push({ key: 'locked', tone: 'warning', title: `${summary.locked} organisation${summary.locked === 1 ? ' is' : 's are'} locked`, detail: 'Every member is blocked from the app. Confirm each lock is still intended.', action: { label: 'Show locked', onClick: () => { setFilterStatus('locked'); setTab('register') } } })
  if (ready && noContact) attention.push({ key: 'contact', tone: 'info', title: `${noContact} organisation${noContact === 1 ? ' has' : 's have'} no contact email`, detail: 'Nobody can be reached about billing, incidents or support for these tenants.' })
  if (ready && noCountry) attention.push({ key: 'country', tone: 'info', title: `${noCountry} organisation${noCountry === 1 ? ' has' : 's have'} no country`, detail: 'Country scope drives currency and reporting. Set at least a primary country.' })

  function orgActions(org) {
    return (
      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Btn size="xs" variant="quiet" icon={Edit2} title="Edit" ariaLabel={`Edit ${org.name}`} onClick={() => { setExpanded(null); openEdit(org) }} />
        <Btn size="xs" variant="quiet" icon={org.locked ? Unlock : Lock} title={org.locked ? 'Unlock' : 'Lock'}
          ariaLabel={`${org.locked ? 'Unlock' : 'Lock'} ${org.name}`} busy={busyId === org.id}
          onClick={() => { setExpanded(null); setLockError(null); setConfirmLock(org) }} />
        <Btn size="xs" variant="quiet" icon={Trash2} title="Delete" ariaLabel={`Delete ${org.name}`} disabled={busyId === org.id}
          onClick={() => { setExpanded(null); setDeleteError(null); setConfirmDelete(org) }} />
      </div>
    )
  }

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
      <PageHeader icon={Building2} title="Organisations"
        purpose="Companies on the platform, their plan, countries and access state."
        primary={<Btn variant="primary" icon={Plus} onClick={openCreate}>New Organisation</Btn>}
        actions={(
          <>
            <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={loading || !!loadError || sorted.length === 0}>Excel</Btn>
            <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={loading || !!loadError || sorted.length === 0}>PDF</Btn>
          </>
        )}
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      {exportError && <ErrorState message={exportError} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Organisations" icon={Building2} value={loading || loadError ? 'N/A' : summary.total}
          sub={loading ? 'Loading' : loadError ? 'Could not load' : 'All plans'} onClick={() => { setFilterStatus(''); setTab('register') }} active={!filterStatus} />
        <StatTile label="Active" tone="good" value={loading || loadError ? 'N/A' : summary.active}
          sub="Open for sign-in" onClick={() => statusTile('active')} active={filterStatus === 'active'} />
        <StatTile label="Locked" tone={summary.locked ? 'danger' : 'default'} value={loading || loadError ? 'N/A' : summary.locked}
          sub="Access blocked" onClick={() => statusTile('locked')} active={filterStatus === 'locked'} />
        <StatTile label="Inactive" tone="muted" value={loading || loadError ? 'N/A' : summary.inactive}
          sub="Switched off" onClick={() => statusTile('inactive')} active={filterStatus === 'inactive'} />
        <StatTile label="Enterprise plan" tone="accent" value={loading || loadError ? 'N/A' : (summary.byPlan.enterprise ?? 0)}
          sub={loading || loadError ? '' : `${summary.countries} countries covered`}
          onClick={() => { setFilterPlan(filterPlan === 'enterprise' ? '' : 'enterprise'); setTab('register') }} active={filterPlan === 'enterprise'} />
      </div>

      <Segmented ariaLabel="Organisation views" value={tab} onChange={setTab} options={[
        { key: 'register', label: 'Register', count: ready ? summary.total : null },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'register' && (
        <div role="tabpanel" aria-label="Register" className="space-y-4">
          <AttentionList ready={ready} items={attention} clearText="Every organisation is unlocked, reachable and has a country." />
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, slug, email..." className="flex-1 min-w-48" />
            <Select value={filterPlan} onChange={setFilterPlan} ariaLabel="Filter by plan" className="w-36"
              options={[{ value: '', label: 'All Plans' }, ...PLANS.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))]} />
            <Select value={filterStatus} onChange={setFilterStatus} ariaLabel="Filter by status" className="w-36"
              options={[{ value: '', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'locked', label: 'Locked' }, { value: 'inactive', label: 'Inactive' }]} />
          </Toolbar>

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
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <Table className="min-w-0 border-0 rounded-none">
                <THead>
                  <Th sortKey="name" sort={sort} onSort={onSort}>Organisation</Th>
                  <Th sortKey="plan" sort={sort} onSort={onSort}>Plan</Th>
                  <Th>Countries</Th>
                  <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                  <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </THead>
                <tbody>
                  {paged.pageRows.map(org => {
                    const countries = org.countries ?? []
                    return (
                      <Tr key={org.id} onClick={() => toggleExpand(org)} ariaLabel={`Open ${org.name}`}>
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
                        <Td nowrap><OrgStatusBadge org={org} /></Td>
                        <Td nowrap className="text-gray-400">{fmtDate(org.created_at)}</Td>
                        <Td align="right">{orgActions(org)}</Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pager {...paged} onPage={paged.setPage} />
            </div>
          )}
        </div>
      )}

      {tab === 'insights' && (
        <div role="tabpanel" aria-label="Insights" className="grid gap-4 lg:grid-cols-3">
          <Panel>
            <PanelHeader icon={BarChart3} title="Organisations by plan" subtitle="Current plan of every tenant" />
            {loading ? <LoadingState rows={3} /> : loadError ? <EmptyState title="Not available" reason="Organisations could not be read." /> : (
              <BarsChart bars={planBars} summary={planBars.map(b => `${b.label} ${b.value}`).join(', ')} emptyText="No organisations yet." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Globe} title="Countries covered" subtitle="Tenants per assigned country, top eight" />
            {loading ? <LoadingState rows={3} /> : loadError ? <EmptyState title="Not available" reason="Organisations could not be read." /> : (
              <BarsChart bars={countryShare.map(c => ({ label: c.label, value: c.value }))}
                summary={countryShare.map(c => `${c.label} ${c.value}`).join(', ')} emptyText="No country is assigned to any organisation." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Plus} title="New organisations per month" subtitle={ready ? `${created.total} in the last 12 months` : 'N/A'} />
            {loading ? <LoadingState rows={3} /> : loadError ? <EmptyState title="Not available" reason="Organisations could not be read." /> : (
              <TrendChart labels={created.labels} series={[{ label: 'Organisations', values: created.values }]} height={170}
                summary={`${created.total} organisations created in the last 12 months`} emptyText="No organisation was created in the last 12 months." />
            )}
          </Panel>
        </div>
      )}

      <Drawer open={!!openOrg} title={openOrg?.name} subtitle={openOrg?.slug || 'No slug'} onClose={() => setExpanded(null)}
        footer={openOrg ? orgActions(openOrg) : null}>
        {openOrg && (
          <>
            <div className="flex flex-wrap gap-2"><PlanBadge plan={openOrg.plan} /><OrgStatusBadge org={openOrg} /></div>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Users" value={orgStats[openOrg.id]?.users ?? 'Loading...'} icon={Users} />
              <Stat label="Tyre records" value={orgStats[openOrg.id]?.tyres ?? 'Loading...'} icon={Database} />
              <Stat label="Contact" value={openOrg.contact_email ?? 'N/A'} icon={Globe} />
              <Stat label="Plan" value={openOrg.plan ?? 'N/A'} icon={Eye} />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Countries</p>
              {(openOrg.countries ?? []).length ? (
                <div className="flex flex-wrap gap-1.5">{openOrg.countries.map(c => <Badge key={c}>{c}</Badge>)}</div>
              ) : <p className="text-xs text-gray-400">{openOrg.country ? `Primary only: ${openOrg.country}` : 'None set'}</p>}
            </div>
            <p className="text-xs text-gray-400">Created {fmtDate(openOrg.created_at)}</p>
            <Link to={`/console/users?org=${openOrg.id}`} className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              Manage this organisation&apos;s users <ArrowUpRight size={11} aria-hidden="true" />
            </Link>
          </>
        )}
      </Drawer>

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

function OrgStatusBadge({ org }) {
  if (org.locked) return <Badge tone="danger" icon={Lock}>Locked</Badge>
  return org.active ? <Badge tone="good" icon={CheckCircle}>Active</Badge> : <Badge icon={XCircle}>Inactive</Badge>
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
