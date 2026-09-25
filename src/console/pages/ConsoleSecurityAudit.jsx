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
import {
  ShieldCheck, ShieldAlert, Play, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Info, Hand, ChevronDown, ChevronRight, LogIn, History, Download,
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
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

const STATUS_TONE = { pass: 'good', fail: 'danger', warn: 'warning', info: 'quiet', manual: 'info' }
const STATUS_ICON = { pass: CheckCircle2, fail: XCircle, warn: AlertTriangle, info: Info, manual: Hand }
const SEV_TONE = { critical: 'danger', high: 'warning', medium: 'accent', low: 'quiet' }

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CheckRow({ check, open, onToggle }) {
  const Icon = STATUS_ICON[check.status] || Info
  return (
    <>
      <Tr onClick={onToggle}>
        <Td>
          <span className="inline-flex items-center gap-2">
            {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
            <span className="text-gray-200">{check.title}</span>
          </span>
        </Td>
        <Td><span className="text-gray-400">{check.category}</span></Td>
        <Td><Badge tone={SEV_TONE[check.severity]}>{SEVERITY_LABEL[check.severity]}</Badge></Td>
        <Td><Badge tone={STATUS_TONE[check.status]} icon={Icon}>{STATUS_LABEL[check.status] || check.status}</Badge></Td>
        <Td align="right" nowrap><span className="tabular-nums text-gray-300">{check.count === null ? 'N/A' : check.count}</span></Td>
      </Tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-4 pb-4 pt-1 bg-gray-900/30">
            <div className="grid gap-3 md:grid-cols-2 text-xs">
              <div>
                <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-1">Why it matters</p>
                <p className="text-gray-300 leading-relaxed">{check.explain}</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-1">How to fix</p>
                <p className="text-gray-300 leading-relaxed">{check.fix}</p>
              </div>
            </div>
            {check.items.length > 0 && (
              <div className="mt-3">
                <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-1">Affected ({check.items.length})</p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                  {check.items.map((it) => (
                    <span key={String(it)} className="px-1.5 py-0.5 rounded bg-gray-800/80 font-mono text-[11px] text-gray-300">{String(it)}</span>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function ConsoleSecurityAudit() {
  const theme = useChartTheme()
  const [state, setState] = useState({ loading: true, error: null, posture: null, runs: [], events: [], runsError: null, eventsError: null })
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState(null)
  const [filter, setFilter] = useState('attention')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)

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
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: toUserMessage(err, 'Could not load the security audit.') }))
    }
  }, [])

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

  const severityBars = SEVERITIES.map((s) => ({
    label: SEVERITY_LABEL[s],
    value: summary.bySeverity[s] || 0,
    color: STATUS[theme][s],
  }))

  const exportChecks = () => {
    const rows = (posture?.checks || []).map((c) => ({
      title: c.title, category: c.category, severity: SEVERITY_LABEL[c.severity],
      status: STATUS_LABEL[c.status] || c.status, count: c.count === null ? 'N/A' : c.count,
      affected: c.items.join(', '), fix: c.fix,
    }))
    exportToExcel(rows, ['title', 'category', 'severity', 'status', 'count', 'affected', 'fix'],
      ['Check', 'Category', 'Severity', 'Status', 'Count', 'Affected', 'How to fix'],
      reportFileName('Security Audit', new Date().toISOString().slice(0, 10)))
  }

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

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <ShieldCheck size={18} className="text-orange-400" /> Security Audit
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Live checks against the database, last read {fmtWhen(posture?.generatedAt)}. A scan runs every Sunday and alerts you to anything new.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={Download} onClick={exportChecks} disabled={!posture}>Export</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
          <Btn variant="primary" icon={Play} onClick={runScan} busy={scanning}>Run scan now</Btn>
        </div>
      </header>

      {notice && <Note tone={notice.tone} icon={notice.tone === 'danger' ? ShieldAlert : Info}>{notice.text}</Note>}

      <div className="grid gap-4 lg:grid-cols-3">
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
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Console sign-ins (7d)" value={act.console_logins_7d ?? 'N/A'} icon={LogIn} />
        <StatTile label="Access changes (7d)" value={act.access_changes_7d ?? 'N/A'} icon={History} />
        <StatTile label="Super admin changes (30d)" value={act.super_admin_changes_30d ?? 'N/A'}
          tone={Number(act.super_admin_changes_30d) > 0 ? 'warning' : 'default'} />
        <StatTile label="Errors (7d)" value={act.errors_7d ?? 'N/A'} tone={Number(act.errors_7d) > 0 ? 'warning' : 'default'} />
        <StatTile label="Locked accounts" value={act.locked_accounts ?? 'N/A'} />
        <StatTile label="Pending approvals" value={act.pending_approvals ?? 'N/A'}
          tone={Number(act.pending_approvals) > 0 ? 'accent' : 'default'} />
      </div>

      <Panel>
        <PanelHeader icon={ShieldCheck} title="Checks" subtitle="Click a row to see why it matters, what is affected and how to fix it."
          actions={
            <Toolbar>
              <Segmented value={filter} onChange={setFilter} options={[
                { key: 'attention', label: `Needs attention (${summary.open + summary.manual})` },
                { key: 'pass', label: `Passing (${summary.passing})` },
                { key: 'all', label: `All (${summary.total})` },
              ]} />
              <SearchInput value={search} onChange={setSearch} placeholder="Search checks or items" />
            </Toolbar>
          } />
        {visible.length === 0 ? (
          <EmptyState icon={CheckCircle2}
            title={filter === 'attention' ? 'Nothing needs attention' : 'No checks match'}
            reason={filter === 'attention' ? 'Every check is passing.' : 'Try a different filter or search.'} />
        ) : (
          <Table>
            <THead>
              <Th>Check</Th><Th>Category</Th><Th>Severity</Th><Th>Status</Th><Th align="right">Count</Th>
            </THead>
            <tbody>
              {visible.map((c) => (
                <CheckRow key={c.id} check={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={History} title="Score over time" subtitle="One point per recorded scan, weekly and on demand." />
          {state.runsError ? <ErrorState message={state.runsError} onRetry={load} /> : (
          <TrendChart labels={trend.labels} series={[{ label: 'Security score', values: trend.scores }]}
            yMax={100} height={200}
            summary={trend.scores.length ? `Latest score ${trend.scores[trend.scores.length - 1]}` : 'No scans yet'}
            emptyText="No scans recorded yet. Press Run scan now." />
          )}
        </Panel>
        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={LogIn} title="Break-glass trail"
              subtitle="Super-admin sign-ins and high-risk actions. Each one notifies every super admin." />
          </div>
          {state.eventsError ? (
            <div className="px-4 pb-4"><ErrorState message={state.eventsError} onRetry={load} /></div>
          ) : events.length === 0 ? (
            <div className="px-4 pb-4"><EmptyState title="No events yet" reason="Sign-ins and risky actions appear here as they happen." /></div>
          ) : (
            <div className="max-h-64 overflow-auto">
              <Table>
                <THead><Th>When</Th><Th>Event</Th></THead>
                <tbody>
                  {events.map((e) => (
                    <Tr key={e.id}>
                      <Td nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(e.created_at)}</span></Td>
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
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
