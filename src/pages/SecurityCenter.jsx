/**
 * SecurityCenter.jsx — security posture page (roadmap #24), route /security-center.
 *
 * Sections:
 *   a) My session       — sign-in time, token expiry, idle timeout, sign out
 *   b) Login history    — LOGIN/LOGOUT audit rows + 14-day sparkline + anomaly flags
 *   c) Security events  — deletes / exports / bulk actions, last 30 days (admin only)
 *   d) Security checklist — truthful status of the controls actually in place
 *
 * Renders for all authenticated users; admin-only sections are hidden for
 * everyone else (RLS remains the hard boundary — this gating is UX only).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldCheck, LogOut, Clock, KeyRound, Fingerprint, UserCheck, Lock,
  Database, AlertTriangle, Download, Trash2, Upload, LogIn, Search,
  CheckCircle, Info, RefreshCw,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import {
  fetchLoginHistory,
  fetchRecentSecurityEvents,
  getSessionInfo,
  summarizeLogins,
  getPasswordPolicy,
  IDLE_TIMEOUT_MS,
  SECURITY_EVENT_WINDOW_DAYS,
} from '../lib/securityCenter'

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDateTime(iso, na = 'n/a') {
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
      <Icon className="w-3 h-3" /> {action}
    </span>
  )
}

function actorName(row) {
  return row?.profiles?.full_name || row?.profiles?.username || row?.user_email || 'Unknown'
}

// ── Small building blocks ─────────────────────────────────────────────────────

function Sparkline({ byDay }) {
  const max = Math.max(1, ...byDay.map(d => d.count))
  return (
    <div className="flex items-end gap-1 h-12" title="Logins per day (last 14 days)">
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

function StateCard({ children }) {
  return <div className="card text-center py-10 text-sm text-[var(--text-muted)]">{children}</div>
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="card text-center py-10">
      <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
      <p className="text-sm text-red-400 mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      )}
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
        <Icon className="w-4.5 h-4.5 text-brand-bright" style={{ width: 18, height: 18 }} />
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SecurityCenter() {
  const { user, profile, signOut, mfaEnabled } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  // Session card
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  // Login history
  const [rows, setRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [userFilter, setUserFilter] = useState('')   // admin-only: '' = all users
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  // Security events (admin only)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState(null)

  const [updatedAt, setUpdatedAt] = useState(null)

  const loadSession = useCallback(async () => {
    setSessionLoading(true)
    try { setSession(await getSessionInfo()) }
    catch { setSession(null) }
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
      setHistoryError(err?.message || 'Failed to load login history')
    } finally {
      setHistoryLoading(false)
    }
  }, [isAdmin, userFilter, dateFrom, dateTo, user?.id])

  const loadEvents = useCallback(async () => {
    if (!isAdmin) { setEventsLoading(false); return }
    setEventsLoading(true)
    setEventsError(null)
    try { setEvents(await fetchRecentSecurityEvents()) }
    catch (err) { setEventsError(err?.message || 'Failed to load security events') }
    finally { setEventsLoading(false) }
  }, [isAdmin])

  useEffect(() => { loadSession() }, [loadSession])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { loadEvents() }, [loadEvents])

  const refreshAll = useCallback(() => { loadSession(); loadHistory(); loadEvents() }, [loadSession, loadHistory, loadEvents])

  const summary = useMemo(() => summarizeLogins(rows), [rows])
  const policy = useMemo(() => getPasswordPolicy(), [])

  // Admin user filter options, derived from loaded rows (no extra query).
  const userOptions = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (r.user_id && !map.has(r.user_id)) map.set(r.user_id, actorName(r))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter(r =>
      actorName(r).toLowerCase().includes(q) ||
      (r.user_email || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q),
    )
  }, [rows, search])

  async function handleSignOut() {
    setSigningOut(true)
    try { await signOut() } finally { setSigningOut(false) }
  }

  const idleMinutes = Math.round(IDLE_TIMEOUT_MS / 60000)

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

      {/* (a) My session ------------------------------------------------------ */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-h4 flex items-center gap-2"><Fingerprint className="w-4 h-4 text-brand-bright" /> My session</h2>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {sessionLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading session…</p>
        ) : !session ? (
          <p className="text-sm text-[var(--text-muted)]">No active session found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Signed in since', value: formatDateTime(session.signedInAt), sub: null },
              { label: 'Access token expires', value: formatDateTime(session.expiresAt), sub: relativeTo(session.expiresAt) },
              { label: 'Idle timeout', value: `${idleMinutes} minutes`, sub: 'Auto sign-out on inactivity' },
              { label: 'Sign-in method', value: session.provider === 'email' ? 'Email + password' : session.provider, sub: session.email },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)]">
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">{item.label}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{item.value}</p>
                {item.sub && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{item.sub}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* (b) Login history ---------------------------------------------------- */}
      <div className="card p-0 overflow-hidden">
        <div className="p-5 border-b border-[var(--input-border)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-h4 flex items-center gap-2"><Clock className="w-4 h-4 text-brand-bright" /> Login history</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {isAdmin ? 'Sign-in and sign-out activity across all users.' : 'Your recent sign-in and sign-out activity.'}
              </p>
            </div>
            <div className="w-40 shrink-0">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Logins · 14 days</p>
              <Sparkline byDay={summary.byDay} />
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap mt-4">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search user or action…"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-brand-bright/50 w-48"
              />
            </div>
            {isAdmin && (
              <select
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="">All users</option>
                {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none" />
            <span className="text-xs text-[var(--text-dim)]">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none" />
            {(dateFrom || dateTo || userFilter || search) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setUserFilter(''); setSearch('') }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Anomaly flags */}
          {summary.flags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {summary.flags.slice(0, 6).map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400">
                  <AlertTriangle className="w-3 h-3" />
                  {f.type === 'shared_session'
                    ? `Session shared by ${f.users.length} users`
                    : `After-hours login · ${f.name} · ${formatDateTime(f.at)}`}
                </span>
              ))}
              {summary.flags.length > 6 && (
                <span className="text-[11px] text-[var(--text-muted)]">+{summary.flags.length - 6} more</span>
              )}
            </div>
          )}
        </div>

        {historyError ? (
          <div className="p-5"><ErrorCard message={historyError} onRetry={loadHistory} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--input-border)]">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">When</th>
                  <th className="px-5 py-3 font-semibold hidden md:table-cell">Session</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">Loading login history…</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">
                      No login events recorded yet.
                      <span className="block text-xs mt-1 text-[var(--text-dim)]">
                        Sign-in/sign-out auditing records new events from now on — history builds up as users log in.
                      </span>
                    </td>
                  </tr>
                ) : visibleRows.map(r => (
                  <tr key={r.id} className="border-b border-[var(--input-border)] last:border-0 hover:bg-[var(--input-bg)] transition-colors">
                    <td className="px-5 py-2.5">
                      <span className="text-[var(--text-primary)] font-medium">{actorName(r)}</span>
                      {r.user_email && <span className="block text-xs text-[var(--text-dim)]">{r.user_email}</span>}
                    </td>
                    <td className="px-5 py-2.5"><ActionBadge action={r.action} /></td>
                    <td className="px-5 py-2.5 text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    <td className="px-5 py-2.5 hidden md:table-cell">
                      <span className="text-xs font-mono text-[var(--text-dim)]">{r.session_id ? String(r.session_id).slice(0, 8) : '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* (c) Security events (admin only) ------------------------------------- */}
      {isAdmin && (
        <div className="card p-0 overflow-hidden">
          <div className="p-5 border-b border-[var(--input-border)]">
            <h2 className="text-h4 flex items-center gap-2"><Database className="w-4 h-4 text-brand-bright" /> Security events</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Deletes, exports, uploads and bulk operations from the audit trail — last {SECURITY_EVENT_WINDOW_DAYS} days.
            </p>
          </div>
          {eventsError ? (
            <div className="p-5"><ErrorCard message={eventsError} onRetry={loadEvents} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--input-border)]">
                    <th className="px-5 py-3 font-semibold">Who</th>
                    <th className="px-5 py-3 font-semibold">Action</th>
                    <th className="px-5 py-3 font-semibold">What</th>
                    <th className="px-5 py-3 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsLoading ? (
                    <tr><td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">Loading security events…</td></tr>
                  ) : events.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">No sensitive actions recorded in the last {SECURITY_EVENT_WINDOW_DAYS} days.</td></tr>
                  ) : events.map(ev => (
                    <tr key={ev.id} className="border-b border-[var(--input-border)] last:border-0 hover:bg-[var(--input-bg)] transition-colors">
                      <td className="px-5 py-2.5">
                        <span className="text-[var(--text-primary)] font-medium">{actorName(ev)}</span>
                        {ev.user_email && <span className="block text-xs text-[var(--text-dim)]">{ev.user_email}</span>}
                      </td>
                      <td className="px-5 py-2.5"><ActionBadge action={ev.action} /></td>
                      <td className="px-5 py-2.5 text-[var(--text-muted)]">
                        {ev.table_name || '—'}
                        {ev.record_id && <span className="text-xs text-[var(--text-dim)] font-mono ml-1.5">#{String(ev.record_id).slice(0, 12)}</span>}
                      </td>
                      <td className="px-5 py-2.5 text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(ev.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* (d) Account security checklist ---------------------------------------- */}
      <div className="card">
        <h2 className="text-h4 flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-brand-bright" /> Account security checklist</h2>
        <p className="text-xs text-[var(--text-muted)] mb-4">Truthful status of the controls enforced in this deployment.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChecklistItem
            icon={UserCheck}
            title="Admin approval gate"
            status="ok" statusLabel="Active"
            detail="New accounts cannot sign in until an admin approves them — unapproved and locked accounts are signed out immediately."
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
            detail="Data access is enforced at the database layer by Supabase RLS policies — the UI role gating is a convenience on top, not the boundary."
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
              : 'Not enabled for your account. Set it up under Settings → Two-Factor Authentication (Supabase Auth TOTP) for a second layer of protection.'}
          />
        </div>
      </div>
    </div>
  )
}
