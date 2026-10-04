/**
 * ConsoleFeatureFlags.jsx - Feature Flags (/console/flags).
 *
 * One registry for every web module, the organisation feature flags, the
 * boolean platform switches and the phone screens: state, kind and expected
 * life, who gets it (web vs phone), measured usage, stale detection, sharing a
 * new admin-only area with roles, and turning a module off Now or on a
 * Schedule (flag_changes + a one-minute cron; needs a second super admin when
 * dual control is on).
 *
 * Replaces Module Control. Nothing removed: the old page is the "Module
 * Control" tab (?tab=modules, its own sub-tab in ?sub=) and its route
 * redirects here.
 *
 * Honest gaps shown on screen: phones do not read module state (turning a
 * module off hides it on the web only), organisation flags are one global
 * set (no per-organisation overrides exist), there is no country or
 * percentage rollout, module state history before scheduled changes is not
 * recorded, and depends_on is empty so dependencies are only suggested.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Flag, Lock, Layers, Building2, CalendarClock, Clock, AlertTriangle, CheckCircle2, Share2, Power,
  Wrench, Plus, Info, ShieldCheck, Users, Smartphone, Globe, X, Timer,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Toolbar, Segmented, SearchInput, Select, Modal,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, useUrlTab, TabBar, TabPanel, Drawer, DetailList, ConsoleLink, usePaged, Pager } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import { NAV_CATALOG } from '../../components/Layout'
import { governingModuleKey } from '../../lib/navAccess'
import { listGlobalPermissions, saveModulePermissions } from '../../lib/api/modulePermissions'
import { buildShareChanges } from '../../lib/accessOverview'
import { fetchFlags, saveFlags } from '../../lib/featureFlags'
import { setModuleStatus, bulkSetStatus } from '../../lib/api/modulesRegistry'
import { saveSystemConfigValues } from '../../lib/api/systemConfig'
import { getNewFeaturesPolicy } from '../../lib/api/adminAccess'
import {
  getFlagUsage, listModulesWithKind, listBooleanConfig, listFlagChanges, scheduleFlagChange,
  approveFlagChange, cancelFlagChange, setModuleKind,
} from '../../lib/api/engineeringCenter'
import {
  buildFlagRows, facetCounts, filterFlagRows, turnOffImpact, audienceText,
  KIND_LABEL, TYPE_LABEL, STATE_LABEL, LIFECYCLE_LABEL, RELEASE_REVIEW_DAYS,
} from '../../lib/featureFlagsCenter'
import { fmtInt, riyadhTime, riyadhDay } from '../../lib/engineeringCenter'
import { toUserMessage } from '../../lib/safeError'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ConsoleModuleControl = lazy(() => import('./ConsoleModuleControl'))

const TABS = ['flags', 'changes', 'orgs', 'modules']
const STATE_TONE = { live: 'good', on: 'good', beta: 'info', maintenance: 'warning', disabled: 'danger', off: 'quiet', unknown: 'quiet' }
const LIFE_TONE = { new_admin: 'accent', new_shared: 'info', active: 'default', stale: 'warning' }
const CHANGE_TONE = { scheduled: 'info', awaiting_approval: 'warning', applied: 'good', cancelled: 'quiet', failed: 'danger' }
const CHANGE_LABEL = { scheduled: 'Scheduled', awaiting_approval: 'Waiting for approval', applied: 'Applied', cancelled: 'Cancelled', failed: 'Failed' }

/** How many sidebar pages each module key governs. */
const NAV_COUNT = (() => {
  const out = {}
  for (const g of NAV_CATALOG) for (const it of g.items) {
    const k = governingModuleKey(it.key)
    if (k) out[k] = (out[k] || 0) + 1
  }
  return out
})()

const FACETS = [
  { key: 'types', label: 'Type', from: 'type', labels: TYPE_LABEL },
  { key: 'states', label: 'State', from: 'state', labels: { on: 'On or live', maintenance: 'Maintenance', off: 'Off', admin_only: 'Admin only', unknown: 'Unknown' } },
  { key: 'kinds', label: 'Kind', from: 'kind', labels: KIND_LABEL },
  { key: 'lifecycles', label: 'Lifecycle', from: 'lifecycle', labels: LIFECYCLE_LABEL },
]

const toLocalInput = (d) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return t.toISOString().slice(0, 16)
}

export default function ConsoleFeatureFlags() {
  const [tab, setTab] = useUrlTab(TABS, 'flags')
  const { logAction } = useConsoleAuth()
  const [data, setData] = useState({ loading: true, error: '', modules: [], permMap: {}, orgFlags: null, config: [], usage: null, changes: [] })
  const [policy, setPolicy] = useState({ enabled: false, known: false })
  const [readAt, setReadAt] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: '' }))
    try {
      const [modules, permMap, orgFlags, config, usage, changes] = await Promise.all([
        listModulesWithKind(), listGlobalPermissions(), fetchFlags({ force: true }), listBooleanConfig(), getFlagUsage(), listFlagChanges(100),
      ])
      setData({ loading: false, error: '', modules, permMap, orgFlags, config, usage, changes })
      setReadAt(Date.now())
    } catch (e) {
      setData((d) => ({ ...d, loading: false, error: toUserMessage(e, 'Feature flags could not be read.') }))
    }
    getNewFeaturesPolicy().then(setPolicy).catch(() => setPolicy({ enabled: false, known: false }))
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => buildFlagRows({
    modules: data.modules, permMap: data.permMap, orgFlags: data.orgFlags, config: data.config, usage: data.usage,
  }), [data])
  const counts = useMemo(() => facetCounts(rows), [rows])

  const [facets, setFacets] = useState({ types: [], states: [], kinds: [], lifecycles: [], categories: [] })
  const [search, setSearch] = useState('')
  const visible = useMemo(() => filterFlagRows(rows, { ...facets, search }), [rows, facets, search])
  const paged = usePaged(visible, 25, JSON.stringify(facets) + search)
  const toggleFacet = (group, value) => setFacets((f) => ({
    ...f, [group]: f[group].includes(value) ? f[group].filter((v) => v !== value) : [...f[group], value],
  }))
  const clearFacets = () => { setFacets({ types: [], states: [], kinds: [], lifecycles: [], categories: [] }); setSearch('') }

  const [selected, setSelected] = useState(() => new Set())
  const [detail, setDetail] = useState(null)
  const [offRow, setOffRow] = useState(null)
  const [switchRow, setSwitchRow] = useState(null)
  const [shareRow, setShareRow] = useState(null)
  const [bulk, setBulk] = useState(null) // 'disabled' | 'maintenance' | 'snooze'
  const [newOpen, setNewOpen] = useState(false)

  const done = (text) => { setFlash({ tone: 'ok', text }); load() }
  const fail = (e) => setFlash({ tone: 'bad', text: toUserMessage(e) })

  const modulesOnly = rows.filter((r) => r.type === 'module')
  const kpi = {
    modules: modulesOnly.length,
    modulesLive: modulesOnly.filter((r) => r.state === 'live').length,
    orgFlags: rows.filter((r) => r.type === 'org_flag').length,
    orgOn: rows.filter((r) => r.type === 'org_flag' && r.state === 'on').length,
    switches: rows.filter((r) => r.type === 'switch').length,
    newAdmin: counts.lifecycle.new_admin || 0,
    stale: counts.lifecycle.stale || 0,
    orgs: data.usage?.orgs?.length ?? null,
  }
  const pending = data.changes.filter((c) => c.status === 'scheduled' || c.status === 'awaiting_approval')
  const dualOn = data.usage?.dual_control === true

  const exportRows = visible.map((r) => ({
    name: r.name, key: r.key, type: TYPE_LABEL[r.type], state: STATE_LABEL[r.state] || r.state,
    kind: KIND_LABEL[r.kind], review: r.review ? riyadhDay(r.review) : 'N/A', audience: audienceText(r),
    usage: r.usage || 'Not measured', lifecycle: LIFECYCLE_LABEL[r.lifecycle], changed: r.changedAt ? riyadhTime(r.changedAt) : 'N/A',
  }))

  const selectedModules = modulesOnly.filter((r) => selected.has(r.id))

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Flag} title="Feature Flags"
        purpose="Every module, organisation flag, platform switch and phone screen in one list: who gets it, whether it is used, and turning it off now or on a schedule."
        refreshedAt={readAt} onRefresh={load} refreshing={data.loading}
        actions={(<>
          <ExportButtons rows={exportRows} title="Feature flags" disabled={!!data.error} columns={[
            { key: 'name', header: 'Name' }, { key: 'key', header: 'Key' }, { key: 'type', header: 'Type' },
            { key: 'state', header: 'State' }, { key: 'kind', header: 'Kind' }, { key: 'review', header: 'Review by' },
            { key: 'audience', header: 'Who gets it' }, { key: 'usage', header: 'Usage' }, { key: 'lifecycle', header: 'Lifecycle' },
            { key: 'changed', header: 'Last changed' },
          ]} />
          <Btn icon={Plus} variant="primary" onClick={() => setNewOpen(true)}>New flag</Btn>
        </>)} />

      {flash && <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>{flash.text}</Note>}

      <Panel>
        <div className="p-4 flex flex-wrap items-start gap-3">
          <Lock size={16} className="text-orange-300 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[16rem]">
            <p className="text-sm font-semibold text-gray-100">New things start visible only to Admin and Super Admin</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Owner rule. A new area stays admin-only until you share it with roles below.
              {' '}{policy.known ? (policy.enabled ? 'The app enforces this now.' : 'The switch that makes the web app enforce it is off.') : 'The switch could not be read.'}
            </p>
          </div>
          <Badge tone={policy.enabled ? 'good' : 'warning'} icon={ShieldCheck}>{policy.known ? (policy.enabled ? 'Enforced' : 'Policy only') : 'N/A'}</Badge>
          <ConsoleLink to="/console/access?tab=newareas">Change in Access Control</ConsoleLink>
        </div>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Modules" icon={Layers} value={data.loading ? 'N/A' : fmtInt(kpi.modules)} sub={data.loading ? undefined : `${fmtInt(kpi.modulesLive)} live`}
          onClick={() => setFacets((f) => ({ ...f, types: ['module'] }))} />
        <StatTile label="Organisation flags" icon={Flag} value={data.loading ? 'N/A' : fmtInt(kpi.orgFlags)} sub={data.loading ? undefined : `${fmtInt(kpi.orgOn)} on`}
          onClick={() => setFacets((f) => ({ ...f, types: ['org_flag'] }))} />
        <StatTile label="Platform switches" icon={Power} value={data.loading ? 'N/A' : fmtInt(kpi.switches)}
          onClick={() => setFacets((f) => ({ ...f, types: ['switch'] }))} />
        <StatTile label="New, admin-only" icon={Lock} tone={kpi.newAdmin ? 'accent' : 'default'} value={data.loading ? 'N/A' : fmtInt(kpi.newAdmin)}
          sub="Not shared with any role yet" onClick={() => setFacets((f) => ({ ...f, lifecycles: ['new_admin'] }))} />
        <StatTile label="Stale" icon={Clock} tone={kpi.stale ? 'warning' : 'default'} value={data.loading ? 'N/A' : fmtInt(kpi.stale)}
          sub="Unused or past review" onClick={() => setFacets((f) => ({ ...f, lifecycles: ['stale'] }))} />
        <StatTile label="Per-organisation overrides" icon={Building2} value="N/A"
          sub={kpi.orgs === null ? 'Not supported' : `${fmtInt(kpi.orgs)} organisations; overrides not built`} onClick={() => setTab('orgs')} />
      </div>

      <TabBar value={tab} onChange={setTab} label="Feature flag sections" tabs={[
        { key: 'flags', label: 'All flags', count: data.loading ? undefined : rows.length },
        { key: 'changes', label: 'Scheduled changes', count: data.loading ? undefined : pending.length },
        { key: 'orgs', label: 'Organisations and rollout' },
        { key: 'modules', label: 'Module Control' },
      ]} />

      {tab === 'flags' && (
        <TabPanel label="All flags">
          {data.error ? <ErrorState message={data.error} onRetry={load} /> : (
            <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
              <aside aria-label="Filters" className="space-y-3">
                {FACETS.map((f) => (
                  <Panel key={f.key}>
                    <fieldset className="p-3">
                      <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{f.label}</legend>
                      {Object.entries(counts[f.from === 'state' ? 'state' : f.from] || {}).map(([value, n]) => (
                        <label key={value} className="flex items-center gap-2 py-0.5 text-xs text-gray-300 cursor-pointer">
                          <input type="checkbox" checked={facets[f.key].includes(value)} onChange={() => toggleFacet(f.key, value)}
                            className="accent-orange-500" />
                          <span className="flex-1">{f.labels[value] || value}</span>
                          <span className="tabular-nums text-gray-500">{n}</span>
                        </label>
                      ))}
                    </fieldset>
                  </Panel>
                ))}
                <Panel>
                  <div className="p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Category</p>
                    <Select value={facets.categories[0] || ''} placeholder="All categories" ariaLabel="Category"
                      onChange={(v) => setFacets((f) => ({ ...f, categories: v ? [v] : [] }))}
                      options={Object.entries(counts.category).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ value: c, label: `${c} (${n})` }))} />
                  </div>
                </Panel>
              </aside>

              <Panel className="min-w-0">
                <PanelHeader icon={Flag} title="Flags" subtitle="Select a row to see who gets it, its kind and its history."
                  actions={(
                    <Toolbar>
                      <SearchInput value={search} onChange={setSearch} placeholder="Search name or key" className="w-full sm:w-56" ariaLabel="Search flags" />
                      <Btn onClick={clearFacets}>Clear filters</Btn>
                    </Toolbar>
                  )} />
                {selectedModules.length > 0 && (
                  <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-2">
                    <span className="text-xs text-gray-300">{selectedModules.length} modules selected</span>
                    <Btn icon={Power} variant="danger" onClick={() => setBulk('disabled')}>Turn off</Btn>
                    <Btn icon={Wrench} onClick={() => setBulk('maintenance')}>Maintenance</Btn>
                    <Btn icon={Timer} onClick={() => setBulk('snooze')}>Snooze review 30 days</Btn>
                    <Btn icon={X} variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
                  </div>
                )}
                {data.loading ? <LoadingState label="Reading flags" rows={8} /> : visible.length === 0 ? (
                  <EmptyState icon={Flag} title="No flags match" reason="Clear the filters or the search to see every flag." action={<Btn onClick={clearFacets}>Clear filters</Btn>} />
                ) : (
                  <>
                    <Table>
                      <THead>
                        <Th><span className="sr-only">Select</span></Th>
                        <Th>Name</Th><Th>State</Th><Th>Kind</Th><Th>Who gets it</Th><Th>Usage</Th><Th>Lifecycle</Th>
                      </THead>
                      <tbody>
                        {paged.rows.map((r) => (
                          <Tr key={r.id} onClick={() => setDetail(r)} ariaLabel={`Open ${r.name}`}>
                            <Td>
                              {r.type === 'module' && (
                                <input type="checkbox" aria-label={`Select ${r.name}`} className="accent-orange-500"
                                  checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()}
                                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} />
                              )}
                            </Td>
                            <Td className="min-w-[12rem]">
                              <p className="text-gray-100">{r.name}</p>
                              <p className="text-[11px] text-gray-500 font-mono">{TYPE_LABEL[r.type]} - {r.key}</p>
                            </Td>
                            <Td nowrap>
                              <StateControl row={r} onModule={(state) => (state === 'live' ? applyModule(r, 'live') : setOffRow({ ...r, target: state }))}
                                onSwitch={() => setSwitchRow(r)} />
                            </Td>
                            <Td nowrap>
                              <span className="text-gray-300">{KIND_LABEL[r.kind]}</span>
                              {r.review && <p className="text-[11px] text-gray-500">Review {riyadhDay(r.review)}</p>}
                            </Td>
                            <Td className="text-gray-300">
                              {r.adminOnly && <Badge tone="accent" icon={Lock}>Admin only</Badge>} {audienceText(r)}
                            </Td>
                            <Td className="text-gray-400">{r.usage || 'Not measured'}</Td>
                            <Td nowrap>
                              <Badge tone={LIFE_TONE[r.lifecycle]}>{LIFECYCLE_LABEL[r.lifecycle]}</Badge>
                              {r.stale && <p className="text-[11px] text-amber-300 mt-0.5">{r.stale.reason}</p>}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <Pager paged={paged} label="flags" />
                  </>
                )}
              </Panel>
            </div>
          )}
        </TabPanel>
      )}

      {tab === 'changes' && (
        <TabPanel label="Scheduled changes">
          <ChangesPanel changes={data.changes} loading={data.loading} error={data.error} onRetry={load} dualOn={dualOn}
            rows={rows} logAction={logAction} onDone={done} onFail={fail} />
        </TabPanel>
      )}

      {tab === 'orgs' && (
        <TabPanel label="Organisations and rollout">
          <OrgsPanel usage={data.usage} loading={data.loading} error={data.error} onRetry={load} />
        </TabPanel>
      )}

      {tab === 'modules' && (
        <TabPanel label="Module Control">
          <Suspense fallback={<LoadingState label="Loading Module Control" />}>
            <ConsoleModuleControl tabParam="sub" />
          </Suspense>
        </TabPanel>
      )}

      <FlagDrawer row={detail} changes={data.changes} onClose={() => setDetail(null)}
        onTurnOff={() => { setOffRow({ ...detail, target: 'disabled' }); setDetail(null) }}
        onShare={() => { setShareRow(detail); setDetail(null) }}
        onKindSaved={(t) => { setDetail(null); done(t) }} onFail={fail} logAction={logAction} />

      <TurnOffDialog row={offRow} dualOn={dualOn} onClose={() => setOffRow(null)} logAction={logAction}
        onDone={(t) => { setOffRow(null); done(t) }} onMaintenance={(r) => setOffRow({ ...r, target: 'maintenance' })} />

      <SwitchDialog row={switchRow} dualOn={dualOn} orgFlags={data.orgFlags} onClose={() => setSwitchRow(null)} logAction={logAction}
        onDone={(t) => { setSwitchRow(null); done(t) }} />

      <ShareDialog row={shareRow} usage={data.usage} onClose={() => setShareRow(null)} logAction={logAction}
        onDone={(t) => { setShareRow(null); done(t) }} />

      <BulkDialog mode={bulk} rows={selectedModules} onClose={() => setBulk(null)} logAction={logAction}
        onDone={(t) => { setBulk(null); setSelected(new Set()); done(t) }} />

      <Modal open={newOpen} title="New flag" onClose={() => setNewOpen(false)} width="max-w-lg"
        footer={<Btn onClick={() => setNewOpen(false)}>Close</Btn>}>
        <div className="space-y-2 text-xs text-gray-300">
          <p>A module appears here on its own when its page is added to the app: the registry is filled from the navigation.</p>
          <p>Mark it as a Release while it rolls out: it then shows a review date {RELEASE_REVIEW_DAYS} days after it was added, and turns Stale if it is still here after that.</p>
          <p>New organisation flags and platform switches need a code change (the app has to read them), so they cannot be created from this screen.</p>
          <p>Every new area starts visible only to Admin and Super Admin until you share it.</p>
        </div>
      </Modal>
    </div>
  )

  async function applyModule(r, state) {
    try {
      await setModuleStatus(r.key, state)
      try { await logAction?.('module_status', null, 'module', { module: r.key, from: r.state, to: state }) } catch { /* audit best effort */ }
      done(`${r.name} is now ${STATE_LABEL[state] || state}.`)
    } catch (e) { fail(e) }
  }
}

/* ── state control ─────────────────────────────────────────────────────── */

function StateControl({ row, onModule, onSwitch }) {
  if (row.type === 'module') {
    return (
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
        <Segmented ariaLabel={`State of ${row.name}`} role="group" value={row.state === 'beta' ? 'live' : row.state}
          onChange={(v) => { if (v !== row.state) onModule(v) }}
          options={[{ key: 'live', label: 'Live' }, { key: 'maintenance', label: 'Maint' }, { key: 'disabled', label: 'Off' }]} />
      </span>
    )
  }
  if (row.type === 'switch' || row.type === 'org_flag') {
    const on = row.state === 'on'
    return (
      <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
        <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state] || 'N/A'}</Badge>
        {row.guarded ? <Lock size={12} className="text-gray-500" aria-label="Guarded" /> : row.state !== 'unknown' && (
          <Btn size="xs" onClick={onSwitch}>{on ? 'Turn off' : 'Turn on'}</Btn>
        )}
      </span>
    )
  }
  return <Badge tone={row.adminOnly ? 'quiet' : 'good'}>{row.adminOnly ? 'Admin only' : 'On'}</Badge>
}

/* ── drawer ────────────────────────────────────────────────────────────── */

function FlagDrawer({ row, changes, onClose, onTurnOff, onShare, onKindSaved, onFail, logAction }) {
  const [kind, setKind] = useState('permission')
  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (row) { setKind(row.kind); setReview(row.raw?.review_after ? String(row.raw.review_after).slice(0, 10) : '') }
  }, [row])
  if (!row) return <Drawer open={false} onClose={onClose} title="" />
  const history = changes.filter((c) => c.target_key === row.key)
  const saveKind = async () => {
    setBusy(true)
    try {
      await setModuleKind(row.key, kind, review || null)
      try { await logAction?.('module_kind', null, 'module', { module: row.key, kind, review_after: review || null }) } catch { /* audit best effort */ }
      onKindSaved(`${row.name} marked as ${KIND_LABEL[kind]}.`)
    } catch (e) { onFail(e) } finally { setBusy(false) }
  }
  const people = (list) => (list || []).map((a) => `${a.role} ${fmtInt(a.people)}`).join(', ')
  return (
    <Drawer open onClose={onClose} title={row.name} subtitle={`${TYPE_LABEL[row.type]} - ${row.key}`}>
      <div className="space-y-4">
        <DetailList items={[
          ['State', STATE_LABEL[row.state] || row.state],
          ['Kind', KIND_LABEL[row.kind]],
          ['Review by', row.review ? riyadhDay(row.review) : 'Not a Release'],
          ['Category', row.category],
          ['Usage', row.usage || 'Not measured'],
          ['Last changed', row.changedAt ? riyadhTime(row.changedAt) : 'N/A'],
        ]} />
        {row.description && <p className="text-xs text-gray-400">{row.description}</p>}
        {row.guarded && <Note icon={Lock}>{row.guarded}</Note>}

        {(row.type === 'module' || row.type === 'phone') && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Who gets it</h4>
            <div className="space-y-1 text-xs">
              {row.type === 'module' && <p className="text-gray-300"><Globe size={11} className="inline mr-1" aria-hidden="true" />Web: {row.audienceWeb?.length ? people(row.audienceWeb) : 'Admin and Super Admin only'}</p>}
              <p className="text-gray-300"><Smartphone size={11} className="inline mr-1" aria-hidden="true" />Phone: {row.audiencePhone?.length ? people(row.audiencePhone) : row.mobileKey || row.type === 'phone' ? 'Admin and Super Admin only' : 'No phone screen'}</p>
            </div>
            {row.adminOnly && row.type === 'module' && <div className="mt-2"><Btn icon={Share2} variant="primary" onClick={onShare}>Share with roles</Btn></div>}
          </div>
        )}

        {row.type === 'module' && (
          <>
            <div className="rounded-xl border border-gray-800 p-3 space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Kind and expected life</h4>
              <Segmented ariaLabel="Kind" role="group" value={kind} onChange={setKind} options={[
                { key: 'release', label: 'Release' }, { key: 'permission', label: 'Permanent' }, { key: 'kill_switch', label: 'Kill switch' },
              ]} />
              <p className="text-[11px] text-gray-500">
                {kind === 'release' ? `A rollout. Reviewed ${RELEASE_REVIEW_DAYS} days after it was added unless you set a date.` : kind === 'kill_switch' ? 'Kept to switch something off in an emergency. Never goes stale.' : 'A permanent part of the app. Never goes stale.'}
              </p>
              {kind === 'release' && (
                <label className="block text-xs text-gray-400">Review on (optional)
                  <input type="date" value={review} onChange={(e) => setReview(e.target.value)}
                    className="mt-1 block px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" />
                </label>
              )}
              <Btn variant="primary" busy={busy} onClick={saveKind}>Save kind</Btn>
            </div>
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Dependencies</h4>
              <p className="text-xs text-gray-400">{row.dependsOn.length ? row.dependsOn.join(', ') : 'None recorded. No module in the registry lists its dependencies yet, so check related pages in the same category before turning this off.'}</p>
            </div>
            <Btn icon={Power} variant="danger" onClick={onTurnOff} disabled={row.state === 'disabled'}>Turn off</Btn>
          </>
        )}

        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">History</h4>
          {history.length === 0 ? <p className="text-xs text-gray-500">No scheduled changes. Changes made before scheduling existed were not recorded here; see the Audit Trail.</p> : (
            <ul className="space-y-1 text-xs text-gray-300">
              {history.map((c) => <li key={c.id}>{riyadhTime(c.run_at)}: to {c.new_state} <Badge tone={CHANGE_TONE[c.status]}>{CHANGE_LABEL[c.status]}</Badge></li>)}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}

/* ── turn a module off, now or scheduled ───────────────────────────────── */

function WhenPicker({ when, setWhen, runAt, setRunAt, dualOn }) {
  return (
    <div className="space-y-2">
      <Segmented ariaLabel="When" role="group" value={when} onChange={setWhen}
        options={[{ key: 'now', label: 'Now' }, { key: 'schedule', label: 'Schedule' }]} />
      {when === 'schedule' && (
        <label className="block text-xs text-gray-400">Run at (your local time)
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)}
            className="mt-1 block w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" />
        </label>
      )}
      <p className="text-[11px] text-gray-500">
        {dualOn ? 'Dual control is on: a scheduled change waits for a second super admin to approve it.' : 'Dual control is off, so no second approval is needed. Turn it on in Security to require one.'}
      </p>
    </div>
  )
}

function TurnOffDialog({ row, dualOn, onClose, onDone, onMaintenance, logAction }) {
  const [when, setWhen] = useState('now')
  const [runAt, setRunAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (row) { setWhen('now'); setRunAt(toLocalInput(new Date(Date.now() + 3600000))); setError('') } }, [row])
  const target = row?.target || 'disabled'
  const off = target === 'disabled'
  const impact = row ? turnOffImpact(row, NAV_COUNT[row.key] || 0) : null
  const label = off ? 'Off' : 'Maintenance'
  const confirm = async ({ reason }) => {
    if (reason.length < 5) { setError('Give a reason of at least 5 characters.'); return }
    setBusy(true); setError('')
    try {
      if (when === 'schedule') {
        const res = await scheduleFlagChange({ targetType: 'module', key: row.key, state: target, runAt: new Date(runAt), reason })
        onDone(res?.status === 'awaiting_approval' ? `${row.name}: change scheduled, waiting for a second super admin.` : `${row.name} will change to ${label} at ${riyadhTime(new Date(runAt))}.`)
      } else {
        await setModuleStatus(row.key, target)
        try { await logAction?.('module_status', null, 'module', { module: row.key, from: row.state, to: target, reason }) } catch { /* audit best effort */ }
        onDone(`${row.name} is now ${label} on the web app.`)
      }
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={!!row} danger={off} title={row ? `${off ? 'Turn off' : 'Put in maintenance'} ${row.name}` : ''}
      typedWord={off ? row?.key : undefined} requireReason busy={busy} error={error}
      confirmLabel={when === 'schedule' ? 'Schedule' : off ? 'Turn off now' : 'Set maintenance now'} onCancel={onClose} onConfirm={confirm}
      readyExtra={when === 'now' || Boolean(runAt)}
      impact={row ? {
        tone: off ? 'danger' : 'warning',
        what: off ? `Hides ${row.name} on the web app and shows "not available" to anyone who opens it.` : `Shows a maintenance notice on ${row.name} instead of the page.`,
        change: `${STATE_LABEL[row.state]} to ${label}`,
        who: `${fmtInt(impact.webPeople)} people on the web in ${row.audienceWeb.length} roles. Admin and Super Admin still get in. ${fmtInt(impact.pagesHidden)} sidebar pages.`,
        undo: 'Set it back to Live here at any time.',
      } : null}>
      {row && (
        <>
          <Note icon={Info}>Phones do not read this switch: {fmtInt(impact.phoneKeeps)} people keep the phone screen. Close it on phones in Access Control.</Note>
          <WhenPicker when={when} setWhen={setWhen} runAt={runAt} setRunAt={setRunAt} dualOn={dualOn} />
          {off && <Btn icon={Wrench} onClick={() => onMaintenance(row)} disabled={busy}>Use Maintenance instead</Btn>}
        </>
      )}
    </ConfirmImpactDialog>
  )
}

/* ── platform switch or organisation flag ──────────────────────────────── */

function SwitchDialog({ row, dualOn, orgFlags, onClose, onDone, logAction }) {
  const [when, setWhen] = useState('now')
  const [runAt, setRunAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (row) { setWhen('now'); setRunAt(toLocalInput(new Date(Date.now() + 3600000))); setError('') } }, [row])
  const next = row ? row.state !== 'on' : false
  const isSwitch = row?.type === 'switch'
  const confirm = async ({ reason }) => {
    if (reason.length < 5) { setError('Give a reason of at least 5 characters.'); return }
    setBusy(true); setError('')
    try {
      if (isSwitch && when === 'schedule') {
        const res = await scheduleFlagChange({ targetType: 'config', key: row.key, state: next ? 'true' : 'false', runAt: new Date(runAt), reason })
        onDone(res?.status === 'awaiting_approval' ? `${row.name}: change waiting for a second super admin.` : `${row.name} will change at ${riyadhTime(new Date(runAt))}.`)
        return
      }
      if (isSwitch) await saveSystemConfigValues({ [row.key]: next ? 'true' : 'false' })
      else await saveFlags({ ...(orgFlags || {}), [row.flagKey]: next })
      try { await logAction?.(isSwitch ? 'update_config' : 'feature_flag', null, isSwitch ? 'system_config' : 'app_settings', { key: row.key, to: next, reason }) } catch { /* audit best effort */ }
      onDone(`${row.name} is now ${next ? 'on' : 'off'}.`)
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={!!row} danger={!next} title={row ? `Turn ${next ? 'on' : 'off'} ${row.name}` : ''} requireReason busy={busy} error={error}
      confirmLabel={when === 'schedule' && isSwitch ? 'Schedule' : `Turn ${next ? 'on' : 'off'}`} onCancel={onClose} onConfirm={confirm}
      readyExtra={when === 'now' || Boolean(runAt)}
      impact={row ? {
        tone: next ? 'info' : 'danger',
        what: row.description || `${isSwitch ? 'Platform switch' : 'Organisation flag'} ${row.key}.`,
        change: `${STATE_LABEL[row.state]} to ${next ? 'On' : 'Off'}`,
        who: isSwitch ? 'Everyone the switch applies to, immediately.' : 'Every organisation: these flags are one global set.',
        undo: 'Flip it back here.',
      } : null}>
      {isSwitch && <WhenPicker when={when} setWhen={setWhen} runAt={runAt} setRunAt={setRunAt} dualOn={dualOn} />}
    </ConfirmImpactDialog>
  )
}

/* ── share a new admin-only area ───────────────────────────────────────── */

function ShareDialog({ row, usage, onClose, onDone, logAction }) {
  const [roles, setRoles] = useState([])
  const [where, setWhere] = useState('web')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (row) { setRoles([]); setWhere('web'); setError('') } }, [row])
  const list = (usage?.roles || []).filter((r) => r.role !== 'Admin')
  const peopleOf = (role) => Number(list.find((r) => r.role === role)?.people) || 0
  const total = roles.reduce((a, r) => a + peopleOf(r), 0)
  const confirm = async ({ reason }) => {
    setBusy(true); setError('')
    try {
      const changes = buildShareChanges({ key: row.key, storedKey: row.key, surface: 'web' }, roles, where)
      await saveModulePermissions(changes, reason)
      try { await logAction?.('share_module', null, 'module_permissions', { module: row.key, roles, where, reason }) } catch { /* audit best effort */ }
      onDone(`${row.name} shared with ${roles.join(', ')}.`)
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={!!row} title={row ? `Share ${row.name}` : ''} requireReason busy={busy} error={error}
      confirmLabel="Share" onCancel={onClose} onConfirm={confirm} readyExtra={roles.length > 0}
      impact={row ? {
        tone: 'info',
        what: `Lets the chosen roles open ${row.name}.`,
        change: 'Admin only to shared',
        who: `${fmtInt(total)} people in ${roles.length} roles, on ${where === 'both' ? 'web and phone' : where}.`,
        undo: 'Turn the roles off again in Access Control.',
      } : null}>
      <Segmented ariaLabel="Where" role="group" value={where} onChange={setWhere} options={[
        { key: 'web', label: 'Web' }, ...(row?.mobileKey ? [{ key: 'phone', label: 'Phone' }, { key: 'both', label: 'Both' }] : []),
      ]} />
      {!row?.mobileKey && <p className="text-[11px] text-gray-500">This area has no phone screen.</p>}
      <div className="max-h-48 overflow-auto rounded-lg border border-gray-800 p-2 space-y-1">
        {list.length === 0 ? <p className="text-xs text-gray-500">Roles could not be read.</p> : list.map((r) => (
          <label key={r.role} className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" className="accent-orange-500" checked={roles.includes(r.role)}
              onChange={() => setRoles((s) => (s.includes(r.role) ? s.filter((x) => x !== r.role) : [...s, r.role]))} />
            <span className="flex-1">{r.role}</span><span className="tabular-nums text-gray-500">{fmtInt(r.people)}</span>
          </label>
        ))}
      </div>
    </ConfirmImpactDialog>
  )
}

/* ── bulk actions ──────────────────────────────────────────────────────── */

function BulkDialog({ mode, rows, onClose, onDone, logAction }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (mode) setError('') }, [mode])
  const people = rows.reduce((a, r) => a + (turnOffImpact(r)?.webPeople || 0), 0)
  const confirm = async ({ reason }) => {
    setBusy(true); setError('')
    try {
      const ids = rows.map((r) => r.key)
      if (mode === 'snooze') {
        const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
        for (const id of ids) await setModuleKind(id, 'release', until)
        try { await logAction?.('module_kind', null, 'module', { modules: ids, review_after: until, reason }) } catch { /* audit best effort */ }
        onDone(`${ids.length} modules marked Release with a review on ${until}.`)
      } else {
        await bulkSetStatus(ids, mode)
        try { await logAction?.('module_status_bulk', null, 'module', { modules: ids, to: mode, reason }) } catch { /* audit best effort */ }
        onDone(`${ids.length} modules set to ${STATE_LABEL[mode]}.`)
      }
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }
  const off = mode === 'disabled'
  return (
    <ConfirmImpactDialog open={!!mode} danger={off} title={mode === 'snooze' ? 'Snooze review' : `Set ${rows.length} modules to ${STATE_LABEL[mode] || ''}`}
      requireReason busy={busy} error={error} typedWord={off ? 'TURN OFF' : undefined}
      confirmLabel={mode === 'snooze' ? 'Snooze' : 'Apply'} onCancel={onClose} onConfirm={confirm}
      impact={mode ? {
        tone: off ? 'danger' : 'info',
        what: mode === 'snooze' ? 'Marks them as Releases reviewed in 30 days, so they stop showing as stale.' : `Sets ${rows.length} modules to ${STATE_LABEL[mode]} on the web app.`,
        change: rows.slice(0, 6).map((r) => r.name).join(', ') + (rows.length > 6 ? ` and ${rows.length - 6} more` : ''),
        who: mode === 'snooze' ? 'Nobody loses access.' : `Up to ${fmtInt(people)} people on the web. Phones are not affected.`,
        undo: 'Set them back here.',
      } : null} />
  )
}

/* ── scheduled changes ─────────────────────────────────────────────────── */

function ChangesPanel({ changes, loading, error, onRetry, dualOn, rows, logAction, onDone, onFail }) {
  const [cancel, setCancel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cancelErr, setCancelErr] = useState('')
  const nameOf = (c) => rows.find((r) => r.key === c.target_key)?.name || c.target_key
  const approve = async (c) => {
    try {
      await approveFlagChange(c.id)
      try { await logAction?.('flag_change_approved', null, 'flag_change', { id: c.id }) } catch { /* audit best effort */ }
      onDone('Change approved.')
    } catch (e) { onFail(e) }
  }
  const doCancel = async ({ reason }) => {
    setBusy(true); setCancelErr('')
    try { await cancelFlagChange(cancel.id, reason); setCancel(null); onDone('Change cancelled.') } catch (e) { setCancelErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Panel>
      <PanelHeader icon={CalendarClock} title="Scheduled changes"
        subtitle={dualOn ? 'Dual control is on: each change waits for a second super admin.' : 'Applied within a minute of their time. Dual control is off, so no second approval is needed.'}
        actions={<ExportButtons rows={changes.map((c) => ({ ...c, name: nameOf(c) }))} title="Scheduled flag changes" columns={[
          { key: 'name', header: 'Item' }, { key: 'new_state', header: 'New state' }, { key: 'run_at', header: 'Run at' },
          { key: 'status', header: 'Status' }, { key: 'reason', header: 'Reason' },
        ]} />} />
      {loading ? <LoadingState rows={4} /> : error ? <div className="px-4 pb-4"><ErrorState message={error} onRetry={onRetry} /></div>
        : changes.length === 0 ? <EmptyState icon={CalendarClock} title="No scheduled changes" reason="Turn a module off or flip a switch and choose Schedule to plan it." /> : (
          <Table>
            <THead><Th>Item</Th><Th>To</Th><Th>Run at</Th><Th>Status</Th><Th>Reason</Th><Th align="right">Actions</Th></THead>
            <tbody>
              {changes.map((c) => (
                <Tr key={c.id}>
                  <Td><span className="text-gray-100">{nameOf(c)}</span><p className="text-[11px] text-gray-500">{c.target_type === 'module' ? 'Module' : 'Platform switch'}</p></Td>
                  <Td nowrap>{c.new_state === 'true' ? 'On' : c.new_state === 'false' ? 'Off' : STATE_LABEL[c.new_state] || c.new_state}</Td>
                  <Td nowrap>{riyadhTime(c.run_at)}</Td>
                  <Td nowrap><Badge tone={CHANGE_TONE[c.status]}>{CHANGE_LABEL[c.status]}</Badge>{c.error && <p className="text-[11px] text-red-300">{c.error}</p>}</Td>
                  <Td className="text-gray-400 break-words max-w-xs">{c.reason}</Td>
                  <Td align="right" nowrap>
                    {c.status === 'awaiting_approval' && <Btn size="xs" variant="good" onClick={() => approve(c)}>Approve</Btn>}{' '}
                    {(c.status === 'scheduled' || c.status === 'awaiting_approval') && <Btn size="xs" onClick={() => setCancel(c)}>Cancel</Btn>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      <ConfirmImpactDialog open={!!cancel} title="Cancel this change" requireReason busy={busy} error={cancelErr}
        confirmLabel="Cancel change" onCancel={() => setCancel(null)} onConfirm={doCancel}
        impact={cancel ? { tone: 'info', what: `Stops the planned change to ${nameOf(cancel)}.`, change: 'Scheduled to Cancelled', who: 'Nobody; nothing changes.', undo: 'Schedule it again.' } : null} />
    </Panel>
  )
}

/* ── organisations and rollout ─────────────────────────────────────────── */

function OrgsPanel({ usage, loading, error, onRetry }) {
  const orgs = usage?.orgs || []
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader icon={Building2} title="Per-organisation overrides"
          actions={<Btn icon={Plus} disabled title="Needs owner decision: per-organisation overrides are not built.">Add override</Btn>} />
        {loading ? <LoadingState rows={3} /> : error ? <div className="px-4 pb-4"><ErrorState message={error} onRetry={onRetry} /></div> : (
          <>
            <Table>
              <THead><Th>Organisation</Th><Th align="right">Members</Th><Th align="right">Overrides</Th></THead>
              <tbody>
                {orgs.map((o) => (
                  <Tr key={o.id}><Td>{o.name || 'Unnamed'}</Td><Td align="right" className="tabular-nums">{fmtInt(o.members)}</Td><Td align="right">N/A</Td></Tr>
                ))}
              </tbody>
            </Table>
            <p className="px-4 py-3 text-[11px] text-gray-500"><Badge tone="warning">Needs owner decision</Badge> Organisation flags are one global set today. Giving one company a different setting needs a new override store and a change in how the app reads flags.</p>
          </>
        )}
      </Panel>
      <Panel>
        <PanelHeader icon={Users} title="Rollout options" subtitle="How a feature can reach people today." />
        <ul className="px-4 pb-4 space-y-2 text-xs">
          <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5" aria-hidden="true" />
            <span className="text-gray-300">By role, web and phone separately. <ConsoleLink to="/console/access">Access Control</ConsoleLink></span></li>
          <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5" aria-hidden="true" />
            <span className="text-gray-300">By person, with an expiry. <ConsoleLink to="/console/access?tab=grants">Per-person grants</ConsoleLink></span></li>
          <li className="flex items-start gap-2"><AlertTriangle size={13} className="text-amber-400 mt-0.5" aria-hidden="true" />
            <span className="text-gray-400">By country: not available. Data is country-scoped, but features are not.</span></li>
          <li className="flex items-start gap-2"><AlertTriangle size={13} className="text-amber-400 mt-0.5" aria-hidden="true" />
            <span className="text-gray-400">By percentage of users: not available.</span></li>
        </ul>
      </Panel>
    </div>
  )
}

