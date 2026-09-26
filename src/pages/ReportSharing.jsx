/**
 * ReportSharing - the full-page home for shareable PUBLIC report / TV board links.
 *
 * Promoted out of Settings into its own nav page ("Reports & Executive" >
 * "Report Sharing", /report-sharing). It wraps the share manager + custom board
 * builder (ReportSharesPanel / ReportShareBuilder) with an at-a-glance overview
 * (links, views, boards) and quick links to the authed TV kiosk and the report
 * colour theme. Every chart on a shared board follows the super-admin report
 * palette (src/lib/reportColors), so changing the theme there changes it here.
 *
 * Elevated-only (Admin / Manager / Director / super-admin); the route is also
 * RoleRoute-gated. No em / en dashes, arrows, middle dots or curly quotes.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Share2, Tv, Eye, Radio, Palette, AlertCircle,
  LayoutGrid, Link2, RefreshCw, Clock, Hourglass, EyeOff, FileSpreadsheet, FileText,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  enrichShares, summarizeShares, filterShares, shareFindings, exportRows,
  EXPORT_COLUMNS, LINK_STATUSES, STATUS_META, STALE_DAYS, EXPIRING_DAYS,
} from '../lib/reportSharingAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import ReportSharesPanel from '../components/display/ReportSharesPanel'
import { listReportShares } from '../lib/api/reportShares'
import { hasCustomLayout, normalizeLayout } from '../lib/reportShareLayout'
import { activePaletteName, PRESET_LABELS } from '../lib/reportColors'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'

const ELEVATED = new Set(['Admin', 'Manager', 'Director'])
const fmtInt = (n) => new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0))
const fmtMaybe = (n) => (n == null ? 'N/A' : fmtInt(n))
const fmtDay = (v) => (v ? String(v).slice(0, 10) : null)

const TONE_CLASS = {
  good: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  quiet: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
  info: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONE_CLASS[meta.tone]}`}>
      {meta.label}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'var(--accent-soft, rgba(99,102,241,0.14))' }}>
        <Icon size={18} className="text-[var(--accent)]" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight tabular-nums">{value}</p>
        <p className="text-xs font-semibold text-[var(--text-secondary)]">{label}</p>
        {hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

export default function ReportSharing() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const elevated = ELEVATED.has(profile?.role) || profile?.is_super_admin === true

  const [shares, setShares] = useState([])
  // One clock read per load so every figure on the page shares the same "now".
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const rows = await listReportShares()
      setShares(Array.isArray(rows) ? rows : [])
      setNow(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load report links.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (elevated) load() }, [elevated, load])

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  // Board counts use the canonical layout normalizer so the page agrees with the builder.
  const normalized = useMemo(() => shares.map((r) => (
    hasCustomLayout(r.layout) ? { ...r, layout: { boards: normalizeLayout(r.layout)?.boards || [] } } : { ...r, layout: null }
  )), [shares])
  const enriched = useMemo(() => enrichShares(normalized, { now }), [normalized, now])
  // listReportShares() returns active rows only, so revoked links are not measurable here.
  const summary = useMemo(() => summarizeShares(normalized, { now, includesRevoked: false }), [normalized, now])
  const findings = useMemo(() => shareFindings(summary), [summary])
  const visible = useMemo(() => filterShares(enriched, { status: statusFilter, search }), [enriched, statusFilter, search])
  const statusCounts = useMemo(() => {
    const c = { all: enriched.length }
    LINK_STATUSES.forEach((st) => { c[st] = enriched.filter((r) => r.status === st).length })
    return c
  }, [enriched])
  const paletteName = PRESET_LABELS[activePaletteName()] || 'Custom'

  const columns = useMemo(() => [
    { id: 'name', header: 'Name', accessorFn: (r) => r.name || 'Shared report', size: 220 },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, cell: ({ row }) => <StatusPill status={row.original.status} />, size: 130 },
    { id: 'views', header: 'Views', accessorFn: (r) => r.views ?? -1, cell: ({ row }) => fmtMaybe(row.original.views), meta: { align: 'right' }, size: 80 },
    { id: 'last_viewed', header: 'Last viewed', accessorFn: (r) => r.last_viewed_at || '',
      cell: ({ row }) => {
        const r = row.original
        if (!r.last_viewed_at) return <span className="text-[var(--text-muted)]">Never</span>
        return <span>{fmtDay(r.last_viewed_at)}<span className="text-[var(--text-muted)]"> ({r.daysSinceView}d ago)</span></span>
      }, size: 170 },
    { id: 'boards', header: 'Boards', accessorFn: (r) => r.boards, cell: ({ row }) => `${row.original.boards} ${row.original.custom ? 'custom' : 'pages'}`, size: 110 },
    { id: 'timing', header: 'Rotate / refresh', accessorFn: (r) => Number(r.rotate_seconds) || 0,
      cell: ({ row }) => {
        const r = row.original
        const rot = r.rotate_seconds == null ? 'N/A' : `${r.rotate_seconds}s`
        const ref = r.refresh_seconds == null ? 'N/A' : `${Math.round(Number(r.refresh_seconds) / 60)} min`
        return `${rot} / ${ref}`
      }, size: 130 },
    { id: 'expires', header: 'Expires', accessorFn: (r) => r.expires_at || '9999',
      cell: ({ row }) => {
        const r = row.original
        if (!r.expires_at) return <span className="text-[var(--text-muted)]">No expiry</span>
        const d = r.daysToExpiry
        return <span>{fmtDay(r.expires_at)}{d != null && d > 0 && <span className="text-[var(--text-muted)]"> (in {d}d)</span>}</span>
      }, size: 160 },
    { id: 'created', header: 'Created', accessorFn: (r) => r.created_at || '', cell: ({ row }) => fmtDay(row.original.created_at) || 'N/A', size: 110 },
  ], [])

  const runExport = async (kind) => {
    setExporting(true); setExportError(null)
    try {
      const rows = exportRows(visible)
      const name = reportFileName('TyrePulse Report Share Links', reportDateLabel())
      if (kind === 'xlsx') {
        await exportToExcel(rows, EXPORT_COLUMNS.map((c) => c.key), EXPORT_COLUMNS.map((c) => c.header), name)
      } else {
        await exportToPdf(rows, EXPORT_COLUMNS, 'Report Share Links', name, 'landscape')
      }
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export the share links.'))
    } finally {
      setExporting(false)
    }
  }

  if (!elevated) {
    return (
      <div className="p-6">
        <div className="card p-6 text-sm text-[var(--text-muted)] flex items-center gap-2">
          <AlertCircle size={16} /> You do not have access to report sharing.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Report Sharing"
        subtitle="Share live report boards on a control-room TV or a public read-only link. No login required."
        icon={Share2}
        onRefresh={load}
        refreshing={loading}
        actions={
          <button type="button" onClick={() => navigate('/display')}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] flex items-center gap-1.5">
            <Radio size={14} /> Open TV Display Mode
          </button>
        }
      />

      {/* Overview */}
      {error ? (
        <div className="card p-4 text-sm bg-red-900/20 border border-red-700/40 text-red-300 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertCircle size={15} /> {error}</span>
          <button type="button" onClick={load}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] hover:border-[var(--accent)] flex items-center gap-1.5">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-7 w-16 rounded bg-[var(--input-bg)]" />
              <div className="h-3 w-24 rounded bg-[var(--input-bg)] mt-2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <StatCard icon={Link2} label="Live links" value={fmtInt(summary.live)} hint={`${fmtInt(summary.total)} listed in total`} />
          <StatCard icon={Eye} label="Total views" value={fmtMaybe(summary.totalViews)}
            hint={summary.avgViewsPerLiveLink == null ? 'No views recorded yet' : `${summary.avgViewsPerLiveLink.toFixed(1)} per live link`} />
          <StatCard icon={Hourglass} label="Expiring soon" value={fmtInt(summary.expiring)} hint={`Within ${EXPIRING_DAYS} days`} />
          <StatCard icon={Clock} label="Expired" value={fmtInt(summary.expired)} hint="No longer opens" />
          <StatCard icon={EyeOff} label="Stale links" value={fmtInt(summary.stale)} hint={`Not viewed in ${STALE_DAYS} days`} />
          <StatCard icon={AlertCircle} label="Revoked" value="N/A" hint="Revoked links are not listed" />
          <StatCard icon={LayoutGrid} label="Rotating boards" value={fmtInt(summary.boards)} hint={`${fmtInt(summary.customDesigned)} custom designed`} />
        </div>
      )}

      {!loading && !error && findings.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Needs attention</p>
          <ul className="space-y-1.5">
            {findings.map((f, i) => (
              <li key={i} className={`text-xs px-3 py-2 rounded-lg border ${TONE_CLASS[f.tone] || TONE_CLASS.info}`}>{f.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Link health register */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Link health</p>
            <p className="text-xs text-[var(--text-secondary)]">Every live share link with its status, reach and expiry. Manage links in the panel below.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or board"
              aria-label="Search share links"
              className="text-xs px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] w-48" />
            <button type="button" onClick={() => runExport('xlsx')} disabled={exporting || visible.length === 0}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] disabled:opacity-50 flex items-center gap-1.5">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} disabled={exporting || visible.length === 0}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] disabled:opacity-50 flex items-center gap-1.5">
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {['all', ...LINK_STATUSES.filter((st) => st !== 'revoked')].map((st) => (
            <button key={st} type="button" onClick={() => setStatusFilter(st)} aria-pressed={statusFilter === st}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${statusFilter === st
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft,rgba(99,102,241,0.14))]'
                : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
              {st === 'all' ? 'All' : STATUS_META[st].label} ({statusCounts[st] ?? 0})
            </button>
          ))}
        </div>
        {exportError && (
          <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={13} /> {exportError}</p>
        )}
        <EnterpriseTable
          viewKey="report-sharing-links"
          columns={columns}
          data={visible}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error}
          onRetry={load}
          enableGlobalFilter={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={shares.length === 0
            ? 'No share links yet. Create the first one in the panel below.'
            : 'No links match these filters.'}
        />
      </div>

      {/* Theme link (charts on every shared board follow this palette) */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent-soft, rgba(99,102,241,0.14))' }}>
            <Palette size={16} className="text-[var(--accent)]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Board colours follow your report theme</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Every chart on a shared board and TV link uses the "{paletteName}" report palette. Change the theme
              once and it updates everywhere.
            </p>
          </div>
        </div>
        {/* No console link here - by explicit instruction the frontend never
            surfaces the console. The report theme is changed from the System
            Console itself (Report Colors), reached directly at /console. */}
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4 space-y-1">
          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Share2 size={15} className="text-[var(--accent)]" /> 1. Create a link</p>
          <p className="text-xs text-[var(--text-secondary)]">Name it, pick the report boards to rotate, set the rotate and refresh timing, and add an optional password or expiry.</p>
        </div>
        <div className="card p-4 space-y-1">
          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><LayoutGrid size={15} className="text-[var(--accent)]" /> 2. Design boards</p>
          <p className="text-xs text-[var(--text-secondary)]">Use "Design boards" to build custom boards: add KPI tiles, trends, breakdowns, gauges, heatmaps and tables, then resize and restyle each. Every board fits one screen.</p>
        </div>
        <div className="card p-4 space-y-1">
          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Tv size={15} className="text-[var(--accent)]" /> 3. Show it anywhere</p>
          <p className="text-xs text-[var(--text-secondary)]">Open the link on any screen. It auto-rotates, refreshes the live numbers on its own, and has a full-screen button for a clean control-room wall board.</p>
        </div>
      </div>

      {/* Manager + builder */}
      <ReportSharesPanel />
    </div>
  )
}
