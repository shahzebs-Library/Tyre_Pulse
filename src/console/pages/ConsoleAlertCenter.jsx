/**
 * ConsoleAlertCenter - /console/alerts. One inbox for every alert source.
 *
 * Replaces, and keeps whole as tabs: Incidents, Alert Rules, Trust Alerts and
 * Self-Healing. The inbox itself reads get_alert_inbox() (error log, Sentry
 * crashes, upload gaps, security scan, data trust, incidents), groups repeats,
 * and adds what those pages never had: an owner, acknowledge, snooze and
 * resolve with a reason, all audited server-side by set_alert_state().
 */
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, CheckCircle2, Clock, Inbox, ShieldAlert, Siren, UserPlus, Bug, Smartphone, UploadCloud, ShieldCheck, Database, Info,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, TabBar, useUrlTab, useRefreshStamp, Drawer, DetailList, ConsoleLink } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import Embedded, { MovedFrom } from './monitor/Embedded'
import { getAlertInbox, setAlertState, listOwnerProfiles } from '../../lib/api/monitorCenter'
import { listAlertRules, metricLabel } from '../../lib/api/alertRules'
import { openIncident } from '../../lib/api/platformIncidents'
import {
  ALERT_SOURCES, ALERT_SOURCE_LABEL, ALERT_SEVERITY, ALERT_GROUPS, alertGroup, filterAlerts,
  alertTabCounts, noiseCheck, ruleSentence, fmtNum, shortDate, riyadhDateTime, daysSince,
} from '../../lib/monitorCenter'
import { toUserMessage } from '../../lib/safeError'

const ConsoleIncidents = lazy(() => import('./ConsoleIncidents'))
const ConsoleAlertRules = lazy(() => import('./ConsoleAlertRules'))
const ConsoleTrustAlerts = lazy(() => import('./ConsoleTrustAlerts'))
const ConsoleSelfHealing = lazy(() => import('./ConsoleSelfHealing'))

const TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'rules', label: 'Alert rules', icon: BellRing },
  { key: 'incidents', label: 'Incidents', icon: Siren },
  { key: 'trust', label: 'Trust alerts', icon: ShieldCheck },
  { key: 'self-healing', label: 'Self-healing', icon: Database },
]
const TAB_KEYS = TABS.map((t) => t.key)
const SOURCE_ICON = { error_log: Bug, crash: Smartphone, upload_gap: UploadCloud, security: ShieldAlert, trust: ShieldCheck, incident: Siren }
const INCIDENT_SEV = { critical: 'sev1', high: 'sev2', medium: 'sev3', low: 'sev4', info: 'sev4' }
const INCIDENT_SOURCE = { crash: 'crash', error_log: 'system_log', security: 'security_scan', trust: 'trust_alert' }

const EXPORT_COLUMNS = [
  { key: 'severity', header: 'Severity', value: (a) => ALERT_SEVERITY[a.severity]?.label || a.severity },
  { key: 'source', header: 'Source', value: (a) => ALERT_SOURCE_LABEL[a.source] || a.source },
  { key: 'title', header: 'What happened' },
  { key: 'detail', header: 'Detail' },
  { key: 'affected', header: 'Affected' },
  { key: 'first_at', header: 'First seen', value: (a) => riyadhDateTime(a.first_at) || 'N/A' },
  { key: 'owner', header: 'Owner', value: (a) => a.owner_name || 'Unassigned' },
  { key: 'state', header: 'State', value: (a) => a.state || 'new' },
]

function sourceTile(key, s) {
  if (!s) return { value: 'N/A', sub: 'could not be read' }
  switch (key) {
    case 'error_log': return { value: fmtNum(s.unresolved), sub: `unresolved, ${fmtNum(s.critical)} critical`, tone: s.critical ? 'danger' : 'default' }
    case 'crash': return { value: fmtNum(s.total), sub: s.last_at ? `fatal, last ${shortDate(s.last_at)}` : 'none recorded', tone: s.last_30d ? 'danger' : 'default' }
    case 'upload_gap': return { value: fmtNum(s.last_30d), sub: `notices in 30 days, ${fmtNum(s.total)} all time`, tone: s.last_30d ? 'warning' : 'default' }
    case 'security': return { value: fmtNum(s.failing), sub: `open findings, ${fmtNum(s.high)} high`, tone: s.critical || s.high ? 'danger' : 'default' }
    case 'trust': return { value: fmtNum(s.open), sub: `open, ${fmtNum(s.resolved)} resolved`, tone: s.open ? 'warning' : 'default' }
    case 'incident': return { value: fmtNum(s.open), sub: s.ever ? `open, ${fmtNum(s.ever)} ever` : 'open, none ever opened', tone: s.open ? 'danger' : 'default' }
    default: return { value: 'N/A', sub: '' }
  }
}

export default function ConsoleAlertCenter() {
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'inbox')
  const { refreshedAt, stamp } = useRefreshStamp()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rules, setRules] = useState(null)
  const [owners, setOwners] = useState([])
  const [inboxTab, setInboxTab] = useState('open')
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [severity, setSeverity] = useState('')
  const [owner, setOwner] = useState('')
  const [grouped, setGrouped] = useState('group')
  const [selected, setSelected] = useState(() => new Set())
  const [openItem, setOpenItem] = useState(null)
  const [resolving, setResolving] = useState(null) // keys[]
  const [assigning, setAssigning] = useState(null) // keys[]
  const [assignTo, setAssignTo] = useState('')
  const [incidentFor, setIncidentFor] = useState(null) // items[]
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [inbox, r, o] = await Promise.allSettled([getAlertInbox(), listAlertRules(), listOwnerProfiles()])
      if (inbox.status === 'rejected') throw inbox.reason
      setData(inbox.value)
      setRules(r.status === 'fulfilled' ? r.value : null)
      setOwners(o.status === 'fulfilled' ? (o.value || []).filter((p) => !p.locked) : [])
      stamp()
    } catch (e) {
      setError(toUserMessage(e, 'The alert inbox could not be loaded.')); setData(null)
    } finally { setLoading(false) }
  }, [stamp])
  useEffect(() => { if (tab === 'inbox') load() }, [tab, load])

  const items = useMemo(() => data?.items || [], [data])
  const counts = useMemo(() => alertTabCounts(items), [items])
  const rows = useMemo(() => filterAlerts(items, { tab: inboxTab, q, source, severity, owner }), [items, inboxTab, q, source, severity, owner])
  const noise = noiseCheck(data?.sources?.error_log)
  const routineOpen = useMemo(() => filterAlerts(items, { tab: 'open' }).filter((a) => alertGroup(a) === 'routine').map((a) => a.key), [items])
  const selectedItems = rows.filter((a) => selected.has(a.key))

  const toggle = (k) => setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function act(keys, action, extra = {}) {
    setBusy(true); setActionError('')
    try {
      await setAlertState({ keys, action, ...extra })
      const verb = { acknowledge: 'acknowledged', snooze: 'snoozed for 24 hours', resolve: 'resolved', assign: 'assigned', reopen: 'reopened' }[action]
      setNotice(`${keys.length} alert${keys.length === 1 ? '' : 's'} ${verb}. Written to the audit log.`)
      setSelected(new Set()); setResolving(null); setAssigning(null); setOpenItem(null)
      await load()
    } catch (e) { setActionError(toUserMessage(e, 'Nothing was changed.')) }
    finally { setBusy(false) }
  }

  async function createIncident(list) {
    setBusy(true); setActionError('')
    try {
      const worst = [...list].sort((a, b) => (ALERT_SEVERITY[b.severity]?.rank || 0) - (ALERT_SEVERITY[a.severity]?.rank || 0))[0]
      await openIncident({
        title: list.length === 1 ? worst.title : `${list.length} related alerts: ${worst.title}`,
        severity: INCIDENT_SEV[worst.severity] || 'sev3',
        impact: list.map((a) => a.affected).filter(Boolean).join('; '),
        source_type: INCIDENT_SOURCE[worst.source] || 'manual',
        source_ref: list.map((a) => a.key).join(',').slice(0, 500),
        message: list.map((a) => `${a.title}. ${a.detail || ''}`).join('\n'),
      })
      await setAlertState({ keys: list.map((a) => a.key), action: 'acknowledge' })
      setNotice('Incident opened and the alerts acknowledged. Follow it in the Incidents tab.')
      setIncidentFor(null); setSelected(new Set()); await load()
    } catch (e) { setActionError(toUserMessage(e, 'The incident could not be opened.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={BellRing} title="Alert Center"
        purpose="Every alert from every part of the platform in one inbox. Acknowledge, assign, snooze or resolve it here, and decide what should alert you next time."
        refreshedAt={tab === 'inbox' ? refreshedAt : null} onRefresh={tab === 'inbox' ? load : undefined} busy={loading}
        actions={tab === 'inbox' && (<>
          <Btn icon={BellRing} onClick={() => setTab('rules')}>New rule</Btn>
          <Btn icon={Siren} onClick={() => setTab('incidents')}>Open incident</Btn>
        </>)} />
      <MovedFrom onPick={setTab} items={[
        { key: 'incidents', label: 'Incidents' }, { key: 'rules', label: 'Alert Rules' },
        { key: 'trust', label: 'Trust Alerts' }, { key: 'self-healing', label: 'Self-Healing' },
      ]} />
      <TabBar tabs={TABS.map((t) => ({ ...t, count: t.key === 'inbox' && data ? counts.open : undefined }))} value={tab} onChange={setTab} ariaLabel="Alert Center sections" />

      {tab === 'rules' && <Embedded page={ConsoleAlertRules} label="alert rules" />}
      {tab === 'incidents' && <Embedded page={ConsoleIncidents} label="incidents" />}
      {tab === 'trust' && <Embedded page={ConsoleTrustAlerts} label="trust alerts" />}
      {tab === 'self-healing' && <Embedded page={ConsoleSelfHealing} label="self-healing" />}

      {tab === 'inbox' && (
        <div className="space-y-4">
          {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}
          {error && <ErrorState message={error} onRetry={load} />}
          {loading && !data && <Panel><LoadingState label="Collecting alerts from 6 sources" rows={5} /></Panel>}

          {data && (<>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {ALERT_SOURCES.map((s) => {
                const t = sourceTile(s.key, data.sources?.[s.key] ?? data.sources?.[`${s.key}s`])
                return <StatTile key={s.key} label={s.label} icon={SOURCE_ICON[s.key]} value={t.value} sub={t.sub} tone={t.tone}
                  onClick={() => { setSource(source === s.key ? '' : s.key); setInboxTab('open') }} active={source === s.key} />
              })}
            </div>

            <Panel>
              <PanelHeader icon={Inbox} title="Inbox"
                subtitle="One list for all 6 alert sources. Repeats are grouped and duplicates shown once."
                actions={(<>
                  {routineOpen.length > 0 && <Btn icon={CheckCircle2} onClick={() => setResolving(routineOpen)}>Resolve all routine ({routineOpen.length})</Btn>}
                  <ExportButtons rows={rows} columns={EXPORT_COLUMNS} title="Alert inbox" />
                </>)} />
              <Toolbar className="mb-3">
                <Segmented ariaLabel="Inbox state" value={inboxTab} onChange={(v) => { setInboxTab(v); setSelected(new Set()) }} options={[
                  { key: 'open', label: 'Open', count: counts.open },
                  { key: 'acknowledged', label: 'Acknowledged', count: counts.acknowledged },
                  { key: 'snoozed', label: 'Snoozed', count: counts.snoozed },
                  { key: 'resolved', label: 'Resolved', count: counts.resolved },
                ]} />
                <SearchInput value={q} onChange={setQ} placeholder="Search alerts, modules, messages" className="w-full sm:w-64" />
                <Select ariaLabel="Source" value={source} onChange={setSource} placeholder="Source: all 6"
                  options={ALERT_SOURCES.map((s) => ({ value: s.key, label: s.label }))} />
                <Select ariaLabel="Severity" value={severity} onChange={setSeverity} placeholder="Severity: all"
                  options={Object.entries(ALERT_SEVERITY).map(([k, v]) => ({ value: k, label: v.label }))} />
                <Select ariaLabel="Owner" value={owner} onChange={setOwner} placeholder="Owner: anyone"
                  options={[{ value: 'none', label: 'Unassigned' }, ...owners.map((p) => ({ value: p.id, label: p.full_name || 'Super admin' }))]} />
                <Segmented ariaLabel="Layout" role="group" value={grouped} onChange={setGrouped}
                  options={[{ key: 'group', label: 'Group' }, { key: 'flat', label: 'Flat' }]} />
              </Toolbar>

              {selectedItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-orange-700/40 bg-orange-950/20 text-xs text-gray-300">
                  <span>{selectedItems.length} selected.</span>
                  <Btn icon={CheckCircle2} busy={busy} onClick={() => act(selectedItems.map((a) => a.key), 'acknowledge')}>Acknowledge</Btn>
                  <Btn icon={UserPlus} onClick={() => { setAssignTo(''); setAssigning(selectedItems.map((a) => a.key)) }}>Assign</Btn>
                  <Btn icon={Clock} busy={busy} onClick={() => act(selectedItems.map((a) => a.key), 'snooze', { snoozeHours: 24 })}>Snooze 24h</Btn>
                  <Btn icon={Siren} onClick={() => setIncidentFor(selectedItems)}>Create incident</Btn>
                  <Btn variant="danger" onClick={() => setResolving(selectedItems.map((a) => a.key))}>Resolve</Btn>
                </div>
              )}
              {actionError && !resolving && !assigning && !incidentFor && <p role="alert" className="text-xs text-red-300 mb-2">{actionError}</p>}

              {rows.length === 0 ? (
                <EmptyState icon={CheckCircle2} title={items.length ? 'Nothing here' : 'No alerts from any source'}
                  reason={items.length ? 'No alert in this state matches the filters.' : 'All 6 sources were read and none has anything open.'} />
              ) : (
                <AlertTable rows={rows} grouped={grouped === 'group'} selected={selected} onToggle={toggle}
                  onOpen={setOpenItem} onAck={(a) => act([a.key], a.recovered ? 'resolve' : 'acknowledge', a.recovered ? { reason: 'Recovered on its own: newer data arrived' } : {})}
                  busy={busy} />
              )}
              {noise && (
                <p className="text-[11px] text-gray-500 mt-3">
                  Noise check: {fmtNum(noise.routine)} of {fmtNum(noise.total)} error log rows ({noise.pct}%) are routine warnings or info notices, which is why they sit in Routine.
                  Alerts sharing a key (same source and message) are counted once while still open. Acknowledging or resolving writes to the audit log. Snooze comes back on its own.
                </p>
              )}
            </Panel>

            <Panel>
              <PanelHeader icon={BellRing} title="Alert rules" subtitle="If this, then tell them. Rules are checked every hour."
                actions={<Btn onClick={() => setTab('rules')}>Manage rules</Btn>} />
              {rules === null ? <ErrorState message="Alert rules could not be read." onRetry={load} />
                : rules.length === 0 ? <EmptyState title="No alert rules yet" reason="Nothing will alert you about fleet numbers until a rule is added." action={<Btn onClick={() => setTab('rules')}>Add a rule</Btn>} />
                : (
                  <ul className="space-y-2 text-xs">
                    {rules.map((r) => (
                      <li key={r.id} className="flex items-start justify-between gap-3">
                        <span className="text-gray-300">{ruleSentence({ ...r, metric: metricLabel(r.metric).toLowerCase() })}</span>
                        <Badge tone={r.active ? 'good' : 'quiet'}>{r.active ? 'On' : 'Off'}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              <div className="mt-3"><Note icon={Info}>
                Quiet hours, reminders and wait-before-alerting are not applied by the senders today, so they are not offered here. Adding them needs a change to the hourly check and the delivery job.
              </Note></div>
            </Panel>
          </>)}
        </div>
      )}

      <AlertDrawer item={openItem} onClose={() => setOpenItem(null)} busy={busy}
        onAct={(action, extra) => (action === 'resolve' ? setResolving([openItem.key]) : act([openItem.key], action, extra))}
        onAssign={() => { setAssignTo(openItem.owner_id || ''); setAssigning([openItem.key]) }}
        onIncident={() => setIncidentFor([openItem])} />

      <ConfirmImpactDialog open={!!resolving} danger requireReason title={`Resolve ${resolving?.length || 0} alert${resolving?.length === 1 ? '' : 's'}`}
        confirmLabel="Resolve" busy={busy} error={actionError} onCancel={() => { setResolving(null); setActionError('') }}
        onConfirm={({ reason }) => act(resolving, 'resolve', { reason })}
        impact={{
          tone: 'danger', what: 'Moves these alerts to Resolved.',
          change: 'They leave the open inbox. The underlying rows (log rows, scan findings, notices) are not changed.',
          who: 'Nobody is notified. Your reason goes to the audit log.',
          undo: 'Yes. Reopen from the Resolved tab. If the same problem happens again it shows up as a new alert.',
          stats: [{ label: 'Alerts', value: resolving?.length || 0 }],
        }} />

      <Modal open={!!assigning} title={`Assign ${assigning?.length || 0} alert${assigning?.length === 1 ? '' : 's'}`} onClose={() => setAssigning(null)} width="max-w-md"
        footer={(<>
          <Btn onClick={() => setAssigning(null)}>Cancel</Btn>
          <Btn variant="primary" busy={busy} disabled={!assignTo} onClick={() => act(assigning, 'assign', { owner: assignTo })}>Assign</Btn>
        </>)}>
        <div className="space-y-3">
          <Select ariaLabel="Assign to" value={assignTo} onChange={setAssignTo} placeholder="Choose a super admin"
            options={owners.map((p) => ({ value: p.id, label: p.full_name || 'Super admin' }))} />
          <p className="text-[11px] text-gray-500">The owner sees it as theirs in this inbox. Owners are super admins, because only they can open the Control Center.</p>
          {actionError && <p role="alert" className="text-xs text-red-300">{actionError}</p>}
        </div>
      </Modal>

      <ConfirmImpactDialog open={!!incidentFor} title="Open an incident" confirmLabel="Open incident" busy={busy} error={actionError}
        onCancel={() => { setIncidentFor(null); setActionError('') }} onConfirm={() => createIncident(incidentFor)}
        impact={{
          tone: 'warning', what: `Opens one incident for ${incidentFor?.length || 0} alert${incidentFor?.length === 1 ? '' : 's'} and acknowledges them.`,
          change: 'A new incident appears in the Incidents tab with these alerts as its source.',
          who: 'Every super admin is notified for severity 1 and 2 incidents.',
          undo: 'Resolve the incident when done. An opened incident stays in the record.',
        }} />
    </div>
  )
}

function AlertRow({ a, selected, onToggle, onOpen, onAck, busy }) {
  const sev = ALERT_SEVERITY[a.severity] || ALERT_SEVERITY.info
  const age = daysSince(a.first_at)
  const done = a.state === 'resolved'
  return (
    <Tr onClick={() => onOpen(a)} ariaLabel={`Open ${a.title}`}>
      <Td><input type="checkbox" className="accent-orange-500" aria-label={`Select ${a.title}`} checked={selected.has(a.key)}
        onClick={(e) => e.stopPropagation()} onChange={() => onToggle(a.key)} /></Td>
      <Td><Badge tone={sev.tone}>{sev.label}</Badge></Td>
      <Td nowrap>{ALERT_SOURCE_LABEL[a.source] || a.source}</Td>
      <Td className="max-w-[28rem]">
        <p className="text-gray-200 break-words">{a.title}{Number(a.groups) > 1 && <span className="text-gray-500"> ({a.groups} grouped)</span>}</p>
        {a.detail && <p className="text-[11px] text-gray-500 break-words">{a.detail}</p>}
      </Td>
      <Td>{a.affected || 'N/A'}</Td>
      <Td nowrap>{age == null ? 'N/A' : `${age} d`}</Td>
      <Td nowrap>{a.owner_name || <span className="text-gray-500">Unassigned</span>}</Td>
      <Td nowrap><Badge tone={a.recovered ? 'good' : a.state === 'snoozed' ? 'quiet' : 'default'}>{a.recovered && !done ? 'Recovered' : (a.state || 'new').replace(/^./, (c) => c.toUpperCase())}</Badge></Td>
      <Td>{!done && (a.recovered || a.state !== 'acknowledged') && (
        <Btn size="xs" busy={busy} onClick={(e) => { e.stopPropagation(); onAck(a) }}>{a.recovered ? 'Close' : 'Acknowledge'}</Btn>
      )}</Td>
    </Tr>
  )
}

function AlertTable({ rows, grouped, ...rest }) {
  const head = (
    <THead>
      <Th className="w-8"><span className="sr-only">Select</span></Th>
      <Th>Severity</Th><Th>Source</Th><Th>What happened</Th><Th>Affected</Th><Th>Age</Th><Th>Owner</Th><Th>State</Th><Th>Action</Th>
    </THead>
  )
  if (!grouped) {
    return <Table>{head}<tbody>{rows.map((a) => <AlertRow key={a.key} a={a} {...rest} />)}</tbody></Table>
  }
  return (
    <Table>
      {head}
      {ALERT_GROUPS.map((g) => {
        const list = rows.filter((a) => alertGroup(a) === g.key)
        if (!list.length) return null
        return (
          <tbody key={g.key}>
            <tr><td colSpan={9} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.label} ({list.length})</td></tr>
            {list.map((a) => <AlertRow key={a.key} a={a} {...rest} />)}
          </tbody>
        )
      })}
    </Table>
  )
}

function AlertDrawer({ item, onClose, onAct, onAssign, onIncident, busy }) {
  if (!item) return null
  const done = item.state === 'resolved'
  const link = { crash: '/console/crash-reports?tab=issues', error_log: '/console/crash-reports', upload_gap: '/console/health', security: '/console/security-audit', trust: '/console/alerts?tab=trust', incident: '/console/alerts?tab=incidents' }[item.source]
  return (
    <Drawer open title={item.title} subtitle={`${ALERT_SEVERITY[item.severity]?.label || item.severity} from ${ALERT_SOURCE_LABEL[item.source] || item.source}`} onClose={onClose}
      footer={(<>
        {done ? <Btn busy={busy} onClick={() => onAct('reopen')}>Reopen</Btn> : (<>
          <Btn busy={busy} onClick={() => onAct('acknowledge')}>Acknowledge</Btn>
          <Btn busy={busy} onClick={() => onAct('snooze', { snoozeHours: 24 })}>Snooze 24h</Btn>
          <Btn onClick={onAssign}>Assign</Btn>
          <Btn onClick={onIncident}>Create incident</Btn>
          <Btn variant="danger" onClick={() => onAct('resolve')}>Resolve</Btn>
        </>)}
      </>)}>
      <div className="space-y-3">
        {item.detail && <p className="text-xs text-gray-300">{item.detail}</p>}
        <DetailList items={[
          ['Affected', item.affected],
          ['Occurrences', fmtNum(item.count)],
          ['First seen', riyadhDateTime(item.first_at)],
          ['Last seen', riyadhDateTime(item.last_at)],
          ['Newest data since', item.recovered ? riyadhDateTime(item.newest_data) : null],
          ['Owner', item.owner_name || 'Unassigned'],
          ['State', item.state || 'new'],
          ['Snoozed until', item.snoozed_until ? riyadhDateTime(item.snoozed_until) : null],
          ['Note', item.note],
        ]} />
        {link && <ConsoleLink to={link}>Open the source</ConsoleLink>}
      </div>
    </Drawer>
  )
}

