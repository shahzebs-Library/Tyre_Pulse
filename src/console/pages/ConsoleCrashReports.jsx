/**
 * ConsoleCrashReports - super-admin Crash & Error Reports (Sentry) console page.
 *
 * Pure console page (useConsoleAuth gate). Surfaces the live Sentry issue stream
 * (mobile crashes + web errors) INSIDE /console with triage: summary tiles,
 * issues-by-level and top-issues charts, search + project + period filters, a
 * full issue-detail dialog (stack trace + device/OS/release/user tags), and
 * Resolve / Ignore / Reopen / Assign / Comment.
 *
 * The Sentry auth token is entered once in Connection and stored SERVER-SIDE only
 * (deny-all cron_config via a super-admin RPC); it is never returned to the client.
 * Every Sentry call goes through the `sentry-issues` edge proxy which self-gates to
 * super-admin and reads the token via the service role.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bug, RefreshCw, Settings, ExternalLink, Users, Activity,
  ShieldAlert, CheckCircle2, Save, Info, Check, EyeOff, RotateCcw,
  Smartphone, Cpu, UserPlus, MessageSquare, Send, Clock, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  getSentryStatus, saveSentryConfig, listSentryIssues,
  getSentryProjects, getSentryIssueDetail, updateSentryIssue,
  getSentryMembers, assignSentryIssue, commentSentryIssue,
} from '../../lib/api/sentryCrashes'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code, Segmented, SearchInput, Select, Toolbar,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { BarsChart, STATUS, useChartTheme } from '../components/ui/charts'

const PERIODS = [
  { key: '24h', label: 'Last 24h' }, { key: '7d', label: 'Last 7 days' },
  { key: '14d', label: 'Last 14 days' }, { key: '30d', label: 'Last 30 days' }, { key: '90d', label: 'Last 90 days' },
]
const PRESETS = [
  { key: 'is:unresolved', label: 'Unresolved' },
  { key: 'is:unresolved level:fatal', label: 'Fatal' },
  { key: 'is:unresolved level:error', label: 'Errors' },
  { key: 'is:ignored', label: 'Ignored' },
  { key: '', label: 'All' },
]
// Sentry level -> badge tone + chart status colour + order in the level chart.
const LEVELS = [
  { key: 'fatal', label: 'Fatal', tone: 'danger', color: 'critical' },
  { key: 'error', label: 'Error', tone: 'accent', color: 'high' },
  { key: 'warning', label: 'Warning', tone: 'warning', color: 'medium' },
  { key: 'info', label: 'Info', tone: 'info', color: 'low' },
  { key: 'debug', label: 'Debug', tone: 'quiet', color: 'low' },
]
const LEVEL_BY_KEY = Object.fromEntries(LEVELS.map((l) => [l.key, l]))
const levelMeta = (lvl) => LEVEL_BY_KEY[lvl] || LEVEL_BY_KEY.error
const STATUS_TONE = { resolved: 'good', ignored: 'quiet', unresolved: 'default' }
/** The edge proxy asks Sentry for one page of this many issues. */
const ISSUE_PAGE = 50
// Tags worth surfacing prominently in the detail dialog.
const KEY_TAGS = ['release', 'environment', 'os', 'os.name', 'device', 'device.family', 'device.class', 'level', 'handled', 'mechanism', 'transaction']

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'
const nf = new Intl.NumberFormat('en-US')

function timeAgo(iso) {
  if (!iso) return 'N/A'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'N/A'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function shorten(text, n = 48) {
  const s = String(text || '')
  return s.length > n ? `${s.slice(0, n - 3)}...` : s
}

export default function ConsoleCrashReports() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()

  const [status, setStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [showSetup, setShowSetup] = useState(false)

  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [period, setPeriod] = useState('14d')
  const [queryText, setQueryText] = useState('is:unresolved')
  const [activeQuery, setActiveQuery] = useState('is:unresolved')

  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [members, setMembers] = useState([])

  const [detail, setDetail] = useState(null)      // { issue, event, activity }
  const [detailFor, setDetailFor] = useState(null) // issue being viewed
  const [detailLoading, setDetailLoading] = useState(false)
  const [acting, setActing] = useState('')
  const [commentText, setCommentText] = useState('')
  const [commenting, setCommenting] = useState(false)
  const detailReqRef = useRef(null)   // guards against out-of-order detail loads

  // setup form
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('shah-profile')
  const [regionUrl, setRegionUrl] = useState('https://de.sentry.io')
  const [project, setProject] = useState('')
  const [alertEmail, setAlertEmail] = useState('')
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const s = await getSentryStatus()
      setStatus(s); setOrg(s.org || 'shah-profile'); setRegionUrl(s.region_url || 'https://de.sentry.io'); setProject(s.project || '')
      setAlertEmail(s.alert_email || ''); setAlertsEnabled(s.alerts_enabled === true)
      if (!s.configured) setShowSetup(true)
    } catch (e) { setError(toUserMessage(e, 'Could not load Sentry settings.')) }
    finally { setStatusLoading(false) }
  }, [])

  const loadIssues = useCallback(async () => {
    setLoading(true); setError(''); setReason('')
    try {
      const res = await listSentryIssues({ query: activeQuery, period, project: projectId })
      if (res?.ok) setIssues(Array.isArray(res.issues) ? res.issues : [])
      else {
        setIssues([]); setReason(res?.reason || 'error')
        if (res?.reason === 'auth') setError('Sentry rejected the token. Update it in Connection.')
        else if (res?.reason !== 'not_configured') setError('Could not load crash reports. Try again.')
      }
    } catch (e) { setIssues([]); setReason('error'); setError(toUserMessage(e, 'Could not load crash reports.')) }
    finally { setLoading(false) }
  }, [activeQuery, period, projectId])

  const loadProjects = useCallback(async () => {
    try {
      const res = await getSentryProjects()
      if (res?.ok && Array.isArray(res.projects)) setProjects(res.projects)
    } catch { /* non-fatal */ }
  }, [])

  const loadMembers = useCallback(async () => {
    try {
      const res = await getSentryMembers()
      if (res?.ok && Array.isArray(res.members)) setMembers(res.members)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { if (status?.configured) { loadIssues(); loadProjects(); loadMembers() } }, [status?.configured, loadIssues, loadProjects, loadMembers])

  const summary = useMemo(() => {
    const fatal = issues.filter(i => i.level === 'fatal').length
    const errors = issues.filter(i => i.level === 'error').length
    const users = issues.reduce((n, i) => n + (i.userCount || 0), 0)
    const events = issues.reduce((n, i) => n + (i.count || 0), 0)
    return { total: issues.length, fatal, errors, users, events }
  }, [issues])

  const colors = STATUS[theme]
  // Issues per level, in severity order. Levels Sentry did not report stay out
  // of the chart rather than showing as a row of zero bars.
  const levelBars = useMemo(() => {
    const counts = new Map()
    for (const i of issues) counts.set(i.level || 'error', (counts.get(i.level || 'error') || 0) + 1)
    const known = LEVELS.filter((l) => counts.get(l.key)).map((l) => ({ label: l.label, value: counts.get(l.key), color: colors[l.color] }))
    const other = [...counts.entries()].filter(([k]) => !LEVEL_BY_KEY[k]).map(([k, v]) => ({ label: k, value: v, color: colors.low }))
    return [...known, ...other]
  }, [issues, colors])
  // The heaviest issues by event count: where the crashes actually come from.
  const topBars = useMemo(() => [...issues]
    .filter((i) => (i.count || 0) > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 8)
    .map((i) => ({ label: shorten(i.shortId ? `${i.shortId} ${i.title}` : i.title, 44), value: i.count || 0, color: colors[levelMeta(i.level).color] })),
  [issues, colors])

  const onSave = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      await saveSentryConfig({ token, org, regionUrl, project, alertEmail, alertsEnabled })
      setToken(''); setNotice('Sentry connection saved.'); setShowSetup(false)
      await loadStatus()
    } catch (e) { setError(toUserMessage(e, 'Could not save Sentry settings.')) }
    finally { setSaving(false) }
  }

  const openDetail = async (issue) => {
    detailReqRef.current = issue.id
    setDetailFor(issue); setDetail(null); setDetailLoading(true); setCommentText('')
    try {
      const res = await getSentryIssueDetail(issue.id)
      if (detailReqRef.current !== issue.id) return  // a newer issue was opened; ignore this stale response
      if (res?.ok) setDetail(res)
      else setDetail({ issue, event: null, error: res?.reason === 'auth' ? 'Token lacks event read scope.' : 'Could not load details.' })
    } catch (e) {
      if (detailReqRef.current === issue.id) setDetail({ issue, event: null, error: toUserMessage(e, 'Could not load details.') })
    } finally {
      if (detailReqRef.current === issue.id) setDetailLoading(false)
    }
  }

  const act = async (issue, status) => {
    setActing(issue.id); setError(''); setNotice('')
    try {
      const res = await updateSentryIssue(issue.id, status)
      if (res?.ok) {
        setNotice(`Issue ${status === 'unresolved' ? 'reopened' : status}.`)
        setIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status } : i)
          .filter(i => !(activeQuery.includes('is:unresolved') && i.id === issue.id && status !== 'unresolved')))
        if (detailFor?.id === issue.id) {
          setDetailFor(f => f ? { ...f, status } : f)   // keep the drawer's action buttons in sync
          setDetail(d => d ? { ...d, issue: { ...d.issue, status } } : d)
        }
      } else if (res?.reason === 'auth') setError('Sentry rejected the action - the token needs write (issue:write) scope.')
      else setError('Could not update the issue.')
    } catch (e) { setError(toUserMessage(e, 'Could not update the issue.')) }
    finally { setActing('') }
  }

  const assign = async (issue, userId) => {
    setActing(issue.id); setError(''); setNotice('')
    try {
      const assignee = userId ? `user:${userId}` : ''
      const res = await assignSentryIssue(issue.id, assignee)
      if (res?.ok) {
        const who = res.assignedTo || (userId ? { type: 'user', id: userId, name: (members.find(m => m.userId === userId)?.name) || 'user' } : null)
        setNotice(who ? `Assigned to ${who.name}.` : 'Unassigned.')
        setIssues(prev => prev.map(i => i.id === issue.id ? { ...i, assignedTo: who } : i))
        if (detailFor?.id === issue.id) { setDetailFor(f => ({ ...f, assignedTo: who })); setDetail(d => d ? { ...d, issue: { ...d.issue, assignedTo: who } } : d) }
      } else if (res?.reason === 'auth') setError('Sentry rejected the action - the token needs write (issue:write) scope.')
      else setError('Could not assign the issue.')
    } catch (e) { setError(toUserMessage(e, 'Could not assign the issue.')) }
    finally { setActing('') }
  }

  const submitComment = async () => {
    if (!detailFor || !commentText.trim()) return
    setCommenting(true); setError(''); setNotice('')
    try {
      const res = await commentSentryIssue(detailFor.id, commentText.trim())
      if (res?.ok) {
        setCommentText(''); setNotice('Comment added.')
        const d = await getSentryIssueDetail(detailFor.id)   // refresh the activity timeline
        if (d?.ok) setDetail(d)
      } else if (res?.reason === 'auth') setError('Sentry rejected the comment - the token needs write (issue:write) scope.')
      else setError('Could not add the comment.')
    } catch (e) { setError(toUserMessage(e, 'Could not add the comment.')) }
    finally { setCommenting(false) }
  }

  const submitSearch = (e) => { e?.preventDefault?.(); setActiveQuery(queryText.trim()) }
  const applyPreset = (q) => { setQueryText(q); setActiveQuery(q) }

  const closeDetail = () => { setDetailFor(null); setDetail(null) }

  if (!admin) return null

  const connected = status?.configured === true
  const setupOpen = showSetup || (!statusLoading && !connected)
  const memberOptions = [{ value: '', label: 'Unassigned' }, ...members.map(m => ({ value: m.userId, label: m.name }))]

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <Bug size={18} className="text-orange-400" /> Crash &amp; Error Reports
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Live Sentry issues from the mobile app and web, with triage.
            {connected && status?.org && <span> | connected to {status.org}</span>}
          </p>
        </div>
        <Toolbar>
          <Btn icon={Settings} onClick={() => setShowSetup(s => !s)}>Connection</Btn>
          <Btn variant="primary" icon={RefreshCw} onClick={loadIssues} busy={loading} disabled={!connected}>Refresh</Btn>
        </Toolbar>
      </header>

      {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}
      <ErrorState message={error} onRetry={connected ? loadIssues : loadStatus} />

      {statusLoading && !status && <Panel><LoadingState label="Checking the Sentry connection" rows={2} /></Panel>}

      {/* Connection / setup */}
      {setupOpen && (
        <Panel tone={connected ? undefined : 'accent'}>
          <PanelHeader
            icon={ShieldAlert}
            title="Sentry connection"
            subtitle="Stored on the server only. The token is never shown again."
            actions={connected && <Badge tone="good" icon={CheckCircle2}>Connected to {status.org}</Badge>}
          />
          <Note icon={Info}>
            Paste a Sentry Auth Token with read (and, for triage, <Code>issue:write</Code>) scope.
          </Note>
          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            <label className="text-xs text-gray-400 space-y-1">
              <span>Auth token {connected && <span className="text-emerald-400">(saved, leave blank to keep)</span>}</span>
              <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={connected ? '••••••••••••' : 'sntrys_...'} autoComplete="off"
                className={INPUT} />
            </label>
            <label className="text-xs text-gray-400 space-y-1"><span>Organisation slug</span>
              <input value={org} onChange={e => setOrg(e.target.value)} className={INPUT} /></label>
            <label className="text-xs text-gray-400 space-y-1"><span>Region URL</span>
              <input value={regionUrl} onChange={e => setRegionUrl(e.target.value)} placeholder="https://de.sentry.io" className={INPUT} /></label>
            <label className="text-xs text-gray-400 space-y-1"><span>Project slug (optional)</span>
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="all projects" className={INPUT} /></label>
          </div>
          {/* Fatal-crash alerts */}
          <div className="pt-3 mt-3 border-t border-gray-800 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <button type="button" role="switch" aria-checked={alertsEnabled} onClick={() => setAlertsEnabled(v => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${alertsEnabled ? 'bg-orange-500' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${alertsEnabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <span className="text-sm text-gray-200 font-medium">Alert on new fatal crashes</span>
              <Badge tone={alertsEnabled ? 'good' : 'quiet'}>{alertsEnabled ? 'On' : 'Off'}</Badge>
            </label>
            <p className="text-[11px] text-gray-500 flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>Every 15 minutes we check for new <Code>level:fatal</Code> issues. Each new one is logged to System Health and emailed below (deduped, never twice).</span>
            </p>
            <label className="text-xs text-gray-400 space-y-1 block max-w-md">
              <span>Alert email(s), comma separated</span>
              <input value={alertEmail} onChange={e => setAlertEmail(e.target.value)} placeholder="ops@tyrepulse.app, you@company.com"
                className={INPUT} />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Btn variant="primary" icon={Save} onClick={onSave} busy={saving} disabled={!connected && !token.trim()}>
              {saving ? 'Saving...' : 'Save connection'}
            </Btn>
          </div>
        </Panel>
      )}

      {connected && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatTile label="Issues" value={(loading || reason) ? 'N/A' : summary.total} icon={Bug}
              sub={summary.total >= ISSUE_PAGE ? `First ${ISSUE_PAGE} shown` : 'In this window'} />
            <StatTile label="Fatal" value={(loading || reason) ? 'N/A' : summary.fatal} tone={summary.fatal > 0 ? 'danger' : 'default'} icon={ShieldAlert} />
            <StatTile label="Errors" value={(loading || reason) ? 'N/A' : summary.errors} tone={summary.errors > 0 ? 'accent' : 'default'} icon={Bug} />
            <StatTile label="Events" value={(loading || reason) ? 'N/A' : nf.format(summary.events)} icon={Activity} sub="Across these issues" />
            <StatTile label="Users affected" value={(loading || reason) ? 'N/A' : nf.format(summary.users)} tone={summary.users > 0 ? 'warning' : 'default'} icon={Users}
              sub="Summed per issue" />
          </div>

          {summary.total >= ISSUE_PAGE && !loading && (
            <Note icon={Info} tone="warning">
              Sentry returned its first page of {ISSUE_PAGE} issues, so tiles and charts cover those only.
              Narrow the search or period, or open Sentry for the full list.
            </Note>
          )}

          {/* Charts */}
          {!loading && issues.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-5">
              <Panel className="lg:col-span-2">
                <PanelHeader icon={BarChart3} title="Issues by level" subtitle="How many distinct issues sit at each Sentry level." />
                <BarsChart bars={levelBars} summary={levelBars.map(b => `${b.label} ${b.value}`).join(', ')} />
              </Panel>
              <Panel className="lg:col-span-3">
                <PanelHeader icon={Activity} title="Top issues by events" subtitle="The issues producing the most events in this window, coloured by level." />
                <BarsChart bars={topBars} valueFormat={(v) => `${nf.format(v)} events`}
                  summary={topBars.map(b => `${b.label} ${b.value}`).join(', ')}
                  emptyText="No events recorded against these issues." />
              </Panel>
            </div>
          )}

          {/* Filters */}
          <Panel>
            <PanelHeader icon={Bug} title="Issues" subtitle="Click an issue for its stack trace, device details and activity." />
            <div className="space-y-2 mb-3">
              <form onSubmit={submitSearch}>
                <Toolbar>
                  <SearchInput value={queryText} onChange={setQueryText}
                    placeholder="Sentry search e.g. is:unresolved level:fatal release:1.3.0" className="flex-1 min-w-[220px]" />
                  <Btn type="submit">Search</Btn>
                  <label><span className="sr-only">Project</span>
                    <Select value={projectId} onChange={setProjectId} className="w-44"
                      options={[{ value: '', label: 'All projects' }, ...projects.map(p => ({ value: String(p.id), label: p.name || p.slug }))]} />
                  </label>
                  <label><span className="sr-only">Period</span>
                    <Select value={period} onChange={setPeriod} className="w-36"
                      options={PERIODS.map(p => ({ value: p.key, label: p.label }))} />
                  </label>
                </Toolbar>
              </form>
              <Segmented value={activeQuery} onChange={applyPreset} ariaLabel="Issue presets" role="group"
                options={PRESETS.map(p => ({ key: p.key, label: p.label }))} />
            </div>

            {/* Issue list */}
            {loading ? (
              <LoadingState label="Loading crash reports" />
            ) : reason === 'auth' ? (
              <EmptyState icon={ShieldAlert} title="Sentry rejected the token"
                reason="Open Connection and paste a fresh token." action={<Btn icon={Settings} onClick={() => setShowSetup(true)}>Connection</Btn>} />
            ) : reason && reason !== 'not_configured' ? (
              <EmptyState icon={Bug} title="Issues could not be loaded" reason="Sentry did not answer this request. Try again in a moment."
                action={<Btn icon={RefreshCw} onClick={loadIssues}>Retry</Btn>} />
            ) : issues.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No matching issues in this window"
                reason="Nothing in Sentry matches this search, project and period." />
            ) : (
              <div className="space-y-2">
                {issues.map(it => {
                  const lvl = levelMeta(it.level)
                  return (
                    <div key={it.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-3.5 hover:border-gray-700 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" onClick={() => openDetail(it)} aria-label={`Open details for ${it.title || 'issue'}`}
                          className="min-w-0 text-left group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone={lvl.tone}>{it.level ? it.level.toUpperCase() : 'ERROR'}</Badge>
                            {it.shortId && <Code>{it.shortId}</Code>}
                            {it.project && <span className="text-[11px] text-gray-500">{it.project}</span>}
                            {it.platform && <span className="text-[11px] text-gray-500">{it.platform}</span>}
                            {it.status && it.status !== 'unresolved' && <Badge tone={STATUS_TONE[it.status] || 'default'}><span className="capitalize">{it.status}</span></Badge>}
                          </div>
                          <p className="text-sm font-semibold text-gray-100 mt-1 truncate group-hover:text-orange-300" title={it.title || ''}>{it.title}</p>
                          {it.value && it.value !== it.title && <p className="text-xs text-gray-400 mt-0.5 truncate">{it.value}</p>}
                          {it.culprit && <p className="text-[11px] text-gray-500 mt-0.5 font-mono truncate">{it.culprit}</p>}
                        </button>
                        <div className="shrink-0 flex flex-col items-end gap-1.5">
                          {safeHref(it.permalink) && (
                            <a href={safeHref(it.permalink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200">Sentry <ExternalLink size={12} /></a>
                          )}
                          <IssueActions issue={it} acting={acting === it.id} onAct={act} compact />
                          {members.length > 0 && (
                            <label><span className="sr-only">Assign issue</span>
                              <Select value={it.assignedTo?.type === 'user' ? String(it.assignedTo.id) : ''} disabled={acting === it.id}
                                onChange={v => assign(it, v)} options={memberOptions} className="w-36" />
                            </label>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2.5 text-[11px] text-gray-400 flex-wrap">
                        <span className="inline-flex items-center gap-1 tabular-nums"><Activity size={12} /> {nf.format(it.count || 0)} event{it.count !== 1 ? 's' : ''}</span>
                        <span className="inline-flex items-center gap-1 tabular-nums"><Users size={12} /> {nf.format(it.userCount || 0)} user{it.userCount !== 1 ? 's' : ''}</span>
                        <span>first {timeAgo(it.firstSeen)}</span>
                        <span>last {timeAgo(it.lastSeen)}</span>
                        {it.assignedTo && <span className="inline-flex items-center gap-1 text-orange-300"><UserPlus size={12} /> {it.assignedTo.name}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </>
      )}

      {/* Detail dialog */}
      <Modal
        open={!!detailFor}
        onClose={closeDetail}
        width="max-w-3xl"
        title={detailFor?.title || 'Issue'}
        subtitle={detailFor?.culprit || undefined}
      >
        {detailFor && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={levelMeta(detailFor.level).tone}>{detailFor.level ? detailFor.level.toUpperCase() : 'ERROR'}</Badge>
              {detailFor.shortId && <Code>{detailFor.shortId}</Code>}
              {detailFor.status && <Badge tone={STATUS_TONE[detailFor.status] || 'default'}><span className="capitalize">{detailFor.status}</span></Badge>}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <IssueActions issue={detailFor} acting={acting === detailFor.id} onAct={act} />
              {safeHref(detailFor.permalink) && (
                <a href={safeHref(detailFor.permalink)} target="_blank" rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-orange-700/50 text-orange-300 hover:bg-orange-500/10">
                  Open in Sentry <ExternalLink size={12} />
                </a>
              )}
            </div>

            {/* Assignee */}
            {members.length > 0 && (
              <label className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-400 inline-flex items-center gap-1.5"><UserPlus size={14} className="text-orange-400" /> Assigned to</span>
                <Select value={detailFor.assignedTo?.type === 'user' ? String(detailFor.assignedTo.id) : ''} disabled={acting === detailFor.id}
                  onChange={v => assign(detailFor, v)} className="w-full sm:w-64"
                  options={[{ value: '', label: 'Unassigned' }, ...members.map(m => ({ value: m.userId, label: `${m.name}${m.email ? ` (${m.email})` : ''}` }))]} />
              </label>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="Events" value={nf.format(detailFor.count || 0)} icon={Activity} />
              <StatTile label="Users" value={nf.format(detailFor.userCount || 0)} tone={detailFor.userCount > 0 ? 'warning' : 'default'} icon={Users} />
              <StatTile label="First seen" value={timeAgo(detailFor.firstSeen)} icon={Clock} />
              <StatTile label="Last seen" value={timeAgo(detailFor.lastSeen)} icon={Clock} />
            </div>

            {detailLoading ? (
              <LoadingState label="Loading details" rows={3} />
            ) : detail?.error ? (
              <Note icon={Info} tone="warning">{detail.error}</Note>
            ) : detail?.event ? (
              <>
                {/* Key tags */}
                {detail.event.tags?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Smartphone size={13} className="text-orange-400" /> Device &amp; context</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.event.tags.filter(t => KEY_TAGS.includes(t.key)).map(t => (
                        <span key={t.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-900 border border-gray-800 text-[11px]">
                          <span className="text-gray-500">{t.key}</span><span className="text-gray-200 font-medium break-all">{t.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.event.user && (
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">User </span>
                    <span className="text-gray-200">{detail.event.user.username || detail.event.user.id || 'unknown'}</span>
                    {detail.event.user.geo?.country_code && <span className="text-gray-500"> | {detail.event.user.geo.city || ''} {detail.event.user.geo.country_code}</span>}
                  </div>
                )}
                {/* Stack traces */}
                {detail.event.exceptions?.length > 0 ? detail.event.exceptions.map((ex, xi) => (
                  <div key={xi}>
                    <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Cpu size={13} className="text-orange-400" /> {ex.type}{ex.value ? `: ${ex.value}` : ''}</h4>
                    <div className="rounded-lg border border-gray-800 bg-gray-900/60 divide-y divide-gray-800/70 overflow-hidden">
                      {ex.frames.map((f, fi) => (
                        <div key={fi} className={`px-3 py-1.5 text-[11px] font-mono break-all ${f.inApp ? 'bg-orange-500/5' : ''}`}>
                          <span className={f.inApp ? 'text-orange-300' : 'text-gray-300'}>{f.fn}</span>
                          {f.file && <span className="text-gray-500"> &nbsp;{f.file}{f.line != null ? `:${f.line}` : ''}</span>}
                          {f.inApp && <span className="ml-2"><Badge tone="accent">app</Badge></span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )) : (
                  <p className="text-xs text-gray-500">No stack trace on the latest event (native crash or symbols filtered).</p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-500">No event detail available.</p>
            )}

            {/* Comment box */}
            <div className="pt-1">
              <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><MessageSquare size={13} className="text-orange-400" /> Add a note</h4>
              <div className="flex items-start gap-2">
                <textarea aria-label="Note for this issue" value={commentText} onChange={e => setCommentText(e.target.value)} rows={2}
                  placeholder="e.g. Fixed in v1.3.1 by resizing photos before base64. Assigned to me."
                  className={`${INPUT} flex-1 resize-y`} />
                <Btn variant="primary" icon={Send} onClick={submitComment} busy={commenting} disabled={!commentText.trim()}>{commenting ? 'Posting...' : 'Post'}</Btn>
              </div>
            </div>

            {/* Activity timeline */}
            {detail?.activity?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Clock size={13} className="text-orange-400" /> Activity</h4>
                <div className="space-y-1.5">
                  {detail.activity.map((a, ai) => (
                    <div key={ai} className="text-[11px] text-gray-400 flex items-start gap-2">
                      <span className="text-gray-500 shrink-0 w-16">{timeAgo(a.dateCreated)}</span>
                      <span className="min-w-0">
                        <span className="text-gray-200 font-medium">{a.user}</span>{' '}
                        <span className="text-gray-500">{String(a.type || '').replace(/_/g, ' ')}</span>
                        {a.text && <span className="block text-gray-300 mt-0.5 break-words">{a.text}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Resolve / Ignore / Reopen, shown only where the transition makes sense. */
function IssueActions({ issue, acting, onAct, compact = false }) {
  const size = compact ? 'xs' : 'sm'
  return (
    <div className="flex items-center gap-1">
      {issue.status !== 'resolved' && (
        <Btn size={size} variant="good" icon={Check} busy={acting} onClick={() => onAct(issue, 'resolved')} title="Resolve">
          {compact ? null : 'Resolve'}
        </Btn>
      )}
      {issue.status !== 'ignored' && (
        <Btn size={size} icon={EyeOff} disabled={acting} onClick={() => onAct(issue, 'ignored')} title="Ignore">
          {compact ? null : 'Ignore'}
        </Btn>
      )}
      {issue.status !== 'unresolved' && (
        <Btn size={size} icon={RotateCcw} disabled={acting} onClick={() => onAct(issue, 'unresolved')} title="Reopen">
          {compact ? null : 'Reopen'}
        </Btn>
      )}
    </div>
  )
}
