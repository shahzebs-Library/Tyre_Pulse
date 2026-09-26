/**
 * TechnicianScorecard (route /technician-scorecard) - workshop technician
 * competency + performance platform. Four tabs:
 *
 *   Leaderboard    - performance ranking derived from `work_orders`
 *                    (completion, turnaround, cost, SLA, composite score).
 *   Technicians    - per-technician competency card (skills by proficiency,
 *                    certifications by expiry status, a lifecycle band) with
 *                    +Skill / +Cert actions.
 *   Skills matrix  - org-wide skill x proficiency-level coverage roll-up.
 *   Certifications - certification register and expiry compliance.
 *
 * Scoring maths lives in `src/lib/technicianScorecard.js`; the page-level
 * filtering, KPI strips, registers and export shapes live in
 * `src/lib/technicianScorecardAnalytics.js`. Every source read reports its own
 * failure: a failed read is never rendered as "no technicians".
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Award, Users, ClipboardList, CheckCircle2, Clock, Search, X,
  FileSpreadsheet, FileText, AlertTriangle, Wrench, Trophy, GraduationCap,
  ShieldCheck, LayoutGrid, CalendarClock, Plus, ChevronRight, BadgeCheck, Star,
  AlertCircle, Loader2, Timer, Coins, RefreshCw, Gauge,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import {
  listWorkOrdersForScorecard, listSkills, listCerts,
  upsertSkill, deleteSkill, createCert, deleteCert,
} from '../lib/api/technicianScorecard'
import { listProfiles } from '../lib/api/users'
import {
  summarizeTechnicians, completionRating,
  SKILL_CATALOGUE, CERT_CATALOGUE, LEVEL_LABELS, LIFECYCLE_BAND_LABELS,
  certExpiryStatus, computeExpiry, skillById, certById,
} from '../lib/technicianScorecard'
import {
  MIN_JOB_OPTIONS, RATINGS, CERT_STATUSES, CERT_STATUS_LABELS, CATEGORY_LABELS, profileName,
  filterLeaderboard, leaderboardKpis, leaderboardExportRows, LEADERBOARD_EXPORT_COLS, LEADERBOARD_EXPORT_HEADERS,
  buildTechnicianRows, technicianKpis, technicianExportRows, TECH_EXPORT_COLS, TECH_EXPORT_HEADERS,
  matrixRows, matrixKpis, matrixExportRows, MATRIX_EXPORT_COLS, MATRIX_EXPORT_HEADERS,
  certRegister, filterCerts, certKpis, certExportRows, CERT_EXPORT_COLS, CERT_EXPORT_HEADERS,
} from '../lib/technicianScorecardAnalytics'
import { toUserMessage } from '../lib/safeError'
import { safeHref } from '../lib/safeUrl'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')

// Semantic status tints: the text label always carries the meaning too.
const RATING_STYLES = {
  Excellent: 'bg-green-900/40 text-green-300 border border-green-700/50',
  Good: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  Average: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  'Needs Improvement': 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const LEVEL_STYLES = {
  1: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  2: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  3: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}
const CERT_STATUS_STYLES = {
  valid: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
}
const BAND_STYLES = {
  expert: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  proficient: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
  developing: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  needs_training: 'bg-red-500/20 text-red-300 border border-red-500/40',
  unrated: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]',
}
const BAND_KEYS = ['expert', 'proficient', 'developing', 'needs_training', 'unrated']

const scoreTone = (s) => (s >= 80 ? 'text-green-400' : s >= 60 ? 'text-yellow-400' : s >= 40 ? 'text-orange-400' : 'text-red-400')
const scoreBg = (s) => (s >= 80 ? 'bg-green-500/20 border-green-500/30' : s >= 60 ? 'bg-yellow-500/20 border-yellow-500/30' : s >= 40 ? 'bg-orange-500/20 border-orange-500/30' : 'bg-red-500/20 border-red-500/30')
const scoreColor = (s) => (s >= 80 ? '#22c55e' : s >= 60 ? '#eab308' : s >= 40 ? '#f97316' : '#ef4444')
const fmtTat = (d) => (d == null ? 'N/A' : `${d.toFixed(1)}d`)
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

const TABS = [
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'technicians', label: 'Technicians', icon: Users },
  { key: 'matrix', label: 'Skills matrix', icon: LayoutGrid },
  { key: 'certs', label: 'Certifications', icon: ShieldCheck },
]

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]' }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        {Icon && <Icon size={16} className={tone} aria-hidden="true" />}
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
    </Card>
  )
}

function SourceError({ label, message, onRetry }) {
  return (
    <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }} role="alert">
      <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-[var(--text-primary)] font-medium">Couldn&apos;t load {label}.</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{message} Nothing below is shown as zero because of this.</p>
      </div>
      <button type="button" onClick={onRetry} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
        <RefreshCw size={14} aria-hidden="true" /> Retry
      </button>
    </Card>
  )
}

function SearchField({ id, label, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
      <label htmlFor={id} className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
        <input id={id} type="search" className="input pl-9 w-full min-h-[44px]" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )
}

function SelectField({ id, label, value, onChange, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-[var(--text-muted)]">{label}</label>
      <select id={id} className="input min-h-[44px]" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </div>
  )
}

function ExportButtons({ onExcel, onPdf, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onExcel} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={disabled}>
        <FileSpreadsheet size={14} aria-hidden="true" /> Excel
      </button>
      {onPdf && (
        <button type="button" onClick={onPdf} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={disabled}>
          <FileText size={14} aria-hidden="true" /> PDF
        </button>
      )}
    </div>
  )
}

export default function TechnicianScorecard() {
  const { activeCountry, activeCurrency } = useSettings()
  const [orders, setOrders] = useState(null)
  const [profiles, setProfiles] = useState(null)
  const [skills, setSkills] = useState(null)
  const [certs, setCerts] = useState(null)
  const [errors, setErrors] = useState({})
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [tab, setTab] = useState('leaderboard')

  // Leaderboard filters
  const [search, setSearch] = useState('')
  const [minJobs, setMinJobs] = useState(1)
  const [rating, setRating] = useState('all')
  // Technicians tab
  const [techSearch, setTechSearch] = useState('')
  const [allRoles, setAllRoles] = useState(false)
  const [bandFilter, setBandFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  // Matrix tab
  const [matrixSearch, setMatrixSearch] = useState('')
  const [category, setCategory] = useState('all')
  // Certs tab
  const [certSearch, setCertSearch] = useState('')
  const [certStatus, setCertStatus] = useState('all')

  const [skillModal, setSkillModal] = useState(null)
  const [certModal, setCertModal] = useState(null)

  const nowMs = updatedAt?.getTime() ?? 0

  const load = useCallback(async () => {
    setRefreshing(true); setActionError('')
    const [ord, prof, sk, ct] = await Promise.allSettled([
      listWorkOrdersForScorecard({ country: activeCountry }),
      listProfiles(),
      listSkills({ country: activeCountry }),
      listCerts({ country: activeCountry }),
    ])
    const val = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
    setOrders(val(ord)); setProfiles(val(prof)); setSkills(val(sk)); setCerts(val(ct))
    setErrors({
      orders: ord.status === 'rejected' ? toUserMessage(ord.reason, 'Could not load work orders.') : '',
      profiles: prof.status === 'rejected' ? toUserMessage(prof.reason, 'Could not load users.') : '',
      skills: sk.status === 'rejected' ? toUserMessage(sk.reason, 'Could not load skills.') : '',
      certs: ct.status === 'rejected' ? toUserMessage(ct.reason, 'Could not load certifications.') : '',
    })
    setUpdatedAt(new Date())
    setRefreshing(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = updatedAt === null
  const competencyError = errors.profiles || errors.skills || errors.certs

  // ── Leaderboard ────────────────────────────────────────────────────────────
  const { rows: ranked } = useMemo(() => summarizeTechnicians(orders || []), [orders])
  const filtered = useMemo(() => filterLeaderboard(ranked, { search, minJobs, rating }), [ranked, search, minJobs, rating])
  const lbKpis = useMemo(() => leaderboardKpis(filtered, orders || [], nowMs), [filtered, orders, nowMs])
  const topRanked = useMemo(() => filtered.slice(0, 12), [filtered])
  const barData = {
    labels: topRanked.map((r) => r.technician),
    datasets: [{
      label: 'Composite score',
      data: topRanked.map((r) => r.score),
      backgroundColor: topRanked.map((r) => scoreColor(r.score)),
      borderRadius: 4,
    }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { min: 0, max: 100, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: 'Composite score (0 to 100)', color: 'var(--text-muted)' } },
      y: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
    },
  }
  const leaderboardColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: (r) => r.rank, size: 60, cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.rank}</span> },
    { id: 'technician', header: 'Technician', accessorFn: (r) => r.technician, size: 220,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.technician}</span> },
    { id: 'jobs', header: 'Jobs', accessorFn: (r) => r.jobs, size: 80, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.jobs}</span> },
    { id: 'completed', header: 'Completed', accessorFn: (r) => r.completed, size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.completed}</span> },
    { id: 'open', header: 'Open', accessorFn: (r) => r.open, size: 80, meta: { align: 'right' },
      cell: ({ row }) => <span className={`tabular-nums ${row.original.open > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{row.original.open}</span> },
    { id: 'completionRate', header: 'Completion', accessorFn: (r) => r.completionRate, size: 140, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center gap-2 justify-end">
            <div className="w-14 bg-[var(--input-bg)] rounded-full h-1.5" aria-hidden="true">
              <div className={`h-1.5 rounded-full ${r.completionRate >= 85 ? 'bg-green-500' : r.completionRate >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(r.completionRate, 100)}%` }} />
            </div>
            <span className="tabular-nums text-xs w-12 text-right">{r.completionRate}%</span>
          </div>
        )
      } },
    { id: 'avgTurnaround', header: 'Avg TAT', accessorFn: (r) => (r.avgTurnaround == null ? Number.POSITIVE_INFINITY : r.avgTurnaround), size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtTat(row.original.avgTurnaround)}</span> },
    { id: 'totalCost', header: 'Total cost', accessorFn: (r) => r.totalCost, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{formatCurrencyCompact(row.original.totalCost, activeCurrency)}</span> },
    { id: 'avgCostPerJob', header: 'Avg/job', accessorFn: (r) => r.avgCostPerJob, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{formatCurrencyCompact(row.original.avgCostPerJob, activeCurrency)}</span> },
    { id: 'score', header: 'Score', accessorFn: (r) => r.score, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${scoreBg(row.original.score)} ${scoreTone(row.original.score)}`}>{row.original.score}</span> },
    { id: 'rating', header: 'Rating', accessorFn: (r) => completionRating(r.completionRate), size: 150,
      cell: ({ row }) => { const rt = completionRating(row.original.completionRate); return <span className={`text-[11px] px-2 py-0.5 rounded ${RATING_STYLES[rt]}`}>{rt}</span> } },
  ], [activeCurrency])

  // ── Technicians ────────────────────────────────────────────────────────────
  const techRows = useMemo(() => buildTechnicianRows({
    profiles: profiles || [], skills: skills || [], certs: certs || [], ranked,
    allRoles, search: techSearch, band: bandFilter,
  }, nowMs), [profiles, skills, certs, ranked, allRoles, techSearch, bandFilter, nowMs])
  const techK = useMemo(() => technicianKpis(techRows), [techRows])
  const techPager = usePagedRows(techRows, { pageSize: 25 })

  // ── Matrix ─────────────────────────────────────────────────────────────────
  const matrix = useMemo(() => matrixRows(skills || [], { search: matrixSearch, category }), [skills, matrixSearch, category])
  const mK = useMemo(() => matrixKpis(skills || []), [skills])
  const matrixColumns = useMemo(() => [
    { id: 'name', header: 'Skill', accessorFn: (r) => r.name, size: 260, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.name}</span> },
    { id: 'category', header: 'Category', accessorFn: (r) => CATEGORY_LABELS[r.category] || r.category, size: 140 },
    { id: 'l1', header: LEVEL_LABELS[1], accessorFn: (r) => r.l1, size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.l1}</span> },
    { id: 'l2', header: LEVEL_LABELS[2], accessorFn: (r) => r.l2, size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.l2}</span> },
    { id: 'l3', header: LEVEL_LABELS[3], accessorFn: (r) => r.l3, size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.l3}</span> },
    { id: 'total', header: 'Holders', accessorFn: (r) => r.total, size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{row.original.total}</span> },
  ], [])

  // ── Certifications ─────────────────────────────────────────────────────────
  const certAll = useMemo(() => certRegister(certs || [], profiles || [], nowMs), [certs, profiles, nowMs])
  const certRows = useMemo(() => filterCerts(certAll, { search: certSearch, status: certStatus }), [certAll, certSearch, certStatus])
  const cK = useMemo(() => certKpis(certAll), [certAll])
  const expiringSoon = cK.expired + cK.warning
  const certColumns = useMemo(() => [
    { id: 'technician', header: 'Technician', accessorFn: (r) => r.technician, size: 180, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.technician}</span> },
    { id: 'displayName', header: 'Certification', accessorFn: (r) => r.displayName, size: 220 },
    { id: 'issuer', header: 'Issuer', accessorFn: (r) => r.issuer || '', size: 150, cell: ({ row }) => row.original.issuer || <span className="text-[var(--text-muted)]">N/A</span> },
    { id: 'issue_date', header: 'Issued', accessorFn: (r) => r.issue_date || '', size: 120, cell: ({ row }) => (row.original.issue_date ? formatDate(row.original.issue_date) : 'N/A') },
    { id: 'expiry_date', header: 'Expires', accessorFn: (r) => r.expiry_date || '', size: 120, cell: ({ row }) => (row.original.expiry_date ? formatDate(row.original.expiry_date) : 'N/A') },
    { id: 'days', header: 'Days left', accessorFn: (r) => (r.days == null ? Number.POSITIVE_INFINITY : r.days), size: 100, meta: { align: 'right' },
      cell: ({ row }) => {
        const c = row.original
        const tone = c.status === 'expired' ? 'text-red-300' : c.status === 'warning' ? 'text-amber-300' : 'text-[var(--text-secondary)]'
        return <span className={`tabular-nums font-medium ${tone}`}>{c.days == null ? 'N/A' : c.days}</span>
      } },
    { id: 'status', header: 'Status', accessorFn: (r) => CERT_STATUS_LABELS[r.status], size: 190,
      cell: ({ row }) => <span className={`text-[11px] px-2 py-0.5 rounded ${CERT_STATUS_STYLES[row.original.status]}`}>{CERT_STATUS_LABELS[row.original.status]}</span> },
    { id: 'doc', header: 'Document', enableSorting: false, size: 100,
      cell: ({ row }) => {
        const href = safeHref(row.original.document_url)
        return href
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-bright)] hover:underline text-xs">View<span className="sr-only"> document for {row.original.displayName}</span></a>
          : <span className="text-[var(--text-muted)]">N/A</span>
      } },
  ], [])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const reloadCompetency = useCallback(async () => {
    const [sk, ct] = await Promise.allSettled([listSkills({ country: activeCountry }), listCerts({ country: activeCountry })])
    if (sk.status === 'fulfilled') setSkills(Array.isArray(sk.value) ? sk.value : [])
    if (ct.status === 'fulfilled') setCerts(Array.isArray(ct.value) ? ct.value : [])
    setErrors((e) => ({
      ...e,
      skills: sk.status === 'rejected' ? toUserMessage(sk.reason, 'Could not load skills.') : '',
      certs: ct.status === 'rejected' ? toUserMessage(ct.reason, 'Could not load certifications.') : '',
    }))
  }, [activeCountry])

  const removeSkill = async (id) => {
    setActionError('')
    try { await deleteSkill(id); await reloadCompetency() } catch (e) { setActionError(toUserMessage(e, 'Could not remove this skill.')) }
  }
  const removeCert = async (id) => {
    setActionError('')
    try { await deleteCert(id); await reloadCompetency() } catch (e) { setActionError(toUserMessage(e, 'Could not remove this certification.')) }
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  async function exportTab(kind) {
    const { exportToExcel, exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : null
    const spec = {
      leaderboard: [leaderboardExportRows(filtered), LEADERBOARD_EXPORT_COLS, LEADERBOARD_EXPORT_HEADERS, 'Technician Leaderboard'],
      technicians: [technicianExportRows(techRows), TECH_EXPORT_COLS, TECH_EXPORT_HEADERS, 'Technician Competency'],
      matrix: [matrixExportRows(matrix), MATRIX_EXPORT_COLS, MATRIX_EXPORT_HEADERS, 'Technician Skills Matrix'],
      certs: [certExportRows(certRows), CERT_EXPORT_COLS, CERT_EXPORT_HEADERS, 'Technician Certifications'],
    }[tab]
    const [rows, cols, headers, title] = spec
    const name = reportFileName('TyrePulse', title, scope, reportDateLabel())
    if (kind === 'pdf') exportToPdf(rows, cols.map((key, i) => ({ key, header: headers[i] })), title, name, 'landscape')
    else exportToExcel(rows, cols, headers, name)
  }
  const exportCount = { leaderboard: filtered.length, technicians: techRows.length, matrix: matrix.length, certs: certRows.length }[tab]

  const lbHasFilters = search || minJobs > 1 || rating !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Scorecard"
        subtitle="Workshop technician competency and performance: leaderboard, skills matrix and certification compliance."
        icon={Award}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={<ExportButtons onExcel={() => exportTab('excel')} onPdf={() => exportTab('pdf')} disabled={loading || !exportCount} />}
      />

      {errors.orders && <SourceError label="work orders" message={errors.orders} onRetry={load} />}
      {competencyError && tab !== 'leaderboard' && (
        <SourceError label="competency records" message={competencyError} onRetry={load} />
      )}
      {actionError && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
          <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-primary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="p-2 min-h-[44px] min-w-[44px] rounded hover:bg-[var(--input-bg)]" aria-label="Dismiss error"><X size={14} /></button>
        </Card>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Scorecard sections" className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          const badge = t.key === 'certs' && expiringSoon ? expiringSoon : null
          return (
            <button
              key={t.key} type="button" role="tab" aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm border-b-2 -mb-px whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)] ${active ? 'border-[var(--brand-bright)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={14} aria-hidden="true" /> {t.label}
              {badge != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 tabular-nums">{badge}<span className="sr-only"> expired or expiring</span></span>}
            </button>
          )
        })}
      </div>

      {/* ══════════════════ LEADERBOARD ══════════════════ */}
      {tab === 'leaderboard' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: 'Technicians', value: lbKpis.technicians, icon: Users },
              { label: 'Total jobs', value: lbKpis.jobs.toLocaleString(), icon: ClipboardList, sub: `${lbKpis.open} open` },
              { label: 'Completion rate', value: fmtPct(lbKpis.completionRate), icon: CheckCircle2, sub: lbKpis.jobs ? `${lbKpis.completed} completed` : 'No jobs in scope' },
              { label: 'Avg turnaround', value: fmtTat(lbKpis.avgTurnaround), icon: Clock, sub: lbKpis.avgTurnaround == null ? 'No dated completions' : 'Created to completed' },
              { label: 'SLA compliance', value: fmtPct(lbKpis.slaCompliance), icon: Timer, sub: lbKpis.slaCompliance == null ? 'No orders with a known priority' : 'By work-order priority' },
              { label: 'Avg cost per job', value: lbKpis.avgCostPerJob == null ? 'N/A' : formatCurrencyCompact(lbKpis.avgCostPerJob, activeCurrency), icon: Coins, sub: `${lbKpis.needsImprovement} need improvement` },
            ].map((k) => <Kpi key={k.label} {...k} value={loading || errors.orders ? 'N/A' : k.value} sub={loading || errors.orders ? null : k.sub} />)}
          </div>

          <Card>
            <CardHeader title={`Composite ranking (top ${topRanked.length || 0})`} icon={Gauge} />
            <div style={{ height: Math.max(240, topRanked.length * 30) }}>
              {loading ? (
                <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              ) : topRanked.length ? (
                <div className="h-full" role="img" aria-label={`Composite score for the top ${topRanked.length} technicians. Highest: ${topRanked[0].technician} at ${topRanked[0].score}.`}>
                  <Bar data={barData} options={barOpts} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                  <div className="text-center"><Wrench size={22} className="mx-auto mb-2 opacity-60" aria-hidden="true" />{errors.orders ? 'Work orders could not be read.' : lbHasFilters ? 'No technicians match these filters.' : 'No technician data yet.'}</div>
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField id="ts-search" label="Search" value={search} onChange={setSearch} placeholder="Technician name" />
              <SelectField id="ts-minjobs" label="Minimum jobs" value={minJobs} onChange={(v) => setMinJobs(Number(v))}>
                {MIN_JOB_OPTIONS.map((n) => <option key={n} value={n}>{n}+</option>)}
              </SelectField>
              <SelectField id="ts-rating" label="Rating" value={rating} onChange={setRating}>
                <option value="all">All ratings</option>
                {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
              </SelectField>
              {lbHasFilters && (
                <button type="button" onClick={() => { setSearch(''); setMinJobs(1); setRating('all') }} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
                  <X size={14} aria-hidden="true" /> Clear
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {ranked.length}</span>
            </div>
          </Card>

          <EnterpriseTable
            columns={leaderboardColumns}
            data={filtered}
            getRowId={(r) => r.technician}
            loading={loading}
            error={errors.orders || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage={lbHasFilters ? 'No technicians match these filters.' : 'No work orders with a technician yet.'}
          />
        </>
      )}

      {/* ══════════════════ TECHNICIANS ══════════════════ */}
      {tab === 'technicians' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {[
              { label: allRoles ? 'Users in view' : 'Technicians', value: techK.people, icon: Users },
              { label: 'Skills assessed', value: techK.assessed, icon: GraduationCap, sub: 'With at least one skill' },
              { label: 'Certified', value: techK.certified, icon: BadgeCheck, sub: 'With at least one certificate' },
              { label: 'Cert renewals due', value: techK.atRisk, icon: CalendarClock, tone: techK.atRisk ? 'text-amber-400' : 'text-[var(--text-primary)]', sub: 'Expired or within 60 days' },
              { label: 'Avg lifecycle score', value: techK.avgLifecycle == null ? 'N/A' : techK.avgLifecycle, icon: Star, sub: techK.avgLifecycle == null ? 'Nobody rated yet' : 'Out of 100' },
            ].map((k) => <Kpi key={k.label} {...k} value={loading || competencyError ? 'N/A' : k.value} sub={loading || competencyError ? null : k.sub} />)}
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField id="ts-tech-search" label="Search" value={techSearch} onChange={setTechSearch} placeholder="Technician or role" />
              <SelectField id="ts-band" label="Lifecycle band" value={bandFilter} onChange={setBandFilter}>
                <option value="all">All bands</option>
                {BAND_KEYS.map((b) => <option key={b} value={b}>{LIFECYCLE_BAND_LABELS[b]}</option>)}
              </SelectField>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} />
                Show all roles
              </label>
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{techRows.length} {allRoles ? 'users' : 'technicians'}</span>
            </div>
          </Card>

          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Card key={i} className="h-16 animate-pulse" />)}</div>
          ) : errors.profiles ? null : techRows.length === 0 ? (
            <Card className="text-center space-y-2" style={{ paddingBlock: 'var(--space-12)' }}>
              <Users size={30} className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
              <p className="text-[var(--text-primary)] font-semibold">No technicians found.</p>
              <p className="text-sm text-[var(--text-muted)]">
                {techSearch || bandFilter !== 'all' ? 'No one matches these filters.' : allRoles ? 'No users in this scope.' : 'No users with a workshop or technician role. Turn on "Show all roles" to include everyone.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {techPager.pageRows.map((r) => {
                const open = expanded === r.id
                const panelId = `tech-panel-${r.id}`
                return (
                  <Card key={r.id} pad="none" clip>
                    <button
                      type="button" onClick={() => setExpanded(open ? null : r.id)}
                      aria-expanded={open} aria-controls={panelId}
                      className="w-full flex items-center gap-3 px-4 min-h-[56px] py-3 text-left hover:bg-[var(--input-bg)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]"
                    >
                      <ChevronRight size={16} className={`text-[var(--text-muted)] transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
                      <div className="w-9 h-9 rounded-full bg-[var(--input-bg)] flex items-center justify-center text-sm font-bold text-[var(--text-secondary)] shrink-0" aria-hidden="true">
                        {r.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--text-primary)] font-medium truncate">{r.name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{r.role || 'No role'}{r.site ? `, ${r.site}` : ''}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1"><GraduationCap size={13} aria-hidden="true" /> {r.skillCount} skills</span>
                        <span className="inline-flex items-center gap-1"><BadgeCheck size={13} aria-hidden="true" /> {r.certCount} certs</span>
                        {r.expiring > 0 && <span className="inline-flex items-center gap-1 text-amber-400"><CalendarClock size={13} aria-hidden="true" /> {r.expiring} due</span>}
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${BAND_STYLES[r.life.band]}`}>{r.life.score == null ? LIFECYCLE_BAND_LABELS.unrated : `${LIFECYCLE_BAND_LABELS[r.life.band]}, ${r.life.score}`}</span>
                    </button>

                    {open && (
                      <div id={panelId} className="border-t border-[var(--input-border)] px-4 py-4 space-y-4 bg-[var(--input-bg)]/20">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                          {[
                            { label: 'Jobs', value: r.perf ? r.perf.jobs : 'N/A' },
                            { label: 'Completion', value: r.perf ? `${r.perf.completionRate}%` : 'N/A' },
                            { label: 'Avg TAT', value: r.perf ? fmtTat(r.perf.avgTurnaround) : 'N/A' },
                            { label: 'Skill gaps', value: r.gapCount },
                          ].map((m) => (
                            <div key={m.label} className="rounded-lg bg-[var(--input-bg)]/60 p-2">
                              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{m.label}</p>
                              <p className="text-base font-bold text-[var(--text-primary)] tabular-nums">{m.value}</p>
                            </div>
                          ))}
                        </div>
                        {!r.perf && <p className="text-xs text-[var(--text-muted)]">No work orders are recorded under this name, so performance figures are not available.</p>}

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5"><GraduationCap size={13} aria-hidden="true" /> Skills</h3>
                            <button type="button" onClick={() => setSkillModal({ user_id: r.id })} className="btn-secondary text-xs min-h-[36px] inline-flex items-center gap-1"><Plus size={12} aria-hidden="true" /> Skill</button>
                          </div>
                          {r.skills.length === 0 ? (
                            <p className="text-xs text-[var(--text-muted)] italic">No skills recorded.</p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5">
                              {r.skills.map((s) => {
                                const nm = skillById(s.skill_id)?.name || s.skill_id
                                return (
                                  <li key={s.id} className={`inline-flex items-center gap-1 text-[11px] pl-2 rounded ${LEVEL_STYLES[s.level] || LEVEL_STYLES[1]}`}>
                                    {nm} <span className="opacity-70">({LEVEL_LABELS[s.level] || s.level})</span>
                                    <button type="button" onClick={() => removeSkill(s.id)} className="p-1.5 rounded hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]" aria-label={`Remove skill ${nm}`}><X size={11} /></button>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5"><ShieldCheck size={13} aria-hidden="true" /> Certifications</h3>
                            <button type="button" onClick={() => setCertModal({ user_id: r.id })} className="btn-secondary text-xs min-h-[36px] inline-flex items-center gap-1"><Plus size={12} aria-hidden="true" /> Cert</button>
                          </div>
                          {r.certs.length === 0 ? (
                            <p className="text-xs text-[var(--text-muted)] italic">No certifications recorded.</p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5">
                              {r.certs.map((c) => {
                                const meta = certExpiryStatus(c.expiry_date, nowMs)
                                const nm = c.cert_name || certById(c.cert_id)?.name || c.cert_id
                                return (
                                  <li key={c.id} className={`inline-flex items-center gap-1 text-[11px] pl-2 rounded ${CERT_STATUS_STYLES[meta.status]}`}>
                                    {nm}
                                    <span className="opacity-70">
                                      ({meta.status === 'unknown' ? 'no expiry' : meta.status === 'expired' ? `expired ${Math.abs(meta.days)}d ago` : `${meta.days}d left`})
                                    </span>
                                    <button type="button" onClick={() => removeCert(c.id)} className="p-1.5 rounded hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]" aria-label={`Remove certification ${nm}`}><X size={11} /></button>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })}
              <TablePagination {...techPager} />
            </div>
          )}
        </>
      )}

      {/* ══════════════════ SKILLS MATRIX ══════════════════ */}
      {tab === 'matrix' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {[
              { label: 'Skills tracked', value: mK.skillsTracked, icon: LayoutGrid, sub: `${SKILL_CATALOGUE.length} in the catalogue` },
              { label: 'Technicians assessed', value: mK.assessed, icon: Users },
              { label: 'Skill records', value: mK.records, icon: GraduationCap },
              { label: 'Expert-level holdings', value: mK.expert, icon: Star, sub: mK.expertShare == null ? 'No records' : `${mK.expertShare}% of records` },
              { label: 'Uncovered skills', value: mK.uncovered.length, icon: AlertTriangle, tone: mK.uncovered.length ? 'text-amber-400' : 'text-[var(--text-primary)]', sub: 'Nobody holds them' },
            ].map((k) => <Kpi key={k.label} {...k} value={loading || errors.skills ? 'N/A' : k.value} sub={loading || errors.skills ? null : k.sub} />)}
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField id="ts-matrix-search" label="Search" value={matrixSearch} onChange={setMatrixSearch} placeholder="Skill name" />
              <SelectField id="ts-category" label="Category" value={category} onChange={setCategory}>
                <option value="all">All categories</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectField>
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{matrix.length} skills</span>
            </div>
            {!loading && !errors.skills && mK.uncovered.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                <span className="text-amber-400 font-medium">No holder yet:</span> {mK.uncovered.map((s) => s.name).join(', ')}.
              </p>
            )}
          </Card>

          <EnterpriseTable
            columns={matrixColumns}
            data={matrix}
            getRowId={(r) => r.skill_id}
            loading={loading}
            error={errors.skills || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage={matrixSearch || category !== 'all' ? 'No skills match these filters.' : 'No skills recorded yet. Add skills from the Technicians tab.'}
          />
        </>
      )}

      {/* ══════════════════ CERTIFICATIONS ══════════════════ */}
      {tab === 'certs' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {[
              { label: 'Certifications', value: cK.total, icon: BadgeCheck },
              { label: 'Expired', value: cK.expired, icon: AlertCircle, tone: cK.expired ? 'text-red-400' : 'text-[var(--text-primary)]' },
              { label: 'Expiring in 60 days', value: cK.warning, icon: CalendarClock, tone: cK.warning ? 'text-amber-400' : 'text-[var(--text-primary)]' },
              { label: 'No expiry date', value: cK.unknown, icon: AlertTriangle, sub: 'Excluded from compliance' },
              { label: 'Certification compliance', value: fmtPct(cK.compliance), icon: ShieldCheck, sub: cK.compliance == null ? 'No dated certificates' : 'Valid share of dated certificates' },
            ].map((k) => <Kpi key={k.label} {...k} value={loading || errors.certs ? 'N/A' : k.value} sub={loading || errors.certs ? null : k.sub} />)}
          </div>

          {!loading && !errors.certs && expiringSoon > 0 && (
            <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertCircle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-[var(--text-primary)] font-medium">{expiringSoon} certification{expiringSoon === 1 ? '' : 's'} expired or expiring within 60 days.</p>
                <p className="text-[var(--text-muted)] text-sm mt-0.5">Schedule renewals to keep the workshop compliant.</p>
              </div>
            </Card>
          )}

          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField id="ts-cert-search" label="Search" value={certSearch} onChange={setCertSearch} placeholder="Technician, certification, issuer or number" />
              <SelectField id="ts-cert-status" label="Status" value={certStatus} onChange={setCertStatus}>
                <option value="all">All statuses</option>
                {CERT_STATUSES.map((s) => <option key={s} value={s}>{CERT_STATUS_LABELS[s]}</option>)}
              </SelectField>
              {(certSearch || certStatus !== 'all') && (
                <button type="button" onClick={() => { setCertSearch(''); setCertStatus('all') }} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
                  <X size={14} aria-hidden="true" /> Clear
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{certRows.length} of {certAll.length}</span>
            </div>
          </Card>

          <EnterpriseTable
            columns={certColumns}
            data={certRows}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={errors.certs || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage={certSearch || certStatus !== 'all' ? 'No certifications match these filters.' : 'No certifications recorded yet. Add certifications from the Technicians tab.'}
          />
        </>
      )}

      {skillModal && (
        <SkillModal
          userId={skillModal.user_id}
          userName={profileName((profiles || []).find((p) => p.id === skillModal.user_id))}
          country={activeCountry}
          onClose={() => setSkillModal(null)}
          onSaved={async () => { setSkillModal(null); await reloadCompetency() }}
        />
      )}
      {certModal && (
        <CertModal
          userId={certModal.user_id}
          userName={profileName((profiles || []).find((p) => p.id === certModal.user_id))}
          country={activeCountry}
          onClose={() => setCertModal(null)}
          onSaved={async () => { setCertModal(null); await reloadCompetency() }}
        />
      )}
    </div>
  )
}

// ── Skill modal ──────────────────────────────────────────────────────────────
function SkillModal({ userId, userName, country, onClose, onSaved }) {
  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState(1)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!skillId) { setErr('Select a skill.'); return }
    setSaving(true); setErr('')
    try {
      await upsertSkill({ user_id: userId, skill_id: skillId, level, notes, country })
      await onSaved()
    } catch (ex) {
      setErr(toUserMessage(ex, 'Could not save this skill.')); setSaving(false)
    }
  }

  // The submit button stays INSIDE the <form> rather than moving to Modal's
  // footer: hoisting it would need a `form="id"` association, which is a
  // behaviour change, not a migration.
  return (
    <Modal open onClose={onClose} size="md" title="Add / update skill">
      <p className="text-xs text-[var(--text-muted)] mb-4 inline-flex items-center gap-1.5"><Users size={12} className="opacity-60" /> {userName}</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="ts-skill">Skill</label>
          <select id="ts-skill" className="input w-full" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Select a skill</option>
            {SKILL_CATALOGUE.map((s) => <option key={s.skill_id} value={s.skill_id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ts-level">Proficiency level</label>
          <select id="ts-level" className="input w-full" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}: {LEVEL_LABELS[n]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ts-notes">Notes (optional)</label>
          <textarea id="ts-notes" className="input w-full" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assessment notes" />
        </div>
        {err && <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving || !skillId}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : 'Save skill'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Cert modal ───────────────────────────────────────────────────────────────
function CertModal({ userId, userName, country, onClose, onSaved }) {
  const [certId, setCertId] = useState('')
  const [certName, setCertName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [certNumber, setCertNumber] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // When a catalogue cert is picked, prefill name + issuer and (re)derive expiry.
  const onPickCert = (id) => {
    setCertId(id)
    const meta = certById(id)
    if (meta) {
      setCertName(meta.name)
      setIssuer(meta.issuer)
      if (issueDate) setExpiryDate(computeExpiry(issueDate, meta.validity_years) || '')
    }
  }

  // When the issue date changes, recompute expiry from the selected cert's window.
  const onPickIssue = (v) => {
    setIssueDate(v)
    const meta = certById(certId)
    if (meta && v) setExpiryDate(computeExpiry(v, meta.validity_years) || '')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!certId) { setErr('Select a certification.'); return }
    setSaving(true); setErr('')
    try {
      await createCert({
        user_id: userId, cert_id: certId, cert_name: certName, issuer,
        issue_date: issueDate, expiry_date: expiryDate, cert_number: certNumber,
        document_url: documentUrl, country,
      })
      await onSaved()
    } catch (ex) {
      setErr(toUserMessage(ex, 'Could not save this certification.')); setSaving(false)
    }
  }

  // `max-h-[90vh] overflow-y-auto` is dropped on purpose: Modal already caps the
  // panel to the viewport and scrolls the BODY only, so the header and the
  // action row stay reachable instead of scrolling away.
  return (
    <Modal open onClose={onClose} size="md" title="Add certification">
      <p className="text-xs text-[var(--text-muted)] mb-4 inline-flex items-center gap-1.5"><Users size={12} className="opacity-60" /> {userName}</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="ts-cert">Certification</label>
          <select id="ts-cert" className="input w-full" value={certId} onChange={(e) => onPickCert(e.target.value)}>
            <option value="">Select a certification</option>
            {CERT_CATALOGUE.map((c) => <option key={c.cert_id} value={c.cert_id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ts-issuer">Issuer</label>
          <input id="ts-issuer" className="input w-full" value={issuer} maxLength={200} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuing body" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ts-issue">Issue date</label>
            <input id="ts-issue" className="input w-full" type="date" value={issueDate} onChange={(e) => onPickIssue(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ts-expiry">Expiry date {certById(certId) ? <span className="text-[10px] text-[var(--text-muted)]">(auto)</span> : null}</label>
            <input id="ts-expiry" className="input w-full" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ts-certno">Certificate number (optional)</label>
            <input id="ts-certno" className="input w-full" value={certNumber} maxLength={120} onChange={(e) => setCertNumber(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ts-docurl">Document URL (optional)</label>
            <input id="ts-docurl" className="input w-full" value={documentUrl} maxLength={1000} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://" />
          </div>
        </div>
        {err && <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving || !certId}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : 'Save certification'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
