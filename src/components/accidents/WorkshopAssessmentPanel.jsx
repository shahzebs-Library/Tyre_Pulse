/**
 * WorkshopAssessmentPanel - the "Workshop assessment" case tab, field for field
 * the owner's mock M5 "Repair assessment report":
 *
 *   WorkstreamHeader (Workstream 2 of 7 · owner · received / with workshop / SLA)
 *   Vehicle card (image, make/model, asset, KM, plate, site · location, damage-map link)
 *   1 Safety and mobility     Safe to move | Recovery / tow required | Vehicle off road (VOR)
 *   2 Damage assessment       one row per damage mark: thumbnail, component, type + severity, Action
 *   3 Labour and parts        hours, labour estimate, parts estimate, derived total, parts availability
 *   4 Repair route            3 tiles (Recommended badge from the engine), reason, workshop + city,
 *                             expected duration, quotation status; legacy routes under "Other routes"
 *   Required attachments      ASSESSMENT_ATTACHMENTS with Attached / Missing / count + upload
 *   After submit notify       NOTIFY_ROLES chips
 *   Save assessment | Submit assessment and route (gated by assessmentGating.canSubmit)
 *   Disclosure: the legacy repair-order form + actual repair cost, kept intact.
 *
 * Data: accident_damage_assessments (direct RLS writes, accidentDamageAssessment.js),
 * accident_repair_orders (RPC upsert + a direct parity patch for the three new
 * columns), accident_evidence (existing upload RPC, requirement_key stamped).
 * The parity migration (20260916130000) is NOT applied live yet: every new
 * column degrades through isMissingColumn to an honest "Not set" and a note,
 * never an invented value.
 *
 * All vocabulary comes from accidentCaseVocab.js; all gating from
 * assessmentGating.js. Nothing is re-declared here.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  ClipboardCheck, Wrench, AlertTriangle, Loader2, RefreshCw, Send, ShieldAlert, AlertOctagon, Award,
  Camera, CheckCircle2, XCircle, Paperclip, Upload, ChevronDown, ChevronRight, Building2, Check, Minus,
} from 'lucide-react'
import {
  getDamageAssessment, saveDamageAssessment, submitDamageAssessment, writeDamageAreas,
  patchRepairOrderParity, REPAIR_ROUTES, parityColumnsUnavailable,
} from '../../lib/api/accidentDamageAssessment'
import { getOpenRepairOrder, upsertRepairOrder, WORKSHOP_TYPES, REPAIR_ROUTES as ORDER_ROUTES } from '../../lib/api/accidentRepairOrders'
import { setAccidentRepairCost } from '../../lib/api/accidentWorkflow'
import { listEvidence, addEvidence } from '../../lib/api/accidentEvidence'
import { getAssetByNo } from '../../lib/api/assets'
import { listWorkstreams } from '../../lib/api/accidentCase'
import { resolveStorageUrl } from '../../lib/storageRefs'
import {
  REPAIR_ROUTE_TILES, DAMAGE_ACTIONS, QUOTATION_STATES, ASSESSMENT_ATTACHMENTS, DAMAGE_LEVELS, DAMAGE_TYPES,
  canonDamageType, NOTIFY_ROLES,
} from '../../lib/accidentCaseVocab'
import { SEVERITY_DOT_TONE } from '../../lib/vehicleDamageViews'
import {
  attachmentStatus, recommendedRoute, canSubmit as gateCanSubmit, totals as estimateTotals,
  partsAvailabilityLabel, isTileRoute,
} from '../../lib/assessmentGating'
import WorkstreamHeader from './WorkstreamHeader'
import VehicleMasterCard from './VehicleMasterCard'
import EvidenceTable from './EvidenceTable'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { toUserMessage } from '../../lib/safeError'

// Legacy route tokens the live CHECK still accepts. Kept reachable under
// "Other routes" so a stored recommendation always renders with its own name.
const ROUTE_LABEL = {
  none: 'None', temporary: 'Temporary repair', internal: 'Internal workshop', external: 'External workshop',
  on_site: 'On-site repair', insurer_approved: 'Insurer-approved workshop', dealer: 'Dealer workshop',
  specialist: 'Specialist workshop', replacement: 'Replacement', total_loss: 'Total loss', disposal: 'Disposal',
  under_review: 'Under review',
}
const OTHER_ROUTES = REPAIR_ROUTES.filter((r) => !isTileRoute(r))
const WORKSHOP_TYPE_LABEL = {
  internal: 'Internal', external: 'External', insurer_approved: 'Insurer-approved', dealer: 'Dealer', specialist: 'Specialist',
}
const ASSESSMENT_STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }
const ASSESSMENT_STATUS_TONE = {
  draft: 'text-[var(--text-muted)]', submitted: 'text-blue-300', approved: 'text-green-400', rejected: 'text-red-400',
}
const ORDER_STATUS_LABEL = {
  planned: 'Planned', awaiting_parts: 'Awaiting parts', awaiting_po: 'Awaiting PO', awaiting_quotation: 'Awaiting quotation',
  in_progress: 'In progress', qc_pending: 'QC pending', qc_passed: 'QC passed', qc_failed: 'QC failed',
  completed: 'Completed', cancelled: 'Cancelled',
}
const ORDER_STATUS_TONE = {
  qc_passed: 'text-green-400', completed: 'text-green-400', qc_failed: 'text-red-400', cancelled: 'text-red-400',
  in_progress: 'text-blue-300', qc_pending: 'text-amber-400',
}
const DAMAGE_TYPE_LABEL = Object.fromEntries(DAMAGE_TYPES.map((d) => [d.key, d.label]))
const LEVEL_LABEL = Object.fromEntries(DAMAGE_LEVELS.map((l) => [l.key, l.label]))
const ACTION_LABEL = Object.fromEntries(DAMAGE_ACTIONS.map((a) => [a.key, a.label]))
const QUOTATION_LABEL = Object.fromEntries(QUOTATION_STATES.map((q) => [q.key, q.label]))
// The mock notifies Fleet, Insurance, Command Center and PMV Manager; Workshop
// is the sender of this report so it is not offered as a recipient.
const NOTIFY_RECIPIENTS = NOTIFY_ROLES.filter((r) => r.key !== 'workshop').map((r) => ({ key: r.key, label: r.label }))

// Stored severities are minor/moderate/severe; a few early marks wrote 'major'.
const canonLevel = (v) => {
  const k = String(v || '').toLowerCase()
  return k === 'major' ? 'severe' : (LEVEL_LABEL[k] ? k : (k ? 'minor' : ''))
}
const numOrNull = (v) => (v === '' || v == null ? null : Number(v))
const NOT_SET = 'Not set'

/** Label + one control, wired with htmlFor/id so the label names the control. */
function Field({ label, children, hint }) {
  const id = useId()
  const control = isValidElement(children) && !children.props.id ? cloneElement(children, { id }) : children
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {control}
      {hint && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{hint}</p>}
    </div>
  )
}

function SectionTitle({ n, children }) {
  return (
    <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
      <span className="h-5 w-5 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[11px] flex items-center justify-center text-[var(--text-secondary)]">{n}</span>
      {children}
    </h4>
  )
}

/** Yes / No control with red/green icons. `yesIsGood` flips which answer is
 *  green: "Safe to move: Yes" is good, "Recovery required: Yes" is not. */
function YesNo({ label, value, onChange, disabled, yesIsGood = true, testId }) {
  const opts = [
    { v: true, text: 'Yes', good: yesIsGood },
    { v: false, text: 'No', good: !yesIsGood },
  ]
  return (
    <div className="rounded-lg border border-[var(--input-border)] p-3 space-y-2" data-testid={testId}>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <div className="flex gap-2">
        {opts.map((o) => {
          const active = value === o.v
          const Icon = o.good ? CheckCircle2 : XCircle
          const tone = o.good ? 'text-green-400' : 'text-red-400'
          return (
            <button
              key={o.text}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(o.v)}
              className={`flex-1 px-2 py-1.5 rounded-md border text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-default ${
                active ? `border-current ${tone} bg-current/10 font-semibold` : 'border-[var(--input-border)] text-[var(--text-muted)]'
              }`}
            >
              <Icon size={14} className={active ? tone : 'opacity-50'} /> {o.text}
            </button>
          )
        })}
      </div>
      {value == null && <p className="text-[10px] text-[var(--text-muted)]">{NOT_SET}</p>}
    </div>
  )
}

/** First photo of a damage mark, resolved through the shared storage resolver. */
function MarkThumb({ photoRef }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let live = true
    if (!photoRef) { setSrc(null); return undefined }
    resolveStorageUrl(photoRef).then((u) => { if (live) setSrc(u || null) }).catch(() => { if (live) setSrc(null) })
    return () => { live = false }
  }, [photoRef])
  if (src) return <img src={src} alt="Damage" className="h-10 w-10 object-cover rounded border border-[var(--input-border)]" />
  return (
    <span className="h-10 w-10 rounded border border-dashed border-[var(--input-border)] flex items-center justify-center text-[var(--text-muted)]" title="No photo">
      <Camera size={12} />
    </span>
  )
}

function Disclosure({ title, children, defaultOpen = false, testId }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="card" data-testid={testId}>
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="font-semibold text-[var(--text-primary)] flex items-center gap-2">{title}</span>
        {open ? <ChevronDown size={16} className="text-[var(--text-muted)]" /> : <ChevronRight size={16} className="text-[var(--text-muted)]" />}
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </section>
  )
}

export default function WorkshopAssessmentPanel({
  accidentId, elevated, acc, fmtCurrency, onChanged, workstreams: workstreamsProp, asset: assetProp, onNavigateTab,
}) {
  const [assessment, setAssessment] = useState(null) // null while loading, {} when none exists yet
  const [order, setOrder] = useState(null)
  const [draft, setDraft] = useState(null)
  const [evidence, setEvidence] = useState([])
  const [asset, setAsset] = useState(assetProp || null)
  const [workstreams, setWorkstreams] = useState(workstreamsProp || [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingKey, setUploadingKey] = useState('')
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [showOtherRoutes, setShowOtherRoutes] = useState(false)

  // Repair-route block (section 4): workshop name + type ride the existing RPC;
  // city / duration / quotation status are the parity columns.
  const [routeForm, setRouteForm] = useState({ workshopType: '', workshopName: '', vendorCity: '', expectedDurationDays: '', quotationStatus: '' })
  // Legacy repair-order form (disclosure) - unchanged behaviour.
  const [orderForm, setOrderForm] = useState({ repairRoute: '', workshopType: '', workshopName: '', quotationAmount: '', plannedCompletion: '' })
  const [actualCost, setActualCost] = useState(acc?.repair_cost ?? '')
  const [actualCostSaving, setActualCostSaving] = useState(false)

  const money = (v) => (v == null || v === '' ? NOT_SET : (typeof fmtCurrency === 'function' ? fmtCurrency(v) : String(v)))

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [a, o, ev] = await Promise.all([
        getDamageAssessment(accidentId),
        getOpenRepairOrder(accidentId),
        listEvidence(accidentId, { workstreamKey: 'assessment' }).catch(() => []),
      ])
      const row = a || {}
      setAssessment(row)
      setDraft(row)
      setOrder(o)
      setEvidence(Array.isArray(ev) ? ev : [])
      setRouteForm({
        workshopType: o?.workshop_type || '',
        workshopName: o?.workshop_name || (!o ? acc?.workshop_name : '') || '',
        vendorCity: o?.vendor_city || '',
        expectedDurationDays: o?.expected_duration_days ?? '',
        quotationStatus: o?.quotation_status || '',
      })
      setOrderForm({
        repairRoute: o?.repair_route || row.recommended_route || '',
        workshopType: o?.workshop_type || '',
        workshopName: o?.workshop_name || (!o ? acc?.workshop_name : '') || '',
        quotationAmount: o?.quotation_amount ?? '',
        plannedCompletion: o?.planned_completion || '',
      })
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the workshop assessment.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.workshop_name])

  useEffect(() => { load() }, [load])

  // Vehicle card: the fleet master row for the case's asset (best-effort; the
  // card is simply omitted when the asset is not on the register).
  useEffect(() => {
    let live = true
    if (assetProp) { setAsset(assetProp); return undefined }
    if (!acc?.asset_no) { setAsset(null); return undefined }
    getAssetByNo(acc.asset_no, acc.country).then((r) => { if (live) setAsset(r || null) }).catch(() => { if (live) setAsset(null) })
    return () => { live = false }
  }, [assetProp, acc?.asset_no, acc?.country])

  // Workstream rows for the header when the host did not pass them.
  useEffect(() => {
    let live = true
    if (workstreamsProp) { setWorkstreams(workstreamsProp); return undefined }
    if (!accidentId) return undefined
    listWorkstreams(accidentId, { country: acc?.country }).then((r) => { if (live) setWorkstreams(r || []) }).catch(() => { if (live) setWorkstreams([]) })
    return () => { live = false }
  }, [workstreamsProp, accidentId, acc?.country])

  const editable = !assessment?.id || assessment.assessment_status === 'draft'
  const damageAreas = useMemo(() => (Array.isArray(assessment?.damage_areas) ? assessment.damage_areas : []), [assessment])
  const suggested = recommendedRoute(damageAreas, draft)
  const route = draft?.recommended_route || ''
  const attachments = useMemo(() => attachmentStatus(evidence), [evidence])
  const gate = gateCanSubmit({ route, evidenceRows: evidence, assessment })
  const est = estimateTotals({
    labourHours: draft?.estimated_labour_hours, labourCost: draft?.estimated_labour_cost, partsCost: draft?.estimated_parts_cost,
  })
  const parityMissing = parityColumnsUnavailable()

  function assessmentPatch() {
    const patch = { ...draft }
    for (const k of ['id', 'accident_id', 'created_at', 'updated_at', 'created_by', 'approved_by', 'approved_at', 'assessment_status', 'damage_areas']) delete patch[k]
    // The total is DERIVED from labour + parts; store what the screen shows.
    if (est.total != null) patch.estimated_total_cost = est.total
    return patch
  }

  async function persistRouteBlock(existingOrder) {
    // Workshop name/type go through the existing RPC; the parity trio through the direct patch.
    const wantsOrder = existingOrder || routeForm.workshopName || routeForm.workshopType
    let o = existingOrder
    if (wantsOrder) {
      o = await upsertRepairOrder(accidentId, {
        // The order RPC's CHECK gains 'on_site' with the migration; until then the route is left off the order.
        repairRoute: ORDER_ROUTES.includes(route) ? route : null,
        workshopType: routeForm.workshopType || null,
        workshopName: routeForm.workshopName || null,
        quotationAmount: existingOrder?.quotation_amount ?? null,
        plannedCompletion: existingOrder?.planned_completion || null,
      })
      const patched = await patchRepairOrderParity(o?.id, {
        vendor_city: routeForm.vendorCity || null,
        expected_duration_days: numOrNull(routeForm.expectedDurationDays),
        quotation_status: routeForm.quotationStatus || null,
      })
      if (patched) o = { ...o, ...patched }
      else if (routeForm.vendorCity || routeForm.expectedDurationDays !== '' || routeForm.quotationStatus) {
        setNotice('Workshop city, expected duration and quotation status will be saved once the schema update is applied.')
      }
      setOrder(o)
    }
    return o
  }

  async function save() {
    if (saving) return
    setSaving(true); setErr(''); setNotice('')
    try {
      const saved = await saveDamageAssessment(accidentId, assessmentPatch(), { existingId: assessment?.id, editable: true })
      setAssessment(saved); setDraft(saved)
      if (order) await persistRouteBlock(order)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the workshop assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (saving || !gate.ok) return
    setSaving(true); setErr(''); setNotice('')
    try {
      // Save the latest draft, route it (open/update the repair order), then lock it.
      const saved = await saveDamageAssessment(accidentId, assessmentPatch(), { existingId: assessment.id, editable: true })
      await persistRouteBlock(order)
      const locked = await submitDamageAssessment(saved.id)
      setAssessment(locked); setDraft(locked)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not submit the assessment.'))
    } finally {
      setSaving(false)
    }
  }

  async function setMarkAction(index, action) {
    if (!assessment?.id) return
    setErr('')
    try {
      const next = damageAreas.map((a, i) => (i === index ? { ...a, action: action || null } : a))
      const saved = await writeDamageAreas(assessment.id, next)
      setAssessment(saved); setDraft((d) => ({ ...d, damage_areas: saved.damage_areas }))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not update that damage row.'))
    }
  }

  async function uploadAttachment(key, file) {
    if (!file) return
    setUploadingKey(key); setErr('')
    try {
      const kind = file.type?.startsWith('image/') ? 'photo' : 'document'
      const saved = await addEvidence(accidentId, file, { kind, workstreamKey: 'assessment', requirementKey: key, caption: file.name })
      setEvidence((prev) => [{ ...saved, requirement_key: saved?.requirement_key || key }, ...(prev || [])])
    } catch (e) {
      setErr(toUserMessage(e, 'Could not attach that file.'))
    } finally {
      setUploadingKey('')
    }
  }

  async function submitOrder(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await upsertRepairOrder(accidentId, {
        repairRoute: orderForm.repairRoute || null,
        workshopType: orderForm.workshopType || null,
        workshopName: orderForm.workshopName || null,
        quotationAmount: orderForm.quotationAmount === '' ? null : Number(orderForm.quotationAmount),
        plannedCompletion: orderForm.plannedCompletion || null,
      })
      setOrder(saved)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not open the repair order.'))
    } finally {
      setSaving(false)
    }
  }

  async function saveActualCost(e) {
    e.preventDefault()
    if (actualCostSaving) return
    setActualCostSaving(true); setErr('')
    try {
      await setAccidentRepairCost(accidentId, actualCost === '' ? null : Number(actualCost))
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the actual repair cost.'))
    } finally {
      setActualCostSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading the workshop assessment...</div>
  }
  if (err && draft == null) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 flex items-center gap-2"><AlertTriangle size={16} /> {err}</p>
        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    )
  }

  const canEdit = elevated && editable
  const setD = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="p-6 space-y-6">
      <WorkstreamHeader accidentId={accidentId} workstreamKey="assessment" workstreams={workstreams} ownerName={draft?.assessor_name || null} />

      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardCheck size={16} /> Repair assessment report</h3>
          {assessment?.id && (
            <span className={`text-sm font-semibold ${ASSESSMENT_STATUS_TONE[assessment.assessment_status] || 'text-[var(--text-secondary)]'}`}>
              {ASSESSMENT_STATUS_LABEL[assessment.assessment_status] || assessment.assessment_status}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            {asset ? (
              <VehicleMasterCard asset={asset} image compact location={acc?.location} damageAreaCount={damageAreas.length} onNavigateTab={onNavigateTab} />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--input-border)] p-3 text-xs text-[var(--text-muted)]">
                {acc?.asset_no ? `Asset ${acc.asset_no} is not on the fleet register.` : 'No asset recorded on this incident.'}
              </div>
            )}
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Assessor name">
              <input className="input w-full" value={draft?.assessor_name ?? ''} disabled={!canEdit} onChange={(e) => setD('assessor_name')(e.target.value)} />
            </Field>
            <Field label="Assessed on">
              <input type="date" className="input w-full" value={draft?.assessed_at ? String(draft.assessed_at).slice(0, 10) : ''} disabled={!canEdit}
                onChange={(e) => setD('assessed_at')(e.target.value || null)} />
            </Field>
          </div>
        </div>
      </section>

      {/* 1 Safety and mobility */}
      <section className="card space-y-3" data-testid="section-safety">
        <SectionTitle n={1}>Safety and mobility</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <YesNo label="Safe to move" value={draft?.safe_to_move ?? null} onChange={setD('safe_to_move')} disabled={!canEdit} yesIsGood testId="safe-to-move" />
          <YesNo label="Recovery / tow required" value={draft?.recovery_required ?? null} onChange={setD('recovery_required')} disabled={!canEdit} yesIsGood={false} testId="recovery-required" />
          <YesNo label="Vehicle off road (VOR)" value={draft?.recommended_offroad ?? null} onChange={setD('recommended_offroad')} disabled={!canEdit} yesIsGood={false} testId="vor" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!canEdit} onClick={() => setD('specialist_required')(!draft?.specialist_required)}
            className={`px-3 py-1.5 rounded-lg border text-xs inline-flex items-center gap-2 disabled:opacity-60 ${draft?.specialist_required ? 'border-current text-amber-400 bg-current/10' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
            <Wrench size={13} /> Specialist required
          </button>
          <button type="button" disabled={!canEdit} onClick={() => setD('total_loss_possible')(!draft?.total_loss_possible)}
            className={`px-3 py-1.5 rounded-lg border text-xs inline-flex items-center gap-2 disabled:opacity-60 ${draft?.total_loss_possible ? 'border-current text-red-400 bg-current/10' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
            <AlertOctagon size={13} /> Total loss possible
          </button>
        </div>
        {parityMissing && (
          <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><ShieldAlert size={12} /> Safe to move and Recovery required will be stored once the schema update is applied; VOR is saved today.</p>
        )}
      </section>

      {/* 2 Damage assessment */}
      <section className="card space-y-3" data-testid="section-damage">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <SectionTitle n={2}>Damage assessment ({damageAreas.length})</SectionTitle>
          {onNavigateTab && (
            <button type="button" className="text-xs text-blue-400 hover:underline" onClick={() => onNavigateTab('damage_map')}>Open damage map</button>
          )}
        </div>
        {damageAreas.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No damage areas marked yet. Use the Mark Damage tab to add marks and photos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  <th className="px-2 py-1.5 font-medium">Photo</th>
                  <th className="px-2 py-1.5 font-medium">Component</th>
                  <th className="px-2 py-1.5 font-medium">Damage</th>
                  <th className="px-2 py-1.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--input-border)]">
                {damageAreas.map((a, i) => {
                  const level = canonLevel(a.severity)
                  const type = canonDamageType(a.damage_type)
                  return (
                    <tr key={`${a.view}-${a.region_key}-${i}`} data-testid="damage-row">
                      <td className="px-2 py-1.5"><MarkThumb photoRef={Array.isArray(a.photo_refs) ? a.photo_refs[0] : null} /></td>
                      <td className="px-2 py-1.5 text-[var(--text-primary)]">
                        {a.region_label || a.component_label || a.region_key || NOT_SET}
                        {a.view && <span className="block text-[10px] text-[var(--text-muted)]">{a.view}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_DOT_TONE[level] || 'var(--input-border)' }} aria-label={level ? LEVEL_LABEL[level] : 'No severity'} />
                          {type ? DAMAGE_TYPE_LABEL[type] || type : NOT_SET}
                          {level && <span className="text-[10px] text-[var(--text-muted)]">{LEVEL_LABEL[level]}</span>}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className="input text-xs py-1" value={a.action || ''} disabled={!canEdit || !assessment?.id} aria-label={`Action for ${a.region_label || a.component_label || a.region_key}`}
                          onChange={(e) => setMarkAction(i, e.target.value)}>
                          <option value="">{NOT_SET}</option>
                          {DAMAGE_ACTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                        {!canEdit && a.action && <span className="sr-only">{ACTION_LABEL[a.action] || a.action}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Visible damage notes">
            <textarea rows={2} className="input w-full" value={draft?.visible_damage ?? ''} disabled={!canEdit} onChange={(e) => setD('visible_damage')(e.target.value)} />
          </Field>
          <Field label="Hidden / suspected damage">
            <textarea rows={2} className="input w-full" value={draft?.hidden_damage ?? ''} disabled={!canEdit} onChange={(e) => setD('hidden_damage')(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* 3 Labour and parts estimate */}
      <section className="card space-y-3" data-testid="section-estimate">
        <SectionTitle n={3}>Labour and parts estimate</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Labour hours">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_labour_hours ?? ''} disabled={!canEdit}
              onChange={(e) => setD('estimated_labour_hours')(numOrNull(e.target.value))} />
          </Field>
          <Field label="Labour estimate" hint={parityMissing ? 'Stored after the schema update' : undefined}>
            <input type="number" min="0" className="input w-full" value={draft?.estimated_labour_cost ?? ''} disabled={!canEdit}
              onChange={(e) => setD('estimated_labour_cost')(numOrNull(e.target.value))} />
          </Field>
          <Field label="Parts estimate">
            <input type="number" min="0" className="input w-full" value={draft?.estimated_parts_cost ?? ''} disabled={!canEdit}
              onChange={(e) => setD('estimated_parts_cost')(numOrNull(e.target.value))} />
          </Field>
          <div>
            <p className="label">Total preliminary estimate</p>
            <p className="text-sm font-semibold text-[var(--text-primary)] py-2" data-testid="total-estimate">{money(est.total)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <Field label="Parts available">
            <input type="number" min="0" className="input w-full" value={draft?.parts_available_count ?? ''} disabled={!canEdit}
              onChange={(e) => setD('parts_available_count')(numOrNull(e.target.value))} />
          </Field>
          <Field label="Special order">
            <input type="number" min="0" className="input w-full" value={draft?.parts_special_order_count ?? ''} disabled={!canEdit}
              onChange={(e) => setD('parts_special_order_count')(numOrNull(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">
            <p className="label">Parts availability</p>
            <p className="text-sm text-[var(--text-primary)] py-2" data-testid="parts-availability">{partsAvailabilityLabel(draft?.parts_available_count, draft?.parts_special_order_count)}</p>
          </div>
        </div>
      </section>

      {/* 4 Repair route recommendation */}
      <section className="card space-y-4" data-testid="section-route">
        <SectionTitle n={4}>Repair route recommendation</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Repair route">
          {REPAIR_ROUTE_TILES.map((t) => {
            const active = route === t.key
            const rec = suggested === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!canEdit}
                onClick={() => setD('recommended_route')(t.key)}
                className={`relative text-left rounded-lg border p-3 disabled:opacity-60 disabled:cursor-default ${
                  active ? 'border-emerald-500 bg-emerald-500/10' : 'border-[var(--input-border)]'
                }`}
              >
                <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Building2 size={14} /> {t.label}</span>
                {rec && (
                  <span className="mt-1.5 inline-flex items-center gap-1 badge text-[10px] bg-green-900/30 text-green-300 border border-green-700/50"><Award size={10} /> Recommended</span>
                )}
                {active && <Check size={14} className="absolute top-2 right-2 text-emerald-500" />}
              </button>
            )
          })}
        </div>
        {route && !isTileRoute(route) && (
          <p className="text-xs text-[var(--text-secondary)]">Stored route: <span className="font-semibold text-[var(--text-primary)]">{ROUTE_LABEL[route] || route}</span></p>
        )}
        <div>
          <button type="button" className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1" onClick={() => setShowOtherRoutes((s) => !s)} aria-expanded={showOtherRoutes}>
            {showOtherRoutes ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Other routes
          </button>
          {showOtherRoutes && (
            <select className="input w-full mt-2 max-w-xs" value={isTileRoute(route) ? '' : route} disabled={!canEdit} aria-label="Other routes"
              onChange={(e) => setD('recommended_route')(e.target.value || null)}>
              <option value="">Select...</option>
              {OTHER_ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r] || r}</option>)}
            </select>
          )}
        </div>
        <Field label="Reason" hint={parityMissing ? 'Stored after the schema update' : undefined}>
          <textarea rows={2} className="input w-full" value={draft?.route_reason ?? ''} disabled={!canEdit}
            placeholder={suggested === 'external' ? 'Structural damage marked as Major; external body shop recommended.' : 'Damage within internal workshop capability.'}
            onChange={(e) => setD('route_reason')(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Selected workshop">
            <input className="input w-full" value={routeForm.workshopName} disabled={!canEdit} onChange={(e) => setRouteForm((f) => ({ ...f, workshopName: e.target.value }))} />
          </Field>
          <Field label="City">
            <input className="input w-full" value={routeForm.vendorCity} disabled={!canEdit} onChange={(e) => setRouteForm((f) => ({ ...f, vendorCity: e.target.value }))} />
          </Field>
          <Field label="Expected duration (days)">
            <input type="number" min="0" className="input w-full" value={routeForm.expectedDurationDays} disabled={!canEdit} onChange={(e) => setRouteForm((f) => ({ ...f, expectedDurationDays: e.target.value }))} />
          </Field>
          <Field label="Quotation status">
            <select className="input w-full" value={routeForm.quotationStatus} disabled={!canEdit} onChange={(e) => setRouteForm((f) => ({ ...f, quotationStatus: e.target.value }))}>
              <option value="">{NOT_SET}</option>
              {QUOTATION_STATES.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Workshop type">
          <select className="input w-full max-w-xs" value={routeForm.workshopType} disabled={!canEdit} onChange={(e) => setRouteForm((f) => ({ ...f, workshopType: e.target.value }))}>
            <option value="">{NOT_SET}</option>
            {WORKSHOP_TYPES.map((w) => <option key={w} value={w}>{WORKSHOP_TYPE_LABEL[w] || w}</option>)}
          </select>
        </Field>
        {order && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Repair order: <span className={ORDER_STATUS_TONE[order.status] || ''}>{ORDER_STATUS_LABEL[order.status] || order.status}</span>
            {order.quotation_status ? ` · Quotation ${QUOTATION_LABEL[order.quotation_status] || order.quotation_status}` : ''}
          </p>
        )}
      </section>

      {/* Required attachments */}
      <section className="card space-y-3" data-testid="section-attachments">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Paperclip size={14} /> Required attachments</h4>
        <div className="divide-y divide-[var(--input-border)] rounded-lg border border-[var(--input-border)]">
          {attachments.map((a) => {
            const attached = a.status === 'attached'
            const statusText = a.countable ? (a.count > 0 ? String(a.count) : 'Missing') : (attached ? 'Attached' : 'Missing')
            const tone = attached ? 'text-green-400' : (a.required ? 'text-red-400' : 'text-[var(--text-muted)]')
            const Icon = attached ? CheckCircle2 : (a.required ? XCircle : Minus)
            const inputId = `attach-${a.key}`
            return (
              <div key={a.key} className="flex items-center justify-between gap-3 px-3 py-2 text-xs" data-testid={`attachment-${a.key}`}>
                <span className="text-[var(--text-primary)]">{a.label}{!a.required && <span className="text-[var(--text-muted)]"> (optional)</span>}</span>
                <span className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1 font-medium ${tone}`}><Icon size={13} /> {statusText}</span>
                  {elevated && (
                    <>
                      <input id={inputId} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadAttachment(a.key, f) }} />
                      <label htmlFor={inputId} className="btn-secondary text-[11px] inline-flex items-center gap-1 cursor-pointer">
                        {uploadingKey === a.key ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
                      </label>
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        {route === 'external' && !attachments.find((a) => a.key === 'vendor_quotation')?.count && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5" data-testid="quotation-warning"><AlertTriangle size={12} /> Attach vendor quotation to enable submission to External Workshop.</p>
        )}
      </section>

      {/* After submit notify */}
      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="assessment"
          recipients={NOTIFY_RECIPIENTS}
          title="After submit notify"
          subject="Workshop assessment report"
        />
      </section>

      {/* Actions */}
      <section className="card space-y-2" data-testid="section-actions">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save assessment'}
            </button>
            <button className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={saving || !gate.ok} onClick={submit} title={gate.ok ? undefined : gate.reasons.join(' ')}>
              <Send size={13} /> Submit assessment and route
            </button>
            {!gate.ok && <span className="text-[11px] text-[var(--text-muted)]" data-testid="submit-helper">{gate.reasons[0]}</span>}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {elevated ? 'This assessment has been submitted and is read-only.' : 'Only Admin / Manager / Director can record this assessment.'}
          </p>
        )}
        {notice && <p className="text-[11px] text-amber-400">{notice}</p>}
        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
      </section>

      <Disclosure title={<><Wrench size={16} /> Repair order and actual cost</>} testId="legacy-disclosure">
        {order && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-3 border-b border-[var(--input-border)]">
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Status</p><p className={`text-sm font-semibold ${ORDER_STATUS_TONE[order.status] || 'text-[var(--text-secondary)]'}`}>{ORDER_STATUS_LABEL[order.status] || order.status}</p></div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Route</p>
              <p className="text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                {ROUTE_LABEL[order.repair_route] || order.repair_route || NOT_SET}
                {assessment?.recommended_route && order.repair_route === assessment.recommended_route && (
                  <span className="badge text-[10px] bg-green-900/30 text-green-300 border border-green-700/50 inline-flex items-center gap-1"><Award size={10} /> Recommended</span>
                )}
              </p>
            </div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Quotation</p><p className="text-sm text-[var(--text-primary)]">{money(order.quotation_amount)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Planned completion</p><p className="text-sm text-[var(--text-primary)]">{order.planned_completion ? new Date(order.planned_completion).toLocaleDateString() : NOT_SET}</p></div>
          </div>
        )}
        {!order && <p className="text-sm text-[var(--text-muted)]">No open repair order for this case yet.</p>}

        {elevated ? (
          <form onSubmit={submitOrder} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Repair route">
              <select className="input w-full" value={orderForm.repairRoute} onChange={(e) => setOrderForm((f) => ({ ...f, repairRoute: e.target.value }))}>
                <option value="">Select...</option>
                {REPAIR_ROUTES.map((r) => (
                  <option key={r} value={r}>{ROUTE_LABEL[r] || r}{r === assessment?.recommended_route ? ' (Recommended)' : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Workshop type">
              <select className="input w-full" value={orderForm.workshopType} onChange={(e) => setOrderForm((f) => ({ ...f, workshopType: e.target.value }))}>
                <option value="">Select...</option>
                {WORKSHOP_TYPES.map((w) => <option key={w} value={w}>{WORKSHOP_TYPE_LABEL[w] || w}</option>)}
              </select>
            </Field>
            <Field label="Workshop name">
              <input className="input w-full" value={orderForm.workshopName} onChange={(e) => setOrderForm((f) => ({ ...f, workshopName: e.target.value }))} />
            </Field>
            <Field label="Quotation amount">
              <input type="number" min="0" className="input w-full" value={orderForm.quotationAmount} onChange={(e) => setOrderForm((f) => ({ ...f, quotationAmount: e.target.value }))} />
            </Field>
            <Field label="Planned completion">
              <input type="date" className="input w-full" value={orderForm.plannedCompletion} onChange={(e) => setOrderForm((f) => ({ ...f, plannedCompletion: e.target.value }))} />
            </Field>
            <div className="flex items-end">
              <button type="submit" className="btn-primary text-xs" disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : (order ? 'Update repair order' : 'Open repair order')}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can open or update the repair order.</p>
        )}

        <div className="pt-3 border-t border-[var(--input-border)] space-y-2">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Actual repair cost</h4>
          <p className="text-[11px] text-[var(--text-muted)]">
            What the repair actually cost, once known. Shown on the case header "Gross cost" tile. Separate from the
            estimate above and the repair order quotation.
          </p>
          {elevated ? (
            <form onSubmit={saveActualCost} className="flex items-end gap-3">
              <div className="flex-1 max-w-[220px]">
                <label className="label">Actual repair cost</label>
                <input type="number" min="0" className="input w-full" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
              </div>
              <button type="submit" className="btn-secondary text-xs" disabled={actualCostSaving}>
                {actualCostSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-[var(--text-primary)]">{acc?.repair_cost != null ? money(acc.repair_cost) : 'Not recorded'}</p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--input-border)]">
          <EvidenceTable accidentId={accidentId} workstreamKey="assessment" elevated={elevated} title="All attachments" />
        </div>
      </Disclosure>
    </div>
  )
}
