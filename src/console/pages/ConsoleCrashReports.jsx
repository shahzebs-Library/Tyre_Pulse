/**
 * ConsoleCrashReports - super-admin Crash & Error Reports (Sentry) console page.
 *
 * Pure console page (navy + orange theme, useConsoleAuth gate). Surfaces the live
 * Sentry issue stream (mobile crashes + web errors) INSIDE /console with triage:
 * summary tiles, search + project + period filters, a full issue-detail drawer
 * (stack trace + device/OS/release/user tags), and Resolve / Ignore / Reopen.
 *
 * The Sentry auth token is entered once in Connection and stored SERVER-SIDE only
 * (deny-all cron_config via a super-admin RPC); it is never returned to the client.
 * Every Sentry call goes through the `sentry-issues` edge proxy which self-gates to
 * super-admin and reads the token via the service role.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bug, RefreshCw, Settings, AlertTriangle, ExternalLink, Users, Activity,
  ShieldAlert, CheckCircle2, Save, Loader2, Info, Search, X, Check, EyeOff, RotateCcw,
  Smartphone, Cpu, UserPlus, MessageSquare, Send, Clock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  getSentryStatus, saveSentryConfig, listSentryIssues,
  getSentryProjects, getSentryIssueDetail, updateSentryIssue,
  getSentryMembers, assignSentryIssue, commentSentryIssue,
} from '../../lib/api/sentryCrashes'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

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
const LEVEL_STYLE = {
  fatal:   'border-red-500/40 bg-red-500/10 text-red-300',
  error:   'border-orange-500/40 bg-orange-500/10 text-orange-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  info:    'border-blue-500/40 bg-blue-500/10 text-blue-300',
  debug:   'border-gray-500/40 bg-gray-500/10 text-gray-300',
}
// Tags worth surfacing prominently in the detail drawer.
const KEY_TAGS = ['release', 'environment', 'os', 'os.name', 'device', 'device.family', 'device.class', 'level', 'handled', 'mechanism', 'transaction']

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

function Tile({ label, value, tint }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-3.5 py-2.5">
      <div className={`text-lg font-bold ${tint || 'text-white'}`}>{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  )
}

export default function ConsoleCrashReports() {
  const { admin } = useConsoleAuth()

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

  // setup form
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('shah-profile')
  const [regionUrl, setRegionUrl] = useState('https://de.sentry.io')
  const [project, setProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const s = await getSentryStatus()
      setStatus(s); setOrg(s.org || 'shah-profile'); setRegionUrl(s.region_url || 'https://de.sentry.io'); setProject(s.project || '')
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
    } catch (e) { setError(toUserMessage(e, 'Could not load crash reports.')) }
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

  const onSave = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      await saveSentryConfig({ token, org, regionUrl, project })
      setToken(''); setNotice('Sentry connection saved.'); setShowSetup(false)
      await loadStatus()
    } catch (e) { setError(toUserMessage(e, 'Could not save Sentry settings.')) }
    finally { setSaving(false) }
  }

  const openDetail = async (issue) => {
    setDetailFor(issue); setDetail(null); setDetailLoading(true); setCommentText('')
    try {
      const res = await getSentryIssueDetail(issue.id)
      if (res?.ok) setDetail(res)
      else setDetail({ issue, event: null, error: res?.reason === 'auth' ? 'Token lacks event read scope.' : 'Could not load details.' })
    } catch (e) { setDetail({ issue, event: null, error: toUserMessage(e, 'Could not load details.') }) }
    finally { setDetailLoading(false) }
  }

  const act = async (issue, status) => {
    setActing(issue.id); setError(''); setNotice('')
    try {
      const res = await updateSentryIssue(issue.id, status)
      if (res?.ok) {
        setNotice(`Issue ${status === 'unresolved' ? 'reopened' : status}.`)
        setIssues(prev => prev.map(i => i.id === issue.id ? { ...i, status } : i)
          .filter(i => !(activeQuery.includes('is:unresolved') && i.id === issue.id && status !== 'unresolved')))
        if (detailFor?.id === issue.id) setDetail(d => d ? { ...d, issue: { ...d.issue, status } } : d)
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

  if (!admin) return null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Bug size={20} className="text-orange-400" /> Crash &amp; Error Reports
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Live Sentry issues from the mobile app and web, with triage.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSetup(s => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700">
            <Settings size={15} /> Connection
          </button>
          <button onClick={loadIssues} disabled={loading || !status?.configured}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500/90 hover:bg-orange-500 text-white disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </div>

      {notice && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm"><CheckCircle2 size={15} /> {notice}</div>}
      {error && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm"><AlertTriangle size={15} /> {error}</div>}

      {/* Connection / setup */}
      {(showSetup || (!statusLoading && !status?.configured)) && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><ShieldAlert size={15} className="text-orange-400" /> Sentry connection</h2>
          <p className="text-xs text-gray-400 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            Paste a Sentry Auth Token with read (and, for triage, <code className="text-orange-300">issue:write</code>) scope.
            The token is stored on the server only and is never shown again.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-400 space-y-1">
              <span>Auth token {status?.configured && <span className="text-green-400">(saved &mdash; leave blank to keep)</span>}</span>
              <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={status?.configured ? '••••••••••••' : 'sntrys_...'} autoComplete="off"
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" />
            </label>
            <label className="text-xs text-gray-400 space-y-1"><span>Organisation slug</span>
              <input value={org} onChange={e => setOrg(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" /></label>
            <label className="text-xs text-gray-400 space-y-1"><span>Region URL</span>
              <input value={regionUrl} onChange={e => setRegionUrl(e.target.value)} placeholder="https://de.sentry.io" className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" /></label>
            <label className="text-xs text-gray-400 space-y-1"><span>Project slug (optional)</span>
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="all projects" className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" /></label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={saving || (!status?.configured && !token.trim())}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500/90 hover:bg-orange-500 text-white disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save connection
            </button>
            {status?.configured && <span className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Connected to {status.org}</span>}
          </div>
        </div>
      )}

      {status?.configured && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
            <Tile label="Issues" value={summary.total} />
            <Tile label="Fatal" value={summary.fatal} tint="text-red-300" />
            <Tile label="Errors" value={summary.errors} tint="text-orange-300" />
            <Tile label="Events" value={summary.events} tint="text-gray-200" />
            <Tile label="Users affected" value={summary.users} tint="text-amber-300" />
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={submitSearch} className="flex items-center gap-1.5 flex-1 min-w-[220px]">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={queryText} onChange={e => setQueryText(e.target.value)} placeholder="Sentry search e.g. is:unresolved level:fatal release:1.3.0"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs focus:border-orange-500 outline-none" />
                </div>
                <button type="submit" className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs">Search</button>
              </form>
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs outline-none focus:border-orange-500">
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name || p.slug}</option>)}
              </select>
              <select value={period} onChange={e => setPeriod(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs outline-none focus:border-orange-500">
                {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${activeQuery === p.key ? 'bg-orange-500 text-white' : 'bg-gray-900/60 border border-gray-800 text-gray-300 hover:bg-gray-800'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Issue list */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-500 gap-2"><Loader2 size={18} className="animate-spin" /> Loading crash reports...</div>
            ) : reason === 'auth' ? (
              <div className="text-center py-14 text-gray-400"><ShieldAlert size={26} className="mx-auto text-red-400 mb-2" />Sentry rejected the token. Open <span className="text-gray-200">Connection</span> and paste a fresh one.</div>
            ) : issues.length === 0 ? (
              <div className="text-center py-14 text-gray-400"><CheckCircle2 size={26} className="mx-auto text-green-400 mb-2" />No matching issues in this window.</div>
            ) : issues.map(it => {
              const lvl = LEVEL_STYLE[it.level] || LEVEL_STYLE.error
              return (
                <div key={it.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-3.5 hover:border-gray-700 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => openDetail(it)} className="min-w-0 text-left group">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${lvl}`}>{it.level}</span>
                        {it.shortId && <span className="text-[11px] text-gray-500 font-mono">{it.shortId}</span>}
                        {it.project && <span className="text-[11px] text-gray-500">{it.project}</span>}
                        {it.platform && <span className="text-[11px] text-gray-500">{it.platform}</span>}
                        {it.status && it.status !== 'unresolved' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">{it.status}</span>}
                      </div>
                      <p className="text-sm font-semibold text-gray-100 mt-1 truncate group-hover:text-orange-300">{it.title}</p>
                      {it.value && it.value !== it.title && <p className="text-xs text-gray-400 mt-0.5 truncate">{it.value}</p>}
                      {it.culprit && <p className="text-[11px] text-gray-500 mt-0.5 font-mono truncate">{it.culprit}</p>}
                    </button>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {safeHref(it.permalink) && (
                        <a href={safeHref(it.permalink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200">Sentry <ExternalLink size={12} /></a>
                      )}
                      <div className="flex items-center gap-1">
                        {it.status !== 'resolved' && (
                          <button onClick={() => act(it, 'resolved')} disabled={acting === it.id} title="Resolve"
                            className="p-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 disabled:opacity-50">
                            {acting === it.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          </button>
                        )}
                        {it.status !== 'ignored' && (
                          <button onClick={() => act(it, 'ignored')} disabled={acting === it.id} title="Ignore"
                            className="p-1.5 rounded-md bg-gray-700/40 border border-gray-600/40 text-gray-300 hover:bg-gray-700/70 disabled:opacity-50"><EyeOff size={13} /></button>
                        )}
                        {it.status !== 'unresolved' && (
                          <button onClick={() => act(it, 'unresolved')} disabled={acting === it.id} title="Reopen"
                            className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"><RotateCcw size={13} /></button>
                        )}
                      </div>
                      {members.length > 0 && (
                        <select value={it.assignedTo?.type === 'user' ? it.assignedTo.id : ''} disabled={acting === it.id}
                          onChange={e => assign(it, e.target.value)} title="Assign to"
                          className="max-w-[130px] px-2 py-1 rounded-md bg-gray-900 border border-gray-800 text-gray-300 text-[11px] outline-none focus:border-orange-500">
                          <option value="">Unassigned</option>
                          {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2.5 text-[11px] text-gray-400 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Activity size={12} /> {it.count} event{it.count !== 1 ? 's' : ''}</span>
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {it.userCount} user{it.userCount !== 1 ? 's' : ''}</span>
                    <span>first {timeAgo(it.firstSeen)}</span>
                    <span>last {timeAgo(it.lastSeen)}</span>
                    {it.assignedTo && <span className="inline-flex items-center gap-1 text-orange-300"><UserPlus size={12} /> {it.assignedTo.name}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Detail drawer */}
      {detailFor && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => { setDetailFor(null); setDetail(null) }}>
          <div className="w-full max-w-2xl h-full overflow-y-auto bg-gray-950 border-l border-gray-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${LEVEL_STYLE[detailFor.level] || LEVEL_STYLE.error}`}>{detailFor.level}</span>
                  {detailFor.shortId && <span className="text-[11px] text-gray-500 font-mono">{detailFor.shortId}</span>}
                </div>
                <h3 className="text-base font-bold text-white mt-1">{detailFor.title}</h3>
                {detailFor.culprit && <p className="text-xs text-gray-500 font-mono mt-0.5">{detailFor.culprit}</p>}
              </div>
              <button onClick={() => { setDetailFor(null); setDetail(null) }} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={18} /></button>
            </div>

            <div className="flex items-center gap-2">
              {detailFor.status !== 'resolved' && <button onClick={() => act(detailFor, 'resolved')} disabled={acting === detailFor.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20"><Check size={13} /> Resolve</button>}
              {detailFor.status !== 'ignored' && <button onClick={() => act(detailFor, 'ignored')} disabled={acting === detailFor.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-700/40 border border-gray-600/40 text-gray-300 hover:bg-gray-700/70"><EyeOff size={13} /> Ignore</button>}
              {detailFor.status !== 'unresolved' && <button onClick={() => act(detailFor, 'unresolved')} disabled={acting === detailFor.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20"><RotateCcw size={13} /> Reopen</button>}
              {safeHref(detailFor.permalink) && <a href={safeHref(detailFor.permalink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-orange-500/10 border border-orange-500/30 text-orange-300 hover:bg-orange-500/20 ml-auto">Open in Sentry <ExternalLink size={12} /></a>}
            </div>

            {/* Assignee */}
            {members.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 inline-flex items-center gap-1.5"><UserPlus size={14} className="text-orange-400" /> Assigned to</span>
                <select value={detailFor.assignedTo?.type === 'user' ? detailFor.assignedTo.id : ''} disabled={acting === detailFor.id}
                  onChange={e => assign(detailFor, e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs outline-none focus:border-orange-500">
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.userId} value={m.userId}>{m.name}{m.email ? ` (${m.email})` : ''}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <Tile label="Events" value={detailFor.count} />
              <Tile label="Users" value={detailFor.userCount} tint="text-amber-300" />
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-3 py-2.5"><div className="text-xs font-semibold text-gray-200">{timeAgo(detailFor.firstSeen)}</div><div className="text-[11px] text-gray-400">first seen</div></div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-3 py-2.5"><div className="text-xs font-semibold text-gray-200">{timeAgo(detailFor.lastSeen)}</div><div className="text-[11px] text-gray-400">last seen</div></div>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-14 text-gray-500 gap-2"><Loader2 size={18} className="animate-spin" /> Loading details...</div>
            ) : detail?.error ? (
              <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{detail.error}</div>
            ) : detail?.event ? (
              <>
                {/* Key tags */}
                {detail.event.tags?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Smartphone size={13} className="text-orange-400" /> Device &amp; context</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.event.tags.filter(t => KEY_TAGS.includes(t.key)).map(t => (
                        <span key={t.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-900 border border-gray-800 text-[11px]">
                          <span className="text-gray-500">{t.key}</span><span className="text-gray-200 font-medium">{t.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.event.user && (
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">User </span>
                    <span className="text-gray-200">{detail.event.user.username || detail.event.user.id || 'unknown'}</span>
                    {detail.event.user.geo?.country_code && <span className="text-gray-500"> &middot; {detail.event.user.geo.city || ''} {detail.event.user.geo.country_code}</span>}
                  </div>
                )}
                {/* Stack traces */}
                {detail.event.exceptions?.length > 0 ? detail.event.exceptions.map((ex, xi) => (
                  <div key={xi}>
                    <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Cpu size={13} className="text-orange-400" /> {ex.type}{ex.value ? `: ${ex.value}` : ''}</h4>
                    <div className="rounded-lg border border-gray-800 bg-gray-900/60 divide-y divide-gray-800/70 overflow-hidden">
                      {ex.frames.map((f, fi) => (
                        <div key={fi} className={`px-3 py-1.5 text-[11px] font-mono ${f.inApp ? 'bg-orange-500/5' : ''}`}>
                          <span className={f.inApp ? 'text-orange-300' : 'text-gray-300'}>{f.fn}</span>
                          {f.file && <span className="text-gray-500"> &nbsp;{f.file}{f.line != null ? `:${f.line}` : ''}</span>}
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
                <textarea value={commentText} onChange={e => setCommentText(e.target.value)} rows={2}
                  placeholder="e.g. Fixed in v1.3.1 - resizing photos before base64. Assigned to me."
                  className="flex-1 px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-100 text-xs focus:border-orange-500 outline-none resize-y" />
                <button onClick={submitComment} disabled={commenting || !commentText.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-orange-500/90 hover:bg-orange-500 text-white disabled:opacity-50 shrink-0">
                  {commenting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Post
                </button>
              </div>
            </div>

            {/* Activity timeline */}
            {detail?.activity?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5"><Clock size={13} className="text-orange-400" /> Activity</h4>
                <div className="space-y-1.5">
                  {detail.activity.map((a, ai) => (
                    <div key={ai} className="text-[11px] text-gray-400 flex items-start gap-2">
                      <span className="text-gray-600 shrink-0">{timeAgo(a.dateCreated)}</span>
                      <span className="min-w-0">
                        <span className="text-gray-200 font-medium">{a.user}</span>{' '}
                        <span className="text-gray-500">{a.type.replace(/_/g, ' ')}</span>
                        {a.text && <span className="block text-gray-300 mt-0.5">{a.text}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
