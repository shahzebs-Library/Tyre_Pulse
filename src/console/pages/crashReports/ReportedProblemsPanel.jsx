/**
 * ReportedProblemsPanel - the "Reported problems" inbox on the Error Center
 * (/console/crash-reports?tab=reported). Problem Tracking, Phase 1.
 *
 * Lists what people told us through "Report a problem", with filters, a detail
 * drawer (report, linked error logs, history) and the triage actions: owner,
 * status, fixed-in version and notes. Every action goes through an RPC that
 * writes a history row; marking a report fixed sends the reporter an in-app
 * message. Independent of the Sentry connection above it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MessageSquare, RefreshCw, Clock, AlertTriangle, CheckCircle2, UserPlus, Send, Info, Bug,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../../components/ui'
import { Drawer, Pager, usePaged, PAGE_SIZE } from '../shared/pageKit'
import ExportButtons from '../shared/ExportButtons'
import {
  ISSUE_CATEGORIES, ISSUE_SEVERITIES, ISSUE_STATUSES, ISSUE_PLATFORMS, STATUS_IMPACT,
  categoryLabel, severityLabel, statusLabel, platformLabel, filterIssues, isOpenStatus, slaState,
} from '../../../lib/problemReport'
import {
  listUserIssues, listIssueEvents, getIssueLogs, setIssueStatus, assignIssue, commentIssue, listIssueOwners,
} from '../../../lib/api/userIssues'

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

const SEVERITY_TONE = { critical: 'danger', high: 'warning', medium: 'accent', low: 'default' }
const STATUS_TONE = { new: 'accent', triaged: 'default', in_progress: 'warning', waiting_user: 'default', fixed: 'good', closed: 'default', wont_fix: 'default' }

const EXPORT_COLUMNS = [
  { key: 'created_at', label: 'Reported' },
  { key: 'reporter_name', label: 'Reporter' },
  { key: 'org_name', label: 'Company' },
  { key: 'country', label: 'Country' },
  { key: 'site', label: 'Site' },
  { key: 'platform', label: 'Platform' },
  { key: 'app_version', label: 'App version' },
  { key: 'page_or_screen', label: 'Page' },
  { key: 'category', label: 'Type' },
  { key: 'severity', label: 'Severity' },
  { key: 'status', label: 'Status' },
  { key: 'assignee_name', label: 'Owner' },
  { key: 'fixed_in_version', label: 'Fixed in' },
  { key: 'description', label: 'Description' },
]

function when(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function describeEvent(ev, ownerName) {
  switch (ev.event_type) {
    case 'created': return 'Reported the problem'
    case 'status': return `Changed status from ${statusLabel(ev.from_value)} to ${statusLabel(ev.to_value)}`
    case 'assign': return ev.to_value ? `Set the owner to ${ownerName(ev.to_value) || 'an administrator'}` : 'Removed the owner'
    case 'fixed_version': return `Set the fixed-in version to ${ev.to_value || 'N/A'}`
    case 'comment': return 'Added a note'
    default: return ev.event_type
  }
}

export default function ReportedProblemsPanel() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [owners, setOwners] = useState([])

  const [status, setStatus] = useState('open')
  const [category, setCategory] = useState('')
  const [severity, setSeverity] = useState('')
  const [platform, setPlatform] = useState('')
  const [org, setOrg] = useState('')
  const [search, setSearch] = useState('')

  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [list, people] = await Promise.all([listUserIssues(), listIssueOwners()])
      setRows(list); setOwners(people)
    } catch (e) {
      setRows([]); setError(e?.message || 'Reported problems could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(
    () => filterIssues(rows, { status, category, severity, platform, org, search }),
    [rows, status, category, severity, platform, org, search],
  )
  const paged = usePaged(filtered, PAGE_SIZE, `${status}|${category}|${severity}|${platform}|${org}|${search}`)

  const counts = useMemo(() => {
    const open = rows.filter((r) => isOpenStatus(r.status))
    return {
      open: open.length,
      fresh: rows.filter((r) => r.status === 'new').length,
      urgent: open.filter((r) => r.severity === 'critical' || r.severity === 'high').length,
      late: open.filter((r) => slaState(r) === 'breached').length,
      fixed: rows.filter((r) => r.status === 'fixed').length,
    }
  }, [rows])

  const orgOptions = useMemo(() => {
    const m = new Map()
    for (const r of rows) if (r.organisation_id) m.set(r.organisation_id, r.org_name || 'Unnamed company')
    return [...m.entries()].map(([value, label]) => ({ value, label }))
  }, [rows])

  const current = rows.find((r) => r.id === openId) || null
  const ownerName = useCallback((id) => {
    const p = owners.find((o) => o.id === id)
    return p ? p.name : null
  }, [owners])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Open" value={loading || error ? 'N/A' : counts.open} icon={MessageSquare}
          onClick={() => setStatus('open')} active={status === 'open'} />
        <StatTile label="Not reviewed" value={loading || error ? 'N/A' : counts.fresh} icon={Info}
          tone={counts.fresh > 0 ? 'accent' : 'default'} onClick={() => setStatus('new')} active={status === 'new'} />
        <StatTile label="High or critical" value={loading || error ? 'N/A' : counts.urgent} icon={AlertTriangle}
          tone={counts.urgent > 0 ? 'danger' : 'default'} sub="Still open" />
        <StatTile label="Past target time" value={loading || error ? 'N/A' : counts.late} icon={Clock}
          tone={counts.late > 0 ? 'warning' : 'default'} sub="Critical 4h, high 1 day, others 5 days" />
        <StatTile label="Fixed" value={loading || error ? 'N/A' : counts.fixed} icon={CheckCircle2}
          tone="good" onClick={() => setStatus('fixed')} active={status === 'fixed'} />
      </div>

      <ErrorState message={error} onRetry={load} />

      <Panel>
        <PanelHeader icon={MessageSquare} title="Reported problems"
          subtitle="What people told us through Report a problem. Click a row for details, linked errors and history."
          actions={<>
            <ExportButtons rows={filtered} columns={EXPORT_COLUMNS} title="Reported Problems" />
            <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          </>} />

        <Toolbar className="mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search description, page, reporter" className="flex-1 min-w-[200px]" />
          <Select ariaLabel="Status" value={status} onChange={setStatus}
            options={[{ value: 'open', label: 'All open' }, { value: 'all', label: 'All statuses' },
              ...ISSUE_STATUSES.map((s) => ({ value: s.key, label: s.label }))]} />
          <Select ariaLabel="Type" value={category} onChange={setCategory} placeholder="All types"
            options={ISSUE_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
          <Select ariaLabel="Severity" value={severity} onChange={setSeverity} placeholder="All severities"
            options={ISSUE_SEVERITIES.map((s) => ({ value: s.key, label: severityLabel(s.key) }))} />
          <Select ariaLabel="Platform" value={platform} onChange={setPlatform} placeholder="All platforms"
            options={ISSUE_PLATFORMS.map((p) => ({ value: p.key, label: p.label }))} />
          {orgOptions.length > 1 && (
            <Select ariaLabel="Company" value={org} onChange={setOrg} placeholder="All companies" options={orgOptions} />
          )}
        </Toolbar>

        {loading ? <LoadingState label="Loading reported problems" rows={4} />
          : error ? <EmptyState icon={Bug} title="Reports could not be loaded" reason="Nothing is listed rather than showing an empty inbox that may not be true." />
          : filtered.length === 0 ? (
            <EmptyState icon={CheckCircle2}
              title={rows.length === 0 ? 'No problems have been reported yet' : 'No reports match these filters'}
              reason={rows.length === 0 ? 'People can report a problem from their profile menu or from the error screen.' : 'Change or clear the filters to see more.'} />
          ) : (
            <>
              <Table>
                <THead>
                  <Th>Reported</Th><Th>Reporter</Th><Th>Problem</Th><Th>Type</Th><Th>Severity</Th>
                  <Th>Status</Th><Th>Owner</Th><Th>Where</Th>
                </THead>
                <tbody>
                  {paged.rows.map((r) => {
                    const sla = slaState(r)
                    return (
                      <Tr key={r.id} onClick={() => setOpenId(r.id)} ariaLabel={`Open report from ${r.reporter_name || 'unknown person'}`}
                        tone={sla === 'breached' && isOpenStatus(r.status) ? 'warning' : undefined}>
                        <Td nowrap className="text-gray-400">{when(r.created_at)}</Td>
                        <Td className="text-gray-200">{r.reporter_name || 'Unknown'}{r.org_name ? <span className="block text-[10px] text-gray-500">{r.org_name}</span> : null}</Td>
                        <Td className="text-gray-300 max-w-[320px]"><span className="line-clamp-2 break-words">{r.description}</span></Td>
                        <Td nowrap>{categoryLabel(r.category)}</Td>
                        <Td><Badge tone={SEVERITY_TONE[r.severity]}>{severityLabel(r.severity)}</Badge></Td>
                        <Td><Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge></Td>
                        <Td className="text-gray-400">{r.assignee_name || 'Nobody yet'}</Td>
                        <Td className="text-gray-500">{platformLabel(r.platform)}{r.app_version ? ` ${r.app_version}` : ''}<span className="block text-[10px]">{r.page_or_screen || 'N/A'}</span></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <div className="mt-3"><Pager paged={paged} label="reports" /></div>
            </>
          )}
      </Panel>

      <IssueDrawer issue={current} owners={owners} ownerName={ownerName}
        onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function IssueDrawer({ issue, owners, ownerName, onClose, onChanged }) {
  const [events, setEvents] = useState([])
  const [logs, setLogs] = useState([])
  const [detailError, setDetailError] = useState('')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [nextStatus, setNextStatus] = useState('')
  const [version, setVersion] = useState('')
  const [note, setNote] = useState('')
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const id = issue?.id
  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoadingDetail(true); setDetailError('')
    try {
      const [ev, lg] = await Promise.all([listIssueEvents(id), getIssueLogs(id)])
      setEvents(ev); setLogs(lg)
    } catch (e) {
      setDetailError(e?.message || 'Details could not be loaded.')
    } finally {
      setLoadingDetail(false)
    }
  }, [id])

  useEffect(() => {
    setEvents([]); setLogs([]); setActionError(''); setNotice(''); setNote('')
    setNextStatus(issue?.status || ''); setVersion(issue?.fixed_in_version || ''); setOwner(issue?.assignee_id || '')
    if (id) loadDetail()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(kind, fn, done) {
    setBusy(kind); setActionError(''); setNotice('')
    try {
      const res = await fn()
      setNotice(done(res))
      await Promise.all([onChanged?.(), loadDetail()])
    } catch (e) {
      setActionError(e?.message || 'That did not work. Please try again.')
    } finally {
      setBusy('')
    }
  }

  if (!issue) return null
  const ownerOptions = owners
    .filter((p) => p.is_super_admin || (p.org_id || p.organisation_id) === issue.organisation_id)
    .map((p) => ({ value: p.id, label: p.name }))
  const statusChanged = nextStatus && nextStatus !== issue.status
  const needsVersion = nextStatus === 'fixed' && !version.trim()

  return (
    <Drawer open onClose={onClose} width="max-w-2xl"
      title={`Report from ${issue.reporter_name || 'unknown person'}`}
      subtitle={`${when(issue.created_at)} | ${platformLabel(issue.platform)}${issue.app_version ? ` ${issue.app_version}` : ''}`}>
      <div className="space-y-2">
        <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{issue.description}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONE[issue.status]}>{statusLabel(issue.status)}</Badge>
          <Badge tone={SEVERITY_TONE[issue.severity]}>{severityLabel(issue.severity)}</Badge>
          <Badge>{categoryLabel(issue.category)}</Badge>
          {slaState(issue) === 'breached' && <Badge tone="warning">Past target time</Badge>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {[
          ['Company', issue.org_name || 'N/A'], ['Country', issue.country || 'N/A'], ['Site', issue.site || 'N/A'],
          ['Page or screen', issue.page_or_screen || 'N/A'], ['Browser or device', issue.device || 'N/A'],
          ['System', issue.os || 'N/A'], ['Reference', issue.reference_id || 'None'],
          ['Target time', when(issue.sla_due_at)], ['First response', when(issue.first_response_at)],
          ['Resolved', when(issue.resolved_at)], ['Fixed in version', issue.fixed_in_version || 'N/A'],
          ['Owner', issue.assignee_name || 'Nobody yet'],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-gray-500">{k}</dt><dd className="text-gray-300 break-words">{v}</dd></div>
        ))}
      </dl>

      <ErrorState message={detailError} onRetry={loadDetail} />

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">Owner</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Select ariaLabel="Owner" value={owner} onChange={setOwner} placeholder="Nobody" options={ownerOptions} className="min-w-[200px]" />
          <Btn icon={UserPlus} busy={busy === 'assign'} disabled={busy !== '' || (owner || null) === (issue.assignee_id || null)}
            onClick={() => run('assign', () => assignIssue(issue.id, owner || null),
              () => (owner ? 'Owner saved.' : 'Owner removed.'))}>
            Save owner
          </Btn>
        </div>
        <p className="text-[11px] text-gray-500">Setting an owner on a new report also marks it as reviewed. The reporter is not told.</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">Status</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <Select ariaLabel="New status" value={nextStatus} onChange={setNextStatus}
            options={ISSUE_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
          <label className="block">
            <span className="sr-only">Fixed in version</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40}
              placeholder={nextStatus === 'fixed' ? 'Fixed in version, for example 2.1.1' : 'Fixed in version (optional)'}
              className={INPUT} aria-label="Fixed in version" />
          </label>
        </div>
        {nextStatus && <Note icon={Info} tone={nextStatus === 'fixed' ? 'accent' : 'default'}>{STATUS_IMPACT[nextStatus]}</Note>}
        {needsVersion && <p className="text-[11px] text-amber-300">Enter the app version that has the fix before marking it fixed.</p>}
        <Btn variant="primary" busy={busy === 'status'}
          disabled={busy !== '' || needsVersion || (!statusChanged && version.trim() === (issue.fixed_in_version || ''))}
          onClick={() => run('status', () => setIssueStatus(issue.id, nextStatus, { fixedInVersion: version.trim() || null, note: note.trim() || null }),
            (res) => (res?.notified ? 'Status saved. The reporter was told it is fixed.' : 'Status saved.'))}>
          Save status
        </Btn>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">Add a note</h4>
        <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
          placeholder="For example: reproduced on the inspection form, fix planned for 2.1.1."
          className={`${INPUT} resize-y`} />
        <p className="text-[11px] text-gray-500">Notes are for administrators. The reporter does not see them.</p>
        <Btn icon={Send} busy={busy === 'comment'} disabled={busy !== '' || !note.trim()}
          onClick={() => run('comment', async () => { const r = await commentIssue(issue.id, note); setNote(''); return r }, () => 'Note saved.')}>
          Save note
        </Btn>
      </section>

      {actionError && <p role="alert" className="text-xs text-red-300">{actionError}</p>}
      {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">Errors recorded around the report ({loadingDetail ? '...' : logs.length})</h4>
        {loadingDetail ? <LoadingState label="Loading linked errors" rows={2} />
          : logs.length === 0 ? <p className="text-[11px] text-gray-500">No error was recorded for this person in the 30 minutes before the report.</p>
          : (
            <ul className="space-y-1.5">
              {logs.map((l) => (
                <li key={l.id} className="text-[11px] text-gray-400 border border-gray-800 rounded-lg p-2">
                  <span className="text-gray-500">{when(l.created_at)} | {l.severity} | {l.source || 'app'}</span>
                  <span className="block text-gray-300 break-words">{l.message}</span>
                  <span className="block text-gray-500">{l.screen || l.url || 'N/A'}{l.reference_id ? ` | ${l.reference_id}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300">History</h4>
        {loadingDetail ? <LoadingState label="Loading history" rows={2} />
          : events.length === 0 ? <p className="text-[11px] text-gray-500">No history could be read.</p>
          : (
            <ul className="space-y-1.5">
              {events.map((ev) => (
                <li key={ev.id} className="text-[11px] text-gray-400">
                  <span className="text-gray-500">{when(ev.created_at)}</span>{' '}
                  <span className="text-gray-200">{ev.actor_name || 'Someone'}</span>{' '}
                  {describeEvent(ev, ownerName)}
                  {ev.note && <span className="block text-gray-300 break-words mt-0.5">{ev.note}</span>}
                </li>
              ))}
            </ul>
          )}
      </section>
    </Drawer>
  )
}
