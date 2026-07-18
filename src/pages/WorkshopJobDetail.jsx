import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToPdf } from '../lib/exportUtils'
import { formatDate, formatDateTime } from '../lib/formatters'
import { SkeletonCards } from '../components/ui/Skeleton'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Wrench, ArrowLeft, AlertTriangle, FileText, Lock,
  BarChart2, DollarSign, Package, ShieldCheck,
} from 'lucide-react'

// ── Same field selection as the Workshop directory, so the detail page reads an
//    identical record shape (aliases: assigned_to, scheduled_date). `score` /
//    `quality_score` feed the QA approval routing context. ─────────────────────
const WO_SELECT =
  'id,work_order_no,asset_no,status,priority,work_type,site,assigned_to:technician_name,' +
  'labour_cost,parts_cost,total_cost,created_at,completed_at,scheduled_date:target_completion,' +
  'description,parts_used,country,score,quality_score'

const DETAIL_TABS = ['overview', 'costs', 'parts', 'approval']

// ── Helpers (mirror WorkshopManagement formulas exactly) ─────────────────────────
function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtHours(h) {
  if (h == null || !isFinite(h) || h < 0) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '0.0%'
  return `${v.toFixed(1)}%`
}

function turnaroundHours(row) {
  if (!row?.created_at || !row?.completed_at) return null
  const diff = new Date(row.completed_at) - new Date(row.created_at)
  if (diff < 0) return null
  return diff / 3_600_000
}

function isOnTime(row) {
  if (!row?.completed_at || !row?.scheduled_date) return null
  return new Date(row.completed_at) <= new Date(row.scheduled_date)
}

function statusBadgeClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'open':           return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'in progress':    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'awaiting parts': return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'completed':      return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'cancelled':      return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
    default:               return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
  }
}

function priorityBadgeClass(priority) {
  switch ((priority || '').toLowerCase()) {
    case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'high':     return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'medium':   return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'low':      return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
    default:         return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
  }
}

function parseParts(job) {
  try {
    return typeof job?.parts_used === 'string' ? JSON.parse(job.parts_used) : (job?.parts_used || [])
  } catch { return [] }
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function WorkshopJobDetail() {
  const { jobId } = useParams()
  const id = decodeURIComponent(jobId || '')
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Approval-engine gate — while this work order's QA sign-off workflow is active
  // (pending/in_review/returned) or locked (approved), its strongest per-record
  // action (the Job Card export) is disabled so an in-approval job can't be
  // exported out from under the workflow. Server RLS remains the real boundary;
  // this is the client-side convenience guard. Resets when the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [id])

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setJob(null); return }
    setLoading(true)
    setError(null)
    try {
      // Fetch by id first; fall back to human-readable work_order_no so links
      // built from either identifier resolve. Country scope keeps the detail
      // page consistent with the directory's active-country filter.
      const scoped = activeCountry && activeCountry !== 'All' ? activeCountry : null
      let q = supabase.from('work_orders').select(WO_SELECT).limit(1)
      q = /^[0-9a-f-]{16,}$/i.test(id) ? q.eq('id', id) : q.eq('work_order_no', id)
      if (scoped) q = q.eq('country', scoped)
      const { data, error: err } = await q.maybeSingle()
      if (err) { setError(toUserMessage(err, 'Could not load the job.')); setJob(null) }
      else setJob(data || null)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the job.'))
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [id, activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { setActiveTab('overview') }, [id])

  const parts = useMemo(() => parseParts(job), [job])
  const ta = useMemo(() => turnaroundHours(job), [job])
  const ot = useMemo(() => isOnTime(job), [job])

  const handleExportJobCard = useCallback(() => {
    if (!job || wfLocked) return
    exportToPdf(
      [{
        work_order_no: job.work_order_no ?? job.id,
        asset_no: job.asset_no ?? '',
        site: job.site ?? '',
        work_type: job.work_type ?? '',
        priority: job.priority ?? '',
        status: job.status ?? '',
        assigned_to: job.assigned_to ?? '',
        created_at: job.created_at ? formatDateTime(job.created_at) : '',
        scheduled_date: job.scheduled_date ? formatDate(job.scheduled_date) : '',
        completed_at: job.completed_at ? formatDateTime(job.completed_at) : '',
        labour_cost: job.labour_cost ?? 0,
        parts_cost: job.parts_cost ?? 0,
        total_cost: job.total_cost ?? 0,
      }],
      [
        { key: 'work_order_no', header: 'WO No' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'work_type', header: 'Work Type' },
        { key: 'priority', header: 'Priority' },
        { key: 'status', header: 'Status' },
        { key: 'assigned_to', header: 'Assigned To' },
        { key: 'created_at', header: 'Created' },
        { key: 'scheduled_date', header: 'Scheduled' },
        { key: 'completed_at', header: 'Completed' },
        { key: 'labour_cost', header: 'Labour Cost' },
        { key: 'parts_cost', header: 'Parts Cost' },
        { key: 'total_cost', header: 'Total Cost' },
      ],
      `Workshop Job Card: ${job.work_order_no ?? job.id}`,
      `TyrePulse_Workshop_JobCard_${job.work_order_no ?? job.id}`,
      'landscape',
    )
  }, [job, wfLocked])

  const backBtn = (
    <button
      onClick={() => navigate('/workshop')}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors"
    >
      <ArrowLeft size={14} /> {t('workshop.detail.back')}
    </button>
  )

  // ── States: loading / error / not-found ────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {backBtn}
        <SkeletonCards count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
            <p className="text-red-400 font-medium">{t('workshop.detail.loadFailed')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">
              {t('workshop.detail.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState
          icon={Wrench}
          title={t('workshop.detail.notFoundTitle')}
          description={t('workshop.detail.notFoundDesc', { id })}
        />
      </div>
    )
  }

  const coreFields = [
    { label: t('workshop.detail.fields.asset'), value: job.asset_no },
    { label: t('workshop.detail.fields.site'), value: job.site },
    { label: t('workshop.detail.fields.workType'), value: job.work_type },
    { label: t('workshop.detail.fields.assignedTo'), value: job.assigned_to },
    { label: t('workshop.detail.fields.created'), value: job.created_at ? formatDateTime(job.created_at) : '-' },
    { label: t('workshop.detail.fields.scheduled'), value: job.scheduled_date ? formatDate(job.scheduled_date) : '-' },
    { label: t('workshop.detail.fields.completed'), value: job.completed_at ? formatDateTime(job.completed_at) : '-' },
    { label: t('workshop.detail.fields.turnaround'), value: fmtHours(ta) },
  ]

  const TABS = [
    { id: 'overview', label: t('workshop.detail.tabs.overview'), icon: BarChart2 },
    { id: 'costs', label: t('workshop.detail.tabs.costs'), icon: DollarSign },
    { id: 'parts', label: t('workshop.detail.tabs.parts'), icon: Package },
    { id: 'approval', label: t('workshop.detail.tabs.approval'), icon: ShieldCheck },
  ]

  const total = Number(job.total_cost) || 0
  const labourPct = total > 0 ? ((job.labour_cost || 0) / total) * 100 : null
  const partsPct = total > 0 ? ((job.parts_cost || 0) / total) * 100 : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          {backBtn}
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('workshop.detail.eyebrow')}</p>
            <h1 className="text-lg font-bold text-[var(--text-primary)] mt-0.5 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-400" />
              {job.work_order_no || job.id}
            </h1>
          </div>
        </div>
        <button
          onClick={handleExportJobCard}
          disabled={wfLocked}
          title={wfLocked ? t('workshop.detail.export.locked') : t('workshop.detail.export.tooltip')}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
        >
          {wfLocked ? <Lock size={14} /> : <FileText size={14} />} {t('workshop.detail.export.jobCard')}
        </button>
      </div>

      {/* Status & Priority */}
      <div className="flex gap-2 flex-wrap">
        {job.status && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusBadgeClass(job.status)}`}>{job.status}</span>
        )}
        {job.priority && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${priorityBadgeClass(job.priority)}`}>{job.priority}</span>
        )}
        {ot != null && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${ot ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
            {ot ? t('workshop.detail.onTime') : t('workshop.detail.late')}
          </span>
        )}
      </div>

      {wfLocked && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
          <Lock size={12} />
          {t('workshop.detail.approval.locked')}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Overview */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {coreFields.map(({ label, value }) => (
                <div key={label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
                  <p className="text-sm text-[var(--text-primary)] font-medium">{value || '-'}</p>
                </div>
              ))}
            </div>

            {job.description && (
              <div>
                <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('workshop.detail.description')}</h3>
                <p className="text-sm text-[var(--text-secondary)] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-4 leading-relaxed">
                  {job.description}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Costs */}
        {activeTab === 'costs' && (
          <motion.div
            key="costs"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('workshop.detail.cost.heading')}</h3>
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              {[
                { label: t('workshop.detail.cost.labour'), value: job.labour_cost, color: 'bg-blue-500' },
                { label: t('workshop.detail.cost.parts'), value: job.parts_cost, color: 'bg-purple-500' },
                { label: t('workshop.detail.cost.total'), value: job.total_cost, color: 'bg-green-500', bold: true },
              ].map(({ label, value, color, bold }) => (
                <div key={label} className={`flex items-center justify-between px-4 py-3 ${bold ? 'border-t border-[var(--input-border)]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${color}`} />
                    <span className={`text-sm ${bold ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>{label}</span>
                  </div>
                  <span className={`text-sm font-medium ${bold ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {fmtCurrency(value, activeCurrency)}
                  </span>
                </div>
              ))}
            </div>
            {total > 0 && (
              <div className="mt-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-3">
                <div className="flex gap-1 h-3 rounded overflow-hidden">
                  <div className="bg-blue-500 rounded-l" style={{ width: `${((job.labour_cost || 0) / total) * 100}%` }} />
                  <div className="bg-purple-500 rounded-r" style={{ width: `${((job.parts_cost || 0) / total) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-[var(--text-muted)]">
                  <span>{t('workshop.detail.cost.labourShare', { pct: fmtPct(labourPct) })}</span>
                  <span>{t('workshop.detail.cost.partsShare', { pct: fmtPct(partsPct) })}</span>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Parts */}
        {activeTab === 'parts' && (
          <motion.div
            key="parts"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('workshop.detail.parts.heading')}</h3>
            {parts.length === 0 ? (
              <EmptyState icon={Package} compact description={t('workshop.detail.parts.empty')} />
            ) : (
              <div className="space-y-2">
                {parts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-4 py-2.5">
                    <span className="text-sm text-[var(--text-secondary)]">
                      {p.name || p.part_name || p.description || t('workshop.detail.parts.fallbackName', { n: i + 1 })}
                    </span>
                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      {p.qty != null && <span>{t('workshop.detail.parts.qty', { qty: p.qty })}</span>}
                      {p.cost != null && <span className="text-[var(--text-secondary)]">{fmtCurrency(p.cost, activeCurrency)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* QA Approval — Approval & Workflow Engine.
            A workshop job / quality-inspection sign-off warrants approval before
            the job card is exported downstream. Smart rules may route high-cost
            or overdue jobs to a manager. Mirrors WorkOrders / Retread wiring. */}
        {activeTab === 'approval' && (
          <motion.div
            key="approval"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <EntityApprovalPanel
              entityType="workshop_qa"
              entityId={job.id}
              entityLabel={job.work_order_no || job.asset_no || job.id}
              context={{
                score: job.score ?? job.quality_score,
                status: job.status,
                workshop: job.site,
                work_type: job.work_type,
                total_cost: Number(job.total_cost) || 0,
                site: job.site,
              }}
              onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
              title={t('workshop.detail.approval.title')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
