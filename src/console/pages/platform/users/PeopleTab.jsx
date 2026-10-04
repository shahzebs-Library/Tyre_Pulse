/**
 * Users > People: the approved Users screen. Headline figures, Needs attention,
 * saved views and facets, the people table with bulk actions (every action
 * shows its impact first), and the sign-in / devices / deletions / support
 * summaries. Every write reuses an existing audited writer.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, UserX, Hourglass, Lock, Smartphone, Fingerprint, Eye, MoreHorizontal, Download,
  UserPlus, Upload, Bookmark, Plus, Columns, Filter, X, LogOut, MapPin, UserCog, Info,
} from 'lucide-react'
import {
  Btn, Panel, PanelHeader, Note, StatTile, SearchInput, Select, Segmented, LoadingState, ErrorState, EmptyState,
  ImpactBox, ConfirmImpactDialog,
} from '../../../components/ui'
import { Drawer } from '../../shared/pageKit'
import {
  shortName, initials, fmtRiyadh, countryLabel, sitesLabel, userKpis, userNeedsAttention, facetCounts, filterPeople,
  sortPeople, problemSummary, signInDistribution, isBelowMinimum, maskEmail,
} from '../../../../lib/consolePlatform'
import { bulkSetRole, adminSetUserSites } from '../../../../lib/api/adminAccess'
import { revokeUserSessions } from '../../../../lib/api/sessionRevocation'
import { approvePerson, setPersonLocked } from '../../../../lib/api/consolePlatform'
import { listCustomRoles } from '../../../../lib/api/customRoles'
import { ACCESS_ROLES } from '../../../../lib/moduleCatalog'
import { exportConsoleRows } from '../../../../lib/consoleTable'
import { toUserMessage } from '../../../../lib/safeError'
import { useConsoleAuth } from '../../../ConsoleAuthContext'
import { AttentionStrip, MovedHere, Pill, fmtNum } from '../PlatformKit'
import BulkCsvDialog from './BulkCsvDialog'

const PAGE = 50
const VIEWS_KEY = 'tp_console_user_views'

const PRESET_VIEWS = [
  { key: 'all', label: 'All people', f: {} },
  { key: 'week', label: 'Signed in this week', f: { signIn: '7d' } },
  { key: 'never', label: 'Never signed in', f: { signIn: 'never' } },
  { key: 'oldapp', label: 'Field staff on old app', f: { attention: 'old_app' } },
  { key: 'admins', label: 'Admins and supervisors', f: { roles: ['Admin', 'Manager', 'Director', 'Fleet Supervisor', 'Workshop Supervisor', 'Maintenance Supervisor'] } },
  { key: 'attention', label: 'Needs attention', f: { attention: 'any' } },
]

function readViews() {
  try { const v = JSON.parse(window.localStorage.getItem(VIEWS_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeViews(v) { try { window.localStorage.setItem(VIEWS_KEY, JSON.stringify(v)) } catch { /* per-viewer convenience only */ } }

const toSet = (arr) => new Set(Array.isArray(arr) ? arr : [])

function FacetGroup({ title, children }) {
  return (
    <fieldset className="border-t border-gray-800 pt-3 mt-3">
      <legend className="text-[11px] font-semibold text-gray-400 mb-1.5">{title}</legend>
      <div className="space-y-1">{children}</div>
    </fieldset>
  )
}

function FacetCheck({ label, count, checked, onChange, type = 'checkbox', name, muted }) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-100">
      <input type={type} name={name} checked={checked} onChange={onChange} className="accent-orange-500" />
      <span className={`flex-1 truncate ${muted ? 'text-gray-500' : ''}`}>{label}</span>
      <span className="text-[11px] text-gray-500 tabular-nums">{count}</span>
    </label>
  )
}

export default function PeopleTab({ data, onOpenManage }) {
  const { logAction } = useConsoleAuth() || {}
  const navigate = useNavigate()
  const { people = [], directoryOk, minVersion, orphans, orgs = [], deletions, supportCount } = data
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('last_sign_in')
  const [density, setDensity] = useState('comfortable')
  const [view, setView] = useState('all')
  const [views, setViews] = useState(readViews)
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(() => new Set())
  const [bulk, setBulk] = useState(null)       // 'approve' | 'role' | 'sites' | 'signout' | 'lock'
  const [bulkRole, setBulkRole] = useState('')
  const [bulkSites, setBulkSites] = useState('ALL')
  const [busy, setBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [toast, setToast] = useState('')
  const [roles, setRoles] = useState(ACCESS_ROLES)
  const [invite, setInvite] = useState(false)
  const [csv, setCsv] = useState(false)
  const [orphanOpen, setOrphanOpen] = useState(false)
  const [menu, setMenu] = useState(null)
  const [cols, setCols] = useState({ scope: true, device: true, mfa: true, problems: true })
  const [colsOpen, setColsOpen] = useState(false)

  useEffect(() => {
    listCustomRoles().then((r) => {
      const custom = (r || []).map((x) => x.name).filter(Boolean)
      setRoles([...new Set([...ACCESS_ROLES, ...custom])])
    }).catch(() => {})
  }, [])

  const now = data.loadedAt || Date.now()
  const orgName = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o.name])), [orgs])
  const kpis = useMemo(() => userKpis(people, { directoryOk, orgCount: new Set(people.map((p) => p.organisation_id || p.org_id).filter(Boolean)).size, now, minVersion }), [people, directoryOk, now, minVersion])
  const attention = useMemo(() => userNeedsAttention(people, { orphans, minVersion, directoryOk }), [people, orphans, minVersion, directoryOk])
  const facets = useMemo(() => facetCounts(people, now, minVersion), [people, now, minVersion])
  const active = { ...filters, search, roles: toSet(filters.roles), countries: toSet(filters.countries) }
  const filtered = useMemo(() => sortPeople(filterPeople(people, active, now, minVersion), sort, sort === 'name' || sort === 'role' ? 'asc' : 'desc'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, JSON.stringify(filters), search, sort, now, minVersion])
  const shown = filtered.slice(0, limit)
  const dist = useMemo(() => signInDistribution(people, now), [people, now])
  const selectedPeople = people.filter((p) => selected.has(p.id))

  function applyView(v) {
    setView(v.key)
    setFilters(v.f || {})
    setSearch(v.search || '')
    setLimit(PAGE)
  }
  function toggleIn(field, value) {
    setView('')
    setFilters((f) => {
      const cur = new Set(f[field] || [])
      if (cur.has(value)) cur.delete(value); else cur.add(value)
      return { ...f, [field]: [...cur] }
    })
  }
  function setOne(field, value) {
    setView('')
    setFilters((f) => ({ ...f, [field]: f[field] === value ? undefined : value }))
  }
  function saveView() {
    const label = window.prompt('Name this view')
    if (!label || !label.trim()) return
    const next = [...views, { key: `v${Date.now()}`, label: label.trim().slice(0, 60), f: filters, search }]
    setViews(next); writeViews(next)
  }
  function removeView(key) {
    const next = views.filter((v) => v.key !== key)
    setViews(next); writeViews(next)
  }

  function toggleSel(id) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id))
  function toggleAllShown() {
    setSelected((s) => {
      const n = new Set(s)
      if (allShownSelected) shown.forEach((p) => n.delete(p.id)); else shown.forEach((p) => n.add(p.id))
      return n
    })
  }

  async function exportList(rows, title = 'Users') {
    await exportConsoleRows({
      rows, title, columns: [
        { key: 'full_name', header: 'Name' },
        { key: 'role', header: 'Role' },
        { key: 'org', header: 'Organization', value: (p) => orgName[p.organisation_id || p.org_id] || '' },
        { key: 'country', header: 'Country', value: (p) => countryLabel(p) },
        { key: 'sites', header: 'Sites', value: (p) => sitesLabel(p) },
        { key: 'status', header: 'Status' },
        { key: 'last', header: 'Last sign-in (Riyadh)', value: (p) => fmtRiyadh(p.last_sign_in_at, { year: true }) || 'Never' },
        { key: 'phones', header: 'Phones', value: (p) => (p.signals ? p.signals.phones : 'N/A') },
        { key: 'app', header: 'App version', value: (p) => p.signals?.app_version || '' },
        { key: 'mfa', header: '2FA', value: (p) => (p.signals ? (p.signals.mfa ? 'On' : 'Off') : 'N/A') },
        { key: 'problems', header: 'Problems', value: (p) => problemSummary(p.signals).label },
      ],
    })
  }

  const bulkMeta = {
    approve: { title: `Approve ${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'}`, confirm: 'Approve', danger: false,
      change: 'They can sign in and use what their role allows.', undo: 'Yes. Lock the account again from the person page.' },
    role: { title: `Change role for ${selectedPeople.length}`, confirm: 'Change role', danger: false,
      change: bulkRole ? `Role becomes ${bulkRole}. What they see changes on their next page load.` : 'Pick a role first.', undo: 'Yes. Set the old role again; the audit log keeps the previous role.' },
    sites: { title: `Change sites for ${selectedPeople.length}`, confirm: 'Change sites', danger: false,
      change: bulkSites.trim().toUpperCase() === 'ALL' ? 'They see every site in their country.' : `They see only: ${bulkSites}.`, undo: 'Yes. Set the old sites again.' },
    signout: { title: `Sign out ${selectedPeople.length} everywhere`, confirm: 'Sign out everywhere', danger: false,
      change: 'Every web and phone session ends. They can sign in again straight away.', undo: 'No. They simply sign in again.' },
    lock: { title: `Lock ${selectedPeople.length} ${selectedPeople.length === 1 ? 'account' : 'accounts'}`, confirm: 'Lock', danger: true,
      change: 'Sign-in stops on web and phone. Role, sites and records stay (a suspend, not a delete).', undo: 'Yes. Unlock restores access with everything as it was.' },
  }

  async function runBulk({ reason }) {
    setBusy(true); setBulkError('')
    const ids = selectedPeople.map((p) => p.id)
    let ok = 0; const failed = []
    try {
      if (bulk === 'role') {
        await bulkSetRole(ids, bulkRole); ok = ids.length
      } else {
        for (const p of selectedPeople) {
          try {
            if (bulk === 'approve') await approvePerson(p.id, reason)
            else if (bulk === 'lock') await setPersonLocked(p.id, true, reason)
            else if (bulk === 'sites') {
              const list = bulkSites.trim().toUpperCase() === 'ALL' ? ['ALL'] : bulkSites.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
              await adminSetUserSites(p.id, list)
            } else if (bulk === 'signout') {
              const r = await revokeUserSessions(p.id, { reason })
              if (!r.ok) throw new Error(r.error)
            }
            ok += 1
          } catch (err) { failed.push(`${shortName(p.full_name)}: ${toUserMessage(err, 'failed')}`) }
        }
      }
      await logAction?.(`users_bulk_${bulk}`, null, 'user', { count: ids.length, ok, reason, role: bulk === 'role' ? bulkRole : undefined })
      setToast(`${bulkMeta[bulk].confirm}: ${ok} of ${ids.length} done.${failed.length ? ` ${failed.length} failed.` : ''}`)
      if (failed.length) setBulkError(failed.slice(0, 5).join(' | '))
      else { setBulk(null); setSelected(new Set()) }
      data.reload()
    } catch (err) {
      setBulkError(toUserMessage(err, 'The change could not be applied. Nothing was changed.'))
    } finally { setBusy(false) }
  }

  if (data.loading && !people.length) return <LoadingState label="Loading people" rows={8} />
  if (data.profilesError) return <ErrorState message={data.profilesError} onRetry={data.reload} />

  const selRoles = [...new Set(selectedPeople.map((p) => p.role))]
  const selNeverPhone = selectedPeople.filter((p) => !(p.signals?.phones > 0)).length
  const dense = density === 'compact'
  const allViews = [...PRESET_VIEWS, ...views.map((v) => ({ ...v, custom: true }))]
  const viewCount = (v) => filterPeople(people, { ...v.f, search: v.search, roles: toSet(v.f?.roles), countries: toSet(v.f?.countries) }, now, minVersion).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Btn icon={Upload} onClick={() => setCsv(true)}>Bulk update (CSV)</Btn>
        <Btn icon={Download} onClick={() => exportList(filtered, 'Users')}>Export</Btn>
        <Btn icon={UserPlus} variant="primary" onClick={() => setInvite(true)}>Invite user</Btn>
      </div>

      <MovedHere from={['Users', 'Sessions & Devices', 'Account Deletions', 'Support Sessions']}>
        Approve, lock, role, country and sites, bulk role, sign out everywhere, device list, clear push token, deletion requests and support sessions all live on this page or a person's page. The full editor is on the Edit and grants tab.
      </MovedHere>

      {!directoryOk && <Note tone="warning" icon={Info}>Sign-in times, phones and problem signals could not be loaded ({data.directoryError}). Those columns show N/A; the rest of the list is complete.</Note>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatTile icon={Users} label="Everyone" value={fmtNum(kpis.total)} sub={`${kpis.orgCount} organizations, +${kpis.joined30} in 30 days`} />
        <StatTile icon={UserCheck} label="Signed in, 30 days" value={fmtNum(kpis.signed30)} sub={kpis.signed30 == null ? 'N/A: sign-in data not loaded' : `${kpis.signed7} in 7 days, ${kpis.today} today (${kpis.signed30Pct}%)`} onClick={() => setOne('signIn', '30d')} active={filters.signIn === '30d'} />
        <StatTile icon={UserX} label="Never signed in" value={fmtNum(kpis.never)} sub={kpis.neverPct == null ? 'N/A' : `${kpis.neverPct}% of accounts`} tone={kpis.never > 0 ? 'warning' : 'default'} onClick={() => setOne('signIn', 'never')} active={filters.signIn === 'never'} />
        <StatTile icon={Hourglass} label="Waiting for approval" value={fmtNum(kpis.pending)} sub="New sign-ups need approval" onClick={() => setOne('status', 'pending')} active={filters.status === 'pending'} />
        <StatTile icon={Lock} label="Locked" value={fmtNum(kpis.locked)} sub="Suspended, reversible" onClick={() => setOne('status', 'locked')} active={filters.status === 'locked'} />
        <StatTile icon={Smartphone} label="Phones with the app" value={fmtNum(kpis.phones)} sub={kpis.phones == null ? 'N/A' : Object.entries(kpis.versionCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([v, n]) => `${n} on ${v}`).join(', ') || 'None registered'} />
        <StatTile icon={Fingerprint} label="Admins with 2FA" value={kpis.adminsMfa == null ? 'N/A' : `${kpis.adminsMfa} of ${kpis.admins}`} sub={kpis.othersMfa == null ? 'N/A' : `Everyone else: ${kpis.othersMfa} of ${kpis.total - kpis.admins}`} tone={kpis.adminsMfa != null && kpis.adminsMfa < kpis.admins ? 'danger' : 'good'} />
      </div>

      <AttentionStrip subtitle="People who hit a problem, from real records. Each line opens the filtered list."
        items={attention}
        empty={directoryOk ? 'Nothing needs attention right now.' : 'N/A: the problem signals could not be loaded.'}
        onAction={(it) => {
          if (it.filter) { setView(''); setFilters({ attention: it.filter }); setLimit(PAGE) }
          if (it.drawer === 'orphans') setOrphanOpen(true)
        }} />

      <div className="grid grid-cols-1 lg:grid-cols-[15rem_1fr] gap-4 items-start">
        <aside className="bg-gray-900/50 border border-gray-800 rounded-xl p-3" aria-label="Saved views and filters">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-200">Saved views</h2>
            <Btn size="xs" variant="quiet" icon={Plus} onClick={saveView} aria-label="Save current filters as a view" />
          </div>
          <ul className="space-y-0.5">
            {allViews.map((v) => (
              <li key={v.key} className="flex items-center gap-1">
                <button type="button" onClick={() => applyView(v)}
                  className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${view === v.key ? 'bg-orange-950/40 text-orange-300' : 'text-gray-300 hover:bg-gray-800/60'}`}>
                  <Bookmark size={12} aria-hidden="true" />
                  <span className="flex-1 truncate">{v.label}</span>
                  <span className="text-[11px] tabular-nums text-gray-500">{viewCount(v)}</span>
                </button>
                {v.custom && <button type="button" onClick={() => removeView(v.key)} aria-label={`Remove view ${v.label}`} className="p-1 text-gray-600 hover:text-gray-300"><X size={11} /></button>}
              </li>
            ))}
          </ul>
          <FacetGroup title="Role">
            {Object.entries(facets.roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
              <FacetCheck key={r} label={r} count={n} checked={(filters.roles || []).includes(r)} onChange={() => toggleIn('roles', r)} />
            ))}
          </FacetGroup>
          <FacetGroup title="Last sign-in">
            {[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['over30', 'Over 30 days ago'], ['never', 'Never']].map(([k, l]) => (
              <FacetCheck key={k} type="radio" name="signin" label={l} count={directoryOk ? facets.signIn[k] : 'N/A'} checked={filters.signIn === k} onChange={() => setOne('signIn', k)} />
            ))}
          </FacetGroup>
          <FacetGroup title="Country">
            {Object.entries(facets.countries).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <FacetCheck key={c} label={c} count={n} checked={(filters.countries || []).includes(c)} onChange={() => toggleIn('countries', c)} />
            ))}
          </FacetGroup>
          <FacetGroup title="Status">
            {[['active', 'Active'], ['pending', 'Waiting for approval'], ['locked', 'Locked']].map(([k, l]) => (
              <FacetCheck key={k} type="radio" name="status" label={l} count={facets.status[k]} checked={filters.status === k} onChange={() => setOne('status', k)} />
            ))}
          </FacetGroup>
          <FacetGroup title="Phone app">
            {!directoryOk ? <p className="text-[11px] text-gray-500">N/A: phone data not loaded.</p> : (
              <>
                {facets.versions.map((v) => (
                  <FacetCheck key={v.v} type="radio" name="ver" label={`${v.v}${v.below ? ' (below minimum)' : ''}`} count={v.n} checked={filters.version === v.v} onChange={() => setOne('version', v.v)} />
                ))}
                <FacetCheck type="radio" name="ver" label="No phone" muted count={facets.noPhone} checked={filters.version === '__none'} onChange={() => setOne('version', '__none')} />
              </>
            )}
          </FacetGroup>
        </aside>

        <section className="bg-gray-900/50 border border-gray-800 rounded-xl min-w-0" aria-label="People">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-800">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setLimit(PAGE) }} placeholder="Search name, username, employee number" className="w-full sm:w-72" />
            <Select value={sort} onChange={setSort} ariaLabel="Sort" className="w-44" options={[
              { value: 'last_sign_in', label: 'Sort: last sign-in' }, { value: 'problems', label: 'Sort: problems' },
              { value: 'name', label: 'Sort: name' }, { value: 'role', label: 'Sort: role' }, { value: 'created', label: 'Sort: newest account' },
            ]} />
            {Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v)) && (
              <Btn size="xs" icon={Filter} onClick={() => { setFilters({}); setView('all') }}>Clear filters</Btn>
            )}
            <div className="flex-1" />
            <Segmented role="group" ariaLabel="Row density" value={density} onChange={setDensity}
              options={[{ key: 'comfortable', label: 'Comfortable' }, { key: 'compact', label: 'Compact' }]} />
            <div className="relative">
              <Btn icon={Columns} onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}>Columns</Btn>
              {colsOpen && (
                <div className="absolute right-0 mt-1 z-20 bg-gray-950 border border-gray-800 rounded-lg p-2 w-44 space-y-1 shadow-xl">
                  {[['scope', 'Scope'], ['device', 'Device and app'], ['mfa', '2FA'], ['problems', 'Problems']].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-xs text-gray-300">
                      <input type="checkbox" className="accent-orange-500" checked={cols[k]} onChange={() => setCols((c) => ({ ...c, [k]: !c[k] }))} /> {l}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <Btn icon={Bookmark} onClick={saveView}>Save view</Btn>
          </div>

          {selectedPeople.length > 0 && (
            <div className="border-b border-orange-800/40 bg-orange-950/15 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-orange-300">{selectedPeople.length} selected</p>
                <p className="text-xs text-gray-400">{selRoles.length === 1 ? `all ${selRoles[0] || 'No role'}` : `${selRoles.length} roles`}</p>
                <div className="flex-1" />
                <Btn icon={UserCheck} onClick={() => setBulk('approve')}>Approve</Btn>
                <Btn icon={UserCog} onClick={() => { setBulkRole(''); setBulk('role') }}>Change role</Btn>
                <Btn icon={MapPin} onClick={() => setBulk('sites')}>Change sites</Btn>
                <Btn icon={LogOut} onClick={() => setBulk('signout')}>Sign out everywhere</Btn>
                <Btn icon={Download} onClick={() => exportList(selectedPeople, 'Selected users')}>Export</Btn>
                <Btn icon={Lock} variant="danger" onClick={() => setBulk('lock')}>Lock</Btn>
                <Btn size="xs" variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
              </div>
              <ImpactBox
                what={`You selected ${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'}. ${selNeverPhone === selectedPeople.length ? 'None has' : `${selectedPeople.length - selNeverPhone} ${selectedPeople.length - selNeverPhone === 1 ? 'has' : 'have'}`} signed in on a phone.`}
                change="Nothing until you pick an action. Each action shows its own count and asks for a reason."
                who={`${selectedPeople.slice(0, 4).map((p) => shortName(p.full_name)).join(', ')}${selectedPeople.length > 4 ? ` and ${selectedPeople.length - 4} more` : ''}.`}
                undo="Role, sites and approval can be undone. Lock is a suspend: role and records stay, unlock restores it. Sign out cannot be undone; they simply sign in again." />
            </div>
          )}

          {toast && <div className="px-3 pt-3"><Note tone="accent" icon={Info}>{toast}</Note></div>}

          {filtered.length === 0 ? (
            <div className="p-4"><EmptyState icon={Users} title="No one matches" reason="Nobody matches these filters. Clear a filter to widen the list." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[11px] text-gray-500 border-b border-gray-800">
                  <tr>
                    <th className="px-3 py-2 w-8"><input type="checkbox" className="accent-orange-500" aria-label="Select all shown" checked={allShownSelected} onChange={toggleAllShown} /></th>
                    <th className="px-2 py-2 text-left font-semibold">Name</th>
                    <th className="px-2 py-2 text-left font-semibold">Role</th>
                    {cols.scope && <th className="px-2 py-2 text-left font-semibold">Scope</th>}
                    <th className="px-2 py-2 text-left font-semibold">Status</th>
                    <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Last sign-in</th>
                    {cols.device && <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Device and app</th>}
                    {cols.mfa && <th className="px-2 py-2 text-left font-semibold">2FA</th>}
                    {cols.problems && <th className="px-2 py-2 text-left font-semibold">Problems</th>}
                    <th className="px-2 py-2 w-16 relative"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {shown.map((p) => {
                    const pr = problemSummary(p.signals)
                    const sel = selected.has(p.id)
                    const s = p.signals
                    const below = s?.phones > 0 && isBelowMinimum(s.app_version, minVersion)
                    return (
                      <tr key={p.id} className={`${sel ? 'bg-orange-950/15' : 'hover:bg-gray-800/30'}`}>
                        <td className={`px-3 ${dense ? 'py-1' : 'py-2'}`}><input type="checkbox" className="accent-orange-500" aria-label={`Select ${shortName(p.full_name)}`} checked={sel} onChange={() => toggleSel(p.id)} /></td>
                        <td className="px-2">
                          <button type="button" onClick={() => navigate(`/console/users/${p.id}`)} className="flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">
                            <span className="text-[10px] font-semibold text-gray-400 bg-gray-800 rounded px-1 py-0.5 w-6 text-center">{initials(p.full_name)}</span>
                            <span className="font-medium text-gray-200 whitespace-nowrap">{shortName(p.full_name)}</span>
                          </button>
                        </td>
                        <td className="px-2"><span className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${p.is_super_admin || p.role === 'Admin' ? 'border-orange-800/50 text-orange-300' : 'border-gray-700 text-gray-300'}`}>{p.role || 'No role'}{p.is_super_admin ? ' (super)' : ''}</span></td>
                        {cols.scope && (
                          <td className="px-2 leading-tight"><span className="text-gray-300">{countryLabel(p)}</span>{!dense && <span className="block text-[10px] text-gray-500 whitespace-nowrap">{orgName[p.organisation_id || p.org_id] || 'No organization'}, {sitesLabel(p)}</span>}</td>
                        )}
                        <td className="px-2"><Pill tone={p.status === 'active' ? 'good' : p.status === 'locked' ? 'danger' : 'warning'}>{p.status === 'active' ? 'Active' : p.status === 'locked' ? 'Locked' : 'Waiting'}</Pill></td>
                        <td className="px-2 whitespace-nowrap tabular-nums text-gray-300">{s ? (fmtRiyadh(p.last_sign_in_at) || <span className="text-gray-500">Never</span>) : 'N/A'}</td>
                        {cols.device && (
                          <td className="px-2 whitespace-nowrap text-gray-400">{!s ? 'N/A' : s.phones > 0 ? <span className={below ? 'text-amber-300' : ''}><Smartphone size={11} className="inline mr-1" aria-hidden="true" />{s.phones} {s.phones === 1 ? 'phone' : 'phones'}, {s.app_version || 'version unknown'}</span> : 'Web only'}</td>
                        )}
                        {cols.mfa && <td className="px-2">{!s ? 'N/A' : <Pill tone={s.mfa ? 'good' : 'muted'}>{s.mfa ? 'On' : 'Off'}</Pill>}</td>}
                        {cols.problems && <td className="px-2 whitespace-nowrap">{pr.score > 0 ? <Pill tone={pr.tone}>{pr.label}</Pill> : <span className="text-gray-500">{pr.label}</span>}</td>}
                        <td className="px-2 whitespace-nowrap relative">
                          <Btn size="xs" variant="quiet" icon={Eye} aria-label={`Open ${shortName(p.full_name)}`} onClick={() => navigate(`/console/users/${p.id}`)} />
                          <Btn size="xs" variant="quiet" icon={MoreHorizontal} aria-label={`More actions for ${shortName(p.full_name)}`} onClick={() => setMenu(menu === p.id ? null : p.id)} />
                          {menu === p.id && (
                            <div className="absolute right-6 z-20 mt-1 w-52 bg-gray-950 border border-gray-800 rounded-lg shadow-xl p-1 text-left">
                              <button type="button" className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800 rounded" onClick={() => { setMenu(null); navigate(`/console/users/${p.id}`) }}>Open person page</button>
                              <button type="button" className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800 rounded" onClick={() => { setMenu(null); setSelected(new Set([p.id])); setBulk('signout') }}>Sign out everywhere</button>
                              <button type="button" className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800 rounded" onClick={() => { setMenu(null); onOpenManage?.(p.id) }}>Edit in full editor</button>
                              <button type="button" className="w-full text-left px-2 py-1.5 text-xs text-red-300 hover:bg-gray-800 rounded" onClick={() => { setMenu(null); setSelected(new Set([p.id])); setBulk('lock') }}>Lock account</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 p-3 border-t border-gray-800 text-[11px] text-gray-500">
            <p className="flex-1 min-w-[16rem]">Showing {shown.length} of {filtered.length}{filtered.length !== people.length ? ` (${people.length} in total)` : ''}. Names are shortened and emails hidden here; open a person to see the full record. Times in Riyadh. Problems = returned work the person never opened, app errors in 30 days, or problems they reported.</p>
            {shown.length < filtered.length && <Btn size="xs" onClick={() => setLimit((l) => l + PAGE)}>Load {Math.min(PAGE, filtered.length - shown.length)} more</Btn>}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel>
          <PanelHeader title="When people last signed in" subtitle={`${fmtNum(people.length)} accounts`} />
          {!directoryOk ? <p className="text-xs text-gray-500">N/A: sign-in data could not be loaded.</p> : (
            <ul className="space-y-2">
              {[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['earlier', 'Earlier'], ['never', 'Never']].map(([k, l]) => {
                const n = dist[k]; const pct = people.length ? (n / people.length) * 100 : 0
                return (
                  <li key={k} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-xs">
                    <span className="text-gray-400">{l}</span>
                    <span className="h-1.5 rounded-full bg-gray-800 overflow-hidden"><span className={`block h-full ${k === 'never' ? 'bg-amber-500' : 'bg-orange-500'}`} style={{ width: `${Math.max(pct, n ? 1.5 : 0)}%` }} /></span>
                    <span className="text-right tabular-nums text-gray-200 font-semibold">{n}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Sessions and devices" actions={<Btn size="xs" onClick={() => onOpenManage?.(null, 'sessions')}>Open</Btn>} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><p className="text-[11px] text-gray-500">Active phones</p><p className="text-lg font-semibold text-gray-100 tabular-nums">{fmtNum(kpis.phones)}</p></div>
            <div><p className="text-[11px] text-gray-500">People with a phone</p><p className="text-lg font-semibold text-gray-100 tabular-nums">{directoryOk ? people.filter((p) => p.signals?.phones > 0).length : 'N/A'}</p></div>
            <div><p className="text-[11px] text-gray-500">Can get alerts</p><p className="text-lg font-semibold text-gray-100 tabular-nums">{directoryOk ? people.filter((p) => p.signals?.has_push).length : 'N/A'}</p></div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {Object.entries(kpis.versionCounts).sort((a, b) => b[1] - a[1]).map(([v, n]) => (
              <li key={v}><Pill tone={isBelowMinimum(v, minVersion) ? 'warning' : 'good'}>{v}: {n}</Pill></li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500 mt-3">Clearing a push token stops alerts to that phone. Do it from the person page or Sessions and devices.</p>
        </Panel>
        <Panel>
          <PanelHeader title="Account deletion requests" actions={<Btn size="xs" onClick={() => onOpenManage?.(null, 'deletions')}>Open</Btn>} />
          {deletions == null ? <p className="text-xs text-gray-500">N/A: requests could not be loaded.</p> : (
            <p className="text-xs text-gray-400">{deletions.length === 0 ? 'No one has asked to delete their account.' : `${deletions.length} request${deletions.length === 1 ? '' : 's'}, ${deletions.filter((d) => d.status === 'pending').length} pending.`} Requests from the app land here; you decide within 30 days. Company records they wrote are kept with their name removed.</p>
          )}
          <p className="text-[11px] text-gray-500 mt-2">Public page for the Play Store: tyrepulse.app/data-deletion</p>
        </Panel>
        <Panel>
          <PanelHeader title="Support sessions" actions={<Btn size="xs" onClick={() => onOpenManage?.(null, 'support')}>Open</Btn>} />
          <p className="text-xs text-gray-400">{supportCount == null ? 'N/A: could not be loaded.' : `${supportCount} recorded.`} Look at a company's data read only, for a set time, with a reason. Start one from a person's page.</p>
          <p className="text-[11px] text-gray-500 mt-2">Today a support session records the permission; seeing the app exactly as that person is still being built.</p>
        </Panel>
      </div>

      <ConfirmImpactDialog open={!!bulk} title={bulk ? bulkMeta[bulk].title : ''} danger={bulk ? bulkMeta[bulk].danger : false}
        confirmLabel={bulk ? bulkMeta[bulk].confirm : 'Confirm'} busy={busy} error={bulkError}
        requireReason typedWord={bulk === 'lock' ? `LOCK ${selectedPeople.length}` : (selectedPeople.length > 5 ? String(selectedPeople.length) : undefined)}
        onCancel={() => { if (!busy) { setBulk(null); setBulkError('') } }}
        onConfirm={(r) => { if (bulk === 'role' && !bulkRole) { setBulkError('Pick a role first.'); return } runBulk(r) }}
        impact={bulk ? {
          tone: bulkMeta[bulk].danger ? 'danger' : 'info',
          what: bulkMeta[bulk].title,
          change: bulkMeta[bulk].change,
          who: `${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'}: ${selectedPeople.slice(0, 5).map((p) => shortName(p.full_name)).join(', ')}${selectedPeople.length > 5 ? '...' : ''}`,
          undo: bulkMeta[bulk].undo,
        } : null}>
        {bulk === 'role' && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">New role</span>
            <Select value={bulkRole} onChange={setBulkRole} placeholder="Pick a role" options={roles.map((r) => ({ value: r, label: r }))} ariaLabel="New role" />
          </label>
        )}
        {bulk === 'sites' && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">Sites: ALL for every site, or a comma list</span>
            <input value={bulkSites} onChange={(e) => setBulkSites(e.target.value)} aria-label="Sites"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
          </label>
        )}
      </ConfirmImpactDialog>
      <Drawer open={invite} title="Invite a user" subtitle="Add someone to Tyre Pulse" onClose={() => setInvite(false)}
        footer={<><Btn onClick={() => setInvite(false)}>Close</Btn><Btn variant="primary" onClick={() => { try { navigator.clipboard?.writeText(`${window.location.origin}/login`) } catch { /* copy is a convenience */ } setToast('Sign-up link copied.') }}>Copy sign-up link</Btn></>}>
        <Note tone="warning" icon={Info}>
          Sending invitations is not built yet: creating a sign-in account needs a server step with the service key. Today people sign up themselves and wait in Waiting for approval, where you set their role, organization, country and sites.
        </Note>
        <ImpactBox what="How to add a person today"
          change="Share the sign-up link. When they register, approve them from Waiting for approval and set role, organization, country and sites."
          who="Only the person who signs up."
          undo="Yes. Lock or reject the account before approving." />
        <p className="text-[11px] text-gray-500">Registration is {`controlled on System Settings, Sign-in (registration_open and require_approval).`}</p>
      </Drawer>

      <Drawer open={orphanOpen} title="Sign-in accounts without a profile" subtitle="They can pass the password step but see nothing" onClose={() => setOrphanOpen(false)}>
        {orphans == null ? <ErrorState message="These accounts could not be loaded." onRetry={data.reload} /> : orphans.length === 0 ? (
          <EmptyState title="None" reason="Every sign-in account has a profile." />
        ) : (
          <>
            <Note tone="accent" icon={Info}>Emails are masked. Fixing one means creating its profile or removing the sign-in account on the server; neither is done from here.</Note>
            <ul className="divide-y divide-gray-800 text-xs">
              {orphans.map((o) => (
                <li key={o.id} className="py-2 flex items-center gap-3">
                  <span className="flex-1 text-gray-200">{o.email_masked || maskEmail('') || 'No email'}</span>
                  <span className="text-gray-500">created {fmtRiyadh(o.created_at, { year: true })}</span>
                  <span className="text-gray-400">{o.last_sign_in_at ? `signed in ${fmtRiyadh(o.last_sign_in_at)}` : 'never signed in'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Drawer>

      <BulkCsvDialog open={csv} onClose={() => setCsv(false)} people={people} roles={roles} onDone={() => { setCsv(false); data.reload() }} />
      {menu && <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(null)} />}
    </div>
  )
}
