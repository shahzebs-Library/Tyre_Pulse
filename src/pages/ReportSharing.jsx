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
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Share2, Tv, Eye, Radio, Palette, ExternalLink, AlertCircle,
  LayoutGrid, Link2, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import ReportSharesPanel from '../components/display/ReportSharesPanel'
import { listReportShares } from '../lib/api/reportShares'
import { hasCustomLayout, normalizeLayout } from '../lib/reportShareLayout'
import { activePaletteName, PRESET_LABELS } from '../lib/reportColors'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'

const ELEVATED = new Set(['Admin', 'Manager', 'Director'])
const fmtInt = (n) => new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0))

/** Number of rotating views a share carries (custom boards, else fixed pages). */
function boardCount(row) {
  if (hasCustomLayout(row?.layout)) return (normalizeLayout(row.layout)?.boards || []).length
  return Array.isArray(row?.pages) ? row.pages.length : 0
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
  const isSuper = profile?.is_super_admin === true

  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const rows = await listReportShares()
      setShares(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setError(toUserMessage(err, 'Could not load report links.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (elevated) load() }, [elevated, load])

  const totalLinks = shares.length
  const totalViews = shares.reduce((s, r) => s + (Number(r.view_count) || 0), 0)
  const totalBoards = shares.reduce((s, r) => s + boardCount(r), 0)
  const customCount = shares.filter((r) => hasCustomLayout(r.layout)).length
  const paletteName = PRESET_LABELS[activePaletteName()] || 'Custom'

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Link2} label="Active share links" value={fmtInt(totalLinks)} />
          <StatCard icon={Eye} label="Total views" value={fmtInt(totalViews)} hint="Across all links" />
          <StatCard icon={LayoutGrid} label="Rotating boards" value={fmtInt(totalBoards)} hint={`${fmtInt(customCount)} custom designed`} />
          <StatCard icon={Palette} label="Report colours" value={paletteName}
            hint={isSuper ? 'Change in System Console' : 'Set by your administrator'} />
        </div>
      )}

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
        {isSuper && (
          <button type="button" onClick={() => navigate('/console/appearance')}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 flex items-center gap-1.5 shrink-0">
            <ExternalLink size={13} /> Change report colours
          </button>
        )}
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
