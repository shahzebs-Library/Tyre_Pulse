/**
 * My reported problems - the reporter's own view of "Report a problem".
 *
 * Any signed-in user. Reads user_issues filtered to reporter_id = me (RLS already
 * limits a normal user to their own rows; the explicit filter keeps an Admin's
 * page personal too). History comes from user_issue_events under the same RLS.
 * Nothing here writes: triage belongs to the console Error Center.
 *
 * Honest rendering: a missing target time or version is "N/A"; an unloadable
 * list shows an error with Retry, never an empty list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LifeBuoy, Search, AlertTriangle, RefreshCw, ChevronDown, CheckCircle2, Clock } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import ReportProblemDialog from '../components/support/ReportProblemDialog'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { listMyIssues, listIssueEvents } from '../lib/api/userIssues'
import {
  ISSUE_STATUSES, statusLabel, severityLabel, categoryLabel, platformLabel,
  isOpenStatus, slaState, myIssueCounts, describeIssueEvent,
} from '../lib/problemReport'

function tx(t, key, fallback, vars) {
  const v = typeof t === 'function' ? t(key, vars) : undefined
  if (!v || v === key) {
    if (!vars) return fallback
    return fallback.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  }
  return v
}

const fmtDate = (d) => {
  if (!d) return 'N/A'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? 'N/A'
    : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_TONE = {
  new: 'border-sky-500/40 text-sky-400',
  triaged: 'border-indigo-500/40 text-indigo-400',
  in_progress: 'border-amber-500/40 text-amber-400',
  waiting_user: 'border-purple-500/40 text-purple-400',
  fixed: 'border-emerald-500/40 text-emerald-400',
  closed: 'border-[var(--border-subtle)] text-[var(--text-muted)]',
  wont_fix: 'border-[var(--border-subtle)] text-[var(--text-muted)]',
}

export default function MyProblems() {
  const { user, profile } = useAuth() || {}
  const { t } = useLanguage()
  const uid = user?.id || profile?.id || null

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [history, setHistory] = useState({})
  const [reporting, setReporting] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      setRows(await listMyIssues(uid))
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || tx(t, 'shell.myProblemsLoadError', 'Your reported problems could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [uid, t])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => myIssueCounts(rows), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (status === 'open' && !isOpenStatus(r.status)) return false
      if (status && status !== 'open' && r.status !== status) return false
      if (q) {
        const hay = [r.description, r.page_or_screen, r.reference_id, r.app_version, r.fixed_in_version]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, status])

  async function toggleHistory(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (history[id]?.rows) return
    setHistory((h) => ({ ...h, [id]: { loading: true } }))
    try {
      const ev = await listIssueEvents(id)
      setHistory((h) => ({ ...h, [id]: { rows: ev } }))
    } catch (err) {
      setHistory((h) => ({ ...h, [id]: { error: err?.message || 'The history could not be loaded.' } }))
    }
  }

  const kpis = [
    { key: 'total', label: tx(t, 'shell.myProblemsTotal', 'Reported'), value: counts.total },
    { key: 'open', label: tx(t, 'shell.myProblemsOpen', 'Still open'), value: counts.open },
    { key: 'fixed', label: tx(t, 'shell.myProblemsFixed', 'Fixed'), value: counts.fixed },
    { key: 'late', label: tx(t, 'shell.myProblemsLate', 'Past target time'), value: counts.late, warn: counts.late > 0 },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={tx(t, 'shell.myProblems', 'My reported problems')}
        subtitle={tx(t, 'shell.myProblemsSubtitle', 'Everything you reported, what the support team did and when it was fixed.')}
        icon={LifeBuoy}
        showBack
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
        actions={(
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-green-700 hover:bg-green-600 min-h-[44px]"
          >
            <LifeBuoy size={15} aria-hidden="true" />
            {tx(t, 'shell.reportProblem', 'Report a problem')}
          </button>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.key} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{k.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${k.warn ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
              {loading && !rows.length ? 'N/A' : k.value}
            </p>
          </div>
        ))}
      </div>

      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">{tx(t, 'shell.myProblemsSearch', 'Search your reports')}</span>
          <Search size={15} aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tx(t, 'shell.myProblemsSearch', 'Search your reports')}
            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] ps-9 pe-3 py-2 text-sm text-[var(--text-primary)] min-h-[44px]"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">{tx(t, 'shell.myProblemsAllStatuses', 'All statuses')}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] min-h-[44px]"
          >
            <option value="">{tx(t, 'shell.myProblemsAllStatuses', 'All statuses')}</option>
            <option value="open">{tx(t, 'shell.myProblemsOpenOnly', 'Open only')}</option>
            {ISSUE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <div role="alert" className="card p-6 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={22} aria-hidden="true" className="text-red-400" />
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm min-h-[44px] text-[var(--text-primary)]">
            <RefreshCw size={14} aria-hidden="true" /> {tx(t, 'shell.myProblemsRetry', 'Try again')}
          </button>
        </div>
      ) : loading && !rows.length ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
        </div>
      ) : !filtered.length ? (
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]">
          {rows.length
            ? tx(t, 'shell.myProblemsNoMatch', 'No report matches these filters.')
            : tx(t, 'shell.myProblemsEmpty', 'You have not reported any problems yet.')}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            const sla = slaState(r)
            const open = expanded === r.id
            const h = history[r.id]
            return (
              <li key={r.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status] || STATUS_TONE.closed}`}>
                    {statusLabel(r.status)}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {severityLabel(r.severity)} | {categoryLabel(r.category)} | {platformLabel(r.platform)}
                  </span>
                  {isOpenStatus(r.status) && sla === 'breached' && (
                    <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                      {tx(t, 'shell.myProblemsLate', 'Past target time')}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-[var(--text-primary)] break-words whitespace-pre-wrap">{r.description}</p>
                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-[var(--text-dim)]">{tx(t, 'shell.myProblemsReported', 'Reported')}</dt>
                    <dd className="text-[var(--text-secondary)]">{fmtDate(r.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-dim)]">{tx(t, 'shell.myProblemsTarget', 'Target time')}</dt>
                    <dd className="text-[var(--text-secondary)] inline-flex items-center gap-1">
                      <Clock size={12} aria-hidden="true" /> {fmtDate(r.sla_due_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-dim)]">{tx(t, 'shell.myProblemsFixedIn', 'Fixed in version')}</dt>
                    <dd className="text-[var(--text-secondary)]">{r.fixed_in_version || 'N/A'}</dd>
                  </div>
                </dl>
                {r.status === 'fixed' && r.fixed_in_version && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 size={13} aria-hidden="true" />
                    {tx(t, 'shell.myProblemsUpdateHint', 'Update the app to version {version} or later to get the fix.', { version: r.fixed_in_version })}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => toggleHistory(r.id)}
                  aria-expanded={open}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-h-[44px]"
                >
                  <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                  {open ? tx(t, 'shell.myProblemsHideHistory', 'Hide history') : tx(t, 'shell.myProblemsHistory', 'History')}
                </button>
                {open && (
                  <div className="mt-2 border-s-2 border-[var(--border-subtle)] ps-3 space-y-2">
                    {h?.loading && <p className="text-xs text-[var(--text-muted)]">...</p>}
                    {h?.error && <p role="alert" className="text-xs text-red-400">{h.error}</p>}
                    {h?.rows && !h.rows.length && (
                      <p className="text-xs text-[var(--text-muted)]">{tx(t, 'shell.myProblemsHistoryEmpty', 'No history yet.')}</p>
                    )}
                    {h?.rows?.map((ev) => (
                      <div key={ev.id} className="text-xs">
                        <p className="text-[var(--text-secondary)]">{describeIssueEvent(ev)}</p>
                        <p className="text-[var(--text-dim)]">{fmtDate(ev.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ReportProblemDialog open={reporting} onClose={() => { setReporting(false); load() }} />
    </div>
  )
}
