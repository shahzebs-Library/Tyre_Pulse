/**
 * ErrorOverview - the first tab of the Error Center.
 *
 * Every row in system_logs (web page errors, Android crashes mirrored from
 * Sentry, background job notices) grouped by fault, so the same error counts
 * once. Triage state (owner, status, fixed in version, notify when fixed) lives
 * in error_group_state because system_logs is append-only on purpose (its
 * immutability trigger refuses every UPDATE), which is also why the old
 * "resolve log rows" button could never have worked.
 *
 * People affected is split staff (super admins) versus customers (every other
 * account), from system_logs.user_id. A group with no user id says so; it is
 * never shown as "0 people".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bug, CheckCircle2, Info, Smartphone, Users, AlertTriangle, ShieldAlert, Wrench, BellRing, ExternalLink } from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../../components/ui'
import { TrendChart } from '../../components/ui/charts'
import { Drawer, Field, DetailList, Pager, usePaged } from '../shared/pageKit'
import ExportButtons from '../shared/ExportButtons'
import {
  getErrorGroups, setErrorGroupState, resolveErrorGroups, getUserIssueSummary, listOwnerProfiles,
} from '../../../lib/api/monitorCenter'
import {
  fmtNum, shortDate, riyadhDateTime, ERROR_STATUSES, ERROR_STATUS_META,
  groupStatus, surfaceLabel, peopleLabel, groupTitle, errorFacets, filterErrorGroups, dailySeries,
} from '../../../lib/monitorCenter'
import { toUserMessage } from '../../../lib/safeError'

const SEV_TONE = { critical: 'danger', error: 'danger', warning: 'warning', info: 'quiet' }
const SEV_LABEL = { critical: 'Critical', error: 'Error', warning: 'Warning', info: 'Info' }
const INPUT = 'w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

const EXPORT_COLUMNS = [
  { key: 'severity', header: 'Severity' },
  { key: 'title', header: 'Error', value: (g) => groupTitle(g) },
  { key: 'status', header: 'Status', value: (g) => ERROR_STATUS_META[groupStatus(g)]?.label || groupStatus(g) },
  { key: 'surface', header: 'Where', value: (g) => surfaceLabel(g) },
  { key: 'events', header: 'Events' },
  { key: 'people', header: 'People affected', value: (g) => peopleLabel(g).note },
  { key: 'first_seen', header: 'First seen', value: (g) => riyadhDateTime(g.first_seen) || 'N/A' },
  { key: 'last_seen', header: 'Last seen', value: (g) => riyadhDateTime(g.last_seen) || 'N/A' },
  { key: 'owner', header: 'Owner', value: (g) => g.state?.owner_name || 'Unassigned' },
  { key: 'version', header: 'Fixed in version', value: (g) => g.state?.resolved_in_version || '' },
]

export default function ErrorOverview({ onOpenTab }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [issueSummary, setIssueSummary] = useState(null)
  const [owners, setOwners] = useState([])
  const [range, setRange] = useState('14')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [surface, setSurface] = useState('')
  const [who, setWho] = useState('')
  const [sort, setSort] = useState('newest')
  const [selected, setSelected] = useState(() => new Set())
  const [open, setOpen] = useState(null)
  const [bulk, setBulk] = useState(null) // { keys, label }
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [d, s, o] = await Promise.allSettled([getErrorGroups(null), getUserIssueSummary(), listOwnerProfiles()])
      if (d.status === 'rejected') throw d.reason
      setData(d.value)
      setIssueSummary(s.status === 'fulfilled' ? s.value : null)
      setOwners(o.status === 'fulfilled' ? (o.value || []).filter((p) => !p.locked) : [])
    } catch (e) {
      setError(toUserMessage(e, 'The error groups could not be loaded.'))
      setData(null)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => data?.groups || [], [data])
  const facets = useMemo(() => errorFacets(groups), [groups])
  const rows = useMemo(() => filterErrorGroups(groups, { q, status, severity, surface, who, sort }), [groups, q, status, severity, surface, who, sort])
  const paged = usePaged(rows, 25, `${q}|${status}|${severity}|${surface}|${who}|${sort}`)
  const series = useMemo(() => dailySeries(data?.daily || [], Number(range)), [data, range])
  const t = data?.totals || {}
  const cov = data?.coverage || {}
  const routineKeys = useMemo(() => groups.filter((g) => groupStatus(g) === 'routine').map((g) => g.key), [groups])
  const fixedInCode = useMemo(() => groups.filter((g) => groupStatus(g) === 'fixed_in_code'), [groups])
  const phoneGroups = useMemo(() => groups.filter((g) => (g.surfaces || []).includes('android')), [groups])
  const peak = useMemo(() => {
    let best = null
    series.total.forEach((v, i) => { if (v > 0 && (!best || v > best.v)) best = { v, label: series.labels[i] } })
    return best
  }, [series])

  const toggle = (key) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  })

  async function runBulk({ reason }) {
    if (!bulk) return
    setBusy(true); setActionError('')
    try {
      const res = await resolveErrorGroups(bulk.keys, reason)
      setNotice(`${fmtNum(res?.resolved ?? bulk.keys.length)} error groups marked resolved. A new occurrence reopens a group by itself.`)
      setBulk(null); setSelected(new Set()); await load()
    } catch (e) { setActionError(toUserMessage(e, 'Nothing was changed.')) }
    finally { setBusy(false) }
  }

  if (loading && !data) return <Panel><LoadingState label="Grouping the error log" rows={5} /></Panel>
  if (error && !data) return <ErrorState message={error} onRetry={load} />

  const sevSegments = [
    { label: 'Critical', value: t.critical, tone: 'danger' },
    { label: 'Error', value: t.error, tone: 'accent' },
    { label: 'Warning', value: t.warning, tone: 'warning' },
    { label: 'Info', value: t.info, tone: 'muted' },
  ]
  const customersHit = (data?.accounts || []).filter((a) => !a.staff).length

  return (
    <div className="space-y-4">
      {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}
      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Unresolved" value={fmtNum(t.unresolved)} icon={Bug} sub={`of ${fmtNum(t.rows)} log rows`}
          onClick={() => setStatus('')} active={!status && !severity} />
        <StatTile label="Critical" value={fmtNum(t.critical)} tone={t.critical ? 'danger' : 'default'} icon={ShieldAlert}
          sub="phone crashes and worse" onClick={() => setSeverity('critical')} active={severity === 'critical'} />
        <StatTile label="Errors" value={fmtNum(t.error)} tone={t.error ? 'accent' : 'default'} icon={AlertTriangle}
          sub="page errors" onClick={() => setSeverity('error')} active={severity === 'error'} />
        <StatTile label="Warnings" value={fmtNum(t.warning)} tone={t.warning ? 'warning' : 'default'}
          sub="self-healing and notices" onClick={() => setSeverity('warning')} active={severity === 'warning'} />
        <StatTile label="Info" value={fmtNum(t.info)} tone="muted" sub="routine notices"
          onClick={() => setSeverity('info')} active={severity === 'info'} />
        <StatTile label="New today" value={fmtNum(t.new_today)} sub={`${fmtNum(t.new_today_errors)} errors, Riyadh day`} />
        <StatTile label="Errors with a user id" value={`${fmtNum(cov.error_rows_with_user)} of ${fmtNum(cov.error_rows)}`} icon={Users}
          sub="so we know who was hit" />
        <StatTile label="Reported problems" icon={BellRing}
          value={issueSummary ? fmtNum(issueSummary.open ?? issueSummary.total_open ?? issueSummary.total) : 'Open tab'}
          sub={issueSummary ? 'from the Report a problem inbox' : 'counts load in their own tab'}
          onClick={() => onOpenTab?.('reported')} />
      </div>

      <Panel>
        <PanelHeader icon={Bug} title="What is open"
          subtitle={`${fmtNum(t.unresolved)} unresolved rows, by severity. Info rows are notices, not faults.`}
          actions={routineKeys.length > 0 && (
            <Btn icon={CheckCircle2} onClick={() => setBulk({ keys: routineKeys, label: 'routine notice groups' })}>
              Resolve {fmtNum(routineKeys.length)} routine groups
            </Btn>
          )} />
        <ProportionBar segments={sevSegments} total={t.unresolved} />
        <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500">
          {sevSegments.map((s) => <span key={s.label}>{s.label}: <span className="text-gray-300 tabular-nums">{fmtNum(s.value)}</span></span>)}
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={AlertTriangle} title="New entries per day"
          subtitle={peak ? `Peak ${fmtNum(peak.v)} on ${peak.label}` : 'Nothing logged in this window'}
          actions={<Segmented ariaLabel="Trend window" value={range} onChange={setRange}
            options={[{ key: '14', label: '14D' }, { key: '30', label: '30D' }, { key: '90', label: '90D' }]} />} />
        <TrendChart labels={series.labels} height={200}
          series={[{ label: 'All entries', values: series.total }, { label: 'Error or critical', values: series.errors }]}
          summary={`${series.total.reduce((a, b) => a + b, 0)} entries in ${range} days, ${series.errors.reduce((a, b) => a + b, 0)} of them errors.`} />
      </Panel>

      <Panel>
        <PanelHeader icon={Bug} title="Grouped errors"
          subtitle="The same fault counts once. Open a group to assign it, mark it fixed in a release, or tell the people it hit."
          actions={<ExportButtons rows={rows} columns={EXPORT_COLUMNS} title="Error groups" />} />
        <Toolbar className="mb-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search message, page or source" className="w-full sm:w-64" />
          <Select ariaLabel="Status" value={status} onChange={setStatus} placeholder="Any status"
            options={ERROR_STATUSES.map((s) => ({ value: s.key, label: `${s.label} (${facets.status[s.key] || 0})` }))} />
          <Select ariaLabel="Severity" value={severity} onChange={setSeverity} placeholder="Any severity"
            options={Object.keys(SEV_LABEL).map((k) => ({ value: k, label: `${SEV_LABEL[k]} (${facets.severity[k] || 0})` }))} />
          <Select ariaLabel="Where" value={surface} onChange={setSurface} placeholder="Anywhere"
            options={Object.keys(facets.surface).map((k) => ({ value: k, label: `${k} (${facets.surface[k]})` }))} />
          <Select ariaLabel="Who was hit" value={who} onChange={setWho} placeholder="Anyone"
            options={[
              { value: 'customers', label: `Customers (${facets.who.customers})` },
              { value: 'staff', label: `Staff (${facets.who.staff})` },
              { value: 'none', label: `No user id (${facets.who.none})` },
            ]} />
          <Select ariaLabel="Sort" value={sort} onChange={setSort}
            options={[{ value: 'newest', label: 'Newest first' }, { value: 'events', label: 'Most events' }, { value: 'people', label: 'Most people' }, { value: 'severity', label: 'Worst first' }]} />
        </Toolbar>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-orange-700/40 bg-orange-950/20 text-xs text-gray-300">
            <span>{selected.size} selected.</span>
            <Btn variant="danger" icon={CheckCircle2} onClick={() => setBulk({ keys: [...selected], label: 'selected groups' })}>Resolve selected</Btn>
            <Btn variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={groups.length ? 'No group matches these filters' : 'No errors logged'}
            reason={groups.length ? 'Clear a filter to see more.' : 'The error log is empty for every source.'} />
        ) : (
          <>
            <Table>
              <THead>
                <Th className="w-8"><span className="sr-only">Select</span></Th>
                <Th>Severity</Th><Th>Error</Th><Th>Where</Th><Th align="right">Events</Th>
                <Th>People affected</Th><Th>Last seen</Th><Th>Status</Th>
              </THead>
              <tbody>
                {paged.rows.map((g) => {
                  const st = ERROR_STATUS_META[groupStatus(g)]
                  const pl = peopleLabel(g)
                  return (
                    <Tr key={g.key} onClick={() => setOpen(g)} ariaLabel={`Open ${groupTitle(g)}`}>
                      <Td>
                        <input type="checkbox" aria-label={`Select ${groupTitle(g)}`} checked={selected.has(g.key)}
                          onClick={(e) => e.stopPropagation()} onChange={() => toggle(g.key)} className="accent-orange-500" />
                      </Td>
                      <Td><Badge tone={SEV_TONE[g.severity]}>{SEV_LABEL[g.severity] || g.severity}</Badge></Td>
                      <Td className="max-w-[26rem]"><span className="text-gray-200 line-clamp-2 break-words">{groupTitle(g)}</span></Td>
                      <Td nowrap>{surfaceLabel(g)}</Td>
                      <Td align="right" className="tabular-nums">{fmtNum(g.events)}</Td>
                      <Td nowrap>{pl.value == null ? <span className="text-gray-500">N/A, {pl.note}</span> : pl.note}</Td>
                      <Td nowrap>{shortDate(g.last_seen) || 'N/A'}</Td>
                      <Td nowrap><Badge tone={st?.tone}>{st?.label || groupStatus(g)}</Badge>{g.state?.regressed_at && <Badge tone="danger">Came back</Badge>}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
            <Pager paged={paged} label="groups" />
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={Users} title="Who is affected" subtitle="Accounts behind error or critical rows. Emails are masked." />
          <DetailList items={[
            ['Web errors with a user id', `${fmtNum(cov.web_errors_with_user)} of ${fmtNum(cov.web_errors)}`],
            ['Android crashes with a user id', `${fmtNum(cov.android_with_user)} of ${fmtNum(cov.android_crashes)}`],
            ['All log rows with a user id', `${fmtNum(cov.all_with_user)} of ${fmtNum(cov.all_rows)}`],
            ['Customer accounts with a logged error', `${fmtNum(customersHit)} of ${fmtNum(data?.customer_accounts)}`],
          ]} />
          {(data?.accounts || []).length === 0 ? (
            <EmptyState title="No account is linked to an error" reason="No error or critical row carries a user id." />
          ) : (
            <Table className="mt-3">
              <THead><Th>Account</Th><Th>Kind</Th><Th align="right">Events</Th><Th align="right">Groups</Th><Th>Last error</Th></THead>
              <tbody>
                {data.accounts.slice(0, 10).map((a) => (
                  <Tr key={a.user_id}>
                    <Td nowrap>{a.email || 'Email not recorded'}</Td>
                    <Td><Badge tone={a.staff ? 'info' : 'accent'}>{a.staff ? 'Staff' : 'Customer'}</Badge> <span className="text-gray-500">{a.role || ''}</span></Td>
                    <Td align="right" className="tabular-nums">{fmtNum(a.events)}</Td>
                    <Td align="right" className="tabular-nums">{fmtNum(a.groups)}</Td>
                    <Td nowrap>{shortDate(a.last_error) || 'N/A'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {Number(cov.android_crashes) > 0 && Number(cov.android_with_user) === 0 && (
            <div className="mt-3"><Note icon={Info} tone="warning">
              Android crashes do not say who crashed. These come from the retired Expo app, which sends crashes without
              a user id, so a customer could be crashing without appearing here. The Flutter field app does not report
              crashes yet (its release workflow has no Sentry DSN); adding it needs a new Flutter build, which is the owner&apos;s call.
            </Note></div>
          )}
          {customersHit === 0 && (
            <p className="text-[11px] text-gray-500 mt-2">No customer account has a logged error. That may mean customers are fine, or that their errors are not reaching us (see the Android crash gap).</p>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader icon={Smartphone} title="Phone crashes" subtitle="Grouped Android crashes mirrored from Sentry (today from the retired Expo app; the Flutter app does not report crashes yet)." />
            {phoneGroups.length === 0 ? (
              <EmptyState title="No phone crashes logged" reason="No Android crash has reached the error log." />
            ) : (
              <ul className="space-y-2 text-xs">
                {phoneGroups.map((g) => (
                  <li key={g.key} className="flex items-start justify-between gap-2">
                    <span className="text-gray-300 break-words">{groupTitle(g)}</span>
                    <span className="text-gray-500 whitespace-nowrap tabular-nums">{fmtNum(g.events)}, last {shortDate(g.last_seen) || 'N/A'}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-500 mt-2">By release: N/A. The crash rows do not record the app version, so crashes cannot be split by release yet.</p>
            <div className="mt-2"><Btn icon={ExternalLink} onClick={() => onOpenTab?.('issues')}>Open the Sentry issues</Btn></div>
          </Panel>
          <Panel>
            <PanelHeader icon={Wrench} title="Fixed in code, waiting for release"
              subtitle="Groups someone marked fixed. They close once a release ships, and reopen by themselves if the error comes back." />
            {fixedInCode.length === 0 ? (
              <EmptyState title="Nothing is waiting for a release" reason="No group is marked fixed in code." />
            ) : (
              <ul className="space-y-2 text-xs">
                {fixedInCode.map((g) => (
                  <li key={g.key} className="flex items-start justify-between gap-2">
                    <button type="button" className="text-left text-gray-300 hover:text-orange-300" onClick={() => setOpen(g)}>{groupTitle(g)}</button>
                    <span className="text-gray-500 whitespace-nowrap">{g.state?.resolved_in_version ? `in ${g.state.resolved_in_version}` : 'version not set'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <GroupDrawer group={open} owners={owners} onClose={() => setOpen(null)}
        onSaved={(msg) => { setNotice(msg); setOpen(null); load() }} />

      <ConfirmImpactDialog open={!!bulk} danger title={`Resolve ${bulk?.keys.length || 0} ${bulk?.label || 'groups'}`}
        confirmLabel="Resolve" requireReason typedWord="RESOLVE" busy={busy} error={actionError}
        onCancel={() => { setBulk(null); setActionError('') }} onConfirm={runBulk}
        impact={{
          tone: 'danger',
          what: `Marks ${bulk?.keys.length || 0} error groups as resolved.`,
          change: 'They leave the open list. The log rows themselves are kept exactly as they are.',
          who: 'Nobody is notified. The change is written to the audit log with your reason.',
          undo: 'Yes. Reopen any group from its drawer, and a new occurrence reopens it by itself.',
          stats: [{ label: 'Groups', value: bulk?.keys.length || 0 }],
        }} />
    </div>
  )
}

function GroupDrawer({ group, owners, onClose, onSaved }) {
  const [status, setStatus] = useState('')
  const [owner, setOwner] = useState('')
  const [version, setVersion] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!group) return
    setStatus(groupStatus(group)); setOwner(group.state?.owner_id || ''); setVersion(group.state?.resolved_in_version || '')
    setNote(group.state?.note || ''); setNotify(Boolean(group.state?.notify_when_fixed)); setErr('')
  }, [group])

  if (!group) return null
  const pl = peopleLabel(group)
  const closing = status === 'resolved' || status === 'ignored'

  async function save(reason = null) {
    setBusy(true); setErr('')
    try {
      const res = await setErrorGroupState({ key: group.key, status, owner: owner || null, version, note, notify, reason })
      const told = Number(res?.notified) || 0
      onSaved(`Saved.${told ? ` ${told} affected people were told it is fixed.` : ''}`)
      setConfirm(false)
    } catch (e) { setErr(toUserMessage(e, 'Nothing was changed.')) }
    finally { setBusy(false) }
  }

  return (
    <>
      <Drawer open title={groupTitle(group)} subtitle={`${SEV_LABEL[group.severity] || group.severity} in ${surfaceLabel(group)}`} onClose={onClose}
        footer={(<>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant={closing ? 'danger' : 'primary'} busy={busy} onClick={() => (closing ? setConfirm(true) : save())}>Save</Btn>
        </>)}>
        <div className="space-y-4">
          <DetailList items={[
            ['Events', `${fmtNum(group.events)} (${fmtNum(group.unresolved_events)} unresolved)`],
            ['People affected', pl.value == null ? `N/A, ${pl.note}` : pl.note],
            ['Rows with no user id', fmtNum(group.no_user_events)],
            ['First seen', riyadhDateTime(group.first_seen) || 'N/A'],
            ['Last seen', riyadhDateTime(group.last_seen) || 'N/A'],
            ['Sources', (group.sources || []).join(', ') || 'N/A'],
            ['Pages', (group.urls || []).join(', ') || 'Not recorded'],
            ['Reopened after a fix', group.state?.regressed_at ? riyadhDateTime(group.state.regressed_at) : 'No'],
          ]} />
          <p className="text-xs text-gray-400 break-words bg-gray-900/50 border border-gray-800 rounded-lg p-2 font-mono">{group.sample}</p>
          <Field label="Status">
            <Select ariaLabel="Status" value={status} onChange={setStatus}
              options={ERROR_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
          </Field>
          <Field label="Owner">
            <Select ariaLabel="Owner" value={owner} onChange={setOwner} placeholder="Unassigned"
              options={owners.map((p) => ({ value: p.id, label: p.full_name || 'Super admin' }))} />
            <p className="text-[11px] text-gray-500 mt-1">Giving a new group an owner moves it to Reviewed.</p>
          </Field>
          <Field label="Fixed in version">
            <input className={INPUT} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="For example 2.1.3 or web build date" />
          </Field>
          <Field label="Note">
            <textarea className={INPUT} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was found or changed" />
          </Field>
          <label className="flex items-start gap-2 text-xs text-gray-300">
            <input type="checkbox" className="accent-orange-500 mt-0.5" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>Tell affected people when fixed. When this group is resolved, each account that hit it gets one in-app message. {pl.value == null ? 'Nobody can be told: no row carries a user id.' : `Reaches ${pl.note}.`}</span>
          </label>
          {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
        </div>
      </Drawer>
      <ConfirmImpactDialog open={confirm} danger title={status === 'resolved' ? 'Resolve this error group' : 'Ignore this error group'}
        confirmLabel={status === 'resolved' ? 'Resolve' : 'Ignore'} requireReason busy={busy} error={err}
        onCancel={() => setConfirm(false)} onConfirm={({ reason }) => save(reason)}
        impact={{
          tone: 'danger',
          what: status === 'resolved' ? 'Marks this fault as fixed.' : 'Hides this fault from the open list.',
          change: 'The group leaves the open list. Log rows are kept.',
          who: notify && status === 'resolved' && pl.value != null ? `${pl.note} get one in-app message that it is fixed.` : 'Nobody is notified.',
          undo: 'Yes. Set the status back, and a new occurrence reopens it by itself. A sent message cannot be unsent.',
        }} />
    </>
  )
}

