/**
 * HelpCenter — the in-app Help & Support hub (route /help).
 *
 * Three surfaces in one page:
 *   • FAQs           — searchable, category-grouped knowledge base.
 *   • Report an issue — raise a support ticket (bug / question / feature …) that
 *                       lands with the org's administrators.
 *   • My tickets     — track the status + admin response on your own tickets.
 *   • Triage         — Admin/Manager/Director only: respond to and resolve all
 *                       tickets in the organisation.
 *
 * Real data, search, filters, actions and loading/empty/error states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LifeBuoy, Search, ChevronDown, Send, Inbox, ShieldQuestion, Bug, Lightbulb,
  Database, UserCog, HelpCircle, CheckCircle2, Clock, Loader2, RefreshCw,
  AlertTriangle, MessageSquare, X, Download, FileText, Plus,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext'
import ReportProblemDialog from '../components/support/ReportProblemDialog'
import HelpOverview from '../components/support/HelpOverview'
import { scopedHelp } from '../lib/helpHub'
import './helpCenter.css'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  ticketKpis, filterTickets, sortTickets, ticketExportRows, TICKET_EXPORT_COLUMNS,
  CATEGORY_LABELS, STATUS_LABELS, responseHours, ageDays, formatHours,
} from '../lib/helpCenterAnalytics'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTickets, createTicket, respondToTicket, updateTicket,
  TICKET_CATEGORIES, TICKET_SEVERITIES,
} from '../lib/api/support'
import { searchFaqs, groupFaqsByCategory } from '../lib/help/faqs'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const CATEGORY_META = {
  bug: { label: 'Bug / Error', icon: Bug, tint: 'text-red-400' },
  question: { label: 'Question', icon: HelpCircle, tint: 'text-sky-400' },
  feature: { label: 'Feature request', icon: Lightbulb, tint: 'text-amber-400' },
  data: { label: 'Data / Import', icon: Database, tint: 'text-violet-400' },
  account: { label: 'Account / Access', icon: UserCog, tint: 'text-emerald-400' },
  other: { label: 'Other', icon: ShieldQuestion, tint: 'text-[var(--text-muted)]' },
}
const SEVERITY_META = {
  low: 'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  medium: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  high: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  critical: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_META = {
  open: { label: 'Open', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Inbox },
  in_progress: { label: 'In progress', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', icon: Clock },
  resolved: { label: 'Resolved', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  closed: { label: 'Closed', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: X },
}
const TRIAGE_ROLES = ['Admin', 'Manager', 'Director']

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

// ─── FAQ accordion ────────────────────────────────────────────────────────────
function FaqItem({ faq }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--input-border)] rounded-lg overflow-hidden bg-[var(--card-bg)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--input-bg)] transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">{faq.q}</span>
        <ChevronDown size={16} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--input-border)]/60">
          <p className="pt-3">{faq.a}</p>
        </div>
      )}
    </div>
  )
}

function FaqPanel({ onAskInstead, scoped, query, activeCat, setActiveCat }) {
  const categories = useMemo(() => {
    const present = new Set(scoped.map((f) => f.category))
    return [...present]
  }, [scoped])
  const results = useMemo(() => {
    let list = searchFaqs(query, scoped)
    if (activeCat !== 'All') list = list.filter((f) => activeCat.split('|').includes(f.category))
    return groupFaqsByCategory(list)
  }, [query, activeCat, scoped])
  const total = results.reduce((n, [, list]) => n + list.length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {['All', ...categories].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActiveCat(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              activeCat === c
                ? 'bg-[var(--brand-subtle)] text-[var(--brand-bright)] border-[var(--brand-bright)]'
                : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {total === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <HelpCircle size={28} className="mx-auto text-[var(--text-muted)]" />
          <p className="text-[var(--text-primary)] font-medium">No articles match “{query}”.</p>
          <p className="text-sm text-[var(--text-muted)]">Can’t find an answer? Report it and we’ll help.</p>
          <button className="btn-primary text-sm inline-flex items-center gap-2" onClick={onAskInstead}>
            <Send size={14} /> Report an issue
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {results.map(([cat, list]) => (
            <div key={cat} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{cat}</h3>
              <div className="space-y-2">
                {list.map((f) => <FaqItem key={f.id} faq={f} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Report-an-issue form ─────────────────────────────────────────────────────
function ReportForm({ onSubmitted, onViewTickets }) {
  const { profile } = useAuth()
  const { activeCountry } = useSettings() || {}
  const [form, setForm] = useState({ subject: '', category: 'question', severity: 'medium', message: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.subject.trim()) { setError('Please add a short subject.'); return }
    if (!form.message.trim()) { setError('Please describe the issue.'); return }
    setBusy(true)
    try {
      const country = profile?.country && !Array.isArray(profile.country) ? profile.country
        : Array.isArray(profile?.country) ? profile.country[0] : (activeCountry !== 'All' ? activeCountry : null)
      await createTicket({
        ...form,
        country,
        page_url: typeof window !== 'undefined' ? window.location.href : null,
        created_by_name: profile?.full_name || profile?.username || null,
        created_by_email: profile?.email || null,
        app_context: {
          role: profile?.role || null,
          site: profile?.site || null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
      })
      setDone(true)
      setForm({ subject: '', category: 'question', severity: 'medium', message: '' })
      onSubmitted?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not submit your ticket. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, profile, activeCountry, onSubmitted])

  if (done) {
    return (
      <div className="card text-center py-10 space-y-3">
        <CheckCircle2 size={32} className="mx-auto text-green-400" />
        <p className="text-[var(--text-primary)] font-semibold">Thanks, your issue has been sent.</p>
        <p className="text-sm text-[var(--text-muted)]">Your support request was saved. Follow its status and support response under My support requests.</p>
        <button className="btn-secondary text-sm" onClick={() => setDone(false)}>Ask another question</button>
        <button type="button" className="btn-primary text-sm" onClick={onViewTickets}>My support requests</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-4 max-w-2xl">
      <div>
        <label className="label" htmlFor="help-subject">Subject</label>
        <input
          className="input w-full"
          id="help-subject" placeholder="Briefly, what is your question?"
          value={form.subject}
          maxLength={200}
          onChange={(e) => set('subject', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="help-category">Category</label>
          <select id="help-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c]?.label || c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="help-severity">Severity</label>
          <select id="help-severity" className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
            {TICKET_SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Details</label>
        <textarea
          className="input w-full min-h-[140px] resize-y"
          placeholder="What happened, what did you expect, and how can we reproduce it? Include the page/asset if relevant."
          id="help-message" value={form.message}
          maxLength={8000}
          onChange={(e) => set('message', e.target.value)}
        />
      </div>
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {busy ? 'Sending…' : 'Submit issue'}
        </button>
        <span className="text-xs text-[var(--text-muted)]">Sent to your organisation’s administrators.</span>
      </div>
    </form>
  )
}

// ─── Ticket card (shared by My tickets + Triage) ──────────────────────────────
function TicketCard({ ticket, triage, onChanged, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cat = CATEGORY_META[ticket.category] || CATEGORY_META.other
  const CatIcon = cat.icon
  const status = STATUS_META[ticket.status] || STATUS_META.open
  const StatusIcon = status.icon

  const act = useCallback(async (fn) => {
    setBusy(true); setErr('')
    try { const row = await fn(); onChanged?.(row) } catch (e) { setErr(toUserMessage(e, 'Action failed.')) } finally { setBusy(false) }
  }, [onChanged])

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => setExpanded((o) => !o)} aria-expanded={expanded} className="flex items-start gap-3 text-left flex-1 min-w-0 min-h-[44px]">
          <CatIcon size={18} className={`mt-0.5 shrink-0 ${cat.tint}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{ticket.subject}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {cat.label} · {fmtDateTime(ticket.created_at)}
              {triage && ticket.created_by_name ? ` · ${ticket.created_by_name}` : ''}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_META[ticket.severity] || SEVERITY_META.medium}`}>{ticket.severity}</span>
          <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${status.cls}`}>
            <StatusIcon size={11} /> {status.label}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 pt-1 border-t border-[var(--input-border)]/60">
          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap pt-3">{ticket.message}</p>

          {ticket.admin_response && (
            <div className="bg-[var(--brand-subtle)]/40 border border-[var(--brand-bright)]/30 rounded-lg px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--brand-bright)] flex items-center gap-1.5">
                <MessageSquare size={12} /> Support response
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">{ticket.admin_response}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">{fmtDateTime(ticket.responded_at)}</p>
            </div>
          )}

          {ticket.page_url && (
            <p className="text-[11px] text-[var(--text-muted)] break-all">Reported from: {ticket.page_url}</p>
          )}

          {triage && (
            <div className="space-y-2">
              <textarea
                className="input w-full min-h-[80px] resize-y text-sm"
                placeholder="Write a response to the reporter"
                aria-label="Response to the reporter"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button" disabled={busy || !reply.trim()}
                  onClick={() => act(() => respondToTicket(ticket.id, reply, { status: 'in_progress' }))}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send size={13} /> Respond
                </button>
                <button
                  type="button" disabled={busy}
                  onClick={() => act(() => updateTicket(ticket.id, { status: 'resolved', ...(reply.trim() ? { admin_response: reply } : {}) }))}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 size={13} /> Resolve
                </button>
                <select
                  className="input text-xs py-1" value={ticket.status}
                  onChange={(e) => act(() => updateTicket(ticket.id, { status: e.target.value }))}
                  disabled={busy}
                  aria-label="Change status"
                >
                  {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </div>
              {err && <p className="text-xs text-red-300">{err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PAGE_LIMIT = 500
const TICKET_STATUS_FILTERS = [['all', 'All'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['closed', 'Closed']]

function TicketKpi({ label, value, sub }) {
  return (
    <div className="card !p-4 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1.5">{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

function TicketList({ triage, reloadKey, emptyHint, initialSelectedId = null }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [search, setSearch] = useState('')
  const [awaiting, setAwaiting] = useState(false)
  const [view, setView] = useState('cards')
  const [selectedId, setSelectedId] = useState(initialSelectedId)

  const load = useCallback(async () => {
    setError('')
    setRows(null)
    try {
      setRows(await listTickets(triage ? { limit: PAGE_LIMIT } : { mine: true, limit: PAGE_LIMIT }))
    } catch (err) {
      setError(isMissingRelation(err) ? 'missing' : (toUserMessage(err, 'Could not load tickets.')))
      setRows([])
    }
  }, [triage])

  useEffect(() => { load() }, [load, reloadKey])

  const kpi = useMemo(() => ticketKpis(rows || []), [rows])
  const filtered = useMemo(
    () => sortTickets(filterTickets(rows || [], { status: statusFilter, category, severity, search, awaiting })),
    [rows, statusFilter, category, severity, search, awaiting],
  )
  const filtersActive = statusFilter !== 'all' || category !== 'all' || severity !== 'all' || Boolean(search) || awaiting
  const selected = useMemo(() => (rows || []).find((r) => r.id === selectedId) || null, [rows, selectedId])

  const patchRow = useCallback((updated) => {
    if (!updated) return
    setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
  }, [])

  function clearFilters() {
    setStatusFilter('all'); setCategory('all'); setSeverity('all'); setSearch(''); setAwaiting(false)
  }

  async function doExport(kind) {
    const { exportToExcel, exportToPdf, reportFileName, reportDateLabel } = await import('../lib/exportUtils')
    const out = ticketExportRows(filtered)
    const name = reportFileName('TyrePulse Support Tickets', triage ? 'Triage' : 'Mine', reportDateLabel())
    if (kind === 'excel') {
      exportToExcel(out, TICKET_EXPORT_COLUMNS.map((c) => c.key), TICKET_EXPORT_COLUMNS.map((c) => c.header), name)
    } else {
      exportToPdf(out, TICKET_EXPORT_COLUMNS, triage ? 'Support Tickets (Triage)' : 'My Support Tickets', name, 'landscape', '',
        { subtitleNote: `${filtered.length} of ${(rows || []).length} tickets${filtersActive ? ' (filtered)' : ''}` })
    }
  }

  const columns = useMemo(() => [
    {
      id: 'created', header: 'Raised', accessorFn: (r) => r.created_at || '', size: 150,
      cell: ({ row }) => fmtDateTime(row.original.created_at),
    },
    {
      id: 'subject', header: 'Subject', accessorFn: (r) => r.subject || '', size: 280,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.subject}</span>,
    },
    { id: 'category', header: 'Category', accessorFn: (r) => CATEGORY_LABELS[r.category] || 'Other', size: 140 },
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => r.severity || '', size: 100,
      cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_META[row.original.severity] || SEVERITY_META.medium}`}>{row.original.severity}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABELS[r.status] || r.status, size: 120,
      cell: ({ row }) => {
        const st = STATUS_META[row.original.status] || STATUS_META.open
        return <span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
      },
    },
    ...(triage ? [{ id: 'reporter', header: 'Reporter', accessorFn: (r) => r.created_by_name || 'N/A', size: 140 }] : []),
    {
      id: 'response', header: 'Time to response', accessorFn: (r) => responseHours(r) ?? -1, size: 130, meta: { align: 'right' },
      cell: ({ row }) => formatHours(responseHours(row.original)),
    },
    {
      id: 'age', header: 'Open for', accessorFn: (r) => ageDays(r) ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => { const d = ageDays(row.original); return d == null ? 'N/A' : `${d} d` },
    },
  ], [triage])

  if (error === 'missing') {
    return <div role="alert" className="card space-y-3">
      <p className="text-sm text-[var(--text-secondary)]">Support requests are temporarily unavailable. Please try again or report the problem.</p>
      <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-2"><RefreshCw size={14} /> Retry</button>
    </div>
  }

  if (error) {
    return (
      <div role="alert" className="card text-center py-10 space-y-2">
        <AlertTriangle size={26} className="mx-auto text-red-400" aria-hidden="true" />
        <p className="text-[var(--text-primary)] font-medium">Tickets could not be loaded.</p>
        <p className="text-sm text-[var(--text-muted)]">{error} No ticket list is shown until it can be read.</p>
        <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] px-3">
          <RefreshCw size={13} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }

  if (rows === null) {
    return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card animate-pulse h-20" />)}</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <TicketKpi label="Unresolved" value={kpi.unresolved} sub={`${kpi.total} tickets in total`} />
        <TicketKpi label="High or critical open" value={kpi.criticalOpen} sub="Needs attention first" />
        <TicketKpi label="Awaiting response" value={kpi.awaitingResponse} sub="Unresolved, no reply yet" />
        <TicketKpi label="Median time to response" value={formatHours(kpi.medianResponseHours)} sub="Raised to first reply" />
        <TicketKpi label="Resolved rate" value={kpi.resolvedRate == null ? 'N/A' : `${kpi.resolvedRate}%`} sub={`Median to resolve ${formatHours(kpi.medianResolutionHours)}`} />
        <TicketKpi label="Oldest open" value={kpi.oldestOpenDays == null ? 'N/A' : `${kpi.oldestOpenDays} d`} sub={`${kpi.staleOpen} open 7 days or more`} />
      </div>

      {kpi.byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]" aria-label="Tickets by category">
          {kpi.byCategory.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(category === c.key ? 'all' : c.key)}
              aria-pressed={category === c.key}
              className={`px-3 min-h-[36px] rounded-full border transition-colors ${category === c.key ? 'border-[var(--brand-bright)] text-[var(--brand-bright)]' : 'border-[var(--input-border)] hover:text-[var(--text-primary)]'}`}
            >
              {c.label}: <span className="tabular-nums">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {TICKET_STATUS_FILTERS.map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatusFilter(k)}
            aria-pressed={statusFilter === k}
            className={`px-3 min-h-[40px] rounded-full text-xs font-medium border transition-colors ${
              statusFilter === k
                ? 'bg-[var(--brand-subtle)] text-[var(--brand-bright)] border-[var(--brand-bright)]'
                : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
            }`}
          >
            {lbl} ({k === 'all' ? kpi.total : kpi[k]})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input className="input pl-8 text-sm min-h-[44px]" placeholder="Search subject, message, reporter" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search tickets" />
        </div>
        <select className="input text-sm w-auto min-h-[44px]" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
        </select>
        <select className="input text-sm w-auto min-h-[44px]" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity">
          <option value="all">All severities</option>
          {TICKET_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="text-xs text-[var(--text-secondary)] inline-flex items-center gap-1.5 min-h-[44px]">
          <input type="checkbox" checked={awaiting} onChange={(e) => setAwaiting(e.target.checked)} /> Awaiting response
        </label>
        {filtersActive && (
          <button type="button" onClick={clearFilters} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 min-h-[44px] px-2">
            <X size={12} aria-hidden="true" /> Clear
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden" role="group" aria-label="View">
            {[['cards', 'Cards'], ['table', 'Table']].map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                className={`px-3 min-h-[44px] text-xs font-medium ${view === k ? 'bg-[var(--brand-subtle)] text-[var(--brand-bright)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => doExport('excel')} disabled={!filtered.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] px-3 disabled:opacity-40">
            <Download size={13} aria-hidden="true" /> Excel
          </button>
          <button type="button" onClick={() => doExport('pdf')} disabled={!filtered.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] px-3 disabled:opacity-40">
            <FileText size={13} aria-hidden="true" /> PDF
          </button>
          <button type="button" onClick={load} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] px-3">
            <RefreshCw size={13} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {rows.length >= PAGE_LIMIT && (
        <p role="status" className="text-xs text-amber-400">Showing the newest {PAGE_LIMIT} tickets. Figures above cover that set.</p>
      )}

      {filtered.length === 0 ? (
        <div className="card text-center py-10 space-y-2">
          <Inbox size={26} className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium">{filtersActive ? 'No tickets match these filters.' : 'No tickets here.'}</p>
          <p className="text-sm text-[var(--text-muted)]">{filtersActive ? 'Clear a filter to see more.' : emptyHint}</p>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-xs min-h-[44px] px-3">Clear filters</button>
          )}
        </div>
      ) : view === 'table' ? (
        <div className="space-y-3">
          {selected && (
            <TicketCard key={selected.id} ticket={selected} triage={triage} onChanged={patchRow} defaultExpanded />
          )}
          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            resetPageKey={`${statusFilter}|${category}|${severity}|${search}|${awaiting}`}
            onRowClick={(r) => setSelectedId(r.id)}
            emptyMessage="No tickets match these filters."
          />
          <p className="text-[11px] text-[var(--text-muted)]">Select a row to open the ticket{triage ? ' and respond' : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => <TicketCard key={t.id} ticket={t} triage={triage} onChanged={patchRow} defaultExpanded={String(t.id) === initialSelectedId} />)}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HelpCenter() {
  const auth = useAuth() || {}
  const { t } = useLanguage()
  const navigation = useWorkspaceNavigation()
  const [params, setParams] = useSearchParams()
  const isTriage = TRIAGE_ROLES.includes(auth.profile?.role)
  const requestedSection = params.get('section') || 'overview'
  const tab = ['overview', 'guides', 'tickets', 'question', ...(isTriage ? ['triage'] : [])].includes(requestedSection) ? requestedSection : 'overview'
  const query = params.get('q') || ''
  const category = params.get('category') || 'All'
  const paths = useMemo(() => navigation.map(item => item.to), [navigation])
  const faqs = useMemo(() => scopedHelp(paths), [paths])
  const [reporting, setReporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  function go(section, extras = {}) {
    const next = new URLSearchParams({ section, ...extras })
    setParams(next)
  }
  const common = faqs.filter(faq => ['gs-navigation', 'in-sync', 'ro-roles'].includes(faq.id))
  return <div className="tp-help-hub">
    <div className="tp-help-heading"><div><h1>{t('shell.helpHub.title')}</h1><p>{t('shell.helpHub.subtitle')}</p></div>
      <button type="button" className="btn-primary" onClick={() => setReporting(true)}><AlertTriangle size={17} /> {t('shell.helpHub.reportProblem')}</button>
    </div>
    <div className="tp-help-search-region"><label><Search size={20} aria-hidden="true" /><input type="search" aria-label={t('shell.helpHub.search')} placeholder={t('shell.helpHub.search')}
      value={query} onChange={event => { const next = new URLSearchParams(params); next.set('section', 'guides'); next.set('q', event.target.value); next.delete('category'); setParams(next, { replace: true }) }} /></label><p>{t('shell.helpHub.scopeNote')}</p></div>
    <div className="tp-help-tabs" role="group" aria-label={t('shell.helpHub.title')}>
      {['overview', 'guides', 'tickets', 'question'].map(section => <button key={section} type="button" aria-pressed={tab === section} onClick={() => go(section)}>{t(`shell.helpHub.nav.${section}`)}</button>)}
      {isTriage && <button type="button" aria-pressed={tab === 'triage'} onClick={() => go('triage')}><ShieldQuestion size={14} /> {t('shell.helpHub.triage')}</button>}
    </div>
    {tab === 'overview' && <HelpOverview refreshKey={reloadKey} paths={paths} onGuide={value => go('guides', { category: value })} onTickets={id => go('tickets', id ? { ticket: id } : {})}
      renderFaq={() => common.map(faq => <FaqItem key={faq.id} faq={faq} />)} />}
    {tab === 'guides' && <section className="tp-help-section"><h2>{t('shell.helpHub.nav.guides')}</h2><FaqPanel scoped={faqs} query={query} activeCat={category} setActiveCat={value => go('guides', { q: query, category: value })} onAskInstead={() => go('question')} /></section>}
    {tab === 'tickets' && <section className="tp-help-section"><div className="tp-help-section-title"><h2>{t('shell.helpHub.nav.tickets')}</h2><button type="button" onClick={() => go('question')}><Plus size={14} /> {t('shell.helpHub.askQuestion')}</button></div><TicketList key={params.get('ticket') || 'mine'} triage={false} reloadKey={reloadKey} initialSelectedId={params.get('ticket')} emptyHint={t('shell.helpHub.noRequestsHint')} /></section>}
    {tab === 'question' && <section className="tp-help-section tp-help-question"><h2>{t('shell.helpHub.askQuestion')}</h2><p>{t('shell.helpHub.questionHint')}</p><ReportForm onSubmitted={() => setReloadKey(value => value + 1)} onViewTickets={() => go('tickets')} /></section>}
    {tab === 'triage' && isTriage && <section className="tp-help-section"><h2>{t('shell.helpHub.triage')}</h2><TicketList triage reloadKey={reloadKey} emptyHint={t('shell.helpHub.noTeamTickets')} /></section>}
    <div className="tp-help-bottom-links"><Link to="/my-problems">{t('shell.helpHub.nav.problems')}</Link><Link to="/request-access">{t('shell.helpHub.nav.access')}</Link><Link to="/settings?tab=about">{t('shell.helpHub.nav.updates')}</Link></div>
    <ReportProblemDialog open={reporting} onClose={() => { setReporting(false); setReloadKey(value => value + 1) }} />
  </div>
}
