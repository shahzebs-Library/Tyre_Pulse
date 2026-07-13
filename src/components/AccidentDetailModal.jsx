/**
 * AccidentDetailModal.jsx
 *
 * Deep claims-management view for one accident (web). Historically a modal;
 * now the file also exports a full-page route component (`AccidentDetailPage`,
 * the default export) rendered at `/accidents/:id`. Tabs: Overview, Tracker,
 * Claim & Recovery, Parts & Repairs, Case Log, Activity, and the close →
 * admin-approval workflow. Backed by MIGRATIONS_V19 tables + RPCs. The
 * universal approval engine is mounted as an anchored side panel.
 *
 * The reusable `AccidentDetail` inner component holds all tab logic and is
 * consumed by the page shell; the legacy modal wrapper is kept exported for
 * backward compatibility but is no longer used by the Accidents page.
 */

import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  X, Save, Plus, Trash2, Send, Lock, CheckCircle2, XCircle,
  ShieldCheck, Hourglass, FileText, Wrench, MessageSquare, Briefcase, History, User, ClipboardList,
  ArrowLeft, AlertOctagon, ChevronRight, Download, Loader2, ShieldAlert, Clock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useSites } from '../hooks/useSites'
import { formatCurrency as _fmtCurrencyBase } from '../lib/formatters'
import { exportAccidentCasePdf } from '../lib/exportUtils'
import { describeAuditRow } from '../lib/auditDiff'
import { resolveStorageUrls } from '../lib/storageRefs'
import CustomFieldsPanel from './CustomFieldsPanel'
import CopilotCard from './ai/CopilotCard'
import EntityApprovalPanel from './workflow/EntityApprovalPanel'

// Display canonicalisation — mirrors Accidents.jsx so the DB's lowercase
// severity/status render as human labels in the detail view too.
const SEVERITY_ALIAS = { minor: 'Minor', moderate: 'Major', major: 'Major', severe: 'Total Loss', fatal: 'Total Loss', 'total loss': 'Total Loss' }
const STATUS_ALIAS = {
  reported: 'Reported', under_review: 'Under Investigation', under_investigation: 'Under Investigation',
  repair_in_progress: 'Repair In Progress', awaiting_parts: 'Awaiting Parts',
  awaiting_approval: 'Awaiting Approval', insurance_claim: 'Insurance Claim', closed: 'Closed',
}
const canonSeverity = (s) => SEVERITY_ALIAS[String(s || '').toLowerCase()] || s || ''
const canonStatus = (s) => STATUS_ALIAS[String(s || '').toLowerCase().replace(/\s+/g, '_')] || s || ''

const SEVERITY_BADGE = {
  Minor:        'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
  Major:        'bg-orange-900/50 text-orange-300 border border-orange-700/50',
  'Total Loss': 'bg-red-900/50 text-red-300 border border-red-700/50',
}

const RECOVERY_SOURCES = ['none', 'insurer', 'third_party', 'driver', 'warranty']
const RECOVERY_SOURCE_LABELS = { none: 'None', insurer: 'Insurer', third_party: 'Third Party', driver: 'Driver', warranty: 'Warranty' }
const RECOVERY_STATUSES = ['pending', 'partial', 'recovered', 'written_off']
const RECOVERY_STATUS_LABELS = { pending: 'Pending', partial: 'Partial', recovered: 'Recovered', written_off: 'Written Off' }
const RECOVERY_BADGE = {
  pending:     'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  partial:     'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  recovered:   'bg-green-900/50 text-green-300 border border-green-700/50',
  written_off: 'bg-red-900/50 text-red-300 border border-red-700/50',
}

const CLAIM_STATUSES = ['none', 'filed', 'approved', 'rejected', 'settled']
const CLAIM_LABELS = { none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled' }
const CLAIM_BADGE = {
  none:     'bg-gray-800 text-gray-300 border border-gray-600',
  filed:    'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  approved: 'bg-green-900/50 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/50 text-red-300 border border-red-700/50',
  settled:  'bg-purple-900/50 text-purple-300 border border-purple-700/50',
}

const PART_STATUSES = ['needed', 'ordered', 'received', 'fitted']
const PART_LABELS = { needed: 'Needed', ordered: 'Ordered', received: 'Received', fitted: 'Fitted' }
const PART_BADGE = {
  needed:   'bg-yellow-900/50 text-yellow-300',
  ordered:  'bg-blue-900/50 text-blue-300',
  received: 'bg-purple-900/50 text-purple-300',
  fitted:   'bg-green-900/50 text-green-300',
}

const REMARK_DOT = {
  note: 'bg-gray-500', insurance: 'bg-blue-500', repair: 'bg-orange-500',
  responsibility: 'bg-purple-500', status_change: 'bg-sky-500',
  closure_request: 'bg-yellow-500', closure_approved: 'bg-green-500', closure_rejected: 'bg-red-500',
}

function isElevated(role) {
  return ['admin', 'manager', 'director'].includes(String(role || '').toLowerCase().replace(/\s+/g, '_'))
}

// Suggested vocabularies for the case tracker. Rendered as datalist dropdowns —
// operators pick a common value fast but can still type a bespoke one.
const CASE_STAGE_OPTIONS = [
  'Reported', 'Internal Report Preparation', 'Under Investigation', 'Insurance Filed',
  'Awaiting Assessment', 'Under Repair', 'Awaiting Parts', 'Repair Completed',
  'Claim Settlement', 'Closed',
]
const DAMAGE_CONDITION_OPTIONS = ['Minor', 'Moderate', 'Major Repair', 'Total Loss', 'Cosmetic', 'Structural']
const CURRENT_STATUS_OPTIONS = [
  'Reported', 'Under Investigation', 'Under Repair', 'Awaiting Parts',
  'Awaiting Approval', 'Insurance Claim', 'Repair Completed', 'Closed',
]

// ── GCC accident case-management vocabularies (V219) ──────────────────────────
// Ordered case lifecycle used by the Repair & Insurance workflow selectors.
const WORKFLOW_STAGES = [
  'Reported', 'Under assessment', 'Waiting insurance approval', 'Insurance approved',
  'In repair', 'Waiting release', 'Released', 'Closed',
]
// Terminal stages — a case at/after these is NOT delayed and needs no next step.
const TERMINAL_STAGES = ['released', 'closed']
// A workflow stage that implies a claim_status so the two stay in lockstep on save.
const STAGE_TO_CLAIM_STATUS = {
  'waiting insurance approval': 'filed',
  'insurance approved': 'approved',
  'closed': 'settled',
}
const DAMAGE_CLASS_OPTIONS = ['Major', 'Minor']
const FAULT_STATUS_OPTIONS = ['Faulty', 'Non-faulty', 'Under review']
const NAJM_STATUS_OPTIONS = ['Najm report', 'No Najm']
const NAJM_FAULT_OPTIONS = ['Faulty', 'Non-faulty', 'N/A']
const TAQDEER_STATUS_OPTIONS = ['Taqdeer report', 'No Taqdeer']
const LIABILITY_RATIO_OPTIONS = [0, 50, 100]
const REPAIR_TYPE_OPTIONS = ['Internal', 'External']

// Days a still-open case may sit without a status update before it is "Delayed".
const DELAY_THRESHOLD_DAYS = 5

// Whole days elapsed since `dateStr` (YYYY-MM-DD / ISO), or null when unparseable.
function daysSince(dateStr) {
  if (!dateStr) return null
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

// A case is delayed when it is still open (not Released/Closed) and the last
// movement (status_update_date, else incident_date) is older than the threshold.
function computeDelay(acc, closure) {
  const stage = String(acc?.current_status || acc?.status || '').toLowerCase()
  const isTerminal = closure === 'closed' || TERMINAL_STAGES.some(s => stage.includes(s))
  if (isTerminal) return { delayed: false, days: null }
  const days = daysSince(acc?.status_update_date || acc?.incident_date)
  return { delayed: days != null && days > DELAY_THRESHOLD_DAYS, days }
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: FileText },
  { key: 'tracker',  label: 'Tracker', icon: ClipboardList },
  { key: 'repair',   label: 'Repair & Insurance', icon: ShieldAlert },
  { key: 'claim',    label: 'Claim & Recovery', icon: Briefcase },
  { key: 'parts',    label: 'Parts & Repairs', icon: Wrench },
  { key: 'log',      label: 'Case Log', icon: MessageSquare },
  { key: 'activity', label: 'Activity', icon: History },
  { key: 'closure',  label: 'Closure', icon: Lock },
]

/**
 * AccidentDetailPage — full-page route component for `/accidents/:id`.
 *
 * Replaces the former modal. Renders a breadcrumb + back control, a live
 * financial summary rail, the full tabbed claims workspace, and the universal
 * approval engine anchored as a companion panel. All tab components below are
 * preserved verbatim from the modal implementation.
 */
export default function AccidentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const back = useCallback(() => navigate('/accidents'), [navigate])
  return <AccidentDetail accidentId={id} onBack={back} variant="page" />
}

/**
 * AccidentDetail — the claims workspace body (loader, header, tabs, approval
 * rail). `variant="page"` renders the full-page shell; `variant="modal"` keeps
 * the legacy overlay presentation for the compatibility wrapper below.
 */
function AccidentDetail({ accidentId, onBack, onClose, onChanged, variant = 'page' }) {
  const { profile } = useAuth()
  const { activeCurrency } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || 'TyrePulse'
  const elevated = isElevated(profile?.role)
  const fmtCurrency = (v) => _fmtCurrencyBase(v, activeCurrency, 0)
  const [downloading, setDownloading] = useState(false)

  const [tab, setTab] = useState('overview')
  const [acc, setAcc] = useState(null)
  const [remarks, setRemarks] = useState([])
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Approval-engine lock state for this accident (drives the header banner).
  const [wf, setWf] = useState({ isActive: false, isLocked: false, status: null })
  const handleWfStateChange = useCallback((next) => {
    setWf(prev =>
      prev.isActive === next.isActive && prev.isLocked === next.isLocked && prev.status === next.status
        ? prev : next,
    )
  }, [])

  const load = useCallback(async () => {
    const [a, r, p] = await Promise.all([
      supabase.from('accidents').select('*').eq('id', accidentId).single(),
      supabase.from('accident_remarks').select('*').eq('accident_id', accidentId).order('created_at', { ascending: false }),
      supabase.from('accident_parts').select('*').eq('accident_id', accidentId).order('created_at', { ascending: true }),
    ])
    if (a.error) { setErr(a.error.message); setLoading(false); return }
    setAcc(a.data)
    setRemarks(r.data ?? [])
    setParts(p.data ?? [])
    setLoading(false)
  }, [accidentId])

  useEffect(() => { setLoading(true); setErr(''); load() }, [load])

  const { options: siteOptions } = useSites(acc?.country)
  const closure = acc?.closure_status ?? 'open'
  const partsTotal = parts.reduce((s, p) => s + (Number(p.total_cost) || 0), 0)
  const delay = useMemo(() => computeDelay(acc, closure), [acc, closure])
  const DelayBadge = () =>
    delay.delayed ? (
      <span
        className="badge text-xs bg-red-600 text-white border border-red-500 flex items-center gap-1 animate-pulse"
        title={`Case still open with no update for ${delay.days} days (threshold ${DELAY_THRESHOLD_DAYS})`}
      >
        <Clock size={10} /> Delayed {delay.days}d
      </span>
    ) : null

  const downloadCase = useCallback(async () => {
    if (!acc) return
    setDownloading(true); setErr('')
    try {
      await exportAccidentCasePdf(acc, { parts, remarks, branding, company, fmtCurrency })
    } catch (e) {
      setErr(e?.message || 'Could not generate the case PDF.')
    } finally {
      setDownloading(false)
    }
  }, [acc, parts, remarks, branding, company]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live financial rail — gross cost, recovered, net exposure.
  const money = useMemo(() => {
    const repair = Number(acc?.repair_cost) || 0
    const partsC = Number(acc?.parts_cost) || partsTotal
    const gross = repair + partsC
    const recovered = Number(acc?.recovered_amount) || 0
    return { gross, recovered, net: Math.max(0, gross - recovered) }
  }, [acc, partsTotal])

  async function runRpc(fn, args) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    await load(); onChanged?.()
    return true
  }

  const dismiss = onBack || onClose

  // ── Loading / not-found (page variant renders real skeleton + retry) ──
  if (loading) {
    if (variant === 'modal') {
      return (
        <Backdrop onClose={onClose}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-12 text-center text-gray-500">Loading...</div>
        </Backdrop>
      )
    }
    return (
      <div className="space-y-4">
        <button onClick={dismiss} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={15} /> Back to Accidents</button>
        <div className="card animate-pulse space-y-3">
          <div className="h-6 w-48 bg-[var(--input-bg)] rounded" />
          <div className="h-4 w-72 bg-[var(--input-bg)] rounded" />
          <div className="grid grid-cols-3 gap-3 pt-2">
            {[0, 1, 2].map(i => <div key={i} className="h-16 bg-[var(--input-bg)] rounded" />)}
          </div>
        </div>
        <div className="card animate-pulse h-64" />
      </div>
    )
  }
  if (!acc) {
    if (variant === 'modal') {
      return (
        <Backdrop onClose={onClose}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-12 text-center text-red-400">{err || 'Not found'}</div>
        </Backdrop>
      )
    }
    return (
      <div className="space-y-4">
        <button onClick={dismiss} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={15} /> Back to Accidents</button>
        <div className="card text-center py-12 space-y-3">
          <AlertOctagon size={32} className="mx-auto text-red-400" />
          <p className="text-[var(--text-primary)] font-semibold">Accident record not found</p>
          <p className="text-sm text-[var(--text-muted)]">{err || 'This record may have been deleted or you do not have access.'}</p>
          <button onClick={load} className="btn-secondary text-sm mx-auto">Retry</button>
        </div>
      </div>
    )
  }

  const body = (
    <>
      {/* Tabs */}
      <div className="flex gap-1 px-4 border-b border-gray-800 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {err && <div className="mx-6 mt-4 bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">{err}</div>}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'overview'  && (
          <div className="space-y-4">
            <CopilotCard task="summarize_accident" context={{ accident: acc, remarks, parts }} />
            <OverviewTab acc={acc} fmtCurrency={fmtCurrency} />
          </div>
        )}
        {tab === 'tracker'   && <TrackerTab acc={acc} elevated={elevated} siteOptions={siteOptions} onSaved={() => { load(); onChanged?.() }} setErr={setErr} />}
        {tab === 'repair'    && <RepairInsuranceTab acc={acc} elevated={elevated} onSaved={() => { load(); onChanged?.() }} setErr={setErr} fmtCurrency={fmtCurrency} />}
        {tab === 'claim'     && <ClaimTab acc={acc} elevated={elevated} onSaved={() => { load(); onChanged?.() }} setErr={setErr} fmtCurrency={fmtCurrency} />}
        {tab === 'parts'     && <PartsTab acc={acc} parts={parts} partsTotal={partsTotal} elevated={elevated} profile={profile} reload={() => { load(); onChanged?.() }} setErr={setErr} fmtCurrency={fmtCurrency} />}
        {tab === 'log'       && <LogTab acc={acc} remarks={remarks} profile={profile} reload={load} setErr={setErr} />}
        {tab === 'activity'  && <ActivityTab accidentId={acc.id} />}
        {tab === 'closure'   && (
          <ClosureTab
            acc={acc} closure={closure} elevated={elevated} busy={busy}
            onRequest={(note) => runRpc('request_accident_closure', { p_accident_id: acc.id, p_note: note || null })}
            onApprove={() => runRpc('approve_accident_closure', { p_accident_id: acc.id })}
            onReject={(reason) => runRpc('reject_accident_closure', { p_accident_id: acc.id, p_reason: reason || null })}
          />
        )}
      </div>
    </>
  )

  // ── Legacy modal presentation (compatibility only) ──
  if (variant === 'modal') {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl my-4 flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <div className="flex items-center gap-3 min-w-0">
              <AlertCircleHeaderIcon />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">
                  {acc.asset_no || 'Accident'} <span className="text-gray-500 font-normal">· #{String(acc.id).slice(0, 8).toUpperCase()}</span>
                </h2>
                <p className="text-xs text-gray-500">{acc.site || '-'} · {acc.incident_date ? new Date(acc.incident_date).toLocaleDateString() : '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DelayBadge />
              <ClosureBadge closure={closure} />
              <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
          </div>
          {body}
        </div>
      </Backdrop>
    )
  }

  // ── Full-page presentation ──
  const severity = canonSeverity(acc.severity)
  const status = canonStatus(acc.status)
  return (
    <div className="space-y-4 pb-24">
      {/* Breadcrumb + back + case actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <button onClick={dismiss} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={13} /> Accidents
          </button>
          <ChevronRight size={12} />
          <span className="text-[var(--text-dim)]">{acc.asset_no || 'Incident'} · #{String(acc.id).slice(0, 8).toUpperCase()}</span>
        </div>
        <button
          onClick={downloadCase}
          disabled={downloading}
          className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
          title="Download the full case as a branded PDF"
        >
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {downloading ? 'Preparing…' : 'Download Case'}
        </button>
      </div>

      {/* Header card + financial rail */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircleHeaderIcon />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">
                {acc.asset_no || 'Accident'}
                <span className="text-[var(--text-muted)] font-normal text-base"> · #{String(acc.id).slice(0, 8).toUpperCase()}</span>
              </h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {acc.site || '-'}{acc.country ? ` · ${acc.country}` : ''} · {acc.incident_date ? new Date(acc.incident_date).toLocaleDateString() : '-'}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {severity && <span className={`badge text-xs ${SEVERITY_BADGE[severity] ?? 'bg-gray-800 text-gray-300'}`}>{severity}</span>}
                {status && <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">{status}</span>}
                <ClosureBadge closure={closure} />
                <DelayBadge />
                {wf.isActive && <span className="badge text-xs bg-purple-900/50 text-purple-300 border border-purple-700/50 flex items-center gap-1"><Lock size={10} /> In approval</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/50 px-4 py-3">
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Gross cost</p><p className="text-sm font-bold text-[var(--text-primary)]">{fmtCurrency(money.gross)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Recovered</p><p className="text-sm font-bold text-green-400">{fmtCurrency(money.recovered)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Net exposure</p><p className="text-sm font-bold text-orange-400">{fmtCurrency(money.net)}</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main workspace */}
        <div className="lg:col-span-2 card p-0 flex flex-col overflow-hidden">
          {body}
        </div>
        {/* Approval engine rail */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4">
            <EntityApprovalPanel
              entityType="accident"
              entityId={acc.id}
              entityLabel={acc.insurance_claim_no || acc.policy_no || acc.asset_no || acc.id}
              context={{
                severity,
                is_major: ['Major', 'Total Loss'].includes(severity),
                estimated_cost: Number(acc.estimated_damage_cost) || Number(acc.repair_cost) || 0,
                repair_cost: Number(acc.repair_cost) || 0,
                parts_cost: Number(acc.parts_cost) || 0,
                claim_amount: Number(acc.claim_amount) || 0,
                country: acc.country || null,
                site: acc.site || null,
              }}
              title="Accident Approval"
              onStateChange={handleWfStateChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * AccidentDetailModal — legacy overlay wrapper. Retained for backward
 * compatibility; the Accidents page now navigates to the `/accidents/:id`
 * route instead. Not used internally.
 */
export function AccidentDetailModal({ accidentId, onClose, onChanged }) {
  return <AccidentDetail accidentId={accidentId} onClose={onClose} onChanged={onChanged} variant="modal" />
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function OverviewTab({ acc, fmtCurrency }) {
  const photos = Array.isArray(acc.photos) ? acc.photos.filter(Boolean) : []
  const [resolvedPhotos, setResolvedPhotos] = useState([])

  useEffect(() => {
    let mounted = true
    resolveStorageUrls(photos).then(urls => {
      if (mounted) setResolvedPhotos(urls)
    })
    return () => { mounted = false }
  }, [JSON.stringify(photos)])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KV label="Severity" value={acc.severity} />
        <KV label="Status" value={acc.status} />
        <KV label="Country" value={acc.country} />
        <KV label="Repair cost" value={acc.repair_cost != null ? fmtCurrency(acc.repair_cost) : '-'} />
        <KV label="Parts cost" value={acc.parts_cost != null ? fmtCurrency(acc.parts_cost) : '-'} />
        <KV label="Insurance claim no" value={acc.insurance_claim_no} />
        <KV label="Inspector" value={acc.inspector} />
        <KV label="Reported" value={acc.created_at ? new Date(acc.created_at).toLocaleString() : '-'} />
      </div>
      {acc.description && (
        <div>
          <p className="label">Description</p>
          <p className="text-sm text-gray-300 leading-relaxed mt-1">{acc.description}</p>
        </div>
      )}
      {resolvedPhotos.length > 0 && (
        <div>
          <p className="label mb-2">Photos ({resolvedPhotos.length})</p>
          <div className="flex flex-wrap gap-2">
            {resolvedPhotos.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={`Photo ${i + 1}`} className="h-20 w-20 object-cover rounded border border-gray-700 hover:border-green-500 transition-colors" />
              </a>
            ))}
          </div>
        </div>
      )}
      <CustomFieldsPanel data={acc.custom_data} title="Additional imported fields" />
    </div>
  )
}

function TrackerTab({ acc, elevated, siteOptions = [], onSaved, setErr }) {
  const [f, setF] = useState({
    site: acc.site ?? '',
    location: acc.location ?? '',
    incident_date: acc.incident_date ? String(acc.incident_date).slice(0, 10) : '',
    liable_party: acc.liable_party ?? '',
    case_stage: acc.case_stage ?? '',
    damage_condition: acc.damage_condition ?? '',
    current_status: acc.current_status ?? '',
    action_to_be_taken: acc.action_to_be_taken ?? '',
    responsible_owner: acc.responsible_owner ?? '',
    required_action: acc.required_action ?? '',
    status_update_date: acc.status_update_date ?? '',
    status_update_note: acc.status_update_note ?? '',
    expected_release_date: acc.expected_release_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('accidents').update({
      site: f.site || null,
      location: f.location || null,
      incident_date: f.incident_date || null,
      liable_party: f.liable_party || null,
      case_stage: f.case_stage || null,
      damage_condition: f.damage_condition || null,
      current_status: f.current_status || null,
      action_to_be_taken: f.action_to_be_taken || null,
      responsible_owner: f.responsible_owner || null,
      required_action: f.required_action || null,
      status_update_date: f.status_update_date || null,
      status_update_note: f.status_update_note || null,
      expected_release_date: f.expected_release_date || null,
    }).eq('id', acc.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  if (!elevated) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <KV label="Site" value={acc.site} />
          <KV label="Location" value={acc.location} />
          <KV label="Liability" value={acc.liable_party} highlight />
          <KV label="Case stage" value={acc.case_stage} />
          <KV label="Damage condition" value={acc.damage_condition} />
          <KV label="Current status" value={acc.current_status} highlight />
          <KV label="Action to be taken" value={acc.action_to_be_taken} />
          <KV label="Responsible owner" value={acc.responsible_owner} />
          <KV label="Required action" value={acc.required_action} />
          <KV label="Expected release" value={acc.expected_release_date} />
        </div>
        {acc.status_update_note && <KV label="Status update note" value={acc.status_update_note} />}
        <p className="text-xs text-gray-600">Only Admin / Manager / Director can edit tracker details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Picker label="Site" value={f.site} onChange={v => set('site', v)} options={siteOptions} placeholder="Select or type a site" />
        <Inp label="Incident date" type="date" value={f.incident_date} onChange={v => set('incident_date', v)} />
        <Picker label="Location" value={f.location} onChange={v => set('location', v)} options={siteOptions} placeholder="e.g. GCC Plant" />
        <Inp label="Liability" value={f.liable_party} onChange={v => set('liable_party', v)} placeholder="e.g. 100% Third Party Liability" />
        <Picker label="Case stage" value={f.case_stage} onChange={v => set('case_stage', v)} options={CASE_STAGE_OPTIONS} placeholder="e.g. Under Investigation" />
        <Picker label="Damage condition" value={f.damage_condition} onChange={v => set('damage_condition', v)} options={DAMAGE_CONDITION_OPTIONS} placeholder="Minor / Major Repair" />
        <Picker label="Current status" value={f.current_status} onChange={v => set('current_status', v)} options={CURRENT_STATUS_OPTIONS} placeholder="e.g. Under Repair" />
        <Inp label="Responsible owner" value={f.responsible_owner} onChange={v => set('responsible_owner', v)} placeholder="Accountable person" />
      </div>
      <Inp label="Action to be taken" value={f.action_to_be_taken} onChange={v => set('action_to_be_taken', v)} placeholder="Next step" />
      <Inp label="Required action / progress" value={f.required_action} onChange={v => set('required_action', v)} placeholder="Latest progress note" />
      <div className="grid grid-cols-2 gap-3">
        <Inp label="Status update date" type="date" value={f.status_update_date} onChange={v => set('status_update_date', v)} />
        <Inp label="Expected release date" type="date" value={f.expected_release_date} onChange={v => set('expected_release_date', v)} />
      </div>
      <Inp label="Status update note" value={f.status_update_note} onChange={v => set('status_update_note', v)} placeholder="Optional note for this update" />
      <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Save size={16} /> {saving ? 'Saving...' : 'Save Tracker'}
      </button>
    </div>
  )
}

// ── Repair & Insurance — Case Management (V219 GCC fields) ─────────────────────
// Damage/fault classification, Najm + Taqdeer report state, GCC liability ratio,
// repair route, the case workflow (current stage → next step, kept in lockstep
// with claim_status), and workshop financials with an auto-suggested final
// amount. Persists via a single accidents UPDATE; honest read-only view for
// non-elevated roles.
function RepairInsuranceTab({ acc, elevated, onSaved, setErr, fmtCurrency }) {
  const [f, setF] = useState({
    damage_class: acc.damage_class ?? '',
    fault_status: acc.fault_status ?? '',
    najm_status: acc.najm_status ?? '',
    najm_fault: acc.najm_fault ?? '',
    taqdeer_status: acc.taqdeer_status ?? '',
    gcc_liability_ratio: acc.gcc_liability_ratio ?? '',
    repair_type: acc.repair_type ?? '',
    current_status: acc.current_status ?? '',
    next_step: acc.next_step ?? '',
    workshop_name: acc.workshop_name ?? '',
    workshop_quotation: acc.workshop_quotation ?? '',
    discount_pct: acc.discount_pct ?? '',
    final_amount: acc.final_amount ?? '',
    estimated_damage_cost: acc.estimated_damage_cost ?? '',
    repair_cost: acc.repair_cost ?? '',
    expected_release_date: acc.expected_release_date ? String(acc.expected_release_date).slice(0, 10) : '',
    release_date: acc.release_date ? String(acc.release_date).slice(0, 10) : '',
  })
  // Once the user hand-edits Final amount, stop auto-deriving it from qt/discount.
  const [finalTouched, setFinalTouched] = useState(acc.final_amount != null && acc.final_amount !== '')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Suggested final = quotation − discount%. Null when there is no quotation.
  const suggestedFinal = useMemo(() => {
    const q = Number(f.workshop_quotation)
    if (!f.workshop_quotation || Number.isNaN(q)) return null
    const d = Number(f.discount_pct) || 0
    return Math.max(0, Math.round((q * (1 - d / 100)) * 100) / 100)
  }, [f.workshop_quotation, f.discount_pct])

  // Auto-fill Final amount from the suggestion until the user overrides it.
  useEffect(() => {
    if (!finalTouched && suggestedFinal != null) {
      setF(p => (String(p.final_amount) === String(suggestedFinal) ? p : { ...p, final_amount: suggestedFinal }))
    }
  }, [suggestedFinal, finalTouched])

  const numOrNull = (v) => (v === '' || v == null ? null : Number(v))
  const strOrNull = (v) => (v && String(v).trim() ? v : null)

  async function save() {
    setSaving(true); setErr('')
    const patch = {
      damage_class: strOrNull(f.damage_class),
      fault_status: strOrNull(f.fault_status),
      najm_status: strOrNull(f.najm_status),
      najm_fault: strOrNull(f.najm_fault),
      taqdeer_status: strOrNull(f.taqdeer_status),
      gcc_liability_ratio: f.gcc_liability_ratio === '' ? null : Number(f.gcc_liability_ratio),
      repair_type: strOrNull(f.repair_type),
      current_status: strOrNull(f.current_status),
      next_step: strOrNull(f.next_step),
      workshop_name: strOrNull(f.workshop_name),
      workshop_quotation: numOrNull(f.workshop_quotation),
      discount_pct: numOrNull(f.discount_pct),
      final_amount: numOrNull(f.final_amount),
      estimated_damage_cost: numOrNull(f.estimated_damage_cost),
      repair_cost: numOrNull(f.repair_cost),
      expected_release_date: f.expected_release_date || null,
      release_date: f.release_date || null,
    }
    // Keep the insurance claim lifecycle in lockstep with the workflow stage.
    const mapped = STAGE_TO_CLAIM_STATUS[String(f.current_status || '').toLowerCase()]
    if (mapped) patch.claim_status = mapped
    const { error } = await supabase.from('accidents').update(patch).eq('id', acc.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  if (!elevated) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">Classification & Reports</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KV label="Damage class" value={acc.damage_class} />
            <KV label="Fault status" value={acc.fault_status} highlight />
            <KV label="GCC liability" value={acc.gcc_liability_ratio != null ? `${acc.gcc_liability_ratio}%` : '-'} highlight />
            <KV label="Najm" value={acc.najm_status} />
            <KV label="Najm fault" value={acc.najm_fault} />
            <KV label="Taqdeer" value={acc.taqdeer_status} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">Workflow</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KV label="Repair type" value={acc.repair_type} />
            <KV label="Current status" value={acc.current_status} highlight />
            <KV label="Next step" value={acc.next_step} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">Workshop & Financials</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KV label="Workshop" value={acc.workshop_name} />
            <KV label="Quotation" value={acc.workshop_quotation != null ? fmtCurrency(acc.workshop_quotation) : '-'} />
            <KV label="Discount" value={acc.discount_pct != null ? `${acc.discount_pct}%` : '-'} />
            <KV label="Final amount" value={acc.final_amount != null ? fmtCurrency(acc.final_amount) : '-'} highlight />
            <KV label="Estimated damage" value={acc.estimated_damage_cost != null ? fmtCurrency(acc.estimated_damage_cost) : '-'} />
            <KV label="Repair cost" value={acc.repair_cost != null ? fmtCurrency(acc.repair_cost) : '-'} />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">Release</p>
          <div className="grid grid-cols-2 gap-3">
            <KV label="Expected release" value={acc.expected_release_date} />
            <KV label="Actual release" value={acc.release_date} highlight />
          </div>
        </div>
        <p className="text-xs text-gray-600">Only Admin / Manager / Director can edit repair & insurance details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Classification & Reports */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">Classification & Reports</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Sel label="Damage class" value={f.damage_class} onChange={v => set('damage_class', v)} options={DAMAGE_CLASS_OPTIONS} />
          <Sel label="Fault status" value={f.fault_status} onChange={v => set('fault_status', v)} options={FAULT_STATUS_OPTIONS} />
          <Sel
            label="GCC liability ratio"
            value={f.gcc_liability_ratio === '' ? '' : String(f.gcc_liability_ratio)}
            onChange={v => set('gcc_liability_ratio', v)}
            options={LIABILITY_RATIO_OPTIONS.map(n => ({ value: String(n), label: `${n}%` }))}
          />
          <Sel label="Najm" value={f.najm_status} onChange={v => set('najm_status', v)} options={NAJM_STATUS_OPTIONS} />
          <Sel label="Najm fault" value={f.najm_fault} onChange={v => set('najm_fault', v)} options={NAJM_FAULT_OPTIONS} />
          <Sel label="Taqdeer" value={f.taqdeer_status} onChange={v => set('taqdeer_status', v)} options={TAQDEER_STATUS_OPTIONS} />
        </div>
      </div>

      {/* Workflow */}
      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs font-semibold text-gray-400 mb-2">Workflow</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Sel label="Repair type" value={f.repair_type} onChange={v => set('repair_type', v)} options={REPAIR_TYPE_OPTIONS} />
          <Sel label="Current status" value={f.current_status} onChange={v => set('current_status', v)} options={WORKFLOW_STAGES} />
          <Sel label="Next step" value={f.next_step} onChange={v => set('next_step', v)} options={WORKFLOW_STAGES} />
        </div>
        {STAGE_TO_CLAIM_STATUS[String(f.current_status || '').toLowerCase()] && (
          <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
            <ShieldCheck size={11} className="text-green-500" />
            Saving sets the insurance claim status to
            <span className="text-green-400 font-medium">
              {' '}{CLAIM_LABELS[STAGE_TO_CLAIM_STATUS[String(f.current_status).toLowerCase()]]}
            </span>.
          </p>
        )}
      </div>

      {/* Workshop & Financials */}
      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs font-semibold text-gray-400 mb-2">Workshop & Financials</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Inp label="Workshop name" value={f.workshop_name} onChange={v => set('workshop_name', v)} placeholder="Repairing workshop" />
          <Inp label="Workshop quotation" type="number" value={f.workshop_quotation} onChange={v => set('workshop_quotation', v)} />
          <Inp label="Discount %" type="number" value={f.discount_pct} onChange={v => set('discount_pct', v)} placeholder="0" />
          <div>
            <label className="label">Final amount</label>
            <input
              type="number"
              className="input"
              value={f.final_amount}
              onChange={e => { setFinalTouched(true); set('final_amount', e.target.value) }}
            />
            {suggestedFinal != null && String(f.final_amount) !== String(suggestedFinal) && (
              <button
                type="button"
                onClick={() => { setFinalTouched(true); set('final_amount', suggestedFinal) }}
                className="text-[11px] text-green-400 hover:text-green-300 mt-1"
              >
                Use suggested {fmtCurrency(suggestedFinal)}
              </button>
            )}
            {suggestedFinal != null && String(f.final_amount) === String(suggestedFinal) && (
              <p className="text-[11px] text-gray-500 mt-1">Auto = quotation − discount%. Editable.</p>
            )}
          </div>
          <Inp label="Estimated damage cost" type="number" value={f.estimated_damage_cost} onChange={v => set('estimated_damage_cost', v)} />
          <Inp label="Repair cost" type="number" value={f.repair_cost} onChange={v => set('repair_cost', v)} />
        </div>
      </div>

      {/* Release dates */}
      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs font-semibold text-gray-400 mb-2">Release</p>
        <div className="grid grid-cols-2 gap-3">
          <Inp label="Expected release date" type="date" value={f.expected_release_date} onChange={v => set('expected_release_date', v)} />
          <Inp label="Actual release date" type="date" value={f.release_date} onChange={v => set('release_date', v)} />
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Save size={16} /> {saving ? 'Saving...' : 'Save Repair & Insurance'}
      </button>
    </div>
  )
}

function ClaimTab({ acc, elevated, onSaved, setErr, fmtCurrency }) {
  const [f, setF] = useState({
    responsible_party: acc.responsible_party ?? '',
    liable_party: acc.liable_party ?? '',
    payer: acc.payer ?? '',
    driver_name: acc.driver_name ?? '',
    insurer: acc.insurer ?? '',
    policy_no: acc.policy_no ?? '',
    claim_status: acc.claim_status ?? 'none',
    claim_amount: acc.claim_amount ?? '',
    claim_approved_amount: acc.claim_approved_amount ?? '',
    deductible: acc.deductible ?? '',
    recovered_amount: acc.recovered_amount ?? '',
    recovery_date: acc.recovery_date ?? '',
    recovery_source: acc.recovery_source ?? 'none',
    recovery_status: acc.recovery_status ?? 'pending',
    recovery_reference: acc.recovery_reference ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const grossCost = (Number(acc.repair_cost) || 0) + (Number(acc.parts_cost) || 0)
  const netCost = Math.max(0, grossCost - (Number(acc.recovered_amount) || 0))

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('accidents').update({
      responsible_party: f.responsible_party || null,
      liable_party: f.liable_party || null,
      payer: f.payer || null,
      driver_name: f.driver_name || null,
      insurer: f.insurer || null,
      policy_no: f.policy_no || null,
      claim_status: f.claim_status,
      claim_amount: f.claim_amount !== '' ? Number(f.claim_amount) : null,
      claim_approved_amount: f.claim_approved_amount !== '' ? Number(f.claim_approved_amount) : null,
      deductible: f.deductible !== '' ? Number(f.deductible) : null,
      recovered_amount: f.recovered_amount !== '' ? Number(f.recovered_amount) : null,
      recovery_date: f.recovery_date || null,
      recovery_source: f.recovery_source,
      recovery_status: f.recovery_status,
      recovery_reference: f.recovery_reference || null,
    }).eq('id', acc.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  const NetCostCard = () => (
    <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Gross cost</p><p className="text-sm font-semibold text-gray-200">{fmtCurrency(grossCost)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Recovered</p><p className="text-sm font-semibold text-green-400">{fmtCurrency(Number(acc.recovered_amount) || 0)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Net cost</p><p className="text-sm font-semibold text-orange-400">{fmtCurrency(netCost)}</p></div>
    </div>
  )

  if (!elevated) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <span className={`badge text-xs ${CLAIM_BADGE[acc.claim_status ?? 'none']}`}>{CLAIM_LABELS[acc.claim_status ?? 'none']}</span>
          <span className={`badge text-xs ${RECOVERY_BADGE[acc.recovery_status ?? 'pending']}`}>Recovery: {RECOVERY_STATUS_LABELS[acc.recovery_status ?? 'pending']}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <KV label="Responsible party" value={acc.responsible_party} />
          <KV label="Liable party" value={acc.liable_party} />
          <KV label="Who pays" value={acc.payer} highlight />
          <KV label="Driver" value={acc.driver_name} />
          <KV label="Insurer" value={acc.insurer} />
          <KV label="Policy / Claim no" value={acc.policy_no} />
          <KV label="Claim amount" value={acc.claim_amount != null ? fmtCurrency(acc.claim_amount) : '-'} />
          <KV label="Approved" value={acc.claim_approved_amount != null ? fmtCurrency(acc.claim_approved_amount) : '-'} />
          <KV label="Deductible" value={acc.deductible != null ? fmtCurrency(acc.deductible) : '-'} />
          <KV label="Recovered amount" value={acc.recovered_amount != null ? fmtCurrency(acc.recovered_amount) : '-'} highlight />
          <KV label="Recovery source" value={RECOVERY_SOURCE_LABELS[acc.recovery_source ?? 'none']} />
          <KV label="Recovery date" value={acc.recovery_date} />
        </div>
        <NetCostCard />
        <p className="text-xs text-gray-600">Only Admin / Manager / Director can edit claim & recovery details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Inp label="Responsible party" value={f.responsible_party} onChange={v => set('responsible_party', v)} placeholder="Who is at fault" />
        <Inp label="Liable party" value={f.liable_party} onChange={v => set('liable_party', v)} />
        <Inp label="Who pays" value={f.payer} onChange={v => set('payer', v)} placeholder="Payer" />
        <Inp label="Driver" value={f.driver_name} onChange={v => set('driver_name', v)} />
        <Inp label="Insurer" value={f.insurer} onChange={v => set('insurer', v)} />
        <Inp label="Policy / Claim no" value={f.policy_no} onChange={v => set('policy_no', v)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Claim status</label>
          <select className="input" value={f.claim_status} onChange={e => set('claim_status', e.target.value)}>
            {CLAIM_STATUSES.map(s => <option key={s} value={s}>{CLAIM_LABELS[s]}</option>)}
          </select>
        </div>
        <Inp label="Claim amount" type="number" value={f.claim_amount} onChange={v => set('claim_amount', v)} />
        <Inp label="Approved amount" type="number" value={f.claim_approved_amount} onChange={v => set('claim_approved_amount', v)} />
      </div>

      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs font-semibold text-gray-400 mb-2">Cost Recovery</p>
        <div className="grid grid-cols-3 gap-3">
          <Inp label="Deductible" type="number" value={f.deductible} onChange={v => set('deductible', v)} />
          <Inp label="Recovered amount" type="number" value={f.recovered_amount} onChange={v => set('recovered_amount', v)} />
          <Inp label="Recovery date" type="date" value={f.recovery_date} onChange={v => set('recovery_date', v)} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <label className="label">Recovery source</label>
            <select className="input" value={f.recovery_source} onChange={e => set('recovery_source', e.target.value)}>
              {RECOVERY_SOURCES.map(s => <option key={s} value={s}>{RECOVERY_SOURCE_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Recovery status</label>
            <select className="input" value={f.recovery_status} onChange={e => set('recovery_status', e.target.value)}>
              {RECOVERY_STATUSES.map(s => <option key={s} value={s}>{RECOVERY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <Inp label="Recovery reference" value={f.recovery_reference} onChange={v => set('recovery_reference', v)} />
        </div>
      </div>

      <NetCostCard />
      <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Save size={16} /> {saving ? 'Saving...' : 'Save Claim & Recovery'}
      </button>
    </div>
  )
}

function ActivityTab({ accidentId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('get_accident_audit', { p_accident_id: accidentId })
      if (cancelled) return
      if (error) setErr(error.message)
      else setRows(data ?? [])
    })()
    return () => { cancelled = true }
  }, [accidentId])

  if (err) return <p className="text-sm text-red-400">{err}</p>
  if (rows === null) return <p className="text-sm text-gray-500">Loading activity...</p>
  if (rows.length === 0) return <p className="text-sm text-gray-500">No changes recorded yet.</p>

  return (
    <div className="space-y-3">
      {rows.map(row => {
        const d = describeAuditRow(row)
        return (
          <div key={row.id} className="flex gap-3">
            <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-200 font-medium">{d.title}</p>
                <span className="text-[11px] text-gray-500 whitespace-nowrap">{new Date(row.changed_at).toLocaleString()}</span>
              </div>
              <p className="text-[11px] text-gray-500 flex items-center gap-1"><User size={10} /> {row.actor_name}</p>
              {d.summary && <p className="text-xs text-gray-400 mt-1">{d.summary}</p>}
              {d.lines.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.lines.map((l, i) => (
                    <li key={i} className="text-xs text-gray-400">
                      <span className="text-gray-500">{l.label}:</span> <span className="text-red-300/80 line-through">{l.from}</span> <span className="text-gray-600">→</span> <span className="text-green-300">{l.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PartsTab({ acc, parts, partsTotal, elevated, profile, reload, setErr, fmtCurrency }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ part_name: '', part_number: '', quantity: '1', unit_cost: '', supplier: '', status: 'needed' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function add() {
    if (!f.part_name.trim()) { setErr('Enter a part name.'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('accident_parts').insert({
      accident_id: acc.id,
      part_name: f.part_name.trim(),
      part_number: f.part_number.trim() || null,
      quantity: Number(f.quantity) || 1,
      unit_cost: Number(f.unit_cost) || 0,
      supplier: f.supplier.trim() || null,
      status: f.status,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setF({ part_name: '', part_number: '', quantity: '1', unit_cost: '', supplier: '', status: 'needed' })
    setAdding(false); reload()
  }

  async function remove(id) {
    if (!window.confirm('Remove this part?')) return
    const { error } = await supabase.from('accident_parts').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    reload()
  }

  return (
    <div className="space-y-3">
      {parts.length === 0 ? (
        <p className="text-sm text-gray-500">No parts recorded yet.</p>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="table-header">Part</th><th className="table-header">Qty</th>
              <th className="table-header">Unit</th><th className="table-header">Total</th>
              <th className="table-header">Status</th>{elevated && <th className="table-header"></th>}
            </tr></thead>
            <tbody>
              {parts.map(p => (
                <tr key={p.id} className="border-t border-gray-800">
                  <td className="table-cell">
                    <div className="font-medium text-white">{p.part_name}</div>
                    <div className="text-xs text-gray-500">{[p.part_number && `#${p.part_number}`, p.supplier].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="table-cell">{Number(p.quantity)}</td>
                  <td className="table-cell whitespace-nowrap">{fmtCurrency(p.unit_cost)}</td>
                  <td className="table-cell whitespace-nowrap font-semibold text-white">{fmtCurrency(p.total_cost)}</td>
                  <td className="table-cell"><span className={`badge text-xs ${PART_BADGE[p.status]}`}>{PART_LABELS[p.status]}</span></td>
                  {elevated && (
                    <td className="table-cell">
                      <button onClick={() => remove(p.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-gray-700 bg-gray-800/30">
                <td className="table-cell font-semibold text-gray-300" colSpan={3}>Total parts cost</td>
                <td className="table-cell font-bold text-green-400 whitespace-nowrap">{fmtCurrency(partsTotal)}</td>
                <td className="table-cell" colSpan={elevated ? 2 : 1}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {elevated && (adding ? (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Part name *" value={f.part_name} onChange={v => set('part_name', v)} placeholder="e.g. Front bumper" />
            <Inp label="Part number" value={f.part_number} onChange={v => set('part_number', v)} />
            <Inp label="Supplier" value={f.supplier} onChange={v => set('supplier', v)} />
            <div>
              <label className="label">Status</label>
              <select className="input" value={f.status} onChange={e => set('status', e.target.value)}>
                {PART_STATUSES.map(s => <option key={s} value={s}>{PART_LABELS[s]}</option>)}
              </select>
            </div>
            <Inp label="Quantity" type="number" value={f.quantity} onChange={v => set('quantity', v)} />
            <Inp label="Unit cost" type="number" value={f.unit_cost} onChange={v => set('unit_cost', v)} />
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50"><Plus size={16} /> {saving ? 'Adding...' : 'Add Part'}</button>
            <button onClick={() => setAdding(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-secondary flex items-center gap-2"><Plus size={16} /> Add Part</button>
      ))}
    </div>
  )
}

function LogTab({ acc, remarks, profile, reload, setErr }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function add() {
    if (!text.trim()) return
    setSending(true); setErr('')
    const { error } = await supabase.from('accident_remarks').insert({
      accident_id: acc.id,
      author_id: profile?.id ?? null,
      author_name: profile?.full_name || profile?.username || 'User',
      remark: text.trim(),
      remark_type: 'note',
    })
    setSending(false)
    if (error) { setErr(error.message); return }
    setText(''); reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add an update (e.g. insurance rejected claim)..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
        />
        <button onClick={add} disabled={!text.trim() || sending} className="btn-primary flex items-center gap-2 disabled:opacity-40"><Send size={15} /> Add</button>
      </div>
      {remarks.length === 0 ? (
        <p className="text-sm text-gray-500">No log entries yet.</p>
      ) : (
        <div className="space-y-3">
          {remarks.map(r => (
            <div key={r.id} className="flex gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${REMARK_DOT[r.remark_type] || 'bg-gray-500'}`} />
              <div className="flex-1">
                <p className="text-sm text-gray-200 leading-snug">{r.remark}</p>
                <p className="text-xs text-gray-500 mt-0.5">{r.author_name || 'User'} · {new Date(r.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ClosureTab({ acc, closure, elevated, busy, onRequest, onApprove, onReject }) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  if (closure === 'closed') {
    return (
      <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-5 flex items-start gap-3">
        <ShieldCheck size={22} className="text-green-400 mt-0.5" />
        <div>
          <p className="text-green-300 font-semibold">Closed & approved</p>
          {acc.closure_approved_at && <p className="text-sm text-gray-400 mt-1">Approved {new Date(acc.closure_approved_at).toLocaleString()}</p>}
        </div>
      </div>
    )
  }

  if (closure === 'pending_closure') {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-5 flex items-start gap-3">
          <Hourglass size={22} className="text-yellow-400 mt-0.5" />
          <div>
            <p className="text-yellow-300 font-semibold">Awaiting admin approval</p>
            {acc.close_request_note && <p className="text-sm text-gray-400 mt-1">“{acc.close_request_note}”</p>}
            {acc.close_requested_at && <p className="text-xs text-gray-500 mt-1">Requested {new Date(acc.close_requested_at).toLocaleString()}</p>}
          </div>
        </div>
        {elevated ? (
          <div className="space-y-3">
            <button onClick={onApprove} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              <CheckCircle2 size={16} /> Approve Closure
            </button>
            <div className="card space-y-2">
              <label className="label">Rejection reason</label>
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="What still needs to be done" />
              <button onClick={() => onReject(reason)} disabled={busy} className="flex items-center justify-center gap-2 w-full rounded-lg border border-red-700/60 text-red-300 hover:bg-red-900/30 py-2 text-sm font-medium disabled:opacity-50">
                <XCircle size={16} /> Reject Closure
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">An Admin / Manager / Director will review and approve this closure.</p>
        )}
      </div>
    )
  }

  // open
  return (
    <div className="space-y-3">
      {acc.closure_rejected_reason && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-2 text-sm text-red-300">
          Previous closure rejected: {acc.closure_rejected_reason}
        </div>
      )}
      <label className="label">Closing note (optional)</label>
      <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Repairs complete, claim settled" />
      <button onClick={() => onRequest(note)} disabled={busy} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Lock size={16} /> Request Closure
      </button>
      <p className="text-xs text-gray-600">Submitting notifies every Admin / Manager / Director to review and approve.</p>
    </div>
  )
}

// ── Small UI helpers ────────────────────────────────────────────────────────────

function Backdrop({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      {children}
    </div>
  )
}

function KV({ label, value, highlight }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${highlight && value ? 'text-green-400' : 'text-gray-200'}`}>{value || '-'}</p>
    </div>
  )
}

function Inp({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// Strict single-select dropdown with a blank "not set" option. `options` accepts
// either plain strings or { value, label } objects.
function Sel({ label, value, onChange, options = [], placeholder = '—' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(o => {
          const opt = typeof o === 'object' ? o : { value: o, label: o }
          return <option key={opt.value} value={opt.value}>{opt.label}</option>
        })}
      </select>
    </div>
  )
}

// Datalist-backed field: dropdown suggestions with free-text fallback, so a
// common value is one click away but bespoke entries are still allowed.
function Picker({ label, value, onChange, options = [], placeholder }) {
  const listId = useId()
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.filter(Boolean).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

function ClosureBadge({ closure }) {
  const map = {
    open:            { cls: 'bg-gray-800 text-gray-300 border border-gray-600', label: 'Open' },
    pending_closure: { cls: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50', label: 'Pending Closure' },
    closed:          { cls: 'bg-green-900/50 text-green-300 border border-green-700/50', label: 'Closed' },
  }
  const c = map[closure] || map.open
  return <span className={`badge text-xs ${c.cls}`}>{c.label}</span>
}

function AlertCircleHeaderIcon() {
  return (
    <div className="w-9 h-9 rounded-lg bg-red-900/40 flex items-center justify-center flex-shrink-0">
      <FileText size={18} className="text-red-400" />
    </div>
  )
}
