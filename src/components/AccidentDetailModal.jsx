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

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  X, Plus, Trash2, Send, Lock, CheckCircle2, XCircle,
  ShieldCheck, Hourglass, FileText, Wrench, MessageSquare, Briefcase, History, User, ClipboardList,
  ArrowLeft, AlertOctagon, ChevronRight, Download, Loader2, ShieldAlert, Clock, Pencil,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { formatCurrency as _fmtCurrencyBase } from '../lib/formatters'
import {
  canonSeverity, canonStatus, TERMINAL_STAGES,
  CLAIM_STATUS_LABELS, RECOVERY_SOURCE_LABELS, RECOVERY_STATUS_LABELS,
  accidentSeverityPill, accidentStatusPill,
} from '../lib/accidentVocab'
import { exportAccidentCasePdf } from '../lib/exportUtils'
import { describeAuditRow } from '../lib/auditDiff'
import { buildCaseTimeline } from '../lib/accidentTimeline'
import { listStatusTransitions } from '../lib/api/accidentTimeline'
import { resolveStorageUrls } from '../lib/storageRefs'
import CustomFieldsPanel from './CustomFieldsPanel'
import CopilotCard from './ai/CopilotCard'
import EntityApprovalPanel from './workflow/EntityApprovalPanel'

// Vocabularies + canonicalisation come from the single shared source
// `src/lib/accidentVocab.js` (imported above) — do NOT re-declare them here.

// Severity / status pills come from the shared accidentVocab helpers
// (accidentSeverityPill / accidentStatusPill) so this detail page and the
// register table render identical colours — no per-file badge map here.

const RECOVERY_BADGE = {
  pending:     'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  partial:     'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  recovered:   'bg-green-900/50 text-green-300 border border-green-700/50',
  written_off: 'bg-red-900/50 text-red-300 border border-red-700/50',
}

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

// Coerce any thrown value / PostgREST error object into a plain user string.
function loadErrMsg(e) {
  if (!e) return ''
  if (typeof e === 'string') return e
  return e.message || e.error_description || e.details || ''
}

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
  const navigate = useNavigate()
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
    if (!accidentId) { setErr('No accident record specified.'); setLoading(false); return }
    try {
      // Settle each query INDEPENDENTLY. The accident itself must always open;
      // an auxiliary table that errors or REJECTS (accident_remarks /
      // accident_parts missing, RLS/permission edge, transient network) must
      // never wedge the whole loader on an unhandled rejection and leave the
      // page stuck on an infinite skeleton ("cannot open the record"). Loading
      // is ALWAYS cleared; failures surface as a clean message, never a hang.
      const [aR, rR, pR] = await Promise.allSettled([
        supabase.from('accidents').select('*').eq('id', accidentId).single(),
        supabase.from('accident_remarks').select('*').eq('accident_id', accidentId).order('created_at', { ascending: false }),
        supabase.from('accident_parts').select('*').eq('accident_id', accidentId).order('created_at', { ascending: true }),
      ])
      const a = aR.status === 'fulfilled' ? aR.value : { data: null, error: aR.reason }
      if (a.error || !a.data) { setErr(loadErrMsg(a.error) || 'Accident record not found.'); setLoading(false); return }
      setAcc(a.data)
      // Auxiliary data is best-effort: an error/rejection degrades to empty, the
      // record still renders. A partial-load hint is surfaced non-fatally.
      const rOk = rR.status === 'fulfilled' && !rR.value?.error
      const pOk = pR.status === 'fulfilled' && !pR.value?.error
      setRemarks(rOk ? (rR.value.data ?? []) : [])
      setParts(pOk ? (pR.value.data ?? []) : [])
      setErr((!rOk || !pOk) ? 'Some case details (log / parts) could not be loaded. Showing the incident record only.' : '')
      setLoading(false)
    } catch (e) {
      // Belt-and-braces: even a synchronous throw clears the loader.
      setErr(loadErrMsg(e) || 'Could not load this accident record.')
      setLoading(false)
    }
  }, [accidentId])

  useEffect(() => { setLoading(true); setErr(''); load() }, [load])

  // "Edit Incident" routes to THE one unified create/edit form on the Accidents
  // page (openEdit via router state) — the detail view stays read-only for the
  // record's own columns; there is no second update form here any more.
  const editLocked = wf.isActive || wf.isLocked
  const editIncident = useCallback(() => {
    onClose?.()
    navigate('/accidents', { state: { editId: accidentId } })
  }, [navigate, onClose, accidentId])

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
            <CaseTimelineSection acc={acc} />
          </div>
        )}
        {tab === 'tracker'   && <TrackerTab acc={acc} elevated={elevated} onEditIncident={editIncident} editLocked={editLocked} />}
        {tab === 'repair'    && <RepairInsuranceTab acc={acc} elevated={elevated} fmtCurrency={fmtCurrency} onEditIncident={editIncident} editLocked={editLocked} />}
        {tab === 'claim'     && <ClaimTab acc={acc} elevated={elevated} fmtCurrency={fmtCurrency} onEditIncident={editIncident} editLocked={editLocked} />}
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
  const severityPill = accidentSeverityPill(acc.severity)
  const statusPill = accidentStatusPill(acc.status)
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
        <div className="flex items-center gap-2">
          {elevated && (
            <button
              onClick={editIncident}
              disabled={editLocked}
              className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
              title={editLocked ? 'Locked while an approval workflow is active' : 'Update every incident, claim and case field in the unified incident form'}
            >
              <Pencil size={13} /> Edit Incident
            </button>
          )}
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
                {severityPill.label && <span className={`badge text-xs ${severityPill.className}`}>{severityPill.label}</span>}
                {statusPill.label && <span className={`badge text-xs ${statusPill.className}`}>{statusPill.label}</span>}
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
        <KV label="Plate no" value={acc.plate_number} />
        <KV label="Vehicle type" value={acc.vehicle_type} />
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

// ── Case timeline — days spent in each status step ─────────────────────────────
// Durations are derived from the status transitions the accidents audit trigger
// already records in accident_audit_log (org-scoped read granted by V223); the
// pure maths live in src/lib/accidentTimeline.js. HONEST: nothing is fabricated —
// with no recorded transitions the section shows one step for the current status
// (incident date → now) and says tracking starts from the next update.
function CaseTimelineSection({ acc }) {
  const [rows, setRows] = useState(null) // null = loading
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    let cancelled = false
    setRows(null); setLoadErr('')
    listStatusTransitions(acc.id)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(e => { if (!cancelled) { setLoadErr(e?.message || 'Could not load the case timeline.'); setRows([]) } })
    return () => { cancelled = true }
  }, [acc.id])

  const steps = useMemo(() => (rows === null ? [] : buildCaseTimeline(acc, rows)), [acc, rows])
  const totalDays = useMemo(() => steps.reduce((s, x) => s + x.days, 0), [steps])
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '-')
  const dayBadge = (n) => `${n} day${n === 1 ? '' : 's'}`

  return (
    <div className="border-t border-gray-800 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <History size={13} /> Case Timeline · days per step
        </p>
        {rows !== null && steps.length > 0 && (
          <span className="text-[11px] text-gray-500 whitespace-nowrap">{dayBadge(totalDays)} total</span>
        )}
      </div>

      {rows === null ? (
        <div className="space-y-2 animate-pulse mt-3">
          {[0, 1, 2].map(i => <div key={i} className="h-8 bg-gray-800/60 rounded" />)}
        </div>
      ) : (
        <>
          {loadErr && <p className="text-xs text-red-400 mt-2">{loadErr}</p>}
          {rows.length === 0 && !loadErr && (
            <p className="text-xs text-gray-500 mt-2">
              No status changes recorded yet — durations start tracking from the next update.
            </p>
          )}
          {steps.length > 0 && (
            <ol className="mt-3">
              {steps.map((s, i) => (
                <li key={`${s.step}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 border ${
                        s.current
                          ? 'bg-green-500 border-green-400 animate-pulse'
                          : s.step === 'closed'
                            ? 'bg-green-700 border-green-600'
                            : 'bg-gray-600 border-gray-500'
                      }`}
                    />
                    {i < steps.length - 1 && <span className="w-px flex-1 bg-gray-800 my-0.5" />}
                  </div>
                  <div className={`flex-1 flex items-start justify-between gap-2 min-w-0 ${i < steps.length - 1 ? 'pb-4' : ''}`}>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${s.current ? 'text-green-400' : 'text-gray-200'}`}>
                        {s.label || s.step}
                        {s.step === 'closed' && !s.current && <CheckCircle2 size={12} className="inline ml-1.5 -mt-0.5 text-green-500" />}
                      </p>
                      <p className="text-[11px] text-gray-500">{fmtDate(s.from)} → {s.current ? 'now' : fmtDate(s.to)}</p>
                    </div>
                    {s.current ? (
                      <span className="badge text-xs whitespace-nowrap bg-green-900/50 text-green-300 border border-green-700/50 flex items-center gap-1">
                        <Clock size={10} /> ongoing · {dayBadge(s.days)} so far
                      </span>
                    ) : (
                      <span className="badge text-xs whitespace-nowrap bg-gray-800 text-gray-300 border border-gray-600">
                        {dayBadge(s.days)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

// Read-only case tracker view. Updates happen exclusively through the ONE
// unified incident form on the Accidents page (Edit Incident action) — this
// tab's former inline edit form was removed to eliminate the duplicate
// update path.
function TrackerTab({ acc, elevated, onEditIncident, editLocked }) {
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
        <KV label="Status update date" value={acc.status_update_date} />
        <KV label="Expected release" value={acc.expected_release_date} />
      </div>
      {acc.status_update_note && <KV label="Status update note" value={acc.status_update_note} />}
      <EditIncidentHint elevated={elevated} onEdit={onEditIncident} locked={editLocked} />
    </div>
  )
}

// ── Repair & Insurance — Case Management (V219 GCC fields) ─────────────────────
// Read-only view of damage/fault classification, Najm + Taqdeer report state,
// GCC liability ratio, repair route, case workflow and workshop financials.
// Updates happen exclusively through the ONE unified incident form on the
// Accidents page (Edit Incident) — the former per-tab edit form was removed.
function RepairInsuranceTab({ acc, elevated, fmtCurrency, onEditIncident, editLocked }) {
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
      <EditIncidentHint elevated={elevated} onEdit={onEditIncident} locked={editLocked} />
    </div>
  )
}

// Read-only claim & recovery view. Updates happen exclusively through the ONE
// unified incident form on the Accidents page (Edit Incident) — the former
// per-tab edit form was removed to eliminate the duplicate update path.
function ClaimTab({ acc, elevated, fmtCurrency, onEditIncident, editLocked }) {
  const grossCost = (Number(acc.repair_cost) || 0) + (Number(acc.parts_cost) || 0)
  const netCost = Math.max(0, grossCost - (Number(acc.recovered_amount) || 0))

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <span className={`badge text-xs ${CLAIM_BADGE[acc.claim_status ?? 'none']}`}>{CLAIM_STATUS_LABELS[acc.claim_status ?? 'none']}</span>
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
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">Cost Recovery</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KV label="Deductible" value={acc.deductible != null ? fmtCurrency(acc.deductible) : '-'} />
          <KV label="Recovered amount" value={acc.recovered_amount != null ? fmtCurrency(acc.recovered_amount) : '-'} highlight />
          <KV label="Recovery status" value={RECOVERY_STATUS_LABELS[acc.recovery_status ?? 'pending']} />
          <KV label="Recovery source" value={RECOVERY_SOURCE_LABELS[acc.recovery_source ?? 'none']} />
          <KV label="Recovery date" value={acc.recovery_date} />
          <KV label="Recovery reference" value={acc.recovery_reference} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
        <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Gross cost</p><p className="text-sm font-semibold text-gray-200">{fmtCurrency(grossCost)}</p></div>
        <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Recovered</p><p className="text-sm font-semibold text-green-400">{fmtCurrency(Number(acc.recovered_amount) || 0)}</p></div>
        <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Net cost</p><p className="text-sm font-semibold text-orange-400">{fmtCurrency(netCost)}</p></div>
      </div>
      <EditIncidentHint elevated={elevated} onEdit={onEditIncident} locked={editLocked} />
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

// "Edit Incident" affordance rendered at the foot of the read-only record tabs.
// Elevated roles jump to THE one unified create/edit form on the Accidents
// page; everyone else sees the honest permission note.
function EditIncidentHint({ elevated, onEdit, locked }) {
  if (!elevated) {
    return <p className="text-xs text-gray-600">Only Admin / Manager / Director can update these details.</p>
  }
  return (
    <div className="flex items-center gap-3 flex-wrap pt-1">
      <button
        type="button"
        onClick={onEdit}
        disabled={locked}
        title={locked ? 'Locked while an approval workflow is active' : 'Open this record in the unified incident form'}
        className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <Pencil size={12} /> Edit Incident
      </button>
      <p className="text-xs text-gray-600">All incident, claim and case fields are updated in the one unified incident form.</p>
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
