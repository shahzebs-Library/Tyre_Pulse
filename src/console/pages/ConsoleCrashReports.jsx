/**
 * ConsoleCrashReports - super-admin Crash & Error Reports (Sentry) console page.
 *
 * Pure console page (navy + orange theme, useConsoleAuth gate). Surfaces the live
 * Sentry issue stream (mobile crashes + web errors) INSIDE /console so the operator
 * never has to open the Sentry dashboard. The Sentry auth token is entered here once
 * and stored SERVER-SIDE only (deny-all cron_config via a super-admin RPC); it is
 * never returned to the client. All Sentry calls go through the `sentry-issues` edge
 * proxy which self-gates to super-admin and reads the token via the service role.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bug, RefreshCw, Settings, AlertTriangle, ExternalLink, Users, Activity,
  ShieldAlert, CheckCircle2, Save, Loader2, Info,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { getSentryStatus, saveSentryConfig, listSentryIssues } from '../../lib/api/sentryCrashes'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

const PERIODS = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '14d', label: 'Last 14 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
]
const QUERIES = [
  { key: 'is:unresolved', label: 'Unresolved' },
  { key: 'is:unresolved level:fatal', label: 'Fatal only' },
  { key: 'is:unresolved level:error', label: 'Errors' },
  { key: '', label: 'All' },
]
const LEVEL_STYLE = {
  fatal:   'border-red-500/40 bg-red-500/10 text-red-300',
  error:   'border-orange-500/40 bg-orange-500/10 text-orange-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  info:    'border-blue-500/40 bg-blue-500/10 text-blue-300',
  debug:   'border-gray-500/40 bg-gray-500/10 text-gray-300',
}

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

export default function ConsoleCrashReports() {
  const { admin } = useConsoleAuth()

  const [status, setStatus] = useState(null)      // { configured, org, region_url, project }
  const [statusLoading, setStatusLoading] = useState(true)
  const [showSetup, setShowSetup] = useState(false)

  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')        // not_configured | auth | ''
  const [period, setPeriod] = useState('14d')
  const [query, setQuery] = useState('is:unresolved')

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
      setStatus(s)
      setOrg(s.org || 'shah-profile')
      setRegionUrl(s.region_url || 'https://de.sentry.io')
      setProject(s.project || '')
      if (!s.configured) setShowSetup(true)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load Sentry settings.'))
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadIssues = useCallback(async () => {
    setLoading(true); setError(''); setReason('')
    try {
      const res = await listSentryIssues({ query, period })
      if (res?.ok) {
        setIssues(Array.isArray(res.issues) ? res.issues : [])
      } else {
        setIssues([])
        setReason(res?.reason || 'error')
        if (res?.reason === 'auth') setError('Sentry rejected the token. Update it in Connection settings.')
        else if (res?.reason === 'not_configured') { /* handled by the connect panel */ }
        else if (res?.reason !== 'not_configured') setError('Could not load crash reports. Try again.')
      }
    } catch (e) {
      setError(toUserMessage(e, 'Could not load crash reports.'))
    } finally {
      setLoading(false)
    }
  }, [query, period])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { if (status?.configured) loadIssues() }, [status?.configured, loadIssues])

  const onSave = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      await saveSentryConfig({ token, org, regionUrl, project })
      setToken('')
      setNotice('Sentry connection saved.')
      setShowSetup(false)
      await loadStatus()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save Sentry settings.'))
    } finally {
      setSaving(false)
    }
  }

  if (!admin) return null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Bug size={20} className="text-orange-400" /> Crash &amp; Error Reports
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Live Sentry issues from the mobile app and web, inside the console.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSetup(s => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
          >
            <Settings size={15} /> Connection
          </button>
          <button
            onClick={loadIssues}
            disabled={loading || !status?.configured}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500/90 hover:bg-orange-500 text-white disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
          <CheckCircle2 size={15} /> {notice}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Connection / setup */}
      {(showSetup || (!statusLoading && !status?.configured)) && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShieldAlert size={15} className="text-orange-400" /> Sentry connection
          </h2>
          <p className="text-xs text-gray-400 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            Paste a Sentry <span className="text-gray-200 font-medium">Auth Token</span> with read access
            (Sentry &rarr; Settings &rarr; Auth Tokens, scope <code className="text-orange-300">event:read</code> / <code className="text-orange-300">project:read</code>).
            The token is stored on the server only and is never shown again.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-400 space-y-1">
              <span>Auth token {status?.configured && <span className="text-green-400">(saved &mdash; leave blank to keep)</span>}</span>
              <input
                type="password" value={token} onChange={e => setToken(e.target.value)}
                placeholder={status?.configured ? '••••••••••••' : 'sntrys_...'}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none"
                autoComplete="off"
              />
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span>Organisation slug</span>
              <input value={org} onChange={e => setOrg(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" />
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span>Region URL</span>
              <input value={regionUrl} onChange={e => setRegionUrl(e.target.value)}
                placeholder="https://de.sentry.io"
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" />
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span>Project slug (optional)</span>
              <input value={project} onChange={e => setProject(e.target.value)}
                placeholder="all projects"
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-sm focus:border-orange-500 outline-none" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving || (!status?.configured && !token.trim())}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500/90 hover:bg-orange-500 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save connection
            </button>
            {status?.configured && (
              <span className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Connected to {status.org}</span>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      {status?.configured && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-gray-900/60 border border-gray-800 p-1">
            {QUERIES.map(q => (
              <button key={q.key} onClick={() => setQuery(q.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${query === q.key ? 'bg-orange-500 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
                {q.label}
              </button>
            ))}
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs outline-none focus:border-orange-500">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <span className="text-xs text-gray-500 ml-auto">{issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Issue list */}
      {status?.configured && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading crash reports...
            </div>
          ) : reason === 'auth' ? (
            <div className="text-center py-14 text-gray-400">
              <ShieldAlert size={26} className="mx-auto text-red-400 mb-2" />
              Sentry rejected the token. Open <span className="text-gray-200">Connection</span> and paste a fresh one.
            </div>
          ) : issues.length === 0 ? (
            <div className="text-center py-14 text-gray-400">
              <CheckCircle2 size={26} className="mx-auto text-green-400 mb-2" />
              No matching issues in this window. All clear.
            </div>
          ) : issues.map(it => {
            const href = safeHref(it.permalink)
            const lvl = LEVEL_STYLE[it.level] || LEVEL_STYLE.error
            return (
              <div key={it.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-3.5 hover:border-gray-700 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${lvl}`}>{it.level}</span>
                      {it.shortId && <span className="text-[11px] text-gray-500 font-mono">{it.shortId}</span>}
                      {it.platform && <span className="text-[11px] text-gray-500">{it.platform}</span>}
                      {it.status && it.status !== 'unresolved' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">{it.status}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-100 mt-1 truncate">{it.title}</p>
                    {it.value && it.value !== it.title && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{it.value}</p>
                    )}
                    {it.culprit && <p className="text-[11px] text-gray-500 mt-0.5 font-mono truncate">{it.culprit}</p>}
                  </div>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200">
                      Open <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2.5 text-[11px] text-gray-400">
                  <span className="inline-flex items-center gap-1"><Activity size={12} /> {it.count} event{it.count !== 1 ? 's' : ''}</span>
                  <span className="inline-flex items-center gap-1"><Users size={12} /> {it.userCount} user{it.userCount !== 1 ? 's' : ''}</span>
                  <span>first {timeAgo(it.firstSeen)}</span>
                  <span>last {timeAgo(it.lastSeen)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
