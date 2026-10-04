/**
 * Organizations > Overview: every customer company, who is in it, how much data
 * it holds, its plan, and the honest state of Lock and the member caps.
 *
 * Owner decisions shown, never enforced here:
 *   - Lock is stored on the organisation row but no server rule reads it.
 *   - Two member caps exist (organisations.max_users and system_config
 *     max_users_per_org); which one is real is the owner's call.
 *   - Suspending a company for real (blocking sign-in) waits on the owner.
 * The only write on this tab is archiving an EMPTY organization (reversible).
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Users, Activity, Database, CreditCard, Lock, Download, Plus, Archive, Info,
  ArrowUpRight, Ban,
} from 'lucide-react'
import {
  Btn, Panel, PanelHeader, Note, StatTile, SearchInput, Segmented, LoadingState, ErrorState, EmptyState,
  ImpactBox, ConfirmImpactDialog, Modal,
} from '../../../components/ui'
import { Drawer } from '../../shared/pageKit'
import { orgState, orgRecords, isEmptyOrg, orgNeedsAttention, fmtRiyadh, initials } from '../../../../lib/consolePlatform'
import { archiveEmptyOrg } from '../../../../lib/api/consolePlatform'
import { exportConsoleRows } from '../../../../lib/consoleTable'
import { toUserMessage } from '../../../../lib/safeError'
import { useConsoleAuth } from '../../../ConsoleAuthContext'
import { AttentionStrip, MovedHere, Pill, DecisionTag, Facts, fmtNum } from '../PlatformKit'

const STATE_PILL = {
  active: ['good', 'Active'], demo: ['info', 'Demo'], empty: ['muted', 'Empty'],
  locked: ['warning', 'Lock flag set'], archived: ['muted', 'Archived'],
}

const FILTERS = [
  ['all', 'All'], ['data', 'With data'], ['empty', 'Empty'], ['noplan', 'No plan'],
  ['locked', 'Lock flag set'], ['overcap', 'Over member cap'], ['archived', 'Archived'],
]

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  return Math.round((a / b) * 100)
}

export default function OrgsOverview({ data, onTab }) {
  const { logAction } = useConsoleAuth()
  const navigate = useNavigate()
  const { loading, orgs = [], orgsError, stats, statsError, subs, platformCap, reload } = data
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('cards')
  const [selected, setSelected] = useState(() => new Set())
  const [open, setOpen] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')

  const statsById = useMemo(() => Object.fromEntries((stats || []).map((s) => [s.id, s])), [stats])
  const subByOrg = useMemo(() => Object.fromEntries((subs || []).map((s) => [s.organisation_id, s])), [subs])
  const overCap = (o) => { const s = statsById[o.id]; return s && Number(o.max_users) > 0 && s.members > Number(o.max_users) }

  const kpis = useMemo(() => {
    if (!stats) return null
    const members = stats.reduce((n, s) => n + s.members, 0)
    const active30 = stats.reduce((n, s) => n + s.active_30d, 0)
    const records = stats.reduce((n, s) => n + (orgRecords(s) || 0), 0)
    const withData = orgs.filter((o) => (orgRecords(statsById[o.id]) || 0) > 0).length
    const top = [...stats].sort((a, b) => (orgRecords(b) || 0) - (orgRecords(a) || 0))[0]
    return {
      withData, empty: orgs.filter((o) => isEmptyOrg(statsById[o.id])).length,
      members, active30, records, topShare: top ? pct(orgRecords(top), records) : null,
      locked: orgs.filter((o) => o.locked).length,
    }
  }, [stats, orgs, statsById])

  const attention = useMemo(() => orgNeedsAttention(orgs, statsById, { platformCap }), [orgs, statsById, platformCap])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orgs.filter((o) => {
      const s = statsById[o.id]
      if (q && !`${o.name} ${o.slug || ''} ${o.contact_email || ''}`.toLowerCase().includes(q)) return false
      switch (filter) {
        case 'data': return (orgRecords(s) || 0) > 0
        case 'empty': return isEmptyOrg(s)
        case 'noplan': return !subByOrg[o.id]
        case 'locked': return !!o.locked
        case 'overcap': return overCap(o)
        case 'archived': return o.active === false
        default: return true
      }
    })
  }, [orgs, statsById, subByOrg, search, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, orgs.filter((o) => {
    const s = statsById[o.id]
    switch (k) {
      case 'data': return (orgRecords(s) || 0) > 0
      case 'empty': return isEmptyOrg(s)
      case 'noplan': return !subByOrg[o.id]
      case 'locked': return !!o.locked
      case 'overcap': return overCap(o)
      case 'archived': return o.active === false
      default: return true
    }
  }).length])), [orgs, statsById, subByOrg]) // eslint-disable-line react-hooks/exhaustive-deps

  const emptyActive = orgs.filter((o) => o.active !== false && isEmptyOrg(statsById[o.id]))
  const sel = orgs.filter((o) => selected.has(o.id))

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function exportList(rows = orgs) {
    await exportConsoleRows({
      rows, title: 'Organizations', columns: [
        { key: 'name', header: 'Organization' },
        { key: 'state', header: 'State', value: (o) => STATE_PILL[orgState(o, statsById[o.id])]?.[1] || '' },
        { key: 'members', header: 'Members', value: (o) => statsById[o.id]?.members ?? 'N/A' },
        { key: 'active', header: 'Active 30 days', value: (o) => statsById[o.id]?.active_30d ?? 'N/A' },
        { key: 'vehicles', header: 'Vehicles', value: (o) => statsById[o.id]?.vehicles ?? 'N/A' },
        { key: 'tyres', header: 'Tyre records', value: (o) => statsById[o.id]?.tyre_records ?? 'N/A' },
        { key: 'jobs', header: 'Job cards', value: (o) => statsById[o.id]?.job_cards ?? 'N/A' },
        { key: 'exp', header: 'Expense lines', value: (o) => statsById[o.id]?.expense_lines ?? 'N/A' },
        { key: 'ins', header: 'Inspections', value: (o) => statsById[o.id]?.inspections ?? 'N/A' },
        { key: 'plan', header: 'Plan', value: (o) => subByOrg[o.id]?.plan_code || 'None' },
        { key: 'oldplan', header: 'Old plan label', value: (o) => o.plan || '' },
        { key: 'cap', header: 'Stored member cap (not enforced)', value: (o) => o.max_users ?? '' },
        { key: 'created', header: 'Created', value: (o) => fmtRiyadh(o.created_at, { time: false, year: true }) },
      ],
    })
  }

  async function archiveAll({ reason }) {
    setBusy(true); setErr('')
    let ok = 0; const failed = []
    for (const o of emptyActive) {
      try {
        await archiveEmptyOrg(o, statsById[o.id]); ok += 1
        await logAction?.('archive_org', o.id, 'organisation', { name: o.name, reason })
      } catch (e) { failed.push(`${o.name}: ${toUserMessage(e, 'failed')}`) }
    }
    setBusy(false)
    if (failed.length) { setErr(failed.join('; ')); return }
    setDialog(null)
    setFlash(`${ok} empty ${ok === 1 ? 'organization' : 'organizations'} archived. Reactivate any of them from Edit and lock.`)
    reload()
  }

  function onAttention(it) {
    if (it.archive) setDialog('archive')
    else if (it.key === 'cap') setDialog('caps')
    else if (it.key === 'lock') setDialog('suspend')
  }

  if (loading && !orgs.length) return <LoadingState label="Loading organizations" rows={6} />
  if (orgsError) return <ErrorState message={orgsError} onRetry={reload} />

  const drawerOrg = orgs.find((o) => o.id === open)
  const ds = drawerOrg ? statsById[drawerOrg.id] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <Btn icon={Download} onClick={() => exportList()}>Export list</Btn>
        <Btn variant="primary" icon={Plus} onClick={() => onTab('manage')}>Create organization</Btn>
      </div>
      <MovedHere from={['Organisations', 'Tenant Export']}>Every feature of these pages has a home on this screen: create, edit, lock and delete are on the Edit and lock tab, full exports on the Tenant export tab.</MovedHere>
      {flash && <Note tone="accent">{flash}</Note>}
      {statsError && <Note tone="warning">Member and record counts could not be loaded ({statsError}). Figures below show N/A instead of zero.</Note>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Building2} label="Organizations" value={fmtNum(orgs.length)} sub={kpis ? `${kpis.withData} with data, ${kpis.empty} created and never used` : 'N/A'} />
        <StatTile icon={Users} label="Members" value={kpis ? fmtNum(kpis.members) : 'N/A'} sub="People with a profile in each company" />
        <StatTile icon={Activity} label="Active, 30 days" value={kpis ? fmtNum(kpis.active30) : 'N/A'} sub="Signed in during the last 30 days" />
        <StatTile icon={Database} label="Records held" value={kpis ? fmtNum(kpis.records) : 'N/A'} sub={kpis?.topShare != null ? `${kpis.topShare}% in one organization` : 'vehicles, tyres, job cards, expenses, inspections'} />
        <StatTile icon={CreditCard} label="Plans assigned" value={subs == null ? 'N/A' : `${subs.length} of ${orgs.length}`} sub="Billing is not live" onClick={() => navigate('/console/billing')} />
        <StatTile icon={Lock} label="Lock flag set" value={fmtNum(kpis?.locked ?? null)} sub="Stored only; no server rule reads it" tone={kpis?.locked ? 'warning' : 'default'} onClick={() => setFilter('locked')} active={filter === 'locked'} />
      </div>

      <AttentionStrip subtitle="Checks run on every organization" items={attention} onAction={onAttention} />

      <Panel>
        <PanelHeader title="Tenants" subtitle="One card per organization. Select to export, plan or review suspension."
          actions={<Segmented role="group" value={view} onChange={setView} ariaLabel="Layout" options={[{ key: 'cards', label: 'Cards' }, { key: 'table', label: 'Table' }]} />} />
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder="Search organizations" /></div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter organizations">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${filter === k ? 'border-orange-600/60 bg-orange-950/20 text-orange-300' : 'border-gray-800 text-gray-400 hover:text-gray-200'}`}>
                  {label} <span className="text-gray-500">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          {sel.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-800/40 bg-orange-950/15 px-3 py-2">
              <span className="text-xs text-gray-200">{sel.length} selected: {sel.map((o) => o.name).join(', ')}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Btn size="xs" icon={Download} onClick={() => exportList(sel)}>Export list</Btn>
                <Btn size="xs" icon={Database} onClick={() => onTab('exports')}>Full data export</Btn>
                <Btn size="xs" icon={CreditCard} onClick={() => navigate(`/console/billing?org=${sel[0].id}`)}>Assign plan</Btn>
                <Btn size="xs" variant="danger" icon={Ban} onClick={() => setDialog('suspend')}>Suspend</Btn>
                <Btn size="xs" variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState title="No organizations match" reason={search ? 'Try a different search.' : 'No organization is in this filter.'} />
          ) : view === 'cards' ? (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {shown.map((o) => {
                const s = statsById[o.id]
                const [tone, label] = STATE_PILL[orgState(o, s)] || STATE_PILL.active
                const rate = s ? pct(s.ever_signed_in, s.members) : null
                return (
                  <li key={o.id} className={`rounded-xl border p-3 bg-gray-900/40 ${selected.has(o.id) ? 'border-orange-600/60' : 'border-gray-800'}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 accent-orange-500" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.name}`} />
                      <span className="h-8 w-8 rounded-lg bg-gray-800 text-gray-300 text-[11px] font-semibold grid place-items-center shrink-0" aria-hidden="true">{initials(o.name)}</span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => setOpen(o.id)} className="text-sm font-semibold text-gray-100 hover:text-orange-300 text-left truncate max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">{o.name}</button>
                        <p className="text-[11px] text-gray-500">Created {fmtRiyadh(o.created_at, { time: false, year: true })}</p>
                      </div>
                      <Pill tone={tone}>{label}</Pill>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-[11px]">
                      <dt className="text-gray-500">Members</dt><dd className="text-gray-200 tabular-nums text-right">{fmtNum(s?.members)}</dd>
                      <dt className="text-gray-500">Active 30d</dt><dd className="text-gray-200 tabular-nums text-right">{fmtNum(s?.active_30d)}</dd>
                      <dt className="text-gray-500">Records</dt><dd className="text-gray-200 tabular-nums text-right">{fmtNum(orgRecords(s))}</dd>
                      <dt className="text-gray-500">Sign-in rate</dt><dd className="text-gray-200 tabular-nums text-right">{rate == null ? 'N/A' : `${rate}%`}</dd>
                      <dt className="text-gray-500">Countries</dt><dd className="text-gray-200 text-right truncate">{s?.data_countries?.length ? s.data_countries.join(', ') : 'None'}</dd>
                      <dt className="text-gray-500">Plan</dt><dd className="text-gray-200 text-right truncate">{subByOrg[o.id]?.plan_code || `None${o.plan ? `. Old label: ${o.plan}` : ''}`}</dd>
                      <dt className="text-gray-500">Member cap</dt><dd className={`text-right ${overCap(o) ? 'text-amber-300' : 'text-gray-200'}`}>{o.max_users ? `${fmtNum(s?.members)} of ${o.max_users}, not enforced` : 'None stored'}</dd>
                      <dt className="text-gray-500">Last write</dt><dd className="text-gray-200 text-right">{s?.last_write_at ? fmtRiyadh(s.last_write_at) : 'Never'}</dd>
                    </dl>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[11px] text-gray-500 border-b border-gray-800">
                  <tr><th className="px-2 py-2 w-6 relative"><span className="sr-only">Select</span></th>
                    <th className="px-2 py-2 text-left">Organization</th><th className="px-2 py-2 text-right">Members</th>
                    <th className="px-2 py-2 text-right">Active 30d</th><th className="px-2 py-2 text-right">Records</th>
                    <th className="px-2 py-2 text-left">Plan</th><th className="px-2 py-2 text-left">State</th><th className="px-2 py-2 text-left">Last write</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {shown.map((o) => {
                    const s = statsById[o.id]
                    const [tone, label] = STATE_PILL[orgState(o, s)] || STATE_PILL.active
                    return (
                      <tr key={o.id} className="hover:bg-gray-900/60">
                        <td className="px-2 py-2"><input type="checkbox" className="accent-orange-500" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.name}`} /></td>
                        <td className="px-2 py-2"><button type="button" onClick={() => setOpen(o.id)} className="text-gray-100 hover:text-orange-300 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">{o.name}</button></td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtNum(s?.members)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtNum(s?.active_30d)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtNum(orgRecords(s))}</td>
                        <td className="px-2 py-2 text-gray-400">{subByOrg[o.id]?.plan_code || 'None'}</td>
                        <td className="px-2 py-2"><Pill tone={tone}>{label}</Pill></td>
                        <td className="px-2 py-2 text-gray-400">{s?.last_write_at ? fmtRiyadh(s.last_write_at) : 'Never'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-500">Self-serve sign-up is off by choice. New companies are created on the Edit and lock tab, then people are invited.</p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Data volume by organization" subtitle="All-time rows. Storage per organization is not recorded."
          actions={<Btn size="xs" icon={Download} onClick={() => exportList()}>Excel</Btn>} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[11px] text-gray-500 border-b border-gray-800">
              <tr>{['Organization', 'Members', 'Vehicles', 'Tyre records', 'Job cards', 'Expense lines', 'Inspections', 'Plan', 'State'].map((h, i) => (
                <th key={h} className={`px-3 py-2 ${i > 0 && i < 7 ? 'text-right' : 'text-left'}`}>{h}</th>))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70">
              {orgs.map((o) => {
                const s = statsById[o.id]
                const [tone, label] = STATE_PILL[orgState(o, s)] || STATE_PILL.active
                return (
                  <tr key={o.id}>
                    <td className="px-3 py-2 text-gray-200">{o.name}</td>
                    {['members', 'vehicles', 'tyre_records', 'job_cards', 'expense_lines', 'inspections'].map((k) => (
                      <td key={k} className="px-3 py-2 text-right tabular-nums text-gray-300">{fmtNum(s?.[k])}</td>))}
                    <td className="px-3 py-2 text-gray-400">{subByOrg[o.id]?.plan_code || 'None'}{o.plan ? <span className="text-gray-500"> (old: {o.plan})</span> : null}</td>
                    <td className="px-3 py-2"><Pill tone={tone}>{label}</Pill></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {emptyActive.length > 0 && (
        <Panel>
          <PanelHeader title="Clean up empty organizations" subtitle={`${emptyActive.length} empty`} />
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-400 max-w-[70ch]">{emptyActive.map((o) => o.name).join(', ')} {emptyActive.length === 1 ? 'has' : 'have'} no members and no records. Country data lives in the main organization, kept apart by a country field, so these companies were never used.</p>
            <ImpactBox what={`${emptyActive.length} ${emptyActive.length === 1 ? 'organization exists' : 'organizations exist'} with 0 members and 0 rows.`}
              change="Archiving sets them inactive so they leave pickers and reports. Nothing is deleted."
              who="No one: 0 members, 0 records." undo="Yes. Reactivate from Edit and lock at any time." />
            <div className="flex gap-2"><Btn icon={Archive} onClick={() => setDialog('archive')}>Archive {emptyActive.length} empty {emptyActive.length === 1 ? 'organization' : 'organizations'}</Btn></div>
          </div>
        </Panel>
      )}

      <Drawer open={!!drawerOrg} onClose={() => setOpen(null)} title={drawerOrg?.name || ''} subtitle={drawerOrg ? `Created ${fmtRiyadh(drawerOrg.created_at, { time: false, year: true })}` : ''}>
        {drawerOrg && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Members" value={fmtNum(ds?.members)} sub={ds ? `${fmtNum(ds.ever_signed_in)} ever signed in` : 'N/A'} />
              <StatTile label="Active 30d" value={fmtNum(ds?.active_30d)} sub={ds ? `${fmtNum(ds.active_7d)} in 7 days` : 'N/A'} />
              <StatTile label="Vehicles" value={fmtNum(ds?.vehicles)} sub={ds?.data_countries?.length ? ds.data_countries.join(', ') : 'No country data'} />
              <StatTile label="Plan" value={subByOrg[drawerOrg.id]?.plan_code || 'None'} sub="Billing not live" />
            </div>
            <Facts rows={[
              ['Tyre records', fmtNum(ds?.tyre_records)], ['Job cards', fmtNum(ds?.job_cards)],
              ['Expense lines', fmtNum(ds?.expense_lines)], ['Inspections', fmtNum(ds?.inspections)],
              ['Last write', ds?.last_write_at ? fmtRiyadh(ds.last_write_at, { year: true }) : 'Never'],
              ['Old plan label', drawerOrg.plan || null, drawerOrg.plan ? '(nothing bills or limits this)' : ''],
              ['Stored member cap', drawerOrg.max_users ?? null, drawerOrg.max_users ? '(not enforced)' : ''],
              ['Platform member cap', platformCap ?? null, platformCap ? '(system setting, not enforced)' : ''],
              ['Lock flag', drawerOrg.locked ? 'Set' : 'Not set', '(stored only)'],
              ['Contact', drawerOrg.contact_email ? drawerOrg.contact_email.replace(/^(.).*(@.*)$/, '$1***$2') : null],
            ]} />
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" icon={Users} onClick={() => navigate('/console/users')}>Members</Btn>
              <Btn size="sm" icon={ArrowUpRight} onClick={() => { setOpen(null); onTab('manage', drawerOrg.id) }}>Edit, lock or delete</Btn>
              <Btn size="sm" icon={Database} onClick={() => { setOpen(null); onTab('exports') }}>Full data export</Btn>
              <Btn size="sm" icon={CreditCard} onClick={() => navigate(`/console/billing?org=${drawerOrg.id}`)}>Plan preview</Btn>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmImpactDialog open={dialog === 'archive'} title={`Archive ${emptyActive.length} empty ${emptyActive.length === 1 ? 'organization' : 'organizations'}?`}
        impact={{ what: emptyActive.map((o) => o.name).join(', '), change: 'Each is set inactive. Nothing is deleted.', who: 'No one: 0 members, 0 records.', undo: 'Yes. Reactivate from Edit and lock.' }}
        requireReason typedWord="ARCHIVE" confirmLabel="Archive" busy={busy} error={err}
        onCancel={() => { setDialog(null); setErr('') }} onConfirm={archiveAll}>
        <p className="text-[11px] text-gray-400">An organization that gains a member or a record before you confirm is refused.</p>
      </ConfirmImpactDialog>

      <Modal open={dialog === 'suspend'} title="Suspend an organization" onClose={() => setDialog(null)} width="max-w-lg"
        footer={<><Btn onClick={() => setDialog(null)}>Close</Btn><Btn variant="danger" icon={Ban} disabled>Suspend</Btn></>}>
        <div className="space-y-3">
          <div className="flex items-center gap-2"><DecisionTag /></div>
          <p className="text-xs text-gray-300">Today&apos;s Lock button (on Edit and lock) sets a flag on the organization, but no server rule reads it. Nobody is blocked by it: members of a locked organization still sign in and work normally.</p>
          <ImpactBox tone="danger" what={sel.length ? sel.map((o) => o.name).join(', ') : 'A selected organization'}
            change="A real suspension would block every member from signing in on web and phone, and stop scheduled reports and jobs for that company."
            who={sel.length ? `${fmtNum(sel.reduce((n, o) => n + (statsById[o.id]?.members || 0), 0))} members` : 'Every member of the company.'}
            undo="Would be reversible by reactivating. Nothing would be deleted." />
          <Note icon={Info}>Making the Lock flag block sign-in changes how every company can be cut off, so it waits on the owner. Take a full data export first if a suspension is ever planned.</Note>
        </div>
      </Modal>

      <Modal open={dialog === 'caps'} title="Member caps" onClose={() => setDialog(null)} width="max-w-lg"
        footer={<Btn onClick={() => setDialog(null)}>Close</Btn>}>
        <div className="space-y-3">
          <DecisionTag />
          <p className="text-xs text-gray-300">Two member caps are stored and neither is enforced:</p>
          <ul className="text-xs text-gray-300 list-disc pl-5 space-y-1">
            <li>Each organization&apos;s own cap (organisations.max_users), shown on every card.</li>
            <li>The platform setting Users per organization ({platformCap ?? 'N/A'}), on System Settings.</li>
          </ul>
          <p className="text-xs text-gray-400">Which cap is the real one, and whether reaching it should stop new members, is an owner decision. Nothing on this screen blocks anyone.</p>
        </div>
      </Modal>
    </div>
  )
}
