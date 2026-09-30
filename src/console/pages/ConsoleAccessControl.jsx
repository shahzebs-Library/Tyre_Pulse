/**
 * ConsoleAccessControl.jsx - the one place that decides who can see and do
 * what, on the web app and the phone app (route /console/access, rendered inside
 * <ConsoleAuthBridge> so the main-app useAuth() resolves to a super admin here).
 *
 * Layout (owner-approved design):
 *   header with Check a person / Change history / Export / Save N changes
 *   headline figures (real counts, N/A when a read failed, never a fake 0)
 *   "Start here" tiles + the locked new-features policy card
 *   tabs: Roles and modules (web + phone matrix with staged changes), Web access,
 *   Mobile app access, People (one-click edit / delete), Custom roles, Access
 *   reviews, Temporary access, Approvals, Policies, New and not yet shared,
 *   Change history, plus "More tools" (checker, preview, country, bulk,
 *   delegations, capabilities, security).
 *
 * Nothing here re-implements access logic: writes go through the existing
 * writers (save_access_control_matrix / set_module_permissions /
 * set_user_access_grant / revoke_user_access_grant / custom role service), each
 * recorded by the access_audit triggers. ?tab= is deep-linkable, and every old
 * tab key (manager, grants, audit, effective, roles, security ...) still lands.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ShieldCheck, KeyRound, UserCog, UserCheck, Eye, Globe, Layers, Fingerprint, Wand2,
  SlidersHorizontal, Repeat2, ClipboardCheck, Timer, ArrowUpRight, LayoutGrid, Monitor, Smartphone,
  Users, Stamp, Lock, History, Download, Save, Search, UserPlus, Settings2, Sparkles,
} from 'lucide-react'
import { LoadingState, Btn, Panel, StatTile, Note } from '../components/ui'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { listProfiles } from '../../lib/api/users'
import { listGlobalPermissions, saveAccessControlMatrix } from '../../lib/api/modulePermissions'
import { listCustomRoles } from '../../lib/api/customRoles'
import { listAllGrants } from '../../lib/api/accessGrants'
import { countAccessChanges } from '../../lib/api/adminAccess'
import { toUserMessage } from '../../lib/safeError'
import { exportConsoleRows } from '../../lib/consoleTable'
import { ALL_MODULES } from '../../lib/moduleCatalog'
import {
  matrixColumns, mobileKeyFor, MOBILE_PREFIX, peopleByRole, phoneCell, stageKey, webCell,
} from '../../lib/accessOverview'

import PermissionMatrix from '../../pages/PermissionMatrix'
import CustomRolesManager from '../../pages/CustomRolesManager'
import SecurityCenter from '../../pages/SecurityCenter'
import RoleMatrix from './access/RoleMatrix'
import StagedChanges from './access/StagedChanges'
import PeopleGrants from './access/PeopleGrants'
import CustomRolesQuick from './access/CustomRolesQuick'
import NewNotShared, { useNewAreas } from './access/NewNotShared'
import WhoCanDoThis from './access/WhoCanDoThis'

const AccessManager = lazy(() => import('./access/AccessManager'))
const MobileAccessTab = lazy(() => import('./access/MobileAccessTab'))
const EffectivePermissions = lazy(() => import('./access/EffectivePermissions'))
const AccessPreviewOverride = lazy(() => import('./access/AccessPreviewOverride'))
const CountryScope = lazy(() => import('./access/CountryScope'))
const BulkOperations = lazy(() => import('./access/BulkOperations'))
const AccessAudit = lazy(() => import('./access/AccessAudit'))
const ApprovalDelegations = lazy(() => import('../../pages/ApprovalDelegations'))

const MAIN_TABS = [
  { key: 'roles', label: 'Roles and modules', icon: LayoutGrid },
  { key: 'web', label: 'Web access', icon: Monitor },
  { key: 'mobile', label: 'Mobile app access', icon: Smartphone },
  { key: 'people', label: 'People', icon: Users },
  { key: 'custom', label: 'Custom roles', icon: UserCog },
  { key: 'reviews', label: 'Access reviews', icon: ClipboardCheck },
  { key: 'temporary', label: 'Temporary access', icon: Timer },
  { key: 'approvals', label: 'Approvals', icon: Stamp },
  { key: 'policies', label: 'Policies', icon: Settings2 },
  { key: 'newareas', label: 'New and not yet shared', icon: Lock },
  { key: 'history', label: 'Change history', icon: History },
]

const MORE_TABS = [
  { key: 'check', label: 'Check a person', icon: Eye },
  { key: 'who', label: 'Who can do this', icon: Search },
  { key: 'preview', label: 'Preview and override', icon: SlidersHorizontal },
  { key: 'country', label: 'Country scope', icon: Globe },
  { key: 'bulk', label: 'Bulk changes', icon: Layers },
  { key: 'delegation', label: 'Delegations', icon: Repeat2 },
  { key: 'capabilities', label: 'Capabilities', icon: KeyRound },
  { key: 'security', label: 'Security', icon: Fingerprint },
]

// Old deep links keep working.
const ALIASES = { manager: 'web', grants: 'people', audit: 'history', effective: 'check' }
const ALL_KEYS = new Set([...MAIN_TABS, ...MORE_TABS].map((t) => t.key))

function TabFallback() {
  return <LoadingState label="Loading section" rows={4} />
}

function useLoad(fn) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try { setState({ data: await fn(), error: '', loading: false }) } catch (e) {
      setState({ data: null, error: toUserMessage(e, 'This could not be loaded.'), loading: false })
    }
  }, [fn])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

function LinkPanel({ icon: Icon, title, body, to, cta, children }) {
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <Icon size={18} className="text-orange-400 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0 space-y-2">
          <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
          <p className="text-xs text-gray-400 max-w-3xl">{body}</p>
          {children}
          <Link to={to} className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">
            {cta} <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Panel>
  )
}

function StartTile({ icon: Icon, title, body, cta, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left bg-gray-900/50 border border-gray-800 rounded-xl p-3 hover:border-gray-700 hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
      <div className="flex items-start gap-2">
        <span className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400"><Icon size={14} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-200">{title}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{body}</p>
          <p className="text-xs text-orange-400 mt-1.5 inline-flex items-center gap-1">{cta} <ArrowUpRight size={11} aria-hidden="true" /></p>
        </div>
      </div>
    </button>
  )
}

function fmt(v) { return v === null || v === undefined ? 'N/A' : String(v) }

export default function ConsoleAccessControl() {
  const { logAction } = useConsoleAuth() || {}
  const [params, setParams] = useSearchParams()
  const requested = ALIASES[params.get('tab')] || params.get('tab')
  const active = ALL_KEYS.has(requested) ? requested : 'roles'

  function selectTab(key) {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  const profilesQ = useLoad(listProfiles)
  const permsQ = useLoad(listGlobalPermissions)
  const rolesQ = useLoad(listCustomRoles)
  const grantsQ = useLoad(listAllGrants)
  const [changes30, setChanges30] = useState(null)
  useEffect(() => { countAccessChanges(30).then(setChanges30) }, [])

  const peopleCounts = useMemo(() => (profilesQ.data ? peopleByRole(profilesQ.data) : {}), [profilesQ.data])
  const columns = useMemo(() => matrixColumns(rolesQ.data || []), [rolesQ.data])
  const newAreas = useNewAreas(permsQ.data)

  // ── staged matrix changes ────────────────────────────────────────────────
  const [staged, setStaged] = useState({}) // stageKey -> enabled
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')

  const stagedList = useMemo(() => Object.entries(staged).map(([k, enabled]) => {
    const i = k.indexOf('|')
    return { role: k.slice(0, i), storedKey: k.slice(i + 1), enabled }
  }), [staged])

  const onToggle = useCallback((role, storedKey, next, current) => {
    setSaveNotice('')
    setStaged((s) => {
      const k = stageKey(role, storedKey)
      const n = { ...s }
      if (next === current) delete n[k]; else n[k] = next
      return n
    })
  }, [])

  const onUndo = useCallback((c) => setStaged((s) => { const n = { ...s }; delete n[stageKey(c.role, c.storedKey)]; return n }), [])

  async function saveStaged(reason) {
    setSaving(true); setSaveError('')
    try {
      const viewChanges = stagedList.map((c) => ({ role: c.role, module_key: c.storedKey, enabled: c.enabled }))
      await saveAccessControlMatrix({ viewChanges, reason })
      try { await logAction?.('access_matrix_save', null, 'module_permissions', { reason, changes: viewChanges }) } catch { /* audit best effort */ }
      setStaged({})
      setSaveNotice(`Saved ${viewChanges.length} ${viewChanges.length === 1 ? 'change' : 'changes'}. Each one is in Change history.`)
      await permsQ.reload()
      return true
    } catch (e) {
      setSaveError(toUserMessage(e, 'The changes could not be saved.'))
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── headline figures ─────────────────────────────────────────────────────
  const profiles = profilesQ.data
  const approved = profiles ? profiles.filter((p) => p.approved !== false && !p.locked).length : null
  const rolesInUse = profiles ? new Set(profiles.map((p) => p.role).filter(Boolean)).size : null
  const permRows = permsQ.data ? Object.values(permsQ.data).reduce((s, row) => s + Object.keys(row).length, 0) : null
  const phoneRows = permsQ.data ? Object.values(permsQ.data).reduce((s, row) => s + Object.keys(row).filter((k) => k.startsWith(MOBILE_PREFIX)).length, 0) : null
  const grants = grantsQ.data
  const grantPeople = grants ? new Set(grants.map((g) => g.user_id)).size : null
  const expiring = grants ? grants.filter((g) => g.expires_at).length : null

  async function exportRules() {
    const rows = []
    for (const c of columns) {
      for (const m of ALL_MODULES) {
        const w = webCell(permsQ.data, c.name, m.key)
        const mk = mobileKeyFor(m.key)
        const p = phoneCell(permsQ.data, c.name, mk)
        rows.push({
          role: c.name, area: m.label, key: m.key,
          web: w.on ? 'On' : 'Off', web_source: w.locked ? 'Always' : w.saved ? 'Saved rule' : 'Built-in default',
          phone: p ? (p.on ? 'On' : 'Off') : 'Web only', phone_source: !p ? 'N/A' : p.locked ? 'Always' : p.saved ? 'Saved rule' : 'Built-in default',
        })
      }
    }
    await exportConsoleRows({
      rows, title: 'Access rules by role',
      columns: [
        { key: 'role', header: 'Role' }, { key: 'area', header: 'Area' }, { key: 'key', header: 'Key' },
        { key: 'web', header: 'Web' }, { key: 'web_source', header: 'Web source' },
        { key: 'phone', header: 'Phone' }, { key: 'phone_source', header: 'Phone source' },
      ],
    })
  }

  const tabCounts = {
    people: grants ? grants.length : null,
    custom: rolesQ.data ? rolesQ.data.length : null,
    newareas: permsQ.data ? newAreas.length : null,
    roles: stagedList.length || null,
  }

  function renderTab() {
    switch (active) {
      case 'roles':
        return (
          <div className="space-y-4">
            {permsQ.loading ? <LoadingState label="Loading role rules" rows={6} /> : permsQ.error ? (
              <Panel><Note tone="danger">{permsQ.error}</Note><div className="mt-2"><Btn size="xs" onClick={permsQ.reload}>Retry</Btn></div></Panel>
            ) : (
              <RoleMatrix permMap={permsQ.data || {}} columns={columns} peopleCounts={peopleCounts} staged={staged} onToggle={onToggle} />
            )}
            <div id="staged-changes">
              <StagedChanges changes={stagedList} peopleCounts={peopleCounts} onUndo={onUndo}
                onDiscard={() => setStaged({})} onSave={saveStaged} saving={saving} error={saveError} notice={saveNotice} />
            </div>
          </div>
        )
      case 'web': return <Suspense fallback={<TabFallback />}><AccessManager /></Suspense>
      case 'mobile': return <Suspense fallback={<TabFallback />}><MobileAccessTab columns={columns} profiles={profiles || []} /></Suspense>
      case 'people':
        return <PeopleGrants grants={grants} profiles={profiles || []} loading={grantsQ.loading} error={grantsQ.error}
          onRetry={grantsQ.reload} onChanged={grantsQ.reload} />
      case 'custom':
        return (
          <div className="space-y-4">
            <CustomRolesQuick roles={rolesQ.data} peopleCounts={peopleCounts} loading={rolesQ.loading} error={rolesQ.error}
              onRetry={rolesQ.reload} onChanged={() => Promise.all([rolesQ.reload(), permsQ.reload()])} />
            <CustomRolesManager />
          </div>
        )
      case 'reviews':
        return <LinkPanel icon={ClipboardCheck} title="Access reviews" to="/console/access-reviews" cta="Open access reviews"
          body="Ask each manager to confirm who still needs the access they have. Reviews, their decisions and removals run on their own page." />
      case 'temporary':
        return (
          <div className="space-y-4">
            <LinkPanel icon={Timer} title="Temporary access" to="/console/jit-elevation" cta="Grant temporary access"
              body="One area for 5 to 480 minutes, with a reason. It ends by itself. People with an end date on an exception are listed in the People tab." />
            <Suspense fallback={<TabFallback />}><ApprovalDelegations /></Suspense>
          </div>
        )
      case 'approvals':
        return <LinkPanel icon={Stamp} title="Approvals (four-eyes)" to="/console/approvals" cta="Open approvals"
          body="When turned on, a second admin must approve data cleanup, restore and bulk role changes before they run." />
      case 'policies':
        return (
          <div className="space-y-4">
            <LinkPanel icon={Settings2} title="Sign-in and network policies" to="/console/access-policies" cta="Open policies"
              body="Console network allowlist and per-organisation single sign-on. Sign-in history and sessions are on the Security tool." />
            <LinkPanel icon={Lock} title="New features stay Admin only until shared" to="/console/access?tab=newareas" cta="Review new areas"
              body="Turn on the rule that keeps any area with no saved role rule hidden from every other role, and share areas one by one." />
          </div>
        )
      case 'newareas':
        return <NewNotShared permMap={permsQ.data} columns={columns} peopleCounts={peopleCounts} onShared={permsQ.reload} />
      case 'history': return <Suspense fallback={<TabFallback />}><AccessAudit /></Suspense>
      case 'who':
        return <WhoCanDoThis permMap={permsQ.data} columns={columns} peopleCounts={peopleCounts} grants={grants} profiles={profiles || []} />
      case 'check': return <Suspense fallback={<TabFallback />}><EffectivePermissions /></Suspense>
      case 'preview': return <Suspense fallback={<TabFallback />}><AccessPreviewOverride /></Suspense>
      case 'country': return <Suspense fallback={<TabFallback />}><CountryScope /></Suspense>
      case 'bulk': return <Suspense fallback={<TabFallback />}><BulkOperations /></Suspense>
      case 'delegation': return <Suspense fallback={<TabFallback />}><ApprovalDelegations /></Suspense>
      case 'capabilities': return <PermissionMatrix />
      case 'security': return <SecurityCenter />
      default: return null
    }
  }

  const activeMeta = [...MAIN_TABS, ...MORE_TABS].find((t) => t.key === active)

  return (
    <div className="space-y-5 max-w-[1400px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1><ShieldCheck size={18} className="text-orange-400" /> Access Control</h1>
          <p className="text-xs text-gray-400 mt-1 max-w-3xl">
            The one place that decides who can see and do what, on the web app and the phone app. Every change is
            previewed first, needs a reason, and can be undone.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={Search} onClick={() => selectTab('check')}>Check a person</Btn>
          <Btn icon={History} onClick={() => selectTab('history')}>Change history</Btn>
          <Btn icon={Download} disabled={!permsQ.data} onClick={exportRules}>Export</Btn>
          <Btn variant="primary" icon={Save} disabled={!stagedList.length}
            onClick={() => { selectTab('roles'); setTimeout(() => document.getElementById('staged-changes')?.scrollIntoView({ behavior: 'smooth' }), 0) }}>
            {stagedList.length ? `Save ${stagedList.length} ${stagedList.length === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}
          </Btn>
        </div>
      </header>

      <section aria-label="Access figures" className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
        <StatTile label="People who can sign in" value={fmt(approved)} />
        <StatTile label="Roles in use" value={rolesInUse == null ? 'N/A' : `${rolesInUse} of ${columns.length}`} />
        <StatTile label="Custom roles" value={fmt(rolesQ.data?.length)} />
        <StatTile label="Area rules saved" value={fmt(permRows)} sub={phoneRows == null ? undefined : `${phoneRows} phone`} />
        <StatTile label="Person exceptions" value={fmt(grants?.length)} sub={grantPeople == null ? undefined : `${grantPeople} people`} onClick={() => selectTab('people')} />
        <StatTile label="Exceptions that expire" value={grants ? `${expiring} of ${grants.length}` : 'N/A'} tone={grants && grants.length && !expiring ? 'warning' : 'default'} />
        <StatTile label="Access changes 30d" value={fmt(changes30)} onClick={() => selectTab('history')} />
        <StatTile label="New, not shared" value={permsQ.data ? newAreas.length : 'N/A'} tone={newAreas.length ? 'accent' : 'default'} onClick={() => selectTab('newareas')} />
      </section>

      <section aria-label="Start here" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StartTile icon={UserCheck} title="What can this person do?" body="Pick anyone, see every screen on web and phone and why." cta="Check a person" onClick={() => selectTab('check')} />
        <StartTile icon={Search} title="Who can do this?" body="Pick an area, see which roles and people reach it." cta="Look up an area" onClick={() => selectTab('who')} />
        <StartTile icon={UserPlus} title="Give one person more, or less" body="An exception for one person, with an end date." cta="Add exception" onClick={() => selectTab('people')} />
        <StartTile icon={Wand2} title="Change what a whole role can do" body="Edit the matrix, preview, then save." cta="Edit roles" onClick={() => selectTab('roles')} />
        <button type="button" onClick={() => selectTab('newareas')}
          className="text-left rounded-xl p-3 border border-orange-600/50 bg-orange-500/5 hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          <p className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Lock size={14} className="text-orange-400" aria-hidden="true" />New features: Admin and Super Admin only</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Any area with no saved role rule can be kept hidden from every other role until it is shared here.</p>
          <p className="text-xs text-orange-400 mt-1.5 inline-flex items-center gap-1">
            <Sparkles size={11} aria-hidden="true" /> Review {permsQ.data ? newAreas.length : ''} waiting <ArrowUpRight size={11} aria-hidden="true" />
          </p>
        </button>
      </section>

      <nav aria-label="Access Control sections" className="space-y-2">
        <div role="tablist" aria-label="Access Control tabs" className="flex flex-wrap gap-1 border-b border-gray-800">
          {MAIN_TABS.map((t) => {
            const Icon = t.icon
            const on = t.key === active
            const count = tabCounts[t.key]
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => selectTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                  on ? 'border-orange-500 text-orange-300 font-medium' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <Icon size={13} aria-hidden="true" />{t.label}
                {count != null && <span className="tabular-nums text-[10px] px-1 rounded bg-gray-800 text-gray-400">{count}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500 mr-1">More tools:</span>
          {MORE_TABS.map((t) => {
            const Icon = t.icon
            const on = t.key === active
            return (
              <button key={t.key} type="button" onClick={() => selectTab(t.key)} aria-pressed={on}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                  on ? 'border-orange-600/50 bg-orange-500/15 text-orange-200' : 'border-gray-800 text-gray-400 hover:text-gray-200'}`}>
                <Icon size={12} aria-hidden="true" />{t.label}
              </button>
            )
          })}
        </div>
        {profilesQ.error && <Note tone="warning">People could not be loaded, so people counts show N/A. {profilesQ.error}</Note>}
      </nav>

      <div role="tabpanel" aria-label={activeMeta?.label}>
        {renderTab()}
      </div>
    </div>
  )
}
