/**
 * SecurityCenter.jsx - security posture page (roadmap #24), route
 * /security-center, also hosted as the Security tab of the console Access
 * Control hub and Console Security.
 *
 * Sections:
 *   a) My session       - sign-in time, token expiry, idle timeout, sign out
 *   b) Login history    - LOGIN/LOGOUT audit rows, KPI strip, 14-day sparkline,
 *                         anomaly flags, search + filters, sortable register, exports
 *   c) Security events  - deletes / exports / bulk actions, last 30 days (admin only)
 *   d) Security checklist - truthful status of the controls actually in place
 *
 * All derived figures come from the pure securityCenterAnalytics engine over
 * the bounded reads in securityCenter.js. A bounded read that comes back full
 * is labelled "latest N", never presented as a total. A failed read renders
 * N/A with Retry, never zeros.
 *
 * Renders for all authenticated users; admin-only sections are hidden for
 * everyone else (RLS remains the hard boundary - this gating is UX only).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldCheck, LogOut, Clock, KeyRound, Fingerprint, UserCheck, Lock,
  Database, AlertTriangle, Download, Trash2, Upload, LogIn, Search,
  CheckCircle, Info, RefreshCw, FileSpreadsheet, FileText, Users, Moon, Share2, Activity,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  fetchLoginHistory,
  fetchRecentSecurityEvents,
  getSessionInfo,
  summarizeLogins,
  getPasswordPolicy,
  IDLE_TIMEOUT_MS,
  SECURITY_EVENT_WINDOW_DAYS,
  LOGIN_HISTORY_LIMIT,
} from '../lib/securityCenter'
import {
  actorName, isTruncated, filterLoginRows, filterEventRows, loginKpis, eventBreakdown,
} from '../lib/securityCenterAnalytics'
import { compareValues } from '../lib/consoleTable'
import { toUserMessage } from '../lib/safeError'

// exportUtils carries the PDF/Excel engines; load it on first click only.
const loadExportUtils = () => import('../lib/exportUtils')

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDateTime(iso, na = 'N/A') {
  if (!iso) return na
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return na
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function relativeTo(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  const abs = Math.abs(ms)
  const m = Math.round(abs / 60000)
  const label = m < 60 ? `${m} min` : m < 60 * 24 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`
  return ms >= 0 ? `in ${label}` : `${label} ago`
}

const sortCompare = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

const ACTION_BADGE = {
  LOGIN:       'bg-green-900/40 text-green-400',
  LOGOUT:      'bg-blue-900/40 text-blue-400',
  DELETE:      'bg-red-900/40 text-red-400',
  BULK_DELETE: 'bg-red-900/40 text-red-400',
  BULK_UPDATE: 'bg-orange-900/40 text-orange-400',
  BULK_CREATE: 'bg-orange-900/40 text-orange-400',
  EXPORT:      'bg-purple-900/40 text-purple-400',
  UPLOAD:      'bg-yellow-900/40 text-yellow-400',
}

const ACTION_ICON = {
  LOGIN: LogIn, LOGOUT: LogOut, DELETE: Trash2, BULK_DELETE: Trash2,
  BULK_UPDATE: Database, BULK_CREATE: Database, EXPORT: Download, UPLOAD: Upload,
}

function ActionBadge({ action }) {
  const Icon = ACTION_ICON[action] ?? Info
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${ACTION_BADGE[action] ?? 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {action || 'N/A'}
    </span>
  )
}

// ── Small building blocks ─────────────────────────────────────────────────────

function Sparkline({ byDay }) {
  const max = Math.max(1, ...byDay.map(d => d.count))
  const total = byDay.reduce((s, d) => s + d.count, 0)
  return (
    <div className="flex items-end gap-1 h-12" role="img" aria-label={`${total} sign-ins over the last ${byDay.length} days`}>
      {byDay.map(d => (
        <div key={d.key} className="flex-1 flex flex-col items-center gap-0.5 min-w-[6px]" title={`${d.key}: ${d.count} login${d.count === 1 ? '' : 's'}`}>
          <div
            className={`w-full rounded-sm ${d.count > 0 ? 'bg-brand-bright/70' : 'bg-[var(--input-bg)]'}`}
            style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="card text-center py-10" role="alert">
      <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" aria-hidden="true" />
      <p className="text-sm text-red-400 mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs px-3 min-h-[44px] inline-flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  )
}

function Tile({ icon: Icon, label, value, sub, tone = 'text-brand-bright' }) {
  return (
    <div className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">{label}</p>
        <Icon className={`w-4 h-4 ${tone}`} aria-hidden="true" />
      </div>
      <p className="text-xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function ExportButtons({ onExport, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => onExport('excel')} disabled={disabled} className="btn-secondary min-h-[44px] text-xs px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
        <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" /> Excel
      </button>
      <button onClick={() => onExport('pdf')} disabled={disabled} className="btn-secondary min-h-[44px] text-xs px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
        <FileText className="w-3.5 h-3.5" aria-hidden="true" /> PDF
      </button>
    </div>
  )
}

const CHECK_STATUS_STYLE = {
  ok:        'bg-green-900/40 text-green-400',
  baseline:  'bg-yellow-900/40 text-yellow-400',
  recommend: 'bg-blue-900/40 text-blue-400',
}

function ChecklistItem({ icon: Icon, title, status, statusLabel, detail }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)]">
      <div className="w-9 h-9 rounded-lg bg-brand-subtle flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="text-brand-bright" style={{ width: 18, height: 18 }} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${CHECK_STATUS_STYLE[status] ?? CHECK_STATUS_STYLE.recommend}`}>
            {statusLabel}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

const controlCls = 'px-3 min-h-[44px] text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SecurityCenter() {
  const { user, profile, signOut, mfaEnabled } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  // Session card
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionError, setSessionError] = useState(null)
  const [signingOut, setSigningOut] = useState(false)

  // Login history
  const [rows, setRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [userFilter, setUserFilter] = useState('')   // admin-only: '' = all users
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  // Security events (admin only)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState(null)
  const [eventSearch, setEventSearch] = useState('')
  const [eventAction, setEventAction] = useState('')

  const [exportError, setExportError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const loadSession = useCallback(async () => {
    setSessionLoading(true)
    setSessionError(null)
    try { setSession(await getSessionInfo()) }
    catch (err) { setSession(null); setSessionError(toUserMessage(err, 'Could not read your session.')) }
    finally { setSessionLoading(false) }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const data = await fetchLoginHistory({
        // Non-admins only ever see their own history (RLS enforces this too).
        userId: isAdmin ? (userFilter || null) : user?.id,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      })
      setRows(data)
      setUpdatedAt(new Date())
    } catch (err) {
      setHistoryError(toUserMessage(err, 'Failed to load login history'))
    } finally {
      setHistoryLoading(false)
    }
  }, [isAdmin, userFilter, dateFrom, dateTo, user?.id])

  const loadEvents = useCallback(async () => {
    if (!isAdmin) { setEventsLoading(false); return }
    setEventsLoading(true)
    setEventsError(null)
    try { setEvents(await fetchRecentSecurityEvents()) }
    catch (err) { setEventsError(toUserMessage(err, 'Failed to load security events')) }
    finally { setEventsLoading(false) }
  }, [isAdmin])

  useEffect(() => { loadSession() }, [loadSession])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { loadEvents() }, [loadEvents])

  const refreshAll = useCallback(() => { loadSession(); loadHistory(); loadEvents() }, [loadSession, loadHistory, loadEvents])

  const summary = useMemo(() => summarizeLogins(rows), [rows])
  const kpis = useMemo(() => loginKpis(rows, summary), [rows, summary])
  const historyCapped = isTruncated(rows, LOGIN_HISTORY_LIMIT)
  const policy = useMemo(() => getPasswordPolicy(), [])

  // Admin user filter options, derived from loaded rows (no extra query).
  const userOptions = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (r.user_id && !map.has(r.user_id)) map.set(r.user_id, actorName(r))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const visibleRows = useMemo(() => filterLoginRows(rows, search, { action: actionFilter }), [rows, search, actionFilter])
  const visibleEvents = useMemo(() => filterEventRows(events, { query: eventSearch, action: eventAction }), [events, eventSearch, eventAction])
  const breakdown = useMemo(() => eventBreakdown(events), [events])
  const eventsCapped = isTruncated(events, LOGIN_HISTORY_LIMIT)

  async function handleSignOut() {
    setSigningOut(true)
    try { await signOut() } finally { setSigningOut(false) }
  }

  const idleMinutes = Math.round(IDLE_TIMEOUT_MS / 60000)
  const historyFiltered = !!(dateFrom || dateTo || userFilter || search || actionFilter)

  // ── Columns ────────────────────────────────────────────────────────────────
  const historyColumns = useMemo(() => [
    {
      id: 'user', accessorFn: r => actorName(r), header: 'User', sortingFn: sortCompare,
      cell: ({ row }) => (
        <span>
          <span className="text-[var(--text-primary)] font-medium">{actorName(row.original)}</span>
          {row.original.user_email && <span className="block text-xs text-[var(--text-dim)]">{row.original.user_email}</span>}
        </span>
      ),
    },
    { id: 'action', accessorFn: r => r.action, header: 'Event', sortingFn: sortCompare, cell: ({ getValue }) => <ActionBadge action={getValue()} /> },
    { id: 'created_at', accessorFn: r => r.created_at || undefined, header: 'When', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDateTime(getValue())}</span> },
    { id: 'session', accessorFn: r => r.session_id || undefined, header: 'Session', enableSorting: false, cell: ({ getValue }) => <span className="text-xs font-mono text-[var(--text-dim)]">{getValue() ? String(getValue()).slice(0, 8) : 'N/A'}</span> },
  ], [])

  const eventColumns = useMemo(() => [
    {
      id: 'who', accessorFn: r => actorName(r), header: 'Who', sortingFn: sortCompare,
      cell: ({ row }) => (
        <span>
          <span className="text-[var(--text-primary)] font-medium">{actorName(row.original)}</span>
          {row.original.user_email && <span className="block text-xs text-[var(--text-dim)]">{row.original.user_email}</span>}
        </span>
      ),
    },
    { id: 'action', accessorFn: r => r.action, header: 'Action', sortingFn: sortCompare, cell: ({ getValue }) => <ActionBadge action={getValue()} /> },
    {
      id: 'what', accessorFn: r => r.table_name || undefined, header: 'What', sortingFn: sortCompare, sortUndefined: 'last',
      cell: ({ row }) => (
        <span>
          {row.original.table_name || 'N/A'}
          {row.original.record_id && <span className="text-xs text-[var(--text-dim)] font-mono ml-1.5">#{String(row.original.record_id).slice(0, 12)}</span>}
        </span>
      ),
    },
    { id: 'created_at', accessorFn: r => r.created_at || undefined, header: 'When', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDateTime(getValue())}</span> },
  ], [])

  // ── Exports: every filtered row, never a page ───────────────────────────────
  async function exportRows(kind, which) {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const isEvents = which === 'events'
      const list = isEvents ? visibleEvents : visibleRows
      const title = isEvents ? 'Security Events' : 'Login History'
      const keys = isEvents ? ['who', 'email', 'action', 'what', 'record', 'when'] : ['who', 'email', 'action', 'when', 'session']
      const headers = isEvents ? ['Who', 'Email', 'Action', 'Table', 'Record', 'When'] : ['User', 'Email', 'Event', 'When', 'Session']
      const data = list.map(r => ({
        who: actorName(r),
        email: r.user_email || 'N/A',
        action: r.action || 'N/A',
        what: r.table_name || 'N/A',
        record: r.record_id ? String(r.record_id) : 'N/A',
        when: formatDateTime(r.created_at),
        session: r.session_id ? String(r.session_id).slice(0, 8) : 'N/A',
      }))
      const file = reportFileName(title)
      if (kind === 'excel') await exportToExcel(data, keys, headers, file)
      else await exportToPdf(data, keys.map((k, i) => ({ key: k, header: headers[i] })), title, file, 'landscape')
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const historyNa = historyLoading ? '...' : historyError ? 'N/A' : null
  const scopeLabel = historyCapped ? `latest ${LOGIN_HISTORY_LIMIT}` : 'loaded'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Center"
        subtitle="Login activity, session controls, and your account security posture"
        icon={ShieldCheck}
        badge={isAdmin ? 'Admin view' : undefined}
        onRefresh={refreshAll}
        refreshing={historyLoading || eventsLoading}
        updatedAt={updatedAt}
      />

      {exportError && (
        <div className="card border border-red-800/50 flex items-center gap-3" role="alert">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-400 flex-1">{exportError}</p>
          <button onClick={() => setExportError('')} className="btn-secondary min-h-[44px] text-xs px-3">Dismiss</button>
        </div>
      )}

      {/* (a) My session ------------------------------------------------------ */}
      <section className="card" aria-labelledby="sc-session">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 id="sc-session" className="text-h4 flex items-center gap-2"><Fingerprint className="w-4 h-4 text-brand-bright" aria-hidden="true" /> My session</h2>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 min-h-[44px] rounded-lg bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
        {sessionLoading ? (
          <p className="text-sm text-[var(--text-muted)]" aria-busy="true">Loading session...</p>
        ) : sessionError ? (
          <ErrorCard message={sessionError} onRetry={loadSession} />
        ) : !session ? (
          <p className="text-sm text-[var(--text-muted)]">No active session found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Signed in since', value: formatDateTime(session.signedInAt), sub: null },
              { label: 'Access token expires', value: formatDateTime(session.expiresAt), sub: relativeTo(session.expiresAt) },
              { label: 'Idle timeout', value: `${idleMinutes} minutes`, sub: 'Auto sign-out on inactivity' },
              { label: 'Sign-in method', value: session.provider === 'email' ? 'Email + password' : (session.provider || 'N/A'), sub: session.email },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)]">
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">{item.label}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{item.value}</p>
                {item.sub && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{item.sub}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* (b) Login history ---------------------------------------------------- */}
      <section className="card" aria-labelledby="sc-history">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 id="sc-history" className="text-h4 flex items-center gap-2"><Clock className="w-4 h-4 text-brand-bright" aria-hidden="true" /> Login history</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {isAdmin ? 'Sign-in and sign-out activity across all users.' : 'Your recent sign-in and sign-out activity.'}
              {historyCapped && ` Showing the latest ${LOGIN_HISTORY_LIMIT} events; narrow the dates to see older ones.`}
            </p>
          </div>
          <div className="w-40 shrink-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Logins, 14 days</p>
            <Sparkline byDay={summary.byDay} />
          </div>
        </div>

        {/* KPI strip over the loaded (bounded) history */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-4">
          <Tile icon={LogIn} label="Sign-ins" value={historyNa ?? kpis.logins} sub={`in the ${scopeLabel} events`} />
          <Tile icon={Users} label="Users" value={historyNa ?? kpis.users} sub="who signed in" />
          <Tile icon={Activity} label="Last 24 hours" value={historyNa ?? kpis.loginsLast24h} sub="sign-ins" />
          <Tile icon={Moon} label="After hours" value={historyNa ?? kpis.afterHours} sub="sign-ins outside 06:00 to 22:00" tone="text-yellow-400" />
          <Tile icon={Share2} label="Shared sessions" value={historyNa ?? kpis.sharedSessions} sub="one session, several users" tone="text-yellow-400" />
          <Tile icon={Clock} label="Last sign-in" value={historyNa ?? formatDateTime(kpis.lastLogin)} />
        </div>

        {/* Filters */}
        <div className="flex items-end gap-2 flex-wrap mt-4">
          <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
            Search
            <span className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="User or action"
                className={`${controlCls} pl-8 w-48 placeholder:text-[var(--text-dim)]`}
              />
            </span>
          </label>
          <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
            Event
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className={controlCls}>
              <option value="">All events</option>
              <option value="LOGIN">Sign-in</option>
              <option value="LOGOUT">Sign-out</option>
            </select>
          </label>
          {isAdmin && (
            <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
              User
              <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className={controlCls}>
                <option value="">All users</option>
                {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          )}
          <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
            From
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={controlCls} />
          </label>
          <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
            To
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={controlCls} />
          </label>
          {historyFiltered && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setUserFilter(''); setSearch(''); setActionFilter('') }}
              className="btn-secondary min-h-[44px] text-xs px-3"
            >
              Clear filters
            </button>
          )}
          <div className="ms-auto">
            <ExportButtons onExport={kind => exportRows(kind, 'history')} disabled={historyLoading || !!historyError || visibleRows.length === 0} />
          </div>
        </div>

        {/* Anomaly flags */}
        {summary.flags.length > 0 && (
          <ul className="flex items-center gap-2 flex-wrap mt-3" aria-label="Anomaly flags">
            {summary.flags.slice(0, 6).map((f, i) => (
              <li key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {f.type === 'shared_session'
                  ? `Session shared by ${f.users.length} users`
                  : `After-hours login: ${f.name}, ${formatDateTime(f.at)}`}
              </li>
            ))}
            {summary.flags.length > 6 && (
              <li className="text-[11px] text-[var(--text-muted)]">+{summary.flags.length - 6} more</li>
            )}
          </ul>
        )}

        <div className="mt-4">
          {historyError ? (
            <ErrorCard message={historyError} onRetry={loadHistory} />
          ) : (
            <EnterpriseTable
              columns={historyColumns}
              data={visibleRows}
              getRowId={r => String(r.id)}
              loading={historyLoading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              enableKeyboard={false}
              initialPageSize={25}
              emptyMessage={historyFiltered
                ? 'No sign-in events match these filters.'
                : 'No login events recorded yet. Sign-in and sign-out auditing records new events from now on.'}
            />
          )}
        </div>
      </section>

      {/* (c) Security events (admin only) ------------------------------------- */}
      {isAdmin && (
        <section className="card" aria-labelledby="sc-events">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 id="sc-events" className="text-h4 flex items-center gap-2"><Database className="w-4 h-4 text-brand-bright" aria-hidden="true" /> Security events</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Deletes, exports, uploads and bulk operations from the audit trail, last {SECURITY_EVENT_WINDOW_DAYS} days.
                {eventsCapped && ` Showing the latest ${LOGIN_HISTORY_LIMIT}; older events in the window were not read.`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-4">
            {(() => {
              const na = eventsLoading ? '...' : eventsError ? 'N/A' : null
              return (
                <>
                  <Tile icon={Activity} label="Sensitive actions" value={na ?? breakdown.total} sub={eventsCapped ? `latest ${LOGIN_HISTORY_LIMIT}` : `last ${SECURITY_EVENT_WINDOW_DAYS} days`} />
                  <Tile icon={Trash2} label="Deletes" value={na ?? breakdown.deletes} sub="single and bulk" tone="text-red-400" />
                  <Tile icon={Download} label="Exports" value={na ?? breakdown.exports} tone="text-purple-400" />
                  <Tile icon={Database} label="Bulk operations" value={na ?? breakdown.bulk} tone="text-orange-400" />
                  <Tile icon={Users} label="Most active" value={na ?? (breakdown.topActor ? breakdown.topActor.name : 'N/A')} sub={breakdown.topActor && !na ? `${breakdown.topActor.count} actions` : null} />
                </>
              )
            })()}
          </div>

          <div className="flex items-end gap-2 flex-wrap mt-4">
            <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
              Search
              <span className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" aria-hidden="true" />
                <input type="search" value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Who, table or record" className={`${controlCls} pl-8 w-52 placeholder:text-[var(--text-dim)]`} />
              </span>
            </label>
            <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-1">
              Action
              <select value={eventAction} onChange={e => setEventAction(e.target.value)} className={controlCls}>
                <option value="">All actions</option>
                {breakdown.byAction.map(a => <option key={a.action} value={a.action}>{a.action} ({a.count})</option>)}
              </select>
            </label>
            {(eventSearch || eventAction) && (
              <button onClick={() => { setEventSearch(''); setEventAction('') }} className="btn-secondary min-h-[44px] text-xs px-3">Clear filters</button>
            )}
            <div className="ms-auto">
              <ExportButtons onExport={kind => exportRows(kind, 'events')} disabled={eventsLoading || !!eventsError || visibleEvents.length === 0} />
            </div>
          </div>

          <div className="mt-4">
            {eventsError ? (
              <ErrorCard message={eventsError} onRetry={loadEvents} />
            ) : (
              <EnterpriseTable
                columns={eventColumns}
                data={visibleEvents}
                getRowId={r => String(r.id)}
                loading={eventsLoading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                enableKeyboard={false}
                initialPageSize={25}
                emptyMessage={(eventSearch || eventAction)
                  ? 'No security events match these filters.'
                  : `No sensitive actions recorded in the last ${SECURITY_EVENT_WINDOW_DAYS} days.`}
              />
            )}
          </div>
        </section>
      )}

      {/* (d) Account security checklist ---------------------------------------- */}
      <section className="card" aria-labelledby="sc-checklist">
        <h2 id="sc-checklist" className="text-h4 flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-brand-bright" aria-hidden="true" /> Account security checklist</h2>
        <p className="text-xs text-[var(--text-muted)] mb-4">Truthful status of the controls enforced in this deployment.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChecklistItem
            icon={UserCheck}
            title="Admin approval gate"
            status="ok" statusLabel="Active"
            detail="New accounts cannot sign in until an admin approves them. Unapproved and locked accounts are signed out immediately."
          />
          <ChecklistItem
            icon={Lock}
            title="Account locking"
            status="ok" statusLabel="Available"
            detail="Admins can lock any account from User Management; locked accounts are force-signed-out on their next request."
          />
          <ChecklistItem
            icon={Database}
            title="Row Level Security (RLS)"
            status="ok" statusLabel="Enforced"
            detail="Data access is enforced at the database layer by Supabase RLS policies. The UI role gating is a convenience on top, not the boundary."
          />
          <ChecklistItem
            icon={Clock}
            title="Session idle timeout"
            status="ok" statusLabel={`${idleMinutes} min`}
            detail={`You are signed out automatically after ${idleMinutes} minutes of inactivity. The timer is kept in memory and cannot be bypassed via localStorage.`}
          />
          <ChecklistItem
            icon={KeyRound}
            title="Password policy"
            status="baseline" statusLabel={`Min ${policy.minLength} chars`}
            detail={`Enforced today: ${policy.enforced.map(e => e.rule.toLowerCase()).join(', ')} (Supabase Auth default). Not enforced: complexity, rotation, breach checks. Recommendation: ${policy.recommendation}`}
          />
          <ChecklistItem
            icon={Fingerprint}
            title="Two-factor authentication (TOTP)"
            status={mfaEnabled ? 'ok' : 'recommend'}
            statusLabel={mfaEnabled ? 'Enabled' : 'Recommended'}
            detail={mfaEnabled
              ? 'Your account is protected by an authenticator-app second factor via Supabase Auth MFA.'
              : 'Not enabled for your account. Set it up under Settings, Two-Factor Authentication (Supabase Auth TOTP), for a second layer of protection.'}
          />
        </div>
      </section>
    </div>
  )
}
