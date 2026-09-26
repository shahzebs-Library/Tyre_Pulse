/**
 * ConsoleSecurityAudit.jsx - the Security Audit Center.
 *
 * Live security posture of the whole platform, read from the database catalog
 * every time (admin_security_posture), so what this page says is what the
 * database is. A weekly scan records history and alerts every super admin to a
 * NEW finding; "Run scan now" does the same on demand.
 *
 * Also shows the break-glass trail: every super-admin console sign-in and every
 * high-risk console action, which the database alerts on automatically.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, ShieldAlert, Play, CheckCircle2, AlertTriangle, XCircle,
  Info, Hand, LogIn, History, FileSpreadsheet, FileText, ArrowUpRight, Clock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { TrendChart, BarsChart, ScoreRing, STATUS, useChartTheme } from '../components/ui/charts'
import {
  getSecurityPosture, runSecurityScan, listSecurityScans, listBreakGlassEvents,
} from '../../lib/api/securityAudit'
import {
  postureSummary, scanTrend, SEVERITIES, SEVERITY_LABEL, STATUS_LABEL,
} from '../../lib/securityAudit'
import { toUserMessage } from '../../lib/safeError'
import { exportConsoleRows, sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import {
  PageHeader, useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, AttentionList,
} from './accessKit'
import ExportButtons from './shared/ExportButtons'

const TABS = ['findings', 'posture', 'activity']

const STATUS_TONE = { pass: 'good', fail: 'danger', warn: 'warning', info: 'quiet', manual: 'info' }
const STATUS_ICON = { pass: CheckCircle2, fail: XCircle, warn: AlertTriangle, info: Info, manual: Hand }
const SEV_TONE = { critical: 'danger', high: 'warning', medium: 'accent', low: 'quiet' }
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
const STATUS_RANK = { fail: 5, warn: 4, manual: 3, info: 2, pass: 1 }
const CHECK_SORT = {
  severity: (c) => SEV_RANK[c.severity] ?? 0,
  status: (c) => STATUS_RANK[c.status] ?? 0,
}

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ConsoleSecurityAudit() {
  const theme = useChartTheme()
  const [state, setState] = useState({ loading: true, error: null, posture: null, runs: [], events: [], runsError: null, eventsError: null })
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState(null)
  const [filter, setFilter] = useState('attention')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [eventSearch, setEventSearch] = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'findings')
  const { refreshedAt, stamp } = useRefreshStamp()
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const { sort, onSort } = useTableSort({ key: 'severity', dir: 'desc' })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      // The two side panels degrade on their own, but a failed read is said
      // out loud: rendering it as "no scans yet" would read as a fact.
      let runsError = null
      let eventsError = null
      const [posture, runs, events] = await Promise.all([
        getSecurityPosture(),
        listSecurityScans(26).catch((e) => { runsError = toUserMessage(e, 'Could not load the scan history.'); return [] }),
        listBreakGlassEvents(40).catch((e) => { eventsError = toUserMessage(e, 'Could not load the break-glass trail.'); return [] }),
      ])
      setState({ loading: false, error: null, posture, runs, events, runsError, eventsError })
      stamp()
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: toUserMessage(err, 'Could not load the security audit.') }))
    }
  }, [stamp])

  useEffect(() => { load() }, [load])

  const runScan = async () => {
    setScanning(true)
    setNotice(null)
    try {
      const res = await runSecurityScan()
      const fresh = res?.newFindings || []
      setNotice(fresh.length
        ? { tone: 'warning', text: `Scan recorded. New findings: ${fresh.join(', ')}. Every super admin has been notified.` }
        : { tone: 'accent', text: 'Scan recorded. No new findings since the last scan.' })
      await load()
    } catch (err) {
      setNotice({ tone: 'danger', text: toUserMessage(err, 'The scan could not run.') })
    } finally {
      setScanning(false)
    }
  }

  const { posture, runs, events } = state
  const summary = useMemo(() => postureSummary(posture), [posture])
  const trend = useMemo(() => scanTrend(runs), [runs])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (posture?.checks || []).filter((c) => {
      if (filter === 'attention' && !(c.status === 'fail' || c.status === 'warn' || c.status === 'manual')) return false
      if (filter === 'pass' && c.status !== 'pass') return false
      if (!q) return true
      return [c.title, c.category, c.explain, ...c.items.map(String)].join(' ').toLowerCase().includes(q)
    })
  }, [posture, filter, search])
  const sortedChecks = useMemo(() => sortRows(visible, sort, CHECK_SORT), [visible, sort])

  const severityBars = SEVERITIES.map((s) => ({
    label: SEVERITY_LABEL[s],
    value: summary.bySeverity[s] || 0,
    color: STATUS[theme][s],
  }))

  // Exports every check (not just the filtered view): an audit file that
  // silently omitted the passing checks would read as a partial audit.
  const exportChecks = async (format) => {
    setExporting(format); setExportError('')
    try {
      await exportConsoleRows({
        rows: sortRows(posture?.checks || [], sort, CHECK_SORT),
        title: 'Security Audit',
        format,
        columns: [
          { key: 'title', header: 'Check' },
          { key: 'category', header: 'Category' },
          { key: 'severity', header: 'Severity', value: (c) => SEVERITY_LABEL[c.severity] },
          { key: 'status', header: 'Status', value: (c) => STATUS_LABEL[c.status] || c.status },
          { key: 'count', header: 'Count', value: (c) => (c.count === null ? 'N/A' : c.count) },
          { key: 'affected', header: 'Affected', value: (c) => c.items.join(', ') },
          { key: 'fix', header: 'How to fix' },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const pagedChecks = usePaged(sortedChecks, 20, `${filter}|${search}|${sort?.key}|${sort?.dir}`)
  const openCheck = openId ? (posture?.checks || []).find((c) => c.id === openId) : null
  const visibleEvents = useMemo(() => searchRows(events, eventSearch, ['message', 'severity']), [events, eventSearch])
  const pagedEvents = usePaged(visibleEvents, 15, eventSearch)

  // The top of the findings tab: the worst open checks, one action each.
  const attention = useMemo(() => {
    const open = (posture?.checks || []).filter((c) => c.status === 'fail' || c.status === 'warn')
    return sortRows(open, { key: 'severity', dir: 'desc' }, CHECK_SORT).slice(0, 3).map((c) => ({
      key: c.id,
      tone: c.severity === 'critical' ? 'danger' : 'warning',
      title: `${SEVERITY_LABEL[c.severity]}: ${c.title}`,
      detail: c.count ? `${c.count} affected. ${c.fix || ''}` : c.fix,
      action: { label: 'Open', onClick: () => setOpenId(c.id) },
    }))
  }, [posture])

  const latestRun = runs && runs.length ? [...runs].sort((x, y) => new Date(y.ran_at) - new Date(x.ran_at))[0] : null

  if (state.loading && !posture) return <div><LoadingState label="Running security checks" rows={6} /></div>
  if (state.error && !posture) {
    return (
      <div className="space-y-5 max-w-7xl">
        <h1><ShieldCheck size={18} className="text-orange-400" /> Security Audit</h1>
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }

  const act = posture?.activity || {}
  const critHigh = (summary.bySeverity.critical || 0) + (summary.bySeverity.high || 0)
  const goFilter = (f) => { setFilter(f); setTab('findings') }

  const ACTIVITY = [
    { label: 'Console sign-ins (7d)', value: act.console_logins_7d, icon: LogIn, to: '/console/sessions', link: 'Sessions' },
    { label: 'Access changes (7d)', value: act.access_changes_7d, icon: History, to: '/console/access?tab=audit', link: 'Access audit' },
    { label: 'Super admin changes (30d)', value: act.super_admin_changes_30d, warnIf: true, to: '/console/audit-trail', link: 'Audit trail' },
    { label: 'Errors (7d)', value: act.errors_7d, warnIf: true, to: '/console/health', link: 'System health' },
    { label: 'Locked accounts', value: act.locked_accounts, to: '/console/users', link: 'Users' },
    { label: 'Pending approvals', value: act.pending_approvals, accentIf: true, to: '/console/users', link: 'Users' },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={ShieldCheck} title="Security Audit"
        purpose={`Live checks against the database, last read ${fmtWhen(posture?.generatedAt)}. A scan runs every Sunday and alerts you to anything new.`}
        primary={<Btn variant="primary" icon={Play} onClick={runScan} busy={scanning}>Run scan now</Btn>}
        actions={(
          <>
            <Btn icon={FileSpreadsheet} onClick={() => exportChecks('excel')} busy={exporting === 'excel'} disabled={!posture}>Excel</Btn>
            <Btn icon={FileText} onClick={() => exportChecks('pdf')} busy={exporting === 'pdf'} disabled={!posture}>PDF</Btn>
          </>
        )}
        refreshedAt={refreshedAt} onRefresh={load} refreshing={state.loading} />

      {exportError && <ErrorState message={exportError} />}
      {state.error && posture && <ErrorState message={`${state.error} Showing the last successful read.`} onRetry={load} />}
      {notice && <Note tone={notice.tone} icon={notice.tone === 'danger' ? ShieldAlert : Info}>{notice.text}</Note>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Security score" value={posture?.score ?? 'N/A'} icon={ShieldCheck}
          tone={posture?.score == null ? 'default' : posture.score >= 90 ? 'good' : posture.score >= 70 ? 'warning' : 'danger'}
          onClick={() => setTab('posture')} active={tab === 'posture'} sub="Out of 100" />
        <StatTile label="Open findings" value={summary.open} icon={ShieldAlert} tone={summary.open ? 'warning' : 'good'}
          onClick={() => goFilter('attention')} active={tab === 'findings' && filter === 'attention'} sub={`of ${summary.total} checks`} />
        <StatTile label="Critical or high" value={critHigh} icon={XCircle} tone={critHigh ? 'danger' : 'default'}
          onClick={() => goFilter('attention')} sub="Fix these first" />
        <StatTile label="Needs a person" value={summary.manual} icon={Hand} tone={summary.manual ? 'accent' : 'default'}
          onClick={() => goFilter('attention')} sub="Manual checks" />
        <StatTile label="Passing" value={summary.passing} icon={CheckCircle2} tone="good"
          onClick={() => goFilter('pass')} active={tab === 'findings' && filter === 'pass'} />
        <StatTile label="Last scan" value={latestRun ? new Date(latestRun.ran_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : (state.runsError ? 'N/A' : 'None')}
          icon={Clock} sub={state.runsError ? 'History could not be read' : latestRun ? `Score ${latestRun.score ?? 'N/A'}` : 'Press Run scan now'} />
      </div>

      <Segmented ariaLabel="Security audit views" value={tab} onChange={setTab} options={[
        { key: 'findings', label: 'Findings', count: summary.open + summary.manual },
        { key: 'posture', label: 'Posture and trend' },
        { key: 'activity', label: 'Activity and break-glass', count: state.eventsError ? null : events.length },
      ]} />

      {tab === 'findings' && (
        <div role="tabpanel" aria-label="Findings" className="space-y-4">
          <AttentionList ready={!!posture} items={attention} clearText="No check is failing or warning." />
          <Panel flush>
            <div className="p-4 pb-3">
              <PanelHeader icon={ShieldCheck} title="Checks" subtitle="Select a row to see why it matters, what is affected and how to fix it."
                actions={
                  <Toolbar>
                    <Segmented ariaLabel="Filter checks" value={filter} onChange={setFilter} options={[
                      { key: 'attention', label: `Needs attention (${summary.open + summary.manual})` },
                      { key: 'pass', label: `Passing (${summary.passing})` },
                      { key: 'all', label: `All (${summary.total})` },
                    ]} />
                    <SearchInput value={search} onChange={setSearch} placeholder="Search checks or items" />
                  </Toolbar>
                } />
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={CheckCircle2}
                title={filter === 'attention' ? 'Nothing needs attention' : 'No checks match'}
                reason={filter === 'attention' ? 'Every check is passing.' : 'Try a different filter or search.'} />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead>
                    <Th sortKey="title" sort={sort} onSort={onSort}>Check</Th>
                    <Th sortKey="category" sort={sort} onSort={onSort}>Category</Th>
                    <Th sortKey="severity" sort={sort} onSort={onSort}>Severity</Th>
                    <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                    <Th align="right" sortKey="count" sort={sort} onSort={onSort}>Count</Th>
                  </THead>
                  <tbody>
                    {pagedChecks.pageRows.map((c) => {
                      const Icon = STATUS_ICON[c.status] || Info
                      return (
                        <Tr key={c.id} onClick={() => setOpenId(c.id)} ariaLabel={`Open check ${c.title}`}>
                          <Td><span className="text-gray-200">{c.title}</span></Td>
                          <Td><span className="text-gray-400">{c.category}</span></Td>
                          <Td><Badge tone={SEV_TONE[c.severity]}>{SEVERITY_LABEL[c.severity]}</Badge></Td>
                          <Td><Badge tone={STATUS_TONE[c.status]} icon={Icon}>{STATUS_LABEL[c.status] || c.status}</Badge></Td>
                          <Td align="right" nowrap><span className="tabular-nums text-gray-300">{c.count === null ? 'N/A' : c.count}</span></Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager {...pagedChecks} onPage={pagedChecks.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === 'posture' && (
        <div role="tabpanel" aria-label="Posture and trend" className="grid gap-4 lg:grid-cols-3">
          <Panel className="flex items-center">
            <ScoreRing score={posture?.score} label="Security score" />
          </Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader icon={ShieldAlert} title="Open findings by severity"
              subtitle={`${summary.open} open of ${summary.total} checks. ${summary.passing} passing.`} />
            <BarsChart bars={severityBars} height={150}
              summary={severityBars.map((b) => `${b.label} ${b.value}`).join(', ')}
              emptyText="No open findings. Every check is passing." />
          </Panel>
          <Panel className="lg:col-span-3">
            <PanelHeader icon={History} title="Score over time" subtitle="One point per recorded scan, weekly and on demand." />
            {state.runsError ? <ErrorState message={state.runsError} onRetry={load} /> : (
              <TrendChart labels={trend.labels} series={[{ label: 'Security score', values: trend.scores }]}
                yMax={100} height={200}
                summary={trend.scores.length ? `Latest score ${trend.scores[trend.scores.length - 1]}` : 'No scans yet'}
                emptyText="No scans recorded yet. Press Run scan now." />
            )}
          </Panel>
        </div>
      )}

      {tab === 'activity' && (
        <div role="tabpanel" aria-label="Activity and break-glass" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {ACTIVITY.map((a) => {
              const n = Number(a.value)
              const tone = a.value == null ? 'default' : a.warnIf && n > 0 ? 'warning' : a.accentIf && n > 0 ? 'accent' : 'default'
              return (
                <div key={a.label} className="space-y-1">
                  <StatTile label={a.label} value={a.value ?? 'N/A'} icon={a.icon} tone={tone} />
                  <Link to={a.to} className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-orange-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                    {a.link} <ArrowUpRight size={10} aria-hidden="true" />
                  </Link>
                </div>
              )
            })}
          </div>
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={LogIn} title="Break-glass trail"
                subtitle="Super-admin sign-ins and high-risk actions. Each one notifies every super admin."
                actions={!state.eventsError && (
                  <ExportButtons rows={visibleEvents} title="Break-glass trail" columns={[
                    { key: 'created_at', header: 'When', value: (e) => fmtWhen(e.created_at) },
                    { key: 'severity', header: 'Type', value: (e) => (e.severity === 'critical' ? 'Critical' : e.severity === 'warning' ? 'High risk' : 'Sign-in') },
                    { key: 'message', header: 'Event' },
                  ]} />
                )} />
              {!state.eventsError && events.length > 0 && (
                <SearchInput value={eventSearch} onChange={setEventSearch} placeholder="Search events" className="max-w-xs" />
              )}
            </div>
            {state.eventsError ? (
              <div className="px-4 pb-4"><ErrorState message={state.eventsError} onRetry={load} /></div>
            ) : events.length === 0 ? (
              <div className="px-4 pb-4"><EmptyState title="No events yet" reason="Sign-ins and risky actions appear here as they happen." /></div>
            ) : visibleEvents.length === 0 ? (
              <EmptyState title="No events match" reason="Nothing in the recent trail matches the search." />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead><Th>When</Th><Th>Event</Th></THead>
                  <tbody>
                    {pagedEvents.pageRows.map((e) => (
                      <Tr key={e.id}>
                        <Td nowrap><span className="text-gray-400 tabular-nums">{fmtWhen(e.created_at)}</span></Td>
                        <Td>
                          <span className="inline-flex items-center gap-2">
                            <Badge tone={e.severity === 'critical' ? 'danger' : e.severity === 'warning' ? 'warning' : 'quiet'}>
                              {e.severity === 'critical' ? 'Critical' : e.severity === 'warning' ? 'High risk' : 'Sign-in'}
                            </Badge>
                            <span className="text-gray-300">{e.message}</span>
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager {...pagedEvents} onPage={pagedEvents.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      <Drawer open={!!openCheck} title={openCheck?.title} subtitle={openCheck ? `${openCheck.category} check` : undefined}
        onClose={() => setOpenId(null)}>
        {openCheck && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={SEV_TONE[openCheck.severity]}>{SEVERITY_LABEL[openCheck.severity]}</Badge>
              <Badge tone={STATUS_TONE[openCheck.status]} icon={STATUS_ICON[openCheck.status] || Info}>{STATUS_LABEL[openCheck.status] || openCheck.status}</Badge>
              <Badge tone="quiet">Count {openCheck.count === null ? 'N/A' : openCheck.count}</Badge>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">Why it matters</p>
              <p className="text-xs text-gray-300 leading-relaxed">{openCheck.explain}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">How to fix</p>
              <p className="text-xs text-gray-300 leading-relaxed">{openCheck.fix}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">Affected ({openCheck.items.length})</p>
              {openCheck.items.length === 0 ? (
                <p className="text-xs text-gray-500">Nothing is listed for this check.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {openCheck.items.map((it) => (
                    <span key={String(it)} className="px-1.5 py-0.5 rounded bg-gray-800/80 font-mono text-[11px] text-gray-300">{String(it)}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
